import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createVaultGitDoctorTaskLifecycle } from "../src/doctor-task-lifecycle.ts";
import { createVaultGitDoctorTaskStore } from "../src/doctor-task-store.ts";

const roots: string[] = [];

function loadPersistedTask(root: string, repositoryId: string, taskId: string) {
	return createVaultGitDoctorTaskStore({
		stateRoot: root,
		repositoryId,
	}).loadByTaskId(taskId);
}

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("Background Doctor Task Lifecycle", () => {
	test("stops the exact worker when durable registration throws", async () => {
		for (const failurePoint of ["identity", "transition"] as const) {
			const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-lifecycle-"));
			roots.push(root);
			const repositoryId = "a".repeat(64);
			const durableStore = createVaultGitDoctorTaskStore({
				stateRoot: root,
				repositoryId,
			});
			const store = {
				...durableStore,
				async transition(
					...args: Parameters<typeof durableStore.transition>
				) {
					if (failurePoint === "transition" && args[2].workerPid === 42) {
						throw new Error("registration unavailable");
					}
					return durableStore.transition(...args);
				},
			};
			const stoppedPids: number[] = [];
			const lifecycle = createVaultGitDoctorTaskLifecycle({
				store,
				spawnContext: undefined,
				runtime: {
					now: () => 0,
					recordedAt: () => new Date("2026-08-15T01:00:00.000Z"),
					sleep: async () => undefined,
					spawnWorker: () => 42,
					readProcessIdentity() {
						if (failurePoint === "identity") {
							throw new Error("identity unavailable");
						}
						return "f".repeat(64);
					},
					stopUnacknowledgedWorker(pid) {
						stoppedPids.push(pid);
					},
					stopExpiredWorker: async () => false,
					processIdentityMatches: () => true,
				},
			});

			await expect(
				lifecycle.launch({
					binding: {
						repositoryId,
						activationEvidenceId: null,
						receiptId: `receipt_${"b".repeat(32)}`,
						receiptRevision: 7,
						transactionId: `txn_${"c".repeat(32)}`,
						normalizedInput: '{"command":"doctor"}',
					},
					acknowledgementStartedAt: 0,
					createLaunchGeneration: () => `doctor_launch_${"d".repeat(32)}`,
					args: ["doctor", "--json"],
				}),
			).rejects.toThrow(
				failurePoint === "identity"
					? "identity unavailable"
					: "registration unavailable",
			);
			expect(stoppedPids).toEqual([42]);
		}
	});

	test("returns only after one exact worker durably acknowledges", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-lifecycle-"));
		roots.push(root);
		const repositoryId = "a".repeat(64);
		const store = createVaultGitDoctorTaskStore({
			stateRoot: root,
			repositoryId,
		});
		const acknowledgementWriter = createVaultGitDoctorTaskStore({
			stateRoot: root,
			repositoryId,
		});
		let monotonicNow = 100;
		let wallNow = Date.parse("2026-08-15T01:00:00.000Z");
		let spawned:
			| { readonly taskId: string; readonly launchGeneration: string }
			| undefined;
		let spawnCount = 0;
		const lifecycle = createVaultGitDoctorTaskLifecycle({
			store,
			spawnContext: { repositoryId },
			runtime: {
				now: () => monotonicNow,
				recordedAt: () => new Date(wallNow),
				async sleep(milliseconds) {
					monotonicNow += milliseconds;
					wallNow += milliseconds;
					if (!spawned) return;
					const loaded = await acknowledgementWriter.loadByTaskId(spawned.taskId);
					if (loaded.status !== "loaded" || loaded.state.state !== "launching") {
						return;
					}
					await acknowledgementWriter.transition(
						spawned.taskId,
						loaded.state.revision,
						{
							state: "in_progress",
							phase: "running",
							updatedAt: new Date(wallNow).toISOString(),
							heartbeatAt: new Date(wallNow).toISOString(),
							checkpoint: "checking_remote",
							launchGeneration: spawned.launchGeneration,
							launchExpiresAt: null,
							workerPid: loaded.state.workerPid,
							workerProcessIdentity: loaded.state.workerProcessIdentity,
							launchAttempt: loaded.state.launchAttempt,
							terminalResult: null,
						},
						spawned.launchGeneration,
					);
				},
				spawnWorker(_context, taskId, launchGeneration) {
					spawnCount += 1;
					spawned = { taskId, launchGeneration };
					return 42;
				},
				readProcessIdentity: () => "f".repeat(64),
				stopUnacknowledgedWorker() {},
				stopExpiredWorker: async () => false,
				processIdentityMatches: () => true,
			},
		});

		const outcome = await lifecycle.launch({
			binding: {
				repositoryId,
				activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
				receiptId: `receipt_${"b".repeat(32)}`,
				receiptRevision: 7,
				transactionId: `txn_${"c".repeat(32)}`,
				normalizedInput: '{"command":"doctor"}',
			},
			acknowledgementStartedAt: 100,
			createLaunchGeneration: () => `doctor_launch_${"d".repeat(32)}`,
			args: ["doctor", "--json"],
		});

		expect(outcome).toMatchObject({
			kind: "settled",
			state: {
				state: "in_progress",
				phase: "running",
				workerPid: 42,
				launchGeneration: `doctor_launch_${"d".repeat(32)}`,
			},
		});
		expect(spawnCount).toBe(1);
		if (outcome.kind !== "settled") throw new Error("Doctor launch refused");
		const retryAfterAcknowledgement = await lifecycle.launch({
			binding: {
				repositoryId,
				activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
				receiptId: `receipt_${"b".repeat(32)}`,
				receiptRevision: 7,
				transactionId: `txn_${"c".repeat(32)}`,
				normalizedInput: '{"command":"doctor"}',
			},
			acknowledgementStartedAt: monotonicNow,
			createLaunchGeneration: () => `doctor_launch_${"9".repeat(32)}`,
			args: ["doctor", "--json"],
		});
		expect(retryAfterAcknowledgement).toMatchObject({
			kind: "settled",
			state: { taskId: outcome.state.taskId, state: "in_progress" },
		});
		expect(spawnCount).toBe(1);
		await expect(loadPersistedTask(root, repositoryId, outcome.state.taskId)).resolves.toMatchObject(
			{
				status: "loaded",
				state: {
					state: "in_progress",
					workerPid: 42,
					workerProcessIdentity: "f".repeat(64),
				},
			},
		);
	});

		test("accepts durable acknowledgement after the p95 target but before the protocol ceiling", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-lifecycle-"));
		roots.push(root);
		const repositoryId = "a".repeat(64);
		const store = createVaultGitDoctorTaskStore({ stateRoot: root, repositoryId });
		const acknowledgementWriter = createVaultGitDoctorTaskStore({
			stateRoot: root,
			repositoryId,
		});
		let monotonicNow = 0;
		let wallNow = Date.parse("2026-08-15T01:00:00.000Z");
		let spawned:
			| { readonly taskId: string; readonly launchGeneration: string }
			| undefined;
		let acknowledged = false;
		const lifecycle = createVaultGitDoctorTaskLifecycle({
			store,
			spawnContext: { repositoryId },
			runtime: {
				now: () => monotonicNow,
				recordedAt: () => new Date(wallNow),
				async sleep() {
					monotonicNow += 100;
					wallNow += 100;
					if (!spawned || acknowledged || monotonicNow < 1_200) return;
					const loaded = await acknowledgementWriter.loadByTaskId(spawned.taskId);
					if (loaded.status !== "loaded") throw new Error("Doctor task unavailable");
					const result = await acknowledgementWriter.transition(
						spawned.taskId,
						loaded.state.revision,
						{
							state: "in_progress",
							phase: "running",
							updatedAt: new Date(wallNow).toISOString(),
							heartbeatAt: new Date(wallNow).toISOString(),
							checkpoint: "checking_remote",
							launchGeneration: spawned.launchGeneration,
							launchExpiresAt: null,
							workerPid: loaded.state.workerPid,
							workerProcessIdentity: loaded.state.workerProcessIdentity,
							launchAttempt: loaded.state.launchAttempt,
							terminalResult: null,
						},
						spawned.launchGeneration,
					);
					acknowledged = result.status === "transitioned";
				},
				spawnWorker(_context, taskId, launchGeneration) {
					spawned = { taskId, launchGeneration };
					return 42;
				},
				readProcessIdentity: () => "f".repeat(64),
				stopUnacknowledgedWorker() {},
				stopExpiredWorker: async () => false,
				processIdentityMatches: () => true,
			},
		});

		const outcome = await lifecycle.launch({
			binding: {
				repositoryId,
				activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
				receiptId: `receipt_${"b".repeat(32)}`,
				receiptRevision: 7,
				transactionId: `txn_${"c".repeat(32)}`,
				normalizedInput: '{"command":"doctor"}',
			},
			acknowledgementStartedAt: 0,
			createLaunchGeneration: () => `doctor_launch_${"d".repeat(32)}`,
			args: ["doctor", "--json"],
		});

		expect(outcome).toMatchObject({
			kind: "settled",
			state: { state: "in_progress", workerPid: 42 },
		});
		expect(monotonicNow).toBe(1_200);
		await expect(
			loadPersistedTask(root, repositoryId, outcome.state.taskId),
		).resolves.toMatchObject({
			status: "loaded",
			state: { state: "in_progress", workerPid: 42 },
		});
	});

	test("replaces one expired unacknowledged launch after stopping its exact process", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-lifecycle-"));
		roots.push(root);
		const repositoryId = "a".repeat(64);
		const store = createVaultGitDoctorTaskStore({ stateRoot: root, repositoryId });
		const binding = {
			repositoryId,
			activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: `txn_${"c".repeat(32)}`,
			normalizedInput: '{"command":"doctor"}',
		} as const;
		const admitted = await store.claimOrJoin(
			binding,
			"2026-08-15T01:00:00.000Z",
		);
		const firstGeneration = `doctor_launch_${"1".repeat(32)}`;
		const firstLaunch = await store.transition(
			admitted.state.taskId,
			admitted.state.revision,
			{
				state: "launching",
				phase: "admitted",
				updatedAt: "2026-08-15T01:00:00.100Z",
				heartbeatAt: null,
				checkpoint: "local_classified",
				launchGeneration: firstGeneration,
				launchExpiresAt: "2026-08-15T01:00:01.000Z",
				workerPid: 41,
				workerProcessIdentity: "f".repeat(64),
				launchAttempt: 1,
				terminalResult: null,
			},
		);
		expect(firstLaunch.status).toBe("transitioned");

		let monotonicNow = 2_000;
		let wallNow = Date.parse("2026-08-15T01:00:02.000Z");
		let replacement:
			| { readonly taskId: string; readonly launchGeneration: string }
			| undefined;
		const stopped: Array<{ pid: number | null; identity: string | null }> = [];
		const lifecycle = createVaultGitDoctorTaskLifecycle({
			store,
			spawnContext: undefined,
			runtime: {
				now: () => monotonicNow,
				recordedAt: () => new Date(wallNow),
				async sleep(milliseconds) {
					monotonicNow += milliseconds;
					wallNow += milliseconds;
					if (!replacement) return;
					const loaded = await store.loadByTaskId(replacement.taskId);
					if (loaded.status !== "loaded" || loaded.state.state !== "launching") {
						return;
					}
					await store.transition(
						replacement.taskId,
						loaded.state.revision,
						{
							state: "in_progress",
							phase: "running",
							updatedAt: new Date(wallNow).toISOString(),
							heartbeatAt: new Date(wallNow).toISOString(),
							checkpoint: "checking_remote",
							launchGeneration: replacement.launchGeneration,
							launchExpiresAt: null,
							workerPid: loaded.state.workerPid,
							workerProcessIdentity: loaded.state.workerProcessIdentity,
							launchAttempt: loaded.state.launchAttempt,
							terminalResult: null,
						},
						replacement.launchGeneration,
					);
				},
				spawnWorker(_context, taskId, launchGeneration) {
					replacement = { taskId, launchGeneration };
					return 42;
				},
				readProcessIdentity: () => "a".repeat(64),
				stopUnacknowledgedWorker() {},
				async stopExpiredWorker(pid, identity) {
					stopped.push({ pid, identity });
					return true;
				},
				processIdentityMatches: () => true,
			},
		});

		const outcome = await lifecycle.launch({
			binding,
			acknowledgementStartedAt: monotonicNow,
			createLaunchGeneration: () => `doctor_launch_${"2".repeat(32)}`,
			args: ["doctor", "--json"],
		});

		expect(stopped).toEqual([{ pid: 41, identity: "f".repeat(64) }]);
		expect(outcome).toMatchObject({
			kind: "settled",
			state: {
				taskId: admitted.state.taskId,
				state: "in_progress",
				launchAttempt: 2,
				launchGeneration: `doctor_launch_${"2".repeat(32)}`,
				workerPid: 42,
			},
		});
		await expect(
			loadPersistedTask(root, repositoryId, admitted.state.taskId),
		).resolves.toMatchObject({
			status: "loaded",
			state: {
				state: "in_progress",
				launchAttempt: 2,
				launchGeneration: `doctor_launch_${"2".repeat(32)}`,
				workerPid: 42,
			},
		});
	});

	test("terminalizes an exhausted second unacknowledged launch without a third worker", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-lifecycle-"));
		roots.push(root);
		const repositoryId = "a".repeat(64);
		const store = createVaultGitDoctorTaskStore({ stateRoot: root, repositoryId });
		const binding = {
			repositoryId,
			activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: `txn_${"c".repeat(32)}`,
			normalizedInput: '{"command":"doctor"}',
		} as const;
		const admitted = await store.claimOrJoin(
			binding,
			"2026-08-15T01:00:00.000Z",
		);
		const secondGeneration = `doctor_launch_${"2".repeat(32)}`;
		const secondLaunch = await store.transition(
			admitted.state.taskId,
			admitted.state.revision,
			{
				state: "launching",
				phase: "admitted",
				updatedAt: "2026-08-15T01:00:01.100Z",
				heartbeatAt: null,
				checkpoint: "local_classified",
				launchGeneration: secondGeneration,
				launchExpiresAt: "2026-08-15T01:00:02.000Z",
				workerPid: 42,
				workerProcessIdentity: "f".repeat(64),
				launchAttempt: 2,
				terminalResult: null,
			},
		);
		expect(secondLaunch.status).toBe("transitioned");
		let spawnCount = 0;
		const lifecycle = createVaultGitDoctorTaskLifecycle({
			store,
			spawnContext: undefined,
			runtime: {
				now: () => 3_000,
				recordedAt: () => new Date("2026-08-15T01:00:03.000Z"),
				sleep: async () => undefined,
				spawnWorker() {
					spawnCount += 1;
					return 43;
				},
				readProcessIdentity: () => "a".repeat(64),
				stopUnacknowledgedWorker() {},
				stopExpiredWorker: async () => true,
				processIdentityMatches: () => false,
			},
		});

		const outcome = await lifecycle.launch({
			binding,
			acknowledgementStartedAt: 3_000,
			createLaunchGeneration: () => `doctor_launch_${"3".repeat(32)}`,
			args: ["doctor", "--json"],
		});

		expect(outcome).toMatchObject({
			kind: "settled",
			state: {
				taskId: admitted.state.taskId,
				state: "unknown",
				phase: "terminal",
				launchAttempt: 2,
				terminalResult: {
					kind: "worker_failure",
					blocker: "worker_launch_protocol_failed",
				},
			},
		});
		expect(spawnCount).toBe(0);
		await expect(
			loadPersistedTask(root, repositoryId, admitted.state.taskId),
		).resolves.toMatchObject({
			status: "loaded",
			state: {
				state: "unknown",
				phase: "terminal",
				terminalResult: { blocker: "worker_launch_protocol_failed" },
			},
		});
	});

	test("acknowledges only the exact registered worker generation", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-lifecycle-"));
		roots.push(root);
		const repositoryId = "a".repeat(64);
		const store = createVaultGitDoctorTaskStore({ stateRoot: root, repositoryId });
		const binding = {
			repositoryId,
			activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: `txn_${"c".repeat(32)}`,
			normalizedInput: '{"command":"doctor"}',
		} as const;
		const admitted = await store.claimOrJoin(
			binding,
			"2026-08-15T01:00:00.000Z",
		);
		const launchGeneration = `doctor_launch_${"d".repeat(32)}`;
		const launching = await store.transition(
			admitted.state.taskId,
			admitted.state.revision,
			{
				state: "launching",
				phase: "admitted",
				updatedAt: "2026-08-15T01:00:00.100Z",
				heartbeatAt: null,
				checkpoint: "local_classified",
				launchGeneration,
				launchExpiresAt: "2026-08-15T01:00:01.000Z",
				workerPid: 42,
				workerProcessIdentity: "f".repeat(64),
				launchAttempt: 1,
				terminalResult: null,
			},
		);
		expect(launching.status).toBe("transitioned");
		let wallNow = Date.parse("2026-08-15T01:00:00.200Z");
		const lifecycle = createVaultGitDoctorTaskLifecycle({
			store,
			spawnContext: undefined,
			runtime: {
				now: () => wallNow,
				recordedAt: () => new Date(wallNow),
				async sleep(milliseconds) {
					wallNow += milliseconds;
				},
				spawnWorker: () => 0,
				readProcessIdentity: () => "f".repeat(64),
				stopUnacknowledgedWorker() {},
				stopExpiredWorker: async () => false,
				processIdentityMatches: () => true,
			},
		});

		const stale = await lifecycle.acknowledgeWorker({
			taskId: admitted.state.taskId,
			launchGeneration: `doctor_launch_${"9".repeat(32)}`,
			workerPid: 42,
		});
		expect(stale).toMatchObject({ kind: "refused", reason: "worker_lost" });
		const acknowledged = await lifecycle.acknowledgeWorker({
			taskId: admitted.state.taskId,
			launchGeneration,
			workerPid: 42,
		});
		expect(acknowledged).toMatchObject({
			kind: "settled",
			state: {
				state: "in_progress",
				phase: "running",
				checkpoint: "checking_remote",
				workerPid: 42,
			},
		});
		await expect(
			loadPersistedTask(root, repositoryId, admitted.state.taskId),
		).resolves.toMatchObject({
			status: "loaded",
			state: { state: "in_progress", launchGeneration, workerPid: 42 },
		});
	});

	test("heartbeats only the exact acknowledged worker generation", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-lifecycle-"));
		roots.push(root);
		const repositoryId = "a".repeat(64);
		const store = createVaultGitDoctorTaskStore({ stateRoot: root, repositoryId });
		const binding = {
			repositoryId,
			activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: `txn_${"c".repeat(32)}`,
			normalizedInput: '{"command":"doctor"}',
		} as const;
		const admitted = await store.claimOrJoin(
			binding,
			"2026-08-15T01:00:00.000Z",
		);
		const launchGeneration = `doctor_launch_${"d".repeat(32)}`;
		const launching = await store.transition(
			admitted.state.taskId,
			admitted.state.revision,
			{
				state: "launching",
				phase: "admitted",
				updatedAt: "2026-08-15T01:00:00.100Z",
				heartbeatAt: null,
				checkpoint: "local_classified",
				launchGeneration,
				launchExpiresAt: "2026-08-15T01:00:01.000Z",
				workerPid: 42,
				workerProcessIdentity: "f".repeat(64),
				launchAttempt: 1,
				terminalResult: null,
			},
		);
		if (launching.status !== "transitioned") throw new Error("launch lost");
		const running = await store.transition(
			admitted.state.taskId,
			launching.state.revision,
			{
				state: "in_progress",
				phase: "running",
				updatedAt: "2026-08-15T01:00:00.200Z",
				heartbeatAt: "2026-08-15T01:00:00.200Z",
				checkpoint: "checking_remote",
				launchGeneration,
				launchExpiresAt: null,
				workerPid: 42,
				workerProcessIdentity: "f".repeat(64),
				launchAttempt: 1,
				terminalResult: null,
			},
			launchGeneration,
		);
		if (running.status !== "transitioned") throw new Error("ack lost");
		let wallNow = Date.parse("2026-08-15T01:00:05.000Z");
		const lifecycle = createVaultGitDoctorTaskLifecycle({
			store,
			spawnContext: undefined,
			runtime: {
				now: () => wallNow,
				recordedAt: () => new Date(wallNow),
				sleep: async () => undefined,
				spawnWorker: () => 0,
				readProcessIdentity: () => "f".repeat(64),
				stopUnacknowledgedWorker() {},
				stopExpiredWorker: async () => false,
				processIdentityMatches: () => true,
			},
		});

		const stale = await lifecycle.heartbeatWorker({
			taskId: admitted.state.taskId,
			launchGeneration: `doctor_launch_${"9".repeat(32)}`,
			workerPid: 42,
		});
		expect(stale).toMatchObject({ kind: "refused", reason: "worker_lost" });
		wallNow += 10;
		const heartbeat = await lifecycle.heartbeatWorker({
			taskId: admitted.state.taskId,
			launchGeneration,
			workerPid: 42,
		});
		expect(heartbeat).toMatchObject({
			kind: "settled",
			state: {
				state: "in_progress",
				heartbeatAt: "2026-08-15T01:00:05.010Z",
				checkpoint: "checking_remote",
			},
		});
		await expect(
			loadPersistedTask(root, repositoryId, admitted.state.taskId),
		).resolves.toMatchObject({
			status: "loaded",
			state: {
				state: "in_progress",
				heartbeatAt: "2026-08-15T01:00:05.010Z",
				checkpoint: "checking_remote",
			},
		});
	});

	test("preserves a live stale worker and terminalizes a proven dead worker", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-lifecycle-"));
		roots.push(root);
		const repositoryId = "a".repeat(64);
		const store = createVaultGitDoctorTaskStore({ stateRoot: root, repositoryId });
		const admitted = await store.claimOrJoin(
			{
				repositoryId,
				activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
				receiptId: `receipt_${"b".repeat(32)}`,
				receiptRevision: 7,
				transactionId: `txn_${"c".repeat(32)}`,
				normalizedInput: '{"command":"doctor"}',
			},
			"2026-08-15T01:00:00.000Z",
		);
		const launchGeneration = `doctor_launch_${"d".repeat(32)}`;
		const launching = await store.transition(
			admitted.state.taskId,
			admitted.state.revision,
			{
				state: "launching",
				phase: "admitted",
				updatedAt: "2026-08-15T01:00:00.100Z",
				heartbeatAt: null,
				checkpoint: "local_classified",
				launchGeneration,
				launchExpiresAt: "2026-08-15T01:00:01.000Z",
				workerPid: 42,
				workerProcessIdentity: "f".repeat(64),
				launchAttempt: 1,
				terminalResult: null,
			},
		);
		if (launching.status !== "transitioned") throw new Error("launch lost");
		const running = await store.transition(
			admitted.state.taskId,
			launching.state.revision,
			{
				state: "in_progress",
				phase: "running",
				updatedAt: "2026-08-15T01:00:00.200Z",
				heartbeatAt: "2026-08-15T01:00:00.200Z",
				checkpoint: "checking_remote",
				launchGeneration,
				launchExpiresAt: null,
				workerPid: 42,
				workerProcessIdentity: "f".repeat(64),
				launchAttempt: 1,
				terminalResult: null,
			},
			launchGeneration,
		);
		if (running.status !== "transitioned") throw new Error("ack lost");
		let processAlive = true;
		const lifecycle = createVaultGitDoctorTaskLifecycle({
			store,
			spawnContext: undefined,
			runtime: {
				now: () => 0,
				recordedAt: () => new Date("2026-08-15T01:00:30.500Z"),
				sleep: async () => undefined,
				spawnWorker: () => 0,
				readProcessIdentity: () => "f".repeat(64),
				stopUnacknowledgedWorker() {},
				stopExpiredWorker: async () => false,
				processIdentityMatches: () => processAlive,
			},
		});

		const live = await lifecycle.reconcileStaleWorker({
			taskId: admitted.state.taskId,
		});
		expect(live).toMatchObject({
			kind: "settled",
			state: { state: "in_progress", revision: running.state.revision },
		});
		await expect(
			loadPersistedTask(root, repositoryId, admitted.state.taskId),
		).resolves.toMatchObject({
			status: "loaded",
			state: { state: "in_progress", revision: running.state.revision },
		});
		processAlive = false;
		const dead = await lifecycle.reconcileStaleWorker({
			taskId: admitted.state.taskId,
		});
		expect(dead).toMatchObject({
			kind: "settled",
			state: {
				state: "unknown",
				phase: "terminal",
				terminalResult: { kind: "worker_failure", blocker: "worker_lost" },
			},
		});
		await expect(
			loadPersistedTask(root, repositoryId, admitted.state.taskId),
		).resolves.toMatchObject({
			status: "loaded",
			state: {
				state: "unknown",
				phase: "terminal",
				terminalResult: { kind: "worker_failure", blocker: "worker_lost" },
			},
		});
	});

	test("terminalizes only the exact acknowledged worker generation", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-lifecycle-"));
		roots.push(root);
		const repositoryId = "a".repeat(64);
		const store = createVaultGitDoctorTaskStore({ stateRoot: root, repositoryId });
		const binding = {
			repositoryId,
			activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: `txn_${"c".repeat(32)}`,
			normalizedInput: '{"command":"doctor"}',
		} as const;
		const admitted = await store.claimOrJoin(
			binding,
			"2026-08-15T01:00:00.000Z",
		);
		const launchGeneration = `doctor_launch_${"d".repeat(32)}`;
		const launching = await store.transition(
			admitted.state.taskId,
			admitted.state.revision,
			{
				state: "launching",
				phase: "admitted",
				updatedAt: "2026-08-15T01:00:00.100Z",
				heartbeatAt: null,
				checkpoint: "local_classified",
				launchGeneration,
				launchExpiresAt: "2026-08-15T01:00:01.000Z",
				workerPid: 42,
				workerProcessIdentity: "f".repeat(64),
				launchAttempt: 1,
				terminalResult: null,
			},
		);
		if (launching.status !== "transitioned") throw new Error("launch lost");
		const running = await store.transition(
			admitted.state.taskId,
			launching.state.revision,
			{
				state: "in_progress",
				phase: "running",
				updatedAt: "2026-08-15T01:00:00.200Z",
				heartbeatAt: "2026-08-15T01:00:00.200Z",
				checkpoint: "checking_remote",
				launchGeneration,
				launchExpiresAt: null,
				workerPid: 42,
				workerProcessIdentity: "f".repeat(64),
				launchAttempt: 1,
				terminalResult: null,
			},
			launchGeneration,
		);
		if (running.status !== "transitioned") throw new Error("ack lost");
		let wallNow = Date.parse("2026-08-15T01:00:00.300Z");
		const lifecycle = createVaultGitDoctorTaskLifecycle({
			store,
			spawnContext: undefined,
			runtime: {
				now: () => wallNow,
				recordedAt: () => new Date(wallNow),
				sleep: async () => undefined,
				spawnWorker: () => 0,
				readProcessIdentity: () => "f".repeat(64),
				stopUnacknowledgedWorker() {},
				stopExpiredWorker: async () => false,
				processIdentityMatches: () => true,
			},
		});
		const terminalResult = {
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
		} as const;

		const stale = await lifecycle.terminalizeWorker({
			taskId: admitted.state.taskId,
			launchGeneration: `doctor_launch_${"9".repeat(32)}`,
			workerPid: 42,
			terminalResult,
		});
		expect(stale).toMatchObject({ kind: "refused", reason: "worker_lost" });
		wallNow += 10;
		const terminal = await lifecycle.terminalizeWorker({
			taskId: admitted.state.taskId,
			launchGeneration,
			workerPid: 42,
			terminalResult,
		});
		expect(terminal).toMatchObject({
			kind: "settled",
			state: {
				state: "closed",
				phase: "terminal",
				launchGeneration,
				terminalResult: {
					kind: "doctor_result",
					finding: "writes_in_progress",
					repairAction: "resume",
				},
			},
		});
		await expect(
			loadPersistedTask(root, repositoryId, admitted.state.taskId),
		).resolves.toMatchObject({
			status: "loaded",
			state: {
				state: "closed",
				phase: "terminal",
				launchGeneration,
				terminalResult: {
					kind: "doctor_result",
					finding: "writes_in_progress",
					repairAction: "resume",
				},
			},
		});
	});
});
