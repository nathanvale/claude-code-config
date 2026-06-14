import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import type { GitRunner } from "../src/discovery.ts";
import {
	checkWorktree,
	cleanPreview,
	deleteWorktree,
	statusWorktrees,
} from "../src/worktrees.ts";
import { inspectRefFromRoot } from "../src/inspect.ts";

describe("agent-worktree lifecycle reads", () => {
	test("status does not treat cherry output as squash merge proof", async () => {
		const run = fakeGitRunner({
			["git rev-parse --show-toplevel"]: "/repo\n",
			["git worktree list --porcelain"]: `worktree /repo
HEAD abc
branch refs/heads/main

worktree /repo/.worktrees/feat-x
HEAD def
branch refs/heads/feat/x
`,
			["git branch --show-current"]: "feat/x\n",
			["git symbolic-ref --short refs/remotes/origin/HEAD"]: "origin/main\n",
			["git status --porcelain"]: "",
			["git rev-parse --is-shallow-repository"]: "false\n",
			["git merge-base --is-ancestor main main"]: "",
			["git rev-list --left-right --count main...main"]: "0 0\n",
			["git rev-list --left-right --count main...feat/x"]: "1 0\n",
		});

		const rows = await statusWorktrees({ cwd: "/repo/.worktrees/feat-x", run });
		const feature = rows.find((row) => row.worktree.branch === "feat/x");

		expect(feature?.mergeEvidence?.method).toBeUndefined();
		expect(feature?.safety?.reason).toBe("evidence_unreliable");
	});

	test("check blocks dirty linked worktrees", async () => {
		const result = await checkWorktree({
			cwd: "/repo",
			branch: "feat/x",
			run: fakeGitRunner({
				["git rev-parse --show-toplevel"]: "/repo\n",
				["git worktree list --porcelain"]: `worktree /repo
HEAD abc
branch refs/heads/main

worktree /repo/.worktrees/feat-x
HEAD def
branch refs/heads/feat/x
`,
				["git branch --show-current"]: "main\n",
				["git symbolic-ref --short refs/remotes/origin/HEAD"]: "origin/main\n",
				["git status --porcelain"]: " M file.txt\n",
				["git rev-parse --is-shallow-repository"]: "false\n",
				["git merge-base --is-ancestor feat/x main"]: "",
				["git rev-list --left-right --count main...feat/x"]: "1 0\n",
			}),
		});

		expect(result.allowed).toBe(false);
		expect(result.mutationReadiness).toBe("blocked");
		expect(result.decision.reason).toBe("dirty");
	});

	test("check routes unknown default branch to handoff instead of guessing main", async () => {
		const result = await checkWorktree({
			cwd: "/repo",
			branch: "feat/x",
			run: fakeGitRunner({
				["git rev-parse --show-toplevel"]: "/repo\n",
				["git worktree list --porcelain"]: `worktree /repo
HEAD abc
branch refs/heads/main

worktree /repo/.worktrees/feat-x
HEAD def
branch refs/heads/feat/x
`,
				["git branch --show-current"]: "main\n",
				["git status --porcelain"]: "",
			}),
		});

		expect(result.allowed).toBe(false);
		expect(result.decision.reason).toBe("evidence_unreliable");
		expect(result.evidence.issues[0]?.message).toContain("Default branch");
	});

	test("clean previews orphan branches and stale dirs without destructive git calls", async () => {
		const root = await mkdtemp(join(tmpdir(), "awt-clean-"));
		const linked = join(root, ".worktrees", "feat-x");
		const stale = join(root, ".worktrees", "stale");
		const staleTwo = join(root, ".worktrees", "stale-two");
		await mkdir(linked, { recursive: true });
		await mkdir(stale, { recursive: true });
		await mkdir(staleTwo, { recursive: true });
		const calls: string[] = [];

		const result = await cleanPreview({
			cwd: root,
			limit: 1,
			run: async (args, options) => {
				calls.push(args.join(" "));
				return fakeGitRunner({
					["git rev-parse --show-toplevel"]: `${root}\n`,
					["git worktree list --porcelain"]: `worktree ${root}
HEAD abc
branch refs/heads/main

worktree ${linked}
HEAD def
branch refs/heads/feat/x
`,
					["git branch --show-current"]: "main\n",
					["git symbolic-ref --short refs/remotes/origin/HEAD"]:
						"origin/main\n",
					["git status --porcelain"]: "",
					["git rev-parse --is-shallow-repository"]: "false\n",
					["git merge-base --is-ancestor main main"]: "",
					["git rev-list --left-right --count main...main"]: "0 0\n",
					["git merge-base --is-ancestor feat/x main"]: "",
					["git rev-list --left-right --count main...feat/x"]: "1 0\n",
					["git for-each-ref --format=%(refname:short) refs/heads"]:
						"main\nfeat/x\nold/branch\nold/two\n",
				})(args, options);
			},
		});

		expect(result.previewOnly).toBe(true);
		expect(result.orphanBranches).toEqual(["old/branch"]);
		expect(result.staleDirs).toEqual([stale]);
		expect(calls.some((call) => call.includes("branch -D"))).toBe(false);
		expect(calls.some((call) => call.includes("worktree remove"))).toBe(false);
	});
});

describe("agent-worktree lifecycle writes", () => {
	test("delete records partial failure with backup ref when branch deletion fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "awt-delete-"));
		const linked = join(root, ".worktrees", "feat-x");
		await mkdir(linked, { recursive: true });

		const result = await deleteWorktree({
			cwd: root,
			branch: "feat/x",
			dryRun: false,
			force: true,
			deleteBranch: true,
			runId: "facade/run",
			run: fakeGitRunner({
				["git rev-parse --show-toplevel"]: `${root}\n`,
				["git worktree list --porcelain"]: `worktree ${root}
HEAD abc
branch refs/heads/main

worktree ${linked}
HEAD def
branch refs/heads/feat/x
`,
				["git branch --show-current"]: "main\n",
				["git symbolic-ref --short refs/remotes/origin/HEAD"]:
					"origin/main\n",
				["git status --porcelain"]: "",
				["git rev-parse --is-shallow-repository"]: "false\n",
				["git merge-base --is-ancestor feat/x main"]: "",
				["git rev-list --left-right --count main...feat/x"]: "1 0\n",
				[`git worktree remove ${linked}`]: "",
				["git update-ref refs/agent-worktree/backups/feat-x/facade_run feat/x"]:
					"",
			}),
		});

		expect(result.changedState).toBe("partial");
		expect(result.backupRef).toBe(
			"refs/agent-worktree/backups/feat-x/facade_run",
		);
		expect(result.failureRef).toEqual({
			kind: "failure",
			id: "facade_run/delete_branch",
		});

		const inspected = await inspectRefFromRoot(
			join(root, ".agent-worktree"),
			"failure:facade_run/delete_branch",
		);
		expect(inspected?.found).toBe(true);
		expect((inspected?.record as { changedState?: string }).changedState).toBe(
			"partial",
		);
	});

	test("delete stops before branch deletion when backup ref creation fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "awt-backup-fail-"));
		const linked = join(root, ".worktrees", "feat-x");
		await mkdir(linked, { recursive: true });
		const calls: string[] = [];

		const result = await deleteWorktree({
			cwd: root,
			branch: "feat/x",
			dryRun: false,
			force: true,
			deleteBranch: true,
			runId: "facade/run",
			run: async (args, options) => {
				calls.push(args.join(" "));
				return fakeGitRunner({
					["git rev-parse --show-toplevel"]: `${root}\n`,
					["git worktree list --porcelain"]: `worktree ${root}
HEAD abc
branch refs/heads/main

worktree ${linked}
HEAD def
branch refs/heads/feat/x
`,
					["git branch --show-current"]: "main\n",
					["git symbolic-ref --short refs/remotes/origin/HEAD"]:
						"origin/main\n",
					["git status --porcelain"]: "",
					["git rev-parse --is-shallow-repository"]: "false\n",
					["git merge-base --is-ancestor feat/x main"]: "",
					["git rev-list --left-right --count main...feat/x"]: "1 0\n",
					[`git worktree remove ${linked}`]: "",
				})(args, options);
			},
		});

		expect(result.changedState).toBe("partial");
		expect(result.failureRef).toEqual({
			kind: "failure",
			id: "facade_run/create_backup_ref",
		});
		expect(result.backupRef).toBeUndefined();
		expect(calls.some((call) => call.includes("branch -D"))).toBe(false);
	});

	test("delete records dirty preflight blocks as durable failure evidence", async () => {
		const root = await mkdtemp(join(tmpdir(), "awt-dirty-block-"));
		const linked = join(root, ".worktrees", "feat-x");
		await mkdir(linked, { recursive: true });

		const result = await deleteWorktree({
			cwd: root,
			branch: "feat/x",
			dryRun: false,
			force: true,
			deleteBranch: true,
			runId: "facade/run",
			run: fakeGitRunner({
				["git rev-parse --show-toplevel"]: `${root}\n`,
				["git worktree list --porcelain"]: `worktree ${root}
HEAD abc
branch refs/heads/main

worktree ${linked}
HEAD def
branch refs/heads/feat/x
`,
				["git branch --show-current"]: "main\n",
				["git symbolic-ref --short refs/remotes/origin/HEAD"]:
					"origin/main\n",
				["git status --porcelain"]: " M file.txt\n",
				["git rev-parse --is-shallow-repository"]: "false\n",
				["git merge-base --is-ancestor feat/x main"]: "",
				["git rev-list --left-right --count main...feat/x"]: "1 0\n",
			}),
		});

		expect(result.changedState).toBe("none");
		expect(result.reason).toBe("dirty");
		expect(result.recovery?.choices[0]?.handoffReason).toBe("dirty_state");
		expect(result.failureRef).toEqual({
			kind: "failure",
			id: "facade_run/preflight_blocked",
		});

		const inspected = await inspectRefFromRoot(
			join(root, ".agent-worktree"),
			"failure:facade_run/preflight_blocked",
		);
		expect(inspected?.found).toBe(true);
		expect(
			(inspected?.record as { whatHappened?: string }).whatHappened,
		).toContain("dirty");
	});
});

function fakeGitRunner(outputs: Record<string, string>): GitRunner {
	return async (args) => {
		const stdout = outputs[args.join(" ")];
		return stdout === undefined
			? { ok: false, stdout: "", stderr: "missing fake output", code: 1 }
			: { ok: true, stdout, stderr: "", code: 0 };
	};
}
