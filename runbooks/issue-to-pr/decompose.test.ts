import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";

const scriptPath = join(import.meta.dir, "decompose.ts");
const bunExecutable = execPath || "bun";
const tempDirs: string[] = [];
const currentCommit = new TextDecoder()
	.decode(Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout)
	.trim();

afterEach(() => {
	for (const dir of tempDirs.splice(0))
		rmSync(dir, { force: true, recursive: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "issue-to-pr-decompose-"));
	tempDirs.push(dir);
	return dir;
}

function writeFixture(name: string, contents: string): string {
	const path = join(tempDir(), name);
	writeFileSync(path, contents);
	return path;
}

function sha256(payload: string): string {
	return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

async function runDecompose(args: string[]) {
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

const ledger = `## Acceptance criteria

- [ ] One
- [ ] Two
`;

const ledgerOne = `## Acceptance criteria

- [ ] One
`;

const ledgerWithBatch = `${ledger}
## Batches

\`\`\`yaml
batches:
  - id: "original-batch"
    name: "Original"
    goal: "Original goal"
    files:
      - "src/original.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "Original proof"
    ac_mapping:
      - 1
    rationale: null
    status: converged
    builder_commits:
      - "${currentCommit}"
    iterations: 1
    final_verdict: converged
\`\`\`
`;

describe("decompose.ts", () => {
	test("emits batches in topological order and accepts YAML comments", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: second
name: Second
goal: AC 2
files:
  - src/second.ts
depends_on: [first] # depends on first
execution_mode: proof_first # proof before change
acceptance_tests:
  - "AC 2 holds # quoted hash survives"
ac_mapping: [2]
rationale: null
\`\`\`

\`\`\`yaml
id: first
name: First
goal: AC 1
files:
  - src/first.ts
depends_on: [] # explicit empty deps
execution_mode: tdd
acceptance_tests:
  - "AC 1 holds"
ac_mapping:
  - 1 # item comment
rationale: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | sig-one | ce-correctness-reviewer | P1 | open | Something is wrong |  |
| f2 | final | sig-two | ce-testing-reviewer | P2 | deferred-P2 | Nice to improve | deferred-P2 |
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.indexOf('id: "first"')).toBeLessThan(
			result.stdout.indexOf('id: "second"'),
		);
		expect(result.stdout).toContain("AC 2 holds # quoted hash survives");
		expect(result.stdout).not.toContain("depends on first");
		expect(result.stdout).not.toContain("proof before change");
		expect(result.stdout).not.toContain("explicit empty deps");
		expect(result.stdout).not.toContain("item comment");
	});

	test("rejects missing depends_on", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: missing-dep
name: Missing dep
goal: AC 1
files:
  - src/original.ts
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'missing-dep is missing required field "depends_on"',
		);
	});

	test("rejects change_first on runtime paths without an explicit gate", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: runtime-change
name: Runtime change
goal: AC 1
files:
  - src/runtime.ts
depends_on: []
execution_mode: change_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: split AC across files
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"uses change_first outside docs-only paths",
		);
	});

	test("accepts change_first for docs-only paths", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: docs-change
name: Docs change
goal: AC 1
files:
  - docs/guide.qmd
  - README
depends_on: []
execution_mode: change_first
acceptance_tests:
  - "Docs describe AC 1"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(0);
	});

	test("requires an explicit gate for txt files outside docs", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: txt-runtime
name: Runtime txt
goal: AC 1
files:
  - src/runtime-config.txt
depends_on: []
execution_mode: change_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"uses change_first outside docs-only paths",
		);
	});

	test("accepts explicit non-doc change_first rationales", async () => {
		for (const rationale of [
			"out-of-scope: investigation-required",
			"change_first-exception: generated file regen only",
		]) {
			const plan = writeFixture(
				`plan-${rationale.replace(/[^a-z0-9]/gi, "-")}.md`,
				`# Plan

\`\`\`yaml
id: runtime-exception
name: Runtime exception
goal: AC 1
files:
  - src/generated-file.ts
depends_on: []
execution_mode: change_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: "${rationale}"
\`\`\`
`,
			);

			const result = await runDecompose([plan]);

			expect(result.exitCode).toBe(0);
		}
	});

	test("requires a high-risk-specific change_first exception for risky paths", async () => {
		for (const file of [
			"src/auth/session.ts",
			"src/billing/charge.ts",
			"docs/auth.md",
			"migrations/20260520_add_user.sql",
			"packages/api/index.ts",
			"schema.graphql",
			"openapi.yaml",
		]) {
			const plan = writeFixture(
				`plan-${file.replace(/[^a-z0-9]/gi, "-")}.md`,
				`# Plan

\`\`\`yaml
id: risky-exception
name: Risky exception
goal: AC 1
files:
  - ${file}
depends_on: []
execution_mode: change_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: "change_first-exception: generated file regen only"
\`\`\`
`,
			);

			const result = await runDecompose([plan]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("uses change_first on risky files");
		}
	});

	test("accepts explicit high-risk change_first exception rationale", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: risky-explicit-exception
name: Risky explicit exception
goal: AC 1
files:
  - src/auth/session.ts
depends_on: []
execution_mode: change_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: "high-risk-change_first-exception: fixture-only generated snapshot"
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(0);
	});

	test("rejects duplicate fields in candidate batch YAML", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: duplicate-field
name: Duplicate field
goal: AC 1
files:
  - src/original.ts
depends_on: []
execution_mode: proof_first
execution_mode: tdd
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
status: pending
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('duplicate field "execution_mode"');
	});

	test("rejects unknown fields in candidate batch YAML", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: unknown-field
name: Unknown field
goal: AC 1
files:
  - src/original.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
status: pending
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('unknown field "status"');
	});

	test("rejects a leading flag even when another option is valid", async () => {
		const result = await runDecompose([
			"--unknown-plan",
			"--patch-proposal",
			writeFixture("ledger.md", ledgerWithBatch),
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("usage: decompose.ts");
	});

	test("rejects malformed candidate batch YAML lines", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: malformed
name: Malformed
goal: AC 1
files:
  -
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("empty list item");
	});

	test("skips unrelated YAML blocks before strict batch parsing", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
metadata:
  - name: unrelated
    value: nested
\`\`\`

\`\`\`yaml
id: real-batch
name: Real batch
goal: AC 1
files:
  - src/original.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('id: "real-batch"');
	});

	test("strips comments after apostrophes in unquoted scalars", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: apostrophe-comment
name: Apostrophe comment
goal: Don't regress # strip this comment
files:
  - src/original.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('goal: "Don\'t regress"');
		expect(result.stdout).not.toContain("strip this comment");
	});

	test("rejects directory-like files", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: directory-file
name: Directory file
goal: AC 1
files:
  - src
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("looks like a directory");
	});

	test("validates patch proposals against confirmed ledger dependencies", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: patch-001
name: Patch finding
goal: Fix final review finding
files:
  - src/original.ts
depends_on: [original-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: final-review remediation
\`\`\`
`,
		);
		const ledgerPath = writeFixture("ledger.md", ledgerWithBatch);

		const strict = await runDecompose([plan]);
		const patchMode = await runDecompose([
			plan,
			"--patch-proposal",
			ledgerPath,
		]);

		expect(strict.exitCode).toBe(1);
		expect(strict.stderr).toContain(
			"reserved patch-* id outside patch proposal mode",
		);
		expect(patchMode.exitCode).toBe(0);
		expect(patchMode.stdout).toContain('id: "patch-001"');
		expect(patchMode.stdout).toContain("depends_on:");
		expect(patchMode.stdout).toContain('      - "original-batch"');
		expect(patchMode.stdout).toContain("    ac_mapping: []");
		expect(patchMode.stdout).toContain("    status: pending");
	});

	test("rejects non-patch ids in patch proposal mode", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: normal
name: Normal
goal: Should not be a patch
files:
  - src/original.ts
depends_on: [original-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: [1]
rationale: final-review remediation
\`\`\`
`,
		);
		const ledgerPath = writeFixture("ledger.md", ledgerWithBatch);

		const result = await runDecompose([plan, "--patch-proposal", ledgerPath]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"patch proposal mode only accepts patch-* ids",
		);
	});

	test("rejects patch proposals with AC mappings", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: patch-001
name: Patch finding
goal: Fix final review finding
files:
  - src/original.ts
depends_on: [original-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: [1]
rationale: final-review remediation
\`\`\`
`,
		);
		const ledgerPath = writeFixture("ledger.md", ledgerWithBatch);

		const result = await runDecompose([plan, "--patch-proposal", ledgerPath]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("must use ac_mapping: []");
	});

	test("rejects patch proposals with unknown ledger dependencies", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: patch-001
name: Patch finding
goal: Fix final review finding
files:
  - src/original.ts
depends_on: [ghost-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: final-review remediation
\`\`\`
`,
		);
		const ledgerPath = writeFixture("ledger.md", ledgerWithBatch);

		const result = await runDecompose([plan, "--patch-proposal", ledgerPath]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'depends_on "ghost-batch" which is not a terminal ledger batch',
		);
	});

	test("does not allow patch dependencies from prose outside ledger batch YAML", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: patch-001
name: Patch finding
goal: Fix final review finding
files:
  - src/original.ts
depends_on: [spoofed-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: final-review remediation
\`\`\`
`,
		);
		const ledgerPath = writeFixture(
			"ledger.md",
			`${ledgerWithBatch}
stray prose:
  - id: "spoofed-batch"
`,
		);

		const result = await runDecompose([plan, "--patch-proposal", ledgerPath]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'depends_on "spoofed-batch" which is not a terminal ledger batch',
		);
	});

	test("rejects duplicate and oversized patch proposals", async () => {
		const duplicate = writeFixture(
			"duplicate.md",
			`# Plan

\`\`\`yaml
id: patch-001
name: Duplicate patch
goal: Fix final review finding
files:
  - src/original.ts
depends_on: [original-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: final-review remediation
\`\`\`
`,
		);
		const oversized = writeFixture(
			"oversized.md",
			`# Plan

\`\`\`yaml
id: patch-002
name: Oversized patch
goal: Fix final review finding
files:
  - src/foo.ts
  - src/bar.ts
  - src/baz.ts
depends_on: [original-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: final-review remediation
\`\`\`
`,
		);
		const ledgerPath = writeFixture(
			"ledger.md",
			`${ledgerWithBatch.replace('id: "original-batch"', 'id: "original-batch"')}
## Extra

ignored
`,
		);
		const ledgerWithPatchPath = writeFixture(
			"ledger-with-patch.md",
			`${ledgerWithBatch}
## Extra ignored

\`\`\`yaml
not-read: true
\`\`\`
`
				.replace('id: "original-batch"', 'id: "patch-001"')
				.replace(
					`ac_mapping:
      - 1`,
					"ac_mapping: []",
				)
				.replace("status: converged", "status: pending")
				.replace("iterations: 1", "iterations: 0")
				.replace("final_verdict: converged", "final_verdict: null"),
		);

		const duplicateResult = await runDecompose([
			duplicate,
			"--patch-proposal",
			ledgerWithPatchPath,
		]);
		const oversizedResult = await runDecompose([
			oversized,
			"--patch-proposal",
			ledgerPath,
		]);

		expect(duplicateResult.exitCode).toBe(1);
		expect(duplicateResult.stderr).toContain("already exists in the ledger");
		expect(oversizedResult.exitCode).toBe(1);
		expect(oversizedResult.stderr).toContain(
			"patch proposals are limited to 2 files",
		);
	});

	test("rejects patch proposals that depend on non-terminal ledger batches", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: patch-001
name: Patch finding
goal: Fix final review finding
files:
  - src/original.ts
depends_on: [original-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: final-review remediation
\`\`\`
`,
		);
		const ledgerPath = writeFixture(
			"ledger.md",
			ledgerWithBatch
				.replace("status: converged", "status: pending")
				.replace(
					`builder_commits:
      - "${currentCommit}"`,
					"builder_commits: []",
				)
				.replace("iterations: 1", "iterations: 0")
				.replace("final_verdict: converged", "final_verdict: null"),
		);

		const result = await runDecompose([plan, "--patch-proposal", ledgerPath]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'depends_on "original-batch" which is not a terminal ledger batch',
		);
	});

	test("rejects multi-batch patch proposals", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: patch-001
name: First patch
goal: Fix final review finding
files:
  - src/original.ts
depends_on: [original-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: final-review remediation
\`\`\`

\`\`\`yaml
id: patch-002
name: Second patch
goal: Fix another part
files:
  - src/original.ts
depends_on: [patch-001]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: final-review remediation
\`\`\`
`,
		);
		const ledgerPath = writeFixture("ledger.md", ledgerWithBatch);

		const result = await runDecompose([plan, "--patch-proposal", ledgerPath]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"patch proposal mode expects exactly one patch batch",
		);
	});

	test("requires explicit rationale for patch files outside confirmed ledger scope", async () => {
		const outsideScope = writeFixture(
			"outside-scope.md",
			`# Plan

\`\`\`yaml
id: patch-001
name: Patch finding
goal: Fix final review finding
files:
  - src/new-helper.ts
depends_on: [original-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: final-review remediation
\`\`\`
`,
		);
		const withException = writeFixture(
			"with-exception.md",
			`# Plan

\`\`\`yaml
id: patch-001
name: Patch finding
goal: Fix final review finding
files:
  - src/new-helper.ts
depends_on: [original-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: "new-file-patch-exception: companion test helper"
\`\`\`
`,
		);
		const highRiskGeneric = writeFixture(
			"high-risk-generic.md",
			`# Plan

\`\`\`yaml
id: patch-001
name: Patch finding
goal: Fix final review finding
files:
  - src/auth/new-session.ts
depends_on: [original-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: "new-file-patch-exception: companion auth helper"
\`\`\`
`,
		);
		const highRiskSpecific = writeFixture(
			"high-risk-specific.md",
			`# Plan

\`\`\`yaml
id: patch-001
name: Patch finding
goal: Fix final review finding
files:
  - src/auth/new-session.ts
depends_on: [original-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: "high-risk-new-file-patch-exception: user-approved auth remediation"
\`\`\`
`,
		);
		const ledgerPath = writeFixture("ledger.md", ledgerWithBatch);

		const outsideResult = await runDecompose([
			outsideScope,
			"--patch-proposal",
			ledgerPath,
		]);
		const exceptionResult = await runDecompose([
			withException,
			"--patch-proposal",
			ledgerPath,
		]);
		const highRiskGenericResult = await runDecompose([
			highRiskGeneric,
			"--patch-proposal",
			ledgerPath,
		]);
		const highRiskSpecificResult = await runDecompose([
			highRiskSpecific,
			"--patch-proposal",
			ledgerPath,
		]);

		expect(outsideResult.exitCode).toBe(1);
		expect(outsideResult.stderr).toContain(
			"touches files outside confirmed ledger scope",
		);
		expect(exceptionResult.exitCode).toBe(0);
		expect(highRiskGenericResult.exitCode).toBe(1);
		expect(highRiskGenericResult.stderr).toContain(
			"touches high-risk files outside confirmed ledger scope",
		);
		expect(highRiskSpecificResult.exitCode).toBe(0);
	});

	test("rejects mapping-shaped and nested array items", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: mapping-item
name: Mapping item
goal: AC 1
files:
  - path: src/foo.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("list item must be a scalar string");
	});

	test("parses supported quoted scalar forms without corrupting hashes or quotes", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: quoted-scalars
name: "Quoted scalars"
goal: "Fix \\"quoted\\" label"
files:
  - src/foo.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - 'Don''t drop # inside quote'
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('goal: "Fix \\"quoted\\" label"');
		expect(result.stdout).toContain("Don't drop # inside quote");
	});

	test("parses quoted scalars ending with literal backslashes", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: backslash-scalars
name: Backslash scalars
goal: "ends with \\\\"
files:
  - src/foo.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - 'single ends with \\'
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('id: "backslash-scalars"');
	});

	test("rejects inline mapping-shaped and nested array items", async () => {
		const inlineMapping = writeFixture(
			"inline-mapping.md",
			`# Plan

\`\`\`yaml
id: inline-mapping
name: Inline mapping
goal: AC 1
files: [{path: src/foo.ts}]
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);
		const inlineNested = writeFixture(
			"inline-nested.md",
			`# Plan

\`\`\`yaml
id: inline-nested
name: Inline nested
goal: AC 1
files: [[src/foo.ts]]
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const mappingResult = await runDecompose([inlineMapping]);
		const nestedResult = await runDecompose([inlineNested]);

		expect(mappingResult.exitCode).toBe(1);
		expect(mappingResult.stderr).toContain(
			"inline array item must be a scalar string",
		);
		expect(nestedResult.exitCode).toBe(1);
		expect(nestedResult.stderr).toContain(
			"inline array item must be a scalar string",
		);
	});

	test("escapes control characters when emitting quoted scalars", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: control-scalars
name: Control scalars
goal: "Line\\nBreak"
files:
  - src/foo.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "Tab\\tProof"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);
		const emitted = await runDecompose([plan]);
		const ledgerPath = writeFixture(
			"ledger.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
${emitted.stdout}
\`\`\`
`,
		);

		const result = await runDecompose([
			"--validate-ledger-batches",
			ledgerPath,
		]);

		expect(emitted.exitCode).toBe(0);
		expect(emitted.stdout).toContain('goal: "Line\\nBreak"');
		expect(emitted.stdout).toContain('      - "Tab\\tProof"');
		expect(result.exitCode).toBe(0);
	});

	test("rejects unterminated quoted scalars", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: bad-quote
name: Bad quote
goal: "Missing close
files:
  - src/foo.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("unterminated quoted scalar");
	});

	test("rejects non-canonical and non-concrete paths", async () => {
		const fixtures = [
			"src/./foo.ts",
			"src//foo.ts",
			"../outside.ts",
			"/tmp/foo.ts",
			"C:\\\\tmp\\\\foo.ts",
			"packages/foo",
		];

		for (const file of fixtures) {
			const plan = writeFixture(
				`plan-${file.replace(/[^a-z0-9]/gi, "-")}.md`,
				`# Plan

\`\`\`yaml
id: bad-path
name: Bad path
goal: AC 1
files:
  - ${file}
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
			);

			const result = await runDecompose([plan]);

			expect(result.exitCode).toBe(1);
		}
	});

	test("rejects duplicate ids, duplicate fields, duplicate mappings, and cycles", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: a
name: A
goal: AC 1
files:
  - src/a.ts
depends_on: [b]
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`

\`\`\`yaml
id: b
name: B
goal: AC 2
files:
  - src/b.ts
depends_on: [a]
execution_mode: proof_first
acceptance_tests:
  - "AC 2 holds"
ac_mapping: [2]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("cyclic dependency detected");
	});

	test("rejects duplicate ids and duplicate batch fields directly", async () => {
		const duplicateId = writeFixture(
			"duplicate-id.md",
			`# Plan

\`\`\`yaml
id: same
name: Same one
goal: AC 1
files:
  - src/one.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`

\`\`\`yaml
id: same
name: Same two
goal: AC 2
files:
  - src/two.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 2 holds"
ac_mapping: [2]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([duplicateId]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('duplicate batch id "same"');
	});

	test("rejects duplicate dependency, AC mapping, and canonical file entries", async () => {
		const duplicateDependency = writeFixture(
			"duplicate-dependency.md",
			`# Plan

\`\`\`yaml
id: first
name: First
goal: AC 1
files:
  - src/first.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`

\`\`\`yaml
id: second
name: Second
goal: AC 2
files:
  - src/second.ts
depends_on: [first, first]
execution_mode: proof_first
acceptance_tests:
  - "AC 2 holds"
ac_mapping: [2]
rationale: null
\`\`\`
`,
		);
		const duplicateAc = writeFixture(
			"duplicate-ac.md",
			`# Plan

\`\`\`yaml
id: duplicate-ac
name: Duplicate AC
goal: AC 1
files:
  - src/foo.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1, 1]
rationale: null
\`\`\`
`,
		);
		const duplicateFile = writeFixture(
			"duplicate-file.md",
			`# Plan

\`\`\`yaml
id: duplicate-file
name: Duplicate file
goal: AC 1
files:
  - ./src/foo.ts
  - src/foo.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const dependencyResult = await runDecompose([duplicateDependency]);
		const acResult = await runDecompose([duplicateAc]);
		const fileResult = await runDecompose([duplicateFile]);

		expect(dependencyResult.exitCode).toBe(1);
		expect(dependencyResult.stderr).toContain(
			'depends_on contains duplicate "first"',
		);
		expect(acResult.exitCode).toBe(1);
		expect(acResult.stderr).toContain('ac_mapping contains duplicate "1"');
		expect(fileResult.exitCode).toBe(1);
		expect(fileResult.stderr).toContain(
			'files contains duplicate "src/foo.ts"',
		);
	});

	test("rejects malformed AC mapping values", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: bad-ac
name: Bad AC
goal: AC 1
files:
  - src/foo.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1, nope]
rationale: null
\`\`\`
`,
		);
		const ledgerPath = writeFixture("ledger.md", ledger);

		const result = await runDecompose([
			plan,
			"--validate-ac-coverage",
			ledgerPath,
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('invalid AC index "nope"');
	});

	test("validates complete AC coverage", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: one
name: One
goal: AC 1
files:
  - src/one.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`

\`\`\`yaml
id: two
name: Two
goal: AC 2
files:
  - src/two.ts
depends_on: [one]
execution_mode: proof_first
acceptance_tests:
  - "AC 2 holds"
ac_mapping: [2]
rationale: null
\`\`\`
`,
		);
		const ledgerPath = writeFixture("ledger.md", ledger);

		const result = await runDecompose([
			plan,
			"--validate-ac-coverage",
			ledgerPath,
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"AC coverage OK: 2/2 covered across 2 batches",
		);
	});

	test("emits candidate batch contract digest from plan input", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: one
name: One
goal: AC 1
files:
  - src/one.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan, "--candidate-contract-digest"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Batch contract digest: sha256:");
	});

	test("emits plan and acceptance criteria digests", async () => {
		const planContents = `# Plan

\`\`\`yaml
id: one
name: One
goal: AC 1
files:
  - src/one.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`;
		const planPath = writeFixture("plan.md", planContents);
		const ledgerPath = writeFixture(
			"ledger.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches: []
\`\`\`
`,
		);

		const planResult = await runDecompose(["--plan-digest", planPath]);
		const acResult = await runDecompose(["--ac-digest", ledgerPath]);

		expect(planResult.exitCode).toBe(0);
		expect(planResult.stdout).toBe(`Plan digest: ${sha256(planContents)}\n`);
		expect(acResult.exitCode).toBe(0);
		expect(acResult.stdout).toBe(`AC digest: ${sha256("- [ ] One")}\n`);
	});

	test("rejects incomplete AC coverage", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: one
name: One
goal: AC 1
files:
  - src/one.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);
		const ledgerPath = writeFixture("ledger.md", ledger);

		const result = await runDecompose([
			plan,
			"--validate-ac-coverage",
			ledgerPath,
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"AC coverage incomplete; missing AC indices: 2",
		);
	});

	test("rejects out-of-range AC mappings", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: too-far
name: Too far
goal: AC 3
files:
  - src/three.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 3 holds"
ac_mapping: [3]
rationale: null
\`\`\`
`,
		);
		const ledgerPath = writeFixture("ledger.md", ledger);

		const result = await runDecompose([
			plan,
			"--validate-ac-coverage",
			ledgerPath,
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"maps to AC 3, but ledger has AC indices 1..2",
		);
	});

	test("rejects empty inline array elements", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: bad-inline
name: Bad inline
goal: AC 1
files:
  - src/foo.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1,,2]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([plan]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"inline arrays must not contain empty items",
		);
	});

	test("rejects unknown flags with a clean usage error", async () => {
		const result = await runDecompose(["--unknown-flag"]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("usage: decompose.ts");
	});

	test("reports ledger read failures as decompose errors", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: one
name: One
goal: AC 1
files:
  - src/foo.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);

		const result = await runDecompose([
			plan,
			"--validate-ac-coverage",
			join(tempDir(), "missing-ledger.md"),
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("decompose: cannot read ledger");
	});

	test("validates emitted batches when they are stored in the ledger", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: one
name: One
goal: AC 1
files:
  - src/one.ts
depends_on: []
execution_mode: proof_first
acceptance_tests:
  - "AC 1 holds"
ac_mapping: [1]
rationale: null
\`\`\`
`,
		);
		const emitted = await runDecompose([plan]);
		const ledgerPath = writeFixture(
			"ledger.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
${emitted.stdout}
\`\`\`

## Findings data

\`\`\`yaml
findings: []
\`\`\`
`,
		);

		const result = await runDecompose([
			"--validate-ledger-batches",
			ledgerPath,
		]);

		expect(emitted.exitCode).toBe(0);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Ledger batches OK: 1 batches");
	});

	test("ledger batch validation rejects lifecycle drift and AC coverage drift", async () => {
		const invalidLifecycle = writeFixture(
			"invalid-lifecycle.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: converged
    builder_commits: not-a-list
    iterations: banana
    final_verdict: converged
\`\`\`
`,
		);
		const forgedTerminal = writeFixture(
			"forged-terminal.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: converged
    builder_commits: []
    iterations: 0
    final_verdict: converged
\`\`\`
`,
		);
		const pendingWithVerdict = writeFixture(
			"pending-with-verdict.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: pending
    builder_commits: []
    iterations: 0
    final_verdict: converged
\`\`\`
`,
		);
		const invalidCommitRef = writeFixture(
			"invalid-commit-ref.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: converged
    builder_commits:
      - "not-a-sha"
    iterations: 1
    final_verdict: converged
\`\`\`
`,
		);
		const coverageDrift = writeFixture(
			"coverage-drift.md",
			`${ledger}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: converged
    builder_commits:
      - "${currentCommit}"
    iterations: 1
    final_verdict: converged
\`\`\`
`,
		);
		const duplicateBatchesSection = writeFixture(
			"duplicate-batches-section.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches: []
\`\`\`

## Batches

\`\`\`yaml
batches: []
\`\`\`
`,
		);
		const acceptedRisk = writeFixture(
			"accepted-risk.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: accepted-risk
    builder_commits:
      - "${currentCommit}"
    iterations: 1
    final_verdict: accepted-risk
\`\`\`
`,
		);
		const acceptedRiskWrongVerdict = writeFixture(
			"accepted-risk-wrong-verdict.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: accepted-risk
    builder_commits:
      - "${currentCommit}"
    iterations: 1
    final_verdict: converged
\`\`\`
`,
		);
		const blockedWrongVerdict = writeFixture(
			"blocked-wrong-verdict.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: blocked
    builder_commits: []
    iterations: 0
    final_verdict: converged
\`\`\`
`,
		);
		const inProgressWithVerdict = writeFixture(
			"in-progress-with-verdict.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: in-progress
    builder_commits: []
    iterations: 0
    final_verdict: accepted-risk
\`\`\`
`,
		);

		const lifecycleResult = await runDecompose([
			"--validate-ledger-batches",
			invalidLifecycle,
		]);
		const forgedTerminalResult = await runDecompose([
			"--validate-ledger-batches",
			forgedTerminal,
		]);
		const pendingWithVerdictResult = await runDecompose([
			"--validate-ledger-batches",
			pendingWithVerdict,
		]);
		const invalidCommitRefResult = await runDecompose([
			"--validate-ledger-batches",
			invalidCommitRef,
		]);
		const coverageResult = await runDecompose([
			"--validate-ledger-batches",
			coverageDrift,
		]);
		const duplicateBatchesResult = await runDecompose([
			"--validate-ledger-batches",
			duplicateBatchesSection,
		]);
		const acceptedRiskResult = await runDecompose([
			"--validate-ledger-batches",
			acceptedRisk,
		]);
		const acceptedRiskWrongVerdictResult = await runDecompose([
			"--validate-ledger-batches",
			acceptedRiskWrongVerdict,
		]);
		const blockedWrongVerdictResult = await runDecompose([
			"--validate-ledger-batches",
			blockedWrongVerdict,
		]);
		const inProgressWithVerdictResult = await runDecompose([
			"--validate-ledger-batches",
			inProgressWithVerdict,
		]);

		expect(lifecycleResult.exitCode).toBe(1);
		expect(lifecycleResult.stderr).toContain(
			'field "builder_commits" must be a list',
		);
		expect(forgedTerminalResult.exitCode).toBe(1);
		expect(forgedTerminalResult.stderr).toContain(
			"must include at least one builder commit",
		);
		expect(pendingWithVerdictResult.exitCode).toBe(1);
		expect(pendingWithVerdictResult.stderr).toContain(
			"must use final_verdict: null",
		);
		expect(invalidCommitRefResult.exitCode).toBe(1);
		expect(invalidCommitRefResult.stderr).toContain(
			"must be a 7-40 character hex commit ref",
		);
		expect(coverageResult.exitCode).toBe(1);
		expect(coverageResult.stderr).toContain(
			"AC coverage incomplete; missing AC indices: 2",
		);
		expect(duplicateBatchesResult.exitCode).toBe(1);
		expect(duplicateBatchesResult.stderr).toContain(
			"duplicate '## Batches' sections",
		);
		expect(acceptedRiskResult.exitCode).toBe(0);
		expect(acceptedRiskWrongVerdictResult.exitCode).toBe(1);
		expect(acceptedRiskWrongVerdictResult.stderr).toContain(
			"must use final_verdict: accepted-risk",
		);
		expect(blockedWrongVerdictResult.exitCode).toBe(1);
		expect(blockedWrongVerdictResult.stderr).toContain(
			"must use final_verdict: blocked-for-user",
		);
		expect(inProgressWithVerdictResult.exitCode).toBe(1);
		expect(inProgressWithVerdictResult.stderr).toContain(
			"must use final_verdict: null",
		);
	});

	test("accepted-risk ledger batches are terminal patch dependencies", async () => {
		const plan = writeFixture(
			"plan.md",
			`# Plan

\`\`\`yaml
id: patch-001
name: Patch finding
goal: Fix final review finding
files:
  - src/original.ts
depends_on: [original-batch]
execution_mode: proof_first
acceptance_tests:
  - "Regression proof passes"
ac_mapping: []
rationale: final-review remediation
\`\`\`
`,
		);
		const ledgerPath = writeFixture(
			"ledger.md",
			ledgerWithBatch
				.replace("status: converged", "status: accepted-risk")
				.replace("final_verdict: converged", "final_verdict: accepted-risk"),
		);

		const result = await runDecompose([plan, "--patch-proposal", ledgerPath]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('id: "patch-001"');
	});

	test("batch contract digest ignores lifecycle fields and changes with contract fields", async () => {
		const pendingLedger = writeFixture(
			"pending-ledger.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: pending
    builder_commits: []
    iterations: 0
    final_verdict: null
\`\`\`
`,
		);
		const convergedLedger = writeFixture(
			"converged-ledger.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: converged
    builder_commits:
      - "${currentCommit}"
    iterations: 1
    final_verdict: converged
\`\`\`
`,
		);
		const changedContractLedger = writeFixture(
			"changed-contract-ledger.md",
			`${ledgerOne}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1 changed"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: pending
    builder_commits: []
    iterations: 0
    final_verdict: null
\`\`\`
`,
		);

		const pendingDigest = await runDecompose([
			"--batch-contract-digest",
			pendingLedger,
		]);
		const convergedDigest = await runDecompose([
			"--batch-contract-digest",
			convergedLedger,
		]);
		const changedDigest = await runDecompose([
			"--batch-contract-digest",
			changedContractLedger,
		]);

		expect(pendingDigest.exitCode).toBe(0);
		expect(convergedDigest.exitCode).toBe(0);
		expect(changedDigest.exitCode).toBe(0);
		expect(pendingDigest.stdout).toBe(convergedDigest.stdout);
		expect(changedDigest.stdout).not.toBe(pendingDigest.stdout);
		expect(pendingDigest.stdout).toContain("Batch contract digest: sha256:");
	});

	test("validates findings data and reports open P0/P1 count", async () => {
		const ledgerPath = writeFixture(
			"ledger.md",
			`${ledger}
## Batches

\`\`\`yaml
batches: []
\`\`\`

## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "sig-one"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "open"
    summary: "Something is wrong"
    resolution: null
  - id: "f2"
    batch_id: "final"
    signature: "sig-two"
    persona: "ce-testing-reviewer"
    severity: "P2"
    status: "deferred-P2"
    summary: "Nice to improve"
    resolution: "deferred-P2"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | sig-one | ce-correctness-reviewer | P1 | open | Something is wrong |  |
| f2 | final | sig-two | ce-testing-reviewer | P2 | deferred-P2 | Nice to improve | deferred-P2 |
`,
		);

		const result = await runDecompose(["--validate-findings", ledgerPath]);
		const assertResult = await runDecompose([
			"--assert-no-open-p0p1",
			ledgerPath,
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"Findings data OK: 2 findings, 1 open P0/P1",
		);
		expect(assertResult.exitCode).toBe(1);
		expect(assertResult.stderr).toContain("has 1 open P0/P1 blocker");
	});

	test("validates closed finding resolution contracts", async () => {
		const ledgerPath = writeFixture(
			"ledger.md",
			`${ledger}
## Batches

\`\`\`yaml
batches:
  - id: "patch-001"
    name: "Patch finding"
    goal: "Fix final review finding"
    files:
      - "src/original.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "Regression proof passes"
    ac_mapping: []
    rationale: "final-review remediation"
    status: converged
    builder_commits:
      - "${currentCommit}"
    iterations: 1
    final_verdict: converged
\`\`\`

## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "fixed-commit"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "fixed"
    summary: "Fixed by commit"
    resolution: "commit ${currentCommit}"
  - id: "f2"
    batch_id: "final"
    signature: "fixed-patch"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "fixed"
    summary: "Fixed by patch"
    resolution: "patch-batch patch-001"
  - id: "f3"
    batch_id: "final"
    signature: "accepted-risk"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "accepted-risk"
    summary: "Accepted risk"
    resolution: "accepted-risk: user accepted trade-off"
  - id: "f4"
    batch_id: "final"
    signature: "out-of-scope"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "out-of-scope-for-this-issue"
    summary: "Different issue"
    resolution: "out-of-scope-for-this-issue: follow-up issue 123"
  - id: "f5"
    batch_id: "final"
    signature: "adr"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "ADR-contradicts-001"
    summary: "ADR conflict"
    resolution: "ADR-contradicts-001"
  - id: "f6"
    batch_id: "final"
    signature: "superseded"
    persona: "ce-correctness-reviewer"
    severity: "P3"
    status: "superseded"
    summary: "Superseded finding"
    resolution: "superseded-by-f7"
  - id: "f7"
    batch_id: "final"
    signature: "superseded"
    persona: "ce-testing-reviewer"
    severity: "P2"
    status: "open"
    summary: "Latest open finding"
    resolution: null
  - id: "f8"
    batch_id: "final"
    signature: "deferred-p3"
    persona: "ce-testing-reviewer"
    severity: "P3"
    status: "deferred-P3"
    summary: "Deferred advisory"
    resolution: "deferred-P3"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | fixed-commit | ce-correctness-reviewer | P1 | fixed | Fixed by commit | commit ${currentCommit} |
| f2 | final | fixed-patch | ce-correctness-reviewer | P1 | fixed | Fixed by patch | patch-batch patch-001 |
| f3 | final | accepted-risk | ce-correctness-reviewer | P1 | accepted-risk | Accepted risk | accepted-risk: user accepted trade-off |
| f4 | final | out-of-scope | ce-correctness-reviewer | P1 | out-of-scope-for-this-issue | Different issue | out-of-scope-for-this-issue: follow-up issue 123 |
| f5 | final | adr | ce-correctness-reviewer | P1 | ADR-contradicts-001 | ADR conflict | ADR-contradicts-001 |
| f6 | final | superseded | ce-correctness-reviewer | P3 | superseded | Superseded finding | superseded-by-f7 |
| f7 | final | superseded | ce-testing-reviewer | P2 | open | Latest open finding |  |
| f8 | final | deferred-p3 | ce-testing-reviewer | P3 | deferred-P3 | Deferred advisory | deferred-P3 |
`,
		);

		const result = await runDecompose(["--validate-findings", ledgerPath]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"Findings data OK: 8 findings, 0 open P0/P1",
		);
	});

	test("accepts one canonical finding with superseded duplicates", async () => {
		const ledgerPath = writeFixture(
			"deduped-findings.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "same"
    persona: "ce-testing-reviewer"
    severity: "P2"
    status: "superseded"
    summary: "Duplicate test coverage angle"
    resolution: "superseded-by-f2"
  - id: "f2"
    batch_id: "final"
    signature: "same"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "open"
    summary: "Canonical finding, also reported by ce-testing-reviewer"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | same | ce-testing-reviewer | P2 | superseded | Duplicate test coverage angle | superseded-by-f2 |
| f2 | final | same | ce-correctness-reviewer | P1 | open | Canonical finding, also reported by ce-testing-reviewer |  |
`,
		);

		const result = await runDecompose(["--validate-findings", ledgerPath]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"Findings data OK: 2 findings, 1 open P0/P1",
		);
	});

	test("accepts superseded duplicates after canonical closure", async () => {
		const ledgerPath = writeFixture(
			"deduped-closed-canonical.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "same"
    persona: "ce-testing-reviewer"
    severity: "P2"
    status: "superseded"
    summary: "Duplicate test coverage angle"
    resolution: "superseded-by-f2"
  - id: "f2"
    batch_id: "final"
    signature: "same"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "accepted-risk"
    summary: "Canonical finding, also reported by ce-testing-reviewer"
    resolution: "accepted-risk: user accepted the remaining risk"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | same | ce-testing-reviewer | P2 | superseded | Duplicate test coverage angle | superseded-by-f2 |
| f2 | final | same | ce-correctness-reviewer | P1 | accepted-risk | Canonical finding, also reported by ce-testing-reviewer | accepted-risk: user accepted the remaining risk |
`,
		);

		const result = await runDecompose(["--validate-findings", ledgerPath]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"Findings data OK: 2 findings, 0 open P0/P1",
		);
	});

	test("accepts the same finding signature in different batches", async () => {
		const ledgerPath = writeFixture(
			"same-signature-different-batches.md",
			`${ledger}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: pending
    builder_commits: []
    iterations: 0
    final_verdict: null
  - id: "two"
    name: "Two"
    goal: "AC 1"
    files:
      - "src/two.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: pending
    builder_commits: []
    iterations: 0
    final_verdict: null
\`\`\`

## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "one"
    signature: "same"
    persona: "ce-correctness-reviewer"
    severity: "P2"
    status: "open"
    summary: "First batch finding"
    resolution: null
  - id: "f2"
    batch_id: "two"
    signature: "same"
    persona: "ce-testing-reviewer"
    severity: "P2"
    status: "open"
    summary: "Second batch finding"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | one | same | ce-correctness-reviewer | P2 | open | First batch finding |  |
| f2 | two | same | ce-testing-reviewer | P2 | open | Second batch finding |  |
`,
		);

		const result = await runDecompose(["--validate-findings", ledgerPath]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"Findings data OK: 2 findings, 0 open P0/P1",
		);
	});

	test("rejects a later canonical finding when duplicate severities tie", async () => {
		const ledgerPath = writeFixture(
			"later-canonical-tie.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "same"
    persona: "ce-testing-reviewer"
    severity: "P2"
    status: "superseded"
    summary: "First equal-severity finding"
    resolution: "superseded-by-f2"
  - id: "f2"
    batch_id: "final"
    signature: "same"
    persona: "ce-correctness-reviewer"
    severity: "P2"
    status: "open"
    summary: "Later equal-severity finding"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | same | ce-testing-reviewer | P2 | superseded | First equal-severity finding | superseded-by-f2 |
| f2 | final | same | ce-correctness-reviewer | P2 | open | Later equal-severity finding |  |
`,
		);

		const result = await runDecompose(["--validate-findings", ledgerPath]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('finding "f1" must be canonical');
	});

	test("rejects duplicate non-superseded findings", async () => {
		const ledgerPath = writeFixture(
			"duplicate-non-superseded-finding.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "same"
    persona: "ce-correctness-reviewer"
    severity: "P2"
    status: "deferred-P2"
    summary: "Deferred finding"
    resolution: "deferred-P2"
  - id: "f2"
    batch_id: "final"
    signature: "same"
    persona: "ce-testing-reviewer"
    severity: "P2"
    status: "open"
    summary: "Open duplicate finding"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | same | ce-correctness-reviewer | P2 | deferred-P2 | Deferred finding | deferred-P2 |
| f2 | final | same | ce-testing-reviewer | P2 | open | Open duplicate finding |  |
`,
		);

		const result = await runDecompose(["--validate-findings", ledgerPath]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'share batch_id "final" and signature "same"',
		);
	});

	test("rejects malformed closed finding resolutions", async () => {
		const nonTerminalPatch = writeFixture(
			"non-terminal-patch.md",
			`${ledger}
## Batches

\`\`\`yaml
batches:
  - id: "patch-001"
    name: "Patch finding"
    goal: "Fix final review finding"
    files:
      - "src/original.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "Regression proof passes"
    ac_mapping: []
    rationale: "final-review remediation"
    status: pending
    builder_commits: []
    iterations: 0
    final_verdict: null
\`\`\`

## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "fixed-patch"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "fixed"
    summary: "Fixed by patch"
    resolution: "patch-batch patch-001"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | fixed-patch | ce-correctness-reviewer | P1 | fixed | Fixed by patch | patch-batch patch-001 |
`,
		);
		const acceptedRiskMissingReason = writeFixture(
			"accepted-risk-missing-reason.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "accepted-risk"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "accepted-risk"
    summary: "Accepted risk"
    resolution: "accepted-risk:"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | accepted-risk | ce-correctness-reviewer | P1 | accepted-risk | Accepted risk | accepted-risk: |
`,
		);
		const fakeCommitResolution = writeFixture(
			"fake-commit-resolution.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "fixed-commit"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "fixed"
    summary: "Fixed by commit"
    resolution: "commit 0000000"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | fixed-commit | ce-correctness-reviewer | P1 | fixed | Fixed by commit | commit 0000000 |
`,
		);
		const unownedCommitResolution = writeFixture(
			"unowned-commit-resolution.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "fixed-commit"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "fixed"
    summary: "Fixed by commit"
    resolution: "commit ${currentCommit}"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | fixed-commit | ce-correctness-reviewer | P1 | fixed | Fixed by commit | commit ${currentCommit} |
`,
		);
		const outOfScopeMissingReason = writeFixture(
			"out-of-scope-missing-reason.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "out-of-scope"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "out-of-scope-for-this-issue"
    summary: "Different issue"
    resolution: "out-of-scope-for-this-issue:"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | out-of-scope | ce-correctness-reviewer | P1 | out-of-scope-for-this-issue | Different issue | out-of-scope-for-this-issue: |
`,
		);
		const adrMismatch = writeFixture(
			"adr-mismatch.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "adr"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "ADR-contradicts-001"
    summary: "ADR conflict"
    resolution: "ADR-contradicts-002"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | adr | ce-correctness-reviewer | P1 | ADR-contradicts-001 | ADR conflict | ADR-contradicts-002 |
`,
		);
		const badSuperseded = writeFixture(
			"bad-superseded.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "superseded"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "superseded"
    summary: "Superseded finding"
    resolution: "later"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | superseded | ce-correctness-reviewer | P1 | superseded | Superseded finding | later |
`,
		);
		const missingSupersededTarget = writeFixture(
			"missing-superseded-target.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "superseded"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "superseded"
    summary: "Superseded finding"
    resolution: "superseded-by-f2"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | superseded | ce-correctness-reviewer | P1 | superseded | Superseded finding | superseded-by-f2 |
`,
		);
		const selfSuperseded = writeFixture(
			"self-superseded.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "superseded"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "superseded"
    summary: "Superseded finding"
    resolution: "superseded-by-f1"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | superseded | ce-correctness-reviewer | P1 | superseded | Superseded finding | superseded-by-f1 |
`,
		);
		const supersededTarget = writeFixture(
			"superseded-target.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "same"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "superseded"
    summary: "Superseded finding"
    resolution: "superseded-by-f2"
  - id: "f2"
    batch_id: "final"
    signature: "same"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "superseded"
    summary: "Superseded target"
    resolution: "superseded-by-f3"
  - id: "f3"
    batch_id: "final"
    signature: "same"
    persona: "ce-testing-reviewer"
    severity: "P1"
    status: "open"
    summary: "Canonical target"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | same | ce-correctness-reviewer | P1 | superseded | Superseded finding | superseded-by-f2 |
| f2 | final | same | ce-correctness-reviewer | P1 | superseded | Superseded target | superseded-by-f3 |
| f3 | final | same | ce-testing-reviewer | P1 | open | Canonical target |  |
`,
		);
		const differentSignatureSupersededTarget = writeFixture(
			"different-signature-superseded-target.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "same"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "superseded"
    summary: "Superseded finding"
    resolution: "superseded-by-f2"
  - id: "f2"
    batch_id: "final"
    signature: "different"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "open"
    summary: "Open target"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | same | ce-correctness-reviewer | P1 | superseded | Superseded finding | superseded-by-f2 |
| f2 | final | different | ce-correctness-reviewer | P1 | open | Open target |  |
`,
		);
		const lowerSeveritySupersededTarget = writeFixture(
			"lower-severity-superseded-target.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "same"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "superseded"
    summary: "Superseded finding"
    resolution: "superseded-by-f2"
  - id: "f2"
    batch_id: "final"
    signature: "same"
    persona: "ce-correctness-reviewer"
    severity: "P2"
    status: "open"
    summary: "Lower target"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | same | ce-correctness-reviewer | P1 | superseded | Superseded finding | superseded-by-f2 |
| f2 | final | same | ce-correctness-reviewer | P2 | open | Lower target |  |
`,
		);
		const differentBatchSupersededTarget = writeFixture(
			"different-batch-superseded-target.md",
			`${ledger}
## Batches

\`\`\`yaml
batches:
  - id: "one"
    name: "One"
    goal: "AC 1"
    files:
      - "src/one.ts"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds"
    ac_mapping:
      - 1
    rationale: null
    status: pending
    builder_commits: []
    iterations: 0
    final_verdict: null
\`\`\`

## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "one"
    signature: "same"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "superseded"
    summary: "Superseded finding"
    resolution: "superseded-by-f2"
  - id: "f2"
    batch_id: "final"
    signature: "same"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "open"
    summary: "Open target"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | one | same | ce-correctness-reviewer | P1 | superseded | Superseded finding | superseded-by-f2 |
| f2 | final | same | ce-correctness-reviewer | P1 | open | Open target |  |
`,
		);
		const nonTerminalPatchResult = await runDecompose([
			"--validate-findings",
			nonTerminalPatch,
		]);
		const acceptedRiskMissingReasonResult = await runDecompose([
			"--validate-findings",
			acceptedRiskMissingReason,
		]);
		const fakeCommitResolutionResult = await runDecompose([
			"--validate-findings",
			fakeCommitResolution,
		]);
		const unownedCommitResolutionResult = await runDecompose([
			"--validate-findings",
			unownedCommitResolution,
		]);
		const outOfScopeMissingReasonResult = await runDecompose([
			"--validate-findings",
			outOfScopeMissingReason,
		]);
		const adrMismatchResult = await runDecompose([
			"--validate-findings",
			adrMismatch,
		]);
		const badSupersededResult = await runDecompose([
			"--validate-findings",
			badSuperseded,
		]);
		const missingSupersededTargetResult = await runDecompose([
			"--validate-findings",
			missingSupersededTarget,
		]);
		const selfSupersededResult = await runDecompose([
			"--validate-findings",
			selfSuperseded,
		]);
		const supersededTargetResult = await runDecompose([
			"--validate-findings",
			supersededTarget,
		]);
		const differentSignatureSupersededTargetResult = await runDecompose([
			"--validate-findings",
			differentSignatureSupersededTarget,
		]);
		const lowerSeveritySupersededTargetResult = await runDecompose([
			"--validate-findings",
			lowerSeveritySupersededTarget,
		]);
		const differentBatchSupersededTargetResult = await runDecompose([
			"--validate-findings",
			differentBatchSupersededTarget,
		]);

		expect(nonTerminalPatchResult.exitCode).toBe(1);
		expect(nonTerminalPatchResult.stderr).toContain(
			"must reference a terminal patch batch",
		);
		expect(acceptedRiskMissingReasonResult.exitCode).toBe(1);
		expect(acceptedRiskMissingReasonResult.stderr).toContain(
			"accepted-risk resolution must start",
		);
		expect(fakeCommitResolutionResult.exitCode).toBe(1);
		expect(fakeCommitResolutionResult.stderr).toContain(
			'fixed commit "0000000" must exist',
		);
		expect(unownedCommitResolutionResult.exitCode).toBe(1);
		expect(unownedCommitResolutionResult.stderr).toContain(
			"must be recorded in a terminal ledger batch",
		);
		expect(outOfScopeMissingReasonResult.exitCode).toBe(1);
		expect(outOfScopeMissingReasonResult.stderr).toContain(
			"out-of-scope resolution must start",
		);
		expect(adrMismatchResult.exitCode).toBe(1);
		expect(adrMismatchResult.stderr).toContain(
			"ADR contradiction resolution must match status",
		);
		expect(badSupersededResult.exitCode).toBe(1);
		expect(badSupersededResult.stderr).toContain(
			'superseded resolution must be "superseded-by-<finding-id>"',
		);
		expect(missingSupersededTargetResult.exitCode).toBe(1);
		expect(missingSupersededTargetResult.stderr).toContain(
			'supersedes unknown finding "f2"',
		);
		expect(selfSupersededResult.exitCode).toBe(1);
		expect(selfSupersededResult.stderr).toContain("cannot supersede itself");
		expect(supersededTargetResult.exitCode).toBe(1);
		expect(supersededTargetResult.stderr).toContain(
			"must supersede a canonical finding",
		);
		expect(differentSignatureSupersededTargetResult.exitCode).toBe(1);
		expect(differentSignatureSupersededTargetResult.stderr).toContain(
			"same signature",
		);
		expect(differentBatchSupersededTargetResult.exitCode).toBe(1);
		expect(differentBatchSupersededTargetResult.stderr).toContain(
			"same batch_id",
		);
		expect(lowerSeveritySupersededTargetResult.exitCode).toBe(1);
		expect(lowerSeveritySupersededTargetResult.stderr).toContain(
			"must not supersede a lower-severity finding",
		);
	});

	test("rejects invalid findings data statuses", async () => {
		const ledgerPath = writeFixture(
			"ledger.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "sig-one"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "needs-fix"
    summary: "Something is wrong"
    resolution: null
\`\`\`
`,
		);

		const result = await runDecompose(["--validate-findings", ledgerPath]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('invalid status "needs-fix"');
	});

	test("rejects findings data severity and rendered table drift", async () => {
		const badSeverityStatus = writeFixture(
			"bad-severity-status.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "sig-one"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "deferred-P2"
    summary: "Something is wrong"
    resolution: "deferred-P2"
\`\`\`
`,
		);
		const mixedEmptyAndRows = writeFixture(
			"mixed-empty-and-rows.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings: []
  - id: "f1"
    batch_id: "final"
    signature: "sig-one"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "open"
    summary: "Something is wrong"
    resolution: null
\`\`\`
`,
		);
		const missingTableRow = writeFixture(
			"missing-table-row.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "sig-one"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "open"
    summary: "Something is wrong"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
`,
		);
		const staleTable = writeFixture(
			"stale-table.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings: []
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | sig-one | ce-correctness-reviewer | P1 | open | Something is wrong |  |
`,
		);
		const severityDrift = writeFixture(
			"severity-drift.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "sig-one"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "open"
    summary: "Something is wrong"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | sig-one | ce-correctness-reviewer | P2 | open | Something is wrong |  |
`,
		);
		const summaryDrift = writeFixture(
			"summary-drift.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "sig-one"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "open"
    summary: "Something is wrong"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | sig-one | ce-correctness-reviewer | P1 | open | Different summary |  |
`,
		);
		const badFixedResolution = writeFixture(
			"bad-fixed-resolution.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "sig-one"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "fixed"
    summary: "Something is wrong"
    resolution: "trust me"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | sig-one | ce-correctness-reviewer | P1 | fixed | Something is wrong | trust me |
`,
		);
		const unknownBatch = writeFixture(
			"unknown-batch.md",
			`${ledger}
## Batches

\`\`\`yaml
batches: []
\`\`\`

## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "typo-batch"
    signature: "sig-one"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "open"
    summary: "Something is wrong"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | typo-batch | sig-one | ce-correctness-reviewer | P1 | open | Something is wrong |  |
`,
		);
		const duplicateFindingIds = writeFixture(
			"duplicate-finding-ids.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "sig-one"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "open"
    summary: "Something is wrong"
    resolution: null
  - id: "f1"
    batch_id: "final"
    signature: "sig-two"
    persona: "ce-testing-reviewer"
    severity: "P2"
    status: "deferred-P2"
    summary: "Nice to improve"
    resolution: "deferred-P2"
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | sig-one | ce-correctness-reviewer | P1 | open | Something is wrong |  |
`,
		);
		const duplicateTableIds = writeFixture(
			"duplicate-table-ids.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings:
  - id: "f1"
    batch_id: "final"
    signature: "sig-one"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "open"
    summary: "Something is wrong"
    resolution: null
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | sig-one | ce-correctness-reviewer | P1 | open | Something is wrong |  |
| f1 | final | sig-one | ce-correctness-reviewer | P1 | open | Something is wrong |  |
`,
		);
		const duplicateFindingsSection = writeFixture(
			"duplicate-findings-section.md",
			`${ledger}
## Findings data

\`\`\`yaml
findings: []
\`\`\`

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Findings

| id | batch_id | signature | persona | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | final | sig-one | ce-correctness-reviewer | P1 | open | Something is wrong |  |
`,
		);

		const badSeverityResult = await runDecompose([
			"--validate-findings",
			badSeverityStatus,
		]);
		const mixedResult = await runDecompose([
			"--validate-findings",
			mixedEmptyAndRows,
		]);
		const missingTableRowResult = await runDecompose([
			"--validate-findings",
			missingTableRow,
		]);
		const staleTableResult = await runDecompose([
			"--validate-findings",
			staleTable,
		]);
		const severityDriftResult = await runDecompose([
			"--validate-findings",
			severityDrift,
		]);
		const summaryDriftResult = await runDecompose([
			"--validate-findings",
			summaryDrift,
		]);
		const badFixedResolutionResult = await runDecompose([
			"--validate-findings",
			badFixedResolution,
		]);
		const unknownBatchResult = await runDecompose([
			"--validate-findings",
			unknownBatch,
		]);
		const duplicateFindingIdsResult = await runDecompose([
			"--validate-findings",
			duplicateFindingIds,
		]);
		const duplicateTableIdsResult = await runDecompose([
			"--validate-findings",
			duplicateTableIds,
		]);
		const duplicateFindingsSectionResult = await runDecompose([
			"--validate-findings",
			duplicateFindingsSection,
		]);

		expect(badSeverityResult.exitCode).toBe(1);
		expect(badSeverityResult.stderr).toContain("cannot use status deferred-P2");
		expect(mixedResult.exitCode).toBe(1);
		expect(mixedResult.stderr).toContain(
			"cannot mix findings: [] with finding rows",
		);
		expect(missingTableRowResult.exitCode).toBe(1);
		expect(missingTableRowResult.stderr).toContain(
			'## Findings data row "f1" is missing from the rendered findings table',
		);
		expect(staleTableResult.exitCode).toBe(1);
		expect(staleTableResult.stderr).toContain(
			'findings table row "f1" is missing from ## Findings data',
		);
		expect(severityDriftResult.exitCode).toBe(1);
		expect(severityDriftResult.stderr).toContain("severity does not match");
		expect(summaryDriftResult.exitCode).toBe(1);
		expect(summaryDriftResult.stderr).toContain("summary does not match");
		expect(badFixedResolutionResult.exitCode).toBe(1);
		expect(badFixedResolutionResult.stderr).toContain(
			'fixed resolution must be "commit <sha>" or "patch-batch patch-NNN"',
		);
		expect(unknownBatchResult.exitCode).toBe(1);
		expect(unknownBatchResult.stderr).toContain(
			'unknown batch_id "typo-batch"',
		);
		expect(duplicateFindingIdsResult.exitCode).toBe(1);
		expect(duplicateFindingIdsResult.stderr).toContain(
			'findings data ids contains duplicate "f1"',
		);
		expect(duplicateTableIdsResult.exitCode).toBe(1);
		expect(duplicateTableIdsResult.stderr).toContain(
			'findings table ids contains duplicate "f1"',
		);
		expect(duplicateFindingsSectionResult.exitCode).toBe(1);
		expect(duplicateFindingsSectionResult.stderr).toContain(
			"duplicate '## Findings' sections",
		);
	});
});
