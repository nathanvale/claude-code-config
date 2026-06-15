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
	"why",
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
 * Finding resolver action ids.
 *
 * A Finding resolver action is a per-finding continuation that names a runnable
 * evidence-gathering target. It belongs to usable finding evidence and stays
 * distinct from blocked-run {@link FALLOW_REPAIR_ACTIONS}. V1 ships one action:
 * trace export reachability for an introduced `remove-export` finding.
 */
export const FALLOW_RESOLVER_ACTIONS = ["trace-export-reachability"] as const;

/**
 * Finding resolver action union.
 */
export type FallowResolverAction = (typeof FALLOW_RESOLVER_ACTIONS)[number];

/**
 * Named resolver action ids so runtime projection sources the contract.
 */
export const FALLOW_RESOLVER_ACTION_BY_KEY = {
	traceExportReachability: "trace-export-reachability",
} as const satisfies Record<string, FallowResolverAction>;

/**
 * Resolver evidence grades — the primary meaning of resolver output.
 *
 * Verdicts and next actions are derived helpers; the grade is the source of
 * truth. `unreferenced_by_trace` means deletion candidate, never deletion
 * proof. `likely-dead` is deliberately absent.
 */
export const FALLOW_EVIDENCE_GRADES = [
	"referenced",
	"entry_point",
	"unreferenced_by_trace",
	"unresolved",
	"unavailable",
] as const;

/**
 * Resolver evidence grade union.
 */
export type FallowEvidenceGrade = (typeof FALLOW_EVIDENCE_GRADES)[number];

/**
 * Named evidence grades so runtime derivation sources the contract.
 */
export const FALLOW_EVIDENCE_GRADE_BY_KEY = {
	referenced: "referenced",
	entryPoint: "entry_point",
	unreferencedByTrace: "unreferenced_by_trace",
	unresolved: "unresolved",
	unavailable: "unavailable",
} as const satisfies Record<string, FallowEvidenceGrade>;

/**
 * Derived resolver verdicts.
 *
 * A concise conclusion derived from an evidence grade. Absence of trace
 * references never derives `keep`; it derives `candidate_remove` at most.
 */
export const FALLOW_RESOLVER_VERDICTS = [
	"keep",
	"candidate_remove",
	"inconclusive",
] as const;

/**
 * Resolver verdict union.
 */
export type FallowResolverVerdict = (typeof FALLOW_RESOLVER_VERDICTS)[number];

/**
 * Named resolver verdicts so runtime derivation sources the contract.
 */
export const FALLOW_RESOLVER_VERDICT_BY_KEY = {
	keep: "keep",
	candidateRemove: "candidate_remove",
	inconclusive: "inconclusive",
} as const satisfies Record<string, FallowResolverVerdict>;

/**
 * Derived resolver next safe actions.
 *
 * A next-step helper derived from the evidence grade. Deletion is blocked when
 * evidence is unresolved or unavailable.
 */
export const FALLOW_RESOLVER_NEXT_ACTIONS = [
	"keep-export",
	"candidate-remove",
	"stop",
] as const;

/**
 * Resolver next action union.
 */
export type FallowResolverNextAction =
	(typeof FALLOW_RESOLVER_NEXT_ACTIONS)[number];

/**
 * Named resolver next actions so runtime derivation sources the contract.
 */
export const FALLOW_RESOLVER_NEXT_ACTION_BY_KEY = {
	keepExport: "keep-export",
	candidateRemove: "candidate-remove",
	stop: "stop",
} as const satisfies Record<string, FallowResolverNextAction>;

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
		description: "Target repository root, resolved from invocation cwd.",
	},
	"--plain": {
		type: "boolean",
		description: "Emit compact plain summary output.",
	},
	"--json": {
		type: "boolean",
		description: "Emit JSON envelope output; this is the default.",
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
	"--no-cache": {
		type: "boolean",
		description: "Disable Fallow's reusable audit cache for this run.",
	},
} as const satisfies FallowRunnerCommandContract["flags"];

const applyFlags = {
	...commonFlags,
	"--confirm-current-task-apply": {
		type: "boolean",
		description: "Authorize non-interactive source mutation for this task.",
	},
} as const satisfies FallowRunnerCommandContract["flags"];

const whyFlags = {
	...commonFlags,
	"--file": {
		type: "path",
		description: "Root-relative file holding the export to trace.",
	},
	"--export": {
		type: "string",
		description: "Export symbol to trace for reachability evidence.",
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
const fallowFailureActions = [
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
		summary: "Raise the output budget, omit raw output, or narrow the target before retrying.",
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
			script: "fallow-runner",
			summary: "Run Fallow changed-code risk evidence.",
			usage: [
				"audit [--root <repo>] [--base-ref <ref>] [--no-cache] [--plain|--json] [--include-raw-output] [--max-output-bytes <bytes>]",
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
			script: "fallow-runner",
			summary: "Preview Fallow fix output without mutating source.",
			usage: [
				"fix-preview [--root <repo>] [--plain|--json] [--include-raw-output] [--max-output-bytes <bytes>]",
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
			script: "fallow-runner",
			summary: "Apply Fallow fixes through an explicit mutation path.",
			usage: [
				"fix-apply --confirm-current-task-apply [--root <repo>] [--plain|--json] [--include-raw-output] [--max-output-bytes <bytes>]",
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
			script: "fallow-runner",
			summary: "Inspect Fallow runner readiness without mutation.",
			usage: [
				"doctor [--root <repo>] [--plain|--json] [--include-raw-output] [--max-output-bytes <bytes>]",
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
		why: {
			script: "fallow-runner",
			summary:
				"Trace export reachability evidence for one introduced finding.",
			usage: [
				"why --file <path> --export <symbol> [--root <repo>] [--plain|--json] [--include-raw-output] [--max-output-bytes <bytes>]",
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
			flags: whyFlags,
			exitCodes,
		},
	} as const satisfies Record<FallowRunnerCommand, FallowRunnerCommandContract>,
	{
		path: "skills/fallow/src/command-contract.ts",
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

/**
 * Assert that a string is one of the package-owned resolver action ids.
 *
 * @param action - Candidate resolver action string from parsed runtime output
 * @throws {Error} When the action is not in the Fallow resolver action set
 *
 * @example
 * ```typescript
 * assertFallowResolverAction("trace-export-reachability")
 * ```
 */
export function assertFallowResolverAction(
	action: string,
): asserts action is FallowResolverAction {
	if (!FALLOW_RESOLVER_ACTIONS.includes(action as FallowResolverAction)) {
		throw new Error(`Unknown Fallow resolver action: ${action}`);
	}
}

function evidenceContract(
	command: Exclude<
		FallowRunnerCommand,
		"audit" | "fix-preview" | "fix-apply" | "doctor" | "why"
	>,
	summary: string,
): FallowRunnerCommandContract {
	return {
		script: "fallow-runner",
		summary,
		usage: [
			`${command} [--root <repo>] [--plain|--json] [--include-raw-output] [--max-output-bytes <bytes>]`,
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
