#!/usr/bin/env bun
// acquire-station-map-worker - import a target's Branch Station catalog and
// optional evidence manifest in a subprocess.

import type {
	BranchStation,
	BranchStationEvidence,
} from "@side-quest/cli-command-facade";
import type { StationMapAssetAcquisition } from "./station-map.ts";

type ShapeResult<T> =
	| { kind: "found"; value: T }
	| { kind: "none" }
	| { kind: "ambiguous"; count: number };

async function main(): Promise<void> {
	const catalogPath = Bun.argv[2];
	const evidencePath = Bun.argv[3] === "--no-evidence" ? null : Bun.argv[3];
	if (!catalogPath) {
		process.stderr.write("acquire-station-map-worker: missing catalog path argument\n");
		process.exit(2);
	}

	const catalogModule = (await import(catalogPath)) as Record<string, unknown>;
	const catalog = findCatalogByShape(catalogModule);
	if (catalog.kind === "none") {
		writeResult({
			ok: false,
			reason:
				"no Branch Station Catalog export found (no array whose rows look like Branch Stations)",
		});
		return;
	}
	if (catalog.kind === "ambiguous") {
		writeResult({
			ok: false,
			reason: `ambiguous Branch Station Catalog: ${catalog.count} shape-matching exports`,
		});
		return;
	}

	let evidence: readonly BranchStationEvidence[] = [];
	if (evidencePath) {
		const evidenceModule = (await import(evidencePath)) as Record<string, unknown>;
		const evidenceResult = findEvidenceByShape(evidenceModule);
		if (evidenceResult.kind === "ambiguous") {
			writeResult({
				ok: false,
				reason: `ambiguous Branch Station evidence manifest: ${evidenceResult.count} shape-matching exports`,
			});
			return;
		}
		if (evidenceResult.kind === "found") evidence = evidenceResult.value;
	}

	writeResult({ ok: true, catalog: catalog.value, evidence });
}

function writeResult(result: StationMapAssetAcquisition): void {
	process.stdout.write(JSON.stringify(result));
}

function findCatalogByShape(
	moduleExports: Record<string, unknown>,
): ShapeResult<readonly BranchStation[]> {
	const matches: Array<readonly BranchStation[]> = [];
	for (const value of Object.values(moduleExports)) {
		if (!Array.isArray(value)) continue;
		if (value.length === 0) continue;
		if (value.every(isBranchStationShape)) {
			matches.push(value as readonly BranchStation[]);
		}
	}
	return singleMatch(matches);
}

function findEvidenceByShape(
	moduleExports: Record<string, unknown>,
): ShapeResult<readonly BranchStationEvidence[]> {
	const matches: Array<readonly BranchStationEvidence[]> = [];
	for (const value of Object.values(moduleExports)) {
		if (!Array.isArray(value)) continue;
		if (value.length === 0) continue;
		if (value.every(isBranchStationEvidenceShape)) {
			matches.push(value as readonly BranchStationEvidence[]);
		}
	}
	return singleMatch(matches);
}

function singleMatch<T>(matches: readonly T[]): ShapeResult<T> {
	if (matches.length === 0) return { kind: "none" };
	if (matches.length > 1) return { kind: "ambiguous", count: matches.length };
	return { kind: "found", value: matches[0] };
}

function isBranchStationShape(value: unknown): value is BranchStation {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.id === "string" &&
		typeof record.command === "string" &&
		typeof record.classification === "string" &&
		typeof record.intent === "string" &&
		typeof record.trigger === "string" &&
		typeof record.mutationExpectation === "string"
	);
}

function isBranchStationEvidenceShape(
	value: unknown,
): value is BranchStationEvidence {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return typeof record.stationId === "string" && typeof record.status === "string";
}

await main();
