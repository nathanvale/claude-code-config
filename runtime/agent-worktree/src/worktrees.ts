import { createHash } from "node:crypto";
import { basename, join } from "node:path";

import {
	type DiscoverRepoOptions,
	type DiscoveredWorktree,
	type GitRunResult,
	type GitRunner,
	type RepoIsolation,
	type RepoDiscovery,
	defaultGitRunner,
	discoverRepo,
	isProtectedBranch,
} from "./discovery.ts";
import {
	type BranchSafetyDecision,
	type MergeEvidence,
	classifyBranchSafety,
	createGitEvidencePort,
	mutationReadinessFromBranchSafetyDecision,
} from "./merge-intelligence.ts";
import { deregisterCodexProject, registerCodexProject } from "./codex-state.ts";
import {
	AGENT_WORKTREE_RECOVERY_RETRY_SAFETY,
	type AgentWorktreeChangedState,
	type AgentWorktreeHumanHandoffReason,
	type AgentWorktreeLifecycleReason,
	type AgentWorktreeRef,
	type AgentWorktreeRecoveryRetrySafety,
	type AgentWorktreeSeam,
} from "./model.ts";
import { normalizeProjectionOptions, summarizeProjection } from "./projection.ts";
import {
	type AgentWorktreeOperationEvent,
	type AgentWorktreeOperationStep,
	type AgentWorktreeRunRecord,
	createFileStore,
	packageRunId,
	summarizeOperationChangedState,
} from "./store.ts";

export const RECOVERY_RETRY_SAFETY = AGENT_WORKTREE_RECOVERY_RETRY_SAFETY;

/**
 * Retry-safety value.
 */
export type RecoveryRetrySafety = AgentWorktreeRecoveryRetrySafety;

/**
 * Human handoff reason for lifecycle commands.
 */
export type HumanHandoffReason = AgentWorktreeHumanHandoffReason;

/**
 * Recovery choice advertised after a failed lifecycle command.
 *
 * Choices are package-owned and can later be translated into facade runtime
 * actions without every command inventing failure vocabulary.
 */
export interface RecoveryChoice {
	/** Stable choice id. */
	id: string;
	/** Retry class for autonomous routing. */
	retrySafety: RecoveryRetrySafety;
	/** Durable ref to inspect before acting, when one exists. */
	ref?: AgentWorktreeRef;
	/** Human handoff reason when automation should stop. */
	handoffReason?: HumanHandoffReason;
	/** Existing checkout path when the safe action is to use that worktree. */
	path?: string;
}

/**
 * Recovery plan derived from changed-state and durable refs.
 */
export interface RecoveryPlan {
	/** Changed-state that produced this plan. */
	changedState: AgentWorktreeChangedState;
	/** Choices available to an agent or operator. */
	choices: readonly RecoveryChoice[];
	/** Next safe action id. */
	nextActionId: string;
}

/**
 * Worktree list result.
 */
export interface WorktreeListResult {
	/** Worktrees after projection limits. */
	worktrees: readonly DiscoveredWorktree[];
	/** Total worktrees before projection. */
	total: number;
	/** True when projection omitted worktrees. */
	truncated: boolean;
	/** Main owner root. */
	mainOwnerRoot?: string;
	/** Active worktree path. */
	activeWorktree?: string;
}

/**
 * Options for projecting the daily worktree view.
 */
export interface WorktreeViewOptions {
	/** Path globs hidden from list/status/clean projections. */
	ignoredWorktreePathPatterns?: readonly string[];
}

/**
 * Worktree status row.
 */
export interface WorktreeStatus {
	/** Worktree entry. */
	worktree: DiscoveredWorktree;
	/** Dirty state in that worktree. */
	dirty: boolean;
	/** Merge evidence when branch and default branch are known. */
	mergeEvidence?: MergeEvidence;
	/** Branch safety decision when evidence exists. */
	safety?: BranchSafetyDecision;
}

/**
 * Status rows plus projection metadata.
 */
export interface WorktreeStatusResult {
	/** Git repository isolation for the invocation cwd, when classifiable. */
	isolation?: RepoIsolation;
	/** Status rows after projection limits. */
	statuses: readonly WorktreeStatus[];
	/** Total worktrees before projection. */
	total: number;
	/** True when projection omitted worktrees. */
	truncated: boolean;
}

/**
 * Check result for a target branch.
 */
export interface WorktreeCheckResult {
	/** Target branch. */
	branch: string;
	/** Whether mutation is allowed. */
	allowed: boolean;
	/** Doctor-compatible mutation readiness for this target. */
	mutationReadiness: "ready" | "blocked" | "unknown";
	/** Safety decision. */
	decision: BranchSafetyDecision;
	/** Merge evidence. */
	evidence: MergeEvidence;
	/** Safe next action. */
	nextSafeAction: string;
}

/**
 * Lifecycle command result.
 */
export interface LifecycleResult {
	/** Command action name. */
	action: string;
	/** Changed-state after the command. */
	changedState: AgentWorktreeChangedState;
	/** True when no mutation occurred. */
	preview: boolean;
	/** Durable run ref, when recorded. */
	runRef?: AgentWorktreeRef;
	/** Durable failure ref, when recorded. */
	failureRef?: AgentWorktreeRef;
	/** What changed or would change. */
	changes: readonly string[];
	/** Safe next action id. */
	nextSafeAction: string;
	/** Stable reason when no mutation or a failure path blocks execution. */
	reason?: AgentWorktreeLifecycleReason;
	/** Recovery plan for mutation/failure paths. */
	recovery?: RecoveryPlan;
	/** Backup ref created before branch deletion. */
	backupRef?: string;
	/** Git object id resolved before attach. */
	resolvedRef?: string;
	/** Standard worktree path selected for attach. */
	targetPath?: string;
	/** Attach checkout mode. */
	mode?: "branch" | "detached" | "pr";
	/** Existing checkout that caused the one-branch guard refusal. */
	existingCheckoutPath?: string;
}

/**
 * Clean preview result.
 */
export interface CleanPreviewResult {
	/** Registered worktree candidates. */
	registeredWorktrees: readonly WorktreeStatus[];
	/** Branches not checked out in any worktree. */
	orphanBranches: readonly string[];
	/** Stale filesystem directories under `.worktrees`. */
	staleDirs: readonly string[];
	/** Blocked candidates and reasons. */
	blockers: readonly { target: string; reason: string }[];
	/** Total registered worktrees before projection. */
	totalRegisteredWorktrees: number;
	/** Total orphan branches before projection. */
	totalOrphanBranches: number;
	/** Total stale dirs before projection. */
	totalStaleDirs: number;
	/** True when any preview list was projection-limited. */
	truncated: boolean;
	/** Preview-only v1 marker. */
	previewOnly: true;
}

/**
 * Match a worktree path against a simple glob pattern.
 *
 * Supports `*` for one path segment fragment and `**` for any path depth.
 * This is intentionally small: enough for local view filters such as
 * `DOUBLE_STAR/fallow-audit-base-cache-*`, without importing a glob engine.
 *
 * @param path - Worktree path to test
 * @param pattern - Glob pattern from the caller's view config
 * @returns True when the path should match that pattern
 *
 * @example
 * ```typescript
 * matchesWorktreePathPattern("/tmp/fallow-audit-base-cache-x", "DOUBLE_STAR/fallow-audit-base-cache-*")
 * ```
 */
export function matchesWorktreePathPattern(path: string, pattern: string): boolean {
	let source = "";
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		const next = pattern[index + 1];
		if (char === "*" && next === "*") {
			source += ".*";
			index += 1;
		} else if (char === "*") {
			source += "[^/]*";
		} else {
			source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		}
	}
	return new RegExp(`^${source}$`).test(path);
}

function viewWorktrees(
	discovery: RepoDiscovery,
	options: WorktreeViewOptions = {},
): readonly DiscoveredWorktree[] {
	const patterns = options.ignoredWorktreePathPatterns ?? [];
	return discovery.worktrees.filter(
		(worktree) =>
			!patterns.some((pattern) =>
				matchesWorktreePathPattern(worktree.path, pattern),
			),
	);
}

/**
 * Build the default recovery plan for a changed-state result.
 *
 * @param input - Changed-state and optional failure ref
 * @returns Recovery plan for a lifecycle command
 *
 * @example
 * ```typescript
 * const plan = buildRecoveryPlan({ changedState: "partial", failureRef: { kind: "failure", id: "run-1/delete" } })
 * ```
 */
export function buildRecoveryPlan(input: {
	changedState: AgentWorktreeChangedState;
	failureRef?: AgentWorktreeRef;
	retrySafety?: RecoveryRetrySafety;
	handoffReason?: HumanHandoffReason;
	existingCheckoutPath?: string;
}): RecoveryPlan {
	if (input.handoffReason === "isolation_unavailable") {
		return {
			changedState: input.changedState,
			nextActionId: "work_in_current_checkout",
			choices: [
				{
					id: "work_in_current_checkout",
					retrySafety: "operator_required",
					handoffReason: "isolation_unavailable",
					...(input.failureRef ? { ref: input.failureRef } : {}),
				},
				{
					id: "stop_and_resolve_environment",
					retrySafety: "operator_required",
					handoffReason: "isolation_unavailable",
					...(input.failureRef ? { ref: input.failureRef } : {}),
				},
			],
		};
	}
	if (input.existingCheckoutPath) {
		return {
			changedState: input.changedState,
			nextActionId: "use_existing_checkout",
			choices: [
				{
					id: "use_existing_checkout",
					retrySafety: "same_input_unsafe",
					path: input.existingCheckoutPath,
					...(input.failureRef ? { ref: input.failureRef } : {}),
				},
			],
		};
	}
	if (input.changedState === "none") {
		const retrySafety = input.retrySafety ?? "same_input_safe";
		const nextActionId =
			retrySafety === "operator_required"
				? "operator_handoff"
				: retrySafety === "inspect_first"
					? "inspect_first"
					: retrySafety === "same_input_unsafe"
						? "change_input"
						: "retry_same_input";
		return {
			changedState: "none",
			nextActionId,
			choices: [
				{
					id: nextActionId,
					retrySafety,
					...(input.handoffReason
						? { handoffReason: input.handoffReason }
						: {}),
				},
			],
		};
	}
	if (input.changedState === "partial") {
		return {
			changedState: "partial",
			nextActionId: "inspect_failure_ref",
			choices: [
				{
					id: "inspect_failure_ref",
					retrySafety: "inspect_first",
					...(input.failureRef ? { ref: input.failureRef } : {}),
					handoffReason: "partial_mutation",
				},
			],
		};
	}
	if (input.changedState === "complete") {
		return {
			changedState: "complete",
			nextActionId: "inspect_result",
			choices: [{ id: "inspect_result", retrySafety: "same_input_unsafe" }],
		};
	}
	return {
		changedState: "unknown",
		nextActionId: "operator_handoff",
		choices: [
			{
				id: "operator_handoff",
				retrySafety: "operator_required",
				...(input.failureRef ? { ref: input.failureRef } : {}),
				handoffReason: "partial_mutation",
			},
		],
	};
}

/**
 * List worktrees from shared discovery.
 *
 * @param options - Discovery and projection options
 * @returns Bounded worktree list result
 *
 * @example
 * ```typescript
 * const list = await listWorktrees({ cwd: process.cwd() })
 * ```
 */
export async function listWorktrees(options: DiscoverRepoOptions & WorktreeViewOptions & {
	limit?: number;
}): Promise<WorktreeListResult> {
	const discovery = await discoverRepo(options);
	const worktrees = viewWorktrees(discovery, options);
	const projection = normalizeProjectionOptions({ limit: options.limit });
	const projectionSummary = summarizeProjection(
		worktrees.length,
		projection.limit,
	);
	return {
		worktrees: worktrees.slice(0, projection.limit),
		total: projectionSummary.total,
		truncated: projectionSummary.truncated,
		mainOwnerRoot: discovery.mainOwnerRoot,
		activeWorktree: discovery.activeWorktree?.path,
	};
}

/**
 * Return status rows with dirty state and merge evidence.
 *
 * @param options - Discovery and projection options
 * @returns Status rows
 *
 * @example
 * ```typescript
 * const rows = await statusWorktrees({ cwd: process.cwd() })
 * ```
 */
export async function statusWorktrees(options: DiscoverRepoOptions & WorktreeViewOptions & {
	limit?: number;
}): Promise<readonly WorktreeStatus[]> {
	return (await statusWorktreeResult(options)).statuses;
}

/**
 * Return status rows with projection metadata.
 *
 * @param options - Discovery and projection options
 * @returns Status result with truncation metadata
 *
 * @example
 * ```typescript
 * const result = await statusWorktreeResult({ cwd: process.cwd(), limit: 10 })
 * ```
 */
export async function statusWorktreeResult(options: DiscoverRepoOptions & WorktreeViewOptions & {
	limit?: number;
}): Promise<WorktreeStatusResult> {
	const run = options.run ?? defaultGitRunner;
	const discovery = await discoverRepo({ cwd: options.cwd, run });
	const statuses = await statusWorktreesForDiscovery(discovery, { ...options, run });
	const worktrees = viewWorktrees(discovery, options);
	const projection = normalizeProjectionOptions({ limit: options.limit });
	const projectionSummary = summarizeProjection(
		worktrees.length,
		projection.limit,
	);
	return {
		isolation: discovery.isolation,
		statuses,
		total: projectionSummary.total,
		truncated: projectionSummary.truncated,
	};
}

/**
 * Build status rows from a precomputed discovery map.
 *
 * Doctor calls this same owner so readiness and mutation commands read the
 * same dirty-state and branch-safety facts.
 *
 * @param discovery - Repo/worktree discovery facts
 * @param options - Runtime hooks and projection limit
 * @returns Status rows with shared safety decisions
 *
 * @internal
 */
export async function statusWorktreesForDiscovery(
	discovery: RepoDiscovery,
	options: DiscoverRepoOptions & WorktreeViewOptions & { limit?: number; run: GitRunner },
): Promise<readonly WorktreeStatus[]> {
	const run = options.run;
	const evidencePort = createGitEvidencePort(run, discovery.gitRoot ?? options.cwd);
	const projection = normalizeProjectionOptions({ limit: options.limit });
	const worktrees = viewWorktrees(discovery, options);
	return Promise.all(
		worktrees.slice(0, projection.limit).map(async (worktree) => {
			const dirtyPromise = isWorktreeDirty(run, worktree.path);
			const mergeEvidencePromise =
				worktree.branch && discovery.defaultBranch
					? evidencePort.detectMergeEvidence({
							branch: worktree.branch,
							targetBranch: discovery.defaultBranch,
							cwd: worktree.path,
						})
					: Promise.resolve(undefined);
			const [dirty, mergeEvidence] = await Promise.all([
				dirtyPromise,
				mergeEvidencePromise,
			]);
			return {
				worktree,
				dirty,
				...(mergeEvidence
					? {
							mergeEvidence,
							safety: classifyBranchSafety({
								branch: worktree.branch ?? "",
								protectedBranch: isProtectedBranch(
									worktree.branch ?? "",
									discovery.defaultBranch,
								),
								dirty,
								checkedOutElsewhere: isBranchCheckedOutElsewhere(
									discovery,
									worktree.branch,
									worktree.path,
								),
								evidence: mergeEvidence,
							}),
						}
					: {}),
			};
		}),
	);
}

/**
 * Check whether a branch is safe for mutation.
 *
 * @param options - Repo cwd, branch, and optional git runner
 * @returns Branch safety result
 *
 * @example
 * ```typescript
 * const check = await checkWorktree({ cwd: "/repo", branch: "feat/x" })
 * ```
 */
export async function checkWorktree(options: DiscoverRepoOptions & {
	branch: string;
}): Promise<WorktreeCheckResult> {
	const run = options.run ?? defaultGitRunner;
	const discovery = await discoverRepo({ cwd: options.cwd, run });
	const worktree = discovery.worktrees.find(
		(entry) => entry.branch === options.branch,
	);
	const evidence = discovery.defaultBranch
		? await createGitEvidencePort(
				run,
				discovery.gitRoot ?? options.cwd,
			).detectMergeEvidence({
				branch: options.branch,
				targetBranch: discovery.defaultBranch,
				cwd: worktree?.path ?? discovery.gitRoot ?? options.cwd,
			})
		: unknownDefaultBranchEvidence();
	const dirty = worktree ? await isWorktreeDirty(run, worktree.path) : false;
	const decision = classifyBranchSafety({
		branch: options.branch,
		protectedBranch: isProtectedBranch(options.branch, discovery.defaultBranch),
		dirty,
		checkedOutElsewhere: isBranchCheckedOutElsewhere(
			discovery,
			options.branch,
			worktree?.path,
		),
		evidence,
	});
	return {
		branch: options.branch,
		allowed: decision.disposition === "allow",
		mutationReadiness: mutationReadinessFromBranchSafetyDecision(decision),
		decision,
		evidence,
		nextSafeAction: decision.disposition === "allow" ? "delete" : "handoff",
	};
}

/**
 * Create a worktree, or preview the intended change.
 *
 * @param options - Create options
 * @returns Lifecycle result
 *
 * @example
 * ```typescript
 * const result = await createWorktree({ cwd: "/repo", branch: "feat/x", dryRun: true, runId: "r1" })
 * ```
 */
export async function createWorktree(options: DiscoverRepoOptions & {
	branch: string;
	base?: string;
	dryRun: boolean;
	runId: string;
	now?: () => number;
}): Promise<LifecycleResult> {
	const run = options.run ?? defaultGitRunner;
	const discovery = await discoverRepo({ cwd: options.cwd, run });
	// Probe failure fails closed on mutation; read verbs still degrade to an issue.
	if (discovery.isolation === "linked_worktree" || discovery.isolation === undefined) {
		return isolationRefusal("create");
	}
	const existingCheckoutPath = findBranchCheckoutPath(
		discovery,
		options.branch,
	);
	if (existingCheckoutPath) {
		return branchCheckoutRefusal("create", existingCheckoutPath);
	}
	const base = options.base ?? discovery.currentBranch ?? discovery.defaultBranch ?? "HEAD";
	const targetPath = join(
		discovery.mainOwnerRoot ?? discovery.gitRoot ?? options.cwd,
		".worktrees",
		sanitizeBranchPath(options.branch),
	);
	const changes = [
		`create worktree ${targetPath}`,
		`checkout branch ${options.branch} from ${base}`,
	];
	if (options.dryRun) {
		return {
			action: "create",
			changedState: "none",
			preview: true,
			changes,
			nextSafeAction: "create",
			recovery: buildRecoveryPlan({ changedState: "none" }),
		};
	}
	const result = await run(
		["git", "worktree", "add", "-b", options.branch, targetPath, base],
		{ cwd: discovery.gitRoot ?? options.cwd },
	);
	if (!result.ok) {
		const failure = classifyWorktreeAddFailure(result);
		return failedLifecycle({
			command: "create",
			storeRoot: discovery.storeRoot,
			runId: options.runId,
			stepId: "create_worktree",
			changedState: "none",
			whatHappened: failure.whatHappened,
			whatChanged: [],
			reason: failure.reason,
			retrySafety: failure.retrySafety,
			handoffReason: failure.handoffReason,
			existingCheckoutPath: failure.existingCheckoutPath,
			now: options.now,
		});
	}
	const runRef = await writeRun(discovery.storeRoot, {
		runId: options.runId,
		command: "create",
		now: options.now,
		steps: [
			{
				id: "create_worktree",
				action: "create worktree",
				status: "completed",
				changedState: "complete",
			},
		],
	});
	await registerCodexProject(targetPath).catch(() => {});
	return {
		action: "create",
		changedState: "complete",
		preview: false,
		runRef,
		changes,
		nextSafeAction: "status",
		recovery: buildRecoveryPlan({ changedState: "complete" }),
	};
}

/**
 * Attach a worktree to an existing branch, tag, commit, or pull request head.
 *
 * @param options - Attach options
 * @returns Lifecycle result
 *
 * @example
 * ```typescript
 * const result = await attachWorktree({ cwd: "/repo", ref: "feat/x", dryRun: true, runId: "r1" })
 * ```
 */
export async function attachWorktree(options: DiscoverRepoOptions & {
	ref?: string;
	pr?: number;
	track?: boolean;
	dryRun: boolean;
	runId: string;
	now?: () => number;
}): Promise<LifecycleResult> {
	const run = options.run ?? defaultGitRunner;
	const discovery = await discoverRepo({ cwd: options.cwd, run });
	// Probe failure fails closed on mutation; read verbs still degrade to an issue.
	if (discovery.isolation === "linked_worktree" || discovery.isolation === undefined) {
		return isolationRefusal("attach");
	}
	const prBranch = options.pr === undefined ? undefined : `pr-${options.pr}`;
	const requestedRef = prBranch ?? options.ref;
	if (!requestedRef) {
		return refNotFoundRefusal("attach");
	}
	const targetPath = join(
		discovery.mainOwnerRoot ?? discovery.gitRoot ?? options.cwd,
		".worktrees",
		sanitizeBranchPath(requestedRef),
	);
	if (prBranch) {
		if (options.track) {
			return attachTrackedPullRequest({
				run,
				discovery,
				cwd: discovery.gitRoot ?? options.cwd,
				pr: options.pr as number,
				targetPath,
				dryRun: options.dryRun,
				runId: options.runId,
				now: options.now,
			});
		}
		const existingCheckoutPath = findBranchCheckoutPath(discovery, prBranch);
		if (existingCheckoutPath) {
			return branchCheckoutRefusal("attach", existingCheckoutPath);
		}
		const changes = [
			`fetch pull request ${options.pr} into ${prBranch}`,
			`attach worktree ${targetPath}`,
			`checkout existing branch ${prBranch}`,
		];
		if (options.dryRun) {
			return {
				action: "attach",
				changedState: "none",
				preview: true,
				changes,
				nextSafeAction: "attach",
				recovery: buildRecoveryPlan({ changedState: "none" }),
				resolvedRef: prBranch,
				targetPath,
				mode: "pr",
			};
		}
		const fetchResult = await run(
			["git", "fetch", "origin", `pull/${options.pr}/head:${prBranch}`],
			{ cwd: discovery.gitRoot ?? options.cwd },
		);
		if (!fetchResult.ok) {
			const failure = classifyPrFetchFailure(fetchResult);
			return failedLifecycle({
				command: "attach",
				storeRoot: discovery.storeRoot,
				runId: options.runId,
				stepId: "fetch_pr",
				changedState: "none",
				whatHappened: failure.whatHappened,
				whatChanged: [],
				reason: failure.reason,
				retrySafety: failure.retrySafety,
				now: options.now,
			});
		}
		const addResult = await run(
			["git", "worktree", "add", targetPath, prBranch],
			{ cwd: discovery.gitRoot ?? options.cwd },
		);
		if (!addResult.ok) {
			const failure = classifyWorktreeAddFailure(addResult);
			return failedLifecycle({
				command: "attach",
				storeRoot: discovery.storeRoot,
				runId: options.runId,
				stepId: "attach_worktree",
				changedState: "partial",
				whatHappened: failure.whatHappened,
				whatChanged: [`Fetched pull request ${options.pr} into ${prBranch}.`],
				reason: failure.reason,
				retrySafety: failure.retrySafety,
				handoffReason: failure.handoffReason,
				existingCheckoutPath: failure.existingCheckoutPath,
				priorSteps: [
					{
						id: "fetch_pr",
						action: "fetch pull request",
						status: "completed",
						changedState: "complete",
					},
				],
				now: options.now,
			});
		}
		const runRef = await writeRun(discovery.storeRoot, {
			runId: options.runId,
			command: "attach",
			now: options.now,
			steps: [
				{
					id: "fetch_pr",
					action: "fetch pull request",
					status: "completed",
					changedState: "complete",
				},
				{
					id: "attach_worktree",
					action: "attach worktree",
					status: "completed",
					changedState: "complete",
				},
			],
		});
		await registerCodexProject(targetPath).catch(() => {});
		return {
			action: "attach",
			changedState: "complete",
			preview: false,
			runRef,
			changes,
			nextSafeAction: "status",
			recovery: buildRecoveryPlan({ changedState: "complete" }),
			resolvedRef: prBranch,
			targetPath,
			mode: "pr",
		};
	}
	const resolved = await resolveAttachRef(
		run,
		discovery.gitRoot ?? options.cwd,
		requestedRef,
	);
	if (!resolved) {
		return refNotFoundRefusal("attach");
	}
	const resolvedRef = resolved.objectId;
	if (resolved.mode === "branch") {
		const existingCheckoutPath = findBranchCheckoutPath(
			discovery,
			requestedRef,
		);
		if (existingCheckoutPath) {
			return branchCheckoutRefusal("attach", existingCheckoutPath);
		}
	}
	const changes = [
		`attach worktree ${targetPath}`,
		resolved.mode === "branch"
			? `checkout existing branch ${requestedRef}`
			: `checkout detached ref ${requestedRef}`,
	];
	if (options.dryRun) {
		return {
			action: "attach",
			changedState: "none",
			preview: true,
			changes,
			nextSafeAction: "attach",
			recovery: buildRecoveryPlan({ changedState: "none" }),
			resolvedRef,
			targetPath,
			mode: resolved.mode,
		};
	}
	const result = await run(
		resolved.mode === "branch"
			? ["git", "worktree", "add", targetPath, requestedRef]
			: ["git", "worktree", "add", "--detach", targetPath, requestedRef],
		{ cwd: discovery.gitRoot ?? options.cwd },
	);
	if (!result.ok) {
		const failure = classifyWorktreeAddFailure(result);
		return failedLifecycle({
			command: "attach",
			storeRoot: discovery.storeRoot,
			runId: options.runId,
			stepId: "attach_worktree",
			changedState: "none",
			whatHappened: failure.whatHappened,
			whatChanged: [],
			reason: failure.reason,
			retrySafety: failure.retrySafety,
			handoffReason: failure.handoffReason,
			existingCheckoutPath: failure.existingCheckoutPath,
			now: options.now,
		});
	}
	const runRef = await writeRun(discovery.storeRoot, {
		runId: options.runId,
		command: "attach",
		now: options.now,
		steps: [
			{
				id: "attach_worktree",
				action: "attach worktree",
				status: "completed",
				changedState: "complete",
			},
		],
	});
	await registerCodexProject(targetPath).catch(() => {});
	return {
		action: "attach",
		changedState: "complete",
		preview: false,
		runRef,
		changes,
		nextSafeAction: "status",
		recovery: buildRecoveryPlan({ changedState: "complete" }),
		resolvedRef,
		targetPath,
		mode: resolved.mode,
	};
}

async function attachTrackedPullRequest(input: {
	run: GitRunner;
	discovery: RepoDiscovery;
	cwd: string;
	pr: number;
	targetPath: string;
	dryRun: boolean;
	runId: string;
	now?: () => number;
}): Promise<LifecycleResult> {
	const changes = [
		`attach detached worktree ${input.targetPath}`,
		`checkout pull request ${input.pr} with gh for push tracking`,
	];
	if (input.dryRun) {
		return {
			action: "attach",
			changedState: "none",
			preview: true,
			changes,
			nextSafeAction: "attach",
			recovery: buildRecoveryPlan({ changedState: "none" }),
			targetPath: input.targetPath,
			mode: "pr",
		};
	}

	const addResult = await input.run(
		["git", "worktree", "add", "--detach", input.targetPath],
		{ cwd: input.cwd },
	);
	if (!addResult.ok) {
		const failure = classifyWorktreeAddFailure(addResult);
		return failedLifecycle({
			command: "attach",
			storeRoot: input.discovery.storeRoot,
			runId: input.runId,
			stepId: "attach_worktree",
			changedState: "none",
			whatHappened: failure.whatHappened,
			whatChanged: [],
			reason: failure.reason,
			retrySafety: failure.retrySafety,
			handoffReason: failure.handoffReason,
			existingCheckoutPath: failure.existingCheckoutPath,
			now: input.now,
		});
	}

	let checkoutResult: GitRunResult;
	try {
		checkoutResult = await input.run(["gh", "pr", "checkout", String(input.pr)], {
			cwd: input.targetPath,
		});
	} catch (error) {
		return trackedCheckoutFailure(input, isMissingExecutableError(error));
	}
	if (!checkoutResult.ok) {
		return trackedCheckoutFailure(
			input,
			isMissingExecutableResult(checkoutResult),
		);
	}

	const runRef = await writeRun(input.discovery.storeRoot, {
		runId: input.runId,
		command: "attach",
		now: input.now,
		steps: [
			{
				id: "attach_worktree",
				action: "attach detached worktree",
				status: "completed",
				changedState: "complete",
			},
			{
				id: "checkout_pr",
				action: "checkout pull request with gh",
				status: "completed",
				changedState: "complete",
			},
		],
	});
	await registerCodexProject(input.targetPath).catch(() => {});
	return {
		action: "attach",
		changedState: "complete",
		preview: false,
		runRef,
		changes,
		nextSafeAction: "status",
		recovery: buildRecoveryPlan({ changedState: "complete" }),
		targetPath: input.targetPath,
		mode: "pr",
	};
}

function trackedCheckoutFailure(
	input: {
		discovery: RepoDiscovery;
		pr: number;
		targetPath: string;
		runId: string;
		now?: () => number;
	},
	missingGh: boolean,
): Promise<LifecycleResult> {
	return failedLifecycle({
		command: "attach",
		storeRoot: input.discovery.storeRoot,
		runId: input.runId,
		stepId: "checkout_pr",
		changedState: "partial",
		whatHappened: missingGh
			? "GitHub CLI is unavailable for push-tracking checkout."
			: "GitHub CLI could not check out the pull request.",
		whatChanged: [`Created detached worktree at ${input.targetPath}.`],
		reason: missingGh ? "gh_not_found" : "gh_pr_checkout_failed",
		retrySafety: "inspect_first",
		handoffReason: "partial_mutation",
		priorSteps: [
			{
				id: "attach_worktree",
				action: "attach detached worktree",
				status: "completed",
				changedState: "complete",
			},
		],
		now: input.now,
	});
}

function isMissingExecutableError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

function isMissingExecutableResult(result: GitRunResult): boolean {
	return (
		result.code === 127 ||
		/\bENOENT\b|command not found|executable not found|not found in .*PATH/i.test(
			`${result.stderr}\n${result.stdout}`,
		)
	);
}

/**
 * Delete a worktree, optionally deleting its branch after backup ref creation.
 *
 * @param options - Delete options
 * @returns Lifecycle result
 *
 * @example
 * ```typescript
 * const result = await deleteWorktree({ cwd: "/repo", branch: "feat/x", dryRun: true, force: false, deleteBranch: false, runId: "r1" })
 * ```
 */
export async function deleteWorktree(options: DiscoverRepoOptions & {
	branch: string;
	dryRun: boolean;
	force: boolean;
	deleteBranch: boolean;
	runId: string;
	now?: () => number;
}): Promise<LifecycleResult> {
	const run = options.run ?? defaultGitRunner;
	const discovery = await discoverRepo({ cwd: options.cwd, run });
	const target = discovery.worktrees.find(
		(worktree) => worktree.branch === options.branch,
	);
	if (!target) {
		return {
			action: "delete",
			changedState: "none",
			preview: true,
			changes: [],
			nextSafeAction: "list",
			reason: "target_not_found",
			recovery: buildRecoveryPlan({ changedState: "none" }),
		};
	}
	const check = await checkWorktree({
		cwd: options.cwd,
		run,
		branch: options.branch,
	});
	const plannedChanges = [
		`remove worktree ${target.path}`,
		...(options.deleteBranch ? [`delete branch ${options.branch}`] : []),
	];
	if (options.dryRun) {
		return {
			action: "delete",
			changedState: "none",
			preview: true,
			changes: plannedChanges,
			nextSafeAction: check.allowed ? "delete" : "handoff",
			reason: check.allowed ? undefined : check.decision.reason,
			recovery: buildRecoveryPlan({
				changedState: "none",
				retrySafety: check.decision.retrySafe
					? "same_input_safe"
					: "operator_required",
				handoffReason: handoffReasonForDecision(check.decision),
			}),
		};
	}
	if (!options.force) {
		return {
			action: "delete",
			changedState: "none",
			preview: false,
			changes: plannedChanges,
			nextSafeAction: "delete",
			reason: "missing_force",
			recovery: buildRecoveryPlan({
				changedState: "none",
				retrySafety: "inspect_first",
				handoffReason: "destructive_confirmation",
			}),
		};
	}
	if (!check.allowed) {
		return failedLifecycle({
			command: "delete",
			storeRoot: discovery.storeRoot,
			runId: options.runId,
			stepId: "preflight_blocked",
			changedState: "none",
			whatHappened: `Delete blocked by ${check.decision.reason}.`,
			whatChanged: [],
			reason: check.decision.reason,
			retrySafety: check.decision.retrySafe
				? "same_input_safe"
				: "operator_required",
			handoffReason: handoffReasonForDecision(check.decision),
			now: options.now,
		});
	}

	const removeResult = await run(["git", "worktree", "remove", target.path], {
		cwd: discovery.gitRoot ?? options.cwd,
	});
	if (!removeResult.ok) {
		return failedLifecycle({
			command: "delete",
			storeRoot: discovery.storeRoot,
			runId: options.runId,
			stepId: "remove_worktree",
			changedState: "none",
			whatHappened: "Worktree removal failed.",
			whatChanged: [],
			now: options.now,
		});
	}
	await deregisterCodexProject(target.path).catch(() => {});
	if (!options.deleteBranch) {
		const runRef = await writeRun(discovery.storeRoot, {
			runId: options.runId,
			command: "delete",
			now: options.now,
			steps: [
				{
					id: "remove_worktree",
					action: "remove worktree",
					status: "completed",
					changedState: "complete",
				},
			],
		});
		return {
			action: "delete",
			changedState: "complete",
			preview: false,
			runRef,
			changes: ["removed worktree"],
			nextSafeAction: "refresh",
			recovery: buildRecoveryPlan({ changedState: "complete" }),
		};
	}

	const backupRef = `refs/agent-worktree/backups/${sanitizeBranchPath(options.branch)}/${packageRunId(options.runId)}`;
	const backupResult = await run(["git", "update-ref", backupRef, options.branch], {
		cwd: discovery.gitRoot ?? options.cwd,
	});
	if (!backupResult.ok) {
		return failedLifecycle({
			command: "delete",
			storeRoot: discovery.storeRoot,
			runId: options.runId,
			stepId: "create_backup_ref",
			changedState: "partial",
			whatHappened:
				"Backup ref creation failed after worktree removal; branch deletion skipped.",
			whatChanged: ["Worktree removed."],
			now: options.now,
		});
	}
	const deleteBranchResult = await run(["git", "branch", "-D", options.branch], {
		cwd: discovery.gitRoot ?? options.cwd,
	});
	if (!deleteBranchResult.ok) {
		return failedLifecycle({
			command: "delete",
			storeRoot: discovery.storeRoot,
			runId: options.runId,
			stepId: "delete_branch",
			changedState: "partial",
			whatHappened: "Branch deletion failed after worktree removal.",
			whatChanged: ["Worktree removed.", `Backup ref created: ${backupRef}`],
			backupRef,
			now: options.now,
		});
	}
	const runRef = await writeRun(discovery.storeRoot, {
		runId: options.runId,
		command: "delete",
		backupRef,
		now: options.now,
		steps: [
			{
				id: "remove_worktree",
				action: "remove worktree",
				status: "completed",
				changedState: "complete",
			},
			{
				id: "delete_branch",
				action: "delete branch",
				status: "completed",
				changedState: "complete",
			},
		],
	});
	return {
		action: "delete",
		changedState: "complete",
		preview: false,
		runRef,
		backupRef,
		changes: ["removed worktree", "deleted branch"],
		nextSafeAction: "refresh",
		recovery: buildRecoveryPlan({ changedState: "complete" }),
	};
}

/**
 * Refresh durable worktree records from current discovery.
 *
 * @param options - Refresh options
 * @returns Lifecycle result
 */
export async function refreshWorktrees(options: DiscoverRepoOptions & {
	dryRun: boolean;
	runId: string;
	now?: () => number;
}): Promise<LifecycleResult> {
	const discovery = await discoverRepo(options);
	const changes = discovery.worktrees.map(
		(worktree) => `record ${worktree.branch ?? basename(worktree.path)}`,
	);
	if (options.dryRun) {
		return {
			action: "refresh",
			changedState: "none",
			preview: true,
			changes,
			nextSafeAction: "refresh",
			recovery: buildRecoveryPlan({ changedState: "none" }),
		};
	}
	const store = createFileStore(discovery.storeRoot ?? join(options.cwd, ".agent-worktree"));
	for (const worktree of discovery.worktrees) {
		await store.writeWorktree({
			ref: {
				kind: "worktree",
				id: worktreeRecordId(worktree),
			},
			branch: worktree.branch ?? "(detached)",
			path: worktree.path,
			head: worktree.head,
			observedAtMs: options.now ? options.now() : Date.now(),
		});
	}
	const runRef = await writeRun(discovery.storeRoot, {
		runId: options.runId,
		command: "refresh",
		now: options.now,
		steps: [
			{
				id: "refresh_records",
				action: "refresh records",
				status: "completed",
				changedState: "complete",
			},
		],
	});
	return {
		action: "refresh",
		changedState: "complete",
		preview: false,
		runRef,
		changes,
		nextSafeAction: "doctor",
		recovery: buildRecoveryPlan({ changedState: "complete" }),
	};
}

/**
 * Preview cleanup candidates without deleting anything.
 *
 * @param options - Clean options
 * @returns Preview-only cleanup classification
 */
export async function cleanPreview(options: DiscoverRepoOptions & WorktreeViewOptions & {
	limit?: number;
}): Promise<CleanPreviewResult> {
	const run = options.run ?? defaultGitRunner;
	const discovery = await discoverRepo({ cwd: options.cwd, run });
	const projection = normalizeProjectionOptions({ limit: options.limit });
	const worktrees = viewWorktrees(discovery, options);
	const checkedOutBranches = new Set(
		worktrees.flatMap((worktree) => (worktree.branch ? [worktree.branch] : [])),
	);
	const [statuses, branches] = await Promise.all([
		statusWorktreesForDiscovery(discovery, { ...options, run }),
		listBranches(run, discovery.gitRoot ?? options.cwd)
			.catch(() => []),
	]);
	const protectedOrphanBranches = branches.filter(
		(branch) =>
			!checkedOutBranches.has(branch) &&
			isProtectedBranch(branch, discovery.defaultBranch),
	);
	const orphanBranches = branches.filter(
		(branch) =>
			!checkedOutBranches.has(branch) &&
			!isProtectedBranch(branch, discovery.defaultBranch),
	);
	const blockers = statuses.flatMap((status) =>
		status.safety && status.safety.disposition !== "allow"
			? [
					{
						target: status.worktree.branch ?? status.worktree.path,
						reason: status.safety.reason,
					},
				]
			: [],
	).concat(
		protectedOrphanBranches.map((branch) => ({
			target: branch,
			reason: "protected_branch",
		})),
	);
	const registeredSummary = summarizeProjection(
		worktrees.length,
		projection.limit,
	);
	const orphanSummary = summarizeProjection(
		orphanBranches.length,
		projection.limit,
	);
	const staleSummary = summarizeProjection(
		discovery.staleDirs.length,
		projection.limit,
	);
	return {
		registeredWorktrees: statuses.slice(0, projection.limit),
		orphanBranches: orphanBranches.slice(0, projection.limit),
		staleDirs: discovery.staleDirs.slice(0, projection.limit),
		blockers,
		totalRegisteredWorktrees: registeredSummary.total,
		totalOrphanBranches: orphanSummary.total,
		totalStaleDirs: staleSummary.total,
		truncated:
			registeredSummary.truncated ||
			orphanSummary.truncated ||
			staleSummary.truncated,
		previewOnly: true,
	};
}

/**
 * Return a recovery preview for a durable ref.
 *
 * @param input - Typed ref and optional stored recovery state
 * @returns Lifecycle result for recovery routing
 */
export function recoverPreview(input: {
	ref: string;
	changedState?: AgentWorktreeChangedState;
	failureRef?: AgentWorktreeRef;
}): LifecycleResult {
	const changedState = input.changedState ?? "none";
	return {
		action: "recover",
		changedState,
		preview: true,
		failureRef: input.failureRef,
		changes: [`inspect ${input.ref}`],
		nextSafeAction: "inspect",
		recovery: buildRecoveryPlan({
			changedState,
			failureRef: input.failureRef,
		}),
	};
}

async function isWorktreeDirty(
	run: GitRunner,
	cwd: string,
): Promise<boolean> {
	const result = await run(["git", "status", "--porcelain"], { cwd });
	return result.ok ? result.stdout.trim().length > 0 : true;
}

async function listBranches(
	run: GitRunner,
	cwd: string,
): Promise<readonly string[]> {
	const result = await run(
		["git", "for-each-ref", "--format=%(refname:short)", "refs/heads"],
		{ cwd },
	);
	if (!result.ok) return [];
	return result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

async function resolveAttachRef(
	run: GitRunner,
	cwd: string,
	ref: string,
): Promise<{ mode: "branch" | "detached"; objectId: string } | undefined> {
	const branch = await run(
		["git", "show-ref", "--verify", "--hash", `refs/heads/${ref}`],
		{ cwd },
	);
	if (branch.ok) {
		return { mode: "branch", objectId: branch.stdout.trim() };
	}
	const commit = await run(["git", "rev-parse", "--verify", `${ref}^{commit}`], {
		cwd,
	});
	if (!commit.ok) return undefined;
	return { mode: "detached", objectId: commit.stdout.trim() };
}

function findBranchCheckoutPath(
	discovery: RepoDiscovery,
	branch: string | undefined,
	currentPath?: string,
): string | undefined {
	if (!branch) return undefined;
	return discovery.worktrees.find(
		(worktree) =>
			worktree.branch === branch &&
			(currentPath === undefined || worktree.path !== currentPath),
	)?.path;
}

function isBranchCheckedOutElsewhere(
	discovery: RepoDiscovery,
	branch: string | undefined,
	currentPath: string | undefined,
): boolean {
	return findBranchCheckoutPath(discovery, branch, currentPath) !== undefined;
}

function refNotFoundRefusal(action: "attach" | "create"): LifecycleResult {
	return {
		action,
		changedState: "none",
		preview: false,
		changes: [],
		nextSafeAction: "change_input",
		reason: "ref_not_found",
		recovery: buildRecoveryPlan({
			changedState: "none",
			retrySafety: "same_input_unsafe",
		}),
	};
}

function isolationRefusal(action: "attach" | "create"): LifecycleResult {
	return {
		action,
		changedState: "none",
		preview: false,
		changes: [],
		nextSafeAction: "work_in_current_checkout",
		reason: "isolation_unavailable",
		recovery: buildRecoveryPlan({
			changedState: "none",
			retrySafety: "operator_required",
			handoffReason: "isolation_unavailable",
		}),
	};
}

function branchCheckoutRefusal(
	action: "attach" | "create",
	existingCheckoutPath: string,
): LifecycleResult {
	return {
		action,
		changedState: "none",
		preview: false,
		changes: [],
		nextSafeAction: "use_existing_checkout",
		reason: "branch_already_checked_out",
		recovery: buildRecoveryPlan({
			changedState: "none",
			retrySafety: "same_input_unsafe",
			existingCheckoutPath,
		}),
		existingCheckoutPath,
	};
}

interface WorktreeFailureClassification {
	reason: AgentWorktreeLifecycleReason;
	retrySafety: RecoveryRetrySafety;
	whatHappened: string;
	handoffReason?: HumanHandoffReason;
	existingCheckoutPath?: string;
}

function classifyWorktreeAddFailure(
	result: GitRunResult,
): WorktreeFailureClassification {
	const diagnostic = `${result.stderr}\n${result.stdout}`.trim();
	const checkedOutMatch = diagnostic.match(
		/already checked out at ['"]?([^'"\r\n]+)['"]?/i,
	);
	if (checkedOutMatch?.[1]) {
		return {
			reason: "branch_already_checked_out",
			retrySafety: "same_input_unsafe",
			whatHappened: "The requested branch is already checked out.",
			existingCheckoutPath: checkedOutMatch[1],
		};
	}
	if (/a branch named .+ already exists/i.test(diagnostic)) {
		return {
			reason: "branch_already_exists",
			retrySafety: "same_input_unsafe",
			whatHappened: "The requested branch already exists.",
		};
	}
	if (
		/permission denied|operation not permitted|read-only file system|sandbox/i.test(
			diagnostic,
		)
	) {
		return {
			reason: "isolation_unavailable",
			retrySafety: "operator_required",
			whatHappened:
				"Worktree isolation is unavailable in the current environment.",
			handoffReason: "isolation_unavailable",
		};
	}
	if (/already exists|directory .+ exists/i.test(diagnostic)) {
		return {
			reason: "target_path_exists",
			retrySafety: "same_input_unsafe",
			whatHappened: "The target worktree path already exists.",
		};
	}
	if (
		/invalid reference|not a valid object name|unknown revision|ambiguous argument|not found/i.test(
			diagnostic,
		)
	) {
		return {
			reason: "ref_not_found",
			retrySafety: "same_input_unsafe",
			whatHappened: "The requested branch or ref was not found.",
		};
	}
	return {
		reason: "worktree_add_failed",
		retrySafety: "inspect_first",
		whatHappened: "Git could not add the worktree.",
	};
}

function classifyPrFetchFailure(
	result: GitRunResult,
): WorktreeFailureClassification {
	const diagnostic = `${result.stderr}\n${result.stdout}`.trim();
	if (/couldn't find remote ref|remote ref .+ not found/i.test(diagnostic)) {
		return {
			reason: "ref_not_found",
			retrySafety: "same_input_unsafe",
			whatHappened: "The pull request head ref was not found.",
		};
	}
	return {
		reason: "pr_fetch_failed",
		retrySafety: "inspect_first",
		whatHappened: "Git could not fetch the pull request head.",
	};
}

function unknownDefaultBranchEvidence(): MergeEvidence {
	return {
		merged: false,
		commitsAhead: -1,
		commitsBehind: -1,
		issues: [
			{
				code: "merge_base_lookup_failed",
				severity: "error",
				source: "ahead_behind",
				message: "Default branch is unknown; merge evidence is unavailable.",
				countsReliable: false,
			},
		],
	};
}

function handoffReasonForDecision(
	decision: BranchSafetyDecision,
): HumanHandoffReason | undefined {
	if (decision.reason === "dirty") return "dirty_state";
	if (decision.reason === "evidence_unreliable") return "unreliable_evidence";
	if (decision.reason === "protected_branch") {
		return "destructive_confirmation";
	}
	return undefined;
}

function worktreeRecordId(worktree: DiscoveredWorktree): string {
	const label = sanitizeBranchPath(worktree.branch ?? basename(worktree.path));
	const pathHash = createHash("sha256")
		.update(worktree.path)
		.digest("hex")
		.slice(0, 8);
	return `${label}-${pathHash}`;
}

async function failedLifecycle(input: {
	command: "attach" | "create" | "delete" | "refresh";
	storeRoot?: string;
	runId: string;
	stepId: string;
	changedState: AgentWorktreeChangedState;
	whatHappened: string;
	whatChanged: readonly string[];
	backupRef?: string;
	reason?: AgentWorktreeLifecycleReason;
	retrySafety?: RecoveryRetrySafety;
	handoffReason?: HumanHandoffReason;
	existingCheckoutPath?: string;
	priorSteps?: readonly AgentWorktreeOperationStep[];
	now?: () => number;
}): Promise<LifecycleResult> {
	const failureRef = { kind: "failure", id: `${packageRunId(input.runId)}/${input.stepId}` } as const;
	const recovery = buildRecoveryPlan({
		changedState: input.changedState,
		failureRef,
		retrySafety: input.retrySafety,
		handoffReason: input.handoffReason,
		existingCheckoutPath: input.existingCheckoutPath,
	});
	const runRef = await writeRun(input.storeRoot, {
		runId: input.runId,
		command: input.command,
		backupRef: input.backupRef,
		now: input.now,
		steps: [
			...(input.priorSteps ?? []),
			{
				id: input.stepId,
				action: input.stepId,
				status: "failed",
				changedState: input.changedState,
				failureRef,
			},
		],
	});
	if (input.storeRoot) {
		const store = createFileStore(input.storeRoot);
		try {
			await store.writeFailure({
				ref: failureRef,
				runId: packageRunId(input.runId),
				stepId: input.stepId,
				changedState: input.changedState,
				retrySafety:
					input.retrySafety ??
					(input.changedState === "none" ? "same_input_safe" : "inspect_first"),
				whatHappened: input.whatHappened,
				whatChanged: input.whatChanged,
				nextSafeActions: recovery.choices.map((choice) => choice.id),
				backupRef: input.backupRef,
			});
		} catch {
			// The lifecycle result still carries the failure ref when the local
			// operational store is unavailable; doctor exposes store readiness.
		}
	}
	return {
		action: input.command,
		changedState: input.changedState,
		preview: false,
		runRef,
		failureRef,
		changes: input.whatChanged,
		nextSafeAction:
			input.command === "attach" || input.command === "create"
				? recovery.nextActionId
				: "inspect",
		reason: input.reason,
		recovery,
		backupRef: input.backupRef,
		existingCheckoutPath: input.existingCheckoutPath,
	};
}

async function writeRun(
	storeRoot: string | undefined,
	input: {
		runId: string;
		command: "attach" | "create" | "delete" | "refresh";
		steps: readonly AgentWorktreeOperationStep[];
		backupRef?: string;
		now?: () => number;
	},
): Promise<AgentWorktreeRef | undefined> {
	if (!storeRoot) return undefined;
	const runId = packageRunId(input.runId);
	const changedState = summarizeOperationChangedState(input.steps);
	const createdAtMs = input.now ? input.now() : Date.now();
	const events = buildOperationEvents({
		runId,
		steps: input.steps,
		changedState,
		createdAtMs,
	});
	const record: AgentWorktreeRunRecord = {
		runId,
		facadeRunId: input.runId,
		command: input.command,
		status: input.steps.some((step) => step.status === "failed")
			? "failed"
			: "completed",
		changedState,
		steps: input.steps,
		events,
		createdAtMs,
		backupRef: input.backupRef,
	};
	try {
		await createFileStore(storeRoot).writeRun(record);
	} catch {
		return undefined;
	}
	return { kind: "run", id: runId };
}

function buildOperationEvents(input: {
	runId: string;
	steps: readonly AgentWorktreeOperationStep[];
	changedState: AgentWorktreeChangedState;
	createdAtMs: number;
}): readonly AgentWorktreeOperationEvent[] {
	const events: AgentWorktreeOperationEvent[] = [
		{
			kind: "run_started",
			runId: input.runId,
			changedState: "none",
			createdAtMs: input.createdAtMs,
		},
	];
	for (const step of input.steps) {
		if (step.status === "completed") {
			events.push({
				kind: "step_completed",
				runId: input.runId,
				stepId: step.id,
				changedState: step.changedState,
				createdAtMs: input.createdAtMs,
			});
		}
		if (step.status === "failed") {
			events.push({
				kind: "step_failed",
				runId: input.runId,
				stepId: step.id,
				changedState: step.changedState,
				...(step.failureRef ? { ref: step.failureRef } : {}),
				createdAtMs: input.createdAtMs,
			});
		}
		if (step.status === "running") {
			events.push({
				kind: "step_started",
				runId: input.runId,
				stepId: step.id,
				changedState: "none",
				createdAtMs: input.createdAtMs,
			});
		}
	}
	if (!input.steps.some((step) => step.status === "failed")) {
		events.push({
			kind: "run_completed",
			runId: input.runId,
			changedState: input.changedState,
			createdAtMs: input.createdAtMs,
		});
	}
	return events;
}

function sanitizeBranchPath(branch: string): string {
	return (
		branch.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") ||
		"branch"
	);
}

/**
 * Scaffold shell: worktrees owns lifecycle policy.
 *
 * Status: earned.
 * Deletion test: deleting this seam spreads create, list, status, check,
 * delete, clean, recover, and refresh policy across the CLI and `worktree` consumer.
 */
export const WORKTREES_SEAM = {
	id: "worktrees",
	ownerPath: "runtime/agent-worktree/src/worktrees.ts",
	status: "earned",
	deletionTest:
		"Deleting worktrees spreads lifecycle policy across the CLI and worktree consumer.",
	nextUnit: "U3",
} as const satisfies AgentWorktreeSeam;
