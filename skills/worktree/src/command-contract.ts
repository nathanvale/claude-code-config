import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import { WORKTREE_COLOR_PALETTE, WORKTREE_CONTRACT_ID, WORKTREE_SCHEMA_VERSION } from "./model.ts";

/**
 * Public command ids for the WorkTree command.
 *
 * `status` is the low-load front door. Owned render verbs
 * (`sync`/`focus`/`color`/`open`/`app`) plus shared-runtime worktree verbs
 * (`new`/`attach`/`rm`/`clean`) are powered by `agent-worktree`. `commands` emits
 * machine-readable discovery metadata.
 */
export const WORKTREE_COMMAND_ORDER = [
	"status",
	"app",
	"new",
	"attach",
	"rm",
	"clean",
	"sync",
	"focus",
	"color",
	"open",
	"commands",
] as const;

export type WorkTreeCommand = (typeof WORKTREE_COMMAND_ORDER)[number];

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
	"attach_branch_already_checked_out",
	"attach_isolation_unavailable",
	"unknown_color",
	"code_not_found",
	"codex_app_not_found",
	"worktree_not_found",
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
 * Discovery actions advertised after the status front door.
 */
const WORKTREE_STATUS_SUCCESS_ACTIONS = [
	{
		id: "open_codex_app",
		summary: "Open an existing linked worktree in Codex Desktop.",
		sideEffects: ["read", "browser"],
	},
	{
		id: "create_worktree",
		summary: "Create a repo-local worktree before opening it in an app.",
		sideEffects: ["read", "write"],
	},
	{
		id: "render_workspace",
		summary: "Render the VS Code workspace from current worktree state.",
		sideEffects: ["read", "write"],
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

/**
 * Discovery actions advertised when attach is refused.
 */
const WORKTREE_ATTACH_FAILURE_ACTIONS = [
	{
		id: "use_existing_checkout",
		summary: "Continue in the existing checkout at the reported path.",
		sideEffects: ["read"],
	},
	{
		id: "choose_attach_isolation_recovery",
		summary:
			"Ask the operator to choose between working in the current checkout and resolving worktree isolation.",
		sideEffects: ["read"],
	},
] as const;

/**
 * Discovery action advertised when a Codex App launch target is not available.
 */
const WORKTREE_CODEX_APP_FAILURE_ACTIONS = [
	{
		id: "inspect_worktrees",
		summary: "Inspect repo-local worktrees, create or choose a branch, then retry.",
		sideEffects: ["read"],
	},
	{
		id: "check_codex_launcher",
		summary: "Check that the Codex Desktop launcher is installed and reachable, then retry.",
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
 * edits detected" without scraping stderr text. `4` identifies attach
 * refusals that need an operator choice. The facade permits codes beyond the
 * 0/1/2 baseline.
 */
const exitCodes = {
	"0": "Command succeeded.",
	"1": "Runtime failure.",
	"2": "Usage or input error.",
	"3": "Render blocked: the workspace was edited since the last render.",
	"4": "Refused: human decision required.",
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

const dryRunFlag = {
	"--dry-run": {
		type: "boolean",
		description: "Preview write effects without mutating state.",
	},
} as const;

const prFlag = {
	"--pr": {
		type: "string",
		description: "Pull request number whose head should be attached.",
	},
} as const;

const trackFlag = {
	"--track": {
		type: "boolean",
		description:
			"Use GitHub CLI checkout inside a detached worktree for push tracking.",
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
		status: {
			script: "worktree",
			summary: "Show VS Code workspace, worktree CRUD, and next-action status.",
			usage: ["worktree status --json", "worktree status --repo <path> --json"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["read", "check"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WORKTREE_STATUS_SUCCESS_ACTIONS,
				failure: WORKTREE_DELEGATE_FAILURE_ACTIONS,
			},
			flags: { ...repoFlag, ...jsonFlag },
			exitCodes,
		},
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
		app: {
			script: "worktree",
			summary: "Open a linked worktree in Codex Desktop as an app project.",
			usage: ["worktree app <branch> --json", "worktree app --repo <path> <branch> --json"],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["read", "browser"],
			executionModes: ["check"],
			outputModes: ["json"],
			interactivity: "optional",
			resultContract: renderResultContract,
			actionAffordances: {
				failure: WORKTREE_CODEX_APP_FAILURE_ACTIONS,
			},
			flags: { ...repoFlag, ...jsonFlag },
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
		attach: {
			script: "worktree",
			summary: "Attach an existing ref or pull request, then re-render.",
			usage: [
				"worktree attach <ref> --json",
				"worktree attach --pr <n> --json",
				"worktree attach --pr <n> --track --json",
			],
			json: true,
			audience: "agent",
			mutation: "write",
			sideEffects: ["read", "check", "network", "write"],
			executionModes: ["dry_run", "normal"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract: renderResultContract,
			actionAffordances: {
				success: WORKTREE_SYNC_SUCCESS_ACTIONS,
				failure: WORKTREE_ATTACH_FAILURE_ACTIONS,
			},
			flags: {
				...repoFlag,
				...dryRunFlag,
				...prFlag,
				...trackFlag,
				...forceRenderFlag,
				...jsonFlag,
			},
			exitCodes,
		},
		rm: {
			script: "worktree",
			summary: "Remove a worktree, clean Codex app project state, then re-render.",
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
				reason: "Worktree removal is owned and confirmed by agent-worktree; WorkTree cleans matching Codex app project state, then re-renders through the drift gate.",
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
