import { writeFile } from "node:fs/promises";
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

describe("row 8: local main ahead refuses before receipt creation", () => {
	test("public begin changes no private transaction or remote state", async () => {
		const fixture = await mkSmokeFixture();
		await writeFile(join(fixture.clone, "ahead.md"), "local-only commit\n");
		fixture.git("add", "--", "ahead.md");
		fixture.git("commit", "-m", "test: advance local main only");

		const before = fixture.snapshot();
		const store = createReceiptStore({
			stateRoot: fixture.stateRoot,
			repositoryIdentity: "smoke-vault",
		});
		expect(await store.load()).toEqual({ status: "absent" });

		const refused = await fixture.run([
			"begin",
			"--event",
			"note_created",
			"--path",
			"notes/event.md",
			"--json",
		]);
		expect(refused.exitCode).toBe(1);
		expect(parseCliProcessJson(refused)).toMatchObject({
			status: "error",
			error: { code: "main_ahead" },
			data: {
				outcome: "refused",
				transaction_state: "absent",
				write_permission: "denied",
				changed_state: "none",
			},
		});
		assertRefsUnchanged(before, fixture.snapshot());
		expect(await store.load()).toEqual({ status: "absent" });
	});
});
