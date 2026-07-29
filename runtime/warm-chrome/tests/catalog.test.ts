import { describe, expect, test } from "bun:test";
import type { BranchStation } from "@side-quest/cli-command-facade";

import {
	findWarmChromeBranchStationCatalogDrift,
	projectWarmChromeStationEnvelopeExpectation,
	projectWarmChromeStationMap,
	resolveWarmChromeReemittedStations,
	WARM_CHROME_CHECK_PROOF_FAILURE_STATION_IDS,
	warmChromeBranchStationCatalog,
	warmChromeReemittedCheckStationIds,
	type WarmChromeReemittingCommand,
} from "../src/branch-station-catalog.ts";
import {
	listMissingWarmChromeBranchStationEvidence,
	warmChromeBranchStationEvidence,
} from "../src/branch-station-evidence.ts";
import { projectWarmChromeCommandDiscoveryTree } from "../src/command-contract.ts";
import {
	WARM_CHROME_BROWSER_ENTRY_EXIT_CODE,
	WARM_CHROME_CONTRACT_ID,
	WARM_CHROME_FAILURE_ACTION_IDS,
	WARM_CHROME_SUCCESS_ACTION_IDS,
} from "../src/model.ts";

const AUTHORITATIVE_STATION_IDS = [
	"check.verified",
	"check.port_occupied_foreign",
	"check.endpoint_unreachable",
	"check.wrong_browser",
	"check.unsafe_profile",
	"check.profile_posture_unsafe",
	"check.non_loopback",
	"check.invalid_cdp",
	"check.listener_mismatch",
	"check.runtime_failure",
	"check.invalid_usage",
	"launch.launched",
	"launch.already_verified",
	"launch.port_occupied_foreign",
	"launch.spawned_unverified",
	"launch.human-action-required",
	"repair.repaired",
	"repair.unrepairable",
	"repair.human-action-required",
] as const;

const REEMITTING_COMMANDS = ["launch", "repair"] as const satisfies readonly WarmChromeReemittingCommand[];

const BROWSER_ENTRY_EXIT = Number(WARM_CHROME_BROWSER_ENTRY_EXIT_CODE);

// Widened view: the literal `as const` catalog union defeats comparisons on
// optional fields; assertions here work over the facade BranchStation shape.
const catalogStations: readonly BranchStation[] = warmChromeBranchStationCatalog;

describe("warm-chrome branch station catalog (U3 R4)", () => {
	// Named unknown: no repo precedent combines a command alias with a Branch
	// Station Catalog. This is the confirmation gate — the alias command
	// (status, zero stations) must reconcile without drift.
	test("drift gate returns no findings with the status alias in discovery", () => {
		expect(findWarmChromeBranchStationCatalogDrift()).toEqual([]);
	});

	test("catalog transcribes exactly the 19 authoritative stations", () => {
		expect(warmChromeBranchStationCatalog.map((station) => station.id)).toEqual([
			...AUTHORITATIVE_STATION_IDS,
		]);
	});

	test("station-map finding ids sorted-equal catalog ids before any evidence", () => {
		const stationMap = projectWarmChromeStationMap();
		expect(stationMap.stations).toHaveLength(19);
		expect(stationMap.findings.map((finding) => finding.station_id).sort()).toEqual(
			[...AUTHORITATIVE_STATION_IDS].sort(),
		);
		expect(
			stationMap.findings.every((finding) => finding.finding_kind === "missing"),
		).toBe(true);
	});

	test("status alias owns zero stations yet reconciles into the station map", () => {
		const discovery = projectWarmChromeCommandDiscoveryTree();
		expect(discovery.commands.status?.alias_of).toBe("check");

		expect(
			catalogStations.filter((station) => station.command === "status"),
		).toEqual([]);

		const stationMap = projectWarmChromeStationMap();
		expect(Object.keys(stationMap.commands).sort()).toEqual([
			"check",
			"launch",
			"repair",
			"status",
		]);
		expect(stationMap.commands.status?.station_ids).toEqual([]);
	});

	test("browser-entry stations pin exit 20 from the package-owned constant", () => {
		const browserEntryStations = catalogStations.filter(
			(station) => station.expectedExitCode === BROWSER_ENTRY_EXIT,
		);
		expect(browserEntryStations.map((station) => station.id).sort()).toEqual(
			[
				...WARM_CHROME_CHECK_PROOF_FAILURE_STATION_IDS,
				"launch.port_occupied_foreign",
				"launch.spawned_unverified",
				"repair.unrepairable",
			].sort(),
		);
	});
});

describe("warm-chrome re-emit rule (U3 R4)", () => {
	test("launch and repair re-emit every check proof-failure station plus invalid_usage and runtime_failure", () => {
		const expectedIds: readonly string[] = [
			...WARM_CHROME_CHECK_PROOF_FAILURE_STATION_IDS,
			"check.invalid_usage",
			"check.runtime_failure",
		].sort();
		for (const command of REEMITTING_COMMANDS) {
			const reemittedIds: readonly string[] =
				warmChromeReemittedCheckStationIds[command];
			expect([...reemittedIds].sort()).toEqual([...expectedIds]);
		}
	});

	test("re-emitted stations resolve to the check-owned catalog objects by reference", () => {
		for (const command of REEMITTING_COMMANDS) {
			const resolved = resolveWarmChromeReemittedStations(command);
			expect(resolved.map((station) => station.id)).toEqual([
				...warmChromeReemittedCheckStationIds[command],
			]);
			for (const station of resolved) {
				expect(station.command).toBe("check");
				const catalogStation = warmChromeBranchStationCatalog.find(
					(candidate) => candidate.id === station.id,
				);
				expect(station).toBe(catalogStation as typeof station);
			}
		}
	});

	test("a command-owned station sharing a re-emitted branch projects an equivalent envelope", () => {
		// Mechanical equivalence over catalog + re-emit map data: where launch or
		// repair declares its own station for a re-emitted check branch (for a
		// stricter mutation pin), the envelope expectation must be identical, so
		// a diverging envelope is a drift finding.
		let sharedBranches = 0;
		for (const command of REEMITTING_COMMANDS) {
			for (const checkStation of resolveWarmChromeReemittedStations(command)) {
				const branch = checkStation.id.split(".")[1];
				const owned = catalogStations.find(
					(candidate) => candidate.id === `${command}.${branch}`,
				);
				if (!owned) continue;
				sharedBranches += 1;
				expect(projectWarmChromeStationEnvelopeExpectation(owned)).toEqual(
					projectWarmChromeStationEnvelopeExpectation(checkStation),
				);
			}
		}
		// launch.port_occupied_foreign is the known shared branch today.
		expect(sharedBranches).toBeGreaterThanOrEqual(1);
	});
});

describe("warm-chrome canonical error codes and actions (U3 R5)", () => {
	test("each error station carries one canonical error code equal to its branch id", () => {
		for (const station of catalogStations) {
			if (station.expectedEnvelopeStatus !== "error") continue;
			expect(station.expectedErrorCode).toBe(station.id.split(".")[1]);
		}
	});

	test("ok stations carry no error code and route to use_verified_endpoint", () => {
		for (const station of catalogStations) {
			if (station.expectedEnvelopeStatus !== "ok") continue;
			expect(station.expectedErrorCode).toBeUndefined();
			expect(station.expectedActionId).toBe("use_verified_endpoint");
		}
	});

	test("every primary action id resolves against the model action vocabulary", () => {
		const knownActionIds = new Set<string>([
			...WARM_CHROME_FAILURE_ACTION_IDS,
			...WARM_CHROME_SUCCESS_ACTION_IDS,
		]);
		for (const station of catalogStations) {
			if (station.expectedActionId === undefined) continue;
			expect(knownActionIds.has(station.expectedActionId)).toBe(true);
		}
	});

	test("every station carries the package result contract id", () => {
		for (const station of catalogStations) {
			expect(station.expectedResultContractId).toBe(WARM_CHROME_CONTRACT_ID);
		}
	});
});

describe("warm-chrome branch station evidence manifest (U3)", () => {
	test("all 19 stations are missing before any scenario runs", () => {
		expect(listMissingWarmChromeBranchStationEvidence([])).toEqual(
			[...AUTHORITATIVE_STATION_IDS].sort(),
		);
	});

	test("the expected-coverage manifest names every station once and clears missing findings", () => {
		expect(
			warmChromeBranchStationEvidence.map((row) => row.stationId),
		).toEqual([...AUTHORITATIVE_STATION_IDS]);
		expect(
			listMissingWarmChromeBranchStationEvidence(warmChromeBranchStationEvidence),
		).toEqual([]);
		expect(
			findWarmChromeBranchStationCatalogDrift(warmChromeBranchStationEvidence),
		).toEqual([]);
	});
});
