import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";

import { parseCliProcessJson } from "@side-quest/cli-command-facade/testing";

import {
	assertLedgerOwner,
	assertLedgerState,
	assertRefsUnchanged,
	cleanupSmokeFixtures,
	mkSmokeFixture,
	mkSmokeSibling,
} from "./fixture.ts";

setDefaultTimeout(120_000);

afterEach(cleanupSmokeFixtures);

/**
 * Row 7 — a janitor refusal must release the lease so the next writer is admitted.
 *
 * This guards the defect fixed in U7. A refusing janitor that keeps holding the
 * remote lease wedges the vault: every later writer is fenced by a transaction
 * that will never finish. No existing test covers it — `janitor.test.ts` proves
 * preview-only behaviour but never inspects the lease afterwards, and nothing
 * proves a *second real clone* can subsequently acquire.
 *
 * Everything here is real Git against a real bare remote. The second writer is
 * a genuine second clone, so admission is decided by the remote compare-and-swap
 * rather than by in-process state.
 */
describe("row 7: janitor refusal releases the lease", () => {
	test("a refused janitor leaves no held lease on the remote", async () => {
		const fixture = await mkSmokeFixture();

		// `tidy_now` from a non-scheduled host is refused by worker policy, which
		// is a refusal path that must still leave the ledger clean.
		const refused = await fixture.run(["janitor", "--json"]);
		const envelope = parseCliProcessJson<{
			readonly data?: { readonly janitor_report?: { readonly status?: string } };
		}>(refused);
		const status = envelope.data?.janitor_report?.status;
		expect(["refused", "preview", "repaired"]).toContain(status);

		// Whatever the janitor decided, it must not be sitting on a lease.
		assertLedgerState(fixture, "released");
	});

	test("a second real clone is admitted after a janitor run", async () => {
		const fixture = await mkSmokeFixture();
		const sibling = await mkSmokeSibling(fixture, "second-writer");

		await fixture.run(["janitor", "--json"]);
		assertLedgerState(fixture, "released");

		// The decisive proof: a genuinely separate clone acquires through the
		// remote. If the janitor had leaked a lease, this begin would be fenced.
		const transactionId = await sibling.begin("notes/event.md");

		assertLedgerState(sibling, "held");
		assertLedgerOwner(sibling, transactionId);
	});

	test("a janitor run moves no ref and disturbs no unrelated bytes", async () => {
		const fixture = await mkSmokeFixture();
		const before = fixture.snapshot();

		await fixture.run(["janitor", "--json"]);

		// A janitor run is preview-only: nothing on either side may move.
		assertRefsUnchanged(before, fixture.snapshot());
	});
});
