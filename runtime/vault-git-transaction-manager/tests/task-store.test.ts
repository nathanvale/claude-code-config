import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
	createNodeVaultGitDurabilityPort,
	type VaultGitDurabilityPort,
} from "../src/store.ts";
import { createVaultGitTaskStore } from "../src/task-store.ts";
import { createTempDirectoryFixture } from "./temp-directory-fixture.ts";

const temporaryDirectories = createTempDirectoryFixture();

afterEach(temporaryDirectories.cleanup);

describe("private task store", () => {
	test("one repaired receipt authorizes exactly one fresh attempt under the stable task", async () => {
		const stateRoot = await temporaryDirectories.create(
			"vault-git-task-repair-reentry-",
		);
		const receiptId = "receipt_01010101010101010101010101010101";
		const transactionId = "txn_02020202020202020202020202020202";
		const attemptOneGeneration =
			"launch_03030303030303030303030303030303";
		const stores = Array.from({ length: 20 }, () =>
			createVaultGitTaskStore({ stateRoot, repositoryIdentity: "vault@example" }),
		);
		const input = {
			...taskClaimInput({
				receiptId,
				transactionId,
				leaseGeneration: "a".repeat(40),
				recordedAt: "2026-08-13T09:00:00.000Z",
			}),
			receiptRevision: 2,
		};
		const admitted = await stores[0].claimOrJoin(input);
		if (admitted.status === "refused") throw new Error("test claim refused");
		const failed = await stores[0].transition(
			admitted.state.taskId,
			admitted.state.revision,
			{
				state: "repair_needed",
				phase: "terminal",
				updatedAt: "2026-08-13T09:00:01.000Z",
				heartbeatAt: null,
				checkpoint: "repairable",
				launchGeneration: attemptOneGeneration,
				launchAttempt: 1,
				terminalResult: {
					outcome: "refused",
					phase: "repairable",
					changedState: "local",
					blocker: "vault_check_failed",
					retrySafety: "same_input_unsafe",
				},
			},
		);
		expect(failed.status).toBe("transitioned");

		const repairEvidence = {
			receiptId,
			transactionId,
			leaseGeneration: "a".repeat(40),
			repairedReceiptRevision: 3,
			recordedAt: "2026-08-13T09:00:02.000Z",
		} as const;
		const interrupted = createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: "vault@example",
			durability: recordingTaskDurabilityPort([], 0),
		});
		await expect(interrupted.authorizeRepair(repairEvidence)).rejects.toThrow(
			"task state durability unavailable",
		);
		const authorized = await stores[0].authorizeRepair(repairEvidence);
		expect(authorized).toMatchObject({
			status: "transitioned",
			state: {
				taskId: admitted.state.taskId,
				attemptNumber: 1,
				state: "repair_needed",
				repairAuthorization: {
					failedAttemptNumber: 1,
					repairedReceiptRevision: 3,
				},
			},
		});
		expect(await stores[1].authorizeRepair(repairEvidence)).toMatchObject({
			status: "existing",
			state: { repairAuthorization: { repairedReceiptRevision: 3 } },
		});

		const repairedInput = {
			...input,
			receiptRevision: 3,
			recordedAt: "2026-08-13T09:00:03.000Z",
		};
		expect(await stores[1].claimOrJoin({
			...repairedInput,
			normalizedInput: '{"command":"complete","summary":"changed"}',
		})).toEqual({
			status: "refused",
			launch: "refused",
			reason: "task_input_mismatch",
		});
		expect(await stores[0].load(receiptId)).toMatchObject({
			status: "loaded",
			state: { attemptNumber: 1, repairAuthorization: { repairedReceiptRevision: 3 } },
		});
		const selected = await Promise.all(
			stores.map((store) => store.claimOrJoin(repairedInput)),
		);
		expect(selected.filter((result) => result.launch === "winner")).toHaveLength(1);
		expect(selected.filter((result) => result.launch === "joined")).toHaveLength(19);
		for (const result of selected) {
			if (result.status === "refused") throw new Error("repaired claim refused");
			expect(result.state).toMatchObject({
				taskId: admitted.state.taskId,
				attemptNumber: 2,
				state: "claimed",
				phase: "admitted",
				launchAttempt: 0,
				terminalResult: null,
				previousTerminalResult: { blocker: "vault_check_failed" },
				repairAuthorization: null,
			});
		}
		const latest = await stores[0].load(receiptId);
		if (latest.status !== "loaded") throw new Error("repaired task missing");
		const lateAttemptOne = await stores[0].transition(
			latest.state.taskId,
			latest.state.revision,
			{
				state: "repair_needed",
				phase: "terminal",
				updatedAt: "2026-08-13T09:00:04.000Z",
				heartbeatAt: null,
				checkpoint: "repairable",
				launchGeneration: attemptOneGeneration,
				terminalResult: {
					outcome: "refused",
					phase: "repairable",
					changedState: "local",
					blocker: "vault_check_failed",
					retrySafety: "same_input_unsafe",
				},
			},
			{ expectedLaunchGeneration: attemptOneGeneration },
		);
		expect(lateAttemptOne).toMatchObject({
			status: "stale",
			state: { attemptNumber: 2, state: "claimed" },
		});
		const failedHistory = JSON.parse(
			await readFile(
				join(
					stores[0].paths.tasks,
					admitted.state.taskId,
					"history",
					`${String(failed.state.revision).padStart(12, "0")}.json`,
				),
				"utf8",
			),
		);
		expect(failedHistory).toMatchObject({
			attemptNumber: 1,
			state: "repair_needed",
			terminalResult: { blocker: "vault_check_failed" },
		});
	});

	test("persists the bounded validation-failure projection durably and reloads it for later routing", async () => {
		const stateRoot = await temporaryDirectories.create(
			"vault-git-task-validation-failure-",
		);
		const store = createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: "vault@example",
		});
		const admitted = await store.claimOrJoin(
			taskClaimInput({
				receiptId: "receipt_0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a",
				transactionId: "txn_0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
				leaseGeneration: "a".repeat(40),
				recordedAt: "2026-08-17T09:00:00.000Z",
			}),
		);
		if (admitted.status === "refused") throw new Error("test claim refused");
		const failed = await store.transition(
			admitted.state.taskId,
			admitted.state.revision,
			{
				state: "repair_needed",
				phase: "terminal",
				updatedAt: "2026-08-17T09:00:01.000Z",
				heartbeatAt: null,
				checkpoint: "checking",
				launchGeneration: "launch_0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c",
				launchAttempt: 1,
				terminalResult: {
					outcome: "refused",
					phase: "checking",
					changedState: "local",
					blocker: "completion_interrupted",
					retrySafety: "same_input_safe",
					validationFailure: {
						failureClass: "stage_budget_exceeded",
						stage: "vault_check",
					},
				},
			},
		);
		expect(failed.status).toBe("transitioned");
		const reloaded = await createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: "vault@example",
		}).loadByTaskId(admitted.state.taskId);
		expect(reloaded).toMatchObject({
			status: "loaded",
			state: {
				state: "repair_needed",
				terminalResult: {
					blocker: "completion_interrupted",
					validationFailure: {
						failureClass: "stage_budget_exceeded",
						stage: "vault_check",
					},
				},
			},
		});
	});

	test("uses the exact repository namespace selected by the receipt store", async () => {
		const stateRoot = await temporaryDirectories.create("vault-git-task-namespace-");
		const repositoryId = "a".repeat(64);
		const store = createVaultGitTaskStore({ stateRoot, repositoryId });
		expect(store.repositoryId).toBe(repositoryId);
		expect(store.paths.repositoryRoot).toBe(
			join(stateRoot, "vault-git-transaction-manager", repositoryId),
		);
	});
	test("twenty identical claim-or-join calls select one task and one launch winner while changed bindings refuse", async () => {
		const stateRoot = await temporaryDirectories.create(
			"vault-git-task-single-flight-",
		);
		const claimReceiptId = "receipt_11111111111111111111111111111111";
		const stores = Array.from({ length: 20 }, () =>
			createVaultGitTaskStore({
				stateRoot,
				repositoryIdentity: "vault@example",
			}),
		);
		const input = {
			claimReceiptId,
			receiptId: claimReceiptId,
			transactionId: "txn_22222222222222222222222222222222",
			remote: "origin",
			generation: "a".repeat(40),
			capabilityDigest: "c".repeat(64),
			normalizedInput:
				'{"command":"complete","summary":"PRIVATE-SUMMARY-CANARY"}',
			recordedAt: "2026-08-12T13:00:00.000Z",
		} as const;

		const selected = await Promise.all(
			stores.map((store) => store.claimOrJoin(input)),
		);
		const taskIds = new Set(
			selected.flatMap((result) =>
				result.status === "refused" ? [] : [result.state.taskId],
			),
		);

		expect(selected.filter((result) => result.launch === "winner")).toHaveLength(1);
		expect(selected.filter((result) => result.launch === "joined")).toHaveLength(19);
		expect(taskIds.size).toBe(1);

		const mismatches = [
			{ ...input, transactionId: "txn_33333333333333333333333333333333" },
			{ ...input, receiptId: "receipt_44444444444444444444444444444444" },
			{ ...input, remote: "staging" },
			{ ...input, generation: "b".repeat(40) },
			{ ...input, capabilityDigest: "d".repeat(64) },
			{
				...input,
				normalizedInput:
					'{"command":"complete","summary":"changed normalized input"}',
			},
		] as const;
		for (const mismatch of mismatches) {
			expect(await stores[0].claimOrJoin(mismatch)).toEqual({
				status: "refused",
				launch: "refused",
				reason: "task_input_mismatch",
			});
		}

		const claimSource = await readFile(stores[0].claimPath(claimReceiptId), "utf8");
		expect(claimSource).not.toContain("PRIVATE-SUMMARY-CANARY");
		expect(await readdir(stores[0].paths.claims)).toEqual([
			`${claimReceiptId}.json`,
		]);
	});

	test("twenty concurrent admissions create one immutable receipt claim and one opaque task id", async () => {
		const stateRoot = await temporaryDirectories.create("vault-git-task-store-");
		const receiptId = "receipt_22222222222222222222222222222222";
		const stores = Array.from({ length: 20 }, () =>
			createVaultGitTaskStore({
				stateRoot,
				repositoryIdentity: "vault@example",
			}),
		);

		const admissions = await Promise.all(
			stores.map((store) =>
				store.claimOrJoin(taskClaimInput({
					receiptId,
					transactionId: "txn_22222222222222222222222222222222",
					leaseGeneration: "a".repeat(40),
					recordedAt: "2026-08-12T11:45:00.000Z",
				})),
			),
		);
		const admittedStates = admissions.flatMap((admission) =>
			admission.status === "refused" ? [] : [admission.state],
		);
		const taskIds = new Set(admittedStates.map((state) => state.taskId));

		expect(admissions.filter((admission) => admission.status === "created")).toHaveLength(1);
		expect(admittedStates).toHaveLength(20);
		expect(taskIds.size).toBe(1);
		expect([...taskIds][0]).toMatch(/^task_[0-9a-f]{32}$/);
		expect([...taskIds][0]).not.toContain(receiptId.slice("receipt_".length));
		expect(admittedStates.every((state) => Object.isFrozen(state))).toBe(true);

		const claimNames = await readdir(stores[0].paths.claims);
		expect(claimNames).toEqual([`${receiptId}.json`]);
		const claimPath = stores[0].claimPath(receiptId);
		const claimSource = await readFile(claimPath, "utf8");
		expect(Object.keys(JSON.parse(claimSource)).sort()).toEqual([
			"attemptNumber",
			"bindingDigest",
			"checkpoint",
			"heartbeatAt",
			"launchAttempt",
			"launchExpiresAt",
			"launchGeneration",
			"leaseGeneration",
			"phase",
			"previousTerminalResult",
			"receiptId",
			"recordedAt",
			"repairAuthorization",
			"repairReentryBlocked",
			"revision",
			"schemaVersion",
			"state",
			"taskId",
			"terminalResult",
			"transactionId",
			"updatedAt",
			"workerPid",
			"workerProcessIdentity",
		]);
		expect(claimSource).not.toMatch(/capability|secret|token/i);
		expect((await stat(stores[0].paths.claims)).mode & 0o777).toBe(0o700);
		expect((await stat(claimPath)).mode & 0o777).toBe(0o600);

		const later = await stores[0].claimOrJoin(taskClaimInput({
			receiptId,
			transactionId: "txn_22222222222222222222222222222222",
			leaseGeneration: "a".repeat(40),
			recordedAt: "2026-08-12T11:46:00.000Z",
		}));
		expect(later).toEqual({
			status: "existing",
			launch: "joined",
			state: admittedStates[0],
		});
		expect(await stores[0].load(receiptId)).toEqual({
			status: "loaded",
			state: admittedStates[0],
		});
	});

	test("publishes one claim through the exact durable compare-and-set order", async () => {
		const stateRoot = await temporaryDirectories.create("vault-git-task-order-");
		const calls: TaskDurabilityCall[] = [];
		const store = createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: "vault@example",
			durability: recordingTaskDurabilityPort(calls),
		});

		const admitted = await store.claimOrJoin(taskClaimInput({
			receiptId: "receipt_33333333333333333333333333333333",
			transactionId: "txn_33333333333333333333333333333333",
			leaseGeneration: "a".repeat(40),
			recordedAt: "2026-08-12T12:30:00.000Z",
		}));
		if (admitted.status === "refused") throw new Error("test claim refused");

		expect(calls.slice(0, 4)).toEqual([
			{ method: "writeTemp", target: "task_claim" },
			{ method: "syncFile", target: "task_claim" },
			{ method: "linkExclusive", target: "task_claim" },
			{ method: "syncDirectory", target: "task_claim" },
		]);
		expect(calls).toEqual([
			...taskDurabilityCalls("task_claim"),
			...taskDurabilityCalls("task_state"),
		]);
		expect(await readdir(join(store.paths.tasks, admitted.state.taskId))).toEqual([
			"history",
		]);
		expect(await store.load(admitted.state.receiptId)).toEqual({
			status: "loaded",
			state: admitted.state,
		});
	});

	test("fails closed before join-path directory sync and retry converges on the original claim", async () => {
		const stateRoot = await temporaryDirectories.create(
			"vault-git-task-join-sync-",
		);
		const receiptId = "receipt_55555555555555555555555555555555";
		const input = {
			receiptId,
			transactionId: "txn_55555555555555555555555555555555",
			leaseGeneration: "a".repeat(40),
			recordedAt: "2026-08-12T12:32:00.000Z",
		} as const;
		const originalStore = createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: "vault@example",
		});
		const original = await originalStore.claimOrJoin(taskClaimInput(input));
		if (original.status === "refused") throw new Error("test claim refused");
		expect(original.status).toBe("created");

		const calls: TaskDurabilityCall[] = [];
		const interruptedJoiner = createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: "vault@example",
			durability: recordingTaskDurabilityPort(calls, 3),
		});
		let failure: unknown;
		try {
			await interruptedJoiner.claimOrJoin(taskClaimInput(input));
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe(
			"task claim durability unavailable",
		);
		expect((failure as Error).cause).toBeInstanceOf(Error);
		expect(((failure as Error).cause as Error).message).toBe(
			"crash before syncDirectory",
		);
		expect(calls).toEqual([
			{ method: "writeTemp", target: "task_claim" },
			{ method: "syncFile", target: "task_claim" },
			{ method: "linkExclusive", target: "task_claim" },
		]);
		expect(await interruptedJoiner.load(receiptId)).toEqual({
			status: "loaded",
			state: original.state,
		});

		const retry = await createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: "vault@example",
		}).claimOrJoin(taskClaimInput(input));
		expect(retry).toEqual({
			status: "existing",
			launch: "joined",
			state: original.state,
		});
		expect(await readdir(originalStore.paths.claims)).toEqual([
			`${receiptId}.json`,
		]);
	});

	for (const [crashAt, method] of [
		[0, "writeTemp"],
		[1, "syncFile"],
		[2, "linkExclusive"],
		[3, "syncDirectory"],
	] as const) {
		test(`fails closed when ${method} cannot finish and preserves any published claim`, async () => {
			const stateRoot = await temporaryDirectories.create(
				`vault-git-task-${method}-`,
			);
			const calls: TaskDurabilityCall[] = [];
			const receiptId = "receipt_44444444444444444444444444444444";
			const store = createVaultGitTaskStore({
				stateRoot,
				repositoryIdentity: "vault@example",
				durability: recordingTaskDurabilityPort(calls, crashAt),
			});

			await expect(
				store.claimOrJoin(taskClaimInput({
					receiptId,
					transactionId: "txn_44444444444444444444444444444444",
					leaseGeneration: "a".repeat(40),
					recordedAt: "2026-08-12T12:31:00.000Z",
				})),
			).rejects.toThrow("task claim durability unavailable");
			expect(calls.map((call) => call.method)).toEqual(
				taskClaimDurabilityOrder.slice(0, crashAt),
			);

			const probe = createVaultGitTaskStore({
				stateRoot,
				repositoryIdentity: "vault@example",
			});
			const loaded = await probe.load(receiptId);
			if (method === "syncDirectory") {
				expect(loaded).toMatchObject({
					status: "loaded",
					state: { receiptId, revision: 1, phase: "admitted" },
				});
				expect(await readdir(probe.paths.claims)).toEqual([
					`${receiptId}.json`,
				]);
			} else {
				expect(loaded).toEqual({ status: "absent" });
				expect(await readdir(probe.paths.claims)).toEqual([]);
			}
		});
	}

	for (const [taskStateOffset, method] of [
		[0, "writeTemp"],
		[1, "syncFile"],
		[2, "linkExclusive"],
		[3, "syncDirectory"],
	] as const) {
		test(`preserves the claim when task-state ${method} is interrupted and explicit materialization recovers`, async () => {
			const stateRoot = await temporaryDirectories.create(
				`vault-git-task-state-${method}-`,
			);
			const calls: TaskDurabilityCall[] = [];
			const receiptId = "receipt_89898989898989898989898989898989";
			const transactionId = "txn_78787878787878787878787878787878";
			const store = createVaultGitTaskStore({
				stateRoot,
				repositoryIdentity: "vault@example",
				durability: recordingTaskDurabilityPort(calls, 4 + taskStateOffset),
			});

			await expect(store.claimOrJoin(taskClaimInput({
				receiptId,
				transactionId,
				leaseGeneration: "a".repeat(40),
				recordedAt: "2026-08-12T12:31:00.000Z",
			}))).rejects.toThrow("task state durability unavailable");
			expect(calls).toEqual([
				...taskDurabilityCalls("task_claim"),
				...taskDurabilityCalls("task_state").slice(0, taskStateOffset),
			]);

			const recovered = createVaultGitTaskStore({
				stateRoot,
				repositoryIdentity: "vault@example",
			});
			expect(await recovered.materializeClaimState(receiptId, transactionId)).toMatchObject({
				status: "loaded",
				state: { receiptId, transactionId, revision: 1 },
			});
		});
	}

	test("refuses a terminal write from a superseded launch generation", async () => {
		const stateRoot = await temporaryDirectories.create(
			"vault-git-task-stale-generation-",
		);
		const receiptId = "receipt_55555555555555555555555555555555";
		const store = createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: "vault@example",
		});
		const admitted = await store.claimOrJoin(taskClaimInput({
			receiptId,
			transactionId: "txn_55555555555555555555555555555555",
			leaseGeneration: "a".repeat(40),
			recordedAt: "2026-08-12T14:00:00.000Z",
		}));
		if (admitted.status === "refused") throw new Error("test claim refused");
		const taskId = admitted.state.taskId;
		const stale = "launch_11111111111111111111111111111111";
		const live = "launch_22222222222222222222222222222222";

		const launching = await store.transition(taskId, admitted.state.revision, {
			state: "launching",
			phase: "admitted",
			updatedAt: "2026-08-12T14:00:01.000Z",
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration: live,
			launchExpiresAt: "2026-08-12T14:00:03.000Z",
			workerPid: 4242,
			workerProcessIdentity: "d".repeat(64),
		});
		if (launching.status !== "transitioned") throw new Error("launch setup failed");
		const running = await store.transition(taskId, launching.state.revision, {
			state: "in_progress",
			phase: "running",
			updatedAt: "2026-08-12T14:00:02.000Z",
			heartbeatAt: "2026-08-12T14:00:02.000Z",
			checkpoint: "checking",
			launchGeneration: live,
			launchExpiresAt: null,
			workerPid: 4242,
			workerProcessIdentity: "d".repeat(64),
		});
		if (running.status !== "transitioned") throw new Error("running setup failed");

		const refused = await store.transition(
			taskId,
			running.state.revision,
			{
				state: "repair_needed",
				phase: "terminal",
				updatedAt: "2026-08-12T14:00:04.000Z",
				heartbeatAt: "2026-08-12T14:00:04.000Z",
				checkpoint: "checking",
				launchGeneration: stale,
				launchExpiresAt: null,
				workerPid: 9999,
				workerProcessIdentity: "e".repeat(64),
				terminalResult: {
					outcome: "refused",
					phase: "checking",
					changedState: "none",
					blocker: "human_required",
					retrySafety: "operator_required",
				},
			},
			{ expectedLaunchGeneration: stale },
		);

		expect(refused.status).toBe("stale");
		const current = await store.loadByTaskId(taskId);
		expect(current).toMatchObject({
			status: "loaded",
			state: { state: "in_progress", phase: "running", launchGeneration: live },
		});
	});

	test("refuses a transition published against a superseded revision", async () => {
		const stateRoot = await temporaryDirectories.create(
			"vault-git-task-stale-revision-",
		);
		const store = createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: "vault@example",
		});
		const admitted = await store.claimOrJoin(taskClaimInput({
			receiptId: "receipt_66666666666666666666666666666666",
			transactionId: "txn_66666666666666666666666666666666",
			leaseGeneration: "a".repeat(40),
			recordedAt: "2026-08-12T15:00:00.000Z",
		}));
		if (admitted.status === "refused") throw new Error("test claim refused");
		const taskId = admitted.state.taskId;
		const staleRevision = admitted.state.revision;

		const advanced = await store.transition(taskId, staleRevision, {
			state: "launching",
			phase: "admitted",
			updatedAt: "2026-08-12T15:00:01.000Z",
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration: "launch_33333333333333333333333333333333",
			launchExpiresAt: "2026-08-12T15:00:03.000Z",
			workerPid: 4242,
			workerProcessIdentity: "d".repeat(64),
		});
		if (advanced.status !== "transitioned") throw new Error("launch setup failed");

		const replayed = await store.transition(taskId, staleRevision, {
			state: "launching",
			phase: "admitted",
			updatedAt: "2026-08-12T15:00:02.000Z",
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration: "launch_44444444444444444444444444444444",
			launchExpiresAt: "2026-08-12T15:00:04.000Z",
			workerPid: 5252,
			workerProcessIdentity: "e".repeat(64),
		});

		expect(replayed.status).toBe("stale");
		expect(await store.loadByTaskId(taskId)).toMatchObject({
			status: "loaded",
			state: {
				revision: advanced.state.revision,
				launchGeneration: "launch_33333333333333333333333333333333",
				workerPid: 4242,
			},
		});
	});

	test("an unknown task transition does not create task state directories", async () => {
		const stateRoot = await temporaryDirectories.create("vault-git-task-unknown-");
		const store = createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: "vault@example",
		});
		const taskId = "task_77777777777777777777777777777777";

		await expect(store.transition(taskId, 1, {
			state: "launching",
			phase: "admitted",
			updatedAt: "2026-08-12T15:00:01.000Z",
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration: "launch_77777777777777777777777777777777",
			launchExpiresAt: "2026-08-12T15:00:03.000Z",
		})).rejects.toThrow("task state unavailable: absent");
		await expect(stat(join(store.paths.tasks, taskId))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
});

interface TaskDurabilityCall {
	readonly method: keyof VaultGitDurabilityPort;
	readonly target: string;
}

function taskClaimInput(input: {
	readonly receiptId: string;
	readonly transactionId: string;
	readonly leaseGeneration: string;
	readonly recordedAt: string;
}) {
	return {
		claimReceiptId: input.receiptId,
		receiptId: input.receiptId,
		transactionId: input.transactionId,
		remote: "origin",
		generation: input.leaseGeneration,
		capabilityDigest: "0".repeat(64),
		normalizedInput: '{"command":"complete"}',
		recordedAt: input.recordedAt,
	};
}

const taskClaimDurabilityOrder = [
	"writeTemp",
	"syncFile",
	"linkExclusive",
	"syncDirectory",
] as const satisfies readonly (keyof VaultGitDurabilityPort)[];

function taskDurabilityCalls(target: "task_claim" | "task_state") {
	return taskClaimDurabilityOrder.map((method) => ({ method, target }));
}

/** Real durability operations with deterministic pre-operation interruption. */
function recordingTaskDurabilityPort(
	calls: TaskDurabilityCall[],
	crashAt = -1,
): VaultGitDurabilityPort {
	const real = createNodeVaultGitDurabilityPort();
	let index = 0;
	const run = async (
		method: keyof VaultGitDurabilityPort,
		target: string,
		operation: () => Promise<void>,
	): Promise<void> => {
		if (index === crashAt) {
			index += 1;
			throw new Error(`crash before ${method}`);
		}
		index += 1;
		calls.push({ method, target });
		await operation();
	};
	return {
		async writeTemp(handle, bytes, target) {
			await run("writeTemp", target, () =>
				real.writeTemp(handle, bytes, target),
			);
		},
		async syncFile(handle, target) {
			await run("syncFile", target, () => real.syncFile(handle, target));
		},
		async rename(from, to, target) {
			await run("rename", target, () => real.rename(from, to, target));
		},
		async linkExclusive(from, to, target) {
			await run("linkExclusive", target, () =>
				real.linkExclusive(from, to, target),
			);
		},
		async syncDirectory(path, target) {
			await run("syncDirectory", target, () =>
				real.syncDirectory(path, target),
			);
		},
	};
}
