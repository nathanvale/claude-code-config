import { readFile, readdir, stat } from "node:fs/promises";

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
				store.admit({
					receiptId,
					recordedAt: "2026-08-12T11:45:00.000Z",
				}),
			),
		);
		const taskIds = new Set(
			admissions.map((admission) => admission.state.taskId),
		);

		expect(admissions.filter((admission) => admission.status === "created")).toHaveLength(1);
		expect(taskIds.size).toBe(1);
		expect([...taskIds][0]).toMatch(/^task_[0-9a-f]{32}$/);
		expect([...taskIds][0]).not.toContain(receiptId.slice("receipt_".length));
		expect(admissions.every((admission) => Object.isFrozen(admission.state))).toBe(true);

		const claimNames = await readdir(stores[0].paths.claims);
		expect(claimNames).toEqual([`${receiptId}.json`]);
		const claimPath = stores[0].claimPath(receiptId);
		const claimSource = await readFile(claimPath, "utf8");
		expect(Object.keys(JSON.parse(claimSource)).sort()).toEqual([
			"phase",
			"receiptId",
			"recordedAt",
			"revision",
			"schemaVersion",
			"taskId",
		]);
		expect(claimSource).not.toMatch(/capability|secret|token/i);
		expect((await stat(stores[0].paths.claims)).mode & 0o777).toBe(0o700);
		expect((await stat(claimPath)).mode & 0o777).toBe(0o600);

		const later = await stores[0].admit({
			receiptId,
			recordedAt: "2026-08-12T11:46:00.000Z",
		});
		expect(later).toEqual({ status: "existing", state: admissions[0].state });
		expect(await stores[0].load(receiptId)).toEqual({
			status: "loaded",
			state: admissions[0].state,
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

		const admitted = await store.admit({
			receiptId: "receipt_33333333333333333333333333333333",
			recordedAt: "2026-08-12T12:30:00.000Z",
		});

		expect(calls).toEqual([
			{ method: "writeTemp", target: "task_claim" },
			{ method: "syncFile", target: "task_claim" },
			{ method: "linkExclusive", target: "task_claim" },
			{ method: "syncDirectory", target: "task_claim" },
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
			recordedAt: "2026-08-12T12:32:00.000Z",
		} as const;
		const originalStore = createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: "vault@example",
		});
		const original = await originalStore.admit(input);
		expect(original.status).toBe("created");

		const calls: TaskDurabilityCall[] = [];
		const interruptedJoiner = createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: "vault@example",
			durability: recordingTaskDurabilityPort(calls, 3),
		});
		let failure: unknown;
		try {
			await interruptedJoiner.admit(input);
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
		}).admit(input);
		expect(retry).toEqual({ status: "existing", state: original.state });
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
				store.admit({
					receiptId,
					recordedAt: "2026-08-12T12:31:00.000Z",
				}),
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
});

interface TaskDurabilityCall {
	readonly method: keyof VaultGitDurabilityPort;
	readonly target: string;
}

const taskClaimDurabilityOrder = [
	"writeTemp",
	"syncFile",
	"linkExclusive",
	"syncDirectory",
] as const satisfies readonly (keyof VaultGitDurabilityPort)[];

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
