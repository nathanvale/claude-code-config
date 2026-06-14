import { describe, expect, test } from "bun:test";
import type { ReviewWeakAnchorReason } from "./command-contract";
import {
	deriveLedgerAnchorFacts,
	type LedgerAnchorFacts,
} from "./ledger-anchor-adapter";

describe("skill-feedback U3 ledger anchor adapter", () => {
	test("canonicalizes, sorts, and de-duplicates repo path anchors", () => {
		const facts = deriveLedgerAnchorFacts({
			report_id: "report-canonical",
			touched_surfaces: [
				{
					type: "path",
					value: "skills/skill-feedback/src/../src/skill-feedback-runner.ts",
				},
				{
					type: "path",
					value: "skills/skill-feedback/CONTEXT.md",
				},
				{
					type: "path",
					value: "skills/skill-feedback/src/./skill-feedback-runner.ts",
				},
			],
			observations: [],
		});

		expect(facts).toMatchObject({
			report_id: "report-canonical",
			anchor_strength: "strong_path",
			owner_paths: [
				"skills/skill-feedback/CONTEXT.md",
				"skills/skill-feedback/src/skill-feedback-runner.ts",
			],
			ledger_anchor_key:
				"path:skills/skill-feedback/CONTEXT.md|skills/skill-feedback/src/skill-feedback-runner.ts",
		});
		expect("weak_anchor_reason" in facts).toBe(false);
	});

	test("uses touched surface paths before observation target paths", () => {
		const facts = deriveLedgerAnchorFacts({
			report_id: "report-touched-wins",
			touched_surfaces: [
				{ type: "path", value: "skills/skill-feedback/CONTEXT.md" },
			],
			observations: [
				{
					kind: "tool_failure",
					target: {
						type: "path",
						value: "skills/skill-feedback/src/skill-feedback-runner.ts",
					},
					summary: "Observation points elsewhere.",
					evidence_basis: "driver_observed",
				},
			],
		});

		expect(facts.owner_paths).toEqual(["skills/skill-feedback/CONTEXT.md"]);
		expect(facts.attempted_targets).toEqual([
			{ type: "path", value: "skills/skill-feedback/CONTEXT.md" },
		]);
		expect(facts.ledger_anchor_key).toBe(
			"path:skills/skill-feedback/CONTEXT.md",
		);
	});

	test("falls back to observation target paths when touched paths are absent", () => {
		const facts = deriveLedgerAnchorFacts({
			report_id: "report-observation-path",
			touched_surfaces: [{ type: "label", value: "review command" }],
			observations: [
				{
					kind: "ownership_gap",
					target: {
						type: "path",
						value: "skills/skill-feedback/references/report-shape.md",
					},
					summary: "Observation names the owner path.",
					evidence_basis: "driver_observed",
				},
			],
		});

		expect(facts).toMatchObject({
			anchor_strength: "strong_path",
			owner_paths: ["skills/skill-feedback/references/report-shape.md"],
			ledger_anchor_key:
				"path:skills/skill-feedback/references/report-shape.md",
		});
	});

	test("keeps label-only anchors weak and unmergeable", () => {
		const facts = deriveLedgerAnchorFacts({
			report_id: "report-label-only",
			touched_surfaces: [{ type: "label", value: "review contract" }],
			observations: [
				{
					kind: "product_signal",
					target: { type: "label", value: "review contract" },
					summary: "Label repeats without an owner path.",
					evidence_basis: "driver_observed",
				},
			],
		});

		expect(facts.anchor_strength).toBe("weak");
		expect(facts.weak_anchor_reason).toBe("label_only");
		expectWeakUnmergeableAnchor(facts, "label_only");
	});

	test("keeps missing anchors weak and unmergeable", () => {
		const facts = deriveLedgerAnchorFacts({
			report_id: "report-missing",
			touched_surfaces: [],
			observations: [],
		});

		expect(facts.anchor_strength).toBe("weak");
		expect(facts.weak_anchor_reason).toBe("missing_anchor");
		expect(facts.attempted_targets).toEqual([]);
		expectWeakUnmergeableAnchor(facts, "missing_anchor");
	});

	test("keeps out-of-repo paths weak and unmergeable", () => {
		const outOfRepoPaths = [
			"../outside.md",
			"skills/../../outside.md",
			"/tmp/outside.md",
			"~/outside.md",
			"C:\\outside.md",
		];

		for (const path of outOfRepoPaths) {
			const facts = deriveLedgerAnchorFacts({
				report_id: `report-out-of-repo-${path}`,
				touched_surfaces: [{ type: "path", value: path }],
				observations: [],
			});

			expectWeakUnmergeableAnchor(facts, "out_of_repo");
		}
	});

	test("keeps unverifiable path strings weak and unmergeable", () => {
		for (const path of ["   ", ".", "./"]) {
			const facts = deriveLedgerAnchorFacts({
				report_id: `report-unverifiable-${path}`,
				touched_surfaces: [{ type: "path", value: path }],
				observations: [],
			});

			expectWeakUnmergeableAnchor(facts, "unverifiable");
		}
	});

	test("keeps redacted path markers weak and unmergeable", () => {
		for (const path of [
			"skills/[redacted]/SKILL.md",
			"skills/[redacted-url]/SKILL.md",
			"logs/[redacted-credentials]/hook.json",
		]) {
			const facts = deriveLedgerAnchorFacts({
				report_id: `report-redacted-${path}`,
				touched_surfaces: [{ type: "path", value: path }],
				observations: [],
			});

			expectWeakUnmergeableAnchor(facts, "unverifiable");
		}

		const observationFacts = deriveLedgerAnchorFacts({
			report_id: "report-redacted-observation",
			touched_surfaces: [],
			observations: [
				{
					kind: "ownership_gap",
					target: {
						type: "path",
						value: "skills/[redacted-url]/CONTEXT.md",
					},
					summary: "Observation target was redacted.",
					evidence_basis: "driver_observed",
				},
			],
		});

		expectWeakUnmergeableAnchor(observationFacts, "unverifiable");
	});

	test("does not rescue a weak touched path with an observation path", () => {
		const facts = deriveLedgerAnchorFacts({
			report_id: "report-weak-touched-wins",
			touched_surfaces: [{ type: "path", value: "../outside.md" }],
			observations: [
				{
					kind: "ownership_gap",
					target: {
						type: "path",
						value: "skills/skill-feedback/CONTEXT.md",
					},
					summary: "Observation names a valid path.",
					evidence_basis: "driver_observed",
				},
			],
		});

		expect(facts.anchor_strength).toBe("weak");
		expect(facts.weak_anchor_reason).toBe("out_of_repo");
		expectWeakUnmergeableAnchor(facts, "out_of_repo");
	});

	test("keeps non-anchor report fields out of the ledger anchor key", () => {
		const base = {
			report_id: "report-key-base",
			touched_surfaces: [
				{ type: "path" as const, value: "skills/skill-feedback/CONTEXT.md" },
			],
			observations: [
				{
					kind: "runtime_signal" as const,
					target: {
						type: "path" as const,
						value: "skills/skill-feedback/CONTEXT.md",
					},
					summary: "Runtime named the same path.",
					evidence_basis: "driver_observed" as const,
				},
			],
			evidence_source: "driver_closeout",
			capture_runtime: "codex_stop",
			correlation_status: "linked",
			verification_burden: { level: "heavy", note: "Full review." },
			friction: { category: "tool_failure", note: "Tool failed." },
			open_reason: "owner_path_observation",
			generated_ts: "2026-06-13T00:00:00.000Z",
			skill_run_id: "run-1",
		};
		const changed = {
			...base,
			report_id: "report-key-changed",
			evidence_source: "hook_capture",
			capture_runtime: "claude_stop",
			correlation_status: "unlinked",
			verification_burden: { level: "light", note: "Focused review." },
			friction: { category: "missing_context", note: "Context missing." },
			open_reason: "evidence_gap",
			generated_ts: "2026-06-14T00:00:00.000Z",
			skill_run_id: "run-2",
		};

		expect(deriveLedgerAnchorFacts(changed).ledger_anchor_key).toBe(
			deriveLedgerAnchorFacts(base).ledger_anchor_key,
		);
	});
});

function expectWeakUnmergeableAnchor(
	facts: LedgerAnchorFacts,
	reason: ReviewWeakAnchorReason,
): void {
	expect(facts.anchor_strength).toBe("weak");
	expect(facts.weak_anchor_reason).toBe(reason);
	expect(facts.owner_paths).toEqual([]);
	expect("ledger_anchor_key" in facts).toBe(false);
}
