import { access, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseCliProcessJson } from "@side-quest/cli-command-facade/testing";

import {
	cleanupLiveAcceptanceRoots,
	createFixture,
	createStateIsolatedFixture,
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
		const durations: number[] = [];
		const taskIds = new Set<string>();
		const fixture = await createFixture({
			privateForegroundDelayMs: negativeControlDelayMs(),
		});
		const transactionId = await fixture.begin("notes/event.md");
		fixture.env.VAULT_GIT_SHIM_MODE = "doctor_blocking";
		const samples = await Promise.all(
			Array.from({ length: DOCTOR_COLD_PROCESS_SAMPLES }, async (_, sample) => {
				const isolated = await createStateIsolatedFixture(fixture, sample);
				await Promise.all([
					rm(isolated.shimMarker, { force: true }),
					rm(`${isolated.shimMarker}.release`, { force: true }),
				]);
				return {
					fixture: isolated,
					args: [
						"doctor",
						"--transaction-id",
						transactionId,
						"--json",
					] as const,
				};
			}),
		);
		let priorStateRoot: string | undefined;
		try {
			for (const [sample, { fixture: isolated, args }] of samples.entries()) {
				if (priorStateRoot) {
					await expect(access(priorStateRoot)).rejects.toBeDefined();
				}
				try {
					const startedAt = performance.now();
					const result = await isolated.run(args);
					durations.push(performance.now() - startedAt);
					if (result.exitCode !== 0) {
						throw new Error(doctorSampleFailure(sample, result));
					}
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
					await waitForFile(isolated.shimMarker, 10_000);
				} finally {
					await writeFile(`${isolated.shimMarker}.release`, "release\n");
					priorStateRoot = isolated.stateRoot;
					await isolated.cleanup();
				}
			}
			if (priorStateRoot) {
				await expect(access(priorStateRoot)).rejects.toBeDefined();
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
		} finally {
			await cleanupLiveAcceptanceRoots();
		}
	});
});

function doctorSampleFailure(
	sample: number,
	result: {
		readonly exitCode: number | null;
		readonly signal: NodeJS.Signals | null;
		readonly timedOut: boolean;
		readonly stdout: string;
		readonly stderr: string;
	},
): string {
	let publicResult: unknown = "unparseable";
	try {
		publicResult = JSON.parse(result.stdout);
	} catch {
		// Keep unexpected raw process output and private paths out of hosted logs.
	}
	return JSON.stringify({
		lane: "foreground-performance",
		workflow: "doctor",
		sample: sample + 1,
		exit_code: result.exitCode,
		timed_out: result.timedOut,
		signal: result.signal,
		public_result: publicResult,
		stderr_present: result.stderr.length > 0,
	});
}

function negativeControlDelayMs(): number | undefined {
	const delay = Number(process.env.VAULT_GIT_PERFORMANCE_NEGATIVE_CONTROL_MS);
	return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}
