import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	BROWSER_USE_ROOT_KINDS,
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
	makeVolatileOverlayFs,
	type VolatileOverlayFs,
} from "./browser-use-platform-test-helpers";
import {
	casReplaceRecord,
	listOrphanTempFiles,
	readDurableFile,
	withExclusiveFileLock,
	writeDurableFile,
} from "./browser-use-store";

// =========================================================================
// Same-filesystem durable-write proof (platform plan 2026-07-21-002 U2).
//
// Ledger rows S7-S9 and V1: the writeDurableFile crash truth table at all
// three flush points (volatile overlay), the armed-EXDEV cross-device
// refusal, two-writer CAS conflict + lockfile contention, and real-fs
// private modes (admitted roots 0700, durable files 0600). Records here are
// opaque strings with a local revision extractor — parsing stays with
// browser-use-schemas by design.
// =========================================================================

const realFs = createDefaultPlatformFs();
const xdg = makeTempXdgEnv();
const overlays: VolatileOverlayFs[] = [];

const OLD_RECORD = '{"revision":1,"value":"old"}\n';
const NEW_RECORD = '{"revision":2,"value":"new"}\n';

function makeOverlay(): VolatileOverlayFs {
	const overlay = makeVolatileOverlayFs();
	overlays.push(overlay);
	return overlay;
}

// The store's revision seam: extract-or-corrupt over opaque record text.
function revisionOf(raw: string): number | undefined {
	try {
		const parsed = JSON.parse(raw) as { revision?: unknown };
		return typeof parsed.revision === "number" ? parsed.revision : undefined;
	} catch {
		return undefined;
	}
}

// Overlay store seeded with one durably committed OLD record.
async function seedOverlayStore(): Promise<{
	overlay: VolatileOverlayFs;
	path: string;
}> {
	const overlay = makeOverlay();
	await overlay.fs.mkdir("/store", { recursive: true, mode: 0o700 });
	const path = "/store/rec.json";
	const seeded = await writeDurableFile(overlay.fs, {
		path,
		contents: OLD_RECORD,
	});
	expect(seeded).toEqual({ ok: true });
	return { overlay, path };
}

afterAll(() => {
	xdg.dispose();
	for (const overlay of overlays) {
		overlay.dispose();
	}
});

describe("writeDurableFile crash truth table (R13; S7)", () => {
	test("S7: crash before the content flush leaves prior bytes intact and no durable temp", async () => {
		const { overlay, path } = await seedOverlayStore();
		overlay.hooks.onBeforeFsync = () => {
			overlay.hooks.onBeforeFsync = undefined;
			overlay.crash();
		};
		const result = await writeDurableFile(overlay.fs, {
			path,
			contents: NEW_RECORD,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.failure.code).toBe("store_flush_failed");
		expect(result.failure.message).toContain("ESIMCRASH");
		// Prior target survives complete; the unflushed temp died volatile.
		expect(await overlay.fs.readTextFile(path)).toBe(OLD_RECORD);
		expect(await listOrphanTempFiles(overlay.fs, "/store")).toEqual([]);
	});

	test("S7: crash after the content flush, pre-rename, leaves prior bytes plus one complete temp orphan", async () => {
		const { overlay, path } = await seedOverlayStore();
		overlay.hooks.onAfterFsync = () => {
			overlay.hooks.onAfterFsync = undefined;
			overlay.crash();
		};
		const result = await writeDurableFile(overlay.fs, {
			path,
			contents: NEW_RECORD,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.failure.code).toBe("store_flush_failed");
		expect(await overlay.fs.readTextFile(path)).toBe(OLD_RECORD);
		const orphans = await listOrphanTempFiles(overlay.fs, "/store");
		expect(orphans).toHaveLength(1);
		// The orphan is COMPLETE (flushed before the crash), never torn.
		expect(await overlay.fs.readTextFile(orphans[0] as string)).toBe(NEW_RECORD);
	});

	test("S7: crash after rename, pre-dir-flush — reader sees a complete record, never a torn file", async () => {
		const { overlay, path } = await seedOverlayStore();
		overlay.hooks.onAfterRename = () => {
			overlay.hooks.onAfterRename = undefined;
			overlay.crash();
		};
		const result = await writeDurableFile(overlay.fs, {
			path,
			contents: NEW_RECORD,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.failure.code).toBe("store_flush_failed");
		const raw = await overlay.fs.readTextFile(path);
		// EITHER prior or next, both complete: the record parses and is one of
		// the two full generations (the overlay deterministically keeps prior).
		expect([OLD_RECORD, NEW_RECORD]).toContain(raw);
		expect(raw).toBe(OLD_RECORD);
		expect(() => JSON.parse(raw)).not.toThrow();
	});

	test("S7: the full pipeline (flush + rename + dir flush) survives a crash with the NEW record and no orphans", async () => {
		const { overlay, path } = await seedOverlayStore();
		const result = await writeDurableFile(overlay.fs, {
			path,
			contents: NEW_RECORD,
		});
		expect(result).toEqual({ ok: true });
		overlay.crash();
		expect(await overlay.fs.readTextFile(path)).toBe(NEW_RECORD);
		expect(await listOrphanTempFiles(overlay.fs, "/store")).toEqual([]);
	});
});

describe("cross-device refusal (R13; S8)", () => {
	test("S8: an EXDEV rename is a typed store_cross_device refusal and the target is untouched", async () => {
		const { overlay, path } = await seedOverlayStore();
		overlay.failRenameExdev = true;
		const result = await writeDurableFile(overlay.fs, {
			path,
			contents: NEW_RECORD,
		});
		overlay.failRenameExdev = false;
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.failure.code).toBe("store_cross_device");
		// Refusal IS the contract: copy-verify-commit is named as unimplemented
		// and the message never echoes a path.
		expect(result.failure.message).toContain("copy-verify-commit");
		expect(result.failure.message).not.toContain("/store");
		expect(await overlay.fs.readTextFile(path)).toBe(OLD_RECORD);
		// No crash happened, so the flushed temp was reclaimed immediately.
		expect(await listOrphanTempFiles(overlay.fs, "/store")).toEqual([]);
	});
});

describe("readDurableFile (missing vs unreadable vs present)", () => {
	test("a present record returns its raw bytes untouched", async () => {
		const path = join(xdg.base, "read-present.json");
		writeFileSync(path, OLD_RECORD, { mode: 0o600 });
		expect(await readDurableFile(realFs, path)).toEqual({
			status: "present",
			raw: OLD_RECORD,
		});
	});

	test("a missing record is status missing, distinct from unreadable", async () => {
		expect(
			await readDurableFile(realFs, join(xdg.base, "read-missing.json")),
		).toEqual({ status: "missing" });
	});

	test("an unreadable record carries a redacted message naming only the errno code", async () => {
		const path = join(xdg.base, "read-unreadable.json");
		mkdirSync(path, { recursive: true });
		const read = await readDurableFile(realFs, path);
		expect(read.status).toBe("unreadable");
		if (read.status !== "unreadable") throw new Error("unreachable");
		expect(read.message).toContain("EISDIR");
		expect(read.message).not.toContain(xdg.base);
	});
});

describe("exclusive lockfile (S9 contention + stale reclaim)", () => {
	const lockDir = join(xdg.base, "locks");
	mkdirSync(lockDir, { recursive: true, mode: 0o700 });

	test("S9: a fresh standing lock is typed store_lock_contended naming the holder; the body never runs", async () => {
		const lockPath = join(lockDir, "fresh.lock");
		const clock = fixedClock(10_000);
		await realFs.createExclusive(
			lockPath,
			JSON.stringify({ holder_id: "writer-a", acquired_at_epoch_ms: 9_000 }),
			0o600,
		);
		let bodyRan = false;
		const result = await withExclusiveFileLock(
			realFs,
			{ lockPath, holderId: "writer-b", staleAfterMs: 5_000, clock: clock.now },
			async () => {
				bodyRan = true;
				return "won";
			},
		);
		expect(bodyRan).toBe(false);
		expect(result).toEqual({
			ok: false,
			failure: {
				code: "store_lock_contended",
				message: expect.stringContaining("writer-a"),
			},
		});
		await realFs.unlink(lockPath);
	});

	test("a lock aged exactly staleAfterMs is still fresh (strictly-greater staleness)", async () => {
		const lockPath = join(lockDir, "boundary.lock");
		const clock = fixedClock(10_000);
		await realFs.createExclusive(
			lockPath,
			JSON.stringify({ holder_id: "writer-a", acquired_at_epoch_ms: 5_000 }),
			0o600,
		);
		const result = await withExclusiveFileLock(
			realFs,
			{ lockPath, holderId: "writer-b", staleAfterMs: 5_000, clock: clock.now },
			async () => "won",
		);
		expect(result).toMatchObject({
			ok: false,
			failure: { code: "store_lock_contended" },
		});
		await realFs.unlink(lockPath);
	});

	test("a stale lock is reclaimed after ONE retry; the body runs and the lock is released", async () => {
		const lockPath = join(lockDir, "stale.lock");
		const clock = fixedClock(100_000);
		await realFs.createExclusive(
			lockPath,
			JSON.stringify({ holder_id: "dead-writer", acquired_at_epoch_ms: 1_000 }),
			0o600,
		);
		const result = await withExclusiveFileLock(
			realFs,
			{ lockPath, holderId: "writer-b", staleAfterMs: 5_000, clock: clock.now },
			async () => "won",
		);
		expect(result).toBe("won");
		expect(await readDurableFile(realFs, lockPath)).toEqual({
			status: "missing",
		});
	});

	test("only one stale observer can enter the reclamation sequence", async () => {
		const lockPath = join(lockDir, "simultaneous-reclaim.lock");
		const clock = fixedClock(100_000);
		await realFs.createExclusive(
			lockPath,
			JSON.stringify({ holder_id: "dead-writer", acquired_at_epoch_ms: 1_000 }),
			0o600,
		);
		let releaseUnlink!: () => void;
		const unlinkGate = new Promise<void>((resolve) => {
			releaseUnlink = resolve;
		});
		let reachedUnlink!: () => void;
		const unlinkReached = new Promise<void>((resolve) => {
			reachedUnlink = resolve;
		});
		const pausedFs = {
			...realFs,
			async unlink(path: string): Promise<void> {
				if (path === lockPath) {
					reachedUnlink();
					await unlinkGate;
				}
				await realFs.unlink(path);
			},
		};
		const winner = withExclusiveFileLock(
			pausedFs,
			{ lockPath, holderId: "writer-a", staleAfterMs: 5_000, clock: clock.now },
			async () => "winner",
		);
		await unlinkReached;
		let loserRan = false;
		const loser = await withExclusiveFileLock(
			realFs,
			{ lockPath, holderId: "writer-b", staleAfterMs: 5_000, clock: clock.now },
			async () => {
				loserRan = true;
				return "loser";
			},
		);
		expect(loserRan).toBe(false);
		expect(loser).toMatchObject({
			ok: false,
			failure: { code: "store_lock_contended" },
		});
		releaseUnlink();
		expect(await winner).toBe("winner");
	});

	test("a reclaimed holder cannot unlink its successor's nonce-owned lock", async () => {
		const lockPath = join(lockDir, "reclaimed-holder.lock");
		const clock = fixedClock(10_000);
		let releaseA!: () => void;
		const bodyA = new Promise<void>((resolve) => {
			releaseA = resolve;
		});
		let enteredA!: () => void;
		const enteredAPromise = new Promise<void>((resolve) => {
			enteredA = resolve;
		});
		const writerA = withExclusiveFileLock(
			realFs,
			{ lockPath, holderId: "writer-a", staleAfterMs: 5_000, clock: clock.now },
			async () => {
				enteredA();
				await bodyA;
				return "a";
			},
		);
		await enteredAPromise;
		clock.advance(5_001);

		let releaseB!: () => void;
		const bodyB = new Promise<void>((resolve) => {
			releaseB = resolve;
		});
		let enteredB!: () => void;
		const enteredBPromise = new Promise<void>((resolve) => {
			enteredB = resolve;
		});
		const writerB = withExclusiveFileLock(
			realFs,
			{ lockPath, holderId: "writer-b", staleAfterMs: 5_000, clock: clock.now },
			async () => {
				enteredB();
				await bodyB;
				return "b";
			},
		);
		await enteredBPromise;

		releaseA();
		expect(await writerA).toBe("a");
		let writerCRan = false;
		const writerC = await withExclusiveFileLock(
			realFs,
			{ lockPath, holderId: "writer-c", staleAfterMs: 5_000, clock: clock.now },
			async () => {
				writerCRan = true;
				return "c";
			},
		);
		expect(writerCRan).toBe(false);
		expect(writerC).toMatchObject({
			ok: false,
			failure: { code: "store_lock_contended" },
		});

		releaseB();
		expect(await writerB).toBe("b");
		expect(await readDurableFile(realFs, lockPath)).toEqual({ status: "missing" });
	});

	test("a torn/garbage lockfile is reclaimed like a stale one — it can never age out", async () => {
		const lockPath = join(lockDir, "garbage.lock");
		const clock = fixedClock(10_000);
		await realFs.createExclusive(lockPath, "{not-json", 0o600);
		const result = await withExclusiveFileLock(
			realFs,
			{ lockPath, holderId: "writer-b", staleAfterMs: 5_000, clock: clock.now },
			async () => "won",
		);
		expect(result).toBe("won");
	});

	test("a throwing body still releases the lock in finally", async () => {
		const lockPath = join(lockDir, "throwing.lock");
		const clock = fixedClock(10_000);
		await expect(
			withExclusiveFileLock(
				realFs,
				{ lockPath, holderId: "writer-a", staleAfterMs: 5_000, clock: clock.now },
				async () => {
					throw new Error("body failed");
				},
			),
		).rejects.toThrow("body failed");
		expect(await readDurableFile(realFs, lockPath)).toEqual({
			status: "missing",
		});
	});
});

describe("casReplaceRecord (S9 two writers)", () => {
	async function makeCasStore(): Promise<{
		overlay: VolatileOverlayFs;
		path: string;
		lockPath: string;
		clock: ReturnType<typeof fixedClock>;
	}> {
		const overlay = makeOverlay();
		await overlay.fs.mkdir("/store", { recursive: true, mode: 0o700 });
		await overlay.fs.mkdir("/locks", { recursive: true, mode: 0o700 });
		return {
			overlay,
			path: "/store/rec.json",
			lockPath: "/locks/rec.lock",
			clock: fixedClock(10_000),
		};
	}

	test("expectedRevision null creates a missing record; a second create conflicts", async () => {
		const { overlay, path, lockPath, clock } = await makeCasStore();
		const created = await casReplaceRecord(overlay.fs, {
			path,
			lockPath,
			holderId: "writer-a",
			staleAfterMs: 60_000,
			clock: clock.now,
			expectedRevision: null,
			revisionOf,
			nextContents: OLD_RECORD,
		});
		expect(created).toEqual({ ok: true });
		expect(await overlay.fs.readTextFile(path)).toBe(OLD_RECORD);
		const again = await casReplaceRecord(overlay.fs, {
			path,
			lockPath,
			holderId: "writer-b",
			staleAfterMs: 60_000,
			clock: clock.now,
			expectedRevision: null,
			revisionOf,
			nextContents: NEW_RECORD,
		});
		expect(again).toMatchObject({
			ok: false,
			failure: { code: "store_record_conflict" },
		});
		expect(await overlay.fs.readTextFile(path)).toBe(OLD_RECORD);
	});

	test("S9: two writers with the same expectedRevision — the second gets store_record_conflict and writes nothing", async () => {
		const { overlay, path, lockPath, clock } = await makeCasStore();
		await overlay.fs.writeFileDurable(path, OLD_RECORD, 0o600);
		const first = await casReplaceRecord(overlay.fs, {
			path,
			lockPath,
			holderId: "writer-a",
			staleAfterMs: 60_000,
			clock: clock.now,
			expectedRevision: 1,
			revisionOf,
			nextContents: NEW_RECORD,
		});
		expect(first).toEqual({ ok: true });
		const second = await casReplaceRecord(overlay.fs, {
			path,
			lockPath,
			holderId: "writer-b",
			staleAfterMs: 60_000,
			clock: clock.now,
			expectedRevision: 1,
			revisionOf,
			nextContents: '{"revision":2,"value":"lost-update"}\n',
		});
		expect(second).toMatchObject({
			ok: false,
			failure: {
				code: "store_record_conflict",
				message: expect.stringContaining("expected 1"),
			},
		});
		expect(await overlay.fs.readTextFile(path)).toBe(NEW_RECORD);
		expect(await listOrphanTempFiles(overlay.fs, "/store")).toEqual([]);
	});

	test("S9: interleaved writers on one lockPath — the paused holder wins, the intruder is store_lock_contended", async () => {
		const { overlay, path, lockPath, clock } = await makeCasStore();
		await overlay.fs.writeFileDurable(path, OLD_RECORD, 0o600);
		const pause = overlay.pauseAfterRead();
		const first = casReplaceRecord(overlay.fs, {
			path,
			lockPath,
			holderId: "writer-a",
			staleAfterMs: 60_000,
			clock: clock.now,
			expectedRevision: 1,
			revisionOf,
			nextContents: NEW_RECORD,
		});
		// Writer A holds the lock with its record read paused mid-flight.
		expect(await pause.reached).toBe(path);
		const second = await casReplaceRecord(overlay.fs, {
			path,
			lockPath,
			holderId: "writer-b",
			staleAfterMs: 60_000,
			clock: clock.now,
			expectedRevision: 1,
			revisionOf,
			nextContents: '{"revision":2,"value":"intruder"}\n',
		});
		expect(second).toMatchObject({
			ok: false,
			failure: {
				code: "store_lock_contended",
				message: expect.stringContaining("writer-a"),
			},
		});
		pause.release();
		expect(await first).toEqual({ ok: true });
		expect(await overlay.fs.readTextFile(path)).toBe(NEW_RECORD);
	});

	test("a missing record with a numeric expectedRevision is store_record_missing", async () => {
		const { overlay, path, lockPath, clock } = await makeCasStore();
		const result = await casReplaceRecord(overlay.fs, {
			path,
			lockPath,
			holderId: "writer-a",
			staleAfterMs: 60_000,
			clock: clock.now,
			expectedRevision: 1,
			revisionOf,
			nextContents: NEW_RECORD,
		});
		expect(result).toMatchObject({
			ok: false,
			failure: { code: "store_record_missing" },
		});
	});

	test("a record whose revision cannot be extracted is store_record_corrupt and stays untouched", async () => {
		const { overlay, path, lockPath, clock } = await makeCasStore();
		await overlay.fs.writeFileDurable(path, '{"torn":', 0o600);
		const result = await casReplaceRecord(overlay.fs, {
			path,
			lockPath,
			holderId: "writer-a",
			staleAfterMs: 60_000,
			clock: clock.now,
			expectedRevision: 1,
			revisionOf,
			nextContents: NEW_RECORD,
		});
		expect(result).toMatchObject({
			ok: false,
			failure: { code: "store_record_corrupt" },
		});
		expect(await overlay.fs.readTextFile(path)).toBe('{"torn":');
	});
});

describe("private modes on the real filesystem (R12; V1)", () => {
	test("V1: admitted roots stat 0700 and durable files stat 0600", async () => {
		const scoped = makeTempXdgEnv();
		try {
			const opened = await openBrowserUsePaths(realFs, scoped.env);
			expect(opened.ok).toBe(true);
			if (!opened.ok) throw new Error("unreachable");
			for (const kind of BROWSER_USE_ROOT_KINDS) {
				const stat = await realFs.lstat(opened.paths.resolution.roots[kind]);
				expect(stat?.kind).toBe("directory");
				expect(stat?.mode).toBe(0o700);
			}
			await realFs.mkdir(join(opened.paths.state.runsDir, "run-1"), {
				recursive: true,
				mode: 0o700,
			});
			const runFile = opened.paths.state.runFile("run-1");
			const written = await writeDurableFile(realFs, {
				path: runFile,
				contents: OLD_RECORD,
			});
			expect(written).toEqual({ ok: true });
			expect((await realFs.lstat(runFile))?.mode).toBe(0o600);
			expect(await realFs.readTextFile(runFile)).toBe(OLD_RECORD);
		} finally {
			scoped.dispose();
		}
	});
});

describe("listOrphanTempFiles repair projection", () => {
	test("walks the tree and lists only pid-counter temp siblings, sorted", async () => {
		const root = join(xdg.base, "orphan-walk");
		mkdirSync(join(root, "nested"), { recursive: true, mode: 0o700 });
		writeFileSync(join(root, "rec.json"), OLD_RECORD, { mode: 0o600 });
		writeFileSync(join(root, "rec.json.tmp-123-4"), NEW_RECORD, {
			mode: 0o600,
		});
		writeFileSync(join(root, "nested", "x.json.tmp-9-1"), "x", { mode: 0o600 });
		writeFileSync(join(root, "nested", "keep.txt"), "keep", { mode: 0o600 });
		// A tmp-ish name without the pid-counter shape is NOT an orphan.
		writeFileSync(join(root, "rec.json.tmp-abc"), "not-ours", { mode: 0o600 });
		expect(await listOrphanTempFiles(realFs, root)).toEqual([
			join(root, "nested", "x.json.tmp-9-1"),
			join(root, "rec.json.tmp-123-4"),
		]);
	});

	test("a missing directory is an empty projection, not an error", async () => {
		expect(
			await listOrphanTempFiles(realFs, join(xdg.base, "no-such-dir")),
		).toEqual([]);
	});

	test("an unreadable subtree is skipped without hiding other orphans", async () => {
		const root = join(xdg.base, "orphan-unreadable");
		const unreadable = join(root, "unreadable");
		mkdirSync(unreadable, { recursive: true, mode: 0o700 });
		writeFileSync(join(root, "visible.json.tmp-1-1"), "visible", {
			mode: 0o600,
		});
		const faultingFs = {
			...realFs,
			async readDirectory(path: string) {
				if (path === unreadable) {
					throw Object.assign(new Error("permission denied"), {
						code: "EACCES",
					});
				}
				return await realFs.readDirectory(path);
			},
		};
		expect(await listOrphanTempFiles(faultingFs, root)).toEqual([
			join(root, "visible.json.tmp-1-1"),
		]);
	});
});
