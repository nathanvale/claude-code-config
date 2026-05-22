import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DecomposeError, parse } from "./ledger";

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
