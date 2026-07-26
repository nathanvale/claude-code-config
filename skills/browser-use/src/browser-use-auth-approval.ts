// ---------------------------------------------------------------------------
// Approval broker + human-gated approval routing (auth plan U3a PR1, R20,
// R27, KTD11, KTD14; ADR 0028).
//
// Declares the ApprovalBrokerPort — Touch ID-backed presence, ONLY for the
// R20 authorization lifecycle (create/expand/replace/revoke) — and the pure,
// presence-free verification/consumption model: standing-policy mechanical
// evaluation, one-use grant verification with atomic consumption, permanent
// drift invalidation, and pinned-verifier offline verifiability. The
// privilege split is structural (D1/KTD14): the verifier's deps carry no
// broker, so routine runs can never express a presence prompt; the router is
// the only path to the broker and broker absence is a legal, typed refusal
// carrying the existing cause-table continuation — never a throw. No
// Date.now, no Math.random; time enters only via `at_epoch_ms` inputs.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import {
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
	type BrowserUseAuthContinuation,
} from "./browser-use-auth-model";
import {
	type BrowserUseAuthContext,
	secretShapeFindingOf,
} from "./browser-use-auth-bindings";

// --- Vocabularies (R20 — closed) -----------------------------------------------

/** The only causes that can ever reach the broker (R20): authorization lifecycle. */
export const BROWSER_USE_APPROVAL_CAUSES = [
	"create",
	"expand",
	"replace",
	"revoke",
] as const;
export type BrowserUseApprovalCause = (typeof BROWSER_USE_APPROVAL_CAUSES)[number];

export const BROWSER_USE_APPROVAL_PURPOSES = [
	"binding-selection",
	"origin-expansion",
	"binding-replacement",
	"binding-revocation",
	"human-identity-attestation",
] as const;
export type BrowserUseApprovalPurpose =
	(typeof BROWSER_USE_APPROVAL_PURPOSES)[number];

/**
 * Cause derivation is code-owned and total: the router computes the cause
 * from the purpose internally, so no caller can smuggle a fifth cause to
 * the broker.
 */
export const BROWSER_USE_APPROVAL_CAUSE_BY_PURPOSE: Readonly<
	Record<BrowserUseApprovalPurpose, BrowserUseApprovalCause>
> = {
	"binding-selection": "create",
	"origin-expansion": "expand",
	"binding-replacement": "replace",
	"binding-revocation": "revoke",
	"human-identity-attestation": "create",
};

// --- Records (R20/KTD11 drift facts; exact key sets) ---------------------------

export type BrowserUseApprovalBoundFacts = {
	service_id: string;
	auth_context: BrowserUseAuthContext;
	environment: string;
	profile: string;
	origin: string;
	runbook_id: string | null;
	action: string;
	mutation_class: string;
};
export const BROWSER_USE_APPROVAL_BOUND_FACT_KEYS = [
	"service_id",
	"auth_context",
	"environment",
	"profile",
	"origin",
	"runbook_id",
	"action",
	"mutation_class",
] as const satisfies readonly (keyof BrowserUseApprovalBoundFacts)[];

/** Pinned verifier identity; rotation revokes everything outstanding. */
export type BrowserUseVerifierIdentity = {
	key_id: string;
	public_key: string;
};

export type BrowserUseGrantSubject =
	| { purpose: "binding-selection"; selected_item_id: string }
	| { purpose: "origin-expansion"; approved_origin: string }
	| { purpose: "binding-replacement"; replacement_item_id: string }
	| { purpose: "binding-revocation"; item_id: string }
	| { purpose: "human-identity-attestation"; run_id: string };

/**
 * Standing authorization: only human-confirmed values exist in
 * `confirmed_limits` — no "proposed" shape is representable, so proposals
 * structurally have no authority (R20).
 */
export type BrowserUseStandingPolicy = {
	policy_id: string;
	cause: BrowserUseApprovalCause;
	purpose: BrowserUseApprovalPurpose;
	bound_facts: BrowserUseApprovalBoundFacts;
	confirmed_limits: Readonly<Record<string, string>>;
	issued_at_epoch_ms: number;
	verifier_key_id: string;
	signature: string;
};
export const BROWSER_USE_STANDING_POLICY_KEYS = [
	"policy_id",
	"cause",
	"purpose",
	"bound_facts",
	"confirmed_limits",
	"issued_at_epoch_ms",
	"verifier_key_id",
	"signature",
] as const satisfies readonly (keyof BrowserUseStandingPolicy)[];

export type BrowserUseOneUseGrant = {
	grant_id: string;
	subject: BrowserUseGrantSubject;
	bound_facts: BrowserUseApprovalBoundFacts;
	issued_at_epoch_ms: number;
	expires_at_epoch_ms: number;
	verifier_key_id: string;
	signature: string;
};
export const BROWSER_USE_ONE_USE_GRANT_KEYS = [
	"grant_id",
	"subject",
	"bound_facts",
	"issued_at_epoch_ms",
	"expires_at_epoch_ms",
	"verifier_key_id",
	"signature",
] as const satisfies readonly (keyof BrowserUseOneUseGrant)[];

// --- Digests (U2 discipline: canonical array over the key-set constant) --------

/** Deterministic canonical form: object keys sorted recursively, arrays in order. */
function canonicalValueOf(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValueOf);
	if (typeof value === "object" && value !== null) {
		const record = value as Record<string, unknown>;
		return Object.keys(record)
			.sort()
			.map((key) => [key, canonicalValueOf(record[key])]);
	}
	return value;
}

function digestOfCanonicalArray(values: readonly unknown[]): string {
	const canonical = JSON.stringify(values.map(canonicalValueOf));
	return createHash("sha256").update(canonical).digest("hex");
}

export function approvalBoundFactsDigestOf(
	facts: BrowserUseApprovalBoundFacts,
): string {
	return digestOfCanonicalArray(
		BROWSER_USE_APPROVAL_BOUND_FACT_KEYS.map((key) => facts[key]),
	);
}

const STANDING_POLICY_DIGEST_KEYS = BROWSER_USE_STANDING_POLICY_KEYS.filter(
	(key): key is Exclude<keyof BrowserUseStandingPolicy, "signature"> =>
		key !== "signature",
);

export function standingPolicyDigestOf(
	policy: Omit<BrowserUseStandingPolicy, "signature">,
): string {
	return digestOfCanonicalArray(
		STANDING_POLICY_DIGEST_KEYS.map((key) => policy[key]),
	);
}

const ONE_USE_GRANT_DIGEST_KEYS = BROWSER_USE_ONE_USE_GRANT_KEYS.filter(
	(key): key is Exclude<keyof BrowserUseOneUseGrant, "signature"> =>
		key !== "signature",
);

export function oneUseGrantDigestOf(
	grant: Omit<BrowserUseOneUseGrant, "signature">,
): string {
	return digestOfCanonicalArray(
		ONE_USE_GRANT_DIGEST_KEYS.map((key) => grant[key]),
	);
}

// --- Shape validators (fail-closed Issue[]) ------------------------------------

export const BROWSER_USE_APPROVAL_ISSUE_CODES = [
	"approval_key_set_invalid",
	"approval_field_invalid",
	"approval_value_secret_shaped",
] as const;
export type BrowserUseApprovalIssue = {
	code: (typeof BROWSER_USE_APPROVAL_ISSUE_CODES)[number];
	path: string;
	message: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMemberOf(
	vocabulary: readonly string[],
	value: unknown,
): value is string {
	return typeof value === "string" && vocabulary.includes(value);
}

function approvalKeySetIssue(
	path: string,
	value: object,
	expected: readonly string[],
): BrowserUseApprovalIssue | undefined {
	const actual = Object.keys(value);
	const expectedSet = new Set<string>(expected);
	for (const key of actual) {
		if (!expectedSet.has(key)) {
			return {
				code: "approval_key_set_invalid",
				path: `${path}.${key}`,
				message: "unknown approval key; schema extensions fail admission.",
			};
		}
	}
	for (const key of expected) {
		if (!actual.includes(key)) {
			return {
				code: "approval_key_set_invalid",
				path: `${path}.${key}`,
				message: "required approval key is missing.",
			};
		}
	}
	return undefined;
}

/** Non-empty bounded secret-shape-free string; message never echoes the value. */
function boundedStringIssueAt(
	path: string,
	value: unknown,
): BrowserUseApprovalIssue | undefined {
	if (typeof value !== "string" || value.length === 0) {
		return {
			code: "approval_field_invalid",
			path,
			message: "expected a non-empty string.",
		};
	}
	if (secretShapeFindingOf(value) !== undefined) {
		return {
			code: "approval_value_secret_shaped",
			path,
			message: "string failed the secret-shape screen.",
		};
	}
	return undefined;
}

/**
 * DELIBERATE exemption from the bounded-string secret-shape screen: real
 * signatures are opaque base64/hex blobs that legitimately exceed the
 * 256-char redacted-data bound and can contain long base32-like runs. They
 * are verified against a digest and never echoed, so the only guard needed
 * is an explicit generous length cap.
 */
const APPROVAL_SIGNATURE_MAX_LENGTH = 4096;

function signatureIssueAt(
	path: string,
	value: unknown,
): BrowserUseApprovalIssue | undefined {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > APPROVAL_SIGNATURE_MAX_LENGTH
	) {
		return {
			code: "approval_field_invalid",
			path,
			message: "expected a non-empty signature within the signature length cap.",
		};
	}
	return undefined;
}

function epochIssueAt(
	path: string,
	value: unknown,
): BrowserUseApprovalIssue | undefined {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		return {
			code: "approval_field_invalid",
			path,
			message: "expected a non-negative safe integer.",
		};
	}
	return undefined;
}

const BOUND_FACT_STRING_KEYS = [
	"service_id",
	"auth_context",
	"environment",
	"profile",
	"origin",
	"action",
	"mutation_class",
] as const;

function boundFactsIssuesAt(
	path: string,
	value: unknown,
): BrowserUseApprovalIssue[] {
	if (!isPlainObject(value)) {
		return [
			{
				code: "approval_field_invalid",
				path,
				message: "expected a plain bound-facts object.",
			},
		];
	}
	const keyIssue = approvalKeySetIssue(
		path,
		value,
		BROWSER_USE_APPROVAL_BOUND_FACT_KEYS,
	);
	if (keyIssue !== undefined) return [keyIssue];
	const issues: BrowserUseApprovalIssue[] = [];
	for (const key of BOUND_FACT_STRING_KEYS) {
		const issue = boundedStringIssueAt(`${path}.${key}`, value[key]);
		if (issue !== undefined) issues.push(issue);
	}
	if (value.runbook_id !== null) {
		const issue = boundedStringIssueAt(`${path}.runbook_id`, value.runbook_id);
		if (issue !== undefined) issues.push(issue);
	}
	return issues;
}

const GRANT_SUBJECT_FIELD_BY_PURPOSE: Readonly<
	Record<BrowserUseApprovalPurpose, string>
> = {
	"binding-selection": "selected_item_id",
	"origin-expansion": "approved_origin",
	"binding-replacement": "replacement_item_id",
	"binding-revocation": "item_id",
	"human-identity-attestation": "run_id",
};

function grantSubjectIssuesAt(
	path: string,
	value: unknown,
): BrowserUseApprovalIssue[] {
	if (!isPlainObject(value)) {
		return [
			{
				code: "approval_field_invalid",
				path,
				message: "expected a plain grant-subject object.",
			},
		];
	}
	if (!isMemberOf(BROWSER_USE_APPROVAL_PURPOSES, value.purpose)) {
		return [
			{
				code: "approval_field_invalid",
				path: `${path}.purpose`,
				message: "expected a known approval purpose.",
			},
		];
	}
	const field =
		GRANT_SUBJECT_FIELD_BY_PURPOSE[value.purpose as BrowserUseApprovalPurpose];
	const keyIssue = approvalKeySetIssue(path, value, ["purpose", field]);
	if (keyIssue !== undefined) return [keyIssue];
	const issue = boundedStringIssueAt(`${path}.${field}`, value[field]);
	return issue === undefined ? [] : [issue];
}

function confirmedLimitsIssuesAt(
	path: string,
	value: unknown,
): BrowserUseApprovalIssue[] {
	if (!isPlainObject(value)) {
		return [
			{
				code: "approval_field_invalid",
				path,
				message: "expected a plain confirmed-limits object.",
			},
		];
	}
	const issues: BrowserUseApprovalIssue[] = [];
	for (const [key, limit] of Object.entries(value)) {
		if (secretShapeFindingOf(key) !== undefined) {
			// Path deliberately omits the key: a secret-shaped key must not echo.
			issues.push({
				code: "approval_value_secret_shaped",
				path,
				message: "limit key failed the secret-shape screen.",
			});
			continue;
		}
		const issue = boundedStringIssueAt(`${path}.${key}`, limit);
		if (issue !== undefined) issues.push(issue);
	}
	return issues;
}

export function validateStandingPolicyShape(
	value: unknown,
): BrowserUseApprovalIssue[] {
	if (!isPlainObject(value)) {
		return [
			{
				code: "approval_field_invalid",
				path: "policy",
				message: "expected a plain policy object.",
			},
		];
	}
	const keyIssue = approvalKeySetIssue(
		"policy",
		value,
		BROWSER_USE_STANDING_POLICY_KEYS,
	);
	if (keyIssue !== undefined) return [keyIssue];
	const issues: BrowserUseApprovalIssue[] = [];
	const idIssue = boundedStringIssueAt("policy.policy_id", value.policy_id);
	if (idIssue !== undefined) issues.push(idIssue);
	if (!isMemberOf(BROWSER_USE_APPROVAL_CAUSES, value.cause)) {
		issues.push({
			code: "approval_field_invalid",
			path: "policy.cause",
			message: "expected a known approval cause.",
		});
	}
	if (!isMemberOf(BROWSER_USE_APPROVAL_PURPOSES, value.purpose)) {
		issues.push({
			code: "approval_field_invalid",
			path: "policy.purpose",
			message: "expected a known approval purpose.",
		});
	}
	issues.push(...boundFactsIssuesAt("policy.bound_facts", value.bound_facts));
	issues.push(
		...confirmedLimitsIssuesAt(
			"policy.confirmed_limits",
			value.confirmed_limits,
		),
	);
	const issuedIssue = epochIssueAt(
		"policy.issued_at_epoch_ms",
		value.issued_at_epoch_ms,
	);
	if (issuedIssue !== undefined) issues.push(issuedIssue);
	const keyIdIssue = boundedStringIssueAt(
		"policy.verifier_key_id",
		value.verifier_key_id,
	);
	if (keyIdIssue !== undefined) issues.push(keyIdIssue);
	const signatureIssue = signatureIssueAt("policy.signature", value.signature);
	if (signatureIssue !== undefined) issues.push(signatureIssue);
	return issues;
}

export function validateOneUseGrantShape(
	value: unknown,
): BrowserUseApprovalIssue[] {
	if (!isPlainObject(value)) {
		return [
			{
				code: "approval_field_invalid",
				path: "grant",
				message: "expected a plain grant object.",
			},
		];
	}
	const keyIssue = approvalKeySetIssue(
		"grant",
		value,
		BROWSER_USE_ONE_USE_GRANT_KEYS,
	);
	if (keyIssue !== undefined) return [keyIssue];
	const issues: BrowserUseApprovalIssue[] = [];
	const idIssue = boundedStringIssueAt("grant.grant_id", value.grant_id);
	if (idIssue !== undefined) issues.push(idIssue);
	issues.push(...grantSubjectIssuesAt("grant.subject", value.subject));
	issues.push(...boundFactsIssuesAt("grant.bound_facts", value.bound_facts));
	const issuedIssue = epochIssueAt(
		"grant.issued_at_epoch_ms",
		value.issued_at_epoch_ms,
	);
	if (issuedIssue !== undefined) issues.push(issuedIssue);
	const expiresIssue = epochIssueAt(
		"grant.expires_at_epoch_ms",
		value.expires_at_epoch_ms,
	);
	if (expiresIssue !== undefined) issues.push(expiresIssue);
	const keyIdIssue = boundedStringIssueAt(
		"grant.verifier_key_id",
		value.verifier_key_id,
	);
	if (keyIdIssue !== undefined) issues.push(keyIdIssue);
	const signatureIssue = signatureIssueAt("grant.signature", value.signature);
	if (signatureIssue !== undefined) issues.push(signatureIssue);
	return issues;
}

// --- ApprovalBrokerPort (D1: declared here; presence lifecycle ONLY) -----------

export type BrowserUseApprovalPresenceRejection = {
	code:
		| "broker-unavailable"
		| "biometric-capability-missing"
		| "presence-cancelled"
		| "headless-environment";
	message: string;
};

/**
 * Touch ID-backed presence Port, ONLY for the R20 authorization lifecycle.
 * Type-level R16/KTD14: no parameter can carry a token, secret bytes, or a
 * signing capability; `display` is redacted lines, screened by the router
 * before this Port is ever invoked. No verification method lives here.
 */
export type BrowserUseApprovalBrokerPort = {
	issueOneUseGrant(input: {
		subject: BrowserUseGrantSubject;
		bound_facts: BrowserUseApprovalBoundFacts;
		display: readonly string[];
	}): Promise<
		| { ok: true; grant: BrowserUseOneUseGrant }
		| { ok: false; rejection: BrowserUseApprovalPresenceRejection }
	>;
	issueStandingPolicy(input: {
		cause: BrowserUseApprovalCause;
		purpose: BrowserUseApprovalPurpose;
		bound_facts: BrowserUseApprovalBoundFacts;
		confirmed_limits: Readonly<Record<string, string>>;
	}): Promise<
		| { ok: true; policy: BrowserUseStandingPolicy }
		| { ok: false; rejection: BrowserUseApprovalPresenceRejection }
	>;
	revokeAuthorization(
		input: { policy_id: string } | { grant_id: string },
	): Promise<
		{ ok: true } | { ok: false; rejection: BrowserUseApprovalPresenceRejection }
	>;
};

// --- Presence-free verifier (offline verifiability, R20/KTD11) -----------------

export type BrowserUseApprovalLedgerView = {
	isPolicyInvalidated(policy_id: string): boolean;
	isGrantConsumed(grant_id: string): boolean;
};

/**
 * Structurally broker-free: the verifier can never express a presence
 * prompt, so routine authorized runs evaluate mechanically. No
 * caller-identity parameter exists anywhere (R27).
 */
export type BrowserUseApprovalVerifierDeps = {
	verifier: BrowserUseVerifierIdentity;
	verifySignature: (input: {
		digest: string;
		signature: string;
		key_id: string;
	}) => boolean;
	ledger: BrowserUseApprovalLedgerView;
	reserveGrant: (grant_id: string) => boolean;
	invalidatePolicy: (policy_id: string) => void;
};

export const BROWSER_USE_APPROVAL_REFUSAL_CODES = [
	"policy_shape_invalid",
	"policy_signature_invalid",
	"policy_verifier_stale",
	"policy_facts_drifted",
	"policy_invalidated",
	"grant_shape_invalid",
	"grant_signature_invalid",
	"grant_verifier_stale",
	"grant_expired",
	"grant_consumed",
	"grant_purpose_mismatch",
	"grant_facts_mismatch",
] as const;
export type BrowserUseApprovalRefusal = {
	code: (typeof BROWSER_USE_APPROVAL_REFUSAL_CODES)[number];
	message: string;
};

export type BrowserUseApprovalVerifier = {
	evaluateStandingAuthorization(input: {
		policy: unknown;
		facts: BrowserUseApprovalBoundFacts;
	}): { ok: true; policy_id: string } | { ok: false; refusal: BrowserUseApprovalRefusal };
	consumeOneUseGrant(input: {
		grant: unknown;
		expected: BrowserUseGrantSubject;
		facts: BrowserUseApprovalBoundFacts;
		at_epoch_ms: number;
	}):
		| { ok: true; subject: BrowserUseGrantSubject }
		| { ok: false; refusal: BrowserUseApprovalRefusal };
};

function boundFactsEqual(
	left: BrowserUseApprovalBoundFacts,
	right: BrowserUseApprovalBoundFacts,
): boolean {
	return BROWSER_USE_APPROVAL_BOUND_FACT_KEYS.every(
		(key) => left[key] === right[key],
	);
}

function grantSubjectMatches(
	actual: BrowserUseGrantSubject,
	expected: BrowserUseGrantSubject,
): boolean {
	if (actual.purpose !== expected.purpose) return false;
	const field = GRANT_SUBJECT_FIELD_BY_PURPOSE[actual.purpose];
	return (
		(actual as unknown as Record<string, unknown>)[field] ===
		(expected as unknown as Record<string, unknown>)[field]
	);
}

function refusalOf(
	code: BrowserUseApprovalRefusal["code"],
	message: string,
): { ok: false; refusal: BrowserUseApprovalRefusal } {
	return { ok: false, refusal: { code, message } };
}

/**
 * KTD11: a cached record alone never authorizes — signature + facts must
 * prove out every time. Works with the broker absent (offline
 * verifiability); the split is structural, the deps carry no broker.
 */
export function createApprovalVerifier(
	deps: BrowserUseApprovalVerifierDeps,
): BrowserUseApprovalVerifier {
	return {
		evaluateStandingAuthorization({ policy, facts }) {
			const issues = validateStandingPolicyShape(policy);
			const first = issues[0];
			if (first !== undefined) {
				return refusalOf(
					"policy_shape_invalid",
					`the standing policy failed shape admission (${first.code} at ${first.path}).`,
				);
			}
			const admitted = policy as BrowserUseStandingPolicy;
			if (deps.ledger.isPolicyInvalidated(admitted.policy_id)) {
				// Invalidated wins even when the facts match again — never revive.
				return refusalOf(
					"policy_invalidated",
					"the standing policy was permanently invalidated.",
				);
			}
			if (admitted.verifier_key_id !== deps.verifier.key_id) {
				return refusalOf(
					"policy_verifier_stale",
					"the policy was signed under a rotated verifier key.",
				);
			}
			const { signature, ...unsigned } = admitted;
			const verified = deps.verifySignature({
				digest: standingPolicyDigestOf(unsigned),
				signature,
				key_id: admitted.verifier_key_id,
			});
			if (!verified) {
				return refusalOf(
					"policy_signature_invalid",
					"the policy signature does not prove out over its content digest.",
				);
			}
			if (!boundFactsEqual(admitted.bound_facts, facts)) {
				deps.invalidatePolicy(admitted.policy_id);
				return refusalOf(
					"policy_facts_drifted",
					"the observed facts drifted from the policy's bound facts; the policy is permanently invalidated.",
				);
			}
			return { ok: true, policy_id: admitted.policy_id };
		},
		consumeOneUseGrant({ grant, expected, facts, at_epoch_ms }) {
			// Full validation precedes reservation: invalid input never burns it.
			const issues = validateOneUseGrantShape(grant);
			const first = issues[0];
			if (first !== undefined) {
				return refusalOf(
					"grant_shape_invalid",
					`the one-use grant failed shape admission (${first.code} at ${first.path}).`,
				);
			}
			const admitted = grant as BrowserUseOneUseGrant;
			if (deps.ledger.isGrantConsumed(admitted.grant_id)) {
				return refusalOf(
					"grant_consumed",
					"the one-use grant was already consumed.",
				);
			}
			if (admitted.verifier_key_id !== deps.verifier.key_id) {
				return refusalOf(
					"grant_verifier_stale",
					"the grant was signed under a rotated verifier key.",
				);
			}
			const { signature, ...unsigned } = admitted;
			const verified = deps.verifySignature({
				digest: oneUseGrantDigestOf(unsigned),
				signature,
				key_id: admitted.verifier_key_id,
			});
			if (!verified) {
				return refusalOf(
					"grant_signature_invalid",
					"the grant signature does not prove out over its content digest.",
				);
			}
			if (at_epoch_ms > admitted.expires_at_epoch_ms) {
				return refusalOf("grant_expired", "the one-use grant has expired.");
			}
			if (!grantSubjectMatches(admitted.subject, expected)) {
				return refusalOf(
					"grant_purpose_mismatch",
					"the grant subject does not match the expected purpose and subject.",
				);
			}
			if (!boundFactsEqual(admitted.bound_facts, facts)) {
				return refusalOf(
					"grant_facts_mismatch",
					"the observed facts do not match the grant's bound facts.",
				);
			}
			if (!deps.reserveGrant(admitted.grant_id)) {
				// Replay/duplicate-action loses atomically.
				return refusalOf(
					"grant_consumed",
					"the one-use grant reservation was already taken.",
				);
			}
			return { ok: true, subject: admitted.subject };
		},
	};
}

// --- Router (the only path to the broker; broker absence is legal) -------------

/**
 * Refusal continuations are structured clones of the existing cause-table
 * rows (single continuation owner, R21): nothing here mints a new one. The
 * pending fragment cause stays authoritative while the broker is absent.
 */
export function presenceRefusalContinuationOf(
	purpose: BrowserUseApprovalPurpose,
): BrowserUseAuthContinuation {
	const cause =
		purpose === "human-identity-attestation"
			? "human-identity-attestation-required"
			: "user-presence-required";
	return structuredClone(
		BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause].continuation,
	);
}

export type BrowserUseApprovalRequestRefusal = {
	code: BrowserUseApprovalPresenceRejection["code"] | "display-secret-shaped";
	continuation: BrowserUseAuthContinuation;
	message: string;
};

export function createApprovalRouter(deps: {
	broker: BrowserUseApprovalBrokerPort | null;
}): {
	requestGrant(input: {
		subject: BrowserUseGrantSubject;
		bound_facts: BrowserUseApprovalBoundFacts;
		display: readonly string[];
	}): Promise<
		| { ok: true; grant: BrowserUseOneUseGrant }
		| { ok: false; refusal: BrowserUseApprovalRequestRefusal }
	>;
	requestPolicy(input: {
		purpose: BrowserUseApprovalPurpose;
		bound_facts: BrowserUseApprovalBoundFacts;
		confirmed_limits: Readonly<Record<string, string>>;
	}): Promise<
		| { ok: true; policy: BrowserUseStandingPolicy }
		| { ok: false; refusal: BrowserUseApprovalRequestRefusal }
	>;
	requestRevocation(
		input: { policy_id: string } | { grant_id: string },
	): Promise<
		{ ok: true } | { ok: false; refusal: BrowserUseApprovalRequestRefusal }
	>;
} {
	function brokerAbsentRefusal(purpose: BrowserUseApprovalPurpose): {
		ok: false;
		refusal: BrowserUseApprovalRequestRefusal;
	} {
		return {
			ok: false,
			refusal: {
				code: "broker-unavailable",
				continuation: presenceRefusalContinuationOf(purpose),
				message: "the approval broker native capability is absent.",
			},
		};
	}

	function rejectionRefusal(
		purpose: BrowserUseApprovalPurpose,
		rejection: BrowserUseApprovalPresenceRejection,
	): { ok: false; refusal: BrowserUseApprovalRequestRefusal } {
		return {
			ok: false,
			refusal: {
				code: rejection.code,
				continuation: presenceRefusalContinuationOf(purpose),
				message: rejection.message,
			},
		};
	}

	return {
		async requestGrant(input) {
			const purpose = input.subject.purpose;
			// Display lines are screened BEFORE the broker is ever invoked; the
			// refusal names the line index only, never the line.
			for (const [index, line] of input.display.entries()) {
				if (secretShapeFindingOf(line) !== undefined) {
					return {
						ok: false,
						refusal: {
							code: "display-secret-shaped",
							continuation: presenceRefusalContinuationOf(purpose),
							message: `a display line failed the secret-shape screen (display[${index}]).`,
						},
					};
				}
			}
			if (deps.broker === null) return brokerAbsentRefusal(purpose);
			const result = await deps.broker.issueOneUseGrant(input);
			if (result.ok) return result;
			return rejectionRefusal(purpose, result.rejection);
		},
		async requestPolicy(input) {
			// R16 symmetry with requestGrant's display screen: confirmed limits
			// and bound facts surface at the Touch ID presence ceremony, so a
			// secret-shaped entry is refused BEFORE the broker is ever invoked.
			// Limit refusals name the entry index only, never the key or value;
			// bound-fact refusals name the code-owned fact key only.
			for (const [index, [key, limit]] of Object.entries(
				input.confirmed_limits,
			).entries()) {
				if (
					secretShapeFindingOf(key) !== undefined ||
					secretShapeFindingOf(limit) !== undefined
				) {
					return {
						ok: false,
						refusal: {
							code: "display-secret-shaped",
							continuation: presenceRefusalContinuationOf(input.purpose),
							message: `a confirmed limit failed the secret-shape screen (confirmed_limits[${index}]).`,
						},
					};
				}
			}
			for (const factKey of BROWSER_USE_APPROVAL_BOUND_FACT_KEYS) {
				const fact = input.bound_facts[factKey];
				if (
					typeof fact === "string" &&
					secretShapeFindingOf(fact) !== undefined
				) {
					return {
						ok: false,
						refusal: {
							code: "display-secret-shaped",
							continuation: presenceRefusalContinuationOf(input.purpose),
							message: `a bound fact failed the secret-shape screen (bound_facts.${factKey}).`,
						},
					};
				}
			}
			if (deps.broker === null) return brokerAbsentRefusal(input.purpose);
			// Cause derivation is internal — only the four R20 causes can ever
			// reach the broker.
			const result = await deps.broker.issueStandingPolicy({
				cause: BROWSER_USE_APPROVAL_CAUSE_BY_PURPOSE[input.purpose],
				purpose: input.purpose,
				bound_facts: input.bound_facts,
				confirmed_limits: input.confirmed_limits,
			});
			if (result.ok) return result;
			return rejectionRefusal(input.purpose, result.rejection);
		},
		async requestRevocation(input) {
			if (deps.broker === null) return brokerAbsentRefusal("binding-revocation");
			const result = await deps.broker.revokeAuthorization(input);
			if (result.ok) return result;
			return rejectionRefusal("binding-revocation", result.rejection);
		},
	};
}
