import {
	type CommandFacadeActionAffordance,
	type CommandFacadeContract,
	defineCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import {
	WARM_CHROME_CLI_NAME,
	WARM_CHROME_COMMANDS,
	WARM_CHROME_CONTRACT_ID,
	type WarmChromeCommand,
	type WarmChromeFailureActionId,
	WARM_CHROME_SCHEMA_VERSION,
	type WarmChromeSuccessActionId,
} from "./model.ts";

/**
 * Warm-chrome command audience.
 */
export type WarmChromeAudience = "agent" | "operator";

/**
 * Warm-chrome mutation class. `browser` marks the launch lifecycle that may
 * start local Chrome; `write` marks profile-proof repair.
 */
export type WarmChromeMutation = "check" | "write" | "browser";

/**
 * Facade contract type for the public warm-chrome CLI.
 */
export type WarmChromeCommandContract = CommandFacadeContract<
	WarmChromeCommand,
	WarmChromeAudience,
	WarmChromeMutation
>;

const resultContract = {
	id: WARM_CHROME_CONTRACT_ID,
	kind: "Warm Chrome browser-entry proof.",
	schema_version: WARM_CHROME_SCHEMA_VERSION,
} as const satisfies NonNullable<WarmChromeCommandContract["resultContract"]>;

export const WARM_CHROME_GLOBAL_DIAGNOSTIC_FLAGS = [
	"--run-id",
	"--quiet",
	"--verbose",
	"--debug",
] as const;

// --port and --endpoint are mutually exclusive inputs; the contract declares
// that in every usage line and both flag descriptions, and the parser (U4)
// enforces it with exit 2.
const readFlags = {
	"--port": {
		type: "string",
		description: "CDP port. Mutually exclusive with --endpoint.",
	},
	"--endpoint": {
		type: "string",
		description:
			"Numeric loopback CDP endpoint (127.0.0.1 with explicit port). Mutually exclusive with --port.",
	},
	"--profile": {
		type: "path",
		description: "Expected dedicated profile directory; verifies only.",
	},
	"--json": { type: "boolean", description: "Emit JSON envelope." },
	"--plain": { type: "boolean", description: "Emit stable text." },
} as const satisfies WarmChromeCommandContract["flags"];

const launchFlags = {
	...readFlags,
	"--profile": {
		type: "path",
		description:
			"Dedicated profile directory; launch may create and chmod local profile state.",
	},
	"--chrome": {
		type: "path",
		description:
			"Stable Google Chrome app binary; accepted path is /Applications/Google Chrome.app/Contents/MacOS/Google Chrome.",
	},
} as const satisfies WarmChromeCommandContract["flags"];

const repairFlags = {
	...readFlags,
	"--profile": {
		type: "path",
		description:
			"Dedicated profile directory; repair may create, chmod, or rewrite local profile proof state.",
	},
	"--profile-only": {
		type: "boolean",
		description:
			"Repair only profile policy files; requires explicit --profile; browser-free and does not use or prove --port/--endpoint.",
	},
} as const satisfies WarmChromeCommandContract["flags"];

/**
 * Exit semantics (plan U2 R3): facade baseline 0/1/2 plus package-owned 20.
 *
 * The exit-20 meaning is agent-visible discovery text and carries the
 * no-adapter-fallback continuation meaning the U4+ envelopes enforce.
 */
export const warmChromeExitCodes = {
	"0": "Warm Chrome browser entry verified.",
	"1": "Runtime failure.",
	"2": "Invalid usage.",
	"20": "Browser entry required; no adapter fallback.",
} as const satisfies WarmChromeCommandContract["exitCodes"];

/**
 * Failure runtime actions (plan U2 R12 surface).
 *
 * Prose affordances only — Runtime Continuation Guidance forbids executable
 * command templates; agents resolve ids against discovery, never copy shell.
 */
export const warmChromeFailureActions = [
	{
		id: "launch_warm_chrome",
		summary: "Launch real Google Chrome with a dedicated persistent profile.",
		sideEffects: ["browser", "write"],
	},
	{
		id: "repair_profile",
		summary: "Repair owner-only Warm Chrome profile proof.",
		sideEffects: ["write"],
	},
	{
		id: "rerun_with_explicit_port",
		summary:
			"Rerun the same command with an explicit --port value; the response data field suggested_explicit_port carries a free port when one was found.",
		sideEffects: ["check"],
	},
	{
		id: "inspect_listener",
		summary: "Inspect the current listener before adapter work.",
		sideEffects: ["check"],
	},
	{
		id: "inspect_diagnostics",
		summary: "Stop and inspect diagnostics; not a browser-entry repair.",
		sideEffects: ["check"],
	},
	{
		id: "change_input",
		summary: "Correct CLI arguments, endpoint, port, or profile.",
		sideEffects: ["check"],
	},
] as const satisfies readonly (CommandFacadeActionAffordance & {
	id: WarmChromeFailureActionId;
})[];

/**
 * Success runtime actions (plan U2 R12 surface).
 */
export const warmChromeSuccessActions = [
	{
		id: "use_verified_endpoint",
		summary: "Pass the verified endpoint to the selected browser adapter.",
		sideEffects: ["browser"],
	},
] as const satisfies readonly (CommandFacadeActionAffordance & {
	id: WarmChromeSuccessActionId;
})[];

const actionAffordances = {
	success: warmChromeSuccessActions,
	failure: warmChromeFailureActions,
} as const satisfies WarmChromeCommandContract["actionAffordances"];

/**
 * Facade-backed command catalog for the warm-chrome CLI (plan U2 R2/R3/R14).
 *
 * Owns discovery metadata, rendered help, accepted flags, exit semantics, and
 * side-effect declarations for the public four-command surface.
 */
export const warmChromeContracts = defineCommandFacadeContract(
	{
		check: {
			script: WARM_CHROME_CLI_NAME,
			summary: "Verify Warm Chrome browser entry without changing local state.",
			usage: [
				"warm-chrome check [--port <port> | --endpoint <endpoint>] [--profile <dir>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check", "network"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			capabilityRoles: ["diagnostic"],
			interactivity: "none",
			resultContract,
			actionAffordances,
			flags: readFlags,
			exitCodes: warmChromeExitCodes,
		},
		status: {
			script: WARM_CHROME_CLI_NAME,
			summary: "Show human Warm Chrome status without changing local state.",
			usage: [
				"warm-chrome status [--port <port> | --endpoint <endpoint>] [--profile <dir>] [--json|--plain]",
			],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check", "network"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			capabilityRoles: ["diagnostic"],
			interactivity: "none",
			resultContract,
			actionAffordances,
			flags: readFlags,
			exitCodes: warmChromeExitCodes,
			alias: {
				command: "check",
				defaultArgs: ["--plain"],
			},
		},
		launch: {
			script: WARM_CHROME_CLI_NAME,
			summary: "Launch real Google Chrome if needed, then verify.",
			usage: [
				"warm-chrome launch [--port <port> | --endpoint <endpoint>] [--profile <dir>] [--chrome <path>] [--json|--plain]",
			],
			json: true,
			audience: "operator",
			mutation: "browser",
			sideEffects: ["check", "network", "write", "browser"],
			executionModes: ["normal"],
			// The facade write-preview cross-check is per-command; launch owns no
			// check/dry_run mode, so it declares an exemption naming the check
			// command as the package preview surface (former projection CLI precedent).
			previewExemption: {
				reason:
					"Launch may start local Warm Chrome; warm-chrome check is the read-only preview surface, and launch-only input such as --chrome is validated by launch itself and cannot be previewed.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract,
			actionAffordances,
			flags: launchFlags,
			exitCodes: warmChromeExitCodes,
		},
		repair: {
			script: WARM_CHROME_CLI_NAME,
			summary:
				"Repair safe Warm Chrome profile proof; normal mode then verifies browser entry.",
			usage: [
				"warm-chrome repair [--port <port> | --endpoint <endpoint>] [--profile <dir>] [--json|--plain]",
				"warm-chrome repair --profile-only --profile <dir> [--json|--plain]",
			],
			json: true,
			audience: "operator",
			mutation: "write",
			sideEffects: ["check", "network", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason:
					"Repair changes local Warm Chrome profile proof state; warm-chrome check previews browser entry, while profile-only repair is rechecked by its caller's read-only profile-policy gate.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract,
			actionAffordances,
			flags: repairFlags,
			exitCodes: warmChromeExitCodes,
		},
	} as const satisfies Record<WarmChromeCommand, WarmChromeCommandContract>,
	{
		path: "runtime/warm-chrome/src/command-contract.ts",
		writeImplyingMutations: new Set(["write", "browser"]),
	},
);

/**
 * Contract entries in stable command order.
 */
export const warmChromeContractEntries = WARM_CHROME_COMMANDS.map(
	(command) => [command, warmChromeContracts[command]] as const,
);

/**
 * Agent-visible preview notes projected into command discovery.
 *
 * previewExemption reasons are contract-internal; these notes make the same
 * boundary discoverable: check previews endpoint/profile verification only,
 * and launch-input validation is not previewable.
 */
export const WARM_CHROME_PREVIEW_NOTES = {
	launch:
		"Preview with warm-chrome check; launch-only input (--chrome) is validated by launch itself and cannot be previewed.",
	repair:
		"Preview browser entry with warm-chrome check; profile-only repair requires the caller's read-only profile-policy check.",
} as const satisfies Partial<Record<WarmChromeCommand, string>>;

type WarmChromePreviewNoteAugment = {
	/** Agent-visible preview boundary note for mutating commands. */
	preview_note?: string;
	/** Facade-owned global diagnostics accepted before command parsing. */
	global_diagnostic_flags: typeof WARM_CHROME_GLOBAL_DIAGNOSTIC_FLAGS;
};

/**
 * Command Discovery Tree projection for the warm-chrome CLI (plan U2 R14).
 *
 * Covers all four commands, exit code 20 with its meaning, capability roles,
 * runtime actions, the result contract id, and the preview-boundary notes.
 */
export function projectWarmChromeCommandDiscoveryTree() {
	return projectCommandDiscoveryTree(warmChromeContractEntries, {
		augment: (command): WarmChromePreviewNoteAugment => {
			const note =
				command in WARM_CHROME_PREVIEW_NOTES
					? WARM_CHROME_PREVIEW_NOTES[
							command as keyof typeof WARM_CHROME_PREVIEW_NOTES
						]
					: undefined;
			return {
				global_diagnostic_flags: WARM_CHROME_GLOBAL_DIAGNOSTIC_FLAGS,
				...(note === undefined ? {} : { preview_note: note }),
			};
		},
	});
}
