import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseCliProcessJson } from "@side-quest/cli-command-facade/testing";

import {
	assertLedgerOwner,
	assertLedgerState,
	assertRefsUnchanged,
	assertStructuredCode,
	cleanupSmokeFixtures,
	mkSmokeFixture,
	readSmokeWorkerProcess,
	readLedgerDocument,
} from "./fixture.ts";

setDefaultTimeout(60_000);

afterEach(cleanupSmokeFixtures);

/**
 * Proves the smoke primitives themselves before any row depends on them.
 *
 * A matrix built on an unverified fixture can report green because the fixture
 * never exercised the thing it claims to observe.
 */
describe("smoke fixture primitives", () => {
	test("seeds a real remote and clone with the ledger absent", async () => {
		const fixture = await mkSmokeFixture();
		const snapshot = fixture.snapshot();

		expect(snapshot.localMain).toMatch(/^[0-9a-f]{40}$/);
		expect(snapshot.remoteMain).toBe(snapshot.localMain);
		expect(snapshot.ledgerTip).toBe("absent");
		assertLedgerState(fixture, "released");
	});

	test("begin acquires a real remote lease the ledger records", async () => {
		const fixture = await mkSmokeFixture();
		const before = fixture.snapshot();

		const transactionId = await fixture.begin("notes/event.md");

		const after = fixture.snapshot();
		expect(after.ledgerTip).not.toBe("absent");
		expect(after.ledgerTip).not.toBe(before.ledgerTip);
		// Acquiring a lease must not move main on either side.
		expect(after.localMain).toBe(before.localMain);
		expect(after.remoteMain).toBe(before.remoteMain);

		assertLedgerState(fixture, "held");
		assertLedgerOwner(fixture, transactionId);
		expect(readLedgerDocument(fixture).lease?.owned_paths).toEqual([
			"notes/event.md",
		]);
	});

	test("snapshot comparison catches a moved ref", async () => {
		const fixture = await mkSmokeFixture();
		const before = fixture.snapshot();
		await fixture.begin("notes/event.md");
		const after = fixture.snapshot();

		// The primitive must fail when something genuinely moved, otherwise
		// every row asserting "unchanged" would pass vacuously.
		expect(() => assertRefsUnchanged(before, after)).toThrow();
	});

	test("snapshot comparison passes when nothing moved", async () => {
		const fixture = await mkSmokeFixture();
		const before = fixture.snapshot();
		const after = fixture.snapshot();

		assertRefsUnchanged(before, after);
	});

	test("structured code assertion reads the exact error code", async () => {
		const fixture = await mkSmokeFixture();

		// An unadmitted path is refused with a precise code, not "any failure".
		const result = await fixture.run([
			"begin",
			"--event",
			"note_created",
			"--path",
			"../escape.md",
			"--json",
		]);

		expect(result.exitCode).not.toBe(0);
		assertStructuredCode(result, "owned_path_not_admitted");
	});

	test("the git shim records real push argv", async () => {
		const fixture = await mkSmokeFixture();
		await fixture.begin("notes/event.md");

		const pushes = await fixture.recordedPushes();
		expect(pushes.length).toBeGreaterThan(0);
		// The ledger acquisition pushes the ledger ref, never main.
		expect(pushes.some((argv) => argv.some((arg) => arg.includes("ledger")))).toBe(
			true,
		);
	});

	test("cleanup kills a prepared subprocess before removing its fixture", async () => {
		const fixture = await mkSmokeFixture();
		const prepared = await fixture.prepareAtInterrupt(
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

		expect(() => process.kill(prepared.pid, 0)).not.toThrow();
		await cleanupSmokeFixtures();
		expect(() => process.kill(prepared.pid, 0)).toThrow();
	});

	test("cleanup terminates the exact acknowledged detached worker", async () => {
		const fixture = await mkSmokeFixture();
		await writeFile(
			join(fixture.clone, "package.json"),
			`${JSON.stringify({
				private: true,
				scripts: { check: 'bun -e "while (true) await Bun.sleep(1000)"' },
			})}\n`,
		);
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "blocked cleanup worker\n");
		const accepted = await fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): prove smoke worker cleanup",
			"--json",
		]);
		expect(accepted.exitCode).toBe(0);
		const taskId = parseCliProcessJson<{ data?: { task_id?: string } }>(accepted)
			.data?.task_id;
		if (!taskId) throw new Error("accepted completion omitted task id");
		const worker = await readSmokeWorkerProcess(
			fixture.stateRoot,
			taskId,
			10_000,
		);
		expect(() => process.kill(worker.pid, 0)).not.toThrow();

		await cleanupSmokeFixtures();

		expect(() => process.kill(worker.pid, 0)).toThrow();
	});

	test("cleanup refuses a durable PID whose process identity mismatches", async () => {
		const fixture = await mkSmokeFixture();
		const unrelated = spawn(
			process.execPath,
			["-e", "while (true) await Bun.sleep(1000)"],
			{ detached: true, stdio: "ignore" },
		);
		if (!unrelated.pid) throw new Error("unrelated process omitted pid");
		const unrelatedPid = unrelated.pid;
		const taskId = `task_${"a".repeat(32)}`;
		const history = join(
			fixture.stateRoot,
			"vault-git-transaction-manager",
			"a".repeat(64),
			"tasks",
			taskId,
			"history",
		);
		await mkdir(history, { recursive: true });
		await writeFile(
			join(history, "000000000001.json"),
			`${JSON.stringify({
				taskId,
				workerPid: unrelatedPid,
				workerProcessIdentity: "0".repeat(64),
			})}\n`,
		);
		try {
			await cleanupSmokeFixtures();
			expect(() => process.kill(unrelatedPid, 0)).not.toThrow();
		} finally {
			unrelated.kill("SIGKILL");
			await waitForProcessExit(unrelatedPid);
		}
	});
});

async function waitForProcessExit(pid: number): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
			throw error;
		}
		await Bun.sleep(10);
	}
	throw new Error(`test process ${pid} survived cleanup`);
}
