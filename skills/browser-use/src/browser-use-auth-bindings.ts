// ---------------------------------------------------------------------------
// Item Binding + Import Candidate model (auth U3a PR1, ADR 0029 SD1-SD6;
// R10, R11, R13; KTD7).
//
// The ONE owner of the binding-side vocabulary and the match/selection
// policy: legacy data proposes, live vault evidence binds, and humans
// resolve ambiguity through signed one-use grants. Also the single public
// secret-shape guard for all U3a modules (a deliberate mirror-plus-superset
// of the auth model's private fragment patterns — D3). Pure model only:
// no I/O, no Date.now; continuations are structural clones of the
// code-owned blocked-cause table, never minted here.
// ---------------------------------------------------------------------------

import type { BrowserUseLaneAuthMethod } from "./browser-use-adapter-model";
import type { BrowserUseEnvironmentTokenCustodyState } from "./browser-use-environment-token";
import type { BrowserUseGenerationAuthRouteRecord } from "./browser-use-generation-schemas";
import {
	type BrowserUseAuthBlockedCause,
	type BrowserUseAuthContinuation,
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
} from "./browser-use-auth-model";
import type { ProductAdmissionResult } from "@side-quest/browser-use-security";

// --- Vocabularies (ADR 0029) ----------------------------------------------------

/** Closed auth-context vocabulary (SD5): new contexts arrive by code change only. */
export const BROWSER_USE_AUTH_CONTEXTS = ["interactive-login"] as const;

/** Auth context union. */
export type BrowserUseAuthContext = (typeof BROWSER_USE_AUTH_CONTEXTS)[number];

/**
 * CLI-retrievable binding auth methods only; passkey/user-presence is
 * unrepresentable here by construction (R13).
 */
export const BROWSER_USE_BINDING_AUTH_METHODS = ["password", "otp"] as const;

/** Binding auth method union. */
export type BrowserUseBindingAuthMethod =
	(typeof BROWSER_USE_BINDING_AUTH_METHODS)[number];

/** Stale binding states a live read can prove (R11). */
export const BROWSER_USE_BINDING_STALE_STATES = [
	"moved",
	"archived",
	"deleted",
	"revoked",
	"expired",
	"out-of-scope",
	"revision-changed",
] as const;

/** Stale state union. */
export type BrowserUseBindingStaleState =
	(typeof BROWSER_USE_BINDING_STALE_STATES)[number];

/**
 * One immutable command's selected credential lane.
 *
 * The port remains attached to the evidence that admitted it, so status and
 * execution cannot independently re-probe or select different lanes.
 */
export type BrowserUseAuthLaneAdmission<Port> =
	| {
			kind: "signed-admitted";
			evidence: {
				lane: "signed-native";
				assurance: "signed-native";
				native: Extract<ProductAdmissionResult, { verdict: "admitted" }>;
			};
			tokenRetrieval: Port;
	  }
	| {
			kind: "environment-admitted";
			evidence: {
				lane: "environment-injected-op";
				assurance: "lower-assurance";
				native: Extract<
					ProductAdmissionResult,
					{ verdict: "native-capability-absent" }
				>;
				environment: Extract<
					BrowserUseEnvironmentTokenCustodyState,
					{ state: "ready" }
				>;
			};
			tokenRetrieval: Port;
	  }
	| {
			kind: "blocked";
			cause: {
				code:
					| "native-not-admitted"
					| "native-probe-failed"
					| "native-executor-failed"
					| "environment-token-not-ready"
					| "environment-probe-failed"
					| "environment-executor-failed";
			};
			evidence: {
				native?: ProductAdmissionResult;
				environment?: BrowserUseEnvironmentTokenCustodyState;
			};
	  };

// --- Secret-shape guard (D3: single public owner for all U3a modules) -----------

/** Bounded string length; longer values have no legal purpose in redacted data. */
export const BROWSER_USE_SECRET_SHAPE_MAX_STRING_LENGTH = 256;

const SECRET_REFERENCE_PATTERN = /op:\/\//i;
const LIVE_ENDPOINT_PATTERN = /wss?:\/\//i;
const OTPAUTH_PATTERN = /otpauth:\/\//i;
const BASE32_RUN_PATTERN = /\b[A-Z2-7]{32,}\b/i;

/**
 * Mirror-plus-superset of the auth model's private fragment patterns: the
 * two mirrored patterns (op://, ws(s)://) plus otpauth:// and long base32
 * runs (TOTP-seed shaped, R12).
 */
export const BROWSER_USE_SECRET_SHAPE_PATTERNS: readonly RegExp[] = [
	SECRET_REFERENCE_PATTERN,
	LIVE_ENDPOINT_PATTERN,
	OTPAUTH_PATTERN,
	BASE32_RUN_PATTERN,
];

/** Key names whose presence alone marks a candidate secret-positive (SD3). */
export const BROWSER_USE_SECRET_KEY_NAME_PATTERN: RegExp =
	/(password|passwd|secret|seed|totp|credential|token)/i;

/** One classified secret-shape finding. */
export type BrowserUseSecretShapeFinding = {
	reason:
		| "secret-reference"
		| "live-endpoint-reference"
		| "totp-seed-shaped"
		| "exceeds-bounded-length";
};

/**
 * Classify one string against the secret-shape guard.
 *
 * @param value - Candidate string (already known to be a string)
 * @returns A finding, or undefined when the string is clean
 */
export function secretShapeFindingOf(
	value: string,
): BrowserUseSecretShapeFinding | undefined {
	if (value.length > BROWSER_USE_SECRET_SHAPE_MAX_STRING_LENGTH) {
		return { reason: "exceeds-bounded-length" };
	}
	if (SECRET_REFERENCE_PATTERN.test(value)) {
		return { reason: "secret-reference" };
	}
	if (LIVE_ENDPOINT_PATTERN.test(value)) {
		return { reason: "live-endpoint-reference" };
	}
	if (OTPAUTH_PATTERN.test(value) || BASE32_RUN_PATTERN.test(value)) {
		return { reason: "totp-seed-shaped" };
	}
	return undefined;
}

// --- Item Binding (R10 cache shape; KTD7 opaque ids only) -----------------------

/** One approved Item Binding: opaque ids plus live-derived authorization data. */
export type BrowserUseItemBinding = {
	service_id: string;
	/** Live-proven service-account principal; a changed principal invalidates the cache. */
	service_account_id: string;
	auth_context: BrowserUseAuthContext;
	/** Normalized origins only; live-derived + grant-approved aliases. */
	allowed_origins: readonly string[];
	/** Rank/disambiguate same-origin only; never authorize (R10). */
	allowed_login_paths: readonly string[];
	/** Observed binding context, never a second permission system (R9). */
	vault_id: string;
	item_id: string;
	/** Live 1Password item revision; any edit invalidates the cached binding. */
	item_revision: number;
	allowed_auth_methods: readonly BrowserUseBindingAuthMethod[];
	binding_revision: number;
};

/** The exact Item Binding key set. */
export const BROWSER_USE_ITEM_BINDING_KEYS = [
	"service_id",
	"service_account_id",
	"auth_context",
	"allowed_origins",
	"allowed_login_paths",
	"vault_id",
	"item_id",
	"item_revision",
	"allowed_auth_methods",
	"binding_revision",
] as const satisfies readonly (keyof BrowserUseItemBinding)[];

/** Canonical binding equality derived from the schema-owned exact key set. */
export function itemBindingsEqual(
	left: BrowserUseItemBinding,
	right: BrowserUseItemBinding,
): boolean {
	return BROWSER_USE_ITEM_BINDING_KEYS.every((key) => {
		const leftValue = left[key];
		const rightValue = right[key];
		if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
			return (
				Array.isArray(leftValue) &&
				Array.isArray(rightValue) &&
				leftValue.length === rightValue.length &&
				leftValue.every((value, index) => value === rightValue[index])
			);
		}
		return leftValue === rightValue;
	});
}

// --- Import Candidate (proposes, never binds) -----------------------------------

/** One Import Candidate proposed from legacy Auth Pointer data. */
export type BrowserUseImportCandidate = {
	candidate_id: string;
	/** Must already be a vocabulary member; legacy prose is NEVER auto-mapped (SD5). */
	auth_context: BrowserUseAuthContext;
	service_id: string;
	/** Redacted display provenance only. */
	legacy_context_prose: string | null;
	/** Ranks, never authorizes (SD1). */
	hint_item_id: string | null;
	/** Legacy origins; proposals only (SD2). */
	proposed_origins: readonly string[];
	/** Display-only; missing-item repair hint (SD6). */
	legacy_vault_name: string | null;
	provenance: "legacy-auth-pointer";
};

/** One candidate resolved only from a command's captured immutable generation. */
export type BrowserUseResolvedAuthCandidate = {
	generation_id: string;
	activation_epoch: number;
	auth_context_ref: string;
	route_digest: string;
	candidate_digest: string;
	/** Exact parsed route policy; absent only for legacy in-memory callers. */
	route?: BrowserUseGenerationAuthRouteRecord;
	candidate: BrowserUseImportCandidate;
};

/** Secret-free generation lookup failure; callers must not fall back to legacy paths. */
export type BrowserUseAuthGenerationFailure = {
	code:
		| "auth_route_not_found"
		| "auth_generation_record_corrupt"
		| "auth_generation_record_invalid";
	message: string;
};

/** Read-only auth authority captured beside the other immutable generation seams. */
export type BrowserUseAuthGenerationSeam = {
	loadAuthCandidate(
		authContextRef: string,
	): Promise<
		| { ok: true; resolution: BrowserUseResolvedAuthCandidate }
		| { ok: false; failure: BrowserUseAuthGenerationFailure }
	>;
};

/** The exact Import Candidate key set. */
export const BROWSER_USE_IMPORT_CANDIDATE_KEYS = [
	"candidate_id",
	"service_id",
	"auth_context",
	"legacy_context_prose",
	"hint_item_id",
	"proposed_origins",
	"legacy_vault_name",
	"provenance",
] as const satisfies readonly (keyof BrowserUseImportCandidate)[];

// --- Live vault evidence --------------------------------------------------------

/** Redacted live vault item evidence: what op projections produce (D4). */
export type BrowserUseVaultItemEvidence = {
	item_id: string;
	vault_id: string;
	item_revision: number;
	/** Normalized, derived live. */
	origins: readonly string[];
	login_paths: readonly string[];
	supported_methods: readonly BrowserUseBindingAuthMethod[];
	state: "active" | BrowserUseBindingStaleState;
};

/** The exact vault item evidence key set. */
export const BROWSER_USE_VAULT_ITEM_EVIDENCE_KEYS = [
	"item_id",
	"vault_id",
	"item_revision",
	"origins",
	"login_paths",
	"supported_methods",
	"state",
] as const satisfies readonly (keyof BrowserUseVaultItemEvidence)[];

const EVIDENCE_STATES: readonly string[] = [
	"active",
	...BROWSER_USE_BINDING_STALE_STATES,
];

// --- Issues + validators (U2 fail-closed idiom) ---------------------------------

/** Typed binding-domain issue codes. */
export const BROWSER_USE_BINDING_ISSUE_CODES = [
	"binding_key_set_invalid",
	"binding_field_invalid",
	"binding_value_secret_shaped",
	"binding_origin_invalid",
	"candidate_key_set_invalid",
	"candidate_field_invalid",
	"candidate_auth_context_unknown",
	"candidate_value_secret_shaped",
	"evidence_key_set_invalid",
	"evidence_field_invalid",
	"evidence_value_secret_shaped",
] as const;

/** Issue code union. */
export type BrowserUseBindingIssueCode =
	(typeof BROWSER_USE_BINDING_ISSUE_CODES)[number];

/** One typed issue; the message names path/code only, never echoes values. */
export type BrowserUseBindingIssue = {
	code: BrowserUseBindingIssueCode;
	path: string;
	message: string;
};

type FamilyCodes = {
	keySet: BrowserUseBindingIssueCode;
	field: BrowserUseBindingIssueCode;
	secret: BrowserUseBindingIssueCode;
};

const BINDING_CODES: FamilyCodes = {
	keySet: "binding_key_set_invalid",
	field: "binding_field_invalid",
	secret: "binding_value_secret_shaped",
};
const CANDIDATE_CODES: FamilyCodes = {
	keySet: "candidate_key_set_invalid",
	field: "candidate_field_invalid",
	secret: "candidate_value_secret_shaped",
};
const EVIDENCE_CODES: FamilyCodes = {
	keySet: "evidence_key_set_invalid",
	field: "evidence_field_invalid",
	secret: "evidence_value_secret_shaped",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keySetIssue(
	path: string,
	value: object,
	expected: readonly string[],
	codes: FamilyCodes,
): BrowserUseBindingIssue | undefined {
	const actual = Object.keys(value);
	const expectedSet = new Set<string>(expected);
	for (const key of actual) {
		if (!expectedSet.has(key)) {
			return {
				code: codes.keySet,
				path: `${path}.${key}`,
				message: "unknown key; schema extensions fail admission.",
			};
		}
	}
	for (const key of expected) {
		if (!actual.includes(key)) {
			return {
				code: codes.keySet,
				path: `${path}.${key}`,
				message: "required key is missing.",
			};
		}
	}
	return undefined;
}

function stringIssueAt(
	path: string,
	value: unknown,
	codes: FamilyCodes,
): BrowserUseBindingIssue | undefined {
	if (typeof value !== "string" || value.length === 0) {
		return { code: codes.field, path, message: "expected a non-empty string." };
	}
	if (secretShapeFindingOf(value) !== undefined) {
		return {
			code: codes.secret,
			path,
			message: "string is secret-shaped or exceeds the bounded length.",
		};
	}
	return undefined;
}

function nullableStringIssueAt(
	path: string,
	value: unknown,
	codes: FamilyCodes,
): BrowserUseBindingIssue | undefined {
	if (value === null) return undefined;
	return stringIssueAt(path, value, codes);
}

function stringArrayIssues(
	path: string,
	value: unknown,
	codes: FamilyCodes,
): BrowserUseBindingIssue[] {
	if (!Array.isArray(value)) {
		return [{ code: codes.field, path, message: "expected an array of strings." }];
	}
	const issues: BrowserUseBindingIssue[] = [];
	for (const [index, entry] of value.entries()) {
		const issue = stringIssueAt(`${path}[${index}]`, entry, codes);
		if (issue !== undefined) issues.push(issue);
	}
	return issues;
}

function methodArrayIssues(
	path: string,
	value: unknown,
	codes: FamilyCodes,
): BrowserUseBindingIssue[] {
	if (!Array.isArray(value)) {
		return [
			{ code: codes.field, path, message: "expected an array of auth methods." },
		];
	}
	const issues: BrowserUseBindingIssue[] = [];
	for (const [index, entry] of value.entries()) {
		if (
			typeof entry !== "string" ||
			!(BROWSER_USE_BINDING_AUTH_METHODS as readonly string[]).includes(entry)
		) {
			issues.push({
				code: codes.field,
				path: `${path}[${index}]`,
				message: "expected a known binding auth method.",
			});
		}
	}
	return issues;
}

/**
 * Admit one candidate Item Binding record (KTD7): exact key set, opaque-id
 * strings screened by the secret-shape guard, allowed_origins that are their
 * own normalizeOrigin fixpoint, and a closed method vocabulary. Fail-closed:
 * typed issues, never a throw.
 *
 * @param value - Untrusted candidate binding record
 * @returns Empty array when the binding is admissible
 */
export function validateItemBindingShape(
	value: unknown,
): BrowserUseBindingIssue[] {
	if (!isPlainObject(value)) {
		return [
			{
				code: "binding_field_invalid",
				path: "binding",
				message: "expected a plain binding object.",
			},
		];
	}
	const keyIssue = keySetIssue(
		"binding",
		value,
		BROWSER_USE_ITEM_BINDING_KEYS,
		BINDING_CODES,
	);
	if (keyIssue !== undefined) return [keyIssue];

	const issues: BrowserUseBindingIssue[] = [];
	for (const field of [
		"service_id",
		"service_account_id",
		"vault_id",
		"item_id",
	] as const) {
		const issue = stringIssueAt(`binding.${field}`, value[field], BINDING_CODES);
		if (issue !== undefined) {
			issues.push(issue);
			continue;
		}
		// Ids feed op argv positions and flag values; a leading '-' would let a
		// tampered persisted binding reshape the op invocation. Fail closed.
		if ((value[field] as string).startsWith("-")) {
			issues.push({
				code: "binding_field_invalid",
				path: `binding.${field}`,
				message: "id must not be flag-shaped (leading '-').",
			});
		}
	}
	if (
		!(BROWSER_USE_AUTH_CONTEXTS as readonly string[]).includes(
			value.auth_context as string,
		)
	) {
		issues.push({
			code: "binding_field_invalid",
			path: "binding.auth_context",
			message: "expected a known auth context.",
		});
	}
	issues.push(
		...stringArrayIssues("binding.allowed_origins", value.allowed_origins, BINDING_CODES),
	);
	if (Array.isArray(value.allowed_origins)) {
		for (const [index, entry] of value.allowed_origins.entries()) {
			if (typeof entry !== "string") continue;
			const normalized = normalizeOrigin(entry);
			if (!normalized.ok || normalized.origin !== entry) {
				issues.push({
					code: "binding_origin_invalid",
					path: `binding.allowed_origins[${index}]`,
					message: "origin is not its own normalization fixpoint.",
				});
			}
		}
	}
	issues.push(
		...stringArrayIssues(
			"binding.allowed_login_paths",
			value.allowed_login_paths,
			BINDING_CODES,
		),
	);
	issues.push(
		...methodArrayIssues(
			"binding.allowed_auth_methods",
			value.allowed_auth_methods,
			BINDING_CODES,
		),
	);
	if (
		typeof value.item_revision !== "number" ||
		!Number.isSafeInteger(value.item_revision) ||
		value.item_revision < 1
	) {
		issues.push({
			code: "binding_field_invalid",
			path: "binding.item_revision",
			message: "expected a positive safe integer.",
		});
	}
	if (
		typeof value.binding_revision !== "number" ||
		!Number.isSafeInteger(value.binding_revision) ||
		value.binding_revision < 1
	) {
		issues.push({
			code: "binding_field_invalid",
			path: "binding.binding_revision",
			message: "expected a positive safe integer.",
		});
	}
	return issues;
}

/**
 * Admit one candidate Import Candidate record (SD3/SD5): exact key set,
 * screened strings, a vocabulary auth context (legacy prose is never
 * auto-mapped), and the fixed legacy provenance. Fail-closed Issue[].
 *
 * @param value - Untrusted candidate record (legacy import data)
 * @returns Empty array when the candidate is admissible
 */
export function validateImportCandidateShape(
	value: unknown,
): BrowserUseBindingIssue[] {
	if (!isPlainObject(value)) {
		return [
			{
				code: "candidate_field_invalid",
				path: "candidate",
				message: "expected a plain candidate object.",
			},
		];
	}
	const keyIssue = keySetIssue(
		"candidate",
		value,
		BROWSER_USE_IMPORT_CANDIDATE_KEYS,
		CANDIDATE_CODES,
	);
	if (keyIssue !== undefined) return [keyIssue];

	const issues: BrowserUseBindingIssue[] = [];
	for (const field of ["candidate_id", "service_id"] as const) {
		const issue = stringIssueAt(`candidate.${field}`, value[field], CANDIDATE_CODES);
		if (issue !== undefined) issues.push(issue);
	}
	if (
		!(BROWSER_USE_AUTH_CONTEXTS as readonly string[]).includes(
			value.auth_context as string,
		)
	) {
		issues.push({
			code: "candidate_auth_context_unknown",
			path: "candidate.auth_context",
			message: "unknown auth context; legacy prose is never auto-mapped.",
		});
	}
	for (const field of [
		"legacy_context_prose",
		"hint_item_id",
		"legacy_vault_name",
	] as const) {
		const issue = nullableStringIssueAt(
			`candidate.${field}`,
			value[field],
			CANDIDATE_CODES,
		);
		if (issue !== undefined) issues.push(issue);
	}
	issues.push(
		...stringArrayIssues(
			"candidate.proposed_origins",
			value.proposed_origins,
			CANDIDATE_CODES,
		),
	);
	if (value.provenance !== "legacy-auth-pointer") {
		issues.push({
			code: "candidate_field_invalid",
			path: "candidate.provenance",
			message: "expected the legacy-auth-pointer provenance.",
		});
	}
	return issues;
}

/**
 * Admit one candidate vault item evidence record: exact key set, screened
 * strings, closed method and state vocabularies. Fail-closed Issue[].
 *
 * @param value - Untrusted candidate evidence record
 * @returns Empty array when the evidence is admissible
 */
export function validateVaultItemEvidenceShape(
	value: unknown,
): BrowserUseBindingIssue[] {
	if (!isPlainObject(value)) {
		return [
			{
				code: "evidence_field_invalid",
				path: "evidence",
				message: "expected a plain evidence object.",
			},
		];
	}
	const keyIssue = keySetIssue(
		"evidence",
		value,
		BROWSER_USE_VAULT_ITEM_EVIDENCE_KEYS,
		EVIDENCE_CODES,
	);
	if (keyIssue !== undefined) return [keyIssue];

	const issues: BrowserUseBindingIssue[] = [];
	for (const field of ["item_id", "vault_id"] as const) {
		const issue = stringIssueAt(`evidence.${field}`, value[field], EVIDENCE_CODES);
		if (issue !== undefined) {
			issues.push(issue);
			continue;
		}
		// matchItemBinding copies evidence ids verbatim into minted bindings,
		// which feed op argv positions; a leading '-' would let tampered
		// evidence reshape the op invocation. Fail closed (same guard as
		// validateItemBindingShape).
		if ((value[field] as string).startsWith("-")) {
			issues.push({
				code: "evidence_field_invalid",
				path: `evidence.${field}`,
				message: "id must not be flag-shaped (leading '-').",
			});
		}
	}
	issues.push(
		...stringArrayIssues("evidence.origins", value.origins, EVIDENCE_CODES),
	);
	issues.push(
		...stringArrayIssues("evidence.login_paths", value.login_paths, EVIDENCE_CODES),
	);
	issues.push(
		...methodArrayIssues(
			"evidence.supported_methods",
			value.supported_methods,
			EVIDENCE_CODES,
		),
	);
	if (
		typeof value.item_revision !== "number" ||
		!Number.isSafeInteger(value.item_revision) ||
		value.item_revision < 1
	) {
		issues.push({
			code: "evidence_field_invalid",
			path: "evidence.item_revision",
			message: "expected a positive safe integer.",
		});
	}
	if (
		typeof value.state !== "string" ||
		!EVIDENCE_STATES.includes(value.state)
	) {
		issues.push({
			code: "evidence_field_invalid",
			path: "evidence.state",
			message: "expected a known evidence state.",
		});
	}
	return issues;
}

// --- Candidate screening (SD3) --------------------------------------------------

/** Screen result: the candidate verbatim, or a secret-free rejection. */
export type BrowserUseCandidateScreenResult =
	| { ok: true; candidate: BrowserUseImportCandidate }
	| {
			ok: false;
			rejection: {
				code: "secret-positive-candidate" | "candidate-shape-invalid";
				candidate_id: string | null;
				message: string;
			};
	  };

function candidateIdOf(value: unknown): string | null {
	if (!isPlainObject(value)) return null;
	const id = value.candidate_id;
	if (typeof id !== "string" || id.length === 0) return null;
	if (secretShapeFindingOf(id) !== undefined) return null;
	return id;
}

// Beyond this depth the sweep cannot prove the candidate clean; unbounded
// nesting is inadmissible, so the walk fails closed as secret-positive.
const SECRET_SWEEP_MAX_DEPTH = 8;

function hasSecretShapedValueAt(value: unknown, depth: number): boolean {
	if (depth > SECRET_SWEEP_MAX_DEPTH) return true;
	if (typeof value === "string") {
		return secretShapeFindingOf(value) !== undefined;
	}
	if (Array.isArray(value)) {
		return value.some((entry) => hasSecretShapedValueAt(entry, depth + 1));
	}
	if (isPlainObject(value)) {
		return Object.entries(value).some(
			([key, entry]) =>
				BROWSER_USE_SECRET_KEY_NAME_PATTERN.test(key) ||
				hasSecretShapedValueAt(entry, depth + 1),
		);
	}
	return false;
}

// Independent secret sweep over the raw candidate's own values — recursing
// through nested arrays/objects (bounded) so a buried secret surfaces as
// contamination — so key-set short-circuiting in the shape validator can
// never mask a secret-shaped value (SD3 escalation contract). Top-level key
// names are screened separately against the expected key set by the caller.
function hasSecretShapedOwnValue(value: Record<string, unknown>): boolean {
	return Object.values(value).some((entry) => hasSecretShapedValueAt(entry, 1));
}

/**
 * Screen one untrusted Import Candidate (SD3). Any secret-shaped value, or
 * an unknown key whose name matches the secret key-name pattern, escalates
 * to a secret-positive refusal. No stripped/cleaned candidate is ever
 * emitted; the rejection carries zero secret bytes.
 *
 * @param value - Untrusted candidate record
 * @returns The candidate verbatim, or a typed rejection
 */
export function screenImportCandidate(
	value: unknown,
): BrowserUseCandidateScreenResult {
	const candidateId = candidateIdOf(value);
	const issues = validateImportCandidateShape(value);
	let secretPositive = issues.some(
		(issue) => issue.code === "candidate_value_secret_shaped",
	);
	if (!secretPositive && isPlainObject(value)) {
		const expected = new Set<string>(BROWSER_USE_IMPORT_CANDIDATE_KEYS);
		secretPositive =
			hasSecretShapedOwnValue(value) ||
			Object.keys(value).some(
				(key) =>
					!expected.has(key) && BROWSER_USE_SECRET_KEY_NAME_PATTERN.test(key),
			);
	}
	if (secretPositive) {
		return {
			ok: false,
			rejection: {
				code: "secret-positive-candidate",
				candidate_id: candidateId,
				message:
					"candidate carries a secret-shaped value or secret-named key; no cleaned candidate is emitted.",
			},
		};
	}
	const first = issues[0];
	if (first !== undefined) {
		return {
			ok: false,
			rejection: {
				code: "candidate-shape-invalid",
				candidate_id: candidateId,
				message: `candidate shape invalid (${first.code} at ${first.path}).`,
			},
		};
	}
	return { ok: true, candidate: value as BrowserUseImportCandidate };
}

// --- Origin normalization (R10) -------------------------------------------------

/** Normalization result: a canonical origin, or a typed rejection. */
export type BrowserUseOriginNormalization =
	| { ok: true; origin: string }
	| { ok: false; rejection: { code: "origin_unparseable"; message: string } };

/**
 * Normalize one raw URL to its origin: lowercase scheme+host, default port
 * dropped, path/query/fragment stripped. Only http(s) origins are legal.
 *
 * @param raw - Raw URL or origin string
 * @returns The canonical origin, or origin_unparseable
 */
export function normalizeOrigin(raw: string): BrowserUseOriginNormalization {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return {
			ok: false,
			rejection: {
				code: "origin_unparseable",
				message: "origin could not be parsed as an absolute URL.",
			},
		};
	}
	if (
		(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
		parsed.origin === "null"
	) {
		return {
			ok: false,
			rejection: {
				code: "origin_unparseable",
				message: "origin is not an http(s) origin.",
			},
		};
	}
	return { ok: true, origin: parsed.origin };
}

// --- Match/selection policy (single owner; SD1, SD6) ----------------------------

/** One redacted selection option shown to the grant flow. */
export type BrowserUseRedactedSelectionOption = {
	item_id: string;
	rank: number;
	hinted: boolean;
	matched_origin: string;
};

/** Projection-level repair data (SD6); never enters a fragment continuation. */
export type BrowserUseBindingRepairHint = {
	legacy_vault_name: string | null;
};

/** Input to the single-owner match policy; the R8 vault proof MUST precede. */
export type BrowserUseBindingMatchInput = {
	service_id: string;
	/** Principal proved active before vault discovery. */
	service_account_id: string;
	auth_context: BrowserUseAuthContext;
	/** Runtime passes one; import passes normalized proposed_origins. */
	target_origins: readonly string[];
	/** Ranks same-origin candidates only. */
	login_path: string | null;
	/** The proven exactly-one vault. */
	vault_id: string;
	items: readonly BrowserUseVaultItemEvidence[];
	hint: Pick<
		BrowserUseImportCandidate,
		"hint_item_id" | "legacy_vault_name"
	> | null;
};

/** Match result: bound, missing-item, ambiguous, or a typed refusal. */
export type BrowserUseBindingMatchResult =
	| { kind: "bound"; binding: BrowserUseItemBinding }
	| {
			kind: "missing-item";
			blocked_cause: Extract<BrowserUseAuthBlockedCause, "revoked-binding">;
			continuation: BrowserUseAuthContinuation;
			repair_hint: BrowserUseBindingRepairHint;
	  }
	| {
			kind: "ambiguous-selection";
			blocked_cause: Extract<
				BrowserUseAuthBlockedCause,
				"ambiguous-binding-selection"
			>;
			continuation: BrowserUseAuthContinuation;
			selection: readonly BrowserUseRedactedSelectionOption[];
	  }
	| {
			kind: "refused";
			rejection: { code: "match_input_invalid"; message: string };
	  };

function continuationOf(
	cause: BrowserUseAuthBlockedCause,
): BrowserUseAuthContinuation {
	return structuredClone(BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause].continuation);
}

function matchInputRefusal(field: string): BrowserUseBindingMatchResult {
	return {
		kind: "refused",
		rejection: {
			code: "match_input_invalid",
			message: `match input invalid (${field}).`,
		},
	};
}

function loginPathScore(
	item: BrowserUseVaultItemEvidence,
	loginPath: string | null,
): number {
	if (loginPath === null) return 0;
	let best = 0;
	for (const path of item.login_paths) {
		if (loginPath.startsWith(path) && path.length > best) best = path.length;
	}
	return best;
}

/**
 * The single-owner match/selection policy: fresh discovery AND import both
 * call it. Exactly one deterministic live-evidence match binds with zero
 * prompts; zero matches block revoked-binding with the legacy repair hint
 * carried beside (never inside) the continuation (SD6); 2+ matches block
 * ambiguous-binding-selection with a redacted ranked list — the hint ranks
 * but never collapses a tie to a bind (SD1).
 *
 * @param input - Match input; the R8 vault proof must precede this call
 * @returns Bound binding, typed blocked result, or a typed refusal
 */
export function matchItemBinding(
	input: BrowserUseBindingMatchInput,
): BrowserUseBindingMatchResult {
	if (typeof input.service_id !== "string" || input.service_id.length === 0) {
		return matchInputRefusal("service_id");
	}
	if (
		typeof input.service_account_id !== "string" ||
		input.service_account_id.length === 0
	) {
		return matchInputRefusal("service_account_id");
	}
	if (
		!(BROWSER_USE_AUTH_CONTEXTS as readonly string[]).includes(
			input.auth_context,
		)
	) {
		return matchInputRefusal("auth_context");
	}
	if (typeof input.vault_id !== "string" || input.vault_id.length === 0) {
		return matchInputRefusal("vault_id");
	}
	for (const origin of input.target_origins) {
		const normalized = normalizeOrigin(origin);
		if (!normalized.ok || normalized.origin !== origin) {
			return matchInputRefusal("target_origins");
		}
	}

	// Eligibility: proven vault, active state, exact normalized-origin overlap
	// only — a path match on another origin never qualifies (R10).
	const eligible: {
		item: BrowserUseVaultItemEvidence;
		matched_origin: string;
	}[] = [];
	for (const item of input.items) {
		if (item.vault_id !== input.vault_id) continue;
		if (item.state !== "active") continue;
		const matched = input.target_origins.find((origin) =>
			item.origins.includes(origin),
		);
		if (matched === undefined) continue;
		eligible.push({ item, matched_origin: matched });
	}

	if (eligible.length === 0) {
		return {
			kind: "missing-item",
			blocked_cause: "revoked-binding",
			continuation: continuationOf("revoked-binding"),
			repair_hint: { legacy_vault_name: input.hint?.legacy_vault_name ?? null },
		};
	}

	const single = eligible[0];
	if (eligible.length === 1 && single !== undefined) {
		return {
			kind: "bound",
			binding: {
				service_id: input.service_id,
				service_account_id: input.service_account_id,
				auth_context: input.auth_context,
				allowed_origins: [...single.item.origins],
				allowed_login_paths: [...single.item.login_paths],
				vault_id: single.item.vault_id,
				item_id: single.item.item_id,
				item_revision: single.item.item_revision,
				allowed_auth_methods: [...single.item.supported_methods],
				binding_revision: 1,
			},
		};
	}

	const hintItemId = input.hint?.hint_item_id ?? null;
	const ranked = eligible
		.map((entry) => ({
			...entry,
			hinted: hintItemId !== null && entry.item.item_id === hintItemId,
			path_score: loginPathScore(entry.item, input.login_path),
		}))
		.sort((a, b) => {
			if (a.hinted !== b.hinted) return a.hinted ? -1 : 1;
			if (a.path_score !== b.path_score) return b.path_score - a.path_score;
			return a.item.item_id < b.item.item_id ? -1 : 1;
		});
	return {
		kind: "ambiguous-selection",
		blocked_cause: "ambiguous-binding-selection",
		continuation: continuationOf("ambiguous-binding-selection"),
		selection: ranked.map((entry, index) => ({
			item_id: entry.item.item_id,
			rank: index + 1,
			hinted: entry.hinted,
			matched_origin: entry.matched_origin,
		})),
	};
}

// --- Candidate import (batch; SD2/SD3/SD4) --------------------------------------

/** One legacy origin proposal; authorization always needs a grant (SD2). */
export type BrowserUseOriginProposal = {
	origin: string;
	provenance: "legacy-import";
	requires_grant: true;
};

/** Per-candidate import disposition. */
export type BrowserUseCandidateImportDisposition =
	| {
			kind: "bound";
			binding: BrowserUseItemBinding;
			/** Legacy-only origins land here, never in allowed_origins (SD2). */
			origin_proposals: readonly BrowserUseOriginProposal[];
	  }
	| Extract<
			BrowserUseBindingMatchResult,
			{ kind: "missing-item" } | { kind: "ambiguous-selection" }
	  >;

/** One result per input candidate, order preserved. */
export type BrowserUseCandidateImportResult =
	| {
			candidate_id: string | null;
			ok: true;
			disposition: BrowserUseCandidateImportDisposition;
	  }
	| {
			candidate_id: string | null;
			ok: false;
			rejection: {
				code:
					| "secret-positive-candidate"
					| "candidate-shape-invalid"
					/** The batch input was invalid; the candidate was never evaluated. */
					| "import-input-invalid";
				candidate_id: string | null;
				message: string;
			};
	  };

/**
 * Import a batch of untrusted candidates against live vault evidence: screen
 * each (SD3), normalize its proposed origins, then run the single-owner
 * match policy with the normalized proposals as targets. A refused candidate
 * never blocks its siblings; results preserve input order.
 *
 * @param input - Untrusted candidates plus the proven vault's live evidence
 * @returns One result per candidate, in order
 */
export function importCandidates(input: {
	candidates: readonly unknown[];
	service_account_id: string;
	vault_id: string;
	items: readonly BrowserUseVaultItemEvidence[];
}): readonly BrowserUseCandidateImportResult[] {
	// An invalid batch vault_id would make matchItemBinding refuse every
	// candidate as match_input_invalid and misblame candidate shape; name the
	// batch input as the cause instead of evaluating anything.
	if (typeof input.vault_id !== "string" || input.vault_id.length === 0) {
		return input.candidates.map((raw): BrowserUseCandidateImportResult => {
			const candidateId = candidateIdOf(raw);
			return {
				candidate_id: candidateId,
				ok: false,
				rejection: {
					code: "import-input-invalid",
					candidate_id: candidateId,
					message: "import input invalid (vault_id); no candidate was evaluated.",
				},
			};
		});
	}
	return input.candidates.map((raw): BrowserUseCandidateImportResult => {
		const screened = screenImportCandidate(raw);
		if (!screened.ok) {
			return {
				candidate_id: screened.rejection.candidate_id,
				ok: false,
				rejection: screened.rejection,
			};
		}
		const candidate = screened.candidate;
		const normalizedOrigins: string[] = [];
		for (const rawOrigin of candidate.proposed_origins) {
			const normalized = normalizeOrigin(rawOrigin);
			if (!normalized.ok) {
				return {
					candidate_id: candidate.candidate_id,
					ok: false,
					rejection: {
						code: "candidate-shape-invalid",
						candidate_id: candidate.candidate_id,
						message:
							"candidate shape invalid (origin_unparseable at candidate.proposed_origins).",
					},
				};
			}
			if (!normalizedOrigins.includes(normalized.origin)) {
				normalizedOrigins.push(normalized.origin);
			}
		}
		const match = matchItemBinding({
			service_id: candidate.service_id,
			service_account_id: input.service_account_id,
			auth_context: candidate.auth_context,
			target_origins: normalizedOrigins,
			login_path: null,
			vault_id: input.vault_id,
			items: input.items,
			hint: {
				hint_item_id: candidate.hint_item_id,
				legacy_vault_name: candidate.legacy_vault_name,
			},
		});
		if (match.kind === "refused") {
			return {
				candidate_id: candidate.candidate_id,
				ok: false,
				rejection: {
					code: "candidate-shape-invalid",
					candidate_id: candidate.candidate_id,
					message: `candidate shape invalid (${match.rejection.code}).`,
				},
			};
		}
		if (match.kind === "bound") {
			const proposals = normalizedOrigins
				.filter((origin) => !match.binding.allowed_origins.includes(origin))
				.map(
					(origin): BrowserUseOriginProposal => ({
						origin,
						provenance: "legacy-import",
						requires_grant: true,
					}),
				);
			return {
				candidate_id: candidate.candidate_id,
				ok: true,
				disposition: {
					kind: "bound",
					binding: match.binding,
					origin_proposals: proposals,
				},
			};
		}
		return {
			candidate_id: candidate.candidate_id,
			ok: true,
			disposition: match,
		};
	});
}

// --- Binding liveness + method admission (R11, R13) -----------------------------

/** One live item fact; null means absent from the token-scoped vault. */
export type BrowserUseLiveItemFact = {
	item: BrowserUseVaultItemEvidence | null;
};

/** Usability result: usable, or blocked revoked-binding with a stale state. */
export type BrowserUseBindingUsability =
	| { usable: true; binding: BrowserUseItemBinding }
	| {
			usable: false;
			stale_state: BrowserUseBindingStaleState;
			blocked_cause: Extract<BrowserUseAuthBlockedCause, "revoked-binding">;
			continuation: BrowserUseAuthContinuation;
	  };

function staleUsability(
	staleState: BrowserUseBindingStaleState,
): BrowserUseBindingUsability {
	return {
		usable: false,
		stale_state: staleState,
		blocked_cause: "revoked-binding",
		continuation: continuationOf("revoked-binding"),
	};
}

/**
 * Assess one binding against a live exact-item read (R11): null item is
 * deleted, an item-id or vault mismatch is moved, a non-active state is that
 * state. Never proposes a replacement — repair is a human continuation.
 *
 * @param binding - The approved Item Binding
 * @param live - The exact live read for binding.item_id
 * @returns Usable binding, or the revoked-binding blocked state
 */
export function assessBindingUsability(
	binding: BrowserUseItemBinding,
	live: BrowserUseLiveItemFact,
): BrowserUseBindingUsability {
	if (live.item === null) return staleUsability("deleted");
	// The read must be for the bound item itself; a different active item that
	// happens to share origins never substitutes for it (R11).
	if (live.item.item_id !== binding.item_id) return staleUsability("moved");
	if (live.item.vault_id !== binding.vault_id) return staleUsability("moved");
	if (live.item.item_revision !== binding.item_revision) {
		return staleUsability("revision-changed");
	}
	if (live.item.state !== "active") return staleUsability(live.item.state);
	// KTD11/SD2 derivation check: every cached allowed_origin must re-derive
	// from the live evidence — a cache edit that widens the origin set fails
	// closed as out-of-scope. Grant-approved origin aliases are excepted once
	// PR2 wires origin-expansion grants; in PR1 no alias authority exists.
	const liveOrigins = live.item.origins;
	for (const origin of binding.allowed_origins) {
		if (!liveOrigins.includes(origin)) return staleUsability("out-of-scope");
	}
	return { usable: true, binding };
}

/**
 * Admit one lane auth method against a binding (R13/D5): session-reuse is
 * always admissible; user-presence is unrepresentable as a binding method
 * and blocks unsupported-method; password/otp admit only when the binding
 * lists them.
 *
 * @param binding - The approved Item Binding, or null when none exists
 * @param method - The lane auth method the run requests
 * @returns Admission, or the unsupported-method blocked state
 */
export function assessBindingMethod(
	binding: BrowserUseItemBinding | null,
	method: BrowserUseLaneAuthMethod,
):
	| { ok: true }
	| {
			ok: false;
			blocked_cause: Extract<BrowserUseAuthBlockedCause, "unsupported-method">;
			continuation: BrowserUseAuthContinuation;
	  } {
	if (method === "session-reuse") return { ok: true };
	if (
		method !== "user-presence" &&
		binding !== null &&
		binding.allowed_auth_methods.includes(method)
	) {
		return { ok: true };
	}
	return {
		ok: false,
		blocked_cause: "unsupported-method",
		continuation: continuationOf("unsupported-method"),
	};
}
