import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";

import {
  CONFIDENCES,
  DISPOSITIONS,
  OWNERS,
  STATUSES,
  parseRegistry,
  validateRegistry,
} from "./learnings";

/**
 * Module-level tests for `lib/learnings.ts` (issue #90, AC2).
 *
 * Pins the registry parse + schema-validation surface: `parseRegistry`
 * extracts the single fenced yaml block (mirroring `lib/ledger.ts`) and
 * `validateRegistry` enforces required fields and the four closed enums
 * (owner, disposition, status, confidence). The dispatcher exit-code path
 * is exercised by spawning `learnings-registry.ts --validate`.
 *
 * Candidate ingestion, upsert/dedupe, canonical protection, and write-scope
 * enforcement are out of scope for this batch and tested in later batches.
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

function writeRegistry(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "issue-90-learnings-test-"));
  tempDirs.push(dir);
  const path = join(dir, "registry.md");
  writeFileSync(path, content);
  return path;
}

/** Wrap a yaml body in a markdown registry doc with one fenced yaml block. */
function registryDoc(yamlBody: string): string {
  return `# Workflow Learnings registry\n\nProse describing the schema.\n\n\`\`\`yaml\n${yamlBody}\n\`\`\`\n`;
}

/** A fully-valid single learning entry as yaml, with the field overridden. */
function validEntryYaml(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    summary: '"a one-line learning statement"',
    owner: "runbook-reference",
    retirement_condition: '"retired when the reference documents the gate"',
    signature: '"sha256:abc123"',
    disposition: "needs-evidence",
    status: "open",
    confidence: "medium",
    follow_up: "null",
    ...overrides,
  };
  const evidence =
    "    evidence:\n" +
    "      - run: issue-90\n" +
    '        affected_surface: "the reference"\n' +
    '        what_was_wrong: "missing gate"\n' +
    '        discovery_method: "observed during run"\n' +
    '        root_cause: "doc gap"\n' +
    '        scope: "single reference"\n' +
    '        proposed_fix: "document the gate"\n' +
    '        verification_idea: "re-read the reference"\n';
  const lines = Object.entries(fields).map(([key, value], index) => {
    const prefix = index === 0 ? "  - " : "    ";
    return `${prefix}${key}: ${value}`;
  });
  return `learnings:\n${lines.join("\n")}\n${evidence}`;
}

const realRegistryPath = join(
  import.meta.dir,
  "..",
  "references",
  "workflow-learnings-registry.md",
);

describe("parseRegistry", () => {
  test("extracts the single fenced yaml block and returns the learnings array", () => {
    const path = writeRegistry(registryDoc("learnings: []"));
    const registry = parseRegistry(path);
    expect(Array.isArray(registry.learnings)).toBe(true);
    expect(registry.learnings).toHaveLength(0);
  });

  test("parses the committed seeded registry doc (learnings: [])", () => {
    const registry = parseRegistry(realRegistryPath);
    expect(Array.isArray(registry.learnings)).toBe(true);
    expect(registry.learnings).toHaveLength(0);
  });

  test("throws an actionable error naming the file when it is unreadable", () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), "issue-90-missing-")),
      "nope.md",
    );
    expect(() => parseRegistry(missing)).toThrow(/nope\.md/);
  });

  test("throws an actionable error when there is no fenced yaml block", () => {
    const path = writeRegistry("# Registry\n\nNo yaml here at all.\n");
    expect(() => parseRegistry(path)).toThrow(/no fenced yaml block/i);
    expect(() => parseRegistry(path)).toThrow(/registry\.md/);
  });

  test("throws an actionable error when there is more than one fenced yaml block", () => {
    const path = writeRegistry(
      `${registryDoc("learnings: []")}\n\`\`\`yaml\nlearnings: []\n\`\`\`\n`,
    );
    expect(() => parseRegistry(path)).toThrow(/single fenced yaml block/i);
    expect(() => parseRegistry(path)).toThrow(/registry\.md/);
  });

  test("throws an actionable error when the parsed shape has no learnings array", () => {
    const path = writeRegistry(registryDoc("not_learnings: []"));
    expect(() => parseRegistry(path)).toThrow(/learnings/);
  });
});

describe("validateRegistry", () => {
  test("accepts a well-formed entry with no errors", () => {
    const path = writeRegistry(registryDoc(validEntryYaml()));
    const errors = validateRegistry(parseRegistry(path));
    expect(errors).toEqual([]);
  });

  test("accepts the seeded empty registry (learnings: []) with no errors", () => {
    const errors = validateRegistry(parseRegistry(realRegistryPath));
    expect(errors).toEqual([]);
  });

  test("rejects an entry missing a required field, naming the field and entry", () => {
    const yamlBody = validEntryYaml().replace(
      /^ {2}- summary: .*\n/m,
      "  - owner: runbook-reference\n",
    );
    const path = writeRegistry(registryDoc(yamlBody));
    const errors = validateRegistry(parseRegistry(path));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/summary/);
    // Falls back to index when signature is present but field-naming still holds.
    expect(errors[0]).toMatch(/missing required field/i);
  });

  test("rejects a disposition outside the allowed set with an actionable error", () => {
    const path = writeRegistry(
      registryDoc(validEntryYaml({ disposition: "totally-bogus" })),
    );
    const errors = validateRegistry(parseRegistry(path));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/disposition/);
    expect(errors[0]).toMatch(/totally-bogus/);
    for (const allowed of DISPOSITIONS) {
      expect(errors[0]).toContain(allowed);
    }
  });

  test("rejects a status outside the allowed set with an actionable error", () => {
    const path = writeRegistry(
      registryDoc(validEntryYaml({ status: "halfway" })),
    );
    const errors = validateRegistry(parseRegistry(path));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/status/);
    expect(errors[0]).toMatch(/halfway/);
    for (const allowed of STATUSES) {
      expect(errors[0]).toContain(allowed);
    }
  });

  test("rejects an owner outside the allowed set with an actionable error", () => {
    const path = writeRegistry(
      registryDoc(validEntryYaml({ owner: "mystery-surface" })),
    );
    const errors = validateRegistry(parseRegistry(path));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/owner/);
    expect(errors[0]).toMatch(/mystery-surface/);
    for (const allowed of OWNERS) {
      expect(errors[0]).toContain(allowed);
    }
  });

  test("rejects a confidence outside the allowed set with an actionable error", () => {
    const path = writeRegistry(
      registryDoc(validEntryYaml({ confidence: "certain" })),
    );
    const errors = validateRegistry(parseRegistry(path));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/confidence/);
    expect(errors[0]).toMatch(/certain/);
    for (const allowed of CONFIDENCES) {
      expect(errors[0]).toContain(allowed);
    }
  });

  test("names the entry by signature in the error", () => {
    const path = writeRegistry(
      registryDoc(validEntryYaml({ status: "halfway" })),
    );
    const errors = validateRegistry(parseRegistry(path));
    expect(errors[0]).toContain("sha256:abc123");
  });
});

const scriptPath = join(import.meta.dir, "..", "learnings-registry.ts");
const bunExecutable = execPath || "bun";

async function runValidate(args: string[]) {
  const proc = Bun.spawn([bunExecutable, scriptPath, ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

describe("learnings-registry.ts --validate", () => {
  test("exits 0 and prints OK for the seeded valid registry", async () => {
    const result = await runValidate(["--validate", realRegistryPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/ok/i);
  });

  test("exits non-zero and surfaces the actionable error for a bad enum", async () => {
    const path = writeRegistry(
      registryDoc(validEntryYaml({ disposition: "totally-bogus" })),
    );
    const result = await runValidate(["--validate", path]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/disposition/);
    expect(result.stderr).toMatch(/totally-bogus/);
  });

  test("fails with a usage error for an unknown flag", async () => {
    const result = await runValidate(["--bogus"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/usage/i);
  });

  test("fails with a usage error when --validate has no path", async () => {
    const result = await runValidate(["--validate"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/usage/i);
  });
});
