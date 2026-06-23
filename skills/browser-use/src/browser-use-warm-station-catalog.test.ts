import { describe, expect, test } from "bun:test";
import {
	findBranchStationCatalogDrift,
	projectStationMap,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_WARM_START_BRANCH_STATION_IDS,
	browserUseWarmStartBranchStationCatalog,
	findBrowserUseWarmStartBranchStationCatalogDrift,
	projectBrowserUseWarmStartStationDiscovery,
	projectBrowserUseWarmStartStationMap,
} from "./browser-use-warm-station-catalog";

describe("browser-use warm start Branch Station Catalog", () => {
	test("references live browser-use command discovery", () => {
		expect(findBrowserUseWarmStartBranchStationCatalogDrift()).toEqual([]);
	});

	test("contains every planning warm-start station id", () => {
		expect(browserUseWarmStartBranchStationCatalog.map((station) => station.id)).toEqual([
			...BROWSER_USE_WARM_START_BRANCH_STATION_IDS,
		]);
	});

	test("contains success, repair, retry, and diagnostics branches", () => {
		const intents = new Set(
			browserUseWarmStartBranchStationCatalog.map((station) => station.intent),
		);
		expect(intents).toEqual(
			new Set([
				"success",
				"repairable_failure",
				"success_after_repair",
				"success_after_retry",
				"diagnostic_failure",
			]),
		);
	});

	test("duplicate station ids fail catalog validation", () => {
		const drift = findBranchStationCatalogDrift({
			discovery: projectBrowserUseWarmStartStationDiscovery(),
			catalog: [
				...browserUseWarmStartBranchStationCatalog,
				browserUseWarmStartBranchStationCatalog[0],
			],
			path: "test",
		});

		expect(drift.map((entry) => entry.category)).toContain(
			"branch-station-id-duplicate",
		);
	});

	test("required uncovered stations remain visible before evidence", () => {
		const map = projectBrowserUseWarmStartStationMap();

		expect(map.stations).toHaveLength(browserUseWarmStartBranchStationCatalog.length);
		expect(map.findings).toHaveLength(browserUseWarmStartBranchStationCatalog.length);
		expect(new Set(map.findings.map((finding) => finding.finding_kind))).toEqual(
			new Set(["missing"]),
		);
	});

	test("projection keeps declared branch coverage scoped", () => {
		const map = projectStationMap({
			discovery: projectBrowserUseWarmStartStationDiscovery(),
			catalog: browserUseWarmStartBranchStationCatalog,
		});

		expect(map.completeness_claim).toBe("declared_branch_coverage");
		expect(JSON.stringify(map)).not.toContain("whole-program");
	});
});
