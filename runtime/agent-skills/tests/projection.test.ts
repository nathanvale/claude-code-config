import {
	existsSync,
	lstatSync,
	readlinkSync,
	realpathSync,
} from "node:fs";
import {
	chmod,
	mkdtemp,
	mkdir,
	readFile,
	symlink,
	writeFile,
} from "node:fs/promises";
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
		expect(plan.status.blockers[0]?.why).toContain("skills-lock.json");
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

describe("agent-skills projection hardening (adversarial audit)", () => {
	// Finding #1/#10: a case- or NFC/NFD-variant lock id must not diverge from
	// the catalog id. On case-insensitive volumes the planted dir and the catalog
	// link are one path; the conflict check must fire regardless of id case.
	test("case-variant lock id still trips catalog_conflict (no shielding)", async () => {
		const root = await tempRepo("case-variant-conflict");
		await writeSkill(join(root, "skills"), "fallow");
		const lock = { entries: [{ id: "Fallow", source: "attacker/payload" }] };

		const plan = await statusPlan(root, lock);

		expect(plan.status.health).toBe("blocked");
		expect(plan.status.blockers).toMatchObject([
			{ id: "fallow", reason: "catalog_conflict" },
		]);
		await expect(
			applyProjection(plan, "2026-07-03T00:00:00.000Z"),
		).rejects.toThrow("unmanaged_blocker");
	});

	// Finding #6: an explicitly ignored catalog id sharing a lock id must yield
	// to the external, not wedge sync.
	test("ignored catalog id sharing a lock id does not wedge sync", async () => {
		const root = await tempRepo("ignored-conflict");
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, "skills"), "keep");
		const catalogRoot = join(root, "skills");
		const visibility = applyVisibility(
			await discoverCatalog(catalogRoot),
			["fallow"],
		);
		const plan = await planProjection({
			repoRoot: root,
			catalogRoot,
			visibility,
			lock: { entries: [{ id: "fallow", source: "anthropics/skills" }] },
		});

		expect(plan.status.blockers).toEqual([]);
		expect(plan.status.health).toBe("needs_sync");
		expect(plan.status.changes.create_or_update).toContain(".agents/skills/keep");
	});

	// Finding #7: an invalid catalog dir (no SKILL.md) sharing a lock id must not
	// trip catalog_conflict.
	test("invalid catalog dir sharing a lock id does not trip catalog_conflict", async () => {
		const root = await tempRepo("invalid-conflict");
		await writeSkill(join(root, "skills"), "valid");
		await mkdir(join(root, "skills", "fallow"), { recursive: true });
		const plan = await statusPlan(root, {
			entries: [{ id: "fallow", source: "anthropics/skills" }],
		});

		expect(
			plan.status.blockers.filter((b) => b.reason === "catalog_conflict"),
		).toEqual([]);
	});

	// Finding #4/#5: a lock entry whose source is the repo's own catalog (the
	// experience-sdk install topology) is a benign self-install, not a conflict.
	test("benign self-install of catalog skills does not wedge sync", async () => {
		const root = await tempRepo("self-install");
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, "skills"), "summarize");
		const plan = await statusPlan(root, {
			entries: [
				{ id: "fallow", source: "skills/fallow", sourceType: "local" },
				{ id: "summarize", source: "skills/summarize", sourceType: "local" },
			],
		});

		expect(
			plan.status.blockers.filter((b) => b.reason === "catalog_conflict"),
		).toEqual([]);
		expect(plan.status.health).not.toBe("blocked");
	});

	// Finding #3: a catalog skill whose dir resolves outside the catalog must be
	// blocked on the catalog side, never projected as an escaping link.
	test("catalog entry resolving outside the catalog is blocked, not projected", async () => {
		const root = await tempRepo("escaping-catalog");
		const outside = await mkdtemp(join(tmpdir(), "agent-skills-escape-"));
		await writeSkill(outside, "evil");
		await symlink(join(outside, "evil"), join(root, "skills", "evil"));

		const plan = await statusPlan(root);

		expect(plan.status.health).toBe("blocked");
		expect(plan.status.blockers).toMatchObject([
			{ id: "evil", reason: "foreign_symlink" },
		]);
		expect(plan.status.changes.create_or_update).not.toContain(
			".agents/skills/evil",
		);
	});

	// Finding #8/#9: a tool-owned symlink pointing into the catalog stays
	// managed/broken (removable) even when a lock entry later claims the id, so
	// unlink retains its escape hatch instead of the link becoming untouchable.
	test("tool-owned catalog symlink stays managed despite a later lock entry", async () => {
		const root = await tempRepo("stale-external-link");
		await writeSkill(join(root, "skills"), "fallow");
		await applyProjection(await statusPlan(root), "2026-07-03T00:00:00.000Z");
		// A lock entry for the already-projected id appears (git merge, teammate).
		const lock = { entries: [{ id: "fallow", source: "anthropics/skills" }] };

		const removed = await unlinkManagedProjections(
			root,
			join(root, "skills"),
			false,
			[".agents/skills", ".claude/skills"],
			lock,
		);

		expect(removed).toContain(".agents/skills/fallow");
		expect(existsSync(join(root, ".agents/skills/fallow"))).toBe(false);
	});

	// Finding #2/#13/#17: applyProjection must not crash on, or clobber, a real
	// directory that lands at a target path after planning; it fails closed.
	test("apply fails closed when a real dir lands at a target post-plan", async () => {
		const root = await tempRepo("apply-race-realdir");
		await writeSkill(join(root, "skills"), "fallow");
		const plan = await statusPlan(root);
		// Concurrent cp/checkout injects a non-empty real dir before apply.
		await mkdir(join(root, ".agents/skills/fallow"), { recursive: true });
		await writeFile(join(root, ".agents/skills/fallow/SKILL.md"), "x");

		await expect(
			applyProjection(plan, "2026-07-03T00:00:00.000Z"),
		).rejects.toThrow("unmanaged_blocker");
		// The real dir survives untouched (no non-recursive rm crash, no clobber).
		expect(lstatSync(join(root, ".agents/skills/fallow")).isDirectory()).toBe(
			true,
		);
	});

	test("unlink leaves self-install real dirs untouched", async () => {
		const root = await tempRepo("unlink-self-install-real-dir");
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, ".claude/skills"), "fallow");
		const lock = {
			entries: [{ id: "fallow", source: "skills/fallow", sourceType: "local" }],
		};

		const removed = await unlinkManagedProjections(
			root,
			join(root, "skills"),
			false,
			[".agents/skills", ".claude/skills"],
			lock,
		);

		expect(removed).not.toContain(".claude/skills/fallow");
		expect(lstatSync(join(root, ".claude/skills/fallow")).isDirectory()).toBe(
			true,
		);
	});

	test("symlinked projection root escaping repo blocks sync writes", async () => {
		const root = await tempRepo("escaped-root-sync");
		const outside = await mkdtemp(join(tmpdir(), "agent-skills-root-outside-"));
		await writeSkill(join(root, "skills"), "fallow");
		await mkdir(join(root, ".claude"), { recursive: true });
		await symlink(outside, join(root, ".claude/skills"));

		const catalogRoot = join(root, "skills");
		const visibility = applyVisibility(
			await discoverCatalog(catalogRoot),
			[],
		);
		const plan = await planProjection({
			repoRoot: root,
			catalogRoot,
			visibility,
			projectionRoots: [".claude/skills"],
		});

		expect(plan.status.health).toBe("blocked");
		expect(plan.status.blockers).toMatchObject([
			{ root: ".claude", id: "skills", reason: "foreign_symlink" },
		]);
		await expect(
			applyProjection(plan, "2026-07-03T00:00:00.000Z"),
		).rejects.toThrow("unmanaged_blocker");
		expect(existsSync(join(outside, "fallow"))).toBe(false);
	});

	test("unlink rejects a projection root escaping the repo", async () => {
		const root = await tempRepo("escaped-root-unlink");
		const outside = await mkdtemp(join(tmpdir(), "agent-skills-root-outside-"));
		await writeSkill(join(root, "skills"), "fallow");
		await symlink(join(root, "skills", "fallow"), join(outside, "fallow"));
		await mkdir(join(root, ".claude"), { recursive: true });
		await symlink(outside, join(root, ".claude/skills"));

		await expect(
			unlinkManagedProjections(
				root,
				join(root, "skills"),
				false,
				[".claude/skills"],
			),
		).rejects.toThrow("unmanaged_blocker");
		expect(lstatSync(join(outside, "fallow")).isSymbolicLink()).toBe(true);
	});

	test("local lock source must bind to its own catalog id", async () => {
		const root = await tempRepo("self-install-id-binding");
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, "skills"), "summarize");
		const plan = await statusPlan(root, {
			entries: [{ id: "fallow", source: "skills/summarize", sourceType: "local" }],
		});

		expect(plan.status.health).toBe("blocked");
		expect(plan.status.blockers).toMatchObject([
			{ id: "fallow", reason: "catalog_conflict" },
		]);
	});

	test("forged self-install lock leaves foreign symlink external", async () => {
		const root = await tempRepo("forged-self-install-foreign");
		const outside = await mkdtemp(join(tmpdir(), "agent-skills-foreign-"));
		await writeSkill(join(root, "skills"), "fallow");
		await writeSkill(join(root, "skills"), "summarize");
		await mkdir(join(root, ".agents/skills"), { recursive: true });
		await symlink(outside, join(root, ".agents/skills/fallow"));
		const plan = await statusPlan(root, {
			entries: [{ id: "fallow", source: "skills/summarize", sourceType: "local" }],
		});

		expect(plan.status.external_count).toBe(1);
		expect(plan.status.blockers).toMatchObject([
			{ id: "fallow", reason: "catalog_conflict" },
		]);
		await expect(
			applyProjection(plan, "2026-07-03T00:00:00.000Z"),
		).rejects.toThrow("unmanaged_blocker");
		expect(readlinkSync(join(root, ".agents/skills/fallow"))).toBe(outside);
	});

	test("apply fails closed when symlink creation hits a syscall surprise", async () => {
		const root = await tempRepo("apply-symlink-surprise");
		await writeSkill(join(root, "skills"), "fallow");
		await mkdir(join(root, ".agents/skills"), { recursive: true });
		await chmod(join(root, ".agents/skills"), 0o500);
		const plan = await statusPlan(root);

		try {
			await expect(
				applyProjection(plan, "2026-07-03T00:00:00.000Z"),
			).rejects.toThrow("unmanaged_blocker");
		} finally {
			await chmod(join(root, ".agents/skills"), 0o700);
		}
		expect(existsSync(join(root, ".agents/agent-skills-snapshot.json"))).toBe(
			false,
		);
	});

	test("apply fails closed when owned-link removal hits a syscall surprise", async () => {
		const root = await tempRepo("apply-rm-surprise");
		await writeSkill(join(root, "skills"), "fallow");
		await applyProjection(await statusPlan(root), "2026-07-03T00:00:00.000Z");
		const plan = await planProjection({
			repoRoot: root,
			catalogRoot: join(root, "skills"),
			visibility: [],
		});
		await chmod(join(root, ".agents/skills"), 0o500);

		try {
			await expect(
				applyProjection(plan, "2026-07-03T00:00:00.000Z"),
			).rejects.toThrow("unmanaged_blocker");
		} finally {
			await chmod(join(root, ".agents/skills"), 0o700);
		}
		expect(lstatSync(join(root, ".agents/skills/fallow")).isSymbolicLink()).toBe(
			true,
		);
	});

	test("apply leaves a post-plan foreign symlink untouched", async () => {
		const root = await tempRepo("apply-race-foreign-symlink");
		const outside = await mkdtemp(join(tmpdir(), "agent-skills-foreign-"));
		await writeSkill(join(root, "skills"), "fallow");
		const plan = await statusPlan(root);
		await mkdir(join(root, ".agents/skills"), { recursive: true });
		await symlink(outside, join(root, ".agents/skills/fallow"));

		await expect(
			applyProjection(plan, "2026-07-03T00:00:00.000Z"),
		).rejects.toThrow("unmanaged_blocker");
		expect(readlinkSync(join(root, ".agents/skills/fallow"))).toBe(outside);
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
