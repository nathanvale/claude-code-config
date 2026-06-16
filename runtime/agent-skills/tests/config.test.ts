import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
	addIgnorePattern,
	loadAgentSkillsConfig,
	removeIgnorePattern,
} from "../src/config.ts";

describe("agent-skills config", () => {
	test("uses catalog-repo auto-default when ./skills exists", async () => {
		const root = await tempRoot("auto-default");
		await mkdir(join(root, "skills"), { recursive: true });

		const loaded = await loadAgentSkillsConfig(root);

		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.config.catalog).toBe("./skills");
		expect(loaded.config.ignore).toEqual([]);
		expect(loaded.config.autoDefault).toBe(true);
	});

	test("returns repairable missing-config error without config or ./skills", async () => {
		const root = await tempRoot("missing");

		const loaded = await loadAgentSkillsConfig(root);

		expect(loaded).toMatchObject({
			ok: false,
			error: { code: "missing_config" },
		});
	});

	test("loads minimal config and resolves catalog relative to repo root", async () => {
		const root = await tempRoot("minimal");
		await writeFile(
			join(root, ".agent-skills.yml"),
			"catalog: ./catalog\nignore:\n  - experimental-*\n",
		);

		const loaded = await loadAgentSkillsConfig(root);

		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.config.catalogRoot).toBe(join(root, "catalog"));
		expect(loaded.config.ignore).toEqual(["experimental-*"]);
	});

	test("rejects unsupported config shape without guessing", async () => {
		const root = await tempRoot("invalid");
		await writeFile(join(root, ".agent-skills.yml"), "catalog:\n  - ./skills\n");

		const loaded = await loadAgentSkillsConfig(root);

		expect(loaded).toMatchObject({
			ok: false,
			error: { code: "invalid_config" },
		});
	});

	test("ignore add creates minimal v1 config from auto-default", async () => {
		const root = await tempRoot("add");
		await mkdir(join(root, "skills"), { recursive: true });

		const updated = await addIgnorePattern(root, "experimental-*");
		const text = await readFile(join(root, ".agent-skills.yml"), "utf8");

		expect(updated.ok).toBe(true);
		expect(text).toContain("catalog: ./skills");
		expect(text).toContain("experimental-*");
	});

	test("ignore remove updates only supported v1 config", async () => {
		const root = await tempRoot("remove");
		await writeFile(
			join(root, ".agent-skills.yml"),
			"catalog: ./skills\nignore:\n  - experimental-*\n  - fixture-*\n",
		);

		const updated = await removeIgnorePattern(root, "fixture-*");

		expect(updated.ok).toBe(true);
		if (!updated.ok) return;
		expect(updated.config.ignore).toEqual(["experimental-*"]);
	});
});

async function tempRoot(name: string): Promise<string> {
	return mkdtemp(join(tmpdir(), `agent-skills-config-${name}-`));
}
