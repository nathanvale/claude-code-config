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
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	resetCliDiagnostics,
	usageError,
	withCliDiagnosticContext,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_FAMILIES,
	BROWSER_USE_OPERATE_SUBCOMMANDS,
	BROWSER_USE_TARGETS_SUBCOMMANDS,
	type BrowserUseCommand,
	type BrowserUseFamily,
	type BrowserUseOperateSubcommand,
	type BrowserUseTargetsSubcommand,
	browserUseContracts,
} from "./command-contract";

const VERSION = "0.1.0";
const BINDING_FAIL_CLOSED_EXIT_CODE = 20;
const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const NOT_IMPLEMENTED_EXIT_CODE = 1;

const quietDiagnosticWriter: CliWriter = { write: () => true };

// One-line pointer the help surface uses to send agents back to the
// route-bound prerequisites without copying route evidence schemas (R17, U3
// scenario 8). browser-use never re-declares the route envelope shape.
const ROUTE_PREREQUISITE_POINTER =
	"Prerequisite: get route evidence from `browser-adapter-router prepare` then `browser-adapter-router route` (--route).";

export type BrowserUseRuntime = {
	env: Record<string, string | undefined>;
	now: () => number;
};

export function createDefaultBrowserUseRuntime(
	overrides: Partial<BrowserUseRuntime> = {},
): BrowserUseRuntime {
	return {
		env: { ...process.env },
		now: () => Date.now(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// CLI driver. Mirrors browser-adapter-router.ts structure.
// ---------------------------------------------------------------------------

type OutputMode = "json" | "plain";

type ParsedBrowserUseCommand =
	| { kind: "help"; family?: BrowserUseFamily; command?: BrowserUseCommand }
	| { kind: "version"; outputMode: OutputMode }
	| {
			kind: "command";
			command: BrowserUseCommand;
			family: BrowserUseFamily;
			subcommand: string;
			outputMode: OutputMode;
			dryRun: boolean;
	  };

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
		configureCliDiagnostics({
			categoryRoot: "browser-use.cli",
			options: diagnosticArgv.options,
			diagnosticWriter: diagnosticArgv.options.quiet
				? quietDiagnosticWriter
				: stderr,
		});
		try {
			return emitCliError({
				error:
					error instanceof Error
						? usageError(error.message)
						: usageError("invalid diagnostic flags"),
				outputMode,
				stdout,
				stderr,
				runId: diagnosticArgv.options.runId,
				durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
			});
		} finally {
			resetCliDiagnostics();
		}
	}

	const outputMode = errorOutputMode(diagnosticArgv.argv);
	let parsed: ParsedBrowserUseCommand;
	try {
		parsed = parseBrowserUseArgv(diagnosticArgv.argv);
	} catch (error) {
		configureCliDiagnostics({
			categoryRoot: "browser-use.cli",
			options: diagnosticArgv.options,
			diagnosticWriter: diagnosticArgv.options.quiet
				? quietDiagnosticWriter
				: stderr,
		});
		try {
			return emitCliError({
				error,
				outputMode,
				stdout,
				stderr,
				runId: diagnosticArgv.options.runId,
				durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
			});
		} finally {
			resetCliDiagnostics();
		}
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
		return await withCliDiagnosticContext(context, () => {
			const runId = diagnosticArgv.options.runId;
			const durationMs = () =>
				runtime.now() - diagnosticArgv.options.startedAtMs;
			return executeCommand({
				parsed,
				runtime,
				stdout,
				stderr,
				runId,
				durationMs,
			});
		});
	} finally {
		resetCliDiagnostics();
	}
}

function executeCommand(input: {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: () => number;
}): number {
	const { parsed, runtime } = input;
	const resultKind: ResultKind =
		parsed.family === "targets" ? "browser_targets" : "browser_operation";

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

type ResultKind = "browser_targets" | "browser_operation";

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
			error: {
				run_id: input.runId,
				code,
				message,
				exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
				severity: "error",
				recoverability: "change_input",
				retryable: false,
				failure_domain: "browser_use",
			},
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
			error: {
				run_id: input.runId,
				code,
				message,
				exit_code: NOT_IMPLEMENTED_EXIT_CODE,
				severity: "error",
				recoverability: "none",
				retryable: false,
				failure_domain: "browser_use",
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return NOT_IMPLEMENTED_EXIT_CODE;
}

function writeVersion(
	stdout: CliWriter,
	outputMode: OutputMode,
	runtime: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		stdout.write(`browser-use ${VERSION}\n`);
		return;
	}
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: runtime.runId,
			data: { name: "browser-use", version: VERSION },
		}),
		runtime,
	);
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
			error: {
				run_id: input.runId,
				code: isUsage ? "usage_error" : "runtime_error",
				message: safeMessage,
				exit_code: exitCode,
				severity: isUsage ? "error" : "fatal",
				recoverability: isUsage ? "change_input" : "none",
				retryable: false,
				failure_domain: isUsage ? "input" : "runtime_diagnostics",
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return exitCode;
}

// ---------------------------------------------------------------------------
// Argv parsing.
// ---------------------------------------------------------------------------

function parseBrowserUseArgv(
	argv: readonly string[],
): ParsedBrowserUseCommand {
	if (argv.includes("--version")) {
		return {
			kind: "version",
			outputMode: argv.includes("--json") ? "json" : "plain",
		};
	}

	const helpRequested = argv.includes("-h") || argv.includes("--help");

	// Resolve family/subcommand POSITIONALLY from the leading non-flag tokens.
	// The public form is `browser-use <family> <subcommand> [flags]`. Scanning
	// the whole argv by value (argv.find) would misread a flag VALUE equal to a
	// reserved word (e.g. `--state status`, `--origin targets`) as the
	// family/subcommand. Diagnostic flags are already stripped upstream, so any
	// remaining `--`-prefixed token starts the flag section.
	const positionals: string[] = [];
	for (const arg of argv) {
		if (arg.startsWith("-")) break;
		positionals.push(arg);
	}
	const familyToken = positionals[0];
	const family = isFamily(familyToken) ? familyToken : undefined;

	if (!family) {
		if (helpRequested) return { kind: "help" };
		throw usageError("missing command family: expected targets or operate.");
	}

	const subcommandToken = positionals[1];
	const subcommand =
		subcommandToken && subcommandsFor(family).includes(subcommandToken)
			? subcommandToken
			: undefined;

	if (helpRequested) {
		if (!subcommand) return { kind: "help", family };
		return {
			kind: "help",
			family,
			command: toCommand(family, subcommand),
		};
	}

	if (!subcommand) {
		throw usageError(
			`missing subcommand for ${family}: expected ${subcommandsFor(family).join(", ")}.`,
		);
	}

	const command = toCommand(family, subcommand);
	// Strip exactly the two leading positional tokens, not every occurrence of
	// their string value, so a flag value equal to the family/subcommand word
	// survives into rejectUnknownFlags' value-pairing.
	const rest = argv.slice(2);
	const flags = browserUseContracts[command].flags ?? {};
	rejectUnknownFlags(rest, flags);
	const dryRun = rest.includes("--dry-run");

	return {
		kind: "command",
		command,
		family,
		subcommand,
		outputMode: outputModeFor(command, rest),
		dryRun,
	};
}

function isFamily(value: string | undefined): value is BrowserUseFamily {
	return (BROWSER_USE_FAMILIES as readonly string[]).includes(value ?? "");
}

function subcommandsFor(family: BrowserUseFamily): readonly string[] {
	return family === "targets"
		? BROWSER_USE_TARGETS_SUBCOMMANDS
		: BROWSER_USE_OPERATE_SUBCOMMANDS;
}

function toCommand(
	family: BrowserUseFamily,
	subcommand: string,
): BrowserUseCommand {
	return `${family}-${subcommand}` as BrowserUseCommand;
}

type FlagSpec = { type?: string };

function rejectUnknownFlags(
	argv: readonly string[],
	flags: Readonly<Record<string, FlagSpec>>,
): void {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
		const spec = flags[name];
		if (!spec) {
			throw usageError(`unknown option: ${sanitizeUsageValue(name)}`);
		}
		// Consume the value token for space-separated value-bearing flags. Use the
		// declared flag type, not the next token's shape, so a value that itself
		// starts with `--` (e.g. `--title-contains --beta`) is still its value and
		// is not misread as a separate unknown flag.
		if (!arg.includes("=") && spec.type !== "boolean" && index + 1 < argv.length) {
			index += 1;
		}
	}
}

// Output mode keys on the resolved command, then explicit flags. status is a
// human projection (plain default); every other command is machine-first JSON.
// Keying on the command (not an argv token scan) keeps a flag VALUE of "status"
// from flipping output mode.
function outputModeFor(
	command: BrowserUseCommand,
	rest: readonly string[],
): OutputMode {
	if (rest.includes("--plain")) return "plain";
	if (rest.includes("--json")) return "json";
	return command === "targets-status" ? "plain" : "json";
}

// Output mode for pre-parse error paths (diagnostic-parse or command-parse
// failure) where no command is resolved yet. Flag-only; default JSON so an
// agent can machine-read the error explaining what went wrong.
function errorOutputMode(argv: readonly string[]): OutputMode {
	if (argv.includes("--plain")) return "plain";
	return "json";
}

function applyEnvRunId(
	argv: readonly string[],
	runId: string | undefined,
): readonly string[] {
	if (!runId) return argv;
	if (argv.includes("--run-id")) return argv;
	return [...argv, "--run-id", runId];
}

// ---------------------------------------------------------------------------
// Redaction + help.
// ---------------------------------------------------------------------------

function sanitizeUsageValue(value: string): string {
	if (
		value.startsWith("/") ||
		value.startsWith("~/") ||
		value.startsWith("op://") ||
		hasSensitiveOptionName(value)
	) {
		return "[redacted]";
	}
	return redactUnsafeText(value);
}

function redactUnsafeText(value: string): string {
	return value
		.replace(/\bop:\/\/\S+/gi, "[redacted]")
		.replace(/--[A-Za-z0-9][\w-]*(?:=\S*)?/g, (match) =>
			hasSensitiveOptionName(match) ? "[redacted]" : match,
		)
		.replace(/(^|[\s:(])(?:~\/|\/)\S+/g, "$1[redacted]");
}

function hasSensitiveOptionName(value: string): boolean {
	return /(?:password|passwd|passphrase|secret|token|api[-_]?key|credential|auth|cookie|session)/i.test(
		value,
	);
}

function renderHelp(
	family?: BrowserUseFamily,
	command?: BrowserUseCommand,
): string {
	if (command) {
		return `${renderCommandUsage(browserUseContracts[command])}\n${ROUTE_PREREQUISITE_POINTER}\n`;
	}
	if (family) return renderFamilyHelp(family);
	return renderRootHelp();
}

function renderFamilyHelp(family: BrowserUseFamily): string {
	const subLines = subcommandsFor(family).map((sub) => {
		const contract = browserUseContracts[toCommand(family, sub)];
		return `  ${sub.padEnd(10)} ${contract.summary}`;
	});
	return [
		`Usage: browser-use ${family} <subcommand> [flags]`,
		"",
		"Subcommands:",
		...subLines,
		"",
		ROUTE_PREREQUISITE_POINTER,
		"",
	].join("\n");
}

function renderRootHelp(): string {
	const familyLines = BROWSER_USE_FAMILIES.map((family) => {
		const summary =
			family === "targets"
				? "Browser Target Discovery, Selection, and status."
				: "Browser Operations: snapshot, screenshot, emulate.";
		return `  ${family.padEnd(8)} ${summary}`;
	});
	return [
		"Usage: browser-use <family> <subcommand> [flags]",
		"",
		"Command families:",
		...familyLines,
		"",
		"Global diagnostic flags:",
		"  --run-id <id>   Set run correlation id.",
		"  --quiet         Suppress diagnostics.",
		"  --verbose       Emit info diagnostics to stderr.",
		"  --debug         Emit debug diagnostics to stderr.",
		"  --version       Print version.",
		"",
		ROUTE_PREREQUISITE_POINTER,
		"",
	].join("\n");
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
};

if (import.meta.main) {
	const exitCode = await runBrowserUseCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
