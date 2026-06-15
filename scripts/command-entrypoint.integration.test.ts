/**
 * Command Entrypoint Integration Test suite.
 *
 * Proves `wt`, `agent-worktree`, and `awt` through real repo-local process
 * entrypoints: package scripts, workspace-filter version probes, and direct
 * source probes. Package-local tests own in-process command semantics; this
 * suite proves the process boundary those tests cannot reach.
 *
 * Run style is "smoke" (high-signal sentinel flows), but the canonical suite
 * name is Command Entrypoint Integration Test. Kept out of the default `test`
 * gate and portability proof for v1 (see the plan's promotion boundary).
 *
 * The harness below is a single-file private harness (KTD2): helpers stay local
 * until repeated implementation pressure proves an extraction.
 */

import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	describeCliProcessRun,
	parseCliProcessJson,
	runCliProcess,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";

import { wtContracts } from "../skills/wt/src/command-contract.ts";
import {
	agentWorktreeContractEntries,
	agentWorktreeContracts,
} from "../runtime/agent-worktree/src/command-contract.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Per-command spawn timeout (primary guard).
 *
 * `Bun.spawn`/`spawnSync` enforce this and kill the child, so cleanup still
 * runs even when a single command hangs. The outer test-block timeout
 * ({@link TEST_TIMEOUT_MS}) is only a backstop.
 */
const SPAWN_TIMEOUT_MS = 15_000;

/**
 * Outer test-block timeout (backstop guard).
 *
 * Larger than {@link SPAWN_TIMEOUT_MS} so the spawn timeout fires first and
 * keeps failure diagnostics attributable to a single command.
 */
const TEST_TIMEOUT_MS = 30_000;

const KILL_SIGNAL = "SIGKILL";

/**
 * One invocation boundary the suite can drive.
 *
 * - `package-cwd`: `bun run --silent <script>` from the owning package root.
 *   Carries runtime JSON and lifecycle behavior; `--silent` strips Bun's echoed
 *   script line so JSON stdout stays clean (KTD5).
 * - `workspace-filter`: `bun --filter <pkg> <script> --version` from the repo
 *   root. Substring version probes only -- filtered stdout is a display wrapper
 *   that prefixes and elides child output (KTD6).
 * - `source`: `bun run <source-path>` from the repo root by default, or from
 *   a temp repo when the command has no explicit `--repo` flag. Carries source
 *   compatibility probes plus source-entry runtime parity rows.
 */
type InvocationMode = "package-cwd" | "workspace-filter" | "source";

/**
 * A built command ready to spawn: argv plus the boundary it identifies.
 */
interface RunnerCommand {
	mode: InvocationMode;
	label: string;
	cmd: string[];
	cwd: string;
}

/**
 * Captured result of one spawned command.
 */
interface RunResult extends RunnerCommand, CliProcessResult {}

/**
 * Package roots that own the entrypoint scripts under test.
 */
const packageRoots = {
	wt: join(repoRoot, "skills/wt"),
	agentWorktree: join(repoRoot, "runtime/agent-worktree"),
} as const;

/**
 * Source entry paths for direct `bun run <source>` compatibility probes.
 */
const sourceEntries = {
	wt: join(repoRoot, "skills/wt/src/wt.ts"),
	agentWorktree: join(repoRoot, "runtime/agent-worktree/src/cli.ts"),
} as const;

/**
 * Workspace package names for `bun --filter` version probes.
 */
const filterPackageNames = {
	wt: "wt-scripts",
	agentWorktree: "agent-worktree",
} as const;

/**
 * Typed runner map: one builder per invocation mode and entrypoint shape.
 *
 * Every builder returns `cmd`, `cwd`, `mode`, and `label` so a failure
 * identifies the exact boundary it came from (KTD4).
 */
const runners = {
	/**
	 * `bun run --silent <script> <args...>` from the owning package root.
	 */
	packageCwd(input: {
		packageRoot: string;
		script: string;
		args: readonly string[];
		label: string;
	}): RunnerCommand {
		return {
			mode: "package-cwd",
			label: input.label,
			cwd: input.packageRoot,
			cmd: ["bun", "run", "--silent", input.script, ...input.args],
		};
	},

	/**
	 * `bun --filter <pkg> <script> --version` from the repo root.
	 *
	 * Substring-only: the filtered wrapper prefixes and elides child stdout.
	 */
	workspaceFilter(input: {
		packageName: string;
		script: string;
		label: string;
	}): RunnerCommand {
		return {
			mode: "workspace-filter",
			label: input.label,
			cwd: repoRoot,
			cmd: ["bun", "--filter", input.packageName, input.script, "--version"],
		};
	},

	/**
	 * `bun run <source-path> <args...>` from the repo root.
	 */
	source(input: {
		sourcePath: string;
		args: readonly string[];
		label: string;
		cwd?: string;
	}): RunnerCommand {
		return {
			mode: "source",
			label: input.label,
			cwd: input.cwd ?? repoRoot,
			cmd: ["bun", "run", input.sourcePath, ...input.args],
		};
	},
} as const;

async function runCommand(
	command: RunnerCommand,
	timeoutMs = SPAWN_TIMEOUT_MS,
): Promise<RunResult> {
	const result = await runCliProcess({
		label: command.label,
		argv: command.cmd,
		cwd: command.cwd,
		timeoutMs,
		killSignal: KILL_SIGNAL,
	});
	return {
		...command,
		...result,
	};
}

/**
 * Excerpt long captured output so failure messages stay readable.
 */
function excerpt(value: string, limit = 600): string {
	const trimmed = value.trimEnd();
	if (trimmed.length <= limit) {
		return trimmed;
	}
	return `${trimmed.slice(0, limit)}… [${trimmed.length - limit} more chars]`;
}

/**
 * Annotate a failure with the command mode, cwd, argv, and output excerpts.
 *
 * Every assertion goes through this so a red test names the exact boundary,
 * working directory, and captured stdout/stderr without a full snapshot.
 */
function describeRun(result: RunResult): string {
	return [`mode=${result.mode}`, describeCliProcessRun(result)].join("\n");
}

/**
 * Parse the JSON envelope from a captured stdout, annotating parse failures.
 *
 * Silent package-cwd mode keeps stdout free of Bun's wrapper line, so stdout is
 * a single JSON document. A parse failure names the boundary and shows the raw
 * output (KTD5).
 */
function parseEnvelope(result: RunResult): Record<string, unknown> {
	try {
		return parseCliProcessJson<Record<string, unknown>>(result);
	} catch (error) {
		throw new Error(
			`Failed to parse JSON envelope:\n${describeRun(result)}\n${errorMessage(
				error,
			)}`,
			{ cause: error },
		);
	}
}

function envelopeData(
	envelope: Record<string, unknown>,
	result: RunResult,
): Record<string, unknown> {
	const data = envelope.data;
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new Error(`Expected envelope.data object:\n${describeRun(result)}`);
	}
	return data as Record<string, unknown>;
}

function expectOkEnvelope(result: RunResult, contractId: string): Record<string, unknown> {
	expect(result.exitCode, describeRun(result)).toBe(0);
	const envelope = parseEnvelope(result);
	expect(envelope.status, describeRun(result)).toBe("ok");
	const data = envelopeData(envelope, result);
	expect(data.contract_id, describeRun(result)).toBe(contractId);
	return data;
}

function expectErrorEnvelope(result: RunResult, contractId: string): Record<string, unknown> {
	expect(result.exitCode, describeRun(result)).not.toBe(0);
	const envelope = parseEnvelope(result);
	expect(envelope.status, describeRun(result)).toBe("error");
	const data = envelopeData(envelope, result);
	expect(data.contract_id, describeRun(result)).toBe(contractId);
	return data;
}

function expectUsageError(result: RunResult): void {
	expect(result.exitCode, describeRun(result)).not.toBe(0);
	const envelope = parseEnvelope(result);
	expect(envelope.status, describeRun(result)).toBe("error");
	expect(
		(envelope.error as Record<string, unknown> | undefined)?.code,
		describeRun(result),
	).toBe("usage_error");
}

function expectOkAction(
	result: RunResult,
	contractId: string,
	action: string,
	options: { changedState?: string; preview?: boolean } = {},
): Record<string, unknown> {
	const data = expectOkEnvelope(result, contractId);
	expect(data.action, describeRun(result)).toBe(action);
	if (options.changedState !== undefined) {
		expect(data.changed_state, describeRun(result)).toBe(options.changedState);
	}
	if (options.preview !== undefined) {
		expect(data.preview, describeRun(result)).toBe(options.preview);
	}
	return data;
}

function expectRef(
	result: RunResult,
	value: unknown,
	kind: string,
): { kind: string; id: string } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Expected ${kind} ref object:\n${describeRun(result)}`);
	}
	const record = value as Record<string, unknown>;
	expect(record.kind, describeRun(result)).toBe(kind);
	expect(typeof record.id, describeRun(result)).toBe("string");
	expect((record.id as string).length, describeRun(result)).toBeGreaterThan(0);
	return { kind: record.kind as string, id: record.id as string };
}

function refArg(ref: { kind: string; id: string }): string {
	return `${ref.kind}:${ref.id}`;
}

function runWtPackage(
	args: readonly string[],
	label: string,
): Promise<RunResult> {
	return runCommand(
		runners.packageCwd({
			packageRoot: packageRoots.wt,
			script: "wt",
			args,
			label,
		}),
	);
}

function runWtSource(
	args: readonly string[],
	label: string,
	cwd?: string,
): Promise<RunResult> {
	return runCommand(
		runners.source({
			sourcePath: sourceEntries.wt,
			args,
			label,
			cwd,
		}),
	);
}

function runAgentWorktreePackage(
	args: readonly string[],
	label: string,
): Promise<RunResult> {
	return runCommand(
		runners.packageCwd({
			packageRoot: packageRoots.agentWorktree,
			script: "agent-worktree",
			args,
			label,
		}),
	);
}

function runAwtPackage(
	args: readonly string[],
	label: string,
): Promise<RunResult> {
	return runCommand(
		runners.packageCwd({
			packageRoot: packageRoots.agentWorktree,
			script: "awt",
			args,
			label,
		}),
	);
}

function runAgentWorktreeSource(
	args: readonly string[],
	label: string,
): Promise<RunResult> {
	return runCommand(
		runners.source({
			sourcePath: sourceEntries.agentWorktree,
			args,
			label,
		}),
	);
}

function expectAgentWorktreeRefFound(
	result: RunResult,
	ref: { kind: string; id: string },
): Record<string, unknown> {
	const data = expectOkEnvelope(result, "agent-worktree.lifecycle");
	expect(data.found, describeRun(result)).toBe(true);
	expect(data.ref, describeRun(result)).toEqual(ref);
	return data;
}

function expectInspectableAgentWorktreeRefUsing(
	run: (args: readonly string[], label: string) => Promise<RunResult>,
	repo: string,
	ref: { kind: string; id: string },
	label: string,
): Promise<void> {
	return run(["inspect", refArg(ref), "--repo", repo, "--json"], label).then(
		(result) => {
			expectAgentWorktreeRefFound(result, ref);
		},
	);
}

async function expectInspectableAgentWorktreeRef(
	repo: string,
	ref: { kind: string; id: string },
	label: string,
): Promise<void> {
	await expectInspectableAgentWorktreeRefUsing(
		runAgentWorktreePackage,
		repo,
		ref,
		label,
	);
}

async function expectAgentWorktreeCreateAndInspect(input: {
	run: (args: readonly string[], label: string) => Promise<RunResult>;
	repo: string;
	branch: string;
	targetPath: string;
	createLabel: string;
	inspectLabel: string;
}): Promise<{ kind: string; id: string }> {
	const create = await input.run(
		["create", input.branch, "--repo", input.repo, "--json"],
		input.createLabel,
	);
	const createData = expectOkAction(
		create,
		"agent-worktree.lifecycle",
		"create",
		{ changedState: "complete" },
	);
	const runRef = expectRef(create, createData.run_ref, "run");
	expect(existsSync(input.targetPath), describeRun(create)).toBe(true);
	await expectInspectableAgentWorktreeRefUsing(
		input.run,
		input.repo,
		runRef,
		input.inspectLabel,
	);
	return runRef;
}

function expectStringArrayContaining(
	result: RunResult,
	value: unknown,
	substring: string,
): void {
	if (!Array.isArray(value)) {
		throw new Error(`Expected string array containing ${substring}:\n${describeRun(result)}`);
	}
	expect(
		value.some((entry) => typeof entry === "string" && entry.includes(substring)),
		describeRun(result),
	).toBe(true);
}

function workspacePathForRepo(repo: string): string {
	const realRepo = realpathSync(repo);
	return join(dirname(realRepo), `${basename(realRepo)}.code-workspace`);
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
		gitFailureMessage(cwd, args, result.status, stdout, result.stderr ?? ""),
	);
}

function gitFailureMessage(
	cwd: string,
	args: readonly string[],
	status: number | null,
	stdout: string,
	stderr: string,
): string {
	return `git ${args.join(" ")} failed:\ncwd=${cwd}\nexit=${status}\nstdout=${JSON.stringify(
		excerpt(stdout),
	)}\nstderr=${JSON.stringify(excerpt(stderr))}`;
}

function gitExitCode(cwd: string, args: readonly string[]): number | null {
	const result = spawnSync("git", [...args], {
		cwd,
		env: process.env,
		encoding: "utf8",
		timeout: SPAWN_TIMEOUT_MS,
		killSignal: KILL_SIGNAL,
		stdio: ["ignore", "pipe", "pipe"],
	});
	return result.status;
}

function gitRefExists(cwd: string, ref: string): boolean {
	return gitExitCode(cwd, ["show-ref", "--verify", "--quiet", ref]) === 0;
}

/**
 * Create a tracked temp root, run `body`, and delete the root only on success.
 *
 * On failure the root is preserved and its path is printed so a kept repo can
 * be inspected after a red lifecycle test (R20). The annotated error is
 * re-thrown with the kept-root path appended.
 */
async function withTempRoot<T>(
	prefix: string,
	body: (root: string) => Promise<T>,
): Promise<T> {
	const root = mkdtempSync(join(tmpdir(), `command-entrypoint-${prefix}-`));
	try {
		const value = await body(root);
		rmSync(root, { recursive: true, force: true });
		return value;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${message}\nkeptTempRoot=${root}`, { cause: error });
	}
}

/**
 * Create a real temp git repository with a default branch and one commit.
 *
 * Seeds `user.name`/`user.email`, an initial commit, and `origin/HEAD`-style
 * default-branch evidence so lifecycle discovery has a stable owner root. Kept
 * on failure by {@link withTempRoot}; reserved for U4+ lifecycle flows.
 */
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
		git(["config", "user.name", "Command Entrypoint Test"]);
		git(["config", "user.email", "command-entrypoint@example.test"]);
		git(["commit", "--allow-empty", "-m", "chore: seed repo"]);
		git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
		git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);

		return body(repo);
	});
}

function createLinkedWorktree(repo: string, branch: string, dirname: string): string {
	const targetPath = join(repo, ".worktrees", dirname);
	gitOutput(repo, ["worktree", "add", "-b", branch, targetPath, "main"]);
	return targetPath;
}

/**
 * Read a package.json's `scripts` block from disk.
 *
 * Discovery reads the live package metadata so a script rename surfaces here
 * instead of in a copied array (KTD8).
 */
function readPackageScripts(packageRoot: string): Record<string, string> {
	const raw = readFileSync(join(packageRoot, "package.json"), "utf8");
	const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
	return parsed.scripts ?? {};
}

/**
 * Command ids derived mechanically from the exported facade contracts.
 *
 * The contracts are discovery truth (KTD8): expected ids come from the live
 * contract objects, not from a copied list in the test body. The suite then
 * asserts the resulting set against the plan's frozen expectation.
 */
const discoveredWtCommandIds = Object.keys(wtContracts).sort();
const discoveredAgentWorktreeCommandIds = agentWorktreeContractEntries
	.map(([command]) => command)
	.sort();

/**
 * Entrypoint scripts derived from the owning package metadata.
 *
 * `wt` ships one script; `agent-worktree` ships the canonical script plus the
 * `awt` alias. Drift between these scripts and the source entries fails U2.
 */
const wtPackageScripts = readPackageScripts(packageRoots.wt);
const agentWorktreePackageScripts = readPackageScripts(packageRoots.agentWorktree);

/**
 * First rendered usage line for a contract.
 *
 * Help probes assert the rendered contract usage line, not a generic catalog
 * placeholder (KTD9). The facade renders the first usage entry as
 * `Usage: <usage[0]>` (see cli-command-facade usage.ts), and top-level help
 * renders the default command's usage. Deriving from the same `usage[0]` the
 * CLI renders from keeps the assertion coupled to the contract, not to a copied
 * string, so a usage rename fails here too.
 */
function firstUsageLine(contract: { usage: readonly string[] }): string {
	const [usage] = contract.usage;
	return `Usage: ${usage}`;
}

async function expectDiscoveredCommandHelp(input: {
	commandIds: readonly string[];
	contracts: Record<string, { usage: readonly string[] }>;
	packageRoot: string;
	script: string;
}): Promise<void> {
	for (const command of input.commandIds) {
		const contract = input.contracts[command];
		if (!contract) throw new Error(`Missing contract for ${command}`);
		const result = await runCommand(
			runners.packageCwd({
				packageRoot: input.packageRoot,
				script: input.script,
				args: [command, "--help"],
				label: `${input.script} ${command} --help (package-cwd)`,
			}),
		);
		expect(result.exitCode, describeRun(result)).toBe(0);
		expect(result.stdout, describeRun(result)).toContain(firstUsageLine(contract));
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const wtTopLevelUsageLine = firstUsageLine(wtContracts.sync);
const agentWorktreeTopLevelUsageLine = firstUsageLine(agentWorktreeContracts.doctor);

describe("command entrypoint integration: mechanical discovery", () => {
	test("derives the exact wt command id set from exported contracts", async () => {
		expect(discoveredWtCommandIds).toEqual(
			["clean", "color", "commands", "focus", "new", "open", "rm", "sync"],
		);
	});

	test("derives the exact agent-worktree command id set from exported contracts", async () => {
		expect(discoveredAgentWorktreeCommandIds).toEqual(
			[
				"check",
				"clean",
				"commands",
				"create",
				"delete",
				"doctor",
				"handoff",
				"inspect",
				"list",
				"recover",
				"refresh",
				"status",
			],
		);
	});

	test("package scripts expose the wt and agent-worktree entrypoint scripts", async () => {
		expect(Object.keys(wtPackageScripts)).toContain("wt");
		expect(Object.keys(agentWorktreePackageScripts)).toContain("agent-worktree");
		expect(Object.keys(agentWorktreePackageScripts)).toContain("awt");
	});
});

describe("command entrypoint integration: help contracts", () => {
	test(
		"wt, agent-worktree, and awt top-level help renders the contract usage line",
		async () => {
			const topLevelHelp = [
				{
					command: runners.packageCwd({
						packageRoot: packageRoots.wt,
						script: "wt",
						args: ["--help"],
						label: "wt --help (package-cwd)",
					}),
					usageLine: wtTopLevelUsageLine,
				},
				{
					command: runners.packageCwd({
						packageRoot: packageRoots.agentWorktree,
						script: "agent-worktree",
						args: ["--help"],
						label: "agent-worktree --help (package-cwd)",
					}),
					usageLine: agentWorktreeTopLevelUsageLine,
				},
				{
					command: runners.packageCwd({
						packageRoot: packageRoots.agentWorktree,
						script: "awt",
						args: ["--help"],
						label: "awt --help (package-cwd)",
					}),
					usageLine: agentWorktreeTopLevelUsageLine,
				},
			];

			for (const { command, usageLine } of topLevelHelp) {
				const result = await runCommand(command);
				expect(result.exitCode, describeRun(result)).toBe(0);
				expect(result.stdout, describeRun(result)).toContain(usageLine);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"every discovered wt command help renders its first contract usage line",
		async () => {
			await expectDiscoveredCommandHelp({
				commandIds: discoveredWtCommandIds,
				contracts: wtContracts,
				packageRoot: packageRoots.wt,
				script: "wt",
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"every discovered agent-worktree command help renders its first contract usage line",
		async () => {
			await expectDiscoveredCommandHelp({
				commandIds: discoveredAgentWorktreeCommandIds,
				contracts: agentWorktreeContracts,
				packageRoot: packageRoots.agentWorktree,
				script: "agent-worktree",
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"wt and agent-worktree source entries support --version and top-level help",
		async () => {
			const sourceProbes = [
				{
					sourcePath: sourceEntries.wt,
					label: "wt source",
					versionSubstring: "wt 0.1.0",
					usageLine: wtTopLevelUsageLine,
				},
				{
					sourcePath: sourceEntries.agentWorktree,
					label: "agent-worktree source",
					versionSubstring: "agent-worktree 0.1.0",
					usageLine: agentWorktreeTopLevelUsageLine,
				},
			];

			for (const probe of sourceProbes) {
				const version = await runCommand(
					runners.source({
						sourcePath: probe.sourcePath,
						args: ["--version"],
						label: `${probe.label} --version`,
					}),
				);
				expect(version.exitCode, describeRun(version)).toBe(0);
				expect(version.stdout, describeRun(version)).toContain(
					probe.versionSubstring,
				);

				const help = await runCommand(
					runners.source({
						sourcePath: probe.sourcePath,
						args: ["--help"],
						label: `${probe.label} --help`,
					}),
				);
				expect(help.exitCode, describeRun(help)).toBe(0);
				expect(help.stdout, describeRun(help)).toContain(probe.usageLine);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"wt source entry preserves the runtime JSON command matrix",
		async () => {
			const commands = await runWtSource(
				["commands", "--json"],
				"wt source commands --json",
			);
			expectOkEnvelope(commands, "wt.workspace");

			const invalid = await runWtSource(
				["definitely-not-a-command", "--json"],
				"wt source invalid command",
			);
			expectUsageError(invalid);

			await withTempRepo("wt-source-matrix", async (repo) => {
				const sync = await runWtSource(
					["sync", "--repo", repo, "--json"],
					"wt source sync --json real repo",
				);
				expectOkAction(sync, "wt.workspace", "sync", { changedState: "written" });

				const focus = await runWtSource(
					["focus", "main", "skills/wt", "--repo", repo, "--json"],
					"wt source focus --json real repo",
				);
				expectOkAction(focus, "wt.workspace", "focus", { changedState: "written" });

				const color = await runWtSource(
					["color", "main", "amber", "--repo", repo, "--json"],
					"wt source color --json real repo",
				);
				expectOkAction(color, "wt.workspace", "color", { changedState: "written" });

				const staleDir = join(repo, ".worktrees", "stale-source");
				mkdirSync(staleDir, { recursive: true });
				gitOutput(repo, ["branch", "old/wt-source", "main"]);
				const clean = await runWtSource(
					["clean", "--repo", repo, "--json"],
					"wt source clean --json real repo",
				);
				expectOkAction(clean, "wt.workspace", "clean_preview", {
					changedState: "none",
				});

				const branch = "feat/wt-source-entrypoint";
				const targetPath = join(repo, ".worktrees", "feat-wt-source-entrypoint");
				const create = await runWtSource(
					["new", branch, "--repo", repo, "--json"],
					"wt source new --json real repo",
				);
				expectOkAction(create, "wt.workspace", "new", { changedState: "written" });
				expect(existsSync(targetPath), describeRun(create)).toBe(true);

				const remove = await runWtSource(
					["rm", branch, "--force", "--repo", repo, "--json"],
					"wt source rm --json real repo",
				);
				expectOkAction(remove, "wt.workspace", "rm", { changedState: "written" });
				expect(existsSync(targetPath), describeRun(remove)).toBe(false);

				const openList = await runWtSource(
					["open", "--json"],
					"wt source open --json temp cwd",
					repo,
				);
				const openListData = expectOkEnvelope(openList, "wt.workspace");
				expect(openListData.action, describeRun(openList)).toBe("list_workspaces");
				expect(openListData.workspace, describeRun(openList)).toBe(
					workspacePathForRepo(repo),
				);

				const registryPath = join(repo, "wt.config.json");
				const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
					branches?: Record<string, unknown>;
					defaults?: Record<string, unknown>;
				};
				writeFileSync(
					registryPath,
					`${JSON.stringify(
						{
							...registry,
							defaults: { ...registry.defaults, codeBin: join(repo, "missing-code") },
						},
						null,
						"\t",
					)}\n`,
				);
				const openNamed = await runWtSource(
					["open", "other-repo", "--json"],
					"wt source open named workspace missing code",
					repo,
				);
				const openNamedData = expectErrorEnvelope(openNamed, "wt.workspace");
				const openNamedEnvelope = parseEnvelope(openNamed);
				expect(
					(openNamedEnvelope.error as Record<string, unknown> | undefined)?.code,
					describeRun(openNamed),
				).toBe("code_not_found");
				expect(openNamedData.changed_state, describeRun(openNamed)).toBe("none");

				const fakeCode = join(repo, "fake-code");
				const launchLog = join(repo, "opened-workspace.txt");
				writeFileSync(
					fakeCode,
					`#!/bin/sh\nprintf '%s\\n' "$1" > ${JSON.stringify(launchLog)}\n`,
				);
				chmodSync(fakeCode, 0o755);
				writeFileSync(
					registryPath,
					`${JSON.stringify(
						{
							...registry,
							defaults: { ...registry.defaults, codeBin: fakeCode },
						},
						null,
						"\t",
					)}\n`,
				);
				const openNamedSuccess = await runWtSource(
					["open", "other-repo", "--json"],
					"wt source open named workspace fake code",
					repo,
				);
				const openNamedSuccessData = expectOkAction(
					openNamedSuccess,
					"wt.workspace",
					"open_workspace",
				);
				const expectedWorkspacePath = join(
					dirname(realpathSync(repo)),
					"other-repo.code-workspace",
				);
				expect(openNamedSuccessData.launched, describeRun(openNamedSuccess)).toBe(true);
				expect(
					openNamedSuccessData.workspace_path,
					describeRun(openNamedSuccess),
				).toBe(expectedWorkspacePath);
				expect(readFileSync(launchLog, "utf8").trim()).toBe(expectedWorkspacePath);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"agent-worktree source entry preserves the runtime JSON command matrix",
		async () => {
			const commands = await runAgentWorktreeSource(
				["commands", "--json"],
				"agent-worktree source commands --json",
			);
			expectOkEnvelope(commands, "agent-worktree.lifecycle");

			const invalid = await runAgentWorktreeSource(
				["definitely-not-a-command", "--json"],
				"agent-worktree source invalid command",
			);
			expectUsageError(invalid);

			await withTempRepo("agent-worktree-source-matrix", async (repo) => {
				const branch = "feat/agent-worktree-source";
				const targetPath = join(repo, ".worktrees", "feat-agent-worktree-source");

				const createPreview = await runAgentWorktreeSource(
					["create", branch, "--dry-run", "--repo", repo, "--json"],
					"agent-worktree source create --dry-run",
				);
				expectOkAction(
					createPreview,
					"agent-worktree.lifecycle",
					"create",
					{ changedState: "none", preview: true },
				);

				await expectAgentWorktreeCreateAndInspect({
					run: runAgentWorktreeSource,
					repo,
					branch,
					targetPath,
					createLabel: "agent-worktree source create --json",
					inspectLabel: "agent-worktree source inspect run ref",
				});

				const doctor = await runAgentWorktreeSource(
					["doctor", "--repo", repo, "--json"],
					"agent-worktree source doctor --json",
				);
				const doctorData = expectOkEnvelope(doctor, "agent-worktree.lifecycle");
				const doctorSummary = doctorData.summary as
					| Record<string, unknown>
					| undefined;
				expect(
					doctorSummary?.linked_worktree_count,
					describeRun(doctor),
				).toBe(1);

				const list = await runAgentWorktreeSource(
					["list", "--repo", repo, "--json"],
					"agent-worktree source list --json",
				);
				const listData = expectOkEnvelope(list, "agent-worktree.lifecycle");
				expect(listData.total, describeRun(list)).toBe(2);

				const status = await runAgentWorktreeSource(
					["status", "--repo", repo, "--json"],
					"agent-worktree source status --json",
				);
				const statusData = expectOkEnvelope(status, "agent-worktree.lifecycle");
				expect(statusData.total, describeRun(status)).toBe(2);

				const check = await runAgentWorktreeSource(
					["check", branch, "--repo", repo, "--json"],
					"agent-worktree source check --json",
				);
				const checkData = expectOkEnvelope(check, "agent-worktree.lifecycle");
				expect(checkData.allowed, describeRun(check)).toBe(true);
				expect(checkData.nextSafeAction, describeRun(check)).toBe("delete");

				const refreshPreview = await runAgentWorktreeSource(
					["refresh", "--dry-run", "--repo", repo, "--json"],
					"agent-worktree source refresh --dry-run",
				);
				expectOkAction(
					refreshPreview,
					"agent-worktree.lifecycle",
					"refresh",
					{ preview: true },
				);

				const refresh = await runAgentWorktreeSource(
					["refresh", "--repo", repo, "--json"],
					"agent-worktree source refresh --json",
				);
				expectOkAction(refresh, "agent-worktree.lifecycle", "refresh", {
					changedState: "complete",
				});

				const handoff = await runAgentWorktreeSource(
					["handoff", "--repo", repo, "--json"],
					"agent-worktree source handoff --json",
				);
				const handoffData = expectOkEnvelope(handoff, "agent-worktree.lifecycle");
				expect(handoffData.total, describeRun(handoff)).toBeGreaterThan(0);

				const staleDir = join(repo, ".worktrees", "stale-source-agent");
				mkdirSync(staleDir, { recursive: true });
				gitOutput(repo, ["branch", "old/agent-source", "main"]);
				const clean = await runAgentWorktreeSource(
					["clean", "--preview", "--repo", repo, "--json"],
					"agent-worktree source clean --preview",
				);
				const cleanData = expectOkEnvelope(clean, "agent-worktree.lifecycle");
				expect(cleanData.previewOnly, describeRun(clean)).toBe(true);
				expectStringArrayContaining(clean, cleanData.staleDirs, staleDir);

				const deletePreview = await runAgentWorktreeSource(
					["delete", branch, "--dry-run", "--repo", repo, "--json"],
					"agent-worktree source delete --dry-run",
				);
				expectOkAction(
					deletePreview,
					"agent-worktree.lifecycle",
					"delete",
					{ preview: true },
				);

				const protectedDelete = await runAgentWorktreeSource(
					["delete", "main", "--force", "--repo", repo, "--json"],
					"agent-worktree source delete protected branch",
				);
				const protectedData = expectErrorEnvelope(
					protectedDelete,
					"agent-worktree.lifecycle",
				);
				const failureRef = expectRef(
					protectedDelete,
					protectedData.failure_ref,
					"failure",
				);

				const inspectFailure = await runAgentWorktreeSource(
					["inspect", refArg(failureRef), "--repo", repo, "--json"],
					"agent-worktree source inspect failure ref",
				);
				const inspectFailureData = expectOkEnvelope(
					inspectFailure,
					"agent-worktree.lifecycle",
				);
				expect(inspectFailureData.found, describeRun(inspectFailure)).toBe(true);

				const recover = await runAgentWorktreeSource(
					["recover", refArg(failureRef), "--dry-run", "--repo", repo, "--json"],
					"agent-worktree source recover failure ref",
				);
				expectOkAction(recover, "agent-worktree.lifecycle", "recover", {
					preview: true,
				});

				const deleteRun = await runAgentWorktreeSource(
					["delete", branch, "--force", "--repo", repo, "--json"],
					"agent-worktree source delete --force",
				);
				expectOkAction(
					deleteRun,
					"agent-worktree.lifecycle",
					"delete",
					{ changedState: "complete" },
				);
				expect(existsSync(targetPath), describeRun(deleteRun)).toBe(false);
			});
		},
		TEST_TIMEOUT_MS,
	);
});

describe("command entrypoint integration: runtime json", () => {
	test(
		"wt, agent-worktree, and awt --version work through package scripts",
		async () => {
			const versionProbes = [
				{
					command: runners.packageCwd({
						packageRoot: packageRoots.wt,
						script: "wt",
						args: ["--version"],
						label: "wt --version (package-cwd)",
					}),
					substring: "wt 0.1.0",
				},
				{
					command: runners.packageCwd({
						packageRoot: packageRoots.agentWorktree,
						script: "agent-worktree",
						args: ["--version"],
						label: "agent-worktree --version (package-cwd)",
					}),
					substring: "agent-worktree 0.1.0",
				},
				{
					command: runners.packageCwd({
						packageRoot: packageRoots.agentWorktree,
						script: "awt",
						args: ["--version"],
						label: "awt --version (package-cwd)",
					}),
					substring: "agent-worktree 0.1.0",
				},
			];

			for (const { command, substring } of versionProbes) {
				const result = await runCommand(command);
				expect(result.exitCode, describeRun(result)).toBe(0);
				expect(result.stdout, describeRun(result)).toContain(substring);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"workspace-filter version probes exit 0 with the expected version substring",
		async () => {
			const filterProbes = [
				{
					command: runners.workspaceFilter({
						packageName: filterPackageNames.wt,
						script: "wt",
						label: "wt --version (workspace-filter)",
					}),
					substring: "0.1.0",
				},
				{
					command: runners.workspaceFilter({
						packageName: filterPackageNames.agentWorktree,
						script: "agent-worktree",
						label: "agent-worktree --version (workspace-filter)",
					}),
					substring: "0.1.0",
				},
				{
					command: runners.workspaceFilter({
						packageName: filterPackageNames.agentWorktree,
						script: "awt",
						label: "awt --version (workspace-filter)",
					}),
					substring: "0.1.0",
				},
			];

			for (const { command, substring } of filterProbes) {
				const result = await runCommand(command);
				expect(result.exitCode, describeRun(result)).toBe(0);
				const combined = `${result.stdout}${result.stderr}`;
				expect(combined, describeRun(result)).toContain(substring);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"commands --json returns status ok and the runtime contract id",
		async () => {
			const commandsProbes = [
				{
					command: runners.packageCwd({
						packageRoot: packageRoots.wt,
						script: "wt",
						args: ["commands", "--json"],
						label: "wt commands --json (package-cwd)",
					}),
					contractId: "wt.workspace",
				},
				{
					command: runners.packageCwd({
						packageRoot: packageRoots.agentWorktree,
						script: "agent-worktree",
						args: ["commands", "--json"],
						label: "agent-worktree commands --json (package-cwd)",
					}),
					contractId: "agent-worktree.lifecycle",
				},
				{
					command: runners.packageCwd({
						packageRoot: packageRoots.agentWorktree,
						script: "awt",
						args: ["commands", "--json"],
						label: "awt commands --json (package-cwd)",
					}),
					contractId: "agent-worktree.lifecycle",
				},
			];

			for (const { command, contractId } of commandsProbes) {
				const result = await runCommand(command);
				expect(result.exitCode, describeRun(result)).toBe(0);
				const envelope = parseEnvelope(result);
				expect(envelope.status, describeRun(result)).toBe("ok");
				const data = envelope.data as Record<string, unknown> | undefined;
				expect(data?.contract_id, describeRun(result)).toBe(contractId);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"wt open --json preserves list-mode coverage without launching VS Code",
		async () => {
			const result = await runWtPackage(
				["open", "--json"],
				"wt open --json list mode (package-cwd)",
			);
			const data = expectOkEnvelope(result, "wt.workspace");

			expect(data.action, describeRun(result)).toBe("list_workspaces");
			expect(typeof data.workspace, describeRun(result)).toBe("string");
			expect((data.workspace as string).endsWith(".code-workspace"), describeRun(result)).toBe(true);
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"invalid commands return non-zero with a structured error envelope",
		async () => {
			const invalidProbes = [
				runners.packageCwd({
					packageRoot: packageRoots.wt,
					script: "wt",
					args: ["definitely-not-a-command", "--json"],
					label: "wt invalid command (package-cwd)",
				}),
				runners.packageCwd({
					packageRoot: packageRoots.agentWorktree,
					script: "agent-worktree",
					args: ["definitely-not-a-command", "--json"],
					label: "agent-worktree invalid command (package-cwd)",
				}),
				runners.packageCwd({
					packageRoot: packageRoots.agentWorktree,
					script: "awt",
					args: ["definitely-not-a-command", "--json"],
					label: "awt invalid command (package-cwd)",
				}),
			];

			for (const command of invalidProbes) {
				const result = await runCommand(command);
				expectUsageError(result);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"json parse failures surface stdout and stderr excerpts",
		async () => {
			const result = await runCommand(
				runners.packageCwd({
					packageRoot: packageRoots.wt,
					script: "wt",
					args: ["--help"],
					label: "wt --help (non-json output for parse failure)",
				}),
			);

			expect(() => parseEnvelope(result)).toThrow(
				/Failed to parse JSON envelope[\s\S]*stdout=[\s\S]*stderr=/,
			);
		},
		TEST_TIMEOUT_MS,
	);

	test("spawn timeout failures identify the timed-out command", async () => {
		const result = await runCommand(
			{
				mode: "source",
				label: "timeout self-test",
				cwd: repoRoot,
				cmd: ["bun", "-e", "setTimeout(() => {}, 1000)"],
			},
			100,
		);

		expect(result.timedOut, describeRun(result)).toBe(true);
		expect(describeRun(result)).toContain("timedOut=true");
	});
});

describe("command entrypoint integration: wt real-repo lifecycle", () => {
	test(
		"wt sync --json writes a generated workspace in a real temp repo",
		async () => {
			await withTempRepo("wt-sync", async (repo) => {
				const result = await runCommand(
					runners.packageCwd({
						packageRoot: packageRoots.wt,
						script: "wt",
						args: ["sync", "--repo", repo, "--json"],
						label: "wt sync --json real repo (package-cwd)",
					}),
				);
				const data = expectOkEnvelope(result, "wt.workspace");
				const workspacePath = workspacePathForRepo(repo);

				expect(data.action, describeRun(result)).toBe("sync");
				expect(data.changed_state, describeRun(result)).toBe("written");
				expect(data.workspace_path, describeRun(result)).toBe(workspacePath);
				expect(existsSync(workspacePath), describeRun(result)).toBe(true);
				expect(
					readFileSync(workspacePath, "utf8").startsWith("// GENERATED by wt"),
					describeRun(result),
				).toBe(true);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"wt focus and color update the package-script registry in a real temp repo",
		async () => {
			await withTempRepo("wt-focus-color", async (repo) => {
				const focus = await runWtPackage(
					["focus", "main", "skills/wt", "--repo", repo, "--json"],
					"wt focus --json real repo (package-cwd)",
				);
				expectOkAction(focus, "wt.workspace", "focus", { changedState: "written" });

				const color = await runWtPackage(
					["color", "main", "teal", "--repo", repo, "--json"],
					"wt color --json real repo (package-cwd)",
				);
				expectOkAction(color, "wt.workspace", "color", { changedState: "written" });

				const registry = JSON.parse(
					readFileSync(join(repo, "wt.config.json"), "utf8"),
				) as {
					branches?: Record<string, { focus?: string; color?: string }>;
					};
				expect(registry.branches?.main?.focus, describeRun(color)).toBe("skills/wt");
				expect(registry.branches?.main?.color, describeRun(color)).toBe("teal");
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"wt clean previews stale dirs and orphan branches through package scripts",
		async () => {
			await withTempRepo("wt-clean", async (repo) => {
				const staleDir = join(repo, ".worktrees", "stale-clean");
				mkdirSync(staleDir, { recursive: true });
				gitOutput(repo, ["branch", "old/wt-entrypoint", "main"]);

				const clean = await runWtPackage(
					["clean", "--repo", repo, "--json"],
					"wt clean --json real repo (package-cwd)",
				);
				const cleanData = expectOkAction(clean, "wt.workspace", "clean_preview", {
					changedState: "none",
				});

				const preview = cleanData.preview as Record<string, unknown> | undefined;
				expect(preview?.previewOnly, describeRun(clean)).toBe(true);
				expectStringArrayContaining(
					clean,
					preview?.orphanBranches,
					"old/wt-entrypoint",
				);
				expectStringArrayContaining(clean, preview?.staleDirs, staleDir);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"wt new and rm create, remove, and re-render a real linked worktree",
		async () => {
			await withTempRepo("wt-new-rm", async (repo) => {
				const branch = "feat/command-entrypoint";
				const targetPath = join(repo, ".worktrees", "feat-command-entrypoint");

				const create = await runCommand(
					runners.packageCwd({
						packageRoot: packageRoots.wt,
						script: "wt",
						args: ["new", branch, "--repo", repo, "--json"],
						label: "wt new --json real repo (package-cwd)",
					}),
				);
				expectOkAction(create, "wt.workspace", "new", { changedState: "written" });
				expect(existsSync(targetPath), describeRun(create)).toBe(true);
				expect(
					gitOutput(repo, ["worktree", "list", "--porcelain"]),
					describeRun(create),
				).toContain(`branch refs/heads/${branch}`);

				const remove = await runCommand(
					runners.packageCwd({
						packageRoot: packageRoots.wt,
						script: "wt",
						args: ["rm", branch, "--force", "--repo", repo, "--json"],
						label: "wt rm --json real repo (package-cwd)",
					}),
				);
				expectOkAction(remove, "wt.workspace", "rm", { changedState: "written" });
				expect(existsSync(targetPath), describeRun(remove)).toBe(false);
				expect(
					gitOutput(repo, ["worktree", "list", "--porcelain"]),
					describeRun(remove),
				).not.toContain(`branch refs/heads/${branch}`);
				expect(existsSync(workspacePathForRepo(repo)), describeRun(remove)).toBe(true);
			});
		},
		TEST_TIMEOUT_MS,
	);
});

describe("command entrypoint integration: agent-worktree real-repo lifecycle", () => {
	test(
		"agent-worktree doctor, list, status, and check read a real linked worktree",
		async () => {
			await withTempRepo("agent-worktree-reads", async (repo) => {
				const branch = "feat/agent-worktree-reads";
				const targetPath = createLinkedWorktree(
					repo,
					branch,
					"feat-agent-worktree-reads",
				);

				const doctor = await runAgentWorktreePackage(
					["doctor", "--repo", repo, "--json"],
					"agent-worktree doctor --json real repo (package-cwd)",
				);
				const doctorData = expectOkEnvelope(doctor, "agent-worktree.lifecycle");
				const doctorSummary = doctorData.summary as
					| Record<string, unknown>
					| undefined;
				expect(doctorSummary?.repo_root, describeRun(doctor)).toBe(repo);
				expect(
					doctorSummary?.linked_worktree_count,
					describeRun(doctor),
				).toBe(1);
				expectStringArrayContaining(
					doctor,
					doctorSummary?.available_commands,
					"delete",
				);

				const list = await runAgentWorktreePackage(
					["list", "--repo", repo, "--json"],
					"agent-worktree list --json real repo (package-cwd)",
				);
				const listData = expectOkEnvelope(list, "agent-worktree.lifecycle");
				expect(listData.total, describeRun(list)).toBe(2);
				expect(listData.mainOwnerRoot, describeRun(list)).toBe(repo);
				expect(listData.activeWorktree, describeRun(list)).toBe(repo);

				const status = await runAgentWorktreePackage(
					["status", "--repo", repo, "--json"],
					"agent-worktree status --json real repo (package-cwd)",
				);
				const statusData = expectOkEnvelope(status, "agent-worktree.lifecycle");
				expect(statusData.total, describeRun(status)).toBe(2);
				if (!Array.isArray(statusData.statuses)) {
					throw new Error(`Expected status rows:\n${describeRun(status)}`);
				}
				expect(
					statusData.statuses.some(
						(row) =>
							typeof row === "object" &&
							row !== null &&
							(row as { worktree?: { path?: string } }).worktree?.path === targetPath,
					),
					describeRun(status),
				).toBe(true);

				const check = await runAgentWorktreePackage(
					["check", branch, "--repo", repo, "--json"],
					"agent-worktree check --json real repo (package-cwd)",
				);
				const checkData = expectOkEnvelope(check, "agent-worktree.lifecycle");
				expect(checkData.branch, describeRun(check)).toBe(branch);
				expect(checkData.allowed, describeRun(check)).toBe(true);
				expect(checkData.nextSafeAction, describeRun(check)).toBe("delete");
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"agent-worktree package-script lifecycle matrix persists refs and previews deletes",
		async () => {
			await withTempRepo("agent-worktree-create", async (repo) => {
				const branch = "feat/agent-worktree-entrypoint";
				const targetPath = join(repo, ".worktrees", "feat-agent-worktree-entrypoint");

				const createPreview = await runAgentWorktreePackage(
					["create", branch, "--dry-run", "--repo", repo, "--json"],
					"agent-worktree create --dry-run real repo (package-cwd)",
				);
				const createPreviewData = expectOkAction(
					createPreview,
					"agent-worktree.lifecycle",
					"create",
					{ changedState: "none", preview: true },
				);
				expectStringArrayContaining(
					createPreview,
					createPreviewData.changes,
					targetPath,
				);
				expect(existsSync(targetPath), describeRun(createPreview)).toBe(false);

				const create = await runAgentWorktreePackage(
					["create", branch, "--repo", repo, "--json"],
					"agent-worktree create --json real repo (package-cwd)",
				);
				const createData = expectOkAction(
					create,
					"agent-worktree.lifecycle",
					"create",
					{ changedState: "complete", preview: false },
				);
				const runRef = expectRef(create, createData.run_ref, "run");
				expect(existsSync(targetPath), describeRun(create)).toBe(true);

				await expectInspectableAgentWorktreeRef(
					repo,
					runRef,
					"agent-worktree inspect run ref real repo (package-cwd)",
				);

				const refreshPreview = await runAgentWorktreePackage(
					["refresh", "--dry-run", "--repo", repo, "--json"],
					"agent-worktree refresh --dry-run real repo (package-cwd)",
				);
				const refreshPreviewData = expectOkAction(
					refreshPreview,
					"agent-worktree.lifecycle",
					"refresh",
					{ changedState: "none", preview: true },
				);
				expectStringArrayContaining(
					refreshPreview,
					refreshPreviewData.changes,
					`record ${branch}`,
				);

				const refresh = await runAgentWorktreePackage(
					["refresh", "--repo", repo, "--json"],
					"agent-worktree refresh --json real repo (package-cwd)",
				);
				const refreshData = expectOkAction(
					refresh,
					"agent-worktree.lifecycle",
					"refresh",
					{ changedState: "complete", preview: false },
				);
				const refreshRunRef = expectRef(refresh, refreshData.run_ref, "run");
				await expectInspectableAgentWorktreeRef(
					repo,
					refreshRunRef,
					"agent-worktree inspect refresh run ref (package-cwd)",
				);

				const handoff = await runAgentWorktreePackage(
					["handoff", "--repo", repo, "--json"],
					"agent-worktree handoff --json real repo (package-cwd)",
				);
				const handoffData = expectOkEnvelope(handoff, "agent-worktree.lifecycle");
				expect(handoffData.storeRoot, describeRun(handoff)).toBe(
					join(repo, ".agent-worktree"),
				);
				expect(handoffData.total, describeRun(handoff)).toBeGreaterThan(0);
				expectStringArrayContaining(
					handoff,
					handoffData.nextSafeActions,
					"inspect",
				);

				const deleteDryRun = await runAgentWorktreePackage(
					["delete", branch, "--dry-run", "--repo", repo, "--json"],
					"agent-worktree delete --dry-run real repo (package-cwd)",
				);
				const deleteDryRunData = expectOkAction(
					deleteDryRun,
					"agent-worktree.lifecycle",
					"delete",
					{ changedState: "none", preview: true },
				);
				expectStringArrayContaining(
					deleteDryRun,
					deleteDryRunData.changes,
					`remove worktree ${targetPath}`,
				);
				expect(existsSync(targetPath), describeRun(deleteDryRun)).toBe(true);

				const deletePreview = await runAgentWorktreePackage(
					[
						"delete",
						branch,
						"--dry-run",
						"--delete-branch",
						"--repo",
						repo,
						"--json",
					],
					"agent-worktree delete --dry-run --delete-branch real repo (package-cwd)",
				);
				const previewData = expectOkAction(
					deletePreview,
					"agent-worktree.lifecycle",
					"delete",
					{ changedState: "none", preview: true },
				);
				expectStringArrayContaining(
					deletePreview,
					previewData.changes,
					`delete branch ${branch}`,
				);
				expect(existsSync(targetPath), describeRun(deletePreview)).toBe(true);

				const deleteRun = await runAgentWorktreePackage(
					["delete", branch, "--force", "--repo", repo, "--json"],
					"agent-worktree delete --force real repo (package-cwd)",
				);
				const deleteRunData = expectOkAction(
					deleteRun,
					"agent-worktree.lifecycle",
					"delete",
					{ changedState: "complete", preview: false },
				);
				const deleteRunRef = expectRef(deleteRun, deleteRunData.run_ref, "run");
				expect(existsSync(targetPath), describeRun(deleteRun)).toBe(false);
				await expectInspectableAgentWorktreeRef(
					repo,
					deleteRunRef,
					"agent-worktree inspect delete run ref (package-cwd)",
				);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"agent-worktree clean --preview reports orphan branches and stale dirs",
		async () => {
			await withTempRepo("agent-worktree-clean", async (repo) => {
				const staleDir = join(repo, ".worktrees", "stale-agent-worktree");
				mkdirSync(staleDir, { recursive: true });
				gitOutput(repo, ["branch", "old/agent-worktree-entrypoint", "main"]);

				const clean = await runAgentWorktreePackage(
					["clean", "--preview", "--repo", repo, "--json"],
					"agent-worktree clean --preview real repo (package-cwd)",
				);
				const cleanData = expectOkEnvelope(clean, "agent-worktree.lifecycle");
				expect(cleanData.previewOnly, describeRun(clean)).toBe(true);
				expectStringArrayContaining(
					clean,
					cleanData.orphanBranches,
					"old/agent-worktree-entrypoint",
				);
				expectStringArrayContaining(clean, cleanData.staleDirs, staleDir);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"awt alias preserves lifecycle behavior through package scripts",
		async () => {
			await withTempRepo("awt-lifecycle", async (repo) => {
				const branch = "feat/awt-entrypoint";
				const targetPath = join(repo, ".worktrees", "feat-awt-entrypoint");

				await expectAgentWorktreeCreateAndInspect({
					run: runAwtPackage,
					repo,
					branch,
					targetPath,
					createLabel: "awt create --json real repo (package-cwd)",
					inspectLabel: "awt inspect run ref (package-cwd)",
				});

				const remove = await runAwtPackage(
					["delete", branch, "--force", "--repo", repo, "--json"],
					"awt delete --force real repo (package-cwd)",
				);
				expectOkAction(remove, "agent-worktree.lifecycle", "delete", {
					changedState: "complete",
				});
				expect(existsSync(targetPath), describeRun(remove)).toBe(false);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"agent-worktree delete --force --delete-branch removes the worktree and branch after backup",
		async () => {
			await withTempRepo("agent-worktree-delete-branch", async (repo) => {
				const branch = "feat/delete-branch-entrypoint";
				const targetPath = createLinkedWorktree(
					repo,
					branch,
					"feat-delete-branch-entrypoint",
				);
				expect(gitRefExists(repo, `refs/heads/${branch}`)).toBe(true);

				const remove = await runAgentWorktreePackage(
					["delete", branch, "--force", "--delete-branch", "--repo", repo, "--json"],
					"agent-worktree delete --force --delete-branch real repo (package-cwd)",
				);
				const removeData = expectOkAction(
					remove,
					"agent-worktree.lifecycle",
					"delete",
					{ changedState: "complete", preview: false },
				);
				const runRef = expectRef(remove, removeData.run_ref, "run");
				expect(typeof removeData.backup_ref, describeRun(remove)).toBe("string");
				expect(existsSync(targetPath), describeRun(remove)).toBe(false);
				expect(gitRefExists(repo, `refs/heads/${branch}`)).toBe(false);
				expect(gitRefExists(repo, removeData.backup_ref as string)).toBe(true);
				await expectInspectableAgentWorktreeRef(
					repo,
					runRef,
					"agent-worktree inspect branch-delete run ref (package-cwd)",
				);
			});
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"post-mutation backup-ref failure preserves partial failure refs and recovery preview",
		async () => {
			await withTempRepo("agent-worktree-partial-failure", async (repo) => {
				const branch = "feat/partial-failure";
				const targetPath = createLinkedWorktree(
					repo,
					branch,
					"feat-partial-failure",
				);
				gitOutput(repo, [
					"update-ref",
					"refs/agent-worktree/backups/feat-partial-failure",
					"HEAD",
				]);

				const remove = await runAgentWorktreePackage(
					["delete", branch, "--force", "--delete-branch", "--repo", repo, "--json"],
					"agent-worktree delete backup-ref conflict real repo (package-cwd)",
				);
				const failureData = expectErrorEnvelope(
					remove,
					"agent-worktree.lifecycle",
				);
				const failureRef = expectRef(remove, failureData.failure_ref, "failure");
				const runRef = expectRef(remove, failureData.run_ref, "run");
				const failureArg = refArg(failureRef);

				expect(failureData.action, describeRun(remove)).toBe("delete");
				expect(failureData.changed_state, describeRun(remove)).toBe("partial");
				expect(failureData.next_safe_action, describeRun(remove)).toBe("inspect");
				expect(existsSync(targetPath), describeRun(remove)).toBe(false);
				expect(gitRefExists(repo, `refs/heads/${branch}`)).toBe(true);

				await expectInspectableAgentWorktreeRef(
					repo,
					runRef,
					"agent-worktree inspect partial run ref (package-cwd)",
				);
				await expectInspectableAgentWorktreeRef(
					repo,
					failureRef,
					"agent-worktree inspect partial failure ref (package-cwd)",
				);

				const recover = await runAgentWorktreePackage(
					["recover", failureArg, "--dry-run", "--repo", repo, "--json"],
					"agent-worktree recover partial failure ref dry-run (package-cwd)",
				);
				const recoverData = expectOkAction(
					recover,
					"agent-worktree.lifecycle",
					"recover",
					{ changedState: "partial", preview: true },
				);
				expect(recoverData.failure_ref, describeRun(recover)).toEqual(failureRef);
			});
		},
		TEST_TIMEOUT_MS,
	);
});

describe("command entrypoint integration: preflight recovery refs", () => {
	test(
		"protected branch delete failure ref survives inspect and recover process boundaries",
		async () => {
			await withTempRepo("agent-worktree-recovery", async (repo) => {
				const deleteMain = await runAgentWorktreePackage(
					["delete", "main", "--force", "--repo", repo, "--json"],
					"agent-worktree delete main protected branch (package-cwd)",
				);
				const failureData = expectErrorEnvelope(
					deleteMain,
					"agent-worktree.lifecycle",
				);
				const failureRef = expectRef(deleteMain, failureData.failure_ref, "failure");
				const failureArg = refArg(failureRef);

				expect(failureData.action, describeRun(deleteMain)).toBe("delete");
				expect(failureData.changed_state, describeRun(deleteMain)).toBe("none");
				expect(failureData.reason, describeRun(deleteMain)).toBe("protected_branch");
				expect(failureData.next_safe_action, describeRun(deleteMain)).toBe("inspect");

				await expectInspectableAgentWorktreeRef(
					repo,
					failureRef,
					"agent-worktree inspect failure ref (package-cwd)",
				);

				const recover = await runAgentWorktreePackage(
					["recover", failureArg, "--dry-run", "--repo", repo, "--json"],
					"agent-worktree recover failure ref dry-run (package-cwd)",
				);
				const recoverData = expectOkAction(
					recover,
					"agent-worktree.lifecycle",
					"recover",
					{ changedState: "none", preview: true },
				);
				expect(recoverData.failure_ref, describeRun(recover)).toEqual(failureRef);
				expectStringArrayContaining(recover, recoverData.changes, `inspect ${failureArg}`);
			});
		},
		TEST_TIMEOUT_MS,
	);
});

describe("command entrypoint integration: promotion boundary", () => {
	test("root default gates do not run the explicit integration suite", async () => {
		const rootScripts = readPackageScripts(repoRoot);
		const portabilityProof = readFileSync(
			join(repoRoot, "scripts/prove-workspace-portability.ts"),
			"utf8",
		);

		expect(rootScripts["command-entrypoint:integration"]).toBe(
			"bun test scripts/command-entrypoint.integration.test.ts",
		);
		expect(rootScripts.test ?? "").not.toContain("command-entrypoint");
		expect(rootScripts["prove:workspace-portability"] ?? "").not.toContain(
			"command-entrypoint",
		);
		expect(portabilityProof).not.toContain("command-entrypoint:integration");
		expect(portabilityProof).not.toContain("command-entrypoint.integration.test");
	});
});
