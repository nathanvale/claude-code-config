#!/usr/bin/env bun

import {
	type CliWriter,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	projectCommandDiscoveryTree,
	renderCommandUsage,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import { applyVisibility, discoverCatalog } from "./catalog.ts";
import {
	addIgnorePattern,
	loadAgentSkillsConfig,
	removeIgnorePattern,
} from "./config.ts";
import {
	agentSkillsContractEntries,
	agentSkillsContracts,
} from "./command-contract.ts";
import {
	AGENT_SKILLS_CLI_NAME,
	AGENT_SKILLS_COMMANDS,
	AGENT_SKILLS_CONTRACT_ID,
	AGENT_SKILLS_SCHEMA_VERSION,
	type AgentSkillsCommand,
	type SkillVisibility,
} from "./model.ts";
import {
	applyProjection,
	planProjection,
	unlinkManagedProjections,
	type AgentSkillsProjectionPlan,
} from "./projection.ts";
import {
	renderIgnore,
	renderList,
	renderStatus,
	renderSync,
	renderUnlink,
	type AgentSkillsIgnoreResult,
	type AgentSkillsListResult,
	type AgentSkillsUnlinkResult,
} from "./renderer.ts";

const VERSION = "0.1.0";

/**
 * Runtime hooks for the CLI front door.
 */
export interface AgentSkillsCliRuntime {
	/** Current cwd for repo-scoped commands. */
	cwd: () => string;
	/** Current epoch millis for deterministic tests. */
	now: () => number;
}

/**
 * Parsed public invocation.
 */
export interface ParsedInvocation {
	/** Command id. */
	command?: AgentSkillsCommand;
	/** Positional args after command and flags. */
	positionals: readonly string[];
	/** JSON output requested. */
	json: boolean;
	/** Preview writes without mutating. */
	check: boolean;
	/** Raw flags accepted for the command. */
	flags: ReadonlySet<string>;
	/** Parse error result. */
	parseError?: CommandResult;
}

type RuntimeErrorCode = "invalid_config" | "missing_config" | "unmanaged_blocker";

type CommandResult =
	| {
			ok: true;
			exitCode: 0 | 1;
			data: Record<string, unknown>;
			human: string;
	  }
	| {
			ok: false;
			exitCode: 1 | 2;
			code: "usage_error" | RuntimeErrorCode;
			message: string;
			action: "help" | "fix_config" | "inspect_blocker";
			data?: Record<string, unknown>;
	  };

type CommandFailure = Extract<CommandResult, { ok: false }>;

/**
 * Build the default CLI runtime adapter.
 *
 * @param overrides - Hooks tests use for deterministic execution
 * @returns Runtime adapter
 *
 * @example
 * ```typescript
 * const runtime = createDefaultRuntime({ now: () => 0 })
 * ```
 */
export function createDefaultRuntime(
	overrides: Partial<AgentSkillsCliRuntime> = {},
): AgentSkillsCliRuntime {
	return {
		cwd: () => process.cwd(),
		now: () => Date.now(),
		...overrides,
	};
}

/**
 * CLI entry point.
 *
 * @param argv - Process argv tail after executable name
 * @param options - Optional runtime and writers for tests
 * @returns Process exit code
 *
 * @example
 * ```typescript
 * await main(["status", "--json"])
 * ```
 */
export async function main(
	argv: readonly string[],
	options: {
		runtime?: Partial<AgentSkillsCliRuntime>;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = createDefaultRuntime(options.runtime);
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;

	if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
		const command = argv.find(isAgentSkillsCommand) ?? "status";
		stdout.write(renderCommandUsage(agentSkillsContracts[command]));
		return 0;
	}
	if (argv.includes("--version")) {
		stdout.write(`${AGENT_SKILLS_CLI_NAME} ${VERSION}\n`);
		return 0;
	}

	const parsedDiagnostics = parseCliDiagnosticArgv(argv);
	const runId = parsedDiagnostics.options.runId;
	const startedAtMs = parsedDiagnostics.options.startedAtMs;
	const invocation = parseInvocation(parsedDiagnostics.argv);
	const result = await runCommand(invocation, runtime);
	const durationMs = runtime.now() - startedAtMs;

	if (invocation.json) {
		if (result.ok) {
			writeJsonEnvelope(
				stdout,
				createCliRuntimeSuccessEnvelope({ run_id: runId, data: result.data }),
				{ runId, durationMs },
			);
		} else {
			writeJsonEnvelope(
				stdout,
				createCliRuntimeErrorEnvelope({
					run_id: runId,
					process_exit_code: result.exitCode,
					error: {
						run_id: runId,
						code: result.code,
						message: result.message,
						exit_code: result.exitCode,
						severity: result.exitCode === 2 ? "warning" : "error",
						recoverability:
							result.action === "help" ? "change_input" : "repair_state",
						retryable: result.action !== "help",
						hint: {
							summary: result.message,
							action:
								result.action === "help" ? "change_input" : "repair_state",
						},
						failure_domain: result.code,
					},
					data: baseData(result.data ?? {}),
				}),
				{ runId, durationMs },
			);
		}
		return result.exitCode;
	}

	if (result.ok) {
		stdout.write(result.human);
	} else {
		stderr.write(`${result.message}\n`);
		stderr.write(`next: ${result.action}\n`);
	}
	return result.exitCode;
}

/**
 * Parse public argv into a small invocation model.
 *
 * @param argv - Public argv tail
 * @returns Parsed invocation or usage failure
 *
 * @example
 * ```typescript
 * const parsed = parseInvocation(["sync", "--check", "--json"])
 * ```
 */
export function parseInvocation(argv: readonly string[]): ParsedInvocation {
	const command = argv[0];
	if (!isAgentSkillsCommand(command)) {
		return {
			positionals: [],
			json: argv.includes("--json"),
			check: false,
			flags: new Set(argv.filter((arg) => arg.startsWith("-"))),
			parseError: usageFailure(`Unknown command: ${command ?? "(missing)"}.`),
		};
	}

	const flags = argv.slice(1).filter((arg) => arg.startsWith("-"));
	const allowed = new Set(Object.keys(agentSkillsContracts[command].flags));
	for (const flag of flags) {
		if (!allowed.has(flag)) {
			return {
				command,
				positionals: [],
				json: argv.includes("--json"),
				check: argv.includes("--check"),
				flags: new Set(flags),
				parseError: usageFailure(`Unsupported flag for ${command}: ${flag}.`),
			};
		}
	}

	return {
		command,
		positionals: argv.slice(1).filter((arg) => !arg.startsWith("-")),
		json: argv.includes("--json"),
		check: argv.includes("--check"),
		flags: new Set(flags),
	};
}

/**
 * Route a parsed invocation to command behavior.
 *
 * @param invocation - Parsed argv
 * @param runtime - CLI runtime hooks
 * @returns Command result for renderer and process exit
 *
 * @example
 * ```typescript
 * await runCommand(parseInvocation(["commands", "--json"]), createDefaultRuntime())
 * ```
 */
export async function runCommand(
	invocation: ParsedInvocation,
	runtime: AgentSkillsCliRuntime,
): Promise<CommandResult> {
	if (invocation.parseError) return invocation.parseError;
	if (!invocation.command) return usageFailure("Missing command.");

	try {
		switch (invocation.command) {
			case "commands": {
				const discovery = projectCommandDiscoveryTree(agentSkillsContractEntries);
				return okResult(baseData(discovery), "", 0);
			}
			case "status": {
				const state = await loadProjectionState(runtime.cwd());
				if (!state.ok) return state.error;
				return okResult(
					baseData(state.plan.status),
					renderStatus(state.plan),
					0,
				);
			}
			case "sync": {
				const state = await loadProjectionState(runtime.cwd());
				if (!state.ok) return state.error;
				if (state.plan.status.blockers.length > 0) {
					return runtimeFailure(
							"unmanaged_blocker",
							"Unmanaged projection entries block sync.",
							"inspect_blocker",
							{ ...state.plan.status },
						);
				}
				if (invocation.check) {
					const clean = state.plan.status.health === "clean";
					return okResult(
						baseData({ ...state.plan.status, check: true }),
						renderSync(state.plan, true),
						clean ? 0 : 1,
					);
				}
				await applyProjection(
					state.plan,
					new Date(runtime.now()).toISOString(),
				);
				const next = await loadProjectionState(runtime.cwd());
				if (!next.ok) return next.error;
				return okResult(
					baseData({ ...next.plan.status, station: "synced" }),
					renderSync(next.plan, false),
					0,
				);
			}
			case "list": {
				const state = await loadProjectionState(runtime.cwd());
				if (!state.ok) return state.error;
				const result = buildListResult(
					state.visibility,
					state.plan,
					invocation,
				);
				return okResult(baseData(result), renderList(result), 0);
			}
			case "ignore":
				return runIgnore(invocation, runtime);
			case "unlink": {
				const state = await loadProjectionState(runtime.cwd());
				if (!state.ok) return state.error;
				const links = await unlinkManagedProjections(
					state.plan.status.repo_root,
					state.plan.status.catalog_root,
					invocation.check,
				);
				const result: AgentSkillsUnlinkResult = {
					check: invocation.check,
					links,
					next_action_summary: invocation.check
						? "Run unlink without check to remove managed links."
						: "Run sync to regenerate local projections.",
				};
				return okResult(baseData(result), renderUnlink(result), 0);
			}
		}
	} catch (error) {
		return runtimeFailure(
			"unmanaged_blocker",
			(error as Error).message,
			"inspect_blocker",
		);
	}
}

async function loadProjectionState(cwd: string): Promise<
	| {
			ok: true;
			plan: AgentSkillsProjectionPlan;
			visibility: readonly SkillVisibility[];
	  }
	| { ok: false; error: CommandFailure }
> {
	const loaded = await loadAgentSkillsConfig(cwd);
	if (!loaded.ok) {
		return {
			ok: false,
			error: runtimeFailure(
				loaded.error.code,
				loaded.error.message,
				"fix_config",
				{ path: loaded.error.path },
			),
		};
	}
	const entries = await discoverCatalog(loaded.config.catalogRoot);
	const visibility = applyVisibility(entries, loaded.config.ignore);
	const plan = await planProjection({
		repoRoot: loaded.config.repoRoot,
		catalogRoot: loaded.config.catalogRoot,
		visibility,
	});
	return { ok: true, plan, visibility };
}

async function runIgnore(
	invocation: ParsedInvocation,
	runtime: AgentSkillsCliRuntime,
): Promise<CommandResult> {
	const action = invocation.positionals[0];
	const pattern = invocation.positionals[1];
	if (!["add", "remove", "list", "suggest"].includes(action ?? "")) {
		return usageFailure("ignore needs add, remove, list, or suggest.");
	}
	if ((action === "add" || action === "remove") && !pattern) {
		return usageFailure(`ignore ${action} needs <pattern>.`);
	}

	if (action === "add" || action === "remove") {
		const updated =
			action === "add"
				? await addIgnorePattern(runtime.cwd(), pattern)
				: await removeIgnorePattern(runtime.cwd(), pattern);
		if (!updated.ok) {
			return runtimeFailure(
				updated.error.code,
				updated.error.message,
				"fix_config",
			);
		}
		const result: AgentSkillsIgnoreResult = {
			action,
			patterns: updated.config.ignore,
			changed_pattern: pattern,
			next_action_summary: "Run sync to update local projections.",
		};
		return okResult(baseData(result), renderIgnore(result), 0);
	}

	const state = await loadProjectionState(runtime.cwd());
	if (!state.ok) return state.error;
	const patterns =
		action === "suggest"
			? suggestIgnorePatterns(state.visibility)
			: await currentIgnorePatterns(runtime.cwd());
	const result: AgentSkillsIgnoreResult = {
		action: action as "list" | "suggest",
		patterns,
		next_action_summary:
			action === "suggest"
				? "Add one suggested pattern when it matches real noise."
				: "Run ignore add to hide noisy skill ids.",
	};
	return okResult(baseData(result), renderIgnore(result), 0);
}

function buildListResult(
	visibility: readonly SkillVisibility[],
	plan: AgentSkillsProjectionPlan,
	invocation: ParsedInvocation,
): AgentSkillsListResult {
	const flags = {
		visible: invocation.flags.has("--visible"),
		ignored: invocation.flags.has("--ignored"),
		new: invocation.flags.has("--new"),
		why: invocation.flags.has("--why"),
	};
	const explicitId = invocation.positionals[0];
	const filtered = visibility.filter((entry) => {
		if (flags.visible && entry.state !== "visible") return false;
		if (flags.ignored && entry.state !== "ignored") return false;
		if (flags.new && !plan.status.newly_visible.includes(entry.id)) return false;
		if (flags.why && explicitId && entry.id !== explicitId) return false;
		return true;
	});

	return {
		entries: filtered,
		why: flags.why,
		mode: flags.new
			? "new"
			: flags.ignored
				? "ignored"
				: flags.visible
					? "visible"
					: "all",
		next_action_summary: plan.status.next_action_summary,
	};
}

async function currentIgnorePatterns(cwd: string): Promise<readonly string[]> {
	const loaded = await loadAgentSkillsConfig(cwd);
	return loaded.ok ? loaded.config.ignore : [];
}

function suggestIgnorePatterns(
	visibility: readonly SkillVisibility[],
): readonly string[] {
	const ids = visibility.map((entry) => entry.id);
	return ["archive", "experimental", "fixture"]
		.filter((prefix) => ids.some((id) => id.startsWith(`${prefix}-`)))
		.map((prefix) => `${prefix}-*`);
}

function isAgentSkillsCommand(value: unknown): value is AgentSkillsCommand {
	return (
		typeof value === "string" &&
		(AGENT_SKILLS_COMMANDS as readonly string[]).includes(value)
	);
}

function okResult(
	data: Record<string, unknown>,
	human: string,
	exitCode: 0 | 1,
): CommandResult {
	return { ok: true, data, human, exitCode };
}

function usageFailure(message: string): CommandFailure {
	return {
		ok: false,
		exitCode: 2,
		code: "usage_error",
		message: `${message} Use --help.`,
		action: "help",
	};
}

function runtimeFailure(
	code: RuntimeErrorCode,
	message: string,
	action: "fix_config" | "inspect_blocker",
	data: Record<string, unknown> = {},
): CommandFailure {
	return {
		ok: false,
		exitCode: 1,
		code,
		message,
		action,
		data,
	};
}

function baseData(data: object): Record<string, unknown> {
	return {
		contract_id: AGENT_SKILLS_CONTRACT_ID,
		schema_version: AGENT_SKILLS_SCHEMA_VERSION,
		...data,
	};
}

if (import.meta.main) {
	const exitCode = await main(Bun.argv.slice(2));
	process.exit(exitCode);
}
