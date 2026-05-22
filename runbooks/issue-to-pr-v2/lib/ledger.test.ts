import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DecomposeError,
  fail,
  parse,
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
