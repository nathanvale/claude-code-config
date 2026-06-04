#!/usr/bin/env bun

import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { delimiter, join, resolve } from "node:path";
import {
	type CliWriter,
	CliUsageError,
	renderCommandUsage,
	usageError,
} from "@side-quest/cli-command-facade";
import {
	DEFAULT_MAX_OUTPUT_BYTES,
	FALLOW_RUNNER_COMMANDS,
	FALLOW_RUNNER_CONTRACT_ID,
	FALLOW_RUNNER_SCHEMA_VERSION,
	type FallowFailureCategory,
	type FallowRepairAction,
	type FallowRunnerCommand,
	type FallowStatus,
	type FallowStderrCategory,
	type FallowWriteEffect,
	fallowRunnerContracts,
} from "./command-contract";

const VERSION = "0.1.0";
const execFileAsync = promisify(execFile);

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type FallowRunnerRuntime = {
	cwd: string;
	env: Record<string, string | undefined>;
	now: () => number;
	randomId: () => string;
	isDirectory: (path: string) => Promise<boolean>;
	pathExists: (path: string) => Promise<boolean>;
	isExecutable: (path: string) => Promise<boolean>;
	lookupExecutable: (name: string) => Promise<string | undefined>;
	runCommand: (
		command: string,
		args: readonly string[],
		options: { cwd: string },
	) => Promise<CommandResult>;
};

type ParsedCommand = {
	kind: "command";
	command: FallowRunnerCommand;
	root?: string;
	includeRawOutput: boolean;
	maxOutputBytes: number;
	baseRef?: string;
};

type ParsedArgv =
	| { kind: "help"; command?: FallowRunnerCommand }
	| { kind: "version" }
	| ParsedCommand;

type RepairHint = {
	action: FallowRepairAction;
	message: string;
	retry_safe: boolean;
};

type BinaryReadiness = {
	status: "ok" | "missing";
	source?: "local" | "path";
	path?: string;
};

type RepoShapeReadiness = {
	status: "ok" | "unsupported";
	detected: string[];
};

type GitReadiness = {
	status: "ok" | "blocked";
	message?: string;
};

type ConfigReadiness = {
	present: boolean;
	paths: string[];
};

type ReadinessSummary = {
	root: {
		status: "ok";
		path: string;
	};
	repo_shape: RepoShapeReadiness;
	fallow_binary: BinaryReadiness;
	config: ConfigReadiness;
	git: GitReadiness;
};

type FallowRunnerSummary = {
	total_findings: number;
	auto_fixable: number;
	needs_trace: number;
	needs_human: number;
	readiness?: ReadinessSummary;
};

type FallowRunnerEnvelope = {
	contract_id: typeof FALLOW_RUNNER_CONTRACT_ID;
	schema_version: typeof FALLOW_RUNNER_SCHEMA_VERSION;
	status: FallowStatus;
	mode: FallowRunnerCommand;
	run_id: string;
	command: string[];
	cwd: string;
	exit_code: number;
	stderr_category: FallowStderrCategory;
	failure_category: FallowFailureCategory;
	write_effect: FallowWriteEffect;
	fallow_output: unknown;
	output_budget: {
		status: "within-budget";
		max_output_bytes: number;
		raw_output_requested: boolean;
		raw_output_included: boolean;
	};
	summary: FallowRunnerSummary;
	repair_hints: RepairHint[];
};

const COMMON_CONFIG_PATHS = [
	".fallowrc",
	".fallowrc.json",
	"fallow.toml",
	"fallow.config.js",
	"fallow.config.ts",
] as const;

const LOCAL_FALLOW_PATHS = [
	"node_modules/.bin/fallow",
	"node_modules/.bin/fallow.cmd",
] as const;

const UNSUPPORTED_PUBLIC_CONTROLS = new Set([
	"--cwd",
	"--mode",
	"--watch",
	"--baseline",
	"--generate-ci",
	"--ci",
	"--create-ci",
	"--update-baseline",
]);

export function createDefaultFallowRuntime(
	overrides: Partial<FallowRunnerRuntime> = {},
): FallowRunnerRuntime {
	const env = { ...process.env, ...(overrides.env ?? {}) };
	const runtime: FallowRunnerRuntime = {
		cwd: process.cwd(),
		env,
		now: () => Date.now(),
		randomId: () => Math.random().toString(36).slice(2, 8),
		isDirectory: async (path) => {
			try {
				return (await stat(path)).isDirectory();
			} catch {
				return false;
			}
		},
		pathExists: async (path) => {
			try {
				await stat(path);
				return true;
			} catch {
				return false;
			}
		},
		isExecutable: async (path) => {
			try {
				await access(path, constants.X_OK);
				return true;
			} catch {
				return false;
			}
		},
		lookupExecutable: async (name) => lookupExecutable(name, env),
		runCommand: async (command, args, options) => runCommand(command, args, options),
	};
	return { ...runtime, ...overrides, env };
}

export async function runFallowRunnerCli(
	argv: readonly string[],
	options: {
		runtime?: FallowRunnerRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultFallowRuntime();
	const stdout = options.stdout ?? process.stdout;
	let parsed: ParsedArgv;
	try {
		parsed = parseFallowArgv(argv);
	} catch (error) {
		if (error instanceof CliUsageError) {
			return emitUsageError(argv, runtime, stdout, error);
		}
		throw error;
	}

	if (parsed.kind === "help") {
		stdout.write(renderHelp(parsed.command));
		return 0;
	}
	if (parsed.kind === "version") {
		stdout.write(`fallow-runner ${VERSION}\n`);
		return 0;
	}

	return runParsedCommand(parsed, runtime, stdout);
}

async function runParsedCommand(
	parsed: ParsedCommand,
	runtime: FallowRunnerRuntime,
	stdout: CliWriter,
): Promise<number> {
	const runId = makeRunId(runtime);
	const root = resolve(runtime.cwd, parsed.root ?? ".");
	const maxOutputBytes = parsed.maxOutputBytes;
	const rawRequested = parsed.includeRawOutput;

	if (!(await runtime.isDirectory(root))) {
		writeEnvelope(
			stdout,
			makeEnvelope({
				status: "blocked",
				mode: parsed.command,
				runId,
				command: commandFor(parsed),
				cwd: root,
				exitCode: 1,
				failureCategory: "input",
				writeEffect: "none",
				maxOutputBytes,
				rawRequested,
				repairHints: [
					{
						action: "fix-input",
						message: "Choose an existing target repository root.",
						retry_safe: false,
					},
				],
			}),
		);
		return 1;
	}

	const readiness = await inspectReadiness(root, runtime);
	if (parsed.command === "doctor") {
		return emitDoctor(parsed, readiness, runtime, stdout, runId);
	}

	const blockingHint = blockingReadinessHint(parsed.command, readiness);
	if (blockingHint) {
		writeEnvelope(
			stdout,
			makeEnvelope({
				status: "blocked",
				mode: parsed.command,
				runId,
				command: commandFor(parsed),
				cwd: root,
				exitCode: 1,
				failureCategory: "setup",
				writeEffect: "none",
				maxOutputBytes,
				rawRequested,
				summary: summaryWithReadiness(readiness),
				repairHints: [blockingHint],
			}),
		);
		return 1;
	}

	writeEnvelope(
		stdout,
		makeEnvelope({
			status: "blocked",
			mode: parsed.command,
			runId,
			command: commandFor(parsed),
			cwd: root,
			exitCode: 1,
			failureCategory: "fallow",
			writeEffect: "none",
			maxOutputBytes,
			rawRequested,
			summary: summaryWithReadiness(readiness),
			repairHints: [
				{
					action: "retry",
					message: "Fallow execution is implemented in a later runner unit.",
					retry_safe: false,
				},
			],
		}),
	);
	return 1;
}

function emitDoctor(
	parsed: ParsedCommand,
	readiness: ReadinessSummary,
	runtime: FallowRunnerRuntime,
	stdout: CliWriter,
	runId: string,
): number {
	const mandatoryBlocked =
		readiness.repo_shape.status !== "ok" ||
		readiness.fallow_binary.status !== "ok";
	const status: FallowStatus = mandatoryBlocked
		? "blocked"
		: readiness.git.status === "ok"
			? "ok"
			: "issues";
	const exitCode = mandatoryBlocked ? 1 : 0;
	const repairHints = mandatoryBlocked
		? [blockingReadinessHint("doctor", readiness)].filter(isRepairHint)
		: readiness.git.status === "ok"
			? []
			: [
					{
						action: "fix-input",
						message: "Repair git readiness before audit.",
						retry_safe: false,
					} satisfies RepairHint,
				];

	writeEnvelope(
		stdout,
		makeEnvelope({
			status,
			mode: "doctor",
			runId,
			command: ["fallow-runner", "doctor"],
			cwd: readiness.root.path,
			exitCode,
			failureCategory: mandatoryBlocked ? "setup" : "none",
			writeEffect: "none",
			maxOutputBytes: parsed.maxOutputBytes,
			rawRequested: parsed.includeRawOutput,
			summary: summaryWithReadiness(readiness),
			repairHints,
		}),
	);
	return exitCode;
}

async function inspectReadiness(
	root: string,
	runtime: FallowRunnerRuntime,
): Promise<ReadinessSummary> {
	const [repoShape, fallowBinary, config, git] = await Promise.all([
		detectRepoShape(root, runtime),
		resolveFallowBinary(root, runtime),
		detectConfig(root, runtime),
		checkGitReadiness(root, runtime),
	]);

	return {
		root: { status: "ok", path: root },
		repo_shape: repoShape,
		fallow_binary: fallowBinary,
		config,
		git,
	};
}

async function detectRepoShape(
	root: string,
	runtime: FallowRunnerRuntime,
): Promise<RepoShapeReadiness> {
	const probes = [
		["package.json", "package.json"],
		["tsconfig.json", "tsconfig.json"],
		["jsconfig.json", "jsconfig.json"],
	] as const;
	const detected: string[] = [];
	for (const [relative, label] of probes) {
		if (await runtime.pathExists(join(root, relative))) detected.push(label);
	}
	return {
		status: detected.length > 0 ? "ok" : "unsupported",
		detected,
	};
}

async function resolveFallowBinary(
	root: string,
	runtime: FallowRunnerRuntime,
): Promise<BinaryReadiness> {
	for (const relative of LOCAL_FALLOW_PATHS) {
		const path = join(root, relative);
		if ((await runtime.pathExists(path)) && (await runtime.isExecutable(path))) {
			return { status: "ok", source: "local", path };
		}
	}

	const path = await runtime.lookupExecutable("fallow");
	if (path) return { status: "ok", source: "path", path };
	return { status: "missing" };
}

async function detectConfig(
	root: string,
	runtime: FallowRunnerRuntime,
): Promise<ConfigReadiness> {
	const paths: string[] = [];
	for (const relative of COMMON_CONFIG_PATHS) {
		const path = join(root, relative);
		if (await runtime.pathExists(path)) paths.push(path);
	}
	return { present: paths.length > 0, paths };
}

async function checkGitReadiness(
	root: string,
	runtime: FallowRunnerRuntime,
): Promise<GitReadiness> {
	const result = await runtime.runCommand(
		"git",
		["-C", root, "rev-parse", "--is-inside-work-tree"],
		{ cwd: root },
	);
	if (result.exitCode === 0 && result.stdout.trim() === "true") {
		return { status: "ok" };
	}
	return {
		status: "blocked",
		message: result.stderr.trim() || "git work tree not available",
	};
}

function blockingReadinessHint(
	command: FallowRunnerCommand,
	readiness: ReadinessSummary,
): RepairHint | undefined {
	if (readiness.repo_shape.status !== "ok") {
		return {
			action: "fix-input",
			message: "Choose a JavaScript or TypeScript repository root.",
			retry_safe: false,
		};
	}
	if (readiness.fallow_binary.status !== "ok") {
		return {
			action: "setup-fallow",
			message: "Expose a project-local or PATH Fallow binary.",
			retry_safe: false,
		};
	}
	if (command === "audit" && readiness.git.status !== "ok") {
		return {
			action: "fix-input",
			message: "Repair git readiness before audit.",
			retry_safe: false,
		};
	}
	return undefined;
}

function summaryWithReadiness(readiness: ReadinessSummary): FallowRunnerSummary {
	return {
		...emptySummary(),
		readiness,
	};
}

function makeEnvelope(input: {
	status: FallowStatus;
	mode: FallowRunnerCommand;
	runId: string;
	command: string[];
	cwd: string;
	exitCode: number;
	failureCategory: FallowFailureCategory;
	writeEffect: FallowWriteEffect;
	maxOutputBytes: number;
	rawRequested: boolean;
	summary?: FallowRunnerSummary;
	repairHints?: RepairHint[];
}): FallowRunnerEnvelope {
	return {
		contract_id: FALLOW_RUNNER_CONTRACT_ID,
		schema_version: FALLOW_RUNNER_SCHEMA_VERSION,
		status: input.status,
		mode: input.mode,
		run_id: input.runId,
		command: input.command,
		cwd: input.cwd,
		exit_code: input.exitCode,
		stderr_category: "empty",
		failure_category: input.failureCategory,
		write_effect: input.writeEffect,
		fallow_output: null,
		output_budget: {
			status: "within-budget",
			max_output_bytes: input.maxOutputBytes,
			raw_output_requested: input.rawRequested,
			raw_output_included: false,
		},
		summary: input.summary ?? emptySummary(),
		repair_hints: input.repairHints ?? [],
	};
}

function emptySummary(): FallowRunnerSummary {
	return {
		total_findings: 0,
		auto_fixable: 0,
		needs_trace: 0,
		needs_human: 0,
	};
}

function parseFallowArgv(argv: readonly string[]): ParsedArgv {
	if (argv.includes("-h") || argv.includes("--help")) {
		return { kind: "help", command: findCommand(argv) };
	}
	if (argv.includes("--version")) {
		return { kind: "version" };
	}

	const command = findCommand(argv);
	if (!command) {
		throw usageError(
			`missing command: expected ${FALLOW_RUNNER_COMMANDS.join(", ")}.`,
		);
	}

	const commandIndex = argv.findIndex((arg) => arg === command);
	const rest = [
		...argv.slice(0, commandIndex),
		...argv.slice(commandIndex + 1),
	];
	return parseCommandOptions(command, rest);
}

function parseCommandOptions(
	command: FallowRunnerCommand,
	argv: readonly string[],
): ParsedCommand {
	const parsed: ParsedCommand = {
		kind: "command",
		command,
		includeRawOutput: false,
		maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
	};
	const allowedFlags = new Set(Object.keys(fallowRunnerContracts[command].flags));

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("-")) {
			throw usageError(`unexpected argument: ${arg}`);
		}

		const { name, inlineValue } = splitFlag(arg);
		if (UNSUPPORTED_PUBLIC_CONTROLS.has(name) || !allowedFlags.has(name)) {
			throw usageError(`unknown option: ${name}`);
		}

		if (name === "--include-raw-output") {
			if (inlineValue !== undefined) {
				throw usageError(`${name} does not accept a value`);
			}
			parsed.includeRawOutput = true;
			continue;
		}

		const value =
			inlineValue ?? readRequiredFlagValue(argv, index, name);
		if (inlineValue === undefined) index += 1;

		if (name === "--root") parsed.root = value;
		else if (name === "--base-ref") parsed.baseRef = value;
		else if (name === "--max-output-bytes") {
			parsed.maxOutputBytes = parseMaxOutputBytes(value);
		}
	}

	return parsed;
}

function findCommand(
	argv: readonly string[],
): FallowRunnerCommand | undefined {
	const candidate = argv.find((arg) => !arg.startsWith("-"));
	if (!candidate) return undefined;
	if ((FALLOW_RUNNER_COMMANDS as readonly string[]).includes(candidate)) {
		return candidate as FallowRunnerCommand;
	}
	throw usageError(`unknown command: ${candidate}`);
}

function splitFlag(arg: string): { name: string; inlineValue?: string } {
	const index = arg.indexOf("=");
	if (index === -1) return { name: arg };
	return { name: arg.slice(0, index), inlineValue: arg.slice(index + 1) };
}

function readRequiredFlagValue(
	argv: readonly string[],
	index: number,
	flag: string,
): string {
	const value = argv[index + 1];
	if (!value || value.startsWith("-")) {
		throw usageError(`${flag} requires a value`);
	}
	return value;
}

function parseMaxOutputBytes(value: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw usageError("--max-output-bytes must be a positive integer");
	}
	return parsed;
}

function commandFor(parsed: ParsedCommand): string[] {
	if (parsed.command === "doctor") return ["fallow-runner", "doctor"];
	const command = ["fallow", parsed.command, "--format", "json", "--quiet"];
	if (parsed.command === "audit" && parsed.baseRef) {
		command.push("--base-ref", parsed.baseRef);
	}
	return command;
}

function renderHelp(command?: FallowRunnerCommand): string {
	if (command) return renderCommandUsage(fallowRunnerContracts[command]);
	const commandLines = Object.entries(fallowRunnerContracts).map(
		([name, contract]) => `  ${name.padEnd(12)} ${contract.summary}`,
	);
	return [
		"Usage: fallow-runner <command> [flags]",
		"",
		"Commands:",
		...commandLines,
		"",
		"Other:",
		"  -h, --help     Show help.",
		"  --version      Print version.",
		"",
	].join("\n");
}

function makeRunId(runtime: FallowRunnerRuntime): string {
	return `fallow:${new Date(runtime.now()).toISOString()}:${runtime.randomId()}`;
}

function writeEnvelope(stdout: CliWriter, envelope: FallowRunnerEnvelope): void {
	stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

function isRepairHint(value: RepairHint | undefined): value is RepairHint {
	return value !== undefined;
}

async function lookupExecutable(
	name: string,
	env: Record<string, string | undefined>,
): Promise<string | undefined> {
	for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
		const path = join(directory, name);
		try {
			await access(path, constants.X_OK);
			return path;
		} catch {
			// Continue searching PATH.
		}
	}
	return undefined;
}

async function runCommand(
	command: string,
	args: readonly string[],
	options: { cwd: string },
): Promise<CommandResult> {
	try {
		const result = await execFileAsync(command, [...args], {
			cwd: options.cwd,
			encoding: "utf-8",
		});
		return {
			exitCode: 0,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	} catch (error) {
		if (isExecError(error)) {
			return {
				exitCode:
					typeof error.code === "number" ? error.code : 1,
				stdout: typeof error.stdout === "string" ? error.stdout : "",
				stderr: typeof error.stderr === "string" ? error.stderr : "",
			};
		}
		return { exitCode: 1, stdout: "", stderr: String(error) };
	}
}

function isExecError(
	error: unknown,
): error is { code?: unknown; stdout?: unknown; stderr?: unknown } {
	return typeof error === "object" && error !== null;
}

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
	runtime: FallowRunnerRuntime = createDefaultFallowRuntime(),
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runFallowRunnerCli(argv, { runtime, stdout, stderr });
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

function emitUsageError(
	argv: readonly string[],
	runtime: FallowRunnerRuntime,
	stdout: CliWriter,
	error: CliUsageError,
): number {
	const exitCode = error.options.exitCode ?? 2;
	const command = safeFindCommand(argv);
	const placeholderCommand: ParsedCommand | undefined = command
		? {
				kind: "command",
				command,
				includeRawOutput: false,
				maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
			}
		: undefined;
	writeEnvelope(
		stdout,
		makeEnvelope({
			status: "blocked",
			mode: command ?? "doctor",
			runId: makeRunId(runtime),
			command: placeholderCommand ? commandFor(placeholderCommand) : ["fallow-runner"],
			cwd: runtime.cwd,
			exitCode,
			failureCategory: "input",
			writeEffect: "none",
			maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
			rawRequested: false,
			repairHints: [
				{
					action: "fix-input",
					message: error.message,
					retry_safe: false,
				},
			],
		}),
	);
	return exitCode;
}

function safeFindCommand(argv: readonly string[]): FallowRunnerCommand | undefined {
	const candidate = argv.find((arg) => !arg.startsWith("-"));
	if (
		candidate &&
		(FALLOW_RUNNER_COMMANDS as readonly string[]).includes(candidate)
	) {
		return candidate as FallowRunnerCommand;
	}
	return undefined;
}

if (import.meta.main) {
	let exitCode = 0;
	try {
		exitCode = await runFallowRunnerCli(Bun.argv.slice(2));
	} catch (error) {
		if (error instanceof CliUsageError) {
			process.stderr.write(`${error.message}\n`);
			exitCode = error.options.exitCode ?? 2;
		} else {
			throw error;
		}
	}
	process.exit(exitCode);
}
