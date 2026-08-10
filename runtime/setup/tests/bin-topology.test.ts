import { chmod, lstat, mkdir, mkdtemp, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import {
	applyBinTopology,
	inspectBinTopology,
	inspectRemovableBins,
	readBinManifest,
} from "../src/bin-topology.ts";
import { diagnoseFindings } from "../src/doctor.ts";

const SHEBANG_ENTRY = "#!/usr/bin/env bun\nconsole.log(\"bin fixture\");\n";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("bin manifest", () => {
	test("discovers and projects vault-git through the managed bin destination", async () => {
		const fixture = await binFixture();
		const manifest = await readBinManifest(REPO_ROOT);
		const declaration = manifest.declarations.find(({ name }) => name === "vault-git");
		expect(declaration).toBeDefined();
		if (!declaration) throw new Error("vault-git bin declaration is missing");
		expect(declaration.packageDir.endsWith("runtime/vault-git-transaction-manager")).toBe(true);
		expect((await lstat(declaration.entry)).mode & 0o111).not.toBe(0);

		const plan = await inspectBinTopology(REPO_ROOT, fixture.home, fixture.options);
		const operation = plan.operations.find(({ name }) => name === "vault-git");
		expect(operation).toMatchObject({
			destination: join(fixture.binDir, "vault-git"),
			action: "create",
		});
		expect(operation?.destination.startsWith(REPO_ROOT)).toBe(false);

		const result = await applyBinTopology(plan);
		expect(result.failed).toEqual([]);
		expect(await readlink(join(fixture.binDir, "vault-git"))).toBe(declaration.entry);
	});

	test("pathBin override beats #bin for the same package", async () => {
		const fixture = await binFixture();
		await writePackage(fixture.source, "skills/tool", {
			name: "tool",
			bin: { tool: "./dist/tool.js" },
			setup: { pathBin: { tool: "./src/tool.ts" } },
		}, { "src/tool.ts": SHEBANG_ENTRY });

		const manifest = await readBinManifest(fixture.source);

		expect(manifest.findings).toEqual([]);
		expect(manifest.declarations).toEqual([{
			name: "tool",
			packageDir: await realpath(join(fixture.source, "skills/tool")),
			entry: await realpath(join(fixture.source, "skills/tool/src/tool.ts")),
		}]);
	});

	test("#bin fallback yields declared runtime bins verbatim", async () => {
		const fixture = await binFixture();
		for (const name of ["alpha", "beta", "gamma"]) {
			await writePackage(fixture.source, `runtime/${name}`, {
				name,
				bin: { [name]: "./src/cli.ts" },
			}, { "src/cli.ts": SHEBANG_ENTRY });
		}

		const manifest = await readBinManifest(fixture.source);

		expect(manifest.findings).toEqual([]);
		expect(manifest.declarations.map((declaration) => declaration.name)).toEqual(["alpha", "beta", "gamma"]);
		expect(manifest.declarations.map((declaration) => declaration.entry)).toEqual(await Promise.all(
			["alpha", "beta", "gamma"].map((name) => realpath(join(fixture.source, `runtime/${name}/src/cli.ts`))),
		));
	});

	test("rejects unsafe bin names as findings, never declarations", async () => {
		const fixture = await binFixture();
		await writePackage(fixture.source, "runtime/tool", {
			name: "tool",
			setup: { pathBin: { "../x": "./src/cli.ts", "a/b": "./src/cli.ts" } },
		}, { "src/cli.ts": SHEBANG_ENTRY });

		const manifest = await readBinManifest(fixture.source);

		expect(manifest.declarations).toEqual([]);
		expect(manifest.findings.filter((finding) => finding.id === "bin_declaration_invalid")).toHaveLength(2);
	});

	test("an explicit empty pathBin suppresses the package #bin fallback", async () => {
		const fixture = await binFixture();
		await writePackage(fixture.source, "skills/tool", {
			name: "tool",
			bin: { tool: "./src/tool.ts" },
			setup: { pathBin: {} },
		}, { "src/tool.ts": SHEBANG_ENTRY });

		const manifest = await readBinManifest(fixture.source);

		expect(manifest.findings).toEqual([]);
		expect(manifest.declarations).toEqual([]);
	});

	test("reports an unreadable entry as target-unhealthy, not a crash", async () => {
		const fixture = await binFixture();
		await writePackage(fixture.source, "runtime/tool", {
			name: "tool",
			bin: { tool: "./src/cli.ts" },
		}, { "src/cli.ts": SHEBANG_ENTRY });
		await chmod(join(fixture.source, "runtime/tool/src/cli.ts"), 0o000);

		const manifest = await readBinManifest(fixture.source);
		await chmod(join(fixture.source, "runtime/tool/src/cli.ts"), 0o644);

		expect(manifest.declarations).toEqual([]);
		expect(manifest.findings).toContainEqual(expect.objectContaining({ id: "bin_target_unhealthy" }));
	});

	test("reports a missing entry as target-unhealthy, not a declaration", async () => {
		const fixture = await binFixture();
		await writePackage(fixture.source, "runtime/tool", {
			name: "tool",
			bin: { tool: "./dist/cli.js" },
		});

		const manifest = await readBinManifest(fixture.source);

		expect(manifest.declarations).toEqual([]);
		expect(manifest.findings).toContainEqual(expect.objectContaining({
			id: "bin_target_unhealthy",
			path: join(fixture.source, "runtime/tool/dist/cli.js"),
		}));
	});

	test("reports a shebangless entry as target-unhealthy", async () => {
		const fixture = await binFixture();
		await writePackage(fixture.source, "runtime/tool", {
			name: "tool",
			bin: { tool: "./src/cli.ts" },
		}, { "src/cli.ts": "console.log(\"no shebang\");\n" });

		const manifest = await readBinManifest(fixture.source);

		expect(manifest.declarations).toEqual([]);
		expect(manifest.findings).toContainEqual(expect.objectContaining({ id: "bin_target_unhealthy" }));
	});

	test("reports a non-executable entry as target-unhealthy", async () => {
		const fixture = await binFixture();
		const entry = join(fixture.source, "runtime/tool/src/cli.ts");
		await writePackage(fixture.source, "runtime/tool", {
			name: "tool",
			bin: { tool: "./src/cli.ts" },
		}, { "src/cli.ts": SHEBANG_ENTRY });
		await chmod(entry, 0o644);

		const manifest = await readBinManifest(fixture.source);

		expect(manifest.declarations).toEqual([]);
		expect(manifest.findings).toContainEqual(expect.objectContaining({
			id: "bin_target_unhealthy",
			path: await realpath(entry),
		}));
	});

	test("rejects an entry that escapes its package through a symlink", async () => {
		const fixture = await binFixture();
		const outside = join(fixture.source, "outside-entry.ts");
		await writeFile(outside, SHEBANG_ENTRY);
		await writePackage(fixture.source, "runtime/tool", {
			name: "tool",
			bin: { tool: "./src/cli.ts" },
		});
		await mkdir(join(fixture.source, "runtime/tool/src"), { recursive: true });
		await symlink(outside, join(fixture.source, "runtime/tool/src/cli.ts"));

		const manifest = await readBinManifest(fixture.source);

		expect(manifest.declarations).toEqual([]);
		expect(manifest.findings).toContainEqual(expect.objectContaining({ id: "bin_declaration_invalid" }));
	});

	test("drops colliding bin names from every declaring package", async () => {
		const fixture = await binFixture();
		for (const dir of ["runtime/one", "runtime/two"]) {
			await writePackage(fixture.source, dir, {
				name: dir,
				bin: { tool: "./src/cli.ts" },
			}, { "src/cli.ts": SHEBANG_ENTRY });
		}

		const manifest = await readBinManifest(fixture.source);

		expect(manifest.declarations).toEqual([]);
		expect(manifest.findings.filter((finding) => finding.id === "bin_declaration_invalid")).toHaveLength(2);
	});
});

describe("bin topology", () => {
	test("plans a missing bin, applies it, and re-applies as a noop", async () => {
		const fixture = await binFixture();
		await writeTool(fixture);

		const plan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);
		expect(plan.findings).toEqual([]);
		expect(plan.advisories).toEqual([]);
		expect(plan.operations).toEqual([expect.objectContaining({
			name: "tool",
			destination: join(fixture.binDir, "tool"),
			action: "create",
		})]);

		const result = await applyBinTopology(plan);
		expect(result.applied).toEqual([join(fixture.binDir, "tool")]);
		expect(await readlink(join(fixture.binDir, "tool"))).toBe(await realpath(join(fixture.source, "runtime/tool/src/cli.ts")));

		const replan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);
		expect(replan.operations).toEqual([]);
		expect((await applyBinTopology(replan)).applied).toEqual([]);
	});

	test("repairs an owned link pointing at the wrong repo target", async () => {
		const fixture = await binFixture();
		await writeTool(fixture);
		const other = join(fixture.source, "other-entry.ts");
		await writeFile(other, SHEBANG_ENTRY);
		await symlink(other, join(fixture.binDir, "tool"));

		const plan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);
		expect(plan.operations).toEqual([expect.objectContaining({ name: "tool", action: "repair" })]);

		const result = await applyBinTopology(plan);
		expect(result.applied).toEqual([join(fixture.binDir, "tool")]);
		expect(await readlink(join(fixture.binDir, "tool"))).toBe(await realpath(join(fixture.source, "runtime/tool/src/cli.ts")));
	});

	test("fails closed on a regular file occupying a declared name", async () => {
		const fixture = await binFixture();
		await writeTool(fixture);
		await writeFile(join(fixture.binDir, "tool"), "foreign binary\n");

		const plan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);
		expect(plan.operations).toEqual([]);
		expect(plan.findings).toContainEqual(expect.objectContaining({ id: "real_entry", path: join(fixture.binDir, "tool") }));
		expect(plan.preserved).toEqual([join(fixture.binDir, "tool")]);

		await applyBinTopology(plan);
		expect(await Bun.file(join(fixture.binDir, "tool")).text()).toBe("foreign binary\n");
	});

	test("fails closed on a foreign symlink occupying a declared name", async () => {
		const fixture = await binFixture();
		await writeTool(fixture);
		const outside = join(fixture.root, "outside-tool");
		await writeFile(outside, "foreign\n");
		await symlink(outside, join(fixture.binDir, "tool"));

		const plan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);
		expect(plan.operations).toEqual([]);
		expect(plan.findings).toContainEqual(expect.objectContaining({ id: "foreign_symlink", path: join(fixture.binDir, "tool") }));
		await applyBinTopology(plan);
		expect(await readlink(join(fixture.binDir, "tool"))).toBe(outside);
	});

	test("classifies undeclared setup-owned links as removable orphans", async () => {
		const fixture = await binFixture();
		await writeTool(fixture);
		const orphanTarget = join(fixture.source, "runtime/tool/src/cli.ts");
		await symlink(await realpath(orphanTarget), join(fixture.binDir, "legacy"));
		const danglingTarget = join(fixture.source, "runtime/tool/src/deleted.ts");
		await symlink(danglingTarget, join(fixture.binDir, "dangling"));
		const foreign = join(fixture.root, "outside-owned");
		await writeFile(foreign, "foreign\n");
		await symlink(foreign, join(fixture.binDir, "not-ours"));

		const plan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);
		expect(plan.advisories.filter((advisory) => advisory.id === "bin_orphan").map((advisory) => advisory.path).sort())
			.toEqual([join(fixture.binDir, "dangling"), join(fixture.binDir, "legacy")]);
		expect(plan.findings).toEqual([]);

		const removable = await inspectRemovableBins(fixture.source, fixture.home, fixture.options);
		expect([...removable.removable].sort()).toEqual([
			join(fixture.binDir, "dangling"),
			join(fixture.binDir, "legacy"),
		]);
		expect(removable.removable).not.toContain(join(fixture.binDir, "not-ours"));
	});

	test("defers a create whose destination was swapped between plan and apply", async () => {
		const fixture = await binFixture();
		await writeTool(fixture);
		const destination = join(fixture.binDir, "tool");
		const plan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);

		const result = await applyBinTopology(plan, {
			beforeMutation: async (phase, candidate) => {
				if (phase !== "symlink" || candidate !== destination) return;
				await writeFile(destination, "concurrent occupant\n");
			},
		});

		expect(result.applied).toEqual([]);
		expect(result.deferred).toEqual([destination]);
		expect(result.failed).toEqual([]);
		expect(await Bun.file(destination).text()).toBe("concurrent occupant\n");
	});

	test("defers a repair whose link was replaced before removal", async () => {
		const fixture = await binFixture();
		await writeTool(fixture);
		const destination = join(fixture.binDir, "tool");
		const other = join(fixture.source, "other-entry.ts");
		await writeFile(other, SHEBANG_ENTRY);
		await symlink(other, destination);
		const plan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);
		expect(plan.operations).toEqual([expect.objectContaining({ action: "repair" })]);

		const foreign = join(fixture.root, "outside-swap");
		await writeFile(foreign, "foreign\n");
		const result = await applyBinTopology(plan, {
			beforeMutation: async (phase, candidate) => {
				if (phase !== "remove" || candidate !== destination) return;
				await import("node:fs/promises").then(({ rm }) => rm(destination));
				await symlink(foreign, destination);
			},
		});

		expect(result.applied).toEqual([]);
		expect(result.deferred).toEqual([destination]);
		expect(await readlink(destination)).toBe(foreign);
	});

	test("fails closed when the bin directory parent escapes home", async () => {
		const fixture = await binFixture({ withBinDir: false });
		await writeTool(fixture);
		const outside = join(fixture.root, "outside-bun");
		await mkdir(join(outside, "bin"), { recursive: true });
		await symlink(outside, join(fixture.home, ".bun"));

		const plan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);

		expect(plan.findings).toContainEqual(expect.objectContaining({ id: "unsafe_root" }));
		expect(plan.operations).toEqual([]);
		expect((await applyBinTopology(plan)).applied).toEqual([]);
		expect(await lstat(join(outside, "bin/tool")).then(() => true, () => false)).toBe(false);

		const removable = await inspectRemovableBins(fixture.source, fixture.home, fixture.options);
		expect(removable.removable).toEqual([]);
		expect(removable.findings).toContainEqual(expect.objectContaining({ id: "unsafe_root" }));
	});

	test("creates a missing safe bin directory while installing declared bins", async () => {
		const fixture = await binFixture({ withBinDir: false });
		await writeTool(fixture);

		const plan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);

		expect(plan.findings).toEqual([]);
		expect(plan.advisories).toEqual([]);
		expect(plan.operations).toEqual([expect.objectContaining({
			name: "tool",
			destination: join(fixture.binDir, "tool"),
			action: "create",
		})]);

		const result = await applyBinTopology(plan);
		expect(result).toMatchObject({
			applied: [join(fixture.binDir, "tool")],
			deferred: [],
			failed: [],
		});
		expect(await readlink(join(fixture.binDir, "tool"))).toBe(await realpath(join(fixture.source, "runtime/tool/src/cli.ts")));
	});

	test("defers every bin when the missing parent escapes home after planning", async () => {
		const fixture = await binFixture({ withBinDir: false });
		await writeTool(fixture);
		const plan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);
		const outside = join(fixture.root, "outside-bun");
		await mkdir(join(outside, "bin"), { recursive: true });
		await symlink(outside, join(fixture.home, ".bun"));

		const result = await applyBinTopology(plan);

		expect(result.applied).toEqual([]);
		expect(result.deferred).toEqual([join(fixture.binDir, "tool")]);
		expect(await lstat(join(outside, "bin/tool")).then(() => true, () => false)).toBe(false);
	});

	test("reports every bin failed when a foreign file blocks directory creation after planning", async () => {
		const fixture = await binFixture({ withBinDir: false });
		await writeTool(fixture);
		const plan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);
		await writeFile(join(fixture.home, ".bun"), "foreign\n");

		const result = await applyBinTopology(plan);

		expect(result.applied).toEqual([]);
		expect(result.failed).toEqual([join(fixture.binDir, "tool")]);
		expect(await Bun.file(join(fixture.home, ".bun")).text()).toBe("foreign\n");
	});

	test("stays quiet when nothing declares a bin and no bin dir exists", async () => {
		const fixture = await binFixture({ withBinDir: false });

		const plan = await inspectBinTopology(fixture.source, fixture.home, fixture.options);

		expect(plan.operations).toEqual([]);
		expect(plan.findings).toEqual([]);
		expect(plan.advisories).toEqual([]);
	});

	test("advises when the bin directory is not on PATH", async () => {
		const fixture = await binFixture();
		await writeTool(fixture);

		const offPath = await inspectBinTopology(fixture.source, fixture.home, {
			...fixture.options,
			pathEnv: "/usr/bin:/bin",
		});
		expect(offPath.advisories).toContainEqual(expect.objectContaining({ id: "bin_dir_not_on_path", path: fixture.binDir }));

		const onPath = await inspectBinTopology(fixture.source, fixture.home, fixture.options);
		expect(onPath.advisories).toEqual([]);
	});

	test("keeps doctor healthy when only PATH advisories are present", async () => {
		const fixture = await binFixture();
		await writeTool(fixture);
		const emptyPathDir = join(fixture.root, "empty-path");
		await mkdir(emptyPathDir);

		const plan = await inspectBinTopology(fixture.source, fixture.home, {
			...fixture.options,
			pathEnv: emptyPathDir,
		});
		expect(plan.advisories).not.toHaveLength(0);

		const diagnosis = diagnoseFindings(plan.advisories);
		expect(diagnosis).toMatchObject({ station: "doctor.healthy", next_action: "setup_healthy" });
	});
});

async function binFixture(options: { withBinDir?: boolean } = {}) {
	const root = await mkdtemp(join(tmpdir(), "setup-bins-"));
	const source = join(root, "source");
	const home = join(root, "home");
	const binDir = join(home, ".bun/bin");
	await mkdir(join(source, "runtime"), { recursive: true });
	await mkdir(join(source, "skills"), { recursive: true });
	await mkdir(home, { recursive: true });
	if (options.withBinDir !== false) await mkdir(binDir, { recursive: true });
	return { root, source, home, binDir, options: { pathEnv: binDir } };
}

async function writePackage(
	source: string,
	dir: string,
	pkg: Record<string, unknown>,
	entries: Record<string, string> = {},
) {
	const packageDir = join(source, dir);
	await mkdir(packageDir, { recursive: true });
	await writeFile(join(packageDir, "package.json"), JSON.stringify(pkg));
	for (const [relative, content] of Object.entries(entries)) {
		await mkdir(join(packageDir, dirname(relative)), { recursive: true });
		const entry = join(packageDir, relative);
		await writeFile(entry, content);
		if (content.startsWith("#!")) await chmod(entry, 0o755);
	}
}

async function writeTool(fixture: { source: string }) {
	await writePackage(fixture.source, "runtime/tool", {
		name: "tool",
		bin: { tool: "./src/cli.ts" },
	}, { "src/cli.ts": SHEBANG_ENTRY });
}
