import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";

export const HEAL_SKILL_CONTRACT_ID = "classic-cinema.heal-skill" as const;
export const HEAL_SKILL_SCHEMA_VERSION = "1" as const;

export type HealSkillCommand = "check" | "repair" | "explain";
export type HealSkillCheckId =
	| "scripts-help"
	| "tests"
	| "template-frozen"
	| "booking-log-valid"
	| "productivity-yml"
	| "owner-paths";
type HealSkillAudience = "agent" | "operator";
type HealSkillMutation = "check" | "write";
type HealSkillCommandContract = CommandFacadeContract<
	HealSkillCommand,
	HealSkillAudience,
	HealSkillMutation
>;

export const HEAL_SKILL_CHECK_IDS: readonly HealSkillCheckId[] = [
	"scripts-help",
	"tests",
	"template-frozen",
	"booking-log-valid",
	"productivity-yml",
	"owner-paths",
] as const;

export const HEAL_SKILL_DIAGNOSTIC_CODES = [
	"usage_error",
	"unknown_check",
	"skill_root_missing",
	"repair_incomplete",
] as const;
export type HealSkillDiagnosticCode = (typeof HEAL_SKILL_DIAGNOSTIC_CODES)[number];

export const HEAL_SKILL_FAILURE_ACTIONS = [
	{
		id: "repair_booking_log",
		summary: "Run repair --only booking-log-valid --execute to fix the ledger.",
		sideEffects: ["write"],
	},
	{
		id: "fix_command_source",
		summary: "Human handoff: fix the failing command source, then rerun heal check.",
		sideEffects: ["write"],
	},
	{
		id: "inspect_finding",
		summary: "Use explain <check-id> to see what a finding means and its safe fix.",
		sideEffects: ["check"],
	},
] as const;

export const HEAL_SKILL_SUCCESS_ACTIONS = [
	{
		id: "skill_healthy",
		summary: "All checks pass; no action needed.",
		sideEffects: ["check"],
	},
] as const;

const flags = {
	"--json": { type: "boolean", description: "Emit JSON envelope." },
	"--only": {
		type: "enum",
		values: HEAL_SKILL_CHECK_IDS,
		description: "Restrict to a single check id.",
	},
	"--execute": {
		type: "boolean",
		description: "Apply repairs (default is preview only).",
	},
	"--no-input": {
		type: "boolean",
		description: "Never prompt; report handoff instead of blocking.",
	},
} as const satisfies HealSkillCommandContract["flags"];

const resultContract = {
	id: HEAL_SKILL_CONTRACT_ID,
	kind: "classic-cinema skill health report.",
	schema_version: HEAL_SKILL_SCHEMA_VERSION,
} as const satisfies NonNullable<HealSkillCommandContract["resultContract"]>;

const exitCodes = {
	"0": "Healthy, or repair fully succeeded.",
	"1": "Findings exist, none repaired.",
	"2": "Usage error.",
} as const satisfies HealSkillCommandContract["exitCodes"];

export const healSkillContracts = defineCommandFacadeContract(
	{
		check: {
			script: "heal-skill",
			summary: "Diagnose the classic-cinema skill's health (read-only).",
			usage: ["check [--only <check-id>] [--json]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract,
			actionAffordances: {
				success: HEAL_SKILL_SUCCESS_ACTIONS,
				failure: HEAL_SKILL_FAILURE_ACTIONS,
			},
			flags: {
				"--only": flags["--only"],
				"--json": flags["--json"],
			},
			exitCodes,
		},
		repair: {
			script: "heal-skill",
			summary: "Preview or apply safe repairs (booking-log auto-repair with backup).",
			usage: ["repair [--only <check-id>] [--execute] [--no-input] [--json]"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["check", "write"],
			executionModes: ["normal", "dry_run"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract,
			actionAffordances: {
				success: HEAL_SKILL_SUCCESS_ACTIONS,
				failure: HEAL_SKILL_FAILURE_ACTIONS,
			},
			// --execute mutates without an in-contract dry-run twin command; preview is
			// the default mode of this same command, so the write is gated, not silent.
			previewExemption: {
				reason: "repair previews by default; --execute is the explicit write mode of the same command.",
			},
			flags: {
				"--only": flags["--only"],
				"--execute": flags["--execute"],
				"--no-input": flags["--no-input"],
				"--json": flags["--json"],
			},
			exitCodes,
		},
		explain: {
			script: "heal-skill",
			summary: "Explain what a check means and its safe fix.",
			usage: ["explain <check-id> [--json]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract,
			actionAffordances: {
				success: HEAL_SKILL_SUCCESS_ACTIONS,
				failure: HEAL_SKILL_FAILURE_ACTIONS,
			},
			flags: {
				"--json": flags["--json"],
			},
			exitCodes,
		},
	} as const satisfies Record<HealSkillCommand, HealSkillCommandContract>,
	{
		path: "skills/classic-cinema/src/command-contract.ts",
		writeImplyingMutations: new Set(["write", "destructive"]),
	},
);
