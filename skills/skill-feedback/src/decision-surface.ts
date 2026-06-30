import { createHash } from "node:crypto";
import {
	SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
	SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
	SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION,
	type CorrelationWitnessHealth,
	type EvidenceGap,
	type EvidenceGapCode,
	type FrictionCategory,
	type HealthClaimReadiness,
	type HealthInboxStatus,
	type HealthNextAction,
	type HealthResultData,
	type HealthWarning,
	type HealthWarningReasonId,
	type NormalizedSoftwareLearningReport,
	type ReportCardObservation,
	type ReviewClaimReadiness,
	type ReviewClaimReadinessFact,
	type ReviewOpenItem,
	type ReviewReadTarget,
	type ReviewResultData,
} from "./command-contract";
import {
	type ReviewInboxRead,
	deriveInboxHealth,
	writerProofHealth,
} from "./inbox-read-model";
import type { ReadTargetResolution } from "./runtime-contract";
import { reduceReviewLedger, trustedSkillRunId } from "./review-ledger-reducer";

const HEALTH_LOW_SIGNAL_WARNING_THRESHOLD = 10;
const RETENTION_AGE_WARNING_DAYS = 14;
const RETENTION_COUNT_WARNING_THRESHOLD = 100;
const NON_ACTIONABLE_EVIDENCE_GAP_CODES: ReadonlySet<EvidenceGapCode> = new Set([
	"cost_unavailable",
	"unlinked_correlation",
	"missing_runtime_model",
]);
const REVIEW_OPEN_REASON_RANK: Record<ReviewOpenItem["open_reason"], number> = {
	owner_path_observation: 0,
	high_verification_burden: 1,
	repeated_friction: 2,
	evidence_gap: 3,
	unlinked_correlation_spike: 4,
};
const REVIEW_OPEN_SEVERITY_RANK: Record<ReviewOpenItem["severity"], number> = {
	action: 0,
	warning: 1,
	info: 2,
};

type HealthSignalInput = {
	status: HealthInboxStatus;
	counts: HealthResultData["counts"];
	correlationWitnesses: CorrelationWitnessHealth;
	retentionWarning?: string;
};

type HealthNextActionRule = {
	matches: (input: HealthSignalInput) => boolean;
	action: HealthNextAction;
};

type HealthInboxStatusRule = {
	matches: (inbox: ReviewInboxRead) => boolean;
	status: HealthInboxStatus;
};

const HEALTH_INBOX_STATUS_RULES: readonly HealthInboxStatusRule[] = [
	{ matches: hasUnsafeInboxRoot, status: "unsafe" },
	{ matches: hasMissingInboxRoot, status: "missing" },
	{ matches: hasPartialReadability, status: "partially_readable" },
	{ matches: hasNoReadableReports, status: "empty" },
];

const HEALTH_STATUS_WARNINGS: Record<
	HealthInboxStatus,
	readonly HealthWarning[]
> = {
	missing: [
		healthWarning(
			"inbox_missing",
			"No .skill-feedback/ inbox exists in the selected repository.",
		),
	],
	empty: [healthWarning("inbox_empty", "The inbox exists but has no reports.")],
	unsafe: [
		healthWarning(
			"unsafe_inbox",
			"The inbox root is not a safe private directory.",
		),
	],
	partially_readable: [
		healthWarning(
			"partial_readability",
			"Some inbox artifacts were invalid or skipped as unsafe.",
		),
	],
	populated: [],
};

const HEALTH_DEFAULT_NEXT_ACTION: HealthNextAction = {
	action_id: "run-review",
	summary: "Run review for claim-safe ledger detail.",
};

const HEALTH_NEXT_ACTION_RULES: readonly HealthNextActionRule[] = [
	{
		matches: needsInboxRepair,
		action: {
			action_id: "repair-inbox-state",
			summary: "Repair unsafe or invalid inbox artifacts before drawing conclusions.",
		},
	},
	{
		matches: needsCapturePathConfirmation,
		action: {
			action_id: "confirm-capture-path",
			summary: "Confirm .skill-feedback/ is ignored before capture creates reports.",
		},
	},
	{
		matches: needsCorrelationRepairPreview,
		action: {
			action_id: "preview-correlation-repair",
			summary:
				"Run correlate preview to classify blocked correlation witness diagnostics.",
		},
	},
	{
		matches: needsCorrelationInspection,
		action: {
			action_id: "inspect-report-correlation",
			summary:
				"Interpret primary reports as report-level evidence until correlation exists.",
		},
	},
	{
		matches: needsCaptureIdentityInspection,
		action: {
			action_id: "inspect-capture-identity",
			summary: "Inspect runtime capture and skill identity before promotion.",
		},
	},
	{
		matches: needsPurgePreview,
		action: {
			action_id: "preview-purge",
			summary: "Preview explicit purge; health does not delete reports.",
		},
	},
];

/**
 * Successful read-target facts used by read-only decision assembly.
 */
export type DecisionReadTarget = Extract<ReadTargetResolution, { ok: true }>;

/**
 * Inputs needed to assemble the claim-safe review decision surface.
 */
export type BuildReviewResultDataInput = {
	/** Safe inbox read facts from `inbox-read-model.ts`. */
	inbox: ReviewInboxRead;
	/** Current ISO timestamp supplied by the runtime owner. */
	nowIso: string;
	/** Optional pilot marker timestamp read by the runner. */
	pilotStartedAt?: string;
	/** Resolved repository and inbox target facts. */
	readTarget: DecisionReadTarget;
};

/**
 * Inputs needed to assemble the health decision surface.
 */
export type BuildHealthResultDataInput = {
	/** Safe inbox read facts from `inbox-read-model.ts`. */
	inbox: ReviewInboxRead;
	/** Current ISO timestamp supplied by the runtime owner. */
	nowIso: string;
	/** Resolved repository and inbox target facts. */
	readTarget: DecisionReadTarget;
};

/**
 * Build the complete review result data consumed by JSON and plain renderers.
 *
 * @param input - Safe inbox, clock, pilot marker, and read-target facts.
 * @returns Existing review result contract data with complete evidence arrays.
 *
 * @example
 * ```typescript
 * const data = buildReviewResultData({ inbox, nowIso, readTarget })
 * ```
 */
export function buildReviewResultData(
	input: BuildReviewResultDataInput,
): ReviewResultData {
	const reports = input.inbox.primaryReports;
	const lowSignalReports = input.inbox.lowSignalReports;
	const reviewUnits = coalesceReviewUnits(reports);
	const closeoutUnits = reviewUnits.filter(hasCloseoutEvidence);
	const captureOnlyUnits = reviewUnits.filter(
		(unit) => hasCaptureEvidence(unit) && !hasCloseoutEvidence(unit),
	);
	const signalContext = reviewSignalContext(reports);
	const openItems = deriveReviewOpenItems(reports, signalContext);
	const coverage = reviewCoverage(
		reports,
		reviewUnits,
		closeoutUnits,
		captureOnlyUnits,
	);
	const ledger = reduceReviewLedger(reports);
	const allReports = [
		...reports,
		...lowSignalReports.map((entry) => entry.report),
	];
	const claimReadiness = deriveClaimReadiness(allReports);
	const inboxStatus = healthInboxStatus(input.inbox);
	const correlation = healthCorrelation(reports);
	const counts = healthCounts(input.inbox, correlation);
	const correlationWitnesses = correlationWitnessHealth(input.inbox);
	const retention = retentionSummary(reports, input.nowIso);
	const warnings = deriveHealthWarnings({
		status: inboxStatus,
		counts,
		correlationWitnesses,
		retentionWarning: retention.warning,
	});
	const nextAction = deriveHealthNextAction({
		status: inboxStatus,
		counts,
		correlationWitnesses,
		retentionWarning: retention.warning,
	});
	const pilotCheckpoint = pilotCheckpointSummary({
		startedAt: input.pilotStartedAt,
		nowIso: input.nowIso,
		closeoutCount: closeoutUnits.length,
		actionableCloseoutCount: closeoutUnits.filter((unit) =>
			unit.reports.some((report) => reportHasReviewOpenSignal(report, signalContext)),
		).length,
		noAction: openItems.length === 0,
	});
	const readTarget = reviewReadTargetData(input.readTarget, inboxStatus);
	return {
		contract: SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
		schema_version: SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION,
		coverage,
		inbox_health: deriveInboxHealth(
			reports,
			lowSignalReports,
			input.inbox.skippedUnsafeCount,
			input.inbox.invalidCount,
		),
		inbox_status: inboxStatus,
			counts,
			warnings,
			next_action: nextAction,
			...reviewReadTargetField(readTarget),
			open_items: openItems,
			open_actions: deriveOpenActions(openItems),
			...reviewNoActionField(reports.length, openItems.length),
			retention,
			...pilotCheckpointField(pilotCheckpoint),
			review_units: ledger.review_units,
			ledger_entries: ledger.ledger_entries,
			anchor_miss_telemetry: ledger.anchor_miss_telemetry,
		proof_health: writerProofHealth(allReports, input.inbox.proofDiagnostics),
		correlation_witnesses: correlationWitnesses,
		claim_readiness: claimReadiness,
		};
	}

function reviewCoverage(
	reports: readonly NormalizedSoftwareLearningReport[],
	reviewUnits: readonly ReviewUnit[],
	closeoutUnits: readonly ReviewUnit[],
	captureOnlyUnits: readonly ReviewUnit[],
): ReviewResultData["coverage"] {
	const closeoutRate = closeoutCoverageRate(reviewUnits.length, closeoutUnits.length);
	const lowCoverage = reports.length > 0 && closeoutRate < 0.5;
	return {
		total_reports: reports.length,
		closeout_count: closeoutUnits.length,
		capture_only_count: captureOnlyUnits.length,
		unlinked_count: reports.filter(isUnlinkedReport).length,
		evidence_gap_count: evidenceGapCount(reports),
		closeout_rate: closeoutRate,
		low_coverage: lowCoverage,
		...lowCoverageWarning(lowCoverage),
	};
}

function closeoutCoverageRate(reviewUnitCount: number, closeoutCount: number): number {
	return reviewUnitCount === 0 ? 0 : roundRatio(closeoutCount / reviewUnitCount);
}

function evidenceGapCount(
	reports: readonly NormalizedSoftwareLearningReport[],
): number {
	return reports.reduce((sum, report) => sum + report.evidence_gaps.length, 0);
}

function isUnlinkedReport(report: NormalizedSoftwareLearningReport): boolean {
	return report.correlation_status === "unlinked";
}

function lowCoverageWarning(
	lowCoverage: boolean,
): Partial<Pick<ReviewResultData["coverage"], "low_coverage_warning">> {
	return lowCoverage
		? {
				low_coverage_warning:
					"Closeout coverage is low; suppress target-skill quality conclusions.",
			}
		: {};
}

function reviewReadTargetField(
	readTarget?: ReviewReadTarget,
): Partial<Pick<ReviewResultData, "read_target">> {
	return readTarget ? { read_target: readTarget } : {};
}

function reviewNoActionField(
	reportCount: number,
	openItemCount: number,
): Partial<Pick<ReviewResultData, "no_action">> {
	return openItemCount === 0
		? { no_action: { rationale: reviewNoActionRationale(reportCount) } }
		: {};
}

function reviewNoActionRationale(reportCount: number): string {
	return reportCount === 0
		? "No skill-feedback reports found."
		: "No high-signal open items found in this review window.";
}

function pilotCheckpointField(
	pilotCheckpoint: ReviewResultData["pilot_checkpoint"],
): Partial<Pick<ReviewResultData, "pilot_checkpoint">> {
	return pilotCheckpoint ? { pilot_checkpoint: pilotCheckpoint } : {};
}

/**
 * Build the read-only health result data consumed by JSON and plain renderers.
 *
 * @param input - Safe inbox, clock, and read-target facts.
 * @returns Existing health result contract data.
 *
 * @example
 * ```typescript
 * const data = buildHealthResultData({ inbox, nowIso, readTarget })
 * ```
 */
export function buildHealthResultData(
	input: BuildHealthResultDataInput,
): HealthResultData {
	const primaryReports = input.inbox.primaryReports;
	const lowSignalReports = input.inbox.lowSignalReports;
	const allReports = [
		...primaryReports,
		...lowSignalReports.map((entry) => entry.report),
	];
	const inboxStatus = healthInboxStatus(input.inbox);
	const correlation = healthCorrelation(primaryReports);
	const counts = healthCounts(input.inbox, correlation);
	const correlationWitnesses = correlationWitnessHealth(input.inbox);
	const retention = retentionSummary(primaryReports, input.nowIso);
	const warnings = deriveHealthWarnings({
		status: inboxStatus,
		counts,
		correlationWitnesses,
		retentionWarning: retention.warning,
	});
	const nextAction = deriveHealthNextAction({
		status: inboxStatus,
		counts,
		correlationWitnesses,
		retentionWarning: retention.warning,
	});
	const claimReadiness = toHealthClaimReadiness(
		deriveClaimReadiness(allReports),
	);
	const readTarget = healthReadTargetData(input.readTarget, inboxStatus);
	return {
		contract: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
		schema_version: SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
		inbox_status: inboxStatus,
		counts,
		newest: {
			...newestGeneratedTs(primaryReports, "primary_generated_ts"),
			...newestGeneratedTs(
				lowSignalReports.map((entry) => entry.report),
				"low_signal_generated_ts",
			),
		},
		warnings,
		proof_health: writerProofHealth(allReports, input.inbox.proofDiagnostics),
		correlation_witnesses: correlationWitnesses,
		claim_readiness: claimReadiness,
		correlation,
		next_action: nextAction,
		...(readTarget ? { read_target: readTarget } : {}),
	};
}

function reviewReadTargetData(
	resolution: DecisionReadTarget,
	inboxStatus: HealthInboxStatus,
): ReviewReadTarget | undefined {
	if (!resolution.explicit && inboxStatus === "populated") return undefined;
	return readTargetDiagnosticData(resolution);
}

function healthReadTargetData(
	resolution: DecisionReadTarget,
	inboxStatus: HealthInboxStatus,
): ReviewReadTarget | undefined {
	if (
		!resolution.explicit &&
		inboxStatus !== "unsafe" &&
		inboxStatus !== "partially_readable"
	) {
		return undefined;
	}
	return readTargetDiagnosticData(resolution);
}

function readTargetDiagnosticData(resolution: DecisionReadTarget): ReviewReadTarget {
	return {
		explicit: resolution.explicit,
		repo_root: resolution.repoRoot,
		inbox_path: resolution.inboxPath,
		target_path: resolution.seedPath,
	};
}

function healthInboxStatus(inbox: ReviewInboxRead): HealthInboxStatus {
	return (
		HEALTH_INBOX_STATUS_RULES.find((rule) => rule.matches(inbox))?.status ??
		"populated"
	);
}

function healthCounts(
	inbox: ReviewInboxRead,
	correlation: HealthResultData["correlation"],
): HealthResultData["counts"] {
	return {
		primary: inbox.primaryReports.length,
		low_signal: inbox.lowSignalReports.length,
		invalid: inbox.invalidCount,
		skipped_unsafe: inbox.skippedUnsafeCount,
		unlinked_primary: correlation.unlinked_primary_count,
	};
}

function newestGeneratedTs<Key extends keyof HealthResultData["newest"]>(
	reports: readonly NormalizedSoftwareLearningReport[],
	key: Key,
): Partial<Pick<HealthResultData["newest"], Key>> {
	const newest = reports
		.map(generatedTimestamp)
		.filter(isDefined)
		.reduce(newerTimestamp, undefined);
	if (!newest) return {};
	return { [key]: newest.value } as Partial<Pick<HealthResultData["newest"], Key>>;
}

type GeneratedTimestamp = { value: string; epochMs: number };

function generatedTimestamp(
	report: NormalizedSoftwareLearningReport,
): GeneratedTimestamp | undefined {
	const epochMs = Date.parse(report.generated_ts);
	return Number.isFinite(epochMs)
		? { value: report.generated_ts, epochMs }
		: undefined;
}

function newerTimestamp(
	current: GeneratedTimestamp | undefined,
	next: GeneratedTimestamp,
): GeneratedTimestamp {
	return !current || next.epochMs >= current.epochMs ? next : current;
}

function deriveHealthWarnings(input: HealthSignalInput): HealthWarning[] {
	const warnings = [...HEALTH_STATUS_WARNINGS[input.status]];
	if (input.counts.unlinked_primary > 0) {
		warnings.push(
			healthWarning(
				"unlinked_primary_reports",
				"Primary reports lack trusted skill-run correlation.",
			),
		);
	}
	if (input.counts.low_signal >= HEALTH_LOW_SIGNAL_WARNING_THRESHOLD) {
		warnings.push(
			healthWarning(
				"low_signal_threshold",
				"Low-signal runtime capture volume needs identity inspection.",
			),
		);
	}
	if (input.retentionWarning) {
		warnings.push(
			healthWarning(
				"retention_preview_recommended",
				"Primary report volume or age is ready for explicit purge preview.",
			),
		);
	}
	return warnings;
}

function deriveHealthNextAction(input: HealthSignalInput): HealthNextAction {
	return (
		HEALTH_NEXT_ACTION_RULES.find((rule) => rule.matches(input))?.action ??
		HEALTH_DEFAULT_NEXT_ACTION
	);
}

function healthWarning(
	reasonId: HealthWarningReasonId,
	summary: string,
): HealthWarning {
	return { reason_id: reasonId, summary };
}

function hasUnsafeInboxRoot(inbox: ReviewInboxRead): boolean {
	return inbox.inboxRootStatus === "unsafe";
}

function hasMissingInboxRoot(inbox: ReviewInboxRead): boolean {
	return inbox.inboxRootStatus === "missing";
}

function hasPartialReadability(inbox: ReviewInboxRead): boolean {
	return inbox.skippedUnsafeCount > 0 || inbox.invalidCount > 0;
}

function hasNoReadableReports(inbox: ReviewInboxRead): boolean {
	return inbox.primaryReports.length === 0 && inbox.lowSignalReports.length === 0;
}

function needsInboxRepair(input: HealthSignalInput): boolean {
	return input.status === "unsafe" || input.status === "partially_readable";
}

function needsCapturePathConfirmation(input: HealthSignalInput): boolean {
	return input.status === "missing" || input.status === "empty";
}

function needsCorrelationRepairPreview(input: HealthSignalInput): boolean {
	return (
		input.correlationWitnesses.blocked_count > 0 &&
		input.correlationWitnesses.diagnostics.length > 0
	);
}

function needsCorrelationInspection(input: HealthSignalInput): boolean {
	return (
		input.counts.primary > 0 &&
		input.counts.unlinked_primary === input.counts.primary
	);
}

function needsCaptureIdentityInspection(input: HealthSignalInput): boolean {
	return input.counts.low_signal >= HEALTH_LOW_SIGNAL_WARNING_THRESHOLD;
}

function needsPurgePreview(input: HealthSignalInput): boolean {
	return input.retentionWarning !== undefined;
}

function toHealthClaimReadiness(
	readiness: ReviewClaimReadiness,
): HealthClaimReadiness {
	return {
		runtime_capture: healthReadinessFact(readiness.runtime_capture),
		trusted_skill_identity: healthReadinessFact(
			readiness.trusted_skill_identity,
		),
		daily_pilot: healthReadinessFact(readiness.daily_pilot),
		claude_daily_pilot: healthReadinessFact(readiness.claude_daily_pilot),
		codex_trusted_skill_identity: healthReadinessFact(
			readiness.codex_trusted_skill_identity,
		),
	};
}

function healthReadinessFact(fact: ReviewClaimReadinessFact) {
	return {
		status: fact.status,
		reason_ids: fact.reason_ids,
	};
}

function healthCorrelation(
	reports: readonly NormalizedSoftwareLearningReport[],
): HealthResultData["correlation"] {
	const unlinked = reports.filter(
		(report) => report.correlation_status === "unlinked",
	).length;
	const linked = reports.length - unlinked;
	return {
		status:
			reports.length === 0
				? "none"
				: unlinked === 0
					? "linked"
					: linked === 0
						? "all_unlinked"
						: "partially_linked",
		linked_primary_count: linked,
		unlinked_primary_count: unlinked,
	};
}

function deriveOpenActions(
	openItems: readonly ReviewOpenItem[],
): ReviewResultData["open_actions"] {
	return [...openItems]
		.map((item) => ({
			item,
			action: {
				action_key: reviewActionKey(item),
				open_reason: item.open_reason,
				...(item.target ? { target: item.target } : {}),
				next_safe_action: item.next_action,
				evidence_refs: item.evidence_refs,
			},
		}))
		.sort((left, right) => compareReviewOpenItems(left.item, right.item))
		.map(({ action }) => action);
}

function compareReviewOpenItems(
	left: ReviewOpenItem,
	right: ReviewOpenItem,
): number {
	const leftRank = reviewOpenItemRank(left);
	const rightRank = reviewOpenItemRank(right);
	const rank = leftRank.reduce(
		(result, value, index) => result || value - (rightRank[index] ?? 0),
		0,
	);
	if (rank !== 0) return rank;
	return reviewActionKey(left).localeCompare(reviewActionKey(right));
}

function reviewOpenItemRank(item: ReviewOpenItem): readonly number[] {
	return [
		REVIEW_OPEN_SEVERITY_RANK[item.severity],
		REVIEW_OPEN_REASON_RANK[item.open_reason],
		-item.evidence_refs.length,
		reviewOpenItemOwnerRank(item),
		reviewOpenItemNextActionRank(item),
	];
}

function reviewOpenItemOwnerRank(item: ReviewOpenItem): number {
	if (item.target?.type === "path") return 0;
	if (item.target) return 1;
	return 2;
}

function reviewOpenItemNextActionRank(item: ReviewOpenItem): number {
	return item.next_action.trim() === "" ? 1 : 0;
}

function reviewActionKey(item: ReviewOpenItem): string {
	const target = item.target ? `${item.target.type}:${item.target.value}` : "";
	const seed = JSON.stringify({
		open_reason: item.open_reason,
		evidence_refs: [...item.evidence_refs].sort(),
		target,
	});
	return `action:${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function reportEvidenceRef(report: NormalizedSoftwareLearningReport): string {
	return `report:${report.report_id}`;
}

function correlationWitnessHealth(
	inbox: ReviewInboxRead,
): CorrelationWitnessHealth {
	return {
		verified_count: inbox.verifiedCorrelationWitnessCount,
		blocked_count: inbox.blockedCorrelationWitnessCount,
		orphan_count: inbox.orphanCorrelationWitnessCount,
		diagnostics: uniqueSorted(inbox.correlationDiagnostics),
	};
}

function deriveClaimReadiness(
	reports: readonly NormalizedSoftwareLearningReport[],
): ReviewClaimReadiness {
	const trustedClaudeStop = reports.filter(isTrustedClaudeStopReport);
	const codexStopReports = reports.filter(
		(report) =>
			report.evidence_source === "hook_capture" &&
			report.capture_runtime === "codex_stop",
	);
	const trustedCodexStop = codexStopReports.filter(isTrustedCodexStopReport);
	const legacyNotify = reports.filter(
		(report) =>
			report.evidence_source === "hook_capture" &&
			report.capture_runtime === "codex_notify",
	);

	const runtimeCapture = runtimeCaptureClaim(codexStopReports, legacyNotify);

	const codexTrustedSkillIdentity: ReviewClaimReadinessFact = {
		status: "blocked",
		reason_ids: ["missing_engine_owned_identity"],
		evidence_refs: trustedCodexStop.map((report) => report.report_id),
	};

	const claudeDailyPilot: ReviewClaimReadinessFact =
		trustedClaudeStop.length > 0
			? {
					status: "ready",
					reason_ids: [
						"decision_44_claude_supported",
						"claude_stop_skill_detected",
					],
					evidence_refs: trustedClaudeStop.map((report) => report.report_id),
				}
			: {
					status: "blocked",
					reason_ids: ["no_claude_stop_skill_evidence"],
					evidence_refs: [],
				};

	return {
		runtime_capture: runtimeCapture,
		trusted_skill_identity: codexTrustedSkillIdentity,
		daily_pilot: claudeDailyPilot,
		claude_daily_pilot: claudeDailyPilot,
		codex_trusted_skill_identity: codexTrustedSkillIdentity,
	};
}

function runtimeCaptureClaim(
	codexStopReports: readonly NormalizedSoftwareLearningReport[],
	legacyNotify: readonly NormalizedSoftwareLearningReport[],
): ReviewClaimReadinessFact {
	return {
		status: runtimeCaptureStatus(codexStopReports.length, legacyNotify.length),
		reason_ids: runtimeCaptureReasonIds(
			codexStopReports.length,
			legacyNotify.length,
		),
		evidence_refs: codexStopReports.map((report) => report.report_id),
	};
}

function runtimeCaptureStatus(
	codexStopCount: number,
	legacyNotifyCount: number,
): ReviewClaimReadinessFact["status"] {
	return codexStopCount > 0 && legacyNotifyCount === 0
		? "evidence_only"
		: "blocked";
}

function runtimeCaptureReasonIds(
	codexStopCount: number,
	legacyNotifyCount: number,
): string[] {
	return [
		codexStopCount === 0 ? "no_codex_stop_runtime_evidence" : undefined,
		legacyNotifyCount > 0 ? "legacy_notify_evidence_not_ready" : undefined,
		codexStopCount > 0
			? "hook_approval_state_not_machine_observable"
			: undefined,
	].filter(isDefined);
}

type ReviewUnit = {
	key: string;
	trustedRun: boolean;
	trustedSkillRunId?: string;
	reports: NormalizedSoftwareLearningReport[];
};

type ReviewSignalContext = {
	repeatedFrictionCategories: ReadonlySet<FrictionCategory>;
	unlinkedSpike: boolean;
};

type OwnerPathObservation = ReportCardObservation & {
	target: { type: "path"; value: string };
};

type ReviewOpenReasonEvidence =
	| { open_reason: "high_verification_burden" }
	| { open_reason: "evidence_gap"; gaps: readonly EvidenceGap[] }
	| {
			open_reason: "owner_path_observation";
			observation: OwnerPathObservation;
	  }
	| { open_reason: "repeated_friction"; category: FrictionCategory }
	| { open_reason: "unlinked_correlation_spike" };

function coalesceReviewUnits(
	reports: readonly NormalizedSoftwareLearningReport[],
): ReviewUnit[] {
	const units: ReviewUnit[] = [];
	const linkedUnits = new Map<string, ReviewUnit>();
	for (const report of reports) {
		const trustedRunId = trustedSkillRunId(report);
		if (!trustedRunId) {
			units.push({
				key: `report:${report.report_id}`,
				trustedRun: false,
				reports: [report],
			});
			continue;
		}
		let unit = linkedUnits.get(trustedRunId);
		if (!unit) {
			unit = {
				key: `run:${trustedRunId}`,
				trustedRun: true,
				trustedSkillRunId: trustedRunId,
				reports: [],
			};
			linkedUnits.set(trustedRunId, unit);
			units.push(unit);
		}
		unit.reports.push(report);
	}
	return units;
}

function hasCloseoutEvidence(unit: ReviewUnit): boolean {
	return unit.reports.some((report) => report.evidence_source === "driver_closeout");
}

function hasCaptureEvidence(unit: ReviewUnit): boolean {
	return unit.reports.some((report) => report.evidence_source === "hook_capture");
}

function isTrustedCodexStopReport(
	report: NormalizedSoftwareLearningReport,
): boolean {
	return [
		report.evidence_source === "hook_capture" &&
			report.capture_runtime === "codex_stop",
		hasTrustedSkillIdentitySource(report, "codex_stop_payload"),
		isNonPlaceholderSkill(report.skill),
		isNonPlaceholderRuntimeValue(report.runtime.model),
		isNonPlaceholderRuntimeValue(report.runtime.skill_version),
	].every(Boolean);
}

function isTrustedClaudeStopReport(
	report: NormalizedSoftwareLearningReport,
): boolean {
	return [
		report.evidence_source === "hook_capture" &&
			report.capture_runtime === "claude_stop",
		report.writer_proof_verified === true,
		hasTrustedSkillIdentitySource(
			report,
			"claude_transcript_skill_tool_result",
		),
		isNonPlaceholderSkill(report.skill),
	].every(Boolean);
}

function hasTrustedSkillIdentitySource(
	report: NormalizedSoftwareLearningReport,
	source: NonNullable<
		NormalizedSoftwareLearningReport["skill_identity_provenance"]
	>["source"],
): boolean {
	return (
		report.skill_identity_provenance?.trusted === true &&
		report.skill_identity_provenance.source === source
	);
}

function isNonPlaceholderSkill(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return normalized !== "" && normalized !== "unknown" && normalized !== "unknown-skill";
}

function isNonPlaceholderRuntimeValue(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized !== "" && normalized !== "unknown";
}

function reviewSignalContext(
	reports: readonly NormalizedSoftwareLearningReport[],
): ReviewSignalContext {
	return {
		repeatedFrictionCategories: new Set(
			repeatedFriction(reports).map(([category]) => category),
		),
		unlinkedSpike:
			reports.filter((report) => report.correlation_status === "unlinked")
				.length >= 2,
	};
}

function deriveReviewOpenItems(
	reports: readonly NormalizedSoftwareLearningReport[],
	signalContext: ReviewSignalContext,
): ReviewOpenItem[] {
	const matches = reviewReasonMatches(reports, signalContext);
	return [
		...matches
			.map(({ report, reason }) => directReviewOpenItem(report, reason))
			.filter(isDefined),
		...repeatedFrictionOpenItems(reports, repeatedFrictionCategories(matches)),
		...unlinkedSpikeOpenItems(reports, hasUnlinkedSpikeReason(matches)),
	];
}

type ReviewReasonMatch = {
	report: NormalizedSoftwareLearningReport;
	reason: ReviewOpenReasonEvidence;
};

function reviewReasonMatches(
	reports: readonly NormalizedSoftwareLearningReport[],
	signalContext: ReviewSignalContext,
): ReviewReasonMatch[] {
	return reports.flatMap((report) =>
		reviewOpenReasons(report, signalContext).map((reason) => ({ report, reason })),
	);
}

function repeatedFrictionCategories(
	matches: readonly ReviewReasonMatch[],
): ReadonlySet<FrictionCategory> {
	return new Set(matches.map(repeatedFrictionCategory).filter(isDefined));
}

function repeatedFrictionCategory(
	match: ReviewReasonMatch,
): FrictionCategory | undefined {
	return match.reason.open_reason === "repeated_friction"
		? match.reason.category
		: undefined;
}

function hasUnlinkedSpikeReason(matches: readonly ReviewReasonMatch[]): boolean {
	return matches.some(
		({ reason }) => reason.open_reason === "unlinked_correlation_spike",
	);
}

function directReviewOpenItem(
	report: NormalizedSoftwareLearningReport,
	reason: ReviewOpenReasonEvidence,
): ReviewOpenItem | undefined {
	switch (reason.open_reason) {
		case "high_verification_burden":
			return {
				open_reason: "high_verification_burden",
				severity: "action",
				evidence: `${report.skill} reported heavy verification burden.`,
				evidence_refs: [reportEvidenceRef(report)],
				next_action:
					"Inspect the verification burden note against source and tests.",
			};
		case "evidence_gap":
			return {
				open_reason: "evidence_gap",
				severity: "warning",
				evidence: `${report.skill} has ${reason.gaps.length} actionable evidence gap(s).`,
				evidence_refs: [reportEvidenceRef(report)],
				next_action:
					"Inspect missing evidence before drawing skill-quality conclusions.",
			};
		case "owner_path_observation":
			return {
				open_reason: "owner_path_observation",
				severity: "action",
				evidence: reason.observation.summary,
				evidence_refs: [reportEvidenceRef(report)],
				target: reason.observation.target,
				next_action: "Inspect the owner path and confirm evidence before editing.",
			};
		default:
			return undefined;
	}
}

function repeatedFrictionOpenItems(
	reports: readonly NormalizedSoftwareLearningReport[],
	categories: ReadonlySet<FrictionCategory>,
): ReviewOpenItem[] {
	return [...categories].map((category) => {
		const refs = reports
			.filter((report) => report.friction?.category === category)
			.map(reportEvidenceRef)
			.sort();
		return {
			open_reason: "repeated_friction",
			severity: "warning",
			evidence: `${refs.length} reports mention ${category} friction.`,
			evidence_refs: refs,
			next_action: "Group reports by friction category and inspect the common owner.",
		};
	});
}

function unlinkedSpikeOpenItems(
	reports: readonly NormalizedSoftwareLearningReport[],
	hasUnlinkedSpikeReason: boolean,
): ReviewOpenItem[] {
	if (!hasUnlinkedSpikeReason) return [];
	const refs = reports
		.filter((report) => report.correlation_status === "unlinked")
		.map(reportEvidenceRef)
		.sort();
	return [
		{
			open_reason: "unlinked_correlation_spike",
			severity: "warning",
			evidence: `${refs.length} reports are unlinked.`,
			evidence_refs: refs,
			next_action: "Inspect skill-feedback or runtime adapter correlation.",
		},
	];
}

function reportHasReviewOpenSignal(
	report: NormalizedSoftwareLearningReport,
	signalContext: ReviewSignalContext,
): boolean {
	return reviewOpenReasons(report, signalContext).length > 0;
}

function reviewOpenReasons(
	report: NormalizedSoftwareLearningReport,
	signalContext: ReviewSignalContext,
): ReviewOpenReasonEvidence[] {
	return [
		verificationBurdenReason(report),
		evidenceGapReason(report),
		...ownerPathObservationReasons(report),
		repeatedFrictionReason(report, signalContext),
		unlinkedSpikeReason(report, signalContext),
	].filter(isDefined);
}

function verificationBurdenReason(
	report: NormalizedSoftwareLearningReport,
): ReviewOpenReasonEvidence | undefined {
	return report.verification_burden?.level === "heavy"
		? { open_reason: "high_verification_burden" }
		: undefined;
}

function evidenceGapReason(
	report: NormalizedSoftwareLearningReport,
): ReviewOpenReasonEvidence | undefined {
	const gaps = actionableEvidenceGaps(report);
	return gaps.length > 0 ? { open_reason: "evidence_gap", gaps } : undefined;
}

function ownerPathObservationReasons(
	report: NormalizedSoftwareLearningReport,
): ReviewOpenReasonEvidence[] {
	return ownerPathObservations(report).map((observation) => ({
		open_reason: "owner_path_observation",
		observation,
	}));
}

function repeatedFrictionReason(
	report: NormalizedSoftwareLearningReport,
	signalContext: ReviewSignalContext,
): ReviewOpenReasonEvidence | undefined {
	const category = report.friction?.category;
	return category && signalContext.repeatedFrictionCategories.has(category)
		? { open_reason: "repeated_friction", category }
		: undefined;
}

function unlinkedSpikeReason(
	report: NormalizedSoftwareLearningReport,
	signalContext: ReviewSignalContext,
): ReviewOpenReasonEvidence | undefined {
	return signalContext.unlinkedSpike && report.correlation_status === "unlinked"
		? { open_reason: "unlinked_correlation_spike" }
		: undefined;
}

function actionableEvidenceGaps(
	report: NormalizedSoftwareLearningReport,
): EvidenceGap[] {
	return report.evidence_gaps.filter(isActionableEvidenceGap);
}

function ownerPathObservations(
	report: NormalizedSoftwareLearningReport,
): OwnerPathObservation[] {
	return report.observations.filter(
		(observation): observation is OwnerPathObservation =>
			observation.target?.type === "path",
	);
}

function isActionableEvidenceGap(gap: EvidenceGap): boolean {
	return !NON_ACTIONABLE_EVIDENCE_GAP_CODES.has(gap.code);
}

function repeatedFriction(
	reports: readonly NormalizedSoftwareLearningReport[],
): Array<[FrictionCategory, number]> {
	const counts = new Map<FrictionCategory, number>();
	for (const category of reports.map(frictionCategory).filter(isDefined)) {
		counts.set(category, (counts.get(category) ?? 0) + 1);
	}
	return [...counts.entries()].filter(([, count]) => count >= 2);
}

function frictionCategory(
	report: NormalizedSoftwareLearningReport,
): FrictionCategory | undefined {
	const category = report.friction?.category;
	return category && category !== "none" ? category : undefined;
}

function retentionSummary(
	reports: readonly NormalizedSoftwareLearningReport[],
	nowIso: string,
): ReviewResultData["retention"] {
	const oldest = oldestReportAgeDays(reports, nowIso);
	const warning = retentionWarning(reports.length, oldest);
	return {
		report_count: reports.length,
		...(oldest !== undefined ? { oldest_report_age_days: oldest } : {}),
		...(warning
			? {
					warning,
					future_purge_action: "Run a future explicit purge workflow; review does not delete.",
				}
			: {}),
	};
}

function oldestReportAgeDays(
	reports: readonly NormalizedSoftwareLearningReport[],
	nowIso: string,
): number | undefined {
	const nowMs = Date.parse(nowIso);
	if (!Number.isFinite(nowMs)) return undefined;
	return reports
		.map((report) => reportAgeDays(report, nowMs))
		.reduce(maxAge, undefined);
}

function reportAgeDays(
	report: NormalizedSoftwareLearningReport,
	nowMs: number,
): number | undefined {
	const generatedMs = Date.parse(report.generated_ts);
	return Number.isFinite(generatedMs)
		? Math.max(0, Math.floor((nowMs - generatedMs) / 86_400_000))
		: undefined;
}

function maxAge(
	oldest: number | undefined,
	age: number | undefined,
): number | undefined {
	if (age === undefined) return oldest;
	return oldest === undefined ? age : Math.max(oldest, age);
}

function retentionWarning(
	reportCount: number,
	oldestReportAgeDays?: number,
): string | undefined {
	return retentionAgeNeedsWarning(oldestReportAgeDays) ||
		reportCount >= RETENTION_COUNT_WARNING_THRESHOLD
		? "Inbox is ready for a future gated purge workflow."
		: undefined;
}

function retentionAgeNeedsWarning(oldestReportAgeDays?: number): boolean {
	return (
		oldestReportAgeDays !== undefined &&
		oldestReportAgeDays >= RETENTION_AGE_WARNING_DAYS
	);
}

function pilotCheckpointSummary(input: {
	startedAt?: string;
	nowIso: string;
	closeoutCount: number;
	actionableCloseoutCount: number;
	noAction: boolean;
}): ReviewResultData["pilot_checkpoint"] {
	const window = pilotCheckpointWindow(input.startedAt, input.nowIso);
	if (!window) return undefined;
	const denominator = input.closeoutCount;
	const numerator = pilotCheckpointNumerator(input);
	return {
		started_at: window.startedAt,
		age_days: window.ageDays,
		actionable_feedback_numerator: numerator,
		material_closeout_denominator: denominator,
		density: pilotCheckpointDensity(numerator, denominator),
		next_action:
			"Review pilot density; keep the marker as manual source evidence.",
	};
}

function pilotCheckpointWindow(
	startedAt: string | undefined,
	nowIso: string,
): { startedAt: string; ageDays: number } | undefined {
	if (!startedAt) return undefined;
	const ageDays = daysBetween(startedAt, nowIso);
	return ageDays !== undefined && ageDays >= 7 ? { startedAt, ageDays } : undefined;
}

function pilotCheckpointNumerator(input: {
	closeoutCount: number;
	actionableCloseoutCount: number;
	noAction: boolean;
}): number {
	if (input.closeoutCount === 0) return 0;
	return input.noAction ? input.closeoutCount : input.actionableCloseoutCount;
}

function pilotCheckpointDensity(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : roundRatio(numerator / denominator);
}

function daysBetween(startIso: string, endIso: string): number | undefined {
	const start = Date.parse(startIso);
	const end = Date.parse(endIso);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
	return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function roundRatio(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}
