import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  serializeRegistry,
  signatureFor,
  upsert,
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
    const dir = mkdtempSync(join(tmpdir(), "issue-90-candidate-missing-"));
    tempDirs.push(dir);
    const missing = join(dir, "nope.json");
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

  test("rejects a candidate whose evidence omits an identifying field used for signature derivation", () => {
    for (const field of ["run", "affected_surface", "what_was_wrong"] as const) {
      const candidate = validCandidateObject();
      delete (candidate.evidence as Record<string, unknown>)[field];
      const errors = validateCandidate(candidate);
      expect(errors.some((e) => e.includes(`evidence field "${field}"`))).toBe(
        true,
      );
    }
  });

  test("rejects a candidate whose identifying evidence fields are present but empty", () => {
    for (const field of ["run", "affected_surface", "what_was_wrong"] as const) {
      const candidate = validCandidateObject();
      (candidate.evidence as Record<string, unknown>)[field] = "";
      const errors = validateCandidate(candidate);
      expect(errors.some((e) => e.includes(`evidence field "${field}"`))).toBe(
        true,
      );
    }
  });
});

/**
 * Signature derivation + upsert + serialize tests (issue #90, AC3, AC2).
 *
 * `signatureFor` returns the candidate's explicit `signature` when present,
 * otherwise it derives one deterministically from the candidate's identifying
 * fields (`affected_surface`, `what_was_wrong`, `owner`). `upsert` is a pure
 * function: it appends a new entry for a non-matching signature, or merges
 * evidence + lifecycle into the matched entry while protecting canonical
 * fields unless the candidate sets `canonical_update: true`.
 * `serializeRegistry` replaces ONLY the fenced yaml block of the existing
 * registry Markdown and preserves the surrounding prose verbatim, so the
 * doc round-trips through parseRegistry/validateRegistry without loss.
 */

describe("signatureFor", () => {
  test("returns the explicit signature when present", () => {
    const candidate = validCandidateObject();
    candidate.signature = "sha256:explicit";
    expect(signatureFor(candidate)).toBe("sha256:explicit");
  });

  test("derives a stable sha256 signature when none is provided", () => {
    const candidate = validCandidateObject();
    delete candidate.signature;
    const sig = signatureFor(candidate);
    expect(sig).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("derives the same signature for two candidates with identical identifying fields", () => {
    const a = validCandidateObject();
    const b = validCandidateObject();
    delete a.signature;
    delete b.signature;
    // Lifecycle differences must not affect the derived signature.
    b.status = "filed";
    b.disposition = "small-fix";
    expect(signatureFor(a)).toBe(signatureFor(b));
  });

  test("derives different signatures when an identifying field differs", () => {
    const a = validCandidateObject();
    const b = validCandidateObject();
    delete a.signature;
    delete b.signature;
    (b.evidence as Record<string, unknown>).what_was_wrong = "different gap";
    expect(signatureFor(a)).not.toBe(signatureFor(b));
  });

  test("treats an empty-string signature as missing and derives one", () => {
    const candidate = validCandidateObject();
    candidate.signature = "";
    const sig = signatureFor(candidate);
    expect(sig).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("throws when an identifying evidence field is missing or empty (programmatic-caller guard)", () => {
    for (const field of ["affected_surface", "what_was_wrong"] as const) {
      const missing = validCandidateObject();
      delete missing.signature;
      delete (missing.evidence as Record<string, unknown>)[field];
      expect(() => signatureFor(missing)).toThrow(/non-empty strings/);

      const empty = validCandidateObject();
      delete empty.signature;
      (empty.evidence as Record<string, unknown>)[field] = "";
      expect(() => signatureFor(empty)).toThrow(/non-empty strings/);
    }
  });

  test("throws when owner is missing or empty (programmatic-caller guard)", () => {
    const candidate = validCandidateObject();
    delete candidate.signature;
    candidate.owner = "";
    expect(() => signatureFor(candidate)).toThrow(/non-empty strings/);
  });
});

describe("upsert", () => {
  test("appends a new entry when no existing signature matches", () => {
    const registry = { learnings: [] };
    const candidate = validCandidateObject();
    candidate.signature = "sha256:new-entry";
    const next = upsert(registry, candidate);
    expect(next.learnings).toHaveLength(1);
    const entry = next.learnings[0] as Record<string, unknown>;
    expect(entry.signature).toBe("sha256:new-entry");
    expect(entry.summary).toBe(candidate.summary);
    expect(entry.owner).toBe(candidate.owner);
    // Candidate's evidence record is wrapped to a single-item evidence list.
    expect(Array.isArray(entry.evidence)).toBe(true);
    expect((entry.evidence as unknown[])[0]).toEqual(
      candidate.evidence as Record<string, unknown>,
    );
    // The candidate's per-upsert directive must NOT be stored on the entry.
    expect(entry.canonical_update).toBeUndefined();
  });

  test("does not mutate the input registry (immutable-style)", () => {
    const registry = { learnings: [] as unknown[] };
    const candidate = validCandidateObject();
    upsert(registry, candidate);
    expect(registry.learnings).toHaveLength(0);
  });

  test("appends evidence to the matched entry when signature matches (dedupe)", () => {
    const first = validCandidateObject();
    first.signature = "sha256:dedupe";
    let registry = upsert({ learnings: [] }, first);

    const second = validCandidateObject();
    second.signature = "sha256:dedupe";
    (second.evidence as Record<string, unknown>).run = "issue-91";
    (second.evidence as Record<string, unknown>).what_was_wrong = "still missing";
    registry = upsert(registry, second);

    expect(registry.learnings).toHaveLength(1);
    const entry = registry.learnings[0] as Record<string, unknown>;
    const evidence = entry.evidence as Array<Record<string, unknown>>;
    expect(evidence).toHaveLength(2);
    // Order preserved: first observation first.
    expect(evidence[0].run).toBe("issue-90");
    expect(evidence[1].run).toBe("issue-91");
  });

  test("updates lifecycle fields on a matched entry", () => {
    const first = validCandidateObject();
    first.signature = "sha256:lifecycle";
    let registry = upsert({ learnings: [] }, first);

    const second = validCandidateObject();
    second.signature = "sha256:lifecycle";
    second.status = "filed";
    second.disposition = "file-follow-up";
    second.confidence = "high";
    second.follow_up = "https://example.test/issue/123";
    registry = upsert(registry, second);

    const entry = registry.learnings[0] as Record<string, unknown>;
    expect(entry.status).toBe("filed");
    expect(entry.disposition).toBe("file-follow-up");
    expect(entry.confidence).toBe("high");
    expect(entry.follow_up).toBe("https://example.test/issue/123");
  });

  test("protects canonical fields by default (no canonical_update marker)", () => {
    const first = validCandidateObject();
    first.signature = "sha256:canonical";
    first.summary = "original summary";
    first.owner = "runbook-reference";
    first.retirement_condition = "original condition";
    let registry = upsert({ learnings: [] }, first);

    const second = validCandidateObject();
    second.signature = "sha256:canonical";
    second.summary = "DIFFERENT summary";
    second.owner = "cli-observability";
    second.retirement_condition = "DIFFERENT condition";
    second.status = "filed";
    // No canonical_update marker (or explicitly false).
    second.canonical_update = false;
    registry = upsert(registry, second);

    const entry = registry.learnings[0] as Record<string, unknown>;
    // Canonical fields UNCHANGED.
    expect(entry.summary).toBe("original summary");
    expect(entry.owner).toBe("runbook-reference");
    expect(entry.retirement_condition).toBe("original condition");
    // Lifecycle still updated and evidence still appended.
    expect(entry.status).toBe("filed");
    expect((entry.evidence as unknown[]).length).toBe(2);
  });

  test("replaces canonical fields when candidate sets canonical_update: true", () => {
    const first = validCandidateObject();
    first.signature = "sha256:canonical-update";
    first.summary = "original summary";
    first.owner = "runbook-reference";
    first.retirement_condition = "original condition";
    let registry = upsert({ learnings: [] }, first);

    const second = validCandidateObject();
    second.signature = "sha256:canonical-update";
    second.summary = "NEW summary";
    second.owner = "cli-observability";
    second.retirement_condition = "NEW condition";
    second.canonical_update = true;
    registry = upsert(registry, second);

    const entry = registry.learnings[0] as Record<string, unknown>;
    expect(entry.summary).toBe("NEW summary");
    expect(entry.owner).toBe("cli-observability");
    expect(entry.retirement_condition).toBe("NEW condition");
    // The per-upsert directive is NOT stored on the entry.
    expect(entry.canonical_update).toBeUndefined();
  });

  test("collides on derived signature when two candidates share identifying fields", () => {
    const a = validCandidateObject();
    delete a.signature;
    const b = validCandidateObject();
    delete b.signature;
    (b.evidence as Record<string, unknown>).run = "issue-91";

    let registry = upsert({ learnings: [] }, a);
    registry = upsert(registry, b);
    expect(registry.learnings).toHaveLength(1);
    const entry = registry.learnings[0] as Record<string, unknown>;
    expect((entry.evidence as unknown[]).length).toBe(2);
  });

  test("throws an actionable error when the candidate is invalid", () => {
    const candidate = validCandidateObject();
    candidate.disposition = "totally-bogus";
    expect(() => upsert({ learnings: [] }, candidate)).toThrow(/disposition/);
  });
});

describe("serializeRegistry", () => {
  test("round-trips: serialize + write + parse + validate produces the same learnings", () => {
    const path = writeRegistry(registryDoc("learnings: []"));
    const first = validCandidateObject();
    first.signature = "sha256:round-trip";
    const registry = upsert(parseRegistry(path), first);
    const updated = serializeRegistry(path, registry);
    writeFileSync(path, updated);
    const reparsed = parseRegistry(path);
    expect(validateRegistry(reparsed)).toEqual([]);
    expect(reparsed.learnings).toHaveLength(1);
    const entry = reparsed.learnings[0] as Record<string, unknown>;
    expect(entry.signature).toBe("sha256:round-trip");
    expect(entry.summary).toBe(first.summary);
    expect((entry.evidence as unknown[]).length).toBe(1);
  });

  test("preserves surrounding prose verbatim (only the yaml block is replaced)", () => {
    const path = writeRegistry(registryDoc("learnings: []"));
    const candidate = validCandidateObject();
    candidate.signature = "sha256:prose";
    const registry = upsert(parseRegistry(path), candidate);
    const updated = serializeRegistry(path, registry);
    // Sentinel prose from registryDoc() must survive intact.
    expect(updated).toContain("Prose describing the schema.");
    expect(updated).toContain("# Workflow Learnings registry");
  });

  test("preserves prose around the real seeded registry doc when upserting", () => {
    // The committed reference doc has extensive prose, a non-yaml `text` fence,
    // and exactly one fenced yaml block. Serialization must touch only the yaml
    // block and leave the rest byte-identical.
    const src = readFileSync(realRegistryPath, "utf8");
    const candidate = validCandidateObject();
    candidate.signature = "sha256:real-doc";
    const registry = upsert(parseRegistry(realRegistryPath), candidate);
    const updated = serializeRegistry(realRegistryPath, registry);
    // Prose sentinels from the real doc.
    expect(updated).toContain("# Workflow Learnings registry");
    expect(updated).toContain("Canonical-overwrite rule");
    expect(updated).toContain("```text");
    // The illustrative `text` fence must not have been touched.
    expect(updated).toContain("affected_surface: \"<surface>\"");
    // Sanity: still parseable + valid.
    const tmpPath = writeRegistry(updated);
    expect(validateRegistry(parseRegistry(tmpPath))).toEqual([]);
    // The original file must NOT have been mutated by serializeRegistry.
    expect(readFileSync(realRegistryPath, "utf8")).toBe(src);
  });

  test("round-trips a value that contains an inline triple-backtick fence (validate-op guard)", () => {
    const path = writeRegistry(registryDoc("learnings: []"));
    const candidate = validCandidateObject();
    candidate.signature = "sha256:fence";
    candidate.summary =
      "Parser truncated on ```yaml fences (repro: ```yaml\\nlearnings: []\\n```)";
    const registry = upsert(parseRegistry(path), candidate);
    const updated = serializeRegistry(path, registry);
    writeFileSync(path, updated);
    const reparsed = parseRegistry(path);
    expect(reparsed.learnings).toHaveLength(1);
    const entry = reparsed.learnings[0] as Record<string, unknown>;
    expect(entry.summary).toBe(candidate.summary);
    expect(validateRegistry(reparsed)).toEqual([]);
  });

  test("round-trips a string scalar that contains a NUL byte (F22: emit-scalar-nul-byte-breaks-yaml-roundtrip)", () => {
    // A candidate value containing U+0000 must survive serialize + write + parse.
    // Before the fix, emitScalar leaves the literal NUL in the double-quoted
    // scalar and Bun.YAML.parse rejects it on re-read.
    const path = writeRegistry(registryDoc("learnings: []"));
    const candidate = validCandidateObject();
    candidate.signature = "sha256:nul-byte";
    candidate.summary = `summary with embedded NUL ${String.fromCharCode(0)} byte`;
    const registry = upsert(parseRegistry(path), candidate);
    const updated = serializeRegistry(path, registry);
    writeFileSync(path, updated);
    // The critical assertion: re-parse does NOT throw.
    const reparsed = parseRegistry(path);
    expect(reparsed.learnings).toHaveLength(1);
    const entry = reparsed.learnings[0] as Record<string, unknown>;
    expect(entry.summary).toBe(candidate.summary);
    expect(validateRegistry(reparsed)).toEqual([]);
  });

  test("round-trips a string scalar that contains assorted C0 control bytes (F22 generalization)", () => {
    // BEL (0x07), backspace (0x08), vertical tab (0x0B), form feed (0x0C),
    // and DEL-area control 0x1F all need escaping for re-parse safety.
    const path = writeRegistry(registryDoc("learnings: []"));
    const candidate = validCandidateObject();
    candidate.signature = "sha256:c0-controls";
    candidate.summary = `controls: ${String.fromCharCode(7)}${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(31)}`;
    const registry = upsert(parseRegistry(path), candidate);
    const updated = serializeRegistry(path, registry);
    writeFileSync(path, updated);
    const reparsed = parseRegistry(path);
    const entry = reparsed.learnings[0] as Record<string, unknown>;
    expect(entry.summary).toBe(candidate.summary);
  });
});

describe("validateRegistry (evidence-key whitelist, F23-extended: registry-side symmetry)", () => {
  test("rejects a stored entry whose evidence record carries an unknown key, naming the entry and the bad key", () => {
    // A hand-edited (or future-tool-seeded) registry with an unknown evidence
    // key must be rejected at validateRegistry — symmetric with the candidate-
    // side whitelist — so the F24 re-validate gate never has to fire as the
    // primary defence. The error must name the entry and the offending key.
    const seededBody =
      "learnings:\n" +
      "  - summary: \"existing\"\n" +
      "    owner: runbook-reference\n" +
      "    retirement_condition: \"existing\"\n" +
      "    signature: \"sha256:registry-bogus\"\n" +
      "    disposition: needs-evidence\n" +
      "    status: open\n" +
      "    confidence: medium\n" +
      "    evidence:\n" +
      "      - run: issue-90\n" +
      "        affected_surface: \"x\"\n" +
      "        what_was_wrong: \"y\"\n" +
      "        bogus_key: \"not allowed\"\n";
    const path = writeRegistry(registryDoc(seededBody));
    const errors = validateRegistry(parseRegistry(path));
    expect(errors.some((e) => /bogus_key/.test(e))).toBe(true);
    const evidenceError = errors.find((e) => /bogus_key/.test(e));
    // Must name the offending entry (by signature) so the operator knows what to fix.
    expect(evidenceError).toContain("sha256:registry-bogus");
    // Must list the allowed keys so the message is self-correcting.
    expect(evidenceError).toMatch(/run/);
    expect(evidenceError).toMatch(/affected_surface/);
    expect(evidenceError).toMatch(/verification_idea/);
  });

  test("accepts a stored entry whose evidence records carry only documented keys (any subset)", () => {
    // The PRD lets a run capture only what is known; the whitelist must
    // tolerate documented keys being absent on a stored entry.
    const seededBody =
      "learnings:\n" +
      "  - summary: \"existing\"\n" +
      "    owner: runbook-reference\n" +
      "    retirement_condition: \"existing\"\n" +
      "    signature: \"sha256:registry-subset\"\n" +
      "    disposition: needs-evidence\n" +
      "    status: open\n" +
      "    confidence: medium\n" +
      "    evidence:\n" +
      "      - run: issue-90\n" +
      "        affected_surface: \"x\"\n" +
      "        what_was_wrong: \"y\"\n" +
      "      - run: issue-91\n" +
      "        proposed_fix: \"document the gate\"\n";
    const path = writeRegistry(registryDoc(seededBody));
    expect(validateRegistry(parseRegistry(path))).toEqual([]);
  });

  test("--upsert rejects a hand-edited registry with a poisoned evidence key BEFORE the upsert runs, leaving the file unchanged", async () => {
    // Integration test: the dispatcher's existing validateRegistry call (run
    // AFTER parseRegistry, BEFORE upsert) must block the DoS pathway end-to-end
    // and leave the on-disk file byte-identical. The error must name the
    // offending entry and the offending key so the operator can fix it.
    const seededBody =
      "learnings:\n" +
      "  - summary: \"existing\"\n" +
      "    owner: runbook-reference\n" +
      "    retirement_condition: \"existing\"\n" +
      "    signature: \"sha256:dispatcher-bogus\"\n" +
      "    disposition: needs-evidence\n" +
      "    status: open\n" +
      "    confidence: medium\n" +
      "    evidence:\n" +
      "      - run: issue-90\n" +
      "        affected_surface: \"x\"\n" +
      "        what_was_wrong: \"y\"\n" +
      "        bogus_key: \"not allowed\"\n";
    const path = writeRegistry(registryDoc(seededBody));
    const before = readFileSync(path, "utf8");

    const candidate = validCandidateObject();
    candidate.signature = "sha256:fresh-dispatch";
    const candidatePath = writeCandidate(
      "candidate.json",
      JSON.stringify(candidate, null, 2),
    );

    const result = await runRegistry(["--upsert", path, candidatePath]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/bogus_key/);
    expect(result.stderr).toContain("sha256:dispatcher-bogus");
    // Defence-in-depth: the registry must be byte-identical.
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

describe("validateCandidate (evidence-key whitelist, F23: emit-yaml-unescaped-mapping-keys-corrupt-file)", () => {
  test("rejects a candidate whose evidence record carries an unknown key", () => {
    const candidate = validCandidateObject();
    (candidate.evidence as Record<string, unknown>).bogus_key = "not allowed";
    const errors = validateCandidate(candidate);
    expect(errors.some((e) => /bogus_key/.test(e))).toBe(true);
    // The error must list the allowed key set so the message is self-correcting.
    const evidenceError = errors.find((e) => /bogus_key/.test(e));
    expect(evidenceError).toMatch(/run/);
    expect(evidenceError).toMatch(/affected_surface/);
    expect(evidenceError).toMatch(/verification_idea/);
  });

  test("accepts a candidate whose evidence record omits optional documented fields", () => {
    // The PRD lets a run capture only what is known; the whitelist must
    // tolerate documented keys being absent.
    const candidate = validCandidateObject();
    const ev = candidate.evidence as Record<string, unknown>;
    delete ev.discovery_method;
    delete ev.root_cause;
    delete ev.scope;
    expect(validateCandidate(candidate)).toEqual([]);
  });

  test("rejects an evidence key that contains a YAML-special character (colon)", () => {
    const candidate = validCandidateObject();
    (candidate.evidence as Record<string, unknown>)["key:with:colon"] = "x";
    const errors = validateCandidate(candidate);
    expect(errors.some((e) => /key:with:colon/.test(e))).toBe(true);
  });

  test("upsert refuses an evidence record with an unknown key (defense in depth)", () => {
    const candidate = validCandidateObject();
    (candidate.evidence as Record<string, unknown>).rogue = "x";
    expect(() => upsert({ learnings: [] }, candidate)).toThrow(/rogue/);
  });
});

describe("upsert lifecycle-omission contract (F25: lifecycle-omission-not-tested)", () => {
  test("omitting follow_up on a matched upsert preserves the existing follow_up value", () => {
    const first = validCandidateObject();
    first.signature = "sha256:lifecycle-preserve";
    first.follow_up = "https://example.test/issue/999";
    let registry = upsert({ learnings: [] }, first);

    const second = validCandidateObject();
    second.signature = "sha256:lifecycle-preserve";
    // Deliberately omit follow_up; the merge must not blank the existing value.
    delete second.follow_up;
    second.status = "filed";
    registry = upsert(registry, second);

    const entry = registry.learnings[0] as Record<string, unknown>;
    expect(entry.follow_up).toBe("https://example.test/issue/999");
    // Sanity: other lifecycle fields still merge from the candidate.
    expect(entry.status).toBe("filed");
  });

  test("an explicit null follow_up on a matched upsert overwrites the existing value", () => {
    // Paired contract test: explicit null is a documented semantic and must
    // clear the field, distinguishing it from absence.
    const first = validCandidateObject();
    first.signature = "sha256:lifecycle-clear";
    first.follow_up = "https://example.test/issue/123";
    let registry = upsert({ learnings: [] }, first);

    const second = validCandidateObject();
    second.signature = "sha256:lifecycle-clear";
    second.follow_up = null;
    registry = upsert(registry, second);

    const entry = registry.learnings[0] as Record<string, unknown>;
    expect(entry.follow_up).toBeNull();
  });
});

const scriptPathRoot = join(import.meta.dir, "..", "learnings-registry.ts");

async function runRegistry(args: string[]) {
  const proc = Bun.spawn([bunExecutable, scriptPathRoot, ...args], {
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

describe("learnings-registry.ts --upsert", () => {
  test("appends a new entry into a seeded registry and exits 0", async () => {
    const path = writeRegistry(registryDoc("learnings: []"));
    const candidate = validCandidateObject();
    candidate.signature = "sha256:dispatcher";
    const candidatePath = writeCandidate(
      "candidate.json",
      JSON.stringify(candidate, null, 2),
    );

    const result = await runRegistry(["--upsert", path, candidatePath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/sha256:dispatcher/);

    const reparsed = parseRegistry(path);
    expect(reparsed.learnings).toHaveLength(1);
    expect(validateRegistry(reparsed)).toEqual([]);
  });

  test("rejects an invalid candidate and leaves the registry untouched", async () => {
    const path = writeRegistry(registryDoc("learnings: []"));
    const before = readFileSync(path, "utf8");
    const candidate = validCandidateObject();
    candidate.disposition = "totally-bogus";
    const candidatePath = writeCandidate(
      "bad-candidate.json",
      JSON.stringify(candidate, null, 2),
    );

    const result = await runRegistry(["--upsert", path, candidatePath]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/bad-candidate\.json/);
    expect(result.stderr).toMatch(/disposition/);

    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("fails with a usage error when --upsert is missing arguments", async () => {
    const result = await runRegistry(["--upsert"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/usage/i);
  });

  test("fails with a usage error when --upsert is missing the candidate", async () => {
    const path = writeRegistry(registryDoc("learnings: []"));
    const result = await runRegistry(["--upsert", path]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/usage/i);
  });

  test("still supports the --validate flag after --upsert wiring lands", async () => {
    const result = await runRegistry(["--validate", realRegistryPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/ok/i);
  });

  test("refuses to write and leaves the registry unchanged when a pre-existing entry has a poisoned evidence key (F24: defence-in-depth around bad serialized output; F23-extended makes the early gate the primary defence)", async () => {
    // Stand up a registry whose pre-existing entry carries an evidence key
    // outside the documented whitelist. The candidate is valid. The
    // dispatcher must refuse to write and leave the on-disk file
    // byte-identical, with an actionable error that names the poisoned
    // entry and key so the operator knows exactly what to fix.
    //
    // With the F23-extended fix, `validateRegistry` rejects the poisoned
    // entry EARLY (at parse time) — that is the primary defence and the
    // path this fixture now exercises. The F24 re-validate gate (after
    // `emitYaml`) remains in place as defence-in-depth for any future
    // emit-side regression that produces yaml the parser would reject.
    const seededBody =
      "learnings:\n" +
      "  - summary: \"existing\"\n" +
      "    owner: runbook-reference\n" +
      "    retirement_condition: \"existing\"\n" +
      "    signature: \"sha256:existing\"\n" +
      "    disposition: needs-evidence\n" +
      "    status: open\n" +
      "    confidence: medium\n" +
      "    evidence:\n" +
      "      - run: issue-90\n" +
      "        affected_surface: \"x\"\n" +
      "        what_was_wrong: \"y\"\n" +
      "        \"rogue\\nkey\": \"poisoned\"\n";
    const path = writeRegistry(registryDoc(seededBody));
    const before = readFileSync(path, "utf8");

    const candidate = validCandidateObject();
    candidate.signature = "sha256:fresh";
    const candidatePath = writeCandidate(
      "candidate.json",
      JSON.stringify(candidate, null, 2),
    );

    const result = await runRegistry(["--upsert", path, candidatePath]);
    expect(result.exitCode).not.toBe(0);
    // The error must name the poisoned entry and the offending key so the
    // operator can fix the registry, not the candidate.
    expect(result.stderr).toContain("sha256:existing");
    expect(result.stderr).toMatch(/rogue/);
    // The file must be byte-identical: defence-in-depth prevents silent corruption.
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});
