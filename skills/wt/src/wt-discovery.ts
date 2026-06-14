import { basename, dirname, join } from "node:path";
import type { Registry, Worktree } from "./model.ts";

/**
 * Raw worktree entry as emitted by `@side-quest/git worktree list --all`.
 *
 * Only `branch` and `path` are consumed; the rest are carried for possible
 * future use (dirty/merged power the deferred v2 dashboard).
 */
interface RawWorktreeEntry {
	branch: string;
	path: string;
	head?: string;
	dirty?: boolean;
	merged?: boolean;
	isMain?: boolean;
}

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
}

/**
 * Subprocess runner signature: takes argv, returns captured output.
 *
 * @param args - Full argv (e.g. `["@side-quest/git", "worktree", "list", "--all"]`)
 * @returns The captured run result
 */
export type Runner = (args: readonly string[]) => Promise<RunResult>;

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
const defaultRunner: Runner = async (args) => {
	const proc = Bun.spawn(["bunx", ...args], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const code = await proc.exited;
	return { ok: code === 0, stdout, stderr };
};

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
function isRealWorktree(entry: RawWorktreeEntry): boolean {
	if (entry.branch === "(detached)" || entry.branch.trim() === "") {
		return false;
	}
	if (entry.path.includes("/fallow-audit-")) {
		return false;
	}
	return true;
}

/**
 * List real worktrees for a repo via `@side-quest/git worktree list --all`.
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
export async function listWorktrees(run: Runner = defaultRunner): Promise<Worktree[]> {
	const result = await run(["@side-quest/git", "worktree", "list", "--all"]);
	if (!result.ok) {
		throw new WtDiscoveryError(
			"worktree_list_failed",
			`@side-quest/git worktree list failed: ${result.stderr.trim() || "non-zero exit"}`,
		);
	}
	let raw: RawWorktreeEntry[];
	try {
		raw = JSON.parse(result.stdout) as RawWorktreeEntry[];
	} catch {
		throw new WtDiscoveryError(
			"worktree_list_failed",
			"@side-quest/git worktree list emitted unparseable output",
		);
	}
	return raw.filter(isRealWorktree).map((entry) => ({ path: entry.path, branch: entry.branch }));
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
	try {
		const parsed = (await file.json()) as Registry;
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
