import { describe, expect, test } from "bun:test";
import {
	loadRegistry,
	listWorktrees,
	type RunResult,
	type Runner,
	WtDiscoveryError,
	workspacePathFor,
} from "./wt-discovery.ts";

const fixture = await Bun.file(
	new URL("./fixtures/worktree-list.json", import.meta.url),
).text();

const runnerYielding = (result: Partial<RunResult>): Runner => {
	return async () => ({ ok: true, stdout: "", stderr: "", ...result });
};

describe("listWorktrees", () => {
	test("parses the real fixture and filters out detached/temp entries", async () => {
		const worktrees = await listWorktrees(runnerYielding({ stdout: fixture }));
		const branches = worktrees.map((w) => w.branch);

		expect(branches).toContain("main");
		expect(branches).toContain("codex/browser-use-refactor");
		expect(branches).toContain("codex/harden-test-runner");
		expect(branches).not.toContain("(detached)");
		expect(worktrees.every((w) => !w.path.includes("/fallow-audit-"))).toBe(true);
	});

	test("throws worktree_list_failed on non-zero exit", async () => {
		const run: Runner = async () => ({ ok: false, stdout: "", stderr: "boom" });
		await expect(listWorktrees(run)).rejects.toMatchObject({ code: "worktree_list_failed" });
	});

	test("throws worktree_list_failed on unparseable output", async () => {
		await expect(listWorktrees(runnerYielding({ stdout: "not json" }))).rejects.toBeInstanceOf(
			WtDiscoveryError,
		);
	});
});

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
