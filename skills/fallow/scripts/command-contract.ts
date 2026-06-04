import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";

/**
 * Stable result contract identity for Fallow runner envelopes.
 *
 * Agents use this to distinguish the repo-native wrapper from raw Fallow JSON.
 */
export const FALLOW_RUNNER_CONTRACT_ID = "fallow.runner" as const;

/**
 * Schema version for the package-owned Fallow runner envelope.
 *
 * Increment when agent-visible result semantics change.
 */
export const FALLOW_RUNNER_SCHEMA_VERSION = "1" as const;

/**
 * Default maximum envelope size before raw output is omitted.
 *
 * Set high enough for summary evidence and low enough to protect agent context.
 */
export const DEFAULT_MAX_OUTPUT_BYTES = 64_000;

/**
 * Public v1 subcommands accepted by fallow-runner.
 *
 * The runner maps each command to one Fallow invocation or readiness check.
 */
export const FALLOW_RUNNER_COMMANDS = [
	"audit",
	"dead-code",
	"dupes",
	"health",
	"fix-preview",
	"fix-apply",
	"doctor",
] as const;

/**
 * Public command union for the facade-backed runner.
 */
export type FallowRunnerCommand = (typeof FALLOW_RUNNER_COMMANDS)[number];

/**
 * Agent-facing run status values for normalized Fallow evidence.
 */
export const FALLOW_STATUS_VALUES = ["ok", "issues", "blocked"] as const;

/**
 * Agent-facing run status union.
 */
export type FallowStatus = (typeof FALLOW_STATUS_VALUES)[number];

/**
 * Coarse blocked-run categories used for recovery routing.
 */
export const FALLOW_FAILURE_CATEGORIES = [
	"none",
	"setup",
	"input",
	"fallow",
	"parse",
	"budget",
	"safety",
] as const;

/**
 * Blocked-run category union.
 */
export type FallowFailureCategory =
	(typeof FALLOW_FAILURE_CATEGORIES)[number];

/**
 * Source mutation evidence values.
 */
export const FALLOW_WRITE_EFFECTS = [
	"none",
	"previewed",
	"applied",
] as const;

/**
 * Source mutation evidence union.
 */
export type FallowWriteEffect = (typeof FALLOW_WRITE_EFFECTS)[number];

/**
 * Coarse stderr categories for command observability.
 */
export const FALLOW_STDERR_CATEGORIES = [
	"empty",
	"progress",
	"warning",
	"error",
] as const;

/**
 * Stderr category union.
 */
export type FallowStderrCategory =
	(typeof FALLOW_STDERR_CATEGORIES)[number];

/**
 * Named stderr categories so runtime classification sources the contract.
 */
export const FALLOW_STDERR_CATEGORY_BY_KEY = {
	empty: "empty",
	progress: "progress",
	warning: "warning",
	error: "error",
} as const satisfies Record<string, FallowStderrCategory>;

/**
 * Tiny repair action vocabulary for branchable blocked-run recovery.
 */
export const FALLOW_REPAIR_ACTIONS = [
	"run-doctor",
	"setup-fallow",
	"fix-input",
	"inspect-config",
	"reduce-output",
	"retry",
] as const;

/**
 * Named repair action ids for runner-owned failure normalization.
 */
export const FALLOW_REPAIR_ACTION_BY_KEY = {
	runDoctor: "run-doctor",
	setupFallow: "setup-fallow",
	fixInput: "fix-input",
	inspectConfig: "inspect-config",
	reduceOutput: "reduce-output",
	retry: "retry",
} as const satisfies Record<string, FallowRepairAction>;

/**
 * Repair action union.
 */
export type FallowRepairAction = (typeof FALLOW_REPAIR_ACTIONS)[number];

/**
 * Output budget states reported by the runner.
 */
export const FALLOW_OUTPUT_BUDGET_STATUSES = [
	"within-budget",
	"raw-omitted",
	"summary-impossible",
] as const;

/**
 * Output budget status union.
 */
export type FallowOutputBudgetStatus =
	(typeof FALLOW_OUTPUT_BUDGET_STATUSES)[number];

/**
 * Named output budget statuses so runtime defaults source the contract.
 */
export const FALLOW_OUTPUT_BUDGET_STATUS_BY_KEY = {
	withinBudget: "within-budget",
	rawOmitted: "raw-omitted",
	summaryImpossible: "summary-impossible",
} as const satisfies Record<string, FallowOutputBudgetStatus>;

type FallowRunnerAudience = "agent" | "operator";
type FallowRunnerMutation = "evidence" | "preview" | "apply" | "diagnostic";
type FallowRunnerCommandContract = CommandFacadeContract<
	FallowRunnerCommand,
	FallowRunnerAudience,
	FallowRunnerMutation
>;

const commonFlags = {
	"--root": {
		type: "path",
		description: "Target repository root.",
	},
	"--plain": {
		type: "boolean",
		description: "Emit compact plain summary output.",
	},
	"--include-raw-output": {
		type: "boolean",
		description: "Include parsed raw Fallow output when budget allows.",
	},
	"--max-output-bytes": {
		type: "string",
		description: "Maximum JSON envelope size before raw output is omitted.",
	},
} as const satisfies FallowRunnerCommandContract["flags"];

const auditFlags = {
	...commonFlags,
	"--base-ref": {
		type: "string",
		description: "Optional audit base ref.",
	},
} as const satisfies FallowRunnerCommandContract["flags"];

const applyFlags = {
	...commonFlags,
	"--confirm-current-task-apply": {
		type: "boolean",
		description: "Authorize non-interactive source mutation for this task.",
	},
} as const satisfies FallowRunnerCommandContract["flags"];

const resultContract = {
	id: FALLOW_RUNNER_CONTRACT_ID,
	kind: "Fallow runner evidence envelope.",
	schema_version: FALLOW_RUNNER_SCHEMA_VERSION,
} as const satisfies NonNullable<FallowRunnerCommandContract["resultContract"]>;

const exitCodes = {
	"0": "Fallow runner produced usable evidence.",
	"1": "Fallow runner was blocked before usable evidence.",
	"2": "Invalid runner usage.",
} as const satisfies FallowRunnerCommandContract["exitCodes"];

/**
 * Runtime action affordances for failed runner invocations.
 *
 * The runner chooses one repair hint at runtime; discovery exposes the stable
 * action vocabulary without prescribing command-specific workflows.
 */
export const fallowFailureActions = [
	{
		id: "run-doctor",
		summary: "Run readiness diagnostics before retrying.",
		sideEffects: ["check"],
	},
	{
		id: "setup-fallow",
		summary: "Install or expose Fallow without runner auto-install.",
		sideEffects: ["write"],
	},
	{
		id: "fix-input",
		summary: "Correct runner arguments, root, or base ref.",
		sideEffects: ["check"],
	},
	{
		id: "inspect-config",
		summary: "Inspect Fallow config paths before mutation.",
		sideEffects: ["check"],
	},
	{
		id: "reduce-output",
		summary: "Reduce output size or omit raw output before retrying.",
		sideEffects: ["check"],
	},
	{
		id: "retry",
		summary: "Retry the same input when the failure is transient.",
		sideEffects: ["check"],
	},
] as const;

/**
 * Facade-backed command metadata for every public Fallow runner subcommand.
 */
export const fallowRunnerContracts = defineCommandFacadeContract(
	{
		audit: {
			script: "scripts/fallow-runner.ts",
			summary: "Run Fallow changed-code risk evidence.",
			usage: [
				"audit [--root <repo>] [--base-ref <ref>] [--include-raw-output] [--max-output-bytes <bytes>]",
			],
			json: true,
			audience: "agent",
			mutation: "evidence",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract,
			actionAffordances: { failure: fallowFailureActions },
			flags: auditFlags,
			exitCodes,
		},
		"dead-code": evidenceContract(
			"dead-code",
			"Run Fallow dead-code evidence.",
		),
		dupes: evidenceContract("dupes", "Run Fallow duplication evidence."),
		health: evidenceContract("health", "Run Fallow health evidence."),
		"fix-preview": {
			script: "scripts/fallow-runner.ts",
			summary: "Preview Fallow fix output without mutating source.",
			usage: [
				"fix-preview [--root <repo>] [--include-raw-output] [--max-output-bytes <bytes>]",
			],
			json: true,
			audience: "agent",
			mutation: "preview",
			sideEffects: ["check"],
			executionModes: ["dry_run"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract,
			actionAffordances: { failure: fallowFailureActions },
			flags: commonFlags,
			exitCodes,
		},
		"fix-apply": {
			script: "scripts/fallow-runner.ts",
			summary: "Apply Fallow fixes through an explicit mutation path.",
			usage: [
				"fix-apply [--root <repo>] [--include-raw-output] [--max-output-bytes <bytes>]",
			],
			json: true,
			audience: "operator",
			mutation: "apply",
			sideEffects: ["write"],
			executionModes: ["normal"],
			previewExemption: {
				reason: "Fix preview is a separate public subcommand.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract,
			actionAffordances: { failure: fallowFailureActions },
			flags: applyFlags,
			exitCodes,
		},
		doctor: {
			script: "scripts/fallow-runner.ts",
			summary: "Inspect Fallow runner readiness without mutation.",
			usage: [
				"doctor [--root <repo>] [--include-raw-output] [--max-output-bytes <bytes>]",
			],
			json: true,
			audience: "agent",
			mutation: "diagnostic",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			capabilityRoles: ["diagnostic"],
			interactivity: "none",
			resultContract,
			actionAffordances: { failure: fallowFailureActions },
			flags: commonFlags,
			exitCodes,
		},
	} as const satisfies Record<FallowRunnerCommand, FallowRunnerCommandContract>,
	{
		path: "skills/fallow/scripts/command-contract.ts",
		writeImplyingMutations: new Set(["apply"]),
	},
);

/**
 * Assert that a string is one of the package-owned repair actions.
 *
 * @param action - Candidate action string from parsed runtime output
 * @throws {Error} When the action is not in the Fallow runner action set
 *
 * @example
 * ```typescript
 * assertFallowRepairAction("run-doctor")
 * ```
 */
export function assertFallowRepairAction(
	action: string,
): asserts action is FallowRepairAction {
	if (!FALLOW_REPAIR_ACTIONS.includes(action as FallowRepairAction)) {
		throw new Error(`Unknown Fallow repair action: ${action}`);
	}
}

function evidenceContract(
	command: Exclude<
		FallowRunnerCommand,
		"audit" | "fix-preview" | "fix-apply" | "doctor"
	>,
	summary: string,
): FallowRunnerCommandContract {
	return {
		script: "scripts/fallow-runner.ts",
		summary,
		usage: [
			`${command} [--root <repo>] [--include-raw-output] [--max-output-bytes <bytes>]`,
		],
		json: true,
		audience: "agent",
		mutation: "evidence",
		sideEffects: ["check"],
		executionModes: ["check"],
		outputModes: ["json", "plain"],
		interactivity: "none",
		resultContract,
		actionAffordances: { failure: fallowFailureActions },
		flags: commonFlags,
		exitCodes,
	};
}
