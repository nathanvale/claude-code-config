import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import {
	evidenceGap,
	stableReportId,
} from "./report-helpers";
import {
	isRawObject as isRecord,
	stringFromUnknown,
} from "./raw-object";

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
 * Stable result contract identity for dashboard error envelopes.
 */
export const SKILL_FEEDBACK_DASHBOARD_CONTRACT_ID =
	"skill-feedback.dashboard" as const;

/**
 * Stable result contract identity for inbox purge envelopes.
 */
export const SKILL_FEEDBACK_PURGE_CONTRACT_ID =
	"skill-feedback.purge" as const;

/**
 * Stable result contract identity for correlation repair envelopes.
 */
export const SKILL_FEEDBACK_CORRELATE_CONTRACT_ID =
	"skill-feedback.correlate" as const;

/**
 * Stable result contract identity for recent report list envelopes.
 */
export const SKILL_FEEDBACK_REPORTS_CONTRACT_ID =
	"skill-feedback.reports" as const;

/**
 * Stable result contract identity for single report detail envelopes.
 */
export const SKILL_FEEDBACK_REPORT_CONTRACT_ID =
	"skill-feedback.report" as const;

/**
 * Stable result contract identity for skill usage envelopes.
 */
export const SKILL_FEEDBACK_USAGE_CONTRACT_ID =
	"skill-feedback.usage" as const;

/**
 * Stable result contract identity for improvement queue envelopes.
 */
export const SKILL_FEEDBACK_QUEUE_CONTRACT_ID =
	"skill-feedback.queue" as const;

/**
 * Schema version for the private correlation witness artifact family.
 */
export const SKILL_FEEDBACK_CORRELATION_WITNESS_SCHEMA_VERSION = "1" as const;

/**
 * Schema version for the package-owned Software Learning Report envelope.
 *
 * Increment when agent-visible record semantics change.
 */
export const SKILL_FEEDBACK_SCHEMA_VERSION = "2" as const;

/**
 * Schema version for the review-specific claim-safe result envelope.
 *
 * Review result semantics can advance independently from persisted report
 * records so older readers do not silently accept changed review output.
 */
export const SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION = "8" as const;

/**
 * Schema version for health-specific read-only result envelopes.
 */
export const SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION = "4" as const;

/**
 * Schema version for dashboard-specific error envelopes.
 */
export const SKILL_FEEDBACK_DASHBOARD_RESULT_SCHEMA_VERSION = "1" as const;

/**
 * Schema version for purge-specific result envelopes.
 */
export const SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION = "1" as const;

/**
 * Schema version for correlation repair result envelopes.
 */
export const SKILL_FEEDBACK_CORRELATE_RESULT_SCHEMA_VERSION = "1" as const;

/**
 * Schema version for recent report list result envelopes.
 */
export const SKILL_FEEDBACK_REPORTS_RESULT_SCHEMA_VERSION = "1" as const;

/**
 * Schema version for single report detail result envelopes.
 */
export const SKILL_FEEDBACK_REPORT_RESULT_SCHEMA_VERSION = "1" as const;

/**
 * Schema version for skill usage result envelopes.
 */
export const SKILL_FEEDBACK_USAGE_RESULT_SCHEMA_VERSION = "1" as const;

/**
 * Schema version for improvement queue result envelopes.
 */
export const SKILL_FEEDBACK_QUEUE_RESULT_SCHEMA_VERSION = "1" as const;


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

const WRITER_PROOF_ALGORITHM = "hmac-sha256" as const;
const WRITER_PROOF_SIGNATURE_ENCODING = "hex" as const;
const WRITER_PROOF_SIGNED_FIELDS = [
	"capture_runtime",
	"correlation_status",
	"evidence_source",
	"generated_ts",
	"report_id",
	"schema_version",
	"skill",
	"skill_run_id",
	"skill_run_id_provenance",
	"writer_proof.nonce",
] as const;
const WRITER_PROOF_SIGNED_FIELD_SET: ReadonlySet<string> = new Set(
	WRITER_PROOF_SIGNED_FIELDS,
);
const WRITER_PROOF_DIRECT_FIELD_SET: ReadonlySet<string> = new Set(
	WRITER_PROOF_SIGNED_FIELDS.filter((field) => !field.includes(".")),
);
const WRITER_PROOF_HEALTH_FIELDS = [
	"verified_count",
	"evidence_only_count",
	"replay_diagnostics_count",
	"diagnostics",
] as const;
const CORRELATION_WITNESS_HEALTH_FIELDS = [
	"verified_count",
	"blocked_count",
	"orphan_count",
	"diagnostics",
] as const;
const CORRELATION_WITNESS_RUNTIME_SOURCES = ["claude_stop"] as const;
const CORRELATION_WITNESS_SIGNED_FIELDS = [
	"schema_version",
	"witness_id",
	"skill",
	"runtime_source",
	"hook_report_id",
	"closeout_report_id",
	"skill_run_id",
	"created_ts",
	"correlation_proof.nonce",
] as const;
const CORRELATION_WITNESS_SIGNED_FIELD_SET: ReadonlySet<string> = new Set(
	CORRELATION_WITNESS_SIGNED_FIELDS,
);
const CORRELATION_WITNESS_FIELDS = [
	"schema_version",
	"witness_id",
	"skill",
	"runtime_source",
	"hook_report_id",
	"closeout_report_id",
	"skill_run_id",
	"created_ts",
	"correlation_proof",
] as const;
const CORRELATION_WITNESS_FIELD_SET: ReadonlySet<string> = new Set(
	CORRELATION_WITNESS_FIELDS,
);

export const SKILL_FEEDBACK_CORRELATION_WITNESS_DIR = ".correlation" as const;

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
 * Headline reasons for engineering signals derived from review ledger facts.
 */
const REVIEW_ENGINEERING_SIGNAL_REASONS = [
	"repeated_anchor",
	"high_verification_burden",
	"moderate_verification_burden",
	"driver_declared_owner_path",
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
	"preview-correlation-repair",
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

const SKILL_FEEDBACK_CORRELATE_MODES = ["preview", "execute"] as const;
const SKILL_FEEDBACK_CORRELATE_CANDIDATE_CLASSES = [
	"repairable",
	"ambiguous",
	"invalid",
	"already_linked",
	"insufficient_evidence",
] as const;
const SKILL_FEEDBACK_CORRELATE_REASON_IDS = [
	"repairable_candidate",
	"existing_valid_witness",
	"insufficient_evidence",
	"correlation_candidate_missing",
	"correlation_candidate_ambiguous",
	"correlation_candidate_source_missing",
	"correlation_candidate_source_untrusted",
	"correlation_candidate_source_boundary_mismatch",
	"correlation_inbox_unreadable",
	"correlation_writer_proof_key_unusable",
	"correlation_report_unreadable",
	"correlation_report_invalid",
	"correlation_report_invalid_json",
	"correlation_hook_report_missing",
	"correlation_hook_proof_invalid",
	"correlation_hook_runtime_mismatch",
	"correlation_hook_skill_mismatch",
	"correlation_hook_run_id_mismatch",
	"correlation_closeout_report_missing",
	"correlation_closeout_path_mismatch",
	"correlation_closeout_proof_unavailable",
	"correlation_closeout_proof_invalid",
	"correlation_closeout_source_mismatch",
	"correlation_closeout_skill_mismatch",
	"correlation_runtime_unsupported",
	"correlation_gitignore_gate_refused",
	"correlation_witness_dir_unsafe",
	"correlation_witness_write_failed",
	"correlation_diagnostic_write_failed",
	"correlation_partial_write_failed",
] as const;
const SKILL_FEEDBACK_CORRELATE_ACTION_IDS = [
	"execute_repair",
	"inspect_repair_blockers",
	"no_repair_available",
	"repair_complete",
] as const;
const SKILL_FEEDBACK_CORRELATE_SIDE_EFFECTS = ["read", "write"] as const;
const SKILL_FEEDBACK_REPORT_LANES = ["primary", "low-signal"] as const;
const SKILL_FEEDBACK_REPORT_LANE_FILTERS = [
	"primary",
	"low-signal",
	"all",
] as const;
const SKILL_FEEDBACK_REPORT_SOURCE_FILTERS = [
	"hook_capture",
	"driver_closeout",
	"all",
] as const;
const SKILL_FEEDBACK_REPORT_MISSING_FIELDS = [
	"goal",
	"friction",
	"verification_burden",
	"touched_surfaces",
	"observations",
	"evidence_gaps",
] as const;
const SKILL_FEEDBACK_QUEUE_TARGET_TYPES = [
	"owner_path",
	"skill",
	"no_build",
] as const;
const SKILL_FEEDBACK_QUEUE_EVIDENCE_STRENGTHS = [
	"strong",
	"weak",
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

export type SkillFeedbackCorrelateMode =
	(typeof SKILL_FEEDBACK_CORRELATE_MODES)[number];

export type SkillFeedbackCorrelateCandidateClass =
	(typeof SKILL_FEEDBACK_CORRELATE_CANDIDATE_CLASSES)[number];

export type SkillFeedbackCorrelateReasonId =
	(typeof SKILL_FEEDBACK_CORRELATE_REASON_IDS)[number];

export type SkillFeedbackCorrelateActionId =
	(typeof SKILL_FEEDBACK_CORRELATE_ACTION_IDS)[number];

export type SkillFeedbackCorrelateSideEffect =
	(typeof SKILL_FEEDBACK_CORRELATE_SIDE_EFFECTS)[number];

/**
 * Physical inbox lane a report was read from.
 */
export type SkillFeedbackReportLane =
	(typeof SKILL_FEEDBACK_REPORT_LANES)[number];

/**
 * Human command lane filter; `all` is an explicit low-signal opt-in.
 */
export type SkillFeedbackReportLaneFilter =
	(typeof SKILL_FEEDBACK_REPORT_LANE_FILTERS)[number];

/**
 * Human command evidence-source filter.
 */
export type SkillFeedbackReportSourceFilter =
	(typeof SKILL_FEEDBACK_REPORT_SOURCE_FILTERS)[number];

/**
 * Detail-view field that was absent from the report card.
 */
export type SkillFeedbackReportMissingField =
	(typeof SKILL_FEEDBACK_REPORT_MISSING_FIELDS)[number];

/**
 * Improvement queue target granularity.
 */
export type SkillFeedbackQueueTargetType =
	(typeof SKILL_FEEDBACK_QUEUE_TARGET_TYPES)[number];

/**
 * Evidence strength label for queue rows.
 */
export type SkillFeedbackQueueEvidenceStrength =
	(typeof SKILL_FEEDBACK_QUEUE_EVIDENCE_STRENGTHS)[number];

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

export type WriterProofSignedField =
	(typeof WRITER_PROOF_SIGNED_FIELDS)[number];

/**
 * Local writer-owned proof over trust-bearing persisted report fields.
 */
export type WriterProof = {
	algorithm: typeof WRITER_PROOF_ALGORITHM;
	nonce: string;
	signed_fields: readonly WriterProofSignedField[];
	content_digest: string;
	signature: string;
};

/**
 * Proof context injected by the runner-owned inbox read path.
 */
export type WriterProofContext = {
	verified: boolean;
	diagnostics?: readonly string[];
};

export type CorrelationWitnessRuntimeSource =
	(typeof CORRELATION_WITNESS_RUNTIME_SOURCES)[number];

export type CorrelationWitnessSignedField =
	(typeof CORRELATION_WITNESS_SIGNED_FIELDS)[number];

/**
 * Local writer-owned proof over the private correlation witness artifact.
 */
export type CorrelationWitnessProof = {
	algorithm: typeof WRITER_PROOF_ALGORITHM;
	nonce: string;
	signed_fields: readonly CorrelationWitnessSignedField[];
	signature: string;
};

export type CorrelationWitnessSeed = {
	skill: string;
	runtime_source: CorrelationWitnessRuntimeSource;
	hook_report_id: string;
	closeout_report_id: string;
	skill_run_id: string;
	created_ts: string;
};

/**
 * Private artifact linking one hook capture report to one driver closeout.
 */
export type CorrelationWitness = CorrelationWitnessSeed & {
	schema_version: typeof SKILL_FEEDBACK_CORRELATION_WITNESS_SCHEMA_VERSION;
	witness_id: string;
	correlation_proof: CorrelationWitnessProof;
};

export type CorrelationWitnessContext = {
	verified: boolean;
	diagnostics: readonly string[];
	witness?: CorrelationWitness;
};


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
// Public compatibility alias; Fallow cannot see downstream type consumers.
// fallow-ignore-next-line unused-type
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

type ParseCloseoutReceiptOptions = {
	allowLegacySkillRunId?: boolean;
};

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
	skill: string;
	skill_run_id?: string;
	skill_run_id_provenance?: SkillRunIdProvenance;
	writer_proof?: WriterProof;
	runtime: NormalizedRuntimeTelemetry;
	report_card: Partial<CloseoutReceipt>;
	evidence_gaps: readonly EvidenceGap[];
	redactions: number;
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
} & WriterProofWriteStatus;

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
	claude_daily_pilot: HealthReadinessFact;
	codex_trusted_skill_identity: HealthReadinessFact;
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

export type WriterProofHealth = {
	verified_count: number;
	evidence_only_count: number;
	replay_diagnostics_count: number;
	diagnostics: readonly string[];
};

export type CorrelationWitnessHealth = {
	verified_count: number;
	blocked_count: number;
	orphan_count: number;
	diagnostics: readonly string[];
};

export type WriterProofWriteStatus = {
	proof_status: "attached" | "unavailable";
	proof_diagnostics: readonly string[];
};

export type HealthResultData = {
	contract: typeof SKILL_FEEDBACK_HEALTH_CONTRACT_ID;
	schema_version: typeof SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION;
	inbox_status: HealthInboxStatus;
	counts: HealthCounts;
	newest: HealthNewest;
	warnings: readonly HealthWarning[];
	proof_health: WriterProofHealth;
	correlation_witnesses: CorrelationWitnessHealth;
	claim_readiness: HealthClaimReadiness;
	correlation: HealthCorrelation;
	next_action: HealthNextAction;
	read_target?: ReviewReadTarget;
};

export type ReviewPilotCheckpoint = {
	started_at: string;
	age_days: number;
	actionable_feedback_numerator: number;
	material_closeout_denominator: number;
	density: number;
	next_action: string;
};

// Public compatibility alias; Fallow cannot see downstream type consumers.
// fallow-ignore-next-line unused-type
export type ReviewReadinessStatus = "ready" | "blocked";

/**
 * V1 review readiness shape. ReviewResultData v2 replaces this with
 * claim-specific readiness under `claim_readiness`.
 */
// Public compatibility alias; Fallow cannot see downstream type consumers.
// fallow-ignore-next-line unused-type
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
// Public compatibility alias; Fallow cannot see downstream type consumers.
// fallow-ignore-next-line unused-type
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
 * V2 headline reason for one software-engineering signal.
 */
export type ReviewEngineeringSignalReason =
	(typeof REVIEW_ENGINEERING_SIGNAL_REASONS)[number];

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
	claude_daily_pilot: ReviewClaimReadinessFact;
	codex_trusted_skill_identity: ReviewClaimReadinessFact;
};

/**
 * Contract-owned claim order and labels for plain review and health output.
 *
 * Renderers iterate this list so they repeat the result contract's decision
 * surfaces instead of choosing their own readiness claims.
 *
 * @example
 * ```typescript
 * const labels = SKILL_FEEDBACK_DECISION_READINESS_SURFACES.map(
 *   (surface) => surface.label,
 * )
 * ```
 */
export const SKILL_FEEDBACK_DECISION_READINESS_SURFACES = [
	{ key: "runtime_capture", label: "runtime capture" },
	{ key: "claude_daily_pilot", label: "Claude daily pilot" },
	{
		key: "codex_trusted_skill_identity",
		label: "Codex Trusted skill identity",
	},
] as const satisfies readonly {
	key: Extract<keyof HealthClaimReadiness, keyof ReviewClaimReadiness>;
	label: string;
}[];

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
	proof_diagnostics: readonly string[];
	resolution_state: ReviewResolutionState;
	verification_burden: ReviewLedgerVerificationBurden;
	next_safe_action: string;
};

/**
 * V2 bounded engineering signal derived from ledger evidence.
 */
export type ReviewEngineeringSignal = {
	signal_key: string;
	reason: ReviewEngineeringSignalReason;
	owner_path: string;
	evidence_refs: readonly string[];
	evidence_tier: ReviewEvidenceTier;
	source_mix: readonly EvidenceSource[];
	allowed_claims: readonly ReviewAllowedClaim[];
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
	engineering_signals: readonly ReviewEngineeringSignal[];
	anchor_miss_telemetry: readonly ReviewAnchorMissTelemetry[];
	proof_health: WriterProofHealth;
	correlation_witnesses: CorrelationWitnessHealth;
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

export type SkillFeedbackCorrelateCounts = {
	diagnostic_count: number;
	candidate_count: number;
	repairable_count: number;
	ambiguous_count: number;
	invalid_count: number;
	already_linked_count: number;
	insufficient_evidence_count: number;
	written_count: number;
	blocked_count: number;
	failed_count: number;
};

export type SkillFeedbackCorrelateCandidateData = {
	candidate_key: string;
	class: SkillFeedbackCorrelateCandidateClass;
	hook_report_ref?: string;
	closeout_report_refs: readonly string[];
	reason_ids: readonly SkillFeedbackCorrelateReasonId[];
};

export type SkillFeedbackCorrelateNextAction = {
	action_id: SkillFeedbackCorrelateActionId;
	summary: string;
	side_effects: readonly SkillFeedbackCorrelateSideEffect[];
};

export type SkillFeedbackCorrelateResultData = {
	contract: typeof SKILL_FEEDBACK_CORRELATE_CONTRACT_ID;
	schema_version: typeof SKILL_FEEDBACK_CORRELATE_RESULT_SCHEMA_VERSION;
	mode: SkillFeedbackCorrelateMode;
	counts: SkillFeedbackCorrelateCounts;
	candidates: readonly SkillFeedbackCorrelateCandidateData[];
	next_action: SkillFeedbackCorrelateNextAction;
	read_target?: ReviewReadTarget;
};

/**
 * Filters echoed by the recent report list result.
 */
export type SkillFeedbackReportsFilters = {
	limit: number;
	lane: SkillFeedbackReportLaneFilter;
	source: SkillFeedbackReportSourceFilter;
	skill?: string;
};

/**
 * Bounded row for human report browsing.
 */
export type SkillFeedbackReportListRow = {
	report_ref: string;
	report_id: string;
	detail_command: string;
	generated_ts: string;
	skill: string;
	outcome: SkillFeedbackOutcome;
	goal?: string;
	lane: SkillFeedbackReportLane;
	source: EvidenceSource;
	low_signal_reason_id?: string;
};

/**
 * Result payload for `skill-feedback reports`.
 */
export type SkillFeedbackReportsResultData = {
	contract: typeof SKILL_FEEDBACK_REPORTS_CONTRACT_ID;
	schema_version: typeof SKILL_FEEDBACK_REPORTS_RESULT_SCHEMA_VERSION;
	filters: SkillFeedbackReportsFilters;
	counts: {
		primary_count: number;
		low_signal_count: number;
		returned_count: number;
		skipped_unsafe_count: number;
		invalid_count: number;
	};
	reports: readonly SkillFeedbackReportListRow[];
	read_target?: ReviewReadTarget;
};

/**
 * Result payload for `skill-feedback report <report:id>`.
 */
export type SkillFeedbackReportDetailData = {
	contract: typeof SKILL_FEEDBACK_REPORT_CONTRACT_ID;
	schema_version: typeof SKILL_FEEDBACK_REPORT_RESULT_SCHEMA_VERSION;
	report_ref: string;
	report_id: string;
	lane: SkillFeedbackReportLane;
	low_signal_reason_id?: string;
	generated_ts: string;
	skill: string;
	outcome: SkillFeedbackOutcome;
	source: EvidenceSource;
	correlation_status: CorrelationStatus;
	goal?: string;
	friction?: FrictionSignal;
	verification_burden?: VerificationBurden;
	touched_surfaces: readonly ReportCardTarget[];
	observations: readonly ReportCardObservation[];
	evidence_gaps: readonly EvidenceGap[];
	missing_fields: readonly SkillFeedbackReportMissingField[];
	read_target?: ReviewReadTarget;
};

/**
 * Ranked skill row for the usage portfolio view.
 */
export type SkillFeedbackUsageSkillRow = {
	skill: string;
	primary_count: number;
	low_signal_count: number;
	outcomes: Record<SkillFeedbackOutcome, number>;
	closeout_count: number;
	capture_count: number;
	last_seen_generated_ts?: string;
	common_friction?: FrictionCategory;
	common_verification_burden?: VerificationBurdenLevel;
	report_refs: readonly string[];
};

/**
 * Result payload for `skill-feedback usage`.
 */
export type SkillFeedbackUsageResultData = {
	contract: typeof SKILL_FEEDBACK_USAGE_CONTRACT_ID;
	schema_version: typeof SKILL_FEEDBACK_USAGE_RESULT_SCHEMA_VERSION;
	filters: {
		limit: number;
		skill?: string;
	};
	counts: {
		primary_count: number;
		low_signal_count: number;
		returned_count: number;
	};
	skills: readonly SkillFeedbackUsageSkillRow[];
	read_target?: ReviewReadTarget;
};

/**
 * Improvement candidate row derived from review-ledger evidence.
 */
export type SkillFeedbackQueueRow = {
	target_type: SkillFeedbackQueueTargetType;
	target: string;
	reason: string;
	evidence_strength: SkillFeedbackQueueEvidenceStrength;
	skill?: string;
	report_refs: readonly string[];
	next_safe_action: string;
};

/**
 * Result payload for `skill-feedback queue`.
 */
export type SkillFeedbackQueueResultData = {
	contract: typeof SKILL_FEEDBACK_QUEUE_CONTRACT_ID;
	schema_version: typeof SKILL_FEEDBACK_QUEUE_RESULT_SCHEMA_VERSION;
	filters: {
		limit: number;
		include_weak: boolean;
		skill?: string;
		owner_path?: string;
	};
	counts: {
		primary_count: number;
		low_signal_count: number;
		returned_count: number;
		weak_available_count: number;
	};
	rows: readonly SkillFeedbackQueueRow[];
	no_build?: {
		reason: string;
		next_safe_action: string;
	};
	read_target?: ReviewReadTarget;
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

export type ParseCorrelateResultDataResult =
	| { kind: "ok"; data: SkillFeedbackCorrelateResultData }
	| { kind: "invalid"; path: string; reason: string };

export type ParseReportsResultDataResult =
	| { kind: "ok"; data: SkillFeedbackReportsResultData }
	| { kind: "invalid"; path: string; reason: string };

export type ParseReportDetailDataResult =
	| { kind: "ok"; data: SkillFeedbackReportDetailData }
	| { kind: "invalid"; path: string; reason: string };

export type ParseUsageResultDataResult =
	| { kind: "ok"; data: SkillFeedbackUsageResultData }
	| { kind: "invalid"; path: string; reason: string };

export type ParseQueueResultDataResult =
	| { kind: "ok"; data: SkillFeedbackQueueResultData }
	| { kind: "invalid"; path: string; reason: string };

/**
 * Read-side report shape consumed by review.
 */
export type NormalizedSoftwareLearningReport = {
	schema_version: typeof SKILL_FEEDBACK_SCHEMA_VERSION;
	source_schema_version: "v0" | "v1" | "v2";
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
	writer_proof_verified?: boolean;
	proof_diagnostics?: readonly string[];
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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
	"engineering_signals",
	"anchor_miss_telemetry",
	"proof_health",
	"correlation_witnesses",
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
	"proof_diagnostics",
	"resolution_state",
	"verification_burden",
	"next_safe_action",
] as const;
const REVIEW_ENGINEERING_SIGNAL_FIELDS = [
	"signal_key",
	"reason",
	"owner_path",
	"evidence_refs",
	"evidence_tier",
	"source_mix",
	"allowed_claims",
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
	"claude_daily_pilot",
	"codex_trusted_skill_identity",
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
	"proof_health",
	"correlation_witnesses",
	"claim_readiness",
	"correlation",
	"next_action",
	"read_target",
] as const;
const REPORTS_RESULT_FIELDS = [
	"contract",
	"schema_version",
	"filters",
	"counts",
	"reports",
	"read_target",
] as const;
const REPORT_LIST_FILTER_FIELDS = [
	"limit",
	"lane",
	"source",
	"skill",
] as const;
const REPORTS_COUNTS_FIELDS = [
	"primary_count",
	"low_signal_count",
	"returned_count",
	"skipped_unsafe_count",
	"invalid_count",
] as const;
const REPORT_LIST_ROW_FIELDS = [
	"report_ref",
	"report_id",
	"detail_command",
	"generated_ts",
	"skill",
	"outcome",
	"goal",
	"lane",
	"source",
	"low_signal_reason_id",
] as const;
const REPORT_DETAIL_FIELDS = [
	"contract",
	"schema_version",
	"report_ref",
	"report_id",
	"lane",
	"low_signal_reason_id",
	"generated_ts",
	"skill",
	"outcome",
	"source",
	"correlation_status",
	"goal",
	"friction",
	"verification_burden",
	"touched_surfaces",
	"observations",
	"evidence_gaps",
	"missing_fields",
	"read_target",
] as const;
const USAGE_RESULT_FIELDS = [
	"contract",
	"schema_version",
	"filters",
	"counts",
	"skills",
	"read_target",
] as const;
const USAGE_FILTER_FIELDS = ["limit", "skill"] as const;
const USAGE_COUNTS_FIELDS = [
	"primary_count",
	"low_signal_count",
	"returned_count",
] as const;
const USAGE_ROW_FIELDS = [
	"skill",
	"primary_count",
	"low_signal_count",
	"outcomes",
	"closeout_count",
	"capture_count",
	"last_seen_generated_ts",
	"common_friction",
	"common_verification_burden",
	"report_refs",
] as const;
const USAGE_OUTCOME_FIELDS = ["confirmed", "failed", "ambiguous"] as const;
const QUEUE_RESULT_FIELDS = [
	"contract",
	"schema_version",
	"filters",
	"counts",
	"rows",
	"no_build",
	"read_target",
] as const;
const QUEUE_FILTER_FIELDS = [
	"limit",
	"include_weak",
	"skill",
	"owner_path",
] as const;
const QUEUE_COUNTS_FIELDS = [
	"primary_count",
	"low_signal_count",
	"returned_count",
	"weak_available_count",
] as const;
const QUEUE_ROW_FIELDS = [
	"target_type",
	"target",
	"reason",
	"evidence_strength",
	"skill",
	"report_refs",
	"next_safe_action",
] as const;
const QUEUE_NO_BUILD_FIELDS = ["reason", "next_safe_action"] as const;
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
	"claude_daily_pilot",
	"codex_trusted_skill_identity",
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
const CORRELATE_RESULT_FIELDS = [
	"contract",
	"schema_version",
	"mode",
	"counts",
	"candidates",
	"next_action",
	"read_target",
] as const;
const CORRELATE_COUNTS_FIELDS = [
	"diagnostic_count",
	"candidate_count",
	"repairable_count",
	"ambiguous_count",
	"invalid_count",
	"already_linked_count",
	"insufficient_evidence_count",
	"written_count",
	"blocked_count",
	"failed_count",
] as const;
const CORRELATE_CANDIDATE_FIELDS = [
	"candidate_key",
	"class",
	"hook_report_ref",
	"closeout_report_refs",
	"reason_ids",
] as const;
const CORRELATE_NEXT_ACTION_FIELDS = [
	"action_id",
	"summary",
	"side_effects",
] as const;
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
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export function parseCloseoutReceipt(
	raw: unknown,
	options: ParseCloseoutReceiptOptions = {},
): ParseCloseoutReceiptResult {
	if (!isRecord(raw)) {
		return { kind: "invalid", path: "$", reason: "expected_object" };
	}
	const allowLegacySkillRunId = options.allowLegacySkillRunId === true;
	for (const key of Object.keys(raw)) {
		if (key === "skill_run_id" && !allowLegacySkillRunId) {
			return { kind: "invalid", path: key, reason: "unknown_field" };
		}
		if (!CLOSEOUT_RECEIPT_FIELD_SET.has(key)) {
			return { kind: "invalid", path: key, reason: "unknown_field" };
		}
	}

	const receipt: Partial<CloseoutReceipt> = {};
	if (
		allowLegacySkillRunId &&
		"skill_run_id" in raw &&
		raw.skill_run_id !== undefined
	) {
		if (typeof raw.skill_run_id !== "string") {
			return { kind: "invalid", path: "skill_run_id", reason: "expected_string" };
		}
	}

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
 * Create a writer proof for a persisted schema 2 report.
 *
 * @param report - Report object before `writer_proof` is attached.
 * @param key - Local HMAC key bytes from the private trust store.
 * @param nonce - Hex nonce generated once for this proof.
 * @returns Proof object safe to persist on the report.
 * @throws {Error} When the report cannot be represented as canonical JSON.
 *
 * @example
 * ```typescript
 * const proof = createWriterProof(report, key, nonce)
 * ```
 */
export function createWriterProof(
	report: Record<string, unknown>,
	key: Uint8Array,
	nonce: string,
): WriterProof {
	if (!isHexString(nonce, 32)) {
		throw new Error("writer proof nonce must be 32-char lowercase hex");
	}
	const contentDigest = writerProofContentDigest(report);
	const payload = writerProofPayload(report, nonce, contentDigest);
	return {
		algorithm: WRITER_PROOF_ALGORITHM,
		nonce,
		signed_fields: WRITER_PROOF_SIGNED_FIELDS,
		content_digest: contentDigest,
		signature: hmacSha256Hex(key, canonicalJson(payload)),
	};
}

/**
 * Verify a persisted report's writer proof without trusting raw report text.
 *
 * @param report - Raw parsed report from the inbox.
 * @param key - Local HMAC key bytes from the private trust store.
 * @returns Verification result plus reason-code diagnostics.
 *
 * @example
 * ```typescript
 * const proof = verifyWriterProof(rawReport, key)
 * ```
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export function verifyWriterProof(
	report: unknown,
	key: Uint8Array,
): WriterProofContext {
	if (!isRecord(report)) {
		return { verified: false, diagnostics: ["writer_proof_report_invalid"] };
	}
	const proof = parseWriterProof(report.writer_proof);
	if (!proof.ok) return { verified: false, diagnostics: [proof.reason] };
	if (proof.value.algorithm !== WRITER_PROOF_ALGORITHM) {
		return {
			verified: false,
			diagnostics: ["writer_proof_algorithm_unsupported"],
		};
	}
	if (!sameStringList(proof.value.signed_fields, WRITER_PROOF_SIGNED_FIELDS)) {
		return {
			verified: false,
			diagnostics: ["writer_proof_signed_fields_mismatch"],
		};
	}
	let contentDigest: string;
	let payload: unknown;
	try {
		contentDigest = writerProofContentDigest(report);
		payload = writerProofPayload(report, proof.value.nonce, contentDigest);
	} catch {
		return {
			verified: false,
			diagnostics: ["writer_proof_canonicalization_failed"],
		};
	}
	if (contentDigest !== proof.value.content_digest) {
		return {
			verified: false,
			diagnostics: ["writer_proof_content_digest_mismatch"],
		};
	}
	const expected = hmacSha256Hex(key, canonicalJson(payload));
	if (!safeEqualHex(expected, proof.value.signature)) {
		return {
			verified: false,
			diagnostics: ["writer_proof_signature_mismatch"],
		};
	}
	return { verified: true, diagnostics: [] };
}

export function createCorrelationWitness(
	seed: CorrelationWitnessSeed,
	key: Uint8Array,
	nonce: string,
): CorrelationWitness {
	if (!isHexString(nonce, 32)) {
		throw new Error("correlation witness nonce must be 32-char lowercase hex");
	}
	const witnessWithoutProof = {
		schema_version: SKILL_FEEDBACK_CORRELATION_WITNESS_SCHEMA_VERSION,
		witness_id: "",
		...seed,
	};
	const witness = {
		...witnessWithoutProof,
		witness_id: correlationWitnessId(witnessWithoutProof),
	};
	return {
		...witness,
		correlation_proof: {
			algorithm: WRITER_PROOF_ALGORITHM,
			nonce,
			signed_fields: CORRELATION_WITNESS_SIGNED_FIELDS,
			signature: hmacSha256Hex(
				key,
				canonicalJson(correlationWitnessProofPayload(witness, nonce)),
			),
		},
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export function verifyCorrelationWitness(
	raw: unknown,
	key: Uint8Array,
): CorrelationWitnessContext {
	const parsed = parseCorrelationWitnessBase(raw);
	if (!parsed.ok) {
		return { verified: false, diagnostics: parsed.diagnostics };
	}
	const proof = parseCorrelationWitnessProof(parsed.rawProof);
	if (!proof.ok) {
		return { verified: false, diagnostics: [proof.reason] };
	}
	const witness: CorrelationWitness = {
		...parsed.witness,
		correlation_proof: proof.value,
	};
	const diagnostics: string[] = [];
	if (
		!sameStringList(
			proof.value.signed_fields,
			CORRELATION_WITNESS_SIGNED_FIELDS,
		)
	) {
		diagnostics.push("correlation_witness_signed_fields_mismatch");
	}
	if (witness.witness_id !== correlationWitnessId(witness)) {
		diagnostics.push("correlation_witness_id_mismatch");
	}
	try {
		const expected = hmacSha256Hex(
			key,
			canonicalJson(
				correlationWitnessProofPayload(witness, proof.value.nonce),
			),
		);
		if (!safeEqualHex(expected, proof.value.signature)) {
			diagnostics.push("correlation_witness_signature_mismatch");
		}
	} catch {
		diagnostics.push("correlation_witness_canonicalization_failed");
	}
	return {
		verified: diagnostics.length === 0,
		diagnostics,
		witness,
	};
}

export function isSafeCorrelationWitnessFileName(fileName: string): boolean {
	return /^witness_[0-9a-f]{16}\.json$/.test(fileName);
}

export function isSafeReportId(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

export function correlationWitnessRelativePath(witnessId: string): string {
	if (!/^witness_[0-9a-f]{16}$/.test(witnessId)) {
		throw new Error("invalid correlation witness id");
	}
	return `${SKILL_FEEDBACK_CORRELATION_WITNESS_DIR}/${witnessId}.json`;
}

/**
 * Derive a purpose-separated runtime run id from Claude Stop detection state.
 *
 * @param key - Local HMAC key bytes from the private trust store.
 * @param detectionId - Stable Claude Stop detection id.
 * @returns Hex skill run id that does not expose the raw detection id.
 *
 * @example
 * ```typescript
 * const runId = deriveWriterOwnedSkillRunId(key, detectionId)
 * ```
 */
export function deriveWriterOwnedSkillRunId(
	key: Uint8Array,
	detectionId: string,
): string {
	return hmacSha256Hex(key, `skill-run:${detectionId}`);
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
		validateReviewEngineeringSignals(review.engineering_signals),
		validateReviewAnchorMissTelemetry(review.anchor_miss_telemetry),
		validateWriterProofHealth(review.proof_health, "proof_health"),
		validateCorrelationWitnessHealth(
			review.correlation_witnesses,
			"correlation_witnesses",
		),
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
			validateWriterProofHealth(health.proof_health, "proof_health"),
			validateCorrelationWitnessHealth(
				health.correlation_witnesses,
				"correlation_witnesses",
			),
			validateHealthClaimReadiness(health.claim_readiness),
			validateHealthCorrelation(health.correlation),
			validateHealthNextAction(health.next_action),
			"read_target" in health
				? validateHealthReadTarget(health.read_target)
				: undefined,
		].find(isReviewResultValidationError);
	if (error) return error;
	return { kind: "ok", data: health as HealthResultData };
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export function parseCorrelateResultData(
	raw: unknown,
): ParseCorrelateResultDataResult {
	if (!isRecord(raw)) {
		return { kind: "invalid", path: "$", reason: "expected_object" };
	}
	const topLevel = validateAllowedKeys(raw, new Set(CORRELATE_RESULT_FIELDS));
	if (topLevel) return topLevel;
	if (raw.contract !== SKILL_FEEDBACK_CORRELATE_CONTRACT_ID) {
		return { kind: "invalid", path: "contract", reason: "unsupported" };
	}
	if (raw.schema_version !== SKILL_FEEDBACK_CORRELATE_RESULT_SCHEMA_VERSION) {
		return {
			kind: "invalid",
			path: "schema_version",
			reason: "unsupported",
		};
	}
	if (!isSkillFeedbackCorrelateMode(raw.mode)) {
		return { kind: "invalid", path: "mode", reason: "invalid" };
	}
	const counts = validateCorrelateCounts(raw.counts);
	if (counts) return counts;
	const candidates = validateCorrelateCandidates(raw.candidates);
	if (candidates) return candidates;
	const nextAction = validateCorrelateNextAction(raw.next_action);
	if (nextAction) return nextAction;
	if ("read_target" in raw) {
		const target = validateHealthReadTarget(raw.read_target);
		if (target) return target;
	}
	return { kind: "ok", data: raw as SkillFeedbackCorrelateResultData };
}

// Covered by package tests; keep human JSON contracts at boundary.
// fallow-ignore-next-line complexity
export function parseReportsResultData(
	raw: unknown,
): ParseReportsResultDataResult {
	const reports = requireReviewRecord(raw, "$");
	if (isReviewResultValidationError(reports)) return reports;
	const error = [
		validateAllowedKeys(reports, new Set(REPORTS_RESULT_FIELDS)),
		validateExpectedValue(
			reports.contract,
			SKILL_FEEDBACK_REPORTS_CONTRACT_ID,
			"contract",
			"unsupported",
		),
		validateExpectedValue(
			reports.schema_version,
			SKILL_FEEDBACK_REPORTS_RESULT_SCHEMA_VERSION,
			"schema_version",
			"unsupported",
		),
		validateReportListFilters(reports.filters),
		validateReportsCounts(reports.counts),
		validateReportListRows(reports.reports),
		"read_target" in reports
			? validateHealthReadTarget(reports.read_target)
			: undefined,
	].find(isReviewResultValidationError);
	if (error) return error;
	return { kind: "ok", data: reports as SkillFeedbackReportsResultData };
}

// Covered by package tests; keep human JSON contracts at boundary.
// fallow-ignore-next-line complexity
export function parseReportDetailData(
	raw: unknown,
): ParseReportDetailDataResult {
	const detail = requireReviewRecord(raw, "$");
	if (isReviewResultValidationError(detail)) return detail;
	const error = [
		validateAllowedKeys(detail, new Set(REPORT_DETAIL_FIELDS)),
		validateExpectedValue(
			detail.contract,
			SKILL_FEEDBACK_REPORT_CONTRACT_ID,
			"contract",
			"unsupported",
		),
		validateExpectedValue(
			detail.schema_version,
			SKILL_FEEDBACK_REPORT_RESULT_SCHEMA_VERSION,
			"schema_version",
			"unsupported",
		),
		validateReportIdAndRef(detail.report_id, detail.report_ref, "report_id"),
		isSkillFeedbackReportLane(detail.lane)
			? undefined
			: reviewResultError("lane", "invalid_lane"),
		"low_signal_reason_id" in detail
			? validateReviewString(
					detail.low_signal_reason_id,
					"low_signal_reason_id",
				)
			: undefined,
		validateReviewString(detail.generated_ts, "generated_ts"),
		validateReviewString(detail.skill, "skill"),
		isSkillFeedbackOutcome(detail.outcome)
			? undefined
			: reviewResultError("outcome", "invalid_outcome"),
		isEvidenceSource(detail.source)
			? undefined
			: reviewResultError("source", "invalid_source"),
		isCorrelationStatus(detail.correlation_status)
			? undefined
			: reviewResultError("correlation_status", "invalid_correlation_status"),
		"goal" in detail
			? validateReviewString(detail.goal, "goal")
			: undefined,
		"friction" in detail
			? validateReportFriction(detail.friction, "friction")
			: undefined,
		"verification_burden" in detail
			? validateReportVerificationBurden(
					detail.verification_burden,
					"verification_burden",
				)
			: undefined,
		validateReportTargets(detail.touched_surfaces, "touched_surfaces"),
		validateReportObservations(detail.observations),
		validateEvidenceGaps(detail.evidence_gaps, "evidence_gaps"),
		validateReportMissingFields(detail.missing_fields, "missing_fields"),
		"read_target" in detail
			? validateHealthReadTarget(detail.read_target)
			: undefined,
	].find(isReviewResultValidationError);
	if (error) return error;
	return { kind: "ok", data: detail as SkillFeedbackReportDetailData };
}

// Covered by package tests; keep human JSON contracts at boundary.
// fallow-ignore-next-line complexity
export function parseUsageResultData(raw: unknown): ParseUsageResultDataResult {
	const usage = requireReviewRecord(raw, "$");
	if (isReviewResultValidationError(usage)) return usage;
	const error = [
		validateAllowedKeys(usage, new Set(USAGE_RESULT_FIELDS)),
		validateExpectedValue(
			usage.contract,
			SKILL_FEEDBACK_USAGE_CONTRACT_ID,
			"contract",
			"unsupported",
		),
		validateExpectedValue(
			usage.schema_version,
			SKILL_FEEDBACK_USAGE_RESULT_SCHEMA_VERSION,
			"schema_version",
			"unsupported",
		),
		validateUsageFilters(usage.filters),
		validateUsageCounts(usage.counts),
		validateUsageRows(usage.skills),
		"read_target" in usage
			? validateHealthReadTarget(usage.read_target)
			: undefined,
	].find(isReviewResultValidationError);
	if (error) return error;
	return { kind: "ok", data: usage as SkillFeedbackUsageResultData };
}

// Covered by package tests; keep human JSON contracts at boundary.
// fallow-ignore-next-line complexity
export function parseQueueResultData(raw: unknown): ParseQueueResultDataResult {
	const queue = requireReviewRecord(raw, "$");
	if (isReviewResultValidationError(queue)) return queue;
	const error = [
		validateAllowedKeys(queue, new Set(QUEUE_RESULT_FIELDS)),
		validateExpectedValue(
			queue.contract,
			SKILL_FEEDBACK_QUEUE_CONTRACT_ID,
			"contract",
			"unsupported",
		),
		validateExpectedValue(
			queue.schema_version,
			SKILL_FEEDBACK_QUEUE_RESULT_SCHEMA_VERSION,
			"schema_version",
			"unsupported",
		),
		validateQueueFilters(queue.filters),
		validateQueueCounts(queue.counts),
		validateQueueRows(queue.rows),
		"no_build" in queue ? validateQueueNoBuild(queue.no_build) : undefined,
		"read_target" in queue
			? validateHealthReadTarget(queue.read_target)
			: undefined,
	].find(isReviewResultValidationError);
	if (error) return error;
	return { kind: "ok", data: queue as SkillFeedbackQueueResultData };
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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
			reason: `invalid_category; expected one of ${FRICTION_CATEGORIES.join(", ")}`,
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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
			reason: `invalid_level; expected one of ${VERIFICATION_BURDEN_LEVELS.join(", ")}`,
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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
		return { kind: "invalid", path: `${path}.kind`, reason: `invalid_kind; expected one of ${OBSERVATION_KINDS.join(", ")}` };
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
			reason: `invalid_evidence_basis; expected one of ${OBSERVATION_EVIDENCE_BASIS.join(", ")}`,
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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
	return validateReadTargetFields(target, "read_target");
}

function validateHealthReadTarget(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const target = requireReviewRecord(raw, "read_target");
	if (isReviewResultValidationError(target)) return target;
	return validateReadTargetFields(target, "read_target");
}

function validateReadTargetFields(
	target: Record<string, unknown>,
	path: string,
): ReviewResultValidationError | undefined {
	return [
		validateAllowedKeys(target, new Set(REVIEW_READ_TARGET_FIELDS), path),
		validateReviewBoolean(target.explicit, `${path}.explicit`),
		validateReviewString(target.repo_root, `${path}.repo_root`),
		validateReviewString(target.inbox_path, `${path}.inbox_path`),
		"target_path" in target
			? validateReviewString(target.target_path, `${path}.target_path`)
			: undefined,
	].find(isReviewResultValidationError);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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
		for (const field of [
			"review_unit_keys",
			"owner_paths",
			"proof_diagnostics",
		] as const) {
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function validateReviewEngineeringSignals(
	raw: unknown,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) {
		return reviewResultError("engineering_signals", "expected_array");
	}
	for (const [index, signalRaw] of raw.entries()) {
		const path = `engineering_signals[${index}]`;
		const signal = requireReviewRecord(signalRaw, path);
		if (isReviewResultValidationError(signal)) return signal;
		const unknown = validateAllowedKeys(
			signal,
			new Set(REVIEW_ENGINEERING_SIGNAL_FIELDS),
			path,
		);
		if (unknown) return unknown;
		for (const field of ["signal_key", "owner_path", "next_safe_action"] as const) {
			const error = validateReviewString(signal[field], `${path}.${field}`);
			if (error) return error;
		}
		if (typeof signal.owner_path === "string" && !isValidOwnerPath(signal.owner_path)) {
			return reviewResultError(`${path}.owner_path`, "invalid_owner_path");
		}
		if (!isReviewEngineeringSignalReason(signal.reason)) {
			return reviewResultError(`${path}.reason`, "invalid_signal_reason");
		}
		const evidenceRefs = validateReviewStringArray(
			signal.evidence_refs,
			`${path}.evidence_refs`,
		);
		if (evidenceRefs) return evidenceRefs;
		if (!isReviewEvidenceTier(signal.evidence_tier)) {
			return reviewResultError(`${path}.evidence_tier`, "invalid_evidence_tier");
		}
		const sourceMix = validateEnumArray(
			signal.source_mix,
			`${path}.source_mix`,
			isEvidenceSource,
			"invalid_evidence_source",
		);
		if (sourceMix) return sourceMix;
		const allowedClaims = validateEnumArray(
			signal.allowed_claims,
			`${path}.allowed_claims`,
			isReviewAllowedClaim,
			"invalid_allowed_claim",
		);
		if (allowedClaims) return allowedClaims;
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function validateWriterProofHealth(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	const health = requireReviewRecord(raw, path);
	if (isReviewResultValidationError(health)) return health;
	const unknown = validateAllowedKeys(
		health,
		new Set(WRITER_PROOF_HEALTH_FIELDS),
		path,
	);
	if (unknown) return unknown;
	for (const field of [
		"verified_count",
		"evidence_only_count",
		"replay_diagnostics_count",
	] as const) {
		const error = validateReviewNumber(health[field], `${path}.${field}`);
		if (error) return error;
	}
	return validateReviewStringArray(health.diagnostics, `${path}.diagnostics`);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function validateCorrelationWitnessHealth(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	const health = requireReviewRecord(raw, path);
	if (isReviewResultValidationError(health)) return health;
	const unknown = validateAllowedKeys(
		health,
		new Set(CORRELATION_WITNESS_HEALTH_FIELDS),
		path,
	);
	if (unknown) return unknown;
	for (const field of [
		"verified_count",
		"blocked_count",
		"orphan_count",
	] as const) {
		const error = validateReviewNumber(health[field], `${path}.${field}`);
		if (error) return error;
	}
	return validateReviewStringArray(health.diagnostics, `${path}.diagnostics`);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

function validateCorrelateCounts(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const counts = requireReviewRecord(raw, "counts");
	if (isReviewResultValidationError(counts)) return counts;
	const unknown = validateAllowedKeys(
		counts,
		new Set(CORRELATE_COUNTS_FIELDS),
		"counts",
	);
	if (unknown) return unknown;
	return validateNumberFields(counts, CORRELATE_COUNTS_FIELDS, "counts");
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function validateCorrelateCandidates(
	raw: unknown,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError("candidates", "expected_array");
	for (const [index, candidateRaw] of raw.entries()) {
		const path = `candidates[${index}]`;
		const candidate = requireReviewRecord(candidateRaw, path);
		if (isReviewResultValidationError(candidate)) return candidate;
		const unknown = validateAllowedKeys(
			candidate,
			new Set(CORRELATE_CANDIDATE_FIELDS),
			path,
		);
		if (unknown) return unknown;
		const key = validateReviewString(candidate.candidate_key, `${path}.candidate_key`);
		if (key) return key;
		if (!isSkillFeedbackCorrelateCandidateClass(candidate.class)) {
			return reviewResultError(`${path}.class`, "invalid_candidate_class");
		}
		if ("hook_report_ref" in candidate) {
			const hookRef = validateReviewString(
				candidate.hook_report_ref,
				`${path}.hook_report_ref`,
			);
			if (hookRef) return hookRef;
		}
		const closeoutRefs = validateReviewStringArray(
			candidate.closeout_report_refs,
			`${path}.closeout_report_refs`,
		);
		if (closeoutRefs) return closeoutRefs;
		const reasons = validateCorrelateReasonIds(
			candidate.reason_ids,
			`${path}.reason_ids`,
		);
		if (reasons) return reasons;
	}
}

function validateCorrelateReasonIds(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError(path, "expected_array");
	for (const [index, value] of raw.entries()) {
		if (!isSkillFeedbackCorrelateReasonId(value)) {
			return reviewResultError(`${path}[${index}]`, "invalid_reason_id");
		}
	}
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function validateCorrelateNextAction(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const nextAction = requireReviewRecord(raw, "next_action");
	if (isReviewResultValidationError(nextAction)) return nextAction;
	const unknown = validateAllowedKeys(
		nextAction,
		new Set(CORRELATE_NEXT_ACTION_FIELDS),
		"next_action",
	);
	if (unknown) return unknown;
	if (!isSkillFeedbackCorrelateActionId(nextAction.action_id)) {
		return reviewResultError("next_action.action_id", "invalid_action_id");
	}
	const summary = validateReviewString(nextAction.summary, "next_action.summary");
	if (summary) return summary;
	return validateCorrelateSideEffects(
		nextAction.side_effects,
		"next_action.side_effects",
	);
}

function validateCorrelateSideEffects(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError(path, "expected_array");
	for (const [index, value] of raw.entries()) {
		if (!isSkillFeedbackCorrelateSideEffect(value)) {
			return reviewResultError(`${path}[${index}]`, "invalid_side_effect");
		}
	}
}

// Covered by parseReportsResultData filter contract tests.
// fallow-ignore-next-line complexity, unused-function
function validateReportListFilters(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const filters = requireReviewRecord(raw, "filters");
	if (isReviewResultValidationError(filters)) return filters;
	return [
		validateAllowedKeys(filters, new Set(REPORT_LIST_FILTER_FIELDS), "filters"),
		validateReviewNumber(filters.limit, "filters.limit"),
		isSkillFeedbackReportLaneFilter(filters.lane)
			? undefined
			: reviewResultError("filters.lane", "invalid_lane"),
		isSkillFeedbackReportSourceFilter(filters.source)
			? undefined
			: reviewResultError("filters.source", "invalid_source"),
		"skill" in filters
			? validateReviewString(filters.skill, "filters.skill")
			: undefined,
	].find(isReviewResultValidationError);
}

function validateReportsCounts(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const counts = requireReviewRecord(raw, "counts");
	if (isReviewResultValidationError(counts)) return counts;
	return [
		validateAllowedKeys(counts, new Set(REPORTS_COUNTS_FIELDS), "counts"),
		validateNumberFields(counts, REPORTS_COUNTS_FIELDS, "counts"),
	].find(isReviewResultValidationError);
}

// Covered by package tests; row continuation is a human navigation contract.
// fallow-ignore-next-line complexity
function validateReportListRows(
	raw: unknown,
): ReviewResultValidationError | undefined {
	// Covered by parseReportsResultData malformed-row package tests.
	// fallow-ignore-next-line complexity, unused-function
	return validateRecordArray(raw, "reports", (row, path) => {
		const unknown = validateAllowedKeys(row, new Set(REPORT_LIST_ROW_FIELDS), path);
		if (unknown) return unknown;
		const ref = validateReportIdAndRef(
			row.report_id,
			row.report_ref,
			`${path}.report_id`,
		);
		if (ref) return ref;
		if (!isSkillFeedbackReportLane(row.lane)) {
			return reviewResultError(`${path}.lane`, "invalid_lane");
		}
		const expectedCommand =
			row.lane === "low-signal"
				? `skill-feedback report ${row.report_ref} --low-signal`
				: `skill-feedback report ${row.report_ref}`;
		if (row.detail_command !== expectedCommand) {
			return reviewResultError(
				`${path}.detail_command`,
				"invalid_detail_command",
			);
		}
		for (const field of ["generated_ts", "skill"] as const) {
			const error = validateReviewString(row[field], `${path}.${field}`);
			if (error) return error;
		}
		if (!isSkillFeedbackOutcome(row.outcome)) {
			return reviewResultError(`${path}.outcome`, "invalid_outcome");
		}
		if (!isEvidenceSource(row.source)) {
			return reviewResultError(`${path}.source`, "invalid_source");
		}
		if ("goal" in row) {
			const error = validateReviewString(row.goal, `${path}.goal`);
			if (error) return error;
		}
		if ("low_signal_reason_id" in row) {
			const error = validateReviewString(
				row.low_signal_reason_id,
				`${path}.low_signal_reason_id`,
			);
			if (error) return error;
		}
	});
}

function validateReportIdAndRef(
	rawId: unknown,
	rawRef: unknown,
	idPath: string,
): ReviewResultValidationError | undefined {
	if (typeof rawId !== "string") return reviewResultError(idPath, "expected_string");
	if (!isSafeReportId(rawId)) return reviewResultError(idPath, "invalid_report_id");
	const refPath = idPath.replace(/report_id$/, "report_ref");
	if (rawRef !== `report:${rawId}`) {
		return reviewResultError(refPath, "invalid_report_ref");
	}
}

function validateReportFriction(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	const friction = parseFrictionSignal(raw, path);
	if (isInvalidCloseoutParseResult(friction)) {
		return reviewResultError(friction.path, friction.reason);
	}
}

function validateReportVerificationBurden(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	const burden = parseVerificationBurden(raw, path);
	if (isInvalidCloseoutParseResult(burden)) {
		return reviewResultError(burden.path, burden.reason);
	}
}

function validateReportTargets(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	const targets = parseTargets(raw, path, 5);
	if (isInvalidCloseoutParseResult(targets)) {
		return reviewResultError(targets.path, targets.reason);
	}
}

function validateReportObservations(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const observations = parseObservations(raw);
	if (isInvalidCloseoutParseResult(observations)) {
		return reviewResultError(observations.path, observations.reason);
	}
}

// Covered by parseReportDetailData evidence-gap package tests.
// fallow-ignore-next-line complexity, unused-function
function validateEvidenceGaps(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError(path, "expected_array");
	for (const [index, gapRaw] of raw.entries()) {
		const gapPath = `${path}[${index}]`;
		const gap = requireReviewRecord(gapRaw, gapPath);
		if (isReviewResultValidationError(gap)) return gap;
		const unknown = validateAllowedKeys(
			gap,
			new Set(["code", "path", "message"]),
			gapPath,
		);
		if (unknown) return unknown;
		if (!isEvidenceGapCode(gap.code)) {
			return reviewResultError(`${gapPath}.code`, "invalid_gap_code");
		}
		for (const field of ["path", "message"] as const) {
			const error = validateReviewString(gap[field], `${gapPath}.${field}`);
			if (error) return error;
		}
	}
}

function validateReportMissingFields(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError(path, "expected_array");
	for (const [index, value] of raw.entries()) {
		if (!isSkillFeedbackReportMissingField(value)) {
			return reviewResultError(`${path}[${index}]`, "invalid_missing_field");
		}
	}
}

function validateUsageFilters(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const filters = requireReviewRecord(raw, "filters");
	if (isReviewResultValidationError(filters)) return filters;
	return [
		validateAllowedKeys(filters, new Set(USAGE_FILTER_FIELDS), "filters"),
		validateReviewNumber(filters.limit, "filters.limit"),
		"skill" in filters
			? validateReviewString(filters.skill, "filters.skill")
			: undefined,
	].find(isReviewResultValidationError);
}

function validateUsageCounts(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const counts = requireReviewRecord(raw, "counts");
	if (isReviewResultValidationError(counts)) return counts;
	return [
		validateAllowedKeys(counts, new Set(USAGE_COUNTS_FIELDS), "counts"),
		validateNumberFields(counts, USAGE_COUNTS_FIELDS, "counts"),
	].find(isReviewResultValidationError);
}

// Covered by package tests; keep row shape strict for JSON consumers.
// fallow-ignore-next-line complexity
function validateUsageRows(raw: unknown): ReviewResultValidationError | undefined {
	// Covered by parseUsageResultData malformed-row package tests.
	// fallow-ignore-next-line complexity, unused-function
	return validateRecordArray(raw, "skills", (row, path) => {
		const unknown = validateAllowedKeys(row, new Set(USAGE_ROW_FIELDS), path);
		if (unknown) return unknown;
		for (const field of ["skill"] as const) {
			const error = validateReviewString(row[field], `${path}.${field}`);
			if (error) return error;
		}
		for (const field of [
			"primary_count",
			"low_signal_count",
			"closeout_count",
			"capture_count",
		] as const) {
			const error = validateReviewNumber(row[field], `${path}.${field}`);
			if (error) return error;
		}
		const outcomes = validateUsageOutcomes(row.outcomes, `${path}.outcomes`);
		if (outcomes) return outcomes;
		if ("last_seen_generated_ts" in row) {
			const error = validateReviewString(
				row.last_seen_generated_ts,
				`${path}.last_seen_generated_ts`,
			);
			if (error) return error;
		}
		if (
			"common_friction" in row &&
			!isFrictionCategory(row.common_friction)
		) {
			return reviewResultError(`${path}.common_friction`, "invalid_friction");
		}
		if (
			"common_verification_burden" in row &&
			!isVerificationBurdenLevel(row.common_verification_burden)
		) {
			return reviewResultError(
				`${path}.common_verification_burden`,
				"invalid_level",
			);
		}
		const refs = validateReportRefArray(row.report_refs, `${path}.report_refs`);
		if (refs) return refs;
	});
}

function validateUsageOutcomes(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	const outcomes = requireReviewRecord(raw, path);
	if (isReviewResultValidationError(outcomes)) return outcomes;
	return [
		validateAllowedKeys(outcomes, new Set(USAGE_OUTCOME_FIELDS), path),
		validateNumberFields(outcomes, USAGE_OUTCOME_FIELDS, path),
	].find(isReviewResultValidationError);
}

function validateQueueFilters(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const filters = requireReviewRecord(raw, "filters");
	if (isReviewResultValidationError(filters)) return filters;
	return [
		validateAllowedKeys(filters, new Set(QUEUE_FILTER_FIELDS), "filters"),
		validateReviewNumber(filters.limit, "filters.limit"),
		validateReviewBoolean(filters.include_weak, "filters.include_weak"),
		"skill" in filters
			? validateReviewString(filters.skill, "filters.skill")
			: undefined,
		"owner_path" in filters
			? validateOwnerPathField(filters.owner_path, "filters.owner_path")
			: undefined,
	].find(isReviewResultValidationError);
}

function validateQueueCounts(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const counts = requireReviewRecord(raw, "counts");
	if (isReviewResultValidationError(counts)) return counts;
	return [
		validateAllowedKeys(counts, new Set(QUEUE_COUNTS_FIELDS), "counts"),
		validateNumberFields(counts, QUEUE_COUNTS_FIELDS, "counts"),
	].find(isReviewResultValidationError);
}

// Covered by package tests; queue rows drive human change selection.
// fallow-ignore-next-line complexity
function validateQueueRows(raw: unknown): ReviewResultValidationError | undefined {
	// Covered by parseQueueResultData malformed-row package tests.
	// fallow-ignore-next-line complexity, unused-function
	return validateRecordArray(raw, "rows", (row, path) => {
		const unknown = validateAllowedKeys(row, new Set(QUEUE_ROW_FIELDS), path);
		if (unknown) return unknown;
		if (!isSkillFeedbackQueueTargetType(row.target_type)) {
			return reviewResultError(`${path}.target_type`, "invalid_target_type");
		}
		const target =
			row.target_type === "owner_path"
				? validateOwnerPathField(row.target, `${path}.target`)
				: validateReviewString(row.target, `${path}.target`);
		if (target) return target;
		if (!isSkillFeedbackQueueEvidenceStrength(row.evidence_strength)) {
			return reviewResultError(
				`${path}.evidence_strength`,
				"invalid_evidence_strength",
			);
		}
		for (const field of ["reason", "next_safe_action"] as const) {
			const error = validateReviewString(row[field], `${path}.${field}`);
			if (error) return error;
		}
		if ("skill" in row) {
			const error = validateReviewString(row.skill, `${path}.skill`);
			if (error) return error;
		}
		const refs = validateReportRefArray(row.report_refs, `${path}.report_refs`);
		if (refs) return refs;
	});
}

// Covered through parseReportsResultData, parseUsageResultData, and
// parseQueueResultData malformed-array package tests.
// fallow-ignore-next-line complexity, unused-function
function validateRecordArray(
	raw: unknown,
	path: string,
	validateRecord: (
		record: Record<string, unknown>,
		path: string,
	) => ReviewResultValidationError | undefined,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError(path, "expected_array");
	for (const [index, rowRaw] of raw.entries()) {
		const rowPath = `${path}[${index}]`;
		const row = requireReviewRecord(rowRaw, rowPath);
		if (isReviewResultValidationError(row)) return row;
		const error = validateRecord(row, rowPath);
		if (error) return error;
	}
}

function validateQueueNoBuild(
	raw: unknown,
): ReviewResultValidationError | undefined {
	const noBuild = requireReviewRecord(raw, "no_build");
	if (isReviewResultValidationError(noBuild)) return noBuild;
	return [
		validateAllowedKeys(noBuild, new Set(QUEUE_NO_BUILD_FIELDS), "no_build"),
		validateReviewString(noBuild.reason, "no_build.reason"),
		validateReviewString(
			noBuild.next_safe_action,
			"no_build.next_safe_action",
		),
	].find(isReviewResultValidationError);
}

// Covered by parseUsageResultData and parseQueueResultData ref-array tests.
// fallow-ignore-next-line complexity, unused-function
function validateReportRefArray(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	if (!Array.isArray(raw)) return reviewResultError(path, "expected_array");
	for (const [index, ref] of raw.entries()) {
		if (typeof ref !== "string") {
			return reviewResultError(`${path}[${index}]`, "expected_string");
		}
		const id = ref.startsWith("report:") ? ref.slice("report:".length) : "";
		if (!isSafeReportId(id)) {
			return reviewResultError(`${path}[${index}]`, "invalid_report_ref");
		}
	}
}

function validateOwnerPathField(
	raw: unknown,
	path: string,
): ReviewResultValidationError | undefined {
	if (typeof raw !== "string") return reviewResultError(path, "expected_string");
	if (!isValidOwnerPath(raw)) return reviewResultError(path, "invalid_owner_path");
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

type WriterProofParseResult =
	| { ok: true; value: WriterProof }
	| { ok: false; reason: string };

type CorrelationWitnessBaseParseResult =
	| {
			ok: true;
			witness: Omit<CorrelationWitness, "correlation_proof">;
			rawProof: unknown;
	  }
	| { ok: false; diagnostics: string[] };

type CorrelationWitnessProofParseResult =
	| { ok: true; value: CorrelationWitnessProof }
	| { ok: false; reason: string };

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function parseWriterProof(raw: unknown): WriterProofParseResult {
	if (!isRecord(raw)) return { ok: false, reason: "writer_proof_missing" };
	if (raw.algorithm !== WRITER_PROOF_ALGORITHM) {
		return { ok: false, reason: "writer_proof_algorithm_unsupported" };
	}
	if (!isHexString(raw.nonce, 32)) {
		return { ok: false, reason: "writer_proof_nonce_invalid" };
	}
	if (!Array.isArray(raw.signed_fields)) {
		return { ok: false, reason: "writer_proof_signed_fields_invalid" };
	}
	const signedFields = raw.signed_fields;
	if (
		!signedFields.every(
			(field): field is WriterProofSignedField =>
				typeof field === "string" && WRITER_PROOF_SIGNED_FIELD_SET.has(field),
		)
	) {
		return { ok: false, reason: "writer_proof_signed_fields_invalid" };
	}
	if (!isHexString(raw.content_digest, 64)) {
		return { ok: false, reason: "writer_proof_content_digest_invalid" };
	}
	if (!isHexString(raw.signature, 64)) {
		return { ok: false, reason: "writer_proof_signature_invalid" };
	}
	return {
		ok: true,
		value: {
			algorithm: WRITER_PROOF_ALGORITHM,
			nonce: raw.nonce,
			signed_fields: signedFields,
			content_digest: raw.content_digest,
			signature: raw.signature,
		},
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function parseCorrelationWitnessBase(
	raw: unknown,
): CorrelationWitnessBaseParseResult {
	if (!isRecord(raw)) {
		return { ok: false, diagnostics: ["correlation_witness_invalid"] };
	}
	for (const key of Object.keys(raw)) {
		if (!CORRELATION_WITNESS_FIELD_SET.has(key)) {
			return { ok: false, diagnostics: ["correlation_witness_unknown_field"] };
		}
	}
	if (raw.schema_version !== SKILL_FEEDBACK_CORRELATION_WITNESS_SCHEMA_VERSION) {
		return {
			ok: false,
			diagnostics: ["correlation_witness_schema_unsupported"],
		};
	}
	const witnessId = requiredNonEmptyString(raw.witness_id);
	const skill = requiredNonEmptyString(raw.skill);
	const hookReportId = requiredNonEmptyString(raw.hook_report_id);
	const closeoutReportId = requiredNonEmptyString(raw.closeout_report_id);
	const skillRunId = requiredNonEmptyString(raw.skill_run_id);
	const createdTs = requiredNonEmptyString(raw.created_ts);
	if (
		!witnessId ||
		!skill ||
		!hookReportId ||
		!closeoutReportId ||
		!skillRunId ||
		!createdTs
	) {
		return { ok: false, diagnostics: ["correlation_witness_invalid"] };
	}
	if (!isCorrelationWitnessRuntimeSource(raw.runtime_source)) {
		return {
			ok: false,
			diagnostics: ["correlation_witness_runtime_unsupported"],
		};
	}
	return {
		ok: true,
		witness: {
			schema_version: SKILL_FEEDBACK_CORRELATION_WITNESS_SCHEMA_VERSION,
			witness_id: witnessId,
			skill,
			runtime_source: raw.runtime_source,
			hook_report_id: hookReportId,
			closeout_report_id: closeoutReportId,
			skill_run_id: skillRunId,
			created_ts: createdTs,
		},
		rawProof: raw.correlation_proof,
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function parseCorrelationWitnessProof(
	raw: unknown,
): CorrelationWitnessProofParseResult {
	if (!isRecord(raw)) {
		return { ok: false, reason: "correlation_witness_proof_missing" };
	}
	if (raw.algorithm !== WRITER_PROOF_ALGORITHM) {
		return {
			ok: false,
			reason: "correlation_witness_proof_algorithm_unsupported",
		};
	}
	if (!isHexString(raw.nonce, 32)) {
		return { ok: false, reason: "correlation_witness_proof_nonce_invalid" };
	}
	if (!Array.isArray(raw.signed_fields)) {
		return {
			ok: false,
			reason: "correlation_witness_proof_signed_fields_invalid",
		};
	}
	const signedFields = raw.signed_fields;
	if (
		!signedFields.every(
			(field): field is CorrelationWitnessSignedField =>
				typeof field === "string" &&
				CORRELATION_WITNESS_SIGNED_FIELD_SET.has(field),
		)
	) {
		return {
			ok: false,
			reason: "correlation_witness_proof_signed_fields_invalid",
		};
	}
	if (!isHexString(raw.signature, 64)) {
		return { ok: false, reason: "correlation_witness_proof_signature_invalid" };
	}
	return {
		ok: true,
		value: {
			algorithm: WRITER_PROOF_ALGORITHM,
			nonce: raw.nonce,
			signed_fields: signedFields,
			signature: raw.signature,
		},
	};
}

function isHexString(value: unknown, length: number): value is string {
	return (
		typeof value === "string" &&
		value.length === length &&
		/^[0-9a-f]+$/.test(value)
	);
}

function requiredNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function writerProofPayload(
	report: Record<string, unknown>,
	nonce: string,
	contentDigest: string,
): unknown {
	return {
		algorithm: WRITER_PROOF_ALGORITHM,
		content_digest: contentDigest,
		fields: Object.fromEntries(
			WRITER_PROOF_SIGNED_FIELDS.map((field) => [
				field,
				writerProofFieldValue(report, field, nonce),
			]),
		),
		signed_fields: WRITER_PROOF_SIGNED_FIELDS,
	};
}

function writerProofFieldValue(
	report: Record<string, unknown>,
	field: WriterProofSignedField,
	nonce: string,
): unknown {
	if (field === "writer_proof.nonce") {
		return { present: true, value: nonce };
	}
	if (Object.hasOwn(report, field)) {
		return { present: true, value: report[field] };
	}
	return { present: false };
}

function writerProofContentDigest(report: Record<string, unknown>): string {
	const digestInput = Object.fromEntries(
		Object.entries(report).filter(
			([field]) =>
				field !== "writer_proof" && !WRITER_PROOF_DIRECT_FIELD_SET.has(field),
		),
	);
	return createHash("sha256")
		.update(canonicalJson(digestInput))
		.digest(WRITER_PROOF_SIGNATURE_ENCODING);
}

function correlationWitnessId(
	witness: Omit<CorrelationWitness, "correlation_proof" | "witness_id">,
): string {
	return stableReportId("witness", {
		schema_version: witness.schema_version,
		skill: witness.skill,
		runtime_source: witness.runtime_source,
		hook_report_id: witness.hook_report_id,
		closeout_report_id: witness.closeout_report_id,
		skill_run_id: witness.skill_run_id,
		created_ts: witness.created_ts,
	});
}

function correlationWitnessProofPayload(
	witness: Omit<CorrelationWitness, "correlation_proof">,
	nonce: string,
): unknown {
	return {
		algorithm: WRITER_PROOF_ALGORITHM,
		fields: Object.fromEntries(
			CORRELATION_WITNESS_SIGNED_FIELDS.map((field) => [
				field,
				correlationWitnessFieldValue(witness, field, nonce),
			]),
		),
		signed_fields: CORRELATION_WITNESS_SIGNED_FIELDS,
	};
}

function correlationWitnessFieldValue(
	witness: Omit<CorrelationWitness, "correlation_proof">,
	field: CorrelationWitnessSignedField,
	nonce: string,
): unknown {
	if (field === "correlation_proof.nonce") {
		return { present: true, value: nonce };
	}
	if (Object.hasOwn(witness, field)) {
		return { present: true, value: witness[field] };
	}
	return { present: false };
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalJsonValue(value));
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function canonicalJsonValue(value: unknown): unknown {
	if (value === null) return null;
	if (typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("non-finite number");
		return value;
	}
	if (
		value === undefined ||
		typeof value === "function" ||
		typeof value === "symbol" ||
		typeof value === "bigint"
	) {
		throw new Error("non-json value");
	}
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			if (!Object.hasOwn(value, index)) throw new Error("sparse array");
		}
		return value.map(canonicalJsonValue);
	}
	if (!isRecord(value)) throw new Error("non-json object");
	if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
		throw new Error("custom toJSON");
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new Error("non-plain object");
	}
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonicalJsonValue(value[key])]),
	);
}

function hmacSha256Hex(key: Uint8Array, value: string): string {
	return createHmac("sha256", key).update(value).digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
	if (!isHexString(left, 64) || !isHexString(right, 64)) return false;
	return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function sameStringList(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function isSkillFeedbackOutcome(value: unknown): value is SkillFeedbackOutcome {
	return (SKILL_FEEDBACK_OUTCOMES as readonly unknown[]).includes(value);
}

function isEvidenceSource(value: unknown): value is EvidenceSource {
	return (SKILL_FEEDBACK_EVIDENCE_SOURCES as readonly unknown[]).includes(value);
}

function isCorrelationStatus(value: unknown): value is CorrelationStatus {
	return (
		SKILL_FEEDBACK_CORRELATION_STATUSES as readonly unknown[]
	).includes(value);
}

function isEvidenceGapCode(value: unknown): value is EvidenceGapCode {
	return (EVIDENCE_GAP_CODES as readonly unknown[]).includes(value);
}

function isSkillFeedbackReportLane(
	value: unknown,
): value is SkillFeedbackReportLane {
	return (SKILL_FEEDBACK_REPORT_LANES as readonly unknown[]).includes(value);
}

function isSkillFeedbackReportLaneFilter(
	value: unknown,
): value is SkillFeedbackReportLaneFilter {
	return (SKILL_FEEDBACK_REPORT_LANE_FILTERS as readonly unknown[]).includes(
		value,
	);
}

function isSkillFeedbackReportSourceFilter(
	value: unknown,
): value is SkillFeedbackReportSourceFilter {
	return (SKILL_FEEDBACK_REPORT_SOURCE_FILTERS as readonly unknown[]).includes(
		value,
	);
}

function isSkillFeedbackReportMissingField(
	value: unknown,
): value is SkillFeedbackReportMissingField {
	return (SKILL_FEEDBACK_REPORT_MISSING_FIELDS as readonly unknown[]).includes(
		value,
	);
}

function isSkillFeedbackQueueTargetType(
	value: unknown,
): value is SkillFeedbackQueueTargetType {
	return (SKILL_FEEDBACK_QUEUE_TARGET_TYPES as readonly unknown[]).includes(
		value,
	);
}

function isSkillFeedbackQueueEvidenceStrength(
	value: unknown,
): value is SkillFeedbackQueueEvidenceStrength {
	return (
		SKILL_FEEDBACK_QUEUE_EVIDENCE_STRENGTHS as readonly unknown[]
	).includes(value);
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

function isReviewEngineeringSignalReason(
	value: unknown,
): value is ReviewEngineeringSignalReason {
	return (REVIEW_ENGINEERING_SIGNAL_REASONS as readonly unknown[]).includes(
		value,
	);
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

function isSkillFeedbackCorrelateMode(
	value: unknown,
): value is SkillFeedbackCorrelateMode {
	return (SKILL_FEEDBACK_CORRELATE_MODES as readonly unknown[]).includes(value);
}

function isSkillFeedbackCorrelateCandidateClass(
	value: unknown,
): value is SkillFeedbackCorrelateCandidateClass {
	return (
		SKILL_FEEDBACK_CORRELATE_CANDIDATE_CLASSES as readonly unknown[]
	).includes(value);
}

export function isSkillFeedbackCorrelateReasonId(
	value: unknown,
): value is SkillFeedbackCorrelateReasonId {
	return (
		SKILL_FEEDBACK_CORRELATE_REASON_IDS as readonly unknown[]
	).includes(value);
}

function isSkillFeedbackCorrelateActionId(
	value: unknown,
): value is SkillFeedbackCorrelateActionId {
	return (
		SKILL_FEEDBACK_CORRELATE_ACTION_IDS as readonly unknown[]
	).includes(value);
}

function isSkillFeedbackCorrelateSideEffect(
	value: unknown,
): value is SkillFeedbackCorrelateSideEffect {
	return (
		SKILL_FEEDBACK_CORRELATE_SIDE_EFFECTS as readonly unknown[]
	).includes(value);
}

function isCaptureRuntime(value: unknown): value is CaptureRuntime {
	return (SKILL_FEEDBACK_CAPTURE_RUNTIMES as readonly unknown[]).includes(value);
}

function isCorrelationWitnessRuntimeSource(
	value: unknown,
): value is CorrelationWitnessRuntimeSource {
	return (CORRELATION_WITNESS_RUNTIME_SOURCES as readonly unknown[]).includes(
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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
	"dashboard",
	"reports",
	"report",
	"usage",
	"queue",
	"review",
	"health",
	"purge",
	"correlate",
] as const;

/**
 * Public command union for the facade-backed skill-feedback CLI.
 */
export type SkillFeedbackCommand = (typeof SKILL_FEEDBACK_COMMANDS)[number];

type SkillFeedbackAudience = "agent";
type SkillFeedbackMutation =
	| "capture"
	| "closeout"
	| "dashboard"
	| "reports"
	| "report"
	| "usage"
	| "queue"
	| "review"
	| "health"
	| "purge"
	| "correlate";
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

const dashboardResultContract = {
	id: SKILL_FEEDBACK_DASHBOARD_CONTRACT_ID,
	kind: "Software Learning Report dashboard error envelope.",
	schema_version: SKILL_FEEDBACK_DASHBOARD_RESULT_SCHEMA_VERSION,
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

const correlateResultContract = {
	id: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
	kind: "Software Learning Report correlation repair envelope.",
	schema_version: SKILL_FEEDBACK_CORRELATE_RESULT_SCHEMA_VERSION,
} as const satisfies NonNullable<
	SkillFeedbackCommandContract["resultContract"]
>;

const reportsResultContract = {
	id: SKILL_FEEDBACK_REPORTS_CONTRACT_ID,
	kind: "Software Learning Report recent report list envelope.",
	schema_version: SKILL_FEEDBACK_REPORTS_RESULT_SCHEMA_VERSION,
} as const satisfies NonNullable<
	SkillFeedbackCommandContract["resultContract"]
>;

const reportResultContract = {
	id: SKILL_FEEDBACK_REPORT_CONTRACT_ID,
	kind: "Software Learning Report detail envelope.",
	schema_version: SKILL_FEEDBACK_REPORT_RESULT_SCHEMA_VERSION,
} as const satisfies NonNullable<
	SkillFeedbackCommandContract["resultContract"]
>;

const usageResultContract = {
	id: SKILL_FEEDBACK_USAGE_CONTRACT_ID,
	kind: "Software Learning Report skill usage envelope.",
	schema_version: SKILL_FEEDBACK_USAGE_RESULT_SCHEMA_VERSION,
} as const satisfies NonNullable<
	SkillFeedbackCommandContract["resultContract"]
>;

const queueResultContract = {
	id: SKILL_FEEDBACK_QUEUE_CONTRACT_ID,
	kind: "Software Learning Report improvement queue envelope.",
	schema_version: SKILL_FEEDBACK_QUEUE_RESULT_SCHEMA_VERSION,
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

const dashboardExitCodes = {
	"0": "Dashboard rendered without mutating the inbox.",
	"1": "Dashboard blocked by unsafe inbox state or target resolution failure.",
	"2": "Invalid dashboard usage.",
} as const satisfies SkillFeedbackCommandContract["exitCodes"];

const reportsExitCodes = {
	"0": "Report list rendered without mutating the inbox.",
	"1": "Report list blocked by unsafe inbox state or target resolution failure.",
	"2": "Invalid reports usage.",
} as const satisfies SkillFeedbackCommandContract["exitCodes"];

const reportExitCodes = {
	"0": "Report detail rendered without mutating the inbox.",
	"1": "Report detail blocked by unsafe inbox state or target resolution failure.",
	"2": "Invalid report usage or report ref.",
} as const satisfies SkillFeedbackCommandContract["exitCodes"];

const usageExitCodes = {
	"0": "Skill usage rendered without mutating the inbox.",
	"1": "Skill usage blocked by unsafe inbox state or target resolution failure.",
	"2": "Invalid usage command usage.",
} as const satisfies SkillFeedbackCommandContract["exitCodes"];

const queueExitCodes = {
	"0": "Improvement queue rendered without mutating the inbox.",
	"1": "Improvement queue blocked by unsafe inbox state or target resolution failure.",
	"2": "Invalid queue usage.",
} as const satisfies SkillFeedbackCommandContract["exitCodes"];

const purgeExitCodes = {
	"0": "Purge preview completed or selected safe reports were deleted.",
	"1": "Purge blocked by unsafe inbox state or deletion failure.",
	"2": "Invalid purge usage.",
} as const satisfies SkillFeedbackCommandContract["exitCodes"];

const correlateExitCodes = {
	"0": "Correlation repair preview completed or selected witnesses were written.",
	"1": "Correlation repair blocked by unsafe inbox state or partial write failure.",
	"2": "Invalid correlate usage.",
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

const dashboardFlags = {
	"--repo": {
		type: "string",
		description: "Resolve the read target from this path's repository root.",
	},
} as const satisfies SkillFeedbackCommandContract["flags"];

const humanJsonReadFlags = {
	"--json": {
		type: "boolean",
		description: "Emit a machine-readable JSON envelope.",
	},
	"--repo": {
		type: "string",
		description: "Resolve the read target from this path's repository root.",
	},
} as const satisfies SkillFeedbackCommandContract["flags"];

const reportsFlags = {
	...humanJsonReadFlags,
	"--limit": {
		type: "string",
		description: "Maximum rows to return. Default: 10. Max: 100.",
	},
	"--skill": {
		type: "string",
		description: "Only list reports for this skill identity.",
	},
	"--lane": {
		type: "enum",
		values: SKILL_FEEDBACK_REPORT_LANE_FILTERS,
		description: "Report lane to list: primary, low-signal, or all. Default: primary.",
	},
	"--source": {
		type: "enum",
		values: SKILL_FEEDBACK_REPORT_SOURCE_FILTERS,
		description:
			"Evidence source to list: hook_capture, driver_closeout, or all. Default: all.",
	},
} as const satisfies SkillFeedbackCommandContract["flags"];

const reportFlags = {
	...humanJsonReadFlags,
	"--low-signal": {
		type: "boolean",
		description:
			"Allow opening a ref that exists only in the low-signal lane.",
	},
} as const satisfies SkillFeedbackCommandContract["flags"];

const usageFlags = {
	...humanJsonReadFlags,
	"--limit": {
		type: "string",
		description: "Maximum skill rows to return. Default: 10. Max: 100.",
	},
	"--skill": {
		type: "string",
		description: "Only show usage for this skill identity.",
	},
} as const satisfies SkillFeedbackCommandContract["flags"];

const queueFlags = {
	...humanJsonReadFlags,
	"--limit": {
		type: "string",
		description: "Maximum queue rows to return. Default: 10. Max: 100.",
	},
	"--skill": {
		type: "string",
		description: "Only include rows supported by this skill.",
	},
	"--owner-path": {
		type: "string",
		description: "Only include rows for this repo-relative owner path.",
	},
	"--include-weak": {
		type: "boolean",
		description: "Include weak or sparse evidence rows and label them weak.",
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

const correlateFlags = {
	"--plain": {
		type: "boolean",
		description: "Emit compact human-readable output.",
	},
	"--repo": {
		type: "string",
		description: "Resolve the read target from this path's repository root.",
	},
	"--execute": {
		type: "boolean",
		description: "Write validated private correlation witnesses. Default previews only.",
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
		dashboard: {
			script: "skill-feedback-runner",
			summary: "Show the read-only front-door dashboard for the current repo.",
			usage: ["dashboard [--repo <path>]"],
			json: false,
			audience: "agent",
			mutation: "dashboard",
			sideEffects: ["read"],
			executionModes: ["normal"],
			outputModes: ["plain"],
			interactivity: "none",
			resultContract: dashboardResultContract,
			flags: dashboardFlags,
			exitCodes: dashboardExitCodes,
		},
		reports: {
			script: "skill-feedback-runner",
			summary: "Browse recent Software Learning Reports.",
			usage: [
				"reports [--json] [--limit <count>] [--skill <id>] [--lane primary|low-signal|all] [--source hook_capture|driver_closeout|all] [--repo <path>]",
			],
			json: true,
			audience: "agent",
			mutation: "reports",
			sideEffects: ["read"],
			executionModes: ["normal"],
			outputModes: ["plain", "json"],
			interactivity: "none",
			resultContract: reportsResultContract,
			flags: reportsFlags,
			exitCodes: reportsExitCodes,
		},
		report: {
			script: "skill-feedback-runner",
			summary: "Open one Software Learning Report by report:<id>.",
			usage: ["report <report:id|id> [--json] [--low-signal] [--repo <path>]"],
			json: true,
			audience: "agent",
			mutation: "report",
			sideEffects: ["read"],
			executionModes: ["normal"],
			outputModes: ["plain", "json"],
			interactivity: "none",
			resultContract: reportResultContract,
			flags: reportFlags,
			exitCodes: reportExitCodes,
		},
		usage: {
			script: "skill-feedback-runner",
			summary: "Compare skills by report count, outcome, friction, and last seen time.",
			usage: ["usage [--json] [--limit <count>] [--skill <id>] [--repo <path>]"],
			json: true,
			audience: "agent",
			mutation: "usage",
			sideEffects: ["read"],
			executionModes: ["normal"],
			outputModes: ["plain", "json"],
			interactivity: "none",
			resultContract: usageResultContract,
			flags: usageFlags,
			exitCodes: usageExitCodes,
		},
		queue: {
			script: "skill-feedback-runner",
			summary: "Inspect evidence-backed skill or owner-path improvement candidates.",
			usage: [
				"queue [--json] [--limit <count>] [--skill <id>] [--owner-path <path>] [--include-weak] [--repo <path>]",
			],
			json: true,
			audience: "agent",
			mutation: "queue",
			sideEffects: ["read"],
			executionModes: ["normal"],
			outputModes: ["plain", "json"],
			interactivity: "none",
			resultContract: queueResultContract,
			flags: queueFlags,
			exitCodes: queueExitCodes,
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
		correlate: {
			script: "skill-feedback-runner",
			summary: "Preview or repair missing private correlation witnesses.",
			usage: ["correlate [--plain] [--repo <path>] [--execute]"],
			json: true,
			audience: "agent",
			mutation: "correlate",
			sideEffects: ["write"],
			executionModes: ["dry_run", "normal"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract: correlateResultContract,
			flags: correlateFlags,
			exitCodes: correlateExitCodes,
		},
	} as const satisfies Record<
		SkillFeedbackCommand,
		SkillFeedbackCommandContract
	>,
	{
		path: "skills/skill-feedback/src/command-contract.ts",
		writeImplyingMutations: new Set([
			"capture",
			"closeout",
			"purge",
			"correlate",
		]),
	},
);
