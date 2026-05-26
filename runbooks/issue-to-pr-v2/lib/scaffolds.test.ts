import { describe, expect, test } from "bun:test";

import {
  ALWAYS_ON_VALIDATOR_PERSONAS,
  ATTEMPT_LANE_VALUES,
  BUILDER_ATTEMPT_FIELDS,
  BUILDER_RETURN_FIELDS,
  BUILDER_VALIDATOR_EVIDENCE_FIELDS,
  CANDIDATE_BATCH_FIELDS,
  EXECUTION_MODES,
  FINDING_FIELDS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  INVESTIGATION_RATIONALE,
  LEDGER_BATCH_LIFECYCLE_DEFAULTS,
  LEDGER_BATCH_LIFECYCLE_FIELDS,
  NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_MARKER,
  NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_MARKER,
  NOTES_VALIDATOR_WAVE_COMPLETED_MARKER,
  RUNBOOK_VERSION,
  VALIDATOR_INLINE_EVIDENCE_FIELDS,
  VALIDATOR_WAVE_OUTCOMES,
} from "./contract";
import {
  SCAFFOLD_IDS,
  type ScaffoldId,
  ScaffoldRenderError,
  getScaffoldCatalog,
  renderScaffold,
} from "./scaffolds";

const EXPECTED_SCAFFOLD_IDS = [
  "ce-plan-candidate-batch",
  "replacement-candidate-batch",
  "patch-proposal-candidate-batch",
  "builder-return-envelope",
  "builder-attempt-compact",
  "validator-builder-evidence",
  "validator-inline-evidence",
  "ledger-empty-batches",
  "ledger-empty-findings-data",
  "ledger-batch-lifecycle-defaults",
  "ledger-finding-row",
  "notes-implementation-attempt-checkpoint",
  "notes-validator-wave-completed",
  "notes-runbook-version-skew-continuation",
  "workflow-learnings-empty",
] as const satisfies readonly ScaffoldId[];

describe("scaffolds: tracer catalog", () => {
  test("catalog exposes the ce-plan tracer plus Builder projection scaffolds", () => {
    expect(SCAFFOLD_IDS).toEqual(EXPECTED_SCAFFOLD_IDS);
    expect(getScaffoldCatalog().map((entry) => entry.scaffold_id)).toEqual([
      ...EXPECTED_SCAFFOLD_IDS,
    ]);
  });

  test("catalog entries carry source, output kind, and ordering metadata", () => {
    const entry = getScaffoldCatalog()[0];
    expect(entry.scaffold_id).toBe("ce-plan-candidate-batch");
    expect(entry.output_kind).toBe("yaml");
    expect(entry.ordering).toBe("catalog");
    expect(entry.source).toContain("lib/scaffolds.ts");
  });
});

describe("scaffolds: ledger and Notes evidence", () => {
  test("empty ledger section scaffolds render complete empty YAML sections", () => {
    expect(renderScaffold("ledger-empty-batches").body).toBe("batches: []\n");
    expect(renderScaffold("ledger-empty-findings-data").body).toBe(
      "findings: []\n",
    );
    expect(renderScaffold("workflow-learnings-empty").body).toBe(
      "workflow_learnings: []\n",
    );
  });

  test("lifecycle-default scaffold renders shared defaults in lifecycle order", () => {
    const body = renderScaffold("ledger-batch-lifecycle-defaults").body;
    expect(topLevelFieldOrder(body)).toEqual([
      ...LEDGER_BATCH_LIFECYCLE_FIELDS,
    ]);
    for (const field of LEDGER_BATCH_LIFECYCLE_FIELDS) {
      const value = LEDGER_BATCH_LIFECYCLE_DEFAULTS[field];
      const expected = Array.isArray(value)
        ? "[]"
        : value === null
          ? "null"
          : String(value);
      expect(body).toContain(`${field}: ${expected}`);
    }
  });

  test("finding-row scaffold renders every finding field once in runtime order", () => {
    const body = renderScaffold("ledger-finding-row").body;
    expect(topLevelFieldOrder(body)).toEqual([...FINDING_FIELDS]);
    expect(body).toContain(`severity: P2  # ${[...FINDING_SEVERITIES].join(" | ")}`);
    expect(body).toContain(`status: open  # ${[...FINDING_STATUSES].join(" | ")}`);
  });

  test("Notes evidence scaffolds expose parser-required markers and YAML bodies", () => {
    expect(renderScaffold("notes-implementation-attempt-checkpoint")).toMatchObject({
      marker: NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_MARKER,
    });
    expect(renderScaffold("notes-validator-wave-completed")).toMatchObject({
      marker: NOTES_VALIDATOR_WAVE_COMPLETED_MARKER,
    });
    expect(renderScaffold("notes-runbook-version-skew-continuation")).toMatchObject({
      marker: NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_MARKER,
    });

    const checkpointBody = renderScaffold(
      "notes-implementation-attempt-checkpoint",
    ).body;
    expect(checkpointBody).toContain("implementation_attempt_checkpoint:");
    expect(checkpointBody).toContain(
      `attempt_lane: "<${ATTEMPT_LANE_VALUES.join(" | ")}>"`,
    );

    const waveBody = renderScaffold("notes-validator-wave-completed").body;
    expect(waveBody).toContain("validator_wave_completed:");
    for (const persona of ALWAYS_ON_VALIDATOR_PERSONAS) {
      expect(waveBody).toContain(`- "${persona}"`);
    }
    expect(waveBody).toContain(
      `outcome: "<${VALIDATOR_WAVE_OUTCOMES.join(" | ")}>"`,
    );

    const skewBody = renderScaffold(
      "notes-runbook-version-skew-continuation",
    ).body;
    expect(skewBody).toContain("runbook_version_skew_continuation:");
    expect(skewBody).toContain(`runtime_version: "${RUNBOOK_VERSION}"`);
  });

  test("marker-aware scaffolds do not include ledger headings or prose", () => {
    for (const id of [
      "notes-implementation-attempt-checkpoint",
      "notes-validator-wave-completed",
      "notes-runbook-version-skew-continuation",
    ] as const) {
      const body = renderScaffold(id).body;
      expect(body).not.toContain("## Notes");
      expect(body).not.toContain("<!--");
      expect(body).not.toContain("```");
    }
  });

  test("YAML-only scaffolds omit marker metadata", () => {
    for (const id of SCAFFOLD_IDS.filter(
      (candidate) => !candidate.startsWith("notes-"),
    )) {
      expect(renderScaffold(id).marker).toBeUndefined();
    }
  });
});

function topLevelFieldOrder(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*):/)?.[1])
    .filter((field): field is string => field !== undefined);
}

function nestedFieldOrder(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/)?.[1])
    .filter((field): field is string => field !== undefined);
}

function patchBatchFieldOrder(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.match(/^  - ([A-Za-z_][A-Za-z0-9_]*):|^ {4}([A-Za-z_][A-Za-z0-9_]*):/)?.slice(1).find(Boolean))
    .filter((field): field is string => field !== undefined);
}

function scalarValue(body: string, field: string): string | null {
  const line = body.split("\n").find((item) => item.startsWith(`${field}:`));
  if (!line) return null;
  return line.slice(field.length + 1).split("#")[0]?.trim() ?? null;
}

describe("scaffolds: ce-plan candidate batch", () => {
  test("renders the candidate batch projection in runtime field order", () => {
    const body = renderScaffold("ce-plan-candidate-batch").body;
    const firstIndexByField = new Map<string, number>();

    for (const field of CANDIDATE_BATCH_FIELDS) {
      const index = body.indexOf(`${field}:`);
      if (index !== -1) firstIndexByField.set(field, index);
    }

    expect([...firstIndexByField.keys()]).toEqual(
      CANDIDATE_BATCH_FIELDS.filter((field) => field !== "supersedes"),
    );
    expect(firstIndexByField.has("supersedes")).toBe(false);

    const orderedIndexes = [...firstIndexByField.values()];
    expect(orderedIndexes).toEqual([...orderedIndexes].sort((a, b) => a - b));
  });

  test("renders execution modes and investigation rationale from runtime facts", () => {
    const body = renderScaffold("ce-plan-candidate-batch").body;
    expect(body).toContain(`execution_mode: tdd  # ${[...EXECUTION_MODES].join(" | ")}`);
    expect(body).toContain(INVESTIGATION_RATIONALE);
  });

  test("does not leak issue-specific data or mutation wording", () => {
    const body = renderScaffold("ce-plan-candidate-batch").body;
    expect(body).not.toContain("issue_number");
    expect(body).not.toContain("target_repo");
    expect(body).not.toContain("ledger");
    expect(body).not.toContain("commit");
    expect(body).not.toContain("/Users/");
  });

  test("throws a typed error for unknown scaffold ids", () => {
    expect(() =>
      renderScaffold("not-a-scaffold" as Parameters<typeof renderScaffold>[0]),
    ).toThrow(ScaffoldRenderError);
    try {
      renderScaffold("not-a-scaffold" as Parameters<typeof renderScaffold>[0]);
    } catch (error) {
      expect(error).toBeInstanceOf(ScaffoldRenderError);
      expect((error as ScaffoldRenderError).code).toBe("unknown-scaffold-id");
    }
  });
});

describe("scaffolds: candidate-batch projections", () => {
  test("replacement projection renders every base candidate field including supersedes", () => {
    const body = renderScaffold("replacement-candidate-batch").body;
    expect(topLevelFieldOrder(body)).toEqual([...CANDIDATE_BATCH_FIELDS]);
    expect(body).toContain("supersedes: <blocked-batch-id>");
    expect(body).toContain('rationale: "replacement-contract: <reason>"');
    expect(body).toContain(`execution_mode: tdd  # ${[...EXECUTION_MODES].join(" | ")}`);
  });

  test("patch proposal projection renders exactly one patch batch with ac_mapping empty", () => {
    const body = renderScaffold("patch-proposal-candidate-batch").body;
    expect(topLevelFieldOrder(body)).toEqual(["patch_batches"]);
    expect(patchBatchFieldOrder(body)).toEqual(
      CANDIDATE_BATCH_FIELDS.filter((field) => field !== "supersedes"),
    );
    expect(body).toContain("  - id: patch-<NNN>");
    expect(body).toContain("    ac_mapping: []");
    expect(body).not.toContain("supersedes:");
    expect(body).not.toContain("ac_mapping:\n      -");
  });

  test("patch proposal projection derives finite placeholders from runtime facts", () => {
    const body = renderScaffold("patch-proposal-candidate-batch").body;
    expect(body).toContain(`execution_mode: tdd  # ${[...EXECUTION_MODES].join(" | ")}`);
    expect(body).toContain("new-file-patch-exception:");
    expect(body).toContain("high-risk-new-file-patch-exception:");
    expect(body).toContain("change_first-exception:");
    expect(body).toContain("high-risk-change_first-exception:");
  });

  test("candidate projections preserve their surface boundaries", () => {
    expect(renderScaffold("ce-plan-candidate-batch").body).not.toContain(
      "patch_batches:",
    );
    expect(renderScaffold("replacement-candidate-batch").body).not.toContain(
      "patch_batches:",
    );
    expect(renderScaffold("patch-proposal-candidate-batch").body).not.toContain(
      "builder_evidence",
    );
  });
});

describe("scaffolds: Builder return projections", () => {
  test("full Builder return projection renders the runtime field source in order", () => {
    const body = renderScaffold("builder-return-envelope").body;
    expect(topLevelFieldOrder(body)).toEqual([...BUILDER_RETURN_FIELDS]);
    expect(body).toContain("suggested_validator_focus: []");
    expect(scalarValue(body, "commit_sha")).not.toBe("null");
    expect(scalarValue(body, "notes")).not.toBe('""');
    expect(body).not.toContain("orchestrator_inline_attempts");
    expect(body).not.toContain("builder_commits");
  });

  test("compact persisted Builder attempt projection reuses BUILDER_ATTEMPT_FIELDS", () => {
    const body = renderScaffold("builder-attempt-compact").body;
    expect(topLevelFieldOrder(body)).toEqual([...BUILDER_ATTEMPT_FIELDS]);
    expect(body).toContain("files_touched: []");
    expect(scalarValue(body, "commit_sha")).not.toBe("null");
    expect(scalarValue(body, "notes")).not.toBe('""');
    expect(body).not.toContain("implementation_steps");
    expect(body).not.toContain("target_finding_signature");
  });

  test("committed Builder attempt scaffold uses non-empty scalar placeholders", () => {
    const body = renderScaffold("builder-attempt-compact").body;
    expect(scalarValue(body, "status")?.split(/\s+/)[0]).toBe("committed");
    expect(scalarValue(body, "commit_sha")).toBe('"<commit-sha>"');
    expect(scalarValue(body, "notes")).toBe('"<attempt summary>"');
  });

  test("Validator Builder-evidence projection contains only the rich evidence lane", () => {
    const body = renderScaffold("validator-builder-evidence").body;
    expect(topLevelFieldOrder(body)).toEqual(["builder_evidence"]);
    expect(nestedFieldOrder(body)).toEqual([
      ...BUILDER_VALIDATOR_EVIDENCE_FIELDS,
    ]);
    expect(body).toContain("  suggested_validator_focus: []");
    expect(body).not.toContain("notes");
    expect(body).not.toContain("suggested_scope_changes");
    expect(body).not.toContain("orchestrator_inline");
  });

  test("Validator inline-evidence projection contains only the inline lane", () => {
    const body = renderScaffold("validator-inline-evidence").body;
    expect(topLevelFieldOrder(body)).toEqual(["inline_evidence"]);
    expect(nestedFieldOrder(body)).toEqual([
      ...VALIDATOR_INLINE_EVIDENCE_FIELDS,
    ]);
    expect(body).toContain('  implementation_commit: "<commit-sha>"');
    expect(body).toContain("  touched_files: []");
    expect(body).toContain(
      '  inline_validity_note: "<why inline eligibility still held>"',
    );
    expect(body).toContain("  user_confirmed_exception_note: null");
    for (const forbidden of [
      "builder_evidence",
      "implementation_steps",
      "existing_seams_used",
      "tests_run",
      "assumptions",
      "risks",
      "deferred",
      "suggested_validator_focus",
      "notes",
      "suggested_scope_changes",
      "attempt_type",
      "status",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  test("Validator Builder-evidence projection contains no inline evidence fields", () => {
    const body = renderScaffold("validator-builder-evidence").body;
    expect(body).not.toContain("inline_evidence");
    for (const forbidden of VALIDATOR_INLINE_EVIDENCE_FIELDS) {
      expect(body).not.toContain(forbidden);
    }
  });
});
