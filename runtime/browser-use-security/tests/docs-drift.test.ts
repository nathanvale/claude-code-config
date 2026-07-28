// ARCHITECTURE.md module-map drift gate (warm-chrome drift-test precedent).
// Proves the ARCHITECTURE.md Module Map and src/ agree in both directions, and
// that the maintainer doc set is complete.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..");
const architecture = readFileSync(
	path.join(packageRoot, "ARCHITECTURE.md"),
	"utf8",
);

const maintainerDocs = [
	"AGENTS.md",
	"ARCHITECTURE.md",
	"CONTEXT.md",
	"README.md",
] as const;

describe("browser-use-security maintainer docs", () => {
	test("keeps the maintainer surface complete", () => {
		const missing = maintainerDocs.filter(
			(file) => !existsSync(path.join(packageRoot, file)),
		);
		expect(missing).toEqual([]);
	});
});

describe("ARCHITECTURE.md module map drift", () => {
	test("every src module is named in ARCHITECTURE.md", () => {
		const missing = readdirSync(path.join(packageRoot, "src"))
			.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
			.filter((file) => !architecture.includes(`src/${file}`));
		expect(missing).toEqual([]);
	});

	test("every src path named in ARCHITECTURE.md exists", () => {
		// Lookbehind keeps foreign-package mentions out of the package-relative
		// module map.
		const named = [
			...architecture.matchAll(/(?<![\w/-])src\/[A-Za-z0-9._/-]+\.ts/g),
		].map((match) => match[0]);
		const missing = [...new Set(named)].filter(
			(file) => !existsSync(path.join(packageRoot, file)),
		);
		expect(missing).toEqual([]);
	});
});
