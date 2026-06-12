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
 * Schema version for the package-owned Software Learning Report envelope.
 *
 * Increment when agent-visible record semantics change.
 */
export const SKILL_FEEDBACK_SCHEMA_VERSION = "1" as const;

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
 * Skill-run outcome union (== success-verify three-way outcome).
 */
export type SkillFeedbackOutcome = (typeof SKILL_FEEDBACK_OUTCOMES)[number];

/**
 * Software Learning Report evidence source.
 */
export type EvidenceSource = (typeof SKILL_FEEDBACK_EVIDENCE_SOURCES)[number];

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
	correlation_status: CorrelationStatus;
	skill_run_id?: string;
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

export type ReviewPilotCheckpoint = {
	started_at: string;
	age_days: number;
	actionable_feedback_numerator: number;
	material_closeout_denominator: number;
	density: number;
	next_action: string;
};

export type ReviewResultData = {
	contract: typeof SKILL_FEEDBACK_REVIEW_CONTRACT_ID;
	schema_version: typeof SKILL_FEEDBACK_SCHEMA_VERSION;
	coverage: ReviewCoverage;
	open_items: readonly ReviewOpenItem[];
	no_action?: { rationale: string };
	retention: ReviewRetention;
	pilot_checkpoint?: ReviewPilotCheckpoint;
};

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
	correlation_status: CorrelationStatus;
	skill_run_id?: string;
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
): SoftwareLearningReport {
	const { fields } = parsed;
	const gaps = parsed.kind === "degraded" ? parsed.gaps : [];
	return {
		evaluation_name: SKILL_FEEDBACK_EVALUATION_NAME,
		untrusted_evidence: true,
		generated_ts: fields.generated_ts ?? "",
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
	"correlation_status",
	"skill_run_id",
	"runtime",
	"report_card",
	"evidence_gaps",
] as const;
const V1_REPORT_FIELD_SET: ReadonlySet<string> = new Set(V1_REPORT_FIELDS);
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

function normalizeV0Report(raw: Record<string, unknown>): NormalizeReportResult {
	const parsed = parseV0SoftwareLearningReport(raw);
	if (!parsed.ok) return parsed.error;
	const report = parsed.report;
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
			correlation_status: correlationStatus,
			skill_run_id: raw.skill_run_id as string | undefined,
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
	const parsed = parseReceipt({
		skill: raw.skill,
		goal: raw.goal,
		outcome: raw.outcome,
		friction: raw.friction,
		explanation: raw.explanation ?? undefined,
		skill_version: raw.skill_version,
		git_sha: raw.git_sha,
		model: raw.model,
		usage: raw.usage,
		generated_ts: raw.generated_ts,
	});
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
const SKILL_FEEDBACK_COMMANDS = ["record", "closeout", "review"] as const;

/**
 * Public command union for the facade-backed skill-feedback CLI.
 */
export type SkillFeedbackCommand = (typeof SKILL_FEEDBACK_COMMANDS)[number];

type SkillFeedbackAudience = "agent";
type SkillFeedbackMutation = "capture" | "closeout" | "review";
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
	schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
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
			usage: ["review [--plain]"],
			json: true,
			audience: "agent",
			mutation: "review",
			sideEffects: ["read"],
			executionModes: ["normal"],
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract: reviewResultContract,
			flags: {
				"--plain": {
					type: "boolean",
					description: "Emit a compact human-readable review.",
				},
			},
			exitCodes: reviewExitCodes,
		},
	} as const satisfies Record<
		SkillFeedbackCommand,
		SkillFeedbackCommandContract
	>,
	{
		path: "skills/skill-feedback/src/command-contract.ts",
		writeImplyingMutations: new Set(["capture", "closeout"]),
	},
);
