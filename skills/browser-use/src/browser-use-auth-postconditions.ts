// ---------------------------------------------------------------------------
// Browser Authentication postconditions (auth plan 2026-07-21-003 U2,
// R15, R25; AE10 substrate).
//
// Data-driven authenticated-postcondition proof: declarations arrive from
// approved runbook/service data (site facts and selectors live in data,
// never in code — U2 boundary), are admitted fail-closed against an exact
// schema, and are evaluated against observed facts with the R25 sufficiency
// rule — one stable machine-readable identity fact suffices; otherwise at
// least two independent page facts must agree. Evaluation persists a proof
// digest, never raw identity data. Pure module: no I/O, no clock.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

// --- Declarations (approved runbook/service data) --------------------------------

/**
 * Fact kinds a declaration may require (R25): `identity-response` is a
 * stable machine-readable application/identity response already used by the
 * page; `page-fact` is one independent runbook-declared page-level fact.
 */
export const BROWSER_USE_AUTH_POSTCONDITION_FACT_KINDS = [
	"identity-response",
	"page-fact",
] as const;

/** Fact kind union. */
export type BrowserUseAuthPostconditionFactKind =
	(typeof BROWSER_USE_AUTH_POSTCONDITION_FACT_KINDS)[number];

/** One declared fact: an id, its kind, and the exact expected value. */
export type BrowserUseAuthPostconditionFact = {
	fact_id: string;
	kind: BrowserUseAuthPostconditionFactKind;
	expected: string;
};

/**
 * One authenticated-postcondition declaration from approved runbook or
 * service data. Declared before mutation; the transaction proves it during
 * post-auth proof and the platform's terminal truth classifies against it.
 */
export type BrowserUseAuthPostconditionDeclaration = {
	service_id: string;
	auth_context: string;
	postcondition_id: string;
	summary: string;
	facts: readonly BrowserUseAuthPostconditionFact[];
};

/** The exact declaration key set. */
export const BROWSER_USE_AUTH_POSTCONDITION_KEYS = [
	"service_id",
	"auth_context",
	"postcondition_id",
	"summary",
	"facts",
] as const satisfies readonly (keyof BrowserUseAuthPostconditionDeclaration)[];

/** The exact fact key set. */
export const BROWSER_USE_AUTH_POSTCONDITION_FACT_KEYS = [
	"fact_id",
	"kind",
	"expected",
] as const satisfies readonly (keyof BrowserUseAuthPostconditionFact)[];

/** One typed declaration admission issue. */
export type BrowserUseAuthPostconditionIssue = {
	code:
		| "postcondition_key_set_invalid"
		| "postcondition_field_invalid"
		| "postcondition_facts_insufficient"
		| "postcondition_fact_duplicate";
	path: string;
	message: string;
};

const MAX_DECLARATION_STRING_LENGTH = 512;

function declarationStringIssue(
	path: string,
	value: unknown,
): BrowserUseAuthPostconditionIssue | undefined {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > MAX_DECLARATION_STRING_LENGTH
	) {
		return {
			code: "postcondition_field_invalid",
			path,
			message: "expected a non-empty bounded string.",
		};
	}
	return undefined;
}

function exactKeysIssue(
	path: string,
	value: object,
	expected: readonly string[],
): BrowserUseAuthPostconditionIssue | undefined {
	const actual = Object.keys(value);
	const expectedSet = new Set<string>(expected);
	for (const key of actual) {
		if (!expectedSet.has(key)) {
			return {
				code: "postcondition_key_set_invalid",
				path: `${path}.${key}`,
				message: "unknown declaration key; extensions fail admission.",
			};
		}
	}
	for (const key of expected) {
		if (!actual.includes(key)) {
			return {
				code: "postcondition_key_set_invalid",
				path: `${path}.${key}`,
				message: "required declaration key is missing.",
			};
		}
	}
	return undefined;
}

/**
 * Admit one postcondition declaration from runbook/service data (R25).
 * Fail-closed: exact key sets, known fact kinds, bounded strings, unique
 * fact ids, and the R25 sufficiency floor — a declaration that could never
 * prove identity (no identity-response fact and fewer than two page facts)
 * is inadmissible at admission time, not discovered at runtime.
 *
 * @param value - Untrusted candidate declaration (decoded runbook data)
 * @returns Empty array when the declaration is admissible
 */
export function validateAuthPostconditionDeclaration(
	value: unknown,
): BrowserUseAuthPostconditionIssue[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [
			{
				code: "postcondition_field_invalid",
				path: "declaration",
				message: "expected a plain declaration object.",
			},
		];
	}
	const keyIssue = exactKeysIssue(
		"declaration",
		value,
		BROWSER_USE_AUTH_POSTCONDITION_KEYS,
	);
	if (keyIssue !== undefined) return [keyIssue];
	const issues: BrowserUseAuthPostconditionIssue[] = [];
	const candidate = value as Record<string, unknown>;
	for (const key of [
		"service_id",
		"auth_context",
		"postcondition_id",
		"summary",
	] as const) {
		const issue = declarationStringIssue(`declaration.${key}`, candidate[key]);
		if (issue !== undefined) issues.push(issue);
	}
	const facts = candidate.facts;
	if (!Array.isArray(facts)) {
		issues.push({
			code: "postcondition_field_invalid",
			path: "declaration.facts",
			message: "expected an array of declared facts.",
		});
		return issues;
	}
	const seenFactIds = new Set<string>();
	let identityFacts = 0;
	let pageFacts = 0;
	for (const [index, fact] of facts.entries()) {
		const path = `declaration.facts[${index}]`;
		if (typeof fact !== "object" || fact === null || Array.isArray(fact)) {
			issues.push({
				code: "postcondition_field_invalid",
				path,
				message: "expected a fact object.",
			});
			continue;
		}
		const factKeyIssue = exactKeysIssue(
			path,
			fact,
			BROWSER_USE_AUTH_POSTCONDITION_FACT_KEYS,
		);
		if (factKeyIssue !== undefined) {
			issues.push(factKeyIssue);
			continue;
		}
		const factRecord = fact as Record<string, unknown>;
		for (const key of ["fact_id", "expected"] as const) {
			const issue = declarationStringIssue(`${path}.${key}`, factRecord[key]);
			if (issue !== undefined) issues.push(issue);
		}
		const kind = factRecord.kind;
		if (
			typeof kind !== "string" ||
			!(BROWSER_USE_AUTH_POSTCONDITION_FACT_KINDS as readonly string[]).includes(
				kind,
			)
		) {
			issues.push({
				code: "postcondition_field_invalid",
				path: `${path}.kind`,
				message: "unknown fact kind.",
			});
			continue;
		}
		if (typeof factRecord.fact_id === "string") {
			if (seenFactIds.has(factRecord.fact_id)) {
				issues.push({
					code: "postcondition_fact_duplicate",
					path: `${path}.fact_id`,
					message: "fact ids must be unique within a declaration.",
				});
			}
			seenFactIds.add(factRecord.fact_id);
		}
		if (kind === "identity-response") identityFacts += 1;
		if (kind === "page-fact") pageFacts += 1;
	}
	if (issues.length > 0) return issues;
	if (identityFacts === 0 && pageFacts < 2) {
		issues.push({
			code: "postcondition_facts_insufficient",
			path: "declaration.facts",
			message:
				"identity needs one machine-readable fact or at least two independent page facts (R25).",
		});
	}
	return issues;
}

// --- Evaluation (R25) --------------------------------------------------------------

/** One observed fact: the declared id and the bounded value observed now. */
export type BrowserUseAuthObservedFact = {
	fact_id: string;
	value: string;
};

/** Typed evaluation outcome: proven with a digest, or one typed refusal. */
export type BrowserUseAuthPostconditionEvaluation =
	| { proven: true; proof_digest: string }
	| {
			proven: false;
			code:
				| "postcondition_declaration_invalid"
				| "postcondition_fact_missing"
				| "postcondition_fact_mismatch"
				| "postcondition_facts_insufficient";
			message: string;
	  };

/**
 * Evaluate one admitted declaration against observed facts (R25). Every
 * declared fact must be observed with its exact expected value; sufficiency
 * follows the declaration's admitted floor. The result persists a proof
 * digest over the matched facts — never the raw observed identity data. A
 * mismatch names the fact id only, never the observed value.
 *
 * @param declaration - Admitted postcondition declaration
 * @param observed - Facts observed on the live page right now
 * @returns Proven with a deterministic proof digest, or one typed refusal
 */
export function evaluateAuthPostcondition(
	declaration: BrowserUseAuthPostconditionDeclaration,
	observed: readonly BrowserUseAuthObservedFact[],
): BrowserUseAuthPostconditionEvaluation {
	const admission = validateAuthPostconditionDeclaration(declaration);
	const firstIssue = admission[0];
	if (firstIssue !== undefined) {
		return {
			proven: false,
			code: "postcondition_declaration_invalid",
			message: `declaration is inadmissible (${firstIssue.code} at ${firstIssue.path}).`,
		};
	}
	const observedById = new Map<string, string>();
	for (const fact of observed) {
		observedById.set(fact.fact_id, fact.value);
	}
	for (const fact of declaration.facts) {
		const value = observedById.get(fact.fact_id);
		if (value === undefined) {
			return {
				proven: false,
				code: "postcondition_fact_missing",
				message: `declared fact ${fact.fact_id} was not observed.`,
			};
		}
		if (value !== fact.expected) {
			return {
				proven: false,
				code: "postcondition_fact_mismatch",
				message: `declared fact ${fact.fact_id} does not match its expected value.`,
			};
		}
	}
	const canonical = JSON.stringify([
		declaration.service_id,
		declaration.auth_context,
		declaration.postcondition_id,
		declaration.facts.map((fact) => [fact.fact_id, fact.kind, fact.expected]),
	]);
	return {
		proven: true,
		proof_digest: createHash("sha256").update(canonical).digest("hex").slice(0, 32),
	};
}
