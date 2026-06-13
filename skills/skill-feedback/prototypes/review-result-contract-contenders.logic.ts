/**
 * PROTOTYPE - throwaway logic.
 *
 * Question: Which proposed v2 ReviewResultData contract shape earns the reducer
 * Seam: the minimal two-key reducer, the reducer plus anchor Adapter, or the
 * full claim-safe contract?
 *
 * This module is intentionally pure. The terminal shell imports it, renders
 * state, and lets a staff engineer judge the contenders by scenario.
 */

export type EvidenceSource = "driver_closeout" | "hook_capture";
export type CaptureRuntime = "claude_stop" | "codex_stop" | "codex_notify";
export type EvidenceTier =
	| "driver_declared"
	| "runtime_observed"
	| "corroborated"
	| "trusted_engine_identity";
export type AnchorStrength = "strong_path" | "weak" | "missing";
export type WeakAnchorReason =
	| "label_only"
	| "missing_anchor"
	| "out_of_repo"
	| "unverifiable";

export type PrototypeReport = {
	report_id: string;
	evidence_source: EvidenceSource;
	capture_runtime?: CaptureRuntime;
	skill_run_id?: string;
	skill_run_id_trusted?: boolean;
	trusted_skill_identity?: boolean;
	skill: string;
	verification_burden: "none" | "light" | "moderate" | "heavy";
	friction_category: string;
	open_reason?: string;
	touched_surfaces: Array<{ type: "path" | "label"; value: string }>;
	observation_targets: Array<{ type: "path" | "label"; value: string }>;
};

export type Scenario = {
	id: string;
	name: string;
	question: string;
	reports: PrototypeReport[];
	runtimeEvidence: {
		codexStopObserved: boolean;
		codexTrustedIdentity: boolean;
		claudeStopDetectedSkill: boolean;
		activeHookSourceSet: boolean;
		manualApprovalAttested: boolean;
		machineApprovalObservable: boolean;
	};
	expectedGuards: string[];
};

export type ContenderId =
	| "minimal_two_key"
	| "anchor_adapter"
	| "claim_safe_full";

export type Contender = {
	id: ContenderId;
	name: string;
	pitch: string;
	interfaceWidth: number;
};

export type LedgerEntry = {
	key: string;
	reviewUnitKeys: string[];
	ledgerAnchorKey?: string;
	anchorStrength: AnchorStrength;
	weakAnchorReason?: WeakAnchorReason;
	bestEvidenceTier: EvidenceTier;
	allowedClaims: string[];
	ownerPaths: string[];
	sourceMix: EvidenceSource[];
	runtimeMix: CaptureRuntime[];
	trustedRunEvidence: Array<{
		reviewUnitKey: string;
		sourceMix: EvidenceSource[];
	}>;
};

export type Readiness = {
	runtime_capture: "ready" | "blocked" | "evidence_only";
	trusted_identity: "ready" | "blocked";
	daily_pilot: "ready" | "blocked";
	reasons: string[];
};

export type ContenderResult = {
	contender: Contender;
	reviewUnits: Array<{ key: string; reportIds: string[]; trustedRun: boolean }>;
	ledgerEntries: LedgerEntry[];
	anchorMissTelemetry: Record<string, number>;
	readiness: Readiness;
	prevented: string[];
	leaks: string[];
	score: {
		falseMerge: number;
		falseCorroboration: number;
		weakAnchorMerge: number;
		falseReadiness: number;
		locality: number;
		leverage: number;
		interfaceSmallness: number;
		total: number;
	};
};

export const contenders: Contender[] = [
	{
		id: "minimal_two_key",
		name: "Minimal two-key reducer",
		pitch:
			"One reducer emits review_unit_key, ledger_anchor_key, and evidence tiers. Smallest Interface, weakest Adapter story.",
		interfaceWidth: 5,
	},
	{
		id: "anchor_adapter",
		name: "Reducer plus anchor Adapter",
		pitch:
			"Anchor Adapter canonicalizes path facts before the reducer. Strong merge safety, readiness stays mostly v1-shaped.",
		interfaceWidth: 8,
	},
	{
		id: "claim_safe_full",
		name: "Full claim-safe ReviewResultData",
		pitch:
			"Reducer consumes anchor Adapter facts and emits allowed claims plus split readiness. Wider Interface, strongest safety.",
		interfaceWidth: 11,
	},
];

export const scenarios: Scenario[] = [
	{
		id: "same-anchor-no-trusted-run",
		name: "Same anchor, no trusted run id",
		question:
			"Two reports hit the same owner path but do not share a trusted skill_run_id. They may merge by anchor, but must not claim corroborated.",
		expectedGuards: ["false_corroboration"],
		runtimeEvidence: {
			codexStopObserved: true,
			codexTrustedIdentity: false,
			claudeStopDetectedSkill: false,
			activeHookSourceSet: true,
			manualApprovalAttested: true,
			machineApprovalObservable: false,
		},
		reports: [
			{
				report_id: "driver-1",
				evidence_source: "driver_closeout",
				skill: "ce-ideate",
				verification_burden: "heavy",
				friction_category: "verification_tax",
				open_reason: "high_verification_burden",
				touched_surfaces: [
					{ type: "path", value: "skills/skill-feedback/src/skill-feedback-runner.ts" },
				],
				observation_targets: [],
			},
			{
				report_id: "codex-1",
				evidence_source: "hook_capture",
				capture_runtime: "codex_stop",
				skill_run_id: "run-opaque",
				skill_run_id_trusted: false,
				trusted_skill_identity: false,
				skill: "unknown-skill",
				verification_burden: "light",
				friction_category: "runtime_signal",
				touched_surfaces: [
					{ type: "path", value: "skills/skill-feedback/src/skill-feedback-runner.ts" },
				],
				observation_targets: [],
			},
		],
	},
	{
		id: "weak-label-repeat",
		name: "Repeated label-only weak anchors",
		question:
			"Three reports mention the same label. They should stay standalone while anchor-miss telemetry accumulates.",
		expectedGuards: ["weak_anchor_merge"],
		runtimeEvidence: {
			codexStopObserved: false,
			codexTrustedIdentity: false,
			claudeStopDetectedSkill: false,
			activeHookSourceSet: false,
			manualApprovalAttested: false,
			machineApprovalObservable: false,
		},
		reports: ["a", "b", "c"].map((suffix) => ({
			report_id: `label-${suffix}`,
			evidence_source: "driver_closeout" as const,
			skill: "skill-feedback",
			verification_burden: "moderate" as const,
			friction_category: "unclear_ownership",
			open_reason: "owner_path_observation",
			touched_surfaces: [{ type: "label" as const, value: "review contract" }],
			observation_targets: [],
		})),
	},
	{
		id: "codex-stop-no-identity",
		name: "Codex Stop without skill identity",
		question:
			"Codex Stop-detected turn proves runtime evidence, but it must not prove Trusted skill identity or Daily pilot readiness.",
		expectedGuards: ["false_readiness"],
		runtimeEvidence: {
			codexStopObserved: true,
			codexTrustedIdentity: false,
			claudeStopDetectedSkill: false,
			activeHookSourceSet: true,
			manualApprovalAttested: true,
			machineApprovalObservable: false,
		},
		reports: [
			{
				report_id: "codex-stop-1",
				evidence_source: "hook_capture",
				capture_runtime: "codex_stop",
				skill_run_id: "turn-1",
				skill_run_id_trusted: false,
				trusted_skill_identity: false,
				skill: "unknown-skill",
				verification_burden: "light",
				friction_category: "runtime_signal",
				touched_surfaces: [],
				observation_targets: [{ type: "path", value: "skills/skill-feedback/CONTEXT.md" }],
			},
		],
	},
	{
		id: "claude-linked-skill",
		name: "Claude Stop-detected skill linked to closeout",
		question:
			"Claude Stop plus supported skill evidence shares a trusted run id with a closeout. This may become corroborated without proving Codex identity.",
		expectedGuards: ["codex_identity_leak"],
		runtimeEvidence: {
			codexStopObserved: false,
			codexTrustedIdentity: false,
			claudeStopDetectedSkill: true,
			activeHookSourceSet: false,
			manualApprovalAttested: false,
			machineApprovalObservable: false,
		},
		reports: [
			{
				report_id: "claude-hook-1",
				evidence_source: "hook_capture",
				capture_runtime: "claude_stop",
				skill_run_id: "trusted-run-1",
				skill_run_id_trusted: true,
				trusted_skill_identity: false,
				skill: "ce-ideate",
				verification_burden: "light",
				friction_category: "runtime_signal",
				touched_surfaces: [
					{ type: "path", value: "docs/ideation/2026-06-13-skill-feedback-review-pivot-ideation.html" },
				],
				observation_targets: [],
			},
			{
				report_id: "driver-closeout-1",
				evidence_source: "driver_closeout",
				skill_run_id: "trusted-run-1",
				skill_run_id_trusted: true,
				skill: "ce-ideate",
				verification_burden: "moderate",
				friction_category: "missing_context",
				touched_surfaces: [
					{ type: "path", value: "docs/ideation/2026-06-13-skill-feedback-review-pivot-ideation.html" },
				],
				observation_targets: [],
			},
		],
	},
];

export function evaluateScenario(scenario: Scenario): ContenderResult[] {
	return contenders.map((contender) => evaluateContender(contender, scenario));
}

export function evaluateAllScenarios(): Record<string, number> {
	const totals: Record<string, number> = {};
	for (const contender of contenders) totals[contender.id] = 0;
	for (const scenario of scenarios) {
		for (const result of evaluateScenario(scenario)) {
			totals[result.contender.id] += result.score.total;
		}
	}
	return totals;
}

function evaluateContender(
	contender: Contender,
	scenario: Scenario,
): ContenderResult {
	const reviewUnits = buildReviewUnits(contender, scenario.reports);
	const anchorFacts = scenario.reports.map((report) => ({
		report,
		anchor: anchorForReport(contender, report),
	}));
	const ledgerEntries = buildLedgerEntries(contender, reviewUnits, anchorFacts);
	const readiness = buildReadiness(contender, scenario);
	const prevented = preventedGuards(contender, ledgerEntries, readiness);
	const leaks = leakedGuards(scenario, prevented);
	const score = scoreResult(contender, scenario, ledgerEntries, readiness, prevented, leaks);
	return {
		contender,
		reviewUnits,
		ledgerEntries,
		anchorMissTelemetry: anchorMissTelemetry(ledgerEntries),
		readiness,
		prevented,
		leaks,
		score,
	};
}

function buildReviewUnits(
	contender: Contender,
	reports: PrototypeReport[],
): Array<{ key: string; reportIds: string[]; trustedRun: boolean }> {
	const units: Array<{ key: string; reportIds: string[]; trustedRun: boolean }> = [];
	const byRun = new Map<string, { key: string; reportIds: string[]; trustedRun: boolean }>();
	for (const report of reports) {
		const canUseRunKey =
			contender.id === "minimal_two_key"
				? Boolean(report.skill_run_id)
				: Boolean(report.skill_run_id && report.skill_run_id_trusted);
		const trustedRun = Boolean(report.skill_run_id && report.skill_run_id_trusted);
		if (!canUseRunKey || !report.skill_run_id) {
			units.push({
				key: `report:${report.report_id}`,
				reportIds: [report.report_id],
				trustedRun: false,
			});
			continue;
		}
		const key = `run:${report.skill_run_id}`;
		let unit = byRun.get(key);
		if (!unit) {
			unit = { key, reportIds: [], trustedRun };
			byRun.set(key, unit);
			units.push(unit);
		} else {
			unit.trustedRun = unit.trustedRun && trustedRun;
		}
		unit.reportIds.push(report.report_id);
	}
	return units;
}

function anchorForReport(
	contender: Contender,
	report: PrototypeReport,
): {
	ledgerAnchorKey?: string;
	ownerPaths: string[];
	anchorStrength: AnchorStrength;
	weakAnchorReason?: WeakAnchorReason;
} {
	const pathTargets = [...report.touched_surfaces, ...report.observation_targets].filter(
		(target) => target.type === "path",
	);
	if (pathTargets.length === 0) {
		return weakAnchor(contender, "label_only");
	}
	const rawPaths = pathTargets.map((target) => target.value);
	if (contender.id === "minimal_two_key") {
		return {
			ledgerAnchorKey: `anchor:${rawPaths.join("|")}`,
			ownerPaths: rawPaths,
			anchorStrength: "strong_path",
		};
	}
	const canonical = [...new Set(rawPaths.map(canonicalPath))].sort();
	const invalid = canonical.some((path) => !path || path.startsWith("../"));
	if (invalid) return weakAnchor(contender, "out_of_repo");
	return {
		ledgerAnchorKey: `anchor:${canonical.join("|")}`,
		ownerPaths: canonical,
		anchorStrength: "strong_path",
	};
}

function weakAnchor(
	contender: Contender,
	reason: WeakAnchorReason,
): {
	ledgerAnchorKey?: string;
	ownerPaths: string[];
	anchorStrength: AnchorStrength;
	weakAnchorReason?: WeakAnchorReason;
} {
	if (contender.id === "minimal_two_key") {
		return {
			ledgerAnchorKey: `weak:${reason}`,
			ownerPaths: [],
			anchorStrength: "weak",
			weakAnchorReason: reason,
		};
	}
	return {
		ownerPaths: [],
		anchorStrength: "weak",
		weakAnchorReason: reason,
	};
}

function buildLedgerEntries(
	contender: Contender,
	reviewUnits: Array<{ key: string; reportIds: string[]; trustedRun: boolean }>,
	anchorFacts: Array<{
		report: PrototypeReport;
		anchor: ReturnType<typeof anchorForReport>;
	}>,
): LedgerEntry[] {
	const reportToUnit = new Map<string, { key: string; trustedRun: boolean }>();
	for (const unit of reviewUnits) {
		for (const reportId of unit.reportIds) {
			reportToUnit.set(reportId, { key: unit.key, trustedRun: unit.trustedRun });
		}
	}
	const entries = new Map<string, LedgerEntry>();
	for (const { report, anchor } of anchorFacts) {
		const unit = reportToUnit.get(report.report_id);
		if (!unit) continue;
		const key =
			anchor.anchorStrength === "weak" && contender.id !== "minimal_two_key"
				? `standalone:${report.report_id}`
				: anchor.ledgerAnchorKey ?? `standalone:${report.report_id}`;
		let entry = entries.get(key);
		if (!entry) {
			entry = {
				key,
				reviewUnitKeys: [],
				ledgerAnchorKey: anchor.ledgerAnchorKey,
				anchorStrength: anchor.anchorStrength,
				weakAnchorReason: anchor.weakAnchorReason,
				bestEvidenceTier: "driver_declared",
				allowedClaims: [],
				ownerPaths: anchor.ownerPaths,
				sourceMix: [],
				runtimeMix: [],
				trustedRunEvidence: [],
			};
			entries.set(key, entry);
		}
		if (!entry.reviewUnitKeys.includes(unit.key)) entry.reviewUnitKeys.push(unit.key);
		if (!entry.sourceMix.includes(report.evidence_source)) {
			entry.sourceMix.push(report.evidence_source);
		}
		if (report.capture_runtime && !entry.runtimeMix.includes(report.capture_runtime)) {
			entry.runtimeMix.push(report.capture_runtime);
		}
		if (unit.trustedRun) {
			let trustedRunEvidence = entry.trustedRunEvidence.find(
				(evidence) => evidence.reviewUnitKey === unit.key,
			);
			if (!trustedRunEvidence) {
				trustedRunEvidence = { reviewUnitKey: unit.key, sourceMix: [] };
				entry.trustedRunEvidence.push(trustedRunEvidence);
			}
			if (!trustedRunEvidence.sourceMix.includes(report.evidence_source)) {
				trustedRunEvidence.sourceMix.push(report.evidence_source);
			}
		}
		entry.bestEvidenceTier = bestEvidenceTier(
			contender,
			entry.bestEvidenceTier,
			report,
			entry,
		);
		entry.allowedClaims = allowedClaims(contender, entry);
	}
	return [...entries.values()];
}

function bestEvidenceTier(
	contender: Contender,
	current: EvidenceTier,
	report: PrototypeReport,
	entry: LedgerEntry,
): EvidenceTier {
	if (current === "trusted_engine_identity") return current;
	if (report.trusted_skill_identity && contender.id === "claim_safe_full") {
		return "trusted_engine_identity";
	}
	if (sameTrustedRunEvidence(entry)) {
		return "corroborated";
	}
	if (current === "corroborated") return current;
	if (report.evidence_source === "hook_capture" && current === "driver_declared") {
		return "runtime_observed";
	}
	return current;
}

function allowedClaims(
	contender: Contender,
	entry: LedgerEntry,
): string[] {
	const claims = new Set<string>();
	if (entry.anchorStrength === "strong_path") claims.add("repeated_anchor");
	if (entry.sourceMix.length > 1) claims.add("mixed_evidence_sources");
	if (sameTrustedRunEvidence(entry)) claims.add("same_trusted_run");
	if (entry.bestEvidenceTier === "corroborated") claims.add("corroborated");
	if (entry.bestEvidenceTier === "trusted_engine_identity") {
		claims.add("trusted_engine_identity");
	}
	if (contender.id === "minimal_two_key" && entry.sourceMix.length > 1) {
		claims.add("corroborated");
	}
	return [...claims];
}

function sameTrustedRunEvidence(entry: LedgerEntry): boolean {
	return entry.trustedRunEvidence.some(
		(evidence) =>
			evidence.sourceMix.includes("driver_closeout") &&
			evidence.sourceMix.includes("hook_capture"),
	);
}

function buildReadiness(contender: Contender, scenario: Scenario): Readiness {
	if (contender.id !== "claim_safe_full") {
		const ready =
			scenario.runtimeEvidence.codexStopObserved &&
			(contender.id === "minimal_two_key" ||
				scenario.runtimeEvidence.codexTrustedIdentity);
		return {
			runtime_capture: ready ? "ready" : "blocked",
			trusted_identity: ready ? "ready" : "blocked",
			daily_pilot: "blocked",
			reasons: ready ? ["count_or_identity_collapsed"] : ["not_enough_runtime_evidence"],
		};
	}
	const reasons: string[] = [];
	const runtimeReady =
		scenario.runtimeEvidence.codexStopObserved &&
		scenario.runtimeEvidence.activeHookSourceSet &&
		(scenario.runtimeEvidence.manualApprovalAttested ||
			scenario.runtimeEvidence.machineApprovalObservable);
	if (!runtimeReady) reasons.push("runtime_capture_missing_trusted_hook_evidence");
	if (!scenario.runtimeEvidence.codexTrustedIdentity) {
		reasons.push("trusted_codex_identity_missing");
	}
	if (!scenario.runtimeEvidence.machineApprovalObservable) {
		reasons.push("daily_pilot_needs_machine_observable_approval");
	}
	return {
		runtime_capture: runtimeReady ? "ready" : "blocked",
		trusted_identity: scenario.runtimeEvidence.codexTrustedIdentity
			? "ready"
			: "blocked",
		daily_pilot:
			runtimeReady &&
			scenario.runtimeEvidence.codexTrustedIdentity &&
			scenario.runtimeEvidence.machineApprovalObservable
				? "ready"
				: "blocked",
		reasons,
	};
}

function preventedGuards(
	contender: Contender,
	entries: LedgerEntry[],
	readiness: Readiness,
): string[] {
	const guards = new Set<string>();
	if (entries.every((entry) => !mergedWeakAnchor(entry))) {
		guards.add("weak_anchor_merge");
	}
	if (entries.every((entry) => !falseCorroborated(entry))) {
		guards.add("false_corroboration");
	}
	if (readiness.trusted_identity === "blocked" && readiness.daily_pilot === "blocked") {
		guards.add("false_readiness");
	}
	if (contender.id === "claim_safe_full") {
		guards.add("codex_identity_leak");
	}
	if (entries.every((entry) => entry.anchorStrength !== "strong_path" || entry.ledgerAnchorKey)) {
		guards.add("false_merge");
	}
	return [...guards];
}

function leakedGuards(scenario: Scenario, prevented: string[]): string[] {
	return scenario.expectedGuards.filter((guard) => !prevented.includes(guard));
}

function scoreResult(
	contender: Contender,
	scenario: Scenario,
	entries: LedgerEntry[],
	readiness: Readiness,
	prevented: string[],
	leaks: string[],
): ContenderResult["score"] {
	const falseMerge = prevented.includes("false_merge") ? 2 : 0;
	const falseCorroboration = prevented.includes("false_corroboration") ? 2 : 0;
	const weakAnchorMerge = prevented.includes("weak_anchor_merge") ? 2 : 0;
	const falseReadiness = prevented.includes("false_readiness") ? 2 : 0;
	const locality = contender.id === "claim_safe_full" ? 2 : contender.id === "anchor_adapter" ? 2 : 1;
	const leverage = contender.id === "minimal_two_key" ? 1 : 2;
	const interfaceSmallness = Math.max(0, 3 - Math.floor(contender.interfaceWidth / 4));
	const leakPenalty = leaks.length * 3;
	const readinessPenalty =
		scenario.runtimeEvidence.codexStopObserved &&
		!scenario.runtimeEvidence.codexTrustedIdentity &&
		readiness.trusted_identity === "ready"
			? 3
			: 0;
	const mergePenalty = entries.some(mergedWeakAnchor) ? 3 : 0;
	const total =
		falseMerge +
		falseCorroboration +
		weakAnchorMerge +
		falseReadiness +
		locality +
		leverage +
		interfaceSmallness -
		leakPenalty -
		readinessPenalty -
		mergePenalty;
	return {
		falseMerge,
		falseCorroboration,
		weakAnchorMerge,
		falseReadiness,
		locality,
		leverage,
		interfaceSmallness,
		total,
	};
}

function anchorMissTelemetry(entries: LedgerEntry[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const entry of entries) {
		if (!entry.weakAnchorReason) continue;
		counts[entry.weakAnchorReason] = (counts[entry.weakAnchorReason] ?? 0) + 1;
	}
	return counts;
}

function mergedWeakAnchor(entry: LedgerEntry): boolean {
	return entry.anchorStrength === "weak" && entry.reviewUnitKeys.length > 1;
}

function falseCorroborated(entry: LedgerEntry): boolean {
	return (
		entry.allowedClaims.includes("corroborated") &&
		!entry.allowedClaims.includes("same_trusted_run") &&
		entry.bestEvidenceTier !== "trusted_engine_identity"
	);
}

function canonicalPath(path: string): string {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return parts.join("/");
}
