import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createVaultGitDoctor } from "../src/doctor.ts";
import type {
	VaultGitRemotePort,
	VaultGitRepositoryPort,
	VaultGitRuntimePort,
} from "../src/ports.ts";
import { createReceiptStore } from "../src/store.ts";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("vault-git doctor", () => {
	test("exports the read-only recovery classifier", () => {
		expect(createVaultGitDoctor).toBeFunction();
	});

	test("answers all five recovery questions for absent state without leaking private paths", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-"));
		roots.push(stateRoot);
		const store = createReceiptStore({
			stateRoot,
			repositoryIdentity: "canonical-vault",
		});
		const repository: VaultGitRepositoryPort = {
			resolveCanonicalIdentity: () => Promise.reject(new Error("not used")),
			inspectOwnedPaths: () => Promise.reject(new Error("not used")),
		};
		const remote: VaultGitRemotePort = {
			inspectMain: () => Promise.reject(new Error("not used")),
			readLedger: () => Promise.reject(new Error("not used")),
			appendLedgerCommit: () => Promise.reject(new Error("not used")),
		};
		const runtime: VaultGitRuntimePort = {
			now: () => new Date("2026-08-09T00:00:00.000Z"),
			actor: () => "agent-a",
			host: () => "host-a",
			newReceiptId: () => `receipt_${"1".repeat(32)}`,
			interrupt() {},
		};
		const result = await createVaultGitDoctor({
			store,
			repository,
			ledger: { git: remote, clock: runtime },
			runtime,
			repositoryIdentity: "canonical-vault",
		}).diagnose();
		expect(result).toMatchObject({
			finding: "no_receipt",
			changedState: "none",
			retrySafety: "same_input_safe",
			nextAction: { id: "begin_transaction" },
		});
		expect(result.diagnosticsReference).toMatch(/^doctor:[0-9a-f]{64}$/);
		expect(JSON.stringify(result)).not.toContain(stateRoot);
	});
});
