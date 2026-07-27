// ---------------------------------------------------------------------------
// Cross-lane auth conformance matrix (auth plan 2026-07-21-003 U9; release
// contract R22, success criterion L190).
//
// The ONE owner of the cross-lane conformance vocabulary and the pure engine
// that decides, per lane × conformance dimension, exactly one typed verdict:
//   - conformant       — a contract-level check proved the choreography holds,
//                         bound to the lane's Implementation integrity digest.
//   - nonconformant    — a check ran and the lane failed it (carries a cause).
//   - unproven         — the dimension cannot be decided here; carries the
//                         EXACT operator gate that blocks proof (native port
//                         absent, Playwright not installed, live portal needed).
//
// `unproven` is the honest state, never a hidden pass. The matrix fabricates
// nothing: a dimension is `conformant` only when a fake-backed contract check
// actually ran and passed against the lane's transaction shape, the sensitive-
// run guard's containment gate, or the transaction restart/resume rule.
//
// The passing subset publishes as the adapter registry's `auth-conformance`
// evidence: `conformanceEvidenceClaims` maps conformant DELIVERY dimensions
// onto the lane auth-method vocabulary the registry admits, so a lane's
// `advertised_auth_methods` derives from proven conformance and nothing else.
//
// Pure model + engine: no I/O, no Date.now, no Math.random. Time and identity
// enter only through the runner's evaluation inputs. The FSM/containment/
// restart checks the runner performs are the same pure owners U2/U4 expose —
// this module composes them, it never re-implements a transition or a sweep.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import {
	type BrowserUseAdapterLaneId,
	type BrowserUseLaneAuthMethod,
	type BrowserUseLaneImplementationIntegrity,
	BROWSER_USE_ADAPTER_LANE_IDS,
	BROWSER_USE_ADAPTER_LANE_TABLE,
	integrityKeyOf,
} from "./browser-use-adapter-model";
import {
	type BrowserUseAuthIdentityBasis,
	type BrowserUseAuthMethodStep,
	type BrowserUseAuthSubmitOutcome,
	type BrowserUseAuthTransactionBinding,
	type BrowserUseAuthTransactionFragment,
} from "./browser-use-auth-model";
import {
	type BrowserUseAuthTransactionEvent,
	type BrowserUseAuthTransitionResult,
	applyAuthTransition,
	beginAuthTransaction,
	resumeAuthTransactionAfterRestart,
} from "./browser-use-auth-transaction";
import {
	type BrowserUseGovernedSurface,
	beginSensitiveRunGuard,
	markRunSensitive,
	assertContainmentBeforeRelease,
} from "./browser-use-sensitive-run";

// --- Conformance dimensions (release L190) --------------------------------------

/**
 * The eight conformance dimensions L190 requires proven "for every lane".
 * Their order is the matrix column order — the projection and the digest read
 * this constant, so a dimension can never appear in one and be missed by the
 * other.
 */
export const BROWSER_USE_CONFORMANCE_DIMENSIONS = [
	"password-delivery",
	"current-otp-delivery",
	"session-reuse",
	"human-continuation",
	"restart-resume",
	"cleanup",
	"revocation",
	"lane-resume",
] as const;

/** One conformance dimension. */
export type BrowserUseConformanceDimension =
	(typeof BROWSER_USE_CONFORMANCE_DIMENSIONS)[number];

/**
 * The DELIVERY dimensions that, when conformant, advertise a lane auth method
 * (R22/R5). Session reuse is the universal baseline (KTD8); password and OTP
 * are the fresh-login methods that gate on conformance (KTD9). The remaining
 * dimensions are safety properties of the transaction, not advertised methods,
 * so they never enter the registry's auth-method vocabulary.
 */
export const BROWSER_USE_CONFORMANCE_METHOD_DIMENSIONS: Readonly<
	Partial<Record<BrowserUseConformanceDimension, BrowserUseLaneAuthMethod>>
> = {
	"password-delivery": "password",
	"current-otp-delivery": "otp",
	"session-reuse": "session-reuse",
	"human-continuation": "user-presence",
};

// --- Proof kinds and gates ------------------------------------------------------

/**
 * How a `conformant` or `nonconformant` verdict was reached. Contract-level
 * proofs are provable NOW with fakes; each names the pure owner it exercised
 * so a reader can see the matrix never invented a pass.
 *
 * - `transaction-choreography` — the U2 FSM engine drove the lane's per-shape
 *   choreography (password/OTP/session-reuse/human-continuation) end to end.
 * - `containment-sweep`        — the U4 sensitive-run guard proved no sentinel
 *   leaks onto any governed surface after a delivery.
 * - `restart-resume-rule`      — the U2 restart resume decided the persisted
 *   fragment correctly (in-flight → unknown-post-submit; clean active →
 *   pre-auth restart; blocked/terminal preserved).
 * - `transaction-invalidation` — the U2 engine invalidated the transaction on
 *   an integrity/target loss (revocation / lane-resume safety).
 */
export const BROWSER_USE_CONFORMANCE_PROOF_KINDS = [
	"transaction-choreography",
	"containment-sweep",
	"restart-resume-rule",
	"transaction-invalidation",
] as const;

/** One contract-level proof kind. */
export type BrowserUseConformanceProofKind =
	(typeof BROWSER_USE_CONFORMANCE_PROOF_KINDS)[number];

/**
 * The operator gates that hold a dimension at `unproven`. Each is an honest
 * "cannot be decided here" reason with a next action a human performs — never
 * a silent skip. Live-only proof for a lane whose port is absent stays
 * unproven until the operator clears the gate; the matrix never guesses past
 * it.
 */
export const BROWSER_USE_CONFORMANCE_GATES = [
	"native-port-absent",
	"playwright-not-installed",
	"live-portal-required",
	"live-idp-required",
] as const;

/** One operator gate. */
export type BrowserUseConformanceGate =
	(typeof BROWSER_USE_CONFORMANCE_GATES)[number];

/** Exactly-one next action a gate requires from a human operator. */
export type BrowserUseConformanceGateContinuation = {
	gate: BrowserUseConformanceGate;
	next_action: string;
};

/** Code-owned gate → next-action table: one operator action per gate. */
export const BROWSER_USE_CONFORMANCE_GATE_TABLE: Readonly<
	Record<BrowserUseConformanceGate, string>
> = {
	"native-port-absent":
		"Enroll the native Browser Use Security product (runtime/browser-use-security/) so the Confidential Field Delivery Helper and identity-proof ports exist; live-only dimensions stay unproven until then.",
	"playwright-not-installed":
		"Install and pin the Playwright lane Implementation, then register its native execution Interface; the lane cannot preserve same-lane execution until it is installed.",
	"live-portal-required":
		"Run this dimension against a live authenticated portal (Oncore/FastTrack/accommodation) under operator supervision; contract fakes cannot prove a live login outcome.",
	"live-idp-required":
		"Run this dimension against a live identity provider under operator supervision to exercise a real submit/OTP outcome; contract fakes cannot prove it.",
};

// --- Nonconformance causes ------------------------------------------------------

/**
 * Why a lane FAILED a contract-level check that actually ran. Distinct from an
 * operator gate: a nonconformant verdict means the check reached a verdict and
 * the lane did not hold the invariant.
 */
export const BROWSER_USE_CONFORMANCE_NONCONFORMANCE_CAUSES = [
	"choreography-illegal-transition",
	"containment-leak",
	"restart-resume-wrong-state",
	"invalidation-not-enforced",
] as const;

/** One nonconformance cause. */
export type BrowserUseConformanceNonconformanceCause =
	(typeof BROWSER_USE_CONFORMANCE_NONCONFORMANCE_CAUSES)[number];

// --- The per-cell verdict -------------------------------------------------------

/**
 * Evidence binding for a decided (`conformant`/`nonconformant`) cell (R22):
 * which contract-level proof ran, when it was evaluated, and the digest of the
 * lane Implementation integrity it was bound to. A same-version replacement
 * changes the integrity digest, so a stored conformant verdict never survives
 * a silent adapter swap — the digest is checked against the live integrity
 * before the verdict is trusted.
 */
export type BrowserUseConformanceEvidence = {
	proof_kind: BrowserUseConformanceProofKind;
	evaluated_at_epoch_ms: number;
	implementation_integrity_digest: string;
};

/** One matrix cell: exactly one verdict for one lane × dimension. */
export type BrowserUseConformanceCell =
	| {
			lane_id: BrowserUseAdapterLaneId;
			dimension: BrowserUseConformanceDimension;
			verdict: "conformant";
			evidence: BrowserUseConformanceEvidence;
	  }
	| {
			lane_id: BrowserUseAdapterLaneId;
			dimension: BrowserUseConformanceDimension;
			verdict: "nonconformant";
			cause: BrowserUseConformanceNonconformanceCause;
			evidence: BrowserUseConformanceEvidence;
	  }
	| {
			lane_id: BrowserUseAdapterLaneId;
			dimension: BrowserUseConformanceDimension;
			verdict: "unproven";
			gate: BrowserUseConformanceGate;
			next_action: string;
	  };

/** The composed cross-lane matrix. */
export type BrowserUseConformanceMatrix = {
	lanes: readonly BrowserUseAdapterLaneId[];
	dimensions: readonly BrowserUseConformanceDimension[];
	cells: readonly BrowserUseConformanceCell[];
	/** Deterministic digest over every cell's material verdict. */
	matrix_digest: string;
};

// --- Lane conformance shape -----------------------------------------------------

/**
 * How much of each dimension a lane can prove at CONTRACT level right now. A
 * lane with an implemented native execution Interface can drive the pure
 * transaction FSM, prove containment, and prove restart/resume against fakes;
 * the DELIVERY outcome of a real login still needs the live gate. A lane whose
 * native Implementation is absent cannot even preserve same-lane execution, so
 * every dimension is gated. This is derived from the code-owned lane table —
 * there is no second capability source.
 */
type LaneContractCapability = {
	/** The lane can drive the pure transaction FSM and containment gate now. */
	contract_provable: boolean;
	/** The gate that holds the lane's live-only dimensions unproven. */
	live_gate: BrowserUseConformanceGate;
};

function laneContractCapability(
	laneId: BrowserUseAdapterLaneId,
): LaneContractCapability {
	const implemented =
		BROWSER_USE_ADAPTER_LANE_TABLE[laneId].native_implementation.implemented;
	if (!implemented) {
		// The only lane without a native Implementation in this release is
		// playwright-cdp (operator-gated on install). Its gate names install.
		return {
			contract_provable: false,
			live_gate:
				laneId === "playwright-cdp"
					? "playwright-not-installed"
					: "native-port-absent",
		};
	}
	return { contract_provable: true, live_gate: "live-idp-required" };
}

// Which live gate a delivery dimension needs once its contract shape passes.
// Session reuse and password/OTP delivery reach a real login outcome only
// against a live portal/IdP; human continuation needs the native user-presence
// port. Non-delivery safety dimensions are fully contract-provable.
const DELIVERY_LIVE_GATE: Readonly<
	Partial<Record<BrowserUseConformanceDimension, BrowserUseConformanceGate>>
> = {
	"password-delivery": "live-idp-required",
	"current-otp-delivery": "live-idp-required",
	"session-reuse": "live-portal-required",
	"human-continuation": "native-port-absent",
};

// --- Contract-level checks (provable now with fakes) ----------------------------

const OK_INTEGRITY: BrowserUseLaneImplementationIntegrity = {
	executable_realpath: "/conformance/fake",
	content_digest: "fake-content-digest",
	dependency_lock_identity: "fake-lock",
	protocol_fingerprint: "fake-protocol",
	platform: "conformance-harness",
	security_policy_revision: "conformance-1",
};

function bindingFor(
	laneId: BrowserUseAdapterLaneId,
): BrowserUseAuthTransactionBinding {
	return {
		run_id: `conformance-${laneId}`,
		handoff_evidence_id: `handoff-${laneId}`,
		lane_id: laneId,
		environment: "conformance",
		profile: "conformance",
		service_id: "conformance-service",
		auth_context: "interactive-login",
		origin: "conformance-origin",
		target_id: "conformance-target",
		page_id: "conformance-page",
		frame_id: "conformance-frame",
	};
}

/**
 * Drive one event sequence through the pure U2 FSM from a fresh transaction.
 * Returns the final fragment when every step was legal, or a rejection code at
 * the first illegal step — that rejection IS the nonconformance signal.
 */
function driveChoreography(
	laneId: BrowserUseAdapterLaneId,
	method: BrowserUseLaneAuthMethod,
	events: readonly BrowserUseAuthTransactionEvent[],
): { ok: true; fragment: BrowserUseAuthTransactionFragment } | { ok: false } {
	const begun = beginAuthTransaction({
		binding: bindingFor(laneId),
		method,
		attempt_limit: 3,
		attempts_already_consumed: 0,
	});
	if (!begun.ok) return { ok: false };
	let fragment = begun.fragment;
	for (const event of events) {
		const step: BrowserUseAuthTransitionResult = applyAuthTransition(
			fragment,
			event,
		);
		if (!step.ok) return { ok: false };
		fragment = step.fragment;
	}
	return { ok: true, fragment };
}

function methodStep(
	step: BrowserUseAuthMethodStep,
): BrowserUseAuthTransactionEvent {
	return { type: "method-step-complete", step };
}

function submitOutcome(
	outcome: BrowserUseAuthSubmitOutcome,
): BrowserUseAuthTransactionEvent {
	return { type: "submit-outcome-observed", outcome };
}

const IDENTITY_BASIS: BrowserUseAuthIdentityBasis = "session-identity-proof";

// The password choreography (R15): pre-auth → prep → lease → sensitive interval
// (identify → username → submit-username → reprove → password) → dispatch →
// success → cleanup → post-auth proof → attestation → terminal authenticated.
function passwordChoreographyEvents(): BrowserUseAuthTransactionEvent[] {
	return [
		{ type: "pre-auth-proved" },
		{ type: "preparation-complete" },
		{ type: "lease-granted" },
		methodStep("identify-auth-state"),
		methodStep("fill-username"),
		methodStep("submit-username"),
		methodStep("reprove-target"),
		methodStep("fill-password"),
		{ type: "submission-dispatched" },
		submitOutcome("success"),
		{ type: "cleanup-complete" },
		{
			type: "postcondition-proven",
			identity_basis: IDENTITY_BASIS,
			identity_basis_digest: "conformance-basis-digest",
		},
		{
			type: "attestation-issued",
			attestation_digest: "conformance-attestation-digest",
			fresh_until_epoch_ms: 4_102_444_800_000,
		},
	];
}

// The OTP re-entry choreography (R12): after a password submit yields
// otp-required, cleanup returns to the sensitive interval, the target is
// re-proven, the current OTP is filled and dispatched, and success attests.
function otpChoreographyEvents(): BrowserUseAuthTransactionEvent[] {
	return [
		{ type: "pre-auth-proved" },
		{ type: "preparation-complete" },
		{ type: "lease-granted" },
		methodStep("identify-auth-state"),
		methodStep("fill-username"),
		methodStep("submit-username"),
		methodStep("reprove-target"),
		methodStep("fill-password"),
		{ type: "submission-dispatched" },
		submitOutcome("otp-required"),
		{ type: "cleanup-complete" },
		methodStep("reprove-target"),
		methodStep("fill-otp"),
		{ type: "submission-dispatched" },
		submitOutcome("success"),
		{ type: "cleanup-complete" },
		{
			type: "postcondition-proven",
			identity_basis: IDENTITY_BASIS,
			identity_basis_digest: "conformance-basis-digest",
		},
		{
			type: "attestation-issued",
			attestation_digest: "conformance-attestation-digest",
			fresh_until_epoch_ms: 4_102_444_800_000,
		},
	];
}

// Session reuse (R25/KTD8): login is already complete, so the transaction goes
// straight to post-auth proof and mints a bounded attestation with no secret
// delivery at all.
function sessionReuseChoreographyEvents(): BrowserUseAuthTransactionEvent[] {
	return [
		{ type: "session-already-authenticated" },
		{
			type: "postcondition-proven",
			identity_basis: IDENTITY_BASIS,
			identity_basis_digest: "conformance-basis-digest",
		},
		{
			type: "attestation-issued",
			attestation_digest: "conformance-attestation-digest",
			fresh_until_epoch_ms: 4_102_444_800_000,
		},
	];
}

// Human continuation (R20): a user-presence challenge blocks the transaction
// with the awaiting-user-presence continuation rather than proceeding — the
// contract-provable half of human continuation is that the FSM pauses safely
// and offers exactly one continuation.
function humanContinuationEvents(): BrowserUseAuthTransactionEvent[] {
	return [{ type: "blocked", cause: "user-presence-required" }];
}

// Cleanup (R18): a cleanup-failed event blocks with a cleanup-failure cause and
// its repair continuation; a cleanup-complete after a wrong-password submit
// blocks on the credential cause (cleanup always runs before the consequence).
function cleanupChoreographyEvents(): BrowserUseAuthTransactionEvent[] {
	return [
		{ type: "pre-auth-proved" },
		{ type: "preparation-complete" },
		{ type: "lease-granted" },
		methodStep("identify-auth-state"),
		methodStep("reprove-target"),
		methodStep("fill-password"),
		{ type: "submission-dispatched" },
		submitOutcome("wrong-password"),
		{ type: "cleanup-complete" },
	];
}

/**
 * Prove the FSM choreography for one delivery dimension holds at contract
 * level for the lane under test — the transaction is driven through the shared
 * U2 FSM under THIS lane's binding, so the verdict belongs to `laneId`, not a
 * borrowed one. Returns whether every step was legal AND (for terminal
 * choreographies) the transaction reached the expected terminal shape. A
 * failure here is a `choreography-illegal-transition` nonconformance, not a gate.
 */
function checkChoreography(
	laneId: BrowserUseAdapterLaneId,
	dimension: BrowserUseConformanceDimension,
): {
	passed: boolean;
} {
	switch (dimension) {
		case "password-delivery": {
			const result = driveChoreography(
				laneId,
				"password",
				passwordChoreographyEvents(),
			);
			return {
				passed:
					result.ok &&
					result.fragment.status === "terminal" &&
					result.fragment.terminal_outcome === "authenticated",
			};
		}
		case "current-otp-delivery": {
			const result = driveChoreography(
				laneId,
				"otp",
				otpChoreographyEvents(),
			);
			return {
				passed:
					result.ok &&
					result.fragment.status === "terminal" &&
					result.fragment.terminal_outcome === "authenticated",
			};
		}
		case "session-reuse": {
			const result = driveChoreography(
				laneId,
				"session-reuse",
				sessionReuseChoreographyEvents(),
			);
			return {
				passed:
					result.ok &&
					result.fragment.status === "terminal" &&
					result.fragment.terminal_outcome === "authenticated",
			};
		}
		case "human-continuation": {
			const result = driveChoreography(
				laneId,
				"user-presence",
				humanContinuationEvents(),
			);
			return {
				passed:
					result.ok &&
					result.fragment.status === "blocked" &&
					result.fragment.blocked_cause === "user-presence-required" &&
					result.fragment.continuation !== null,
			};
		}
		case "cleanup": {
			const result = driveChoreography(
				laneId,
				"password",
				cleanupChoreographyEvents(),
			);
			return {
				passed:
					result.ok &&
					result.fragment.status === "blocked" &&
					result.fragment.blocked_cause === "wrong-password",
			};
		}
		default:
			return { passed: false };
	}
}

/**
 * Prove containment at contract level (R17/R18/AE5): after a marked sensitive
 * run, a sweep of governed surfaces carrying NO sentinel bytes proves release;
 * a surface carrying a sentinel proves the guard would REFUSE release. Both
 * directions run, so the check proves the gate is real, not merely absent.
 */
function checkContainment(): { passed: boolean } {
	const begun = beginSensitiveRunGuard("conformance-run");
	if (!begun.ok) return { passed: false };
	const sentinel = "SENTINEL-conformance-secret-value";
	const marked = markRunSensitive(begun.guard, {
		trigger: "confidential-field-delivery",
		sentinels: [sentinel],
	});
	if (!marked.ok) return { passed: false };
	const cleanSurfaces: BrowserUseGovernedSurface[] = [
		{ kind: "stdout-envelope", label: "envelope", content: "{\"ok\":true}" },
		{ kind: "run-store-file", label: "run.json", content: "phase=cleanup" },
		{ kind: "crash-surface", label: "error", content: "no secret here" },
	];
	const released = assertContainmentBeforeRelease(marked.guard, cleanSurfaces);
	if (!released.release) return { passed: false };
	// Negative direction: a leaked sentinel must REFUSE release.
	const leakedSurfaces: BrowserUseGovernedSurface[] = [
		{ kind: "log", label: "adapter.log", content: `value=${sentinel}` },
	];
	const refused = assertContainmentBeforeRelease(marked.guard, leakedSurfaces);
	return { passed: refused.release === false };
}

/**
 * Prove the restart/resume rule (R19/AE11) for the lane under test: an in-flight
 * write-ahead fragment resumes as unknown-post-submit-state (the consumed
 * attempt stays consumed); a clean active fragment resumes at pre-auth proof; a
 * blocked fragment is preserved verbatim. All three arms run under THIS lane's
 * binding, so the verdict belongs to `laneId`.
 */
function checkRestartResume(laneId: BrowserUseAdapterLaneId): {
	passed: boolean;
} {
	// In-flight arm: drive to a dispatched submission, then resume.
	const inFlight = driveChoreography(laneId, "password", [
		{ type: "pre-auth-proved" },
		{ type: "preparation-complete" },
		{ type: "lease-granted" },
		methodStep("identify-auth-state"),
		methodStep("reprove-target"),
		methodStep("fill-password"),
		{ type: "submission-dispatched" },
	]);
	if (!inFlight.ok) return { passed: false };
	const resumedInFlight = resumeAuthTransactionAfterRestart(inFlight.fragment);
	if (
		!resumedInFlight.ok ||
		resumedInFlight.fragment.status !== "blocked" ||
		resumedInFlight.fragment.blocked_cause !== "unknown-post-submit-state" ||
		resumedInFlight.fragment.attempt.consumed !== 1
	) {
		return { passed: false };
	}
	// Clean active arm: a fragment before any submission restarts at pre-auth.
	const cleanActive = driveChoreography(laneId, "password", [
		{ type: "pre-auth-proved" },
		{ type: "preparation-complete" },
	]);
	if (!cleanActive.ok) return { passed: false };
	const resumedClean = resumeAuthTransactionAfterRestart(cleanActive.fragment);
	if (
		!resumedClean.ok ||
		resumedClean.fragment.phase !== "pre-auth-proof" ||
		resumedClean.fragment.status !== "active"
	) {
		return { passed: false };
	}
	// Blocked arm: a blocked fragment is preserved verbatim on resume.
	const blocked = driveChoreography(laneId, "password", [
		{ type: "blocked", cause: "target-proof-invalid" },
	]);
	if (!blocked.ok) return { passed: false };
	const resumedBlocked = resumeAuthTransactionAfterRestart(blocked.fragment);
	return {
		passed:
			resumedBlocked.ok &&
			resumedBlocked.fragment.status === "blocked" &&
			resumedBlocked.fragment.blocked_cause === "target-proof-invalid",
	};
}

/**
 * Prove transaction invalidation at contract level (R14 revocation / lane
 * resume safety): a revoked binding blocks in preparation and cannot proceed to
 * delivery, and a target-proof loss forces a re-prove restart rather than a
 * silent resume into a stale sensitive interval. Driven under THIS lane's
 * binding, so the verdict belongs to `laneId`. This is the contract-provable
 * half of revocation and lane-resume; the live half stays gated.
 */
function checkInvalidation(
	laneId: BrowserUseAdapterLaneId,
	dimension: BrowserUseConformanceDimension,
): {
	passed: boolean;
} {
	if (dimension === "revocation") {
		// A revoked binding raised in preparation must block, never deliver.
		const result = driveChoreography(laneId, "password", [
			{ type: "pre-auth-proved" },
			{ type: "blocked", cause: "revoked-binding" },
		]);
		return {
			passed:
				result.ok &&
				result.fragment.status === "blocked" &&
				result.fragment.blocked_cause === "revoked-binding",
		};
	}
	// lane-resume: a target-proof loss inside the sensitive interval blocks, and
	// its resolution restarts at pre-auth (never resumes into a stale interval).
	const blocked = driveChoreography(laneId, "password", [
		{ type: "pre-auth-proved" },
		{ type: "preparation-complete" },
		{ type: "lease-granted" },
		methodStep("identify-auth-state"),
		{ type: "blocked", cause: "target-proof-invalid" },
	]);
	if (!blocked.ok || blocked.fragment.status !== "blocked") {
		return { passed: false };
	}
	const resolved = applyAuthTransition(blocked.fragment, {
		type: "blocked-cause-resolved",
	});
	return {
		passed:
			resolved.ok &&
			resolved.fragment.phase === "pre-auth-proof" &&
			resolved.fragment.status === "active",
	};
}

// Which contract-level proof kind each dimension exercises.
const DIMENSION_PROOF_KIND: Readonly<
	Record<BrowserUseConformanceDimension, BrowserUseConformanceProofKind>
> = {
	"password-delivery": "transaction-choreography",
	"current-otp-delivery": "transaction-choreography",
	"session-reuse": "transaction-choreography",
	"human-continuation": "transaction-choreography",
	"restart-resume": "restart-resume-rule",
	cleanup: "transaction-choreography",
	revocation: "transaction-invalidation",
	"lane-resume": "transaction-invalidation",
};

// The nonconformance cause each proof kind reports when its check fails.
const PROOF_FAIL_CAUSE: Readonly<
	Record<BrowserUseConformanceProofKind, BrowserUseConformanceNonconformanceCause>
> = {
	"transaction-choreography": "choreography-illegal-transition",
	"containment-sweep": "containment-leak",
	"restart-resume-rule": "restart-resume-wrong-state",
	"transaction-invalidation": "invalidation-not-enforced",
};

// --- The runner -----------------------------------------------------------------

/** Inputs the runner needs beyond the code-owned tables. */
export type BrowserUseConformanceRunInput = {
	/** Evaluation clock (epoch ms); stamped onto every decided cell's evidence. */
	at_epoch_ms: number;
	/**
	 * Per-lane live Implementation integrity, keyed by lane id. Present only for
	 * lanes whose live integrity is known; a decided cell binds to this digest so
	 * a later silent adapter swap invalidates the stored verdict. Absent lanes
	 * bind to a stable conformance-harness digest (the contract proof does not
	 * depend on a live binary).
	 */
	integrity_by_lane?: Partial<
		Record<BrowserUseAdapterLaneId, BrowserUseLaneImplementationIntegrity>
	>;
};

function integrityDigestFor(
	laneId: BrowserUseAdapterLaneId,
	input: BrowserUseConformanceRunInput,
): string {
	const integrity = input.integrity_by_lane?.[laneId] ?? OK_INTEGRITY;
	return createHash("sha256").update(integrityKeyOf(integrity)).digest("hex");
}

/**
 * Run the contract-level check for one lane × dimension. Every proof drives the
 * shared U2 FSM under THIS lane's binding, so the pass/fail is the lane's own
 * verdict — no cell borrows another lane's result. The containment sweep is a
 * transaction-guard property with no lane-specific binding, so cleanup composes
 * it as a second gate. Returns pass/fail; the caller decides conformant vs
 * nonconformant.
 */
function runContractCheck(
	laneId: BrowserUseAdapterLaneId,
	dimension: BrowserUseConformanceDimension,
): {
	passed: boolean;
} {
	const proofKind = DIMENSION_PROOF_KIND[dimension];
	if (proofKind === "restart-resume-rule") return checkRestartResume(laneId);
	if (proofKind === "transaction-invalidation") {
		return checkInvalidation(laneId, dimension);
	}
	// choreography — cleanup shares the containment sweep as a second gate so a
	// conformant cleanup also proves no sentinel escaped the cleared field.
	const choreography = checkChoreography(laneId, dimension);
	if (dimension === "cleanup") {
		const containment = checkContainment();
		return { passed: choreography.passed && containment.passed };
	}
	return choreography;
}

function decidedCell(
	laneId: BrowserUseAdapterLaneId,
	dimension: BrowserUseConformanceDimension,
	passed: boolean,
	input: BrowserUseConformanceRunInput,
): BrowserUseConformanceCell {
	const evidence: BrowserUseConformanceEvidence = {
		proof_kind: DIMENSION_PROOF_KIND[dimension],
		evaluated_at_epoch_ms: input.at_epoch_ms,
		implementation_integrity_digest: integrityDigestFor(laneId, input),
	};
	if (passed) {
		return { lane_id: laneId, dimension, verdict: "conformant", evidence };
	}
	return {
		lane_id: laneId,
		dimension,
		verdict: "nonconformant",
		cause: PROOF_FAIL_CAUSE[DIMENSION_PROOF_KIND[dimension]],
		evidence,
	};
}

function unprovenCell(
	laneId: BrowserUseAdapterLaneId,
	dimension: BrowserUseConformanceDimension,
	gate: BrowserUseConformanceGate,
): BrowserUseConformanceCell {
	return {
		lane_id: laneId,
		dimension,
		verdict: "unproven",
		gate,
		next_action: BROWSER_USE_CONFORMANCE_GATE_TABLE[gate],
	};
}

/**
 * Decide one lane × dimension cell. The rule, in order:
 *
 * 1. A lane that cannot even drive the contract FSM (no native Implementation)
 *    is `unproven` on EVERY dimension behind its install/native gate — it
 *    cannot preserve same-lane execution, so nothing is provable.
 * 2. A DELIVERY dimension (password/OTP/session-reuse/human-continuation)
 *    running on a contract-provable lane proves its choreography but still
 *    reaches a real login outcome only live; it is `unproven` behind the
 *    delivery live gate EVEN WHEN the contract shape passes. This is the honest
 *    line: the FSM is proven, the live outcome is not.
 * 3. A SAFETY dimension (restart-resume, cleanup, revocation, lane-resume) is
 *    fully contract-provable now — it decides conformant/nonconformant.
 */
function decideCell(
	laneId: BrowserUseAdapterLaneId,
	dimension: BrowserUseConformanceDimension,
	input: BrowserUseConformanceRunInput,
): BrowserUseConformanceCell {
	const capability = laneContractCapability(laneId);
	if (!capability.contract_provable) {
		return unprovenCell(laneId, dimension, capability.live_gate);
	}
	const deliveryGate = DELIVERY_LIVE_GATE[dimension];
	if (deliveryGate !== undefined) {
		// The choreography must still hold at contract level; a lane whose FSM
		// shape is broken is nonconformant, not merely unproven. Only a passing
		// shape earns the honest "proven-shape, unproven-live" gate.
		const check = runContractCheck(laneId, dimension);
		if (!check.passed) return decidedCell(laneId, dimension, false, input);
		return unprovenCell(laneId, dimension, deliveryGate);
	}
	const check = runContractCheck(laneId, dimension);
	return decidedCell(laneId, dimension, check.passed, input);
}

/**
 * Deterministic digest over one cell's material verdict. A verdict, gate, or
 * cause change flips the digest so a consumer fencing on `matrix_digest` never
 * treats two materially different matrices as identical. The evaluation clock
 * is EXCLUDED so a re-run with the same verdicts produces the same digest.
 */
function conformanceCellKey(cell: BrowserUseConformanceCell): unknown[] {
	if (cell.verdict === "conformant") {
		return [
			cell.lane_id,
			cell.dimension,
			cell.verdict,
			cell.evidence.proof_kind,
			cell.evidence.implementation_integrity_digest,
		];
	}
	if (cell.verdict === "nonconformant") {
		return [
			cell.lane_id,
			cell.dimension,
			cell.verdict,
			cell.cause,
			cell.evidence.proof_kind,
			cell.evidence.implementation_integrity_digest,
		];
	}
	return [cell.lane_id, cell.dimension, cell.verdict, cell.gate];
}

/**
 * Run the full cross-lane conformance matrix (U9, L190). Every lane × every
 * dimension gets exactly one typed verdict. Contract-provable safety
 * dimensions decide now; delivery dimensions prove their choreography and stay
 * honestly `unproven` behind their live gate; lanes without a native
 * Implementation are `unproven` behind their install/native gate. The matrix
 * fabricates no conformance — `unproven` is the honest default wherever a live
 * gate or an absent port blocks proof.
 *
 * @param input - Evaluation clock and optional per-lane live integrity
 * @returns The composed matrix with its deterministic digest
 */
export function runAuthConformanceMatrix(
	input: BrowserUseConformanceRunInput,
): BrowserUseConformanceMatrix {
	const cells: BrowserUseConformanceCell[] = [];
	for (const laneId of BROWSER_USE_ADAPTER_LANE_IDS) {
		for (const dimension of BROWSER_USE_CONFORMANCE_DIMENSIONS) {
			cells.push(decideCell(laneId, dimension, input));
		}
	}
	const matrixDigest = createHash("sha256")
		.update(JSON.stringify(cells.map(conformanceCellKey)))
		.digest("hex")
		.slice(0, 32);
	return {
		lanes: [...BROWSER_USE_ADAPTER_LANE_IDS],
		dimensions: [...BROWSER_USE_CONFORMANCE_DIMENSIONS],
		cells,
		matrix_digest: matrixDigest,
	};
}

// --- Publishing to the adapter registry (R22, R5) -------------------------------

/**
 * The auth-method claims one lane's conformance matrix publishes as
 * `auth-conformance` evidence (R22/R5). A method is claimed only when its
 * DELIVERY dimension is `conformant` for that lane — an `unproven` (live-gated
 * or install-gated) or `nonconformant` dimension advertises nothing, so
 * `advertised_auth_methods` in the registry can never exceed what conformance
 * actually proved. Since delivery dimensions stay `unproven` until their live
 * gate clears, this returns an empty claim set for every lane at contract
 * level today — the honest current state — and starts advertising methods only
 * once live conformance flips a delivery cell to `conformant`.
 *
 * The returned array is deduplicated and ordered by the lane auth-method
 * vocabulary so the registry's digest is stable across runs.
 *
 * @param matrix - A composed conformance matrix
 * @param laneId - The lane to extract auth-method claims for
 * @returns The conformant auth-method claims, registry-vocabulary-ordered
 */
export function conformanceEvidenceClaims(
	matrix: BrowserUseConformanceMatrix,
	laneId: BrowserUseAdapterLaneId,
): BrowserUseLaneAuthMethod[] {
	const claimed = new Set<BrowserUseLaneAuthMethod>();
	for (const cell of matrix.cells) {
		if (cell.lane_id !== laneId || cell.verdict !== "conformant") continue;
		const method = BROWSER_USE_CONFORMANCE_METHOD_DIMENSIONS[cell.dimension];
		if (method !== undefined) claimed.add(method);
	}
	// Order by the registry's auth-method vocabulary for a stable digest.
	const ordered: BrowserUseLaneAuthMethod[] = [];
	for (const method of [
		"session-reuse",
		"password",
		"otp",
		"user-presence",
	] as const) {
		if (claimed.has(method)) ordered.push(method);
	}
	return ordered;
}
