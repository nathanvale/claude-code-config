import { chmod, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { applyHookTopology, inspectHookTopology } from "../src/hook-topology.ts";

describe("hook topology", () => {
	test("copies a missing hook and treats equal content as healthy", async () => {
		const fixture = await hookFixture();
		const plan = await inspectHookTopology(fixture.source, fixture.destination);
		expect(plan.operations).toHaveLength(1);
		expect((await applyHookTopology(plan)).applied).toEqual([join(fixture.destination, "pre-commit")]);
		expect(await readFile(join(fixture.destination, "pre-commit"), "utf8")).toBe("hook\n");
		expect((await inspectHookTopology(fixture.source, fixture.destination)).operations).toEqual([]);
	});

	test("preserves differing files and every symlink", async () => {
		const fixture = await hookFixture();
		await writeFile(join(fixture.destination, "pre-commit"), "foreign\n");
		expect((await inspectHookTopology(fixture.source, fixture.destination)).findings[0]?.id).toBe("hook_unhealthy");
		await import("node:fs/promises").then(({ rm }) => rm(join(fixture.destination, "pre-commit")));
		await symlink(join(fixture.source, "pre-commit"), join(fixture.destination, "pre-commit"));
		expect((await inspectHookTopology(fixture.source, fixture.destination)).findings[0]?.id).toBe("hook_unhealthy");
	});

	test("preserves a concurrent replacement", async () => {
		const fixture = await hookFixture();
		const plan = await inspectHookTopology(fixture.source, fixture.destination);
		const result = await applyHookTopology(plan, { beforeCopy: async (path) => writeFile(path, "arrived\n") });
		expect(result.failed).toEqual([join(fixture.destination, "pre-commit")]);
		expect(await readFile(join(fixture.destination, "pre-commit"), "utf8")).toBe("arrived\n");
	});

	test("revalidates equal bytes immediately before executable repair", async () => {
		const fixture = await hookFixture();
		await writeFile(join(fixture.destination, "pre-commit"), "hook\n", { mode: 0o644 });
		await chmod(join(fixture.destination, "pre-commit"), 0o644);
		const plan = await inspectHookTopology(fixture.source, fixture.destination);
		const result = await applyHookTopology(plan, {
			beforeCopy: async (path) => writeFile(path, "foreign replacement\n"),
		});
		expect(result.failed).toEqual([join(fixture.destination, "pre-commit")]);
		expect(await readFile(join(fixture.destination, "pre-commit"), "utf8")).toBe("foreign replacement\n");
	});
});

async function hookFixture() {
	const root = await mkdtemp(join(tmpdir(), "setup-hook-"));
	const source = join(root, "source");
	const destination = join(root, "hooks");
	await mkdir(source);
	await mkdir(destination);
	await writeFile(join(source, "pre-commit"), "hook\n");
	await chmod(join(source, "pre-commit"), 0o755);
	return { source, destination };
}
