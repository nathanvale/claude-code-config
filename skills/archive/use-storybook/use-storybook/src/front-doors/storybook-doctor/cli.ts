#!/usr/bin/env bun

import {
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	CliUsageError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	createCliUsageRuntimeError,
	createCliRepairStateRuntimeError,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	projectCommandDiscoveryTree,
	renderCommandUsage,
	usageError,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	type StorybookDoctorCommand,
	storybookDoctorContracts,
} from "./command-contract.ts";
import { runDeep } from "./deep-doctor.ts";
import { runCheck } from "./readiness-engine.ts";
import {
	createDefaultStorybookDoctorRuntime,
	type StorybookDoctorRuntime,
} from "./runtime.ts";

const VERSION = "0.1.0";

type ParsedCommand =
	| { kind: "help"; command?: "check" | "deep" | "commands" }
	| { kind: "version" }
	| { kind: "commands" }
	| { kind: "check"; url?: string; repo?: string }
	| { kind: "deep"; url?: string; repo?: string };

function parseStorybookDoctorArgv(argv: readonly string[]): ParsedCommand {
	if (argv.includes("--version")) return { kind: "version" };
	if (argv.includes("--help") || argv.includes("-h")) {
		const cmd = findCommandName(argv);
		return { kind: "help", command: cmd };
	}
	if (argv[0] === "help") {
		const cmd = argv[1] as "check" | "deep" | "commands" | undefined;
		return {
			kind: "help",
			command: cmd && cmd in storybookDoctorContracts ? cmd : "check",
		};
	}
	if (argv[0] === "commands") return parseCommandsArgv(argv.slice(1));
	if (argv[0] === "check") return parseCheckDeepArgv("check", argv.slice(1));
	if (argv[0] === "deep") return parseCheckDeepArgv("deep", argv.slice(1));
	if (argv.length === 0) return { kind: "help" };
	throw usageError(`unknown command: ${argv[0]}`);
}

function findCommandName(
	argv: readonly string[],
): "check" | "deep" | "commands" | undefined {
	for (const arg of argv) {
		if (arg === "check" || arg === "deep" || arg === "commands") return arg;
	}
	return undefined;
}

function parseCommandsArgv(argv: readonly string[]): ParsedCommand {
	let json = false;
	for (const arg of argv) {
		if (arg === "--json") {
			json = true;
		} else {
			throw usageError(`unknown option for commands: ${arg}`);
		}
	}
	if (!json) {
		throw usageError("storybook-doctor commands requires --json.");
	}
	return { kind: "commands" };
}

function parseCheckDeepArgv(
	kind: "check" | "deep",
	argv: readonly string[],
): ParsedCommand {
	let json = false;
	let url: string | undefined;
	let repo: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case "--json":
				json = true;
				break;
			case "--url":
				url = requireNext(argv, i, "--url");
				i++;
				break;
			case "--repo":
				repo = requireNext(argv, i, "--repo");
				i++;
				break;
			default:
				if (arg.startsWith("--url=")) {
					url = requireInlineValue(arg, "--url");
				} else if (arg.startsWith("--repo=")) {
					repo = requireInlineValue(arg, "--repo");
				} else if (arg.startsWith("-")) {
					throw usageError(`unknown option: ${arg}`);
				} else {
					throw usageError(`unexpected argument: ${arg}`);
				}
		}
	}
	if (!json) {
		throw usageError(`storybook-doctor ${kind} requires --json.`);
	}
	return { kind, url, repo };
}

function requireNext(
	args: readonly string[],
	index: number,
	flag: string,
): string {
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
	const entries = Object.entries(storybookDoctorContracts) as Array<
		[
			StorybookDoctorCommand,
			(typeof storybookDoctorContracts)[StorybookDoctorCommand],
		]
	>;
	return projectCommandDiscoveryTree(entries, {
		includeFlagDescriptions: true,
	});
}

function writeSuccess(
	stdout: CliWriter,
	command: StorybookDoctorCommand,
	data: object,
	runId: string,
	durationMs: number,
): void {
	const contract = storybookDoctorContracts[command];
	const rc = contract.resultContract;
	const envelope = {
		...data,
		contract_id: rc.id,
		schema_version: rc.schema_version,
	};
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: runId,
			data: envelope as Record<string, unknown>,
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
	const err = normalizeError(input.error);
	if (!input.json) {
		input.stderr.write(`${err.message}\n`);
		return err.exitCode;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: err.exitCode,
			error:
				err.exitCode === 2
					? createCliUsageRuntimeError({
							run_id: input.runId,
							code: err.code,
							message: err.message,
							hint: {
								action: "change_input",
								summary: err.nextSafeAction,
							},
							failure_domain: "usage",
						})
					: createCliRepairStateRuntimeError({
							run_id: input.runId,
							code: err.code,
							message: err.message,
							exit_code: err.exitCode,
							hint: {
								action: "repair_state",
								summary: err.nextSafeAction,
							},
							failure_domain: "runtime",
						}),
			data: {
				changed_state: "none",
				retry_safe: false,
				next_safe_action: err.nextSafeAction,
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return err.exitCode;
}

function normalizeError(error: unknown): {
	code: string;
	message: string;
	exitCode: number;
	nextSafeAction: string;
} {
	if (error instanceof CliUsageError) {
		return {
			code: "usage_error",
			message: error.message,
			exitCode: 2,
			nextSafeAction: "Fix command input and rerun.",
		};
	}
	if (error instanceof Error) {
		return {
			code: "runtime_failure",
			message: error.message,
			exitCode: 1,
			nextSafeAction: "Check runtime environment and rerun.",
		};
	}
	return {
		code: "runtime_failure",
		message: String(error),
		exitCode: 1,
		nextSafeAction: "Check runtime environment and rerun.",
	};
}

export async function runStorybookDoctorCli(
	argv: readonly string[],
	options: {
		runtime?: StorybookDoctorRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime =
		options.runtime ?? createDefaultStorybookDoctorRuntime();
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
		parsed = parseStorybookDoctorArgv(parsedDiagnostics.argv);
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
		stdout.write(`storybook-doctor ${VERSION}\n`);
		return 0;
	}
	if (parsed.kind === "help") {
		const contract =
			storybookDoctorContracts[parsed.command ?? "check"];
		stdout.write(renderCommandUsage(contract));
		return 0;
	}
	if (parsed.kind === "commands") {
		writeSuccess(
			stdout,
			"commands",
			discoveryPayload(),
			runId,
			runtime.now() - startedAt,
		);
		return 0;
	}

	try {
		if (parsed.kind === "check") {
			const result = await runCheck(runtime, {
				url: parsed.url,
				repo: parsed.repo,
			});
			writeSuccess(stdout, "check", result, runId, runtime.now() - startedAt);
			return 0;
		}
		const result = await runDeep(runtime, {
			url: parsed.url,
			repo: parsed.repo,
		});
		writeSuccess(stdout, "deep", result, runId, runtime.now() - startedAt);
		return 0;
	} catch (error) {
		return emitError({
			error,
			stdout,
			stderr,
			json: true,
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

export async function runForTest(
	argv: readonly string[],
	runtime: StorybookDoctorRuntime = createDefaultStorybookDoctorRuntime(),
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runStorybookDoctorCli(argv, {
		runtime,
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

if (import.meta.main) {
	const exitCode = await runStorybookDoctorCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
