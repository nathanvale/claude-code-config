import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";

export const WARM_CHROME_PREFLIGHT_CONTRACT_ID =
	"browser-use.warm-chrome-preflight" as const;
export const WARM_CHROME_PREFLIGHT_SCHEMA_VERSION = "2" as const;

export type WarmChromePreflightCommand =
	| "check"
	| "repair"
	| "launch"
	| "status";
type WarmChromeAudience = "agent" | "operator";
type WarmChromeMutation = "check" | "write" | "browser";
type WarmChromeCommandContract = CommandFacadeContract<
	WarmChromePreflightCommand,
	WarmChromeAudience,
	WarmChromeMutation
>;

const readFlags = {
	"--port": { type: "string", description: "CDP port." },
	"--endpoint": { type: "string", description: "Loopback CDP endpoint." },
	"--profile": {
		type: "path",
		description: "Expected dedicated profile directory.",
	},
	"--json": { type: "boolean", description: "Emit JSON envelope." },
	"--plain": { type: "boolean", description: "Emit stable text." },
} as const satisfies WarmChromeCommandContract["flags"];

const writeFlags = {
	...readFlags,
	"--chrome": {
		type: "path",
		description: "Real Google Chrome binary path.",
	},
} as const satisfies WarmChromeCommandContract["flags"];

const commonEnvVars = [
	{ name: "BROWSER_USE_CDP_PORT", description: "Default CDP port." },
	{
		name: "BROWSER_USE_PROFILE_DIR",
		description: "Default dedicated profile directory.",
	},
	{ name: "BROWSER_USE_RUN_ID", description: "Optional run correlation id." },
	{ name: "CHROME_BIN", description: "Real Google Chrome binary override." },
] as const satisfies WarmChromeCommandContract["envVars"];

const exitCodes = {
	"0": "Warm Chrome ready.",
	"1": "Runtime dependency failed.",
	"2": "Usage error.",
	"20": "Browser entry required.",
} as const satisfies WarmChromeCommandContract["exitCodes"];

const resultContract = {
	id: WARM_CHROME_PREFLIGHT_CONTRACT_ID,
	kind: "Warm Chrome readiness proof.",
	schema_version: WARM_CHROME_PREFLIGHT_SCHEMA_VERSION,
} as const satisfies NonNullable<WarmChromeCommandContract["resultContract"]>;

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
		id: "enable_remote_debugging",
		summary: "Enable Chrome remote debugging, then rerun preflight.",
		sideEffects: ["browser"],
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
] as const;

export const warmChromeSuccessActions = [
	{
		id: "use_verified_endpoint",
		summary: "Pass verified endpoint to the selected browser adapter.",
		sideEffects: ["browser"],
	},
	{
		id: "rerun_preflight_before_adapter_action",
		summary: "Rerun preflight before adapter action.",
		sideEffects: ["check"],
	},
] as const;

export const warmChromePreflightContracts = defineCommandFacadeContract(
	{
		check: {
			script: "scripts/preflight-warm-chrome.ts",
			summary: "Verify Warm Chrome without changing local state.",
			usage: [
				"check [--port <port> | --endpoint <endpoint>] [--profile <dir>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check", "network"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: commonEnvVars,
			resultContract,
			actionAffordances: {
				success: warmChromeSuccessActions,
				failure: warmChromeFailureActions,
			},
			flags: readFlags,
			exitCodes,
		},
		repair: {
			script: "scripts/preflight-warm-chrome.ts",
			summary: "Repair safe Warm Chrome profile proof, then verify.",
			usage: [
				"repair [--port <port> | --endpoint <endpoint>] [--profile <dir>] [--json|--plain]",
			],
			json: true,
			audience: "operator",
			mutation: "write",
			sideEffects: ["check", "network", "write"],
			executionModes: ["normal"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: commonEnvVars,
			resultContract,
			actionAffordances: {
				success: warmChromeSuccessActions,
				failure: warmChromeFailureActions,
			},
			flags: readFlags,
			exitCodes,
		},
		launch: {
			script: "scripts/preflight-warm-chrome.ts",
			summary: "Launch real Google Chrome if needed, then verify.",
			usage: [
				"launch [--port <port> | --endpoint <endpoint>] [--profile <dir>] [--chrome <path>] [--json|--plain]",
			],
			json: true,
			audience: "operator",
			mutation: "browser",
			sideEffects: ["check", "network", "write", "browser"],
			executionModes: ["normal"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: commonEnvVars,
			resultContract,
			actionAffordances: {
				success: warmChromeSuccessActions,
				failure: warmChromeFailureActions,
			},
			flags: writeFlags,
			exitCodes,
		},
		status: {
			script: "scripts/preflight-warm-chrome.ts",
			summary: "Show human Warm Chrome status without changing local state.",
			usage: [
				"status [--port <port> | --endpoint <endpoint>] [--profile <dir>] [--json|--plain]",
			],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check", "network"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: commonEnvVars,
			resultContract,
			actionAffordances: {
				success: warmChromeSuccessActions,
				failure: warmChromeFailureActions,
			},
			flags: readFlags,
			exitCodes,
			alias: {
				command: "check",
				defaultArgs: ["--plain"],
			},
		},
	} as const satisfies Record<
		WarmChromePreflightCommand,
		WarmChromeCommandContract
	>,
	{
		path: "skills/browser-use/scripts/command-contract.ts",
		writeImplyingMutations: new Set(["write", "browser"]),
	},
);
