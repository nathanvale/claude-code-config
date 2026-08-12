import { readFile, readdir, stat } from "node:fs/promises";

import { afterEach, describe, expect, test } from "bun:test";

import { createVaultGitTaskStore } from "../src/task-store.ts";
import { createTempDirectoryFixture } from "./temp-directory-fixture.ts";

const temporaryDirectories = createTempDirectoryFixture();

afterEach(temporaryDirectories.cleanup);

describe("private task store", () => {
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
});
