import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	acquireStationMapAssets,
	runStationMapAudit,
	stationFindingsFromMap,
} from "./station-map";

const FIXTURES = join(import.meta.dir, "fixtures");
const fixture = (name: string) => join(FIXTURES, name);

describe("Station Map engine", () => {
	test("target without a Branch Station Catalog reports informational no-catalog state", async () => {
		const outcome = await runStationMapAudit({
			targetRoot: fixture("good-baseline"),
		});

		expect(outcome.laneDetected).toBe(true);
		expect(outcome.catalogDetected).toBe(false);
		expect(outcome.skipReason).toContain("no Branch Station Catalog");
		expect(outcome.findings).toEqual([]);
	});

	test("complete evidence produces canonical station order and no station findings", async () => {
		const outcome = await runStationMapAudit({
			targetRoot: fixture("good-station-map-covered"),
		});

		expect(outcome.catalogDetected).toBe(true);
		expect(outcome.stationMap?.completeness_claim).toBe("declared_branch_coverage");
		expect(outcome.stationMap?.stations.map((station) => station.station_id)).toEqual([
			"check.alpha",
			"check.zeta",
		]);
		expect(outcome.stationMap?.findings).toEqual([]);
		expect(outcome.findings).toEqual([]);
		expect(JSON.stringify(outcome.stationMap)).not.toContain("TypeScript branch");
	});

	test("required stations with no evidence become station findings", async () => {
		const outcome = await runStationMapAudit({
			targetRoot: fixture("bad-station-map-missing"),
		});

		expect(outcome.catalogDetected).toBe(true);
		expect(outcome.stationMap?.findings.map((finding) => finding.finding_kind)).toEqual([
			"missing",
		]);
		expect(outcome.findings).toEqual([
			{
				kind: "station",
				stationId: "check.success",
				command: "check",
				findingKind: "missing",
				summary: "check.success is missing for declared_branch_coverage.",
			},
		]);
	});

	test("optional station findings stay visible in JSON but not auditor findings", async () => {
		const stationMap = {
			completeness_claim: "declared_branch_coverage" as const,
			commands: {
				check: { station_ids: ["check.optional"] },
			},
			stations: [
				{
					station_id: "check.optional",
					command: "check",
					classification: "optional" as const,
					intent: "diagnostic",
					trigger: "optional diagnostic branch",
					mutation_expectation: "none",
					expected: {},
					evidence: { status: "missing" as const },
				},
			],
			drift: [],
			findings: [
				{
					station_id: "check.optional",
					command: "check",
					finding_kind: "missing" as const,
					summary: "check.optional is missing for declared_branch_coverage.",
				},
			],
		};

		expect(stationFindingsFromMap(stationMap)).toEqual([]);
	});

	test("station asset worker reports no evidence when the evidence module has no manifest", async () => {
		const catalogPath = join(
			import.meta.dir,
			"..",
			"..",
			"skill-feedback",
			"src",
			"branch-station-catalog.ts",
		);
		const evidencePath = join(
			import.meta.dir,
			"..",
			"..",
			"skill-feedback",
			"src",
			"branch-station-evidence.ts",
		);

		const acquisition = await acquireStationMapAssets({ catalogPath, evidencePath });
		expect(acquisition.ok).toBe(true);
		if (!acquisition.ok) return;
		expect(acquisition.catalog.length).toBeGreaterThan(0);
		expect(acquisition.evidence).toEqual([]);
	});
});
