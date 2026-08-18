export {
	VAULT_GIT_LAUNCH_ACK_WINDOW_MS,
	VAULT_GIT_TASK_HEARTBEAT_STALE_MS,
	reconcileClosedVaultGitTask,
	reconcileStaleVaultGitTaskFromDoctor,
	type VaultGitTaskClosureEvidence,
} from "./task-lifecycle.ts";
