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
import type { SkillsLockEntry } from "../src/skills-lock.ts";

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

	test("configured projection roots leave catalog roots untouched", async () => {
		const root = await tempRepo("configured-roots");
		await writeSkill(join(root, ".agents/skills"), "fallow");
		const visibility = applyVisibility(
			await discoverCatalog(join(root, ".agents/skills")),
			[],
		);
		const plan = await planProjection({
			repoRoot: root,
			catalogRoot: join(root, ".agents/skills"),
			visibility,
			projectionRoots: [".claude/skills"],
		});

		expect(plan.status.health).toBe("needs_sync");
		expect(plan.status.changes.create_or_update).toEqual([
			".claude/skills/fallow",
		]);
		expect(plan.status.blockers).toEqual([]);

		await applyProjection(plan, "2026-06-16T00:00:00.000Z");

		expect(lstatSync(join(root, ".agents/skills/fallow")).isDirectory()).toBe(
			true,
		);
		expect(lstatSync(join(root, ".claude/skills/fallow")).isSymbolicLink()).toBe(
			true,
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
		expect(plan.status.station).toBe("unmanaged_blocker");
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

	test("dangling foreign symlink is an unmanaged blocker, not a broken projection", async () => {
		const root = await tempRepo("dangling-foreign");
		await writeSkill(join(root, "skills"), "fallow");
		await mkdir(join(root, ".agents/skills"), { recursive: true });
		await symlink("/nonexistent/outside/fallow", join(root, ".agents/skills/fallow"));

		const plan = await statusPlan(root);

		expect(plan.status.health).toBe("blocked");
		expect(plan.status.blockers).toMatchObject([
			{ id: "fallow", reason: "foreign_symlink" },
		]);
		const removed = await unlinkManagedProjections(root, join(root, "skills"), false);
		expect(removed).not.toContain(".agents/skills/fallow");
		expect(lstatSync(join(root, ".agents/skills/fallow")).isSymbolicLink()).toBe(
			true,
		);
	});

	test("status adds a soft noise hint when the visible set is large", async () => {
		const root = await tempRepo("noise");
		const visibility = Array.from({ length: 41 }, (_, index) => ({
			id: `skill-${String(index).padStart(2, "0")}`,
			path: join(root, "skills", `skill-${String(index).padStart(2, "0")}`),
			state: "visible" as const,
			reason: "valid catalog skill",
		}));

		const plan = await planProjection({
			repoRoot: root,
			catalogRoot: join(root, "skills"),
			visibility,
		});

		expect(plan.status.noise_hint).toContain("ignore suggest");
	});

	test("lockfile-managed real dir classifies external and stays untouched", async () => {
		const root = await tempRepo("external-real-dir");
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, ".agents/skills"), "frontend-design");
		const lock = {
			entries: [
				{ id: "frontend-design", source: "anthropics/skills", computedHash: "abc" },
			],
		};

		const plan = await statusPlan(root, lock);

		expect(plan.status.blockers).toEqual([]);
		expect(plan.status.external_count).toBe(1);
		expect(plan.status.externals).toMatchObject([
			{
				root: ".agents/skills",
				id: "frontend-design",
				shape: "real_entry",
				source: "anthropics/skills",
				has_hash: true,
			},
		]);
		await applyProjection(plan, "2026-07-02T00:00:00.000Z");
		expect(lstatSync(join(root, ".agents/skills/frontend-design")).isDirectory()).toBe(
			true,
		);
		const after = await statusPlan(root, lock);
		expect(after.status.health).toBe("clean");
		const removed = await unlinkManagedProjections(
			root,
			join(root, "skills"),
			false,
			[".agents/skills", ".claude/skills"],
			lock,
		);
		expect(removed).not.toContain(".agents/skills/frontend-design");
		expect(existsSync(join(root, ".agents/skills/frontend-design"))).toBe(true);
	});

	test("lockfile-managed canonical-copy symlink is external, not foreign", async () => {
		const root = await tempRepo("external-symlink");
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, ".agents/skills"), "frontend-design");
		await mkdir(join(root, ".claude/skills"), { recursive: true });
		await symlink(
			join(root, ".agents/skills/frontend-design"),
			join(root, ".claude/skills/frontend-design"),
		);
		const lock = { entries: [{ id: "frontend-design" }] };

		const plan = await statusPlan(root, lock);

		expect(plan.status.blockers).toEqual([]);
		expect(plan.status.external_count).toBe(2);
		expect(
			plan.status.externals.find((entry) => entry.root === ".claude/skills"),
		).toMatchObject({ id: "frontend-design", shape: "symlink" });
	});

	test("real dir without a lock entry stays a fail-closed blocker", async () => {
		const root = await tempRepo("external-miss");
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, ".agents/skills"), "squatter");
		const lock = { entries: [{ id: "frontend-design" }] };

		const plan = await statusPlan(root, lock);

		expect(plan.status.health).toBe("blocked");
		expect(plan.status.blockers).toMatchObject([
			{ id: "squatter", reason: "real_entry" },
		]);
		await expect(
			applyProjection(plan, "2026-07-02T00:00:00.000Z"),
		).rejects.toThrow("unmanaged_blocker");
		expect(existsSync(join(root, ".claude/skills/fallow"))).toBe(false);
	});

	test("catalog id colliding with a lock id fails closed as catalog_conflict", async () => {
		const root = await tempRepo("catalog-conflict");
		await writeSkill(join(root, "skills"), "fallow");
		const lock = { entries: [{ id: "fallow", source: "anthropics/skills" }] };

		const plan = await statusPlan(root, lock);

		expect(plan.status.health).toBe("blocked");
		expect(plan.status.blockers).toMatchObject([
			{ id: "fallow", reason: "catalog_conflict" },
		]);
		expect(plan.status.blockers[0]?.why).toContain("skills-lock.json");
		expect(plan.status.blockers[0]?.why).toContain("anthropics/skills");
		expect(plan.status.blockers[0]?.why).toContain("rename the catalog skill id");
		expect(plan.status.blockers[0]?.why).toContain("skills CLI");
		await expect(
			applyProjection(plan, "2026-07-02T00:00:00.000Z"),
		).rejects.toThrow("unmanaged_blocker");
		expect(existsSync(join(root, ".agents/skills/fallow"))).toBe(false);
		expect(existsSync(join(root, ".claude/skills/fallow"))).toBe(false);
	});

	test("lock id with no disk entry is informational, never a blocker", async () => {
		const root = await tempRepo("missing-external");
		await writeSkill(join(root, "skills"), "fallow");
		await applyProjection(await statusPlan(root), "2026-07-02T00:00:00.000Z");
		const lock = { entries: [{ id: "frontend-design" }] };

		const plan = await statusPlan(root, lock);

		expect(plan.status.health).toBe("clean");
		expect(plan.status.blockers).toEqual([]);
		expect(plan.status.missing_external_ids).toEqual(["frontend-design"]);
	});

	test("lock parse failure travels on status and entries fall back to blockers", async () => {
		const root = await tempRepo("lock-parse-failure");
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, ".agents/skills"), "frontend-design");
		const lock = {
			entries: [],
			parseFailure: "skills-lock.json could not be read (invalid JSON)",
		};

		const plan = await statusPlan(root, lock);

		expect(plan.status.lock_parse_failure).toContain("skills-lock.json");
		expect(plan.status.health).toBe("blocked");
		expect(plan.status.blockers).toMatchObject([
			{ id: "frontend-design", reason: "real_entry" },
		]);
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

async function statusPlan(
	root: string,
	lock?: { entries: readonly SkillsLockEntry[]; parseFailure?: string },
) {
	const catalogRoot = join(root, "skills");
	const visibility = applyVisibility(await discoverCatalog(catalogRoot), []);
	return planProjection({ repoRoot: root, catalogRoot, visibility, lock });
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
