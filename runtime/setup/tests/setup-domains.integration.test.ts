import { lstat, mkdtemp, mkdir, unlink, writeFile } from "node:fs/promises";
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
	test("applies safe user domains and reports missing memory as partial", async () => {
		const fixture = await userFixture(false);
		const result = await applySetupDomains(fixture.input, {
			stateRoot: fixture.state,
			hookPath: async () => fixture.hooks,
			instructionRunner: async () => ({ exitCode: 0, stdout: "captured child stdout\n", stderr: "" }),
		});
		expect(result).toMatchObject({ state: "partial", station: "sync.partial" });
		expect(result.domains.map((domain) => domain.domain)).toEqual(["skill_projection", "startup", "hooks", "instruction", "runbook"]);
		expect(result.findings).toContainEqual(expect.objectContaining({ id: "source_missing", path: join(fixture.source, "memory") }));
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
		const fixture = await userFixture(true);
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

	test("unlink removes proven startup and skill links but retains copied hooks", async () => {
		const fixture = await userFixture(true);
		await applySetupDomains(fixture.input, {
			stateRoot: fixture.state,
			hookPath: async () => fixture.hooks,
			instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
		});
		const result = await unlinkSetupDomains(fixture.input, { stateRoot: fixture.state });
		expect(result.state).toBe("removed");
		expect(await Bun.file(join(fixture.hooks, "pre-commit")).exists()).toBe(true);
		expect(await lstat(join(fixture.home, ".codex/AGENTS.md")).then(() => true, () => false)).toBe(false);
	});

	test("unlink preserves a foreign startup replacement introduced after preview", async () => {
		const fixture = await userFixture(true);
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
});

async function userFixture(includeMemory: boolean) {
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
		if (entry.source === "memory" && !includeMemory) continue;
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
