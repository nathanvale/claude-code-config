import { lstat, mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
