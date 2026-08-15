import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";

import { parseCliProcessJson } from "@side-quest/cli-command-facade/testing";

import {
	assertLedgerState,
	assertWorktreeUnchanged,
	cleanupSmokeFixtures,
	mkSmokeFixture,
	runDoctorToTerminal,
} from "./fixture.ts";

setDefaultTimeout(180_000);

afterEach(cleanupSmokeFixtures);

/**
 * Row 3 — AE5: a transaction stranded in `writing` is diagnosed from a
 * genuinely fresh process.
 *
 * The plan's objection to existing coverage is correct but narrower than
 * stated. `engine-lifecycle.test.ts` classifies phases by calling `recordPhase`
 * directly, and `live-acceptance.integration.test.ts` performs one real
 * SIGKILL-and-resume — but only at the `checking` phase.
 *
 * This row proves the `writing` phase, which `begin` leaves durable, is
 * correctly diagnosed by separate processes against a real remote.
 * Each CLI invocation is its own subprocess, so nothing carries over except
 * what reached the durable receipt store and the remote ledger — exactly the
 * state a crashed process would leave behind. This row invokes the advertised
 * `resume` action and proves it preserves unrelated worktree state.
 *
 * Note this is the one row where plain Git commands cannot supply the
 * precondition. The phase lives in the manager's private receipt store, not in
 * the repository, so observing it needs the CLI rather than git alone.
 */
describe("row 3: a stranded transaction is diagnosed in a new process", () => {
	test("a transaction left writing is diagnosed as writes_in_progress", async () => {
		const fixture = await mkSmokeFixture();
		const before = fixture.snapshot();
		const transactionId = await fixture.begin("notes/event.md");

		// A separate process reads only the durable receipt and the remote.
		const doctor = await runDoctorToTerminal(fixture, [
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);

		expect(parseCliProcessJson(doctor)).toMatchObject({
			status: "ok",
			data: {
				phase: "writing",
				finding: "writes_in_progress",
				repair_action: "resume",
			},
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

		// A stranded transaction must keep holding its lease: a crash may never
		// silently release an unresolved transaction.
		assertLedgerState(fixture, "held");
		assertWorktreeUnchanged(before, fixture.snapshot());
	});

	test("a stranded transaction leaves no commit on either side", async () => {
		const fixture = await mkSmokeFixture();
		const before = fixture.snapshot();

		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(
			join(fixture.clone, "notes/event.md"),
			"crash-resume event\n",
		);

		const after = fixture.snapshot();
		// The ledger moved because a lease was acquired, but no commit may exist
		// on either side, and unrelated bytes must be untouched.
		expect(after.ledgerTip).not.toBe(before.ledgerTip);
		expect(after.localMain).toBe(before.localMain);
		expect(after.remoteMain).toBe(before.remoteMain);
		expect(after.worktree).toBe(before.worktree);
		assertLedgerState(fixture, "held");
		expect(transactionId).toMatch(/^txn_/);
	});

	test("doctor reports the same finding across repeated fresh processes", async () => {
		const fixture = await mkSmokeFixture();
		const transactionId = await fixture.begin("notes/event.md");

		// Diagnosis must be a pure function of durable state: two independent
		// processes reading the same receipt must agree. A finding that drifts
		// between runs would mean the doctor depends on process-local state.
		const first = await runDoctorToTerminal(fixture, [
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		const second = await runDoctorToTerminal(fixture, [
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);

		const findingOf = (result: typeof first) => {
			const data = parseCliProcessJson<{
				data?: { finding?: string; phase?: string };
			}>(result).data;
			return { finding: data?.finding, phase: data?.phase };
		};

		expect(findingOf(second)).toMatchObject({
			phase: "writing",
			finding: "writes_in_progress",
		});
		expect(findingOf(second)).toEqual(findingOf(first));
	});
});
