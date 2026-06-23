import {
	type BranchStation,
	type BranchStationEvidence,
	findBranchStationCatalogDrift,
	projectCommandDiscoveryTree,
	projectStationMap,
	type StationMap,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_WARM_START_CONTRACT_ID,
	type BrowserUseCommand,
	browserUseContracts,
} from "./command-contract";

/**
 * Planning Branch Station ids for browser-use warm start.
 *
 * These ids name package branch intent. Scenario setup lives in tests.
 */
export const BROWSER_USE_WARM_START_BRANCH_STATION_IDS = [
	"warm-start.ready",
	"warm-start.stale_config",
	"warm-start.repair_config",
	"warm-start.sticky_daemon_retry",
	"warm-start.inspect_diagnostics",
] as const;

/**
 * Package-owned Branch Station Catalog for `browser-use warm start`.
 *
 * Catalog rows declare deterministic outcomes only; tests own fixtures and
 * evidence collection.
 */
export const browserUseWarmStartBranchStationCatalog = [
	{
		id: "warm-start.ready",
		command: "warm-start",
		classification: "required",
		intent: "success",
		trigger: "Warm Chrome and chrome-devtools are already healthy",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_USE_WARM_START_CONTRACT_ID,
		expectedContinuationId: "warm-stack-ready",
		mutationExpectation: "may_launch_or_reuse_browser",
	},
	{
		id: "warm-start.stale_config",
		command: "warm-start",
		classification: "required",
		intent: "repairable_failure",
		trigger: "selected mcporter chrome-devtools config points at a stale port",
		expectedExitCode: 20,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_USE_WARM_START_CONTRACT_ID,
		expectedErrorCode: "warm_start_adapter_config_stale",
		expectedContinuationId: "repair-adapter-config",
		mutationExpectation: "no_config_write_without_flag",
	},
	{
		id: "warm-start.repair_config",
		command: "warm-start",
		classification: "required",
		intent: "success_after_repair",
		trigger: "explicit repair mode updates selected mcporter config and proof passes",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_USE_WARM_START_CONTRACT_ID,
		expectedContinuationId: "warm-stack-ready",
		mutationExpectation: "writes_selected_mcporter_config",
	},
	{
		id: "warm-start.sticky_daemon_retry",
		command: "warm-start",
		classification: "required",
		intent: "success_after_retry",
		trigger: "adapter page proof fails once with matching config, daemon restart succeeds",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_USE_WARM_START_CONTRACT_ID,
		expectedContinuationId: "warm-stack-ready",
		mutationExpectation: "restarts_mcporter_daemon_once",
	},
	{
		id: "warm-start.inspect_diagnostics",
		command: "warm-start",
		classification: "required",
		intent: "diagnostic_failure",
		trigger: "adapter timeout or unparsable output requires diagnostics",
		expectedExitCode: 20,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_USE_WARM_START_CONTRACT_ID,
		expectedErrorCode: "warm_start_adapter_output_failed",
		expectedContinuationId: "inspect-adapter-diagnostics",
		mutationExpectation: "no_daemon_restart",
	},
] as const satisfies readonly BranchStation[];

const browserUseContractEntries = Object.entries(browserUseContracts) as Array<
	[BrowserUseCommand, (typeof browserUseContracts)[BrowserUseCommand]]
>;

/**
 * Project browser-use discovery for Station Map reconciliation.
 *
 * @returns Facade discovery tree for browser-use commands
 */
export function projectBrowserUseWarmStartStationDiscovery() {
	return projectCommandDiscoveryTree(browserUseContractEntries);
}

/**
 * Validate warm-start Branch Station catalog drift against live contracts.
 *
 * @param evidence - Optional evidence rows to validate with the catalog
 * @returns Deterministic drift records
 */
export function findBrowserUseWarmStartBranchStationCatalogDrift(
	evidence: readonly BranchStationEvidence[] = [],
) {
	return findBranchStationCatalogDrift({
		discovery: projectBrowserUseWarmStartStationDiscovery(),
		catalog: browserUseWarmStartBranchStationCatalog,
		evidence,
		path: "skills/browser-use/src/browser-use-warm-station-catalog.ts",
	});
}

/**
 * Project warm-start Station Map from catalog plus evidence.
 *
 * @param evidence - Test-owned station evidence rows
 * @returns Deterministic Station Map JSON data
 */
export function projectBrowserUseWarmStartStationMap(
	evidence: readonly BranchStationEvidence[] = [],
): StationMap {
	return projectStationMap({
		discovery: projectBrowserUseWarmStartStationDiscovery(),
		catalog: browserUseWarmStartBranchStationCatalog,
		evidence,
		path: "skills/browser-use/src/browser-use-warm-station-catalog.ts",
	});
}
