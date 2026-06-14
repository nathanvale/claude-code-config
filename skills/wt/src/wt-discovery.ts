import { basename, dirname, join } from "node:path";
import {
	defaultGitRunner,
	discoverRepo,
	type GitRunner,
} from "../../../runtime/agent-worktree/src/index.ts";
import type { Registry, Worktree } from "./model.ts";

/**
 * Result of running a subprocess: captured stdout plus success flag.
 *
 * Injected so discovery and delegation can be tested without spawning real
 * processes or mutating real worktrees.
 */
export interface RunResult {
	/** True when the process exited 0. */
	ok: boolean;
	/** Captured stdout (may be empty on failure). */
	stdout: string;
	/** Captured stderr, used for failure diagnostics. */
	stderr: string;
	/** Process exit code, when known. */
	code?: number;
}

/**
 * Subprocess execution options.
 */
export interface RunOptions {
	/** Working directory for repo-scoped upstream CLI calls. */
	cwd?: string;
}

/**
 * Subprocess runner signature: takes argv, returns captured output.
 *
 * @param args - Full argv (e.g. `["git", "worktree", "list", "--porcelain"]`)
 * @param options - Optional process execution controls
 * @returns The captured run result
 */
export type Runner = (args: readonly string[], options?: RunOptions) => Promise<RunResult>;

/**
 * Failure raised when the upstream worktree CLI cannot be read.
 *
 * Carries a package-owned diagnostic code so the dispatcher maps it to the
 * right envelope without string matching.
 */
export class WtDiscoveryError extends Error {
	constructor(
		readonly code: "worktree_list_failed" | "registry_unreadable",
		message: string,
	) {
		super(message);
		this.name = "WtDiscoveryError";
	}
}

/**
 * Default runner that spawns a real subprocess via `bunx`.
 *
 * @param args - Full argv to run under `bunx`
 * @returns Captured run result
 * @internal
 */
const defaultRunner: Runner = (args, options = {}) =>
	defaultGitRunner(args, { cwd: options.cwd ?? process.cwd() });

/**
 * True when a worktree entry is a real, named worktree (not a throwaway temp).
 *
 * Detached-HEAD entries and `fallow-audit-*` cache worktrees pollute
 * `git worktree list` and must never reach the renderer.
 *
 * @param entry - One raw worktree entry
 * @returns True to keep, false to drop
 * @internal
 */
function isRealWorktree(entry: { branch?: string; path: string }): entry is {
	branch: string;
	path: string;
	isMain?: boolean;
} {
	if (!entry.branch || entry.branch === "(detached)" || entry.branch.trim() === "") {
		return false;
	}
	if (entry.path.includes("/fallow-audit-")) {
		return false;
	}
	return true;
}

/**
 * List real worktrees for a repo via the shared `agent-worktree` runtime.
 *
 * Filters out detached-HEAD and `fallow-audit-*` temp entries so only named
 * work reaches the engine.
 *
 * @param run - Subprocess runner (defaults to a real `bunx` spawn)
 * @returns Real worktrees in upstream order
 * @throws {WtDiscoveryError} code `worktree_list_failed` when the CLI fails or
 *   emits unparseable output
 *
 * @example
 * ```typescript
 * const worktrees = await listWorktrees()
 * ```
 */
export async function listWorktrees(repoRoot: string, run: Runner = defaultRunner): Promise<Worktree[]> {
	const discovery = await discoverRepo({ cwd: repoRoot, run: adaptRunner(run) });
	if (!discovery.gitRoot || discovery.issues.some((issue) => issue.code === "worktree_list_failed")) {
		throw new WtDiscoveryError(
			"worktree_list_failed",
			"agent-worktree discovery could not read git worktrees.",
		);
	}
	return discovery.worktrees.flatMap((entry) =>
		isRealWorktree(entry)
			? [{ path: entry.path, branch: entry.branch, isMain: entry.isMain }]
			: [],
	);
}

export function adaptRunner(run: Runner): GitRunner {
	return async (args, options) => {
		const result = await run(args, options);
		return { ...result, code: result.code ?? (result.ok ? 0 : 1) };
	};
}

/**
 * Pick the durable repo owner root from live worktree state.
 *
 * Linked worktrees are disposable; registry and workspace files need the main
 * worktree root so branch prefs survive deleting/recreating a linked worktree.
 *
 * @param worktrees - Real worktrees from `listWorktrees`
 * @param fallbackRoot - Current repo root when upstream lacks `isMain`
 * @returns The main worktree path, or fallback when unavailable
 */
export function repoOwnerRootFor(worktrees: readonly Worktree[], fallbackRoot: string): string {
	return worktrees.find((worktree) => worktree.isMain)?.path ?? fallbackRoot;
}

/**
 * Load the branch-keyed registry for a repo, tolerating absence.
 *
 * An absent `wt.config.json` is a normal first-run state, not an error: it
 * yields an empty registry so a bare repo still renders. Malformed JSON is an
 * error the user must fix.
 *
 * @param repoRoot - Absolute path to the repo root
 * @returns The parsed registry, or an empty one when the file is absent
 * @throws {WtDiscoveryError} code `registry_unreadable` when the file exists
 *   but is not valid JSON
 *
 * @example
 * ```typescript
 * const registry = await loadRegistry("/code/my-repo")
 * ```
 */
export async function loadRegistry(repoRoot: string): Promise<Registry> {
	const file = Bun.file(join(repoRoot, "wt.config.json"));
	if (!(await file.exists())) {
		return { branches: {} };
	}
	return parseRegistryText(await file.text());
}

export function parseRegistryText(existing: string | null): Registry {
	if (existing === null) {
		return { branches: {} };
	}
	try {
		const parsed = JSON.parse(existing) as Registry;
		return { branches: parsed.branches ?? {}, defaults: parsed.defaults };
	} catch {
		throw new WtDiscoveryError(
			"registry_unreadable",
			"wt.config.json exists but is not valid JSON",
		);
	}
}

/**
 * Resolve the rendered workspace path for a repo: `<parent>/<repo>.code-workspace`.
 *
 * @param repoRoot - Absolute path to the repo root
 * @returns Absolute path to the repo's `.code-workspace`
 *
 * @example
 * ```typescript
 * workspacePathFor("/code/my-repo") // → "/code/my-repo.code-workspace"
 * ```
 */
export function workspacePathFor(repoRoot: string): string {
	return join(dirname(repoRoot), `${basename(repoRoot)}.code-workspace`);
}
