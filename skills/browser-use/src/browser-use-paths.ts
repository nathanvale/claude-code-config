// ---------------------------------------------------------------------------
// Browser Use XDG path owner (platform plan 2026-07-21-002 U2, R7-R12).
//
// The ONE code owner for resolving and admitting Browser Use roots: config,
// data, state, cache, runtime, and the derived evidence root
// (<state>/artifacts). Pure resolution (env -> roots, no I/O) is separated
// from I/O admission (symlink/ownership/mode/writability/version-control
// checks). Also defines the BrowserUsePlatformFs port every platform module
// shares, because paths is the bottom of the platform dependency chain; the
// default adapter binds node:fs, the second adapter is the volatile-overlay
// test fake in browser-use-platform-test-helpers.ts.
//
// Runtime fallback (R11): when XDG_RUNTIME_DIR is unset, relative, or fails
// admission, non-secret locks/sockets fall back to <state>/runtime-fallback
// (0700) with a warned `runtime_fallback.active` flag. The fallback is legal
// for NON-SECRET material only — any auth-plan secret transport must pass the
// auth plan's separate Secure Runtime Root admission; nothing in U2 grants it.
//
// Import direction: leaf — imports node:* and browser-use-core, plus one lazy
// bun:ffi binding confined to the darwin durable-file barrier (see
// F_FULLFSYNC below). No record parsing, no lock logic, no Date.now, no
// process.cwd().
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	chmod as fsChmod,
	copyFile as fsCopyFile,
	link as fsLink,
	lstat as fsLstat,
	mkdir as fsMkdir,
	readdir as fsReaddir,
	readFile as fsReadFile,
	realpath as fsRealpath,
	rename as fsRename,
	rm as fsRm,
	unlink as fsUnlink,
	writeFile as fsWriteFile,
	open,
} from "node:fs/promises";
import { isAbsolute, join, normalize, sep } from "node:path";
import type { FileHandle } from "node:fs/promises";
import { redactUnsafeText } from "./browser-use-core";

// --- Durable file barrier (darwin F_FULLFSYNC) -------------------------------

// Platform durability assumption: on darwin (the deployment platform — Warm
// Chrome / Touch ID / launchd) fsync(2) does NOT flush the drive write cache,
// so a power loss can lose an already-fsynced file. F_FULLFSYNC (fcntl) is the
// only true power-loss barrier for a FILE write. Every other platform's fsync
// IS a barrier, so they keep `handle.sync()`. A directory fd has no
// F_FULLFSYNC equivalent, so `syncDirectory` stays on `handle.sync()`
// everywhere. See the store crash truth table (browser-use-store.ts): the
// "prior target bytes intact" guarantee inherits this file barrier on darwin.

// macOS <sys/fcntl.h>: F_FULLFSYNC = 51. node:fs does not surface it or fcntl.
const DARWIN_F_FULLFSYNC = 51;
/** Pinned system image; a bare dylib name would search the caller's CWD. */
export const DARWIN_FULL_FSYNC_LIBRARY_PATH = "/usr/lib/libSystem.B.dylib";

/** Injectable binding seam for direct F_FULLFSYNC regression coverage. */
export type DarwinFullFsyncBinding = {
	call: (fd: number, cmd: number, arg: number) => number;
};

// Lazily dlopen libc's fcntl only on darwin, the ONE non-node:* dependency this
// leaf takes and only for the durable-file barrier. Cached across calls; a
// failed load degrades to `handle.sync()` (fsync) rather than throwing — the
// alternative is refusing every durable write on a runtime without FFI.
let fullFsyncBinding:
	| DarwinFullFsyncBinding
	| null
	| undefined;

function loadFullFsync(): DarwinFullFsyncBinding | null {
	if (fullFsyncBinding !== undefined) return fullFsyncBinding;
	try {
		// Import lazily so non-darwin platforms never touch bun:ffi.
		const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
		const lib = dlopen(DARWIN_FULL_FSYNC_LIBRARY_PATH, {
			fcntl: {
				args: [FFIType.int, FFIType.int, FFIType.int],
				returns: FFIType.int,
			},
		});
		fullFsyncBinding = {
			call: (fd, cmd, arg) => lib.symbols.fcntl(fd, cmd, arg) as number,
		};
	} catch {
		fullFsyncBinding = null;
	}
	return fullFsyncBinding;
}

/**
 * Full power-loss barrier for a durable FILE write. On darwin issues
 * `fcntl(fd, F_FULLFSYNC)` (flushes the drive write cache); on every other
 * platform, and when the darwin FFI binding cannot load, falls back to
 * `handle.sync()` (fsync). Exported so the store crash proof can assert the
 * darwin path selects F_FULLFSYNC without a real power-loss fixture.
 *
 * @param handle - Open file handle whose bytes must survive power loss
 * @param platform - Injected `process.platform` (defaults to the real one)
 */
export async function fullFsyncDurableFile(
	handle: Pick<FileHandle, "sync" | "fd">,
	platform: NodeJS.Platform = process.platform,
	bindingOverride?: DarwinFullFsyncBinding | null,
): Promise<void> {
	if (platform === "darwin") {
		const binding =
			bindingOverride === undefined ? loadFullFsync() : bindingOverride;
		if (binding !== null) {
			const rc = binding.call(handle.fd, DARWIN_F_FULLFSYNC, 0);
			if (rc === 0) return;
			// A negative rc means fcntl failed (e.g. the fd rejects F_FULLFSYNC on
			// some filesystems); fall back to fsync rather than lose the write.
		}
	}
	await handle.sync();
}

// --- Root vocabulary --------------------------------------------------------

/** The five XDG root kinds; the evidence root derives from `state`. */
export const BROWSER_USE_ROOT_KINDS = [
	"config",
	"data",
	"state",
	"cache",
	"runtime",
] as const;

/** Root kind union. */
export type BrowserUseRootKind = (typeof BROWSER_USE_ROOT_KINDS)[number];

/** Env var owning each root kind (R7/R11); named in refusal continuations. */
const XDG_ENV_VARS: Record<BrowserUseRootKind, string> = {
	config: "XDG_CONFIG_HOME",
	data: "XDG_DATA_HOME",
	state: "XDG_STATE_HOME",
	cache: "XDG_CACHE_HOME",
	runtime: "XDG_RUNTIME_DIR",
};

/** XDG 0.8 default base under $HOME per defaulted root kind (R7). */
const XDG_DEFAULT_SEGMENTS: Record<
	Exclude<BrowserUseRootKind, "runtime">,
	readonly string[]
> = {
	config: [".config"],
	data: [".local", "share"],
	state: [".local", "state"],
	cache: [".cache"],
};

/** Every Browser Use root directory is private (R12). */
const PRIVATE_DIR_MODE = 0o700;
/** Durable private file mode (R12). */
const PRIVATE_FILE_MODE = 0o600;
/** Writability probe filename created and unlinked during admission. */
const ADMISSION_PROBE_NAME = ".browser-use-admission-probe";
/** Fallback directory name under the state root (R11). */
const RUNTIME_FALLBACK_NAME = "runtime-fallback";

// --- The shared platform filesystem port ------------------------------------

/**
 * Filesystem port every platform module shares. The default adapter binds
 * node:fs; the second adapter is the volatile-overlay fault-injection fake
 * (crash-before/after-flush scenarios). Defined here because paths is the
 * bottom of the platform dependency chain.
 */
export type BrowserUsePlatformFs = {
	/** `undefined` = ENOENT/ENOTDIR (path or a component does not exist). */
	lstat(path: string): Promise<
		| {
				kind: "file" | "directory" | "symlink" | "other";
				mode: number;
				uid: number;
				dev: number;
				/** Size in bytes (migration inventory hashes/records it). */
				size: number;
		  }
		| undefined
	>;
	/**
	 * Resolve `path` to its canonical absolute location following every
	 * symlink. Returns `undefined` when a component is missing (ENOENT/ENOTDIR).
	 * Used only by admission's operator-owned symlink-ancestor resolution.
	 */
	realpath(path: string): Promise<string | undefined>;
	mkdir(path: string, options: { recursive: boolean; mode: number }): Promise<void>;
	chmod(path: string, mode: number): Promise<void>;
	/** Throws a `{ code: "ENOENT" }`-shaped error on a missing file. */
	readTextFile(path: string): Promise<string>;
	readDirectory(path: string): Promise<readonly string[]>;
	/** Open-write-fsync-close in one call; mode applies on create. */
	writeFileDurable(path: string, contents: string, mode: number): Promise<void>;
	/** Plain (non-fsynced) write, used only for probe files and cache. */
	writeFile(path: string, contents: string, mode: number): Promise<void>;
	/** Throws a `{ code: "EXDEV" }`-shaped error on a cross-device target. */
	rename(oldPath: string, newPath: string): Promise<void>;
	/** Atomic no-replace publication; throws `{ code: "EEXIST" }` when present. */
	linkFileNoReplace(existingPath: string, newPath: string): Promise<void>;
	/** ENOENT tolerated by callers. */
	unlink(path: string): Promise<void>;
	/** Recursively remove a directory tree; missing path is a no-op. */
	removeDirectoryRecursive(path: string): Promise<void>;
	/** fsync the directory fd (open + fsync + close). */
	syncDirectory(path: string): Promise<void>;
	/** O_CREAT|O_EXCL create; throws `{ code: "EEXIST" }` when present. */
	createExclusive(path: string, contents: string, mode: number): Promise<void>;
	/** Copy bytes, then apply the durable file barrier before returning. */
	copyFileDurable(source: string, destination: string): Promise<void>;
	/** sha256 hex of file bytes (streamed). */
	hashFile(path: string): Promise<string>;
};

/**
 * The production adapter: real node:fs bound to the port shape.
 *
 * @returns Platform fs port over the real filesystem
 */
export function createDefaultPlatformFs(): BrowserUsePlatformFs {
	return {
		async lstat(path) {
			try {
				const stat = await fsLstat(path);
				const kind = stat.isFile()
					? "file"
					: stat.isDirectory()
						? "directory"
						: stat.isSymbolicLink()
							? "symlink"
							: "other";
				return {
					kind,
					mode: stat.mode & 0o777,
					uid: stat.uid,
					dev: stat.dev,
					size: stat.size,
				};
			} catch (error) {
				const code = (error as { code?: string }).code;
				if (code === "ENOENT" || code === "ENOTDIR") return undefined;
				throw error;
			}
		},
		async realpath(path) {
			try {
				return await fsRealpath(path);
			} catch {
				// ENOENT/ENOTDIR (dangling), ELOOP (symlink cycle), EACCES
				// (unreadable ancestor), and every other resolution failure mean the
				// link target cannot be proven safe; undefined maps to the typed
				// symlink refusal upstream instead of escaping as an uncaught throw.
				return undefined;
			}
		},
		async mkdir(path, options) {
			await fsMkdir(path, options);
		},
		async chmod(path, mode) {
			await fsChmod(path, mode);
		},
		async readTextFile(path) {
			return await fsReadFile(path, "utf8");
		},
		async readDirectory(path) {
			return await fsReaddir(path);
		},
		async writeFileDurable(path, contents, mode) {
			const handle = await open(path, "w", mode);
			try {
				await handle.writeFile(contents);
				// Darwin needs F_FULLFSYNC for a true power-loss barrier; fsync
				// alone does not flush the drive write cache (see the file header).
				await fullFsyncDurableFile(handle);
			} finally {
				await handle.close();
			}
		},
		async writeFile(path, contents, mode) {
			await fsWriteFile(path, contents, { encoding: "utf8", mode });
		},
		async rename(oldPath, newPath) {
			await fsRename(oldPath, newPath);
		},
		async linkFileNoReplace(existingPath, newPath) {
			await fsLink(existingPath, newPath);
		},
		async unlink(path) {
			await fsUnlink(path);
		},
		async removeDirectoryRecursive(path) {
			await fsRm(path, { recursive: true, force: true });
		},
		async syncDirectory(path) {
			const handle = await open(path, "r");
			try {
				await handle.sync();
			} finally {
				await handle.close();
			}
		},
		async createExclusive(path, contents, mode) {
			const handle = await open(path, "wx", mode);
			try {
				await handle.writeFile(contents);
				// Darwin needs F_FULLFSYNC for a true power-loss barrier (see header).
				await fullFsyncDurableFile(handle);
			} finally {
				await handle.close();
			}
		},
		async copyFileDurable(source, destination) {
			await fsCopyFile(source, destination);
			const handle = await open(destination, "r+");
			try {
				await fullFsyncDurableFile(handle);
			} finally {
				await handle.close();
			}
		},
		async hashFile(path) {
			const hash = createHash("sha256");
			for await (const chunk of createReadStream(path)) {
				hash.update(chunk as Buffer);
			}
			return hash.digest("hex");
		},
	};
}

// --- Typed refusals ---------------------------------------------------------

/** Typed path refusal. Exactly ONE repair continuation per refusal (AE4). */
export type BrowserUsePathRefusal = {
	code:
		| "xdg_root_relative"
		| "xdg_root_unwritable"
		| "xdg_root_symlink_ancestor"
		| "xdg_root_wrong_owner"
		| "xdg_root_permissions_loose"
		| "xdg_root_version_controlled";
	root_kind: BrowserUseRootKind;
	message: string;
	continuation: { next_action_id: "repair_xdg_root"; summary: string };
};

// Refusal messages name the env var and the failed check, never a path: the
// redaction gate (R32) is a safety net here, not the privacy mechanism.
function pathRefusal(
	kind: BrowserUseRootKind,
	code: BrowserUsePathRefusal["code"],
	detail: string,
	repair: string,
): BrowserUsePathRefusal {
	const envVar = XDG_ENV_VARS[kind];
	return {
		code,
		root_kind: kind,
		message: redactUnsafeText(`${envVar}: ${detail}`),
		continuation: {
			next_action_id: "repair_xdg_root",
			summary: redactUnsafeText(`${repair} (${envVar}), then re-run.`),
		},
	};
}

// --- Pure resolution (R7, R11 decision) --------------------------------------

/** Resolved roots plus the runtime-fallback decision (R11). */
export type BrowserUsePathsResolution = {
	/**
	 * Absolute roots. Config/data/state/cache end with the browser-use
	 * segment; runtime is either <runtime-dir>/browser-use or, when the
	 * fallback is active, <state>/runtime-fallback.
	 */
	roots: Record<BrowserUseRootKind, string>;
	/** R11: warned, non-secret fallback when XDG_RUNTIME_DIR is unset/unsafe. */
	runtime_fallback: {
		active: boolean;
		reason?: "runtime_dir_unset" | "runtime_dir_unsafe";
	};
};

// XDG 0.8: an empty value means unset.
function envValue(raw: string | undefined): string | undefined {
	return raw === undefined || raw === "" ? undefined : raw;
}

/**
 * PURE resolution: env -> roots. No I/O. Rejects SET-but-relative XDG values
 * (R7 — never silently defaulted); applies XDG 0.8 defaults for empty/unset
 * values; computes the runtime fallback DECISION (admission performs it).
 *
 * @param env - Environment record (never `process.env` implicitly)
 * @returns Resolution, or one typed refusal with one repair continuation
 */
export function resolveBrowserUsePaths(
	env: Record<string, string | undefined>,
):
	| { ok: true; resolution: BrowserUsePathsResolution }
	| { ok: false; refusal: BrowserUsePathRefusal } {
	const home = envValue(env.HOME);
	const roots: Partial<Record<BrowserUseRootKind, string>> = {};
	for (const kind of ["config", "data", "state", "cache"] as const) {
		const raw = envValue(env[XDG_ENV_VARS[kind]]);
		if (raw !== undefined) {
			if (!isAbsolute(raw)) {
				return {
					ok: false,
					refusal: pathRefusal(
						kind,
						"xdg_root_relative",
						"set but not an absolute path; relative XDG roots are refused (R7).",
						"Set an absolute path",
					),
				};
			}
			roots[kind] = join(normalize(raw), "browser-use");
			continue;
		}
		if (home === undefined || !isAbsolute(home)) {
			return {
				ok: false,
				refusal: pathRefusal(
					kind,
					"xdg_root_relative",
					"unset and HOME is unset or not absolute, so the XDG 0.8 default cannot resolve.",
					"Set an absolute path or export an absolute HOME",
				),
			};
		}
		roots[kind] = join(home, ...XDG_DEFAULT_SEGMENTS[kind], "browser-use");
	}
	const stateRoot = roots.state as string;
	const rawRuntime = envValue(env.XDG_RUNTIME_DIR);
	let runtimeFallback: BrowserUsePathsResolution["runtime_fallback"];
	if (rawRuntime === undefined) {
		runtimeFallback = { active: true, reason: "runtime_dir_unset" };
		roots.runtime = join(stateRoot, RUNTIME_FALLBACK_NAME);
	} else if (!isAbsolute(rawRuntime)) {
		runtimeFallback = { active: true, reason: "runtime_dir_unsafe" };
		roots.runtime = join(stateRoot, RUNTIME_FALLBACK_NAME);
	} else {
		runtimeFallback = { active: false };
		roots.runtime = join(normalize(rawRuntime), "browser-use");
	}
	return {
		ok: true,
		resolution: {
			roots: roots as Record<BrowserUseRootKind, string>,
			runtime_fallback: runtimeFallback,
		},
	};
}

// --- I/O admission (R12) ------------------------------------------------------

// Every absolute prefix of an absolute path, shallowest first, excluding the
// filesystem root itself: /a/b/c -> [/a, /a/b, /a/b/c].
function componentPrefixes(absolutePath: string): string[] {
	const segments = normalize(absolutePath)
		.split(sep)
		.filter((segment) => segment !== "");
	const prefixes: string[] = [];
	let current: string = sep;
	for (const segment of segments) {
		current = join(current, segment);
		prefixes.push(current);
	}
	return prefixes;
}

// An ancestor symlink is admitted only when the operator owns BOTH the link
// itself and its resolved target (AE10/R24): the home-dir dotfiles pattern
// (~/.config -> /Users/<me>/dotfiles/.config) is the operator's own deliberate
// layout, not the attacker-planted redirect R12 refuses. A link owned by
// another user, or one whose realpath target is foreign-owned or missing,
// still refuses — resolving it would follow the redirect past the safety wall.
async function admitSymlinkAncestor(
	fs: BrowserUsePlatformFs,
	kind: BrowserUseRootKind,
	linkStat: { uid: number },
	linkPrefix: string,
	processUid: number | undefined,
): Promise<
	| { ok: true; resolved: string }
	| { ok: false; refusal: BrowserUsePathRefusal }
> {
	const symlinkRefusal = {
		ok: false as const,
		refusal: pathRefusal(
			kind,
			"xdg_root_symlink_ancestor",
			"a path component is a symlink not owned by the current user with an owned target; unresolved symlink traversal is refused (R12).",
			"Point the root at a directory without symlinked ancestors, or make the symlink and its target owned by the current user",
		),
	};
	// The link itself must belong to the invoking user.
	if (processUid !== undefined && linkStat.uid !== processUid) {
		return symlinkRefusal;
	}
	// Any realpath failure (dangling target, ELOOP cycle, EACCES) is the typed
	// refusal, never an uncaught throw — injected adapters may still throw
	// where the default adapter maps failures to undefined.
	let resolved: string | undefined;
	try {
		resolved = await fs.realpath(linkPrefix);
	} catch {
		resolved = undefined;
	}
	if (resolved === undefined) return symlinkRefusal;
	const targetStat = await fs.lstat(resolved);
	// The resolved target must exist and be owned by the invoking user; a
	// missing or foreign-owned target is exactly the redirect R12 guards.
	if (targetStat === undefined) return symlinkRefusal;
	if (processUid !== undefined && targetStat.uid !== processUid) {
		return symlinkRefusal;
	}
	return { ok: true, resolved };
}

async function validateExistingBrowserUseRoot(
	fs: BrowserUsePlatformFs,
	input: { kind: BrowserUseRootKind; path: string },
): Promise<
	| { ok: true; exists: boolean }
	| { ok: false; refusal: BrowserUsePathRefusal }
> {
	const { kind, path } = input;
	const processUid = process.getuid?.();
	let rootStat: Awaited<ReturnType<BrowserUsePlatformFs["lstat"]>>;
	// Walk the prefixes shallow-to-deep. On an operator-owned symlink ancestor,
	// resolve it and continue the walk over the canonical path built from the
	// resolved base plus the still-unwalked literal tail, so downstream
	// owner/mode checks run against real, symlink-free components. Nested
	// symlinks in the tail re-enter this branch; realpath makes each step
	// symlink-free at its own level, so the walk terminates.
	let prefixes = componentPrefixes(path);
	let index = 0;
	while (index < prefixes.length) {
		const prefix = prefixes[index] as string;
		const stat = await fs.lstat(prefix);
		if (stat === undefined) return { ok: true, exists: false };
		if (stat.kind === "symlink") {
			const admitted = await admitSymlinkAncestor(
				fs,
				kind,
				stat,
				prefix,
				processUid,
			);
			if (!admitted.ok) return admitted;
			// Segments still to walk are everything below the symlink in the
			// CURRENT prefix list (already anchored at the last resolved base) —
			// never recomputed from the original path. After a re-root the
			// original path's indices no longer line up; walking that wrong chain
			// would wander onto non-existent paths and skip the owner/0700 checks
			// on the real root.
			const remaining = prefixes
				.slice(index + 1)
				.map((full) => full.split(sep).slice(-1)[0] as string);
			const rebuilt: string[] = [admitted.resolved];
			let cursor = admitted.resolved;
			for (const segment of remaining) {
				cursor = join(cursor, segment);
				rebuilt.push(cursor);
			}
			prefixes = rebuilt;
			index = 0;
			continue;
		}
		rootStat = stat;
		index += 1;
	}
	if (rootStat === undefined) return { ok: true, exists: false };
	if (rootStat.kind !== "directory") {
		return {
			ok: false,
			refusal: pathRefusal(
				kind,
				"xdg_root_unwritable",
				"the root exists but is not a directory.",
				"Move the existing file aside so the root can be a private directory",
			),
		};
	}
	if (processUid !== undefined && rootStat.uid !== processUid) {
		return {
			ok: false,
			refusal: pathRefusal(
				kind,
				"xdg_root_wrong_owner",
				"the root exists but is owned by another user (R12).",
				"Point the root at a directory owned by the current user",
			),
		};
	}
	if ((rootStat.mode & 0o077) !== 0) {
		return {
			ok: false,
			refusal: pathRefusal(
				kind,
				"xdg_root_permissions_loose",
				"the private root carries group/other permission bits (R12 requires 0700).",
				"chmod the root to 0700",
			),
		};
	}
	return { ok: true, exists: true };
}

/**
 * I/O admission for one root (R12): ancestor symlink walk, ownership, mode,
 * mkdir 0700, writability probe, version-control ancestor check. Idempotent —
 * re-admitting an already-admitted root is a no-op success.
 *
 * @param fs - Platform fs port
 * @param input - Root kind, absolute path, and the optional check-ignored seam
 * @returns Ok, or one typed refusal with one repair continuation
 */
export async function admitBrowserUseRoot(
	fs: BrowserUsePlatformFs,
	input: {
		kind: BrowserUseRootKind;
		path: string;
		/**
		 * Injected exec seam for `git check-ignore -q <path>`; resolved true =
		 * proven ignored. Absent seam or false/throw => fail closed on a
		 * version-controlled ancestor.
		 */
		checkIgnored?: (path: string) => Promise<boolean>;
	},
): Promise<{ ok: true } | { ok: false; refusal: BrowserUsePathRefusal }> {
	const { kind, path } = input;
	const prefixes = componentPrefixes(path);
	const validated = await validateExistingBrowserUseRoot(fs, { kind, path });
	if (!validated.ok) return validated;
	if (!validated.exists) {
		try {
			await fs.mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
			// Defeat the process umask: created roots are exactly 0700 (R12).
			await fs.chmod(path, PRIVATE_DIR_MODE);
		} catch {
			return {
				ok: false,
				refusal: pathRefusal(
					kind,
					"xdg_root_unwritable",
					"the root directory could not be created.",
					"Point the root at a writable location",
				),
			};
		}
	}
	const probePath = join(path, ADMISSION_PROBE_NAME);
	try {
		await fs.writeFile(probePath, "", PRIVATE_FILE_MODE);
		await fs.unlink(probePath);
	} catch {
		return {
			ok: false,
			refusal: pathRefusal(
				kind,
				"xdg_root_unwritable",
				"the admission write probe failed.",
				"Point the root at a writable private directory",
			),
		};
	}
	// R12: refuse version-controlled write targets unless mechanically proven
	// ignored through the injected check-ignore seam.
	for (const prefix of prefixes) {
		const gitStat = await fs.lstat(join(prefix, ".git"));
		if (gitStat === undefined) continue;
		let ignored = false;
		try {
			ignored = input.checkIgnored ? await input.checkIgnored(path) : false;
		} catch {
			ignored = false;
		}
		if (!ignored) {
			return {
				ok: false,
				refusal: pathRefusal(
					kind,
					"xdg_root_version_controlled",
					"an ancestor is version-controlled and the root is not proven ignored (R12).",
					"Point the root outside the repository or prove it git-ignored",
				),
			};
		}
		break;
	}
	return { ok: true };
}

/**
 * Read-only validation for one resolved root. Missing roots are valid empty
 * stores; existing roots retain the symlink, owner, type, and mode checks.
 * No directory creation, chmod, write probe, or ignore probe occurs.
 */
async function inspectBrowserUseRoot(
	fs: BrowserUsePlatformFs,
	input: { kind: BrowserUseRootKind; path: string },
): Promise<{ ok: true } | { ok: false; refusal: BrowserUsePathRefusal }> {
	const validated = await validateExistingBrowserUseRoot(fs, input);
	return validated.ok ? { ok: true } : validated;
}

// --- The Target XDG Shape -----------------------------------------------------

/** The Target XDG Shape, derived in ONE place (plan "Target XDG Shape"). */
export type BrowserUseAdmittedPaths = {
	resolution: BrowserUsePathsResolution;
	state: {
		/** <state>/runs */
		runsDir: string;
		/** <state>/runs/<run-id>/run.json */
		runFile(runId: string): string;
		/** <state>/outcomes */
		outcomesDir: string;
		/** <state>/artifacts — the EVIDENCE root. */
		artifactsDir: string;
		/** <state>/artifacts/<run-id> */
		artifactDir(runId: string): string;
		/** <state>/migrations */
		migrationsDir: string;
		/** <state>/generations — immutable staged generations. */
		generationsDir: string;
		/** <state>/leases — durable fenced lease records. */
		leasesDir: string;
		/** <state>/attestations — durable bounded auth attestation records. */
		attestationsDir: string;
		/** <state>/attestations/<full-64-hex-digest>.json */
		attestationFile(digest: string): string;
		/** <state>/activation-epoch.json */
		epochFile: string;
	};
	cache: { indexesDir: string; compiledDir: string; probesDir: string };
	/** Under the runtime root OR the warned fallback (R11). */
	runtime: { locksDir: string; socketsDir: string };
	config: { root: string };
	data: {
		root: string;
		/** Immutable Runbook Generation store. */
		runbookGenerationsDir: string;
		/** Atomic generation plus epoch authority. */
		runbookGenerationAuthorityFile: string;
		/** Post-bootstrap marker that disables every retired resolver root. */
		runbookGenerationCutoverFile: string;
	};
};

// Ids become single path segments under the state root; a separator or dot
// segment would escape the run's directory, so it is a caller bug, not a
// typed refusal.
function assertSafePathSegment(id: string): void {
	if (
		id === "" ||
		id === "." ||
		id === ".." ||
		id.includes("/") ||
		id.includes("\\") ||
		id.includes("\0")
	) {
		throw new TypeError("id is not a safe single path segment");
	}
}

// The attestation file name IS the record's own content digest
// (authAttestationDigestOf, full 64-hex sha256): content-addressed custody, so
// a digest-shaped name that is not exactly 64 lowercase hex is a caller bug.
const AUTH_ATTESTATION_DIGEST_SHAPE = /^[0-9a-f]{64}$/;

function assertAttestationDigestShape(digest: string): void {
	if (!AUTH_ATTESTATION_DIGEST_SHAPE.test(digest)) {
		throw new TypeError(
			"attestation digest is not a full 64-hex content digest",
		);
	}
}

function deriveAdmittedPaths(
	resolution: BrowserUsePathsResolution,
): BrowserUseAdmittedPaths {
	const { roots } = resolution;
	const runsDir = join(roots.state, "runs");
	const artifactsDir = join(roots.state, "artifacts");
	const attestationsDir = join(roots.state, "attestations");
	return {
		resolution,
		state: {
			runsDir,
			runFile(runId: string): string {
				assertSafePathSegment(runId);
				return join(runsDir, runId, "run.json");
			},
			outcomesDir: join(roots.state, "outcomes"),
			artifactsDir,
			artifactDir(runId: string): string {
				assertSafePathSegment(runId);
				return join(artifactsDir, runId);
			},
			migrationsDir: join(roots.state, "migrations"),
			generationsDir: join(roots.state, "generations"),
			leasesDir: join(roots.state, "leases"),
			attestationsDir,
			attestationFile(digest: string): string {
				assertAttestationDigestShape(digest);
				return join(attestationsDir, `${digest}.json`);
			},
			epochFile: join(roots.state, "activation-epoch.json"),
		},
		cache: {
			indexesDir: join(roots.cache, "indexes"),
			compiledDir: join(roots.cache, "compiled"),
			probesDir: join(roots.cache, "probes"),
		},
		runtime: {
			locksDir: join(roots.runtime, "locks"),
			socketsDir: join(roots.runtime, "sockets"),
		},
		config: { root: roots.config },
		data: {
			root: roots.data,
			runbookGenerationsDir: join(
				roots.data,
				"runbook-generations",
				"generations",
			),
			runbookGenerationAuthorityFile: join(
				roots.data,
				"runbook-generations",
				"active.json",
			),
			runbookGenerationCutoverFile: join(
				roots.data,
				"runbook-generations",
				"cutover.json",
			),
		},
	};
}

/**
 * Resolve roots for a check-only command without mutating the filesystem.
 * Existing roots are safety-checked; absent roots project an empty store.
 *
 * @param fs - Platform fs port
 * @param env - Environment record
 * @returns Read-only Target XDG Shape, or one typed refusal
 */
export async function inspectBrowserUsePaths(
	fs: BrowserUsePlatformFs,
	env: Record<string, string | undefined>,
): Promise<
	| { ok: true; paths: BrowserUseAdmittedPaths }
	| { ok: false; refusal: BrowserUsePathRefusal }
> {
	const resolved = resolveBrowserUsePaths(env);
	if (!resolved.ok) return resolved;
	const { resolution } = resolved;
	for (const kind of ["config", "data", "state", "cache"] as const) {
		const inspected = await inspectBrowserUseRoot(fs, {
			kind,
			path: resolution.roots[kind],
		});
		if (!inspected.ok) return inspected;
	}
	let runtimeRoot = resolution.roots.runtime;
	let runtimeFallback = resolution.runtime_fallback;
	if (!runtimeFallback.active) {
		const inspected = await inspectBrowserUseRoot(fs, {
			kind: "runtime",
			path: runtimeRoot,
		});
		if (!inspected.ok) {
			runtimeFallback = { active: true, reason: "runtime_dir_unsafe" };
			runtimeRoot = join(resolution.roots.state, RUNTIME_FALLBACK_NAME);
		}
	}
	if (runtimeFallback.active) {
		const inspected = await inspectBrowserUseRoot(fs, {
			kind: "runtime",
			path: runtimeRoot,
		});
		if (!inspected.ok) return inspected;
	}
	return {
		ok: true,
		paths: deriveAdmittedPaths({
			roots: { ...resolution.roots, runtime: runtimeRoot },
			runtime_fallback: runtimeFallback,
		}),
	};
}

/**
 * Resolve + admit every root; the one entry the CLI calls. Config, data,
 * state, and cache admit in order and fail closed on the first refusal. The
 * runtime root falls back to <state>/runtime-fallback when unset, relative,
 * or failing admission (R11); only a fallback that itself fails admission is
 * a refusal.
 *
 * @param fs - Platform fs port
 * @param env - Environment record
 * @param options - Optional check-ignored seam forwarded to admission
 * @returns Admitted Target XDG Shape, or one typed refusal
 */
export async function openBrowserUsePaths(
	fs: BrowserUsePlatformFs,
	env: Record<string, string | undefined>,
	options: { checkIgnored?: (path: string) => Promise<boolean> } = {},
): Promise<
	| { ok: true; paths: BrowserUseAdmittedPaths }
	| { ok: false; refusal: BrowserUsePathRefusal }
> {
	const resolved = resolveBrowserUsePaths(env);
	if (!resolved.ok) return resolved;
	const { resolution } = resolved;
	for (const kind of ["config", "data", "state", "cache"] as const) {
		const admitted = await admitBrowserUseRoot(fs, {
			kind,
			path: resolution.roots[kind],
			checkIgnored: options.checkIgnored,
		});
		if (!admitted.ok) return admitted;
	}
	let runtimeRoot = resolution.roots.runtime;
	let runtimeFallback = resolution.runtime_fallback;
	if (!runtimeFallback.active) {
		const admitted = await admitBrowserUseRoot(fs, {
			kind: "runtime",
			path: runtimeRoot,
			checkIgnored: options.checkIgnored,
		});
		if (!admitted.ok) {
			runtimeFallback = { active: true, reason: "runtime_dir_unsafe" };
			runtimeRoot = join(resolution.roots.state, RUNTIME_FALLBACK_NAME);
		}
	}
	if (runtimeFallback.active) {
		const admitted = await admitBrowserUseRoot(fs, {
			kind: "runtime",
			path: runtimeRoot,
			checkIgnored: options.checkIgnored,
		});
		if (!admitted.ok) return admitted;
	}
	return {
		ok: true,
		paths: deriveAdmittedPaths({
			roots: { ...resolution.roots, runtime: runtimeRoot },
			runtime_fallback: runtimeFallback,
		}),
	};
}
