// fallow-ignore-file unused-file
import { describe, expect, test } from "bun:test";
import type {
	NormalizedSoftwareLearningReport,
	ReportCardTarget,
} from "./command-contract";
import { SKILL_FEEDBACK_SCHEMA_VERSION } from "./command-contract";
import {
	buildHealthResultData,
	buildReviewResultData,
	type DecisionReadTarget,
} from "./decision-surface";
import type { ReviewInboxRead } from "./inbox-read-model";

const GENERATED_TS = "2026-06-30T00:00:00.000Z";

function readTarget(
	overrides: Partial<DecisionReadTarget> = {},
): DecisionReadTarget {
	return {
		ok: true,
		explicit: false,
		seedPath: "/repo",
		repoRoot: "/repo",
		inboxPath: "/repo/.skill-feedback",
		...overrides,
	};
}

function inbox(overrides: Partial<ReviewInboxRead> = {}): ReviewInboxRead {
	return {
		primaryReports: [],
		lowSignalReports: [],
		inboxRootStatus: "missing",
		skippedUnsafeCount: 0,
		invalidCount: 0,
		proofDiagnostics: [],
		correlationDiagnostics: [],
		verifiedCorrelationWitnessCount: 0,
		blockedCorrelationWitnessCount: 0,
		orphanCorrelationWitnessCount: 0,
		...overrides,
	};
}

function report(
	overrides: { report_id: string } & Partial<NormalizedSoftwareLearningReport>,
): NormalizedSoftwareLearningReport {
	const { report_id: reportId, ...rest } = overrides;
	return {
		schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
		source_schema_version: "v1",
		report_id: reportId,
		untrusted_evidence: true,
		generated_ts: GENERATED_TS,
		evidence_source: "driver_closeout",
		correlation_status: "linked",
		skill: "create-skill",
		outcome: "confirmed",
		friction: { category: "none", note: "Clean run." },
		verification_burden: { level: "light", note: "Focused check." },
		touched_surfaces: [{ type: "path", value: "skills/create-skill/SKILL.md" }],
		observations: [],
		evidence_gaps: [],
		cost: { status: "unavailable", gap_code: "cost_unavailable" },
		runtime: {},
		...rest,
	};
}

describe("decision surface", () => {
	test("assembles empty review and health decisions without invoking the runner", () => {
		const missingInbox = inbox();

		const review = buildReviewResultData({
			inbox: missingInbox,
			nowIso: GENERATED_TS,
			readTarget: readTarget(),
		});
		const health = buildHealthResultData({
			inbox: missingInbox,
			nowIso: GENERATED_TS,
			readTarget: readTarget(),
		});

		expect(review.inbox_status).toBe("missing");
		expect(review.coverage.total_reports).toBe(0);
		expect(review.no_action).toMatchObject({
			rationale: "No skill-feedback reports found.",
		});
		expect(review.ledger_entries).toEqual([]);
		expect(review.next_action.action_id).toBe("confirm-capture-path");
		expect(health.inbox_status).toBe("missing");
		expect(health.next_action.action_id).toBe("confirm-capture-path");
	});

	test("keeps low-signal reports in health facts while ledger covers primary reports", () => {
		const primary = report({ report_id: "primary-report" });
		const lowSignal = report({
			report_id: "low-signal-report",
			evidence_source: "hook_capture",
			capture_runtime: "codex_stop",
			skill: "unknown-skill",
			generated_ts: "2026-06-29T00:00:00.000Z",
		});
		const read = inbox({
			inboxRootStatus: "readable",
			primaryReports: [primary],
			lowSignalReports: [
				{ report: lowSignal, reasonId: "unknown_skill_codex_stop" },
			],
		});

		const review = buildReviewResultData({
			inbox: read,
			nowIso: GENERATED_TS,
			readTarget: readTarget(),
		});
		const health = buildHealthResultData({
			inbox: read,
			nowIso: GENERATED_TS,
			readTarget: readTarget(),
		});

		expect(review.coverage.total_reports).toBe(1);
		expect(review.inbox_health).toMatchObject({
			primary_count: 1,
			low_signal_count: 1,
			low_signal_reason_ids: ["unknown_skill_codex_stop"],
		});
		expect(review.review_units.flatMap((unit) => unit.report_ids)).toEqual([
			"primary-report",
		]);
		expect(health.counts).toMatchObject({ primary: 1, low_signal: 1 });
		expect(health.newest.low_signal_generated_ts).toBe(
			"2026-06-29T00:00:00.000Z",
		);
	});

	test("derives shared retention and correlation repair next actions", () => {
		const oldReport = report({
			report_id: "old-linked-report",
			generated_ts: "2026-06-01T00:00:00.000Z",
		});
		const retentionRead = inbox({
			inboxRootStatus: "readable",
			primaryReports: [oldReport],
		});

		const retentionReview = buildReviewResultData({
			inbox: retentionRead,
			nowIso: GENERATED_TS,
			readTarget: readTarget(),
		});
		const retentionHealth = buildHealthResultData({
			inbox: retentionRead,
			nowIso: GENERATED_TS,
			readTarget: readTarget(),
		});

		expect(retentionReview.retention.warning).toContain("purge");
		expect(retentionReview.next_action.action_id).toBe("preview-purge");
		expect(retentionHealth.next_action.action_id).toBe("preview-purge");
		expect(retentionHealth.warnings.map((warning) => warning.reason_id)).toContain(
			"retention_preview_recommended",
		);

		const blockedRead = inbox({
			inboxRootStatus: "readable",
			primaryReports: [report({ report_id: "blocked-correlation-report" })],
			blockedCorrelationWitnessCount: 1,
			correlationDiagnostics: ["blocked_witness"],
		});
		expect(
			buildReviewResultData({
				inbox: blockedRead,
				nowIso: GENERATED_TS,
				readTarget: readTarget(),
			}).next_action.action_id,
		).toBe("preview-correlation-repair");
		expect(
			buildHealthResultData({
				inbox: blockedRead,
				nowIso: GENERATED_TS,
				readTarget: readTarget(),
			}).next_action.action_id,
		).toBe("preview-correlation-repair");
	});

	test("projects pilot checkpoint and read-target diagnostics under visibility rules", () => {
		const primary = report({
			report_id: "pilot-heavy",
			verification_burden: { level: "heavy", note: "Broad check." },
		});
		const read = inbox({
			inboxRootStatus: "readable",
			primaryReports: [primary],
		});

		const defaultReview = buildReviewResultData({
			inbox: read,
			nowIso: GENERATED_TS,
			pilotStartedAt: "2026-06-23T00:00:00.000Z",
			readTarget: readTarget(),
		});
		const explicitHealth = buildHealthResultData({
			inbox: read,
			nowIso: GENERATED_TS,
			readTarget: readTarget({ explicit: true, seedPath: "/repo/subdir" }),
		});

		expect(defaultReview.read_target).toBeUndefined();
		expect(defaultReview.pilot_checkpoint).toMatchObject({
			age_days: 7,
			actionable_feedback_numerator: 1,
			material_closeout_denominator: 1,
			density: 1,
		});
		expect(explicitHealth.read_target).toMatchObject({
			explicit: true,
			target_path: "/repo/subdir",
		});

		const malformed = buildReviewResultData({
			inbox: inbox({
				inboxRootStatus: "readable",
				primaryReports: [
					report({ report_id: "bad-date", generated_ts: "not-a-date" }),
				],
			}),
			nowIso: "also-not-a-date",
			pilotStartedAt: "not-a-date",
			readTarget: readTarget(),
		});
		expect(malformed.retention.oldest_report_age_days).toBeUndefined();
		expect(malformed.retention.warning).toBeUndefined();
		expect(malformed.pilot_checkpoint).toBeUndefined();
	});

	test("returns open actions in shared decision order before plain caps", () => {
		const ownerPath: ReportCardTarget = {
			type: "path",
			value: "skills/skill-feedback/SKILL.md",
		};
		const read = inbox({
			inboxRootStatus: "readable",
			primaryReports: [
				report({
					report_id: "heavy-owner",
					correlation_status: "unlinked",
					friction: { category: "tool_failure", note: "Tool failed." },
					verification_burden: { level: "heavy", note: "Heavy check." },
					observations: [
						{
							kind: "tool_failure",
							target: ownerPath,
							summary: "Owner path needs inspection.",
							evidence_basis: "driver_observed",
						},
					],
					evidence_gaps: [
						{
							code: "missing_runtime_git_sha",
							path: "runtime.git_sha",
							message: "No git SHA.",
						},
					],
				}),
				report({
					report_id: "repeat-unlinked",
					correlation_status: "unlinked",
					friction: { category: "tool_failure", note: "Tool failed again." },
				}),
			],
		});

		const review = buildReviewResultData({
			inbox: read,
			nowIso: GENERATED_TS,
			readTarget: readTarget(),
		});

		expect(review.open_actions.map((action) => action.open_reason)).toEqual([
			"owner_path_observation",
			"high_verification_burden",
			"repeated_friction",
			"evidence_gap",
			"unlinked_correlation_spike",
		]);
	});
});
