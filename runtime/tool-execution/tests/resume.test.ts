import { expect, test } from "bun:test";
import type { ExecutionReceipt } from "../src/model.ts";
import { resumeReceipt } from "../src/resume.ts";

function receipt(state: ExecutionReceipt["state"]): ExecutionReceipt {
	return {
		schema_version: 1,
		receipt_id: "receipt-1",
		attempt: 1,
		adapter: "mcporter-cli",
		route: "mcporter.firecrawl.search",
		checkpoint_id: "u5",
		qualification_cell: {
			lane: "explicit_cli",
			client: "tool-execution",
			provider: "firecrawl",
			route: "mcporter.firecrawl.search",
		},
		request_fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		config_fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		state,
		created_at: "2026-08-09T00:00:00.000Z",
		updated_at: "2026-08-09T00:00:01.000Z",
	};
}

test("resume skips terminal work", () => {
	expect(
		resumeReceipt(receipt("terminal"), {
			now: "2026-08-09T00:01:00.000Z",
			newReceiptId: "receipt-2",
		}),
	).toEqual({ kind: "noop", receipt_id: "receipt-1", state: "terminal" });
});

test("resume blocks unknown work without task-policy retry approval", () => {
	expect(
		resumeReceipt(receipt("unknown"), {
			now: "2026-08-09T00:01:00.000Z",
			newReceiptId: "receipt-2",
		}),
	).toEqual({
		kind: "blocked",
		receipt_id: "receipt-1",
		reason: "unknown_outcome_requires_task_retry_approval",
	});
});

test("resume treats a persisted dispatched checkpoint as an unknown outcome", () => {
	expect(
		resumeReceipt(receipt("dispatched"), {
			now: "2026-08-09T00:01:00.000Z",
			newReceiptId: "receipt-2",
		}),
	).toEqual({
		kind: "blocked",
		receipt_id: "receipt-1",
		reason: "unknown_outcome_requires_task_retry_approval",
	});
});

test("an exact unexpired retry approval creates one linked prepared attempt", () => {
	const result = resumeReceipt(receipt("unknown"), {
		now: "2026-08-09T00:01:00.000Z",
		newReceiptId: "receipt-2",
		taskRetryApproval: {
			approved: true,
			expiresAt: "2026-08-09T00:02:00.000Z",
		},
	});

	expect(result).toMatchObject({
		kind: "retry_prepared",
		receipt: {
			receipt_id: "receipt-2",
			linked_receipt_id: "receipt-1",
			attempt: 2,
			state: "prepared",
			approval: {
				approval_surface: "task_policy",
				request_fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				route: "mcporter.firecrawl.search",
				attempt: 2,
				checkpoint_id: "u5",
			},
		},
	});
});

test("a stale retry approval remains blocked", () => {
	expect(
		resumeReceipt(receipt("unknown"), {
			now: "2026-08-09T00:03:00.000Z",
			newReceiptId: "receipt-2",
			taskRetryApproval: {
				approved: true,
				expiresAt: "2026-08-09T00:02:00.000Z",
			},
		}),
	).toEqual({
		kind: "blocked",
		receipt_id: "receipt-1",
		reason: "retry_task_approval_stale",
	});
});
