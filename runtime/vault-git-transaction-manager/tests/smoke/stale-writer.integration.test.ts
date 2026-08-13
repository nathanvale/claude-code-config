import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseCliProcessJson } from "@side-quest/cli-command-facade/testing";

import { createReceiptStore } from "../../src/store.ts";
import {
	assertRefsUnchanged,
	cleanupSmokeFixtures,
	mkSmokeFixture,
} from "./fixture.ts";

setDefaultTimeout(180_000);

afterEach(cleanupSmokeFixtures);

describe("row 10: takeover fences the prior writer", () => {
	test("an already-running stale writer is quarantined before commit or push", async () => {
		const fixture = await mkSmokeFixture({ leaseDurationMs: 1 });
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "stale writer bytes\n");
		const staleWriter = await fixture.prepareOwner([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): stale writer must not publish",
			"--json",
		]);

		const takeover = await fixture.run([
			"repair",
			"stale-lease-takeover",
			"--transaction-id",
			transactionId,
			"--prior-writer-stopped",
			"--json",
		]);
		expect(takeover.exitCode).toBe(0);
		expect(parseCliProcessJson(takeover)).toMatchObject({
			status: "ok",
			data: { outcome: "repaired", transaction_state: "superseded" },
		});

		const refsAfterTakeover = fixture.snapshot();
		const ownedBytesAfterTakeover = await readFile(
			join(fixture.clone, "notes/event.md"),
			"hex",
		);
		const store = createReceiptStore({
			stateRoot: fixture.stateRoot,
			repositoryIdentity: "smoke-vault",
		});
		const receiptAfterTakeover = await store.load();

		const refused = await staleWriter.trigger();
		expect(refused.exitCode).toBe(1);
		expect(parseCliProcessJson(refused)).toMatchObject({
			status: "error",
			error: { code: "host_quarantined" },
			data: {
				outcome: "refused",
				transaction_state: "superseded",
				write_permission: "denied",
				changed_state: "none",
			},
			continuation: { next_action_id: "reconcile_quarantine" },
		});
		assertRefsUnchanged(refsAfterTakeover, fixture.snapshot());
		expect(await readFile(join(fixture.clone, "notes/event.md"), "hex")).toBe(
			ownedBytesAfterTakeover,
		);
		expect(await store.load()).toEqual(receiptAfterTakeover);
	});

	test("clears quarantine after a later aligned commit settles the owned path", async () => {
		const fixture = await mkSmokeFixture({ leaseDurationMs: 1 });
		const ownedPath = "notes/daily-driver-retro.md";
		const transactionId = await fixture.begin(ownedPath);
		await writeFile(join(fixture.clone, ownedPath), "settled later\n");

		const takeover = await fixture.run([
			"repair",
			"stale-lease-takeover",
			"--transaction-id",
			transactionId,
			"--prior-writer-stopped",
			"--json",
		]);
		expect(takeover.exitCode).toBe(0);

		fixture.git("add", "--", ownedPath);
		fixture.git(
			"commit",
			"--only",
			"-m",
			"docs: settle stranded owned path",
			"--",
			ownedPath,
		);
		fixture.git("push", "origin", "HEAD:refs/heads/main");
		const settled = fixture.snapshot();

		const reconciled = await fixture.run([
			"repair",
			"reconcile-quarantine",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(reconciled.exitCode).toBe(0);
		expect(parseCliProcessJson(reconciled)).toMatchObject({
			status: "ok",
			data: {
				outcome: "repaired",
				transaction_state: "closed",
				phase: "closed",
				changed_state: "local",
			},
			continuation: { next_action_id: "none" },
		});
		assertRefsUnchanged(settled, fixture.snapshot());

		const store = createReceiptStore({
			stateRoot: fixture.stateRoot,
			repositoryIdentity: "smoke-vault",
		});
		expect(await store.readQuarantine()).toMatchObject({
			status: "reconciled",
			transactionId,
		});
	});
});
