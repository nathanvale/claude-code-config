import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	reconcileClosedVaultGitTask,
	reconcileStaleVaultGitTaskFromDoctor,
} from "../src/task-reconciliation.ts";
import {
	createNodeVaultGitDurabilityPort,
	type VaultGitDurabilityPort,
} from "../src/store.ts";
import { createVaultGitTaskStore } from "../src/task-store.ts";

describe("task closure reconciliation", () => {
	test("claim-only closure materializes revision one and preserves the claim task ID", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-task-claim-only-"));
		try {
			const receiptId = "receipt_11111111111111111111111111111111";
			const transactionId = "txn_11111111111111111111111111111111";
			const interrupted = createVaultGitTaskStore({
				stateRoot,
				repositoryIdentity: "repo-claim-only",
				durability: rejectTaskStatePublication(),
			});
			await expect(interrupted.claimOrJoin({
				claimReceiptId: receiptId,
				receiptId,
				transactionId,
				remote: "origin",
				generation: "a".repeat(40),
				capabilityDigest: "b".repeat(64),
				normalizedInput: '{"command":"complete"}',
				recordedAt: "2026-08-12T11:30:00.000Z",
			})).rejects.toThrow("task state durability unavailable");
			const claimedTaskId = JSON.parse(
				await readFile(interrupted.claimPath(receiptId), "utf8"),
			).taskId as string;

			const recovered = createVaultGitTaskStore({
				stateRoot,
				repositoryIdentity: "repo-claim-only",
			});
			await reconcileClosedVaultGitTask(recovered, {
				receiptId,
				transactionId,
				changedState: "none",
				recordedAt: "2026-08-12T11:31:00.000Z",
			});

			expect(await recovered.load(receiptId)).toMatchObject({
				status: "loaded",
				state: { taskId: claimedTaskId, state: "closed", revision: 2 },
			});
		} finally {
			await rm(stateRoot, { recursive: true, force: true });
		}
	});

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

	test("Doctor maps an absent push-pending outcome to unknown", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-task-push-pending-"));
		try {
			const store = createVaultGitTaskStore({ stateRoot, repositoryIdentity: "repo-push" });
			const receiptId = "receipt_12121212121212121212121212121212";
			const transactionId = "txn_34343434343434343434343434343434";
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
				checkpoint: "push_pending",
				launchGeneration: "launch_56565656565656565656565656565656",
				launchExpiresAt: null,
				workerPid: 12345,
				workerProcessIdentity: "a".repeat(64),
			});

			await reconcileStaleVaultGitTaskFromDoctor(store, receiptId, {
				status: "diagnosed",
				state: "absent",
				phase: "push_pending",
				finding: "remote_outcome_unknown",
				changedState: "none",
				retrySafety: "operator_required",
				nextAction: { id: "retry_remote", summary: "Inspect the remote." },
				diagnosticsReference: "diag_78787878787878787878787878787878",
				transactionId,
			}, "2026-08-12T11:31:00.000Z", () => false);

			expect(await store.load(receiptId)).toMatchObject({
				status: "loaded",
				state: {
					state: "unknown",
					checkpoint: "push_pending",
					terminalResult: { blocker: "worker_lost" },
				},
			});
		} finally {
			await rm(stateRoot, { recursive: true, force: true });
		}
	});

	test("an unparsable observation timestamp never terminalizes a dead worker's task", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-task-nan-"));
		try {
			const store = createVaultGitTaskStore({ stateRoot, repositoryIdentity: "repo-nan" });
			const receiptId = "receipt_77777777777777777777777777777777";
			const transactionId = "txn_66666666666666666666666666666666";
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

			// The worker is reported dead, so only the staleness comparison stands
			// between a corrupt timestamp and a terminal write.
			await reconcileStaleVaultGitTaskFromDoctor(store, receiptId, {
				status: "diagnosed",
				state: "repairable",
				phase: "checking",
				finding: "checks_interrupted",
				changedState: "none",
				retrySafety: "operator_required",
				nextAction: { id: "run_repair", summary: "Repair from fresh evidence." },
				diagnosticsReference: "diag_cccccccccccccccccccccccccccccccc",
				transactionId,
			}, "not-a-timestamp", () => false);

			expect(await store.load(receiptId)).toMatchObject({
				status: "loaded",
				state: { state: "in_progress", phase: "running" },
			});
		} finally {
			await rm(stateRoot, { recursive: true, force: true });
		}
	});
});

function rejectTaskStatePublication(): VaultGitDurabilityPort {
	const real = createNodeVaultGitDurabilityPort();
	return {
		async writeTemp(handle, bytes, target) {
			if (target === "task_state") throw new Error("crash before task state write");
			await real.writeTemp(handle, bytes, target);
		},
		syncFile: real.syncFile,
		rename: real.rename,
		linkExclusive: real.linkExclusive,
		syncDirectory: real.syncDirectory,
	};
}
