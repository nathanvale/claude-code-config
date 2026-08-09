import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createVaultGitDoctor } from "../src/doctor.ts";
import {
	createGitAdapter,
	createGitRepositoryAdapter,
	createNodeProcessPort,
} from "../src/git-adapter.ts";
import { VAULT_GIT_LEDGER_REF, type VaultGitReceipt } from "../src/model.ts";
import type { VaultGitRuntimePort } from "../src/ports.ts";
import { createVaultGitRepair } from "../src/repair.ts";
import { createReceiptStore } from "../src/store.ts";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("deterministic push_pending repair", () => {
	test("retries the prepared atomic close through its sole adapter and closes idempotently", async () => {
		const fixture = await repairFixture();
		const diagnosis = await fixture.doctor.diagnose({
			transactionId: fixture.transactionId,
		});
		expect(diagnosis).toMatchObject({
			finding: "publication_pending",
			repairAction: "retry-push",
			retrySafety: "same_input_safe",
			nextAction: { id: "run_repair" },
		});

		const first = await fixture.repair.run({
			action: "retry-push",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(first).toMatchObject({
			status: "repaired",
			state: "closed",
			changedState: "remote",
		});
		expect(git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(
			fixture.candidate,
		);
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			fixture.releaseCommit,
		);

		const tipBefore = git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF);
		const second = await fixture.repair.run({
			action: "retry-push",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(second).toMatchObject({
			status: "repaired",
			state: "closed",
			changedState: "none",
		});
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			tipBefore,
		);
	});

	test("classifies a one-ref-only remote result as a contract breach without retry", async () => {
		const fixture = await repairFixture();
		git(fixture.bare, "fetch", fixture.clone, fixture.candidate);
		git(fixture.bare, "update-ref", "refs/heads/main", fixture.candidate);
		const diagnosis = await fixture.doctor.diagnose({
			transactionId: fixture.transactionId,
		});
		expect(diagnosis).toMatchObject({
			finding: "remote_contract_breach",
			blocker: "host_contract_breach",
			retrySafety: "operator_required",
			nextAction: { id: "request_operator_review" },
		});
		expect(diagnosis.repairAction).toBeUndefined();
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			fixture.ledgerHead,
		);
	});

	test("recognizes a lost acknowledgement after later main and ledger descendants land", async () => {
		const fixture = await repairFixture();
		const candidateTree = git(
			fixture.clone,
			"rev-parse",
			`${fixture.candidate}^{tree}`,
		);
		const laterMain = git(
			fixture.clone,
			"commit-tree",
			candidateTree,
			"-p",
			fixture.candidate,
			"-m",
			"later main",
		);
		const laterTransactionId = `txn_${"4".repeat(32)}`;
		const laterLedger = commitLedger(
			fixture.clone,
			ledgerContent({
				operation: "acquire",
				previousGeneration: fixture.releaseCommit,
				transactionId: laterTransactionId,
				baseline: fixture.candidate,
				acquiredAt: "2026-08-09T00:00:03.000Z",
				transitionedAt: "2026-08-09T00:00:03.000Z",
				state: "held",
				leaseDurationMs: 60_000,
			}),
			[fixture.releaseCommit],
			`vault-ledger: acquire ${laterTransactionId}`,
			"2026-08-09T00:00:03.000Z",
		);
		git(fixture.bare, "fetch", fixture.clone, laterMain, laterLedger);
		git(fixture.bare, "update-ref", "refs/heads/main", laterMain);
		git(fixture.bare, "update-ref", VAULT_GIT_LEDGER_REF, laterLedger);

		expect(
			await fixture.doctor.diagnose({
				transactionId: fixture.transactionId,
			}),
		).toMatchObject({
			finding: "publication_already_closed",
			repairAction: "close-verified",
			retrySafety: "same_input_safe",
		});
	});

	test("prevents a non-originating host from retrying an unpublished local commit", async () => {
		const fixture = await repairFixture("host-b");
		const diagnosis = await fixture.doctor.diagnose({
			transactionId: fixture.transactionId,
		});
		expect(diagnosis).toMatchObject({
			finding: "publication_pending",
			retrySafety: "operator_required",
			nextAction: { id: "request_operator_review" },
		});
		expect(diagnosis.repairAction).toBeUndefined();
	});

	test("uses one fresh single-use proof for an audited stale-lease abandonment", async () => {
		const fixture = await repairFixture("host-a", "stale");
		const diagnosis = await fixture.doctor.diagnose({
			transactionId: fixture.transactionId,
		});
		expect(diagnosis).toMatchObject({
			finding: "lease_expired",
			repairAction: "stale-lease-takeover",
			takeoverTokenIssued: true,
			changedState: "local",
		});
		const token = await fixture.store.readDoctorToken(
			fixture.transactionId,
			fixture.ledgerHead,
		);
		const first = await fixture.repair.run({
			action: "stale-lease-takeover",
			transactionId: fixture.transactionId,
			remote: "origin",
			expectedLedgerGeneration: fixture.ledgerHead,
			doctorToken: token,
			priorWriterStopped: true,
		});
		expect(first).toMatchObject({
			status: "repaired",
			state: "superseded",
			changedState: "remote",
			nextAction: { id: "reconcile_quarantine" },
		});
		const ledger = JSON.parse(
			git(fixture.bare, "show", `${VAULT_GIT_LEDGER_REF}:ledger.json`),
		);
		expect(ledger).toMatchObject({
			operation: "superseding_abandon",
			previous_generation: fixture.ledgerHead,
			lease: {
				transaction_id: fixture.transactionId,
				state: "released",
			},
		});
		expect(await fixture.store.readQuarantine()).toMatchObject({
			status: "quarantined",
			transactionId: fixture.transactionId,
		});

		const second = await fixture.repair.run({
			action: "stale-lease-takeover",
			transactionId: fixture.transactionId,
			remote: "origin",
			expectedLedgerGeneration: fixture.ledgerHead,
			doctorToken: token,
			priorWriterStopped: true,
		});
		expect(second).toMatchObject({
			status: "refused",
			blocker: "doctor_token_invalid",
		});
		expect(await fixture.doctor.diagnose()).toMatchObject({
			finding: "host_quarantined",
			repairAction: "reconcile-quarantine",
		});
	});

	test("refuses a stale doctor proof after owned content changes", async () => {
		const fixture = await repairFixture("host-a", "stale");
		await fixture.doctor.diagnose({ transactionId: fixture.transactionId });
		const token = await fixture.store.readDoctorToken(
			fixture.transactionId,
			fixture.ledgerHead,
		);
		writeFileSync(join(fixture.clone, "candidate.md"), "changed after doctor\n");
		const result = await fixture.repair.run({
			action: "stale-lease-takeover",
			transactionId: fixture.transactionId,
			remote: "origin",
			expectedLedgerGeneration: fixture.ledgerHead,
			doctorToken: token,
			priorWriterStopped: true,
		});
		expect(result).toMatchObject({
			status: "refused",
			blocker: "doctor_proof_stale",
			changedState: "none",
		});
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			fixture.ledgerHead,
		);
	});
});

async function repairFixture(
	runtimeHost = "host-a",
	mode: "push_pending" | "stale" = "push_pending",
) {
	const root = await mkdtemp(join(tmpdir(), "vault-git-repair-"));
	roots.push(root);
	const bare = join(root, "remote.git");
	const clone = join(root, "clone");
	git(root, "init", "--bare", bare);
	git(root, "clone", bare, clone);
	git(clone, "checkout", "-b", "main");
	git(clone, "config", "user.name", "Fixture");
	git(clone, "config", "user.email", "fixture@example.invalid");
	const baseline = commitFile(clone, "initial.md", "initial\n", "initial");
	git(clone, "push", "origin", "refs/heads/main:refs/heads/main");

	const transactionId = `txn_${"1".repeat(32)}`;
	const acquiredAt = "2026-08-09T00:00:00.000Z";
	const leaseDurationMs = mode === "stale" ? 1_000 : 60_000;
	const heldContent = ledgerContent({
		operation: "acquire",
		previousGeneration: null,
		transactionId,
		baseline,
		acquiredAt,
		transitionedAt: acquiredAt,
		state: "held",
		leaseDurationMs,
	});
	const ledgerHead = commitLedger(clone, heldContent, [], "vault-ledger: acquire");
	git(clone, "push", "origin", `${ledgerHead}:${VAULT_GIT_LEDGER_REF}`);

	const candidate = commitFile(
		clone,
		"candidate.md",
		"candidate\n",
		`docs(vault): record candidate\n\nVault-Transaction: ${transactionId}`,
	);
	const preparedAt = "2026-08-09T00:00:01.000Z";
	const releaseContent = ledgerContent({
		operation: "release",
		previousGeneration: ledgerHead,
		transactionId,
		baseline,
		acquiredAt,
		transitionedAt: preparedAt,
		state: "released",
		leaseDurationMs,
	});
	const releaseCommit = commitLedger(
		clone,
		releaseContent,
		[ledgerHead],
		`vault-ledger: release ${transactionId}`,
		preparedAt,
	);

	const stateRoot = join(root, "state");
	const store = createReceiptStore({
		stateRoot,
		repositoryIdentity: "canonical-vault",
	});
	const ownerCapability = new Uint8Array([7, 8, 9]);
	const receipt: VaultGitReceipt = {
		schemaVersion: 2,
		receiptId: `receipt_${"2".repeat(32)}`,
		transactionId,
		revision: 1,
		phase: mode === "stale" ? "writing" : "push_pending",
		transition:
			mode === "stale" ? "write_authority_granted" : "push_outcome_unknown",
		recordedAt: preparedAt,
		event: "note_created",
		actor: "agent-a",
		host: "host-a",
		remote: "origin",
		ownedPaths: [
			{ path: "candidate.md", baselineHash: null, admittedNewFile: true },
		],
		unrelatedState: { statusHex: "", indexHex: "" },
		localMainHead: baseline,
		remoteMainHead: baseline,
		expectedLeaseGeneration: null,
		leaseGeneration: ledgerHead,
		leaseAcquiredAt: acquiredAt,
		leaseDurationMs,
		commitId: mode === "stale" ? null : candidate,
		expectedMainCommit: mode === "stale" ? null : candidate,
		ledgerReleaseId: mode === "stale" ? null : releaseCommit,
		pushOutcome: mode === "stale" ? "not_attempted" : "unknown",
		nextSafeAction: mode === "stale" ? "complete_transaction" : "run_doctor",
		diagnosticsReference: `receipt:receipt_${"2".repeat(32)}`,
	};
	await store.initialize(receipt, {
		ownerCapability,
		joinCapability: new Uint8Array([1, 2, 3]),
	});
	if (mode === "stale") {
		git(clone, "update-ref", "refs/heads/main", baseline, candidate);
	}
	const processPort = createNodeProcessPort();
	const timeouts = { fetchMs: 5_000, pushMs: 5_000, localMs: 5_000 };
	const remote = createGitAdapter({
		repositoryPath: clone,
		process: processPort,
		timeouts,
	});
	const repository = createGitRepositoryAdapter({
		repositoryPath: clone,
		repositoryIdentity: "canonical-vault",
		process: processPort,
		timeouts,
	});
	const runtime = new FixedRuntime(runtimeHost);
	const options = {
		store,
		repository,
		ledger: { git: remote, clock: runtime },
		runtime,
		repositoryIdentity: "canonical-vault",
	};
	return {
		root,
		bare,
		clone,
		candidate,
		ledgerHead,
		releaseCommit,
		transactionId,
		ownerCapability,
		store,
		doctor: createVaultGitDoctor(options),
		repair: createVaultGitRepair(options),
	};
}

class FixedRuntime implements VaultGitRuntimePort {
	constructor(private readonly hostId: string) {}
	now(): Date {
		return new Date("2026-08-09T00:00:02.000Z");
	}
	actor(): string {
		return "agent-a";
	}
	host(): string {
		return this.hostId;
	}
	newReceiptId(): string {
		return `receipt_${"3".repeat(32)}`;
	}
	interrupt(): void {}
}

function ledgerContent(input: {
	operation: "acquire" | "release";
	previousGeneration: string | null;
	transactionId: string;
	baseline: string;
	acquiredAt: string;
	transitionedAt: string;
	state: "held" | "released";
	leaseDurationMs: number;
}): string {
	return `${JSON.stringify({
		schema_version: 1,
		operation: input.operation,
		previous_generation: input.previousGeneration,
		transitioned_at: input.transitionedAt,
		lease: {
			transaction_id: input.transactionId,
			actor: "agent-a",
			host: "host-a",
			event: "note_created",
			owned_paths: ["candidate.md"],
			local_main_head: input.baseline,
			remote_main_head: input.baseline,
			acquired_at: input.acquiredAt,
			lease_duration_ms: input.leaseDurationMs,
			state: input.state,
		},
	})}\n`;
}

function commitLedger(
	cwd: string,
	content: string,
	parents: readonly string[],
	message: string,
	timestamp = "2026-08-09T00:00:00.000Z",
): string {
	const blob = gitInput(cwd, content, "hash-object", "-w", "--stdin");
	const tree = gitInput(cwd, `100644 blob ${blob}\tledger.json\n`, "mktree");
	return execFileSync(
		"git",
		["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", message],
		{
			cwd,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "agent-a",
				GIT_AUTHOR_EMAIL: "vault-git@localhost.invalid",
				GIT_AUTHOR_DATE: timestamp,
				GIT_COMMITTER_NAME: "vault-git transaction manager",
				GIT_COMMITTER_EMAIL: "vault-git@localhost.invalid",
				GIT_COMMITTER_DATE: timestamp,
			},
		},
	).trim();
}

function commitFile(cwd: string, path: string, content: string, message: string): string {
	mkdirSync(join(cwd, path, ".."), { recursive: true });
	writeFileSync(join(cwd, path), content);
	git(cwd, "add", "--", path);
	git(cwd, "commit", "-m", message);
	return git(cwd, "rev-parse", "HEAD");
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function gitInput(cwd: string, input: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, input, encoding: "utf8" }).trim();
}
