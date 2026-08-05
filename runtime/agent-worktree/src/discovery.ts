import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type { AgentWorktreeSeam } from "./model.ts";

/**
 * Captured subprocess result from a git invocation.
 *
 * Tests inject this port so discovery can prove parsing and fallback behavior
 * without touching the caller's real repository.
 *
 * @example
 * ```typescript
 * const result: GitRunResult = { ok: true, stdout: "main\n", stderr: "", code: 0 }
 * ```
 */
export interface GitRunResult {
	/** True when the subprocess exited 0. */
	ok: boolean;
	/** Captured stdout. */
	stdout: string;
	/** Captured stderr. */
	stderr: string;
	/** Process exit code when known. */
	code: number;
}

/**
 * Options passed to a git subprocess runner.
 *
 * @example
 * ```typescript
 * const options: GitRunOptions = { cwd: "/repo" }
 * ```
 */
export interface GitRunOptions {
	/** Directory where git should run. */
	cwd: string;
}

/**
 * Git subprocess runner used by discovery and lifecycle modules.
 *
 * The runner receives argv including `git` so callers can record exact public
 * semantics in tests without depending on Bun spawn.
 *
 * @param args - Full argv, including `git`
 * @param options - Subprocess working directory
 * @returns Captured subprocess result
 *
 * @example
 * ```typescript
 * const runner: GitRunner = async () => ({ ok: true, stdout: "", stderr: "", code: 0 })
 * ```
 */
export type GitRunner = (
	args: readonly string[],
	options: GitRunOptions,
) => Promise<GitRunResult>;

/**
 * One worktree entry parsed from `git worktree list --porcelain`.
 *
 * @example
 * ```typescript
 * const entry: DiscoveredWorktree = { path: "/repo", branch: "main", isMain: true }
 * ```
 */
export interface DiscoveredWorktree {
	/** Absolute path to the worktree root. */
	path: string;
	/** Branch short name when checked out. */
	branch?: string;
	/** HEAD object id when git reported it. */
	head?: string;
	/** True for the first porcelain entry, which git reports as the main worktree. */
	isMain: boolean;
	/** True when the entry is detached. */
	detached: boolean;
	/** True when git marks the worktree prunable. */
	prunable: boolean;
	/** Lock reason when the worktree is locked. */
	lockedReason?: string;
}

/**
 * Non-fatal discovery issue.
 *
 * Discovery keeps issues as data so doctor can still return a readable map
 * from dirty or partially broken repositories.
 */
export interface DiscoveryIssue {
	/** Stable issue code. */
	code:
		| "git_root_failed"
		| "isolation_detection_failed"
		| "worktree_list_failed"
		| "current_branch_failed"
		| "default_branch_unknown"
		| "stale_dir_scan_failed";
	/** Whether the issue blocks mutation or only degrades evidence. */
	status: "blocked" | "unknown" | "warn";
	/** Short machine-safe summary. */
	summary: string;
}

/**
 * Git repository isolation for the invocation directory.
 */
export type RepoIsolation = "main" | "linked_worktree" | "submodule";

/**
 * Repo and worktree map used by doctor and lifecycle commands.
 *
 * @example
 * ```typescript
 * const discovery = await discoverRepo({ cwd: process.cwd() })
 * ```
 */
export interface RepoDiscovery {
	/** Caller-provided directory. */
	requestedRoot: string;
	/** Git top-level root, when readable. */
	gitRoot?: string;
	/** Git repository isolation for the requested cwd, when classifiable. */
	isolation?: RepoIsolation;
	/** Main durable worktree root. */
	mainOwnerRoot?: string;
	/** Active worktree root for the requested cwd. */
	activeWorktree?: DiscoveredWorktree;
	/** All parsed worktrees. */
	worktrees: readonly DiscoveredWorktree[];
	/** Linked worktrees excluding the main owner. */
	linkedWorktrees: readonly DiscoveredWorktree[];
	/** Directories under `.worktrees` not registered by git. */
	staleDirs: readonly string[];
	/** Current branch at the requested cwd. */
	currentBranch?: string;
	/** Default branch short name when it can be inferred. */
	defaultBranch?: string;
	/** Main-owner durable store root. */
	storeRoot?: string;
	/** Non-fatal issues collected during discovery. */
	issues: readonly DiscoveryIssue[];
}

/**
 * Discovery options.
 *
 * @example
 * ```typescript
 * const options: DiscoverRepoOptions = { cwd: "/repo" }
 * ```
 */
export interface DiscoverRepoOptions {
	/** Directory to inspect. */
	cwd: string;
	/** Git runner. Defaults to Bun subprocesses. */
	run?: GitRunner;
}

/**
 * Default git subprocess runner.
 *
 * @param args - Full argv, including `git`
 * @param options - Subprocess working directory
 * @returns Captured stdout, stderr, and exit code
 *
 * @example
 * ```typescript
 * const result = await defaultGitRunner(["git", "status", "--short"], { cwd: "/repo" })
 * ```
 */
export async function defaultGitRunner(
	args: readonly string[],
	options: GitRunOptions,
): Promise<GitRunResult> {
	const proc = Bun.spawn([...args], {
		cwd: options.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { ok: code === 0, stdout, stderr, code };
}

/**
 * Discover repo ownership, linked worktrees, stale dirs, and branch defaults.
 *
 * @param options - Discovery cwd and optional git runner
 * @returns Readable repo map with issues instead of thrown git failures
 *
 * @example
 * ```typescript
 * const map = await discoverRepo({ cwd: process.cwd() })
 * ```
 */
export async function discoverRepo(
	options: DiscoverRepoOptions,
): Promise<RepoDiscovery> {
	const run = options.run ?? defaultGitRunner;
	const requestedRoot = resolve(options.cwd);
	const issues: DiscoveryIssue[] = [];
	const gitRootResult = await run(["git", "rev-parse", "--show-toplevel"], {
		cwd: requestedRoot,
	});
	if (!gitRootResult.ok) {
		return {
			requestedRoot,
			worktrees: [],
			linkedWorktrees: [],
			staleDirs: [],
			issues: [
				{
					code: "git_root_failed",
					status: "blocked",
					summary: "Git root could not be resolved.",
				},
			],
		};
	}

	const gitRoot = gitRootResult.stdout.trim();
	const [
		worktreeResult,
		branchResult,
		defaultBranchResult,
		gitDirResult,
		commonGitDirResult,
		superprojectResult,
	] = await Promise.all([
		run(["git", "worktree", "list", "--porcelain"], { cwd: gitRoot }),
		run(["git", "branch", "--show-current"], { cwd: requestedRoot }),
		run(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
			cwd: gitRoot,
		}),
		run(["git", "rev-parse", "--git-dir"], { cwd: requestedRoot }),
		run(["git", "rev-parse", "--git-common-dir"], { cwd: requestedRoot }),
		run(["git", "rev-parse", "--show-superproject-working-tree"], {
			cwd: requestedRoot,
		}),
	]);

	const isolation = classifyRepoIsolation({
		requestedRoot,
		gitDirResult,
		commonGitDirResult,
		superprojectResult,
	});
	if (!isolation) {
		issues.push({
			code: "isolation_detection_failed",
			status: "unknown",
			summary: "Git isolation could not be classified.",
		});
	}

	let worktrees: readonly DiscoveredWorktree[] = [];
	if (worktreeResult.ok) {
		worktrees = parseWorktreePorcelain(worktreeResult.stdout);
	} else {
		issues.push({
			code: "worktree_list_failed",
			status: "unknown",
			summary: "Git worktree list could not be read.",
		});
	}

	if (!branchResult.ok) {
		issues.push({
			code: "current_branch_failed",
			status: "unknown",
			summary: "Current branch could not be resolved.",
		});
	}

	const defaultBranch = defaultBranchResult.ok
		? stripOriginPrefix(defaultBranchResult.stdout.trim())
		: undefined;
	if (!defaultBranch) {
		issues.push({
			code: "default_branch_unknown",
			status: "warn",
			summary: "Default branch could not be inferred.",
		});
	}

	const mainOwnerRoot =
		worktrees.find((worktree) => worktree.isMain)?.path ?? gitRoot;
	const activeWorktree =
		findActiveWorktree(requestedRoot, worktrees) ??
		worktrees.find((worktree) => worktree.path === gitRoot);
	const staleDirs = await findStaleWorktreeDirs(mainOwnerRoot, worktrees).catch(
		() => {
			issues.push({
				code: "stale_dir_scan_failed",
				status: "warn",
				summary: "Stale worktree directory scan failed.",
			});
			return [] as string[];
		},
	);

	return {
		requestedRoot,
		gitRoot,
		isolation,
		mainOwnerRoot,
		activeWorktree,
		worktrees,
		linkedWorktrees: worktrees.filter((worktree) => !worktree.isMain),
		staleDirs,
		currentBranch: branchResult.ok ? branchResult.stdout.trim() : undefined,
		defaultBranch,
		storeRoot: join(mainOwnerRoot, ".agent-worktree"),
		issues,
	};
}

function classifyRepoIsolation(input: {
	requestedRoot: string;
	gitDirResult: GitRunResult;
	commonGitDirResult: GitRunResult;
	superprojectResult: GitRunResult;
}): RepoIsolation | undefined {
	const gitDir = input.gitDirResult.stdout.trim();
	const commonGitDir = input.commonGitDirResult.stdout.trim();
	if (
		!input.gitDirResult.ok ||
		!input.commonGitDirResult.ok ||
		!input.superprojectResult.ok ||
		!gitDir ||
		!commonGitDir
	) {
		return undefined;
	}
	if (input.superprojectResult.stdout.trim()) return "submodule";
	return resolve(input.requestedRoot, gitDir) ===
		resolve(input.requestedRoot, commonGitDir)
		? "main"
		: "linked_worktree";
}

/**
 * Parse `git worktree list --porcelain` output.
 *
 * @param text - Raw porcelain output
 * @returns Parsed entries in git order
 *
 * @example
 * ```typescript
 * const entries = parseWorktreePorcelain("worktree /repo\nbranch refs/heads/main\n")
 * ```
 */
export function parseWorktreePorcelain(
	text: string,
): readonly DiscoveredWorktree[] {
	const entries: DiscoveredWorktree[] = [];
	let current: DiscoveredWorktree | null = null;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		if (line === "") continue;
		const [key, ...rest] = line.split(" ");
		const value = rest.join(" ");
		if (key === "worktree") {
			if (current) entries.push(current);
			current = {
				path: value,
				isMain: entries.length === 0,
				detached: false,
				prunable: false,
			};
			continue;
		}
		if (!current) continue;
		if (key === "HEAD") current.head = value;
		if (key === "branch") current.branch = stripHeadsPrefix(value);
		if (key === "detached") current.detached = true;
		if (key === "prunable") current.prunable = true;
		if (key === "locked") current.lockedReason = value || "locked";
	}
	if (current) entries.push(current);
	return entries;
}

/**
 * Return true when a branch is protected from destructive lifecycle actions.
 *
 * @param branch - Branch short name
 * @param defaultBranch - Default branch short name, when known
 * @returns True when destructive mutation should be blocked
 *
 * @example
 * ```typescript
 * isProtectedBranch("main", "main") // true
 * ```
 */
export function isProtectedBranch(
	branch: string,
	defaultBranch?: string,
): boolean {
	return (
		branch === "main" ||
		branch === "master" ||
		branch === defaultBranch ||
		branch.startsWith("release/") ||
		branch.startsWith("prod/")
	);
}

function stripHeadsPrefix(value: string): string {
	return value.replace(/^refs\/heads\//, "");
}

function stripOriginPrefix(value: string): string {
	return value.replace(/^origin\//, "");
}

function findActiveWorktree(
	requestedRoot: string,
	worktrees: readonly DiscoveredWorktree[],
): DiscoveredWorktree | undefined {
	return [...worktrees]
		.sort((left, right) => right.path.length - left.path.length)
		.find(
			(worktree) =>
				requestedRoot === worktree.path ||
				requestedRoot.startsWith(`${worktree.path}/`),
		);
}

async function findStaleWorktreeDirs(
	mainOwnerRoot: string,
	worktrees: readonly DiscoveredWorktree[],
): Promise<readonly string[]> {
	const worktreesDir = join(mainOwnerRoot, ".worktrees");
	const registered = new Set(worktrees.map((worktree) => worktree.path));
	const stale: string[] = [];
	let entries: Array<{ name: string }>;
	try {
		entries = await readdir(worktreesDir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	for (const entry of entries) {
		const absolutePath = join(worktreesDir, entry.name);
		if (!registered.has(absolutePath) && basename(absolutePath) !== ".git") {
			stale.push(absolutePath);
		}
	}
	return stale.sort();
}

/**
 * Scaffold shell: discovery owns repo and worktree provenance.
 *
 * Status: earned.
 * Deletion test: deleting this seam duplicates git root, main-owner, active
 * worktree, and linked-worktree resolution across doctor, lifecycle, and `worktree`.
 */
export const DISCOVERY_SEAM = {
	id: "discovery",
	ownerPath: "runtime/agent-worktree/src/discovery.ts",
	status: "earned",
	deletionTest:
		"Deleting discovery duplicates repo and worktree owner resolution.",
	nextUnit: "U2",
} as const satisfies AgentWorktreeSeam;
