import { describe, expect, test } from "bun:test";
import * as facade from "@side-quest/cli-command-facade";
import * as facadeTesting from "@side-quest/cli-command-facade/testing";
import {
	AUDIT_CLAUSE_IDS,
	DRIFT_CODE_DISPOSITIONS,
	LANE_CLAUSES,
	getClause,
} from "./clause-catalog";

// The authoritative clause ↔ fixture ↔ kind map (plan Output Structure table).
// This test is the guard against the reconciliation/count-drift bug doc-review
// found: if the catalog and this map diverge, the partition test fails.
const EXPECTED_PARTITION: Record<string, "static" | "surface"> = {
	"exit-floor": "static",
	"help-flag-alignment": "static",
	"redaction-discipline": "static",
	"no-raw-runner": "static",
	"vacuous-match": "static",
	"json-valid-under-failure": "surface",
	"exit-code-matches-declared": "surface",
	"declared-coverage-runs": "surface",
	"runnable-resolves": "surface",
};

// Source-grep rules the engine is expected to implement. A clause may cite a
// named grep rule instead of an exported symbol; this is the closed set.
const KNOWN_GREP_RULES = new Set([
	"no-raw-test-runner",
	"no-vacuous-pass-on-empty-set",
	"coverage-exercises-all-declared",
	"front-door-contract-has-runnable",
]);

// The exact set of category codes parseCommandFacadeContract can emit, via
// findCommandFacadeMetadataDrift (which folds in findBaselineExitCodeDrift).
// Extracted from runtime/cli-command-facade/src/{command-metadata,baseline-exit-drift}.ts.
// command-discovery-* codes are emitted by the SEPARATE findCommandDiscoveryTreeDrift
// validator and are intentionally NOT in this set.
const PARSE_EMITTABLE_DRIFT_CODES = [
	"command-action-summary-unsafe-text",
	"command-alias-default-arg-unknown",
	"command-alias-default-args-missing",
	"command-alias-target-missing",
	"command-audience-invalid",
	"command-audience-missing",
	"command-baseline-exit-failure-missing",
	"command-baseline-exit-success-missing",
	"command-baseline-exit-usage-missing",
	"command-capability-role-invalid",
	"command-enum-flag-values-missing",
	"command-env-var-description-unsafe-text",
	"command-env-var-name-invalid",
	"command-env-var-name-sensitive",
	"command-execution-mode-invalid",
	"command-exit-code-invalid",
	"command-exit-code-unsafe-text",
	"command-exit-codes-missing",
	"command-flag-description-unsafe-text",
	"command-flag-name-invalid",
	"command-flags-missing",
	"command-interactivity-invalid",
	"command-mutation-sideeffect-mismatch",
	"command-output-mode-invalid",
	"command-reserved-diagnostic-flag",
	"command-result-contract-kind-unsafe-text",
	"command-result-contract-schema-version-unsafe-text",
	"command-side-effect-invalid",
	"command-summary-unsafe-text",
	"command-usage-unsafe-text",
	"command-write-preview-exemption-unsafe-text",
	"command-write-preview-missing",
] as const;

describe("clause catalog — structure", () => {
	test("every clause record has all fields populated and kind is static|surface", () => {
		expect(LANE_CLAUSES.length).toBeGreaterThan(0);
		for (const clause of LANE_CLAUSES) {
			expect(clause.id).toBeTruthy();
			expect(["static", "surface"]).toContain(clause.kind);
			expect(clause.assertion.length).toBeGreaterThan(0);
			expect(clause.expectedOutcome.length).toBeGreaterThan(0);
			expect(clause.source).toBeDefined();
		}
	});

	test("clause ids are unique and AUDIT_CLAUSE_IDS mirrors LANE_CLAUSES order", () => {
		const ids = LANE_CLAUSES.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(AUDIT_CLAUSE_IDS).toEqual(ids);
	});

	test("getClause resolves a known id and returns undefined for an unknown one", () => {
		expect(getClause("exit-floor")?.id).toBe("exit-floor");
		expect(getClause("not-a-clause")).toBeUndefined();
	});
});

describe("clause catalog — partition (count-drift guard)", () => {
	test("static/surface partition matches the HTD + fixture map exactly", () => {
		const actual: Record<string, "static" | "surface"> = {};
		for (const clause of LANE_CLAUSES) actual[clause.id] = clause.kind;
		// Both directions: no missing clause, no extra clause, no kind drift.
		expect(actual).toEqual(EXPECTED_PARTITION);
	});
});

describe("clause catalog — sources resolve (KTD3)", () => {
	test("every clause source resolves to a real exported symbol or a named grep rule", () => {
		const facadeExports = new Set([
			...Object.keys(facade),
			...Object.keys(facadeTesting),
		]);
		for (const clause of LANE_CLAUSES) {
			if (clause.source.kind === "symbol") {
				expect(facadeExports.has(clause.source.name)).toBe(true);
				expect(clause.source.module.length).toBeGreaterThan(0);
			} else {
				expect(KNOWN_GREP_RULES.has(clause.source.rule)).toBe(true);
			}
		}
	});
});

describe("clause catalog — masking notes (R7)", () => {
	test("each clause maskingNote is either resistant:why or limit, never omitted", () => {
		for (const clause of LANE_CLAUSES) {
			const note = clause.maskingNote;
			if (note.resistant) {
				expect(note.why.length).toBeGreaterThan(0);
			} else {
				expect(note.limit.length).toBeGreaterThan(0);
			}
		}
	});
});

describe("clause catalog — drift-code map completeness", () => {
	test("DRIFT_CODE_DISPOSITIONS covers every parse-emittable drift code (no unmapped code)", () => {
		const mapped = new Set(Object.keys(DRIFT_CODE_DISPOSITIONS));
		const unmapped = PARSE_EMITTABLE_DRIFT_CODES.filter((code) => !mapped.has(code));
		expect(unmapped).toEqual([]);
	});

	test("the map carries no code that parse cannot emit (no stale code)", () => {
		const emittable = new Set<string>(PARSE_EMITTABLE_DRIFT_CODES);
		const stale = Object.keys(DRIFT_CODE_DISPOSITIONS).filter(
			(code) => !emittable.has(code),
		);
		expect(stale).toEqual([]);
	});

	test("every disposition is one of the three known values", () => {
		for (const disposition of Object.values(DRIFT_CODE_DISPOSITIONS)) {
			expect(["becomes-finding", "advisory", "ignored"]).toContain(disposition);
		}
	});
});
