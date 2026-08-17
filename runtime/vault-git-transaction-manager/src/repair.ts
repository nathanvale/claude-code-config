import {
	VAULT_GIT_LEDGER_REF,
	createVaultGitActivationRestriction,
	nextVaultGitReceipt,
} from "./model.ts";
import type {
	VaultGitActivationRestriction,
	VaultGitActivationRestrictionCause,
	VaultGitBlockerId,
	VaultGitEngineNextActionId,
	VaultGitReceipt,
	VaultGitRepairAction,
	VaultGitRetrySafety,
	VaultGitTransactionPhase,
	VaultGitTransactionState,
} from "./model.ts";
import type {
	VaultGitActivationValidationPort,
	VaultGitActivationValidationResult,
	VaultGitAtomicCloseResult,
} from "./ports.ts";
import {
	buildVaultGitDoctorProof,
	diagnoseVaultGitTransaction,
	isResumedLocalCommit,
	type VaultGitDoctorOptions,
} from "./doctor.ts";
import {
	acquireRemoteLease,
	buildVaultGitReleaseLedgerContent,
	observeRemoteLedger,
	type RemoteLease,
	supersedeRemoteLease,
	validateRemoteLease,
} from "./remote-ledger.ts";
import type { VaultGitDoctorProof } from "./store.ts";

/** Dependencies for deterministic repair, including final activation authority. */
export interface VaultGitRepairOptions extends VaultGitDoctorOptions {
	/** Live activation revalidation immediately before a remote close. */
	readonly activationAuthority: VaultGitActivationValidationPort;
}

/** Input for one named deterministic repair. */
export interface VaultGitRepairInput {
	/** Exact package-owned action selected by doctor. */
	readonly action: VaultGitRepairAction;
	/**
	 * Non-secret transaction correlation bound by the receipt. May be omitted
	 * only when resuming a receipt persisted before lease acknowledgement,
	 * which never received a transaction id to echo.
	 */
	readonly transactionId?: string;
	/** Named remote bound at admission. */
	readonly remote: string;
	/** Owner capability bytes for ordinary local transaction recovery. */
	readonly capability?: Uint8Array;
	/** Exact stale fencing generation confirmed by the operator. */
	readonly expectedLedgerGeneration?: string;
	/** Single-use private doctor token bytes, never argv or output. */
	readonly doctorToken?: Uint8Array;
	/** Explicit A3 attestation that the prior writer has stopped. */
	readonly priorWriterStopped?: boolean;
}

/** One bounded continuation after a repair attempt. */
export interface VaultGitRepairNextAction {
	/** Stable engine-owned continuation id. */
	readonly id: VaultGitEngineNextActionId;
	/** Package-owned summary with no private evidence. */
	readonly summary: string;
}

/** Capability-free result from one named repair. */
export interface VaultGitRepairResult {
	/** Whether the named action completed or deterministically refused. */
	readonly status: "repaired" | "refused";
	/** Exact action attempted. */
	readonly action: VaultGitRepairAction;
	/** Reconciled transaction state after the attempt. */
	readonly state: VaultGitTransactionState;
	/** Latest durable receipt phase. */
	readonly phase: VaultGitTransactionPhase;
	/** Observable state extent changed by this attempt. */
	readonly changedState: "none" | "local" | "remote" | "partial";
	/** Safety of repeating the exact same repair input. */
	readonly retrySafety: VaultGitRetrySafety;
	/** Exactly one safe continuation. */
	readonly nextAction: VaultGitRepairNextAction;
	/**
	 * Authoritative non-secret transaction correlation from the validated receipt
	 * or quarantine evidence, present whenever the engine loaded and validated that
	 * durable identity. A public selector projection only: callers must prefer it
	 * over their own invocation selector, and it grants no authority.
	 */
	readonly transactionId?: string;
	/** Opaque diagnostics correlation without a private path. */
	readonly diagnosticsReference: string;
	/** Stable refusal reason when no action completed. */
	readonly blocker?: VaultGitBlockerId;
	/** Cause-specific public activation refusal, when activation stopped writes. */
	readonly activationRestriction?: VaultGitActivationRestriction;
}

/** Named deterministic repair executor. */
export interface VaultGitRepairEngine {
	/** Revalidate doctor proof and execute only the selected action. */
	run(input: VaultGitRepairInput): Promise<VaultGitRepairResult>;
}

const summaries = {
	none: "No transaction action remains.",
	complete: "Complete the resumed transaction explicitly.",
	retry: "Run doctor again before another publication attempt.",
	operator: "Ask an operator to inspect the conflicting recovery evidence.",
	inspectReceipt: "Inspect private receipt integrity with an operator.",
	reconcile: "Reconcile preserved local evidence before clearing quarantine.",
} as const;

/**
 * Stamp the validated durable transaction identity onto a repair result. A null
 * or absent identity leaves the result unchanged, so pre-acknowledgement receipts
 * and unvalidated refusals never project a guessed selector.
 */
function withTransactionId(
	result: VaultGitRepairResult,
	transactionId: string | null | undefined,
): VaultGitRepairResult {
	return transactionId ? { ...result, transactionId } : result;
}

const activationRetrySafety: Record<
	VaultGitActivationRestrictionCause,
	VaultGitRetrySafety
> = {
	configuration_missing: "same_input_safe",
	admission_missing: "same_input_safe",
	human_capability_required: "operator_required",
	evidence_changed: "same_input_unsafe",
	binding_changed: "same_input_unsafe",
	invalidated: "same_input_unsafe",
	revoked: "operator_required",
	revalidation_unavailable: "same_input_safe",
};

/**
 * Create the deterministic repair executor.
 *
 * @param options - Same receipt, repository, remote, identity, and clock ports as doctor
 * @returns One executor that admits only fresh doctor-classified actions
 * @throws Never for expected proof, capability, or remote refusals
 *
 * @example
 * ```typescript
 * const repaired = await createVaultGitRepair(options).run({
 *   action: "retry-push", transactionId, remote: "origin", capability,
 * })
 * ```
 */
export function createVaultGitRepair(
	options: VaultGitRepairOptions,
): VaultGitRepairEngine {
	return {
		async run(input) {
			return repairVaultGitTransaction(options, input);
		},
	};
}

/**
 * Execute one named recovery after fresh receipt, local, and remote proof.
 *
 * @param options - Recovery evidence and mutation owners
 * @param input - Exact action, transaction, remote, and private authority
 * @returns Repaired state or one deterministic refusal
 * @throws Never for expected repair ambiguity
 */
export async function repairVaultGitTransaction(
	options: VaultGitRepairOptions,
	input: VaultGitRepairInput,
): Promise<VaultGitRepairResult> {
	const loaded = await options.store.load();
	const diagnostics =
		loaded.status === "loaded"
			? loaded.receipt.diagnosticsReference
			: `doctor:${options.store.repositoryId}`;
	if (loaded.status !== "loaded") {
		return refused(input.action, "human_required", "human_required", "receipt_corrupt", "inspect_private_receipt", summaries.inspectReceipt, diagnostics);
	}
	let receipt = loaded.receipt;
	// Identity validation precedes every idempotent early-return: a caller
	// naming a different transaction or remote gets a refusal, never a
	// repaired/closed success borrowed from another transaction.
	if (input.remote !== receipt.remote || (receipt.transactionId && input.transactionId !== receipt.transactionId)) {
		return refused(input.action, "human_required", receipt.phase, "transaction_mismatch", "request_operator_review", summaries.operator, diagnostics);
	}
	// Identity validated: every later result carries the receipt-owned transaction
	// id, read from the CURRENT receipt at return time so a resume that adopts a
	// lease stamps the adopted identity.
	const stamped = (result: VaultGitRepairResult): VaultGitRepairResult =>
		withTransactionId(result, receipt.transactionId);
	if (
		receipt.phase === "closed" &&
		(input.action === "close-verified" ||
			input.action === "retry-push" ||
			input.action === "resume")
	) {
		return stamped(repaired(input.action, "closed", "closed", "none", "none", summaries.none, diagnostics));
	}
	if (receipt.phase === "closed" && input.action === "stale-lease-takeover") {
		return stamped(refused(input.action, "human_required", "closed", "doctor_token_invalid", "request_operator_review", summaries.operator, diagnostics));
	}

	if (input.action === "stale-lease-takeover") {
		// The single-use private doctor token is the takeover authority; the
		// executor validates and burns it before any mutation.
		return staleLeaseTakeover(options, input, receipt);
	}
	// R26a: only the owner capability may complete, repair, or release. Every
	// remaining action can mutate receipt or quarantine state, so owner
	// authorization precedes dispatch, including close-verified and
	// reconcile-quarantine.
	const authorization = await authorizeOwner(options, receipt, input.capability);
	if (authorization) return stamped({ ...authorization, action: input.action });
	if (input.action === "reconcile-quarantine") {
		return reconcileQuarantine(options, input, receipt);
	}

	const doctor = await diagnoseVaultGitTransaction(options, {
		transactionId: input.transactionId,
		issueTakeoverToken: false,
	});
	if (doctor.repairAction !== input.action) {
		return stamped(refused(input.action, "human_required", receipt.phase, "deterministic_repair_mismatch", "request_operator_review", summaries.operator, diagnostics));
	}

	if (input.action === "close-verified") {
		receipt = nextVaultGitReceipt(receipt, {
			phase: "closed",
			transition: "closed",
			pushOutcome: "closed",
			nextSafeAction: "none",
			recordedAt: options.runtime.now().toISOString(),
		});
		await options.store.append(receipt);
		return stamped(repaired(input.action, "closed", "closed", "local", "none", summaries.none, diagnostics));
	}

	if (input.action === "retry-push") {
		return publishPrepared(options, input.action, loaded.history, receipt);
	}
	if (input.action !== "resume") {
		return stamped(refused(input.action, "human_required", receipt.phase, "deterministic_repair_mismatch", "request_operator_review", summaries.operator, diagnostics));
	}

	if (receipt.transactionId === null) {
		const observed = await observeRemoteLedger(options.ledger, {
			remote: receipt.remote,
		});
		if (observed.status === "refused") {
			return refused(input.action, "human_required", receipt.phase, observed.blocker, "request_operator_review", summaries.operator, diagnostics);
		}
		if (observed.generation === receipt.expectedLeaseGeneration) {
			const acquired = await acquireRemoteLease(options.ledger, {
				remote: receipt.remote,
				expectedGeneration: receipt.expectedLeaseGeneration,
				actor: receipt.actor,
				host: receipt.host,
				event: receipt.event,
				ownedPaths: receipt.ownedPaths.map((entry) => entry.path),
				leaseDurationMs: receipt.leaseDurationMs,
			});
			if (acquired.status === "refused") {
				return refused(input.action, "human_required", receipt.phase, acquired.blocker, "request_operator_review", summaries.operator, diagnostics);
			}
			receipt = nextVaultGitReceipt(receipt, {
				transactionId: acquired.transactionId,
				phase: "leased",
				transition: "lease_won",
				leaseGeneration: acquired.generation,
				leaseAcquiredAt: acquired.lease.acquiredAt,
				nextSafeAction: "resume_writing",
				recordedAt: options.runtime.now().toISOString(),
			});
			await options.store.append(receipt);
		} else if (
			observed.lease &&
			observed.generation &&
			matchesAcquisitionIntent(receipt, observed.lease) &&
			doctor.transactionId !== undefined &&
			observed.lease.transactionId === doctor.transactionId &&
			(input.transactionId === undefined ||
				observed.lease.transactionId === input.transactionId)
		) {
			receipt = nextVaultGitReceipt(receipt, {
				transactionId: observed.lease.transactionId,
				phase: "leased",
				transition: "lease_won",
				leaseGeneration: observed.generation,
				leaseAcquiredAt: observed.lease.acquiredAt,
				nextSafeAction: "resume_writing",
				recordedAt: options.runtime.now().toISOString(),
			});
			await options.store.append(receipt);
		} else {
			return refused(input.action, "human_required", receipt.phase, "lease_generation_stale", "request_operator_review", summaries.operator, diagnostics);
		}
	}

	const identity = await options.repository.resolveCanonicalIdentity().catch(() => null);
	if (!identity || !receipt.transactionId || !receipt.leaseGeneration) {
		return stamped(refused(input.action, "human_required", receipt.phase, "receipt_corrupt", "inspect_private_receipt", summaries.inspectReceipt, diagnostics));
	}
	if (
		receipt.phase === "committing" &&
		identity.localMainHead !== receipt.localMainHead
	) {
		if (!options.repository.inspectLocalCommit || !receipt.transactionId) {
			return stamped(refused(input.action, "human_required", receipt.phase, "receipt_corrupt", "inspect_private_receipt", summaries.inspectReceipt, diagnostics));
		}
		const recoveredCommit = await options.repository.inspectLocalCommit(
			identity.localMainHead,
		);
		if (!isResumedLocalCommit(recoveredCommit, receipt)) {
			return stamped(refused(input.action, "human_required", receipt.phase, "deterministic_repair_mismatch", "request_operator_review", summaries.operator, diagnostics));
		}
		receipt = nextVaultGitReceipt(receipt, {
			phase: "push_pending",
			transition: "push_outcome_unknown",
			commitId: identity.localMainHead,
			expectedMainCommit: identity.localMainHead,
			pushOutcome: "unknown",
			nextSafeAction: "retry_push",
			recordedAt: options.runtime.now().toISOString(),
		});
		await options.store.append(receipt);
		return publishPrepared(options, input.action, [...loaded.history, receipt], receipt);
	}
	if (identity.localMainHead !== receipt.localMainHead) {
		return stamped(refused(input.action, "human_required", receipt.phase, "deterministic_repair_mismatch", "request_operator_review", summaries.operator, diagnostics));
	}
	const resumeFence = await validateRepairWriteAuthority(
		options,
		input.action,
		receipt,
		"active",
	);
	if (resumeFence) return stamped(resumeFence);
	if (receipt.phase === "writing") {
		return stamped(repaired(input.action, "active", "writing", "none", "complete_transaction", summaries.complete, diagnostics));
	}
	const writing = nextVaultGitReceipt(receipt, {
		phase: "writing",
		transition: "write_authority_granted",
		nextSafeAction: "complete_transaction",
		recordedAt: options.runtime.now().toISOString(),
	});
	await options.store.append(writing);
	return stamped(repaired(input.action, "active", "writing", "local", "complete_transaction", summaries.complete, diagnostics));
}

function matchesAcquisitionIntent(
	receipt: VaultGitReceipt,
	lease: RemoteLease,
): boolean {
	return (
		lease.state === "held" &&
		lease.actor === receipt.actor &&
		lease.host === receipt.host &&
		lease.event === receipt.event &&
		JSON.stringify(lease.ownedPaths) ===
			JSON.stringify(receipt.ownedPaths.map((entry) => entry.path)) &&
		lease.localMainHead === receipt.localMainHead &&
		lease.remoteMainHead === receipt.remoteMainHead &&
		lease.leaseDurationMs === receipt.leaseDurationMs
	);
}

async function validateRepairWriteAuthority(
	options: VaultGitRepairOptions,
	action: VaultGitRepairAction,
	receipt: VaultGitReceipt,
	state: VaultGitTransactionState,
): Promise<VaultGitRepairResult | null> {
	if (!receipt.transactionId || !receipt.leaseGeneration) {
		return refused(action, "human_required", receipt.phase, "receipt_corrupt", "inspect_private_receipt", summaries.inspectReceipt, receipt.diagnosticsReference);
	}
	const validated = await validateRemoteLease(options.ledger, {
		remote: receipt.remote,
		expectedGeneration: receipt.leaseGeneration,
		transactionId: receipt.transactionId,
	});
	if (validated.status === "refused") {
		const superseded =
			validated.blocker === "lease_generation_stale" ||
			validated.blocker === "lease_owner_unknown";
		return refused(
			action,
			superseded ? "superseded" : "human_required",
			receipt.phase,
			validated.blocker,
			"request_operator_review",
			summaries.operator,
			receipt.diagnosticsReference,
		);
	}
	const activationRestriction = await validateRepairActivation(options);
	if (!activationRestriction) return null;
	return {
		status: "refused",
		action,
		state,
		phase: receipt.phase,
		changedState: "none",
		retrySafety: activationRetrySafety[activationRestriction.cause.id],
		nextAction: activationRestriction.nextAction,
		diagnosticsReference: receipt.diagnosticsReference,
		blocker: "activation_blocked",
		activationRestriction,
	};
}

async function publishPrepared(
	options: VaultGitRepairOptions,
	action: VaultGitRepairAction,
	history: readonly VaultGitReceipt[],
	receipt: VaultGitReceipt,
): Promise<VaultGitRepairResult> {
	const diagnostics = receipt.diagnosticsReference;
	const stamped = (result: VaultGitRepairResult): VaultGitRepairResult =>
		withTransactionId(result, receipt.transactionId);
	if (!receipt.transactionId || !receipt.leaseGeneration || !receipt.leaseAcquiredAt || !receipt.expectedMainCommit || !options.ledger.git.atomicClose) {
		return stamped(refused(action, "human_required", receipt.phase, "receipt_corrupt", "inspect_private_receipt", summaries.inspectReceipt, diagnostics));
	}
	// Retry publication is a remote write: the same fail-closed safety proof
	// that gates foreground writes gates the repair push (host_contract_breach
	// when the proof is absent, refused, or unavailable).
	let safety: Awaited<ReturnType<NonNullable<VaultGitDoctorOptions["repository"]["inspectSafety"]>>>;
	try {
		safety = options.repository.inspectSafety
			? await options.repository.inspectSafety()
			: { status: "refused", reason: "repository_hook" };
	} catch {
		safety = { status: "refused", reason: "repository_hook" };
	}
	if (safety.status === "refused") {
		return stamped(refused(action, "human_required", receipt.phase, "host_contract_breach", "request_operator_review", summaries.operator, diagnostics));
	}
	const preparedAt =
		history.find((entry) => entry.expectedMainCommit === receipt.expectedMainCommit)
			?.recordedAt ?? receipt.recordedAt;
	const releaseContent = buildVaultGitReleaseLedgerContent(receipt, preparedAt);
	let current = receipt;
	const authorityFence = await validateRepairWriteAuthority(
		options,
		action,
		receipt,
		"push_pending",
	);
	if (authorityFence) return stamped(authorityFence);
	let publication: VaultGitAtomicCloseResult;
	try {
		publication = await options.ledger.git.atomicClose({
			remote: receipt.remote,
			expectedMainHead: receipt.remoteMainHead,
			mainCommit: receipt.expectedMainCommit,
			ledgerRef: VAULT_GIT_LEDGER_REF,
			expectedLedgerGeneration: receipt.leaseGeneration,
			ledgerContent: releaseContent,
			ledgerMessage: `vault-ledger: release ${receipt.transactionId}`,
			author: receipt.actor,
			timestamp: preparedAt,
			async onPrepared(evidence) {
				if (current.ledgerReleaseId && current.ledgerReleaseId !== evidence.ledgerCommit) {
					throw new Error("prepared release object changed");
				}
				if (!current.ledgerReleaseId) {
					current = nextVaultGitReceipt(current, {
						transition: "push_outcome_unknown",
						ledgerReleaseId: evidence.ledgerCommit,
						recordedAt: options.runtime.now().toISOString(),
					});
					await options.store.append(current);
				}
			},
		});
	} catch {
		return stamped(refused(action, "human_required", current.phase, "host_contract_breach", "request_operator_review", summaries.operator, diagnostics, "partial"));
	}
	if (publication.status === "closed") {
		const closed = nextVaultGitReceipt(current, {
			phase: "closed",
			transition: "closed",
			pushOutcome: "closed",
			nextSafeAction: "none",
			recordedAt: options.runtime.now().toISOString(),
		});
		await options.store.append(closed);
		return stamped(repaired(action, "closed", "closed", "remote", "none", summaries.none, diagnostics));
	}
	if (publication.status === "host_contract_breach") {
		const breach = nextVaultGitReceipt(current, {
			phase: "human_required",
			transition: "human_intervention_required",
			pushOutcome: "host_contract_breach",
			nextSafeAction: "request_operator_review",
			recordedAt: options.runtime.now().toISOString(),
		});
		await options.store.append(breach);
		return stamped(refused(action, "human_required", "human_required", "host_contract_breach", "request_operator_review", summaries.operator, diagnostics, "partial"));
	}
	return stamped(refused(action, "push_pending", "push_pending", "push_pending", "request_operator_review", summaries.retry, diagnostics, "partial", "same_input_unsafe"));
}

async function validateRepairActivation(
	options: VaultGitRepairOptions,
): Promise<VaultGitActivationRestriction | null> {
	let validation: VaultGitActivationValidationResult;
	try {
		validation = await options.activationAuthority.validate("continuation");
	} catch {
		validation = { status: "denied", reason: "revalidation_unavailable" };
	}
	if (validation.status === "admitted") return null;
	return createVaultGitActivationRestriction({
		stoppedAction: "vault_write",
		cause:
			validation.status === "revoked" ? "revoked" : validation.reason,
		...(validation.status === "denied" && validation.missingConfiguration
			? { missingConfiguration: validation.missingConfiguration }
			: {}),
	});
}

async function staleLeaseTakeover(
	options: VaultGitDoctorOptions,
	input: VaultGitRepairInput,
	receipt: VaultGitReceipt,
): Promise<VaultGitRepairResult> {
	const diagnostics = receipt.diagnosticsReference;
	if (
		!input.priorWriterStopped ||
		!input.doctorToken ||
		!input.expectedLedgerGeneration ||
		!receipt.transactionId ||
		!receipt.leaseGeneration ||
		input.transactionId !== receipt.transactionId ||
		input.expectedLedgerGeneration !== receipt.leaseGeneration
	) {
		return refused(input.action, "human_required", receipt.phase, "doctor_token_invalid", "request_operator_review", summaries.operator, diagnostics);
	}
	// Takeover identity validated above: every later result carries the
	// receipt-owned transaction id.
	const stamped = (result: VaultGitRepairResult): VaultGitRepairResult =>
		withTransactionId(result, receipt.transactionId);
	const doctor = await diagnoseVaultGitTransaction(options, {
		transactionId: input.transactionId,
		issueTakeoverToken: false,
	});
	if (doctor.repairAction !== "stale-lease-takeover") {
		return stamped(refused(input.action, "human_required", receipt.phase, "doctor_proof_stale", "request_operator_review", summaries.operator, diagnostics));
	}
	let savedProof: VaultGitDoctorProof;
	try {
		savedProof = await options.store.readDoctorProof(
			input.transactionId,
			input.expectedLedgerGeneration,
		);
		const identity = await options.repository.resolveCanonicalIdentity();
		const freshProof = await buildVaultGitDoctorProof(
			options,
			receipt,
			identity.localMainHead,
		);
		if (
			savedProof.receiptId !== freshProof.receiptId ||
			savedProof.receiptRevision !== freshProof.receiptRevision ||
			savedProof.proofFingerprint !== freshProof.proofFingerprint
		) {
			return stamped(refused(input.action, "human_required", receipt.phase, "doctor_proof_stale", "request_operator_review", summaries.operator, diagnostics));
		}
	} catch {
		return stamped(refused(input.action, "human_required", receipt.phase, "doctor_proof_stale", "request_operator_review", summaries.operator, diagnostics));
	}
	const transactionId = receipt.transactionId;
	const ledgerGeneration = receipt.leaseGeneration;
	// The durable takeover-pending marker lands BEFORE the single-use token
	// burns and before any remote mutation: a crash after the remote CAS then
	// leaves evidence doctor can reconcile deterministically. If this write
	// fails, refuse with nothing burned.
	try {
		await options.store.recordQuarantine({
			transactionId,
			ledgerGeneration,
			status: "takeover_pending",
			recordedAt: options.runtime.now().toISOString(),
		});
	} catch {
		return stamped(refused(input.action, "human_required", receipt.phase, "receipt_corrupt", "inspect_private_receipt", summaries.inspectReceipt, diagnostics));
	}
	const consumed = await options.store.consumeDoctorToken(
		savedProof,
		input.doctorToken,
		options.runtime.now().toISOString(),
	);
	if (!consumed) {
		await clearTakeoverPending(options, transactionId, ledgerGeneration);
		return stamped(refused(input.action, "human_required", receipt.phase, "doctor_token_invalid", "request_operator_review", summaries.operator, diagnostics));
	}
	const superseded = await supersedeRemoteLease(options.ledger, {
		remote: receipt.remote,
		expectedGeneration: ledgerGeneration,
		transactionId,
		supersedingActor: options.runtime.actor(),
	});
	if (superseded.status === "refused") {
		if (superseded.changedState === "none") {
			// The remote provably did not change: clear the pending marker; the
			// burned token routes back through one fresh doctor proof.
			await clearTakeoverPending(options, transactionId, ledgerGeneration);
			return stamped(refused(input.action, "human_required", receipt.phase, superseded.blocker, "request_operator_review", summaries.operator, diagnostics));
		}
		// Unknown remote outcome: keep the pending marker so doctor reconciles
		// the interrupted takeover against ledger evidence.
		return stamped(refused(input.action, "human_required", receipt.phase, superseded.blocker, "request_operator_review", summaries.operator, diagnostics, superseded.changedState));
	}
	const abandoned = nextVaultGitReceipt(receipt, {
		phase: "closed",
		transition: "superseded",
		nextSafeAction: "none",
		recordedAt: options.runtime.now().toISOString(),
	});
	try {
		await options.store.recordQuarantine({
			transactionId,
			ledgerGeneration,
			status: "quarantined",
			recordedAt: options.runtime.now().toISOString(),
		});
		await options.store.append(abandoned);
	} catch {
		// The takeover-pending marker survives; doctor finalizes the landed
		// abandonment from remote evidence on its next pass.
		return stamped(refused(input.action, "human_required", receipt.phase, "receipt_corrupt", "inspect_private_receipt", summaries.inspectReceipt, diagnostics, "partial"));
	}
	return stamped(repaired(input.action, "superseded", "closed", "remote", "reconcile_quarantine", summaries.reconcile, diagnostics));
}

/**
 * Best-effort clear of a takeover-pending marker whose remote CAS provably
 * never landed. A failed clear is safe: doctor re-derives the same conclusion
 * from the unchanged ledger generation and clears it deterministically.
 */
async function clearTakeoverPending(
	options: VaultGitDoctorOptions,
	transactionId: string,
	ledgerGeneration: string,
): Promise<void> {
	await options.store
		.recordQuarantine({
			transactionId,
			ledgerGeneration,
			status: "reconciled",
			recordedAt: options.runtime.now().toISOString(),
		})
		.catch(() => undefined);
}

async function reconcileQuarantine(
	options: VaultGitDoctorOptions,
	input: VaultGitRepairInput,
	receipt: VaultGitReceipt,
): Promise<VaultGitRepairResult> {
	const diagnostics = receipt.diagnosticsReference;
	const marker = await options.store.readQuarantine().catch(() => null);
	if (
		!marker ||
		(marker.status !== "quarantined" && marker.status !== "recovery_pending") ||
		marker.transactionId !== input.transactionId
	) {
		return refused(input.action, "human_required", receipt.phase, "deterministic_repair_mismatch", "request_operator_review", summaries.operator, diagnostics);
	}
	// Quarantine identity validated above: every later result carries the
	// marker-owned transaction id.
	const stamped = (result: VaultGitRepairResult): VaultGitRepairResult =>
		withTransactionId(result, marker.transactionId);
	if (isQuarantineReconciliationReceipt(receipt, marker)) {
		return finalizeQuarantineReconciliation(options, input, receipt, marker);
	}
	let recoveryPlan =
		marker.status === "recovery_pending" ? marker.recoveryPlan : null;
	if (
		recoveryPlan === null &&
		options.repository.prepareStagedRecovery &&
		options.repository.applyStagedRecovery
	) {
		const prepared = await options.repository.prepareStagedRecovery(
			receipt.ownedPaths,
		);
		if (prepared.status === "refused" && prepared.reason === "timed_out") {
			return stamped(refused(input.action, "superseded", receipt.phase, "host_quarantined", "reconcile_quarantine", summaries.reconcile, diagnostics, "none", "same_input_safe"));
		}
		if (prepared.status === "ready") {
			recoveryPlan = prepared.plan;
			try {
				await options.store.recordQuarantine({
					transactionId: marker.transactionId,
					ledgerGeneration: marker.ledgerGeneration,
					status: "recovery_pending",
					recordedAt: options.runtime.now().toISOString(),
					recoveryPlan,
				});
			} catch {
				return stamped(refused(input.action, "human_required", receipt.phase, "receipt_corrupt", "inspect_private_receipt", summaries.inspectReceipt, diagnostics));
			}
		}
	}
	if (recoveryPlan !== null) {
		if (!options.repository.applyStagedRecovery) {
			return stamped(refused(input.action, "human_required", receipt.phase, "deterministic_repair_mismatch", "request_operator_review", summaries.operator, diagnostics));
		}
		const recovered = await options.repository.applyStagedRecovery(recoveryPlan);
		if (recovered.status !== "recovered") {
			if (recovered.reason === "timed_out") {
				return stamped(refused(input.action, "superseded", receipt.phase, "host_quarantined", "reconcile_quarantine", summaries.reconcile, diagnostics, "partial", "same_input_safe"));
			}
			return stamped(refused(input.action, "human_required", receipt.phase, "deterministic_repair_mismatch", "request_operator_review", summaries.operator, diagnostics, "partial"));
		}
		return finalizeQuarantineReconciliation(options, input, receipt, marker);
	}
	const identity = await options.repository.resolveCanonicalIdentity().catch(() => null);
	if (!identity) {
		return stamped(refused(input.action, "human_required", receipt.phase, "deterministic_repair_mismatch", "request_operator_review", summaries.operator, diagnostics));
	}
	const ownedPaths = receipt.ownedPaths.map((entry) => entry.path);
	if (identity.localMainHead === receipt.localMainHead) {
		if (
			!options.repository.hashOwnedPaths ||
			!options.repository.captureUnrelatedState
		) {
			return stamped(refused(input.action, "human_required", receipt.phase, "deterministic_repair_mismatch", "request_operator_review", summaries.operator, diagnostics));
		}
		try {
				const [hashes, unrelated] = await Promise.all([
					options.repository.hashOwnedPaths(ownedPaths),
					options.repository.captureUnrelatedState(ownedPaths),
				]);
				if (
					// This branch publishes only receipt and quarantine metadata. Preserve
					// unrelated unstaged worktree drift while fencing the exact index that
					// staged recovery and later commits depend on.
					unrelated.indexHex !== receipt.unrelatedState.indexHex ||
					hashes.some(
					(hash) =>
						receipt.ownedPaths.find((entry) => entry.path === hash.path)
							?.baselineHash !== hash.contentHash,
				)
			) {
				return stamped(refused(input.action, "human_required", receipt.phase, "deterministic_repair_mismatch", "request_operator_review", summaries.operator, diagnostics));
			}
		} catch {
			return stamped(refused(input.action, "human_required", receipt.phase, "deterministic_repair_mismatch", "request_operator_review", summaries.operator, diagnostics));
		}
	} else {
		const settled = await inspectSettledOwnedPaths(
			options,
			receipt,
			identity.localMainHead,
		).catch(() => false);
		if (!settled) {
			return stamped(refused(input.action, "human_required", receipt.phase, "deterministic_repair_mismatch", "request_operator_review", summaries.operator, diagnostics));
		}
	}
	return finalizeQuarantineReconciliation(options, input, receipt, marker);
}

/** Publish one crash-resumable diagnostic epoch before clearing quarantine. */
async function finalizeQuarantineReconciliation(
	options: VaultGitDoctorOptions,
	input: VaultGitRepairInput,
	receipt: VaultGitReceipt,
	marker: Pick<
		NonNullable<Awaited<ReturnType<VaultGitDoctorOptions["store"]["readQuarantine"]>>>,
		"transactionId" | "ledgerGeneration"
	>,
): Promise<VaultGitRepairResult> {
	const diagnostics = receipt.diagnosticsReference;
	const stamped = (result: VaultGitRepairResult): VaultGitRepairResult =>
		withTransactionId(result, marker.transactionId);
	if (!isQuarantineReconciliationReceipt(receipt, marker)) {
		const reconciledReceipt = nextVaultGitReceipt(receipt, {
			phase: "closed",
			transition: "quarantine_reconciled",
			nextSafeAction: "none",
			recordedAt: options.runtime.now().toISOString(),
		});
		try {
			await options.store.append(reconciledReceipt);
		} catch {
			const loaded = await options.store.load().catch(() => null);
			if (
				loaded?.status !== "loaded" ||
				!isQuarantineReconciliationReceipt(loaded.receipt, marker)
			) {
				return stamped(refused(input.action, "human_required", receipt.phase, "receipt_corrupt", "inspect_private_receipt", summaries.inspectReceipt, diagnostics, "partial"));
			}
		}
	}
	try {
		await options.store.recordQuarantine({
			transactionId: marker.transactionId,
			ledgerGeneration: marker.ledgerGeneration,
			status: "reconciled",
			recordedAt: options.runtime.now().toISOString(),
		});
	} catch {
		return stamped(refused(input.action, "human_required", receipt.phase, "receipt_corrupt", "inspect_private_receipt", summaries.inspectReceipt, diagnostics, "partial"));
	}
	return stamped(repaired(input.action, "closed", "closed", "local", "none", summaries.none, diagnostics));
}

/** Match only the receipt revision that proves this exact quarantine settled. */
function isQuarantineReconciliationReceipt(
	receipt: VaultGitReceipt,
	marker: Pick<
		NonNullable<Awaited<ReturnType<VaultGitDoctorOptions["store"]["readQuarantine"]>>>,
		"transactionId" | "ledgerGeneration"
	>,
): boolean {
	return (
		receipt.phase === "closed" &&
		receipt.transition === "quarantine_reconciled" &&
		receipt.transactionId === marker.transactionId &&
		receipt.leaseGeneration === marker.ledgerGeneration &&
		receipt.nextSafeAction === "none"
	);
}

/** Prove a later canonical main has settled every formerly owned path. */
async function inspectSettledOwnedPaths(
	options: VaultGitDoctorOptions,
	receipt: VaultGitReceipt,
	currentMainHead: string,
): Promise<boolean> {
	if (!options.repository.inspectCommitAncestry) return false;
	const ownedPaths = receipt.ownedPaths.map((entry) => entry.path);
	const [main, ancestry, admission] = await Promise.all([
		options.ledger.git.inspectMain(receipt.remote),
		options.repository.inspectCommitAncestry(
			receipt.localMainHead,
			currentMainHead,
		),
		options.repository.inspectOwnedPaths(ownedPaths),
	]);
	return (
		main.status === "ok" &&
		main.alignment === "aligned" &&
		main.localHead === currentMainHead &&
		main.remoteHead === currentMainHead &&
		ancestry === "ancestor" &&
		admission.status === "admitted" &&
		JSON.stringify(admission.paths.map((entry) => entry.path)) ===
			JSON.stringify(ownedPaths)
	);
}

async function authorizeOwner(
	options: VaultGitDoctorOptions,
	receipt: VaultGitReceipt,
	capability: Uint8Array | undefined,
): Promise<Omit<VaultGitRepairResult, "action"> | null> {
	if (!capability) {
		return refusedWithoutAction("active", receipt.phase, "capability_invalid", "reload_capability", summaries.inspectReceipt, receipt.diagnosticsReference);
	}
	try {
		if (
			await options.store.validateCapability(
				receipt.receiptId,
				"owner",
				capability,
			)
		) {
			return null;
		}
		if (
			await options.store.validateCapability(
				receipt.receiptId,
				"join",
				capability,
			)
		) {
			return refusedWithoutAction("active", receipt.phase, "capability_role_mismatch", "use_owner_capability", summaries.inspectReceipt, receipt.diagnosticsReference);
		}
	} catch {
		// Convert private state failures into one bounded refusal.
	}
	return refusedWithoutAction("active", receipt.phase, "capability_invalid", "reload_capability", summaries.inspectReceipt, receipt.diagnosticsReference);
}

function repaired(
	action: VaultGitRepairAction,
	state: VaultGitTransactionState,
	phase: VaultGitTransactionPhase,
	changedState: VaultGitRepairResult["changedState"],
	actionId: VaultGitEngineNextActionId,
	summary: string,
	diagnosticsReference: string,
): VaultGitRepairResult {
	return {
		status: "repaired",
		action,
		state,
		phase,
		changedState,
		retrySafety: "same_input_safe",
		nextAction: { id: actionId, summary },
		diagnosticsReference,
	};
}

function refused(
	action: VaultGitRepairAction,
	state: VaultGitTransactionState,
	phase: VaultGitTransactionPhase,
	blocker: VaultGitBlockerId,
	actionId: VaultGitEngineNextActionId,
	summary: string,
	diagnosticsReference: string,
	changedState: VaultGitRepairResult["changedState"] = "none",
	retrySafety: VaultGitRetrySafety = "operator_required",
): VaultGitRepairResult {
	return {
		...refusedWithoutAction(
			state,
			phase,
			blocker,
			actionId,
			summary,
			diagnosticsReference,
			changedState,
			retrySafety,
		),
		action,
	};
}

function refusedWithoutAction(
	state: VaultGitTransactionState,
	phase: VaultGitTransactionPhase,
	blocker: VaultGitBlockerId,
	actionId: VaultGitEngineNextActionId,
	summary: string,
	diagnosticsReference: string,
	changedState: VaultGitRepairResult["changedState"] = "none",
	retrySafety: VaultGitRetrySafety = "operator_required",
): Omit<VaultGitRepairResult, "action"> {
	return {
		status: "refused",
		state,
		phase,
		changedState,
		retrySafety,
		blocker,
		nextAction: { id: actionId, summary },
		diagnosticsReference,
	};
}
