import {
	createVaultGitActivationRestriction,
	VAULT_GIT_LEDGER_REF,
	nextVaultGitReceipt,
} from "./model.ts";
import type {
	VaultGitActivationRestriction,
	VaultGitBlockerId,
	VaultGitCheckerAdmissionRecord,
	VaultGitEngineNextActionId,
	VaultGitEventType,
	VaultGitOwnedPathReceipt,
	VaultGitReceipt,
	VaultGitReceiptNextAction,
	VaultGitRetrySafety,
	VaultGitPrivateHygieneResult,
	VaultGitTransactionPhase,
	VaultGitTransactionState,
	VaultGitWritePermission,
} from "./model.ts";
import {
	VaultRepositoryIdentityUnavailableError,
	type VaultGitActivationValidationPort,
	type VaultGitActivationValidationResult,
	type VaultGitActivationValidationScope,
	type VaultGitAtomicCloseResult,
	type VaultGitCheckPort,
	type VaultGitCheckResult,
	type VaultGitRepositoryPort,
	type VaultGitRuntimePort,
	type VaultGitValidationFailureClass,
} from "./ports.ts";
import type { VaultGitValidationFailure } from "./model.ts";
import {
	buildVaultCommitMessage,
	validateVaultCommitLabel,
	validateVaultCommitSubject,
} from "./commit-policy.ts";
import {
	acquireRemoteLease,
	buildVaultGitReleaseLedgerContent,
	observeRemoteLedger,
	releaseRemoteLease,
	validateRemoteLease,
	type RemoteLedgerEngine,
} from "./remote-ledger.ts";
import type {
	VaultGitCapabilityRole,
	VaultGitReceiptStore,
} from "./store.ts";
import {
	createVaultGitDoctor,
	type VaultGitDoctorInput,
	type VaultGitDoctorResult,
} from "./doctor.ts";
import {
	createVaultGitRepair,
	type VaultGitRepairInput,
	type VaultGitRepairResult,
} from "./repair.ts";

/** Dependencies for the transaction state machine. */
export interface VaultGitTransactionEngineOptions {
	/** Private receipt and role-capability adapter. */
	readonly store: VaultGitReceiptStore;
	/** Configured-vault filesystem facts. */
	readonly repository: VaultGitRepositoryPort;
	/** Remote main and lease-ledger engine. */
	readonly ledger: RemoteLedgerEngine;
	/** Injected time, identity, ids, and interruption points. */
	readonly runtime: VaultGitRuntimePort;
	/** Canonical non-secret configured repository identity. */
	readonly repositoryIdentity: string;
	/** Injected vault-owned validation command. */
	readonly check?: VaultGitCheckPort;
	/** Live V2 activation revalidation before admission and fenced continuation. */
	readonly activationAuthority: VaultGitActivationValidationPort;
}

/** Input for one transaction admission attempt. */
export interface VaultGitBeginInput {
	readonly event: VaultGitEventType;
	readonly requestedPaths: readonly string[];
	readonly remote: string;
	readonly leaseDurationMs: number;
	/** Keep canonical and receipt state unchanged. */
	readonly offline?: boolean;
}

/** Input for one nested owned-path extension. */
export interface VaultGitJoinInput {
	readonly transactionId: string;
	readonly requestedPaths: readonly string[];
	readonly remote: string;
	readonly capability: Uint8Array;
}

/** Input for an owner-only lifecycle action. */
export interface VaultGitOwnerInput {
	readonly transactionId: string;
	readonly remote: string;
	readonly capability: Uint8Array;
	/** Caller-written semantic Conventional Commit subject. */
	readonly summary?: string;
}

/** Internal durable phase transition used by later commit and repair units. */
export interface VaultGitRecordPhaseInput {
	readonly transactionId: string;
	readonly remote: string;
	/** Owner capability bytes; join or invalid bytes refuse the transition. */
	readonly capability: Uint8Array;
	readonly phase: "push_pending" | "repairable" | "human_required" | "closed";
	readonly nextSafeAction: VaultGitReceiptNextAction;
}

/** One safe engine continuation. */
export interface VaultGitEngineNextAction {
	readonly id: VaultGitEngineNextActionId;
	readonly summary: string;
}

/** Optional non-mutating transaction selector for one inspection pass. */
export interface VaultGitInspectInput {
	/**
	 * Refuse when the current receipt is bound to another transaction.
	 * Mirrors doctor's correlation handling: receipts persisted before lease
	 * acknowledgement carry no transaction id, so mismatch enforcement applies
	 * only once the receipt binds one.
	 */
	readonly transactionId?: string;
}

/** Capability-free transaction-engine result. */
export interface VaultGitEngineResult {
	readonly status:
		| "admitted"
		| "joined"
		| "advanced"
		| "completed"
		| "refused"
		| "inspected";
	readonly state: VaultGitTransactionState;
	readonly phase: VaultGitTransactionPhase;
	readonly writePermission: VaultGitWritePermission;
	readonly changedState: "none" | "local" | "remote" | "committed" | "partial";
	readonly retrySafety: "same_input_safe" | "same_input_unsafe" | "operator_required";
	readonly nextAction: VaultGitEngineNextAction;
	readonly blocker?: VaultGitBlockerId;
	readonly transactionId?: string;
	readonly receiptId?: string;
	readonly diagnosticsReference?: string;
	/** Cause-specific public activation refusal with one safe continuation. */
	readonly activationRestriction?: VaultGitActivationRestriction;
	/** Stage-classified Validation Failure carried for later Doctor routing. */
	readonly validationFailure?: VaultGitValidationFailure;
}

/**
 * Public U3 transaction state machine.
 *
 * Every operation returns a capability-free {@link VaultGitEngineResult};
 * refusals carry a blocker id and one safe continuation instead of throwing.
 *
 * @example
 * ```typescript
 * const admitted = await engine.begin({
 *   event: "note_created",
 *   requestedPaths: ["notes/new.md"],
 *   remote: "origin",
 *   leaseDurationMs: 60_000,
 * })
 * if (admitted.status === "refused") follow(admitted.nextAction)
 * ```
 */
export interface VaultGitTransactionEngine {
	/** Admit one outer transaction after identity, alignment, and lease checks. */
	begin(input: VaultGitBeginInput): Promise<VaultGitEngineResult>;
	/** Extend owned paths inside the writing phase with the join capability. */
	join(input: VaultGitJoinInput): Promise<VaultGitEngineResult>;
	/** Request owner-only completion checks for the active transaction. */
	complete(input: VaultGitOwnerInput): Promise<VaultGitEngineResult>;
	/** Classify current transaction state without mutation. */
	inspect(input?: VaultGitInspectInput): Promise<VaultGitEngineResult>;
	/** Record one owner-only durable phase transition. */
	recordPhase(input: VaultGitRecordPhaseInput): Promise<VaultGitEngineResult>;
	/** Reconcile receipt, local, and remote evidence without canonical mutation. */
	doctor(input?: VaultGitDoctorInput): Promise<VaultGitDoctorResult>;
	/** Execute only one fresh doctor-classified deterministic repair. */
	repair(input: VaultGitRepairInput): Promise<VaultGitRepairResult>;
	/** Prove Janitor global gates without acquiring or mutating a lease. */
	inspectJanitorPreflight(remote: string): Promise<
		| { readonly status: "eligible"; readonly doctor: VaultGitDoctorResult }
		| {
				readonly status: "refused";
				readonly blocker: VaultGitBlockerId;
				readonly doctor: VaultGitDoctorResult;
				readonly activationRestriction?: VaultGitActivationRestriction;
		  }
	>;
	/** Read checker admission through engine-owned private-state custody. */
	readCheckerAdmission(): Promise<VaultGitCheckerAdmissionRecord | null>;
	/** Prune deterministic private hygiene through engine-owned store custody. */
	prunePrivateHygiene(): Promise<VaultGitPrivateHygieneResult>;
	/** Persist one bounded Janitor report under private XDG state. */
	recordJanitorReport(reportJson: string): Promise<void>;
	/** Run one checker mutation only while a fresh hygiene transaction owns the lease. */
	runHygieneTransaction(request: {
		readonly paths: readonly string[];
		readonly remote: string;
		readonly leaseDurationMs: number;
		readonly summary: string;
		/** Observer invoked once the fresh hygiene lease is held. */
		readonly onLeaseAcquired?: () => void;
		/** Observer invoked only after an ordinary refusal releases that lease. */
		readonly onLeaseReleased?: () => void;
		readonly apply: () => Promise<boolean>;
	}): Promise<VaultGitEngineResult>;
}

/**
 * Create the private-receipt transaction state machine.
 *
 * @param options - Ports and canonical identity
 * @returns Admission, join, completion, inspection, and transition operations
 *
 * @example
 * ```typescript
 * const engine = createVaultGitTransactionEngine({
 *   store,
 *   repository,
 *   ledger: { git: remote, clock: runtime },
 *   runtime,
 *   repositoryIdentity: "vault@example",
 * })
 * const status = await engine.inspect()
 * ```
 */
export function createVaultGitTransactionEngine(
	options: VaultGitTransactionEngineOptions,
): VaultGitTransactionEngine {
	const doctorEngine = createVaultGitDoctor(options);
	const repairEngine = createVaultGitRepair(options);

	/** R34 activation gate retaining the exact public refusal cause. */
	async function activationRestriction(
		scope: VaultGitActivationValidationScope,
	): Promise<VaultGitActivationRestriction | null> {
		let validation: VaultGitActivationValidationResult;
		try {
			validation = await options.activationAuthority.validate(scope);
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

	/** Shared write-command refusal until operator admission exists (R34). */
	function activationRefusal(
		restriction: VaultGitActivationRestriction,
		receipt?: VaultGitReceipt,
		changedState: VaultGitEngineResult["changedState"] = "none",
	): VaultGitEngineResult {
		const contextualRestriction =
			changedState === restriction.changedState
				? restriction
				: createVaultGitActivationRestriction({
						stoppedAction: restriction.stoppedAction,
						cause: restriction.cause.id,
						changedState,
						...(restriction.missingConfiguration
							? { missingConfiguration: restriction.missingConfiguration }
							: {}),
					});
		const nextAction = activationNextAction(contextualRestriction);
		return {
			...refusal(
				receipt ? (stateForPhase(receipt.phase) ?? receiptState(receipt)) : "absent",
				receipt?.phase ?? "blocked",
				"activation_blocked",
				nextAction.id,
				nextAction.summary,
				changedState,
				activationRetrySafety(restriction),
			),
			...(receipt
				? {
						transactionId: receipt.transactionId ?? undefined,
						receiptId: receipt.receiptId,
						diagnosticsReference: receipt.diagnosticsReference,
					}
				: {}),
			activationRestriction: contextualRestriction,
		};
	}

	/** Read-only doctor surface for the un-admitted runtime. */
	function activationDoctorResult(
		restriction: VaultGitActivationRestriction,
		diagnosed?: VaultGitDoctorResult,
	): VaultGitDoctorResult {
		const nextAction = activationNextAction(restriction);
		const activationFinding =
			restriction.cause.id === "configuration_missing"
				? "activation_configuration_missing"
				: "activation_missing";
		return {
			...(diagnosed ?? {
				status: "diagnosed" as const,
				state: "absent" as const,
				phase: "blocked" as const,
				finding: activationFinding,
				changedState: "none" as const,
				diagnosticsReference: `doctor:${options.store.repositoryId}`,
			}),
			changedState: diagnosed?.changedState ?? "none",
			finding:
				diagnosed?.finding === "no_receipt"
					? activationFinding
					: (diagnosed?.finding ?? activationFinding),
			retrySafety: activationRetrySafety(restriction),
			nextAction,
			blocker: "activation_blocked",
			activationRestriction: restriction,
		};
	}

	async function receiptForActivation(): Promise<VaultGitReceipt | undefined> {
		try {
			const loaded = await options.store.load();
			return loaded.status === "loaded" ? loaded.receipt : undefined;
		} catch {
			return undefined;
		}
	}

	async function loadReceipt(): Promise<VaultGitReceipt | VaultGitEngineResult | null> {
		let quarantine: Awaited<ReturnType<VaultGitReceiptStore["readQuarantine"]>>;
		try {
			quarantine = await options.store.readQuarantine();
		} catch {
			return refusal("human_required", "human_required", "receipt_corrupt", "inspect_private_receipt", "Inspect private quarantine evidence with doctor.");
		}
		if (quarantine?.status === "takeover_pending") {
			return refusal("superseded", "human_required", "host_quarantined", "run_doctor", "Run doctor to reconcile the interrupted stale-lease takeover.");
		}
		if (
			quarantine?.status === "quarantined" ||
			quarantine?.status === "recovery_pending"
		) {
			return refusal("superseded", "human_required", "host_quarantined", "reconcile_quarantine", "Reconcile preserved local evidence before clearing quarantine.");
		}
		const loaded = await options.store.load();
		if (loaded.status === "absent") return null;
		if (loaded.status !== "loaded") {
			return refusal("human_required", "human_required", "receipt_corrupt", "inspect_private_receipt", "Inspect private receipt integrity with doctor.");
		}
		return loaded.receipt;
	}

	async function proveIdentity(
		receipt?: VaultGitReceipt,
		expectedLocalMainHead = receipt?.localMainHead,
	): Promise<VaultGitEngineResult | { localMainHead: string }> {
		// Fail closed like captureUnrelatedState: a composed port that cannot
		// prove repository safety must never let a write-capable phase proceed.
		if (!options.repository.inspectSafety) {
			return refusal(
				"human_required",
				receipt?.phase ?? "blocked",
				"host_contract_breach",
				"request_operator_review",
				"Compose a repository port with inspectSafety; write-capable phases refuse without a repository-safety proof.",
			);
		}
		const safety = await options.repository.inspectSafety();
		if (safety.status === "refused") {
			return refusal(
				"human_required",
				receipt?.phase ?? "blocked",
				"host_contract_breach",
				"request_operator_review",
				// Free text here crosses the facade's runtime-text-safety gate, so
				// the summary must not interpolate reasons (credential_helper trips
				// the credential pattern) or name the tool ("Git <word>" reads as a
				// command example); the blocker id carries the classification.
				"Remove the unsafe repository-local configuration flagged by safety inspection before continuing.",
			);
		}
		let resolved: Awaited<
			ReturnType<VaultGitRepositoryPort["resolveCanonicalIdentity"]>
		>;
		try {
			resolved = await options.repository.resolveCanonicalIdentity();
		} catch (error) {
			if (error instanceof VaultRepositoryIdentityUnavailableError) {
				return activationRefusal(
					createVaultGitActivationRestriction({
						stoppedAction: "vault_write",
						cause: "revalidation_unavailable",
					}),
					receipt,
				);
			}
			throw error;
		}
		if (resolved.identity !== options.repositoryIdentity || (receipt && resolved.localMainHead !== expectedLocalMainHead)) {
			return refusal("human_required", receipt?.phase ?? "blocked", "vault_identity_changed", "inspect_configured_vault", "Inspect configured vault identity before continuing.");
		}
		return { localMainHead: resolved.localMainHead };
	}

	async function fence(
		receipt: VaultGitReceipt,
		remote: string,
		expectedLocalMainHead = receipt.localMainHead,
	): Promise<VaultGitEngineResult | null> {
		const identity = await proveIdentity(receipt, expectedLocalMainHead);
		if ("status" in identity) return identity;
		if (!receipt.transactionId || !receipt.leaseGeneration) {
			return refusal("unknown", receipt.phase, "receipt_corrupt", "inspect_remote_lease", "Inspect remote lease acquisition evidence.");
		}
		const main = await options.ledger.git.inspectMain(remote);
		if (main.status === "refused") {
			return refusal(
				"human_required",
				receipt.phase,
				"host_contract_breach",
				"request_operator_review",
				"Ask an operator to remove unsafe remote configuration before continuing.",
			);
		}
		if (
			main.status !== "ok" ||
			main.alignment !==
				(expectedLocalMainHead === receipt.remoteMainHead ? "aligned" : "ahead") ||
			main.localHead !== expectedLocalMainHead ||
			main.remoteHead !== receipt.remoteMainHead
		) {
			return refusal("human_required", receipt.phase, "remote_moved", "preserve_local_edits", "Preserve local edits and inspect main movement.");
		}
		const validated = await validateRemoteLease(options.ledger, {
			remote,
			expectedGeneration: receipt.leaseGeneration,
			transactionId: receipt.transactionId,
		});
		if (validated.status === "refused") {
			return refusal("superseded", receipt.phase, validated.blocker, validated.nextAction.id, validated.nextAction.summary);
		}
		return null;
	}

	async function finalWriteAuthority(
		receipt: VaultGitReceipt,
		remote: string,
		changedState: VaultGitEngineResult["changedState"] = "none",
		expectedLocalMainHead = receipt.localMainHead,
	): Promise<VaultGitEngineResult | null> {
		const fenced = await fence(receipt, remote, expectedLocalMainHead);
		if (fenced) return withReceiptContext(fenced, receipt, changedState);
		const restriction = await activationRestriction("continuation");
		return restriction
			? activationRefusal(restriction, receipt, changedState)
			: null;
	}

	const engine: VaultGitTransactionEngine = {
		async doctor(input) {
			const restriction = await activationRestriction("continuation");
			const diagnosed = await doctorEngine.diagnose(
				restriction ? { ...input, issueTakeoverToken: false } : input,
			);
			if (!restriction) return diagnosed;
			return activationDoctorResult(
				restriction,
				diagnosed,
			);
		},

		async repair(input) {
			const restriction = await activationRestriction("continuation");
			// Quarantine reconciliation restores and closes already-owned local
			// recovery evidence. It must remain available when Activation is the
			// reason the host cannot return to an ordinary transaction path.
			if (restriction && input.action !== "reconcile-quarantine") {
				const receipt = await receiptForActivation();
				return {
					status: "refused",
					action: input.action,
					state: receipt
						? (stateForPhase(receipt.phase) ?? receiptState(receipt))
						: "absent",
					phase: receipt?.phase ?? "blocked",
					changedState: "none",
					retrySafety: activationRetrySafety(restriction),
					nextAction: activationNextAction(restriction),
					diagnosticsReference:
						receipt?.diagnosticsReference ??
						`doctor:${options.store.repositoryId}`,
					blocker: "activation_blocked",
					activationRestriction: restriction,
				};
			}
			return repairEngine.run(input);
		},

		async inspectJanitorPreflight(remote) {
			const restriction = await activationRestriction("continuation");
			if (restriction) {
				const diagnosed = await doctorEngine.diagnose({
					issueTakeoverToken: false,
				});
				return {
					status: "refused",
					blocker: "activation_blocked",
					doctor: activationDoctorResult(
						restriction,
						diagnosed,
					),
					activationRestriction: restriction,
				};
			}
			const doctor = await doctorEngine.diagnose({ issueTakeoverToken: false });
			if (doctor.state !== "absent" && doctor.state !== "closed") {
				return {
					status: "refused",
					blocker:
						doctor.blocker ??
						(doctor.state === "push_pending"
							? "push_pending"
							: doctor.state === "expired"
								? "lease_stale"
								: "lease_active"),
					doctor,
				};
			}
			try {
				// Janitor write eligibility fails closed exactly like foreground
				// writes: no safety proof, no hygiene transaction.
				if (!options.repository.inspectSafety) {
					return { status: "refused", blocker: "host_contract_breach", doctor };
				}
				const safety = await options.repository.inspectSafety();
				if (safety.status === "refused") {
					return { status: "refused", blocker: "host_contract_breach", doctor };
				}
				const identity = await options.repository.resolveCanonicalIdentity();
				if (identity.identity !== options.repositoryIdentity) {
					return { status: "refused", blocker: "vault_identity_changed", doctor };
				}
				const main = await options.ledger.git.inspectMain(remote);
				if (main.status === "refused") {
					return {
						status: "refused",
						blocker: "host_contract_breach",
						doctor,
					};
				}
				if (main.status !== "ok") {
					return { status: "refused", blocker: "remote_unavailable", doctor };
				}
				if (
					main.alignment !== "aligned" ||
					main.localHead !== identity.localMainHead
				) {
					return {
						status: "refused",
						blocker: alignmentBlocker(main.alignment),
						doctor,
					};
				}
				if (!options.repository.captureUnrelatedState) {
					return { status: "refused", blocker: "host_contract_breach", doctor };
				}
				const wholeTree = await options.repository.captureUnrelatedState([]);
				if (wholeTree.statusHex.length > 0) {
					return { status: "refused", blocker: "dirty_tree", doctor };
				}
				const observed = await observeRemoteLedger(options.ledger, { remote });
				if (observed.status === "refused") {
					return { status: "refused", blocker: observed.blocker, doctor };
				}
				if (observed.lease?.state === "held") {
					const expired =
						options.runtime.now().getTime() >=
						Date.parse(observed.lease.acquiredAt) +
							observed.lease.leaseDurationMs;
					return {
						status: "refused",
						blocker: expired ? "lease_stale" : "lease_active",
						doctor,
					};
				}
				return { status: "eligible", doctor };
			} catch {
				return { status: "refused", blocker: "host_contract_breach", doctor };
			}
		},

		async readCheckerAdmission() {
			return options.store.readCheckerAdmission();
		},

		async prunePrivateHygiene() {
			return options.store.prunePrivateHygiene(
				options.runtime.now().toISOString(),
			);
		},

		async recordJanitorReport(reportJson) {
			await options.store.recordJanitorReport(
				reportJson,
				options.runtime.now().toISOString(),
			);
		},

		async runHygieneTransaction(request) {
			const admitted = await engine.begin({
				event: "hygiene",
				requestedPaths: request.paths,
				remote: request.remote,
				leaseDurationMs: request.leaseDurationMs,
			});
			if (admitted.status !== "admitted" || !admitted.transactionId) {
				return admitted;
			}
			request.onLeaseAcquired?.();
			// Every exit below this point holds the remote lease. Decision 24
			// requires the worker to report and exit, so a refusal must hand the
			// lease back: `recordPhase` only appends a local receipt, and an
			// abandoned lease blocks every host until it ages into `lease_stale`
			// and an operator runs the takeover ceremony.
			const abandonLease = async (): Promise<void> => {
				const current = await options.store.load().catch(() => null);
				if (current?.status !== "loaded") return;
				const { transactionId, leaseGeneration } = current.receipt;
				if (!transactionId || !leaseGeneration) return;
				try {
					const released = await releaseRemoteLease(options.ledger, {
						remote: request.remote,
						transactionId,
						expectedGeneration: leaseGeneration,
					});
					if (released.status === "released") request.onLeaseReleased?.();
				} catch {
					// A failed release leaves the lease to expire on its own; the
					// refusal below still reports the outcome the caller must act on.
				}
			};
			const loaded = await options.store.load();
			if (loaded.status !== "loaded") {
				await abandonLease();
				return refusal(
					"human_required",
					"human_required",
					"receipt_corrupt",
					"inspect_private_receipt",
					"Inspect the hygiene receipt before any checker repair.",
				);
			}
			let capability: Uint8Array;
			try {
				capability = await options.store.readCapability(
					loaded.receipt.receiptId,
					"owner",
				);
			} catch {
				await abandonLease();
				return refusal(
					"human_required",
					"human_required",
					"capability_invalid",
					"reload_capability",
					"Reload the hygiene owner capability through the internal launcher.",
				);
			}
			let applied = false;
			try {
				// The clean-tree proof from preflight predates lease acquisition; a
				// foreground writer may have landed in between. Re-prove the whole
				// tree is clean under the held lease before any checker mutation.
				const wholeTree = options.repository.captureUnrelatedState
					? await options.repository.captureUnrelatedState([])
					: null;
				const stillClean = wholeTree !== null && wholeTree.statusHex.length === 0;
				if (stillClean) {
					const finalAuthority = await finalWriteAuthority(
						loaded.receipt,
						request.remote,
						"remote",
					);
					if (finalAuthority) {
						await abandonLease();
						return finalAuthority;
					}
					applied = await request.apply();
				}
			} catch {
				applied = false;
			}
			if (!applied) {
				const recorded = await engine.recordPhase({
					transactionId: admitted.transactionId,
					remote: request.remote,
					capability,
					phase: "repairable",
					nextSafeAction: "run_doctor",
				});
				await abandonLease();
				return recorded;
			}
			return engine.complete({
				transactionId: admitted.transactionId,
				remote: request.remote,
				capability,
				summary: request.summary,
			});
		},

		async begin(input) {
			validateBegin(input);
			const existing = await loadReceipt();
			if (existing !== null && "status" in existing) return existing;
			const restriction = await activationRestriction("continuation");
			if (restriction) {
				return activationRefusal(
					restriction,
					existing === null ? undefined : existing,
				);
			}
			if (input.offline) {
				return refusal("absent", "blocked", "offline_mode", "capture_private_draft", "Keep the canonical vault read-only while offline.");
			}
			// Identity labels feed commit trailers later; refuse unsafe labels
			// before any intent receipt or remote lease exists.
			const actor = options.runtime.actor();
			const host = options.runtime.host();
			if (
				validateVaultCommitLabel(actor).status === "refused" ||
				validateVaultCommitLabel(host).status === "refused"
			) {
				return refusal("absent", "blocked", "identity_label_invalid", "inspect_status", "Configure non-secret single-line actor and host labels before beginning.");
			}
			if (existing !== null) {
				if (existing.phase !== "closed") {
					// A refused acquisition never granted a transaction id, so its
					// terminal receipt must not brick admission forever. Supersede it
					// with one final closing transition; history keeps the evidence.
					const refusedAcquisition = existing.transactionId === null &&
						(existing.phase === "blocked" || existing.phase === "human_required");
					if (!refusedAcquisition) {
						return refusal("active", existing.phase, "receipt_conflict", "inspect_status", "Inspect the active transaction before beginning another.");
					}
					await options.store.append(nextVaultGitReceipt(existing, {
						phase: "closed",
						transition: "superseded",
						nextSafeAction: "none",
						recordedAt: options.runtime.now().toISOString(),
					}));
				}
			}
			const identity = await proveIdentity();
			if ("status" in identity) return identity;
			// Fail closed: without the read-only capability probe, admission
			// cannot prove the remote honors the two-ref atomic close (KTD4).
			if (!options.ledger.git.probeAtomicPush) {
				return refusal(
					"absent",
					"blocked",
					"host_contract_breach",
					"request_operator_review",
					"Compose a remote port with probeAtomicPush; admission refuses without an atomic-capability proof.",
				);
			}
			const atomicCapability = await options.ledger.git.probeAtomicPush(
				input.remote,
			);
			if (atomicCapability.status === "refused") {
				return refusal(
					"absent",
					"blocked",
					"host_contract_breach",
					"request_operator_review",
					`Use a remote with admitted atomic-push behavior; probe found ${atomicCapability.reason}.`,
				);
			}
			if (atomicCapability.status === "failed") {
				return refusal(
					"absent",
					"blocked",
					"remote_unavailable",
					"inspect_status",
					"Inspect remote availability before admission.",
				);
			}
			const main = await options.ledger.git.inspectMain(input.remote);
			if (main.status === "refused") {
				return refusal(
					"absent",
					"blocked",
					"host_contract_breach",
					"request_operator_review",
					"Ask an operator to remove unsafe remote configuration before admission.",
				);
			}
			if (main.status === "failed" || main.alignment !== "aligned" || main.localHead === null || main.localHead !== identity.localMainHead) {
				return refusal("absent", "blocked", main.status === "failed" ? "remote_unavailable" : alignmentBlocker(main.alignment), "inspect_status", "Inspect main alignment before admission.");
			}
			const admission = await options.repository.inspectOwnedPaths(input.requestedPaths);
			if (admission.status === "refused") {
				return refusal("absent", "blocked", "owned_path_not_admitted", "change_owned_paths", `Change the owned path set; admission found ${admission.reason}.`);
			}
			const observed = await observeRemoteLedger(options.ledger, { remote: input.remote });
			if (observed.status === "refused") {
				return refusal("absent", "blocked", observed.blocker, observed.nextAction.id, observed.nextAction.summary);
			}
			const receiptId = options.runtime.newReceiptId();
			const receipt: VaultGitReceipt = {
				schemaVersion: 2,
				receiptId,
				transactionId: null,
				revision: 1,
				phase: "intent_durable",
				transition: "acquisition_intent",
				recordedAt: options.runtime.now().toISOString(),
				event: input.event,
				actor,
				host,
				remote: input.remote,
				ownedPaths: copyPaths(admission.paths),
				unrelatedState: admission.unrelatedState,
				localMainHead: main.localHead,
				remoteMainHead: main.remoteHead,
				expectedLeaseGeneration: observed.generation,
				leaseGeneration: null,
				leaseAcquiredAt: null,
				leaseDurationMs: input.leaseDurationMs,
				commitId: null,
				expectedMainCommit: null,
				ledgerReleaseId: null,
				pushOutcome: "not_attempted",
				nextSafeAction: "retry_remote",
				diagnosticsReference: `receipt:${receiptId}`,
			};
			await options.store.initialize(receipt);
			options.runtime.interrupt("before_remote_cas");
			const acquired = await acquireRemoteLease(options.ledger, {
				remote: input.remote,
				expectedGeneration: observed.generation,
				actor: receipt.actor,
				host: receipt.host,
				event: receipt.event,
				ownedPaths: receipt.ownedPaths.map((path) => path.path),
				leaseDurationMs: receipt.leaseDurationMs,
			});
			if (acquired.status === "refused") {
				const phase = acquired.retrySafety === "operator_required" ? "human_required" : "blocked";
				await options.store.append(nextVaultGitReceipt(receipt, {
					phase,
					transition: phase === "human_required" ? "human_intervention_required" : "deterministic_repair_available",
					nextSafeAction: acquired.nextAction.id,
					recordedAt: options.runtime.now().toISOString(),
				}));
				// The private receipt already changed durably, so a refusal after
				// initialize/append must not claim "none".
				return refusal(phase === "human_required" ? "human_required" : "unknown", phase, acquired.blocker, acquired.nextAction.id, acquired.nextAction.summary, acquired.changedState === "none" ? "local" : acquired.changedState, acquired.retrySafety);
			}
			options.runtime.interrupt("after_remote_cas");
			const leased = nextVaultGitReceipt(receipt, {
				transactionId: acquired.transactionId,
				phase: "leased",
				transition: "lease_won",
				leaseGeneration: acquired.generation,
				leaseAcquiredAt: acquired.lease.acquiredAt,
				nextSafeAction: "resume_writing",
				recordedAt: options.runtime.now().toISOString(),
			});
			await options.store.append(leased);
			options.runtime.interrupt("before_won_generation_acknowledgement");
			const writing = nextVaultGitReceipt(leased, {
				phase: "writing",
				transition: "write_authority_granted",
				nextSafeAction: "complete_transaction",
				recordedAt: options.runtime.now().toISOString(),
			});
			const finalAuthority = await finalWriteAuthority(
				leased,
				input.remote,
				"remote",
			);
			if (finalAuthority) {
				const released = await releaseRemoteLease(options.ledger, {
					remote: input.remote,
					expectedGeneration: acquired.generation,
					transactionId: acquired.transactionId,
				});
				if (released.status === "refused") {
					const stranded = nextVaultGitReceipt(leased, {
						phase: "human_required",
						transition: "human_intervention_required",
						nextSafeAction: "request_operator_review",
						recordedAt: options.runtime.now().toISOString(),
					});
					await options.store.append(stranded);
					return withReceiptContext(
						refusal(
							"human_required",
							"human_required",
							released.blocker,
							"request_operator_review",
							"Ask an operator to release the exact acquired lease before any fresh activation attempt.",
							released.changedState === "partial" ? "partial" : "remote",
							"operator_required",
						),
						stranded,
					);
				}
				const closed = nextVaultGitReceipt(leased, {
					phase: "closed",
					transition: "closed",
					nextSafeAction: "none",
					recordedAt: options.runtime.now().toISOString(),
				});
				await options.store.append(closed);
				return {
					...withReceiptContext(finalAuthority, closed, "remote"),
					state: "closed",
					phase: "closed",
				};
			}
			await options.store.append(writing);
			return result("admitted", "active", writing, "owner", "remote", "complete_transaction", "Complete the meaningful event explicitly.");
		},

		async join(input) {
			const loaded = await loadReceipt();
			if (loaded && "status" in loaded) return loaded;
			const restriction = await activationRestriction("continuation");
			if (restriction) {
				return activationRefusal(restriction, loaded ?? undefined);
			}
			if (!loaded) return refusal("absent", "blocked", "receipt_conflict", "begin_transaction", "Begin one outer transaction first.");
			const authorization = await authorize(options.store, loaded, input.transactionId, "join", input.capability);
			if (authorization) return authorization;
			if (input.remote !== loaded.remote) {
				return refusal("active", loaded.phase, "transaction_mismatch", "inspect_status", "Use the remote admitted by the outer transaction.");
			}
			if (loaded.phase !== "writing") {
				return refusal(stateForPhase(loaded.phase) ?? "active", loaded.phase, "receipt_conflict", "inspect_status", "Join requires a transaction in the writing phase; inspect current status.");
			}
			const fenced = await fence(loaded, input.remote);
			if (fenced) return fenced;
			// Already-owned paths were admitted at their join time and may be
			// dirty now by design; only genuinely new paths face admission.
			const existing = new Set(loaded.ownedPaths.map((path) => path.path));
			const fresh = input.requestedPaths.filter((path) => !existing.has(path));
			if (fresh.length === 0) {
				const finalAuthority = await finalWriteAuthority(loaded, input.remote);
				return finalAuthority ?? result("joined", "active", loaded, "join", "none", "continue_outer_transaction", "Continue the outer transaction.");
			}
			const admission = await options.repository.inspectOwnedPaths(fresh);
			if (admission.status === "refused") return refusal("active", loaded.phase, "owned_path_not_admitted", "change_owned_paths", `Change the joined path set; admission found ${admission.reason}.`);
			const additions = admission.paths.filter((path) => !existing.has(path.path));
			if (additions.length === 0) {
				const finalAuthority = await finalWriteAuthority(loaded, input.remote);
				return finalAuthority ?? result("joined", "active", loaded, "join", "none", "continue_outer_transaction", "Continue the outer transaction.");
			}
			const joinedPaths = [...loaded.ownedPaths, ...copyPaths(additions)];
			const unrelatedState = options.repository.captureUnrelatedState
				? await options.repository.captureUnrelatedState(
						joinedPaths.map((path) => path.path),
					)
				: loaded.unrelatedState;
			const joined = nextVaultGitReceipt(loaded, {
				transition: "paths_joined",
				ownedPaths: joinedPaths,
				unrelatedState,
				nextSafeAction: "continue_outer_transaction",
				recordedAt: options.runtime.now().toISOString(),
			});
			const finalAuthority = await finalWriteAuthority(loaded, input.remote);
			if (finalAuthority) return finalAuthority;
			await options.store.append(joined);
			return result("joined", "active", joined, "join", "local", "continue_outer_transaction", "Continue the outer transaction.");
		},

		async complete(input) {
			const loaded = await loadReceipt();
			if (loaded && "status" in loaded) return loaded;
			const restriction = await activationRestriction("continuation");
			if (restriction) {
				return activationRefusal(restriction, loaded ?? undefined);
			}
			if (!loaded) return refusal("absent", "blocked", "receipt_conflict", "begin_transaction", "Begin one transaction first.");
			const authorization = await authorize(options.store, loaded, input.transactionId, "owner", input.capability);
			if (authorization) return authorization;
			if (input.remote !== loaded.remote) {
				return refusal("active", loaded.phase, "transaction_mismatch", "inspect_status", "Use the remote admitted by this transaction.");
			}
			// A durable checking phase means a prior completion died mid-check
			// with an unknown check outcome; resumption is owned by doctor and
			// repair, never by a direct completion replay. Committing may retry:
			// its candidate evidence is frozen and the fences below re-prove
			// safety, and an already-advanced local main refuses through the
			// identity fence.
			if (loaded.phase === "checking") {
				return refusal("active", loaded.phase, "completion_interrupted", "run_doctor", "Run doctor to resume the interrupted completion check.");
			}
			if (loaded.phase !== "writing" && loaded.phase !== "committing") {
				return refusal(stateForPhase(loaded.phase) ?? "active", loaded.phase, "receipt_conflict", "inspect_status", "Completion requires the writing phase; inspect current status.");
			}
			const exactClose = Boolean(options.repository.commitExact && options.check && options.ledger.git.atomicClose);
			if (exactClose) {
				// Stored labels feed commit trailers; re-validate with a structured
				// refusal so message construction can never throw mid-flow.
				if (
					validateVaultCommitLabel(loaded.actor).status === "refused" ||
					validateVaultCommitLabel(loaded.host).status === "refused"
				) {
					return refusal("human_required", loaded.phase, "identity_label_invalid", "request_operator_review", "Ask an operator to repair the stored actor or host label before completion.", "none", "operator_required");
				}
				const subject = input.summary ?? "";
				const validatedSubject = validateVaultCommitSubject(subject, loaded.event);
				if (validatedSubject.status === "refused") {
					return refusal("active", loaded.phase, "commit_subject_invalid", "change_commit_summary", "Change the semantic commit subject before completion.");
				}
				if (!loaded.transactionId || !loaded.leaseGeneration || !loaded.leaseAcquiredAt) {
					return refusal("human_required", "human_required", "receipt_corrupt", "inspect_private_receipt", "Inspect missing atomic-close receipt evidence.", "none", "operator_required");
				}
			}
			const completionAuthority = await finalWriteAuthority(
				loaded,
				input.remote,
			);
			if (completionAuthority) return completionAuthority;
			const checking = nextVaultGitReceipt(loaded, {
				phase: "checking",
				transition: "completion_requested",
				nextSafeAction: "run_owned_path_checks",
				recordedAt: options.runtime.now().toISOString(),
			});
			await options.store.append(checking);
			if (!options.repository.commitExact || !options.check || !options.ledger.git.atomicClose || !loaded.transactionId || !loaded.leaseGeneration || !loaded.leaseAcquiredAt) {
				return result("advanced", "active", checking, "owner", "local", "run_owned_path_checks", "Run exact owned-path completion checks.");
			}
			const transactionId = loaded.transactionId;
			const leaseGeneration = loaded.leaseGeneration;
			// The validation candidate freezes owned bytes and Git file modes at
			// candidate setup; those exact bindings gate the later commit so a
			// writer or chmod racing the check window is refused.
			const checked = await options.check.run({
				baselineHead: checking.localMainHead,
				ownedPaths: checking.ownedPaths,
				transactionId,
			});
			if (checked.status === "failed") {
				const validationFailure = validationFailureOf(checked);
				if (checked.failureClass !== "vault_content") {
					// Setup, budget, and cleanup failures prove nothing about vault
					// content; they must not offer deterministic repair. The durable
					// phase stays checking so doctor classifies the interrupted check
					// and `repair resume` re-enters the attempt.
					return {
						...refusal(
							"active",
							checking.phase,
							"completion_interrupted",
							"run_doctor",
							validationRefusalSummary(checked.failureClass),
							"local",
							"same_input_safe",
						),
						validationFailure,
					};
				}
				const repairable = nextVaultGitReceipt(checking, {
					phase: "repairable",
					transition: "deterministic_repair_available",
					nextSafeAction: "run_repair",
					recordedAt: options.runtime.now().toISOString(),
				});
				await options.store.append(repairable);
				return {
					...refusal("repairable", repairable.phase, "vault_check_failed", "run_repair", "Repair the vault-owned check failure before replaying completion.", "local", "same_input_unsafe"),
					validationFailure,
				};
			}
			const expectedContentHashes = checked.checkedPaths;
			const committing = nextVaultGitReceipt(checking, {
				phase: "committing",
				transition: "commit_candidate_frozen",
				nextSafeAction: "preserve_local_edits",
				recordedAt: options.runtime.now().toISOString(),
			});
			await options.store.append(committing);
			const message = buildVaultCommitMessage({
				subject: input.summary ?? "",
				event: committing.event,
				transactionId,
				actor: committing.actor,
			});
			const commitRequest = {
				baselineHead: committing.localMainHead,
				ownedPaths: committing.ownedPaths,
				unrelatedState: committing.unrelatedState,
				expectedContentHashes,
				message,
				author: committing.actor,
				timestamp: options.runtime.now().toISOString(),
			};
			const commitAuthority = await finalWriteAuthority(
				committing,
				input.remote,
				"local",
			);
			if (commitAuthority) return commitAuthority;
			const localCommit = await options.repository.commitExact(commitRequest);
			if (localCommit.status === "refused") {
				if (localCommit.reason === "timed_out") {
					// Transient local plumbing timeout: no commit landed, so refuse
					// retry-safe without escalating to a durable human_required phase.
					return refusal("active", committing.phase, "completion_interrupted", "complete_transaction", "Retry completion; the local commit operation timed out before finishing.", "local", "same_input_safe");
				}
				const blocker: VaultGitBlockerId = localCommit.reason === "unrelated_state_changed"
					? "unrelated_state_changed"
					: localCommit.reason === "checked_content_changed"
						? "completion_baseline_changed"
						: localCommit.reason === "empty_event"
							? "empty_event"
							: localCommit.reason === "owned_path_baseline_changed" ||
									localCommit.reason === "owned_path_symlink"
								? "owned_path_changed"
								: "host_contract_breach";
				const phase = blocker === "host_contract_breach" ? "human_required" : "repairable";
				const failed = nextVaultGitReceipt(committing, {
					phase,
					transition: phase === "human_required" ? "human_intervention_required" : "deterministic_repair_available",
					nextSafeAction: phase === "human_required" ? "request_operator_review" : "run_repair",
					recordedAt: options.runtime.now().toISOString(),
				});
				await options.store.append(failed);
				return refusal(phase, phase, blocker, failed.nextSafeAction, phase === "human_required" ? "Ask an operator to inspect local commit evidence." : "Repair the changed transaction state, then replay in a new transaction.", "local", phase === "human_required" ? "operator_required" : "same_input_unsafe");
			}
			if (localCommit.status === "committed_incomplete") {
				const stranded = nextVaultGitReceipt(committing, {
					phase: "human_required",
					transition: "human_intervention_required",
					commitId: localCommit.commitId,
					expectedMainCommit: localCommit.commitId,
					pushOutcome: "unknown",
					nextSafeAction: "request_operator_review",
					recordedAt: options.runtime.now().toISOString(),
				});
				await options.store.append(stranded).catch(() => undefined);
				return refusal("human_required", "human_required", "host_contract_breach", "request_operator_review", "Ask an operator to reconcile the advanced local main and stale owned index; commit evidence is preserved.", "committed", "operator_required");
			}
			const closedAt = options.runtime.now().toISOString();
			// One shared serialization with the repair retry path: publishPrepared
			// refuses when regenerated release bytes differ from the recorded
			// object, so this content must never drift from repair's.
			const releaseContent = buildVaultGitReleaseLedgerContent(committing, closedAt);
			// Persist commit evidence durably before any push can begin; a crash
			// between the local-main advance and the push must never lose it.
			let publicationReceipt = nextVaultGitReceipt(committing, {
				phase: "push_pending",
				transition: "push_outcome_unknown",
				commitId: localCommit.commitId,
				expectedMainCommit: localCommit.commitId,
				pushOutcome: "unknown",
				nextSafeAction: "run_doctor",
				recordedAt: closedAt,
			});
			try {
				await options.store.append(publicationReceipt);
			} catch {
				// Abort before pushing: without durable evidence, publication is
				// not allowed to start.
				return refusal("human_required", committing.phase, "receipt_corrupt", "inspect_private_receipt", "Inspect private receipt durability; commit evidence could not persist, so publication was not attempted.", "committed", "operator_required");
			}
			options.runtime.interrupt("after_local_commit");
			const closeRequest = {
				remote: committing.remote,
				expectedMainHead: committing.remoteMainHead,
				mainCommit: localCommit.commitId,
				ledgerRef: VAULT_GIT_LEDGER_REF,
				expectedLedgerGeneration: leaseGeneration,
				ledgerContent: releaseContent,
				ledgerMessage: `vault-ledger: release ${transactionId}`,
				author: committing.actor,
				timestamp: closedAt,
				async onPrepared(evidence: {
					readonly ledgerCommit: string;
				}) {
					publicationReceipt = nextVaultGitReceipt(publicationReceipt, {
						transition: "push_outcome_unknown",
						ledgerReleaseId: evidence.ledgerCommit,
						recordedAt: options.runtime.now().toISOString(),
					});
					await options.store.append(publicationReceipt);
				},
			};
			const closeAuthority = await finalWriteAuthority(
				publicationReceipt,
				input.remote,
				"committed",
				localCommit.commitId,
			);
			if (closeAuthority) return closeAuthority;
			let publication: VaultGitAtomicCloseResult;
			try {
				publication = await options.ledger.git.atomicClose(closeRequest);
			} catch {
				// An adapter throw after the local commit must surface as a
				// structured refusal that preserves the durable commit evidence.
				const stranded = nextVaultGitReceipt(publicationReceipt, {
					phase: "human_required",
					transition: "human_intervention_required",
					nextSafeAction: "request_operator_review",
					recordedAt: options.runtime.now().toISOString(),
				});
				await options.store.append(stranded).catch(() => undefined);
				return refusal("human_required", "human_required", "host_contract_breach", "request_operator_review", "Ask an operator to inspect the interrupted atomic close; local commit evidence is preserved.", "committed", "operator_required");
			}
			if (publication.status === "closed") {
				options.runtime.interrupt("after_release_publication");
				const closed = nextVaultGitReceipt(publicationReceipt, {
					phase: "closed",
					transition: "closed",
					pushOutcome: "closed",
					nextSafeAction: "none",
					recordedAt: options.runtime.now().toISOString(),
				});
				await options.store.append(closed);
				return result("completed", "closed", closed, "owner", "remote", "none", "The exact event commit and lease release are remote and closed.");
			}
			if (publication.status === "host_contract_breach") {
				const breach = nextVaultGitReceipt(publicationReceipt, {
					phase: "human_required",
					transition: "human_intervention_required",
					pushOutcome: "host_contract_breach",
					nextSafeAction: "request_operator_review",
					recordedAt: options.runtime.now().toISOString(),
				});
				await options.store.append(breach);
				return refusal("human_required", breach.phase, "host_contract_breach", "request_operator_review", "Ask an operator to reconcile partial or unexpected remote objects.", "partial", "operator_required");
			}
			return result("advanced", "push_pending", publicationReceipt, "owner", "partial", "run_doctor", "Run doctor to reconcile exact remote refs before any repair.", "push_pending");
		},

		async inspect(input = {}) {
			const loaded = await loadReceipt();
			const restriction = await activationRestriction("continuation");
			const finish = (
				current: VaultGitEngineResult,
				receipt?: VaultGitReceipt,
			): VaultGitEngineResult => {
				if (!restriction) return current;
				const nextAction = activationNextAction(restriction);
				const contextual = receipt
					? withReceiptContext(current, receipt)
					: current;
				return {
					...contextual,
					status: "inspected",
					writePermission: "denied",
					retrySafety: activationRetrySafety(restriction),
					blocker: "activation_blocked",
					nextAction,
					activationRestriction: restriction,
				};
			};
			if (loaded === null) {
				return finish(
					inspected(
						"absent",
						"blocked",
						"begin_transaction",
						"Begin one transaction before canonical writes.",
					),
				);
			}
			if ("status" in loaded) return finish(loaded);
			if (
				input.transactionId !== undefined &&
				loaded.transactionId !== null &&
				input.transactionId !== loaded.transactionId
			) {
				return finish(
					refusal(
						"human_required",
						loaded.phase,
						"transaction_mismatch",
						"inspect_status",
						"Inspect the active transaction id.",
					),
					loaded,
				);
			}
			// Terminal phases are durable local facts; a remote failure must
			// never downgrade them to "unknown".
			const phaseState = stateForPhase(loaded.phase);
			if (phaseState && phaseState !== "unknown") {
				return finish(
					result("inspected", phaseState, loaded, "denied", "none", nextForState(phaseState), summaryForState(phaseState)),
					loaded,
				);
			}
			const observed = await observeRemoteLedger(options.ledger, { remote: loaded.remote });
			if (observed.status === "refused") return finish(result("inspected", "unknown", loaded, "denied", "none", "retry_remote", "Retry remote inspection after checking connectivity.", observed.blocker), loaded);
			if (!loaded.transactionId || !loaded.leaseGeneration) {
				return finish(result("inspected", "unknown", loaded, "denied", "none", "inspect_remote_lease", "Inspect remote lease acquisition evidence."), loaded);
			}
			if (observed.generation !== loaded.leaseGeneration || observed.lease?.transactionId !== loaded.transactionId) {
				return finish(result("inspected", "superseded", loaded, "denied", "none", "preserve_local_edits", "Preserve local edits and inspect the newer lease.", "lease_generation_stale"), loaded);
			}
			const acquiredAt = loaded.leaseAcquiredAt ? Date.parse(loaded.leaseAcquiredAt) : Number.NaN;
			const expired = !Number.isFinite(acquiredAt) || options.runtime.now().getTime() > acquiredAt + loaded.leaseDurationMs;
			return finish(result("inspected", expired ? "expired" : "active", loaded, "denied", "none", expired ? "request_operator_takeover" : "continue_transaction", expired ? "Ask an operator to inspect the stale lease." : "Continue the active transaction."), loaded);
		},

		async recordPhase(input) {
			const loaded = await loadReceipt();
			if (loaded && "status" in loaded) return loaded;
			const restriction = await activationRestriction("continuation");
			if (restriction) {
				return activationRefusal(restriction, loaded ?? undefined);
			}
			if (!loaded) {
				return refusal("human_required", "human_required", "transaction_mismatch", "inspect_status", "Inspect the active transaction before recording a phase.");
			}
			const authorization = await authorize(options.store, loaded, input.transactionId, "owner", input.capability);
			if (authorization) return authorization;
			if (input.remote !== loaded.remote) {
				return refusal("active", loaded.phase, "transaction_mismatch", "inspect_status", "Use the remote admitted by this transaction.");
			}
			// Closure is evidence-gated: the plan admits only
			// `Committing -> Closed: atomic main + ledger release verified` and
			// `Repairable -> Closed: deterministic restore + release`. This
			// transition owns no commit evidence (see below), so it cannot supply
			// that proof. Recording `closed` here would leave the remote lease
			// held while the local receipt reads terminal, which blocks every
			// later writer and stops doctor and repair from reconciling.
			// Refuse before fencing so an unreachable remote cannot mask an
			// unsupported transition behind a lease or transport blocker.
			if (input.phase === "closed") {
				return refusal(stateForPhase(loaded.phase) ?? "active", loaded.phase, "receipt_conflict", "inspect_status", "Closure requires verified atomic close; complete or repair the transaction instead of recording closed.");
			}
			const finalAuthority = await finalWriteAuthority(loaded, input.remote);
			if (finalAuthority) return finalAuthority;
			const transition = input.phase === "push_pending" ? "push_outcome_unknown" : input.phase === "repairable" ? "deterministic_repair_available" : input.phase === "human_required" ? "human_intervention_required" : "closed";
			// Commit evidence fields are owned by completion and repair flows (U5);
			// a phase transition must never introduce or mutate them.
			const recorded = nextVaultGitReceipt(loaded, {
				phase: input.phase,
				transition,
				nextSafeAction: input.nextSafeAction,
				recordedAt: options.runtime.now().toISOString(),
			});
			await options.store.append(recorded);
			return result("advanced", stateForPhase(recorded.phase) ?? "active", recorded, "owner", "local", recorded.nextSafeAction, summaryForState(stateForPhase(recorded.phase) ?? "active"));
		},
	};
	return engine;
}

function activationRetrySafety(
	restriction: VaultGitActivationRestriction,
): VaultGitRetrySafety {
	switch (restriction.cause.id) {
		case "configuration_missing":
		case "admission_missing":
		case "revalidation_unavailable":
			return "same_input_safe";
		case "human_capability_required":
		case "revoked":
			return "operator_required";
		case "evidence_changed":
		case "binding_changed":
		case "invalidated":
			return "same_input_unsafe";
	}
}

function activationNextAction(
	restriction: VaultGitActivationRestriction,
): VaultGitEngineNextAction {
	return restriction.nextAction;
}

function receiptState(receipt: VaultGitReceipt): VaultGitTransactionState {
	return receipt.transactionId ? "active" : "unknown";
}

function withReceiptContext(
	current: VaultGitEngineResult,
	receipt: VaultGitReceipt,
	changedState: VaultGitEngineResult["changedState"] = current.changedState,
): VaultGitEngineResult {
	return {
		...current,
		changedState,
		transactionId: receipt.transactionId ?? undefined,
		receiptId: receipt.receiptId,
		diagnosticsReference: receipt.diagnosticsReference,
	};
}

async function authorize(store: VaultGitReceiptStore, receipt: VaultGitReceipt, transactionId: string, role: VaultGitCapabilityRole, capability: Uint8Array): Promise<VaultGitEngineResult | null> {
	if (receipt.transactionId !== transactionId) return refusal("human_required", receipt.phase, "transaction_mismatch", "inspect_status", "Inspect the active transaction id.");
	try {
		if (await store.validateCapability(receipt.receiptId, role, capability)) return null;
		const wrongRole: VaultGitCapabilityRole = role === "owner" ? "join" : "owner";
		if (await store.validateCapability(receipt.receiptId, wrongRole, capability)) return refusal("active", receipt.phase, "capability_role_mismatch", role === "owner" ? "use_owner_capability" : "use_join_capability", `Use the ${role} capability for this action.`);
		return refusal("active", receipt.phase, "capability_invalid", "reload_capability", "Reload the transaction capability through the internal launcher.");
	} catch {
		return refusal("human_required", receipt.phase, "capability_invalid", "inspect_private_receipt", "Inspect private capability state with doctor.");
	}
}

function copyPaths(paths: readonly VaultGitOwnedPathReceipt[]): VaultGitOwnedPathReceipt[] { return paths.map((path) => ({ ...path })); }

function result(status: VaultGitEngineResult["status"], state: VaultGitTransactionState, receipt: VaultGitReceipt, writePermission: VaultGitWritePermission, changedState: VaultGitEngineResult["changedState"], actionId: VaultGitEngineNextActionId, summary: string, blocker?: VaultGitBlockerId): VaultGitEngineResult {
	// Decision 19: a push_pending commit is never automatically retried or
	// reclaimed, so it must not advertise the same input as safe to resend.
	const retrySafety: VaultGitRetrySafety = state === "human_required" || state === "superseded" || state === "expired" ? "operator_required" : state === "push_pending" ? "same_input_unsafe" : "same_input_safe";
	return { status, state, phase: receipt.phase, writePermission, changedState, retrySafety, nextAction: { id: actionId, summary }, transactionId: receipt.transactionId ?? undefined, receiptId: receipt.receiptId, diagnosticsReference: receipt.diagnosticsReference, ...(blocker ? { blocker } : {}) };
}

function refusal(state: VaultGitTransactionState, phase: VaultGitTransactionPhase, blocker: VaultGitBlockerId, actionId: VaultGitEngineNextActionId, summary: string, changedState: VaultGitEngineResult["changedState"] = "none", retrySafety?: VaultGitRetrySafety): VaultGitEngineResult {
	return { status: "refused", state, phase, writePermission: "denied", changedState, retrySafety: retrySafety ?? (state === "human_required" || state === "superseded" || state === "expired" ? "operator_required" : "same_input_unsafe"), blocker, nextAction: { id: actionId, summary } };
}

function inspected(state: VaultGitTransactionState, phase: VaultGitTransactionPhase, actionId: VaultGitEngineNextActionId, summary: string): VaultGitEngineResult {
	return { status: "inspected", state, phase, writePermission: "denied", changedState: "none", retrySafety: "same_input_safe", nextAction: { id: actionId, summary } };
}

function stateForPhase(phase: VaultGitReceipt["phase"]): VaultGitTransactionState | null {
	if (phase === "push_pending" || phase === "repairable" || phase === "human_required" || phase === "closed") return phase;
	if (phase === "blocked") return "unknown";
	return null;
}

function nextForState(state: VaultGitTransactionState): VaultGitEngineNextActionId { return state === "push_pending" ? "run_doctor" : state === "repairable" ? "run_repair" : state === "human_required" ? "request_operator_review" : "none"; }
function summaryForState(state: VaultGitTransactionState): string { return state === "push_pending" ? "Run doctor before selecting a publication repair." : state === "repairable" ? "Run the recorded deterministic repair." : state === "human_required" ? "Ask an operator to inspect conflicting evidence." : "No transaction action remains."; }

/** Rebuild the exact closed pairing so no carrier property leaks into it. */
function validationFailureOf(
	checked: Extract<VaultGitCheckResult, { status: "failed" }>,
): VaultGitValidationFailure {
	switch (checked.failureClass) {
		case "candidate_setup":
			return { failureClass: "candidate_setup", stage: "candidate_setup" };
		case "vault_content":
			return { failureClass: "vault_content", stage: "vault_check" };
		case "candidate_cleanup":
			return { failureClass: "candidate_cleanup", stage: "candidate_cleanup" };
		case "stage_budget_exceeded":
			return { failureClass: "stage_budget_exceeded", stage: checked.stage };
	}
}

function validationRefusalSummary(
	failureClass: Exclude<VaultGitValidationFailureClass, "vault_content">,
): string {
	switch (failureClass) {
		case "candidate_setup":
			return "Run doctor; the validation candidate could not be prepared.";
		case "stage_budget_exceeded":
			return "Run doctor; a validation stage exceeded its duration budget.";
		case "candidate_cleanup":
			return "Run doctor; validation candidate cleanup did not finish.";
	}
}

function validateBegin(input: VaultGitBeginInput): void {
	if (input.requestedPaths.length === 0) throw new Error("begin requires owned paths");
	if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs <= 0) throw new Error("lease duration must be positive");
}

function alignmentBlocker(alignment: "aligned" | "behind" | "ahead" | "diverged" | "local_missing"): VaultGitBlockerId {
	return alignment === "behind" ? "main_behind" : alignment === "ahead" ? "main_ahead" : alignment === "diverged" ? "main_diverged" : "vault_unconfigured";
}
