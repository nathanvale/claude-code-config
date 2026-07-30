// ---------------------------------------------------------------------------
// Browser Authentication facade (auth plan 2026-07-21-003 U2, R6, R21,
// R27-R30; AE11).
//
// The ONE seam between the auth transaction and the shared run: implements
// the platform's BrowserUseAuthContractPort (secret-free fragment admission
// and attestation binding verification) and maps one fragment onto the
// commit summary the run integration Port persists atomically against the
// prior run revision (R6, KTD10). Auth never writes the run store — every
// outcome flows through `commitAuthTransaction` into the injected Port. The
// attestation source is injected because U2 is pure: platform code owns
// where attestation records live; verification here recomputes the digest
// and rejects any drift between the record and the observed run facts.
// ---------------------------------------------------------------------------

import type {
	BrowserUseAuthCommitResult,
	BrowserUseAuthCommitSummary,
	BrowserUseAuthContractPort,
	BrowserUseRunIntegrationPort,
} from "./browser-use-run-model";
import {
	type BrowserUseAuthAttestation,
	type BrowserUseSessionIdentityObservationV1,
	type BrowserUseAuthTransactionFragment,
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
	BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
	authAttestationDigestOf,
	isBrowserUseSessionIdentityObservationV1,
	sessionIdentityObservationDigestOf,
	validateAuthFragmentShape,
} from "./browser-use-auth-model";

/** Every expected coordinate pinned by the Session Identity Proof consumer. */
export type BrowserUseSessionIdentityExpectation = {
	verifier_action_id: string;
	verifier_action_digest: string;
	lane_id: BrowserUseSessionIdentityObservationV1["lane_id"];
	run_id: string;
	handoff_evidence_id: string;
	environment: string;
	profile: string;
	target_id: string;
	page_id: string;
	frame_id: string;
	top_level_origin: string;
	frame_origin: string;
	target_proof_digest: string;
	subject_reference: string;
	account_reference: string;
	tenant_reference: string;
	observed_at_epoch_ms: number;
	fresh_until_epoch_ms: number;
	implementation_integrity_key: string;
	service_id: string;
	auth_context: string;
	at_epoch_ms: number;
};

/** Typed result of verifying one observed authenticated browser session. */
export type BrowserUseSessionIdentityVerificationResult =
	| {
			ok: true;
			identity_basis_digest: string;
			attestation: BrowserUseAuthAttestation;
			attestation_digest: string;
	  }
	| {
			ok: false;
			cause:
				| "observation-invalid"
				| "observation-stale"
				| "expectation-invalid"
				| "verifier-mismatch"
				| "binding-mismatch"
				| "identity-mismatch";
	  };

const SESSION_EXPECTATION_REFERENCE =
	/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const SESSION_EXPECTATION_DIGEST = /^[0-9a-f]{64}$/;

function sessionExpectationOriginIsExact(value: string): boolean {
	try {
		const origin = new URL(value);
		return (
			(origin.protocol === "https:" || origin.protocol === "http:") &&
			origin.origin === value
		);
	} catch {
		return false;
	}
}

function sessionIdentityExpectationIsValid(
	expected: BrowserUseSessionIdentityExpectation,
): boolean {
	for (const key of [
		"verifier_action_id",
		"run_id",
		"handoff_evidence_id",
		"environment",
		"profile",
		"target_id",
		"page_id",
		"frame_id",
		"subject_reference",
		"account_reference",
		"tenant_reference",
		"implementation_integrity_key",
		"service_id",
		"auth_context",
	] as const) {
		if (!SESSION_EXPECTATION_REFERENCE.test(expected[key])) return false;
	}
	return (
		SESSION_EXPECTATION_DIGEST.test(expected.verifier_action_digest) &&
		SESSION_EXPECTATION_DIGEST.test(expected.target_proof_digest) &&
		sessionExpectationOriginIsExact(expected.top_level_origin) &&
		sessionExpectationOriginIsExact(expected.frame_origin) &&
		Number.isSafeInteger(expected.observed_at_epoch_ms) &&
		expected.observed_at_epoch_ms >= 0 &&
		Number.isSafeInteger(expected.fresh_until_epoch_ms) &&
		expected.fresh_until_epoch_ms > expected.observed_at_epoch_ms &&
		expected.fresh_until_epoch_ms - expected.observed_at_epoch_ms <=
			60_000 &&
		Number.isSafeInteger(expected.at_epoch_ms) &&
		expected.at_epoch_ms >= expected.observed_at_epoch_ms
	);
}

/**
 * Verify one closed Session Identity Proof and mint its bounded attestation.
 *
 * The verifier compares the reviewed action, every run/handoff/browser
 * binding, both origins, the native target digest, and all redacted identity
 * references. Only the full observation digest can become the identity basis.
 */
export function verifyBrowserUseSessionIdentityObservation(
	value: unknown,
	expected: BrowserUseSessionIdentityExpectation,
): BrowserUseSessionIdentityVerificationResult {
	if (!isBrowserUseSessionIdentityObservationV1(value)) {
		return { ok: false, cause: "observation-invalid" };
	}
	if (!sessionIdentityExpectationIsValid(expected)) {
		return { ok: false, cause: "expectation-invalid" };
	}
	if (expected.at_epoch_ms < value.observed_at_epoch_ms) {
		return { ok: false, cause: "expectation-invalid" };
	}
	if (expected.at_epoch_ms > value.fresh_until_epoch_ms) {
		return { ok: false, cause: "observation-stale" };
	}
	if (
		value.verifier_action_id !== expected.verifier_action_id ||
		value.verifier_action_digest !== expected.verifier_action_digest
	) {
		return { ok: false, cause: "verifier-mismatch" };
	}
	for (const key of [
		"lane_id",
		"run_id",
		"handoff_evidence_id",
		"environment",
		"profile",
		"target_id",
		"page_id",
		"frame_id",
		"top_level_origin",
		"frame_origin",
		"target_proof_digest",
		"observed_at_epoch_ms",
		"fresh_until_epoch_ms",
	] as const) {
		if (value[key] !== expected[key]) {
			return { ok: false, cause: "binding-mismatch" };
		}
	}
	for (const key of [
		"subject_reference",
		"account_reference",
		"tenant_reference",
	] as const) {
		if (value[key] !== expected[key]) {
			return { ok: false, cause: "identity-mismatch" };
		}
	}
	const identityBasisDigest = sessionIdentityObservationDigestOf(value);
	const attestation: BrowserUseAuthAttestation = {
		run_id: value.run_id,
		handoff_evidence_id: value.handoff_evidence_id,
		lane_id: value.lane_id,
		implementation_integrity_key: expected.implementation_integrity_key,
		environment: value.environment,
		profile: value.profile,
		target_id: value.target_id,
		page_id: value.page_id,
		frame_id: value.frame_id,
		service_id: expected.service_id,
		auth_context: expected.auth_context,
		subject_reference: value.subject_reference,
		account_reference: value.account_reference,
		tenant_reference: value.tenant_reference,
		identity_basis: "session-identity-proof",
		identity_basis_digest: identityBasisDigest,
		observed_at_epoch_ms: value.observed_at_epoch_ms,
		fresh_until_epoch_ms: value.fresh_until_epoch_ms,
	};
	return {
		ok: true,
		identity_basis_digest: identityBasisDigest,
		attestation,
		attestation_digest: authAttestationDigestOf(attestation),
	};
}

// --- The auth contract Port implementation (R6, R30) ------------------------------

/** Injected attestation lookup: platform code owns where records live. The
 * production source is the durable store (`attestationByDigestFrom` in
 * `browser-use-runs.ts`), so the lookup may be async; a sync in-memory map
 * remains legal for tests. */
export type BrowserUseAuthContractDeps = {
	attestationByDigest: (
		digest: string,
	) =>
		| BrowserUseAuthAttestation
		| undefined
		| Promise<BrowserUseAuthAttestation | undefined>;
};

/**
 * Create the auth-owned runtime contract the platform invokes before
 * persistence and mutation (R6/R30). `validateSecretFreeFragment` is the
 * admission gate for the opaque fragment slot; `verifyAttestation`
 * recomputes the bounded attestation digest from the stored record and
 * rejects freshness, binding, or integrity drift against the observed run
 * facts — the platform never reconstructs auth-owned digests itself.
 *
 * @param deps - Injected attestation record lookup
 * @returns The contract Port the platform's run store consumes
 *
 * @example
 * ```typescript
 * const contract = createBrowserUseAuthContract({
 *   attestationByDigest: (digest) => store.get(digest),
 * })
 * const port = createRunIntegrationPort(deps, contract, lease)
 * ```
 */
export function createBrowserUseAuthContract(
	deps: BrowserUseAuthContractDeps,
): BrowserUseAuthContractPort {
	return {
		validateSecretFreeFragment(slot): boolean {
			if (slot.schema_version !== BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION) {
				return false;
			}
			return validateAuthFragmentShape(slot.fragment).length === 0;
		},
		async verifyAttestation(input): Promise<boolean> {
			const record = await deps.attestationByDigest(
				input.reference.attestation_digest,
			);
			if (record === undefined) return false;
			if (authAttestationDigestOf(record) !== input.reference.attestation_digest) {
				return false;
			}
			if (record.fresh_until_epoch_ms !== input.reference.fresh_until_epoch_ms) {
				return false;
			}
			if (input.at_epoch_ms > record.fresh_until_epoch_ms) return false;
			return (
				record.run_id === input.run_id &&
				record.lane_id === input.adapter_id &&
				record.handoff_evidence_id === input.handoff_evidence_id &&
				record.environment === input.environment_profile.environment &&
				record.profile === input.environment_profile.profile
			);
		},
	};
}

// --- Fragment → commit summary (R6, R21) -------------------------------------------

/** Typed summary-mapping rejection. */
export type BrowserUseAuthSummaryRejection = {
	code: "auth_fragment_invalid" | "auth_fragment_not_committable";
	message: string;
};

/** Summary-mapping result: one commit summary, or one typed rejection. */
export type BrowserUseAuthSummaryResult =
	| { ok: true; summary: BrowserUseAuthCommitSummary }
	| { ok: false; rejection: BrowserUseAuthSummaryRejection };

// The active-fragment progress continuation: an in-progress transaction
// keeps its run in `awaiting-auth` with exactly one next safe action —
// continue the transaction. Named here once so write-ahead persistence and
// ordinary progress commits agree.
const CONTINUE_TRANSACTION_CONTINUATION = {
	next_action_id: "continue-auth-transaction",
	summary: "The authentication transaction is mid-flight; continue it.",
} as const;

/**
 * Map one fragment onto the platform commit summary (R6). Terminal
 * authenticated → `ready` with its bounded attestation reference; blocked →
 * the cause's exactly-one platform state and continuation (R21); an active
 * fragment (including the write-ahead persistence point, R19) stays
 * `awaiting-auth` with the continue continuation. A cancelled fragment is
 * not committable through the auth summary — cancellation truth belongs to
 * the platform's cancel path, not to an auth outcome.
 *
 * @param fragment - Current fragment value
 * @returns One commit summary, or one typed rejection
 */
export function authCommitSummaryOf(
	fragment: BrowserUseAuthTransactionFragment,
): BrowserUseAuthSummaryResult {
	const issues = validateAuthFragmentShape(fragment);
	const firstIssue = issues[0];
	if (firstIssue !== undefined) {
		return {
			ok: false,
			rejection: {
				code: "auth_fragment_invalid",
				message: `fragment is inadmissible (${firstIssue.code} at ${firstIssue.path}).`,
			},
		};
	}
	if (fragment.terminal_outcome === "authenticated") {
		if (
			fragment.attestation_digest === null ||
			fragment.fresh_until_epoch_ms === null
		) {
			return {
				ok: false,
				rejection: {
					code: "auth_fragment_not_committable",
					message: "an authenticated fragment must carry its attestation.",
				},
			};
		}
		return {
			ok: true,
			summary: {
				state: "ready",
				attestation: {
					attestation_digest: fragment.attestation_digest,
					fresh_until_epoch_ms: fragment.fresh_until_epoch_ms,
				},
			},
		};
	}
	if (fragment.terminal_outcome === "cancelled") {
		return {
			ok: false,
			rejection: {
				code: "auth_fragment_not_committable",
				message:
					"a cancelled transaction commits through the platform cancel path, not an auth outcome.",
			},
		};
	}
	if (fragment.status === "blocked" && fragment.blocked_cause !== null) {
		const entry = BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[fragment.blocked_cause];
		return {
			ok: true,
			summary: {
				state: entry.run_state,
				continuation: { ...entry.continuation },
			},
		};
	}
	return {
		ok: true,
		summary: {
			state: "awaiting-auth",
			continuation: { ...CONTINUE_TRANSACTION_CONTINUATION },
		},
	};
}

// --- Commit through the integration Port (R6, KTD10) --------------------------------

/** Typed commit refusal raised before the Port is ever called. */
export type BrowserUseAuthCommitRefusal =
	| { ok: false; rejection: BrowserUseAuthSummaryRejection };

/**
 * Commit one fragment plus its derived summary atomically against the prior
 * run revision (R6, KTD10). The ONLY path an auth outcome takes into the
 * shared run: the injected Port is platform-owned; auth code never touches
 * run persistence. A fragment that cannot produce a summary never reaches
 * the Port.
 *
 * @param port - Platform-owned run integration Port
 * @param input - Run id, expected revision, and the fragment to commit
 * @returns The Port's commit result, or one typed pre-Port refusal
 */
export async function commitAuthTransaction(
	port: BrowserUseRunIntegrationPort,
	input: {
		run_id: string;
		expected_revision: number;
		fragment: BrowserUseAuthTransactionFragment;
	},
): Promise<BrowserUseAuthCommitResult | BrowserUseAuthCommitRefusal> {
	const mapped = authCommitSummaryOf(input.fragment);
	if (!mapped.ok) return mapped;
	return await port.commitAuthOutcome({
		run_id: input.run_id,
		expected_revision: input.expected_revision,
		fragment: {
			schema_version: BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
			fragment: input.fragment,
		},
		summary: mapped.summary,
	});
}
