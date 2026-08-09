import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const skillPath = resolve(import.meta.dir, "../SKILL.md");
const skill = readFileSync(skillPath, "utf8");
const match = skill.match(/^---\n(?<frontmatter>[\s\S]*?)\n---\n(?<body>[\s\S]*)$/u);

if (!match?.groups) throw new Error("SKILL.md frontmatter missing");

const frontmatter = match.groups.frontmatter;
const body = match.groups.body;

describe("vault-git skill contract", () => {
	test("frontmatter YAML-parses with quoted description and directory name", () => {
		const parsed = Bun.YAML.parse(frontmatter) as Record<string, unknown>;

		expect(parsed.name).toBe(basename(dirname(skillPath)));
		expect(parsed.description).toBeTypeOf("string");
		expect(frontmatter).toMatch(/^description:\s*(["']).*\1$/mu);
	});

	test("named runtime and invocation-proof owners exist", () => {
		const ownerPaths = [
			"runtime/vault-git-transaction-manager",
			"scripts/command-entrypoint.integration.test.ts",
		] as const;

		for (const ownerPath of ownerPaths) {
			expect(skill).toContain(`\`${ownerPath}\``);
			expect(existsSync(resolve(repositoryRoot, ownerPath))).toBe(true);
		}
	});

	test("body delegates deterministic contract details to the runtime", () => {
		expect(body.match(/--[a-z][a-z-]*/gu)).toEqual(["--silent"]);
		expect(body).not.toContain("--capability-fd");
		expect(body).not.toMatch(/schema_version/u);
		expect(body).not.toMatch(/exit codes?/iu);
		expect(body).not.toMatch(/\|\s*code\s*\|/iu);
	});

	test("read-only guidance stays transaction-free", () => {
		const readOnlyGuidance = body.match(
			/## Read Requests\n(?<guidance>[\s\S]*?)(?=\n## |$)/u,
		)?.groups?.guidance;

		expect(readOnlyGuidance).toBeDefined();
		expect(readOnlyGuidance).toContain("transaction-free");
		expect(readOnlyGuidance).not.toContain("begin");
	});
});
