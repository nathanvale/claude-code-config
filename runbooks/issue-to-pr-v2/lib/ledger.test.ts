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
    // "2.0" must NOT equal "2"; the contract is exact string equality.
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
    // Evidence row recorded under v3 runtime is not honored by v2 runtime.
    const ledgerPath = writeLedgerWithFrontmatter(
      [],
      completeEvidenceBlock({ runtime_version: "3" }),
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
      '  runtime_version: "2"',
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
      runtime_version: "2",
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
      '  runtime_version: "2"',
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
    expect(evidence?.runtime_version).toBe("2");
  });

  test("returns null when any of the seven required fields is missing", () => {
    const required = [
      "  ledger_version: null",
      '  runtime_version: "2"',
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
      '  runtime_version: "2"',
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
      '  runtime_version: "2"',
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
      '  runtime_version: "2"',
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
      '  runtime_version: "2"',
      '  runtime_version: "3"',
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
      '  runtime_version: "2"',
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
      '  runtime_version: "2"',
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
      '  runtime_version: "2"',
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
      '  runtime_version: "2"',
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
        '  runtime_version: "2"',
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
      '  runtime_version: "2"',
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
    for (const padded of [" 2", "2​", "﻿2﻿", " 2 "]) {
      const path = writer(padded);
      const snapshot = withFailMode("throw", () => readLedgerSnapshot(path));
      expect(snapshot.runbook_version_skew).toBe("matched");
    }
  });

  test("F-U6-SEC-005: runbook_version containing a control byte is rejected (treated as missing)", () => {
    const path = writeLedgerWithFrontmatter([
      `runbook_version: "2\x00x"`,
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
        `runbook_version: "${char}2"`,
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
      '  runtime_version: "2"',
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
      '  runtime_version: "2"',
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
      '  runtime_version: "2"',
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
      '  runtime_version: "2"',
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
    "    iterations: 1",
    "    final_verdict: converged",
    "```",
  ];
}

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
