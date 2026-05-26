import { describe, expect, test } from "bun:test";

import {
  BATCH_KEYS,
  BATCH_STATUSES,
  BUILDER_ATTEMPT_FIELDS,
  BUILDER_ATTEMPT_KEYS,
  BUILDER_ATTEMPT_STATUSES,
  BUILDER_ATTEMPT_TYPE_VALUES,
  BUILDER_ATTEMPT_TYPES,
  BUILDER_RETURN_FIELDS,
  BUILDER_RETURN_KEYS,
  BUILDER_VALIDATOR_EVIDENCE_FIELDS,
  BUILDER_VALIDATOR_EVIDENCE_KEYS,
  CANDIDATE_BATCH_FIELDS,
  CHANGE_FIRST_EXCEPTION_PREFIX,
  CONFIRMATION_STATES,
  EXECUTION_MODES,
  EXTENSIONLESS_FILE_NAMES,
  FAIL_STOP_ATTEMPT_STATUSES,
  FINAL_VERDICTS,
  FINDING_FIELDS,
  FINDING_KEYS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  HIGH_RISK_CHANGE_FIRST_EXCEPTION_PREFIX,
  HIGH_RISK_NEW_FILE_PATCH_EXCEPTION_PREFIX,
  INVESTIGATION_RATIONALE,
  LEDGER_BATCH_KEYS,
  LEDGER_BATCH_LIFECYCLE_FIELDS,
  LEGACY_EXECUTION_MODE_HINTS,
  MAX_BUILDER_ATTEMPTS,
  NEW_FILE_PATCH_EXCEPTION_PREFIX,
  ORCHESTRATOR_INLINE_ATTEMPT_FIELDS,
  ORCHESTRATOR_INLINE_ATTEMPT_KEYS,
  RUNBOOK_VERSION,
  STAGE_3_BATCH_ID,
  TERMINAL_BATCH_STATUSES,
  VALIDATOR_INLINE_EVIDENCE_FIELDS,
  VALIDATOR_INLINE_EVIDENCE_KEYS,
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
  test("CANDIDATE_BATCH_FIELDS enumerates the 10 candidate-batch fields in authoring order", () => {
    expect(CANDIDATE_BATCH_FIELDS).toEqual([
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
  });

  test("BATCH_KEYS is the membership Set for CANDIDATE_BATCH_FIELDS", () => {
    expect(BATCH_KEYS).toBeInstanceOf(Set);
    expect(BATCH_KEYS).toEqual(new Set(CANDIDATE_BATCH_FIELDS));
  });

  test("LEDGER_BATCH_LIFECYCLE_FIELDS enumerates the 6 runtime lifecycle fields in runtime order", () => {
    expect(LEDGER_BATCH_LIFECYCLE_FIELDS).toEqual([
      "status",
      "builder_commits",
      "builder_attempts",
      "orchestrator_inline_attempts",
      "iterations",
      "final_verdict",
    ]);
  });

  test("LEDGER_BATCH_KEYS extends BATCH_KEYS with the lifecycle fields", () => {
    const lifecycleOnly = [...LEDGER_BATCH_KEYS].filter(
      (key) => !BATCH_KEYS.has(key),
    );
    expect(lifecycleOnly).toEqual([...LEDGER_BATCH_LIFECYCLE_FIELDS]);
    expect(LEDGER_BATCH_KEYS).toEqual(
      new Set([...CANDIDATE_BATCH_FIELDS, ...LEDGER_BATCH_LIFECYCLE_FIELDS]),
    );
    expect(LEDGER_BATCH_KEYS.size).toBe(
      CANDIDATE_BATCH_FIELDS.length + LEDGER_BATCH_LIFECYCLE_FIELDS.length,
    );
  });
});

describe("contract: builder attempt fields", () => {
  test("BUILDER_ATTEMPT_FIELDS enumerates the 8 compact-record fields in authoring order", () => {
    expect(BUILDER_ATTEMPT_FIELDS).toEqual([
      "attempt_type",
      "status",
      "commit_sha",
      "files_touched",
      "route_hint",
      "blockers",
      "probe_results",
      "notes",
    ]);
  });

  test("BUILDER_ATTEMPT_KEYS is the membership Set for BUILDER_ATTEMPT_FIELDS", () => {
    expect(BUILDER_ATTEMPT_KEYS).toBeInstanceOf(Set);
    expect(BUILDER_ATTEMPT_KEYS).toEqual(new Set(BUILDER_ATTEMPT_FIELDS));
  });

  test("BUILDER_ATTEMPT_TYPE_VALUES contains implementation and repair in catalog order", () => {
    expect(BUILDER_ATTEMPT_TYPE_VALUES).toEqual(["implementation", "repair"]);
  });

  test("BUILDER_ATTEMPT_TYPES is the membership Set for BUILDER_ATTEMPT_TYPE_VALUES", () => {
    expect(BUILDER_ATTEMPT_TYPES).toBeInstanceOf(Set);
    expect(BUILDER_ATTEMPT_TYPES).toEqual(
      new Set(BUILDER_ATTEMPT_TYPE_VALUES),
    );
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

describe("contract: builder return fields", () => {
  test("BUILDER_RETURN_FIELDS enumerates the full transient envelope in render order", () => {
    expect(BUILDER_RETURN_FIELDS).toEqual([
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
    ]);
  });

  test("BUILDER_RETURN_KEYS is the membership Set for BUILDER_RETURN_FIELDS", () => {
    expect(BUILDER_RETURN_KEYS).toBeInstanceOf(Set);
    expect(BUILDER_RETURN_KEYS).toEqual(new Set(BUILDER_RETURN_FIELDS));
  });

  test("BUILDER_VALIDATOR_EVIDENCE_FIELDS names the rich Builder evidence lane only", () => {
    expect(BUILDER_VALIDATOR_EVIDENCE_FIELDS).toEqual([
      "implementation_steps",
      "existing_seams_used",
      "tests_run",
      "assumptions",
      "risks",
      "deferred",
      "suggested_validator_focus",
    ]);
    for (const field of BUILDER_VALIDATOR_EVIDENCE_FIELDS) {
      expect(BUILDER_RETURN_KEYS.has(field)).toBe(true);
    }
  });

  test("BUILDER_VALIDATOR_EVIDENCE_KEYS excludes compact persistence and inline lanes", () => {
    expect(BUILDER_VALIDATOR_EVIDENCE_KEYS).toBeInstanceOf(Set);
    expect(BUILDER_VALIDATOR_EVIDENCE_KEYS).toEqual(
      new Set(BUILDER_VALIDATOR_EVIDENCE_FIELDS),
    );
    for (const forbidden of [
      "notes",
      "suggested_scope_changes",
      "builder_commits",
      "orchestrator_inline_attempts",
      ...ORCHESTRATOR_INLINE_ATTEMPT_FIELDS,
      ...VALIDATOR_INLINE_EVIDENCE_FIELDS,
    ]) {
      expect(BUILDER_VALIDATOR_EVIDENCE_KEYS.has(forbidden)).toBe(false);
    }
  });
});

describe("contract: Validator inline evidence fields", () => {
  test("VALIDATOR_INLINE_EVIDENCE_FIELDS names the Orchestrator-inline evidence lane only", () => {
    expect(VALIDATOR_INLINE_EVIDENCE_FIELDS).toEqual([
      "implementation_commit",
      "touched_files",
      "inline_validity_note",
      "user_confirmed_exception_note",
    ]);
  });

  test("VALIDATOR_INLINE_EVIDENCE_KEYS excludes Builder evidence fields", () => {
    expect(VALIDATOR_INLINE_EVIDENCE_KEYS).toBeInstanceOf(Set);
    expect(VALIDATOR_INLINE_EVIDENCE_KEYS).toEqual(
      new Set(VALIDATOR_INLINE_EVIDENCE_FIELDS),
    );
    for (const forbidden of [
      "builder_evidence",
      ...BUILDER_VALIDATOR_EVIDENCE_FIELDS,
      "attempt_type",
      "status",
      "notes",
      "suggested_scope_changes",
    ]) {
      expect(VALIDATOR_INLINE_EVIDENCE_KEYS.has(forbidden)).toBe(false);
    }
  });
});

describe("contract: orchestrator inline attempt fields", () => {
  test("ORCHESTRATOR_INLINE_ATTEMPT_FIELDS enumerates the 3 compact-record fields in authoring order", () => {
    expect(ORCHESTRATOR_INLINE_ATTEMPT_FIELDS).toEqual([
      "commit_sha",
      "files_touched",
      "notes",
    ]);
  });

  test("ORCHESTRATOR_INLINE_ATTEMPT_KEYS is the membership Set for ORCHESTRATOR_INLINE_ATTEMPT_FIELDS", () => {
    expect(ORCHESTRATOR_INLINE_ATTEMPT_KEYS).toBeInstanceOf(Set);
    expect(ORCHESTRATOR_INLINE_ATTEMPT_KEYS).toEqual(
      new Set(ORCHESTRATOR_INLINE_ATTEMPT_FIELDS),
    );
  });

  test("ORCHESTRATOR_INLINE_ATTEMPT_KEYS excludes every Builder-only field", () => {
    // Derive the exclusion list from BUILDER_ATTEMPT_KEYS rather than
    // hardcoding it, so the guard tracks the real Builder contract: if a new
    // Builder-only field is ever added and accidentally allowed into the inline
    // set, this test fails. The three compact fields are the intentional
    // overlap between the two lanes.
    const sharedCompactFields = new Set<string>([
      "commit_sha",
      "files_touched",
      "notes",
    ]);
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
  test("FINDING_FIELDS enumerates the 8 ledger-ready finding fields in authoring order", () => {
    expect(FINDING_FIELDS).toEqual([
      "id",
      "batch_id",
      "signature",
      "persona",
      "severity",
      "status",
      "summary",
      "resolution",
    ]);
  });

  test("FINDING_KEYS is the membership Set for FINDING_FIELDS", () => {
    expect(FINDING_KEYS).toBeInstanceOf(Set);
    expect(FINDING_KEYS).toEqual(new Set(FINDING_FIELDS));
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
