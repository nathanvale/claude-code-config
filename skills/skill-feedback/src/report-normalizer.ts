import {
	SKILL_FEEDBACK_COST_STATUS,
	SKILL_FEEDBACK_SCHEMA_VERSION,
	type CaptureRuntime,
	type CorrelationStatus,
	type EvidenceGap,
	type EvidenceGapCode,
	type EvidenceSource,
	type NormalizeReportResult,
	type NormalizedRuntimeTelemetry,
	type ParseCloseoutReceiptResult,
	type ReceiptField,
	RECEIPT_FIELDS,
	type ReceiptUsage,
	type SkillIdentityProvenance,
	type SkillIdentityProvenanceReason,
	type SkillIdentityProvenanceSource,
	type SkillRunIdProvenance,
	type SoftwareLearningReport,
	type WriterProofContext,
	buildSoftwareLearningReport,
	parseCloseoutReceipt,
	parseReceipt,
} from "./command-contract";
import {
	evidenceGap,
	stableReportId,
	uniqueEvidenceGaps,
} from "./report-helpers";
import {
	isRawObject as isRecord,
	stringFromUnknown,
} from "./raw-object";

const SKILL_FEEDBACK_SCHEMA_VERSION_V1 = "1" as const;
const SKILL_FEEDBACK_EVIDENCE_SOURCES = [
	"hook_capture",
	"driver_closeout",
] as const satisfies readonly EvidenceSource[];
const SKILL_FEEDBACK_CAPTURE_RUNTIMES = [
	"claude_stop",
	"codex_stop",
	"codex_notify",
] as const satisfies readonly CaptureRuntime[];
const SKILL_IDENTITY_PROVENANCE_SOURCES = [
	"claude_transcript_skill_tool_result",
	"codex_notify_payload",
	"codex_stop_payload",
	"none",
] as const satisfies readonly SkillIdentityProvenanceSource[];
const SKILL_IDENTITY_PROVENANCE_REASONS = [
	"claude_transcript_detection",
	"legacy_notify_not_ready",
	"codex_stop_payload_has_no_trusted_skill_identity",
	"trusted_codex_stop_payload_identity",
] as const satisfies readonly SkillIdentityProvenanceReason[];
const SKILL_RUN_ID_PROVENANCE_SOURCES = [
	"runtime_owned",
	"correlation_owned",
	"report_authored",
] as const satisfies readonly SkillRunIdProvenance[];
const SKILL_FEEDBACK_CORRELATION_STATUSES = [
	"linked",
	"unlinked",
] as const satisfies readonly CorrelationStatus[];
const EVIDENCE_GAP_CODES = [
	"missing_skill",
	"missing_goal",
	"missing_outcome",
	"missing_friction",
	"missing_runtime_model",
	"missing_runtime_git_sha",
	"missing_runtime_skill_version",
	"missing_verification_burden",
	"cost_unavailable",
	"unlinked_correlation",
] as const satisfies readonly EvidenceGapCode[];
const RECEIPT_FIELD_SET: ReadonlySet<string> = new Set(RECEIPT_FIELDS);
const RECEIPT_USAGE_FIELDS = [
	"input_tokens",
	"output_tokens",
	"cache_read_tokens",
] as const;
const RECEIPT_USAGE_FIELD_SET: ReadonlySet<string> = new Set(
	RECEIPT_USAGE_FIELDS,
);
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
const V2_REPORT_FIELDS = [
	...V1_REPORT_FIELDS,
	"skill",
	"writer_proof",
	"redactions",
] as const;
const V1_REPORT_FIELD_SET: ReadonlySet<string> = new Set(V1_REPORT_FIELDS);
const V2_REPORT_FIELD_SET: ReadonlySet<string> = new Set(V2_REPORT_FIELDS);
const V0_PLACEHOLDER_FRICTION = new Set([
	"",
	"Hook captured no transcript payload.",
]);

type InvalidNormalizeReport = Extract<NormalizeReportResult, { kind: "invalid" }>;
type ParsedNormalizedReportCard = Exclude<
	ParseCloseoutReceiptResult,
	{ kind: "invalid" }
>;
type NormalizedReportHeader = {
	reportId: string;
	generatedTs: string;
};
type NormalizedReportBody = {
	evidenceSource: EvidenceSource;
	captureRuntime?: CaptureRuntime;
	provenance?: SkillIdentityProvenance;
	correlationStatus: CorrelationStatus;
	skillRunId?: string;
	skillRunIdProvenance?: SkillRunIdProvenance;
	runtime: NormalizedRuntimeTelemetry;
	reportCard: ParsedNormalizedReportCard;
	evidenceGaps: readonly EvidenceGap[];
};
type NormalizedSkillRunLink = Pick<
	NormalizedReportBody,
	"skillRunId" | "skillRunIdProvenance"
>;
type NormalizedReportCardEvidence = Pick<
	NormalizedReportBody,
	"reportCard" | "evidenceGaps"
>;

/**
 * Normalize v0, v1, and v2 persisted report records into one review model.
 *
 * The normalizer is the inbox trust boundary: raw report-authored provenance is
 * evidence-only unless the caller supplies verified writer proof context.
 *
 * @param raw - Unknown parsed inbox JSON.
 * @param proofContext - Optional writer-proof result from the safe read owner.
 * @returns Normalized report or a stable invalid path/reason.
 *
 * @example
 * ```typescript
 * const normalized = normalizeReport(JSON.parse(rawReport))
 * if (normalized.kind === "ok") review(normalized.report)
 * ```
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export function normalizeReport(
	raw: unknown,
	proofContext?: WriterProofContext,
): NormalizeReportResult {
	if (!isRecord(raw)) {
		return { kind: "invalid", path: "$", reason: "expected_object" };
	}
	if ("schema_version" in raw || "report_id" in raw || "report_card" in raw) {
		if (raw.schema_version === SKILL_FEEDBACK_SCHEMA_VERSION_V1) {
			return normalizeV1Report(raw);
		}
		if (raw.schema_version === SKILL_FEEDBACK_SCHEMA_VERSION) {
			return normalizeV2Report(raw, proofContext);
		}
		return { kind: "invalid", path: "schema_version", reason: "unsupported" };
	}
	return normalizeV0Report(raw);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function normalizeV1Report(raw: Record<string, unknown>): NormalizeReportResult {
	const unknownField = validateReportFieldSet(raw, V1_REPORT_FIELD_SET);
	if (unknownField) return unknownField;
	const header = parseNormalizedReportHeader(
		raw,
		SKILL_FEEDBACK_SCHEMA_VERSION_V1,
	);
	if ("kind" in header) return header;
	const body = parseNormalizedReportBody(raw);
	if ("kind" in body) return body;
	return {
		kind: "ok",
		report: {
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
			source_schema_version: "v1",
			...normalizedReportBaseFields(header, body),
			skill: body.reportCard.receipt.skill ?? "",
			...normalizedReportCardFields(body),
		},
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function normalizeV2Report(
	raw: Record<string, unknown>,
	proofContext?: WriterProofContext,
): NormalizeReportResult {
	const unknownField = validateReportFieldSet(raw, V2_REPORT_FIELD_SET);
	if (unknownField) return unknownField;
	const header = parseNormalizedReportHeader(raw, SKILL_FEEDBACK_SCHEMA_VERSION);
	if ("kind" in header) return header;
	if (typeof raw.skill !== "string") {
		return { kind: "invalid", path: "skill", reason: "expected_string" };
	}
	const body = parseNormalizedReportBody(raw);
	if ("kind" in body) return body;
	const proofVerified = proofContext?.verified === true;
	const trustedRunProvenance =
		proofVerified &&
		body.evidenceSource === "hook_capture" &&
		body.captureRuntime === "claude_stop" &&
		body.skillRunIdProvenance === "runtime_owned";
	const proofDiagnostics = proofContext?.diagnostics ?? [];
	return {
		kind: "ok",
		report: {
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
			source_schema_version: "v2",
			...normalizedReportBaseFields(header, body),
			...(trustedRunProvenance
				? { skill_run_id_provenance: body.skillRunIdProvenance }
				: {}),
			skill: body.reportCard.receipt.skill ?? raw.skill,
			...normalizedReportCardFields(body),
			writer_proof_verified: proofVerified,
			proof_diagnostics: proofDiagnostics,
		},
	};
}

function validateReportFieldSet(
	raw: Record<string, unknown>,
	fieldSet: ReadonlySet<string>,
): InvalidNormalizeReport | undefined {
	for (const key of Object.keys(raw)) {
		if (!fieldSet.has(key)) {
			return { kind: "invalid", path: key, reason: "unknown_field" };
		}
	}
	return undefined;
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function parseNormalizedReportHeader(
	raw: Record<string, unknown>,
	schemaVersion:
		| typeof SKILL_FEEDBACK_SCHEMA_VERSION_V1
		| typeof SKILL_FEEDBACK_SCHEMA_VERSION,
): NormalizedReportHeader | InvalidNormalizeReport {
	if (raw.schema_version !== schemaVersion) {
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
	return { reportId: raw.report_id, generatedTs: raw.generated_ts };
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function parseNormalizedReportBody(
	raw: Record<string, unknown>,
): NormalizedReportBody | InvalidNormalizeReport {
	const evidenceSource = parseReportEvidenceSource(raw);
	if (typeof evidenceSource !== "string") return evidenceSource;
	const captureRuntime = parseOptionalCaptureRuntime(raw.capture_runtime);
	if (captureRuntime && typeof captureRuntime !== "string") return captureRuntime;
	const provenance = parseOptionalSkillIdentityProvenance(
		raw.skill_identity_provenance,
	);
	if (provenance && "kind" in provenance) return provenance;
	const correlationStatus = parseReportCorrelationStatus(raw);
	if (typeof correlationStatus !== "string") return correlationStatus;
	const skillRunLink = parseSkillRunLink(raw);
	if ("kind" in skillRunLink) return skillRunLink;
	const runtime = parseRuntimeTelemetry(raw.runtime);
	if ("kind" in runtime) return runtime;
	const reportEvidence = parseNormalizedReportCardEvidence(raw);
	if ("kind" in reportEvidence) return reportEvidence;
	return {
		evidenceSource,
		...(captureRuntime ? { captureRuntime } : {}),
		...(provenance ? { provenance } : {}),
		correlationStatus,
		...skillRunLink,
		runtime,
		...reportEvidence,
	};
}

function parseReportEvidenceSource(
	raw: Record<string, unknown>,
): EvidenceSource | InvalidNormalizeReport {
	const evidenceSource = stringFromUnknown(raw.evidence_source);
	if (isEvidenceSource(evidenceSource)) return evidenceSource;
	return {
		kind: "invalid",
		path: "evidence_source",
		reason: "invalid_evidence_source",
	};
}

function parseReportCorrelationStatus(
	raw: Record<string, unknown>,
): CorrelationStatus | InvalidNormalizeReport {
	const correlationStatus = stringFromUnknown(raw.correlation_status);
	if (isCorrelationStatus(correlationStatus)) return correlationStatus;
	return {
		kind: "invalid",
		path: "correlation_status",
		reason: "invalid_correlation_status",
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function parseSkillRunLink(
	raw: Record<string, unknown>,
): NormalizedSkillRunLink | InvalidNormalizeReport {
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
	return {
		skillRunId: raw.skill_run_id as string | undefined,
		...(skillRunIdProvenance ? { skillRunIdProvenance } : {}),
	};
}

function parseNormalizedReportCardEvidence(
	raw: Record<string, unknown>,
): NormalizedReportCardEvidence | InvalidNormalizeReport {
	const reportCard = parseCloseoutReceipt(raw.report_card, {
		allowLegacySkillRunId: true,
	});
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
			"Skill-attributed cost is unavailable for this report.",
		),
	]);
	return { reportCard, evidenceGaps };
}

function normalizedReportBaseFields(
	header: NormalizedReportHeader,
	body: NormalizedReportBody,
) {
	return {
		report_id: header.reportId,
		untrusted_evidence: true as const,
		generated_ts: header.generatedTs,
		evidence_source: body.evidenceSource,
		...(body.captureRuntime ? { capture_runtime: body.captureRuntime } : {}),
		...(body.provenance ? { skill_identity_provenance: body.provenance } : {}),
		correlation_status: body.correlationStatus,
		skill_run_id: body.skillRunId,
	};
}

function normalizedReportCardFields(body: NormalizedReportBody) {
	return {
		outcome: body.reportCard.receipt.outcome ?? "ambiguous",
		goal: body.reportCard.receipt.goal,
		friction: body.reportCard.receipt.friction,
		verification_burden: body.reportCard.receipt.verification_burden,
		touched_surfaces: body.reportCard.receipt.touched_surfaces ?? [],
		observations: body.reportCard.receipt.observations ?? [],
		evidence_gaps: body.evidenceGaps,
		cost: {
			status: SKILL_FEEDBACK_COST_STATUS.UNAVAILABLE,
			gap_code: "cost_unavailable" as const,
		},
		runtime: body.runtime,
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function parseRuntimeTelemetry(
	raw: unknown,
): NormalizedRuntimeTelemetry | InvalidNormalizeReport {
	if (!isRecord(raw)) {
		return { kind: "invalid", path: "runtime", reason: "expected_object" };
	}
	const runtime: NormalizedRuntimeTelemetry = {};
	for (const key of Object.keys(raw)) {
		if (
			key !== "git_sha" &&
			key !== "skill_version" &&
			key !== "model" &&
			key !== "usage"
		) {
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function parseEvidenceGaps(
	raw: unknown,
): readonly EvidenceGap[] | InvalidNormalizeReport {
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function isReceiptUsage(value: unknown): value is ReceiptUsage {
	if (!isRecord(value)) return false;
	const keys = Object.keys(value);
	return (
		keys.length === RECEIPT_USAGE_FIELDS.length &&
		keys.every((key) => RECEIPT_USAGE_FIELD_SET.has(key)) &&
		typeof value.input_tokens === "number" &&
		typeof value.output_tokens === "number" &&
		typeof value.cache_read_tokens === "number"
	);
}

function isEvidenceSource(value: unknown): value is EvidenceSource {
	return (SKILL_FEEDBACK_EVIDENCE_SOURCES as readonly unknown[]).includes(value);
}

function isCaptureRuntime(value: unknown): value is CaptureRuntime {
	return (SKILL_FEEDBACK_CAPTURE_RUNTIMES as readonly unknown[]).includes(value);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function isSkillIdentityProvenance(
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
): CaptureRuntime | InvalidNormalizeReport | undefined {
	if (raw === undefined) return undefined;
	if (!isCaptureRuntime(raw)) {
		return { kind: "invalid", path: "capture_runtime", reason: "invalid" };
	}
	return raw;
}

function parseOptionalSkillIdentityProvenance(
	raw: unknown,
): SkillIdentityProvenance | InvalidNormalizeReport | undefined {
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
): SkillRunIdProvenance | InvalidNormalizeReport | undefined {
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

function isEvidenceGapCode(value: unknown): value is EvidenceGapCode {
	return (EVIDENCE_GAP_CODES as readonly unknown[]).includes(value);
}
