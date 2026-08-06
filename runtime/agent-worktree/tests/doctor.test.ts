import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { doctorMapFromDiscovery, runDoctor } from "../src/doctor.ts";
import type { RepoDiscovery } from "../src/discovery.ts";
import { createFileStore } from "../src/store.ts";
import { fakeGitRunner, mainRepoGitOutputs } from "./support.ts";

describe("agent-worktree doctor", () => {
	test("returns a blocked map when git root cannot be read", async () => {
		const map = await runDoctor({
			cwd: "/not-a-repo",
			run: async () => ({
				ok: false,
				stdout: "",
				stderr: "not a git repository",
				code: 128,
			}),
		});

		expect(map.status).toBe("blocked");
		expect(map.mutationReadiness).toBe("blocked");
		expect(map.nextActions).toContain("handoff");
	});

	test("keeps worktree list failures as unknown readable data", () => {
		const discovery = {
			requestedRoot: "/repo",
			gitRoot: "/repo",
			isolation: "main",
			mainOwnerRoot: "/repo",
			worktrees: [],
			linkedWorktrees: [],
			staleDirs: [],
			storeRoot: "/repo/.agent-worktree",
			issues: [
				{
					code: "worktree_list_failed",
					status: "unknown",
					summary: "Git worktree list failed.",
				},
			],
		} satisfies RepoDiscovery;

		const map = doctorMapFromDiscovery(discovery);

		expect(map.status).toBe("unknown");
		expect(map.mutationReadiness).toBe("unknown");
		expect(map.checks.some((check) => check.id === "worktrees")).toBe(true);
	});

	test("keeps discovery issue checks legible without overloading repo", () => {
		const discovery = {
			requestedRoot: "/repo",
			gitRoot: "/repo",
			isolation: "main",
			mainOwnerRoot: "/repo",
			worktrees: [],
			linkedWorktrees: [],
			staleDirs: [],
			storeRoot: "/repo/.agent-worktree",
			issues: [
				{
					code: "current_branch_failed",
					status: "unknown",
					summary: "Current branch could not be resolved.",
				},
				{
					code: "default_branch_unknown",
					status: "warn",
					summary: "Default branch could not be inferred.",
				},
				{
					code: "stale_dir_scan_failed",
					status: "warn",
					summary: "Stale worktree dirs could not be scanned.",
				},
			],
		} satisfies RepoDiscovery;

		const map = doctorMapFromDiscovery(discovery);
		const issueCheckIds = map.checks
			.filter((check) => check.owner === "discovery")
			.map((check) => check.id);

		expect(issueCheckIds).toContain("current_branch");
		expect(issueCheckIds).toContain("default_branch");
		expect(issueCheckIds).toContain("stale_dirs");
		expect(issueCheckIds.filter((id) => id === "repo")).toHaveLength(1);
	});

	test("keeps failed isolation detection readable in the doctor map", async () => {
		const outputs: Record<string, string> = {
			...mainRepoGitOutputs("/repo"),
			["git status --porcelain"]: "",
			["git rev-parse --is-shallow-repository"]: "false\n",
			["git merge-base --is-ancestor main main"]: "",
			["git rev-list --left-right --count main...main"]: "0 0\n",
		};
		delete outputs["git rev-parse --git-common-dir"];

		const map = await runDoctor({
			cwd: "/repo",
			run: fakeGitRunner(outputs),
		});

		expect(map.status).toBe("unknown");
		expect(map.repo.isolation).toBeUndefined();
		expect(
			map.checks.some(
				(check) =>
					check.owner === "discovery" &&
					check.summary === "Git isolation could not be classified.",
			),
		).toBe(true);
	});

	test("reports dirty linked worktrees as mutation blockers", async () => {
		const outputs = {
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
			["git rev-parse --is-shallow-repository"]: "false\n",
			["git merge-base --is-ancestor main main"]: "",
			["git rev-list --left-right --count main...main"]: "0 0\n",
			["git merge-base --is-ancestor feat/x main"]: "",
			["git rev-list --left-right --count main...feat/x"]: "1 0\n",
		};
		const map = await runDoctor({
			cwd: "/repo/.worktrees/feat-x",
			run: async (args, options) => {
				if (args.join(" ") === "git status --porcelain") {
					return {
						ok: true,
						stdout: options.cwd.endsWith("feat-x") ? " M file.txt\n" : "",
						stderr: "",
						code: 0,
					};
				}
				return fakeGitRunner(outputs)(args, options);
			},
		});

		expect(map.status).toBe("blocked");
		expect(map.mutationReadiness).toBe("blocked");
		expect(
			map.checks.find((check) => check.id === "mutations")?.blockers,
		).toContain("feat/x:dirty");
	});

	test("warns when durable records exceed retention threshold", async () => {
		const root = await mkdtemp(join(tmpdir(), "agent-worktree-retention-"));
		const store = createFileStore(join(root, ".agent-worktree"));
		await store.writeRun({
			runId: "old-run",
			command: "refresh",
			status: "completed",
			changedState: "complete",
			steps: [],
			events: [],
			createdAtMs: 1,
		});

		const map = await runDoctor({
			cwd: root,
			now: () => 31 * 24 * 60 * 60 * 1000,
			run: fakeGitRunner({
				["git rev-parse --show-toplevel"]: `${root}\n`,
				["git worktree list --porcelain"]: `worktree ${root}
HEAD abc
branch refs/heads/main
`,
				["git branch --show-current"]: "main\n",
				["git symbolic-ref --short refs/remotes/origin/HEAD"]: "origin/main\n",
				["git status --porcelain"]: "",
				["git rev-parse --is-shallow-repository"]: "false\n",
				["git merge-base --is-ancestor main main"]: "",
				["git rev-list --left-right --count main...main"]: "0 0\n",
			}),
		});

		expect(map.checks.find((check) => check.id === "store")?.status).toBe(
			"warn",
		);
	});
});
