import { mkdtemp, mkdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { applySetup } from "../src/apply.ts";
import type { SetupInspectionInput } from "../src/inspection.ts";
import { unlinkSetup } from "../src/unlink.ts";

describe("setup unlink engine", () => {
	test("previews then removes only proven managed links", async () => {
		const fixture = await fixtureInput();
		await applySetup(fixture.input, { stateRoot: fixture.state });
		await mkdir(join(fixture.home, ".claude/skills/external"), { recursive: true });
		await writeFile(join(fixture.home, ".claude/skills/external/value"), "keep\n");

		const preview = await unlinkSetup(fixture.input, { check: true, stateRoot: fixture.state });
		expect(preview).toMatchObject({ state: "changes", station: "unlink.check_removable" });
		expect(await readlink(join(fixture.home, ".claude/skills/alpha"))).toBe(join(fixture.source, "skills/alpha"));

		const removed = await unlinkSetup(fixture.input, { stateRoot: fixture.state });
		expect(removed).toMatchObject({ state: "removed", station: "unlink.removed" });
		expect(removed.domains[0]?.applied).toHaveLength(2);
		expect(await Bun.file(join(fixture.home, ".claude/skills/external/value")).text()).toBe("keep\n");
	});

	test("preserves foreign links and real entries", async () => {
		const fixture = await fixtureInput();
		await mkdir(join(fixture.home, ".claude/skills"), { recursive: true });
		await symlink("/tmp/foreign", join(fixture.home, ".claude/skills/foreign"));
		await mkdir(join(fixture.home, ".agents/skills/real"), { recursive: true });

		const result = await unlinkSetup(fixture.input, { stateRoot: fixture.state });
		expect(result).toMatchObject({ state: "noop", station: "unlink.noop" });
		expect(await readlink(join(fixture.home, ".claude/skills/foreign"))).toBe("/tmp/foreign");
	});

	test("reports exact partial removal after a syscall failure", async () => {
		const fixture = await fixtureInput();
		await applySetup(fixture.input, { stateRoot: fixture.state });
		let removals = 0;
		const result = await unlinkSetup(fixture.input, {
			stateRoot: fixture.state,
			beforeRemove: async () => {
				removals += 1;
				if (removals === 2) throw new Error("fixture failure");
			},
		});
		expect(result).toMatchObject({ state: "partial", station: "unlink.partial_failure" });
		expect(result.domains[0]).toMatchObject({ applied: [expect.any(String)], failed: [expect.any(String)] });
	});

	test("preserves a foreign file that replaces a managed link before removal", async () => {
		const fixture = await fixtureInput();
		await applySetup(fixture.input, { stateRoot: fixture.state });
		const destination = join(fixture.home, ".agents/skills/alpha");
		let replaced = false;

		const result = await unlinkSetup(fixture.input, {
			stateRoot: fixture.state,
			beforeRemove: async (path) => {
				if (replaced || path !== destination) return;
				replaced = true;
				await rm(path);
				await writeFile(path, "foreign replacement\n");
			},
		});

		expect(result).toMatchObject({ state: "partial", station: "unlink.concurrent_change" });
		expect(await Bun.file(destination).text()).toBe("foreign replacement\n");
	});
});

async function fixtureInput() {
	const root = await mkdtemp(join(tmpdir(), "setup-unlink-"));
	const source = join(root, "source");
	const home = join(root, "home");
	const state = join(root, "state");
	await mkdir(join(source, "skills/alpha"), { recursive: true });
	await writeFile(join(source, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: alpha\n---\n");
	await mkdir(home);
	const input: SetupInspectionInput = { scope: "user", sourceRepoRoot: source, homeDir: home };
	return { root, source, home, state, input };
}
