import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import {
	evidenceGap,
	stableReportId,
	uniqueEvidenceGaps,
} from "./report-helpers";

/**
 * Stable result contract identity for skill-feedback record envelopes.
 *
 * Agents use this to distinguish a Software Learning Report from raw receipts.
 */
export const SKILL_FEEDBACK_CONTRACT_ID = "skill-feedback.record" as const;

/**
 * Stable result contract identity for driver closeout envelopes.
 */
export const SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID =
	"skill-feedback.closeout" as const;

/**
 * Stable result contract identity for review envelopes.
 */
export const SKILL_FEEDBACK_REVIEW_CONTRACT_ID =
	"skill-feedback.review" as const;

/**
 * Stable result contract identity for health envelopes.
 */
export const SKILL_FEEDBACK_HEALTH_CONTRACT_ID =
	"skill-feedback.health" as const;

/**
 * Stable result contract identity for inbox purge envelopes.
 */
export const SKILL_FEEDBACK_PURGE_CONTRACT_ID =
	"skill-feedback.purge" as const;

/**
 * Schema version for the package-owned Software Learning Report envelope.
 *
 * Increment when agent-visible record semantics change.
 */
export const SKILL_FEEDBACK_SCHEMA_VERSION = "1" as const;

/**
 * Schema version for the review-specific claim-safe result envelope.
 *
 * Review result semantics can advance independently from persisted report
 * records so older readers do not silently accept changed review output.
 */
export const SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION = "3" as const;

/**
 * Schema version for health-specific read-only result envelopes.
 */
export const SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION = "1" as const;

/**
 * Schema version for purge-specific result envelopes.
 */
export const SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION = "1" as const;

/**
 * Cost attribution stance for v1 report cards.
 *
 * Cost is intentionally unavailable until a trusted skill-attributed source
 * exists. Review reads this as an evidence gap, not as zero cost.
 */
export const SKILL_FEEDBACK_COST_STATUS = {
	UNAVAILABLE: "unavailable",
} as const;

/**
 * Evaluation name carried on every record, aligning with the OpenTelemetry
 * GenAI `gen_ai.evaluation.result` event family (name/label/explanation).
 */
const SKILL_FEEDBACK_EVALUATION_NAME = "skill-feedback" as const;

/**
 * Domain outcome enum carried inside the envelope `data` (mirrors fallow's
 * `FALLOW_STATUS_VALUES`). Never forked off `StructuredRuntimeError`: the
 * outcome is a property of the record, not of a failure.
 */
export const SKILL_FEEDBACK_OUTCOMES = [
	"confirmed",
	"failed",
	"ambiguous",
] as const;

/**
 * Evidence source lanes for Software Learning Reports.
 */
const SKILL_FEEDBACK_EVIDENCE_SOURCES = [
	"hook_capture",
	"driver_closeout",
] as const;

/**
 * Harness runtime that produced hook-capture evidence.
 */
const SKILL_FEEDBACK_CAPTURE_RUNTIMES = [
	"claude_stop",
	"codex_stop",
	"codex_notify",
] as const;

const SKILL_IDENTITY_PROVENANCE_SOURCES = [
	"claude_transcript_skill_tool_result",
	"codex_notify_payload",
	"codex_stop_payload",
	"none",
] as const;

const SKILL_IDENTITY_PROVENANCE_REASONS = [
	"claude_transcript_detection",
	"legacy_notify_not_ready",
	"codex_stop_payload_has_no_trusted_skill_identity",
	"trusted_codex_stop_payload_identity",
] as const;

const SKILL_RUN_ID_PROVENANCE_SOURCES = [
	"runtime_owned",
	"correlation_owned",
	"report_authored",
] as const;

/**
 * Link quality between capture evidence and closeout enrichment.
 */
const SKILL_FEEDBACK_CORRELATION_STATUSES = [
	"linked",
	"unlinked",
] as const;

/**
 * Sortable verification burden levels supplied by driver closeout.
 */
const VERIFICATION_BURDEN_LEVELS = [
	"none",
	"light",
	"moderate",
	"heavy",
] as const;

/**
 * Seeded friction categories for v1 grouping.
 */
const FRICTION_CATEGORIES = [
	"none",
	"missing_context",
	"unclear_ownership",
	"tool_failure",
	"verification_tax",
	"bad_guidance",
	"scope_mismatch",
	"other",
] as const;

/**
 * Evidence-only observation categories accepted from driver closeout.
 */
const OBSERVATION_KINDS = [
	"friction",
	"verification_gap",
	"missing_context",
	"ownership_gap",
	"tool_failure",
	"bad_guidance",
	"scope_mismatch",
	"runtime_signal",
	"product_signal",
	"other",
] as const;

/**
 * Structured evidence basis values for observations.
 */
const OBSERVATION_EVIDENCE_BASIS = [
	"driver_observed",
	"verification_step",
	"tool_result",
	"missing_source",
	"other",
] as const;

/**
 * Typed gap codes review uses instead of one degraded boolean.
 */
const EVIDENCE_GAP_CODES = [
	"missing_skill",
	"missing_outcome",
	"missing_goal",
	"missing_friction",
	"missing_verification_burden",
	"missing_runtime_model",
	"missing_runtime_git_sha",
	"missing_runtime_skill_version",
	"cost_unavailable",
	"unlinked_correlation",
] as const;

/**
 * Provenance strength for v2 review ledger entries.
 */
const REVIEW_EVIDENCE_TIERS = [
	"driver_declared",
	"runtime_observed",
	"corroborated",
	"trusted_engine_identity",
] as const;

/**
 * Claim language downstream agents may repeat for one v2 ledger entry.
 */
const REVIEW_ALLOWED_CLAIMS = [
	"repeated_anchor",
	"mixed_evidence_sources",
	"same_trusted_run",
	"corroborated",
	"trusted_engine_identity",
] as const;

/**
 * Per-claim readiness states emitted by v2 review output.
 */
const REVIEW_CLAIM_READINESS_STATUSES = [
	"ready",
	"blocked",
	"evidence_only",
] as const;

const SKILL_FEEDBACK_HEALTH_INBOX_STATUSES = [
	"missing",
	"empty",
	"populated",
	"partially_readable",
	"unsafe",
] as const;

const SKILL_FEEDBACK_HEALTH_WARNING_REASON_IDS = [
	"inbox_missing",
	"inbox_empty",
	"unsafe_inbox",
	"partial_readability",
	"unlinked_primary_reports",
	"low_signal_threshold",
	"retention_preview_recommended",
] as const;

const SKILL_FEEDBACK_HEALTH_READINESS_STATUSES = [
	"ready",
	"blocked",
	"evidence_only",
] as const;

const SKILL_FEEDBACK_HEALTH_CORRELATION_STATUSES = [
	"none",
	"linked",
	"partially_linked",
	"all_unlinked",
] as const;

const SKILL_FEEDBACK_HEALTH_NEXT_ACTION_IDS = [
	"confirm-capture-path",
	"run-review",
	"inspect-report-correlation",
	"inspect-capture-identity",
	"preview-purge",
	"repair-inbox-state",
] as const;

/**
 * Anchor strength values exposed by the v2 review contract.
 */
const REVIEW_ANCHOR_STRENGTHS = ["strong_path", "weak"] as const;

/**
 * Reasons a v2 anchor cannot safely become a mergeable ledger key.
 */
const REVIEW_WEAK_ANCHOR_REASONS = [
	"label_only",
	"missing_anchor",
	"out_of_repo",
	"unverifiable",
] as const;

/**
 * Resolution states for v2 ledger entries.
 */
const REVIEW_RESOLUTION_STATES = [
	"open",
	"no_action",
	"resolved",
] as const;

export const SKILL_FEEDBACK_PURGE_LANES = [
	"primary",
	"low-signal",
	"all",
] as const;

/**
 * V2 ledger verification levels include `unknown` for runtime-only evidence.
 */
const REVIEW_LEDGER_VERIFICATION_LEVELS = [
	...VERIFICATION_BURDEN_LEVELS,
	"unknown",
] as const;

/**
 * Skill-run outcome union (== success-verify three-way outcome).
 */
export type SkillFeedbackOutcome = (typeof SKILL_FEEDBACK_OUTCOMES)[number];

export type SkillFeedbackPurgeLane =
	(typeof SKILL_FEEDBACK_PURGE_LANES)[number];

/**
 * Software Learning Report evidence source.
 */
export type EvidenceSource = (typeof SKILL_FEEDBACK_EVIDENCE_SOURCES)[number];

/**
 * Harness runtime that produced hook-capture evidence.
 */
export type CaptureRuntime =
	(typeof SKILL_FEEDBACK_CAPTURE_RUNTIMES)[number];

export type SkillIdentityProvenanceSource =
	(typeof SKILL_IDENTITY_PROVENANCE_SOURCES)[number];

export type SkillIdentityProvenanceReason =
	(typeof SKILL_IDENTITY_PROVENANCE_REASONS)[number];

/**
 * Provenance for a report's `skill_run_id` link claim.
 */
export type SkillRunIdProvenance =
	(typeof SKILL_RUN_ID_PROVENANCE_SOURCES)[number];

/**
 * Capture-source provenance. `trusted` means the adapter trusts the named
 * source field; it is not Trusted skill identity or Trusted run proof.
 */
export type SkillIdentityProvenance = {
	source: SkillIdentityProvenanceSource;
	trusted: boolean;
	field?: string;
	reason?: SkillIdentityProvenanceReason;
};

export type CaptureMetadata = {
	capture_runtime?: CaptureRuntime;
	skill_identity_provenance?: SkillIdentityProvenance;
};

/**
 * Link quality between report-card records.
 */
export type CorrelationStatus =
	(typeof SKILL_FEEDBACK_CORRELATION_STATUSES)[number];

/**
 * Cost attribution status.
 */
export type SkillFeedbackCostStatus =
	(typeof SKILL_FEEDBACK_COST_STATUS)[keyof typeof SKILL_FEEDBACK_COST_STATUS];

/**
 * V1 evidence gap code.
 */
export type EvidenceGapCode = (typeof EVIDENCE_GAP_CODES)[number];

/**
 * V1 evidence gap carried into review.
 */
export type EvidenceGap = {
	code: EvidenceGapCode;
	path: string;
	message: string;
};

/**
 * V1 friction category.
 */
export type FrictionCategory = (typeof FRICTION_CATEGORIES)[number];

/**
 * V1 verification burden level.
 */
export type VerificationBurdenLevel =
	(typeof VERIFICATION_BURDEN_LEVELS)[number];

/**
 * V1 observation kind.
 */
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/**
 * V1 observation evidence basis.
 */
export type ObservationEvidenceBasis =
	(typeof OBSERVATION_EVIDENCE_BASIS)[number];

/**
 * The single trust-boundary constant. These are the only receipt fields an
 * agent authors as free text, and therefore the only fields the redactor (U6)
 * scrubs. Everything not in this set is adapter-derived, engine-read telemetry
 * that is trusted and never redacted — which makes "telemetry untouched,
 * narration redacted" a unit-testable invariant.
 *
 * SECURITY (KTD2a): a field is only safe to skip redaction when its value
 * cannot be agent-authored. `model`, `git_sha`, and `skill_version` are read
 * inside the engine (model from adapter telemetry; git_sha/skill_version from
 * the repo) and are NEVER accepted as CLI flags. There is deliberately no
 * `--model` / `--git-sha` / `--skill-version` flag, so an agent cannot smuggle
 * a secret into a "trusted" field to dodge the redactor. The only
 * flag-supplied values are exactly these redaction-gated narrated fields.
 */
export const NARRATED_FIELDS = ["goal", "friction", "explanation"] as const;

/**
 * Every agent-authored string path owned by skill-feedback redaction.
 *
 * v0 keeps the flat `NARRATED_FIELDS`; v1 adds report-card nested paths. The
 * redactor reads ownership from constants rather than prose so new lanes cannot
 * silently bypass review.
 */
export const AGENT_AUTHORED_STRING_PATHS = [
	"goal",
	"friction",
	"explanation",
	"report_card.goal",
	"report_card.friction.note",
	"report_card.verification_burden.note",
	"report_card.touched_surfaces[].value",
	"report_card.observations[].target.value",
	"report_card.observations[].summary",
] as const;

/**
 * Narrated (redaction-gated) field union.
 */
export type NarratedField = (typeof NARRATED_FIELDS)[number];

/**
 * Adapter-derived telemetry usage tokens (passed through untouched).
 */
export type ReceiptUsage = {
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
};

/**
 * Driver-authored friction signal for report-card closeout.
 */
export type FrictionSignal = {
	category: FrictionCategory;
	note: string;
};

/**
 * Driver-authored verification burden signal for report-card closeout.
 */
export type VerificationBurden = {
	level: VerificationBurdenLevel;
	note: string;
};

/**
 * Optional touched surface or observation target.
 */
export type ReportCardTarget = {
	type: "path" | "label";
	value: string;
};

/**
 * Optional evidence-only observation supplied by a driver.
 */
export type ReportCardObservation = {
	kind: ObservationKind;
	target?: ReportCardTarget;
	summary: string;
	evidence_basis: ObservationEvidenceBasis;
};

/**
 * V1 driver closeout receipt after validation.
 */
export type CloseoutReceipt = {
	skill: string;
	outcome: SkillFeedbackOutcome;
	goal: string;
	friction: FrictionSignal;
	verification_burden: VerificationBurden;
	touched_surfaces: readonly ReportCardTarget[];
	observations: readonly ReportCardObservation[];
	skill_run_id?: string;
};

/**
 * Result of validating a driver closeout receipt.
 */
export type ParseCloseoutReceiptResult =
	| {
			kind: "ok";
			receipt: CloseoutReceipt;
			evidence_gaps: readonly EvidenceGap[];
	  }
	| {
			kind: "degraded";
			receipt: Partial<CloseoutReceipt>;
			evidence_gaps: readonly EvidenceGap[];
	  }
	| { kind: "invalid"; path: string; reason: string };

/**
 * Runtime telemetry retained separately from driver-authored report-card data.
 */
export type NormalizedRuntimeTelemetry = {
	git_sha?: string;
	skill_version?: string;
	model?: string;
	usage?: ReceiptUsage;
};

/**
 * V1 cost attribution stance carried by the normalized review model.
 */
export type CostAttribution = {
	status: SkillFeedbackCostStatus;
	gap_code: "cost_unavailable";
};

/**
 * V1 report-card record shape persisted by future v1 writers.
 */
export type ReportCardSoftwareLearningReport = {
	schema_version: typeof SKILL_FEEDBACK_SCHEMA_VERSION;
	report_id: string;
	untrusted_evidence: true;
	generated_ts: string;
	evidence_source: EvidenceSource;
	capture_runtime?: CaptureRuntime;
	skill_identity_provenance?: SkillIdentityProvenance;
	correlation_status: CorrelationStatus;
	skill_run_id?: string;
	skill_run_id_provenance?: SkillRunIdProvenance;
	runtime: NormalizedRuntimeTelemetry;
	report_card: Partial<CloseoutReceipt>;
	evidence_gaps: readonly EvidenceGap[];
};

const CLOSEOUT_COVERAGE_CONTRIBUTIONS = ["material_closeout"] as const;

export type CloseoutCoverageContribution =
	(typeof CLOSEOUT_COVERAGE_CONTRIBUTIONS)[number];

export type CloseoutResultData = {
	contract: typeof SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID;
	schema_version: typeof SKILL_FEEDBACK_SCHEMA_VERSION;
	report_id: string;
	skill_run_id?: string;
	correlation_status: CorrelationStatus;
	evidence_gaps: readonly EvidenceGap[];
	redactions: number;
	written_path: string;
	closeout_coverage_contribution: CloseoutCoverageContribution;
};

const REVIEW_OPEN_REASONS = [
	"high_verification_burden",
	"repeated_friction",
	"evidence_gap",
	"unlinked_correlation_spike",
	"owner_path_observation",
] as const;

export type ReviewOpenReason = (typeof REVIEW_OPEN_REASONS)[number];

export type ReviewOpenItem = {
	open_reason: ReviewOpenReason;
	severity: "info" | "warning" | "action";
	evidence: string;
	evidence_refs: readonly string[];
	target?: ReportCardTarget;
	next_action: string;
};

export type ReviewCoverage = {
	total_reports: number;
	closeout_count: number;
	capture_only_count: number;
	unlinked_count: number;
	evidence_gap_count: number;
	closeout_rate: number;
	low_coverage: boolean;
	low_coverage_warning?: string;
};

export type ReviewRetention = {
	report_count: number;
	oldest_report_age_days?: number;
	warning?: string;
	future_purge_action?: string;
};

export type ReviewInboxHealth = {
	primary_count: number;
	low_signal_count: number;
	low_signal_newest_generated_ts?: string;
	low_signal_reason_ids: readonly string[];
	skipped_unsafe_count: number;
	invalid_count: number;
};

/**
 * Diagnostic read-target facts emitted only when path context changes review
 * interpretation, such as an explicit `--repo` override.
 */
export type ReviewReadTarget = {
	explicit: boolean;
	repo_root: string;
	inbox_path: string;
	target_path?: string;
};

export type HealthInboxStatus =
	(typeof SKILL_FEEDBACK_HEALTH_INBOX_STATUSES)[number];

export type HealthWarningReasonId =
	(typeof SKILL_FEEDBACK_HEALTH_WARNING_REASON_IDS)[number];

export type HealthReadinessStatus =
	(typeof SKILL_FEEDBACK_HEALTH_READINESS_STATUSES)[number];

export type HealthCorrelationStatus =
	(typeof SKILL_FEEDBACK_HEALTH_CORRELATION_STATUSES)[number];

export type HealthNextActionId =
	(typeof SKILL_FEEDBACK_HEALTH_NEXT_ACTION_IDS)[number];

export type HealthCounts = {
	primary: number;
	low_signal: number;
	invalid: number;
	skipped_unsafe: number;
	unlinked_primary: number;
};

export type HealthNewest = {
	primary_generated_ts?: string;
	low_signal_generated_ts?: string;
};

export type HealthWarning = {
	reason_id: HealthWarningReasonId;
	summary: string;
};

export type HealthReadinessFact = {
	status: HealthReadinessStatus;
	reason_ids: readonly string[];
};

export type HealthClaimReadiness = {
	runtime_capture: HealthReadinessFact;
	trusted_skill_identity: HealthReadinessFact;
	daily_pilot: HealthReadinessFact;
};

export type HealthCorrelation = {
	status: HealthCorrelationStatus;
	linked_primary_count: number;
	unlinked_primary_count: number;
};

export type HealthNextAction = {
	action_id: HealthNextActionId;
	summary: string;
};

export type HealthResultData = {
	contract: typeof SKILL_FEEDBACK_HEALTH_CONTRACT_ID;
	schema_version: typeof SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION;
	inbox_status: HealthInboxStatus;
	counts: HealthCounts;
	newest: HealthNewest;
	warnings: readonly HealthWarning[];
	claim_readiness: HealthClaimReadiness;
	correlation: HealthCorrelation;
	next_action: HealthNextAction;
};

export type ReviewPilotCheckpoint = {
	started_at: string;
	age_days: number;
	actionable_feedback_numerator: number;
	material_closeout_denominator: number;
	density: number;
	next_action: string;
};

export type ReviewReadinessStatus = "ready" | "blocked";

/**
 * V1 review readiness shape. ReviewResultData v2 replaces this with
 * claim-specific readiness under `claim_readiness`.
 */
export type ReviewCaptureReadiness = {
	implementation_status: ReviewReadinessStatus;
	daily_pilot_status: ReviewReadinessStatus;
	reasons: readonly string[];
	trusted_codex_stop_count: number;
	evidence_only_codex_stop_count: number;
	legacy_notify_count: number;
};

/**
 * V1 review result retained for the current runner while v2 migrates in.
 */
export type ReviewResultDataV1 = {
	contract: typeof SKILL_FEEDBACK_REVIEW_CONTRACT_ID;
	schema_version: typeof SKILL_FEEDBACK_SCHEMA_VERSION;
	coverage: ReviewCoverage;
	/** V1-only field; absent from the planned v2 review result. */
	capture_readiness: ReviewCaptureReadiness;
	open_items: readonly ReviewOpenItem[];
	no_action?: { rationale: string };
	retention: ReviewRetention;
	pilot_checkpoint?: ReviewPilotCheckpoint;
};

/**
 * V2 evidence tier for one ledger entry.
 */
export type ReviewEvidenceTier = (typeof REVIEW_EVIDENCE_TIERS)[number];

/**
 * V2 claim that is safe to repeat for one ledger entry.
 */
export type ReviewAllowedClaim = (typeof REVIEW_ALLOWED_CLAIMS)[number];

/**
 * V2 readiness status for one claim surface.
 */
export type ReviewClaimReadinessStatus =
	(typeof REVIEW_CLAIM_READINESS_STATUSES)[number];

/**
 * V2 anchor strength for ledger grouping safety.
 */
export type ReviewAnchorStrength = (typeof REVIEW_ANCHOR_STRENGTHS)[number];

/**
 * V2 weak-anchor quarantine reason.
 */
export type ReviewWeakAnchorReason =
	(typeof REVIEW_WEAK_ANCHOR_REASONS)[number];

/**
 * V2 ledger entry resolution state.
 */
export type ReviewResolutionState = (typeof REVIEW_RESOLUTION_STATES)[number];

/**
 * V2 ledger verification burden, including unknown runtime-only evidence.
 */
export type ReviewLedgerVerificationBurden = {
	level: (typeof REVIEW_LEDGER_VERIFICATION_LEVELS)[number];
	note?: string;
};

/**
 * V2 review unit identity derived before anchor grouping.
 */
export type ReviewUnitData = {
	review_unit_key: string;
	report_ids: readonly string[];
	trusted_run: boolean;
	trusted_skill_run_id?: string;
};

/**
 * V2 readiness fact for one claim surface.
 */
export type ReviewClaimReadinessFact = {
	status: ReviewClaimReadinessStatus;
	reason_ids: readonly string[];
	evidence_refs: readonly string[];
};

/**
 * V2 readiness facts split by claim surface.
 */
export type ReviewClaimReadiness = {
	runtime_capture: ReviewClaimReadinessFact;
	trusted_skill_identity: ReviewClaimReadinessFact;
	daily_pilot: ReviewClaimReadinessFact;
};

/**
 * V2 top-level action derived from reducer-owned evidence.
 */
export type ReviewOpenAction = {
	action_key: string;
	open_reason: ReviewOpenReason;
	target?: ReportCardTarget;
	next_safe_action: string;
	evidence_refs: readonly string[];
};

/**
 * V2 weak-anchor telemetry that never participates in grouping.
 */
export type ReviewAnchorMissTelemetry = {
	weak_anchor_reason: ReviewWeakAnchorReason;
	count: number;
	attempted_targets: readonly ReportCardTarget[];
};

/**
 * V2 claim-safe ledger entry.
 */
export type ReviewLedgerEntry = {
	ledger_entry_key: string;
	review_unit_keys: readonly string[];
	ledger_anchor_key?: string;
	anchor_strength: ReviewAnchorStrength;
	weak_anchor_reason?: ReviewWeakAnchorReason;
	attempted_targets: readonly ReportCardTarget[];
	owner_paths: readonly string[];
	evidence_tier: ReviewEvidenceTier;
	source_mix: readonly EvidenceSource[];
	capture_runtime_mix: readonly CaptureRuntime[];
	allowed_claims: readonly ReviewAllowedClaim[];
	resolution_state: ReviewResolutionState;
	verification_burden: ReviewLedgerVerificationBurden;
	next_safe_action: string;
};

/**
 * V2 review result contract consumed by JSON, plain output, and future agents.
 */
export type ReviewResultData = {
	contract: typeof SKILL_FEEDBACK_REVIEW_CONTRACT_ID;
	schema_version: typeof SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION;
	coverage: ReviewCoverage;
	inbox_health: ReviewInboxHealth;
	inbox_status: HealthInboxStatus;
	counts: HealthCounts;
	warnings: readonly HealthWarning[];
	next_action: HealthNextAction;
	read_target?: ReviewReadTarget;
	open_items: readonly ReviewOpenItem[];
	open_actions: readonly ReviewOpenAction[];
	no_action?: { rationale: string };
	retention: ReviewRetention;
	pilot_checkpoint?: ReviewPilotCheckpoint;
	review_units: readonly ReviewUnitData[];
	ledger_entries: readonly ReviewLedgerEntry[];
	anchor_miss_telemetry: readonly ReviewAnchorMissTelemetry[];
	claim_readiness: ReviewClaimReadiness;
};

export type SkillFeedbackPurgeMode = "preview" | "execute";

export type SkillFeedbackPurgeRetentionData =
	| {
			kind: "older_than";
			older_than: string;
			cutoff_ts: string;
	  }
	| {
			kind: "keep_latest";
			keep_latest: number;
	  };

export type SkillFeedbackPurgeResultData = {
	contract: typeof SKILL_FEEDBACK_PURGE_CONTRACT_ID;
	schema_version: typeof SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION;
	mode: SkillFeedbackPurgeMode;
	lane: SkillFeedbackPurgeLane;
	retention: SkillFeedbackPurgeRetentionData;
	scanned_count: number;
	candidate_count: number;
	deleted_count: number;
	skipped_unsafe_count: number;
	invalid_count: number;
	candidate_paths: readonly string[];
	deleted_paths: readonly string[];
	skipped_paths: readonly string[];
	invalid_paths: readonly string[];
};

/**
 * Result of validating v2 ReviewResultData from an unknown JSON value.
 */
export type ParseReviewResultDataResult =
	| { kind: "ok"; data: ReviewResultData }
	| { kind: "invalid"; path: string; reason: string };

export type ParseHealthResultDataResult =
	| { kind: "ok"; data: HealthResultData }
	| { kind: "invalid"; path: string; reason: string };

export type ParsePurgeResultDataResult =
	| { kind: "ok"; data: SkillFeedbackPurgeResultData }
	| { kind: "invalid"; path: string; reason: string };

/**
 * Read-side report shape consumed by review.
 */
export type NormalizedSoftwareLearningReport = {
	schema_version: typeof SKILL_FEEDBACK_SCHEMA_VERSION;
	source_schema_version: "v0" | "v1";
	report_id: string;
	untrusted_evidence: true;
	generated_ts: string;
	evidence_source: EvidenceSource;
	capture_runtime?: CaptureRuntime;
	skill_identity_provenance?: SkillIdentityProvenance;
	correlation_status: CorrelationStatus;
	skill_run_id?: string;
	skill_run_id_provenance?: SkillRunIdProvenance;
	skill: string;
	outcome: SkillFeedbackOutcome;
	goal?: string;
	friction?: FrictionSignal;
	verification_burden?: VerificationBurden;
	touched_surfaces: readonly ReportCardTarget[];
	observations: readonly ReportCardObservation[];
	evidence_gaps: readonly EvidenceGap[];
	cost: CostAttribution;
	runtime: NormalizedRuntimeTelemetry;
};

/**
 * Result of normalizing an unknown on-disk report.
 */
export type NormalizeReportResult =
	| { kind: "ok"; report: NormalizedSoftwareLearningReport }
	| { kind: "invalid"; path: string; reason: string };

/**
 * The flat v0 receipt — one object, not a nested `{ telemetry, narrated }`
 * shape (KTD2a). Mirrors `RunOutcome` in
 * `prototypes/browser-use-uplift/metrics-telemetry/telemetry.ts`: flat record,
 * passed-in timestamp, three-way outcome.
 *
 * Required narrated fields are `goal` and `friction`; `explanation` is the
 * optional narrated field. Telemetry tags (`skill_version`, `git_sha`,
 * `model`, `usage`) are adapter/engine-read, never flag-supplied.
 * `generated_ts` is a passed-in ISO string, never an ambient-clock read (KTD5).
 */
export type Receipt = {
	skill: string;
	goal: string;
	outcome: SkillFeedbackOutcome;
	friction: string;
	explanation?: string;
	skill_version: string;
	git_sha: string;
	model: string;
	usage: ReceiptUsage;
	generated_ts: string;
};

/**
 * Every receipt key, in declaration order. The parser rejects any key not in
 * this allow-list rather than silently dropping it (storage-routing rule,
 * KTD8) — fail loud, not fail quiet.
 */
export const RECEIPT_FIELDS = [
	"skill",
	"goal",
	"outcome",
	"friction",
	"explanation",
	"skill_version",
	"git_sha",
	"model",
	"usage",
	"generated_ts",
] as const;

/**
 * Receipt field union.
 */
export type ReceiptField = (typeof RECEIPT_FIELDS)[number];

/**
 * Receipt fields that must be present for a non-degraded record. The optional
 * `explanation` is intentionally absent. Engine-read telemetry tags remain
 * required for a complete record; missing tags degrade instead of blocking.
 */
const REQUIRED_RECEIPT_FIELDS = [
	"skill",
	"goal",
	"outcome",
	"friction",
	"skill_version",
	"git_sha",
	"model",
	"usage",
	"generated_ts",
] as const;

/**
 * The Software Learning Report — one flat record destined for the success
 * envelope's `data`. Shaped like a `gen_ai.evaluation.result` event
 * (name/label/explanation) plus warehouse tags (skill version, git SHA, model,
 * usage). The outcome enum lives here, inside `data`, never on the error.
 */
export type SoftwareLearningReport = {
	/** Evaluation family name; always {@link SKILL_FEEDBACK_EVALUATION_NAME}. */
	evaluation_name: typeof SKILL_FEEDBACK_EVALUATION_NAME;
	/** R18a machine-readable marker: record text is untrusted evidence. */
	untrusted_evidence: true;
	/** Passed-in ISO timestamp (KTD5); never an ambient-clock read. */
	generated_ts: string;
	capture_runtime?: CaptureRuntime;
	skill_identity_provenance?: SkillIdentityProvenance;
	skill: string;
	skill_version: string;
	git_sha: string;
	model: string;
	/** Domain outcome enum, carried inside the record (not on the error). */
	outcome: SkillFeedbackOutcome;
	goal: string;
	friction: string;
	explanation: string | null;
	usage: ReceiptUsage;
	/** R21: true when one or more required receipt fields were missing. */
	degraded: boolean;
	/** R6: required receipt fields that were missing, listed explicitly. */
	gaps: readonly ReceiptField[];
	/**
	 * R21: count of redactions applied to narrated fields. U2 emits 0 — U6
	 * owns redaction and writes the real count. Carried in the shape now so the
	 * record contract is stable.
	 */
	redactions: number;
};

/**
 * Outcome of parsing an untrusted receipt object into a typed receipt.
 *
 * A discriminated union, not exceptions-as-control-flow: `unknown-field` and
 * `invalid` are the fail-loud cases (storage-routing reject), while `ok` and
 * `degraded` both carry a usable partial receipt. `degraded` lists the missing
 * required fields as `gaps` (R6) so the absence is visible, never defaulted.
 */
export type ParseReceiptResult =
	| { kind: "ok"; fields: Partial<Receipt> }
	| {
			kind: "degraded";
			fields: Partial<Receipt>;
			gaps: readonly ReceiptField[];
	  }
	| { kind: "unknown-field"; field: string }
	| { kind: "invalid"; field: ReceiptField; reason: string };

const RECEIPT_FIELD_SET: ReadonlySet<string> = new Set(RECEIPT_FIELDS);
const RECEIPT_USAGE_FIELDS = [
	"input_tokens",
	"output_tokens",
	"cache_read_tokens",
] as const;
const RECEIPT_USAGE_FIELD_SET: ReadonlySet<string> = new Set(
	RECEIPT_USAGE_FIELDS,
);

function isReceiptUsage(value: unknown): value is ReceiptUsage {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const usage = value as Record<string, unknown>;
	const keys = Object.keys(usage);
	return (
		keys.length === RECEIPT_USAGE_FIELDS.length &&
		keys.every((key) => RECEIPT_USAGE_FIELD_SET.has(key)) &&
		typeof usage.input_tokens === "number" &&
		typeof usage.output_tokens === "number" &&
		typeof usage.cache_read_tokens === "number"
	);
}

/**
 * Parse an untrusted receipt object into typed fields.
 *
 * Fail loud on any key outside {@link RECEIPT_FIELDS} (`unknown-field`) and on
 * a present-but-wrong-typed field (`invalid`). Missing required fields are not
 * an error — they yield `degraded` with the gap list (R6). No redaction or
 * writing happens here (U6 owns that); this is schema validation only.
 *
 * Deterministic: the same input object always yields the same result. No
 * module-level cached state is read (KTD5).
 *
 * @example
 * ```typescript
 * const result = parseReceipt({ skill: "fallow", goal: "x", outcome: "confirmed", ... })
 * if (result.kind === "ok") { useReceipt(result.fields) }
 * ```
 */
export function parseReceipt(raw: unknown): ParseReceiptResult {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { kind: "invalid", field: "skill", reason: "receipt is not an object" };
	}
	const input = raw as Record<string, unknown>;

	for (const key of Object.keys(input)) {
		if (!RECEIPT_FIELD_SET.has(key)) {
			return { kind: "unknown-field", field: key };
		}
	}

	const fields: Partial<Receipt> = {};

	if ("skill" in input) {
		if (typeof input.skill !== "string") {
			return { kind: "invalid", field: "skill", reason: "expected string" };
		}
		fields.skill = input.skill;
	}
	if ("goal" in input) {
		if (typeof input.goal !== "string") {
			return { kind: "invalid", field: "goal", reason: "expected string" };
		}
		fields.goal = input.goal;
	}
	if ("outcome" in input) {
		if (!SKILL_FEEDBACK_OUTCOMES.includes(input.outcome as SkillFeedbackOutcome)) {
			return {
				kind: "invalid",
				field: "outcome",
				reason: `expected one of ${SKILL_FEEDBACK_OUTCOMES.join(", ")}`,
			};
		}
		fields.outcome = input.outcome as SkillFeedbackOutcome;
	}
	if ("friction" in input) {
		if (typeof input.friction !== "string") {
			return { kind: "invalid", field: "friction", reason: "expected string" };
		}
		fields.friction = input.friction;
	}
	if ("explanation" in input) {
		if (typeof input.explanation !== "string") {
			return {
				kind: "invalid",
				field: "explanation",
				reason: "expected string",
			};
		}
		fields.explanation = input.explanation;
	}
	if ("skill_version" in input) {
		if (typeof input.skill_version !== "string") {
			return {
				kind: "invalid",
				field: "skill_version",
				reason: "expected string",
			};
		}
		fields.skill_version = input.skill_version;
	}
	if ("git_sha" in input) {
		if (typeof input.git_sha !== "string") {
			return { kind: "invalid", field: "git_sha", reason: "expected string" };
		}
		fields.git_sha = input.git_sha;
	}
	if ("model" in input) {
		if (typeof input.model !== "string") {
			return { kind: "invalid", field: "model", reason: "expected string" };
		}
		fields.model = input.model;
	}
	if ("usage" in input) {
		if (!isReceiptUsage(input.usage)) {
			return {
				kind: "invalid",
				field: "usage",
				reason: "expected { input_tokens, output_tokens, cache_read_tokens }",
			};
		}
		fields.usage = input.usage;
	}
	if ("generated_ts" in input) {
		if (typeof input.generated_ts !== "string") {
			return {
				kind: "invalid",
				field: "generated_ts",
				reason: "expected ISO string",
			};
		}
		fields.generated_ts = input.generated_ts;
	}

	const gaps = REQUIRED_RECEIPT_FIELDS.filter(
		(field) => !(field in fields),
	);
	if (gaps.length > 0) {
		return { kind: "degraded", fields, gaps };
	}
	return { kind: "ok", fields };
}

/**
 * Build a Software Learning Report from parsed receipt fields.
 *
 * Pure and deterministic: identical input fields produce a byte-identical
 * record, including `generated_ts` (passed-in, never clock-read — KTD5). The
 * `untrusted_evidence` marker (R18a) is always `true`. `redactions` is `0`
 * here — U6 owns redaction and overwrites the count on the write path. Missing
 * required fields become explicit `gaps` and flip `degraded` (R6/R21), never
 * silent defaults; missing optional `explanation` becomes `null`.
 *
 * @example
 * ```typescript
 * const parsed = parseReceipt(raw)
 * if (parsed.kind === "ok" || parsed.kind === "degraded") {
 *   const report = buildSoftwareLearningReport(parsed)
 * }
 * ```
 */
export function buildSoftwareLearningReport(
	parsed: Extract<ParseReceiptResult, { kind: "ok" | "degraded" }>,
	captureMetadata: CaptureMetadata = {},
): SoftwareLearningReport {
	const { fields } = parsed;
	const gaps = parsed.kind === "degraded" ? parsed.gaps : [];
	return {
		evaluation_name: SKILL_FEEDBACK_EVALUATION_NAME,
		untrusted_evidence: true,
		generated_ts: fields.generated_ts ?? "",
		...(captureMetadata.capture_runtime
			? { capture_runtime: captureMetadata.capture_runtime }
			: {}),
		...(captureMetadata.skill_identity_provenance
			? { skill_identity_provenance: captureMetadata.skill_identity_provenance }
			: {}),
		skill: fields.skill ?? "",
		skill_version: fields.skill_version ?? "",
		git_sha: fields.git_sha ?? "",
		model: fields.model ?? "",
		outcome: fields.outcome ?? "ambiguous",
		goal: fields.goal ?? "",
		friction: fields.friction ?? "",
		explanation: fields.explanation ?? null,
		usage: fields.usage ?? {
			input_tokens: 0,
			output_tokens: 0,
			cache_read_tokens: 0,
		},
		degraded: gaps.length > 0,
		gaps,
		redactions: 0,
	};
}

const CLOSEOUT_RECEIPT_FIELDS = [
	"skill",
	"outcome",
	"goal",
	"friction",
	"verification_burden",
	"touched_surfaces",
	"observations",
	"skill_run_id",
] as const;
const CLOSEOUT_RECEIPT_FIELD_SET: ReadonlySet<string> = new Set(
	CLOSEOUT_RECEIPT_FIELDS,
);
const CLOSEOUT_CORE_GAPS = [
	{
		field: "skill",
		code: "missing_skill",
		message: "Closeout core is missing skill identity.",
	},
	{
		field: "outcome",
		code: "missing_outcome",
		message: "Closeout core is missing outcome.",
	},
	{
		field: "goal",
		code: "missing_goal",
		message: "Closeout core is missing goal.",
	},
	{
		field: "friction",
		code: "missing_friction",
		message: "Closeout core is missing friction signal.",
	},
	{
		field: "verification_burden",
		code: "missing_verification_burden",
		message: "Closeout core is missing verification burden.",
	},
] as const satisfies ReadonlyArray<{
	field: keyof CloseoutReceipt;
	code: EvidenceGapCode;
	message: string;
}>;
const V1_REPORT_FIELDS = [
	"schema_version",
	"report_id",
	"untrusted_evidence",
	"generated_ts",
	"evidence_source",
	"capture_runtime",
	"skill_identity_provenance",
	"correlation_status",
	"skill_run_id",
	"skill_run_id_provenance",
	"runtime",
	"report_card",
	"evidence_gaps",
] as const;
const V1_REPORT_FIELD_SET: ReadonlySet<string> = new Set(V1_REPORT_FIELDS);
const REVIEW_RESULT_V2_FIELDS = [
	"contract",
	"schema_version",
	"coverage",
	"inbox_health",
	"inbox_status",
	"counts",
	"warnings",
	"next_action",
	"read_target",
	"open_items",
	"open_actions",
	"no_action",
	"retention",
	"pilot_checkpoint",
	"review_units",
	"ledger_entries",
	"anchor_miss_telemetry",
	"claim_readiness",
] as const;
const REVIEW_RESULT_V2_FIELD_SET: ReadonlySet<string> = new Set(
	REVIEW_RESULT_V2_FIELDS,
);
const REVIEW_COVERAGE_FIELDS = [
	"total_reports",
	"closeout_count",
	"capture_only_count",
	"unlinked_count",
	"evidence_gap_count",
	"closeout_rate",
	"low_coverage",
	"low_coverage_warning",
] as const;
const REVIEW_INBOX_HEALTH_FIELDS = [
	"primary_count",
	"low_signal_count",
	"low_signal_newest_generated_ts",
	"low_signal_reason_ids",
	"skipped_unsafe_count",
	"invalid_count",
] as const;
const REVIEW_READ_TARGET_FIELDS = [
	"explicit",
	"repo_root",
	"inbox_path",
	"target_path",
] as const;
const REVIEW_OPEN_ITEM_FIELDS = [
	"open_reason",
	"severity",
	"evidence",
	"evidence_refs",
	"target",
	"next_action",
] as const;
const REVIEW_OPEN_ACTION_FIELDS = [
	"action_key",
	"open_reason",
	"target",
	"next_safe_action",
	"evidence_refs",
] as const;
const REVIEW_RETENTION_FIELDS = [
	"report_count",
	"oldest_report_age_days",
	"warning",
	"future_purge_action",
] as const;
const REVIEW_PILOT_CHECKPOINT_FIELDS = [
	"started_at",
	"age_days",
	"actionable_feedback_numerator",
	"material_closeout_denominator",
	"density",
	"next_action",
] as const;
const REVIEW_UNIT_FIELDS = [
	"review_unit_key",
	"report_ids",
	"trusted_run",
	"trusted_skill_run_id",
] as const;
const REVIEW_LEDGER_ENTRY_FIELDS = [
	"ledger_entry_key",
	"review_unit_keys",
	"ledger_anchor_key",
	"anchor_strength",
	"weak_anchor_reason",
	"attempted_targets",
	"owner_paths",
	"evidence_tier",
	"source_mix",
	"capture_runtime_mix",
	"allowed_claims",
	"resolution_state",
	"verification_burden",
	"next_safe_action",
] as const;
const REVIEW_LEDGER_VERIFICATION_BURDEN_FIELDS = [
	"level",
	"note",
] as const;
const REVIEW_ANCHOR_MISS_TELEMETRY_FIELDS = [
	"weak_anchor_reason",
	"count",
	"attempted_targets",
] as const;
const REVIEW_CLAIM_READINESS_FIELDS = [
	"runtime_capture",
	"trusted_skill_identity",
	"daily_pilot",
] as const;
const REVIEW_CLAIM_READINESS_FACT_FIELDS = [
	"status",
	"reason_ids",
	"evidence_refs",
] as const;
const HEALTH_RESULT_FIELDS = [
	"contract",
	"schema_version",
	"inbox_status",
	"counts",
	"newest",
	"warnings",
	"claim_readiness",
	"correlation",
	"next_action",
] as const;
const HEALTH_COUNTS_FIELDS = [
	"primary",
	"low_signal",
	"invalid",
	"skipped_unsafe",
	"unlinked_primary",
] as const;
const HEALTH_NEWEST_FIELDS = [
	"primary_generated_ts",
	"low_signal_generated_ts",
] as const;
const HEALTH_WARNING_FIELDS = ["reason_id", "summary"] as const;
const HEALTH_CLAIM_READINESS_FIELDS = [
	"runtime_capture",
	"trusted_skill_identity",
	"daily_pilot",
] as const;
const HEALTH_READINESS_FACT_FIELDS = ["status", "reason_ids"] as const;
const HEALTH_CORRELATION_FIELDS = [
	"status",
	"linked_primary_count",
	"unlinked_primary_count",
] as const;
const HEALTH_NEXT_ACTION_FIELDS = ["action_id", "summary"] as const;
const PURGE_RESULT_FIELDS = [
	"contract",
	"schema_version",
	"mode",
	"lane",
	"retention",
	"scanned_count",
	"candidate_count",
	"deleted_count",
	"skipped_unsafe_count",
	"invalid_count",
	"candidate_paths",
	"deleted_paths",
	"skipped_paths",
	"invalid_paths",
] as const;
const V0_PLACEHOLDER_FRICTION = new Set([
	"",
	"Hook captured no transcript payload.",
]);

/**
 * Validate driver-authored v1 closeout evidence.
 *
 * Missing core fields become typed evidence gaps. Optional touched surfaces and
 * observations default to empty lanes and never create gaps.
 *
 * @param raw - Untrusted closeout receipt data.
 * @returns A usable closeout receipt, degraded receipt, or validation error.
 *
 * @example
 * ```typescript
 * const parsed = parseCloseoutReceipt(raw)
 * if (parsed.kind === "ok" || parsed.kind === "degraded") {
 *   consume(parsed.receipt, parsed.evidence_gaps)
 * }
 * ```
 */
export function parseCloseoutReceipt(
	raw: unknown,
): ParseCloseoutReceiptResult {
	if (!isRecord(raw)) {
		return { kind: "invalid", path: "$", reason: "expected_object" };
	}
	for (const key of Object.keys(raw)) {
		if (!CLOSEOUT_RECEIPT_FIELD_SET.has(key)) {
			return { kind: "invalid", path: key, reason: "unknown_field" };
		}
	}

	const receipt: Partial<CloseoutReceipt> = {};

	if ("skill" in raw) {
		if (typeof raw.skill !== "string") {
			return { kind: "invalid", path: "skill", reason: "expected_string" };
		}
		receipt.skill = raw.skill;
	}
	if ("outcome" in raw) {
		if (!isSkillFeedbackOutcome(stringFromUnknown(raw.outcome))) {
			return { kind: "invalid", path: "outcome", reason: "invalid_outcome" };
		}
		receipt.outcome = raw.outcome as SkillFeedbackOutcome;
	}
	if ("goal" in raw) {
		if (typeof raw.goal !== "string") {
			return { kind: "invalid", path: "goal", reason: "expected_string" };
		}
		receipt.goal = raw.goal;
	}
	if ("friction" in raw) {
		const friction = parseFrictionSignal(raw.friction, "friction");
		if ("kind" in friction) return friction;
		receipt.friction = friction;
	}
	if ("verification_burden" in raw) {
		const burden = parseVerificationBurden(
			raw.verification_burden,
			"verification_burden",
		);
		if ("kind" in burden) return burden;
		receipt.verification_burden = burden;
	}
	if ("touched_surfaces" in raw) {
		const touchedSurfaces = parseTargets(
			raw.touched_surfaces,
			"touched_surfaces",
			5,
		);
		if ("kind" in touchedSurfaces) return touchedSurfaces;
		receipt.touched_surfaces = touchedSurfaces;
	} else {
		receipt.touched_surfaces = [];
	}
	if ("observations" in raw) {
		const observations = parseObservations(raw.observations);
		if ("kind" in observations) return observations;
		receipt.observations = observations;
	} else {
		receipt.observations = [];
	}
	if ("skill_run_id" in raw) {
		if (typeof raw.skill_run_id !== "string") {
			return {
				kind: "invalid",
				path: "skill_run_id",
				reason: "expected_string",
			};
		}
		receipt.skill_run_id = raw.skill_run_id;
	}

	const evidenceGaps = CLOSEOUT_CORE_GAPS.filter(
		({ field }) => !(field in receipt),
	).map(({ field, code, message }) => evidenceGap(code, field, message));

	if (evidenceGaps.length > 0) {
		return { kind: "degraded", receipt, evidence_gaps: evidenceGaps };
	}
	return {
		kind: "ok",
		receipt: receipt as CloseoutReceipt,
		evidence_gaps: [],
	};
}

/**
 * Normalize v0 and v1 report records into one review model.
 *
 * Review owns interpretation. The normalizer preserves evidence source,
 * separates runtime telemetry from report-card data, and records unavailable
 * cost as a typed gap.
 *
 * @param raw - Unknown on-disk report data.
 * @returns Normalized report or a validation error.
 *
 * @example
 * ```typescript
 * const normalized = normalizeReport(JSON.parse(rawReport))
 * if (normalized.kind === "ok") review(normalized.report)
 * ```
 */
export function normalizeReport(raw: unknown): NormalizeReportResult {
	if (!isRecord(raw)) {
		return { kind: "invalid", path: "$", reason: "expected_object" };
	}
	if ("schema_version" in raw || "report_id" in raw || "report_card" in raw) {
		return normalizeV1Report(raw);
	}
	return normalizeV0Report(raw);
}

/**
 * Validate v2 review output at the contract boundary.
 *
 * @param raw - Unknown JSON value to validate as ReviewResultData v2.
 * @returns A typed v2 review result or the first contract violation.
 *
 * @example
 * ```typescript
 * const result = parseReviewResultData(JSON.parse(stdout).data)
 * if (result.kind === "ok") consumeReview(result.data)
 * ```
 */
export function parseReviewResultData(
	raw: unknown,
): ParseReviewResultDataResult {
	const review = requireReviewRecord(raw, "$");
	if (isReviewResultValidationError(review)) return review;
	const error = validateReviewResultDataShape(review);
	if (error) return error;
	return { kind: "ok", data: review as ReviewResultData };
}

function validateReviewResultDataShape(
	review: Record<string, unknown>,
): ReviewResultValidationError | undefined {
	return [
		validateAllowedKeys(review, REVIEW_RESULT_V2_FIELD_SET),
		validateExpectedValue(
			review.contract,
			SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
			"contract",
			"unsupported",
		),
		validateExpectedValue(
			review.schema_version,
			SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION,
			"schema_version",
			"unsupported",
		),
		validateReviewCoverage(review.coverage),
		validateReviewInboxHealth(review.inbox_health),
		validateReviewHealthProjection(review),
		"read_target" in review
			? validateReviewReadTarget(review.read_target)
			: undefined,
		validateReviewOpenItems(review.open_items),
		validateReviewOpenActions(review.open_actions),
		"no_action" in review ? validateNoAction(review.no_action) : undefined,
		validateReviewRetention(review.retention),
		"pilot_checkpoint" in review
			? validateReviewPilotCheckpoint(review.pilot_checkpoint)
			: undefined,
		validateReviewUnits(review.review_units),
		validateReviewLedgerEntries(review.ledger_entries),
		validateReviewAnchorMissTelemetry(review.anchor_miss_telemetry),
		validateReviewClaimReadiness(review.claim_readiness),
	].find(isReviewResultValidationError);
}

export function parseHealthResultData(
	raw: unknown,
): ParseHealthResultDataResult {
	const health = requireReviewRecord(raw, "$");
	if (isReviewResultValidationError(health)) return health;
	const error = [
		validateAllowedKeys(health, new Set(HEALTH_RESULT_FIELDS)),
		validateExpectedValue(
			health.contract,
			SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
			"contract",
			"unsupported",
		),
		validateExpectedValue(
			health.schema_version,
			SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
			"schema_version",
			"unsupported",
		),
		validateHealthInboxStatus(health.inbox_status),
		validateHealthCounts(health.counts),
		validateHealthNewest(health.newest),
		validateHealthWarnings(health.warnings),
		validateHealthClaimReadiness(health.claim_readiness),
		validateHealthCorrelation(health.correlation),
		validateHealthNextAction(health.next_action),
	].find(isReviewResultValidationError);
	if (error) return error;
	return { kind: "ok", data: health as HealthResultData };
}

export function parsePurgeResultData(
	raw: unknown,
): ParsePurgeResultDataResult {
	if (!isRecord(raw)) {
		return { kind: "invalid", path: "$", reason: "expected_object" };
	}
	const topLevel = validateAllowedKeys(raw, new Set(PURGE_RESULT_FIELDS));
	if (topLevel) return topLevel;
	if (raw.contract !== SKILL_FEEDBACK_PURGE_CONTRACT_ID) {
		return { kind: "invalid", path: "contract", reason: "unsupported" };
	}
	if (raw.schema_version !== SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION) {
		return {
			kind: "invalid",
			path: "schema_version",
			reason: "unsupported",
		};
	}
	if (!isSkillFeedbackPurgeMode(raw.mode)) {
		return { kind: "invalid", path: "mode", reason: "invalid" };
	}
	if (!isSkillFeedbackPurgeLane(raw.lane)) {
		return { kind: "invalid", path: "lane", reason: "invalid" };
	}
	const retention = validatePurgeRetention(raw.retention);
	if (retention) return retention;
	for (const field of [
		"scanned_count",
		"candidate_count",
		"deleted_count",
		"skipped_unsafe_count",
		"invalid_count",
	] as const) {
		const error = validateReviewNumber(raw[field], field);
		if (error) return error;
	}
	for (const field of [
		"candidate_paths",
		"deleted_paths",
		"skipped_paths",
		"invalid_paths",
	] as const) {
		const error = validateReviewStringArray(raw[field], field);
		if (error) return error;
	}
	return { kind: "ok", data: raw as SkillFeedbackPurgeResultData };
}

function normalizeV0Report(raw: Record<string, unknown>): NormalizeReportResult {
	const parsed = parseV0SoftwareLearningReport(raw);
	if (!parsed.ok) return parsed.error;
	const report = parsed.report;
	const captureRuntime = parseOptionalCaptureRuntime(raw.capture_runtime);
	if (captureRuntime && typeof captureRuntime !== "string") return captureRuntime;
	const provenance = parseOptionalSkillIdentityProvenance(
		raw.skill_identity_provenance,
	);
	if (provenance && "kind" in provenance) return provenance;
	const evidenceGaps = uniqueEvidenceGaps([
		...report.gaps
			.filter((field) => field !== "usage")
			.map((field) => v0Gap(field)),
		evidenceGap(
			"cost_unavailable",
			"cost",
			"Skill-attributed cost is unavailable in v1.",
		),
	]);
	const friction = V0_PLACEHOLDER_FRICTION.has(report.friction)
		? undefined
		: { category: "other" as const, note: report.friction };
	const runtime: NormalizedRuntimeTelemetry = {
		git_sha: report.git_sha || undefined,
		skill_version: report.skill_version || undefined,
		model: report.model || undefined,
	};
	if (!report.gaps.includes("usage")) {
		runtime.usage = report.usage;
	}
	return {
		kind: "ok",
		report: {
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
			source_schema_version: "v0",
			report_id: stableReportId("v0", report),
			untrusted_evidence: true,
			generated_ts: report.generated_ts,
			evidence_source: "hook_capture",
			...(captureRuntime ? { capture_runtime: captureRuntime } : {}),
			...(provenance ? { skill_identity_provenance: provenance } : {}),
			correlation_status: "unlinked",
			skill: report.skill,
			outcome: report.outcome,
			goal: report.goal || undefined,
			friction,
			touched_surfaces: [],
			observations: [],
			evidence_gaps: evidenceGaps,
			cost: {
				status: SKILL_FEEDBACK_COST_STATUS.UNAVAILABLE,
				gap_code: "cost_unavailable",
			},
			runtime,
		},
	};
}

function normalizeV1Report(raw: Record<string, unknown>): NormalizeReportResult {
	for (const key of Object.keys(raw)) {
		if (!V1_REPORT_FIELD_SET.has(key)) {
			return { kind: "invalid", path: key, reason: "unknown_field" };
		}
	}
	if (raw.schema_version !== SKILL_FEEDBACK_SCHEMA_VERSION) {
		return { kind: "invalid", path: "schema_version", reason: "unsupported" };
	}
	if (typeof raw.report_id !== "string") {
		return { kind: "invalid", path: "report_id", reason: "expected_string" };
	}
	if (raw.untrusted_evidence !== true) {
		return {
			kind: "invalid",
			path: "untrusted_evidence",
			reason: "expected_true",
		};
	}
	if (typeof raw.generated_ts !== "string") {
		return { kind: "invalid", path: "generated_ts", reason: "expected_string" };
	}
	const evidenceSource = stringFromUnknown(raw.evidence_source);
	if (!isEvidenceSource(evidenceSource)) {
		return {
			kind: "invalid",
			path: "evidence_source",
			reason: "invalid_evidence_source",
		};
	}
	const captureRuntime = parseOptionalCaptureRuntime(raw.capture_runtime);
	if (captureRuntime && typeof captureRuntime !== "string") return captureRuntime;
	const provenance = parseOptionalSkillIdentityProvenance(
		raw.skill_identity_provenance,
	);
	if (provenance && "kind" in provenance) return provenance;
	const correlationStatus = stringFromUnknown(raw.correlation_status);
	if (!isCorrelationStatus(correlationStatus)) {
		return {
			kind: "invalid",
			path: "correlation_status",
			reason: "invalid_correlation_status",
		};
	}
	if (
		"skill_run_id" in raw &&
		raw.skill_run_id !== undefined &&
		typeof raw.skill_run_id !== "string"
	) {
		return {
			kind: "invalid",
			path: "skill_run_id",
			reason: "expected_string",
		};
	}
	const skillRunIdProvenance = parseOptionalSkillRunIdProvenance(
		raw.skill_run_id_provenance,
	);
	if (skillRunIdProvenance && typeof skillRunIdProvenance !== "string") {
		return skillRunIdProvenance;
	}
	if (skillRunIdProvenance && !raw.skill_run_id) {
		return {
			kind: "invalid",
			path: "skill_run_id_provenance",
			reason: "missing_skill_run_id",
		};
	}
	const runtime = parseRuntimeTelemetry(raw.runtime);
	if ("kind" in runtime) return runtime;
	const reportCard = parseCloseoutReceipt(raw.report_card);
	if (reportCard.kind === "invalid") {
		return {
			kind: "invalid",
			path: `report_card.${reportCard.path}`,
			reason: reportCard.reason,
		};
	}
	const rawEvidenceGaps = parseEvidenceGaps(raw.evidence_gaps);
	if ("kind" in rawEvidenceGaps) return rawEvidenceGaps;
	const evidenceGaps = uniqueEvidenceGaps([
		...rawEvidenceGaps,
		...reportCard.evidence_gaps,
		evidenceGap(
			"cost_unavailable",
			"cost",
			"Skill-attributed cost is unavailable in v1.",
		),
	]);
	return {
		kind: "ok",
		report: {
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
			source_schema_version: "v1",
			report_id: raw.report_id,
			untrusted_evidence: true,
			generated_ts: raw.generated_ts,
			evidence_source: evidenceSource,
			...(captureRuntime ? { capture_runtime: captureRuntime } : {}),
			...(provenance ? { skill_identity_provenance: provenance } : {}),
			correlation_status: correlationStatus,
			skill_run_id: raw.skill_run_id as string | undefined,
			// Raw inbox JSON is evidence, not writer-owned proof. Keep the id as
			// inspectable context, but do not let persisted provenance labels mint a
			// trusted review unit.
			skill: reportCard.receipt.skill ?? "",
			outcome: reportCard.receipt.outcome ?? "ambiguous",
			goal: reportCard.receipt.goal,
			friction: reportCard.receipt.friction,
			verification_burden: reportCard.receipt.verification_burden,
			touched_surfaces: reportCard.receipt.touched_surfaces ?? [],
			observations: reportCard.receipt.observations ?? [],
			evidence_gaps: evidenceGaps,
			cost: {
				status: SKILL_FEEDBACK_COST_STATUS.UNAVAILABLE,
				gap_code: "cost_unavailable",
			},
			runtime,
		},
	};
}

function parseV0SoftwareLearningReport(
	raw: Record<string, unknown>,
):
	| { ok: true; report: SoftwareLearningReport }
	| { ok: false; error: NormalizeReportResult } {
	const rawGaps = parseV0ReceiptGaps(raw.gaps);
	if ("kind" in rawGaps) return { ok: false, error: rawGaps };
	const receiptInput: Record<string, unknown> = {
		skill: raw.skill,
		goal: raw.goal,
		outcome: raw.outcome,
		friction: raw.friction,
		skill_version: raw.skill_version,
		git_sha: raw.git_sha,
		model: raw.model,
		usage: raw.usage,
		generated_ts: raw.generated_ts,
	};
	if (raw.explanation !== undefined && raw.explanation !== null) {
		receiptInput.explanation = raw.explanation;
	}
	const parsed = parseReceipt(receiptInput);
	if (parsed.kind !== "ok" && parsed.kind !== "degraded") {
		return {
			ok: false,
			error: {
				kind: "invalid",
				path: parsed.kind === "unknown-field" ? parsed.field : parsed.field,
				reason: parsed.kind,
			},
		};
	}
	const report = {
		...buildSoftwareLearningReport(parsed),
		degraded: raw.degraded === true || rawGaps.length > 0,
		gaps:
			rawGaps.length > 0
				? rawGaps
				: parsed.kind === "degraded"
					? parsed.gaps
					: [],
	};
	return { ok: true, report };
}

function parseV0ReceiptGaps(
	raw: unknown,
): readonly ReceiptField[] | NormalizeReportResult {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		return { kind: "invalid", path: "gaps", reason: "expected_array" };
	}
	const gaps: ReceiptField[] = [];
	for (const [index, gap] of raw.entries()) {
		if (!RECEIPT_FIELD_SET.has(String(gap))) {
			return {
				kind: "invalid",
				path: `gaps[${index}]`,
				reason: "invalid_gap",
			};
		}
		gaps.push(gap as ReceiptField);
	}
	return gaps;
}

function parseFrictionSignal(
	raw: unknown,
	path: string,
): FrictionSignal | ParseCloseoutReceiptResult {
	if (!isRecord(raw)) return { kind: "invalid", path, reason: "expected_object" };
	const keys = Object.keys(raw);
	for (const key of keys) {
		if (key !== "category" && key !== "note") {
			return {
				kind: "invalid",
				path: `${path}.${key}`,
				reason: "unknown_field",
			};
		}
	}
	const category = stringFromUnknown(raw.category);
	if (!isFrictionCategory(category)) {
		return {
			kind: "invalid",
			path: `${path}.category`,
			reason: "invalid_category",
		};
	}
	if (typeof raw.note !== "string") {
		return {
			kind: "invalid",
			path: `${path}.note`,
			reason: "expected_string",
		};
	}
	return { category, note: raw.note };
}

function parseVerificationBurden(
	raw: unknown,
	path: string,
): VerificationBurden | ParseCloseoutReceiptResult {
	if (!isRecord(raw)) return { kind: "invalid", path, reason: "expected_object" };
	for (const key of Object.keys(raw)) {
		if (key !== "level" && key !== "note") {
			return {
				kind: "invalid",
				path: `${path}.${key}`,
				reason: "unknown_field",
			};
		}
	}
	const level = stringFromUnknown(raw.level);
	if (!isVerificationBurdenLevel(level)) {
		return {
			kind: "invalid",
			path: `${path}.level`,
			reason: "invalid_level",
		};
	}
	if (typeof raw.note !== "string") {
		return {
			kind: "invalid",
			path: `${path}.note`,
			reason: "expected_string",
		};
	}
	return { level, note: raw.note };
}

function parseTargets(
	raw: unknown,
	path: string,
	max: number,
): readonly ReportCardTarget[] | ParseCloseoutReceiptResult {
	if (!Array.isArray(raw)) {
		return { kind: "invalid", path, reason: "expected_array" };
	}
	if (raw.length > max) {
		return { kind: "invalid", path, reason: `max_${max}` };
	}
	const targets: ReportCardTarget[] = [];
	for (const [index, targetRaw] of raw.entries()) {
		const target = parseTarget(targetRaw, `${path}[${index}]`);
		if ("kind" in target) return target;
		targets.push(target);
	}
	return targets;
}

function parseTarget(
	raw: unknown,
	path: string,
): ReportCardTarget | ParseCloseoutReceiptResult {
	if (!isRecord(raw)) return { kind: "invalid", path, reason: "expected_object" };
	for (const key of Object.keys(raw)) {
		if (key !== "type" && key !== "value") {
			return {
				kind: "invalid",
				path: `${path}.${key}`,
				reason: "unknown_field",
			};
		}
	}
	if (raw.type !== "path" && raw.type !== "label") {
		return { kind: "invalid", path: `${path}.type`, reason: "invalid_type" };
	}
	if (typeof raw.value !== "string" || raw.value.trim() === "") {
		return {
			kind: "invalid",
			path: `${path}.value`,
			reason: "expected_string",
		};
	}
	if (raw.type === "path" && !isValidOwnerPath(raw.value)) {
		return {
			kind: "invalid",
			path: `${path}.value`,
			reason: "invalid_owner_path",
		};
	}
	return { type: raw.type, value: raw.value };
}

function parseObservations(
	raw: unknown,
): readonly ReportCardObservation[] | ParseCloseoutReceiptResult {
	if (!Array.isArray(raw)) {
		return { kind: "invalid", path: "observations", reason: "expected_array" };
	}
	if (raw.length > 3) {
		return { kind: "invalid", path: "observations", reason: "max_3" };
	}
	const observations: ReportCardObservation[] = [];
	for (const [index, observationRaw] of raw.entries()) {
		const observation = parseObservation(observationRaw, index);
		if ("kind" in observation && observation.kind === "invalid") {
			return observation;
		}
		observations.push(observation as ReportCardObservation);
	}
	return observations;
}

function parseObservation(
	raw: unknown,
	index: number,
): ReportCardObservation | ParseCloseoutReceiptResult {
	const path = `observations[${index}]`;
	if (!isRecord(raw)) return { kind: "invalid", path, reason: "expected_object" };
	for (const blocked of [
		"confidence",
		"severity",
		"next_action",
		"repair_instruction",
	]) {
		if (blocked in raw) {
			return {
				kind: "invalid",
				path: `${path}.${blocked}`,
				reason: "not_allowed",
			};
		}
	}
	for (const key of Object.keys(raw)) {
		if (
			key !== "kind" &&
			key !== "target" &&
			key !== "summary" &&
			key !== "evidence_basis"
		) {
			return {
				kind: "invalid",
				path: `${path}.${key}`,
				reason: "unknown_field",
			};
		}
	}
	const kind = stringFromUnknown(raw.kind);
	if (!isObservationKind(kind)) {
		return { kind: "invalid", path: `${path}.kind`, reason: "invalid_kind" };
	}
	if (typeof raw.summary !== "string") {
		return {
			kind: "invalid",
			path: `${path}.summary`,
			reason: "expected_string",
		};
	}
	const evidenceBasis = stringFromUnknown(raw.evidence_basis);
	if (!isObservationEvidenceBasis(evidenceBasis)) {
		return {
			kind: "invalid",
			path: `${path}.evidence_basis`,
			reason: "invalid_evidence_basis",
		};
	}
	let target: ReportCardTarget | undefined;
	if ("target" in raw) {
		const parsedTarget = parseTarget(raw.target, `${path}.target`);
		if ("kind" in parsedTarget) return parsedTarget;
		target = parsedTarget;
	}
	return {
		kind,
		target,
		summary: raw.summary,
		evidence_basis: evidenceBasis,
	};
}

function parseRuntimeTelemetry(
	raw: unknown,
): NormalizedRuntimeTelemetry | NormalizeReportResult {
	if (!isRecord(raw)) {
		return { kind: "invalid", path: "runtime", reason: "expected_object" };
	}
	const runtime: NormalizedRuntimeTelemetry = {};
	for (const key of Object.keys(raw)) {
		if (key !== "git_sha" && key !== "skill_version" && key !== "model" && key !== "usage") {
			return {
				kind: "invalid",
				path: `runtime.${key}`,
				reason: "unknown_field",
			};
		}
	}
	for (const key of ["git_sha", "skill_version", "model"] as const) {
		if (key in raw) {
			if (typeof raw[key] !== "string") {
				return {
					kind: "invalid",
					path: `runtime.${key}`,
					reason: "expected_string",
				};
			}
			runtime[key] = raw[key];
		}
	}
	if ("usage" in raw) {
		if (!isReceiptUsage(raw.usage)) {
			return { kind: "invalid", path: "runtime.usage", reason: "invalid_usage" };
		}
		runtime.usage = raw.usage;
	}
	return runtime;
}

function parseEvidenceGaps(
	raw: unknown,
): readonly EvidenceGap[] | NormalizeReportResult {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		return { kind: "invalid", path: "evidence_gaps", reason: "expected_array" };
	}
	const gaps: EvidenceGap[] = [];
	for (const [index, gapRaw] of raw.entries()) {
		if (!isRecord(gapRaw)) {
			return {
				kind: "invalid",
				path: `evidence_gaps[${index}]`,
				reason: "expected_object",
			};
		}
		const code = stringFromUnknown(gapRaw.code);
		if (!isEvidenceGapCode(code)) {
			return {
				kind: "invalid",
				path: `evidence_gaps[${index}].code`,
				reason: "invalid_gap_code",
			};
		}
		if (typeof gapRaw.path !== "string") {
			return {
				kind: "invalid",
				path: `evidence_gaps[${index}].path`,
				reason: "expected_string",
			};
		}
		if (typeof gapRaw.message !== "string") {
			return {
				kind: "invalid",
				path: `evidence_gaps[${index}].message`,
				reason: "expected_string",
			};
		}
		gaps.push({ code, path: gapRaw.path, message: gapRaw.message });
	}
	return gaps;
}

type ReviewResultValidationError = Extract<
	ParseReviewResultDataResult,
	{ kind: "invalid" }
>;

function reviewResultError(
	path: string,
	reason: string,
): ReviewResultValidationError {
	return { kind: "invalid", path, reason };
}

function validateAllowedKeys(
	raw: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	pathPrefix = "",
): ReviewResultValidationError | undefined {
	for (const key of Object.keys(raw)) {
		if (!allowed.has(key)) {
			return reviewResultError(
				pathPrefix ? `${pathPrefix}.${key}` : key,
				"unknown_field",
			);
		}
	}
}

function requireReviewRecord(
	raw: unknown,
	path: string,
): Record<string, unknown> | ReviewResultValidationError {
	if (!isRecord(raw)) return reviewResultError(path, "expected_object");
	return raw;
}

function isReviewResultValidationError(
	value: unknown,
): value is ReviewResultValidationError {
	return (
		isRecord(value) &&
		value.kind === "invalid" &&
		typeof value.path === "string" &&
		typeof value.reason === "string"
	);
}

function isInvalidCloseoutParseResult(
	value: unknown,
): value is Extract<ParseCloseoutReceiptResult, { kind: "invalid" }> {
	return isReviewResultValidationError(value);
}

function validateReviewString(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	if (typeof raw !== "string") return reviewResultError(path, "expected_string");
}

function validateReviewNumber(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	if (typeof raw !== "number" || !Number.isFinite(raw)) {
		return reviewResultError(path, "expected_number");
	}
}

function validateReviewBoolean(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	if (typeof raw !== "boolean") return reviewResultError(path, "expected_boolean");
}

function validateExpectedValue(
	raw: unknown,
	expected: unknown,
	path: string,
	reason: string,
): ReviewResultValidationError | undefined {
	if (raw !== expected) return reviewResultError(path, reason);
}

function validateReviewStringArray(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError(path, "expected_array");
	for (const [index, value] of raw.entries()) {
		const error = validateReviewString(value, `${path}[${index}]`);
		if (error) return error;
	}
}

function validateReviewTargets(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError(path, "expected_array");
	for (const [index, targetRaw] of raw.entries()) {
		const target = parseTarget(targetRaw, `${path}[${index}]`);
		if (isInvalidCloseoutParseResult(target)) {
			return reviewResultError(target.path, target.reason);
		}
	}
}

function validateReviewCoverage(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const coverage = requireReviewRecord(raw, "coverage");
	if (isReviewResultValidationError(coverage)) return coverage;
	const unknown = validateAllowedKeys(
		coverage,
		new Set(REVIEW_COVERAGE_FIELDS),
		"coverage",
	);
	if (unknown) return unknown;
	for (const field of [
		"total_reports",
		"closeout_count",
		"capture_only_count",
		"unlinked_count",
		"evidence_gap_count",
		"closeout_rate",
	] as const) {
		const error = validateReviewNumber(coverage[field], `coverage.${field}`);
		if (error) return error;
	}
	const lowCoverage = validateReviewBoolean(
		coverage.low_coverage,
		"coverage.low_coverage",
	);
	if (lowCoverage) return lowCoverage;
	if ("low_coverage_warning" in coverage) {
		return validateReviewString(
			coverage.low_coverage_warning,
			"coverage.low_coverage_warning",
		);
	}
}

function validateReviewInboxHealth(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const health = requireReviewRecord(raw, "inbox_health");
	if (isReviewResultValidationError(health)) return health;
	const unknown = validateAllowedKeys(
		health,
		new Set(REVIEW_INBOX_HEALTH_FIELDS),
		"inbox_health",
	);
	if (unknown) return unknown;
	for (const field of [
		"primary_count",
		"low_signal_count",
		"skipped_unsafe_count",
		"invalid_count",
	] as const) {
		const error = validateReviewNumber(health[field], `inbox_health.${field}`);
		if (error) return error;
	}
	if ("low_signal_newest_generated_ts" in health) {
		const newest = validateReviewString(
			health.low_signal_newest_generated_ts,
			"inbox_health.low_signal_newest_generated_ts",
		);
		if (newest) return newest;
	}
	return validateReviewStringArray(
		health.low_signal_reason_ids,
		"inbox_health.low_signal_reason_ids",
	);
}

function validateReviewHealthProjection(
	raw: Record<string, unknown>,
): ReviewResultValidationError | undefined {
	return [
		validateHealthInboxStatus(raw.inbox_status),
		validateHealthCounts(raw.counts),
		validateHealthWarnings(raw.warnings),
		validateHealthNextAction(raw.next_action),
	].find(isReviewResultValidationError);
}

function validateReviewReadTarget(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const target = requireReviewRecord(raw, "read_target");
	if (isReviewResultValidationError(target)) return target;
	return [
		validateAllowedKeys(target, new Set(REVIEW_READ_TARGET_FIELDS), "read_target"),
		validateReviewBoolean(target.explicit, "read_target.explicit"),
		validateReviewString(target.repo_root, "read_target.repo_root"),
		validateReviewString(target.inbox_path, "read_target.inbox_path"),
		"target_path" in target
			? validateReviewString(target.target_path, "read_target.target_path")
			: undefined,
	].find(isReviewResultValidationError);
}

function validatePurgeRetention(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const retention = requireReviewRecord(raw, "retention");
	if (isReviewResultValidationError(retention)) return retention;
	const kind = retention.kind;
	if (kind === "older_than") {
		const unknown = validateAllowedKeys(
			retention,
			new Set(["kind", "older_than", "cutoff_ts"]),
			"retention",
		);
		if (unknown) return unknown;
		for (const field of ["older_than", "cutoff_ts"] as const) {
			const error = validateReviewString(
				retention[field],
				`retention.${field}`,
			);
			if (error) return error;
		}
		return;
	}
	if (kind === "keep_latest") {
		const unknown = validateAllowedKeys(
			retention,
			new Set(["kind", "keep_latest"]),
			"retention",
		);
		if (unknown) return unknown;
		return validateReviewNumber(
			retention.keep_latest,
			"retention.keep_latest",
		);
	}
	return reviewResultError("retention.kind", "invalid");
}

function validateReviewOpenItems(
	raw: unknown,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError("open_items", "expected_array");
	for (const [index, itemRaw] of raw.entries()) {
		const path = `open_items[${index}]`;
		const item = requireReviewRecord(itemRaw, path);
		if (isReviewResultValidationError(item)) return item;
		const unknown = validateAllowedKeys(
			item,
			new Set(REVIEW_OPEN_ITEM_FIELDS),
			path,
		);
		if (unknown) return unknown;
		if (!isReviewOpenReason(item.open_reason)) {
			return reviewResultError(`${path}.open_reason`, "invalid_open_reason");
		}
		if (!isReviewOpenSeverity(item.severity)) {
			return reviewResultError(`${path}.severity`, "invalid_severity");
		}
		for (const field of ["evidence", "next_action"] as const) {
			const error = validateReviewString(item[field], `${path}.${field}`);
			if (error) return error;
		}
		const evidenceRefs = validateReviewStringArray(
			item.evidence_refs,
			`${path}.evidence_refs`,
		);
		if (evidenceRefs) return evidenceRefs;
		if ("target" in item) {
			const target = parseTarget(item.target, `${path}.target`);
			if (isInvalidCloseoutParseResult(target)) {
				return reviewResultError(target.path, target.reason);
			}
		}
	}
}

function validateReviewOpenActions(
	raw: unknown,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) {
		return reviewResultError("open_actions", "expected_array");
	}
	for (const [index, actionRaw] of raw.entries()) {
		const path = `open_actions[${index}]`;
		const action = requireReviewRecord(actionRaw, path);
		if (isReviewResultValidationError(action)) return action;
		const unknown = validateAllowedKeys(
			action,
			new Set(REVIEW_OPEN_ACTION_FIELDS),
			path,
		);
		if (unknown) return unknown;
		for (const field of ["action_key", "next_safe_action"] as const) {
			const error = validateReviewString(action[field], `${path}.${field}`);
			if (error) return error;
		}
		if (!isReviewOpenReason(action.open_reason)) {
			return reviewResultError(`${path}.open_reason`, "invalid_open_reason");
		}
		if ("target" in action) {
			const target = parseTarget(action.target, `${path}.target`);
			if (isInvalidCloseoutParseResult(target)) {
				return reviewResultError(target.path, target.reason);
			}
		}
		const evidenceRefs = validateReviewStringArray(
			action.evidence_refs,
			`${path}.evidence_refs`,
		);
		if (evidenceRefs) return evidenceRefs;
	}
}

function validateNoAction(raw: unknown): ReviewResultValidationError | undefined {
	const noAction = requireReviewRecord(raw, "no_action");
	if (isReviewResultValidationError(noAction)) return noAction;
	const unknown = validateAllowedKeys(
		noAction,
		new Set(["rationale"]),
		"no_action",
	);
	if (unknown) return unknown;
	return validateReviewString(noAction.rationale, "no_action.rationale");
}

function validateReviewRetention(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const retention = requireReviewRecord(raw, "retention");
	if (isReviewResultValidationError(retention)) return retention;
	const unknown = validateAllowedKeys(
		retention,
		new Set(REVIEW_RETENTION_FIELDS),
		"retention",
	);
	if (unknown) return unknown;
	const reportCount = validateReviewNumber(
		retention.report_count,
		"retention.report_count",
	);
	if (reportCount) return reportCount;
	if ("oldest_report_age_days" in retention) {
		const age = validateReviewNumber(
			retention.oldest_report_age_days,
			"retention.oldest_report_age_days",
		);
		if (age) return age;
	}
	for (const field of ["warning", "future_purge_action"] as const) {
		if (field in retention) {
			const error = validateReviewString(retention[field], `retention.${field}`);
			if (error) return error;
		}
	}
}

function validateReviewPilotCheckpoint(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const checkpoint = requireReviewRecord(raw, "pilot_checkpoint");
	if (isReviewResultValidationError(checkpoint)) return checkpoint;
	const unknown = validateAllowedKeys(
		checkpoint,
		new Set(REVIEW_PILOT_CHECKPOINT_FIELDS),
		"pilot_checkpoint",
	);
	if (unknown) return unknown;
	const startedAt = validateReviewString(
		checkpoint.started_at,
		"pilot_checkpoint.started_at",
	);
	if (startedAt) return startedAt;
	for (const field of [
		"age_days",
		"actionable_feedback_numerator",
		"material_closeout_denominator",
		"density",
	] as const) {
		const error = validateReviewNumber(
			checkpoint[field],
			`pilot_checkpoint.${field}`,
		);
		if (error) return error;
	}
	return validateReviewString(
		checkpoint.next_action,
		"pilot_checkpoint.next_action",
	);
}

function validateReviewUnits(
	raw: unknown,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError("review_units", "expected_array");
	for (const [index, unitRaw] of raw.entries()) {
		const path = `review_units[${index}]`;
		const unit = requireReviewRecord(unitRaw, path);
		if (isReviewResultValidationError(unit)) return unit;
		const unknown = validateAllowedKeys(unit, new Set(REVIEW_UNIT_FIELDS), path);
		if (unknown) return unknown;
		const key = validateReviewString(
			unit.review_unit_key,
			`${path}.review_unit_key`,
		);
		if (key) return key;
		const reportIds = validateReviewStringArray(
			unit.report_ids,
			`${path}.report_ids`,
		);
		if (reportIds) return reportIds;
		const trustedRun = validateReviewBoolean(
			unit.trusted_run,
			`${path}.trusted_run`,
		);
		if (trustedRun) return trustedRun;
		if ("trusted_skill_run_id" in unit) {
			const trustedId = validateReviewString(
				unit.trusted_skill_run_id,
				`${path}.trusted_skill_run_id`,
			);
			if (trustedId) return trustedId;
		}
	}
}

function validateReviewLedgerEntries(
	raw: unknown,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) {
		return reviewResultError("ledger_entries", "expected_array");
	}
	for (const [index, entryRaw] of raw.entries()) {
		const path = `ledger_entries[${index}]`;
		const entry = requireReviewRecord(entryRaw, path);
		if (isReviewResultValidationError(entry)) return entry;
		const unknown = validateAllowedKeys(
			entry,
			new Set(REVIEW_LEDGER_ENTRY_FIELDS),
			path,
		);
		if (unknown) return unknown;
		for (const field of ["ledger_entry_key", "next_safe_action"] as const) {
			const error = validateReviewString(entry[field], `${path}.${field}`);
			if (error) return error;
		}
		for (const field of ["review_unit_keys", "owner_paths"] as const) {
			const error = validateReviewStringArray(entry[field], `${path}.${field}`);
			if (error) return error;
		}
		const ownerPaths = entry.owner_paths;
		if (Array.isArray(ownerPaths)) {
			for (const [ownerIndex, ownerPath] of ownerPaths.entries()) {
				if (typeof ownerPath === "string" && !isValidOwnerPath(ownerPath)) {
					return reviewResultError(
						`${path}.owner_paths[${ownerIndex}]`,
						"invalid_owner_path",
					);
				}
			}
		}
		if (!isReviewAnchorStrength(entry.anchor_strength)) {
			return reviewResultError(`${path}.anchor_strength`, "invalid_anchor_strength");
		}
		if (entry.anchor_strength === "strong_path") {
			if (typeof entry.ledger_anchor_key !== "string") {
				return reviewResultError(
					`${path}.ledger_anchor_key`,
					"required_for_strong_path",
				);
			}
			if ("weak_anchor_reason" in entry) {
				return reviewResultError(
					`${path}.weak_anchor_reason`,
					"forbidden_for_strong_path",
				);
			}
		}
		if (entry.anchor_strength === "weak") {
			if ("ledger_anchor_key" in entry) {
				return reviewResultError(
					`${path}.ledger_anchor_key`,
					"forbidden_for_weak_anchor",
				);
			}
			if (!isReviewWeakAnchorReason(entry.weak_anchor_reason)) {
				return reviewResultError(
					`${path}.weak_anchor_reason`,
					entry.weak_anchor_reason === undefined
						? "required_for_weak_anchor"
						: "invalid_weak_anchor_reason",
				);
			}
		}
		const attemptedTargets = validateReviewTargets(
			entry.attempted_targets,
			`${path}.attempted_targets`,
		);
		if (attemptedTargets) return attemptedTargets;
		if (!isReviewEvidenceTier(entry.evidence_tier)) {
			return reviewResultError(`${path}.evidence_tier`, "invalid_evidence_tier");
		}
		const sourceMix = validateEnumArray(
			entry.source_mix,
			`${path}.source_mix`,
			isEvidenceSource,
			"invalid_evidence_source",
		);
		if (sourceMix) return sourceMix;
		const runtimeMix = validateEnumArray(
			entry.capture_runtime_mix,
			`${path}.capture_runtime_mix`,
			isCaptureRuntime,
			"invalid_capture_runtime",
		);
		if (runtimeMix) return runtimeMix;
		const allowedClaims = validateEnumArray(
			entry.allowed_claims,
			`${path}.allowed_claims`,
			isReviewAllowedClaim,
			"invalid_allowed_claim",
		);
		if (allowedClaims) return allowedClaims;
		if (!isReviewResolutionState(entry.resolution_state)) {
			return reviewResultError(
				`${path}.resolution_state`,
				"invalid_resolution_state",
			);
		}
		const burden = validateReviewLedgerVerificationBurden(
			entry.verification_burden,
			`${path}.verification_burden`,
		);
		if (burden) return burden;
	}
}

function validateEnumArray(
	raw: unknown,
	path: string,
	check: (value: unknown) => boolean,
	reason: string,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError(path, "expected_array");
	for (const [index, value] of raw.entries()) {
		if (!check(value)) return reviewResultError(`${path}[${index}]`, reason);
	}
}

function validateReviewLedgerVerificationBurden(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	const burden = requireReviewRecord(raw, path);
	if (isReviewResultValidationError(burden)) return burden;
	const unknown = validateAllowedKeys(
		burden,
		new Set(REVIEW_LEDGER_VERIFICATION_BURDEN_FIELDS),
		path,
	);
	if (unknown) return unknown;
	if (!isReviewLedgerVerificationLevel(burden.level)) {
		return reviewResultError(`${path}.level`, "invalid_level");
	}
	if ("note" in burden) {
		return validateReviewString(burden.note, `${path}.note`);
	}
}

function validateReviewAnchorMissTelemetry(
	raw: unknown,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) {
		return reviewResultError("anchor_miss_telemetry", "expected_array");
	}
	for (const [index, telemetryRaw] of raw.entries()) {
		const path = `anchor_miss_telemetry[${index}]`;
		const telemetry = requireReviewRecord(telemetryRaw, path);
		if (isReviewResultValidationError(telemetry)) return telemetry;
		const unknown = validateAllowedKeys(
			telemetry,
			new Set(REVIEW_ANCHOR_MISS_TELEMETRY_FIELDS),
			path,
		);
		if (unknown) return unknown;
		if (!isReviewWeakAnchorReason(telemetry.weak_anchor_reason)) {
			return reviewResultError(
				`${path}.weak_anchor_reason`,
				"invalid_weak_anchor_reason",
			);
		}
		const count = validateReviewNumber(telemetry.count, `${path}.count`);
		if (count) return count;
		const targets = validateReviewTargets(
			telemetry.attempted_targets,
			`${path}.attempted_targets`,
		);
		if (targets) return targets;
	}
}

function validateReviewClaimReadiness(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const readiness = requireReviewRecord(raw, "claim_readiness");
	if (isReviewResultValidationError(readiness)) return readiness;
	const unknown = validateAllowedKeys(
		readiness,
		new Set(REVIEW_CLAIM_READINESS_FIELDS),
		"claim_readiness",
	);
	if (unknown) return unknown;
	for (const field of REVIEW_CLAIM_READINESS_FIELDS) {
		const error = validateReviewClaimReadinessFact(
			readiness[field],
			`claim_readiness.${field}`,
		);
		if (error) return error;
	}
}

function validateReviewClaimReadinessFact(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	const fact = requireReviewRecord(raw, path);
	if (isReviewResultValidationError(fact)) return fact;
	const unknown = validateAllowedKeys(
		fact,
		new Set(REVIEW_CLAIM_READINESS_FACT_FIELDS),
		path,
	);
	if (unknown) return unknown;
	if (!isReviewClaimReadinessStatus(fact.status)) {
		return reviewResultError(`${path}.status`, "invalid_readiness_status");
	}
	const reasonIds = validateReviewStringArray(
		fact.reason_ids,
		`${path}.reason_ids`,
	);
	if (reasonIds) return reasonIds;
	return validateReviewStringArray(fact.evidence_refs, `${path}.evidence_refs`);
}

function validateHealthInboxStatus(
	raw: unknown,
): ReviewResultValidationError | undefined {
	if (!isHealthInboxStatus(raw)) return reviewResultError("inbox_status", "invalid");
}

function validateHealthCounts(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const counts = requireReviewRecord(raw, "counts");
	if (isReviewResultValidationError(counts)) return counts;
	return [
		validateAllowedKeys(counts, new Set(HEALTH_COUNTS_FIELDS), "counts"),
		validateNumberFields(counts, HEALTH_COUNTS_FIELDS, "counts"),
	].find(isReviewResultValidationError);
}

function validateHealthNewest(raw: unknown): ReviewResultValidationError | undefined {
	const newest = requireReviewRecord(raw, "newest");
	if (isReviewResultValidationError(newest)) return newest;
	return [
		validateAllowedKeys(newest, new Set(HEALTH_NEWEST_FIELDS), "newest"),
		validateOptionalStringFields(newest, HEALTH_NEWEST_FIELDS, "newest"),
	].find(isReviewResultValidationError);
}

function validateHealthWarnings(
	raw: unknown,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError("warnings", "expected_array");
	return raw
		.map((warningRaw, index) =>
			validateHealthWarning(warningRaw, `warnings[${index}]`),
		)
		.find(isReviewResultValidationError);
}

function validateHealthWarning(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	const warning = requireReviewRecord(raw, path);
	if (isReviewResultValidationError(warning)) return warning;
	return [
		validateAllowedKeys(warning, new Set(HEALTH_WARNING_FIELDS), path),
		isHealthWarningReasonId(warning.reason_id)
			? undefined
			: reviewResultError(`${path}.reason_id`, "invalid_warning_reason"),
		validateReviewString(warning.summary, `${path}.summary`),
	].find(isReviewResultValidationError);
}

function validateHealthClaimReadiness(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const readiness = requireReviewRecord(raw, "claim_readiness");
	if (isReviewResultValidationError(readiness)) return readiness;
	return [
		validateAllowedKeys(
			readiness,
			new Set(HEALTH_CLAIM_READINESS_FIELDS),
			"claim_readiness",
		),
		...HEALTH_CLAIM_READINESS_FIELDS.map((field) =>
			validateHealthReadinessFact(
				readiness[field],
				`claim_readiness.${field}`,
			),
		),
	].find(isReviewResultValidationError);
}

function validateHealthReadinessFact(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	const fact = requireReviewRecord(raw, path);
	if (isReviewResultValidationError(fact)) return fact;
	const unknown = validateAllowedKeys(
		fact,
		new Set(HEALTH_READINESS_FACT_FIELDS),
		path,
	);
	if (unknown) return unknown;
	if (!isHealthReadinessStatus(fact.status)) {
		return reviewResultError(`${path}.status`, "invalid_readiness_status");
	}
	return validateReviewStringArray(fact.reason_ids, `${path}.reason_ids`);
}

function validateHealthCorrelation(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const correlation = requireReviewRecord(raw, "correlation");
	if (isReviewResultValidationError(correlation)) return correlation;
	return [
		validateAllowedKeys(
			correlation,
			new Set(HEALTH_CORRELATION_FIELDS),
			"correlation",
		),
		isHealthCorrelationStatus(correlation.status)
			? undefined
			: reviewResultError("correlation.status", "invalid_correlation_status"),
		validateNumberFields(
			correlation,
			["linked_primary_count", "unlinked_primary_count"] as const,
			"correlation",
		),
	].find(isReviewResultValidationError);
}

function validateHealthNextAction(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const nextAction = requireReviewRecord(raw, "next_action");
	if (isReviewResultValidationError(nextAction)) return nextAction;
	const unknown = validateAllowedKeys(
		nextAction,
		new Set(HEALTH_NEXT_ACTION_FIELDS),
		"next_action",
	);
	if (unknown) return unknown;
	if (!isHealthNextActionId(nextAction.action_id)) {
		return reviewResultError("next_action.action_id", "invalid_action_id");
	}
	return validateReviewString(nextAction.summary, "next_action.summary");
}

function validateNumberFields<const Field extends readonly string[]>(
	record: Record<string, unknown>,
	fields: Field,
	pathPrefix: string,
): ReviewResultValidationError | undefined {
	return fields
		.map((field) => validateReviewNumber(record[field], `${pathPrefix}.${field}`))
		.find(isReviewResultValidationError);
}

function validateOptionalStringFields<const Field extends readonly string[]>(
	record: Record<string, unknown>,
	fields: Field,
	pathPrefix: string,
): ReviewResultValidationError | undefined {
	return fields
		.map((field) =>
			field in record
				? validateReviewString(record[field], `${pathPrefix}.${field}`)
				: undefined,
		)
		.find(isReviewResultValidationError);
}

function v0Gap(field: ReceiptField): EvidenceGap {
	switch (field) {
		case "skill":
			return evidenceGap("missing_skill", field, "v0 record is missing skill.");
		case "outcome":
			return evidenceGap("missing_outcome", field, "v0 record is missing outcome.");
		case "goal":
			return evidenceGap("missing_goal", field, "v0 record is missing goal.");
		case "friction":
			return evidenceGap("missing_friction", field, "v0 record is missing friction.");
		case "model":
			return evidenceGap(
				"missing_runtime_model",
				field,
				"v0 record is missing model.",
			);
		case "git_sha":
			return evidenceGap(
				"missing_runtime_git_sha",
				field,
				"v0 record is missing git SHA.",
			);
		case "skill_version":
			return evidenceGap(
				"missing_runtime_skill_version",
				field,
				"v0 record is missing skill version.",
			);
		default:
			return evidenceGap(
				"cost_unavailable",
				field,
				"v0 record does not carry trusted skill-attributed cost.",
			);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFromUnknown(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isSkillFeedbackOutcome(value: unknown): value is SkillFeedbackOutcome {
	return (SKILL_FEEDBACK_OUTCOMES as readonly unknown[]).includes(value);
}

function isEvidenceSource(value: unknown): value is EvidenceSource {
	return (SKILL_FEEDBACK_EVIDENCE_SOURCES as readonly unknown[]).includes(value);
}

function isReviewOpenReason(value: unknown): value is ReviewOpenReason {
	return (REVIEW_OPEN_REASONS as readonly unknown[]).includes(value);
}

function isReviewOpenSeverity(
	value: unknown,
): value is ReviewOpenItem["severity"] {
	return value === "info" || value === "warning" || value === "action";
}

function isReviewEvidenceTier(value: unknown): value is ReviewEvidenceTier {
	return (REVIEW_EVIDENCE_TIERS as readonly unknown[]).includes(value);
}

function isReviewAllowedClaim(value: unknown): value is ReviewAllowedClaim {
	return (REVIEW_ALLOWED_CLAIMS as readonly unknown[]).includes(value);
}

function isReviewClaimReadinessStatus(
	value: unknown,
): value is ReviewClaimReadinessStatus {
	return (REVIEW_CLAIM_READINESS_STATUSES as readonly unknown[]).includes(value);
}

function isReviewAnchorStrength(value: unknown): value is ReviewAnchorStrength {
	return (REVIEW_ANCHOR_STRENGTHS as readonly unknown[]).includes(value);
}

function isReviewWeakAnchorReason(
	value: unknown,
): value is ReviewWeakAnchorReason {
	return (REVIEW_WEAK_ANCHOR_REASONS as readonly unknown[]).includes(value);
}

function isReviewResolutionState(
	value: unknown,
): value is ReviewResolutionState {
	return (REVIEW_RESOLUTION_STATES as readonly unknown[]).includes(value);
}

function isReviewLedgerVerificationLevel(
	value: unknown,
): value is ReviewLedgerVerificationBurden["level"] {
	return (REVIEW_LEDGER_VERIFICATION_LEVELS as readonly unknown[]).includes(
		value,
	);
}

function isHealthInboxStatus(value: unknown): value is HealthInboxStatus {
	return (SKILL_FEEDBACK_HEALTH_INBOX_STATUSES as readonly unknown[]).includes(
		value,
	);
}

function isHealthWarningReasonId(
	value: unknown,
): value is HealthWarningReasonId {
	return (
		SKILL_FEEDBACK_HEALTH_WARNING_REASON_IDS as readonly unknown[]
	).includes(value);
}

function isHealthReadinessStatus(
	value: unknown,
): value is HealthReadinessStatus {
	return (
		SKILL_FEEDBACK_HEALTH_READINESS_STATUSES as readonly unknown[]
	).includes(value);
}

function isHealthCorrelationStatus(
	value: unknown,
): value is HealthCorrelationStatus {
	return (
		SKILL_FEEDBACK_HEALTH_CORRELATION_STATUSES as readonly unknown[]
	).includes(value);
}

function isHealthNextActionId(value: unknown): value is HealthNextActionId {
	return (
		SKILL_FEEDBACK_HEALTH_NEXT_ACTION_IDS as readonly unknown[]
	).includes(value);
}

export function isCaptureRuntime(value: unknown): value is CaptureRuntime {
	return (SKILL_FEEDBACK_CAPTURE_RUNTIMES as readonly unknown[]).includes(value);
}

export function isSkillIdentityProvenance(
	value: unknown,
): value is SkillIdentityProvenance {
	if (!isRecord(value)) return false;
	const source = value.source;
	if (
		!(SKILL_IDENTITY_PROVENANCE_SOURCES as readonly unknown[]).includes(source)
	) {
		return false;
	}
	if (typeof value.trusted !== "boolean") return false;
	if ("field" in value && typeof value.field !== "string") return false;
	if (
		"reason" in value &&
		!(
			SKILL_IDENTITY_PROVENANCE_REASONS as readonly unknown[]
		).includes(value.reason)
	) {
		return false;
	}
	return true;
}

function isSkillRunIdProvenance(
	value: unknown,
): value is SkillRunIdProvenance {
	return (SKILL_RUN_ID_PROVENANCE_SOURCES as readonly unknown[]).includes(value);
}

function parseOptionalCaptureRuntime(
	raw: unknown,
): CaptureRuntime | NormalizeReportResult | undefined {
	if (raw === undefined) return undefined;
	if (!isCaptureRuntime(raw)) {
		return { kind: "invalid", path: "capture_runtime", reason: "invalid" };
	}
	return raw;
}

function parseOptionalSkillIdentityProvenance(
	raw: unknown,
): SkillIdentityProvenance | NormalizeReportResult | undefined {
	if (raw === undefined) return undefined;
	if (!isSkillIdentityProvenance(raw)) {
		return {
			kind: "invalid",
			path: "skill_identity_provenance",
			reason: "invalid",
		};
	}
	return raw;
}

function parseOptionalSkillRunIdProvenance(
	raw: unknown,
): SkillRunIdProvenance | NormalizeReportResult | undefined {
	if (raw === undefined) return undefined;
	if (!isSkillRunIdProvenance(raw)) {
		return {
			kind: "invalid",
			path: "skill_run_id_provenance",
			reason: "invalid",
		};
	}
	return raw;
}

function isCorrelationStatus(value: unknown): value is CorrelationStatus {
	return (SKILL_FEEDBACK_CORRELATION_STATUSES as readonly unknown[]).includes(
		value,
	);
}

function isFrictionCategory(value: unknown): value is FrictionCategory {
	return (FRICTION_CATEGORIES as readonly unknown[]).includes(value);
}

function isVerificationBurdenLevel(
	value: unknown,
): value is VerificationBurdenLevel {
	return (VERIFICATION_BURDEN_LEVELS as readonly unknown[]).includes(value);
}

function isSkillFeedbackPurgeMode(
	value: unknown,
): value is SkillFeedbackPurgeMode {
	return value === "preview" || value === "execute";
}

function isSkillFeedbackPurgeLane(
	value: unknown,
): value is SkillFeedbackPurgeLane {
	return (SKILL_FEEDBACK_PURGE_LANES as readonly unknown[]).includes(value);
}

function isObservationKind(value: unknown): value is ObservationKind {
	return (OBSERVATION_KINDS as readonly unknown[]).includes(value);
}

function isObservationEvidenceBasis(
	value: unknown,
): value is ObservationEvidenceBasis {
	return (OBSERVATION_EVIDENCE_BASIS as readonly unknown[]).includes(value);
}

function isEvidenceGapCode(value: unknown): value is EvidenceGapCode {
	return (EVIDENCE_GAP_CODES as readonly unknown[]).includes(value);
}

function isValidOwnerPath(path: string): boolean {
	if (path.trim() === "") return false;
	if (path.startsWith("/") || path.startsWith("~")) return false;
	if (/^[A-Za-z]:[\\/]/.test(path)) return false;
	if (path.includes("\0")) return false;
	const parts = path.split("/");
	return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

/**
 * Public subcommands accepted by skill-feedback.
 */
const SKILL_FEEDBACK_COMMANDS = [
	"record",
	"closeout",
	"review",
	"health",
	"purge",
] as const;

/**
 * Public command union for the facade-backed skill-feedback CLI.
 */
export type SkillFeedbackCommand = (typeof SKILL_FEEDBACK_COMMANDS)[number];

type SkillFeedbackAudience = "agent";
type SkillFeedbackMutation =
	| "capture"
	| "closeout"
	| "review"
	| "health"
	| "purge";
type SkillFeedbackCommandContract = CommandFacadeContract<
	SkillFeedbackCommand,
	SkillFeedbackAudience,
	SkillFeedbackMutation
>;

/**
 * Flags for `record`.
 *
 * SECURITY (KTD2a): only the redaction-gated narrated fields and the
 * non-secret identity/timestamp inputs are flags. The trusted telemetry tags
 * `model`, `git_sha`, and `skill_version` are ENGINE-READ — there is
 * deliberately no `--model` / `--git-sha` / `--skill-version` flag, so an agent
 * cannot route a secret through a field the redactor skips.
 */
const recordFlags = {
	"--skill": {
		type: "string",
		required: true,
		description: "Skill identity the receipt describes.",
	},
	"--goal": {
		type: "string",
		required: true,
		description: "Narrated free-text run goal (redaction-gated).",
	},
	"--outcome": {
		type: "enum",
		values: SKILL_FEEDBACK_OUTCOMES,
		required: true,
		description: "Run outcome: confirmed, failed, or ambiguous.",
	},
	"--friction": {
		type: "string",
		required: true,
		description: "Narrated free-text friction note (redaction-gated).",
	},
	"--explanation": {
		type: "string",
		description: "Optional narrated free-text explanation (redaction-gated).",
	},
	"--generated-ts": {
		type: "string",
		required: true,
		description: "Passed-in ISO timestamp; never an ambient-clock read.",
	},
} as const satisfies SkillFeedbackCommandContract["flags"];

const resultContract = {
	id: SKILL_FEEDBACK_CONTRACT_ID,
	kind: "Software Learning Report record envelope.",
	schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
} as const satisfies NonNullable<
	SkillFeedbackCommandContract["resultContract"]
>;

const closeoutResultContract = {
	id: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
	kind: "Software Learning Report driver closeout envelope.",
	schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
} as const satisfies NonNullable<
	SkillFeedbackCommandContract["resultContract"]
>;

const reviewResultContract = {
	id: SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
	kind: "Software Learning Report review decision envelope.",
	schema_version: SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION,
} as const satisfies NonNullable<
	SkillFeedbackCommandContract["resultContract"]
>;

const healthResultContract = {
	id: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
	kind: "Software Learning Report inbox health envelope.",
	schema_version: SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
} as const satisfies NonNullable<
	SkillFeedbackCommandContract["resultContract"]
>;

const purgeResultContract = {
	id: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
	kind: "Software Learning Report inbox purge envelope.",
	schema_version: SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION,
} as const satisfies NonNullable<
	SkillFeedbackCommandContract["resultContract"]
>;

const exitCodes = {
	"0": "Record captured (possibly degraded) and written.",
	"1": "Capture blocked before any write (gate refused or unsafe input).",
	"2": "Invalid record usage.",
} as const satisfies SkillFeedbackCommandContract["exitCodes"];

const closeoutExitCodes = {
	"0": "Closeout accepted and written.",
	"1": "Closeout blocked before write or storage repair is needed.",
	"2": "Invalid closeout usage or stdin receipt.",
} as const satisfies SkillFeedbackCommandContract["exitCodes"];

const reviewExitCodes = {
	"0": "Review completed without mutating the inbox.",
	"1": "Review blocked by unreadable or invalid inbox state.",
	"2": "Invalid review usage.",
} as const satisfies SkillFeedbackCommandContract["exitCodes"];

const healthExitCodes = {
	"0": "Health check completed without mutating the inbox.",
	"1": "Health check blocked by unsafe inbox state or target resolution failure.",
	"2": "Invalid health usage.",
} as const satisfies SkillFeedbackCommandContract["exitCodes"];

const purgeExitCodes = {
	"0": "Purge preview completed or selected safe reports were deleted.",
	"1": "Purge blocked by unsafe inbox state or deletion failure.",
	"2": "Invalid purge usage.",
} as const satisfies SkillFeedbackCommandContract["exitCodes"];

const readOnlyFlags = {
	"--plain": {
		type: "boolean",
		description: "Emit compact human-readable output.",
	},
	"--repo": {
		type: "string",
		description: "Resolve the read target from this path's repository root.",
	},
} as const satisfies SkillFeedbackCommandContract["flags"];

const purgeFlags = {
	"--lane": {
		type: "enum",
		values: SKILL_FEEDBACK_PURGE_LANES,
		description:
			"Logical lane to purge: primary, low-signal, or all. Default: all.",
	},
	"--older-than": {
		type: "string",
		description:
			"Select reports older than a duration at current run time, such as 14d or 48h.",
	},
	"--keep-latest": {
		type: "string",
		description:
			"Keep the newest COUNT reports in the selected logical lane and select older reports.",
	},
	"--execute": {
		type: "boolean",
		description: "Delete selected safe reports. Default previews only.",
	},
} as const satisfies SkillFeedbackCommandContract["flags"];

/**
 * Facade-backed command metadata for the skill-feedback CLI.
 */
export const skillFeedbackContracts = defineCommandFacadeContract(
	{
		record: {
			script: "skill-feedback-runner",
			summary: "Capture one Software Learning Report from a skill-run receipt.",
			usage: [
				"record --skill <id> --goal <text> --outcome <confirmed|failed|ambiguous> --friction <text> --generated-ts <iso> [--explanation <text>]",
			],
			json: true,
			audience: "agent",
			mutation: "capture",
			sideEffects: ["write"],
			executionModes: ["normal"],
			previewExemption: {
				reason:
					"Capture is the terminal write; a dry-run record would duplicate the inbox semantics it gates.",
			},
			outputModes: ["json"],
			interactivity: "none",
			resultContract,
			flags: recordFlags,
			exitCodes,
		},
		closeout: {
			script: "skill-feedback-runner",
			summary: "Submit one driver closeout receipt from stdin.",
			usage: ["closeout < receipt.json"],
			json: true,
			audience: "agent",
			mutation: "closeout",
			sideEffects: ["write"],
			executionModes: ["normal"],
			previewExemption: {
				reason:
					"Closeout is the terminal evidence write; malformed stdin fails before write.",
			},
			outputModes: ["json"],
			interactivity: "none",
			resultContract: closeoutResultContract,
			flags: {},
			exitCodes: closeoutExitCodes,
		},
		review: {
			script: "skill-feedback-runner",
			summary: "Review inbox evidence without mutating reports.",
			usage: ["review [--plain] [--repo <path>]"],
			json: true,
			audience: "agent",
			mutation: "review",
			sideEffects: ["read"],
			executionModes: ["normal"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract: reviewResultContract,
			flags: readOnlyFlags,
			exitCodes: reviewExitCodes,
		},
		health: {
			script: "skill-feedback-runner",
			summary: "Check inbox health without mutating reports.",
			usage: ["health [--plain] [--repo <path>]"],
			json: true,
			audience: "agent",
			mutation: "health",
			sideEffects: ["read"],
			executionModes: ["normal"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract: healthResultContract,
			flags: readOnlyFlags,
			exitCodes: healthExitCodes,
		},
		purge: {
			script: "skill-feedback-runner",
			summary: "Preview or execute explicit inbox report retention purge.",
			usage: [
				"purge [--lane primary|low-signal|all] (--older-than <duration> | --keep-latest <count>) [--execute]",
			],
			json: true,
			audience: "agent",
			mutation: "purge",
			sideEffects: ["write"],
			executionModes: ["dry_run", "normal"],
			outputModes: ["json"],
			interactivity: "none",
			resultContract: purgeResultContract,
			flags: purgeFlags,
			exitCodes: purgeExitCodes,
		},
	} as const satisfies Record<
		SkillFeedbackCommand,
		SkillFeedbackCommandContract
	>,
	{
		path: "skills/skill-feedback/src/command-contract.ts",
		writeImplyingMutations: new Set(["capture", "closeout", "purge"]),
	},
);
