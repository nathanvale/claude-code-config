import { deriveLedgerAnchorFacts } from "./ledger-anchor-adapter";
import type {
	CaptureRuntime,
	EvidenceSource,
	NormalizedSoftwareLearningReport,
	ReportCardTarget,
	ReviewAllowedClaim,
	ReviewAnchorMissTelemetry,
	ReviewEvidenceTier,
	ReviewLedgerEntry,
	ReviewLedgerVerificationBurden,
	ReviewResolutionState,
	ReviewUnitData,
	ReviewWeakAnchorReason,
} from "./command-contract";

/**
 * Reducer-owned slice of `ReviewResultData`: review units, ledger entries, and
 * anchor-miss telemetry derived from normalized reports and the anchor Adapter.
 *
 * @remarks Claim derivation lives here (KTD5, KTD6). Renderers consume these
 * facts and never re-derive evidence tier, corroboration, or allowed claims.
 */
export type ReviewLedgerResult = {
	review_units: readonly ReviewUnitData[];
	ledger_entries: readonly ReviewLedgerEntry[];
	anchor_miss_telemetry: readonly ReviewAnchorMissTelemetry[];
};

/**
 * Reduce normalized reports into claim-safe review units, ledger entries, and
 * anchor-miss telemetry.
 *
 * @param reports - Normalized reports for one review window.
 * @returns Reducer-owned review units, ledger entries, and anchor-miss telemetry.
 *
 * @remarks Two keys mean two claims (KTD3): `review_unit_key` proves same
 * trusted run; `ledger_anchor_key` proves same stable surface. Corroboration
 * needs a trusted review unit (KTD6); same anchor alone shows recurrence and
 * mixed sources, never corroboration.
 *
 * @example
 * ```typescript
 * const { review_units, ledger_entries } = reduceReviewLedger(reports)
 * ```
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export function reduceReviewLedger(
	reports: readonly NormalizedSoftwareLearningReport[],
): ReviewLedgerResult {
	const reviewUnits = buildReviewUnits(reports);
	// Index by occurrence, not report_id: a forged inbox could repeat a
	// report_id, and keying on it would merge unrelated reports into one entry
	// (false mixed-sources on a weak anchor, or false corroboration across two
	// runs). Each report occurrence carries its own anchor facts and unit.
	const anchorFacts = reports.map((report) => deriveLedgerAnchorFacts(report));
	const reportToUnit = indexReportOccurrencesToUnits(reviewUnits, reports);

	const entries = new Map<string, MutableLedgerEntry>();
	for (let index = 0; index < reports.length; index += 1) {
		const report = reports[index];
		const unit = reportToUnit[index];
		const anchor = anchorFacts[index];
		if (!report || !unit || !anchor) continue;

		// Strong anchors merge on their shared key; weak anchors stay standalone,
		// keyed by occurrence so duplicate report_ids cannot collapse together.
		const key =
			anchor.anchor_strength === "strong_path" && anchor.ledger_anchor_key
				? anchor.ledger_anchor_key
				: `standalone:${index}:${report.report_id}`;

		let entry = entries.get(key);
		if (!entry) {
			entry = {
				ledger_entry_key: key,
				review_unit_keys: [],
				ledger_anchor_key:
					anchor.anchor_strength === "strong_path"
						? anchor.ledger_anchor_key
						: undefined,
				anchor_strength: anchor.anchor_strength,
				weak_anchor_reason: anchor.weak_anchor_reason,
				attempted_targets: [...anchor.attempted_targets],
				owner_paths: [...anchor.owner_paths],
				evidence_tier: "driver_declared",
				source_mix: [],
				capture_runtime_mix: [],
				verification_burden: { level: "unknown" },
				trusted_run_evidence: [],
				proof_diagnostics: [],
			};
			entries.set(key, entry);
		}

		accumulateReport(entry, report, unit);
	}

	const ledgerEntries = [...entries.values()].map(finalizeEntry);
	return {
		review_units: reviewUnits.map(toReviewUnitData),
		ledger_entries: ledgerEntries,
		anchor_miss_telemetry: anchorMissTelemetry(anchorFacts),
	};
}

/**
 * Internal review unit before contract projection. `trusted_run` folds across
 * member reports: a unit stays trusted only while every report proves it.
 */
type ReviewUnit = {
	review_unit_key: string;
	report_ids: string[];
	trusted_run: boolean;
	trusted_skill_run_id?: string;
	has_runtime_owned_hook: boolean;
	has_correlation_owned_closeout: boolean;
};

type TrustedRunEvidence = {
	review_unit_key: string;
	source_mix: EvidenceSource[];
	has_runtime_owned_hook: boolean;
	has_correlation_owned_closeout: boolean;
};

type MutableLedgerEntry = {
	ledger_entry_key: string;
	review_unit_keys: string[];
	ledger_anchor_key?: string;
	anchor_strength: ReviewLedgerEntry["anchor_strength"];
	weak_anchor_reason?: ReviewWeakAnchorReason;
	attempted_targets: ReportCardTarget[];
	owner_paths: string[];
	evidence_tier: ReviewEvidenceTier;
	source_mix: EvidenceSource[];
	capture_runtime_mix: CaptureRuntime[];
	verification_burden: ReviewLedgerVerificationBurden;
	trusted_run_evidence: TrustedRunEvidence[];
	proof_diagnostics: string[];
};

/**
 * Coalesce reports into review units. Reports share a unit only when a trusted
 * `skill_run_id` proves same-run linkage; untrusted, report-authored, or
 * missing run ids stay report-local (R7, R7b, R8).
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function buildReviewUnits(
	reports: readonly NormalizedSoftwareLearningReport[],
): ReviewUnit[] {
	const units: ReviewUnit[] = [];
	const byRun = new Map<string, ReviewUnit>();
	const reportIdTotals = countReportIds(reports);
	const reportIdOccurrences = new Map<string, number>();
	for (const report of reports) {
		const trustedRunId = trustedSkillRunId(report);
		if (!trustedRunId) {
			const occurrence = reportIdOccurrences.get(report.report_id) ?? 0;
			reportIdOccurrences.set(report.report_id, occurrence + 1);
			units.push({
				review_unit_key:
					(reportIdTotals.get(report.report_id) ?? 0) > 1
						? `report:${report.report_id}#${occurrence + 1}`
						: `report:${report.report_id}`,
				report_ids: [report.report_id],
				trusted_run: false,
				has_runtime_owned_hook: false,
				has_correlation_owned_closeout: false,
			});
			continue;
		}
		let unit = byRun.get(trustedRunId);
		if (!unit) {
			unit = {
				review_unit_key: `run:${trustedRunId}`,
				report_ids: [],
				trusted_run: true,
				trusted_skill_run_id: trustedRunId,
				has_runtime_owned_hook: false,
				has_correlation_owned_closeout: false,
			};
			byRun.set(trustedRunId, unit);
			units.push(unit);
		}
		unit.report_ids.push(report.report_id);
		if (
			report.evidence_source === "hook_capture" &&
			report.skill_run_id_provenance === "runtime_owned"
		) {
			unit.has_runtime_owned_hook = true;
		}
		if (
			report.evidence_source === "driver_closeout" &&
			report.skill_run_id_provenance === "correlation_owned"
		) {
			unit.has_correlation_owned_closeout = true;
		}
	}
	return units;
}

function countReportIds(
	reports: readonly NormalizedSoftwareLearningReport[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const report of reports) {
		counts.set(report.report_id, (counts.get(report.report_id) ?? 0) + 1);
	}
	return counts;
}

/**
 * Return the trusted run id when writer-owned provenance proves the link.
 *
 * Raw or report-authored ids are evidence only (R7b); spoofed trust fields on
 * input reports never reach this normalized path.
 *
 * @param report - Normalized inbox report being considered for same-run linkage.
 * @returns Trusted `skill_run_id`, or undefined when provenance is untrusted.
 *
 * @example
 * ```typescript
 * const runId = trustedSkillRunId(report)
 * ```
 */
export function trustedSkillRunId(
	report: NormalizedSoftwareLearningReport,
): string | undefined {	
	if (!report.skill_run_id) return undefined;
	switch (report.skill_run_id_provenance) {
		case "runtime_owned":
		case "correlation_owned":
			return report.skill_run_id;
		default:
			return undefined;
	}
}

/**
 * Map each report occurrence (by index) to its review unit. Indexing by
 * occurrence rather than report_id means a repeated report_id in a forged
 * inbox cannot route two reports to the wrong unit.
 */
function indexReportOccurrencesToUnits(
	units: readonly ReviewUnit[],
	reports: readonly NormalizedSoftwareLearningReport[],
): Array<ReviewUnit | undefined> {
	const unitByReportId = new Map<string, ReviewUnit[]>();
	for (const unit of units) {
		for (const reportId of unit.report_ids) {
			const bucket = unitByReportId.get(reportId);
			if (bucket) bucket.push(unit);
			else unitByReportId.set(reportId, [unit]);
		}
	}
	// Consume each report_id's unit assignments in order so duplicate ids map to
	// their own occurrence's unit rather than collapsing to the last writer.
	const cursors = new Map<string, number>();
	return reports.map((report) => {
		const bucket = unitByReportId.get(report.report_id);
		if (!bucket) return undefined;
		const cursor = cursors.get(report.report_id) ?? 0;
		cursors.set(report.report_id, cursor + 1);
		return bucket[Math.min(cursor, bucket.length - 1)];
	});
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function accumulateReport(
	entry: MutableLedgerEntry,
	report: NormalizedSoftwareLearningReport,
	unit: ReviewUnit,
): void {
	if (!entry.review_unit_keys.includes(unit.review_unit_key)) {
		entry.review_unit_keys.push(unit.review_unit_key);
	}
	if (!entry.source_mix.includes(report.evidence_source)) {
		entry.source_mix.push(report.evidence_source);
	}
	if (
		report.capture_runtime &&
		!entry.capture_runtime_mix.includes(report.capture_runtime)
	) {
		entry.capture_runtime_mix.push(report.capture_runtime);
	}
	for (const diagnostic of report.proof_diagnostics ?? []) {
		if (!entry.proof_diagnostics.includes(diagnostic)) {
			entry.proof_diagnostics.push(diagnostic);
		}
	}
	if (unit.trusted_run) {
		let evidence = entry.trusted_run_evidence.find(
			(item) => item.review_unit_key === unit.review_unit_key,
		);
		if (!evidence) {
			evidence = {
				review_unit_key: unit.review_unit_key,
				source_mix: [],
				has_runtime_owned_hook: false,
				has_correlation_owned_closeout: false,
			};
			entry.trusted_run_evidence.push(evidence);
		}
		if (!evidence.source_mix.includes(report.evidence_source)) {
			evidence.source_mix.push(report.evidence_source);
		}
		if (unit.has_runtime_owned_hook) {
			evidence.has_runtime_owned_hook = true;
		}
		if (unit.has_correlation_owned_closeout) {
			evidence.has_correlation_owned_closeout = true;
		}
	}
	entry.evidence_tier = promoteEvidenceTier(entry.evidence_tier, report, entry);
	entry.verification_burden = mergeVerificationBurden(
		entry.verification_burden,
		report,
	);
}

/**
 * Promote evidence tier monotonically. Engine-owned identity reaches
 * `trusted_engine_identity`; a verified hook/closeout witness reaches
 * `corroborated`; hook capture alone reaches `runtime_observed`.
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function promoteEvidenceTier(
	current: ReviewEvidenceTier,
	report: NormalizedSoftwareLearningReport,
	entry: MutableLedgerEntry,
): ReviewEvidenceTier {
	if (current === "trusted_engine_identity") return current;
	if (hasTrustedEngineIdentity(report)) return "trusted_engine_identity";
	if (current === "corroborated") return current;
	if (sameTrustedRunMixedEvidence(entry)) return "corroborated";
	if (report.evidence_source === "hook_capture" && current === "driver_declared") {
		return "runtime_observed";
	}
	return current;
}

/**
 * Engine-owned skill identity is the only path to `trusted_engine_identity`
 * (R17). No current provenance source proves engine identity: Codex Stop
 * payload and Claude transcript detection are runtime evidence, not engine
 * identity (R18). The tier stays reserved until an engine-owned source exists,
 * so this returns `false` for every report the contract can normalize today.
 */
function hasTrustedEngineIdentity(
	_report: NormalizedSoftwareLearningReport,
): boolean {
	return false;
}

/**
 * Corroboration gate (KTD6): mixed evidence sources must share one trusted
 * review unit. Same `ledger_anchor_key` alone never corroborates.
 */
function sameTrustedRunMixedEvidence(entry: MutableLedgerEntry): boolean {
	return entry.trusted_run_evidence.some(
		(evidence) =>
			evidence.has_runtime_owned_hook &&
			evidence.has_correlation_owned_closeout,
	);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function mergeVerificationBurden(
	current: ReviewLedgerVerificationBurden,
	report: NormalizedSoftwareLearningReport,
): ReviewLedgerVerificationBurden {
	const reportBurden = report.verification_burden;
	if (!reportBurden) return current;
	if (current.level === "unknown") {
		return reportBurden.note
			? { level: reportBurden.level, note: reportBurden.note }
			: { level: reportBurden.level };
	}
	if (verificationWeight(reportBurden.level) > verificationWeight(current.level)) {
		return reportBurden.note
			? { level: reportBurden.level, note: reportBurden.note }
			: { level: reportBurden.level };
	}
	return current;
}

function verificationWeight(
	level: ReviewLedgerVerificationBurden["level"],
): number {
	switch (level) {
		case "heavy":
			return 3;
		case "moderate":
			return 2;
		case "light":
			return 1;
		default:
			return 0;
	}
}

function finalizeEntry(entry: MutableLedgerEntry): ReviewLedgerEntry {
	const allowedClaims = deriveAllowedClaims(entry);
	return {
		ledger_entry_key: entry.ledger_entry_key,
		review_unit_keys: entry.review_unit_keys,
		...(entry.ledger_anchor_key
			? { ledger_anchor_key: entry.ledger_anchor_key }
			: {}),
		anchor_strength: entry.anchor_strength,
		...(entry.weak_anchor_reason
			? { weak_anchor_reason: entry.weak_anchor_reason }
			: {}),
		attempted_targets: entry.attempted_targets,
		owner_paths: entry.owner_paths,
		evidence_tier: entry.evidence_tier,
		source_mix: entry.source_mix,
		capture_runtime_mix: entry.capture_runtime_mix,
		allowed_claims: allowedClaims,
		proof_diagnostics: entry.proof_diagnostics,
		resolution_state: deriveResolutionState(entry),
		verification_burden: entry.verification_burden,
		next_safe_action: nextSafeAction(entry),
	};
}

function deriveResolutionState(entry: MutableLedgerEntry): ReviewResolutionState {
	if (entry.anchor_strength === "weak") return "no_action";
	if (entry.owner_paths.length === 0) return "no_action";
	return "open";
}

/**
 * Derive entry-local allowed claims (R6). Each claim is gated by the evidence
 * that earns it; renderers repeat only these labels and never widen them.
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function deriveAllowedClaims(
	entry: MutableLedgerEntry,
): readonly ReviewAllowedClaim[] {
	const claims = new Set<ReviewAllowedClaim>();
	if (entry.anchor_strength === "strong_path") claims.add("repeated_anchor");
	if (entry.source_mix.length > 1) claims.add("mixed_evidence_sources");
	if (sameTrustedRunMixedEvidence(entry)) claims.add("same_trusted_run");
	if (entry.evidence_tier === "corroborated") claims.add("corroborated");
	if (entry.evidence_tier === "trusted_engine_identity") {
		claims.add("trusted_engine_identity");
	}
	return [...claims];
}

function nextSafeAction(entry: MutableLedgerEntry): string {
	if (entry.anchor_strength === "weak") {
		return "Inspect the attempted targets before treating this as a shared surface.";
	}
	if (entry.evidence_tier === "corroborated") {
		return "Corroborated by a shared trusted run; inspect the owner paths and act.";
	}
	return "Inspect the owner paths and confirm evidence before editing.";
}

function toReviewUnitData(unit: ReviewUnit): ReviewUnitData {
	return {
		review_unit_key: unit.review_unit_key,
		report_ids: unit.report_ids,
		trusted_run: unit.trusted_run,
		...(unit.trusted_skill_run_id
			? { trusted_skill_run_id: unit.trusted_skill_run_id }
			: {}),
	};
}

/**
 * Count weak-anchor reasons without letting telemetry influence grouping
 * (R14). Telemetry accumulates attempted targets per weak reason for later
 * anchor-source proposals.
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function anchorMissTelemetry(
	anchorFacts: readonly ReturnType<typeof deriveLedgerAnchorFacts>[],
): readonly ReviewAnchorMissTelemetry[] {
	const byReason = new Map<
		ReviewWeakAnchorReason,
		{ count: number; attempted_targets: ReportCardTarget[] }
	>();
	for (const anchor of anchorFacts) {
		if (anchor.anchor_strength !== "weak" || !anchor.weak_anchor_reason) {
			continue;
		}
		let bucket = byReason.get(anchor.weak_anchor_reason);
		if (!bucket) {
			bucket = { count: 0, attempted_targets: [] };
			byReason.set(anchor.weak_anchor_reason, bucket);
		}
		bucket.count += 1;
		bucket.attempted_targets.push(...anchor.attempted_targets);
	}
	return [...byReason.entries()].map(([weak_anchor_reason, bucket]) => ({
		weak_anchor_reason,
		count: bucket.count,
		attempted_targets: bucket.attempted_targets,
	}));
}
