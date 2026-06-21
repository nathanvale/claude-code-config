// station-map - deterministic Branch Station reconciliation for facade-backed CLIs.

import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
	type BranchStation,
	type BranchStationEvidence,
	projectCommandDiscoveryTree,
	projectStationMap,
	type StationMap,
	type StationMapFinding,
} from "@side-quest/cli-command-facade";
import { resolveTargetLayout, runStaticAudit } from "./audit-engine.ts";
import {
	discoverStationCatalogPaths,
	frontDoorLabelForPath,
	ROOT_FRONT_DOOR,
} from "./command-contract-discovery.ts";

const ACQUIRE_STATION_MAP_WORKER = join(
	dirname(Bun.fileURLToPath(import.meta.url)),
	"acquire-station-map-worker.ts",
);
const STATION_MAP_ASSET_WORKER_TIMEOUT_MS = 10_000;

export type StationMapAssetAcquisition =
	| {
			ok: true;
			catalog: readonly BranchStation[];
			evidence: readonly BranchStationEvidence[];
	  }
	| {
			ok: false;
			reason: string;
	  };

export interface StationFinding {
	kind: "station";
	frontDoor: string;
	stationId: string;
	command: string;
	findingKind: StationMapFinding["finding_kind"];
	summary: string;
}

export interface StationMapOutcome {
	target: string;
	laneDetected: boolean;
	catalogDetected: boolean;
	skipReason?: string;
	catalogPath?: string;
	catalogPaths?: string[];
	evidencePath?: string;
	evidencePaths?: string[];
	stationMap?: StationMap;
	findings: StationFinding[];
	ledgerPath?: string;
	ledgerPaths?: string[];
	frontDoors?: string[];
}

export async function runStationMapAudit(input: {
	targetRoot: string;
}): Promise<StationMapOutcome> {
	const targetRoot = resolve(input.targetRoot);
	const target = basename(targetRoot);
	const layout = await resolveTargetLayout(targetRoot);
	const staticOutcome = await runStaticAudit({ targetRoot, only: null });

	if (!staticOutcome.laneDetected) {
		return {
			target,
			laneDetected: false,
			catalogDetected: false,
			skipReason: staticOutcome.skipReason,
			findings: [],
		};
	}

	if (!staticOutcome.contracts) {
		return {
			target,
			laneDetected: true,
			catalogDetected: false,
			skipReason: "facade contract acquisition failed; Station Map unavailable",
			findings: [],
		};
	}

	const catalogPaths = await discoverStationCatalogPaths(layout.root);
	if (catalogPaths.length === 0) {
		return {
			target,
			laneDetected: true,
			catalogDetected: false,
			skipReason:
				"no Branch Station Catalog found at src/branch-station-catalog.ts or src/front-doors/**/branch-station-catalog.ts",
			findings: [],
		};
	}

	const acquisitions: CatalogAcquisition[] = [];
	for (const catalogPath of catalogPaths) {
		const evidencePath = evidencePathForCatalog(layout.root, catalogPath);
		const acquisition = await acquireStationMapAssets({
			catalogPath,
			evidencePath: existsSync(evidencePath) ? evidencePath : null,
		});
		if (!acquisition.ok) {
			return {
				target,
				laneDetected: true,
				catalogDetected: true,
				catalogPath: relative(layout.root, catalogPath),
				...(existsSync(evidencePath)
					? { evidencePath: relative(layout.root, evidencePath) }
					: {}),
				skipReason: `Branch Station assets could not load: ${relative(layout.root, catalogPath)}: ${acquisition.reason}`,
				findings: [],
				frontDoors: [frontDoorLabelForPath(layout.root, catalogPath)],
			};
		}
		acquisitions.push({
			frontDoor: frontDoorLabelForPath(layout.root, catalogPath),
			catalogPath,
			evidencePath: existsSync(evidencePath) ? evidencePath : null,
			catalog: acquisition.catalog,
			evidence: acquisition.evidence,
		});
	}

	const duplicateFindings = crossCatalogStationIdFindings(acquisitions, layout.root);
	if (duplicateFindings.length > 0) {
		return {
			target,
			laneDetected: true,
			catalogDetected: true,
			catalogPaths: catalogPaths.map((path) => relative(layout.root, path)),
			evidencePaths: acquisitions
				.flatMap((acquisition) =>
					acquisition.evidencePath ? [relative(layout.root, acquisition.evidencePath)] : [],
				)
				.sort(),
			findings: duplicateFindings,
			frontDoors: uniqueSorted(acquisitions.map((acquisition) => acquisition.frontDoor)),
		};
	}

	const maps = acquisitions.map((acquisition) => {
		const contracts =
			staticOutcome.contractSurfaces?.find(
				(surface) => surface.frontDoor === acquisition.frontDoor,
			)?.contracts ?? {};
		const discovery = projectCommandDiscoveryTree(
			// biome-ignore lint/suspicious/noExplicitAny: acquired target contract is validated foreign data.
			Object.entries(contracts) as any,
		);
		const stationMap = projectStationMap({
			discovery,
			catalog: acquisition.catalog,
			evidence: acquisition.evidence,
			path: relative(layout.root, acquisition.catalogPath),
		});
		return { ...acquisition, stationMap };
	});
	const stationMap = mergeStationMaps(maps.map((map) => map.stationMap));
	return {
		target,
		laneDetected: true,
		catalogDetected: true,
		...(catalogPaths.length === 1 ? { catalogPath: relative(layout.root, catalogPaths[0]) } : {}),
		catalogPaths: catalogPaths.map((path) => relative(layout.root, path)),
		evidencePaths: maps
			.flatMap((map) => (map.evidencePath ? [relative(layout.root, map.evidencePath)] : []))
			.sort(),
		stationMap,
		findings: maps.flatMap((map) => stationFindingsFromMap(map.stationMap, map.frontDoor)),
		frontDoors: uniqueSorted(maps.map((map) => map.frontDoor)),
	};
}

interface CatalogAcquisition {
	frontDoor: string;
	catalogPath: string;
	evidencePath: string | null;
	catalog: readonly BranchStation[];
	evidence: readonly BranchStationEvidence[];
}

function evidencePathForCatalog(root: string, catalogPath: string): string {
	const frontDoor = frontDoorLabelForPath(root, catalogPath);
	if (frontDoor === ROOT_FRONT_DOOR) {
		return join(root, "src", "branch-station-evidence.ts");
	}
	return join(root, "src", "front-doors", frontDoor, "branch-station-evidence.ts");
}

function crossCatalogStationIdFindings(
	acquisitions: readonly CatalogAcquisition[],
	root: string,
): StationFinding[] {
	const seen: Record<string, { path: string; frontDoor: string; command: string }> = {};
	const findings: StationFinding[] = [];
	for (const acquisition of acquisitions) {
		for (const station of acquisition.catalog) {
			const existing = seen[station.id];
			if (existing) {
				findings.push({
					kind: "station",
					frontDoor: acquisition.frontDoor,
					stationId: station.id,
					command: station.command,
					findingKind: "drifted",
					summary: `duplicate Branch Station id ${station.id}: declared in both ${existing.path} and ${relative(root, acquisition.catalogPath)}`,
				});
				continue;
			}
			seen[station.id] = {
				path: relative(root, acquisition.catalogPath),
				frontDoor: acquisition.frontDoor,
				command: station.command,
			};
		}
	}
	return findings.sort(
		(left, right) =>
			left.stationId.localeCompare(right.stationId) ||
			left.frontDoor.localeCompare(right.frontDoor),
	);
}

function mergeStationMaps(stationMaps: readonly StationMap[]): StationMap {
	const commands: Record<string, StationMap["commands"][string]> = {};
	for (const map of stationMaps) {
		for (const [command, value] of Object.entries(map.commands)) {
			const existing = commands[command];
			commands[command] = {
				...(value.summary || existing?.summary
					? { summary: value.summary ?? existing?.summary }
					: {}),
				station_ids: uniqueSorted([...(existing?.station_ids ?? []), ...value.station_ids]),
			};
		}
	}
	return {
		completeness_claim: "declared_branch_coverage",
		commands: Object.fromEntries(Object.entries(commands).sort(([a], [b]) => a.localeCompare(b))),
		stations: stationMaps
			.flatMap((map) => [...map.stations])
			.sort(
				(left, right) =>
					left.station_id.localeCompare(right.station_id) ||
					left.command.localeCompare(right.command),
			),
		drift: stationMaps.flatMap((map) => [...map.drift]),
		findings: stationMaps
			.flatMap((map) => [...map.findings])
			.sort(
				(left, right) =>
					left.station_id.localeCompare(right.station_id) ||
					left.command.localeCompare(right.command) ||
					left.finding_kind.localeCompare(right.finding_kind),
			),
	};
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

export async function acquireStationMapAssets(input: {
	catalogPath: string;
	evidencePath: string | null;
	timeoutMs?: number;
}): Promise<StationMapAssetAcquisition> {
	const timeoutMs = input.timeoutMs ?? STATION_MAP_ASSET_WORKER_TIMEOUT_MS;
	const proc = Bun.spawn(
		[
			"bun",
			"run",
			ACQUIRE_STATION_MAP_WORKER,
			input.catalogPath,
			input.evidencePath ?? "--no-evidence",
		],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		proc.kill("SIGKILL");
	}, timeoutMs);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]).finally(() => clearTimeout(timeout));

	if (timedOut) {
		return {
			ok: false,
			reason: `station asset worker timed out after ${timeoutMs}ms`,
		};
	}

	if (exitCode !== 0) {
		return {
			ok: false,
			reason: stderr.trim() || `station asset worker exited ${exitCode}`,
		};
	}

	try {
		return JSON.parse(stdout) as StationMapAssetAcquisition;
	} catch {
		return { ok: false, reason: "station asset worker produced unparseable output" };
	}
}

export function stationFindingsFromMap(
	stationMap: StationMap,
	frontDoor = ROOT_FRONT_DOOR,
): StationFinding[] {
	const requiredStationIds = new Set(
		stationMap.stations
			.filter((station) => station.classification === "required")
			.map((station) => station.station_id),
	);
	return stationMap.findings
		.filter((finding) => requiredStationIds.has(finding.station_id))
		.map((finding) => ({
			kind: "station" as const,
			frontDoor,
			stationId: finding.station_id,
			command: finding.command,
			findingKind: finding.finding_kind,
			summary: finding.summary,
		}))
		.sort(
			(left, right) =>
				left.stationId.localeCompare(right.stationId) ||
				left.command.localeCompare(right.command) ||
				left.findingKind.localeCompare(right.findingKind),
		);
}
