/**
 * Runtime contract values for the Issue-to-PR v2 helper.
 *
 * Runtime-owned string sets, key sets, prefix constants, and the numeric
 * `MAX_BUILDER_ATTEMPTS` cap that the rest of the helper validates against.
 * Keeping them in executable code (not just erased TypeScript types or prose)
 * is acceptance criterion AC2 of issue #51.
 *
 * **U6 addition:** `RUNBOOK_VERSION` is the single source of truth for the
 * v2 workflow-contract version. Compared as a string against the ledger
 * frontmatter `runbook_version` field — no semver, no integer coercion.
 */

/**
 * The workflow-contract version this runtime implements. Changes only when
 * ledger interpretation, routing, migration, override evidence, or role
 * packet semantics change — not for documentation edits, reference
 * reshuffles, source commits, or added tests.
 *
 * Plain string by design so future major versions ("4", "5") can stay
 * comparable without semver tooling. Bumping this value is a deliberate
 * U6+ contract decision.
 */
export const RUNBOOK_VERSION = "3" as const;
export type RunbookVersion = typeof RUNBOOK_VERSION;

export const AC_SOURCE_VALUES = [
  "gold-standard",
  "variant-heading",
  "loose-checkbox-block",
  "numbered-requirements",
  "pasted",
  "drafted",
] as const;
export type AcSource = (typeof AC_SOURCE_VALUES)[number];

/**
 * The four-state enum the U6 runbook-version skew classifier returns
 * (alongside `null` for the no-ledger case). Ordered to match the U6
 * spec's `LedgerSnapshot.runbook_version_skew` enumeration:
 *
 * 1. `matched` — frontmatter equals `RUNBOOK_VERSION`.
 * 2. `missing` — frontmatter has no value (legacy ledger).
 * 3. `mismatched` — frontmatter has a value but it does not equal
 *    `RUNBOOK_VERSION`.
 * 4. `continuation-evidence-present` — skew detected but operator-
 *    authored continuation evidence in `## Notes` lets the workflow
 *    proceed.
 *
 * `ordering: catalog` on the surfaced contract slice reflects this
 * spec-defined order so an agent enumerating skew states without
 * reading source sees the same order documented in the references.
 */
export const RUNBOOK_VERSION_SKEW_STATES = [
  "matched",
  "missing",
  "mismatched",
  "continuation-evidence-present",
] as const;
export type RunbookVersionSkewState =
  (typeof RUNBOOK_VERSION_SKEW_STATES)[number];

export const NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_MARKER =
  "implementation-attempt-checkpoint";
export const NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_ROOT_KEY =
  "implementation_attempt_checkpoint";
export const NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_FIELDS = [
  "batch_id",
  "implementation_commit",
  "attempt_lane",
  "timestamp",
] as const;

export const NOTES_VALIDATOR_WAVE_COMPLETED_MARKER =
  "validator-wave-completed";
export const NOTES_VALIDATOR_WAVE_COMPLETED_ROOT_KEY =
  "validator_wave_completed";
export const NOTES_VALIDATOR_WAVE_COMPLETED_SCALAR_FIELDS = [
  "batch_id",
  "implementation_commit",
  "attempt_lane",
  "outcome",
] as const;
export const NOTES_VALIDATOR_WAVE_COMPLETED_LIST_FIELDS = [
  "personas",
  "findings",
] as const;
export const NOTES_VALIDATOR_WAVE_DISPATCH_EVIDENCE_FIELDS = [
  "role",
  "target_id",
  "cli_route_id",
] as const;
export const NOTES_VALIDATOR_WAVE_COMPLETED_FIELDS = [
  "batch_id",
  "implementation_commit",
  "attempt_lane",
  "personas",
  "dispatch_evidence",
  "outcome",
  "findings",
] as const;
export const VALIDATOR_WAVE_OUTCOMES = ["clean", "findings-recorded"] as const;

export const NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_MARKER =
  "runbook-version-skew-continuation";
export const NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_ROOT_KEY =
  "runbook_version_skew_continuation";
export const NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_FIELDS = [
  "ledger_version",
  "runtime_version",
  "operator_decision",
  "timestamp",
  "route_context",
  "reference_context",
  "accepted_risk",
] as const;

export const ALWAYS_ON_VALIDATOR_PERSONAS = [
  "compound-engineering:ce-correctness-reviewer",
  "compound-engineering:ce-testing-reviewer",
  "compound-engineering:ce-maintainability-reviewer",
  "compound-engineering:ce-project-standards-reviewer",
  "compound-engineering:ce-adversarial-reviewer",
] as const;

export type ConfirmationState = "pending" | "confirmed" | "stale" | "blocked";
export type ExecutionMode = "tdd" | "proof_first" | "change_first";

/**
 * The 10-field candidate batch contract.
 *
 * Matches `BATCH_KEYS` below: id, name, goal, files, depends_on, supersedes,
 * execution_mode, acceptance_tests, ac_mapping, rationale. This is the
 * "candidate execution contract" Stage 3 confirms; the 6 runtime lifecycle
 * fields (status, iterations, builder_commits, builder_attempts,
 * orchestrator_inline_attempts, final_verdict) are added by the ledger parser
 * in `lib/ledger.ts`.
 *
 * `orchestrator_inline_attempts` is the newest lifecycle field. This module
 * owns its key set (`ORCHESTRATOR_INLINE_ATTEMPT_KEYS`) and its membership in
 * `LEDGER_BATCH_KEYS`. Read this key set as the field shape only; its runtime
 * invariants (committed-only rows, parser/emitter handling, and how the
 * runbook-version skew gate protects legacy ledgers) are owned by
 * `references/ledger-and-helper.md` and enforced by `lib/ledger.ts` in the U5
 * helper-validation slice.
 *
 * `contractDigest` in `lib/digest.ts` hashes exactly these fields, which is
 * why a lifecycle-only ledger change does not change the digest (issue #51
 * AC3).
 */
export interface Batch {
  id: string;
  name: string;
  goal: string;
  files: string[];
  depends_on: string[];
  supersedes: string | null;
  execution_mode: ExecutionMode;
  acceptance_tests: string[];
  ac_mapping: number[];
  rationale: string | null;
}

export const EXECUTION_MODES = new Set<ExecutionMode>([
  "tdd",
  "proof_first",
  "change_first",
]);

export const CONFIRMATION_STATES = new Set<ConfirmationState>([
  "pending",
  "confirmed",
  "stale",
  "blocked",
]);

export const LEGACY_EXECUTION_MODE_HINTS = new Map([
  ["verification_first", "proof_first"],
  ["direct", "change_first"],
]);

export const CANDIDATE_BATCH_FIELDS = [
  "id",
  "name",
  "goal",
  "files",
  "depends_on",
  "supersedes",
  "execution_mode",
  "acceptance_tests",
  "ac_mapping",
  "rationale",
] as const;

export const LEDGER_BATCH_LIFECYCLE_FIELDS = [
  "status",
  "builder_commits",
  "builder_attempts",
  "orchestrator_inline_attempts",
  "iterations",
  "final_verdict",
] as const;
export type LedgerBatchLifecycleField =
  (typeof LEDGER_BATCH_LIFECYCLE_FIELDS)[number];

export const LEDGER_BATCH_LIFECYCLE_DEFAULTS = {
  status: "pending",
  builder_commits: [],
  builder_attempts: [],
  orchestrator_inline_attempts: [],
  iterations: 0,
  final_verdict: null,
} as const satisfies Record<
  LedgerBatchLifecycleField,
  string | number | null | readonly unknown[]
>;

export const BATCH_KEYS = new Set<string>(CANDIDATE_BATCH_FIELDS);

export const LEDGER_BATCH_KEYS = new Set<string>([
  ...CANDIDATE_BATCH_FIELDS,
  ...LEDGER_BATCH_LIFECYCLE_FIELDS,
]);

export const BUILDER_ATTEMPT_FIELDS = [
  "attempt_type",
  "status",
  "commit_sha",
  "files_touched",
  "route_hint",
  "blockers",
  "probe_results",
  "notes",
] as const;

export const BUILDER_ATTEMPT_KEYS = new Set<string>(
  BUILDER_ATTEMPT_FIELDS,
);

export const BUILDER_RETURN_FIELDS = [
  "attempt_type",
  "target_finding_signature",
  "status",
  "commit_sha",
  "files_touched",
  "route_hint",
  "blockers",
  "probe_results",
  "suggested_scope_changes",
  "implementation_steps",
  "existing_seams_used",
  "tests_run",
  "assumptions",
  "risks",
  "deferred",
  "suggested_validator_focus",
  "notes",
] as const;

export const BUILDER_RETURN_KEYS = new Set<string>(BUILDER_RETURN_FIELDS);

export const BUILDER_VALIDATOR_EVIDENCE_FIELDS = [
  "implementation_steps",
  "existing_seams_used",
  "tests_run",
  "assumptions",
  "risks",
  "deferred",
  "suggested_validator_focus",
] as const;

export const BUILDER_VALIDATOR_EVIDENCE_KEYS = new Set<string>(
  BUILDER_VALIDATOR_EVIDENCE_FIELDS,
);

export const VALIDATOR_INLINE_EVIDENCE_FIELDS = [
  "implementation_commit",
  "touched_files",
  "inline_validity_note",
  "user_confirmed_exception_note",
] as const;

export const VALIDATOR_INLINE_EVIDENCE_KEYS = new Set<string>(
  VALIDATOR_INLINE_EVIDENCE_FIELDS,
);

export const ORCHESTRATOR_INLINE_ATTEMPT_FIELDS = [
  "commit_sha",
  "files_touched",
  "notes",
] as const;

export const ORCHESTRATOR_INLINE_ATTEMPT_KEYS = new Set<string>(
  ORCHESTRATOR_INLINE_ATTEMPT_FIELDS,
);

export const ATTEMPT_LANE_VALUES = [
  "builder_attempts",
  "orchestrator_inline_attempts",
] as const;
export type AttemptLane = (typeof ATTEMPT_LANE_VALUES)[number];
export const ATTEMPT_LANES = new Set<string>(ATTEMPT_LANE_VALUES);

export const BUILDER_ATTEMPT_TYPE_VALUES = [
  "implementation",
  "repair",
] as const;

export const BUILDER_ATTEMPT_TYPES = new Set<string>(
  BUILDER_ATTEMPT_TYPE_VALUES,
);

export const BUILDER_ATTEMPT_STATUSES = new Set([
  "committed",
  "fail-stop-preflight",
  "fail-stop-out-of-scope",
  "fail-stop-execution-mode-mismatch",
  "fail-stop-read-failed",
  "fail-stop-other",
]);

export const FAIL_STOP_ATTEMPT_STATUSES = new Set(
  [...BUILDER_ATTEMPT_STATUSES].filter((status) => status !== "committed"),
);

export const MAX_BUILDER_ATTEMPTS = 5;

export const STAGE_3_BATCH_ID = "stage-3";

export const FINDING_FIELDS = [
  "id",
  "batch_id",
  "signature",
  "persona",
  "severity",
  "status",
  "summary",
  "resolution",
] as const;

export const FINDING_KEYS = new Set<string>(FINDING_FIELDS);

export const FINDING_SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);

export const FINDING_STATUSES = new Set([
  "open",
  "fixed",
  "accepted-risk",
  "deferred-P2",
  "deferred-P3",
  "out-of-scope-for-this-issue",
  "superseded",
]);

export const BATCH_STATUSES = new Set([
  "pending",
  "in-progress",
  "converged",
  "accepted-risk",
  "blocked",
]);

export const FINAL_VERDICTS = new Set([
  "converged",
  "accepted-risk",
  "blocked-for-user",
]);

export const TERMINAL_BATCH_STATUSES = new Set(["converged", "accepted-risk"]);

/**
 * Contract slice ids ledger docs/templates must point at for field sets and
 * finite enum membership.
 */
export const LEDGER_SCHEMA_POINTER_SLICES = [
  "candidate_batch_fields",
  "ledger_batch_lifecycle_fields",
  "builder_attempt_fields",
  "orchestrator_inline_attempt_fields",
  "finding_fields",
  "builder_attempt_types",
  "execution_modes",
  "batch_statuses",
  "builder_attempt_statuses",
  "finding_severities",
  "finding_statuses",
  "final_verdicts",
  "confirmation_states",
] as const;

export const CHANGE_FIRST_EXCEPTION_PREFIX = "change_first-exception:";
export const HIGH_RISK_CHANGE_FIRST_EXCEPTION_PREFIX =
  "high-risk-change_first-exception:";
export const NEW_FILE_PATCH_EXCEPTION_PREFIX = "new-file-patch-exception:";
export const HIGH_RISK_NEW_FILE_PATCH_EXCEPTION_PREFIX =
  "high-risk-new-file-patch-exception:";
export const INVESTIGATION_RATIONALE = "out-of-scope: investigation-required";

export const EXTENSIONLESS_FILE_NAMES = new Set([
  "changelog",
  "code_of_conduct",
  "contributing",
  "dockerfile",
  "gemfile",
  "justfile",
  "license",
  "makefile",
  "procfile",
  "rakefile",
  "readme",
]);
