import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { renderCommandUsage } from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import { WORKTREE_DIAGNOSTIC_CODES, worktreeContracts } from "./command-contract.ts";
import { WORKTREE_COLOR_PALETTE } from "./model.ts";
import type { RunResult } from "./worktree-discovery.ts";
import {
	archiveCodexThreadsForCwd,
	cleanupCodexAppProject,
	createDefaultRuntime,
	main,
	parseInvocation,
	removeCodexSidebarState,
	runCommand,
	validateColor,
	type CommandResult,
	type WorkTreeRuntime,
} from "./worktree.ts";

function runtimeFixtureFor(cwd = "/code/my-repo"): string {
	const ownerRoot = cwd.includes("/code/other-repo") ? "/code/other-repo" : "/code/my-repo";
	return `worktree ${ownerRoot}
HEAD abc
branch refs/heads/main

worktree ${ownerRoot}/.worktrees/browser-use-refactor
HEAD def
branch refs/heads/codex/browser-use-refactor

worktree ${ownerRoot}/.worktrees/harden-test-runner
HEAD ghi
branch refs/heads/codex/harden-test-runner
`;
}

/**
 * Build a fully in-memory runtime: no real fs, subprocess, or VS Code.
 * Tracks writes so tests can assert on the rendered workspace.
 */
function fakeRuntime(overrides: Partial<WorkTreeRuntime> = {}): WorkTreeRuntime & {
	writes: Map<string, string>;
	runCalls: string[][];
	launched: Array<{ workspacePath: string; codeBin?: string }>;
	launchedCodex: Array<{ worktreePath: string; codexBin?: string }>;
	ensuredDirs: string[];
} {
	const writes = new Map<string, string>();
	const runCalls: string[][] = [];
	const launched: Array<{ workspacePath: string; codeBin?: string }> = [];
	const launchedCodex: Array<{ worktreePath: string; codexBin?: string }> = [];
	const ensuredDirs: string[] = [];
	const base = createDefaultRuntime({
		repoRoot: () => "/code/my-repo",
		readTextFile: async (path) => writes.get(path) ?? null,
		writeTextFile: async (path, content) => {
			writes.set(path, content);
		},
		pathExists: async () => false,
		ensureDirectory: async (path) => {
			ensuredDirs.push(path);
		},
		isInteractive: () => false,
		launchCode: async (workspacePath, codeBin) => {
			launched.push({ workspacePath, codeBin });
			return true;
		},
		launchCodexApp: async (worktreePath, codexBin) => {
			launchedCodex.push({ worktreePath, codexBin });
			return true;
		},
		now: () => 1000,
		run: async (args, options) => {
			runCalls.push([...args]);
			const key = args.join(" ");
			const ownerRoot = options?.cwd?.includes("/code/other-repo")
				? "/code/other-repo"
				: "/code/my-repo";
			const outputs: Record<string, string> = {
				"git rev-parse --show-toplevel": `${ownerRoot}\n`,
				"git rev-parse --git-dir": options?.cwd?.includes("/.worktrees/")
					? `${ownerRoot}/.git/worktrees/browser-use-refactor\n`
					: `${ownerRoot}/.git\n`,
				"git rev-parse --git-common-dir": `${ownerRoot}/.git\n`,
				"git rev-parse --show-superproject-working-tree": "\n",
				"git worktree list --porcelain": runtimeFixtureFor(options?.cwd),
				"git branch --show-current": "main\n",
				"git symbolic-ref --short refs/remotes/origin/HEAD": "origin/main\n",
				"git status --porcelain": "",
				"git rev-parse --is-shallow-repository": "false\n",
				"git merge-base --is-ancestor codex/browser-use-refactor main": "",
				"git rev-list --left-right --count main...codex/browser-use-refactor":
					"1 0\n",
				"git worktree add -b feat/z /code/my-repo/.worktrees/feat-z main":
					"",
				"git show-ref --verify --hash refs/heads/feat/existing": "jkl\n",
				"git show-ref --verify --hash refs/heads/codex/browser-use-refactor":
					"def\n",
				"git worktree add /code/my-repo/.worktrees/feat-existing feat/existing":
					"",
				"git worktree remove /code/my-repo/.worktrees/browser-use-refactor":
					"",
				"git for-each-ref --format=%(refname:short) refs/heads":
					"main\ncodex/browser-use-refactor\ncodex/harden-test-runner\nold/branch\n",
			};
			const stdout = outputs[key];
			return stdout === undefined
				? { ok: false, stdout: "", stderr: "missing fake output", code: 1 } satisfies RunResult
				: { ok: true, stdout, stderr: "", code: 0 } satisfies RunResult;
		},
		...overrides,
	});
	return Object.assign(base, { writes, runCalls, launched, launchedCodex, ensuredDirs });
}

function expectLifecycleErrorData(
	result: CommandResult,
	expected: Record<string, unknown>,
): void {
	expect(result.ok).toBe(false);
	if (!result.ok) {
		expect(result.data).toMatchObject(expected);
	}
}

function expectOkData(result: CommandResult): Record<string, unknown> {
	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error(`Expected ok result, got ${result.code}`);
	}
	return result.data;
}

function expectAgentWorktreeFailed(result: CommandResult): void {
	expect(result.ok).toBe(false);
	if (!result.ok) {
		expect(result.code).toBe("agent_worktree_failed");
		expect(result.exitCode).toBe(1);
	}
}

function runtimeWithRemoveFailure(): ReturnType<typeof fakeRuntime> {
	return fakeRuntime({
		run: async (args, options) => {
			if (args.join(" ") === "git worktree remove /code/my-repo/.worktrees/browser-use-refactor") {
				return { ok: false, stdout: "", stderr: "remove failed", code: 1 };
			}
			return fakeRuntime().run(args, options);
		},
	});
}

function newIsolationFailureRuntime(): ReturnType<typeof fakeRuntime> {
	return fakeRuntime({
		run: async (args, options) => {
			if (args.join(" ") === "git worktree add -b feat/z /code/my-repo/.worktrees/feat-z main") {
				return {
					ok: false,
					stdout: "",
					stderr: "fatal: could not create work tree dir: Permission denied",
					code: 1,
				};
			}
			return fakeRuntime().run(args, options);
		},
	});
}

function stubCodexThreadArchive(
	runtime: ReturnType<typeof fakeRuntime>,
	threadIds: readonly string[],
	failedIds: readonly string[] = [],
): void {
	const originalRun = runtime.run;
	const failed = new Set(failedIds);
	runtime.run = async (args, options) => {
		if (args[0] === "sqlite3") {
			runtime.runCalls.push([...args]);
			return {
				ok: true,
				stdout: args[2].includes("/sqlite/") ? `${threadIds.join("\n")}\n` : "",
				stderr: "",
				code: 0,
			};
		}
		if (args[0] === "codex" && args[1] === "archive") {
			runtime.runCalls.push([...args]);
			const id = args[2];
			return failed.has(id)
				? { ok: false, stdout: "", stderr: "archive failed", code: 1 }
				: { ok: true, stdout: "", stderr: "", code: 0 };
		}
		return originalRun(args, options);
	};
}

async function runBrowserUseRm(runtime: WorkTreeRuntime): Promise<CommandResult> {
	return runCommand(
		{ command: "rm", positionals: ["codex/browser-use-refactor"], force: true, noInput: false },
		runtime,
	);
}

async function runBrowserUseRmWithCodexThreads(
	threadIds: readonly string[],
	failedIds: readonly string[] = [],
): Promise<{ runtime: ReturnType<typeof fakeRuntime>; result: CommandResult }> {
	const runtime = fakeRuntime();
	stubCodexThreadArchive(runtime, threadIds, failedIds);
	return { runtime, result: await runBrowserUseRm(runtime) };
}

describe("parseInvocation", () => {
	test("splits verb, positionals, and the force flag", () => {
		const parsed = parseInvocation(["color", "codex/x", "blue", "--force", "--json"]);
		expect(parsed).toEqual({
			command: "color",
			positionals: ["codex/x", "blue"],
			force: true,
			forceRender: false,
			noInput: false,
			repoRoot: undefined,
		});
	});

	test("captures --repo and --no-input", () => {
		const parsed = parseInvocation(["sync", "--repo", "/code/other", "--no-input", "--json"]);
		expect(parsed).toMatchObject({
			command: "sync",
			positionals: [],
			force: false,
			forceRender: false,
			noInput: true,
			repoRoot: "/code/other",
		});
	});

	test("captures lifecycle render override separately from destructive force", () => {
		const parsed = parseInvocation([
			"rm",
			"codex/x",
			"--force",
			"--force-render",
			"--json",
		]);
		expect(parsed).toMatchObject({
			command: "rm",
			positionals: ["codex/x"],
			force: true,
			forceRender: true,
		});
	});

	test("captures attach selectors, tracking, and dry-run", () => {
		const parsed = parseInvocation([
			"attach",
			"--pr",
			"42",
			"--track",
			"--dry-run",
			"--force-render",
			"--json",
		]);
		expect(parsed).toMatchObject({
			command: "attach",
			positionals: [],
			pr: 42,
			track: true,
			dryRun: true,
			forceRender: true,
		});
	});

	test("rejects a foreign flag for the selected command", () => {
		const parsed = parseInvocation(["open", "--force", "--json"]);
		expect(parsed.parseError?.ok).toBe(false);
		if (parsed.parseError && !parsed.parseError.ok) {
			expect(parsed.parseError.exitCode).toBe(2);
		}
	});
});

describe("validateColor", () => {
	test("accepts a palette color and rejects an unknown one", () => {
		expect(validateColor("blue")).toBe("blue");
		expect(validateColor("chartreuse")).toBeNull();
	});
});

describe("status front door", () => {
	test("summarizes repo, workspace, linked worktrees, and next action", async () => {
		const runtime = fakeRuntime();
		runtime.writes.set(
			"/code/my-repo/worktree.config.json",
			JSON.stringify({
				branches: {
					"codex/browser-use-refactor": { focus: "skills/browser-use", color: "teal" },
				},
			}),
		);
		const result = await runCommand({ command: "status", positionals: [], force: false }, runtime);
		const data = expectOkData(result);

		expect(data).toMatchObject({
			action: "status",
			changed_state: "none",
			owner_root: "/code/my-repo",
			workspace_path: "/code/my-repo.code-workspace",
			workspace_state: "missing",
			worktree_count: 3,
			linked_worktree_count: 2,
			next_safe_action: "Choose a linked branch to open in Codex App, or render the workspace.",
		});
		expect(data.front_door).toMatchObject({
			summary: expect.stringContaining("VS Code workspace"),
			vscode_sync: {
				check: "status",
				rebuild_workspace: "sync",
				open_workspace: "open",
			},
			worktree_crud: ["new", "status", "sync", "rm"],
		});
		expect(data.crud).toMatchObject({
			create: { label: expect.stringContaining("new repo-local worktree"), action: "new" },
			read: { label: expect.stringContaining("current worktrees"), action: "status" },
			update: { label: expect.stringContaining("Rebuild the VS Code workspace"), action: "sync" },
			delete: { label: expect.stringContaining("explicit confirmation"), action: "rm" },
		});
		expect(data.worktrees).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					branch: "codex/browser-use-refactor",
					focus: "skills/browser-use",
					color: "teal",
					is_main: false,
				}),
			]),
		);
	});

	test("points at drift recovery when the workspace is hand-edited", async () => {
		const runtime = fakeRuntime();
		runtime.writes.set("/code/my-repo.code-workspace", "{ hand edited }");
		const result = await runCommand({ command: "status", positionals: [], force: false }, runtime);
		const data = expectOkData(result);

		expect(data).toMatchObject({
			workspace_state: "drifted",
			start_here: ["status", "app", "sync"],
		});
		expect(String(data.next_safe_action)).toContain("Review workspace drift");
	});
});

describe("sync + drift gate", () => {
	test("renders a workspace from live worktrees, exit 0", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand({ command: "sync", positionals: [], force: false }, runtime);
		expect(result.ok).toBe(true);
		expect([...runtime.writes.keys()]).toContain("/code/my-repo.code-workspace");
	});

	test("from a linked worktree, writes the durable main-owner workspace", async () => {
		const runtime = fakeRuntime({ repoRoot: () => "/code/my-repo/.worktrees/feature-x" });
		const result = await runCommand({ command: "sync", positionals: [], force: true }, runtime);
		expect(result.ok).toBe(true);
		expect([...runtime.writes.keys()]).toContain("/code/my-repo.code-workspace");
		expect([...runtime.writes.keys()]).not.toContain("/code/my-repo/.worktrees/feature-x.code-workspace");
	});

	test("blocks overwrite when the existing file drifted, non-interactive, no --force", async () => {
		const path = "/code/my-repo.code-workspace";
		const runtime = fakeRuntime();
		runtime.writes.set(path, "{ hand edited, no WorkTree header }");
		const result = await runCommand({ command: "sync", positionals: [], force: false }, runtime);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("drift_blocked");
			expect(result.exitCode).toBe(3);
		}
	});

	test("blocks overwrite when drifted in an interactive session, no --force", async () => {
		const path = "/code/my-repo.code-workspace";
		const runtime = fakeRuntime({ isInteractive: () => true });
		runtime.writes.set(path, "{ hand edited, no WorkTree header }");
		const result = await runCommand({ command: "sync", positionals: [], force: false }, runtime);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("drift_blocked");
			expect(result.exitCode).toBe(3);
		}
	});

	test("--force overwrites a drifted file", async () => {
		const path = "/code/my-repo.code-workspace";
		const runtime = fakeRuntime();
		runtime.writes.set(path, "{ hand edited }");
		const result = await runCommand({ command: "sync", positionals: [], force: true }, runtime);
		expect(result.ok).toBe(true);
	});

	test("a previously WorkTree-generated (unedited) file re-renders cleanly", async () => {
		const path = "/code/my-repo.code-workspace";
		const runtime = fakeRuntime();
		// Seed with a valid generated file: render once via force, then re-sync.
		await runCommand({ command: "sync", positionals: [], force: true }, runtime);
		const result = await runCommand({ command: "sync", positionals: [], force: false }, runtime);
		expect(result.ok).toBe(true);
		expect(runtime.writes.get(path)?.startsWith("// GENERATED by worktree")).toBe(true);
	});

	test("creates a configured WIP folder before rendering", async () => {
		const runtime = fakeRuntime();
		runtime.writes.set(
			"/code/my-repo/worktree.config.json",
			JSON.stringify({ branches: {}, defaults: { wip: "/code/_wip" } }),
		);
		const result = await runCommand({ command: "sync", positionals: [], force: true, noInput: false }, runtime);
		expect(result.ok).toBe(true);
		expect(runtime.ensuredDirs).toContain("/code/_wip");
	});

	test("does not create a configured WIP folder when drift blocks the render", async () => {
		const runtime = fakeRuntime();
		runtime.writes.set(
			"/code/my-repo/worktree.config.json",
			JSON.stringify({ branches: {}, defaults: { wip: "/code/_wip" } }),
		);
		runtime.writes.set("/code/my-repo.code-workspace", "{ hand edited, no WorkTree header }");
		const result = await runCommand({ command: "sync", positionals: [], force: false, noInput: false }, runtime);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("drift_blocked");
		}
		expect(runtime.ensuredDirs).toEqual([]);
	});
});

describe("focus + color", () => {
	test("focus writes the registry then re-renders", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand(
			{ command: "focus", positionals: ["codex/x", "skills/y"], force: true },
			runtime,
		);
		expect(result.ok).toBe(true);
		const registry = JSON.parse(runtime.writes.get("/code/my-repo/worktree.config.json") ?? "{}");
		expect(registry.branches["codex/x"].focus).toBe("skills/y");
	});

	test("from a linked worktree, focus writes the durable main-owner registry", async () => {
		const runtime = fakeRuntime({ repoRoot: () => "/code/my-repo/.worktrees/feature-x" });
		const result = await runCommand(
			{ command: "focus", positionals: ["codex/x", "skills/y"], force: true },
			runtime,
		);
		expect(result.ok).toBe(true);
		expect(runtime.writes.has("/code/my-repo/worktree.config.json")).toBe(true);
		expect(runtime.writes.has("/code/my-repo/.worktrees/feature-x/worktree.config.json")).toBe(false);
	});

	test("malformed worktree.config.json yields registry_unreadable, exit 1, not a throw", async () => {
		const runtime = fakeRuntime();
		runtime.writes.set("/code/my-repo/worktree.config.json", "{ not valid json");
		const result = await runCommand(
			{ command: "focus", positionals: ["codex/x", "skills/y"], force: true },
			runtime,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("registry_unreadable");
			expect(result.exitCode).toBe(1);
		}
	});

	test("color rejects an unknown color with exit 2", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand(
			{ command: "color", positionals: ["codex/x", "chartreuse"], force: true },
			runtime,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("unknown_color");
			expect(result.exitCode).toBe(2);
		}
	});

	test("focus without a subfolder is a usage error, exit 2", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand({ command: "focus", positionals: ["codex/x"], force: false }, runtime);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.exitCode).toBe(2);
	});
});

describe("Codex app project cleanup helpers", () => {
	test("removeCodexSidebarState reports missing app state without writing", async () => {
		const runtime = fakeRuntime();
		const result = await removeCodexSidebarState(
			runtime,
			"/code/my-repo/.worktrees/browser-use-refactor",
		);

		expect(result).toMatchObject({
			status: "state_missing",
			removed_keys: [],
		});
		expect(runtime.writes.has(`${homedir()}/.codex/.codex-global-state.json`)).toBe(false);
	});

	test("archiveCodexThreadsForCwd reports none when the index is readable and empty", async () => {
		const runtime = fakeRuntime();
		stubCodexThreadArchive(runtime, []);
		const result = await archiveCodexThreadsForCwd(
			runtime,
			"/code/my-repo/.worktrees/browser-use-refactor",
		);

		expect(result).toMatchObject({
			status: "none",
			archived_thread_ids: [],
			failed_thread_ids: [],
			skipped_thread_ids: [],
		});
		expect(runtime.runCalls.some((call) => call[0] === "codex")).toBe(false);
	});

	test("cleanupCodexAppProject reports no-op state when nothing is registered", async () => {
		const runtime = fakeRuntime();
		stubCodexThreadArchive(runtime, []);
		const result = await cleanupCodexAppProject(
			runtime,
			"/code/my-repo/.worktrees/browser-use-refactor",
		);

		expect(result).toMatchObject({
			changed_state: "none",
			sidebar_state: {
				status: "state_missing",
			},
			thread_archive: {
				status: "none",
			},
		});
	});
});

describe("shared lifecycle verbs", () => {
	test("new creates through agent-worktree then re-renders", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand(
			{ command: "new", positionals: ["feat/z"], force: true },
			runtime,
		);
		expect(result.ok).toBe(true);
		expect(runtime.runCalls).toContainEqual([
			"git",
			"worktree",
			"add",
			"-b",
			"feat/z",
			"/code/my-repo/.worktrees/feat-z",
			"main",
		]);
	});

	test("attach delegates to agent-worktree then re-renders with lifecycle state", async () => {
		const runtime = fakeRuntime();
		let output = "";
		const exitCode = await main(["attach", "feat/existing", "--json"], {
			runtime,
			stdout: { write: (chunk) => { output += chunk; } },
		});
		const envelope = JSON.parse(output);

		expect(exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(envelope.data).toMatchObject({
			contract_id: "worktree.workspace",
			action: "attach",
			lifecycle_action: "attach",
			changed_state: "complete",
			preview: false,
			target_path: "/code/my-repo/.worktrees/feat-existing",
			mode: "branch",
			render_status: "written",
			render_workspace_path: "/code/my-repo.code-workspace",
		});
		expect(runtime.runCalls).toContainEqual([
			"git",
			"worktree",
			"add",
			"/code/my-repo/.worktrees/feat-existing",
			"feat/existing",
		]);
	});

	test("attach dry-run previews the resolved ref and target without mutation or render", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand(
			{
				command: "attach",
				positionals: ["feat/existing"],
				force: false,
				dryRun: true,
			},
			runtime,
		);
		const data = expectOkData(result);

		expect(data).toMatchObject({
			action: "attach",
			lifecycle_action: "attach",
			changed_state: "none",
			preview: true,
			resolved_ref: "jkl",
			target_path: "/code/my-repo/.worktrees/feat-existing",
			mode: "branch",
		});
		expect(runtime.runCalls.some((call) => call[1] === "worktree" && call[2] === "add")).toBe(false);
		expect(runtime.writes.has("/code/my-repo.code-workspace")).toBe(false);
	});

	test("attach guard refusal points to the existing checkout without suggesting retry", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand(
			{
				command: "attach",
				positionals: ["codex/browser-use-refactor"],
				force: false,
			},
			runtime,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("attach_branch_already_checked_out");
			expect(result.exitCode).toBe(2);
			expect(result.action).toContain("Use the existing checkout");
			expect(result.action.toLowerCase()).not.toContain("retry");
			expect(result.data).toMatchObject({
				reason: "branch_already_checked_out",
				existing_checkout_path:
					"/code/my-repo/.worktrees/browser-use-refactor",
			});
		}
	});

	test("attach isolation refusal exits 4 and asks for the human decision", async () => {
		const linked = "/code/my-repo/.worktrees/browser-use-refactor";
		const runtime = fakeRuntime({ repoRoot: () => linked });
		const result = await runCommand(
			{
				command: "attach",
				positionals: ["feat/existing"],
				force: false,
			},
			runtime,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("attach_isolation_unavailable");
			expect(result.exitCode).toBe(4);
			expect(result.action).toContain("Ask the operator to choose");
			expect(result.data).toMatchObject({
				reason: "isolation_unavailable",
				retry_safety: "operator_required",
			});
		}
	});

	test("new guard refusal points to the existing checkout without suggesting retry", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand(
			{
				command: "new",
				positionals: ["codex/browser-use-refactor"],
				force: false,
			},
			runtime,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("new_branch_already_checked_out");
			expect(result.exitCode).toBe(2);
			expect(result.action).toContain("Use the existing checkout");
			expect(result.action.toLowerCase()).not.toContain("retry");
			expect(result.data).toMatchObject({
				reason: "branch_already_checked_out",
				existing_checkout_path:
					"/code/my-repo/.worktrees/browser-use-refactor",
			});
		}
	});

	test("new isolation refusal exits 4 and asks for the human decision", async () => {
		const runtime = newIsolationFailureRuntime();
		const result = await runCommand(
			{ command: "new", positionals: ["feat/z"], force: false },
			runtime,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("new_isolation_unavailable");
			expect(result.exitCode).toBe(4);
			expect(result.action).toContain("Ask the operator to choose");
			expect(result.data).toMatchObject({
				reason: "isolation_unavailable",
				retry_safety: "operator_required",
			});
		}
	});

	test("rm removes through agent-worktree", async () => {
		const runtime = fakeRuntime();
		await runCommand({ command: "rm", positionals: ["codex/browser-use-refactor"], force: true, noInput: false }, runtime);
		expect(runtime.runCalls).toContainEqual([
			"git",
			"worktree",
			"remove",
			"/code/my-repo/.worktrees/browser-use-refactor",
		]);
	});

	test("rm removes the deleted worktree from Codex app project state", async () => {
		const runtime = fakeRuntime();
		const statePath = `${homedir()}/.codex/.codex-global-state.json`;
		const worktreePath = "/code/my-repo/.worktrees/browser-use-refactor";
		runtime.writes.set(
			statePath,
			JSON.stringify({
				"electron-saved-workspace-roots": [worktreePath, "/code/my-repo"],
				"project-order": [worktreePath],
				"pinned-project-ids": [worktreePath],
				"active-workspace-roots": [worktreePath],
				"electron-workspace-root-labels": {
					[worktreePath]: "browser-use-refactor",
				},
				"electron-persisted-atom-state": {
					"sidebar-collapsed-groups": {
						[worktreePath]: true,
					},
					"local-env-selections-by-workspace": {
						[`local:${worktreePath}`]: "/code/my-repo/.codex/environments/environment.toml",
					},
				},
			}),
		);

		const result = await runCommand(
			{ command: "rm", positionals: ["codex/browser-use-refactor"], force: true, noInput: false },
			runtime,
		);

		expect(result.ok).toBe(true);
		const state = JSON.parse(runtime.writes.get(statePath) ?? "{}");
		expect(state["electron-saved-workspace-roots"]).toEqual(["/code/my-repo"]);
		expect(state["project-order"]).toEqual([]);
		expect(state["pinned-project-ids"]).toEqual([]);
		expect(state["active-workspace-roots"]).toEqual([]);
		expect(state["electron-workspace-root-labels"]).toEqual({});
		expect(state["electron-persisted-atom-state"]["sidebar-collapsed-groups"]).toEqual({});
		expect(
			state["electron-persisted-atom-state"]["local-env-selections-by-workspace"],
		).toEqual({});
		if (result.ok) {
			expect(result.data.codex_app_project_cleanup).toMatchObject({
				worktree_path: worktreePath,
				sidebar_state: {
					status: "removed",
				},
			});
		}
	});

	test("rm archives non-current Codex threads for the deleted worktree", async () => {
		const { runtime, result } = await runBrowserUseRmWithCodexThreads([
			"thread-one",
			"thread-two",
		]);

		expect(result.ok).toBe(true);
		expect(runtime.runCalls).toContainEqual(["codex", "archive", "thread-one"]);
		expect(runtime.runCalls).toContainEqual(["codex", "archive", "thread-two"]);
		if (result.ok) {
			expect(result.data.codex_app_project_cleanup).toMatchObject({
				thread_archive: {
					status: "archived",
					archived_thread_ids: ["thread-one", "thread-two"],
				},
			});
		}
	});

	test("rm does not archive the current Codex thread", async () => {
		const previousThreadId = process.env.CODEX_THREAD_ID;
		process.env.CODEX_THREAD_ID = "thread-current";
		try {
			const { runtime, result } = await runBrowserUseRmWithCodexThreads([
				"thread-current",
				"thread-other",
			]);

			expect(result.ok).toBe(true);
			expect(runtime.runCalls).not.toContainEqual(["codex", "archive", "thread-current"]);
			expect(runtime.runCalls).toContainEqual(["codex", "archive", "thread-other"]);
			if (result.ok) {
				expect(result.data.codex_app_project_cleanup).toMatchObject({
					thread_archive: {
						archived_thread_ids: ["thread-other"],
						skipped_thread_ids: ["thread-current"],
					},
				});
			}
		} finally {
			if (previousThreadId === undefined) {
				delete process.env.CODEX_THREAD_ID;
			} else {
				process.env.CODEX_THREAD_ID = previousThreadId;
			}
		}
	});

	test("rm reports partial Codex cleanup when a thread archive fails", async () => {
		const { runtime, result } = await runBrowserUseRmWithCodexThreads(
			["thread-ok", "thread-fail"],
			["thread-fail"],
		);

		expect(result.ok).toBe(true);
		expect(runtime.runCalls).toContainEqual(["codex", "archive", "thread-ok"]);
		expect(runtime.runCalls).toContainEqual(["codex", "archive", "thread-fail"]);
		if (result.ok) {
			expect(result.data.codex_app_project_cleanup).toMatchObject({
				changed_state: "partial",
				thread_archive: {
					status: "partial",
					archived_thread_ids: ["thread-ok"],
					failed_thread_ids: ["thread-fail"],
				},
			});
		}
	});

	test("rm reports partial Codex cleanup when app state is unreadable", async () => {
		const runtime = fakeRuntime();
		runtime.writes.set(`${homedir()}/.codex/.codex-global-state.json`, "{ bad json");

		const result = await runCommand(
			{ command: "rm", positionals: ["codex/browser-use-refactor"], force: true, noInput: false },
			runtime,
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.codex_app_project_cleanup).toMatchObject({
				changed_state: "partial",
				sidebar_state: {
					status: "state_unreadable",
				},
			});
		}
	});

	test("rm force confirms deletion but does not force workspace drift overwrite", async () => {
		const path = "/code/my-repo.code-workspace";
		const runtime = fakeRuntime();
		runtime.writes.set(path, "{ hand edited, no WorkTree header }");

		const result = await runCommand(
			{ command: "rm", positionals: ["codex/browser-use-refactor"], force: true, noInput: false },
			runtime,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("drift_blocked");
			expect(result.data).toMatchObject({
				action: "rm",
				lifecycle_action: "delete",
				changed_state: "complete",
				changes: ["removed worktree"],
				render_status: "drift_blocked",
				render_workspace_path: path,
			});
		}
		expect(runtime.writes.get(path)).toBe("{ hand edited, no WorkTree header }");
	});

	test("rm force-render explicitly overwrites workspace drift after deletion", async () => {
		const path = "/code/my-repo.code-workspace";
		const runtime = fakeRuntime();
		runtime.writes.set(path, "{ hand edited, no WorkTree header }");

		const result = await runCommand(
			{
				command: "rm",
				positionals: ["codex/browser-use-refactor"],
				force: true,
				forceRender: true,
				noInput: false,
			},
			runtime,
		);

		expect(result.ok).toBe(true);
		expect(runtime.writes.get(path)?.startsWith("// GENERATED by worktree")).toBe(true);
	});

	test("rm from the linked worktree being removed renders from the main owner root", async () => {
		const linked = "/code/my-repo/.worktrees/browser-use-refactor";
		const runtime = fakeRuntime({ repoRoot: () => linked });
		const originalRun = runtime.run;
		let removed = false;
		runtime.run = async (args, options) => {
			if (
				removed &&
				options?.cwd === linked &&
				args.join(" ") === "git worktree list --porcelain"
			) {
				return { ok: false, stdout: "", stderr: "deleted cwd", code: 128 };
			}
			const result = await originalRun(args, options);
			if (args.join(" ") === "git worktree remove /code/my-repo/.worktrees/browser-use-refactor") {
				removed = true;
			}
			return result;
		};

		const result = await runCommand(
			{ command: "rm", positionals: ["codex/browser-use-refactor"], force: true, noInput: false },
			runtime,
		);

		expect(result.ok).toBe(true);
		expect([...runtime.writes.keys()]).toContain("/code/my-repo.code-workspace");
		expect([...runtime.writes.keys()]).not.toContain(
			"/code/my-repo/.worktrees/browser-use-refactor.code-workspace",
		);
	});

	test("destructive shared verbs require force in non-interactive runs", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand(
			{ command: "rm", positionals: ["codex/browser-use-refactor"], force: false, noInput: true },
			runtime,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.exitCode).toBe(2);
		}
		expect(runtime.runCalls).not.toContainEqual([
			"git",
			"worktree",
			"remove",
			"/code/my-repo/.worktrees/browser-use-refactor",
		]);
	});

	test("lifecycle verbs require a branch", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand({ command: "new", positionals: [], force: false }, runtime);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("usage_error");
			expect(result.exitCode).toBe(2);
			expect(result.action).toBe("Rerun as: worktree new <branch>.");
		}
		expect(runtime.runCalls).toEqual([]);
	});

	test("clean previews candidates without destructive calls", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand({ command: "clean", positionals: [], force: false }, runtime);
		expect(result.ok).toBe(true);
		expect(runtime.runCalls.some((call) => call.join(" ").includes("branch -D"))).toBe(false);
		expect(runtime.runCalls.some((call) => call.join(" ").includes("worktree remove"))).toBe(false);
	});

	test("clean hides registry-configured worktree path globs", async () => {
		const runtime = fakeRuntime();
		runtime.writes.set(
			"/code/my-repo/worktree.config.json",
			JSON.stringify({
				branches: {},
				defaults: { ignoredWorktrees: ["**/fallow-audit-base-cache-*"] },
			}),
		);
		const originalRun = runtime.run;
		runtime.run = async (args, options) => {
			if (args.join(" ") === "git worktree list --porcelain") {
				return {
					ok: true,
					stdout: `${runtimeFixtureFor(options?.cwd)}

worktree /tmp/fallow-audit-base-cache-abc-123
HEAD xyz
detached
`,
					stderr: "",
					code: 0,
				};
			}
			return originalRun(args, options);
		};

		const result = await runCommand({ command: "clean", positionals: [], force: false }, runtime);

		expect(result.ok).toBe(true);
		if (result.ok) {
			const preview = result.data.preview as {
				registeredWorktrees: Array<{ worktree: { path: string } }>;
				totalRegisteredWorktrees: number;
			};
			expect(preview.totalRegisteredWorktrees).toBe(3);
			expect(preview.registeredWorktrees.map((row) => row.worktree.path)).not.toContain(
				"/tmp/fallow-audit-base-cache-abc-123",
			);
		}
	});

	test("clean reports malformed registry as repairable state", async () => {
		const runtime = fakeRuntime();
		runtime.writes.set("/code/my-repo/worktree.config.json", "{not json");
		const result = await runCommand({ command: "clean", positionals: [], force: false }, runtime);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("registry_unreadable");
			expect(result.exitCode).toBe(1);
			expect(result.recoverability).toBe("repair_state");
		}
	});

	test("shared runtime failure surfaces agent_worktree_failed, exit 1, no re-render", async () => {
		const runtime = runtimeWithRemoveFailure();
		const result = await runCommand({ command: "rm", positionals: ["codex/browser-use-refactor"], force: true }, runtime);
		expectAgentWorktreeFailed(result);
		expectLifecycleErrorData(result, {
			changed_state: "none",
			failure_ref: {
				kind: "failure",
				id: "worktree-1000/remove_worktree",
			},
			next_safe_action: "inspect",
			retry_safety: "same_input_safe",
		});
	});

	test("rm reports shared target_not_found blocks instead of re-rendering", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand(
			{ command: "rm", positionals: ["codex/missing"], force: true },
			runtime,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("agent_worktree_blocked");
			expect(result.recoverability).toBe("change_input");
			expect(result.data).toMatchObject({
				action: "rm",
				lifecycle_action: "delete",
				changed_state: "none",
				preview: true,
				next_safe_action: "list",
				reason: "target_not_found",
				retry_safety: "same_input_safe",
			});
		}
		expect([...runtime.writes.keys()]).not.toContain("/code/my-repo.code-workspace");
	});

	test("rm preserves shared dirty-block recovery fields", async () => {
		const runtime = fakeRuntime({
			run: async (args, options) => {
				if (
					args.join(" ") === "git status --porcelain" &&
					options?.cwd === "/code/my-repo/.worktrees/browser-use-refactor"
				) {
					return { ok: true, stdout: " M file.txt\n", stderr: "", code: 0 };
				}
				return fakeRuntime().run(args, options);
			},
		});
		const result = await runCommand(
			{ command: "rm", positionals: ["codex/browser-use-refactor"], force: true },
			runtime,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("agent_worktree_failed");
		}
		expectLifecycleErrorData(result, {
			action: "rm",
			lifecycle_action: "delete",
			changed_state: "none",
			preview: false,
			next_safe_action: "inspect",
			reason: "dirty",
			retry_safety: "same_input_safe",
			failure_ref: {
				kind: "failure",
				id: "worktree-1000/preflight_blocked",
			},
			recovery: {
				nextActionId: "retry_same_input",
				choices: [
					{
						retrySafety: "same_input_safe",
						handoffReason: "dirty_state",
					},
				],
			},
		});
		expect(runtime.runCalls).not.toContainEqual([
			"git",
			"worktree",
			"remove",
			"/code/my-repo/.worktrees/browser-use-refactor",
		]);
		expect([...runtime.writes.keys()]).not.toContain("/code/my-repo.code-workspace");
	});
});

describe("open", () => {
	test("no arg lists the workspace path", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand({ command: "open", positionals: [], force: false }, runtime);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.action).toBe("list_workspaces");
	});

	test("from a linked worktree, open lists the durable main-owner workspace", async () => {
		const runtime = fakeRuntime({ repoRoot: () => "/code/my-repo/.worktrees/feature-x" });
		const result = await runCommand({ command: "open", positionals: [], force: false }, runtime);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.workspace).toBe("/code/my-repo.code-workspace");
		}
	});

	test("malformed registry blocks opening with a repair hint", async () => {
		const runtime = fakeRuntime();
		runtime.writes.set("/code/my-repo/worktree.config.json", "{not json");
		const result = await runCommand(
			{ command: "open", positionals: ["my-repo"], force: false },
			runtime,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("registry_unreadable");
			expect(result.action).toBe("Repair the registry JSON, then retry.");
		}
		expect(runtime.launched).toEqual([]);
	});

	test("missing `code` binary yields code_not_found, exit 2", async () => {
		const runtime = fakeRuntime({ launchCode: async () => false });
		const result = await runCommand(
			{ command: "open", positionals: ["my-repo"], force: false },
			runtime,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("code_not_found");
			expect(result.exitCode).toBe(2);
		}
	});

	test("named workspace resolves beside the current repo and uses defaults.codeBin", async () => {
		const runtime = fakeRuntime();
		runtime.writes.set(
			"/code/my-repo/worktree.config.json",
			JSON.stringify({ branches: {}, defaults: { codeBin: "/bin/code-custom" } }),
		);
		const result = await runCommand({ command: "open", positionals: ["other-repo"], force: false, noInput: false }, runtime);
		expect(result.ok).toBe(true);
		expect(runtime.launched).toEqual([
			{ workspacePath: "/code/other-repo.code-workspace", codeBin: "/bin/code-custom" },
		]);
	});
});

describe("app", () => {
	test("opens the branch worktree in Codex Desktop", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand(
			{ command: "app", positionals: ["codex/browser-use-refactor"], force: false },
			runtime,
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				action: "open_codex_app",
				branch: "codex/browser-use-refactor",
				worktree_path: "/code/my-repo/.worktrees/browser-use-refactor",
				launched: true,
			});
		}
		expect(runtime.launchedCodex).toEqual([
			{ worktreePath: "/code/my-repo/.worktrees/browser-use-refactor", codexBin: undefined },
		]);
	});

	test("missing branch yields worktree_not_found, exit 2", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand(
			{ command: "app", positionals: ["codex/missing"], force: false },
			runtime,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("worktree_not_found");
			expect(result.exitCode).toBe(2);
			expect(result.recoverability).toBe("change_input");
		}
		expect(runtime.launchedCodex).toEqual([]);
	});

	test("missing Codex Desktop launcher yields codex_app_not_found, exit 2", async () => {
		const runtime = fakeRuntime({ launchCodexApp: async () => false });
		const result = await runCommand(
			{ command: "app", positionals: ["codex/browser-use-refactor"], force: false },
			runtime,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("codex_app_not_found");
			expect(result.exitCode).toBe(2);
		}
	});
});

describe("Command Surface Alignment Proof", () => {
	test("commands returns the discovery contract", async () => {
		const result = await runCommand(
			{ command: "commands", positionals: [], force: false },
			fakeRuntime(),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.contract_id).toBe("worktree.commands");
			expect(JSON.stringify(result.data)).toContain("worktree.commands");
			const commands = result.data.commands as Record<string, unknown>;
			expect(Object.keys(commands)[0]).toBe("status");
			expect(commands.attach).toMatchObject({
				summary: worktreeContracts.attach.summary,
				mutation: "write",
				execution_modes: ["dry_run", "normal"],
			});
			expect(commands.status).toMatchObject({
				summary: worktreeContracts.status.summary,
				mutation: "check",
				interactivity: "none",
			});
		}
	});

	test("every advertised flag for each verb appears in its rendered help", () => {
		for (const command of Object.keys(worktreeContracts) as (keyof typeof worktreeContracts)[]) {
			const help = renderCommandUsage(worktreeContracts[command]);
			assertCommandHelpFlagSurface({
				command,
				contract: worktreeContracts[command],
				help,
			});
		}
	});

	test("command-foreign flags do not leak into help (open has no --force)", () => {
		const openHelp = renderCommandUsage(worktreeContracts.open);
		assertCommandHelpFlagSurface({
			command: "open",
			contract: worktreeContracts.open,
			help: openHelp,
			absentFlags: ["--force"],
		});
		expect(Object.keys(worktreeContracts.open.flags)).not.toContain("--force");
		const appHelp = renderCommandUsage(worktreeContracts.app);
		assertCommandHelpFlagSurface({
			command: "app",
			contract: worktreeContracts.app,
			help: appHelp,
			absentFlags: ["--force"],
		});
		expect(Object.keys(worktreeContracts.app.flags)).not.toContain("--force");
		const attachHelp = renderCommandUsage(worktreeContracts.attach);
		assertCommandHelpFlagSurface({
			command: "attach",
			contract: worktreeContracts.attach,
			help: attachHelp,
			absentFlags: ["--ref", "--force"],
		});
		expect(attachHelp).toContain("worktree attach <ref> --json");
		expect(attachHelp).toContain("worktree attach --pr <n> --json");
	});

	test("the drift-blocked exit code 3 is declared in the contract", () => {
		expect(worktreeContracts.sync.exitCodes["3"]).toBeDefined();
	});

	test("the human-decision exit code 4 and attach refusal affordances are declared", () => {
		expect(worktreeContracts.attach.exitCodes["4"]).toContain("human decision");
		expect(
			worktreeContracts.attach.actionAffordances?.failure.map((action) => action.id),
		).toEqual(
			expect.arrayContaining([
				"use_existing_checkout",
				"choose_attach_isolation_recovery",
				"inspect_worktrees",
			]),
		);
	});

	test("the human-decision exit code 4 and isolation refusal affordances are declared for new", () => {
		expect(worktreeContracts.new.exitCodes["4"]).toContain("human decision");
		expect(
			worktreeContracts.new.actionAffordances?.failure.map((action) => action.id),
		).toEqual(
			expect.arrayContaining([
				"use_existing_checkout",
				"choose_attach_isolation_recovery",
			]),
		);
	});

	test("no-args help renders the front door menu, not a single subcommand", async () => {
		let output = "";
		const exitCode = await main([], {
			runtime: fakeRuntime(),
			stdout: { write: (chunk) => { output += chunk; } },
		});

		expect(exitCode).toBe(0);
		expect(output).toContain("Usage: worktree <command> --json");
		expect(output).toContain("WorkTree keeps VS Code's workspace file in sync");
		expect(output).toContain("VS Code sync:");
		expect(output).toContain("Check what VS Code will see      worktree status --json");
		expect(output).toContain("Rebuild the VS Code workspace    worktree sync --json");
		expect(output).toContain("Find the VS Code workspace path  worktree open --json");
		expect(output).toContain("Worktree CRUD:");
		expect(output).toContain("Create a worktree                worktree new <branch> --json");
		expect(output).toContain("Attach an existing ref or PR     worktree attach <ref> --json | worktree attach --pr <n> --json");
		expect(output).toContain("Read/list current worktrees      worktree status --json");
		expect(output).toContain("Update the VS Code view          worktree sync --json");
		expect(output).toContain("Delete a worktree                worktree rm <branch> --force --json");
		expect(output).toContain("Commands:");
		expect(output).not.toBe(renderCommandUsage(worktreeContracts.sync));
	});

	test("help subcommand renders command-specific help", async () => {
		let output = "";
		const exitCode = await main(["help", "app"], {
			runtime: fakeRuntime(),
			stdout: { write: (chunk) => { output += chunk; } },
		});

		expect(exitCode).toBe(0);
		expect(output).toContain("Usage: worktree app <branch> --json");
		expect(output).toContain(worktreeContracts.app.summary);
		expect(output).not.toContain("Worktree CRUD:");
	});

	test("emitted diagnostic codes stay inside the exported contract tuple", async () => {
		const knownCodes = new Set(WORKTREE_DIAGNOSTIC_CODES);
		const worktreeListFailure = fakeRuntime({
			run: async (args) =>
				args.join(" ") === "git worktree list --porcelain"
					? { ok: false, stdout: "", stderr: "no worktrees", code: 1 }
					: fakeRuntime().run(args),
		});
		const writeFailure = fakeRuntime({
			writeTextFile: async () => {
				throw new Error("write failed");
			},
		});
		const drifted = fakeRuntime();
		drifted.writes.set("/code/my-repo.code-workspace", "{ hand edited }");
		const malformedRegistry = fakeRuntime();
		malformedRegistry.writes.set("/code/my-repo/worktree.config.json", "{ bad");
		const lifecycleFailure = fakeRuntime({
			run: async (args, options) => {
				if (args.join(" ") === "git worktree remove /code/my-repo/.worktrees/browser-use-refactor") {
					return { ok: false, stdout: "", stderr: "remove failed", code: 1 };
				}
				return fakeRuntime().run(args, options);
			},
		});

		const results = await Promise.all([
			runCommand({ command: "unknown", positionals: [], force: false }, fakeRuntime()),
			runCommand({ command: "sync", positionals: [], force: false }, drifted),
			runCommand({ command: "sync", positionals: [], force: false }, malformedRegistry),
			runCommand({ command: "sync", positionals: [], force: false }, worktreeListFailure),
			runCommand({ command: "color", positionals: ["codex/x", "chartreuse"], force: false }, fakeRuntime()),
			runCommand({ command: "open", positionals: ["my-repo"], force: false }, fakeRuntime({ launchCode: async () => false })),
			runCommand({ command: "app", positionals: ["codex/missing"], force: false }, fakeRuntime()),
			runCommand({ command: "app", positionals: ["codex/browser-use-refactor"], force: false }, fakeRuntime({ launchCodexApp: async () => false })),
			runCommand({ command: "sync", positionals: [], force: true }, writeFailure),
			runCommand({ command: "rm", positionals: ["codex/missing"], force: true }, fakeRuntime()),
			runCommand({ command: "rm", positionals: ["codex/browser-use-refactor"], force: true }, lifecycleFailure),
			runCommand({ command: "attach", positionals: ["codex/browser-use-refactor"], force: false }, fakeRuntime()),
			runCommand(
				{ command: "attach", positionals: ["feat/existing"], force: false },
				fakeRuntime({ repoRoot: () => "/code/my-repo/.worktrees/browser-use-refactor" }),
			),
			runCommand({ command: "new", positionals: ["codex/browser-use-refactor"], force: false }, fakeRuntime()),
			runCommand({ command: "new", positionals: ["feat/z"], force: false }, newIsolationFailureRuntime()),
		]);

		for (const result of results) {
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(knownCodes.has(result.code)).toBe(true);
			}
		}
	});

	test("the color palette the validator accepts matches the contract's documented set", () => {
		// Validator and palette derive from the same package-owned constant.
		for (const color of WORKTREE_COLOR_PALETTE) {
			expect(validateColor(color)).toBe(color);
		}
	});

	test("color advertises a palette-selection failure continuation", () => {
		expect(worktreeContracts.color.actionAffordances).toBeDefined();
		expect(
			worktreeContracts.color.actionAffordances?.failure.map((action) => action.id),
		).toContain("choose_palette_color");
	});

	test("an unknown verb is a usage error, exit 2", async () => {
		const runtime = fakeRuntime();
		const result = await runCommand({ command: "frobnicate", positionals: [], force: false }, runtime);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.exitCode).toBe(2);
	});

	test("public argv honors --repo by writing the requested repo workspace", async () => {
		const runtime = fakeRuntime();
		let output = "";
		const exitCode = await main(["sync", "--repo", "/code/other-repo", "--json"], {
			runtime,
			stdout: { write: (chunk) => { output += chunk; } },
		});
		expect(exitCode).toBe(0);
		expect([...runtime.writes.keys()]).toContain("/code/other-repo.code-workspace");
		expect(output).toContain("\"status\": \"ok\"");
	});

	test("public argv emits status for the requested repo", async () => {
		const runtime = fakeRuntime();
		let output = "";
		const exitCode = await main(["status", "--repo", "/code/other-repo", "--json"], {
			runtime,
			stdout: { write: (chunk) => { output += chunk; } },
		});
		const envelope = JSON.parse(output);

		expect(exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(envelope.data).toMatchObject({
			action: "status",
			owner_root: "/code/other-repo",
			workspace_path: "/code/other-repo.code-workspace",
			linked_worktree_count: 2,
		});
	});

	test("public argv opens the requested repo worktree in Codex Desktop", async () => {
		const runtime = fakeRuntime();
		let output = "";
		const exitCode = await main(
			["app", "codex/browser-use-refactor", "--repo", "/code/other-repo", "--json"],
			{
				runtime,
				stdout: { write: (chunk) => { output += chunk; } },
			},
		);

		expect(exitCode).toBe(0);
		expect(runtime.launchedCodex).toEqual([
			{ worktreePath: "/code/other-repo/.worktrees/browser-use-refactor", codexBin: undefined },
		]);
		expect(output).toContain("\"status\": \"ok\"");
	});

	test("public argv rejects command-foreign flags", async () => {
		const runtime = fakeRuntime();
		const openExitCode = await main(["open", "--force", "--json"], {
			runtime,
			stdout: { write: () => {} },
		});
		const attachExitCode = await main(["attach", "--ref", "feat/existing", "--json"], {
			runtime,
			stdout: { write: () => {} },
		});
		expect(openExitCode).toBe(2);
		expect(attachExitCode).toBe(2);
	});

	test("public argv emits the attach human-decision refusal with exit 4", async () => {
		const runtime = fakeRuntime({
			repoRoot: () => "/code/my-repo/.worktrees/browser-use-refactor",
		});
		let output = "";
		const exitCode = await main(["attach", "feat/existing", "--json"], {
			runtime,
			stdout: { write: (chunk) => { output += chunk; } },
		});
		const envelope = JSON.parse(output);

		expect(exitCode).toBe(4);
		expect(envelope.status).toBe("error");
		expect(envelope.error).toMatchObject({
			code: "attach_isolation_unavailable",
			exit_code: 4,
			hint: {
				summary: expect.stringContaining("Ask the operator to choose"),
			},
		});
	});

	test("public argv preserves shared lifecycle recovery data on blocks", async () => {
		const runtime = fakeRuntime();
		let output = "";
		const exitCode = await main(["rm", "codex/missing", "--force", "--json"], {
			runtime,
			stdout: { write: (chunk) => { output += chunk; } },
		});
		const envelope = JSON.parse(output);

		expect(exitCode).toBe(1);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("agent_worktree_blocked");
		expect(envelope.data).toMatchObject({
			action: "rm",
			lifecycle_action: "delete",
			changed_state: "none",
			next_safe_action: "list",
			reason: "target_not_found",
			retry_safety: "same_input_safe",
		});
	});
});
