import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { inspectProjectionRoots } from "../src/ownership.ts";

describe("setup ownership inspection", () => {
	test("assigns every disk child exactly one ownership classification", async () => {
		const root = await fixtureRoot("classes");
		const catalog = join(root, "catalog");
		const projection = join(root, "projection");
		const outside = join(root, "outside");
		await mkdir(join(catalog, "managed"), { recursive: true });
		await mkdir(projection);
		await mkdir(join(projection, "real"));
		await mkdir(outside);
		await symlink(join(catalog, "managed"), join(projection, "managed"));
		await symlink(join(catalog, "missing"), join(projection, "broken"));
		await symlink(outside, join(projection, "foreign"));
		await mkdir(join(projection, "external"));

		const result = await inspectProjectionRoots({
			catalogRoot: catalog,
			roots: [{ id: "codex", path: projection, safe: true }],
			providerEvidence: {
				path: join(root, "skills-lock.json"),
				entries: [
					{ id: "managed", canonical_id: "managed" },
					{ id: "broken", canonical_id: "broken" },
					{ id: "external", canonical_id: "external" },
				],
			},
		});

		expect(result.entries.map(({ id, ownership }) => ({ id, ownership }))).toEqual([
			{ id: "broken", ownership: "broken_managed_link" },
			{ id: "external", ownership: "external_entry" },
			{ id: "foreign", ownership: "foreign_symlink" },
			{ id: "managed", ownership: "managed_link" },
			{ id: "real", ownership: "real_entry" },
		]);
		expect(new Set(result.entries.map((entry) => entry.path)).size).toBe(5);
	});

	test("preserves entries under the Codex-managed legacy root", async () => {
		const root = await fixtureRoot("legacy");
		const legacy = join(root, ".codex/skills");
		await mkdir(join(legacy, "old-skill"), { recursive: true });

		const result = await inspectProjectionRoots({
			catalogRoot: join(root, "catalog"),
			roots: [
				{ id: "legacy_codex", path: legacy, safe: true, legacy: true },
			],
			providerEvidence: { path: join(root, "missing.json"), entries: [] },
		});

		expect(result.entries).toMatchObject([
			{
				id: "old-skill",
				ownership: "legacy_codex_root",
				finding_id: "legacy_codex_root",
			},
		]);
	});

	test("skips a child that vanishes between directory read and lstat", async () => {
		const root = await fixtureRoot("vanish");
		const projection = join(root, "projection");
		await mkdir(projection);
		let calls = 0;

		const result = await inspectProjectionRoots(
			{
				catalogRoot: join(root, "catalog"),
				roots: [{ id: "codex", path: projection, safe: true }],
				providerEvidence: { path: join(root, "missing.json"), entries: [] },
			},
			{
				readdir: async () => ["vanished"],
				lstat: async () => {
					calls += 1;
					throw Object.assign(new Error("gone"), { code: "ENOENT" });
				},
			},
		);

		expect(calls).toBe(1);
		expect(result.entries).toEqual([]);
	});
});

async function fixtureRoot(name: string): Promise<string> {
	return mkdtemp(join(tmpdir(), `setup-ownership-${name}-`));
}
