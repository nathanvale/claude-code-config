import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { readSkillsLock } from "../src/skills-lock.ts";

describe("skills-lock reader", () => {
	test("normalizes the observed object shape with source and computedHash", async () => {
		const root = await tempRoot("object-shape");
		await writeLock(root, {
			version: 1,
			skills: {
				"frontend-design": {
					source: "anthropics/skills",
					sourceType: "github",
					skillPath: "frontend-design",
					computedHash: "abc123",
				},
			},
		});

		const lock = await readSkillsLock(root);

		expect(lock.parseFailure).toBeUndefined();
		expect(lock.entries).toEqual([
			{
				id: "frontend-design",
				source: "anthropics/skills",
				computedHash: "abc123",
			},
		]);
	});

	test("normalizes the upstream array shape with hash", async () => {
		const root = await tempRoot("array-shape");
		await writeLock(root, {
			skills: [
				{
					name: "frontend-design",
					source: "anthropics/skills",
					agents: ["claude-code"],
					hash: "abc123",
				},
			],
		});

		const lock = await readSkillsLock(root);

		expect(lock.parseFailure).toBeUndefined();
		expect(lock.entries).toEqual([
			{
				id: "frontend-design",
				source: "anthropics/skills",
				computedHash: "abc123",
			},
		]);
	});

	test("missing lockfile reads as empty with no parse failure", async () => {
		const root = await tempRoot("missing");

		const lock = await readSkillsLock(root);

		expect(lock.entries).toEqual([]);
		expect(lock.parseFailure).toBeUndefined();
	});

	test("corrupt JSON degrades to empty plus a named parse failure", async () => {
		const root = await tempRoot("corrupt");
		await writeFile(join(root, "skills-lock.json"), "{not json", "utf8");

		const lock = await readSkillsLock(root);

		expect(lock.entries).toEqual([]);
		expect(lock.parseFailure).toContain("skills-lock.json");
	});

	test("unreadable lockfile names the read failure, not invalid JSON", async () => {
		const root = await tempRoot("unreadable");
		// A directory at the lock path passes existsSync but rejects readFile
		// (EISDIR), exercising the read branch deterministically.
		await mkdir(join(root, "skills-lock.json"));

		const lock = await readSkillsLock(root);

		expect(lock.entries).toEqual([]);
		expect(lock.parseFailure).toContain("could not read file:");
		expect(lock.parseFailure).not.toContain("invalid JSON");
	});

	test("unrecognized shape degrades to empty plus a named parse failure", async () => {
		const root = await tempRoot("bad-shape");
		await writeLock(root, { skills: "nope" });

		const lock = await readSkillsLock(root);

		expect(lock.entries).toEqual([]);
		expect(lock.parseFailure).toContain("skills-lock.json");
	});

	test("path-escaping lock keys are ignored, valid keys survive", async () => {
		const root = await tempRoot("crafted-keys");
		await writeLock(root, {
			version: 1,
			skills: {
				"../escape": { source: "evil" },
				"a/b": { source: "evil" },
				".": { source: "evil" },
				"..": { source: "evil" },
				"": { source: "evil" },
				fallow: { source: "good/source" },
			},
		});

		const lock = await readSkillsLock(root);

		expect(lock.parseFailure).toBeUndefined();
		expect(lock.entries).toEqual([{ id: "fallow", source: "good/source" }]);
	});

	test("lock with only invalid keys surfaces a parse failure", async () => {
		const root = await tempRoot("all-invalid");
		await writeLock(root, {
			version: 1,
			skills: { "../escape": { source: "evil" } },
		});

		const lock = await readSkillsLock(root);

		expect(lock.entries).toEqual([]);
		expect(lock.parseFailure).toContain("skills-lock.json");
	});

	test("validly empty skills map is empty without a parse failure", async () => {
		const root = await tempRoot("empty-map");
		await writeLock(root, { version: 1, skills: {} });

		const lock = await readSkillsLock(root);

		expect(lock.entries).toEqual([]);
		expect(lock.parseFailure).toBeUndefined();
	});
});

async function tempRoot(name: string): Promise<string> {
	return mkdtemp(join(tmpdir(), `agent-skills-lock-${name}-`));
}

async function writeLock(root: string, value: unknown): Promise<void> {
	await writeFile(
		join(root, "skills-lock.json"),
		JSON.stringify(value, null, 2),
		"utf8",
	);
}
