import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectFacadeLane,
	resolveTargetLayout,
	runStaticAudit,
	sortFindings,
} from "./audit-engine";
import { acquireTargetContract, findContractByShape } from "./target-contract";

const HEAL_SKILL_ROOT = join(import.meta.dir, "..", "..", "classic-cinema");
const FIXTURES = join(import.meta.dir, "fixtures");
const fixture = (name: string) => join(FIXTURES, name);

// --- lane detection (R5) ---

describe("lane detection", () => {
	test("a facade target (dep + import) detects as facade lane", async () => {
		const layout = await resolveTargetLayout(HEAL_SKILL_ROOT);
		const lane = await detectFacadeLane(layout);
		expect(lane.isFacade).toBe(true);
	});

	test("the good-baseline fixture detects as facade lane", async () => {
		const layout = await resolveTargetLayout(fixture("good-baseline"));
		const lane = await detectFacadeLane(layout);
		expect(lane.isFacade).toBe(true);
	});
});

// --- contract acquisition (KTD6) ---

describe("contract acquisition (KTD6)", () => {
	test("acquires a clean contract from a target without importing its module here", async () => {
		const layout = await resolveTargetLayout(HEAL_SKILL_ROOT);
		const acquisition = await acquireTargetContract(layout.contractPath as string);
		expect(acquisition.ok).toBe(true);
		if (acquisition.ok) {
			expect(Object.keys(acquisition.contracts).sort()).toEqual(["check", "explain", "repair"]);
			expect(acquisition.driftCodes).toEqual([]);
		}
	});

	test("a drifting target's drift surfaces as parse data, not an import crash", async () => {
		// bad-exit-floor exports the raw contract object (no throwing builder), so
		// its missing-baseline defect surfaces as no-throw parse drift (KTD6).
		const layout = await resolveTargetLayout(fixture("bad-exit-floor"));
		const acquisition = await acquireTargetContract(layout.contractPath as string);
		expect(acquisition.ok).toBe(true);
		if (acquisition.ok) {
			expect(acquisition.driftCodes).toContain("command-baseline-exit-usage-missing");
		}
	});

	test("findContractByShape finds the contract export by shape, not by name", () => {
		const found = findContractByShape({
			somethingElse: { foo: 1 },
			weirdlyNamedExport: {
				check: { script: "x", summary: "y", flags: {}, exitCodes: { "0": "a" } },
			},
		});
		expect(found).not.toBeNull();
		expect(Object.keys(found ?? {})).toEqual(["check"]);
	});
});

// --- static audit: clean target ---

describe("static audit — clean target", () => {
	test("live heal-skill is clean (zero findings) — the spine works end to end", async () => {
		const outcome = await runStaticAudit({ targetRoot: HEAL_SKILL_ROOT, only: null });
		expect(outcome.laneDetected).toBe(true);
		expect(outcome.findings).toEqual([]);
	});

	test("good-baseline produces zero findings", async () => {
		const outcome = await runStaticAudit({ targetRoot: fixture("good-baseline"), only: null });
		expect(outcome.laneDetected).toBe(true);
		expect(outcome.findings).toEqual([]);
	});
});

// --- static audit: each check fires on its defect (KTD4: zero invocations) ---

describe("static audit — each clause fires", () => {
	test("exit-floor flags a contract missing exit code 2", async () => {
		const outcome = await runStaticAudit({ targetRoot: fixture("bad-exit-floor"), only: "exit-floor" });
		expect(outcome.findings.map((f) => f.clauseId)).toContain("exit-floor");
	});

	test("redaction-discipline flags a planted secret in a flag description", async () => {
		const outcome = await runStaticAudit({
			targetRoot: fixture("bad-redaction-leak"),
			only: "redaction-discipline",
		});
		expect(outcome.findings.map((f) => f.clauseId)).toContain("redaction-discipline");
	});

	test("no-raw-runner flags a source spawning raw `bun test`", async () => {
		const outcome = await runStaticAudit({ targetRoot: fixture("bad-raw-runner"), only: "no-raw-runner" });
		const finding = outcome.findings.find((f) => f.clauseId === "no-raw-runner");
		expect(finding).toBeDefined();
		expect(finding?.summary).toContain("checks.ts");
	});

	test("vacuous-match flags a referenced-set check with no empty-set guard", async () => {
		const outcome = await runStaticAudit({
			targetRoot: fixture("bad-vacuous-match"),
			only: "vacuous-match",
		});
		expect(outcome.findings.map((f) => f.clauseId)).toContain("vacuous-match");
	});

	test("--only restricts the audit to a single clause", async () => {
		// bad-exit-floor only trips exit-floor; restricting to a different clause
		// yields nothing, proving --only is honored.
		const outcome = await runStaticAudit({ targetRoot: fixture("bad-exit-floor"), only: "no-raw-runner" });
		expect(outcome.findings).toEqual([]);
	});
});

// --- KTD4: static findings caught with zero target invocations ---

describe("static checks are zero-invocation (KTD4)", () => {
	test("each static finding carries an empty argv (no invocation)", async () => {
		const outcome = await runStaticAudit({ targetRoot: fixture("bad-exit-floor"), only: null });
		expect(outcome.findings.length).toBeGreaterThan(0);
		for (const finding of outcome.findings) {
			expect(finding.kind).toBe("static");
			expect(finding.argv).toEqual([]);
		}
	});

	test("a finding fires even with no runnable command entrypoint (inspection, not run)", async () => {
		// bad-exit-floor has only a contract module — no auditor.ts / runnable
		// command. A finding here can only come from zero-invocation inspection.
		const outcome = await runStaticAudit({ targetRoot: fixture("bad-exit-floor"), only: "exit-floor" });
		expect(outcome.findings.map((f) => f.clauseId)).toContain("exit-floor");
	});
});

// --- determinism (R3) ---

describe("determinism (R3)", () => {
	test("Covers R3. Re-running identical input in a different cwd produces identical findings", async () => {
		const target = fixture("bad-exit-floor");
		const originalCwd = process.cwd();
		const first = await runStaticAudit({ targetRoot: target, only: null });
		process.chdir(tmpdir());
		try {
			const second = await runStaticAudit({ targetRoot: target, only: null });
			expect(second.findings).toEqual(first.findings);
		} finally {
			process.chdir(originalCwd);
		}
	});

	test("sortFindings is a stable canonical order", () => {
		const sorted = sortFindings([
			{ clauseId: "vacuous-match", kind: "static", summary: "z", argv: [] },
			{ clauseId: "exit-floor", kind: "static", summary: "b", argv: [] },
			{ clauseId: "exit-floor", kind: "static", summary: "a", argv: [] },
		]);
		expect(sorted.map((f) => `${f.clauseId}:${f.summary}`)).toEqual([
			"exit-floor:a",
			"exit-floor:b",
			"vacuous-match:z",
		]);
	});
});
