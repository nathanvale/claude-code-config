#!/usr/bin/env bun

import { resolve } from "node:path";
import {
	type CliWriter,
	type CommandFacadeResultContract,
	type ParsedCliDiagnosticArgv,
	CliUsageError,
	createCliRepairStateRuntimeError,
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	createCliUsageRuntimeError,
	createCommandResultData,
	formatEnumFlagError,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	projectCommandDiscoveryTree,
	renderCommandUsage,
	usageError,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	type StorybookDocsLoopCommand,
	storybookDocsLoopContracts,
} from "./command-contract.ts";
import {
	DOCS_LOOP_COMMANDS,
	DOCS_LOOP_RECEIPT_STATUSES,
	DOCS_LOOP_VERIFICATION_FIELDS,
	type DocsLoopErrorPayload,
	type DocsLoopReceiptStatus,
	type DocsLoopVerificationField,
} from "./docs-loop-model.ts";
import {
	type DocsLoopInventoryBlocked,
	type DocsLoopInventoryAmbiguous,
	type DocsLoopInventoryResult,
	type DocsLoopInventorySetResult,
	discoverDocsLoopInventory,
	discoverDocsLoopInventorySet,
} from "./docs-loop-inventory.ts";
import {
	type DocsLoopDoctorPayload,
	type DocsLoopMarkPayload,
	type DocsLoopPurgePayload,
	type DocsLoopStatusPayload,
} from "./docs-loop-model.ts";
import {
	type DocsLoopRunCard,
	type DocsLoopRunState,
	advanceDocsLoopState,
	asDocsLoopRunState,
	assertDocsLoopRunStateShape,
	buildDocsLoopRunCard,
	createDocsLoopRunState,
	createLedgerSkeleton,
	deriveDocsLoopItemStatus,
	withReceipt,
} from "./docs-loop-run-card.ts";
import {
	DocsLoopStateError,
	type StorybookDocsLoopRuntime,
	createDefaultStorybookDocsLoopRuntime,
	deleteDocsLoopRun,
	findRunsOlderThan,
	listDocsLoopRunIds,
	readDocsLoopRunState,
	writeDocsLoopRunState,
} from "./docs-loop-state.ts";

const VERSION = "0.1.0";

type ParsedDocsLoopCommand =
	| { kind: "help"; command?: StorybookDocsLoopCommand }
	| { kind: "version" }
	| { kind: "commands" }
	| { kind: Exclude<StorybookDocsLoopCommand, "commands">; options: ParsedOptions };

type ParsedOptions = {
	repo?: string;
	pkg?: string;
	component?: string;
	story?: string;
	run?: string;
	batchSize?: string;
	olderThan?: string;
	field?: DocsLoopVerificationField;
	status?: DocsLoopReceiptStatus;
	reason?: string;
	json: boolean;
	plain: boolean;
	noInput: boolean;
	force: boolean;
};

const VALUE_FLAGS = new Set([
	"--repo",
	"--pkg",
	"--component",
	"--story",
	"--run",
	"--batch-size",
	"--older-than",
	"--field",
	"--status",
	"--reason",
]);

const BOOLEAN_FLAGS = new Set(["--json", "--plain", "--no-input", "--force"]);

const COMMANDS = new Set<string>(DOCS_LOOP_COMMANDS);

/**
 * Run the docs-loop CLI.
 *
 * @param argv - Command arguments after the executable name
 * @param options - Optional writers for tests and embedded callers
 * @returns Process exit code
 *
 * @example
 * ```typescript
 * await runStorybookDocsLoopCli(["commands", "--json"])
 * ```
 */
export async function runStorybookDocsLoopCli(
	argv: readonly string[],
	options: {
		runtime?: StorybookDocsLoopRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime =
		options.runtime ?? createDefaultStorybookDocsLoopRuntime();
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
			durationMs: 0,
			sideEffectStance: "read_only",
		});
	}

	const runId = parsedDiagnostics.options.runId;
	const startedAt = parsedDiagnostics.options.startedAtMs;
	let parsed: ParsedDocsLoopCommand;
	try {
		parsed = parseStorybookDocsLoopArgv(parsedDiagnostics.argv);
	} catch (error) {
		return emitError({
			error,
			stdout,
			stderr,
			json: inferJsonMode(parsedDiagnostics.argv),
			runId,
			durationMs: runtime.now() - startedAt,
			sideEffectStance: "read_only",
		});
	}

	if (parsed.kind === "version") {
		stdout.write(`storybook-docs-loop ${VERSION}\n`);
		return 0;
	}
	if (parsed.kind === "help") {
		stdout.write(renderHelp(parsed.command));
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
		const result = await executeCommand(runtime, parsed);
		if (parsed.options.plain) {
			stdout.write(renderPlain(parsed.kind, result));
			return 0;
		}
		writeSuccess(stdout, parsed.kind, result, runId, runtime.now() - startedAt);
		return 0;
	} catch (error) {
		return emitError({
			error,
			stdout,
			stderr,
			json: parsed.options.json,
			runId,
			durationMs: runtime.now() - startedAt,
			sideEffectStance: sideEffectStanceForCommand(parsed.kind),
		});
	}
}

function parseStorybookDocsLoopArgv(
	argv: readonly string[],
): ParsedDocsLoopCommand {
	if (argv.includes("--version")) return { kind: "version" };
	if (argv.includes("--help") || argv.includes("-h")) {
		return { kind: "help", command: findCommandName(argv) };
	}
	if (argv.length === 0) return { kind: "help" };
	if (argv[0] === "help") {
		const command = argv[1];
		return {
			kind: "help",
			command:
				command && COMMANDS.has(command)
					? (command as StorybookDocsLoopCommand)
					: undefined,
		};
	}
	if (argv[0] === "commands") {
		parseCommandsArgv(argv.slice(1));
		return { kind: "commands" };
	}
	if (!COMMANDS.has(argv[0])) {
		throw usageError(`unknown command: ${argv[0]}`);
	}
	const kind = argv[0] as Exclude<StorybookDocsLoopCommand, "commands">;
	const options = parseOptions(kind, argv.slice(1));
	validateCommandOptions(kind, options);
	return { kind, options };
}

function findCommandName(
	argv: readonly string[],
): StorybookDocsLoopCommand | undefined {
	for (const arg of argv) {
		if (COMMANDS.has(arg)) return arg as StorybookDocsLoopCommand;
	}
	return undefined;
}

function parseCommandsArgv(argv: readonly string[]): void {
	for (const arg of argv) {
		if (arg !== "--json") {
			throw usageError(`unknown option for commands: ${arg}`);
		}
	}
	if (!argv.includes("--json")) {
		throw usageError("storybook-docs-loop commands requires --json.");
	}
}

function parseOptions(
	command: Exclude<StorybookDocsLoopCommand, "commands">,
	argv: readonly string[],
): ParsedOptions {
	const options: ParsedOptions = {
		json: false,
		plain: false,
		noInput: false,
		force: false,
	};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (BOOLEAN_FLAGS.has(arg)) {
			validateCommandFlag(command, arg);
			setBooleanOption(options, arg);
			continue;
		}
		if (VALUE_FLAGS.has(arg)) {
			validateCommandFlag(command, arg);
			const value = requireNext(argv, index, arg);
			setValueOption(options, arg, value);
			index++;
			continue;
		}
		const inline = splitInlineFlag(arg);
		if (inline && isKnownFlag(inline.flag)) {
			validateCommandFlag(command, inline.flag);
		}
		if (inline && BOOLEAN_FLAGS.has(inline.flag)) {
			throw usageError(`${inline.flag} does not take a value.`);
		}
		if (inline && VALUE_FLAGS.has(inline.flag)) {
			setValueOption(options, inline.flag, inline.value);
			continue;
		}
		if (arg.startsWith("-")) throw usageError(`unknown option: ${arg}`);
		throw usageError(`unexpected argument: ${arg}`);
	}
	if (options.json && options.plain) {
		throw usageError("Use only one output mode: --json or --plain.");
	}
	return options;
}

function isKnownFlag(flag: string): boolean {
	return BOOLEAN_FLAGS.has(flag) || VALUE_FLAGS.has(flag);
}

function validateCommandFlag(
	command: Exclude<StorybookDocsLoopCommand, "commands">,
	flag: string,
): void {
	if (!Object.hasOwn(storybookDocsLoopContracts[command].flags ?? {}, flag)) {
		throw usageError(`${command} does not accept ${flag}.`);
	}
}

function splitInlineFlag(
	arg: string,
): { flag: string; value: string } | undefined {
	const equalIndex = arg.indexOf("=");
	if (equalIndex === -1) return undefined;
	const flag = arg.slice(0, equalIndex);
	const value = arg.slice(equalIndex + 1);
	if (value === "") throw usageError(`${flag} requires a value.`);
	return { flag, value };
}

function setBooleanOption(options: ParsedOptions, flag: string): void {
	switch (flag) {
		case "--json":
			options.json = true;
			return;
		case "--plain":
			options.plain = true;
			return;
		case "--no-input":
			options.noInput = true;
			return;
		case "--force":
			options.force = true;
			return;
		default:
			throw usageError(`unknown option: ${flag}`);
	}
}

function setValueOption(
	options: ParsedOptions,
	flag: string,
	value: string,
): void {
	switch (flag) {
		case "--repo":
			options.repo = value;
			return;
		case "--pkg":
			options.pkg = value;
			return;
		case "--component":
			options.component = value;
			return;
		case "--story":
			options.story = value;
			return;
		case "--run":
			options.run = value;
			return;
		case "--batch-size":
			options.batchSize = value;
			return;
		case "--older-than":
			options.olderThan = value;
			return;
		case "--field":
			options.field = parseEnumOption(
				flag,
				value,
				DOCS_LOOP_VERIFICATION_FIELDS,
			);
			return;
		case "--status":
			options.status = parseEnumOption(flag, value, DOCS_LOOP_RECEIPT_STATUSES);
			return;
		case "--reason":
			options.reason = value;
			return;
		default:
			throw usageError(`unknown option: ${flag}`);
	}
}

function parseEnumOption<T extends string>(
	flag: string,
	value: string,
	values: readonly T[],
): T {
	if (!values.includes(value as T)) {
		throw usageError(formatEnumFlagError(flag, value, values));
	}
	return value as T;
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

function validateCommandOptions(
	command: Exclude<StorybookDocsLoopCommand, "commands">,
	options: ParsedOptions,
): void {
	if (!options.json && !options.plain) {
		throw usageError(`storybook-docs-loop ${command} requires --json or --plain.`);
	}
	if (command === "single" && !options.component && !options.story) {
		throw usageError("single requires --component or --story.");
	}
	if (command === "mark") {
		if (!options.field) throw usageError("mark requires --field.");
		if (!options.status) throw usageError("mark requires --status.");
		if (options.status !== "done" && !options.reason) {
			throw usageError("mark requires --reason for na or blocked.");
		}
	}
	if (command === "advance" && options.force && !options.reason) {
		throw usageError("advance --force requires --reason.");
	}
}

function discoveryPayload() {
	const entries = Object.entries(storybookDocsLoopContracts) as Array<
		[
			StorybookDocsLoopCommand,
			(typeof storybookDocsLoopContracts)[StorybookDocsLoopCommand],
		]
	>;
	return projectCommandDiscoveryTree(entries, {
		includeFlagDescriptions: true,
	});
}

async function executeCommand(
	runtime: StorybookDocsLoopRuntime,
	parsed: Extract<ParsedDocsLoopCommand, { options: ParsedOptions }>,
): Promise<
	| DocsLoopRunCard
	| DocsLoopStatusPayload
	| DocsLoopMarkPayload
	| DocsLoopDoctorPayload
	| DocsLoopPurgePayload
> {
	switch (parsed.kind) {
		case "single":
			return handleSingle(runtime, parsed.options);
		case "batch":
			return handleBatch(runtime, parsed.options);
		case "resume":
			return handleResume(runtime, parsed.options);
		case "status":
			return handleStatus(runtime, parsed.options);
		case "mark":
			return handleMark(runtime, parsed.options);
		case "advance":
			return handleAdvance(runtime, parsed.options);
		case "doctor":
			return handleDoctor(runtime, parsed.options);
		case "purge":
			return handlePurge(runtime, parsed.options);
	}
}

async function handleSingle(
	runtime: StorybookDocsLoopRuntime,
	options: ParsedOptions,
): Promise<DocsLoopRunCard> {
	const inventory = await discoverDocsLoopInventory(runtime, {
		repo: options.repo,
		pkg: options.pkg,
		component: options.component,
		story: options.story,
	});
	const cluster = expectInventoryCluster(inventory);
	return buildDocsLoopRunCard(null, {
		command: "single",
		cluster,
		changedState: "none",
		retrySafe: true,
		sideEffectStance: "read_only",
	});
}

async function handleBatch(
	runtime: StorybookDocsLoopRuntime,
	options: ParsedOptions,
): Promise<DocsLoopRunCard> {
	const repo = resolveRepo(runtime, options);
	const inventory = await discoverDocsLoopInventorySet(runtime, {
		repo,
		pkg: options.pkg,
		component: options.component,
		story: options.story,
	});
	if (inventory.status !== "ok") throwInventoryError(inventory);
	const run = options.run ?? defaultRunId(runtime);
	if (!options.force) {
		const existing = await listDocsLoopRunIds(runtime, repo);
		if (existing.includes(run)) {
			throw usageError(
				`run already exists: ${run}. Resume it, or pass --force to overwrite (discards receipts and cursor).`,
			);
		}
	}
	const state = createDocsLoopRunState({
		run,
		repo,
		...(options.pkg ? { pkg: options.pkg } : {}),
		clusters: inventory.clusters,
		batchSize: parseBatchSize(options.batchSize),
		now: nowIso(runtime),
	});
	await writeDocsLoopRunState(runtime, repo, state as unknown as Record<string, unknown>);
	return buildDocsLoopRunCard(state, {
		command: "batch",
		changedState: "loop_state",
		retrySafe: true,
		sideEffectStance: "loop_state_write",
	});
}

async function handleResume(
	runtime: StorybookDocsLoopRuntime,
	options: ParsedOptions,
): Promise<DocsLoopRunCard> {
	const repo = resolveRepo(runtime, options);
	const state = await loadRunState(runtime, repo, options.run);
	return buildDocsLoopRunCard(state, {
		command: "resume",
		changedState: "none",
		retrySafe: true,
		sideEffectStance: "read_only",
	});
}

async function handleStatus(
	runtime: StorybookDocsLoopRuntime,
	options: ParsedOptions,
): Promise<DocsLoopStatusPayload & {
	total_items: number;
	cursor: number;
	current_component: string | null;
}> {
	const repo = resolveRepo(runtime, options);
	const state = await loadRunState(runtime, repo, options.run);
	const item = state.items[state.cursor] ?? null;
	return {
		run: state.run,
		changed_state: "none",
		retry_safe: true,
		side_effect_stance: "read_only",
		next_safe_action: item
			? "Resume the current batch item."
			: "Purge or create a fresh run.",
		total_items: state.items.length,
		cursor: state.cursor,
		current_component: item?.component ?? null,
	};
}

async function handleMark(
	runtime: StorybookDocsLoopRuntime,
	options: ParsedOptions,
): Promise<DocsLoopMarkPayload> {
	if (!options.field || !options.status) {
		throw usageError("mark requires --field and --status.");
	}
	const repo = resolveRepo(runtime, options);
	const state = await loadRunState(runtime, repo, options.run);
	const component =
		options.component ?? state.items[state.cursor]?.component ?? undefined;
	if (!component) throw usageError("mark requires a current component.");
	if (!state.items.some((item) => item.component === component)) {
		throw usageError(`mark component is not in this run: ${component}.`);
	}
	const next = withReceipt(state, {
		component,
		field: options.field,
		status: options.status,
		...(options.reason ? { reason: options.reason } : {}),
		now: nowIso(runtime),
	});
	await writeDocsLoopRunState(runtime, repo, next as unknown as Record<string, unknown>);
	return {
		run: state.run,
		field: options.field,
		status: options.status,
		changed_state: "loop_state",
		retry_safe: true,
		side_effect_stance: "loop_state_write",
		next_safe_action: "Resume the run to inspect derived status.",
	};
}

async function handleAdvance(
	runtime: StorybookDocsLoopRuntime,
	options: ParsedOptions,
): Promise<DocsLoopRunCard> {
	const repo = resolveRepo(runtime, options);
	const state = await loadRunState(runtime, repo, options.run);
	const batch = state.items.slice(state.cursor, state.cursor + state.batch_size);
	if (batch.length === 0) {
		return buildDocsLoopRunCard(state, {
			command: "advance",
			changedState: "none",
			retrySafe: true,
			sideEffectStance: "read_only",
		});
	}
	const batchStatuses = batch.map((item) => ({
		item,
		status: deriveDocsLoopItemStatus(
			item.status,
			state.ledger[item.component] ?? createLedgerSkeleton(),
		),
	}));
	const gated = batchStatuses.find(
		({ status }) => status === "degraded" || status === "blocked",
	);
	if (gated && !options.force) {
		throw usageError(`advance requires --force for ${gated.status} item.`);
	}
	const pending = batchStatuses.find(
		({ status }) => !["verified", "skipped", "degraded", "blocked"].includes(status),
	);
	if (pending) {
		throw usageError(`advance requires verified, skipped, degraded, or blocked item.`);
	}
	const next = advanceDocsLoopState(state, {
		...(options.force ? { reason: options.reason } : {}),
		now: nowIso(runtime),
	});
	await writeDocsLoopRunState(runtime, repo, next as unknown as Record<string, unknown>);
	return buildDocsLoopRunCard(next, {
		command: "advance",
		changedState: "loop_state",
		retrySafe: true,
		sideEffectStance: "loop_state_write",
	});
}

async function handleDoctor(
	runtime: StorybookDocsLoopRuntime,
	options: ParsedOptions,
): Promise<DocsLoopDoctorPayload & { problems: readonly object[] }> {
	const repo = resolveRepo(runtime, options);
	const run = await resolveRunId(runtime, repo, options.run);
	try {
		assertDocsLoopRunStateShape(await readDocsLoopRunState(runtime, repo, run));
		return {
			run,
			status: "ok",
			changed_state: "none",
			retry_safe: true,
			side_effect_stance: "read_only",
			next_safe_action: "Resume the run.",
			problems: [],
		};
	} catch (error) {
		if (error instanceof DocsLoopStateError) {
			return {
				run,
				status: "repairable",
				changed_state: "none",
				retry_safe: true,
				side_effect_stance: "read_only",
				next_safe_action: error.nextSafeAction,
				problems: [
					{
						code: error.code,
						message: error.message,
						next_safe_action: error.nextSafeAction,
					},
				],
			};
		}
		throw error;
	}
}

async function handlePurge(
	runtime: StorybookDocsLoopRuntime,
	options: ParsedOptions,
): Promise<DocsLoopPurgePayload & { matched_runs: readonly string[] }> {
	const repo = resolveRepo(runtime, options);
	const matchedRuns = options.run
		? [options.run]
		: options.olderThan
			? await findRunsOlderThan(runtime, repo, parseDurationMs(options.olderThan))
			: [await resolveRunId(runtime, repo, undefined)];
	if (options.force) {
		for (const run of matchedRuns) {
			await deleteDocsLoopRun(runtime, repo, run);
		}
	}
	return {
		run: options.run ?? null,
		deleted: options.force,
		changed_state: options.force ? "loop_state" : "none",
		retry_safe: !options.force,
		side_effect_stance: options.force ? "cache_destroy" : "read_only",
		next_safe_action: options.force
			? "Create a fresh run if cleanup should continue."
			: "Review matched runs before forcing deletion.",
		matched_runs: matchedRuns,
	};
}

function expectInventoryCluster(result: DocsLoopInventoryResult) {
	if (result.status === "ok") return result.cluster;
	throwInventoryError(result);
}

function throwInventoryError(
	result: DocsLoopInventoryBlocked | DocsLoopInventoryAmbiguous,
): never {
	if (result.status === "ambiguous") {
		throw usageError(`component is ambiguous: ${result.alternatives.join(", ")}`);
	}
	throw usageError(`${result.reason}: ${result.next_safe_action}`);
}

function resolveRepo(
	runtime: StorybookDocsLoopRuntime,
	options: ParsedOptions,
): string {
	return resolve(options.repo ?? runtime.cwd());
}

function defaultRunId(runtime: StorybookDocsLoopRuntime): string {
	const stamp = new Date(runtime.now()).toISOString().replace(/[^0-9]/g, "");
	return `docs-loop-${stamp.slice(0, 14)}`;
}

function parseBatchSize(value: string | undefined): number {
	if (!value) return 3;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
		throw usageError("--batch-size must be an integer from 1 to 100.");
	}
	return parsed;
}

function parseDurationMs(value: string | undefined): number {
	if (!value) throw usageError("--older-than requires a duration.");
	const match = value.match(/^(\d+)([dhm])$/);
	if (!match) throw usageError("--older-than must look like 30d, 12h, or 10m.");
	const amount = Number.parseInt(match[1], 10);
	const unit = match[2];
	const multiplier =
		unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
	return amount * multiplier;
}

function nowIso(runtime: StorybookDocsLoopRuntime): string {
	return new Date(runtime.now()).toISOString();
}

async function loadRunState(
	runtime: StorybookDocsLoopRuntime,
	repo: string,
	run: string | undefined,
): Promise<DocsLoopRunState> {
	const resolvedRun = await resolveRunId(runtime, repo, run);
	return asDocsLoopRunState(
		await readDocsLoopRunState(runtime, repo, resolvedRun),
	);
}

async function resolveRunId(
	runtime: StorybookDocsLoopRuntime,
	repo: string,
	run: string | undefined,
): Promise<string> {
	if (run) return run;
	const runs = await listDocsLoopRunIds(runtime, repo);
	if (runs.length === 1) return runs[0];
	if (runs.length === 0) {
		throw new DocsLoopStateError(
			"state_missing",
			"No active docs-loop runs exist for this repo.",
			"Create a run or provide a run id.",
			true,
		);
	}
	throw usageError(`multiple active runs: ${runs.join(", ")}`);
}

function sideEffectStanceForCommand(
	command: Exclude<StorybookDocsLoopCommand, "commands">,
): DocsLoopErrorPayload["side_effect_stance"] {
	if (command === "purge") return "cache_destroy";
	if (command === "batch" || command === "advance" || command === "mark") {
		return "loop_state_write";
	}
	return "read_only";
}

function writeSuccess(
	stdout: CliWriter,
	command: StorybookDocsLoopCommand,
	data: object,
	runId: string,
	durationMs: number,
): void {
	const contract = storybookDocsLoopContracts[command];
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: runId,
			data: createCommandResultData(
				contract as { resultContract?: CommandFacadeResultContract },
				data as never,
			),
		}),
		{ runId, durationMs },
	);
}

function renderHelp(command: StorybookDocsLoopCommand | undefined): string {
	if (command) return renderCommandUsage(storybookDocsLoopContracts[command]);
	const usages = DOCS_LOOP_COMMANDS.flatMap(
		(route) => storybookDocsLoopContracts[route].usage[0],
	);
	return `${[
		"Usage: storybook-docs-loop <command> [flags]",
		"",
		"Durable Storybook docs cleanup loop.",
		"",
		...usages,
	].join("\n")}\n`;
}

function renderPlain(
	command: StorybookDocsLoopCommand,
	data:
		| DocsLoopRunCard
		| DocsLoopStatusPayload
		| DocsLoopMarkPayload
		| DocsLoopDoctorPayload
		| DocsLoopPurgePayload,
): string {
	return [
		`command: ${command}`,
		`run: ${data.run ?? "none"}`,
		...("component" in data && data.component
			? [`component: ${data.component}`]
			: []),
		`changed_state: ${data.changed_state}`,
		`next_safe_action: ${data.next_safe_action}`,
		"",
	].join("\n");
}

function inferJsonMode(argv: readonly string[]): boolean {
	return argv.includes("--json");
}

function emitError(input: {
	error: unknown;
	stdout: CliWriter;
	stderr: CliWriter;
	json: boolean;
	runId: string;
	durationMs: number;
	sideEffectStance: DocsLoopErrorPayload["side_effect_stance"];
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
			error: structuredErrorFor(input.runId, err),
			data: {
				changed_state: "none",
				retry_safe: err.retrySafe,
				side_effect_stance: input.sideEffectStance,
				next_safe_action: err.nextSafeAction,
			} satisfies DocsLoopErrorPayload,
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return err.exitCode;
}

function structuredErrorFor(
	runId: string,
	err: ReturnType<typeof normalizeError>,
) {
	if (err.kind === "usage") {
		return createCliUsageRuntimeError({
			run_id: runId,
			code: err.code,
			message: err.message,
			hint: {
				action: "change_input",
				summary: err.nextSafeAction,
			},
			failure_domain: "usage",
		});
	}
	if (err.kind === "repair") {
		return createCliRepairStateRuntimeError({
			run_id: runId,
			code: err.code,
			message: err.message,
			exit_code: err.exitCode,
			hint: {
				action: "repair_state",
				summary: err.nextSafeAction,
			},
			failure_domain: "state",
		});
	}
	return createCliRuntimeError({
		run_id: runId,
		code: err.code,
		message: err.message,
		exit_code: err.exitCode,
		recoverability: "contact_support",
		retryable: false,
		hint: {
			action: "contact_support",
			summary: err.nextSafeAction,
		},
		failure_domain: "runtime",
	});
}

function normalizeError(error: unknown): {
	kind: "usage" | "repair" | "runtime";
	code: string;
	message: string;
	exitCode: 1 | 2;
	nextSafeAction: string;
	retrySafe: boolean;
} {
	if (error instanceof CliUsageError) {
		return {
			kind: "usage",
			code: "usage_error",
			message: error.message,
			exitCode: 2,
			nextSafeAction: "Change command input and rerun.",
			retrySafe: true,
		};
	}
	if (error instanceof DocsLoopStateError) {
		return {
			kind: "repair",
			code: error.code,
			message: error.message,
			exitCode: 1,
			nextSafeAction: error.nextSafeAction,
			retrySafe: error.retrySafe,
		};
	}
	return {
		kind: "runtime",
		code: "runtime_failure",
		message: error instanceof Error ? error.message : String(error),
		exitCode: 1,
		nextSafeAction: "Inspect runtime failure details.",
		retrySafe: false,
	};
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
 * Run docs-loop CLI with in-memory writers.
 *
 * @param argv - Command arguments after the executable name
 * @returns Exit code and captured streams
 *
 * @example
 * ```typescript
 * const result = await runForTest(["commands", "--json"])
 * ```
 */
export async function runForTest(
	argv: readonly string[],
	runtime: StorybookDocsLoopRuntime = createDefaultStorybookDocsLoopRuntime(),
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runStorybookDocsLoopCli(argv, {
		runtime,
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

if (import.meta.main) {
	const exitCode = await runStorybookDocsLoopCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
