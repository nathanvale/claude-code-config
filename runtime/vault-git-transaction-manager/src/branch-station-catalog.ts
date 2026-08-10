import {
	type BranchStation,
	type BranchStationEvidence,
	findBranchStationCatalogDrift,
	projectStationMap,
} from "@side-quest/cli-command-facade";
import { projectVaultGitCommandDiscoveryTree } from "./command-contract.ts";
import {
	VAULT_GIT_COMMANDS_CONTRACT_ID,
	VAULT_GIT_RESULT_CONTRACT_ID,
} from "./model.ts";

const CATALOG_PATH =
	"runtime/vault-git-transaction-manager/src/branch-station-catalog.ts";

/** Stable U1 Branch Station ids. */
export const VAULT_GIT_STATION_IDS = [
	"status.dashboard",
	"status.read_only",
	"status.invalid_usage",
	"preview.read_only",
	"doctor.read_only",
	"commands.discovery",
	"begin.unavailable",
	"join.unavailable",
	"complete.unavailable",
	"repair.unavailable",
	"tidy.invalid_usage",
	"tidy.unavailable",
	"janitor.unavailable",
] as const;

/** Package-owned U1 Branch Station Catalog. */
export const vaultGitBranchStationCatalog = [
	station("status.dashboard", "status", "success", "bare invocation renders the bounded read-only dashboard", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "read_only_projection"),
	station("status.read_only", "status", "success", "explicit status returns read-only lifecycle state", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "read_only_projection"),
	station("status.invalid_usage", "status", "usage_failure", "unknown command or unsupported flag fails before state access", 2, "error", VAULT_GIT_RESULT_CONTRACT_ID, "no_runtime_state_read", "invalid_usage", "change_input"),
	station("preview.read_only", "preview", "success", "preview reports the unavailable scaffold without authority", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "read_only_projection"),
	station("doctor.read_only", "doctor", "success", "doctor reports the unavailable scaffold without repair", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "read_only_projection"),
	station("commands.discovery", "commands", "success", "machine discovery projects the live command contracts", 0, "ok", VAULT_GIT_COMMANDS_CONTRACT_ID, "read_only_projection"),
	station("begin.unavailable", "begin", "refusal", "transaction admission runtime is not implemented", 1, "error", VAULT_GIT_RESULT_CONTRACT_ID, "refuses_before_state_access", "runtime_unavailable", "inspect_status"),
	station("join.unavailable", "join", "refusal", "nested join runtime is not implemented", 1, "error", VAULT_GIT_RESULT_CONTRACT_ID, "refuses_before_state_access", "runtime_unavailable", "inspect_status"),
	station("complete.unavailable", "complete", "refusal", "owner completion runtime is not implemented", 1, "error", VAULT_GIT_RESULT_CONTRACT_ID, "refuses_before_state_access", "runtime_unavailable", "inspect_status"),
	station("repair.unavailable", "repair", "refusal", "deterministic repair runtime is not implemented", 1, "error", VAULT_GIT_RESULT_CONTRACT_ID, "refuses_before_state_access", "runtime_unavailable", "inspect_status"),
	station("tidy.invalid_usage", "tidy", "usage_failure", "tidy omits the exact now subcommand", 2, "error", VAULT_GIT_RESULT_CONTRACT_ID, "no_runtime_state_read", "invalid_usage", "change_input"),
	station("tidy.unavailable", "tidy", "refusal", "immediate hygiene worker runtime is not implemented", 1, "error", VAULT_GIT_RESULT_CONTRACT_ID, "refuses_before_state_access", "runtime_unavailable", "inspect_status"),
	station("janitor.unavailable", "janitor", "refusal", "Janitor runtime is not implemented", 1, "error", VAULT_GIT_RESULT_CONTRACT_ID, "refuses_before_state_access", "runtime_unavailable", "inspect_status"),
] as const satisfies readonly BranchStation[];

/** Find catalog drift against live command discovery. */
export function findVaultGitBranchStationCatalogDrift(
	evidence: readonly BranchStationEvidence[] = [],
) {
	return findBranchStationCatalogDrift({
		discovery: projectVaultGitCommandDiscoveryTree(),
		catalog: vaultGitBranchStationCatalog,
		evidence,
		path: CATALOG_PATH,
	});
}

/** Project declared Branch Station coverage. */
export function projectVaultGitStationMap(
	evidence: readonly BranchStationEvidence[] = [],
) {
	return projectStationMap({
		discovery: projectVaultGitCommandDiscoveryTree(),
		catalog: vaultGitBranchStationCatalog,
		evidence,
		path: CATALOG_PATH,
	});
}

function station(
	id: string,
	command: string,
	intent: string,
	trigger: string,
	expectedExitCode: number,
	expectedEnvelopeStatus: "ok" | "error",
	expectedResultContractId: string,
	mutationExpectation: string,
	expectedErrorCode?: string,
	expectedActionId?: string,
): BranchStation {
	return {
		id,
		command,
		classification: "required",
		intent,
		trigger,
		expectedExitCode,
		expectedEnvelopeStatus,
		expectedResultContractId,
		mutationExpectation,
		...(expectedErrorCode === undefined ? {} : { expectedErrorCode }),
		...(expectedActionId === undefined ? {} : { expectedActionId }),
		...(expectedActionId === undefined
			? {}
			: { expectedContinuationId: expectedActionId }),
	};
}
