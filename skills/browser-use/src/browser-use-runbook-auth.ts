import { emitCliDiagnostic } from "@side-quest/cli-command-facade";
import type { BrowserUseAuthContext, BrowserUseItemBinding } from "./browser-use-auth-bindings";
import {
	type BrowserUseAuthAttestation,
	type BrowserUseAuthBlockedCause,
	type BrowserUseAuthTransactionFragment,
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
	authAttestationDigestOf,
	validateAuthFragmentShape,
} from "./browser-use-auth-model";
import type { BrowserUseAuthProvider } from "./browser-use-auth-provider";
import { createBrowserUseAuthContract } from "./browser-use-auth";
import {
	applyAuthTransition,
	beginAuthTransaction,
	resumeAuthTransactionAfterRestart,
	type BrowserUseAuthTransactionEvent,
} from "./browser-use-auth-transaction";
import {
	runBrowserUseLoginEngine,
	type BrowserUseAuthenticatedStateProofRecord,
	type BrowserUseLoginEngineDeps,
	type BrowserUseLoginLifecycleEvent,
} from "./browser-use-login-engine";
import type { LeaseWriteClaim } from "./browser-use-locks";
import {
	type BrowserUseSharedRun,
	revalidateAuthAttestation,
} from "./browser-use-run-model";
import {
	type RunStoreDeps,
	attestationByDigestFrom,
	writeAuthAttestationRecord,
} from "./browser-use-runs";

export type BrowserUseRunbookAuthBlocked = {
	blocked_cause: BrowserUseAuthBlockedCause;
	continuation: {
		next_action_id: string;
		summary: string;
	};
};

export type BrowserUseRunbookAuthResult =
	| {
			ok: true;
			run: BrowserUseSharedRun;
			binding: BrowserUseItemBinding;
	  }
	| {
			ok: false;
			run: BrowserUseSharedRun;
			blocked: BrowserUseRunbookAuthBlocked;
	  }
	| {
			ok: false;
			run: BrowserUseSharedRun;
			failure: { code: string; message: string };
	  };

export type BrowserUseRunbookAuthDeps = {
	store: RunStoreDeps;
	provider: BrowserUseAuthProvider;
	login: Omit<BrowserUseLoginEngineDeps, "journal">;
	implementation_integrity_key: string;
	/** Dispatch one exact, auth-owned navigation before any login observation. */
	navigateToDeclaredTarget?: (input: {
		target_id: string;
		url: string;
	}) => Promise<{ ok: true } | { ok: false; cause: "target-proof-invalid" }>;
};

export type BrowserUseRunbookAuthInput = {
	run: BrowserUseSharedRun;
	dispatch_claim: LeaseWriteClaim;
	service_id: string;
	auth_context_ref: BrowserUseAuthContext;
	allowed_origins: readonly string[];
	expected_url: string;
	/** Fresh URL observed during target resolution. Only exact about:blank may bootstrap. */
	observed_url?: string;
	target_id: string;
};

function blockedOf(cause: BrowserUseAuthBlockedCause): BrowserUseRunbookAuthBlocked {
	return {
		blocked_cause: cause,
		continuation: structuredClone(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause].continuation,
		),
	};
}

function fragmentOf(run: BrowserUseSharedRun): BrowserUseAuthTransactionFragment | undefined {
	const candidate = run.auth_fragment?.fragment;
	return validateAuthFragmentShape(candidate).length === 0
		? (candidate as BrowserUseAuthTransactionFragment)
		: undefined;
}

function originOf(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.origin
			: undefined;
	} catch {
		return undefined;
	}
}

function expectedOriginIsAllowed(input: BrowserUseRunbookAuthInput): boolean {
	const expectedOrigin = originOf(input.expected_url);
	return (
		expectedOrigin !== undefined &&
		input.allowed_origins.some(
			(candidate) =>
				candidate === originOf(candidate) && candidate === expectedOrigin,
		)
	);
}

function authenticatedProofRefusal(
	proof: BrowserUseAuthenticatedStateProofRecord,
	input: BrowserUseRunbookAuthInput,
): "origin-mismatch" | "target-proof-invalid" | undefined {
	if (proof.target_id !== input.target_id) return "target-proof-invalid";
	const proofOrigin = originOf(proof.origin);
	const allowed = new Set(
		input.allowed_origins.flatMap((candidate) => {
			const normalized = originOf(candidate);
			return normalized === undefined ? [] : [normalized];
		}),
	);
	return proofOrigin === undefined || !allowed.has(proofOrigin)
		? "origin-mismatch"
		: undefined;
}

export async function runBrowserUseRunbookAuth(
	deps: BrowserUseRunbookAuthDeps,
	input: BrowserUseRunbookAuthInput,
): Promise<BrowserUseRunbookAuthResult> {
	let run = input.run;
	const persistedCandidate = run.auth_fragment?.fragment;
	if (
		run.auth_fragment !== undefined &&
		validateAuthFragmentShape(persistedCandidate).length > 0
	) {
		return {
			ok: false,
			run,
			failure: {
				code: "auth_fragment_invalid",
				message: "persisted authentication fragment is malformed or stale.",
			},
		};
	}
	let fragment = fragmentOf(run);
	let binding: BrowserUseItemBinding | undefined;
	let readyResume = false;
	let postSubmitProofResume = false;
	if (fragment !== undefined) {
		const expectedOrigin = originOf(input.expected_url);
		const stale =
			fragment.binding.run_id !== run.run_id ||
			fragment.binding.handoff_evidence_id !== run.handoff_evidence_id ||
			fragment.binding.lane_id !== "agent-browser" ||
			fragment.binding.environment !== run.environment_profile.environment ||
			fragment.binding.profile !== run.environment_profile.profile ||
			fragment.binding.service_id !== input.service_id ||
			fragment.binding.auth_context !== input.auth_context_ref ||
			fragment.binding.target_id !== input.target_id ||
			expectedOrigin === undefined ||
			fragment.binding.origin !== expectedOrigin;
		if (stale) {
			return {
				ok: false,
				run,
				failure: {
					code: "auth_fragment_invalid",
					message: "persisted authentication fragment does not match this run.",
				},
			};
		}
	}

	const commit = async (): Promise<{ ok: true } | { ok: false; code: string; message: string }> => {
		if (fragment === undefined) {
			return { ok: false, code: "auth_fragment_invalid", message: "authentication fragment is unavailable." };
		}
		const committed = await deps.provider.commitWithClaim(input.dispatch_claim, {
			run_id: run.run_id,
			expected_revision: run.revision,
			fragment,
		});
		if (!committed.ok) return { ok: false, ...committed.rejection };
		run = committed.run;
		return { ok: true };
	};

	const transition = async (
		event: BrowserUseAuthTransactionEvent,
	): Promise<{ ok: true } | { ok: false; code: string; message: string }> => {
		if (fragment === undefined) {
			return { ok: false, code: "auth_fragment_invalid", message: "authentication fragment is unavailable." };
		}
		const applied = applyAuthTransition(fragment, event);
		if (!applied.ok) return { ok: false, ...applied.rejection };
		fragment = applied.fragment;
		return await commit();
	};

	if (fragment !== undefined) {
		postSubmitProofResume =
			fragment.status === "active" &&
			(fragment.phase === "post-auth-proof" ||
				fragment.phase === "bounded-attestation");
		const resumed = resumeAuthTransactionAfterRestart(fragment);
		if (!resumed.ok) {
			return { ok: false, run, failure: resumed.rejection };
		}
		fragment = resumed.fragment;
		if (fragment.status === "blocked") {
			if (fragment.blocked_cause === null) {
				return { ok: false, run, failure: { code: "auth_fragment_invalid", message: "blocked authentication has no cause." } };
			}
			if (JSON.stringify(fragment) !== JSON.stringify(run.auth_fragment?.fragment)) {
				const persisted = await commit();
				if (!persisted.ok) return { ok: false, run, failure: persisted };
			}
			return { ok: false, run, blocked: blockedOf(fragment.blocked_cause) };
		}
		if (fragment.terminal_outcome === "authenticated") {
			readyResume = true;
		} else {
			const persisted = await commit();
			if (!persisted.ok) return { ok: false, run, failure: persisted };
		}
	}

	if (input.observed_url === "about:blank") {
		if (!expectedOriginIsAllowed(input)) {
			return { ok: false, run, blocked: blockedOf("origin-mismatch") };
		}
		const navigation = await deps.navigateToDeclaredTarget?.({
			target_id: input.target_id,
			url: input.expected_url,
		});
		if (navigation?.ok !== true) {
			return { ok: false, run, blocked: blockedOf("target-proof-invalid") };
		}
	}

	const loginPath = (() => {
		try {
			return new URL(input.expected_url).pathname;
		} catch {
			return null;
		}
	})();
	const prepared = await deps.provider.prepareSecretFree({
		service_id: input.service_id,
		auth_context: input.auth_context_ref,
		target_origins: input.allowed_origins,
		login_path: loginPath,
		method: "password",
		binding: null,
		candidate_hint: null,
	});
	if (prepared.ok) binding = prepared.binding ?? undefined;

	if (fragment === undefined) {
		const origin = originOf(input.expected_url);
		if (origin === undefined) {
			return { ok: false, run, blocked: blockedOf("origin-mismatch") };
		}
		const begun = beginAuthTransaction({
			binding: {
				run_id: run.run_id,
				handoff_evidence_id: run.handoff_evidence_id ?? "handoff-unbound",
				lane_id: "agent-browser",
				environment: run.environment_profile.environment,
				profile: run.environment_profile.profile,
				service_id: input.service_id,
				auth_context: input.auth_context_ref,
				origin,
				target_id: input.target_id,
				page_id: input.target_id,
				frame_id: input.target_id,
			},
			method: binding?.allowed_auth_methods.includes("otp") ? "otp" : "password",
			attempt_limit: 3,
			attempts_already_consumed: 0,
		});
		if (!begun.ok) return { ok: false, run, failure: begun.rejection };
		fragment = begun.fragment;
		const persisted = await commit();
		if (!persisted.ok) return { ok: false, run, failure: persisted };
	}

	if (fragment.phase === "pre-auth-proof") {
		const proved = await transition({ type: "pre-auth-proved" });
		if (!proved.ok) return { ok: false, run, failure: proved };
	}
	if (!prepared.ok) {
		const blocked = await transition(prepared.event);
		if (!blocked.ok) return { ok: false, run, failure: blocked };
		return { ok: false, run, blocked: blockedOf(prepared.event.cause) };
	}
	if (binding === undefined) {
		const cause = "capability-loss" as const;
		emitCliDiagnostic("browser-use.cli", "debug", "auth-binding-unavailable", {
			phase: fragment.phase,
			status: fragment.status,
			method_step: fragment.method_step,
		});
		const blocked = await transition({ type: "blocked", cause });
		if (!blocked.ok) return { ok: false, run, failure: blocked };
		return { ok: false, run, blocked: blockedOf(cause) };
	}
	const issueAttestation = async (
		proof: BrowserUseAuthenticatedStateProofRecord,
	): Promise<BrowserUseRunbookAuthResult> => {
		const proofRefusal = authenticatedProofRefusal(proof, input);
		if (proofRefusal !== undefined) {
			const refused = await transition({ type: "blocked", cause: proofRefusal });
			if (!refused.ok) return { ok: false, run, failure: refused };
			return { ok: false, run, blocked: blockedOf(proofRefusal) };
		}
		const postcondition = await transition({
			type: "postcondition-proven",
			identity_basis: "session-identity-proof",
			identity_basis_digest: proof.identity_basis_digest,
		});
		if (!postcondition.ok) return { ok: false, run, failure: postcondition };
		const observedAt = deps.store.clock();
		const attestation: BrowserUseAuthAttestation = {
			run_id: run.run_id,
			handoff_evidence_id: run.handoff_evidence_id ?? "handoff-unbound",
			lane_id: "agent-browser",
			implementation_integrity_key: deps.implementation_integrity_key,
			environment: run.environment_profile.environment,
			profile: run.environment_profile.profile,
			target_id: proof.target_id,
			page_id: proof.page_id,
			frame_id: proof.frame_id,
			service_id: input.service_id,
			auth_context: input.auth_context_ref,
			subject_reference: proof.subject_reference,
			account_reference: proof.account_reference,
			tenant_reference: proof.tenant_reference,
			identity_basis: "session-identity-proof",
			identity_basis_digest: proof.identity_basis_digest,
			observed_at_epoch_ms: observedAt,
			fresh_until_epoch_ms: observedAt + 30_000,
		};
		const digest = authAttestationDigestOf(attestation);
		const written = await writeAuthAttestationRecord(deps.store, {
			digest,
			record: attestation,
		});
		if (!written.ok) return { ok: false, run, failure: written };
		const issued = await transition({
			type: "attestation-issued",
			attestation_digest: digest,
			fresh_until_epoch_ms: attestation.fresh_until_epoch_ms,
		});
		return issued.ok
			? { ok: true, run, binding }
			: { ok: false, run, failure: issued };
	};
	if (postSubmitProofResume) {
		if (deps.login.proveAuthenticatedState === undefined) {
			const refused = await transition({
				type: "blocked",
				cause: "human-identity-attestation-required",
			});
			return refused.ok
				? {
						ok: false,
						run,
						blocked: blockedOf("human-identity-attestation-required"),
					}
				: { ok: false, run, failure: refused };
		}
		const observed = await deps.login.observer.snapshot({
			target_id: input.target_id,
		});
		if (!observed.ok) {
			const refused = await transition({
				type: "blocked",
				cause: "unknown-post-submit-state",
			});
			return refused.ok
				? { ok: false, run, blocked: blockedOf("unknown-post-submit-state") }
				: { ok: false, run, failure: refused };
		}
		const fresh = await deps.login.proveAuthenticatedState({
			lane_id: "agent-browser",
			run_id: run.run_id,
			target_id: input.target_id,
			expected_url: input.expected_url,
			allowed_origins: input.allowed_origins,
			binding,
			snapshot: observed.snapshot,
			transition: "post-submit",
		});
		if (!fresh.proven) {
			const refused = await transition({
				type: "blocked",
				cause: "unknown-post-submit-state",
			});
			return refused.ok
				? { ok: false, run, blocked: blockedOf("unknown-post-submit-state") }
				: { ok: false, run, failure: refused };
		}
		return await issueAttestation(fresh.proof);
	}
	if (readyResume) {
		const observed = await deps.login.observer.snapshot({ target_id: input.target_id });
		if (!observed.ok || deps.login.proveAuthenticatedState === undefined) {
			return { ok: false, run, blocked: blockedOf("human-identity-attestation-required") };
		}
		const fresh = await deps.login.proveAuthenticatedState({
			lane_id: "agent-browser",
			run_id: run.run_id,
			target_id: input.target_id,
			expected_url: input.expected_url,
			allowed_origins: input.allowed_origins,
			binding,
			snapshot: observed.snapshot,
			transition: "pre-existing-session",
		});
		if (!fresh.proven) return { ok: false, run, blocked: blockedOf(fresh.cause) };
		const proofRefusal = authenticatedProofRefusal(fresh.proof, input);
		if (proofRefusal !== undefined) {
			return { ok: false, run, blocked: blockedOf(proofRefusal) };
		}
		const attestation = await revalidateAuthAttestation(
			run,
			{
				at_epoch_ms: deps.store.clock(),
				adapter_id: "agent-browser",
				handoff_evidence_id: run.handoff_evidence_id,
			},
			createBrowserUseAuthContract({
				attestationByDigest: attestationByDigestFrom(deps.store),
			}),
		);
		return attestation.valid
			? { ok: true, run, binding }
			: { ok: false, run, blocked: blockedOf("session-identity-proof-unavailable") };
	}
	if (fragment.phase === "secret-free-preparation") {
		const completed = await transition(prepared.event);
		if (!completed.ok) return { ok: false, run, failure: completed };
	}

	const acquired = await deps.provider.acquireSensitiveIntervalLease({
		run,
		holder_id: `runbook-auth-${run.run_id}`,
		ttl_ms: 30_000,
		scope: { auth_context_ref: input.auth_context_ref, target_id: input.target_id },
		key_family: "sensitive-interval",
	});
	const leaseTransition = await transition(acquired.event);
	if (!leaseTransition.ok) {
		// The try/finally that releases the granted lease starts below, so a
		// failed lease transition here would strand a granted lease until its TTL.
		if (acquired.granted) await deps.provider.releaseSensitiveIntervalLease({ lease: acquired.lease });
		return { ok: false, run, failure: leaseTransition };
	}
	if (!acquired.granted) {
		return { ok: false, run, blocked: blockedOf(acquired.blocked_cause) };
	}

	let lifecycleSequence = 0;
	const lifecycle = async (
		event: BrowserUseLoginLifecycleEvent,
	): Promise<{ ok: true } | { ok: false; cause: BrowserUseAuthBlockedCause }> => {
		const apply = async (authEvent: BrowserUseAuthTransactionEvent) => {
			lifecycleSequence += 1;
			const before = fragment;
			emitCliDiagnostic("browser-use.cli", "debug", "auth-lifecycle-transition", {
				sequence: lifecycleSequence,
				login_event_type: event.type,
				login_step:
					event.type === "credential-delivered" ? event.field : null,
				auth_event_type: authEvent.type,
				auth_method_step:
					authEvent.type === "method-step-complete" ? authEvent.step : null,
				phase_before: before?.phase ?? null,
				method_step_before: before?.method_step ?? null,
			});
			const result = await transition(authEvent);
			if (!result.ok) {
				emitCliDiagnostic("browser-use.cli", "debug", "auth-lifecycle-transition-rejected", {
					sequence: lifecycleSequence,
					login_event_type: event.type,
					login_step:
						event.type === "credential-delivered" ? event.field : null,
					auth_event_type: authEvent.type,
					auth_method_step:
						authEvent.type === "method-step-complete" ? authEvent.step : null,
					phase_before: before?.phase ?? null,
					method_step_before: before?.method_step ?? null,
					rejection_code: result.code,
					rejection_message: result.message,
				});
			}
			return result.ok ? { ok: true as const } : { ok: false as const, cause: "capability-loss" as const };
		};
		if (event.type === "credential-delivered") {
			if (
				fragment?.method_step === null &&
				fragment.submit_outcome !== "otp-required"
			) {
				const identified = await apply({ type: "method-step-complete", step: "identify-auth-state" });
				if (!identified.ok) return identified;
			}
			if (event.field === "username") return await apply({ type: "method-step-complete", step: "fill-username" });
			const reproved = await apply({ type: "method-step-complete", step: "reprove-target" });
			if (!reproved.ok) return reproved;
			return await apply({
				type: "method-step-complete",
				step: event.field === "otp-current" ? "fill-otp" : "fill-password",
			});
		}
		if (event.type === "username-advance-dispatching") {
			return await apply({ type: "method-step-complete", step: "submit-username" });
		}
		if (event.type === "credential-submit-dispatching") {
			return await apply({ type: "submission-dispatched" });
		}
		const observed = await apply({ type: "submit-outcome-observed", outcome: event.outcome });
		if (!observed.ok) return observed;
		return await apply({ type: "cleanup-complete" });
	};

	try {
		const engine = await runBrowserUseLoginEngine(
			{ ...deps.login, journal: lifecycle },
			{
				lane_id: "agent-browser",
				run_id: run.run_id,
				target_id: input.target_id,
				expected_url: input.expected_url,
				allowed_origins: input.allowed_origins,
				binding,
			},
		);
		if (!engine.ok) {
			let cause = engine.blocked.blocked_cause;
			if (fragment?.submission_started) {
				const unknown = await transition({ type: "submit-outcome-observed", outcome: "timeout-unknown" });
				if (!unknown.ok) return { ok: false, run, failure: unknown };
				const cleaned = await transition({ type: "cleanup-complete" });
				if (!cleaned.ok) return { ok: false, run, failure: cleaned };
				cause = "unknown-post-submit-state";
			} else {
				const blocked = await transition({ type: "blocked", cause });
				if (!blocked.ok) return { ok: false, run, failure: blocked };
			}
			return { ok: false, run, blocked: blockedOf(cause) };
		}
		if (engine.authenticated_state === "pre-existing-session") {
			const reused = await transition({ type: "session-already-authenticated" });
			if (!reused.ok) return { ok: false, run, failure: reused };
		}
		return await issueAttestation(engine.proof);
	} finally {
		await deps.provider.releaseSensitiveIntervalLease({ lease: acquired.lease });
	}
}
