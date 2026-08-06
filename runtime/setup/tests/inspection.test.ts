import { lstat, mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { inspectSetup } from "../src/inspection.ts";
import { readProviderEvidence } from "../src/provider-evidence.ts";

describe("setup inspection", () => {
	test("treats missing provider evidence as optional attribution", async () => {
		const root = await fixtureRepo("missing-provider");
		const evidence = await readProviderEvidence(root);

		expect(evidence.entries).toEqual([]);
		expect(evidence.finding).toBeUndefined();
	});

	test("fails malformed provider evidence closed with a stable finding", async () => {
		const root = await fixtureRepo("malformed-provider");
		const home = await mkdtemp(join(tmpdir(), "setup-inspection-home-"));
		await writeFile(join(root, "skills-lock.json"), "{not json");
		const evidence = await readProviderEvidence(root);

		expect(evidence.entries).toEqual([]);
		expect(evidence.finding?.id).toBe("malformed_provider_lock");

		await mkdir(join(home, ".agents/skills/external"), { recursive: true });
		const inspection = await inspectSetup({
			scope: "user",
			sourceRepoRoot: root,
			homeDir: home,
		});
		expect(inspection.ownership.entries).toMatchObject([
			{ id: "external", ownership: "real_entry" },
		]);
		expect(inspection.findings.map((finding) => finding.id)).toEqual([
			"malformed_provider_lock",
			"real_entry",
		]);
	});

	test("reads object-map provider evidence with attribution metadata", async () => {
		const root = await fixtureRepo("provider-object-map");
		await writeFile(join(root, "skills-lock.json"), JSON.stringify({
			skills: {
				alpha: {
					source: "owner/repo",
					sourceType: "github",
					computedHash: "sha256:fixture",
				},
			},
		}));

		const evidence = await readProviderEvidence(root);

		expect(evidence.finding).toBeUndefined();
		expect(evidence.entries).toEqual([{
			id: "alpha",
			canonical_id: "alpha",
			source: "owner/repo",
			source_type: "github",
			has_hash: true,
		}]);
	});

	test("reads array provider evidence using name and id records", async () => {
		const root = await fixtureRepo("provider-array");
		await writeFile(join(root, "skills-lock.json"), JSON.stringify({
			skills: [
				{ name: "beta", source: "owner/beta", hash: "fixture" },
				{ id: "alpha", sourceType: "local" },
			],
		}));

		const evidence = await readProviderEvidence(root);

		expect(evidence.finding).toBeUndefined();
		expect(evidence.entries).toEqual([
			{ id: "alpha", canonical_id: "alpha", source: undefined, source_type: "local", has_hash: false },
			{ id: "beta", canonical_id: "beta", source: "owner/beta", source_type: undefined, has_hash: true },
		]);
	});

	test.each([
		["invalid id", { skills: { "bad/id": { source: "fixture" } } }],
		["canonical collision", { skills: { "Straße": {}, STRASSE: {} } }],
	])("rejects %s provider evidence without attribution", async (_label, contents) => {
		const root = await fixtureRepo("provider-invalid");
		await writeFile(join(root, "skills-lock.json"), JSON.stringify(contents));

		const evidence = await readProviderEvidence(root);

		expect(evidence.entries).toEqual([]);
		expect(evidence.finding?.id).toBe("malformed_provider_lock");
	});

	test("reports an unreadable provider path without throwing", async () => {
		const root = await fixtureRepo("provider-unreadable");
		await mkdir(join(root, "skills-lock.json"));

		const evidence = await readProviderEvidence(root);

		expect(evidence.entries).toEqual([]);
		expect(evidence.finding).toMatchObject({ id: "malformed_provider_lock" });
	});

	test("distinguishes an empty inventory from an empty provider file", async () => {
		const inventoryRoot = await fixtureRepo("provider-empty-inventory");
		await writeFile(join(inventoryRoot, "skills-lock.json"), JSON.stringify({ skills: {} }));
		expect(await readProviderEvidence(inventoryRoot)).toMatchObject({ entries: [] });
		expect((await readProviderEvidence(inventoryRoot)).finding).toBeUndefined();

		const fileRoot = await fixtureRepo("provider-empty-file");
		await writeFile(join(fileRoot, "skills-lock.json"), "");
		const emptyFile = await readProviderEvidence(fileRoot);
		expect(emptyFile.entries).toEqual([]);
		expect(emptyFile.finding?.id).toBe("malformed_provider_lock");
	});

	test("blocks project ids already visible in user scope without mutating disk", async () => {
		const sourceRepo = await fixtureRepo("source");
		const projectRepo = await fixtureRepo("project");
		const home = await mkdtemp(join(tmpdir(), "setup-inspection-home-"));
		await writeSkill(projectRepo, "fallow");
		await mkdir(join(home, ".agents/skills/fallow"), { recursive: true });
		const before = await lstat(join(home, ".agents/skills/fallow"));

		const inspection = await inspectSetup({
			scope: "project",
			sourceRepoRoot: sourceRepo,
			projectRepoRoot: projectRepo,
			homeDir: home,
		});

		expect(inspection.duplicate_scope_ids).toEqual(["fallow"]);
		expect(inspection.findings.map((finding) => finding.id)).toContain(
			"duplicate_scope",
		);
		expect((await lstat(join(home, ".agents/skills/fallow"))).mode).toBe(
			before.mode,
		);
		expect(Object.isFrozen(inspection)).toBe(true);
	});

	test("blocks project ids already visible in the legacy Codex user root", async () => {
		const sourceRepo = await fixtureRepo("legacy-source");
		const projectRepo = await fixtureRepo("legacy-project");
		const home = await mkdtemp(join(tmpdir(), "setup-inspection-home-"));
		await writeSkill(projectRepo, "fallow");
		await mkdir(join(home, ".codex/skills/fallow"), { recursive: true });

		const inspection = await inspectSetup({
			scope: "project",
			sourceRepoRoot: sourceRepo,
			projectRepoRoot: projectRepo,
			homeDir: home,
		});

		expect(inspection.duplicate_scope_ids).toEqual(["fallow"]);
		expect(inspection.findings).toContainEqual(expect.objectContaining({
			id: "duplicate_scope",
		}));
		expect(inspection.blocked).toBe(true);
	});

	test("invalid source skills block the selected catalog", async () => {
		const sourceRepo = await fixtureRepo("invalid");
		await mkdir(join(sourceRepo, "skills/draft"), { recursive: true });
		const home = await mkdtemp(join(tmpdir(), "setup-inspection-home-"));

		const inspection = await inspectSetup({
			scope: "user",
			sourceRepoRoot: sourceRepo,
			homeDir: home,
		});

		expect(inspection.blocked).toBe(true);
		expect(inspection.findings.map((finding) => finding.id)).toEqual([
			"invalid_skill",
		]);
	});

	test("blocks a source catalog root that resolves outside its repository", async () => {
		const sourceRepo = await mkdtemp(join(tmpdir(), "setup-inspection-escape-"));
		const outside = await fixtureRepo("outside-catalog");
		const home = await mkdtemp(join(tmpdir(), "setup-inspection-home-"));
		await writeSkill(outside, "escape");
		await symlink(join(outside, "skills"), join(sourceRepo, "skills"));

		const inspection = await inspectSetup({
			scope: "user",
			sourceRepoRoot: sourceRepo,
			homeDir: home,
		});

		expect(inspection.blocked).toBe(true);
		expect(inspection.catalog.entries).toEqual([]);
		expect(inspection.findings).toContainEqual(expect.objectContaining({
			id: "catalog_escape",
			path: join(sourceRepo, "skills"),
		}));
	});

	test.each([
		["missing delimiters", "name: alpha\ndescription: alpha\n"],
		["invalid yaml", "---\nname: [\ndescription: alpha\n---\n"],
		["non-map yaml", "---\n- name: alpha\n- description: alpha\n---\n"],
		["missing name", "---\ndescription: alpha\n---\n"],
		["blank name", "---\nname: '   '\ndescription: alpha\n---\n"],
		["missing description", "---\nname: alpha\n---\n"],
		["non-string description", "---\nname: alpha\ndescription: 42\n---\n"],
	])("blocks projection for malformed skill frontmatter: %s", async (_label, frontmatter) => {
		const sourceRepo = await fixtureRepo("invalid-frontmatter");
		const home = await mkdtemp(join(tmpdir(), "setup-inspection-home-"));
		await mkdir(join(sourceRepo, "skills/alpha"));
		await writeFile(join(sourceRepo, "skills/alpha/SKILL.md"), frontmatter);

		const inspection = await inspectSetup({
			scope: "user",
			sourceRepoRoot: sourceRepo,
			homeDir: home,
		});

		expect(inspection.blocked).toBe(true);
		expect(inspection.catalog.entries).toMatchObject([{ id: "alpha", state: "invalid" }]);
		expect(inspection.findings).toContainEqual(expect.objectContaining({ id: "invalid_skill" }));
	});
});

async function fixtureRepo(name: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `setup-inspection-${name}-`));
	await mkdir(join(root, "skills"));
	return root;
}

async function writeSkill(repo: string, id: string): Promise<void> {
	const directory = join(repo, "skills", id);
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, "SKILL.md"),
		`---\nname: ${id}\ndescription: "Test skill."\n---\n`,
	);
}
