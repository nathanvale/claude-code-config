import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runFullAudit, runStaticAudit } from "./audit-engine";

// Known-answer replay (R10): running the auditor reproduces the three heal-skill
// bugs found by hand, each caught by the expected BEHAVIORAL kind (KTD4) — not by
// a self-chosen label string. Static = caught with zero target invocations
// (argv []); surface = caught only by an invocation (disappears under static-only).
//
// Masking resistance (R11): the vacuous-match clause is stress-tested with the
// hard case (a fix that injects a dummy member to literally satisfy a naive
// non-empty assertion) and a contrast case (a genuine empty-set guard). The
// outcome is honest: resistant where the clause targets the anti-pattern, with
// the residual limit recorded in the clause maskingNote.

const FIXTURES = join(import.meta.dir, "fixtures");
const fixture = (name: string) => join(FIXTURES, name);

function clauseIds(findings: { clauseId: string }[]): string[] {
	return findings.map((f) => f.clauseId);
}

// --- R10: three heal-skill bugs, each by behavioral kind ---

describe("known-answer replay (R10)", () => {
	test("Covers R10. raw-runner defect → finding caught with zero target invocations (static)", async () => {
		const outcome = await runFullAudit({ targetRoot: fixture("bad-raw-runner"), only: "no-raw-runner" });
		const finding = outcome.findings.find((f) => f.clauseId === "no-raw-runner");
		expect(finding).toBeDefined();
		// Behavioral static invariant: zero invocations → empty argv, kind static.
		expect(finding?.kind).toBe("static");
		expect(finding?.argv).toEqual([]);
		// And it is caught by the static half alone (no surface exercise needed).
		const staticOnly = await runStaticAudit({ targetRoot: fixture("bad-raw-runner"), only: "no-raw-runner" });
		expect(clauseIds(staticOnly.findings)).toContain("no-raw-runner");
	});

	test("Covers R10. vacuous owner-paths defect → finding caught with zero target invocations (static)", async () => {
		const outcome = await runFullAudit({ targetRoot: fixture("bad-vacuous-match"), only: "vacuous-match" });
		const finding = outcome.findings.find((f) => f.clauseId === "vacuous-match");
		expect(finding).toBeDefined();
		expect(finding?.kind).toBe("static");
		expect(finding?.argv).toEqual([]);
		const staticOnly = await runStaticAudit({ targetRoot: fixture("bad-vacuous-match"), only: "vacuous-match" });
		expect(clauseIds(staticOnly.findings)).toContain("vacuous-match");
	});

	test("Covers R10. single-suite coverage defect → finding that disappears when the invocation is removed (surface)", async () => {
		const full = await runFullAudit({ targetRoot: fixture("bad-partial-coverage"), only: "declared-coverage-runs" });
		const finding = full.findings.find((f) => f.clauseId === "declared-coverage-runs");
		expect(finding).toBeDefined();
		// Behavioral surface invariant: the finding names a concrete invocation.
		expect(finding?.kind).toBe("surface");
		expect(finding?.argv.length).toBeGreaterThan(0);
		// Removing the invocation (static-only) makes the finding disappear — the
		// behavioral test that this is genuinely surface, not a mislabeled static.
		const staticOnly = await runStaticAudit({ targetRoot: fixture("bad-partial-coverage"), only: null });
		expect(clauseIds(staticOnly.findings)).not.toContain("declared-coverage-runs");
	});

	test("the classification is behavioral: refactoring a static check to invoke would break it", async () => {
		// Guard the R10 invariant against a self-chosen label: a static finding
		// MUST carry empty argv. If an implementer made no-raw-runner invoke the
		// CLI, the argv would be non-empty and this assertion would fail — exactly
		// the behavior-not-label property KTD4 requires.
		const outcome = await runStaticAudit({ targetRoot: fixture("bad-raw-runner"), only: "no-raw-runner" });
		for (const finding of outcome.findings) {
			expect(finding.argv).toEqual([]);
		}
	});
});

// --- R11: masking-fix resistance (hard case + contrast) ---

describe("masking-fix resistance (R11)", () => {
	test("Covers R11. hard masking-fix (dummy member) does NOT close the vacuous-match finding (resistant)", async () => {
		// The masked variant injects one dummy owner path so the set is non-empty —
		// the cheapest form of satisfying a naive 'size > 0' assertion. The clause
		// targets the ANTI-PATTERN (unguarded ok), which the injection does not
		// remove, so the finding stays open: resistant to this masking fix.
		const outcome = await runStaticAudit({
			targetRoot: fixture("bad-vacuous-match-masked"),
			only: "vacuous-match",
		});
		expect(clauseIds(outcome.findings)).toContain("vacuous-match");
	});

	test("contrast: a genuine empty-set guard closes the vacuous-match finding correctly", async () => {
		// The genuinely-fixed variant adds a real empty-set guard, so the clause
		// passes — proving it is not a blanket flagger and the finding closes only
		// on a real fix.
		const outcome = await runStaticAudit({
			targetRoot: fixture("good-vacuous-fixed"),
			only: "vacuous-match",
		});
		expect(clauseIds(outcome.findings)).not.toContain("vacuous-match");
	});

	test("the recorded limit is honest: the clause maskingNote marks it not-fully-resistant", async () => {
		const { getClause } = await import("./clause-catalog");
		const clause = getClause("vacuous-match");
		expect(clause).toBeDefined();
		// R11 is not a blanket guarantee — the clause records resistant:false with a
		// stated residual limit, rather than overclaiming.
		expect(clause?.maskingNote.resistant).toBe(false);
		if (clause && clause.maskingNote.resistant === false) {
			expect(clause.maskingNote.limit.length).toBeGreaterThan(0);
		}
	});
});
