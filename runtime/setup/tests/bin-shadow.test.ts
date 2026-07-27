import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, test } from "bun:test";

import { inspectBinTopology } from "../src/bin-topology.ts";
import { SETUP_ADVISORY_FINDING_IDS } from "../src/model.ts";

const SHEBANG_ENTRY = "#!/usr/bin/env bun\nconsole.log(\"bin fixture\");\n";

// DDA-A22 (runtime-env cluster): a duplicate/shadowing `browser-use` binary
// EARLIER on PATH than the setup-owned bin dir must be detected by
// `setup status` and NAME BOTH paths — the shadow and the owned destination.
// The oracle: fixture shadow bin earlier on PATH; status names both paths.
describe("DDA-A22 shadowing bins earlier on PATH", () => {
	test("names the shadow path and the owned destination when the shadow is earlier on PATH", async () => {
		const fixture = await shadowFixture();
		await writeTool(fixture.source, "browser-use");

		// A rival `browser-use` executable in a directory that precedes binDir on
		// PATH — the exact daily-driver hazard (a stale global install shadowing
		// the setup-owned bin).
		const shadowDir = join(fixture.root, "shadow-bin");
		await mkdir(shadowDir, { recursive: true });
		const shadowPath = join(shadowDir, "browser-use");
		await writeFile(shadowPath, SHEBANG_ENTRY);
		await chmod(shadowPath, 0o755);

		const plan = await inspectBinTopology(fixture.source, fixture.home, {
			binDir: fixture.binDir,
			// shadowDir precedes binDir: the shadow wins resolution.
			pathEnv: [shadowDir, fixture.binDir].join(delimiter),
		});

		const shadowed = plan.advisories.find((advisory) => advisory.id === "bin_shadowed");
		expect(shadowed).toBeDefined();
		if (!shadowed) return;
		const ownedDestination = join(fixture.binDir, "browser-use");
		// Names BOTH paths: the shadow (path) and the owned destination (why).
		expect(shadowed.path).toBe(await realpath(shadowPath).catch(() => shadowPath));
		expect(shadowed.why).toContain(ownedDestination);
		expect(shadowed.summary).toContain("browser-use");
	});

	test("does not flag a shadow that resolves to the same setup-owned target", async () => {
		const fixture = await shadowFixture();
		await writeTool(fixture.source, "browser-use");
		const ownedEntry = await realpath(join(fixture.source, "skills/browser-use/src/cli.ts"));

		// A directory earlier on PATH whose `browser-use` is a symlink to the SAME
		// setup-owned entry is not a shadow — it resolves to identical bytes.
		const aliasDir = join(fixture.root, "alias-bin");
		await mkdir(aliasDir, { recursive: true });
		await symlink(ownedEntry, join(aliasDir, "browser-use"));

		const plan = await inspectBinTopology(fixture.source, fixture.home, {
			binDir: fixture.binDir,
			pathEnv: [aliasDir, fixture.binDir].join(delimiter),
		});

		expect(plan.advisories.some((advisory) => advisory.id === "bin_shadowed")).toBe(false);
	});

	test("does not flag a same-named entry that sits LATER on PATH than binDir", async () => {
		const fixture = await shadowFixture();
		await writeTool(fixture.source, "browser-use");

		const laterDir = join(fixture.root, "later-bin");
		await mkdir(laterDir, { recursive: true });
		await writeFile(join(laterDir, "browser-use"), SHEBANG_ENTRY);
		await chmod(join(laterDir, "browser-use"), 0o755);

		const plan = await inspectBinTopology(fixture.source, fixture.home, {
			binDir: fixture.binDir,
			// binDir precedes laterDir: the owned bin wins, nothing shadows it.
			pathEnv: [fixture.binDir, laterDir].join(delimiter),
		});

		expect(plan.advisories.some((advisory) => advisory.id === "bin_shadowed")).toBe(false);
	});

	test("classifies bin_shadowed as an advisory, never a blocking finding", () => {
		expect(SETUP_ADVISORY_FINDING_IDS).toContain("bin_shadowed");
	});
});

// DDA-A22 (E tier): the same oracle the in-process `inspectBinTopology` cases
// prove — a shadow earlier on PATH is detected and NAMES BOTH the shadow path
// and the owned destination — now proven through the real `setup status`
// journey spawned as its own OS process. `setup status` already projects
// `bin_shadowed` into its findings (checkSetupDomains), and the real CLI reads
// the shadow from the child's own PATH (bin-topology's pathEnv defaults to
// process.env.PATH) and computes the owned destination as
// <HOME>/.bun/bin/browser-use. Spawning it with a sandboxed HOME and a shadow
// dir earlier on PATH proves the advisory survives the process boundary the
// in-process cases cannot reach.
//
// The real repo is the source root the CLI resolves (it declares `browser-use`
// as a path bin), so the journey exercises the real declaration set, not a
// fixture manifest.

const SETUP_CLI = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../src/cli.ts",
);
const SPAWN_TIMEOUT_MS = 20_000;
const SPAWN_TEST_TIMEOUT_MS = SPAWN_TIMEOUT_MS + 10_000;

const spawnRoots: string[] = [];
afterAll(async () => {
	for (const root of spawnRoots) await rm(root, { recursive: true, force: true });
});

// In-process shadowFixture roots are cleaned separately from spawnRoots so the
// two concerns stay distinct; without this every fixture leaks a
// setup-shadow-* tree in tmpdir().
const fixtureRoots: string[] = [];
afterAll(async () => {
	for (const root of fixtureRoots) await rm(root, { recursive: true, force: true });
});

async function spawnSetupStatus(input: {
	home: string;
	pathEnv: string;
	cwd: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = Bun.spawn(
		[process.execPath, SETUP_CLI, "status", "--scope", "user", "--json"],
		{
			cwd: input.cwd,
			// Only HOME + PATH: the child inherits nothing else. HOME fixes the
			// owned bin destination (<HOME>/.bun/bin). The fixture paths retain
			// precedence (shadow -> binDir) while the appended system PATH keeps
			// setup's git/bash dependencies (scope.ts, instruction-health.ts)
			// resolvable in a bare CI PATH.
			env: {
				HOME: input.home,
				PATH: input.pathEnv + delimiter + (process.env.PATH ?? ""),
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const timeout = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	clearTimeout(timeout);
	return { exitCode, stdout, stderr };
}

interface SetupFindingProjection {
	readonly id: string;
	readonly path?: string;
	readonly summary?: string;
	readonly why?: string;
}

describe("DDA-A22 (E) spawned setup status names the shadow across the process boundary", () => {
	test(
		"the real setup status journey emits bin_shadowed naming the shadow path and the owned destination",
		async () => {
			const root = await realpath(await mkdtemp(join(tmpdir(), "setup-shadow-e-")));
			spawnRoots.push(root);
			const home = join(root, "home");
			const binDir = join(home, ".bun/bin");
			await mkdir(binDir, { recursive: true });

			// A rival `browser-use` executable in a dir that precedes the setup-owned
			// bin dir on PATH — the daily-driver hazard (a stale global install
			// shadowing the setup-owned bin).
			const shadowDir = join(root, "shadow-bin");
			await mkdir(shadowDir, { recursive: true });
			const shadowPath = join(shadowDir, "browser-use");
			await writeFile(shadowPath, SHEBANG_ENTRY);
			await chmod(shadowPath, 0o755);

			const result = await spawnSetupStatus({
				home,
				// shadowDir precedes binDir: the shadow wins resolution.
				pathEnv: [shadowDir, binDir].join(delimiter),
				cwd: root,
			});

			// status is an ok, non-error read-only projection (advisories never block).
			expect(result.exitCode, result.stderr).toBe(0);
			const envelope = JSON.parse(result.stdout) as {
				status: string;
				data: { findings?: readonly SetupFindingProjection[] };
			};
			expect(envelope.status).toBe("ok");

			const findings = envelope.data.findings ?? [];
			const shadowed = findings.find((finding) => finding.id === "bin_shadowed");
			expect(shadowed, `no bin_shadowed finding in ${JSON.stringify(findings)}`).toBeDefined();
			if (!shadowed) return;

			const ownedDestination = join(binDir, "browser-use");
			// Names BOTH paths: the shadow (path, realpath'd) and the owned
			// destination it precedes (why).
			expect(shadowed.path).toBe(await realpath(shadowPath).catch(() => shadowPath));
			expect(shadowed.why).toContain(ownedDestination);
			expect(shadowed.summary).toContain("browser-use");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	test(
		"the real setup status journey omits bin_shadowed when the same-named entry sits LATER on PATH than the owned bin dir",
		async () => {
			const root = await realpath(await mkdtemp(join(tmpdir(), "setup-shadow-e-later-")));
			spawnRoots.push(root);
			const home = join(root, "home");
			const binDir = join(home, ".bun/bin");
			await mkdir(binDir, { recursive: true });

			const laterDir = join(root, "later-bin");
			await mkdir(laterDir, { recursive: true });
			await writeFile(join(laterDir, "browser-use"), SHEBANG_ENTRY);
			await chmod(join(laterDir, "browser-use"), 0o755);

			const result = await spawnSetupStatus({
				home,
				// binDir precedes laterDir: the owned bin wins, nothing shadows it.
				pathEnv: [binDir, laterDir].join(delimiter),
				cwd: root,
			});

			expect(result.exitCode, result.stderr).toBe(0);
			const envelope = JSON.parse(result.stdout) as {
				status: string;
				data: { findings?: readonly SetupFindingProjection[] };
			};
			expect(envelope.status).toBe("ok");
			expect(
				(envelope.data.findings ?? []).some((finding) => finding.id === "bin_shadowed"),
			).toBe(false);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);
});

async function shadowFixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "setup-shadow-")));
	fixtureRoots.push(root);
	const source = join(root, "source");
	const home = join(root, "home");
	const binDir = join(home, ".bun/bin");
	await mkdir(join(source, "runtime"), { recursive: true });
	await mkdir(join(source, "skills"), { recursive: true });
	await mkdir(binDir, { recursive: true });
	return { root, source, home, binDir };
}

async function writeTool(source: string, name: string) {
	const packageDir = join(source, "skills", name);
	await mkdir(packageDir, { recursive: true });
	await writeFile(
		join(packageDir, "package.json"),
		JSON.stringify({ name, setup: { pathBin: { [name]: "./src/cli.ts" } } }),
	);
	const entry = join(packageDir, "src/cli.ts");
	await mkdir(dirname(entry), { recursive: true });
	await writeFile(entry, SHEBANG_ENTRY);
}
