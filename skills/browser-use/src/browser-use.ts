#!/usr/bin/env bun

// Browser Use CLI (plan 2026-06-04-001, U3).
//
// Contract shell for live Browser Targets and Browser Operations. Router owns
// `prepare`/`route`; this surface owns `targets` and `operate` (KTD3). U3 ships
// help text, command discovery metadata, parser acceptance/rejection, and the
// result contracts. Subcommand bodies emit dry-run/mock envelopes (gated by
// --dry-run) or a structured not-implemented result. NO live browser calls,
// target discovery, or operations here — those land in U5/U6/U7.
//
// Command surfaces:
//   targets list|select|status   — Browser Target Discovery/Selection (shell).
//   operate snapshot|screenshot|emulate — Browser Operations (shell).

import {
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	CliUsageError,
	configureCliDiagnostics,
	createCliDiagnosticContext,
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	resetCliDiagnostics,
	usageError,
	withCliDiagnosticContext,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import type { BrowserUseCommand } from "./command-contract";
import {
	emitWithDiagnostics,
	quietDiagnosticWriter,
} from "./cli-diagnostics-bootstrap";
import {
	type OutputMode,
	type ResultKind,
	BINDING_FAIL_CLOSED_EXIT_CODE,
	NOT_IMPLEMENTED_EXIT_CODE,
	RUNTIME_FAILURE_EXIT_CODE,
	USAGE_EXIT_CODE,
	redactUnsafeText,
	stringField,
} from "./browser-use-core";
import {
	type BrowserUseRuntime,
	createDefaultBrowserUseRuntime,
} from "./browser-use-runtime";
import { runTargetsList } from "./browser-use-discovery";
import {
	runTargetsSelect,
	runTargetsStatus,
} from "./browser-use-selection";
import { runOperate } from "./browser-use-operations";
import {
	type ParsedBrowserUseCommand,
	applyEnvRunId,
	errorOutputMode,
	parseBrowserUseArgv,
	parsedRunIdFlag,
	renderHelp,
	writeVersion,
} from "./browser-use-parser";

// ---------------------------------------------------------------------------
// CLI driver. Mirrors browser-adapter-router.ts structure.
// ---------------------------------------------------------------------------

export async function runBrowserUseCli(
	argv: readonly string[],
	options: {
		runtime?: BrowserUseRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultBrowserUseRuntime();
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const diagnosticInput = applyEnvRunId(argv, runtime.env.BROWSER_USE_RUN_ID);
	let diagnosticArgv: ParsedCliDiagnosticArgv;

	try {
		diagnosticArgv = parseCliDiagnosticArgv(diagnosticInput);
	} catch (error) {
		diagnosticArgv = parseCliDiagnosticFallbackArgv(diagnosticInput);
		const outputMode = errorOutputMode(argv);
		return emitWithDiagnostics({
			categoryRoot: "browser-use.cli",
			options: diagnosticArgv.options,
			stderr,
			run: () =>
				emitCliError({
					error:
						error instanceof Error
							? usageError(error.message)
							: usageError("invalid diagnostic flags"),
					outputMode,
					stdout,
					stderr,
					runId: diagnosticArgv.options.runId,
					durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
				}),
		});
	}

	const outputMode = errorOutputMode(diagnosticArgv.argv);
	let parsed: ParsedBrowserUseCommand;
	try {
		parsed = parseBrowserUseArgv(diagnosticArgv.argv);
	} catch (error) {
		return emitWithDiagnostics({
			categoryRoot: "browser-use.cli",
			options: diagnosticArgv.options,
			stderr,
			run: () =>
				emitCliError({
					error,
					outputMode,
					stdout,
					stderr,
					runId: diagnosticArgv.options.runId,
					durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
				}),
		});
	}

	if (parsed.kind === "help") {
		stdout.write(renderHelp(parsed.family, parsed.command));
		return 0;
	}
	if (parsed.kind === "version") {
		writeVersion(stdout, parsed.outputMode, {
			runId: diagnosticArgv.options.runId,
			durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
		});
		return 0;
	}

	configureCliDiagnostics({
		categoryRoot: "browser-use.cli",
		options: diagnosticArgv.options,
		diagnosticWriter: diagnosticArgv.options.quiet
			? quietDiagnosticWriter
			: stderr,
	});

	try {
		const context = createCliDiagnosticContext(diagnosticArgv.options);
		return await withCliDiagnosticContext(context, async () => {
			const runId = diagnosticArgv.options.runId;
			// A run id is EXPLICIT when the caller set it via the --run-id flag or
			// BROWSER_USE_RUN_ID env; otherwise runId is the facade's per-invocation
			// random id, which must NOT drive run-scoped state correlation (U6).
			// Detect the flag with a proper flag parse (stops at the `--` terminator,
			// requires a standalone --run-id token), NOT a raw argv substring scan: a
			// substring scan flips true for a value smuggled past `--` (e.g. a state
			// path literally named --run-id) while the diagnostic layer left runId
			// random, producing a spurious cross-run failure.
			const runIdExplicit =
				stringField(runtime.env.BROWSER_USE_RUN_ID) !== undefined ||
				parsedRunIdFlag(diagnosticInput) !== undefined;
			const durationMs = () =>
				runtime.now() - diagnosticArgv.options.startedAtMs;
				return executeCommand({
					parsed,
					runtime,
					stdout,
					stderr,
					runId,
					runIdExplicit,
					diagnosticVerbose: diagnosticArgv.options.verbose,
					durationMs,
				});
		});
	} finally {
		resetCliDiagnostics();
	}
}

async function executeCommand(input: {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	runIdExplicit: boolean;
	diagnosticVerbose: boolean;
	durationMs: () => number;
}): Promise<number> {
	const { parsed, runtime } = input;
	const resultKind: ResultKind =
		parsed.family === "targets" ? "browser_targets" : "browser_operation";

	// Browser Target Discovery (U5). The first live `browser-use` surface: real
	// recovery and route-bound target listing through a proven adapter. Dry-run
	// still short-circuits to the mock envelope below.
	if (parsed.command === "targets-list" && !parsed.dryRun) {
		return runTargetsList({
			parsed,
			runtime,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs,
		});
	}

	// Browser Target Selection (U6). `targets select` resolves a route-bound
	// discovery envelope to one candidate and writes run-scoped state; `targets
	// status` projects that state. Both are live state surfaces, so dry-run still
	// short-circuits to the mock envelope below.
	if (parsed.command === "targets-select" && !parsed.dryRun) {
			return runTargetsSelect({
				parsed,
				runtime,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				runIdExplicit: input.runIdExplicit,
				durationMs: input.durationMs,
			});
	}
	if (parsed.command === "targets-status" && !parsed.dryRun) {
			return runTargetsStatus({
				parsed,
				runtime,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				runIdExplicit: input.runIdExplicit,
				durationMs: input.durationMs,
			});
	}

	if (parsed.family === "operate" && !parsed.dryRun) {
		return runOperate({
			parsed,
			runtime,
			stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				runIdExplicit: input.runIdExplicit,
				diagnosticVerbose: input.diagnosticVerbose,
				durationMs: input.durationMs,
			});
	}

	// Dry-run/mock: exercise success and failure envelopes without any live
	// browser call (R7-shell, U3 scenario 7). The mock outcome selector keeps
	// the failure path testable without inventing a live fault.
	if (parsed.dryRun) {
		const mockOutcome =
			runtime.env.BROWSER_USE_MOCK_OUTCOME === "failure"
				? "failure"
				: "success";
		if (mockOutcome === "failure") {
			return emitMockFailure({
				command: parsed.command,
				resultKind,
				outputMode: parsed.outputMode,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				durationMs: input.durationMs(),
			});
		}
		return emitMockSuccess({
			command: parsed.command,
			resultKind,
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			runId: input.runId,
			durationMs: input.durationMs(),
		});
	}

	// Live path is not implemented in the contract shell. Emit a structured
	// not-implemented result rather than touching a browser (U5/U6/U7 own it).
	return emitNotImplemented({
		command: parsed.command,
		resultKind,
		outputMode: parsed.outputMode,
		stdout: input.stdout,
		stderr: input.stderr,
		runId: input.runId,
		durationMs: input.durationMs(),
	});
}

// ---------------------------------------------------------------------------
// Output writers.
// ---------------------------------------------------------------------------


function emitMockSuccess(input: {
	command: BrowserUseCommand;
	resultKind: ResultKind;
	outputMode: OutputMode;
	stdout: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	if (input.outputMode === "plain") {
		input.stdout.write(
			[
				"browser_use_mock_success",
				`command=${input.command}`,
				`result=${input.resultKind}`,
				`run_id=${input.runId}`,
				`duration_ms=${input.durationMs}`,
			].join(" ") + "\n",
		);
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				command: input.command,
				result_kind: input.resultKind,
				mode: "dry_run",
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return 0;
}

function emitMockFailure(input: {
	command: BrowserUseCommand;
	resultKind: ResultKind;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const code = "browser_use_mock_failure";
	const message = "Dry-run mock failure outcome.";
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${code}: ${message} (run_id=${input.runId})\n`,
		);
		return BINDING_FAIL_CLOSED_EXIT_CODE;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
			data: { command: input.command, result_kind: input.resultKind, mode: "dry_run" },
			error: createCliRuntimeError({
				run_id: input.runId,
				code,
				message,
				exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
				severity: "error",
				recoverability: "change_input",
				retryable: false,
				failure_domain: "browser_use",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return BINDING_FAIL_CLOSED_EXIT_CODE;
}

function emitNotImplemented(input: {
	command: BrowserUseCommand;
	resultKind: ResultKind;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const code = "browser_use_not_implemented";
	const message =
		"Live browser-use logic is not implemented yet; rerun with --dry-run for the mock envelope.";
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${code}: ${message} (run_id=${input.runId})\n`,
		);
		return NOT_IMPLEMENTED_EXIT_CODE;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: NOT_IMPLEMENTED_EXIT_CODE,
			data: { command: input.command, result_kind: input.resultKind },
			error: createCliRuntimeError({
				run_id: input.runId,
				code,
				message,
				exit_code: NOT_IMPLEMENTED_EXIT_CODE,
				severity: "error",
				recoverability: "none",
				retryable: false,
				failure_domain: "browser_use",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return NOT_IMPLEMENTED_EXIT_CODE;
}

// ---------------------------------------------------------------------------
// --- Small shared field helpers --------------------------------------------


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
		input.error instanceof Error ? input.error.message : "Unknown runtime error.";
	const safeMessage = redactUnsafeText(message);
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${isUsage ? "usage_error" : "runtime_error"}: ${safeMessage} (run_id=${input.runId})\n`,
		);
		return exitCode;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: exitCode,
			error: createCliRuntimeError({
				run_id: input.runId,
				code: isUsage ? "usage_error" : "runtime_error",
				message: safeMessage,
				exit_code: exitCode,
				severity: isUsage ? "error" : "fatal",
				recoverability: isUsage ? "change_input" : "none",
				retryable: false,
				failure_domain: isUsage ? "input" : "runtime_diagnostics",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return exitCode;
}

// ---------------------------------------------------------------------------
// Test harness.
// ---------------------------------------------------------------------------

class BufferWriter implements CliWriter {
	private content = "";
	write(value: string): boolean {
		this.content += value;
		return true;
	}
	toString(): string {
		return this.content;
	}
}

export async function runForTest(
	argv: readonly string[],
	runtime: BrowserUseRuntime,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runBrowserUseCli(argv, { runtime, stdout, stderr });
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

export {
	BROWSER_USE_OPERATE_SUBCOMMANDS,
	BROWSER_USE_TARGETS_SUBCOMMANDS,
	type BrowserUseCommand,
	type BrowserUseOperateSubcommand,
	type BrowserUseTargetsSubcommand,
} from "./command-contract";
export {
	type BrowserOperationTransportFailure,
	type BrowserOperationTransportResult,
	runBrowserUseMcporter,
} from "./browser-use-transport";
export {
	type BrowserUseRuntime,
	createDefaultBrowserUseRuntime,
	decodeStdinChunks,
} from "./browser-use-runtime";
export {
	type OperationResolution,
	type OperationResolutionInput,
	type OperationTargetHints,
	resolveOperationTarget,
} from "./browser-use-selection";

if (import.meta.main) {
	const exitCode = await runBrowserUseCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
