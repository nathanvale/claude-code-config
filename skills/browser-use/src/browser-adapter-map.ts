#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	CliUsageError,
	configureCliDiagnostics,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	resetCliDiagnostics,
	usageError,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_ADAPTER_MAP_ADAPTERS,
	BROWSER_ADAPTER_MAP_CONTRACT_ID,
	BROWSER_ADAPTER_MAP_SCHEMA_VERSION,
	BROWSER_ADAPTER_PROOF_DIAGNOSTIC_CODES,
	BROWSER_ADAPTER_PROOF_LOCAL_RECOVERY_KEYS,
	type BrowserAdapterMapAdapter,
	type BrowserAdapterMapCommand,
	browserAdapterMapContracts,
	browserAdapterProofFailureActions,
	browserAdapterProofSuccessActions,
	warmChromeFailureActions,
} from "./command-contract";

const VERSION = "0.1.0";
const MAP_INVALID_EXIT_CODE = 20;
const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const quietDiagnosticWriter: CliWriter = { write: () => true };

export const REQUIRED_BROWSER_ADAPTER_MAP_SECTIONS = [
	"Owners",
	"Rules",
	"Recovery Map",
	"Verify",
] as const;

const BROWSER_ADAPTER_MAP_PATHS = {
	"chrome-devtools": fileURLToPath(
		new URL("../references/browser-adapter-chrome-devtools.md", import.meta.url),
	),
} as const satisfies Record<BrowserAdapterMapAdapter, string>;

type OutputMode = "json" | "plain";

type CoverageResult = {
	missing: string[];
	extra: string[];
};

type BrowserAdapterMapCheck = {
	ok: boolean;
	action: "map_valid" | "map_invalid";
	contract: typeof BROWSER_ADAPTER_MAP_CONTRACT_ID;
	schema_version: typeof BROWSER_ADAPTER_MAP_SCHEMA_VERSION;
	command: BrowserAdapterMapCommand;
	adapter: BrowserAdapterMapAdapter;
	path: string;
	required_sections: readonly string[];
	sections: CoverageResult;
	recovery_map: CoverageResult;
};

export type BrowserAdapterMapRuntime = {
	now: () => number;
	readTextFile: (path: string) => Promise<string>;
};

type ParsedBrowserAdapterMapCommand =
	| { kind: "help"; command?: BrowserAdapterMapCommand }
	| { kind: "version" }
	| {
			kind: "execute";
			commandName: "check";
			displayCommandName: BrowserAdapterMapCommand;
			outputMode: OutputMode;
			adapter: BrowserAdapterMapAdapter;
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

export function createDefaultBrowserAdapterMapRuntime(
	overrides: Partial<BrowserAdapterMapRuntime> = {},
): BrowserAdapterMapRuntime {
	return {
		now: () => Date.now(),
		readTextFile: (path) => readFile(path, "utf-8"),
		...overrides,
	};
}

export async function runBrowserAdapterMapCli(
	argv: readonly string[],
	options: {
		runtime?: BrowserAdapterMapRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultBrowserAdapterMapRuntime();
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	let diagnosticArgv: ParsedCliDiagnosticArgv;

	try {
		diagnosticArgv = parseCliDiagnosticArgv(argv);
	} catch (error) {
		diagnosticArgv = parseCliDiagnosticFallbackArgv(argv);
		const outputMode = inferOutputMode(argv);
		configureCliDiagnostics({
			categoryRoot: "browser-use.adapter-map",
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
	let parsed: ParsedBrowserAdapterMapCommand;
	try {
		parsed = parseBrowserAdapterMapArgv(diagnosticArgv.argv);
	} catch (error) {
		configureCliDiagnostics({
			categoryRoot: "browser-use.adapter-map",
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
		stdout.write(`browser-adapter-map ${VERSION}\n`);
		return 0;
	}

	try {
		const result = await checkBrowserAdapterMap({
			adapter: parsed.adapter,
			command: parsed.displayCommandName,
			runtime,
		});
		writeResult(stdout, stderr, result, parsed.outputMode, {
			runId: diagnosticArgv.options.runId,
			durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
		});
		return result.ok ? 0 : MAP_INVALID_EXIT_CODE;
	} catch (error) {
		configureCliDiagnostics({
			categoryRoot: "browser-use.adapter-map",
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
}

export async function checkBrowserAdapterMap(input: {
	adapter: BrowserAdapterMapAdapter;
	command: BrowserAdapterMapCommand;
	runtime?: BrowserAdapterMapRuntime;
}): Promise<BrowserAdapterMapCheck> {
	const runtime = input.runtime ?? createDefaultBrowserAdapterMapRuntime();
	const path = BROWSER_ADAPTER_MAP_PATHS[input.adapter];
	const markdown = await runtime.readTextFile(path);
	const sections = checkRequiredSections(markdown);
	const recoveryMap = checkRecoveryMapCoverage(markdown);
	const ok =
		sections.missing.length === 0 &&
		recoveryMap.missing.length === 0 &&
		recoveryMap.extra.length === 0;

	return {
		ok,
		action: ok ? "map_valid" : "map_invalid",
		contract: BROWSER_ADAPTER_MAP_CONTRACT_ID,
		schema_version: BROWSER_ADAPTER_MAP_SCHEMA_VERSION,
		command: input.command,
		adapter: input.adapter,
		path,
		required_sections: REQUIRED_BROWSER_ADAPTER_MAP_SECTIONS,
		sections,
		recovery_map: recoveryMap,
	};
}

export function checkRequiredSections(markdown: string): CoverageResult {
	const actual = new Set(parseSectionNames(markdown));
	const expected = new Set(REQUIRED_BROWSER_ADAPTER_MAP_SECTIONS);
	return {
		missing: [...expected].filter((section) => !actual.has(section)).sort(),
		extra: [],
	};
}

export function checkRecoveryMapCoverage(markdown: string): CoverageResult {
	const actual = new Set(parseRecoveryMapKeys(markdown));
	const expected = new Set(expectedAdapterProofRecoveryKeys());
	return {
		missing: [...expected].filter((key) => !actual.has(key)).sort(),
		extra: [...actual].filter((key) => !expected.has(key)).sort(),
	};
}

function parseBrowserAdapterMapArgv(
	argv: readonly string[],
): ParsedBrowserAdapterMapCommand {
	if (argv.includes("--version")) return { kind: "version" };
	if (argv.includes("--help") || argv.includes("-h")) {
		return { kind: "help", command: findCommand(argv) };
	}

	const args = [...argv];
	let displayCommandName: BrowserAdapterMapCommand = "check";
	if (args[0] && !args[0].startsWith("-")) {
		const candidate = args.shift();
		if (candidate === "help") {
			return { kind: "help", command: findCommand(args) };
		}
		if (!isBrowserAdapterMapCommand(candidate)) {
			throw usageError(`unknown command: ${candidate}`);
		}
		displayCommandName = candidate;
	}

	let outputMode: OutputMode =
		displayCommandName === "status" ? "plain" : "json";
	let adapter = "";

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
			default:
				if (arg.startsWith("--adapter=")) {
					adapter = requireInlineValue(arg, "--adapter");
				} else if (arg.startsWith("-")) {
					throw usageError(`unknown option: ${arg}`);
				} else {
					throw usageError(`unexpected argument: ${arg}`);
				}
		}
	}

	if (!adapter) {
		throw usageError("Browser Adapter Map check requires --adapter.");
	}
	if (!isBrowserAdapterMapAdapter(adapter)) {
		throw usageError(
			`Unsupported Browser Adapter Map: ${adapter}. Use one of: ${BROWSER_ADAPTER_MAP_ADAPTERS.join(", ")}.`,
		);
	}

	return {
		kind: "execute",
		commandName: "check",
		displayCommandName,
		outputMode,
		adapter,
	};
}

function writeResult(
	stdout: CliWriter,
	stderr: CliWriter,
	result: BrowserAdapterMapCheck,
	outputMode: OutputMode,
	runtime: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		const parts = [
			result.action,
			`command=${result.command}`,
			`adapter=${result.adapter}`,
			`missing_sections=${result.sections.missing.length}`,
			`missing_recovery_keys=${result.recovery_map.missing.length}`,
			`extra_recovery_keys=${result.recovery_map.extra.length}`,
			`run_id=${runtime.runId}`,
			`duration_ms=${runtime.durationMs}`,
		];
		(result.ok ? stdout : stderr).write(parts.join(" ") + "\n");
		return;
	}

	if (result.ok) {
		writeJsonEnvelope(
			stdout,
			createCliRuntimeSuccessEnvelope({
				run_id: runtime.runId,
				data: result,
			}),
			runtime,
		);
		return;
	}

	writeJsonEnvelope(
		stdout,
		createCliRuntimeErrorEnvelope({
			run_id: runtime.runId,
			process_exit_code: MAP_INVALID_EXIT_CODE,
			error: {
				run_id: runtime.runId,
				code: "browser_adapter_map_invalid",
				message: "Browser Adapter Map validation failed.",
				exit_code: MAP_INVALID_EXIT_CODE,
				severity: "error",
				recoverability: "change_input",
				retryable: false,
				failure_domain: "browser_adapter_map",
				hint: {
					summary:
						"Update the Browser Adapter Map sections or Recovery Map entries.",
					action: "change_input",
				},
			},
			runtime_actions: [
				{
					id: "update_browser_adapter_map",
					summary:
						"Update the Browser Adapter Map sections or Recovery Map entries.",
					side_effects: ["write"],
				},
			],
			continuation: {
				next_action_id: "update_browser_adapter_map",
			},
			data: result,
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
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_adapter_map ${isUsage ? "usage_error" : "runtime_error"}: ${message} (run_id=${input.runId})\n`,
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
				message,
				exit_code: exitCode,
				severity: isUsage ? "error" : "fatal",
				recoverability: isUsage ? "change_input" : "none",
				retryable: false,
				failure_domain: isUsage ? "input" : "runtime_diagnostics",
			},
			...(isUsage
				? {
						runtime_actions: [
							{
								id: "change_adapter_map_input",
								summary: "Fix Browser Adapter Map CLI arguments.",
								side_effects: ["check"],
							},
						],
						continuation: { next_action_id: "change_adapter_map_input" },
					}
				: {
						continuation: {
							requires_operator: true,
							constraints: [
								{
									id: "browser_adapter_map_runtime_stop",
									summary:
										"Stop; inspect Browser Adapter Map runtime diagnostics before retrying.",
								},
							],
						},
					}),
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return exitCode;
}

function inferOutputMode(argv: readonly string[]): OutputMode {
	let outputMode: OutputMode = argv[0] === "status" ? "plain" : "json";
	for (const arg of argv) {
		if (arg === "--json") outputMode = "json";
		if (arg === "--plain") outputMode = "plain";
	}
	return outputMode;
}

function renderHelp(command?: BrowserAdapterMapCommand): string {
	if (command) return renderCommandUsage(browserAdapterMapContracts[command]);
	const commandLines = Object.entries(browserAdapterMapContracts).map(
		([name, contract]) => `  ${name.padEnd(8)} ${contract.summary}`,
	);
	return [
		"Usage: browser-adapter-map <command> [flags]",
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

function parseRecoveryMapKeys(markdown: string): string[] {
	const lines = markdown.split(/\r?\n/);
	const keys: string[] = [];
	let inMap = false;

	for (const line of lines) {
		if (line === "## Recovery Map") {
			inMap = true;
			continue;
		}
		if (inMap && line.startsWith("## ")) break;
		if (!inMap) continue;

		const match = line.match(/^- `([^`]+)`:/);
		if (match?.[1]) keys.push(match[1]);
	}

	return keys;
}

function parseSectionNames(markdown: string): string[] {
	return markdown
		.split(/\r?\n/)
		.map((line) => line.match(/^## (.+)$/)?.[1])
		.filter((section): section is string => typeof section === "string");
}

function expectedAdapterProofRecoveryKeys(): string[] {
	const warmChromeActionIds = new Set<string>(
		warmChromeFailureActions.map((action) => action.id),
	);
	const adapterActionIds = browserAdapterProofFailureActions
		.map((action) => action.id)
		.filter((id) => !warmChromeActionIds.has(id));
	return uniqueSorted([
		...adapterActionIds,
		...browserAdapterProofSuccessActions.map((action) => action.id),
		...BROWSER_ADAPTER_PROOF_DIAGNOSTIC_CODES,
		...BROWSER_ADAPTER_PROOF_LOCAL_RECOVERY_KEYS,
	]);
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
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

function findCommand(
	argv: readonly string[],
): BrowserAdapterMapCommand | undefined {
	return argv.find(isBrowserAdapterMapCommand);
}

function isBrowserAdapterMapCommand(
	value: string | undefined,
): value is BrowserAdapterMapCommand {
	return value === "check" || value === "status";
}

function isBrowserAdapterMapAdapter(
	value: string,
): value is BrowserAdapterMapAdapter {
	return BROWSER_ADAPTER_MAP_ADAPTERS.includes(
		value as BrowserAdapterMapAdapter,
	);
}

export async function runForTest(
	argv: readonly string[],
	runtime: BrowserAdapterMapRuntime = createDefaultBrowserAdapterMapRuntime(),
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runBrowserAdapterMapCli(argv, {
		runtime,
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

if (import.meta.main) {
	const exitCode = await runBrowserAdapterMapCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
