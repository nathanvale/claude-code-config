// ---------------------------------------------------------------------------
// Same-filesystem durable writes (platform plan 2026-07-21-002 U2, R13).
//
// The ONE durable-write mechanism every other platform module flows through:
// temp-sibling write + content fsync + rename + parent-directory fsync,
// cross-device refusal, an exclusive advisory lockfile around read-modify-
// write critical sections, and compare-and-swap record replacement keyed on
// the U1 run `revision`. Records are opaque strings here — callers supply a
// revision extractor and parse through browser-use-schemas; the store never
// imports schemas, holds no fencing/epoch logic (locks owns it), no retention
// policy, and resolves no paths (callers hand it admitted absolute paths).
//
// Crash truth table for writeDurableFile (proven against the volatile-overlay
// fake in browser-use-store.test.ts, ledger rows S7-S9/V1):
//   - crash before the content flush   -> prior target bytes intact, temp may
//     be garbage and vanishes with the volatile page cache
//   - crash after flush, pre-rename    -> prior target intact, one complete
//     durable temp orphan (listOrphanTempFiles projects it for repair)
//   - crash after rename, pre-dir-flush -> a reader sees EITHER prior or next,
//     both complete; never a torn file
//
// Import direction: imports browser-use-paths (the fs port) and
// browser-use-core only. No Date.now, no Math.random, no process.cwd(); time
// enters only through the injected clock and temp suffixes carry pid + a
// per-process counter (the writeStateFileAtomically precedent).
// ---------------------------------------------------------------------------

import { dirname, join } from "node:path";
import { redactUnsafeText } from "./browser-use-core";
import type { BrowserUsePlatformFs } from "./browser-use-paths";

// --- Typed failures ----------------------------------------------------------

/** Typed store failure; `message` is redacted and never echoes a path. */
export type StoreFailure = {
	code:
		| "store_cross_device"
		| "store_flush_failed"
		| "store_lock_contended"
		| "store_record_conflict"
		| "store_record_corrupt"
		| "store_record_missing";
	message: string;
};

/** Durable private file mode (R12); mirrors the paths admission constant. */
const PRIVATE_FILE_MODE = 0o600;

/** Temp-sibling suffix shape: `.tmp-<pid>-<seq>` (no randomness, no clock). */
const TEMP_SUFFIX_PATTERN = /\.tmp-\d+-\d+$/;

// Per-process monotonic sequence so concurrent writers in one process never
// collide on a temp sibling; pid separates processes.
let tempSequence = 0;

function storeFailure(
	code: StoreFailure["code"],
	message: string,
): { ok: false; failure: StoreFailure } {
	return { ok: false, failure: { code, message: redactUnsafeText(message) } };
}

// Error messages carry only the errno code, never the message: node error
// strings embed quoted paths that redactUnsafeText is not shaped to catch.
function errorCode(error: unknown): string {
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" && code !== "" ? code : "unknown";
}

async function unlinkBestEffort(
	fs: BrowserUsePlatformFs,
	path: string,
): Promise<void> {
	try {
		await fs.unlink(path);
	} catch {
		// Best-effort cleanup: a surviving temp is a repair projection
		// (listOrphanTempFiles), never a correctness hazard.
	}
}

type StoreWriteResult =
	| { ok: true }
	| { ok: false; failure: StoreFailure };

async function flushDurableTemp(
	fs: BrowserUsePlatformFs,
	input: { path: string; contents: string; mode: number },
): Promise<
	| { ok: true; tempPath: string }
	| { ok: false; failure: StoreFailure }
> {
	tempSequence += 1;
	const tempPath = `${input.path}.tmp-${process.pid}-${tempSequence}`;
	try {
		await fs.writeFileDurable(tempPath, input.contents, input.mode);
		return { ok: true, tempPath };
	} catch (error) {
		return storeFailure(
			"store_flush_failed",
			`durable write failed during the content flush (${errorCode(error)}).`,
		);
	}
}

async function publishDurableTemp(
	fs: BrowserUsePlatformFs,
	path: string,
	tempPath: string,
): Promise<StoreWriteResult> {
	try {
		await fs.rename(tempPath, path);
	} catch (error) {
		if (errorCode(error) === "EXDEV") {
			// No crash happened, so the flushed temp is reclaimable now instead
			// of waiting for the orphan repair sweep.
			await unlinkBestEffort(fs, tempPath);
			return storeFailure(
				"store_cross_device",
				"rename crossed filesystem devices (EXDEV); R13 refuses cross-device durable writes and copy-verify-commit is deliberately not implemented in U2.",
			);
		}
		return storeFailure(
			"store_flush_failed",
			`durable write failed at the rename step (${errorCode(error)}).`,
		);
	}
	try {
		await fs.syncDirectory(dirname(path));
	} catch (error) {
		return storeFailure(
			"store_flush_failed",
			`durable write failed at the parent-directory flush (${errorCode(error)}).`,
		);
	}
	return { ok: true };
}

// --- Durable write (R13) -----------------------------------------------------

/**
 * The one durable write: write `<path>.tmp-<pid>-<seq>` in the SAME directory,
 * fsync the file, rename over the target, fsync the parent directory. EXDEV
 * from the rename is a typed `store_cross_device` refusal — R13 rejects
 * cross-device targets and copy-verify-commit is deliberately NOT implemented
 * in U2; the refusal is the contract.
 *
 * @param fs - Platform fs port
 * @param input - Admitted absolute target path, contents, optional mode (0600)
 * @returns Ok, or one typed store failure
 */
export async function writeDurableFile(
	fs: BrowserUsePlatformFs,
	input: { path: string; contents: string; mode?: number },
): Promise<{ ok: true } | { ok: false; failure: StoreFailure }> {
	const mode = input.mode ?? PRIVATE_FILE_MODE;
	const flushed = await flushDurableTemp(fs, {
		path: input.path,
		contents: input.contents,
		mode,
	});
	if (!flushed.ok) return flushed;
	return await publishDurableTemp(fs, input.path, flushed.tempPath);
}

/**
 * Replace one durable record only when its exact standing bytes are unchanged.
 *
 * The next bytes are flushed to a complete temp sibling first. The expected
 * raw record is then re-read immediately before rename, closing the wider
 * read-to-temp-write window for callers that carry an earlier snapshot.
 *
 * @remarks
 * Cooperative writers must still share the caller's owner lock. A writer that
 * ignores both that lock and this conditional primitive can race in the final
 * check-to-rename syscall interval; ordinary filesystem rename has no portable
 * compare-and-exchange predicate.
 *
 * @param fs - Platform fs port
 * @param input - Target path, exact expected raw bytes, replacement, and mode
 * @returns Ok, or a typed conflict, corruption, missing-record, or flush failure
 *
 * @example
 * ```typescript
 * const replaced = await replaceDurableFileIfUnchanged(fs, {
 *   path,
 *   expectedRaw: standing.raw,
 *   contents: nextRaw,
 * })
 * ```
 */
export async function replaceDurableFileIfUnchanged(
	fs: BrowserUsePlatformFs,
	input: {
		path: string;
		expectedRaw: string;
		contents: string;
		mode?: number;
	},
): Promise<{ ok: true } | { ok: false; failure: StoreFailure }> {
	const flushed = await flushDurableTemp(fs, {
		path: input.path,
		contents: input.contents,
		mode: input.mode ?? PRIVATE_FILE_MODE,
	});
	if (!flushed.ok) return flushed;
	const current = await readDurableFile(fs, input.path);
	if (current.status !== "present") {
		await unlinkBestEffort(fs, flushed.tempPath);
		return storeFailure(
			current.status === "missing"
				? "store_record_missing"
				: "store_record_corrupt",
			current.status === "missing"
				? "record vanished before conditional durable replacement."
				: "record became unreadable before conditional durable replacement.",
		);
	}
	if (current.raw !== input.expectedRaw) {
		await unlinkBestEffort(fs, flushed.tempPath);
		return storeFailure(
			"store_record_conflict",
			"record bytes changed before conditional durable replacement.",
		);
	}
	return await publishDurableTemp(fs, input.path, flushed.tempPath);
}

// --- Record read (missing vs unreadable vs present) --------------------------

/**
 * Read + classify a durable record file: missing vs unreadable vs present
 * (raw). Parsing is the caller's job via `schemas.parseDurableRecord`; the
 * store moves opaque text.
 *
 * @param fs - Platform fs port
 * @param path - Admitted absolute record path
 * @returns Present raw text, missing, or unreadable with a redacted message
 */
export async function readDurableFile(
	fs: BrowserUsePlatformFs,
	path: string,
): Promise<
	| { status: "present"; raw: string }
	| { status: "missing" }
	| { status: "unreadable"; message: string }
> {
	try {
		return { status: "present", raw: await fs.readTextFile(path) };
	} catch (error) {
		if (errorCode(error) === "ENOENT") return { status: "missing" };
		return {
			status: "unreadable",
			message: redactUnsafeText(
				`record bytes could not be read (${errorCode(error)}).`,
			),
		};
	}
}

// --- Exclusive advisory lockfile ---------------------------------------------

type LockHolderProbe =
	| { state: "fresh"; holderLabel: string }
	| { state: "stale"; observedRaw: string }
	| { state: "garbage"; observedRaw: string }
	| { state: "missing" };

let lockSequence = 0;

// On EEXIST classify the standing lock: fresh (contended), stale (aged past
// staleAfterMs), garbage (torn/unparseable — it can never age out, so
// reclaiming beats a permanent wedge; the CAS below stays the correctness
// owner), or missing (released between create and read).
async function probeLockHolder(
	fs: BrowserUsePlatformFs,
	lockPath: string,
	staleAfterMs: number,
	clock: () => number,
): Promise<LockHolderProbe> {
	const read = await readDurableFile(fs, lockPath);
	if (read.status === "missing") return { state: "missing" };
	if (read.status === "unreadable") return { state: "garbage", observedRaw: "" };
	let parsed: { holder_id?: unknown; acquired_at_epoch_ms?: unknown };
	try {
		parsed = JSON.parse(read.raw) as {
			holder_id?: unknown;
			acquired_at_epoch_ms?: unknown;
		};
	} catch {
		return { state: "garbage", observedRaw: read.raw };
	}
	const acquiredAt = parsed.acquired_at_epoch_ms;
	if (typeof acquiredAt !== "number" || !Number.isFinite(acquiredAt)) {
		return { state: "garbage", observedRaw: read.raw };
	}
	if (clock() - acquiredAt > staleAfterMs) {
		return { state: "stale", observedRaw: read.raw };
	}
	const holderLabel =
		typeof parsed.holder_id === "string" && parsed.holder_id !== ""
			? parsed.holder_id
			: "unknown";
	return { state: "fresh", holderLabel };
}

async function releaseOwnedLock(
	fs: BrowserUsePlatformFs,
	lockPath: string,
	nonce: string,
): Promise<void> {
	const current = await readDurableFile(fs, lockPath);
	if (current.status !== "present") return;
	try {
		const parsed = JSON.parse(current.raw) as { nonce?: unknown };
		if (parsed.nonce !== nonce) return;
		await fs.unlink(lockPath);
	} catch {
		// A missing, unreadable, or replaced lock is no longer ours to release.
	}
}

// O_EXCL on a separate reclamation claim ensures only one process can perform
// the read-equal-unlink sequence. Without it, two stale observers could both
// pass the equality check and the slower one could unlink the faster one's
// successor lock.
async function reclaimLockIfUnchanged(
	fs: BrowserUsePlatformFs,
	lockPath: string,
	observedRaw: string,
	nonce: string,
): Promise<boolean> {
	const reclaimPath = `${lockPath}.reclaim`;
	const reclaimNonce = `${nonce}:reclaim`;
	try {
		await fs.createExclusive(
			reclaimPath,
			`${JSON.stringify({ nonce: reclaimNonce })}\n`,
			PRIVATE_FILE_MODE,
		);
	} catch {
		return false;
	}
	try {
		const current = await readDurableFile(fs, lockPath);
		if (current.status !== "present" || current.raw !== observedRaw) return false;
		try {
			await fs.unlink(lockPath);
			return true;
		} catch {
			return false;
		}
	} finally {
		await releaseOwnedLock(fs, reclaimPath, reclaimNonce);
	}
}

async function acquireLockFile(
	fs: BrowserUsePlatformFs,
	input: {
		lockPath: string;
		holderId: string;
		staleAfterMs: number;
		clock: () => number;
	},
): Promise<{ ok: true; nonce: string } | { ok: false; failure: StoreFailure }> {
	lockSequence += 1;
	const nonce = `${process.pid}:${lockSequence}:${input.holderId}`;
	// Attempt, then at most ONE stale-reclaim retry (spec A3).
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const contents = `${JSON.stringify({
			holder_id: input.holderId,
			acquired_at_epoch_ms: input.clock(),
			nonce,
		})}\n`;
		try {
			await fs.createExclusive(input.lockPath, contents, PRIVATE_FILE_MODE);
			return { ok: true, nonce };
		} catch (error) {
			if (errorCode(error) !== "EEXIST") {
				return storeFailure(
					"store_flush_failed",
					`lock file creation failed (${errorCode(error)}).`,
				);
			}
		}
		if (attempt === 1) break;
		const holder = await probeLockHolder(
			fs,
			input.lockPath,
			input.staleAfterMs,
			input.clock,
		);
		if (holder.state === "fresh") {
			return storeFailure(
				"store_lock_contended",
				`lock is held by another writer (holder ${holder.holderLabel}).`,
			);
		}
		if (
			(holder.state === "stale" || holder.state === "garbage") &&
			!(await reclaimLockIfUnchanged(
				fs,
				input.lockPath,
				holder.observedRaw,
				nonce,
			))
		) {
			return storeFailure(
				"store_lock_contended",
				"lock ownership changed during stale reclamation.",
			);
		}
		// "missing" means the holder released between create and read; the loop
		// simply retries the exclusive create once.
	}
	return storeFailure(
		"store_lock_contended",
		"lock remained held across the single stale-reclaim retry.",
	);
}

/**
 * Exclusive advisory lockfile around a read-modify-write critical section.
 * The lock path lives under `paths.runtime.locksDir` (R11). On EEXIST the
 * standing lock's `acquired_at_epoch_ms` is aged against `staleAfterMs`
 * through the injected clock. A separate exclusive reclamation claim
 * serializes stale/torn removal before one retry; fresh locks are typed
 * contention. Finally-release unlinks only this acquisition's nonce, never a
 * reclaimed successor.
 *
 * @param fs - Platform fs port
 * @param input - Lock path, holder id, staleness window, injected clock
 * @param body - Critical section to run under the lock
 * @returns The body's result, or the typed acquisition failure
 */
export async function withExclusiveFileLock<T>(
	fs: BrowserUsePlatformFs,
	input: {
		lockPath: string;
		holderId: string;
		staleAfterMs: number;
		clock: () => number;
	},
	body: () => Promise<T>,
): Promise<T | { ok: false; failure: StoreFailure }> {
	const acquired = await acquireLockFile(fs, input);
	if (!acquired.ok) return acquired;
	try {
		return await body();
	} finally {
		// Release only the nonce this acquisition published. A delayed holder
		// must never unlink the successor that reclaimed its stale lock.
		await releaseOwnedLock(fs, input.lockPath, acquired.nonce);
	}
}

// --- Compare-and-swap record replacement -------------------------------------

/**
 * CAS record replacement (the R13 lock + validation + rename pipeline; the U1
 * run `revision` is the token). Inside the exclusive lock: read current ->
 * extract revision -> compare to expected -> reject `store_record_conflict`
 * on mismatch -> `writeDurableFile(next)`. `expectedRevision: null` means
 * "must not exist yet" (create). A rejected CAS writes NOTHING.
 *
 * @param fs - Platform fs port
 * @param input - Record path, lock coordinates, expected revision, extractor,
 *   and the next full record contents
 * @returns Ok, or one typed store failure
 */
export async function casReplaceRecord(
	fs: BrowserUsePlatformFs,
	input: {
		path: string;
		lockPath: string;
		holderId: string;
		staleAfterMs: number;
		clock: () => number;
		expectedRevision: number | null;
		/** `undefined` classifies the standing record as corrupt. */
		revisionOf: (raw: string) => number | undefined;
		nextContents: string;
	},
): Promise<{ ok: true } | { ok: false; failure: StoreFailure }> {
	return await withExclusiveFileLock<
		{ ok: true } | { ok: false; failure: StoreFailure }
	>(
		fs,
		{
			lockPath: input.lockPath,
			holderId: input.holderId,
			staleAfterMs: input.staleAfterMs,
			clock: input.clock,
		},
		async () => {
			const current = await readDurableFile(fs, input.path);
			if (input.expectedRevision === null) {
				if (current.status === "present") {
					return storeFailure(
						"store_record_conflict",
						"record already exists; the create expected it absent.",
					);
				}
				if (current.status === "unreadable") {
					return storeFailure(
						"store_record_corrupt",
						"record exists but its bytes are unreadable.",
					);
				}
			} else {
				if (current.status === "missing") {
					return storeFailure(
						"store_record_missing",
						`record is missing; expected revision ${input.expectedRevision}.`,
					);
				}
				if (current.status === "unreadable") {
					return storeFailure(
						"store_record_corrupt",
						"record exists but its bytes are unreadable.",
					);
				}
				const revision = input.revisionOf(current.raw);
				if (revision === undefined) {
					return storeFailure(
						"store_record_corrupt",
						"record revision could not be extracted.",
					);
				}
				if (revision !== input.expectedRevision) {
					return storeFailure(
						"store_record_conflict",
						`record revision ${revision} does not match expected ${input.expectedRevision}.`,
					);
				}
			}
			return await writeDurableFile(fs, {
				path: input.path,
				contents: input.nextContents,
			});
		},
	);
}

// --- Repair projections ------------------------------------------------------

/**
 * Orphan temp files under a directory tree: complete durable temps left by a
 * crash after the content flush but before the rename committed. `repair
 * status` projects them; a missing directory is an empty projection.
 *
 * @param fs - Platform fs port
 * @param dir - Admitted absolute directory to walk
 * @returns Sorted absolute orphan temp paths
 */
export async function listOrphanTempFiles(
	fs: BrowserUsePlatformFs,
	dir: string,
): Promise<readonly string[]> {
	const rootStat = await fs.lstat(dir);
	if (rootStat === undefined || rootStat.kind !== "directory") return [];
	const orphans: string[] = [];
	const pending: string[] = [dir];
	while (pending.length > 0) {
		const current = pending.pop();
		if (current === undefined) break;
		let entries: readonly string[];
		try {
			entries = await fs.readDirectory(current);
		} catch {
			// Repair projection is best-effort: one unreadable subtree must not
			// hide every other actionable orphan.
			continue;
		}
		for (const entry of entries) {
			const entryPath = join(current, entry);
			let stat: Awaited<ReturnType<BrowserUsePlatformFs["lstat"]>>;
			try {
				stat = await fs.lstat(entryPath);
			} catch {
				continue;
			}
			if (stat === undefined) continue;
			if (stat.kind === "directory") {
				pending.push(entryPath);
				continue;
			}
			if (stat.kind === "file" && TEMP_SUFFIX_PATTERN.test(entry)) {
				orphans.push(entryPath);
			}
		}
	}
	return orphans.sort();
}

/**
 * Remove only temp files recognized by `listOrphanTempFiles`. Reapplication
 * converges when another repair already removed a listed path.
 */
export async function removeOrphanTempFiles(
	fs: BrowserUsePlatformFs,
	dir: string,
): Promise<{ ok: true; removed: number } | { ok: false; failure: StoreFailure }> {
	const orphans = await listOrphanTempFiles(fs, dir);
	const parents = new Set<string>();
	let removed = 0;
	for (const orphan of orphans) {
		try {
			await fs.unlink(orphan);
			removed += 1;
			parents.add(dirname(orphan));
		} catch (error) {
			if (errorCode(error) === "ENOENT") continue;
			return storeFailure(
				"store_flush_failed",
				`orphan temp removal failed (${errorCode(error)}).`,
			);
		}
	}
	for (const parent of parents) {
		try {
			await fs.syncDirectory(parent);
		} catch (error) {
			return storeFailure(
				"store_flush_failed",
				`orphan temp directory flush failed (${errorCode(error)}).`,
			);
		}
	}
	return { ok: true, removed };
}
