import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createVaultGitDoctorTaskStore } from "../src/doctor-task-store.ts";
import { resolveVaultGitDoctorTerminalNextAction } from "../src/model.ts";
import { projectVaultGitNextSafeAction } from "../src/next-safe-action.ts";

/**
 * State/concurrency/recovery seam (ADR-0002 U1 point 5, 6): the durable Doctor
 * Task terminal action evolves. A LEGACY on-disk terminal shaped
 * nextAction: { id: "inspect_status", summary } is read through the real store's
 * loadByTaskId(), contextually reprojected by Task kind to the authoritative
 * inspect_doctor_task union (legacy id preserved as the compatibility field), with
 * the persisted history bytes and revision unchanged by the read. A NEW terminal
 * write persists the semantic action ID only — no persisted summary and no
 * { id, summary } object — and a subsequent read reconstructs the full public
 * continuation from durable state + catalog. Real owner: createVaultGitDoctorTaskStore.
 * Independent oracle: raw fs reads of the known history path, not the store writer.
 */

const roots: string[] = [];
const REPO_ID = "a".repeat(64);
const DOCTOR_TASK_ID = `doctor_task_${"1".repeat(32)}`;
const TXN_ID = `txn_${"c".repeat(32)}`;

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

function historyDir(root: string, taskId: string): string {
	return join(
		root,
		"vault-git-transaction-manager",
		REPO_ID,
		"doctor-tasks",
		taskId,
		"history",
	);
}

async function rawHistory(
	root: string,
	taskId: string,
): Promise<{ names: string[]; bytes: Record<string, string> }> {
	const dir = historyDir(root, taskId);
	const names = (await readdir(dir)).filter((n) => /^\d{12}\.json$/.test(n)).sort();
	const bytes: Record<string, string> = {};
	for (const name of names) bytes[name] = await readFile(join(dir, name), "utf8");
	return { names, bytes };
}

// Write one legacy terminal Doctor Task state file directly into the genuine store
// layout (owner-private dir 0o700, file 0o600). This is pre-existing on-disk data in
// the CURRENT { id, summary } terminal shape — the exact bytes point 5 must read
// without rewrite.
async function seedLegacyTerminalHistory(
	root: string,
	taskId: string,
): Promise<Record<string, unknown>> {
	const dir = historyDir(root, taskId);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const state = {
		schemaVersion: 1,
		taskId,
		bindingDigest: "d".repeat(64),
		receiptId: `receipt_${"b".repeat(32)}`,
		receiptRevision: 7,
		transactionId: TXN_ID,
		revision: 3,
		state: "closed",
		phase: "terminal",
		recordedAt: "2026-08-14T01:00:00.000Z",
		updatedAt: "2026-08-14T01:00:03.000Z",
		heartbeatAt: null,
		checkpoint: "terminal",
		launchGeneration: `doctor_launch_${"9".repeat(32)}`,
		launchExpiresAt: null,
		workerPid: null,
		workerProcessIdentity: null,
		launchAttempt: 1,
		terminalResult: {
			kind: "doctor_result",
			status: "diagnosed",
			state: "repairable",
			phase: "writing",
			finding: "writes_in_progress",
			changedState: "none",
			retrySafety: "same_input_safe",
			// Legacy persisted continuation object.
			nextAction: { id: "inspect_status", summary: "legacy text" },
			repairAction: "resume",
			transactionId: TXN_ID,
		},
	};
	const file = join(dir, `${String(state.revision).padStart(12, "0")}.json`);
	await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
	await chmod(file, 0o600);
	return state;
}

describe("vault-git U1 Doctor Task durable next-action evolution", () => {
	// Point 5: legacy { id, summary } terminal reads through the real store, projects
	// contextually to the inspect_doctor_task union with exact doctor argv (compat id
	// preserved as inspect_status), and does not rewrite the history bytes or revision.
	test("legacy terminal reads and reprojects to inspect_doctor_task without rewriting history", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-durable-legacy-"));
		roots.push(root);
		await seedLegacyTerminalHistory(root, DOCTOR_TASK_ID);
		const before = await rawHistory(root, DOCTOR_TASK_ID);

		const store = createVaultGitDoctorTaskStore({ stateRoot: root, repositoryId: REPO_ID });
		const loaded = await store.loadByTaskId(DOCTOR_TASK_ID);
		expect(loaded.status).toBe("loaded");
		if (loaded.status !== "loaded") throw new Error("unreachable");
		const terminal = loaded.state.terminalResult;
		if (!terminal || terminal.kind !== "doctor_result") {
			throw new Error("legacy terminal result not loaded");
		}
		// Resolve the discriminated carrier through its typed owner: a legacy record
		// yields the legacy branch whose actionId is the compatibility id.
		const carrier = resolveVaultGitDoctorTerminalNextAction(terminal);
		if (carrier.kind !== "legacy") throw new Error("expected legacy carrier");
		expect(carrier.actionId).toBe("inspect_status");

		// Contextual reprojection by Task kind → authoritative inspect_doctor_task.
		const projected = projectVaultGitNextSafeAction({
			action_id: carrier.actionId,
			context: { result_kind: "doctor_task" },
			selectors: { doctor_task_id: DOCTOR_TASK_ID },
		});
		expect(projected.availability).toBe("available");
		expect(projected.continuation).toMatchObject({
			kind: "invoke",
			action_id: "inspect_doctor_task",
			executable: "vault-git",
			argv: ["doctor", "--task-id", DOCTOR_TASK_ID, "--json"],
		});

		// The read left the persisted history byte-for-byte and revision unchanged.
		const after = await rawHistory(root, DOCTOR_TASK_ID);
		expect(after.names).toEqual(before.names);
		expect(after.bytes).toEqual(before.bytes);
	});

	// Point 6: a NEW terminal write persists the semantic action ID only. Advance a
	// real Doctor Task to a terminal doctor_result through the store's public methods,
	// then raw-read the persisted history: it must carry the semantic id and NEITHER a
	// persisted summary NOR a legacy { id, summary } object. A subsequent read
	// reconstructs the full public continuation from durable state + catalog.
	test("new terminal write persists the semantic action ID only and reconstructs on read", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-doctor-durable-new-"));
		roots.push(root);
		const store = createVaultGitDoctorTaskStore({ stateRoot: root, repositoryId: REPO_ID });
		const binding = {
			repositoryId: REPO_ID,
			activationEvidenceId: `vault-git:prepared:v2:${"e".repeat(64)}`,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: TXN_ID,
			normalizedInput: '{"command":"doctor"}',
		} as const;
		const admitted = await store.claimOrJoin(binding, "2026-08-14T01:00:00.000Z");
		if (admitted.launch === "refused") throw new Error("seed doctor claim refused");
		const taskId = admitted.state.taskId;

		// Move claimed → in_progress → terminal through public transitions.
		const running = await store.transition(taskId, admitted.state.revision, {
			state: "in_progress",
			phase: "running",
			updatedAt: "2026-08-14T01:00:01.000Z",
			heartbeatAt: "2026-08-14T01:00:01.000Z",
			checkpoint: "checking_remote",
			launchGeneration: `doctor_launch_${"9".repeat(32)}`,
			launchExpiresAt: null,
			workerPid: 42,
			workerProcessIdentity: "f".repeat(64),
			launchAttempt: 1,
			terminalResult: null,
		});
		expect(running.status).toBe("transitioned");
		const terminalized = await store.transition(taskId, running.state.revision, {
			state: "closed",
			phase: "terminal",
			updatedAt: "2026-08-14T01:00:02.000Z",
			heartbeatAt: "2026-08-14T01:00:02.000Z",
			checkpoint: "terminal",
			launchGeneration: `doctor_launch_${"9".repeat(32)}`,
			launchExpiresAt: null,
			workerPid: 42,
			workerProcessIdentity: "f".repeat(64),
			launchAttempt: 1,
			terminalResult: {
				kind: "doctor_result",
				status: "diagnosed",
				state: "repairable",
				phase: "writing",
				finding: "writes_in_progress",
				changedState: "none",
				retrySafety: "same_input_safe",
				// New writes name the semantic action ID only; no summary.
				nextActionId: "inspect_doctor_task",
				repairAction: "resume",
				transactionId: TXN_ID,
			},
		});
		expect(terminalized.status).toBe("transitioned");

		// Independent raw read: the persisted terminal names the semantic id only.
		const { names, bytes } = await rawHistory(root, taskId);
		const latest = bytes[names.at(-1) as string];
		const persisted = JSON.parse(latest);
		expect(persisted.terminalResult.nextActionId).toBe("inspect_doctor_task");
		expect(persisted.terminalResult.nextAction).toBeUndefined();
		expect(latest).not.toContain('"summary"');

		// A subsequent read reconstructs the full public continuation from the durable
		// semantic id + catalog, contextually projected as a Doctor Task.
		const loaded = await store.loadByTaskId(taskId);
		expect(loaded.status).toBe("loaded");
		if (loaded.status !== "loaded") throw new Error("unreachable");
		const terminal = loaded.state.terminalResult;
		if (!terminal || terminal.kind !== "doctor_result") {
			throw new Error("new terminal result not loaded");
		}
		// Resolve the discriminated carrier: a new write yields the semantic branch.
		const carrier = resolveVaultGitDoctorTerminalNextAction(terminal);
		if (carrier.kind !== "semantic") throw new Error("expected semantic carrier");
		const projected = projectVaultGitNextSafeAction({
			action_id: carrier.actionId,
			context: { result_kind: "doctor_task" },
			selectors: { doctor_task_id: taskId },
		});
		expect(projected.continuation).toMatchObject({
			kind: "invoke",
			action_id: "inspect_doctor_task",
			argv: ["doctor", "--task-id", taskId, "--json"],
		});
	});
});
