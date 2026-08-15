import { writeFile } from "node:fs/promises";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	parseCliProcessJson,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";

import {
	cleanupLiveAcceptanceRoots,
	countDoctorTasks,
	corruptDoctorTaskTerminal,
	createFixture,
	waitForFile,
} from "./fixture.ts";

setDefaultTimeout(30_000);

afterEach(cleanupLiveAcceptanceRoots);

describe("Background Doctor public-process acceptance", () => {
	test("Doctor returns local evidence while remote diagnosis continues", async () => {
		const fixture = await createFixture();
		const transactionId = await fixture.begin("notes/event.md");
		const unrelatedBefore = await fixture.unrelatedSnapshot();
		const remoteRefsBefore = fixture.remoteRefs();
		fixture.env.VAULT_GIT_SHIM_MODE = "doctor_blocking";

		const doctorPromise = fixture.run([
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		let foreground: CliProcessResult;
		try {
			foreground = await doctorPromise;
		} catch (error) {
			await writeFile(`${fixture.shimMarker}.release`, "release\n");
			throw error;
		}

		await waitForFile(fixture.shimMarker, 10_000);
		expect(foreground.exitCode).toBe(0);
		const admitted = parseCliProcessJson<{
			data?: {
				command?: string;
					outcome?: string;
					task_id?: string;
					task_generation?: string;
					task_state?: string;
				foreground_non_vault_work_allowed?: boolean;
				next_action?: { id?: string };
			};
		}>(foreground);
		expect(admitted).toMatchObject({
			status: "ok",
			data: {
				command: "doctor",
				outcome: "advanced",
				task_state: "in_progress",
				foreground_non_vault_work_allowed: true,
				next_action: { id: "inspect_status" },
			},
		});
		const taskId = admitted.data?.task_id;
		const taskGeneration = admitted.data?.task_generation;
		expect(taskId).toMatch(/^doctor_task_[0-9a-f]{32}$/u);
		expect(taskGeneration).toMatch(/^doctor_launch_[0-9a-f]{32}$/u);
		if (!taskId) throw new Error("Background Doctor omitted task id");
		if (!taskGeneration) throw new Error("Background Doctor omitted generation");

		const inspection = await fixture.run([
			"doctor",
			"--task-id",
			taskId,
			"--json",
		]);
		if (inspection.exitCode !== 0) {
			await writeFile(`${fixture.shimMarker}.release`, "release\n");
			throw new Error(
				`Background Doctor inspection failed: ${inspection.stdout} ${inspection.stderr}`,
			);
		}
		expect(inspection.exitCode).toBe(0);
		expect(parseCliProcessJson(inspection)).toMatchObject({
			status: "ok",
			data: {
					command: "doctor",
					task_id: taskId,
					task_generation: taskGeneration,
				task_state: "in_progress",
				task_phase: "running",
				task_checkpoint: "checking_remote",
				foreground_non_vault_work_allowed: true,
			},
		});
		expect(await fixture.unrelatedSnapshot()).toEqual(unrelatedBefore);
		await writeFile(`${fixture.shimMarker}.release`, "release\n");
		let terminalInspection: CliProcessResult | null = null;
		const terminalDeadline = Date.now() + 10_000;
		while (Date.now() < terminalDeadline) {
			const candidate = await fixture.run([
				"doctor",
				"--task-id",
				taskId,
				"--json",
			]);
			const candidateEnvelope = parseCliProcessJson<{
				data?: { task_state?: string };
			}>(candidate);
			if (candidateEnvelope.data?.task_state === "closed") {
				terminalInspection = candidate;
				break;
			}
			await Bun.sleep(25);
		}
		expect(terminalInspection).not.toBeNull();
		expect(
			parseCliProcessJson(terminalInspection as CliProcessResult),
		).toMatchObject({
			status: "ok",
			data: {
					command: "doctor",
					task_id: taskId,
					task_generation: taskGeneration,
				task_state: "closed",
				task_phase: "terminal",
				task_checkpoint: "terminal",
				finding: "writes_in_progress",
				transaction_state: "repairable",
				task_terminal_result: {
					kind: "doctor_result",
					finding: "writes_in_progress",
				},
				next_action: { id: "run_repair" },
			},
		});
		const plainInspection = await fixture.run(["doctor", "--task-id", taskId]);
		expect(plainInspection.exitCode).toBe(0);
		expect(plainInspection.stdout).toContain("task_phase: terminal");
		expect(plainInspection.stdout).toContain(
			`task_generation: ${taskGeneration}`,
		);
		expect(plainInspection.stdout).toContain("task_checkpoint: terminal");
		expect(plainInspection.stdout).toContain("finding: writes_in_progress");
		expect(plainInspection.stdout).toContain("repair_action: resume");
		expect(plainInspection.stdout).toContain(
			'task_terminal_result: {"kind":"doctor_result"',
		);
		expect(await fixture.unrelatedSnapshot()).toEqual(unrelatedBefore);
		expect(fixture.remoteRefs()).toBe(remoteRefsBefore);
		const publicSurfaces = [
			foreground.stdout,
			inspection.stdout,
			(terminalInspection as CliProcessResult).stdout,
			plainInspection.stdout,
		].join("\n");
		expect(publicSurfaces).not.toContain(fixture.stateRoot);
		expect(publicSurfaces).not.toContain(fixture.clone);
		expect(publicSurfaces).not.toContain("doctor remote check blocked");
		expect(publicSurfaces).not.toMatch(/https?:\/\/[^/\s:@]+:[^/\s@]+@/u);

		const privateText = `${fixture.stateRoot}/secret TOKEN=secret`;
		await corruptDoctorTaskTerminal(fixture.stateRoot, taskId, privateText);
		const malformed = await fixture.run([
			"doctor",
			"--task-id",
			taskId,
			"--json",
		]);
		expect(parseCliProcessJson(malformed)).toMatchObject({
			status: "error",
			error: { code: "worker_launch_protocol_failed" },
			data: {
				blockers: ["worker_launch_protocol_failed"],
				task_id: taskId,
				next_action: { id: "inspect_private_receipt" },
			},
		});
		expect(`${malformed.stdout}\n${malformed.stderr}`).not.toContain(privateText);
	});


	test("twenty Doctors join one diagnostic task", async () => {
		const fixture = await createFixture();
		const transactionId = await fixture.begin("notes/event.md");
		fixture.env.VAULT_GIT_SHIM_MODE = "doctor_blocking";
		const args = [
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		] as const;

		const calls = Array.from({ length: 20 }, () => fixture.run(args));
		const settled = await Promise.race([
			Promise.all(calls),
			Bun.sleep(5_000).then(() => null),
		]);
		try {
			expect(settled).not.toBeNull();
			if (settled === null) return;
			const envelopes = settled.map((result) =>
				parseCliProcessJson<{
					status?: string;
					data?: {
						task_id?: string;
						task_state?: string;
					};
				}>(result),
			);
			const taskIds = envelopes.map(({ data }) => data?.task_id);

			expect(new Set(envelopes.map(({ status }) => status))).toEqual(
				new Set(["ok"]),
			);
			expect(new Set(taskIds).size).toBe(1);
			expect(await countDoctorTasks(fixture.stateRoot)).toBe(1);
			await waitForFile(fixture.shimMarker, 10_000);
			const changed = await fixture.run(["doctor", "--json"]);
			expect(parseCliProcessJson(changed)).toMatchObject({
				status: "error",
				error: { code: "task_input_mismatch" },
				data: {
					task_id: taskIds[0],
					next_action: { id: "inspect_status" },
				},
			});
			expect(await countDoctorTasks(fixture.stateRoot)).toBe(1);
		} finally {
			await writeFile(`${fixture.shimMarker}.release`, "release\n");
		}
		const taskId = settled?.[0]
			? parseCliProcessJson<{ data?: { task_id?: string } }>(
					settled[0],
				).data?.task_id
			: undefined;
		if (!taskId) throw new Error("joined Background Doctor omitted task id");
		const terminalDeadline = Date.now() + 10_000;
		let terminal = false;
		while (Date.now() < terminalDeadline) {
			const inspection = await fixture.run([
				"doctor",
				"--task-id",
				taskId,
				"--json",
			]);
			terminal =
				parseCliProcessJson<{ data?: { task_state?: string } }>(inspection)
					.data?.task_state === "closed";
			if (terminal) break;
			await Bun.sleep(25);
		}
		expect(terminal).toBe(true);
	});

});
