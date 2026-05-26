import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RUNBOOK_VERSION } from "./contract";
import {
  DecomposeError,
  fail,
  parse,
  parseRunbookVersionContinuationEvidence,
  rawDiffHasContentBearingChange,
  readLedgerSnapshot,
  validateAcCoverage,
  validateFindingsData,
  validateLedgerBatches,
  validateWorkflowLearnings,
  withFailMode,
} from "./ledger";

/**
 * Module-level tests for `lib/ledger.ts` public surface (U3 AC5).
 *
 * The full process-boundary characterization suite at
 * `runbooks/issue-to-pr-v2/decompose.test.ts` already exercises every flag
 * end-to-end. These tests pin the in-process exports so a future refactor
 * that changes them surfaces a fast unit-level failure instead of routing
 * through the 8-second process-spawn suite.
 */

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    try {
      rmSync(dir, { force: true, recursive: true });
    } catch {
      // Best-effort cleanup.
    }
  }
});

function writePlan(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "u3-ledger-test-"));
  tempDirs.push(dir);
  const path = join(dir, "plan.md");
  writeFileSync(path, content);
  return path;
}

function writeLedger(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "u3-ledger-test-"));
  tempDirs.push(dir);
  const path = join(dir, "ledger.md");
  writeFileSync(path, content);
  return path;
}

describe("DecomposeError", () => {
  test("is a subclass of Error with name 'DecomposeError'", () => {
    const error = new DecomposeError("test");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DecomposeError");
    expect(error.message).toBe("test");
  });
});

describe("parse", () => {
  test("parses a single TDD batch into the canonical shape", () => {
    const planPath = writePlan(
      [
        "# Plan",
        "",
        "Implementation Unit:",
        "",
        "```yaml",
        "id: b1",
        "name: First batch",
        "goal: do the thing",
        "files:",
        "  - a.ts",
        "depends_on: []",
        "execution_mode: tdd",
        "acceptance_tests:",
        '  - "AC 1 holds: thing happens"',
        "ac_mapping:",
        "  - 1",
        "rationale: null",
        "```",
        "",
      ].join("\n"),
    );
    const batches = parse(planPath);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      id: "b1",
      name: "First batch",
      goal: "do the thing",
      files: ["a.ts"],
      depends_on: [],
      supersedes: null,
      execution_mode: "tdd",
      acceptance_tests: ["AC 1 holds: thing happens"],
      ac_mapping: [1],
      rationale: null,
    });
  });

  test("topologically sorts batches by depends_on (root before leaf)", () => {
    const planPath = writePlan(
      [
        "```yaml",
        "id: leaf",
        "name: Leaf",
        "goal: depends on root",
        "files:",
        "  - leaf.ts",
        "depends_on:",
        "  - root",
        "execution_mode: tdd",
        "acceptance_tests:",
        '  - "AC 2 holds: leaf works"',
        "ac_mapping:",
        "  - 2",
        "rationale: null",
        "```",
        "",
        "```yaml",
        "id: root",
        "name: Root",
        "goal: first",
        "files:",
        "  - root.ts",
        "depends_on: []",
        "execution_mode: tdd",
        "acceptance_tests:",
        '  - "AC 1 holds: root works"',
        "ac_mapping:",
        "  - 1",
        "rationale: null",
        "```",
        "",
      ].join("\n"),
    );
    const batches = parse(planPath);
    expect(batches.map((b) => b.id)).toEqual(["root", "leaf"]);
  });

  test("returns proof_first and change_first batches with the right execution_mode", () => {
    const planPath = writePlan(
      [
        "```yaml",
        "id: docs-batch",
        "name: Docs",
        "goal: docs only",
        "files:",
        "  - README.md",
        "depends_on: []",
        "execution_mode: change_first",
        "acceptance_tests:",
        '  - "AC 1 holds: docs updated"',
        "ac_mapping:",
        "  - 1",
        "rationale: null",
        "```",
        "",
        "```yaml",
        "id: rename-batch",
        "name: Rename",
        "goal: rename",
        "files:",
        "  - src/new.ts",
        "depends_on: []",
        "execution_mode: proof_first",
        "acceptance_tests:",
        '  - "AC 2 holds: rename complete"',
        "ac_mapping:",
        "  - 2",
        "rationale: null",
        "```",
        "",
      ].join("\n"),
    );
    const batches = parse(planPath);
    expect(batches).toHaveLength(2);
    expect(batches.find((b) => b.id === "docs-batch")?.execution_mode).toBe("change_first");
    expect(batches.find((b) => b.id === "rename-batch")?.execution_mode).toBe("proof_first");
  });
});

/**
 * U4 closes U3 finding F004: in-process behavioral tests for the validator
 * helpers, unblocked by the `withFailMode("throw", ...)` helper that lets
 * the CLI catch a `DecomposeError` instead of letting `fail()` call
 * `process.exit(1)`.
 *
 * The tests below cover the four exported validators that U3 left
 * char-suite-only:
 *
 * - `validateLedgerBatches`
 * - `validateFindingsData`
 * - `validateAcCoverage`
 * - `parse` (error branches; happy path is already above)
 */
describe("withFailMode", () => {
  test("runs the wrapped fn and returns its result in throw mode", () => {
    const result = withFailMode("throw", () => 42);
    expect(result).toBe(42);
  });

  test("makes fail() throw DecomposeError instead of calling process.exit", () => {
    let captured: unknown;
    try {
      withFailMode("throw", () => {
        fail("boom");
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(DecomposeError);
    expect((captured as DecomposeError).message).toBe("boom");
  });

  test("restores the previous failMode even when fn throws", () => {
    // Verify the default-mode behavior post-restore by inspecting whether
    // a follow-up withFailMode("exit", ...) preserves no global leak.
    expect(() => {
      withFailMode("throw", () => {
        fail("first");
      });
    }).toThrow(DecomposeError);
    // A second throw-mode call still throws (not exits). If failMode had
    // leaked to "throw" globally, a default fail() outside withFailMode
    // would still throw — but we cannot safely test that exit path
    // in-process. The behavioural proof is that nested throw-mode still
    // works.
    expect(() => {
      withFailMode("throw", () => {
        fail("second");
      });
    }).toThrow(DecomposeError);
  });
});

describe("parse error branches (in-process via withFailMode)", () => {
  test("fails on a plan with no fenced yaml blocks", () => {
    const planPath = writePlan("# Plan with no yaml\n");
    expect(() =>
      withFailMode("throw", () => parse(planPath)),
    ).toThrow(/no fenced yaml blocks/);
  });

  test("fails on a yaml block missing required execution_mode", () => {
    const planPath = writePlan(
      [
        "```yaml",
        "id: missing-mode",
        "name: Missing Mode",
        "goal: no execution_mode",
        "files:",
        "  - a.ts",
        "depends_on: []",
        "acceptance_tests:",
        '  - "AC 1 holds: thing happens"',
        "ac_mapping:",
        "  - 1",
        "rationale: null",
        "```",
        "",
      ].join("\n"),
    );
    expect(() =>
      withFailMode("throw", () => parse(planPath)),
    ).toThrow(/missing required field "execution_mode"/);
  });

  test("fails on duplicate batch ids", () => {
    const dupe = (id: string): string =>
      [
        "```yaml",
        `id: ${id}`,
        "name: Dupe",
        "goal: duplicate",
        "files:",
        "  - a.ts",
        "depends_on: []",
        "execution_mode: tdd",
        "acceptance_tests:",
        '  - "AC 1 holds: thing"',
        "ac_mapping:",
        "  - 1",
        "rationale: null",
        "```",
        "",
      ].join("\n");
    const planPath = writePlan(`${dupe("b1")}${dupe("b1")}`);
    expect(() =>
      withFailMode("throw", () => parse(planPath)),
    ).toThrow(/duplicate batch id "b1"/);
  });

  test("fails on cyclic depends_on graph", () => {
    const planPath = writePlan(
      [
        "```yaml",
        "id: a",
        "name: A",
        "goal: cycle",
        "files:",
        "  - a.ts",
        "depends_on:",
        "  - b",
        "execution_mode: tdd",
        "acceptance_tests:",
        '  - "AC 1 holds: thing"',
        "ac_mapping:",
        "  - 1",
        "rationale: null",
        "```",
        "",
        "```yaml",
        "id: b",
        "name: B",
        "goal: cycle",
        "files:",
        "  - b.ts",
        "depends_on:",
        "  - a",
        "execution_mode: tdd",
        "acceptance_tests:",
        '  - "AC 2 holds: thing"',
        "ac_mapping:",
        "  - 2",
        "rationale: null",
        "```",
        "",
      ].join("\n"),
    );
    expect(() =>
      withFailMode("throw", () => parse(planPath)),
    ).toThrow(/cyclic dependency/);
  });
});

describe("validateLedgerBatches (in-process via withFailMode)", () => {
  test("fails when the ledger has no fenced Batches block", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 1",
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
        "## Batches",
        "",
        "(no fenced block)",
        "",
      ].join("\n"),
    );
    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(/'## Batches' section has no fenced yaml block/);
  });

  test("fails when the ledger Batches block is empty", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 1",
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
        "## Batches",
        "",
        "```yaml",
        "batches: []",
        "```",
        "",
      ].join("\n"),
    );
    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(/has no confirmed batches/);
  });
});

describe("validateFindingsData (in-process via withFailMode)", () => {
  test("accepts a ledger with no batches and empty findings", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 1",
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
        "## Findings data",
        "",
        "```yaml",
        "findings: []",
        "```",
        "",
        "## Findings",
        "",
        "| id | batch_id | signature | persona | severity | status | summary | resolution |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "",
      ].join("\n"),
    );
    expect(() =>
      withFailMode("throw", () => validateFindingsData(ledgerPath)),
    ).not.toThrow();
  });

  test("fails when the findings data is mixed with findings: []", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 1",
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
        "## Findings data",
        "",
        "```yaml",
        "findings: []",
        "- id: f1",
        "    batch_id: final",
        "    signature: sig-1",
        "    persona: ce-correctness",
        "    severity: P0",
        "    status: open",
        '    summary: "bad"',
        "    resolution: null",
        "```",
        "",
      ].join("\n"),
    );
    expect(() =>
      withFailMode("throw", () => validateFindingsData(ledgerPath)),
    ).toThrow(/cannot mix findings: \[\] with finding rows/);
  });
});

describe("validateAcCoverage (in-process via withFailMode)", () => {
  test("fails when a batch references an AC index out of range", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 1",
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
      ].join("\n"),
    );
    const batches = [
      {
        id: "b1",
        name: "B1",
        goal: "out of range",
        files: ["a.ts"],
        depends_on: [],
        supersedes: null,
        execution_mode: "tdd" as const,
        acceptance_tests: ["AC 5 holds: thing"],
        ac_mapping: [5],
        rationale: null,
      },
    ];
    expect(() =>
      withFailMode("throw", () => validateAcCoverage(batches, ledgerPath)),
    ).toThrow(/batch b1 maps to AC 5/);
  });

  test("fails when a ledger AC index is uncovered", () => {
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 1",
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "- [ ] AC 2",
        "",
      ].join("\n"),
    );
    const batches = [
      {
        id: "b1",
        name: "B1",
        goal: "covers AC 1 only",
        files: ["a.ts"],
        depends_on: [],
        supersedes: null,
        execution_mode: "tdd" as const,
        acceptance_tests: ["AC 1 holds: thing"],
        ac_mapping: [1],
        rationale: null,
      },
    ];
    expect(() =>
      withFailMode("throw", () => validateAcCoverage(batches, ledgerPath)),
    ).toThrow(/AC coverage incomplete; missing AC indices: 2/);
  });
});

// ---------------- U6: runbook_version skew classifier ----------------

function writeLedgerWithFrontmatter(
  frontmatterLines: string[],
  bodyLines: string[] = [],
): string {
  return writeLedger(
    [
      "---",
      "issue_number: 1",
      ...frontmatterLines,
      "---",
      "",
      "# Issue 1",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] AC 1",
      "",
      ...bodyLines,
    ].join("\n"),
  );
}

describe("readLedgerSnapshot: U6 runbook_version", () => {
  test("returns runbook_version: null and runbook_version_skew: null for no-ledger", () => {
    const snapshot = readLedgerSnapshot("/tmp/does-not-exist-u6.md");
    expect(snapshot.ledger_exists).toBe(false);
    expect(snapshot.runbook_version).toBe(null);
    expect(snapshot.runbook_version_skew).toBe(null);
  });

  test("classifies matched skew when frontmatter runbook_version equals RUNBOOK_VERSION", () => {
    const ledgerPath = writeLedgerWithFrontmatter([
      `runbook_version: "${RUNBOOK_VERSION}"`,
    ]);
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    expect(snapshot.runbook_version).toBe(RUNBOOK_VERSION);
    expect(snapshot.runbook_version_skew).toBe("matched");
  });

  test("classifies missing skew when frontmatter has no runbook_version field", () => {
    const ledgerPath = writeLedgerWithFrontmatter([]);
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    expect(snapshot.runbook_version).toBe(null);
    expect(snapshot.runbook_version_skew).toBe("missing");
  });

  test("classifies missing skew when runbook_version is empty string", () => {
    const ledgerPath = writeLedgerWithFrontmatter([
      'runbook_version: ""',
    ]);
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    expect(snapshot.runbook_version).toBe(null);
    expect(snapshot.runbook_version_skew).toBe("missing");
  });

  test("classifies mismatched skew when runbook_version differs from RUNBOOK_VERSION", () => {
    const ledgerPath = writeLedgerWithFrontmatter([
      'runbook_version: "1"',
    ]);
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    expect(snapshot.runbook_version).toBe("1");
    expect(snapshot.runbook_version_skew).toBe("mismatched");
  });

  test("string comparison only — no semver / numeric coercion", () => {
    // Version strings must match exactly; no semver coercion is allowed.
    const ledgerPath = writeLedgerWithFrontmatter([
      'runbook_version: "2.0"',
    ]);
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    expect(snapshot.runbook_version).toBe("2.0");
    expect(snapshot.runbook_version_skew).toBe("mismatched");
  });
});

describe("readLedgerSnapshot: runbook_version_skew continuation evidence", () => {
  function completeEvidenceBlock(overrides: Partial<{
    ledger_version: string;
    runtime_version: string;
  }> = {}): string[] {
    const ledgerVersion = overrides.ledger_version ?? "null";
    const runtimeVersion = overrides.runtime_version ?? RUNBOOK_VERSION;
    return [
      "## Notes",
      "",
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      `  ledger_version: ${ledgerVersion === "null" ? "null" : `"${ledgerVersion}"`}`,
      `  runtime_version: "${runtimeVersion}"`,
      '  operator_decision: "Nathan @ 2026-05-22T19:00"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "v1 ledger resumed; v2 changes are additive"',
      "```",
      "",
    ];
  }

  test("missing skew with complete evidence → continuation-evidence-present", () => {
    const ledgerPath = writeLedgerWithFrontmatter(
      [],
      completeEvidenceBlock({ ledger_version: "null" }),
    );
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    expect(snapshot.runbook_version).toBe(null);
    expect(snapshot.runbook_version_skew).toBe(
      "continuation-evidence-present",
    );
  });

  test("mismatched skew with complete evidence → continuation-evidence-present", () => {
    const ledgerPath = writeLedgerWithFrontmatter(
      ['runbook_version: "1"'],
      completeEvidenceBlock({ ledger_version: "1" }),
    );
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    expect(snapshot.runbook_version).toBe("1");
    expect(snapshot.runbook_version_skew).toBe(
      "continuation-evidence-present",
    );
  });

  test("evidence with mismatched ledger_version field is rejected", () => {
    // Evidence row claims it documents a v0 ledger, but the actual ledger
    // is v1. The parser refuses to apply v0 evidence to a v1 ledger.
    const ledgerPath = writeLedgerWithFrontmatter(
      ['runbook_version: "1"'],
      completeEvidenceBlock({ ledger_version: "0" }),
    );
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    expect(snapshot.runbook_version_skew).toBe("mismatched");
  });

  test("evidence with mismatched runtime_version field is rejected", () => {
    // Evidence row recorded under a future runtime is not honored here.
    const ledgerPath = writeLedgerWithFrontmatter(
      [],
      completeEvidenceBlock({ runtime_version: "4" }),
    );
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    expect(snapshot.runbook_version_skew).toBe("missing");
  });

  test("matched skew never promotes to continuation-evidence-present", () => {
    // Even when an evidence row exists, a matched ledger stays matched.
    const ledgerPath = writeLedgerWithFrontmatter(
      [`runbook_version: "${RUNBOOK_VERSION}"`],
      completeEvidenceBlock({ ledger_version: RUNBOOK_VERSION }),
    );
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    expect(snapshot.runbook_version_skew).toBe("matched");
  });
});

describe("parseRunbookVersionContinuationEvidence", () => {
  function ledgerWithNotes(notesBody: string[]): string {
    return writeLedgerWithFrontmatter([], ["## Notes", "", ...notesBody]);
  }

  test("returns null when the ledger file does not exist", () => {
    expect(
      parseRunbookVersionContinuationEvidence("/tmp/does-not-exist-u6.md"),
    ).toBe(null);
  });

  test("returns null when there is no ## Notes section", () => {
    const ledgerPath = writeLedgerWithFrontmatter([]);
    expect(parseRunbookVersionContinuationEvidence(ledgerPath)).toBe(null);
  });

  test("returns null when there is no continuation marker", () => {
    const ledgerPath = ledgerWithNotes([
      "Plain notes prose, no marker.",
      "",
      "```yaml",
      "some_other_block:",
      "  key: value",
      "```",
      "",
    ]);
    expect(parseRunbookVersionContinuationEvidence(ledgerPath)).toBe(null);
  });

  test("returns the parsed evidence when all seven fields are present", () => {
    const ledgerPath = ledgerWithNotes([
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      '  ledger_version: "1"',
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "Nathan @ 2026-05-22T19:00"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "v1 ledger resumed; v2 changes are additive"',
      "```",
      "",
    ]);
    const evidence = parseRunbookVersionContinuationEvidence(ledgerPath);
    expect(evidence).toEqual({
      ledger_version: "1",
      runtime_version: RUNBOOK_VERSION,
      operator_decision: "Nathan @ 2026-05-22T19:00",
      timestamp: "2026-05-22T19:00:00+10:00",
      route_context: "batch-loop",
      reference_context: "references/ledger-and-helper.md",
      accepted_risk: "v1 ledger resumed; v2 changes are additive",
    });
  });

  test("accepts ledger_version: null (literal) for a missing-version ledger", () => {
    const ledgerPath = ledgerWithNotes([
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "Nathan @ 2026-05-22T19:00"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "legacy v1 ledger, no version field"',
      "```",
      "",
    ]);
    const evidence = parseRunbookVersionContinuationEvidence(ledgerPath);
    expect(evidence?.ledger_version).toBe(null);
    expect(evidence?.runtime_version).toBe(RUNBOOK_VERSION);
  });

  test("returns null when any of the seven required fields is missing", () => {
    const required = [
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "Nathan"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "x"',
    ];
    for (let omitted = 0; omitted < required.length; omitted++) {
      const fields = required.filter((_, i) => i !== omitted);
      const ledgerPath = ledgerWithNotes([
        "<!-- runbook-version-skew-continuation -->",
        "```yaml",
        "runbook_version_skew_continuation:",
        ...fields,
        "```",
        "",
      ]);
      expect(parseRunbookVersionContinuationEvidence(ledgerPath)).toBe(null);
    }
  });

  test("returns null when a field is empty", () => {
    const ledgerPath = ledgerWithNotes([
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      "  operator_decision: ",
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "x"',
      "```",
      "",
    ]);
    expect(parseRunbookVersionContinuationEvidence(ledgerPath)).toBe(null);
  });

  test("rejects forged evidence that uses non-comment marker text", () => {
    // A hostile Notes line that looks like the marker but is plain prose
    // (no `<!-- ... -->` html comment) must not be honored.
    const ledgerPath = ledgerWithNotes([
      "runbook-version-skew-continuation",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "Nathan"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "x"',
      "```",
      "",
    ]);
    expect(parseRunbookVersionContinuationEvidence(ledgerPath)).toBe(null);
  });

  test("rejects unknown extra fields inside the evidence block", () => {
    const ledgerPath = ledgerWithNotes([
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "Nathan"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "x"',
      '  extra_smuggled_field: "value"',
      "```",
      "",
    ]);
    expect(parseRunbookVersionContinuationEvidence(ledgerPath)).toBe(null);
  });

  test("rejects duplicate field declarations", () => {
    const ledgerPath = ledgerWithNotes([
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  runtime_version: "4"',
      '  operator_decision: "Nathan"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "x"',
      "```",
      "",
    ]);
    expect(parseRunbookVersionContinuationEvidence(ledgerPath)).toBe(null);
  });

  test("rejects a malformed YAML block with no header", () => {
    const ledgerPath = ledgerWithNotes([
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      "```",
      "",
    ]);
    expect(parseRunbookVersionContinuationEvidence(ledgerPath)).toBe(null);
  });

  test("first complete evidence row wins; later rows are ignored", () => {
    const ledgerPath = ledgerWithNotes([
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "First operator"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "first"',
      "```",
      "",
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "Stale operator"',
      '  timestamp: "2026-05-22T20:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "stale"',
      "```",
      "",
    ]);
    const evidence = parseRunbookVersionContinuationEvidence(ledgerPath);
    expect(evidence?.operator_decision).toBe("First operator");
    expect(evidence?.accepted_risk).toBe("first");
  });

  test("F-U6-SEC-002: nested fenced block cannot smuggle a marker + evidence", () => {
    // The hostile pattern: a 4-backtick wrapper hides a 3-backtick yaml
    // body that contains a complete evidence row. Before the security
    // fix, the markerPattern matched the inner yaml and the row was
    // honored. After the fix, stripNestedFencedRegions blanks the
    // wrapper body so the inner marker cannot reach the scanner.
    const ledgerPath = ledgerWithNotes([
      "````text",
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "Hostile"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "smuggled"',
      "```",
      "````",
      "",
    ]);
    expect(parseRunbookVersionContinuationEvidence(ledgerPath)).toBe(null);
  });

  test("F-U6-SEC-001: blockquoted '## Notes' line cannot fabricate a Notes scope", () => {
    // The hostile pattern: a line `> ## Notes` would have matched the
    // pre-fix unanchored regex and let an attacker plant evidence
    // inside an earlier section. The fixed regex requires the heading
    // at column zero.
    const ledgerPath = writeLedgerWithFrontmatter(
      [],
      [
        "## Acceptance criteria",
        "",
        "> ## Notes",
        "",
        "<!-- runbook-version-skew-continuation -->",
        "```yaml",
        "runbook_version_skew_continuation:",
        "  ledger_version: null",
        `  runtime_version: "${RUNBOOK_VERSION}"`,
        '  operator_decision: "Hostile"',
        '  timestamp: "2026-05-22T19:00:00+10:00"',
        '  route_context: "batch-loop"',
        '  reference_context: "references/ledger-and-helper.md"',
        '  accepted_risk: "smuggled"',
        "```",
        "",
      ],
    );
    expect(parseRunbookVersionContinuationEvidence(ledgerPath)).toBe(null);
  });

  test("F-U6-SEC-005: evidence field with a C0 control byte is rejected", () => {
    // Embed a literal NUL byte in the operator_decision quoted string.
    // The parser rejects the field for control-byte content; the
    // overall row is therefore null.
    const ledgerPath = ledgerWithNotes([
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      `  operator_decision: "before\x00after"`,
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "x"',
      "```",
      "",
    ]);
    expect(parseRunbookVersionContinuationEvidence(ledgerPath)).toBe(null);
  });
});

describe("readLedgerSnapshot: U6 runbook_version hardening", () => {
  test("F-U6-SEC-013: NBSP / ZWSP / BOM around the runbook_version value are stripped before comparison", () => {
    // Each Unicode-whitespace-padded version string must still classify
    // as matched, not mismatched. Otherwise an attacker who can write
    // the ledger could stick the workflow.
    const writer = (paddedVersion: string): string =>
      writeLedgerWithFrontmatter([
        `runbook_version: "${paddedVersion}"`,
      ]);
    for (const padded of [
      ` ${RUNBOOK_VERSION}`,
      `${RUNBOOK_VERSION}​`,
      `﻿${RUNBOOK_VERSION}﻿`,
      ` ${RUNBOOK_VERSION} `,
    ]) {
      const path = writer(padded);
      const snapshot = withFailMode("throw", () => readLedgerSnapshot(path));
      expect(snapshot.runbook_version_skew).toBe("matched");
    }
  });

  test("F-U6-SEC-005: runbook_version containing a control byte is rejected (treated as missing)", () => {
    const path = writeLedgerWithFrontmatter([
      `runbook_version: "${RUNBOOK_VERSION}\x00x"`,
    ]);
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(path));
    expect(snapshot.runbook_version).toBe(null);
    expect(snapshot.runbook_version_skew).toBe("missing");
  });

  // Boundary table for the C0/C1 control-byte filter (sweep-2 testing
  // gap T-1). Tab (0x09) MUST stay allowed; 0x08, 0x1F, 0x7F, 0x9F
  // MUST be rejected; 0xA0 (NBSP) MUST stay allowed (NBSP is U+00A0,
  // one byte outside the C1 range).
  test.each<[string, number, "matched" | "missing"]>([
    ["0x08 backspace", 0x08, "missing"],
    ["0x09 tab", 0x09, "matched"],
    ["0x1f unit separator", 0x1f, "missing"],
    ["0x7f delete", 0x7f, "missing"],
    ["0x9f application-program-command", 0x9f, "missing"],
    ["0xA0 NBSP (just above C1 range)", 0xa0, "matched"],
  ])(
    "containsControlByte boundary: runbook_version with %s is classified as %s when stripped",
    (_label, codePoint, expected) => {
      // Embed the byte at the leading boundary so stripBoundaryWhitespace
      // can drop it for the allowed cases (tab and NBSP are stripped as
      // boundary whitespace); for the rejected control bytes, the
      // strip leaves them in place and containsControlByte rejects the
      // whole value.
      const char = String.fromCharCode(codePoint);
      const path = writeLedgerWithFrontmatter([
        `runbook_version: "${char}${RUNBOOK_VERSION}"`,
      ]);
      const snapshot = withFailMode("throw", () =>
        readLedgerSnapshot(path),
      );
      expect(snapshot.runbook_version_skew).toBe(expected);
    },
  );
});

// ---------------- U6 sweep-2: walker recovery + fence-edge cases ----------------

describe("parseRunbookVersionContinuationEvidence: walker edge cases", () => {
  function ledgerWithRawNotes(notesBody: string[]): string {
    return writeLedger(
      [
        "---",
        "issue_number: 1",
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
        "## Notes",
        "",
        ...notesBody,
      ].join("\n"),
    );
  }

  test("rejected first row + valid second row → second row wins (sweep-2 recovery branch)", () => {
    const ledgerPath = ledgerWithRawNotes([
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      "  operator_decision: ",
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "first-row-missing-operator"',
      "```",
      "",
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "Nathan @ 2026-05-22T19:00"',
      '  timestamp: "2026-05-22T20:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "recovered"',
      "```",
      "",
    ]);
    const evidence = parseRunbookVersionContinuationEvidence(ledgerPath);
    expect(evidence?.accepted_risk).toBe("recovered");
  });

  test("evidence fence with no closing fence (EOF) → null without hang", () => {
    const ledgerPath = ledgerWithRawNotes([
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "Nathan"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "x"',
      // intentionally no closing ``` fence
    ]);
    const startedAt = Date.now();
    const evidence = parseRunbookVersionContinuationEvidence(ledgerPath);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(evidence).toBe(null);
  });

  test("template-documented blank line between marker and yaml fence is honored", () => {
    // The template at issue-N-ledger.template.md explicitly says blank
    // lines are allowed between the marker comment and the opening
    // yaml fence. This regression test pins the walker against the
    // sweep-2 finding where the immediate-previous-line check would
    // have silently dropped the legitimate row.
    const ledgerPath = ledgerWithRawNotes([
      "<!-- runbook-version-skew-continuation -->",
      "",
      "",
      "```yaml",
      "runbook_version_skew_continuation:",
      "  ledger_version: null",
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "Nathan @ 2026-05-22T19:00"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "blank-line-tolerated"',
      "```",
      "",
    ]);
    const evidence = parseRunbookVersionContinuationEvidence(ledgerPath);
    expect(evidence?.accepted_risk).toBe("blank-line-tolerated");
  });
});

// ---------------- runbook-heal closure form (AC 1, 2, 5) ----------------
//
// A guarded `runbook-heal <sha>` fixed-resolution arm on the batch_id:final
// path. The cited commit must be reachable AND touch only control-plane
// allowlist paths (`runbooks/issue-to-pr-v2/` or `skills/issue-to-pr/`). Any
// touched path outside the allowlist — deliverable files, mixed commits, and
// the per-issue ledger path `docs/runbooks/issue-to-pr/` — rejects, naming the
// first offending path. Fixtures are real reachable commits on this branch:
//
//   8be31d4 — control-plane only (runbooks/issue-to-pr-v2/ references)  ACCEPT
//   915f666 — deliverable docs/scratch/hello-world.md                    REJECT
//   7c6b569 — mixed: docs/.../parity-audit + skills/issue-to-pr/SKILL.md REJECT
//   67f2163 — ledger path docs/runbooks/issue-to-pr/issue-71-ledger.md   REJECT
//   dc6868a — merge commit (#70), which is not control-plane proof       REJECT
const RUNBOOK_HEAL_CONTROL_PLANE_SHA = "8be31d4";
const RUNBOOK_HEAL_DELIVERABLE_SHA = "915f666";
const RUNBOOK_HEAL_MIXED_SHA = "7c6b569";
const RUNBOOK_HEAL_LEDGER_PATH_SHA = "67f2163";
// A real, reachable-from-HEAD merge commit. It records no file changes against
// its first parent, which previously made it look like an empty/no-op commit,
// but the behaviour under test is stricter: runbook-heal must reject merge
// commits explicitly instead of relying on that touched-files side effect.
const RUNBOOK_HEAL_MERGE_COMMIT_SHA = "dc6868a";

/**
 * Build a complete ledger (frontmatter + AC + optional `## Batches` + matching
 * `## Findings data` / `## Findings` table) holding a single finding row, then
 * run `validateFindingsData` against it via `withFailMode("throw")`.
 *
 * `validateFindingsData` cross-checks the data block against the rendered
 * table, so the table row is generated to match the data row.
 */
function runFindingsFixture(
  finding: {
    id: string;
    batch_id: string;
    signature: string;
    persona: string;
    severity: string;
    status: string;
    summary: string;
    resolution: string;
  },
  batchesBlock: string[] = ["```yaml", "batches: []", "```"],
): void {
  const ledgerPath = writeLedger(
    [
      "---",
      "issue_number: 1",
      "---",
      "",
      "# Issue 1",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] AC 1",
      "",
      "## Batches",
      "",
      ...batchesBlock,
      "",
      "## Findings data",
      "",
      "```yaml",
      "findings:",
      `  - id: ${finding.id}`,
      `    batch_id: ${finding.batch_id}`,
      `    signature: ${finding.signature}`,
      `    persona: ${finding.persona}`,
      `    severity: ${finding.severity}`,
      `    status: ${finding.status}`,
      `    summary: "${finding.summary}"`,
      `    resolution: "${finding.resolution}"`,
      "```",
      "",
      "## Findings",
      "",
      "| id | batch_id | signature | persona | severity | status | summary | resolution |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      `| ${finding.id} | ${finding.batch_id} | ${finding.signature} | ${finding.persona} | ${finding.severity} | ${finding.status} | ${finding.summary} | ${finding.resolution} |`,
      "",
    ].join("\n"),
  );
  withFailMode("throw", () => validateFindingsData(ledgerPath));
}

// The 5 control-plane reference paths that commit 8be31d4 touches. A terminal
// batch that records 8be31d4 must declare these as its `files` (the helper
// asserts a recorded commit touches only the batch's confirmed files).
const RUNBOOK_HEAL_CONTROL_PLANE_FILES = [
  "runbooks/issue-to-pr-v2/issue-to-pr.md",
  "runbooks/issue-to-pr-v2/references/ledger-and-helper.md",
  "runbooks/issue-to-pr-v2/references/stage-1-pick-issue.md",
  "runbooks/issue-to-pr-v2/references/stage-2-plan.md",
  "runbooks/issue-to-pr-v2/references/stage-3-decompose.md",
];

/**
 * A terminal (`converged`) batch whose `builder_commits` records `sha`, so a
 * `final` finding closed by `commit <sha>` passes `validateLedgerOwnedFixedCommit`.
 * `files` must cover every path the recorded commit touches.
 */
function terminalBatchRecording(sha: string, files: string[]): string[] {
  return [
    "```yaml",
    "batches:",
    '  - id: "b1"',
    '    name: "B1"',
    '    goal: "AC 1"',
    "    files:",
    ...files.map((file) => `      - "${file}"`),
    "    depends_on: []",
    "    execution_mode: tdd",
    "    acceptance_tests:",
    '      - "AC 1 holds"',
    "    ac_mapping:",
    "      - 1",
    "    rationale: null",
    "    status: converged",
    "    builder_commits:",
    `      - "${sha}"`,
    "    builder_attempts:",
    "      - attempt_type: implementation",
    "        status: committed",
    `        commit_sha: "${sha}"`,
    "        files_touched:",
    ...files.map((file) => `          - "${file}"`),
    '        route_hint: "validator-wave"',
    "        blockers: []",
    "        probe_results: []",
    '        notes: "terminal batch fixture"',
    "    orchestrator_inline_attempts: []",
    "    iterations: 1",
    "    final_verdict: converged",
    "```",
  ];
}

function terminalInlineBatchRecording(sha: string, files: string[]): string[] {
  return [
    "```yaml",
    "batches:",
    '  - id: "b1"',
    '    name: "B1"',
    '    goal: "AC 1"',
    "    files:",
    ...files.map((file) => `      - "${file}"`),
    "    depends_on: []",
    "    execution_mode: change_first",
    "    acceptance_tests:",
    '      - "AC 1 holds"',
    "    ac_mapping:",
    "      - 1",
    "    rationale: null",
    "    status: converged",
    "    builder_commits: []",
    "    builder_attempts: []",
    "    orchestrator_inline_attempts:",
    `      - commit_sha: "${sha}"`,
    "        files_touched:",
    ...files.map((file) => `          - "${file}"`),
    '        notes: "terminal inline fixture"',
    "    iterations: 1",
    "    final_verdict: converged",
    "```",
  ];
}

function validatorEvidenceNotes(
  sha: string,
  lane: "builder_attempts" | "orchestrator_inline_attempts",
  overrides: Partial<{ waveCommit: string; findings: string[]; outcome: string }> = {},
): string[] {
  const waveCommit = overrides.waveCommit ?? sha;
  const outcome = overrides.outcome ?? "clean";
  const findings = overrides.findings ?? [];
  return [
    "## Notes",
    "",
    "<!-- implementation-attempt-checkpoint -->",
    "```yaml",
    "implementation_attempt_checkpoint:",
    '  batch_id: "b1"',
    `  implementation_commit: "${sha}"`,
    `  attempt_lane: "${lane}"`,
    '  timestamp: "2026-05-25T10:00:00+10:00"',
    "```",
    "",
    "<!-- validator-wave-completed -->",
    "```yaml",
    "validator_wave_completed:",
    '  batch_id: "b1"',
    `  implementation_commit: "${waveCommit}"`,
    `  attempt_lane: "${lane}"`,
    "  personas:",
    '    - "compound-engineering:ce-correctness-reviewer"',
    '    - "compound-engineering:ce-testing-reviewer"',
    '    - "compound-engineering:ce-maintainability-reviewer"',
    '    - "compound-engineering:ce-project-standards-reviewer"',
    '    - "compound-engineering:ce-adversarial-reviewer"',
    "  dispatch_evidence:",
    '    role: "validator"',
    `    target_id: "b1@${waveCommit}"`,
    '    cli_route_id: "packet.validator"',
    `  outcome: "${outcome}"`,
    findings.length === 0 ? "  findings: []" : "  findings:",
    ...findings.map((finding) => `    - "${finding}"`),
    "```",
    "",
  ];
}

function ledgerWithCurrentRunbookVersion(
  batchLines: string[],
  notesLines: string[] = [],
): string {
  return writeLedger(
    [
      "---",
      "issue_number: 1",
      `runbook_version: "${RUNBOOK_VERSION}"`,
      "---",
      "",
      "# Issue 1",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] AC 1",
      "",
      "## Batches",
      "",
      ...batchLines,
      "",
      ...notesLines,
    ].join("\n"),
  );
}

describe("validateLedgerBatches: Validator-wave evidence", () => {
  test("accepts a current-version terminal Builder attempt with clean completed-wave evidence", () => {
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      terminalBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      validatorEvidenceNotes(RUNBOOK_HEAL_CONTROL_PLANE_SHA, "builder_attempts"),
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).not.toThrow();
  });

  test("accepts a current-version terminal inline attempt with clean completed-wave evidence", () => {
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      terminalInlineBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      validatorEvidenceNotes(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        "orchestrator_inline_attempts",
      ),
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).not.toThrow();
  });

  test("rejects a current-version terminal committed attempt without completed-wave evidence", () => {
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      terminalBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      [
        "## Notes",
        "",
        "<!-- implementation-attempt-checkpoint -->",
        "```yaml",
        "implementation_attempt_checkpoint:",
        '  batch_id: "b1"',
        `  implementation_commit: "${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '  attempt_lane: "builder_attempts"',
        '  timestamp: "2026-05-25T10:00:00+10:00"',
        "```",
        "",
      ],
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(/missing completed Validator-wave evidence/);
  });

  test("rejects a current-version terminal committed attempt without checkpoint evidence", () => {
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      terminalBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      [
        "## Notes",
        "",
        "<!-- validator-wave-completed -->",
        "```yaml",
        "validator_wave_completed:",
        '  batch_id: "b1"',
        `  implementation_commit: "${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '  attempt_lane: "builder_attempts"',
        "  personas:",
        '    - "compound-engineering:ce-correctness-reviewer"',
        '    - "compound-engineering:ce-testing-reviewer"',
        '    - "compound-engineering:ce-maintainability-reviewer"',
        '    - "compound-engineering:ce-project-standards-reviewer"',
        '    - "compound-engineering:ce-adversarial-reviewer"',
        "  dispatch_evidence:",
        '    role: "validator"',
        `    target_id: "b1@${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '    cli_route_id: "packet.validator"',
        '  outcome: "clean"',
        "  findings: []",
        "```",
        "",
      ],
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(/missing implementation attempt checkpoint evidence/);
  });

  test("rejects completed-wave evidence that cites the wrong implementation commit", () => {
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      terminalBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      validatorEvidenceNotes(RUNBOOK_HEAL_CONTROL_PLANE_SHA, "builder_attempts", {
        waveCommit: RUNBOOK_HEAL_DELIVERABLE_SHA,
      }),
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(/missing completed Validator-wave evidence/);
  });

  // Round-1 hardening additions (U6 review): close coverage gaps the
  // adversarial / acceptance-criteria / testing angles surfaced. Each test
  // pins a load-bearing branch of the new R5/R6/R7 enforcement.

  test("accepts a current-version terminal Builder attempt with findings-recorded outcome", () => {
    // R6 explicitly names "clean AND finding-bearing waves" as durable
    // evidence. The Round-1 testing/acceptance-criteria angles found the
    // findings-recorded branch was entirely untested — every prior fixture
    // used outcome: clean. Pin the positive happy path.
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      terminalBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      validatorEvidenceNotes(RUNBOOK_HEAL_CONTROL_PLANE_SHA, "builder_attempts", {
        outcome: "findings-recorded",
        findings: ["F-b1-001", "F-b1-002"],
      }),
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).not.toThrow();
  });

  test("skips wave-evidence check when frontmatter runbook_version is missing (skew gate bypass)", () => {
    // R7 plan lines 782-785 scope the new evidence requirement to current-
    // runbook-version ledgers and explicitly keep the temporal requirement
    // in Stage 4 prose for legacy ledgers. A regression that removed the
    // ledgerUsesCurrentRunbookVersion early-return would hard-fail every
    // pre-U6 resume run. Pin the bypass so the gate semantics cannot drift.
    const ledgerPath = writeLedger(
      [
        "---",
        "issue_number: 1",
        // intentionally NO runbook_version frontmatter
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
        "## Batches",
        "",
        ...terminalBatchRecording(
          RUNBOOK_HEAL_CONTROL_PLANE_SHA,
          RUNBOOK_HEAL_CONTROL_PLANE_FILES,
        ),
        "",
        // intentionally NO Notes evidence rows — gate must skip
      ].join("\n"),
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).not.toThrow();
  });

  // F3 (skew-gate-widens-evidence-bypass), Round-1 final-integrated hardening.
  // A `continuation-evidence-present` ledger carries an OLD frontmatter
  // runbook_version but an operator-authored continuation row that authorizes
  // the CURRENT runtime, so `classifyRoute` lets it proceed. The wave-evidence
  // floor (R5/R6, ADR 0003 always-on) must therefore apply to it too. The bug:
  // `ledgerUsesCurrentRunbookVersion` compared the raw frontmatter string to
  // RUNBOOK_VERSION, so a continued ledger (frontmatter still old) silently
  // skipped the floor — disarming the always-on wave for exactly the ledgers an
  // operator deliberately re-opened. These two tests pin that the floor is now
  // keyed on the skew CLASSIFICATION, not raw frontmatter equality.
  function continuationLedger(
    batchLines: string[],
    extraNotesLines: string[],
  ): string {
    // An OLD contract version (derived to be guaranteed != RUNBOOK_VERSION, so
    // a future RUNBOOK_VERSION bump can never collapse this fixture into the
    // `matched` case and silently stop exercising continuation-evidence-present)
    // plus a complete continuation row for the current runtime
    // => skew classifies as continuation-evidence-present => router proceeds.
    const OLD_VERSION = `${RUNBOOK_VERSION}-prior`;
    return writeLedger(
      [
        "---",
        "issue_number: 1",
        `runbook_version: "${OLD_VERSION}"`,
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
        "## Batches",
        "",
        ...batchLines,
        "",
        "## Notes",
        "",
        "<!-- runbook-version-skew-continuation -->",
        "```yaml",
        "runbook_version_skew_continuation:",
        `  ledger_version: "${OLD_VERSION}"`,
        `  runtime_version: "${RUNBOOK_VERSION}"`,
        '  operator_decision: "Nathan @ 2026-05-26T09:00"',
        '  timestamp: "2026-05-26T09:00:00+10:00"',
        '  route_context: "batch-loop"',
        '  reference_context: "references/ledger-and-helper.md"',
        '  accepted_risk: "v2 ledger resumed under current runtime; changes additive"',
        "```",
        "",
        ...extraNotesLines,
      ].join("\n"),
    );
  }

  test("enforces wave-evidence floor on a continuation-evidence ledger missing wave evidence (F3)", () => {
    // Before the fix this returned without throwing (raw frontmatter "2" !==
    // RUNBOOK_VERSION => early return). The router proceeds on
    // continuation-evidence-present, so the floor must NOT be skipped.
    const ledgerPath = continuationLedger(
      terminalBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      [
        "<!-- implementation-attempt-checkpoint -->",
        "```yaml",
        "implementation_attempt_checkpoint:",
        '  batch_id: "b1"',
        `  implementation_commit: "${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '  attempt_lane: "builder_attempts"',
        '  timestamp: "2026-05-26T09:05:00+10:00"',
        "```",
        "",
        // intentionally NO validator-wave-completed row
      ],
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(/missing completed Validator-wave evidence/);
  });

  test("accepts a continuation-evidence ledger with complete wave evidence (F3)", () => {
    // The floor is enforced AND satisfiable on a continued ledger: the wave
    // evidence rows are appended after the continuation row in the same Notes.
    // validatorEvidenceNotes leads with its own "## Notes" header; drop every
    // line up to and including it so the evidence rows append under the
    // continuation section's existing Notes. Robust to changes in the helper's
    // leading-line count (a bare slice(N) would silently break on a reorder).
    const waveNotes = validatorEvidenceNotes(
      RUNBOOK_HEAL_CONTROL_PLANE_SHA,
      "builder_attempts",
    );
    const notesHeaderIndex = waveNotes.indexOf("## Notes");
    const ledgerPath = continuationLedger(
      terminalBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      waveNotes.slice(notesHeaderIndex + 1),
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).not.toThrow();
  });

  // F2 (vacuous-proof), Round-1 final-integrated hardening. A committed
  // implementation attempt's commit is the durable proof real work happened, so
  // it must carry a real tree change. A merge commit (>1 parent, empty default
  // diff) or a content-empty commit previously satisfied the terminal
  // "at least one committed implementation attempt" requirement with
  // files_touched: [] passing the parity check vacuously. The guard
  // (assertContentBearingAttemptCommit) now rejects both, on BOTH the
  // builder_attempts and orchestrator_inline_attempts lanes. dc6868a is a real
  // reachable merge commit whose diff-tree against its first parent is empty.
  function mergeCommitTerminalBuilderBatch(): string[] {
    return [
      "```yaml",
      "batches:",
      '  - id: "b1"',
      '    name: "B1"',
      '    goal: "AC 1"',
      "    files:",
      `      - "${RUNBOOK_HEAL_CONTROL_PLANE_FILES[0]}"`,
      "    depends_on: []",
      "    execution_mode: tdd",
      "    acceptance_tests:",
      '      - "AC 1 holds"',
      "    ac_mapping:",
      "      - 1",
      "    rationale: null",
      "    status: converged",
      "    builder_commits:",
      `      - "${RUNBOOK_HEAL_MERGE_COMMIT_SHA}"`,
      "    builder_attempts:",
      "      - attempt_type: implementation",
      "        status: committed",
      `        commit_sha: "${RUNBOOK_HEAL_MERGE_COMMIT_SHA}"`,
      "        files_touched: []",
      '        route_hint: "validator-wave"',
      "        blockers: []",
      "        probe_results: []",
      '        notes: "merge commit fixture"',
      "    orchestrator_inline_attempts: []",
      "    iterations: 1",
      "    final_verdict: converged",
      "```",
    ];
  }

  function mergeCommitTerminalInlineBatch(): string[] {
    return [
      "```yaml",
      "batches:",
      '  - id: "b1"',
      '    name: "B1"',
      '    goal: "AC 1"',
      "    files:",
      `      - "${RUNBOOK_HEAL_CONTROL_PLANE_FILES[0]}"`,
      "    depends_on: []",
      "    execution_mode: change_first",
      '    rationale: "change_first-exception: bounded inline edit, non-docs path approved at stage 3 gate"',
      "    acceptance_tests:",
      '      - "AC 1 holds"',
      "    ac_mapping:",
      "      - 1",
      "    status: converged",
      "    builder_commits: []",
      "    builder_attempts: []",
      "    orchestrator_inline_attempts:",
      `      - commit_sha: "${RUNBOOK_HEAL_MERGE_COMMIT_SHA}"`,
      "        files_touched: []",
      '        notes: "merge commit inline fixture"',
      "    iterations: 1",
      "    final_verdict: converged",
      "```",
    ];
  }

  test("rejects a committed builder_attempts merge commit as vacuous proof (F2)", () => {
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      mergeCommitTerminalBuilderBatch(),
      validatorEvidenceNotes(RUNBOOK_HEAL_MERGE_COMMIT_SHA, "builder_attempts"),
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(/builder_attempts commit .* is a merge commit/);
  });

  test("rejects a committed orchestrator_inline_attempts merge commit as vacuous proof (F2)", () => {
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      mergeCommitTerminalInlineBatch(),
      validatorEvidenceNotes(
        RUNBOOK_HEAL_MERGE_COMMIT_SHA,
        "orchestrator_inline_attempts",
      ),
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(/orchestrator_inline_attempts commit .* is a merge commit/);
  });

  test("rejects an inline terminal attempt when checkpoint+wave evidence is wrongly labeled builder_attempts", () => {
    // The Round-1 testing angle flagged that cross-lane confusion has no
    // negative coverage: dedup keys include lane, but a regression that
    // dropped the lane component would silently let Builder-labeled
    // evidence satisfy an inline attempt (or vice-versa). Pin the per-row
    // (batch, commit, lane) key contract.
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      terminalInlineBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      // wrong lane — the batch has an inline attempt but the evidence
      // claims builder_attempts. Indexer keys evidence under builder_attempts
      // lane; the inline attempt loop looks for orchestrator_inline_attempts
      // keys; lookup misses; helper fails.
      validatorEvidenceNotes(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        "builder_attempts",
      ),
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(
      /orchestrator_inline_attempts commit .* is missing implementation attempt checkpoint evidence/,
    );
  });

  test("rejects a current-version terminal inline attempt without completed-wave evidence", () => {
    // Parity with the Builder-lane missing-wave test (`rejects a current-
    // version terminal committed attempt without completed-wave evidence`).
    // Round-1 acceptance-criteria angle: the inline-lane rejection branch
    // of validateTerminalValidatorWaveEvidence was implementation-covered
    // but not test-covered.
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      terminalInlineBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      [
        "## Notes",
        "",
        "<!-- implementation-attempt-checkpoint -->",
        "```yaml",
        "implementation_attempt_checkpoint:",
        '  batch_id: "b1"',
        `  implementation_commit: "${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '  attempt_lane: "orchestrator_inline_attempts"',
        '  timestamp: "2026-05-25T10:00:00+10:00"',
        "```",
        "",
      ],
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(
      /orchestrator_inline_attempts commit .* is missing completed Validator-wave evidence/,
    );
  });

  test("rejects completed-wave evidence missing one of the always-on Validator personas", () => {
    // Round-1 testing angle: ALWAYS_ON_VALIDATOR_PERSONAS is hardcoded in
    // ledger.ts; the runbook prose lists the same five. Every prior fixture
    // included all five so a renderer regression that dropped one persona
    // would only fail at ledger-write time, not in the test suite. Pin the
    // membership-check negative.
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      terminalBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      [
        "## Notes",
        "",
        "<!-- implementation-attempt-checkpoint -->",
        "```yaml",
        "implementation_attempt_checkpoint:",
        '  batch_id: "b1"',
        `  implementation_commit: "${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '  attempt_lane: "builder_attempts"',
        '  timestamp: "2026-05-25T10:00:00+10:00"',
        "```",
        "",
        "<!-- validator-wave-completed -->",
        "```yaml",
        "validator_wave_completed:",
        '  batch_id: "b1"',
        `  implementation_commit: "${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '  attempt_lane: "builder_attempts"',
        "  personas:",
        // intentionally omitting ce-adversarial-reviewer
        '    - "compound-engineering:ce-correctness-reviewer"',
        '    - "compound-engineering:ce-testing-reviewer"',
        '    - "compound-engineering:ce-maintainability-reviewer"',
        '    - "compound-engineering:ce-project-standards-reviewer"',
        "  dispatch_evidence:",
        '    role: "validator"',
        `    target_id: "b1@${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '    cli_route_id: "packet.validator"',
        '  outcome: "clean"',
        "  findings: []",
        "```",
        "",
      ],
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(
      /is missing always-on persona "compound-engineering:ce-adversarial-reviewer"/,
    );
  });

  test("rejects duplicate implementation-attempt-checkpoint evidence blocks for the same (batch, commit, lane) triple", () => {
    // Round-1 testing angle: indexImplementationAttemptCheckpoints fails
    // on duplicate keys but no test exercised the path. A regression that
    // dropped the `keys.has(key)` check would let two contradictory rows
    // coexist silently. Pin the dedup contract.
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      terminalBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      [
        "## Notes",
        "",
        "<!-- implementation-attempt-checkpoint -->",
        "```yaml",
        "implementation_attempt_checkpoint:",
        '  batch_id: "b1"',
        `  implementation_commit: "${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '  attempt_lane: "builder_attempts"',
        '  timestamp: "2026-05-25T10:00:00+10:00"',
        "```",
        "",
        // duplicate checkpoint for the SAME (batch, commit, lane) triple
        "<!-- implementation-attempt-checkpoint -->",
        "```yaml",
        "implementation_attempt_checkpoint:",
        '  batch_id: "b1"',
        `  implementation_commit: "${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '  attempt_lane: "builder_attempts"',
        '  timestamp: "2026-05-25T11:00:00+10:00"',
        "```",
        "",
        "<!-- validator-wave-completed -->",
        "```yaml",
        "validator_wave_completed:",
        '  batch_id: "b1"',
        `  implementation_commit: "${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '  attempt_lane: "builder_attempts"',
        "  personas:",
        '    - "compound-engineering:ce-correctness-reviewer"',
        '    - "compound-engineering:ce-testing-reviewer"',
        '    - "compound-engineering:ce-maintainability-reviewer"',
        '    - "compound-engineering:ce-project-standards-reviewer"',
        '    - "compound-engineering:ce-adversarial-reviewer"',
        "  dispatch_evidence:",
        '    role: "validator"',
        `    target_id: "b1@${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '    cli_route_id: "packet.validator"',
        '  outcome: "clean"',
        "  findings: []",
        "```",
        "",
      ],
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(/duplicate implementation attempt checkpoint evidence/);
  });

  test("rejects completed-wave evidence whose dispatch_evidence.target_id commit differs from implementation_commit", () => {
    // The earlier `rejects completed-wave evidence that cites the wrong
    // implementation commit` test actually fires the key-lookup miss path
    // (the helper-wide "missing completed Validator-wave evidence" error
    // — both halves of the row use waveCommit, so the per-row dedup key
    // matches THAT sha and the per-attempt key matches the OTHER sha).
    //
    // This test exercises the *inner* shape check at
    // validateValidatorWaveEvidenceShape:
    //   `dispatch_evidence.target_id commit does not match implementation_commit`.
    // It needs both shas to be reachable (so validateReachableCommit
    // resolves both) but the target_id and implementation_commit to
    // disagree internally within a single wave-evidence block.
    const ledgerPath = ledgerWithCurrentRunbookVersion(
      terminalBatchRecording(
        RUNBOOK_HEAL_CONTROL_PLANE_SHA,
        RUNBOOK_HEAL_CONTROL_PLANE_FILES,
      ),
      [
        "## Notes",
        "",
        "<!-- implementation-attempt-checkpoint -->",
        "```yaml",
        "implementation_attempt_checkpoint:",
        '  batch_id: "b1"',
        `  implementation_commit: "${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '  attempt_lane: "builder_attempts"',
        '  timestamp: "2026-05-25T10:00:00+10:00"',
        "```",
        "",
        "<!-- validator-wave-completed -->",
        "```yaml",
        "validator_wave_completed:",
        '  batch_id: "b1"',
        // implementation_commit names the control-plane sha so the helper
        // matches it against the committed Builder attempt's commit_sha
        `  implementation_commit: "${RUNBOOK_HEAL_CONTROL_PLANE_SHA}"`,
        '  attempt_lane: "builder_attempts"',
        "  personas:",
        '    - "compound-engineering:ce-correctness-reviewer"',
        '    - "compound-engineering:ce-testing-reviewer"',
        '    - "compound-engineering:ce-maintainability-reviewer"',
        '    - "compound-engineering:ce-project-standards-reviewer"',
        '    - "compound-engineering:ce-adversarial-reviewer"',
        "  dispatch_evidence:",
        '    role: "validator"',
        // target_id's commit is a DIFFERENT reachable sha, so the inner
        // equality check fires (rather than the outer key-lookup miss).
        `    target_id: "b1@${RUNBOOK_HEAL_DELIVERABLE_SHA}"`,
        '    cli_route_id: "packet.validator"',
        '  outcome: "clean"',
        "  findings: []",
        "```",
        "",
      ],
    );

    expect(() =>
      withFailMode("throw", () => validateLedgerBatches(ledgerPath)),
    ).toThrow(
      /dispatch_evidence\.target_id commit does not match implementation_commit/,
    );
  });
});

function baseRunbookHealFinding(
  overrides: Partial<{ batch_id: string; resolution: string }> = {},
): {
  id: string;
  batch_id: string;
  signature: string;
  persona: string;
  severity: string;
  status: string;
  summary: string;
  resolution: string;
} {
  return {
    id: "fr-1",
    batch_id: overrides.batch_id ?? "final",
    signature: "runbook-heal-form",
    persona: "ce-correctness",
    severity: "P1",
    status: "fixed",
    summary: "final-review finding fixed by an orchestrator runbook-heal",
    resolution: overrides.resolution ?? `runbook-heal ${RUNBOOK_HEAL_CONTROL_PLANE_SHA}`,
  };
}

describe("validateFindingResolution: runbook-heal closure form", () => {
  test("AC1 ACCEPT: batch_id:final fixed by runbook-heal on a control-plane-only commit", () => {
    expect(() =>
      runFindingsFixture(
        baseRunbookHealFinding({
          resolution: `runbook-heal ${RUNBOOK_HEAL_CONTROL_PLANE_SHA}`,
        }),
      ),
    ).not.toThrow();
  });

  test("AC2 REJECT deliverable: runbook-heal on a commit touching a deliverable path names the path", () => {
    expect(() =>
      runFindingsFixture(
        baseRunbookHealFinding({
          resolution: `runbook-heal ${RUNBOOK_HEAL_DELIVERABLE_SHA}`,
        }),
      ),
    ).toThrow(/docs\/scratch\/hello-world\.md/);
  });

  test("AC2 REJECT mixed: runbook-heal on a control-plane+deliverable commit names the offending path", () => {
    expect(() =>
      runFindingsFixture(
        baseRunbookHealFinding({
          resolution: `runbook-heal ${RUNBOOK_HEAL_MIXED_SHA}`,
        }),
      ),
    ).toThrow(/docs\/runbooks\/issue-to-pr-skill-parity-audit\/stop-conditions-ledger\.md/);
  });

  test("AC2 REJECT ledger path: runbook-heal on a commit touching docs/runbooks/issue-to-pr/ rejects", () => {
    expect(() =>
      runFindingsFixture(
        baseRunbookHealFinding({
          resolution: `runbook-heal ${RUNBOOK_HEAL_LEDGER_PATH_SHA}`,
        }),
      ),
    ).toThrow(/docs\/runbooks\/issue-to-pr\/issue-71-ledger\.md/);
  });

  test("AC1/AC2 REJECT merge commit: runbook-heal on dc6868a fails by explicit merge guard", () => {
    expect(() =>
      runFindingsFixture(
        baseRunbookHealFinding({
          resolution: `runbook-heal ${RUNBOOK_HEAL_MERGE_COMMIT_SHA}`,
        }),
      ),
    ).toThrow(/merge commit/);
  });

  test("REJECT unreachable: runbook-heal on a nonexistent 40-hex sha fails", () => {
    const missing = "0".repeat(40);
    expect(() =>
      runFindingsFixture(
        baseRunbookHealFinding({ resolution: `runbook-heal ${missing}` }),
      ),
    ).toThrow();
  });

  test("REJECT bad grammar: runbook-heal with no sha falls through to the catch-all reject", () => {
    expect(() =>
      runFindingsFixture(baseRunbookHealFinding({ resolution: "runbook-heal" })),
    ).toThrow(/fixed resolution must be/);
  });

  test("REJECT bad grammar: runbook-heal with a non-hex token falls through to the catch-all reject", () => {
    expect(() =>
      runFindingsFixture(
        baseRunbookHealFinding({ resolution: "runbook-heal zzzzzzz" }),
      ),
    ).toThrow(/fixed resolution must be/);
  });

  test("REJECT stage-3 scope: a stage-3 finding with runbook-heal must still require plan-revision", () => {
    expect(() =>
      runFindingsFixture(
        baseRunbookHealFinding({
          batch_id: "stage-3",
          resolution: `runbook-heal ${RUNBOOK_HEAL_CONTROL_PLANE_SHA}`,
        }),
      ),
    ).toThrow(/Stage 3 fixed resolution must be "plan-revision <sha>"/);
  });

  test("REJECT batch-loop scope: a batch-loop (non-final) finding with runbook-heal falls through to the catch-all reject", () => {
    expect(() =>
      runFindingsFixture(
        baseRunbookHealFinding({
          batch_id: "b1",
          resolution: `runbook-heal ${RUNBOOK_HEAL_CONTROL_PLANE_SHA}`,
        }),
        terminalBatchRecording(
          RUNBOOK_HEAL_CONTROL_PLANE_SHA,
          RUNBOOK_HEAL_CONTROL_PLANE_FILES,
        ),
      ),
    ).toThrow(/fixed resolution must be/);
  });

  test("NON-REGRESSION: a terminal-batch commit closure still validates", () => {
    expect(() =>
      runFindingsFixture(
        baseRunbookHealFinding({
          resolution: `commit ${RUNBOOK_HEAL_CONTROL_PLANE_SHA}`,
        }),
        terminalBatchRecording(
          RUNBOOK_HEAL_CONTROL_PLANE_SHA,
          RUNBOOK_HEAL_CONTROL_PLANE_FILES,
        ),
      ),
    ).not.toThrow();
  });

  test("accepts terminal inline-attempt commits as fixed finding resolutions", () => {
    expect(() =>
      runFindingsFixture(
        baseRunbookHealFinding({
          resolution: `commit ${RUNBOOK_HEAL_CONTROL_PLANE_SHA}`,
        }),
        terminalInlineBatchRecording(
          RUNBOOK_HEAL_CONTROL_PLANE_SHA,
          RUNBOOK_HEAL_CONTROL_PLANE_FILES,
        ),
      ),
    ).not.toThrow();
  });

  test("NON-REGRESSION: a stage-3 plan-revision closure still validates", () => {
    expect(() =>
      runFindingsFixture(
        baseRunbookHealFinding({
          batch_id: "stage-3",
          resolution: `plan-revision ${RUNBOOK_HEAL_CONTROL_PLANE_SHA}`,
        }),
      ),
    ).not.toThrow();
  });
});

// ---------------- runbook-heal mode-only / no-op content guard (vw-007) ------
//
// vw-002 closed the zero-touched-file vacuous pass, but a runbook-heal commit
// whose ONLY change is a mode-bit flip (chmod) still emits a touched path under
// the control-plane allowlist and would pass vacuously — proving no content
// change, the same abuse class narrowed to the per-file level.
// `rawDiffHasContentBearingChange` parses `git diff-tree --raw` output and
// returns false ONLY when every entry is a pure mode-only `M` (identical blob
// SHAs); `validateControlPlaneOnlyCommit` rejects such commits.
//
// HERMETICITY NOTE: the full end-to-end reject (a runbook-heal finding citing a
// reachable mode-only control-plane commit, run through validateFindingsData)
// cannot be exercised hermetically: no mode-only or type-change commit exists
// anywhere in this branch's history reachable from HEAD (verified by scanning
// `git diff-tree --raw` over `git rev-list HEAD`), and validateReachableCommit
// requires `--is-ancestor <ref> HEAD`, so a dangling commit-tree object would
// fail reachability — and fabricating a reachable one would advance a branch
// ref and pollute history. The content-detection logic is therefore pinned at
// the parser seam with the exact byte format git emits for each change kind
// (captured from `git diff-tree --no-commit-id --raw -r --root -M`). The
// merge-commit test (RUNBOOK_HEAL_MERGE_COMMIT_SHA) still covers the
// end-to-end reject for a reachable commit whose default diff is empty.
describe("rawDiffHasContentBearingChange: mode-only vacuous-proof guard", () => {
  // ":<oldmode> <newmode> <oldsha> <newsha> <STATUS>\t<path...>" — exactly what
  // `git diff-tree --no-commit-id --raw -r --root -M <sha>` prints.
  const SHA_A = "e5c5c5583f49a34e86ce622b59363df99e09d4c6";
  const SHA_B = "85025d98693fe77b700bcf818dfd8fcd13c4e961";
  const ZERO = "0".repeat(40);

  test("REJECT mode-only: a pure chmod `M` (identical blob SHAs) is NOT content-bearing", () => {
    const raw = `:100644 100755 ${SHA_A} ${SHA_A} M\trunbooks/issue-to-pr-v2/issue-to-pr.md`;
    expect(rawDiffHasContentBearingChange(raw)).toBe(false);
  });

  test("REJECT no-op: an empty raw block is NOT content-bearing", () => {
    expect(rawDiffHasContentBearingChange("")).toBe(false);
    expect(rawDiffHasContentBearingChange("\n  \n")).toBe(false);
  });

  test("REJECT all-mode-only: every entry a chmod still rejects", () => {
    const raw = [
      `:100644 100755 ${SHA_A} ${SHA_A} M\trunbooks/issue-to-pr-v2/a.md`,
      `:100644 100755 ${SHA_B} ${SHA_B} M\trunbooks/issue-to-pr-v2/b.md`,
    ].join("\n");
    expect(rawDiffHasContentBearingChange(raw)).toBe(false);
  });

  test("ACCEPT modify: an `M` with differing blob SHAs is content-bearing", () => {
    const raw = `:100644 100644 ${SHA_A} ${SHA_B} M\trunbooks/issue-to-pr-v2/issue-to-pr.md`;
    expect(rawDiffHasContentBearingChange(raw)).toBe(true);
  });

  test("ACCEPT binary modify: an `M` with differing SHAs (numstat would show `-`) is content-bearing", () => {
    const raw = `:100644 100644 ${SHA_A} ${SHA_B} M\trunbooks/issue-to-pr-v2/asset.bin`;
    expect(rawDiffHasContentBearingChange(raw)).toBe(true);
  });

  test("ACCEPT add: an `A` entry (old SHA all-zero) is content-bearing", () => {
    const raw = `:000000 100644 ${ZERO} ${SHA_A} A\trunbooks/issue-to-pr-v2/new.md`;
    expect(rawDiffHasContentBearingChange(raw)).toBe(true);
  });

  test("ACCEPT delete: a `D` entry (new SHA all-zero) is content-bearing", () => {
    const raw = `:100644 000000 ${SHA_A} ${ZERO} D\trunbooks/issue-to-pr-v2/stale.md`;
    expect(rawDiffHasContentBearingChange(raw)).toBe(true);
  });

  test("ACCEPT pure rename: an `R100` entry keeps identical SHAs but the STATUS letter makes it content-bearing", () => {
    const raw = `:100644 100644 ${SHA_A} ${SHA_A} R100\trunbooks/issue-to-pr-v2/old.md\trunbooks/issue-to-pr-v2/new.md`;
    expect(rawDiffHasContentBearingChange(raw)).toBe(true);
  });

  test("ACCEPT type-change: a `T` entry (file→symlink) is content-bearing", () => {
    const raw = `:100644 120000 ${SHA_A} ${SHA_B} T\trunbooks/issue-to-pr-v2/link`;
    expect(rawDiffHasContentBearingChange(raw)).toBe(true);
  });

  test("ACCEPT mixed: a chmod alongside a real modify is content-bearing", () => {
    const raw = [
      `:100644 100755 ${SHA_A} ${SHA_A} M\trunbooks/issue-to-pr-v2/chmod-only.md`,
      `:100644 100644 ${SHA_A} ${SHA_B} M\trunbooks/issue-to-pr-v2/real-edit.md`,
    ].join("\n");
    expect(rawDiffHasContentBearingChange(raw)).toBe(true);
  });
});

// ---------------- validateWorkflowLearnings: AC 3 + AC 5 ----------------

/**
 * Build a minimal ledger that either omits `## Workflow Learnings` entirely
 * (when `sectionBodyLines` is `null`) or appends it after a minimal
 * `## Notes` section (when an array is passed). The body lines are written
 * verbatim, so callers control whether the section contains a fenced yaml
 * block, multiple blocks, prose only, etc.
 */
function writeLedgerWithWorkflowLearnings(
  sectionBodyLines: string[] | null,
): string {
  const body = [
    "## Notes",
    "",
    "<notes here>",
    "",
  ];
  if (sectionBodyLines !== null) {
    body.push("## Workflow Learnings", "", ...sectionBodyLines, "");
  }
  return writeLedgerWithFrontmatter([], body);
}

describe("validateWorkflowLearnings (in-process via withFailMode)", () => {
  test("happy path: accepts an empty workflow_learnings: [] block", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings: []",
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).not.toThrow();
  });

  test("happy path: accepts one valid entry with required fields", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - signature: "sha256:abc123"',
      '    affected_surface: "cli-observability"',
      '    what_was_wrong: "the gate did not surface the missing field"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).not.toThrow();
  });

  test("happy path: accepts multiple entries, one fully populated and one minimal", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - signature: "sha256:full-entry"',
      '    affected_surface: "runbook-reference"',
      '    what_was_wrong: "reference was ambiguous"',
      '    discovery_method: "operator review"',
      '    root_cause: "missing example"',
      '    scope: "all stage-3 runs"',
      '    proposed_fix: "add canonical example"',
      '    verification_idea: "follow-up run reads cleanly"',
      '  - signature: "sha256:minimal-entry"',
      '    affected_surface: "gotchas-guide"',
      '    what_was_wrong: "noted but not yet diagnosed"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).not.toThrow();
  });

  test("fails when the ledger has no '## Workflow Learnings' section", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings(null);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/no '## Workflow Learnings' section/);
  });

  test("fails when the section has no fenced yaml block", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "Only prose lives here, no fenced block at all.",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/no fenced yaml block/);
  });

  test("fails when the section has multiple fenced yaml blocks", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings: []",
      "```",
      "",
      "Intervening prose.",
      "",
      "```yaml",
      "workflow_learnings: []",
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/multiple fenced yaml blocks/);
  });

  test("fails when the yaml block does not parse", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      "  - signature: : : nope",
      "    : also bad",
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/did not parse|yaml/i);
  });

  test("fails when the parsed yaml has no workflow_learnings key", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "something_else: []",
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/workflow_learnings.*array|no "workflow_learnings"/);
  });

  test("fails when workflow_learnings is not an array (mapping instead)", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      "  signature: nope",
      "  affected_surface: nope",
      "  what_was_wrong: nope",
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/workflow_learnings.*array/);
  });

  test("fails when an entry is a scalar instead of a mapping", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - "not-a-mapping-just-a-string"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/entry.*mapping|#1/);
  });

  test("fails when an entry is missing signature", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - affected_surface: "cli-observability"',
      '    what_was_wrong: "missing field surfaced late"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/signature/);
  });

  test("fails when an entry is missing affected_surface", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - signature: "sha256:no-surface"',
      '    what_was_wrong: "missing surface"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/affected_surface/);
  });

  test("fails when an entry is missing what_was_wrong", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - signature: "sha256:no-observation"',
      '    affected_surface: "cli-observability"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/what_was_wrong/);
  });

  test("fails when signature is an empty string", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - signature: ""',
      '    affected_surface: "cli-observability"',
      '    what_was_wrong: "blank signature"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/signature/);
  });

  test("fails when signature is whitespace-only", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - signature: "   "',
      '    affected_surface: "cli-observability"',
      '    what_was_wrong: "whitespace-only signature"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/signature/);
  });

  test("fails when a canonical field 'summary' is present on a ledger entry", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - signature: "sha256:has-summary"',
      '    affected_surface: "cli-observability"',
      '    what_was_wrong: "leaked canonical field"',
      '    summary: "should not be here"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/unknown field "summary"|summary/);
  });

  test("fails when a canonical field 'owner' is present on a ledger entry", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - signature: "sha256:has-owner"',
      '    affected_surface: "cli-observability"',
      '    what_was_wrong: "leaked canonical field"',
      '    owner: "runbook-reference"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/unknown field "owner"|owner/);
  });

  test("fails when a lifecycle field 'disposition' is present on a ledger entry", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - signature: "sha256:has-disposition"',
      '    affected_surface: "cli-observability"',
      '    what_was_wrong: "leaked lifecycle field"',
      '    disposition: "small-fix"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/unknown field "disposition"|disposition/);
  });

  test("fails on a generic unknown key", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - signature: "sha256:garbage"',
      '    affected_surface: "cli-observability"',
      '    what_was_wrong: "garbage key present"',
      '    garbage_key: "boom"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/unknown field "garbage_key"|garbage_key/);
  });

  test("entry-labeling: error message includes the signature when present", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - signature: "sha256:identified-entry"',
      '    affected_surface: "cli-observability"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/sha256:identified-entry/);
  });

  test("entry-labeling: error message includes #1 (1-based index) when signature is absent", () => {
    const ledgerPath = writeLedgerWithWorkflowLearnings([
      "```yaml",
      "workflow_learnings:",
      '  - affected_surface: "cli-observability"',
      "```",
    ]);
    expect(() =>
      withFailMode("throw", () => validateWorkflowLearnings(ledgerPath)),
    ).toThrow(/#1/);
  });
});
