import type { VaultGitDoctorResult } from "./doctor.ts";
import type {
	VaultGitBlockerId,
	VaultGitChangedState,
	VaultGitTaskState,
} from "./model.ts";
import type {
	VaultGitTaskClaimOrJoinInput,
	VaultGitTaskStore,
	VaultGitTaskTransitionFence,
} from "./task-store.ts";
import type { VaultGitTaskStateAdvanceInput } from "./task-state.ts";

/** Heartbeat age after which Doctor may investigate a dead task worker. */
export const VAULT_GIT_TASK_HEARTBEAT_STALE_MS = 20_000;

/**
 * Window within which a launched Attempt must be acknowledged before the launch
 * is treated as expired. Governs every site that opens, persists, or waits on
 * that interval. Distinct from the post-acknowledgement heartbeat-staleness
 * budget above: this fences the pre-acknowledgement launch, not a live worker.
 */
export const VAULT_GIT_LAUNCH_ACK_WINDOW_MS = 1_500;

/** Composition role selected once before Task Lifecycle dispatch. */
export type VaultGitTaskLifecycleRole = "launcher" | "worker";

/** Stable refusal vocabulary exposed by the Task Lifecycle boundary. */
export type VaultGitTaskLifecycleRefusalReason = Extract<
	VaultGitBlockerId,
	| "receipt_conflict"
	| "task_input_mismatch"
	| "capability_missing"
	| "worker_launch_protocol_failed"
	| "worker_launch_failed"
	| "worker_lost"
	| "human_required"
>;

/** Final Task Lifecycle decision consumed by envelope and worker adapters. */
export type VaultGitTaskLifecycleOutcome =
	| { readonly kind: "settled"; readonly state: VaultGitTaskState }
	| {
			readonly kind: "refused";
			readonly reason: VaultGitTaskLifecycleRefusalReason;
			readonly state?: VaultGitTaskState;
	  };

/** Launcher ownership decision retained between independently testable verbs. */
export type VaultGitTaskLifecycleAdmissionOutcome =
	| {
			readonly kind: "settled";
			readonly launch: "winner" | "joined";
			readonly state: VaultGitTaskState;
	  }
	| {
			readonly kind: "refused";
			readonly reason: VaultGitTaskLifecycleRefusalReason;
			readonly state?: VaultGitTaskState;
	  };

/** Process and monotonic-time effects required by launcher choreography. */
export interface VaultGitBackgroundCompletionRuntime<SpawnContext> {
	readonly now: () => number;
	readonly sleep: (milliseconds: number) => Promise<void>;
	readonly spawnWorker: (
		context: SpawnContext,
		receiptId: string,
		taskId: string,
		launchGeneration: string,
		args: readonly string[],
	) => number;
	readonly readProcessIdentity: (pid: number) => string;
	readonly stopUnacknowledgedWorker: (pid: number) => void;
	readonly stopExpiredWorker: (
		pid: number | null,
		expectedIdentity: string | null,
	) => Promise<boolean>;
}

/** Inputs shared by the independently reachable Task Lifecycle verbs. */
export interface VaultGitTaskLifecycleOptions<SpawnContext> {
	readonly role: VaultGitTaskLifecycleRole;
	readonly store: VaultGitTaskStore;
	readonly runtime: VaultGitBackgroundCompletionRuntime<SpawnContext>;
	readonly spawnContext: SpawnContext;
	/** Wall-clock source for durable timestamps; monotonic budgets use runtime.now. */
	readonly recordedAt: () => Date;
}

/** One foreground invocation admitted to the launcher choreography. */
export interface VaultGitTaskLifecycleLaunchInput {
	readonly admission: VaultGitTaskClaimOrJoinInput;
	readonly acknowledgementStartedAt: number;
	readonly createLaunchGeneration: () => string;
	readonly args: readonly string[];
}

/** Inputs that terminalize one exact Completion Task Attempt. */
export interface VaultGitTaskLifecycleTerminalizeInput {
	readonly taskId: string;
	readonly advance: VaultGitTaskStateAdvanceInput;
	readonly fence?: VaultGitTaskTransitionFence;
}

/** Pure Task Lifecycle verbs over injected durable and process ports. */
export interface VaultGitTaskLifecycle {
	/** Admit or join the receipt-scoped Completion Task. */
	admit(
		input: VaultGitTaskClaimOrJoinInput,
	): Promise<VaultGitTaskLifecycleAdmissionOutcome>;
	/** Recover one expired pre-acknowledgement launch without creating an Attempt. */
	recoverExpiredLaunch(
		outcome: VaultGitTaskLifecycleAdmissionOutcome,
	): Promise<VaultGitTaskLifecycleAdmissionOutcome>;
	/** Persist launch ownership, spawn the worker, then register its exact identity. */
	registerWorker(
		outcome: VaultGitTaskLifecycleAdmissionOutcome,
		launchGeneration: string,
		args: readonly string[],
	): Promise<VaultGitTaskLifecycleAdmissionOutcome>;
	/** Wait within the original Launch Acknowledgement Window. */
	acknowledge(
		state: VaultGitTaskState,
		acknowledgementDeadline: number,
	): Promise<VaultGitTaskLifecycleOutcome>;
	/** Terminalize the exact fenced Attempt through a bounded CAS loop. */
	terminalize(
		input: VaultGitTaskLifecycleTerminalizeInput,
	): Promise<VaultGitTaskLifecycleOutcome>;
	/** Drive launcher-side launch through acknowledgement. */
	launch(input: VaultGitTaskLifecycleLaunchInput): Promise<VaultGitTaskLifecycleOutcome>;
}

/**
 * Create the Task Lifecycle owner over explicit state, process, and clock ports.
 *
 * @param options - Role, durable store, runtime effects, and wall-clock source
 * @returns Independently reachable launcher and terminalization verbs
 * @throws {Error} When durable CAS contention exceeds the bounded retry budget
 * @internal
 */
export function createVaultGitTaskLifecycle<SpawnContext>(
	options: VaultGitTaskLifecycleOptions<SpawnContext>,
): VaultGitTaskLifecycle {
	async function admit(
		input: VaultGitTaskClaimOrJoinInput,
	): Promise<VaultGitTaskLifecycleAdmissionOutcome> {
		if (options.role !== "launcher") {
			return { kind: "refused", reason: "human_required" };
		}
		const admission = await options.store.claimOrJoin(input);
		if (admission.status === "refused") {
			return { kind: "refused", reason: admission.reason };
		}
		return {
			kind: "settled",
			launch: admission.state.state === "claimed" ? "winner" : admission.launch,
			state: admission.state,
		};
	}

	async function recoverExpiredLaunch(
		outcome: VaultGitTaskLifecycleAdmissionOutcome,
	): Promise<VaultGitTaskLifecycleAdmissionOutcome> {
		if (
			outcome.kind === "refused" ||
			outcome.launch !== "joined" ||
			outcome.state.state !== "launching"
		) {
			return outcome;
		}
		const launchExpiresAt =
			outcome.state.launchExpiresAt === null
				? Number.NaN
				: Date.parse(outcome.state.launchExpiresAt);
		const observedAt = options.recordedAt().getTime();
		if (
			!Number.isFinite(launchExpiresAt) ||
			!Number.isFinite(observedAt) ||
			launchExpiresAt > observedAt
		) {
			return outcome;
		}
		const stopped = await options.runtime.stopExpiredWorker(
			outcome.state.workerPid,
			outcome.state.workerProcessIdentity,
		);
		if (!stopped) return outcome;
		const state = outcome.state;
		const recoveredAt = new Date(observedAt).toISOString();
		const recovered = await options.store.transition(
			state.taskId,
			state.revision,
			state.launchAttempt < 2
				? {
						state: "claimed",
						phase: "admitted",
						updatedAt: recoveredAt,
						heartbeatAt: null,
						checkpoint: null,
						launchGeneration: null,
						launchExpiresAt: null,
						workerPid: null,
						workerProcessIdentity: null,
					}
				: {
						state: "repair_needed",
						phase: "terminal",
						updatedAt: recoveredAt,
						heartbeatAt: null,
						checkpoint: null,
						launchGeneration: state.launchGeneration,
						launchExpiresAt: null,
						workerPid: null,
						workerProcessIdentity: null,
						terminalResult: {
							outcome: "refused",
							phase: "blocked",
							changedState: "none",
							blocker: "worker_launch_protocol_failed",
							retrySafety: "operator_required",
						},
					},
		);
		return {
			kind: "settled",
			launch:
				recovered.status === "transitioned" && recovered.state.state === "claimed"
					? "winner"
					: "joined",
			state: recovered.state,
		};
	}

	async function terminalize(
		input: VaultGitTaskLifecycleTerminalizeInput,
	): Promise<VaultGitTaskLifecycleOutcome> {
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const current = await options.store.loadByTaskId(input.taskId);
			if (current.status !== "loaded") {
				return { kind: "refused", reason: "worker_lost" };
			}
			if (current.state.phase === "terminal") {
				return { kind: "settled", state: current.state };
			}
			// A superseded launch generation must never terminalize the attempt that
			// replaced it, so the fence refuses instead of retrying onto a new revision.
			if (
				input.fence?.expectedLaunchGeneration !== undefined &&
				current.state.launchGeneration !==
					input.fence.expectedLaunchGeneration
			) {
				return { kind: "refused", reason: "worker_lost" };
			}
			const transitioned = await options.store.transition(
				input.taskId,
				current.state.revision,
				input.advance,
				input.fence,
			);
			if (transitioned.status === "transitioned") {
				return { kind: "settled", state: transitioned.state };
			}
		}
		throw new Error("task terminal transition contention exceeded");
	}

	async function registerWorker(
		outcome: VaultGitTaskLifecycleAdmissionOutcome,
		launchGeneration: string,
		args: readonly string[],
	): Promise<VaultGitTaskLifecycleAdmissionOutcome> {
		if (outcome.kind === "refused" || outcome.launch !== "winner") {
			return outcome;
		}
		const launchedAt = options.recordedAt();
		const launching = await options.store.transition(
			outcome.state.taskId,
			outcome.state.revision,
			{
				state: "launching",
				phase: "admitted",
				updatedAt: launchedAt.toISOString(),
				heartbeatAt: null,
				checkpoint: null,
				launchGeneration,
				launchExpiresAt: new Date(
					launchedAt.getTime() + VAULT_GIT_LAUNCH_ACK_WINDOW_MS,
				).toISOString(),
				workerPid: null,
				workerProcessIdentity: null,
				launchAttempt: outcome.state.launchAttempt + 1,
			},
		);
		if (launching.status !== "transitioned") {
			return { kind: "settled", launch: "joined", state: launching.state };
		}
		let state = launching.state;
		let spawnedWorkerPid: number | null = null;
		try {
			spawnedWorkerPid = options.runtime.spawnWorker(
				options.spawnContext,
				state.receiptId,
				state.taskId,
				launchGeneration,
				args,
			);
			const workerPid = spawnedWorkerPid;
			const workerProcessIdentity =
				options.runtime.readProcessIdentity(workerPid);
			const registered = await options.store.transition(
				state.taskId,
				state.revision,
				{
					state: "launching",
					phase: "admitted",
					updatedAt: options.recordedAt().toISOString(),
					heartbeatAt: null,
					checkpoint: null,
					launchGeneration,
					launchExpiresAt: state.launchExpiresAt,
					workerPid,
					workerProcessIdentity,
				},
			);
			if (registered.status !== "transitioned") {
				options.runtime.stopUnacknowledgedWorker(workerPid);
				return {
					kind: "settled",
					launch: "joined",
					state: registered.state,
				};
			}
			spawnedWorkerPid = null;
			state = registered.state;
			return { kind: "settled", launch: "winner", state };
		} catch {
			if (spawnedWorkerPid !== null) {
				options.runtime.stopUnacknowledgedWorker(spawnedWorkerPid);
			}
			const terminal = await terminalize({
				taskId: state.taskId,
				advance: {
					state: "repair_needed",
					phase: "terminal",
					updatedAt: options.recordedAt().toISOString(),
					heartbeatAt: null,
					checkpoint: null,
					launchGeneration,
					launchExpiresAt: null,
					workerPid: null,
					workerProcessIdentity: null,
					terminalResult: {
						outcome: "refused",
						phase: "blocked",
						changedState: "none",
						blocker: "worker_launch_failed",
						retrySafety: "operator_required",
					},
				},
				fence: { expectedLaunchGeneration: launchGeneration },
			});
			if (terminal.kind === "settled") {
				return { kind: "settled", launch: "joined", state: terminal.state };
			}
			const current = await options.store.loadByTaskId(state.taskId);
			return {
				kind: "refused",
				reason: "worker_launch_failed",
				...(current.status === "loaded" ? { state: current.state } : {}),
			};
		}
	}

	async function acknowledge(
		initialState: VaultGitTaskState,
		acknowledgementDeadline: number,
	): Promise<VaultGitTaskLifecycleOutcome> {
		let state = initialState;
		while (
			state.state !== "in_progress" &&
			options.runtime.now() < acknowledgementDeadline
		) {
			await options.runtime.sleep(10);
			const current = await options.store.loadByTaskId(state.taskId);
			if (current.status !== "loaded") break;
			state = current.state;
			if (state.state === "repair_needed" || state.state === "unknown") break;
		}
		if (state.phase === "terminal" || state.state === "in_progress") {
			return { kind: "settled", state };
		}
		return {
			kind: "refused",
			reason: "worker_launch_protocol_failed",
			state,
		};
	}

	async function launch(
		input: VaultGitTaskLifecycleLaunchInput,
	): Promise<VaultGitTaskLifecycleOutcome> {
		// One foreground budget covers receipt loading, stale-launch recovery,
		// replacement launch, and acknowledgement. Recovery must not reset it.
		const acknowledgementDeadline =
			input.acknowledgementStartedAt + VAULT_GIT_LAUNCH_ACK_WINDOW_MS;
		const admission = await admit(input.admission);
		if (admission.kind === "refused") return admission;
		const recovered = await recoverExpiredLaunch(admission);
		if (recovered.kind === "refused") return recovered;
		const registered =
			recovered.launch === "winner"
				? await registerWorker(
						recovered,
						input.createLaunchGeneration(),
						input.args,
					)
				: recovered;
		if (registered.kind === "refused") return registered;
		return acknowledge(registered.state, acknowledgementDeadline);
	}

	return Object.freeze({
		admit,
		recoverExpiredLaunch,
		registerWorker,
		acknowledge,
		terminalize,
		launch,
	});
}

/** Evidence already classified by the existing Doctor or repair owner. */
export interface VaultGitTaskClosureEvidence {
	readonly receiptId: string;
	readonly transactionId: string;
	readonly changedState: VaultGitChangedState;
	readonly recordedAt: string;
}

/**
 * Close the matching task after an existing owner proves transaction closure.
 * This writes task evidence only. It never launches work or grants authority.
 */
export async function reconcileClosedVaultGitTask(
	store: VaultGitTaskStore,
	evidence: VaultGitTaskClosureEvidence,
): Promise<void> {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const loaded = await store.materializeClaimState(
			evidence.receiptId,
			evidence.transactionId,
		);
		if (loaded.status !== "loaded") return;
		if (loaded.state.transactionId !== evidence.transactionId) return;
		if (loaded.state.state === "closed") return;
		const transitioned = await store.transition(
			loaded.state.taskId,
			loaded.state.revision,
			{
				state: "closed",
				phase: "terminal",
				updatedAt: evidence.recordedAt,
				heartbeatAt: loaded.state.heartbeatAt,
				checkpoint: "closed",
				launchGeneration: loaded.state.launchGeneration,
				launchExpiresAt: null,
				terminalResult: {
					outcome: "completed",
					phase: "closed",
					changedState: evidence.changedState,
					blocker: null,
					retrySafety: "same_input_safe",
				},
			},
		);
		if (transitioned.status === "transitioned") return;
	}
	throw new Error("task closure reconciliation contention exceeded");
}

/**
 * Fail closed a stale acknowledged task from fresh Doctor evidence.
 * Heartbeat age selects the task for diagnosis. Doctor owns the classification.
 */
export async function reconcileStaleVaultGitTaskFromDoctor(
	store: VaultGitTaskStore,
	receiptId: string,
	evidence: VaultGitDoctorResult,
	recordedAt: string,
	workerIsAlive: (pid: number | null) => boolean = () => true,
): Promise<void> {
	if (!evidence.transactionId) return;
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const loaded = await store.load(receiptId);
		if (loaded.status !== "loaded") return;
		// An unparsable timestamp yields NaN, and every NaN comparison is false.
		// Without the finite check the staleness guard would fail open and
		// terminalize a live worker as lost.
		const observedAt = Date.parse(recordedAt);
		const heartbeatAt =
			loaded.state.heartbeatAt === null
				? Number.NaN
				: Date.parse(loaded.state.heartbeatAt);
		if (
			loaded.state.transactionId !== evidence.transactionId ||
			loaded.state.state !== "in_progress" ||
			workerIsAlive(loaded.state.workerPid) ||
			!Number.isFinite(observedAt) ||
			!Number.isFinite(heartbeatAt) ||
			observedAt - heartbeatAt <= VAULT_GIT_TASK_HEARTBEAT_STALE_MS
		)
			return;
		const unknown =
			evidence.state === "unknown" || evidence.phase === "push_pending";
		const transitioned = await store.transition(
			loaded.state.taskId,
			loaded.state.revision,
			{
				state: unknown ? "unknown" : "repair_needed",
				phase: "terminal",
				updatedAt: recordedAt,
				heartbeatAt: loaded.state.heartbeatAt,
				checkpoint: evidence.phase,
				launchGeneration: loaded.state.launchGeneration,
				launchExpiresAt: null,
				terminalResult: {
					outcome: "refused",
					phase: evidence.phase,
					changedState: evidence.changedState,
					blocker: "worker_lost",
					retrySafety: "operator_required",
				},
			},
		);
		if (transitioned.status === "transitioned") return;
	}
	throw new Error("task Doctor reconciliation contention exceeded");
}
