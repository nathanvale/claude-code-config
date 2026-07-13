import {
	type CommandFacadeActionAffordance,
	type CommandFacadeContract,
	defineCommandFacadeContract,
	parseEnumFlag,
	projectCommandDiscoveryTree,
	requireValue,
	usageError,
} from "@side-quest/cli-command-facade";
import {
	SETUP_ACTION_IDS,
	SETUP_CLI_NAME,
	SETUP_COMMANDS,
	SETUP_COMMANDS_CONTRACT_ID,
	SETUP_RESULT_CONTRACT_ID,
	SETUP_SCHEMA_VERSION,
	SETUP_SCOPES,
	type SetupActionId,
	type SetupCommand,
	type SetupScope,
} from "./model.ts";

export type SetupAudience = "operator" | "agent";
export type SetupMutation = "check" | "write";
export type SetupCommandContract = CommandFacadeContract<
	SetupCommand,
	SetupAudience,
	SetupMutation
>;

const resultContract = {
	id: SETUP_RESULT_CONTRACT_ID,
	kind: "Setup inspection, plan, or mutation result.",
	schema_version: SETUP_SCHEMA_VERSION,
} as const;

const commandsResultContract = {
	id: SETUP_COMMANDS_CONTRACT_ID,
	kind: "Setup command discovery metadata.",
	schema_version: SETUP_SCHEMA_VERSION,
} as const;

export const setupExitCodes = {
	"0": "Command completed successfully.",
	"1": "Drift, findings, blockers, partial completion, or runtime failure.",
	"2": "Invalid command usage or input.",
} as const satisfies SetupCommandContract["exitCodes"];

const commonFlags = {
	"--scope": {
		type: "enum",
		values: SETUP_SCOPES,
		description: "Select user state or an explicit project target.",
	},
	"--repo": {
		type: "path",
		description: "Target repository; required only for project state.",
	},
	"--json": { type: "boolean", description: "Emit one stable JSON envelope." },
	"--no-color": { type: "boolean", description: "Disable human-output color." },
} as const;

/** Facade-owned diagnostic flags accepted before package parsing. */
export const SETUP_GLOBAL_DIAGNOSTIC_FLAGS = ["--verbose"] as const;

const catalogFlags = {
	"--scope": commonFlags["--scope"],
	"--repo": commonFlags["--repo"],
	"--json": commonFlags["--json"],
} as const;

const checkFlag = {
	"--check": { type: "boolean", description: "Preview from current evidence without writing." },
} as const;

const actionSummaries: Record<SetupActionId, string> = {
	preview_sync: "Preview the deterministic Setup plan.",
	run_sync: "Apply the current safe Setup plan.",
	run_doctor: "Explain findings, ownership, and repair paths.",
	human_repair: "Stop for operator repair of unproven or unsafe state.",
	change_input: "Correct command arguments or project target.",
	inspect_diagnostics: "Inspect correlated diagnostics before retrying.",
	repair_dependency: "Repair the named dependency, hook, instruction, or runbook domain.",
	inspect_lock: "Inspect stale operation-lock evidence before reclaiming it.",
	retry: "Retry after the transient owner or failure clears.",
	setup_healthy: "Continue with the verified Setup state.",
	rerun_check: "Reinspect current evidence before mutation.",
	repair_hooks: "Repair the Setup-owned hook domain.",
	repair_instructions: "Repair startup instruction delivery.",
	repair_runbook: "Repair the runbook artifact domain.",
	run_unlink: "Remove proven Setup-owned links.",
	clean_state: "Continue with the verified clean state.",
	inspect_results: "Inspect exact applied, deferred, preserved, and failed paths.",
	inspect_catalog: "Inspect source visibility and destination occupancy.",
	use_source: "Use the selected first-party source skill.",
	discover_external: "Use the external acquisition owner for third-party skills.",
};

const readActions = new Set<SetupActionId>([
	"preview_sync", "run_doctor", "change_input", "inspect_diagnostics", "inspect_lock",
	"rerun_check", "inspect_results", "inspect_catalog", "use_source", "discover_external",
]);

export const setupActions = SETUP_ACTION_IDS.map((id) => ({
	id,
	summary: actionSummaries[id],
	sideEffects: readActions.has(id) ? ["read", "check"] : ["read", "check", "write"],
})) as readonly (CommandFacadeActionAffordance & { id: SetupActionId })[];

const actionAffordances = { continuations: setupActions } as const;

export const setupContracts = defineCommandFacadeContract(
	{
		status: {
			script: SETUP_CLI_NAME,
			summary: "Show bounded setup health and one next safe action.",
			usage: ["setup status [options] [--verbose]"],
			json: true, audience: "operator", mutation: "check",
			sideEffects: ["read", "check"], executionModes: ["check"],
			outputModes: ["plain", "json"], capabilityRoles: ["diagnostic"], interactivity: "none",
			resultContract, actionAffordances, flags: commonFlags, exitCodes: setupExitCodes,
		},
		doctor: {
			script: SETUP_CLI_NAME,
			summary: "Explain findings, ownership, and safe repair or handoff.",
			usage: ["setup doctor [options] [--verbose]"],
			json: true, audience: "operator", mutation: "check",
			sideEffects: ["read", "check"], executionModes: ["check"],
			outputModes: ["plain", "json"], capabilityRoles: ["diagnostic"], interactivity: "none",
			resultContract, actionAffordances, flags: commonFlags, exitCodes: setupExitCodes,
		},
		sync: {
			script: SETUP_CLI_NAME,
			summary: "Preview or apply safe setup-domain plans.",
			usage: ["setup sync [options] [--verbose]"],
			json: true, audience: "operator", mutation: "write",
			sideEffects: ["read", "check", "write"], executionModes: ["check", "normal"],
			outputModes: ["plain", "json"], interactivity: "none",
			resultContract, actionAffordances, flags: { ...checkFlag, ...commonFlags }, exitCodes: setupExitCodes,
		},
		unlink: {
			script: SETUP_CLI_NAME,
			summary: "Preview or remove only proven Setup-owned links.",
			usage: ["setup unlink [options] [--verbose]"],
			json: true, audience: "operator", mutation: "write",
			sideEffects: ["read", "check", "write"], executionModes: ["check", "normal"],
			outputModes: ["plain", "json"], interactivity: "none",
			resultContract, actionAffordances, flags: { ...checkFlag, ...commonFlags }, exitCodes: setupExitCodes,
		},
		catalog: {
			script: SETUP_CLI_NAME,
			summary: "Inspect source visibility and destination occupancy decisions.",
			usage: ["setup catalog [skill] [options]"],
			json: true, audience: "operator", mutation: "check",
			sideEffects: ["read"], executionModes: ["check"], outputModes: ["plain", "json"], interactivity: "none",
			resultContract, actionAffordances, flags: catalogFlags, exitCodes: setupExitCodes,
		},
		commands: {
			script: SETUP_CLI_NAME,
			summary: "Emit machine-readable Setup command discovery metadata.",
			usage: ["setup commands --json"],
			json: true, audience: "agent", mutation: "check",
			sideEffects: ["read"], executionModes: ["check"], outputModes: ["json"], interactivity: "none",
			resultContract: commandsResultContract, flags: { "--json": commonFlags["--json"] }, exitCodes: setupExitCodes,
		},
	} as const satisfies Record<SetupCommand, SetupCommandContract>,
	{ path: "runtime/setup/src/command-contract.ts", writeImplyingMutations: new Set(["write"]) },
);

export const setupContractEntries = SETUP_COMMANDS.map(
	(command) => [command, setupContracts[command]] as const,
);

export function projectSetupCommandDiscoveryTree() {
	return projectCommandDiscoveryTree(setupContractEntries, {
		augment: () => ({ global_diagnostic_flags: SETUP_GLOBAL_DIAGNOSTIC_FLAGS }),
	});
}

export interface ParsedSetupInvocation {
	command: SetupCommand;
	scope: SetupScope;
	repo?: string;
	positionals: string[];
	json: boolean;
	verbose: boolean;
	noColor: boolean;
	check: boolean;
	alias?: "no_args";
}

/** Parse the public grammar from the same command contracts used by help. */
export function parseSetupInvocation(argv: readonly string[]): ParsedSetupInvocation {
	const noArgs = argv.length === 0;
	const command = noArgs ? "status" : argv[0];
	if (!SETUP_COMMANDS.includes(command as SetupCommand)) {
		throw usageError(`Unknown command: ${command ?? "(missing)"}`);
	}
	const typedCommand = command as SetupCommand;
	const allowed = new Set(Object.keys(setupContracts[typedCommand].flags));
	if (["status", "doctor", "sync", "unlink"].includes(typedCommand)) {
		allowed.add("--verbose");
	}
	let scope: SetupScope = "user";
	let repo: string | undefined;
	const positionals: string[] = [];
	let json = false;
	let verbose = false;
	let noColor = false;
	let check = false;

	for (let index = noArgs ? 0 : 1; index < argv.length; index += 1) {
		const arg = argv[index] ?? "";
		const [flag, inlineValue] = splitFlag(arg);
		if (flag.startsWith("-") && !allowed.has(flag)) {
			throw usageError(`Unsupported flag for ${typedCommand}: ${flag}`);
		}
		switch (flag) {
			case "--scope": {
				const value = inlineValue ?? requireValue(argv, index, flag);
				scope = parseEnumFlag(flag, value, SETUP_SCOPES);
				if (inlineValue === undefined) index += 1;
				break;
			}
			case "--repo": {
				repo = inlineValue ?? requireValue(argv, index, flag);
				if (repo.startsWith("-")) throw usageError("--repo requires a path value");
				if (inlineValue === undefined) index += 1;
				break;
			}
			case "--json": json = true; break;
			case "--verbose": verbose = true; break;
			case "--no-color": noColor = true; break;
			case "--check": check = true; break;
			default:
				if (arg.startsWith("-")) throw usageError(`Unsupported flag for ${typedCommand}: ${arg}`);
				positionals.push(arg);
		}
	}

	if (scope === "project" && !repo) throw usageError("--scope project requires --repo");
	if (scope === "user" && repo) throw usageError("--repo requires --scope project");
	if (typedCommand !== "catalog" && positionals.length > 0) {
		throw usageError(`${typedCommand} does not accept positional arguments`);
	}
	if (typedCommand === "catalog" && positionals.length > 1) {
		throw usageError("catalog accepts at most one skill id");
	}
	if (typedCommand === "commands" && !json) throw usageError("commands requires --json");

	return {
		command: typedCommand, scope, ...(repo ? { repo } : {}), positionals,
		json, verbose, noColor, check, ...(noArgs ? { alias: "no_args" as const } : {}),
	};
}

function splitFlag(value: string): [string, string | undefined] {
	if (!value.startsWith("--") || !value.includes("=")) return [value, undefined];
	const index = value.indexOf("=");
	const inline = value.slice(index + 1);
	if (!inline) throw usageError(`${value.slice(0, index)} requires a value`);
	return [value.slice(0, index), inline];
}
