import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import {
	STORYBOOK_DOCTOR_COMMANDS_CONTRACT_ID,
	STORYBOOK_DOCTOR_CONTRACT_ID,
	STORYBOOK_DOCTOR_DEEP_CONTRACT_ID,
	STORYBOOK_DOCTOR_SCHEMA_VERSION,
} from "./readiness-model.ts";

export type StorybookDoctorCommand = "check" | "deep" | "commands";
type StorybookDoctorAudience = "agent" | "operator";
type StorybookDoctorMutation = "check";
type StorybookDoctorCommandContract = CommandFacadeContract<
	StorybookDoctorCommand,
	StorybookDoctorAudience,
	StorybookDoctorMutation
>;

const CHECK_SUCCESS_ACTIONS = [
	{
		id: "use_mcp",
		summary: "Storybook is ready. Proceed with MCP tool calls.",
		sideEffects: ["read"],
	},
] as const;

const SHARED_FAILURE_ACTIONS = [
	{
		id: "follow_next_action",
		summary:
			"Follow the next_safe_action in the result to resolve the readiness issue.",
		sideEffects: ["read"],
	},
] as const;

const DEEP_SUCCESS_ACTIONS = [
	{
		id: "review_deep_evidence",
		summary:
			"Review deep diagnostic evidence for additional Storybook health details.",
		sideEffects: ["read"],
	},
] as const;

const checkResultContract = {
	id: STORYBOOK_DOCTOR_CONTRACT_ID,
	kind: "Storybook readiness proof with status, findings, and next safe action.",
	schema_version: STORYBOOK_DOCTOR_SCHEMA_VERSION,
} as const satisfies NonNullable<StorybookDoctorCommandContract["resultContract"]>;

const deepResultContract = {
	id: STORYBOOK_DOCTOR_DEEP_CONTRACT_ID,
	kind: "Extended Storybook readiness proof with local doctor evidence.",
	schema_version: STORYBOOK_DOCTOR_SCHEMA_VERSION,
} as const satisfies NonNullable<StorybookDoctorCommandContract["resultContract"]>;

const commandsResultContract = {
	id: STORYBOOK_DOCTOR_COMMANDS_CONTRACT_ID,
	kind: "Storybook doctor command discovery metadata.",
	schema_version: "1",
} as const satisfies NonNullable<StorybookDoctorCommandContract["resultContract"]>;

const exitCodes = {
	"0": "Diagnostics completed (including blocked/degraded results).",
	"1": "Unexpected runtime failure.",
	"2": "Usage error.",
} as const satisfies StorybookDoctorCommandContract["exitCodes"];

const sharedCheckDeepFlags = {
	"--json": { type: "boolean", description: "Emit JSON envelope." },
	"--url": {
		type: "string",
		description:
			"Storybook session URL. Falls back to STORYBOOK_URL then http://localhost:6006.",
	},
	"--repo": {
		type: "path",
		description:
			"Target repo path. Falls back to cwd, then walks upward to nearest package.json.",
	},
} as const;

export const storybookDoctorContracts = defineCommandFacadeContract(
	{
		check: {
			script: "storybook-doctor",
			summary:
				"Emit lightweight Storybook readiness proof for an existing session.",
			usage: [
				"storybook-doctor check --json",
				"storybook-doctor check --json --url http://localhost:6006",
				"storybook-doctor check --json --repo /path/to/project",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read", "check"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract: checkResultContract,
			actionAffordances: {
				success: CHECK_SUCCESS_ACTIONS,
				failure: SHARED_FAILURE_ACTIONS,
			},
			flags: sharedCheckDeepFlags,
			exitCodes,
			envVars: [
				{
					name: "STORYBOOK_URL",
					description:
						"Storybook session URL fallback when --url is not provided.",
				},
			],
		},
		deep: {
			script: "storybook-doctor",
			summary:
				"Extended Storybook diagnostics with local Storybook doctor evidence.",
			usage: [
				"storybook-doctor deep --json",
				"storybook-doctor deep --json --url http://localhost:6006",
				"storybook-doctor deep --json --repo /path/to/project",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read", "check"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract: deepResultContract,
			actionAffordances: {
				success: DEEP_SUCCESS_ACTIONS,
				failure: SHARED_FAILURE_ACTIONS,
			},
			flags: sharedCheckDeepFlags,
			exitCodes,
			envVars: [
				{
					name: "STORYBOOK_URL",
					description:
						"Storybook session URL fallback when --url is not provided.",
				},
			],
		},
		commands: {
			script: "storybook-doctor",
			summary: "Emit machine-readable command discovery metadata.",
			usage: ["storybook-doctor commands --json"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract: commandsResultContract,
			flags: {
				"--json": { type: "boolean", description: "Emit JSON envelope." },
			},
			exitCodes,
		},
	} as const satisfies Record<
		StorybookDoctorCommand,
		StorybookDoctorCommandContract
	>,
	{
		path: "skills/storybook/src/command-contract.ts",
		writeImplyingMutations: new Set(["write", "destructive"]),
	},
);
