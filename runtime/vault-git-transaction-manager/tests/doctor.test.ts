import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createVaultGitDoctor } from "../src/doctor.ts";
import type { VaultGitReceipt } from "../src/model.ts";
import {
	VaultRepositoryIdentityUnavailableError,
	type VaultGitRemotePort,
	type VaultGitRepositoryPort,
	type VaultGitRuntimePort,
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

	test("keeps a receipt-backed identity outage retry-safe and distinct from identity drift", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-"));
		roots.push(stateRoot);
		const store = createReceiptStore({
			stateRoot,
			repositoryIdentity: "canonical-vault",
		});
		await store.initialize(receipt(), {
			ownerCapability: new Uint8Array([1]),
			joinCapability: new Uint8Array([2]),
		});
		const repository: VaultGitRepositoryPort = {
			resolveCanonicalIdentity: () =>
				Promise.reject(new VaultRepositoryIdentityUnavailableError()),
			inspectOwnedPaths: () => Promise.reject(new Error("not used")),
		};
		const remote: VaultGitRemotePort = {
			inspectMain: () => Promise.reject(new Error("not used")),
			readLedger: () => Promise.reject(new Error("not used")),
			appendLedgerCommit: () => Promise.reject(new Error("not used")),
		};
		const runtime = runtimeFixture();

		expect(
			await createVaultGitDoctor({
				store,
				repository,
				ledger: { git: remote, clock: runtime },
				runtime,
				repositoryIdentity: "canonical-vault",
			}).diagnose(),
		).toMatchObject({
			state: "active",
			finding: "activation_missing",
			blocker: "activation_blocked",
			retrySafety: "same_input_safe",
			nextAction: { id: "inspect_configured_vault" },
			activationRestriction: {
				cause: { id: "revalidation_unavailable" },
			},
		});
	});

	test.each([
		["push_pending", "push_pending"],
		["repairable", "repairable"],
	] as const)(
		"preserves %s state when repository identity is temporarily unavailable",
		async (phase, state) => {
			const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-"));
			roots.push(stateRoot);
			const store = createReceiptStore({
				stateRoot,
				repositoryIdentity: "canonical-vault",
			});
			await store.initialize(receiptForRecoveryPhase(phase), {
				ownerCapability: new Uint8Array([1]),
				joinCapability: new Uint8Array([2]),
			});
			const repository: VaultGitRepositoryPort = {
				resolveCanonicalIdentity: () =>
					Promise.reject(new VaultRepositoryIdentityUnavailableError()),
				inspectOwnedPaths: () => Promise.reject(new Error("not used")),
			};
			const remote: VaultGitRemotePort = {
				inspectMain: () => Promise.reject(new Error("not used")),
				readLedger: () => Promise.reject(new Error("not used")),
				appendLedgerCommit: () => Promise.reject(new Error("not used")),
			};

			expect(
				await createVaultGitDoctor({
					store,
					repository,
					ledger: { git: remote, clock: runtimeFixture() },
					runtime: runtimeFixture(),
					repositoryIdentity: "canonical-vault",
				}).diagnose(),
			).toMatchObject({
				state,
				phase,
				finding: "activation_missing",
				blocker: "activation_blocked",
				nextAction: { id: "inspect_configured_vault" },
			});
		},
	);

	test("drives the stale-lease takeover continuation without naming itself as its own continuation", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-"));
		roots.push(stateRoot);
		const store = createReceiptStore({
			stateRoot,
			repositoryIdentity: "canonical-vault",
		});
		const receipt = expiredStaleLeaseReceipt();
		await store.initialize(receipt, {
			ownerCapability: new Uint8Array([1]),
			joinCapability: new Uint8Array([2]),
		});
		const localMainHead = "b".repeat(40);
		const repository: VaultGitRepositoryPort = {
			resolveCanonicalIdentity: () =>
				Promise.resolve({ identity: "canonical-vault", localMainHead }),
			inspectOwnedPaths: () => Promise.reject(new Error("not used")),
			hashOwnedPaths: (paths) =>
				Promise.resolve(
					paths.map((path) => ({
						path,
						contentHash: "d".repeat(40),
						fileMode: "100644" as const,
					})),
				),
			captureUnrelatedState: () =>
				Promise.resolve({ statusHex: "", indexHex: "" }),
		};
		const remote: VaultGitRemotePort = {
			inspectMain: () => Promise.reject(new Error("not used")),
			readLedger: () =>
				Promise.resolve({
					status: "ok",
					head: {
						generation: receipt.leaseGeneration as string,
						parents: [],
						content: heldLeaseLedgerContent(receipt),
					},
				}),
			appendLedgerCommit: () => Promise.reject(new Error("not used")),
		};
		// The clock must sit past leaseAcquiredAt + leaseDurationMs so the held
		// lease reads expired; equal-to-the-deadline is the earliest expired instant.
		const runtime: VaultGitRuntimePort = {
			now: () => new Date("2026-08-09T00:01:00.000Z"),
			actor: () => "agent-a",
			host: () => "host-a",
			newReceiptId: () => `receipt_${"2".repeat(32)}`,
			interrupt() {},
		};

		const result = await createVaultGitDoctor({
			store,
			repository,
			ledger: { git: remote, clock: runtime },
			runtime,
			repositoryIdentity: "canonical-vault",
		}).diagnose({ transactionId: receipt.transactionId ?? undefined });

		expect(result).toMatchObject({
			finding: "lease_expired",
			repairAction: "stale-lease-takeover",
			changedState: "local",
			takeoverTokenIssued: true,
			nextAction: { id: "run_repair" },
		});
		expect(result.nextAction.id).not.toBe("run_doctor");

		const independentReader = createReceiptStore({
			stateRoot,
			repositoryIdentity: "canonical-vault",
		});
		const token = await independentReader.readDoctorToken(
			receipt.transactionId as string,
			receipt.leaseGeneration as string,
		);
		expect(token.byteLength).toBeGreaterThan(0);
		const proof = await independentReader.readDoctorProof(
			receipt.transactionId as string,
			receipt.leaseGeneration as string,
		);
		expect(proof).toMatchObject({
			receiptId: receipt.receiptId,
			receiptRevision: receipt.revision,
		});

		expect(JSON.stringify(result)).not.toContain(stateRoot);
	});
});

function runtimeFixture(): VaultGitRuntimePort {
	return {
		now: () => new Date("2026-08-09T00:00:00.000Z"),
		actor: () => "agent-a",
		host: () => "host-a",
		newReceiptId: () => `receipt_${"2".repeat(32)}`,
		interrupt() {},
	};
}

function receipt(): VaultGitReceipt {
	return {
		schemaVersion: 2,
		receiptId: `receipt_${"1".repeat(32)}`,
		transactionId: null,
		revision: 1,
		phase: "intent_durable",
		transition: "acquisition_intent",
		recordedAt: "2026-08-09T00:00:00.000Z",
		event: "note_created",
		actor: "agent-a",
		host: "host-a",
		remote: "origin",
		ownedPaths: [
			{ path: "notes/example.md", baselineHash: null, admittedNewFile: true },
		],
		unrelatedState: { statusHex: "", indexHex: "" },
		localMainHead: "b".repeat(40),
		remoteMainHead: "b".repeat(40),
		expectedLeaseGeneration: null,
		leaseGeneration: null,
		leaseAcquiredAt: null,
		leaseDurationMs: 60_000,
		commitId: null,
		expectedMainCommit: null,
		ledgerReleaseId: null,
		pushOutcome: "not_attempted",
		nextSafeAction: "retry_remote",
		diagnosticsReference: `receipt:receipt_${"1".repeat(32)}`,
	};
}

function expiredStaleLeaseReceipt(): VaultGitReceipt {
	return {
		...receiptForRecoveryPhase("repairable"),
		leaseAcquiredAt: "2026-08-09T00:00:00.000Z",
		leaseDurationMs: 60_000,
	};
}

function heldLeaseLedgerContent(receipt: VaultGitReceipt): string {
	return `${JSON.stringify({
		schema_version: 1,
		operation: "acquire",
		previous_generation: null,
		transitioned_at: "2026-08-09T00:00:00.000Z",
		lease: {
			transaction_id: receipt.transactionId,
			actor: receipt.actor,
			host: receipt.host,
			event: receipt.event,
			owned_paths: receipt.ownedPaths.map((entry) => entry.path),
			local_main_head: receipt.localMainHead,
			remote_main_head: receipt.remoteMainHead,
			acquired_at: receipt.leaseAcquiredAt,
			lease_duration_ms: receipt.leaseDurationMs,
			state: "held",
		},
	})}\n`;
}

function receiptForRecoveryPhase(
	phase: "push_pending" | "repairable",
): VaultGitReceipt {
	const commitId = "c".repeat(40);
	return {
		...receipt(),
		transactionId: `txn_${"3".repeat(32)}`,
		phase,
		transition:
			phase === "push_pending"
				? "push_outcome_unknown"
				: "deterministic_repair_available",
		leaseGeneration: "a".repeat(40),
		leaseAcquiredAt: "2026-08-09T00:00:00.000Z",
		commitId: phase === "push_pending" ? commitId : null,
		expectedMainCommit: phase === "push_pending" ? commitId : null,
		pushOutcome: phase === "push_pending" ? "unknown" : "not_attempted",
		nextSafeAction: phase === "push_pending" ? "retry_push" : "run_repair",
	};
}
