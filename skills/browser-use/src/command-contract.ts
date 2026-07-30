import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import { BROWSER_USE_ADAPTER_LANE_TABLE } from "./browser-use-adapter-model";
import {
	type AdapterCapability,
	type BrowserAdapterId,
	BROWSER_USE_LIVE_ADAPTERS,
} from "./discovery-model";
import { BROWSER_USE_TASK_INTENTS } from "./browser-use-run-model";

// The Warm Chrome browser-entry proof contract id + schema version are owned by
// @side-quest/warm-chrome (WARM_CHROME_CONTRACT_ID / WARM_CHROME_SCHEMA_VERSION);
// browser-use's front door delegates to that package. Import from the package
// where the contract id is needed rather than re-declaring it here.
//
// The Browser Adapter Proof, Browser Adapter Map, and Browser Adapter Router
// command surfaces were deleted by the browser-use migration cleanup (U3):
// browser-connect's Verified Handoff Envelope replaced their evidence chain.
// This literal names the adapters with an implemented browser-use
// discovery/operation transport. It is a pinned tripwire, drift-gated in the
// Adapter Lane Registry tests against transportAdapterIdsFromLaneTable()
// (auth plan U1, R5): the lane table owns which lanes have a registered
// execution Interface; this pin fails the gate if the two ever disagree.
export const BROWSER_USE_TRANSPORT_ADAPTERS = [
	"chrome-devtools-mcp",
	"agent-browser",
	"playwright-cdp",
] as const;

// Adapters with an implemented Browser Target Discovery page-listing transport.
// This is a NARROWER concern than a lane's native operation execution, and the
// two members reach their tab listing through DIFFERENT transports:
//   - chrome-devtools-mcp: the mcporter `list_pages` envelope tool-call.
//   - agent-browser: a CLI-subcommand spawn (`<probe> --cdp <ws> --session
//     browser-use-<runId> tab list --json`), NOT the mcporter list_pages call.
// discoverPages branches on the adapter id so an agent-browser handoff is
// spawned through its own CLI-subcommand shape, never the chrome-devtools-mcp
// tool-call shape. playwright-cdp still has no discovery transport and fails
// closed here. Kept separate from BROWSER_USE_TRANSPORT_ADAPTERS (native
// operation execution / lane-table drift pin) so the transports never conflate.
export const BROWSER_USE_DISCOVERY_TRANSPORT_ADAPTERS = [
	"chrome-devtools-mcp",
	"agent-browser",
] as const;

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

// Platform result contracts (platform plan 2026-07-21-002 U1). One contract
// id per new family; the shared-run projection is the one schema auth and
// platform both consume (R6/R24) — no second run vocabulary exists.
export const BROWSER_USE_TASK_INTENTS_CONTRACT_ID =
	"browser-use.task-intents" as const;
export const BROWSER_USE_TASK_INTENTS_SCHEMA_VERSION = "1" as const;
export const BROWSER_USE_SHARED_RUN_CONTRACT_ID =
	"browser-use.shared-run" as const;
export const BROWSER_USE_SHARED_RUN_SCHEMA_VERSION = "2" as const;
export const BROWSER_USE_RUNBOOK_CATALOG_CONTRACT_ID =
	"browser-use.runbook-catalog" as const;
const BROWSER_USE_RUNBOOK_CATALOG_SCHEMA_VERSION = "1" as const;
// `runbook show` returns one validated runbook definition plus its health
// (platform plan U4, R30/R31). `runbook run` returns the shared-run projection
// exactly like `task run`, so it reuses browserUseSharedRunResultContract.
export const BROWSER_USE_RUNBOOK_DEFINITION_CONTRACT_ID =
	"browser-use.runbook-definition" as const;
const BROWSER_USE_RUNBOOK_DEFINITION_SCHEMA_VERSION = "1" as const;
export const BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID =
	"browser-use.migration-status" as const;
const BROWSER_USE_MIGRATION_STATUS_SCHEMA_VERSION = "1" as const;
export const BROWSER_USE_ARTIFACT_MANIFEST_CONTRACT_ID =
	"browser-use.artifact-manifest" as const;
const BROWSER_USE_ARTIFACT_MANIFEST_SCHEMA_VERSION = "1" as const;
export const BROWSER_USE_REPAIR_STATUS_CONTRACT_ID =
	"browser-use.repair-status" as const;
const BROWSER_USE_REPAIR_STATUS_SCHEMA_VERSION = "1" as const;
// R27 auth repair surface (auth plan U3a): one readiness contract for all
// four continuation commands — each envelope names the dispatched action id,
// its typed evaluation, and exactly one next safe action.
export const BROWSER_USE_AUTH_READINESS_CONTRACT_ID =
	"browser-use.auth-readiness" as const;
export const BROWSER_USE_AUTH_READINESS_SCHEMA_VERSION = "1" as const;
// Adapter Lane Registry projection (auth plan 2026-07-21-003 U1, R27):
// JSON-first lane discovery over the code-owned registry composition.
export const BROWSER_USE_ADAPTER_LANES_CONTRACT_ID =
	"browser-use.adapter-lanes" as const;
export const BROWSER_USE_ADAPTER_LANES_SCHEMA_VERSION = "1" as const;

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
// v2 (platform plan 2026-07-21-002 U1, KTD13): the envelope's environment
// identity carries the named logical profile. This pin bumps atomically with
// browser-connect's schema constant; a v1 envelope now fails closed here.
export const BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION = "2" as const;
/** Exact logical environment identity Browser Connect schema 2 can prove. */
export const BROWSER_CONNECT_ENVIRONMENT_NAME = "agent-chrome" as const;
/** Exact logical profile identity Browser Connect schema 2 can prove. */
export const BROWSER_CONNECT_ENVIRONMENT_PROFILE = "default" as const;

// Operation capabilities browser-use's transport can honor per adapter, keyed
// on the envelope's attachment adapter id verbatim (U4, R4/R5: one adapter
// vocabulary across the seam). Derived from the Adapter Lane Registry's
// code-owned lane table (auth plan U1, R3) — the lane table owns per-lane
// capability vocabulary; this projection just pins it to the public
// AdapterCapability union. The Verified Handoff Envelope authorizes an
// attachment, not capabilities; capability policy stays browser-use-owned and
// is enforced through capability-policy.ts's authorizesOperationClass.
// Adapters without an implemented operation transport authorize nothing.
export const BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES = {
	"chrome-devtools-mcp":
		BROWSER_USE_ADAPTER_LANE_TABLE["chrome-devtools-mcp"].operation_capabilities,
	"agent-browser":
		BROWSER_USE_ADAPTER_LANE_TABLE["agent-browser"].operation_capabilities,
	"playwright-cdp":
		BROWSER_USE_ADAPTER_LANE_TABLE["playwright-cdp"].operation_capabilities,
} as const satisfies Record<BrowserAdapterId, readonly AdapterCapability[]>;

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

// Platform command families (platform plan 2026-07-21-002 U1). `targets` and
// `operate` are the retained live surfaces; the task/run/runbook/migration/
// artifact/repair families are declared contract shells — help, parser
// acceptance, discovery metadata, and result contracts ship now, live bodies
// land with U2-U7. `task list` is live from U1 (a pure projection of the
// code-owned Task Intent catalog).
// `task run` is the Wave-2 front door (release contract R6-R11, R23; flows F1,
// F7). `list` stays the pure Task Intent catalog projection.
const BROWSER_USE_TASK_SUBCOMMANDS = ["list", "run"] as const;
export type BrowserUseTaskSubcommand =
	(typeof BROWSER_USE_TASK_SUBCOMMANDS)[number];

// `lanes list`/`lanes show` are live from auth plan U1: projections of the
// Adapter Lane Registry composition (identity, native Implementation,
// evidence status, honest unproven auth methods).
const BROWSER_USE_LANES_SUBCOMMANDS = ["list", "show"] as const;
export type BrowserUseLanesSubcommand =
	(typeof BROWSER_USE_LANES_SUBCOMMANDS)[number];

const BROWSER_USE_RUN_SUBCOMMANDS = [
	"status",
	"resume",
	"cancel",
] as const;
export type BrowserUseRunSubcommand =
	(typeof BROWSER_USE_RUN_SUBCOMMANDS)[number];

const BROWSER_USE_RUNBOOK_SUBCOMMANDS = ["list", "show", "run"] as const;
export type BrowserUseRunbookSubcommand =
	(typeof BROWSER_USE_RUNBOOK_SUBCOMMANDS)[number];

const BROWSER_USE_MIGRATION_SUBCOMMANDS = [
	"status",
	"inventory",
	"plan",
	"apply",
	"verify",
] as const;
export type BrowserUseMigrationSubcommand =
	(typeof BROWSER_USE_MIGRATION_SUBCOMMANDS)[number];

const BROWSER_USE_ARTIFACT_SUBCOMMANDS = ["list"] as const;
export type BrowserUseArtifactSubcommand =
	(typeof BROWSER_USE_ARTIFACT_SUBCOMMANDS)[number];

const BROWSER_USE_REPAIR_SUBCOMMANDS = ["status", "apply"] as const;
export type BrowserUseRepairSubcommand =
	(typeof BROWSER_USE_REPAIR_SUBCOMMANDS)[number];

// R27 auth repair surface (auth plan U3a; ADR 0028). Each subcommand name IS
// the blocked-cause continuation id from BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE
// (browser-use-auth-model.ts), so an agent holding a blocked run's
// continuation dispatches it verbatim — no mapping table to drift. U3a
// bodies are check-stance evaluations: native custody (token launcher,
// approval broker) is legally absent until U3b, and that absence is a typed
// state, never a crash or a stub.
export const BROWSER_USE_AUTH_SUBCOMMANDS = [
	"enroll-browser-automation-token",
	"repair-vault-grant",
	"repair-item-binding",
	"request-binding-selection-grant",
] as const;
export type BrowserUseAuthSubcommand =
	(typeof BROWSER_USE_AUTH_SUBCOMMANDS)[number];

// Version-matched bundled guidance (agent-first front door, design brief D3:
// docs/plans/2026-07-27-agent-first-front-door-brief.md). The guide ships
// inside the CLI beside the contract it describes — the agent-browser
// `skills get core` pattern — so external skill prose can stay a thin router.
// Bare `browser-use guide` resolves to `guide show` in the parser (the one
// family-default affordance; the root help advertises the bare form).
const BROWSER_USE_GUIDE_SUBCOMMANDS = ["show"] as const;
export type BrowserUseGuideSubcommand =
	(typeof BROWSER_USE_GUIDE_SUBCOMMANDS)[number];

export const BROWSER_USE_GUIDE_TOPICS = [
	"core",
	"recovery",
	"auth",
	"lanes",
	"setup",
] as const;
export type BrowserUseGuideTopic = (typeof BROWSER_USE_GUIDE_TOPICS)[number];

export const BROWSER_USE_FAMILIES = [
	"guide",
	"targets",
	"operate",
	"task",
	"lanes",
	"run",
	"runbook",
	"migration",
	"artifact",
	"repair",
	"auth",
] as const;
export type BrowserUseFamily = (typeof BROWSER_USE_FAMILIES)[number];

// One family -> subcommand table (the parser and help render from this; no
// second copy of the family tree exists anywhere).
export const BROWSER_USE_FAMILY_SUBCOMMANDS = {
	guide: BROWSER_USE_GUIDE_SUBCOMMANDS,
	targets: BROWSER_USE_TARGETS_SUBCOMMANDS,
	operate: BROWSER_USE_OPERATE_SUBCOMMANDS,
	task: BROWSER_USE_TASK_SUBCOMMANDS,
	lanes: BROWSER_USE_LANES_SUBCOMMANDS,
	run: BROWSER_USE_RUN_SUBCOMMANDS,
	runbook: BROWSER_USE_RUNBOOK_SUBCOMMANDS,
	migration: BROWSER_USE_MIGRATION_SUBCOMMANDS,
	artifact: BROWSER_USE_ARTIFACT_SUBCOMMANDS,
	repair: BROWSER_USE_REPAIR_SUBCOMMANDS,
	auth: BROWSER_USE_AUTH_SUBCOMMANDS,
} as const satisfies Record<BrowserUseFamily, readonly string[]>;

// One family -> root-help summary table (rendered by the parser's root help).
export const BROWSER_USE_FAMILY_SUMMARIES = {
	guide: "Version-matched workflow guidance for AI agents (start here).",
	targets: "Browser Target Discovery, Selection, and status.",
	operate: "Browser Operations: snapshot, screenshot, emulate.",
	task: "Code-owned Task Intent catalog.",
	lanes: "Browser Use Adapter Lane Registry discovery.",
	run: "Shared Browser Use run status, resume, and cancel.",
	runbook: "Browser Runbook catalog.",
	migration: "Legacy corpus migration status.",
	artifact: "Run artifact manifest.",
	repair: "Platform repair status and bounded repair execution.",
	auth: "Auth readiness checks: the blocked-cause repair continuations as commands.",
} as const satisfies Record<BrowserUseFamily, string>;

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
	| "guide-show"
	| "targets-list"
	| "targets-select"
	| "targets-status"
	| "operate-snapshot"
	| "operate-screenshot"
	| "operate-emulate"
	| "task-list"
	| "task-run"
	| "lanes-list"
	| "lanes-show"
	| "run-status"
	| "run-resume"
	| "run-cancel"
	| "runbook-list"
	| "runbook-show"
	| "runbook-run"
	| "migration-status"
	| "migration-inventory"
	| "migration-plan"
	| "migration-apply"
	| "migration-verify"
	| "artifact-list"
	| "repair-status"
	| "repair-apply"
	| "auth-enroll-browser-automation-token"
	| "auth-repair-vault-grant"
	| "auth-repair-item-binding"
	| "auth-request-binding-selection-grant";

// Stable diagnostic codes the contract shell emits. Live target/operation
// failure codes land with U5/U6/U7; these cover the shell scenarios plus the
// U4 shared mcporter transport (operation-side parity with Adapter Proof's
// adapter_dependency_missing / adapter_command_override_invalid).
export const BROWSER_USE_DIAGNOSTIC_CODES = [
	"browser_use_not_implemented",
	"browser_use_mock_failure",
	// Adapter Lane Registry resolution failures (auth plan U1, R3/AE1): an
	// unknown lane id and a rejected identity alias each fail closed before any
	// evidence or secret work, with distinct recoveries.
	"browser_lane_unknown",
	"browser_lane_alias_rejected",
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
	// Platform XDG store + shared-run substrate (platform plan U2).
	"xdg_root_relative",
	"xdg_root_unwritable",
	"xdg_root_symlink_ancestor",
	"xdg_root_wrong_owner",
	"xdg_root_permissions_loose",
	"xdg_root_version_controlled",
	"store_cross_device",
	"store_flush_failed",
	"store_lock_contended",
	"store_record_conflict",
	"store_record_corrupt",
	"store_record_missing",
	"store_read_failed",
	"lease_held",
	"lease_fencing_stale",
	"lease_epoch_stale",
	"lease_expired",
	"lease_missing",
	"lease_store_failed",
	"epoch_store_failed",
	"usage_error",
	"runtime_error",
	"run_not_found",
	"run_record_invalid",
	"run_record_corrupt",
	"run_resume_execution_unavailable",
	"run_terminal_truth",
	"retention_collision",
	"artifact_missing",
	"artifact_corrupt",
	"export_destination_unsafe",
	"export_verify_failed",
	"epoch_conflict",
	// Clean-break migration engine refusals (platform plan U3). Each phase
	// (inventory/plan/apply/verify) fails closed with its own typed code so an
	// invalid source, drift after the frozen snapshot, a duplicate YAML key, an
	// incomplete disposition set, a corpus census that drifts from the recorded
	// baseline, a deterministic-generation collision, or a verify mismatch each
	// map to their own recovery — never a silent success.
	"migration_source_invalid",
	"migration_source_drift",
	"migration_state_missing",
	"migration_state_corrupt",
	"migration_yaml_invalid",
	"migration_yaml_duplicate_key",
	"migration_disposition_incomplete",
	"migration_count_drift",
	"migration_collision",
	"migration_verify_failed",
	// R27 auth repair surface (auth plan U3a): dispatching a repair command
	// against a run whose persisted continuation names a DIFFERENT next safe
	// action fails closed — the run's own continuation stays the one truth.
	"auth_continuation_mismatch",
	// Wave-2 task run front door (release contract R6-R11, R23; flows F1, F7).
	// Each routing/dispatch failure class maps to its own recovery, never a
	// silent lane substitution (R10, AE3) or an optimistic retry (R26, F7).
	"task_run_intent_unknown",
	// The requested intent has no registered lane (debug/performance/Lighthouse
	// until their lane lands): honest typed unavailability, never a guessed lane.
	"task_run_intent_unrouted",
	// An explicit --lane override that fails capability + evidence + integrity
	// admission (R10): refused with a repair action, never substituted.
	"task_run_lane_override_inadmissible",
	// The auto-selected lane fails admission for the intent (R6): capability,
	// implementation integrity, or evidence did not satisfy the requested outcome.
	"task_run_no_admissible_lane",
	// The selected lane cannot consume the verified Browser Connect handoff
	// (R3/R10/R11, AE3): browser-use refuses rather than discover or substitute.
	"task_run_handoff_lane_mismatch",
	// A registered lane whose native execution Interface is not implemented:
	// adapter-not-installed repair continuation (R10).
	"task_run_lane_not_installed",
	// The lane's execution interface is registered but browser-use has no
	// dispatch binding for it yet (a lane implemented in the registry table but
	// not wired into the task-run driver): typed, never a crash.
	"task_run_dispatch_unavailable",
	// The lane executor reported a connection-class instability (F7): blocked
	// with a next safe action, carrying the connection diagnostic.
	"task_run_connection_unstable",
	// The lane executor reported an UNKNOWN external effect (R26, F7): terminal
	// unknown truth that blocks retry and adapter switch.
	"task_run_effect_unknown",
	// The lane executor reported the task did not achieve its declared
	// postcondition (not-achieved terminal truth).
	"task_run_not_achieved",
	// The lane refused before dispatch for a task-input reason (invalid task
	// shape, refused origin, confidential input without the auth transaction).
	"task_run_lane_refused",
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
			"Re-run handoff-bound targets list with --adapter <id> to attach automatically, or provide a pre-minted Verified Handoff Envelope with --handoff.",
		sideEffects: ["check"],
	},
	{
		id: "refresh_verified_handoff",
		summary:
			"Re-run handoff-bound targets list with the requested --adapter to attach automatically, or provide a matching pre-minted handoff.",
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
			"Re-run targets list --mode handoff-bound with --adapter <id> to attach automatically.",
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
			"Re-run targets list --mode handoff-bound with --adapter <id> to attach automatically, or supply a fresh pre-minted handoff.",
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
			"Re-run targets list --mode handoff-bound with --adapter <id> to attach automatically, or supply a fresh pre-minted handoff.",
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

// Platform XDG store runtime action ids (platform plan U2). The stable
// continuation.next_action_id vocabulary the store-backed run/artifact/repair
// commands emit. repair_xdg_root is the single AE4 refusal continuation;
// wait_for_lease / refresh_run_revision cover R27 serialization and CAS
// staleness; supply_run_id / inspect_repair_status / change_export_destination
// cover the load, corruption, and export refusal classes.
export const browserUsePlatformStoreFailureActions = [
	{
		id: "repair_xdg_root",
		summary:
			"Fix the named XDG environment variable, ownership, or permissions, then re-run.",
		sideEffects: ["check"],
	},
	{
		id: "wait_for_lease",
		summary:
			"Wait for the named lease holder to finish or expire, then re-run; repair status shows the holder.",
		sideEffects: ["check"],
	},
	{
		id: "refresh_run_revision",
		summary: "Re-read the shared run and retry against its current revision.",
		sideEffects: ["check"],
	},
	{
		id: "supply_run_id",
		summary:
			"Pass an existing shared run id via --run; run status lists known runs.",
		sideEffects: ["check"],
	},
	{
		id: "inspect_repair_status",
		summary:
			"Run browser-use repair status and follow its next safe repair action.",
		sideEffects: ["check"],
	},
	{
		id: "inspect_corrupt_store_record",
		summary:
			"Inspect or restore the named corrupt durable record; bounded repair apply does not rewrite corrupt records.",
		sideEffects: ["check"],
	},
	{
		id: "change_export_destination",
		summary:
			"Pass an absolute export destination outside every browser-use root.",
		sideEffects: ["check"],
	},
] as const;

export const browserUsePlatformStoreSuccessActions = [
	{
		id: "apply_repair",
		summary:
			"Apply the bounded repair plan with browser-use repair apply, then inspect repair status again.",
		sideEffects: ["write"],
	},
	{
		id: "inspect_shared_run",
		summary: "Read the shared run projection and follow its continuation.",
		sideEffects: ["check"],
	},
	{
		id: "resume_shared_run",
		summary:
			"Resume the blocked shared run with browser-use run resume --run <id>.",
		sideEffects: ["check"],
	},
] as const;

// Runbook target repair ids are shared by task-run and runbook-run discovery.
export const browserUseRunbookTargetRepairActions = [
	{
		id: "prepare_unique_runbook_target",
		summary:
			"Leave exactly one admissible runbook tab in the verified session, then retry the original command.",
		sideEffects: ["check"],
	},
	{
		id: "refresh_runbook_handoff",
		summary:
			"Re-mint the verified Agent Browser handoff with browser-connect connect --json, then retry the original runbook command.",
		sideEffects: ["check"],
	},
	{
		id: "restore_bound_runbook_target",
		summary:
			"Restore the runbook's bound tab in the verified session, or start a new run; never rebind the existing run.",
		sideEffects: ["check"],
	},
] as const;

// Wave-2 task run front door runtime action ids (release contract R6-R11, R23;
// flows F1, F7). The stable continuation.next_action_id vocabulary `task run`
// emits. Failure ids name executable recoveries; a refused route or an unknown
// external effect NEVER emits a retry or adapter-switch action (R10, R11, R26).
export const browserUseTaskRunFailureActions = [
	{
		id: "choose_registered_intent",
		summary:
			"Pass an --intent from browser-use task list; the requested intent is not a code-owned Task Intent.",
		sideEffects: ["check"],
	},
	{
		id: "await_intent_lane",
		summary:
			"The requested intent has no registered lane yet; run browser-use task list to see which intents route, and pick one whose lane is registered.",
		sideEffects: ["check"],
	},
	{
		id: "choose_admissible_lane",
		summary:
			"The requested --lane override failed capability, evidence, or integrity admission; drop --lane to auto-route, or pick a lane whose evidence satisfies the intent (browser-use lanes list).",
		sideEffects: ["check"],
	},
	{
		id: "refresh_lane_evidence",
		summary:
			"No lane admits this intent on current evidence; re-run the lane conformance probe (browser-use lanes show --adapter <id>) before retrying.",
		sideEffects: ["check"],
	},
	{
		id: "supply_matching_handoff",
		summary:
			"Mint a Verified Handoff Envelope for the selected lane with browser-connect connect <adapter> --json; the supplied handoff names a different adapter (browser-use never substitutes a lane).",
		sideEffects: ["check"],
	},
	{
		id: "install_lane_adapter",
		summary:
			"The selected lane's native adapter is not installed on this host; install it through browser-connect's adapter-install path, re-probe evidence, then retry — browser-use never substitutes another lane.",
		sideEffects: ["check"],
	},
	{
		id: "inspect_task_run_result",
		summary:
			"Stop and inspect the task run outcome before any further action; an unknown external effect blocks retry and adapter switch (inspect the shared run, then re-prove target state).",
		sideEffects: ["check"],
	},
	{
		id: "change_task_run_input",
		summary:
			"Correct the task run intent, lane, handoff, target, or origin arguments and retry.",
		sideEffects: ["check"],
	},
	...browserUseRunbookTargetRepairActions,
] as const;

export const browserUseTaskRunSuccessActions = [
	{
		id: "inspect_task_run_result",
		summary:
			"Read the task run result, observed external-effect state, selected lane, and continue the task.",
		sideEffects: ["check"],
	},
	{
		id: "resume_shared_run",
		summary:
			"Resume the blocked shared run with browser-use run resume --run <id>.",
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
			"Pre-minted Verified Handoff Envelope JSON file; advanced override for callers already holding connection evidence.",
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
		values: BROWSER_USE_LIVE_ADAPTERS,
		description:
			"Browser Adapter id to attach automatically in handoff-bound mode, or request in recovery mode.",
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

const browserUseRunIdEnvVar = {
	name: "BROWSER_USE_RUN_ID",
	description: "Optional run correlation id.",
} as const;

const browserUseCallerEnvVar = {
	// Non-authoritative caller metadata (platform plan U1, R35): recorded
	// for audit only. Claude Code, Codex, human shells, and external
	// schedulers share one contract; caller identity never changes command
	// semantics, authority, or output schema.
	name: "BROWSER_USE_CALLER",
	description:
		"Optional caller metadata label (e.g. claude-code, codex, launchd) recorded for audit only; never grants authority or changes command semantics.",
} as const;

const browserUseEnvVars = [
	browserUseRunIdEnvVar,
	browserUseCallerEnvVar,
	{
		name: "BROWSER_USE_MOCK_OUTCOME",
		description:
			"Dry-run mock outcome selector: success (default) or failure. Used only with --dry-run.",
	},
	{
		name: "BROWSER_USE_MCPORTER_COMMAND_JSON",
		description:
			"Optional mcporter command vector as a JSON array of non-empty strings (e.g. [\"bunx\",\"mcporter\"]). No shell strings, no package-runner fallback.",
	},
] as const satisfies BrowserUseCommandContract["envVars"];

const browserUsePlatformEnvVars = [
	browserUseRunIdEnvVar,
	browserUseCallerEnvVar,
] as const satisfies BrowserUseCommandContract["envVars"];

// XDG env vars the store-backed platform commands consume (platform plan U2,
// R7/R11). Declared once; browser-use-paths.ts is the one resolution owner —
// this table only names the consumed vars for discovery/help.
const browserUseXdgEnvVars = [
	{
		name: "XDG_CONFIG_HOME",
		description:
			"Absolute Browser Use config base; XDG 0.8 default when empty. Relative values are refused.",
	},
	{
		name: "XDG_DATA_HOME",
		description:
			"Absolute Browser Use data base; XDG 0.8 default when empty. Relative values are refused.",
	},
	{
		name: "XDG_STATE_HOME",
		description:
			"Absolute Browser Use run/artifact state base; XDG 0.8 default when empty. Relative values are refused.",
	},
	{
		name: "XDG_CACHE_HOME",
		description:
			"Absolute Browser Use cache base; XDG 0.8 default when empty. Relative values are refused.",
	},
	{
		// "non-secret locks/sockets" is the R11 wording, but the facade's
		// env-var validator refuses credential-class words in descriptions, so
		// the sensitivity qualifier lives in the paths module docs instead.
		name: "XDG_RUNTIME_DIR",
		description:
			"Absolute runtime dir for lock and socket files; a private warned state fallback applies when absent.",
	},
] as const;

const browserUsePlatformStoreEnvVars = [
	...browserUsePlatformEnvVars,
	...browserUseXdgEnvVars,
] as const satisfies BrowserUseCommandContract["envVars"];

// Run-scoped selected-target state path env vars (plan U6). `--state` wins; when
// absent the state path is derived deterministically from this base directory
// and the run id (BROWSER_USE_TARGET_STATE_DIR + run id). Shared by select
// (writes), status (reads), and operate (reads: when set, operate enforces
// run-scoped selected state instead of the single-candidate fallback); a state
// file is never placed implicitly with neither a flag nor a base dir supplied.
const browserUseStateEnvVars = [
	...browserUseEnvVars,
	{
		name: "BROWSER_USE_TARGET_STATE_DIR",
		description:
			"Base directory for run-scoped selected-target state when --state is omitted. The state path is derived deterministically from this directory and the run id.",
	},
] as const satisfies BrowserUseCommandContract["envVars"];

const browserUseScreenshotEnvVars = [
	...browserUseStateEnvVars,
	{
		name: "BROWSER_USE_ARTIFACT_ROOT",
		description:
			"Optional absolute run-scoped root for browser-use screenshot artifacts. When unset, operate screenshot uses a temp run-scoped root derived from the run id.",
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

// ---------------------------------------------------------------------------
// Platform families (platform plan 2026-07-21-002 U1): shared flags, exit
// codes, and result contracts for task/run/runbook/migration/artifact/repair.
// ---------------------------------------------------------------------------

// --caller mirrors BROWSER_USE_CALLER (flag wins): audit-only caller metadata,
// declared once and shared by every platform-family command.
const browserUsePlatformFlags = {
	"--caller": {
		type: "string",
		description:
			"Caller metadata label recorded for audit only; never grants authority or changes command semantics.",
	},
	...browserUseOutputFlags,
} as const satisfies BrowserUseCommandContract["flags"];

const browserUseRunFlags = {
	"--run": {
		type: "string",
		description: "Shared Browser Use run id to inspect, resume, or cancel.",
	},
	...browserUsePlatformFlags,
} as const satisfies BrowserUseCommandContract["flags"];

// Wave-2 `task run` front door flags (release contract R6-R11, R23; F1, F7).
// --intent selects a code-owned Task Intent; --lane is the explicit override
// that STILL passes capability + evidence admission (R10); --handoff is the
// browser-connect Verified Handoff Envelope the selected lane attaches through
// (R3); --tab/--allowed-origin bound the lane's execution; --run resumes an
// existing durable shared run instead of creating one (R23). The intent enum
// pins BROWSER_USE_TASK_INTENTS (drift-gated in the task-run tests).
const browserUseTaskRunFlags = {
	"--intent": {
		type: "enum",
		values: BROWSER_USE_TASK_INTENTS,
		description:
			"Code-owned Task Intent to route (see browser-use task list). Required unless --run resumes an existing run.",
	},
	"--lane": {
		type: "enum",
		values: BROWSER_USE_LIVE_ADAPTERS,
		description:
			"Explicit lane override; still passes capability + evidence + integrity admission and never substitutes another lane.",
	},
	"--run": {
		type: "string",
		description:
			"Existing shared Browser Use run id to resume instead of creating a new run.",
	},
	"--tab": {
		type: "string",
		description: "Target tab id inside the verified session the lane executes against.",
	},
	"--allowed-origin": {
		type: "string",
		description:
			"Exact HTTP(S) origin the lane task is bounded to (scheme + host + port).",
	},
	"--click-role": {
		type: "string",
		description:
			"Exact accessible role to resolve from the selected lane's current task-local snapshot for one semantic click.",
	},
	"--click-name": {
		type: "string",
		description:
			"Exact accessible name paired with --click-role; zero or multiple current matches refuse before mutation.",
	},
	"--postcondition-id": {
		type: "string",
		description:
			"Bounded stable name for the structural postcondition declared before mutation.",
	},
	"--expect-visible": {
		type: "string",
		description:
			"CSS selector that must be freshly observed visible after the semantic click.",
	},
	"--handoff": {
		type: "path",
		description:
			"Pre-minted Verified Handoff Envelope JSON file (advanced; required to resume with --run). Omitted on a fresh --intent run: the connection attaches automatically (D4). The envelope stays the only attachment route (R3).",
	},
	"--dry-run": {
		type: "boolean",
		description: "Emit a mock envelope without any live browser call.",
	},
	...browserUsePlatformFlags,
} as const satisfies BrowserUseCommandContract["flags"];

// `artifact list --run` narrows the projection to one shared run (platform
// plan U2, R35 "artifacts, retention").
const browserUseArtifactFlags = {
	"--run": {
		type: "string",
		description: "Filter artifacts to one shared run id.",
	},
	...browserUsePlatformFlags,
} as const satisfies BrowserUseCommandContract["flags"];

// Clean-break migration phase flags (platform plan U3). --source names the
// absolute legacy corpus root the phase freezes/validates against; it is
// required for inventory/plan/apply/verify (the parser rejects its absence),
// and unused by `migration status` (a pure state projection). Modeled on
// browserUseArtifactFlags: audit-only --caller plus JSON/plain output.
const browserUseMigrationFlags = {
	"--source": {
		type: "path",
		description:
			"Absolute legacy corpus root for the migration phase. Required for inventory, plan, apply, and verify.",
	},
	...browserUsePlatformFlags,
} as const satisfies BrowserUseCommandContract["flags"];

const browserUsePlatformExitCodes = {
	"0": "Command completed.",
	"1": "Runtime dependency failed or live logic is not implemented.",
	"2": "Usage error.",
	"20": "Run, binding, or evidence state failed closed.",
} as const satisfies BrowserUseCommandContract["exitCodes"];

const browserUseTaskIntentsResultContract = {
	id: BROWSER_USE_TASK_INTENTS_CONTRACT_ID,
	kind: "Code-owned Task Intent catalog.",
	schema_version: BROWSER_USE_TASK_INTENTS_SCHEMA_VERSION,
} as const satisfies NonNullable<BrowserUseCommandContract["resultContract"]>;

const browserUseAdapterLanesResultContract = {
	id: BROWSER_USE_ADAPTER_LANES_CONTRACT_ID,
	kind: "Browser Use Adapter Lane Registry projection.",
	schema_version: BROWSER_USE_ADAPTER_LANES_SCHEMA_VERSION,
} as const satisfies NonNullable<BrowserUseCommandContract["resultContract"]>;

// Lane resolution failures always route back to the registry listing: the
// error data carries valid_lane_ids and this action names the recovery
// command class, so an agent repairs from the envelope alone (R27).
export const browserUseAdapterLanesFailureActions = [
	{
		id: "list_adapter_lanes",
		summary:
			"List the registered adapter lanes and retry with an exact lane id from the listing.",
		sideEffects: ["check"],
	},
] as const;

export const browserUseAdapterLanesSuccessActions = [
	{
		id: "inspect_adapter_lane",
		summary:
			"Inspect one lane's evidence status and next repair action before relying on its claims.",
		sideEffects: ["check"],
	},
] as const;

// `lanes show --adapter` takes the exact handoff attachment.adapter_id; a
// rejected identity alias or unknown id fails closed (auth plan U1, R3).
const browserUseLanesShowFlags = {
	"--adapter": {
		type: "string",
		description:
			"Exact adapter lane id as the Verified Handoff Envelope's attachment.adapter_id spells it.",
	},
	...browserUsePlatformFlags,
} as const satisfies BrowserUseCommandContract["flags"];

const browserUseSharedRunResultContract = {
	id: BROWSER_USE_SHARED_RUN_CONTRACT_ID,
	kind: "Shared Browser Use run projection.",
	schema_version: BROWSER_USE_SHARED_RUN_SCHEMA_VERSION,
} as const satisfies NonNullable<BrowserUseCommandContract["resultContract"]>;

const browserUseRunbookCatalogResultContract = {
	id: BROWSER_USE_RUNBOOK_CATALOG_CONTRACT_ID,
	kind: "Browser Runbook catalog projection.",
	schema_version: BROWSER_USE_RUNBOOK_CATALOG_SCHEMA_VERSION,
} as const satisfies NonNullable<BrowserUseCommandContract["resultContract"]>;

const browserUseRunbookDefinitionResultContract = {
	id: BROWSER_USE_RUNBOOK_DEFINITION_CONTRACT_ID,
	kind: "Browser Runbook definition and health projection.",
	schema_version: BROWSER_USE_RUNBOOK_DEFINITION_SCHEMA_VERSION,
} as const satisfies NonNullable<BrowserUseCommandContract["resultContract"]>;

// `runbook show <service>/<flow>` is a targeted read of one exact runbook
// (never a scan), so both coordinates are hard-required at the parser.
const browserUseRunbookShowFlags = {
	"--service": {
		type: "string",
		description: "Exact runbook service id (a safe lowercase slug).",
	},
	"--flow": {
		type: "string",
		description: "Exact runbook flow id (a safe lowercase slug).",
	},
	...browserUsePlatformFlags,
} as const satisfies BrowserUseCommandContract["flags"];

// `runbook run` compiles one runbook and dispatches it through the agent-browser
// lane. It attaches through the verified handoff (R3), binds a durable shared
// run (--run resumes an existing one, R23/F7), bounds execution to --tab, and
// binds declared runbook inputs via repeatable --input <id>=<value>.
// --allowed-origin is OPTIONAL: the runbook declares allowed_origins itself.
const browserUseRunbookRunFlags = {
	"--service": {
		type: "string",
		description: "Exact runbook service id (a safe lowercase slug).",
	},
	"--flow": {
		type: "string",
		description: "Exact runbook flow id (a safe lowercase slug).",
	},
	"--input": {
		type: "string",
		description:
			"Runbook input binding as <id>=<value>. Repeatable; one per declared runbook input.",
	},
	"--input-file": {
		type: "string",
		description:
			"Private structured input as <id>=<absolute-path>. Repeatable; files must be owner-only beneath the runtime private-input root.",
	},
	"--handoff": {
		type: "path",
		description:
			"Pre-minted Verified Handoff Envelope JSON file for the agent-browser lane (advanced). Omitted: the connection attaches automatically (D4). The envelope stays the only attachment route (R3).",
	},
	"--tab": {
		type: "string",
		description:
			"Exact target tab id. Omit to require one admissible tab in the verified session.",
	},
	"--allowed-origin": {
		type: "string",
		description:
			"Optional extra exact HTTP(S) origin; the runbook already declares its allowed origins.",
	},
	...browserUseRunFlags,
} as const satisfies BrowserUseCommandContract["flags"];

const browserUseMigrationStatusResultContract = {
	id: BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID,
	kind: "Legacy corpus migration status projection.",
	schema_version: BROWSER_USE_MIGRATION_STATUS_SCHEMA_VERSION,
} as const satisfies NonNullable<BrowserUseCommandContract["resultContract"]>;

const browserUseArtifactManifestResultContract = {
	id: BROWSER_USE_ARTIFACT_MANIFEST_CONTRACT_ID,
	kind: "Run artifact manifest projection.",
	schema_version: BROWSER_USE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
} as const satisfies NonNullable<BrowserUseCommandContract["resultContract"]>;

const browserUseRepairStatusResultContract = {
	id: BROWSER_USE_REPAIR_STATUS_CONTRACT_ID,
	kind: "Platform repair status projection.",
	schema_version: BROWSER_USE_REPAIR_STATUS_SCHEMA_VERSION,
} as const satisfies NonNullable<BrowserUseCommandContract["resultContract"]>;

const browserUseAuthReadinessResultContract = {
	id: BROWSER_USE_AUTH_READINESS_CONTRACT_ID,
	kind: "Auth readiness evaluation for one repair continuation.",
	schema_version: BROWSER_USE_AUTH_READINESS_SCHEMA_VERSION,
} as const satisfies NonNullable<BrowserUseCommandContract["resultContract"]>;

// R27 auth runtime action ids (auth plan U3a). The four continuation ids
// double as subcommand names AND runtime actions, so a chained repair (scope
// repair blocked on a missing token) names the exact next command verbatim.
// acquire-native-capability is the honest U3b gate: token enrollment and
// grant signing are native custody this machine does not hold yet (ADR 0028).
export const browserUseAuthRepairActions = [
	{
		id: "inspect-auth-readiness",
		summary:
			"The evaluation passed; inspect run status and follow its continuation.",
		sideEffects: ["check"],
	},
	{
		id: "acquire-native-capability",
		summary:
			"Native auth custody is absent until the signed Browser Use Security product ships (ADR 0028); complete its entry gate, then re-run.",
		sideEffects: ["check"],
	},
	{
		id: "enroll-browser-automation-token",
		summary: "Enroll or repair the Browser Automation service-account token.",
		sideEffects: ["check"],
	},
	{
		id: "repair-vault-grant",
		summary: "Repair the token's vault grant to exactly one visible vault.",
		sideEffects: ["check"],
	},
	{
		id: "repair-item-binding",
		summary: "Repair the revoked or moved item binding; never rescan silently.",
		sideEffects: ["check"],
	},
	{
		id: "request-binding-selection-grant",
		summary: "Request a signed one-use grant to select one login item.",
		sideEffects: ["check"],
	},
] as const;

// Failures reuse the platform store vocabulary (the store is the only
// failure surface these check commands share) plus the continuation-mismatch
// refusal that routes back to the run's own persisted next safe action.
export const browserUseAuthRepairFailureActions = [
	...browserUsePlatformStoreFailureActions,
	{
		id: "follow_run_continuation",
		summary:
			"Read the run's own persisted continuation with run status and dispatch that action instead.",
		sideEffects: ["check"],
	},
] as const;

const browserUseAuthFlags = {
	"--run": {
		type: "string",
		description:
			"Blocked shared run id to bind this evaluation to; the run's persisted continuation must name this command.",
	},
	...browserUsePlatformFlags,
} as const satisfies BrowserUseCommandContract["flags"];

// R11: binding repair is a targeted read of one exact item — never a scan —
// so both coordinates are required.
const browserUseAuthBindingFlags = {
	"--vault-id": {
		type: "string",
		description: "Exact vault id the binding names.",
	},
	"--item-id": {
		type: "string",
		description: "Exact login item id the binding names.",
	},
	...browserUseAuthFlags,
} as const satisfies BrowserUseCommandContract["flags"];

const browserUseAuthSelectionFlags = {
	"--vault-id": {
		type: "string",
		description:
			"Exact vault id whose login items form the selection candidate set.",
	},
	...browserUseAuthFlags,
} as const satisfies BrowserUseCommandContract["flags"];

export const browserUseContracts = defineCommandFacadeContract(
	{
		// Version-matched bundled guidance (design brief D3). Pure render of the
		// bundled guide content module — no browser, no state, no side effects.
		// Bare `browser-use guide` resolves here (parser family-default).
		"guide-show": {
			script: "browser-use",
			summary:
				"Show version-matched workflow guidance for AI agents: the everyday task loop, recovery, auth boundary, lanes, and adapter setup.",
			usage: [
				"guide [show] [--topic core|recovery|auth|lanes|setup] [--full] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["plain", "json"],
			interactivity: "none",
			flags: {
				"--topic": {
					type: "enum",
					values: BROWSER_USE_GUIDE_TOPICS,
					description:
						"Guide topic: core (default), recovery, auth, lanes, or setup.",
				},
				"--full": {
					type: "boolean",
					description:
						"Include the full page-action lifecycle and advanced targets/operate path.",
				},
				...browserUseOutputFlags,
			},
			exitCodes: {
				"0": "Guide rendered.",
				"1": "Runtime failure.",
				"2": "Usage error.",
			},
		},
		"targets-list": {
			script: "browser-use",
			summary:
				"List handoff-bound or recovery Browser Target Candidates. Handoff-bound mode attaches automatically when --handoff is absent.",
			usage: [
				"targets list --mode handoff-bound --adapter <id> [--handoff <path>] [--show-url] [--json|--plain]",
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
			envVars: browserUseStateEnvVars,
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
			envVars: browserUseStateEnvVars,
			resultContract: browserUseOperationResultContract,
			actionAffordances: {
				success: browserUseOperationSuccessActions,
				failure: browserUseOperationFailureActions,
			},
			flags: browserUseEmulateFlags,
			exitCodes: browserUseExitCodes,
		},
		"task-list": {
			script: "browser-use",
			summary:
				"List the code-owned Task Intents with their preferred adapter lanes and lane registration status.",
			usage: ["task list [--caller <label>] [--json|--plain]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformEnvVars,
			resultContract: browserUseTaskIntentsResultContract,
			flags: browserUsePlatformFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"task-run": {
			script: "browser-use",
			summary:
				"Route one Task Intent to an admissible lane, attach through the verified Browser Connect handoff, execute, and return the shared run, observed external-effect state, selected lane, and next safe action.",
			usage: [
				"task run --intent routine-automation --click-role <role> --click-name <name> --postcondition-id <id> --expect-visible <selector> [--handoff <path>] [--tab <id>] --allowed-origin <origin> [--json|--plain]",
				"task run --intent frontend-test --click-role <role> --click-name <name> --postcondition-id <id> --expect-visible <selector> [--handoff <path>] [--tab <index>] --allowed-origin <origin> [--json|--plain]",
				"task run --intent <intent> [--lane <id>] [--handoff <path>] [--tab <id>] [--allowed-origin <origin>] [--caller <label>] [--dry-run] [--json|--plain]",
				"task run --run <id> --handoff <path> [--tab <id>] [--allowed-origin <origin>] [--caller <label>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "browser",
			sideEffects: ["check", "browser", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason:
					"Task run creates or resumes a durable shared run and dispatches live lane execution against the verified handoff.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseSharedRunResultContract,
			actionAffordances: {
				success: browserUseTaskRunSuccessActions,
				failure: browserUseTaskRunFailureActions,
			},
			flags: browserUseTaskRunFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"lanes-list": {
			script: "browser-use",
			summary:
				"List every Browser Use Adapter Lane: exact handoff id, native Implementation, evidence status, and honest unproven auth methods.",
			usage: ["lanes list [--caller <label>] [--json|--plain]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformEnvVars,
			resultContract: browserUseAdapterLanesResultContract,
			actionAffordances: {
				success: browserUseAdapterLanesSuccessActions,
				failure: browserUseAdapterLanesFailureActions,
			},
			flags: browserUsePlatformFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"lanes-show": {
			script: "browser-use",
			summary:
				"Show one Browser Use Adapter Lane by its exact handoff adapter id. Unknown ids and rejected identity aliases fail closed.",
			usage: ["lanes show --adapter <id> [--caller <label>] [--json|--plain]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformEnvVars,
			resultContract: browserUseAdapterLanesResultContract,
			actionAffordances: {
				success: browserUseAdapterLanesSuccessActions,
				failure: browserUseAdapterLanesFailureActions,
			},
			flags: browserUseLanesShowFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"run-status": {
			script: "browser-use",
			summary:
				"Show a shared Browser Use run: state, revision, environment/profile, auth readiness reference, and next safe action.",
			usage: ["run status [--run <id>] [--caller <label>] [--json|--plain]"],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseSharedRunResultContract,
			actionAffordances: {
				success: browserUsePlatformStoreSuccessActions,
				failure: browserUsePlatformStoreFailureActions,
			},
			flags: browserUseRunFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"run-resume": {
			script: "browser-use",
			summary:
				"Resume a blocked shared Browser Use run on the same adapter lane after auth, approval, or restart.",
			usage: ["run resume --run <id> [--caller <label>] [--json|--plain]"],
			json: true,
			audience: "agent",
			mutation: "browser",
			sideEffects: ["check", "browser", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason: "Resume continues the durable shared run in live browser state.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseSharedRunResultContract,
			actionAffordances: {
				success: browserUsePlatformStoreSuccessActions,
				failure: browserUsePlatformStoreFailureActions,
			},
			flags: browserUseRunFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"run-cancel": {
			script: "browser-use",
			summary:
				"Cancel a shared Browser Use run and report the last proven external-effect classification; never claims rollback after dispatch.",
			usage: ["run cancel --run <id> [--caller <label>] [--json|--plain]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason: "Cancel records run state and reports external-effect truth.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseSharedRunResultContract,
			actionAffordances: {
				success: browserUsePlatformStoreSuccessActions,
				failure: browserUsePlatformStoreFailureActions,
			},
			flags: browserUseRunFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"runbook-list": {
			script: "browser-use",
			summary:
				"List discovered Browser Runbooks with service/workflow ids and health status.",
			usage: ["runbook list [--caller <label>] [--json|--plain]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseRunbookCatalogResultContract,
			flags: browserUsePlatformFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"runbook-show": {
			script: "browser-use",
			summary:
				"Show one Browser Runbook definition and its health by exact service/flow id.",
			usage: [
				"runbook show --service <id> --flow <id> [--caller <label>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseRunbookDefinitionResultContract,
			flags: browserUseRunbookShowFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"runbook-run": {
			script: "browser-use",
			summary:
				"Compile one Browser Runbook and dispatch it through the agent-browser lane against a verified handoff; returns the shared run, external-effect state, and next safe action.",
			usage: [
				"runbook run --service <id> --flow <id> [--handoff <path>] [--input <id>=<value>]... [--input-file <id>=<absolute-path>]... [--tab <id>] [--run <id>] [--caller <label>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "browser",
			sideEffects: ["check", "browser", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason:
					"Runbook run creates or resumes a durable shared run and dispatches live agent-browser execution against the verified handoff.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseSharedRunResultContract,
			actionAffordances: {
				success: browserUsePlatformStoreSuccessActions,
				failure: [
					...browserUsePlatformStoreFailureActions,
					...browserUseRunbookTargetRepairActions,
				],
			},
			flags: browserUseRunbookRunFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"migration-status": {
			script: "browser-use",
			summary:
				"Show legacy corpus migration status: snapshot, dispositions, staged generations, and activation state.",
			usage: ["migration status [--caller <label>] [--json|--plain]"],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformEnvVars,
			resultContract: browserUseMigrationStatusResultContract,
			flags: browserUsePlatformFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"migration-inventory": {
			script: "browser-use",
			summary:
				"Freeze the legacy corpus source tree into one immutable source snapshot before any disposition or staging.",
			usage: [
				"migration inventory --source <path> [--caller <label>] [--json|--plain]",
			],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason: "Inventory writes the frozen source snapshot to the durable store.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseMigrationStatusResultContract,
			flags: browserUseMigrationFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"migration-plan": {
			script: "browser-use",
			summary:
				"Assign one complete disposition and provenance row to every frozen source entry; refuses drift, duplicate YAML keys, and quarantined material.",
			usage: [
				"migration plan --source <path> [--caller <label>] [--json|--plain]",
			],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason: "Plan writes the disposition set to the durable migration state.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseMigrationStatusResultContract,
			flags: browserUseMigrationFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"migration-apply": {
			script: "browser-use",
			summary:
				"Stage every planned safe output into one immutable inactive generation; never activates and refuses a colliding deterministic generation.",
			usage: [
				"migration apply --source <path> [--caller <label>] [--json|--plain]",
			],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason:
					"Apply stages an inactive generation to the durable store without activation.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseMigrationStatusResultContract,
			flags: browserUseMigrationFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"migration-verify": {
			script: "browser-use",
			summary:
				"Verify the frozen source, dispositions, provenance, and staged file hashes without activation.",
			usage: [
				"migration verify --source <path> [--caller <label>] [--json|--plain]",
			],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason: "Verify records the verified phase in the durable migration state.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseMigrationStatusResultContract,
			flags: browserUseMigrationFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"artifact-list": {
			script: "browser-use",
			summary:
				"List run artifacts with sensitivity, retention class, and outcome references.",
			usage: ["artifact list [--run <id>] [--caller <label>] [--json|--plain]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseArtifactManifestResultContract,
			actionAffordances: {
				success: browserUsePlatformStoreSuccessActions,
				failure: browserUsePlatformStoreFailureActions,
			},
			flags: browserUseArtifactFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"repair-status": {
			script: "browser-use",
			summary:
				"Show platform repair state: unsafe stores, stale leases, and the next safe repair action.",
			usage: ["repair status [--caller <label>] [--json|--plain]"],
			json: true,
			audience: "operator",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseRepairStatusResultContract,
			actionAffordances: {
				success: browserUsePlatformStoreSuccessActions,
				failure: browserUsePlatformStoreFailureActions,
			},
			flags: browserUsePlatformFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"repair-apply": {
			script: "browser-use",
			summary:
				"Apply pending artifact tombstones and remove recognized orphan temp files; refuses while a live lease exists.",
			usage: ["repair apply [--caller <label>] [--json|--plain]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason:
					"Repair status is the read-only preview; apply executes only its bounded repair classes.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseRepairStatusResultContract,
			actionAffordances: {
				success: browserUsePlatformStoreSuccessActions,
				failure: browserUsePlatformStoreFailureActions,
			},
			flags: browserUsePlatformFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"auth-enroll-browser-automation-token": {
			script: "browser-use",
			summary:
				"Evaluate Browser Automation token custody: operational, broken, or the typed native-capability-absent state (ADR 0028).",
			usage: [
				"auth enroll-browser-automation-token [--run <id>] [--caller <label>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseAuthReadinessResultContract,
			actionAffordances: {
				success: browserUseAuthRepairActions,
				failure: browserUseAuthRepairFailureActions,
			},
			flags: browserUseAuthFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"auth-repair-vault-grant": {
			script: "browser-use",
			summary:
				"Prove the token's exactly-one-vault grant (R8) or report the typed repair path; chains to token enrollment when retrieval is unavailable.",
			usage: [
				"auth repair-vault-grant [--run <id>] [--caller <label>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseAuthReadinessResultContract,
			actionAffordances: {
				success: browserUseAuthRepairActions,
				failure: browserUseAuthRepairFailureActions,
			},
			flags: browserUseAuthFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"auth-repair-item-binding": {
			script: "browser-use",
			summary:
				"Re-prove one exact item binding by targeted read (R11) — present, moved, or forbidden — never an unbound scan.",
			usage: [
				"auth repair-item-binding --vault-id <id> --item-id <id> [--run <id>] [--caller <label>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseAuthReadinessResultContract,
			actionAffordances: {
				success: browserUseAuthRepairActions,
				failure: browserUseAuthRepairFailureActions,
			},
			flags: browserUseAuthBindingFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
		"auth-request-binding-selection-grant": {
			script: "browser-use",
			summary:
				"Project the ambiguous-binding candidate set a signed one-use selection grant must bind (R20); signing stays with the native Approval Broker.",
			usage: [
				"auth request-binding-selection-grant --vault-id <id> [--run <id>] [--caller <label>] [--json|--plain]",
			],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			envVars: browserUsePlatformStoreEnvVars,
			resultContract: browserUseAuthReadinessResultContract,
			actionAffordances: {
				success: browserUseAuthRepairActions,
				failure: browserUseAuthRepairFailureActions,
			},
			flags: browserUseAuthSelectionFlags,
			exitCodes: browserUsePlatformExitCodes,
		},
	} as const satisfies Record<BrowserUseCommand, BrowserUseCommandContract>,
	{
		path: "skills/browser-use/src/command-contract.ts",
		writeImplyingMutations: new Set(["write", "browser"]),
	},
);
