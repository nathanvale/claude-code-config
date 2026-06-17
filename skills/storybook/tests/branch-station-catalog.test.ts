import { describe, expect, test } from "bun:test";
import type { BranchStationEvidence } from "@side-quest/cli-command-facade";
import {
	STORYBOOK_DOCTOR_PLANNING_BRANCH_STATION_IDS,
	findStorybookDoctorBranchStationCatalogDrift,
	projectStorybookDoctorStationMap,
	storybookDoctorBranchStationCatalog,
} from "../src/branch-station-catalog.ts";
import {
	STORYBOOK_DOCTOR_CONTRACT_ID,
	STORYBOOK_DOCTOR_DEEP_CONTRACT_ID,
	STORYBOOK_DOCTOR_COMMANDS_CONTRACT_ID,
} from "../src/readiness-model.ts";
import { collectStorybookDoctorEvidence } from "../src/branch-station-evidence.ts";
import type { StationTestResult } from "../src/branch-station-evidence.ts";

function fullEvidence(): BranchStationEvidence[] {
	const results: StationTestResult[] = [
		{
			stationId: "check.ready",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "check.no_package_json",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "check.no_storybook_config",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "check.no_storybook_dependency",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "check.no_mcp_addon_dependency",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "check.no_mcp_addon_config",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "check.no_storybook_script",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "check.no_live_session",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "check.non_loopback_url",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "check.manager_ok_mcp_missing",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "check.mcp_tools_ready",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "check.mcporter_missing_raw_mcp_ready",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "check.tmux_missing_hint",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_CONTRACT_ID,
		},
		{
			stationId: "deep.ready_with_local_doctor",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_DEEP_CONTRACT_ID,
		},
		{
			stationId: "deep.local_storybook_binary_missing",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_DEEP_CONTRACT_ID,
		},
		{
			stationId: "deep.storybook_doctor_nonzero",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_DEEP_CONTRACT_ID,
		},
		{
			stationId: "deep.debug_output_truncated",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_DEEP_CONTRACT_ID,
		},
		{
			stationId: "commands.discovery_json",
			status: "covered",
			exitCode: 0,
			envelopeStatus: "ok",
			resultContractId: STORYBOOK_DOCTOR_COMMANDS_CONTRACT_ID,
		},
		{
			stationId: "check.help_top_level",
			status: "covered",
			exitCode: 0,
		},
		{
			stationId: "check.version_stdout",
			status: "covered",
			exitCode: 0,
		},
	];
	return collectStorybookDoctorEvidence(results);
}

describe("branch station catalog", () => {
	test("catalog validates against live storybook doctor command discovery", () => {
		const drift = findStorybookDoctorBranchStationCatalogDrift();
		const commandDrift = drift.filter(
			(d) => d.category === "station_references_unknown_command",
		);
		expect(commandDrift).toEqual([]);
	});

	test("every planning-stage station id is present in catalog", () => {
		const catalogIds = new Set(
			storybookDoctorBranchStationCatalog.map((s) => s.id),
		);
		for (const id of STORYBOOK_DOCTOR_PLANNING_BRANCH_STATION_IDS) {
			expect(catalogIds.has(id)).toBe(true);
		}
	});

	test("station evidence covers required paths", () => {
		const evidence = fullEvidence();
		const map = projectStorybookDoctorStationMap(evidence);
		const missingRequired = map.stations.filter(
			(s) =>
				s.classification === "required" &&
				s.evidence.status === "missing",
		);
		expect(missingRequired).toEqual([]);
	});

	test("missing evidence for a required station projects as finding", () => {
		const map = projectStorybookDoctorStationMap([]);
		const requiredStations = map.stations.filter(
			(s) => s.classification === "required",
		);
		const missingStations = requiredStations.filter(
			(s) => s.evidence.status === "missing",
		);
		expect(missingStations.length).toBeGreaterThan(0);
	});

	test("station map claims declared branch coverage", () => {
		const map = projectStorybookDoctorStationMap(fullEvidence());
		expect(map.completeness_claim).toBe("declared_branch_coverage");
	});
});
