import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

/** Runtime boundary for docs-loop filesystem, env, and clock operations. */
export type StorybookDocsLoopRuntime = {
	/** Current working directory. */
	readonly cwd: () => string;
	/** Current timestamp in milliseconds. */
	readonly now: () => number;
	/** Read an environment variable. */
	readonly getEnv: (name: string) => string | undefined;
	/** Create a directory. */
	readonly mkdir: (
		path: string,
		options?: { recursive?: boolean; mode?: number },
	) => Promise<unknown>;
	/** Change file or directory mode. */
	readonly chmod: (path: string, mode: number) => Promise<void>;
	/** Read a UTF-8 text file. */
	readonly readTextFile: (path: string) => Promise<string>;
	/** Check whether a path exists. */
	readonly fileExists: (path: string) => Promise<boolean>;
	/** Read directory entries. */
	readonly readDir: (path: string) => Promise<readonly DocsLoopDirEntry[]>;
	/** Write a UTF-8 text file. */
	readonly writeTextFile: (
		path: string,
		content: string,
		options?: { mode?: number },
	) => Promise<void>;
	/** Rename a file. */
	readonly rename: (from: string, to: string) => Promise<void>;
	/** Remove a file or directory. */
	readonly rm: (
		path: string,
		options?: { recursive?: boolean; force?: boolean },
	) => Promise<void>;
	/** Return mode and existence metadata. */
	readonly stat: (path: string) => Promise<{ mode: number; mtimeMs?: number }>;
	/** Create a per-write unique suffix. */
	readonly uniqueId: () => string;
};

/** Minimal directory entry shape used by inventory discovery. */
export interface DocsLoopDirEntry {
	/** Entry filename. */
	readonly name: string;
	/** True when the entry is a directory. */
	readonly isDirectory: boolean;
	/** True when the entry is a regular file. */
	readonly isFile: boolean;
}

/** Resolved XDG storage paths for docs-loop state and cache. */
export interface DocsLoopStoragePaths {
	/** XDG state base directory. */
	readonly stateBase: string;
	/** XDG cache base directory. */
	readonly cacheBase: string;
	/** Package-owned state root. */
	readonly stateRoot: string;
	/** Package-owned cache root. */
	readonly cacheRoot: string;
}

/** Resolved per-run state and cache paths. */
export interface DocsLoopRunPaths {
	/** Repository storage key derived from its resolved path. */
	readonly repoKey: string;
	/** Directory containing all state for one repository. */
	readonly repoStateDir: string;
	/** Directory containing all cache for one repository. */
	readonly repoCacheDir: string;
	/** Directory containing run JSON files. */
	readonly runDir: string;
	/** JSON state file for the run. */
	readonly stateFile: string;
	/** Cache directory for the run. */
	readonly cacheDir: string;
}

/** Structured state error with retry and repair metadata. */
export class DocsLoopStateError extends Error {
	/**
	 * Create a docs-loop state error.
	 *
	 * @param code - Package-owned machine-readable error code
	 * @param message - Human-readable error summary
	 * @param nextSafeAction - Repair hint for the caller
	 * @param retrySafe - Whether same input retry is safe after repair
	 *
	 * @example
	 * ```typescript
	 * throw new DocsLoopStateError("corrupt_state_json", "State JSON is corrupt.", "Run doctor.", true)
	 * ```
	 */
	constructor(
		readonly code: string,
		message: string,
		readonly nextSafeAction: string,
		readonly retrySafe: boolean,
	) {
		super(message);
		this.name = "DocsLoopStateError";
	}
}

/**
 * Create the default docs-loop runtime.
 *
 * @param overrides - Runtime methods to replace in tests or embedded callers
 * @returns Runtime backed by local process APIs
 *
 * @example
 * ```typescript
 * const runtime = createDefaultStorybookDocsLoopRuntime()
 * ```
 */
export function createDefaultStorybookDocsLoopRuntime(
	overrides: Partial<StorybookDocsLoopRuntime> = {},
): StorybookDocsLoopRuntime {
	return {
		cwd: () => process.cwd(),
		now: () => Date.now(),
		getEnv: (name) => process.env[name],
		mkdir: (path, options) => mkdir(path, options),
		chmod: (path, mode) => chmod(path, mode),
		readTextFile: (path) => readFile(path, "utf8"),
		fileExists: async (path) => {
			try {
				await stat(path);
				return true;
			} catch {
				return false;
			}
		},
		readDir: async (path) =>
			(await readdir(path, { withFileTypes: true })).map((entry) => ({
				name: entry.name,
				isDirectory: entry.isDirectory(),
				isFile: entry.isFile(),
			})),
		writeTextFile: (path, content, options) =>
			writeFile(path, content, { encoding: "utf8", mode: options?.mode }),
		rename: (from, to) => rename(from, to),
		rm: (path, options) => rm(path, options),
		stat: (path) => stat(path),
		uniqueId: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
		...overrides,
	};
}

/**
 * Resolve docs-loop XDG storage roots.
 *
 * Rejects relative XDG base values before any write path is built.
 *
 * @param runtime - Runtime boundary
 * @returns Resolved state and cache paths
 * @throws DocsLoopStateError when HOME is missing or XDG base values are relative
 *
 * @example
 * ```typescript
 * const storage = resolveDocsLoopStorage(runtime)
 * ```
 */
export function resolveDocsLoopStorage(
	runtime: StorybookDocsLoopRuntime,
): DocsLoopStoragePaths {
	const home = runtime.getEnv("HOME");
	const stateBase = resolveXdgBase({
		name: "XDG_STATE_HOME",
		value: runtime.getEnv("XDG_STATE_HOME"),
		fallback: home ? join(home, ".local/state") : undefined,
		code: "xdg_state_home_relative",
	});
	const cacheBase = resolveXdgBase({
		name: "XDG_CACHE_HOME",
		value: runtime.getEnv("XDG_CACHE_HOME"),
		fallback: home ? join(home, ".cache") : undefined,
		code: "xdg_cache_home_relative",
	});
	return {
		stateBase,
		cacheBase,
		stateRoot: join(stateBase, "storybook-docs-loop"),
		cacheRoot: join(cacheBase, "storybook-docs-loop"),
	};
}

/**
 * Resolve per-run docs-loop state paths.
 *
 * @param runtime - Runtime boundary
 * @param repo - Target repository path
 * @param run - Run identifier
 * @returns Contained state and cache paths for the run
 * @throws DocsLoopStateError when the run id is invalid
 *
 * @example
 * ```typescript
 * const paths = resolveRunStatePath(runtime, "/repo", "docs-pass")
 * ```
 */
export function resolveRunStatePath(
	runtime: StorybookDocsLoopRuntime,
	repo: string,
	run: string,
): DocsLoopRunPaths {
	validateRunId(run);
	const storage = resolveDocsLoopStorage(runtime);
	const repoKey = repoStorageKey(repo);
	const repoStateDir = resolve(storage.stateRoot, "repos", repoKey);
	const repoCacheDir = resolve(storage.cacheRoot, "repos", repoKey);
	const runDir = resolve(repoStateDir, "runs");
	const stateFile = resolve(runDir, `${run}.json`);
	const cacheDir = resolve(repoCacheDir, "runs", run);
	assertContained(storage.stateRoot, stateFile);
	assertContained(storage.cacheRoot, cacheDir);
	return {
		repoKey,
		repoStateDir,
		repoCacheDir,
		runDir,
		stateFile,
		cacheDir,
	};
}

/**
 * Write docs-loop run state as private JSON.
 *
 * Uses a same-directory temp file followed by replacement so a failed write
 * leaves the previous final file intact.
 *
 * @param runtime - Runtime boundary
 * @param repo - Target repository path
 * @param state - JSON-serializable run state
 * @returns Resolved run paths
 * @throws DocsLoopStateError for invalid run ids or XDG values
 *
 * @example
 * ```typescript
 * await writeDocsLoopRunState(runtime, "/repo", { run: "docs-pass" })
 * ```
 */
export async function writeDocsLoopRunState(
	runtime: StorybookDocsLoopRuntime,
	repo: string,
	state: Record<string, unknown>,
): Promise<DocsLoopRunPaths> {
	const run = state.run;
	if (typeof run !== "string") {
		throw new DocsLoopStateError(
			"run_id_missing",
			"Run state is missing a run id.",
			"Provide a valid run id.",
			true,
		);
	}
	const paths = resolveRunStatePath(runtime, repo, run);
	await runtime.mkdir(paths.runDir, { recursive: true, mode: 0o700 });
	await runtime.chmod(paths.repoStateDir, 0o700);
	await runtime.chmod(paths.runDir, 0o700);
	const tempPath = `${paths.stateFile}.tmp-${runtime.uniqueId()}`;
	const serialized = `${JSON.stringify(sanitizeForState(state), null, 2)}\n`;
	await runtime.writeTextFile(tempPath, serialized, { mode: 0o600 });
	await runtime.chmod(tempPath, 0o600);
	await runtime.rename(tempPath, paths.stateFile);
	await runtime.chmod(paths.stateFile, 0o600);
	return paths;
}

/**
 * Read and parse docs-loop run state.
 *
 * @param runtime - Runtime boundary
 * @param repo - Target repository path
 * @param run - Run identifier
 * @returns Parsed JSON state
 * @throws DocsLoopStateError when state is missing or corrupt
 *
 * @example
 * ```typescript
 * const state = await readDocsLoopRunState(runtime, "/repo", "docs-pass")
 * ```
 */
export async function readDocsLoopRunState(
	runtime: StorybookDocsLoopRuntime,
	repo: string,
	run: string,
): Promise<Record<string, unknown>> {
	const paths = resolveRunStatePath(runtime, repo, run);
	let content: string;
	try {
		content = await runtime.readTextFile(paths.stateFile);
	} catch (error) {
		throw new DocsLoopStateError(
			"state_missing",
			error instanceof Error ? error.message : "State file is missing.",
			"Create or select an existing run.",
			true,
		);
	}
	try {
		const parsed = JSON.parse(content);
		if (!isPlainObject(parsed)) {
			throw new Error("State JSON root must be an object.");
		}
		return parsed;
	} catch {
		throw new DocsLoopStateError(
			"corrupt_state_json",
			"State JSON could not be parsed.",
			"Inspect or remove the corrupt run state.",
			true,
		);
	}
}

/**
 * List active docs-loop run ids for a repository.
 *
 * @param runtime - Runtime boundary
 * @param repo - Target repository path
 * @returns Sorted run ids with readable state files
 *
 * @example
 * ```typescript
 * const runs = await listDocsLoopRunIds(runtime, "/repo")
 * ```
 */
export async function listDocsLoopRunIds(
	runtime: StorybookDocsLoopRuntime,
	repo: string,
): Promise<string[]> {
	const storage = resolveDocsLoopStorage(runtime);
	const runDir = resolve(
		storage.stateRoot,
		"repos",
		repoStorageKey(repo),
		"runs",
	);
	try {
		const entries = await runtime.readDir(runDir);
		return entries
			.filter((entry) => entry.isFile && entry.name.endsWith(".json"))
			.map((entry) => entry.name.slice(0, -".json".length))
			.sort();
	} catch {
		return [];
	}
}

/**
 * Remove one docs-loop run state file and cache directory.
 *
 * @param runtime - Runtime boundary
 * @param repo - Target repository path
 * @param run - Run identifier
 * @returns True when removal was attempted for a valid run path
 *
 * @example
 * ```typescript
 * await deleteDocsLoopRun(runtime, "/repo", "docs-pass")
 * ```
 */
export async function deleteDocsLoopRun(
	runtime: StorybookDocsLoopRuntime,
	repo: string,
	run: string,
): Promise<boolean> {
	const paths = resolveRunStatePath(runtime, repo, run);
	await runtime.rm(paths.stateFile, { force: true });
	await runtime.rm(paths.cacheDir, { recursive: true, force: true });
	return true;
}

/**
 * Find run ids whose state files are older than the given cutoff.
 *
 * @param runtime - Runtime boundary
 * @param repo - Target repository path
 * @param olderThanMs - Age threshold in milliseconds
 * @returns Sorted run ids older than the threshold
 *
 * @example
 * ```typescript
 * const oldRuns = await findRunsOlderThan(runtime, "/repo", 86400000)
 * ```
 */
export async function findRunsOlderThan(
	runtime: StorybookDocsLoopRuntime,
	repo: string,
	olderThanMs: number,
): Promise<string[]> {
	const now = runtime.now();
	const runIds = await listDocsLoopRunIds(runtime, repo);
	const oldRuns: string[] = [];
	for (const run of runIds) {
		const paths = resolveRunStatePath(runtime, repo, run);
		let stats: { mode: number; mtimeMs?: number };
		try {
			stats = await runtime.stat(paths.stateFile);
		} catch {
			// Run removed between listing and stat (e.g. a concurrent purge); skip it.
			continue;
		}
		if (stats.mtimeMs !== undefined && now - stats.mtimeMs >= olderThanMs) {
			oldRuns.push(run);
		}
	}
	return oldRuns.sort();
}

/** Validate a docs-loop run id before path construction. */
export function validateRunId(run: string): void {
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(run)) {
		throw new DocsLoopStateError(
			"invalid_run_id",
			"Run id must use letters, numbers, hyphen, or underscore.",
			"Choose a shorter run id with safe characters.",
			true,
		);
	}
}

/** Build a stable non-secret repository storage key. */
export function repoStorageKey(repo: string): string {
	return createHash("sha256").update(resolve(repo)).digest("hex").slice(0, 24);
}

function resolveXdgBase(input: {
	name: string;
	value: string | undefined;
	fallback: string | undefined;
	code: string;
}): string {
	if (input.value !== undefined) {
		if (!isAbsolute(input.value)) {
			throw new DocsLoopStateError(
				input.code,
				`${input.name} must be an absolute path.`,
				"Use an absolute XDG base directory.",
				true,
			);
		}
		return input.value;
	}
	if (!input.fallback) {
		throw new DocsLoopStateError(
			"home_missing",
			"HOME is required when XDG bases are unset.",
			"Set HOME or absolute XDG base directories.",
			true,
		);
	}
	return input.fallback;
}

function assertContained(root: string, candidate: string): void {
	const resolvedRoot = resolve(root);
	const resolvedCandidate = resolve(candidate);
	if (
		resolvedCandidate !== resolvedRoot &&
		!resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
	) {
		throw new DocsLoopStateError(
			"state_path_escape",
			"Resolved state path escaped the docs-loop root.",
			"Use a safe run id and repository path.",
			true,
		);
	}
}

function sanitizeForState(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sanitizeForState).filter((entry) => entry !== undefined);
	}
	if (isPlainObject(value)) {
		return Object.fromEntries(
			Object.entries(value)
				.map(([key, entry]) => [key, sanitizeEntry(key, entry)] as const)
				.filter(([, entry]) => entry !== undefined),
		);
	}
	if (typeof value === "string" && isAuthBearingUrl(value)) {
		return "[redacted-auth-url]";
	}
	return value;
}

function sanitizeEntry(key: string, value: unknown): unknown {
	if (isPrivateStateKey(key)) return undefined;
	return sanitizeForState(value);
}

function isPrivateStateKey(key: string): boolean {
	const normalized = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
	return [
		"prompt",
		"raw_prompt",
		"transcript",
		"secret",
		"token",
		"password",
		"credential",
		"cookie",
		"cookies",
		"auth_url",
		"browser_payload",
	].some((privateKey) => normalized.includes(privateKey));
}

function isAuthBearingUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return Boolean(url.username || url.password);
	} catch {
		return false;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object") return false;
	if (Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
