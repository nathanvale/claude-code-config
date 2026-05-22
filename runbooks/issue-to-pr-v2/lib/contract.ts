/**
 * Runtime contract values for the Issue-to-PR v2 helper.
 *
 * Lifted from v1 `runbooks/issue-to-pr/decompose.ts` lines 99-181 (U3 slice S1).
 * These are the load-bearing string sets, key sets, prefix constants, and the
 * numeric `MAX_BUILDER_ATTEMPTS` cap that the rest of the helper validates
 * against. Keeping them in executable code (not just erased TypeScript types
 * or prose) is acceptance criterion AC2 of issue #51.
 *
 * No behavior changes: every value is byte-identical to v1.
 */

export type ConfirmationState = "pending" | "confirmed" | "stale" | "blocked";
export type ExecutionMode = "tdd" | "proof_first" | "change_first";

/**
 * The 10-field candidate batch contract.
 *
 * Matches `BATCH_KEYS` below: id, name, goal, files, depends_on, supersedes,
 * execution_mode, acceptance_tests, ac_mapping, rationale. This is the
 * "candidate execution contract" Stage 3 confirms; the 5 runtime lifecycle
 * fields (status, iterations, builder_commits, builder_attempts,
 * final_verdict) are added by the ledger parser in `lib/ledger.ts`.
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

export const BATCH_KEYS = new Set([
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
]);

export const LEDGER_BATCH_KEYS = new Set([
  ...BATCH_KEYS,
  "status",
  "builder_commits",
  "builder_attempts",
  "iterations",
  "final_verdict",
]);

export const BUILDER_ATTEMPT_KEYS = new Set([
  "attempt_type",
  "status",
  "commit_sha",
  "files_touched",
  "route_hint",
  "blockers",
  "probe_results",
  "notes",
]);

export const BUILDER_ATTEMPT_TYPES = new Set(["implementation", "repair"]);

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

export const FINDING_KEYS = new Set([
  "id",
  "batch_id",
  "signature",
  "persona",
  "severity",
  "status",
  "summary",
  "resolution",
]);

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
