import type { ApprovalBinding, ExecutionReceipt } from "./model.ts";

export type ResumeResult =
	| { kind: "noop"; receipt_id: string; state: "terminal" }
	| { kind: "blocked"; receipt_id: string; reason: string }
	| { kind: "retry_prepared"; receipt: ExecutionReceipt };

export function resumeReceipt(
	receipt: ExecutionReceipt,
	input: {
		now: string;
		newReceiptId: string;
		taskRetryApproval?: { approved: true; expiresAt: string };
	},
): ResumeResult {
	if (receipt.state === "terminal") {
		return { kind: "noop", receipt_id: receipt.receipt_id, state: "terminal" };
	}
	const outcomeUnknown =
		receipt.state === "unknown" || receipt.state === "dispatched";
	if (outcomeUnknown && input.taskRetryApproval === undefined) {
		return {
			kind: "blocked",
			receipt_id: receipt.receipt_id,
			reason: "unknown_outcome_requires_task_retry_approval",
		};
	}
	if (outcomeUnknown && input.taskRetryApproval) {
		if (Date.parse(input.taskRetryApproval.expiresAt) > Date.parse(input.now)) {
			const approval: ApprovalBinding = {
				approval_surface: "task_policy",
				approved_at: input.now,
				expires_at: input.taskRetryApproval.expiresAt,
				request_fingerprint: receipt.request_fingerprint,
				route: receipt.route,
				attempt: receipt.attempt + 1,
				checkpoint_id: receipt.checkpoint_id,
			};
			return {
				kind: "retry_prepared",
				receipt: {
					...receipt,
					receipt_id: input.newReceiptId,
					linked_receipt_id: receipt.receipt_id,
					attempt: receipt.attempt + 1,
					state: "prepared",
					created_at: input.now,
					updated_at: input.now,
					approval,
					terminal_reason: undefined,
					result: undefined,
					provider_operation_id: undefined,
				},
			};
		}
		return {
			kind: "blocked",
			receipt_id: receipt.receipt_id,
			reason: "retry_task_approval_stale",
		};
	}
	return {
		kind: "blocked",
		receipt_id: receipt.receipt_id,
		reason: "receipt_not_resumable",
	};
}
