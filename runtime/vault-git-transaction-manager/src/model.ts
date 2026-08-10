/** Event classes that may own one meaningful vault transaction. */
export const VAULT_GIT_EVENT_TYPES = [
	"project_created",
	"goal_changed",
	"scope_changed",
	"owner_changed",
	"decision_accepted",
	"decision_superseded",
	"note_created",
	"document_completed",
	"document_moved",
	"document_renamed",
	"document_archived",
	"document_deleted",
	"handoff_created",
	"work_completed",
	"work_reopened",
	"hygiene",
] as const;

/** One meaningful vault event class. */
export type VaultGitEventType = (typeof VAULT_GIT_EVENT_TYPES)[number];

/** Durable and terminal transaction phases. */
export const VAULT_GIT_TRANSACTION_PHASES = [
	"unavailable",
	"inspecting",
	"intent_durable",
	"leased",
	"writing",
	"checking",
	"committing",
	"push_pending",
	"repairable",
	"human_required",
	"blocked",
	"closed",
] as const;

/** Current transaction lifecycle phase. */
export type VaultGitTransactionPhase =
	(typeof VAULT_GIT_TRANSACTION_PHASES)[number];

/** Authority granted to the current caller. */
export const VAULT_GIT_WRITE_PERMISSIONS = ["denied", "join", "owner"] as const;

/** Current caller write authority. */
export type VaultGitWritePermission =
	(typeof VAULT_GIT_WRITE_PERMISSIONS)[number];

/** Observable mutation extent for one command result. */
export const VAULT_GIT_CHANGED_STATES = [
	"none",
	"local",
	"remote",
	"committed",
	"partial",
] as const;

/** Observable mutation extent for one command result. */
export type VaultGitChangedState = (typeof VAULT_GIT_CHANGED_STATES)[number];

/** Same-input retry classification. */
export const VAULT_GIT_RETRY_SAFETIES = [
	"same_input_safe",
	"same_input_unsafe",
	"operator_required",
] as const;

/** Safety of retrying the exact same input. */
export type VaultGitRetrySafety = (typeof VAULT_GIT_RETRY_SAFETIES)[number];

/** Stable blocker vocabulary shared by status, doctor, repair, and Janitor. */
export const VAULT_GIT_BLOCKER_IDS = [
	"runtime_unavailable",
	"vault_unconfigured",
	"remote_unavailable",
	"main_behind",
	"main_ahead",
	"main_diverged",
	"push_pending",
	"lease_active",
	"lease_stale",
	"ledger_malformed",
	"lease_generation_stale",
	"lease_owner_unknown",
	"remote_moved",
	"receipt_conflict",
	"host_contract_breach",
	"human_required",
] as const;

/** Stable transaction blocker id. */
export type VaultGitBlockerId = (typeof VAULT_GIT_BLOCKER_IDS)[number];

/** Deterministic repair actions the runtime may classify. */
export const VAULT_GIT_REPAIR_ACTIONS = [
	"resume",
	"restore",
	"retry-push",
	"close-verified",
	"replay",
	"stale-lease-takeover",
	"reconcile-quarantine",
] as const;

/** One package-owned deterministic repair action. */
export type VaultGitRepairAction = (typeof VAULT_GIT_REPAIR_ACTIONS)[number];

/** Stable lifecycle result outcomes. */
export const VAULT_GIT_RESULT_OUTCOMES = [
	"read_only",
	"discovered",
	"unavailable",
	"invalid_usage",
	"admitted",
	"joined",
	"completed",
	"repaired",
	"refused",
] as const;

/** One package-owned lifecycle result outcome. */
export type VaultGitResultOutcome = (typeof VAULT_GIT_RESULT_OUTCOMES)[number];

/** Stable next-action ids emitted by the U1 command surface. */
export const VAULT_GIT_NEXT_ACTION_IDS = [
	"wait_for_runtime",
	"inspect_status",
	"inspect_commands",
	"change_input",
] as const;

/** One safe continuation selected for the current result. */
export type VaultGitNextActionId = (typeof VAULT_GIT_NEXT_ACTION_IDS)[number];

/** Exact remote branch used as the append-only lease sequencer. */
export const VAULT_GIT_LEDGER_REF =
	"refs/heads/vault-system/transaction-ledger" as const;

/** Schema version for package-owned JSON results. */
export const VAULT_GIT_SCHEMA_VERSION = "1" as const;

/** Lifecycle result contract id. */
export const VAULT_GIT_RESULT_CONTRACT_ID =
	"vault-git.lifecycle-result" as const;

/** Machine command-discovery result contract id. */
export const VAULT_GIT_COMMANDS_CONTRACT_ID =
	"vault-git.command-discovery" as const;

/** Exactly one safe continuation for a command result. */
export interface VaultGitNextAction {
	/** Stable action id. */
	readonly id: VaultGitNextActionId;
	/** Concise, safe action meaning. */
	readonly summary: string;
}

/** Package-owned lifecycle payload before facade result metadata is attached. */
export interface VaultGitLifecycleResultPayload {
	/** Public command that produced the result. */
	readonly command: string;
	/** Stable package outcome. */
	readonly outcome: VaultGitResultOutcome;
	/** Current transaction phase. */
	readonly phase: VaultGitTransactionPhase;
	/** Current caller write authority. */
	readonly write_permission: VaultGitWritePermission;
	/** Observable state change made by this invocation. */
	readonly changed_state: VaultGitChangedState;
	/** Safety of an exact same-input retry. */
	readonly retry_safety: VaultGitRetrySafety;
	/** Stable blockers with no private evidence or paths. */
	readonly blockers: readonly VaultGitBlockerId[];
	/** Exactly one next safe action. */
	readonly next_action: VaultGitNextAction;
}

/** Domain snapshot returned by read-side ports. */
export interface VaultGitStateSnapshot {
	/** Current phase. */
	readonly phase: VaultGitTransactionPhase;
	/** Current caller write authority. */
	readonly write_permission: VaultGitWritePermission;
	/** Current blockers. */
	readonly blockers: readonly VaultGitBlockerId[];
}

/**
 * Construct a lifecycle result while enforcing package-owned literal vocabulary.
 *
 * @param input - Candidate result payload
 * @returns A copied, validated result payload
 * @throws When a stable literal is outside package vocabulary
 *
 * @example
 * ```typescript
 * createVaultGitLifecycleResult({
 *   command: "status",
 *   outcome: "read_only",
 *   phase: "unavailable",
 *   write_permission: "denied",
 *   changed_state: "none",
 *   retry_safety: "same_input_safe",
 *   blockers: ["runtime_unavailable"],
 *   next_action: { id: "wait_for_runtime", summary: "Wait for runtime activation." },
 * })
 * ```
 */
export function createVaultGitLifecycleResult(
	input: VaultGitLifecycleResultPayload,
): VaultGitLifecycleResultPayload {
	assertLiteral("outcome", input.outcome, VAULT_GIT_RESULT_OUTCOMES);
	assertLiteral("phase", input.phase, VAULT_GIT_TRANSACTION_PHASES);
	assertLiteral(
		"write_permission",
		input.write_permission,
		VAULT_GIT_WRITE_PERMISSIONS,
	);
	assertLiteral("changed_state", input.changed_state, VAULT_GIT_CHANGED_STATES);
	assertLiteral("retry_safety", input.retry_safety, VAULT_GIT_RETRY_SAFETIES);
	for (const blocker of input.blockers) {
		assertLiteral("blocker", blocker, VAULT_GIT_BLOCKER_IDS);
	}
	assertLiteral(
		"next_action.id",
		input.next_action.id,
		VAULT_GIT_NEXT_ACTION_IDS,
	);
	if (input.next_action.summary.trim().length === 0) {
		throw new Error("next_action.summary must not be empty");
	}
	return {
		...input,
		blockers: [...input.blockers],
		next_action: { ...input.next_action },
	};
}

function assertLiteral(
	field: string,
	value: string,
	allowed: readonly string[],
): void {
	if (!allowed.includes(value)) {
		throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
	}
}
