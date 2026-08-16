import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseCliProcessJson } from "@side-quest/cli-command-facade/testing";

import {
	assertLedgerState,
	assertRefsUnchanged,
	cleanupSmokeFixtures,
	mkSmokeFixture,
	runDoctorToTerminal,
	type SmokeFixture,
} from "../smoke/fixture.ts";

setDefaultTimeout(60_000);

afterEach(cleanupSmokeFixtures);

describe("bounded PR repair re-entry", () => {
	test("two repaired callers re-enter one task and publish once", async () => {
		const fixture = await mkSmokeFixture();
		await installCheck(fixture.clone, false);
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "repair re-entry bytes\n");
		const beforeFailure = fixture.snapshot();

		const accepted = await fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): prove bounded repair re-entry",
			"--json",
		]);
		expect(accepted.exitCode).toBe(0);
		const originalTaskId = parseCliProcessJson<{
			data?: { task_id?: string };
		}>(accepted).data?.task_id;
		expect(originalTaskId).toMatch(/^task_[0-9a-f]{32}$/u);
		if (!originalTaskId) throw new Error("accepted completion omitted task id");

		const repairable = await waitForTerminalTask(fixture, originalTaskId);
		expect(parseCliProcessJson(repairable)).toMatchObject({
			status: "ok",
			data: {
				task_id: originalTaskId,
				task_state: "repair_needed",
				task_terminal_result: { blocker: "vault_check_failed" },
			},
			continuation: { next_action_id: "run_doctor" },
		});
		assertRefsUnchanged(beforeFailure, fixture.snapshot());
		assertLedgerState(fixture, "held");

		const doctor = await runDoctorToTerminal(fixture, [
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			status: "ok",
			data: { finding: "deterministic_failure", repair_action: "resume" },
			continuation: { next_action_id: "run_repair" },
		});
		const repaired = await fixture.run([
			"repair",
			"resume",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(repaired)).toMatchObject({
			status: "ok",
			data: { outcome: "repaired", phase: "writing" },
			continuation: { next_action_id: "complete_transaction" },
		});

		await installCheck(fixture.clone, true);
		const beforeReentry = fixture.snapshot();
		const callers = await Promise.all(
			Array.from({ length: 2 }, () =>
				fixture.run([
					"complete",
					"--transaction-id",
					transactionId,
					"--summary",
					"docs(vault): prove bounded repair re-entry",
					"--json",
				]),
			),
		);
		for (const caller of callers) {
			expect(caller.exitCode).toBe(0);
			expect(parseCliProcessJson(caller)).toMatchObject({
				status: "ok",
				data: {
					transaction_id: transactionId,
					task_id: originalTaskId,
					task_attempt_number: 2,
					task_previous_failure: { blocker: "vault_check_failed" },
				},
			});
		}

		const closed = await waitForTerminalTask(fixture, originalTaskId);
		const closedEnvelope = parseCliProcessJson(closed) as {
			status: string;
			data: { next_action?: { id?: string; kind?: string; action_id?: string } };
			continuation?: unknown;
			runtime_actions?: unknown;
		};
		expect(closedEnvelope).toMatchObject({
			status: "ok",
			data: {
				outcome: "completed",
				phase: "closed",
				task_id: originalTaskId,
				task_attempt_number: 2,
				task_state: "closed",
			},
		});
		// A closed Completion Task is a legitimate terminal none: the union carries
		// id/action_id "none", and a legitimate terminal stop omits the legacy
		// continuation and any runtime action entirely.
		expect(closedEnvelope.data.next_action).toMatchObject({
			id: "none",
			kind: "none",
			action_id: "none",
		});
		expect(closedEnvelope.continuation).toBeUndefined();
		expect(closedEnvelope.runtime_actions).toBeUndefined();
		const after = fixture.snapshot();
		expect(after.localMain).not.toBe(beforeReentry.localMain);
		expect(after.remoteMain).toBe(after.localMain);
		expect(after.worktree).toBe(beforeReentry.worktree);
		assertLedgerState(fixture, "released");
		const closes = (await fixture.recordedPushes()).filter(
			(args) => args.includes("--atomic") && !args.includes("--dry-run"),
		);
		expect(closes).toHaveLength(1);
	});
});

async function waitForTerminalTask(
	fixture: SmokeFixture,
	taskId: string,
): Promise<Awaited<ReturnType<SmokeFixture["run"]>>> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const status = await fixture.run(["status", "--task-id", taskId, "--json"]);
		const taskState = parseCliProcessJson<{
			data?: { task_state?: string };
		}>(status).data?.task_state;
		if (["closed", "repair_needed", "unknown"].includes(taskState ?? "")) {
			return status;
		}
		await Bun.sleep(25);
	}
	throw new Error(`task ${taskId} did not reach a terminal state`);
}

async function installCheck(clone: string, passing: boolean): Promise<void> {
	await writeFile(
		join(clone, "package.json"),
		`${JSON.stringify({
			private: true,
			scripts: { check: `bun -e "process.exit(${passing ? 0 : 1})"` },
		})}\n`,
	);
}
