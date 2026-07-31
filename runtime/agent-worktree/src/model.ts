/**
 * Package-owned contract id for the agent-worktree lifecycle surface.
 *
 * Kept near the shared model so CLI envelopes, command discovery, and tests
 * branch on one literal instead of copying product vocabulary.
 *
 * @defaultValue "agent-worktree.lifecycle"
 */
export const AGENT_WORKTREE_CONTRACT_ID = "agent-worktree.lifecycle" as const;

/**
 * Machine schema version for v1 agent-worktree envelopes.
 *
 * Increment only when package-owned JSON data changes incompatibly.
 *
 * @defaultValue "1"
 */
export const AGENT_WORKTREE_SCHEMA_VERSION = "1" as const;

/**
 * Shared package name accepted in the decision log.
 *
 * The package and canonical CLI share this identity so docs, contracts, and
 * bin aliases do not drift.
 *
 * @defaultValue "agent-worktree"
 */
export const AGENT_WORKTREE_PACKAGE_NAME = "agent-worktree" as const;

/**
 * Canonical CLI command accepted in the decision log.
 *
 * Tests assert this value through package metadata and rendered help.
 *
 * @defaultValue "agent-worktree"
 */
export const AGENT_WORKTREE_CLI_NAME = "agent-worktree" as const;

/**
 * Public v1 command ids.
 *
 * Includes doctor, lifecycle CRUD, recovery, inspect, handoff, refresh, and
 * command discovery. The exact command behavior is owned by the facade contract.
 */
export const AGENT_WORKTREE_COMMANDS = [
	"doctor",
	"list",
	"create",
	"attach",
	"status",
	"check",
	"delete",
	"clean",
	"recover",
	"refresh",
	"inspect",
	"handoff",
	"commands",
] as const;

/**
 * Command id union for facade-backed routing.
 */
export type AgentWorktreeCommand = (typeof AGENT_WORKTREE_COMMANDS)[number];

/**
 * Status vocabulary for doctor checks and aggregate readiness.
 *
 * `unknown` keeps uncertainty visible when git evidence is incomplete.
 */
export const AGENT_WORKTREE_STATUSES = [
	"ok",
	"warn",
	"blocked",
	"unknown",
] as const;

/**
 * Doctor and check status values.
 */
export type AgentWorktreeStatus = (typeof AGENT_WORKTREE_STATUSES)[number];

/**
 * Mutation-readiness values for doctor routing.
 *
 * Values answer the aggregate repo posture without pretending uncertainty is a
 * boolean.
 */
export const AGENT_WORKTREE_MUTATION_READINESS = [
	"ready",
	"blocked",
	"unknown",
] as const;

/**
 * Aggregate mutation-readiness value.
 */
export type AgentWorktreeMutationReadiness =
	(typeof AGENT_WORKTREE_MUTATION_READINESS)[number];

/**
 * Changed-state vocabulary for failures and recovery refs.
 *
 * This answers whether a later agent can retry, inspect, or hand off safely.
 */
export const AGENT_WORKTREE_CHANGED_STATES = [
	"none",
	"partial",
	"complete",
	"unknown",
] as const;

/**
 * Changed-state values emitted in runtime envelopes.
 */
export type AgentWorktreeChangedState =
	(typeof AGENT_WORKTREE_CHANGED_STATES)[number];

/**
 * Typed ref kinds accepted by `inspect`.
 *
 * The string form is `<kind>:<id>` so refs can move through agent handoffs
 * without making handoff itself a persisted ref namespace in v1.
 */
export const AGENT_WORKTREE_REF_KINDS = [
	"worktree",
	"run",
	"failure",
] as const;

/**
 * Ref-kind union for durable inspection.
 */
export type AgentWorktreeRefKind = (typeof AGENT_WORKTREE_REF_KINDS)[number];

/**
 * Durable ref parsed from a handoff snapshot or runtime envelope.
 *
 * @example
 * ```typescript
 * const ref: AgentWorktreeRef = { kind: "failure", id: "abc123" }
 * ```
 */
export interface AgentWorktreeRef {
	/** Ref namespace, such as `failure` or `run`. */
	kind: AgentWorktreeRefKind;
	/** Package-owned id inside the ref namespace. */
	id: string;
}

/**
 * Branch-deletion backup policy for v1 destructive lifecycle commands.
 *
 * Delete behavior must create a local backup ref before branch deletion is
 * attempted so recovery remains possible after partial destructive failures.
 *
 * @defaultValue "always_before_branch_delete"
 */
export const AGENT_WORKTREE_BACKUP_REF_POLICY =
	"always_before_branch_delete" as const;

/**
 * Git ref namespace template for branch-deletion backups.
 *
 * Per-run refs keep a failure record pointed at the exact backup created for
 * that mutation, instead of a later delete overwriting the branch's latest
 * backup.
 *
 * @defaultValue "refs/agent-worktree/backups/<branch>/<run-id>"
 */
export const AGENT_WORKTREE_BACKUP_REF_TEMPLATE =
	"refs/agent-worktree/backups/<branch>/<run-id>" as const;

/**
 * Store subdirectories owned by the main-owner `.agent-worktree/` store.
 *
 * These names mirror the durable typed-ref families v1 needs to inspect after
 * partial failures without transcript context.
 */
export const AGENT_WORKTREE_STORE_DIRS = [
	"runs",
	"failures",
	"worktrees",
] as const;

/**
 * Retry-safety classes for lifecycle failure recovery.
 */
export const AGENT_WORKTREE_RECOVERY_RETRY_SAFETY = [
	"same_input_safe",
	"same_input_unsafe",
	"inspect_first",
	"operator_required",
] as const;

/**
 * Retry-safety value.
 */
export type AgentWorktreeRecoveryRetrySafety =
	(typeof AGENT_WORKTREE_RECOVERY_RETRY_SAFETY)[number];

/**
 * Human-only recovery reasons emitted by lifecycle refusals.
 */
export const AGENT_WORKTREE_HUMAN_HANDOFF_REASONS = [
	"destructive_confirmation",
	"dirty_state",
	"unreliable_evidence",
	"partial_mutation",
	"isolation_unavailable",
] as const;

/**
 * Reason automation stops and transfers lifecycle choice to an operator.
 */
export type AgentWorktreeHumanHandoffReason =
	(typeof AGENT_WORKTREE_HUMAN_HANDOFF_REASONS)[number];

/**
 * Stable lifecycle reasons exposed in structured command data.
 */
export const AGENT_WORKTREE_LIFECYCLE_REASONS = [
	"branch_already_checked_out",
	"branch_already_exists",
	"checked_out_elsewhere",
	"dirty",
	"evidence_unreliable",
	"isolation_unavailable",
	"merged",
	"missing_force",
	"pr_fetch_failed",
	"protected_branch",
	"ref_not_found",
	"target_not_found",
	"target_path_exists",
	"unmerged",
	"worktree_add_failed",
] as const;

/**
 * Typed reason attached to a lifecycle result.
 */
export type AgentWorktreeLifecycleReason =
	(typeof AGENT_WORKTREE_LIFECYCLE_REASONS)[number];

/**
 * Retention warning threshold for local records and backup refs.
 *
 * V1 warns after this age but does not delete. Pruning requires a later
 * explicit command decision.
 *
 * @defaultValue 30
 */
export const AGENT_WORKTREE_RETENTION_WARN_AFTER_DAYS = 30 as const;

/**
 * Run event trail format for durable operation history.
 *
 * JSONL keeps append-only evidence simple and lets later tools stream or slice
 * a run without parsing a monolithic document.
 *
 * @defaultValue "jsonl_per_run"
 */
export const AGENT_WORKTREE_EVENT_TRAIL_FORMAT = "jsonl_per_run" as const;

/**
 * Failure ref template used by durable recovery records.
 *
 * Tying a failure to a run and step keeps inspect output grounded in the
 * mutation context that created the failure.
 *
 * @defaultValue "failure:<run-id>/<step-id>"
 */
export const AGENT_WORKTREE_FAILURE_REF_TEMPLATE =
	"failure:<run-id>/<step-id>" as const;

/**
 * Doctor process behavior when a readable map exists.
 *
 * Blockers and unknowns belong in structured data so agents can route from the
 * map; process failure is reserved for cases where no useful map can be read.
 *
 * @defaultValue "exit_zero_with_readable_map"
 */
export const AGENT_WORKTREE_DOCTOR_EXIT_POLICY =
	"exit_zero_with_readable_map" as const;

/**
 * Public doctor JSON fields agents route from.
 *
 * The CLI contract uses these snake_case field names for machine JSON. Internal
 * helpers may keep local naming conventions.
 */
export const AGENT_WORKTREE_DOCTOR_JSON_FIELDS = [
	"summary",
	"checks",
	"mutation_readiness",
	"blockers",
	"next_actions",
] as const;

/**
 * Same-input retry values emitted by failure records.
 *
 * This field answers only whether repeating the same command input is safe.
 * Richer recovery choices remain named actions.
 */
export const AGENT_WORKTREE_SAME_INPUT_RETRY = [
	"safe",
	"unsafe",
	"unknown",
] as const;

/**
 * Same-input retry value.
 */
export type AgentWorktreeSameInputRetry =
	(typeof AGENT_WORKTREE_SAME_INPUT_RETRY)[number];

/**
 * Failure-record fields required for recovery routing.
 *
 * The fields mirror the recovery questions a later agent needs answered before
 * retry, repair, or handoff.
 */
export const AGENT_WORKTREE_FAILURE_RECORD_FIELDS = [
	"what_happened",
	"changed_state",
	"changed",
	"same_input_retry",
	"next_actions",
	"diagnostics",
] as const;

/**
 * Worktree lookup inputs accepted by lifecycle commands.
 */
export const AGENT_WORKTREE_LOOKUP_INPUTS = ["id", "branch", "path"] as const;

/**
 * Public JSON output policy for command results.
 *
 * Commands return object envelopes so metadata, projection, pagination, and
 * diagnostic refs can be added without changing result shape.
 *
 * @defaultValue "object_envelopes_only"
 */
export const AGENT_WORKTREE_JSON_OUTPUT_POLICY =
	"object_envelopes_only" as const;

/**
 * Diagnostic output policy for the public CLI.
 *
 * Machine JSON stays on stdout; diagnostics route to stderr or durable refs.
 *
 * @defaultValue "stderr_or_durable_refs"
 */
export const AGENT_WORKTREE_DIAGNOSTIC_OUTPUT_POLICY =
	"stderr_or_durable_refs" as const;

/**
 * Diagnostic codes owned by the scaffolded package.
 *
 * Behavior-bearing units will expand this list as recovery paths land.
 */
export const AGENT_WORKTREE_DIAGNOSTIC_CODES = [
	"usage_error",
	"runtime_error",
] as const;

/**
 * Diagnostic-code union for package-owned repair handling.
 */
export type AgentWorktreeDiagnosticCode =
	(typeof AGENT_WORKTREE_DIAGNOSTIC_CODES)[number];

/**
 * Scaffold status for owner modules created before behavior lands.
 *
 * `earned` means current pressure justifies the seam now. `provisional` means
 * the module is a named owner, but richer behavior still has to earn its shape.
 */
export type AgentWorktreeSeamStatus = "earned" | "provisional";

/**
 * Seam inventory item used by scaffold tests and handoff snapshots.
 *
 * @example
 * ```typescript
 * const seam: AgentWorktreeSeam = {
 *   id: "doctor",
 *   ownerPath: "runtime/agent-worktree/src/doctor.ts",
 *   status: "earned",
 *   deletionTest: "Deleting doctor scatters repo-readiness aggregation.",
 *   nextUnit: "U2",
 * }
 * ```
 */
export interface AgentWorktreeSeam {
	/** Stable seam id. */
	id: string;
	/** Repo-relative owner path. */
	ownerPath: string;
	/** Whether the seam is earned now or provisional. */
	status: AgentWorktreeSeamStatus;
	/** Deletion-test consequence that earns or limits the seam. */
	deletionTest: string;
	/** Plan unit that should add real behavior. */
	nextUnit: string;
}

/**
 * Initial seam inventory for the greenfield scaffold.
 *
 * Tests use this as a cheap guard that every planned owner has a shell.
 */
export const AGENT_WORKTREE_SCAFFOLD_SEAMS = [
	{
		id: "command-contract",
		ownerPath: "runtime/agent-worktree/src/command-contract.ts",
		status: "earned",
		deletionTest:
			"Deleting it makes help, discovery, parser acceptance, and runtime proof drift.",
		nextUnit: "U1",
	},
	{
		id: "cli",
		ownerPath: "runtime/agent-worktree/src/cli.ts",
		status: "earned",
		deletionTest:
			"Deleting it leaves no public facade-backed front door for agents.",
		nextUnit: "U1",
	},
	{
		id: "doctor",
		ownerPath: "runtime/agent-worktree/src/doctor.ts",
		status: "earned",
		deletionTest:
			"Deleting it scatters repo-operability aggregation across mutations.",
		nextUnit: "U2",
	},
	{
		id: "discovery",
		ownerPath: "runtime/agent-worktree/src/discovery.ts",
		status: "earned",
		deletionTest:
			"Deleting it duplicates git root and worktree owner resolution across commands.",
		nextUnit: "U2",
	},
	{
		id: "worktrees",
		ownerPath: "runtime/agent-worktree/src/worktrees.ts",
		status: "earned",
		deletionTest:
			"Deleting it spreads lifecycle policy across the CLI and worktree consumer.",
		nextUnit: "U3",
	},
	{
		id: "merge-intelligence",
		ownerPath: "runtime/agent-worktree/src/merge-intelligence.ts",
		status: "earned",
		deletionTest:
			"Deleting it turns cleanup and delete safety back into weak branch heuristics.",
		nextUnit: "U3",
	},
	{
		id: "store",
		ownerPath: "runtime/agent-worktree/src/store.ts",
		status: "earned",
		deletionTest:
			"Deleting it drops the durable recovery surface for partial mutations.",
		nextUnit: "U4",
	},
	{
		id: "projection",
		ownerPath: "runtime/agent-worktree/src/projection.ts",
		status: "earned",
		deletionTest:
			"Deleting it makes doctor, list, status, clean, and handoff invent separate output-budget controls.",
		nextUnit: "U7",
	},
	{
		id: "inspect",
		ownerPath: "runtime/agent-worktree/src/inspect.ts",
		status: "earned",
		deletionTest:
			"Deleting it removes the read path for typed refs after partial failures.",
		nextUnit: "U6",
	},
] as const satisfies readonly AgentWorktreeSeam[];
