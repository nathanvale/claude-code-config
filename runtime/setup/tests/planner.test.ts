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

	test("blocks every projection operation when one target is unsafe", () => {
		const inspection = fixtureInspection({
			catalogIds: ["alpha", "beta"],
			blocked: true,
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
			"/home/.claude/skills/alpha",
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
