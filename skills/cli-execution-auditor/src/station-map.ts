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
	evidencePath?: string;
	stationMap?: StationMap;
	findings: StationFinding[];
	ledgerPath?: string;
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

	const catalogPath = join(layout.root, "src", "branch-station-catalog.ts");
	if (!existsSync(catalogPath)) {
		return {
			target,
			laneDetected: true,
			catalogDetected: false,
			skipReason: "no Branch Station Catalog found at src/branch-station-catalog.ts",
			findings: [],
		};
	}

	const evidencePath = join(layout.root, "src", "branch-station-evidence.ts");
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
			skipReason: `Branch Station assets could not load: ${acquisition.reason}`,
			findings: [],
		};
	}

	const discovery = projectCommandDiscoveryTree(
		// biome-ignore lint/suspicious/noExplicitAny: acquired target contract is validated foreign data.
		Object.entries(staticOutcome.contracts) as any,
	);
	const stationMap = projectStationMap({
		discovery,
		catalog: acquisition.catalog,
		evidence: acquisition.evidence,
		path: relative(layout.root, catalogPath),
	});
	return {
		target,
		laneDetected: true,
		catalogDetected: true,
		catalogPath: relative(layout.root, catalogPath),
		...(existsSync(evidencePath)
			? { evidencePath: relative(layout.root, evidencePath) }
			: {}),
		stationMap,
		findings: stationFindingsFromMap(stationMap),
	};
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

export function stationFindingsFromMap(stationMap: StationMap): StationFinding[] {
	const requiredStationIds = new Set(
		stationMap.stations
			.filter((station) => station.classification === "required")
			.map((station) => station.station_id),
	);
	return stationMap.findings
		.filter((finding) => requiredStationIds.has(finding.station_id))
		.map((finding) => ({
			kind: "station" as const,
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
