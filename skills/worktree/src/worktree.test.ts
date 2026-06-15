import { describe, expect, test } from "bun:test";
import { renderCommandUsage } from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import { WORKTREE_DIAGNOSTIC_CODES, worktreeContracts } from "./command-contract.ts";
import { WORKTREE_COLOR_PALETTE } from "./model.ts";
import type { RunResult } from "./worktree-discovery.ts";
import {
	createDefaultRuntime,
	main,
	parseInvocation,
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
	ensuredDirs: string[];
} {
	const writes = new Map<string, string>();
	const runCalls: string[][] = [];
	const launched: Array<{ workspacePath: string; codeBin?: string }> = [];
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
		now: () => 1000,
		run: async (args, options) => {
			runCalls.push([...args]);
			const key = args.join(" ");
			const outputs: Record<string, string> = {
				"git rev-parse --show-toplevel": options?.cwd?.includes("/code/other-repo")
					? "/code/other-repo\n"
					: "/code/my-repo\n",
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
	return Object.assign(base, { writes, runCalls, launched, ensuredDirs });
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
		const runtime = fakeRuntime({
			run: async (args, options) => {
				if (args.join(" ") === "git worktree remove /code/my-repo/.worktrees/browser-use-refactor") {
					return { ok: false, stdout: "", stderr: "remove failed", code: 1 };
				}
				return fakeRuntime().run(args, options);
			},
		});
		const result = await runCommand({ command: "rm", positionals: ["codex/browser-use-refactor"], force: true }, runtime);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("agent_worktree_failed");
			expect(result.exitCode).toBe(1);
		}
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

describe("Command Surface Alignment Proof", () => {
	test("commands returns the discovery contract", async () => {
		const result = await runCommand(
			{ command: "commands", positionals: [], force: false },
			fakeRuntime(),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.contract_id).toBe("worktree.workspace");
			expect(JSON.stringify(result.data)).toContain("worktree.commands");
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
	});

	test("the drift-blocked exit code 3 is declared in the contract", () => {
		expect(worktreeContracts.sync.exitCodes["3"]).toBeDefined();
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
			runCommand({ command: "sync", positionals: [], force: true }, writeFailure),
			runCommand({ command: "rm", positionals: ["codex/missing"], force: true }, fakeRuntime()),
			runCommand({ command: "rm", positionals: ["codex/browser-use-refactor"], force: true }, lifecycleFailure),
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

	test("public argv rejects command-foreign flags", async () => {
		const runtime = fakeRuntime();
		const exitCode = await main(["open", "--force", "--json"], {
			runtime,
			stdout: { write: () => {} },
		});
		expect(exitCode).toBe(2);
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
