import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execPath } from "node:process";

import { assertRegistryWriteTarget } from "./lib/learnings";

/**
 * Write-scope dispatcher tests for `learnings-registry.ts --upsert` (issue #90,
 * AC5 + AC6).
 *
 * AC5 says the helper may write ONLY the registry it owns: targeting a skill,
 * another reference, a lib source file, a per-issue ledger, or a traversal path
 * must be refused BEFORE any write. Every refusal is proven side-effect-free by
 * snapshotting the forbidden file's bytes before the dispatcher runs and
 * comparing against the bytes after.
 *
 * Co-located alongside `learnings-registry.ts` (mirroring `decompose.ts` /
 * `decompose.test.ts`) so the dispatcher's contract lives next to the
 * dispatcher.
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

const CANONICAL_RELATIVE =
  "runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md";
const CANONICAL_FILENAME = "workflow-learnings-registry.md";

const scriptPath = join(import.meta.dir, "learnings-registry.ts");
const bunExecutable = execPath || "bun";

/** Spawn the dispatcher and return its exit code + captured streams. */
async function runRegistry(args: string[]) {
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

/** Stand up a tmp directory whose tail mirrors the canonical layout. */
function makeCanonicalRegistry(content: string): string {
  const root = mkdtempSync(join(tmpdir(), "issue-90-write-scope-"));
  tempDirs.push(root);
  const path = join(root, CANONICAL_RELATIVE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

/** Write an arbitrary file under a tmp dir and return its absolute path. */
function makeForbiddenFile(relativePath: string, content: string): string {
  const root = mkdtempSync(join(tmpdir(), "issue-90-forbidden-"));
  tempDirs.push(root);
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

/** Write a valid candidate JSON file to a tmp dir. */
function makeCandidate(): string {
  const candidate = {
    summary: "a one-line learning statement",
    owner: "runbook-reference",
    retirement_condition: "retired when the reference documents the gate",
    signature: "sha256:write-scope-test",
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
  const dir = mkdtempSync(join(tmpdir(), "issue-90-candidate-"));
  tempDirs.push(dir);
  const path = join(dir, "candidate.json");
  writeFileSync(path, JSON.stringify(candidate, null, 2));
  return path;
}

/** Minimal valid seeded registry markdown body. */
function emptyRegistryDoc(): string {
  return `# Workflow Learnings registry\n\nProse.\n\n\`\`\`yaml\nlearnings: []\n\`\`\`\n`;
}

describe("assertRegistryWriteTarget (unit)", () => {
  test("accepts the canonical repo-relative path", () => {
    expect(() => assertRegistryWriteTarget(CANONICAL_RELATIVE)).not.toThrow();
  });

  test("accepts an absolute path whose tail equals the canonical relative path", () => {
    const absolute = `/Users/someone/code/repo/${CANONICAL_RELATIVE}`;
    expect(() => assertRegistryWriteTarget(absolute)).not.toThrow();
  });

  test("normalizes leading ./ and accepts the resulting canonical path", () => {
    expect(() =>
      assertRegistryWriteTarget(`./${CANONICAL_RELATIVE}`),
    ).not.toThrow();
  });

  test("refuses a path containing a traversal segment", () => {
    expect(() =>
      assertRegistryWriteTarget(
        "runbooks/issue-to-pr-v2/references/../references/workflow-learnings-registry.md",
      ),
    ).toThrow(/refus|\.\./i);
  });

  test("refuses a path that targets a skill markdown file", () => {
    expect(() =>
      assertRegistryWriteTarget("skills/issue-to-pr/SKILL.md"),
    ).toThrow(/skills/);
  });

  test("refuses a path that targets a different reference markdown file (same references/ dir, wrong filename)", () => {
    expect(() =>
      assertRegistryWriteTarget(
        "runbooks/issue-to-pr-v2/references/builder-dispatch.md",
      ),
    ).toThrow(/builder-dispatch\.md/);
  });

  test("refuses a path that targets a lib TypeScript source file", () => {
    expect(() =>
      assertRegistryWriteTarget("runbooks/issue-to-pr-v2/lib/learnings.ts"),
    ).toThrow(/learnings\.ts/);
  });

  test("refuses a path that targets a per-issue ledger", () => {
    expect(() =>
      assertRegistryWriteTarget(
        "docs/runbooks/issue-to-pr/issue-90-ledger.md",
      ),
    ).toThrow(/ledger/);
  });

  test("error names the canonical allowed filename so the operator can self-correct", () => {
    let captured: unknown;
    try {
      assertRegistryWriteTarget("skills/issue-to-pr/SKILL.md");
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toContain(CANONICAL_FILENAME);
  });

  // F40: write-scope-case-insensitive-fs-bypass.
  // macOS APFS is case-insensitive by default, so `Skills/foo.md` resolves to
  // the same on-disk file as `skills/foo.md`. The guard must refuse any case
  // variant of the documented forbidden categories so a path that differs only
  // in case still cannot overwrite the real file.
  test("F40: refuses a Skills/ segment with capital S (case-insensitive FS)", () => {
    expect(() =>
      assertRegistryWriteTarget("Skills/issue-to-pr/SKILL.md"),
    ).toThrow(/refus/i);
  });

  test("F40: refuses an issue-NNN-ledger.md path with capitalized stem", () => {
    expect(() =>
      assertRegistryWriteTarget(
        "docs/runbooks/issue-to-pr/Issue-90-Ledger.md",
      ),
    ).toThrow(/refus/i);
  });

  test("F40: refuses a References/ directory with capital R hosting a non-canonical file", () => {
    expect(() =>
      assertRegistryWriteTarget(
        "runbooks/issue-to-pr-v2/References/builder-dispatch.md",
      ),
    ).toThrow(/refus/i);
  });

  // F41: write-scope-non-ts-source-extension-bypass.
  // The v2 codebase is TS-via-Bun and reachable source extensions include
  // .mts/.cts/.tsx/.js/.jsx/.mjs/.cjs in addition to .ts. The guard must refuse
  // ALL of them so a path like `lib/learnings.mts` cannot overwrite source.
  test.each([
    ["lib/learnings.mts"],
    ["lib/learnings.cts"],
    ["components/Foo.tsx"],
    ["lib/learnings.js"],
    ["components/Foo.jsx"],
    ["lib/learnings.mjs"],
    ["lib/learnings.cjs"],
  ])("F41: refuses source extension target %s", (relative) => {
    expect(() =>
      assertRegistryWriteTarget(`runbooks/issue-to-pr-v2/${relative}`),
    ).toThrow(/refus/i);
  });

  // F42: write-scope-denylist-vs-allowlist-foreign-path.
  // AC5 says the helper may write ONLY the registry it owns. An arbitrary
  // unrelated REPO-RELATIVE path (README.md, package.json, ~/.bashrc shape)
  // is not the registry and must be refused. The tmpdir escape only applies
  // to paths INSIDE os.tmpdir(); these are not.
  test("F42: refuses an unrelated repo-relative README.md", () => {
    expect(() => assertRegistryWriteTarget("README.md")).toThrow(/refus/i);
  });

  test("F42: refuses an unrelated repo-relative package.json", () => {
    expect(() => assertRegistryWriteTarget("package.json")).toThrow(/refus/i);
  });

  test("F42: refuses an unrelated repo-relative docs/foo.md", () => {
    expect(() => assertRegistryWriteTarget("docs/foo.md")).toThrow(/refus/i);
  });

  test("F42: refuses an absolute path outside both the canonical tail AND os.tmpdir()", () => {
    // /etc/passwd is the canonical "foreign path" example. The guard must
    // refuse it: the tail is not the canonical registry, and the path is not
    // under os.tmpdir().
    expect(() => assertRegistryWriteTarget("/etc/passwd")).toThrow(/refus/i);
  });
});

describe("learnings-registry write-scope (F40/F41/F42 integration)", () => {
  test("F40: dispatcher refuses Skills/ (capital S) target and leaves it unchanged", async () => {
    const target = makeForbiddenFile(
      "Skills/issue-to-pr/SKILL.md",
      "# Skill (capital-S)\n\nDo not touch.\n",
    );
    const before = readFileSync(target, "utf8");
    const candidatePath = makeCandidate();

    const result = await runRegistry(["--upsert", target, candidatePath]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/refus/i);
    expect(readFileSync(target, "utf8")).toBe(before);
  });

  test("F41: dispatcher refuses a .mts source target and leaves it unchanged", async () => {
    const target = makeForbiddenFile(
      "runbooks/issue-to-pr-v2/lib/learnings.mts",
      "// .mts source must not be a registry write target.\n",
    );
    const before = readFileSync(target, "utf8");
    const candidatePath = makeCandidate();

    const result = await runRegistry(["--upsert", target, candidatePath]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/refus/i);
    expect(readFileSync(target, "utf8")).toBe(before);
  });

  test("F42: dispatcher refuses an arbitrary unrelated absolute path (outside tmpdir)", async () => {
    // Construct a path that is clearly NOT under os.tmpdir() AND does NOT have
    // the canonical tail. Using a fixed non-existent /var path (not /tmp) keeps
    // the assertion deterministic without modifying any real file.
    const target = "/var/empty/not-the-registry.md";
    const candidatePath = makeCandidate();

    const result = await runRegistry(["--upsert", target, candidatePath]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/refus/i);
  });
});

describe("learnings-registry.ts --upsert write-scope (integration)", () => {
  test("writes when the registry path mirrors the canonical layout and exits 0", async () => {
    const registryPath = makeCanonicalRegistry(emptyRegistryDoc());
    const candidatePath = makeCandidate();

    const result = await runRegistry([
      "--upsert",
      registryPath,
      candidatePath,
    ]);
    expect(result.exitCode).toBe(0);
    // The registry should have been updated (no longer learnings: []).
    expect(readFileSync(registryPath, "utf8")).toContain(
      "sha256:write-scope-test",
    );
  });

  test("refuses to write to a skill markdown file and leaves the target unchanged", async () => {
    const target = makeForbiddenFile(
      "skills/issue-to-pr/SKILL.md",
      "# Skill\n\nDo not touch.\n",
    );
    const before = readFileSync(target, "utf8");
    const candidatePath = makeCandidate();

    const result = await runRegistry(["--upsert", target, candidatePath]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(target);
    // The forbidden file must be byte-identical.
    expect(readFileSync(target, "utf8")).toBe(before);
  });

  test("refuses to write to a different references/*.md file and leaves it unchanged", async () => {
    const target = makeForbiddenFile(
      "runbooks/issue-to-pr-v2/references/builder-dispatch.md",
      "# Builder dispatch reference\n\nDo not touch.\n",
    );
    const before = readFileSync(target, "utf8");
    const candidatePath = makeCandidate();

    const result = await runRegistry(["--upsert", target, candidatePath]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(target);
    expect(readFileSync(target, "utf8")).toBe(before);
  });

  test("refuses to write to a lib source file and leaves it unchanged", async () => {
    const target = makeForbiddenFile(
      "runbooks/issue-to-pr-v2/lib/learnings.ts",
      "// Do not overwrite source code.\n",
    );
    const before = readFileSync(target, "utf8");
    const candidatePath = makeCandidate();

    const result = await runRegistry(["--upsert", target, candidatePath]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(target);
    expect(readFileSync(target, "utf8")).toBe(before);
  });

  test("refuses to write to a per-issue ledger and leaves it unchanged", async () => {
    const target = makeForbiddenFile(
      "docs/runbooks/issue-to-pr/issue-90-ledger.md",
      "# Issue 90 ledger\n\nDo not touch.\n",
    );
    const before = readFileSync(target, "utf8");
    const candidatePath = makeCandidate();

    const result = await runRegistry(["--upsert", target, candidatePath]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(target);
    expect(readFileSync(target, "utf8")).toBe(before);
  });

  test("refuses a path containing .. segments that escape references/", async () => {
    // Build the forbidden target as a real file so the before/after snapshot
    // is meaningful, then pass the dispatcher its `..` traversal form. The
    // guard must refuse on the textual `..` segment alone, before any write
    // is attempted to either the textual or the resolved location.
    const traversalTarget = makeForbiddenFile(
      "runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md",
      "# Canonical-named decoy in tmp\n",
    );
    const before = readFileSync(traversalTarget, "utf8");
    const candidatePath = makeCandidate();
    const traversalArg = traversalTarget.replace(
      "/references/workflow-learnings-registry.md",
      "/references/../references/workflow-learnings-registry.md",
    );

    const result = await runRegistry([
      "--upsert",
      traversalArg,
      candidatePath,
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/refus/i);
    expect(readFileSync(traversalTarget, "utf8")).toBe(before);
  });

  test("when the candidate path is a forbidden-write surface, the dispatcher only READS it; the canonical registry is updated and the candidate file is unchanged", async () => {
    // The write-scope guard governs the REGISTRY path, not the candidate path.
    // The candidate is parsed read-only, so even when it lives under a
    // forbidden-write surface, the dispatcher reads it without modification
    // and writes only to the canonical registry.
    const registryPath = makeCanonicalRegistry(emptyRegistryDoc());

    const candidateDir = mkdtempSync(
      join(tmpdir(), "issue-90-cand-forbidden-"),
    );
    tempDirs.push(candidateDir);
    const candidatePath = join(
      candidateDir,
      "skills",
      "issue-to-pr",
      "candidate.json",
    );
    mkdirSync(dirname(candidatePath), { recursive: true });
    const candidate = {
      summary: "candidate sourced from a forbidden-write surface",
      owner: "runbook-reference",
      retirement_condition: "retired when documented",
      signature: "sha256:candidate-from-forbidden",
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
    const candidateBytes = JSON.stringify(candidate, null, 2);
    writeFileSync(candidatePath, candidateBytes);

    const result = await runRegistry([
      "--upsert",
      registryPath,
      candidatePath,
    ]);
    expect(result.exitCode).toBe(0);
    // Registry was updated.
    expect(readFileSync(registryPath, "utf8")).toContain(
      "sha256:candidate-from-forbidden",
    );
    // Candidate file is byte-identical (read-only).
    expect(readFileSync(candidatePath, "utf8")).toBe(candidateBytes);
  });
});
