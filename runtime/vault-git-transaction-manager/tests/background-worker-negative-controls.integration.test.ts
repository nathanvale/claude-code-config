import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

const packageRoot = resolve(import.meta.dir, "..");
const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("background worker negative controls", () => {
	for (const control of [
		{
			name: "worker-uniqueness",
			file: "src/task-store.ts",
			testFile: "tests/task-store.test.ts",
			mutate: (source: string) =>
				replaceRequired(
					source,
					['await durability.linkExclusive(temporary, path, "task_claim");'],
					['await durability.rename(temporary, path, "task_claim");'],
				),
		},
		{
			name: "revision-cas",
			file: "src/task-store.ts",
			testFile: "tests/task-store.test.ts",
			mutate: (source: string) =>
				replaceRequired(
					source,
					[
						'if (loaded.state.revision !== expectedRevision) return { status: "stale", state: loaded.state };',
					],
					[""],
				),
		},
		{
			name: "stale-generation-refusal",
			file: "src/task-store.ts",
			testFile: "tests/task-store.test.ts",
			mutate: (source: string) =>
				replaceRequired(
					source,
					["fence?.expectedLaunchGeneration !== undefined &&"],
					["false &&"],
				),
		},
		{
			name: "terminal-refinement",
			file: "src/task-state.ts",
			testFile: "tests/task-state.test.ts",
			mutate: (source: string) =>
				replaceRequired(
					source,
					[
						'previous.state === "unknown" && input.state === "repair_needed";',
					],
					["true;"],
				),
		},
	] as const) {
		test(`the ${control.name} owning test fails when its guard is disabled`, async () => {
			const root = await mkdtemp(
				join(resolve(packageRoot, ".."), `.worker-negative-${control.name}-`),
			);
			roots.push(root);
			await Promise.all([
				cp(join(packageRoot, "src"), join(root, "src"), { recursive: true }),
				cp(join(packageRoot, "tests"), join(root, "tests"), { recursive: true }),
				cp(join(packageRoot, "package.json"), join(root, "package.json")),
			]);
			const baseline = runOwningTest(root, control.testFile);
			expect(
				baseline.status,
				`${control.name} owning test baseline did not pass`,
			).toBe(0);
			const path = join(root, control.file);
			const source = await readFile(path, "utf8");
			await writeFile(path, control.mutate(source));

			const result = runOwningTest(root, control.testFile);
			// A spawn error or timeout also yields a non-zero-ish status, which
			// would let a control "pass" without ever observing a real failure.
			expect(
				result.error,
				`${control.name} mutated run did not execute`,
			).toBeUndefined();
			expect(
				result.status,
				`${control.name} mutated run did not exit on its own`,
			).not.toBeNull();
			expect(
				result.status,
				`${control.name} guard mutation unexpectedly survived`,
			).not.toBe(0);
			expect(`${result.stdout}${result.stderr}`).toContain("(fail)");
		}, 120_000);
	}
});

function runOwningTest(root: string, testFile: string) {
	return spawnSync(process.execPath, ["test", testFile], {
		cwd: root,
		encoding: "utf8",
		timeout: 60_000,
	});
}

function replaceRequired(
	source: string,
	needles: readonly string[],
	replacements: readonly string[],
): string {
	let mutated = source;
	for (const [index, needle] of needles.entries()) {
		if (!mutated.includes(needle)) {
			throw new Error(`negative control seam missing: ${needle}`);
		}
		mutated = mutated.replace(needle, replacements[index] ?? "");
	}
	return mutated;
}
