#!/usr/bin/env bun

import {
	type CliWriter,
	type CommandResultPayload,
	type ParsedCliDiagnosticArgv,
	createCliRepairStateRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	createCliUsageRuntimeError,
	createCommandResultData,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	projectCommandDiscoveryTree,
	renderCommandUsage,
	usageError,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
	type RecordDecisionCommand,
	recordDecisionContracts,
} from "./command-contract.ts";
import {
	type PreparedDecisionRecord,
	type RecordDecisionExecuteResult,
	type RecordDecisionPlan,
	RecordDecisionInputError,
} from "./model.ts";
import {
	executeDecisionRecord,
	parseDecisionInput,
	planDecisionRecord,
	prepareDecisionRecord,
	resolveDecisionTargetLog,
} from "./record-engine.ts";

const VERSION = "0.1.0";

type ParsedCommand =
	| { kind: "help"; command?: "plan" | "commands" }
	| { kind: "version" }
	| { kind: "commands" }
	| { kind: "execute"; inputPath: string }
	| { kind: "plan"; inputPath: string };

/**
 * Runtime adapter for filesystem and clock operations used by the CLI.
 */
export type RecordDecisionRuntime = {
	now: () => number;
	cwd: () => string;
	repoRoot: () => string;
	readTextFile: (path: string) => Promise<string>;
	writeTextFile: (path: string, content: string) => Promise<void>;
	renameFile: (from: string, to: string) => Promise<void>;
	removeFile: (path: string) => Promise<void>;
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
		cwd: () => process.env.INIT_CWD ?? process.cwd(),
		repoRoot: () => resolve(import.meta.dir, "../../.."),
		readTextFile: async (path) => readFile(path, "utf8"),
		writeTextFile: async (path, content) => writeFile(path, content, "utf8"),
		renameFile: async (from, to) => rename(from, to),
		removeFile: async (path) => rm(path, { force: true }),
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
	if (!inputPath) {
		throw usageError("record-decision requires --input <decision.md>.");
	}
	if (execute) return { kind: "execute", inputPath };
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

async function prepareRecord(input: {
	parsed: Extract<ParsedCommand, { kind: "plan" | "execute" }>;
	runtime: RecordDecisionRuntime;
}): Promise<PreparedDecisionRecord> {
	const decidedAt = dateFromMs(input.runtime.now());
	const text = await readInputText(input.parsed.inputPath, input.runtime);
	const parsedInput = parseDecisionInput(text);
	const targetLog = resolveDecisionTargetLog(parsedInput, decidedAt);
	let existingLogText: string | undefined;
	try {
		existingLogText = await input.runtime.readTextFile(
			resolveRepoPath(input.runtime, targetLog),
		);
	} catch {
		existingLogText = undefined;
	}
	return prepareDecisionRecord(parsedInput, { existingLogText, decidedAt });
}

async function readInputText(
	inputPath: string,
	runtime: RecordDecisionRuntime,
): Promise<string> {
	for (const candidate of resolveInputCandidates(inputPath, runtime)) {
		try {
			return await runtime.readTextFile(candidate);
		} catch {
			// Try the next deterministic base before reporting an unreadable input.
		}
	}
	throw new RecordDecisionInputError(
		"input_unreadable",
		`Unable to read input file: ${inputPath}.`,
		"Check --input path and rerun dry-run planning.",
	);
}

function resolveInputCandidates(
	inputPath: string,
	runtime: RecordDecisionRuntime,
): string[] {
	if (isAbsolute(inputPath)) return [inputPath];
	return uniquePaths([
		resolve(runtime.cwd(), inputPath),
		resolve(runtime.repoRoot(), inputPath),
	]);
}

function resolveRepoPath(runtime: RecordDecisionRuntime, repoRelativePath: string): string {
	return resolve(runtime.repoRoot(), repoRelativePath);
}

function uniquePaths(paths: readonly string[]): string[] {
	return [...new Set(paths)];
}

async function runPlan(input: {
	parsed: Extract<ParsedCommand, { kind: "plan" }>;
	runtime: RecordDecisionRuntime;
}): Promise<RecordDecisionPlan> {
	return planDecisionRecord(await prepareRecord(input));
}

async function runExecute(input: {
	parsed: Extract<ParsedCommand, { kind: "execute" }>;
	runtime: RecordDecisionRuntime;
	runId: string;
}): Promise<RecordDecisionExecuteResult> {
	const prepared = await prepareRecord(input);
	await writePreparedRecord(prepared, input.runtime, input.runId);
	return executeDecisionRecord(prepared);
}

async function writePreparedRecord(
	prepared: PreparedDecisionRecord,
	runtime: RecordDecisionRuntime,
	runId: string,
): Promise<void> {
	const targetPath = resolveRepoPath(runtime, prepared.target.target_log);
	const tempPath = `${targetPath}.tmp-${sanitizeRunId(runId)}`;
	try {
		await runtime.writeTextFile(tempPath, prepared.replacement_text);
		await runtime.renameFile(tempPath, targetPath);
	} catch {
		await runtime.removeFile(tempPath).catch(() => undefined);
		throw new RecordDecisionInputError(
			"write_failed",
			`Failed to replace target decision log: ${prepared.target.target_log}.`,
			"Repair filesystem permissions or target state, then rerun after reviewing the dry-run plan.",
		);
	}
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
			data: resultData("plan", plan),
		}),
		{ runId, durationMs },
	);
}

function writeExecuteResult(
	stdout: CliWriter,
	result: RecordDecisionExecuteResult,
	runId: string,
	durationMs: number,
): void {
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: runId,
			data: resultData("plan", result),
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
			data: resultData("commands", discoveryPayload()),
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
			error:
				error.recoverability === "change_input"
					? createCliUsageRuntimeError({
							run_id: input.runId,
							code: error.code,
							message: error.message,
							hint: {
								action: "change_input",
								summary: error.nextSafeAction,
							},
							failure_domain: error.failureDomain,
						})
					: createCliRepairStateRuntimeError({
							run_id: input.runId,
							code: error.code,
							message: error.message,
							exit_code: error.exitCode,
							hint: {
								action: "repair_state",
								summary: error.nextSafeAction,
							},
							failure_domain: error.failureDomain,
						}),
			data: {
				changed_state: error.changedState,
				retry_safe: error.retrySafe,
				next_safe_action: error.nextSafeAction,
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return error.exitCode;
}

function resultData<TData extends object>(
	command: RecordDecisionCommand,
	data: CommandResultPayload<TData>,
): Record<string, unknown> {
	return createCommandResultData(recordDecisionContracts[command], data);
}

function normalizeError(error: unknown): {
	code: string;
	message: string;
	exitCode: number;
	nextSafeAction: string;
	recoverability: "change_input" | "repair_state";
	retryable: false;
	hintAction: "change_input" | "repair_state";
	failureDomain: string;
	changedState: "none";
	retrySafe: false;
} {
	if (error instanceof RecordDecisionInputError) {
		const recovery = recoveryForCode(error.code);
		return {
			code: error.code,
			message: error.message,
			exitCode: 2,
			nextSafeAction: error.nextSafeAction,
			...recovery,
		};
	}
	if (error instanceof Error) {
		return {
			code: "usage_error",
			message: error.message,
			exitCode: 2,
			nextSafeAction: "Fix command input and rerun dry-run planning.",
			...recoveryForCode("usage_error"),
		};
	}
	return {
		code: "usage_error",
		message: String(error),
		exitCode: 2,
		nextSafeAction: "Fix command input and rerun dry-run planning.",
		...recoveryForCode("usage_error"),
	};
}

function recoveryForCode(code: string): {
	recoverability: "change_input" | "repair_state";
	retryable: false;
	hintAction: "change_input" | "repair_state";
	failureDomain: string;
	changedState: "none";
	retrySafe: false;
} {
	if (code === "write_failed" || code === "target_log_invalid") {
		return {
			recoverability: "repair_state",
			retryable: false,
			hintAction: "repair_state",
			failureDomain: "record_decision_write",
			changedState: "none",
			retrySafe: false,
		};
	}
	return {
		recoverability: "change_input",
		retryable: false,
		hintAction: "change_input",
		failureDomain: "usage",
		changedState: "none",
		retrySafe: false,
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
	try {
		if (parsed.kind === "execute") {
			const result = await runExecute({ parsed, runtime, runId });
			writeExecuteResult(stdout, result, runId, runtime.now() - startedAt);
			return 0;
		}
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

function dateFromMs(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

function sanitizeRunId(runId: string): string {
	return runId.replace(/[^A-Za-z0-9_.-]/g, "_");
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
