import { describe, expect, test } from "bun:test";

import {
	advanceVaultGitDoctorTaskState,
	createVaultGitDoctorTaskState,
	isVaultGitDoctorTaskWorkerLost,
	parseVaultGitDoctorTaskState,
} from "../src/doctor-task-state.ts";

const binding = {
	repositoryId: "a".repeat(64),
	activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
	receiptId: `receipt_${"b".repeat(32)}`,
	receiptRevision: 7,
	transactionId: `txn_${"c".repeat(32)}`,
	normalizedInput: '{"command":"doctor"}',
} as const;

describe("Background Doctor task state", () => {
	test("fences launch ownership and makes terminal diagnosis absorbing", () => {
		const claimed = createVaultGitDoctorTaskState({
			taskId: `doctor_task_${"d".repeat(32)}`,
			binding,
			recordedAt: "2026-08-14T01:00:00.000Z",
		});
		const launching = advanceVaultGitDoctorTaskState(claimed, {
			state: "launching",
			phase: "admitted",
			updatedAt: "2026-08-14T01:00:00.100Z",
			heartbeatAt: null,
			checkpoint: "local_classified",
			launchGeneration: `doctor_launch_${"e".repeat(32)}`,
			launchExpiresAt: "2026-08-14T01:00:01.000Z",
			workerPid: 123,
			workerProcessIdentity: "f".repeat(64),
			launchAttempt: 1,
			terminalResult: null,
		});
		const running = advanceVaultGitDoctorTaskState(launching, {
			state: "in_progress",
			phase: "running",
			updatedAt: "2026-08-14T01:00:00.200Z",
			heartbeatAt: "2026-08-14T01:00:00.200Z",
			checkpoint: "checking_remote",
			launchGeneration: launching.launchGeneration,
			launchExpiresAt: null,
			workerPid: launching.workerPid,
			workerProcessIdentity: launching.workerProcessIdentity,
			launchAttempt: 1,
			terminalResult: null,
		});
		const closed = advanceVaultGitDoctorTaskState(running, {
			state: "closed",
			phase: "terminal",
			updatedAt: "2026-08-14T01:00:00.300Z",
			heartbeatAt: "2026-08-14T01:00:00.300Z",
			checkpoint: "terminal",
			launchGeneration: running.launchGeneration,
			launchExpiresAt: null,
			workerPid: running.workerPid,
			workerProcessIdentity: running.workerProcessIdentity,
			launchAttempt: 1,
			terminalResult: {
				kind: "doctor_result",
				status: "diagnosed",
				state: "repairable",
				phase: "writing",
				finding: "writes_in_progress",
				changedState: "none",
				retrySafety: "same_input_safe",
				nextAction: { id: "run_repair", summary: "Run repair." },
				repairAction: "resume",
				transactionId: binding.transactionId,
			},
		});

		expect(closed).toMatchObject({
			revision: 4,
			state: "closed",
			phase: "terminal",
			terminalResult: {
				finding: "writes_in_progress",
				repairAction: "resume",
			},
		});
		expect(() =>
			advanceVaultGitDoctorTaskState(closed, {
				...closed,
				state: "in_progress",
				phase: "running",
				updatedAt: "2026-08-14T01:00:00.400Z",
				terminalResult: null,
			}),
		).toThrow("doctor task transition invalid");
		expect(() =>
			advanceVaultGitDoctorTaskState(running, {
				...running,
				updatedAt: "2026-08-14T01:00:00.300Z",
				launchAttempt: 0,
			}),
		).toThrow("doctor task transition invalid");
	});

	test("rejects additional persisted fields", () => {
		const state = createVaultGitDoctorTaskState({
			taskId: `doctor_task_${"d".repeat(32)}`,
			binding,
			recordedAt: "2026-08-14T01:00:00.000Z",
		});
		expect(() =>
			parseVaultGitDoctorTaskState({ ...state, privatePath: "/private" }),
		).toThrow("doctor task state malformed");
	});

	test("rejects malformed terminal evidence instead of trusting private strings", () => {
		const claimed = createVaultGitDoctorTaskState({
			taskId: `doctor_task_${"d".repeat(32)}`,
			binding,
			recordedAt: "2026-08-14T01:00:00.000Z",
		});
		const terminal = {
			...claimed,
			state: "closed",
			phase: "terminal",
			checkpoint: "terminal",
			terminalResult: {
				kind: "doctor_result",
				status: "diagnosed",
				state: "repairable",
				phase: "writing",
				finding: "writes_in_progress",
				changedState: "none",
				retrySafety: "same_input_safe",
				nextAction: {
					id: "run_repair",
					summary: "/Users/private/secret TOKEN=secret",
				},
				privateEvidence: "/Users/private/secret",
			},
		};

		expect(() => parseVaultGitDoctorTaskState(terminal)).toThrow(
			"doctor task terminal result invalid",
		);
	});

	test("separates stale heartbeat from proven process loss", () => {
		const claimed = createVaultGitDoctorTaskState({
			taskId: `doctor_task_${"d".repeat(32)}`,
			binding,
			recordedAt: "2026-08-14T01:00:00.000Z",
		});
		const running = advanceVaultGitDoctorTaskState(claimed, {
			state: "in_progress",
			phase: "running",
			updatedAt: "2026-08-14T01:00:00.100Z",
			heartbeatAt: "2026-08-14T01:00:00.100Z",
			checkpoint: "checking_remote",
			launchGeneration: `doctor_launch_${"e".repeat(32)}`,
			launchExpiresAt: null,
			workerPid: 123,
			workerProcessIdentity: "f".repeat(64),
			launchAttempt: 1,
			terminalResult: null,
		});
		const staleAt = Date.parse("2026-08-14T01:00:21.000Z");

		expect(
			isVaultGitDoctorTaskWorkerLost(running, staleAt, 20_000, () => true),
		).toBe(false);
		expect(
			isVaultGitDoctorTaskWorkerLost(running, staleAt, 20_000, () => false),
		).toBe(true);
	});
});
