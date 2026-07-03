import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
	applyVisibility,
	discoverCatalog,
	matchesSkillIdGlob,
} from "../src/catalog.ts";

describe("agent-skills catalog", () => {
	test("discovers valid direct child skills", async () => {
		const catalog = await tempCatalog("valid");
		await writeSkill(catalog, "fallow");

		const entries = await discoverCatalog(catalog);

		expect(entries).toMatchObject([
			{
				id: "fallow",
				name: "fallow",
				valid: true,
			},
		]);
	});

	test("marks folders without SKILL.md invalid", async () => {
		const catalog = await tempCatalog("invalid");
		await mkdir(join(catalog, "draft"), { recursive: true });

		const entries = await discoverCatalog(catalog);

		expect(entries).toMatchObject([
			{
				id: "draft",
				valid: false,
				reason: "missing_skill_file",
			},
		]);
	});

	test("matches ignore globs against entry ids, not paths or frontmatter names", async () => {
		const catalog = await tempCatalog("ignore");
		await writeSkill(catalog, "experimental-parser", "friendly-name");
		const visibility = applyVisibility(await discoverCatalog(catalog), [
			"experimental-*",
			"skills/friendly-name",
		]);

		expect(visibility).toMatchObject([
			{
				id: "experimental-parser",
				state: "ignored",
				matchingIgnore: "experimental-*",
			},
		]);
	});

	test("glob matching stays anchored to the full id", () => {
		expect(matchesSkillIdGlob("experimental-parser", "experimental-*")).toBe(
			true,
		);
		expect(matchesSkillIdGlob("stable-experimental-parser", "experimental-*")).toBe(
			false,
		);
	});

	test("glob matching folds case and APFS-equivalent Unicode variants", () => {
		expect(matchesSkillIdGlob("Fallow", "fallow")).toBe(true);
		expect(matchesSkillIdGlob("straße", "STRASSE")).toBe(true);
		expect(matchesSkillIdGlob("fixture-ß", "fixture-SS")).toBe(true);
	});
});

async function tempCatalog(name: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `agent-skills-catalog-${name}-`));
	const catalog = join(root, "skills");
	await mkdir(catalog, { recursive: true });
	return catalog;
}

async function writeSkill(
	catalog: string,
	id: string,
	name = id,
	description = "Test skill.",
): Promise<void> {
	const dir = join(catalog, id);
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "SKILL.md"),
		`---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`,
	);
}
