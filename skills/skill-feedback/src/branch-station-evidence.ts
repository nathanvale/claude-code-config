// fallow-ignore-file unused-file, unused-export
// Public Branch Station evidence seam; process-boundary tests consume this entrypoint.
import type {
	BranchStation,
	BranchStationEvidence,
	StationMap,
} from "@side-quest/cli-command-facade";
import {
	projectSkillFeedbackStationMap,
	skillFeedbackBranchStationCatalog,
} from "./branch-station-catalog";

/**
 * V1 process-boundary evidence manifest for skill-feedback Branch Stations.
 */
export type SkillFeedbackBranchStationEvidence = BranchStationEvidence;

/**
 * Importable Station Map evidence manifest for the covered branch catalog.
 *
 * Process-boundary tests compare their live scenario evidence to this manifest
 * so the auditor can import deterministic coverage without running fixtures.
 */
// Public Branch Station seam; Fallow cannot see downstream evidence consumers.
export const skillFeedbackBranchStationEvidence =
	// fallow-ignore-next-line complexity
	(skillFeedbackBranchStationCatalog as readonly BranchStation[]).map((station) => ({
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
	})) satisfies readonly SkillFeedbackBranchStationEvidence[];

/**
 * Project skill-feedback Branch Station evidence into a Station Map.
 *
 * @param evidence - Test-owned evidence rows keyed by Branch Station id
 * @returns Deterministic Station Map JSON data
 */
// Public Branch Station seam; Fallow cannot see downstream evidence consumers.
// fallow-ignore-next-line unused-export
export function projectSkillFeedbackBranchStationEvidence(
	evidence: readonly SkillFeedbackBranchStationEvidence[],
): StationMap {
	return projectSkillFeedbackStationMap(evidence);
}

/**
 * List stations that still lack evidence after a process-boundary run.
 *
 * @param evidence - Test-owned evidence rows keyed by Branch Station id
 * @returns Canonically sorted station ids whose status is still missing
 */
// Public Branch Station seam; Fallow cannot see downstream evidence consumers.
// fallow-ignore-next-line unused-export
export function listMissingSkillFeedbackBranchStationEvidence(
	evidence: readonly SkillFeedbackBranchStationEvidence[],
): string[] {
	return projectSkillFeedbackStationMap(evidence)
		.findings.filter((finding) => finding.finding_kind === "missing")
		.map((finding) => finding.station_id)
		.sort();
}
