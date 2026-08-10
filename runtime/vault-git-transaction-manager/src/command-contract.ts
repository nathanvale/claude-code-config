import {
	CliRuntimeContractError,
	type CommandFacadeActionAffordance,
	type CommandFacadeContract,
	defineCommandFacadeContract,
	projectCommandDiscoveryTree,
	requireValue,
	usageError,
} from "@side-quest/cli-command-facade";
import {
	VAULT_GIT_COMMANDS_CONTRACT_ID,
	VAULT_GIT_EVENT_TYPES,
	VAULT_GIT_NEXT_ACTION_IDS,
	VAULT_GIT_REPAIR_ACTIONS,
	VAULT_GIT_RESULT_CONTRACT_ID,
	VAULT_GIT_SCHEMA_VERSION,
	type VaultGitEventType,
	type VaultGitNextActionId,
	type VaultGitRepairAction,
} from "./model.ts";

/** Public vault-git command ids in stable discovery order. */
export const VAULT_GIT_COMMANDS = [
	"begin",
	"join",
	"complete",
	"status",
	"preview",
	"doctor",
	"repair",
	"tidy",
	"janitor",
	"commands",
] as const;

/** Public vault-git command id. */
export type VaultGitCommand = (typeof VAULT_GIT_COMMANDS)[number];

/** Caller audience. Caller labels never alter policy. */
export type VaultGitAudience = "agent" | "operator";

/** Package side-effect posture. */
export type VaultGitMutation =
	| "read"
	| "preview"
	| "local_write"
	| "remote_write"
	| "recovery";

/** Facade contract type for vault-git. */
export type VaultGitCommandContract = CommandFacadeContract<
	VaultGitCommand,
	VaultGitAudience,
	VaultGitMutation
>;

/** Mutation postures that imply write authority; single source for CLI write gating. */
export const VAULT_GIT_WRITE_IMPLYING_MUTATIONS: ReadonlySet<VaultGitMutation> =
	new Set(["local_write", "remote_write", "recovery"]);

/** Facade-owned diagnostic flags accepted before package parsing. */
export const VAULT_GIT_GLOBAL_DIAGNOSTIC_FLAGS = [
	"--run-id",
	"--quiet",
	"--verbose",
	"--debug",
] as const;

/** Stable process exit semantics. */
export const vaultGitExitCodes = {
	"0": "Read or discovery command completed successfully.",
	"1": "Command refused, blocked, or failed without hidden recovery.",
	"2": "Invalid command usage or input.",
} as const satisfies VaultGitCommandContract["exitCodes"];

const lifecycleResultContract = {
	id: VAULT_GIT_RESULT_CONTRACT_ID,
	kind: "Vault transaction lifecycle result.",
	schema_version: VAULT_GIT_SCHEMA_VERSION,
} as const;

const discoveryResultContract = {
	id: VAULT_GIT_COMMANDS_CONTRACT_ID,
	kind: "Vault transaction command discovery metadata.",
	schema_version: VAULT_GIT_SCHEMA_VERSION,
} as const;

/** Runtime action affordances shared by discovery and envelopes. */
export const vaultGitActions = VAULT_GIT_NEXT_ACTION_IDS.map((id) => ({
	id,
	summary: actionSummary(id),
	sideEffects: actionSideEffects(id),
})) as readonly (CommandFacadeActionAffordance & { id: VaultGitNextActionId })[];

function actionSummary(id: VaultGitNextActionId): string {
	if (id === "wait_for_runtime") return "Wait for the remaining runtime owner before writing.";
	if (id === "inspect_commands") return "Use discovery metadata to choose one safe command.";
	if (id === "change_input") return "Correct the command arguments and retry parsing.";
	return `Continue with the ${id.replaceAll("_", " ")} action.`;
}

function actionSideEffects(
	id: VaultGitNextActionId,
): readonly ("read" | "check" | "network" | "write")[] {
	return new Set<VaultGitNextActionId>([
		"complete_transaction",
		"resume_writing",
		"run_repair",
		"retry_push",
		"retry_remote",
		"begin_transaction",
		"run_janitor",
	]).has(id)
		? ["read", "check", "network", "write"]
		: ["read", "check"];
}

const actionAffordances = { continuations: vaultGitActions } as const;
const diagnosticsUsage = "[--run-id <id>] [--quiet] [--verbose] [--debug]";
const jsonFlag = {
	"--json": { type: "boolean", description: "Emit one stable JSON envelope." },
} as const;
const noInputFlag = {
	"--no-input": { type: "boolean", description: "Disable interactive input." },
} as const;
const priorWriterStoppedFlag = {
	"--prior-writer-stopped": {
		type: "boolean",
		description: "Attest that the prior writer has stopped before stale takeover.",
	},
} as const;
const transactionIdFlag = {
	"--transaction-id": {
		type: "string",
		description: "Select the public transaction correlation id.",
	},
} as const;
const capabilityFdFlag = {
	"--capability-fd": {
		type: "string",
		description: "Read capability material from this numeric inherited file descriptor.",
	},
} as const;
const previewExemption = {
	reason:
		"The separate read-only preview surface owns planning; the explicit non-interactive verb selects execution.",
} as const;

const expectedFlags = {
	begin: ["--json", "--no-input", "--event", "--path"],
	join: ["--json", "--no-input", "--transaction-id", "--capability-fd", "--path"],
	complete: [
		"--json",
		"--no-input",
		"--transaction-id",
		"--capability-fd",
		"--summary",
	],
	status: ["--json"],
	preview: ["--json", "--transaction-id"],
	doctor: ["--json", "--transaction-id"],
	repair: [
		"--json",
		"--no-input",
		"--transaction-id",
		"--capability-fd",
		"--prior-writer-stopped",
	],
	tidy: ["--json", "--no-input"],
	janitor: ["--json", "--no-input"],
	commands: ["--json"],
} as const satisfies Record<VaultGitCommand, readonly string[]>;

const expectedResultContractIds = {
	begin: VAULT_GIT_RESULT_CONTRACT_ID,
	join: VAULT_GIT_RESULT_CONTRACT_ID,
	complete: VAULT_GIT_RESULT_CONTRACT_ID,
	status: VAULT_GIT_RESULT_CONTRACT_ID,
	preview: VAULT_GIT_RESULT_CONTRACT_ID,
	doctor: VAULT_GIT_RESULT_CONTRACT_ID,
	repair: VAULT_GIT_RESULT_CONTRACT_ID,
	tidy: VAULT_GIT_RESULT_CONTRACT_ID,
	janitor: VAULT_GIT_RESULT_CONTRACT_ID,
	commands: VAULT_GIT_COMMANDS_CONTRACT_ID,
} as const satisfies Record<VaultGitCommand, string>;

/**
 * Validate facade structure plus package-owned command, flag, result, and effect invariants.
 *
 * @param contracts - Candidate complete vault-git command record
 * @returns The same validated record
 * @throws CliRuntimeContractError when any command surface drifts
 */
export function defineVaultGitCommandContracts<
	TContracts extends Record<VaultGitCommand, VaultGitCommandContract>,
>(
	contracts: TContracts,
): TContracts {
	const validated = defineCommandFacadeContract(contracts, {
		path: "runtime/vault-git-transaction-manager/src/command-contract.ts",
		writeImplyingMutations: VAULT_GIT_WRITE_IMPLYING_MUTATIONS,
	});
	const issues: string[] = [];
	if (JSON.stringify(Object.keys(validated)) !== JSON.stringify(VAULT_GIT_COMMANDS)) {
		issues.push("vault-git-command-set-drift: Preserve the stable public command order.");
	}
	for (const command of VAULT_GIT_COMMANDS) {
		const contract = validated[command];
		if (!contract) continue;
		const actualFlags = Object.keys(contract.flags);
		if (JSON.stringify(actualFlags) !== JSON.stringify(expectedFlags[command])) {
			issues.push(`vault-git-flag-drift: Restore declared flags for ${command}.`);
		}
		if (contract.resultContract?.id !== expectedResultContractIds[command]) {
			issues.push(
				`vault-git-result-contract-drift: Restore the package result contract for ${command}.`,
			);
		}
		if (contract.resultContract?.schema_version !== VAULT_GIT_SCHEMA_VERSION) {
			issues.push(
				`vault-git-result-schema-version-drift: Restore result schema_version ${VAULT_GIT_SCHEMA_VERSION} for ${command}.`,
			);
		}
		if (!Array.isArray(contract.sideEffects) || contract.sideEffects.length === 0) {
			issues.push(
				`vault-git-side-effect-metadata-missing: Declare the effect posture for ${command}.`,
			);
		}
	}
	if (issues.length > 0) throw new CliRuntimeContractError(issues);
	return validated as TContracts;
}

/** Complete validated vault-git facade contract. */
export const vaultGitContracts = defineVaultGitCommandContracts({
	begin: {
		script: "vault-git",
		summary: "Acquire one fenced transaction and issue separate private owner and join capabilities.",
		usage: [`vault-git begin --event <event> --path <path> [--path <path>] [--no-input] [--json] ${diagnosticsUsage}`],
		json: true,
		audience: "agent",
		mutation: "remote_write",
		sideEffects: ["read", "check", "network", "write"],
		executionModes: ["normal"],
		previewExemption,
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: lifecycleResultContract,
		actionAffordances,
		flags: {
			...jsonFlag,
			...noInputFlag,
			"--event": {
				type: "enum",
				values: VAULT_GIT_EVENT_TYPES,
				description: "Select one meaningful vault event class.",
			},
			"--path": {
				type: "path",
				description: "Add one repository-relative owned leaf path; repeat as needed.",
			},
		},
		exitCodes: vaultGitExitCodes,
	},
	join: {
		script: "vault-git",
		summary: "Join an outer transaction and add owned paths without owner authority.",
		usage: [`vault-git join --transaction-id <id> --path <path> [--path <path>] [--capability-fd <fd>] [--no-input] [--json] ${diagnosticsUsage}`],
		json: true,
		audience: "agent",
		mutation: "local_write",
		sideEffects: ["read", "check", "write"],
		executionModes: ["normal"],
		previewExemption,
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: lifecycleResultContract,
		actionAffordances,
		flags: { ...jsonFlag, ...noInputFlag, ...transactionIdFlag, ...capabilityFdFlag, "--path": { type: "path", description: "Add one repository-relative owned leaf path; repeat as needed." } },
		exitCodes: vaultGitExitCodes,
	},
	complete: {
		script: "vault-git",
		summary: "Complete one owner-authorized transaction through verified atomic publication.",
		usage: [`vault-git complete --transaction-id <id> --summary <subject> [--capability-fd <fd>] [--no-input] [--json] ${diagnosticsUsage}`],
		json: true,
		audience: "agent",
		mutation: "remote_write",
		sideEffects: ["read", "check", "network", "write"],
		executionModes: ["normal"],
		previewExemption,
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: lifecycleResultContract,
		actionAffordances,
		flags: { ...jsonFlag, ...noInputFlag, ...transactionIdFlag, ...capabilityFdFlag, "--summary": { type: "string", description: "Supply the semantic Conventional Commit subject." } },
		exitCodes: vaultGitExitCodes,
	},
	status: {
		script: "vault-git",
		summary: "Show bounded read-only transaction state with exactly one next safe action.",
		usage: [`vault-git status [--json] ${diagnosticsUsage}`],
		json: true,
		audience: "operator",
		mutation: "read",
		sideEffects: ["read"],
		executionModes: ["check"],
		outputModes: ["plain", "json"],
		capabilityRoles: ["diagnostic"],
		interactivity: "none",
		resultContract: lifecycleResultContract,
		actionAffordances,
		flags: jsonFlag,
		exitCodes: vaultGitExitCodes,
	},
	preview: {
		script: "vault-git",
		summary: "Preview transaction work without granting authority or changing state.",
		usage: [`vault-git preview [--transaction-id <id>] [--json] ${diagnosticsUsage}`],
		json: true,
		audience: "agent",
		mutation: "preview",
		sideEffects: ["read", "check"],
		executionModes: ["check"],
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: lifecycleResultContract,
		actionAffordances,
		flags: { ...jsonFlag, ...transactionIdFlag },
		exitCodes: vaultGitExitCodes,
	},
	doctor: {
		script: "vault-git",
		summary: "Classify lifecycle state and deterministic recovery without mutation.",
		usage: [`vault-git doctor [--transaction-id <id>] [--json] ${diagnosticsUsage}`],
		json: true,
		audience: "operator",
		mutation: "preview",
		sideEffects: ["read", "check", "network"],
		executionModes: ["check"],
		outputModes: ["plain", "json"],
		capabilityRoles: ["diagnostic"],
		interactivity: "none",
		resultContract: lifecycleResultContract,
		actionAffordances,
		flags: { ...jsonFlag, ...transactionIdFlag },
		exitCodes: vaultGitExitCodes,
	},
	repair: {
		script: "vault-git",
		summary: "Run only a doctor-classified deterministic repair with owner authority.",
		usage: [`vault-git repair <${VAULT_GIT_REPAIR_ACTIONS.join("|")}> --transaction-id <id> [--capability-fd <fd>] [--prior-writer-stopped] [--no-input] [--json] ${diagnosticsUsage}`],
		json: true,
		audience: "operator",
		mutation: "recovery",
		sideEffects: ["read", "check", "network", "write"],
		executionModes: ["normal"],
		previewExemption,
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: lifecycleResultContract,
		actionAffordances,
		flags: {
			...jsonFlag,
			...noInputFlag,
			...transactionIdFlag,
			...capabilityFdFlag,
			...priorWriterStoppedFlag,
		},
		exitCodes: vaultGitExitCodes,
	},
	tidy: {
		script: "vault-git",
		summary: "Run one explicit bounded hygiene worker in a fresh transaction.",
		usage: [`vault-git tidy now [--no-input] [--json] ${diagnosticsUsage}`],
		json: true,
		audience: "agent",
		mutation: "remote_write",
		sideEffects: ["read", "check", "network", "write"],
		executionModes: ["normal"],
		previewExemption,
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: lifecycleResultContract,
		actionAffordances,
		flags: { ...jsonFlag, ...noInputFlag },
		exitCodes: vaultGitExitCodes,
	},
	janitor: {
		script: "vault-git",
		summary: "Inspect and apply only admitted deterministic Janitor repairs.",
		usage: [`vault-git janitor [--no-input] [--json] ${diagnosticsUsage}`],
		json: true,
		audience: "agent",
		mutation: "remote_write",
		sideEffects: ["read", "check", "network", "write"],
		executionModes: ["normal"],
		previewExemption,
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: lifecycleResultContract,
		actionAffordances,
		flags: { ...jsonFlag, ...noInputFlag },
		exitCodes: vaultGitExitCodes,
	},
	commands: {
		script: "vault-git",
		summary: "Emit machine-readable vault-git command discovery metadata.",
		usage: [`vault-git commands --json ${diagnosticsUsage}`],
		json: true,
		audience: "agent",
		mutation: "read",
		sideEffects: ["read"],
		executionModes: ["check"],
		outputModes: ["json"],
		capabilityRoles: ["diagnostic"],
		interactivity: "none",
		resultContract: discoveryResultContract,
		actionAffordances,
		flags: jsonFlag,
		exitCodes: vaultGitExitCodes,
	},
} as const satisfies Record<VaultGitCommand, VaultGitCommandContract>);

/** Contract entries in stable discovery order. */
export const vaultGitContractEntries = VAULT_GIT_COMMANDS.map(
	(command) => [command, vaultGitContracts[command]] as const,
);

/** Commands whose validated contract declares a write-implying mutation posture. */
export const vaultGitMutatingCommands: ReadonlySet<VaultGitCommand> = new Set(
	VAULT_GIT_COMMANDS.filter((command) =>
		VAULT_GIT_WRITE_IMPLYING_MUTATIONS.has(vaultGitContracts[command].mutation),
	),
);

/** Project machine-readable command discovery directly from live contracts. */
export function projectVaultGitCommandDiscoveryTree() {
	return projectCommandDiscoveryTree(vaultGitContractEntries, {
		augment: () => ({ global_diagnostic_flags: VAULT_GIT_GLOBAL_DIAGNOSTIC_FLAGS }),
	});
}

/** Parsed public invocation with capability material represented only by descriptor number. */
export interface ParsedVaultGitInvocation {
	/** Canonical command id. */
	readonly command: VaultGitCommand;
	/** Whether JSON output was selected. */
	readonly json: boolean;
	/** Whether prompts are disabled. */
	readonly noInput: boolean;
	/** Optional non-secret transaction id. */
	readonly transactionId?: string;
	/** Optional inherited capability descriptor. */
	readonly capabilityFd?: number;
	/** Optional meaningful event type. */
	readonly event?: VaultGitEventType;
	/** Repeated owned paths. */
	readonly paths: readonly string[];
	/** Optional semantic completion summary. */
	readonly summary?: string;
	/** Optional repair action. */
	readonly repairAction?: VaultGitRepairAction;
	/** Explicit stale-takeover operator attestation. */
	readonly priorWriterStopped: boolean;
	/** Bare invocation alias marker. */
	readonly alias?: "no_args";
}

/**
 * Parse package argv against the same flags the facade contract advertises.
 *
 * @param argv - Diagnostic-stripped process arguments
 * @returns Validated package invocation
 * @throws CliUsageError for unknown commands, flags, and values
 */
export function parseVaultGitInvocation(
	argv: readonly string[],
): ParsedVaultGitInvocation {
	const noArgs = argv.length === 0;
	const flagOnlyAlias = argv[0]?.startsWith("-") === true;
	const candidate = noArgs || flagOnlyAlias ? "status" : argv[0];
	if (!VAULT_GIT_COMMANDS.includes(candidate as VaultGitCommand)) {
		throw usageError(`Unknown command: ${candidate ?? "(missing)"}`);
	}
	const command = candidate as VaultGitCommand;
	let index = noArgs || flagOnlyAlias ? 0 : 1;
	if (command === "tidy") {
		if (argv[index] !== "now") throw usageError("tidy requires the exact subcommand: now");
		index += 1;
	}

	const allowed = new Set(Object.keys(vaultGitContracts[command].flags));
	let json = false;
	let noInput = false;
	let transactionId: string | undefined;
	let capabilityFd: number | undefined;
	let event: VaultGitEventType | undefined;
	let summary: string | undefined;
	let repairAction: VaultGitRepairAction | undefined;
	let priorWriterStopped = false;
	const paths: string[] = [];

	for (; index < argv.length; index += 1) {
		const arg = argv[index] ?? "";
		const [flag, inlineValue] = splitFlag(arg);
		if (!flag.startsWith("-")) {
			if (command === "repair" && repairAction === undefined) {
				repairAction = parseSafeEnumValue("repair action", flag, VAULT_GIT_REPAIR_ACTIONS);
				continue;
			}
			throw usageError(`${command} does not accept positional argument: ${flag}`);
		}
		if (!allowed.has(flag)) throw usageError(`Unsupported flag for ${command}: ${flag}`);
		switch (flag) {
			case "--json":
				rejectBooleanValue(flag, inlineValue);
				json = true;
				break;
			case "--no-input":
				rejectBooleanValue(flag, inlineValue);
				noInput = true;
				break;
			case "--prior-writer-stopped":
				rejectBooleanValue(flag, inlineValue);
				priorWriterStopped = true;
				break;
			case "--transaction-id": {
				const parsed = inlineValue ?? requireValue(argv, index, flag);
				if (inlineValue === undefined) index += 1;
				transactionId = parsed;
				break;
			}
			case "--capability-fd": {
				const parsed = inlineValue ?? requireValue(argv, index, flag);
				if (inlineValue === undefined) index += 1;
				if (
					!/^\d+$/.test(parsed) ||
					Number(parsed) < 3 ||
					Number(parsed) > 64 ||
					!Number.isSafeInteger(Number(parsed))
				) {
					throw usageError(
						"--capability-fd requires a numeric inherited file descriptor from 3 through 64",
					);
				}
				capabilityFd = Number(parsed);
				break;
			}
			case "--event": {
				const parsed = inlineValue ?? requireValue(argv, index, flag);
				if (inlineValue === undefined) index += 1;
				event = parseSafeEnumValue(flag, parsed, VAULT_GIT_EVENT_TYPES);
				break;
			}
			case "--path": {
				const parsed = inlineValue ?? requireValue(argv, index, flag);
				if (inlineValue === undefined) index += 1;
				paths.push(parsed);
				break;
			}
			case "--summary": {
				const parsed = inlineValue ?? requireValue(argv, index, flag);
				if (inlineValue === undefined) index += 1;
				summary = parsed;
				break;
			}
			default:
				throw usageError(`Unhandled declared flag for ${command}: ${flag}`);
		}
	}
	if (command === "commands" && !json) throw usageError("commands requires --json");
	if (command === "repair" && repairAction === undefined) {
		throw usageError(
			`repair requires one action: ${VAULT_GIT_REPAIR_ACTIONS.join(", ")}`,
		);
	}
	if (priorWriterStopped && repairAction !== "stale-lease-takeover") {
		throw usageError(
			"--prior-writer-stopped is accepted only for repair stale-lease-takeover",
		);
	}
	return {
		command,
		json,
		noInput,
		priorWriterStopped,
		paths,
		...(transactionId === undefined ? {} : { transactionId }),
		...(capabilityFd === undefined ? {} : { capabilityFd }),
		...(event === undefined ? {} : { event }),
		...(summary === undefined ? {} : { summary }),
		...(repairAction === undefined ? {} : { repairAction }),
		...(noArgs || flagOnlyAlias ? { alias: "no_args" as const } : {}),
	};
}

/** Reject an out-of-vocabulary value while naming only the label and accepted values. */
function parseSafeEnumValue<T extends string>(
	label: string,
	value: string,
	values: readonly T[],
): T {
	if (!values.includes(value as T)) {
		throw usageError(`${label} must be one of: ${values.join(", ")}`);
	}
	return value as T;
}

function splitFlag(value: string): [string, string | undefined] {
	if (!value.startsWith("--") || !value.includes("=")) return [value, undefined];
	const separator = value.indexOf("=");
	const inline = value.slice(separator + 1);
	if (inline.length === 0) throw usageError(`${value.slice(0, separator)} requires a value`);
	return [value.slice(0, separator), inline];
}

function rejectBooleanValue(flag: string, value: string | undefined): void {
	if (value !== undefined) throw usageError(`${flag} does not accept a value`);
}
