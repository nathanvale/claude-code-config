import { describe, expect, test } from "bun:test";

import {
	createVaultGitTaskState,
	parseVaultGitTaskState,
} from "../src/task-state.ts";

describe("durable task state", () => {
	test("creates one immutable admitted revision from receipt-scoped input", () => {
		const state = createVaultGitTaskState({
			taskId: "task_11111111111111111111111111111111",
			receiptId: "receipt_22222222222222222222222222222222",
			recordedAt: "2026-08-12T11:30:00.000Z",
		});

		expect(state).toEqual({
			schemaVersion: 1,
			taskId: "task_11111111111111111111111111111111",
			receiptId: "receipt_22222222222222222222222222222222",
			revision: 1,
			phase: "admitted",
			recordedAt: "2026-08-12T11:30:00.000Z",
		});
		expect(Object.isFrozen(state)).toBe(true);
	});

	test("rejects capability-shaped or additional persisted fields", () => {
		expect(() =>
			parseVaultGitTaskState({
				schemaVersion: 1,
				taskId: "task_11111111111111111111111111111111",
				receiptId: "receipt_22222222222222222222222222222222",
				revision: 1,
				phase: "admitted",
				recordedAt: "2026-08-12T11:30:00.000Z",
				capabilityBytes: "forbidden",
			}),
		).toThrow("task state invalid");
	});
});
