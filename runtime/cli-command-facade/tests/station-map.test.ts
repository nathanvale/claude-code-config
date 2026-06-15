import { describe, expect, test } from "bun:test";
import {
	STATION_MAP_COMPLETENESS_CLAIM,
	type BranchStation,
	type BranchStationEvidence,
	type CommandDiscoveryTree,
	findBranchStationCatalogDrift,
	projectStationMap,
} from "@side-quest/cli-command-facade";

const discovery = {
	commands: {
		record: {
			script: "skill-feedback-runner",
			summary: "Capture one report.",
			json: true,
			mutation: "capture",
			audience: "agent",
			usage: ["record --skill <id>"],
			flags: {},
			exit_codes: { "0": "ok", "1": "failed", "2": "usage" },
		},
		review: {
			script: "skill-feedback-runner",
			summary: "Review reports.",
			json: true,
			mutation: "review",
			audience: "agent",
			usage: ["review"],
			flags: {},
			exit_codes: { "0": "ok", "1": "failed", "2": "usage" },
		},
	},
} satisfies CommandDiscoveryTree;

const station = {
	id: "record.success",
	command: "record",
	classification: "required",
	intent: "success",
	trigger: "valid receipt writes one report",
	expectedExitCode: 0,
	expectedEnvelopeStatus: "ok",
	expectedResultContractId: "skill-feedback.record",
	mutationExpectation: "writes_report",
} as const satisfies BranchStation;

describe("Station Map projection", () => {
	test("a catalog referencing an unknown command produces deterministic drift", () => {
		const drift = findBranchStationCatalogDrift({
			discovery,
			catalog: [{ ...station, id: "purge.preview", command: "purge" }],
		});

		expect(drift.map((entry) => entry.category)).toEqual([
			"branch-station-command-unknown",
		]);
		expect(drift[0]?.action).toContain("purge.preview:purge");
	});

	test("duplicate station ids produce deterministic drift", () => {
		const drift = findBranchStationCatalogDrift({
			discovery,
			catalog: [station, { ...station, intent: "alternate success" }],
		});

		expect(drift.map((entry) => entry.category)).toEqual([
			"branch-station-id-duplicate",
		]);
	});

	test("station ids sort canonically in the projected Station Map", () => {
		const map = projectStationMap({
			discovery,
			catalog: [
				{
					id: "review.empty_inbox",
					command: "review",
					classification: "required",
					intent: "success",
					trigger: "empty inbox reports zero items",
					expectedExitCode: 0,
					expectedEnvelopeStatus: "ok",
					expectedResultContractId: "skill-feedback.review",
					mutationExpectation: "none",
				},
				station,
			],
		});

		expect(map.stations.map((entry) => entry.station_id)).toEqual([
			"record.success",
			"review.empty_inbox",
		]);
		expect(map.commands.record.station_ids).toEqual(["record.success"]);
	});

	test("unsafe projected text is rejected with the existing runtime text stance", () => {
		const drift = findBranchStationCatalogDrift({
			discovery,
			catalog: [
				{
					...station,
					trigger: "run bun test to inspect the branch",
				},
			],
		});

		expect(drift.map((entry) => entry.category)).toEqual([
			"branch-station-trigger-unsafe-text",
		]);
	});

	test("a required station with no observed evidence projects as missing", () => {
		const map = projectStationMap({ discovery, catalog: [station] });

		expect(map.stations[0]?.evidence.status).toBe("missing");
		expect(map.findings).toEqual([
			{
				station_id: "record.success",
				command: "record",
				finding_kind: "missing",
				summary:
					"record.success is missing for declared_branch_coverage.",
			},
		]);
	});

	test("a station with explicit skip rationale projects as skipped", () => {
		const evidence = [
			{
				stationId: "record.success",
				status: "skipped",
				rationale: "host state would make this probe brittle",
			},
		] as const satisfies readonly BranchStationEvidence[];

		const map = projectStationMap({ discovery, catalog: [station], evidence });

		expect(map.stations[0]?.evidence).toMatchObject({
			status: "skipped",
			rationale: "host state would make this probe brittle",
		});
		expect(map.findings[0]?.finding_kind).toBe("skipped");
	});

	test("a station with declared-unreachable rationale projects as declared-unreachable", () => {
		const evidence = [
			{
				stationId: "record.success",
				status: "declared-unreachable",
				rationale: "deterministic setup cannot force this host failure",
			},
		] as const satisfies readonly BranchStationEvidence[];

		const map = projectStationMap({ discovery, catalog: [station], evidence });

		expect(map.stations[0]?.evidence.status).toBe("declared-unreachable");
		expect(map.findings[0]?.finding_kind).toBe("declared-unreachable");
	});

	test("covered evidence can drift when observed result differs from expected", () => {
		const evidence = [
			{
				stationId: "record.success",
				status: "covered",
				observedExitCode: 1,
				observedEnvelopeStatus: "error",
			},
		] as const satisfies readonly BranchStationEvidence[];

		const map = projectStationMap({ discovery, catalog: [station], evidence });

		expect(map.stations[0]?.evidence.status).toBe("drifted");
		expect(map.findings[0]?.finding_kind).toBe("drifted");
	});

	test("projection represents Declared Branch Coverage only", () => {
		const map = projectStationMap({ discovery, catalog: [station] });

		expect(map.completeness_claim).toBe(STATION_MAP_COMPLETENESS_CLAIM);
		expect(JSON.stringify(map)).not.toContain("whole-program");
		expect(JSON.stringify(map)).not.toContain("typescript_branch_coverage");
	});

	test("projection preserves package-owned result vocabulary", () => {
		const map = projectStationMap({
			discovery,
			catalog: [
				{
					...station,
					expectedResultContractId: "package-owned.custom_result",
					expectedErrorCode: "package_owned_error",
				},
			],
		});

		expect(map.stations[0]?.expected).toMatchObject({
			result_contract_id: "package-owned.custom_result",
			error_code: "package_owned_error",
		});
	});
});
