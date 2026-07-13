import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
	canonicalSkillId,
	findCanonicalSkillIdCollisions,
	inspectCatalog,
} from "../src/catalog.ts";

describe("setup catalog inspection", () => {
	test("returns an empty immutable catalog when the source directory is absent", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-catalog-empty-"));
		const result = await inspectCatalog(join(root, "skills"));

		expect(result.entries).toEqual([]);
		expect(result.findings).toEqual([]);
		expect(Object.isFrozen(result)).toBe(true);
	});

	test("classifies valid and missing-SKILL.md children", async () => {
		const catalog = await tempCatalog("entries");
		await writeSkill(catalog, "fallow");
		await mkdir(join(catalog, "draft"));

		const result = await inspectCatalog(catalog);

		expect(result.entries).toMatchObject([
			{ id: "draft", state: "invalid", finding_id: "invalid_skill" },
			{
				id: "fallow",
				canonical_path: await realpath(join(catalog, "fallow")),
				state: "valid",
				name: "fallow",
			},
		]);
		expect(result.findings.map((finding) => finding.id)).toEqual([
			"invalid_skill",
		]);
	});

	test("skips the reserved archive child while still flagging other malformed children", async () => {
		const catalog = await tempCatalog("archive");
		await writeSkill(catalog, "fallow");
		// Archived skills keep nested SKILL.md files, but the graveyard is not a
		// deployable skill and must never surface as an entry, finding, or
		// collision candidate.
		await writeSkill(join(catalog, "archive"), "fallow");
		await writeSkill(join(catalog, "archive"), "retired");
		await mkdir(join(catalog, "draft"));

		const result = await inspectCatalog(catalog);

		expect(result.entries.map((entry) => entry.id)).toEqual([
			"draft",
			"fallow",
		]);
		expect(result.entries).toMatchObject([
			{ id: "draft", state: "invalid", finding_id: "invalid_skill" },
			{ id: "fallow", state: "valid", name: "fallow" },
		]);
		expect(result.findings.map((finding) => finding.id)).toEqual([
			"invalid_skill",
		]);
		expect(
			result.entries.some((entry) => entry.id === "archive"),
		).toBe(false);
		expect(
			result.findings.some((finding) => finding.path?.endsWith("/archive")),
		).toBe(false);
	});

	test("folds case, compatibility, sharp-s, and sigma before collision checks", async () => {
		expect(canonicalSkillId("Fallow")).toBe(canonicalSkillId("fallow"));
		expect(canonicalSkillId("ﬃxture")).toBe(canonicalSkillId("ffixture"));
		expect(canonicalSkillId("straße")).toBe(canonicalSkillId("STRASSE"));
		expect(canonicalSkillId("σος")).toBe(canonicalSkillId("σοσ"));

		expect(
			findCanonicalSkillIdCollisions([
				"Fallow",
				"fallow",
				"ﬃxture",
				"ffixture",
				"straße",
				"STRASSE",
				"σος",
				"σοσ",
			]),
		).toEqual(
			new Map([
				["fallow", ["Fallow", "fallow"]],
				["ffixture", ["ﬃxture", "ffixture"]],
				["strasse", ["straße", "STRASSE"]],
				["σοσ", ["σος", "σοσ"]],
			]),
		);
	});

	test("blocks a catalog child symlink that resolves outside the catalog", async () => {
		const catalog = await tempCatalog("escape");
		const outside = await mkdtemp(join(tmpdir(), "setup-catalog-outside-"));
		await writeSkill(outside, "evil");
		await symlink(join(outside, "evil"), join(catalog, "evil"));

		const result = await inspectCatalog(catalog);

		expect(result.entries).toMatchObject([
			{ id: "evil", state: "escape", finding_id: "catalog_escape" },
		]);
	});

	test("blocks a catalog root symlink that resolves outside the selected repository", async () => {
		const repository = await mkdtemp(join(tmpdir(), "setup-catalog-repository-"));
		const outside = await mkdtemp(join(tmpdir(), "setup-catalog-root-outside-"));
		await writeSkill(outside, "evil");
		await symlink(outside, join(repository, "skills"));

		const result = await inspectCatalog(join(repository, "skills"), repository);

		expect(result.entries).toEqual([]);
		expect(result.findings).toEqual([
			expect.objectContaining({
				id: "catalog_escape",
				path: join(repository, "skills"),
			}),
		]);
	});
});

async function tempCatalog(name: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `setup-catalog-${name}-`));
	const catalog = join(root, "skills");
	await mkdir(catalog);
	return catalog;
}

async function writeSkill(catalog: string, id: string): Promise<void> {
	const directory = join(catalog, id);
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, "SKILL.md"),
		`---\nname: ${id}\ndescription: "Test skill."\n---\n`,
	);
}
