import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseCliProcessJson } from "@side-quest/cli-command-facade/testing";

import {
	cleanupLiveAcceptanceRoots,
	createFixture,
	waitForFile,
} from "./live-acceptance/fixture.ts";

const COMPLETION_FOREGROUND_BUDGET_MS = 2_000;
const DOCTOR_FOREGROUND_P95_BUDGET_MS = 1_000;
const DOCTOR_COLD_PROCESS_SAMPLES = 20;

setDefaultTimeout(60_000);

afterEach(cleanupLiveAcceptanceRoots);

describe("required foreground performance", () => {
	test("Completion foreground stays below two seconds", async () => {
		const fixture = await createFixture({
			blockingCheck: true,
			privateForegroundDelayMs: negativeControlDelayMs(),
		});
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "performance event\n");

		const startedAt = performance.now();
		const foregroundPromise = fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): prove foreground performance",
			"--json",
		]).then((foreground) => ({
			foreground,
			elapsedMs: performance.now() - startedAt,
		}));
		let measured: Awaited<typeof foregroundPromise>;
		try {
			[measured] = await Promise.all([
				foregroundPromise,
				waitForFile(fixture.checkMarker, 10_000),
			]);
		} finally {
			await fixture.releaseCheck();
		}
		const { elapsedMs, foreground } = measured;

		expect(foreground.exitCode).toBe(0);
		expect(parseCliProcessJson(foreground)).toMatchObject({
			status: "ok",
			data: { task_state: "in_progress" },
		});
		console.info(
			JSON.stringify({
				lane: "foreground-performance",
				workflow: "completion",
				budget_ms: COMPLETION_FOREGROUND_BUDGET_MS,
				measured_ms: Math.round(elapsedMs),
			}),
		);
		expect(elapsedMs).toBeLessThan(COMPLETION_FOREGROUND_BUDGET_MS);
	});

	test("Doctor foreground p95 stays below one second across cold processes", async () => {
		const fixture = await createFixture({
			privateForegroundDelayMs: negativeControlDelayMs(),
		});
		const transactionId = await fixture.begin("notes/event.md");
		fixture.env.VAULT_GIT_SHIM_MODE = "doctor_blocking";
		const args = [
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		] as const;
		const durations: number[] = [];
		const taskIds = new Set<string>();
		await Promise.all([
			rm(fixture.shimMarker, { force: true }),
			rm(`${fixture.shimMarker}.release`, { force: true }),
		]);
		try {
			for (let sample = 0; sample < DOCTOR_COLD_PROCESS_SAMPLES; sample += 1) {
				const startedAt = performance.now();
				const result = await fixture.run(args);
				durations.push(performance.now() - startedAt);
				expect(result.exitCode).toBe(0);
				const foreground = parseCliProcessJson<{
					data?: { task_id?: string; task_state?: string };
				}>(result);
				expect(foreground).toMatchObject({
					status: "ok",
					data: { task_state: "in_progress" },
				});
				const taskId = foreground.data?.task_id;
				if (!taskId) throw new Error("Doctor performance sample omitted task id");
				taskIds.add(taskId);
				await resetDoctorClaim(fixture.stateRoot);
			}
			await waitForFile(fixture.shimMarker, 10_000);
		} finally {
			await writeFile(`${fixture.shimMarker}.release`, "release\n");
		}
		expect(taskIds.size).toBe(DOCTOR_COLD_PROCESS_SAMPLES);
		durations.sort((left, right) => left - right);
		const p95 = durations[Math.ceil(durations.length * 0.95) - 1] as number;
		console.info(
			JSON.stringify({
				lane: "foreground-performance",
				workflow: "doctor",
				samples: DOCTOR_COLD_PROCESS_SAMPLES,
				budget_ms: DOCTOR_FOREGROUND_P95_BUDGET_MS,
				p95_ms: Math.round(p95),
			}),
		);
		expect(p95).toBeLessThan(DOCTOR_FOREGROUND_P95_BUDGET_MS);
	});
});

async function resetDoctorClaim(stateRoot: string): Promise<void> {
	const managerRoot = join(stateRoot, "vault-git-transaction-manager");
	for (const repository of await readdir(managerRoot)) {
		await rm(join(managerRoot, repository, "doctor-task-claims"), {
			recursive: true,
			force: true,
		});
	}
}

function negativeControlDelayMs(): number | undefined {
	const delay = Number(process.env.VAULT_GIT_PERFORMANCE_NEGATIVE_CONTROL_MS);
	return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}
