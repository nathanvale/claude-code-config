import type { VaultGitDoctorResult } from "./doctor.ts";
import type { VaultGitChangedState } from "./model.ts";
import type { VaultGitTaskStore } from "./task-store.ts";

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
		const loaded = await store.load(evidence.receiptId);
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
		if (
			loaded.state.transactionId !== evidence.transactionId ||
			loaded.state.state !== "in_progress" ||
			workerIsAlive(loaded.state.workerPid) ||
			loaded.state.heartbeatAt === null ||
			Date.parse(recordedAt) - Date.parse(loaded.state.heartbeatAt) <= 20_000
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
