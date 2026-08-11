import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
	createVaultGitActivationAuthority,
	type VaultGitLiveActivationBindings,
} from "../src/activation-authority.ts";
import {
	createVaultGitTransactionEngine,
	type VaultGitTransactionEngineOptions,
} from "../src/engine.ts";
import {
	admitActivationForTest,
	admittedActivationAuthorityForTest,
	persistedActivationAuthorityForTest,
	preparedEvidenceForTest,
} from "./activation-fixture.ts";
import type {
	VaultGitAtomicPushCapability,
	VaultGitClockPort,
	VaultGitLedgerAppendRequest,
	VaultGitRemotePort,
	VaultGitRepositoryPort,
	VaultGitRuntimePort,
} from "../src/ports.ts";
import type { RemoteLease } from "../src/remote-ledger.ts";
import { createReceiptStore } from "../src/store.ts";

const roots: string[] = [];
const HEAD = "b".repeat(40);
const GENERATION = "a".repeat(40);

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("transaction engine lifecycle", () => {
	test("writes intent before CAS and won generation before granting owner authority", async () => {
		const fixture = await engineFixture();
		const observed: string[] = [];
		fixture.remote.onAppend = async () => {
			const loaded = await fixture.store.load();
			observed.push(loaded.status === "loaded" ? loaded.receipt.phase : loaded.status);
		};
		const result = await fixture.engine.begin({
			event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000,
		});
		expect(observed).toEqual(["intent_durable"]);
		expect(result).toMatchObject({ status: "admitted", state: "active", phase: "writing", writePermission: "owner" });
		expect(result.transactionId).toMatch(/^txn_[0-9a-f]{32}$/);
		const loaded = await fixture.store.load();
		expect(loaded).toMatchObject({ status: "loaded", receipt: { leaseGeneration: GENERATION, phase: "writing", revision: 3 } });
	});

	test("preserves an acquisition intent when interrupted before CAS", async () => {
		const fixture = await engineFixture("before_remote_cas");
		await expect(fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).rejects.toThrow("interrupt:before_remote_cas");
		expect(fixture.remote.appendCalls).toBe(0);
		expect(await fixture.store.load()).toMatchObject({ status: "loaded", receipt: { phase: "intent_durable", transactionId: null } });
	});

	test("preserves doctor-visible orphan evidence when interrupted after CAS", async () => {
		const fixture = await engineFixture("after_remote_cas");
		await expect(fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).rejects.toThrow("interrupt:after_remote_cas");
		expect(fixture.remote.appendCalls).toBe(1);
		expect(await fixture.engine.inspect()).toMatchObject({ state: "unknown", phase: "intent_durable", nextAction: { id: "inspect_remote_lease" } });
	});

	test("a fresh process on the same state root recovers the after-CAS orphan evidence", async () => {
		const fixture = await engineFixture("after_remote_cas");
		await expect(fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).rejects.toThrow("interrupt:after_remote_cas");
		const recoveredStore = createReceiptStore({ stateRoot: fixture.root, repositoryIdentity: "canonical-vault" });
		const recoveredRuntime = new FakeRuntime();
		const recoveredEngine = createVaultGitTransactionEngine({
			store: recoveredStore,
			repository: fixture.repository,
			ledger: { git: fixture.remote, clock: recoveredRuntime },
			runtime: recoveredRuntime,
			repositoryIdentity: "canonical-vault",
			activationAuthority: admittedActivationAuthorityForTest,
		});
		expect(await recoveredStore.load()).toMatchObject({
			status: "loaded",
			receipt: { phase: "intent_durable", transactionId: null },
		});
		expect(await recoveredEngine.inspect()).toMatchObject({ state: "unknown", phase: "intent_durable", nextAction: { id: "inspect_remote_lease" } });
	});

	test("persists the won generation before interruption can hide acknowledgement", async () => {
		const fixture = await engineFixture("before_won_generation_acknowledgement");
		await expect(fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).rejects.toThrow("interrupt:before_won_generation_acknowledgement");
		expect(await fixture.store.load()).toMatchObject({
			status: "loaded",
			receipt: { phase: "leased", leaseGeneration: GENERATION },
		});
	});

	test("offline begin leaves canonical and private transaction state absent", async () => {
		const fixture = await engineFixture();
		const result = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000, offline: true });
		expect(result).toMatchObject({ status: "refused", state: "absent", writePermission: "denied", changedState: "none" });
		expect(fixture.repository.admissionCalls).toBe(0);
		expect(fixture.remote.appendCalls).toBe(0);
		expect(await fixture.store.load()).toEqual({ status: "absent" });
	});

	for (const reason of ["dirty_worktree", "staged", "ignored", "symlink", "preexisting_untracked"] as const) {
		test(`rejects ${reason} owned paths before lease acquisition`, async () => {
			const fixture = await engineFixture();
			fixture.repository.refusal = reason;
			expect(await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).toMatchObject({
				status: "refused",
				blocker: "owned_path_not_admitted",
			});
			expect(fixture.remote.appendCalls).toBe(0);
			expect(await fixture.store.load()).toEqual({ status: "absent" });
		});
	}

	test("nested join extends admitted paths while owner-only actions reject the join role", async () => {
		const fixture = await engineFixture();
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const joinCapability = await fixture.store.readCapability(begun.receiptId, "join");
		const joined = await fixture.engine.join({ transactionId: begun.transactionId, requestedPaths: ["notes/child.md"], remote: "origin", capability: joinCapability });
		expect(joined).toMatchObject({ status: "joined", writePermission: "join" });
		const loaded = await fixture.store.load();
		if (loaded.status !== "loaded") throw new Error("receipt missing");
		expect(loaded.receipt.ownedPaths.map((entry) => entry.path)).toEqual(["notes/new.md", "notes/child.md"]);
		await expect(fixture.engine.complete({ transactionId: begun.transactionId, remote: "origin", capability: joinCapability })).resolves.toMatchObject({ status: "refused", blocker: "capability_role_mismatch" });
	});

	test("re-proves canonical identity, main alignment, and lease generation at write-capable phases", async () => {
		const fixture = await engineFixture();
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");
		fixture.repository.identity = "replacement-vault";
		const completed = await fixture.engine.complete({ transactionId: begun.transactionId, remote: "origin", capability: owner });
		expect(completed).toMatchObject({ status: "refused", state: "human_required", blocker: "vault_identity_changed" });
	});

	test("join refuses after canonical identity drift without extending owned paths", async () => {
		const fixture = await engineFixture();
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const joinCapability = await fixture.store.readCapability(begun.receiptId, "join");
		fixture.repository.identity = "replacement-vault";
		expect(await fixture.engine.join({ transactionId: begun.transactionId, requestedPaths: ["notes/child.md"], remote: "origin", capability: joinCapability })).toMatchObject({
			status: "refused",
			state: "human_required",
			blocker: "vault_identity_changed",
		});
		const loaded = await fixture.store.load();
		if (loaded.status !== "loaded") throw new Error("receipt missing");
		expect(loaded.receipt.ownedPaths.map((entry) => entry.path)).toEqual(["notes/new.md"]);
	});

	test("classifies absent, active, expired, superseded, unknown, push_pending, repairable, human-required, and closed", async () => {
		const fixture = await engineFixture();
		expect((await fixture.engine.inspect()).state).toBe("absent");
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");
		expect((await fixture.engine.inspect()).state).toBe("active");
		fixture.runtime.nowValue = new Date("2026-08-09T00:02:00.000Z");
		expect((await fixture.engine.inspect()).state).toBe("expired");
		fixture.runtime.nowValue = new Date("2026-08-09T00:00:01.000Z");
		fixture.remote.generation = "c".repeat(40);
		expect((await fixture.engine.inspect()).state).toBe("superseded");
		fixture.remote.failReads = true;
		expect((await fixture.engine.inspect()).state).toBe("unknown");
		fixture.remote.failReads = false;
		fixture.remote.generation = GENERATION;

		for (const [phase, expected] of [["push_pending", "push_pending"], ["repairable", "repairable"], ["human_required", "human_required"]] as const) {
			await fixture.engine.recordPhase({ phase, transactionId: begun.transactionId, remote: "origin", capability: owner, nextSafeAction: "inspect_status" });
			expect((await fixture.engine.inspect()).state).toBe(expected);
		}
	});

	test("recordPhase refuses closed because it carries no atomic-close proof", async () => {
		const fixture = await engineFixture();
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");
		expect(await fixture.engine.recordPhase({ phase: "closed", transactionId: begun.transactionId, remote: "origin", capability: owner, nextSafeAction: "none" })).toMatchObject({
			status: "refused",
			blocker: "receipt_conflict",
			nextAction: { id: "inspect_status" },
		});
		// The receipt must stay non-terminal so doctor and repair can still
		// reconcile it, and the remote lease must stay owned rather than
		// stranded behind a local receipt that claims to be finished.
		const loaded = await fixture.store.load();
		if (loaded.status !== "loaded") throw new Error("receipt missing");
		expect(loaded.receipt.phase).toBe("writing");
		expect(loaded.receipt.commitId ?? null).toBeNull();
		expect((await fixture.engine.inspect()).state).toBe("active");

		// The refusal precedes fencing, so an unreachable remote still reports
		// the unsupported transition rather than a transport or lease blocker.
		fixture.remote.failReads = true;
		expect(await fixture.engine.recordPhase({ phase: "closed", transactionId: begun.transactionId, remote: "origin", capability: owner, nextSafeAction: "none" })).toMatchObject({
			status: "refused",
			blocker: "receipt_conflict",
		});
	});

	test("recordPhase refuses the join capability with a role mismatch", async () => {
		const fixture = await engineFixture();
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const joinCapability = await fixture.store.readCapability(begun.receiptId, "join");
		expect(await fixture.engine.recordPhase({ phase: "closed", transactionId: begun.transactionId, remote: "origin", capability: joinCapability, nextSafeAction: "none" })).toMatchObject({
			status: "refused",
			blocker: "capability_role_mismatch",
			nextAction: { id: "use_owner_capability" },
		});
		const loaded = await fixture.store.load();
		expect(loaded).toMatchObject({ status: "loaded", receipt: { phase: "writing" } });
	});

	test("refuses a secret-like actor label before any lease or receipt exists", async () => {
		const fixture = await engineFixture();
		fixture.runtime.actorValue = "token=super-secret";
		expect(await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).toMatchObject({
			status: "refused",
			state: "absent",
			blocker: "identity_label_invalid",
			changedState: "none",
		});
		expect(fixture.remote.appendCalls).toBe(0);
		expect(await fixture.store.load()).toEqual({ status: "absent" });
	});

	test("refuses a private-path host label before any lease or receipt exists", async () => {
		const fixture = await engineFixture();
		fixture.runtime.hostValue = "/Users/example/private-host";
		expect(await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).toMatchObject({
			status: "refused",
			blocker: "identity_label_invalid",
		});
		expect(fixture.remote.appendCalls).toBe(0);
		expect(await fixture.store.load()).toEqual({ status: "absent" });
	});

	test("recordPhase never introduces commit evidence or breaks receipt invariants", async () => {
		const fixture = await engineFixture();
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");
		// `closed` is excluded deliberately: it is refused here because it would
		// need the atomic-close evidence this transition never carries.
		for (const phase of ["push_pending", "repairable", "human_required"] as const) {
			const recorded = await fixture.engine.recordPhase({ phase, transactionId: begun.transactionId, remote: "origin", capability: owner, nextSafeAction: "inspect_status" });
			expect(recorded.status).toBe("advanced");
			const loaded = await fixture.store.load();
			if (loaded.status !== "loaded") throw new Error(`receipt ${loaded.status} after ${phase}`);
			expect(loaded.receipt).toMatchObject({
				phase,
				commitId: null,
				expectedMainCommit: null,
				ledgerReleaseId: null,
				pushOutcome: "not_attempted",
			});
		}
	});

	test("re-admits after a refused acquisition once the remote contention clears", async () => {
		const fixture = await engineFixture();
		const heldGeneration = "d".repeat(40);
		const heldLease = foreignLease();
		fixture.remote.generation = heldGeneration;
		fixture.remote.lease = heldLease;
		const refused = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		expect(refused).toMatchObject({
			status: "refused",
			blocker: "lease_active",
			phase: "blocked",
			changedState: "local",
			retrySafety: "same_input_safe",
			nextAction: { id: "retry_remote" },
		});
		fixture.remote.lease = { ...heldLease, state: "released" };
		fixture.remote.generation = "e".repeat(40);
		fixture.remote.parents = [heldGeneration];
		const readmitted = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		expect(readmitted).toMatchObject({ status: "admitted", state: "active", phase: "writing", writePermission: "owner" });
	});

	test("join refuses once the transaction leaves the writing phase", async () => {
		const fixture = await engineFixture();
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");
		const joinCapability = await fixture.store.readCapability(begun.receiptId, "join");
		await fixture.engine.recordPhase({ phase: "human_required", transactionId: begun.transactionId, remote: "origin", capability: owner, nextSafeAction: "request_operator_review" });
		expect(await fixture.engine.join({ transactionId: begun.transactionId, requestedPaths: ["notes/child.md"], remote: "origin", capability: joinCapability })).toMatchObject({
			status: "refused",
			blocker: "receipt_conflict",
			phase: "human_required",
			nextAction: { id: "inspect_status" },
		});
	});

	test("re-joining an already-owned dirty path skips re-admission of that path", async () => {
		const fixture = await engineFixture();
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const joinCapability = await fixture.store.readCapability(begun.receiptId, "join");
		fixture.repository.dirtyPaths.add("notes/new.md");
		const joined = await fixture.engine.join({ transactionId: begun.transactionId, requestedPaths: ["notes/new.md", "notes/child.md"], remote: "origin", capability: joinCapability });
		expect(joined).toMatchObject({ status: "joined", writePermission: "join" });
		expect(fixture.repository.lastRequested).toEqual(["notes/child.md"]);
		const loaded = await fixture.store.load();
		if (loaded.status !== "loaded") throw new Error("receipt missing");
		expect(loaded.receipt.ownedPaths.map((entry) => entry.path)).toEqual(["notes/new.md", "notes/child.md"]);
		const admissionCalls = fixture.repository.admissionCalls;
		expect(await fixture.engine.join({ transactionId: begun.transactionId, requestedPaths: ["notes/new.md"], remote: "origin", capability: joinCapability })).toMatchObject({ status: "joined", changedState: "none" });
		expect(fixture.repository.admissionCalls).toBe(admissionCalls);
	});

	test("binds the admission remote into the receipt and inspects through it", async () => {
		const fixture = await engineFixture();
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "backup", leaseDurationMs: 60_000 });
		expect(begun.status).toBe("admitted");
		const loaded = await fixture.store.load();
		expect(loaded).toMatchObject({ status: "loaded", receipt: { remote: "backup" } });
		// Object.assign keeps TypeScript from narrowing the property to null.
		Object.assign(fixture.remote, { lastObservedRemote: null });
		expect((await fixture.engine.inspect()).state).toBe("active");
		expect(fixture.remote.lastObservedRemote).toBe("backup");
	});

	test("begin refuses while quarantine or takeover-pending markers fence the host", async () => {
		const fixture = await engineFixture();
		const marker = {
			transactionId: `txn_${"9".repeat(32)}`,
			ledgerGeneration: "a".repeat(40),
			recordedAt: "2026-08-09T00:00:00.000Z",
		} as const;
		await fixture.store.recordQuarantine({ ...marker, status: "quarantined" });
		expect(await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).toMatchObject({
			status: "refused",
			state: "superseded",
			phase: "human_required",
			blocker: "host_quarantined",
			nextAction: { id: "reconcile_quarantine" },
		});
		await fixture.store.recordQuarantine({ ...marker, status: "takeover_pending", recordedAt: "2026-08-09T00:00:01.000Z" });
		expect(await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).toMatchObject({
			status: "refused",
			state: "superseded",
			phase: "human_required",
			blocker: "host_quarantined",
			nextAction: { id: "run_doctor" },
		});
		expect(fixture.remote.appendCalls).toBe(0);
		expect(await fixture.store.load()).toEqual({ status: "absent" });
	});

	test("classifies terminal phases from local facts while the remote is down", async () => {
		const fixture = await engineFixture();
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");
		await fixture.engine.recordPhase({ phase: "human_required", transactionId: begun.transactionId, remote: "origin", capability: owner, nextSafeAction: "request_operator_review" });
		fixture.remote.failReads = true;
		expect(await fixture.engine.inspect()).toMatchObject({ state: "human_required", phase: "human_required" });
	});

	for (const reason of ["timed_out", "remote_unavailable"] as const) {
		test(`begin refuses with remote_unavailable when the atomic probe fails with ${reason}`, async () => {
			const fixture = await engineFixture();
			fixture.remote.probeResult = { status: "failed", reason };
			expect(await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).toMatchObject({
				status: "refused",
				state: "absent",
				blocker: "remote_unavailable",
				changedState: "none",
			});
			expect(fixture.remote.appendCalls).toBe(0);
			expect(await fixture.store.load()).toEqual({ status: "absent" });
		});
	}

	test("begin fails closed when the composed remote omits probeAtomicPush", async () => {
		const fixture = await engineFixture();
		Object.assign(fixture.remote, { probeAtomicPush: undefined });
		expect(await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).toMatchObject({
			status: "refused",
			state: "absent",
			blocker: "host_contract_breach",
			changedState: "none",
			nextAction: { id: "request_operator_review" },
		});
		expect(fixture.remote.appendCalls).toBe(0);
		expect(await fixture.store.load()).toEqual({ status: "absent" });
	});

	test("begin fails closed when the composed repository omits inspectSafety", async () => {
		const fixture = await engineFixture();
		Object.assign(fixture.repository, { inspectSafety: undefined });
		expect(await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).toMatchObject({
			status: "refused",
			blocker: "host_contract_breach",
			changedState: "none",
			nextAction: { id: "request_operator_review" },
		});
		expect(fixture.remote.appendCalls).toBe(0);
		expect(await fixture.store.load()).toEqual({ status: "absent" });
	});

	test("refuses write commands with activation_blocked until an operator admits activation", async () => {
		const fixture = await engineFixture(undefined, { admitActivation: false });
		const refusedBegin = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		expect(refusedBegin).toMatchObject({
			status: "refused",
			phase: "blocked",
			blocker: "activation_blocked",
			retrySafety: "same_input_safe",
			nextAction: { id: "request_operator_admission" },
			activationRestriction: {
				cause: { id: "admission_missing" },
				nextAction: { id: "review_prepared" },
			},
		});
		expect(fixture.remote.appendCalls).toBe(0);
		expect(await fixture.store.load()).toEqual({ status: "absent" });
		// Status and doctor surface the same blocker read-only.
		expect(await fixture.engine.inspect()).toMatchObject({ status: "inspected", blocker: "activation_blocked", writePermission: "denied" });
		expect(await fixture.engine.doctor()).toMatchObject({ status: "diagnosed", finding: "activation_missing", blocker: "activation_blocked" });
		expect(await fixture.engine.inspectJanitorPreflight("origin")).toMatchObject({ status: "refused", blocker: "activation_blocked" });
		// Admission is the only gate: the exact same input succeeds afterwards.
		await admitActivationForTest(fixture.store);
		expect(await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).toMatchObject({ status: "admitted" });
	});

	for (const [reason, restrictionNextAction] of [
		["evidence_changed", "prepare_fresh"],
		["binding_changed", "prepare_fresh"],
		["revoked", "prepare_fresh"],
		["revalidation_unavailable", "run_doctor"],
	] as const) {
		test(`preserves ${reason} activation restriction semantics`, async () => {
			const fixture = await engineFixture(undefined, {
				activationAuthority: {
					async validate() {
						return { status: "denied" as const, reason };
					},
				},
			});

			expect(
				await fixture.engine.begin({
					event: "note_created",
					requestedPaths: ["notes/new.md"],
					remote: "origin",
					leaseDurationMs: 60_000,
				}),
			).toMatchObject({
				status: "refused",
				blocker: "activation_blocked",
				nextAction: { id: "request_operator_admission" },
				activationRestriction: {
					cause: { id: reason },
					nextAction: { id: restrictionNextAction },
				},
			});
		});
	}

	test("maps activation validation throws to revalidation_unavailable", async () => {
		const fixture = await engineFixture(undefined, {
			activationAuthority: {
				async validate() {
					throw new Error("fixture private-state failure");
				},
			},
		});

		expect(
			await fixture.engine.begin({
				event: "note_created",
				requestedPaths: ["notes/new.md"],
				remote: "origin",
				leaseDurationMs: 60_000,
			}),
		).toMatchObject({
			status: "refused",
			blocker: "activation_blocked",
			nextAction: { id: "request_operator_admission" },
			activationRestriction: {
				cause: { id: "revalidation_unavailable" },
				nextAction: { id: "run_doctor" },
			},
		});
	});

	test("uses live activation authority even when a persisted admission exists", async () => {
		let admitted = false;
		let validations = 0;
		const fixture = await engineFixture(undefined, {
			activationAuthority: {
				async validate() {
					validations += 1;
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "denied" as const, reason: "binding_changed" as const };
				},
			},
		});
		const input = { event: "note_created" as const, requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 };

		expect(await fixture.engine.begin(input)).toMatchObject({
			status: "refused",
			blocker: "activation_blocked",
		});
		expect(validations).toBe(1);
		admitted = true;
		expect(await fixture.engine.begin(input)).toMatchObject({ status: "admitted" });
		expect(validations).toBe(2);
	});

	test("begin and complete use the real authority across transaction-owned ledger movement", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-engine-authority-"));
		roots.push(root);
		const evidence = preparedEvidenceForTest({
			localMainHead: HEAD,
			remoteMainHead: HEAD,
			ledgerGeneration: "0".repeat(40),
		});
		const store = createReceiptStore({
			stateRoot: root,
			repositoryIdentity: "canonical-vault",
		});
		await store.publishPreparedEvidence(evidence);
		let live: VaultGitLiveActivationBindings = activationBindings(evidence);
		const humanCapability = new Uint8Array([9, 1]);
		const authority = createVaultGitActivationAuthority({
			store,
			clock: () => "2026-08-09T00:00:00.000Z",
			validateHumanCapability: async (candidate) =>
				candidate.length === humanCapability.length &&
				candidate.every((byte, index) => byte === humanCapability[index]),
			revalidate: async () => live,
		});
		await authority.admit({
			evidenceId: evidence.evidenceId,
			humanCapability,
			note: "fixture review",
		});
		const scopes: string[] = [];
		const repository = new FakeRepository();
		const remote = new FakeRemote();
		const runtime = new FakeRuntime();
		remote.onAppend = async () => {
			live = { ...live, ledgerGeneration: GENERATION };
		};
		const engine = createVaultGitTransactionEngine({
			store,
			repository,
			ledger: { git: remote, clock: runtime },
			runtime,
			repositoryIdentity: "canonical-vault",
			activationAuthority: {
				async validate(scope) {
					scopes.push(scope ?? "admission");
					return authority.validate(scope);
				},
			},
		});

		const begun = await engine.begin({
			event: "note_created",
			requestedPaths: ["notes/new.md"],
			remote: "origin",
			leaseDurationMs: 60_000,
		});
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) {
			throw new Error("begin failed");
		}
		const owner = await store.readCapability(begun.receiptId, "owner");
		expect(
			await engine.complete({
				transactionId: begun.transactionId,
				remote: "origin",
				capability: owner,
			}),
		).toMatchObject({ status: "advanced", phase: "checking" });
		expect(scopes).toEqual(["admission", "continuation"]);
	});
});

function activationBindings(
	evidence: ReturnType<typeof preparedEvidenceForTest>,
): VaultGitLiveActivationBindings {
	return {
		repositoryIdentity: evidence.repositoryIdentity,
		remoteIdentity: evidence.remoteIdentity,
		hostIdentity: evidence.hostIdentity,
		runtimeIdentity: evidence.runtimeIdentity,
		executableIdentity: evidence.executableIdentity,
		privateStateIdentity: evidence.privateStateIdentity,
		localMainHead: evidence.localMainHead,
		remoteMainHead: evidence.remoteMainHead,
		ledgerGeneration: evidence.ledgerGeneration,
		gitIdentity: evidence.gitIdentity,
		sshIdentity: evidence.sshIdentity,
		checkerClosure: evidence.checkerClosure,
	};
}

async function engineFixture(interruptAt?: string, options: {
	admitActivation?: boolean;
	activationAuthority?: VaultGitTransactionEngineOptions["activationAuthority"];
} = {}) {
	const root = await mkdtemp(join(tmpdir(), "vault-git-engine-"));
	roots.push(root);
	const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "canonical-vault" });
	if (options.admitActivation !== false) await admitActivationForTest(store);
	const repository = new FakeRepository();
	const remote = new FakeRemote();
	const runtime = new FakeRuntime(interruptAt);
	const engine = createVaultGitTransactionEngine({ store, repository, ledger: { git: remote, clock: runtime }, runtime, repositoryIdentity: "canonical-vault", activationAuthority: options.activationAuthority ?? persistedActivationAuthorityForTest(store) });
	return { root, store, repository, remote, runtime, engine };
}

class FakeRuntime implements VaultGitRuntimePort, VaultGitClockPort {
	nowValue = new Date("2026-08-09T00:00:01.000Z");
	actorValue = "agent-a";
	hostValue = "laptop";
	private receiptCounter = 0;
	constructor(private readonly interruptAt?: string) {}
	now(): Date { return new Date(this.nowValue); }
	actor(): string { return this.actorValue; }
	host(): string { return this.hostValue; }
	newReceiptId(): string {
		this.receiptCounter += 1;
		return `receipt_${String(this.receiptCounter).padStart(32, "0")}`;
	}
	interrupt(point: string): void { if (point === this.interruptAt) throw new Error(`interrupt:${point}`); }
}

class FakeRepository implements VaultGitRepositoryPort {
	identity = "canonical-vault";
	admissionCalls = 0;
	lastRequested: readonly string[] = [];
	readonly dirtyPaths = new Set<string>();
	refusal: "dirty_worktree" | "staged" | "ignored" | "symlink" | "preexisting_untracked" | null = null;
	// Write-capable engine phases fail closed without this proof (fix: engine
	// probes are mandatory on composed ports), so the fake provides it.
	inspectSafety: VaultGitRepositoryPort["inspectSafety"] = async () => ({ status: "safe" as const });
	async resolveCanonicalIdentity() { return { identity: this.identity, localMainHead: HEAD }; }
	async inspectOwnedPaths(paths: readonly string[]) {
		this.admissionCalls += 1;
		this.lastRequested = [...paths];
		if (this.refusal) return { status: "refused" as const, reason: this.refusal };
		if (paths.some((path) => this.dirtyPaths.has(path))) return { status: "refused" as const, reason: "dirty_worktree" as const };
		return {
			status: "admitted" as const,
			paths: paths.map((path) => ({ path, baselineHash: null, admittedNewFile: true })),
			unrelatedState: { statusHex: "", indexHex: "" },
		};
	}
}

class FakeRemote implements VaultGitRemotePort {
	generation: string | null = null;
	parents: string[] = [];
	appendCalls = 0;
	failReads = false;
	lastObservedRemote: string | null = null;
	onAppend?: () => Promise<void>;
	lease: RemoteLease | null = null;
	probeResult: VaultGitAtomicPushCapability = { status: "supported" };
	probeAtomicPush: VaultGitRemotePort["probeAtomicPush"] = async () => this.probeResult;
	async inspectMain() { return { status: "ok" as const, alignment: "aligned" as const, localHead: HEAD, remoteHead: HEAD }; }
	async readLedger(remote: string) {
		this.lastObservedRemote = remote;
		if (this.failReads) return { status: "failed" as const, reason: "remote_unavailable" as const };
		if (!this.generation || !this.lease) return { status: "ok" as const, head: null };
		return { status: "ok" as const, head: { generation: this.generation, parents: [...this.parents], content: ledgerContent(this.lease, this.parents) } };
	}
	async appendLedgerCommit(request: VaultGitLedgerAppendRequest) {
		this.appendCalls += 1;
		await this.onAppend?.();
		const document = JSON.parse(request.content);
		this.generation = GENERATION;
		this.lease = {
			transactionId: document.lease.transaction_id,
			actor: document.lease.actor, host: document.lease.host, event: document.lease.event,
			ownedPaths: document.lease.owned_paths, localMainHead: document.lease.local_main_head,
			remoteMainHead: document.lease.remote_main_head, acquiredAt: document.lease.acquired_at,
			leaseDurationMs: document.lease.lease_duration_ms, state: document.lease.state,
		};
		return { status: "appended" as const, generation: GENERATION };
	}
}

function foreignLease(): RemoteLease {
	return {
		transactionId: `txn_${"f".repeat(32)}`,
		actor: "agent-b",
		host: "mac-mini",
		event: "note_created",
		ownedPaths: ["notes/other.md"],
		localMainHead: HEAD,
		remoteMainHead: HEAD,
		acquiredAt: "2026-08-09T00:00:00.000Z",
		leaseDurationMs: 60_000,
		state: "held",
	};
}

function ledgerContent(lease: RemoteLease, parents: readonly string[] = []): string {
	return JSON.stringify({ schema_version: 1, operation: lease.state === "released" ? "release" : "acquire", previous_generation: parents[0] ?? null, transitioned_at: lease.acquiredAt, lease: { transaction_id: lease.transactionId, actor: lease.actor, host: lease.host, event: lease.event, owned_paths: lease.ownedPaths, local_main_head: lease.localMainHead, remote_main_head: lease.remoteMainHead, acquired_at: lease.acquiredAt, lease_duration_ms: lease.leaseDurationMs, state: lease.state } });
}
