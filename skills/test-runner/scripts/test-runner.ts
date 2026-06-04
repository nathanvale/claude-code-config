#!/usr/bin/env bun

import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import {
	type CliWriter,
	CliUsageError,
	type ParsedCliDiagnosticArgv,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	usageError,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	TEST_RUNNER_CONTRACT_ID,
	TEST_RUNNER_SCHEMA_VERSION,
	type TestRunnerCommand,
	type TestRunnerDiagnosticCode,
	type TestRunnerResultStatus,
	testRunnerContracts,
} from "./command-contract";

const VERSION = "0.1.0";
const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FAILURES = 3;
const MAX_CONTEXT_LINES_PER_FAILURE = 8;
const MAX_PLAIN_CONTEXT_LINES_PER_FAILURE = 4;
const MAX_CONTEXT_LINE_CHARS = 220;
const MAX_DEBUG_CHARS = 2_000;

type OutputMode = "plain" | "json";

type ParsedRunnerCommand =
	| { kind: "help"; command?: TestRunnerCommand }
	| { kind: "version" }
	| {
			kind: "status";
			command: "status";
			outputMode: OutputMode;
			cwd: string;
	  }
	| {
			kind: "run";
			command: "run";
			outputMode: OutputMode;
			cwd: string;
			timeoutMs: number;
			debugOutput: boolean;
			bunArgs: string[];
	  };

type ProcessResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	wallTimeMs: number;
};

export type TestRunnerFailure = {
	file: string | null;
	test_name: string;
	message: string | null;
	context: string[];
};

export type TestRunnerDiagnostic = {
	code: TestRunnerDiagnosticCode | "bun_tests_failed";
	message: string;
	cause: string;
	retryable: boolean;
	next_action: string;
};

export type TestRunnerResult = {
	action: "tests_passed" | "tests_failed" | "runner_ready" | "runner_error";
	contract: typeof TEST_RUNNER_CONTRACT_ID;
	schema_version: typeof TEST_RUNNER_SCHEMA_VERSION;
	status: TestRunnerResultStatus;
	command: TestRunnerCommand;
	cwd: string;
	bun_command: string | null;
	bun_args: string[];
	exit_code: number;
	run_id: string;
	duration_ms: number;
	summary: {
		files: number | null;
		tests: number | null;
		passed: number | null;
		failed: number | null;
		expect_calls: number | null;
	};
	failures: TestRunnerFailure[];
	diagnostic?: TestRunnerDiagnostic;
	debug?: {
		stdout_sample: string;
		stderr_sample: string;
	};
};

export type TestRunnerRuntime = {
	now: () => number;
	cwd: () => string;
	isDirectory: (path: string) => Promise<boolean>;
	findBun: () => Promise<string | null>;
	runBunTest: (
		input: {
			bunCommand: string;
			cwd: string;
			bunArgs: readonly string[];
			timeoutMs: number;
		},
	) => Promise<ProcessResult>;
};

class BufferWriter implements CliWriter {
	private chunks: string[] = [];

	write(chunk: string): true {
		this.chunks.push(chunk);
		return true;
	}

	toString(): string {
		return this.chunks.join("");
	}
}

export function createDefaultTestRunnerRuntime(
	overrides: Partial<TestRunnerRuntime> = {},
): TestRunnerRuntime {
	return {
		now: () => Date.now(),
		cwd: () => process.cwd(),
		isDirectory: async (path) => {
			try {
				return (await stat(path)).isDirectory();
			} catch {
				return false;
			}
		},
		findBun: () => findExecutable("bun"),
		runBunTest: runBunTestProcess,
		...overrides,
	};
}

export async function runTestRunnerCli(
	argv: readonly string[],
	options: {
		runtime?: TestRunnerRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultTestRunnerRuntime();
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const { runnerArgv, bunArgs, separatorSeen } = splitRunnerAndBunArgv(argv);
	let parsedDiagnostics: ParsedCliDiagnosticArgv;

	try {
		parsedDiagnostics = parseCliDiagnosticArgv(runnerArgv);
	} catch (error) {
		parsedDiagnostics = parseCliDiagnosticFallbackArgv(runnerArgv);
		const outputMode = inferOutputMode(runnerArgv);
		return emitCliError({
			error,
			outputMode,
			stdout,
			stderr,
			runId: parsedDiagnostics.options.runId,
			durationMs: runtime.now() - parsedDiagnostics.options.startedAtMs,
		});
	}

	const runId =
		process.env.TEST_RUNNER_RUN_ID ?? parsedDiagnostics.options.runId;
	let parsed: ParsedRunnerCommand;
	try {
		parsed = parseTestRunnerArgv({
			argv: parsedDiagnostics.argv,
			bunArgs,
			separatorSeen,
			defaultCwd: runtime.cwd(),
		});
	} catch (error) {
		return emitCliError({
			error,
			outputMode: inferOutputMode(runnerArgv),
			stdout,
			stderr,
			runId,
			durationMs: runtime.now() - parsedDiagnostics.options.startedAtMs,
		});
	}

	if (parsed.kind === "help") {
		stdout.write(renderHelp(parsed.command));
		return 0;
	}
	if (parsed.kind === "version") {
		stdout.write(`test-runner ${VERSION}\n`);
		return 0;
	}

	const startedAt = parsedDiagnostics.options.startedAtMs;
	const result =
		parsed.kind === "status"
			? await checkRunnerStatus({
					parsed,
					runtime,
					runId,
					startedAt,
				})
			: await runBunTests({
					parsed,
					runtime,
					runId,
					startedAt,
				});

	writeResult(stdout, stderr, result, parsed.outputMode);
	return result.exit_code;
}

async function checkRunnerStatus(input: {
	parsed: Extract<ParsedRunnerCommand, { kind: "status" }>;
	runtime: TestRunnerRuntime;
	runId: string;
	startedAt: number;
}): Promise<TestRunnerResult> {
	const cwd = resolve(input.parsed.cwd);
	const cwdOk = await input.runtime.isDirectory(cwd);
	if (!cwdOk) {
		return createRunnerDiagnosticResult({
			command: "status",
			cwd,
			bunCommand: null,
			bunArgs: [],
			runId: input.runId,
			durationMs: input.runtime.now() - input.startedAt,
			diagnostic: invalidCwdDiagnostic(cwd),
			exitCode: RUNTIME_FAILURE_EXIT_CODE,
		});
	}
	const bunCommand = await input.runtime.findBun();
	if (!bunCommand) {
		return createRunnerDiagnosticResult({
			command: "status",
			cwd,
			bunCommand: null,
			bunArgs: [],
			runId: input.runId,
			durationMs: input.runtime.now() - input.startedAt,
			diagnostic: missingBunDiagnostic(),
			exitCode: RUNTIME_FAILURE_EXIT_CODE,
		});
	}
	return baseResult({
		action: "runner_ready",
		status: "passed",
		command: "status",
		cwd,
		bunCommand,
		bunArgs: [],
		exitCode: 0,
		runId: input.runId,
		durationMs: input.runtime.now() - input.startedAt,
		summary: emptySummary(),
		failures: [],
	});
}

async function runBunTests(input: {
	parsed: Extract<ParsedRunnerCommand, { kind: "run" }>;
	runtime: TestRunnerRuntime;
	runId: string;
	startedAt: number;
}): Promise<TestRunnerResult> {
	const cwd = resolve(input.parsed.cwd);
	const cwdOk = await input.runtime.isDirectory(cwd);
	if (!cwdOk) {
		return createRunnerDiagnosticResult({
			command: "run",
			cwd,
			bunCommand: null,
			bunArgs: input.parsed.bunArgs,
			runId: input.runId,
			durationMs: input.runtime.now() - input.startedAt,
			diagnostic: invalidCwdDiagnostic(cwd),
			exitCode: RUNTIME_FAILURE_EXIT_CODE,
		});
	}

	const bunCommand = await input.runtime.findBun();
	if (!bunCommand) {
		return createRunnerDiagnosticResult({
			command: "run",
			cwd,
			bunCommand: null,
			bunArgs: input.parsed.bunArgs,
			runId: input.runId,
			durationMs: input.runtime.now() - input.startedAt,
			diagnostic: missingBunDiagnostic(),
			exitCode: RUNTIME_FAILURE_EXIT_CODE,
		});
	}

	let processResult: ProcessResult;
	try {
		processResult = await input.runtime.runBunTest({
			bunCommand,
			cwd,
			bunArgs: input.parsed.bunArgs,
			timeoutMs: input.parsed.timeoutMs,
		});
	} catch (error) {
		return createRunnerDiagnosticResult({
			command: "run",
			cwd,
			bunCommand,
			bunArgs: input.parsed.bunArgs,
			runId: input.runId,
			durationMs: input.runtime.now() - input.startedAt,
			diagnostic: invocationDiagnostic(error),
			exitCode: RUNTIME_FAILURE_EXIT_CODE,
		});
	}

	const combinedOutput = `${processResult.stdout}\n${processResult.stderr}`;
	const parsedOutput = parseBunOutput(combinedOutput);
	const debug = input.parsed.debugOutput
		? {
				stdout_sample: truncate(processResult.stdout, MAX_DEBUG_CHARS),
				stderr_sample: truncate(processResult.stderr, MAX_DEBUG_CHARS),
			}
		: undefined;

	if (processResult.timedOut) {
		return {
			...createRunnerDiagnosticResult({
				command: "run",
				cwd,
				bunCommand,
				bunArgs: input.parsed.bunArgs,
				runId: input.runId,
				durationMs: processResult.wallTimeMs,
				diagnostic: timeoutDiagnostic(input.parsed.timeoutMs),
				exitCode: RUNTIME_FAILURE_EXIT_CODE,
				failures: parsedOutput.failures,
				summary: parsedOutput.summary,
			}),
			...(debug ? { debug } : {}),
		};
	}

	const passed = processResult.exitCode === 0;
	const result = baseResult({
		action: passed ? "tests_passed" : "tests_failed",
		status: passed ? "passed" : "failed",
		command: "run",
		cwd,
		bunCommand,
		bunArgs: input.parsed.bunArgs,
		exitCode: processResult.exitCode,
		runId: input.runId,
		durationMs: processResult.wallTimeMs,
		summary: parsedOutput.summary,
		failures: parsedOutput.failures,
		diagnostic: passed ? undefined : testsFailedDiagnostic(parsedOutput.failures),
	});
	return debug ? { ...result, debug } : result;
}

async function runBunTestProcess(input: {
	bunCommand: string;
	cwd: string;
	bunArgs: readonly string[];
	timeoutMs: number;
}): Promise<ProcessResult> {
	const startedAt = performance.now();
	const proc = Bun.spawn([input.bunCommand, "test", ...input.bunArgs], {
		cwd: input.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill("SIGTERM");
	}, input.timeoutMs);

	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return {
			exitCode,
			stdout,
			stderr,
			timedOut,
			wallTimeMs: Math.round(performance.now() - startedAt),
		};
	} finally {
		clearTimeout(timer);
	}
}

function parseTestRunnerArgv(input: {
	argv: readonly string[];
	bunArgs: readonly string[];
	separatorSeen: boolean;
	defaultCwd: string;
}): ParsedRunnerCommand {
	if (input.argv.includes("--version")) return { kind: "version" };
	if (input.argv.includes("--help") || input.argv.includes("-h")) {
		return { kind: "help", command: findCommand(input.argv) };
	}

	const args = [...input.argv];
	let command: TestRunnerCommand = "run";
	if (args[0] && !args[0].startsWith("-")) {
		const candidate = args.shift();
		if (candidate === "help") {
			return { kind: "help", command: findCommand(args) };
		}
		if (!isCommand(candidate)) throw usageError(`unknown command: ${candidate}`);
		command = candidate;
	}

	let outputMode: OutputMode = "plain";
	let cwd = input.defaultCwd;
	let timeoutMs = DEFAULT_TIMEOUT_MS;
	let debugOutput = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--json":
				outputMode = "json";
				break;
			case "--plain":
				outputMode = "plain";
				break;
			case "--debug-output":
				debugOutput = true;
				break;
			case "--cwd":
				cwd = requireNext(args, index, "--cwd");
				index += 1;
				break;
			case "--timeout-ms":
				timeoutMs = parseTimeoutMs(requireNext(args, index, "--timeout-ms"));
				index += 1;
				break;
			default:
				if (arg.startsWith("--cwd=")) {
					cwd = requireInlineValue(arg, "--cwd");
				} else if (arg.startsWith("--timeout-ms=")) {
					timeoutMs = parseTimeoutMs(requireInlineValue(arg, "--timeout-ms"));
				} else if (arg.startsWith("-")) {
					throw usageError(`unknown option: ${arg}`);
				} else {
					throw usageError(
						`unexpected runner argument: ${arg}. Pass test args after --.`,
					);
				}
		}
	}

	if (command === "status") {
		if (input.bunArgs.length > 0 || input.separatorSeen) {
			throw usageError("status does not accept test args.");
		}
		return { kind: "status", command, outputMode, cwd };
	}

	return {
		kind: "run",
		command,
		outputMode,
		cwd,
		timeoutMs,
		debugOutput,
		bunArgs: input.separatorSeen ? [...input.bunArgs] : [],
	};
}

function writeResult(
	stdout: CliWriter,
	stderr: CliWriter,
	result: TestRunnerResult,
	outputMode: OutputMode,
): void {
	if (outputMode === "plain") {
		const output = renderPlain(result);
		(result.exit_code === 0 ? stdout : stderr).write(output);
		return;
	}

	if (result.exit_code === 0) {
		writeJsonEnvelope(
			stdout,
			createCliRuntimeSuccessEnvelope({
				run_id: result.run_id,
				data: result,
			}),
			{ runId: result.run_id, durationMs: result.duration_ms },
		);
		return;
	}

	const runtimeActions = runtimeActionsFor(result);
	writeJsonEnvelope(
		stdout,
		createCliRuntimeErrorEnvelope({
			run_id: result.run_id,
			process_exit_code: result.exit_code,
			error: {
				run_id: result.run_id,
				code: result.diagnostic?.code ?? "invocation_error",
				message: result.diagnostic?.message ?? "Test runner failed.",
				exit_code: result.exit_code,
				severity: result.status === "failed" ? "error" : "fatal",
				recoverability: diagnosticRecoverability(result.diagnostic),
				retryable: result.diagnostic?.retryable ?? false,
				failure_domain:
					result.status === "failed" ? "bun_test" : "runtime_diagnostics",
				hint: {
					summary:
						result.diagnostic?.next_action ??
						"Inspect the runner diagnostic and rerun with corrected input.",
					action: diagnosticHintAction(result.diagnostic),
				},
			},
			runtime_actions: runtimeActions,
			continuation: continuationFor(runtimeActions),
			data: result,
		}),
		{ runId: result.run_id, durationMs: result.duration_ms },
	);
}

function renderPlain(result: TestRunnerResult): string {
	const head = [
		result.action,
		`status=${result.status}`,
		`exit=${result.exit_code}`,
		`files=${displayNumber(result.summary.files)}`,
		`tests=${displayNumber(result.summary.tests)}`,
		`failed=${displayNumber(result.summary.failed)}`,
		`duration_ms=${result.duration_ms}`,
		`run_id=${result.run_id}`,
	];
	const lines = [head.join(" ")];

	if (result.diagnostic && result.status === "error") {
		lines.push(`diagnostic=${result.diagnostic.code}`);
		lines.push(`cause=${result.diagnostic.cause}`);
		lines.push(`next=${result.diagnostic.next_action}`);
		return `${lines.join("\n")}\n`;
	}

	for (const failure of result.failures.slice(0, MAX_FAILURES)) {
		lines.push(
			`- ${failure.file ?? "unknown"} > ${failure.test_name || "unknown test"}`,
		);
		if (failure.message) lines.push(`  ${failure.message}`);
		for (const contextLine of failure.context.slice(
			0,
			MAX_PLAIN_CONTEXT_LINES_PER_FAILURE,
		)) {
			lines.push(`  ${contextLine}`);
		}
	}

	if (result.failures.length > MAX_FAILURES) {
		lines.push(`- ${result.failures.length - MAX_FAILURES} more failure(s) omitted`);
	}
	if (result.status === "failed" && result.failures.length === 0) {
		lines.push("- Test process exited non-zero; rerun with --json --debug-output if context is missing.");
	}
	return `${lines.join("\n")}\n`;
}

function parseBunOutput(
	output: string,
): Pick<TestRunnerResult, "summary" | "failures"> {
	const lines = output.split(/\r?\n/);
	let currentFile: string | null = null;
	const failures: TestRunnerFailure[] = [];

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const fileMatch = line.match(/^(.+\.test\.[cm]?[tj]sx?):$/);
		if (fileMatch?.[1]) currentFile = fileMatch[1];

		const failMatch = line.match(/^\(fail\) (.+? > .+?)(?: \[[^\]]+\])?$/);
		if (!failMatch?.[1]) continue;

		const testName = failMatch[1];
		const context = selectFailureContext(lines, index);
		failures.push({
			file: currentFile,
			test_name: testName,
			message: selectFailureMessage(context),
			context,
		});
	}

	return {
		summary: parseSummary(lines),
		failures,
	};
}

function parseSummary(lines: readonly string[]): TestRunnerResult["summary"] {
	const summary = emptySummary();
	for (const line of lines) {
		const pass = line.match(/^\s*(\d+) pass$/);
		if (pass?.[1]) summary.passed = Number(pass[1]);
		const fail = line.match(/^\s*(\d+) fail$/);
		if (fail?.[1]) summary.failed = Number(fail[1]);
		const expectCalls = line.match(/^\s*(\d+) expect\(\) calls?$/);
		if (expectCalls?.[1]) summary.expect_calls = Number(expectCalls[1]);
		const ran = line.match(/^Ran (\d+) tests? across (\d+) files?\./);
		if (ran?.[1]) summary.tests = Number(ran[1]);
		if (ran?.[2]) summary.files = Number(ran[2]);
	}
	if (summary.tests === null && summary.passed !== null && summary.failed !== null) {
		summary.tests = summary.passed + summary.failed;
	}
	return summary;
}

function selectFailureContext(lines: readonly string[], failureIndex: number): string[] {
	const start = Math.max(0, failureIndex - MAX_CONTEXT_LINES_PER_FAILURE);
	const window = lines
		.slice(start, failureIndex + 1)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const signalLines = window.filter((line) =>
		/^(error:|Expected:|Received:|\(fail\)|\^|.*timed out.*$)/i.test(line),
	);
	const selected = signalLines.length > 0 ? signalLines : window.slice(-3);
	return selected
		.slice(-MAX_CONTEXT_LINES_PER_FAILURE)
		.map((line) => truncate(line, MAX_CONTEXT_LINE_CHARS));
}

function selectFailureMessage(context: readonly string[]): string | null {
	return (
		context.find((line) => line.startsWith("error:")) ??
		context.find((line) => /timed out/i.test(line)) ??
		context.find((line) => line.startsWith("Expected:")) ??
		null
	);
}

async function findExecutable(name: string): Promise<string | null> {
	const path = process.env.PATH ?? "";
	for (const dir of path.split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, name);
		try {
			await access(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Keep scanning PATH.
		}
	}
	return null;
}

function createRunnerDiagnosticResult(input: {
	command: TestRunnerCommand;
	cwd: string;
	bunCommand: string | null;
	bunArgs: readonly string[];
	runId: string;
	durationMs: number;
	diagnostic: TestRunnerDiagnostic;
	exitCode: number;
	summary?: TestRunnerResult["summary"];
	failures?: TestRunnerFailure[];
}): TestRunnerResult {
	return baseResult({
		action: "runner_error",
		status: "error",
		command: input.command,
		cwd: input.cwd,
		bunCommand: input.bunCommand,
		bunArgs: input.bunArgs,
		exitCode: input.exitCode,
		runId: input.runId,
		durationMs: input.durationMs,
		summary: input.summary ?? emptySummary(),
		failures: input.failures ?? [],
		diagnostic: input.diagnostic,
	});
}

function baseResult(input: {
	action: TestRunnerResult["action"];
	status: TestRunnerResultStatus;
	command: TestRunnerCommand;
	cwd: string;
	bunCommand: string | null;
	bunArgs: readonly string[];
	exitCode: number;
	runId: string;
	durationMs: number;
	summary: TestRunnerResult["summary"];
	failures: readonly TestRunnerFailure[];
	diagnostic?: TestRunnerDiagnostic;
}): TestRunnerResult {
	return {
		action: input.action,
		contract: TEST_RUNNER_CONTRACT_ID,
		schema_version: TEST_RUNNER_SCHEMA_VERSION,
		status: input.status,
		command: input.command,
		cwd: input.cwd,
		bun_command: input.bunCommand,
		bun_args: [...input.bunArgs],
		exit_code: input.exitCode,
		run_id: input.runId,
		duration_ms: Math.max(0, Math.round(input.durationMs)),
		summary: input.summary,
		failures: [...input.failures],
		...(input.diagnostic ? { diagnostic: input.diagnostic } : {}),
	};
}

function emptySummary(): TestRunnerResult["summary"] {
	return {
		files: null,
		tests: null,
		passed: null,
		failed: null,
		expect_calls: null,
	};
}

function invalidCwdDiagnostic(cwd: string): TestRunnerDiagnostic {
	return {
		code: "invalid_cwd",
		message: "Runner cwd is not a directory.",
		cause: `cwd does not resolve to a directory: ${cwd}`,
		retryable: false,
		next_action: "Pass an existing directory with --cwd.",
	};
}

function missingBunDiagnostic(): TestRunnerDiagnostic {
	return {
		code: "missing_bun",
		message: "Required test runtime is missing.",
		cause: "runtime executable was not found on PATH.",
		retryable: false,
		next_action: "Install the required runtime or expose it on PATH, then rerun.",
	};
}

function timeoutDiagnostic(timeoutMs: number): TestRunnerDiagnostic {
	return {
		code: "runner_timeout",
		message: "Test process exceeded the runner timeout.",
		cause: `process exceeded --timeout-ms ${timeoutMs}`,
		retryable: true,
		next_action: "Increase --timeout-ms or pass a narrower test target.",
	};
}

function invocationDiagnostic(error: unknown): TestRunnerDiagnostic {
	return {
		code: "invocation_error",
		message: "Test process could not be invoked.",
		cause: error instanceof Error ? error.message : String(error),
		retryable: false,
		next_action: "Inspect the command input and local runtime before retrying.",
	};
}

function testsFailedDiagnostic(
	failures: readonly TestRunnerFailure[],
): TestRunnerDiagnostic {
	return {
		code: "bun_tests_failed",
		message: "Tests failed.",
		cause:
			failures[0]?.test_name ??
			"Test process exited non-zero without a parsed failure name.",
		retryable: false,
		next_action: "Fix the failing test or implementation, then rerun.",
	};
}

function emitCliError(input: {
	error: unknown;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const isUsage = input.error instanceof CliUsageError;
	const exitCode = isUsage ? USAGE_EXIT_CODE : RUNTIME_FAILURE_EXIT_CODE;
	const message =
		input.error instanceof Error ? input.error.message : "Unknown runner error.";
	if (input.outputMode === "plain") {
		input.stderr.write(
			`test_runner ${isUsage ? "usage_error" : "runtime_error"}: ${message} run_id=${input.runId}\n`,
		);
		return exitCode;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: exitCode,
			error: {
				run_id: input.runId,
				code: isUsage ? "usage_error" : "invocation_error",
				message,
				exit_code: exitCode,
				severity: isUsage ? "error" : "fatal",
				recoverability: isUsage ? "change_input" : "none",
				retryable: false,
				failure_domain: isUsage ? "input" : "runtime_diagnostics",
				hint: {
					summary: isUsage
						? "Correct runner arguments. Put test args after --."
						: "Inspect runtime diagnostics before retrying.",
					action: isUsage ? "change_input" : "contact_support",
				},
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return exitCode;
}

function runtimeActionsFor(result: TestRunnerResult) {
	if (result.diagnostic?.code === "runner_timeout") {
		return [
			{
				id: "increase_timeout",
				summary: "Increase --timeout-ms or narrow the test target.",
				side_effects: ["check"] as const,
			},
		];
	}
	if (result.diagnostic?.code === "missing_bun") {
		return [
			{
				id: "install_bun",
				summary: "Install the required runtime, then rerun.",
				side_effects: ["write"] as const,
			},
		];
	}
	if (result.status === "failed") {
		return [
			{
				id: "fix_test_failure",
				summary: "Use the compact failure context to repair the test failure.",
				side_effects: ["write"] as const,
			},
		];
	}
	return [
		{
			id: "change_runner_input",
			summary: "Correct runner arguments, cwd, or pass-through args.",
			side_effects: ["check"] as const,
		},
	];
}

function continuationFor(actions: ReturnType<typeof runtimeActionsFor>) {
	const action = actions[0];
	if (!action) return undefined;
	return { next_action_id: action.id };
}

function diagnosticRecoverability(
	diagnostic: TestRunnerDiagnostic | undefined,
): "none" | "retry" | "change_input" | "repair_state" {
	if (!diagnostic) return "none";
	if (diagnostic.retryable) return "retry";
	if (diagnostic.code === "missing_bun") return "repair_state";
	if (diagnostic.code === "invalid_cwd" || diagnostic.code === "usage_error") {
		return "change_input";
	}
	if (diagnostic.code === "bun_tests_failed") return "change_input";
	return "none";
}

function diagnosticHintAction(
	diagnostic: TestRunnerDiagnostic | undefined,
): "retry" | "change_input" | "repair_state" | "contact_support" {
	if (!diagnostic) return "contact_support";
	if (diagnostic.retryable) return "retry";
	if (diagnostic.code === "missing_bun") return "repair_state";
	if (diagnostic.code === "bun_tests_failed" || diagnostic.code === "invalid_cwd") {
		return "change_input";
	}
	return "contact_support";
}

function splitRunnerAndBunArgv(argv: readonly string[]): {
	runnerArgv: string[];
	bunArgs: string[];
	separatorSeen: boolean;
} {
	const separatorIndex = argv.indexOf("--");
	if (separatorIndex === -1) {
		return { runnerArgv: [...argv], bunArgs: [], separatorSeen: false };
	}
	return {
		runnerArgv: argv.slice(0, separatorIndex),
		bunArgs: argv.slice(separatorIndex + 1),
		separatorSeen: true,
	};
}

function inferOutputMode(argv: readonly string[]): OutputMode {
	let outputMode: OutputMode = "plain";
	for (const arg of argv) {
		if (arg === "--json") outputMode = "json";
		if (arg === "--plain") outputMode = "plain";
	}
	return outputMode;
}

function renderHelp(command?: TestRunnerCommand): string {
	if (command) return renderCommandUsage(testRunnerContracts[command]);
	const commandLines = Object.entries(testRunnerContracts).map(
		([name, contract]) => `  ${name.padEnd(8)} ${contract.summary}`,
	);
	return [
		"Usage: test-runner <command> [runner flags] -- <test args>",
		"",
		"Commands:",
		...commandLines,
		"",
		"Global diagnostic flags:",
		"  --run-id <id>   Set run correlation id.",
		"  --quiet         Suppress diagnostics.",
		"  --verbose       Emit info diagnostics to stderr.",
		"  --debug         Emit debug diagnostics to stderr.",
		"  --version       Print version.",
		"",
	].join("\n");
}

function findCommand(argv: readonly string[]): TestRunnerCommand | undefined {
	return argv.find(isCommand);
}

function isCommand(value: string | undefined): value is TestRunnerCommand {
	return value === "run" || value === "status";
}

function requireNext(args: readonly string[], index: number, flag: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw usageError(`${flag} requires a value`);
	return value;
}

function requireInlineValue(arg: string, flag: string): string {
	const value = arg.slice(`${flag}=`.length);
	if (!value) throw usageError(`${flag} requires a value`);
	return value;
}

function parseTimeoutMs(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw usageError("--timeout-ms must be a positive integer.");
	}
	return parsed;
}

function displayNumber(value: number | null): string {
	return value === null ? "?" : String(value);
}

function truncate(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}...`;
}

export async function runForTest(
	argv: readonly string[],
	runtime: TestRunnerRuntime = createDefaultTestRunnerRuntime(),
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runTestRunnerCli(argv, {
		runtime,
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

if (import.meta.main) {
	const exitCode = await runTestRunnerCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
