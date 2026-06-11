#!/usr/bin/env bun

import {
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	projectCommandDiscoveryTree,
	renderCommandUsage,
	usageError,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { recordDecisionContracts } from "./command-contract.ts";
import {
	RECORD_DECISION_CONTRACT_ID,
	RECORD_DECISION_SCHEMA_VERSION,
	type RecordDecisionPlan,
	RecordDecisionInputError,
} from "./model.ts";
import { parseDecisionInput, planDecisionRecord } from "./record-engine.ts";

const VERSION = "0.1.0";

type ParsedCommand =
	| { kind: "help"; command?: "plan" | "commands" }
	| { kind: "version" }
	| { kind: "commands" }
	| { kind: "execute_deferred" }
	| { kind: "plan"; inputPath: string };

/**
 * Runtime adapter for filesystem and clock operations used by the CLI.
 */
export type RecordDecisionRuntime = {
	now: () => number;
	readTextFile: (path: string) => Promise<string>;
};

/**
 * Create the default runtime adapter for filesystem-backed CLI execution.
 *
 * @param overrides - Runtime hooks used by tests to avoid filesystem reads
 * @returns Runtime adapter used by the command runner
 *
 * @example
 * ```typescript
 * const runtime = createDefaultRecordDecisionRuntime()
 * ```
 */
export function createDefaultRecordDecisionRuntime(
	overrides: Partial<RecordDecisionRuntime> = {},
): RecordDecisionRuntime {
	return {
		now: () => Date.now(),
		readTextFile: async (path) => readFile(path, "utf8"),
		...overrides,
	};
}

function parseRecordDecisionArgv(argv: readonly string[]): ParsedCommand {
	if (argv.includes("--version")) return { kind: "version" };
	if (argv.includes("--help") || argv.includes("-h")) {
		if (argv.includes("commands")) return { kind: "help", command: "commands" };
		return { kind: "help", command: "plan" };
	}
	if (argv[0] === "help") {
		return { kind: "help", command: argv[1] === "commands" ? "commands" : "plan" };
	}
	if (argv[0] === "commands") {
		return parseCommandsCommand(argv.slice(1));
	}
	return parsePlanCommand(argv);
}

function parseCommandsCommand(argv: readonly string[]): ParsedCommand {
	let json = false;
	for (const arg of argv) {
		if (arg === "--json") {
			json = true;
		} else {
			throw usageError(`unknown option for commands: ${arg}`);
		}
	}
	if (!json) {
		throw usageError("record-decision commands requires --json.");
	}
	return { kind: "commands" };
}

function parsePlanCommand(argv: readonly string[]): ParsedCommand {
	let inputPath: string | undefined;
	let execute = false;
	let json = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--json":
				json = true;
				break;
			case "--execute":
				execute = true;
				break;
			case "--input":
				inputPath = requireNext(argv, index, "--input");
				index += 1;
				break;
			default:
				if (arg.startsWith("--input=")) {
					inputPath = requireInlineValue(arg, "--input");
				} else if (arg.startsWith("-")) {
					throw usageError(`unknown option: ${arg}`);
				} else {
					throw usageError(`unexpected argument: ${arg}`);
			}
		}
	}
	if (!json) {
		throw usageError("record-decision requires --json.");
	}
	if (execute) return { kind: "execute_deferred" };
	if (!inputPath) {
		throw usageError("record-decision requires --input <decision.md>.");
	}
	return { kind: "plan", inputPath };
}

function requireNext(args: readonly string[], index: number, flag: string): string {
	const value = args[index + 1];
	if (value === undefined || value.startsWith("-")) {
		throw usageError(`${flag} requires a value.`);
	}
	return value;
}

function requireInlineValue(arg: string, flag: string): string {
	const value = arg.slice(`${flag}=`.length);
	if (value === "") throw usageError(`${flag} requires a value.`);
	return value;
}

function inferJsonMode(argv: readonly string[]): boolean {
	return argv.includes("--json");
}

function discoveryPayload() {
	return projectCommandDiscoveryTree(
		[
			["plan", recordDecisionContracts.plan],
			["commands", recordDecisionContracts.commands],
		],
		{
			includeFlagDescriptions: true,
		},
	);
}

async function runPlan(input: {
	parsed: Extract<ParsedCommand, { kind: "plan" }>;
	runtime: RecordDecisionRuntime;
}): Promise<RecordDecisionPlan> {
	let text: string;
	try {
		text = await input.runtime.readTextFile(resolve(input.parsed.inputPath));
	} catch {
		throw new RecordDecisionInputError(
			"input_unreadable",
			`Unable to read input file: ${input.parsed.inputPath}.`,
			"Check --input path and rerun dry-run planning.",
		);
	}
	const parsedInput = parseDecisionInput(text);
	return planDecisionRecord(parsedInput);
}

function writePlan(
	stdout: CliWriter,
	plan: RecordDecisionPlan,
	runId: string,
	durationMs: number,
): void {
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: runId,
			data: {
				contract_id: RECORD_DECISION_CONTRACT_ID,
				schema_version: RECORD_DECISION_SCHEMA_VERSION,
				...plan,
			},
		}),
		{ runId, durationMs },
	);
}

function writeDiscovery(
	stdout: CliWriter,
	runId: string,
	durationMs: number,
): void {
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: runId,
			data: discoveryPayload(),
		}),
		{ runId, durationMs },
	);
}

function emitError(input: {
	error: unknown;
	stdout: CliWriter;
	stderr: CliWriter;
	json: boolean;
	runId: string;
	durationMs: number;
}): number {
	const error = normalizeError(input.error);
	if (!input.json) {
		input.stderr.write(`${error.message}\n`);
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
				severity: "error",
				recoverability: "change_input",
				retryable: false,
				failure_domain: "usage",
				hint: {
					action: "change_input",
					summary: error.nextSafeAction,
				},
			},
			data: {
				changed_state: "none",
				retry_safe: false,
				next_safe_action: error.nextSafeAction,
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return error.exitCode;
}

function normalizeError(error: unknown): {
	code: string;
	message: string;
	exitCode: number;
	nextSafeAction: string;
} {
	if (error instanceof RecordDecisionInputError) {
		return {
			code: error.code,
			message: error.message,
			exitCode: 2,
			nextSafeAction: error.nextSafeAction,
		};
	}
	if (error instanceof Error) {
		return {
			code: "usage_error",
			message: error.message,
			exitCode: 2,
			nextSafeAction: "Fix command input and rerun dry-run planning.",
		};
	}
	return {
		code: "usage_error",
		message: String(error),
		exitCode: 2,
		nextSafeAction: "Fix command input and rerun dry-run planning.",
	};
}

/**
 * Run the record-decision proof-slice CLI.
 *
 * @param argv - Command-line arguments after the executable name
 * @param options - Optional runtime and writers for tests
 * @returns Process exit code
 *
 * @example
 * ```typescript
 * const exitCode = await runRecordDecisionCli(["--input", "decision.md", "--json"])
 * ```
 */
export async function runRecordDecisionCli(
	argv: readonly string[],
	options: {
		runtime?: RecordDecisionRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultRecordDecisionRuntime();
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;

	let parsedDiagnostics: ParsedCliDiagnosticArgv;
	try {
		parsedDiagnostics = parseCliDiagnosticArgv(argv);
	} catch (error) {
		parsedDiagnostics = parseCliDiagnosticFallbackArgv(argv);
		return emitError({
			error,
			stdout,
			stderr,
			json: inferJsonMode(argv),
			runId: parsedDiagnostics.options.runId,
			durationMs: runtime.now() - parsedDiagnostics.options.startedAtMs,
		});
	}

	const runId = parsedDiagnostics.options.runId;
	const startedAt = parsedDiagnostics.options.startedAtMs;
	let parsed: ParsedCommand;
	try {
		parsed = parseRecordDecisionArgv(parsedDiagnostics.argv);
	} catch (error) {
		return emitError({
			error,
			stdout,
			stderr,
			json: inferJsonMode(parsedDiagnostics.argv),
			runId,
			durationMs: runtime.now() - startedAt,
		});
	}

	if (parsed.kind === "version") {
		stdout.write(`record-decision ${VERSION}\n`);
		return 0;
	}
	if (parsed.kind === "help") {
		stdout.write(renderCommandUsage(recordDecisionContracts[parsed.command ?? "plan"]));
		return 0;
	}
	if (parsed.kind === "commands") {
		writeDiscovery(stdout, runId, runtime.now() - startedAt);
		return 0;
	}
	if (parsed.kind === "execute_deferred") {
		return emitError({
			error: new RecordDecisionInputError(
				"execute_deferred",
				"Execute writes are deferred in this proof slice.",
				"Run without --execute to get a dry-run mutation plan.",
			),
			stdout,
			stderr,
			json: inferJsonMode(parsedDiagnostics.argv),
			runId,
			durationMs: runtime.now() - startedAt,
		});
	}

	try {
		const plan = await runPlan({ parsed, runtime });
		writePlan(stdout, plan, runId, runtime.now() - startedAt);
		return 0;
	} catch (error) {
		return emitError({
			error,
			stdout,
			stderr,
			json: inferJsonMode(parsedDiagnostics.argv),
			runId,
			durationMs: runtime.now() - startedAt,
		});
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

/**
 * Run the CLI with in-memory writers for tests.
 *
 * @param argv - Command-line arguments after the executable name
 * @param runtime - Runtime adapter used to isolate filesystem behavior
 * @returns Captured exit code, stdout, and stderr
 *
 * @example
 * ```typescript
 * const result = await runForTest(["commands", "--json"])
 * ```
 */
export async function runForTest(
	argv: readonly string[],
	runtime: RecordDecisionRuntime = createDefaultRecordDecisionRuntime(),
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runRecordDecisionCli(argv, { runtime, stdout, stderr });
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

if (import.meta.main) {
	const exitCode = await runRecordDecisionCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
