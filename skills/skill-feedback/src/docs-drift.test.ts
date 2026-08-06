// fallow-ignore-file unused-file, code-duplication
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..");
const architecture = readFileSync(
	path.join(packageRoot, "ARCHITECTURE.md"),
	"utf8",
);

describe("ARCHITECTURE.md module map drift", () => {
	test("every src module is named in ARCHITECTURE.md", () => {
		const missing = readdirSync(path.join(packageRoot, "src"))
			.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
			.filter((file) => !architecture.includes(`src/${file}`));
		expect(missing).toEqual([]);
	});

	test("every src path named in ARCHITECTURE.md exists", () => {
		const named = [
			...architecture.matchAll(/src\/[A-Za-z0-9._/-]+\.ts/g),
		].map((match) => match[0]);
		const missing = [...new Set(named)].filter(
			(file) => !existsSync(path.join(packageRoot, file)),
		);
		expect(missing).toEqual([]);
	});
});
