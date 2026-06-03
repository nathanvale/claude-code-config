import type {
	BrowserAdapterRouterAdapter,
	BrowserAdapterRouterAttachmentModel,
	BrowserAdapterRouterBundle,
	BrowserAdapterRouterCapability,
	BrowserAdapterRouterDiagnosticCode,
	BrowserAdapterRouterMode,
	BrowserAdapterRouterReportSource,
	BrowserAdapterRouterSupportState,
	browserAdapterRouterFailureActions,
	browserAdapterRouterSuccessActions,
} from "./command-contract";

// Re-exported registry-aligned types so Router runtime modules share one
// vocabulary source.
export type BrowserAdapterId = BrowserAdapterRouterAdapter;
export type AdapterCapability = BrowserAdapterRouterCapability;

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
	// Browser Adapter Proof evidence per candidate adapter (R5c).
	adapter_attached_verified_browser?: Partial<Record<BrowserAdapterId, boolean>>;
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

export type RoutePolicy = {
	mode: BrowserAdapterRouterMode;
	adapter_id?: BrowserAdapterId;
	minimum_support?: BrowserAdapterRouterSupportState;
	fallback_allowed?: boolean;
	allow_degraded?: boolean;
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

export type RouteEvaluation = RouteSuccess | RouteFailure;
