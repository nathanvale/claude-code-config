import { describe, expect, test } from "bun:test";
import type {
	CaptureRuntime,
	EvidenceSource,
	NormalizedSoftwareLearningReport,
	ReportCardTarget,
	SkillRunIdProvenance,
} from "./command-contract";
import { SKILL_FEEDBACK_SCHEMA_VERSION } from "./command-contract";
import { reduceReviewLedger } from "./review-ledger-reducer";

const GENERATED_TS = "2026-06-13T00:00:00.000Z";

type ReportOverrides = {
	report_id: string;
	evidence_source?: EvidenceSource;
	capture_runtime?: CaptureRuntime;
	skill_run_id?: string;
	skill_run_id_provenance?: SkillRunIdProvenance;
	touched_surfaces?: readonly ReportCardTarget[];
	skill?: string;
};

function report(overrides: ReportOverrides): NormalizedSoftwareLearningReport {
	return {
		schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
		source_schema_version: "v1",
		report_id: overrides.report_id,
		untrusted_evidence: true,
		generated_ts: GENERATED_TS,
		evidence_source: overrides.evidence_source ?? "driver_closeout",
		...(overrides.capture_runtime
			? { capture_runtime: overrides.capture_runtime }
			: {}),
		correlation_status: "linked",
		...(overrides.skill_run_id ? { skill_run_id: overrides.skill_run_id } : {}),
		...(overrides.skill_run_id_provenance
			? { skill_run_id_provenance: overrides.skill_run_id_provenance }
			: {}),
		skill: overrides.skill ?? "create-skill",
		outcome: "confirmed",
		touched_surfaces: overrides.touched_surfaces ?? [
			{ type: "path", value: "skills/create-skill/SKILL.md" },
		],
		observations: [],
		evidence_gaps: [],
		cost: { status: "unavailable", gap_code: "cost_unavailable" },
		runtime: {},
	};
}

describe("reduceReviewLedger review units (U2)", () => {
	test("same trusted skill_run_id coalesces into one review unit", () => {
		const { review_units } = reduceReviewLedger([
			report({
				report_id: "r-capture",
				evidence_source: "hook_capture",
				skill_run_id: "run-1",
				skill_run_id_provenance: "correlation_owned",
			}),
			report({
				report_id: "r-closeout",
				evidence_source: "driver_closeout",
				skill_run_id: "run-1",
				skill_run_id_provenance: "correlation_owned",
			}),
		]);

		expect(review_units).toHaveLength(1);
		expect(review_units[0]).toMatchObject({
			review_unit_key: "run:run-1",
			trusted_run: true,
			report_ids: ["r-capture", "r-closeout"],
		});
	});

	test("same untrusted skill_run_id stays separate", () => {
		const { review_units } = reduceReviewLedger([
			report({ report_id: "r-a", skill_run_id: "run-x" }),
			report({ report_id: "r-b", skill_run_id: "run-x" }),
		]);

		expect(review_units).toHaveLength(2);
		expect(review_units.every((unit) => unit.trusted_run === false)).toBe(true);
	});

	test("report-authored skill_run_id stays separate", () => {
		const { review_units } = reduceReviewLedger([
			report({
				report_id: "r-a",
				skill_run_id: "run-x",
				skill_run_id_provenance: "report_authored",
			}),
			report({
				report_id: "r-b",
				skill_run_id: "run-x",
				skill_run_id_provenance: "report_authored",
			}),
		]);

		expect(review_units).toHaveLength(2);
		expect(review_units.every((unit) => unit.trusted_run === false)).toBe(true);
	});

	test("missing skill_run_id produces report-local units", () => {
		const { review_units } = reduceReviewLedger([
			report({ report_id: "r-a" }),
			report({ report_id: "r-b" }),
		]);

		expect(review_units.map((unit) => unit.review_unit_key)).toEqual([
			"report:r-a",
			"report:r-b",
		]);
	});

	test("review-unit identity is independent of anchor and evidence source", () => {
		const { review_units } = reduceReviewLedger([
			report({
				report_id: "r-a",
				evidence_source: "hook_capture",
				touched_surfaces: [{ type: "path", value: "a/one.ts" }],
				skill_run_id: "run-1",
				skill_run_id_provenance: "runtime_owned",
			}),
			report({
				report_id: "r-b",
				evidence_source: "driver_closeout",
				touched_surfaces: [{ type: "path", value: "z/other.ts" }],
				skill_run_id: "run-1",
				skill_run_id_provenance: "runtime_owned",
			}),
		]);

		expect(review_units).toHaveLength(1);
		expect(review_units[0]?.report_ids).toEqual(["r-a", "r-b"]);
	});
});

describe("reduceReviewLedger golden vectors (U4)", () => {
	const sharedAnchor: readonly ReportCardTarget[] = [
		{ type: "path", value: "src/feature.ts" },
	];

	test("vector: same anchor, no shared trusted run — repeated_anchor + mixed sources, NOT corroborated", () => {
		const { ledger_entries } = reduceReviewLedger([
			report({
				report_id: "r-driver",
				evidence_source: "driver_closeout",
				touched_surfaces: sharedAnchor,
			}),
			report({
				report_id: "r-runtime",
				evidence_source: "hook_capture",
				capture_runtime: "codex_stop",
				touched_surfaces: sharedAnchor,
			}),
		]);

		expect(ledger_entries).toHaveLength(1);
		const entry = ledger_entries[0];
		expect(entry?.allowed_claims).toContain("repeated_anchor");
		expect(entry?.allowed_claims).toContain("mixed_evidence_sources");
		expect(entry?.allowed_claims).not.toContain("corroborated");
		expect(entry?.evidence_tier).not.toBe("corroborated");
	});

	test("vector: repeated weak label-only anchors stay standalone", () => {
		const labelOnly: readonly ReportCardTarget[] = [
			{ type: "label", value: "flaky-tests" },
		];
		const { ledger_entries, anchor_miss_telemetry } = reduceReviewLedger([
			report({ report_id: "r-a", touched_surfaces: labelOnly }),
			report({ report_id: "r-b", touched_surfaces: labelOnly }),
		]);

		expect(ledger_entries).toHaveLength(2);
		expect(ledger_entries.every((entry) => entry.anchor_strength === "weak")).toBe(
			true,
		);
		expect(ledger_entries.every((entry) => !entry.ledger_anchor_key)).toBe(true);
		expect(
			ledger_entries.every((entry) => entry.resolution_state === "no_action"),
		).toBe(true);
		expect(anchor_miss_telemetry).toEqual([
			expect.objectContaining({ weak_anchor_reason: "label_only", count: 2 }),
		]);
	});

	test("vector: Codex Stop-detected turn is runtime_observed without identity", () => {
		const { ledger_entries } = reduceReviewLedger([
			report({
				report_id: "r-codex",
				evidence_source: "hook_capture",
				capture_runtime: "codex_stop",
			}),
		]);

		const entry = ledger_entries[0];
		expect(entry?.evidence_tier).toBe("runtime_observed");
		expect(entry?.allowed_claims).not.toContain("trusted_engine_identity");
		expect(entry?.allowed_claims).not.toContain("corroborated");
	});

	test("vector: linked Claude Stop skill + closeout in one trusted run can claim corroborated", () => {
		const { ledger_entries } = reduceReviewLedger([
			report({
				report_id: "r-capture",
				evidence_source: "hook_capture",
				capture_runtime: "claude_stop",
				touched_surfaces: sharedAnchor,
				skill_run_id: "run-trusted",
				skill_run_id_provenance: "correlation_owned",
			}),
			report({
				report_id: "r-closeout",
				evidence_source: "driver_closeout",
				touched_surfaces: sharedAnchor,
				skill_run_id: "run-trusted",
				skill_run_id_provenance: "correlation_owned",
			}),
		]);

		expect(ledger_entries).toHaveLength(1);
		const entry = ledger_entries[0];
		expect(entry?.allowed_claims).toContain("same_trusted_run");
		expect(entry?.allowed_claims).toContain("corroborated");
		expect(entry?.evidence_tier).toBe("corroborated");
		expect(entry?.allowed_claims).not.toContain("trusted_engine_identity");
	});

	test("vector: repeated strong-anchor review units merge into one ledger entry", () => {
		const { ledger_entries } = reduceReviewLedger([
			report({ report_id: "r-a", touched_surfaces: sharedAnchor }),
			report({ report_id: "r-b", touched_surfaces: sharedAnchor }),
		]);

		expect(ledger_entries).toHaveLength(1);
		expect(ledger_entries[0]?.review_unit_keys).toEqual([
			"report:r-a",
			"report:r-b",
		]);
		expect(ledger_entries[0]?.resolution_state).toBe("open");
	});

	test("vector: anchor-miss telemetry counts reasons without affecting ledger counts", () => {
		const { ledger_entries, anchor_miss_telemetry } = reduceReviewLedger([
			report({ report_id: "r-strong", touched_surfaces: sharedAnchor }),
			report({
				report_id: "r-weak",
				touched_surfaces: [{ type: "label", value: "no-path" }],
			}),
			report({
				report_id: "r-outofrepo",
				touched_surfaces: [{ type: "path", value: "/etc/passwd" }],
			}),
		]);

		// strong merges to 1, weak + out-of-repo are standalone => 3 entries
		expect(ledger_entries).toHaveLength(3);
		const reasons = anchor_miss_telemetry.map((t) => t.weak_anchor_reason).sort();
		expect(reasons).toEqual(["label_only", "out_of_repo"]);
	});

	test("driver-closeout-only entries render as driver_declared", () => {
		const { ledger_entries } = reduceReviewLedger([
			report({ report_id: "r-driver", evidence_source: "driver_closeout" }),
		]);

		expect(ledger_entries[0]?.evidence_tier).toBe("driver_declared");
	});

	test("duplicate report_id (weak anchors) cannot merge into one mixed-source entry", () => {
		// A forged inbox repeats a report_id across two unrelated weak reports.
		// They must stay two standalone entries — never one weak entry claiming
		// mixed_evidence_sources (KTD4 weak-anchor merge prevention).
		const labelOnly: readonly ReportCardTarget[] = [
			{ type: "label", value: "shared-label" },
		];
		const { ledger_entries, review_units } = reduceReviewLedger([
			report({
				report_id: "dup",
				evidence_source: "hook_capture",
				touched_surfaces: labelOnly,
			}),
			report({
				report_id: "dup",
				evidence_source: "driver_closeout",
				touched_surfaces: labelOnly,
			}),
		]);

		expect(review_units.map((unit) => unit.review_unit_key)).toEqual([
			"report:dup#1",
			"report:dup#2",
		]);
		expect(ledger_entries).toHaveLength(2);
		for (const entry of ledger_entries) {
			expect(entry.source_mix).toHaveLength(1);
			expect(entry.allowed_claims).not.toContain("mixed_evidence_sources");
			expect(entry.allowed_claims).not.toContain("corroborated");
		}
	});

	test("duplicate report_id across two trusted runs cannot forge corroboration", () => {
		// Same report_id, same strong anchor, but two different trusted runs.
		// Occurrence-based indexing keeps the runs distinct, so the shared-anchor
		// entry must not see one trusted unit with both sources => no corroboration.
		const { ledger_entries } = reduceReviewLedger([
			report({
				report_id: "dup",
				evidence_source: "hook_capture",
				touched_surfaces: sharedAnchor,
				skill_run_id: "run-a",
				skill_run_id_provenance: "runtime_owned",
			}),
			report({
				report_id: "dup",
				evidence_source: "driver_closeout",
				touched_surfaces: sharedAnchor,
				skill_run_id: "run-b",
				skill_run_id_provenance: "runtime_owned",
			}),
		]);

		expect(ledger_entries).toHaveLength(1);
		const entry = ledger_entries[0];
		expect(entry?.evidence_tier).not.toBe("corroborated");
		expect(entry?.allowed_claims).not.toContain("corroborated");
		expect(entry?.allowed_claims).not.toContain("same_trusted_run");
		// Distinct runs => two review_unit_keys on the shared-anchor entry.
		expect(entry?.review_unit_keys).toHaveLength(2);
	});

	test("empty reports produce an empty, valid reducer result", () => {
		const result = reduceReviewLedger([]);
		expect(result.review_units).toEqual([]);
		expect(result.ledger_entries).toEqual([]);
		expect(result.anchor_miss_telemetry).toEqual([]);
	});

	test("evidence tier and allowed claims ignore renderer wording", () => {
		// Same anchor, mixed sources, but DIFFERENT untrusted runs => no corroboration.
		const { ledger_entries } = reduceReviewLedger([
			report({
				report_id: "r-driver",
				evidence_source: "driver_closeout",
				touched_surfaces: sharedAnchor,
				skill_run_id: "run-a",
				skill_run_id_provenance: "report_authored",
			}),
			report({
				report_id: "r-runtime",
				evidence_source: "hook_capture",
				capture_runtime: "codex_stop",
				touched_surfaces: sharedAnchor,
				skill_run_id: "run-b",
				skill_run_id_provenance: "report_authored",
			}),
		]);

		expect(ledger_entries).toHaveLength(1);
		expect(ledger_entries[0]?.allowed_claims).not.toContain("corroborated");
		expect(ledger_entries[0]?.allowed_claims).not.toContain("same_trusted_run");
	});
});
