// fallow-ignore-file unused-file
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";

import { parseCliProcessJson } from "@side-quest/cli-command-facade/testing";

import {
	assertLedgerOwner,
	assertLedgerState,
	assertRefsUnchanged,
	cleanupSmokeFixtures,
	mkSmokeFixture,
} from "./fixture.ts";

setDefaultTimeout(180_000);

afterEach(cleanupSmokeFixtures);

/**
 * Row 9 — AE11a: an owned file changes after its checked-content hash is
 * recorded but before Git freezes the private index.
 *
 * The check is a real `bun run check` subprocess in the disposable vault. It
 * rewrites the owned path and exits successfully, so Git itself supplies the
 * raced bytes that the completion guard must reject.
 */
describe("row 9: an owned path changes before index freeze", () => {
	test("completion refuses the raced bytes without moving refs", async () => {
		const fixture = await mkSmokeFixture();
		await writeFile(
			join(fixture.clone, "package.json"),
			`${JSON.stringify(
				{
					private: true,
					scripts: { check: "bun run race-check.ts" },
				},
				null,
				2,
			)}\n`,
		);
		await writeFile(
			join(fixture.clone, "race-check.ts"),
			'await Bun.write("notes/event.md", "raced write during check\\n");\n',
		);

		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(
			join(fixture.clone, "notes/event.md"),
			"validated content\n",
		);
		const before = fixture.snapshot();
		const ownedIndexBefore = fixture.git(
			"ls-files",
			"--stage",
			"--",
			"notes/event.md",
		);

		const completed = await fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): reject raced owned bytes",
			"--json",
		]);

		expect(completed.exitCode).toBe(0);
		const taskId = parseCliProcessJson<{ data?: { task_id?: string } }>(
			completed,
		).data?.task_id;
		if (!taskId) throw new Error("accepted completion omitted task id");
		let taskStatus = await fixture.run([
			"status",
			"--task-id",
			taskId,
			"--json",
		]);
		let taskState: string | undefined;
		for (let attempt = 0; attempt < 200; attempt += 1) {
			taskState = parseCliProcessJson<{ data?: { task_state?: string } }>(
				taskStatus,
			).data?.task_state;
			if (taskState === "repair_needed" || taskState === "unknown") break;
			await Bun.sleep(10);
			taskStatus = await fixture.run([
				"status",
				"--task-id",
				taskId,
				"--json",
			]);
		}
		expect(taskState).toBe("repair_needed");
		expect(parseCliProcessJson(taskStatus)).toMatchObject({
			status: "ok",
			data: {
				task_state: "repair_needed",
				blockers: ["completion_baseline_changed"],
				task_terminal_result: { phase: "repairable" },
			},
			continuation: { next_action_id: "run_doctor" },
		});
		assertRefsUnchanged(before, fixture.snapshot());
		expect(
			fixture.git("ls-files", "--stage", "--", "notes/event.md"),
		).toBe(ownedIndexBefore);
		assertLedgerState(fixture, "held");
		assertLedgerOwner(fixture, transactionId);
		expect(await readFile(join(fixture.clone, "notes/event.md"), "utf8")).toBe(
			"raced write during check\n",
		);
	});
});
