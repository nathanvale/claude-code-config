import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import { WORKTREE_COLOR_PALETTE, WORKTREE_CONTRACT_ID, WORKTREE_SCHEMA_VERSION } from "./model.ts";

/**
 * Public command ids for the WorkTree command.
 *
 * Owned render verbs (`sync`/`focus`/`color`/`open`) plus shared-runtime
 * worktree verbs (`new`/`rm`/`clean`) powered by `agent-worktree`.
 * `commands` emits machine-readable discovery metadata.
 */
export type WorkTreeCommand =
	| "sync"
	| "focus"
	| "color"
	| "open"
	| "new"
	| "rm"
	| "clean"
	| "commands";

type WorkTreeAudience = "agent" | "operator";
type WorkTreeMutation = "check" | "write" | "destructive";
type WorkTreeCommandContract = CommandFacadeContract<WorkTreeCommand, WorkTreeAudience, WorkTreeMutation>;

/**
 * Package-owned diagnostic codes returned by the WorkTree runner.
 *
 * Each names a distinct, agent-repairable failure mode. `drift_blocked` is the
 * product's core safety stop: a manual edit was detected and the sync refused
 * to overwrite it.
 */
export const WORKTREE_DIAGNOSTIC_CODES = [
	"usage_error",
	"drift_blocked",
	"registry_unreadable",
	"worktree_list_failed",
	"agent_worktree_blocked",
	"agent_worktree_failed",
	"unknown_color",
	"code_not_found",
	"write_failed",
] as const;

/**
 * Diagnostic-code union for package-owned repair handling.
 */
export type WorkTreeDiagnosticCode = (typeof WORKTREE_DIAGNOSTIC_CODES)[number];

/**
 * Discovery action advertised after a successful render.
 */
const WORKTREE_SYNC_SUCCESS_ACTIONS = [
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
const WORKTREE_DRIFT_FAILURE_ACTIONS = [
	{
		id: "review_drift",
		summary:
			"Review the diff, port real edits into the registry, then rerun the render with force.",
		sideEffects: ["read"],
	},
] as const;

const WORKTREE_COLOR_FAILURE_SUMMARY = `Choose one of: ${WORKTREE_COLOR_PALETTE.join(", ")}.`;

/**
 * Discovery actions advertised when `worktree color` fails.
 *
 * Unknown colors need a palette-selection continuation before the generic
 * drift-repair fallback, so agents get a concrete next input instead of only a
 * render recovery path.
 */
const WORKTREE_COLOR_FAILURE_ACTIONS = [
	{
		id: "choose_palette_color",
		summary: WORKTREE_COLOR_FAILURE_SUMMARY,
		sideEffects: ["read"],
	},
	...WORKTREE_DRIFT_FAILURE_ACTIONS,
] as const;

/**
 * Discovery action advertised when a shared worktree verb fails.
 */
const WORKTREE_DELEGATE_FAILURE_ACTIONS = [
	{
		id: "inspect_worktrees",
		summary: "Inspect worktree state, resolve the upstream failure, then retry.",
		sideEffects: ["read"],
	},
] as const;

export const worktreeRenderResultContract = {
	id: WORKTREE_CONTRACT_ID,
	kind: "worktree workspace render or shared worktree lifecycle result.",
	schema_version: WORKTREE_SCHEMA_VERSION,
} as const satisfies NonNullable<WorkTreeCommandContract["resultContract"]>;

const renderResultContract = worktreeRenderResultContract;

/**
 * Exit-code contract shared across worktree commands.
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
} as const satisfies WorkTreeCommandContract["exitCodes"];

const jsonFlag = {
	"--json": { type: "boolean", description: "Emit JSON envelope." },
} as const;

const forceFlag = {
	"--force": {
		type: "boolean",
		description: "Overwrite a drift-detected workspace.",
	},
} as const;

const destructiveForceFlag = {
	"--force": {
		type: "boolean",
		description: "Confirm destructive worktree removal.",
	},
} as const;

const forceRenderFlag = {
	"--force-render": {
		type: "boolean",
		description: "Overwrite a drift-detected workspace after lifecycle completion.",
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
 * Facade-backed command catalog for the WorkTree command.
 *
 * The single source the Command Surface Alignment Proof asserts against:
 * advertised flags, help text, argv acceptance, and runtime semantics all
 * derive from this contract.
 */
export const worktreeContracts = defineCommandFacadeContract(
	{
		sync: {
			script: "worktree",
			summary: "Render the repo's .code-workspace from the registry and live worktrees.",
			usage: ["worktree sync --json", "worktree sync --repo <path> --force --json"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "check", "write"],
			executionModes: ["normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WORKTREE_SYNC_SUCCESS_ACTIONS,
				failure: WORKTREE_DRIFT_FAILURE_ACTIONS,
			},
			previewExemption: {
				reason: "The drift gate previews and blocks before overwrite; force is the explicit write.",
			},
			flags: { ...repoFlag, ...forceFlag, ...noInputFlag, ...jsonFlag },
			exitCodes,
		},
		focus: {
			script: "worktree",
			summary: "Set a branch's focus subfolder in the registry, then re-render.",
			usage: ["worktree focus <branch> <subfolder> --json"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "write"],
			executionModes: ["normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WORKTREE_SYNC_SUCCESS_ACTIONS,
				failure: WORKTREE_DRIFT_FAILURE_ACTIONS,
			},
			previewExemption: {
				reason: "Writes the registry then re-renders through the drift gate, which previews before overwrite.",
			},
			flags: { ...repoFlag, ...forceFlag, ...jsonFlag },
			exitCodes,
		},
		color: {
			script: "worktree",
			summary: "Set a branch's window color in the registry, then re-render.",
			usage: ["worktree color <branch> <color> --json"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "write"],
			executionModes: ["normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WORKTREE_SYNC_SUCCESS_ACTIONS,
				failure: WORKTREE_COLOR_FAILURE_ACTIONS,
			},
			previewExemption: {
				reason: "Writes the registry then re-renders through the drift gate, which previews before overwrite.",
			},
			flags: { ...repoFlag, ...forceFlag, ...jsonFlag },
			exitCodes,
		},
		open: {
			script: "worktree",
			summary: "Open a repo's workspace in VS Code, or list known workspaces.",
			usage: ["worktree open --json", "worktree open <name> --json"],
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
			script: "worktree",
			summary: "Create a worktree through agent-worktree, then re-render.",
			usage: ["worktree new <branch> --json"],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "write"],
			executionModes: ["normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WORKTREE_SYNC_SUCCESS_ACTIONS,
				failure: WORKTREE_DELEGATE_FAILURE_ACTIONS,
			},
			previewExemption: {
				reason: "Worktree creation is owned by agent-worktree; WorkTree only re-renders through the drift gate after.",
			},
			flags: { ...repoFlag, ...forceRenderFlag, ...jsonFlag },
			exitCodes,
		},
		rm: {
			script: "worktree",
			summary: "Remove a worktree through agent-worktree, then re-render.",
			usage: ["worktree rm <branch> --force --json", "worktree rm <branch> --force --force-render --json"],
			json: true,
			audience: "agent",
			mutation: "destructive",
			sideEffects: ["read", "write", "destructive"],
			executionModes: ["normal"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WORKTREE_SYNC_SUCCESS_ACTIONS,
				failure: WORKTREE_DELEGATE_FAILURE_ACTIONS,
			},
			previewExemption: {
				reason: "Worktree removal is owned and confirmed by agent-worktree; worktree re-renders through the drift gate after.",
			},
			flags: { ...repoFlag, ...destructiveForceFlag, ...forceRenderFlag, ...noInputFlag, ...jsonFlag },
			exitCodes,
		},
		clean: {
			script: "worktree",
			summary: "Preview cleanup candidates through agent-worktree.",
			usage: ["worktree clean --json"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read", "check"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WORKTREE_SYNC_SUCCESS_ACTIONS,
				failure: WORKTREE_DELEGATE_FAILURE_ACTIONS,
			},
			flags: { ...repoFlag, ...jsonFlag },
			exitCodes,
		},
		commands: {
			script: "worktree",
			summary: "Emit machine-readable command discovery metadata.",
			usage: ["worktree commands --json"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract: {
				id: "worktree.commands",
				kind: "WorkTree command discovery metadata.",
				schema_version: "1",
			},
			flags: { ...jsonFlag },
			exitCodes,
		},
	} as const satisfies Record<WorkTreeCommand, WorkTreeCommandContract>,
	{
		path: "skills/worktree/src/command-contract.ts",
		writeImplyingMutations: new Set(["write", "destructive"]),
	},
);
