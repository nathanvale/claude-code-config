import type {
	BrowserAdapterRouterAdapter,
	BrowserAdapterRouterAttachmentModel,
	BrowserAdapterRouterBundle,
	BrowserAdapterRouterDiagnosticCode,
	BrowserAdapterRouterMode,
	BrowserAdapterRouterReportSource,
	BrowserAdapterRouterSupportState,
	browserAdapterRouterFailureActions,
	browserAdapterRouterPrepareFailureActions,
	browserAdapterRouterPrepareSuccessActions,
	browserAdapterRouterSuccessActions,
} from "./command-contract";
import type { AdapterCapability } from "./discovery-model";

// Capability names stay shared with the live discovery model (migration U2,
// KTD4; one-way dormant->live edge). The adapter-id axis diverged in migration
// U4: the live BrowserAdapterId re-pointed to envelope ids, so the dormant
// Router cluster keeps its own alias onto the Router-era registry ids.
export type BrowserAdapterId = BrowserAdapterRouterAdapter;
export type { AdapterCapability };

// ---------------------------------------------------------------------------
// Capability report shape (U1).
// ---------------------------------------------------------------------------

export type CapabilityReportProvenance = {
	adapter_version: string;
	source_url: string;
	checked_at: string;
	verification_method: string;
	stale_after_days: number;
};

export type CapabilityEntryEvidence = {
	verification_method: string;
	source_url?: string;
};

export type CapabilityEntry = {
	capability: AdapterCapability;
	support: BrowserAdapterRouterSupportState;
	confidence: number;
	evidence: CapabilityEntryEvidence;
};

export type CapabilityReport = {
	adapter_id: BrowserAdapterId;
	schema_version: string;
	report_source: BrowserAdapterRouterReportSource;
	resolved_command: string;
	validation: "valid" | "invalid";
	attachment_model: BrowserAdapterRouterAttachmentModel;
	provenance: CapabilityReportProvenance;
	capabilities: readonly CapabilityEntry[];
};

// ---------------------------------------------------------------------------
// Evidence envelope shape (U0/U2/U5). Caller-assembled JSON. Exact fields stay
// runtime-owned (plan R5d); the plan body carries no hand-maintained schema.
// ---------------------------------------------------------------------------

export type RouteEvidenceFreshness = {
	checked_at: string;
	stale_after_days: number;
};

export type RoutePreconditionEvidence = {
	// Run correlation (R17b): run-scoped proof and precondition evidence must tie
	// to the route run. Capability reports are reusable cross-run snapshots gated
	// by their own `checked_at` freshness, not run id; only this run-scoped
	// precondition block carries the run_id the Router correlates against.
	run_id: string;
	freshness: RouteEvidenceFreshness;
	warm_chrome_ready: boolean;
	// Authoritative run-scoped Warm Chrome session id (U2 R8). When supplied,
	// every adapter proof's warm_chrome_run_id must match it; a mismatch fails
	// closed as cross-run proof evidence (R9).
	warm_chrome_run_id?: string;
	// Browser Adapter Proof evidence per candidate adapter (R5c).
	adapter_attached_verified_browser?: Partial<Record<BrowserAdapterId, boolean>>;
	// Run-scoped Browser Adapter Proof identity per candidate adapter (U2 R8).
	// Surfaced on route success as the binding tuple so Browser Operations can
	// fail closed on mismatched, stale, or cross-run proof evidence (R9).
	adapter_proof?: Partial<Record<BrowserAdapterId, AdapterProofBinding>>;
	// Auth/session precondition (R15, R16). Only present when the task declares it.
	auth_session?: {
		required: boolean;
		target_origin?: string;
		verified_profile_identity?: string;
		account_session_match?: boolean;
	};
	// Target page/origin precondition (R16b).
	target_origin?: {
		required: boolean;
		expected: string;
		observed?: string;
	};
};

// Fallback authority removed (platform plan 2026-07-21-002 U1): a preferred
// adapter that is not selectable fails closed; no policy field can authorize
// silently routing another adapter. allow_degraded was never routed in V1 and
// retired with it.
export type RoutePolicy = {
	mode: BrowserAdapterRouterMode;
	adapter_id?: BrowserAdapterId;
	minimum_support?: BrowserAdapterRouterSupportState;
};

export type RouteTask = {
	bundle?: BrowserAdapterRouterBundle;
	required_capabilities?: readonly AdapterCapability[];
	adapter_ranking?: readonly BrowserAdapterId[];
	// Run-scoped media proof request (U5).
	media_proof?: {
		requested: boolean;
		run_scoped_path: string;
	};
};

export type RouteEvidenceEnvelope = {
	run_id: string;
	policy: RoutePolicy;
	task: RouteTask;
	preconditions: RoutePreconditionEvidence;
	reports: readonly CapabilityReport[];
};

// ---------------------------------------------------------------------------
// Candidate and route evaluation shapes.
// ---------------------------------------------------------------------------

export type CandidateDecisionStatus =
	| "selectable"
	| "skipped"
	| "rejected";

export type CandidateDecision = {
	adapter_id: BrowserAdapterId;
	status: CandidateDecisionStatus;
	reason: string;
	code?: BrowserAdapterRouterDiagnosticCode;
	route_confidence?: number;
	registry_rank: number;
};

export type RouteRanking = {
	task_priority: number | null;
	registry_priority: number;
	route_confidence: number;
};

// Run-scoped Browser Adapter Proof identity (U2 R8). Supplied per candidate
// adapter on precondition evidence; the selected adapter's entry is surfaced on
// route success so downstream Browser Operations bind to one proof.
export type AdapterProofBinding = {
	adapter_proof_id: string;
	warm_chrome_run_id: string;
	verified_endpoint_identity: string;
};

// Canonical binding tuple slice owned by route success (U2 R8). Target and
// operation tuple fields (target_envelope_id, target_candidate_id,
// operation_intent_id) are added by U5-U7 as those surfaces ship.
export type RouteBinding = {
	run_id: string;
	selected_adapter_id: BrowserAdapterId;
	warm_chrome_run_id: string;
	adapter_proof_id: string;
	verified_endpoint_identity: string;
	route_evidence_hash: string;
	authorized_capabilities: AdapterCapability[];
	emitted_at: string;
	expires_at: string;
};

// Browser Target Discovery types moved to the live discovery model
// (migration U2, KTD4): TargetDiscoveryMode, BrowserTargetCandidate,
// TargetDiscoveryBinding, TargetDiscoveryEnvelope live in discovery-model.ts.

export type RouteSuccess = {
	outcome: "selected";
	evaluation_date: string;
	mode: BrowserAdapterRouterMode;
	requested_adapter: BrowserAdapterId | null;
	selected_adapter: BrowserAdapterId;
	required_capabilities: AdapterCapability[];
	route_confidence: number;
	ranking: readonly { adapter_id: BrowserAdapterId; ranking: RouteRanking }[];
	candidate_decisions: readonly CandidateDecision[];
	provenance_summary: readonly {
		adapter_id: BrowserAdapterId;
		report_source: BrowserAdapterRouterReportSource;
		checked_at: string;
	}[];
	// Route/proof binding tuple (U2 R8). Present whenever the selected adapter
	// carries run-scoped proof evidence; required for operation-capable routes
	// (R9, R12) and absent for non-operation routes such as pure capability
	// discovery, which never reach a Browser Operation.
	binding?: RouteBinding;
	media_proof?: MediaProofMetadata;
};

export type RouteFailure = {
	outcome: "fail_closed";
	evaluation_date: string;
	mode: BrowserAdapterRouterMode;
	requested_adapter: BrowserAdapterId | null;
	code: BrowserAdapterRouterDiagnosticCode;
	message: string;
	next_action_id: RouterFailureActionId;
	required_capabilities: AdapterCapability[];
	research?: ResearchRecovery;
	candidate_decisions: readonly CandidateDecision[];
	informational_alternatives: readonly BrowserAdapterId[];
};

export type RouteFailureData = {
	failure_kind: "route_failure";
	evaluation_date: string;
	required_capabilities: AdapterCapability[];
	routing_started: boolean;
	candidate_decisions: readonly CandidateDecision[];
	informational_alternatives: readonly BrowserAdapterId[];
	research?: {
		adapter_id: BrowserAdapterId;
		capability: AdapterCapability;
		diagnostic_trail_id: "browser-adapter-router.research_adapter_capability";
	};
};

export type MediaProofMetadata = {
	requested: boolean;
	run_scoped_path: string;
	retention: "per_run";
	disclose_to_user: boolean;
	// Adapters produce artifacts; they never override this metadata (U5).
	owner: "browser-use";
};

export type ResearchRecovery = {
	adapter_id: BrowserAdapterId;
	capability: AdapterCapability;
	query: string;
	sources: readonly string[];
	last_checked: string;
	stale_reason: string;
	retry_posture: "bounded";
	max_retries: number;
	terminal_condition: string;
	research_signal: number;
};

export type RouterFailureActionId =
	(typeof browserAdapterRouterFailureActions)[number]["id"];
export type RouterSuccessActionId =
	(typeof browserAdapterRouterSuccessActions)[number]["id"];
export type RouterPrepareFailureActionId =
	(typeof browserAdapterRouterPrepareFailureActions)[number]["id"];
export type RouterPrepareSuccessActionId =
	(typeof browserAdapterRouterPrepareSuccessActions)[number]["id"];

export type RouteEvaluation = RouteSuccess | RouteFailure;
