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

describe("activation trust negative controls", () => {
	for (const control of [
		{
			name: "identity",
			file: "src/repository-identity.ts",
			testFile: "tests/repository-identity.test.ts",
			mutate(source: string): string {
				return replaceRequired(source, [
					".update(bindings.gitCommonDirectoryDevice)",
					".update(bindings.gitCommonDirectoryInode)",
				], [
					'.update("disabled-device")',
					'.update("disabled-inode")',
				]);
			},
		},
		{
			name: "evidence",
			file: "src/activation-contract.ts",
			testFile: "tests/activation-contract.test.ts",
			mutate: (source: string) =>
				replaceRequired(
					source,
					["if (!sameText(expectedId, value.evidenceId)) {"],
					["if (false) {"],
				),
		},
		{
			name: "isolation",
			file: "src/activation-preparation.ts",
			testFile: "tests/activation-preparation.integration.test.ts",
			mutate: (source: string) =>
				replaceRequired(
					source,
					["options.createChecker(isolatedRepository)"],
					["options.createChecker(options.repositoryPath)"],
				),
		},
		{
			name: "admission",
			file: "src/engine.ts",
			testFile: "tests/engine-lifecycle.test.ts",
			mutate: (source: string) =>
				replaceRequired(
					source,
					['if (validation.status === "admitted") return null;'],
					["return null;"],
				),
		},
		{
			name: "invalidation",
			file: "src/activation-authority.ts",
			testFile: "tests/activation-authority.test.ts",
			mutate: (source: string) =>
				replaceRequired(
					source,
					["if (binding === null) return;"],
					["return;"],
				),
		},
		{
			name: "revocation",
			file: "src/activation-authority.ts",
			testFile: "tests/activation-authority.test.ts",
			mutate: (source: string) =>
				replaceRequired(
					source,
					["if (marker !== null) throw new AuthorityDenial(marker);"],
					["if (false) throw new AuthorityDenial(marker ?? \"revoked\");"],
				),
		},
	] as const) {
		test(`the ${control.name} owning test fails when its guard is disabled`, async () => {
			const root = await mkdtemp(
				join(resolve(packageRoot, ".."), `.activation-negative-${control.name}-`),
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
			expect(result.status, `${control.name} guard mutation unexpectedly survived`).not.toBe(0);
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
