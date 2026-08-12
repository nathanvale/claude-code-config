import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	reconcileClosedVaultGitTask,
	reconcileStaleVaultGitTaskFromDoctor,
} from "../src/task-reconciliation.ts";
import { createVaultGitTaskStore } from "../src/task-store.ts";

describe("task closure reconciliation", () => {
	test("Doctor proof closes the same repair task without another admission", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-task-reconcile-"));
		try {
			const store = createVaultGitTaskStore({ stateRoot, repositoryIdentity: "repo" });
			const admission = await store.claimOrJoin({
				claimReceiptId: "receipt_22222222222222222222222222222222",
				receiptId: "receipt_22222222222222222222222222222222",
				transactionId: "txn_33333333333333333333333333333333",
				remote: "origin",
				generation: "a".repeat(40),
				capabilityDigest: "b".repeat(64),
				normalizedInput: '{"command":"complete"}',
				recordedAt: "2026-08-12T11:30:00.000Z",
			});
			if (admission.status === "refused") throw new Error("test admission refused");
			await store.transition(admission.state.taskId, admission.state.revision, {
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

			await reconcileClosedVaultGitTask(store, {
				receiptId: admission.state.receiptId,
				transactionId: admission.state.transactionId,
				changedState: "none",
				recordedAt: "2026-08-12T11:32:00.000Z",
			});

			const reconciled = await store.load(admission.state.receiptId);
			expect(reconciled).toMatchObject({
				status: "loaded",
				state: {
					taskId: admission.state.taskId,
					state: "closed",
					phase: "terminal",
					checkpoint: "closed",
				},
			});
		} finally {
			await rm(stateRoot, { recursive: true, force: true });
		}
	});

	test("fresh Doctor evidence fails a stale acknowledged worker closed without relaunch", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-task-lost-"));
		try {
			const store = createVaultGitTaskStore({ stateRoot, repositoryIdentity: "repo" });
			const receiptId = "receipt_44444444444444444444444444444444";
			const transactionId = "txn_55555555555555555555555555555555";
			const admission = await store.claimOrJoin({
				claimReceiptId: receiptId,
				receiptId,
				transactionId,
				remote: "origin",
				generation: "c".repeat(40),
				capabilityDigest: "d".repeat(64),
				normalizedInput: '{"command":"complete"}',
				recordedAt: "2026-08-12T11:30:00.000Z",
			});
			if (admission.status === "refused") throw new Error("test admission refused");
			const running = await store.transition(admission.state.taskId, admission.state.revision, {
				state: "in_progress",
				phase: "running",
				updatedAt: "2026-08-12T11:30:01.000Z",
				heartbeatAt: "2026-08-12T11:30:01.000Z",
				checkpoint: "checking",
				launchGeneration: "launch_66666666666666666666666666666666",
				launchExpiresAt: null,
			});
			expect(running.status).toBe("transitioned");

			await reconcileStaleVaultGitTaskFromDoctor(store, receiptId, {
				status: "diagnosed",
				state: "repairable",
				phase: "checking",
				finding: "checks_interrupted",
				changedState: "none",
				retrySafety: "operator_required",
				nextAction: { id: "run_repair", summary: "Repair from fresh evidence." },
				diagnosticsReference: "diag_77777777777777777777777777777777",
				transactionId,
			}, "2026-08-12T11:31:00.000Z", () => false);

			const reconciled = await store.load(receiptId);
			expect(reconciled).toMatchObject({
				status: "loaded",
				state: {
					taskId: admission.state.taskId,
					state: "repair_needed",
					terminalResult: { blocker: "worker_lost" },
				},
			});
		} finally {
			await rm(stateRoot, { recursive: true, force: true });
		}
	});

	test("heartbeat age alone never terminalizes a live worker", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-task-live-"));
		try {
			const store = createVaultGitTaskStore({ stateRoot, repositoryIdentity: "repo-live" });
			const receiptId = "receipt_88888888888888888888888888888888";
			const transactionId = "txn_99999999999999999999999999999999";
			const admission = await store.claimOrJoin({
				claimReceiptId: receiptId,
				receiptId,
				transactionId,
				remote: "origin",
				generation: "e".repeat(40),
				capabilityDigest: "f".repeat(64),
				normalizedInput: '{"command":"complete"}',
				recordedAt: "2026-08-12T11:30:00.000Z",
			});
			if (admission.status === "refused") throw new Error("test admission refused");
			await store.transition(admission.state.taskId, admission.state.revision, {
				state: "in_progress",
				phase: "running",
				updatedAt: "2026-08-12T11:30:01.000Z",
				heartbeatAt: "2026-08-12T11:30:01.000Z",
				checkpoint: "checking",
				launchGeneration: "launch_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				launchExpiresAt: null,
				workerPid: 12345,
				workerProcessIdentity: "a".repeat(64),
			});

			await reconcileStaleVaultGitTaskFromDoctor(store, receiptId, {
				status: "diagnosed",
				state: "repairable",
				phase: "checking",
				finding: "checks_interrupted",
				changedState: "none",
				retrySafety: "operator_required",
				nextAction: { id: "run_repair", summary: "Repair from fresh evidence." },
				diagnosticsReference: "diag_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				transactionId,
			}, "2026-08-12T11:31:00.000Z", () => true);

			const preserved = await store.load(receiptId);
			expect(preserved).toMatchObject({
				status: "loaded",
				state: { state: "in_progress", phase: "running", workerPid: 12345 },
			});
		} finally {
			await rm(stateRoot, { recursive: true, force: true });
		}
	});
});
