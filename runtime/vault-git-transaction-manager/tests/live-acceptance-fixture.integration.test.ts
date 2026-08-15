import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import {
	cleanupLiveAcceptanceRoots,
	createFixture,
	createStateIsolatedFixture,
	observeWorkerProcess,
	readTaskStates,
	settleFixtureCleanup,
	waitForChildClose,
} from "./live-acceptance/fixture.ts";

afterEach(cleanupLiveAcceptanceRoots);

test("late child-close observation resolves after an early process exit", async () => {
	const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
		stdio: "ignore",
	});
	await new Promise<void>((resolve) => child.once("exit", () => resolve()));

	const observed = await Promise.race([
		waitForChildClose(child).then(() => "closed" as const),
		Bun.sleep(250).then(() => "timed_out" as const),
	]);

	expect(observed).toBe("closed");
});

test("fixture cleanup removes roots after worker cleanup fails", async () => {
	const root = await mkdtemp(join(tmpdir(), "vault-git-cleanup-failure-"));
	const workerFailure = new Error("fixture worker survived cleanup");
	try {
		await expect(
			settleFixtureCleanup(
				async () => {
					throw workerFailure;
				},
				() => rm(root, { recursive: true, force: true }),
				"fixture cleanup failed",
			),
		).rejects.toBe(workerFailure);
		await expect(access(root)).rejects.toBeDefined();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test(
	"fixture refuses to copy an acknowledged worker and cleans its exact identity",
	async () => {
		const fixture = await createFixture({ blockingCheck: true });
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(
			join(fixture.clone, "notes/event.md"),
			"fixture cleanup event\n",
		);
		await fixture.killDuringLaunch(
			transactionId,
			"docs(vault): prove fixture worker cleanup",
			"acknowledged",
		);
		const task = (await readTaskStates(fixture.stateRoot))[0];
		if (!task?.workerPid || !task.workerProcessIdentity) {
			throw new Error("acknowledged worker identity unavailable");
		}
		await expect(createStateIsolatedFixture(fixture, 0)).rejects.toThrow(
			"state-isolated fixture source must be quiescent before copying",
		);
		await expect(
			access(join(fixture.root, "state-isolated-0-state")),
		).rejects.toBeDefined();

		await cleanupLiveAcceptanceRoots();
		expect(
			observeWorkerProcess(task.workerPid, task.workerProcessIdentity),
		).not.toBe("matching");
	},
	30_000,
);
