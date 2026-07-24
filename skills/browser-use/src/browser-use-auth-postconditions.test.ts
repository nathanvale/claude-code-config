import { describe, expect, test } from "bun:test";
import {
	type BrowserUseAuthPostconditionDeclaration,
	evaluateAuthPostcondition,
	validateAuthPostconditionDeclaration,
} from "./browser-use-auth-postconditions";

// =========================================================================
// Browser Authentication postconditions (auth plan U2, R25).
//
// Data-driven proof: declarations from runbook/service data are admitted
// fail-closed (exact keys, known kinds, unique fact ids, R25 sufficiency
// floor) and evaluated against observed facts — a proof digest persists,
// raw identity data never does.
// =========================================================================

function identityDeclaration(
	overrides: Partial<BrowserUseAuthPostconditionDeclaration> = {},
): BrowserUseAuthPostconditionDeclaration {
	return {
		service_id: "oncore",
		auth_context: "timesheet",
		postcondition_id: "authenticated-as-expected-subject",
		summary: "The identity response names the expected subject and tenant.",
		facts: [
			{
				fact_id: "identity-subject",
				kind: "identity-response",
				expected: "subject-ref-1",
			},
		],
		...overrides,
	};
}

function pageFactsDeclaration(): BrowserUseAuthPostconditionDeclaration {
	return identityDeclaration({
		postcondition_id: "authenticated-by-page-facts",
		facts: [
			{ fact_id: "employee-name-badge", kind: "page-fact", expected: "badge-ref-1" },
			{ fact_id: "timesheet-period", kind: "page-fact", expected: "period-ref-1" },
		],
	});
}

describe("declaration admission (R25)", () => {
	test("one machine-readable identity fact admits", () => {
		expect(validateAuthPostconditionDeclaration(identityDeclaration())).toEqual([]);
	});

	test("two independent page facts admit", () => {
		expect(validateAuthPostconditionDeclaration(pageFactsDeclaration())).toEqual([]);
	});

	test("a single page fact can never prove identity and fails admission", () => {
		const issues = validateAuthPostconditionDeclaration(
			identityDeclaration({
				facts: [
					{ fact_id: "account-label", kind: "page-fact", expected: "label-1" },
				],
			}),
		);
		expect(issues[0]?.code).toBe("postcondition_facts_insufficient");
	});

	test("an unknown fact kind fails admission", () => {
		const issues = validateAuthPostconditionDeclaration(
			identityDeclaration({
				facts: [
					{
						fact_id: "cookie-present",
						// @ts-expect-error — admission must reject unknown kinds at runtime
						kind: "cookie-presence",
						expected: "any",
					},
				],
			}),
		);
		expect(issues[0]?.code).toBe("postcondition_field_invalid");
	});

	test("duplicate fact ids fail admission", () => {
		const issues = validateAuthPostconditionDeclaration(
			identityDeclaration({
				facts: [
					{ fact_id: "fact-1", kind: "page-fact", expected: "a" },
					{ fact_id: "fact-1", kind: "page-fact", expected: "b" },
				],
			}),
		);
		expect(issues[0]?.code).toBe("postcondition_fact_duplicate");
	});

	test("unknown or missing declaration keys fail admission", () => {
		expect(
			validateAuthPostconditionDeclaration({
				...identityDeclaration(),
				selector: "#password",
			})[0]?.code,
		).toBe("postcondition_key_set_invalid");
		const { summary: _summary, ...rest } = identityDeclaration();
		expect(validateAuthPostconditionDeclaration(rest)[0]?.code).toBe(
			"postcondition_key_set_invalid",
		);
	});

	test("a non-object candidate is one typed refusal", () => {
		expect(validateAuthPostconditionDeclaration(null)[0]?.code).toBe(
			"postcondition_field_invalid",
		);
	});
});

describe("evaluation (R25)", () => {
	test("matching facts prove with a deterministic 32-hex proof digest", () => {
		const observed = [{ fact_id: "identity-subject", value: "subject-ref-1" }];
		const first = evaluateAuthPostcondition(identityDeclaration(), observed);
		const second = evaluateAuthPostcondition(identityDeclaration(), observed);
		expect(first.proven).toBe(true);
		if (first.proven && second.proven) {
			expect(first.proof_digest).toBe(second.proof_digest);
			expect(first.proof_digest).toMatch(/^[0-9a-f]{32}$/);
		}
	});

	test("a missing declared fact refuses proof", () => {
		const result = evaluateAuthPostcondition(pageFactsDeclaration(), [
			{ fact_id: "employee-name-badge", value: "badge-ref-1" },
		]);
		expect(result.proven).toBe(false);
		if (!result.proven) expect(result.code).toBe("postcondition_fact_missing");
	});

	test("a mismatching fact refuses proof and never echoes the observed value", () => {
		const result = evaluateAuthPostcondition(identityDeclaration(), [
			{ fact_id: "identity-subject", value: "subject-ref-2" },
		]);
		expect(result.proven).toBe(false);
		if (!result.proven) {
			expect(result.code).toBe("postcondition_fact_mismatch");
			expect(result.message).not.toContain("subject-ref-2");
		}
	});

	test("an inadmissible declaration refuses evaluation", () => {
		const declaration = identityDeclaration({
			facts: [{ fact_id: "one-label", kind: "page-fact", expected: "x" }],
		});
		const result = evaluateAuthPostcondition(declaration, [
			{ fact_id: "one-label", value: "x" },
		]);
		expect(result.proven).toBe(false);
		if (!result.proven) expect(result.code).toBe("postcondition_declaration_invalid");
	});
});
