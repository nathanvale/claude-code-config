// ---------------------------------------------------------------------------
// The single fenced lease owner (platform plan 2026-07-21-002 U2, R27).
//
// One lease protocol for serializing mutating runs: acquisition, heartbeat,
// release, monotonically increasing fencing tokens, activation epochs,
// expired-holder fenced takeover with a recovered_from proof, and the write
// gate that rejects stale holders and stale epochs. Lease records are
// DURABLE state (`<state>/leases/<key-hash>.json`) because fencing tokens
// must stay monotonic across reboots and the runtime dir does not survive
// one; the runtime `locks/` dir (R11) holds only the ephemeral advisory
// lockfiles the store's critical sections use. Keys are opaque strings —
// `runs` composes them; this module carries no run knowledge, no retention
// or generation logic beyond the activation-epoch record, never deletes a
// lease record file (release marks expiry; the durable record preserves
// token monotonicity), and never mints a token from a clock or randomness.
//
// Import direction: imports store, schemas, paths (types), and core only.
// No Date.now, no Math.random, no process.cwd(); time enters only through
// the injected clock.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { join } from "node:path";
import { redactUnsafeText } from "./browser-use-core";
import type {
	BrowserUseAdmittedPaths,
	BrowserUsePlatformFs,
} from "./browser-use-paths";
import {
	type BrowserUseLeasePayload,
	encodeDurableRecord,
	parseDurableRecord,
} from "./browser-use-schemas";
import {
	type StoreFailure,
	readDurableFile,
	withExclusiveFileLock,
	writeDurableFile,
} from "./browser-use-store";

// --- Deps and shared types ---------------------------------------------------

/** Injected seams: fs port, admitted paths, and the clock (NEVER Date.now). */
export type LeaseDeps = {
	fs: BrowserUsePlatformFs;
	paths: BrowserUseAdmittedPaths;
	clock: () => number;
};

/** Repair projection: one durable lease with its liveness classification. */
export type LeaseProjection = {
	key: string;
	holder_id: string;
	fencing_token: number;
	activation_epoch: number;
	heartbeat_at_epoch_ms: number;
	expires_at_epoch_ms: number;
	live: boolean;
	recovered_from: BrowserUseLeasePayload["recovered_from"];
};

/** Typed acquisition outcome (also the heartbeat success/held shape). */
export type LeaseAcquireResult =
	| { ok: true; lease: BrowserUseLeasePayload }
	| {
			ok: false;
			code: "lease_held";
			holder: LeaseProjection;
			continuation: { next_action_id: "wait_for_lease"; summary: string };
	  }
	| { ok: false; code: "lease_store_failed"; message: string };

/** The claim a holder presents at heartbeat/write time. */
export type LeaseWriteClaim = {
	fencing_token: number;
	activation_epoch: number;
	holderId: string;
};

/**
 * Write-gate verdict (R27 "Reject writes and receipts from stale holders or
 * epochs"): stale token, stale epoch, expired, and missing are each typed.
 */
export type LeaseWriteValidation =
	| { ok: true }
	| {
			ok: false;
			code:
				| "lease_fencing_stale"
				| "lease_epoch_stale"
				| "lease_expired"
				| "lease_missing";
			message: string;
	  };

/**
 * Heartbeat outcome: acquisition shapes plus the write-gate rejections —
 * heartbeat validates fencing token and epoch first, so a stale holder gets
 * the same typed rejection a write would.
 */
export type LeaseHeartbeatResult =
	| LeaseAcquireResult
	| Extract<LeaseWriteValidation, { ok: false }>;

/** Advance outcome: CAS conflict and store failure are distinct codes. */
export type ActivationEpochAdvanceResult =
	| { ok: true; epoch: number }
	| { ok: false; code: "epoch_conflict" | "epoch_store_failed"; message: string };

/** Failure to enter the activation barrier shared by epoch advance and writes. */
export type ActivationEpochBarrierFailure = {
	ok: false;
	code: "epoch_store_failed";
	message: string;
};

// --- Internal helpers --------------------------------------------------------

/** Private modes mirror the paths admission constants (R12). */
const PRIVATE_DIR_MODE = 0o700;

// Advisory lockfiles guard sub-second read-modify-write sections; a crashed
// holder's leftover lockfile ages out after this window (store semantics:
// strictly greater than).
const LOCKFILE_STALE_AFTER_MS = 10_000;

/** The epoch record starts here when the file is absent. */
const INITIAL_ACTIVATION_EPOCH = 1;

// Same-process callers for one admitted store queue before taking its
// cross-process epoch lock. Independent roots retain independent concurrency.
const activationBarrierTails = new Map<string, Promise<void>>();

async function withLocalActivationBarrier<T>(
	key: string,
	body: () => Promise<T>,
): Promise<T> {
	const prior = activationBarrierTails.get(key) ?? Promise.resolve();
	let release!: () => void;
	const tail = new Promise<void>((resolve) => {
		release = resolve;
	});
	activationBarrierTails.set(key, tail);
	await prior;
	try {
		return await body();
	} finally {
		release();
		if (activationBarrierTails.get(key) === tail) {
			activationBarrierTails.delete(key);
		}
	}
}

function leaseStoreFailed(message: string): {
	ok: false;
	code: "lease_store_failed";
	message: string;
} {
	return { ok: false, code: "lease_store_failed", message: redactUnsafeText(message) };
}

// Mirrors the store's rule: messages carry only the errno code, never the
// node error string (those embed quoted paths).
function errorCode(error: unknown): string {
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" && code !== "" ? code : "unknown";
}

// Lease-key filename: content hash, no clock or randomness (the
// handoffEvidenceIdOf precedent). The full key survives inside the record.
function leaseKeyHash(key: string): string {
	return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function leaseLockPath(paths: BrowserUseAdmittedPaths, key: string): string {
	return join(paths.runtime.locksDir, `lease-${leaseKeyHash(key)}.lock`);
}

function epochLockPath(paths: BrowserUseAdmittedPaths): string {
	return join(paths.runtime.locksDir, "activation-epoch.lock");
}

// Ids become single path segments via hashing, so keys never touch path
// derivation; empty identity strings are caller bugs (the
// assertSafePathSegment precedent), not typed refusals.
function assertNonEmpty(value: string, name: string): void {
	if (value === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new TypeError(`${name} must be an integer >= 1`);
	}
}

// The leases dir and the runtime locks dir are created lazily (admission owns
// the roots; module-owned subdirectories are created by their owner).
async function ensureLeaseDirs(
	deps: LeaseDeps,
): Promise<{ ok: true } | { ok: false; code: "lease_store_failed"; message: string }> {
	try {
		await deps.fs.mkdir(deps.paths.state.leasesDir, {
			recursive: true,
			mode: PRIVATE_DIR_MODE,
		});
		await deps.fs.mkdir(deps.paths.runtime.locksDir, {
			recursive: true,
			mode: PRIVATE_DIR_MODE,
		});
	} catch (error) {
		return leaseStoreFailed(
			`lease directories could not be created (${errorCode(error)}).`,
		);
	}
	return { ok: true };
}

// A lease is live strictly before its expiry instant; at the instant it is
// expired (mirrors the write-gate expiry check).
function isLive(lease: BrowserUseLeasePayload, nowEpochMs: number): boolean {
	return lease.expires_at_epoch_ms > nowEpochMs;
}

function projectionOf(
	lease: BrowserUseLeasePayload,
	nowEpochMs: number,
): LeaseProjection {
	return {
		key: lease.key,
		holder_id: lease.holder_id,
		fencing_token: lease.fencing_token,
		activation_epoch: lease.activation_epoch,
		heartbeat_at_epoch_ms: lease.heartbeat_at_epoch_ms,
		expires_at_epoch_ms: lease.expires_at_epoch_ms,
		live: isLive(lease, nowEpochMs),
		recovered_from: lease.recovered_from,
	};
}

type LeaseRecordRead =
	| { status: "present"; lease: BrowserUseLeasePayload }
	| { status: "missing" }
	| { status: "corrupt"; message: string };

async function readLeaseRecord(
	deps: LeaseDeps,
	key: string,
): Promise<LeaseRecordRead> {
	const read = await readDurableFile(deps.fs, leaseRecordPath(deps.paths, key));
	if (read.status === "missing") return { status: "missing" };
	if (read.status === "unreadable") {
		return { status: "corrupt", message: read.message };
	}
	const parsed = parseDurableRecord(read.raw, "run-lease");
	if (!parsed.ok) {
		return {
			status: "corrupt",
			message: redactUnsafeText(`lease record is corrupt (${parsed.code}).`),
		};
	}
	return { status: "present", lease: parsed.payload };
}

async function writeLeaseRecord(
	deps: LeaseDeps,
	lease: BrowserUseLeasePayload,
): Promise<{ ok: true } | { ok: false; failure: StoreFailure }> {
	return await writeDurableFile(deps.fs, {
		path: leaseRecordPath(deps.paths, lease.key),
		contents: encodeDurableRecord("run-lease", lease),
	});
}

// Narrow the withExclusiveFileLock union: an advisory-lock failure carries a
// StoreFailure; body outcomes never do.
function isLockFailure<T extends { ok: boolean }>(
	outcome: T | { ok: false; failure: StoreFailure },
): outcome is { ok: false; failure: StoreFailure } {
	return !outcome.ok && "failure" in outcome;
}

// --- Lease record path -------------------------------------------------------

/**
 * Durable lease record path for one opaque key:
 * `<state>/leases/<key-hash>.json`. Exported so tests and `repair status`
 * derive the path from one owner instead of re-hashing.
 *
 * @param paths - Admitted Target XDG Shape
 * @param key - Opaque serialization key
 * @returns Absolute lease record path
 */
export function leaseRecordPath(
	paths: BrowserUseAdmittedPaths,
	key: string,
): string {
	assertNonEmpty(key, "key");
	return join(paths.state.leasesDir, `${leaseKeyHash(key)}.json`);
}

// --- Acquisition (R27) -------------------------------------------------------

/**
 * Acquire the lease for one opaque key inside an exclusive advisory lock:
 * an absent record mints fencing token 1 at the current activation epoch; a
 * present expired record is a fenced takeover — token = prior + 1 with the
 * prior holder recorded as the `recovered_from` stale-recovery proof (R27);
 * a present live record is a typed `lease_held` with the holder projection
 * and the one wait continuation. The token NEVER resets; it only increases
 * per key, across releases, takeovers, and reboots. A corrupt lease record
 * fails closed as `lease_store_failed` — inventing a token would break
 * monotonicity.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param input - Opaque key, holder id, ttl, optional inspection scope
 * @returns The written lease, or one typed refusal
 */
export async function acquireLease(
	deps: LeaseDeps,
	input: {
		key: string;
		holderId: string;
		ttlMs: number;
		scope?: BrowserUseLeasePayload["scope"];
	},
): Promise<LeaseAcquireResult> {
	assertNonEmpty(input.key, "key");
	assertNonEmpty(input.holderId, "holderId");
	assertPositiveInteger(input.ttlMs, "ttlMs");
	const dirs = await ensureLeaseDirs(deps);
	if (!dirs.ok) return dirs;
	const acquireUnderLeaseLock = async () =>
		await withExclusiveFileLock<LeaseAcquireResult>(
			deps.fs,
			{
				lockPath: leaseLockPath(deps.paths, input.key),
				holderId: input.holderId,
				staleAfterMs: LOCKFILE_STALE_AFTER_MS,
				clock: deps.clock,
			},
			async () => {
				const current = await readLeaseRecord(deps, input.key);
				if (current.status === "corrupt") {
					return leaseStoreFailed(
						`lease record is corrupt; acquisition fails closed to preserve token monotonicity. ${current.message}`,
					);
				}
				const now = deps.clock();
				if (current.status === "present" && isLive(current.lease, now)) {
					const holder = projectionOf(current.lease, now);
					return {
						ok: false,
						code: "lease_held",
						holder,
						continuation: {
							next_action_id: "wait_for_lease",
							summary: redactUnsafeText(
								`lease is held by ${holder.holder_id} until epoch-ms ${holder.expires_at_epoch_ms}; wait for expiry or release, then retry.`,
							),
						},
					};
				}
				const epoch = await readActivationEpochRecord(deps);
				if (epoch.status === "corrupt") {
					return leaseStoreFailed(
						`activation-epoch record is corrupt; acquisition fails closed. ${epoch.message}`,
					);
				}
				const prior = current.status === "present" ? current.lease : undefined;
				const lease: BrowserUseLeasePayload = {
					key: input.key,
					holder_id: input.holderId,
					fencing_token: prior === undefined ? 1 : prior.fencing_token + 1,
					activation_epoch: epoch.epoch,
					acquired_at_epoch_ms: now,
					heartbeat_at_epoch_ms: now,
					expires_at_epoch_ms: now + input.ttlMs,
					recovered_from:
						prior === undefined
							? null
							: {
									fencing_token: prior.fencing_token,
									holder_id: prior.holder_id,
									observed_expired_at_epoch_ms: now,
								},
					scope: input.scope ?? {},
				};
				const written = await writeLeaseRecord(deps, lease);
				if (!written.ok) {
					return leaseStoreFailed(
						`lease write failed: ${written.failure.message}`,
					);
				}
				return { ok: true, lease };
			},
		);
	const outcome = await withActivationEpochBarrier(
		deps,
		{ holderId: `lease-acquire-${input.holderId}` },
		acquireUnderLeaseLock,
	);
	if (!outcome.ok && "code" in outcome && outcome.code === "epoch_store_failed") {
		return leaseStoreFailed(`lease activation barrier failed: ${outcome.message}`);
	}
	if (isLockFailure(outcome)) {
		return leaseStoreFailed(`lease lock unavailable: ${outcome.failure.message}`);
	}
	return outcome;
}

// --- Heartbeat / release -----------------------------------------------------

/**
 * Heartbeat/extend a held lease. Validates the holder's fencing token and
 * activation epoch against the durable record and the LIVE epoch first — a
 * stale holder gets the same typed rejection the write gate emits
 * (`lease_fencing_stale` / `lease_epoch_stale` / `lease_expired` /
 * `lease_missing`), never a silent extension. On a fresh claim the record's
 * heartbeat and expiry advance from the injected clock.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param lease - The holder's lease payload from acquisition
 * @param input - New ttl window
 * @returns The extended lease, or one typed rejection
 */
export async function heartbeatLease(
	deps: LeaseDeps,
	lease: BrowserUseLeasePayload,
	input: { ttlMs: number },
): Promise<LeaseHeartbeatResult> {
	assertPositiveInteger(input.ttlMs, "ttlMs");
	const dirs = await ensureLeaseDirs(deps);
	if (!dirs.ok) return dirs;
	const heartbeatUnderLeaseLock = async () =>
		await withExclusiveFileLock<LeaseHeartbeatResult>(
			deps.fs,
			{
				lockPath: leaseLockPath(deps.paths, lease.key),
				holderId: lease.holder_id,
				staleAfterMs: LOCKFILE_STALE_AFTER_MS,
				clock: deps.clock,
			},
			async () => {
				const validated = await validateStoredLeaseForWrite(deps, {
					key: lease.key,
					presented: {
						fencing_token: lease.fencing_token,
						activation_epoch: lease.activation_epoch,
						holderId: lease.holder_id,
					},
				});
				if (!validated.ok) return validated;
				const current = await readLeaseRecord(deps, lease.key);
				if (current.status !== "present") {
					return leaseStoreFailed("lease record vanished during heartbeat.");
				}
				const now = deps.clock();
				const extended: BrowserUseLeasePayload = {
					...current.lease,
					heartbeat_at_epoch_ms: now,
					expires_at_epoch_ms: now + input.ttlMs,
				};
				const written = await writeLeaseRecord(deps, extended);
				if (!written.ok) {
					return leaseStoreFailed(
						`lease heartbeat write failed: ${written.failure.message}`,
					);
				}
				return { ok: true, lease: extended };
			},
		);
	const outcome = await withActivationEpochBarrier(
		deps,
		{ holderId: `lease-heartbeat-${lease.holder_id}` },
		heartbeatUnderLeaseLock,
	);
	if (!outcome.ok && "code" in outcome && outcome.code === "epoch_store_failed") {
		return leaseStoreFailed(`lease activation barrier failed: ${outcome.message}`);
	}
	if (isLockFailure(outcome)) {
		return leaseStoreFailed(`lease lock unavailable: ${outcome.failure.message}`);
	}
	return outcome;
}

/**
 * Release a lease by marking its expiry at the current instant. Releasing an
 * already-released, expired, superseded, or missing lease is an idempotent
 * no-op success — it is NEVER an error to release stale (spec A4). The
 * durable record is never deleted (token monotonicity), and a failed release
 * write is swallowed: the lease then simply ages out through its ttl, which
 * the write gate already handles.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param lease - The holder's lease payload from acquisition
 * @returns Always ok
 */
export async function releaseLease(
	deps: LeaseDeps,
	lease: BrowserUseLeasePayload,
): Promise<{ ok: true }> {
	const dirs = await ensureLeaseDirs(deps);
	if (!dirs.ok) return { ok: true };
	const releaseUnderLeaseLock = async () =>
		await withExclusiveFileLock<{ ok: true }>(
			deps.fs,
			{
				lockPath: leaseLockPath(deps.paths, lease.key),
				holderId: lease.holder_id,
				staleAfterMs: LOCKFILE_STALE_AFTER_MS,
				clock: deps.clock,
			},
			async () => {
				const current = await readLeaseRecord(deps, lease.key);
				if (current.status !== "present") return { ok: true };
				const now = deps.clock();
				if (
					current.lease.fencing_token !== lease.fencing_token ||
					current.lease.holder_id !== lease.holder_id ||
					!isLive(current.lease, now)
				) {
					return { ok: true };
				}
				await writeLeaseRecord(deps, {
					...current.lease,
					expires_at_epoch_ms: now,
				});
				return { ok: true };
			},
		);
	await withActivationEpochBarrier(
		deps,
		{ holderId: `lease-release-${lease.holder_id}` },
		releaseUnderLeaseLock,
	);
	return { ok: true };
}

// --- Write gate (R27) --------------------------------------------------------

/**
 * THE write gate (R27 "Reject writes and receipts from stale holders or
 * epochs"); `runs.casUpdateSharedRun` calls this inside its critical section
 * before writing. Pure over its inputs: `current` must be the durable lease
 * record with its `activation_epoch` reflecting the LIVE activation epoch —
 * `validateStoredLeaseForWrite` performs exactly that composition. Check
 * order: missing, stale fencing token (a holder mismatch on a matching token
 * is the same rejection — the claim does not match the durable acquisition),
 * stale epoch, expired.
 *
 * @param current - Durable lease record (live-epoch overlaid), or undefined
 * @param presented - The holder's claimed token, epoch, and identity
 * @param clock - Injected clock for the expiry check
 * @returns Ok, or one typed rejection
 */
export function validateLeaseForWrite(
	current: BrowserUseLeasePayload | undefined,
	presented: LeaseWriteClaim,
	clock: () => number,
): LeaseWriteValidation {
	if (current === undefined) {
		return {
			ok: false,
			code: "lease_missing",
			message: "no durable lease record backs the presented claim.",
		};
	}
	if (
		presented.fencing_token !== current.fencing_token ||
		presented.holderId !== current.holder_id
	) {
		return {
			ok: false,
			code: "lease_fencing_stale",
			message: `presented fencing token ${presented.fencing_token} is stale; the durable token is ${current.fencing_token}.`,
		};
	}
	if (presented.activation_epoch !== current.activation_epoch) {
		return {
			ok: false,
			code: "lease_epoch_stale",
			message: `presented activation epoch ${presented.activation_epoch} is stale; the current epoch is ${current.activation_epoch}.`,
		};
	}
	const now = clock();
	if (!isLive(current, now)) {
		return {
			ok: false,
			code: "lease_expired",
			message: `lease expired at epoch-ms ${current.expires_at_epoch_ms}; now is ${now}.`,
		};
	}
	return { ok: true };
}

/**
 * The stored write gate: reads the durable lease record and the LIVE
 * activation epoch, overlays the epoch onto the record, and runs
 * `validateLeaseForWrite`. This is how an epoch advance fences every holder
 * acquired before it (S14/AE12 substrate) even though their durable lease
 * records still carry the old epoch. A corrupt lease or epoch record fails
 * closed as `lease_store_failed`.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param input - Opaque key plus the holder's presented claim
 * @returns Ok, one typed write rejection, or the store failure
 */
export async function validateStoredLeaseForWrite(
	deps: LeaseDeps,
	input: { key: string; presented: LeaseWriteClaim },
): Promise<
	LeaseWriteValidation | { ok: false; code: "lease_store_failed"; message: string }
> {
	const current = await readLeaseRecord(deps, input.key);
	if (current.status === "corrupt") {
		return leaseStoreFailed(
			`lease record is corrupt; the write gate fails closed. ${current.message}`,
		);
	}
	const epoch = await readActivationEpochRecord(deps);
	if (epoch.status === "corrupt") {
		return leaseStoreFailed(
			`activation-epoch record is corrupt; the write gate fails closed. ${epoch.message}`,
		);
	}
	const overlaid =
		current.status === "present"
			? { ...current.lease, activation_epoch: epoch.epoch }
			: undefined;
	return validateLeaseForWrite(overlaid, input.presented, deps.clock);
}

// --- Activation epoch (R27 / AE12 substrate) ---------------------------------

/**
 * Serialize a lease-validated commit against activation-epoch advance.
 * Callers acquire this barrier before their narrower record lock, giving every
 * mutation the fixed order epoch -> record and keeping the live epoch stable
 * from validation through durable commit.
 */
export async function withActivationEpochBarrier<T extends { ok: boolean }>(
	deps: LeaseDeps,
	input: { holderId: string },
	body: () => Promise<T>,
): Promise<T | ActivationEpochBarrierFailure> {
	const dirs = await ensureLeaseDirs(deps);
	if (!dirs.ok) {
		return { ok: false, code: "epoch_store_failed", message: dirs.message };
	}
	const outcome = await withLocalActivationBarrier(
		epochLockPath(deps.paths),
		async () =>
			await withExclusiveFileLock<T>(
				deps.fs,
				{
					lockPath: epochLockPath(deps.paths),
					holderId: input.holderId,
					staleAfterMs: LOCKFILE_STALE_AFTER_MS,
					clock: deps.clock,
				},
				body,
			),
	);
	if (isLockFailure(outcome)) {
		return {
			ok: false,
			code: "epoch_store_failed",
			message: redactUnsafeText(
				`epoch barrier unavailable: ${outcome.failure.message}`,
			),
		};
	}
	return outcome;
}

/**
 * Read + classify the activation-epoch record: an absent file is epoch 1 by
 * definition; a corrupt file is a typed classification so `repair status`
 * can project it instead of crashing.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @returns The current epoch, or the corrupt classification
 */
export async function readActivationEpochRecord(
	deps: LeaseDeps,
): Promise<{ status: "ok"; epoch: number } | { status: "corrupt"; message: string }> {
	const read = await readDurableFile(deps.fs, deps.paths.state.epochFile);
	if (read.status === "missing") {
		return { status: "ok", epoch: INITIAL_ACTIVATION_EPOCH };
	}
	if (read.status === "unreadable") {
		return { status: "corrupt", message: read.message };
	}
	const parsed = parseDurableRecord(read.raw, "activation-epoch");
	if (!parsed.ok) {
		return {
			status: "corrupt",
			message: redactUnsafeText(
				`activation-epoch record is corrupt (${parsed.code}).`,
			),
		};
	}
	return { status: "ok", epoch: parsed.payload.epoch };
}

/**
 * Current activation epoch; defaults to 1 when the record file is absent
 * (spec A4). A corrupt record THROWS — silently reporting epoch 1 would
 * un-fence every pre-advance holder; callers that need the typed
 * classification use `readActivationEpochRecord`.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @returns The current epoch (>= 1)
 */
export async function readActivationEpoch(deps: LeaseDeps): Promise<number> {
	const record = await readActivationEpochRecord(deps);
	if (record.status === "corrupt") {
		throw new Error(record.message);
	}
	return record.epoch;
}

/**
 * Advance the activation epoch by CAS on the expected value (U7 performs the
 * real activation; this is the substrate). Inside the exclusive epoch lock:
 * current == expected writes expected + 1; current == expected + 1 is the
 * already-applied advance and an idempotent no-op success (AE12 "reapply is
 * idempotent"); anything else is a typed `epoch_conflict`. Store faults
 * (corrupt record, contended lock, failed flush) are `epoch_store_failed`.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param input - The epoch the caller believes is current
 * @returns The epoch now in force, or one typed refusal
 */
export async function advanceActivationEpoch(
	deps: LeaseDeps,
	input: { expectedEpoch: number },
): Promise<ActivationEpochAdvanceResult> {
	assertPositiveInteger(input.expectedEpoch, "expectedEpoch");
	const dirs = await ensureLeaseDirs(deps);
	if (!dirs.ok) {
		return { ok: false, code: "epoch_store_failed", message: dirs.message };
	}
	const advanceUnderEpochLock = async () =>
		await withExclusiveFileLock<ActivationEpochAdvanceResult>(
			deps.fs,
			{
				lockPath: epochLockPath(deps.paths),
				holderId: `epoch-advance-${input.expectedEpoch}`,
				staleAfterMs: LOCKFILE_STALE_AFTER_MS,
				clock: deps.clock,
			},
			async () => {
				const record = await readActivationEpochRecord(deps);
				if (record.status === "corrupt") {
					return {
						ok: false,
						code: "epoch_store_failed",
						message: record.message,
					};
				}
				if (record.epoch === input.expectedEpoch + 1) {
					return { ok: true, epoch: record.epoch };
				}
				if (record.epoch !== input.expectedEpoch) {
					return {
						ok: false,
						code: "epoch_conflict",
						message: `expected epoch ${input.expectedEpoch} but the current epoch is ${record.epoch}.`,
					};
				}
				const next = record.epoch + 1;
				const written = await writeDurableFile(deps.fs, {
					path: deps.paths.state.epochFile,
					contents: encodeDurableRecord("activation-epoch", { epoch: next }),
				});
				if (!written.ok) {
					return {
						ok: false,
						code: "epoch_store_failed",
						message: `epoch write failed: ${written.failure.message}`,
					};
				}
				return { ok: true, epoch: next };
			},
		);
	const outcome = await withLocalActivationBarrier(
		epochLockPath(deps.paths),
		advanceUnderEpochLock,
	);
	if (isLockFailure(outcome)) {
		return {
			ok: false,
			code: "epoch_store_failed",
			message: redactUnsafeText(
				`epoch lock unavailable: ${outcome.failure.message}`,
			),
		};
	}
	return outcome;
}

// --- Repair projection -------------------------------------------------------

/**
 * Every durable lease with its liveness classification, sorted by key
 * (`repair status` projects these). A missing leases dir is an empty
 * projection; unparseable record files are skipped — corruption repair has
 * its own surfaces, and a projection row cannot carry it.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @returns Sorted lease projections
 */
export async function listLeases(
	deps: LeaseDeps,
): Promise<readonly LeaseProjection[]> {
	const dirStat = await deps.fs.lstat(deps.paths.state.leasesDir);
	if (dirStat === undefined || dirStat.kind !== "directory") return [];
	const now = deps.clock();
	const projections: LeaseProjection[] = [];
	for (const entry of await deps.fs.readDirectory(deps.paths.state.leasesDir)) {
		if (!entry.endsWith(".json")) continue;
		const read = await readDurableFile(
			deps.fs,
			join(deps.paths.state.leasesDir, entry),
		);
		if (read.status !== "present") continue;
		const parsed = parseDurableRecord(read.raw, "run-lease");
		if (!parsed.ok) continue;
		projections.push(projectionOf(parsed.payload, now));
	}
	return projections.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
