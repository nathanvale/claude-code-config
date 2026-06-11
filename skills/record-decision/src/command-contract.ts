import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import {
	RECORD_DECISION_CONTRACT_ID,
	RECORD_DECISION_SCHEMA_VERSION,
} from "./model.ts";

/**
 * Public proof-slice command ids.
 */
export type RecordDecisionCommand = "plan" | "commands";
type RecordDecisionAudience = "agent" | "operator";
type RecordDecisionMutation = "check";
type RecordDecisionCommandContract = CommandFacadeContract<
	RecordDecisionCommand,
	RecordDecisionAudience,
	RecordDecisionMutation
>;

/**
 * Package-owned diagnostic codes returned by the proof-slice runner.
 */
const RECORD_DECISION_DIAGNOSTIC_CODES = [
	"usage_error",
	"acceptance_required",
	"input_unreadable",
	"invalid_input",
	"execute_deferred",
] as const;

/**
 * Diagnostic-code union for package-owned repair handling.
 */
export type RecordDecisionDiagnosticCode =
	(typeof RECORD_DECISION_DIAGNOSTIC_CODES)[number];

/**
 * Discovery action advertised for successful dry-run planning.
 */
const RECORD_DECISION_SUCCESS_ACTIONS = [
	{
		id: "review_plan",
		summary: "Review the mutation plan before enabling execute writes.",
		sideEffects: ["read"],
	},
] as const;

/**
 * Discovery action advertised for input repair failures.
 */
const RECORD_DECISION_FAILURE_ACTIONS = [
	{
		id: "fix_input",
		summary: "Edit the decision input, then rerun the dry-run planning command.",
		sideEffects: ["write"],
	},
] as const;

const resultContract = {
	id: RECORD_DECISION_CONTRACT_ID,
	kind: "Record-decision dry-run mutation plan.",
	schema_version: RECORD_DECISION_SCHEMA_VERSION,
} as const satisfies NonNullable<RecordDecisionCommandContract["resultContract"]>;

const exitCodes = {
	"0": "Dry-run plan succeeded.",
	"1": "Runtime failure.",
	"2": "Usage or input error.",
} as const satisfies RecordDecisionCommandContract["exitCodes"];

/**
 * Facade-backed command catalog for the record-decision proof slice.
 */
export const recordDecisionContracts = defineCommandFacadeContract(
	{
		plan: {
			script: "record-decision",
			summary: "Plan an accepted decision-log append without writing files.",
			usage: [
				"record-decision --input <decision.md> --json",
				"record-decision --input <decision.md> --execute --json",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read", "check"],
			executionModes: ["dry_run"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract,
			actionAffordances: {
				success: RECORD_DECISION_SUCCESS_ACTIONS,
				failure: RECORD_DECISION_FAILURE_ACTIONS,
			},
			flags: {
				"--input": {
					type: "path",
					required: true,
					description: "Hybrid Markdown decision input file.",
				},
				"--json": { type: "boolean", description: "Emit JSON envelope." },
				"--execute": {
					type: "boolean",
					description: "Reserved for the future write path; deferred in this proof slice.",
				},
			},
			exitCodes,
		},
		commands: {
			script: "record-decision",
			summary: "Emit machine-readable command discovery metadata.",
			usage: ["record-decision commands --json"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract: {
				id: "record-decision.commands",
				kind: "Record-decision command discovery metadata.",
				schema_version: "1",
			},
			flags: {
				"--json": { type: "boolean", description: "Emit JSON envelope." },
			},
			exitCodes,
		},
	} as const satisfies Record<RecordDecisionCommand, RecordDecisionCommandContract>,
	{
		path: "skills/record-decision/src/command-contract.ts",
		writeImplyingMutations: new Set(["write", "destructive"]),
	},
);
