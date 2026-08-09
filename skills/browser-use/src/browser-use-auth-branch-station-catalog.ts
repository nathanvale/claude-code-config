import {
	type BranchStation,
	type BranchStationEvidence,
	findBranchStationCatalogDrift,
	projectCommandDiscoveryTree,
	projectStationMap,
	type StationMap,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_SHARED_RUN_CONTRACT_ID,
	browserUseContracts,
} from "./command-contract";

const CATALOG_PATH =
	"skills/browser-use/src/browser-use-auth-branch-station-catalog.ts";

export const browserUseAuthBranchStationCatalog = [
	{
		id: "auth-login.help",
		command: "auth-login",
		classification: "required",
		intent: "discovery",
		trigger: "leaf help renders the bounded freeform authentication contract",
		expectedExitCode: 0,
		mutationExpectation: "no_runtime_state_read",
	},
	{
		id: "auth-login.authority_unavailable",
		command: "auth-login",
		classification: "required",
		intent: "typed_recovery",
		trigger:
			"neither managed nor user-present access authority is available before browser delivery",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_USE_SHARED_RUN_CONTRACT_ID,
		expectedActionId: "enroll-browser-automation-token",
		expectedContinuationId: "enroll-browser-automation-token",
		mutationExpectation: "persists_awaiting_auth_without_browser_delivery",
	},
	{
		id: "auth-login.success",
		command: "auth-login",
		classification: "required",
		intent: "success",
		trigger:
			"verified handoff, exact origin, approved binding, exactly-one-vault proof, confidential delivery, and session proof all succeed",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_USE_SHARED_RUN_CONTRACT_ID,
		expectedActionId: "inspect_shared_run",
		expectedContinuationId: "inspect_shared_run",
		mutationExpectation: "persists_ready_after_confidential_browser_authentication",
	},
] as const satisfies readonly BranchStation[];

export type BrowserUseAuthBranchStationId =
	(typeof browserUseAuthBranchStationCatalog)[number]["id"];

function discovery() {
	return projectCommandDiscoveryTree(Object.entries(browserUseContracts));
}

export function findBrowserUseAuthBranchStationCatalogDrift(
	evidence: readonly BranchStationEvidence[] = [],
) {
	return findBranchStationCatalogDrift({
		discovery: discovery(),
		catalog: browserUseAuthBranchStationCatalog,
		evidence,
		path: CATALOG_PATH,
	});
}

export function projectBrowserUseAuthStationMap(
	evidence: readonly BranchStationEvidence[] = [],
): StationMap {
	return projectStationMap({
		discovery: discovery(),
		catalog: browserUseAuthBranchStationCatalog,
		evidence,
		path: CATALOG_PATH,
	});
}
