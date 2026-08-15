// Public Branch Station evidence seam; process-boundary tests (plan U5-U7) consume this entrypoint.
import type {
	BranchStation,
	BranchStationEvidence,
	StationMap,
} from "@side-quest/cli-command-facade";
import {
	projectWarmChromeStationMap,
	warmChromeBranchStationCatalog,
} from "./branch-station-catalog.ts";

/**
 * V1 process-boundary evidence row for warm-chrome Branch Stations.
 */
export type WarmChromeBranchStationEvidence = BranchStationEvidence;

/**
 * Importable expected-coverage manifest for the full 18-station catalog.
 *
 * Process-boundary tests (U5-U7) compare their live scenario evidence to this
 * manifest so the auditor can import deterministic coverage without running
 * fixtures. No station has live evidence yet; scenarios un-skip per unit.
 */
export const warmChromeBranchStationEvidence = (
	warmChromeBranchStationCatalog as readonly BranchStation[]
).map((station) => ({
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
})) satisfies readonly WarmChromeBranchStationEvidence[];

/**
 * Project warm-chrome Branch Station evidence into a Station Map.
 *
 * @param evidence - Test-owned evidence rows keyed by Branch Station id
 * @returns Deterministic Station Map JSON data
 */
export function projectWarmChromeBranchStationEvidence(
	evidence: readonly WarmChromeBranchStationEvidence[],
): StationMap {
	return projectWarmChromeStationMap(evidence);
}

/**
 * List stations that still lack evidence after a process-boundary run.
 *
 * @param evidence - Test-owned evidence rows keyed by Branch Station id
 * @returns Canonically sorted station ids whose status is still missing
 */
export function listMissingWarmChromeBranchStationEvidence(
	evidence: readonly WarmChromeBranchStationEvidence[],
): string[] {
	return projectWarmChromeStationMap(evidence)
		.findings.filter((finding) => finding.finding_kind === "missing")
		.map((finding) => finding.station_id)
		.sort();
}
