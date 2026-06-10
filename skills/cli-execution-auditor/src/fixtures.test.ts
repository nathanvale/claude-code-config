import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runFullAudit } from "./audit-engine";

// The fixture corpus is the checker-correctness oracle (R9): synthetic CLIs the
// auditor MUST flag (one bad-* per clause) and one it MUST pass (good-baseline).
// Self-dogfooding never substitutes for this — deliberately breaking a checker
// turns its fixture red here.
//
// Cascade policy (doc-review): clauses are not fully independent — a defect can
// trip more than one clause when they share an input surface. So the corpus does
// NOT assert "exactly one finding"; it asserts each bad fixture fires AT LEAST
// its target clause, plus a documented co-fire set. Every fixture is a COMPLETE
// runnable forked from good-baseline with a single injected defect, so in v1 the
// co-fire sets are empty — but the structure stays so a future defect that does
// cascade is an expected, documented co-fire, not a noisy regression.

const FIXTURES = join(import.meta.dir, "fixtures");

interface CorpusEntry {
	fixture: string;
	/** The clause this fixture's defect targets — MUST fire. */
	target: string;
	/** Clauses that legitimately co-fire (share the defect's input surface). */
	coFire: string[];
}

const CORPUS: CorpusEntry[] = [
	{ fixture: "bad-exit-floor", target: "exit-floor", coFire: [] },
	{ fixture: "bad-redaction-leak", target: "redaction-discipline", coFire: [] },
	{ fixture: "bad-raw-runner", target: "no-raw-runner", coFire: [] },
	{ fixture: "bad-vacuous-match", target: "vacuous-match", coFire: [] },
	{ fixture: "bad-envelope-on-failure", target: "json-valid-under-failure", coFire: [] },
	{ fixture: "bad-partial-coverage", target: "declared-coverage-runs", coFire: [] },
];

describe("fixture corpus — known-good (R9)", () => {
	test("good-baseline produces zero findings", async () => {
		const outcome = await runFullAudit({ targetRoot: join(FIXTURES, "good-baseline"), only: null });
		expect(outcome.laneDetected).toBe(true);
		expect(outcome.findings).toEqual([]);
	});
});

describe("fixture corpus — known-bad fire their target clause (R9, superset)", () => {
	for (const entry of CORPUS) {
		test(`${entry.fixture} fires ${entry.target} (at least)`, async () => {
			const outcome = await runFullAudit({
				targetRoot: join(FIXTURES, entry.fixture),
				only: null,
			});
			const fired = new Set(outcome.findings.map((f) => f.clauseId));
			expect(fired.has(entry.target)).toBe(true);
		});
	}
});

describe("fixture corpus — no undocumented co-fires (R2 false-positive guard)", () => {
	for (const entry of CORPUS) {
		test(`${entry.fixture} fires only target + documented co-fire set`, async () => {
			const outcome = await runFullAudit({
				targetRoot: join(FIXTURES, entry.fixture),
				only: null,
			});
			const allowed = new Set([entry.target, ...entry.coFire]);
			const fired = [...new Set(outcome.findings.map((f) => f.clauseId))];
			const undocumented = fired.filter((id) => !allowed.has(id));
			expect(undocumented).toEqual([]);
		});
	}
});

describe("fixture corpus — checker correctness (R9)", () => {
	test("Covers R9. each clause's --only audit isolates its own fixture", async () => {
		// Restricting to a clause should fire on its fixture and stay silent on the
		// others — proving the checker is specific, not a blanket flagger.
		for (const entry of CORPUS) {
			const onTarget = await runFullAudit({
				targetRoot: join(FIXTURES, entry.fixture),
				only: entry.target,
			});
			expect(onTarget.findings.map((f) => f.clauseId)).toContain(entry.target);

			const onGood = await runFullAudit({
				targetRoot: join(FIXTURES, "good-baseline"),
				only: entry.target,
			});
			expect(onGood.findings).toEqual([]);
		}
	});
});
