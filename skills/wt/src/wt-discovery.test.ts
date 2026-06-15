import { describe, expect, test } from "bun:test";
import {
	loadRegistry,
	listWorktrees,
	repoOwnerRootFor,
	type RunResult,
	type Runner,
	WtDiscoveryError,
	workspacePathFor,
} from "./wt-discovery.ts";

const fixture = `worktree /code/my-repo
HEAD abc
branch refs/heads/main

worktree /code/my-repo/.worktrees/browser-use-refactor
HEAD def
branch refs/heads/codex/browser-use-refactor

worktree /code/my-repo/.worktrees/harden-test-runner
HEAD ghi
branch refs/heads/codex/harden-test-runner

worktree /code/my-repo/.worktrees/fallow-audit-temp
HEAD jkl
branch refs/heads/fallow-audit-temp

worktree /code/my-repo/.worktrees/detached
HEAD mno
detached
`;

describe("listWorktrees", () => {
	test("reads shared discovery and filters out detached/temp entries", async () => {
		const worktrees = await listWorktrees("/code/my-repo", fakeDiscoveryRunner());
		const branches = worktrees.map((w) => w.branch);

		expect(branches).toContain("main");
		expect(branches).toContain("codex/browser-use-refactor");
		expect(branches).toContain("codex/harden-test-runner");
		expect(branches).not.toContain("(detached)");
		expect(worktrees.every((w) => !w.path.includes("/fallow-audit-"))).toBe(true);
	});

	test("throws worktree_list_failed on non-zero exit", async () => {
		const run: Runner = async () => ({ ok: false, stdout: "", stderr: "boom", code: 1 });
		await expect(listWorktrees("/code/my-repo", run)).rejects.toMatchObject({
			code: "worktree_list_failed",
		});
	});

	test("throws worktree_list_failed when git worktree list fails", async () => {
		await expect(
			listWorktrees(
				"/code/my-repo",
				fakeDiscoveryRunner({
					["git worktree list --porcelain"]: {
						ok: false,
						stdout: "",
						stderr: "boom",
						code: 1,
					},
				}),
			),
		).rejects.toBeInstanceOf(WtDiscoveryError);
	});

	test("runs shared discovery from the requested repo", async () => {
		const cwdValues: string[] = [];
		const run: Runner = async (_args, options) => {
			cwdValues.push(options?.cwd ?? "");
			return fakeDiscoveryRunner()(_args, options);
		};
		await listWorktrees("/code/other-repo", run);
		expect(cwdValues[0]).toBe("/code/other-repo");
	});
});

function fakeDiscoveryRunner(
	overrides: Record<string, RunResult> = {},
): Runner {
	return async (args) => {
		const key = args.join(" ");
		if (overrides[key]) return overrides[key];
		const stdout = {
			["git rev-parse --show-toplevel"]: "/code/my-repo\n",
			["git worktree list --porcelain"]: fixture,
			["git branch --show-current"]: "main\n",
			["git symbolic-ref --short refs/remotes/origin/HEAD"]: "origin/main\n",
		}[key];
		return stdout === undefined
			? { ok: false, stdout: "", stderr: "missing fake output", code: 1 }
			: { ok: true, stdout, stderr: "", code: 0 };
	};
}

describe("loadRegistry", () => {
	test("absent wt.config.json yields an empty registry, not an error", async () => {
		const registry = await loadRegistry("/code/definitely-not-a-real-repo-xyz");
		expect(registry).toEqual({ branches: {} });
	});

	test("malformed wt.config.json throws registry_unreadable", async () => {
		const dir = `${process.env.TMPDIR ?? "/tmp"}/wt-test-${Math.abs(fixture.length)}`;
		await Bun.write(`${dir}/wt.config.json`, "{ not valid json");
		await expect(loadRegistry(dir)).rejects.toMatchObject({ code: "registry_unreadable" });
	});

	test("valid wt.config.json round-trips branches and defaults", async () => {
		const dir = `${process.env.TMPDIR ?? "/tmp"}/wt-test-valid-${Math.abs(fixture.length)}`;
		await Bun.write(
			`${dir}/wt.config.json`,
			JSON.stringify({ branches: { "codex/x": { color: "blue" } }, defaults: { wip: "/w" } }),
		);
		const registry = await loadRegistry(dir);
		expect(registry.branches["codex/x"]).toEqual({ color: "blue" });
		expect(registry.defaults).toEqual({ wip: "/w" });
	});
});

describe("workspacePathFor", () => {
	test("produces <repo>.code-workspace beside the repo", () => {
		expect(workspacePathFor("/code/my-repo")).toBe("/code/my-repo.code-workspace");
	});
});

describe("repoOwnerRootFor", () => {
	test("selects the upstream main worktree as the durable owner root", () => {
		expect(
			repoOwnerRootFor(
				[
					{ path: "/code/my-repo/.worktrees/feature-x", branch: "feature/x", isMain: false },
					{ path: "/code/my-repo", branch: "main", isMain: true },
				],
				"/code/my-repo/.worktrees/feature-x",
			),
		).toBe("/code/my-repo");
	});

	test("falls back to the current repo root when upstream lacks isMain", () => {
		expect(
			repoOwnerRootFor(
				[{ path: "/code/my-repo/.worktrees/feature-x", branch: "feature/x" }],
				"/code/my-repo/.worktrees/feature-x",
			),
		).toBe("/code/my-repo/.worktrees/feature-x");
	});
});
