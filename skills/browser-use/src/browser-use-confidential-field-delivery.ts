// ---------------------------------------------------------------------------
// Confidential Field Delivery choreography (auth plan 2026-07-21-003 U4/U5,
// R5, R14-R18, R22-R26; AE4-AE12; release contract R13-R16, AE4-AE5).
//
// The PURE choreography owner for password and current-OTP delivery. Given an
// approved Item Binding, a VERIFIED TARGET (origin + account/tenant + field
// proof), and a TokenRetrievalPort, it orchestrates one bounded field action
// per credential field through the lane executor's DELIVERY HOOK — the seam
// onto the disposable Confidential Field Delivery Helper (R16). This module
// never touches raw bytes:
//   * The TokenRetrievalPort yields an OPAQUE BrowserUseSecretHandle, never
//     bytes (browser-use-op.ts, spec D9).
//   * The delivery hook receives that opaque handle plus a verified field
//     descriptor and performs one bounded write inside the disposable helper,
//     reporting back only an OUTCOME and a non-secret field SHAPE (kind +
//     length) — never the value (R14).
// The complete raw-secret trusted computing base stays the disposable `op`
// helper and the disposable delivery helper (R16); this choreography sits
// entirely outside it and is mechanically secret-free.
//
// Continuity (R15/R22-R24): delivery preserves the SELECTED LANE and the
// VERIFIED TARGET. It re-proves origin/target immediately before each field
// action (R14), then on completion emits a RESUME DIRECTIVE that discards
// stale lane refs and demands one fresh identity basis before the task lane
// resumes — never an adapter switch (R5/KTD3). Human-only challenges
// (passkey/CAPTCHA/consent/recovery/ambiguous identity) short-circuit to a
// resumable human continuation and never a bypass (R16/R26).
//
// Pure module: no I/O, no clock, no randomness. All effects — op reads and the
// bounded field write — are injected ports. Deterministic given inputs.
// ---------------------------------------------------------------------------

import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import {
	type BrowserUseAuthBlockedCause,
	type BrowserUseAuthContinuation,
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
} from "./browser-use-auth-model";
import type {
	BrowserUseOpCredentialField,
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";
import type { BrowserUseDeliveredFieldShape } from "./browser-use-secret-scan";

// --- Verified target (R14, R25; origin/account/field proof) ---------------------

/**
 * The proof the choreography requires BEFORE any secret delivery: the exact
 * top-level origin, the credential-frame origin, the selected lane + target /
 * page / frame identity, and the proven account/tenant reference (R14/R25).
 * These are identity references only — never a selector, endpoint, or value.
 * The choreography re-checks this bundle immediately before each field action;
 * the lane executor's delivery hook is handed the SAME bundle so the helper
 * writes only to the proven field.
 */
export type BrowserUseVerifiedTarget = {
	lane_id: string;
	run_id: string;
	/** Exact normalized top-level origin proven present (R14). */
	top_level_origin: string;
	/** Exact normalized credential-frame origin proven present (R14). */
	frame_origin: string;
	target_id: string;
	page_id: string;
	frame_id: string;
	/** Redacted proven account/tenant reference (R25) — never a raw label. */
	account_ref: string;
	/** Digest of the freshly-proven target state; re-proof must reproduce it. */
	target_proof_digest: string;
};

// --- Delivery hook (the seam onto the disposable helper; R16-R17) ----------------

/**
 * What ONE bounded field action reports back. Outcome plus a non-secret SHAPE
 * (browser-use-secret-scan.ts) — never the value (R14). `field_cleared` records
 * whether the helper cleared the field on a failed write (R18). The delivery
 * hook is the disposable helper's process boundary; it is structurally
 * incapable of returning bytes because the return type has no value slot.
 */
export type BrowserUseFieldActionOutcome =
	| { ok: true; shape: BrowserUseDeliveredFieldShape }
	| {
			ok: false;
			reason:
				| "target-drift"
				| "field-write-failed"
				| "helper-unavailable"
				| "helper-crash";
			field_cleared: boolean;
			/** Native truth about whether the single field write may have landed. */
			write_state?: "blocked-before-write" | "write-outcome-unknown";
	  };

/** Semantic field identity admitted by the disposable native writer. */
export type BrowserUseSemanticFieldLocator = {
	role: "textbox";
	accessible_name: string;
	input_kind: BrowserUseOpCredentialField;
};

/**
 * The lane executor's DELIVERY HOOK: the single seam onto the disposable
 * Confidential Field Delivery Helper (R16-R17). It receives the OPAQUE secret
 * handle and the verified field descriptor and performs exactly one bounded
 * write, reporting back only an outcome + non-secret shape. Every lane
 * (agent-browser, playwright, chrome-devtools) supplies this same hook shape;
 * the choreography is lane-neutral (R5 — one confidential-delivery seam, many
 * lanes). The hook NEVER returns to the choreography until the helper exits
 * (R17 — the helper exits after one bounded field action).
 */
export type BrowserUseDeliveryHook = (input: {
	handle: BrowserUseSecretHandle;
	field: BrowserUseOpCredentialField;
	target: BrowserUseVerifiedTarget;
	/** Required by the native U7 lane; legacy injected test hooks may omit it. */
	semantic_locator?: BrowserUseSemanticFieldLocator;
}) => Promise<BrowserUseFieldActionOutcome>;

/**
 * Secret-free request handed across the TypeScript/native boundary.
 *
 * `capability` is opaque. Its native owner atomically consumes it and connects
 * the resulting OP stdout directly to the disposable writer's private
 * credential descriptor. No credential value or credential descriptor is
 * representable here.
 */
export type BrowserUseNativeConfidentialDeliveryRequest = {
	schema_version: 1;
	capability: BrowserUseSecretHandle;
	target: {
		lane_id: string;
		run_id: string;
		target_id: string;
		page_id: string;
		frame_id: string;
		top_level_origin: string;
		frame_origin: string;
		target_proof_digest: string;
	};
	locator: BrowserUseSemanticFieldLocator;
};

const CONFIDENTIAL_PROTOCOL_METHODS = [
	"Target.getTargetInfo",
	"Page.getFrameTree",
	"Accessibility.getFullAXTree",
	"DOM.describeNode",
	"DOM.resolveNode",
	"Runtime.callFunctionOn",
] as const;

type BrowserUseConfidentialProtocolMethod =
	(typeof CONFIDENTIAL_PROTOCOL_METHODS)[number];

type BrowserUseNativeConfidentialDeliveryResult =
	| {
			schema_version: 1;
			ok: true;
			write_state: "delivered";
			shape: BrowserUseDeliveredFieldShape;
			protocol_trace: readonly BrowserUseConfidentialProtocolMethod[];
	  }
	| {
			schema_version: 1;
			ok: false;
			write_state: "blocked-before-write" | "write-outcome-unknown";
			rejection: {
				code:
					| "invalid-request"
					| "target-unproven"
					| "field-missing"
					| "field-ambiguous"
					| "field-invalid"
					| "credential-invalid"
					| "browser-channel-unavailable"
					| "write-outcome-unknown";
				message: "confidential field delivery blocked; inspect the typed code.";
			};
			protocol_trace: readonly BrowserUseConfidentialProtocolMethod[];
	  };

/**
 * Native U7 owner. It consumes the deferred capability once and owns every
 * secret-bearing descriptor. TypeScript receives only the bounded result.
 */
export type BrowserUseNativeConfidentialDeliveryPort = {
	consumePrivatePipeAndDeliver(
		input: BrowserUseNativeConfidentialDeliveryRequest,
	): Promise<unknown>;
};

/**
 * Observation/capture fence surrounding the native helper.
 *
 * `resume` is never called before `cleanup`, and unknown-write results remain
 * quarantined for explicit inspection or fresh-tab repair.
 */
export type BrowserUseConfidentialDeliveryQuarantine = {
	pause(input: {
		target: BrowserUseVerifiedTarget;
	}): Promise<{ ok: true } | { ok: false }>;
	cleanup(input: {
		target: BrowserUseVerifiedTarget;
		write_state:
			| "blocked-before-write"
			| "write-outcome-unknown"
			| "delivered";
	}): Promise<{ ok: true } | { ok: false }>;
	resume(input: {
		target: BrowserUseVerifiedTarget;
	}): Promise<{ ok: true } | { ok: false }>;
};

function exactKeys(
	value: Readonly<Record<string, unknown>>,
	expected: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === [...expected].sort()[index])
	);
}

function validProtocolTrace(
	value: unknown,
	writeState: "blocked-before-write" | "write-outcome-unknown" | "delivered",
): value is readonly BrowserUseConfidentialProtocolMethod[] {
	if (
		!Array.isArray(value) ||
		value.some(
			(method) =>
				typeof method !== "string" ||
				!CONFIDENTIAL_PROTOCOL_METHODS.includes(
					method as BrowserUseConfidentialProtocolMethod,
				),
		)
	) {
		return false;
	}
	const expectedLength =
		writeState === "delivered" || writeState === "write-outcome-unknown"
			? CONFIDENTIAL_PROTOCOL_METHODS.length
			: value.length;
	return (
		value.length === expectedLength &&
		(writeState !== "blocked-before-write" ||
			value.length < CONFIDENTIAL_PROTOCOL_METHODS.length) &&
		value.every(
			(method, index) => method === CONFIDENTIAL_PROTOCOL_METHODS[index],
		)
	);
}

function parseNativeDeliveryResult(
	value: unknown,
	expectedField: BrowserUseOpCredentialField,
): BrowserUseNativeConfidentialDeliveryResult | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.schema_version !== 1 || typeof candidate.ok !== "boolean") {
		return undefined;
	}
	if (candidate.ok) {
		if (
			!exactKeys(candidate, [
				"schema_version",
				"ok",
				"write_state",
				"shape",
				"protocol_trace",
			]) ||
			candidate.write_state !== "delivered" ||
			typeof candidate.shape !== "object" ||
			candidate.shape === null ||
			Array.isArray(candidate.shape)
		) {
			return undefined;
		}
		const shape = candidate.shape as Record<string, unknown>;
		if (
			!exactKeys(shape, ["field", "byte_length"]) ||
			shape.field !== expectedField ||
			typeof shape.byte_length !== "number" ||
			!Number.isSafeInteger(shape.byte_length) ||
			shape.byte_length < 1 ||
			shape.byte_length > 4_096 ||
			!validProtocolTrace(candidate.protocol_trace, "delivered")
		) {
			return undefined;
		}
		return candidate as BrowserUseNativeConfidentialDeliveryResult;
	}
	if (
		!exactKeys(candidate, [
			"schema_version",
			"ok",
			"write_state",
			"rejection",
			"protocol_trace",
		]) ||
		(candidate.write_state !== "blocked-before-write" &&
			candidate.write_state !== "write-outcome-unknown") ||
		typeof candidate.rejection !== "object" ||
		candidate.rejection === null ||
		Array.isArray(candidate.rejection)
	) {
		return undefined;
	}
	const rejection = candidate.rejection as Record<string, unknown>;
	const rejectionCodes = [
		"invalid-request",
		"target-unproven",
		"field-missing",
		"field-ambiguous",
		"field-invalid",
		"credential-invalid",
		"browser-channel-unavailable",
		"write-outcome-unknown",
	] as const;
	if (
		!exactKeys(rejection, ["code", "message"]) ||
		typeof rejection.code !== "string" ||
		!rejectionCodes.includes(
			rejection.code as (typeof rejectionCodes)[number],
		) ||
		!validProtocolTrace(
			candidate.protocol_trace,
			candidate.write_state as
				| "blocked-before-write"
				| "write-outcome-unknown",
		) ||
		rejection.message !==
			"confidential field delivery blocked; inspect the typed code."
	) {
		return undefined;
	}
	return candidate as BrowserUseNativeConfidentialDeliveryResult;
}

/**
 * Build the production-shaped secret-free delivery hook.
 *
 * The native port owns capability consumption and the private OP-to-helper
 * pipe. Observation/capture stays paused until native cleanup completes.
 */
export function createBrowserUseNativeConfidentialDeliveryHook(input: {
	quarantine: BrowserUseConfidentialDeliveryQuarantine;
	consumePrivatePipeAndDeliver: BrowserUseNativeConfidentialDeliveryPort["consumePrivatePipeAndDeliver"];
}): BrowserUseDeliveryHook {
	return async (delivery) => {
		const locator = delivery.semantic_locator;
		if (
			locator === undefined ||
			delivery.handle.field !== delivery.field ||
			locator.input_kind !== delivery.field ||
			locator.role !== "textbox" ||
			locator.accessible_name.length === 0 ||
			locator.accessible_name.length > 256
		) {
			return {
				ok: false,
				reason: "helper-unavailable",
				field_cleared: false,
				write_state: "blocked-before-write",
			};
		}
		let paused = false;
		try {
			paused = (
				await input.quarantine.pause({ target: delivery.target })
			).ok;
		} catch {
			paused = false;
		}
		if (!paused) {
			return {
				ok: false,
				reason: "helper-unavailable",
				field_cleared: false,
				write_state: "blocked-before-write",
			};
		}

		let native: BrowserUseNativeConfidentialDeliveryResult | undefined;
		try {
			native = parseNativeDeliveryResult(
				await input.consumePrivatePipeAndDeliver({
					schema_version: 1,
					capability: { ...delivery.handle },
					target: {
						lane_id: delivery.target.lane_id,
						run_id: delivery.target.run_id,
						target_id: delivery.target.target_id,
						page_id: delivery.target.page_id,
						frame_id: delivery.target.frame_id,
						top_level_origin: delivery.target.top_level_origin,
						frame_origin: delivery.target.frame_origin,
						target_proof_digest: delivery.target.target_proof_digest,
					},
					locator: { ...locator },
				}),
				delivery.field,
			);
		} catch {
			native = undefined;
		}

		const writeState = native?.write_state ?? "write-outcome-unknown";
		let cleaned = false;
		try {
			cleaned = (
				await input.quarantine.cleanup({
					target: delivery.target,
					write_state: writeState,
				})
			).ok;
		} catch {
			cleaned = false;
		}
		if (native === undefined || !cleaned) {
			return {
				ok: false,
				reason: "helper-crash",
				field_cleared: false,
				write_state:
					writeState === "blocked-before-write"
						? "blocked-before-write"
						: "write-outcome-unknown",
			};
		}
		if (!native.ok) {
			if (native.write_state === "write-outcome-unknown") {
				return {
					ok: false,
					reason: "field-write-failed",
					field_cleared: false,
					write_state: "write-outcome-unknown",
				};
			}
			let resumed = false;
			try {
				resumed = (
					await input.quarantine.resume({ target: delivery.target })
				).ok;
			} catch {
				resumed = false;
			}
			return resumed
				? {
						ok: false,
						reason:
							native.rejection.code === "target-unproven"
								? "target-drift"
								: "helper-unavailable",
						field_cleared: true,
						write_state: "blocked-before-write",
					}
				: {
						ok: false,
						reason: "helper-crash",
						field_cleared: false,
						write_state: "blocked-before-write",
				};
		}
		return { ok: true, shape: native.shape };
	};
}

/**
 * Re-prove the verified target immediately before a field action (R14). The
 * lane supplies this so origin drift, target replacement, page replacement, or
 * a stale field reference is caught BEFORE the secret handle is minted. Returns
 * the freshly-observed proof digest; the choreography compares it to the
 * verified target's digest and refuses delivery on any mismatch.
 */
export type BrowserUseTargetReproof = (input: {
	target: BrowserUseVerifiedTarget;
}) => Promise<
	| { proven: true; observed_digest: string }
	| { proven: false; cause: "origin-mismatch" | "target-proof-invalid" }
>;

// --- Human-only challenge (R16/R26) ---------------------------------------------

/**
 * A user-presence challenge the choreography may encounter BEFORE or DURING
 * delivery. Each is a hard stop — never a bypass (R26). The caller passes the
 * detected challenge in; the choreography converts it into a resumable human
 * continuation and delivers nothing.
 */
export const BROWSER_USE_HUMAN_CHALLENGES = [
	"passkey",
	"captcha",
	"consent",
	"recovery-code",
	"ambiguous-identity",
] as const;

/** Human-only challenge union. */
export type BrowserUseHumanChallenge =
	(typeof BROWSER_USE_HUMAN_CHALLENGES)[number];

// A challenge maps onto an EXISTING blocked cause + continuation (R21): the
// cause table is the single owner of the next safe action. Ambiguous identity
// routes to the human-identity-attestation path (R25); the rest are user
// presence (R26).
const BLOCKED_CAUSE_BY_CHALLENGE: Readonly<
	Record<BrowserUseHumanChallenge, BrowserUseAuthBlockedCause>
> = {
	passkey: "user-presence-required",
	captcha: "user-presence-required",
	consent: "user-presence-required",
	"recovery-code": "user-presence-required",
	"ambiguous-identity": "human-identity-attestation-required",
};

// --- Field plan (R12/R15; password + current OTP) -------------------------------

/**
 * The ordered credential fields to deliver (R15). Password choreography
 * delivers `password`; the current-OTP re-entry chain delivers `otp-current`.
 * `username` is deliverable for username-first pages. The choreography
 * delivers them in the given order, re-proving the target before each.
 */
export type BrowserUseDeliveryFieldPlan = readonly BrowserUseOpCredentialField[];

// --- Choreography input + result ------------------------------------------------

/** Everything the choreography needs; every effect is an injected port. */
export type BrowserUseDeliveryInput = {
	binding: BrowserUseItemBinding;
	target: BrowserUseVerifiedTarget;
	fields: BrowserUseDeliveryFieldPlan;
	/** Per-field semantic identity freshly derived from the current snapshot. */
	semantic_locators?: Readonly<
		Partial<Record<BrowserUseOpCredentialField, BrowserUseSemanticFieldLocator>>
	>;
	tokenRetrieval: BrowserUseTokenRetrievalPort;
	deliver: BrowserUseDeliveryHook;
	reproveTarget: BrowserUseTargetReproof;
	/** A human-only challenge detected before delivery (R16/R26), or null. */
	detected_challenge?: BrowserUseHumanChallenge | null;
};

/**
 * The RESUME DIRECTIVE emitted after a completed delivery (R15/R22-R24). It is
 * NOT a resume itself — it is the instruction the task lane must obey before
 * resuming: discard stale lane refs and prove a FRESH identity basis. The
 * choreography preserves the selected lane and verified target verbatim so the
 * SAME lane resumes (R5/KTD3 — never an adapter switch).
 */
export type BrowserUseDeliveryResumeDirective = {
	lane_id: string;
	run_id: string;
	target_id: string;
	/** The lane MUST invalidate its adapter-local refs before resuming (R22). */
	discard_stale_refs: true;
	/** The lane MUST establish exactly one fresh identity basis (R25/R30). */
	require_fresh_identity_basis: true;
	/** Shapes of every delivered field, for the sentinel owner (secret-free). */
	delivered_shapes: readonly BrowserUseDeliveredFieldShape[];
};

/** Typed choreography rejection: a blocked cause + its code-owned continuation. */
export type BrowserUseDeliveryBlocked = {
	blocked_cause: BrowserUseAuthBlockedCause;
	continuation: BrowserUseAuthContinuation;
	/** True once a bounded write may have reached the field (R19 write-ahead). */
	external_effect_possible: boolean;
	/** Whether the helper cleared secret-bearing fields on failure (R18). */
	fields_cleared: boolean;
};

/**
 * Delivery result. `ok: true` carries the resume directive and the delivered
 * field shapes; `ok: false` carries exactly one blocked cause + continuation.
 * Never a raw value on either branch — the type has no value slot.
 */
export type BrowserUseDeliveryResult =
	| { ok: true; resume: BrowserUseDeliveryResumeDirective }
	| { ok: false; blocked: BrowserUseDeliveryBlocked };

function blockedOf(
	cause: BrowserUseAuthBlockedCause,
	external_effect_possible: boolean,
	fields_cleared: boolean,
): BrowserUseDeliveryResult {
	return {
		ok: false,
		blocked: {
			blocked_cause: cause,
			continuation: structuredClone(
				BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause].continuation,
			),
			external_effect_possible,
			fields_cleared,
		},
	};
}

// The op credential field required to serve a delivery field, and the guard
// that the approved binding permits it. `username`/`password` need the password
// method; `otp-current` needs the otp method. A field the binding does not
// permit is unsupported-method — never a silent skip.
const OP_METHOD_BY_FIELD: Readonly<
	Record<BrowserUseOpCredentialField, "password" | "otp">
> = {
	username: "password",
	password: "password",
	"otp-current": "otp",
};

/**
 * Orchestrate confidential field delivery for one sensitive interval (R14-R18,
 * R22-R26). For each planned field, in order:
 *   1. If a human-only challenge is detected, STOP with a resumable human
 *      continuation before any secret access (R16/R26) — no field is touched.
 *   2. Re-prove the verified target immediately before the field (R14). Any
 *      origin/target drift blocks before the secret handle is minted.
 *   3. Confirm the approved binding permits the field's method (R12); an
 *      unpermitted field blocks unsupported-method.
 *   4. Fetch the OPAQUE secret handle from the TokenRetrievalPort (never bytes).
 *   5. Hand the handle + verified field descriptor to the lane's delivery hook
 *      (the disposable helper performs one bounded write and exits, R16-R17).
 *   6. On a failed write, surface the helper's cleared-field truth (R18) and
 *      block with an honest external-effect-possible flag (R19).
 * On success across all fields, emit the resume directive that discards stale
 * refs and demands a fresh identity basis before the SAME lane resumes
 * (R15/R22). The choreography holds no bytes on any path.
 *
 * @param input - Approved binding, verified target, field plan, and injected ports
 * @returns The resume directive, or exactly one blocked cause + continuation
 */
export async function deliverConfidentialFields(
	input: BrowserUseDeliveryInput,
): Promise<BrowserUseDeliveryResult> {
	// Human-only challenges are a hard stop BEFORE any secret access (R16/R26).
	if (input.detected_challenge != null) {
		const cause = BLOCKED_CAUSE_BY_CHALLENGE[input.detected_challenge];
		return blockedOf(cause, false, false);
	}
	if (input.fields.length === 0) {
		// A sensitive interval that delivers nothing is a caller error, not a
		// success: there is no field action and nothing to prove. Fail closed.
		return blockedOf("target-proof-invalid", false, false);
	}

	const delivered_shapes: BrowserUseDeliveredFieldShape[] = [];

	for (const field of input.fields) {
		// (2) Re-prove the verified target immediately before the field (R14).
		const reproof = await input.reproveTarget({ target: input.target });
		if (!reproof.proven) {
			return blockedOf(reproof.cause, false, false);
		}
		if (reproof.observed_digest !== input.target.target_proof_digest) {
			// Same-target continuity failed: the proven state changed under us.
			return blockedOf("target-proof-invalid", false, false);
		}

		// (3) The approved binding must permit this field's method (R12).
		const required = OP_METHOD_BY_FIELD[field];
		if (!input.binding.allowed_auth_methods.includes(required)) {
			return blockedOf("unsupported-method", false, false);
		}

		// (4) Fetch the OPAQUE handle. The port never returns bytes; a rejection
		// maps onto a blocked cause. missing-token / revoked-binding / capability
		// loss are all legal typed states (never a throw).
		const fetched = await input.tokenRetrieval.fetchCredentialField({
			binding: input.binding,
			field,
			target: {
				lane_id: input.target.lane_id,
				run_id: input.target.run_id,
				target_id: input.target.target_id,
				page_id: input.target.page_id,
				frame_id: input.target.frame_id,
				top_level_origin: input.target.top_level_origin,
				frame_origin: input.target.frame_origin,
				target_proof_digest: input.target.target_proof_digest,
			},
		});
		if (!fetched.ok) {
			return blockedOf(blockedCauseForRejection(fetched.rejection.code), false, false);
		}

		// (5) One bounded field action inside the disposable helper (R16-R17).
		const action = await input.deliver({
			handle: fetched.handle,
			field,
			target: input.target,
			semantic_locator: input.semantic_locators?.[field],
		});
		if (!action.ok) {
			// (6) Honest external-effect + cleared-field truth (R18/R19). Any
			// unknown-outcome failure is reported as possibly-landed: a
			// field-write-failed or a mid-action helper-crash cannot rule out that
			// the bounded write reached the field. Only helper-unavailable (the
			// helper never started) can honestly claim no external effect. The
			// helper reports whether it cleared the field. Target drift observed
			// inside the helper is target-proof-invalid; every other helper failure
			// is capability loss with an honest possible-effect flag.
			const possible =
				action.write_state === "write-outcome-unknown" ||
				(action.write_state === undefined &&
					action.reason !== "helper-unavailable");
			const cause: BrowserUseAuthBlockedCause =
				action.reason === "target-drift" ? "target-proof-invalid" : "capability-loss";
			return blockedOf(cause, possible, action.field_cleared);
		}
		delivered_shapes.push(action.shape);
	}

	// All fields delivered: preserve lane + target, discard stale refs, demand a
	// fresh identity basis before the SAME lane resumes (R15/R22/R25).
	return {
		ok: true,
		resume: {
			lane_id: input.target.lane_id,
			run_id: input.target.run_id,
			target_id: input.target.target_id,
			discard_stale_refs: true,
			require_fresh_identity_basis: true,
			delivered_shapes,
		},
	};
}

// A TokenRetrievalPort rejection maps onto a delivery blocked cause. This
// mirrors browser-use-op.ts blockOfRetrievalRejection intent but stays local so
// the choreography owns its own delivery-phase vocabulary; token-lifecycle
// faults are missing-token, an unpermitted field is unsupported-method, a moved
// item is revoked-binding, and everything else is capability loss.
function blockedCauseForRejection(
	code:
		| "capability-missing"
		| "pre-first-unlock"
		| "item-missing"
		| "entitlement-drift"
		| "signing-drift"
		| "token-invalid"
		| "token-revoked"
		| "timeout"
		| "io-failure"
		| "secret-egress-refused"
		| "output-shape-invalid"
		| "binding-shape-invalid"
		| "field-not-permitted",
): BrowserUseAuthBlockedCause {
	switch (code) {
		case "capability-missing":
		case "pre-first-unlock":
		case "entitlement-drift":
		case "signing-drift":
		case "token-invalid":
		case "token-revoked":
			return "missing-token";
		case "item-missing":
			return "revoked-binding";
		case "field-not-permitted":
			return "unsupported-method";
		default:
			return "capability-loss";
	}
}
