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
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
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
		const git = (args: readonly string[]): void => {
			const result = spawnSync("git", [...args], {
				cwd: root,
				env: process.env,
				encoding: "utf8",
				timeout: SPAWN_TIMEOUT_MS,
				killSignal: KILL_SIGNAL,
			});
			if (result.status !== 0) {
				throw new Error(
					`git ${args.join(" ")} failed in temp repo:\ncwd=${root}\nexit=${result.status}\nstderr=${JSON.stringify(
						excerpt(result.stderr ?? ""),
					)}`,
				);
			}
		};

		git(["init", "--initial-branch=main"]);
		git(["config", "user.name", "Command Entrypoint Test"]);
		git(["config", "user.email", "command-entrypoint@example.test"]);
		git(["commit", "--allow-empty", "-m", "chore: seed repo"]);

		return body(root);
	});
}

void withTempRepo;

describe("command entrypoint integration", () => {
	test(
		"harness runs a package-cwd version probe and produces useful failure output",
		() => {
			const probe = runCommand(
				runners.packageCwd({
					packageRoot: packageRoots.wt,
					script: "wt",
					args: ["--version"],
					label: "wt --version (package-cwd)",
				}),
			);
			expect(probe.exitCode, describeRun(probe)).toBe(0);
			expect(probe.stdout, describeRun(probe)).toContain("wt 0.1.0");

			const invalid = runCommand(
				runners.packageCwd({
					packageRoot: packageRoots.wt,
					script: "wt",
					args: ["definitely-not-a-command", "--json"],
					label: "wt invalid command (package-cwd)",
				}),
			);
			expect(invalid.exitCode, describeRun(invalid)).not.toBe(0);
			const description = describeRun(invalid);
			expect(description).toContain("mode=package-cwd");
			expect(description).toContain("stdout=");
			expect(description).toContain("stderr=");
		},
		TEST_TIMEOUT_MS,
	);
});

void agentWorktreeContractEntries;
void agentWorktreeContracts;
void wtContracts;
void parseEnvelope;
void readFileSync;
void runners.workspaceFilter;
void runners.source;
void sourceEntries;
void filterPackageNames;
