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
import {
	VaultRepositoryIdentityUnavailableError,
	type VaultGitAtomicPushCapability,
	type VaultGitCheckPort,
	type VaultGitClockPort,
	type VaultGitLedgerAppendRequest,
	type VaultGitRemotePort,
	type VaultGitRepositoryPort,
	type VaultGitRuntimePort,
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

	test("takeover during joined-state capture prevents the joined receipt append", async () => {
		const fixture = await engineFixture();
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const joinCapability = await fixture.store.readCapability(begun.receiptId, "join");
		const captureStarted = deferred<void>();
		const releaseCapture = deferred<void>();
		fixture.repository.onCapture = async () => {
			captureStarted.resolve();
			await releaseCapture.promise;
		};
		const pending = fixture.engine.join({
			transactionId: begun.transactionId,
			requestedPaths: ["notes/child.md"],
			remote: "origin",
			capability: joinCapability,
		});
		await captureStarted.promise;
		fixture.remote.generation = "c".repeat(40);
		fixture.remote.lease = foreignLease();
		releaseCapture.resolve();

		expect(await pending).toMatchObject({
			status: "refused",
			state: "superseded",
			blocker: "lease_generation_stale",
		});
		expect(await fixture.store.load()).toMatchObject({
			status: "loaded",
			receipt: {
				phase: "writing",
				ownedPaths: [{ path: "notes/new.md" }],
			},
		});
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

	test("Janitor preflight classifies unsafe remote configuration as a host breach", async () => {
		const fixture = await engineFixture();
		fixture.remote.refuseInspection = true;

		expect(await fixture.engine.inspectJanitorPreflight("origin")).toMatchObject({
			status: "refused",
			blocker: "host_contract_breach",
		});
	});

	test("refuses write commands with activation_blocked until an operator admits activation", async () => {
		const fixture = await engineFixture(undefined, { admitActivation: false });
		const refusedBegin = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		expect(refusedBegin).toMatchObject({
			status: "refused",
			phase: "blocked",
			blocker: "activation_blocked",
			retrySafety: "same_input_safe",
			nextAction: { id: "review_prepared" },
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

	for (const [reason, restrictionNextAction, retrySafety] of [
		["human_capability_required", "return_to_human_review", "operator_required"],
		["evidence_changed", "prepare_fresh", "same_input_unsafe"],
		["binding_changed", "prepare_fresh", "same_input_unsafe"],
		["invalidated", "prepare_fresh", "same_input_unsafe"],
		["revoked", "prepare_fresh", "operator_required"],
		["revalidation_unavailable", "run_doctor", "same_input_safe"],
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
				retrySafety,
				nextAction: { id: restrictionNextAction },
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
			retrySafety: "same_input_safe",
			nextAction: { id: "run_doctor" },
			activationRestriction: {
				cause: { id: "revalidation_unavailable" },
				nextAction: { id: "run_doctor" },
			},
		});
	});

	test("maps write-phase repository identity outages to retry-safe activation refusal", async () => {
		const fixture = await engineFixture();
		fixture.repository.identityError =
			new VaultRepositoryIdentityUnavailableError();

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
			retrySafety: "same_input_safe",
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
		expect(validations).toBe(3);
	});

	test("revocation during the atomic probe prevents a later write-authority grant", async () => {
		let admitted = true;
		const probeStarted = deferred<void>();
		const releaseProbe = deferred<void>();
		const fixture = await engineFixture(undefined, {
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		fixture.remote.onProbe = async () => {
			probeStarted.resolve();
			await releaseProbe.promise;
		};
		const pending = fixture.engine.begin({
			event: "note_created",
			requestedPaths: ["notes/new.md"],
			remote: "origin",
			leaseDurationMs: 60_000,
		});
		await probeStarted.promise;
		admitted = false;
		releaseProbe.resolve();

		expect(await pending).toMatchObject({
			status: "refused",
			state: "closed",
			phase: "closed",
			writePermission: "denied",
			changedState: "remote",
			blocker: "activation_blocked",
			nextAction: { id: "prepare_fresh" },
		});
		expect(await fixture.store.load()).toMatchObject({
			status: "loaded",
			receipt: { phase: "closed" },
		});
		expect(fixture.remote.lease).toMatchObject({ state: "released" });
	});

	test("receipt-backed activation denial preserves transaction and lease posture on every read surface", async () => {
		let admitted = true;
		const fixture = await engineFixture(undefined, {
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		const begun = await fixture.engine.begin({
			event: "note_created",
			requestedPaths: ["notes/new.md"],
			remote: "origin",
			leaseDurationMs: 60_000,
		});
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) {
			throw new Error("begin failed");
		}
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");
		admitted = false;

		const inspected = await fixture.engine.inspect();
		const diagnosed = await fixture.engine.doctor();
		const refusedCompletion = await fixture.engine.complete({
			transactionId: begun.transactionId,
			remote: "origin",
			capability: owner,
		});
		for (const read of [inspected, diagnosed, refusedCompletion]) {
			expect(read).toMatchObject({
				phase: "writing",
				transactionId: begun.transactionId,
				changedState: "none",
				blocker: "activation_blocked",
				nextAction: { id: "prepare_fresh" },
				activationRestriction: {
					cause: { id: "revoked" },
					nextAction: { id: "prepare_fresh" },
				},
			});
		}
		expect(inspected.state).toBe("active");
		expect(diagnosed).toMatchObject({
			state: "repairable",
			finding: "writes_in_progress",
		});
		expect(refusedCompletion).toMatchObject({
			status: "refused",
			state: "active",
			writePermission: "denied",
		});
	});

	test("activation-denied Doctor does not issue takeover material for an expired receipt", async () => {
		let admitted = true;
		const fixture = await engineFixture(undefined, {
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		expect(await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 })).toMatchObject({ status: "admitted" });
		fixture.runtime.nowValue = new Date("2026-08-09T00:02:00.000Z");
		admitted = false;

		const diagnosed = await fixture.engine.doctor();
		expect(diagnosed).toMatchObject({
			status: "diagnosed",
			state: "expired",
			phase: "writing",
			changedState: "none",
			blocker: "activation_blocked",
			nextAction: { id: "prepare_fresh" },
		});
		expect("takeoverTokenIssued" in diagnosed).toBe(false);
	});

	test("revocation during the checker prevents local commit and remote close", async () => {
		let admitted = true;
		const checkStarted = deferred<void>();
		const releaseCheck = deferred<void>();
		const check: VaultGitCheckPort = {
			async run() {
				checkStarted.resolve();
				await releaseCheck.promise;
				return { status: "passed" };
			},
		};
		const fixture = await engineFixture(undefined, {
			check,
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");
		const pending = fixture.engine.complete({
			transactionId: begun.transactionId,
			remote: "origin",
			capability: owner,
			summary: "docs(vault): record admitted note",
		});
		await checkStarted.promise;
		admitted = false;
		releaseCheck.resolve();

		expect(await pending).toMatchObject({
			status: "refused",
			phase: "committing",
			changedState: "local",
			blocker: "activation_blocked",
			nextAction: { id: "prepare_fresh" },
		});
		expect(fixture.repository.commitExactCalls).toBe(0);
		expect(fixture.remote.atomicCloseCalls).toBe(0);
	});

	test("takeover during the checker prevents a stale local commit", async () => {
		const checkStarted = deferred<void>();
		const releaseCheck = deferred<void>();
		const fixture = await engineFixture(undefined, {
			check: {
				async run() {
					checkStarted.resolve();
					await releaseCheck.promise;
					return { status: "passed" };
				},
			},
		});
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");
		const pending = fixture.engine.complete({
			transactionId: begun.transactionId,
			remote: "origin",
			capability: owner,
			summary: "docs(vault): record admitted note",
		});
		await checkStarted.promise;
		fixture.remote.generation = "c".repeat(40);
		fixture.remote.lease = foreignLease();
		releaseCheck.resolve();

		expect(await pending).toMatchObject({
			status: "refused",
			state: "superseded",
			phase: "committing",
			changedState: "local",
			blocker: "lease_generation_stale",
		});
		expect(fixture.repository.commitExactCalls).toBe(0);
		expect(fixture.remote.atomicCloseCalls).toBe(0);
	});

	test("revocation after local commit preserves commit evidence and prevents remote close", async () => {
		let admitted = true;
		const fixture = await engineFixture(undefined, {
			check: { async run() { return { status: "passed" }; } },
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		fixture.repository.onCommit = async () => {
			admitted = false;
		};
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");

		expect(await fixture.engine.complete({
			transactionId: begun.transactionId,
			remote: "origin",
			capability: owner,
			summary: "docs(vault): record admitted note",
		})).toMatchObject({
			status: "refused",
			state: "push_pending",
			phase: "push_pending",
			changedState: "committed",
			blocker: "activation_blocked",
			nextAction: { id: "prepare_fresh" },
			activationRestriction: {
				observedSafeState: "A local commit is preserved; remote publication did not start.",
				changedState: "committed",
			},
		});
		expect(fixture.repository.commitExactCalls).toBe(1);
		expect(fixture.remote.atomicCloseCalls).toBe(0);
		expect(await fixture.store.load()).toMatchObject({
			status: "loaded",
			receipt: { phase: "push_pending", commitId: "c".repeat(40) },
		});
	});

	test("takeover after local commit preserves commit evidence and prevents remote close", async () => {
		const fixture = await engineFixture(undefined, {
			check: { async run() { return { status: "passed" }; } },
		});
		fixture.repository.onCommit = async () => {
			fixture.remote.generation = "d".repeat(40);
			fixture.remote.lease = foreignLease();
		};
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");

		expect(await fixture.engine.complete({
			transactionId: begun.transactionId,
			remote: "origin",
			capability: owner,
			summary: "docs(vault): record admitted note",
		})).toMatchObject({
			status: "refused",
			state: "superseded",
			phase: "push_pending",
			changedState: "committed",
			blocker: "lease_generation_stale",
		});
		expect(fixture.repository.commitExactCalls).toBe(1);
		expect(fixture.remote.atomicCloseCalls).toBe(0);
	});

	test("revocation during the final begin fence denies owner authority and releases the lease", async () => {
		let admitted = true;
		const fixture = await engineFixture(undefined, {
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		let safetyReads = 0;
		fixture.repository.onSafety = async () => {
			safetyReads += 1;
			if (safetyReads === 2) admitted = false;
		};

		expect(
			await fixture.engine.begin({
				event: "note_created",
				requestedPaths: ["notes/new.md"],
				remote: "origin",
				leaseDurationMs: 60_000,
			}),
		).toMatchObject({
			status: "refused",
			state: "closed",
			phase: "closed",
			blocker: "activation_blocked",
			writePermission: "denied",
		});
		expect(await fixture.store.load()).toMatchObject({
			status: "loaded",
			receipt: { phase: "closed" },
		});
		expect(fixture.remote.lease).toMatchObject({ state: "released" });
	});

	test("a refused activation handback records the still-held lease for operator review", async () => {
		let admitted = true;
		const fixture = await engineFixture(undefined, {
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		let safetyReads = 0;
		fixture.repository.onSafety = async () => {
			safetyReads += 1;
			if (safetyReads === 2) admitted = false;
		};
		fixture.remote.refuseRelease = true;

		expect(
			await fixture.engine.begin({
				event: "note_created",
				requestedPaths: ["notes/new.md"],
				remote: "origin",
				leaseDurationMs: 60_000,
			}),
		).toMatchObject({
			status: "refused",
			state: "human_required",
			phase: "human_required",
			blocker: "remote_unavailable",
			retrySafety: "operator_required",
			nextAction: { id: "request_operator_review" },
		});
		expect(await fixture.store.load()).toMatchObject({
			status: "loaded",
			receipt: {
				phase: "human_required",
				nextSafeAction: "request_operator_review",
			},
		});
		expect(fixture.remote.lease).toMatchObject({ state: "held" });
	});

	test("revocation during the final join fence denies new path authority", async () => {
		let admitted = true;
		const fixture = await engineFixture(undefined, {
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		const begun = await fixture.engine.begin({
			event: "note_created",
			requestedPaths: ["notes/new.md"],
			remote: "origin",
			leaseDurationMs: 60_000,
		});
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) {
			throw new Error("begin failed");
		}
		const joinCapability = await fixture.store.readCapability(
			begun.receiptId,
			"join",
		);
		let joinFenceReads = 0;
		fixture.repository.onSafety = async () => {
			joinFenceReads += 1;
			if (joinFenceReads === 2) admitted = false;
		};

		expect(
			await fixture.engine.join({
				transactionId: begun.transactionId,
				remote: "origin",
				capability: joinCapability,
				requestedPaths: ["notes/joined.md"],
			}),
		).toMatchObject({
			status: "refused",
			blocker: "activation_blocked",
			writePermission: "denied",
			nextAction: { id: "prepare_fresh" },
		});
		expect(await fixture.store.load()).toMatchObject({
			status: "loaded",
			receipt: { ownedPaths: [{ path: "notes/new.md" }] },
		});
	});

	test("revocation during the no-fresh join fence denies retained join authority", async () => {
		let admitted = true;
		const fixture = await engineFixture(undefined, {
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		const begun = await fixture.engine.begin({
			event: "note_created",
			requestedPaths: ["notes/new.md"],
			remote: "origin",
			leaseDurationMs: 60_000,
		});
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) {
			throw new Error("begin failed");
		}
		const joinCapability = await fixture.store.readCapability(
			begun.receiptId,
			"join",
		);
		fixture.repository.onSafety = async () => {
			admitted = false;
		};

		expect(
			await fixture.engine.join({
				transactionId: begun.transactionId,
				remote: "origin",
				capability: joinCapability,
				requestedPaths: ["notes/new.md"],
			}),
		).toMatchObject({
			status: "refused",
			blocker: "activation_blocked",
			writePermission: "denied",
		});
	});

	test("revocation during the record-phase fence prevents the receipt append", async () => {
		let admitted = true;
		const fixture = await engineFixture(undefined, {
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");
		fixture.repository.onSafety = async () => {
			admitted = false;
		};

		expect(await fixture.engine.recordPhase({
			transactionId: begun.transactionId,
			remote: "origin",
			capability: owner,
			phase: "repairable",
			nextSafeAction: "run_repair",
		})).toMatchObject({ status: "refused", blocker: "activation_blocked", writePermission: "denied" });
		expect(await fixture.store.load()).toMatchObject({ status: "loaded", receipt: { phase: "writing" } });
	});

	test("revocation during the pre-commit fence prevents the local commit", async () => {
		let admitted = true;
		const fixture = await engineFixture(undefined, {
			check: { async run() { return { status: "passed" }; } },
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");
		let safetyReads = 0;
		fixture.repository.onSafety = async () => {
			safetyReads += 1;
			if (safetyReads === 2) admitted = false;
		};

		expect(await fixture.engine.complete({
			transactionId: begun.transactionId,
			remote: "origin",
			capability: owner,
			summary: "docs(vault): record admitted note",
		})).toMatchObject({ status: "refused", phase: "committing", blocker: "activation_blocked" });
		expect(fixture.repository.commitExactCalls).toBe(0);
		expect(fixture.remote.atomicCloseCalls).toBe(0);
	});

	test("revocation during the pre-close fence preserves the commit without publishing", async () => {
		let admitted = true;
		const fixture = await engineFixture(undefined, {
			check: { async run() { return { status: "passed" }; } },
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) throw new Error("begin failed");
		const owner = await fixture.store.readCapability(begun.receiptId, "owner");
		let safetyReads = 0;
		fixture.repository.onSafety = async () => {
			safetyReads += 1;
			if (safetyReads === 3) admitted = false;
		};

		expect(await fixture.engine.complete({
			transactionId: begun.transactionId,
			remote: "origin",
			capability: owner,
			summary: "docs(vault): record admitted note",
		})).toMatchObject({ status: "refused", phase: "push_pending", blocker: "activation_blocked", changedState: "committed" });
		expect(fixture.repository.commitExactCalls).toBe(1);
		expect(fixture.remote.atomicCloseCalls).toBe(0);
	});

	test("revocation during the hygiene mutation fence prevents apply", async () => {
		let admitted = true;
		let applyCalls = 0;
		const fixture = await engineFixture(undefined, {
			activationAuthority: {
				async validate() {
					return admitted
						? { status: "admitted" as const, evidenceId: "fixture" }
						: { status: "revoked" as const, evidenceId: "fixture" };
				},
			},
		});
		let safetyReads = 0;
		fixture.repository.onSafety = async () => {
			safetyReads += 1;
			if (safetyReads === 3) admitted = false;
		};

		expect(await fixture.engine.runHygieneTransaction({
			paths: ["notes/new.md"],
			remote: "origin",
			leaseDurationMs: 60_000,
			summary: "docs(vault): apply hygiene",
			async apply() {
				applyCalls += 1;
				return true;
			},
		})).toMatchObject({ status: "refused", blocker: "activation_blocked" });
		expect(applyCalls).toBe(0);
	});

	test("a human-admitted activation remains valid for a second transaction", async () => {
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
		repository.mirrorLocalHead = (head) => {
			remote.localHead = head;
			live = { ...live, localMainHead: head };
		};
		remote.onAppend = async () => {
			live = { ...live, ledgerGeneration: GENERATION };
		};
		remote.onAtomicClose = async (mainCommit, ledgerCommit) => {
			live = {
				...live,
				remoteMainHead: mainCommit,
				ledgerGeneration: ledgerCommit,
			};
		};
		const engine = createVaultGitTransactionEngine({
			store,
			repository,
			ledger: { git: remote, clock: runtime },
			runtime,
			repositoryIdentity: "canonical-vault",
			check: { async run() { return { status: "passed" }; } },
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
				summary: "docs(vault): record admitted note",
			}),
		).toMatchObject({ status: "completed", phase: "closed" });
		expect(
			await engine.begin({
				event: "note_created",
				requestedPaths: ["notes/second.md"],
				remote: "origin",
				leaseDurationMs: 60_000,
			}),
		).toMatchObject({ status: "admitted", phase: "writing" });
		expect(scopes).toEqual(Array(8).fill("continuation"));
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
	check?: VaultGitCheckPort;
} = {}) {
	const root = await mkdtemp(join(tmpdir(), "vault-git-engine-"));
	roots.push(root);
	const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "canonical-vault" });
	if (options.admitActivation !== false) await admitActivationForTest(store);
	const repository = new FakeRepository();
	const remote = new FakeRemote();
	repository.mirrorLocalHead = (head) => {
		remote.localHead = head;
	};
	const runtime = new FakeRuntime(interruptAt);
	const engine = createVaultGitTransactionEngine({ store, repository, ledger: { git: remote, clock: runtime }, runtime, repositoryIdentity: "canonical-vault", activationAuthority: options.activationAuthority ?? persistedActivationAuthorityForTest(store), check: options.check });
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
	localHead = HEAD;
	identityError: Error | null = null;
	commitExactCalls = 0;
	commitCounter = 0;
	mirrorLocalHead?: (head: string) => void;
	onCommit?: (head: string) => Promise<void>;
	onSafety?: () => Promise<void>;
	admissionCalls = 0;
	lastRequested: readonly string[] = [];
	readonly dirtyPaths = new Set<string>();
	onCapture?: () => Promise<void>;
	refusal: "dirty_worktree" | "staged" | "ignored" | "symlink" | "preexisting_untracked" | null = null;
	// Write-capable engine phases fail closed without this proof (fix: engine
	// probes are mandatory on composed ports), so the fake provides it.
	inspectSafety: VaultGitRepositoryPort["inspectSafety"] = async () => {
		await this.onSafety?.();
		return { status: "safe" as const };
	};
	async resolveCanonicalIdentity() {
		if (this.identityError) throw this.identityError;
		return { identity: this.identity, localMainHead: this.localHead };
	}
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
	async captureUnrelatedState() {
		await this.onCapture?.();
		return { statusHex: "", indexHex: "" };
	}
	async hashOwnedPaths(paths: readonly string[]) {
		return paths.map((path) => ({ path, contentHash: "e".repeat(40) }));
	}
	async commitExact() {
		this.commitExactCalls += 1;
		this.commitCounter += 1;
		const commitId = String.fromCharCode(98 + this.commitCounter).repeat(40);
		this.localHead = commitId;
		this.mirrorLocalHead?.(commitId);
		await this.onCommit?.(commitId);
		return { status: "committed" as const, commitId, treeId: "f".repeat(40) };
	}
}

class FakeRemote implements VaultGitRemotePort {
	localHead = HEAD;
	remoteHead = HEAD;
	generation: string | null = null;
	parents: string[] = [];
	appendCalls = 0;
	atomicCloseCalls = 0;
	failReads = false;
	refuseRelease = false;
	refuseInspection = false;
	lastObservedRemote: string | null = null;
	onAppend?: () => Promise<void>;
	lease: RemoteLease | null = null;
	probeResult: VaultGitAtomicPushCapability = { status: "supported" };
	onProbe?: () => Promise<void>;
	onAtomicClose?: (mainCommit: string, ledgerCommit: string) => Promise<void>;
	probeAtomicPush: VaultGitRemotePort["probeAtomicPush"] = async () => {
		await this.onProbe?.();
		return this.probeResult;
	};
	async inspectMain() {
		if (this.refuseInspection) {
			return {
				status: "refused" as const,
				reason: "unsafe_remote_configuration" as const,
			};
		}
		return { status: "ok" as const, alignment: this.localHead === this.remoteHead ? "aligned" as const : "ahead" as const, localHead: this.localHead, remoteHead: this.remoteHead };
	}
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
		if (this.refuseRelease && document.lease.state === "released") {
			return { status: "refused" as const, reason: "remote_unavailable" as const };
		}
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
	atomicClose: NonNullable<VaultGitRemotePort["atomicClose"]> = async (request) => {
		this.atomicCloseCalls += 1;
		const ledgerCommit = "f".repeat(40);
		await request.onPrepared({
			mainCommit: request.mainCommit,
			ledgerCommit,
		});
		this.remoteHead = request.mainCommit;
		this.localHead = request.mainCommit;
		this.parents = this.generation ? [this.generation] : [];
		this.generation = ledgerCommit;
		if (this.lease) this.lease = { ...this.lease, state: "released" };
		await this.onAtomicClose?.(request.mainCommit, ledgerCommit);
		return { status: "closed", mainCommit: request.mainCommit, ledgerCommit };
	};
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
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
