import { describe, expect, test } from "bun:test";
import { execPath } from "node:process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

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

describe("decompose.ts final metadata gates", () => {
	test("pre-commit scope passes for ledger plus registry changes", async () => {
		const repo = await makeFinalMetadataRepo();
		try {
			await appendFile(repo, ISSUE_71_LEDGER, "\nledger update\n");
			await appendFile(
				repo,
				"runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md",
				"\nregistry update\n",
			);

			const result = await runDecompose(
				["--assert-final-metadata-scope", ISSUE_71_LEDGER],
				{ cwd: repo },
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
		} finally {
			await Bun.spawn(["rm", "-rf", repo]).exited;
		}
	});

	test("pre-commit scope rejects third modified, staged, and untracked paths", async () => {
		const cases = [
			async (repo: string) => appendFile(repo, "src/app.ts", "\nmodified\n"),
			async (repo: string) => {
				await appendFile(repo, "src/app.ts", "\nstaged\n");
				await Bun.spawn(["git", "add", "src/app.ts"], { cwd: repo }).exited;
			},
			async (repo: string) => appendFile(repo, "notes.md", "untracked\n"),
		];

		for (const setup of cases) {
			const repo = await makeFinalMetadataRepo();
			try {
				await setup(repo);
				const result = await runDecompose(
					["--assert-final-metadata-scope", ISSUE_71_LEDGER],
					{ cwd: repo },
				);

				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("final metadata scope gate");
			} finally {
				await Bun.spawn(["rm", "-rf", repo]).exited;
			}
		}
	});

	test("pre-commit scope rejects deleting the registry", async () => {
		const repo = await makeFinalMetadataRepo();
		try {
			await Bun.spawn(
				[
					"git",
					"rm",
					"-q",
					"runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md",
				],
				{ cwd: repo },
			).exited;

			const result = await runDecompose(
				["--assert-final-metadata-scope", ISSUE_71_LEDGER],
				{ cwd: repo },
			);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("staged changes delete");
		} finally {
			await Bun.spawn(["rm", "-rf", repo]).exited;
		}
	});

	test("pre-commit scope rejects staged registry deletion even when working tree has a restored copy", async () => {
		const repo = await makeFinalMetadataRepo();
		try {
			const registryPath =
				"runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md";
			await Bun.spawn(["git", "rm", "-q", registryPath], { cwd: repo }).exited;
			await writeFixtureFile(
				repo,
				registryPath,
				"# Workflow Learnings registry\n\n```yaml\nlearnings: []\n```\n",
			);

			const result = await runDecompose(
				["--assert-final-metadata-scope", ISSUE_71_LEDGER],
				{ cwd: repo },
			);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("staged changes delete");
		} finally {
			await Bun.spawn(["rm", "-rf", repo]).exited;
		}
	});

	test("pre-commit scope validates an untracked registry", async () => {
		const repo = await makeFinalMetadataRepo();
		try {
			const registryPath =
				"runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md";
			await Bun.spawn(["git", "rm", "-q", registryPath], { cwd: repo }).exited;
			await Bun.spawn(["git", "commit", "-q", "-m", "delete registry"], {
				cwd: repo,
			}).exited;
			await writeFixtureFile(
				repo,
				registryPath,
				"# Workflow Learnings registry\n\n```yaml\nlearnings:\n```\n",
			);

			const result = await runDecompose(
				["--assert-final-metadata-scope", ISSUE_71_LEDGER],
				{ cwd: repo },
			);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Workflow Learnings registry");
		} finally {
			await Bun.spawn(["rm", "-rf", repo]).exited;
		}
	});

	test("post-commit gate passes for ledger and registry commit", async () => {
		const repo = await makeFinalMetadataRepo();
		try {
			await appendFile(repo, ISSUE_71_LEDGER, "\nledger update\n");
			await appendFile(
				repo,
				"runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md",
				"\nregistry update\n",
			);
			await commitAll(repo, "metadata");

			const result = await runDecompose(
				["--assert-final-metadata-commit", ISSUE_71_LEDGER, "HEAD"],
				{ cwd: repo },
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
		} finally {
			await Bun.spawn(["rm", "-rf", repo]).exited;
		}
	});

	test("post-commit gate rejects a third touched path and merge commit", async () => {
		const repo = await makeFinalMetadataRepo();
		try {
			await appendFile(repo, "src/app.ts", "\nsource update\n");
			await commitAll(repo, "source");
			const thirdPath = await runDecompose(
				["--assert-final-metadata-commit", ISSUE_71_LEDGER, "HEAD"],
				{ cwd: repo },
			);
			expect(thirdPath.exitCode).toBe(1);
			expect(thirdPath.stderr).toContain("non-metadata path");

			await Bun.spawn(["git", "checkout", "-q", "-b", "side"], {
				cwd: repo,
			}).exited;
			await appendFile(repo, ISSUE_71_LEDGER, "\nside\n");
			await commitAll(repo, "side");
			await Bun.spawn(["git", "checkout", "-q", "main"], { cwd: repo }).exited;
			await appendFile(
				repo,
				"runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md",
				"\nmain\n",
			);
			await commitAll(repo, "main");
			await Bun.spawn(["git", "merge", "--no-ff", "-m", "merge side", "side"], {
				cwd: repo,
			}).exited;

			const merge = await runDecompose(
				["--assert-final-metadata-commit", ISSUE_71_LEDGER, "HEAD"],
				{ cwd: repo },
			);
			expect(merge.exitCode).toBe(1);
			expect(merge.stderr).toContain("merge commit");
		} finally {
			await Bun.spawn(["rm", "-rf", repo]).exited;
		}
	});

	test("post-commit gate rejects deleting the registry", async () => {
		const repo = await makeFinalMetadataRepo();
		try {
			await Bun.spawn(
				[
					"git",
					"rm",
					"-q",
					"runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md",
				],
				{ cwd: repo },
			).exited;
			await Bun.spawn(["git", "commit", "-q", "-m", "delete registry"], {
				cwd: repo,
			}).exited;

			const result = await runDecompose(
				["--assert-final-metadata-commit", ISSUE_71_LEDGER, "HEAD"],
				{ cwd: repo },
			);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("deletes the Workflow Learnings registry");
		} finally {
			await Bun.spawn(["rm", "-rf", repo]).exited;
		}
	});

	test("final metadata gates can emit machine-readable JSON", async () => {
		const repo = await makeFinalMetadataRepo();
		try {
			await appendFile(repo, "src/app.ts", "\nsource update\n");
			const result = await runDecompose(
				["--assert-final-metadata-scope", ISSUE_71_LEDGER, "--json"],
				{ cwd: repo },
			);

			expect(result.exitCode).toBe(1);
			const payload = JSON.parse(result.stdout) as {
				ok: boolean;
				gate: string;
				offending_path: string;
			};
			expect(payload).toMatchObject({
				ok: false,
				gate: "final-metadata-scope",
				offending_path: "src/app.ts",
			});
		} finally {
			await Bun.spawn(["rm", "-rf", repo]).exited;
		}
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

async function makeFinalMetadataRepo(): Promise<string> {
	const dir = new TextDecoder()
		.decode(Bun.spawnSync(["mktemp", "-d"]).stdout)
		.trim();
	const run = async (args: string[]) => {
		const p = Bun.spawn(args, { cwd: dir, stderr: "pipe", stdout: "pipe" });
		await p.exited;
	};
	await run(["git", "init", "-q", "-b", "main"]);
	await run(["git", "config", "user.email", "test@example.com"]);
	await run(["git", "config", "user.name", "Test"]);
	await writeFixtureFile(dir, ISSUE_71_LEDGER, "ledger\n");
	await writeFixtureFile(
		dir,
		"runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md",
		"# Workflow Learnings registry\n\n```yaml\nlearnings: []\n```\n",
	);
	await writeFixtureFile(dir, "src/app.ts", "source\n");
	await run(["git", "add", ISSUE_71_LEDGER]);
	await run([
		"git",
		"add",
		"runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md",
	]);
	await run(["git", "add", "src/app.ts"]);
	await run(["git", "commit", "-q", "-m", "base"]);
	return dir;
}

async function writeFixtureFile(
	repo: string,
	path: string,
	content: string,
): Promise<void> {
	const fullPath = join(repo, path);
	mkdirSync(dirname(fullPath), { recursive: true });
	await Bun.write(fullPath, content);
}

async function appendFile(repo: string, path: string, content: string): Promise<void> {
	const fullPath = join(repo, path);
	const existing = await Bun.file(fullPath).text().catch(() => "");
	await Bun.write(fullPath, `${existing}${content}`);
}

async function commitAll(repo: string, message: string): Promise<void> {
	await Bun.spawn(
		[
			"git",
			"add",
			ISSUE_71_LEDGER,
			"runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md",
			"src/app.ts",
		],
		{ cwd: repo },
	).exited;
	await Bun.spawn(["git", "commit", "-q", "-m", message], { cwd: repo }).exited;
}
