import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import {
	AGENT_SKILLS_CLI_NAME,
	AGENT_SKILLS_COMMANDS,
	AGENT_SKILLS_CONTRACT_ID,
	AGENT_SKILLS_SCHEMA_VERSION,
	type AgentSkillsCommand,
} from "./model.ts";

/**
 * Agent-skills command audience.
 */
export type AgentSkillsAudience = "operator" | "agent";

/**
 * Agent-skills mutation class.
 */
export type AgentSkillsMutation = "check" | "write";

/**
 * Facade contract type for the public agent-skills CLI.
 */
export type AgentSkillsCommandContract = CommandFacadeContract<
	AgentSkillsCommand,
	AgentSkillsAudience,
	AgentSkillsMutation
>;

const resultContract = {
	id: AGENT_SKILLS_CONTRACT_ID,
	kind: "repo local skill projection result.",
	schema_version: AGENT_SKILLS_SCHEMA_VERSION,
} as const satisfies NonNullable<AgentSkillsCommandContract["resultContract"]>;

const commandsResultContract = {
	id: "agent-skills.commands",
	kind: "agent skills command discovery metadata.",
	schema_version: AGENT_SKILLS_SCHEMA_VERSION,
} as const satisfies NonNullable<AgentSkillsCommandContract["resultContract"]>;

const exitCodes = {
	"0": "Command succeeded.",
	"1": "Projection is out of sync or blocked, or runtime state needs repair.",
	"2": "Usage or input error.",
} as const satisfies AgentSkillsCommandContract["exitCodes"];

const jsonFlag = {
	"--json": { type: "boolean", description: "Emit stable JSON output." },
} as const;

const checkFlag = {
	"--check": {
		type: "boolean",
		description: "Preview projection changes without writing.",
	},
} as const;

const listFlags = {
	"--visible": { type: "boolean", description: "Show visible skills only." },
	"--ignored": { type: "boolean", description: "Show ignored skills only." },
	"--new": {
		type: "boolean",
		description: "Show skills newly visible since the last sync.",
	},
	"--why": {
		type: "boolean",
		description: "Explain why matching skills are visible, ignored, or invalid.",
	},
	...jsonFlag,
} as const;

const nextSync = [
	{
		id: "sync",
		summary: "Repair local projections from the current catalog.",
		sideEffects: ["read", "check", "write"],
	},
] as const;

const inspectBlocker = [
	{
		id: "inspect_blocker",
		summary: "Inspect unmanaged projection entries before retrying.",
		sideEffects: ["read"],
	},
] as const;

/**
 * Facade-backed command catalog for the agent-skills CLI.
 *
 * This owns discovery metadata, rendered help, accepted flags, output modes,
 * and side-effect declarations for the public surface.
 */
export const agentSkillsContracts = defineCommandFacadeContract(
	{
		sync: {
			script: AGENT_SKILLS_CLI_NAME,
			summary: "Project visible catalog skills into local agent roots.",
			usage: ["agent-skills sync", "agent-skills sync --check --json"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "check", "write"],
			executionModes: ["check", "normal"],
			outputModes: ["plain", "json"],
			interactivity: "none",
			resultContract,
			actionAffordances: {
				success: nextSync,
				failure: inspectBlocker,
			},
			flags: { ...checkFlag, ...jsonFlag },
			exitCodes,
		},
		status: {
			script: AGENT_SKILLS_CLI_NAME,
			summary: "Show visible skills, projection health, and one next action.",
			usage: ["agent-skills status", "agent-skills status --json"],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["read", "check"],
			executionModes: ["check"],
			outputModes: ["plain", "json"],
			capabilityRoles: ["diagnostic"],
			interactivity: "none",
			resultContract,
			actionAffordances: {
				failure: nextSync,
			},
			flags: jsonFlag,
			exitCodes,
		},
		list: {
			script: AGENT_SKILLS_CLI_NAME,
			summary: "List catalog skills and explain visibility decisions.",
			usage: [
				"agent-skills list",
				"agent-skills list --new",
				"agent-skills list --why <skill>",
			],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["plain", "json"],
			interactivity: "none",
			resultContract,
			flags: listFlags,
			exitCodes,
		},
		ignore: {
			script: AGENT_SKILLS_CLI_NAME,
			summary: "Inspect or edit repo ignore rules for catalog entry ids.",
			usage: [
				"agent-skills ignore list",
				"agent-skills ignore add <pattern>",
				"agent-skills ignore remove <pattern>",
				"agent-skills ignore suggest",
			],
			json: true,
			audience: "operator",
			mutation: "write",
			sideEffects: ["read", "check", "write"],
			executionModes: ["check", "normal"],
			outputModes: ["plain", "json"],
			interactivity: "none",
			resultContract,
			actionAffordances: {
				success: nextSync,
			},
			flags: jsonFlag,
			exitCodes,
		},
		unlink: {
			script: AGENT_SKILLS_CLI_NAME,
			summary: "Remove managed local projection links for this repo.",
			usage: ["agent-skills unlink", "agent-skills unlink --json"],
			json: true,
			audience: "operator",
			mutation: "write",
			sideEffects: ["read", "check", "write"],
			executionModes: ["check", "normal"],
			outputModes: ["plain", "json"],
			interactivity: "none",
			resultContract,
			flags: { ...checkFlag, ...jsonFlag },
			exitCodes,
		},
		commands: {
			script: AGENT_SKILLS_CLI_NAME,
			summary: "Emit machine-readable command discovery metadata.",
			usage: ["agent-skills commands --json"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract: commandsResultContract,
			flags: jsonFlag,
			exitCodes,
		},
	} as const satisfies Record<AgentSkillsCommand, AgentSkillsCommandContract>,
	{
		path: "runtime/agent-skills/src/command-contract.ts",
		writeImplyingMutations: new Set(["write"]),
	},
);

/**
 * Contract entries in stable command order.
 */
export const agentSkillsContractEntries = AGENT_SKILLS_COMMANDS.map(
	(command) => [command, agentSkillsContracts[command]] as const,
);
