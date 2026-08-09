import type {
	VaultGitBlockerId,
	VaultGitEngineNextActionId,
	VaultGitEventType,
	VaultGitOwnedPathReceipt,
	VaultGitReceipt,
	VaultGitReceiptNextAction,
	VaultGitRetrySafety,
	VaultGitTransactionPhase,
	VaultGitTransactionState,
	VaultGitWritePermission,
} from "./model.ts";
import type {
	VaultGitRepositoryPort,
	VaultGitRuntimePort,
} from "./ports.ts";
import {
	acquireRemoteLease,
	observeRemoteLedger,
	validateRemoteLease,
	type RemoteLedgerEngine,
} from "./remote-ledger.ts";
import type {
	VaultGitCapabilityRole,
	VaultGitReceiptStore,
} from "./store.ts";

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
}

/** Internal durable phase transition used by later commit and repair units. */
export interface VaultGitRecordPhaseInput {
	readonly transactionId: string;
	readonly remote: string;
	/** Owner capability bytes; join or invalid bytes refuse the transition. */
	readonly capability: Uint8Array;
	readonly phase: "push_pending" | "repairable" | "human_required" | "closed";
	readonly nextSafeAction: VaultGitReceiptNextAction;
	readonly commitId?: string | null;
}

/** One safe engine continuation. */
export interface VaultGitEngineNextAction {
	readonly id: VaultGitEngineNextActionId;
	readonly summary: string;
}

/** Capability-free transaction-engine result. */
export interface VaultGitEngineResult {
	readonly status: "admitted" | "joined" | "advanced" | "refused" | "inspected";
	readonly state: VaultGitTransactionState;
	readonly phase: VaultGitTransactionPhase;
	readonly writePermission: VaultGitWritePermission;
	readonly changedState: "none" | "local" | "remote" | "partial";
	readonly retrySafety: "same_input_safe" | "same_input_unsafe" | "operator_required";
	readonly nextAction: VaultGitEngineNextAction;
	readonly blocker?: VaultGitBlockerId;
	readonly transactionId?: string;
	readonly receiptId?: string;
	readonly diagnosticsReference?: string;
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
	inspect(): Promise<VaultGitEngineResult>;
	/** Record one owner-only durable phase transition. */
	recordPhase(input: VaultGitRecordPhaseInput): Promise<VaultGitEngineResult>;
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
	async function loadReceipt(): Promise<VaultGitReceipt | VaultGitEngineResult | null> {
		const loaded = await options.store.load();
		if (loaded.status === "absent") return null;
		if (loaded.status !== "loaded") {
			return refusal("human_required", "human_required", "receipt_corrupt", "inspect_private_receipt", "Inspect private receipt integrity with doctor.");
		}
		return loaded.receipt;
	}

	async function proveIdentity(receipt?: VaultGitReceipt): Promise<VaultGitEngineResult | { localMainHead: string }> {
		const resolved = await options.repository.resolveCanonicalIdentity();
		if (resolved.identity !== options.repositoryIdentity || (receipt && resolved.localMainHead !== receipt.localMainHead)) {
			return refusal("human_required", receipt?.phase ?? "blocked", "vault_identity_changed", "inspect_configured_vault", "Inspect configured vault identity before continuing.");
		}
		return { localMainHead: resolved.localMainHead };
	}

	async function fence(receipt: VaultGitReceipt, remote: string): Promise<VaultGitEngineResult | null> {
		const identity = await proveIdentity(receipt);
		if ("status" in identity) return identity;
		if (!receipt.transactionId || !receipt.leaseGeneration) {
			return refusal("unknown", receipt.phase, "receipt_corrupt", "inspect_remote_lease", "Inspect remote lease acquisition evidence.");
		}
		const main = await options.ledger.git.inspectMain(remote);
		if (
			main.status !== "ok" ||
			main.alignment !== "aligned" ||
			main.localHead !== receipt.localMainHead ||
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

	return {
		async begin(input) {
			validateBegin(input);
			if (input.offline) {
				return refusal("absent", "blocked", "offline_mode", "capture_private_draft", "Keep the canonical vault read-only while offline.");
			}
			const existing = await loadReceipt();
			if (existing !== null) {
				if ("status" in existing) return existing;
				if (existing.phase !== "closed") {
					// A refused acquisition never granted a transaction id, so its
					// terminal receipt must not brick admission forever. Supersede it
					// with one final closing transition; history keeps the evidence.
					const refusedAcquisition = existing.transactionId === null &&
						(existing.phase === "blocked" || existing.phase === "human_required");
					if (!refusedAcquisition) {
						return refusal("active", existing.phase, "receipt_conflict", "inspect_status", "Inspect the active transaction before beginning another.");
					}
					await options.store.append(nextReceipt(existing, {
						phase: "closed",
						transition: "superseded",
						nextSafeAction: "none",
						recordedAt: options.runtime.now().toISOString(),
					}));
				}
			}
			const identity = await proveIdentity();
			if ("status" in identity) return identity;
			const main = await options.ledger.git.inspectMain(input.remote);
			if (main.status !== "ok" || main.alignment !== "aligned" || main.localHead === null || main.localHead !== identity.localMainHead) {
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
				schemaVersion: 1,
				receiptId,
				transactionId: null,
				revision: 1,
				phase: "intent_durable",
				transition: "acquisition_intent",
				recordedAt: options.runtime.now().toISOString(),
				event: input.event,
				actor: options.runtime.actor(),
				host: options.runtime.host(),
				remote: input.remote,
				ownedPaths: copyPaths(admission.paths),
				localMainHead: main.localHead,
				remoteMainHead: main.remoteHead,
				expectedLeaseGeneration: observed.generation,
				leaseGeneration: null,
				leaseAcquiredAt: null,
				leaseDurationMs: input.leaseDurationMs,
				commitId: null,
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
				await options.store.append(nextReceipt(receipt, {
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
			const leased = nextReceipt(receipt, {
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
			const writing = nextReceipt(leased, {
				phase: "writing",
				transition: "write_authority_granted",
				nextSafeAction: "complete_transaction",
				recordedAt: options.runtime.now().toISOString(),
			});
			await options.store.append(writing);
			return result("admitted", "active", writing, "owner", "remote", "complete_transaction", "Complete the meaningful event explicitly.");
		},

		async join(input) {
			const loaded = await loadReceipt();
			if (!loaded || "status" in loaded) return loaded ?? refusal("absent", "blocked", "receipt_conflict", "begin_transaction", "Begin one outer transaction first.");
			const authorization = await authorize(options.store, loaded, input.transactionId, "join", input.capability);
			if (authorization) return authorization;
			if (loaded.phase !== "writing") {
				return refusal(stateForPhase(loaded.phase) ?? "active", loaded.phase, "receipt_conflict", "inspect_status", "Join requires a transaction in the writing phase; inspect current status.");
			}
			const fenced = await fence(loaded, input.remote);
			if (fenced) return fenced;
			// Already-owned paths were admitted at their join time and may be
			// dirty now by design; only genuinely new paths face admission.
			const existing = new Set(loaded.ownedPaths.map((path) => path.path));
			const fresh = input.requestedPaths.filter((path) => !existing.has(path));
			if (fresh.length === 0) return result("joined", "active", loaded, "join", "none", "continue_outer_transaction", "Continue the outer transaction.");
			const admission = await options.repository.inspectOwnedPaths(fresh);
			if (admission.status === "refused") return refusal("active", loaded.phase, "owned_path_not_admitted", "change_owned_paths", `Change the joined path set; admission found ${admission.reason}.`);
			const additions = admission.paths.filter((path) => !existing.has(path.path));
			if (additions.length === 0) return result("joined", "active", loaded, "join", "none", "continue_outer_transaction", "Continue the outer transaction.");
			const joined = nextReceipt(loaded, {
				transition: "paths_joined",
				ownedPaths: [...loaded.ownedPaths, ...copyPaths(additions)],
				nextSafeAction: "continue_outer_transaction",
				recordedAt: options.runtime.now().toISOString(),
			});
			await options.store.append(joined);
			return result("joined", "active", joined, "join", "local", "continue_outer_transaction", "Continue the outer transaction.");
		},

		async complete(input) {
			const loaded = await loadReceipt();
			if (!loaded || "status" in loaded) return loaded ?? refusal("absent", "blocked", "receipt_conflict", "begin_transaction", "Begin one transaction first.");
			const authorization = await authorize(options.store, loaded, input.transactionId, "owner", input.capability);
			if (authorization) return authorization;
			const fenced = await fence(loaded, input.remote);
			if (fenced) return fenced;
			const checking = nextReceipt(loaded, {
				phase: "checking",
				transition: "completion_requested",
				nextSafeAction: "run_owned_path_checks",
				recordedAt: options.runtime.now().toISOString(),
			});
			await options.store.append(checking);
			return result("advanced", "active", checking, "owner", "local", "run_owned_path_checks", "Run exact owned-path completion checks.");
		},

		async inspect() {
			const loaded = await loadReceipt();
			if (loaded === null) return inspected("absent", "blocked", "begin_transaction", "Begin one transaction before canonical writes.");
			if ("status" in loaded) return loaded;
			// Terminal phases are durable local facts; a remote failure must
			// never downgrade them to "unknown".
			const phaseState = stateForPhase(loaded.phase);
			if (phaseState && phaseState !== "unknown") {
				return result("inspected", phaseState, loaded, "denied", "none", nextForState(phaseState), summaryForState(phaseState));
			}
			const observed = await observeRemoteLedger(options.ledger, { remote: loaded.remote });
			if (observed.status === "refused") return result("inspected", "unknown", loaded, "denied", "none", "retry_remote", "Retry remote inspection after checking connectivity.", observed.blocker);
			if (!loaded.transactionId || !loaded.leaseGeneration) {
				return result("inspected", "unknown", loaded, "denied", "none", "inspect_remote_lease", "Inspect remote lease acquisition evidence.");
			}
			if (observed.generation !== loaded.leaseGeneration || observed.lease?.transactionId !== loaded.transactionId) {
				return result("inspected", "superseded", loaded, "denied", "none", "preserve_local_edits", "Preserve local edits and inspect the newer lease.", "lease_generation_stale");
			}
			const acquiredAt = loaded.leaseAcquiredAt ? Date.parse(loaded.leaseAcquiredAt) : Number.NaN;
			const expired = !Number.isFinite(acquiredAt) || options.runtime.now().getTime() > acquiredAt + loaded.leaseDurationMs;
			return result("inspected", expired ? "expired" : "active", loaded, "denied", "none", expired ? "request_operator_takeover" : "continue_transaction", expired ? "Ask an operator to inspect the stale lease." : "Continue the active transaction.");
		},

		async recordPhase(input) {
			const loaded = await loadReceipt();
			if (!loaded || "status" in loaded) {
				return loaded ?? refusal("human_required", "human_required", "transaction_mismatch", "inspect_status", "Inspect the active transaction before recording a phase.");
			}
			const authorization = await authorize(options.store, loaded, input.transactionId, "owner", input.capability);
			if (authorization) return authorization;
			const fenced = await fence(loaded, input.remote);
			if (fenced) return fenced;
			const transition = input.phase === "push_pending" ? "push_outcome_unknown" : input.phase === "repairable" ? "deterministic_repair_available" : input.phase === "human_required" ? "human_intervention_required" : "closed";
			const recorded = nextReceipt(loaded, {
				phase: input.phase,
				transition,
				nextSafeAction: input.nextSafeAction,
				commitId: input.commitId ?? loaded.commitId,
				recordedAt: options.runtime.now().toISOString(),
			});
			await options.store.append(recorded);
			return result("advanced", stateForPhase(recorded.phase) ?? "active", recorded, "owner", "local", recorded.nextSafeAction, summaryForState(stateForPhase(recorded.phase) ?? "active"));
		},
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

function nextReceipt(previous: VaultGitReceipt, changes: Partial<VaultGitReceipt>): VaultGitReceipt {
	return { ...previous, ...changes, schemaVersion: 1, receiptId: previous.receiptId, revision: previous.revision + 1 };
}

function copyPaths(paths: readonly VaultGitOwnedPathReceipt[]): VaultGitOwnedPathReceipt[] { return paths.map((path) => ({ ...path })); }

function result(status: VaultGitEngineResult["status"], state: VaultGitTransactionState, receipt: VaultGitReceipt, writePermission: VaultGitWritePermission, changedState: VaultGitEngineResult["changedState"], actionId: VaultGitEngineNextActionId, summary: string, blocker?: VaultGitBlockerId): VaultGitEngineResult {
	return { status, state, phase: receipt.phase, writePermission, changedState, retrySafety: state === "human_required" || state === "superseded" || state === "expired" ? "operator_required" : "same_input_safe", nextAction: { id: actionId, summary }, transactionId: receipt.transactionId ?? undefined, receiptId: receipt.receiptId, diagnosticsReference: receipt.diagnosticsReference, ...(blocker ? { blocker } : {}) };
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

function nextForState(state: VaultGitTransactionState): VaultGitEngineNextActionId { return state === "push_pending" ? "retry_push" : state === "repairable" ? "run_repair" : state === "human_required" ? "request_operator_review" : "none"; }
function summaryForState(state: VaultGitTransactionState): string { return state === "push_pending" ? "Retry publication only after remote reconciliation." : state === "repairable" ? "Run the recorded deterministic repair." : state === "human_required" ? "Ask an operator to inspect conflicting evidence." : "No transaction action remains."; }

function validateBegin(input: VaultGitBeginInput): void {
	if (input.requestedPaths.length === 0) throw new Error("begin requires owned paths");
	if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs <= 0) throw new Error("lease duration must be positive");
}

function alignmentBlocker(alignment: "aligned" | "behind" | "ahead" | "diverged" | "local_missing"): VaultGitBlockerId {
	return alignment === "behind" ? "main_behind" : alignment === "ahead" ? "main_ahead" : alignment === "diverged" ? "main_diverged" : "vault_unconfigured";
}
