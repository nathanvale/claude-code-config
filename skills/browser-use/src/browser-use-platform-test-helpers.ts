// ---------------------------------------------------------------------------
// Shared platform test helpers (platform plan 2026-07-21-002 U2).
//
// Cross-module fixtures for the U2 substrate tests: makeTempXdgEnv (real temp
// XDG roots), fixedClock (the injectable clock's second adapter), and
// makeVolatileOverlayFs — the volatile-overlay fault-injection fs fake, the
// BrowserUsePlatformFs port's second adapter. The overlay wraps the REAL
// default adapter over a backing temp dir with a durable/volatile split:
// `writeFile` and `rename` land volatile; durable file operations and
// `syncDirectory` promote pending entries durable; `crash()`
// discards everything volatile and re-materializes only durable state into a
// fresh backing dir while callers keep their original logical paths. Hook
// points (`onBeforeFsync`, `onAfterFsync`, `onAfterRename`) let tests call
// `crash()` at crash-before-flush, crash-after-file-flush, and
// crash-before-dir-flush; `failRenameExdev` arms cross-device rename;
// `pauseAfterRead()` forces the two-writer lost-update interleaving.
// ---------------------------------------------------------------------------

import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { copyFile as fsCopyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";
import type { BrowserUsePlatformFs } from "./browser-use-paths";
import { createDefaultPlatformFs } from "./browser-use-paths";

// --- Temp XDG env -----------------------------------------------------------

/**
 * Real temp XDG roots for admission/store tests. XDG_RUNTIME_DIR stays unset
 * (the warned fallback is the product default on macOS); tests that need a
 * real runtime root set `env.XDG_RUNTIME_DIR = join(base, "runtime")`.
 * The base is realpath'd because macOS tmpdirs sit behind /var -> /private/var
 * and admission refuses symlinked ancestors by design.
 *
 * @returns Base dir, env record, and a dispose that removes the base
 */
export function makeTempXdgEnv(): {
	base: string;
	env: Record<string, string | undefined>;
	dispose(): void;
} {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "browser-use-platform-")));
	const home = join(base, "home");
	mkdirSync(home, { recursive: true, mode: 0o700 });
	return {
		base,
		env: {
			HOME: home,
			XDG_CONFIG_HOME: join(base, "config"),
			XDG_DATA_HOME: join(base, "data"),
			XDG_STATE_HOME: join(base, "state"),
			XDG_CACHE_HOME: join(base, "cache"),
		},
		dispose(): void {
			rmSync(base, { recursive: true, force: true });
		},
	};
}

// --- Fixed clock ------------------------------------------------------------

/**
 * The injectable clock's second adapter (mirrors makeRuntime's
 * `now: () => 1_000` precedent). `now` is a bound arrow, so it passes
 * directly into `now` seams.
 *
 * @param startEpochMs - Initial instant (default 1_000)
 * @returns Manually advanced clock
 */
export function fixedClock(startEpochMs = 1_000): {
	now: () => number;
	advance(byMs: number): void;
	set(epochMs: number): void;
} {
	let current = startEpochMs;
	return {
		now: () => current,
		advance(byMs: number): void {
			current += byMs;
		},
		set(epochMs: number): void {
			current = epochMs;
		},
	};
}

// --- Volatile overlay fs ------------------------------------------------------

/** Hook points the overlay exposes; assign fields directly from tests. */
export type VolatileOverlayHooks = {
	/** Fires before a file fsync (writeFileDurable) or dir fsync (syncDirectory). */
	onBeforeFsync?: (path: string) => void | Promise<void>;
	/** Fires after writeFileDurable's promotion (crash here = durable orphan). */
	onAfterFsync?: (path: string) => void | Promise<void>;
	/** Fires after a live rename, before any directory flush promotes it. */
	onAfterRename?: (path: string) => void | Promise<void>;
};

/** The volatile-overlay fault-injection fs fake. */
export type VolatileOverlayFs = {
	/** The BrowserUsePlatformFs port under test code drives. */
	fs: BrowserUsePlatformFs;
	hooks: VolatileOverlayHooks;
	/** While true, `rename` throws a `{ code: "EXDEV" }`-shaped error. */
	failRenameExdev: boolean;
	/**
	 * Discard everything volatile and re-materialize only durable state into
	 * a fresh backing dir. In-flight operations paused at a hook observe the
	 * crash and reject with `{ code: "ESIMCRASH" }`.
	 */
	crash(): void;
	/** Real directory backing the current epoch (for raw inspection). */
	currentBackingDir(): string;
	/**
	 * One-shot gate: the next readTextFile completes its read, resolves
	 * `reached` with the logical path, and pauses until `release()` — the
	 * lost-update interleaving for two-writer CAS tests.
	 */
	pauseAfterRead(): { reached: Promise<string>; release(): void };
	/** Remove the backing temp dir. */
	dispose(): void;
};

function crashedError(): Error {
	return Object.assign(
		new Error("volatile overlay: in-flight operation discarded by simulated crash"),
		{ code: "ESIMCRASH" },
	);
}

function exdevError(): Error {
	return Object.assign(
		new Error("EXDEV: cross-device link not permitted (armed by overlay)"),
		{ code: "EXDEV" },
	);
}

/**
 * Build the volatile-overlay fake. Callers use ordinary absolute logical
 * paths (real or fictitious); the overlay maps them into a private backing
 * temp dir per crash epoch, so `crash()` swaps the backing dir without
 * invalidating any caller-held path.
 *
 * @returns Overlay fake plus its fault-injection controls
 */
export function makeVolatileOverlayFs(): VolatileOverlayFs {
	const real = createDefaultPlatformFs();
	const backingBase = realpathSync(
		mkdtempSync(join(tmpdir(), "browser-use-overlay-")),
	);
	let epoch = 0;
	// Durable truth keyed by logical path; live truth is the backing dir.
	const durableFiles = new Map<string, { contents: string; mode: number }>();
	const durableDirs = new Map<string, number>();
	const volatileFiles = new Set<string>();
	let pendingRenames: Array<{ from: string; to: string }> = [];
	const flags = { failRenameExdev: false };
	const hooks: VolatileOverlayHooks = {};
	let pendingPause:
		| { resolveReached: (path: string) => void; gate: Promise<void> }
		| undefined;

	mkdirSync(join(backingBase, `epoch-${epoch}`), { recursive: true });

	function logical(path: string): string {
		const normalized = normalize(path);
		if (!isAbsolute(normalized)) {
			throw new TypeError("volatile overlay requires absolute paths");
		}
		return normalized;
	}

	function live(path: string): string {
		return join(backingBase, `epoch-${epoch}`, logical(path).slice(1));
	}

	// Await a hook, then abort the in-flight operation if crash() ran inside it.
	async function runHook(
		hook: ((path: string) => void | Promise<void>) | undefined,
		path: string,
	): Promise<void> {
		if (hook === undefined) return;
		const before = epoch;
		await hook(path);
		if (epoch !== before) throw crashedError();
	}

	// Every logical ancestor directory of `path` becomes durable with its
	// current live mode, so durable files re-materialize under real dirs.
	async function recordDurableAncestors(path: string): Promise<void> {
		let current = dirname(logical(path));
		const chain: string[] = [];
		while (current !== dirname(current)) {
			chain.unshift(current);
			current = dirname(current);
		}
		for (const dir of chain) {
			if (durableDirs.has(dir)) continue;
			const stat = await real.lstat(live(dir));
			durableDirs.set(dir, stat?.mode ?? 0o700);
		}
	}

	async function promoteFile(path: string): Promise<void> {
		const key = logical(path);
		const stat = await real.lstat(live(key));
		if (stat === undefined) return;
		durableFiles.set(key, {
			contents: await real.readTextFile(live(key)),
			mode: stat.mode,
		});
		volatileFiles.delete(key);
		await recordDurableAncestors(key);
	}

	const port: BrowserUsePlatformFs = {
		async lstat(path) {
			return await real.lstat(live(path));
		},
		async mkdir(path, options) {
			const existed = (await real.lstat(live(path))) !== undefined;
			await real.mkdir(live(path), options);
			// Match the real adapter: mkdir never re-modes an existing dir.
			if (!existed) await real.chmod(live(path), options.mode);
			// Directory creation is durable immediately; the interesting crash
			// semantics live in file writes and renames (spec C).
			if (!durableDirs.has(logical(path))) {
				durableDirs.set(
					logical(path),
					(await real.lstat(live(path)))?.mode ?? options.mode,
				);
			}
			await recordDurableAncestors(join(logical(path), "entry"));
		},
		async chmod(path, mode) {
			await real.chmod(live(path), mode);
			const key = logical(path);
			const file = durableFiles.get(key);
			if (file !== undefined) durableFiles.set(key, { ...file, mode });
			if (durableDirs.has(key)) durableDirs.set(key, mode);
		},
		async readTextFile(path) {
			const contents = await real.readTextFile(live(path));
			if (pendingPause !== undefined) {
				const pause = pendingPause;
				pendingPause = undefined;
				pause.resolveReached(logical(path));
				const before = epoch;
				await pause.gate;
				if (epoch !== before) throw crashedError();
			}
			return contents;
		},
		async readDirectory(path) {
			return await real.readDirectory(live(path));
		},
		async writeFileDurable(path, contents, mode) {
			await real.writeFile(live(path), contents, mode);
			// Crash inside this hook: the bytes above were volatile and vanish.
			await runHook(hooks.onBeforeFsync, logical(path));
			await promoteFile(path);
			// Crash inside this hook: the file IS durable (orphan temp case).
			await runHook(hooks.onAfterFsync, logical(path));
		},
		async writeFile(path, contents, mode) {
			await real.writeFile(live(path), contents, mode);
			volatileFiles.add(logical(path));
		},
		async rename(oldPath, newPath) {
			if (flags.failRenameExdev) throw exdevError();
			await real.rename(live(oldPath), live(newPath));
			pendingRenames.push({ from: logical(oldPath), to: logical(newPath) });
			volatileFiles.delete(logical(oldPath));
			// Crash inside this hook: the rename entry was never dir-flushed,
			// so durable truth still holds the OLD state (never torn).
			await runHook(hooks.onAfterRename, logical(newPath));
		},
		async linkFileNoReplace(existingPath, newPath) {
			await real.linkFileNoReplace(live(existingPath), live(newPath));
			volatileFiles.add(logical(newPath));
			await runHook(hooks.onAfterRename, logical(newPath));
		},
		async unlink(path) {
			await real.unlink(live(path));
			const key = logical(path);
			durableFiles.delete(key);
			volatileFiles.delete(key);
			pendingRenames = pendingRenames.filter(
				(pending) => pending.from !== key && pending.to !== key,
			);
		},
		async syncDirectory(path) {
			await real.syncDirectory(live(path));
			const dir = logical(path);
			await runHook(hooks.onBeforeFsync, dir);
			// Promote pending entries of THIS directory durable (spec C).
			const promoted = pendingRenames.filter(
				(pending) => dirname(pending.from) === dir || dirname(pending.to) === dir,
			);
			pendingRenames = pendingRenames.filter(
				(pending) => !promoted.includes(pending),
			);
			for (const pending of promoted) {
				durableFiles.delete(pending.from);
				await promoteFile(pending.to);
			}
			for (const file of [...volatileFiles]) {
				if (dirname(file) === dir) await promoteFile(file);
			}
			durableDirs.set(dir, (await real.lstat(live(dir)))?.mode ?? 0o700);
		},
		async createExclusive(path, contents, mode) {
			await real.createExclusive(live(path), contents, mode);
			// Exclusive creates are lock/lease records; durable immediately.
			await promoteFile(path);
		},
			async copyFileDurable(source, destination) {
				await fsCopyFile(live(source), live(destination));
				await runHook(hooks.onBeforeFsync, logical(destination));
				await promoteFile(destination);
				await runHook(hooks.onAfterFsync, logical(destination));
			},
		async hashFile(path) {
			return await real.hashFile(live(path));
		},
	};

	function crash(): void {
		epoch += 1;
		volatileFiles.clear();
		pendingRenames = [];
		pendingPause = undefined;
		const root = join(backingBase, `epoch-${epoch}`);
		mkdirSync(root, { recursive: true });
		const dirs = [...durableDirs.entries()].sort(
			(a, b) => a[0].length - b[0].length,
		);
		for (const [dir, mode] of dirs) {
			const target = join(root, dir.slice(1));
			mkdirSync(target, { recursive: true });
			chmodSync(target, mode);
		}
		for (const [file, record] of durableFiles) {
			const target = join(root, file.slice(1));
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, record.contents, { mode: record.mode });
			chmodSync(target, record.mode);
		}
	}

	return {
		fs: port,
		hooks,
		get failRenameExdev(): boolean {
			return flags.failRenameExdev;
		},
		set failRenameExdev(value: boolean) {
			flags.failRenameExdev = value;
		},
		crash,
		currentBackingDir(): string {
			return join(backingBase, `epoch-${epoch}`);
		},
		pauseAfterRead(): { reached: Promise<string>; release(): void } {
			let resolveReached!: (path: string) => void;
			const reached = new Promise<string>((resolve) => {
				resolveReached = resolve;
			});
			let releaseGate!: () => void;
			const gate = new Promise<void>((resolve) => {
				releaseGate = resolve;
			});
			pendingPause = { resolveReached, gate };
			return { reached, release: () => releaseGate() };
		},
		dispose(): void {
			rmSync(backingBase, { recursive: true, force: true });
		},
	};
}
