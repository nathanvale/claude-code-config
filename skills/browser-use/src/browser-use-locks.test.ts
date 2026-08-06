import { afterAll, describe, expect, test } from "bun:test";
import {
	acquireLease,
	advanceActivationEpoch,
	heartbeatLease,
	type LeaseDeps,
	leaseRecordPath,
	listLeases,
	readActivationEpoch,
	readActivationEpochRecord,
	releaseLease,
	validateLeaseForWrite,
	validateStoredLeaseForWrite,
} from "./browser-use-locks";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import {
	type BrowserUseLeasePayload,
	encodeDurableRecord,
	parseDurableRecord,
} from "./browser-use-schemas";
import { readDurableFile } from "./browser-use-store";

// =========================================================================
// Fenced lease owner proof (platform plan 2026-07-21-002 U2).
//
// Ledger rows S13, S14, and V3: expired-holder fenced takeover with the
// recovered_from proof, a process spanning an activation-epoch advance, and
// the full validateLeaseForWrite rejection matrix — plus token monotonicity
// across release/takeover/reboot, heartbeat/release semantics, epoch CAS
// idempotency (AE12 substrate), the repair projection, and R11 placement
// (durable lease records under state, only ephemeral lockfiles under the
// runtime locks dir).
// =========================================================================

const realFs = createDefaultPlatformFs();
const sharedXdg = makeTempXdgEnv();
const disposables: { dispose(): void }[] = [sharedXdg];

const TTL_MS = 5_000;

afterAll(() => {
	for (const disposable of disposables) {
		disposable.dispose();
	}
});

async function depsOver(
	env: Record<string, string | undefined>,
	clock: () => number,
): Promise<LeaseDeps> {
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return { fs, paths: opened.paths, clock };
}

// Shared env for lease-only tests (unique key per test; the activation epoch
// stays untouched at 1 here — epoch-advancing tests isolate their own env).
async function makeSharedDeps(clock: () => number): Promise<LeaseDeps> {
	return await depsOver(sharedXdg.env, clock);
}

// Isolated env for tests that advance or corrupt the activation epoch.
async function makeIsolatedDeps(clock: () => number): Promise<{
	deps: LeaseDeps;
	env: Record<string, string | undefined>;
}> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	return { deps: await depsOver(xdg.env, clock), env: xdg.env };
}

function leaseOf(
	overrides: Partial<BrowserUseLeasePayload> = {},
): BrowserUseLeasePayload {
	return {
		key: "matrix/default/target",
		holder_id: "holder-a",
		fencing_token: 3,
		activation_epoch: 2,
		acquired_at_epoch_ms: 1_000,
		heartbeat_at_epoch_ms: 1_000,
		expires_at_epoch_ms: 10_000,
		recovered_from: null,
		scope: {},
		...overrides,
	};
}

async function acquireOk(
	deps: LeaseDeps,
	input: Parameters<typeof acquireLease>[1],
): Promise<BrowserUseLeasePayload> {
	const result = await acquireLease(deps, input);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error("unreachable");
	return result.lease;
}

describe("acquireLease (R27)", () => {
	test("fresh key mints fencing token 1 at epoch 1, canonical durable bytes included", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const lease = await acquireOk(deps, {
			key: "acquire/fresh",
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		expect(lease).toEqual({
			key: "acquire/fresh",
			holder_id: "holder-a",
			fencing_token: 1,
			activation_epoch: 1,
			acquired_at_epoch_ms: 1_000,
			heartbeat_at_epoch_ms: 1_000,
			expires_at_epoch_ms: 6_000,
			recovered_from: null,
			scope: {},
		});
		// The durable record is the canonical encoded form and round-trips.
		const read = await readDurableFile(
			deps.fs,
			leaseRecordPath(deps.paths, "acquire/fresh"),
		);
		expect(read.status).toBe("present");
		if (read.status !== "present") throw new Error("unreachable");
		expect(read.raw).toBe(encodeDurableRecord("run-lease", lease));
		expect(parseDurableRecord(read.raw, "run-lease")).toEqual({
			ok: true,
			payload: lease,
		});
	});

	test("scope facets persist verbatim as inspection-only fields", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const lease = await acquireOk(deps, {
			key: "acquire/scoped",
			holderId: "holder-a",
			ttlMs: TTL_MS,
			scope: { auth_context_ref: "auth-ref-1", target_id: "timesheet" },
		});
		expect(lease.scope).toEqual({
			auth_context_ref: "auth-ref-1",
			target_id: "timesheet",
		});
	});

	test("a live lease refuses a second holder with lease_held, the holder projection, and one wait continuation", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		await acquireOk(deps, {
			key: "acquire/contended",
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		clock.advance(1_000);
		const second = await acquireLease(deps, {
			key: "acquire/contended",
			holderId: "holder-b",
			ttlMs: TTL_MS,
		});
		expect(second.ok).toBe(false);
		if (second.ok) throw new Error("unreachable");
		expect(second.code).toBe("lease_held");
		if (second.code !== "lease_held") throw new Error("unreachable");
		expect(second.holder).toEqual({
			key: "acquire/contended",
			holder_id: "holder-a",
			fencing_token: 1,
			activation_epoch: 1,
			heartbeat_at_epoch_ms: 1_000,
			expires_at_epoch_ms: 6_000,
			live: true,
			recovered_from: null,
		});
		expect(second.continuation.next_action_id).toBe("wait_for_lease");
		expect(second.continuation.summary).toContain("holder-a");
	});

	test("S13: an expired holder is fenced — the takeover mints token+1 with the recovered_from proof, and the stale claim cannot write", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const staleLease = await acquireOk(deps, {
			key: "s13/takeover",
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		// Past A's expiry instant (expires_at 6_000 is itself expired).
		clock.set(6_000);
		const takeover = await acquireOk(deps, {
			key: "s13/takeover",
			holderId: "holder-b",
			ttlMs: TTL_MS,
		});
		expect(takeover.fencing_token).toBe(2);
		expect(takeover.recovered_from).toEqual({
			fencing_token: 1,
			holder_id: "holder-a",
			observed_expired_at_epoch_ms: 6_000,
		});
		// A's write claim is rejected both purely and against the store.
		const staleClaim = {
			fencing_token: staleLease.fencing_token,
			activation_epoch: staleLease.activation_epoch,
			holderId: staleLease.holder_id,
		};
		const pure = validateLeaseForWrite(takeover, staleClaim, clock.now);
		expect(pure.ok).toBe(false);
		if (pure.ok) throw new Error("unreachable");
		expect(pure.code).toBe("lease_fencing_stale");
		const stored = await validateStoredLeaseForWrite(deps, {
			key: "s13/takeover",
			presented: staleClaim,
		});
		expect(stored.ok).toBe(false);
		if (stored.ok) throw new Error("unreachable");
		expect(stored.code).toBe("lease_fencing_stale");
	});

	test("the fencing token never resets: release, takeover, and reboot each increase it", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const first = await acquireOk(deps, {
			key: "acquire/monotonic",
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		expect(first.fencing_token).toBe(1);
		await releaseLease(deps, first);
		const second = await acquireOk(deps, {
			key: "acquire/monotonic",
			holderId: "holder-b",
			ttlMs: TTL_MS,
		});
		expect(second.fencing_token).toBe(2);
		expect(second.recovered_from?.holder_id).toBe("holder-a");
		// "Reboot": fresh fs adapter, fresh paths objects, fresh clock — only
		// the durable state dir survives, and the token keeps increasing.
		const rebootClock = fixedClock(60_000);
		const rebooted = await depsOver(sharedXdg.env, rebootClock.now);
		const third = await acquireOk(rebooted, {
			key: "acquire/monotonic",
			holderId: "holder-c",
			ttlMs: TTL_MS,
		});
		expect(third.fencing_token).toBe(3);
		expect(third.recovered_from?.fencing_token).toBe(2);
	});

	test("a corrupt lease record fails acquisition closed as lease_store_failed", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		await deps.fs.mkdir(deps.paths.state.leasesDir, {
			recursive: true,
			mode: 0o700,
		});
		await deps.fs.writeFile(
			leaseRecordPath(deps.paths, "acquire/corrupt"),
			"{ torn",
			0o600,
		);
		const result = await acquireLease(deps, {
			key: "acquire/corrupt",
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("lease_store_failed");
	});

	test("empty identities and non-positive ttls are caller bugs, not typed refusals", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		await expect(
			acquireLease(deps, { key: "", holderId: "holder-a", ttlMs: TTL_MS }),
		).rejects.toBeInstanceOf(TypeError);
		await expect(
			acquireLease(deps, { key: "acquire/guard", holderId: "", ttlMs: TTL_MS }),
		).rejects.toBeInstanceOf(TypeError);
		await expect(
			acquireLease(deps, { key: "acquire/guard", holderId: "holder-a", ttlMs: 0 }),
		).rejects.toBeInstanceOf(TypeError);
	});
});

describe("heartbeatLease", () => {
	test("a live holder extends its window; token and epoch stay fixed and the record is durable", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const lease = await acquireOk(deps, {
			key: "heartbeat/live",
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		clock.advance(2_000);
		const beat = await heartbeatLease(deps, lease, { ttlMs: TTL_MS });
		expect(beat.ok).toBe(true);
		if (!beat.ok) throw new Error("unreachable");
		expect(beat.lease.fencing_token).toBe(1);
		expect(beat.lease.activation_epoch).toBe(1);
		expect(beat.lease.heartbeat_at_epoch_ms).toBe(3_000);
		expect(beat.lease.expires_at_epoch_ms).toBe(8_000);
		const read = await readDurableFile(
			deps.fs,
			leaseRecordPath(deps.paths, "heartbeat/live"),
		);
		if (read.status !== "present") throw new Error("record must be present");
		expect(read.raw).toBe(encodeDurableRecord("run-lease", beat.lease));
	});

	test("a superseded holder's heartbeat is lease_fencing_stale, never a silent extension", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const stale = await acquireOk(deps, {
			key: "heartbeat/superseded",
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		clock.set(7_000);
		const takeover = await acquireOk(deps, {
			key: "heartbeat/superseded",
			holderId: "holder-b",
			ttlMs: TTL_MS,
		});
		const beat = await heartbeatLease(deps, stale, { ttlMs: TTL_MS });
		expect(beat.ok).toBe(false);
		if (beat.ok) throw new Error("unreachable");
		expect(beat.code).toBe("lease_fencing_stale");
		// The successor's record is untouched by the stale heartbeat.
		const read = await readDurableFile(
			deps.fs,
			leaseRecordPath(deps.paths, "heartbeat/superseded"),
		);
		if (read.status !== "present") throw new Error("record must be present");
		expect(read.raw).toBe(encodeDurableRecord("run-lease", takeover));
	});

	test("an expired but unsuperseded holder's heartbeat is lease_expired", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const lease = await acquireOk(deps, {
			key: "heartbeat/expired",
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		clock.set(6_000);
		const beat = await heartbeatLease(deps, lease, { ttlMs: TTL_MS });
		expect(beat.ok).toBe(false);
		if (beat.ok) throw new Error("unreachable");
		expect(beat.code).toBe("lease_expired");
	});

	test("heartbeat on a key with no durable record is lease_missing", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const beat = await heartbeatLease(
			deps,
			leaseOf({ key: "heartbeat/never-acquired", activation_epoch: 1 }),
			{ ttlMs: TTL_MS },
		);
		expect(beat.ok).toBe(false);
		if (beat.ok) throw new Error("unreachable");
		expect(beat.code).toBe("lease_missing");
	});
});

describe("releaseLease", () => {
	test("release marks expiry so the next acquire proceeds immediately; the durable record survives", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const lease = await acquireOk(deps, {
			key: "release/clean",
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		clock.advance(1_000);
		expect(await releaseLease(deps, lease)).toEqual({ ok: true });
		const read = await readDurableFile(
			deps.fs,
			leaseRecordPath(deps.paths, "release/clean"),
		);
		expect(read.status).toBe("present");
		if (read.status !== "present") throw new Error("unreachable");
		const parsed = parseDurableRecord(read.raw, "run-lease");
		if (!parsed.ok) throw new Error("record must parse");
		expect(parsed.payload.expires_at_epoch_ms).toBe(2_000);
		// No wait needed: the release expired the record at the current instant.
		const next = await acquireOk(deps, {
			key: "release/clean",
			holderId: "holder-b",
			ttlMs: TTL_MS,
		});
		expect(next.fencing_token).toBe(2);
	});

	test("releasing an already-released or superseded lease is an idempotent no-op success", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const stale = await acquireOk(deps, {
			key: "release/idempotent",
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		expect(await releaseLease(deps, stale)).toEqual({ ok: true });
		expect(await releaseLease(deps, stale)).toEqual({ ok: true });
		const successor = await acquireOk(deps, {
			key: "release/idempotent",
			holderId: "holder-b",
			ttlMs: TTL_MS,
		});
		// A stale release never touches the successor's record.
		expect(await releaseLease(deps, stale)).toEqual({ ok: true });
		const read = await readDurableFile(
			deps.fs,
			leaseRecordPath(deps.paths, "release/idempotent"),
		);
		if (read.status !== "present") throw new Error("record must be present");
		expect(read.raw).toBe(encodeDurableRecord("run-lease", successor));
	});
});

describe("validateLeaseForWrite matrix (V3)", () => {
	const clock = fixedClock(5_000);

	test("a fresh claim passes", () => {
		expect(
			validateLeaseForWrite(
				leaseOf(),
				{ fencing_token: 3, activation_epoch: 2, holderId: "holder-a" },
				clock.now,
			),
		).toEqual({ ok: true });
	});

	test("a stale fencing token is lease_fencing_stale", () => {
		const result = validateLeaseForWrite(
			leaseOf(),
			{ fencing_token: 2, activation_epoch: 2, holderId: "holder-a" },
			clock.now,
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("lease_fencing_stale");
	});

	test("a holder mismatch on a matching token is also lease_fencing_stale", () => {
		const result = validateLeaseForWrite(
			leaseOf(),
			{ fencing_token: 3, activation_epoch: 2, holderId: "holder-imposter" },
			clock.now,
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("lease_fencing_stale");
	});

	test("a stale activation epoch is lease_epoch_stale", () => {
		const result = validateLeaseForWrite(
			leaseOf(),
			{ fencing_token: 3, activation_epoch: 1, holderId: "holder-a" },
			clock.now,
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("lease_epoch_stale");
	});

	test("an expired lease is lease_expired, including at the exact expiry instant", () => {
		const atExpiry = fixedClock(10_000);
		const result = validateLeaseForWrite(
			leaseOf(),
			{ fencing_token: 3, activation_epoch: 2, holderId: "holder-a" },
			atExpiry.now,
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("lease_expired");
	});

	test("a missing lease record is lease_missing", () => {
		const result = validateLeaseForWrite(
			undefined,
			{ fencing_token: 3, activation_epoch: 2, holderId: "holder-a" },
			clock.now,
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("lease_missing");
	});
});

describe("activation epoch (R27; AE12 substrate)", () => {
	test("reads default to epoch 1 when the record file is absent", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		expect(await readActivationEpoch(deps)).toBe(1);
		expect(await readActivationEpochRecord(deps)).toEqual({
			status: "ok",
			epoch: 1,
		});
	});

	test("advance is CAS: success, idempotent reapply, and conflict are distinct; the epoch is durable", async () => {
		const clock = fixedClock();
		const { deps, env } = await makeIsolatedDeps(clock.now);
		expect(await advanceActivationEpoch(deps, { expectedEpoch: 1 })).toEqual({
			ok: true,
			epoch: 2,
		});
		// Reapplying the already-applied advance is an idempotent no-op (AE12).
		expect(await advanceActivationEpoch(deps, { expectedEpoch: 1 })).toEqual({
			ok: true,
			epoch: 2,
		});
		const conflict = await advanceActivationEpoch(deps, { expectedEpoch: 4 });
		expect(conflict.ok).toBe(false);
		if (conflict.ok) throw new Error("unreachable");
		expect(conflict.code).toBe("epoch_conflict");
		// Durable across fresh deps objects over the same state dir.
		const rebooted = await depsOver(env, fixedClock(90_000).now);
		expect(await readActivationEpoch(rebooted)).toBe(2);
	});

	test("S14: a holder acquired at epoch 1 is fenced after the epoch advances; new acquires stamp the new epoch", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const lease = await acquireOk(deps, {
			key: "s14/spanning-holder",
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		expect(lease.activation_epoch).toBe(1);
		expect(await advanceActivationEpoch(deps, { expectedEpoch: 1 })).toEqual({
			ok: true,
			epoch: 2,
		});
		// The holder's lease is still live and unsuperseded — only the epoch
		// advanced — yet its write claim is fenced.
		const stored = await validateStoredLeaseForWrite(deps, {
			key: "s14/spanning-holder",
			presented: {
				fencing_token: lease.fencing_token,
				activation_epoch: lease.activation_epoch,
				holderId: lease.holder_id,
			},
		});
		expect(stored.ok).toBe(false);
		if (stored.ok) throw new Error("unreachable");
		expect(stored.code).toBe("lease_epoch_stale");
		const postAdvance = await acquireOk(deps, {
			key: "s14/post-advance",
			holderId: "holder-b",
			ttlMs: TTL_MS,
		});
		expect(postAdvance.activation_epoch).toBe(2);
	});

	test("a corrupt epoch record is a typed classification; the plain read throws and the gates fail closed", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		await deps.fs.writeFile(deps.paths.state.epochFile, "{ torn", 0o600);
		const record = await readActivationEpochRecord(deps);
		expect(record.status).toBe("corrupt");
		await expect(readActivationEpoch(deps)).rejects.toBeInstanceOf(Error);
		const gate = await validateStoredLeaseForWrite(deps, {
			key: "epoch/corrupt",
			presented: { fencing_token: 1, activation_epoch: 1, holderId: "holder-a" },
		});
		expect(gate.ok).toBe(false);
		if (gate.ok) throw new Error("unreachable");
		expect(gate.code).toBe("lease_store_failed");
		const advance = await advanceActivationEpoch(deps, { expectedEpoch: 1 });
		expect(advance.ok).toBe(false);
		if (advance.ok) throw new Error("unreachable");
		expect(advance.code).toBe("epoch_store_failed");
	});
});

describe("listLeases repair projection", () => {
	test("a missing leases dir projects empty", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		expect(await listLeases(deps)).toEqual([]);
	});

	test("projects every durable lease with liveness classification, sorted by key", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		await acquireOk(deps, {
			key: "b-key",
			holderId: "holder-b",
			ttlMs: TTL_MS,
		});
		await acquireOk(deps, {
			key: "a-key",
			holderId: "holder-a",
			ttlMs: 1_000,
		});
		// a-key expires at 2_000; b-key stays live until 6_000.
		clock.set(3_000);
		const leases = await listLeases(deps);
		expect(leases.map((lease) => lease.key)).toEqual(["a-key", "b-key"]);
		expect(leases[0]).toMatchObject({
			holder_id: "holder-a",
			fencing_token: 1,
			live: false,
			recovered_from: null,
		});
		expect(leases[1]).toMatchObject({ holder_id: "holder-b", live: true });
	});
});

describe("durable/ephemeral placement (R11)", () => {
	test("lease records are durable under state/leases; the runtime locks dir holds no leftover lockfiles", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const lease = await acquireOk(deps, {
			key: "placement/key",
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		await heartbeatLease(deps, lease, { ttlMs: TTL_MS });
		await releaseLease(deps, lease);
		// The record path lives under the state root, never the runtime dir.
		const recordPath = leaseRecordPath(deps.paths, "placement/key");
		expect(recordPath.startsWith(deps.paths.state.leasesDir)).toBe(true);
		expect(await deps.fs.readDirectory(deps.paths.state.leasesDir)).toHaveLength(1);
		// Advisory lockfiles are released in finally: nothing durable remains.
		expect(await deps.fs.readDirectory(deps.paths.runtime.locksDir)).toEqual([]);
	});
});
