// U8: ARCHITECTURE.md module-map drift gate (former projection CLI precedent).
// The old preflight test's doc-text assertions point at browser-use SKILL.md
// and deliberately do not port; this package's docs are gated here instead.
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
	"TASKS.md",
	"TASKS.archive.md",
] as const;

describe("warm-chrome maintainer docs", () => {
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
		// Lookbehind keeps foreign-package mentions (for example the browser-use
		// preflight path) out of the package-relative module map.
		const named = [
			...architecture.matchAll(/(?<![\w/-])src\/[A-Za-z0-9._/-]+\.ts/g),
		].map((match) => match[0]);
		const missing = [...new Set(named)].filter(
			(file) => !existsSync(path.join(packageRoot, file)),
		);
		expect(missing).toEqual([]);
	});
});
