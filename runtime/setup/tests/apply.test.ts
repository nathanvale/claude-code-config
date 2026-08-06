import { mkdtemp, mkdir, readlink, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { describe, expect, test } from "bun:test";

import { applySetup } from "../src/apply.ts";
import { inspectSetup, type SetupInspectionInput } from "../src/inspection.ts";
import { planSetup } from "../src/planner.ts";

describe("setup apply engine", () => {
	test("applies the exact check plan with absolute user links", async () => {
		const fixture = await setupFixture("user");
		const preview = planSetup(await inspectSetup(fixture.input), "sync");
		const result = await applySetup(fixture.input, { stateRoot: fixture.state });

		expect(result.domains[0]?.planned).toEqual(preview.domains[0]?.planned);
		expect(result.domains[0]?.applied).toEqual(preview.domains[0]?.planned);
		expect(result).toMatchObject({ state: "applied", station: "sync.applied" });
		expect(await readlink(join(fixture.home, ".claude/skills/alpha"))).toBe(join(fixture.source, "skills/alpha"));
	});

	test("uses deterministic relative project links", async () => {
		const fixture = await setupFixture("project");
		await applySetup(fixture.input, { stateRoot: fixture.state });
		const destination = join(fixture.project, ".agents/skills/alpha");
		expect(await readlink(destination)).toBe(relative(join(fixture.project, ".agents/skills"), join(fixture.project, "skills/alpha")));
	});

	test("returns noop after a complete apply", async () => {
		const fixture = await setupFixture("user");
		await applySetup(fixture.input, { stateRoot: fixture.state });
		expect(await applySetup(fixture.input, { stateRoot: fixture.state })).toMatchObject({ state: "noop", station: "sync.noop" });
	});

	test("repairs a broken managed link", async () => {
		const fixture = await setupFixture("user");
		await mkdir(join(fixture.home, ".claude/skills"), { recursive: true });
		await symlink(join(fixture.source, "skills/old-alpha"), join(fixture.home, ".claude/skills/alpha"));

		const result = await applySetup(fixture.input, { stateRoot: fixture.state });
		expect(result.state).toBe("applied");
		expect(await readlink(join(fixture.home, ".claude/skills/alpha"))).toBe(join(fixture.source, "skills/alpha"));
	});

	test("blocks all writes when an occupied destination appears during preflight", async () => {
		const fixture = await setupFixture("user");
		await mkdir(join(fixture.home, ".claude/skills"), { recursive: true });
		await writeFile(join(fixture.home, ".claude/skills/alpha"), "foreign\n");

		const result = await applySetup(fixture.input, { stateRoot: fixture.state });
		expect(result).toMatchObject({ state: "blocked", station: "sync.blocked" });
		expect(result.domains[0]?.applied).toEqual([]);
		expect(await Bun.file(join(fixture.home, ".claude/skills/alpha")).text()).toBe("foreign\n");
		expect(await Bun.file(join(fixture.home, ".agents/skills/alpha")).exists()).toBe(false);
	});

	test("stops after a later foreign entry surprise and reports exact partial evidence", async () => {
		const fixture = await setupFixture("user");
		let links = 0;
		const result = await applySetup(fixture.input, {
			stateRoot: fixture.state,
			beforeSymlink: async (_source, destination) => {
				links += 1;
				if (links === 2) await writeFile(destination, "arrived\n");
			},
		});

		expect(result).toMatchObject({ state: "partial", station: "sync.concurrent_change" });
		expect(result.domains[0]?.applied).toHaveLength(1);
		expect(result.domains[0]?.deferred).toHaveLength(1);
	});

	test("stops when the selected source moves after planning", async () => {
		const fixture = await setupFixture("user");
		let moved = false;
		const result = await applySetup(fixture.input, {
			stateRoot: fixture.state,
			beforeSymlink: async () => {
				if (moved) return;
				moved = true;
				await rename(join(fixture.source, "skills/alpha"), join(fixture.source, "skills/moved-alpha"));
			},
		});
		expect(result).toMatchObject({ state: "partial", station: "sync.concurrent_change" });
		expect(result.domains[0]?.applied).toEqual([]);
	});

	test("stops when the catalog root escapes after planning", async () => {
		const fixture = await setupFixture("user");
		const outside = join(fixture.root, "outside-skills");
		await mkdir(join(outside, "alpha"), { recursive: true });
		await writeFile(join(outside, "alpha/SKILL.md"), "---\nname: alpha\ndescription: outside\n---\n");
		let moved = false;

		const result = await applySetup(fixture.input, {
			stateRoot: fixture.state,
			beforeSymlink: async () => {
				if (moved) return;
				moved = true;
				await rename(join(fixture.source, "skills"), join(fixture.source, "trusted-skills"));
				await symlink(outside, join(fixture.source, "skills"));
			},
		});

		expect(result).toMatchObject({ state: "partial", station: "sync.concurrent_change" });
		expect(result.domains[0]?.applied).toEqual([]);
		expect(await Bun.file(join(fixture.home, ".claude/skills/alpha")).exists()).toBe(false);
	});

	test("stops after a partial syscall failure", async () => {
		const fixture = await setupFixture("user");
		let links = 0;
		const result = await applySetup(fixture.input, {
			stateRoot: fixture.state,
			beforeSymlink: async () => {
				links += 1;
				if (links === 2) throw new Error("fixture failure");
			},
		});
		expect(result).toMatchObject({ state: "partial", station: "sync.apply_failure" });
		expect(result.domains[0]).toMatchObject({ applied: [expect.any(String)], failed: [expect.any(String)] });
	});
});

async function setupFixture(scope: "user" | "project") {
	const root = await mkdtemp(join(tmpdir(), "setup-apply-"));
	const source = join(root, "source");
	const home = join(root, "home");
	const project = join(root, "project");
	const state = join(root, "state");
	await mkdir(join(source, "skills/alpha"), { recursive: true });
	await writeFile(join(source, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: alpha\n---\n");
	await mkdir(home);
	await mkdir(project);
	if (scope === "project") {
		await mkdir(join(project, "skills/alpha"), { recursive: true });
		await writeFile(join(project, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: alpha\n---\n");
	}
	const input: SetupInspectionInput = scope === "user"
		? { scope, sourceRepoRoot: source, homeDir: home }
		: { scope, sourceRepoRoot: source, projectRepoRoot: project, homeDir: home };
	return { root, source, home, project, state, input };
}
