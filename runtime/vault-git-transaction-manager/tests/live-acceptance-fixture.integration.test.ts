import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import {
	cleanupLiveAcceptanceRoots,
	createFixture,
	readTaskStates,
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

test(
	"fixture cleanup terminates its acknowledged blocked worker before deleting state",
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
		if (!task?.workerPid) throw new Error("acknowledged worker pid unavailable");

		await cleanupLiveAcceptanceRoots();
		let alive = true;
		try {
			process.kill(task.workerPid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
			else throw error;
		}
		let cleanupError: unknown;
		if (alive) {
			try {
				process.kill(-task.workerPid, "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
					cleanupError = error;
				}
			}
		}
		if (cleanupError) throw cleanupError;
		expect(alive).toBe(false);
	},
	30_000,
);
