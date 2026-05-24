import { describe, expect, test } from "bun:test";
import { execPath } from "node:process";
import { join } from "node:path";

/**
 * Process-boundary tests for the Stage 5 read-only enforcement gate
 * (`decompose.ts --assert-stage5-readonly <ledger-path> <commit-ref>`).
 *
 * Stage 5 (final review) is read-only: a Stage 5 ledger checkpoint commit
 * must touch ONLY the per-issue ledger path. A prior run's commit 8be31d4
 * edited non-ledger files during final review and no gate caught it; this
 * gate closes that hole.
 *
 * Fixtures (reachable from HEAD on this branch, confirmed via
 * `git show --stat <sha>`):
 *   - VIOLATION: 8be31d4 touches 5 non-ledger runbook files and does NOT
 *     touch the issue-71 ledger. Passing it the issue-71 ledger path proves
 *     the gate rejects a checkpoint that touched non-ledger files, naming the
 *     first offending non-ledger path.
 *   - PASS: 1315477 (the start-batch checkpoint) touches ONLY
 *     docs/runbooks/issue-to-pr/issue-71-ledger.md.
 *   - EMPTY/NO-OP edge: an in-memory empty commit (created via a fixture
 *     repo, see below) touches zero files. Per the gate's intent ("touches
 *     ONLY the ledger"), a no-op checkpoint satisfies the constraint
 *     vacuously and PASSES (exit 0).
 *   - MERGE: dc6868a is the PR-70 merge commit (2 parents, reachable from
 *     HEAD, confirmed via `git show --no-patch --format=%P dc6868a`). A merge
 *     commit must be REJECTED outright: a Stage 5 final-review checkpoint is a
 *     single non-merge ledger-only commit, and `git diff-tree` (without -m/-c)
 *     emits zero rows for a merge, which would otherwise let a merge that
 *     pulled non-ledger files into the branch vacuously bypass the gate.
 */

const scriptPath = join(import.meta.dir, "..", "decompose.ts");
const bunExecutable = execPath || "bun";

const ISSUE_71_LEDGER = "docs/runbooks/issue-to-pr/issue-71-ledger.md";
const VIOLATION_COMMIT = "8be31d4";
const LEDGER_ONLY_COMMIT = "1315477";
const MERGE_COMMIT = "dc6868a";

async function runDecompose(args: string[], options: { cwd?: string } = {}) {
	const proc = Bun.spawn([bunExecutable, scriptPath, ...args], {
		cwd: options.cwd,
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

describe("decompose.ts --assert-stage5-readonly", () => {
	test("rejects a checkpoint commit that touched a non-ledger path", async () => {
		// 8be31d4 touched only non-ledger runbook files. Asked to enforce that
		// the commit is read-only w.r.t. the issue-71 ledger, the gate must fail
		// and name the first offending non-ledger path.
		const result = await runDecompose([
			"--assert-stage5-readonly",
			ISSUE_71_LEDGER,
			VIOLATION_COMMIT,
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("runbooks/issue-to-pr-v2/issue-to-pr.md");
	});

	test("passes a checkpoint commit that touched only the ledger path", async () => {
		// 1315477 touched only docs/runbooks/issue-to-pr/issue-71-ledger.md.
		const result = await runDecompose([
			"--assert-stage5-readonly",
			ISSUE_71_LEDGER,
			LEDGER_ONLY_COMMIT,
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
	});

	test("rejects a merge commit as an invalid Stage 5 checkpoint", async () => {
		// dc6868a is the PR-70 merge commit (2 parents). `git diff-tree` without
		// -m/-c emits zero file rows for a merge, so the touched-file set is empty
		// and the gate would vacuously PASS even though the merge pulled non-ledger
		// files into the branch. A Stage 5 final-review checkpoint must be a single
		// non-merge ledger-only commit, so a merge must be REJECTED outright.
		const result = await runDecompose([
			"--assert-stage5-readonly",
			ISSUE_71_LEDGER,
			MERGE_COMMIT,
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("merge commit");
	});

	test("passes a no-op (empty) checkpoint commit as a vacuous read-only pass", async () => {
		// Build a throwaway repo with an empty commit so the touched-file set is
		// empty. An empty checkpoint touches no non-ledger file, so it satisfies
		// the "touches ONLY the ledger" constraint vacuously and passes.
		const repo = await makeEmptyCommitRepo();
		try {
			const result = await runDecompose(
				["--assert-stage5-readonly", ISSUE_71_LEDGER, "HEAD"],
				{ cwd: repo },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
		} finally {
			await Bun.spawn(["rm", "-rf", repo]).exited;
		}
	});

	test("rejects missing arguments", async () => {
		const result = await runDecompose(["--assert-stage5-readonly", ISSUE_71_LEDGER]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("usage:");
	});
});

async function makeEmptyCommitRepo(): Promise<string> {
	const dir = new TextDecoder()
		.decode(Bun.spawnSync(["mktemp", "-d"]).stdout)
		.trim();
	const run = async (args: string[]) => {
		const p = Bun.spawn(args, { cwd: dir, stderr: "pipe", stdout: "pipe" });
		await p.exited;
	};
	await run(["git", "init", "-q"]);
	await run(["git", "config", "user.email", "test@example.com"]);
	await run(["git", "config", "user.name", "Test"]);
	await run(["git", "commit", "-q", "--allow-empty", "-m", "empty checkpoint"]);
	return dir;
}
