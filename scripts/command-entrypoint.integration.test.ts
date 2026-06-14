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
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

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
 * - `source`: `bun run <source-path>` from the repo root. `--version` and
 *   top-level help compatibility probes only (KTD7).
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
interface RunResult extends RunnerCommand {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

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
	}): RunnerCommand {
		return {
			mode: "source",
			label: input.label,
			cwd: repoRoot,
			cmd: ["bun", "run", input.sourcePath, ...input.args],
		};
	},
} as const;

/**
 * Spawn a built command, capturing exit code, stdout, stderr, and timeout state.
 *
 * Uses an explicit per-command `timeout` and `killSignal` so a hung child is
 * killed before the outer test timeout can interrupt cleanup.
 */
function runCommand(command: RunnerCommand): RunResult {
	const spawned = spawnSync(command.cmd[0], command.cmd.slice(1), {
		cwd: command.cwd,
		env: process.env,
		encoding: "utf8",
		timeout: SPAWN_TIMEOUT_MS,
		killSignal: KILL_SIGNAL,
		stdio: ["ignore", "pipe", "pipe"],
	});

	const timedOut = spawned.signal === KILL_SIGNAL || spawned.error?.message.includes("ETIMEDOUT") === true;

	return {
		...command,
		exitCode: spawned.status,
		stdout: spawned.stdout ?? "",
		stderr: spawned.stderr ?? "",
		timedOut,
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
	return [
		`mode=${result.mode}`,
		`label=${result.label}`,
		`cwd=${result.cwd}`,
		`argv=${JSON.stringify(result.cmd)}`,
		`exit=${result.exitCode}`,
		result.timedOut ? "timedOut=true" : null,
		`stdout=${JSON.stringify(excerpt(result.stdout))}`,
		`stderr=${JSON.stringify(excerpt(result.stderr))}`,
	]
		.filter(Boolean)
		.join("\n");
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
		return JSON.parse(result.stdout) as Record<string, unknown>;
	} catch (error) {
		throw new Error(
			`Failed to parse JSON envelope:\n${describeRun(result)}\nparseError=${
				error instanceof Error ? error.message : String(error)
			}`,
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

function runAgentWorktreePackage(
	args: readonly string[],
	label: string,
): RunResult {
	return runCommand(
		runners.packageCwd({
			packageRoot: packageRoots.agentWorktree,
			script: "agent-worktree",
			args,
			label,
		}),
	);
}

function expectInspectableAgentWorktreeRef(
	repo: string,
	ref: { kind: string; id: string },
	label: string,
): void {
	const result = runAgentWorktreePackage(
		["inspect", refArg(ref), "--repo", repo, "--json"],
		label,
	);
	const data = expectOkEnvelope(result, "agent-worktree.lifecycle");
	expect(data.found, describeRun(result)).toBe(true);
	expect(data.ref, describeRun(result)).toEqual(ref);
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
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed:\ncwd=${cwd}\nexit=${result.status}\nstdout=${JSON.stringify(
				excerpt(result.stdout ?? ""),
			)}\nstderr=${JSON.stringify(excerpt(result.stderr ?? ""))}`,
		);
	}
	return result.stdout ?? "";
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
 * string, so a usage rename fails here too. (The contract type is not imported
 * directly because `@side-quest/cli-command-facade` does not resolve from the
 * repo-root script dir; the transitive import through the contract modules
 * does.)
 */
function firstUsageLine(contract: { usage: readonly string[] }): string {
	const [usage] = contract.usage;
	return `Usage: ${usage}`;
}

const wtTopLevelUsageLine = firstUsageLine(wtContracts.sync);
const agentWorktreeTopLevelUsageLine = firstUsageLine(agentWorktreeContracts.doctor);

describe("command entrypoint integration: mechanical discovery", () => {
	test("derives the exact wt command id set from exported contracts", () => {
		expect(discoveredWtCommandIds).toEqual(
			["clean", "color", "commands", "focus", "new", "open", "rm", "sync"],
		);
	});

	test("derives the exact agent-worktree command id set from exported contracts", () => {
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

	test("package scripts expose the wt and agent-worktree entrypoint scripts", () => {
		expect(Object.keys(wtPackageScripts)).toContain("wt");
		expect(Object.keys(agentWorktreePackageScripts)).toContain("agent-worktree");
		expect(Object.keys(agentWorktreePackageScripts)).toContain("awt");
	});
});

describe("command entrypoint integration: help contracts", () => {
	test(
		"wt, agent-worktree, and awt top-level help renders the contract usage line",
		() => {
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
				const result = runCommand(command);
				expect(result.exitCode, describeRun(result)).toBe(0);
				expect(result.stdout, describeRun(result)).toContain(usageLine);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"every discovered wt command help renders its first contract usage line",
		() => {
			for (const command of discoveredWtCommandIds) {
				const contract = wtContracts[command as keyof typeof wtContracts];
				const result = runCommand(
					runners.packageCwd({
						packageRoot: packageRoots.wt,
						script: "wt",
						args: [command, "--help"],
						label: `wt ${command} --help (package-cwd)`,
					}),
				);
				expect(result.exitCode, describeRun(result)).toBe(0);
				expect(result.stdout, describeRun(result)).toContain(
					firstUsageLine(contract),
				);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"every discovered agent-worktree command help renders its first contract usage line",
		() => {
			for (const command of discoveredAgentWorktreeCommandIds) {
				const contract =
					agentWorktreeContracts[command as keyof typeof agentWorktreeContracts];
				const result = runCommand(
					runners.packageCwd({
						packageRoot: packageRoots.agentWorktree,
						script: "agent-worktree",
						args: [command, "--help"],
						label: `agent-worktree ${command} --help (package-cwd)`,
					}),
				);
				expect(result.exitCode, describeRun(result)).toBe(0);
				expect(result.stdout, describeRun(result)).toContain(
					firstUsageLine(contract),
				);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"wt and agent-worktree source entries support --version and top-level help",
		() => {
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
				const version = runCommand(
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

				const help = runCommand(
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
});

describe("command entrypoint integration: runtime json", () => {
	test(
		"wt, agent-worktree, and awt --version work through package scripts",
		() => {
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
				const result = runCommand(command);
				expect(result.exitCode, describeRun(result)).toBe(0);
				expect(result.stdout, describeRun(result)).toContain(substring);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"workspace-filter version probes exit 0 with the expected version substring",
		() => {
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
				const result = runCommand(command);
				expect(result.exitCode, describeRun(result)).toBe(0);
				const combined = `${result.stdout}${result.stderr}`;
				expect(combined, describeRun(result)).toContain(substring);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"commands --json returns status ok and the runtime contract id",
		() => {
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
				const result = runCommand(command);
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
		"invalid commands return non-zero with a structured error envelope",
		() => {
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
			];

			for (const command of invalidProbes) {
				const result = runCommand(command);
				expect(result.exitCode, describeRun(result)).not.toBe(0);
				const envelope = parseEnvelope(result);
				expect(envelope.status, describeRun(result)).toBe("error");
				const error = envelope.error as Record<string, unknown> | undefined;
				expect(error?.code, describeRun(result)).toBe("usage_error");
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"json parse failures surface stdout and stderr excerpts",
		() => {
			const result = runCommand(
				runners.packageCwd({
					packageRoot: packageRoots.wt,
					script: "wt",
					args: ["--help"],
					label: "wt --help (non-json output for parse failure)",
				}),
			);

			let parseError: Error | undefined;
			try {
				parseEnvelope(result);
			} catch (error) {
				parseError = error instanceof Error ? error : new Error(String(error));
			}

			expect(parseError).toBeDefined();
			expect(parseError?.message).toContain("Failed to parse JSON envelope");
			expect(parseError?.message).toContain("stdout=");
			expect(parseError?.message).toContain("stderr=");
		},
		TEST_TIMEOUT_MS,
	);
});

describe("command entrypoint integration: wt real-repo lifecycle", () => {
	test(
		"wt sync --json writes a generated workspace in a real temp repo",
		async () => {
			await withTempRepo("wt-sync", async (repo) => {
				const result = runCommand(
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
		"wt new and rm create, remove, and re-render a real linked worktree",
		async () => {
			await withTempRepo("wt-new-rm", async (repo) => {
				const branch = "feat/command-entrypoint";
				const targetPath = join(repo, ".worktrees", "feat-command-entrypoint");

				const create = runCommand(
					runners.packageCwd({
						packageRoot: packageRoots.wt,
						script: "wt",
						args: ["new", branch, "--repo", repo, "--json"],
						label: "wt new --json real repo (package-cwd)",
					}),
				);
				const createData = expectOkEnvelope(create, "wt.workspace");
				expect(createData.action, describeRun(create)).toBe("new");
				expect(createData.changed_state, describeRun(create)).toBe("written");
				expect(existsSync(targetPath), describeRun(create)).toBe(true);
				expect(
					gitOutput(repo, ["worktree", "list", "--porcelain"]),
					describeRun(create),
				).toContain(`branch refs/heads/${branch}`);

				const remove = runCommand(
					runners.packageCwd({
						packageRoot: packageRoots.wt,
						script: "wt",
						args: ["rm", branch, "--force", "--repo", repo, "--json"],
						label: "wt rm --json real repo (package-cwd)",
					}),
				);
				const removeData = expectOkEnvelope(remove, "wt.workspace");
				expect(removeData.action, describeRun(remove)).toBe("rm");
				expect(removeData.changed_state, describeRun(remove)).toBe("written");
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
		"agent-worktree create persists a run ref and delete previews branch deletion",
		async () => {
			await withTempRepo("agent-worktree-create", async (repo) => {
				const branch = "feat/agent-worktree-entrypoint";
				const targetPath = join(repo, ".worktrees", "feat-agent-worktree-entrypoint");

				const create = runAgentWorktreePackage(
					["create", branch, "--repo", repo, "--json"],
					"agent-worktree create --json real repo (package-cwd)",
				);
				const createData = expectOkEnvelope(create, "agent-worktree.lifecycle");
				const runRef = expectRef(create, createData.run_ref, "run");

				expect(createData.action, describeRun(create)).toBe("create");
				expect(createData.changed_state, describeRun(create)).toBe("complete");
				expect(createData.preview, describeRun(create)).toBe(false);
				expect(existsSync(targetPath), describeRun(create)).toBe(true);

				expectInspectableAgentWorktreeRef(
					repo,
					runRef,
					"agent-worktree inspect run ref real repo (package-cwd)",
				);

				const deletePreview = runAgentWorktreePackage(
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
				const previewData = expectOkEnvelope(
					deletePreview,
					"agent-worktree.lifecycle",
				);
				expect(previewData.action, describeRun(deletePreview)).toBe("delete");
				expect(previewData.preview, describeRun(deletePreview)).toBe(true);
				expect(previewData.changed_state, describeRun(deletePreview)).toBe("none");
				expectStringArrayContaining(
					deletePreview,
					previewData.changes,
					`delete branch ${branch}`,
				);
				expect(existsSync(targetPath), describeRun(deletePreview)).toBe(true);
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
				const deleteMain = runAgentWorktreePackage(
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

				expectInspectableAgentWorktreeRef(
					repo,
					failureRef,
					"agent-worktree inspect failure ref (package-cwd)",
				);

				const recover = runAgentWorktreePackage(
					["recover", failureArg, "--dry-run", "--repo", repo, "--json"],
					"agent-worktree recover failure ref dry-run (package-cwd)",
				);
				const recoverData = expectOkEnvelope(recover, "agent-worktree.lifecycle");
				expect(recoverData.action, describeRun(recover)).toBe("recover");
				expect(recoverData.preview, describeRun(recover)).toBe(true);
				expect(recoverData.changed_state, describeRun(recover)).toBe("none");
				expect(recoverData.failure_ref, describeRun(recover)).toEqual(failureRef);
				expectStringArrayContaining(recover, recoverData.changes, `inspect ${failureArg}`);
			});
		},
		TEST_TIMEOUT_MS,
	);
});

describe("command entrypoint integration: promotion boundary", () => {
	test("root default gates do not run the explicit integration suite", () => {
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
