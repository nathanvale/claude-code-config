import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import {
	attachWorktree,
	checkWorktree,
	cleanPreview,
	createWorktree,
	deleteWorktree,
	listWorktrees,
	matchesWorktreePathPattern,
	refreshWorktrees,
	statusWorktrees,
} from "../src/worktrees.ts";
import { inspectRefFromRoot } from "../src/inspect.ts";
import { createFileStore } from "../src/store.ts";
import {
	fakeGitRunner,
	linkedRepoGitOutputs,
	mainRepoGitOutputs,
} from "./support.ts";

describe("agent-worktree lifecycle reads", () => {
	test("daily list and status hide configured worktree path patterns", async () => {
		const run = fakeGitRunner({
			["git rev-parse --show-toplevel"]: "/repo\n",
			["git worktree list --porcelain"]: `worktree /repo
HEAD abc
branch refs/heads/main

worktree /tmp/fallow-audit-base-cache-abc-123
HEAD 123
detached

worktree /repo/.worktrees/feat-x
HEAD def
branch refs/heads/feat/x
`,
			["git branch --show-current"]: "main\n",
			["git symbolic-ref --short refs/remotes/origin/HEAD"]: "origin/main\n",
			["git status --porcelain"]: "",
			["git rev-parse --is-shallow-repository"]: "false\n",
			["git merge-base --is-ancestor main main"]: "",
			["git rev-list --left-right --count main...main"]: "0 0\n",
			["git merge-base --is-ancestor feat/x main"]: "",
			["git rev-list --left-right --count main...feat/x"]: "1 0\n",
		});

		const ignoredWorktreePathPatterns = ["**/fallow-audit-base-cache-*"];
		const listed = await listWorktrees({
			cwd: "/repo",
			run,
			ignoredWorktreePathPatterns,
		});
		const statuses = await statusWorktrees({
			cwd: "/repo",
			run,
			ignoredWorktreePathPatterns,
		});

		expect(listed.total).toBe(2);
		expect(listed.worktrees.map((worktree) => worktree.path)).toEqual([
			"/repo",
			"/repo/.worktrees/feat-x",
		]);
		expect(statuses.map((status) => status.worktree.path)).toEqual([
			"/repo",
			"/repo/.worktrees/feat-x",
		]);
		expect(
			matchesWorktreePathPattern(
				"/tmp/fallow-audit-base-cache-abc-123",
				"**/fallow-audit-base-cache-*",
			),
		).toBe(true);
	});

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
		const root = await mkdtemp(join(tmpdir(), "agent-worktree-clean-"));
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
			ignoredWorktreePathPatterns: ["**/fallow-audit-base-cache-*"],
			run: async (args, options) => {
				calls.push(args.join(" "));
				return fakeGitRunner({
					["git rev-parse --show-toplevel"]: `${root}\n`,
					["git worktree list --porcelain"]: `worktree ${root}
HEAD abc
branch refs/heads/main

worktree /tmp/fallow-audit-base-cache-abc-123
HEAD 123
detached

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
		test("attach checks out an existing branch at the main owner path", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-branch-"));
			const target = join(root, ".worktrees", "feat-existing");
			const codexHome = join(root, "codex-home");
			const originalCodexHome = process.env.CODEX_HOME;
			const calls: string[] = [];
			const run = fakeGitRunner({
				...mainRepoGitOutputs(root),
				["git show-ref --verify --hash refs/heads/feat/existing"]: "def\n",
				[`git worktree add ${target} feat/existing`]: "",
			});

			process.env.CODEX_HOME = codexHome;
			const result = await attachWorktree({
				cwd: root,
				ref: "feat/existing",
				dryRun: false,
				runId: "attach/branch",
				run: async (args, options) => {
					calls.push(args.join(" "));
					return run(args, options);
				},
			}).finally(() => {
				if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
				else process.env.CODEX_HOME = originalCodexHome;
			});

			expect(result).toMatchObject({
				action: "attach",
				changedState: "complete",
				preview: false,
				resolvedRef: "def",
				targetPath: target,
				mode: "branch",
			});
			expect(calls).toContain(`git worktree add ${target} feat/existing`);
			expect(
				JSON.parse(
					await readFile(join(codexHome, ".codex-global-state.json"), "utf8"),
				),
			).toMatchObject({
				"electron-saved-workspace-roots": [target],
			});
		});

		test("attach checks out tags and commits in detached mode", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-detached-"));
			const tagTarget = join(root, ".worktrees", "v1.0.0");
			const commitTarget = join(root, ".worktrees", "abc1234");
			const run = fakeGitRunner({
				...mainRepoGitOutputs(root),
				["git rev-parse --verify v1.0.0^{commit}"]: "tag-commit\n",
				[`git worktree add --detach ${tagTarget} v1.0.0`]: "",
				["git rev-parse --verify abc1234^{commit}"]: "commit-object\n",
				[`git worktree add --detach ${commitTarget} abc1234`]: "",
			});

			const tag = await attachWorktree({
				cwd: root,
				ref: "v1.0.0",
				dryRun: false,
				runId: "attach/tag",
				run,
			});
			const commit = await attachWorktree({
				cwd: root,
				ref: "abc1234",
				dryRun: false,
				runId: "attach/commit",
				run,
			});

			expect(tag).toMatchObject({
				changedState: "complete",
				mode: "detached",
				resolvedRef: "tag-commit",
			});
			expect(commit).toMatchObject({
				changedState: "complete",
				mode: "detached",
				resolvedRef: "commit-object",
			});
		});

		test("attach dry-run previews resolved ref, target path, and mode", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-preview-"));
			const calls: string[] = [];
			const run = fakeGitRunner({
				...mainRepoGitOutputs(root),
				["git show-ref --verify --hash refs/heads/feat/preview"]: "def\n",
			});

			const result = await attachWorktree({
				cwd: root,
				ref: "feat/preview",
				dryRun: true,
				runId: "attach/preview",
				run: async (args, options) => {
					calls.push(args.join(" "));
					return run(args, options);
				},
			});

			expect(result).toMatchObject({
				changedState: "none",
				preview: true,
				resolvedRef: "def",
				targetPath: join(root, ".worktrees", "feat-preview"),
				mode: "branch",
			});
			expect(calls.some((call) => call.startsWith("git worktree add"))).toBe(false);
		});

		test("attach refuses a branch already checked out in another worktree", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-conflict-"));
			const linked = join(root, ".worktrees", "feat-existing");
			const calls: string[] = [];
			const run = fakeGitRunner({
				...linkedRepoGitOutputs(root, linked, { branch: "feat/existing" }),
				["git rev-parse --git-dir"]: ".git\n",
				["git rev-parse --git-common-dir"]: `${join(root, ".git")}\n`,
				["git branch --show-current"]: "main\n",
				["git show-ref --verify --hash refs/heads/feat/existing"]: "def\n",
			});

			const result = await attachWorktree({
				cwd: root,
				ref: "feat/existing",
				dryRun: false,
				runId: "attach/conflict",
				run: async (args, options) => {
					calls.push(args.join(" "));
					return run(args, options);
				},
			});

			expect(result).toMatchObject({
				changedState: "none",
				reason: "branch_already_checked_out",
				existingCheckoutPath: linked,
				recovery: {
					nextActionId: "use_existing_checkout",
					choices: [
						{
							id: "use_existing_checkout",
							retrySafety: "same_input_unsafe",
							path: linked,
						},
					],
				},
			});
			expect(calls.some((call) => call.startsWith("git worktree add"))).toBe(false);
		});

		test("attach one-branch guard includes the main checkout", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-main-"));

			const result = await attachWorktree({
				cwd: root,
				ref: "main",
				dryRun: false,
				runId: "attach/main",
				run: fakeGitRunner({
					...mainRepoGitOutputs(root),
					["git show-ref --verify --hash refs/heads/main"]: "abc\n",
				}),
			});

			expect(result).toMatchObject({
				changedState: "none",
				reason: "branch_already_checked_out",
				existingCheckoutPath: root,
				recovery: {
					nextActionId: "use_existing_checkout",
					choices: [
						{
							id: "use_existing_checkout",
							retrySafety: "same_input_unsafe",
							path: root,
						},
					],
				},
			});
		});

		test("create and attach refuse linked-worktree invocation contexts", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-linked-context-"));
			const linked = join(root, ".worktrees", "active");
			const calls: string[] = [];
			const run = fakeGitRunner(linkedRepoGitOutputs(root, linked));
			const recordingRun: typeof run = async (args, options) => {
				calls.push(args.join(" "));
				return run(args, options);
			};

			const attached = await attachWorktree({
				cwd: linked,
				ref: "feat/other",
				dryRun: false,
				runId: "attach/linked",
				run: recordingRun,
			});
			const created = await createWorktree({
				cwd: linked,
				branch: "feat/new",
				dryRun: false,
				runId: "create/linked",
				run: recordingRun,
			});

			for (const result of [attached, created]) {
				expect(result).toMatchObject({
					changedState: "none",
					reason: "isolation_unavailable",
					nextSafeAction: "work_in_current_checkout",
					recovery: {
						nextActionId: "work_in_current_checkout",
						choices: [
							{
								id: "work_in_current_checkout",
								retrySafety: "operator_required",
								handoffReason: "isolation_unavailable",
							},
							{
								id: "stop_and_resolve_environment",
								retrySafety: "operator_required",
								handoffReason: "isolation_unavailable",
							},
						],
					},
				});
			}
			expect(calls.some((call) => call.startsWith("git worktree add"))).toBe(false);
		});

		test("attach treats submodule invocation contexts as normal checkouts", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-submodule-"));
			const target = join(root, ".worktrees", "feat-submodule");
			const run = fakeGitRunner({
				...mainRepoGitOutputs(root),
				["git rev-parse --git-dir"]: `${join(
					root,
					"..",
					".git",
					"modules",
					"submodule",
				)}\n`,
				["git rev-parse --git-common-dir"]: `${join(
					root,
					"..",
					".git",
					"modules",
					"submodule",
				)}\n`,
				["git rev-parse --show-superproject-working-tree"]: `${join(root, "..")}\n`,
				["git show-ref --verify --hash refs/heads/feat/submodule"]: "def\n",
				[`git worktree add ${target} feat/submodule`]: "",
			});

			const result = await attachWorktree({
				cwd: root,
				ref: "feat/submodule",
				dryRun: false,
				runId: "attach/submodule",
				run,
			});

			expect(result.changedState).toBe("complete");
		});

		test("attach classifies an unknown ref as change-input recovery", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-missing-"));

			const result = await attachWorktree({
				cwd: root,
				ref: "missing-ref",
				dryRun: false,
				runId: "attach/missing",
				run: fakeGitRunner(mainRepoGitOutputs(root)),
			});

			expect(result).toMatchObject({
				changedState: "none",
				reason: "ref_not_found",
				nextSafeAction: "change_input",
				recovery: {
					nextActionId: "change_input",
					choices: [
						{ id: "change_input", retrySafety: "same_input_unsafe" },
					],
				},
			});
		});

		test("PR attach fetches into a local branch before adding the worktree", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-pr-"));
			const target = join(root, ".worktrees", "pr-42");
			const calls: string[] = [];
			const run = fakeGitRunner({
				...mainRepoGitOutputs(root),
				["git fetch origin pull/42/head:pr-42"]: "",
				[`git worktree add ${target} pr-42`]: "",
			});

			const result = await attachWorktree({
				cwd: root,
				pr: 42,
				dryRun: false,
				runId: "attach/pr",
				run: async (args, options) => {
					calls.push(args.join(" "));
					return run(args, options);
				},
			});

			expect(result).toMatchObject({
				changedState: "complete",
				mode: "pr",
				resolvedRef: "pr-42",
				targetPath: target,
			});
			expect(calls).toContain("git fetch origin pull/42/head:pr-42");
			expect(calls).toContain(`git worktree add ${target} pr-42`);
			expect(calls.some((call) => call.includes("FETCH_HEAD"))).toBe(false);
			const stored = await createFileStore(
				join(root, ".agent-worktree"),
			).readRun("attach_pr");
			expect(stored?.steps.map((step) => step.id)).toEqual([
				"fetch_pr",
				"attach_worktree",
			]);
		});

		test("tracked PR attach creates detached then checks out through gh", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-track-"));
			const target = join(root, ".worktrees", "pr-42");
			const calls: string[] = [];
			const run = fakeGitRunner({
				...mainRepoGitOutputs(root),
				[`git worktree add --detach ${target}`]: "",
				["gh pr checkout 42"]: "",
			});

			const result = await attachWorktree({
				cwd: root,
				pr: 42,
				track: true,
				dryRun: false,
				runId: "attach/track",
				run: async (args, options) => {
					calls.push(`${options.cwd}: ${args.join(" ")}`);
					return run(args, options);
				},
			});

			expect(result).toMatchObject({
				changedState: "complete",
				mode: "pr",
				targetPath: target,
			});
			expect(calls).toContain(`${root}: git worktree add --detach ${target}`);
			expect(calls).toContain(`${target}: gh pr checkout 42`);
			expect(calls.findIndex((call) => call.includes("worktree add"))).toBeLessThan(
				calls.findIndex((call) => call.includes("gh pr checkout")),
			);
			const stored = await createFileStore(
				join(root, ".agent-worktree"),
			).readRun("attach_track");
			expect(stored?.steps.map((step) => step.id)).toEqual([
				"attach_worktree",
				"checkout_pr",
			]);
		});

		test("missing gh returns a typed degradation while pure-git PR mode stays available", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-gh-missing-"));
			const trackedTarget = join(root, ".worktrees", "pr-42");
			const pureTarget = join(root, ".worktrees", "pr-43");
			const baseRun = fakeGitRunner({
				...mainRepoGitOutputs(root),
				[`git worktree add --detach ${trackedTarget}`]: "",
				["git fetch origin pull/43/head:pr-43"]: "",
				[`git worktree add ${pureTarget} pr-43`]: "",
			});
			const run: typeof baseRun = async (args, options) => {
				if (args[0] === "gh") {
					throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
				}
				return baseRun(args, options);
			};

			const tracked = await attachWorktree({
				cwd: root,
				pr: 42,
				track: true,
				dryRun: false,
				runId: "attach/gh-missing",
				run,
			});
			const pureGit = await attachWorktree({
				cwd: root,
				pr: 43,
				dryRun: false,
				runId: "attach/pure-git",
				run,
			});

			expect(tracked).toMatchObject({
				changedState: "partial",
				reason: "gh_not_found",
				failureRef: {
					kind: "failure",
					id: "attach_gh-missing/checkout_pr",
				},
				recovery: {
					nextActionId: "inspect_failure_ref",
					choices: [
						expect.objectContaining({
							retrySafety: "inspect_first",
						}),
					],
				},
			});
			expect(pureGit).toMatchObject({
				changedState: "complete",
				mode: "pr",
				resolvedRef: "pr-43",
				targetPath: pureTarget,
			});
		});

		test("gh checkout failure records partial state at its own step", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-gh-fail-"));
			const target = join(root, ".worktrees", "pr-7");

			const result = await attachWorktree({
				cwd: root,
				pr: 7,
				track: true,
				dryRun: false,
				runId: "attach/gh-fail",
				run: fakeGitRunner({
					...mainRepoGitOutputs(root),
					[`git worktree add --detach ${target}`]: "",
				}),
			});

			expect(result).toMatchObject({
				changedState: "partial",
				reason: "gh_pr_checkout_failed",
				failureRef: {
					kind: "failure",
					id: "attach_gh-fail/checkout_pr",
				},
				recovery: {
					nextActionId: "inspect_failure_ref",
					choices: [
						expect.objectContaining({
							retrySafety: "inspect_first",
						}),
					],
				},
			});
			const stored = await createFileStore(
				join(root, ".agent-worktree"),
			).readRun("attach_gh-fail");
			expect(stored?.steps).toEqual([
				expect.objectContaining({
					id: "attach_worktree",
					status: "completed",
					changedState: "complete",
				}),
				expect.objectContaining({
					id: "checkout_pr",
					status: "failed",
					changedState: "partial",
				}),
			]);
		});

		test("PR fetch failure records a typed step-scoped no-change failure", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-pr-fetch-"));

			const result = await attachWorktree({
				cwd: root,
				pr: 404,
				dryRun: false,
				runId: "attach/pr-fetch",
				run: fakeGitRunner(mainRepoGitOutputs(root)),
			});

			expect(result).toMatchObject({
				changedState: "none",
				reason: "pr_fetch_failed",
				failureRef: {
					kind: "failure",
					id: "attach_pr-fetch/fetch_pr",
				},
			});
		});

		test("PR add failure records partial state at the attach step", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-pr-add-"));

			const result = await attachWorktree({
				cwd: root,
				pr: 7,
				dryRun: false,
				runId: "attach/pr-add",
				run: fakeGitRunner({
					...mainRepoGitOutputs(root),
					["git fetch origin pull/7/head:pr-7"]: "",
				}),
			});

			expect(result).toMatchObject({
				changedState: "partial",
				reason: "worktree_add_failed",
				failureRef: {
					kind: "failure",
					id: "attach_pr-add/attach_worktree",
				},
			});
			const stored = await createFileStore(
				join(root, ".agent-worktree"),
			).readRun("attach_pr-add");
			expect(stored?.steps).toEqual([
				expect.objectContaining({
					id: "fetch_pr",
					status: "completed",
					changedState: "complete",
				}),
				expect.objectContaining({
					id: "attach_worktree",
					status: "failed",
					changedState: "partial",
				}),
			]);
		});

		test("permission failure from worktree add requires exactly two operator choices", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-permission-"));
			const target = join(root, ".worktrees", "feat-permission");
			const baseRun = fakeGitRunner({
				...mainRepoGitOutputs(root),
				["git show-ref --verify --hash refs/heads/feat/permission"]: "def\n",
			});

			const result = await attachWorktree({
				cwd: root,
				ref: "feat/permission",
				dryRun: false,
				runId: "attach/permission",
				run: async (args, options) =>
					args.join(" ") === `git worktree add ${target} feat/permission`
						? {
								ok: false,
								stdout: "",
								stderr: "fatal: cannot create directory: Permission denied",
								code: 128,
							}
						: baseRun(args, options),
			});

			expect(result).toMatchObject({
				changedState: "none",
				reason: "isolation_unavailable",
				recovery: {
					nextActionId: "work_in_current_checkout",
					choices: [
						{
							id: "work_in_current_checkout",
							retrySafety: "operator_required",
							handoffReason: "isolation_unavailable",
						},
						{
							id: "stop_and_resolve_environment",
							retrySafety: "operator_required",
							handoffReason: "isolation_unavailable",
						},
					],
				},
			});
			expect(result.recovery?.choices).toHaveLength(2);
		});

		test("worktree add target collision is a change-input refusal", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-attach-path-"));
			const target = join(root, ".worktrees", "feat-path");
			const baseRun = fakeGitRunner({
				...mainRepoGitOutputs(root),
				["git show-ref --verify --hash refs/heads/feat/path"]: "def\n",
			});

			const result = await attachWorktree({
				cwd: root,
				ref: "feat/path",
				dryRun: false,
				runId: "attach/path",
				run: async (args, options) =>
					args.join(" ") === `git worktree add ${target} feat/path`
						? {
								ok: false,
								stdout: "",
								stderr: `fatal: '${target}' already exists`,
								code: 128,
							}
						: baseRun(args, options),
			});

			expect(result).toMatchObject({
				changedState: "none",
				reason: "target_path_exists",
				recovery: {
					nextActionId: "change_input",
					choices: [
						{ id: "change_input", retrySafety: "same_input_unsafe" },
					],
				},
			});
		});

		test("create classifies existing branch and missing base failures", async () => {
			const root = await mkdtemp(join(tmpdir(), "agent-worktree-create-classify-"));
			const existingTarget = join(root, ".worktrees", "feat-existing");
			const missingBaseTarget = join(root, ".worktrees", "feat-new");
			const baseRun = fakeGitRunner(mainRepoGitOutputs(root));
			const run: typeof baseRun = async (args, options) => {
				const call = args.join(" ");
				if (
					call ===
					`git worktree add -b feat/existing ${existingTarget} main`
				) {
					return {
						ok: false,
						stdout: "",
						stderr: "fatal: a branch named 'feat/existing' already exists",
						code: 128,
					};
				}
				if (
					call ===
					`git worktree add -b feat/new ${missingBaseTarget} missing-base`
				) {
					return {
						ok: false,
						stdout: "",
						stderr: "fatal: invalid reference: missing-base",
						code: 128,
					};
				}
				return baseRun(args, options);
			};

			const existing = await createWorktree({
				cwd: root,
				branch: "feat/existing",
				dryRun: false,
				runId: "create/existing",
				run,
			});
			const missingBase = await createWorktree({
				cwd: root,
				branch: "feat/new",
				base: "missing-base",
				dryRun: false,
				runId: "create/missing-base",
				run,
			});

			expect(existing).toMatchObject({
				changedState: "none",
				reason: "branch_already_exists",
				nextSafeAction: "change_input",
				recovery: {
					nextActionId: "change_input",
					choices: [
						{ id: "change_input", retrySafety: "same_input_unsafe" },
					],
				},
			});
			expect(missingBase).toMatchObject({
				changedState: "none",
				reason: "ref_not_found",
				nextSafeAction: "change_input",
				recovery: {
					nextActionId: "change_input",
					choices: [
						{ id: "change_input", retrySafety: "same_input_unsafe" },
					],
				},
			});
		});

		test("delete records partial failure with backup ref when branch deletion fails", async () => {
			const { root, linked } = await createLinkedWorktreeFixture("agent-worktree-delete-");

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
				await createLinkedWorktreeFixture("agent-worktree-backup-fail-");
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
				await createLinkedWorktreeFixture("agent-worktree-dirty-block-");

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
		const root = await mkdtemp(join(tmpdir(), "agent-worktree-refresh-ids-"));
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
