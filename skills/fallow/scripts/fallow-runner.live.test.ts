import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runForTest } from "./fallow-runner";

describe("live Fallow compatibility", () => {
	test.skipIf(process.env.FALLOW_RUNNER_LIVE !== "1")(
		"checks current Fallow CLI compatibility when explicitly enabled",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "fallow-runner-live-"));
			try {
				await writeFile(join(root, "package.json"), "{}\n", "utf-8");
				await mkdir(join(root, "src"), { recursive: true });
				await writeFile(
					join(root, "src", "index.ts"),
					"export const value = 1;\n",
					"utf-8",
				);

				const fallowBin = process.env.FALLOW_BIN ?? "fallow";
				const result = Bun.spawnSync({
					cmd: [fallowBin, "--help"],
					stdout: "pipe",
					stderr: "pipe",
				});
				expect(result.exitCode).toBe(0);
				expect(new TextDecoder().decode(result.stdout)).toContain("fallow");

				const localBin = join(root, "node_modules", ".bin");
				await mkdir(localBin, { recursive: true });
				const linkPath = join(localBin, "fallow");
				await writeFile(
					linkPath,
					`#!/usr/bin/env sh\nexec ${JSON.stringify(fallowBin)} "$@"\n`,
					"utf-8",
				);
				await chmod(linkPath, 0o755);

				const runner = await runForTest(["dead-code", "--root", root]);
				expect(runner.exitCode).toBe(0);
				const envelope = JSON.parse(runner.stdout) as {
					mode: string;
					failure_category: string;
					command: string[];
				};
				expect(envelope.mode).toBe("dead-code");
				expect(envelope.failure_category).toBe("none");
				expect(envelope.command).toContain("--format");
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);
});
