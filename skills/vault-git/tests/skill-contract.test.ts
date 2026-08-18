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

	test("body binds the begin, mutate-admitted-paths, complete workflow in order", () => {
		const workflow = body.match(
			/## Transaction Manager Workflow\n(?<guidance>[\s\S]*?)(?=\n## |$)/u,
		)?.groups?.guidance;

		expect(workflow).toBeDefined();
		const beginIndex = (workflow ?? "").indexOf("Call `begin`");
		const mutateIndex = (workflow ?? "").indexOf(
			"Mutate only paths admitted by the transaction",
		);
		const completeIndex = (workflow ?? "").indexOf("Call `complete`");
		expect(beginIndex).toBeGreaterThanOrEqual(0);
		expect(mutateIndex).toBeGreaterThan(beginIndex);
		expect(completeIndex).toBeGreaterThan(mutateIndex);
	});

	test("direct mode requires the explicit owner pause marker", () => {
		expect(body).toContain(
			"Check `${XDG_CONFIG_HOME:-$HOME/.config}/context/vault-git-paused` before invoking the transaction manager.",
		);
		expect(body).toContain(
			"Marker present: use Direct Git Mode. Do not invoke `vault-git`, delete private receipts, or alter the Remote Ledger.",
		);
		expect(body).toContain(
			"Never create or remove the marker without an explicit owner request.",
		);
		expect(body).toContain(
			"every other refusal are not pause triggers",
		);
	});

	test("body delegates deterministic contract details to the runtime", () => {
		const workflow = body.match(
			/## Transaction Manager Workflow\n(?<guidance>[\s\S]*?)(?=\n## |$)/u,
		)?.groups?.guidance;

		expect(workflow).toBeDefined();
		expect(workflow?.match(/--[a-z][a-z-]*/gu)).toEqual(["--silent"]);
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
