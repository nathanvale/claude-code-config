import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import {
	describeCliProcessRun,
	parseCliProcessJson,
	runCliProcess,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";
import { wtContracts } from "./command-contract.ts";
import { WT_CONTRACT_ID } from "./model.ts";
import { workspacePathFor } from "./wt-discovery.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceEntry = join(packageRoot, "src/wt.ts");
const WT_SCRIPT = wtContracts.sync.script;
const SPAWN_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 30_000;
const KILL_SIGNAL = "SIGKILL";

function runWtPackage(
	args: readonly string[],
	label: string,
): Promise<CliProcessResult> {
	return runCliProcess({
		label,
		argv: ["bun", "run", "--silent", WT_SCRIPT, ...args],
		cwd: packageRoot,
		timeoutMs: SPAWN_TIMEOUT_MS,
		killSignal: KILL_SIGNAL,
	});
}

function envelopeData(
	envelope: Record<string, unknown>,
	result: CliProcessResult,
): Record<string, unknown> {
	const data = envelope.data;
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new Error(
			`Expected envelope.data object:\n${describeCliProcessRun(result)}`,
		);
	}
	return data as Record<string, unknown>;
}

function expectOkEnvelope(result: CliProcessResult): Record<string, unknown> {
	expect(result.exitCode, describeCliProcessRun(result)).toBe(0);
	const envelope = parseCliProcessJson<Record<string, unknown>>(result);
	expect(envelope.status, describeCliProcessRun(result)).toBe("ok");
	const data = envelopeData(envelope, result);
	expect(data.contract_id, describeCliProcessRun(result)).toBe(WT_CONTRACT_ID);
	return data;
}

function expectOkAction(
	result: CliProcessResult,
	action: string,
	options: { changedState?: string } = {},
): Record<string, unknown> {
	const data = expectOkEnvelope(result);
	expect(data.action, describeCliProcessRun(result)).toBe(action);
	if (options.changedState !== undefined) {
		expect(data.changed_state, describeCliProcessRun(result)).toBe(
			options.changedState,
		);
	}
	return data;
}

function expectStringArrayContaining(
	result: CliProcessResult,
	value: unknown,
	substring: string,
): void {
	if (!Array.isArray(value)) {
		throw new Error(
			`Expected string array containing ${substring}:\n${describeCliProcessRun(
				result,
			)}`,
		);
	}
	expect(
		value.some((entry) => typeof entry === "string" && entry.includes(substring)),
		describeCliProcessRun(result),
	).toBe(true);
}

function gitOutput(cwd: string, args: readonly string[]): string {
	const result = spawnSync("git", [...args], {
		cwd,
		env: process.env,
		encoding: "utf8",
		timeout: SPAWN_TIMEOUT_MS,
		killSignal: KILL_SIGNAL,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const stdout = result.stdout ?? "";
	if (result.status === 0) return stdout;
	throw new Error(
		`git ${args.join(" ")} failed:\ncwd=${cwd}\nexit=${
			result.status
		}\nstdout=${JSON.stringify(stdout.trimEnd())}\nstderr=${JSON.stringify(
			(result.stderr ?? "").trimEnd(),
		)}`,
	);
}

async function withTempRoot<T>(
	prefix: string,
	body: (root: string) => Promise<T>,
): Promise<T> {
	const root = mkdtempSync(join(tmpdir(), `wt-entrypoint-${prefix}-`));
	try {
		const value = await body(root);
		rmSync(root, { recursive: true, force: true });
		return value;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${message}\nkeptTempRoot=${root}`, { cause: error });
	}
}

async function withTempRepo<T>(
	prefix: string,
	body: (repo: string) => Promise<T>,
): Promise<T> {
	return withTempRoot(prefix, async (root) => {
		const repoPath = join(root, "repo");
		mkdirSync(repoPath, { recursive: true });
		const repo = realpathSync(repoPath);
		const git = (args: readonly string[]): void => {
			gitOutput(repo, args);
		};

		git(["init", "--initial-branch=main"]);
		git(["config", "user.name", "wt Integration Test"]);
		git(["config", "user.email", "wt-integration@example.test"]);
		git(["commit", "--allow-empty", "-m", "chore: seed repo"]);
		git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
		git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);

		return body(repo);
	});
}

describe("wt package entrypoint integration", () => {
	test(
		"sync writes a generated workspace in a real repo",
		async () => {
			await withTempRepo("sync", async (repo) => {
				const result = await runWtPackage(
					["sync", "--repo", repo, "--json"],
					"wt sync --json real repo",
				);
				const data = expectOkAction(result, "sync", { changedState: "written" });
				const workspacePath = workspacePathFor(repo);

				expect(data.workspace_path, describeCliProcessRun(result)).toBe(
					workspacePath,
				);
				expect(existsSync(workspacePath), describeCliProcessRun(result)).toBe(
					true,
				);
				expect(
					readFileSync(workspacePath, "utf8").startsWith("// GENERATED by wt"),
					describeCliProcessRun(result),
				).toBe(true);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"focus and color update the registry through the package script",
		async () => {
			await withTempRepo("focus-color", async (repo) => {
				const focus = await runWtPackage(
					["focus", "main", "skills/wt", "--repo", repo, "--json"],
					"wt focus --json real repo",
				);
				expectOkAction(focus, "focus", { changedState: "written" });

				const color = await runWtPackage(
					["color", "main", "teal", "--repo", repo, "--json"],
					"wt color --json real repo",
				);
				expectOkAction(color, "color", { changedState: "written" });

				const registry = JSON.parse(
					readFileSync(join(repo, "wt.config.json"), "utf8"),
				) as {
					branches?: Record<string, { focus?: string; color?: string }>;
				};
				expect(registry.branches?.main?.focus, describeCliProcessRun(color)).toBe(
					"skills/wt",
				);
				expect(registry.branches?.main?.color, describeCliProcessRun(color)).toBe(
					"teal",
				);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"clean previews stale dirs and orphan branches without deleting them",
		async () => {
			await withTempRepo("clean", async (repo) => {
				const staleDir = join(repo, ".worktrees", "stale-clean");
				mkdirSync(staleDir, { recursive: true });
				gitOutput(repo, ["branch", "old/wt-entrypoint", "main"]);

				const result = await runWtPackage(
					["clean", "--repo", repo, "--json"],
					"wt clean --json real repo",
				);
				const data = expectOkAction(result, "clean_preview", {
					changedState: "none",
				});
				const preview = data.preview as Record<string, unknown> | undefined;

				expect(preview?.previewOnly, describeCliProcessRun(result)).toBe(true);
				expectStringArrayContaining(
					result,
					preview?.orphanBranches,
					"old/wt-entrypoint",
				);
				expectStringArrayContaining(result, preview?.staleDirs, staleDir);
				expect(existsSync(staleDir), describeCliProcessRun(result)).toBe(true);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"new and rm create, remove, and re-render a linked worktree",
		async () => {
			await withTempRepo("new-rm", async (repo) => {
				const branch = "feat/wt-entrypoint";
				const targetPath = join(repo, ".worktrees", "feat-wt-entrypoint");

				const create = await runWtPackage(
					["new", branch, "--repo", repo, "--json"],
					"wt new --json real repo",
				);
				expectOkAction(create, "new", { changedState: "written" });
				expect(existsSync(targetPath), describeCliProcessRun(create)).toBe(true);
				expect(
					gitOutput(repo, ["worktree", "list", "--porcelain"]),
					describeCliProcessRun(create),
				).toContain(`branch refs/heads/${branch}`);

				const remove = await runWtPackage(
					["rm", branch, "--force", "--repo", repo, "--json"],
					"wt rm --json real repo",
				);
				expectOkAction(remove, "rm", { changedState: "written" });
				expect(existsSync(targetPath), describeCliProcessRun(remove)).toBe(false);
				expect(
					gitOutput(repo, ["worktree", "list", "--porcelain"]),
					describeCliProcessRun(remove),
				).not.toContain(`branch refs/heads/${branch}`);
				expect(
					existsSync(workspacePathFor(repo)),
					describeCliProcessRun(remove),
				).toBe(true);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"open with no name lists the workspace path without launching a GUI",
		async () => {
			await withTempRepo("open-list", async (repo) => {
				const result = await runCliProcess({
					label: "wt open --json real repo cwd",
					argv: ["bun", "run", sourceEntry, "open", "--json"],
					cwd: repo,
					timeoutMs: SPAWN_TIMEOUT_MS,
					killSignal: KILL_SIGNAL,
				});
				const data = expectOkAction(result, "list_workspaces");

				expect(data.workspace, describeCliProcessRun(result)).toBe(
					workspacePathFor(repo),
				);
			});
		},
		TEST_TIMEOUT_MS,
	);
});
