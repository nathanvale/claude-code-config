import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { resolveSetupScope } from "../src/scope.ts";

describe("setup scope resolution", () => {
	test("keeps user source and home target anchors separate", async () => {
		const sourceRepo = await tempDirectory("source");
		const home = await tempDirectory("home");
		const scope = await resolveSetupScope({
			scope: "user",
			sourceRepoRoot: sourceRepo,
			homeDir: home,
		});

		expect(scope).toMatchObject({
			scope: "user",
			source_anchor: sourceRepo,
			target_anchor: home,
			catalog_root: join(sourceRepo, "skills"),
			provider_evidence_root: sourceRepo,
		});
		expect(scope.projection_roots.map((root) => root.path)).toEqual([
			join(home, ".claude/skills"),
			join(home, ".agents/skills"),
		]);
	});

	test("project scope uses only the selected project's catalog and roots", async () => {
		const sourceRepo = await tempDirectory("source");
		const project = await tempDirectory("project");
		const scope = await resolveSetupScope({
			scope: "project",
			sourceRepoRoot: sourceRepo,
			projectRepoRoot: project,
		});

		expect(scope).toMatchObject({
			scope: "project",
			source_anchor: project,
			target_anchor: project,
			catalog_root: join(project, "skills"),
			provider_evidence_root: project,
		});
	});

	test("marks a projection root unsafe when an existing parent escapes its anchor", async () => {
		const sourceRepo = await tempDirectory("source");
		const home = await tempDirectory("home");
		const outside = await tempDirectory("outside");
		await symlink(outside, join(home, ".claude"));
		await mkdir(join(home, ".agents"));

		const scope = await resolveSetupScope({
			scope: "user",
			sourceRepoRoot: sourceRepo,
			homeDir: home,
		});

		expect(scope.projection_roots).toMatchObject([
			{ id: "claude", safe: false, finding_id: "unsafe_root" },
			{ id: "codex", safe: true },
		]);
	});
});

async function tempDirectory(name: string): Promise<string> {
	return mkdtemp(join(tmpdir(), `setup-scope-${name}-`));
}
