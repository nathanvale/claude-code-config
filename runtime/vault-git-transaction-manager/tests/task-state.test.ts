import { describe, expect, test } from "bun:test";

import {
	advanceVaultGitTaskState,
	createVaultGitTaskState,
	parseVaultGitTaskState,
} from "../src/task-state.ts";
import { authorizeVaultGitTaskRepair } from "../src/task-repair.ts";

describe("durable task state", () => {
	test("creates one immutable admitted revision from receipt-scoped input", () => {
		const state = createVaultGitTaskState({
			taskId: "task_11111111111111111111111111111111",
			receiptId: "receipt_22222222222222222222222222222222",
			transactionId: "txn_33333333333333333333333333333333",
			leaseGeneration: "a".repeat(40),
			recordedAt: "2026-08-12T11:30:00.000Z",
		});

		expect(state).toEqual({
			schemaVersion: 2,
			taskId: "task_11111111111111111111111111111111",
			receiptId: "receipt_22222222222222222222222222222222",
			transactionId: "txn_33333333333333333333333333333333",
			leaseGeneration: "a".repeat(40),
			revision: 1,
			attemptNumber: 1,
			state: "claimed",
			phase: "admitted",
			recordedAt: "2026-08-12T11:30:00.000Z",
			updatedAt: "2026-08-12T11:30:00.000Z",
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration: null,
			launchExpiresAt: null,
			workerPid: null,
			workerProcessIdentity: null,
			launchAttempt: 0,
			terminalResult: null,
			previousTerminalResult: null,
			repairReentryBlocked: false,
			repairAuthorization: null,
		});
		expect(Object.isFrozen(state)).toBe(true);
	});

	test("normalizes an exact issue-361 schema-one task as attempt one", () => {
		const legacy = parseVaultGitTaskState({
			schemaVersion: 1,
			taskId: "task_11111111111111111111111111111111",
			receiptId: "receipt_22222222222222222222222222222222",
			transactionId: "txn_33333333333333333333333333333333",
			leaseGeneration: "a".repeat(40),
			revision: 1,
			state: "claimed",
			phase: "admitted",
			recordedAt: "2026-08-12T11:30:00.000Z",
			updatedAt: "2026-08-12T11:30:00.000Z",
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration: null,
			launchExpiresAt: null,
			workerPid: null,
			workerProcessIdentity: null,
			launchAttempt: 0,
			terminalResult: null,
		});

		expect(legacy).toMatchObject({
			schemaVersion: 2,
			attemptNumber: 1,
			previousTerminalResult: null,
			repairReentryBlocked: false,
			repairAuthorization: null,
		});
	});

	test("never authorizes an unknown publication attempt", () => {
		const admitted = createVaultGitTaskState({
			taskId: "task_11111111111111111111111111111111",
			receiptId: "receipt_22222222222222222222222222222222",
			transactionId: "txn_33333333333333333333333333333333",
			leaseGeneration: "a".repeat(40),
			recordedAt: "2026-08-12T11:30:00.000Z",
		});
		const unknown = advanceVaultGitTaskState(admitted, {
			state: "unknown",
			phase: "terminal",
			updatedAt: "2026-08-12T11:31:00.000Z",
			heartbeatAt: null,
			checkpoint: "push_pending",
			terminalResult: {
				outcome: "refused",
				phase: "push_pending",
				changedState: "partial",
				blocker: "human_required",
				retrySafety: "operator_required",
			},
		});

		expect(() => authorizeVaultGitTaskRepair(unknown, {
			repairedReceiptRevision: 3,
			bindingDigest: "b".repeat(64),
			recordedAt: "2026-08-12T11:32:00.000Z",
		})).toThrow("task repair authorization invalid");
	});

	test("preserves the no-reentry fence when a legacy unknown is refined", () => {
		const legacyUnknown = parseVaultGitTaskState({
			schemaVersion: 1,
			taskId: "task_11111111111111111111111111111111",
			receiptId: "receipt_22222222222222222222222222222222",
			transactionId: "txn_33333333333333333333333333333333",
			leaseGeneration: "a".repeat(40),
			revision: 7,
			state: "unknown",
			phase: "terminal",
			recordedAt: "2026-08-12T11:30:00.000Z",
			updatedAt: "2026-08-12T11:31:00.000Z",
			heartbeatAt: null,
			checkpoint: "push_pending",
			launchGeneration: "launch_44444444444444444444444444444444",
			launchExpiresAt: null,
			workerPid: null,
			workerProcessIdentity: null,
			launchAttempt: 1,
			terminalResult: {
				outcome: "refused",
				phase: "push_pending",
				changedState: "partial",
				blocker: "human_required",
				retrySafety: "operator_required",
			},
		});
		expect(legacyUnknown.repairReentryBlocked).toBe(true);

		const refined = advanceVaultGitTaskState(legacyUnknown, {
			state: "repair_needed",
			phase: "terminal",
			updatedAt: "2026-08-12T11:32:00.000Z",
			heartbeatAt: null,
			checkpoint: "push_pending",
			terminalResult: {
				outcome: "refused",
				phase: "push_pending",
				changedState: "local",
				blocker: "human_required",
				retrySafety: "operator_required",
			},
		});
		expect(refined.repairReentryBlocked).toBe(true);
	});

	test("advances observational progress and a safe terminal result without changing task identity", () => {
		const admitted = createVaultGitTaskState({
			taskId: "task_11111111111111111111111111111111",
			receiptId: "receipt_22222222222222222222222222222222",
			transactionId: "txn_33333333333333333333333333333333",
			leaseGeneration: "a".repeat(40),
			recordedAt: "2026-08-12T11:30:00.000Z",
		});
		const running = advanceVaultGitTaskState(admitted, {
			state: "in_progress",
			phase: "running",
			updatedAt: "2026-08-12T11:31:00.000Z",
			heartbeatAt: "2026-08-12T11:31:00.000Z",
			checkpoint: "checking",
			launchGeneration: "launch_44444444444444444444444444444444",
			launchExpiresAt: null,
		});
		const closed = advanceVaultGitTaskState(running, {
			state: "closed",
			phase: "terminal",
			updatedAt: "2026-08-12T11:32:00.000Z",
			heartbeatAt: "2026-08-12T11:32:00.000Z",
			checkpoint: "closed",
			launchExpiresAt: null,
			terminalResult: {
				outcome: "completed",
				phase: "closed",
				changedState: "remote",
				blocker: null,
				retrySafety: "same_input_safe",
			},
		});

		expect(running).toMatchObject({ revision: 2, state: "in_progress", phase: "running" });
		expect(closed).toMatchObject({
			revision: 3,
			state: "closed",
			phase: "terminal",
			terminalResult: { outcome: "completed", phase: "closed", changedState: "remote", blocker: null, retrySafety: "same_input_safe" },
		});
		expect(closed.taskId).toBe(admitted.taskId);
		expect(Object.isFrozen(closed)).toBe(true);
	});

	test("allows Doctor-proven closure to reconcile a terminal repair state", () => {
		const admitted = createVaultGitTaskState({
			taskId: "task_11111111111111111111111111111111",
			receiptId: "receipt_22222222222222222222222222222222",
			transactionId: "txn_33333333333333333333333333333333",
			leaseGeneration: "a".repeat(40),
			recordedAt: "2026-08-12T11:30:00.000Z",
		});
		const repairNeeded = advanceVaultGitTaskState(admitted, {
			state: "repair_needed",
			phase: "terminal",
			updatedAt: "2026-08-12T11:31:00.000Z",
			heartbeatAt: null,
			checkpoint: "blocked",
			terminalResult: {
				outcome: "refused",
				phase: "blocked",
				changedState: "none",
				blocker: "human_required",
				retrySafety: "operator_required",
			},
		});

		const closed = advanceVaultGitTaskState(repairNeeded, {
			state: "closed",
			phase: "terminal",
			updatedAt: "2026-08-12T11:32:00.000Z",
			heartbeatAt: null,
			checkpoint: "closed",
			terminalResult: {
				outcome: "completed",
				phase: "closed",
				changedState: "none",
				blocker: null,
				retrySafety: "same_input_safe",
			},
		});

		expect(closed).toMatchObject({
			taskId: repairNeeded.taskId,
			revision: repairNeeded.revision + 1,
			state: "closed",
			phase: "terminal",
		});
	});

	test("allows Doctor to refine an unknown outcome into a known repair", () => {
		const admitted = createVaultGitTaskState({
			taskId: "task_11111111111111111111111111111111",
			receiptId: "receipt_22222222222222222222222222222222",
			transactionId: "txn_33333333333333333333333333333333",
			leaseGeneration: "a".repeat(40),
			recordedAt: "2026-08-12T11:30:00.000Z",
		});
		const unknown = advanceVaultGitTaskState(admitted, {
			state: "unknown",
			phase: "terminal",
			updatedAt: "2026-08-12T11:31:00.000Z",
			heartbeatAt: null,
			checkpoint: "push_pending",
			terminalResult: {
				outcome: "refused",
				phase: "push_pending",
				changedState: "partial",
				blocker: "human_required",
				retrySafety: "operator_required",
			},
		});

		const refined = advanceVaultGitTaskState(unknown, {
			state: "repair_needed",
			phase: "terminal",
			updatedAt: "2026-08-12T11:32:00.000Z",
			heartbeatAt: null,
			checkpoint: "push_pending",
			terminalResult: {
				outcome: "refused",
				phase: "push_pending",
				changedState: "local",
				blocker: "human_required",
				retrySafety: "operator_required",
			},
		});

		expect(refined).toMatchObject({
			revision: unknown.revision + 1,
			state: "repair_needed",
			phase: "terminal",
			repairReentryBlocked: true,
		});
		expect(() => authorizeVaultGitTaskRepair(refined, {
			repairedReceiptRevision: 3,
			bindingDigest: "b".repeat(64),
			recordedAt: "2026-08-12T11:33:00.000Z",
		})).toThrow("task repair authorization invalid");
		expect(() => advanceVaultGitTaskState(refined, {
			state: "unknown",
			phase: "terminal",
			updatedAt: "2026-08-12T11:33:00.000Z",
			heartbeatAt: null,
			checkpoint: "push_pending",
			terminalResult: {
				outcome: "refused",
				phase: "push_pending",
				changedState: "partial",
				blocker: "human_required",
				retrySafety: "operator_required",
			},
		})).toThrow("task state transition invalid");
	});

	test("rejects capability-shaped or additional persisted fields", () => {
		expect(() =>
			parseVaultGitTaskState({
				schemaVersion: 1,
				taskId: "task_11111111111111111111111111111111",
				receiptId: "receipt_22222222222222222222222222222222",
				transactionId: "txn_33333333333333333333333333333333",
				leaseGeneration: "a".repeat(40),
				revision: 1,
				state: "claimed",
				phase: "admitted",
				recordedAt: "2026-08-12T11:30:00.000Z",
				updatedAt: "2026-08-12T11:30:00.000Z",
				heartbeatAt: null,
				checkpoint: null,
				launchGeneration: null,
				launchExpiresAt: null,
				workerPid: null,
				workerProcessIdentity: null,
				launchAttempt: 0,
				terminalResult: null,
				capabilityBytes: "forbidden",
			}),
		).toThrow("task state invalid");
	});

	test("bounds launch recovery to one replacement attempt", () => {
		const admitted = createVaultGitTaskState({
			taskId: "task_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			receiptId: "receipt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			transactionId: "txn_cccccccccccccccccccccccccccccccc",
			leaseGeneration: "d".repeat(40),
			recordedAt: "2026-08-12T11:30:00.000Z",
		});
		const first = advanceVaultGitTaskState(admitted, {
			state: "launching",
			phase: "admitted",
			updatedAt: "2026-08-12T11:30:01.000Z",
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration: "launch_dddddddddddddddddddddddddddddddd",
			launchExpiresAt: "2026-08-12T11:30:02.000Z",
			launchAttempt: 1,
		});
		const recovered = advanceVaultGitTaskState(first, {
			state: "claimed",
			phase: "admitted",
			updatedAt: "2026-08-12T11:30:03.000Z",
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration: null,
			launchExpiresAt: null,
		});
		const replacement = advanceVaultGitTaskState(recovered, {
			state: "launching",
			phase: "admitted",
			updatedAt: "2026-08-12T11:30:04.000Z",
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration: "launch_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
			launchExpiresAt: "2026-08-12T11:30:05.000Z",
			launchAttempt: 2,
		});

		expect(replacement.launchAttempt).toBe(2);
		expect(() => advanceVaultGitTaskState(replacement, {
			state: "claimed",
			phase: "admitted",
			updatedAt: "2026-08-12T11:30:05.500Z",
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration: null,
			launchExpiresAt: null,
			launchAttempt: 1,
		})).toThrow("task state transition invalid");
		expect(() => advanceVaultGitTaskState(replacement, {
			state: "claimed",
			phase: "admitted",
			updatedAt: "2026-08-12T11:30:06.000Z",
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration: null,
			launchExpiresAt: null,
			launchAttempt: 3,
		})).toThrow("task state invalid");
	});
});
