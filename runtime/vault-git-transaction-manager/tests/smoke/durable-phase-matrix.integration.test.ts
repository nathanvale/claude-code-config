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

		const refused = await fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): preserve failed check",
			"--json",
		]);
		expect(refused.exitCode).toBe(1);
		expect(parseCliProcessJson(refused)).toMatchObject({
			status: "error",
			error: { code: "vault_check_failed" },
			data: { phase: "repairable", changed_state: "local" },
			continuation: { next_action_id: "run_repair" },
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

		const refused = await fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): preserve partial publication",
			"--json",
		]);
		expect(refused.exitCode).toBe(1);
		expect(parseCliProcessJson(refused)).toMatchObject({
			status: "error",
			error: { code: "host_contract_breach" },
			data: {
				phase: "human_required",
				changed_state: "partial",
				retry_safety: "operator_required",
			},
			continuation: { next_action_id: "request_operator_review" },
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
			data: { outcome: "completed", phase: "closed" },
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
