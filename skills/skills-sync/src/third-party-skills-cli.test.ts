import { afterEach, describe, expect, test } from "bun:test";
import {
	chmod,
	mkdtemp,
	mkdir,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dir, "third-party-skills-cli.ts");
const FIXTURE_SKILL = `---
name: sample
description: "Fixture."
---

# Sample
`;
const FIXTURE_HASH = "63ed45dd4e019327f79c24179f2bc3f1556cb2138371bcf8e8b4d3bffd9ace84";
const FIXTURE_REF = "0123456789abcdef0123456789abcdef01234567";
const fixtureRoots: string[] = [];

afterEach(async () => {
	await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

async function makeFixture(
	options: { ref?: string; installedContent?: string; selected?: boolean } = {},
): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "third-party-skills-test-"));
	fixtureRoots.push(root);
	const skillDirectory = join(root, ".agents", "skills", "sample");
	await mkdir(skillDirectory, { recursive: true });
	await writeFile(join(skillDirectory, "SKILL.md"), options.installedContent ?? FIXTURE_SKILL);
	await writeFile(
		join(root, "skills-sources.yml"),
		options.selected === false
			? `version: 1
providers: {}
`
			: `version: 1
providers:
  owner/repo:
${options.ref ? `    ref: ${options.ref}\n` : ""}    skills:
      - sample
`,
	);
	await writeFile(
		join(root, "skills-lock.json"),
		`${JSON.stringify(
			{
				version: 1,
				generatedFrom:
					"skills-sources.yml via skills/skills-sync/src/third-party-skills-cli.ts",
				skills: {
					sample: {
						source: "owner/repo",
						...(options.ref ? { ref: options.ref } : {}),
						sourceType: "github",
						skillPath: "skills/sample/SKILL.md",
						computedHash: FIXTURE_HASH,
					},
				},
			},
			null,
			2,
		)}\n`,
	);
	return root;
}

async function runCli(
	args: string[],
	env: Record<string, string> = {},
): Promise<{ exitCode: number; stderr: string; stdout: string; json?: Record<string, unknown> }> {
	const child = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return {
		exitCode,
		stdout,
		stderr,
		json: stdout.trim().startsWith("{")
			? (JSON.parse(stdout) as Record<string, unknown>)
			: undefined,
	};
}

async function makeGitProvider(
	extraFiles: Record<string, string> = {},
): Promise<{ ref: string; source: string }> {
	const source = await mkdtemp(join(tmpdir(), "third-party-skills-provider-"));
	fixtureRoots.push(source);
	await mkdir(join(source, "skills", "sample"), { recursive: true });
	await writeFile(join(source, "skills", "sample", "SKILL.md"), FIXTURE_SKILL);
	for (const [path, content] of Object.entries(extraFiles)) {
		await writeFile(join(source, "skills", "sample", path), content);
	}
	for (const args of [
		["init"],
		["config", "user.email", "fixture@example.test"],
		["config", "user.name", "Fixture"],
		["add", "skills/sample"],
		["commit", "-m", "fixture"],
	]) {
		const process = Bun.spawn(["git", "-C", source, ...args], {
			stdout: "ignore",
			stderr: "pipe",
		});
		const exitCode = await process.exited;
		if (exitCode !== 0) throw new Error(await new Response(process.stderr).text());
	}
	const ref = (await Bun.$`git -C ${source} rev-parse HEAD`.text()).trim();
	return { ref, source };
}

describe("third-party-skills CLI", () => {
	test("help advertises the parser contract without loading repository state", async () => {
		const result = await runCli(["--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain(
			"third-party-skills check [--scope project|global|all] [--repo <path>] [--json]",
		);
		expect(result.stdout).toContain(
			"third-party-skills prune [--scope project|global|all] [--execute]",
		);
		expect(result.stdout).toContain("restore    Preview by default.");
	});

	test("invalid scope fails as usage before loading repository state", async () => {
		const result = await runCli(["check", "--scope", "somewhere"]);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("--scope requires project, global, or all");
	});

	test("prune execute requires an explicit scope", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF, selected: false });
		const isolatedHome = await mkdtemp(join(tmpdir(), "third-party-skills-home-"));
		fixtureRoots.push(isolatedHome);

		const result = await runCli(["prune", "--repo", root, "--execute", "--json"], {
			HOME: isolatedHome,
		});

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("prune --execute requires an explicit --scope");
		expect(await Bun.file(join(root, ".agents", "skills", "sample", "SKILL.md")).exists()).toBe(
			true,
		);
	});

	test("prune rejects lock skill ids that escape a projection root", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF, selected: false });
		const escapedPath = join(root, ".agents", "triage");
		await mkdir(escapedPath, { recursive: true });
		await writeFile(join(escapedPath, "SKILL.md"), FIXTURE_SKILL);
		await writeFile(
			join(root, "skills-lock.json"),
			`${JSON.stringify(
				{
					version: 1,
					generatedFrom:
						"skills-sources.yml via skills/skills-sync/src/third-party-skills-cli.ts",
					skills: {
						"../../triage": {
							source: "owner/repo",
							ref: FIXTURE_REF,
							sourceType: "github",
							skillPath: "skills/sample/SKILL.md",
							computedHash: FIXTURE_HASH,
						},
					},
				},
				null,
				2,
			)}\n`,
		);

		const result = await runCli(["prune", "--repo", root, "--scope", "project", "--json"]);

		expect(result.exitCode).toBe(3);
		expect(result.json?.diagnostics).toEqual([
			expect.objectContaining({ code: "invalid_skill_id", skill: "../../triage" }),
		]);
		expect(await Bun.file(join(escapedPath, "SKILL.md")).exists()).toBe(true);
	});

	test("prune previews previously locked skills removed from the manifest", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF, selected: false });

		const result = await runCli(["prune", "--repo", root, "--scope", "project", "--json"]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.json?.status).toBe("ok");
		expect(result.json?.changed_state).toBe("none");
		expect(result.json?.data).toEqual(
			expect.objectContaining({
				execute: false,
				skills: ["sample"],
				targets: [
					{
						label: "project",
						path: join(root, ".agents", "skills", "sample"),
						skill: "sample",
					},
				],
			}),
		);
		expect(await Bun.file(join(root, ".agents", "skills", "sample", "SKILL.md")).text()).toBe(
			FIXTURE_SKILL,
		);
	});

	test("prune execute removes a hash-matched project projection", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF, selected: false });
		const skillPath = join(root, ".agents", "skills", "sample");

		const result = await runCli([
			"prune",
			"--repo",
			root,
			"--scope",
			"project",
			"--execute",
			"--json",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.json?.status).toBe("ok");
		expect(result.json?.changed_state).toBe("projections");
		expect(result.json?.data).toEqual(
			expect.objectContaining({
				execute: true,
				removed_targets: 1,
				skills: ["sample"],
			}),
		);
		expect(await Bun.file(join(skillPath, "SKILL.md")).exists()).toBe(false);
	});

	test("lock execute blocks while a removed selection is still projected", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF, selected: false });
		const isolatedHome = await mkdtemp(join(tmpdir(), "third-party-skills-home-"));
		fixtureRoots.push(isolatedHome);
		const lockPath = join(root, "skills-lock.json");
		const originalLock = await Bun.file(lockPath).text();

		const result = await runCli(["lock", "--repo", root, "--execute", "--json"], {
			HOME: isolatedHome,
		});

		expect(result.exitCode).toBe(3);
		expect(result.json?.changed_state).toBe("none");
		expect(result.json?.diagnostics).toEqual([
			expect.objectContaining({
				code: "pending_prune",
				path: join(root, ".agents", "skills", "sample"),
				skill: "sample",
			}),
		]);
		expect(await Bun.file(lockPath).text()).toBe(originalLock);
		expect(await Bun.file(join(root, ".agents", "skills", "sample", "SKILL.md")).exists()).toBe(
			true,
		);
	});

	test("prune execute preserves every target when one projection hash differs", async () => {
		const root = await makeFixture({
			installedContent: `${FIXTURE_SKILL}\nlocal change\n`,
			ref: FIXTURE_REF,
			selected: false,
		});
		const skillPath = join(root, ".agents", "skills", "sample", "SKILL.md");

		const result = await runCli([
			"prune",
			"--repo",
			root,
			"--scope",
			"project",
			"--execute",
			"--json",
		]);

		expect(result.exitCode).toBe(5);
		expect(result.stderr).toBe("");
		expect(result.json?.status).toBe("error");
		expect(result.json?.changed_state).toBe("none");
		expect(result.json?.diagnostics).toEqual([
			expect.objectContaining({
				code: "prune_hash_mismatch",
				path: join(root, ".agents", "skills", "sample"),
				skill: "sample",
			}),
		]);
		expect(await Bun.file(skillPath).text()).toContain("local change");
	});

	test("prune reports exact partial progress when a later removal fails", async () => {
		if (process.getuid?.() === 0) return;
		const root = await makeFixture({ ref: FIXTURE_REF, selected: false });
		const isolatedHome = await mkdtemp(join(tmpdir(), "third-party-skills-home-"));
		fixtureRoots.push(isolatedHome);
		const globalRoot = join(isolatedHome, ".agents", "skills");
		const globalSkill = join(globalRoot, "sample");
		await mkdir(globalSkill, { recursive: true });
		await writeFile(join(globalSkill, "SKILL.md"), FIXTURE_SKILL);
		await chmod(globalRoot, 0o500);

		let result: Awaited<ReturnType<typeof runCli>>;
		try {
			result = await runCli(
				["prune", "--repo", root, "--scope", "all", "--execute", "--json"],
				{ HOME: isolatedHome },
			);
		} finally {
			await chmod(globalRoot, 0o700);
		}

		expect(result.exitCode).toBe(4);
		expect(result.json?.changed_state).toBe("projections");
		expect(result.json?.data).toEqual(expect.objectContaining({ removed_targets: 1 }));
		expect(result.json?.diagnostics).toEqual([
			expect.objectContaining({
				code: "prune_remove_failed",
				path: globalSkill,
				skill: "sample",
			}),
		]);
		expect(
			await Bun.file(join(root, ".agents", "skills", "sample", "SKILL.md")).exists(),
		).toBe(false);
	});

	test("check rejects a provider without an immutable commit ref", async () => {
		const root = await makeFixture();

		const result = await runCli(["check", "--repo", root, "--scope", "project", "--json"]);

		expect(result.exitCode).toBe(3);
		expect(result.stderr).toBe("");
		expect(result.json?.status).toBe("error");
		expect(result.json?.changed_state).toBe("none");
		expect(result.json?.diagnostics).toEqual([
			expect.objectContaining({ code: "missing_immutable_ref", skill: "sample" }),
		]);
	});

	test("check accepts a matching project projection", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF });

		const result = await runCli(["check", "--repo", root, "--scope", "project", "--json"]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.json?.status).toBe("ok");
		expect(result.json?.data).toEqual(
			expect.objectContaining({ entries: 1, projections_checked: 1, sources: 1 }),
		);
	});

	test("check fails when installed bytes differ from the reviewed hash", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF, installedContent: `${FIXTURE_SKILL}\ndrift\n` });

		const result = await runCli(["check", "--repo", root, "--scope", "project", "--json"]);

		expect(result.exitCode).toBe(5);
		expect(result.json?.diagnostics).toEqual([
			expect.objectContaining({ code: "hash_mismatch", skill: "sample" }),
		]);
	});

	test("check detects a symlink added to a reviewed projection", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF });
		await symlink(
			"SKILL.md",
			join(root, ".agents", "skills", "sample", "linked-skill.md"),
		);

		const result = await runCli(["check", "--repo", root, "--scope", "project", "--json"]);

		expect(result.exitCode).toBe(5);
		expect(result.json?.diagnostics).toEqual([
			expect.objectContaining({ code: "hash_mismatch", skill: "sample" }),
		]);
	});

	test("restore defaults to an immutable no-write preview", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF });
		const isolatedHome = await mkdtemp(join(tmpdir(), "third-party-skills-home-"));
		fixtureRoots.push(isolatedHome);

		const result = await runCli(["restore", "--repo", root, "--json"], {
			HOME: isolatedHome,
		});

		expect(result.exitCode).toBe(0);
		expect(result.json?.status).toBe("ok");
		expect(result.json?.changed_state).toBe("none");
		expect(result.json?.data).toEqual(
			expect.objectContaining({
				execute: false,
				scope: "all",
				sources: [
					{
						ref: FIXTURE_REF,
						skills: ["sample"],
						source: "owner/repo",
					},
				],
				targets: [
					{ label: "project", path: join(root, ".agents", "skills") },
					{ label: "global", path: join(isolatedHome, ".agents", "skills") },
					{ label: "claude-code", path: join(isolatedHome, ".claude", "skills") },
				],
			}),
		);
	});

	test("external commands time out with a structured diagnostic", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF });
		const fakeBin = await mkdtemp(join(tmpdir(), "third-party-skills-bin-"));
		fixtureRoots.push(fakeBin);
		await writeFile(join(fakeBin, "git"), "#!/bin/sh\nsleep 2\n", { mode: 0o755 });

		const result = await runCli(["lock", "--repo", root, "--execute", "--json"], {
			PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
			SKILLS_SYNC_PROCESS_TIMEOUT_MS: "50",
		});

		expect(result.exitCode).toBe(4);
		expect(result.json?.changed_state).toBe("none");
		expect(result.json?.diagnostics).toEqual([
			expect.objectContaining({ code: "process_timeout" }),
		]);
	});

	test("lock generates hash evidence from the exact provider commit", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF });
		const provider = await makeGitProvider();
		await writeFile(
			join(root, "skills-sources.yml"),
			`version: 1
providers:
  ${provider.source}:
    ref: ${provider.ref}
    skills:
      - sample
`,
		);

		const result = await runCli(["lock", "--repo", root, "--execute", "--json"]);

		expect(result.exitCode).toBe(0);
		expect(result.json?.status).toBe("ok");
		expect(result.json?.changed_state).toBe("lock");
		expect(await Bun.file(join(root, "skills-lock.json")).json()).toEqual({
			version: 1,
			generatedFrom:
				"skills-sources.yml via skills/skills-sync/src/third-party-skills-cli.ts",
			skills: {
				sample: {
					source: provider.source,
					ref: provider.ref,
					sourceType: "git",
					skillPath: "skills/sample/SKILL.md",
					computedHash: FIXTURE_HASH,
				},
			},
		});
		expect((await stat(join(root, "skills-lock.json"))).mode & 0o777).toBe(0o644);
	});

	test("lock hashes distinct directory trees to distinct values", async () => {
		const leftRoot = await makeFixture({ ref: FIXTURE_REF });
		const rightRoot = await makeFixture({ ref: FIXTURE_REF });
		const leftProvider = await makeGitProvider({ a: "bc" });
		const rightProvider = await makeGitProvider({ ab: "c" });
		for (const [root, provider] of [
			[leftRoot, leftProvider],
			[rightRoot, rightProvider],
		] as const) {
			await writeFile(
				join(root, "skills-sources.yml"),
				`version: 1
providers:
  ${provider.source}:
    ref: ${provider.ref}
    skills:
      - sample
`,
			);
		}

		const [leftResult, rightResult] = await Promise.all([
			runCli(["lock", "--repo", leftRoot, "--execute", "--json"]),
			runCli(["lock", "--repo", rightRoot, "--execute", "--json"]),
		]);

		expect(leftResult.exitCode).toBe(0);
		expect(rightResult.exitCode).toBe(0);
		const leftLock = await Bun.file(join(leftRoot, "skills-lock.json")).json();
		const rightLock = await Bun.file(join(rightRoot, "skills-lock.json")).json();
		expect(leftLock.skills.sample.computedHash).not.toBe(
			rightLock.skills.sample.computedHash,
		);
	});

	test("restore copies the reviewed commit and preserves the canonical lock", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF });
		const provider = await makeGitProvider();
		await writeFile(
			join(root, "skills-sources.yml"),
			`version: 1
providers:
  ${provider.source}:
    ref: ${provider.ref}
    skills:
      - sample
`,
		);
		const lockResult = await runCli(["lock", "--repo", root, "--execute", "--json"]);
		expect(lockResult.exitCode).toBe(0);
		const expectedLock = await Bun.file(join(root, "skills-lock.json")).text();
		await rm(join(root, ".agents"), { recursive: true });
		const fakeBin = await mkdtemp(join(tmpdir(), "third-party-skills-bin-"));
		fixtureRoots.push(fakeBin);
		await writeFile(
			join(fakeBin, "bunx"),
			'#!/bin/sh\nset -eu\ncheckout="$3"\nmkdir -p .agents/skills\ncp -R "$checkout/skills/sample" .agents/skills/sample\n',
			{ mode: 0o755 },
		);

		const result = await runCli(
			[
				"restore",
				"--repo",
				root,
				"--scope",
				"project",
				"--execute",
				"--json",
			],
			{ PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
		);

		expect(result.exitCode).toBe(0);
		expect(result.json?.status).toBe("ok");
		expect(result.json?.changed_state).toBe("projections");
		expect(await Bun.file(join(root, ".agents", "skills", "sample", "SKILL.md")).text()).toBe(
			FIXTURE_SKILL,
		);
		expect(await Bun.file(join(root, "skills-lock.json")).text()).toBe(expectedLock);
	});

	test("restore reports unknown lock state when canonical lock recovery fails", async () => {
		const root = await makeFixture({ ref: FIXTURE_REF });
		const provider = await makeGitProvider();
		await writeFile(
			join(root, "skills-sources.yml"),
			`version: 1
providers:
  ${provider.source}:
    ref: ${provider.ref}
    skills:
      - sample
`,
		);
		expect((await runCli(["lock", "--repo", root, "--execute", "--json"])).exitCode).toBe(0);
		const fakeBin = await mkdtemp(join(tmpdir(), "third-party-skills-bin-"));
		fixtureRoots.push(fakeBin);
		await writeFile(
			join(fakeBin, "bunx"),
			"#!/bin/sh\nrm skills-lock.json\nmkdir skills-lock.json\nexit 1\n",
			{ mode: 0o755 },
		);

		const result = await runCli(
			["restore", "--repo", root, "--scope", "project", "--execute", "--json"],
			{ PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
		);

		expect(result.exitCode).toBe(4);
		expect(result.json?.changed_state).toBe("projections");
		expect(result.json?.diagnostics).toEqual([
			expect.objectContaining({
				code: "lock_restore_failed",
				message: expect.stringContaining("lock state is unknown"),
			}),
		]);
	});
});
