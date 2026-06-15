// fallow-ignore-file unused-file
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";

import { buildHandoffSnapshot } from "../src/inspect.ts";
import { createFileStore, type AgentWorktreeStore } from "../src/store.ts";

describe("agent-worktree inspect", () => {
	test("fresh process inspects run, failure, worktree refs, event trail, and handoff snapshot", async () => {
		const storeRoot = await mkdtemp(join(tmpdir(), "agent-worktree-inspect-"));
		await writeInspectFixture(createFileStore(storeRoot));

		const inspected = await inspectFromFreshProcess(storeRoot);

		expect(inspected.failure).toMatchObject({
			found: true,
			ref: { kind: "failure", id: "run-1/delete_branch" },
			relativePath: "failures/run-1/delete_branch.json",
			record: {
				changedState: "partial",
				retrySafety: "inspect_first",
				backupRef: "refs/agent-worktree/backups/feat-x/run-1",
			},
			nextSafeActions: ["doctor", "handoff"],
		});
		expect(inspected.run).toMatchObject({
			found: true,
			ref: { kind: "run", id: "run-1" },
			record: {
				status: "failed",
				changedState: "partial",
				backupRef: "refs/agent-worktree/backups/feat-x/run-1",
			},
		});
		expect(inspected.worktree).toMatchObject({
			found: true,
			ref: { kind: "worktree", id: "feat-x" },
			record: {
				branch: "feat/x",
				path: "/repo/.worktrees/feat-x",
			},
		});
		expect(inspected.events).toEqual([
			{
				kind: "run_started",
				runId: "run-1",
				changedState: "none",
				createdAtMs: 10,
			},
			{
				kind: "step_failed",
				runId: "run-1",
				stepId: "delete_branch",
				changedState: "partial",
				ref: { kind: "failure", id: "run-1/delete_branch" },
				summary: "Branch deletion failed.",
				createdAtMs: 20,
			},
		]);
		expect(inspected.handoff).toMatchObject({
			storeRoot,
			total: 3,
			truncated: false,
			nextSafeActions: ["doctor", "inspect"],
		});
		expect(
			inspected.handoff.latest.map((entry) => entry.kind).sort(),
		).toEqual(["failure", "run", "worktree"]);
		expect(await pathExists(join(storeRoot, "handoffs"))).toBe(false);
	});

	test("handoff against a missing store root remains read-only", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "agent-worktree-handoff-missing-"));
		const storeRoot = join(tempRoot, ".agent-worktree");

		const snapshot = await buildHandoffSnapshot(storeRoot);

		expect(snapshot).toMatchObject({
			storeRoot,
			latest: [],
			total: 0,
			truncated: false,
			nextSafeActions: ["doctor", "inspect"],
		});
		expect(await pathExists(storeRoot)).toBe(false);
	});
});

async function writeInspectFixture(store: AgentWorktreeStore): Promise<void> {
	await store.writeRun({
		runId: "run-1",
		facadeRunId: "facade-run-1",
		command: "delete",
		status: "failed",
		changedState: "partial",
		backupRef: "refs/agent-worktree/backups/feat-x/run-1",
		createdAtMs: 10,
		steps: [
			{
				id: "remove_worktree",
				action: "remove",
				status: "completed",
				changedState: "complete",
			},
			{
				id: "delete_branch",
				action: "delete_branch",
				status: "failed",
				changedState: "partial",
				failureRef: { kind: "failure", id: "run-1/delete_branch" },
			},
		],
		events: [
			{
				kind: "run_started",
				runId: "run-1",
				changedState: "none",
				createdAtMs: 10,
			},
			{
				kind: "step_failed",
				runId: "run-1",
				stepId: "delete_branch",
				changedState: "partial",
				ref: { kind: "failure", id: "run-1/delete_branch" },
				summary: "Branch deletion failed.",
				createdAtMs: 20,
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
		diagnosticTrail: "runs/run-1.jsonl",
		backupRef: "refs/agent-worktree/backups/feat-x/run-1",
	});
	await store.writeWorktree({
		ref: { kind: "worktree", id: "feat-x" },
		branch: "feat/x",
		path: "/repo/.worktrees/feat-x",
		head: "abc123",
		observedAtMs: 5,
	});
}

async function inspectFromFreshProcess(
	storeRoot: string,
): Promise<{
	failure: Record<string, unknown>;
	run: Record<string, unknown>;
	worktree: Record<string, unknown>;
	events: readonly Record<string, unknown>[];
	handoff: {
		storeRoot: string;
		latest: readonly { kind: string }[];
		total: number;
		truncated: boolean;
		nextSafeActions: readonly string[];
	};
}> {
	const script = `
		import { readFile } from "node:fs/promises";
		import { join } from "node:path";
		import { buildHandoffSnapshot, inspectRefFromRoot } from "./src/inspect.ts";

		const storeRoot = process.env.AGENT_WORKTREE_STORE_ROOT;
		if (!storeRoot) throw new Error("missing AGENT_WORKTREE_STORE_ROOT");
		const eventsText = await readFile(join(storeRoot, "runs", "run-1.jsonl"), "utf8");
		const result = {
			failure: await inspectRefFromRoot(storeRoot, "failure:run-1/delete_branch"),
			run: await inspectRefFromRoot(storeRoot, "run:run-1"),
			worktree: await inspectRefFromRoot(storeRoot, "worktree:feat-x"),
			events: eventsText.trim().split("\\n").map((line) => JSON.parse(line)),
			handoff: await buildHandoffSnapshot(storeRoot),
		};
		console.log(JSON.stringify(result));
	`;
	const proc = Bun.spawnSync(["bun", "-e", script], {
		cwd: dirname(import.meta.dir),
		env: { ...process.env, AGENT_WORKTREE_STORE_ROOT: storeRoot },
		stdout: "pipe",
		stderr: "pipe",
	});
	if (proc.exitCode !== 0) {
		throw new Error(`fresh inspect process failed: ${proc.stderr.toString()}`);
	}
	return JSON.parse(proc.stdout.toString());
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
