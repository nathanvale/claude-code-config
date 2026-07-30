import { join } from "node:path";
import type {
	RuntimeErrorRecoverability,
	CliWriter,
} from "@side-quest/cli-command-facade";
import {
	browserUsePlatformStoreFailureActions,
	browserUsePlatformStoreSuccessActions,
	browserUseRunbookAuthFailureActions,
} from "./command-contract";
import type {
	browserUseRunbookInputFailureActions,
	browserUseTaskRunFailureActions,
	browserUseTaskRunSuccessActions,
} from "./command-contract";
import {
	BINDING_FAIL_CLOSED_EXIT_CODE,
	USAGE_EXIT_CODE,
	stringField,
	targetEnvelopeIdOf,
} from "./browser-use-core";
import type { BrowserAdapterId } from "./discovery-model";
import {
	type AgentBrowserExecutionResult,
	type AgentBrowserTaskStep,
	type AgentBrowserTargetResolutionResult,
	type AgentBrowserVerifiedHandoff,
	agentBrowserHandoffEvidenceIdOf,
	observeAgentBrowserSessionIdentity,
	proveAgentBrowserTarget,
	resolveAgentBrowserTaskTarget,
} from "./browser-use-agent-browser";
import {
	type BrowserUseSessionIdentityVerificationResult,
	commitAuthTransaction,
	createBrowserUseAuthContract,
	verifyBrowserUseSessionIdentityObservation,
} from "./browser-use-auth";
import {
	type BrowserUseAuthProvider,
	createBrowserUseAuthProvider,
} from "./browser-use-auth-provider";
import {
	type BrowserUseAuthBlockedCause,
	type BrowserUseAuthTransactionFragment,
	type BrowserUseSessionIdentityObservationV1,
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
} from "./browser-use-auth-model";
import {
	type BrowserUseAuthTransactionEvent,
	applyAuthTransition,
	beginAuthTransaction,
} from "./browser-use-auth-transaction";
import { createBrowserUseAuthBindingStore } from "./browser-use-auth-binding-store";
import type {
	BrowserUseItemBinding,
	BrowserUseResolvedAuthCandidate,
} from "./browser-use-auth-bindings";
import type { HandoffFacts } from "./browser-use-discovery";
import {
	type BrowserUseGenerationRuntime,
	createBrowserUseGenerationRuntime,
} from "./browser-use-generation-runtime";
import type {
	BrowserUseGenerationReviewedActionRef,
	BrowserUseGenerationSessionPolicy,
} from "./browser-use-generation-schemas";
import {
	type LeaseWriteClaim,
	acquireLease,
	heartbeatLease,
	releaseLease,
	withActivationEpochBarrier,
} from "./browser-use-locks";
import type { BrowserUseMigrationFailure } from "./browser-use-migration-model";
import {
	readActiveCorpusManifest,
	readBrowserUseMigrationStatus,
	readRetainedCorpusGenerationManifest,
	tripActiveGenerationEffectFence,
} from "./browser-use-migration";
import type {
	BrowserUseArtifactReference,
	BrowserUseAuthRunContinuation,
	BrowserUseCallerMetadata,
	BrowserUseRunStructuredResult,
	BrowserUseRunState,
	BrowserUseSharedRun,
	BrowserUseTaskIntent,
} from "./browser-use-run-model";
import { isBrowserUseAuthRunContinuation } from "./browser-use-run-model";
import {
	type BrowserUseRunbookAuthDelivery,
	type BrowserUseRunbookDiscoveryFailure,
	type BrowserUseRunbookExecutionResult,
	type BrowserUseRunbookExecutionRefusal,
	type BrowserUseRunbookShowResult,
	enforceRunbookInputCustody,
	executePreparedRunbook,
	listEffectiveRunbooks,
	listRunbooks,
	prepareRunbookExecution,
	readPrivateStructuredInput,
	showRunbook,
} from "./browser-use-runbook";
import type {
	BrowserUseRunbookCatalogRow,
	BrowserUseRunbookInputs,
} from "./browser-use-runbook-model";
import {
	type BrowserUseActionGenerationSeam,
	resolveReviewedAction,
} from "./browser-use-runbook-actions";
import { createBrowserUseConfidentialDeliveryQuarantine } from "./browser-use-confidential-delivery-quarantine";
import { nextRunbookStepAfterExecution } from "./browser-use-runbook-model";
import { identifyRunbookAuthState } from "./browser-use-runbook-auth-state";
import type { BrowserUseRuntime } from "./browser-use-runtime";
import {
	BROWSER_USE_EXTERNAL_EFFECT_NONE,
	attestationByDigestFrom,
	claimRunContinuation,
	createRunIntegrationPort,
	createSharedRun,
	leaseKeyForRun,
	loadSharedRun,
	recoverRunContinuationPreEffectClaim,
	type RunContinuationPreEffectClaimRecoveryResult,
	type RunStoreDeps,
	writeAuthAttestationRecord,
} from "./browser-use-runs";
import type { BrowserUseLeasePayload } from "./browser-use-schemas";
import {
	type BrowserUseSensitiveRunGuard,
	beginSensitiveRunGuard,
} from "./browser-use-sensitive-run";
import type {
	ParsedBrowserUseCommand,
} from "./browser-use-parser";

type RunbookPlatformActionId =
	| (typeof browserUsePlatformStoreFailureActions)[number]["id"]
	| (typeof browserUsePlatformStoreSuccessActions)[number]["id"]
	| (typeof browserUseRunbookAuthFailureActions)[number]["id"];

const runbookPlatformActionIds = new Set<string>([
	...browserUsePlatformStoreFailureActions.map((action) => action.id),
	...browserUsePlatformStoreSuccessActions.map((action) => action.id),
	...browserUseRunbookAuthFailureActions.map((action) => action.id),
]);

function isRunbookPlatformActionId(
	value: string,
): value is RunbookPlatformActionId {
	return runbookPlatformActionIds.has(value);
}

type RunbookTaskActionId =
	| (typeof browserUseTaskRunFailureActions)[number]["id"]
	| (typeof browserUseRunbookInputFailureActions)[number]["id"]
	| (typeof browserUseTaskRunSuccessActions)[number]["id"];

/**
 * Driver context consumed by the runbook command module.
 *
 * The CLI driver retains generic writers, runtime construction, and envelope
 * ownership. This context carries only the already-resolved command facts.
 *
 * @internal
 */
export type BrowserUseRunbookCommandInput = {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	caller: BrowserUseCallerMetadata;
	durationMs: () => number;
};

/**
 * Generic platform failure requested by runbook orchestration.
 *
 * The browser-use driver renders this through its existing platform envelope
 * owner, preserving JSON/plain parity and action metadata.
 *
 * @internal
 */
export type BrowserUseRunbookCommandFailure = {
	code: string;
	message: string;
	actionId: RunbookPlatformActionId;
	exitCode: number;
	recoverability: RuntimeErrorRecoverability;
	authBlockedCause?: BrowserUseAuthBlockedCause;
};

/**
 * Shared-run failure requested by runbook orchestration.
 *
 * @internal
 */
export type BrowserUseRunbookTaskFailure = {
	code: string;
	message: string;
	actionId: RunbookTaskActionId;
	exitCode: number;
	recoverability: RuntimeErrorRecoverability;
	dataExtra?: Record<string, unknown>;
};

/**
 * Map a failed pre-effect recovery to the only safe handoff result.
 *
 * The ordinary handoff failure stays deferred until this check passes, so one
 * JSON result cannot advertise a retry while the continuation remains claimed.
 */
export function runbookPreEffectClaimRecoveryFailure(input: {
	runId: string;
	continuationId: string;
	recovery: RunContinuationPreEffectClaimRecoveryResult;
}): BrowserUseRunbookTaskFailure | undefined {
	if (input.recovery.status === "recovered") return undefined;
	const detail =
		input.recovery.status === "unavailable"
			? input.recovery.code
			: input.recovery.status === "mismatch" ||
					input.recovery.status === "not-recoverable"
				? input.recovery.kind
				: "unknown";
	return {
		code: "run_continuation_claim_recovery_failed",
		message: `run ${input.runId} could not release auth continuation ${input.continuationId} after handoff acquisition failed; claim recovery resolved as ${input.recovery.status}:${detail}. Inspect and repair this exact shared run before retrying.`,
		actionId: "inspect_task_run_result",
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "repair_state",
		dataExtra: {
			claim_recovery_status: input.recovery.status,
			claim_recovery_detail: detail,
			stranded_continuation_id: input.continuationId,
			external_effect: "none",
		},
	};
}

/**
 * Runbook lane outcome translated into shared-run truth.
 *
 * @internal
 */
export type BrowserUseRunbookDispatchMapping =
	| {
			kind: "confirmed";
			executedSteps: number;
			mutationDispatched?: boolean;
	  }
	| {
			kind: "blocked";
			state: BrowserUseRunState;
			continuation: { next_action_id: string; summary: string };
			failure: BrowserUseRunbookTaskFailure;
			mutationDispatched?: boolean;
	  }
	| {
			kind: "terminal";
			state: BrowserUseRunState;
			failure: BrowserUseRunbookTaskFailure;
			mutationDispatched?: boolean;
	  };

/**
 * Sensitive-delivery containment outcome retained by the generic driver.
 *
 * @internal
 */
export type BrowserUseRunbookDeliveryGuardOutcome =
	| { ok: true; guard: BrowserUseSensitiveRunGuard | undefined }
	| {
			ok: false;
			reason:
				| "guard_unavailable"
				| "sentinel_derivation_failed"
				| "sensitive_mark_failed";
	  };

type RunbookStateWriteResult =
	| { ok: true; run: BrowserUseSharedRun }
	| { ok: false; failure: BrowserUseRunbookCommandFailure };

type RecordRunbookOutcomeOptions = {
	artifacts?: readonly BrowserUseArtifactReference[];
	guard?: BrowserUseSensitiveRunGuard;
	runbookNextStep?: number;
	heldClaim?: LeaseWriteClaim;
	structuredResults?: readonly BrowserUseRunStructuredResult[];
};

type RunbookAuthField = "username" | "password" | "otp";

type RunbookAuthCheckpoint =
	| `before-${RunbookAuthField}-delivery`
	| `before-${RunbookAuthField}-submit`
	| "human-presence-required"
	| "delivery-outcome-unknown"
	| "submission-outcome-unknown"
	| "session-identity-unproven";

/** Effect ports for the U8 session-first auth state machine. */
export type BrowserUseRunbookAuthOrchestratorPorts = {
	claimContinuation(): Promise<
		| { status: "claimed" }
		| {
				status:
					| "already-claimed"
					| "in-progress"
					| "terminal"
					| "mismatch"
					| "unavailable";
		  }
	>;
	inspectSession(input: {
		approvedOrigins: readonly string[];
		verifier: BrowserUseGenerationSessionPolicy["identity_verifier"];
	}): Promise<
		| { status: "authenticated" }
		| { status: "login-required"; observed_origin: string }
		| { status: "unproven" }
	>;
	identifyAuthState(input: {
		approvedOrigins: readonly string[];
		action: BrowserUseGenerationReviewedActionRef;
	}): Promise<
		| {
				status: "fields-required";
				fields: readonly RunbookAuthField[];
		  }
		| {
				status: "human-presence-required";
				challenge: "mfa" | "captcha" | "passkey";
		  }
		| { status: "unproven" }
	>;
	prepareBinding(): Promise<{ ok: true } | { ok: false }>;
	persistCheckpoint(checkpoint: RunbookAuthCheckpoint): Promise<boolean>;
	deliverField(input: {
		field: RunbookAuthField;
		locator: BrowserUseGenerationSessionPolicy["auth_flow"]["fields"][RunbookAuthField];
		approvedOrigins: readonly string[];
	}): Promise<
		| { status: "delivered" }
		| { status: "blocked" }
		| { status: "unknown" }
	>;
	submitAuthAction(input: {
		field: RunbookAuthField;
		action: BrowserUseGenerationReviewedActionRef;
		approvedOrigins: readonly string[];
	}): Promise<
		| { status: "confirmed" }
		| { status: "blocked" }
		| { status: "unknown" }
	>;
};

/** Secret-free result from one complete U8 auth decision. */
export type BrowserUseRunbookAuthOrchestratorResult =
	| { ok: true; status: "authenticated" }
	| {
			ok: false;
			code:
				| "auth-continuation-already-claimed"
				| "auth-continuation-unavailable"
				| "auth-session-policy-unproven"
				| "auth-session-identity-unproven"
				| "auth-login-origin-refused"
				| "auth-login-state-unproven"
				| "auth-human-presence-required"
				| "auth-binding-unavailable"
				| "auth-field-policy-unproven"
				| "auth-delivery-blocked"
				| "auth-delivery-outcome-unknown"
				| "auth-submit-blocked"
				| "auth-submission-outcome-unknown";
			safe_to_retry: false;
	  };

function submitActionForField(
	policy: BrowserUseGenerationSessionPolicy,
	field: RunbookAuthField,
): BrowserUseGenerationReviewedActionRef | undefined {
	switch (field) {
		case "username":
			return policy.auth_flow.username_submit;
		case "password":
			return policy.auth_flow.password_submit;
		case "otp":
			return policy.auth_flow.otp_submit;
	}
}

/**
 * Execute the U8 session-first state machine.
 *
 * Every effect is phase-scoped by the immutable route policy. The caller owns
 * native target proof, reviewed-action execution, opaque delivery, and durable
 * continuation construction; this owner fixes their safe order.
 */
export async function orchestrateRunbookAuthentication(input: {
	policy: BrowserUseGenerationSessionPolicy | undefined;
	resumeContinuation: boolean;
	resumeCheckpoint?: string;
	ports: BrowserUseRunbookAuthOrchestratorPorts;
}): Promise<BrowserUseRunbookAuthOrchestratorResult> {
	const policy = input.policy;
	if (policy === undefined) {
		return {
			ok: false,
			code: "auth-session-policy-unproven",
			safe_to_retry: false,
		};
	}
	if (input.resumeContinuation) {
		const claim = await input.ports.claimContinuation();
		if (claim.status !== "claimed") {
			return {
				ok: false,
				code:
					claim.status === "already-claimed"
						? "auth-continuation-already-claimed"
						: "auth-continuation-unavailable",
				safe_to_retry: false,
			};
		}
	}

	const initialSession = await input.ports.inspectSession({
		approvedOrigins: policy.approved_service_origins,
		verifier: policy.identity_verifier,
	});
	if (initialSession.status === "authenticated") {
		return { ok: true, status: "authenticated" };
	}
	if (initialSession.status === "unproven") {
		const persisted = await input.ports.persistCheckpoint(
			"session-identity-unproven",
		);
		return {
			ok: false,
			code: persisted
				? "auth-session-identity-unproven"
				: "auth-continuation-unavailable",
			safe_to_retry: false,
		};
	}
	if (
		input.resumeCheckpoint === "delivery-outcome-unknown" ||
		input.resumeCheckpoint === "submission-outcome-unknown"
	) {
		return {
			ok: false,
			code:
				input.resumeCheckpoint === "delivery-outcome-unknown"
					? "auth-delivery-outcome-unknown"
					: "auth-submission-outcome-unknown",
			safe_to_retry: false,
		};
	}
	if (
		!policy.approved_identity_provider_origins.includes(
			initialSession.observed_origin,
		)
	) {
		return {
			ok: false,
			code: "auth-login-origin-refused",
			safe_to_retry: false,
		};
	}

	const identified = await input.ports.identifyAuthState({
		approvedOrigins: policy.approved_identity_provider_origins,
		action: policy.auth_flow.identify_state,
	});
	if (identified.status === "unproven") {
		return {
			ok: false,
			code: "auth-login-state-unproven",
			safe_to_retry: false,
		};
	}
	if (identified.status === "human-presence-required") {
		const persisted = await input.ports.persistCheckpoint(
			"human-presence-required",
		);
		return {
			ok: false,
			code: persisted
				? "auth-human-presence-required"
				: "auth-continuation-unavailable",
			safe_to_retry: false,
		};
	}
	if (
		identified.fields.some(
			(field) => policy.auth_flow.fields[field] === undefined,
		)
	) {
		return {
			ok: false,
			code: "auth-field-policy-unproven",
			safe_to_retry: false,
		};
	}

	const prepared = await input.ports.prepareBinding();
	if (!prepared.ok) {
		return {
			ok: false,
			code: "auth-binding-unavailable",
			safe_to_retry: false,
		};
	}
	for (const field of identified.fields) {
		const locator = policy.auth_flow.fields[field];
		if (locator === undefined) {
			return {
				ok: false,
				code: "auth-field-policy-unproven",
				safe_to_retry: false,
			};
		}
		if (!(await input.ports.persistCheckpoint(`before-${field}-delivery`))) {
			return {
				ok: false,
				code: "auth-delivery-blocked",
				safe_to_retry: false,
			};
		}
		const delivered = await input.ports.deliverField({
			field,
			locator,
			approvedOrigins: policy.approved_identity_provider_origins,
		});
		if (delivered.status === "unknown") {
			const persisted = await input.ports.persistCheckpoint(
				"delivery-outcome-unknown",
			);
			return {
				ok: false,
				code: persisted
					? "auth-delivery-outcome-unknown"
					: "auth-continuation-unavailable",
				safe_to_retry: false,
			};
		}
		if (delivered.status === "blocked") {
			return {
				ok: false,
				code: "auth-delivery-blocked",
				safe_to_retry: false,
			};
		}

		const submitAction = submitActionForField(policy, field);
		if (submitAction === undefined) continue;
		if (!(await input.ports.persistCheckpoint(`before-${field}-submit`))) {
			return {
				ok: false,
				code: "auth-submit-blocked",
				safe_to_retry: false,
			};
		}
		const submitted = await input.ports.submitAuthAction({
			field,
			action: submitAction,
			approvedOrigins: policy.approved_identity_provider_origins,
		});
		if (submitted.status === "unknown") {
			const persisted = await input.ports.persistCheckpoint(
				"submission-outcome-unknown",
			);
			return {
				ok: false,
				code: persisted
					? "auth-submission-outcome-unknown"
					: "auth-continuation-unavailable",
				safe_to_retry: false,
			};
		}
		if (submitted.status === "blocked") {
			return {
				ok: false,
				code: "auth-submit-blocked",
				safe_to_retry: false,
			};
		}
	}

	const finalSession = await input.ports.inspectSession({
		approvedOrigins: policy.approved_service_origins,
		verifier: policy.identity_verifier,
	});
	if (finalSession.status === "authenticated") {
		return { ok: true, status: "authenticated" };
	}
	const persisted = await input.ports.persistCheckpoint(
		"session-identity-unproven",
	);
	return {
		ok: false,
		code: persisted
			? "auth-session-identity-unproven"
			: "auth-continuation-unavailable",
		safe_to_retry: false,
	};
}

async function resolveRunbookAuthAction(input: {
	ref: BrowserUseGenerationReviewedActionRef;
	origins: readonly string[];
	actionSeam: BrowserUseActionGenerationSeam;
}): Promise<
	| {
			ok: true;
			step: Extract<AgentBrowserTaskStep, { kind: "evaluate" }>;
	  }
	| { ok: false }
> {
	for (const origin of input.origins) {
		const resolved = await resolveReviewedAction({
			actionId: input.ref.action_id,
			expectedDigest: input.ref.expected_digest,
			requestedOrigin: origin,
			inputs: {},
			seam: input.actionSeam,
		});
		if (resolved.ok) {
			return {
				ok: true,
				step: resolved.resolved.step,
			};
		}
	}
	return { ok: false };
}

/**
 * Run the real reviewed-action/native-target Session Identity Proof adapter.
 *
 * No 1Password metadata, field, delivery, or submit port is representable.
 */
export async function inspectRunbookAuthenticatedSession(input: {
	policy: BrowserUseGenerationSessionPolicy;
	actionSeam: BrowserUseActionGenerationSeam;
	runCommand: BrowserUseRunbookCommandPorts["runtime"]["runCommand"];
	targetProof: NonNullable<BrowserUseRuntime["authTargetProof"]>;
	handoff: AgentBrowserVerifiedHandoff;
	runId: string;
	targetId: string;
	serviceId: string;
	authContext: string;
	environment: string;
	profile: string;
	clock: () => number;
}): Promise<
	| {
			status: "authenticated";
			observation: BrowserUseSessionIdentityObservationV1;
			verification: Extract<
				BrowserUseSessionIdentityVerificationResult,
				{ ok: true }
			>;
	  }
	| { status: "login-required"; observed_origin: string }
	| { status: "unproven" }
> {
	const verifier = input.policy.identity_verifier;
	const action = await resolveRunbookAuthAction({
		ref: verifier.action,
		origins: input.policy.approved_service_origins,
		actionSeam: input.actionSeam,
	});
	if (action.ok) {
		const observed = await observeAgentBrowserSessionIdentity({
			runtime: { runCommand: input.runCommand },
			targetProof: input.targetProof,
			handoff: input.handoff,
			run_id: input.runId,
			target_id: input.targetId,
			verifier: action.step,
			freshness_ms: verifier.freshness_ms,
			now: input.clock,
		});
		if (observed.ok) {
			const observation = observed.observation;
			const verified = verifyBrowserUseSessionIdentityObservation(
				observation,
				{
					verifier_action_id: verifier.action.action_id,
					verifier_action_digest:
						verifier.action.expected_digest,
					lane_id: "agent-browser",
					run_id: input.runId,
					handoff_evidence_id:
						agentBrowserHandoffEvidenceIdOf(input.handoff),
					environment: input.environment,
					profile: input.profile,
					target_id: input.targetId,
					page_id: observation.page_id,
					frame_id: observation.frame_id,
					top_level_origin: observation.top_level_origin,
					frame_origin: observation.frame_origin,
					target_proof_digest:
						observation.target_proof_digest,
					subject_reference:
						verifier.expected.subject_reference,
					account_reference:
						verifier.expected.account_reference,
					tenant_reference:
						verifier.expected.tenant_reference,
					observed_at_epoch_ms:
						observation.observed_at_epoch_ms,
					fresh_until_epoch_ms:
						observation.fresh_until_epoch_ms,
					implementation_integrity_key:
						"agent-browser@session-policy-1",
					service_id: input.serviceId,
					auth_context: input.authContext,
					at_epoch_ms: input.clock(),
				},
			);
			if (verified.ok) {
				return {
					status: "authenticated",
					observation,
					verification: verified,
				};
			}
		}
	}
	const idpTarget = await proveAgentBrowserTarget({
		targetProof: input.targetProof,
		handoff: input.handoff,
		target_id: input.targetId,
	});
	return idpTarget.ok &&
		idpTarget.proof.top_level_origin ===
			idpTarget.proof.frame_origin &&
		input.policy.approved_identity_provider_origins.includes(
			idpTarget.proof.top_level_origin,
		)
		? {
				status: "login-required",
				observed_origin:
					idpTarget.proof.top_level_origin,
			}
		: { status: "unproven" };
}

function runbookSessionCommitFailure(
	message: string,
): BrowserUseRunbookCommandFailure {
	return {
		code: "runbook_auth_attestation_commit_failed",
		message,
		actionId: "inspect-auth-readiness",
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "repair_state",
	};
}

async function commitRunbookAuthenticatedSession(input: {
	deps: RunStoreDeps;
	run: BrowserUseSharedRun;
	claim: LeaseWriteClaim;
	session: Extract<
		Awaited<ReturnType<typeof inspectRunbookAuthenticatedSession>>,
		{ status: "authenticated" }
	>;
	serviceId: string;
	authContext: string;
}): Promise<RunbookStateWriteResult> {
	const observation = input.session.observation;
	const begun = beginAuthTransaction({
		binding: {
			run_id: input.run.run_id,
			handoff_evidence_id: observation.handoff_evidence_id,
			lane_id: observation.lane_id,
			environment: observation.environment,
			profile: observation.profile,
			service_id: input.serviceId,
			auth_context: input.authContext,
			origin: observation.top_level_origin,
			target_id: observation.target_id,
			page_id: observation.page_id,
			frame_id: observation.frame_id,
		},
		method: "session-reuse",
		attempt_limit: 1,
		attempts_already_consumed: 0,
	});
	if (!begun.ok) {
		return {
			ok: false,
			failure: runbookSessionCommitFailure(
				"the authenticated session could not begin its run-bound transaction.",
			),
		};
	}
	let fragment = begun.fragment;
	const events: readonly BrowserUseAuthTransactionEvent[] = [
		{ type: "session-already-authenticated" },
		{
			type: "postcondition-proven",
			identity_basis: "session-identity-proof",
			identity_basis_digest:
				input.session.verification.identity_basis_digest,
		},
	];
	for (const event of events) {
		const transitioned = applyAuthTransition(fragment, event);
		if (!transitioned.ok) {
			return {
				ok: false,
				failure: runbookSessionCommitFailure(
					"the authenticated session transaction refused its reviewed transition.",
				),
			};
		}
		fragment = transitioned.fragment;
	}
	const written = await writeAuthAttestationRecord(input.deps, {
		digest: input.session.verification.attestation_digest,
		record: input.session.verification.attestation,
	});
	if (!written.ok) {
		return {
			ok: false,
			failure: runbookSessionCommitFailure(
				"the authenticated session attestation could not be persisted.",
			),
		};
	}
	const terminal = applyAuthTransition(fragment, {
		type: "attestation-issued",
		attestation_digest:
			input.session.verification.attestation_digest,
		fresh_until_epoch_ms:
			input.session.verification.attestation
				.fresh_until_epoch_ms,
	});
	if (!terminal.ok) {
		return {
			ok: false,
			failure: runbookSessionCommitFailure(
				"the authenticated session attestation could not close its transaction.",
			),
		};
	}
	try {
		const committed = await commitAuthTransaction(
			createRunIntegrationPort(
				input.deps,
				createBrowserUseAuthContract({
					attestationByDigest:
						attestationByDigestFrom(input.deps),
				}),
				input.claim,
			),
			{
				run_id: input.run.run_id,
				expected_revision: input.run.revision,
				fragment: terminal.fragment,
			},
		);
		if (!committed.ok) {
			return {
				ok: false,
				failure: runbookSessionCommitFailure(
					"the authenticated session attestation was not bound to the shared run.",
				),
			};
		}
		return { ok: true, run: committed.run };
	} catch {
		return {
			ok: false,
			failure: runbookSessionCommitFailure(
				"the authenticated session attestation commit failed at the run store.",
			),
		};
	}
}

/**
 * Existing driver-owned ports used by runbook command orchestration.
 *
 * @internal
 */
export type BrowserUseRunbookCommandPorts = {
	clock: () => number;
	runtime: Pick<
		BrowserUseRuntime,
		| "runCommand"
		| "authAdmission"
		| "authTargetProof"
		| "authConfidentialDelivery"
	>;
	store: {
		open: (
			access?: "read" | "write",
		) => Promise<
			| { ok: true; deps: RunStoreDeps }
			| { ok: false; exitCode: number }
		>;
	};
	output: {
		emitPlatformFailure: (
			failure: BrowserUseRunbookCommandFailure,
		) => number;
		emitTaskFailure: (
			runId: string | undefined,
			failure: BrowserUseRunbookTaskFailure,
		) => number;
		emitMigrationFailure: (failure: BrowserUseMigrationFailure) => number;
		emitCatalog: (rows: readonly BrowserUseRunbookCatalogRow[]) => number;
		emitDefinition: (
			shown: Extract<BrowserUseRunbookShowResult, { ok: true }>,
		) => number;
		emitSharedRunSuccess: (input: {
			run: BrowserUseSharedRun;
			continuationId: string;
			dataExtra?: Record<string, unknown>;
			plainExtra?: readonly string[];
		}) => number;
	};
	handoff: {
		acquire: () => Promise<
			| {
					ok: true;
					handoff: HandoffFacts;
					rawHandoffData: unknown;
			  }
			| {
					ok: false;
					exitCode: number;
					reportFailure?: () => number;
			  }
		>;
		checkSameLaneResume: (
			run: BrowserUseSharedRun,
			routedLaneId: string,
			handoff: HandoffFacts,
		) => BrowserUseRunbookTaskFailure | undefined;
	};
	run: {
		isTerminalState: (state: BrowserUseRunState) => boolean;
		platformFailureOf: (
			code: string,
			message: string,
		) => BrowserUseRunbookCommandFailure;
		persistFenced: (
			deps: RunStoreDeps,
			run: BrowserUseSharedRun,
			holderId: string,
			mutate: (current: BrowserUseSharedRun) => BrowserUseSharedRun,
			heldClaim?: LeaseWriteClaim,
		) => Promise<RunbookStateWriteResult>;
		persistMutationDispatch: (
			deps: RunStoreDeps,
			run: BrowserUseSharedRun,
			heldClaim?: LeaseWriteClaim,
		) => Promise<RunbookStateWriteResult>;
		recordOutcome: (
			deps: RunStoreDeps,
			run: BrowserUseSharedRun,
			route: {
				lane_id: BrowserAdapterId;
				source: string;
				intent: BrowserUseTaskIntent;
			},
			mapping: BrowserUseRunbookDispatchMapping,
			options?: RecordRunbookOutcomeOptions,
		) => Promise<number>;
		mapAgentBrowserOutcome: (
			result: AgentBrowserExecutionResult,
		) => BrowserUseRunbookDispatchMapping;
		markGuardForDeliveryOutcome: (
			baseGuard: BrowserUseSensitiveRunGuard | undefined,
			result: AgentBrowserExecutionResult,
		) => BrowserUseRunbookDeliveryGuardOutcome;
		sentinelRegistrationWithheldFailure: (
			reason: Extract<
				BrowserUseRunbookDeliveryGuardOutcome,
				{ ok: false }
			>["reason"],
		) => BrowserUseRunbookTaskFailure;
	};
};

/** Active corpus authority captured once for one runbook command. */
type CapturedActiveGeneration =
	| { status: "missing" }
	| { status: "present"; runtime: BrowserUseGenerationRuntime }
	| {
			status: "failure";
			code: BrowserUseRunbookDiscoveryFailure["code"];
			message: string;
	  };

/**
 * Capture active generation authority once for one command.
 *
 * Corrupt authority fails closed. A truly missing manifest retains the
 * compatibility catalog behavior.
 *
 * @param deps - Admitted store, filesystem, and clock ports
 * @returns Captured authority or a value-safe discovery refusal
 * @internal
 */
async function captureActiveGeneration(
	deps: RunStoreDeps,
): Promise<CapturedActiveGeneration> {
	const status = await readBrowserUseMigrationStatus(deps);
	if (!status.ok) {
		return {
			status: "failure",
			code: "runbook_catalog_drift",
			message: status.message,
		};
	}
	const active = await readActiveCorpusManifest(deps);
	if (active.status === "missing") {
		return status.state.active_generation.state === "never-activated"
			? { status: "missing" }
			: {
					status: "failure",
					code: "runbook_catalog_drift",
					message:
						"completed or interrupted generation authority has no active manifest.",
				};
	}
	if (active.status === "corrupt") {
		return {
			status: "failure",
			code: "runbook_catalog_drift",
			message: active.message,
		};
	}
	const opened = await createBrowserUseGenerationRuntime(deps, active.manifest);
	return opened.ok
		? { status: "present", runtime: opened.runtime }
		: {
				status: "failure",
				code: opened.failure.code,
				message: opened.failure.message,
			};
}

const RUNBOOK_DISPATCH_LEASE_TTL_MS = 600_000;
const RUNBOOK_DISPATCH_HEARTBEAT_INTERVAL_MS =
	RUNBOOK_DISPATCH_LEASE_TTL_MS / 3;

function startRunbookDispatchLeaseHeartbeat(
	deps: RunStoreDeps,
	lease: BrowserUseLeasePayload,
	platformFailureOf: BrowserUseRunbookCommandPorts["run"]["platformFailureOf"],
): {
	failure: () => BrowserUseRunbookCommandFailure | undefined;
	stop: () => Promise<BrowserUseLeasePayload>;
} {
	let currentLease = lease;
	let failure: BrowserUseRunbookCommandFailure | undefined;
	let stopRequested = false;
	let wake: (() => void) | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const completed = (async () => {
		while (!stopRequested) {
			await new Promise<void>((resolve) => {
				const finishWait = () => {
					if (timer !== undefined) clearTimeout(timer);
					timer = undefined;
					wake = undefined;
					resolve();
				};
				wake = finishWait;
				timer = setTimeout(
					finishWait,
					RUNBOOK_DISPATCH_HEARTBEAT_INTERVAL_MS,
				);
			});
			if (stopRequested) break;
			const renewed = await heartbeatLease(deps, currentLease, {
				ttlMs: RUNBOOK_DISPATCH_LEASE_TTL_MS,
			});
			if (!renewed.ok) {
				const message =
					"message" in renewed
						? renewed.message
						: renewed.continuation.summary;
				failure = platformFailureOf(renewed.code, message);
				break;
			}
			currentLease = renewed.lease;
		}
	})();
	return {
		failure: () => failure,
		stop: async () => {
			stopRequested = true;
			wake?.();
			await completed;
			return currentLease;
		},
	};
}

function runbookTargetRepairMapping(
	result: Extract<AgentBrowserTargetResolutionResult, { ok: false }>,
): BrowserUseRunbookDispatchMapping {
	return {
		kind: "blocked",
		state: "needs-human",
		continuation: {
			next_action_id: "restore_bound_runbook_target",
			summary:
				"Restore the exact tab bound to this run, then resume with the same verified handoff; otherwise start a new run.",
		},
		mutationDispatched: result.mutation_dispatched,
		failure: {
			code: result.code,
			message: result.message,
			actionId: "restore_bound_runbook_target",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
			dataExtra: {
				lane_outcome: result.code,
				external_effect: "none",
			},
		},
	};
}

function mapRunbookAgentBrowserOutcome(
	result: AgentBrowserExecutionResult,
	ports: BrowserUseRunbookCommandPorts,
): BrowserUseRunbookDispatchMapping {
	if (
		!result.ok &&
		(result.code === "agent_browser_target_unavailable" ||
			result.code === "agent_browser_target_ambiguous" ||
			result.code === "agent_browser_target_moved")
	) {
		return runbookTargetRepairMapping(result);
	}
	return ports.run.mapAgentBrowserOutcome(result);
}

function buildRunbookAuthDelivery(
	provider: BrowserUseAuthProvider,
): BrowserUseRunbookAuthDelivery {
	void provider;
	return async () => ({
		ok: false,
		message:
			"the native Browser Authentication capability is present, but the runbook lane's live sensitive-interval delivery (verified-target proof and confidential-field hook) is not wired here yet. Complete the authentication transaction for this runbook lane before running a confidential runbook.",
	});
}

/**
 * Prepare the digest-bound generation candidate using metadata only.
 *
 * U5 ends here. U7 owns confidential field delivery and keeps the existing
 * fail-closed delivery seam until a proven target and sensitive interval exist.
 *
 * @internal
 */
export async function prepareRunbookGenerationAuthBinding(
	provider: Pick<BrowserUseAuthProvider, "prepareGenerationBinding">,
	resolution: BrowserUseResolvedAuthCandidate,
	targetOrigins: readonly string[],
): Promise<
	| { ok: true; binding: BrowserUseItemBinding }
	| { ok: false; failure: BrowserUseRunbookCommandFailure }
> {
	const prepared = await provider.prepareGenerationBinding({
		resolution,
		target_origins: targetOrigins,
		login_path: null,
		method: "password",
	});
	if (prepared.ok) {
		if (prepared.binding === null) {
			return {
				ok: false,
				failure: {
					code: "runbook_auth_binding_unavailable",
					message:
						"the password authentication preparation returned no item binding.",
					actionId: "repair-item-binding",
					exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
					recoverability: "repair_state",
				},
			};
		}
		if (
			prepared.binding.service_id !== resolution.candidate.service_id ||
			prepared.binding.auth_context !==
				resolution.candidate.auth_context ||
			!prepared.binding.allowed_auth_methods.includes("password") ||
			targetOrigins.some(
				(origin) =>
					!prepared.binding?.allowed_origins.includes(origin),
			)
		) {
			return {
				ok: false,
				failure: {
					code: "runbook_auth_binding_unavailable",
					message:
						"the password authentication preparation returned a binding outside the exact runbook authority.",
					actionId: "repair-item-binding",
					exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
					recoverability: "repair_state",
				},
			};
		}
		return { ok: true, binding: prepared.binding };
	}
	const actionId = isRunbookPlatformActionId(
		prepared.continuation.next_action_id,
	)
		? prepared.continuation.next_action_id
		: "inspect-auth-readiness";
	return {
		ok: false,
		failure: {
			code: `runbook_auth_${prepared.event.cause.replaceAll("-", "_")}`,
			message: prepared.continuation.summary,
			actionId,
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
			authBlockedCause: prepared.event.cause,
		},
	};
}

function buildBlockedRunbookAuthDelivery(
	admission: Extract<
		NonNullable<BrowserUseRuntime["authAdmission"]>,
		{ kind: "blocked" }
	>,
): BrowserUseRunbookAuthDelivery {
	return async () => ({
		ok: false,
		message: `authentication lane admission is blocked (${admission.cause.code}).`,
		admission_code: admission.cause.code,
	});
}

function blockedAdmissionFailure(
	admission: Extract<
		NonNullable<BrowserUseRuntime["authAdmission"]>,
		{ kind: "blocked" }
	>,
	message: string,
): BrowserUseRunbookCommandFailure {
	const actionId =
		admission.cause.code === "environment-token-not-ready"
			? (admission.evidence.environment?.next_action ?? "inspect-token-status")
			: admission.cause.code.startsWith("native-")
				? "inspect-capability-loss"
				: "inspect-token-status";
	return {
		code: `runbook_auth_${admission.cause.code.replaceAll("-", "_")}`,
		message,
		actionId,
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "repair_state",
	};
}

function persistRunbookPrivateState(
	ports: BrowserUseRunbookCommandPorts,
	deps: RunStoreDeps,
	run: BrowserUseSharedRun,
	mutate: (current: BrowserUseSharedRun) => BrowserUseSharedRun,
	heldClaim?: LeaseWriteClaim,
): Promise<RunbookStateWriteResult> {
	return ports.run.persistFenced(
		deps,
		run,
		`runbook-state-${run.run_id}`,
		mutate,
		heldClaim,
	);
}

function persistRunbookAuthBlock(
	ports: BrowserUseRunbookCommandPorts,
	deps: RunStoreDeps,
	run: BrowserUseSharedRun,
	claim: LeaseWriteClaim,
	failure: BrowserUseRunbookCommandFailure,
	continuation?: BrowserUseAuthRunContinuation,
): Promise<RunbookStateWriteResult> {
	return persistRunbookPrivateState(
		ports,
		deps,
		run,
		(current) => ({
			...current,
			state:
				continuation?.required_actor === "human"
					? "needs-human"
					: failure.authBlockedCause === undefined
					? "awaiting-auth"
					: BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[failure.authBlockedCause]
							.run_state,
			continuation:
				continuation ?? {
					next_action_id: failure.actionId,
					summary: failure.message,
				},
		}),
		claim,
	);
}

function authContinuationReasonOf(
	failure: BrowserUseRunbookCommandFailure,
): BrowserUseAuthRunContinuation["reason"] {
	if (failure.code.includes("human_presence")) {
		return "user-presence-required";
	}
	if (failure.code.includes("delivery_outcome_unknown")) {
		return "delivery-outcome-unknown";
	}
	if (failure.code.includes("submission_outcome_unknown")) {
		return "submission-outcome-unknown";
	}
	if (
		failure.code.includes("session_identity") ||
		failure.code.includes("attestation")
	) {
		return "session-identity-unproven";
	}
	return "login-required";
}

function buildRunbookAuthContinuation(input: {
	run: BrowserUseSharedRun;
	failure: BrowserUseRunbookCommandFailure;
	activeCheckpoint?: RunbookAuthCheckpoint;
	now: number;
	generationRuntime: BrowserUseGenerationRuntime;
	resolution: BrowserUseResolvedAuthCandidate;
	policy: BrowserUseGenerationSessionPolicy;
	handoff: HandoffFacts;
	targetBindingId: string;
}): BrowserUseAuthRunContinuation {
	const reason =
		input.activeCheckpoint === undefined
			? authContinuationReasonOf(input.failure)
			: "login-required";
	return {
		schema_version: "1",
		kind: "auth",
		continuation_id: targetEnvelopeIdOf({
			runId: input.run.run_id,
			mode: "handoff-bound",
			adapter: "agent-browser",
			handoffEvidenceId:
				input.handoff.handoffEvidenceId,
		}),
		run_id: input.run.run_id,
		state: "pending",
		reason,
		required_actor:
			reason === "user-presence-required"
				? "human"
				: "agent",
		safe_to_retry: false,
		checkpoint:
			input.activeCheckpoint ??
			input.failure.code.replaceAll("_", "-"),
		expires_at_epoch_ms: input.now + 15 * 60_000,
		resume_action: {
			command: "run",
			args: [
				"resume",
				"--run",
				input.run.run_id,
				"--json",
			],
		},
		bindings: {
			generation_id:
				input.generationRuntime.manifest.generation_id,
			activation_epoch:
				input.generationRuntime.manifest.activation_epoch,
			route_digest: input.resolution.route_digest,
			lane_id: "agent-browser",
			adapter_id: "agent-browser",
			handoff_evidence_id:
				input.handoff.handoffEvidenceId,
			environment: input.handoff.environmentName,
			profile: input.handoff.environmentProfile,
			target_binding_id: input.targetBindingId,
			expected_identity: {
				subject_ref:
					input.policy.identity_verifier.expected
						.subject_reference,
				account_ref:
					input.policy.identity_verifier.expected
						.account_reference,
				tenant_ref:
					input.policy.identity_verifier.expected
						.tenant_reference,
			},
		},
		next_action_id: "resume-auth-continuation",
		summary:
			"Claim and re-prove this bound authentication continuation before resuming the runbook.",
	};
}

function runbookResumeCursorOf(run: BrowserUseSharedRun): number {
	if (run.runbook_progress !== undefined) {
		return run.runbook_progress.next_step;
	}
	const id = run.continuation?.next_action_id ?? "";
	const match = id.match(/^runbook-resume:(\d+)$/);
	return match ? Number(match[1]) : 0;
}

/**
 * Map a runbook refusal onto the driver-owned platform failure contract.
 *
 * @param code - Runbook discovery or execution refusal code
 * @param message - Redaction-safe refusal message
 * @returns Generic failure rendered by the browser-use driver
 * @internal
 */
function runbookCommandFailureOf(
	code: BrowserUseRunbookExecutionRefusal["code"],
	message: string,
): BrowserUseRunbookCommandFailure {
	switch (code) {
		case "runbook_not_found":
		case "runbook_inactive":
		case "runbook_id_invalid":
		case "runbook_input_missing":
		case "runbook_input_rejected":
		case "runbook_resume_out_of_range":
			return {
				code,
				message,
				actionId: "supply_run_id",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			};
		case "runbook_record_corrupt":
		case "runbook_record_invalid":
		case "runbook_invalid":
		case "runbook_catalog_drift":
			return {
				code,
				message,
				actionId: "inspect_corrupt_store_record",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			};
		default:
			return {
				code,
				message,
				actionId: "inspect_shared_run",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			};
	}
}

/**
 * Run the read-only runbook catalog command.
 *
 * @param ports - Existing store and output owners
 * @returns Process exit code
 * @internal
 */
async function runRunbookList(
	ports: BrowserUseRunbookCommandPorts,
): Promise<number> {
	const store = await ports.store.open();
	if (!store.ok) return store.exitCode;
	const active = await captureActiveGeneration(store.deps);
	if (active.status === "failure") {
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(active.code, active.message),
		);
	}
	const listed =
		active.status === "present"
			? await listEffectiveRunbooks(
					store.deps.fs,
					store.deps.paths.data.root,
					active.runtime.activeGenerationSeam,
				)
			: {
					ok: true as const,
					rows: await listRunbooks(
						store.deps.fs,
						store.deps.paths.data.root,
					),
				};
	if (!listed.ok) {
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(
				listed.failure.code,
				listed.failure.message,
			),
		);
	}
	return ports.output.emitCatalog(listed.rows);
}

/**
 * Run the read-only runbook definition command.
 *
 * @param input - Resolved runbook command context
 * @param ports - Existing store and output owners
 * @returns Process exit code
 * @internal
 */
async function runRunbookShow(
	input: BrowserUseRunbookCommandInput,
	ports: BrowserUseRunbookCommandPorts,
): Promise<number> {
	const store = await ports.store.open();
	if (!store.ok) return store.exitCode;
	const active = await captureActiveGeneration(store.deps);
	if (active.status === "failure") {
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(active.code, active.message),
		);
	}
	const serviceId = stringField(input.parsed.flagValues["--service"]) ?? "";
	const flowId = stringField(input.parsed.flagValues["--flow"]) ?? "";
	const shown = await showRunbook(
		store.deps.fs,
		store.deps.paths.data.root,
		{ serviceId, flowId },
		active.status === "present"
			? active.runtime.activeGenerationSeam
			: undefined,
	);
	if (!shown.ok) {
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(shown.failure.code, shown.failure.message),
		);
	}
	return ports.output.emitDefinition(shown);
}

/**
 * Parse repeatable ordinary runbook input bindings.
 *
 * Values remain private to orchestration; malformed diagnostics reveal only
 * the input id.
 *
 * @param pairs - Repeated `<id>=<value>` bindings
 * @returns Parsed inputs or a value-safe usage refusal
 * @internal
 */
function parseRunbookInputs(
	pairs: readonly string[],
):
	| { ok: true; inputs: BrowserUseRunbookInputs }
	| { ok: false; message: string } {
	const inputs: Record<string, string> = {};
	const inputIds = new Set<string>();
	for (const pair of pairs) {
		const equals = pair.indexOf("=");
		if (equals <= 0) {
			return {
				ok: false,
				message: `each --input must be <id>=<value>; received ${sanitizeInputPairForError(pair)}.`,
			};
		}
		const inputId = pair.slice(0, equals);
		if (inputIds.has(inputId)) {
			return {
				ok: false,
				message: `each --input id may be supplied only once; received ${sanitizeInputPairForError(pair)}.`,
			};
		}
		inputIds.add(inputId);
		inputs[inputId] = pair.slice(equals + 1);
	}
	return { ok: true, inputs };
}

type PrivateRunbookInputBinding = {
	inputId: string;
	filePath: string;
};

/**
 * Parse private input ids and paths without opening value-bearing files.
 *
 * @param pairs - Repeated `<id>=<absolute-path>` bindings
 * @returns Shape-checked bindings or a path/value-safe refusal
 * @internal
 */
function parsePrivateRunbookInputBindings(
	pairs: readonly string[],
):
	| {
			ok: true;
			bindings: readonly PrivateRunbookInputBinding[];
	  }
	| { ok: false; code: string; message: string } {
	const inputIds = new Set<string>();
	const bindings: PrivateRunbookInputBinding[] = [];
	for (const pair of pairs) {
		const equals = pair.indexOf("=");
		if (equals <= 0 || equals === pair.length - 1) {
			return {
				ok: false,
				code: "private_input_shape_invalid",
				message:
					"each --input-file must be <id>=<absolute-path>; private paths and values are withheld.",
			};
		}
		const inputId = pair.slice(0, equals);
		if (inputIds.has(inputId)) {
			return {
				ok: false,
				code: "private_input_shape_invalid",
				message: "a private input id may be supplied only once.",
			};
		}
		inputIds.add(inputId);
		bindings.push({
			inputId,
			filePath: pair.slice(equals + 1),
		});
	}
	return { ok: true, bindings };
}

/**
 * Read custody-approved private runbook input files.
 *
 * @param bindings - Shape-checked bindings approved against the runbook
 * @param inputRoot - Admitted owner-only private input root
 * @returns Structured inputs or a path/value-safe refusal
 * @internal
 */
async function readPrivateRunbookInputs(
	bindings: readonly PrivateRunbookInputBinding[],
	inputRoot: string,
): Promise<
	| { ok: true; inputs: BrowserUseRunbookInputs }
	| { ok: false; code: string; message: string }
> {
	const inputs: Record<string, unknown> = {};
	for (const binding of bindings) {
		const read = await readPrivateStructuredInput({
			inputId: binding.inputId,
			inputRoot,
			filePath: binding.filePath,
		});
		if (!read.ok) {
			return {
				ok: false,
				code: read.refusal.code,
				message: read.refusal.message,
			};
		}
		Object.assign(inputs, read.inputs);
	}
	return { ok: true, inputs };
}

async function runRunbookRun(
	input: BrowserUseRunbookCommandInput,
	ports: BrowserUseRunbookCommandPorts,
): Promise<number> {
	const flags = input.parsed.flagValues;
	const serviceId = stringField(flags["--service"]) ?? "";
	const flowId = stringField(flags["--flow"]) ?? "";

	const parsedInputs = parseRunbookInputs(
		input.parsed.repeatedFlagValues["--input"] ?? [],
	);
	if (!parsedInputs.ok) {
		return ports.output.emitTaskFailure(undefined, {
			code: "task_run_lane_refused",
			message: parsedInputs.message,
			actionId: "change_task_run_input",
			exitCode: USAGE_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	const privateInputBindings = parsePrivateRunbookInputBindings(
		input.parsed.repeatedFlagValues["--input-file"] ?? [],
	);
	if (!privateInputBindings.ok) {
		return ports.output.emitTaskFailure(undefined, {
			code: privateInputBindings.code,
			message: privateInputBindings.message,
			actionId: "change_runbook_input",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}

	const readStore = await ports.store.open();
	if (!readStore.ok) return readStore.exitCode;
	let deps: RunStoreDeps = { ...readStore.deps, clock: ports.clock };
	const runFlag = stringField(flags["--run"]);
	const explicitTabId = stringField(flags["--tab"]);
	let run: BrowserUseSharedRun | undefined;
	let resumeFromStep = 0;
	if (runFlag !== undefined) {
		const loaded = await loadSharedRun(deps, runFlag);
		if (!loaded.ok) {
			return ports.output.emitPlatformFailure(
				ports.run.platformFailureOf(loaded.code, loaded.message),
			);
		}
		if (ports.run.isTerminalState(loaded.run.state)) {
			if (loaded.run.state === "confirmed") {
				return ports.output.emitSharedRunSuccess({
					run: loaded.run,
					continuationId: "inspect_task_run_result",
					dataExtra: {
						selected_lane: "agent-browser",
						lane_source: "intent-preferred",
						external_effect: "none",
						executed_steps: 0,
						resume: "confirmed-no-op",
					},
					plainExtra: [
						"selected_lane=agent-browser",
						"lane_source=intent-preferred",
						"external_effect=none",
						"executed_steps=0",
						"resume=confirmed-no-op",
					],
				});
			}
			return ports.output.emitTaskFailure(loaded.run.run_id, {
				code: "task_run_effect_unknown",
				message: `run ${loaded.run.run_id} holds terminal truth ${loaded.run.state}; terminal truth never re-enters execution.`,
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none",
			});
		}
		if (loaded.run.runbook_target_binding === undefined) {
			return ports.output.emitTaskFailure(loaded.run.run_id, {
				code: "agent_browser_target_moved",
				message:
					"the existing run has no durable target binding and cannot be resumed safely; start a replacement run.",
				actionId: "restore_bound_runbook_target",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
				dataExtra: {
					lane_outcome: "agent_browser_target_moved",
					external_effect: "none",
				},
			});
		}
		run = loaded.run;
		resumeFromStep = runbookResumeCursorOf(loaded.run);
	}

	const active = await captureActiveGeneration(deps);
	if (active.status === "failure") {
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(active.code, active.message),
		);
	}
	let generationRuntime: BrowserUseGenerationRuntime | undefined =
		active.status === "present" ? active.runtime : undefined;
	if (run !== undefined) {
		if (run.run_execution_binding !== undefined) {
			const retained = await readRetainedCorpusGenerationManifest(deps, {
				generationId: run.run_execution_binding.generation_id,
				activationEpoch: run.run_execution_binding.activation_epoch,
			});
			if (retained.status !== "present") {
				return ports.output.emitTaskFailure(run.run_id, {
					code:
						retained.status === "corrupt"
							? "resume_generation_drift"
							: "resume_generation_unavailable",
					message:
						retained.status === "corrupt"
							? retained.message
							: "the pinned retained generation is unavailable; current authority is not a fallback.",
					actionId: "inspect_task_run_result",
					exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
					recoverability: "repair_state",
				});
			}
			const openedRetained = await createBrowserUseGenerationRuntime(
				deps,
				{
					...retained.manifest,
					generation_content_hash:
						retained.identity.generation_content_hash,
					candidate_manifest_digest:
						retained.identity.candidate_manifest_digest,
					activation_epoch: retained.identity.activation_epoch,
				},
				{ verifyShippedCatalog: false },
			);
			if (!openedRetained.ok) {
				return ports.output.emitPlatformFailure(
					runbookCommandFailureOf(
						openedRetained.failure.code,
						openedRetained.failure.message,
					),
				);
			}
			generationRuntime = openedRetained.runtime;
		} else if (active.status === "present") {
			return ports.output.emitTaskFailure(run.run_id, {
				code: "resume_binding_invalid",
				message:
					"the run predates immutable generation binding and cannot resume after corpus activation.",
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			});
		}
	}

	const shown = await showRunbook(
		deps.fs,
		deps.paths.data.root,
		{ serviceId, flowId },
		generationRuntime?.activeGenerationSeam,
	);
	if (!shown.ok) {
		if (
			shown.failure.code === "runbook_not_found" ||
			shown.failure.code === "runbook_inactive" ||
			shown.failure.code === "runbook_id_invalid"
		) {
			return ports.output.emitTaskFailure(run?.run_id, {
				code: shown.failure.code,
				message: shown.failure.message,
				actionId: "change_task_run_input",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			});
		}
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(
				shown.failure.code,
				shown.failure.message,
			),
		);
	}
	let resolvedAuthCandidate: BrowserUseResolvedAuthCandidate | undefined;
	let resolvedSessionPolicy: BrowserUseGenerationSessionPolicy | undefined;
	if (shown.runbook.auth_context_ref !== undefined) {
		if (generationRuntime === undefined) {
			return ports.output.emitPlatformFailure(
				runbookCommandFailureOf(
					"runbook_record_invalid",
					"an auth-bound runbook requires captured generation authority.",
				),
			);
		}
		const resolved =
			await generationRuntime.authGenerationSeam.loadAuthCandidate(
				shown.runbook.auth_context_ref,
			);
		if (!resolved.ok) {
			return ports.output.emitPlatformFailure(
				runbookCommandFailureOf(
					resolved.failure.code === "auth_generation_record_corrupt"
						? "runbook_record_corrupt"
						: "runbook_record_invalid",
					resolved.failure.message,
				),
			);
		}
		if (
			resolved.resolution.candidate.service_id !==
			shown.runbook.service_id
		) {
			return ports.output.emitPlatformFailure(
				runbookCommandFailureOf(
					"runbook_record_invalid",
					"the captured auth candidate does not match the runbook service.",
				),
			);
		}
		resolvedAuthCandidate = resolved.resolution;
		if (
			resolved.resolution.route === undefined ||
			!("session_policy" in resolved.resolution.route)
		) {
			return ports.output.emitPlatformFailure({
				code: "runbook_auth_session_policy_unproven",
				message:
					"the captured auth route has no reviewed session policy; candidate and runbook origins are not fallback authority.",
				actionId: "inspect-auth-readiness",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			});
		}
		resolvedSessionPolicy =
			resolved.resolution.route.session_policy;
	}
	const custody = enforceRunbookInputCustody(shown.runbook, {
		publicInputIds: Object.keys(parsedInputs.inputs),
		privateInputIds: privateInputBindings.bindings.map(
			(binding) => binding.inputId,
		),
	});
	if (!custody.ok) {
		return ports.output.emitTaskFailure(run?.run_id, {
			code: custody.refusal.code,
			message: custody.refusal.message,
			actionId: "change_runbook_input",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	const privateInputs = await readPrivateRunbookInputs(
		privateInputBindings.bindings,
		join(deps.paths.resolution.roots.runtime, "private-inputs"),
	);
	if (!privateInputs.ok) {
		return ports.output.emitTaskFailure(run?.run_id, {
			code: privateInputs.code,
			message: privateInputs.message,
			actionId: "change_runbook_input",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	const runbookInputs: BrowserUseRunbookInputs = {
		...parsedInputs.inputs,
		...privateInputs.inputs,
	};

	const generationBinding = generationRuntime?.bindingIdentityFor({
		serviceId,
		flowId,
	});
	if (generationBinding !== undefined && "code" in generationBinding) {
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(
				generationBinding.code,
				generationBinding.message,
			),
		);
	}
	const prepared = await prepareRunbookExecution(
		deps.fs,
		deps.paths.data.root,
		{
			serviceId,
			flowId,
			inputs: runbookInputs,
			resumeFromStep,
			...(generationRuntime === undefined
				? {}
				: {
						activeGenerationSeam:
							generationRuntime.activeGenerationSeam,
						actionSeam: generationRuntime.actionGenerationSeam,
						generationBinding,
					}),
		},
	);
	if (!prepared.ok) {
		if (
			prepared.refusal.code === "runbook_not_found" ||
			prepared.refusal.code === "runbook_inactive" ||
			prepared.refusal.code === "runbook_id_invalid" ||
			prepared.refusal.code === "runbook_input_missing" ||
			prepared.refusal.code === "runbook_input_rejected" ||
			prepared.refusal.code === "runbook_resume_out_of_range"
		) {
			return ports.output.emitTaskFailure(run?.run_id, {
				code: prepared.refusal.code,
				message: prepared.refusal.message,
				actionId: "change_task_run_input",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			});
		}
		return ports.output.emitPlatformFailure(
			runbookCommandFailureOf(
				prepared.refusal.code,
				prepared.refusal.message,
			),
		);
	}
	if (run?.run_execution_binding !== undefined) {
		const expected = run.run_execution_binding;
		const observed = prepared.execution_binding;
		if (
			observed === undefined ||
			observed.schema_version !== expected.schema_version ||
			observed.generation_id !== expected.generation_id ||
			observed.activation_epoch !== expected.activation_epoch ||
			observed.service_id !== expected.service_id ||
			observed.flow_id !== expected.flow_id ||
			observed.runbook_version !== expected.runbook_version ||
			observed.runbook_digest !== expected.runbook_digest ||
			observed.action_registry_digest !== expected.action_registry_digest ||
			observed.normalized_input_digest !==
				expected.normalized_input_digest ||
			observed.governed_input_artifact_ref !==
				expected.governed_input_artifact_ref ||
			observed.item_key_digest !== expected.item_key_digest ||
			observed.target_scope !== expected.target_scope ||
			observed.postcondition.id !== expected.postcondition.id ||
			observed.postcondition.summary !== expected.postcondition.summary
		) {
			return ports.output.emitTaskFailure(run.run_id, {
				code: "resume_binding_invalid",
				message:
					"the retained generation, flow, inputs, item keys, target scope, or postcondition do not match the run's immutable execution binding.",
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			});
		}
	}

	let preEffectClaim:
		| {
				continuationId: string;
				claimedRevision: number;
				claimantId: string;
		  }
		| undefined;
	if (
		runFlag !== undefined &&
		run !== undefined &&
		isBrowserUseAuthRunContinuation(run.continuation)
	) {
		const continuation = run.continuation;
		const bindings = continuation.bindings;
		const expectedIdentity =
			resolvedSessionPolicy?.identity_verifier.expected;
		const bindingsMatch =
			generationRuntime !== undefined &&
			resolvedAuthCandidate !== undefined &&
			expectedIdentity !== undefined &&
			bindings.generation_id ===
				generationRuntime.manifest.generation_id &&
			bindings.activation_epoch ===
				generationRuntime.manifest.activation_epoch &&
			bindings.route_digest ===
				resolvedAuthCandidate.route_digest &&
			bindings.lane_id === "agent-browser" &&
			bindings.adapter_id === "agent-browser" &&
			bindings.handoff_evidence_id ===
				run.handoff_evidence_id &&
			bindings.environment ===
				run.environment_profile.environment &&
			bindings.profile ===
				run.environment_profile.profile &&
			bindings.target_binding_id ===
				run.runbook_target_binding?.binding_id &&
			bindings.expected_identity.subject_ref ===
				expectedIdentity.subject_reference &&
			bindings.expected_identity.account_ref ===
				expectedIdentity.account_reference &&
			bindings.expected_identity.tenant_ref ===
				expectedIdentity.tenant_reference;
		if (!bindingsMatch) {
			return ports.output.emitTaskFailure(run.run_id, {
				code: "run_continuation_binding_mismatch",
				message:
					"the durable auth continuation no longer matches the pinned generation, route, lane, profile, target, or expected identity.",
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			});
		}
		const claimStore = await ports.store.open("write");
		if (!claimStore.ok) return claimStore.exitCode;
		deps = { ...claimStore.deps, clock: ports.clock };
		const claimed = await claimRunContinuation(deps, {
			runId: run.run_id,
			continuationId: run.continuation.continuation_id,
			expectedRevision: run.revision,
			claimantId: input.runId,
			actor: "agent",
		});
		if (claimed.status !== "claimed") {
			const code =
				claimed.status === "already-claimed"
					? "run_continuation_already_claimed"
					: claimed.status === "in-progress"
						? "run_continuation_in_progress"
						: claimed.status === "terminal"
							? "run_continuation_terminal"
							: claimed.status === "mismatch"
								? "run_continuation_binding_mismatch"
								: claimed.code;
			const message =
				claimed.status === "unavailable"
					? claimed.message
					: `the auth continuation claim resolved as ${claimed.status}; no browser or authentication effect was attempted.`;
			return ports.output.emitTaskFailure(run.run_id, {
				code,
				message,
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			});
		}
		run = claimed.run;
		preEffectClaim = {
			continuationId:
				claimed.continuation.continuation_id,
			claimedRevision: claimed.run.revision,
			claimantId: input.runId,
		};
	}

	const acquired = await ports.handoff.acquire();
	if (!acquired.ok) {
		if (preEffectClaim !== undefined && run !== undefined) {
			const recovery = await recoverRunContinuationPreEffectClaim(deps, {
				runId: run.run_id,
				continuationId:
					preEffectClaim.continuationId,
				expectedRevision:
					preEffectClaim.claimedRevision,
				claimantId: preEffectClaim.claimantId,
				external_effect:
					BROWSER_USE_EXTERNAL_EFFECT_NONE,
			});
			const recoveryFailure =
				runbookPreEffectClaimRecoveryFailure({
					runId: run.run_id,
					continuationId:
						preEffectClaim.continuationId,
					recovery,
				});
			if (recoveryFailure !== undefined) {
				return ports.output.emitTaskFailure(
					run.run_id,
					recoveryFailure,
				);
			}
		}
		return acquired.reportFailure?.() ?? acquired.exitCode;
	}
	const handoff = acquired.handoff;
	const rawHandoffData = acquired.rawHandoffData;
	if (handoff.adapter !== "agent-browser") {
		return ports.output.emitTaskFailure(run?.run_id, {
			code: "task_run_handoff_lane_mismatch",
			message: `runbook execution runs on the agent-browser lane; the verified handoff attached adapter ${handoff.adapter}.`,
			actionId: "supply_matching_handoff",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	if (run !== undefined) {
		const check = ports.handoff.checkSameLaneResume(
			run,
			"agent-browser",
			handoff,
		);
		if (check !== undefined) {
			return ports.output.emitTaskFailure(run.run_id, check);
		}
	}
	const plan = prepared.plan;
	if (
		run?.runbook_progress !== undefined &&
		(run.runbook_progress.service_id !== plan.service_id ||
			run.runbook_progress.flow_id !== plan.flow_id ||
			run.runbook_progress.runbook_version !== plan.version ||
			run.runbook_progress.total_steps !== plan.total_steps)
	) {
		return ports.output.emitTaskFailure(run.run_id, {
			code: "runbook_progress_identity_mismatch",
			message:
				"the resumed run is bound to a different runbook identity or version.",
			actionId: "inspect_task_run_result",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
		});
	}

	const writeStore = await ports.store.open("write");
	if (!writeStore.ok) return writeStore.exitCode;
	const writeDeps: RunStoreDeps = {
		...writeStore.deps,
		clock: ports.clock,
	};
	if (run?.run_execution_binding !== undefined) {
		const retained = await readRetainedCorpusGenerationManifest(writeDeps, {
			generationId: run.run_execution_binding.generation_id,
			activationEpoch: run.run_execution_binding.activation_epoch,
		});
		if (retained.status !== "present") {
			return ports.output.emitTaskFailure(run.run_id, {
				code:
					retained.status === "corrupt"
						? "resume_generation_drift"
						: "resume_generation_unavailable",
				message:
					retained.status === "corrupt"
						? retained.message
						: "the pinned retained generation became unavailable before write authority was acquired.",
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			});
		}
	} else {
		const observedActive = await captureActiveGeneration(writeDeps);
		if (observedActive.status === "failure") {
			return ports.output.emitPlatformFailure(
				runbookCommandFailureOf(
					observedActive.code,
					observedActive.message,
				),
			);
		}
		const activeChanged =
			observedActive.status !== active.status ||
			(observedActive.status === "present" &&
				active.status === "present" &&
				(observedActive.runtime.manifest.generation_id !==
					active.runtime.manifest.generation_id ||
					observedActive.runtime.manifest.activation_epoch !==
						active.runtime.manifest.activation_epoch ||
					observedActive.runtime.manifest.generation_content_hash !==
						active.runtime.manifest.generation_content_hash ||
					observedActive.runtime.manifest.candidate_manifest_digest !==
						active.runtime.manifest.candidate_manifest_digest));
		if (activeChanged) {
			return ports.output.emitTaskFailure(run?.run_id, {
				code: "migration_activation_conflict",
				message:
					"active generation authority changed before write access was acquired.",
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "retry",
			});
		}
	}
	deps = writeDeps;

	if (run !== undefined && plan.steps.length === 0) {
		return await ports.run.recordOutcome(
			deps,
			run,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			{
				kind: "confirmed",
				executedSteps: 0,
				mutationDispatched: run.mutation_dispatched,
			},
			{ runbookNextStep: plan.total_steps },
		);
	}

	const targetEnvelopeId = targetEnvelopeIdOf({
		runId: run?.run_id ?? handoff.runId,
		mode: "handoff-bound",
		adapter: "agent-browser",
		handoffEvidenceId: handoff.handoffEvidenceId,
	});
	const storedBinding = run?.runbook_target_binding;
	if (run === undefined && generationRuntime !== undefined) {
		const tripped = await tripActiveGenerationEffectFence(deps, {
			generationId: generationRuntime.manifest.generation_id,
			activationEpoch: generationRuntime.manifest.activation_epoch,
			effectKind: "external-dispatch",
			effectRef: handoff.runId,
		});
		if (!tripped.ok) {
			return ports.output.emitMigrationFailure(tripped);
		}
	}
	const targetRequest =
		explicitTabId !== undefined
			? ({
					kind: "exact",
					tab_id: explicitTabId,
					target_envelope_id: targetEnvelopeId,
				} as const)
			: ({
					kind: "auto",
					target_envelope_id: targetEnvelopeId,
					...(storedBinding !== undefined
						? {
								bound_target_candidate_id:
									storedBinding.binding_id,
							}
						: {}),
				} as const);
	const resolveTargetForOrigins = (origins: readonly string[]) =>
		resolveAgentBrowserTaskTarget(
			{ runCommand: ports.runtime.runCommand },
			{
				handoff:
					rawHandoffData as AgentBrowserVerifiedHandoff,
				run_id: run?.run_id ?? handoff.runId,
				allowed_origins: origins,
				steps:
					resolvedSessionPolicy === undefined
						? plan.steps
						: [{ kind: "snapshot", interactive: false }],
				target: targetRequest,
			},
		);
	let targetResolution = await resolveTargetForOrigins(
		resolvedSessionPolicy?.approved_service_origins ??
			plan.allowed_origins,
	);
	if (
		!targetResolution.ok &&
		(targetResolution.code ===
			"agent_browser_target_origin_refused" ||
			targetResolution.code ===
				"agent_browser_target_unavailable") &&
		resolvedSessionPolicy !== undefined
	) {
		targetResolution = await resolveTargetForOrigins(
			resolvedSessionPolicy.approved_identity_provider_origins,
		);
	}
	if (!targetResolution.ok) {
		if (run === undefined) {
			const actionId =
				explicitTabId !== undefined
					? "change_task_run_input"
					: targetResolution.code === "agent_browser_connection_unstable"
						? "refresh_runbook_handoff"
						: "prepare_unique_runbook_target";
			return ports.output.emitTaskFailure(undefined, {
				code: targetResolution.code,
				message: targetResolution.message,
				actionId,
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability:
					actionId === "refresh_runbook_handoff"
						? "repair_state"
						: "change_input",
				dataExtra: { external_effect: "none" },
			});
		}
		return await ports.run.recordOutcome(
			deps,
			run,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			runbookTargetRepairMapping(targetResolution),
			{ runbookNextStep: resumeFromStep },
		);
	}
	if (
		run !== undefined &&
		storedBinding !== undefined &&
		storedBinding.binding_id !== targetResolution.binding.target_candidate_id
	) {
		const mismatchSubject =
			explicitTabId === undefined
				? "the automatically resolved target"
				: "the explicit --tab target";
		const moved: Extract<AgentBrowserTargetResolutionResult, { ok: false }> = {
			ok: false,
			code: "agent_browser_target_moved",
			outcome: "not-achieved",
			message: `${mismatchSubject} does not match the target bound to this run.`,
			executed_steps: 0,
			mutation_dispatched: false,
		};
		return await ports.run.recordOutcome(
			deps,
			run,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			runbookTargetRepairMapping(moved),
			{ runbookNextStep: resumeFromStep },
		);
	}

	const progress = {
		schema_version: "1" as const,
		service_id: plan.service_id,
		flow_id: plan.flow_id,
		runbook_version: plan.version,
		next_step: resumeFromStep,
		total_steps: plan.total_steps,
	};
	const planMayMutate = plan.steps.some(
		(step) =>
			step.kind === "click-semantic" ||
			step.kind === "fill" ||
			(step.kind === "evaluate" && step.effect === "mutation"),
	);
	const durableTargetBinding = {
		schema_version: "1",
		mode: explicitTabId === undefined ? "automatic" : "exact",
		binding_id: targetResolution.binding.target_candidate_id,
	} as const;
	if (run === undefined) {
		const createInput = {
			run_id: handoff.runId,
			state: "running",
			task_intent: "runbook-execution",
			environment_profile: {
				environment: handoff.environmentName,
				profile: handoff.environmentProfile,
			},
			adapter_id: "agent-browser",
			handoff_evidence_id: handoff.handoffEvidenceId,
			runbook_target_binding: durableTargetBinding,
			runbook_progress: progress,
			...(prepared.execution_binding === undefined
				? {}
				: {
						run_execution_binding:
							prepared.execution_binding,
						...(planMayMutate
							? {
									postcondition:
										prepared.execution_binding
											.postcondition,
								}
							: {}),
					}),
			mutation_dispatched: false,
			artifacts: [],
		} as const;
		const created =
			generationRuntime === undefined
				? await createSharedRun(deps, createInput)
				: await withActivationEpochBarrier(
						deps,
						{
							holderId: `generation-run-create-${handoff.runId}`,
						},
						async () => {
							const observed =
								await readActiveCorpusManifest(deps);
							if (
								observed.status !== "present" ||
								observed.manifest.generation_id !==
									generationRuntime.manifest.generation_id ||
								observed.manifest.activation_epoch !==
									generationRuntime.manifest.activation_epoch
							) {
								return {
									ok: false as const,
									code: "migration_activation_conflict" as const,
									message:
										"active generation changed before the run record could bind.",
								};
							}
							return await createSharedRun(deps, createInput);
						},
					);
		if (!created.ok) {
			if (
				created.code === "migration_activation_conflict" ||
				created.code === "epoch_store_failed"
			) {
				return ports.output.emitTaskFailure(undefined, {
					code: created.code,
					message: created.message,
					actionId: "inspect_task_run_result",
					exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
					recoverability:
						created.code === "migration_activation_conflict"
							? "retry"
							: "repair_state",
				});
			}
			return ports.output.emitPlatformFailure(
				ports.run.platformFailureOf(created.code, created.message),
			);
		}
		run = created.run;
	} else if (run.runbook_progress === undefined) {
		const upgraded = await persistRunbookPrivateState(
			ports,
			deps,
			run,
			(current) => ({
				...current,
				...(current.runbook_progress === undefined
					? { runbook_progress: progress }
					: {}),
			}),
		);
		if (!upgraded.ok) {
			return ports.output.emitPlatformFailure(upgraded.failure);
		}
		run = upgraded.run;
	}

	const dispatchLease = await acquireLease(deps, {
		key: leaseKeyForRun(run),
		holderId: `runbook-dispatch-${run.run_id}`,
		ttlMs: RUNBOOK_DISPATCH_LEASE_TTL_MS,
	});
	if (!dispatchLease.ok) {
		return ports.output.emitPlatformFailure(
			ports.run.platformFailureOf(
				dispatchLease.code,
				dispatchLease.code === "lease_held"
					? dispatchLease.continuation.summary
					: dispatchLease.message,
			),
		);
	}
	const dispatchClaim: LeaseWriteClaim = {
		fencing_token: dispatchLease.lease.fencing_token,
		activation_epoch: dispatchLease.lease.activation_epoch,
		holderId: dispatchLease.lease.holder_id,
	};
	const dispatchHeartbeat = startRunbookDispatchLeaseHeartbeat(
		deps,
		dispatchLease.lease,
		ports.run.platformFailureOf,
	);
	let authRun = run;
	let authCheckpointCommitted = false;
	try {
		const emitPersistedAuthFailure = async (
			failure: BrowserUseRunbookCommandFailure,
		): Promise<number> => {
			if (authCheckpointCommitted) {
				run = authRun;
				return ports.output.emitPlatformFailure(failure);
			}
			const continuation =
				resolvedAuthCandidate !== undefined &&
				resolvedSessionPolicy !== undefined &&
				generationRuntime !== undefined
					? buildRunbookAuthContinuation({
							run: authRun,
							failure,
							now: ports.clock(),
							generationRuntime,
							resolution: resolvedAuthCandidate,
							policy: resolvedSessionPolicy,
							handoff,
							targetBindingId:
								targetResolution.binding
									.target_candidate_id,
						})
					: undefined;
			const persisted = await persistRunbookAuthBlock(
				ports,
				deps,
				authRun,
				dispatchClaim,
				failure,
				continuation,
			);
			if (!persisted.ok) {
				return ports.output.emitPlatformFailure(persisted.failure);
			}
			authRun = persisted.run;
			run = authRun;
			return ports.output.emitPlatformFailure(failure);
		};
		const guardResult = beginSensitiveRunGuard(run.run_id);
		const guard = guardResult.ok ? guardResult.guard : undefined;
		const admission = ports.runtime.authAdmission;
		const authProvider =
			admission !== undefined && admission.kind !== "blocked"
				? createBrowserUseAuthProvider({
						store: deps,
						admission,
						attestationByDigest: attestationByDigestFrom(deps),
						bindingStore: createBrowserUseAuthBindingStore({
							paths: deps.paths,
						}),
					})
				: undefined;
		let runbookRunCommand = ports.runtime.runCommand;
		if (resolvedAuthCandidate !== undefined) {
			const policy = resolvedSessionPolicy;
			const targetProof = ports.runtime.authTargetProof;
			if (
				policy === undefined ||
				generationRuntime === undefined ||
				targetProof === undefined
			) {
				return await emitPersistedAuthFailure({
					code: "runbook_auth_session_policy_unproven",
					message:
						"the runbook session policy, generation action authority, or native target proof owner is unavailable.",
					actionId: "inspect-auth-readiness",
					exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
					recoverability: "repair_state",
				});
			}
			const verifiedHandoff =
				rawHandoffData as AgentBrowserVerifiedHandoff;
			const authQuarantine =
				createBrowserUseConfidentialDeliveryQuarantine({
					runCommand: ports.runtime.runCommand,
				});
			runbookRunCommand = authQuarantine.runCommand;
			let preparedItemBinding: BrowserUseItemBinding | undefined;
			let authFragment:
				| BrowserUseAuthTransactionFragment
				| undefined;
			let preparationFailure:
				| BrowserUseRunbookCommandFailure
				| undefined;
			let authenticatedSession:
				| Extract<
						Awaited<
							ReturnType<
								typeof inspectRunbookAuthenticatedSession
							>
						>,
						{ status: "authenticated" }
				  >
				| undefined;
			const authResult = await orchestrateRunbookAuthentication({
				policy,
				resumeContinuation: false,
				ports: {
					claimContinuation: async () => ({ status: "claimed" }),
					inspectSession: async () => {
						const inspected =
							await inspectRunbookAuthenticatedSession({
							policy,
							actionSeam:
								generationRuntime.actionGenerationSeam,
							runCommand: runbookRunCommand,
							targetProof,
							handoff: verifiedHandoff,
							runId: authRun.run_id,
							targetId:
								targetResolution.target_tab_id,
							serviceId:
								resolvedAuthCandidate.candidate.service_id,
							authContext:
								resolvedAuthCandidate.candidate.auth_context,
							environment: handoff.environmentName,
							profile: handoff.environmentProfile,
							clock: ports.clock,
						});
						if (inspected.status === "authenticated") {
							authenticatedSession = inspected;
						}
						return inspected;
					},
					identifyAuthState: async ({
						approvedOrigins,
						action,
					}) =>
						await identifyRunbookAuthState({
							approvedOrigins,
							action,
							actionSeam:
								generationRuntime.actionGenerationSeam,
							runCommand: runbookRunCommand,
							targetProof,
							handoff: verifiedHandoff,
							runId: authRun.run_id,
							targetId:
								targetResolution.target_tab_id,
					}),
					prepareBinding: async () => {
						if (authProvider === undefined) {
							return { ok: false };
						}
						const target =
							await proveAgentBrowserTarget({
								targetProof,
								handoff: verifiedHandoff,
								target_id:
									targetResolution.target_tab_id,
							});
						if (
							!target.ok ||
							target.proof.top_level_origin !==
								target.proof.frame_origin ||
							!policy.approved_identity_provider_origins.includes(
								target.proof.top_level_origin,
							)
						) {
							return { ok: false };
						}
						const prepared =
							await prepareRunbookGenerationAuthBinding(
								authProvider,
								resolvedAuthCandidate,
								[target.proof.top_level_origin],
							);
						if (!prepared.ok) {
							preparationFailure = prepared.failure;
							return { ok: false };
						}
						const begun = beginAuthTransaction({
							binding: {
								run_id: authRun.run_id,
								handoff_evidence_id:
									agentBrowserHandoffEvidenceIdOf(
										verifiedHandoff,
									),
								lane_id: "agent-browser",
								environment:
									handoff.environmentName,
								profile:
									handoff.environmentProfile,
								service_id:
									resolvedAuthCandidate.candidate
										.service_id,
								auth_context:
									resolvedAuthCandidate.candidate
										.auth_context,
								origin:
									target.proof.top_level_origin,
								target_id: target.proof.target_id,
								page_id: target.proof.page_id,
								frame_id: target.proof.frame_id,
							},
							method: "password",
							attempt_limit: 3,
							attempts_already_consumed: 0,
						});
						if (!begun.ok) return { ok: false };
						let fragment = begun.fragment;
						const events: readonly BrowserUseAuthTransactionEvent[] =
							[
								{ type: "pre-auth-proved" },
								{ type: "preparation-complete" },
								{ type: "lease-granted" },
								{
									type: "method-step-complete",
									step: "identify-auth-state",
								},
							];
						for (const event of events) {
							const transitioned =
								applyAuthTransition(fragment, event);
							if (!transitioned.ok) {
								return { ok: false };
							}
							fragment = transitioned.fragment;
						}
						preparedItemBinding = prepared.binding;
						authFragment = fragment;
						return { ok: true };
					},
					persistCheckpoint: async (checkpoint) => {
						if (
							authProvider === undefined ||
							preparedItemBinding === undefined ||
							authFragment === undefined
						) {
							return false;
						}
						const continuation =
							buildRunbookAuthContinuation({
								run: authRun,
								failure: {
									code: "runbook_auth_login_required",
									message:
										"the reviewed login transaction is active.",
									actionId:
										"inspect-auth-readiness",
									exitCode:
										BINDING_FAIL_CLOSED_EXIT_CODE,
									recoverability: "retry",
								},
								activeCheckpoint: checkpoint,
								now: ports.clock(),
								generationRuntime,
								resolution:
									resolvedAuthCandidate,
								policy,
								handoff,
								targetBindingId:
									targetResolution.binding
										.target_candidate_id,
							});
						const committed =
							await authProvider.commitWithClaim(
								dispatchClaim,
								{
									run_id: authRun.run_id,
									expected_revision:
										authRun.revision,
									fragment: authFragment,
									continuation,
								},
							);
						if (!committed.ok) return false;
						authRun = committed.run;
						authCheckpointCommitted = true;
						run = authRun;
						return true;
					},
					deliverField: async () => ({ status: "blocked" }),
					submitAuthAction: async () => ({
						status: "blocked",
					}),
				},
			});
			if (!authResult.ok) {
				return await emitPersistedAuthFailure(
					authResult.code === "auth-binding-unavailable" &&
						preparationFailure !== undefined
						? preparationFailure
						: {
								code: `runbook_${authResult.code.replaceAll("-", "_")}`,
								message:
									"the reviewed runbook authentication session could not be proven.",
								actionId:
									"inspect-auth-readiness",
								exitCode:
									BINDING_FAIL_CLOSED_EXIT_CODE,
								recoverability:
									"repair_state",
							},
				);
			}
			if (authenticatedSession === undefined) {
				return await emitPersistedAuthFailure(
					runbookSessionCommitFailure(
						"the authenticated session result carried no run-bound identity proof.",
					),
				);
			}
			const committedSession =
				await commitRunbookAuthenticatedSession({
					deps,
					run: authRun,
					claim: dispatchClaim,
					session: authenticatedSession,
					serviceId:
						resolvedAuthCandidate.candidate.service_id,
					authContext:
						resolvedAuthCandidate.candidate.auth_context,
				});
			if (!committedSession.ok) {
				return ports.output.emitPlatformFailure(
					committedSession.failure,
				);
			}
			run = committedSession.run;
		}

		let dispatchRun = run;
		let mutationMarkerFailure:
			| BrowserUseRunbookCommandFailure
			| undefined;
		const outcome: BrowserUseRunbookExecutionResult =
			await executePreparedRunbook(
				{
					runtime: {
						runCommand: runbookRunCommand,
						beforeMutationDispatch: async ({ run_id }) => {
							if (run_id !== dispatchRun.run_id) {
								return { ok: false };
							}
							const marked =
								await ports.run.persistMutationDispatch(
									deps,
									dispatchRun,
									dispatchClaim,
								);
							if (!marked.ok) {
								mutationMarkerFailure = marked.failure;
								return { ok: false };
							}
							dispatchRun = marked.run;
							return { ok: true };
						},
					},
					...(authProvider !== undefined
						? {
								authDelivery:
									buildRunbookAuthDelivery(authProvider),
							}
						: admission?.kind === "blocked"
							? {
									authDelivery:
										buildBlockedRunbookAuthDelivery(admission),
								}
							: {}),
					afterNeutralOpen: async (nextStep) => {
						const checkpointed =
							await persistRunbookPrivateState(
								ports,
								deps,
								dispatchRun,
								(current) => ({
									...current,
									runbook_progress:
										current.runbook_progress === undefined
											? progress
											: {
													...current.runbook_progress,
													next_step: nextStep,
												},
								}),
								dispatchClaim,
							);
						if (!checkpointed.ok) return false;
						dispatchRun = checkpointed.run;
						return true;
					},
				},
				{
					plan,
					handoff:
						rawHandoffData as AgentBrowserVerifiedHandoff,
					runId: run.run_id,
					targetTabId: targetResolution.target_tab_id,
					expectedTargetUrl: targetResolution.target_url,
				},
			);
		if (mutationMarkerFailure !== undefined) {
			return ports.output.emitPlatformFailure(
				mutationMarkerFailure,
			);
		}
		if (!outcome.ok) {
			if (
				admission?.kind === "blocked" &&
				outcome.refusal.admission_code === admission.cause.code
			) {
				return ports.output.emitPlatformFailure(
					blockedAdmissionFailure(
						admission,
						outcome.refusal.message,
					),
				);
			}
			return ports.output.emitPlatformFailure(
				runbookCommandFailureOf(
					outcome.refusal.code,
					outcome.refusal.message,
				),
			);
		}
		const heartbeatFailure = dispatchHeartbeat.failure();
		if (heartbeatFailure !== undefined) {
			return ports.output.emitPlatformFailure(heartbeatFailure);
		}

		const dispatchGuard =
			ports.run.markGuardForDeliveryOutcome(
				guard,
				outcome.result,
			);
		if (!dispatchGuard.ok) {
			return ports.output.emitTaskFailure(
				run.run_id,
				ports.run.sentinelRegistrationWithheldFailure(
					dispatchGuard.reason,
				),
			);
		}
		const mapping = mapRunbookAgentBrowserOutcome(
			outcome.result,
			ports,
		);
		const nextStep = nextRunbookStepAfterExecution(
			outcome.plan,
			outcome.result.executed_steps,
		);
		return await ports.run.recordOutcome(
			deps,
			dispatchRun,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			mapping,
			{
				...(dispatchGuard.guard !== undefined
					? { guard: dispatchGuard.guard }
					: {}),
				runbookNextStep: nextStep,
				heldClaim: dispatchClaim,
				structuredResults: outcome.structured_results ?? [],
			},
		);
	} finally {
		const currentDispatchLease = await dispatchHeartbeat.stop();
		await releaseLease(deps, currentDispatchLease);
	}
}

function sanitizeInputPairForError(pair: string): string {
	const equals = pair.indexOf("=");
	return equals > 0
		? `${pair.slice(0, equals)}=[redacted]`
		: "[redacted]";
}

/**
 * Execute one live runbook family command through the extracted owner.
 *
 * The browser-use driver supplies generic store, handoff, output, clock, run,
 * and runtime ports in one plain object. This module owns family ordering.
 *
 * @param input - Resolved runbook command facts
 * @param ports - Existing driver and runtime seams
 * @returns Process exit code
 * @internal
 *
 * @example
 * ```typescript
 * await runBrowserUseRunbookCommand(input, ports)
 * ```
 */
export async function runBrowserUseRunbookCommand(
	input: BrowserUseRunbookCommandInput,
	ports: BrowserUseRunbookCommandPorts,
): Promise<number> {
	if (input.parsed.command === "runbook-list") {
		return runRunbookList(ports);
	}
	if (input.parsed.command === "runbook-show") {
		return runRunbookShow(input, ports);
	}
	return runRunbookRun(input, ports);
}
