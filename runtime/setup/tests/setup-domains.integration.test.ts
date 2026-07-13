import { lstat, mkdtemp, mkdir, readlink, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { STARTUP_LINKS } from "../src/startup-topology.ts";
import { inspectSetup } from "../src/inspection.ts";
import { planSetup } from "../src/planner.ts";
import {
	applySetupDomains,
	checkSetupDomains,
	unlinkSetupDomains,
} from "../src/setup-domains.ts";

describe("setup domain composition", () => {
	test("applies every safe user domain from a clean baseline", async () => {
		const fixture = await userFixture();
		const result = await applySetupDomains(fixture.input, {
			stateRoot: fixture.state,
			hookPath: async () => fixture.hooks,
			instructionRunner: async () => ({ exitCode: 0, stdout: "captured child stdout\n", stderr: "" }),
		});
		expect(result).toMatchObject({ state: "applied", station: "sync.applied" });
		expect(result.domains.map((domain) => domain.domain)).toEqual(["skill_projection", "startup", "hooks", "instruction", "runbook"]);
		expect(await lstat(join(fixture.home, ".config/context")).then((entry) => entry.isSymbolicLink())).toBe(true);
		expect(result.child_output).toBe("captured child stdout\n");
	});

	test("project scope performs zero user-domain probes", async () => {
		const fixture = await projectFixture();
		let probes = 0;
		const result = await applySetupDomains(fixture.input, {
			stateRoot: fixture.state,
			hookPath: async () => { probes += 1; throw new Error("must not run"); },
			instructionRunner: async () => { probes += 1; throw new Error("must not run"); },
		});
		expect(probes).toBe(0);
		expect(result.domains.map((domain) => domain.domain)).toEqual(["skill_projection"]);
	});

	test("read-only project composition performs zero user-domain probes", async () => {
		const fixture = await projectFixture();
		let probes = 0;
		const base = await import("../src/planner.ts").then(async ({ planSetup }) =>
			planSetup(await import("../src/inspection.ts").then(({ inspectSetup }) => inspectSetup(fixture.input)), "status"));
		const result = await import("../src/setup-domains.ts").then(({ checkSetupDomains }) => checkSetupDomains(fixture.input, base, {
			hookPath: async () => { probes += 1; throw new Error("must not run"); },
			instructionRunner: async () => { probes += 1; throw new Error("must not run"); },
		}));
		expect(probes).toBe(0);
		expect(result.domains.map((domain) => domain.domain)).toEqual(["skill_projection"]);
	});

	test("labels a fresh user topology clean slate with preview as the next action", async () => {
		const fixture = await userFixture();
		const base = planSetup(await inspectSetup(fixture.input), "status");
		const result = await checkSetupDomains(fixture.input, base, {
			hookPath: async () => fixture.hooks,
			instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
		});

		expect(result).toMatchObject({
			state: "clean_slate",
			station: "status.clean_slate",
			next_action: "preview_sync",
		});
	});

	test("reports partial when safe user domains apply beside a blocked projection", async () => {
		const fixture = await userFixture();
		const occupied = [
			join(fixture.home, ".agents/skills/alpha"),
			join(fixture.home, ".claude/skills/alpha"),
		];
		for (const path of occupied) {
			await mkdir(join(path, ".."), { recursive: true });
			await writeFile(path, "foreign\n");
		}

		const result = await applySetupDomains(fixture.input, {
			stateRoot: fixture.state,
			hookPath: async () => fixture.hooks,
			instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
		});

		expect(result).toMatchObject({ state: "partial", station: "sync.partial", next_action: "inspect_results" });
		expect(result.findings.filter((finding) => finding.id === "real_entry").map((finding) => finding.path)).toEqual(occupied);
		expect(result.domains[0]).toEqual({
			domain: "skill_projection",
			planned: [], applied: [], deferred: [], preserved: occupied, failed: [],
		});
		expect(result.domains.find((domain) => domain.domain === "startup")?.applied).not.toHaveLength(0);
		expect(result.domains.find((domain) => domain.domain === "hooks")?.applied).not.toHaveLength(0);
	});

	test("unlink removes proven startup and skill links but retains copied hooks", async () => {
		const fixture = await userFixture();
		await applySetupDomains(fixture.input, {
			stateRoot: fixture.state,
			hookPath: async () => fixture.hooks,
			instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
		});
		const result = await unlinkSetupDomains(fixture.input, { stateRoot: fixture.state });
		expect(result.state).toBe("removed");
		expect(await Bun.file(join(fixture.hooks, "pre-commit")).exists()).toBe(true);
		expect(await lstat(join(fixture.home, ".codex/AGENTS.md")).then(() => true, () => false)).toBe(false);
		expect(await lstat(join(fixture.home, ".config/context")).then(() => true, () => false)).toBe(false);
	});

	test("unlink preserves a foreign startup replacement introduced after preview", async () => {
		const fixture = await userFixture();
		await applySetupDomains(fixture.input, {
			stateRoot: fixture.state, hookPath: async () => fixture.hooks,
			instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
		});
		const target = join(fixture.home, ".codex/AGENTS.md");
		const result = await unlinkSetupDomains(fixture.input, {
			stateRoot: fixture.state,
			beforeRemove: async (path) => {
				if (path !== target) return;
				await unlink(path);
				await writeFile(path, "foreign replacement\n");
			},
		});
		expect(result.station).toBe("unlink.concurrent_change");
		expect(result.domains.at(-1)?.failed).toEqual([target]);
		expect(await Bun.file(target).text()).toBe("foreign replacement\n");
	});

	test("unlink preview keeps a projection blocker above removable startup evidence", async () => {
		const fixture = await userFixture();
		const outside = join(fixture.source, "outside-projection");
		const startup = join(fixture.home, ".claude/AGENTS.md");
		await mkdir(join(fixture.home, ".claude"), { recursive: true });
		await mkdir(outside);
		await symlink(join(fixture.source, "AGENTS.md"), startup);
		await symlink(outside, join(fixture.home, ".claude/skills"));

		const result = await unlinkSetupDomains(fixture.input, { check: true, stateRoot: fixture.state });

		expect(result).toMatchObject({ state: "blocked", station: "unlink.check_blocked", next_action: "human_repair" });
		expect(result.findings).toContainEqual(expect.objectContaining({ id: "unsafe_root", path: join(fixture.home, ".claude/skills") }));
		expect(result.domains.at(-1)).toEqual({
			domain: "startup", planned: [startup], applied: [], deferred: [], preserved: [], failed: [],
		});
	});

	test("unlink blocks startup links reached through a parent that escapes home", async () => {
		const fixture = await userFixture();
		await applySetupDomains(fixture.input, {
			stateRoot: fixture.state, hookPath: async () => fixture.hooks,
			instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
		});
		const escapedParent = join(fixture.home, ".codex");
		const outside = join(fixture.source, "outside-home");
		const escapedLink = join(outside, "AGENTS.md");
		await rm(escapedParent, { recursive: true });
		await mkdir(outside);
		await symlink(join(fixture.source, "AGENTS.md"), escapedLink);
		await symlink(outside, escapedParent);

		const preview = await unlinkSetupDomains(fixture.input, { check: true, stateRoot: fixture.state });
		expect(preview).toMatchObject({ state: "blocked", station: "unlink.check_blocked" });
		expect(preview.findings).toContainEqual(expect.objectContaining({ id: "unsafe_root", path: escapedParent }));
		expect(preview.domains.at(-1)?.preserved).toContain(join(escapedParent, "AGENTS.md"));

		const result = await unlinkSetupDomains(fixture.input, { stateRoot: fixture.state });
		expect(result).toMatchObject({ state: "partial", station: "unlink.partial_failure" });
		expect(result.domains.at(-1)?.preserved).toContain(join(escapedParent, "AGENTS.md"));
		expect(await readlink(escapedLink)).toBe(join(fixture.source, "AGENTS.md"));
	});

	test("unlink rechecks startup parent containment immediately before removal", async () => {
		const fixture = await userFixture();
		await applySetupDomains(fixture.input, {
			stateRoot: fixture.state, hookPath: async () => fixture.hooks,
			instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
		});
		const escapedParent = join(fixture.home, ".codex");
		const target = join(escapedParent, "AGENTS.md");
		const outside = join(fixture.source, "outside-race");
		const escapedLink = join(outside, "AGENTS.md");
		const result = await unlinkSetupDomains(fixture.input, {
			stateRoot: fixture.state,
			beforeRemove: async (path) => {
				if (path !== target) return;
				await rm(escapedParent, { recursive: true });
				await mkdir(outside);
				await symlink(join(fixture.source, "AGENTS.md"), escapedLink);
				await symlink(outside, escapedParent);
			},
		});

		expect(result).toMatchObject({ state: "partial", station: "unlink.concurrent_change" });
		expect(result.findings).toContainEqual(expect.objectContaining({ id: "unsafe_root", path: escapedParent }));
		expect(result.domains.at(-1)?.failed).toContain(target);
		expect(await readlink(escapedLink)).toBe(join(fixture.source, "AGENTS.md"));
	});

	test("cycles a clean user baseline through check, apply, health, and unlink", async () => {
		const fixture = await userFixture();
		const check = await checkSetupDomains(
			fixture.input,
			planSetup(await inspectSetup(fixture.input), "sync"),
			{
				hookPath: async () => fixture.hooks,
				instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
			},
		);
		expect(check).toMatchObject({ state: "changes", station: "sync.check_changes" });

		const applied = await applySetupDomains(fixture.input, {
			stateRoot: fixture.state,
			hookPath: async () => fixture.hooks,
			instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
		});
		expect(applied.state).toBe("applied");

		const healthyCheck = await checkSetupDomains(
			fixture.input,
			planSetup(await inspectSetup(fixture.input), "sync"),
			{
				hookPath: async () => fixture.hooks,
				instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
			},
		);
		expect(healthyCheck).toMatchObject({ state: "healthy", station: "sync.check_clean" });

		const healthy = await checkSetupDomains(
			fixture.input,
			planSetup(await inspectSetup(fixture.input), "status"),
			{
				hookPath: async () => fixture.hooks,
				instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
			},
		);
		expect(healthy).toMatchObject({ state: "healthy", station: "status.healthy" });

		const removed = await unlinkSetupDomains(fixture.input, { stateRoot: fixture.state });
		expect(removed.state).toBe("removed");
		expect(await Bun.file(join(fixture.home, ".claude/skills/alpha")).exists()).toBe(false);
	});

	test("cycles an explicit project baseline without touching user domains", async () => {
		const fixture = await projectFixture();
		const preview = planSetup(await inspectSetup(fixture.input), "sync");
		expect(preview).toMatchObject({ state: "clean_slate", station: "sync.check_changes" });

		const applied = await applySetupDomains(fixture.input, { stateRoot: fixture.state });
		expect(applied).toMatchObject({ state: "applied", station: "sync.applied" });
		expect(await lstat(join(fixture.input.projectRepoRoot, ".agents/skills/alpha")).then((entry) => entry.isSymbolicLink())).toBe(true);
		expect(await lstat(join(fixture.input.homeDir, ".agents/skills/alpha")).then(() => true, () => false)).toBe(false);

		const healthy = planSetup(await inspectSetup(fixture.input), "status");
		expect(healthy).toMatchObject({ state: "healthy", station: "status.healthy" });

		const removed = await unlinkSetupDomains(fixture.input, { stateRoot: fixture.state });
		expect(removed).toMatchObject({ state: "removed", station: "unlink.removed" });
		expect(await lstat(join(fixture.input.projectRepoRoot, ".agents/skills/alpha")).then(() => true, () => false)).toBe(false);
	});
});

async function userFixture() {
	const root = await mkdtemp(join(tmpdir(), "setup-domains-"));
	const source = join(root, "source");
	const home = join(root, "home");
	const state = join(root, "state");
	const hooks = join(root, "git-hooks");
	await mkdir(join(source, "skills/alpha"), { recursive: true });
	await writeFile(join(source, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: alpha\n---\n");
	await mkdir(home);
	await mkdir(hooks);
	for (const entry of STARTUP_LINKS) {
		const path = join(source, entry.source);
		if (entry.source.includes(".")) await writeFile(path, "fixture\n");
		else await mkdir(path, { recursive: true });
	}
	await mkdir(join(source, "scripts/hooks"), { recursive: true });
	await writeFile(join(source, "scripts/hooks/pre-commit"), "hook\n");
	for (const dir of ["lib", "references", "templates"]) {
		await mkdir(join(source, "runbooks/issue-to-pr-v2", dir), { recursive: true });
		await writeFile(join(source, "runbooks/issue-to-pr-v2", dir, "item"), "x\n");
	}
	await writeFile(join(source, "runbooks/issue-to-pr-v2/cli.ts"), "x\n");
	return { source, home, state, hooks, input: { scope: "user" as const, sourceRepoRoot: source, homeDir: home } };
}

async function projectFixture() {
	const root = await mkdtemp(join(tmpdir(), "setup-project-domains-"));
	const source = join(root, "source");
	const project = join(root, "project");
	const home = join(root, "home");
	const state = join(root, "state");
	await mkdir(join(source, "skills"), { recursive: true });
	await mkdir(join(project, "skills/alpha"), { recursive: true });
	await writeFile(join(project, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: alpha\n---\n");
	await mkdir(home);
	return { state, input: { scope: "project" as const, sourceRepoRoot: source, projectRepoRoot: project, homeDir: home } };
}
