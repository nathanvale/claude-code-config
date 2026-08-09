import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createVaultGitTransactionEngine } from "../src/engine.ts";
import type {
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

	test("classifies absent, active, expired, superseded, unknown, push_pending, repairable, human-required, and closed", async () => {
		const fixture = await engineFixture();
		expect((await fixture.engine.inspect()).state).toBe("absent");
		const begun = await fixture.engine.begin({ event: "note_created", requestedPaths: ["notes/new.md"], remote: "origin", leaseDurationMs: 60_000 });
		if (begun.status !== "admitted" || !begun.transactionId) throw new Error("begin failed");
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

		for (const [phase, expected] of [["push_pending", "push_pending"], ["repairable", "repairable"], ["human_required", "human_required"], ["closed", "closed"]] as const) {
			await fixture.engine.recordPhase({ phase, transactionId: begun.transactionId, remote: "origin", nextSafeAction: "inspect_status" });
			expect((await fixture.engine.inspect()).state).toBe(expected);
		}
	});
});

async function engineFixture(interruptAt?: string) {
	const root = await mkdtemp(join(tmpdir(), "vault-git-engine-"));
	roots.push(root);
	const store = createReceiptStore({ stateRoot: root, repositoryIdentity: "canonical-vault" });
	const repository = new FakeRepository();
	const remote = new FakeRemote();
	const runtime = new FakeRuntime(interruptAt);
	const engine = createVaultGitTransactionEngine({ store, repository, ledger: { git: remote, clock: runtime }, runtime, repositoryIdentity: "canonical-vault" });
	return { store, repository, remote, runtime, engine };
}

class FakeRuntime implements VaultGitRuntimePort, VaultGitClockPort {
	nowValue = new Date("2026-08-09T00:00:01.000Z");
	constructor(private readonly interruptAt?: string) {}
	now(): Date { return new Date(this.nowValue); }
	actor(): string { return "agent-a"; }
	host(): string { return "laptop"; }
	newReceiptId(): string { return "receipt_11111111111111111111111111111111"; }
	interrupt(point: string): void { if (point === this.interruptAt) throw new Error(`interrupt:${point}`); }
}

class FakeRepository implements VaultGitRepositoryPort {
	identity = "canonical-vault";
	admissionCalls = 0;
	refusal: "dirty_worktree" | "staged" | "ignored" | "symlink" | "preexisting_untracked" | null = null;
	async resolveCanonicalIdentity() { return { identity: this.identity, localMainHead: HEAD }; }
	async inspectOwnedPaths(paths: readonly string[]) {
		this.admissionCalls += 1;
		if (this.refusal) return { status: "refused" as const, reason: this.refusal };
		return { status: "admitted" as const, paths: paths.map((path) => ({ path, baselineHash: null, admittedNewFile: true })) };
	}
}

class FakeRemote implements VaultGitRemotePort {
	generation: string | null = null;
	appendCalls = 0;
	failReads = false;
	onAppend?: () => Promise<void>;
	lease: RemoteLease | null = null;
	async inspectMain() { return { status: "ok" as const, alignment: "aligned" as const, localHead: HEAD, remoteHead: HEAD }; }
	async readLedger() {
		if (this.failReads) return { status: "failed" as const, reason: "remote_unavailable" as const };
		if (!this.generation || !this.lease) return { status: "ok" as const, head: null };
		return { status: "ok" as const, head: { generation: this.generation, parents: [], content: ledgerContent(this.lease, this.generation) } };
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

function ledgerContent(lease: RemoteLease, _generation: string): string {
	return JSON.stringify({ schema_version: 1, operation: "acquire", previous_generation: null, transitioned_at: lease.acquiredAt, lease: { transaction_id: lease.transactionId, actor: lease.actor, host: lease.host, event: lease.event, owned_paths: lease.ownedPaths, local_main_head: lease.localMainHead, remote_main_head: lease.remoteMainHead, acquired_at: lease.acquiredAt, lease_duration_ms: lease.leaseDurationMs, state: lease.state } });
}
