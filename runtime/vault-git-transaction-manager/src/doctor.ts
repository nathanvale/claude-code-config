import { createHash } from "node:crypto";

import { VAULT_GIT_LEDGER_REF } from "./model.ts";
import type {
	VaultGitBlockerId,
	VaultGitDoctorFinding,
	VaultGitEngineNextActionId,
	VaultGitRepairAction,
	VaultGitRetrySafety,
	VaultGitTransactionPhase,
	VaultGitTransactionState,
} from "./model.ts";
import type {
	VaultGitRepositoryPort,
	VaultGitRuntimePort,
} from "./ports.ts";
import {
	observeRemoteLedger,
	type RemoteLedgerEngine,
} from "./remote-ledger.ts";
import type {
	VaultGitDoctorProof,
	VaultGitReceiptStore,
} from "./store.ts";

/** Dependencies for evidence-backed recovery classification. */
export interface VaultGitDoctorOptions {
	/** Private append-only receipt and proof-token state. */
	readonly store: VaultGitReceiptStore;
	/** Read-only local repository evidence. */
	readonly repository: VaultGitRepositoryPort;
	/** Read-only remote main and ledger evidence. */
	readonly ledger: RemoteLedgerEngine;
	/** Injected identity and clock. */
	readonly runtime: VaultGitRuntimePort;
	/** Configured canonical repository identity. */
	readonly repositoryIdentity: string;
}

/** Optional transaction selector for one doctor pass. */
export interface VaultGitDoctorInput {
	/** Refuse if the current receipt belongs to another transaction. */
	readonly transactionId?: string;
	/** Issue a fresh private takeover token when stale proof succeeds. */
	readonly issueTakeoverToken?: boolean;
}

/** Exactly one safe continuation selected from reconciled evidence. */
export interface VaultGitDoctorNextAction {
	/** Stable engine-owned continuation id. */
	readonly id: VaultGitEngineNextActionId;
	/** Package-owned summary with no private evidence. */
	readonly summary: string;
}

/** Capability-free doctor report answering the R19 recovery questions. */
export interface VaultGitDoctorResult {
	/** Successful classification marker. */
	readonly status: "diagnosed";
	/** Reconciled transaction state. */
	readonly state: VaultGitTransactionState;
	/** Latest durable receipt phase. */
	readonly phase: VaultGitTransactionPhase;
	/** Closed vocabulary describing what happened. */
	readonly finding: VaultGitDoctorFinding;
	/** Private state mutation made only for stale-token issuance. */
	readonly changedState: "none" | "local";
	/** Safety of repeating the same doctor input. */
	readonly retrySafety: VaultGitRetrySafety;
	/** Exactly one safe continuation. */
	readonly nextAction: VaultGitDoctorNextAction;
	/** Opaque diagnostics correlation without a private path. */
	readonly diagnosticsReference: string;
	/** Stable blocker when no deterministic continuation exists. */
	readonly blocker?: VaultGitBlockerId;
	/** Exact named repair admitted by the fresh proof. */
	readonly repairAction?: VaultGitRepairAction;
	/** Non-secret transaction correlation. */
	readonly transactionId?: string;
	/** Exact ledger fencing generation. */
	readonly ledgerGeneration?: string;
	/** True only when fresh stale-lease proof issued private token material. */
	readonly takeoverTokenIssued?: boolean;
}

/** Read-only doctor policy surface. */
export interface VaultGitDoctor {
	/** Reconcile private, local, and remote evidence into one continuation. */
	diagnose(input?: VaultGitDoctorInput): Promise<VaultGitDoctorResult>;
}

const summaries = {
	begin: "Begin one transaction before canonical writes.",
	inspectReceipt: "Inspect private receipt integrity with an operator.",
	resume: "Run the named resume repair after fresh evidence revalidation.",
	retryPush: "Retry the prepared atomic close from the originating host.",
	closeVerified: "Record the already-published atomic close as closed.",
	operator: "Ask an operator to inspect the conflicting recovery evidence.",
	takeover: "Attest the prior writer stopped, then run stale-lease-takeover.",
	reconcile: "Reconcile preserved local evidence before clearing quarantine.",
	none: "No transaction action remains.",
} as const;

/**
 * Create the doctor classifier without granting write authority.
 *
 * @param options - Receipt, repository, remote, identity, and clock ports
 * @returns One classifier that emits bounded evidence and continuations
 * @throws Never for expected corrupt, missing, or unavailable evidence
 *
 * @example
 * ```typescript
 * const report = await createVaultGitDoctor(options).diagnose()
 * if (report.repairAction) select(report.repairAction)
 * ```
 */
export function createVaultGitDoctor(
	options: VaultGitDoctorOptions,
): VaultGitDoctor {
	return {
		async diagnose(input = {}) {
			return diagnoseVaultGitTransaction(options, input);
		},
	};
}

/**
 * Run one fresh doctor proof for engine and repair composition.
 *
 * @param options - Doctor evidence ports
 * @param input - Optional transaction selector and token posture
 * @returns One complete bounded recovery report
 * @throws Never for expected recovery ambiguity
 */
export async function diagnoseVaultGitTransaction(
	options: VaultGitDoctorOptions,
	input: VaultGitDoctorInput = {},
): Promise<VaultGitDoctorResult> {
	const diagnosticsReference = `doctor:${options.store.repositoryId}`;
	let quarantine: Awaited<ReturnType<VaultGitReceiptStore["readQuarantine"]>>;
	try {
		quarantine = await options.store.readQuarantine();
	} catch {
		return report("human_required", "human_required", "receipt_corrupt", "operator_required", "inspect_private_receipt", summaries.inspectReceipt, diagnosticsReference, { blocker: "receipt_corrupt" });
	}
	if (quarantine?.status === "quarantined") {
		return report("superseded", "human_required", "host_quarantined", "operator_required", "reconcile_quarantine", summaries.reconcile, diagnosticsReference, {
			blocker: "host_quarantined",
			repairAction: "reconcile-quarantine",
			transactionId: quarantine.transactionId,
			ledgerGeneration: quarantine.ledgerGeneration,
		});
	}
	const loaded = await options.store.load();
	if (loaded.status === "absent") {
		return report("absent", "blocked", "no_receipt", "same_input_safe", "begin_transaction", summaries.begin, diagnosticsReference);
	}
	if (loaded.status !== "loaded") {
		return report("human_required", "human_required", "receipt_corrupt", "operator_required", "inspect_private_receipt", summaries.inspectReceipt, diagnosticsReference, { blocker: "receipt_corrupt" });
	}
	const receipt = loaded.receipt;
	const common = {
		transactionId: receipt.transactionId ?? undefined,
		ledgerGeneration: receipt.leaseGeneration ?? undefined,
	};
	if (input.transactionId && input.transactionId !== receipt.transactionId) {
		return report("human_required", receipt.phase, "operator_intervention_recorded", "operator_required", "request_operator_review", summaries.operator, receipt.diagnosticsReference, { ...common, blocker: "transaction_mismatch" });
	}
	if (receipt.phase === "closed") {
		return report("closed", "closed", "transaction_closed", "same_input_safe", "none", summaries.none, receipt.diagnosticsReference, common);
	}
	if (receipt.phase === "human_required") {
		return report("human_required", receipt.phase, receipt.pushOutcome === "host_contract_breach" ? "remote_contract_breach" : "operator_intervention_recorded", "operator_required", "request_operator_review", summaries.operator, receipt.diagnosticsReference, { ...common, blocker: receipt.pushOutcome === "host_contract_breach" ? "host_contract_breach" : "human_required" });
	}

	let identity: Awaited<ReturnType<VaultGitRepositoryPort["resolveCanonicalIdentity"]>>;
	try {
		identity = await options.repository.resolveCanonicalIdentity();
	} catch {
		return report("human_required", receipt.phase, "operator_intervention_recorded", "operator_required", "inspect_configured_vault", summaries.operator, receipt.diagnosticsReference, { ...common, blocker: "vault_identity_changed" });
	}
	if (identity.identity !== options.repositoryIdentity) {
		return report("human_required", receipt.phase, "operator_intervention_recorded", "operator_required", "inspect_configured_vault", summaries.operator, receipt.diagnosticsReference, { ...common, blocker: "vault_identity_changed" });
	}

	if (receipt.phase === "push_pending") {
		if (!receipt.transactionId || !receipt.leaseGeneration || !receipt.expectedMainCommit || !receipt.ledgerReleaseId || !options.ledger.git.reconcileAtomicClose || !options.repository.inspectLocalCommit) {
			return report("human_required", receipt.phase, "receipt_corrupt", "operator_required", "inspect_private_receipt", summaries.inspectReceipt, receipt.diagnosticsReference, { ...common, blocker: "receipt_corrupt" });
		}
		if (identity.localMainHead !== receipt.expectedMainCommit) {
			return report("human_required", receipt.phase, "remote_contract_breach", "operator_required", "request_operator_review", summaries.operator, receipt.diagnosticsReference, { ...common, blocker: "host_contract_breach" });
		}
		const localCommit = await options.repository.inspectLocalCommit(
			receipt.expectedMainCommit,
		);
		if (
			localCommit.status !== "ok" ||
			localCommit.parents.length !== 1 ||
			localCommit.parents[0] !== receipt.localMainHead ||
			!hasTransactionTrailer(localCommit.message, receipt.transactionId)
		) {
			return report("human_required", receipt.phase, "remote_contract_breach", "operator_required", "request_operator_review", summaries.operator, receipt.diagnosticsReference, { ...common, blocker: "host_contract_breach" });
		}
		const reconciled = await options.ledger.git.reconcileAtomicClose({
			remote: receipt.remote,
			transactionId: receipt.transactionId,
			expectedMainHead: receipt.remoteMainHead,
			mainCommit: receipt.expectedMainCommit,
			ledgerRef: VAULT_GIT_LEDGER_REF,
			expectedLedgerGeneration: receipt.leaseGeneration,
			ledgerCommit: receipt.ledgerReleaseId,
		});
		if (reconciled.status === "closed") {
			return report("push_pending", receipt.phase, "publication_already_closed", "same_input_safe", "run_repair", summaries.closeVerified, receipt.diagnosticsReference, { ...common, repairAction: "close-verified" });
		}
		if (reconciled.status === "host_contract_breach") {
			return report("human_required", receipt.phase, "remote_contract_breach", "operator_required", "request_operator_review", summaries.operator, receipt.diagnosticsReference, { ...common, blocker: "host_contract_breach" });
		}
		if (reconciled.status === "unknown") {
			return report("human_required", receipt.phase, "remote_outcome_unknown", "operator_required", "request_operator_review", summaries.operator, receipt.diagnosticsReference, { ...common, blocker: "remote_unavailable" });
		}
		if (receipt.host !== options.runtime.host()) {
			return report("human_required", receipt.phase, "publication_pending", "operator_required", "request_operator_review", summaries.operator, receipt.diagnosticsReference, { ...common, blocker: "push_pending" });
		}
		return report("push_pending", receipt.phase, "publication_pending", "same_input_safe", "run_repair", summaries.retryPush, receipt.diagnosticsReference, { ...common, repairAction: "retry-push" });
	}

	const observed = await observeRemoteLedger(options.ledger, {
		remote: receipt.remote,
	});
	if (observed.status === "refused") {
		return report("human_required", receipt.phase, "remote_outcome_unknown", "operator_required", "request_operator_review", summaries.operator, receipt.diagnosticsReference, { ...common, blocker: observed.blocker });
	}

	if (receipt.transactionId === null) {
		if (observed.generation === receipt.expectedLeaseGeneration) {
			return report("repairable", receipt.phase, "acquisition_not_started", "same_input_safe", "run_repair", summaries.resume, receipt.diagnosticsReference, { repairAction: "resume" });
		}
		if (observed.lease && exactIntentBinding(receipt, observed.lease)) {
			return report("repairable", receipt.phase, "lease_acknowledgement_missing", "same_input_safe", "run_repair", summaries.resume, receipt.diagnosticsReference, {
				repairAction: "resume",
				transactionId: observed.lease.transactionId,
				ledgerGeneration: observed.generation ?? undefined,
			});
		}
		return report("human_required", receipt.phase, "lease_superseded", "operator_required", "request_operator_review", summaries.operator, receipt.diagnosticsReference, { blocker: "lease_generation_stale" });
	}

	if (
		observed.generation !== receipt.leaseGeneration ||
		observed.lease?.transactionId !== receipt.transactionId ||
		observed.lease.state !== "held"
	) {
		return report("superseded", receipt.phase, "lease_superseded", "operator_required", "request_operator_review", summaries.operator, receipt.diagnosticsReference, { ...common, blocker: "lease_generation_stale" });
	}

	const leaseExpired =
		!receipt.leaseAcquiredAt ||
		options.runtime.now().getTime() >=
			Date.parse(receipt.leaseAcquiredAt) + receipt.leaseDurationMs;
	if (leaseExpired) {
		let changedState: "none" | "local" = "none";
		let takeoverTokenIssued = false;
		if (input.issueTakeoverToken !== false && receipt.leaseGeneration) {
			try {
				const proof = await buildVaultGitDoctorProof(options, receipt, identity.localMainHead);
				await options.store.issueDoctorToken(proof);
				changedState = "local";
				takeoverTokenIssued = true;
			} catch {
				return report("human_required", receipt.phase, "receipt_corrupt", "operator_required", "inspect_private_receipt", summaries.inspectReceipt, receipt.diagnosticsReference, { ...common, blocker: "receipt_corrupt" });
			}
		}
		return report("expired", receipt.phase, "lease_expired", "operator_required", "run_repair", summaries.takeover, receipt.diagnosticsReference, {
			...common,
			repairAction: "stale-lease-takeover",
			changedState,
			takeoverTokenIssued,
		});
	}

	if (identity.localMainHead !== receipt.localMainHead) {
		if (
			receipt.phase === "committing" &&
			options.repository.inspectLocalCommit
		) {
			const commit = await options.repository.inspectLocalCommit(identity.localMainHead);
			if (
				commit.status === "ok" &&
				commit.parents.length === 1 &&
				commit.parents[0] === receipt.localMainHead &&
				hasTransactionTrailer(commit.message, receipt.transactionId)
			) {
				return report("repairable", receipt.phase, "local_commit_recovered", "same_input_safe", "run_repair", summaries.resume, receipt.diagnosticsReference, { ...common, repairAction: "resume" });
			}
		}
		return report("human_required", receipt.phase, "remote_contract_breach", "operator_required", "request_operator_review", summaries.operator, receipt.diagnosticsReference, { ...common, blocker: "host_contract_breach" });
	}

	const finding: VaultGitDoctorFinding =
		receipt.phase === "leased"
			? "lease_acquired"
			: receipt.phase === "writing"
				? "writes_in_progress"
				: receipt.phase === "checking"
					? "checks_interrupted"
					: receipt.phase === "committing"
						? "commit_interrupted"
						: "deterministic_failure";
	return report("repairable", receipt.phase, finding, "same_input_safe", "run_repair", summaries.resume, receipt.diagnosticsReference, { ...common, repairAction: "resume" });
}

function hasTransactionTrailer(message: string, transactionId: string): boolean {
	return message
		.split(/\r?\n/)
		.some((line) => line === `Vault-Transaction: ${transactionId}`);
}

/**
 * Hash current local evidence into a non-secret stale-lease proof binding.
 *
 * @param options - Doctor evidence ports
 * @param receipt - Exact private receipt revision being proved
 * @param localMainHead - Fresh canonical local main head
 * @returns Proof metadata suitable for private single-use token issuance
 * @throws When the receipt lacks lease ownership or local probes fail
 */
export async function buildVaultGitDoctorProof(
	options: VaultGitDoctorOptions,
	receipt: Extract<Awaited<ReturnType<VaultGitReceiptStore["load"]>>, { status: "loaded" }>["receipt"],
	localMainHead: string,
): Promise<VaultGitDoctorProof> {
	if (!receipt.transactionId || !receipt.leaseGeneration) {
		throw new Error("stale proof requires acquired lease evidence");
	}
	if (
		!options.repository.hashOwnedPaths ||
		!options.repository.captureUnrelatedState
	) {
		throw new Error("stale proof requires complete local hash probes");
	}
	const [ownedHashes, unrelatedState] = await Promise.all([
		options.repository.hashOwnedPaths(
			receipt.ownedPaths.map((entry) => entry.path),
		),
		options.repository.captureUnrelatedState(
			receipt.ownedPaths.map((entry) => entry.path),
		),
	]);
	const issuedAt = options.runtime.now().toISOString();
	const proofFingerprint = createHash("sha256")
		.update(
			JSON.stringify({
				receiptId: receipt.receiptId,
				receiptRevision: receipt.revision,
				transactionId: receipt.transactionId,
				ledgerGeneration: receipt.leaseGeneration,
				localMainHead,
				ownedHashes,
				unrelatedState,
			}),
		)
		.digest("hex");
	return {
		transactionId: receipt.transactionId,
		ledgerGeneration: receipt.leaseGeneration,
		receiptId: receipt.receiptId,
		receiptRevision: receipt.revision,
		proofFingerprint,
		issuedAt,
	};
}

function exactIntentBinding(
	receipt: Extract<Awaited<ReturnType<VaultGitReceiptStore["load"]>>, { status: "loaded" }>["receipt"],
	lease: NonNullable<Extract<Awaited<ReturnType<typeof observeRemoteLedger>>, { status: "observed" }>["lease"]>,
): boolean {
	return (
		lease.state === "held" &&
		lease.actor === receipt.actor &&
		lease.host === receipt.host &&
		lease.event === receipt.event &&
		lease.localMainHead === receipt.localMainHead &&
		lease.remoteMainHead === receipt.remoteMainHead &&
		lease.leaseDurationMs === receipt.leaseDurationMs &&
		JSON.stringify(lease.ownedPaths) ===
			JSON.stringify(receipt.ownedPaths.map((entry) => entry.path))
	);
}

function report(
	state: VaultGitTransactionState,
	phase: VaultGitTransactionPhase,
	finding: VaultGitDoctorFinding,
	retrySafety: VaultGitRetrySafety,
	actionId: VaultGitEngineNextActionId,
	summary: string,
	diagnosticsReference: string,
	extra: Partial<VaultGitDoctorResult> = {},
): VaultGitDoctorResult {
	return {
		status: "diagnosed",
		state,
		phase,
		finding,
		changedState: extra.changedState ?? "none",
		retrySafety,
		nextAction: { id: actionId, summary },
		diagnosticsReference,
		...(extra.blocker ? { blocker: extra.blocker } : {}),
		...(extra.repairAction ? { repairAction: extra.repairAction } : {}),
		...(extra.transactionId ? { transactionId: extra.transactionId } : {}),
		...(extra.ledgerGeneration
			? { ledgerGeneration: extra.ledgerGeneration }
			: {}),
		...(extra.takeoverTokenIssued
			? { takeoverTokenIssued: true as const }
			: {}),
	};
}
