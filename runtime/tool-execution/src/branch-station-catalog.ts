import type { BranchStation } from "@side-quest/cli-command-facade";

export const TOOL_EXECUTION_BRANCH_STATIONS = [
	station("contract.success", "contract", "discovery", "contract route", 0, "ok", "tool-execution.contract"),
	station("checkpoint.read", "checkpoint", "read", "no input", 0, "ok", "tool-execution.checkpoint"),
	station("checkpoint.write", "checkpoint", "write", "valid active card", 0, "ok", "tool-execution.checkpoint", undefined, "writes checkpoint state"),
	station("checkpoint.usage_error", "checkpoint", "usage", "invalid card", 2, "error", undefined, "usage_error"),
	station("prepare.success", "prepare", "prepare", "valid request", 0, "ok", "tool-execution.prepare", undefined, "writes prepared receipt"),
	station("prepare.policy_refused", "prepare", "policy", "route policy rejects input", 1, "error", undefined, "request_refused"),
	station("approve.success", "approve", "approve", "task policy accepts", 0, "ok", "tool-execution.approve", undefined, "writes approval binding"),
	station("approve.denied", "approve", "deny", "task policy denies", 1, "error", undefined, "approval_denied", "writes terminal receipt"),
	station("approve.decision_required", "approve", "input", "no explicit task-policy decision", 2, "error", undefined, "usage_error"),
	station("call.success", "call", "success", "approved provider result", 0, "ok", "tool-execution.call", undefined, "writes terminal receipt"),
	station("call.transport_failure", "call", "transport", "provider process fails", 1, "error", undefined, "transport_failure", "writes terminal receipt"),
	station("call.jsonrpc_error", "call", "protocol", "protocol response contains error", 1, "error", undefined, "jsonrpc_error", "writes terminal receipt"),
	station("call.tool_error", "call", "tool", "tool result reports isError", 1, "error", undefined, "tool_error", "writes terminal receipt"),
	station("call.unknown", "call", "unknown", "spawned attempt has no complete result", 4, "error", undefined, "outcome_unknown", "writes unknown receipt"),
	station("call.approval_refused", "call", "approval", "binding is missing or invalid", 3, "error", undefined, "approval_required"),
	station("observe.success", "observe", "observation", "fresh matching native evidence", 0, "ok", "tool-execution.observe", undefined, "writes native observation"),
	station("observe.mismatch", "observe", "provenance", "native evidence binding differs", 1, "error", undefined, "observation_mismatch"),
	station("resume.terminal_noop", "resume", "terminal", "terminal receipt", 0, "ok", "tool-execution.resume"),
	station("resume.unknown_blocked", "resume", "unknown", "unknown receipt without retry decision", 4, "error", undefined, "unknown_outcome_blocked"),
	station("resume.retry_prepared", "resume", "retry", "exact task-policy retry decision", 0, "ok", "tool-execution.resume", undefined, "writes linked prepared receipt"),
	station("receipts.success", "receipts", "list", "private receipt store readable", 0, "ok", "tool-execution.receipts"),
] as const satisfies readonly BranchStation[];

export const TOOL_EXECUTION_STATION_CONTINUATIONS = Object.fromEntries(
	TOOL_EXECUTION_BRANCH_STATIONS.map((station) => [
		station.id,
		station.expectedErrorCode === "outcome_unknown" ||
		station.expectedErrorCode === "unknown_outcome_blocked"
			? "stop_for_exact_retry_approval"
			: station.expectedEnvelopeStatus === "error"
				? "repair_named_failure_then_recheck"
				: station.id === "prepare.success"
					? "stop_for_operator_review"
					: "inspect_receipt_or_next_checkpoint",
	]),
) as Record<(typeof TOOL_EXECUTION_BRANCH_STATIONS)[number]["id"], string>;

function station<const TId extends string, const TCommand extends string>(
	id: TId,
	command: TCommand,
	intent: string,
	trigger: string,
	expectedExitCode: number,
	expectedEnvelopeStatus: "ok" | "error",
	expectedResultContractId?: string,
	expectedErrorCode?: string,
	mutationExpectation = "no provider dispatch",
): BranchStation & { id: TId; command: TCommand } {
	return {
		id,
		command,
		classification: "required",
		intent,
		trigger,
		expectedExitCode,
		expectedEnvelopeStatus,
		...(expectedResultContractId ? { expectedResultContractId } : {}),
		...(expectedErrorCode ? { expectedErrorCode } : {}),
		mutationExpectation,
	};
}
