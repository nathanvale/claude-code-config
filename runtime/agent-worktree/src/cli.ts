#!/usr/bin/env bun

import {
	type CliWriter,
	type CommandFacadeResultContract,
	type CommandResultPayload,
	createCliRepairStateRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	createCliUsageRuntimeError,
	createCommandResultData,
	parseCliDiagnosticArgv,
	projectCommandDiscoveryTree,
	renderCommandUsage,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	agentWorktreeLifecycleResultContract,
	agentWorktreeContractEntries,
	agentWorktreeContracts,
} from "./command-contract.ts";
import {
	type GitRunner,
	defaultGitRunner,
	discoverRepo,
} from "./discovery.ts";
import { runDoctor } from "./doctor.ts";
import type { DoctorMap } from "./doctor.ts";
import {
	buildHandoffSnapshot,
	inspectRefFromRoot,
	parseAgentWorktreeRef,
} from "./inspect.ts";
import {
	AGENT_WORKTREE_CLI_NAME,
	AGENT_WORKTREE_COMMANDS,
	type AgentWorktreeChangedState,
	type AgentWorktreeCommand,
} from "./model.ts";
import {
	PROJECTION_FIELD_SETS,
	type ProjectionFieldSet,
} from "./projection.ts";
import {
	checkWorktree,
	cleanPreview,
	createWorktree,
	deleteWorktree,
	type LifecycleResult,
	listWorktrees,
	recoverPreview,
	refreshWorktrees,
	statusWorktreeResult,
} from "./worktrees.ts";

const VERSION = "0.1.0";

/**
 * Runtime hooks for the CLI front door.
 */
export interface AgentWorktreeCliRuntime {
	/** Current cwd for repo-scoped commands. */
	cwd: () => string;
	/** Current epoch millis for deterministic envelope durations in tests. */
	now: () => number;
	/** Git subprocess runner. */
	run: GitRunner;
}

/**
 * Parsed public invocation.
 *
 * @example
 * ```typescript
 * const parsed = parseInvocation(["doctor", "--json"])
 * ```
 */
export interface ParsedInvocation {
	/** Command id. */
	command?: AgentWorktreeCommand;
	/** Positional args after the command. */
	positionals: readonly string[];
	/** Explicit repo cwd. */
	repo?: string;
	/** JSON output requested. */
	json: boolean;
	/** Dry-run/write preview. */
	dryRun: boolean;
	/** Preview spelling for clean. */
	preview: boolean;
	/** Force destructive execution. */
	force: boolean;
	/** Delete branch after worktree removal. */
	deleteBranch: boolean;
	/** Explicit typed ref. */
	ref?: string;
	/** Base branch or revision for creation. */
	base?: string;
	/** Output limit. */
	limit?: number;
	/** Projection field sets. */
	fields?: readonly ProjectionFieldSet[];
	/** Projection selector. */
	select?: readonly string[];
	/** Parse error result. */
	parseError?: CommandResult;
}

/**
 * Build the default CLI runtime adapter.
 *
 * @param overrides - Hooks tests use to keep envelope timing deterministic
 * @returns Runtime adapter for the CLI front door
 *
 * @example
 * ```typescript
 * const runtime = createDefaultRuntime({ now: () => 0 })
 * ```
 */
export function createDefaultRuntime(
	overrides: Partial<AgentWorktreeCliRuntime> = {},
): AgentWorktreeCliRuntime {
	return {
		cwd: () => process.cwd(),
		now: () => Date.now(),
		run: defaultGitRunner,
		...overrides,
	};
}

type CommandResult =
	| {
			ok: true;
			data: Record<string, unknown>;
			changedState?: AgentWorktreeChangedState;
	  }
	| {
			ok: false;
			exitCode: 1 | 2;
			code: "usage_error" | "runtime_error";
			message: string;
			action: string;
			changedState: AgentWorktreeChangedState;
			data?: Record<string, unknown>;
	  };

type ContextHeavyReadCommand = Extract<
	AgentWorktreeCommand,
	"doctor" | "list" | "status" | "clean" | "handoff"
>;

type AgentWorktreeLifecycleData = {
	action: LifecycleResult["action"];
	changed_state: LifecycleResult["changedState"];
	preview: LifecycleResult["preview"];
	run_ref: LifecycleResult["runRef"] | undefined;
	failure_ref: LifecycleResult["failureRef"] | undefined;
	changes: LifecycleResult["changes"];
	next_safe_action: LifecycleResult["nextSafeAction"];
	reason: LifecycleResult["reason"] | undefined;
	recovery: LifecycleResult["recovery"] | undefined;
	backup_ref: LifecycleResult["backupRef"] | undefined;
};

type AgentWorktreeDoctorData = {
	summary: {
		status: DoctorMap["status"];
		repo_root: DoctorMap["repo"]["gitRoot"] | undefined;
		isolation: DoctorMap["repo"]["isolation"] | undefined;
		main_owner_root: DoctorMap["repo"]["mainOwnerRoot"] | undefined;
		active_worktree: DoctorMap["repo"]["activeWorktree"] | undefined;
		current_branch: DoctorMap["repo"]["currentBranch"] | undefined;
		default_branch: DoctorMap["repo"]["defaultBranch"] | undefined;
		store_root: DoctorMap["repo"]["storeRoot"] | undefined;
		linked_worktree_count: DoctorMap["repo"]["linkedWorktreeCount"];
		stale_dir_count: DoctorMap["repo"]["staleDirCount"];
		available_commands: DoctorMap["availableCommands"];
	};
	checks: {
		id: DoctorMap["checks"][number]["id"];
		owner: DoctorMap["checks"][number]["owner"];
		status: DoctorMap["checks"][number]["status"];
		summary: DoctorMap["checks"][number]["summary"];
		blockers: DoctorMap["checks"][number]["blockers"];
		next_actions: DoctorMap["checks"][number]["nextActions"];
	}[];
	mutation_readiness: DoctorMap["mutationReadiness"];
	blockers: string[];
	next_actions: DoctorMap["nextActions"][number][];
};

const PROJECTION_FIELD_SET_VALUES = new Set<string>(PROJECTION_FIELD_SETS);

const PROJECTION_METADATA_KEYS = ["contract_id", "schema_version"] as const;

const READ_PROJECTION_KEYS = {
	doctor: {
		default: ["summary", "mutation_readiness", "blockers", "next_actions"],
		refs: ["summary"],
		evidence: ["checks", "blockers"],
		actions: ["mutation_readiness", "blockers", "next_actions"],
	},
	list: {
		default: ["worktrees", "total", "truncated"],
		refs: ["worktrees"],
		evidence: ["worktrees", "total", "truncated"],
		actions: ["truncated"],
	},
	status: {
		default: ["isolation", "statuses", "total", "truncated"],
		refs: ["isolation", "statuses"],
		evidence: ["isolation", "statuses", "total", "truncated"],
		actions: ["isolation", "statuses"],
	},
	clean: {
		default: [
			"registeredWorktrees",
			"orphanBranches",
			"staleDirs",
			"blockers",
			"totalRegisteredWorktrees",
			"totalOrphanBranches",
			"totalStaleDirs",
			"truncated",
			"previewOnly",
		],
		refs: ["registeredWorktrees", "orphanBranches"],
		evidence: [
			"registeredWorktrees",
			"orphanBranches",
			"staleDirs",
			"blockers",
			"totalRegisteredWorktrees",
			"totalOrphanBranches",
			"totalStaleDirs",
			"truncated",
		],
		actions: ["blockers", "previewOnly"],
	},
	handoff: {
		default: ["storeRoot", "latest", "total", "truncated", "nextSafeActions"],
		refs: ["storeRoot", "latest"],
		evidence: ["latest", "total", "truncated"],
		actions: ["nextSafeActions"],
	},
} as const satisfies Record<
	ContextHeavyReadCommand,
	Record<ProjectionFieldSet, readonly string[]>
>;

/**
 * CLI entry point: parse argv, route public commands, and emit facade envelopes.
 *
 * @param argv - Process argv tail after the executable name
 * @param options - Optional runtime and writers for tests
 * @returns Process exit code
 *
 * @example
 * ```typescript
 * const exitCode = await main(["commands", "--json"])
 * ```
 */
export async function main(
	argv: readonly string[],
	options: {
		runtime?: Partial<AgentWorktreeCliRuntime>;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = createDefaultRuntime(options.runtime);
	const stdout = options.stdout ?? process.stdout;

	if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
		const command = argv.find(isAgentWorktreeCommand) ?? "doctor";
		stdout.write(renderCommandUsage(agentWorktreeContracts[command]));
		return 0;
	}
	if (argv.includes("--version")) {
		stdout.write(`${AGENT_WORKTREE_CLI_NAME} ${VERSION}\n`);
		return 0;
	}

	const parsedDiagnostics = parseCliDiagnosticArgv(argv);
	const runId = parsedDiagnostics.options.runId;
	const startedAtMs = parsedDiagnostics.options.startedAtMs;
	const invocation = parseInvocation(parsedDiagnostics.argv);
	const result = await runCommand(invocation, runtime, runId);
	const durationMs = runtime.now() - startedAtMs;

	if (result.ok) {
		writeJsonEnvelope(
			stdout,
			createCliRuntimeSuccessEnvelope({ run_id: runId, data: result.data }),
			{ runId, durationMs },
		);
		return 0;
	}

	writeJsonEnvelope(
		stdout,
		createCliRuntimeErrorEnvelope({
			run_id: runId,
			process_exit_code: result.exitCode,
			error:
				result.code === "usage_error"
					? createCliUsageRuntimeError({
							run_id: runId,
							code: result.code,
							message: result.message,
							hint: { action: "change_input", summary: result.action },
							failure_domain: "agent_worktree",
						})
					: createCliRepairStateRuntimeError({
							run_id: runId,
							code: result.code,
							message: result.message,
							exit_code: result.exitCode,
							hint: { action: "repair_state", summary: result.action },
							failure_domain: "agent_worktree",
						}),
			data: lifecycleResultData({
				changed_state: result.changedState,
				next_safe_action: result.action,
				...result.data,
			}),
		}),
		{ runId, durationMs },
	);
	return result.exitCode;
}

/**
 * Parse argv into the package command invocation.
 *
 * @param argv - Diagnostic-stripped argv
 * @returns Parsed invocation with package-owned usage errors
 *
 * @example
 * ```typescript
 * const parsed = parseInvocation(["inspect", "run:abc", "--json"])
 * ```
 */
export function parseInvocation(argv: readonly string[]): ParsedInvocation {
	const positionals: string[] = [];
	let command: AgentWorktreeCommand | undefined;
	let repo: string | undefined;
	let ref: string | undefined;
	let base: string | undefined;
	let limit: number | undefined;
	let fields: readonly ProjectionFieldSet[] | undefined;
	let select: readonly string[] | undefined;
	let json = false;
	let dryRun = false;
	let preview = false;
	let force = false;
	let deleteBranch = false;
	const usedFlags = new Set<string>();
	const fail = (message: string): ParsedInvocation => ({
		command,
		positionals,
		repo,
		json,
		dryRun,
		preview,
		force,
		deleteBranch,
		ref,
		base,
		limit,
		fields,
		select,
		parseError: usageFailure(message),
	});

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--json") {
			json = true;
			usedFlags.add(arg);
		} else if (arg === "--dry-run") {
			dryRun = true;
			usedFlags.add(arg);
		} else if (arg === "--preview") {
			preview = true;
			usedFlags.add(arg);
		} else if (arg === "--force") {
			force = true;
			usedFlags.add(arg);
		} else if (arg === "--delete-branch") {
			deleteBranch = true;
			usedFlags.add(arg);
		} else if (
			arg === "--repo" ||
			arg === "--ref" ||
			arg === "--base" ||
			arg === "--limit" ||
			arg === "--fields" ||
			arg === "--select"
		) {
			usedFlags.add(arg);
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				return fail(`${arg} needs a value.`);
			}
			if (arg === "--repo") repo = value;
			if (arg === "--ref") ref = value;
			if (arg === "--base") base = value;
			if (arg === "--fields") {
				const parsedFields = parseProjectionFields(value);
				if (!parsedFields.ok) return fail(parsedFields.message);
				fields = parsedFields.fields;
			}
			if (arg === "--select") {
				const parsedSelect = parseProjectionSelect(value);
				if (!parsedSelect.ok) return fail(parsedSelect.message);
				select = parsedSelect.select;
			}
			if (arg === "--limit") {
				const parsedLimit = Number.parseInt(value, 10);
				if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
					return fail("--limit needs a positive integer.");
				}
				limit = parsedLimit;
			}
			index += 1;
		} else if (arg.startsWith("--")) {
			return fail(`Unknown flag '${arg}'.`);
		} else if (!command && isAgentWorktreeCommand(arg)) {
			command = arg;
		} else if (!command) {
			return fail(`Unknown command '${arg}'.`);
		} else {
			positionals.push(arg);
		}
	}

	if (!command) return fail("Missing command.");
	const allowedFlags = new Set(Object.keys(agentWorktreeContracts[command].flags));
	for (const flag of usedFlags) {
		if (!allowedFlags.has(flag)) {
			return fail(`Flag '${flag}' is not accepted by agent-worktree ${command}.`);
		}
	}
	return {
		command,
		positionals,
		repo,
		json,
		dryRun,
		preview,
		force,
		deleteBranch,
		ref,
		base,
		limit,
		fields,
		select,
	};
}

/**
 * Route a parsed invocation to command behavior.
 *
 * @param invocation - Parsed argv
 * @param runtime - CLI runtime
 * @param runId - Facade run id
 * @returns Command result
 *
 * @example
 * ```typescript
 * const result = await runCommand(parseInvocation(["doctor"]), createDefaultRuntime(), "r1")
 * ```
 */
export async function runCommand(
	invocation: ParsedInvocation,
	runtime: AgentWorktreeCliRuntime,
	runId: string,
): Promise<CommandResult> {
	if (invocation.parseError) return invocation.parseError;
	const command = invocation.command;
	const cwd = invocation.repo ?? runtime.cwd();
	if (!command) return usageFailure("Missing command.");

	try {
		switch (command) {
			case "commands":
				return {
					ok: true,
					data: resultData(
						"commands",
						projectCommandDiscoveryTree(agentWorktreeContractEntries),
					),
				};
			case "doctor":
				return readCommandResult(
					"doctor",
					doctorData(await runDoctor({ cwd, run: runtime.run })),
					invocation,
				);
			case "list":
				return readCommandResult(
					"list",
					await listWorktrees({ cwd, run: runtime.run, limit: invocation.limit }),
					invocation,
				);
			case "status":
				return readCommandResult(
					"status",
					await statusWorktreeResult({
						cwd,
						run: runtime.run,
						limit: invocation.limit,
					}),
					invocation,
				);
			case "check": {
				const branch = invocation.positionals[0];
				if (!branch) return usageFailure("check needs <branch>.");
				return {
					ok: true,
					data: resultData(
						"check",
						await checkWorktree({ cwd, run: runtime.run, branch }),
					),
				};
			}
			case "create": {
				const branch = invocation.positionals[0];
				if (!branch) return usageFailure("create needs <branch>.");
				const result = await createWorktree({
					cwd,
					run: runtime.run,
					branch,
					base: invocation.base,
					dryRun: invocation.dryRun,
					runId,
					now: runtime.now,
				});
				return lifecycleCommandResult("create", result, invocation.dryRun);
			}
			case "delete": {
				const branch = invocation.positionals[0];
				if (!branch) return usageFailure("delete needs <branch>.");
				if (!invocation.dryRun && !invocation.force) {
					return usageFailure("delete normal execution needs --force.");
				}
				const result = await deleteWorktree({
					cwd,
					run: runtime.run,
					branch,
					dryRun: invocation.dryRun,
					force: invocation.force,
					deleteBranch: invocation.deleteBranch,
					runId,
					now: runtime.now,
				});
				return lifecycleCommandResult("delete", result, invocation.dryRun);
			}
			case "refresh": {
				const result = await refreshWorktrees({
					cwd,
					run: runtime.run,
					dryRun: invocation.dryRun,
					runId,
					now: runtime.now,
				});
				return lifecycleCommandResult("refresh", result, invocation.dryRun);
			}
			case "clean":
				return readCommandResult(
					"clean",
					await cleanPreview({
						cwd,
						run: runtime.run,
						limit: invocation.limit,
					}),
					invocation,
				);
			case "recover": {
				const ref = invocation.ref ?? invocation.positionals[0];
				const parsedRef = ref ? parseAgentWorktreeRef(ref) : null;
				if (!ref || !parsedRef) {
					return usageFailure("recover needs a typed ref.");
				}
				const discovery = await discoverRepo({ cwd, run: runtime.run });
				if (!discovery.storeRoot) {
					return runtimeFailure(
						"recover needs a resolved repo store root.",
						"Repo readiness needs a repository root before recovery.",
						"none",
					);
				}
				const inspected = await inspectRefFromRoot(discovery.storeRoot, ref);
				if (!inspected?.found) {
					return runtimeFailure(
						"recover ref was not found in the durable store.",
						"Inspect current durable refs before recovery.",
						"none",
					);
				}
				const record = inspected.record as
					| { changedState?: AgentWorktreeChangedState }
					| undefined;
				return {
					ok: true,
					data: resultData(
						"recover",
						lifecycleData(
							recoverPreview({
								ref,
								changedState: record?.changedState,
								failureRef:
									parsedRef.kind === "failure" ? parsedRef : undefined,
							}),
						),
					),
				};
			}
			case "inspect": {
				const ref = invocation.ref ?? invocation.positionals[0];
				if (!ref) return usageFailure("inspect needs a typed ref.");
				if (!parseAgentWorktreeRef(ref)) {
					return usageFailure("inspect needs a supported typed ref.");
				}
				const discovery = await discoverRepo({ cwd, run: runtime.run });
				if (!discovery.storeRoot) {
					return runtimeFailure(
						"inspect needs a resolved repo store root.",
						"Repo readiness needs a repository root before ref inspection.",
						"none",
					);
				}
				const inspected = await inspectRefFromRoot(discovery.storeRoot, ref);
				if (!inspected) {
					return usageFailure("inspect needs a supported typed ref.");
				}
				return { ok: true, data: resultData("inspect", inspected) };
			}
			case "handoff": {
				const discovery = await discoverRepo({ cwd, run: runtime.run });
				if (!discovery.storeRoot) {
					return runtimeFailure(
						"handoff needs a resolved repo store root.",
						"Repo readiness needs a repository root before handoff.",
						"none",
					);
				}
				return readCommandResult(
					"handoff",
					await buildHandoffSnapshot(
						discovery.storeRoot,
						{ limit: invocation.limit },
					),
					invocation,
				);
			}
		}
	} catch (error) {
		return {
			ok: false,
			exitCode: 1,
			code: "runtime_error",
			message: error instanceof Error ? error.message : "Command failed.",
			action: "Inspect repo readiness and durable state before retry.",
			changedState: "unknown",
		};
	}
}

function usageFailure(message: string): CommandResult {
	return {
		ok: false,
		exitCode: 2,
		code: "usage_error",
		message,
		action: "Review command help and retry with supported arguments.",
		changedState: "none",
	};
}

function runtimeFailure(
	message: string,
	action: string,
	changedState: AgentWorktreeChangedState,
	data?: Record<string, unknown>,
): CommandResult {
	return {
		ok: false,
		exitCode: 1,
		code: "runtime_error",
		message,
		action,
		changedState,
		data,
	};
}

function lifecycleCommandResult(
	command: AgentWorktreeCommand,
	result: LifecycleResult,
	previewAllowed: boolean,
): CommandResult {
	const data = lifecycleData(result);
	if (result.changedState === "complete" || (previewAllowed && result.preview)) {
		return {
			ok: true,
			data: resultData(command, data),
			changedState: result.changedState,
		};
	}
	return runtimeFailure(
		result.reason
			? `Lifecycle ${result.action} did not complete: ${result.reason}.`
			: `Lifecycle ${result.action} did not complete.`,
		`Follow lifecycle recovery action: ${result.nextSafeAction}.`,
		result.changedState,
		data,
	);
}

function readCommandResult<TData extends object>(
	command: ContextHeavyReadCommand,
	data: CommandResultPayload<TData>,
	invocation: ParsedInvocation,
): CommandResult {
	const projected = projectReadData(command, resultData(command, data), invocation);
	if (!projected.ok) return usageFailure(projected.message);
	return { ok: true, data: projected.data };
}

function projectReadData(
	command: ContextHeavyReadCommand,
	data: Record<string, unknown>,
	invocation: ParsedInvocation,
):
	| { ok: true; data: Record<string, unknown> }
	| { ok: false; message: string } {
	if (!invocation.fields && !invocation.select) return { ok: true, data };

	const keys = new Set<string>(PROJECTION_METADATA_KEYS);
	for (const fieldSet of invocation.fields ?? []) {
		for (const key of READ_PROJECTION_KEYS[command][fieldSet]) {
			keys.add(key);
		}
	}

	for (const key of invocation.select ?? []) {
		if (!(key in data)) {
			return {
				ok: false,
				message: `--select field '${key}' is not present in agent-worktree ${command} output.`,
			};
		}
		keys.add(key);
	}

	return {
		ok: true,
		data: pickExistingKeys(data, keys),
	};
}

function pickExistingKeys(
	data: Record<string, unknown>,
	keys: Iterable<string>,
): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const key of keys) {
		if (key in data) output[key] = data[key];
	}
	return output;
}

function parseProjectionFields(
	value: string,
):
	| { ok: true; fields: readonly ProjectionFieldSet[] }
	| { ok: false; message: string } {
	const fields = value
		.split(",")
		.map((field) => field.trim())
		.filter(Boolean);
	if (fields.length === 0) {
		return { ok: false, message: "--fields needs at least one field set." };
	}
	const invalid = fields.find((field) => !PROJECTION_FIELD_SET_VALUES.has(field));
	if (invalid) {
		return {
			ok: false,
			message: `Unsupported --fields value '${invalid}'. Use ${PROJECTION_FIELD_SETS.join(", ")}.`,
		};
	}
	return {
		ok: true,
		fields: [...new Set(fields)] as readonly ProjectionFieldSet[],
	};
}

function parseProjectionSelect(
	value: string,
):
	| { ok: true; select: readonly string[] }
	| { ok: false; message: string } {
	const select = value
		.split(",")
		.map((field) => field.trim())
		.filter(Boolean);
	if (select.length === 0) {
		return { ok: false, message: "--select needs at least one field." };
	}
	const invalid = select.find((field) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(field));
	if (invalid) {
		return {
			ok: false,
			message:
				"--select accepts comma-separated top-level JSON field names.",
		};
	}
	return { ok: true, select: [...new Set(select)] };
}

function doctorData(data: DoctorMap): AgentWorktreeDoctorData {
	const blockers = [...new Set(data.checks.flatMap((check) => check.blockers))];
	return {
		summary: {
			status: data.status,
			repo_root: data.repo.gitRoot,
			isolation: data.repo.isolation,
			main_owner_root: data.repo.mainOwnerRoot,
			active_worktree: data.repo.activeWorktree,
			current_branch: data.repo.currentBranch,
			default_branch: data.repo.defaultBranch,
			store_root: data.repo.storeRoot,
			linked_worktree_count: data.repo.linkedWorktreeCount,
			stale_dir_count: data.repo.staleDirCount,
			available_commands: data.availableCommands,
		},
		checks: data.checks.map((check) => ({
			id: check.id,
			owner: check.owner,
			status: check.status,
			summary: check.summary,
			blockers: check.blockers,
			next_actions: check.nextActions,
		})),
		mutation_readiness: data.mutationReadiness,
		blockers,
		next_actions: [...new Set(data.nextActions)],
	};
}

function resultData<TData extends object>(
	command: AgentWorktreeCommand,
	data: CommandResultPayload<TData>,
): Record<string, unknown> {
	return createCommandResultData(
		agentWorktreeContracts[command] as {
			resultContract?: CommandFacadeResultContract;
		},
		data,
	);
}

function lifecycleResultData<TData extends object>(
	data: CommandResultPayload<TData>,
): Record<string, unknown> {
	return createCommandResultData(
		{ resultContract: agentWorktreeLifecycleResultContract },
		data,
	);
}

function lifecycleData(result: LifecycleResult): AgentWorktreeLifecycleData {
	return {
		action: result.action,
		changed_state: result.changedState,
		preview: result.preview,
		run_ref: result.runRef,
		failure_ref: result.failureRef,
		changes: result.changes,
		next_safe_action: result.nextSafeAction,
		reason: result.reason,
		recovery: result.recovery,
		backup_ref: result.backupRef,
	};
}

function isAgentWorktreeCommand(value: string): value is AgentWorktreeCommand {
	return AGENT_WORKTREE_COMMANDS.includes(value as AgentWorktreeCommand);
}

if (import.meta.main) {
	process.exit(await main(process.argv.slice(2)));
}
