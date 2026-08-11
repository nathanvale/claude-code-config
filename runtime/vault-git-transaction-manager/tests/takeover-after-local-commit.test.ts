import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createVaultGitDoctor } from "../src/doctor.ts";
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
const CANDIDATE = "c".repeat(40);
const TAKEOVER_GENERATION = "d".repeat(40);
const RELEASE_COMMIT = "e".repeat(40);
const TRANSACTION_ID = `txn_${"1".repeat(32)}`;
const OWNER_CAPABILITY = new Uint8Array([7, 8, 9]);
const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("takeover after local commit", () => {
	test("Doctor keeps the stale push_pending generation superseded", async () => {
		const fixture = await fixtureWithLedger(() => takeoverLedger());

		const diagnosis = await fixture.doctor.diagnose({
			transactionId: TRANSACTION_ID,
		});

		expect(diagnosis).toMatchObject({
			state: "superseded",
			phase: "push_pending",
			finding: "lease_superseded",
			blocker: "lease_generation_stale",
			retrySafety: "operator_required",
			nextAction: { id: "request_operator_review" },
		});
		expect(diagnosis.repairAction).toBeUndefined();
		expect(fixture.atomicCloseCalls()).toBe(0);
	});

	test("repair revalidates the exact lease after Doctor and never calls atomicClose after takeover", async () => {
		let ledgerRead = 0;
		const fixture = await fixtureWithLedger(() => {
			ledgerRead += 1;
			return ledgerRead === 1 ? heldLedger() : takeoverLedger();
		});

		const result = await fixture.repair.run({
			action: "retry-push",
			transactionId: TRANSACTION_ID,
			remote: "origin",
			capability: OWNER_CAPABILITY,
		});

		expect(result).toMatchObject({
			status: "refused",
			state: "superseded",
			phase: "push_pending",
			blocker: "lease_generation_stale",
			changedState: "none",
			retrySafety: "operator_required",
			nextAction: { id: "request_operator_review" },
		});
		expect(ledgerRead).toBe(2);
		expect(fixture.events.slice(-2)).toEqual([
			"inspect-safety",
			"read-ledger",
		]);
		expect(fixture.atomicCloseCalls()).toBe(0);
	});

	test("repair revalidates activation after Doctor and lease probes before atomicClose", async () => {
		let ledgerRead = 0;
		let revoked = false;
		let activationValidations = 0;
		const order: string[] = [];
		const activationAuthority: VaultGitActivationValidationPort = {
			async validate() {
				activationValidations += 1;
				order.push("validate-activation");
				return revoked
					? { status: "revoked", evidenceId: "fixture" }
					: { status: "admitted", evidenceId: "fixture" };
			},
		};
		const fixture = await fixtureWithLedger(() => {
			ledgerRead += 1;
			order.push("read-ledger");
			if (ledgerRead === 2) revoked = true;
			return heldLedger();
		}, activationAuthority);

		const result = await fixture.repair.run({
			action: "retry-push",
			transactionId: TRANSACTION_ID,
			remote: "origin",
			capability: OWNER_CAPABILITY,
		});

		expect(result).toMatchObject({
			status: "refused",
			state: "push_pending",
			phase: "push_pending",
			blocker: "activation_blocked",
			changedState: "none",
			retrySafety: "operator_required",
			nextAction: { id: "prepare_fresh" },
			activationRestriction: { cause: { id: "revoked" } },
		});
		expect(activationValidations).toBe(1);
		expect(order).toEqual([
			"read-ledger",
			"read-ledger",
			"validate-activation",
		]);
		expect(fixture.atomicCloseCalls()).toBe(0);
	});

	test("repair preserves missing activation configuration after lease probes", async () => {
		const fixture = await fixtureWithLedger(
			() => heldLedger(),
			{
				async validate() {
					return {
						status: "denied",
						reason: "configuration_missing",
						missingConfiguration: ["ssh_known_hosts"],
					};
				},
			},
		);

		const result = await fixture.repair.run({
			action: "retry-push",
			transactionId: TRANSACTION_ID,
			remote: "origin",
			capability: OWNER_CAPABILITY,
		});

		expect(result).toMatchObject({
			status: "refused",
			blocker: "activation_blocked",
			retrySafety: "same_input_safe",
			activationRestriction: {
				cause: { id: "configuration_missing" },
				missingConfiguration: ["ssh_known_hosts"],
			},
		});
		expect(fixture.atomicCloseCalls()).toBe(0);
	});
});

async function fixtureWithLedger(
	currentLedger: () => ReturnType<typeof heldLedger>,
	activationAuthority: VaultGitActivationValidationPort = {
		validate: async () => ({ status: "admitted", evidenceId: "fixture" }),
	},
) {
	const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-takeover-"));
	roots.push(stateRoot);
	const store = createReceiptStore({
		stateRoot,
		repositoryIdentity: "canonical-vault",
	});
	await store.initialize(pushPendingReceipt(), {
		ownerCapability: OWNER_CAPABILITY,
		joinCapability: new Uint8Array([1, 2, 3]),
	});

	const events: string[] = [];
	let atomicCloseCalls = 0;
	const repository: VaultGitRepositoryPort = {
		async inspectSafety() {
			events.push("inspect-safety");
			return { status: "safe" };
		},
		async resolveCanonicalIdentity() {
			return { identity: "canonical-vault", localMainHead: CANDIDATE };
		},
		async inspectOwnedPaths() {
			throw new Error("not used");
		},
		async inspectLocalCommit() {
			events.push("inspect-local-commit");
			return {
				status: "ok",
				commitId: CANDIDATE,
				parents: [BASELINE],
				message: `docs(vault): record candidate\n\nVault-Transaction: ${TRANSACTION_ID}`,
			};
		},
	};
	const remote: VaultGitRemotePort = {
		async inspectMain() {
			throw new Error("not used");
		},
		async readLedger() {
			events.push("read-ledger");
			return currentLedger();
		},
		async appendLedgerCommit() {
			throw new Error("not used");
		},
		async reconcileAtomicClose() {
			events.push("reconcile");
			return { status: "unchanged" };
		},
		async atomicClose() {
			events.push("atomic-close");
			atomicCloseCalls += 1;
			return {
				status: "closed",
				mainCommit: CANDIDATE,
				ledgerCommit: RELEASE_COMMIT,
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
	const options = {
		store,
		repository,
		ledger: { git: remote, clock: runtime },
		runtime,
		repositoryIdentity: "canonical-vault",
		activationAuthority,
	};
	return {
		events,
		atomicCloseCalls: () => atomicCloseCalls,
		doctor: createVaultGitDoctor(options),
		repair: createVaultGitRepair(options),
	};
}

function heldLedger() {
	return {
		status: "ok" as const,
		head: {
			generation: LEASE_GENERATION,
			parents: [] as readonly string[],
			content: ledgerContent({
				operation: "acquire",
				previousGeneration: null,
				state: "held",
			}),
		},
	};
}

function takeoverLedger() {
	return {
		status: "ok" as const,
		head: {
			generation: TAKEOVER_GENERATION,
			parents: [LEASE_GENERATION] as readonly string[],
			content: ledgerContent({
				operation: "superseding_abandon",
				previousGeneration: LEASE_GENERATION,
				state: "released",
			}),
		},
	};
}

function ledgerContent(input: {
	operation: "acquire" | "superseding_abandon";
	previousGeneration: string | null;
	state: "held" | "released";
}): string {
	return `${JSON.stringify({
		schema_version: 1,
		operation: input.operation,
		previous_generation: input.previousGeneration,
		transitioned_at: "2026-08-09T00:00:01.000Z",
		...(input.operation === "superseding_abandon"
			? { superseding_actor: "operator" }
			: {}),
		lease: {
			transaction_id: TRANSACTION_ID,
			actor: "agent-a",
			host: "host-a",
			event: "note_created",
			owned_paths: ["notes/new.md"],
			local_main_head: BASELINE,
			remote_main_head: BASELINE,
			acquired_at: "2026-08-09T00:00:00.000Z",
			lease_duration_ms: 60_000,
			state: input.state,
		},
	})}\n`;
}

function pushPendingReceipt(): VaultGitReceipt {
	return {
		schemaVersion: 2,
		receiptId: `receipt_${"2".repeat(32)}`,
		transactionId: TRANSACTION_ID,
		revision: 1,
		phase: "push_pending",
		transition: "push_outcome_unknown",
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
		expectedLeaseGeneration: null,
		leaseGeneration: LEASE_GENERATION,
		leaseAcquiredAt: "2026-08-09T00:00:00.000Z",
		leaseDurationMs: 60_000,
		commitId: CANDIDATE,
		expectedMainCommit: CANDIDATE,
		// Completion persisted the local commit before the lease fence failed;
		// atomicClose never ran, so no prepared release object exists.
		ledgerReleaseId: null,
		pushOutcome: "unknown",
		nextSafeAction: "run_doctor",
		diagnosticsReference: `receipt:receipt_${"2".repeat(32)}`,
	};
}
