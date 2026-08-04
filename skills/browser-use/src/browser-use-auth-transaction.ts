// ---------------------------------------------------------------------------
// Browser Authentication Transaction engine (auth plan 2026-07-21-003 U2,
// R14-R19, R21, R29; AE4-AE6, AE11).
//
// The pure transition engine over the U2 fragment: begin, apply one typed
// event, resume after restart, and cancel with honest external-effect truth.
// Deterministic and secret-free — events carry identity references and
// outcome classifications, never values; time enters only through event
// payloads. Every illegal (phase, event) pair is a typed rejection that
// leaves the input fragment untouched; every blocked state carries exactly
// one code-owned continuation (R21). Persistence is the platform's job: the
// facade in browser-use-auth.ts maps fragments onto the run integration
// Port; nothing here touches a store.
//
// Marker semantics: `method_step` is the LAST COMPLETED step inside the
// sensitive interval (null = none yet); `submission_started` is the
// in-flight write-ahead marker — true from dispatch until an outcome is
// observed, so a restart that finds it true blocks as unknown post-submit
// state with the attempt already consumed (R19).
// ---------------------------------------------------------------------------

import type { BrowserUseLaneAuthMethod } from "./browser-use-adapter-model";
import {
	type BrowserUseAuthBlockedCause,
	type BrowserUseAuthIdentityBasis,
	type BrowserUseAuthMethodStep,
	type BrowserUseAuthPhase,
	type BrowserUseAuthSubmitOutcome,
	type BrowserUseAuthTransactionBinding,
	type BrowserUseAuthTransactionFragment,
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
	BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
	validateAuthFragmentShape,
} from "./browser-use-auth-model";

// --- Events (R14-R19) -----------------------------------------------------------

/**
 * Typed transaction events. Identity references and outcome classes only —
 * an event can never carry a secret value; the delivery helper acts outside
 * this model and reports classifications back into it.
 */
export type BrowserUseAuthTransactionEvent =
	| { type: "pre-auth-proved" }
	| { type: "session-already-authenticated" }
	| { type: "preparation-complete" }
	| { type: "lease-granted" }
	| { type: "lease-unavailable" }
	| { type: "method-step-complete"; step: BrowserUseAuthMethodStep }
	| { type: "submission-dispatched" }
	| { type: "submit-outcome-observed"; outcome: BrowserUseAuthSubmitOutcome }
	| { type: "cleanup-complete" }
	| { type: "cleanup-failed" }
	| {
			type: "postcondition-proven";
			identity_basis: BrowserUseAuthIdentityBasis;
			identity_basis_digest: string;
	  }
	| { type: "postcondition-unproven" }
	| {
			type: "attestation-issued";
			attestation_digest: string;
			fresh_until_epoch_ms: number;
	  }
	| { type: "blocked"; cause: BrowserUseAuthBlockedCause }
	| { type: "blocked-cause-resolved" }
	| { type: "human-retry-approved" }
	| { type: "cancel" };

/** Typed transition rejection codes. */
export type BrowserUseAuthTransitionRejectionCode =
	| "auth_fragment_invalid"
	| "auth_phase_illegal"
	| "auth_step_out_of_order"
	| "auth_blocked_cause_illegal"
	| "auth_blocked_requires_resolution"
	| "auth_cause_not_resolvable"
	| "auth_submission_requires_inspection"
	| "auth_retry_requires_human"
	| "auth_attempt_budget_exhausted"
	| "auth_fragment_terminal";

/** One typed transition rejection. */
export type BrowserUseAuthTransitionRejection = {
	code: BrowserUseAuthTransitionRejectionCode;
	message: string;
};

/** Transition result: the next fragment value, or one typed rejection. */
export type BrowserUseAuthTransitionResult =
	| { ok: true; fragment: BrowserUseAuthTransactionFragment }
	| { ok: false; rejection: BrowserUseAuthTransitionRejection };

// --- Per-phase legality tables (R14-R19, R21) -------------------------------------

// Event types legal per active phase. `blocked` legality is refined further
// by BLOCK_CAUSES_BY_PHASE; `cancel` is legal from every non-terminal state.
const EVENTS_BY_PHASE: Readonly<
	Record<Exclude<BrowserUseAuthPhase, "terminal">, readonly string[]>
> = {
	"pre-auth-proof": [
		"pre-auth-proved",
		"session-already-authenticated",
		"blocked",
	],
	"secret-free-preparation": ["preparation-complete", "blocked"],
	"lease-request": ["lease-granted", "lease-unavailable", "blocked"],
	"sensitive-interval": [
		"session-already-authenticated",
		"method-step-complete",
		"submission-dispatched",
		"blocked",
	],
	"write-ahead-submission": ["submit-outcome-observed", "blocked"],
	cleanup: ["cleanup-complete", "cleanup-failed", "blocked"],
	"post-auth-proof": [
		"postcondition-proven",
		"postcondition-unproven",
		"blocked",
	],
	"bounded-attestation": ["attestation-issued", "blocked"],
};

// Blocked causes each phase may raise through the generic `blocked` event.
// Causes born from specific events (lease-unavailable, cleanup-failed,
// postcondition-unproven, submit outcomes) are excluded here so they cannot
// be raised out of order.
const BLOCK_CAUSES_BY_PHASE: Readonly<
	Record<
		Exclude<BrowserUseAuthPhase, "terminal">,
		readonly BrowserUseAuthBlockedCause[]
	>
> = {
	"pre-auth-proof": [
		"origin-mismatch",
		"target-proof-invalid",
		"unsupported-method",
		"user-presence-required",
		"capability-loss",
		"adapter-crash",
	],
	"secret-free-preparation": [
		"missing-token",
		"invalid-vault-scope",
		"ambiguous-binding-selection",
		"revoked-binding",
		"unsupported-method",
		"capability-loss",
		"adapter-crash",
	],
	"lease-request": ["capability-loss", "adapter-crash"],
	"sensitive-interval": [
		"origin-mismatch",
		"target-proof-invalid",
		"user-presence-required",
		"human-identity-attestation-required",
		"challenge-escalation",
		"capability-loss",
		"adapter-crash",
	],
	"write-ahead-submission": ["adapter-crash", "capability-loss"],
	cleanup: ["adapter-crash"],
	"post-auth-proof": [
		"origin-mismatch",
		"session-identity-proof-unavailable",
		"human-identity-attestation-required",
		"unknown-post-submit-state",
		"user-presence-required",
		"target-proof-invalid",
		"capability-loss",
		"adapter-crash",
	],
	"bounded-attestation": ["capability-loss", "adapter-crash"],
};

// Where a resolved blocked cause safely resumes (R14): anything that was
// blocked at or after the sensitive interval re-proves from the top; earlier
// phases resume in place. Causes absent here need a dedicated human event
// (`human-retry-approved`) or a cancel — `blocked-cause-resolved` rejects.
const RESOLUTION_PHASE_BY_CAUSE: Readonly<
	Partial<Record<BrowserUseAuthBlockedCause, BrowserUseAuthPhase>>
> = {
	"missing-token": "secret-free-preparation",
	"invalid-vault-scope": "secret-free-preparation",
	"ambiguous-binding-selection": "secret-free-preparation",
	"revoked-binding": "secret-free-preparation",
	"lease-unavailable": "lease-request",
	"target-proof-invalid": "pre-auth-proof",
	"user-presence-required": "pre-auth-proof",
	"challenge-escalation": "pre-auth-proof",
	"adapter-crash": "pre-auth-proof",
	"cleanup-failure": "cleanup",
	"session-identity-proof-unavailable": "post-auth-proof",
	"human-identity-attestation-required": "post-auth-proof",
};

// Submit outcomes that block after cleanup (R19): each maps to exactly one
// cause. Wrong credentials, lockout, rate limit, and challenge escalation
// block with their own cause; timeout blocks as unknown post-submit state
// (AE6 — same-lane inspection, never a credential re-entry).
const BLOCKED_CAUSE_BY_SUBMIT_OUTCOME: Readonly<
	Partial<Record<BrowserUseAuthSubmitOutcome, BrowserUseAuthBlockedCause>>
> = {
	"wrong-password": "wrong-password",
	"wrong-otp": "wrong-otp",
	lockout: "lockout",
	"rate-limit": "rate-limit",
	"challenge-escalation": "challenge-escalation",
	"timeout-unknown": "unknown-post-submit-state",
};

// Ordered password choreography (R15): steps advance monotonically, with
// two hard anchors — identify-auth-state is always first, and fill-password
// requires an immediately preceding reprove-target (R14: re-prove origin/
// page/frame immediately before every secret delivery). The interior steps
// are optional so username-first, combined-form, and password-only pages
// (AE4 scenarios) are all expressible without a second choreography table.
// The OTP re-entry chain after an `otp-required` outcome is reprove-target
// → fill-otp, enforced separately in applyMethodStep.
const PASSWORD_STEP_ORDER: readonly BrowserUseAuthMethodStep[] = [
	"identify-auth-state",
	"select-account-context",
	"fill-username",
	"submit-username",
	"reprove-target",
	"fill-password",
];

// --- Internal helpers -------------------------------------------------------------

function reject(
	code: BrowserUseAuthTransitionRejectionCode,
	message: string,
): BrowserUseAuthTransitionResult {
	return { ok: false, rejection: { code, message } };
}

function next(
	fragment: BrowserUseAuthTransactionFragment,
	changes: Partial<BrowserUseAuthTransactionFragment>,
): BrowserUseAuthTransitionResult {
	return {
		ok: true,
		fragment: {
			...fragment,
			...changes,
			fragment_revision: fragment.fragment_revision + 1,
		},
	};
}

function blockWith(
	fragment: BrowserUseAuthTransactionFragment,
	cause: BrowserUseAuthBlockedCause,
): BrowserUseAuthTransitionResult {
	return next(fragment, {
		status: "blocked",
		blocked_cause: cause,
		continuation: {
			...BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause].continuation,
		},
		method_step: null,
	});
}

function activeAt(
	fragment: BrowserUseAuthTransactionFragment,
	phase: BrowserUseAuthPhase,
	changes: Partial<BrowserUseAuthTransactionFragment> = {},
): BrowserUseAuthTransitionResult {
	return next(fragment, {
		phase,
		status: "active",
		blocked_cause: null,
		continuation: null,
		method_step: null,
		...changes,
	});
}

// --- Begin (R1, R19) ---------------------------------------------------------------

/** Inputs fixed at transaction start. */
export type BrowserUseAuthTransactionStart = {
	binding: BrowserUseAuthTransactionBinding;
	method: BrowserUseLaneAuthMethod;
	attempt_limit: number;
	attempts_already_consumed: number;
};

/**
 * Begin one authentication transaction bound to a validated handoff (R1).
 * The attempt budget key derives from credential binding, expected
 * principal (service/auth context), and identity-provider origin (R19), so
 * a second profile racing the same principal shares the budget.
 *
 * @param start - Bindings, method, and the shared attempt budget position
 * @returns The initial fragment at pre-auth proof, or one typed rejection
 */
export function beginAuthTransaction(
	start: BrowserUseAuthTransactionStart,
): BrowserUseAuthTransitionResult {
	const fragment: BrowserUseAuthTransactionFragment = {
		schema_version: BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
		fragment_revision: 0,
		phase: "pre-auth-proof",
		status: "active",
		method: start.method,
		method_step: null,
		binding: { ...start.binding },
		attempt: {
			budget_key: `${start.binding.service_id}::${start.binding.auth_context}::${start.binding.origin}`,
			limit: start.attempt_limit,
			consumed: start.attempts_already_consumed,
		},
		submission_started: false,
		external_effect: "none",
		submit_outcome: null,
		blocked_cause: null,
		continuation: null,
		terminal_outcome: null,
		identity_basis: null,
		identity_basis_digest: null,
		attestation_digest: null,
		fresh_until_epoch_ms: null,
	};
	const issues = validateAuthFragmentShape(fragment);
	const first = issues[0];
	if (first !== undefined) {
		return reject(
			"auth_fragment_invalid",
			`transaction start is inadmissible (${first.code} at ${first.path}).`,
		);
	}
	return { ok: true, fragment };
}

// --- Apply one event (R14-R19, R21) --------------------------------------------------

/**
 * Apply one typed event to the transaction (R14-R19). Deterministic pure
 * transition: any event outside the current phase's legality table, any
 * out-of-order method step, and any blocked-state event other than its
 * declared resolutions is a typed rejection that leaves the fragment
 * untouched. Every blocked result carries the cause's exactly-one
 * code-owned continuation (R21).
 *
 * @param fragment - Current fragment value
 * @param event - One typed transaction event
 * @returns The next fragment at `fragment_revision + 1`, or one typed rejection
 */
export function applyAuthTransition(
	fragment: BrowserUseAuthTransactionFragment,
	event: BrowserUseAuthTransactionEvent,
): BrowserUseAuthTransitionResult {
	const admission = validateAuthFragmentShape(fragment);
	const firstIssue = admission[0];
	if (firstIssue !== undefined) {
		return reject(
			"auth_fragment_invalid",
			`fragment is inadmissible (${firstIssue.code} at ${firstIssue.path}).`,
		);
	}
	if (fragment.status === "terminal") {
		return reject(
			"auth_fragment_terminal",
			`transaction is terminal (${fragment.terminal_outcome}); no event applies.`,
		);
	}
	if (event.type === "cancel") return applyCancel(fragment);

	if (fragment.status === "blocked") {
		if (event.type === "blocked-cause-resolved") {
			return applyBlockedResolution(fragment);
		}
		if (event.type === "human-retry-approved") {
			return applyHumanRetry(fragment);
		}
		return reject(
			"auth_blocked_requires_resolution",
			`blocked on ${fragment.blocked_cause}; only its resolution, human retry, or cancel applies.`,
		);
	}

	const phase = fragment.phase as Exclude<BrowserUseAuthPhase, "terminal">;
	// Defense in depth behind the admission invariant (terminal phase ⟺
	// terminal status): an unknown or terminal phase key must reject typed,
	// never throw on an undefined legality row.
	if (EVENTS_BY_PHASE[phase] === undefined) {
		return reject(
			"auth_phase_illegal",
			`event ${event.type} is illegal in phase ${fragment.phase}.`,
		);
	}
	if (!EVENTS_BY_PHASE[phase].includes(event.type)) {
		return reject(
			"auth_phase_illegal",
			`event ${event.type} is illegal in phase ${phase}.`,
		);
	}

	switch (event.type) {
		case "pre-auth-proved":
			return activeAt(fragment, "secret-free-preparation");
		case "session-already-authenticated":
			// Login already complete: session reuse still proves identity and
			// mints a bounded attestation before any run becomes ready (R25).
			return activeAt(fragment, "post-auth-proof");
		case "preparation-complete":
			return activeAt(fragment, "lease-request");
		case "lease-granted":
			return activeAt(fragment, "sensitive-interval");
		case "lease-unavailable":
			// Competing agent: machine-readable wait continuation (AE11, R29).
			return blockWith(fragment, "lease-unavailable");
		case "method-step-complete":
			return applyMethodStep(fragment, event.step);
		case "submission-dispatched":
			return applySubmissionDispatch(fragment);
		case "submit-outcome-observed":
			// R18: cleanup always runs before the outcome's consequence; the
			// in-flight marker clears because the effect is now classified.
			return activeAt(fragment, "cleanup", {
				submission_started: false,
				submit_outcome: event.outcome,
				external_effect:
					event.outcome === "timeout-unknown"
						? "unknown"
						: fragment.external_effect,
			});
		case "cleanup-complete":
			return applyCleanupComplete(fragment);
		case "cleanup-failed":
			return blockWith(fragment, "cleanup-failure");
		case "postcondition-proven":
			return activeAt(fragment, "bounded-attestation", {
				identity_basis: event.identity_basis,
				identity_basis_digest: event.identity_basis_digest,
			});
		case "postcondition-unproven":
			return blockWith(fragment, "session-identity-proof-unavailable");
		case "attestation-issued":
			return next(fragment, {
				phase: "terminal",
				status: "terminal",
				terminal_outcome: "authenticated",
				attestation_digest: event.attestation_digest,
				fresh_until_epoch_ms: event.fresh_until_epoch_ms,
				method_step: null,
			});
		case "blocked": {
			if (!BLOCK_CAUSES_BY_PHASE[phase].includes(event.cause)) {
				return reject(
					"auth_blocked_cause_illegal",
					`cause ${event.cause} cannot be raised from phase ${phase}.`,
				);
			}
			return blockWith(fragment, event.cause);
		}
		default:
			return reject("auth_phase_illegal", `event is illegal in phase ${phase}.`);
	}
}

function applyMethodStep(
	fragment: BrowserUseAuthTransactionFragment,
	step: BrowserUseAuthMethodStep,
): BrowserUseAuthTransitionResult {
	const last = fragment.method_step;
	if (fragment.submit_outcome === "otp-required") {
		// OTP re-entry chain (R12/R14): re-prove the target, then fill the
		// current OTP. The password choreography is already spent.
		if (step === "reprove-target" && last === null) {
			return next(fragment, { method_step: step });
		}
		if (step === "fill-otp" && last === "reprove-target") {
			return next(fragment, { method_step: step });
		}
		return reject(
			"auth_step_out_of_order",
			`step ${step} is out of order in the OTP re-entry chain (after ${last ?? "no step"}).`,
		);
	}
	if (step === "fill-otp") {
		return reject(
			"auth_step_out_of_order",
			"fill-otp is legal only after an otp-required submit outcome.",
		);
	}
	if (last === null && step !== "identify-auth-state") {
		return reject(
			"auth_step_out_of_order",
			"the sensitive interval always begins by identifying the auth state.",
		);
	}
	const lastIndex = last === null ? -1 : PASSWORD_STEP_ORDER.indexOf(last);
	const stepIndex = PASSWORD_STEP_ORDER.indexOf(step);
	if (stepIndex === -1 || stepIndex <= lastIndex) {
		return reject(
			"auth_step_out_of_order",
			`step ${step} is out of order after ${last ?? "no step"}.`,
		);
	}
	if (step === "fill-password" && last !== "reprove-target") {
		return reject(
			"auth_step_out_of_order",
			"fill-password requires an immediately preceding target re-proof (R14).",
		);
	}
	return next(fragment, { method_step: step });
}

function applySubmissionDispatch(
	fragment: BrowserUseAuthTransactionFragment,
): BrowserUseAuthTransitionResult {
	const readyToSubmit =
		fragment.method_step === "fill-password" ||
		fragment.method_step === "fill-otp";
	if (!readyToSubmit) {
		return reject(
			"auth_step_out_of_order",
			"submission requires a completed password or OTP fill.",
		);
	}
	if (fragment.attempt.consumed >= fragment.attempt.limit) {
		return reject(
			"auth_attempt_budget_exhausted",
			"the credential attempt budget is exhausted; no submission is safe.",
		);
	}
	// Write-ahead truth (R19): the fragment carrying submission_started must
	// be persisted before the delivery helper acts; a later crash consumes
	// this attempt and never blind-retries.
	return next(fragment, {
		phase: "write-ahead-submission",
		status: "active",
		submission_started: true,
		external_effect: "possible",
		submit_outcome: null,
		attempt: { ...fragment.attempt, consumed: fragment.attempt.consumed + 1 },
		method_step: null,
	});
}

function applyCleanupComplete(
	fragment: BrowserUseAuthTransactionFragment,
): BrowserUseAuthTransitionResult {
	const outcome = fragment.submit_outcome;
	if (outcome === null) {
		return reject(
			"auth_phase_illegal",
			"cleanup completion requires an observed submit outcome.",
		);
	}
	if (outcome === "success") {
		return activeAt(fragment, "post-auth-proof");
	}
	if (outcome === "otp-required") {
		if (fragment.method !== "otp") {
			return blockWith(fragment, "unsupported-method");
		}
		// Keep the outcome: it is what makes the OTP re-entry chain legal.
		return activeAt(fragment, "sensitive-interval");
	}
	const cause = BLOCKED_CAUSE_BY_SUBMIT_OUTCOME[outcome];
	if (cause === undefined) {
		return reject(
			"auth_phase_illegal",
			`submit outcome ${outcome} has no cleanup consequence.`,
		);
	}
	return blockWith(fragment, cause);
}

function applyBlockedResolution(
	fragment: BrowserUseAuthTransactionFragment,
): BrowserUseAuthTransitionResult {
	const cause = fragment.blocked_cause;
	if (cause === null) {
		return reject(
			"auth_blocked_requires_resolution",
			"fragment carries no cause.",
		);
	}
	if (fragment.submission_started) {
		// Blocked with a submission still in flight (e.g. adapter crash during
		// write-ahead): only inspection can classify the effect (R19/AE6).
		return reject(
			"auth_submission_requires_inspection",
			"an in-flight submission requires inspection before any resume.",
		);
	}
	const resume = RESOLUTION_PHASE_BY_CAUSE[cause];
	if (resume === undefined) {
		return reject(
			"auth_cause_not_resolvable",
			`cause ${cause} has no mechanical resolution; a human decision is required.`,
		);
	}
	return activeAt(fragment, resume, { submit_outcome: null });
}

function applyHumanRetry(
	fragment: BrowserUseAuthTransactionFragment,
): BrowserUseAuthTransitionResult {
	if (
		fragment.blocked_cause !== "wrong-password" &&
		fragment.blocked_cause !== "wrong-otp"
	) {
		return reject(
			"auth_retry_requires_human",
			"human retry applies only to a rejected password or OTP.",
		);
	}
	if (fragment.attempt.consumed >= fragment.attempt.limit) {
		return reject(
			"auth_attempt_budget_exhausted",
			"the credential attempt budget is exhausted; no retry is safe.",
		);
	}
	// Explicit human retry re-proves everything from the top (R14); the
	// consumed attempt stays consumed (R19 — never blind-retry semantics).
	return activeAt(fragment, "pre-auth-proof", { submit_outcome: null });
}

// --- Cancel (R37) --------------------------------------------------------------------

function applyCancel(
	fragment: BrowserUseAuthTransactionFragment,
): BrowserUseAuthTransitionResult {
	// External-effect truth is already tracked on the fragment; cancellation
	// preserves it verbatim and never claims rollback (R37).
	return next(fragment, {
		phase: "terminal",
		status: "terminal",
		terminal_outcome: "cancelled",
		blocked_cause: null,
		continuation: null,
		method_step: null,
	});
}

// --- Restart resume (AE11) -------------------------------------------------------------

/**
 * Resume one persisted fragment after a process restart (AE11). Pure and
 * secret-free: a blocked or terminal fragment is preserved verbatim (its
 * continuation IS the resume answer); an active fragment whose write-ahead
 * marker is still in flight blocks as unknown post-submit state — the
 * consumed attempt stays consumed and only inspection continues (R19); any
 * other active fragment restarts at pre-auth proof because nothing secret
 * was ever persisted to resume from (R14).
 *
 * @param fragment - The persisted fragment value
 * @returns The resumed fragment, or one typed rejection for inadmissible input
 */
export function resumeAuthTransactionAfterRestart(
	fragment: BrowserUseAuthTransactionFragment,
): BrowserUseAuthTransitionResult {
	const admission = validateAuthFragmentShape(fragment);
	const firstIssue = admission[0];
	if (firstIssue !== undefined) {
		return reject(
			"auth_fragment_invalid",
			`persisted fragment is inadmissible (${firstIssue.code} at ${firstIssue.path}).`,
		);
	}
	if (fragment.status === "blocked" || fragment.status === "terminal") {
		return { ok: true, fragment };
	}
	if (fragment.submission_started) {
		return blockWith(fragment, "unknown-post-submit-state");
	}
	if (
		fragment.phase === "post-auth-proof" ||
		fragment.phase === "bounded-attestation"
	) {
		// Credentials were already submitted and their outcome was observed.
		// Re-enter only the fresh proof phase: resetting to pre-auth would let a
		// delayed/stale form replay the consumed credential attempt.
		return activeAt(fragment, "post-auth-proof", {
			identity_basis: null,
			identity_basis_digest: null,
			attestation_digest: null,
			fresh_until_epoch_ms: null,
		});
	}
	return activeAt(fragment, "pre-auth-proof", { submit_outcome: null });
}
