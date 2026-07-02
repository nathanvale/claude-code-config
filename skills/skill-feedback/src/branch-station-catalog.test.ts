// fallow-ignore-file unused-file, code-duplication
// Bun test entrypoint; package runner invokes this file without static imports.
import { describe, expect, test } from "bun:test";
import {
	findBranchStationCatalogDrift,
	projectStationMap,
} from "@side-quest/cli-command-facade";
import {
	SKILL_FEEDBACK_PLANNING_BRANCH_STATION_IDS,
	findSkillFeedbackBranchStationCatalogDrift,
	projectSkillFeedbackStationDiscovery,
	projectSkillFeedbackStationMap,
	skillFeedbackBranchStationCatalog,
} from "./branch-station-catalog";
import { skillFeedbackContracts } from "./command-contract";

describe("skill-feedback Branch Station Catalog", () => {
	test("references only live public command ids from skillFeedbackContracts", () => {
		expect(findSkillFeedbackBranchStationCatalogDrift()).toEqual([]);
		const commands = new Set(Object.keys(skillFeedbackContracts));

		for (const station of skillFeedbackBranchStationCatalog) {
			expect(commands.has(station.command), station.id).toBe(true);
		}
	});

	test("contains every planning-stage station id", () => {
		const catalogIds = skillFeedbackBranchStationCatalog.map((station) => station.id);

		expect(catalogIds).toEqual([...SKILL_FEEDBACK_PLANNING_BRANCH_STATION_IDS]);
	});

	test("declares human dashboard MVP command branch stations", () => {
		const catalogIds = new Set(
			skillFeedbackBranchStationCatalog.map((station) => station.id),
		);
		const expectedIds = [
			"reports.primary_recent",
			"reports.low_signal_opt_in",
			"reports.empty_inbox",
			"reports.invalid_usage",
			"report.primary_detail",
			"report.low_signal_requires_opt_in",
			"report.low_signal_detail_opt_in",
			"report.unknown_ref",
			"report.duplicate_ref",
			"report.cross_lane_duplicate_ref",
			"report.invalid_ref_path",
			"report.invalid_usage",
			"usage.skill_ranking",
			"usage.separates_low_signal",
			"usage.empty_inbox",
			"usage.invalid_usage",
			"queue.owner_path_strong",
			"queue.skill_fallback",
			"queue.skill_filter_fallback",
			"queue.weak_requires_opt_in",
			"queue.weak_opt_in",
			"queue.no_build",
			"queue.empty_inbox",
			"queue.invalid_usage",
		] as const;

		for (const stationId of expectedIds) {
			expect(catalogIds.has(stationId), stationId).toBe(true);
		}
	});

	test("every public command has at least one green station", () => {
		const greenCommands = new Set(
			skillFeedbackBranchStationCatalog
				.filter(
					(station) =>
						station.expectedExitCode === 0 &&
						(!("expectedEnvelopeStatus" in station) ||
							station.expectedEnvelopeStatus === "ok"),
				)
				.map((station) => station.command),
		);

		expect([...greenCommands].map(String).sort()).toEqual(
			Object.keys(skillFeedbackContracts).sort(),
		);
	});

	test("every public command has a deterministic failure or diagnostic station", () => {
		const nonSuccessCommands = new Set(
			skillFeedbackBranchStationCatalog
				.filter((station) => station.intent !== "success")
				.map((station) => station.command),
		);

		expect([...nonSuccessCommands].map(String).sort()).toEqual(
			Object.keys(skillFeedbackContracts).sort(),
		);
	});

	test("duplicate station ids fail catalog validation", () => {
		const drift = findBranchStationCatalogDrift({
			discovery: projectSkillFeedbackStationDiscovery(),
			catalog: [
				...skillFeedbackBranchStationCatalog,
				skillFeedbackBranchStationCatalog[0],
			],
			path: "test",
		});

		expect(drift.map((entry) => entry.category)).toContain(
			"branch-station-id-duplicate",
		);
	});

	test("unknown command ids fail catalog validation", () => {
		const drift = findBranchStationCatalogDrift({
			discovery: projectSkillFeedbackStationDiscovery(),
			catalog: [
				{
					...skillFeedbackBranchStationCatalog[0],
					id: "unknown.success",
					command: "unknown",
				},
			],
			path: "test",
		});

		expect(drift.map((entry) => entry.category)).toContain(
			"branch-station-command-unknown",
		);
	});

	test("station ids use stable package-owned vocabulary", () => {
		expect(skillFeedbackBranchStationCatalog.map((station) => station.id)).toEqual([
			"record.success",
			"record.proof_attached",
			"record.proof_unavailable",
			"record.invalid_usage",
			"closeout.success_stdin",
			"closeout.proof_attached",
			"closeout.proof_unavailable",
			"closeout.invalid_receipt",
			"dashboard.missing_inbox",
			"dashboard.populated_inbox",
			"dashboard.unsafe_inbox",
			"reports.primary_recent",
			"reports.low_signal_opt_in",
			"reports.empty_inbox",
			"reports.invalid_usage",
			"report.primary_detail",
			"report.low_signal_requires_opt_in",
			"report.low_signal_detail_opt_in",
			"report.unknown_ref",
			"report.duplicate_ref",
			"report.cross_lane_duplicate_ref",
			"report.invalid_ref_path",
			"report.invalid_usage",
			"usage.skill_ranking",
			"usage.separates_low_signal",
			"usage.empty_inbox",
			"usage.invalid_usage",
			"queue.owner_path_strong",
			"queue.skill_fallback",
			"queue.skill_filter_fallback",
			"queue.weak_requires_opt_in",
			"queue.weak_opt_in",
			"queue.no_build",
			"queue.empty_inbox",
			"queue.invalid_usage",
			"review.empty_inbox",
			"review.target_resolution_failed",
			"health.populated_inbox",
			"health.proof_diagnostics",
			"health.correlation_witness_diagnostics",
			"health.unsafe_inbox",
			"purge.preview",
			"purge.execute",
			"purge.invalid_usage",
			"correlate.preview_repairable",
			"correlate.execute_written",
			"correlate.already_linked",
			"correlate.ambiguous",
			"correlate.insufficient_evidence",
			"correlate.unsafe_inbox",
			"correlate.invalid_usage",
		]);
		expect(
			skillFeedbackBranchStationCatalog.some((station) =>
				station.id.includes("valid receipt"),
			),
		).toBe(false);
	});

	test("required-but-uncovered stations remain visible as scaffolded work", () => {
		const map = projectSkillFeedbackStationMap();

		expect(map.stations).toHaveLength(skillFeedbackBranchStationCatalog.length);
		expect(map.findings).toHaveLength(skillFeedbackBranchStationCatalog.length);
		expect(new Set(map.findings.map((finding) => finding.finding_kind))).toEqual(
			new Set(["missing"]),
		);
	});

	test("projection keeps the completeness claim scoped to declared branches", () => {
		const map = projectStationMap({
			discovery: projectSkillFeedbackStationDiscovery(),
			catalog: skillFeedbackBranchStationCatalog,
		});

		expect(map.completeness_claim).toBe("declared_branch_coverage");
		expect(JSON.stringify(map)).not.toContain("whole-program");
	});
});
