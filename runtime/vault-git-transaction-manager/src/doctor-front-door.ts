/**
 * Deep Doctor owner (issue #390 U4).
 *
 * Owns the Doctor Task journey behind the CLI adapter: foreground admission
 * into the Doctor Task Lifecycle, Doctor Task inspection with stale-worker
 * reconciliation, terminal projection, and Doctor Continuation mapping. The
 * lifecycle (doctor-task-lifecycle.ts) and diagnosis (doctor.ts) stay internal
 * seams beneath it; the CLI adapter only parses, dispatches, and renders the
 * projections returned here. Doctor stays authority-free: the only writes made
 * through this owner are owner-private Doctor Task state writes.
 */

import { randomUUID } from "node:crypto";

import { createVaultGitActionRef as action } from "./command-contract.ts";
import {
	classifyVaultGitDoctorLocalReceipt,
	type VaultGitDoctorResult,
} from "./doctor.ts";
import {
	createVaultGitDoctorTaskLifecycle,
	VAULT_GIT_DOCTOR_TASK_OBSERVATION_EXPIRY_MS,
	type VaultGitBackgroundDoctorRuntime,
	type VaultGitDoctorTaskLifecycle,
} from "./doctor-task-lifecycle.ts";
import type { VaultGitDoctorTaskState } from "./doctor-task-state.ts";
import type { VaultGitDoctorTaskStore } from "./doctor-task-store.ts";
import type { VaultGitTaskState } from "./model.ts";
import {
	createVaultGitCandidateResidueStore,
	type VaultGitCandidateResidueObserveResult,
} from "./validation-candidate.ts";
import {
	isVaultGitNextActionId,
	resolveVaultGitDoctorTerminalNextAction,
	type VaultGitDoctorPublicationEvidence,
	type VaultGitDoctorResidueRouteEvidence,
	type VaultGitDoctorTaskTerminal,
	type VaultGitDoctorValidationRouteEvidence,
	type VaultGitLifecycleResultPayload,
	type VaultGitNextAction,
	type VaultGitNextActionId,
	type VaultGitValidationFailure,
} from "./model.ts";
import {
	// The U1 owner composer is the public lifecycle-result construction path: it
	// projects the authoritative Next Safe Action union from the payload's action
	// ref, derives compat id/summary + facade affordances, and rejects divergence.
	composeVaultGitLifecycleResult as createVaultGitLifecycleResult,
	projectVaultGitNextAction,
	rehydrateVaultGitPersistedNextAction,
	type VaultGitContinuationContext,
	type VaultGitContinuationSelectors,
	type VaultGitNextActionRef,
} from "./next-safe-action.ts";
import type { VaultGitReceiptStore } from "./store.ts";
import type {
	VaultGitTaskLoadResult,
	VaultGitTaskStore,
} from "./task-store.ts";

export type { VaultGitBackgroundDoctorRuntime } from "./doctor-task-lifecycle.ts";

/** One rendered-ready Doctor result the CLI adapter emits without reshaping. */
export interface VaultGitDoctorFrontDoorProjection {
	/** Complete public lifecycle envelope, ready for deterministic rendering. */
	readonly payload: VaultGitLifecycleResultPayload;
	/** True only when the projected Doctor operation succeeded. */
	readonly success: boolean;
	/** Stable machine error code; empty on success. */
	readonly errorCode: string;
}

/** Foreground admission decision for one public doctor invocation. */
export type VaultGitDoctorForegroundAdmission =
	| {
			/** No admissible receipt evidence; run the direct authoritative pass. */
			readonly kind: "foreground";
	  }
	| {
			/** A durable Doctor Task already owns this invocation. */
			readonly kind: "projected";
			/** Projection of the owning task's current or terminal state. */
			readonly projection: VaultGitDoctorFrontDoorProjection;
	  };

/**
 * Narrow authoritative evidence sources for U4 Doctor routing: the durable
 * Completion Task owner and the U3 Candidate Residue observer. The producer
 * derives only what these owners prove; absent detail becomes the correct
 * insufficient or unknown arm, never invented state.
 */
export interface VaultGitDoctorEvidenceSource {
	/** Load the Completion Task bound to one exact receipt without collapsing read failures. */
	loadCompletionTask(receiptId: string): Promise<VaultGitTaskLoadResult>;
	/** Observe Candidate Residue evidence through the U3 owner. */
	observeResidue(
		completion: VaultGitTaskState,
	): Promise<VaultGitCandidateResidueObserveResult>;
}

/** Production owners required to compose authoritative Doctor evidence. */
export interface VaultGitDoctorEvidenceSourceOptions {
	/** Durable Completion Task store selected for this repository. */
	readonly completionTasks: VaultGitTaskStore;
	/** Owner-private root containing Candidate Residue evidence. */
	readonly privateStateRoot: string;
	/** Optional deterministic clock for residue age classification. */
	readonly now?: () => Date;
}

/**
 * Compose the production U4 evidence source over the receipt-selected
 * Completion Task store and U3 Candidate Residue observer. Ownership is proven
 * only by a fresh read of the same bound Completion Task. Missing, corrupt,
 * mismatched, or unknown task evidence never becomes inactive ownership.
 *
 * @param options - Completion Task, private-state, and clock owners
 * @returns The read-only Doctor evidence source
 * @internal
 */
export function createVaultGitDoctorEvidenceSource(
	options: VaultGitDoctorEvidenceSourceOptions,
): VaultGitDoctorEvidenceSource {
	return {
		loadCompletionTask: (receiptId) => options.completionTasks.load(receiptId),
		observeResidue(completion) {
			return createVaultGitCandidateResidueStore({
				privateStateRoot: options.privateStateRoot,
				...(options.now ? { now: options.now } : {}),
				ownership: {
					async isTransactionActivelyOwned(transactionId) {
						if (transactionId !== completion.transactionId) return "unknown";
						const current = await options.completionTasks.load(
							completion.receiptId,
						);
						if (
							current.status !== "loaded" ||
							current.state.taskId !== completion.taskId ||
							current.state.receiptId !== completion.receiptId ||
							current.state.transactionId !== transactionId
						) {
							return "unknown";
						}
						if (current.state.state === "unknown") return "unknown";
						return current.state.phase === "terminal" ? "inactive" : "active";
					},
				},
			}).observe();
		},
	};
}

/** Deep Doctor composition inputs; process effects arrive through the runtime. */
export interface VaultGitDoctorFrontDoorOptions<SpawnContext> {
	/** Private receipt and activation evidence owner. */
	readonly store: VaultGitReceiptStore;
	/** Owner-private Doctor Task store. */
	readonly taskStore: VaultGitDoctorTaskStore;
	/** Injected process and clock effects for lifecycle choreography. */
	readonly runtime: VaultGitBackgroundDoctorRuntime<SpawnContext>;
	/** Opaque composition context passed only to the spawn adapter. */
	readonly spawnContext: SpawnContext;
	/** Envelope clock in epoch milliseconds. */
	readonly now: () => number;
	/** Authoritative evidence sources; absent leaves diagnoses unenriched. */
	readonly evidence?: VaultGitDoctorEvidenceSource;
}

/** Deep Doctor owner behind the CLI adapter. */
export interface VaultGitDoctorFrontDoor {
	/** Admit one foreground doctor invocation into the Doctor Task Lifecycle. */
	admitForeground(input: {
		/** Optional exact transaction selected by the public invocation. */
		readonly transactionId?: string | undefined;
		/** Normalized public Doctor argv bound into task identity. */
		readonly args: readonly string[];
	}): Promise<VaultGitDoctorForegroundAdmission>;
	/** Inspect one Doctor Task with stale-worker reconciliation. */
	inspectDoctorTask(input: {
		/** Opaque Doctor Task identifier returned by foreground admission. */
		readonly taskId: string;
	}): Promise<VaultGitDoctorFrontDoorProjection>;
	/** Execute one worker attempt: acknowledge, heartbeat, diagnose, terminalize. */
	runWorker(input: {
		/** Exact admitted Doctor Task identifier. */
		readonly taskId: string;
		/** Exact launch generation acknowledged by this worker. */
		readonly launchGeneration: string;
		/** Public process identifier fenced by process identity. */
		readonly workerPid: number;
		/** Authoritative diagnosis seam; authority revalidation stays with the engine. */
		readonly diagnose: () => Promise<VaultGitDoctorResult>;
	}): Promise<VaultGitDoctorResult>;
}

/** Observational heartbeat cadence for one acknowledged Doctor worker. */
const DOCTOR_WORKER_HEARTBEAT_INTERVAL_MS = 5_000;

/** Earliest useful re-inspection of an unchanged nonterminal Doctor Task. */
const VAULT_GIT_DOCTOR_TASK_POLL_AFTER_MS = 5_000;

/**
 * Bounded observation metadata for one NONTERMINAL Doctor Task state: exact
 * durable revision plus wall-clock poll-after and observation-expiry instants
 * Poll-after follows the last durable change, while observation expiry remains
 * anchored to admission. Terminal states never carry either value.
 */
function doctorTaskObservationMetadata(
	state: VaultGitDoctorTaskState,
):
	| Record<string, never>
	| {
			readonly task_revision: number;
			readonly task_poll_after: string;
			readonly task_observation_expires_at: string;
	  } {
	if (state.phase === "terminal") return {};
	const changedAtMs = Date.parse(state.updatedAt);
	const admittedAtMs = Date.parse(state.recordedAt);
	return {
		task_revision: state.revision,
		task_poll_after: new Date(
			changedAtMs + VAULT_GIT_DOCTOR_TASK_POLL_AFTER_MS,
		).toISOString(),
		task_observation_expires_at: new Date(
			admittedAtMs + VAULT_GIT_DOCTOR_TASK_OBSERVATION_EXPIRY_MS,
		).toISOString(),
	};
}

function isDoctorTaskObservationExpired(
	state: VaultGitDoctorTaskState,
	now: number,
): boolean {
	return (
		state.phase !== "terminal" &&
		now >=
			Date.parse(state.recordedAt) +
				VAULT_GIT_DOCTOR_TASK_OBSERVATION_EXPIRY_MS
	);
}

/**
 * Terminalize an expired observation through the lifecycle owner, then project the
 * durable terminal. Bounded observation is a DURABLE decision, not a public-only
 * one: leaving a stalled task nonterminal would let a late worker publish a
 * canonical diagnosis after the operator was already told the observation ended,
 * and would let inspection reopen polling forever.
 */
async function reconciledExpiredDoctorObservation(
	lifecycle: VaultGitDoctorTaskLifecycle,
	state: VaultGitDoctorTaskState,
	now: number,
): Promise<VaultGitDoctorFrontDoorProjection | null> {
	if (!isDoctorTaskObservationExpired(state, now)) return null;
	const expired = await lifecycle.reconcileObservationExpiry({
		taskId: state.taskId,
	});
	// Project the durable terminal through the one terminal projector, so the
	// first read and every later read of the same record agree. Do not synthesize
	// a public-only expiry payload here: that is what previously let a second
	// inspection disagree with the first.
	return doctorTaskProjection(expired.state, now);
}

/**
 * The fixed continuation for a durably expired observation: a terminal stop with
 * no runnable action and no argv. Derived from the terminal KIND, never from a
 * persisted carrier, so it cannot drift into an executable route.
 */
const DOCTOR_OBSERVATION_EXPIRED_CONTINUATION: VaultGitNextAction = {
	kind: "none",
	id: "none",
	action_id: "none",
	summary: "Bounded Background Doctor observation expired; operator review required.",
};

type DoctorLocalReceipt = ReturnType<typeof classifyVaultGitDoctorLocalReceipt>;
type DoctorReceiptLoad = Awaited<ReturnType<VaultGitReceiptStore["load"]>>;
type LoadedDoctorReceipt = Extract<DoctorReceiptLoad, { status: "loaded" }>;

function selectDoctorReceipt(
	loaded: DoctorReceiptLoad,
	transactionId: string | undefined,
): LoadedDoctorReceipt | undefined {
	if (loaded.status !== "loaded") return undefined;
	if (
		transactionId !== undefined &&
		loaded.receipt.transactionId !== transactionId
	) {
		return undefined;
	}
	return loaded;
}

function doctorTaskBinding(
	receipt: LoadedDoctorReceipt["receipt"],
	transactionId: string | undefined,
	repositoryId: string,
	activationEvidenceId: string | null,
) {
	return {
		repositoryId,
		activationEvidenceId,
		receiptId: receipt.receiptId ?? null,
		receiptRevision: receipt.revision ?? null,
		transactionId: transactionId ?? receipt.transactionId ?? null,
		normalizedInput: JSON.stringify({
			command: "doctor",
			transactionId: transactionId ?? null,
		}),
	};
}

function projectedDoctorAdmission(
	payload: VaultGitLifecycleResultPayload,
	success: boolean,
	errorCode: string,
): VaultGitDoctorForegroundAdmission {
	return {
		kind: "projected",
		projection: { payload, success, errorCode },
	};
}

function refusedDoctorAdmission(
	local: DoctorLocalReceipt,
	state: VaultGitDoctorTaskState,
	reason: VaultGitLifecycleResultPayload["blockers"][number],
	now: number,
): VaultGitDoctorForegroundAdmission {
	const inputMismatch = reason === "task_input_mismatch";
	const payload = createVaultGitLifecycleResult({
		command: "doctor",
		outcome: "refused",
		phase: local.phase,
		write_permission: "denied",
		changed_state: inputMismatch ? "none" : "local",
		retry_safety: "operator_required",
		blockers: [reason],
		transaction_id: local.transactionId,
		transaction_state: local.state,
		task_id: state.taskId,
		task_generation: state.launchGeneration ?? undefined,
		task_state: state.state,
		task_phase: state.phase,
		task_elapsed_ms: Math.max(0, now - Date.parse(state.recordedAt)),
		...doctorTaskObservationMetadata(state),
		foreground_non_vault_work_allowed: true,
		next_action: action(
			"inspect_status",
			inputMismatch
				? "Inspect the existing Background Doctor task before retrying."
				: "Inspect the Background Doctor task before any repair.",
			{ result_kind: "doctor_task" },
		),
	});
	return projectedDoctorAdmission(payload, false, reason);
}

function terminalDoctorAdmission(
	state: VaultGitDoctorTaskState,
	now: number,
): VaultGitDoctorForegroundAdmission {
	const payload = payloadForDoctorTask(state, now);
	const blocker = payload.blockers[0];
	const success =
		state.state === "closed" && blocker !== "continuation_unavailable";
	const errorCode = success
		? ""
		: (blocker ?? state.terminalResult?.blocker ?? "worker_lost");
	return projectedDoctorAdmission(payload, success, errorCode);
}

function activeDoctorAdmission(
	local: DoctorLocalReceipt,
	state: VaultGitDoctorTaskState,
	now: number,
): VaultGitDoctorForegroundAdmission {
	const payload = createVaultGitLifecycleResult({
		command: "doctor",
		outcome: "advanced",
		phase: local.phase,
		write_permission: "denied",
		changed_state: "local",
		retry_safety: "same_input_safe",
		blockers: [],
		transaction_id: local.transactionId,
		transaction_state: local.state,
		task_id: state.taskId,
		task_generation: state.launchGeneration ?? undefined,
		task_state: state.state,
		task_phase: state.phase,
		task_heartbeat_at: state.heartbeatAt,
		task_elapsed_ms: Math.max(0, now - Date.parse(state.recordedAt)),
		...doctorTaskObservationMetadata(state),
		foreground_non_vault_work_allowed: true,
		next_action: action(
			"inspect_status",
			"Inspect the Background Doctor task for authoritative diagnosis.",
			{ result_kind: "doctor_task" },
		),
	});
	return projectedDoctorAdmission(payload, true, "");
}

/**
 * Create the deep Doctor owner over the receipt store, Doctor Task store, and
 * injected lifecycle runtime.
 *
 * @param options - Stores, lifecycle runtime, spawn context, and envelope clock
 * @returns Foreground admission and Doctor Task inspection projections
 * @internal
 */
export function createVaultGitDoctorFrontDoor<SpawnContext>(
	options: VaultGitDoctorFrontDoorOptions<SpawnContext>,
): VaultGitDoctorFrontDoor {
	const composeLifecycle = (
		runtime: VaultGitBackgroundDoctorRuntime<SpawnContext>,
	): VaultGitDoctorTaskLifecycle =>
		createVaultGitDoctorTaskLifecycle({
			store: options.taskStore,
			runtime,
			spawnContext: options.spawnContext,
		});

	return {
		async admitForeground(input) {
			const acknowledgementStartedAt = options.runtime.now();
			const loaded = await options.store.load();
			const receipt = selectDoctorReceipt(loaded, input.transactionId);
			if (!receipt) {
				return { kind: "foreground" };
			}
			const selectedReceipt = receipt.receipt;
			const local = classifyVaultGitDoctorLocalReceipt(
				receipt,
				input.transactionId,
			);
			const activation = await options.store.readActivation();
			const outcome = await composeLifecycle({
				...options.runtime,
				// The launch path stamps durable admission records with the envelope
				// clock so admission timestamps and payload elapsed times agree.
				recordedAt: () => new Date(options.now()),
			}).launch({
				binding: doctorTaskBinding(
					selectedReceipt,
					input.transactionId,
					options.taskStore.repositoryId,
					activation?.evidenceId ?? null,
				),
				acknowledgementStartedAt,
				createLaunchGeneration: () =>
					`doctor_launch_${randomUUID().replaceAll("-", "")}`,
				args: input.args,
			});
			const state = outcome.state;
			if (outcome.kind === "refused") {
				return refusedDoctorAdmission(local, state, outcome.reason, options.now());
			}
			if (state.phase === "terminal") {
				return terminalDoctorAdmission(state, options.now());
			}
			const expired = await reconciledExpiredDoctorObservation(
				composeLifecycle(options.runtime),
				state,
				options.now(),
			);
			if (expired) return { kind: "projected", projection: expired };
			return activeDoctorAdmission(local, state, options.now());
		},

		async inspectDoctorTask(input) {
			const loaded = await options.taskStore.loadByTaskId(input.taskId);
			if (loaded.status === "absent") {
				const payload = createVaultGitLifecycleResult({
					command: "doctor",
					outcome: "refused",
					phase: "checking",
					write_permission: "denied",
					changed_state: "none",
					retry_safety: "same_input_safe",
					blockers: ["task_not_found"],
					task_id: input.taskId,
					foreground_non_vault_work_allowed: true,
					next_action: action(
						"change_input",
						"Use the opaque task ID returned by doctor.",
						{ result_kind: "doctor_task" },
					),
				});
				return { payload, success: false, errorCode: "task_not_found" };
			}
			if (loaded.status === "corrupt") {
				const payload = createVaultGitLifecycleResult({
					command: "doctor",
					outcome: "refused",
					phase: "human_required",
					write_permission: "denied",
					changed_state: "none",
					retry_safety: "operator_required",
					blockers: ["receipt_corrupt"],
					task_id: input.taskId,
					foreground_non_vault_work_allowed: true,
					next_action: action("inspect_private_receipt"),
				});
				return { payload, success: false, errorCode: "receipt_corrupt" };
			}
			if (loaded.status === "invalid_route") {
				const payload = createVaultGitLifecycleResult({
					command: "doctor",
					outcome: "refused",
					phase: "human_required",
					write_permission: "denied",
					changed_state: "none",
					retry_safety: "operator_required",
					blockers: ["continuation_unavailable"],
					task_id: input.taskId,
					foreground_non_vault_work_allowed: true,
					next_action: rehydrateVaultGitPersistedNextAction(
						"invalid_durable_route",
					),
				});
				return {
					payload,
					success: false,
					errorCode: "continuation_unavailable",
				};
			}
			const lifecycle = composeLifecycle(options.runtime);
			const reconciled = await lifecycle.reconcileStaleWorker({
				taskId: input.taskId,
			});
			const state = reconciled.state;
			// The same admission-anchored bound governs both a foreground join and
			// explicit task inspection, so both reach one durable terminal result.
			// Exact-identity reconciliation above may already have terminalized a
			// proven-dead worker; a live worker is never renewed past the window.
			const expired = await reconciledExpiredDoctorObservation(
				lifecycle,
				state,
				options.now(),
			);
			if (expired) return expired;
			return doctorTaskProjection(state, options.now());
		},

		async runWorker(input) {
			const lifecycle = composeLifecycle(options.runtime);
			const acknowledged = await lifecycle.acknowledgeWorker({
				taskId: input.taskId,
				launchGeneration: input.launchGeneration,
				workerPid: input.workerPid,
			});
			if (acknowledged.kind === "refused") {
				throw new Error("Background Doctor acknowledgement refused");
			}
			const heartbeat = setInterval(() => {
				void lifecycle
					.heartbeatWorker({
						taskId: input.taskId,
						launchGeneration: input.launchGeneration,
						workerPid: input.workerPid,
					})
					.catch(() => undefined);
			}, DOCTOR_WORKER_HEARTBEAT_INTERVAL_MS);
			heartbeat.unref();
			try {
				try {
					const diagnosed = await input.diagnose();
					const enriched = await enrichVaultGitDoctorEvidence(
						diagnosed,
						acknowledged.state,
						options.evidence,
					);
					const result = enriched.result;
					const terminalized = await lifecycle.terminalizeWorker({
						taskId: input.taskId,
						launchGeneration: input.launchGeneration,
						workerPid: input.workerPid,
						terminalResult: {
							kind: "doctor_result",
							status: result.status,
							state: result.state,
							phase: result.phase,
							finding: result.finding,
							changedState: result.changedState,
							retrySafety: result.retrySafety,
							// New writes persist the normalized semantic id only (no summary, no
							// legacy { id, summary } object). Identity is normalized, not
							// executability: the read reconstructs the full continuation (and
							// fails closed if a selector is missing) from this id, durable state,
							// and catalog.
							nextActionId: enriched.nextActionId,
							...(result.blocker ? { blocker: result.blocker } : {}),
							...(result.repairAction
								? { repairAction: result.repairAction }
								: {}),
							...(result.transactionId
								? { transactionId: result.transactionId }
								: {}),
							...(result.validationEvidence
								? { validationEvidence: result.validationEvidence }
								: {}),
							...(result.publicationEvidence
								? { publicationEvidence: result.publicationEvidence }
								: {}),
						},
					});
					if (terminalized.kind === "refused") {
						throw new Error("Background Doctor terminalization refused");
					}
					return result;
				} catch (error) {
					await lifecycle
						.terminalizeWorker({
							taskId: input.taskId,
							launchGeneration: input.launchGeneration,
							workerPid: input.workerPid,
							terminalResult: {
								kind: "worker_failure",
								blocker: "worker_lost",
								retrySafety: "operator_required",
								nextAction: {
									id: "inspect_private_receipt",
									summary:
										"Inspect the preserved Background Doctor failure before repair.",
								},
							},
						})
						.catch(() => undefined);
					throw error;
				}
			} finally {
				clearInterval(heartbeat);
			}
		},
	};
}

/**
 * The semantic identity a NEW terminal write persists for one diagnosis.
 * Stale-Lease Takeover row 2 (ADR-0002 U4): the exact burned/missing-Takeover-
 * Token evidence (run_doctor with finding lease_expired and no admitted repair
 * action) persists reattest_stale_lease_takeover so durable recovery never
 * self-loops. Every other diagnosis passes through the identity split only and
 * is retained verbatim; evidence outside that exact shape is never re-labelled.
 */
function doctorTerminalWriteSemanticId(result: VaultGitDoctorResult): string {
	if (
		isReconciledStaleLeaseTakeoverEvidence({
			actionId: result.nextAction.id,
			finding: result.finding,
			changedState: result.changedState,
			repairAction: result.repairAction,
		})
	) {
		return "reattest_stale_lease_takeover";
	}
	return doctorTerminalSemanticId(result.nextAction.id);
}

function isReconciledStaleLeaseTakeoverEvidence(input: {
	readonly actionId: string;
	readonly finding: string;
	readonly changedState: "none" | "local";
	readonly repairAction?: string;
}): boolean {
	return (
		input.actionId === "run_doctor" &&
		input.finding === "lease_expired" &&
		input.changedState === "local" &&
		input.repairAction === undefined
	);
}

/**
 * Live evidence producer (issue #390 stories 32, 38, 54, 55): enrich one
 * authoritative diagnosis with exactly what the durable owners prove before
 * terminalization. Publication evidence arrives already classified by the
 * diagnosis owner; validation evidence is derived from the Completion Task
 * durably bound to the same receipt and transaction, gated to check-shaped
 * findings so an unrelated diagnosis is never re-labelled. Reads only; no
 * receipt, task, lease, or repair state is written here.
 */
interface EnrichedVaultGitDoctorEvidence {
	readonly result: VaultGitDoctorResult;
	readonly nextActionId: string;
}

function doctorDiagnosisNeedsValidationEvidence(
	result: VaultGitDoctorResult,
): boolean {
	if (result.publicationEvidence !== undefined) return false;
	return (
		result.finding === "checks_interrupted" ||
		result.finding === "deterministic_failure"
	);
}

function selectedCompletionTask(
	loaded: VaultGitTaskLoadResult,
	binding: VaultGitDoctorTaskState,
	transactionId: string | null,
): VaultGitTaskState | undefined {
	if (loaded.status !== "loaded" || transactionId === null) return undefined;
	return [
		loaded.state.receiptId === binding.receiptId,
		loaded.state.receiptRevision === binding.receiptRevision,
		loaded.state.transactionId === transactionId,
	].every(Boolean)
		? loaded.state
		: undefined;
}

async function enrichVaultGitDoctorEvidence(
	result: VaultGitDoctorResult,
	binding: VaultGitDoctorTaskState,
	source: VaultGitDoctorEvidenceSource | undefined,
): Promise<EnrichedVaultGitDoctorEvidence> {
	const diagnosisWithoutUntrustedValidation =
		result.validationEvidence === undefined
			? result
			: (({ validationEvidence: _, ...diagnosis }) => diagnosis)(result);
	const authoritative =
		diagnosisWithoutUntrustedValidation.publicationEvidence === undefined
			? diagnosisWithoutUntrustedValidation
			: withoutDiagnosisRepairAction(diagnosisWithoutUntrustedValidation);
	const unchanged = (): EnrichedVaultGitDoctorEvidence => ({
		result: authoritative,
		nextActionId: doctorTerminalWriteSemanticId(authoritative),
	});
	const receiptId = binding.receiptId;
	if (!doctorDiagnosisNeedsValidationEvidence(authoritative)) {
		return unchanged();
	}
	if (receiptId === null || source === undefined) {
		return {
			result: withoutDiagnosisRepairAction(authoritative),
			nextActionId: "escalate_validation_evidence",
		};
	}
	const loaded = await source.loadCompletionTask(receiptId);
	const transactionId = authoritative.transactionId ?? binding.transactionId;
	const completion = selectedCompletionTask(loaded, binding, transactionId);
	if (!completion) {
		return {
			result: withoutDiagnosisRepairAction(authoritative),
			nextActionId: "escalate_validation_evidence",
		};
	}
	const failure =
		completion.terminalResult?.validationFailure ??
		completion.previousTerminalResult?.validationFailure;
	if (!failure) {
		return {
			result: withoutDiagnosisRepairAction(authoritative),
			nextActionId: "escalate_validation_evidence",
		};
	}
	const validationEvidence = await deriveValidationRouteEvidence(
		failure,
		completion,
		source,
	);
	const enriched = {
		...withoutDiagnosisRepairAction(authoritative),
		validationEvidence,
	};
	return {
		result: enriched,
		nextActionId: doctorTerminalWriteSemanticId(enriched),
	};
}

function withoutDiagnosisRepairAction(
	result: VaultGitDoctorResult,
): VaultGitDoctorResult {
	return result.repairAction === undefined
		? result
		: (({ repairAction: _, ...diagnosis }) => diagnosis)(result);
}

/**
 * Map one durable Validation Failure Class to route evidence, using only what
 * durable state proves. The stored failure carries class and stage; it names
 * no Host Enrollment defect and no admitted checker Repair ID, so setup and
 * content collapse to their insufficient arms until richer durable evidence
 * exists. Cleanup consumes the real Candidate Residue observation.
 */
async function deriveValidationRouteEvidence(
	failure: VaultGitValidationFailure,
	completion: VaultGitTaskState,
	source: VaultGitDoctorEvidenceSource,
): Promise<VaultGitDoctorValidationRouteEvidence> {
	switch (failure.failureClass) {
		case "candidate_setup":
			return { failureClass: "candidate_setup", setup: "insufficient" };
		case "vault_content":
			return { failureClass: "vault_content", content: "insufficient" };
		case "stage_budget_exceeded":
			if (failure.stage !== "candidate_cleanup") {
				return {
					failureClass: "stage_budget_exceeded",
					stage: failure.stage,
				};
			}
			return {
				failureClass: "stage_budget_exceeded",
				stage: "candidate_cleanup",
				...(await deriveResidueRouteEvidence(completion, source)),
			};
		case "candidate_cleanup":
			return {
				failureClass: "candidate_cleanup",
				...(await deriveResidueRouteEvidence(completion, source)),
			};
	}
}

/**
 * Classify this transaction's Candidate Residue from the U3 observer. Unknown
 * or unreadable evidence stops as unknown ownership; active ownership names
 * the exact Completion Task the observation proved; a young record carries its
 * real age gate. Precedence prefers the stop that preserves evidence.
 */
async function deriveResidueRouteEvidence(
	completion: VaultGitTaskState,
	source: VaultGitDoctorEvidenceSource,
): Promise<VaultGitDoctorResidueRouteEvidence> {
	const observed = await source.observeResidue(completion);
	if (observed.status !== "observed") {
		return { residue: "unknown_ownership" };
	}
	if (observed.observations.some((observation) => observation.kind !== "record")) {
		return { residue: "unknown_ownership" };
	}
	const records = observed.observations.filter(
		(observation) =>
			observation.kind === "record" &&
			observation.transactionId === completion.transactionId,
	);
	const eligibilityOf = (record: (typeof records)[number]): string =>
		record.kind === "record" ? record.eligibility : "unknown_evidence";
	if (
		records.some((record) => {
			const eligibility = eligibilityOf(record);
			return (
				eligibility === "unknown_owner" || eligibility === "unknown_evidence"
			);
		})
	) {
		return { residue: "unknown_ownership" };
	}
	if (records.some((record) => eligibilityOf(record) === "active_owned")) {
		return { residue: "active_owned", taskId: completion.taskId };
	}
	if (records.some((record) => eligibilityOf(record) === "eligible")) {
		return { residue: "old_proven_unowned" };
	}
	const young = records.find(
		(record) => eligibilityOf(record) === "young",
	);
	if (young && young.kind === "record") {
		return {
			residue: "young_proven_unowned",
			eligibleAfter: young.eligibleAfter,
		};
	}
	return { residue: "absent_or_removed" };
}

/** One routed matrix continuation plus what its reprojection needs. */
interface RoutedValidationContinuation {
	readonly union: VaultGitNextAction;
	readonly context?: VaultGitContinuationContext;
	readonly selectors?: VaultGitContinuationSelectors;
}

function escalateValidationEvidence(
	condition: NonNullable<VaultGitContinuationContext["escalation_condition"]>,
): RoutedValidationContinuation {
	const context: VaultGitContinuationContext = {
		escalation_condition: condition,
	};
	return {
		union: projectVaultGitNextAction({
			id: "escalate_validation_evidence",
			context,
		}),
		context,
	};
}

/**
 * The closed U4 validation route matrix (ADR-0002): one continuation per
 * failure class and evidence state. Setup, budget, and cleanup failures never
 * offer Deterministic Repair; the vault-content apply route names its semantic
 * action id while the catalog's U5 feature gate keeps it non-executable, so
 * the semantic carrier stays separate from executability.
 */
function routeValidationEvidence(
	evidence: VaultGitDoctorValidationRouteEvidence,
	transactionId: string | undefined,
): RoutedValidationContinuation {
	switch (evidence.failureClass) {
		case "candidate_setup":
			return routeSetupEvidence(evidence.setup);
		case "vault_content":
			return routeContentEvidence(evidence, transactionId);
		case "stage_budget_exceeded":
			return routeBudgetEvidence(evidence);
		case "candidate_cleanup":
			return routeResidueEvidence(evidence);
	}
}

function routeSetupEvidence(
	setup: Extract<
		VaultGitDoctorValidationRouteEvidence,
		{ failureClass: "candidate_setup" }
	>["setup"],
): RoutedValidationContinuation {
	const actionIds = {
		proven_enrollment_defect: "preview_host_enrollment_repair",
		missing_private_enrollment_inputs: "provide_host_enrollment_inputs",
		absent_external_ssh_prerequisites: "provision_repository_ssh",
	} as const;
	if (setup === "proven_candidate_integrity_defect") {
		return escalateValidationEvidence("candidate_integrity_reconciled");
	}
	if (setup === "insufficient") {
		return escalateValidationEvidence("validation_evidence_required");
	}
	return { union: projectVaultGitNextAction({ id: actionIds[setup] }) };
}

function routeContentEvidence(
	evidence: Extract<
		VaultGitDoctorValidationRouteEvidence,
		{ failureClass: "vault_content" }
	>,
	transactionId: string | undefined,
): RoutedValidationContinuation {
	if (evidence.content === "insufficient") {
		return escalateValidationEvidence(
			"deterministic_content_repair_available",
		);
	}
	const selectors: VaultGitContinuationSelectors = {
		...(transactionId ? { transaction_id: transactionId } : {}),
		repair_id: evidence.repairId,
	};
	return {
		union: projectVaultGitNextAction({
			id: "apply_vault_content_repair",
			selectors,
		}),
		selectors,
	};
}

function routeBudgetEvidence(
	evidence: Extract<
		VaultGitDoctorValidationRouteEvidence,
		{ failureClass: "stage_budget_exceeded" }
	>,
): RoutedValidationContinuation {
	if (evidence.stage === "candidate_cleanup") {
		return routeResidueEvidence(evidence);
	}
	return {
		union: projectVaultGitNextAction({ id: "diagnose_validation_budget" }),
	};
}

/**
 * The closed U4 Unknown Publication Outcome table (ADR-0002): one route per
 * evidence class. Only proven-not-published evidence with origin host and
 * every fence intact may retry the push; anything unknown, conflicting, or
 * breached stops at its named operator condition, and an invoke row without
 * its durable transaction selector fails closed, never a same-input retry
 * from incomplete evidence.
 */
function routePublicationEvidence(
	evidence: VaultGitDoctorPublicationEvidence,
	transactionId: string | undefined,
): RoutedValidationContinuation {
	const invoke = (
		id: "close_verified_publication" | "retry_proven_unpublished",
	): RoutedValidationContinuation => {
		const selectors: VaultGitContinuationSelectors = {
			...(transactionId ? { transaction_id: transactionId } : {}),
		};
		return {
			union: projectVaultGitNextAction({ id, selectors }),
			selectors,
		};
	};
	const handoff = (
		id:
			| "obtain_remote_evidence"
			| "resolve_publication_conflict"
			| "restore_remote_contract",
	): RoutedValidationContinuation => ({
		union: projectVaultGitNextAction({ id }),
	});
	switch (evidence) {
		case "remotely_closed":
			return invoke("close_verified_publication");
		case "proven_not_published_origin_intact":
			return invoke("retry_proven_unpublished");
		case "unavailable":
			return handoff("obtain_remote_evidence");
		case "conflicting":
			return handoff("resolve_publication_conflict");
		case "contract_breach":
			return handoff("restore_remote_contract");
	}
}

function routeResidueEvidence(
	evidence: VaultGitDoctorResidueRouteEvidence,
): RoutedValidationContinuation {
	switch (evidence.residue) {
		case "active_owned": {
			const context: VaultGitContinuationContext = {
				result_kind: "completion_task",
			};
			const selectors: VaultGitContinuationSelectors = {
				task_id: evidence.taskId,
			};
			return {
				union: projectVaultGitNextAction({
					id: "inspect_status",
					context,
					selectors,
				}),
				context,
				selectors,
			};
		}
		case "old_proven_unowned":
			return { union: projectVaultGitNextAction({ id: "run_janitor" }) };
		case "young_proven_unowned":
		case "absent_or_removed":
			// Terminal stop. A young residue carries its age gate in the public
			// task_terminal_result evidence for the next observation only; no
			// scheduler is implied. Janitor refusal never points back to Janitor.
			return { union: projectVaultGitNextAction({ id: "none" }) };
		case "unknown_ownership":
			return escalateValidationEvidence("validation_evidence_required");
	}
}

/** Terminal routing and public-terminal projection resolved once per state. */
interface DoctorTerminalProjection {
	readonly diagnosis: Extract<
		VaultGitDoctorTaskTerminal,
		{ kind: "doctor_result" }
	> | null;
	readonly workerFailure: Extract<
		VaultGitDoctorTaskTerminal,
		{ kind: "worker_failure" }
	> | null;
	readonly observationExpired: Extract<
		VaultGitDoctorTaskTerminal,
		{ kind: "observation_expired" }
	> | null;
	readonly routed: RoutedValidationContinuation | null;
	readonly union: VaultGitNextAction | null;
	readonly publicTerminal: VaultGitDoctorTaskTerminal | null;
	readonly invalidRoute: boolean;
	readonly terminalBindingMismatch: boolean;
}

/**
 * Select the routed continuation for one terminal diagnosis. Proven validation
 * or publication evidence is authoritative over the persisted carrier id: the
 * closed U4 tables select the continuation, so a legacy carrier can never
 * re-route classified evidence. The route binds the same durable transaction
 * identity the payload carries (terminal first, then task binding) so composer
 * reprojection cannot diverge.
 */
function routedDoctorContinuation(
	diagnosis: DoctorTerminalProjection["diagnosis"],
	state: VaultGitDoctorTaskState,
): RoutedValidationContinuation | null {
	if (!diagnosis) return null;
	const transactionId =
		diagnosis.transactionId ?? state.transactionId ?? undefined;
	if (diagnosis.validationEvidence) {
		return routeValidationEvidence(diagnosis.validationEvidence, transactionId);
	}
	if (diagnosis.publicationEvidence) {
		return routePublicationEvidence(
			diagnosis.publicationEvidence,
			transactionId,
		);
	}
	return null;
}

function resolveDoctorTerminalProjection(
	state: VaultGitDoctorTaskState,
): DoctorTerminalProjection {
	const terminal = state.terminalResult;
	const diagnosis = doctorTaskDiagnosis(terminal);
	const workerFailure = doctorTaskWorkerFailure(terminal);
	const observationExpired =
		terminal?.kind === "observation_expired" ? terminal : null;
	const terminalBindingMismatch = hasDoctorTerminalBindingMismatch(
		diagnosis,
		state,
	);
	// Invalid durable routing is resolved BEFORE evidence routing. Do not reorder:
	// classified validation or publication evidence would otherwise supply a
	// runnable union while the payload still blocks continuation_unavailable, so
	// the CLI would emit executable runtime_actions for a fail-closed result.
	const invalidRoute =
		terminalBindingMismatch || isInvalidPersistedRunDoctor(diagnosis);
	const routed = invalidRoute
		? null
		: routedDoctorContinuation(diagnosis, state);
	const union = invalidRoute
		? rehydrateVaultGitPersistedNextAction("invalid_durable_route")
		: doctorTaskTerminalUnion(terminal, routed, state.taskId);
	const publicTerminal = doctorTaskPublicTerminal(terminal, union);
	return {
		diagnosis,
		workerFailure,
		observationExpired,
		routed,
		union,
		publicTerminal,
		invalidRoute,
		terminalBindingMismatch,
	};
}

function hasDoctorTerminalBindingMismatch(
	diagnosis: DoctorTerminalProjection["diagnosis"],
	state: VaultGitDoctorTaskState,
): boolean {
	return diagnosis !== null &&
		(diagnosis.transactionId ?? null) !== state.transactionId;
}

function isInvalidPersistedRunDoctor(
	diagnosis: DoctorTerminalProjection["diagnosis"],
): boolean {
	if (!diagnosis) return false;
	const carrier = resolveVaultGitDoctorTerminalNextAction(diagnosis);
	return (
		carrier.actionId === "run_doctor" &&
		!isReconciledStaleLeaseTakeoverEvidence({
			actionId: carrier.actionId,
			finding: diagnosis.finding,
			changedState: diagnosis.changedState,
			repairAction: diagnosis.repairAction,
		})
	);
}

function doctorTaskDiagnosis(
	terminal: VaultGitDoctorTaskTerminal | null,
): DoctorTerminalProjection["diagnosis"] {
	return terminal?.kind === "doctor_result" ? terminal : null;
}

function doctorTaskWorkerFailure(
	terminal: VaultGitDoctorTaskTerminal | null,
): DoctorTerminalProjection["workerFailure"] {
	return terminal?.kind === "worker_failure" ? terminal : null;
}

function doctorTaskTerminalUnion(
	terminal: VaultGitDoctorTaskTerminal | null,
	routed: RoutedValidationContinuation | null,
	taskId: string,
): VaultGitNextAction | null {
	if (routed) return routed.union;
	return terminal ? doctorTerminalNextAction(terminal, taskId) : null;
}

function doctorTaskPublicTerminal(
	terminal: VaultGitDoctorTaskTerminal | null,
	union: VaultGitNextAction | null,
): VaultGitDoctorTaskTerminal | null {
	if (!terminal || !union) return null;
	const semanticId =
		union.action_id === "none"
			? doctorTerminalDurableSemanticId(terminal)
			: union.action_id;
	return projectDoctorTaskTerminal(terminal, semanticId);
}

/**
 * The compose context a projected terminal reprojects under. Contextual
 * compatibility ids such as retry_remote and run_repair do not share one
 * generic Doctor Task context; losing their persisted repair/inspection
 * context would make the composer reject the already-built union as divergent.
 */
function doctorTerminalComposeContext(
	projection: DoctorTerminalProjection,
): VaultGitContinuationContext {
	if (projection.routed) return projection.routed.context ?? {};
	if (!projection.union) return { result_kind: "doctor_task" };
	return {
		...doctorTaskNextActionContext(projection.union.id),
		...(projection.diagnosis?.repairAction
			? { repair_action: projection.diagnosis.repairAction }
			: {}),
	};
}

function doctorTaskOutcome(
	projection: DoctorTerminalProjection,
): VaultGitLifecycleResultPayload["outcome"] {
	return projection.workerFailure || projection.observationExpired
		? "refused"
		: "read_only";
}

function doctorTaskPhase(
	projection: DoctorTerminalProjection,
): VaultGitLifecycleResultPayload["phase"] {
	if (projection.diagnosis) return projection.diagnosis.phase;
	return projection.workerFailure || projection.observationExpired
		? "human_required"
		: "checking";
}

function doctorTaskTransactionState(
	projection: DoctorTerminalProjection,
): VaultGitLifecycleResultPayload["transaction_state"] {
	if (projection.diagnosis) return projection.diagnosis.state;
	return projection.workerFailure || projection.observationExpired
		? "unknown"
		: undefined;
}

function doctorTaskContinuation(
	projection: DoctorTerminalProjection,
): VaultGitLifecycleResultPayload["next_action"] | VaultGitNextActionRef {
	return (
		projection.union ??
		action(
			"inspect_status",
			"Inspect the Background Doctor task for authoritative diagnosis.",
			{ result_kind: "doctor_task" },
		)
	);
}

function doctorTaskIdentityFields(state: VaultGitDoctorTaskState, now: number) {
	return {
		task_id: state.taskId,
		task_generation: state.launchGeneration ?? undefined,
		task_state: state.state,
		task_phase: state.phase,
		task_heartbeat_at: state.heartbeatAt,
		task_checkpoint: state.checkpoint,
		task_elapsed_ms: Math.max(0, now - Date.parse(state.recordedAt)),
		...doctorTaskObservationMetadata(state),
	};
}

function doctorTaskDiagnosisFields(
	projection: DoctorTerminalProjection,
	state: VaultGitDoctorTaskState,
) {
	return {
		changed_state: doctorDiagnosisChangedState(projection),
		retry_safety: projection.invalidRoute
			? ("operator_required" as const)
			: doctorTerminalRetrySafety(state.terminalResult),
		blockers: projection.invalidRoute
			? ["continuation_unavailable" as const]
			: doctorTerminalBlockers(state.terminalResult),
		transaction_id: doctorDiagnosisTransactionId(projection, state),
		transaction_state: doctorTaskTransactionState(projection),
		finding: projection.diagnosis
			? projection.diagnosis.finding
			: undefined,
		// An evidence-routed continuation must never publish the stale compatibility
		// repair action; only the projected run_repair carrier may carry it.
		repair_action:
			projection.routed === null &&
			projection.union?.action_id === "run_repair"
				? projection.diagnosis?.repairAction
				: undefined,
		task_terminal_result: projection.publicTerminal,
	};
}

function doctorDiagnosisChangedState(
	projection: DoctorTerminalProjection,
): VaultGitLifecycleResultPayload["changed_state"] {
	return projection.diagnosis ? projection.diagnosis.changedState : "none";
}

function doctorTerminalRetrySafety(
	terminal: VaultGitDoctorTaskTerminal | null,
): VaultGitLifecycleResultPayload["retry_safety"] {
	return terminal ? terminal.retrySafety : "same_input_safe";
}

function doctorTerminalBlockers(
	terminal: VaultGitDoctorTaskTerminal | null,
): VaultGitLifecycleResultPayload["blockers"] {
	return terminal?.blocker ? [terminal.blocker] : [];
}

function doctorDiagnosisTransactionId(
	projection: DoctorTerminalProjection,
	state: VaultGitDoctorTaskState,
): string | undefined {
	if (projection.terminalBindingMismatch) {
		return state.transactionId ?? undefined;
	}
	if (projection.diagnosis?.transactionId) {
		return projection.diagnosis.transactionId;
	}
	return state.transactionId ?? undefined;
}

/**
 * The one durable-state projector shared by explicit task inspection and by the
 * expiry reconciliation path, so repeated reads of one terminal record can never
 * disagree with the first.
 */
function doctorTaskProjection(
	state: VaultGitDoctorTaskState,
	now: number,
): VaultGitDoctorFrontDoorProjection {
	const payload = payloadForDoctorTask(state, now);
	const success =
		state.state !== "unknown" &&
		!payload.blockers.includes("continuation_unavailable");
	return {
		payload,
		success,
		errorCode: success ? "" : (payload.blockers[0] ?? "runtime_unavailable"),
	};
}

function payloadForDoctorTask(
	state: VaultGitDoctorTaskState,
	now: number,
): VaultGitLifecycleResultPayload {
	const projection = resolveDoctorTerminalProjection(state);
	return createVaultGitLifecycleResult({
		command: "doctor",
		outcome: doctorTaskOutcome(projection),
		phase: doctorTaskPhase(projection),
		write_permission: "denied",
		...doctorTaskDiagnosisFields(projection, state),
		nextActionContext: doctorTerminalComposeContext(projection),
		...(projection.routed?.selectors
			? { nextActionSelectors: projection.routed.selectors }
			: {}),
		...doctorTaskIdentityFields(state, now),
		foreground_non_vault_work_allowed: true,
		next_action: doctorTaskContinuation(projection),
	});
}

/**
 * The public next-action union for a terminal Doctor Task, reconstructed from the
 * durable next-action carrier through the Next Safe Action rehydration owner. A
 * worker failure points at the preserved private receipt. A doctor result rehydrates
 * its persisted semantic id (e.g. inspect_doctor_task) into a real union with the
 * canonical compat id and the exact doctor_task_id-bound argv, with no cast through the
 * legacy action() path.
 */
function doctorTerminalNextAction(
	terminal: VaultGitDoctorTaskTerminal,
	taskId: string,
): VaultGitNextAction {
	if (terminal.kind === "observation_expired") {
		return DOCTOR_OBSERVATION_EXPIRED_CONTINUATION;
	}
	if (terminal.kind === "worker_failure") {
		return rehydrateVaultGitPersistedNextAction(terminal.nextAction.id);
	}
	return projectDoctorResultTerminalAction(terminal, taskId);
}

function projectDoctorResultTerminalAction(
	terminal: Extract<VaultGitDoctorTaskTerminal, { kind: "doctor_result" }>,
	taskId: string,
): VaultGitNextAction {
	const carrier = resolveVaultGitDoctorTerminalNextAction(terminal);
	// Stale-Lease Takeover row 2 (ADR-0002 U4): diagnosis emits run_doctor only
	// for the burned/missing-Takeover-Token evidence after Host Quarantine is
	// reconciled. A terminal Doctor Task never projects run_doctor; durable
	// recovery must not self-loop, so both persisted carriers continue to the
	// operator reattestation handoff instead.
	if (carrier.actionId === "run_doctor") {
		return isReconciledStaleLeaseTakeoverEvidence({
			actionId: carrier.actionId,
			finding: terminal.finding,
			changedState: terminal.changedState,
			repairAction: terminal.repairAction,
		})
			? projectVaultGitNextAction({ id: "reattest_stale_lease_takeover" })
			: rehydrateVaultGitPersistedNextAction("invalid_durable_route");
	}
	const selectors = doctorTerminalSelectors(terminal, taskId);
	if (carrier.kind === "semantic") {
		const actionId = carrier.actionId;
		if (!isVaultGitNextActionId(actionId)) {
			return rehydrateVaultGitPersistedNextAction(actionId, selectors);
		}
		return projectDoctorTerminalAction(actionId, terminal, selectors);
	}
	const actionId: VaultGitNextActionId = carrier.actionId;
	return projectDoctorTerminalAction(actionId, terminal, selectors);
}

function projectDoctorTerminalAction(
	actionId: VaultGitNextActionId,
	terminal: Extract<VaultGitDoctorTaskTerminal, { kind: "doctor_result" }>,
	selectors: VaultGitContinuationSelectors,
): VaultGitNextAction {
	return projectVaultGitNextAction({
		id: actionId,
		context: doctorTerminalActionContext(actionId, terminal),
		selectors,
	});
}

function doctorTerminalSelectors(
	terminal: Extract<VaultGitDoctorTaskTerminal, { kind: "doctor_result" }>,
	taskId: string,
): VaultGitContinuationSelectors {
	return {
		doctor_task_id: taskId,
		...(terminal.transactionId
			? { transaction_id: terminal.transactionId }
			: {}),
	};
}

function doctorTerminalActionContext(
	actionId: VaultGitNextActionId,
	terminal: Extract<VaultGitDoctorTaskTerminal, { kind: "doctor_result" }>,
): VaultGitContinuationContext {
	return {
		...doctorTaskNextActionContext(actionId),
		...(terminal.repairAction
			? { repair_action: terminal.repairAction }
			: {}),
	};
}

/**
 * The durable semantic identity of a terminal's persisted next-action carrier,
 * independent of current executability: a semantic carrier's id verbatim, a legacy
 * carrier's id through the Doctor Task identity split. Stamped into the nested
 * task_terminal_result when the outer continuation fails closed, so fail-closed
 * posture never erases the persisted semantic action.
 */
function doctorTerminalDurableSemanticId(
	terminal: VaultGitDoctorTaskTerminal,
): string {
	if (terminal.kind === "observation_expired") return "none";
	if (terminal.kind === "worker_failure") {
		return terminal.nextAction.id;
	}
	const carrier = resolveVaultGitDoctorTerminalNextAction(terminal);
	return carrier.kind === "semantic"
		? carrier.actionId
		: doctorTerminalSemanticId(carrier.actionId);
}

/**
 * Project the durable terminal into its public `task_terminal_result`, stamping the
 * semantic id already resolved by the caller: the projected union's action_id, or
 * the durable carrier's semantic id when the union failed closed (never
 * reprojecting, so there is no duplicate logic and no selector-less projection).
 * The durable record is untouched, so legacy history bytes remain unchanged.
 */
function projectDoctorTaskTerminal(
	terminal: VaultGitDoctorTaskTerminal,
	semanticId: string,
): VaultGitDoctorTaskTerminal {
	// The expiry record persists no next-action carrier, so it projects verbatim.
	if (terminal.kind === "observation_expired") return terminal;
	if (terminal.kind === "worker_failure") {
		return {
			...terminal,
			nextAction: {
				id: "inspect_private_receipt",
				summary: action("inspect_private_receipt").summary ?? "",
			},
		};
	}
	const { nextAction: _legacy, nextActionId: _semantic, ...base } = terminal;
	return { ...base, nextActionId: semanticId };
}

/**
 * Continuation context for an action id emitted from durable Doctor Task state.
 * Unlike engine transaction results, a Doctor Task's legacy inspect_status and
 * change_input split by Task kind to the Doctor Task continuations; retry_remote is
 * an inspect-time remote retry; run_repair carries its repair action through the
 * payload. This owner keeps Doctor Task projection distinct from transaction-state
 * projection.
 */
function doctorTaskNextActionContext(
	id: VaultGitNextActionId,
): VaultGitNextActionRef["context"] {
	const contexts: Partial<
		Record<VaultGitNextActionId, VaultGitNextActionRef["context"]>
	> = {
		inspect_status: { result_kind: "doctor_task" },
		change_input: { result_kind: "doctor_task" },
		retry_remote: { result_kind: "inspect" },
		escalate_validation_evidence: {
			escalation_condition: "validation_evidence_required",
		},
	};
	return contexts[id];
}

/**
 * Normalize an engine-emitted Doctor Task next-action id to the semantic identity a
 * NEW terminal write persists. This normalizes IDENTITY, not current executability:
 * it never proves the argv is buildable now (rehydration re-proves that, failing
 * closed when a selector is missing). The only normalization is the Doctor Task split
 * of the legacy contextual inspect_status to inspect_doctor_task; every other id
 * (e.g. run_repair) is an already-validated VaultGitNextActionId and is retained
 * verbatim. No generic fallback and no inferred argv.
 */
function doctorTerminalSemanticId(id: VaultGitNextActionId): string {
	return id === "inspect_status" ? "inspect_doctor_task" : id;
}
