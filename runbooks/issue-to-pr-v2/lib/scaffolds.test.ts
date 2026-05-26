import { describe, expect, test } from "bun:test";

import {
  CANDIDATE_BATCH_FIELDS,
  EXECUTION_MODES,
  INVESTIGATION_RATIONALE,
} from "./contract";
import {
  SCAFFOLD_IDS,
  ScaffoldRenderError,
  getScaffoldCatalog,
  renderScaffold,
} from "./scaffolds";

describe("scaffolds: tracer catalog", () => {
  test("catalog exposes only the ce-plan tracer scaffold for issue 114", () => {
    expect(SCAFFOLD_IDS).toEqual(["ce-plan-candidate-batch"]);
    expect(getScaffoldCatalog().map((entry) => entry.scaffold_id)).toEqual([
      "ce-plan-candidate-batch",
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

describe("scaffolds: ce-plan candidate batch", () => {
  test("renders the candidate batch projection in runtime field order", () => {
    const body = renderScaffold("ce-plan-candidate-batch").body;
    const firstIndexByField = new Map<string, number>();

    for (const field of CANDIDATE_BATCH_FIELDS) {
      const index = body.indexOf(`${field}:`);
      if (index !== -1) firstIndexByField.set(field, index);
    }

    expect([...firstIndexByField.keys()]).toEqual([
      "id",
      "name",
      "goal",
      "files",
      "depends_on",
      "execution_mode",
      "acceptance_tests",
      "ac_mapping",
      "rationale",
    ]);
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
