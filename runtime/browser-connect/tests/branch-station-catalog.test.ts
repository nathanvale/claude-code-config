import { describe, expect, test } from "bun:test";
import type {
	BranchStation,
	BranchStationEvidence,
} from "@side-quest/cli-command-facade";

import {
	BROWSER_CONNECT_STATION_IDS,
	type BrowserConnectStationId,
	browserConnectBranchStationCatalog,
	findBrowserConnectBranchStationCatalogDrift,
	projectBrowserConnectStationMap,
} from "../src/branch-station-catalog.ts";
import {
	BROWSER_CONNECT_COMMANDS,
	projectBrowserConnectCommandDiscoveryTree,
} from "../src/command-contract.ts";
import {
	BROWSER_CONNECT_CONTRACT_ID,
	BROWSER_CONNECT_FAILURE_ACTION_IDS,
	BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS,
	BROWSER_CONNECT_SUCCESS_ACTION_IDS,
} from "../src/model.ts";
import {
	BROWSER_CONNECT_CONNECTION_ENTRY_EXIT_CODE,
	BROWSER_CONNECT_WRAPPED_NOT_FOUND_EXIT_CODE,
} from "../src/command-contract.ts";
import {
	browserConnectRecoveryExpectations,
	type BrowserConnectErrorStationId,
} from "../src/recovery-expectations.ts";

// The 19 authoritative slice-one stations from the Planning Contract table
// plus the four U5 repair-adapter stations (preview, installed, upgraded, and
// the 14th error station operator_stop — R1), keyed <command>.<branch> to
// satisfy the facade station-id pattern.
const AUTHORITATIVE_STATION_IDS = [
	"dashboard.ok",
	"check.usage_invalid",
	"run.missing_separator",
	"check.verified",
	"check.environment_absent",
	"check.foreign_listener",
	"connect.verified_existing",
	"connect.verified_launched",
	"connect.launch_failed",
	"connect.foreign_listener",
	"connect.adapter_unknown",
	"connect.adapter_not_installed",
	"connect.route_incompatible",
	"connect.attachment_failed",
	"run.preexec_connect_failed",
	"run.wrapped_not_found",
	"run.passthrough_success",
	"run.passthrough_failure",
	"check.runtime_error",
	"repair-adapter.preview",
	"repair-adapter.installed",
	"repair-adapter.upgraded",
	"repair-adapter.operator_stop",
] as const;

const CONNECT_ENTRY_EXIT = Number(BROWSER_CONNECT_CONNECTION_ENTRY_EXIT_CODE);
const WRAPPED_NOT_FOUND_EXIT = Number(
	BROWSER_CONNECT_WRAPPED_NOT_FOUND_EXIT_CODE,
);

// Widened view: the literal `as const` catalog union defeats comparisons on
// optional fields; assertions here work over the facade BranchStation shape.
const catalogStations: readonly BranchStation[] =
	browserConnectBranchStationCatalog;

describe("browser-connect branch station catalog (U3 R2/R7/R11/R15/R17)", () => {
	test("catalog transcribes exactly the 23 authoritative stations", () => {
		expect(
			browserConnectBranchStationCatalog.map((station) => station.id),
		).toEqual([...AUTHORITATIVE_STATION_IDS]);
		expect([...BROWSER_CONNECT_STATION_IDS]).toEqual([
			...AUTHORITATIVE_STATION_IDS,
		]);
	});

	test("drift gate returns no findings against live discovery", () => {
		expect(findBrowserConnectBranchStationCatalogDrift()).toEqual([]);
	});

	test("every station's command is one of the four discovery commands", () => {
		const commands = new Set<string>(BROWSER_CONNECT_COMMANDS);
		for (const station of catalogStations) {
			expect(commands.has(station.command)).toBe(true);
			expect(station.id.split(".")[0]).toBe(station.command);
		}
	});

	test("station-map finding ids sorted-equal catalog ids before any evidence", () => {
		const stationMap = projectBrowserConnectStationMap();
		expect(stationMap.stations).toHaveLength(23);
		expect(stationMap.findings.map((finding) => finding.station_id).sort()).toEqual(
			[...AUTHORITATIVE_STATION_IDS].sort(),
		);
		expect(
			stationMap.findings.every((finding) => finding.finding_kind === "missing"),
		).toBe(true);
	});

	test("station map claims only declared branch coverage", () => {
		expect(projectBrowserConnectStationMap().completeness_claim).toBe(
			"declared_branch_coverage",
		);
	});

	test("every discovery command reconciles into the station map", () => {
		const stationMap = projectBrowserConnectStationMap();
		expect(Object.keys(stationMap.commands).sort()).toEqual([
			"check",
			"connect",
			"dashboard",
			"repair-adapter",
			"run",
		]);
		// Discovery has a command entry for every catalog-referenced command.
		const discovery = projectBrowserConnectCommandDiscoveryTree();
		for (const station of catalogStations) {
			expect(discovery.commands[station.command as never]).toBeDefined();
		}
	});
});

describe("browser-connect station exit and failure-class mapping (U3 KTD4)", () => {
	test("connection-entry stations pin exit 20", () => {
		const entryStations = catalogStations
			.filter((station) => station.expectedExitCode === CONNECT_ENTRY_EXIT)
			.map((station) => station.id)
			.sort();
		expect(entryStations).toEqual(
			[
				"check.environment_absent",
				"check.foreign_listener",
				"connect.attachment_failed",
				"connect.adapter_not_installed",
				"connect.foreign_listener",
				"connect.launch_failed",
				"connect.route_incompatible",
				"run.preexec_connect_failed",
				"repair-adapter.operator_stop",
			].sort(),
		);
	});

	test("run wrapped-not-found pins exit 127", () => {
		const notFound = catalogStations.filter(
			(station) => station.expectedExitCode === WRAPPED_NOT_FOUND_EXIT,
		);
		expect(notFound.map((station) => station.id)).toEqual([
			"run.wrapped_not_found",
		]);
	});

	test("usage stations pin exit 2; runtime-error pins exit 1", () => {
		const usage = catalogStations
			.filter((station) => station.expectedExitCode === 2)
			.map((station) => station.id)
			.sort();
		expect(usage).toEqual(
			["check.usage_invalid", "connect.adapter_unknown", "run.missing_separator"].sort(),
		);
		const runtime = catalogStations.filter(
			(station) => station.expectedExitCode === 1,
		);
		expect(runtime.map((station) => station.id)).toEqual(["check.runtime_error"]);
	});

	test("passthrough-failure carries no deterministic exit code, only an ok envelope", () => {
		const station = catalogStations.find(
			(candidate) => candidate.id === "run.passthrough_failure",
		);
		expect(station?.expectedExitCode).toBeUndefined();
		expect(station?.expectedEnvelopeStatus).toBe("ok");
	});

	test("both check and connect foreign-listener stations share the station error code", () => {
		const foreignStations = catalogStations.filter(
			(station) => station.expectedErrorCode === "foreign_listener",
		);
		expect(foreignStations.map((station) => station.id).sort()).toEqual([
			"check.foreign_listener",
			"connect.foreign_listener",
		]);
		// check stays a diagnostic surface: its legacy value is always the
		// terminal listener inspection. connect's legacy value is context
		// dependent (use_suggested_port mirror vs inspect_listener stop), so the
		// connect station carries no single pinned action id (U4 R30).
		const checkStation = foreignStations.find(
			(station) => station.id === "check.foreign_listener",
		);
		const connectStation = foreignStations.find(
			(station) => station.id === "connect.foreign_listener",
		);
		expect(checkStation?.expectedActionId).toBe(
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["foreign-listener"],
		);
		expect(connectStation?.expectedActionId).toBeUndefined();
	});

	test("context-dependent stations carry no pinned action id; pinned stations agree with the recovery map (U4 R13/R30)", () => {
		// The recovery-expectation map owns per-arm legacy truth; a station whose
		// legacy value varies with typed context pins nothing here.
		const unpinnedErrorStations = catalogStations
			.filter(
				(station) =>
					station.expectedEnvelopeStatus === "error" &&
					station.expectedActionId === undefined,
			)
			.map((station) => station.id)
			.sort();
		expect(unpinnedErrorStations).toEqual(
			[
				"connect.foreign_listener",
				"connect.adapter_not_installed",
				"run.preexec_connect_failed",
				"run.wrapped_not_found",
				"repair-adapter.operator_stop",
			].sort(),
		);
		for (const station of catalogStations) {
			if (station.expectedEnvelopeStatus !== "error") continue;
			if (station.expectedActionId === undefined) continue;
			const expectation =
				browserConnectRecoveryExpectations[
					station.id as BrowserConnectErrorStationId
				];
			expect(
				expectation.legacy_next_action_ids as readonly string[],
				`station ${station.id} pin must be a declared legacy value`,
			).toContain(station.expectedActionId);
		}
	});
});

describe("browser-connect canonical error codes and actions (U3 R2)", () => {
	test("each error station carries one canonical error code equal to its branch id", () => {
		for (const station of catalogStations) {
			if (station.expectedEnvelopeStatus !== "error") continue;
			expect(station.expectedErrorCode).toBe(station.id.split(".")[1]);
		}
	});

	test("ok stations carry no error code and no failure action", () => {
		for (const station of catalogStations) {
			if (station.expectedEnvelopeStatus !== "ok") continue;
			expect(station.expectedErrorCode).toBeUndefined();
			expect(station.expectedActionId).toBeUndefined();
		}
	});

	test("every station action id resolves against the model action vocabulary", () => {
		const knownActionIds = new Set<string>([
			...BROWSER_CONNECT_FAILURE_ACTION_IDS,
			...BROWSER_CONNECT_SUCCESS_ACTION_IDS,
		]);
		for (const station of catalogStations) {
			if (station.expectedActionId === undefined) continue;
			expect(knownActionIds.has(station.expectedActionId)).toBe(true);
		}
	});

	test("every station carries the package result contract id", () => {
		for (const station of catalogStations) {
			expect(station.expectedResultContractId).toBe(BROWSER_CONNECT_CONTRACT_ID);
		}
	});
});

describe("browser-connect scenario-map exhaustiveness (U3 KTD6)", () => {
	// Compile-time gate: a Record over the full station-id union must name every
	// station exactly once. U8 builds its live-evidence scenario map on this same
	// key shape; a missing or extra key is a type error at build, not a runtime
	// surprise.
	test("a Record over the station-id union names every catalog id once", () => {
		const scenarioLabels: Record<BrowserConnectStationId, string> = {
			"dashboard.ok": "read-only projection",
			"check.usage_invalid": "usage rejection",
			"run.missing_separator": "no -- boundary",
			"check.verified": "environment verified",
			"check.environment_absent": "Agent Chrome absent",
			"check.foreign_listener": "proof rejects identity",
			"connect.verified_existing": "launched:false handoff",
			"connect.verified_launched": "launched:true handoff",
			"connect.launch_failed": "launch never verified",
			"connect.foreign_listener": "fail closed, no fallback",
			"connect.adapter_unknown": "adapter not in registry",
			"connect.adapter_not_installed": "binary/package absent",
			"connect.route_incompatible": "no shared route",
			"connect.attachment_failed": "probe failed",
			"run.preexec_connect_failed": "exec never starts",
			"run.wrapped_not_found": "wrapped command missing",
			"run.passthrough_success": "wrapped exited 0",
			"run.passthrough_failure": "wrapped nonzero",
			"check.runtime_error": "unexpected exception",
			"repair-adapter.preview": "read-only eligibility report",
			"repair-adapter.installed": "isolated install to pin",
			"repair-adapter.upgraded": "allowlisted upgrade to pin",
			"repair-adapter.operator_stop": "fail-closed package stop",
		};
		expect(Object.keys(scenarioLabels).sort()).toEqual(
			[...BROWSER_CONNECT_STATION_IDS].sort(),
		);
	});

	test("synthetic covered evidence over the full catalog drives the station map to full coverage", () => {
		const evidence: readonly BranchStationEvidence[] = catalogStations.map(
			(station) => ({
				stationId: station.id,
				status: "covered" as const,
				...(station.expectedExitCode === undefined
					? {}
					: { observedExitCode: station.expectedExitCode }),
				...(station.expectedEnvelopeStatus
					? { observedEnvelopeStatus: station.expectedEnvelopeStatus }
					: {}),
				...(station.expectedResultContractId
					? { observedResultContractId: station.expectedResultContractId }
					: {}),
				...(station.expectedErrorCode
					? { observedErrorCode: station.expectedErrorCode }
					: {}),
			}),
		);
		const stationMap = projectBrowserConnectStationMap(evidence);
		expect(stationMap.findings).toEqual([]);
		expect(findBrowserConnectBranchStationCatalogDrift(evidence)).toEqual([]);
	});
});
