// ---------------------------------------------------------------------------
// Browser Authentication Transaction model (auth plan 2026-07-21-003 U2,
// R6, R14-R21, R27-R30; AE4-AE6, AE11).
//
// The ONE owner of the auth-side vocabulary: transaction phases, method
// steps, blocked causes with exactly one code-owned continuation and one
// platform run-state mapping each, the secret-free versioned fragment schema
// the platform stores opaquely (R6), and the bounded auth attestation record
// plus its deterministic digest (R30). Pure model + admission only — the
// transition engine lives in browser-use-auth-transaction.ts and the
// integration-Port facade in browser-use-auth.ts. Leaf-adjacent module:
// imports node:crypto and the U1 lane model only, so the transaction engine,
// postconditions, and facade all derive from it without cycles. No Date.now,
// no Math.random; time enters only through event payloads.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import {
	type BrowserUseAdapterLaneId,
	type BrowserUseLaneAuthMethod,
	BROWSER_USE_ADAPTER_LANE_IDS,
	BROWSER_USE_LANE_AUTH_METHODS,
} from "./browser-use-adapter-model";

// --- Fragment schema identity (R6) --------------------------------------------

/**
 * The versioned schema id the platform's opaque fragment slot carries. The
 * platform stores the fragment verbatim and never introspects beyond this
 * version; every admission rule below is auth-owned.
 */
export const BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION =
	"browser-use-auth-fragment/1";

// --- Transaction phases (U2 approach, KTD1) ------------------------------------

/**
 * The ordered transaction phases (KTD1): one deep transaction, never prose
 * choreography. `terminal` is reached only through `bounded-attestation`
 * (authenticated) or a cancel truth from any phase.
 */
export const BROWSER_USE_AUTH_PHASES = [
	"pre-auth-proof",
	"secret-free-preparation",
	"lease-request",
	"sensitive-interval",
	"write-ahead-submission",
	"cleanup",
	"post-auth-proof",
	"bounded-attestation",
	"terminal",
] as const;

/** Transaction phase union. */
export type BrowserUseAuthPhase = (typeof BROWSER_USE_AUTH_PHASES)[number];

/** Fragment status: exactly one of active, blocked, or terminal. */
export const BROWSER_USE_AUTH_STATUSES = [
	"active",
	"blocked",
	"terminal",
] as const;

/** Fragment status union. */
export type BrowserUseAuthStatus = (typeof BROWSER_USE_AUTH_STATUSES)[number];

// --- Method steps inside the sensitive interval (R15) ---------------------------

/**
 * Ordered method steps of the sensitive interval (R15): identify state,
 * select account context, username, username submit, re-prove origin/page/
 * frame immediately before the password (R14/AE4), password, and the OTP
 * step entered only when the submit outcome demands it (R12: current OTP
 * just in time, never a seed).
 */
export const BROWSER_USE_AUTH_METHOD_STEPS = [
	"identify-auth-state",
	"select-account-context",
	"fill-username",
	"submit-username",
	"reprove-target",
	"fill-password",
	"fill-otp",
] as const;

/** Method step union. */
export type BrowserUseAuthMethodStep =
	(typeof BROWSER_USE_AUTH_METHOD_STEPS)[number];

// --- Submit outcomes (R19) ------------------------------------------------------

/**
 * Post-submission outcome classes (R19): each is a distinct truth, never a
 * retry hint. `timeout-unknown` means the external effect is unknown — the
 * transaction never re-enters the credential after it (AE6).
 */
export const BROWSER_USE_AUTH_SUBMIT_OUTCOMES = [
	"success",
	"otp-required",
	"wrong-password",
	"wrong-otp",
	"lockout",
	"rate-limit",
	"challenge-escalation",
	"timeout-unknown",
] as const;

/** Submit outcome union. */
export type BrowserUseAuthSubmitOutcome =
	(typeof BROWSER_USE_AUTH_SUBMIT_OUTCOMES)[number];

// --- Blocked causes and continuations (R21, AE11) -------------------------------

/**
 * Typed blocked causes (R21 plus the plan's named scenarios): every blocked
 * fragment carries exactly one of these and exactly one continuation. The
 * competing-agent wait (AE11) is `lease-unavailable`; stale refs, target or
 * page replacement fold into `target-proof-invalid` (R14) because their safe
 * continuation is identical — re-prove and restart before any delivery.
 */
export const BROWSER_USE_AUTH_BLOCKED_CAUSES = [
	"missing-token",
	"invalid-vault-scope",
	"binding-approval-required",
	"ambiguous-binding-selection",
	"revoked-binding",
	"lease-unavailable",
	"unsupported-method",
	"user-presence-required",
	"challenge-escalation",
	"origin-mismatch",
	"target-proof-invalid",
	"capability-loss",
	"wrong-password",
	"wrong-otp",
	"lockout",
	"rate-limit",
	"session-identity-proof-unavailable",
	"human-identity-attestation-required",
	"freeform-identity-proof-required",
	"submit-approval-required",
	"cleanup-failure",
	"adapter-crash",
	"unknown-post-submit-state",
] as const;

/** Blocked cause union. */
export type BrowserUseAuthBlockedCause =
	(typeof BROWSER_USE_AUTH_BLOCKED_CAUSES)[number];

/**
 * Platform blocked run states an auth outcome may name (R6): the exact
 * blocked subset of the shared run vocabulary. Auth never produces task
 * truth (`running`, `confirmed`, `not-achieved`, `unknown`).
 */
export type BrowserUseAuthBlockedRunState =
	| "awaiting-auth"
	| "awaiting-approval"
	| "awaiting-user-presence"
	| "needs-human";

/** Exactly-one next safe action carried by a blocked fragment (R21). */
export type BrowserUseAuthContinuation = {
	next_action_id: string;
	summary: string;
};

/**
 * Code-owned cause table (R21): each blocked cause maps to exactly one
 * platform blocked run state and exactly one continuation. One owner — the
 * commit summary and the fragment invariant both read this table, so a cause
 * can never carry two different next safe actions.
 */
export const BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE: Readonly<
	Record<
		BrowserUseAuthBlockedCause,
		{ run_state: BrowserUseAuthBlockedRunState; continuation: BrowserUseAuthContinuation }
	>
> = {
	"missing-token": {
		run_state: "awaiting-auth",
		continuation: {
			next_action_id: "enroll-browser-automation-token",
			summary: "Enroll or repair the Browser Automation service-account token.",
		},
	},
	"invalid-vault-scope": {
		run_state: "awaiting-auth",
		continuation: {
			next_action_id: "repair-vault-grant",
			summary: "Repair the token's vault grant to exactly one visible vault.",
		},
	},
	"binding-approval-required": {
		run_state: "awaiting-approval",
		continuation: {
			next_action_id: "request-binding-selection-grant",
			summary:
				"Request approval before binding the service and auth context to one login item.",
		},
	},
	"ambiguous-binding-selection": {
		run_state: "awaiting-approval",
		continuation: {
			next_action_id: "request-binding-selection-grant",
			summary: "Request a signed one-use grant to select one login item.",
		},
	},
	"revoked-binding": {
		run_state: "awaiting-auth",
		continuation: {
			next_action_id: "repair-item-binding",
			summary: "Repair the revoked or moved item binding; never rescan silently.",
		},
	},
	"lease-unavailable": {
		run_state: "awaiting-auth",
		continuation: {
			next_action_id: "wait-for-lease-holder",
			summary: "Wait for the sensitive-interval lease holder to release or expire.",
		},
	},
	"unsupported-method": {
		run_state: "needs-human",
		continuation: {
			next_action_id: "choose-supported-auth-method",
			summary: "The lane advertises no conformance for this method; choose another.",
		},
	},
	"user-presence-required": {
		run_state: "awaiting-user-presence",
		continuation: {
			next_action_id: "complete-user-presence",
			summary: "Complete the passkey, biometric, CAPTCHA, or consent step.",
		},
	},
	"challenge-escalation": {
		run_state: "awaiting-user-presence",
		continuation: {
			next_action_id: "complete-escalated-challenge",
			summary: "Complete the escalated challenge; resume needs fresh target proof.",
		},
	},
	"origin-mismatch": {
		run_state: "needs-human",
		continuation: {
			next_action_id: "inspect-origin-mismatch",
			summary: "An unapproved origin was observed before delivery; inspect it.",
		},
	},
	"target-proof-invalid": {
		run_state: "awaiting-auth",
		continuation: {
			next_action_id: "reprove-target-and-restart",
			summary: "Target, page, or field proof went stale; re-prove and restart.",
		},
	},
	"capability-loss": {
		run_state: "needs-human",
		continuation: {
			next_action_id: "inspect-capability-loss",
			summary: "A required lane capability claim was lost; inspect lane evidence.",
		},
	},
	"wrong-password": {
		run_state: "needs-human",
		continuation: {
			next_action_id: "approve-credential-retry",
			summary: "The password was rejected; a human must approve any retry.",
		},
	},
	"wrong-otp": {
		run_state: "needs-human",
		continuation: {
			next_action_id: "approve-credential-retry",
			summary: "The OTP was rejected; a human must approve any retry.",
		},
	},
	lockout: {
		run_state: "needs-human",
		continuation: {
			next_action_id: "inspect-lockout",
			summary: "The identity provider reported lockout; no retry is safe.",
		},
	},
	"rate-limit": {
		run_state: "needs-human",
		continuation: {
			next_action_id: "inspect-rate-limit",
			summary: "The identity provider throttled attempts; no retry is safe.",
		},
	},
	"session-identity-proof-unavailable": {
		run_state: "awaiting-approval",
		continuation: {
			next_action_id: "request-human-identity-attestation",
			summary: "Bounded inspection could not prove identity; request attestation.",
		},
	},
	"human-identity-attestation-required": {
		run_state: "awaiting-user-presence",
		continuation: {
			next_action_id: "complete-human-identity-attestation",
			summary: "Complete the Touch ID-backed one-run identity attestation.",
		},
	},
	"freeform-identity-proof-required": {
		run_state: "needs-human",
		continuation: {
			next_action_id: "use-reviewed-runbook-for-auth",
			summary:
				"Freeform login cannot complete identity attestation; re-run this portal through a reviewed runbook.",
		},
	},
	"submit-approval-required": {
		run_state: "awaiting-approval",
		continuation: {
			next_action_id: "complete-submit-approval",
			summary:
				"Review the captured screenshot, then approve the timesheet submit.",
		},
	},
	"cleanup-failure": {
		run_state: "needs-human",
		continuation: {
			next_action_id: "repair-cleanup-failure",
			summary: "Field clearing or observer restore failed; repair before resume.",
		},
	},
	"adapter-crash": {
		run_state: "needs-human",
		continuation: {
			next_action_id: "inspect-adapter-crash",
			summary: "The selected lane crashed mid-transaction; inspect before resume.",
		},
	},
	"unknown-post-submit-state": {
		run_state: "needs-human",
		continuation: {
			next_action_id: "inspect-post-submit-state",
			summary: "Submission effect is unknown; inspect the same lane, never retry.",
		},
	},
};

// --- Terminal outcomes ----------------------------------------------------------

/**
 * Transaction terminal truths. Credential failures stay blocked with a human
 * continuation (R19); the only terminal truths are an authenticated outcome
 * carrying its bounded attestation and a cancel with honest external-effect
 * classification (R37 — cancellation never claims rollback).
 */
export const BROWSER_USE_AUTH_TERMINAL_OUTCOMES = [
	"authenticated",
	"cancelled",
] as const;

/** Terminal outcome union. */
export type BrowserUseAuthTerminalOutcome =
	(typeof BROWSER_USE_AUTH_TERMINAL_OUTCOMES)[number];

/** External-effect truth (R19/R37). */
export const BROWSER_USE_AUTH_EXTERNAL_EFFECTS = [
	"none",
	"possible",
	"unknown",
] as const;

/** External-effect union. */
export type BrowserUseAuthExternalEffect =
	(typeof BROWSER_USE_AUTH_EXTERNAL_EFFECTS)[number];

/** Identity basis vocabulary (R30): exactly one, never both, never neither. */
export const BROWSER_USE_AUTH_IDENTITY_BASES = [
	"session-identity-proof",
	"human-identity-attestation",
] as const;

/** Identity basis union. */
export type BrowserUseAuthIdentityBasis =
	(typeof BROWSER_USE_AUTH_IDENTITY_BASES)[number];

// --- The secret-free transaction fragment (R6) ----------------------------------

/**
/**
 * The two Browser Authentication Transaction entry modes (R14). Owned here as
 * auth-side vocabulary so the fragment binding can record which mode wrote it
 * without a cycle back to the transaction driver.
 */
export const BROWSER_USE_AUTH_ENTRY_MODES = [
	"reviewed-runbook",
	"freeform",
] as const;

export type BrowserUseAuthEntryMode =
	(typeof BROWSER_USE_AUTH_ENTRY_MODES)[number];

/**
 * Identity bindings fixed at transaction start (R1/R14): the handoff, lane,
 * environment/profile, service/auth-context, approved origin, the entry mode
 * that owns the fragment, and the current target/page/frame identity strings.
 * Identity references only — no endpoint, selector, or secret is legal here.
 *
 * `entry_mode` is a single-writer fingerprint: a persisted fragment can only
 * be resumed by a transaction of the same mode, so a freeform login and a
 * reviewed-runbook run on the same run/service/target never resume each
 * other's state.
 */
export type BrowserUseAuthTransactionBinding = {
	run_id: string;
	handoff_evidence_id: string;
	lane_id: BrowserUseAdapterLaneId;
	entry_mode: BrowserUseAuthEntryMode;
	environment: string;
	profile: string;
	service_id: string;
	auth_context: string;
	origin: string;
	target_id: string;
	page_id: string;
	frame_id: string;
};

/**
 * Credential attempt budget (R19): keyed by binding, expected principal,
 * and identity-provider origin so a second profile racing the same
 * principal shares the budget. Consumed at write-ahead submission.
 */
export type BrowserUseAuthAttemptBudget = {
	budget_key: string;
	limit: number;
	consumed: number;
};

/**
 * The pure, secret-free, versioned transaction fragment (R6, KTD10). The
 * platform persists it opaquely inside the shared run; every field is an
 * identity reference, enum, count, or bounded summary — a raw secret has no
 * legal slot, and `validateSecretFreeAuthFragment` proves it mechanically.
 */
export type BrowserUseAuthTransactionFragment = {
	schema_version: typeof BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION;
	fragment_revision: number;
	phase: BrowserUseAuthPhase;
	status: BrowserUseAuthStatus;
	method: BrowserUseLaneAuthMethod;
	method_step: BrowserUseAuthMethodStep | null;
	binding: BrowserUseAuthTransactionBinding;
	attempt: BrowserUseAuthAttemptBudget;
	/** Write-ahead truth (R19): persisted before delivery-helper submission. */
	submission_started: boolean;
	external_effect: BrowserUseAuthExternalEffect;
	submit_outcome: BrowserUseAuthSubmitOutcome | null;
	blocked_cause: BrowserUseAuthBlockedCause | null;
	continuation: BrowserUseAuthContinuation | null;
	terminal_outcome: BrowserUseAuthTerminalOutcome | null;
	identity_basis: BrowserUseAuthIdentityBasis | null;
	identity_basis_digest: string | null;
	attestation_digest: string | null;
	fresh_until_epoch_ms: number | null;
};

/** The exact top-level fragment key set — schema extensions fail admission. */
export const BROWSER_USE_AUTH_FRAGMENT_KEYS = [
	"schema_version",
	"fragment_revision",
	"phase",
	"status",
	"method",
	"method_step",
	"binding",
	"attempt",
	"submission_started",
	"external_effect",
	"submit_outcome",
	"blocked_cause",
	"continuation",
	"terminal_outcome",
	"identity_basis",
	"identity_basis_digest",
	"attestation_digest",
	"fresh_until_epoch_ms",
] as const satisfies readonly (keyof BrowserUseAuthTransactionFragment)[];

/** The exact binding key set. */
export const BROWSER_USE_AUTH_BINDING_KEYS = [
	"run_id",
	"handoff_evidence_id",
	"lane_id",
	"entry_mode",
	"environment",
	"profile",
	"service_id",
	"auth_context",
	"origin",
	"target_id",
	"page_id",
	"frame_id",
] as const satisfies readonly (keyof BrowserUseAuthTransactionBinding)[];

/** The exact attempt-budget key set. */
export const BROWSER_USE_AUTH_ATTEMPT_KEYS = [
	"budget_key",
	"limit",
	"consumed",
] as const satisfies readonly (keyof BrowserUseAuthAttemptBudget)[];

/** The exact continuation key set. */
export const BROWSER_USE_AUTH_CONTINUATION_KEYS = [
	"next_action_id",
	"summary",
] as const satisfies readonly (keyof BrowserUseAuthContinuation)[];

// --- Fragment admission (R6) ----------------------------------------------------

/** One typed fragment admission issue. */
export type BrowserUseAuthFragmentIssue = {
	code:
		| "fragment_schema_version_unknown"
		| "fragment_key_set_invalid"
		| "fragment_field_invalid"
		| "fragment_value_secret_shaped"
		| "fragment_invariant_violated";
	path: string;
	message: string;
};

// Bounded string admission: identity references and summaries are short; a
// long or secret-shaped value has no legal purpose in a secret-free fragment.
const MAX_FRAGMENT_STRING_LENGTH = 256;
const SECRET_SHAPED_PATTERNS = [/op:\/\//i, /wss?:\/\//i];

function stringIssueAt(
	path: string,
	value: unknown,
): BrowserUseAuthFragmentIssue | undefined {
	if (typeof value !== "string" || value.length === 0) {
		return {
			code: "fragment_field_invalid",
			path,
			message: "expected a non-empty string.",
		};
	}
	if (value.length > MAX_FRAGMENT_STRING_LENGTH) {
		return {
			code: "fragment_value_secret_shaped",
			path,
			message: "string exceeds the bounded fragment length.",
		};
	}
	for (const pattern of SECRET_SHAPED_PATTERNS) {
		if (pattern.test(value)) {
			return {
				code: "fragment_value_secret_shaped",
				path,
				message: "string carries a secret-shaped reference.",
			};
		}
	}
	return undefined;
}

function countIssueAt(
	path: string,
	value: unknown,
): BrowserUseAuthFragmentIssue | undefined {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 0
	) {
		return {
			code: "fragment_field_invalid",
			path,
			message: "expected a non-negative safe integer.",
		};
	}
	return undefined;
}

function keySetIssue(
	path: string,
	value: object,
	expected: readonly string[],
): BrowserUseAuthFragmentIssue | undefined {
	const actual = Object.keys(value);
	const expectedSet = new Set<string>(expected);
	for (const key of actual) {
		if (!expectedSet.has(key)) {
			return {
				code: "fragment_key_set_invalid",
				path: `${path}.${key}`,
				message: "unknown fragment key; schema extensions fail admission.",
			};
		}
	}
	for (const key of expected) {
		if (!actual.includes(key)) {
			return {
				code: "fragment_key_set_invalid",
				path: `${path}.${key}`,
				message: "required fragment key is missing.",
			};
		}
	}
	return undefined;
}

function isMemberOf(
	vocabulary: readonly string[],
	value: unknown,
): value is string {
	return typeof value === "string" && vocabulary.includes(value);
}

function nullableMemberIssue(
	path: string,
	value: unknown,
	vocabulary: readonly string[],
): BrowserUseAuthFragmentIssue | undefined {
	if (value === null || isMemberOf(vocabulary, value)) return undefined;
	return {
		code: "fragment_field_invalid",
		path,
		message: "expected null or a known vocabulary member.",
	};
}

/**
 * Admit one candidate fragment against the exact schema (R6): bidirectional
 * key sets at every level, vocabulary membership, bounded secret-shape-free
 * strings, non-negative safe-integer counts, and the cross-field invariants
 * (blocked ⟺ exactly one cause + the cause's one continuation; terminal ⟺
 * one terminal outcome; authenticated ⟹ attestation + exactly one identity
 * basis; write-ahead ordering). Fail-closed: any malformed shape returns
 * typed issues, never a crash.
 *
 * @param value - Untrusted candidate fragment (decoded storage or caller input)
 * @returns Empty array when the fragment is admissible
 */
export function validateAuthFragmentShape(
	value: unknown,
): BrowserUseAuthFragmentIssue[] {
	const issues: BrowserUseAuthFragmentIssue[] = [];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [
			{
				code: "fragment_field_invalid",
				path: "fragment",
				message: "expected a plain fragment object.",
			},
		];
	}
	const keyIssue = keySetIssue("fragment", value, BROWSER_USE_AUTH_FRAGMENT_KEYS);
	if (keyIssue !== undefined) return [keyIssue];
	const candidate = value as Record<string, unknown>;

	if (candidate.schema_version !== BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION) {
		issues.push({
			code: "fragment_schema_version_unknown",
			path: "fragment.schema_version",
			message: "unknown auth fragment schema version.",
		});
	}
	const revisionIssue = countIssueAt(
		"fragment.fragment_revision",
		candidate.fragment_revision,
	);
	if (revisionIssue !== undefined) issues.push(revisionIssue);
	if (!isMemberOf(BROWSER_USE_AUTH_PHASES, candidate.phase)) {
		issues.push({
			code: "fragment_field_invalid",
			path: "fragment.phase",
			message: "unknown transaction phase.",
		});
	}
	if (!isMemberOf(BROWSER_USE_AUTH_STATUSES, candidate.status)) {
		issues.push({
			code: "fragment_field_invalid",
			path: "fragment.status",
			message: "unknown fragment status.",
		});
	}
	if (!isMemberOf(BROWSER_USE_LANE_AUTH_METHODS, candidate.method)) {
		issues.push({
			code: "fragment_field_invalid",
			path: "fragment.method",
			message: "unknown auth method.",
		});
	}
	const methodStepIssue = nullableMemberIssue(
		"fragment.method_step",
		candidate.method_step,
		BROWSER_USE_AUTH_METHOD_STEPS,
	);
	if (methodStepIssue !== undefined) issues.push(methodStepIssue);

	// binding
	const binding = candidate.binding;
	if (typeof binding !== "object" || binding === null || Array.isArray(binding)) {
		issues.push({
			code: "fragment_field_invalid",
			path: "fragment.binding",
			message: "expected a binding object.",
		});
	} else {
		const bindingKeyIssue = keySetIssue(
			"fragment.binding",
			binding,
			BROWSER_USE_AUTH_BINDING_KEYS,
		);
		if (bindingKeyIssue !== undefined) {
			issues.push(bindingKeyIssue);
		} else {
			const bindingRecord = binding as Record<string, unknown>;
			for (const key of BROWSER_USE_AUTH_BINDING_KEYS) {
				if (key === "lane_id" || key === "entry_mode") continue;
				const issue = stringIssueAt(`fragment.binding.${key}`, bindingRecord[key]);
				if (issue !== undefined) issues.push(issue);
			}
			if (!isMemberOf(BROWSER_USE_ADAPTER_LANE_IDS, bindingRecord.lane_id)) {
				issues.push({
					code: "fragment_field_invalid",
					path: "fragment.binding.lane_id",
					message: "unknown adapter lane id.",
				});
			}
			if (!isMemberOf(BROWSER_USE_AUTH_ENTRY_MODES, bindingRecord.entry_mode)) {
				issues.push({
					code: "fragment_field_invalid",
					path: "fragment.binding.entry_mode",
					message: "unknown auth entry mode.",
				});
			}
		}
	}

	// attempt
	const attempt = candidate.attempt;
	if (typeof attempt !== "object" || attempt === null || Array.isArray(attempt)) {
		issues.push({
			code: "fragment_field_invalid",
			path: "fragment.attempt",
			message: "expected an attempt-budget object.",
		});
	} else {
		const attemptKeyIssue = keySetIssue(
			"fragment.attempt",
			attempt,
			BROWSER_USE_AUTH_ATTEMPT_KEYS,
		);
		if (attemptKeyIssue !== undefined) {
			issues.push(attemptKeyIssue);
		} else {
			const attemptRecord = attempt as Record<string, unknown>;
			const budgetKeyIssue = stringIssueAt(
				"fragment.attempt.budget_key",
				attemptRecord.budget_key,
			);
			if (budgetKeyIssue !== undefined) issues.push(budgetKeyIssue);
			for (const key of ["limit", "consumed"] as const) {
				const issue = countIssueAt(`fragment.attempt.${key}`, attemptRecord[key]);
				if (issue !== undefined) issues.push(issue);
			}
			if (
				typeof attemptRecord.limit === "number" &&
				typeof attemptRecord.consumed === "number" &&
				Number.isSafeInteger(attemptRecord.limit) &&
				Number.isSafeInteger(attemptRecord.consumed) &&
				attemptRecord.consumed > attemptRecord.limit
			) {
				issues.push({
					code: "fragment_invariant_violated",
					path: "fragment.attempt.consumed",
					message: "consumed attempts exceed the budget limit.",
				});
			}
		}
	}

	if (typeof candidate.submission_started !== "boolean") {
		issues.push({
			code: "fragment_field_invalid",
			path: "fragment.submission_started",
			message: "expected a boolean write-ahead marker.",
		});
	}
	if (!isMemberOf(BROWSER_USE_AUTH_EXTERNAL_EFFECTS, candidate.external_effect)) {
		issues.push({
			code: "fragment_field_invalid",
			path: "fragment.external_effect",
			message: "unknown external-effect truth.",
		});
	}
	const submitOutcomeIssue = nullableMemberIssue(
		"fragment.submit_outcome",
		candidate.submit_outcome,
		BROWSER_USE_AUTH_SUBMIT_OUTCOMES,
	);
	if (submitOutcomeIssue !== undefined) issues.push(submitOutcomeIssue);
	const blockedCauseIssue = nullableMemberIssue(
		"fragment.blocked_cause",
		candidate.blocked_cause,
		BROWSER_USE_AUTH_BLOCKED_CAUSES,
	);
	if (blockedCauseIssue !== undefined) issues.push(blockedCauseIssue);

	// continuation
	const continuation = candidate.continuation;
	if (continuation !== null) {
		if (
			typeof continuation !== "object" ||
			continuation === undefined ||
			Array.isArray(continuation)
		) {
			issues.push({
				code: "fragment_field_invalid",
				path: "fragment.continuation",
				message: "expected null or a continuation object.",
			});
		} else {
			const continuationKeyIssue = keySetIssue(
				"fragment.continuation",
				continuation,
				BROWSER_USE_AUTH_CONTINUATION_KEYS,
			);
			if (continuationKeyIssue !== undefined) {
				issues.push(continuationKeyIssue);
			} else {
				const continuationRecord = continuation as Record<string, unknown>;
				for (const key of BROWSER_USE_AUTH_CONTINUATION_KEYS) {
					const issue = stringIssueAt(
						`fragment.continuation.${key}`,
						continuationRecord[key],
					);
					if (issue !== undefined) issues.push(issue);
				}
			}
		}
	}

	const terminalOutcomeIssue = nullableMemberIssue(
		"fragment.terminal_outcome",
		candidate.terminal_outcome,
		BROWSER_USE_AUTH_TERMINAL_OUTCOMES,
	);
	if (terminalOutcomeIssue !== undefined) issues.push(terminalOutcomeIssue);
	const identityBasisIssue = nullableMemberIssue(
		"fragment.identity_basis",
		candidate.identity_basis,
		BROWSER_USE_AUTH_IDENTITY_BASES,
	);
	if (identityBasisIssue !== undefined) issues.push(identityBasisIssue);
	for (const key of ["identity_basis_digest", "attestation_digest"] as const) {
		const value = candidate[key];
		if (value !== null) {
			const issue = stringIssueAt(`fragment.${key}`, value);
			if (issue !== undefined) issues.push(issue);
		}
	}
	if (candidate.fresh_until_epoch_ms !== null) {
		const issue = countIssueAt(
			"fragment.fresh_until_epoch_ms",
			candidate.fresh_until_epoch_ms,
		);
		if (issue !== undefined) issues.push(issue);
	}
	if (issues.length > 0) return issues;

	// Cross-field invariants — checked only over a structurally sound fragment.
	const sound = value as BrowserUseAuthTransactionFragment;
	if (sound.status === "blocked") {
		if (sound.blocked_cause === null || sound.continuation === null) {
			issues.push({
				code: "fragment_invariant_violated",
				path: "fragment.status",
				message: "a blocked fragment requires exactly one cause and continuation.",
			});
		} else {
			const expected =
				BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[sound.blocked_cause].continuation;
			if (
				sound.continuation.next_action_id !== expected.next_action_id ||
				sound.continuation.summary !== expected.summary
			) {
				issues.push({
					code: "fragment_invariant_violated",
					path: "fragment.continuation",
					message: "continuation does not match the cause's code-owned action.",
				});
			}
		}
	} else {
		if (sound.blocked_cause !== null || sound.continuation !== null) {
			issues.push({
				code: "fragment_invariant_violated",
				path: "fragment.blocked_cause",
				message: "only a blocked fragment carries a cause or continuation.",
			});
		}
	}
	if ((sound.status === "terminal") !== (sound.terminal_outcome !== null)) {
		issues.push({
			code: "fragment_invariant_violated",
			path: "fragment.terminal_outcome",
			message: "terminal status and terminal outcome must appear together.",
		});
	}
	if ((sound.status === "terminal") !== (sound.phase === "terminal")) {
		issues.push({
			code: "fragment_invariant_violated",
			path: "fragment.phase",
			message:
				"terminal phase and terminal status must appear together; neither admits the other's absence.",
		});
	}
	if (sound.terminal_outcome === "authenticated") {
		if (
			sound.attestation_digest === null ||
			sound.fresh_until_epoch_ms === null ||
			sound.identity_basis === null ||
			sound.identity_basis_digest === null
		) {
			issues.push({
				code: "fragment_invariant_violated",
				path: "fragment.attestation_digest",
				message:
					"an authenticated outcome requires an attestation and one identity basis.",
			});
		}
	}
	if ((sound.identity_basis === null) !== (sound.identity_basis_digest === null)) {
		issues.push({
			code: "fragment_invariant_violated",
			path: "fragment.identity_basis",
			message: "identity basis and its digest must appear together.",
		});
	}
	if (
		(sound.submission_started || sound.submit_outcome !== null) &&
		sound.external_effect === "none"
	) {
		issues.push({
			code: "fragment_invariant_violated",
			path: "fragment.external_effect",
			message: "after write-ahead submission the external effect is never none.",
		});
	}
	if (
		sound.phase === "write-ahead-submission" &&
		sound.status === "active" &&
		!sound.submission_started
	) {
		issues.push({
			code: "fragment_invariant_violated",
			path: "fragment.submission_started",
			message: "an active write-ahead phase requires the in-flight marker.",
		});
	}
	if (sound.method_step !== null && sound.phase !== "sensitive-interval") {
		issues.push({
			code: "fragment_invariant_violated",
			path: "fragment.method_step",
			message: "method steps exist only inside the sensitive interval.",
		});
	}
	return issues;
}

// --- Bounded auth attestation (R30) ----------------------------------------------

/**
 * The bounded auth attestation record (R30): run/handoff binding, lane and
 * Implementation integrity identity, environment/profile, target/page/frame
 * identity, service and auth context, redacted subject/account/tenant
 * references, exactly one identity basis with its digest, observation time,
 * and freshness bound. Redacted references only — raw identity data never
 * appears here.
 */
export type BrowserUseAuthAttestation = {
	run_id: string;
	handoff_evidence_id: string;
	lane_id: BrowserUseAdapterLaneId;
	implementation_integrity_key: string;
	environment: string;
	profile: string;
	target_id: string;
	page_id: string;
	frame_id: string;
	service_id: string;
	auth_context: string;
	subject_reference: string;
	account_reference: string;
	tenant_reference: string;
	identity_basis: BrowserUseAuthIdentityBasis;
	identity_basis_digest: string;
	observed_at_epoch_ms: number;
	fresh_until_epoch_ms: number;
};

/** The exact attestation key set — the digest covers every field. */
export const BROWSER_USE_AUTH_ATTESTATION_KEYS = [
	"run_id",
	"handoff_evidence_id",
	"lane_id",
	"implementation_integrity_key",
	"environment",
	"profile",
	"target_id",
	"page_id",
	"frame_id",
	"service_id",
	"auth_context",
	"subject_reference",
	"account_reference",
	"tenant_reference",
	"identity_basis",
	"identity_basis_digest",
	"observed_at_epoch_ms",
	"fresh_until_epoch_ms",
] as const satisfies readonly (keyof BrowserUseAuthAttestation)[];

/**
 * Deterministic digest of one bounded auth attestation (R30): canonical JSON
 * array over the exact key set in fixed order, full 64-hex sha256 — the
 * same no-clock no-randomness discipline as the lane evidence digest and the
 * same untruncated form the approval module signs over. The key-set constant
 * drives the canonical array, so a field added to the attestation type can
 * never be silently missed by the digest.
 *
 * @param attestation - Complete attestation record
 * @returns Full 64-hex-char content digest
 */
export function authAttestationDigestOf(
	attestation: BrowserUseAuthAttestation,
): string {
	const canonical = JSON.stringify(
		BROWSER_USE_AUTH_ATTESTATION_KEYS.map((key) => attestation[key]),
	);
	return createHash("sha256").update(canonical).digest("hex");
}
