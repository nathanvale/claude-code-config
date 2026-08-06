import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import {
	describeCliProcessRun,
	parseCliProcessJson,
	runCliProcess,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";

import {
	AGENT_WORKTREE_CLI_NAME,
	AGENT_WORKTREE_CONTRACT_ID,
} from "../src/model.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPAWN_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 30_000;
const KILL_SIGNAL = "SIGKILL";

function runPackageScript(
	script: typeof AGENT_WORKTREE_CLI_NAME,
	args: readonly string[],
	label: string,
): Promise<CliProcessResult> {
	return runCliProcess({
		label,
		argv: ["bun", "run", "--silent", script, ...args],
		cwd: packageRoot,
		timeoutMs: SPAWN_TIMEOUT_MS,
		killSignal: KILL_SIGNAL,
	});
}

function runAgentWorktreePackage(
	args: readonly string[],
	label: string,
): Promise<CliProcessResult> {
	return runPackageScript(AGENT_WORKTREE_CLI_NAME, args, label);
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
	expect(data.contract_id, describeCliProcessRun(result)).toBe(
		AGENT_WORKTREE_CONTRACT_ID,
	);
	return data;
}

function expectErrorEnvelope(result: CliProcessResult): Record<string, unknown> {
	expect(result.exitCode, describeCliProcessRun(result)).not.toBe(0);
	const envelope = parseCliProcessJson<Record<string, unknown>>(result);
	expect(envelope.status, describeCliProcessRun(result)).toBe("error");
	const data = envelopeData(envelope, result);
	expect(data.contract_id, describeCliProcessRun(result)).toBe(
		AGENT_WORKTREE_CONTRACT_ID,
	);
	return data;
}

function expectOkAction(
	result: CliProcessResult,
	action: string,
	options: { changedState?: string; preview?: boolean } = {},
): Record<string, unknown> {
	const data = expectOkEnvelope(result);
	expect(data.action, describeCliProcessRun(result)).toBe(action);
	if (options.changedState !== undefined) {
		expect(data.changed_state, describeCliProcessRun(result)).toBe(
			options.changedState,
		);
	}
	if (options.preview !== undefined) {
		expect(data.preview, describeCliProcessRun(result)).toBe(options.preview);
	}
	return data;
}

function expectRef(
	result: CliProcessResult,
	value: unknown,
	kind: string,
): { kind: string; id: string } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(
			`Expected ${kind} ref object:\n${describeCliProcessRun(result)}`,
		);
	}
	const record = value as Record<string, unknown>;
	expect(record.kind, describeCliProcessRun(result)).toBe(kind);
	expect(typeof record.id, describeCliProcessRun(result)).toBe("string");
	expect((record.id as string).length, describeCliProcessRun(result)).toBeGreaterThan(
		0,
	);
	return { kind: record.kind as string, id: record.id as string };
}

function refArg(ref: { kind: string; id: string }): string {
	return `${ref.kind}:${ref.id}`;
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
		// Isolate temp repos from global/system git config (gpgsign, hooksPath,
		// templates); explicit `git config` calls inside the repos still apply.
		env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1" },
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
	const root = mkdtempSync(join(tmpdir(), `agent-worktree-entrypoint-${prefix}-`));
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
		git(["config", "user.name", "agent-worktree Integration Test"]);
		git(["config", "user.email", "agent-worktree-integration@example.test"]);
		git(["commit", "--allow-empty", "-m", "chore: seed repo"]);
		git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
		git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);

		return body(repo);
	});
}

async function withTempPullRequestRepo<T>(
	prefix: string,
	pullRequest: number,
	body: (repo: string) => Promise<T>,
): Promise<T> {
	return withTempRoot(prefix, async (root) => {
		const origin = join(root, "origin.git");
		const seed = join(root, "seed");
		const checkout = join(root, "repo");
		mkdirSync(origin, { recursive: true });
		mkdirSync(seed, { recursive: true });

		gitOutput(origin, ["init", "--bare", "--initial-branch=main"]);
		gitOutput(seed, ["init", "--initial-branch=main"]);
		gitOutput(seed, [
			"config",
			"user.name",
			"agent-worktree Integration Test",
		]);
		gitOutput(seed, [
			"config",
			"user.email",
			"agent-worktree-integration@example.test",
		]);
		gitOutput(seed, ["commit", "--allow-empty", "-m", "chore: seed main"]);
		gitOutput(seed, ["remote", "add", "origin", origin]);
		gitOutput(seed, ["push", "origin", "main"]);
		gitOutput(seed, ["switch", "-c", "pull-request-head"]);
		gitOutput(seed, ["commit", "--allow-empty", "-m", "feat: pull request head"]);
		gitOutput(seed, [
			"push",
			"origin",
			`HEAD:refs/pull/${pullRequest}/head`,
		]);
		gitOutput(root, ["clone", origin, checkout]);
		const repo = realpathSync(checkout);
		gitOutput(repo, [
			"config",
			"user.name",
			"agent-worktree Integration Test",
		]);
		gitOutput(repo, [
			"config",
			"user.email",
			"agent-worktree-integration@example.test",
		]);

		return body(repo);
	});
}

async function expectInspectableRef(
	repo: string,
	ref: { kind: string; id: string },
	label: string,
): Promise<void> {
	const result = await runAgentWorktreePackage(
		["inspect", refArg(ref), "--repo", repo, "--json"],
		label,
	);
	const data = expectOkEnvelope(result);
	expect(data.found, describeCliProcessRun(result)).toBe(true);
	expect(data.ref, describeCliProcessRun(result)).toEqual(ref);
}

describe("agent-worktree package entrypoint integration", () => {
	test(
		"PR attach fetches a local branch and leaves the new worktree attached",
		async () => {
			await withTempPullRequestRepo("pull-request", 42, async (repo) => {
				const targetPath = join(repo, ".worktrees", "pr-42");

				const attach = await runAgentWorktreePackage(
					["attach", "--pr", "42", "--repo", repo, "--json"],
					"agent-worktree attach --pr real local origin",
				);
				const data = expectOkAction(attach, "attach", {
					changedState: "complete",
					preview: false,
				});

				expect(data.mode, describeCliProcessRun(attach)).toBe("pr");
				expect(data.resolved_ref, describeCliProcessRun(attach)).toBe("pr-42");
				expect(existsSync(targetPath), describeCliProcessRun(attach)).toBe(true);
				expect(
					gitOutput(targetPath, ["symbolic-ref", "--short", "HEAD"]).trim(),
				).toBe("pr-42");
				expect(
					gitOutput(repo, [
						"show-ref",
						"--verify",
						"--hash",
						"refs/heads/pr-42",
					]).trim().length,
				).toBeGreaterThan(0);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"create, inspect, check, and delete dry-run work through the package script",
		async () => {
			await withTempRepo("lifecycle", async (repo) => {
				const branch = "feat/agent-worktree-entrypoint";
				const targetPath = join(repo, ".worktrees", "feat-agent-worktree-entrypoint");

				const create = await runAgentWorktreePackage(
					["create", branch, "--repo", repo, "--json"],
					"agent-worktree create --json real repo",
				);
				const createData = expectOkAction(create, "create", {
					changedState: "complete",
					preview: false,
				});
				const runRef = expectRef(create, createData.run_ref, "run");
				expect(existsSync(targetPath), describeCliProcessRun(create)).toBe(true);

				await expectInspectableRef(
					repo,
					runRef,
					"agent-worktree inspect create run ref",
				);

				const check = await runAgentWorktreePackage(
					["check", branch, "--repo", repo, "--json"],
					"agent-worktree check --json real repo",
				);
				const checkData = expectOkEnvelope(check);
				expect(checkData.branch, describeCliProcessRun(check)).toBe(branch);
				expect(checkData.allowed, describeCliProcessRun(check)).toBe(true);
				expect(checkData.nextSafeAction, describeCliProcessRun(check)).toBe(
					"delete",
				);

				const deleteDryRun = await runAgentWorktreePackage(
					["delete", branch, "--dry-run", "--repo", repo, "--json"],
					"agent-worktree delete --dry-run real repo",
				);
				const deleteData = expectOkAction(deleteDryRun, "delete", {
					changedState: "none",
					preview: true,
				});
				expectStringArrayContaining(
					deleteDryRun,
					deleteData.changes,
					`remove worktree ${targetPath}`,
				);
				expect(existsSync(targetPath), describeCliProcessRun(deleteDryRun)).toBe(
					true,
				);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"protected branch failure ref survives inspect and recover dry-run",
		async () => {
			await withTempRepo("protected-branch", async (repo) => {
				const removeMain = await runAgentWorktreePackage(
					["delete", "main", "--force", "--repo", repo, "--json"],
					"agent-worktree delete main protected branch",
				);
				const failureData = expectErrorEnvelope(removeMain);
				const failureRef = expectRef(
					removeMain,
					failureData.failure_ref,
					"failure",
				);
				const failureArg = refArg(failureRef);

				expect(failureData.action, describeCliProcessRun(removeMain)).toBe(
					"delete",
				);
				expect(failureData.changed_state, describeCliProcessRun(removeMain)).toBe(
					"none",
				);
				expect(failureData.reason, describeCliProcessRun(removeMain)).toBe(
					"protected_branch",
				);
				expect(failureData.next_safe_action, describeCliProcessRun(removeMain)).toBe(
					"inspect",
				);

				await expectInspectableRef(
					repo,
					failureRef,
					"agent-worktree inspect protected failure ref",
				);

				const recover = await runAgentWorktreePackage(
					["recover", failureArg, "--dry-run", "--repo", repo, "--json"],
					"agent-worktree recover protected failure ref",
				);
				const recoverData = expectOkAction(recover, "recover", {
					changedState: "none",
					preview: true,
				});
				expect(recoverData.failure_ref, describeCliProcessRun(recover)).toEqual(
					failureRef,
				);
				expectStringArrayContaining(
					recover,
					recoverData.changes,
					`inspect ${failureArg}`,
				);
			});
		},
		TEST_TIMEOUT_MS,
	);

});
