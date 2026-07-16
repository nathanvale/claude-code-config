import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";

// The Warm Chrome browser-entry proof contract id + schema version are owned by
// @side-quest/warm-chrome (WARM_CHROME_CONTRACT_ID / WARM_CHROME_SCHEMA_VERSION);
// browser-use's front door delegates to that package. Import from the package
// where the contract id is needed rather than re-declaring it here.
//
// The Browser Adapter Proof, Browser Adapter Map, and Browser Adapter Router
// command surfaces were deleted by the browser-use migration cleanup (U3):
// browser-connect's Verified Handoff Envelope replaced their evidence chain.
// This registry now names the adapters with an implemented browser-use
// discovery/operation transport (previously the proof-scope registry).
export const BROWSER_ADAPTER_PROOF_ADAPTERS = ["chrome-devtools"] as const;

// ---------------------------------------------------------------------------
// Browser Adapter vocabulary (plan 2026-06-02-004, retained R9 cluster)
//
// Package-owned literals the surviving router engine/model/recovery files and
// the browser-use surface still import (adapter ids, capability names, report
// states, diagnostic codes, runtime action ids). The Router CLI contract that
// exposed them retired with the browser-adapter-router command surface.
// ---------------------------------------------------------------------------

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

// Recovery + success runtime actions (plan Recovery Semantics). Action ids are
// the stable continuation.next_action_id vocabulary of the retained R9 router
// engine/recovery files; no surviving command contract exposes them.
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
			"Pass the prepared evidence envelope to the Router route evaluation (retained R9 engine cluster; the Router CLI surface is retired).",
		sideEffects: ["check"],
	},
] as const;

// ---------------------------------------------------------------------------
// Browser Use CLI (plan 2026-06-04-001, U3)
//
// Contract shell for the `browser-use` surface. Router prepares/routes; this
// surface owns live Browser Targets and Browser Operations (KTD3). U3 declares
// the full command surface, help, parser acceptance, and result contracts; the
// subcommand bodies emit dry-run/mock envelopes or structured not-implemented
// results until U5/U6/U7 land live logic. No live browser calls here.
// ---------------------------------------------------------------------------

export const BROWSER_USE_TARGETS_CONTRACT_ID =
	"browser-use.browser-targets" as const;
// v2 (browser-use migration U1): the discovery binding derives from the
// browser-connect Verified Handoff Envelope (handoff_evidence_id replaces the
// Router-era adapter_proof_id / warm_chrome_run_id / route_evidence_hash
// tuple), the mode renamed route-bound -> handoff-bound (KTD2), and the
// success envelope self-describes contract identity in data.
export const BROWSER_USE_TARGETS_SCHEMA_VERSION = "2" as const;
export const BROWSER_USE_OPERATION_CONTRACT_ID =
	"browser-use.browser-operation" as const;
// v2 (browser-use migration U1): operation binding fields derive from the
// Verified Handoff Envelope.
export const BROWSER_USE_OPERATION_SCHEMA_VERSION = "2" as const;

// ---------------------------------------------------------------------------
// browser-connect Verified Handoff Envelope — consumer-side pin (KTD1).
//
// browser-use derives its binding identity (adapter, endpoint identity, run
// id) from envelope fields. The contract id and schema version are pinned
// here, NOT imported from browser-connect: the pin is the drift tripwire —
// when browser-connect revs its envelope schema, browser-use fails closed
// with a typed rejection instead of silently parsing a shape it never proved.
// ---------------------------------------------------------------------------

export const BROWSER_CONNECT_HANDOFF_CONTRACT_ID =
	"browser-connect.verified-handoff" as const;
export const BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION = "1" as const;

// browser-connect attachment adapter ids mapped to browser-use adapter ids
// (mcporter server names). Adapter choice is browser-use operational policy:
// an attachment naming an unmapped adapter fails closed rather than guessing
// a transport.
export const BROWSER_CONNECT_ATTACHMENT_ADAPTERS = {
	"chrome-devtools-mcp": "chrome-devtools",
	"agent-browser": "agent-browser",
} as const satisfies Record<string, BrowserAdapterRouterAdapter>;

// Operation capabilities browser-use's transport can honor per adapter. The
// Verified Handoff Envelope authorizes an attachment, not capabilities;
// capability policy stays browser-use-owned and is enforced through the
// surviving router engine's authorizesOperationClass. Adapters without an
// implemented operation transport authorize nothing.
export const BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES = {
	"chrome-devtools": [
		"snapshot_refs",
		"screenshot_media",
		"viewport_emulation",
	],
	"agent-browser": [],
	"playwright-cdp": [],
} as const satisfies Record<
	BrowserAdapterRouterAdapter,
	readonly BrowserAdapterRouterCapability[]
>;

// Command families and their subcommands. Public surface is `browser-use
// <family> <subcommand>`; facade contract keys flatten to `<family>-<sub>`.
export const BROWSER_USE_TARGETS_SUBCOMMANDS = [
	"list",
	"select",
	"status",
] as const;
export type BrowserUseTargetsSubcommand =
	(typeof BROWSER_USE_TARGETS_SUBCOMMANDS)[number];

export const BROWSER_USE_OPERATE_SUBCOMMANDS = [
	"snapshot",
	"screenshot",
	"emulate",
] as const;
export type BrowserUseOperateSubcommand =
	(typeof BROWSER_USE_OPERATE_SUBCOMMANDS)[number];

export const BROWSER_USE_FAMILIES = ["targets", "operate"] as const;
export type BrowserUseFamily = (typeof BROWSER_USE_FAMILIES)[number];

// Browser Target Discovery modes (migration U1, KTD2). handoff-bound replaced
// route-bound: the mode's evidence is a browser-connect Verified Handoff
// Envelope, not a Router route artifact; keeping "route-bound" would silently
// re-ground "route" onto browser-connect's attachment route.
export const BROWSER_USE_TARGET_DISCOVERY_MODES = [
	"recovery",
	"handoff-bound",
] as const;
export type BrowserUseTargetDiscoveryMode =
	(typeof BROWSER_USE_TARGET_DISCOVERY_MODES)[number];

export type BrowserUseCommand =
	| "targets-list"
	| "targets-select"
	| "targets-status"
	| "operate-snapshot"
	| "operate-screenshot"
	| "operate-emulate";

// Stable diagnostic codes the contract shell emits. Live target/operation
// failure codes land with U5/U6/U7; these cover the shell scenarios plus the
// U4 shared mcporter transport (operation-side parity with Adapter Proof's
// adapter_dependency_missing / adapter_command_override_invalid).
export const BROWSER_USE_DIAGNOSTIC_CODES = [
	"browser_use_not_implemented",
	"browser_use_mock_failure",
	"browser_operation_dependency_missing",
	"browser_operation_command_override_invalid",
	"browser_operation_transport_timeout",
	"browser_operation_transport_failed",
	// Verified Handoff Envelope evidence failures (migration U1): an invalid,
	// failed, or drift-rejected envelope and a caller run id disagreeing with
	// the envelope run id each map to their own recovery.
	"browser_operation_handoff_invalid",
	"browser_operation_run_mismatch",
	"browser_operation_capability_unauthorized",
	"browser_operation_artifact_path_required",
	"browser_operation_artifact_path_unsafe",
	"browser_operation_artifact_root_unwritable",
	"browser_operation_viewport_invalid",
	"browser_operation_target_ambiguous",
	"browser_operation_target_no_match",
	"browser_operation_target_missing",
	"browser_operation_target_moved",
	// Browser Target Discovery (U5, evidence re-based on the Verified Handoff
	// Envelope in migration U1). Distinct codes so empty / mismatched-evidence /
	// missing-evidence outcomes each map to their own recovery, never to a wrong
	// or silent success (handoff envelope-mapping class).
	"target_discovery_handoff_invalid",
	"target_discovery_handoff_mismatch",
	"target_discovery_run_mismatch",
	"target_discovery_input_invalid",
	"target_discovery_no_candidates",
	"target_discovery_dependency_missing",
	"target_discovery_transport_timeout",
	"target_discovery_transport_failed",
	"target_discovery_command_override_invalid",
	// Browser Target Selection (U6). `targets select` resolves a handoff-bound
	// discovery envelope to one candidate and writes run-scoped state; `targets
	// status` projects it. Each distinct cause maps to its own code + continuation
	// so selection and state failures never resolve silently to success or the
	// wrong recovery (handoff envelope-mapping class).
	//
	// Selection-time (targets select):
	"target_selection_envelope_invalid",
	"target_selection_recovery_rejected",
	"target_selection_candidate_invalid",
	"target_selection_hint_ambiguous",
	"target_selection_hint_no_match",
	"target_selection_state_path_missing",
	"target_selection_state_write_failed",
	// State-read-time (targets status, and operation-time resolution U7 reuses):
	"target_state_missing",
	"target_state_unreadable",
	"target_state_stale",
	"target_state_mismatch",
	"target_state_cross_run",
] as const;
export type BrowserUseDiagnosticCode =
	(typeof BROWSER_USE_DIAGNOSTIC_CODES)[number];

// Browser Target Discovery runtime action ids (plan U5, envelope-era
// vocabulary from migration U1). The stable continuation.next_action_id
// vocabulary `targets list` emits on recovery. supply_verified_handoff /
// refresh_verified_handoff are the evidence continuations; the rest cover
// dependency, transport, and empty-candidate recovery.
export const browserUseTargetDiscoveryFailureActions = [
	{
		id: "supply_verified_handoff",
		summary:
			"Run browser-connect connect <adapter> --json and pass the Verified Handoff Envelope to targets list --handoff.",
		sideEffects: ["check"],
	},
	{
		id: "refresh_verified_handoff",
		summary:
			"Re-run browser-connect connect for the requested adapter; the supplied handoff envelope does not match it.",
		sideEffects: ["check"],
	},
	{
		id: "open_browser_target",
		summary:
			"Open or navigate a Browser Target matching the task, then re-run targets list.",
		sideEffects: ["check"],
	},
	{
		id: "configure_target_dependency",
		summary:
			"Expose mcporter on PATH or configure an explicit mcporter command vector, then re-run targets list.",
		sideEffects: ["check"],
	},
	{
		id: "inspect_target_discovery_diagnostics",
		summary:
			"Stop and inspect target discovery diagnostics before retrying.",
		sideEffects: ["check"],
	},
	{
		id: "change_target_discovery_input",
		summary: "Correct targets list mode, adapter, or handoff arguments.",
		sideEffects: ["check"],
	},
] as const;

export const browserUseTargetDiscoverySuccessActions = [
	{
		id: "select_browser_target",
		summary:
			"Select one handoff-bound Browser Target Candidate with browser-use targets select.",
		sideEffects: ["check"],
	},
	{
		id: "connect_verified_browser",
		summary:
			"Mint a Verified Handoff Envelope with browser-connect connect <adapter> --json, then re-run targets list --mode handoff-bound.",
		sideEffects: ["check"],
	},
] as const;

// Browser Target Selection runtime action ids (plan U6). The stable
// continuation.next_action_id vocabulary `targets select` and `targets status`
// emit. refine_target_hint / choose_target_candidate are the ambiguity
// continuations the plan names (R, AE6); refresh_target_selection is the stale-
// state continuation (AE in U7); rerun_route_bound_target_discovery is reused
// from discovery for stale/cross-run target evidence. change_selection_input
// covers usage and recoverable input correction.
export const browserUseTargetSelectionFailureActions = [
	{
		id: "refine_target_hint",
		summary:
			"Add or narrow a Browser Target Hint (origin, URL substring, title substring) so it matches exactly one candidate, then re-run targets select.",
		sideEffects: ["check"],
	},
	{
		id: "choose_target_candidate",
		summary:
			"Pick one candidate ordinal from the handoff-bound targets list envelope, then re-run targets select.",
		sideEffects: ["check"],
	},
	{
		id: "refresh_target_selection",
		summary:
			"Re-run targets select to refresh the run-scoped selected-target state; the current state is stale or no longer valid.",
		sideEffects: ["check"],
	},
	{
		// Shared continuation id across the selection and operation surfaces; keep
		// the summary identical so one next_action_id never documents two different
		// recovery prose strings.
		id: "rerun_handoff_bound_target_discovery",
		summary:
			"Supply a fresh browser-connect Verified Handoff Envelope, then re-run targets list --mode handoff-bound.",
		sideEffects: ["check"],
	},
	{
		id: "repair_target_state",
		summary:
			"Repair or remove the run-scoped selected-target state file, then re-run targets select.",
		sideEffects: ["write"],
	},
	{
		id: "change_selection_input",
		summary:
			"Correct targets select handoff, candidate, hint, or state arguments.",
		sideEffects: ["check"],
	},
] as const;

export const browserUseTargetSelectionSuccessActions = [
	{
		id: "operate_selected_browser_target",
		summary:
			"Run a Browser Operation (browser-use operate) against the run-scoped selected Browser Target.",
		sideEffects: ["check"],
	},
	{
		id: "inspect_selected_target_state",
		summary:
			"Inspect the run-scoped selected Browser Target state with browser-use targets status.",
		sideEffects: ["check"],
	},
] as const;

export const browserUseOperationFailureActions = [
	{
		id: "supply_verified_handoff",
		summary:
			"Run browser-connect connect <adapter> --json and pass the Verified Handoff Envelope to browser-use operate --handoff.",
		sideEffects: ["check"],
	},
	{
		id: "rerun_handoff_bound_target_discovery",
		summary:
			"Supply a fresh browser-connect Verified Handoff Envelope, then re-run targets list --mode handoff-bound.",
		sideEffects: ["check"],
	},
	{
		id: "refine_target_hint",
		summary:
			"Add or narrow a Browser Target Hint (origin, URL substring, title substring) so it matches exactly one candidate, then re-run browser-use operate.",
		sideEffects: ["check"],
	},
	{
		id: "choose_target_candidate",
		summary:
			"Select one candidate from handoff-bound targets list output, then re-run browser-use operate.",
		sideEffects: ["check"],
	},
	{
		id: "refresh_target_selection",
		summary:
			"Re-run targets select to refresh the run-scoped selected-target state; the current state is stale or no longer valid.",
		sideEffects: ["check"],
	},
	{
		id: "repair_target_state",
		summary:
			"Repair or remove the run-scoped selected-target state file, then re-run browser-use operate.",
		sideEffects: ["write"],
	},
	{
		id: "change_selection_input",
		summary:
			"Correct selected-target state input, then re-run browser-use operate.",
		sideEffects: ["check"],
	},
	{
		id: "configure_operation_dependency",
		summary:
			"Expose mcporter on PATH or configure an explicit mcporter command vector, then re-run browser-use operate.",
		sideEffects: ["check"],
	},
	{
		id: "inspect_operation_diagnostics",
		summary: "Stop and inspect Browser Operation diagnostics before retrying.",
		sideEffects: ["check"],
	},
	{
		id: "change_operation_input",
		summary:
			"Correct browser-use operate handoff, target, artifact, or viewport arguments.",
		sideEffects: ["check"],
	},
] as const;

export const browserUseOperationSuccessActions = [
	{
		id: "inspect_operation_result",
		summary: "Read the Browser Operation result and continue the task.",
		sideEffects: ["check"],
	},
] as const;

type BrowserUseAudience = "agent" | "operator";
type BrowserUseMutation = "check" | "browser";
type BrowserUseCommandContract = CommandFacadeContract<
	BrowserUseCommand,
	BrowserUseAudience,
	BrowserUseMutation
>;

const browserUseOutputFlags = {
	"--json": { type: "boolean", description: "Emit JSON envelope." },
	"--plain": { type: "boolean", description: "Emit stable text." },
} as const satisfies BrowserUseCommandContract["flags"];

// --dry-run + the mock-outcome env exercise success and failure envelopes
// without any live browser call (R7-shell). --handoff is the binding evidence
// every live surface consumes: the browser-connect Verified Handoff Envelope.
const browserUseHandoffFlags = {
	"--handoff": {
		type: "path",
		description:
			"browser-connect Verified Handoff Envelope JSON file (from browser-connect connect <adapter> --json, or the run wrapper's stderr envelope).",
	},
	"--dry-run": {
		type: "boolean",
		description: "Emit a mock envelope without any live browser call.",
	},
	...browserUseOutputFlags,
} as const satisfies BrowserUseCommandContract["flags"];

const browserUseTargetsListFlags = {
	"--mode": {
		type: "enum",
		values: BROWSER_USE_TARGET_DISCOVERY_MODES,
		description:
			"Discovery mode: recovery (requested adapter + optional handoff evidence) or handoff-bound (verified handoff envelope).",
	},
	"--adapter": {
		type: "enum",
		values: BROWSER_ADAPTER_ROUTER_ADAPTERS,
		description: "Requested Browser Adapter id for recovery-mode discovery.",
	},
	"--show-url": {
		type: "boolean",
		description: "Display origin and redacted path shape only.",
	},
	...browserUseHandoffFlags,
} as const satisfies BrowserUseCommandContract["flags"];

const browserUseTargetsSelectFlags = {
	"--state": {
		type: "path",
		description: "Run-scoped selected-target state file.",
	},
	"--origin": {
		type: "string",
		description: "Browser Target Hint: target origin.",
	},
	"--url-contains": {
		type: "string",
		description: "Browser Target Hint: URL substring.",
	},
	"--title-contains": {
		type: "string",
		description: "Browser Target Hint: title substring.",
	},
	"--candidate": {
		type: "string",
		description: "Candidate ordinal scoped to one target envelope.",
	},
	...browserUseHandoffFlags,
} as const satisfies BrowserUseCommandContract["flags"];

const browserUseTargetsStatusFlags = {
	"--state": {
		type: "path",
		description: "Run-scoped selected-target state file.",
	},
	...browserUseOutputFlags,
} as const satisfies BrowserUseCommandContract["flags"];

// --verbose is facade-reserved (CLI diagnostic). Operations read its parsed
// value from the diagnostic layer; it is not declared as a command flag.
const browserUseOperateCommonFlags = {
	"--origin": {
		type: "string",
		description: "Browser Target Hint: target origin.",
	},
	"--url-contains": {
		type: "string",
		description: "Browser Target Hint: URL substring.",
	},
	"--title-contains": {
		type: "string",
		description: "Browser Target Hint: title substring.",
	},
	"--state": {
		type: "path",
		description: "Run-scoped selected-target state file.",
	},
	...browserUseHandoffFlags,
} as const satisfies BrowserUseCommandContract["flags"];

const browserUseSnapshotFlags = {
	...browserUseOperateCommonFlags,
} as const satisfies BrowserUseCommandContract["flags"];

const browserUseScreenshotFlags = {
	"--out": {
		type: "path",
		description: "Run-scoped artifact path for the screenshot.",
	},
	"--full-page": {
		type: "boolean",
		description: "Capture the full scrollable page.",
	},
	"--bring-to-front": {
		type: "boolean",
		description: "Record explicit focus side effect before capture.",
	},
	...browserUseOperateCommonFlags,
} as const satisfies BrowserUseCommandContract["flags"];

const browserUseEmulateFlags = {
	"--width": { type: "string", description: "Viewport width in CSS pixels." },
	"--height": { type: "string", description: "Viewport height in CSS pixels." },
	"--dpr": { type: "string", description: "Device pixel ratio." },
	"--mobile": { type: "boolean", description: "Emulate a mobile device." },
	"--touch": { type: "boolean", description: "Emulate touch input." },
	"--landscape": { type: "boolean", description: "Emulate landscape orientation." },
	"--bring-to-front": {
		type: "boolean",
		description: "Record explicit focus side effect.",
	},
	...browserUseOperateCommonFlags,
} as const satisfies BrowserUseCommandContract["flags"];

const browserUseEnvVars = [
	{ name: "BROWSER_USE_RUN_ID", description: "Optional run correlation id." },
	{
		name: "BROWSER_USE_MOCK_OUTCOME",
		description:
			"Dry-run mock outcome selector: success (default) or failure. Used only with --dry-run.",
	},
	{
		name: "BROWSER_USE_MCPORTER_COMMAND_JSON",
		description:
			"Optional mcporter command vector as a JSON array of non-empty strings (e.g. [\"bunx\",\"mcporter\"]). Shared with Browser Adapter Proof; no shell strings, no package-runner fallback.",
	},
] as const satisfies BrowserUseCommandContract["envVars"];

const browserUseScreenshotEnvVars = [
	...browserUseEnvVars,
	{
		name: "BROWSER_USE_ARTIFACT_ROOT",
		description:
			"Optional absolute run-scoped root for browser-use screenshot artifacts. When unset, operate screenshot uses a temp run-scoped root derived from the run id.",
	},
] as const satisfies BrowserUseCommandContract["envVars"];

// Run-scoped selected-target state path env vars (plan U6). `--state` wins; when
// absent the state path is derived deterministically from this base directory
// and the run id (BROWSER_USE_TARGET_STATE_DIR + run id). Shared by select
// (writes) and status (reads); a state file is never placed implicitly with
// neither a flag nor a base dir supplied.
const browserUseStateEnvVars = [
	...browserUseEnvVars,
	{
		name: "BROWSER_USE_TARGET_STATE_DIR",
		description:
			"Base directory for run-scoped selected-target state when --state is omitted. The state path is derived deterministically from this directory and the run id.",
	},
] as const satisfies BrowserUseCommandContract["envVars"];

// `targets select` also accepts the handoff-bound `targets list` success
// envelope to resolve against: piped on stdin, or inline via this env var (env
// overridden by stdin when both are present). The envelope is the candidate
// source; --handoff, when supplied, is cross-checked against its binding and
// must agree.
const browserUseSelectEnvVars = [
	...browserUseStateEnvVars,
	{
		name: "BROWSER_USE_TARGETS_ENVELOPE_JSON",
		description:
			"Inline handoff-bound targets list success envelope JSON to select against; overridden by piped stdin.",
	},
] as const satisfies BrowserUseCommandContract["envVars"];

const browserUseExitCodes = {
	"0": "Browser Targets listed or Browser Operation completed.",
	"1": "Runtime dependency failed.",
	"2": "Usage error.",
	"20": "Route/proof/target binding failed closed.",
} as const satisfies BrowserUseCommandContract["exitCodes"];

const browserUseTargetsResultContract = {
	id: BROWSER_USE_TARGETS_CONTRACT_ID,
	kind: "Browser Target discovery and selection result.",
	schema_version: BROWSER_USE_TARGETS_SCHEMA_VERSION,
} as const satisfies NonNullable<BrowserUseCommandContract["resultContract"]>;

const browserUseOperationResultContract = {
	id: BROWSER_USE_OPERATION_CONTRACT_ID,
	kind: "Normalized Browser Operation result.",
	schema_version: BROWSER_USE_OPERATION_SCHEMA_VERSION,
} as const satisfies NonNullable<BrowserUseCommandContract["resultContract"]>;

export const browserUseContracts = defineCommandFacadeContract(
	{
		"targets-list": {
			script: "browser-use",
			summary:
				"List handoff-bound or recovery Browser Target Candidates. Get the Verified Handoff Envelope from browser-connect connect <adapter> --json.",
			usage: [
				"targets list --mode handoff-bound --handoff <path> [--show-url] [--json|--plain]",
				"targets list --mode recovery --adapter <id> [--handoff <path>] [--show-url] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			// Discovery reads live tab state but writes no local state; check-only.
			mutation: "check",
			sideEffects: ["check", "browser"],
			executionModes: ["normal"],
			previewExemption: {
				reason: "Target discovery reads live browser tab state.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUseEnvVars,
			resultContract: browserUseTargetsResultContract,
			flags: browserUseTargetsListFlags,
			exitCodes: browserUseExitCodes,
		},
		"targets-select": {
			script: "browser-use",
			summary:
				"Select one handoff-bound Browser Target into run-scoped state using hints or a candidate ordinal. Pipe the handoff-bound targets list success envelope on stdin.",
			usage: [
				"targets list --mode handoff-bound --handoff <path> --json | targets select --candidate <ordinal> [--state <path>] [--json|--plain]",
				"targets select [--state <path>] [--origin <origin>] [--url-contains <s>] [--title-contains <s>] [--candidate <ordinal>] [--handoff <path>] [--dry-run] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason: "Select writes run-scoped selected-target state.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUseSelectEnvVars,
			resultContract: browserUseTargetsResultContract,
			actionAffordances: {
				success: browserUseTargetSelectionSuccessActions,
				failure: browserUseTargetSelectionFailureActions,
			},
			flags: browserUseTargetsSelectFlags,
			exitCodes: browserUseExitCodes,
		},
		"targets-status": {
			script: "browser-use",
			summary:
				"Show the run-scoped selected Browser Target state as a human projection.",
			usage: ["targets status [--state <path>] [--json|--plain]"],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUseStateEnvVars,
			resultContract: browserUseTargetsResultContract,
			actionAffordances: {
				success: browserUseTargetSelectionSuccessActions,
				failure: browserUseTargetSelectionFailureActions,
			},
			flags: browserUseTargetsStatusFlags,
			exitCodes: browserUseExitCodes,
		},
		"operate-snapshot": {
			script: "browser-use",
			summary:
				"Capture a normalized accessibility snapshot of the resolved Browser Target. Requires a browser-connect Verified Handoff Envelope.",
			usage: [
				"operate snapshot [--origin <origin>] [--url-contains <s>] [--title-contains <s>] [--state <path>] [--handoff <path>] [--verbose] [--dry-run] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			// Snapshot reads live page content but writes no local state.
			mutation: "check",
			sideEffects: ["check", "browser"],
			executionModes: ["normal"],
			previewExemption: {
				reason: "Snapshot reads live page content.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUseEnvVars,
			resultContract: browserUseOperationResultContract,
			actionAffordances: {
				success: browserUseOperationSuccessActions,
				failure: browserUseOperationFailureActions,
			},
			flags: browserUseSnapshotFlags,
			exitCodes: browserUseExitCodes,
		},
		"operate-screenshot": {
			script: "browser-use",
			summary:
				"Capture a screenshot artifact of the resolved Browser Target. Requires a browser-connect Verified Handoff Envelope.",
			usage: [
				"operate screenshot --out <path> [--full-page] [--bring-to-front] [--origin <origin>] [--url-contains <s>] [--title-contains <s>] [--state <path>] [--handoff <path>] [--dry-run] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "browser",
			sideEffects: ["check", "browser", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason: "Screenshot reads live page content and writes an artifact.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUseScreenshotEnvVars,
			resultContract: browserUseOperationResultContract,
			actionAffordances: {
				success: browserUseOperationSuccessActions,
				failure: browserUseOperationFailureActions,
			},
			flags: browserUseScreenshotFlags,
			exitCodes: browserUseExitCodes,
		},
		"operate-emulate": {
			script: "browser-use",
			summary:
				"Emulate viewport metrics on the resolved Browser Target. Requires a Verified Handoff Envelope whose adapter authorizes viewport emulation.",
			usage: [
				"operate emulate [--width <px>] [--height <px>] [--dpr <n>] [--mobile] [--touch] [--landscape] [--bring-to-front] [--origin <origin>] [--url-contains <s>] [--title-contains <s>] [--state <path>] [--handoff <path>] [--dry-run] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			// Emulate changes live viewport metrics but writes no local state.
			mutation: "browser",
			sideEffects: ["check", "browser", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason: "Emulate changes live viewport metrics.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUseEnvVars,
			resultContract: browserUseOperationResultContract,
			actionAffordances: {
				success: browserUseOperationSuccessActions,
				failure: browserUseOperationFailureActions,
			},
			flags: browserUseEmulateFlags,
			exitCodes: browserUseExitCodes,
		},
	} as const satisfies Record<BrowserUseCommand, BrowserUseCommandContract>,
	{
		path: "skills/browser-use/src/command-contract.ts",
		writeImplyingMutations: new Set(["write", "browser"]),
	},
);
