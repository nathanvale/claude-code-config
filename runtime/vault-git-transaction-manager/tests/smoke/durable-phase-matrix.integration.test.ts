import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseCliProcessJson } from "@side-quest/cli-command-facade/testing";

import { readVaultGitProcessIdentity } from "../../src/cli.ts";
import { VAULT_GIT_LEDGER_REF } from "../../src/model.ts";
import { createReceiptStore } from "../../src/store.ts";
import {
	assertRefsUnchanged,
	assertLedgerState,
	assertWorktreeUnchanged,
	cleanupSmokeFixtures,
	mkSmokeFixture,
	publishBaselineChecker,
	runDoctorToTerminal,
} from "./fixture.ts";

setDefaultTimeout(180_000);

/**
 * Assert a legitimate terminal-none result: the authoritative union carries
 * id/action_id "none", and a legitimate terminal stop omits the continuation and any
 * runtime action entirely (nothing to run, nothing to escalate).
 */
function assertTerminalNone(envelope: unknown): void {
	const e = envelope as {
		data?: { next_action?: { id?: string; kind?: string; action_id?: string } };
		continuation?: unknown;
		runtime_actions?: unknown;
	};
	expect(e.data?.next_action).toMatchObject({
		id: "none",
		kind: "none",
		action_id: "none",
	});
	expect(e.continuation).toBeUndefined();
	expect(e.runtime_actions).toBeUndefined();
}

afterEach(cleanupSmokeFixtures);

async function waitForTerminalTask(
	fixture: Awaited<ReturnType<typeof mkSmokeFixture>>,
	accepted: Awaited<ReturnType<Awaited<ReturnType<typeof mkSmokeFixture>>["run"]>>,
) {
	const taskId = parseCliProcessJson<{ data?: { task_id?: string } }>(accepted).data
		?.task_id;
	if (!taskId) throw new Error("accepted completion omitted task id");
	let status = await fixture.run([
		"status",
		"--task-id",
		taskId,
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
			taskId,
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

		const doctor = await runDoctorToTerminal(fixture, ["doctor", "--json"]);
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

		const doctor = await runDoctorToTerminal(fixture, [
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
		// The candidate environment is scrubbed, so the marker path must ride in
		// the committed checker source; an env-delivered marker never arrives.
		await publishBaselineChecker(
			fixture,
			[
				'import { writeFile } from "node:fs/promises";',
				`await writeFile(${JSON.stringify(marker)}, "checking\\n");`,
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

		const doctor = await runDoctorToTerminal(fixture, [
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

		const doctor = await runDoctorToTerminal(fixture, [
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

		const doctor = await runDoctorToTerminal(fixture, [
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
		const retriedEnvelope = parseCliProcessJson(retried);
		expect(retriedEnvelope).toMatchObject({
			status: "ok",
			data: { outcome: "repaired", phase: "closed" },
		});
		assertTerminalNone(retriedEnvelope);
		const closed = fixture.snapshot();
		expect(closed.remoteMain).toBe(closed.localMain);
		expect(closed.worktree).toBe(before.worktree);
		assertLedgerState(fixture, "released");
	});

	test("repairable re-enters completion under the same task after a real checker failure", async () => {
		const fixture = await mkSmokeFixture();
		// The committed checker derives its verdict from the frozen owned bytes;
		// re-entry changes only the owned path, never the checker.
		await publishBaselineChecker(
			fixture,
			[
				'import { readFile } from "node:fs/promises";',
				'const source = await readFile("notes/event.md", "utf8");',
				'process.exit(source.includes("failing") ? 1 : 0);',
			].join("\n"),
		);
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(
			join(fixture.clone, "notes/event.md"),
			"repairable failing bytes\n",
		);
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
		const originalTaskId = parseCliProcessJson<{
			data?: { task_id?: string };
		}>(accepted).data?.task_id;
		expect(originalTaskId).toMatch(/^task_[0-9a-f]{32}$/);
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

		const doctor = await runDoctorToTerminal(fixture, [
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
		const interruptedRepair = await fixture.prepareAtInterrupt(
			[
				"repair",
				"resume",
				"--transaction-id",
				transactionId,
				"--json",
			],
			"after_repair_receipt_before_task_authorization",
		);
		expect(interruptedRepair.descendantProcesses.length).toBeGreaterThan(0);
		await interruptedRepair.kill();
		for (const descendant of interruptedRepair.descendantProcesses) {
			let observedIdentity: string | null = null;
			try {
				observedIdentity = readVaultGitProcessIdentity(descendant.pid);
			} catch {
				// An absent process proves cleanup succeeded.
			}
			expect(observedIdentity).not.toBe(descendant.identity);
		}
		expect(
			await createReceiptStore({
				stateRoot: fixture.stateRoot,
				repositoryIdentity: "smoke-vault",
			}).load(),
		).toMatchObject({
			status: "loaded",
			receipt: { transactionId, phase: "writing" },
		});
		const recoveryDoctor = await runDoctorToTerminal(fixture, [
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(recoveryDoctor)).toMatchObject({
			status: "ok",
			data: { phase: "writing", repair_action: "resume" },
			continuation: { next_action_id: "run_repair" },
		});
		assertLedgerState(fixture, "held");
		assertWorktreeUnchanged(before, fixture.snapshot());

		await writeFile(
			join(fixture.clone, "notes/event.md"),
			"repairable repaired bytes\n",
		);
		const beforeReentry = fixture.snapshot();
		const repairedCallers = await Promise.all(
			Array.from({ length: 20 }, () =>
				fixture.run([
					"complete",
					"--transaction-id",
					transactionId,
					"--summary",
					"docs(vault): preserve failed check",
					"--json",
				]),
			),
		);
		for (const caller of repairedCallers) {
			expect(
				caller.exitCode,
				`repaired completion refused:\n${caller.stdout}${caller.stderr}`,
			).toBe(0);
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

		const closedTask = await waitForTerminalTask(fixture, repairedCallers[0]);
		const closedTaskEnvelope = parseCliProcessJson(closedTask);
		expect(closedTaskEnvelope).toMatchObject({
			status: "ok",
			data: {
				outcome: "completed",
				phase: "closed",
				transaction_id: transactionId,
				task_id: originalTaskId,
				task_attempt_number: 2,
				task_previous_failure: { blocker: "vault_check_failed" },
				task_state: "closed",
			},
		});
		assertTerminalNone(closedTaskEnvelope);
		const closed = fixture.snapshot();
		expect(closed.localMain).not.toBe(beforeReentry.localMain);
		expect(closed.remoteMain).toBe(closed.localMain);
		expect(closed.worktree).toBe(beforeReentry.worktree);
		assertLedgerState(fixture, "released");
		const closes = (await fixture.recordedPushes()).filter(
			(args) => args.includes("--atomic") && !args.includes("--dry-run"),
		);
		expect(closes).toHaveLength(1);
	});

	test("human_required preserves a one-ref publication for operator review", async () => {
		const fixture = await mkSmokeFixture({ shimMode: "partial_close" });
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

		const doctor = await runDoctorToTerminal(fixture, [
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

		const doctor = await runDoctorToTerminal(fixture, ["doctor", "--json"]);
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
		const terminalEnvelope = parseCliProcessJson(terminal);
		expect(terminalEnvelope).toMatchObject({
			status: "ok",
			data: { outcome: "completed", phase: "closed", task_state: "closed" },
		});
		assertTerminalNone(terminalEnvelope);
		const after = fixture.snapshot();
		expect(after.localMain).not.toBe(before.localMain);
		expect(after.remoteMain).toBe(after.localMain);
		expect(after.worktree).toBe(before.worktree);
		assertLedgerState(fixture, "released");

		// The atomic close probes capability with dry-run refspecs; a supported
		// close must leave exactly main and the ledger on the remote and never
		// materialize a probe- ref. remoteRefs is one `refname\0objectname` line
		// per ref, so each refname is the head of a newline-split line.
		const remoteRefNames = after.remoteRefs
			.split("\n")
			.map((line) => line.split("\0")[0])
			.filter((name) => name.length > 0)
			.sort();
		expect(remoteRefNames).toEqual(
			["refs/heads/main", VAULT_GIT_LEDGER_REF].sort(),
		);

		const doctor = await runDoctorToTerminal(fixture, [
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
		});
		assertTerminalNone(diagnosis);
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
			expect(
				new Set<string>(workerCase.expectedPhases).has(loaded.receipt.phase),
			).toBe(true);
			// The worktree must survive a mid-publication kill untouched.
			expect(fixture.snapshot().worktree).toBe(before.worktree);

			const doctor = await runDoctorToTerminal(fixture, [
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
