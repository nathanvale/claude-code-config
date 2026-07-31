import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import {
	AGENT_WORKTREE_CLI_NAME,
	AGENT_WORKTREE_COMMANDS,
	AGENT_WORKTREE_CONTRACT_ID,
	AGENT_WORKTREE_SCHEMA_VERSION,
	type AgentWorktreeCommand,
} from "./model.ts";

/**
 * Agent-worktree command audience.
 *
 * Agents are the primary caller, while operator commands are human-facing
 * approval or review paths.
 */
export type AgentWorktreeAudience = "agent" | "operator";

/**
 * Agent-worktree mutation class.
 *
 * The facade validation treats `write` and `destructive` as mutation-intent
 * classes that require preview or an explicit package exemption.
 */
export type AgentWorktreeMutation = "check" | "write" | "destructive";

/**
 * Facade contract type for the public agent-worktree CLI.
 */
export type AgentWorktreeCommandContract = CommandFacadeContract<
	AgentWorktreeCommand,
	AgentWorktreeAudience,
	AgentWorktreeMutation
>;

export const agentWorktreeLifecycleResultContract = {
	id: AGENT_WORKTREE_CONTRACT_ID,
	kind: "agent worktree lifecycle result.",
	schema_version: AGENT_WORKTREE_SCHEMA_VERSION,
} as const satisfies NonNullable<AgentWorktreeCommandContract["resultContract"]>;

const resultContract = agentWorktreeLifecycleResultContract;

const commandsResultContract = {
	id: "agent-worktree.commands",
	kind: "agent worktree command discovery metadata.",
	schema_version: AGENT_WORKTREE_SCHEMA_VERSION,
} as const satisfies NonNullable<AgentWorktreeCommandContract["resultContract"]>;

const exitCodes = {
	"0": "Command succeeded.",
	"1": "Runtime failure.",
	"2": "Usage or input error.",
} as const satisfies AgentWorktreeCommandContract["exitCodes"];

const jsonFlag = {
	"--json": { type: "boolean", description: "Emit a JSON envelope." },
} as const;

const repoFlag = {
	"--repo": {
		type: "path",
		description: "Repo root to inspect. Defaults to the current repository.",
	},
} as const;

const baseFlag = {
	"--base": {
		type: "string",
		description: "Base branch or revision for worktree creation.",
	},
} as const;

const prFlag = {
	"--pr": {
		type: "string",
		description: "Pull request number whose head should be attached.",
	},
} as const;

const dryRunFlag = {
	"--dry-run": {
		type: "boolean",
		description: "Preview write effects without mutating state.",
	},
} as const;

const forceFlag = {
	"--force": {
		type: "boolean",
		description: "Skip confirmation after a preview or explicit approval.",
	},
} as const;

const deleteBranchFlag = {
	"--delete-branch": {
		type: "boolean",
		description: "Also delete the branch after creating a per-run backup ref.",
	},
} as const;

const previewFlag = {
	"--preview": {
		type: "boolean",
		description: "Return cleanup candidates without deleting anything.",
	},
} as const;

const refFlag = {
	"--ref": {
		type: "string",
		description:
			"Typed ref to inspect; accepted for explicit callers when no positional ref is provided.",
	},
} as const;

const limitFlag = {
	"--limit": {
		type: "string",
		description: "Maximum records to return for context-heavy reads.",
	},
} as const;

const fieldsFlag = {
	"--fields": {
		type: "string",
		description: "Comma-separated projection field sets for context-heavy reads.",
	},
} as const;

const selectFlag = {
	"--select": {
		type: "string",
		description: "Selector for a subset of context-heavy read output.",
	},
} as const;

const commonReadFlags = { ...repoFlag, ...jsonFlag } as const;
const projectionFlags = { ...limitFlag, ...fieldsFlag, ...selectFlag } as const;
const commonWriteFlags = {
	...repoFlag,
	...dryRunFlag,
	...jsonFlag,
} as const;

const inspectBeforeMutating = [
	{
		id: "inspect_repo_readiness",
		summary: "Inspect repo readiness before mutating worktrees.",
		sideEffects: ["read", "check"],
	},
] as const;

const inspectFailure = [
	{
		id: "inspect_failure_ref",
		summary: "Inspect the durable failure ref before retry or handoff.",
		sideEffects: ["read"],
	},
] as const;

/**
 * Facade-backed command catalog for the agent-worktree CLI.
 *
 * This is the single source for command discovery, rendered help, parser
 * acceptance, and runtime semantic proof.
 */
export const agentWorktreeContracts = defineCommandFacadeContract(
	{
		doctor: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "Map repo operability, blockers, and next safe actions.",
			usage: ["agent-worktree doctor --json"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read", "check"],
			executionModes: ["check"],
			outputModes: ["json"],
			capabilityRoles: ["diagnostic"],
			interactivity: "none",
			resultContract,
			actionAffordances: {
				success: inspectBeforeMutating,
				failure: inspectFailure,
			},
			flags: { ...commonReadFlags, ...projectionFlags },
			exitCodes,
		},
		list: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "List linked worktrees with repo ownership and health evidence.",
			usage: ["agent-worktree list --json"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract,
			flags: { ...commonReadFlags, ...projectionFlags },
			exitCodes,
		},
		create: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "Create a linked worktree with durable recovery context.",
			usage: ["agent-worktree create <branch> --json"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "check", "write"],
			executionModes: ["dry_run", "normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract,
			actionAffordances: {
				success: inspectBeforeMutating,
				failure: inspectFailure,
			},
			flags: { ...commonWriteFlags, ...baseFlag },
			exitCodes,
		},
		attach: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "Attach a linked worktree to an existing ref or pull request.",
			usage: [
				"agent-worktree attach <ref> --json",
				"agent-worktree attach --pr <n> --json",
			],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "check", "network", "write"],
			executionModes: ["dry_run", "normal"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract,
			actionAffordances: {
				success: inspectBeforeMutating,
				failure: inspectFailure,
			},
			flags: { ...commonWriteFlags, ...prFlag },
			exitCodes,
		},
		status: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "Report worktree status with merge and dirty-state evidence.",
			usage: ["agent-worktree status --json"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read", "check"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract,
			flags: { ...commonReadFlags, ...projectionFlags },
			exitCodes,
		},
		check: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "Check whether a worktree mutation is safe.",
			usage: ["agent-worktree check <branch> --json"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read", "check"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract,
			actionAffordances: {
				success: inspectBeforeMutating,
				failure: inspectFailure,
			},
			flags: commonReadFlags,
			exitCodes,
		},
		delete: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "Delete a linked worktree after merge and dirty-state safety checks.",
			usage: ["agent-worktree delete <branch> --dry-run --json"],
			json: true,
			audience: "agent",
			mutation: "destructive",
			sideEffects: ["read", "check", "write", "destructive"],
			executionModes: ["dry_run", "normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract,
			actionAffordances: {
				success: inspectBeforeMutating,
				failure: inspectFailure,
			},
			flags: { ...commonWriteFlags, ...forceFlag, ...deleteBranchFlag },
			exitCodes,
		},
		clean: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "Preview stale directory and orphan-branch cleanup candidates.",
			usage: [
				"agent-worktree clean --json",
				"agent-worktree clean --preview --json",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read", "check"],
			executionModes: ["check", "dry_run"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract,
			flags: { ...commonReadFlags, ...previewFlag, ...projectionFlags },
			exitCodes,
		},
		recover: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "Preview recovery routing from a durable ref.",
			usage: [
				"agent-worktree recover --ref <ref> --dry-run --json",
				"agent-worktree recover <ref> --dry-run --json",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read", "check"],
			executionModes: ["check", "dry_run"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract,
			actionAffordances: {
				success: inspectBeforeMutating,
				failure: inspectFailure,
			},
			flags: { ...commonReadFlags, ...dryRunFlag, ...refFlag },
			exitCodes,
		},
		refresh: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "Refresh durable worktree state from current repo evidence.",
			usage: ["agent-worktree refresh --dry-run --json"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "check", "write"],
			executionModes: ["dry_run", "normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract,
			actionAffordances: {
				success: inspectBeforeMutating,
				failure: inspectFailure,
			},
			flags: commonWriteFlags,
			exitCodes,
		},
		inspect: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "Inspect a typed worktree, run, or failure ref.",
			usage: [
				"agent-worktree inspect <ref> --json",
				"agent-worktree inspect --ref <ref> --json",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract,
			flags: { ...commonReadFlags, ...refFlag },
			exitCodes,
		},
		handoff: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "Emit read-only repo context for the next agent.",
			usage: ["agent-worktree handoff --json"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract,
			flags: { ...commonReadFlags, ...projectionFlags },
			exitCodes,
		},
		commands: {
			script: AGENT_WORKTREE_CLI_NAME,
			summary: "Emit machine-readable command discovery metadata.",
			usage: ["agent-worktree commands --json"],
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
	} as const satisfies Record<AgentWorktreeCommand, AgentWorktreeCommandContract>,
	{
		path: "runtime/agent-worktree/src/command-contract.ts",
		writeImplyingMutations: new Set(["write", "destructive"]),
	},
);

/**
 * Contract entries in stable command order.
 *
 * The CLI and tests project discovery from this list so command ordering cannot
 * silently drift from the package-owned model.
 */
export const agentWorktreeContractEntries = AGENT_WORKTREE_COMMANDS.map(
	(command) => [command, agentWorktreeContracts[command]] as const,
);
