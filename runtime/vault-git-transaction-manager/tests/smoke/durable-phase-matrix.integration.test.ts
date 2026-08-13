import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseCliProcessJson } from "@side-quest/cli-command-facade/testing";

import { createReceiptStore } from "../../src/store.ts";
import {
	assertRefsUnchanged,
	assertLedgerState,
	assertWorktreeUnchanged,
	cleanupSmokeFixtures,
	mkSmokeFixture,
} from "./fixture.ts";

setDefaultTimeout(180_000);

afterEach(cleanupSmokeFixtures);

async function waitForTerminalTask(
	fixture: Awaited<ReturnType<typeof mkSmokeFixture>>,
	accepted: Awaited<ReturnType<Awaited<ReturnType<typeof mkSmokeFixture>>["run"]>>,
) {
	const taskId = parseCliProcessJson<{ data?: { task_id?: string } }>(accepted).data
		?.task_id;
	let status = await fixture.run([
		"status",
		"--task-id",
		taskId ?? "task_missing",
		"--json",
	]);
	for (let attempt = 0; attempt < 500; attempt += 1) {
		const state = parseCliProcessJson<{ data?: { task_state?: string } }>(status)
			.data?.task_state;
		if (state === "closed" || state === "repair_needed" || state === "unknown") {
			return status;
		}
		await Bun.sleep(10);
		status = await fixture.run([
			"status",
			"--task-id",
			taskId ?? "task_missing",
			"--json",
		]);
	}
	throw new Error("task did not reach a terminal state");
}

describe("AE5: every persisted phase has one safe continuation", () => {
	test("intent_durable resumes after a real process kill before remote CAS", async () => {
		const fixture = await mkSmokeFixture();
		const before = fixture.snapshot();
		const interrupted = await fixture.prepareAtInterrupt(
			[
				"begin",
				"--event",
				"note_created",
				"--path",
				"notes/event.md",
				"--json",
			],
			"before_remote_cas",
		);
		await interrupted.kill();

		const store = createReceiptStore({
			stateRoot: fixture.stateRoot,
			repositoryIdentity: "smoke-vault",
		});
		expect(await store.load()).toMatchObject({
			status: "loaded",
			receipt: { phase: "intent_durable", transactionId: null },
		});
		assertRefsUnchanged(before, fixture.snapshot());

		const doctor = await fixture.run(["doctor", "--json"]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			status: "ok",
			data: {
				phase: "intent_durable",
				finding: "acquisition_not_started",
				repair_action: "resume",
			},
			continuation: { next_action_id: "run_repair" },
		});
		const resumed = await fixture.run(["repair", "resume", "--json"]);
		expect(parseCliProcessJson(resumed)).toMatchObject({
			status: "ok",
			data: { outcome: "repaired", phase: "writing" },
			continuation: { next_action_id: "complete_transaction" },
		});
		assertLedgerState(fixture, "held");
		assertWorktreeUnchanged(before, fixture.snapshot());
	});

	test("leased resumes after a real process kill before write acknowledgement", async () => {
		const fixture = await mkSmokeFixture();
		const before = fixture.snapshot();
		const interrupted = await fixture.prepareAtInterrupt(
			[
				"begin",
				"--event",
				"note_created",
				"--path",
				"notes/event.md",
				"--json",
			],
			"before_won_generation_acknowledgement",
		);
		await interrupted.kill();

		const store = createReceiptStore({
			stateRoot: fixture.stateRoot,
			repositoryIdentity: "smoke-vault",
		});
		const loaded = await store.load();
		expect(loaded).toMatchObject({
			status: "loaded",
			receipt: { phase: "leased" },
		});
		if (loaded.status !== "loaded" || !loaded.receipt.transactionId) {
			throw new Error("leased receipt omitted transaction id");
		}
		const afterKill = fixture.snapshot();
		expect(afterKill.localMain).toBe(before.localMain);
		expect(afterKill.remoteMain).toBe(before.remoteMain);
		expect(afterKill.worktree).toBe(before.worktree);
		assertLedgerState(fixture, "held");

		const doctor = await fixture.run([
			"doctor",
			"--transaction-id",
			loaded.receipt.transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			status: "ok",
			data: {
				phase: "leased",
				finding: "lease_acquired",
				repair_action: "resume",
			},
			continuation: { next_action_id: "run_repair" },
		});
		const resumed = await fixture.run([
			"repair",
			"resume",
			"--transaction-id",
			loaded.receipt.transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(resumed)).toMatchObject({
			status: "ok",
			data: { outcome: "repaired", phase: "writing" },
			continuation: { next_action_id: "complete_transaction" },
		});
		assertLedgerState(fixture, "held");
		assertWorktreeUnchanged(before, fixture.snapshot());
	});

	test("checking resumes after the checker process is killed", async () => {
		const fixture = await mkSmokeFixture();
		const marker = join(fixture.root, "checking-ready");
		fixture.env.VAULT_GIT_TEST_PHASE_MARKER = marker;
		await writeFile(
			join(fixture.clone, "package.json"),
			`${JSON.stringify({
				private: true,
				scripts: { check: "bun run phase-check.ts" },
			})}\n`,
		);
		await writeFile(
			join(fixture.clone, "phase-check.ts"),
			[
				'import { writeFile } from "node:fs/promises";',
				"const marker = process.env.VAULT_GIT_TEST_PHASE_MARKER;",
				'if (!marker) throw new Error("missing phase marker");',
				'await writeFile(marker, "checking\\n");',
				"while (true) await Bun.sleep(10);",
			].join("\n"),
		);
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "checking bytes\n");
		const before = fixture.snapshot();

		await fixture.killOwnerAfterFile(
			[
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): interrupt checking",
				"--json",
			],
			marker,
		);
		assertRefsUnchanged(before, fixture.snapshot());
		assertLedgerState(fixture, "held");

		const doctor = await fixture.run([
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			status: "ok",
			data: {
				phase: "checking",
				finding: "checks_interrupted",
				repair_action: "resume",
			},
			continuation: { next_action_id: "run_repair" },
		});
		const resumed = await fixture.run([
			"repair",
			"resume",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(resumed)).toMatchObject({
			status: "ok",
			data: { outcome: "repaired", phase: "writing" },
			continuation: { next_action_id: "complete_transaction" },
		});
		assertLedgerState(fixture, "held");
		assertWorktreeUnchanged(before, fixture.snapshot());
	});

	test("committing resumes after the local commit process is killed", async () => {
		const fixture = await mkSmokeFixture({ shimMode: "block_commit" });
		await installPassingCheck(fixture.clone);
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "committing bytes\n");
		const before = fixture.snapshot();

		await fixture.killOwnerAfterFile(
			[
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): interrupt committing",
				"--json",
			],
			`${fixture.shimMarker}.commit-ready`,
		);
		assertRefsUnchanged(before, fixture.snapshot());
		assertLedgerState(fixture, "held");

		const doctor = await fixture.run([
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			status: "ok",
			data: {
				phase: "committing",
				finding: "commit_interrupted",
				repair_action: "resume",
			},
			continuation: { next_action_id: "run_repair" },
		});
		const resumed = await fixture.run([
			"repair",
			"resume",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(resumed)).toMatchObject({
			status: "ok",
			data: { outcome: "repaired", phase: "writing" },
			continuation: { next_action_id: "complete_transaction" },
		});
		assertLedgerState(fixture, "held");
		assertWorktreeUnchanged(before, fixture.snapshot());
	});

	test("push_pending retries the preserved commit after atomic close is killed", async () => {
		const fixture = await mkSmokeFixture({ shimMode: "block_close" });
		await installPassingCheck(fixture.clone);
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "push pending bytes\n");
		const before = fixture.snapshot();

		await fixture.killOwnerAfterFile(
			[
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): interrupt atomic close",
				"--json",
			],
			`${fixture.shimMarker}.close-ready`,
		);
		const afterKill = fixture.snapshot();
		expect(afterKill.localMain).not.toBe(before.localMain);
		expect(afterKill.remoteMain).toBe(before.remoteMain);
		expect(afterKill.ledgerTip).toBe(before.ledgerTip);
		expect(afterKill.worktree).toBe(before.worktree);
		assertLedgerState(fixture, "held");

		const doctor = await fixture.run([
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			status: "ok",
			data: {
				phase: "push_pending",
				finding: "publication_pending",
				repair_action: "retry-push",
			},
			continuation: { next_action_id: "run_repair" },
		});
		await writeFile(`${fixture.shimMarker}.release`, "retry\n");
		const retried = await fixture.run([
			"repair",
			"retry-push",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(retried)).toMatchObject({
			status: "ok",
			data: { outcome: "repaired", phase: "closed" },
			continuation: { next_action_id: "none" },
		});
		const closed = fixture.snapshot();
		expect(closed.remoteMain).toBe(closed.localMain);
		expect(closed.worktree).toBe(before.worktree);
		assertLedgerState(fixture, "released");
	});

	test("repairable resumes after a real checker failure", async () => {
		const fixture = await mkSmokeFixture();
		await writeFile(
			join(fixture.clone, "package.json"),
			`${JSON.stringify({
				private: true,
				scripts: { check: 'bun -e "process.exit(1)"' },
			})}\n`,
		);
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "repairable bytes\n");
		const before = fixture.snapshot();

		const accepted = await fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): preserve failed check",
			"--json",
		]);
		expect(accepted.exitCode).toBe(0);
		const repairableTask = await waitForTerminalTask(fixture, accepted);
		expect(parseCliProcessJson(repairableTask)).toMatchObject({
			status: "ok",
			data: {
				task_state: "repair_needed",
				task_checkpoint: "repairable",
				task_terminal_result: {
					blocker: "vault_check_failed",
					changedState: "local",
				},
			},
			continuation: { next_action_id: "run_doctor" },
		});
		assertRefsUnchanged(before, fixture.snapshot());
		assertLedgerState(fixture, "held");

		const doctor = await fixture.run([
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			status: "ok",
			data: {
				phase: "repairable",
				finding: "deterministic_failure",
				repair_action: "resume",
			},
			continuation: { next_action_id: "run_repair" },
		});
		const resumed = await fixture.run([
			"repair",
			"resume",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(resumed)).toMatchObject({
			status: "ok",
			data: { outcome: "repaired", phase: "writing" },
			continuation: { next_action_id: "complete_transaction" },
		});
		assertLedgerState(fixture, "held");
		assertWorktreeUnchanged(before, fixture.snapshot());
	});

	test("human_required preserves a one-ref publication for operator review", async () => {
		const fixture = await mkSmokeFixture({ shimMode: "partial_close" });
		await installPassingCheck(fixture.clone);
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "partial close bytes\n");
		const before = fixture.snapshot();

		const accepted = await fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): preserve partial publication",
			"--json",
		]);
		expect(accepted.exitCode).toBe(0);
		const humanRequiredTask = await waitForTerminalTask(fixture, accepted);
		expect(parseCliProcessJson(humanRequiredTask)).toMatchObject({
			status: "ok",
			data: {
				task_state: "unknown",
				task_checkpoint: "human_required",
				task_terminal_result: {
					blocker: "host_contract_breach",
					changedState: "partial",
					retrySafety: "operator_required",
				},
			},
			continuation: { next_action_id: "run_doctor" },
		});
		const after = fixture.snapshot();
		expect(after.localMain).not.toBe(before.localMain);
		expect(after.remoteMain).toBe(after.localMain);
		expect(after.ledgerTip).toBe(before.ledgerTip);
		expect(after.worktree).toBe(before.worktree);
		assertLedgerState(fixture, "held");

		const doctor = await fixture.run([
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		const diagnosis = parseCliProcessJson(doctor);
		expect(diagnosis).toMatchObject({
			status: "ok",
			data: {
				phase: "human_required",
				finding: "remote_contract_breach",
				retry_safety: "operator_required",
			},
			continuation: { next_action_id: "request_operator_review" },
		});
		expect(JSON.stringify(diagnosis)).not.toContain('"repair_action"');
	});

	test("blocked resumes after transport fails behind a durable intent", async () => {
		const fixture = await mkSmokeFixture({
			shimMode: "remote_offline_after_gate",
		});
		const before = fixture.snapshot();
		const interrupted = await fixture.prepareAtInterrupt(
			[
				"begin",
				"--event",
				"note_created",
				"--path",
				"notes/event.md",
				"--json",
			],
			"before_remote_cas",
		);
		const refused = await interrupted.trigger();
		expect(refused.exitCode).toBe(1);
		expect(parseCliProcessJson(refused)).toMatchObject({
			status: "error",
			error: { code: "remote_unavailable" },
			data: {
				phase: "blocked",
				transaction_state: "unknown",
				changed_state: "local",
			},
			continuation: { next_action_id: "retry_remote" },
		});
		assertRefsUnchanged(before, fixture.snapshot());

		const doctor = await fixture.run(["doctor", "--json"]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			status: "ok",
			data: {
				phase: "blocked",
				finding: "acquisition_not_started",
				repair_action: "resume",
			},
			continuation: { next_action_id: "run_repair" },
		});
		const resumed = await fixture.run(["repair", "resume", "--json"]);
		expect(parseCliProcessJson(resumed)).toMatchObject({
			status: "ok",
			data: { outcome: "repaired", phase: "writing" },
			continuation: { next_action_id: "complete_transaction" },
		});
		assertLedgerState(fixture, "held");
		assertWorktreeUnchanged(before, fixture.snapshot());
	});

	test("closed returns no continuation after verified atomic publication", async () => {
		const fixture = await mkSmokeFixture();
		await installPassingCheck(fixture.clone);
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "closed bytes\n");
		const before = fixture.snapshot();

		const completed = await fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): close durable phase proof",
			"--json",
		]);
		expect(completed.exitCode).toBe(0);
		expect(parseCliProcessJson(completed)).toMatchObject({
			status: "ok",
			data: { outcome: "advanced", task_state: "in_progress" },
			continuation: { next_action_id: "inspect_status" },
		});
		const terminal = await waitForTerminalTask(fixture, completed);
		expect(parseCliProcessJson(terminal)).toMatchObject({
			status: "ok",
			data: { outcome: "completed", phase: "closed", task_state: "closed" },
			continuation: { next_action_id: "none" },
		});
		const after = fixture.snapshot();
		expect(after.localMain).not.toBe(before.localMain);
		expect(after.remoteMain).toBe(after.localMain);
		expect(after.worktree).toBe(before.worktree);
		assertLedgerState(fixture, "released");

		const doctor = await fixture.run([
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		const diagnosis = parseCliProcessJson(doctor);
		expect(diagnosis).toMatchObject({
			status: "ok",
			data: {
				phase: "closed",
				finding: "transaction_closed",
				retry_safety: "same_input_safe",
			},
			continuation: { next_action_id: "none" },
		});
		expect(JSON.stringify(diagnosis)).not.toContain('"repair_action"');
	});

	// The cases above kill an owner process started with --capability-fd, which
	// skips the background launcher entirely. These two kill the detached worker
	// itself at the phases the background contract names.
	for (const workerCase of [
		{
			name: "after the local commit but before the push",
			point: "after_local_commit",
			expectedPhases: ["push_pending", "committing"],
		},
		{
			name: "after release publication but before task closure",
			point: "after_release_publication",
			expectedPhases: ["closed", "push_pending"],
		},
	] as const) {
		test(`a detached worker killed ${workerCase.name} leaves one safe continuation`, async () => {
			const fixture = await mkSmokeFixture();
			await installPassingCheck(fixture.clone);
			const transactionId = await fixture.begin("notes/event.md");
			await writeFile(
				join(fixture.clone, "notes/event.md"),
				`${workerCase.point} bytes\n`,
			);
			const before = fixture.snapshot();

			await fixture.killWorkerAtInterrupt(
				[
					"complete",
					"--transaction-id",
					transactionId,
					"--summary",
					`docs(vault): interrupt ${workerCase.point}`,
					"--json",
				],
				workerCase.point,
			);

			const store = createReceiptStore({
				stateRoot: fixture.stateRoot,
				repositoryIdentity: "smoke-vault",
			});
			const loaded = await store.load();
			if (loaded.status !== "loaded") throw new Error("receipt unavailable");
			expect(workerCase.expectedPhases).toContain(loaded.receipt.phase);
			// The worktree must survive a mid-publication kill untouched.
			expect(fixture.snapshot().worktree).toBe(before.worktree);

			const doctor = await fixture.run([
				"doctor",
				"--transaction-id",
				transactionId,
				"--json",
			]);
			const diagnosis = parseCliProcessJson<{
				status?: string;
				data?: { phase?: string; finding?: string };
				continuation?: { next_action_id?: string };
			}>(doctor);
			expect(diagnosis.status).toBe("ok");
			expect(typeof diagnosis.data?.finding).toBe("string");
			// Exactly one continuation, and never a remote-outage claim for a
			// locally interrupted worker.
			expect(typeof diagnosis.continuation?.next_action_id).toBe("string");
			expect(JSON.stringify(diagnosis)).not.toContain("remote_unavailable");
		});
	}
});

async function installPassingCheck(clone: string): Promise<void> {
	await writeFile(
		join(clone, "package.json"),
		`${JSON.stringify({
			private: true,
			scripts: { check: 'bun -e "process.exit(0)"' },
		})}\n`,
	);
}
