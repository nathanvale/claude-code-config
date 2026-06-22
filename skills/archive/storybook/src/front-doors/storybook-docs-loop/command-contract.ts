import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import {
	DOCS_LOOP_COMMANDS_CONTRACT_ID,
	DOCS_LOOP_DOCTOR_CONTRACT_ID,
	DOCS_LOOP_MARK_CONTRACT_ID,
	DOCS_LOOP_PURGE_CONTRACT_ID,
	DOCS_LOOP_RUN_CARD_CONTRACT_ID,
	DOCS_LOOP_SCHEMA_VERSION,
	DOCS_LOOP_STATUS_CONTRACT_ID,
	type StorybookDocsLoopCommand,
} from "./docs-loop-model.ts";

export type { StorybookDocsLoopCommand } from "./docs-loop-model.ts";

/** Agent-facing audiences for docs-loop commands. */
export type StorybookDocsLoopAudience = "agent" | "operator";

/** Package-owned mutation classes for docs-loop command metadata. */
export type StorybookDocsLoopMutation =
	| "scout"
	| "state_read"
	| "state_write"
	| "diagnostic"
	| "cache_destroy";

type DocsLoopCommandContract = CommandFacadeContract<
	StorybookDocsLoopCommand,
	StorybookDocsLoopAudience,
	StorybookDocsLoopMutation
>;

const runCardResultContract = {
	id: DOCS_LOOP_RUN_CARD_CONTRACT_ID,
	kind: "Storybook docs-loop run card with continuation guidance.",
	schema_version: DOCS_LOOP_SCHEMA_VERSION,
} as const satisfies NonNullable<DocsLoopCommandContract["resultContract"]>;

const statusResultContract = {
	id: DOCS_LOOP_STATUS_CONTRACT_ID,
	kind: "Storybook docs-loop run summary.",
	schema_version: DOCS_LOOP_SCHEMA_VERSION,
} as const satisfies NonNullable<DocsLoopCommandContract["resultContract"]>;

const markResultContract = {
	id: DOCS_LOOP_MARK_CONTRACT_ID,
	kind: "Storybook docs-loop verification receipt.",
	schema_version: DOCS_LOOP_SCHEMA_VERSION,
} as const satisfies NonNullable<DocsLoopCommandContract["resultContract"]>;

const doctorResultContract = {
	id: DOCS_LOOP_DOCTOR_CONTRACT_ID,
	kind: "Storybook docs-loop state diagnostic.",
	schema_version: DOCS_LOOP_SCHEMA_VERSION,
} as const satisfies NonNullable<DocsLoopCommandContract["resultContract"]>;

const purgeResultContract = {
	id: DOCS_LOOP_PURGE_CONTRACT_ID,
	kind: "Storybook docs-loop purge result.",
	schema_version: DOCS_LOOP_SCHEMA_VERSION,
} as const satisfies NonNullable<DocsLoopCommandContract["resultContract"]>;

const commandsResultContract = {
	id: DOCS_LOOP_COMMANDS_CONTRACT_ID,
	kind: "Storybook docs-loop command discovery metadata.",
	schema_version: DOCS_LOOP_SCHEMA_VERSION,
} as const satisfies NonNullable<DocsLoopCommandContract["resultContract"]>;

const exitCodes = {
	"0": "Command completed.",
	"1": "Runtime failure.",
	"2": "Usage error.",
} as const satisfies DocsLoopCommandContract["exitCodes"];

const outputFlags = {
	"--json": { type: "boolean", description: "Emit JSON envelope." },
	"--plain": { type: "boolean", description: "Emit compact human output." },
	"--no-input": {
		type: "boolean",
		description: "Disable prompts and return structured repair data instead.",
	},
} as const;

const targetFlags = {
	"--repo": {
		type: "path",
		description: "Target repository path. Falls back to the current directory.",
	},
	"--pkg": {
		type: "path",
		description: "Target package path within the repository.",
	},
} as const;

const runFlag = {
	"--run": {
		type: "string",
		description: "Docs-loop run identifier.",
	},
} as const;

const sharedReadActions = [
	{
		id: "continue_from_card",
		summary: "Read the run card and follow its next safe action.",
		sideEffects: ["read"],
	},
] as const;

const sharedWriteActions = [
	{
		id: "inspect_state_after_write",
		summary: "Inspect the emitted result before changing component files.",
		sideEffects: ["read"],
	},
] as const;

const sharedFailureActions = [
	{
		id: "follow_repair_hint",
		summary: "Use the structured hint to repair input or loop state.",
		sideEffects: ["read"],
	},
] as const;

/** Facade-backed command contracts for the docs-loop front door. */
export const storybookDocsLoopContracts = defineCommandFacadeContract(
	{
		single: {
			script: "storybook-docs-loop",
			summary: "Scout one component docs-loop card without durable state.",
			usage: [
				"storybook-docs-loop single --component ComponentName --json",
				"storybook-docs-loop single --story src/ui/Button/Button.stories.tsx --json",
			],
			json: true,
			audience: "agent",
			mutation: "scout",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract: runCardResultContract,
			actionAffordances: {
				success: sharedReadActions,
				failure: sharedFailureActions,
			},
			flags: {
				...targetFlags,
				"--component": {
					type: "string",
					description: "Component name to scout.",
				},
				"--story": {
					type: "path",
					description: "Story file path to scout.",
				},
				...outputFlags,
			},
			exitCodes,
		},
		batch: {
			script: "storybook-docs-loop",
			summary: "Create or refresh durable docs-loop state for a batch.",
			usage: [
				"storybook-docs-loop batch --run docs-pass --batch-size 3 --json",
				"storybook-docs-loop batch --component Button --json",
			],
			json: true,
			audience: "agent",
			mutation: "state_write",
			sideEffects: ["read", "write"],
			executionModes: ["normal"],
			outputModes: ["json", "plain"],
			previewExemption: {
				reason: "Writes only scoped loop state for the resolved run.",
			},
			interactivity: "none",
			resultContract: runCardResultContract,
			actionAffordances: {
				success: sharedWriteActions,
				failure: sharedFailureActions,
			},
			flags: {
				...targetFlags,
				...runFlag,
				"--component": {
					type: "string",
					description: "Optional component name filter.",
				},
				"--story": {
					type: "path",
					description: "Optional story file filter.",
				},
				"--batch-size": {
					type: "string",
					description: "Number of components in the current batch.",
				},
				"--force": {
					type: "boolean",
					description: "Overwrite an existing run id.",
				},
				...outputFlags,
			},
			exitCodes,
		},
		resume: {
			script: "storybook-docs-loop",
			summary: "Render the current durable run card with receipt state.",
			usage: [
				"storybook-docs-loop resume --run docs-pass --json",
				"storybook-docs-loop resume --json",
			],
			json: true,
			audience: "agent",
			mutation: "state_read",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract: runCardResultContract,
			actionAffordances: {
				success: sharedReadActions,
				failure: sharedFailureActions,
			},
			flags: {
				...targetFlags,
				...runFlag,
				...outputFlags,
			},
			exitCodes,
		},
		status: {
			script: "storybook-docs-loop",
			summary: "Render a durable docs-loop run summary.",
			usage: [
				"storybook-docs-loop status --run docs-pass --json",
				"storybook-docs-loop status --json",
			],
			json: true,
			audience: "agent",
			mutation: "state_read",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract: statusResultContract,
			actionAffordances: {
				success: sharedReadActions,
				failure: sharedFailureActions,
			},
			flags: {
				...targetFlags,
				...runFlag,
				...outputFlags,
			},
			exitCodes,
		},
		advance: {
			script: "storybook-docs-loop",
			summary: "Advance the run cursor after a completed batch item.",
			usage: [
				"storybook-docs-loop advance --run docs-pass --json",
				"storybook-docs-loop advance --run docs-pass --force --reason reviewed --json",
			],
			json: true,
			audience: "agent",
			mutation: "state_write",
			sideEffects: ["read", "write"],
			executionModes: ["normal"],
			outputModes: ["json", "plain"],
			previewExemption: {
				reason: "Writes only scoped loop state for the resolved run.",
			},
			interactivity: "none",
			resultContract: runCardResultContract,
			actionAffordances: {
				success: sharedWriteActions,
				failure: sharedFailureActions,
			},
			flags: {
				...targetFlags,
				...runFlag,
				"--force": {
					type: "boolean",
					description: "Allow advancing degraded or blocked items.",
				},
				"--reason": {
					type: "string",
					description: "Reason for a forced advance.",
				},
				...outputFlags,
			},
			exitCodes,
		},
		mark: {
			script: "storybook-docs-loop",
			summary: "Write one verification receipt into docs-loop state.",
			usage: [
				"storybook-docs-loop mark --run docs-pass --component Button --field preview --status done --json",
				"storybook-docs-loop mark --field matrix --status na --reason single-variant --json",
			],
			json: true,
			audience: "agent",
			mutation: "state_write",
			sideEffects: ["read", "write"],
			executionModes: ["normal"],
			outputModes: ["json", "plain"],
			previewExemption: {
				reason: "Writes only scoped loop state for the resolved run.",
			},
			interactivity: "none",
			resultContract: markResultContract,
			actionAffordances: {
				success: sharedWriteActions,
				failure: sharedFailureActions,
			},
			flags: {
				...targetFlags,
				...runFlag,
				"--component": {
					type: "string",
					description: "Component name for the receipt.",
				},
				"--field": {
					type: "enum",
					values: [
						"default_primary",
						"matrix",
						"ux_tips",
						"focused_stories",
						"optional_docs_inclusion",
						"preview",
						"a11y_story_tests",
						"screenshot",
						"registry",
						"fallow",
						"blocker_or_degraded_reason",
					],
					description: "Verification ledger field.",
				},
				"--status": {
					type: "enum",
					values: ["done", "na", "blocked"],
					description: "Verification receipt status.",
				},
				"--reason": {
					type: "string",
					description: "Reason for na or blocked receipts.",
				},
				...outputFlags,
			},
			exitCodes,
		},
		doctor: {
			script: "storybook-docs-loop",
			summary: "Diagnose docs-loop state and report repair guidance.",
			usage: [
				"storybook-docs-loop doctor --run docs-pass --json",
				"storybook-docs-loop doctor --json",
			],
			json: true,
			audience: "agent",
			mutation: "diagnostic",
			sideEffects: ["read", "check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			capabilityRoles: ["diagnostic"],
			interactivity: "none",
			resultContract: doctorResultContract,
			actionAffordances: {
				success: sharedReadActions,
				failure: sharedFailureActions,
			},
			flags: {
				...targetFlags,
				...runFlag,
				...outputFlags,
			},
			exitCodes,
		},
		purge: {
			script: "storybook-docs-loop",
			summary: "Preview or remove docs-loop state and cache.",
			usage: [
				"storybook-docs-loop purge --run docs-pass --force --json",
				"storybook-docs-loop purge --older-than 30d --force --json",
			],
			json: true,
			audience: "operator",
			mutation: "cache_destroy",
			sideEffects: ["read", "destructive"],
			executionModes: ["normal", "dry_run"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract: purgeResultContract,
			actionAffordances: {
				success: sharedWriteActions,
				failure: sharedFailureActions,
			},
			flags: {
				...targetFlags,
				...runFlag,
				"--older-than": {
					type: "string",
					description: "Age filter for purge sweep.",
				},
				"--force": {
					type: "boolean",
					description: "Delete state or cache instead of previewing.",
				},
				...outputFlags,
			},
			exitCodes,
		},
		commands: {
			script: "storybook-docs-loop",
			summary: "Emit machine-readable command discovery metadata.",
			usage: ["storybook-docs-loop commands --json"],
			json: true,
			audience: "agent",
			mutation: "scout",
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
		StorybookDocsLoopCommand,
		DocsLoopCommandContract
	>,
	{
		path: "skills/storybook/src/front-doors/storybook-docs-loop/command-contract.ts",
		writeImplyingMutations: new Set(["state_write", "cache_destroy"]),
	},
);
