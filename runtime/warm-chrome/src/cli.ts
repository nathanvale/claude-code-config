#!/usr/bin/env bun

// U4 chassis: facade-backed entrypoint, ADR-0010 envelope wiring, diagnostics,
// and the redaction chokepoints. U5 wires the real `check` proof chain into
// `defaultCommandHandlers`; U6 (launch) and U7 (repair) replace the remaining
// typed dispatch stubs.

import {
	type CliDiagnosticRedactor,
	type CliDiagnosticSerializableRecord,
	type CliStructuredRuntimeErrorBuilderInput,
	CliUsageError,
	type CliWriter,
	type CommandFacadeActionAffordance,
	configureCliDiagnostics,
	createCliDiagnosticContext,
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	emitCliDiagnostic,
	getCliDiagnosticDurationMs,
	type ParsedCliDiagnosticArgv,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	redactGenericCliDiagnosticRecord,
	renderCommandUsage,
	resetCliDiagnostics,
	type RuntimeActionGuidance,
	type RuntimeContinuationConstraint,
	type RuntimeContinuationGuidance,
	usageError,
	withCliDiagnosticContext,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";

import {
	warmChromeContractEntries,
	warmChromeContracts,
	warmChromeFailureActions,
	warmChromeSuccessActions,
} from "./command-contract.ts";
import {
	WARM_CHROME_CLI_NAME,
	WARM_CHROME_COMMANDS,
	WARM_CHROME_CONTRACT_ID,
	WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID,
	WARM_CHROME_SCHEMA_VERSION,
	type WarmChromeCommand,
	type WarmChromeRuntimeActionId,
} from "./model.ts";
import {
	createCheckCommandHandler,
	nonLoopbackEndpointError,
} from "./proof.ts";
import { createLaunchCommandHandler } from "./launch.ts";
import { createRepairCommandHandler } from "./repair.ts";
import {
	createDefaultRuntime,
	expandHome,
	REAL_GOOGLE_CHROME_BINARY,
	WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER,
	type WarmChromeFailureDomain,
	type WarmChromeRuntime,
	WarmChromeRuntimeError,
	redactWsUrlsDeep,
} from "./runtime.ts";

const VERSION = "0.1.0";
const DEFAULT_PORT = "9222";
const DEFAULT_PROFILE_DIR = "~/.agent-warm-profile";
const CHROME_REMOTE_DEBUGGING_DOCS_URL =
	"https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session";
const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;

type OutputMode = "json" | "plain";
type ExecutableCommand = Exclude<WarmChromeCommand, "status">;

/**
 * Parsed execute invocation handed to a command handler.
 */
export type WarmChromeExecuteInvocation = {
	/** Command that executes (`status` resolves to `check`). */
	command: ExecutableCommand;
	/** Command as invoked, including the `status` presentation alias. */
	displayCommand: WarmChromeCommand;
	outputMode: OutputMode;
	endpoint: string;
	port: string;
	profileInput?: string;
	chromeBin: string;
};

type ParsedWarmChromeArgv =
	| { kind: "help"; command?: WarmChromeCommand }
	| { kind: "version" }
	| ({ kind: "execute" } & WarmChromeExecuteInvocation);

/**
 * Success payload a command handler returns; the chassis owns the envelope.
 *
 * `data` is the structured JSON output channel: it carries the verified
 * websocket URL intact (R13 ok-envelope exemption) and must include the
 * package result contract metadata (`contract_id`, `schema_version`).
 */
export type WarmChromeCommandSuccess = {
	data: Record<string, unknown>;
	/** Stable plain rendering; the chassis appends run correlation tokens. */
	plain: string;
	runtimeActions: readonly RuntimeActionGuidance[];
	continuation: RuntimeContinuationGuidance & { next_action_id: string };
};

/**
 * Command handler seam U5-U7 implement. Failures are thrown
 * {@link WarmChromeRuntimeError} (or facade usage errors); the chassis maps
 * them to structured error envelopes.
 */
export type WarmChromeCommandHandler = (
	invocation: WarmChromeExecuteInvocation,
	runtime: WarmChromeRuntime,
) => Promise<WarmChromeCommandSuccess>;

/**
 * Dispatch registry keyed by executable command id.
 */
export type WarmChromeCommandHandlers = Record<
	ExecutableCommand,
	WarmChromeCommandHandler
>;

function notYetImplementedHandler(
	command: ExecutableCommand,
	owner: string,
): WarmChromeCommandHandler {
	return async () => {
		throw new WarmChromeRuntimeError(
			"not_implemented",
			`warm-chrome ${command} is not implemented yet; implementation unit ${owner} lands this handler.`,
			{
				exitCode: RUNTIME_FAILURE_EXIT_CODE,
				severity: "error",
				recoverability: "none",
				failureDomain: "runtime_diagnostics",
				hintSummary: "Stop and inspect diagnostics.",
			},
		);
	};
}

/**
 * U4 dispatch stubs. U5 replaces `check`, U6 replaces `launch`, U7 replaces
 * `repair`; each stub emits a runtime-failure-style envelope with exit 1.
 */
export const notYetImplementedHandlers: WarmChromeCommandHandlers = {
	check: notYetImplementedHandler("check", "U5"),
	launch: notYetImplementedHandler("launch", "U6"),
	repair: notYetImplementedHandler("repair", "U7"),
};

/**
 * Default dispatch registry: `check` (and its `status` presentation alias)
 * runs the U5 proof chain, `launch` the U6 lifecycle, `repair` the U7
 * lifecycle.
 */
export const defaultCommandHandlers: WarmChromeCommandHandlers = {
	check: createCheckCommandHandler(),
	launch: createLaunchCommandHandler(),
	repair: createRepairCommandHandler(),
};

/**
 * Injectable dependencies for {@link main}; tests replace runtime, handlers,
 * and writers to run the full entrypoint in-process.
 */
export type WarmChromeMainDeps = {
	runtime?: WarmChromeRuntime;
	handlers?: Partial<WarmChromeCommandHandlers>;
	stdout?: CliWriter;
	stderr?: CliWriter;
};

const quietDiagnosticWriter: CliWriter = { write: () => true };

/**
 * Diagnostic redactor for every warm-chrome LogTape sink (plan U4 R13).
 *
 * Applies the websocket-URL path-prefix reduction before the facade's generic
 * secret redaction, so no diagnostic record — visible stream or post-mortem
 * buffer flush — can carry a full `webSocketDebuggerUrl`.
 */
export const warmChromeDiagnosticRedactor: CliDiagnosticRedactor = (record) =>
	redactGenericCliDiagnosticRecord(
		redactWsUrlsDeep(record) as CliDiagnosticSerializableRecord,
	);

/**
 * CLI entry point.
 *
 * @param argv - Process argv tail after the executable name
 * @param deps - Runtime seam, handler registry, and writers for tests
 * @returns Process exit code
 *
 * @example
 * ```typescript
 * const exitCode = await main(["check", "--json"], { runtime, handlers })
 * ```
 */
export async function main(
	argv: readonly string[],
	deps: WarmChromeMainDeps = {},
): Promise<number> {
	const runtime = deps.runtime ?? createDefaultRuntime();
	const handlers: WarmChromeCommandHandlers = {
		...defaultCommandHandlers,
		...deps.handlers,
	};
	const stdout = deps.stdout ?? process.stdout;
	const stderr = deps.stderr ?? process.stderr;

	const diagnosticInput = applyEnvRunId(argv, runtime.env.WARM_CHROME_RUN_ID);
	let diagnosticArgv: ParsedCliDiagnosticArgv;
	try {
		diagnosticArgv = parseCliDiagnosticArgv(diagnosticInput);
	} catch (error) {
		diagnosticArgv = parseCliDiagnosticFallbackArgv(diagnosticInput);
		const outputMode = inferOutputMode(argv);
		configureDiagnostics(diagnosticArgv, stderr);
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

	configureDiagnostics(diagnosticArgv, stderr);
	try {
		const context = createCliDiagnosticContext(diagnosticArgv.options);
		return await withCliDiagnosticContext(context, async () => {
			const outputMode = inferOutputMode(diagnosticArgv.argv);
			try {
				const parsed = parseWarmChromeArgv(diagnosticArgv.argv, runtime);
				if (parsed.kind === "help") {
					stdout.write(renderHelp(parsed.command));
					return 0;
				}
				if (parsed.kind === "version") {
					stdout.write(`${WARM_CHROME_CLI_NAME} ${VERSION}\n`);
					return 0;
				}

				emitCliDiagnostic(WARM_CHROME_CLI_NAME, "info", "command-start", {
					command: parsed.displayCommand,
					phase: "start",
					port: parsed.port,
				});
				const success = await handlers[parsed.command](parsed, runtime);
				writeSuccess(stdout, parsed.outputMode, success, {
					runId: diagnosticArgv.options.runId,
					durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
				});
				return 0;
			} catch (error) {
				return emitCliError({
					error,
					outputMode,
					stdout,
					stderr,
					runId: diagnosticArgv.options.runId,
					durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
				});
			}
		});
	} finally {
		resetCliDiagnostics();
	}
}

function configureDiagnostics(
	diagnosticArgv: ParsedCliDiagnosticArgv,
	stderr: CliWriter,
): void {
	configureCliDiagnostics({
		categoryRoot: WARM_CHROME_CLI_NAME,
		options: diagnosticArgv.options,
		diagnosticWriter: diagnosticArgv.options.quiet
			? quietDiagnosticWriter
			: stderr,
		redact: warmChromeDiagnosticRedactor,
	});
}

function applyEnvRunId(
	argv: readonly string[],
	envRunId: string | undefined,
): readonly string[] {
	if (
		!envRunId ||
		argv.some((arg) => arg === "--run-id" || arg.startsWith("--run-id="))
	) {
		return argv;
	}
	return ["--run-id", envRunId, ...argv];
}

function inferOutputMode(argv: readonly string[]): OutputMode {
	let outputMode: OutputMode = argv[0] === "status" ? "plain" : "json";
	for (const arg of argv) {
		if (arg === "--json") outputMode = "json";
		if (arg === "--plain") outputMode = "plain";
	}
	return outputMode;
}

function parseWarmChromeArgv(
	argv: readonly string[],
	runtime: WarmChromeRuntime,
): ParsedWarmChromeArgv {
	if (argv.includes("--help") || argv.includes("-h")) {
		return { kind: "help", ...helpCommand(findCommand(argv)) };
	}
	if (argv.includes("--version")) {
		return { kind: "version" };
	}

	const args = [...argv];
	let displayCommand: WarmChromeCommand = "check";
	if (args[0] && !args[0].startsWith("-")) {
		const candidate = args.shift();
		if (candidate === "help") {
			return { kind: "help", ...helpCommand(findCommand(args)) };
		}
		if (!isWarmChromeCommand(candidate)) {
			throw usageError(`unknown command: ${candidate}`);
		}
		displayCommand = candidate;
	}

	const command: ExecutableCommand =
		displayCommand === "status" ? "check" : displayCommand;
	let outputMode: OutputMode = displayCommand === "status" ? "plain" : "json";
	let port = "";
	let endpoint = "";
	let profileInput =
		typeof runtime.env.WARM_CHROME_PROFILE_DIR === "string"
			? runtime.env.WARM_CHROME_PROFILE_DIR
			: undefined;
	let chromeBin = runtime.env.CHROME_BIN ?? REAL_GOOGLE_CHROME_BINARY;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--json":
				outputMode = "json";
				break;
			case "--plain":
				outputMode = "plain";
				break;
			case "--port":
				port = requireNext(args, index, "--port");
				index += 1;
				break;
			case "--endpoint":
				endpoint = requireNext(args, index, "--endpoint");
				index += 1;
				break;
			case "--profile":
				profileInput = requireNext(args, index, "--profile");
				index += 1;
				break;
			case "--chrome":
				chromeBin = requireNext(args, index, "--chrome");
				index += 1;
				break;
			default:
				if (arg.startsWith("--port=")) {
					port = requireInlineValue(arg, "--port");
				} else if (arg.startsWith("--endpoint=")) {
					endpoint = requireInlineValue(arg, "--endpoint");
				} else if (arg.startsWith("--profile=")) {
					profileInput = requireInlineValue(arg, "--profile");
				} else if (arg.startsWith("--chrome=")) {
					chromeBin = requireInlineValue(arg, "--chrome");
				} else if (arg.startsWith("-")) {
					throw usageError(`unknown option: ${arg}`);
				} else {
					throw usageError(`unexpected argument: ${arg}`);
				}
		}
	}

	if (command !== "launch" && hasChromeFlag(args)) {
		throw usageError("--chrome is only valid with launch");
	}
	// The contract declares --port and --endpoint mutually exclusive in every
	// usage line; the parser enforces it here with exit 2 (plan U2/U4).
	if (port !== "" && endpoint !== "") {
		throw usageError("--port and --endpoint are mutually exclusive");
	}

	const normalized = normalizeEndpoint({
		port:
			port ||
			(endpoint ? "" : runtime.env.WARM_CHROME_CDP_PORT || DEFAULT_PORT),
		endpoint,
	});

	if (command === "launch" && !profileInput) {
		profileInput = DEFAULT_PROFILE_DIR;
	}

	return {
		kind: "execute",
		command,
		displayCommand,
		outputMode,
		...normalized,
		...(profileInput === undefined ? {} : { profileInput }),
		chromeBin: expandHome(chromeBin, runtime.env),
	};
}

function helpCommand(
	command: WarmChromeCommand | undefined,
): { command?: WarmChromeCommand } {
	return command === undefined ? {} : { command };
}

function hasChromeFlag(args: readonly string[]): boolean {
	return args.some((arg) => arg === "--chrome" || arg.startsWith("--chrome="));
}

function requireNext(
	args: readonly string[],
	index: number,
	flag: string,
): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw usageError(`${flag} requires a value`);
	}
	return value;
}

function requireInlineValue(arg: string, flag: string): string {
	const value = arg.slice(`${flag}=`.length);
	if (value === "") {
		throw usageError(`${flag} requires a value`);
	}
	return value;
}

function normalizeEndpoint(input: { port: string; endpoint: string }): {
	endpoint: string;
	port: string;
} {
	if (!input.endpoint) {
		assertPort(input.port, "port");
		return { endpoint: `http://127.0.0.1:${input.port}`, port: input.port };
	}

	let parsed: URL;
	try {
		parsed = new URL(input.endpoint);
	} catch {
		throw usageError("--endpoint must be a valid URL");
	}
	if (parsed.protocol !== "http:") {
		throw usageError("--endpoint must use http");
	}
	if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
		// Canonical station code (check.non_loopback, reason
		// non_loopback_endpoint); the proof chain owns the localhost-alias case.
		throw nonLoopbackEndpointError();
	}
	if (!parsed.port) {
		throw usageError("--endpoint must include a port");
	}
	assertPort(parsed.port, "endpoint port");
	return {
		endpoint: `http://${parsed.hostname}:${parsed.port}`,
		port: parsed.port,
	};
}

function assertPort(value: string, label: string): void {
	if (!/^[0-9]+$/.test(value)) {
		throw usageError(`${label} must be numeric`);
	}
	const numeric = Number(value);
	if (numeric < 1 || numeric > 65535) {
		throw usageError(`${label} must be between 1 and 65535`);
	}
}

function renderHelp(command?: WarmChromeCommand): string {
	if (command) return renderCommandUsage(warmChromeContracts[command]);
	const commandLines = warmChromeContractEntries.map(
		([name, contract]) => `  ${name.padEnd(8)} ${contract.summary}`,
	);
	return [
		`Usage: ${WARM_CHROME_CLI_NAME} <command> [flags]`,
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

function findCommand(
	argv: readonly string[],
): WarmChromeCommand | undefined {
	return argv.find(isWarmChromeCommand);
}

function isWarmChromeCommand(
	value: string | undefined,
): value is WarmChromeCommand {
	return (
		value !== undefined &&
		(WARM_CHROME_COMMANDS as readonly string[]).includes(value)
	);
}

// R13 ok-envelope exemption: the structured JSON output channel is the one
// surface that carries the verified websocket URL intact. Handler `data`
// passes through untouched here; every diagnostic sink goes through
// `warmChromeDiagnosticRedactor` instead.
function writeSuccess(
	stdout: CliWriter,
	outputMode: OutputMode,
	success: WarmChromeCommandSuccess,
	run: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		stdout.write(
			`${success.plain} run_id=${run.runId} duration_ms=${run.durationMs}\n`,
		);
		return;
	}
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: run.runId,
			data: success.data,
			runtime_actions: [...success.runtimeActions],
			continuation: success.continuation,
		}),
		run,
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
	const error = normalizeError(input.error);
	emitCliDiagnostic(WARM_CHROME_CLI_NAME, "error", error.code, {
		code: error.code,
		exit_code: error.exitCode,
		duration_ms: getCliDiagnosticDurationMs(),
	});
	const guidance = guidanceForError(error);

	if (input.outputMode === "plain") {
		input.stderr.write(
			`${error.failureDomain} ${error.code}: ${error.message} action=${guidance.continuation.next_action_id} (run_id=${input.runId})\n`,
		);
		return error.exitCode;
	}

	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: error.exitCode,
			error: createCliRuntimeError(
				structuredErrorInput(input.runId, error),
			),
			// Every error envelope self-describes its result contract (R12); the
			// chassis owns the merge so station evidence can observe the contract
			// id even on chassis-owned stations (invalid_usage, runtime_failure).
			data: {
				contract_id: WARM_CHROME_CONTRACT_ID,
				schema_version: WARM_CHROME_SCHEMA_VERSION,
				...error.data,
			},
			runtime_actions: guidance.runtimeActions,
			continuation: guidance.continuation,
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return error.exitCode;
}

// Last-resort net for a rejection or exception that escapes the run boundary.
// The tool's contract is "every outcome is a structured envelope"; a raw stack
// dump from an unhandled rejection would break it.
export function emitUnhandledFailureEnvelope(
	error: unknown,
	options: { runId: string; stdout: CliWriter; stderr?: CliWriter },
): number {
	return emitCliError({
		error,
		outputMode: "json",
		stdout: options.stdout,
		stderr: options.stderr ?? quietDiagnosticWriter,
		runId: options.runId,
		durationMs: 0,
	});
}

type NormalizedWarmChromeError = {
	code: string;
	message: string;
	exitCode: number;
	severity: "warning" | "error" | "fatal";
	recoverability: "none" | "change_input" | "repair_state";
	hintSummary: string;
	hintAction: "change_input" | "repair_state" | undefined;
	hintDocsUrl?: string;
	failureDomain: WarmChromeFailureDomain;
	primaryActionId?: "inspect_listener";
	secondaryActionIds?: readonly WarmChromeRuntimeActionId[];
	data?: Record<string, unknown>;
	runtimeActions: RuntimeActionGuidance[];
};

function normalizeError(error: unknown): NormalizedWarmChromeError {
	if (error instanceof CliUsageError) {
		return {
			code: "invalid_usage",
			message: error.options.showMessage
				? sanitizeUsageMessage(error.message)
				: "help requested",
			exitCode: error.options.exitCode ?? USAGE_EXIT_CODE,
			severity: "warning",
			recoverability: "change_input",
			hintSummary: "Fix CLI arguments, then rerun the command.",
			hintAction: "change_input",
			failureDomain: "input",
			runtimeActions: [],
		};
	}
	if (error instanceof WarmChromeRuntimeError) {
		const hint = hintForRuntimeError(error);
		const recoverability = error.options.recoverability ?? hint.recoverability;
		const failureDomain =
			error.options.failureDomain ?? failureDomainForRuntimeError(error);
		const exitCode =
			error.options.exitCode ??
			(failureDomain === "input" ? USAGE_EXIT_CODE : error.exitCode);
		const hintDocsUrl = error.options.hintDocsUrl ?? hint.docsUrl;
		return {
			code: error.code,
			message: error.message,
			exitCode,
			severity: error.options.severity ?? "error",
			recoverability,
			hintSummary: error.options.hintSummary ?? hint.summary,
			hintAction: error.options.hintAction ?? hint.action,
			...(hintDocsUrl ? { hintDocsUrl } : {}),
			failureDomain,
			...(error.options.primaryActionId
				? { primaryActionId: error.options.primaryActionId }
				: {}),
			...(error.options.secondaryActionIds?.length
				? { secondaryActionIds: error.options.secondaryActionIds }
				: {}),
			...(error.options.data ? { data: error.options.data } : {}),
			runtimeActions: [],
		};
	}
	// A raw escaping error is untrusted: its message never reaches the
	// envelope or diagnostics (R13 leak surface), only this fixed text does.
	return {
		code: "runtime_failure",
		message: "warm-chrome hit an unexpected runtime failure.",
		exitCode: RUNTIME_FAILURE_EXIT_CODE,
		severity: "fatal",
		recoverability: "none",
		hintSummary: "Stop and inspect diagnostics.",
		hintAction: undefined,
		failureDomain: "runtime_diagnostics",
		runtimeActions: [warmChromeRuntimeAction("inspect_diagnostics")],
	};
}

function failureDomainForRuntimeError(
	error: WarmChromeRuntimeError,
): WarmChromeFailureDomain {
	if (error.exitCode === RUNTIME_FAILURE_EXIT_CODE) {
		return "runtime_diagnostics";
	}
	return "browser_entry_handoff";
}

function structuredErrorInput(
	runId: string,
	error: NormalizedWarmChromeError,
): CliStructuredRuntimeErrorBuilderInput {
	const base = {
		run_id: runId,
		code: error.code,
		message: error.message,
		exit_code: error.exitCode,
		severity: error.severity,
		failure_domain: error.failureDomain,
	};
	const hintBase = {
		summary: error.hintSummary,
		...(error.hintDocsUrl ? { docs_url: error.hintDocsUrl } : {}),
	};
	switch (error.recoverability) {
		case "change_input":
			return {
				...base,
				recoverability: "change_input",
				retryable: false,
				hint: {
					...hintBase,
					...(error.hintAction === "change_input"
						? { action: "change_input" as const }
						: {}),
				},
			};
		case "repair_state":
			return {
				...base,
				recoverability: "repair_state",
				retryable: false,
				hint: {
					...hintBase,
					...(error.hintAction === "repair_state"
						? { action: "repair_state" as const }
						: {}),
				},
			};
		case "none":
			return {
				...base,
				recoverability: "none",
				retryable: false,
				hint: hintBase,
			};
	}
}

function sanitizeUsageMessage(message: string): string {
	if (message.startsWith("unexpected argument: ")) {
		return `unexpected argument: ${sanitizeUsageValue(
			message.slice("unexpected argument: ".length),
		)}`;
	}
	if (message.startsWith("unknown option: ")) {
		return `unknown option: ${sanitizeUsageValue(
			message.slice("unknown option: ".length),
		)}`;
	}
	return redactUnsafeText(message);
}

function sanitizeUsageValue(value: string): string {
	if (isUnsafeUsageValue(value)) return "[redacted]";
	return redactUnsafeText(value);
}

function isUnsafeUsageValue(value: string): boolean {
	return (
		value.startsWith("/") ||
		value.startsWith("~/") ||
		value.startsWith("op://") ||
		hasSensitiveOptionName(value)
	);
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

function hintForRuntimeError(error: WarmChromeRuntimeError): {
	summary: string;
	action: "change_input" | "repair_state" | undefined;
	docsUrl?: string;
	recoverability: "none" | "change_input" | "repair_state";
} {
	// Canonical check codes carry their hints from proof.ts's per-code
	// envelope options; this switch is the fallback for codes thrown without
	// an explicit hintSummary.
	switch (error.code) {
		case "endpoint_unreachable":
			return {
				summary:
					"Remote debugging is off; enable it in chrome://inspect/#remote-debugging, then rerun warm-chrome check.",
				action: "repair_state",
				docsUrl: CHROME_REMOTE_DEBUGGING_DOCS_URL,
				recoverability: "repair_state",
			};
		case "listener_uninspectable":
		case "listener_mismatch":
			return {
				summary: "Stop and inspect the CDP listener before adapter work.",
				action: "repair_state",
				recoverability: "repair_state",
			};
		default:
			return {
				summary:
					"Run warm-chrome launch to prepare Warm Chrome, then rerun the failed command.",
				action: "repair_state",
				recoverability: "repair_state",
			};
	}
}

/**
 * The no_adapter_fallback continuation constraint (plan U4 R12).
 *
 * Shared helper so every exit-20 envelope spells the constraint identically;
 * U5-U7 handlers never build it by hand.
 */
export function noAdapterFallbackConstraint(): RuntimeContinuationConstraint {
	return {
		id: WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID,
		summary:
			"Do not switch adapters or use a cold browser after a Warm Chrome browser-entry failure.",
		forbidden_action_ids: ["adapter_fallback", "cold_browser_fallback"],
	};
}

// Single predicate that owns the no_adapter_fallback decision. Every exit-20
// envelope carries the constraint (R12); wrong_browser carries it even when
// it surfaces in another domain with a different exit code — a non-Google
// Chrome carries the same cold-browser/adapter-fallback temptation as a
// browser_entry_handoff, so "input was wrong" is never permission to drive
// the wrong Chrome.
function forbidsAdapterFallback(error: NormalizedWarmChromeError): boolean {
	return (
		error.exitCode === WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER ||
		error.failureDomain === "browser_entry_handoff" ||
		error.code === "wrong_browser"
	);
}

function guidanceForError(error: NormalizedWarmChromeError): {
	runtimeActions: RuntimeActionGuidance[];
	continuation: RuntimeContinuationGuidance & { next_action_id: string };
} {
	const primaryActions =
		error.runtimeActions.length > 0
			? error.runtimeActions
			: [primaryRuntimeActionForError(error)];
	// A post-spawn failure whose reason is a check-failure reason keeps that
	// check station's primary action as a secondary entry (plan: the agent
	// must not lose a known-good repair action at its deepest point).
	const secondaryActions = (error.secondaryActionIds ?? [])
		.filter(
			(id): id is WarmChromeRuntimeActionId =>
				warmChromeRuntimeActionById.has(id) &&
				!primaryActions.some((action) => action.id === id),
		)
		.map((id) => warmChromeRuntimeAction(id));
	const runtimeActions = [...primaryActions, ...secondaryActions];
	const nextActionId = runtimeActions[0]?.id;
	if (!nextActionId) {
		throw new Error("Warm Chrome guidance must emit one runtime action.");
	}
	const continuation = { next_action_id: nextActionId };
	return {
		runtimeActions,
		continuation: forbidsAdapterFallback(error)
			? { ...continuation, constraints: [noAdapterFallbackConstraint()] }
			: continuation,
	};
}

const warmChromeRuntimeActionById = new Map<string, CommandFacadeActionAffordance>(
	[...warmChromeFailureActions, ...warmChromeSuccessActions].map((action) => [
		action.id,
		action,
	]),
);

/**
 * Resolve a contract-declared runtime action affordance into Runtime Action
 * Guidance. U5-U7 handlers use this instead of restating summaries.
 */
export function warmChromeRuntimeAction(
	id: WarmChromeRuntimeActionId,
): RuntimeActionGuidance & { id: WarmChromeRuntimeActionId } {
	const action = warmChromeRuntimeActionById.get(id);
	if (!action) {
		throw new Error(`Unknown Warm Chrome runtime action: ${id}`);
	}
	return {
		id,
		summary: action.summary,
		side_effects: [
			...action.sideEffects,
		] as RuntimeActionGuidance["side_effects"],
	};
}

function primaryRuntimeActionForError(
	error: NormalizedWarmChromeError,
): RuntimeActionGuidance {
	if (error.failureDomain === "runtime_diagnostics") {
		return warmChromeRuntimeAction("inspect_diagnostics");
	}
	// An explicit per-error override wins when the code alone is ambiguous
	// (e.g. endpoint_unreachable after Chrome spawned: inspect that listener).
	if (error.primaryActionId === "inspect_listener") {
		return warmChromeRuntimeAction("inspect_listener");
	}
	if (error.code === "port_occupied_foreign") {
		return warmChromeRuntimeAction("rerun_with_explicit_port");
	}
	if (
		error.recoverability === "change_input" &&
		error.failureDomain === "input"
	) {
		return warmChromeRuntimeAction("change_input");
	}
	switch (error.code) {
		case "endpoint_unreachable":
			return warmChromeRuntimeAction("launch_warm_chrome");
		case "unsafe_profile":
			return warmChromeRuntimeAction("repair_profile");
		case "listener_mismatch":
		case "listener_uninspectable":
			return warmChromeRuntimeAction("inspect_listener");
		default:
			return warmChromeRuntimeAction("launch_warm_chrome");
	}
}

function handleUnhandledFailure(error: unknown): never {
	// Configure a minimal diagnostic context so the shared error machinery has a
	// sink; without it emitCliDiagnostic would throw inside the last-resort net.
	try {
		configureCliDiagnostics({
			categoryRoot: WARM_CHROME_CLI_NAME,
			options: parseCliDiagnosticFallbackArgv([]).options,
			diagnosticWriter: quietDiagnosticWriter,
			redact: warmChromeDiagnosticRedactor,
		});
	} catch {
		// best effort — never let net-of-last-resort setup mask the real error
	}
	const runId = process.env.WARM_CHROME_RUN_ID ?? "unhandled";
	const exitCode = emitUnhandledFailureEnvelope(error, {
		runId,
		stdout: process.stdout,
		stderr: process.stderr,
	});
	process.exit(exitCode);
}

if (import.meta.main) {
	// Safety net: a rejection or exception escaping main must still emit the
	// structured envelope this tool's contract promises, not a raw stack dump
	// with an ambiguous exit code. CLI, not a server — we always exit.
	process.on("unhandledRejection", (reason) => handleUnhandledFailure(reason));
	process.on("uncaughtException", (error) => handleUnhandledFailure(error));
	const exitCode = await main(Bun.argv.slice(2));
	process.exit(exitCode);
}
