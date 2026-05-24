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
  loadCandidate,
  parseRegistry,
  validateCandidate,
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

  test("does not truncate the block when a string value contains an inline triple-backtick fence", () => {
    // A learning whose string field legitimately references a fenced code
    // block (this very issue is about yaml fences). The inline ``` must NOT
    // close the surrounding markdown fence; the whole block must round-trip.
    const yamlBody =
      "learnings:\n" +
      "  - summary: |\n" +
      "      Parser truncates on inline fences. Repro:\n" +
      "      ```yaml\n" +
      "      learnings: []\n" +
      "      ```\n" +
      '  - signature: "sha256:after-the-fence"\n';
    const path = writeRegistry(registryDoc(yamlBody));
    const registry = parseRegistry(path);
    expect(Array.isArray(registry.learnings)).toBe(true);
    expect(registry.learnings).toHaveLength(2);
    const second = registry.learnings[1] as { signature?: string };
    expect(second.signature).toBe("sha256:after-the-fence");
    const first = registry.learnings[0] as { summary?: string };
    expect(first.summary).toContain("```yaml");
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

/**
 * Candidate-file ingestion + candidate-shape validation (issue #90, AC4).
 *
 * A candidate is one incoming learning observation to be upserted later. Its
 * shape mirrors a registry entry plus an OPTIONAL `canonical_update` marker,
 * but it carries the SINGLE run's evidence as one `evidence` record object
 * (the upsert-op batch appends that record to the entry's `evidence` list).
 * `signature` is optional on a candidate (derivation lands in upsert-op).
 */

/** Write a candidate file with the given extension and contents to a temp dir. */
function writeCandidate(filename: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "issue-90-candidate-test-"));
  tempDirs.push(dir);
  const path = join(dir, filename);
  writeFileSync(path, content);
  return path;
}

/** A fully-valid candidate object (used to build JSON and YAML fixtures). */
function validCandidateObject(): Record<string, unknown> {
  return {
    summary: "a one-line learning statement",
    owner: "runbook-reference",
    retirement_condition: "retired when the reference documents the gate",
    signature: "sha256:abc123",
    disposition: "needs-evidence",
    status: "open",
    confidence: "medium",
    follow_up: null,
    canonical_update: false,
    evidence: {
      run: "issue-90",
      affected_surface: "the reference",
      what_was_wrong: "missing gate",
      discovery_method: "observed during run",
      root_cause: "doc gap",
      scope: "single reference",
      proposed_fix: "document the gate",
      verification_idea: "re-read the reference",
    },
  };
}

/** Render a candidate object as a YAML document body. */
function candidateYaml(candidate: Record<string, unknown>): string {
  const ev = candidate.evidence as Record<string, unknown>;
  return [
    `summary: ${JSON.stringify(candidate.summary)}`,
    `owner: ${candidate.owner}`,
    `retirement_condition: ${JSON.stringify(candidate.retirement_condition)}`,
    `signature: ${JSON.stringify(candidate.signature)}`,
    `disposition: ${candidate.disposition}`,
    `status: ${candidate.status}`,
    `confidence: ${candidate.confidence}`,
    `follow_up: ${candidate.follow_up === null ? "null" : JSON.stringify(candidate.follow_up)}`,
    `canonical_update: ${candidate.canonical_update}`,
    "evidence:",
    `  run: ${ev.run}`,
    `  affected_surface: ${JSON.stringify(ev.affected_surface)}`,
    `  what_was_wrong: ${JSON.stringify(ev.what_was_wrong)}`,
    `  discovery_method: ${JSON.stringify(ev.discovery_method)}`,
    `  root_cause: ${JSON.stringify(ev.root_cause)}`,
    `  scope: ${JSON.stringify(ev.scope)}`,
    `  proposed_fix: ${JSON.stringify(ev.proposed_fix)}`,
    `  verification_idea: ${JSON.stringify(ev.verification_idea)}`,
    "",
  ].join("\n");
}

describe("loadCandidate", () => {
  test("loads a valid JSON candidate and validateCandidate returns no errors", () => {
    const candidate = validCandidateObject();
    const path = writeCandidate(
      "candidate.json",
      JSON.stringify(candidate, null, 2),
    );
    const loaded = loadCandidate(path);
    expect(loaded).toEqual(candidate);
    expect(validateCandidate(loaded)).toEqual([]);
  });

  test("loads an equivalent YAML candidate to the SAME structure as JSON (AC4 parity)", () => {
    const candidate = validCandidateObject();
    const jsonPath = writeCandidate(
      "candidate.json",
      JSON.stringify(candidate, null, 2),
    );
    const yamlPath = writeCandidate("candidate.yaml", candidateYaml(candidate));
    const fromJson = loadCandidate(jsonPath);
    const fromYaml = loadCandidate(yamlPath);
    expect(fromYaml).toEqual(fromJson);
    expect(validateCandidate(fromYaml)).toEqual([]);
  });

  test("accepts a .yml extension", () => {
    const candidate = validCandidateObject();
    const path = writeCandidate("candidate.yml", candidateYaml(candidate));
    const loaded = loadCandidate(path);
    expect(validateCandidate(loaded)).toEqual([]);
  });

  test("throws an actionable error naming the file when JSON is malformed", () => {
    const path = writeCandidate("candidate.json", '{ "summary": "x", }');
    expect(() => loadCandidate(path)).toThrow(/candidate\.json/);
  });

  test("throws an actionable error naming the file when YAML is malformed", () => {
    // Bad indentation / broken mapping that YAML cannot parse.
    const path = writeCandidate(
      "candidate.yaml",
      "summary: x\n  owner: : : bad\n\t- nope\n",
    );
    expect(() => loadCandidate(path)).toThrow(/candidate\.yaml/);
  });

  test("throws an actionable error naming the file when it cannot be read", () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), "issue-90-candidate-missing-")),
      "nope.json",
    );
    tempDirs.push(missing);
    expect(() => loadCandidate(missing)).toThrow(/nope\.json/);
  });

  test("throws an actionable error for an unrecognized extension", () => {
    const path = writeCandidate("candidate.txt", "summary: x\n");
    expect(() => loadCandidate(path)).toThrow(/candidate\.txt/);
    expect(() => loadCandidate(path)).toThrow(/\.txt/);
  });
});

describe("validateCandidate", () => {
  test("rejects a candidate with a bad enum value, naming the field and allowed set", () => {
    const candidate = validCandidateObject();
    candidate.disposition = "totally-bogus";
    const errors = validateCandidate(candidate);
    expect(errors.some((e) => /disposition/.test(e))).toBe(true);
    const dispositionError = errors.find((e) => /disposition/.test(e));
    expect(dispositionError).toMatch(/totally-bogus/);
    for (const allowed of DISPOSITIONS) {
      expect(dispositionError).toContain(allowed);
    }
  });

  test("rejects a candidate missing a required field, naming the field", () => {
    const candidate = validCandidateObject();
    delete candidate.summary;
    const errors = validateCandidate(candidate);
    expect(errors.some((e) => /summary/.test(e))).toBe(true);
  });

  test("rejects a candidate missing the evidence record, naming the field", () => {
    const candidate = validCandidateObject();
    delete candidate.evidence;
    const errors = validateCandidate(candidate);
    expect(errors.some((e) => /evidence/.test(e))).toBe(true);
  });

  test("accepts a candidate without a signature (derivation is upsert-op)", () => {
    const candidate = validCandidateObject();
    delete candidate.signature;
    expect(validateCandidate(candidate)).toEqual([]);
  });

  test("rejects an empty-string signature when present", () => {
    const candidate = validCandidateObject();
    candidate.signature = "";
    const errors = validateCandidate(candidate);
    expect(errors.some((e) => /signature/.test(e))).toBe(true);
  });

  test("accepts a candidate without canonical_update", () => {
    const candidate = validCandidateObject();
    delete candidate.canonical_update;
    expect(validateCandidate(candidate)).toEqual([]);
  });

  test("rejects a non-boolean canonical_update", () => {
    const candidate = validCandidateObject();
    candidate.canonical_update = "yes";
    const errors = validateCandidate(candidate);
    expect(errors.some((e) => /canonical_update/.test(e))).toBe(true);
  });

  test("rejects a candidate that is not an object (null / array / string)", () => {
    expect(validateCandidate(null).length).toBeGreaterThan(0);
    expect(validateCandidate([]).length).toBeGreaterThan(0);
    expect(validateCandidate("nope").length).toBeGreaterThan(0);
  });
});
