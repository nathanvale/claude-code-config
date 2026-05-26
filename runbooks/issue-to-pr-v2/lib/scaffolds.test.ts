import { describe, expect, test } from "bun:test";

import {
  BUILDER_ATTEMPT_FIELDS,
  BUILDER_RETURN_FIELDS,
  BUILDER_VALIDATOR_EVIDENCE_FIELDS,
  CANDIDATE_BATCH_FIELDS,
  EXECUTION_MODES,
  INVESTIGATION_RATIONALE,
  VALIDATOR_INLINE_EVIDENCE_FIELDS,
} from "./contract";
import {
  SCAFFOLD_IDS,
  ScaffoldRenderError,
  getScaffoldCatalog,
  renderScaffold,
} from "./scaffolds";

describe("scaffolds: tracer catalog", () => {
  test("catalog exposes the ce-plan tracer plus Builder projection scaffolds", () => {
    expect(SCAFFOLD_IDS).toEqual([
      "ce-plan-candidate-batch",
      "builder-return-envelope",
      "builder-attempt-compact",
      "validator-builder-evidence",
      "validator-inline-evidence",
    ]);
    expect(getScaffoldCatalog().map((entry) => entry.scaffold_id)).toEqual([
      "ce-plan-candidate-batch",
      "builder-return-envelope",
      "builder-attempt-compact",
      "validator-builder-evidence",
      "validator-inline-evidence",
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
