#!/usr/bin/env bun

import { existsSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
	type CliWriter,
	CliUsageError,
	createCliRepairStateRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	createCliUsageRuntimeError,
	createCommandResultData,
	parseCliDiagnosticArgv,
	renderCommandUsage,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";

import { canonicalSkillId } from "./catalog.ts";
import { setupBranchStationCatalog } from "./branch-station-catalog.ts";
import { applySetupDomains, checkSetupDomains, unlinkSetupDomains } from "./setup-domains.ts";
import {
	parseSetupInvocation,
	projectSetupCommandDiscoveryTree,
	setupContracts,
	type ParsedSetupInvocation,
} from "./command-contract.ts";
import { diagnoseFindings } from "./doctor.ts";
import { inspectSetup, type SetupInspection, type SetupInspectionInput } from "./inspection.ts";
import { SETUP_COMMANDS, type SetupCommand, type SetupResult } from "./model.ts";
import { planSetup } from "./planner.ts";
import { renderCatalog, renderDoctor, renderSetupResult } from "./renderer.ts";

/** Runtime adapters keep command-surface tests deterministic and mutation-free. */
export interface SetupCliRuntime {
	sourceRepoRoot: string;
	homeDir: string;
	now: () => number;
	env: Readonly<Record<string, string | undefined>>;
	inspect: (input: SetupInspectionInput) => Promise<SetupInspection>;
	apply: (input: SetupInspectionInput) => Promise<SetupResult>;
	unlink: (input: SetupInspectionInput, check: boolean) => Promise<SetupResult>;
	checkDomains?: (input: SetupInspectionInput, base: SetupResult) => Promise<SetupResult>;
	/** Discovery adapter; tests use a failing implementation to prove wrapping. */
	commands?: () => Promise<CommandsResult> | CommandsResult;
}

/** Optional CLI entry-point dependencies used by tests and embedded callers. */
export interface SetupCliOptions {
	runtime?: Partial<SetupCliRuntime>;
	stdout?: CliWriter;
	stderr?: CliWriter;
}

interface CommandExecution {
	result: SetupResult | CommandsResult;
	exitCode: 0 | 1;
	human: string;
	contractCommand: SetupCommand;
}

type CommandsResult = ReturnType<typeof projectSetupCommandDiscoveryTree>;

class InvalidTargetError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidTargetError";
	}
}

/** Build the filesystem-backed, read-only CLI runtime. */
export function createDefaultRuntime(overrides: Partial<SetupCliRuntime> = {}): SetupCliRuntime {
	const sourceRepoRoot = overrides.sourceRepoRoot ?? resolve(import.meta.dir, "../../..");
	const homeDir = overrides.homeDir ?? homedir();
	const stateRoot = join(homeDir, ".local/state/setup");
	const runtime: SetupCliRuntime = {
		sourceRepoRoot,
		homeDir,
		now: () => Date.now(),
		env: process.env,
		inspect: async (input) => {
			if (input.scope !== "project") return inspectSetup(input);
			return inspectSetup({
				...input,
				projectRepoRoot: resolveProjectRepoRoot(input.projectRepoRoot),
			});
		},
		apply: async (input: SetupInspectionInput) => applySetupDomains(normalizeProjectInput(input), { stateRoot, inspect: runtime.inspect }),
		unlink: async (input: SetupInspectionInput, check: boolean) => unlinkSetupDomains(normalizeProjectInput(input), { check, stateRoot, inspect: runtime.inspect }),
		...overrides,
	};
	if (!overrides.inspect) runtime.checkDomains = async (input, base) => checkSetupDomains(normalizeProjectInput(input), base, { stateRoot });
	return runtime;
}

function normalizeProjectInput(input: SetupInspectionInput): SetupInspectionInput {
	return input.scope === "project"
		? { ...input, projectRepoRoot: resolveProjectRepoRoot(input.projectRepoRoot) }
		: input;
}

/** Run the Setup CLI and return its process exit without mutating setup state. */
export async function main(argv: readonly string[], options: SetupCliOptions = {}): Promise<number> {
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const runtime = createDefaultRuntime(options.runtime);
	let invocation: ParsedSetupInvocation;
	let diagnostics: ReturnType<typeof parseCliDiagnosticArgv>;

	try {
		if (argv.includes("--help") || argv.includes("-h")) {
			const candidate = argv.find((arg) => !arg.startsWith("-"));
			if (candidate !== undefined && !SETUP_COMMANDS.includes(candidate as SetupCommand)) {
				throw new CliUsageError(`Unknown command: ${candidate}`, { exitCode: 2, showMessage: true });
			}
			const command = candidate as SetupCommand | undefined;
			stdout.write(renderCommandUsage(setupContracts[command ?? "status"]));
			return 0;
		}
		invocation = parseSetupInvocation(argv);
		diagnostics = parseCliDiagnosticArgv(argv);
	} catch (error) {
		return emitFailure({ error, argv, stdout, stderr, runtime, command: commandFromArgv(argv), code: "invalid_usage", exitCode: 2 });
	}

	const startedAt = diagnostics.options.startedAtMs;
	try {
		const execution = await execute(invocation, runtime);
		if ("child_output" in execution.result && execution.result.child_output) stderr.write(execution.result.child_output);
		if (invocation.verbose) stderr.write("setup inspection complete\n");
		if (invocation.json) {
			const data = createResultData(execution.contractCommand, execution.result);
			const stationId = "station" in execution.result ? execution.result.station : undefined;
			const station = stationId
				? setupBranchStationCatalog.find((candidate) => candidate.id === stationId)
				: undefined;
			const envelope = station?.expectedEnvelopeStatus === "error"
				? createCliRuntimeErrorEnvelope({
					run_id: diagnostics.options.runId,
					process_exit_code: execution.exitCode,
					error: createCliRepairStateRuntimeError({
						run_id: diagnostics.options.runId,
						code: station.expectedErrorCode ?? station.intent,
						message: "Setup reached a repair-required terminal station.",
						exit_code: execution.exitCode,
					}),
					data,
				})
				: createCliRuntimeSuccessEnvelope({ run_id: diagnostics.options.runId, data });
			writeJsonEnvelope(stdout, envelope, {
				runId: diagnostics.options.runId,
				durationMs: Math.max(0, runtime.now() - startedAt),
			});
		} else {
			stdout.write(execution.human);
		}
		return execution.exitCode;
	} catch (error) {
		return emitFailure({
			error, argv, stdout, stderr, runtime, invocation,
			runId: diagnostics.options.runId, startedAt,
			code: error instanceof CliUsageError ? "invalid_usage"
				: error instanceof InvalidTargetError ? "invalid_target" : "runtime_failure",
			exitCode: error instanceof CliUsageError ? 2 : 1,
		});
	}
}

function resolveProjectRepoRoot(value: string | undefined): string {
	if (!value || !existsSync(value)) {
		throw new InvalidTargetError("Project target must exist and own a skills catalog.");
	}
	const target = resolve(value);
	try {
		if (!lstatSync(target).isDirectory()) {
			throw new InvalidTargetError("Project target must be a directory inside a Git repository.");
		}
	} catch (error) {
		if (error instanceof InvalidTargetError) throw error;
		throw new InvalidTargetError("Project target cannot be inspected.");
	}
	const probe = Bun.spawnSync(["git", "-C", target, "rev-parse", "--show-toplevel"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if (probe.exitCode !== 0) {
		throw new InvalidTargetError("Project target is not inside a Git repository.");
	}
	const root = resolve(new TextDecoder().decode(probe.stdout).trim());
	const catalog = resolve(root, "skills");
	if (!existsSync(catalog) || !lstatSync(catalog).isDirectory()) {
		throw new InvalidTargetError("Project repository must own a skills catalog.");
	}
	return root;
}

async function execute(invocation: ParsedSetupInvocation, runtime: SetupCliRuntime): Promise<CommandExecution> {
	if (invocation.command === "commands") {
		return { result: await (runtime.commands?.() ?? projectSetupCommandDiscoveryTree()), exitCode: 0, human: "", contractCommand: "commands" };
	}
	const input: SetupInspectionInput = {
		scope: invocation.scope,
		sourceRepoRoot: runtime.sourceRepoRoot,
		...(invocation.repo ? { projectRepoRoot: invocation.repo } : {}),
		homeDir: runtime.homeDir,
	};
	if (invocation.command === "sync" && !invocation.check) {
		const result = await runtime.apply(input);
		return { result, exitCode: result.state === "applied" || result.state === "noop" ? 0 : 1, human: renderSetupResult(result, { verbose: invocation.verbose }), contractCommand: "sync" };
	}
	if (invocation.command === "unlink") {
		const result = await runtime.unlink(input, invocation.check);
		return { result, exitCode: result.state === "removed" || result.state === "noop" ? 0 : 1, human: renderSetupResult(result, { verbose: invocation.verbose }), contractCommand: "unlink" };
	}
	const inspection = await runtime.inspect(input);
	if (invocation.command === "catalog") return catalogExecution(invocation, inspection);
	let plan = planSetup(inspection, invocation.command);
	if (runtime.checkDomains && (invocation.command === "status" || invocation.command === "doctor" || (invocation.command === "sync" && invocation.check))) {
		plan = await runtime.checkDomains(input, plan);
	}
	if (invocation.command === "doctor") {
		const diagnosis = diagnoseFindings(plan.findings);
		const result: SetupResult = {
			...plan,
			findings: diagnosis.findings,
			station: diagnosis.station,
			next_action: diagnosis.next_action,
			state: diagnosis.station === "doctor.healthy" ? "healthy"
				: diagnosis.station === "doctor.repairable" ? "repairable" : "blocked",
		};
		return { result, exitCode: diagnosis.station === "doctor.healthy" ? 0 : 1, human: renderDoctor(result), contractCommand: "doctor" };
	}
	return {
		result: plan,
		exitCode: invocation.command === "sync" && plan.state !== "healthy" ? 1 : 0,
		human: renderSetupResult(plan, { verbose: invocation.verbose }),
		contractCommand: invocation.command,
	};
}

function catalogExecution(invocation: ParsedSetupInvocation, inspection: SetupInspection): CommandExecution {
	const plan = planSetup(inspection, "catalog");
	const requested = invocation.positionals[0];
	const matching = requested
		? inspection.catalog.entries.filter((entry) => entry.canonical_id === canonicalSkillId(requested))
		: inspection.catalog.entries;
	const occupancyById = new Map<string, string[]>();
	for (const owned of inspection.ownership.entries) {
		const occupancy = occupancyById.get(owned.canonical_id) ?? [];
		occupancy.push(`${owned.root_id}:${owned.ownership}`);
		occupancyById.set(owned.canonical_id, occupancy);
	}
	for (const occupancy of occupancyById.values()) occupancy.sort();
	const entries = matching.map((entry) => ({
		id: entry.id,
		canonical_id: entry.canonical_id,
		state: entry.state,
		path: entry.path,
		occupancy: occupancyById.get(entry.canonical_id) ?? [],
	}));
	const missed = requested !== undefined && entries.length === 0;
	const result: SetupResult = {
		...plan,
		state: missed ? "failed" : "healthy",
		station: missed ? "catalog.not_found" : requested ? "catalog.matched" : "catalog.listed",
		next_action: missed ? "discover_external" : requested ? "use_source" : "inspect_catalog",
		catalog_entries: missed ? [{ id: requested, canonical_id: canonicalSkillId(requested), state: "missing", occupancy: [] }] : entries,
	};
	return { result, exitCode: missed ? 1 : 0, human: renderCatalog(result), contractCommand: "catalog" };
}

function createResultData(command: SetupCommand, result: SetupResult | CommandsResult) {
	if (command === "commands") {
		return createCommandResultData<
			CommandsResult,
			typeof setupContracts.commands.resultContract
		>(setupContracts.commands, result as CommandsResult);
	}
	return createSetupResultData(command, result as SetupResult);
}

function createSetupResultData(
	command: Exclude<SetupCommand, "commands">,
	result: SetupResult,
) {
	const { child_output: _childOutput, ...publicResult } = result;
	return createCommandResultData<
		SetupResult,
		typeof setupContracts.status.resultContract
	>(setupContracts[command], publicResult);
}

function emitFailure(input: {
	error: unknown;
	argv: readonly string[];
	stdout: CliWriter;
	stderr: CliWriter;
	runtime: SetupCliRuntime;
	invocation?: ParsedSetupInvocation;
	command?: SetupCommand;
	runId?: string;
	startedAt?: number;
	code: "invalid_usage" | "invalid_target" | "runtime_failure";
	exitCode: 1 | 2;
}): number {
	const json = input.invocation?.json ?? input.argv.includes("--json");
	const runId = input.runId ?? parseCliDiagnosticArgv([]).options.runId;
	const message = input.error instanceof Error ? input.error.message : String(input.error);
	if (!json) {
		input.stderr.write(`${message}\nnext: ${input.code === "invalid_usage" ? "change_input" : "inspect_diagnostics"}\n`);
		return input.exitCode;
	}
	const command = input.invocation?.command ?? input.command ?? commandFromArgv(input.argv);
	const publicMessage = input.code === "invalid_usage"
		? "Setup command usage is invalid."
		: input.code === "invalid_target"
			? "The selected project target is invalid."
			: "Setup could not complete read-only inspection.";
	const error = input.exitCode === 2
		? createCliUsageRuntimeError({ run_id: runId, code: input.code, message: publicMessage })
		: createCliRepairStateRuntimeError({ run_id: runId, code: input.code, message: publicMessage, exit_code: 1 });
	const failureStation = input.code === "invalid_target" && input.invocation?.check
		? `${command}.check_invalid_target`
		: `${command}.${input.code}`;
	const result = emptyResult(command, input.code, failureStation);
	const data = command === "commands"
		? createCommandResultData<
			SetupResult,
			typeof setupContracts.status.resultContract
		>(setupContracts.status, result)
		: createSetupResultData(command, result);
	const envelope = createCliRuntimeErrorEnvelope({ run_id: runId, process_exit_code: input.exitCode, error, data });
	writeJsonEnvelope(input.stdout, envelope, {
		runId,
		durationMs: Math.max(0, input.runtime.now() - (input.startedAt ?? input.runtime.now())),
	});
	return input.exitCode;
}

function emptyResult(command: SetupCommand, code: string, station = `${command}.${code}`): SetupResult {
	return {
		command, scope: "user", state: "failed",
		findings: [], domains: [], operations: [], projection_targets: [],
		counts: { catalog: 0, managed: 0, external: 0, planned: 0, blockers: 0 },
		catalog_root: "unavailable", destination_roots: [],
		station,
		next_action: code === "invalid_usage" || code === "invalid_target" ? "change_input" : "inspect_diagnostics",
	};
}

function commandFromArgv(argv: readonly string[]): SetupCommand {
	const candidate = argv.find((arg) => !arg.startsWith("-"));
	return candidate && SETUP_COMMANDS.includes(candidate as SetupCommand)
		? candidate as SetupCommand
		: "status";
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
