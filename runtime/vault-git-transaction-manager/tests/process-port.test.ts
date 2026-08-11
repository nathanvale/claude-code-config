import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeProcessPort } from "../src/git-adapter.ts";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("node process environment isolation", () => {
	test("isolated mode exposes only the explicitly admitted environment", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-process-isolation-"));
		roots.push(root);
		const ambientName = "VAULT_GIT_TEST_AMBIENT_SECRET";
		const previous = process.env[ambientName];
		process.env[ambientName] = "must-not-cross";
		try {
			const result = await createNodeProcessPort().run({
				command: process.execPath,
				args: [
					"-e",
					`process.stdout.write(JSON.stringify({ambient:process.env.${ambientName}, admitted:process.env.ADMITTED_VALUE}))`,
				],
				cwd: root,
				env: { ADMITTED_VALUE: "visible" },
				environmentMode: "isolated",
				timeoutMs: 5_000,
			});
			expect(result).toMatchObject({ exitCode: 0, timedOut: false });
			expect(JSON.parse(result.stdout)).toEqual({ admitted: "visible" });
		} finally {
			if (previous === undefined) delete process.env[ambientName];
			else process.env[ambientName] = previous;
		}
	});
});
