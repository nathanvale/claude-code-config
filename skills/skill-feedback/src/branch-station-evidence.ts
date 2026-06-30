// fallow-ignore-file unused-file
// Public Branch Station evidence seam; process-boundary tests consume this entrypoint.
import type {
	BranchStationEvidence,
	StationMap,
} from "@side-quest/cli-command-facade";
import { projectSkillFeedbackStationMap } from "./branch-station-catalog";

/**
 * V1 process-boundary evidence manifest for skill-feedback Branch Stations.
 */
export type SkillFeedbackBranchStationEvidence = BranchStationEvidence;

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
