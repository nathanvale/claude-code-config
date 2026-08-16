#!/usr/bin/env bun

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
import { SETUP_COMMANDS, type SetupActionId, type SetupCommand, type SetupResult } from "./model.ts";
import { planSetup } from "./planner.ts";
import { renderCatalog, renderDoctor, renderSetupResult } from "./renderer.ts";
import { InvalidTargetError, resolveProjectRepoRoot } from "./scope.ts";
import {
	createVaultGitHostEnrollment,
	type VaultGitHostEnrollment,
	type VaultGitHostEnrollmentInput,
	type VaultGitHostEnrollmentResult,
} from "./vault-git-host-enrollment.ts";
import { inspectVaultGitWorkState } from "./vault-git-work-state.ts";

/** Runtime adapters keep command-surface tests deterministic and mutation-free. */
export interface SetupCliRuntime {
	sourceRepoRoot: string;
	homeDir: string;
	now: () => number;
	env: Readonly<Record<string, string | undefined>>;
	/** Whether the human-output destination supports terminal styling. */
	stdoutIsTTY: boolean;
	inspect: (input: SetupInspectionInput) => Promise<SetupInspection>;
	apply: (input: SetupInspectionInput) => Promise<SetupResult>;
	unlink: (input: SetupInspectionInput, check: boolean) => Promise<SetupResult>;
	checkDomains?: (input: SetupInspectionInput, base: SetupResult) => Promise<SetupResult>;
	/** Discovery adapter; tests use a failing implementation to prove wrapping. */
	commands?: () => Promise<CommandsResult> | CommandsResult;
	/** Setup-owned deep domain owner; injected by tests and embedded callers. */
	vaultGitHostEnrollment?: VaultGitHostEnrollment;
	/** One-shot private stdin reader used only by a named input contract. */
	readPrivateStdin?: () => Promise<string>;
}

/** Optional CLI entry-point dependencies used by tests and embedded callers. */
export interface SetupCliOptions {
	runtime?: Partial<SetupCliRuntime>;
	stdout?: CliWriter;
	stderr?: CliWriter;
}

type SetupResultCommand = Exclude<SetupCommand, "commands">;

type CommandExecution = {
	result: CommandsResult;
	exitCode: 0;
	human: "";
	contractCommand: "commands";
} | {
	result: SetupResult;
	exitCode: 0 | 1;
	human: string;
	contractCommand: SetupResultCommand;
};

type CommandsResult = ReturnType<typeof projectSetupCommandDiscoveryTree>;

/** Build the filesystem-backed, read-only CLI runtime. */
export function createDefaultRuntime(overrides: Partial<SetupCliRuntime> = {}): SetupCliRuntime {
	const sourceRepoRoot = overrides.sourceRepoRoot ?? resolve(import.meta.dir, "../../..");
	const homeDir = overrides.homeDir ?? homedir();
	const environment = overrides.env ?? process.env;
	const stateRoot = join(homeDir, ".local/state/setup");
	const vaultGitStateRoot = environment.XDG_STATE_HOME ?? join(homeDir, ".local", "state");
	const vaultGitHostEnrollment = overrides.vaultGitHostEnrollment ??
		createVaultGitHostEnrollment({
			configRoot: join(environment.XDG_CONFIG_HOME ?? join(homeDir, ".config"), "context", "vault-git"),
			dataRoot: join(environment.XDG_DATA_HOME ?? join(homeDir, ".local", "share"), "context", "vault-git"),
			selectorPath: join(homeDir, ".bun", "bin", "vault-git"),
			sourceRepoRoot,
			runtimeEntrypoint: join(sourceRepoRoot, "runtime", "vault-git-transaction-manager", "src", "cli.ts"),
			inspectWorkState: async () => inspectVaultGitWorkState(vaultGitStateRoot),
		});
	const runtime: SetupCliRuntime = {
		sourceRepoRoot,
		homeDir,
		now: () => Date.now(),
		env: environment,
		stdoutIsTTY: process.stdout.isTTY === true,
		inspect: async (input) => {
			if (input.scope !== "project") return inspectSetup(input);
			return inspectSetup({
				...input,
				projectRepoRoot: resolveProjectRepoRoot(input.projectRepoRoot),
			});
		},
		apply: async (input: SetupInspectionInput) => applySetupDomains(normalizeProjectInput(input), { stateRoot, inspect: runtime.inspect }),
		unlink: async (input: SetupInspectionInput, check: boolean) => unlinkSetupDomains(normalizeProjectInput(input), { check, stateRoot, inspect: runtime.inspect }),
		vaultGitHostEnrollment,
		readPrivateStdin: async () => Bun.stdin.text(),
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

/** Run the Setup CLI and return its process exit code. */
export async function main(argv: readonly string[], options: SetupCliOptions = {}): Promise<number> {
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const runtime = createDefaultRuntime(options.runtime);
	let invocation: ParsedSetupInvocation;
	let diagnostics: ReturnType<typeof parseCliDiagnosticArgv>;

	try {
		if (argv.includes("--help") || argv.includes("-h")) {
			// Only argv[0] can be a command; later bare tokens are flag values such as `--scope user`.
			const candidate = argv[0] !== undefined && !argv[0].startsWith("-") ? argv[0] : undefined;
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
		if (execution.contractCommand !== "commands" && execution.result.child_output) stderr.write(execution.result.child_output);
		if (invocation.verbose) stderr.write("setup inspection complete\n");
		if (invocation.json) {
			const data = createResultData(execution);
			const stationId = execution.contractCommand === "commands" ? undefined : execution.result.station;
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

async function execute(invocation: ParsedSetupInvocation, runtime: SetupCliRuntime): Promise<CommandExecution> {
	const command = invocation.command;
	const renderOptions = {
		verbose: invocation.verbose,
		color: runtime.stdoutIsTTY
			&& !invocation.noColor
			&& runtime.env.NO_COLOR === undefined
			&& runtime.env.TERM !== "dumb",
	};
	if (command === "commands") {
		return { result: await (runtime.commands?.() ?? projectSetupCommandDiscoveryTree()), exitCode: 0, human: "", contractCommand: "commands" };
	}
	if (command === "sync" && invocation.domain === "vault-git") {
		return vaultGitExecution(invocation, runtime);
	}
	const input: SetupInspectionInput = {
		scope: invocation.scope,
		sourceRepoRoot: runtime.sourceRepoRoot,
		...(invocation.repo ? { projectRepoRoot: invocation.repo } : {}),
		homeDir: runtime.homeDir,
	};
	if (command === "sync" && !invocation.check) {
		const result = await attachVaultGitStatus(await runtime.apply(input), invocation, runtime);
		return { result, exitCode: result.state === "applied" || result.state === "noop" ? 0 : 1, human: renderSetupResult(result, renderOptions), contractCommand: "sync" };
	}
	if (command === "unlink") {
		const result = await runtime.unlink(input, invocation.check);
		return { result, exitCode: result.state === "removed" || result.state === "noop" ? 0 : 1, human: renderSetupResult(result, renderOptions), contractCommand: "unlink" };
	}
	const inspection = await runtime.inspect(input);
	if (command === "catalog") return catalogExecution(invocation, inspection, renderOptions);
	let plan = planSetup(inspection, command);
	if (runtime.checkDomains && (command === "status" || command === "doctor" || (command === "sync" && invocation.check))) {
		plan = await runtime.checkDomains(input, plan);
	}
	if (command === "doctor") {
		const diagnosis = diagnoseFindings(plan.findings);
		const result: SetupResult = {
			...plan,
			findings: diagnosis.findings,
			station: diagnosis.station,
			next_action: diagnosis.next_action,
			state: diagnosis.station === "doctor.healthy" ? "healthy"
				: diagnosis.station === "doctor.repairable" ? "repairable" : "blocked",
		};
		return { result, exitCode: diagnosis.station === "doctor.healthy" ? 0 : 1, human: renderDoctor(result, renderOptions), contractCommand: "doctor" };
	}
	const result = command === "sync"
		? await attachVaultGitStatus(plan, invocation, runtime)
		: plan;
	return {
		result,
		exitCode: command === "sync" && result.state !== "healthy" ? 1 : 0,
		human: renderSetupResult(result, renderOptions),
		contractCommand: command,
	};
}

/** Plain user sync projects Vault Git domain status only; it never mutates it. */
async function attachVaultGitStatus(
	result: SetupResult,
	invocation: ParsedSetupInvocation,
	runtime: SetupCliRuntime,
): Promise<SetupResult> {
	if (invocation.scope !== "user" || !runtime.vaultGitHostEnrollment) return result;
	return { ...result, vault_git: await runtime.vaultGitHostEnrollment.inspect() };
}

async function vaultGitExecution(
	invocation: ParsedSetupInvocation,
	runtime: SetupCliRuntime,
): Promise<CommandExecution> {
	const owner = runtime.vaultGitHostEnrollment;
	if (!owner) throw new Error("Host Enrollment owner is unavailable");
	let result: VaultGitHostEnrollmentResult;
	if (invocation.rollback) {
		result = await owner.rollback(invocation.check);
	} else if (invocation.inputStdin) {
		const input = await readVaultGitHostEnrollmentInput(runtime);
		result = invocation.check ? await owner.preview(input) : await owner.apply(input);
	} else {
		result = await owner.inspect();
	}
	const projection = projectVaultGitStation(result);
	const projected = projectVaultGitSetupResult(result, projection, runtime);
	return {
		result: projected,
		exitCode: projection.exitCode,
		human: renderSetupResult(projected, {
			verbose: invocation.verbose,
			color: runtime.stdoutIsTTY && !invocation.noColor &&
				runtime.env.NO_COLOR === undefined && runtime.env.TERM !== "dumb",
		}),
		contractCommand: "sync",
	};
}

async function readVaultGitHostEnrollmentInput(
	runtime: SetupCliRuntime,
): Promise<VaultGitHostEnrollmentInput> {
	const source = await runtime.readPrivateStdin?.();
	if (source === undefined || source.length > 16_384) {
		throw new CliUsageError("Private Host Enrollment input is unavailable");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		throw new CliUsageError("Private Host Enrollment input is invalid");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new CliUsageError("Private Host Enrollment input is invalid");
	}
	const record = parsed as Record<string, unknown>;
	const expected = [
		"ssh_identity_file_path",
		"ssh_known_hosts_path",
		"ssh_public_key_path",
	].sort();
	if (
		Object.keys(record).sort().join("\0") !== expected.join("\0") ||
		!expected.every((key) => typeof record[key] === "string" && record[key] !== "")
	) {
		throw new CliUsageError("Private Host Enrollment input is invalid");
	}
	return {
		sshIdentityFilePath: record.ssh_identity_file_path as string,
		sshPublicKeyPath: record.ssh_public_key_path as string,
		sshKnownHostsPath: record.ssh_known_hosts_path as string,
	};
}

interface VaultGitStationProjection {
	readonly station: string;
	readonly state: SetupResult["state"];
	readonly nextAction: SetupActionId;
	readonly exitCode: 0 | 1;
}

/** One exhaustive terminal-station projection per Host Enrollment outcome. */
function projectVaultGitStation(
	result: VaultGitHostEnrollmentResult,
): VaultGitStationProjection {
	switch (result.station) {
		case "vault_git.host_enrollment_inputs_required":
			return { station: "sync.vault_git_inputs_required", state: "clean_slate", nextAction: "provide_host_enrollment_inputs", exitCode: 0 };
		case "vault_git.repository_ssh_prerequisite":
			return { station: "sync.vault_git_ssh_prerequisite", state: "blocked", nextAction: "provision_repository_ssh", exitCode: 1 };
		case "vault_git.host_enrollment_ready":
			return { station: "sync.vault_git_enrollment_ready", state: "changes", nextAction: "apply_host_enrollment", exitCode: 1 };
		case "vault_git.runtime_selected":
			return result.state === "enrolled"
				? { station: "sync.vault_git_selected", state: "healthy", nextAction: "setup_healthy", exitCode: 0 }
				: result.state === "noop"
					? { station: "sync.vault_git_noop", state: "noop", nextAction: "setup_healthy", exitCode: 0 }
					: { station: "sync.vault_git_applied", state: "applied", nextAction: "setup_healthy", exitCode: 0 };
		case "vault_git.runtime_selection_blocked":
			return { station: "sync.vault_git_selection_blocked", state: "blocked", nextAction: "wait_for_vault_git_idle", exitCode: 1 };
		case "vault_git.rollback_ready":
			return { station: "sync.vault_git_rollback_ready", state: "changes", nextAction: "apply_vault_git_rollback", exitCode: 1 };
		case "vault_git.rollback_applied":
			return { station: "sync.vault_git_rollback_applied", state: "applied", nextAction: "setup_healthy", exitCode: 0 };
		case "vault_git.rollback_blocked":
			return { station: "sync.vault_git_rollback_blocked", state: "blocked", nextAction: "wait_for_vault_git_idle", exitCode: 1 };
		default:
			return unreachableVaultGitStation(result);
	}
}

function unreachableVaultGitStation(result: never): never {
	throw new Error(
		`Unmapped Vault Git Host Enrollment station: ${(result as { station?: string }).station ?? "unknown"}`,
	);
}

function projectVaultGitSetupResult(
	result: VaultGitHostEnrollmentResult,
	projection: VaultGitStationProjection,
	runtime: SetupCliRuntime,
): SetupResult {
	return {
		command: "sync",
		scope: "user",
		state: projection.state,
		findings: [],
		domains: [{
			domain: "vault-git",
			planned: [], applied: [], deferred: [], preserved: [], failed: [],
		}],
		operations: [],
		projection_targets: [],
		counts: {
			catalog: 0, managed: 0, external: 0, planned: 0,
			blockers: projection.state === "blocked" ? 1 : 0,
		},
		catalog_root: runtime.sourceRepoRoot,
		destination_roots: [],
		station: projection.station,
		next_action: projection.nextAction,
		vault_git: result,
	};
}

function catalogExecution(
	invocation: ParsedSetupInvocation,
	inspection: SetupInspection,
	renderOptions: { readonly color: boolean },
): CommandExecution {
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
	const matched = requested !== undefined && matching.length === 1 && matching[0]?.state === "valid";
	const blocked = requested !== undefined && !missed && !matched;
	const result: SetupResult = {
		...plan,
		state: missed ? "failed" : blocked ? "blocked" : "healthy",
		station: missed ? "catalog.not_found" : blocked ? "catalog.blocked" : requested ? "catalog.matched" : "catalog.listed",
		next_action: missed ? "discover_external" : blocked ? "human_repair" : requested ? "use_source" : "inspect_catalog",
		catalog_entries: missed ? [{ id: requested, canonical_id: canonicalSkillId(requested), state: "missing", occupancy: [] }] : entries,
	};
	return { result, exitCode: missed || blocked ? 1 : 0, human: renderCatalog(result, renderOptions), contractCommand: "catalog" };
}

function createResultData(execution: CommandExecution) {
	if (execution.contractCommand === "commands") {
		return createCommandResultData<
			CommandsResult,
			typeof setupContracts.commands.resultContract
		>(setupContracts.commands, execution.result);
	}
	return createSetupResultData(execution.contractCommand, execution.result);
}

function createSetupResultData(
	command: SetupResultCommand,
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
		const nextAction = input.code === "invalid_usage" || input.code === "invalid_target"
			? "change_input"
			: "inspect_diagnostics";
		input.stderr.write(`${message}\nnext: ${nextAction}\n`);
		return input.exitCode;
	}
	const command = input.invocation?.command ?? input.command ?? commandFromArgv(input.argv);
	const publicMessage = input.code === "invalid_usage"
		? "Setup command usage is invalid."
		: input.code === "invalid_target"
			? "The selected project target is invalid."
			: message;
	if (input.code === "runtime_failure") input.stderr.write(`${message}\n`);
	const error = input.exitCode === 2
		? createCliUsageRuntimeError({ run_id: runId, code: input.code, message: publicMessage })
		: createCliRepairStateRuntimeError({ run_id: runId, code: input.code, message: publicMessage, exit_code: 1 });
	const failureStation = input.code === "invalid_target" && input.invocation?.check
		? `${command}.check_invalid_target`
		: `${command}.${input.code}`;
	const result = emptyResult(command, input.code, failureStation, input.invocation?.scope);
	// Failed `commands` runs carry the generic setup.result contract, not setup.commands:
	// the station catalog pins commands.invalid_usage to SETUP_RESULT_CONTRACT_ID.
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

function emptyResult(
	command: SetupCommand,
	code: string,
	station = `${command}.${code}`,
	scope: SetupResult["scope"] = "user",
): SetupResult {
	return {
		command, scope, state: "failed",
		findings: [], domains: [], operations: [], projection_targets: [],
		counts: { catalog: 0, managed: 0, external: 0, planned: 0, blockers: 0 },
		catalog_root: "unavailable", destination_roots: [],
		station,
		next_action: code === "invalid_usage" || code === "invalid_target" ? "change_input" : "inspect_diagnostics",
	};
}

function commandFromArgv(argv: readonly string[]): SetupCommand {
	const candidate = argv[0] !== undefined && !argv[0].startsWith("-") ? argv[0] : undefined;
	return candidate && SETUP_COMMANDS.includes(candidate as SetupCommand)
		? candidate as SetupCommand
		: "status";
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
