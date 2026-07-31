#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
	type CliWriter,
	type CommandFacadeResultContract,
	type CommandResultPayload,
	createCliRuntimeError,
	createCliRepairStateRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	createCommandResultData,
	parseCliDiagnosticArgv,
	projectCommandDiscoveryTree,
	renderCommandUsage,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	attachWorktree,
	cleanPreview,
	createWorktree,
	deleteWorktree,
	type LifecycleResult,
	registerCodexProject,
} from "../../../runtime/agent-worktree/src/index.ts";
import {
	WORKTREE_COMMAND_ORDER,
	type WorkTreeCommand,
	type WorkTreeDiagnosticCode,
	worktreeRenderResultContract,
	worktreeContracts,
} from "./command-contract.ts";
import {
	WORKTREE_COLOR_PALETTE,
	type Registry,
	type WorkTreeColor,
	type Worktree,
} from "./model.ts";
import { isDrift, renderWorkspace, stampHeader } from "./worktree-engine.ts";
import {
	listWorktrees,
	repoOwnerRootFor,
	type Runner,
	WorkTreeDiscoveryError,
	adaptRunner,
	parseRegistryText,
	WORKTREE_REGISTRY_FILE,
	workspacePathFor,
} from "./worktree-discovery.ts";

const VERSION = "0.1.0";

export interface CodexAppProjectCleanupResult {
	worktree_path: string;
	changed_state: "complete" | "none" | "partial";
	sidebar_state: {
		status:
			| "removed"
			| "already_absent"
			| "state_missing"
			| "state_unreadable"
			| "write_failed";
		path: string;
		removed_keys: readonly string[];
	};
	thread_archive: {
		status: "archived" | "none" | "unavailable" | "partial";
		archived_thread_ids: readonly string[];
		failed_thread_ids: readonly string[];
		skipped_thread_ids: readonly string[];
	};
	next_safe_action: string;
}

/**
 * Runtime adapter for the filesystem, subprocess, and existence checks.
 *
 * Injected so the dispatcher's handlers run under test without touching real
 * files, spawning processes, or launching editor/app front doors.
 */
export interface WorkTreeRuntime {
	/** Repo root the command operates on. */
	repoRoot: () => string;
	/** Read a UTF-8 file, or null when it does not exist. */
	readTextFile: (path: string) => Promise<string | null>;
	/** Write a UTF-8 file (creating parents as needed). */
	writeTextFile: (path: string, content: string) => Promise<void>;
	/** True when a path exists on disk. Backs focus probing. */
	pathExists: (path: string) => Promise<boolean>;
	/** Create a directory and parents when needed. */
	ensureDirectory: (path: string) => Promise<void>;
	/** True when stdin is an interactive TTY. */
	isInteractive: () => boolean;
	/** Subprocess runner for worktree discovery and delegation. */
	run: Runner;
	/** Launch VS Code on a workspace path; resolves false when the binary is absent. */
	launchCode: (workspacePath: string, codeBin?: string) => Promise<boolean>;
	/** Launch Codex Desktop on a worktree path; resolves false when the launcher is absent. */
	launchCodexApp: (worktreePath: string, codexBin?: string) => Promise<boolean>;
	/** Current epoch millis; injected so envelope durations are deterministic in tests. */
	now: () => number;
}

type WorkTreeLifecyclePayload = {
	action: string;
	lifecycle_action: LifecycleResult["action"];
	changed_state: LifecycleResult["changedState"];
	preview: LifecycleResult["preview"];
	run_ref: LifecycleResult["runRef"] | undefined;
	failure_ref: LifecycleResult["failureRef"] | undefined;
	changes: LifecycleResult["changes"];
	next_safe_action: LifecycleResult["nextSafeAction"];
	reason: LifecycleResult["reason"] | undefined;
	recovery: LifecycleResult["recovery"] | undefined;
	retry_safety:
		| NonNullable<LifecycleResult["recovery"]>["choices"][number]["retrySafety"]
		| undefined;
	backup_ref: LifecycleResult["backupRef"] | undefined;
	resolved_ref: LifecycleResult["resolvedRef"] | undefined;
	target_path: LifecycleResult["targetPath"] | undefined;
	mode: LifecycleResult["mode"] | undefined;
	existing_checkout_path: LifecycleResult["existingCheckoutPath"] | undefined;
};

/**
 * Build the default runtime adapter backed by Bun's filesystem and spawn APIs.
 *
 * @param overrides - Hooks tests use to avoid real I/O
 * @returns A runtime adapter
 *
 * @example
 * ```typescript
 * const runtime = createDefaultRuntime({ repoRoot: () => "/code/my-repo" })
 * ```
 */
export function createDefaultRuntime(overrides: Partial<WorkTreeRuntime> = {}): WorkTreeRuntime {
	return {
		repoRoot: () => process.cwd(),
		readTextFile: async (path) => {
			try {
				return await Bun.file(path).text();
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
		},
		writeTextFile: (path, content) => Bun.write(path, content).then(() => undefined),
		pathExists: (path) => Bun.file(path).exists(),
		ensureDirectory: (path) => mkdir(path, { recursive: true }).then(() => undefined),
		isInteractive: () => Boolean(process.stdin.isTTY),
		run: async (args, options = {}) => {
			const proc = Bun.spawn([...args], {
				cwd: options.cwd,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
			]);
			const code = await proc.exited;
			return { ok: code === 0, stdout, stderr, code };
		},
		launchCode: async (workspacePath, codeBin = "code") => {
			try {
				const proc = Bun.spawn([codeBin, workspacePath], { stdout: "ignore", stderr: "ignore" });
				return (await proc.exited) === 0;
			} catch {
				return false;
			}
		},
		launchCodexApp: async (worktreePath, codexBin = "codex") => {
			try {
				const proc = Bun.spawn([codexBin, "app", worktreePath], {
					stdout: "ignore",
					stderr: "ignore",
				});
				return (await proc.exited) === 0;
			} catch {
				return false;
			}
		},
		now: () => Date.now(),
		...overrides,
	};
}

/**
 * Render the repo's workspace and apply the drift gate before writing.
 *
 * Reads the registry and live worktrees, renders the workspace, then refuses to
 * overwrite a file that was edited since the last render unless `force` is set.
 * The gate holds in both interactive and non-interactive sessions; `--force` is
 * the only override. This is the product's core safety rule.
 *
 * @param runtime - Injected I/O adapter
 * @param force - Overwrite a drift-detected workspace
 * @returns A discriminated result: written, drift-blocked, or a discovery error
 */
export async function syncWorkspace(
	runtime: WorkTreeRuntime,
	force: boolean,
): Promise<
	| { kind: "written"; path: string }
	| { kind: "drift_blocked"; path: string }
	| { kind: "error"; code: WorkTreeDiagnosticCode; message: string }
> {
	const repoRoot = runtime.repoRoot();
	let ownerRoot = repoRoot;
	let registry: Registry;
	let worktrees: Awaited<ReturnType<typeof listWorktrees>>;
	try {
		worktrees = await listWorktrees(repoRoot, runtime.run);
		ownerRoot = repoOwnerRootFor(worktrees, repoRoot);
		registry = await loadRegistryFromRuntime(runtime, ownerRoot);
		// First pass finds the owner root; second pass applies registry ignored-worktree globs.
		worktrees = await listWorktrees(
			repoRoot,
			runtime.run,
			registry.defaults?.ignoredWorktrees ?? [],
		);
	} catch (error) {
		if (error instanceof WorkTreeDiscoveryError) {
			return { kind: "error", code: error.code, message: error.message };
		}
		throw error;
	}
	const workspacePath = workspacePathFor(ownerRoot);

	const wip = registry.defaults?.wip ? expandHome(registry.defaults.wip) : null;
	if (wip) {
		registry = {
			...registry,
			defaults: {
				...registry.defaults,
				wip,
			},
		};
	}

	const existing = await runtime.readTextFile(workspacePath);
	if (existing !== null && isDrift(existing) && !force) {
		return { kind: "drift_blocked", path: workspacePath };
	}

	if (wip) {
		try {
			await runtime.ensureDirectory(wip);
		} catch {
			return {
				kind: "error",
				code: "write_failed",
				message: "Could not create the WIP scratch folder.",
			};
		}
	}

	// Pre-resolve focus-folder existence async (the engine's probe is sync), so
	// guessFocus can probe `<worktree>/skills/<stem>` without an async boundary.
	const probes = worktrees.map((worktree) => {
		const stem = worktree.branch.includes("/")
			? worktree.branch.slice(worktree.branch.indexOf("/") + 1)
			: worktree.branch;
		const candidate = `skills/${stem.replace(/^harden-/, "").replace(/-(refactor|harden|fix|feat|wip)$/, "")}`;
		return { worktreePath: worktree.path, candidate };
	});
	const probed = new Set<string>();
	const probeResults = await Promise.all(
		probes.map((probe) => runtime.pathExists(`${probe.worktreePath}/${probe.candidate}`)),
	);
	for (const [index, found] of probeResults.entries()) {
		if (found) {
			const probe = probes[index];
			probed.add(`${probe.worktreePath}::${probe.candidate}`);
		}
	}
	const workspace = renderWorkspace(registry, worktrees, (worktreePath, subfolder) =>
		probed.has(`${worktreePath}::${subfolder}`),
	);
	try {
		await runtime.writeTextFile(workspacePath, stampHeader(workspace));
	} catch {
		return {
			kind: "error",
			code: "write_failed",
			message: "Could not write the workspace file.",
		};
	}
	for (const w of worktrees) {
		await registerCodexProject(w.path).catch(() => {});
	}
	return { kind: "written", path: workspacePath };
}

/**
 * Persist a single branch preference into the registry, then re-render.
 *
 * Parse and write failures are caught and returned as structured `error`
 * results so a malformed `worktree.config.json` or an I/O failure surfaces as a
 * facade envelope instead of an uncaught exception escaping `runCommand`.
 *
 * @param runtime - Injected I/O adapter
 * @param branch - Branch whose pref is being set
 * @param mutate - Applies the change to the branch's prefs in place
 * @param force - Passed through to the drift gate on the follow-up render
 * @returns The sync result after the registry write, or an `error` result when
 *   the registry is unreadable or the write fails
 */
export async function setPrefAndSync(
	runtime: WorkTreeRuntime,
	branch: string,
	mutate: (prefs: Record<string, unknown>) => void,
	force: boolean,
): Promise<Awaited<ReturnType<typeof syncWorkspace>>> {
	const repoRoot = runtime.repoRoot();
	let ownerRoot = repoRoot;
	try {
		const worktrees = await listWorktrees(repoRoot, runtime.run);
		ownerRoot = repoOwnerRootFor(worktrees, repoRoot);
	} catch (error) {
		if (error instanceof WorkTreeDiscoveryError) {
			return { kind: "error", code: error.code, message: error.message };
		}
		throw error;
	}
	const registryPath = `${ownerRoot}/${WORKTREE_REGISTRY_FILE}`;
	const existing = await runtime.readTextFile(registryPath);
	let registry: Registry;
	try {
		registry = parseRegistryText(existing);
	} catch {
		return {
			kind: "error",
			code: "registry_unreadable",
			message: "worktree.config.json is not valid JSON.",
		};
	}
	const prefs = (registry.branches[branch] ?? {}) as Record<string, unknown>;
	mutate(prefs);
	registry.branches[branch] = prefs as Registry["branches"][string];
	try {
		await runtime.writeTextFile(registryPath, `${JSON.stringify(registry, null, "\t")}\n`);
	} catch {
		return {
			kind: "error",
			code: "write_failed",
			message: "Could not write the registry file.",
		};
	}
	return syncWorkspace(runtime, force);
}

/**
 * Validate a color name against the fixed palette.
 *
 * @param value - User-supplied color token
 * @returns The validated color, or null when unknown
 */
export function validateColor(value: string): WorkTreeColor | null {
	return (WORKTREE_COLOR_PALETTE as readonly string[]).includes(value) ? (value as WorkTreeColor) : null;
}

/**
 * Pure command outcome: either success data or a structured failure.
 *
 * runCommand returns this instead of a facade envelope so the whole verb
 * surface is testable without diagnostics context or writers; main() converts
 * it into the facade envelope at the I/O edge.
 */
export type CommandResult =
	| { ok: true; data: Record<string, unknown> }
	| {
			ok: false;
			code: WorkTreeDiagnosticCode;
			message: string;
			action: string;
			exitCode: number;
			recoverability: "change_input" | "repair_state";
			data?: Record<string, unknown>;
	  };

/**
 * Success data carried inside the facade envelope for a render outcome.
 *
 * @param action - The verb that produced this result
 * @param workspacePath - Path to the rendered workspace
 * @returns A success data object
 * @internal
 */
function renderSuccessData(
	action: string,
	workspacePath: string,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return lifecycleResultData({
		action,
		workspace_path: workspacePath,
		changed_state: "written",
		next_safe_action: "Reload the VS Code window to pick up the rendered workspace.",
		...extra,
	});
}

function codexAppSuccessData(branch: string, worktreePath: string): Record<string, unknown> {
	return resultData("app", {
		action: "open_codex_app",
		branch,
		worktree_path: worktreePath,
		changed_state: "none",
		launched: true,
		next_safe_action: "Use the Codex App project for that worktree.",
	});
}

function workspaceStateFor(contents: string | null): "missing" | "ready" | "drifted" {
	if (contents === null) return "missing";
	return isDrift(contents) ? "drifted" : "ready";
}

function statusNextSafeAction(
	workspaceState: "missing" | "ready" | "drifted",
	linkedWorktreeCount: number,
): string {
	if (workspaceState === "drifted") {
		return "Review workspace drift before rendering; force only after preserving real edits.";
	}
	if (linkedWorktreeCount === 0) {
		return "Create a repo-local worktree, then open it in Codex App.";
	}
	return "Choose a linked branch to open in Codex App, or render the workspace.";
}

async function statusSuccessData(runtime: WorkTreeRuntime): Promise<CommandResult> {
	let worktrees: Worktree[];
	let ownerRoot = runtime.repoRoot();
	try {
		worktrees = await listWorktrees(runtime.repoRoot(), runtime.run);
		ownerRoot = repoOwnerRootFor(worktrees, runtime.repoRoot());
	} catch (error) {
		if (error instanceof WorkTreeDiscoveryError) {
			return {
				ok: false,
				code: error.code,
				message: error.message,
				action: "Inspect worktree state, resolve the failure, then retry.",
				exitCode: 1,
				recoverability: "repair_state",
			};
		}
		throw error;
	}

	let registry: Registry;
	try {
		registry = await loadRegistryFromRuntime(runtime, ownerRoot);
		worktrees = await listWorktrees(
			runtime.repoRoot(),
			runtime.run,
			registry.defaults?.ignoredWorktrees ?? [],
		);
		ownerRoot = repoOwnerRootFor(worktrees, runtime.repoRoot());
	} catch (error) {
		if (error instanceof WorkTreeDiscoveryError) {
			return {
				ok: false,
				code: error.code,
				message:
					error.code === "registry_unreadable"
						? "worktree.config.json exists but is not valid JSON."
						: error.message,
				action:
					error.code === "registry_unreadable"
						? "Repair the registry JSON, then retry."
						: "Inspect worktree state, resolve the failure, then retry.",
				exitCode: 1,
				recoverability: "repair_state",
			};
		}
		throw error;
	}

	const workspacePath = workspacePathFor(ownerRoot);
	const state = workspaceStateFor(await runtime.readTextFile(workspacePath));
	const linked = worktrees.filter((worktree) => !worktree.isMain);
	return {
		ok: true,
		data: resultData("status", {
			action: "status",
			changed_state: "none",
			repo_root: runtime.repoRoot(),
			owner_root: ownerRoot,
			workspace_path: workspacePath,
			workspace_state: state,
			worktree_count: worktrees.length,
			linked_worktree_count: linked.length,
			worktrees: worktrees.map((worktree) => {
				const prefs = registry.branches[worktree.branch] ?? {};
				return {
					branch: worktree.branch,
					path: worktree.path,
					is_main: Boolean(worktree.isMain),
					...(prefs.focus ? { focus: prefs.focus } : {}),
					...(prefs.color ? { color: prefs.color } : {}),
				};
			}),
			start_here: ["status", linked.length > 0 ? "app" : "new", "sync"],
			front_door: {
				summary: "Keep the VS Code workspace in sync with repo-local git worktrees.",
				vscode_sync: {
					check: "status",
					rebuild_workspace: "sync",
					open_workspace: "open",
				},
				worktree_crud: ["new", "status", "sync", "rm"],
			},
			crud: {
				create: {
					label: "Make a new repo-local worktree.",
					action: "new",
					mutation: "write",
					target: "branch",
				},
				read: {
					label: "See current worktrees and VS Code workspace state.",
					action: "status",
					mutation: "check",
				},
				update: {
					label: "Rebuild the VS Code workspace, or tweak focus and color.",
					action: "sync",
					mutation: "write",
					alternates: ["focus", "color"],
				},
				delete: {
					label: "Remove a worktree after explicit confirmation.",
					action: "rm",
					mutation: "destructive",
					confirmation: "force_required",
				},
			},
			next_safe_action: statusNextSafeAction(state, linked.length),
		}),
	};
}

/**
 * Convert a sync outcome into a CommandResult.
 *
 * Drift-blocked maps to exit 3 with `repair_state` recoverability; discovery
 * errors map to exit 1. Hints stay prose-only -- the real recovery command
 * lives in docs/git/worktree.md, never inlined.
 *
 * @param action - The verb that triggered the sync
 * @param outcome - The sync result
 * @returns The command result
 * @internal
 */
function fromSync(
	action: string,
	outcome: Awaited<ReturnType<typeof syncWorkspace>>,
): CommandResult {
	if (outcome.kind === "written") {
		return { ok: true, data: renderSuccessData(action, outcome.path) };
	}
	if (outcome.kind === "drift_blocked") {
		return {
			ok: false,
			code: "drift_blocked",
			message: "The workspace was edited since the last render; refusing to overwrite.",
			action: "Review the diff, port real edits into worktree.config.json, then rerun with --force.",
			exitCode: 3,
			recoverability: "repair_state",
		};
	}
	return {
		ok: false,
		code: outcome.code,
		message: outcome.message,
		action: "Inspect worktree and registry state, resolve the failure, then retry.",
		exitCode: 1,
		recoverability: "repair_state",
	};
}

/**
 * A usage failure: bad arguments or an unknown color, mapped to exit 2.
 *
 * @param code - Package-owned diagnostic code
 * @param message - Human-readable failure description
 * @param action - Prose-only repair hint
 * @returns A failing command result
 * @internal
 */
function usageFailure(code: WorkTreeDiagnosticCode, message: string, action: string): CommandResult {
	return { ok: false, code, message, action, exitCode: 2, recoverability: "change_input" };
}

function lifecycleEnvelopeData(
	command: string,
	lifecycle: LifecycleResult,
): Record<string, unknown> {
	return lifecycleResultData(lifecyclePayload(command, lifecycle));
}

function lifecyclePayload(
	command: string,
	lifecycle: LifecycleResult,
): WorkTreeLifecyclePayload {
	return {
		action: command,
		lifecycle_action: lifecycle.action,
		changed_state: lifecycle.changedState,
		preview: lifecycle.preview,
		run_ref: lifecycle.runRef,
		failure_ref: lifecycle.failureRef,
		changes: lifecycle.changes,
		next_safe_action: lifecycle.nextSafeAction,
		reason: lifecycle.reason,
		recovery: lifecycle.recovery,
		retry_safety: lifecycle.recovery?.choices[0]?.retrySafety,
		backup_ref: lifecycle.backupRef,
		resolved_ref: lifecycle.resolvedRef,
		target_path: lifecycle.targetPath,
		mode: lifecycle.mode,
		existing_checkout_path: lifecycle.existingCheckoutPath,
	};
}

function fromAttachLifecycleFailure(lifecycle: LifecycleResult): CommandResult {
	if (lifecycle.reason === "branch_already_checked_out") {
		return {
			ok: false,
			code: "attach_branch_already_checked_out",
			message: "The requested branch is already checked out in another worktree.",
			action: "Use the existing checkout at the path reported in structured result data.",
			exitCode: 2,
			recoverability: "change_input",
			data: lifecyclePayload("attach", lifecycle),
		};
	}
	if (lifecycle.reason === "isolation_unavailable") {
		return {
			ok: false,
			code: "attach_isolation_unavailable",
			message: "Worktree isolation is unavailable for this attach.",
			action:
				"Ask the operator to choose between working in the current checkout and resolving worktree isolation.",
			exitCode: 4,
			recoverability: "repair_state",
			data: lifecyclePayload("attach", lifecycle),
		};
	}
	return fromLifecycleFailure("attach", lifecycle);
}

function fromLifecycleFailure(command: string, lifecycle: LifecycleResult): CommandResult {
	const blocked = lifecycle.changedState === "none" && !lifecycle.failureRef;
	const nextSafeAction = lifecycle.nextSafeAction || "inspect";
	return {
		ok: false,
		code: blocked ? "agent_worktree_blocked" : "agent_worktree_failed",
		message: blocked
			? "Shared worktree runtime blocked the lifecycle result."
			: "Shared worktree runtime reported an incomplete lifecycle result.",
		action: `Follow shared runtime recovery action: ${nextSafeAction}.`,
		exitCode: 1,
		recoverability:
			lifecycle.reason === "target_not_found" ? "change_input" : "repair_state",
		data: lifecyclePayload(command, lifecycle),
	};
}

function fromPostLifecycleSyncFailure(
	command: string,
	lifecycle: LifecycleResult,
	sync: Exclude<Awaited<ReturnType<typeof syncWorkspace>>, { kind: "written" }>,
	extra: Record<string, unknown> = {},
): CommandResult {
	const data = {
		...lifecyclePayload(command, lifecycle),
		...extra,
		render_status: sync.kind,
		render_workspace_path: "path" in sync ? sync.path : undefined,
		render_error_code: "code" in sync ? sync.code : undefined,
	};
	if (sync.kind === "drift_blocked") {
		return {
			ok: false,
			code: "drift_blocked",
			message:
				"The worktree lifecycle completed, but the workspace was edited since the last render.",
			action:
				"Review the diff, port real edits into worktree.config.json, then rerun render with force.",
			exitCode: 3,
			recoverability: "repair_state",
			data,
		};
	}
	return {
		ok: false,
		code: sync.code,
		message: `The worktree lifecycle completed, but the workspace render failed: ${sync.message}`,
		action: "Inspect worktree and registry state, resolve the render failure, then retry.",
		exitCode: 1,
		recoverability: "repair_state",
		data,
	};
}

async function stableOwnerRuntime(runtime: WorkTreeRuntime): Promise<WorkTreeRuntime> {
	try {
		const worktrees = await listWorktrees(runtime.repoRoot(), runtime.run);
		return createRepoRuntime(runtime, repoOwnerRootFor(worktrees, runtime.repoRoot()));
	} catch {
		return runtime;
	}
}

async function worktreeViewForRuntime(
	runtime: WorkTreeRuntime,
): Promise<{ ignoredWorktrees: readonly string[] }> {
	const worktrees = await listWorktrees(runtime.repoRoot(), runtime.run);
	const ownerRoot = repoOwnerRootFor(worktrees, runtime.repoRoot());
	const registry = await loadRegistryFromRuntime(runtime, ownerRoot);
	return { ignoredWorktrees: registry.defaults?.ignoredWorktrees ?? [] };
}

async function resolveCodexAppWorktree(
	runtime: WorkTreeRuntime,
	branch: string,
): Promise<
	| { kind: "target"; worktree: Worktree }
	| { kind: "error"; code: WorkTreeDiagnosticCode; message: string }
> {
	let worktrees: Worktree[];
	try {
		worktrees = await listWorktrees(runtime.repoRoot(), runtime.run);
	} catch (error) {
		if (error instanceof WorkTreeDiscoveryError) {
			return { kind: "error", code: error.code, message: error.message };
		}
		throw error;
	}
	const worktree = worktrees.find((entry) => entry.branch === branch);
	if (!worktree) {
		return {
			kind: "error",
			code: "worktree_not_found",
			message: "No repo-local worktree was found for that branch.",
		};
	}
	return { kind: "target", worktree };
}

/**
 * @internal exported for focused tests; `worktree rm` is the public cleanup entrypoint.
 */
export async function cleanupCodexAppProject(
	runtime: WorkTreeRuntime,
	worktreePath: string,
): Promise<CodexAppProjectCleanupResult> {
	const sidebarState = await removeCodexSidebarState(runtime, worktreePath);
	const threadArchive = await archiveCodexThreadsForCwd(runtime, worktreePath);
	const failed =
		sidebarState.status === "state_unreadable" ||
		sidebarState.status === "write_failed" ||
		threadArchive.status === "partial";
	const changed =
		sidebarState.status === "removed" || threadArchive.status === "archived";
	return {
		worktree_path: worktreePath,
		changed_state: failed ? "partial" : changed ? "complete" : "none",
		sidebar_state: sidebarState,
		thread_archive: threadArchive,
		next_safe_action: "Restart Codex if the removed project still appears in the sidebar.",
	};
}

/**
 * @internal exported for focused tests; not a public Codex state API.
 */
export async function removeCodexSidebarState(
	runtime: Pick<WorkTreeRuntime, "readTextFile" | "writeTextFile">,
	worktreePath: string,
): Promise<CodexAppProjectCleanupResult["sidebar_state"]> {
	const statePath = join(homedir(), ".codex", ".codex-global-state.json");
	const existing = await runtime.readTextFile(statePath);
	if (existing === null) {
		return { status: "state_missing", path: statePath, removed_keys: [] };
	}
	let state: Record<string, unknown>;
	try {
		const parsed = JSON.parse(existing);
		state = asRecord(parsed) ?? {};
	} catch {
		return { status: "state_unreadable", path: statePath, removed_keys: [] };
	}
	const removedKeys: string[] = [];
	removeFromStringArray(state, "electron-saved-workspace-roots", worktreePath, removedKeys);
	removeFromStringArray(state, "project-order", worktreePath, removedKeys);
	removeFromStringArray(state, "pinned-project-ids", worktreePath, removedKeys);
	removeFromStringArray(state, "active-workspace-roots", worktreePath, removedKeys);
	removeRecordEntry(state, "electron-workspace-root-labels", worktreePath, removedKeys);

	const atomState = asRecord(state["electron-persisted-atom-state"]);
	if (atomState) {
		removeRecordEntry(atomState, "sidebar-collapsed-groups", worktreePath, removedKeys);
		removeRecordEntry(
			atomState,
			"local-env-selections-by-workspace",
			`local:${worktreePath}`,
			removedKeys,
		);
	}
	if (removedKeys.length === 0) {
		return { status: "already_absent", path: statePath, removed_keys: [] };
	}
	try {
		await runtime.writeTextFile(statePath, `${JSON.stringify(state)}\n`);
	} catch {
		return { status: "write_failed", path: statePath, removed_keys: removedKeys };
	}
	return { status: "removed", path: statePath, removed_keys: removedKeys };
}

/**
 * @internal exported for focused tests; `worktree rm` owns the operator-facing path.
 */
export async function archiveCodexThreadsForCwd(
	runtime: Pick<WorkTreeRuntime, "run">,
	worktreePath: string,
): Promise<CodexAppProjectCleanupResult["thread_archive"]> {
	const ids = new Set<string>();
	let readableDb = false;
	for (const stateDbPath of codexStateDbPaths()) {
		const result = await runtime.run([
			"sqlite3",
			"-readonly",
			stateDbPath,
			`select id from threads where cwd = '${escapeSqlString(worktreePath)}' and archived = 0;`,
		]);
		if (!result.ok) continue;
		readableDb = true;
		for (const line of result.stdout.split(/\r?\n/)) {
			const id = line.trim();
			if (id) ids.add(id);
		}
	}
	if (!readableDb) {
		return {
			status: "unavailable",
			archived_thread_ids: [],
			failed_thread_ids: [],
			skipped_thread_ids: [],
		};
	}
	const currentThreadId = process.env.CODEX_THREAD_ID;
	const archivedThreadIds: string[] = [];
	const failedThreadIds: string[] = [];
	const skippedThreadIds: string[] = [];
	for (const id of ids) {
		if (currentThreadId && id === currentThreadId) {
			skippedThreadIds.push(id);
			continue;
		}
		const result = await runtime.run(["codex", "archive", id]);
		if (result.ok) {
			archivedThreadIds.push(id);
		} else {
			failedThreadIds.push(id);
		}
	}
	return {
		status:
			failedThreadIds.length > 0
				? "partial"
				: archivedThreadIds.length > 0
					? "archived"
					: "none",
		archived_thread_ids: archivedThreadIds,
		failed_thread_ids: failedThreadIds,
		skipped_thread_ids: skippedThreadIds,
	};
}

function codexStateDbPaths(): readonly string[] {
	const sqliteHome = process.env.CODEX_SQLITE_HOME ?? join(homedir(), ".codex", "sqlite");
	return Array.from(
		new Set([
			join(sqliteHome, "state_5.sqlite"),
			join(homedir(), ".codex", "state_5.sqlite"),
		]),
	);
}

function escapeSqlString(value: string): string {
	return value.replaceAll("'", "''");
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function removeFromStringArray(
	record: Record<string, unknown>,
	key: string,
	value: string,
	removedKeys: string[],
): void {
	const existing = record[key];
	if (!Array.isArray(existing)) return;
	const next = existing.filter((entry) => entry !== value);
	if (next.length === existing.length) return;
	record[key] = next;
	removedKeys.push(key);
}

function removeRecordEntry(
	record: Record<string, unknown>,
	key: string,
	entryKey: string,
	removedKeys: string[],
): void {
	const nested = asRecord(record[key]);
	if (!nested || !(entryKey in nested)) return;
	delete nested[entryKey];
	removedKeys.push(`${key}.${entryKey}`);
}

/**
 * Parsed worktree invocation: the verb plus its positional arguments and flags.
 */
export interface ParsedInvocation {
	command: string;
	positionals: string[];
	force: boolean;
	forceRender?: boolean;
	noInput?: boolean;
	repoRoot?: string;
	dryRun?: boolean;
	track?: boolean;
	pr?: number;
	parseError?: CommandResult;
}

/**
 * Parse a diagnostic-stripped argv into a verb, positionals, and command flags.
 *
 * @param argv - argv tail with diagnostic flags already removed
 * @returns The parsed invocation
 *
 * @example
 * ```typescript
 * parseInvocation(["color", "codex/x", "blue"])
 * // → { command: "color", positionals: ["codex/x", "blue"], force: false }
 * ```
 */
export function parseInvocation(argv: readonly string[]): ParsedInvocation {
	const positionals: string[] = [];
	let force = false;
	let forceRender = false;
	let noInput = false;
	let repoRoot: string | undefined;
	let dryRun = false;
	let track = false;
	let pr: number | undefined;
	let command = "";
	const usedFlags = new Set<string>();
	const fail = (message: string): ParsedInvocation => ({
		command,
		positionals,
		force,
		forceRender,
		noInput,
		repoRoot,
		...(dryRun ? { dryRun } : {}),
		...(track ? { track } : {}),
		...(pr !== undefined ? { pr } : {}),
		parseError: usageFailure("usage_error", message, "Review the command help and retry."),
	});
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--force") {
			force = true;
			usedFlags.add(arg);
		} else if (arg === "--force-render") {
			forceRender = true;
			usedFlags.add(arg);
		} else if (arg === "--no-input") {
			noInput = true;
			usedFlags.add(arg);
		} else if (arg === "--dry-run") {
			dryRun = true;
			usedFlags.add(arg);
		} else if (arg === "--track") {
			track = true;
			usedFlags.add(arg);
		} else if (arg === "--json") {
			// --json selects output mode; WorkTree always emits JSON envelopes.
			usedFlags.add(arg);
		} else if (arg === "--repo") {
			usedFlags.add(arg);
			const value = argv[i + 1];
			if (!value || value.startsWith("--")) {
				return fail("--repo needs a path value.");
			}
			repoRoot = value;
			i += 1;
		} else if (arg === "--pr") {
			usedFlags.add(arg);
			const value = argv[i + 1];
			if (!value || value.startsWith("--")) {
				return fail("--pr needs a positive integer.");
			}
			const parsedPr = Number.parseInt(value, 10);
			if (!/^\d+$/.test(value) || parsedPr < 1) {
				return fail("--pr needs a positive integer.");
			}
			pr = parsedPr;
			i += 1;
		} else if (arg.startsWith("--")) {
			return fail(`Unknown flag '${arg}'.`);
		} else if (command === "") {
			command = arg;
		} else {
			positionals.push(arg);
		}
	}
	if (command in worktreeContracts) {
		const allowed = new Set(Object.keys(worktreeContracts[command as keyof typeof worktreeContracts].flags));
		for (const flag of usedFlags) {
			if (!allowed.has(flag)) {
				return fail(`Flag '${flag}' is not accepted by worktree ${command}.`);
			}
		}
	}
	return {
		command,
		positionals,
		force,
		forceRender,
		noInput,
		repoRoot,
		...(dryRun ? { dryRun } : {}),
		...(track ? { track } : {}),
		...(pr !== undefined ? { pr } : {}),
	};
}

async function runFocusCommand(
	invocation: ParsedInvocation,
	runtime: WorkTreeRuntime,
): Promise<CommandResult> {
	const [branch, subfolder] = invocation.positionals;
	if (!branch || !subfolder) {
		return usageFailure(
			"usage_error",
			"focus needs <branch> and <subfolder>.",
			"Rerun as: worktree focus <branch> <subfolder>.",
		);
	}
	return fromSync(
		"focus",
		await setPrefAndSync(runtime, branch, (prefs) => {
			prefs.focus = subfolder;
		}, invocation.force),
	);
}

async function runColorCommand(
	invocation: ParsedInvocation,
	runtime: WorkTreeRuntime,
): Promise<CommandResult> {
	const [branch, color] = invocation.positionals;
	if (!branch || !color) {
		return usageFailure(
			"usage_error",
			"color needs <branch> and <color>.",
			"Rerun as: worktree color <branch> <color>.",
		);
	}
	const validated = validateColor(color);
	if (validated === null) {
		return usageFailure(
			"unknown_color",
			`Unknown color '${color}'. Allowed: ${WORKTREE_COLOR_PALETTE.join(", ")}.`,
			"Rerun with a color from the allowed palette.",
		);
	}
	return fromSync(
		"color",
		await setPrefAndSync(runtime, branch, (prefs) => {
			prefs.color = validated;
		}, invocation.force),
	);
}

async function runLifecycleCommand(
	invocation: ParsedInvocation,
	runtime: WorkTreeRuntime,
): Promise<CommandResult> {
	const { command, force } = invocation;
	if (command === "rm" && !force && (invocation.noInput || !runtime.isInteractive())) {
		return usageFailure(
			"usage_error",
			`${command} needs an explicit force flag in non-interactive runs.`,
			"Retry with explicit confirmation, or run interactively.",
		);
	}
	const [branch] = invocation.positionals;
	if (!branch) {
		return usageFailure(
			"usage_error",
			`${command} needs <branch>.`,
			`Rerun as: worktree ${command} <branch>.`,
		);
	}
	const lifecycleRuntime = await stableOwnerRuntime(runtime);
	let removedWorktreePath: string | undefined;
	if (command === "rm") {
		const target = await resolveCodexAppWorktree(lifecycleRuntime, branch);
		if (target.kind === "target") {
			removedWorktreePath = target.worktree.path;
		}
	}
	const lifecycle =
		command === "new"
			? await createWorktree({
					cwd: lifecycleRuntime.repoRoot(),
					run: adaptRunner(lifecycleRuntime.run),
					branch,
					dryRun: false,
					runId: `worktree-${runtime.now()}`,
				})
			: await deleteWorktree({
					cwd: lifecycleRuntime.repoRoot(),
					run: adaptRunner(lifecycleRuntime.run),
					branch,
					dryRun: false,
					force,
					deleteBranch: false,
					runId: `worktree-${runtime.now()}`,
				});
	if (lifecycle.changedState !== "complete") {
		return fromLifecycleFailure(command, lifecycle);
	}
	const codexCleanup =
		command === "rm" && removedWorktreePath
			? await cleanupCodexAppProject(lifecycleRuntime, removedWorktreePath)
			: undefined;
	const extra = codexCleanup ? { codex_app_project_cleanup: codexCleanup } : {};
	const sync = await syncWorkspace(lifecycleRuntime, Boolean(invocation.forceRender));
	if (sync.kind !== "written") {
		return fromPostLifecycleSyncFailure(command, lifecycle, sync, extra);
	}
	return { ok: true, data: renderSuccessData(command, sync.path, extra) };
}

async function runAttachCommand(
	invocation: ParsedInvocation,
	runtime: WorkTreeRuntime,
): Promise<CommandResult> {
	const [ref] = invocation.positionals;
	if (ref && invocation.pr !== undefined) {
		return usageFailure(
			"usage_error",
			"attach accepts either <ref> or --pr, not both.",
			"Choose one attach selector and retry.",
		);
	}
	if (invocation.track && invocation.pr === undefined) {
		return usageFailure(
			"usage_error",
			"attach --track needs --pr <n>.",
			"Add a pull request selector or omit tracking.",
		);
	}
	if (!ref && invocation.pr === undefined) {
		return usageFailure(
			"usage_error",
			"attach needs <ref> or --pr <n>.",
			"Choose an existing ref or pull request.",
		);
	}
	if (invocation.positionals.length > 1) {
		return usageFailure(
			"usage_error",
			"attach accepts one positional <ref>.",
			"Remove extra positional values and retry.",
		);
	}

	const lifecycle = await attachWorktree({
		cwd: runtime.repoRoot(),
		run: adaptRunner(runtime.run),
		ref,
		pr: invocation.pr,
		track: invocation.track,
		dryRun: Boolean(invocation.dryRun),
		runId: `worktree-${runtime.now()}`,
		now: runtime.now,
	});
	if (lifecycle.preview) {
		return { ok: true, data: lifecycleEnvelopeData("attach", lifecycle) };
	}
	if (lifecycle.changedState !== "complete") {
		return fromAttachLifecycleFailure(lifecycle);
	}
	const sync = await syncWorkspace(runtime, Boolean(invocation.forceRender));
	if (sync.kind !== "written") {
		return fromPostLifecycleSyncFailure("attach", lifecycle, sync);
	}
	return {
		ok: true,
		data: lifecycleResultData({
			...lifecyclePayload("attach", lifecycle),
			render_status: "written",
			render_workspace_path: sync.path,
		}),
	};
}

async function runCleanCommand(runtime: WorkTreeRuntime): Promise<CommandResult> {
	let view: { ignoredWorktrees: readonly string[] };
	try {
		view = await worktreeViewForRuntime(runtime);
	} catch (error) {
		if (error instanceof WorkTreeDiscoveryError) {
			return {
				ok: false,
				code: error.code,
				message:
					error.code === "registry_unreadable"
						? "worktree.config.json exists but is not valid JSON."
						: error.message,
				action:
					error.code === "registry_unreadable"
						? "Repair the registry JSON, then retry."
						: "Inspect git worktree state, then retry.",
				exitCode: 1,
				recoverability: "repair_state",
			};
		}
		throw error;
	}
	const preview = await cleanPreview({
		cwd: runtime.repoRoot(),
		run: adaptRunner(runtime.run),
		ignoredWorktreePathPatterns: view.ignoredWorktrees,
	});
	return {
		ok: true,
		data: resultData("clean", {
			action: "clean_preview",
			changed_state: "none",
			preview,
			next_safe_action: "Review cleanup candidates before pruning.",
		}),
	};
}

async function ownerRootForRuntime(runtime: WorkTreeRuntime): Promise<string> {
	try {
		const worktrees = await listWorktrees(runtime.repoRoot(), runtime.run);
		return repoOwnerRootFor(worktrees, runtime.repoRoot());
	} catch {
		return runtime.repoRoot();
	}
}

async function runOpenCommand(
	invocation: ParsedInvocation,
	runtime: WorkTreeRuntime,
): Promise<CommandResult> {
	const [name] = invocation.positionals;
	const ownerRoot = await ownerRootForRuntime(runtime);
	let registry: Registry;
	try {
		registry = await loadRegistryFromRuntime(runtime, ownerRoot);
	} catch {
		return {
			ok: false,
			code: "registry_unreadable",
			message: "worktree.config.json exists but is not valid JSON.",
			action: "Repair the registry JSON, then retry.",
			exitCode: 1,
			recoverability: "repair_state",
		};
	}
	if (!name) {
		return {
			ok: true,
			data: resultData("open", {
				action: "list_workspaces",
				workspace: workspacePathFor(ownerRoot),
			}),
		};
	}
	const workspacePath = workspaceTargetFor(ownerRoot, name);
	const launched = await runtime.launchCode(workspacePath, registry.defaults?.codeBin);
	if (!launched) {
		return usageFailure(
			"code_not_found",
			"Could not launch VS Code; `code` was not found on PATH.",
			"Install the `code` shell command, or set defaults.codeBin in worktree.config.json.",
		);
	}
	return {
		ok: true,
		data: resultData("open", {
			action: "open_workspace",
			launched: true,
			workspace_path: workspacePath,
		}),
	};
}

async function runAppCommand(
	invocation: ParsedInvocation,
	runtime: WorkTreeRuntime,
): Promise<CommandResult> {
	const [branch] = invocation.positionals;
	if (!branch) {
		return usageFailure(
			"usage_error",
			"app needs <branch>.",
			"Rerun as: worktree app <branch>.",
		);
	}
	const target = await resolveCodexAppWorktree(runtime, branch);
	if (target.kind === "error") {
		return {
			ok: false,
			code: target.code,
			message: target.message,
			action:
				target.code === "worktree_not_found"
					? "Create or choose an existing repo-local worktree branch, then retry."
					: "Inspect worktree state, resolve the failure, then retry.",
			exitCode: target.code === "worktree_not_found" ? 2 : 1,
			recoverability:
				target.code === "worktree_not_found" ? "change_input" : "repair_state",
		};
	}
	const launched = await runtime.launchCodexApp(target.worktree.path);
	if (!launched) {
		return usageFailure(
			"codex_app_not_found",
			"Could not launch Codex Desktop.",
			"Install or expose the Codex Desktop launcher, then retry.",
		);
	}
	return {
		ok: true,
		data: codexAppSuccessData(target.worktree.branch, target.worktree.path),
	};
}

function runCommandsCommand(): CommandResult {
	return {
		ok: true,
		data: resultData("commands", {
			...projectCommandDiscoveryTree(
				WORKTREE_COMMAND_ORDER.map((commandId) => [commandId, worktreeContracts[commandId]] as const),
			),
		}),
	};
}

/**
 * Route a parsed invocation to its handler and return a pure CommandResult.
 *
 * Owns verb routing and result shape; delegates all I/O to the injected
 * runtime, so the entire command surface is testable without spawning
 * processes or touching disk.
 *
 * @param invocation - The parsed verb and flags
 * @param runtime - Injected I/O adapter
 * @returns The command result
 */
export async function runCommand(
	invocation: ParsedInvocation,
	runtime: WorkTreeRuntime,
): Promise<CommandResult> {
	const { command } = invocation;
	if (invocation.parseError) {
		return invocation.parseError;
	}

	switch (command) {
		case "status":
			return statusSuccessData(runtime);
		case "sync":
			return fromSync("sync", await syncWorkspace(runtime, invocation.force));
		case "focus":
			return runFocusCommand(invocation, runtime);
		case "color":
			return runColorCommand(invocation, runtime);
		case "new":
		case "rm":
			return runLifecycleCommand(invocation, runtime);
		case "attach":
			return runAttachCommand(invocation, runtime);
		case "clean":
			return runCleanCommand(runtime);
		case "open":
			return runOpenCommand(invocation, runtime);
		case "app":
			return runAppCommand(invocation, runtime);
		case "commands":
			return runCommandsCommand();

		default:
			return usageFailure(
				"usage_error",
				`Unknown command '${command || "(none)"}'.`,
				"Run with --help to see available commands.",
			);
	}
}

function renderFrontDoorUsage(): string {
	const commandLines = WORKTREE_COMMAND_ORDER.map((command) =>
		`  ${command.padEnd(8)} ${worktreeContracts[command].summary}`,
	);
	return `${[
		"Usage: worktree <command> --json",
		"       worktree <command> --help",
		"       worktree help <command>",
		"",
		"WorkTree keeps VS Code's workspace file in sync with repo-local git worktrees.",
		"",
		"VS Code sync:",
		"  Check what VS Code will see      worktree status --json",
		"  Rebuild the VS Code workspace    worktree sync --json",
		"  Find the VS Code workspace path  worktree open --json",
		"",
		"Worktree CRUD:",
		"  Create a worktree                worktree new <branch> --json",
		"  Attach an existing ref or PR     worktree attach <ref> --json | worktree attach --pr <n> --json",
		"  Read/list current worktrees      worktree status --json",
		"  Update the VS Code view          worktree sync --json",
		"  Update focus or color            worktree focus <branch> <subfolder> --json | worktree color <branch> <color> --json",
		"  Delete a worktree                worktree rm <branch> --force --json",
		"",
		"Codex App:",
		"  Add/open a project in sidebar    worktree app <branch> --json",
		"  Remove sidebar state on delete   worktree rm <branch> --force --json",
		"",
		"Fast path:",
		"  worktree status --json",
		"  worktree sync --json",
		"  worktree app <branch> --json",
		"  worktree new <branch> --json",
		"  worktree attach <ref> --json",
		"  worktree rm <branch> --force --json",
		"",
		"Commands:",
		...commandLines,
		"",
		"Use worktree commands --json for machine-readable discovery metadata.",
	].join("\n")}\n`;
}

function renderHelpForArgv(argv: readonly string[]): string {
	const helpTopic = argv[0] === "help" ? argv[1] : undefined;
	const command = (helpTopic ?? argv.find((arg) => arg in worktreeContracts)) as
		| keyof typeof worktreeContracts
		| undefined;
	if (command && command in worktreeContracts) {
		return renderCommandUsage(worktreeContracts[command]);
	}
	return renderFrontDoorUsage();
}

/**
 * CLI entry point: parse argv, run the command, emit the JSON envelope, exit.
 *
 * @param argv - Process argv tail (after the executable name)
 * @param options - Optional runtime and writers for tests
 * @returns The process exit code
 *
 * @example
 * ```typescript
 * const code = await main(["sync", "--json"], { runtime })
 * ```
 */
export async function main(
	argv: readonly string[],
	options: { runtime?: WorkTreeRuntime; stdout?: CliWriter; stderr?: CliWriter } = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultRuntime();
	const stdout = options.stdout ?? process.stdout;

	if (
		argv.includes("--help") ||
		argv.includes("-h") ||
		argv[0] === "help" ||
		argv.length === 0
	) {
		stdout.write(renderHelpForArgv(argv));
		return 0;
	}
	if (argv.includes("--version")) {
		stdout.write(`worktree ${VERSION}\n`);
		return 0;
	}

	const parsedDiagnostics = parseCliDiagnosticArgv(argv);
	const runId = parsedDiagnostics.options.runId;
	const startedAtMs = parsedDiagnostics.options.startedAtMs;
	const invocation = parseInvocation(parsedDiagnostics.argv);
	const runtimeForInvocation = invocation.repoRoot
		? createRepoRuntime(runtime, invocation.repoRoot)
		: runtime;
	const result = await runCommand(invocation, runtimeForInvocation);
	const durationMs = runtime.now() - startedAtMs;

	if (result.ok) {
		writeJsonEnvelope(
			stdout,
			createCliRuntimeSuccessEnvelope({ run_id: runId, data: result.data }),
			{ runId, durationMs },
		);
		return 0;
	}

	writeJsonEnvelope(
		stdout,
		createCliRuntimeErrorEnvelope({
			run_id: runId,
			process_exit_code: result.exitCode,
			error:
				result.recoverability === "change_input"
					? createCliRuntimeError({
							run_id: runId,
							code: result.code,
							message: result.message,
							exit_code: result.exitCode,
							recoverability: "change_input",
							retryable: false,
							hint: { action: result.recoverability, summary: result.action },
						})
					: createCliRepairStateRuntimeError({
							run_id: runId,
							code: result.code,
							message: result.message,
							exit_code: result.exitCode,
							hint: { action: result.recoverability, summary: result.action },
						}),
			data: lifecycleResultData({
				changed_state: "none",
				next_safe_action: result.action,
				...result.data,
			}),
		}),
		{ runId, durationMs },
	);
	return result.exitCode;
}

function resultData<TData extends object>(
	command: WorkTreeCommand,
	data: CommandResultPayload<TData>,
): Record<string, unknown> {
	return createCommandResultData(
		worktreeContracts[command] as { resultContract?: CommandFacadeResultContract },
		data,
	);
}

function lifecycleResultData<TData extends object>(
	data: CommandResultPayload<TData>,
): Record<string, unknown> {
	return createCommandResultData(
		{ resultContract: worktreeRenderResultContract },
		data,
	);
}

function createRepoRuntime(runtime: WorkTreeRuntime, repoRoot: string): WorkTreeRuntime {
	return {
		...runtime,
		repoRoot: () => repoRoot,
	};
}

async function loadRegistryFromRuntime(runtime: WorkTreeRuntime, repoRoot = runtime.repoRoot()): Promise<Registry> {
	return parseRegistryText(await runtime.readTextFile(`${repoRoot}/${WORKTREE_REGISTRY_FILE}`));
}

function workspaceTargetFor(currentRepoRoot: string, name: string): string {
	if (name.endsWith(".code-workspace")) {
		return name;
	}
	if (isAbsolute(name)) {
		return workspacePathFor(name);
	}
	return workspacePathFor(join(dirname(currentRepoRoot), name));
}

function expandHome(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

if (import.meta.main) {
	main(process.argv.slice(2)).then((code) => {
		process.exit(code);
	});
}
