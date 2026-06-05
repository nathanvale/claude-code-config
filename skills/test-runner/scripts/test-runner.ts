#!/usr/bin/env bun

import { constants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, delimiter, join, resolve } from "node:path";
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
	type TestRunnerOutputFormat,
	type TestRunnerResultStatus,
	type TestRunnerRunMode,
	testRunnerContracts,
} from "./command-contract";

const VERSION = "0.1.0";
const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FAILURES = 3;
const MAX_CONTEXT_LINES_PER_FAILURE = 8;
const MAX_PLAIN_CONTEXT_LINES_PER_FAILURE = 4;
const MAX_POST_FAILURE_CONTEXT_LINES = 2;
const MAX_CONTEXT_LINE_CHARS = 220;
const MAX_DEBUG_CHARS = 2_000;
const MAX_DETAIL_EXCERPT_LINES = 18;
const DETAIL_TTL_MS = 24 * 60 * 60 * 1_000;
const DETAIL_OUTPUT_DIR = join(import.meta.dir, ".runner-output");

type OutputMode = TestRunnerOutputFormat;

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
			kind: "detail";
			command: "detail";
			outputMode: OutputMode;
			handle: string;
	  }
	| {
			kind: "run";
			command: "run";
			outputMode: OutputMode;
			cwd: string;
			timeoutMs: number;
			debugOutput: boolean;
			runMode: TestRunnerRunMode;
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
	failure_id: string;
	file: string | null;
	line: number | null;
	navigation_target: string | null;
	navigation_context: string | null;
	test_name: string;
	message: string | null;
	assertion_signal: string | null;
	expected: string | null;
	received: string | null;
	context: string[];
	detail_handle: string | null;
};

export type TestRunnerDiagnostic = {
	code: TestRunnerDiagnosticCode | "bun_tests_failed";
	message: string;
	cause: string;
	retryable: boolean;
	next_action: string;
};

export type TestRunnerResult = {
	action:
		| "tests_passed"
		| "tests_failed"
		| "runner_ready"
		| "runner_error"
		| "detail_returned";
	contract: typeof TEST_RUNNER_CONTRACT_ID;
	schema_version: typeof TEST_RUNNER_SCHEMA_VERSION;
	status: TestRunnerResultStatus;
	command: TestRunnerCommand;
	mode?: TestRunnerRunMode;
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
	detail_available?: boolean;
	detail_diagnostic?: TestRunnerDiagnostic;
	detail?: TestRunnerDetail;
	debug?: {
		stdout_sample: string;
		stderr_sample: string;
	};
};

export type TestRunnerDetail = {
	handle: string;
	run_id: string;
	failure_id: string;
	file: string | null;
	line: number | null;
	test_name: string;
	message: string | null;
	assertion_signal: string | null;
	expected: string | null;
	received: string | null;
	context: string[];
	raw_excerpt: string[];
	created_at_ms: number;
	expires_at_ms: number;
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
	writeText: (path: string, text: string) => Promise<void>;
	readText: (path: string) => Promise<string>;
	mkdir: (path: string) => Promise<void>;
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
		writeText: writeFile,
		readText: (path) => readFile(path, "utf-8"),
		mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
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
			: parsed.kind === "detail"
				? await lookupFailureDetail({
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
			mode: input.parsed.runMode,
		});
	}

	const combinedOutput = `${processResult.stdout}\n${processResult.stderr}`;
	const parsedOutput = parseBunOutput({
		output: combinedOutput,
		runId: input.runId,
	});
	const detailDiagnostic =
		parsedOutput.failures.length > 0
			? await persistFailureDetails({
					failures: parsedOutput.failures,
					runId: input.runId,
					rawOutput: combinedOutput,
					nowMs: input.runtime.now(),
					runtime: input.runtime,
				})
			: undefined;
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
				mode: input.parsed.runMode,
				detailDiagnostic,
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
		diagnostic: passed
			? undefined
			: testsFailedDiagnostic(parsedOutput.failures),
		mode: input.parsed.runMode,
		detailDiagnostic,
	});
	return debug ? { ...result, debug } : result;
}

async function persistFailureDetails(input: {
	failures: TestRunnerFailure[];
	runId: string;
	rawOutput: string;
	nowMs: number;
	runtime: TestRunnerRuntime;
}): Promise<TestRunnerDiagnostic | undefined> {
	const createdAtMs = input.nowMs;
	const expiresAtMs = createdAtMs + DETAIL_TTL_MS;
	try {
		await input.runtime.mkdir(DETAIL_OUTPUT_DIR);
		for (const failure of input.failures) {
			if (!failure.detail_handle) continue;
			const detail: TestRunnerDetail = {
				handle: failure.detail_handle,
				run_id: input.runId,
				failure_id: failure.failure_id,
				file: failure.file,
				line: failure.line,
				test_name: failure.test_name,
				message: failure.message,
				assertion_signal: failure.assertion_signal,
				expected: failure.expected,
				received: failure.received,
				context: failure.context,
				raw_excerpt: selectRawExcerpt(input.rawOutput, failure.test_name),
				created_at_ms: createdAtMs,
				expires_at_ms: expiresAtMs,
			};
			await input.runtime.writeText(
				detailPathForHandle(failure.detail_handle),
				`${JSON.stringify(detail, null, 2)}\n`,
			);
		}
		return undefined;
	} catch {
		for (const failure of input.failures) failure.detail_handle = null;
		return detailUnavailableDiagnostic();
	}
}

async function lookupFailureDetail(input: {
	parsed: Extract<ParsedRunnerCommand, { kind: "detail" }>;
	runtime: TestRunnerRuntime;
	runId: string;
	startedAt: number;
}): Promise<TestRunnerResult> {
	const cwd = ".runner-output";
	const handle = input.parsed.handle;
	const diagnostic = validateDetailHandle(handle);
	if (diagnostic) {
		return createRunnerDiagnosticResult({
			command: "detail",
			cwd,
			bunCommand: null,
			bunArgs: [],
			runId: input.runId,
			durationMs: input.runtime.now() - input.startedAt,
			diagnostic,
			exitCode: RUNTIME_FAILURE_EXIT_CODE,
		});
	}

	let parsed: unknown;
	try {
		const artifact = await input.runtime.readText(detailPathForHandle(handle));
		try {
			parsed = JSON.parse(artifact);
		} catch {
			return createRunnerDiagnosticResult({
				command: "detail",
				cwd,
				bunCommand: null,
				bunArgs: [],
				runId: input.runId,
				durationMs: input.runtime.now() - input.startedAt,
				diagnostic: detailMalformedDiagnostic(),
				exitCode: RUNTIME_FAILURE_EXIT_CODE,
			});
		}
	} catch {
		return createRunnerDiagnosticResult({
			command: "detail",
			cwd,
			bunCommand: null,
			bunArgs: [],
			runId: input.runId,
			durationMs: input.runtime.now() - input.startedAt,
			diagnostic: detailNotFoundDiagnostic(),
			exitCode: RUNTIME_FAILURE_EXIT_CODE,
		});
	}

	if (!isDetailArtifact(parsed)) {
		return createRunnerDiagnosticResult({
			command: "detail",
			cwd,
			bunCommand: null,
			bunArgs: [],
			runId: input.runId,
			durationMs: input.runtime.now() - input.startedAt,
			diagnostic: detailMalformedDiagnostic(),
			exitCode: RUNTIME_FAILURE_EXIT_CODE,
		});
	}

	if (parsed.handle !== handle || !handle.includes(shortRunKey(parsed.run_id))) {
		return createRunnerDiagnosticResult({
			command: "detail",
			cwd,
			bunCommand: null,
			bunArgs: [],
			runId: input.runId,
			durationMs: input.runtime.now() - input.startedAt,
			diagnostic: detailWrongRunDiagnostic(),
			exitCode: RUNTIME_FAILURE_EXIT_CODE,
		});
	}

	if (parsed.expires_at_ms <= input.runtime.now()) {
		return createRunnerDiagnosticResult({
			command: "detail",
			cwd,
			bunCommand: null,
			bunArgs: [],
			runId: input.runId,
			durationMs: input.runtime.now() - input.startedAt,
			diagnostic: detailExpiredDiagnostic(),
			exitCode: RUNTIME_FAILURE_EXIT_CODE,
		});
	}

	return baseResult({
		action: "detail_returned",
		status: "passed",
		command: "detail",
		cwd,
		bunCommand: null,
		bunArgs: [],
		exitCode: 0,
		runId: input.runId,
		durationMs: input.runtime.now() - input.startedAt,
		summary: emptySummary(),
		failures: [detailToFailure(parsed)],
		detail: parsed,
	});
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
	let runMode: TestRunnerRunMode = "compact";
	let handle: string | null = null;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--json":
				outputMode = "json";
				break;
			case "--plain":
				outputMode = "plain";
				break;
			case "--format":
				outputMode = parseOutputFormat(requireNext(args, index, "--format"));
				index += 1;
				break;
			case "--debug-output":
				debugOutput = true;
				break;
			case "--mode":
				runMode = parseRunMode(requireNext(args, index, "--mode"));
				index += 1;
				break;
			case "--handle":
				handle = requireNext(args, index, "--handle");
				index += 1;
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
				} else if (arg.startsWith("--mode=")) {
					runMode = parseRunMode(requireInlineValue(arg, "--mode"));
				} else if (arg.startsWith("--format=")) {
					outputMode = parseOutputFormat(requireInlineValue(arg, "--format"));
				} else if (arg.startsWith("--handle=")) {
					handle = requireInlineValue(arg, "--handle");
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
		if (handle) throw usageError("status does not accept --handle.");
		if (runMode !== "compact") throw usageError("status does not accept --mode.");
		return { kind: "status", command, outputMode, cwd };
	}

	if (command === "detail") {
		if (input.bunArgs.length > 0 || input.separatorSeen) {
			throw usageError("detail does not accept test args.");
		}
		if (cwd !== input.defaultCwd) throw usageError("detail does not accept --cwd.");
		if (debugOutput) throw usageError("detail does not accept --debug-output.");
		if (runMode !== "compact") throw usageError("detail does not accept --mode.");
		if (!handle) {
			throw usageError(
				"detail requires --handle from a prior repair or triage packet.",
			);
		}
		return { kind: "detail", command, outputMode, handle };
	}

	if (handle) throw usageError("run does not accept --handle; use detail --handle.");

	return {
		kind: "run",
		command,
		outputMode,
		cwd,
		timeoutMs,
		debugOutput,
		runMode,
		bunArgs: input.separatorSeen ? [...input.bunArgs] : [],
	};
}

function writeResult(
	stdout: CliWriter,
	stderr: CliWriter,
	result: TestRunnerResult,
	outputMode: OutputMode,
): void {
	if (outputMode === "json-compact") {
		const output = renderCompactJson(result);
		stdout.write(output);
		return;
	}

	if (outputMode === "toon") {
		const output = renderToon(result);
		stdout.write(output);
		return;
	}

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
	if (result.command === "detail") return renderDetailPlain(result);
	if (result.diagnostic && result.status === "error") return renderErrorPlain(result);
	if (result.mode === "repair") return renderRepairPlain(result);
	if (result.mode === "triage") return renderTriagePlain(result);

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
	appendDetailDiagnostic(lines, result);

	for (const failure of result.failures.slice(0, MAX_FAILURES)) {
		lines.push(
			`- ${failure.file ?? "unknown"} > ${failure.test_name || "unknown test"}`,
		);
		if (failure.message) lines.push(`  ${failure.message}`);
		const context = failure.message
			? failure.context.filter((line) => line !== failure.message)
			: failure.context;
		for (const contextLine of context.slice(
			0,
			MAX_PLAIN_CONTEXT_LINES_PER_FAILURE,
		)) {
			lines.push(`  ${contextLine}`);
		}
		if (failure.detail_handle) lines.push(`  detail=${failure.detail_handle}`);
	}

	if (result.failures.length > MAX_FAILURES) {
		lines.push(`- ${result.failures.length - MAX_FAILURES} more failure(s) omitted`);
	}
	if (result.status === "failed" && result.failures.length === 0) {
		lines.push("- Test process exited non-zero; rerun with --json --debug-output if context is missing.");
	}
	return `${lines.join("\n")}\n`;
}

function renderErrorPlain(result: TestRunnerResult): string {
	const lines = [
		`${result.command}_error diagnostic=${result.diagnostic?.code ?? "unknown"}`,
		`cause=${result.diagnostic?.cause ?? "unknown"}`,
		`retryable=${result.diagnostic?.retryable ?? false}`,
		`next=${result.diagnostic?.next_action ?? "Inspect diagnostics and rerun."}`,
		`run_id=${result.run_id}`,
	];
	for (const failure of result.failures.slice(0, MAX_FAILURES)) {
		lines.push(
			`- ${failure.navigation_target ?? failure.file ?? "unknown"} > ${failure.test_name}`,
		);
		if (failure.message) lines.push(`  ${failure.message}`);
		if (failure.detail_handle) lines.push(`  detail=${failure.detail_handle}`);
	}
	return `${lines.join("\n")}\n`;
}

function renderCompactJson(result: TestRunnerResult): string {
	const payload = {
		s: Number(TEST_RUNNER_SCHEMA_VERSION),
		...(result.mode ? { m: result.mode } : {}),
		x: result.exit_code,
		k: "loc,test,assertion,expected,received,detail",
		f: result.failures.slice(0, MAX_FAILURES).map((failure) => [
			failure.navigation_target ?? failure.file ?? null,
			failure.test_name || null,
			failure.assertion_signal ?? failure.message ?? null,
			failure.expected,
			failure.received,
			failure.detail_handle,
		]),
		...(result.failures.length > MAX_FAILURES
			? { o: result.failures.length - MAX_FAILURES }
			: {}),
		...(result.diagnostic && result.status === "error"
			? {
					d: {
						code: result.diagnostic.code,
						message: result.diagnostic.message,
						next: result.diagnostic.next_action,
					},
				}
			: {}),
		...(result.detail_diagnostic
			? {
					dd: {
						code: result.detail_diagnostic.code,
						next: result.detail_diagnostic.next_action,
					},
				}
			: {}),
	};
	return `${JSON.stringify(payload)}\n`;
}

function renderToon(result: TestRunnerResult): string {
	if (result.command === "detail") return renderDetailToon(result);
	if (result.status === "passed") {
		return `p{x,failed}:${result.exit_code},0\n`;
	}
	const failures = result.failures.slice(0, MAX_FAILURES);
	const lines = [`f[${failures.length}]{l,t,a,e,r,d}:`];
	for (const failure of failures) {
		lines.push(
			[
				compactTarget(failure),
				compactTestName(failure.test_name),
				failure.assertion_signal ?? failure.message ?? "",
				failure.expected ?? "",
				failure.received ?? "",
				failure.detail_handle ?? "",
			]
				.map(escapeToonCell)
				.join(","),
		);
	}
	if (result.failures.length > MAX_FAILURES) {
		lines.push(`o:${result.failures.length - MAX_FAILURES}`);
	}
	if (result.failures.length === 0 && result.diagnostic) {
		lines.push(`d{code,next}:${escapeToonCell(result.diagnostic.code)},${escapeToonCell(result.diagnostic.next_action)}`);
	}
	return `${lines.join("\n")}\n`;
}

function renderDetailToon(result: TestRunnerResult): string {
	if (result.status === "error" || !result.detail) {
		return `d{code,next}:${escapeToonCell(result.diagnostic?.code ?? "unknown")},${escapeToonCell(result.diagnostic?.next_action ?? "Inspect diagnostics and rerun.")}\n`;
	}
	const detail = result.detail;
	return [
		"d{h,l,t,a,e,r}:",
		[
			detail.handle,
			detail.file && detail.line !== null
				? `${detail.file}:${detail.line}`
				: detail.file ?? "unknown",
			detail.test_name,
			detail.assertion_signal ?? "",
			detail.expected ?? "",
			detail.received ?? "",
		]
			.map(escapeToonCell)
			.join(","),
		"c:",
		...detail.raw_excerpt.slice(0, 18).map((line) => `  ${line}`),
		"",
	].join("\n");
}

function escapeToonCell(value: string): string {
	if (!/[",\n\r]/.test(value)) return value;
	return `"${value.replaceAll('"', '""')}"`;
}

function renderRepairPlain(result: TestRunnerResult): string {
	if (result.status === "passed") {
		return `tests_passed exit=${result.exit_code} failed=0\n`;
	}
	const lines = ["repair"];
	appendDetailDiagnostic(lines, result);
	for (const failure of result.failures.slice(0, MAX_FAILURES)) {
		lines.push(renderRepairFailureLine(failure));
	}
	if (result.failures.length > MAX_FAILURES) {
		lines.push(`- ${result.failures.length - MAX_FAILURES} more failure(s) omitted`);
	}
	if (result.failures.length === 0) {
		lines.push("- Non-zero test exit; rerun with --mode triage or --json --debug-output.");
	}
	return `${lines.join("\n")}\n`;
}

function renderRepairFailureLine(failure: TestRunnerFailure): string {
	const target = compactTarget(failure);
	const testName = compactTestName(failure.test_name);
	const facts = [
		target,
		testName,
		failure.assertion_signal ?? failure.message,
		failure.expected ? `Expected:${failure.expected}` : null,
		failure.received ? `Received:${failure.received}` : null,
		failure.detail_handle,
	].filter((part): part is string => Boolean(part));
	return facts.join(" ");
}

function compactTarget(failure: TestRunnerFailure): string {
	const file = failure.file ? basename(failure.file) : "unknown";
	return failure.line === null ? file : `${file}:${failure.line}`;
}

function compactTestName(testName: string): string {
	const parts = testName
		.split(">")
		.map((part) => part.trim())
		.filter(Boolean);
	return parts.at(-1) ?? testName;
}

function renderTriagePlain(result: TestRunnerResult): string {
	if (result.status === "passed") {
		return `tests_passed exit=${result.exit_code} failed=0\n`;
	}
	const lines = ["triage"];
	appendDetailDiagnostic(lines, result);
	for (const failure of result.failures.slice(0, MAX_FAILURES)) {
		lines.push(
			`- target=${failure.navigation_target ?? failure.file ?? "unknown"} test=${failure.test_name || "unknown test"}`,
		);
			if (failure.assertion_signal) lines.push(`  assertion=${failure.assertion_signal}`);
			if (failure.expected) lines.push(`  expected=${failure.expected}`);
			if (failure.received) lines.push(`  received=${failure.received}`);
			if (failure.navigation_context) {
				lines.push(`  context=${failure.navigation_context}`);
			}
			const usefulContext = failure.context.filter(
				(line) =>
					line !== failure.message &&
				!line.startsWith("(fail)") &&
					!line.startsWith("Expected:") &&
					!line.startsWith("Received:"),
			);
			const fallbackContext = failure.navigation_context ? [] : usefulContext;
			for (const contextLine of fallbackContext.slice(0, 2)) {
				lines.push(`  context=${contextLine}`);
			}
		if (failure.detail_handle) lines.push(`  detail=${failure.detail_handle}`);
	}
	if (result.failures.length > MAX_FAILURES) {
		lines.push(`- ${result.failures.length - MAX_FAILURES} more failure(s) omitted`);
	}
	if (result.failures.length === 0) {
		lines.push("- Non-zero test exit; rerun with --json --debug-output.");
	}
	return `${lines.join("\n")}\n`;
}

function renderDetailPlain(result: TestRunnerResult): string {
	if (result.status === "error" || !result.detail) return renderErrorPlain(result);
	const detail = result.detail;
	const lines = [
		`detail ${detail.handle}`,
		`source_run_id=${detail.run_id}`,
		`lookup_run_id=${result.run_id}`,
		`target=${detail.file && detail.line !== null ? `${detail.file}:${detail.line}` : detail.file ?? "unknown"}`,
		`test=${detail.test_name}`,
	];
	if (detail.assertion_signal) lines.push(`assertion=${detail.assertion_signal}`);
	if (detail.expected) lines.push(`expected=${detail.expected}`);
	if (detail.received) lines.push(`received=${detail.received}`);
	lines.push("context:");
	for (const line of detail.raw_excerpt.slice(0, 18)) lines.push(`  ${line}`);
	return `${lines.join("\n")}\n`;
}

function appendDetailDiagnostic(lines: string[], result: TestRunnerResult): void {
	if (!result.detail_diagnostic) return;
	lines.push(`detail=${result.detail_diagnostic.code}`);
	lines.push(`detail_retryable=${result.detail_diagnostic.retryable}`);
	lines.push(`detail_next=${result.detail_diagnostic.next_action}`);
}

function parseBunOutput(input: {
	output: string;
	runId: string;
}): Pick<TestRunnerResult, "summary" | "failures"> {
	const lines = input.output.split(/\r?\n/);
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
		const detailWindow = selectDetailWindow(lines, index);
		const file = currentFile ?? selectLocationFile(detailWindow);
		const locationLine = selectLocationLine(detailWindow);
		const navigationContext = selectNavigationContext(detailWindow, locationLine);
		const failureId = createFailureId({
			index: failures.length,
			file,
			line: locationLine,
			testName,
		});
		const assertion = selectAssertionFacts([...context, ...detailWindow]);
		failures.push({
			failure_id: failureId,
			file,
			line: locationLine,
				navigation_target:
					file && locationLine !== null
						? `${file}:${locationLine}`
						: file ?? testName,
				navigation_context: navigationContext,
				test_name: testName,
			message: selectFailureMessage([...context, ...detailWindow]),
			assertion_signal: assertion.signal,
			expected: assertion.expected,
			received: assertion.received,
			context,
			detail_handle: createDetailHandle(input.runId, failures.length + 1),
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
		.slice(start, failureIndex + 1 + MAX_POST_FAILURE_CONTEXT_LINES)
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
		context.find((line) => /(?:^|\s)[A-Z][A-Za-z]+Error:/.test(line)) ??
		context.find((line) => /timed out/i.test(line)) ??
		context.find((line) => line.startsWith("Expected:")) ??
		null
	);
}

function selectDetailWindow(lines: readonly string[], failureIndex: number): string[] {
	return formatDiagnosticExcerpt(lines, failureIndex, 14, 4);
}

function selectLocationFile(lines: readonly string[]): string | null {
	for (const line of lines) {
		const match = line.match(/\(([^()]+\.test\.[cm]?[tj]sx?):\d+:\d+\)$/);
		if (match?.[1]) return basename(match[1]);
	}
	return null;
}

function selectLocationLine(lines: readonly string[]): number | null {
	for (const line of lines) {
		const atMatch = line.match(/\.test\.[cm]?[tj]sx?:(\d+):\d+\)$/);
		if (atMatch?.[1]) return Number(atMatch[1]);
	}
	for (const line of lines) {
		const codeMatch = line.match(/^(\d+)\s+\|/);
		if (codeMatch?.[1]) return Number(codeMatch[1]);
	}
	return null;
}

function selectNavigationContext(
	lines: readonly string[],
	lineNumber: number | null,
): string | null {
	if (lineNumber === null) return null;
	const escapedLine = String(lineNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const linePattern = new RegExp(`^${escapedLine}\\s+\\|\\s*(.+)$`);
	const match = lines.find((line) => linePattern.test(line))?.match(linePattern);
	if (!match?.[1]) return null;
	return truncate(match[1].trim(), MAX_CONTEXT_LINE_CHARS);
}

function selectAssertionFacts(context: readonly string[]): {
	signal: string | null;
	expected: string | null;
	received: string | null;
} {
	return {
		signal:
			context.find((line) => line.startsWith("error:"))?.replace(/^error:\s*/, "") ??
			context.find((line) => /(?:^|\s)[A-Z][A-Za-z]+Error:/.test(line)) ??
			context.find((line) => /timed out/i.test(line)) ??
			null,
		expected: selectValueLine(context, "Expected"),
		received: selectValueLine(context, "Received"),
	};
}

function selectValueLine(
	context: readonly string[],
	label: "Expected" | "Received",
): string | null {
	const prefix = `${label}:`;
	const line = context.find((candidate) => candidate.startsWith(prefix));
	if (!line) return null;
	return line.slice(prefix.length).trim();
}

function createFailureId(input: {
	index: number;
	file: string | null;
	line: number | null;
	testName: string;
}): string {
	const raw = [
		input.index + 1,
		input.file ?? "unknown",
		input.line ?? "line",
		input.testName,
	].join("-");
	return raw
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80);
}

function createDetailHandle(runId: string, failureIndex: number): string {
	return `tr_${shortRunKey(runId)}_${failureIndex.toString(36)}`;
}

function shortRunKey(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 6);
}

function detailPathForHandle(handle: string): string {
	return join(DETAIL_OUTPUT_DIR, `${handle}.json`);
}

function validateDetailHandle(
	handle: string,
): TestRunnerDiagnostic | undefined {
	if (!/^tr_[a-z0-9._-]+_[a-z0-9._-]+$/.test(handle)) {
		return detailUnsafeDiagnostic();
	}
	return undefined;
}

function isDetailArtifact(value: unknown): value is TestRunnerDetail {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<TestRunnerDetail>;
	return (
		typeof candidate.handle === "string" &&
		typeof candidate.run_id === "string" &&
		typeof candidate.failure_id === "string" &&
		typeof candidate.test_name === "string" &&
		typeof candidate.created_at_ms === "number" &&
		typeof candidate.expires_at_ms === "number" &&
		Array.isArray(candidate.context) &&
		Array.isArray(candidate.raw_excerpt)
	);
}

function detailToFailure(detail: TestRunnerDetail): TestRunnerFailure {
	return {
		failure_id: detail.failure_id,
		file: detail.file,
		line: detail.line,
			navigation_target:
				detail.file && detail.line !== null
					? `${detail.file}:${detail.line}`
					: detail.file ?? detail.test_name,
			navigation_context: null,
			test_name: detail.test_name,
		message: detail.message,
		assertion_signal: detail.assertion_signal,
		expected: detail.expected,
		received: detail.received,
		context: detail.context,
		detail_handle: detail.handle,
	};
}

function selectRawExcerpt(output: string, testName: string): string[] {
	const lines = output.split(/\r?\n/);
	const index = lines.findIndex((line) => line.includes(testName));
	if (index === -1) {
		return formatDiagnosticExcerpt(lines, 0, 0, MAX_DETAIL_EXCERPT_LINES).slice(
			0,
			MAX_DETAIL_EXCERPT_LINES,
		);
	}
	return formatDiagnosticExcerpt(lines, index, 14, 4);
}

function formatDiagnosticExcerpt(
	lines: readonly string[],
	index: number,
	before: number,
	after: number,
): string[] {
	return lines
		.slice(Math.max(0, index - before), index + after)
		.filter((line) => line.trim().length > 0)
		.map((line) => truncate(sanitizeDiagnosticLine(line.trim()), MAX_CONTEXT_LINE_CHARS));
}

function sanitizeDiagnosticLine(line: string): string {
	return line.replace(
		/\((?:[^()]*\/)?([^/()]+\.test\.[cm]?[tj]sx?:\d+:\d+)\)/g,
		"($1)",
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
	mode?: TestRunnerRunMode;
	detail?: TestRunnerDetail;
	detailDiagnostic?: TestRunnerDiagnostic;
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
		mode: input.mode,
		detail: input.detail,
		detailDiagnostic: input.detailDiagnostic,
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
	mode?: TestRunnerRunMode;
	detail?: TestRunnerDetail;
	detailDiagnostic?: TestRunnerDiagnostic;
}): TestRunnerResult {
	return {
		action: input.action,
		contract: TEST_RUNNER_CONTRACT_ID,
		schema_version: TEST_RUNNER_SCHEMA_VERSION,
		status: input.status,
		command: input.command,
		...(input.mode ? { mode: input.mode } : {}),
		cwd: input.cwd,
		bun_command: input.bunCommand,
		bun_args: [...input.bunArgs],
		exit_code: input.exitCode,
		run_id: input.runId,
		duration_ms: Math.max(0, Math.round(input.durationMs)),
		summary: input.summary,
		failures: [...input.failures],
		...(input.diagnostic ? { diagnostic: input.diagnostic } : {}),
		detail_available: !input.detailDiagnostic,
		...(input.detailDiagnostic
			? { detail_diagnostic: input.detailDiagnostic }
			: {}),
		...(input.detail ? { detail: input.detail } : {}),
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

function detailUnavailableDiagnostic(): TestRunnerDiagnostic {
	return {
		code: "detail_unavailable",
		message: "Same-run detail lookup is unavailable for this run.",
		cause: "detail artifact could not be written.",
		retryable: true,
		next_action: "Use the visible failure facts, then rerun if richer detail is needed.",
	};
}

function detailUnsafeDiagnostic(): TestRunnerDiagnostic {
	return {
		code: "detail_unsafe",
		message: "Lookup handle is not safe to read.",
		cause: "handle did not match the runner handle format.",
		retryable: false,
		next_action: "Use a lookup handle copied from a prior repair or triage packet.",
	};
}

function detailNotFoundDiagnostic(): TestRunnerDiagnostic {
	return {
		code: "detail_not_found",
		message: "Same-run detail was not found.",
		cause: "no local generated detail artifact matched the handle.",
		retryable: false,
		next_action: "Rerun repair or triage mode and use a handle from that run.",
	};
}

function detailMalformedDiagnostic(): TestRunnerDiagnostic {
	return {
		code: "detail_malformed",
		message: "Same-run detail could not be read safely.",
		cause: "generated detail artifact was malformed.",
		retryable: false,
		next_action: "Rerun repair or triage mode to regenerate detail.",
	};
}

function detailWrongRunDiagnostic(): TestRunnerDiagnostic {
	return {
		code: "detail_wrong_run",
		message: "Lookup handle does not match its generated detail.",
		cause: "handle and artifact run correlation disagreed.",
		retryable: false,
		next_action: "Use a handle copied from the current repair or triage output.",
	};
}

function detailExpiredDiagnostic(): TestRunnerDiagnostic {
	return {
		code: "detail_expired",
		message: "Same-run detail expired.",
		cause: "generated detail artifact is past its local retention window.",
		retryable: false,
		next_action: "Rerun repair or triage mode to create a fresh lookup handle.",
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
		const actions = [];
		if (result.failures.some((failure) => failure.detail_handle)) {
			actions.push({
				id: "lookup_failure_detail",
				summary: "Use the failure handle to fetch source-run stored detail.",
				side_effects: ["check"] as const,
			});
		}
		actions.push(
			{
				id: "fix_test_failure",
				summary: "Use the failure context to repair the test failure.",
				side_effects: ["write"] as const,
			},
		);
		return actions;
	}
	if (result.command === "detail") {
		return [
			{
				id: "lookup_failure_detail",
				summary: "Use a lookup handle from repair or triage output.",
				side_effects: ["check"] as const,
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
	if (diagnostic.code.startsWith("detail_")) return "change_input";
	if (diagnostic.code === "bun_tests_failed") return "change_input";
	return "none";
}

function diagnosticHintAction(
	diagnostic: TestRunnerDiagnostic | undefined,
): "retry" | "change_input" | "repair_state" | "contact_support" {
	if (!diagnostic) return "contact_support";
	if (diagnostic.retryable) return "retry";
	if (diagnostic.code === "missing_bun") return "repair_state";
	if (
		diagnostic.code === "bun_tests_failed" ||
		diagnostic.code === "invalid_cwd" ||
		diagnostic.code.startsWith("detail_")
	) {
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
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--json") outputMode = "json";
		if (arg === "--plain") outputMode = "plain";
		if (arg === "--format") {
			outputMode = parseOutputFormat(requireNext(argv, index, "--format"));
			index += 1;
		}
		if (arg.startsWith("--format=")) {
			outputMode = parseOutputFormat(requireInlineValue(arg, "--format"));
		}
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
	return value === "run" || value === "status" || value === "detail";
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

function parseRunMode(value: string): TestRunnerRunMode {
	if (value === "compact" || value === "repair" || value === "triage") {
		return value;
	}
	throw usageError("--mode must be compact, repair, or triage.");
}

function parseOutputFormat(value: string): OutputMode {
	if (
		value === "plain" ||
		value === "json" ||
		value === "json-compact" ||
		value === "toon"
	) {
		return value;
	}
	throw usageError("--format must be plain, json, json-compact, or toon.");
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
