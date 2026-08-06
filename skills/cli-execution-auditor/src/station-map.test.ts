import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquireStationMapAssets,
	runStationMapAudit,
	stationFindingsFromMap,
} from "./station-map";
import {
	discoverStationCatalogPaths,
	frontDoorLabelForPath,
} from "./command-contract-discovery";

const FIXTURES = join(import.meta.dir, "fixtures");
const fixture = (name: string) => join(FIXTURES, name);
const cleanupPaths: string[] = [];
const STATION_ROW = {
	id: "check.success",
	command: "check",
	classification: "required",
	intent: "success",
	trigger: "successful check",
	mutationExpectation: "none",
};
const EVIDENCE_ROW = {
	stationId: "check.success",
	status: "covered",
};

afterEach(async () => {
	const paths = cleanupPaths.splice(0);
	await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
});

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

	test("discovers root and front-door Branch Station Catalogs in canonical order", async () => {
		const rootCatalogs = await discoverStationCatalogPaths(fixture("good-station-map-covered"));
		expect(rootCatalogs.map((path) => path.replace(`${fixture("good-station-map-covered")}/`, ""))).toEqual([
			"src/branch-station-catalog.ts",
		]);

		const frontDoorCatalogs = await discoverStationCatalogPaths(fixture("good-front-door-local"));
		expect(frontDoorCatalogs.map((path) => path.replace(`${fixture("good-front-door-local")}/`, ""))).toEqual([
			"src/front-doors/admin/branch-station-catalog.ts",
			"src/front-doors/app/branch-station-catalog.ts",
		]);
	});

	test("labels package-level and depth-N front-door source paths", () => {
		const root = fixture("good-front-door-local");

		expect(frontDoorLabelForPath(root, join(root, "src", "branch-station-catalog.ts"))).toBe(
			"root",
		);
		expect(
			frontDoorLabelForPath(
				root,
				join(root, "src", "front-doors", "admin", "users", "branch-station-catalog.ts"),
			),
		).toBe("admin/users");
		expect(
			frontDoorLabelForPath(
				root,
				`${root}/src/front-doors/admin\\users\\branch-station-catalog.ts`,
			),
		).toBe("admin/users");
	});

	test("non-facade target is skipped before catalog lookup", async () => {
		const root = await makeTempRoot();
		await writeFile(
			join(root, "package.json"),
			`${JSON.stringify({ name: "plain-package", type: "module" })}\n`,
		);
		await mkdir(join(root, "src"));

		const outcome = await runStationMapAudit({ targetRoot: root });

		expect(outcome.laneDetected).toBe(false);
		expect(outcome.catalogDetected).toBe(false);
		expect(outcome.skipReason).toContain("does not depend on");
		expect(outcome.findings).toEqual([]);
	});

	test("complete evidence produces canonical station order and no station findings", async () => {
		const outcome = await runStationMapAudit({
			targetRoot: fixture("good-station-map-covered"),
		});

		expect(outcome.catalogDetected).toBe(true);
		expect(outcome.catalogPath).toBe("src/branch-station-catalog.ts");
		expect(outcome.evidencePath).toBe("src/branch-station-evidence.ts");
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
				frontDoor: "root",
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

	test("front-door catalogs project independently and merge into one Station Map", async () => {
		const outcome = await runStationMapAudit({
			targetRoot: fixture("good-front-door-local"),
		});

		expect(outcome.catalogDetected).toBe(true);
		expect(outcome.frontDoors).toEqual(["admin", "app"]);
		expect(outcome.catalogPaths).toEqual([
			"src/front-doors/admin/branch-station-catalog.ts",
			"src/front-doors/app/branch-station-catalog.ts",
		]);
		expect(outcome.evidencePaths).toEqual([
			"src/front-doors/admin/branch-station-evidence.ts",
			"src/front-doors/app/branch-station-evidence.ts",
		]);
		expect(Object.keys(outcome.stationMap?.commands ?? {})).toEqual(["admin", "app"]);
		expect(outcome.stationMap?.stations.map((station) => station.station_id)).toEqual([
			"admin.success",
			"app.success",
		]);
		expect(outcome.findings).toEqual([]);
	});

	test("duplicate station ids across front-door catalogs become deterministic findings", async () => {
		const outcome = await runStationMapAudit({
			targetRoot: fixture("bad-front-door-duplicate-station"),
		});

		expect(outcome.catalogDetected).toBe(true);
		expect(outcome.stationMap).toBeUndefined();
		expect(outcome.findings).toEqual([
			{
				kind: "station",
				frontDoor: "app",
				stationId: "app.success",
				command: "app",
				findingKind: "drifted",
				summary:
					"duplicate Branch Station id app.success: declared in both src/front-doors/admin/branch-station-catalog.ts and src/front-doors/app/branch-station-catalog.ts",
			},
		]);
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

	test("station asset worker reports no catalog-shaped export", async () => {
		const root = await makeTempRoot();
		const catalogPath = join(root, "branch-station-catalog.ts");
		await writeFile(catalogPath, "export const unrelated = 1;\n");

		const acquisition = await acquireStationMapAssets({
			catalogPath,
			evidencePath: null,
		});

		expect(acquisition).toEqual({
			ok: false,
			reason:
				"no Branch Station Catalog export found (no array whose rows look like Branch Stations)",
		});
	});

	test("station asset worker reports ambiguous catalog and evidence exports", async () => {
		const root = await makeTempRoot();
		const catalogPath = join(root, "branch-station-catalog.ts");
		const evidencePath = join(root, "branch-station-evidence.ts");
		await writeArrayExports(catalogPath, "Catalog", STATION_ROW, 2);
		await writeArrayExports(evidencePath, "Evidence", EVIDENCE_ROW, 2);

		const ambiguousCatalog = await acquireStationMapAssets({
			catalogPath,
			evidencePath: null,
		});
		expect(ambiguousCatalog).toEqual({
			ok: false,
			reason: "ambiguous Branch Station Catalog: 2 shape-matching exports",
		});

		await writeArrayExports(catalogPath, "Catalog", STATION_ROW, 1);
		const ambiguousEvidence = await acquireStationMapAssets({
			catalogPath,
			evidencePath,
		});
		expect(ambiguousEvidence).toEqual({
			ok: false,
			reason: "ambiguous Branch Station evidence manifest: 2 shape-matching exports",
		});
	});

	test("station asset worker times out when an imported module hangs", async () => {
		const root = await makeTempRoot();
		const catalogPath = join(root, "branch-station-catalog.ts");
		await writeFile(catalogPath, "await new Promise(() => {});\n");

		const acquisition = await acquireStationMapAssets({
			catalogPath,
			evidencePath: null,
			timeoutMs: 50,
		});

		expect(acquisition).toEqual({
			ok: false,
			reason: "station asset worker timed out after 50ms",
		});
	});
});

async function makeTempRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "station-map-test-"));
	cleanupPaths.push(root);
	await mkdir(root, { recursive: true });
	return root;
}

async function writeArrayExports(
	path: string,
	label: string,
	row: Record<string, string>,
	count: number,
): Promise<void> {
	const serializedRow = JSON.stringify(row);
	const lines = Array.from(
		{ length: count },
		(_, index) => `export const ${label}${index + 1} = [${serializedRow}];`,
	);
	await writeFile(path, `${lines.join("\n")}\n`);
}
