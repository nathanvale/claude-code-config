import {
	existsSync,
	lstatSync,
	readlinkSync,
	realpathSync,
} from "node:fs";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { applyVisibility, discoverCatalog } from "../src/catalog.ts";
import {
	applyProjection,
	planProjection,
	unlinkManagedProjections,
} from "../src/projection.ts";

describe("agent-skills projection", () => {
	test("sync creates links in both projection roots and writes snapshot", async () => {
		const root = await tempRepo("sync");
		await writeSkill(join(root, "skills"), "fallow");
		const plan = await statusPlan(root);

		await applyProjection(plan, "2026-06-16T00:00:00.000Z");

		for (const rootName of [".agents/skills", ".claude/skills"]) {
			const link = join(root, rootName, "fallow");
			expect(lstatSync(link).isSymbolicLink()).toBe(true);
			expect(realpathSync(link)).toBe(realpathSync(join(root, "skills", "fallow")));
		}
		const snapshot = JSON.parse(
			await readFile(join(root, ".agents/agent-skills-snapshot.json"), "utf8"),
		);
		expect(snapshot.projected_ids).toEqual(["fallow"]);
	});

	test("sync --check reports changes and writes nothing", async () => {
		const root = await tempRepo("check");
		await writeSkill(join(root, "skills"), "fallow");
		const plan = await statusPlan(root);

		expect(plan.status.health).toBe("needs_sync");
		expect(plan.status.changes.create_or_update).toEqual([
			".agents/skills/fallow",
			".claude/skills/fallow",
		]);
		expect(existsSync(join(root, ".agents/skills/fallow"))).toBe(false);
		expect(existsSync(join(root, ".agents/agent-skills-snapshot.json"))).toBe(
			false,
		);
	});

	test("current projections are clean", async () => {
		const root = await tempRepo("clean");
		await writeSkill(join(root, "skills"), "fallow");
		await applyProjection(await statusPlan(root), "2026-06-16T00:00:00.000Z");

		const plan = await statusPlan(root);

		expect(plan.status.health).toBe("clean");
		expect(plan.status.next_action).toBe("none");
	});

	test("broken projection reports sync as repair", async () => {
		const root = await tempRepo("broken");
		await writeSkill(join(root, "skills"), "fallow");
		await mkdir(join(root, ".agents/skills"), { recursive: true });
		await symlink(join(root, "skills", "missing"), join(root, ".agents/skills/fallow"));

		const plan = await statusPlan(root);

		expect(plan.status.health).toBe("broken");
		expect(plan.status.changes.broken).toEqual([".agents/skills/fallow"]);
		expect(plan.status.next_action).toBe("sync");
	});

	test("foreign symlink blocks writes and leaves safe missing link untouched", async () => {
		const root = await tempRepo("foreign");
		const outside = await mkdtemp(join(tmpdir(), "agent-skills-outside-"));
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, "skills"), "summarize");
		await mkdir(join(root, ".agents/skills"), { recursive: true });
		await symlink(outside, join(root, ".agents/skills/fallow"));
		const plan = await statusPlan(root);

		expect(plan.status.health).toBe("blocked");
		await expect(
			applyProjection(plan, "2026-06-16T00:00:00.000Z"),
		).rejects.toThrow("unmanaged_blocker");
		expect(existsSync(join(root, ".claude/skills/summarize"))).toBe(false);
		expect(existsSync(join(root, ".agents/agent-skills-snapshot.json"))).toBe(
			false,
		);
	});

	test("real directory in projection root blocks writes", async () => {
		const root = await tempRepo("real-dir");
		await writeSkill(join(root, "skills"), "fallow");
		await mkdir(join(root, ".agents/skills/fallow"), { recursive: true });

		const plan = await statusPlan(root);

		expect(plan.status.blockers).toMatchObject([
			{ id: "fallow", reason: "real_entry" },
		]);
	});

	test("snapshot powers newly visible and removed summaries", async () => {
		const root = await tempRepo("snapshot");
		await writeSkill(join(root, "skills"), "fallow");
		await applyProjection(await statusPlan(root), "2026-06-16T00:00:00.000Z");
		await writeSkill(join(root, "skills"), "summarize");

		const plan = await statusPlan(root);

		expect(plan.status.newly_visible).toEqual(["summarize"]);
		expect(plan.status.removed_since_snapshot).toEqual([]);
	});

	test("unlink removes only managed links", async () => {
		const root = await tempRepo("unlink");
		const outside = await mkdtemp(join(tmpdir(), "agent-skills-foreign-"));
		await writeSkill(join(root, "skills"), "fallow");
		await applyProjection(await statusPlan(root), "2026-06-16T00:00:00.000Z");
		await symlink(outside, join(root, ".agents/skills/foreign"));

		const removed = await unlinkManagedProjections(root, join(root, "skills"), false);

		expect(removed).toContain(".agents/skills/fallow");
		expect(existsSync(join(root, ".agents/skills/fallow"))).toBe(false);
		expect(readlinkSync(join(root, ".agents/skills/foreign"))).toBe(outside);
	});
});

async function statusPlan(root: string) {
	const catalogRoot = join(root, "skills");
	const visibility = applyVisibility(await discoverCatalog(catalogRoot), []);
	return planProjection({ repoRoot: root, catalogRoot, visibility });
}

async function tempRepo(name: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `agent-skills-projection-${name}-`));
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
