import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import type { VaultGitReceipt } from "../src/model.ts";
import type {
	VaultGitActivationValidationPort,
	VaultGitRemotePort,
	VaultGitRepositoryPort,
	VaultGitRuntimePort,
} from "../src/ports.ts";
import { createVaultGitRepair } from "../src/repair.ts";
import { createReceiptStore } from "../src/store.ts";

const BASELINE = "a".repeat(40);
const LEASE_GENERATION = "b".repeat(40);
const RECOVERED_COMMIT = "c".repeat(40);
const UNRELATED_COMMIT = "d".repeat(40);
const TAKEOVER_GENERATION = "e".repeat(40);
const TRANSACTION_ID = `txn_${"1".repeat(32)}`;
const FOREIGN_TRANSACTION_ID = `txn_${"2".repeat(32)}`;
const INTENT_BASE_GENERATION = "0".repeat(40);
const OWNER_CAPABILITY = new Uint8Array([7, 8, 9]);
const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("resume repair races", () => {
	test("a post-Doctor foreign lease is never adopted by an intent receipt", async () => {
		const fixture = await resumeFixture({
			phase: "intent_durable",
			ledger: (read) =>
				read === 1
					? intentHeldLedger(TRANSACTION_ID, LEASE_GENERATION)
					: intentHeldLedger(FOREIGN_TRANSACTION_ID, TAKEOVER_GENERATION),
		});

		const result = await fixture.repair.run({
			action: "resume",
			remote: "origin",
			capability: OWNER_CAPABILITY,
		});

		expect(result).toMatchObject({
			status: "refused",
			state: "human_required",
			blocker: "lease_generation_stale",
			changedState: "none",
		});
		expect(fixture.ledgerReads()).toBe(2);
		expect(await fixture.store.load()).toMatchObject({
			status: "loaded",
			receipt: { transactionId: null, phase: "intent_durable" },
		});
	});

	test("takeover after Doctor refuses before restoring writing authority", async () => {
		const fixture = await resumeFixture({
			phase: "writing",
			ledger: (read) => (read === 1 ? heldLedger() : takeoverLedger()),
		});

		const result = await fixture.repair.run(resumeInput());

		expect(result).toMatchObject({
			status: "refused",
			state: "superseded",
			blocker: "lease_generation_stale",
			changedState: "none",
			nextAction: { id: "request_operator_review" },
		});
		expect(fixture.ledgerReads()).toBe(2);
		expect(fixture.atomicCloseCalls()).toBe(0);
	});

	test("revocation after Doctor refuses before restoring writing authority", async () => {
		const fixture = await resumeFixture({
			phase: "writing",
			activationAuthority: {
				validate: async () => ({ status: "revoked", evidenceId: "fixture" }),
			},
		});

		const result = await fixture.repair.run(resumeInput());

		expect(result).toMatchObject({
			status: "refused",
			state: "active",
			blocker: "activation_blocked",
			changedState: "none",
			nextAction: { id: "prepare_fresh" },
			activationRestriction: { cause: { id: "revoked" } },
		});
		expect(fixture.atomicCloseCalls()).toBe(0);
	});

	test("a second unrelated HEAD after Doctor is never recorded or published", async () => {
		const fixture = await resumeFixture({
			phase: "committing",
			identityHeads: [RECOVERED_COMMIT, UNRELATED_COMMIT],
		});

		const result = await fixture.repair.run(resumeInput());

		expect(result).toMatchObject({
			status: "refused",
			state: "human_required",
			blocker: "deterministic_repair_mismatch",
			changedState: "none",
			nextAction: { id: "request_operator_review" },
		});
		expect(fixture.inspectedCommits()).toEqual([
			RECOVERED_COMMIT,
			UNRELATED_COMMIT,
		]);
		expect(fixture.atomicCloseCalls()).toBe(0);
	});
});

function resumeInput() {
	return {
		action: "resume" as const,
		transactionId: TRANSACTION_ID,
		remote: "origin",
		capability: OWNER_CAPABILITY,
	};
}

async function resumeFixture(options: {
	readonly phase: "intent_durable" | "writing" | "committing";
	readonly identityHeads?: readonly string[];
	readonly ledger?: (read: number) => ReturnType<typeof heldLedger>;
	readonly activationAuthority?: VaultGitActivationValidationPort;
}) {
	const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-resume-race-"));
	roots.push(stateRoot);
	const store = createReceiptStore({
		stateRoot,
		repositoryIdentity: "canonical-vault",
	});
	await store.initialize(receipt(options.phase), {
		ownerCapability: OWNER_CAPABILITY,
		joinCapability: new Uint8Array([1, 2, 3]),
	});

	let identityRead = 0;
	const identityHeads = options.identityHeads ?? [BASELINE, BASELINE];
	const inspectedCommits: string[] = [];
	const repository: VaultGitRepositoryPort = {
		async inspectSafety() {
			return { status: "safe" };
		},
		async resolveCanonicalIdentity() {
			const head = identityHeads[Math.min(identityRead, identityHeads.length - 1)];
			identityRead += 1;
			if (!head) throw new Error("fixture head missing");
			return { identity: "canonical-vault", localMainHead: head };
		},
		async inspectOwnedPaths() {
			throw new Error("not used");
		},
		async inspectLocalCommit(commitId) {
			inspectedCommits.push(commitId);
			return commitId === RECOVERED_COMMIT
				? {
						status: "ok" as const,
						commitId,
						parents: [BASELINE],
						message: `docs(vault): recovered\n\nVault-Transaction: ${TRANSACTION_ID}`,
					}
				: {
						status: "ok" as const,
						commitId,
						parents: ["f".repeat(40)],
						message: "unrelated commit",
					};
		},
	};

	let ledgerReads = 0;
	let atomicCloseCalls = 0;
	const remote: VaultGitRemotePort = {
		async inspectMain() {
			throw new Error("not used");
		},
		async readLedger() {
			ledgerReads += 1;
			return (options.ledger ?? (() => heldLedger()))(ledgerReads);
		},
		async appendLedgerCommit() {
			throw new Error("not used");
		},
		async atomicClose() {
			atomicCloseCalls += 1;
			return {
				status: "closed",
				mainCommit: RECOVERED_COMMIT,
				ledgerCommit: "9".repeat(40),
			};
		},
	};
	const runtime: VaultGitRuntimePort = {
		now: () => new Date("2026-08-09T00:00:02.000Z"),
		actor: () => "agent-a",
		host: () => "host-a",
		newReceiptId: () => `receipt_${"3".repeat(32)}`,
		interrupt() {},
	};
	return {
		store,
		repair: createVaultGitRepair({
			store,
			repository,
			ledger: { git: remote, clock: runtime },
			runtime,
			repositoryIdentity: "canonical-vault",
			activationAuthority:
				options.activationAuthority ?? {
					validate: async () => ({
						status: "admitted" as const,
						evidenceId: "fixture",
					}),
				},
		}),
		ledgerReads: () => ledgerReads,
		atomicCloseCalls: () => atomicCloseCalls,
		inspectedCommits: () => inspectedCommits,
	};
}

function receipt(
	phase: "intent_durable" | "writing" | "committing",
): VaultGitReceipt {
	const intent = phase === "intent_durable";
	return {
		schemaVersion: 2,
		receiptId: `receipt_${"2".repeat(32)}`,
		transactionId: intent ? null : TRANSACTION_ID,
		revision: 1,
		phase,
		transition: intent
			? "acquisition_intent"
			: phase === "writing"
				? "write_authority_granted"
				: "commit_candidate_frozen",
		recordedAt: "2026-08-09T00:00:01.000Z",
		event: "note_created",
		actor: "agent-a",
		host: "host-a",
		remote: "origin",
		ownedPaths: [
			{ path: "notes/new.md", baselineHash: null, admittedNewFile: true },
		],
		unrelatedState: { statusHex: "", indexHex: "" },
		localMainHead: BASELINE,
		remoteMainHead: BASELINE,
		expectedLeaseGeneration: intent ? INTENT_BASE_GENERATION : null,
		leaseGeneration: intent ? null : LEASE_GENERATION,
		leaseAcquiredAt: intent ? null : "2026-08-09T00:00:00.000Z",
		leaseDurationMs: 60_000,
		commitId: null,
		expectedMainCommit: null,
		ledgerReleaseId: null,
		pushOutcome: "not_attempted",
		nextSafeAction: intent
			? "retry_remote"
			: phase === "writing"
				? "complete_transaction"
				: "preserve_local_edits",
		diagnosticsReference: `receipt:receipt_${"2".repeat(32)}`,
	};
}

function heldLedger() {
	return {
		status: "ok" as const,
		head: {
			generation: LEASE_GENERATION,
			parents: [] as readonly string[],
			content: ledgerContent("acquire", LEASE_GENERATION, "held"),
		},
	};
}

function takeoverLedger() {
	return {
		status: "ok" as const,
		head: {
			generation: TAKEOVER_GENERATION,
			parents: [LEASE_GENERATION] as readonly string[],
			content: ledgerContent(
				"superseding_abandon",
				LEASE_GENERATION,
				"released",
			),
		},
	};
}

function intentHeldLedger(transactionId: string, generation: string) {
	return {
		status: "ok" as const,
		head: {
			generation,
			parents: [INTENT_BASE_GENERATION] as readonly string[],
			content: ledgerContent(
				"acquire",
				INTENT_BASE_GENERATION,
				"held",
				transactionId,
				true,
			),
		},
	};
}

function ledgerContent(
	operation: "acquire" | "superseding_abandon",
	previousGeneration: string,
	state: "held" | "released",
	transactionId = TRANSACTION_ID,
	acquireHasParent = false,
): string {
	return `${JSON.stringify({
		schema_version: 1,
		operation,
		previous_generation:
			operation === "acquire" && !acquireHasParent
				? null
				: previousGeneration,
		transitioned_at: "2026-08-09T00:00:01.000Z",
		...(operation === "superseding_abandon"
			? { superseding_actor: "operator" }
			: {}),
		lease: {
			transaction_id: transactionId,
			actor: "agent-a",
			host: "host-a",
			event: "note_created",
			owned_paths: ["notes/new.md"],
			local_main_head: BASELINE,
			remote_main_head: BASELINE,
			acquired_at: "2026-08-09T00:00:00.000Z",
			lease_duration_ms: 60_000,
			state,
		},
	})}\n`;
}
