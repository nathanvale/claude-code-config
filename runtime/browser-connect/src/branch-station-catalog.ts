// Public Branch Station seam; package tests and later units (U6/U7/U8) consume this entrypoint.
import {
	type BranchStation,
	type BranchStationEvidence,
	findBranchStationCatalogDrift,
	projectStationMap,
	type StationMap,
} from "@side-quest/cli-command-facade";
import { projectBrowserConnectCommandDiscoveryTree } from "./command-contract.ts";
import {
	BROWSER_CONNECT_CONNECTION_ENTRY_EXIT_CODE,
	BROWSER_CONNECT_WRAPPED_NOT_FOUND_EXIT_CODE,
} from "./command-contract.ts";
import {
	BROWSER_CONNECT_CONTRACT_ID,
	BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS,
} from "./model.ts";

const CATALOG_PATH = "runtime/browser-connect/src/branch-station-catalog.ts";

const CONNECT_ENTRY_EXIT = Number(BROWSER_CONNECT_CONNECTION_ENTRY_EXIT_CODE);
const WRAPPED_NOT_FOUND_EXIT = Number(
	BROWSER_CONNECT_WRAPPED_NOT_FOUND_EXIT_CODE,
);

/**
 * Package-owned Branch Station Catalog for the browser-connect CLI (R2/R7/R11/
 * R15/R17). All nineteen slice-one stations from the Planning Contract plus
 * the four U5 repair-adapter stations (preview, installed, upgraded, and the
 * fourteenth error station `repair-adapter.operator_stop` — R1), keyed
 * `<command>.<branch>` so the facade station-id pattern and command-prefix
 * cross-check both hold.
 *
 * One station carries one canonical error code (its branch id) and one primary
 * action id resolved from the model's affordance catalog. Both `check.*` and
 * `connect.*` foreign-listener stations map to the single `foreign-listener`
 * failure class; the error code names the command-local branch, and the action
 * id names the shared next-safe action. Fine-grained cause stays in the
 * `reason`/`detail` the U4+ runtime emits, never in the error code.
 *
 * Command homes: the two cross-command families from the plan table
 * (`usage-invalid` "any", `runtime-error-unexpected" "any") are homed on
 * `check` as `check.usage_invalid` and `check.runtime_error` — the first
 * non-dashboard command, mirroring warm-chrome's homing of its `invalid_usage`
 * and `runtime_failure` stations on `check`. `connect.adapter_unknown` is the
 * distinct connect-scoped usage rejection (adapter not in registry) and stays
 * separate from the generic usage station.
 */
export const browserConnectBranchStationCatalog = [
	// dashboard-ok
	{
		id: "dashboard.ok",
		command: "dashboard",
		classification: "required",
		intent: "success",
		trigger:
			"bare invocation projects the read-only adapter and route dashboard; no probe, prove, launch, or persisted read",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		mutationExpectation: "read_only_projection",
	},
	// usage-invalid (any) — homed on check
	{
		id: "check.usage_invalid",
		command: "check",
		classification: "required",
		intent: "usage_failure",
		trigger:
			"unknown command, unknown flag, or missing operand fails before any environment read",
		expectedExitCode: 2,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "usage_invalid",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["usage-invalid"],
		mutationExpectation: "no_runtime_state_read",
	},
	// run-missing-separator
	{
		id: "run.missing_separator",
		command: "run",
		classification: "required",
		intent: "usage_failure",
		trigger: "run receives no -- boundary between its options and the wrapped command",
		expectedExitCode: 2,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "missing_separator",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["run-missing-separator"],
		mutationExpectation: "no_runtime_state_read",
	},
	// check-verified
	{
		id: "check.verified",
		command: "check",
		classification: "required",
		intent: "success",
		trigger: "Agent Chrome is proven; environment verified with no mutation",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		mutationExpectation: "read_only",
	},
	// check-environment-absent
	{
		id: "check.environment_absent",
		command: "check",
		classification: "required",
		intent: "proof_failure",
		trigger: "Agent Chrome is not running; read-only report, no launch",
		expectedExitCode: CONNECT_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "environment_absent",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["environment-absent"],
		mutationExpectation: "read_only",
	},
	// check-foreign-listener
	{
		id: "check.foreign_listener",
		command: "check",
		classification: "required",
		intent: "proof_failure",
		trigger: "a listener is present but proof rejects its identity as foreign",
		expectedExitCode: CONNECT_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "foreign_listener",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["foreign-listener"],
		mutationExpectation: "read_only",
	},
	// connect-verified-existing
	{
		id: "connect.verified_existing",
		command: "connect",
		classification: "required",
		intent: "success",
		trigger:
			"Agent Chrome already running; verified handoff with launch provenance false",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		mutationExpectation: "no_launch",
	},
	// connect-verified-launched
	{
		id: "connect.verified_launched",
		command: "connect",
		classification: "required",
		intent: "success",
		trigger:
			"Agent Chrome launched then proven; verified handoff with launch provenance true",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		mutationExpectation: "launches_browser_state",
	},
	// connect-launch-failed
	{
		id: "connect.launch_failed",
		command: "connect",
		classification: "required",
		intent: "proof_failure",
		trigger: "launch attempted but the follow-up proof never verified",
		expectedExitCode: CONNECT_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "launch_failed",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["launch-failed"],
		mutationExpectation: "launches_browser_state",
	},
	// connect-foreign-listener
	{
		id: "connect.foreign_listener",
		command: "connect",
		classification: "required",
		intent: "proof_failure",
		trigger: "foreign listener rejected; fail closed, no fallback, no launch",
		expectedExitCode: CONNECT_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "foreign_listener",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["foreign-listener"],
		mutationExpectation: "fails_closed_without_launch",
	},
	// connect-adapter-unknown
	{
		id: "connect.adapter_unknown",
		command: "connect",
		classification: "required",
		intent: "usage_failure",
		trigger: "the named adapter is not in the registry",
		expectedExitCode: 2,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "adapter_unknown",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["adapter-unknown"],
		mutationExpectation: "no_runtime_state_read",
	},
	// connect-adapter-not-installed
	{
		id: "connect.adapter_not_installed",
		command: "connect",
		classification: "required",
		intent: "proof_failure",
		trigger:
			"adapter is registered but its binary/package is absent or version-mismatched",
		expectedExitCode: CONNECT_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "adapter_not_installed",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["adapter-not-installed"],
		mutationExpectation: "fails_closed_without_probe",
	},
	// connect-route-incompatible
	{
		id: "connect.route_incompatible",
		command: "connect",
		classification: "required",
		intent: "proof_failure",
		trigger: "no route is shared by the environment and the chosen adapter",
		expectedExitCode: CONNECT_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "route_incompatible",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["route-incompatible"],
		mutationExpectation: "fails_closed_without_probe",
	},
	// connect-attachment-failed
	{
		id: "connect.attachment_failed",
		command: "connect",
		classification: "required",
		intent: "proof_failure",
		trigger: "endpoint verified but the adapter attachment probe failed",
		expectedExitCode: CONNECT_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "attachment_failed",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["attachment-failed"],
		mutationExpectation: "read_only_after_verified_endpoint",
	},
	// run-preexec-connect-failed
	{
		id: "run.preexec_connect_failed",
		command: "run",
		classification: "required",
		intent: "proof_failure",
		trigger: "any connect-family failure before exec; the wrapped command never starts",
		expectedExitCode: CONNECT_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "preexec_connect_failed",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["preexec-connect-failed"],
		mutationExpectation: "exec_never_starts",
	},
	// run-wrapped-not-found
	{
		id: "run.wrapped_not_found",
		command: "run",
		classification: "required",
		intent: "proof_failure",
		trigger:
			"connection verified but the wrapped command is missing; envelope already on stderr plus a spawn-failure diagnostic line",
		expectedExitCode: WRAPPED_NOT_FOUND_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "wrapped_not_found",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["wrapped-command-not-found"],
		mutationExpectation: "envelope_emitted_before_spawn",
	},
	// run-passthrough-success
	{
		id: "run.passthrough_success",
		command: "run",
		classification: "required",
		intent: "success",
		trigger: "connection verified and the wrapped tool exited 0",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		mutationExpectation: "passthrough_exit",
	},
	// run-passthrough-failure — exit is the wrapped tool's own nonzero code; no
	// deterministic exit code, and no connect-failure envelope. The verified
	// handoff envelope (ok) is still emitted before exec.
	{
		id: "run.passthrough_failure",
		command: "run",
		classification: "required",
		intent: "success",
		trigger:
			"connection verified and the wrapped tool exited nonzero; no connect-failure envelope, exit passes through",
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		mutationExpectation: "passthrough_exit",
	},
	// runtime-error-unexpected (any) — homed on check
	{
		id: "check.runtime_error",
		command: "check",
		classification: "required",
		intent: "runtime_failure",
		trigger: "an unexpected exception surfaces during a command",
		expectedExitCode: 1,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "runtime_error",
		expectedActionId:
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS["runtime-error-unexpected"],
		mutationExpectation: "read_only",
	},
	// repair-adapter-preview (U5 R33): --check, or --execute finding the adapter
	// already at the exact pin — a read-only eligibility report either way.
	{
		id: "repair-adapter.preview",
		command: "repair-adapter",
		classification: "required",
		intent: "success",
		trigger:
			"--check previews the exact currently-eligible repair action, or --execute finds the adapter already at the exact pin; zero network, zero mutation",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		mutationExpectation: "read_only",
	},
	// repair-adapter-installed (U5 R28/R33)
	{
		id: "repair-adapter.installed",
		command: "repair-adapter",
		classification: "required",
		intent: "success",
		trigger:
			"--execute installed the absent adapter through the isolated installer and proved fresh exact-pin provenance",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		mutationExpectation: "publishes_versioned_install_tree",
	},
	// repair-adapter-upgraded (U5 R21/R22/R33)
	{
		id: "repair-adapter.upgraded",
		command: "repair-adapter",
		classification: "required",
		intent: "success",
		trigger:
			"--execute ran an exact allowlisted observed-to-pin upgrade through the isolated installer and proved fresh exact-pin provenance",
		expectedExitCode: 0,
		expectedEnvelopeStatus: "ok",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		mutationExpectation: "publishes_versioned_install_tree",
	},
	// repair-adapter-operator-stop (U5 R29/R34; the 14th error station, R1).
	// No expectedActionId: the legacy data field degrades per-cause to a
	// non-mutating compatibility stop (R30), so no single action id is pinned.
	{
		id: "repair-adapter.operator_stop",
		command: "repair-adapter",
		classification: "required",
		intent: "proof_failure",
		trigger:
			"a package safety gate stopped automatic repair fail-closed (lifecycle scripts, lock origin, integrity, drift, redirect, installer, bin, or provenance); an operator owns the continuation",
		expectedExitCode: CONNECT_ENTRY_EXIT,
		expectedEnvelopeStatus: "error",
		expectedResultContractId: BROWSER_CONNECT_CONTRACT_ID,
		expectedErrorCode: "operator_stop",
		mutationExpectation: "fails_closed_without_publish",
	},
] as const satisfies readonly BranchStation[];

/**
 * Stable station-id union. U8 builds its `Record<BrowserConnectStationId, ...>`
 * scenario map on this; equality between scenario-map keys and catalog ids is a
 * compile-time exhaustiveness gate.
 */
export type BrowserConnectStationId =
	(typeof browserConnectBranchStationCatalog)[number]["id"];

/**
 * Canonical station ids in catalog order.
 */
export const BROWSER_CONNECT_STATION_IDS = browserConnectBranchStationCatalog.map(
	(station) => station.id,
) as readonly BrowserConnectStationId[];

/**
 * Find drift between discovery metadata and the Branch Station Catalog.
 *
 * @param evidence - Optional test-owned coverage evidence
 * @returns Drift records from the facade station-map validator
 */
export function findBrowserConnectBranchStationCatalogDrift(
	evidence: readonly BranchStationEvidence[] = [],
) {
	return findBranchStationCatalogDrift({
		discovery: projectBrowserConnectCommandDiscoveryTree(),
		catalog: browserConnectBranchStationCatalog,
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
export function projectBrowserConnectStationMap(
	evidence: readonly BranchStationEvidence[] = [],
): StationMap {
	return projectStationMap({
		discovery: projectBrowserConnectCommandDiscoveryTree(),
		catalog: browserConnectBranchStationCatalog,
		evidence,
		path: CATALOG_PATH,
	});
}

/**
 * Envelope-facing expectation fields for one station, for mechanical envelope
 * equivalence checks in later units.
 *
 * @param station - Catalog station declaration
 * @returns Envelope expectation fields only
 */
export function projectBrowserConnectStationEnvelopeExpectation(
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
