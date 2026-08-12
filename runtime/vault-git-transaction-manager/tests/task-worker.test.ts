import { describe, expect, test } from "bun:test";

import type { VaultGitEngineResult } from "../src/engine.ts";
import { createVaultGitTaskWorker } from "../src/task-worker.ts";

describe("fenced task worker", () => {
	test("durably acknowledges the matching launch before capability custody and engine entry", async () => {
		const events: string[] = [];
		const capability = Uint8Array.from([11, 22, 33]);
		const engineResult = {
			status: "completed",
			state: "closed",
			phase: "closed",
			writePermission: "owner",
			changedState: "remote",
			retrySafety: "same_input_safe",
			nextAction: { id: "none", summary: "Closed." },
			transactionId: "txn_22222222222222222222222222222222",
			receiptId: "receipt_33333333333333333333333333333333",
			diagnosticsReference: "receipt:opaque",
		} as const satisfies VaultGitEngineResult;
		let engineInput: unknown;
		const worker = createVaultGitTaskWorker({
			engine: {
				async complete(input) {
					events.push("engine-complete");
					engineInput = input;
					return engineResult;
				},
			},
			async acknowledge(input) {
				events.push("acknowledged-durably");
				return {
					schemaVersion: 1,
					taskId: input.taskId,
					launchGeneration: input.launchGeneration,
					acknowledgedAt: "2026-08-12T13:29:00.000Z",
				};
			},
			async readCapability(descriptor) {
				events.push("capability-read");
				expect(descriptor).toBe(7);
				return capability;
			},
			now: () => new Date("2026-08-12T13:30:00.000Z"),
		});

		const result = await worker.run({
			launch: "winner",
			taskId: "task_11111111111111111111111111111111",
			launchGeneration: "launch_44444444444444444444444444444444",
			capabilityDescriptor: 7,
			transactionId: "txn_22222222222222222222222222222222",
			remote: "origin",
			summary: "docs(vault): record acknowledged event",
		});

		expect(events).toEqual([
			"acknowledged-durably",
			"capability-read",
			"engine-complete",
		]);
		expect(engineInput).toEqual({
			transactionId: "txn_22222222222222222222222222222222",
			remote: "origin",
			capability,
			summary: "docs(vault): record acknowledged event",
		});
		expect(result).toEqual({
			status: "engine-result",
			taskId: "task_11111111111111111111111111111111",
			result: engineResult,
		});
	});

	for (const mismatch of ["taskId", "launchGeneration"] as const) {
		test(`refuses a mismatched ${mismatch} before capability custody`, async () => {
			const events: string[] = [];
			const worker = createVaultGitTaskWorker({
				engine: {
					async complete() {
						events.push("engine-complete");
						throw new Error("engine must not run");
					},
				},
				async acknowledge(input) {
					events.push("acknowledged-durably");
					return {
						schemaVersion: 1,
						taskId:
							mismatch === "taskId"
								? "task_55555555555555555555555555555555"
								: input.taskId,
						launchGeneration:
							mismatch === "launchGeneration"
								? "launch_66666666666666666666666666666666"
								: input.launchGeneration,
						acknowledgedAt: input.acknowledgedAt,
					};
				},
				async readCapability() {
					events.push("capability-read");
					return Uint8Array.from([1]);
				},
				now: () => new Date("2026-08-12T13:30:00.000Z"),
			});

			await expect(
				worker.run({
					launch: "winner",
					taskId: "task_11111111111111111111111111111111",
					launchGeneration: "launch_44444444444444444444444444444444",
					capabilityDescriptor: 7,
					transactionId: "txn_22222222222222222222222222222222",
					remote: "origin",
				}),
			).rejects.toThrow("task worker acknowledgement mismatch");
			expect(events).toEqual(["acknowledged-durably"]);
		});
	}

	test("refuses malformed launch identity before durable acknowledgement", async () => {
		const events: string[] = [];
		const worker = createVaultGitTaskWorker({
			engine: {
				async complete() {
					events.push("engine-complete");
					throw new Error("engine must not run");
				},
			},
			async acknowledge(input) {
				events.push("acknowledged-durably");
				return { schemaVersion: 1, ...input };
			},
			async readCapability() {
				events.push("capability-read");
				return Uint8Array.from([1]);
			},
		});

		await expect(
			worker.run({
				launch: "winner",
				taskId: "task_invalid",
				launchGeneration: "launch_44444444444444444444444444444444",
				capabilityDescriptor: 7,
				transactionId: "txn_22222222222222222222222222222222",
				remote: "origin",
			}),
		).rejects.toThrow("task worker acknowledgement invalid");
		expect(events).toEqual([]);
	});
});
