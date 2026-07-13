import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { checkRunbookHealth } from "../src/runbook-health.ts";

describe("runbook health", () => {
	test("delegates recursive artifact health to the runbook owner", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-runbook-"));
		for (const dir of ["lib", "references", "templates"]) {
			await mkdir(join(root, dir));
			await writeFile(join(root, dir, "item"), "x\n");
		}
		await writeFile(join(root, "cli.ts"), "x\n");
		expect(checkRunbookHealth(root)).toMatchObject({ healthy: true, missing: [] });
		expect(checkRunbookHealth(join(root, "missing"))).toMatchObject({ healthy: false, missing: ["references", "templates", "cli_ts", "lib_dir"] });
	});
});
