import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import { WT_CONTRACT_ID, WT_SCHEMA_VERSION } from "./model.ts";

/**
 * Public command ids for the wt front door.
 *
 * Owned render verbs (`sync`/`focus`/`color`/`open`) plus delegated worktree
 * verbs (`new`/`rm`/`clean`) that pass through to `@side-quest/git worktree`.
 * `commands` emits machine-readable discovery metadata.
 */
export type WtCommand =
	| "sync"
	| "focus"
	| "color"
	| "open"
	| "new"
	| "rm"
	| "clean"
	| "commands";

type WtAudience = "agent" | "operator";
type WtMutation = "check" | "write" | "destructive";
type WtCommandContract = CommandFacadeContract<WtCommand, WtAudience, WtMutation>;

/**
 * Package-owned diagnostic codes returned by the wt runner.
 *
 * Each names a distinct, agent-repairable failure mode. `drift_blocked` is the
 * product's core safety stop: a manual edit was detected and the sync refused
 * to overwrite it.
 */
const WT_DIAGNOSTIC_CODES = [
	"usage_error",
	"drift_blocked",
	"registry_unreadable",
	"worktree_list_failed",
	"delegate_failed",
	"unknown_color",
	"code_not_found",
	"write_failed",
] as const;

/**
 * Diagnostic-code union for package-owned repair handling.
 */
export type WtDiagnosticCode = (typeof WT_DIAGNOSTIC_CODES)[number];

/**
 * Discovery action advertised after a successful render.
 */
const WT_SYNC_SUCCESS_ACTIONS = [
	{
		id: "open_workspace",
		summary: "Open the rendered workspace to review the focus pairs and colors.",
		sideEffects: ["read"],
	},
] as const;

/**
 * Discovery action advertised when sync is blocked by drift.
 *
 * Prose-only summary plus a structured action; the real command lives in the
 * docs the facade text-safety layer permits us to reference.
 */
const WT_DRIFT_FAILURE_ACTIONS = [
	{
		id: "review_drift",
		summary:
			"Review the diff, port real edits into the registry, then rerun the render with force.",
		sideEffects: ["read"],
	},
] as const;

/**
 * Discovery action advertised when a delegated worktree verb fails.
 */
const WT_DELEGATE_FAILURE_ACTIONS = [
	{
		id: "inspect_worktrees",
		summary: "Inspect worktree state, resolve the upstream failure, then retry.",
		sideEffects: ["read"],
	},
] as const;

const renderResultContract = {
	id: WT_CONTRACT_ID,
	kind: "wt workspace render or worktree-delegation result.",
	schema_version: WT_SCHEMA_VERSION,
} as const satisfies NonNullable<WtCommandContract["resultContract"]>;

/**
 * Exit-code contract shared across wt commands.
 *
 * `3` is the distinct drift-blocked code: it lets an agent branch on "manual
 * edits detected" without scraping stderr text. The facade permits codes
 * beyond the 0/1/2 baseline.
 */
const exitCodes = {
	"0": "Command succeeded.",
	"1": "Runtime failure.",
	"2": "Usage or input error.",
	"3": "Render blocked: the workspace was edited since the last render.",
} as const satisfies WtCommandContract["exitCodes"];

const jsonFlag = {
	"--json": { type: "boolean", description: "Emit JSON envelope." },
} as const;

const forceFlag = {
	"--force": {
		type: "boolean",
		description: "Overwrite a drift-detected workspace, or skip a destructive confirmation.",
	},
} as const;

const noInputFlag = {
	"--no-input": {
		type: "boolean",
		description: "Never prompt; fail with a structured action instead.",
	},
} as const;

const repoFlag = {
	"--repo": {
		type: "path",
		description: "Repo root to operate on. Defaults to the current repository.",
	},
} as const;

/**
 * Facade-backed command catalog for the wt front door.
 *
 * The single source the Command Surface Alignment Proof asserts against:
 * advertised flags, help text, argv acceptance, and runtime semantics all
 * derive from this contract.
 */
export const wtContracts = defineCommandFacadeContract(
	{
		sync: {
			script: "wt",
			summary: "Render the repo's .code-workspace from the registry and live worktrees.",
			usage: ["wt sync --json", "wt sync --repo <path> --force --json"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "check", "write"],
			executionModes: ["normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WT_SYNC_SUCCESS_ACTIONS,
				failure: WT_DRIFT_FAILURE_ACTIONS,
			},
			previewExemption: {
				reason: "The drift gate previews and blocks before overwrite; force is the explicit write.",
			},
			flags: { ...repoFlag, ...forceFlag, ...noInputFlag, ...jsonFlag },
			exitCodes,
		},
		focus: {
			script: "wt",
			summary: "Set a branch's focus subfolder in the registry, then re-render.",
			usage: ["wt focus <branch> <subfolder> --json"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "write"],
			executionModes: ["normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WT_SYNC_SUCCESS_ACTIONS,
				failure: WT_DRIFT_FAILURE_ACTIONS,
			},
			previewExemption: {
				reason: "Writes the registry then re-renders through the drift gate, which previews before overwrite.",
			},
			flags: { ...repoFlag, ...forceFlag, ...jsonFlag },
			exitCodes,
		},
		color: {
			script: "wt",
			summary: "Set a branch's window color in the registry, then re-render.",
			usage: ["wt color <branch> <color> --json"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "write"],
			executionModes: ["normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WT_SYNC_SUCCESS_ACTIONS,
				failure: WT_DRIFT_FAILURE_ACTIONS,
			},
			previewExemption: {
				reason: "Writes the registry then re-renders through the drift gate, which previews before overwrite.",
			},
			flags: { ...repoFlag, ...forceFlag, ...jsonFlag },
			exitCodes,
		},
		open: {
			script: "wt",
			summary: "Open a repo's workspace in VS Code, or list known workspaces.",
			usage: ["wt open --json", "wt open <name> --json"],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			flags: { ...jsonFlag },
			exitCodes,
		},
		new: {
			script: "wt",
			summary: "Create a worktree via @side-quest/git, then re-render.",
			usage: ["wt new <branch> --json"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "write"],
			executionModes: ["normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WT_SYNC_SUCCESS_ACTIONS,
				failure: WT_DELEGATE_FAILURE_ACTIONS,
			},
			previewExemption: {
				reason: "Worktree creation is owned by @side-quest/git; wt only re-renders through the drift gate after.",
			},
			flags: { ...repoFlag, ...jsonFlag },
			exitCodes,
		},
		rm: {
			script: "wt",
			summary: "Remove a worktree via @side-quest/git, then re-render.",
			usage: ["wt rm <branch> --force --json"],
			json: true,
			audience: "agent",
			mutation: "destructive",
			sideEffects: ["read", "write", "destructive"],
			executionModes: ["normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WT_SYNC_SUCCESS_ACTIONS,
				failure: WT_DELEGATE_FAILURE_ACTIONS,
			},
			previewExemption: {
				reason: "Worktree removal is owned and confirmed by @side-quest/git; wt previews removals before delegating.",
			},
			flags: { ...repoFlag, ...forceFlag, ...noInputFlag, ...jsonFlag },
			exitCodes,
		},
		clean: {
			script: "wt",
			summary: "Prune throwaway worktrees via @side-quest/git orphans, then re-render.",
			usage: ["wt clean --force --json"],
			json: true,
			audience: "agent",
			mutation: "destructive",
			sideEffects: ["read", "write", "destructive"],
			executionModes: ["normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WT_SYNC_SUCCESS_ACTIONS,
				failure: WT_DELEGATE_FAILURE_ACTIONS,
			},
			previewExemption: {
				reason: "Pruning is owned by @side-quest/git orphans; wt previews the prune set before delegating.",
			},
			flags: { ...repoFlag, ...forceFlag, ...noInputFlag, ...jsonFlag },
			exitCodes,
		},
		commands: {
			script: "wt",
			summary: "Emit machine-readable command discovery metadata.",
			usage: ["wt commands --json"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract: {
				id: "wt.commands",
				kind: "wt command discovery metadata.",
				schema_version: "1",
			},
			flags: { ...jsonFlag },
			exitCodes,
		},
	} as const satisfies Record<WtCommand, WtCommandContract>,
	{
		path: "skills/wt/src/command-contract.ts",
		writeImplyingMutations: new Set(["write", "destructive"]),
	},
);
