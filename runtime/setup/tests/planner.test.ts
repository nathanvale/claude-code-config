import { describe, expect, test } from "bun:test";

import type { SetupInspection } from "../src/inspection.ts";
import { planSetup } from "../src/planner.ts";

describe("setup planner", () => {
	test("plans a clean slate deterministically from sorted evidence", () => {
		const inspection = fixtureInspection({ catalogIds: ["zeta", "alpha"] });

		const first = planSetup(inspection, "status");
		const second = planSetup(inspection, "status");

		expect(first.state).toBe("clean_slate");
		expect(first.station).toBe("status.clean_slate");
		expect(first.operations.map((operation) => operation.destination)).toEqual([
			"/home/.agents/skills/alpha",
			"/home/.agents/skills/zeta",
			"/home/.claude/skills/alpha",
			"/home/.claude/skills/zeta",
		]);
		expect(first.evidence_fingerprint).toBe(second.evidence_fingerprint);
	});

	test("distinguishes healthy state from repairable drift", () => {
		const healthy = fixtureInspection({
			catalogIds: ["alpha"],
			ownership: [
				owned("claude", "alpha", "/repo/skills/alpha"),
				owned("codex", "alpha", "/repo/skills/alpha"),
			],
		});
		const drift = fixtureInspection({
			catalogIds: ["alpha"],
			ownership: [
				owned("claude", "alpha", "/repo/skills/old-alpha"),
				owned("codex", "alpha", "/repo/skills/alpha"),
			],
		});

		expect(planSetup(healthy, "status")).toMatchObject({
			state: "healthy",
			station: "status.healthy",
			operations: [],
		});
		expect(planSetup(drift, "status")).toMatchObject({
			state: "drift",
			station: "status.drift",
			next_action: "run_sync",
		});
	});

	test("blocks every safe operation when one desired target is occupied", () => {
		const inspection = fixtureInspection({
			catalogIds: ["alpha", "beta"],
			ownership: [occupied("claude", "alpha", "real_entry")],
			findings: [{
				id: "real_entry",
				owner: "setup.ownership",
				path: "/home/.claude/skills/alpha",
				summary: "Occupied.",
				repair: "human_repair",
			}],
		});

		const plan = planSetup(inspection, "sync");

		expect(plan.operations).toEqual([]);
		expect(plan.domains[0]).toMatchObject({ planned: [], deferred: [
			"/home/.agents/skills/alpha",
			"/home/.agents/skills/beta",
			"/home/.claude/skills/beta",
		] });
		expect(plan).toMatchObject({ state: "blocked", station: "sync.check_blocked" });
	});

	test("changes the fingerprint when inspection evidence changes", () => {
		const first = planSetup(fixtureInspection({ catalogIds: ["alpha"] }), "status");
		const second = planSetup(fixtureInspection({ catalogIds: ["beta"] }), "status");

		expect(first.evidence_fingerprint).not.toBe(second.evidence_fingerprint);
	});

	test("blocks a desired id occupied by an external owner but preserves unrelated externals", () => {
		const collision = fixtureInspection({
			catalogIds: ["alpha"],
			ownership: [external("claude", "alpha")],
			findings: [{ id: "external_entry", owner: "bunx skills", path: "/home/.claude/skills/alpha", summary: "External.", repair: "human_repair" }],
		});
		const unrelated = fixtureInspection({
			catalogIds: ["alpha"],
			ownership: [external("claude", "other")],
			findings: [{ id: "external_entry", owner: "bunx skills", path: "/home/.claude/skills/other", summary: "External.", repair: "human_repair" }],
		});

		expect(planSetup(collision, "status")).toMatchObject({ state: "blocked", operations: [] });
		expect(planSetup(unrelated, "status")).toMatchObject({ state: "clean_slate" });
		expect(planSetup(unrelated, "status").domains[0]?.preserved).toEqual(["/home/.claude/skills/other"]);
	});

	test("preserves and diagnoses unrelated real and foreign entries without blocking", () => {
		const inspection = fixtureInspection({
			catalogIds: ["alpha"],
			ownership: [
				occupied("claude", "notes", "real_entry"),
				occupied("codex", "foreign", "foreign_symlink"),
			],
			findings: [
				{ id: "real_entry", owner: "setup.ownership", path: "/home/.claude/skills/notes", summary: "Real.", repair: "human_repair" },
				{ id: "foreign_symlink", owner: "setup.ownership", path: "/home/.agents/skills/foreign", summary: "Foreign.", repair: "human_repair" },
			],
		});

		const plan = planSetup(inspection, "sync");

		expect(plan).toMatchObject({ state: "clean_slate", counts: { blockers: 0 } });
		expect(plan.operations).toHaveLength(2);
		expect(plan.findings.map((finding) => finding.id)).toEqual([
			"foreign_symlink", "missing_link", "missing_link", "real_entry",
		]);
		expect(plan.domains[0]?.preserved).toEqual([
			"/home/.agents/skills/foreign",
			"/home/.claude/skills/notes",
		]);
	});

	test("blocks an orphaned managed projection whose source left the catalog", () => {
		const inspection = fixtureInspection({
			ownership: [broken("claude", "deleted"), broken("codex", "deleted")],
			findings: [
				{ id: "broken_managed_link", owner: "setup.ownership", path: "/home/.claude/skills/deleted", summary: "Broken.", repair: "run_sync" },
				{ id: "broken_managed_link", owner: "setup.ownership", path: "/home/.agents/skills/deleted", summary: "Broken.", repair: "run_sync" },
			],
		});

		const plan = planSetup(inspection, "status");

		expect(plan).toMatchObject({
			state: "blocked",
			station: "status.blocked",
			counts: { blockers: 2 },
		});
		expect(plan.findings.filter((finding) => finding.id === "source_missing")).toHaveLength(2);
	});
});

function fixtureInspection(options: {
	catalogIds?: readonly string[];
	ownership?: readonly SetupInspection["ownership"]["entries"][number][];
	findings?: SetupInspection["findings"];
	blocked?: boolean;
}): SetupInspection {
	const catalogIds = options.catalogIds ?? [];
	const findings = options.findings ?? [];
	return {
		scope: {
			scope: "user",
			source_anchor: "/repo",
			target_anchor: "/home",
			catalog_root: "/repo/skills",
			provider_evidence_root: "/repo",
			projection_roots: [
				{ id: "claude", path: "/home/.claude/skills", safe: true },
				{ id: "codex", path: "/home/.agents/skills", safe: true },
			],
			legacy_roots: [],
		},
		catalog: {
			root: "/repo/skills",
			entries: catalogIds.map((id) => ({
				id,
				canonical_id: id,
				path: `/repo/skills/${id}`,
				state: "valid" as const,
				name: id,
				description: `${id} skill`,
			})),
			findings: [],
		},
		provider_evidence: { path: "/repo/skills-lock.json", entries: [] },
		ownership: { entries: options.ownership ?? [], findings: [] },
		duplicate_scope_ids: [],
		findings,
		blocked: options.blocked ?? false,
	};
}

function owned(
	rootId: "claude" | "codex",
	id: string,
	target: string,
): SetupInspection["ownership"]["entries"][number] {
	return {
		root_id: rootId,
		id,
		canonical_id: id,
		path: `/home/.${rootId === "claude" ? "claude" : "agents"}/skills/${id}`,
		shape: "symlink",
		ownership: "managed_link",
		target,
	};
}

function external(
	rootId: "claude" | "codex",
	id: string,
): SetupInspection["ownership"]["entries"][number] {
	return {
		root_id: rootId,
		id,
		canonical_id: id,
		path: `/home/.${rootId === "claude" ? "claude" : "agents"}/skills/${id}`,
		shape: "directory",
		ownership: "external_entry",
		finding_id: "external_entry",
	};
}

function occupied(
	rootId: "claude" | "codex",
	id: string,
	ownership: "real_entry" | "foreign_symlink",
): SetupInspection["ownership"]["entries"][number] {
	return {
		root_id: rootId,
		id,
		canonical_id: id,
		path: `/home/.${rootId === "claude" ? "claude" : "agents"}/skills/${id}`,
		shape: ownership === "foreign_symlink" ? "symlink" : "directory",
		ownership,
		finding_id: ownership,
	};
}

function broken(
	rootId: "claude" | "codex",
	id: string,
): SetupInspection["ownership"]["entries"][number] {
	return {
		root_id: rootId,
		id,
		canonical_id: id,
		path: `/home/.${rootId === "claude" ? "claude" : "agents"}/skills/${id}`,
		shape: "symlink",
		ownership: "broken_managed_link",
		target: `/repo/skills/${id}`,
		finding_id: "broken_managed_link",
	};
}
