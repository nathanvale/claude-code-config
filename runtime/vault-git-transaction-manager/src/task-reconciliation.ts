import type { VaultGitDoctorResult } from "./doctor.ts";
import type { VaultGitChangedState } from "./model.ts";
import type { VaultGitTaskStore } from "./task-store.ts";

/** Heartbeat age after which Doctor may investigate a dead task worker. */
export const VAULT_GIT_TASK_HEARTBEAT_STALE_MS = 20_000;

/**
 * Window within which a launched Attempt must be acknowledged before the launch
 * is treated as expired. Governs every site that opens, persists, or waits on
 * that interval. Distinct from the post-acknowledgement heartbeat-staleness
 * budget above: this fences the pre-acknowledgement launch, not a live worker.
 */
export const VAULT_GIT_LAUNCH_ACK_WINDOW_MS = 1_500;

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
			loaded.state.heartbeatAt === null ? Number.NaN : Date.parse(loaded.state.heartbeatAt);
		if (
			loaded.state.transactionId !== evidence.transactionId ||
			loaded.state.state !== "in_progress" ||
			workerIsAlive(loaded.state.workerPid) ||
			!Number.isFinite(observedAt) ||
			!Number.isFinite(heartbeatAt) ||
			observedAt - heartbeatAt <= VAULT_GIT_TASK_HEARTBEAT_STALE_MS
		) return;
		const unknown = evidence.state === "unknown" || evidence.phase === "push_pending";
		const transitioned = await store.transition(loaded.state.taskId, loaded.state.revision, {
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
		});
		if (transitioned.status === "transitioned") return;
	}
	throw new Error("task Doctor reconciliation contention exceeded");
}
