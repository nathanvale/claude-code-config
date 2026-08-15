import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createVaultGitDoctorTaskStore } from "../src/doctor-task-store.ts";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("Background Doctor task store", () => {
	test("twenty identical callers publish one claim and one task", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-task-store-"));
		roots.push(root);
		const store = createVaultGitDoctorTaskStore({
			stateRoot: root,
			repositoryId: "a".repeat(64),
		});
		const binding = {
			repositoryId: "a".repeat(64),
			activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: `txn_${"c".repeat(32)}`,
			normalizedInput: '{"command":"doctor"}',
		} as const;

		const admissions = await Promise.all(
			Array.from({ length: 20 }, () =>
				store.claimOrJoin(binding, "2026-08-14T01:00:00.000Z"),
			),
		);
		expect(admissions.filter(({ launch }) => launch === "winner")).toHaveLength(
			1,
		);
		expect(new Set(admissions.map(({ state }) => state.taskId)).size).toBe(1);

		const taskId = admissions[0]?.state.taskId;
		if (!taskId) throw new Error("Doctor task admission omitted task id");
		const loaded = await store.loadByTaskId(taskId);
		expect(loaded).toMatchObject({
			status: "loaded",
			state: { taskId, revision: 1, state: "claimed" },
		});

		const repositoryRoot = join(
			root,
			"vault-git-transaction-manager",
			"a".repeat(64),
		);
		expect(await readdir(join(repositoryRoot, "doctor-task-claims"))).toHaveLength(
			1,
		);
		expect(await readdir(join(repositoryRoot, "doctor-tasks"))).toEqual([
			taskId,
		]);
		expect((await stat(repositoryRoot)).mode & 0o777).toBe(0o700);
	});

	test("refuses changed input against the same receipt-bound claim", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-task-store-"));
		roots.push(root);
		const store = createVaultGitDoctorTaskStore({
			stateRoot: root,
			repositoryId: "a".repeat(64),
		});
		const binding = {
			repositoryId: "a".repeat(64),
			activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: `txn_${"c".repeat(32)}`,
			normalizedInput: '{"command":"doctor","transactionId":null}',
		} as const;
		const admitted = await store.claimOrJoin(
			binding,
			"2026-08-14T01:00:00.000Z",
		);
		const refused = await store.claimOrJoin(
			{ ...binding, normalizedInput: '{"command":"doctor","transactionId":"changed"}' },
			"2026-08-14T01:00:01.000Z",
		);

		expect(refused).toMatchObject({
			launch: "refused",
			reason: "task_input_mismatch",
			state: { taskId: admitted.state.taskId },
		});
		const tasks = await readdir(
			join(
				root,
				"vault-git-transaction-manager",
				"a".repeat(64),
				"doctor-tasks",
			),
		);
		expect(tasks).toEqual([admitted.state.taskId]);
	});

	test("does not create private directories during an absent lookup", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-task-store-"));
		roots.push(root);
		const store = createVaultGitDoctorTaskStore({
			stateRoot: root,
			repositoryId: "a".repeat(64),
		});
		await expect(
			store.loadByTaskId(`doctor_task_${"d".repeat(32)}`),
		).resolves.toEqual({ status: "absent" });
		expect(await readdir(root)).toEqual([]);
	});
});
