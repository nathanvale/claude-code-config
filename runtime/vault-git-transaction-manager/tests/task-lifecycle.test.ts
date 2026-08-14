import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
	createVaultGitTaskLifecycle,
	type VaultGitBackgroundCompletionRuntime,
} from "../src/task-lifecycle.ts";
import {
	createVaultGitTaskStore,
	type VaultGitTaskClaimOrJoinInput,
	type VaultGitTaskStore,
} from "../src/task-store.ts";

const roots: string[] = [];
const RECEIPT_ID = "receipt_11111111111111111111111111111111";
const TRANSACTION_ID = "txn_22222222222222222222222222222222";
const LAUNCH_GENERATION = "launch_33333333333333333333333333333333";
const INITIAL_RECORDED_AT = "2026-08-14T00:00:00.000Z";

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("Task Lifecycle", () => {
	test("launch winner registers one worker and observes durable acknowledgement", async () => {
		const fixture = await createFixture("winner");
		fixture.runtime.onSleep = () => acknowledgeRegisteredWorker(fixture.store);

		const outcome = await fixture.lifecycle.launch({
			acknowledgementStartedAt: fixture.runtime.now(),
			admission: claimInput(),
			createLaunchGeneration: () => LAUNCH_GENERATION,
			args: ["complete", "--json"],
		});

		expect(outcome).toMatchObject({
			kind: "settled",
			state: {
				state: "in_progress",
				phase: "running",
				launchAttempt: 1,
				workerPid: 101,
				workerProcessIdentity: "c".repeat(64),
			},
		});
		expect(fixture.runtime.spawned).toEqual([
			{
				receiptId: RECEIPT_ID,
				launchGeneration: LAUNCH_GENERATION,
				args: ["complete", "--json"],
			},
		]);
		expect(await freshLoad(fixture)).toMatchObject({
			status: "loaded",
			state: { state: "in_progress", launchAttempt: 1, workerPid: 101 },
		});
	});

	test("expired first launch is stopped, reclaimed, and acknowledged within the original window", async () => {
		const fixture = await createFixture("recover");
		await arrangeExpiredLaunch(fixture.store, 1);
		fixture.runtime.monotonicMs = 0;
		fixture.runtime.wallTimeMs = Date.parse("2026-08-14T00:02:00.000Z");
		fixture.runtime.onStopExpired = () => {
			fixture.runtime.monotonicMs += 1_000;
			return true;
		};
		fixture.runtime.onSleep = () => acknowledgeRegisteredWorker(fixture.store);

		const outcome = await fixture.lifecycle.launch({
			acknowledgementStartedAt: fixture.runtime.now(),
			admission: claimInput(),
			createLaunchGeneration: () => LAUNCH_GENERATION,
			args: ["complete"],
		});

		expect(outcome).toMatchObject({
			kind: "settled",
			state: { state: "in_progress", launchAttempt: 2, workerPid: 101 },
		});
		expect(fixture.runtime.stoppedExpired).toEqual([
			{ pid: 99, identity: "d".repeat(64) },
		]);
		expect(fixture.runtime.sleptMs).toBe(10);
		expect(await freshLoad(fixture)).toMatchObject({
			status: "loaded",
			state: {
				state: "in_progress",
				launchAttempt: 2,
				launchGeneration: LAUNCH_GENERATION,
			},
		});
	});

	test("expired second launch fences the Completion Task to repair", async () => {
		const fixture = await createFixture("bounded-recovery");
		await arrangeExpiredLaunch(fixture.store, 2);
		fixture.runtime.wallTimeMs = Date.parse("2026-08-14T00:02:00.000Z");

		const outcome = await fixture.lifecycle.launch({
			acknowledgementStartedAt: fixture.runtime.now(),
			admission: claimInput(),
			createLaunchGeneration: () => LAUNCH_GENERATION,
			args: ["complete"],
		});

		expect(outcome).toMatchObject({
			kind: "settled",
			state: {
				state: "repair_needed",
				phase: "terminal",
				launchAttempt: 2,
				terminalResult: { blocker: "worker_launch_protocol_failed" },
			},
		});
		expect(fixture.runtime.spawned).toEqual([]);
		expect(await freshLoad(fixture)).toMatchObject({
			status: "loaded",
			state: {
				state: "repair_needed",
				terminalResult: { blocker: "worker_launch_protocol_failed" },
			},
		});
	});

	test("worker-lost terminalization returns settled durable evidence", async () => {
		const fixture = await createFixture("worker-lost", "worker");
		const admitted = await fixture.store.claimOrJoin(claimInput());
		if (admitted.status === "refused") throw new Error("fixture admission refused");

		const outcome = await fixture.lifecycle.terminalize({
			taskId: admitted.state.taskId,
			advance: terminalAdvance("worker_lost"),
		});

		expect(outcome).toMatchObject({
			kind: "settled",
			state: { state: "repair_needed", terminalResult: { blocker: "worker_lost" } },
		});
		expect(await freshLoad(fixture)).toMatchObject({
			status: "loaded",
			state: { state: "repair_needed", terminalResult: { blocker: "worker_lost" } },
		});
	});

	test("receipt-conflict terminalization returns settled durable evidence", async () => {
		const fixture = await createFixture("receipt-conflict", "worker");
		const admitted = await fixture.store.claimOrJoin(claimInput());
		if (admitted.status === "refused") throw new Error("fixture admission refused");

		const outcome = await fixture.lifecycle.terminalize({
			taskId: admitted.state.taskId,
			advance: terminalAdvance("receipt_conflict"),
		});

		expect(outcome).toMatchObject({
			kind: "settled",
			state: {
				state: "repair_needed",
				terminalResult: { blocker: "receipt_conflict" },
			},
		});
		expect(await freshLoad(fixture)).toMatchObject({
			status: "loaded",
			state: {
				state: "repair_needed",
				terminalResult: { blocker: "receipt_conflict" },
			},
		});
	});

	test("stale launch generation cannot terminalize the current worker", async () => {
		const fixture = await createFixture("stale-generation", "worker");
		const running = await arrangeInProgressLaunch(fixture.store);
		const before = await freshLoad(fixture);

		const outcome = await fixture.lifecycle.terminalize({
			taskId: running.taskId,
			advance: terminalAdvance("worker_lost"),
			fence: {
				expectedLaunchGeneration:
					"launch_55555555555555555555555555555555",
			},
		});

		expect(outcome).toEqual({ kind: "refused", reason: "worker_lost" });
		expect(await freshLoad(fixture)).toEqual(before);
	});

	test("recovery CAS loser cannot register or terminalize a worker", async () => {
		const stateRoot = await scratchRoot("recovery-loser");
		const first = createFixtureAt(stateRoot, "recovery-loser", "launcher");
		const second = createFixtureAt(stateRoot, "recovery-loser", "launcher");
		await arrangeExpiredLaunch(first.store, 1);
		first.runtime.wallTimeMs = Date.parse("2026-08-14T00:02:00.000Z");
		second.runtime.wallTimeMs = first.runtime.wallTimeMs;

		const firstAdmission = await first.lifecycle.admit(claimInput());
		const secondAdmission = await second.lifecycle.admit(claimInput());
		const firstRecovery = await first.lifecycle.recoverExpiredLaunch(firstAdmission);
		const secondRecovery = await second.lifecycle.recoverExpiredLaunch(secondAdmission);

		expect(firstRecovery).toMatchObject({
			kind: "settled",
			launch: "winner",
			state: { state: "claimed" },
		});
		expect(secondRecovery).toMatchObject({
			kind: "settled",
			launch: "joined",
			state: { state: "claimed" },
		});
		const secondRegistration = await second.lifecycle.registerWorker(
			secondRecovery,
			"launch_55555555555555555555555555555555",
			["complete"],
		);
		const firstRegistration = await first.lifecycle.registerWorker(
			firstRecovery,
			LAUNCH_GENERATION,
			["complete"],
		);

		expect(secondRegistration).toEqual(secondRecovery);
		expect(second.runtime.spawned).toEqual([]);
		expect(first.runtime.spawned).toHaveLength(1);
		expect(firstRegistration).toMatchObject({
			kind: "settled",
			launch: "winner",
			state: { state: "launching", phase: "admitted" },
		});
		expect(await freshLoad(first)).toMatchObject({
			status: "loaded",
			state: { state: "launching", phase: "admitted" },
		});
	});

	test("acknowledgement deadline refusal carries the last observed state", async () => {
		const fixture = await createFixture("deadline-state");
		const admitted = await fixture.lifecycle.admit(claimInput());
		if (admitted.kind === "refused") throw new Error("fixture admission refused");
		fixture.runtime.onSleep = async () => {
			await fixture.store.transition(admitted.state.taskId, admitted.state.revision, {
				state: "launching",
				phase: "admitted",
				updatedAt: "2026-08-14T00:00:30.000Z",
				heartbeatAt: null,
				checkpoint: null,
				launchGeneration: LAUNCH_GENERATION,
				launchExpiresAt: "2026-08-14T00:00:31.500Z",
				workerPid: 99,
				workerProcessIdentity: "d".repeat(64),
				launchAttempt: 1,
			});
		};

		const outcome = await fixture.lifecycle.acknowledge(
			admitted.state,
			fixture.runtime.now() + 10,
		);
		const lastObserved = await freshLoad(fixture);
		if (lastObserved.status !== "loaded") throw new Error("fixture state unavailable");

		expect(outcome).toEqual({
			kind: "refused",
			reason: "worker_launch_protocol_failed",
			state: lastObserved.state,
		});
	});

	test("invalid recovery clock leaves the expired launch untouched", async () => {
		const fixture = await createFixture("invalid-clock");
		await arrangeExpiredLaunch(fixture.store, 1);
		fixture.runtime.wallTimeMs = Number.NaN;
		const admission = await fixture.lifecycle.admit(claimInput());
		const before = await freshLoad(fixture);

		const outcome = await fixture.lifecycle.recoverExpiredLaunch(admission);

		expect(outcome).toEqual(admission);
		expect(fixture.runtime.stoppedExpired).toEqual([]);
		expect(await freshLoad(fixture)).toEqual(before);
	});

	test("concurrent claimed admissions remain launchable", async () => {
		const stateRoot = await scratchRoot("concurrent");
		const first = createFixtureAt(stateRoot, "concurrent", "launcher");
		const second = createFixtureAt(stateRoot, "concurrent", "launcher");

		const outcomes = await Promise.all([
			first.lifecycle.admit(claimInput()),
			second.lifecycle.admit(claimInput()),
		]);

		expect(
			outcomes.map((outcome) =>
				outcome.kind === "settled" ? outcome.launch : outcome.reason,
			),
		).toEqual(["winner", "winner"]);
		expect(
			new Set(
				outcomes.flatMap((outcome) =>
					outcome.kind === "settled" ? [outcome.state.taskId] : [],
				),
			).size,
		).toBe(1);
		expect(await freshLoad(first)).toMatchObject({
			status: "loaded",
			state: { state: "claimed", launchAttempt: 0 },
		});
	});
});

interface FakeRuntime extends VaultGitBackgroundCompletionRuntime<null> {
	monotonicMs: number;
	wallTimeMs: number;
	sleptMs: number;
	readonly spawned: Array<{
		receiptId: string;
		launchGeneration: string;
		args: readonly string[];
	}>;
	readonly stoppedExpired: Array<{ pid: number | null; identity: string | null }>;
	onSleep: () => Promise<void>;
	onStopExpired: () => boolean;
}

interface Fixture {
	readonly stateRoot: string;
	readonly repositoryIdentity: string;
	readonly store: VaultGitTaskStore;
	readonly runtime: FakeRuntime;
	readonly lifecycle: ReturnType<typeof createVaultGitTaskLifecycle<null>>;
}

async function createFixture(
	repositoryIdentity: string,
	role: "launcher" | "worker" = "launcher",
): Promise<Fixture> {
	return createFixtureAt(
		await scratchRoot(repositoryIdentity),
		repositoryIdentity,
		role,
	);
}

function createFixtureAt(
	stateRoot: string,
	repositoryIdentity: string,
	role: "launcher" | "worker",
): Fixture {
	const store = createVaultGitTaskStore({ stateRoot, repositoryIdentity });
	const runtime: FakeRuntime = {
		monotonicMs: 0,
		wallTimeMs: Date.parse("2026-08-14T00:01:00.000Z"),
		sleptMs: 0,
		spawned: [],
		stoppedExpired: [],
		onSleep: async () => {},
		onStopExpired: () => true,
		now() {
			return runtime.monotonicMs;
		},
		async sleep(milliseconds) {
			runtime.monotonicMs += milliseconds;
			runtime.sleptMs += milliseconds;
			await runtime.onSleep();
		},
		spawnWorker(_context, receiptId, _taskId, launchGeneration, args) {
			runtime.spawned.push({ receiptId, launchGeneration, args });
			return 101;
		},
		readProcessIdentity(pid) {
			if (pid !== 101) throw new Error("unexpected worker pid");
			return "c".repeat(64);
		},
		stopUnacknowledgedWorker() {},
		async stopExpiredWorker(pid, identity) {
			runtime.stoppedExpired.push({ pid, identity });
			return runtime.onStopExpired();
		},
	};
	return {
		stateRoot,
		repositoryIdentity,
		store,
		runtime,
		lifecycle: createVaultGitTaskLifecycle({
			role,
			store,
			runtime,
			spawnContext: null,
			recordedAt: () => new Date(runtime.wallTimeMs),
		}),
	};
}

function claimInput(): VaultGitTaskClaimOrJoinInput {
	return {
		claimReceiptId: RECEIPT_ID,
		receiptId: RECEIPT_ID,
		receiptRevision: 1,
		transactionId: TRANSACTION_ID,
		remote: "origin",
		generation: "a".repeat(40),
		capabilityDigest: "b".repeat(64),
		normalizedInput: '{"command":"complete","summary":"test"}',
		recordedAt: INITIAL_RECORDED_AT,
	};
}

async function arrangeExpiredLaunch(
	store: VaultGitTaskStore,
	launchAttempt: number,
): Promise<void> {
	const admitted = await store.claimOrJoin(claimInput());
	if (admitted.status === "refused") throw new Error("fixture admission refused");
	await store.transition(admitted.state.taskId, admitted.state.revision, {
		state: "launching",
		phase: "admitted",
		updatedAt: "2026-08-14T00:00:30.000Z",
		heartbeatAt: null,
		checkpoint: null,
		launchGeneration: "launch_44444444444444444444444444444444",
		launchExpiresAt: "2026-08-14T00:00:45.000Z",
		workerPid: 99,
		workerProcessIdentity: "d".repeat(64),
		launchAttempt,
	});
}

async function arrangeInProgressLaunch(store: VaultGitTaskStore) {
	const admitted = await store.claimOrJoin(claimInput());
	if (admitted.status === "refused") throw new Error("fixture admission refused");
	const launching = await store.transition(admitted.state.taskId, admitted.state.revision, {
		state: "launching",
		phase: "admitted",
		updatedAt: "2026-08-14T00:00:30.000Z",
		heartbeatAt: null,
		checkpoint: null,
		launchGeneration: LAUNCH_GENERATION,
		launchExpiresAt: "2026-08-14T00:00:45.000Z",
		workerPid: 99,
		workerProcessIdentity: "d".repeat(64),
		launchAttempt: 1,
	});
	if (launching.status !== "transitioned") throw new Error("fixture launch lost");
	const running = await store.transition(launching.state.taskId, launching.state.revision, {
		state: "in_progress",
		phase: "running",
		updatedAt: "2026-08-14T00:00:31.000Z",
		heartbeatAt: "2026-08-14T00:00:31.000Z",
		checkpoint: "checking",
		launchGeneration: LAUNCH_GENERATION,
		launchExpiresAt: null,
		workerPid: 99,
		workerProcessIdentity: "d".repeat(64),
	});
	if (running.status !== "transitioned") throw new Error("fixture acknowledgement lost");
	return running.state;
}

async function acknowledgeRegisteredWorker(store: VaultGitTaskStore): Promise<void> {
	const loaded = await store.load(RECEIPT_ID);
	if (
		loaded.status !== "loaded" ||
		loaded.state.state !== "launching" ||
		loaded.state.workerPid === null
	)
		return;
	const acknowledgedAt = "2026-08-14T00:02:01.000Z";
	await store.transition(loaded.state.taskId, loaded.state.revision, {
		state: "in_progress",
		phase: "running",
		updatedAt: acknowledgedAt,
		heartbeatAt: acknowledgedAt,
		checkpoint: "checking",
		launchGeneration: loaded.state.launchGeneration,
		launchExpiresAt: null,
		workerPid: loaded.state.workerPid,
		workerProcessIdentity: loaded.state.workerProcessIdentity,
	});
}

function terminalAdvance(blocker: "worker_lost" | "receipt_conflict") {
	return {
		state: "repair_needed" as const,
		phase: "terminal" as const,
		updatedAt: "2026-08-14T00:01:00.000Z",
		heartbeatAt: null,
		checkpoint: "checking" as const,
		launchExpiresAt: null,
		terminalResult: {
			outcome: "refused" as const,
			phase: "checking" as const,
			changedState: "none" as const,
			blocker,
			retrySafety: "operator_required" as const,
		},
	};
}

async function freshLoad(fixture: Fixture) {
	return createVaultGitTaskStore({
		stateRoot: fixture.stateRoot,
		repositoryIdentity: fixture.repositoryIdentity,
	}).load(RECEIPT_ID);
}

async function scratchRoot(label: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `vault-git-task-lifecycle-${label}-`));
	roots.push(root);
	return root;
}
