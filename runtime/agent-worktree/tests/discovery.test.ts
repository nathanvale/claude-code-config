import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import {
	discoverRepo,
	parseWorktreePorcelain,
	type GitRunner,
} from "../src/discovery.ts";

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
		const root = await mkdtemp(join(tmpdir(), "awt-discovery-"));
		const linked = join(root, ".worktrees", "feat-x");
		const stale = join(root, ".worktrees", "stale");
		await mkdir(linked, { recursive: true });
		await mkdir(stale, { recursive: true });

		const discovery = await discoverRepo({
			cwd: linked,
			run: fakeGitRunner({
				["git rev-parse --show-toplevel"]: `${root}\n`,
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
});

function fakeGitRunner(outputs: Record<string, string>): GitRunner {
	return async (args) => {
		const stdout = outputs[args.join(" ")];
		return stdout === undefined
			? { ok: false, stdout: "", stderr: "missing fake output", code: 1 }
			: { ok: true, stdout, stderr: "", code: 0 };
	};
}
