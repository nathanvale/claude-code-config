import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";

export const WARM_CHROME_PREFLIGHT_CONTRACT_ID =
	"browser-use.warm-chrome-preflight" as const;
export const WARM_CHROME_PREFLIGHT_SCHEMA_VERSION = "2" as const;
export const BROWSER_ADAPTER_PROOF_CONTRACT_ID =
	"browser-use.browser-adapter-proof" as const;
// v2 (plan U2 R8): proof output gained required adapter_proof_id and
// verified_endpoint_identity binding fields; consumers version-discriminate.
export const BROWSER_ADAPTER_PROOF_SCHEMA_VERSION = "2" as const;
export const BROWSER_ADAPTER_MAP_CONTRACT_ID =
	"browser-use.browser-adapter-map" as const;
export const BROWSER_ADAPTER_MAP_SCHEMA_VERSION = "1" as const;

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
export type BrowserAdapterProofCommand = "check" | "status";
export const BROWSER_ADAPTER_PROOF_ADAPTERS = ["chrome-devtools"] as const;
export type BrowserAdapterProofAdapter =
	(typeof BROWSER_ADAPTER_PROOF_ADAPTERS)[number];
export type BrowserAdapterMapCommand = "check" | "status";
export const BROWSER_ADAPTER_MAP_ADAPTERS = ["chrome-devtools"] as const;
export type BrowserAdapterMapAdapter =
	(typeof BROWSER_ADAPTER_MAP_ADAPTERS)[number];
export const BROWSER_ADAPTER_PROOF_CONFIG_SOURCE_LABELS = [
	"mcporter",
	"repo_mcp",
	"native_mcp_claude_code",
	"native_mcp_claude_desktop",
	"native_mcp_codex",
	"native_mcp_unknown",
] as const;
export type BrowserAdapterProofConfigSourceLabel =
	(typeof BROWSER_ADAPTER_PROOF_CONFIG_SOURCE_LABELS)[number];
export const BROWSER_ADAPTER_PROOF_BINDING_KINDS = [
	"browser_url",
	"devtools_active_port",
	"auto_connect_user_data_dir",
] as const;
export type BrowserAdapterProofBindingKind =
	(typeof BROWSER_ADAPTER_PROOF_BINDING_KINDS)[number];
export const BROWSER_ADAPTER_PROOF_BINDING_STATUSES = [
	"matches_verified_endpoint",
	"mismatch",
	"stale",
	"missing",
	"unknown",
] as const;
export type BrowserAdapterProofBindingStatus =
	(typeof BROWSER_ADAPTER_PROOF_BINDING_STATUSES)[number];
export const BROWSER_ADAPTER_PROOF_CONFIG_PARSE_STATUSES = [
	"ok",
	"missing",
	"malformed",
	"unreadable",
] as const;
export type BrowserAdapterProofConfigParseStatus =
	(typeof BROWSER_ADAPTER_PROOF_CONFIG_PARSE_STATUSES)[number];
export const BROWSER_ADAPTER_PROOF_DIAGNOSTIC_CODES = [
	"adapter_config_stale",
	"adapter_config_missing",
	"adapter_dependency_missing",
	"adapter_command_override_invalid",
	"adapter_binding_mismatch",
	"adapter_binding_ambiguous",
	"adapter_signal_weak",
	"adapter_chrome_for_testing_risk",
	"adapter_auto_launch_risk",
	"adapter_proof_timeout",
	"adapter_command_failed",
	"adapter_output_unparsable",
	"adapter_config_parse_error",
] as const;
export type BrowserAdapterProofDiagnosticCode =
	(typeof BROWSER_ADAPTER_PROOF_DIAGNOSTIC_CODES)[number];
export const BROWSER_ADAPTER_PROOF_LOCAL_RECOVERY_KEYS = [
	"browser_entry_handoff",
	"missing_adapter",
	"unknown_adapter",
	"non_loopback_endpoint",
	"invalid_usage",
	"runtime_failure",
] as const;
type BrowserAdapterProofMutation = "check";
type BrowserAdapterProofCommandContract = CommandFacadeContract<
	BrowserAdapterProofCommand,
	WarmChromeAudience,
	BrowserAdapterProofMutation
>;
type BrowserAdapterMapMutation = "check";
type BrowserAdapterMapCommandContract = CommandFacadeContract<
	BrowserAdapterMapCommand,
	WarmChromeAudience,
	BrowserAdapterMapMutation
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
	{ name: "BROWSER_USE_CDP_PORT", description: "CDP port hint." },
	{
		name: "BROWSER_USE_PROFILE_DIR",
		description: "Dedicated profile directory hint.",
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

const adapterProofReadFlags = {
	"--adapter": {
		type: "enum",
		values: BROWSER_ADAPTER_PROOF_ADAPTERS,
		description: "Browser Adapter to prove.",
		required: true,
	},
	"--port": { type: "string", description: "Verified Warm Chrome CDP port." },
	"--endpoint": {
		type: "string",
		description: "Verified Warm Chrome loopback CDP endpoint.",
	},
	"--json": { type: "boolean", description: "Emit JSON envelope." },
	"--plain": { type: "boolean", description: "Emit stable text." },
} as const satisfies BrowserAdapterProofCommandContract["flags"];

const adapterProofEnvVars = [
	{ name: "BROWSER_USE_CDP_PORT", description: "CDP port hint." },
	{
		name: "BROWSER_USE_PROFILE_DIR",
		description: "Dedicated profile directory hint.",
	},
	{ name: "BROWSER_USE_RUN_ID", description: "Optional run correlation id." },
	{
		name: "BROWSER_USE_MCPORTER_COMMAND_JSON",
		description:
			"JSON array command vector override for mcporter. Values must be non-empty strings; shell strings are rejected; package runners are never tried automatically.",
	},
] as const satisfies BrowserAdapterProofCommandContract["envVars"];

const adapterProofExitCodes = {
	"0": "Browser Adapter proven.",
	"1": "Runtime dependency failed.",
	"2": "Usage error.",
	"20": "Browser Adapter proof failed.",
} as const satisfies BrowserAdapterProofCommandContract["exitCodes"];

const adapterProofResultContract = {
	id: BROWSER_ADAPTER_PROOF_CONTRACT_ID,
	kind: "Browser Adapter attachment proof.",
	schema_version: BROWSER_ADAPTER_PROOF_SCHEMA_VERSION,
} as const satisfies NonNullable<
	BrowserAdapterProofCommandContract["resultContract"]
>;

const browserAdapterMapFlags = {
	"--adapter": {
		type: "enum",
		values: BROWSER_ADAPTER_MAP_ADAPTERS,
		description: "Browser Adapter Map to validate.",
		required: true,
	},
	"--json": { type: "boolean", description: "Emit JSON envelope." },
	"--plain": { type: "boolean", description: "Emit stable text." },
} as const satisfies BrowserAdapterMapCommandContract["flags"];

const browserAdapterMapExitCodes = {
	"0": "Browser Adapter Map valid.",
	"1": "Runtime dependency failed.",
	"2": "Usage error.",
	"20": "Browser Adapter Map invalid.",
} as const satisfies BrowserAdapterMapCommandContract["exitCodes"];

const browserAdapterMapResultContract = {
	id: BROWSER_ADAPTER_MAP_CONTRACT_ID,
	kind: "Browser Adapter Map validation.",
	schema_version: BROWSER_ADAPTER_MAP_SCHEMA_VERSION,
} as const satisfies NonNullable<
	BrowserAdapterMapCommandContract["resultContract"]
>;

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

export const browserAdapterProofFailureActions = [
	...warmChromeFailureActions,
	{
		id: "inspect_adapter_config",
		summary: "Inspect Browser Adapter config without changing it.",
		sideEffects: ["check"],
	},
	{
		id: "configure_adapter_dependency",
		summary:
			"Expose mcporter on PATH or configure an explicit mcporter command vector.",
		sideEffects: ["write"],
	},
	{
		id: "update_adapter_config",
		summary: "Update external Browser Adapter config, then rerun proof.",
		sideEffects: ["write"],
	},
	{
		id: "change_adapter_input",
		summary: "Correct Browser Adapter proof arguments.",
		sideEffects: ["check"],
	},
] as const;

export const browserAdapterProofSuccessActions = [
	{
		id: "use_verified_browser_adapter",
		summary:
			"Use the selected Browser Adapter against the verified Warm Chrome endpoint.",
		sideEffects: ["browser"],
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
			previewExemption: {
				reason: "Repair changes local Warm Chrome profile proof state.",
			},
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
			previewExemption: {
				reason: "Launch may start local Warm Chrome.",
			},
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

export const browserAdapterProofContracts = defineCommandFacadeContract(
	{
		check: {
			script: "scripts/preflight-browser-adapter.ts",
			summary: "Verify a Browser Adapter against Warm Chrome.",
			usage: [
				"check --adapter chrome-devtools [--port <port> | --endpoint <endpoint>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check", "network"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: adapterProofEnvVars,
			resultContract: adapterProofResultContract,
			actionAffordances: {
				success: browserAdapterProofSuccessActions,
				failure: browserAdapterProofFailureActions,
			},
			flags: adapterProofReadFlags,
			exitCodes: adapterProofExitCodes,
		},
		status: {
			script: "scripts/preflight-browser-adapter.ts",
			summary: "Show human Browser Adapter proof status.",
			usage: [
				"status --adapter chrome-devtools [--port <port> | --endpoint <endpoint>] [--json|--plain]",
			],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check", "network"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: adapterProofEnvVars,
			resultContract: adapterProofResultContract,
			actionAffordances: {
				success: browserAdapterProofSuccessActions,
				failure: browserAdapterProofFailureActions,
			},
			flags: adapterProofReadFlags,
			exitCodes: adapterProofExitCodes,
			alias: {
				command: "check",
				defaultArgs: ["--plain"],
			},
		},
	} as const satisfies Record<
		BrowserAdapterProofCommand,
		BrowserAdapterProofCommandContract
	>,
	{
		path: "skills/browser-use/scripts/command-contract.ts",
		writeImplyingMutations: new Set(["write", "browser"]),
	},
);

export const browserAdapterMapContracts = defineCommandFacadeContract(
	{
		check: {
			script: "scripts/browser-adapter-map.ts",
			summary: "Validate one Browser Adapter Map.",
			usage: ["check --adapter chrome-devtools [--json|--plain]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: [],
			resultContract: browserAdapterMapResultContract,
			flags: browserAdapterMapFlags,
			exitCodes: browserAdapterMapExitCodes,
		},
		status: {
			script: "scripts/browser-adapter-map.ts",
			summary: "Show human Browser Adapter Map validation status.",
			usage: ["status --adapter chrome-devtools [--json|--plain]"],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: [],
			resultContract: browserAdapterMapResultContract,
			flags: browserAdapterMapFlags,
			exitCodes: browserAdapterMapExitCodes,
			alias: {
				command: "check",
				defaultArgs: ["--plain"],
			},
		},
	} as const satisfies Record<
		BrowserAdapterMapCommand,
		BrowserAdapterMapCommandContract
	>,
	{
		path: "skills/browser-use/scripts/command-contract.ts",
		writeImplyingMutations: new Set(["write", "browser"]),
	},
);

// ---------------------------------------------------------------------------
// Browser Adapter Router (plan 2026-06-02-004)
//
// Package-owned result vocabulary for the evidence-first Router. The facade owns
// envelope shape; these constants own the stable literals the Router emits and
// callers/tests rely on (capability names, report states, diagnostic codes,
// runtime action ids). The router runtime and tests derive from these — no
// hand-maintained literal lists in prose (plan Scope Boundaries).
// ---------------------------------------------------------------------------

export const BROWSER_ADAPTER_ROUTER_CONTRACT_ID =
	"browser-use.browser-adapter-router" as const;
export const BROWSER_ADAPTER_ROUTER_SCHEMA_VERSION = "1" as const;

export type BrowserAdapterRouterCommand =
	| "prepare"
	| "route"
	| "report"
	| "status";

// Registry ids (plan R11). Membership is known Browser Adapter identity, not
// routability (R11a).
export const BROWSER_ADAPTER_ROUTER_ADAPTERS = [
	"chrome-devtools",
	"agent-browser",
	"playwright-cdp",
] as const;
export type BrowserAdapterRouterAdapter =
	(typeof BROWSER_ADAPTER_ROUTER_ADAPTERS)[number];

// Adapter capabilities (plan Capability Model). `performance_profile` is not
// `devtools_performance_insight`; `memory_debug` is adapter-name-neutral.
export const BROWSER_ADAPTER_ROUTER_CAPABILITIES = [
	"snapshot_refs",
	"element_actions",
	"selector_actions",
	"screenshot_media",
	"console_debug",
	"network_inspection",
	"performance_profile",
	"devtools_performance_insight",
	"memory_debug",
	"react_vitals",
	// Runtime-owned viewport emulation capability (plan U2 R11). Routed evidence
	// must declare it before `browser-use operate emulate` is authorized.
	"viewport_emulation",
] as const;
export type BrowserAdapterRouterCapability =
	(typeof BROWSER_ADAPTER_ROUTER_CAPABILITIES)[number];

// Capability support states (plan R6).
export const BROWSER_ADAPTER_ROUTER_SUPPORT_STATES = [
	"full",
	"partial",
	"none",
	"unknown",
	"stale",
] as const;
export type BrowserAdapterRouterSupportState =
	(typeof BROWSER_ADAPTER_ROUTER_SUPPORT_STATES)[number];

// Attachment models (plan R12). Only `verified_warm_chrome` is compatible
// attachment for Router V1; the rest are reportable evidence but fail
// compatibility (R12b, R12c).
export const BROWSER_ADAPTER_ROUTER_ATTACHMENT_MODELS = [
	"verified_warm_chrome",
	"separate_browser_context",
	"storage_state_import",
	"unknown",
] as const;
export type BrowserAdapterRouterAttachmentModel =
	(typeof BROWSER_ADAPTER_ROUTER_ATTACHMENT_MODELS)[number];
export const BROWSER_ADAPTER_ROUTER_COMPATIBLE_ATTACHMENT_MODEL =
	"verified_warm_chrome" as const;

// Report source priority (plan "Report source order"): validated self-report
// beats validated manifest; neither -> no routable report.
export const BROWSER_ADAPTER_ROUTER_REPORT_SOURCES = [
	"self_report",
	"manifest",
] as const;
export type BrowserAdapterRouterReportSource =
	(typeof BROWSER_ADAPTER_ROUTER_REPORT_SOURCES)[number];

// Minimum per-capability confidence for a full route (plan Capability Discovery
// V1: "confidence >=75 for every required capability").
export const BROWSER_ADAPTER_ROUTER_MIN_ROUTE_CONFIDENCE = 75 as const;

// Policy modes (plan Policy Semantics).
export const BROWSER_ADAPTER_ROUTER_MODES = ["auto", "prefer", "force"] as const;
export type BrowserAdapterRouterMode =
	(typeof BROWSER_ADAPTER_ROUTER_MODES)[number];

// Seed task-facing bundle names (plan Bundles). Presets, not guarantees;
// runtime evaluates resolved required capabilities.
export const BROWSER_ADAPTER_ROUTER_BUNDLES = [
	"snapshot_page_action",
	"visual_proof_capture",
	"runtime_debug_inspection",
	"performance_profile",
	"runbook_step_execution",
] as const;
export type BrowserAdapterRouterBundle =
	(typeof BROWSER_ADAPTER_ROUTER_BUNDLES)[number];

// Diagnostic codes (plan Recovery Semantics). Stable error.code literals.
export const BROWSER_ADAPTER_ROUTER_DIAGNOSTIC_CODES = [
	"adapter_capability_none",
	"adapter_capability_unknown",
	"adapter_capability_stale",
	"adapter_capability_partial",
	"adapter_attachment_unverified",
	"adapter_attachment_incompatible",
	"route_evidence_invalid",
	"route_evidence_mixed_run",
	"route_evidence_stale",
	// Binding tuple mismatch across route/proof evidence (plan U2 R9): proof id,
	// warm Chrome run id, selected adapter id, or endpoint identity do not agree.
	"route_evidence_binding_mismatch",
	"auth_session_unverified",
	"target_origin_unverified",
] as const;
export type BrowserAdapterRouterDiagnosticCode =
	(typeof BROWSER_ADAPTER_ROUTER_DIAGNOSTIC_CODES)[number];

// Prepare diagnostic codes (plan R6). `prepare` aggregates missing/invalid input
// facts; these codes name the missing-fact classes that resolve to the
// dependency-ordered canonical continuation, distinct from route evaluation
// codes which judge already-assembled evidence.
export const BROWSER_ADAPTER_ROUTER_PREPARE_DIAGNOSTIC_CODES = [
	"prepare_warm_chrome_missing",
	"prepare_report_missing",
	"prepare_adapter_proof_missing",
	"prepare_input_invalid",
] as const;
export type BrowserAdapterRouterPrepareDiagnosticCode =
	(typeof BROWSER_ADAPTER_ROUTER_PREPARE_DIAGNOSTIC_CODES)[number];

type BrowserAdapterRouterAudience = "agent" | "operator";
type BrowserAdapterRouterMutation = "check" | "network";
type BrowserAdapterRouterCommandContract = CommandFacadeContract<
	BrowserAdapterRouterCommand,
	BrowserAdapterRouterAudience,
	BrowserAdapterRouterMutation
>;

const routerOutputFlags = {
	"--json": { type: "boolean", description: "Emit JSON envelope." },
	"--plain": { type: "boolean", description: "Emit stable text." },
} as const satisfies BrowserAdapterRouterCommandContract["flags"];

const routerEnvelopeFlags = {
	"--envelope": {
		type: "path",
		description: "Evidence envelope JSON file. Omit to read envelope from stdin.",
	},
	...routerOutputFlags,
} as const satisfies BrowserAdapterRouterCommandContract["flags"];

const routerReportFlags = {
	"--adapter": {
		type: "enum",
		values: BROWSER_ADAPTER_ROUTER_ADAPTERS,
		required: true,
		description: "Browser Adapter id for report discovery.",
	},
	"--capability": {
		type: "enum",
		values: BROWSER_ADAPTER_ROUTER_CAPABILITIES,
		description: "Capability to report on for report discovery.",
	},
	...routerOutputFlags,
} as const satisfies BrowserAdapterRouterCommandContract["flags"];

const routerPrepareFlags = {
	"--warm-chrome-proof": {
		type: "path",
		description: "Warm Chrome Preflight proof envelope JSON file.",
	},
	"--adapter-proof": {
		type: "path",
		description: "Browser Adapter Proof envelope JSON file.",
	},
	"--report": {
		type: "path",
		description:
			"Capability report JSON file. Repeat to supply multiple reports.",
	},
	"--target-discovery": {
		type: "path",
		description:
			"Recovery-mode target discovery envelope JSON file for target precondition evidence.",
	},
	"--mode": {
		type: "enum",
		values: BROWSER_ADAPTER_ROUTER_MODES,
		description: "Route policy mode.",
	},
	"--adapter": {
		type: "enum",
		values: BROWSER_ADAPTER_ROUTER_ADAPTERS,
		description: "Requested Browser Adapter id for prefer/force mode.",
	},
	"--fallback-allowed": {
		type: "boolean",
		description: "Allow adapter fallback in the assembled policy.",
	},
	"--bundle": {
		type: "enum",
		values: BROWSER_ADAPTER_ROUTER_BUNDLES,
		description: "Task capability bundle preset.",
	},
	"--capability": {
		type: "enum",
		values: BROWSER_ADAPTER_ROUTER_CAPABILITIES,
		description: "Required capability. Repeat to require multiple.",
	},
	"--target-origin": {
		type: "string",
		description: "Required target origin precondition term.",
	},
	...routerOutputFlags,
} as const satisfies BrowserAdapterRouterCommandContract["flags"];

const routerBaseEnvVars = [
	{ name: "BROWSER_USE_RUN_ID", description: "Optional run correlation id." },
	{
		name: "BROWSER_USE_ROUTER_EVAL_DATE",
		description:
			"ISO date (YYYY-MM-DD) used as the freshness evaluation date. Defaults to today; pin in tests and CI for determinism.",
	},
] as const satisfies BrowserAdapterRouterCommandContract["envVars"];

const routerEnvelopeEnvVars = [
	...routerBaseEnvVars,
	{
		name: "BROWSER_USE_ROUTER_ENVELOPE_JSON",
		description: "Inline evidence envelope JSON; overridden by --envelope.",
	},
] as const satisfies BrowserAdapterRouterCommandContract["envVars"];

const routerReportEnvVars = [
	...routerBaseEnvVars,
	{
		name: "BROWSER_USE_ROUTER_SELF_REPORT_JSON",
		description:
			"Full JSON capability report object for the self-report path; validated by the same report validator as adapter manifests.",
	},
] as const satisfies BrowserAdapterRouterCommandContract["envVars"];

const routerPrepareEnvVars = [
	...routerBaseEnvVars,
	{
		name: "BROWSER_USE_ROUTER_PREPARE_RUN_ID",
		description:
			"Run correlation id stamped into the prepared envelope when no proof supplies one; defaults to BROWSER_USE_RUN_ID.",
	},
] as const satisfies BrowserAdapterRouterCommandContract["envVars"];

const routerExitCodes = {
	"0": "Browser Adapter selected or report produced.",
	"1": "Runtime dependency failed.",
	"2": "Usage error.",
	"20": "Route failed closed.",
} as const satisfies BrowserAdapterRouterCommandContract["exitCodes"];

const routerResultContract = {
	id: BROWSER_ADAPTER_ROUTER_CONTRACT_ID,
	kind: "Browser Adapter route decision.",
	schema_version: BROWSER_ADAPTER_ROUTER_SCHEMA_VERSION,
} as const satisfies NonNullable<
	BrowserAdapterRouterCommandContract["resultContract"]
>;

// Recovery + success runtime actions (plan Recovery Semantics). Action ids are
// the stable continuation.next_action_id vocabulary.
export const browserAdapterRouterFailureActions = [
	{
		id: "prove_adapter_attachment",
		summary:
			"Run Browser Adapter Proof for a candidate adapter, then retry routing with fresh proof evidence.",
		sideEffects: ["check"],
	},
	{
		id: "research_adapter_capability",
		summary:
			"Run bounded docs research for an adapter capability; advisory only until verified.",
		sideEffects: ["check"],
	},
	{
		id: "verify_capability_report",
		summary: "Probe or validate evidence before refreshing a capability report.",
		sideEffects: ["check"],
	},
	{
		id: "research_complete_unverified",
		summary:
			"Docs lookup finished but did not refresh runtime truth; routing stays closed.",
		sideEffects: ["check"],
	},
	{
		id: "verify_auth_session",
		summary:
			"Verify target origin, profile identity, and account/session match before retrying routing.",
		sideEffects: ["check"],
	},
	{
		id: "verify_target_origin",
		summary: "Verify target page/origin evidence before retrying routing.",
		sideEffects: ["check"],
	},
	{
		id: "change_route_input",
		summary: "Correct the supplied evidence envelope, mode, or bundle.",
		sideEffects: ["check"],
	},
] as const;

export const browserAdapterRouterSuccessActions = [
	{
		id: "use_selected_browser_adapter",
		summary:
			"Use the Router-selected Browser Adapter under the emitted route validity constraints.",
		sideEffects: ["check"],
	},
] as const;

// Prepare recovery + success runtime actions (plan R6). The four failure ids are
// emitted in dependency order: prove warm Chrome, discover a capability report,
// prove adapter attachment, then correct prepare input. The success id signals
// the assembled envelope is ready for `route`.
export const browserAdapterRouterPrepareFailureActions = [
	{
		id: "prove_warm_chrome",
		summary:
			"Run Warm Chrome Preflight and pass its proof to prepare --warm-chrome-proof.",
		sideEffects: ["check"],
	},
	{
		id: "discover_capability_report",
		summary:
			"Discover or validate an adapter capability report, then pass it to prepare --report.",
		sideEffects: ["check"],
	},
	{
		id: "prove_adapter_attachment",
		summary:
			"Run Browser Adapter Proof and pass its proof to prepare --adapter-proof.",
		sideEffects: ["check"],
	},
	{
		id: "change_prepare_input",
		summary: "Correct prepare policy, bundle, capability, or input envelopes.",
		sideEffects: ["check"],
	},
] as const;

export const browserAdapterRouterPrepareSuccessActions = [
	{
		id: "route_prepared_evidence",
		summary:
			"Pass the prepared evidence envelope to browser-adapter-router route.",
		sideEffects: ["check"],
	},
] as const;

export const browserAdapterRouterContracts = defineCommandFacadeContract(
	{
		prepare: {
			script: "scripts/browser-adapter-router.ts",
			summary:
				"Assemble route evidence from proof, report, and task facts; emit a route-ready envelope or dependency-ordered recovery.",
			usage: [
				"prepare [--warm-chrome-proof <path>] [--adapter-proof <path>] [--report <path>]... [--target-discovery <path>] [--mode <mode>] [--adapter <id>] [--fallback-allowed] [--bundle <id>] [--capability <id>]... [--target-origin <origin>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			// prepare reads supplied proof/report envelopes and assembles route
			// evidence; it never runs preflight, proof, report, or discovery (R7).
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: routerPrepareEnvVars,
			resultContract: routerResultContract,
			actionAffordances: {
				success: browserAdapterRouterPrepareSuccessActions,
				failure: browserAdapterRouterPrepareFailureActions,
			},
			flags: routerPrepareFlags,
			exitCodes: routerExitCodes,
		},
		route: {
			script: "scripts/browser-adapter-router.ts",
			summary:
				"Select a Browser Adapter from a supplied evidence envelope without probing. Get the envelope from `prepare`.",
			usage: [
				"route [--envelope <path>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: routerEnvelopeEnvVars,
			resultContract: routerResultContract,
			actionAffordances: {
				success: browserAdapterRouterSuccessActions,
				failure: browserAdapterRouterFailureActions,
			},
			flags: routerEnvelopeFlags,
			exitCodes: routerExitCodes,
		},
		report: {
			script: "scripts/browser-adapter-router.ts",
			summary:
				"Discover and validate one adapter capability report from registry or manifest.",
			usage: [
				"report --adapter <id> [--capability <id>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			// V1 report is pure in-process lookup (env self-report JSON or static
			// manifest); no network I/O. Declared check-only to match reality. A
			// future executable self-report command vector would reintroduce
			// `network` here.
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: routerReportEnvVars,
			resultContract: routerResultContract,
			actionAffordances: {
				success: browserAdapterRouterSuccessActions,
				failure: browserAdapterRouterFailureActions,
			},
			flags: routerReportFlags,
			exitCodes: routerExitCodes,
		},
		status: {
			script: "scripts/browser-adapter-router.ts",
			summary:
				"Project a supplied evidence envelope as a human route decision.",
			usage: [
				"status [--envelope <path>] [--json|--plain]",
			],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: routerEnvelopeEnvVars,
			resultContract: routerResultContract,
			actionAffordances: {
				success: browserAdapterRouterSuccessActions,
				failure: browserAdapterRouterFailureActions,
			},
			flags: routerEnvelopeFlags,
			exitCodes: routerExitCodes,
			alias: {
				command: "route",
				defaultArgs: ["--plain"],
			},
		},
	} as const satisfies Record<
		BrowserAdapterRouterCommand,
		BrowserAdapterRouterCommandContract
	>,
	{
		path: "skills/browser-use/scripts/command-contract.ts",
		writeImplyingMutations: new Set(["write", "browser"]),
	},
);
