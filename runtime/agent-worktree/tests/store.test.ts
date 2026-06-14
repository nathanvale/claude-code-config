import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import { buildHandoffSnapshot } from "../src/inspect.ts";
import { createFileStore } from "../src/store.ts";

describe("agent-worktree store", () => {
	test("writes and reads run, failure, and worktree records", async () => {
		const root = await mkdtemp(join(tmpdir(), "awt-store-"));
		const store = createFileStore(root);

		await store.writeRun({
			runId: "run-1",
			command: "delete",
			status: "failed",
			changedState: "partial",
			steps: [],
			events: [
				{
					kind: "run_started",
					runId: "run-1",
					changedState: "none",
				},
			],
		});
		await store.writeFailure({
			ref: { kind: "failure", id: "run-1/delete_branch" },
			runId: "run-1",
			stepId: "delete_branch",
			changedState: "partial",
			retrySafety: "inspect_first",
			whatHappened: "Branch deletion failed.",
			whatChanged: ["Worktree removed."],
			nextSafeActions: ["inspect"],
		});
		await store.writeWorktree({
			ref: { kind: "worktree", id: "feat-x" },
			branch: "feat/x",
			path: "/repo/.worktrees/feat-x",
			observedAtMs: 1,
		});

		expect((await store.readRun("run-1"))?.changedState).toBe("partial");
		expect((await store.listRuns()).map((record) => record.runId)).toEqual([
			"run-1",
		]);
		expect(
			(await store.readFailure("run-1/delete_branch"))?.retrySafety,
		).toBe("inspect_first");
		expect((await store.listFailures()).map((record) => record.stepId)).toEqual([
			"delete_branch",
		]);
		expect((await store.readWorktree("feat-x"))?.branch).toBe("feat/x");
		expect((await store.listWorktrees()).map((record) => record.branch)).toEqual([
			"feat/x",
		]);
	});

	test("handoff surfaces latest durable context from the store", async () => {
		const root = await mkdtemp(join(tmpdir(), "awt-handoff-"));
		const store = createFileStore(root);
		await store.writeRun({
			runId: "run-1",
			command: "refresh",
			status: "completed",
			changedState: "complete",
			steps: [],
			events: [],
			createdAtMs: 10,
		});
		await store.writeFailure({
			ref: { kind: "failure", id: "run-1/delete_branch" },
			runId: "run-1",
			stepId: "delete_branch",
			changedState: "partial",
			retrySafety: "inspect_first",
			whatHappened: "Branch deletion failed.",
			whatChanged: ["Worktree removed."],
			nextSafeActions: ["inspect"],
		});

		const snapshot = await buildHandoffSnapshot(root, { limit: 2 });

		expect(snapshot.latest).toHaveLength(2);
		expect(
			snapshot.latest.map((entry) => (entry as { kind?: string }).kind),
		).toContain("failure");
	});
});
