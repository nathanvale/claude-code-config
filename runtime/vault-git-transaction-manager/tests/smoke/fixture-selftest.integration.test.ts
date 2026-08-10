import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";

import {
	assertLedgerOwner,
	assertLedgerState,
	assertRefsUnchanged,
	assertStructuredCode,
	cleanupSmokeFixtures,
	mkSmokeFixture,
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
});
