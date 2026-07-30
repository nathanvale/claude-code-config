// Public Branch Station seam; package tests and later units consume this entrypoint.
import {
	type BranchStation,
	type BranchStationEvidence,
	findBranchStationCatalogDrift,
	projectStationMap,
	type StationMap,
} from "@side-quest/cli-command-facade";
import { projectWarmChromeCommandDiscoveryTree } from "./command-contract.ts";
import {
	WARM_CHROME_BROWSER_ENTRY_EXIT_CODE,
	WARM_CHROME_CONTRACT_ID,
	type WarmChromeCommand,
} from "./model.ts";

const CATALOG_PATH = "runtime/warm-chrome/src/branch-station-catalog.ts";

const BROWSER_ENTRY_EXIT = Number(WARM_CHROME_BROWSER_ENTRY_EXIT_CODE);

/**
 * Package-owned Branch Station Catalog for the warm-chrome CLI (plan U3 R4/R5).
 *
 * One station carries one canonical error code and one primary action id;
 * fine-grained cause stays in the machine-readable `reason` detail the U4+
 * runtime emits, never in the error code. `status` is a presentation alias of
 * `check` and owns zero stations: every status envelope is a check station.
 */
export const warmChromeBranchStationCatalog = [
	{
		id: "check.verified",
		command: "check",
		classification: "required",
		intent: "success",
		trigger: "loopback endpoint proves real Google Chrome on the dedicated profile",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedActionId: "use_verified_endpoint",
		mutationExpectation: "read_only",
	},
	{
		id: "check.port_occupied_foreign",
		command: "check",
		classification: "required",
		intent: "proof_failure",
		trigger: "requested CDP port is owned by a foreign process",
		expectedExitCode: BROWSER_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "port_occupied_foreign",
		expectedActionId: "rerun_with_explicit_port",
		mutationExpectation: "read_only",
	},
	{
		id: "check.endpoint_unreachable",
		command: "check",
		classification: "required",
		intent: "proof_failure",
		trigger: "no listener answers on the resolved CDP endpoint",
		expectedExitCode: BROWSER_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "endpoint_unreachable",
		expectedActionId: "launch_warm_chrome",
		mutationExpectation: "read_only",
	},
	{
		id: "check.wrong_browser",
		command: "check",
		classification: "required",
		intent: "proof_failure",
		trigger: "listener answers but is not real Google Chrome",
		expectedExitCode: BROWSER_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "wrong_browser",
		expectedActionId: "launch_warm_chrome",
		mutationExpectation: "read_only",
	},
	{
		id: "check.unsafe_profile",
		command: "check",
		classification: "required",
		intent: "proof_failure",
		trigger: "listener runs on a profile without owner-only Warm Chrome proof",
		expectedExitCode: BROWSER_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "unsafe_profile",
		expectedActionId: "repair_profile",
		mutationExpectation: "read_only",
	},
	{
		id: "check.profile_posture_unsafe",
		command: "check",
		classification: "required",
		intent: "proof_failure",
		trigger:
			"dedicated profile cannot prove disabled save, autofill, and sync controls with no stored login",
		expectedExitCode: BROWSER_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "profile_posture_unsafe",
		expectedActionId: "create_clean_profile",
		mutationExpectation: "read_only",
	},
	{
		id: "check.non_loopback",
		command: "check",
		classification: "required",
		intent: "proof_failure",
		trigger: "resolved endpoint is not a loopback address",
		expectedExitCode: BROWSER_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "non_loopback",
		expectedActionId: "change_input",
		mutationExpectation: "read_only",
	},
	{
		id: "check.invalid_cdp",
		command: "check",
		classification: "required",
		intent: "proof_failure",
		trigger: "listener answers without a valid CDP surface",
		expectedExitCode: BROWSER_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "invalid_cdp",
		expectedActionId: "inspect_listener",
		mutationExpectation: "read_only",
	},
	{
		id: "check.listener_mismatch",
		command: "check",
		classification: "required",
		intent: "proof_failure",
		trigger: "listener identity disagrees with the requested endpoint",
		expectedExitCode: BROWSER_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "listener_mismatch",
		expectedActionId: "inspect_listener",
		mutationExpectation: "read_only",
	},
	{
		id: "check.runtime_failure",
		command: "check",
		classification: "required",
		intent: "runtime_failure",
		trigger: "unexpected local failure while probing the endpoint",
		expectedExitCode: 1,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "runtime_failure",
		expectedActionId: "inspect_diagnostics",
		mutationExpectation: "read_only",
	},
	{
		id: "check.invalid_usage",
		command: "check",
		classification: "required",
		intent: "usage_failure",
		trigger: "unsupported flags or conflicting inputs fail before any probe",
		expectedExitCode: 2,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "invalid_usage",
		mutationExpectation: "no_runtime_state_read",
	},
	{
		id: "launch.launched",
		command: "launch",
		classification: "required",
		intent: "success",
		trigger: "launch starts real Google Chrome and the follow-up probe verifies it",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedActionId: "use_verified_endpoint",
		mutationExpectation: "writes_browser_state",
	},
	{
		id: "launch.already_verified",
		command: "launch",
		classification: "required",
		intent: "success",
		trigger:
			"verified Warm Chrome is reused, either before spawn or after a launch-race child is retired",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedActionId: "use_verified_endpoint",
		mutationExpectation: "no_surviving_new_child",
	},
	{
		id: "launch.port_occupied_foreign",
		command: "launch",
		classification: "required",
		intent: "proof_failure",
		trigger: "foreign port owner blocks launch before any spawn",
		expectedExitCode: BROWSER_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "port_occupied_foreign",
		expectedActionId: "rerun_with_explicit_port",
		mutationExpectation: "fails_closed_without_spawn",
	},
	{
		id: "launch.spawned_unverified",
		command: "launch",
		classification: "required",
		intent: "proof_failure",
		trigger: "Chrome spawned but the follow-up probe fails verification",
		expectedExitCode: BROWSER_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "spawned_unverified",
		expectedActionId: "inspect_diagnostics",
		mutationExpectation: "writes_browser_state",
	},
	{
		id: "launch.human-action-required",
		command: "launch",
		classification: "required",
		intent: "proof_failure",
		trigger:
			"a missing fresh profile requires an exact external human continuation before creation",
		expectedExitCode: 21,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "human-action-required",
		expectedActionId: "create_clean_profile",
		mutationExpectation: "fails_closed_without_spawn",
	},
	{
		id: "repair.repaired",
		command: "repair",
		classification: "required",
		intent: "success",
		trigger: "repair rewrites owner-only profile proof and verification passes",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedActionId: "use_verified_endpoint",
		mutationExpectation: "repairs_profile_state",
	},
	{
		id: "repair.unrepairable",
		command: "repair",
		classification: "required",
		intent: "proof_failure",
		trigger: "profile proof cannot be repaired safely",
		expectedExitCode: BROWSER_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "unrepairable",
		expectedActionId: "inspect_diagnostics",
		mutationExpectation: "fails_closed",
	},
	{
		id: "repair.human-action-required",
		command: "repair",
		classification: "required",
		intent: "proof_failure",
		trigger:
			"a missing fresh profile requires an exact external human continuation before creation",
		expectedExitCode: 21,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: WARM_CHROME_CONTRACT_ID,
		expectedErrorCode: "human-action-required",
		expectedActionId: "create_clean_profile",
		mutationExpectation: "fails_closed",
	},
] as const satisfies readonly BranchStation[];

/**
 * Check-owned proof-failure station ids (the exit-20 check verdicts).
 */
export const WARM_CHROME_CHECK_PROOF_FAILURE_STATION_IDS = [
	"check.endpoint_unreachable",
	"check.invalid_cdp",
	"check.listener_mismatch",
	"check.non_loopback",
	"check.port_occupied_foreign",
	"check.profile_posture_unsafe",
	"check.unsafe_profile",
	"check.wrong_browser",
] as const;

/**
 * Commands that re-emit check-owned stations by reference.
 */
export type WarmChromeReemittingCommand = Extract<
	WarmChromeCommand,
	"launch" | "repair"
>;

const REEMITTED_CHECK_STATION_IDS = [
	...WARM_CHROME_CHECK_PROOF_FAILURE_STATION_IDS,
	"check.invalid_usage",
	"check.runtime_failure",
] as const;

/**
 * Re-emit rule as data (plan U3 R4): launch and repair re-emit check-owned
 * stations by reference, so a diverging envelope is a drift finding, not a new
 * station. The list covers every check proof-failure station plus
 * `check.invalid_usage` and `check.runtime_failure` — an unsupported flag or a
 * runtime failure on any command re-emits the check-owned station, so no
 * envelope the CLI can produce is drift-ungated.
 */
export const warmChromeReemittedCheckStationIds = {
	launch: REEMITTED_CHECK_STATION_IDS,
	repair: REEMITTED_CHECK_STATION_IDS,
} as const satisfies Record<WarmChromeReemittingCommand, readonly string[]>;

/**
 * Resolve the check stations a mutating command re-emits.
 *
 * Returns the catalog station objects themselves (by reference), so re-emitted
 * envelopes cannot fork from the check-owned declarations.
 *
 * @param command - Mutating command that re-emits check verdicts
 * @returns Catalog stations, in re-emit list order
 */
export function resolveWarmChromeReemittedStations(
	command: WarmChromeReemittingCommand,
): readonly BranchStation[] {
	return warmChromeReemittedCheckStationIds[command].map((stationId) => {
		const station = warmChromeBranchStationCatalog.find(
			(candidate) => candidate.id === stationId,
		);
		if (!station) {
			throw new Error(`Re-emitted station missing from catalog: ${stationId}`);
		}
		return station;
	});
}

/**
 * Envelope-facing expectation fields for one station.
 *
 * Used to assert envelope equivalence mechanically: a launch/repair-owned
 * station that shares a branch with a check station must project the same
 * envelope expectation, differing only in station identity and mutation pin.
 *
 * @param station - Catalog station declaration
 * @returns Envelope expectation fields only
 */
export function projectWarmChromeStationEnvelopeExpectation(
	station: BranchStation,
) {
	return {
		expectedExitCode: station.expectedExitCode,
		expectedEnvelopeStatus: station.expectedEnvelopeStatus,
		expectedResultContractId: station.expectedResultContractId,
		expectedErrorCode: station.expectedErrorCode,
		expectedActionId: station.expectedActionId,
	};
}

/**
 * Find drift between discovery metadata and the Branch Station Catalog.
 *
 * @param evidence - Optional test-owned coverage evidence
 * @returns Drift records from the facade station-map validator
 */
export function findWarmChromeBranchStationCatalogDrift(
	evidence: readonly BranchStationEvidence[] = [],
) {
	return findBranchStationCatalogDrift({
		discovery: projectWarmChromeCommandDiscoveryTree(),
		catalog: warmChromeBranchStationCatalog,
		evidence,
		path: CATALOG_PATH,
	});
}

/**
 * Project the package Station Map for reviewer inspection.
 *
 * @param evidence - Optional test-owned coverage evidence
 * @returns Station Map JSON model
 */
export function projectWarmChromeStationMap(
	evidence: readonly BranchStationEvidence[] = [],
): StationMap {
	return projectStationMap({
		discovery: projectWarmChromeCommandDiscoveryTree(),
		catalog: warmChromeBranchStationCatalog,
		evidence,
		path: CATALOG_PATH,
	});
}
