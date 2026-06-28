import {
	type BranchStation,
	type BranchStationEvidence,
	findBranchStationCatalogDrift,
	projectCommandDiscoveryTree,
	projectStationMap,
	type StationMap,
} from "@side-quest/cli-command-facade";
import {
	SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
	SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
	SKILL_FEEDBACK_CONTRACT_ID,
	SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
	SKILL_FEEDBACK_PURGE_CONTRACT_ID,
	SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
	type SkillFeedbackCommand,
	skillFeedbackContracts,
} from "./command-contract";

/**
 * Planning-stage Branch Station seed ids for the skill-feedback pilot.
 *
 * Keep this list in code so tests can prove the package catalog implemented
 * the plan's first station set before integration rows add evidence.
 */
export const SKILL_FEEDBACK_PLANNING_BRANCH_STATION_IDS = [
	"record.success",
	"record.proof_attached",
	"record.proof_unavailable",
	"record.invalid_usage",
	"closeout.success_stdin",
	"closeout.proof_attached",
	"closeout.proof_unavailable",
	"closeout.invalid_receipt",
	"review.empty_inbox",
	"review.target_resolution_failed",
	"health.populated_inbox",
	"health.proof_diagnostics",
	"health.correlation_witness_diagnostics",
	"health.unsafe_inbox",
	"purge.preview",
	"purge.execute",
	"purge.invalid_usage",
	"correlate.preview_repairable",
	"correlate.execute_written",
	"correlate.already_linked",
	"correlate.ambiguous",
	"correlate.insufficient_evidence",
	"correlate.unsafe_inbox",
	"correlate.invalid_usage",
] as const;

/**
 * Package-owned Branch Station Catalog for the skill-feedback CLI.
 *
 * The catalog names branch meaning and expectations only. Tests own setup,
 * probes, and evidence rows keyed by `station.id`.
 */
export const skillFeedbackBranchStationCatalog = [
	{
		id: "record.success",
		command: "record",
		classification: "required",
		intent: "success",
		trigger: "valid record receipt writes one Software Learning Report",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_CONTRACT_ID,
		mutationExpectation: "writes_report",
	},
	{
		id: "record.proof_attached",
		command: "record",
		classification: "required",
		intent: "success",
		trigger: "valid record receipt writes schema 2 report with writer proof",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_CONTRACT_ID,
		mutationExpectation: "writes_report",
	},
	{
		id: "record.proof_unavailable",
		command: "record",
		classification: "required",
		intent: "success",
		trigger: "unusable local trust key writes evidence-only record report",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_CONTRACT_ID,
		mutationExpectation: "writes_report",
	},
	{
		id: "record.invalid_usage",
		command: "record",
		classification: "required",
		intent: "usage_failure",
		trigger: "missing generated_ts record flag fails before write",
		expectedExitCode: 2,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: SKILL_FEEDBACK_CONTRACT_ID,
		expectedErrorCode: "invalid_generated_ts",
		mutationExpectation: "blocked_before_write",
	},
	{
		id: "closeout.success_stdin",
		command: "closeout",
		classification: "required",
		intent: "success",
		trigger: "valid closeout receipt from stdin writes one report",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
		mutationExpectation: "writes_report",
	},
	{
		id: "closeout.proof_attached",
		command: "closeout",
		classification: "required",
		intent: "success",
		trigger: "valid closeout receipt writes schema 2 report with writer proof",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
		mutationExpectation: "writes_report",
	},
	{
		id: "closeout.proof_unavailable",
		command: "closeout",
		classification: "required",
		intent: "success",
		trigger: "unusable local trust key writes evidence-only closeout report",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
		mutationExpectation: "writes_report",
	},
	{
		id: "closeout.invalid_receipt",
		command: "closeout",
		classification: "required",
		intent: "usage_failure",
		trigger: "invalid closeout stdin receipt fails before write",
		expectedExitCode: 2,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
		expectedErrorCode: "invalid_closeout_receipt",
		mutationExpectation: "blocked_before_write",
	},
	{
		id: "review.empty_inbox",
		command: "review",
		classification: "required",
		intent: "success",
		trigger: "empty inbox reports zero review items",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
		mutationExpectation: "none",
	},
	{
		id: "review.target_resolution_failed",
		command: "review",
		classification: "required",
		intent: "runtime_failure",
		trigger: "read target outside a repository fails with target resolution data",
		expectedExitCode: 1,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
		expectedErrorCode: "read_target_resolution_failed",
		mutationExpectation: "none",
	},
	{
		id: "health.populated_inbox",
		command: "health",
		classification: "required",
		intent: "observability",
		trigger: "populated inbox reports populated health status",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
		mutationExpectation: "none",
	},
	{
		id: "health.proof_diagnostics",
		command: "health",
		classification: "required",
		intent: "observability",
		trigger: "unusable trust key surfaces proof diagnostics without mutating inbox",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
		mutationExpectation: "none",
	},
	{
		id: "health.correlation_witness_diagnostics",
		command: "health",
		classification: "required",
		intent: "observability",
		trigger: "orphan correlation witness surfaces witness diagnostics",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
		mutationExpectation: "none",
	},
	{
		id: "health.unsafe_inbox",
		command: "health",
		classification: "required",
		intent: "runtime_failure",
		trigger: "unsafe inbox root reports blocked health readiness",
		expectedExitCode: 1,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
		expectedErrorCode: "health_inbox_unsafe",
		mutationExpectation: "none",
	},
	{
		id: "purge.preview",
		command: "purge",
		classification: "required",
		intent: "success",
		trigger: "purge retention selector previews selected reports",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
		mutationExpectation: "none",
	},
	{
		id: "purge.execute",
		command: "purge",
		classification: "required",
		intent: "success",
		trigger: "explicit purge execute deletes selected safe reports",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
		mutationExpectation: "deletes_reports",
	},
	{
		id: "purge.invalid_usage",
		command: "purge",
		classification: "required",
		intent: "usage_failure",
		trigger: "missing purge retention selector fails before write",
		expectedExitCode: 2,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
		expectedErrorCode: "usage_error",
		mutationExpectation: "blocked_before_write",
	},
	{
		id: "correlate.preview_repairable",
		command: "correlate",
		classification: "required",
		intent: "success",
		trigger: "correlate preview finds one repairable private witness gap",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
		mutationExpectation: "none",
	},
	{
		id: "correlate.execute_written",
		command: "correlate",
		classification: "required",
		intent: "success",
		trigger: "explicit correlate execute writes one validated witness",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
		mutationExpectation: "writes_correlation_witness",
	},
	{
		id: "correlate.already_linked",
		command: "correlate",
		classification: "required",
		intent: "success",
		trigger: "existing valid witness reports already linked without duplicate write",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
		mutationExpectation: "none",
	},
	{
		id: "correlate.ambiguous",
		command: "correlate",
		classification: "required",
		intent: "observability",
		trigger: "multiple eligible closeouts block witness repair",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
		mutationExpectation: "none",
	},
	{
		id: "correlate.insufficient_evidence",
		command: "correlate",
		classification: "required",
		intent: "observability",
		trigger: "sparse missing-candidate diagnostic reports no repair available",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
		mutationExpectation: "none",
	},
	{
		id: "correlate.unsafe_inbox",
		command: "correlate",
		classification: "required",
		intent: "runtime_failure",
		trigger: "unsafe correlation directory fails before repair write",
		expectedExitCode: 1,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
		expectedErrorCode: "correlate_repair_state_error",
		mutationExpectation: "blocked_before_write",
	},
	{
		id: "correlate.invalid_usage",
		command: "correlate",
		classification: "required",
		intent: "usage_failure",
		trigger: "unsupported correlate argv fails before read or write",
		expectedExitCode: 2,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
		expectedErrorCode: "usage_error",
		mutationExpectation: "blocked_before_write",
	},
] as const satisfies readonly BranchStation[];

const skillFeedbackContractEntries = Object.entries(skillFeedbackContracts) as Array<
	[SkillFeedbackCommand, (typeof skillFeedbackContracts)[SkillFeedbackCommand]]
>;

/**
 * Project skill-feedback command discovery for Station Map reconciliation.
 *
 * @returns Facade discovery tree for the public skill-feedback commands
 */
export function projectSkillFeedbackStationDiscovery() {
	return projectCommandDiscoveryTree(skillFeedbackContractEntries);
}

/**
 * Validate the skill-feedback Branch Station Catalog against live contracts.
 *
 * @param evidence - Optional evidence rows to validate with the catalog
 * @returns Deterministic drift records
 */
export function findSkillFeedbackBranchStationCatalogDrift(
	evidence: readonly BranchStationEvidence[] = [],
) {
	return findBranchStationCatalogDrift({
		discovery: projectSkillFeedbackStationDiscovery(),
		catalog: skillFeedbackBranchStationCatalog,
		evidence,
		path: "skills/skill-feedback/src/branch-station-catalog.ts",
	});
}

/**
 * Project the skill-feedback Station Map from catalog plus evidence.
 *
 * @param evidence - Test-owned station evidence manifest
 * @returns Deterministic Station Map JSON data
 */
export function projectSkillFeedbackStationMap(
	evidence: readonly BranchStationEvidence[] = [],
): StationMap {
	return projectStationMap({
		discovery: projectSkillFeedbackStationDiscovery(),
		catalog: skillFeedbackBranchStationCatalog,
		evidence,
		path: "skills/skill-feedback/src/branch-station-catalog.ts",
	});
}
