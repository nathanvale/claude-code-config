import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import {
	discoverRepo,
	parseWorktreePorcelain,
} from "../src/discovery.ts";
import {
	fakeGitRunner,
	linkedRepoGitOutputs,
	mainRepoGitOutputs,
} from "./support.ts";

describe("agent-worktree discovery", () => {
	test("parses porcelain worktree output with main and linked entries", () => {
		const entries = parseWorktreePorcelain(`worktree /repo
HEAD abc
branch refs/heads/main

worktree /repo/.worktrees/feat-x
HEAD def
branch refs/heads/feat/x
`);

		expect(entries).toEqual([
			{
				path: "/repo",
				head: "abc",
				branch: "main",
				isMain: true,
				detached: false,
				prunable: false,
			},
			{
				path: "/repo/.worktrees/feat-x",
				head: "def",
				branch: "feat/x",
				isMain: false,
				detached: false,
				prunable: false,
			},
		]);
	});

	test("discovers main owner, active linked worktree, stale dirs, and default branch", async () => {
		const root = await mkdtemp(join(tmpdir(), "agent-worktree-discovery-"));
		const linked = join(root, ".worktrees", "feat-x");
		const stale = join(root, ".worktrees", "stale");
		await mkdir(linked, { recursive: true });
		await mkdir(stale, { recursive: true });

		const discovery = await discoverRepo({
			cwd: linked,
			run: fakeGitRunner({
				["git rev-parse --show-toplevel"]: `${root}\n`,
				["git rev-parse --git-dir"]: `${join(
					root,
					".git",
					"worktrees",
					"feat-x",
				)}\n`,
				["git rev-parse --git-common-dir"]: `${join(root, ".git")}\n`,
				["git rev-parse --show-superproject-working-tree"]: "\n",
				["git worktree list --porcelain"]: `worktree ${root}
HEAD abc
branch refs/heads/main

worktree ${linked}
HEAD def
branch refs/heads/feat/x
`,
				["git branch --show-current"]: "feat/x\n",
				["git symbolic-ref --short refs/remotes/origin/HEAD"]:
					"origin/main\n",
			}),
		});

		expect(discovery.mainOwnerRoot).toBe(root);
		expect(discovery.activeWorktree?.path).toBe(linked);
		expect(discovery.linkedWorktrees).toHaveLength(1);
		expect(discovery.staleDirs).toEqual([stale]);
		expect(discovery.defaultBranch).toBe("main");
		expect(discovery.storeRoot).toBe(join(root, ".agent-worktree"));
	});

	test("classifies a normal checkout when resolved git dirs match", async () => {
		const discovery = await discoverRepo({
			cwd: "/repo",
			run: fakeGitRunner(mainRepoGitOutputs("/repo")),
		});

		expect(discovery.isolation).toBe("main");
	});

	test("classifies a linked worktree when resolved git dirs differ", async () => {
		const discovery = await discoverRepo({
			cwd: "/repo/.worktrees/feat-x",
			run: fakeGitRunner(
				linkedRepoGitOutputs("/repo", "/repo/.worktrees/feat-x"),
			),
		});

		expect(discovery.isolation).toBe("linked_worktree");
	});

	test("classifies a submodule before treating differing git dirs as linked", async () => {
		const outputs = {
			...mainRepoGitOutputs("/repo"),
			["git rev-parse --git-dir"]: "/super/.git/modules/repo\n",
			["git rev-parse --git-common-dir"]: "/super/.git\n",
			["git rev-parse --show-superproject-working-tree"]: "/super\n",
		};
		const discovery = await discoverRepo({
			cwd: "/repo",
			run: fakeGitRunner(outputs),
		});

		expect(discovery.isolation).toBe("submodule");
	});

	test("normalizes relative and absolute git dir forms before comparing", async () => {
		const discovery = await discoverRepo({
			cwd: "/repo",
			run: fakeGitRunner({
				...mainRepoGitOutputs("/repo"),
				["git rev-parse --git-dir"]: ".git\n",
				["git rev-parse --git-common-dir"]: "/repo/.git\n",
			}),
		});

		expect(discovery.isolation).toBe("main");
	});

	test("records an unknown issue when an isolation probe fails", async () => {
		const outputs = mainRepoGitOutputs("/repo");
		delete outputs["git rev-parse --git-common-dir"];

		const discovery = await discoverRepo({
			cwd: "/repo",
			run: fakeGitRunner(outputs),
		});

		expect(discovery.isolation).toBeUndefined();
		expect(discovery.issues).toContainEqual({
			code: "isolation_detection_failed",
			status: "unknown",
			summary: "Git isolation could not be classified.",
		});
	});
});
