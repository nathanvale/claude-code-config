import type {
	AgentWorktreeMutationReadiness,
	AgentWorktreeSeam,
} from "./model.ts";
import type { GitRunner } from "./discovery.ts";

/**
 * Ordered merge-evidence checks inherited from the SideQuest source shape.
 *
 * This is a cascade, not a GoF Chain of Responsibility: the order is fixed by
 * git semantics, and later checks depend on evidence from earlier checks.
 */
export const MERGE_EVIDENCE_CASCADE_STEPS = [
	{
		id: "ancestor",
		purpose: "Prove the branch is already reachable from the target branch.",
		stopsWhen: "merged",
	},
	{
		id: "ahead_behind",
		purpose: "Measure branch divergence before expensive squash detection.",
		stopsWhen: "never",
	},
	{
		id: "squash",
		purpose:
			"Reserve squash integration for a sound patch-id proof; v1 does not guess.",
		stopsWhen: "never",
	},
] as const;

/**
 * Stable ids for the merge-evidence cascade.
 */
export type MergeEvidenceStepId =
	(typeof MERGE_EVIDENCE_CASCADE_STEPS)[number]["id"];

/**
 * Method by which a branch was proven integrated.
 */
export type MergeIntegrationMethod = "ancestor" | "squash";

/**
 * Structured issue codes for merge evidence.
 *
 * These mirror the important SideQuest failure lanes while staying package-owned
 * for agent-worktree envelopes and tests.
 */
export const MERGE_EVIDENCE_ISSUE_CODES = [
	"shallow_clone",
	"shallow_check_failed",
	"merge_base_failed",
	"merge_base_lookup_failed",
	"cherry_timeout",
	"cherry_failed",
	"commit_tree_failed",
	"git_path_failed",
	"detection_disabled",
	"detection_aborted",
	"enrichment_failed",
] as const;

/**
 * Merge-evidence issue code.
 */
export type MergeEvidenceIssueCode =
	(typeof MERGE_EVIDENCE_ISSUE_CODES)[number];

/**
 * Structured issue emitted by the merge-evidence cascade.
 *
 * Counts reliability matters because agents should not treat every warning as
 * a hard blocker when ahead/behind evidence is still trustworthy.
 *
 * @example
 * ```typescript
 * const issue: MergeEvidenceIssue = {
 *   code: "shallow_check_failed",
 *   severity: "warning",
 *   source: "shallow_guard",
 *   message: "Shallow check failed; detection continued.",
 *   countsReliable: true,
 * }
 * ```
 */
export interface MergeEvidenceIssue {
	/** Stable package-owned issue code. */
	code: MergeEvidenceIssueCode;
	/** Whether detection stopped or continued with degraded evidence. */
	severity: "warning" | "error";
	/** Cascade step or guard that produced the issue. */
	source: MergeEvidenceStepId | "shallow_guard" | "kill_switch" | "enrichment";
	/** Human-readable detail safe for operator display. */
	message: string;
	/** Whether ahead/behind counts remain usable despite the issue. */
	countsReliable: boolean;
}

/**
 * Merge evidence shared by doctor, status, check, delete, and clean.
 *
 * This is the functional core data model. Git subprocesses should produce this
 * shape; policy code should consume this shape without shelling out.
 *
 * @example
 * ```typescript
 * const evidence: MergeEvidence = {
 *   merged: true,
 *   method: "squash",
 *   commitsAhead: 0,
 *   commitsBehind: 2,
 *   issues: [],
 * }
 * ```
 */
export interface MergeEvidence {
	/** Whether the branch is proven integrated into its target. */
	merged: boolean;
	/** How integration was proven, when known. */
	method?: MergeIntegrationMethod;
	/** Number of commits ahead of the target branch, or -1 when unknown. */
	commitsAhead: number;
	/** Number of commits behind the target branch, or -1 when unknown. */
	commitsBehind: number;
	/** Structured warnings or errors from the evidence cascade. */
	issues: readonly MergeEvidenceIssue[];
}

/**
 * Port for git-backed evidence collection.
 *
 * The runtime adapter will shell out to git; tests can provide an in-memory
 * adapter. Keep policy logic below this boundary pure.
 *
 * @example
 * ```typescript
 * const port: GitEvidencePort = {
 *   detectMergeEvidence: async () => ({
 *     merged: false,
 *     commitsAhead: 1,
 *     commitsBehind: 0,
 *     issues: [],
 *   }),
 * }
 * ```
 */
export interface GitEvidencePort {
	/**
	 * Collect merge evidence for one branch.
	 *
	 * @param input - Branch and target branch to inspect
	 * @returns Merge evidence without applying safety policy
	 */
	detectMergeEvidence(input: {
		branch: string;
		targetBranch: string;
		cwd?: string;
	}): Promise<MergeEvidence>;
}

/**
 * Create a git-backed merge evidence port.
 *
 * The port keeps failures as structured evidence issues so check/status can
 * return `unknown` instead of guessing when a shallow clone or git error hides
 * integration truth.
 *
 * @param run - Git subprocess runner
 * @param cwd - Repo cwd for git invocations
 * @returns Merge evidence port
 *
 * @example
 * ```typescript
 * const port = createGitEvidencePort(defaultGitRunner, "/repo")
 * ```
 */
export function createGitEvidencePort(
	run: GitRunner,
	cwd: string,
): GitEvidencePort {
	return {
		async detectMergeEvidence(input) {
			const repoCwd = input.cwd ?? cwd;
			const shallow = await run(["git", "rev-parse", "--is-shallow-repository"], {
				cwd: repoCwd,
			});
			if (shallow.ok && shallow.stdout.trim() === "true") {
				return {
					merged: false,
					commitsAhead: -1,
					commitsBehind: -1,
					issues: [
						{
							code: "shallow_clone",
							severity: "error",
							source: "shallow_guard",
							message: "Shallow clone prevents reliable merge evidence.",
							countsReliable: false,
						},
					],
				};
			}

			const ancestor = await run(
				["git", "merge-base", "--is-ancestor", input.branch, input.targetBranch],
				{ cwd: repoCwd },
			);
			const counts = await run(
				[
					"git",
					"rev-list",
					"--left-right",
					"--count",
					`${input.targetBranch}...${input.branch}`,
				],
				{ cwd: repoCwd },
			);
			const { commitsBehind, commitsAhead, issue } = parseAheadBehind(counts);
			if (ancestor.ok) {
				return {
					merged: true,
					method: "ancestor",
					commitsAhead,
					commitsBehind,
					issues: issue && issue.severity === "warning" ? [issue] : [],
				};
			}

			if (ancestor.code !== 1) {
				return {
					merged: false,
					commitsAhead,
					commitsBehind,
					issues: [
						...(issue ? [issue] : []),
						{
							code: "merge_base_failed",
							severity: "error",
							source: "ancestor",
							message: "Ancestor merge evidence could not be collected.",
							countsReliable: false,
						},
					],
				};
			}

			return {
				merged: false,
				commitsAhead,
				commitsBehind,
				issues: [
					...(issue ? [issue] : []),
					{
						code: "detection_disabled",
						severity: "error",
						source: "squash",
						message: "Squash merge proof is unavailable in v1.",
						countsReliable: false,
					},
				],
			};
		},
	};
}

function parseAheadBehind(result: {
	ok: boolean;
	stdout: string;
}): {
	commitsBehind: number;
	commitsAhead: number;
	issue?: MergeEvidenceIssue;
} {
	if (!result.ok) {
		return {
			commitsBehind: -1,
			commitsAhead: -1,
			issue: {
				code: "merge_base_lookup_failed",
				severity: "error",
				source: "ahead_behind",
				message: "Ahead/behind counts could not be collected.",
				countsReliable: false,
			},
		};
	}
	const [behindRaw, aheadRaw] = result.stdout.trim().split(/\s+/);
	const commitsBehind = Number.parseInt(behindRaw ?? "", 10);
	const commitsAhead = Number.parseInt(aheadRaw ?? "", 10);
	if (!Number.isFinite(commitsBehind) || !Number.isFinite(commitsAhead)) {
		return {
			commitsBehind: -1,
			commitsAhead: -1,
			issue: {
				code: "merge_base_lookup_failed",
				severity: "error",
				source: "ahead_behind",
				message: "Ahead/behind counts were not parseable.",
				countsReliable: false,
			},
		};
	}
	return { commitsBehind, commitsAhead };
}

/**
 * Input to the pure branch-safety decision table.
 *
 * Separate this from git collection so doctor, delete, clean, and tests can
 * reuse the same policy without spawning subprocesses.
 */
export interface BranchSafetyInput {
	/** Branch under evaluation. */
	branch: string;
	/** Whether the branch is protected by repo policy. */
	protectedBranch: boolean;
	/** Whether the worktree or branch has uncommitted changes. */
	dirty: boolean;
	/** Whether the branch is checked out in another worktree. */
	checkedOutElsewhere: boolean;
	/** Merge evidence collected by the cascade. */
	evidence: MergeEvidence;
}

/**
 * Branch-safety decision categories used by lifecycle commands.
 */
export type BranchSafetyDisposition =
	| "allow"
	| "block"
	| "warn"
	| "handoff";

/**
 * Pure decision-table result for delete and clean planning.
 *
 * The `reason` is package-owned vocabulary; UI and CLI layers can translate it
 * into operator text or agent next-safe-actions.
 */
export interface BranchSafetyDecision {
	/** High-level action class for lifecycle commands. */
	disposition: BranchSafetyDisposition;
	/** Stable package-owned reason. */
	reason:
		| "protected_branch"
		| "dirty"
		| "checked_out_elsewhere"
		| "merged"
		| "unmerged"
		| "evidence_unreliable";
	/** Whether the same input can safely be retried after inspection. */
	retrySafe: boolean;
	/** Merge method when it helped the decision. */
	method?: MergeIntegrationMethod;
}

/**
 * Classify branch safety from already-collected evidence.
 *
 * @param input - Branch facts and merge evidence
 * @returns Lifecycle-safe decision without shelling out
 *
 * @example
 * ```typescript
 * const decision = classifyBranchSafety({
 *   branch: "feat/demo",
 *   protectedBranch: false,
 *   dirty: false,
 *   checkedOutElsewhere: false,
 *   evidence: { merged: true, method: "ancestor", commitsAhead: 0, commitsBehind: 1, issues: [] },
 * })
 * ```
 */
export function classifyBranchSafety(
	input: BranchSafetyInput,
): BranchSafetyDecision {
	if (input.protectedBranch) {
		return {
			disposition: "block",
			reason: "protected_branch",
			retrySafe: false,
		};
	}
	if (input.dirty) {
		return { disposition: "block", reason: "dirty", retrySafe: true };
	}
	if (input.checkedOutElsewhere) {
		return {
			disposition: "block",
			reason: "checked_out_elsewhere",
			retrySafe: true,
		};
	}
	if (hasUnreliableEvidence(input.evidence)) {
		return {
			disposition: "handoff",
			reason: "evidence_unreliable",
			retrySafe: false,
		};
	}
	if (input.evidence.merged) {
		return {
			disposition: "allow",
			reason: "merged",
			retrySafe: true,
			...(input.evidence.method ? { method: input.evidence.method } : {}),
		};
	}
	return { disposition: "warn", reason: "unmerged", retrySafe: false };
}

/**
 * Translate branch-safety policy into doctor mutation-readiness vocabulary.
 *
 * @param decision - Branch safety decision from the shared lifecycle policy
 * @returns Mutation readiness value exposed by doctor
 *
 * @example
 * ```typescript
 * mutationReadinessFromBranchSafetyDecision({ disposition: "allow", reason: "merged", retrySafe: true })
 * ```
 */
export function mutationReadinessFromBranchSafetyDecision(
	decision: BranchSafetyDecision,
): AgentWorktreeMutationReadiness {
	return decision.disposition === "allow" || decision.disposition === "warn"
		? "ready"
		: "blocked";
}

function hasUnreliableEvidence(evidence: MergeEvidence): boolean {
	if (evidence.merged && evidence.method) return false;
	return evidence.issues.some(
		(issue) => issue.severity === "error" || !issue.countsReliable,
	);
}

/**
 * Scaffold shell: merge intelligence owns branch-safety evidence.
 *
 * Status: earned.
 * Deletion test: deleting this seam turns status, check, delete, and cleanup
 * safety back into branch-name heuristics.
 */
export const MERGE_INTELLIGENCE_SEAM = {
	id: "merge-intelligence",
	ownerPath: "runtime/agent-worktree/src/merge-intelligence.ts",
	status: "earned",
	deletionTest:
		"Deleting merge intelligence turns cleanup and delete safety into weak branch heuristics.",
	nextUnit: "U3",
} as const satisfies AgentWorktreeSeam;
