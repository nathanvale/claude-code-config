#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CliUsageError,
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	type RuntimeActionGuidance,
	type RuntimeContinuationGuidance,
	configureCliDiagnostics,
	createCliDiagnosticContext,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	emitCliDiagnostic,
	getCliDiagnosticDurationMs,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	resetCliDiagnostics,
	usageError,
	validateStructuredRuntimeError,
	withCliDiagnosticContext,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_ADAPTER_PROOF_ADAPTERS,
	BROWSER_ADAPTER_PROOF_CONTRACT_ID,
	BROWSER_ADAPTER_PROOF_SCHEMA_VERSION,
	type BrowserAdapterProofAdapter,
	type BrowserAdapterProofBindingKind,
	type BrowserAdapterProofBindingStatus,
	type BrowserAdapterProofCommand,
	type BrowserAdapterProofConfigParseStatus,
	type BrowserAdapterProofConfigSourceLabel,
	type BrowserAdapterProofDiagnosticCode,
	browserAdapterProofContracts,
	browserAdapterProofFailureActions,
	browserAdapterProofSuccessActions,
} from "./command-contract";
import {
	createDefaultRuntime,
	runPreflightWarmChromeCli,
	type PreflightRuntime,
} from "./preflight-warm-chrome";

const VERSION = "0.1.0";
const DEFAULT_PORT = "9222";
const ADAPTER_PROOF_EXIT_CODE = 20;
const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const CHROME_DEVTOOLS_DOCS_URL =
	"https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session";
const ADAPTER_TIMEOUT_MS = {
	"chrome-devtools": 8000,
} as const satisfies Record<BrowserAdapterProofAdapter, number>;
const quietDiagnosticWriter: CliWriter = {
	write: () => true,
};

type OutputMode = "json" | "plain";
type CommandToExecute = Exclude<BrowserAdapterProofCommand, "status">;
type AdapterProofFailureDomain =
	| "browser_adapter_proof"
	| "browser_entry_handoff"
	| "input"
	| "runtime_diagnostics";
type AdapterProofRuntimeActionId =
	| (typeof browserAdapterProofFailureActions)[number]["id"]
	| (typeof browserAdapterProofSuccessActions)[number]["id"];
type AdapterProofRuntimeActionGuidance = RuntimeActionGuidance & {
	id: AdapterProofRuntimeActionId;
};

const adapterProofRuntimeActions = [
	...browserAdapterProofFailureActions,
	...browserAdapterProofSuccessActions,
] as const;
const adapterProofRuntimeActionById = new Map(
	adapterProofRuntimeActions.map((action) => [action.id, action]),
);

type ParsedAdapterProofCommand =
	| { kind: "help"; command?: BrowserAdapterProofCommand }
	| { kind: "version" }
	| {
			kind: "execute";
			commandName: CommandToExecute;
			displayCommandName: BrowserAdapterProofCommand;
			outputMode: OutputMode;
			adapter: BrowserAdapterProofAdapter;
			endpoint: string;
			port: string;
	  };

export type AdapterCommandInput = {
	command: string;
	args: readonly string[];
	timeoutMs: number;
};

export type AdapterCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut?: boolean;
};

export type AdapterProofRuntime = PreflightRuntime & {
	cwd: string;
	readTextFile: (path: string) => Promise<string>;
	runCommand: (input: AdapterCommandInput) => Promise<AdapterCommandResult>;
};

type WarmChromeProofResult =
	| {
			ok: true;
			runId: string;
			durationMs: number;
			proof: WarmChromeProofData;
	  }
	| {
			ok: false;
			runId: string;
			durationMs: number;
			exitCode: number;
			envelope: Record<string, unknown>;
	  };

type WarmChromeProofData = {
	action: string;
	endpoint: string;
	port: string;
	target_count?: number;
};

type AdapterBinding = {
	kind: BrowserAdapterProofBindingKind;
	status: BrowserAdapterProofBindingStatus;
	observed_port?: string;
	endpoint_host?: string;
};

type ConfigSourceDiagnostic = {
	source_label: BrowserAdapterProofConfigSourceLabel;
	scope?: "project" | "user" | "unknown";
	path_hint?: string;
	parse_status: BrowserAdapterProofConfigParseStatus;
	binding?: AdapterBinding;
	selected?: boolean;
	code?: BrowserAdapterProofDiagnosticCode;
	message?: string;
};

type AdapterWarning = {
	code: BrowserAdapterProofDiagnosticCode;
	severity: "warning";
	summary: string;
	docs_url?: string;
	source_label?: BrowserAdapterProofConfigSourceLabel;
	observed_port?: string;
};

type PageSummary = {
	id?: string;
	title?: string;
	url?: string;
};

type AdapterProof = {
	ok: true;
	action: "adapter_ready";
	contract: typeof BROWSER_ADAPTER_PROOF_CONTRACT_ID;
	schema_version: typeof BROWSER_ADAPTER_PROOF_SCHEMA_VERSION;
	command: BrowserAdapterProofCommand;
	adapter: BrowserAdapterProofAdapter;
	endpoint: string;
	port: string;
	warm_chrome_run_id: string;
	page_count: number;
	pages: PageSummary[];
	diagnostics: {
		selected_config_source?: BrowserAdapterProofConfigSourceLabel;
		selected_binding?: AdapterBinding;
		config_sources: ConfigSourceDiagnostic[];
		warnings: AdapterWarning[];
		phase_timings_ms: Record<string, number>;
	};
};

type AdapterProofRuntimeErrorOptions = {
	exitCode?: number;
	recoverability?: "none" | "retry" | "change_input" | "repair_state";
	hintSummary?: string;
	hintAction?: "retry" | "change_input" | "repair_state";
	hintDocsUrl?: string;
	severity?: "warning" | "error" | "fatal";
	failureDomain?: AdapterProofFailureDomain;
	primaryActionId?: AdapterProofRuntimeActionId;
	observedPort?: string;
	sourceLabel?: BrowserAdapterProofConfigSourceLabel;
};

class AdapterProofRuntimeError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly options: AdapterProofRuntimeErrorOptions = {},
	) {
		super(message);
		this.name = "AdapterProofRuntimeError";
	}

	get exitCode(): number {
		return this.options.exitCode ?? ADAPTER_PROOF_EXIT_CODE;
	}
}

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

export function createDefaultAdapterProofRuntime(
	overrides: Partial<AdapterProofRuntime> = {},
): AdapterProofRuntime {
	const base = createDefaultRuntime(overrides);
	return {
		...base,
		cwd: process.cwd(),
		readTextFile: (path: string) => readFile(path, "utf-8"),
		runCommand: (input: AdapterCommandInput) => runCommand(input),
		...overrides,
	};
}

export async function runPreflightBrowserAdapterCli(
	argv: readonly string[],
	options: {
		runtime?: AdapterProofRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultAdapterProofRuntime();
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const diagnosticInput = applyEnvRunId(argv, runtime.env.BROWSER_USE_RUN_ID);
	let diagnosticArgv: ParsedCliDiagnosticArgv;

	try {
		diagnosticArgv = parseCliDiagnosticArgv(diagnosticInput);
	} catch (error) {
		diagnosticArgv = parseCliDiagnosticFallbackArgv(diagnosticInput);
		const outputMode = inferOutputMode(argv);
		configureCliDiagnostics({
			categoryRoot: "browser-use.adapter-proof",
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

	const outputMode = inferOutputMode(diagnosticArgv.argv);
	let parsed: ParsedAdapterProofCommand;
	try {
		parsed = parseAdapterProofArgv(diagnosticArgv.argv, runtime);
	} catch (error) {
		configureCliDiagnostics({
			categoryRoot: "browser-use.adapter-proof",
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
		stdout.write(renderHelp(parsed.command));
		return 0;
	}
	if (parsed.kind === "version") {
		stdout.write(`preflight-browser-adapter ${VERSION}\n`);
		return 0;
	}

	const warmStartedAt = runtime.now();
	const warmChrome = await runWarmChromePreflight({
		parsed,
		runId: `${diagnosticArgv.options.runId}-warm-chrome`,
		runtime,
	});
	const warmDurationMs = runtime.now() - warmStartedAt;

	configureCliDiagnostics({
		categoryRoot: "browser-use.adapter-proof",
		options: diagnosticArgv.options,
		diagnosticWriter: diagnosticArgv.options.quiet
			? quietDiagnosticWriter
			: stderr,
	});

	try {
		const context = createCliDiagnosticContext(diagnosticArgv.options);
		return await withCliDiagnosticContext(context, async () => {
			if (!warmChrome.ok) {
				return emitWarmChromeFailure({
					warmChrome,
					outputMode: parsed.outputMode,
					stdout,
					stderr,
					runId: diagnosticArgv.options.runId,
					durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
				});
			}

			try {
				emitCliDiagnostic(
					"browser-use.adapter-proof",
					"info",
					"command-start",
					{
						command: parsed.displayCommandName,
						adapter: parsed.adapter,
						phase: "start",
						port: parsed.port,
						warm_chrome_run_id: warmChrome.runId,
					},
				);
				const proof = await executeAdapterProof({
					parsed,
					runtime,
					warmChrome,
					phaseTimings: {
						warm_chrome_preflight_ms: warmDurationMs,
					},
				});
				writeSuccess(stdout, proof, parsed.outputMode, {
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

function parseAdapterProofArgv(
	argv: readonly string[],
	runtime: AdapterProofRuntime,
): ParsedAdapterProofCommand {
	if (argv.includes("--help") || argv.includes("-h")) {
		return { kind: "help", command: findCommand(argv) };
	}
	if (argv.includes("--version")) {
		return { kind: "version" };
	}

	const args = [...argv];
	let displayCommandName: BrowserAdapterProofCommand = "check";
	if (args[0] && !args[0].startsWith("-")) {
		const candidate = args.shift();
		if (candidate === "help") {
			return { kind: "help", command: findCommand(args) };
		}
		if (!isBrowserAdapterProofCommand(candidate)) {
			throw usageError(`unknown command: ${candidate}`);
		}
		displayCommandName = candidate;
	}

	const commandName: CommandToExecute =
		displayCommandName === "status" ? "check" : displayCommandName;
	let outputMode: OutputMode =
		displayCommandName === "status" ? "plain" : "json";
	let adapter = "";
	let port = "";
	let endpoint = "";

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--json":
				outputMode = "json";
				break;
			case "--plain":
				outputMode = "plain";
				break;
			case "--adapter":
				adapter = requireNext(args, index, "--adapter");
				index += 1;
				break;
			case "--port":
				port = requireNext(args, index, "--port");
				index += 1;
				break;
			case "--endpoint":
				endpoint = requireNext(args, index, "--endpoint");
				index += 1;
				break;
			default:
				if (arg.startsWith("--adapter=")) {
					adapter = requireInlineValue(arg, "--adapter");
				} else if (arg.startsWith("--port=")) {
					port = requireInlineValue(arg, "--port");
				} else if (arg.startsWith("--endpoint=")) {
					endpoint = requireInlineValue(arg, "--endpoint");
				} else if (arg.startsWith("-")) {
					throw usageError(`unknown option: ${arg}`);
				} else {
					throw usageError(`unexpected argument: ${arg}`);
				}
		}
	}

	if (!adapter) {
		throw new AdapterProofRuntimeError(
			"missing_adapter",
			"Browser Adapter Proof requires --adapter.",
			inputChangeOptions("Choose one Browser Adapter to prove."),
		);
	}
	if (!isBrowserAdapter(adapter)) {
		throw new AdapterProofRuntimeError(
			"unknown_adapter",
			`Unsupported Browser Adapter: ${adapter}.`,
			inputChangeOptions(
				`Use one of: ${BROWSER_ADAPTER_PROOF_ADAPTERS.join(", ")}.`,
			),
		);
	}

	const normalized = normalizeEndpoint({
		port: port || (endpoint ? "" : runtime.env.BROWSER_USE_CDP_PORT || DEFAULT_PORT),
		endpoint,
	});

	return {
		kind: "execute",
		commandName,
		displayCommandName,
		outputMode,
		adapter,
		...normalized,
	};
}

function inputChangeOptions(
	hintSummary: string,
): Pick<
	AdapterProofRuntimeErrorOptions,
	"failureDomain" | "hintAction" | "hintSummary" | "recoverability" | "exitCode"
> {
	return {
		exitCode: USAGE_EXIT_CODE,
		failureDomain: "input",
		hintSummary,
		hintAction: "change_input",
		recoverability: "change_input",
	};
}

function inferOutputMode(argv: readonly string[]): OutputMode {
	let outputMode: OutputMode = argv[0] === "status" ? "plain" : "json";
	for (const arg of argv) {
		if (arg === "--json") outputMode = "json";
		if (arg === "--plain") outputMode = "plain";
	}
	return outputMode;
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

function requireNext(args: readonly string[], index: number, flag: string): string {
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

function normalizeEndpoint(input: {
	port: string;
	endpoint: string;
}): { endpoint: string; port: string } {
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
		throw new AdapterProofRuntimeError(
			"non_loopback_endpoint",
			"Browser Adapter Proof endpoint must be loopback.",
			inputChangeOptions(
				"Use a loopback CDP endpoint such as http://127.0.0.1:<port>.",
			),
		);
	}
	if (!parsed.port) {
		throw usageError("--endpoint must include a port");
	}
	assertPort(parsed.port, "endpoint port");
	if (input.port && input.port !== parsed.port) {
		throw usageError("--port does not match --endpoint");
	}
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

async function runWarmChromePreflight(input: {
	parsed: Extract<ParsedAdapterProofCommand, { kind: "execute" }>;
	runId: string;
	runtime: AdapterProofRuntime;
}): Promise<WarmChromeProofResult> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const startedAt = input.runtime.now();
	const exitCode = await runPreflightWarmChromeCli(
		[
			"check",
			"--endpoint",
			input.parsed.endpoint,
			"--json",
			"--quiet",
			"--run-id",
			input.runId,
		],
		{
			runtime: input.runtime,
			stdout,
			stderr,
		},
	);
	const durationMs = input.runtime.now() - startedAt;
	const envelope = parseJsonObject(stdout.toString());
	if (exitCode !== 0) {
		return { ok: false, runId: input.runId, durationMs, exitCode, envelope };
	}
	const data = envelope.data;
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return {
			ok: false,
			runId: input.runId,
			durationMs,
			exitCode: RUNTIME_FAILURE_EXIT_CODE,
			envelope: {
				status: "error",
				error: {
					code: "runtime_failure",
					message: "Warm Chrome Preflight emitted an invalid success envelope.",
					failure_domain: "runtime_diagnostics",
				},
			},
		};
	}
	const proof = data as WarmChromeProofData;
	return { ok: true, runId: input.runId, durationMs, proof };
}

async function executeAdapterProof(input: {
	parsed: Extract<ParsedAdapterProofCommand, { kind: "execute" }>;
	runtime: AdapterProofRuntime;
	warmChrome: Extract<WarmChromeProofResult, { ok: true }>;
	phaseTimings: Record<string, number>;
}): Promise<AdapterProof> {
	switch (input.parsed.adapter) {
		case "chrome-devtools":
			return proveChromeDevTools(input);
	}
}

async function proveChromeDevTools(input: {
	parsed: Extract<ParsedAdapterProofCommand, { kind: "execute" }>;
	runtime: AdapterProofRuntime;
	warmChrome: Extract<WarmChromeProofResult, { ok: true }>;
	phaseTimings: Record<string, number>;
}): Promise<AdapterProof> {
	const configStartedAt = input.runtime.now();
	const config = await inspectChromeDevToolsConfig({
		runtime: input.runtime,
		endpoint: input.parsed.endpoint,
		port: input.parsed.port,
	});
	input.phaseTimings.adapter_config_ms = input.runtime.now() - configStartedAt;

	const mcporter = config.sources.find(
		(source) => source.source_label === "mcporter",
	);
	if (!mcporter || mcporter.parse_status !== "ok" || !mcporter.binding) {
		if (
			mcporter?.code === "adapter_dependency_missing" ||
			mcporter?.code === "adapter_output_unparsable"
		) {
			throw new AdapterProofRuntimeError(
				mcporter.code,
				mcporter.code === "adapter_output_unparsable"
					? "Chrome DevTools mcporter config output was unparsable."
					: "Chrome DevTools selected adapter dependencies are missing.",
				{
					primaryActionId: "inspect_adapter_config",
					hintSummary:
						mcporter.message ??
						"Install or expose bun, bunx, mcporter, and Chrome DevTools MCP before adapter proof.",
					hintAction: "repair_state",
					recoverability: "repair_state",
					hintDocsUrl: CHROME_DEVTOOLS_DOCS_URL,
					sourceLabel: "mcporter",
				},
			);
		}
		const staleNative = config.sources.find(
			(source) =>
				source.source_label !== "mcporter" &&
				source.binding?.status === "stale",
		);
		const mismatchedNative = config.sources.find(
			(source) =>
				source.source_label !== "mcporter" &&
				source.binding?.status === "mismatch",
		);
		if (mismatchedNative?.binding) {
			throw bindingMismatchError({
				...mismatchedNative,
				binding: mismatchedNative.binding,
			});
		}
		if (staleNative?.binding) {
			throw new AdapterProofRuntimeError(
				"adapter_config_stale",
				`Chrome DevTools config points at stale port ${staleNative.binding.observed_port}.`,
				{
					primaryActionId: "update_adapter_config",
					hintSummary:
						"Update Chrome DevTools config to the verified Warm Chrome endpoint.",
					hintAction: "repair_state",
					recoverability: "repair_state",
					hintDocsUrl: CHROME_DEVTOOLS_DOCS_URL,
					observedPort: staleNative.binding.observed_port,
					sourceLabel: staleNative.source_label,
				},
			);
		}
		throw new AdapterProofRuntimeError(
			"adapter_config_missing",
			"Chrome DevTools mcporter config is missing or unreadable.",
			{
				primaryActionId: "update_adapter_config",
				hintSummary:
					"Configure Chrome DevTools MCP to use --browserUrl for Warm Chrome.",
				hintAction: "repair_state",
				recoverability: "repair_state",
				hintDocsUrl: CHROME_DEVTOOLS_DOCS_URL,
				sourceLabel: "mcporter",
			},
		);
	}

	if (mcporter.binding.status !== "matches_verified_endpoint") {
		if (mcporter.binding.status === "mismatch") {
			throw bindingMismatchError({ ...mcporter, binding: mcporter.binding });
		}
		throw new AdapterProofRuntimeError(
			"adapter_config_stale",
			`Chrome DevTools mcporter config points at stale port ${mcporter.binding.observed_port}.`,
			{
				primaryActionId: "update_adapter_config",
				hintSummary:
					"Update Chrome DevTools mcporter config to the verified Warm Chrome endpoint.",
				hintAction: "repair_state",
				recoverability: "repair_state",
				hintDocsUrl: CHROME_DEVTOOLS_DOCS_URL,
				observedPort: mcporter.binding.observed_port,
				sourceLabel: "mcporter",
			},
		);
	}

	mcporter.selected = true;
	const warnings = warningsForNonSelectedConfig(config.sources);
	const listStartedAt = input.runtime.now();
	const pages = await listChromeDevToolsPages(input.runtime);
	input.phaseTimings.adapter_list_pages_ms = input.runtime.now() - listStartedAt;
	if (pages.length === 0) {
		warnings.push({
			code: "adapter_signal_weak",
			severity: "warning",
			summary: "Chrome DevTools listed zero pages.",
			docs_url: CHROME_DEVTOOLS_DOCS_URL,
			source_label: "mcporter",
		});
	}

	return {
		ok: true,
		action: "adapter_ready",
		contract: BROWSER_ADAPTER_PROOF_CONTRACT_ID,
		schema_version: BROWSER_ADAPTER_PROOF_SCHEMA_VERSION,
		command: input.parsed.displayCommandName,
		adapter: input.parsed.adapter,
		endpoint: input.parsed.endpoint,
		port: input.parsed.port,
		warm_chrome_run_id: input.warmChrome.runId,
		page_count: pages.length,
		pages,
		diagnostics: {
			selected_config_source: "mcporter",
			selected_binding: mcporter.binding,
			config_sources: config.sources,
			warnings,
			phase_timings_ms: input.phaseTimings,
		},
	};
}

async function inspectChromeDevToolsConfig(input: {
	runtime: AdapterProofRuntime;
	endpoint: string;
	port: string;
}): Promise<{ sources: ConfigSourceDiagnostic[] }> {
	const sources: ConfigSourceDiagnostic[] = [];
	sources.push(
		await inspectMcporterConfig(input.runtime, input.endpoint, input.port),
	);
	for (const source of nativeChromeDevToolsConfigSources(input.runtime)) {
		sources.push(
			await inspectNativeConfigSource({
				...source,
				runtime: input.runtime,
				endpoint: input.endpoint,
				port: input.port,
			}),
		);
	}
	return { sources };
}

async function inspectMcporterConfig(
	runtime: AdapterProofRuntime,
	endpoint: string,
	port: string,
): Promise<ConfigSourceDiagnostic> {
	const base: ConfigSourceDiagnostic = {
		source_label: "mcporter",
		scope: "user",
		path_hint: "mcporter chrome-devtools config",
		parse_status: "missing",
	};
	let result: AdapterCommandResult;
	try {
		result = await runtime.runCommand({
			command: "bunx",
			args: ["mcporter", "config", "get", "chrome-devtools", "--json"],
			timeoutMs: ADAPTER_TIMEOUT_MS["chrome-devtools"],
		});
	} catch {
		return {
			...base,
			parse_status: "unreadable",
			code: "adapter_dependency_missing",
			message: "bun, bunx, or mcporter could not be started.",
		};
	}
	if (result.timedOut) {
		throw new AdapterProofRuntimeError(
			"adapter_proof_timeout",
			"Chrome DevTools config inspection timed out.",
			timeoutOptions("inspect_adapter_config"),
		);
	}
	if (isMissingCommandResult(result)) {
		return {
			...base,
			parse_status: "unreadable",
			code: "adapter_dependency_missing",
			message: "bun, bunx, or mcporter is missing.",
		};
	}
	if (result.exitCode !== 0) {
		return {
			...base,
			parse_status: "missing",
			code: "adapter_config_missing",
			message: "mcporter has no chrome-devtools config.",
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(result.stdout);
	} catch {
		return {
			...base,
			parse_status: "malformed",
			code: "adapter_output_unparsable",
			message: "mcporter config output was not JSON.",
		};
	}

	return {
		...base,
		parse_status: "ok",
		binding: await extractChromeDevToolsBinding({
			value: parsed,
			runtime,
			endpoint,
			port,
		}),
	};
}

function nativeChromeDevToolsConfigSources(runtime: AdapterProofRuntime): Array<{
	sourceLabel: BrowserAdapterProofConfigSourceLabel;
	scope: "project" | "user";
	pathHint: string;
	path: string;
	format: "json" | "toml";
}> {
	const home = runtime.env.HOME ?? "";
	return [
		{
			sourceLabel: "repo_mcp",
			scope: "project",
			pathHint: "repo .mcp.json",
			path: join(runtime.cwd, ".mcp.json"),
			format: "json",
		},
		{
			sourceLabel: "native_mcp_claude_code",
			scope: "project",
			pathHint: "Claude Code project MCP config",
			path: join(runtime.cwd, ".claude", "mcp.json"),
			format: "json",
		},
		{
			sourceLabel: "native_mcp_claude_code",
			scope: "user",
			pathHint: "Claude Code user config",
			path: home ? join(home, ".claude.json") : "",
			format: "json",
		},
		{
			sourceLabel: "native_mcp_claude_desktop",
			scope: "user",
			pathHint: "Claude Desktop config",
			path: home
				? join(
						home,
						"Library",
						"Application Support",
						"Claude",
						"claude_desktop_config.json",
					)
				: "",
			format: "json",
		},
		{
			sourceLabel: "native_mcp_codex",
			scope: "project",
			pathHint: "Codex project config",
			path: join(runtime.cwd, ".codex", "config.toml"),
			format: "toml",
		},
		{
			sourceLabel: "native_mcp_codex",
			scope: "user",
			pathHint: "Codex user config",
			path: home ? join(home, ".codex", "config.toml") : "",
			format: "toml",
		},
	];
}

async function inspectNativeConfigSource(input: {
	runtime: AdapterProofRuntime;
	sourceLabel: BrowserAdapterProofConfigSourceLabel;
	scope: "project" | "user";
	pathHint: string;
	path: string;
	format: "json" | "toml";
	endpoint: string;
	port: string;
}): Promise<ConfigSourceDiagnostic> {
	const base: ConfigSourceDiagnostic = {
		source_label: input.sourceLabel,
		scope: input.scope,
		path_hint: input.pathHint,
		parse_status: "missing",
	};
	if (!input.path) return base;
	let content: string;
	try {
		content = await input.runtime.readTextFile(input.path);
	} catch {
		return base;
	}

	if (input.format === "toml") {
		const chromeDevToolsSection = selectChromeDevToolsTomlSection(content);
		const binding = chromeDevToolsSection
			? bindingFromText(chromeDevToolsSection, input.endpoint, input.port)
			: undefined;
		return {
			...base,
			parse_status: "ok",
			...(binding ? { binding } : {}),
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return {
			...base,
			parse_status: "malformed",
			code: "adapter_config_parse_error",
			message: "Native MCP config could not be parsed.",
		};
	}

	return {
		...base,
		parse_status: "ok",
		binding: await extractChromeDevToolsBindingForNativeConfig({
			value: parsed,
			runtime: input.runtime,
			endpoint: input.endpoint,
			port: input.port,
		}),
	};
}

async function extractChromeDevToolsBindingForNativeConfig(input: {
	value: unknown;
	runtime: AdapterProofRuntime;
	endpoint: string;
	port: string;
}): Promise<AdapterBinding | undefined> {
	const selected = selectChromeDevToolsNativeConfigEntry(input.value);
	if (!selected) return undefined;
	return extractChromeDevToolsBinding({ ...input, value: selected });
}

async function extractChromeDevToolsBinding(input: {
	value: unknown;
	runtime: AdapterProofRuntime;
	endpoint: string;
	port: string;
}): Promise<AdapterBinding | undefined> {
	const browserUrl = findStringField(input.value, [
		"browserUrl",
		"browserURL",
		"browser_url",
	]);
	if (browserUrl) {
		return bindingFromEndpoint(browserUrl, input.endpoint, input.port);
	}

	const args = collectStringArrays(input.value, ["args", "arguments", "argv"]);
	for (const argList of args) {
		const browserUrlArg = readArgFlagValue(argList, "--browserUrl");
		if (browserUrlArg) {
			return bindingFromEndpoint(browserUrlArg, input.endpoint, input.port);
		}

		const userDataDir =
			readArgFlagValue(argList, "--userDataDir") ??
			readArgFlagValue(argList, "--user-data-dir");
		if (
			userDataDir &&
			(argList.includes("--auto-connect") || argList.includes("--autoConnect"))
		) {
			return bindingFromDevToolsActivePort({
				runtime: input.runtime,
				userDataDir,
				port: input.port,
			});
		}
	}

	return bindingFromText(JSON.stringify(input.value), input.endpoint, input.port);
}

function selectChromeDevToolsNativeConfigEntry(value: unknown): unknown | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const object = value as Record<string, unknown>;
	for (const containerKey of ["mcpServers", "mcp_servers", "servers"]) {
		const container = object[containerKey];
		if (!container || typeof container !== "object" || Array.isArray(container)) {
			continue;
		}
		const entry = (container as Record<string, unknown>)["chrome-devtools"];
		if (entry) return entry;
	}
	return object["chrome-devtools"];
}

function selectChromeDevToolsTomlSection(content: string): string | undefined {
	const lines = content.split("\n");
	const selected: string[] = [];
	let inChromeDevToolsSection = false;
	for (const line of lines) {
		const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
		if (header) {
			inChromeDevToolsSection = header[1]
				.split(".")
				.map((part) => part.trim().replace(/^["']|["']$/g, ""))
				.includes("chrome-devtools");
		}
		if (inChromeDevToolsSection) selected.push(line);
	}
	return selected.length > 0 ? selected.join("\n") : undefined;
}

function bindingFromText(
	text: string,
	verifiedEndpoint: string,
	verifiedPort: string,
): AdapterBinding | undefined {
	const browserUrlMatch = text.match(
		/--browserUrl(?:=|\s+)["']?([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"',\]]+)["']?/,
	);
	if (browserUrlMatch?.[1]) {
		return bindingFromEndpoint(browserUrlMatch[1], verifiedEndpoint, verifiedPort);
	}
	const urlMatch = text.match(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"',\]]+/);
	if (urlMatch?.[0]) {
		return bindingFromEndpoint(urlMatch[0], verifiedEndpoint, verifiedPort);
	}
	return undefined;
}

function bindingFromEndpoint(
	endpoint: string,
	_verifiedEndpoint: string,
	verifiedPort: string,
): AdapterBinding {
	try {
		const parsed = new URL(endpoint);
		const observedPort = parsed.port || undefined;
		const isLoopback =
			parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
		const isHttp = parsed.protocol === "http:";
		return {
			kind: "browser_url",
			status:
				observedPort === verifiedPort && isLoopback && isHttp
					? "matches_verified_endpoint"
					: observedPort
						? isLoopback && isHttp
							? "stale"
							: "mismatch"
						: "unknown",
			observed_port: observedPort,
			endpoint_host:
				isLoopback ? parsed.hostname : "non_loopback",
		};
	} catch {
		return { kind: "browser_url", status: "unknown" };
	}
}

function bindingMismatchError(
	source: ConfigSourceDiagnostic & { binding: AdapterBinding },
): AdapterProofRuntimeError {
	return new AdapterProofRuntimeError(
		"adapter_binding_mismatch",
		"Chrome DevTools config is not bound to the verified loopback Warm Chrome endpoint.",
		{
			primaryActionId: "update_adapter_config",
			hintSummary:
				"Update Chrome DevTools config to a loopback Warm Chrome endpoint.",
			hintAction: "repair_state",
			recoverability: "repair_state",
			hintDocsUrl: CHROME_DEVTOOLS_DOCS_URL,
			observedPort: source.binding.observed_port,
			sourceLabel: source.source_label,
		},
	);
}

async function bindingFromDevToolsActivePort(input: {
	runtime: AdapterProofRuntime;
	userDataDir: string;
	port: string;
}): Promise<AdapterBinding> {
	try {
		const content = await input.runtime.readTextFile(
			join(expandHome(input.userDataDir, input.runtime), "DevToolsActivePort"),
		);
		const observedPort = content.split("\n")[0]?.trim();
		return {
			kind: "devtools_active_port",
			status:
				observedPort === input.port
					? "matches_verified_endpoint"
					: observedPort
						? "stale"
						: "missing",
			observed_port: observedPort || undefined,
			endpoint_host: "127.0.0.1",
		};
	} catch {
		return {
			kind: "auto_connect_user_data_dir",
			status: "missing",
		};
	}
}

function warningsForNonSelectedConfig(
	sources: readonly ConfigSourceDiagnostic[],
): AdapterWarning[] {
	return sources.flatMap((source): AdapterWarning[] => {
		if (source.selected) return [];
			if (source.binding?.status === "stale") {
				return [
				{
					code: "adapter_config_stale",
					severity: "warning",
					summary: `Non-selected Chrome DevTools config points at stale port ${source.binding.observed_port}.`,
					docs_url: CHROME_DEVTOOLS_DOCS_URL,
					source_label: source.source_label,
					observed_port: source.binding.observed_port,
				},
				];
			}
			if (source.binding?.status === "mismatch") {
				return [
					{
						code: "adapter_binding_mismatch",
						severity: "warning",
						summary:
							"Non-selected Chrome DevTools config is not bound to loopback Warm Chrome.",
						docs_url: CHROME_DEVTOOLS_DOCS_URL,
						source_label: source.source_label,
						observed_port: source.binding.observed_port,
					},
				];
			}
			if (source.parse_status === "malformed") {
			return [
				{
					code: source.code ?? "adapter_config_parse_error",
					severity: "warning",
					summary: source.message ?? "Non-selected native MCP config is malformed.",
					docs_url: CHROME_DEVTOOLS_DOCS_URL,
					source_label: source.source_label,
				},
			];
		}
		return [];
	});
}

async function listChromeDevToolsPages(
	runtime: AdapterProofRuntime,
): Promise<PageSummary[]> {
	let result: AdapterCommandResult;
	try {
		result = await runtime.runCommand({
			command: "bunx",
			args: [
				"mcporter",
				"call",
				"chrome-devtools.list_pages",
				"--args",
				"{}",
				"--output",
				"json",
			],
			timeoutMs: ADAPTER_TIMEOUT_MS["chrome-devtools"],
		});
	} catch {
		throw new AdapterProofRuntimeError(
			"adapter_dependency_missing",
			"mcporter could not be started.",
			{
				primaryActionId: "inspect_adapter_config",
				hintSummary: "Install or expose mcporter before adapter proof.",
				hintAction: "repair_state",
				recoverability: "repair_state",
				hintDocsUrl: CHROME_DEVTOOLS_DOCS_URL,
			},
		);
	}
	if (result.timedOut) {
		throw new AdapterProofRuntimeError(
			"adapter_proof_timeout",
			"Chrome DevTools list_pages timed out.",
			timeoutOptions("inspect_adapter_config"),
		);
	}
	if (isMissingCommandResult(result)) {
		throw new AdapterProofRuntimeError(
			"adapter_dependency_missing",
			"mcporter or Chrome DevTools MCP is missing.",
			{
				primaryActionId: "inspect_adapter_config",
				hintSummary:
					"Install or expose mcporter and Chrome DevTools MCP before adapter proof.",
				hintAction: "repair_state",
				recoverability: "repair_state",
				hintDocsUrl: CHROME_DEVTOOLS_DOCS_URL,
			},
		);
	}
	if (result.exitCode !== 0) {
		throw new AdapterProofRuntimeError(
			"adapter_command_failed",
			"Chrome DevTools list_pages failed.",
			{
				primaryActionId: "inspect_adapter_config",
				hintSummary: "Inspect Chrome DevTools adapter config and daemon state.",
				hintAction: "repair_state",
				recoverability: "repair_state",
				hintDocsUrl: CHROME_DEVTOOLS_DOCS_URL,
			},
		);
	}
	if (result.stdout.trim() === "") return [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(result.stdout);
	} catch {
		throw new AdapterProofRuntimeError(
			"adapter_output_unparsable",
			"Chrome DevTools list_pages returned unparsable output.",
			{
				primaryActionId: "inspect_adapter_config",
				hintSummary: "Inspect Chrome DevTools adapter output before acting.",
				hintAction: "repair_state",
				recoverability: "repair_state",
				hintDocsUrl: CHROME_DEVTOOLS_DOCS_URL,
			},
		);
	}

	return extractPageList(parsed).map(safePageSummary);
}

function extractPageList(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (!value || typeof value !== "object") return [];
	const object = value as Record<string, unknown>;
	for (const key of ["pages", "tabs", "targets"]) {
		const field = object[key];
		if (Array.isArray(field)) return field;
	}
	const content = object.content;
	if (Array.isArray(content)) {
		return content.flatMap((entry) => {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
			const text = (entry as Record<string, unknown>).text;
			return typeof text === "string" ? parseChromeDevToolsPagesText(text) : [];
		});
	}
	return [];
}

function parseChromeDevToolsPagesText(text: string): PageSummary[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.flatMap((line): PageSummary[] => {
			const match = line.match(/^(\d+):\s+(\S+)(?:\s+\[[^\]]+\])?$/);
			if (!match) return [];
			const [, id, url] = match;
			return [{ id, url }];
		});
}

function safePageSummary(value: unknown): PageSummary {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const object = value as Record<string, unknown>;
	return {
		...(typeof object.id === "string" ? { id: truncate(object.id, 48) } : {}),
		...(typeof object.title === "string"
			? { title: truncate(object.title, 80) }
			: {}),
		...(typeof object.url === "string" ? { url: safeUrl(object.url) } : {}),
	};
}

function safeUrl(value: string): string {
	try {
		const parsed = new URL(value);
		return `${parsed.origin}${parsed.pathname}`;
	} catch {
		return truncate(value.split("?")[0] ?? value, 120);
	}
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function timeoutOptions(
	primaryActionId: AdapterProofRuntimeActionId,
): AdapterProofRuntimeErrorOptions {
	return {
		primaryActionId,
		hintSummary: "Adapter proof timed out before readiness could be proven.",
		hintAction: "repair_state",
		recoverability: "repair_state",
		hintDocsUrl: CHROME_DEVTOOLS_DOCS_URL,
	};
}

function isMissingCommandResult(result: AdapterCommandResult): boolean {
	const text = `${result.stderr}\n${result.stdout}`;
	return (
		result.exitCode === 127 ||
		/(command not found|not found|ENOENT|No such file or directory)/i.test(text)
	);
}

function parseJsonObject(text: string): Record<string, unknown> {
	try {
		const value = JSON.parse(text);
		if (value && typeof value === "object" && !Array.isArray(value)) {
			return value as Record<string, unknown>;
		}
	} catch {
		// handled below
	}
	return {};
}

function findStringField(
	value: unknown,
	keys: readonly string[],
): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findStringField(item, keys);
			if (found) return found;
		}
		return undefined;
	}
	const object = value as Record<string, unknown>;
	for (const key of keys) {
		const field = object[key];
		if (typeof field === "string" && field.trim() !== "") return field;
	}
	for (const field of Object.values(object)) {
		const found = findStringField(field, keys);
		if (found) return found;
	}
	return undefined;
}

function collectStringArrays(
	value: unknown,
	keys: readonly string[],
): string[][] {
	if (!value || typeof value !== "object") return [];
	if (Array.isArray(value)) {
		if (value.every((item) => typeof item === "string")) {
			return [value as string[]];
		}
		return value.flatMap((item) => collectStringArrays(item, keys));
	}
	const object = value as Record<string, unknown>;
	const ownArrays = keys.flatMap((key) => {
		const field = object[key];
		return Array.isArray(field) && field.every((item) => typeof item === "string")
			? [field as string[]]
			: [];
	});
	return [
		...ownArrays,
		...Object.values(object).flatMap((field) => collectStringArrays(field, keys)),
	];
}

function readArgFlagValue(
	args: readonly string[],
	flag: string,
): string | undefined {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === flag) return args[index + 1];
		if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
	}
	return undefined;
}

function expandHome(path: string, runtime: AdapterProofRuntime): string {
	if (path === "~") return runtime.env.HOME ?? path;
	if (path.startsWith("~/")) {
		const home = runtime.env.HOME;
		return home ? join(home, path.slice(2)) : path;
	}
	return path;
}

function writeSuccess(
	stdout: CliWriter,
	proof: AdapterProof,
	outputMode: OutputMode,
	runtime: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		stdout.write(
			[
				"adapter_ready",
				`command=${proof.command}`,
				`adapter=${proof.adapter}`,
				`port=${proof.port}`,
				`pages=${proof.page_count}`,
				"action=use_verified_browser_adapter",
				`warm_chrome_run_id=${proof.warm_chrome_run_id}`,
				`run_id=${runtime.runId}`,
				`duration_ms=${runtime.durationMs}`,
			].join(" ") + "\n",
		);
		return;
	}

	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: runtime.runId,
			data: proof,
			runtime_actions: [runtimeAction("use_verified_browser_adapter")],
			continuation: {
				next_action_id: "use_verified_browser_adapter",
			},
		}),
		runtime,
	);
}

function emitWarmChromeFailure(input: {
	warmChrome: Extract<WarmChromeProofResult, { ok: false }>;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const error =
		input.warmChrome.envelope.error &&
		typeof input.warmChrome.envelope.error === "object"
			? (input.warmChrome.envelope.error as Record<string, unknown>)
			: {};
	if (input.outputMode === "plain") {
		const code = typeof error.code === "string" ? error.code : "warm_chrome_failed";
		const domain =
			typeof error.failure_domain === "string"
				? error.failure_domain
				: "browser_entry_handoff";
		const action =
			input.warmChrome.envelope.continuation &&
			typeof input.warmChrome.envelope.continuation === "object" &&
			"next_action_id" in input.warmChrome.envelope.continuation
				? String(input.warmChrome.envelope.continuation.next_action_id)
				: "enable_remote_debugging";
		input.stderr.write(
			`${domain} ${code}: Warm Chrome Preflight failed action=${action} warm_chrome_run_id=${input.warmChrome.runId} (run_id=${input.runId})\n`,
		);
		return input.warmChrome.exitCode;
	}

	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: input.warmChrome.exitCode,
			error: {
				run_id: input.runId,
				code:
					typeof error.code === "string"
						? error.code
						: "warm_chrome_preflight_failed",
				message:
					typeof error.message === "string"
						? error.message
						: "Warm Chrome Preflight failed before adapter proof.",
				exit_code: input.warmChrome.exitCode,
				severity:
					error.severity === "warning" ||
					error.severity === "error" ||
					error.severity === "fatal"
						? error.severity
						: "error",
				recoverability:
					error.recoverability === "none" ||
					error.recoverability === "retry" ||
					error.recoverability === "change_input" ||
					error.recoverability === "repair_state"
						? error.recoverability
						: "repair_state",
				retryable: false,
				failure_domain:
					typeof error.failure_domain === "string"
						? error.failure_domain
						: "browser_entry_handoff",
				hint: normalizeWarmChromeHint(error.hint),
			},
			runtime_actions: Array.isArray(input.warmChrome.envelope.runtime_actions)
				? input.warmChrome.envelope.runtime_actions
				: [runtimeAction("inspect_adapter_config")],
			continuation:
				input.warmChrome.envelope.continuation &&
				typeof input.warmChrome.envelope.continuation === "object"
					? input.warmChrome.envelope.continuation
					: {
							next_action_id: "inspect_adapter_config",
							constraints: [noAdapterFallbackConstraint()],
						},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return input.warmChrome.exitCode;
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
	emitCliDiagnostic("browser-use.adapter-proof", "error", error.code, {
		code: error.code,
		exit_code: error.exitCode,
		duration_ms: getCliDiagnosticDurationMs(),
		...(error.observedPort ? { observed_port: error.observedPort } : {}),
		...(error.sourceLabel ? { source_label: error.sourceLabel } : {}),
	});
	const guidance = guidanceForError(error);

	if (input.outputMode === "plain") {
		const line = `${guidance.failureDomain} ${error.code}: ${error.message} action=${guidance.continuation.next_action_id} (run_id=${input.runId})\n`;
		input.stderr.write(line);
		return error.exitCode;
	}

	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: error.exitCode,
			error: {
				run_id: input.runId,
				code: error.code,
				message: error.message,
				exit_code: error.exitCode,
				severity: error.severity,
				recoverability: error.recoverability,
				retryable: false,
				failure_domain: guidance.failureDomain,
				hint: {
					summary: error.hintSummary,
					action: error.hintAction,
					...(error.hintDocsUrl ? { docs_url: error.hintDocsUrl } : {}),
				},
			},
			runtime_actions: guidance.runtimeActions,
			continuation: guidance.continuation,
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return error.exitCode;
}

function normalizeWarmChromeHint(value: unknown): {
	summary: string;
	action?: "retry" | "change_input" | "repair_state";
	docs_url?: string;
} {
	const fallback = {
		summary: "Repair Warm Chrome before proving Browser Adapter attachment.",
		action: "repair_state" as const,
	};
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return fallback;
	}
	const hint = value as Record<string, unknown>;
	if (typeof hint.summary !== "string" || hint.summary.trim() === "") {
		return fallback;
	}
	return {
		summary: hint.summary,
		...(hint.action === "retry" ||
		hint.action === "change_input" ||
		hint.action === "repair_state"
			? { action: hint.action }
			: {}),
		...(typeof hint.docs_url === "string" ? { docs_url: hint.docs_url } : {}),
	};
}

function normalizeError(error: unknown): {
	code: string;
	message: string;
	exitCode: number;
	severity: "warning" | "error" | "fatal";
	recoverability: "none" | "retry" | "change_input" | "repair_state";
	hintSummary: string;
	hintAction: "retry" | "change_input" | "repair_state" | undefined;
	hintDocsUrl?: string;
	failureDomain: AdapterProofFailureDomain;
	primaryActionId?: AdapterProofRuntimeActionId;
	observedPort?: string;
	sourceLabel?: BrowserAdapterProofConfigSourceLabel;
} {
	if (error instanceof CliUsageError) {
		return {
			code: "invalid_usage",
			message: error.options.showMessage
				? sanitizeUsageMessage(error.message)
				: "help requested",
			exitCode: error.options.exitCode ?? USAGE_EXIT_CODE,
			severity: "warning",
			recoverability: "change_input",
			hintSummary: "Fix Browser Adapter Proof CLI arguments.",
			hintAction: "change_input",
			failureDomain: "input",
			primaryActionId: "change_adapter_input",
		};
	}
	if (error instanceof AdapterProofRuntimeError) {
		const hint = hintForAdapterProofError(error);
		const recoverability = error.options.recoverability ?? hint.recoverability;
		const failureDomain =
			error.options.failureDomain ?? failureDomainForAdapterProofError(error);
		const exitCode =
			error.options.exitCode ??
			(failureDomain === "input" ? USAGE_EXIT_CODE : error.exitCode);
		return {
			code: error.code,
			message: error.message,
			exitCode,
			severity: error.options.severity ?? "error",
			recoverability,
			hintSummary: error.options.hintSummary ?? hint.summary,
			hintAction: error.options.hintAction ?? hint.action,
			hintDocsUrl: error.options.hintDocsUrl ?? hint.docsUrl,
			failureDomain,
			primaryActionId: error.options.primaryActionId,
			observedPort: error.options.observedPort,
			sourceLabel: error.options.sourceLabel,
		};
	}
	return {
		code: "runtime_failure",
		message: "Browser Adapter Proof hit an unexpected runtime failure.",
		exitCode: RUNTIME_FAILURE_EXIT_CODE,
		severity: "fatal",
		recoverability: "none",
		hintSummary: "Stop and inspect diagnostics.",
		hintAction: undefined,
		failureDomain: "runtime_diagnostics",
		primaryActionId: "inspect_adapter_config",
	};
}

function failureDomainForAdapterProofError(
	error: AdapterProofRuntimeError,
): AdapterProofFailureDomain {
	if (error.exitCode === RUNTIME_FAILURE_EXIT_CODE) return "runtime_diagnostics";
	if (error.options.failureDomain) return error.options.failureDomain;
	return "browser_adapter_proof";
}

function hintForAdapterProofError(error: AdapterProofRuntimeError): {
	summary: string;
	action: "retry" | "change_input" | "repair_state" | undefined;
	docsUrl?: string;
	recoverability: "none" | "retry" | "change_input" | "repair_state";
} {
	switch (error.code) {
		case "missing_adapter":
		case "unknown_adapter":
		case "non_loopback_endpoint":
			return {
				summary: "Fix Browser Adapter Proof input.",
				action: "change_input",
				recoverability: "change_input",
			};
		case "adapter_config_stale":
		case "adapter_binding_mismatch":
			return {
				summary:
					"Update Browser Adapter config to the verified Warm Chrome endpoint.",
				action: "repair_state",
				docsUrl: CHROME_DEVTOOLS_DOCS_URL,
				recoverability: "repair_state",
			};
		case "adapter_config_missing":
			return {
				summary: "Add Browser Adapter config for the verified Warm Chrome endpoint.",
				action: "repair_state",
				docsUrl: CHROME_DEVTOOLS_DOCS_URL,
				recoverability: "repair_state",
			};
		case "adapter_dependency_missing":
			return {
				summary: "Install or expose the selected Browser Adapter dependency.",
				action: "repair_state",
				docsUrl: CHROME_DEVTOOLS_DOCS_URL,
				recoverability: "repair_state",
			};
		case "adapter_proof_timeout":
			return {
				summary: "Adapter proof timed out before readiness could be proven.",
				action: "repair_state",
				docsUrl: CHROME_DEVTOOLS_DOCS_URL,
				recoverability: "repair_state",
			};
		default:
			return {
				summary: "Inspect Browser Adapter config before acting.",
				action: "repair_state",
				docsUrl: CHROME_DEVTOOLS_DOCS_URL,
				recoverability: "repair_state",
			};
	}
}

function guidanceForError(error: ReturnType<typeof normalizeError>): {
	failureDomain: AdapterProofFailureDomain;
	runtimeActions: RuntimeActionGuidance[];
	continuation: RuntimeContinuationGuidance & { next_action_id: string };
} {
	const actionId =
		error.primaryActionId ?? primaryRuntimeActionForError(error).id;
	const action = runtimeAction(actionId);
	return {
		failureDomain: error.failureDomain,
		runtimeActions: [action],
		continuation: {
			next_action_id: action.id,
			...(forbidsAdapterFallback(error)
				? { constraints: [noAdapterFallbackConstraint()] }
				: {}),
		},
	};
}

function primaryRuntimeActionForError(
	error: ReturnType<typeof normalizeError>,
): AdapterProofRuntimeActionGuidance {
	if (
		error.recoverability === "change_input" ||
		error.failureDomain === "input"
	) {
		return runtimeAction("change_adapter_input");
	}
	switch (error.code) {
		case "adapter_binding_mismatch":
		case "adapter_config_stale":
		case "adapter_config_missing":
			return runtimeAction("update_adapter_config");
		default:
			return runtimeAction("inspect_adapter_config");
	}
}

function forbidsAdapterFallback(error: ReturnType<typeof normalizeError>): boolean {
	return error.failureDomain === "browser_adapter_proof";
}

function noAdapterFallbackConstraint(): {
	id: string;
	summary: string;
	forbidden_action_ids: string[];
} {
	return {
		id: "no_adapter_fallback",
		summary:
			"Do not switch adapters or use a cold browser after Browser Adapter Proof failure.",
		forbidden_action_ids: ["adapter_fallback", "cold_browser_fallback"],
	};
}

function runtimeAction(
	id: AdapterProofRuntimeActionId,
): AdapterProofRuntimeActionGuidance {
	const action = adapterProofRuntimeActionById.get(id);
	if (!action) {
		throw new Error(`Unknown Browser Adapter Proof runtime action: ${id}`);
	}
	return {
		id,
		summary: action.summary,
		side_effects: [...action.sideEffects] as RuntimeActionGuidance["side_effects"],
	};
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

function renderHelp(command?: BrowserAdapterProofCommand): string {
	if (command) return renderCommandUsage(browserAdapterProofContracts[command]);
	const commandLines = Object.entries(browserAdapterProofContracts).map(
		([name, contract]) => `  ${name.padEnd(8)} ${contract.summary}`,
	);
	return [
		"Usage: preflight-browser-adapter <command> [flags]",
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
): BrowserAdapterProofCommand | undefined {
	return argv.find(isBrowserAdapterProofCommand);
}

function isBrowserAdapterProofCommand(
	value: string | undefined,
): value is BrowserAdapterProofCommand {
	return value === "check" || value === "status";
}

function isBrowserAdapter(value: string): value is BrowserAdapterProofAdapter {
	return BROWSER_ADAPTER_PROOF_ADAPTERS.includes(
		value as BrowserAdapterProofAdapter,
	);
}

export async function runCommand(
	input: AdapterCommandInput,
): Promise<AdapterCommandResult> {
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn([input.command, ...input.args], {
			stdout: "pipe",
			stderr: "pipe",
		});
	} catch {
		return {
			exitCode: 127,
			stdout: "",
			stderr: `${input.command}: command not found`,
		};
	}
	const completion = Promise.all([
		new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
		new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
		proc.exited,
	]).then(([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr }));
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutResult = new Promise<AdapterCommandResult>((resolve) => {
		timeout = setTimeout(() => {
			try {
				proc.kill("SIGKILL");
			} catch {
				// Best effort. Timeout result still preserves bounded CLI behavior.
			}
			resolve({ exitCode: 1, stdout: "", stderr: "", timedOut: true });
		}, input.timeoutMs);
	});
	try {
		return await Promise.race([completion, timeoutResult]);
	} finally {
		if (timeout) clearTimeout(timeout);
		completion.catch(() => undefined);
	}
}

export async function runForTest(
	argv: readonly string[],
	runtime: AdapterProofRuntime,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runPreflightBrowserAdapterCli(argv, {
		runtime,
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

export function validateErrorEnvelopeForTest(envelope: unknown): string[] {
	if (
		!envelope ||
		typeof envelope !== "object" ||
		Array.isArray(envelope) ||
		!("error" in envelope)
	) {
		return ["envelope.error missing"];
	}
	const error = (envelope as { error: unknown }).error;
	const runId =
		"run_id" in envelope && typeof envelope.run_id === "string"
			? envelope.run_id
			: undefined;
	const exitCode =
		error && typeof error === "object" && "exit_code" in error
			? (error as { exit_code: unknown }).exit_code
			: undefined;
	return validateStructuredRuntimeError(error, {
		run_id: runId,
		process_exit_code: typeof exitCode === "number" ? exitCode : undefined,
	});
}

if (import.meta.main) {
	const exitCode = await runPreflightBrowserAdapterCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
