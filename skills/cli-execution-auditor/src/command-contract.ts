import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import { AUDIT_CLAUSE_IDS } from "./clause-catalog.ts";

export const AUDITOR_CONTRACT_ID = "cli-execution-auditor.audit" as const;
export const AUDITOR_STATION_MAP_CONTRACT_ID =
	"cli-execution-auditor.station-map" as const;
// v2 exposes multi-contract target layouts and shape discovery as
// discriminated unions; source API callers must handle ambiguity explicitly.
export const AUDITOR_SCHEMA_VERSION = "2" as const;

export type AuditorCommand = "audit" | "station-map";
type AuditorAudience = "agent" | "operator";
type AuditorMutation = "check" | "write";
type AuditorCommandContract = CommandFacadeContract<
	AuditorCommand,
	AuditorAudience,
	AuditorMutation
>;

export const AUDITOR_DIAGNOSTIC_CODES = [
	"usage_error",
	"target_not_facade",
	"target_unreadable",
	"findings_present",
] as const;
export type AuditorDiagnosticCode = (typeof AUDITOR_DIAGNOSTIC_CODES)[number];

export const AUDITOR_FAILURE_ACTIONS = [
	{
		id: "inspect_findings",
		summary: "Read the ledger written at --ledger to see each clause finding and its re-check.",
		sideEffects: ["read"],
	},
	{
		id: "fix_target_cli",
		summary: "Human handoff: fix the flagged clause in the target CLI source, then rerun audit.",
		sideEffects: ["write"],
	},
] as const;

export const AUDITOR_SUCCESS_ACTIONS = [
	{
		id: "target_clean",
		summary: "All lane clauses pass; no action needed.",
		sideEffects: ["check"],
	},
] as const;

const resultContract = {
	id: AUDITOR_CONTRACT_ID,
	kind: "facade-lane CLI execution audit report.",
	schema_version: AUDITOR_SCHEMA_VERSION,
} as const satisfies NonNullable<AuditorCommandContract["resultContract"]>;

const stationMapResultContract = {
	id: AUDITOR_STATION_MAP_CONTRACT_ID,
	kind: "Branch Station Map reconciliation report.",
	schema_version: AUDITOR_SCHEMA_VERSION,
} as const satisfies NonNullable<AuditorCommandContract["resultContract"]>;

const exitCodes = {
	"0": "Target clean; all lane clauses pass.",
	"1": "Findings exist against the lane contract.",
	"2": "Usage error.",
} as const satisfies AuditorCommandContract["exitCodes"];

const flags = {
	"--json": { type: "boolean", description: "Emit JSON envelope." },
	"--only": {
		type: "enum",
		values: AUDIT_CLAUSE_IDS,
		description: "Restrict the audit to a single lane clause.",
	},
	"--ledger": {
		type: "path",
		description: "Write the findings ledger to this path (default docs/cli-audits/<cli>/audit.md).",
	},
} as const satisfies AuditorCommandContract["flags"];

export const auditorContracts = defineCommandFacadeContract(
	{
		audit: {
			script: "auditor",
			summary: "Audit a facade-backed CLI's execution experience against the lane contract.",
			usage: ["audit <target> [--only <clause>] [--ledger <path>] [--json]"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "check", "write"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract,
			actionAffordances: {
				success: AUDITOR_SUCCESS_ACTIONS,
				failure: AUDITOR_FAILURE_ACTIONS,
			},
			// audit writes a ledger artifact (its own findings table), never the
			// target CLI source. The write is the documented purpose of the command,
			// gated behind --ledger's explicit destination, not a silent mutation.
			previewExemption: {
				reason: "audit writes only its own findings ledger; the target CLI source is never mutated.",
			},
			flags: {
				"--only": flags["--only"],
				"--ledger": flags["--ledger"],
				"--json": flags["--json"],
			},
			exitCodes,
		},
		"station-map": {
			script: "auditor",
			summary: "Project a facade-backed CLI's Branch Station Map.",
			usage: ["station-map <target> [--ledger <path>] [--json]"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "check", "write"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract: stationMapResultContract,
			actionAffordances: {
				success: AUDITOR_SUCCESS_ACTIONS,
				failure: AUDITOR_FAILURE_ACTIONS,
			},
			previewExemption: {
				reason: "station-map writes only its own findings ledger; the target CLI source is never mutated.",
			},
			flags: {
				"--ledger": flags["--ledger"],
				"--json": flags["--json"],
			},
			exitCodes,
		},
	} as const satisfies Record<AuditorCommand, AuditorCommandContract>,
	{
		path: "skills/cli-execution-auditor/src/command-contract.ts",
		writeImplyingMutations: new Set(["write", "destructive"]),
	},
);
