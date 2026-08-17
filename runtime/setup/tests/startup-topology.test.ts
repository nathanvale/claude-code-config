import { lstat, mkdtemp, mkdir, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { applyStartupTopology, inspectStartupTopology, STARTUP_LINKS } from "../src/startup-topology.ts";

describe("startup topology", () => {
	test("owns ten non-instruction startup links", () => {
		expect(STARTUP_LINKS.map((entry) => entry.destination)).toEqual([
			".claude/context", ".claude/rules",
			".claude/commands", ".claude/agents", ".claude/runbooks", ".claude/hooks",
			".claude/hooks.json", ".claude/settings.json", ".claude/.mcp.json",
			".config/context",
		]);
	});

	test("plans and creates missing links while deferring a missing source", async () => {
		const fixture = await startupFixture();
		const first = await inspectStartupTopology(fixture.source, fixture.home);
		expect(first.operations).toHaveLength(10);
		expect(first.operations.every((operation) => operation.action === "create")).toBe(true);
		const result = await applyStartupTopology(first);
		expect(result.applied).toHaveLength(10);
		expect(await readlink(join(fixture.home, ".config/context"))).toBe(await realpath(join(fixture.source, "context")));

		await import("node:fs/promises").then(({ rmdir }) => rmdir(join(fixture.source, "context")));
		const missing = await inspectStartupTopology(fixture.source, fixture.home);
		expect(missing.findings).toContainEqual(expect.objectContaining({ id: "source_missing", path: join(fixture.source, "context") }));
	});

	test("preserves a foreign link and real-file conflict", async () => {
		const fixture = await startupFixture();
		await mkdir(join(fixture.home, ".claude"), { recursive: true });
		await symlink("/tmp/foreign", join(fixture.home, ".claude/context"));
		await writeFile(join(fixture.home, ".claude/rules"), "foreign\n");
		const plan = await inspectStartupTopology(fixture.source, fixture.home);
		expect(plan.findings.filter((finding) => finding.id === "foreign_symlink")).toHaveLength(1);
		expect(plan.findings.filter((finding) => finding.id === "real_entry")).toHaveLength(1);
	});

	test("blocks every startup write when an existing parent escapes home", async () => {
		const fixture = await startupFixture();
		const outside = join(fixture.source, "outside");
		await mkdir(outside);
		await symlink(outside, join(fixture.home, ".claude"));
		const plan = await inspectStartupTopology(fixture.source, fixture.home);
		expect(plan.findings).toContainEqual(expect.objectContaining({ id: "unsafe_root", path: join(fixture.home, ".claude") }));
		expect(plan.operations).toEqual([]);
		expect((await applyStartupTopology(plan)).applied).toEqual([]);
		expect(await lstat(join(outside, "CLAUDE.md")).then(() => true, () => false)).toBe(false);
	});

	test("preserves a startup source symlink that escapes the selected repository", async () => {
		const fixture = await startupFixture();
		const outside = join(fixture.root, "outside-context");
		await mkdir(outside);
		await import("node:fs/promises").then(({ rmdir }) => rmdir(join(fixture.source, "context")));
		await symlink(outside, join(fixture.source, "context"));

		const plan = await inspectStartupTopology(fixture.source, fixture.home);

		expect(plan.findings).toContainEqual(expect.objectContaining({
			id: "unsafe_root",
			path: join(fixture.source, "context"),
		}));
		expect(plan.operations.map((operation) => operation.destination)).not.toContain(join(fixture.home, ".claude/context"));
		expect(plan.preserved).toContain(join(fixture.home, ".claude/context"));
		expect((await applyStartupTopology(plan)).applied).not.toContain(join(fixture.home, ".claude/context"));
	});

	test("revalidates startup source containment immediately before linking", async () => {
		const fixture = await startupFixture();
		const outside = join(fixture.root, "outside-agents");
		await mkdir(outside);
		const plan = await inspectStartupTopology(fixture.source, fixture.home);
		const destination = join(fixture.home, ".claude/agents");

		const result = await applyStartupTopology(plan, {
			beforeSymlink: async (candidate) => {
				if (candidate !== destination) return;
				await import("node:fs/promises").then(({ rmdir }) => rmdir(join(fixture.source, "agents")));
				await symlink(outside, join(fixture.source, "agents"));
			},
		});

		expect(result.failed).toEqual([destination]);
		expect(await lstat(destination).then(() => true, () => false)).toBe(false);
	});

	test("links the exact canonical startup source returned by validation", async () => {
		const fixture = await startupFixture();
		const logicalSource = join(fixture.source, "agents");
		const canonicalSource = join(fixture.source, "canonical-agents");
		await import("node:fs/promises").then(({ rmdir }) => rmdir(logicalSource));
		await mkdir(canonicalSource);
		await symlink(canonicalSource, logicalSource);
		const plan = await inspectStartupTopology(fixture.source, fixture.home);
		const destination = join(fixture.home, ".claude/agents");

		const result = await applyStartupTopology(plan);

		expect(result.failed).toEqual([]);
		expect(await readlink(destination)).toBe(await realpath(canonicalSource));
	});
});

async function startupFixture() {
	const root = await mkdtemp(join(tmpdir(), "setup-startup-"));
	const source = join(root, "source");
	const home = join(root, "home");
	await mkdir(source);
	await mkdir(home);
	for (const entry of STARTUP_LINKS) {
		const path = join(source, entry.source);
		if (entry.source.includes(".")) await writeFile(path, "fixture\n");
		else await mkdir(path, { recursive: true });
	}
	return { root, source, home };
}
