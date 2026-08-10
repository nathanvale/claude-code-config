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

/** Stable complete-CLI Branch Station ids. */
export const VAULT_GIT_STATION_IDS = [
	"status.dashboard",
	"status.read_only",
	"status.invalid_usage",
	"preview.read_only",
	"doctor.read_only",
	"commands.discovery",
	"begin.admitted",
	"join.joined",
	"complete.completed",
	"complete.join_role_refused",
	"repair.action_required",
	"repair.join_role_refused",
	"repair.stale_takeover_usage",
	"tidy.invalid_usage",
	"tidy.preview",
	"janitor.preview",
] as const;

/** Package-owned complete-CLI Branch Station Catalog. */
export const vaultGitBranchStationCatalog = [
	station("status.dashboard", "status", "success", "bare invocation renders one bounded configured dashboard action", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "read_only_projection"),
	station("status.read_only", "status", "success", "explicit status inspects manager state without mutation", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "read_only_projection"),
	station("status.invalid_usage", "status", "usage_failure", "unknown command or foreign flag fails before composition", 2, "error", VAULT_GIT_RESULT_CONTRACT_ID, "no_runtime_state_read", "invalid_usage", "change_input"),
	station("preview.read_only", "preview", "success", "preview uses the same read-only engine inspection", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "read_only_projection"),
	station("doctor.read_only", "doctor", "success", "doctor classifies evidence without canonical mutation", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "read_only_projection"),
	station("commands.discovery", "commands", "success", "machine discovery projects the live command contracts", 0, "ok", VAULT_GIT_COMMANDS_CONTRACT_ID, "read_only_projection"),
	station("begin.admitted", "begin", "success", "aligned main and absent ledger admit one owner transaction", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "remote_lease_and_local_receipt", undefined, "complete_transaction"),
	station("join.joined", "join", "success", "join capability extends owned paths without owner authority", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "local_receipt_only", undefined, "continue_outer_transaction"),
	station("complete.completed", "complete", "success", "owner capability checks commits and atomically closes", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "atomic_remote_close", undefined, "none"),
	station("complete.join_role_refused", "complete", "refusal", "join capability cannot complete or release", 1, "error", VAULT_GIT_RESULT_CONTRACT_ID, "refuses_before_completion", "capability_role_mismatch", "use_owner_capability"),
	station("repair.action_required", "repair", "usage_failure", "repair without an engine-owned action fails usage", 2, "error", VAULT_GIT_RESULT_CONTRACT_ID, "no_runtime_state_read", "invalid_usage", "change_input"),
	station("repair.join_role_refused", "repair", "refusal", "join capability cannot execute an admitted repair", 1, "error", VAULT_GIT_RESULT_CONTRACT_ID, "refuses_before_repair", "capability_role_mismatch", "use_owner_capability"),
	station("repair.stale_takeover_usage", "repair", "usage_failure", "stale takeover requires explicit prior-writer attestation", 2, "error", VAULT_GIT_RESULT_CONTRACT_ID, "no_runtime_state_read", "invalid_usage", "change_input"),
	station("tidy.invalid_usage", "tidy", "usage_failure", "tidy omits the exact now subcommand", 2, "error", VAULT_GIT_RESULT_CONTRACT_ID, "no_runtime_state_read", "invalid_usage", "change_input"),
	station("tidy.preview", "tidy", "success", "explicit worker emits a bounded preview when checker admission is absent", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "preview_only_private_hygiene", undefined, "request_operator_review"),
	station("janitor.preview", "janitor", "success", "scheduled Janitor emits a bounded preview when checker admission is absent", 0, "ok", VAULT_GIT_RESULT_CONTRACT_ID, "preview_only_private_hygiene", undefined, "request_operator_review"),
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
