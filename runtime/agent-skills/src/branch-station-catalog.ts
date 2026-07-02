import {
	type BranchStation,
	type BranchStationEvidence,
	findBranchStationCatalogDrift,
	projectCommandDiscoveryTree,
	projectStationMap,
} from "@side-quest/cli-command-facade";
import { agentSkillsContractEntries } from "./command-contract.ts";
import { AGENT_SKILLS_CONTRACT_ID } from "./model.ts";

/**
 * Initial Branch Station Catalog for agent-visible projection outcomes.
 */
export const agentSkillsBranchStationCatalog = [
	{
		id: "status.clean",
		command: "status",
		classification: "required",
		intent: "clean",
		trigger: "local projections match the visible catalog",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: AGENT_SKILLS_CONTRACT_ID,
		mutationExpectation: "read_only",
	},
	{
		id: "sync.needs_sync",
		command: "sync",
		classification: "required",
		intent: "needs_sync",
		trigger: "check mode finds missing or stale projection links",
		expectedExitCode: 1,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: AGENT_SKILLS_CONTRACT_ID,
		expectedActionId: "sync",
		mutationExpectation: "check_only",
	},
	{
		id: "sync.synced",
		command: "sync",
		classification: "required",
		intent: "synced",
		trigger: "sync writes projection links and snapshot successfully",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: AGENT_SKILLS_CONTRACT_ID,
		mutationExpectation: "writes_local_projection",
	},
	{
		id: "sync.unmanaged_blocker",
		command: "sync",
		classification: "required",
		intent: "unmanaged_blocker",
		trigger: "projection root contains a real entry or foreign symlink",
		expectedExitCode: 1,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: AGENT_SKILLS_CONTRACT_ID,
		expectedErrorCode: "unmanaged_blocker",
		expectedActionId: "inspect_blocker",
		mutationExpectation: "fails_closed_without_writes",
	},
	{
		id: "status.invalid_config",
		command: "status",
		classification: "required",
		intent: "invalid_config",
		trigger: "repo config has unsupported v1 shape",
		expectedExitCode: 1,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: AGENT_SKILLS_CONTRACT_ID,
		expectedErrorCode: "invalid_config",
		expectedActionId: "fix_config",
		mutationExpectation: "read_only",
	},
	{
		id: "sync.invalid_usage",
		command: "sync",
		classification: "required",
		intent: "invalid_usage",
		trigger: "argv contains unsupported command flags or missing operands",
		expectedExitCode: 2,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: AGENT_SKILLS_CONTRACT_ID,
		expectedErrorCode: "usage_error",
		mutationExpectation: "no_runtime_state_read",
	},
] as const satisfies readonly BranchStation[];

/**
 * Find drift between discovery metadata and the Branch Station Catalog.
 *
 * @param evidence - Optional test-owned coverage evidence
 * @returns Drift records from the facade station-map validator
 */
export function findAgentSkillsBranchStationCatalogDrift(
	evidence: readonly BranchStationEvidence[] = [],
) {
	return findBranchStationCatalogDrift({
		discovery: projectCommandDiscoveryTree(agentSkillsContractEntries),
		catalog: agentSkillsBranchStationCatalog,
		evidence,
		path: "runtime/agent-skills/src/branch-station-catalog.ts",
	});
}

/**
 * Project the package Station Map for reviewer inspection.
 *
 * @param evidence - Optional test-owned coverage evidence
 * @returns Station Map JSON model
 */
export function projectAgentSkillsStationMap(
	evidence: readonly BranchStationEvidence[] = [],
) {
	return projectStationMap({
		discovery: projectCommandDiscoveryTree(agentSkillsContractEntries),
		catalog: agentSkillsBranchStationCatalog,
		evidence,
		path: "runtime/agent-skills/src/branch-station-catalog.ts",
	});
}
