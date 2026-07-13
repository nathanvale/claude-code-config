import {
	type BranchStation,
	type BranchStationEvidence,
	findBranchStationCatalogDrift,
	projectStationMap,
} from "@side-quest/cli-command-facade";
import { projectSetupCommandDiscoveryTree } from "./command-contract.ts";
import {
	SETUP_COMMANDS_CONTRACT_ID,
	SETUP_RESULT_CONTRACT_ID,
	type SetupActionId,
	type SetupCommand,
} from "./model.ts";

type StationSpec = {
	id: string;
	command: SetupCommand;
	trigger: string;
	exit: 0 | 1 | 2;
	status: "ok" | "error";
	resultContractId?: string;
	errorCode?: string;
	action?: SetupActionId;
	mutation: string;
};

function station(spec: StationSpec): BranchStation {
	return {
		id: spec.id,
		command: spec.command,
		classification: "required",
		intent: spec.id.split(".").at(-1) ?? spec.id,
		trigger: spec.trigger,
		expectedExitCode: spec.exit,
		expectedEnvelopeStatus: spec.status,
		expectedResultContractId: spec.resultContractId ?? SETUP_RESULT_CONTRACT_ID,
		...(spec.status === "error"
			? { expectedErrorCode: spec.errorCode ?? spec.id.split(".").at(-1) }
			: {}),
		...(spec.action ? { expectedActionId: spec.action } : {}),
		mutationExpectation: spec.mutation,
	};
}

const readOnly = "read_only";
const noRead = "no_runtime_state_read";
const checkOnly = "check_only";
const noWrite = "fails_closed_without_writes";
const writes = "writes_selected_safe_domains";

/** Exhaustive terminal outcomes from the implementation-ready Setup plan. */
export const setupBranchStationCatalog = [
	station({ id: "status.healthy", command: "status", trigger: "selected domains match desired state", exit: 0, status: "ok", action: "setup_healthy", mutation: readOnly }),
	station({ id: "status.clean_slate", command: "status", trigger: "managed state is absent without blockers", exit: 0, status: "ok", action: "preview_sync", mutation: readOnly }),
	station({ id: "status.drift", command: "status", trigger: "repairable managed drift exists", exit: 0, status: "ok", action: "run_sync", mutation: readOnly }),
	station({ id: "status.blocked", command: "status", trigger: "ownership or containment blocker exists", exit: 0, status: "ok", action: "run_doctor", mutation: readOnly }),
	station({ id: "status.invalid_target", command: "status", trigger: "project target cannot be resolved safely", exit: 1, status: "error", action: "change_input", mutation: readOnly }),
	station({ id: "status.invalid_usage", command: "status", trigger: "unsupported argv combination", exit: 2, status: "error", action: "change_input", mutation: noRead }),
	station({ id: "status.runtime_failure", command: "status", trigger: "unexpected inspection or rendering failure", exit: 1, status: "error", action: "inspect_diagnostics", mutation: readOnly }),

	station({ id: "doctor.healthy", command: "doctor", trigger: "inspection has no findings", exit: 0, status: "ok", action: "setup_healthy", mutation: readOnly }),
	station({ id: "doctor.repairable", command: "doctor", trigger: "only Setup-owned drift exists", exit: 1, status: "ok", action: "run_sync", mutation: readOnly }),
	station({ id: "doctor.blocked", command: "doctor", trigger: "foreign unsafe malformed or unknown ownership exists", exit: 1, status: "ok", action: "human_repair", mutation: readOnly }),
	station({ id: "doctor.duplicate_scope", command: "doctor", trigger: "canonical skill id is visible at user and project levels", exit: 1, status: "ok", action: "human_repair", mutation: readOnly }),
	station({ id: "doctor.setup_dependency_unhealthy", command: "doctor", trigger: "dependency hook instruction or runbook check fails", exit: 1, status: "ok", action: "repair_dependency", mutation: readOnly }),
	station({ id: "doctor.invalid_target", command: "doctor", trigger: "project target cannot be resolved safely", exit: 1, status: "error", action: "change_input", mutation: readOnly }),
	station({ id: "doctor.stale_operation_lock", command: "doctor", trigger: "operation lock has no live owner", exit: 1, status: "ok", action: "inspect_lock", mutation: readOnly }),
	station({ id: "doctor.invalid_usage", command: "doctor", trigger: "unsupported argv combination", exit: 2, status: "error", action: "change_input", mutation: noRead }),
	station({ id: "doctor.runtime_failure", command: "doctor", trigger: "unexpected diagnostic failure", exit: 1, status: "error", action: "inspect_diagnostics", mutation: readOnly }),

	station({ id: "sync.check_clean", command: "sync", trigger: "preview contains no operations", exit: 0, status: "ok", action: "setup_healthy", mutation: checkOnly }),
	station({ id: "sync.check_changes", command: "sync", trigger: "preview contains safe operations", exit: 1, status: "ok", action: "run_sync", mutation: checkOnly }),
	station({ id: "sync.check_blocked", command: "sync", trigger: "preview contains a blocked domain", exit: 1, status: "error", action: "run_doctor", mutation: noWrite }),
	station({ id: "sync.check_invalid_target", command: "sync", trigger: "project target cannot be resolved safely", exit: 1, status: "error", errorCode: "invalid_target", action: "change_input", mutation: noWrite }),
	station({ id: "sync.applied", command: "sync", trigger: "every selected domain applies", exit: 0, status: "ok", action: "setup_healthy", mutation: writes }),
	station({ id: "sync.noop", command: "sync", trigger: "revalidated plan contains no work", exit: 0, status: "ok", action: "setup_healthy", mutation: noWrite }),
	station({ id: "sync.partial", command: "sync", trigger: "some domains apply while another is deferred or fails", exit: 1, status: "error", action: "inspect_results", mutation: writes }),
	station({ id: "sync.blocked", command: "sync", trigger: "projection is blocked and no other domain mutates", exit: 1, status: "error", action: "human_repair", mutation: noWrite }),
	station({ id: "sync.concurrent_change", command: "sync", trigger: "apply-time ownership differs from inspection", exit: 1, status: "error", action: "rerun_check", mutation: "stops_remaining_writes" }),
	station({ id: "sync.operation_busy", command: "sync", trigger: "another mutation owns the operation lock", exit: 1, status: "error", action: "retry", mutation: noWrite }),
	station({ id: "sync.invalid_target", command: "sync", trigger: "project target cannot be resolved safely", exit: 1, status: "error", action: "change_input", mutation: noWrite }),
	station({ id: "sync.apply_failure", command: "sync", trigger: "filesystem syscall fails after safe revalidation", exit: 1, status: "error", action: "inspect_results", mutation: "stops_after_failed_syscall" }),
	station({ id: "sync.hook_failure", command: "sync", trigger: "hook domain fails before mutation", exit: 1, status: "error", action: "repair_hooks", mutation: noWrite }),
	station({ id: "sync.instruction_failure", command: "sync", trigger: "instruction domain fails before mutation", exit: 1, status: "error", action: "repair_instructions", mutation: noWrite }),
	station({ id: "sync.runbook_failure", command: "sync", trigger: "runbook artifact domain fails before mutation", exit: 1, status: "error", action: "repair_runbook", mutation: noWrite }),
	station({ id: "sync.invalid_usage", command: "sync", trigger: "unsupported argv combination", exit: 2, status: "error", action: "change_input", mutation: noRead }),
	station({ id: "sync.runtime_failure", command: "sync", trigger: "unexpected runtime failure", exit: 1, status: "error", action: "inspect_diagnostics", mutation: noWrite }),

	station({ id: "unlink.check_removable", command: "unlink", trigger: "proven managed links would be removed", exit: 1, status: "ok", action: "run_unlink", mutation: checkOnly }),
	station({ id: "unlink.check_noop", command: "unlink", trigger: "no proven managed links exist", exit: 0, status: "ok", action: "clean_state", mutation: checkOnly }),
	station({ id: "unlink.check_blocked", command: "unlink", trigger: "unsafe root or ownership blocks trustworthy preview", exit: 1, status: "error", action: "human_repair", mutation: noWrite }),
	station({ id: "unlink.check_invalid_target", command: "unlink", trigger: "project target cannot be resolved safely", exit: 1, status: "error", errorCode: "invalid_target", action: "change_input", mutation: noWrite }),
	station({ id: "unlink.removed", command: "unlink", trigger: "all proven managed links remove", exit: 0, status: "ok", action: "clean_state", mutation: "removes_proven_links" }),
	station({ id: "unlink.noop", command: "unlink", trigger: "revalidation finds nothing removable", exit: 0, status: "ok", action: "clean_state", mutation: noWrite }),
	station({ id: "unlink.concurrent_change", command: "unlink", trigger: "ownership changes after preview", exit: 1, status: "error", action: "rerun_check", mutation: "stops_remaining_removals" }),
	station({ id: "unlink.operation_busy", command: "unlink", trigger: "another mutation owns the operation lock", exit: 1, status: "error", action: "retry", mutation: noWrite }),
	station({ id: "unlink.invalid_target", command: "unlink", trigger: "project target cannot be resolved safely", exit: 1, status: "error", action: "change_input", mutation: noWrite }),
	station({ id: "unlink.partial_failure", command: "unlink", trigger: "one removal succeeds and a later syscall fails", exit: 1, status: "error", action: "inspect_results", mutation: "partial_proven_removal" }),
	station({ id: "unlink.invalid_usage", command: "unlink", trigger: "unsupported argv combination", exit: 2, status: "error", action: "change_input", mutation: noRead }),
	station({ id: "unlink.runtime_failure", command: "unlink", trigger: "unexpected runtime failure", exit: 1, status: "error", action: "inspect_diagnostics", mutation: noWrite }),

	station({ id: "catalog.listed", command: "catalog", trigger: "catalog inventory returns", exit: 0, status: "ok", action: "inspect_catalog", mutation: readOnly }),
	station({ id: "catalog.matched", command: "catalog", trigger: "named skill resolves with visibility reasoning", exit: 0, status: "ok", action: "use_source", mutation: readOnly }),
	station({ id: "catalog.not_found", command: "catalog", trigger: "named skill is absent", exit: 1, status: "ok", action: "discover_external", mutation: readOnly }),
	station({ id: "catalog.invalid_target", command: "catalog", trigger: "project target cannot be resolved safely", exit: 1, status: "error", action: "change_input", mutation: readOnly }),
	station({ id: "catalog.invalid_usage", command: "catalog", trigger: "unsupported argv combination", exit: 2, status: "error", action: "change_input", mutation: noRead }),
	station({ id: "catalog.runtime_failure", command: "catalog", trigger: "catalog or occupancy read fails", exit: 1, status: "error", action: "inspect_diagnostics", mutation: readOnly }),
	station({ id: "commands.catalog", command: "commands", trigger: "discovery projection succeeds", exit: 0, status: "ok", resultContractId: SETUP_COMMANDS_CONTRACT_ID, mutation: readOnly }),
	station({ id: "commands.invalid_usage", command: "commands", trigger: "non-JSON or unsupported argv is supplied", exit: 2, status: "error", action: "change_input", mutation: noRead }),
	station({ id: "commands.runtime_failure", command: "commands", trigger: "discovery projection fails validation", exit: 1, status: "error", action: "inspect_diagnostics", mutation: readOnly }),
] as const satisfies readonly BranchStation[];

export function findSetupBranchStationCatalogDrift(
	evidence: readonly BranchStationEvidence[] = [],
) {
	return findBranchStationCatalogDrift({
		discovery: projectSetupCommandDiscoveryTree(),
		catalog: setupBranchStationCatalog,
		evidence,
		path: "runtime/setup/src/branch-station-catalog.ts",
	});
}

export function projectSetupStationMap(
	evidence: readonly BranchStationEvidence[] = [],
) {
	return projectStationMap({
		discovery: projectSetupCommandDiscoveryTree(),
		catalog: setupBranchStationCatalog,
		evidence,
		path: "runtime/setup/src/branch-station-catalog.ts",
	});
}
