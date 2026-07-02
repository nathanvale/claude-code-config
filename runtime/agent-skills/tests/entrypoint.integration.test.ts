import { existsSync, lstatSync } from "node:fs";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { applyVisibility, discoverCatalog } from "../src/catalog.ts";
import { main, type AgentSkillsCliRuntime } from "../src/cli.ts";
import { planProjection, applyProjection } from "../src/projection.ts";

interface MemoryWriter {
	output: string;
	write(chunk: string): void;
}

interface TestJsonEnvelope {
	status?: string;
	error?: {
		code?: string;
		message?: string;
		[key: string]: unknown;
	};
	data?: Record<string, unknown>;
	[key: string]: unknown;
}

describe("agent-skills entrypoint", () => {
	test("status human output shows calm inventory and one next action", async () => {
		const root = await tempRepo("status-human");
		await writeSkill(join(root, "skills"), "fallow");

		const result = await runTextCli(["status"], root);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("visible: 1");
		expect(result.output).toContain("ignored: 0");
		expect(result.output).toContain("next: Run sync");
	});

	test("status --json contains the same counts and next action", async () => {
		const root = await tempRepo("status-json");
		await writeSkill(join(root, "skills"), "fallow");

		const result = await runJsonCli(["status", "--json"], root);

		expect(result.exitCode).toBe(0);
		expect(result.envelope.status).toBe("ok");
		expect(result.envelope.data).toMatchObject({
			visible_count: 1,
			ignored_count: 0,
			next_action: "sync",
		});
	});

	test("sync --check --json exits 1, reports planned changes, and writes nothing", async () => {
		const root = await tempRepo("sync-check");
		await writeSkill(join(root, "skills"), "fallow");

		const result = await runJsonCli(["sync", "--check", "--json"], root);

		expect(result.exitCode).toBe(1);
		expect(result.envelope.status).toBe("ok");
		expect(result.envelope.data?.changes).toMatchObject({
			create_or_update: [".agents/skills/fallow", ".claude/skills/fallow"],
		});
		expect(existsSync(join(root, ".agents/skills/fallow"))).toBe(false);
	});

	test("sync writes projections and snapshot", async () => {
		const root = await tempRepo("sync");
		await writeSkill(join(root, "skills"), "fallow");

		const result = await runJsonCli(["sync", "--json"], root);

		expect(result.exitCode).toBe(0);
		expect(result.envelope.status).toBe("ok");
		expect(lstatSync(join(root, ".agents/skills/fallow")).isSymbolicLink()).toBe(
			true,
		);
		expect(existsSync(join(root, ".agents/agent-skills-snapshot.json"))).toBe(
			true,
		);
	});

	test("sync supports tracked .agents catalog with claude-only projections", async () => {
		const root = await tempRepo("legacy-catalog");
		await writeSkill(join(root, ".agents/skills"), "fallow");
		await writeFile(
			join(root, ".agent-skills.yml"),
			"catalog: ./.agents/skills\nprojection_roots:\n  - ./.claude/skills\n",
		);

		const result = await runJsonCli(["sync", "--json"], root);

		expect(result.exitCode).toBe(0);
		expect(result.envelope.status).toBe("ok");
		expect(result.envelope.data?.checked_roots).toEqual([
			join(root, ".claude/skills"),
		]);
		expect(lstatSync(join(root, ".agents/skills/fallow")).isDirectory()).toBe(
			true,
		);
		expect(lstatSync(join(root, ".claude/skills/fallow")).isSymbolicLink()).toBe(
			true,
		);
	});

	test("imports config fails repairably for status and sync with the migration hint", async () => {
		const root = await tempRepo("imports-removed");
		await writeFile(
			join(root, ".agent-skills.yml"),
			"catalog: ./skills\nimports:\n  - storybook-matrix\n",
		);

		const status = await runJsonCli(["status", "--json"], root);
		const sync = await runJsonCli(["sync", "--json"], root);

		expect(status.exitCode).toBe(1);
		expect(status.envelope.status).toBe("error");
		expect(status.envelope.error?.code).toBe("invalid_config");
		expect(status.envelope.error?.message).toContain("bunx skills add");
		expect(sync.exitCode).toBe(1);
		expect(sync.envelope.error?.code).toBe("invalid_config");
	});

	test("lockfile-managed installs read clean across status, sync, and unlink", async () => {
		const root = await tempRepo("external-clean");
		await writeSkill(join(root, "skills"), "fallow");
		await seedProjection(root);
		await writeSkill(join(root, ".agents/skills"), "frontend-design");
		await symlink(
			join(root, ".agents/skills/frontend-design"),
			join(root, ".claude/skills/frontend-design"),
		);
		await writeLock(root, {
			version: 1,
			skills: {
				"frontend-design": {
					source: "anthropics/skills",
					computedHash: "abc123",
				},
			},
		});

		const status = await runJsonCli(["status", "--json"], root);
		const syncCheck = await runJsonCli(["sync", "--check", "--json"], root);
		const unlink = await runTextCli(["unlink"], root);

		expect(status.exitCode).toBe(0);
		expect(status.envelope.data).toMatchObject({
			health: "clean",
			external_count: 2,
		});
		expect(syncCheck.exitCode).toBe(0);
		expect(unlink.exitCode).toBe(0);
		expect(lstatSync(join(root, ".agents/skills/frontend-design")).isDirectory()).toBe(
			true,
		);
		expect(
			lstatSync(join(root, ".claude/skills/frontend-design")).isSymbolicLink(),
		).toBe(true);
	});

	test("status human output counts externals and names missing ones with the restore hint", async () => {
		const root = await tempRepo("external-missing");
		await writeSkill(join(root, "skills"), "fallow");
		await seedProjection(root);
		await writeLock(root, {
			version: 1,
			skills: { "frontend-design": { source: "anthropics/skills" } },
		});

		const result = await runTextCli(["status"], root);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("external: 0");
		expect(result.output).toContain("missing external: 1");
		expect(result.output).toContain("bunx skills experimental_install");
	});

	test("corrupt lock names the parse failure and entries fall back to blockers", async () => {
		const root = await tempRepo("external-corrupt-lock");
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, ".agents/skills"), "frontend-design");
		await writeFile(join(root, "skills-lock.json"), "{not json", "utf8");

		const status = await runTextCli(["status"], root);
		const sync = await runTextCli(["sync"], root);

		expect(status.exitCode).toBe(0);
		expect(status.output).toContain("blocker: .agents/skills/frontend-design (real_entry)");
		expect(status.output).toContain("note: skills-lock.json could not be read");
		expect(sync.exitCode).toBe(1);
		expect(sync.stderr).toContain("skills-lock.json could not be read");
	});

	test("list --why names the lockfile and source for an external skill", async () => {
		const root = await tempRepo("external-list-why");
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, ".agents/skills"), "frontend-design");
		await writeLock(root, {
			version: 1,
			skills: { "frontend-design": { source: "anthropics/skills" } },
		});

		const result = await runTextCli(["list", "--why", "frontend-design"], root);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("frontend-design\texternal");
		expect(result.output).toContain("skills-lock.json");
		expect(result.output).toContain("anthropics/skills");
	});

	test("catalog conflict blocks sync and names both sources in stderr", async () => {
		const root = await tempRepo("external-conflict");
		await writeSkill(join(root, "skills"), "fallow");
		await writeLock(root, {
			version: 1,
			skills: { fallow: { source: "anthropics/skills" } },
		});

		const result = await runTextCli(["sync"], root);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("(catalog_conflict)");
		expect(result.stderr).toContain("skills-lock.json");
		expect(result.stderr).toContain("rename the catalog skill id");
	});

	test("sync failure names unmanaged blockers in human output", async () => {
		const root = await tempRepo("blocker-named");
		await writeSkill(join(root, "skills"), "fallow");
		await mkdir(join(root, ".agents/skills/squatter"), { recursive: true });

		const result = await runTextCli(["sync"], root);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(".agents/skills/squatter (real_entry)");
	});

	test("list --ignored names the matching ignore rule", async () => {
		const root = await tempRepo("list-ignored");
		await writeSkill(join(root, "skills"), "fallow");
		await writeFile(
			join(root, ".agent-skills.yml"),
			"catalog: ./skills\nignore:\n  - fallow\n",
		);

		const result = await runTextCli(["list", "--ignored"], root);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("fallow\tignored\tignored by fallow");
	});

	test("list --new shows skills added after the last snapshot", async () => {
		const root = await tempRepo("list-new");
		await writeSkill(join(root, "skills"), "fallow");
		await seedProjection(root);
		await writeSkill(join(root, "skills"), "summarize");

		const result = await runTextCli(["list", "--new"], root);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("summarize\tvisible");
		expect(result.output).not.toContain("fallow\tvisible");
	});

	test("list --why names the ignore rule for a specific skill", async () => {
		const root = await tempRepo("list-why");
		await writeSkill(join(root, "skills"), "fallow");
		await writeFile(
			join(root, ".agent-skills.yml"),
			"catalog: ./skills\nignore:\n  - fallow\n",
		);

		const result = await runTextCli(["list", "--why", "fallow"], root);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("fallow\tignored\tignored by fallow");
	});

	test("ignore add prints changed rule and next action", async () => {
		const root = await tempRepo("ignore-add");

		const result = await runTextCli(["ignore", "add", "fixture-*"], root);
		const config = await readFile(join(root, ".agent-skills.yml"), "utf8");

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("changed: fixture-*");
		expect(result.output).toContain("next: Run sync");
		expect(config).toContain("fixture-*");
	});

	test("status human output names broken projections", async () => {
		const root = await tempRepo("status-broken");
		await writeSkill(join(root, "skills"), "fallow");
		await mkdir(join(root, ".agents/skills"), { recursive: true });
		await symlink(join(root, "skills/missing"), join(root, ".agents/skills/fallow"));

		const result = await runTextCli(["status"], root);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("broken: .agents/skills/fallow");
		expect(result.output).toContain("next: Run sync");
	});

	test("list filters by positional skill id without --why", async () => {
		const root = await tempRepo("list-positional");
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, "skills"), "summarize");

		const result = await runTextCli(["list", "fallow"], root);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("fallow\tvisible");
		expect(result.output).not.toContain("summarize");
	});

	test("commands without --json exits 2 with usage semantics", async () => {
		const root = await tempRepo("commands-plain");

		const result = await runTextCli(["commands"], root);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("--json");
	});

	test("--help with an unknown command exits 2", async () => {
		const root = await tempRepo("help-unknown");

		const result = await runTextCli(["bogus", "--help"], root);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("Unknown command");
	});

	test("invalid usage exits 2 and points to help", async () => {
		const root = await tempRepo("usage");

		const result = await runJsonCli(["sync", "--force", "--json"], root);

		expect(result.exitCode).toBe(2);
		expect(result.envelope.status).toBe("error");
		expect(result.envelope.error?.message).toContain("Use --help");
	});

	test("missing config json error satisfies facade runtime contract", async () => {
		const root = await mkdtemp(join(tmpdir(), "agent-skills-entrypoint-missing-config-"));

		const result = await runJsonCli(["status", "--json"], root);

		expect(result.exitCode).toBe(1);
		expect(result.envelope.status).toBe("error");
		expect(result.envelope.error).toMatchObject({
			code: "missing_config",
			recoverability: "repair_state",
			retryable: false,
		});
	});

	test("unlink removes managed local projections and leaves foreign links", async () => {
		const root = await tempRepo("unlink");
		const outside = await mkdtemp(join(tmpdir(), "agent-skills-entry-foreign-"));
		await writeSkill(join(root, "skills"), "fallow");
		await seedProjection(root);
		await symlink(outside, join(root, ".agents/skills/foreign"));

		const result = await runTextCli(["unlink"], root);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain(".agents/skills/fallow");
		expect(existsSync(join(root, ".agents/skills/fallow"))).toBe(false);
		expect(lstatSync(join(root, ".agents/skills/foreign")).isSymbolicLink()).toBe(
			true,
		);
	});
});

async function runJsonCli(argv: readonly string[], root: string) {
	const stdout = createMemoryWriter();
	const exitCode = await main(argv, {
		stdout,
		runtime: runtime(root),
	});
	return {
		exitCode,
		envelope: JSON.parse(stdout.output) as TestJsonEnvelope,
		output: stdout.output,
	};
}

async function runTextCli(argv: readonly string[], root: string) {
	const stdout = createMemoryWriter();
	const stderr = createMemoryWriter();
	const exitCode = await main(argv, {
		stdout,
		stderr,
		runtime: runtime(root),
	});
	return { exitCode, output: stdout.output, stderr: stderr.output };
}

function runtime(root: string): Partial<AgentSkillsCliRuntime> {
	return {
		cwd: () => root,
		now: () => Date.parse("2026-06-16T00:00:00.000Z"),
	};
}

function createMemoryWriter(): MemoryWriter {
	return {
		output: "",
		write(chunk: string) {
			this.output += chunk;
		},
	};
}

async function tempRepo(name: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `agent-skills-entrypoint-${name}-`));
	await mkdir(join(root, "skills"), { recursive: true });
	return root;
}

async function writeSkill(catalog: string, id: string): Promise<void> {
	const dir = join(catalog, id);
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "SKILL.md"),
		`---\nname: ${id}\ndescription: "Test skill."\n---\n\n# ${id}\n`,
	);
}

async function writeLock(root: string, value: unknown): Promise<void> {
	await writeFile(
		join(root, "skills-lock.json"),
		JSON.stringify(value, null, 2),
		"utf8",
	);
}

async function seedProjection(root: string): Promise<void> {
	const catalogRoot = join(root, "skills");
	const visibility = applyVisibility(await discoverCatalog(catalogRoot), []);
	const plan = await planProjection({ repoRoot: root, catalogRoot, visibility });
	await applyProjection(plan, "2026-06-16T00:00:00.000Z");
}
