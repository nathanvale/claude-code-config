import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import {
	checkWorktree,
	cleanPreview,
	deleteWorktree,
	refreshWorktrees,
	statusWorktrees,
} from "../src/worktrees.ts";
import { inspectRefFromRoot } from "../src/inspect.ts";
import { createFileStore } from "../src/store.ts";
import { fakeGitRunner, linkedRepoGitOutputs } from "./support.ts";

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
		expect(result.totalRegisteredWorktrees).toBe(2);
		expect(result.totalOrphanBranches).toBe(2);
		expect(result.totalStaleDirs).toBe(2);
		expect(result.truncated).toBe(true);
		expect(calls.some((call) => call.includes("branch -D"))).toBe(false);
		expect(calls.some((call) => call.includes("worktree remove"))).toBe(false);
	});
});

	describe("agent-worktree lifecycle writes", () => {
		test("delete records partial failure with backup ref when branch deletion fails", async () => {
			const { root, linked } = await createLinkedWorktreeFixture("awt-delete-");

			const result = await deleteWorktree({
				...deleteFixtureOptions(
					root,
					deleteFixtureRunner(root, linked, {
						extra: {
							[`git worktree remove ${linked}`]: "",
							["git update-ref refs/agent-worktree/backups/feat-x/facade_run feat/x"]:
								"",
						},
					}),
				),
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
		const inspectedRun = await inspectRefFromRoot(
			join(root, ".agent-worktree"),
			"run:facade_run",
		);
		expect(
			(
				inspectedRun?.record as {
					events?: readonly { kind: string; stepId?: string }[];
				}
			).events,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "run_started" }),
				expect.objectContaining({
					kind: "step_failed",
					stepId: "delete_branch",
				}),
			]),
		);
	});

		test("delete stops before branch deletion when backup ref creation fails", async () => {
			const { root, linked } =
				await createLinkedWorktreeFixture("awt-backup-fail-");
			const calls: string[] = [];

			const result = await deleteWorktree({
				...deleteFixtureOptions(root, async (args, options) => {
					calls.push(args.join(" "));
					return deleteFixtureRunner(root, linked, {
						extra: {
							[`git worktree remove ${linked}`]: "",
						},
					})(args, options);
				}),
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
			const { root, linked } =
				await createLinkedWorktreeFixture("awt-dirty-block-");

			const result = await deleteWorktree({
				...deleteFixtureOptions(
					root,
					deleteFixtureRunner(root, linked, { status: " M file.txt\n" }),
				),
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

	test("refresh records path-stable worktree ids when labels collide", async () => {
		const root = await mkdtemp(join(tmpdir(), "awt-refresh-ids-"));
		const first = join(root, "a", "same");
		const second = join(root, "b", "same");

		const result = await refreshWorktrees({
			cwd: root,
			dryRun: false,
			runId: "refresh/run",
			now: () => 10,
			run: fakeGitRunner({
				["git rev-parse --show-toplevel"]: `${root}\n`,
				["git worktree list --porcelain"]: `worktree ${root}
HEAD abc
branch refs/heads/main

worktree ${first}
HEAD def
detached

worktree ${second}
HEAD ghi
detached
`,
				["git branch --show-current"]: "main\n",
				["git symbolic-ref --short refs/remotes/origin/HEAD"]:
					"origin/main\n",
			}),
		});

		expect(result.changedState).toBe("complete");
		const records = await createFileStore(
			join(root, ".agent-worktree"),
		).listWorktrees();
		const detachedIds = records
			.filter((record) => record.branch === "(detached)")
			.map((record) => record.ref.id);

		expect(detachedIds).toHaveLength(2);
		expect(new Set(detachedIds).size).toBe(2);
	});
});

async function createLinkedWorktreeFixture(
	prefix: string,
): Promise<{ root: string; linked: string }> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	const linked = join(root, ".worktrees", "feat-x");
	await mkdir(linked, { recursive: true });
	return { root, linked };
}

function deleteFixtureRunner(
	root: string,
	linked: string,
	options?: Parameters<typeof linkedRepoGitOutputs>[2],
): NonNullable<Parameters<typeof deleteWorktree>[0]["run"]> {
	return fakeGitRunner(linkedRepoGitOutputs(root, linked, options));
}

function deleteFixtureOptions(
	root: string,
	run: NonNullable<Parameters<typeof deleteWorktree>[0]["run"]>,
): Parameters<typeof deleteWorktree>[0] {
	return {
		cwd: root,
		branch: "feat/x",
		dryRun: false,
		force: true,
		deleteBranch: true,
		runId: "facade/run",
		run,
	};
}
