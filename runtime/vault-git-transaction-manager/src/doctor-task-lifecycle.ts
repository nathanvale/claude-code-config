import {
	isVaultGitDoctorTaskWorkerLost,
	type VaultGitDoctorTaskBindingInput,
	type VaultGitDoctorTaskState,
	type VaultGitDoctorTaskTerminal,
} from "./doctor-task-state.ts";
import type { VaultGitDoctorTaskStore } from "./doctor-task-store.ts";

/** One Launch Acknowledgement Window for every Background Doctor launch site. */
export const VAULT_GIT_DOCTOR_LAUNCH_ACK_WINDOW_MS = 1_500;

/** Observational heartbeat age after which process identity must be checked. */
export const VAULT_GIT_DOCTOR_TASK_HEARTBEAT_STALE_MS = 20_000;

/**
 * The single package-owned bound on observing one nonterminal Doctor Task,
 * measured from durable admission. Heartbeats never renew it: an acknowledged
 * worker that keeps beating past this bound still loses canonical authority, so
 * bounded observation always terminalizes instead of polling forever.
 */
export const VAULT_GIT_DOCTOR_TASK_OBSERVATION_EXPIRY_MS = 10 * 60_000;

/** Stable refusal vocabulary returned by the Background Doctor lifecycle. */
export type VaultGitDoctorTaskLifecycleRefusalReason =
	| "task_input_mismatch"
	| "worker_launch_protocol_failed"
	| "worker_launch_failed"
	| "worker_lost";

/** Final lifecycle decision consumed by the CLI and worker adapters. */
export type VaultGitDoctorTaskLifecycleOutcome =
	| { readonly kind: "settled"; readonly state: VaultGitDoctorTaskState }
	| {
			readonly kind: "refused";
			readonly reason: VaultGitDoctorTaskLifecycleRefusalReason;
			readonly state: VaultGitDoctorTaskState;
	  };

/** Process and monotonic-time effects required by Doctor launch choreography. */
export interface VaultGitBackgroundDoctorRuntime<SpawnContext> {
	/** Monotonic milliseconds used only for bounded foreground waits. */
	readonly now: () => number;
	/** Wall-clock source for durable timestamps. */
	readonly recordedAt: () => Date;
	/** Yield before the next durable acknowledgement observation. */
	readonly sleep: (milliseconds: number) => Promise<void>;
	/** Spawn one detached worker for the exact task and generation. */
	readonly spawnWorker: (
		context: SpawnContext,
		taskId: string,
		launchGeneration: string,
		args: readonly string[],
	) => number;
	/** Bind a persisted worker PID to its process start identity. */
	readonly readProcessIdentity: (pid: number) => string;
	/** Stop a spawned worker that lost durable registration. */
	readonly stopUnacknowledgedWorker: (pid: number) => void;
	/** Stop one exact expired pre-acknowledgement worker. */
	readonly stopExpiredWorker: (
		pid: number | null,
		expectedIdentity: string | null,
	) => Promise<boolean>;
	/** Prove that a persisted PID still names the same live process. */
	readonly processIdentityMatches: (pid: number, identity: string) => boolean;
}

/** Inputs required to compose the Doctor lifecycle over durable and process ports. */
export interface VaultGitDoctorTaskLifecycleOptions<SpawnContext> {
	/** Owner-private Doctor Task store. */
	readonly store: VaultGitDoctorTaskStore;
	/** Injected process and clock effects. */
	readonly runtime: VaultGitBackgroundDoctorRuntime<SpawnContext>;
	/** Opaque composition context passed only to the spawn adapter. */
	readonly spawnContext: SpawnContext;
}

/** One foreground Doctor invocation admitted to lifecycle choreography. */
export interface VaultGitDoctorTaskLifecycleLaunchInput {
	/** Exact repository, activation, receipt, transaction, and input binding. */
	readonly binding: VaultGitDoctorTaskBindingInput;
	/** Monotonic start captured before foreground classification. */
	readonly acknowledgementStartedAt: number;
	/** Generator for one opaque launch generation. */
	readonly createLaunchGeneration: () => string;
	/** Public Doctor arguments forwarded to the detached worker. */
	readonly args: readonly string[];
}

/** Exact worker identity required before authoritative Doctor entry. */
export interface VaultGitDoctorTaskWorkerAcknowledgementInput {
	/** Opaque Doctor Task identifier. */
	readonly taskId: string;
	/** Launch generation persisted by the foreground winner. */
	readonly launchGeneration: string;
	/** PID of the detached worker requesting acknowledgement. */
	readonly workerPid: number;
}

/** Exact worker result permitted to terminalize one acknowledged generation. */
export interface VaultGitDoctorTaskWorkerTerminalInput {
	/** Opaque Doctor Task identifier. */
	readonly taskId: string;
	/** Launch generation durably acknowledged by this worker. */
	readonly launchGeneration: string;
	/** PID of the acknowledged worker publishing the result. */
	readonly workerPid: number;
	/** Sanitized Doctor or worker-failure result. */
	readonly terminalResult: VaultGitDoctorTaskTerminal;
}

/** One selected task eligible for observational stale-worker reconciliation. */
export interface VaultGitDoctorTaskReconciliationInput {
	/** Opaque Doctor Task identifier. */
	readonly taskId: string;
}

/** Doctor-specific owner of task admission, launch, and durable acknowledgement. */
export interface VaultGitDoctorTaskLifecycle {
	/** Admit or join one task and return only after durable worker acknowledgement. */
	launch(
		input: VaultGitDoctorTaskLifecycleLaunchInput,
	): Promise<VaultGitDoctorTaskLifecycleOutcome>;
	/** Fence and durably acknowledge one exact registered worker generation. */
	acknowledgeWorker(
		input: VaultGitDoctorTaskWorkerAcknowledgementInput,
	): Promise<VaultGitDoctorTaskLifecycleOutcome>;
	/** Refresh observational liveness for one exact acknowledged worker generation. */
	heartbeatWorker(
		input: VaultGitDoctorTaskWorkerAcknowledgementInput,
	): Promise<VaultGitDoctorTaskLifecycleOutcome>;
	/** Preserve live workers and terminalize only a proven dead stale worker. */
	reconcileStaleWorker(
		input: VaultGitDoctorTaskReconciliationInput,
	): Promise<VaultGitDoctorTaskLifecycleOutcome>;
	/** Terminalize one nonterminal task whose bounded observation window elapsed. */
	reconcileObservationExpiry(
		input: VaultGitDoctorTaskReconciliationInput,
	): Promise<VaultGitDoctorTaskLifecycleOutcome>;
	/** Fence and terminalize one exact acknowledged worker generation. */
	terminalizeWorker(
		input: VaultGitDoctorTaskWorkerTerminalInput,
	): Promise<VaultGitDoctorTaskLifecycleOutcome>;
}

/**
 * Create the Doctor-specific lifecycle without merging Completion Task vocabulary.
 *
 * @param options - Durable store, process runtime, spawn context, and wall clock
 * @returns One lifecycle Interface for foreground Doctor launch choreography
 * @throws {Error} When durable task state cannot be loaded or published
 * @internal
 */
export function createVaultGitDoctorTaskLifecycle<SpawnContext>(
	options: VaultGitDoctorTaskLifecycleOptions<SpawnContext>,
): VaultGitDoctorTaskLifecycle {
	async function reconcileStaleWorker(
		input: VaultGitDoctorTaskReconciliationInput,
	): Promise<VaultGitDoctorTaskLifecycleOutcome> {
		for (let contentionPass = 0; contentionPass < 5; contentionPass += 1) {
			const loaded = await options.store.loadByTaskId(input.taskId);
			if (loaded.status !== "loaded") {
				throw new Error("Background Doctor task unavailable");
			}
			const state = loaded.state;
			const now = options.runtime.recordedAt();
			if (
				!isVaultGitDoctorTaskWorkerLost(
					state,
					now.getTime(),
					VAULT_GIT_DOCTOR_TASK_HEARTBEAT_STALE_MS,
					options.runtime.processIdentityMatches,
				)
			) {
				return { kind: "settled", state };
			}
			const transitioned = await options.store.transition(
				state.taskId,
				state.revision,
				{
					state: "unknown",
					phase: "terminal",
					updatedAt: now.toISOString(),
					heartbeatAt: state.heartbeatAt,
					checkpoint: "terminal",
					launchGeneration: state.launchGeneration,
					launchExpiresAt: null,
					workerPid: null,
					workerProcessIdentity: null,
					launchAttempt: state.launchAttempt,
					terminalResult: {
						kind: "worker_failure",
						blocker: "worker_lost",
						retrySafety: "operator_required",
						nextAction: {
							id: "inspect_private_receipt",
							summary:
								"Inspect the preserved Background Doctor evidence before repair.",
						},
					},
				},
				state.launchGeneration ?? undefined,
			);
			if (transitioned.status === "transitioned") {
				return { kind: "settled", state: transitioned.state };
			}
		}
		throw new Error("Background Doctor task reconciliation contention");
	}

	async function reconcileObservationExpiry(
		input: VaultGitDoctorTaskReconciliationInput,
	): Promise<VaultGitDoctorTaskLifecycleOutcome> {
		for (let contentionPass = 0; contentionPass < 5; contentionPass += 1) {
			const loaded = await options.store.loadByTaskId(input.taskId);
			if (loaded.status !== "loaded") {
				throw new Error("Background Doctor task unavailable");
			}
			const state = loaded.state;
			const now = options.runtime.recordedAt();
			if (
				state.phase === "terminal" ||
				now.getTime() <
					Date.parse(state.recordedAt) +
						VAULT_GIT_DOCTOR_TASK_OBSERVATION_EXPIRY_MS
			) {
				return { kind: "settled", state };
			}
			const transitioned = await options.store.transition(
				state.taskId,
				state.revision,
				{
					state: "unknown",
					phase: "terminal",
					updatedAt: now.toISOString(),
					heartbeatAt: state.heartbeatAt,
					checkpoint: "terminal",
					launchGeneration: state.launchGeneration,
					launchExpiresAt: null,
					// Clearing observational identity is what fences a late worker: the
					// exact PID/identity it must match to terminalize is gone, so it can
					// no longer replace this durable terminal result.
					workerPid: null,
					workerProcessIdentity: null,
					launchAttempt: state.launchAttempt,
					terminalResult: {
						// Not worker_failure: that kind claims a proven-dead worker, while
						// an expired observation may still have a live process that only
						// lost canonical authority. Persisting no nextAction keeps the
						// public projection deterministic instead of carrier-dependent.
						kind: "observation_expired",
						blocker: "continuation_unavailable",
						retrySafety: "operator_required",
					},
				},
				state.launchGeneration ?? undefined,
			);
			if (transitioned.status === "transitioned") {
				return { kind: "settled", state: transitioned.state };
			}
		}
		throw new Error("Background Doctor task observation expiry contention");
	}

	async function heartbeatWorker(
		input: VaultGitDoctorTaskWorkerAcknowledgementInput,
	): Promise<VaultGitDoctorTaskLifecycleOutcome> {
		for (let contentionPass = 0; contentionPass < 5; contentionPass += 1) {
			const loaded = await options.store.loadByTaskId(input.taskId);
			if (loaded.status !== "loaded") {
				throw new Error("Background Doctor task unavailable");
			}
			const state = loaded.state;
			if (
				state.state !== "in_progress" ||
				state.launchGeneration !== input.launchGeneration ||
				state.workerPid !== input.workerPid
			) {
				return { kind: "refused", reason: "worker_lost", state };
			}
			const heartbeatAt = options.runtime.recordedAt().toISOString();
			const transitioned = await options.store.transition(
				state.taskId,
				state.revision,
				{
					state: "in_progress",
					phase: "running",
					updatedAt: heartbeatAt,
					heartbeatAt,
					checkpoint: state.checkpoint,
					launchGeneration: input.launchGeneration,
					launchExpiresAt: null,
					workerPid: input.workerPid,
					workerProcessIdentity: state.workerProcessIdentity,
					launchAttempt: state.launchAttempt,
					terminalResult: null,
				},
				input.launchGeneration,
			);
			if (transitioned.status === "transitioned") {
				return { kind: "settled", state: transitioned.state };
			}
		}
		throw new Error("Background Doctor task heartbeat contention");
	}

	async function terminalizeWorker(
		input: VaultGitDoctorTaskWorkerTerminalInput,
	): Promise<VaultGitDoctorTaskLifecycleOutcome> {
		for (let contentionPass = 0; contentionPass < 5; contentionPass += 1) {
			const loaded = await options.store.loadByTaskId(input.taskId);
			if (loaded.status !== "loaded") {
				throw new Error("Background Doctor task unavailable");
			}
			const state = loaded.state;
			if (
				state.launchGeneration !== input.launchGeneration ||
				state.workerPid !== input.workerPid
			) {
				return { kind: "refused", reason: "worker_lost", state };
			}
			if (state.phase === "terminal") {
				return { kind: "settled", state };
			}
			if (state.state !== "in_progress") {
				return { kind: "refused", reason: "worker_lost", state };
			}
			const terminalAt = options.runtime.recordedAt().toISOString();
			const transitioned = await options.store.transition(
				state.taskId,
				state.revision,
				{
					state:
						input.terminalResult.kind === "doctor_result" ? "closed" : "unknown",
					phase: "terminal",
					updatedAt: terminalAt,
					heartbeatAt: terminalAt,
					checkpoint: "terminal",
					launchGeneration: input.launchGeneration,
					launchExpiresAt: null,
					workerPid: input.workerPid,
					workerProcessIdentity: state.workerProcessIdentity,
					launchAttempt: state.launchAttempt,
					terminalResult: input.terminalResult,
				},
				input.launchGeneration,
			);
			if (transitioned.status === "transitioned") {
				return { kind: "settled", state: transitioned.state };
			}
		}
		throw new Error("Background Doctor task terminalization contention");
	}

	async function acknowledgeWorker(
		input: VaultGitDoctorTaskWorkerAcknowledgementInput,
	): Promise<VaultGitDoctorTaskLifecycleOutcome> {
		let loaded = await options.store.loadByTaskId(input.taskId);
		if (loaded.status !== "loaded") {
			throw new Error("Background Doctor task unavailable");
		}
		while (
			loaded.state.state === "launching" &&
			loaded.state.launchGeneration === input.launchGeneration &&
			loaded.state.workerPid === null &&
			loaded.state.launchExpiresAt !== null &&
			options.runtime.recordedAt().getTime() <
				Date.parse(loaded.state.launchExpiresAt)
		) {
			await options.runtime.sleep(10);
			loaded = await options.store.loadByTaskId(input.taskId);
			if (loaded.status !== "loaded") {
				throw new Error("Background Doctor task unavailable");
			}
		}
		const state = loaded.state;
		if (
			state.launchGeneration !== input.launchGeneration ||
			state.workerPid !== input.workerPid ||
			state.workerProcessIdentity === null
		) {
			return { kind: "refused", reason: "worker_lost", state };
		}
		if (state.state === "in_progress") {
			return { kind: "settled", state };
		}
		if (state.state !== "launching") {
			return { kind: "refused", reason: "worker_lost", state };
		}
		const acknowledgedAt = options.runtime.recordedAt().toISOString();
		const acknowledged = await options.store.transition(
			state.taskId,
			state.revision,
			{
				state: "in_progress",
				phase: "running",
				updatedAt: acknowledgedAt,
				heartbeatAt: acknowledgedAt,
				checkpoint: "checking_remote",
				launchGeneration: input.launchGeneration,
				launchExpiresAt: null,
				workerPid: input.workerPid,
				workerProcessIdentity: state.workerProcessIdentity,
				launchAttempt: state.launchAttempt,
				terminalResult: null,
			},
			input.launchGeneration,
		);
		if (
			acknowledged.state.state === "in_progress" &&
			acknowledged.state.launchGeneration === input.launchGeneration &&
			acknowledged.state.workerPid === input.workerPid
		) {
			return { kind: "settled", state: acknowledged.state };
		}
		return {
			kind: "refused",
			reason: "worker_lost",
			state: acknowledged.state,
		};
	}

	async function launch(
		input: VaultGitDoctorTaskLifecycleLaunchInput,
	): Promise<VaultGitDoctorTaskLifecycleOutcome> {
		const admitted = await options.store.claimOrJoin(
			input.binding,
			options.runtime.recordedAt().toISOString(),
		);
		if (admitted.launch === "refused") {
			return {
				kind: "refused",
				reason: admitted.reason ?? "task_input_mismatch",
				state: admitted.state,
			};
		}

		let state = admitted.state;
		let launchWinner = admitted.launch === "winner" || state.state === "claimed";
		if (
			!launchWinner &&
			state.state === "launching" &&
			state.launchExpiresAt !== null &&
			Date.parse(state.launchExpiresAt) <=
				options.runtime.recordedAt().getTime()
		) {
			const stopped = await options.runtime.stopExpiredWorker(
				state.workerPid,
				state.workerProcessIdentity,
			);
			if (stopped) {
				const recoveredAt = options.runtime.recordedAt().toISOString();
				const recovered = await options.store.transition(
					state.taskId,
					state.revision,
					state.launchAttempt < 2
						? {
								state: "claimed",
								phase: "admitted",
								updatedAt: recoveredAt,
								heartbeatAt: null,
								checkpoint: "local_classified",
								launchGeneration: null,
								launchExpiresAt: null,
								workerPid: null,
								workerProcessIdentity: null,
								launchAttempt: state.launchAttempt,
								terminalResult: null,
							}
						: {
								state: "unknown",
								phase: "terminal",
								updatedAt: recoveredAt,
								heartbeatAt: state.heartbeatAt,
								checkpoint: "terminal",
								launchGeneration: state.launchGeneration,
								launchExpiresAt: null,
								workerPid: null,
								workerProcessIdentity: null,
								launchAttempt: state.launchAttempt,
								terminalResult: {
									kind: "worker_failure",
									blocker: "worker_launch_protocol_failed",
									retrySafety: "operator_required",
									nextAction: {
										id: "inspect_private_receipt",
										summary:
											"Inspect the exhausted Background Doctor launch evidence.",
									},
								},
							},
					state.launchGeneration,
				);
				state = recovered.state;
				launchWinner =
					recovered.status === "transitioned" && state.state === "claimed";
			}
		}
		if (launchWinner) {
			const launchGeneration = input.createLaunchGeneration();
			const launchedAt = options.runtime.recordedAt();
			const launching = await options.store.transition(state.taskId, state.revision, {
				state: "launching",
				phase: "admitted",
				updatedAt: launchedAt.toISOString(),
				heartbeatAt: null,
				checkpoint: "local_classified",
				launchGeneration,
				launchExpiresAt: new Date(
					launchedAt.getTime() + VAULT_GIT_DOCTOR_LAUNCH_ACK_WINDOW_MS,
				).toISOString(),
				workerPid: null,
				workerProcessIdentity: null,
				launchAttempt: state.launchAttempt + 1,
				terminalResult: null,
			});
			state = launching.state;
			if (launching.status === "transitioned") {
				let pid: number;
				try {
					pid = options.runtime.spawnWorker(
						options.spawnContext,
						state.taskId,
						launchGeneration,
						input.args,
					);
				} catch {
					return { kind: "refused", reason: "worker_launch_failed", state };
				}
				let registered: Awaited<
					ReturnType<typeof options.store.transition>
				>;
				try {
					const workerProcessIdentity = options.runtime.readProcessIdentity(pid);
					registered = await options.store.transition(state.taskId, state.revision, {
						state: "launching",
						phase: "admitted",
						updatedAt: options.runtime.recordedAt().toISOString(),
						heartbeatAt: null,
						checkpoint: "local_classified",
						launchGeneration,
						launchExpiresAt: state.launchExpiresAt,
						workerPid: pid,
						workerProcessIdentity,
						launchAttempt: state.launchAttempt,
						terminalResult: null,
					});
				} catch (error) {
					try {
						options.runtime.stopUnacknowledgedWorker(pid);
					} catch {
						// Preserve the registration failure as the authoritative cause.
					}
					throw error;
				}
				if (registered.status !== "transitioned") {
					options.runtime.stopUnacknowledgedWorker(pid);
				}
				state = registered.state;
			}
		}

		const acknowledgementDeadline =
			input.acknowledgementStartedAt + VAULT_GIT_DOCTOR_LAUNCH_ACK_WINDOW_MS;
		while (
			state.state !== "in_progress" &&
			state.phase !== "terminal" &&
			options.runtime.now() < acknowledgementDeadline
		) {
			await options.runtime.sleep(10);
			const loaded = await options.store.loadByTaskId(state.taskId);
			if (loaded.status !== "loaded") {
				return { kind: "refused", reason: "worker_lost", state };
			}
			state = loaded.state;
		}
		if (state.state !== "in_progress" && state.phase !== "terminal") {
			return {
				kind: "refused",
				reason: "worker_launch_protocol_failed",
				state,
			};
		}
		return { kind: "settled", state };
	}

	return {
		launch,
		acknowledgeWorker,
		heartbeatWorker,
		reconcileStaleWorker,
		reconcileObservationExpiry,
		terminalizeWorker,
	};
}
