import { describe, expect, test } from "bun:test";

import {
  BATCH_KEYS,
  BATCH_STATUSES,
  BUILDER_ATTEMPT_KEYS,
  BUILDER_ATTEMPT_STATUSES,
  BUILDER_ATTEMPT_TYPES,
  CHANGE_FIRST_EXCEPTION_PREFIX,
  CONFIRMATION_STATES,
  EXECUTION_MODES,
  EXTENSIONLESS_FILE_NAMES,
  FAIL_STOP_ATTEMPT_STATUSES,
  FINAL_VERDICTS,
  FINDING_KEYS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  HIGH_RISK_CHANGE_FIRST_EXCEPTION_PREFIX,
  HIGH_RISK_NEW_FILE_PATCH_EXCEPTION_PREFIX,
  INVESTIGATION_RATIONALE,
  LEDGER_BATCH_KEYS,
  LEGACY_EXECUTION_MODE_HINTS,
  MAX_BUILDER_ATTEMPTS,
  NEW_FILE_PATCH_EXCEPTION_PREFIX,
  ORCHESTRATOR_INLINE_ATTEMPT_KEYS,
  RUNBOOK_VERSION,
  STAGE_3_BATCH_ID,
  TERMINAL_BATCH_STATUSES,
} from "./contract";

describe("contract: execution modes", () => {
  test("EXECUTION_MODES contains tdd, proof_first, change_first", () => {
    expect(EXECUTION_MODES).toEqual(
      new Set(["tdd", "proof_first", "change_first"]),
    );
  });

  test("LEGACY_EXECUTION_MODE_HINTS maps verification_first → proof_first, direct → change_first", () => {
    expect(LEGACY_EXECUTION_MODE_HINTS.get("verification_first")).toBe(
      "proof_first",
    );
    expect(LEGACY_EXECUTION_MODE_HINTS.get("direct")).toBe("change_first");
    expect(LEGACY_EXECUTION_MODE_HINTS.size).toBe(2);
  });
});

describe("contract: confirmation states", () => {
  test("CONFIRMATION_STATES contains pending, confirmed, stale, blocked", () => {
    expect(CONFIRMATION_STATES).toEqual(
      new Set(["pending", "confirmed", "stale", "blocked"]),
    );
  });
});

describe("contract: batch keys", () => {
  test("BATCH_KEYS enumerates the 10 candidate-batch fields", () => {
    expect(BATCH_KEYS).toEqual(
      new Set([
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
      ]),
    );
  });

  test("LEDGER_BATCH_KEYS extends BATCH_KEYS with the 6 runtime lifecycle fields", () => {
    const lifecycleOnly = [...LEDGER_BATCH_KEYS].filter(
      (key) => !BATCH_KEYS.has(key),
    );
    expect(new Set(lifecycleOnly)).toEqual(
      new Set([
        "status",
        "builder_commits",
        "builder_attempts",
        "orchestrator_inline_attempts",
        "iterations",
        "final_verdict",
      ]),
    );
    expect(LEDGER_BATCH_KEYS.size).toBe(BATCH_KEYS.size + 6);
  });
});

describe("contract: builder attempt fields", () => {
  test("BUILDER_ATTEMPT_KEYS enumerates the 8 compact-record fields", () => {
    expect(BUILDER_ATTEMPT_KEYS).toEqual(
      new Set([
        "attempt_type",
        "status",
        "commit_sha",
        "files_touched",
        "route_hint",
        "blockers",
        "probe_results",
        "notes",
      ]),
    );
  });

  test("BUILDER_ATTEMPT_TYPES contains implementation and repair only", () => {
    expect(BUILDER_ATTEMPT_TYPES).toEqual(new Set(["implementation", "repair"]));
  });

  test("BUILDER_ATTEMPT_STATUSES contains committed plus five fail-stop statuses", () => {
    expect(BUILDER_ATTEMPT_STATUSES).toEqual(
      new Set([
        "committed",
        "fail-stop-preflight",
        "fail-stop-out-of-scope",
        "fail-stop-execution-mode-mismatch",
        "fail-stop-read-failed",
        "fail-stop-other",
      ]),
    );
  });

  test("FAIL_STOP_ATTEMPT_STATUSES is BUILDER_ATTEMPT_STATUSES minus committed", () => {
    expect(FAIL_STOP_ATTEMPT_STATUSES.has("committed")).toBe(false);
    expect(FAIL_STOP_ATTEMPT_STATUSES.size).toBe(
      BUILDER_ATTEMPT_STATUSES.size - 1,
    );
    for (const status of FAIL_STOP_ATTEMPT_STATUSES) {
      expect(BUILDER_ATTEMPT_STATUSES.has(status)).toBe(true);
      expect(status).not.toBe("committed");
    }
  });

  test("MAX_BUILDER_ATTEMPTS is 5 (inner-loop iteration cap)", () => {
    expect(MAX_BUILDER_ATTEMPTS).toBe(5);
  });
});

describe("contract: orchestrator inline attempt fields", () => {
  test("ORCHESTRATOR_INLINE_ATTEMPT_KEYS enumerates the 3 compact-record fields", () => {
    expect(ORCHESTRATOR_INLINE_ATTEMPT_KEYS).toEqual(
      new Set(["commit_sha", "files_touched", "notes"]),
    );
  });

  test("ORCHESTRATOR_INLINE_ATTEMPT_KEYS excludes every Builder-only field", () => {
    // Derive the exclusion list from BUILDER_ATTEMPT_KEYS rather than
    // hardcoding it, so the guard tracks the real Builder contract: if a new
    // Builder-only field is ever added and accidentally allowed into the inline
    // set, this test fails. The three compact fields are the intentional
    // overlap between the two lanes.
    const sharedCompactFields = new Set(["commit_sha", "files_touched", "notes"]);
    const builderOnlyFields = [...BUILDER_ATTEMPT_KEYS].filter(
      (key) => !sharedCompactFields.has(key),
    );
    expect(builderOnlyFields.length).toBeGreaterThan(0);
    for (const builderOnlyKey of builderOnlyFields) {
      expect(ORCHESTRATOR_INLINE_ATTEMPT_KEYS.has(builderOnlyKey)).toBe(false);
    }
  });

  test("ORCHESTRATOR_INLINE_ATTEMPT_KEYS is exactly the shared compact subset of BUILDER_ATTEMPT_KEYS", () => {
    // The two lanes deliberately share only commit_sha, files_touched, notes.
    // Asserting the subset relationship catches a rename of a shared field in
    // BUILDER_ATTEMPT_KEYS that would silently desynchronize the lanes.
    for (const inlineKey of ORCHESTRATOR_INLINE_ATTEMPT_KEYS) {
      expect(BUILDER_ATTEMPT_KEYS.has(inlineKey)).toBe(true);
    }
  });
});

describe("contract: finding fields", () => {
  test("FINDING_KEYS enumerates the 8 ledger-ready finding fields", () => {
    expect(FINDING_KEYS).toEqual(
      new Set([
        "id",
        "batch_id",
        "signature",
        "persona",
        "severity",
        "status",
        "summary",
        "resolution",
      ]),
    );
  });

  test("FINDING_SEVERITIES contains P0, P1, P2, P3", () => {
    expect(FINDING_SEVERITIES).toEqual(new Set(["P0", "P1", "P2", "P3"]));
  });

  test("FINDING_STATUSES enumerates the 7 allowed finding statuses (excluding ADR-contradicts-* which is parameterized)", () => {
    expect(FINDING_STATUSES).toEqual(
      new Set([
        "open",
        "fixed",
        "accepted-risk",
        "deferred-P2",
        "deferred-P3",
        "out-of-scope-for-this-issue",
        "superseded",
      ]),
    );
  });

  test("STAGE_3_BATCH_ID is the literal 'stage-3'", () => {
    expect(STAGE_3_BATCH_ID).toBe("stage-3");
  });
});

describe("contract: batch lifecycle", () => {
  test("BATCH_STATUSES contains pending, in-progress, converged, accepted-risk, blocked", () => {
    expect(BATCH_STATUSES).toEqual(
      new Set([
        "pending",
        "in-progress",
        "converged",
        "accepted-risk",
        "blocked",
      ]),
    );
  });

  test("FINAL_VERDICTS contains converged, accepted-risk, blocked-for-user", () => {
    expect(FINAL_VERDICTS).toEqual(
      new Set(["converged", "accepted-risk", "blocked-for-user"]),
    );
  });

  test("TERMINAL_BATCH_STATUSES is the dependency-success subset of BATCH_STATUSES", () => {
    expect(TERMINAL_BATCH_STATUSES).toEqual(
      new Set(["converged", "accepted-risk"]),
    );
    for (const status of TERMINAL_BATCH_STATUSES) {
      expect(BATCH_STATUSES.has(status)).toBe(true);
    }
  });
});

describe("contract: rationale prefixes", () => {
  test("execution-mode exception prefixes have a colon suffix and are non-empty", () => {
    expect(CHANGE_FIRST_EXCEPTION_PREFIX).toBe("change_first-exception:");
    expect(HIGH_RISK_CHANGE_FIRST_EXCEPTION_PREFIX).toBe(
      "high-risk-change_first-exception:",
    );
  });

  test("patch-file exception prefixes have a colon suffix and are non-empty", () => {
    expect(NEW_FILE_PATCH_EXCEPTION_PREFIX).toBe("new-file-patch-exception:");
    expect(HIGH_RISK_NEW_FILE_PATCH_EXCEPTION_PREFIX).toBe(
      "high-risk-new-file-patch-exception:",
    );
  });

  test("INVESTIGATION_RATIONALE is the literal 'out-of-scope: investigation-required'", () => {
    expect(INVESTIGATION_RATIONALE).toBe("out-of-scope: investigation-required");
  });
});

describe("contract: file-name special cases", () => {
  test("EXTENSIONLESS_FILE_NAMES contains the 11 standard top-level repo files", () => {
    expect(EXTENSIONLESS_FILE_NAMES).toEqual(
      new Set([
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
      ]),
    );
  });
});

describe("contract: U6 runbook version", () => {
  test("RUNBOOK_VERSION is the literal string '3'", () => {
    // The value is intentionally a plain string so future major versions
    // (4, 5...) stay comparable without semver tooling. A regression
    // bumping this silently is a workflow-contract change that requires
    // explicit operator continuation evidence per U6.
    expect(RUNBOOK_VERSION).toBe("3");
    expect(typeof RUNBOOK_VERSION).toBe("string");
  });
});
