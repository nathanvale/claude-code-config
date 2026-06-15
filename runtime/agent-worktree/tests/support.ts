import { main, type AgentWorktreeCliRuntime } from "../src/cli.ts";
import type { GitRunner } from "../src/discovery.ts";

/**
 * Captured writer used by CLI integration tests.
 */
interface MemoryWriter {
	/** Captured output bytes. */
	output: string;
	/** Append one emitted chunk. */
	write(chunk: string): void;
}

/**
 * Loose JSON envelope shape used by CLI integration assertions.
 */
export interface TestJsonEnvelope {
	/** Top-level facade status. */
	status?: string;
	/** Runtime error envelope details. */
	error?: {
		/** Error code. */
		code?: string;
		/** Error message. */
		message?: string;
		/** Recoverability classification. */
		recoverability?: string;
		[key: string]: unknown;
	};
	/** Command data envelope. */
	data?: Record<string, unknown>;
	[key: string]: unknown;
}

/**
 * Result from a JSON CLI integration run.
 */
export interface TestJsonCliRun {
	/** Process exit code returned by the CLI entry point. */
	exitCode: number;
	/** Parsed JSON envelope emitted to stdout. */
	envelope: TestJsonEnvelope;
	/** Raw stdout bytes for fallback assertions. */
	output: string;
}

/**
 * Result from a text CLI integration run.
 */
export interface TestTextCliRun {
	/** Process exit code returned by the CLI entry point. */
	exitCode: number;
	/** Raw stdout bytes emitted by the CLI. */
	output: string;
}

/**
 * Create an in-memory writer for CLI integration tests.
 *
 * @returns Writer that captures all chunks into `output`
 *
 * @example
 * ```typescript
 * const stdout = createMemoryWriter()
 * stdout.write("ok")
 * ```
 */
function createMemoryWriter(): MemoryWriter {
	return {
		output: "",
		write(chunk: string) {
			this.output += chunk;
		},
	};
}

/**
 * Run the CLI and parse the stdout JSON envelope.
 *
 * @param argv - Public CLI argv tail
 * @param options - Optional deterministic runtime hooks
 * @returns Exit code, parsed envelope, and raw stdout
 *
 * @example
 * ```typescript
 * const { envelope } = await runJsonCli(["doctor", "--json"])
 * ```
 */
export async function runJsonCli(
	argv: readonly string[],
	options: { runtime?: Partial<AgentWorktreeCliRuntime> } = {},
): Promise<TestJsonCliRun> {
	const stdout = createMemoryWriter();
	const exitCode = await main(argv, { stdout, runtime: options.runtime });
	return {
		exitCode,
		envelope: JSON.parse(stdout.output) as TestJsonEnvelope,
		output: stdout.output,
	};
}

/**
 * Run the CLI and return raw stdout text.
 *
 * @param argv - Public CLI argv tail
 * @param options - Optional deterministic runtime hooks
 * @returns Exit code and captured stdout text
 *
 * @example
 * ```typescript
 * const help = await runTextCli([])
 * ```
 */
export async function runTextCli(
	argv: readonly string[],
	options: { runtime?: Partial<AgentWorktreeCliRuntime> } = {},
): Promise<TestTextCliRun> {
	const stdout = createMemoryWriter();
	const exitCode = await main(argv, { stdout, runtime: options.runtime });
	return { exitCode, output: stdout.output };
}

/**
 * Build a deterministic git runner from command-output fixtures.
 *
 * @param outputs - Map from joined argv to stdout
 * @returns Git runner that returns non-zero for missing commands
 *
 * @example
 * ```typescript
 * const run = fakeGitRunner({ "git branch --show-current": "main\n" })
 * ```
 */
export function fakeGitRunner(outputs: Record<string, string>): GitRunner {
	return async (args) => {
		const stdout = outputs[args.join(" ")];
		return stdout === undefined
			? { ok: false, stdout: "", stderr: "missing fake output", code: 1 }
			: { ok: true, stdout, stderr: "", code: 0 };
	};
}

/**
 * Git fixture outputs for a repo with only the main worktree.
 *
 * @param root - Repo root returned by `git rev-parse --show-toplevel`
 * @returns Command-output map for fake git runners
 *
 * @example
 * ```typescript
 * const run = fakeGitRunner(mainRepoGitOutputs("/repo"))
 * ```
 */
export function mainRepoGitOutputs(root: string): Record<string, string> {
	return {
		["git rev-parse --show-toplevel"]: `${root}\n`,
		["git worktree list --porcelain"]: `worktree ${root}
HEAD abc
branch refs/heads/main
`,
		["git branch --show-current"]: "main\n",
		["git symbolic-ref --short refs/remotes/origin/HEAD"]: "origin/main\n",
	};
}

/**
 * Git fixture outputs for a repo with one linked feature worktree.
 *
 * @param root - Main repo root
 * @param linked - Linked worktree path
 * @param options - Optional status and extra command outputs
 * @returns Command-output map for fake git runners
 *
 * @example
 * ```typescript
 * const outputs = linkedRepoGitOutputs("/repo", "/repo/.worktrees/feat-x")
 * ```
 */
export function linkedRepoGitOutputs(
	root: string,
	linked: string,
	options: {
		branch?: string;
		currentBranch?: string;
		status?: string;
		extra?: Record<string, string>;
	} = {},
): Record<string, string> {
	const branch = options.branch ?? "feat/x";
	return {
		...mainRepoGitOutputs(root),
		["git worktree list --porcelain"]: `worktree ${root}
HEAD abc
branch refs/heads/main

worktree ${linked}
HEAD def
branch refs/heads/${branch}
`,
		["git branch --show-current"]: `${options.currentBranch ?? "main"}\n`,
		["git status --porcelain"]: options.status ?? "",
		["git rev-parse --is-shallow-repository"]: "false\n",
		[`git merge-base --is-ancestor ${branch} main`]: "",
		[`git rev-list --left-right --count main...${branch}`]: "1 0\n",
		...options.extra,
	};
}

/**
 * Runtime hooks for CLI tests that need a resolved repo.
 *
 * @param root - Repo root and runtime cwd
 * @param outputs - Fake git outputs for the runtime
 * @returns Deterministic CLI runtime hooks
 *
 * @example
 * ```typescript
 * const runtime = repoRuntime("/repo", mainRepoGitOutputs("/repo"))
 * ```
 */
export function repoRuntime(
	root: string,
	outputs: Record<string, string> = mainRepoGitOutputs(root),
): Partial<AgentWorktreeCliRuntime> {
	return {
		cwd: () => root,
		now: () => 1,
		run: fakeGitRunner(outputs),
	};
}
