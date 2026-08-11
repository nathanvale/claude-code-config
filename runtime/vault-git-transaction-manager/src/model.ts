/** Actions that deterministic activation trust can stop. */
export const VAULT_GIT_ACTIVATION_STOPPED_ACTIONS = [
	"activation_preparation",
	"activation_admission",
	"vault_write",
	"activation_revocation",
] as const;

/** Closed public causes produced by deterministic activation trust. */
export const VAULT_GIT_ACTIVATION_RESTRICTION_CAUSES = [
	"admission_missing",
	"human_capability_required",
	"evidence_changed",
	"binding_changed",
	"invalidated",
	"revoked",
	"revalidation_unavailable",
] as const;

/** One stopped activation action. */
export type VaultGitActivationStoppedAction =
	(typeof VAULT_GIT_ACTIVATION_STOPPED_ACTIONS)[number];

/** One deterministic public restriction cause. */
export type VaultGitActivationRestrictionCause =
	(typeof VAULT_GIT_ACTIVATION_RESTRICTION_CAUSES)[number];

/** Input selected only from deterministic closed vocabulary. */
export interface VaultGitActivationRestrictionInput {
	readonly stoppedAction: VaultGitActivationStoppedAction;
	readonly cause: VaultGitActivationRestrictionCause;
}

/** Privacy-classified semantic source shared by every renderer. */
export interface VaultGitActivationRestriction {
	readonly privacy: "public";
	readonly stoppedAction: VaultGitActivationStoppedAction;
	readonly cause: {
		readonly id: VaultGitActivationRestrictionCause;
		readonly summary: string;
	};
	readonly protection: string;
	readonly observedSafeState: "Nothing changed.";
	readonly writePermission: "denied";
	readonly changedState: "none";
	readonly manualHandoff: {
		readonly availability: "unavailable";
		readonly summary: string;
	};
	readonly nextAction: {
		readonly id:
			| "review_prepared"
			| "return_to_human_review"
			| "prepare_fresh"
			| "run_doctor";
		readonly summary: string;
	};
}

/** Public JSON restriction result with no private diagnostics. */
export interface VaultGitActivationRestrictionJsonV1 {
	readonly contract_id: "vault-git.activation-result";
	readonly schema_version: "1";
	readonly status: "restricted";
	readonly privacy: "public";
	readonly stopped_action: VaultGitActivationStoppedAction;
	readonly cause: VaultGitActivationRestriction["cause"];
	readonly protection: string;
	readonly observed_safe_state: "Nothing changed.";
	readonly write_permission: "denied";
	readonly changed_state: "none";
	readonly manual_handoff: VaultGitActivationRestriction["manualHandoff"];
	readonly next_action: VaultGitActivationRestriction["nextAction"];
}

const ACTIVATION_CAUSE_SUMMARY: Record<
	VaultGitActivationRestrictionCause,
	string
> = {
	admission_missing: "Human activation admission is missing.",
	human_capability_required: "The final choice belongs to the human review surface.",
	evidence_changed: "The reviewed prepared evidence is no longer current.",
	binding_changed: "A prepared activation binding changed before admission.",
	invalidated: "Deterministic activation trust invalidated the prepared evidence.",
	revoked: "A human revoked this activation evidence.",
	revalidation_unavailable: "Live authoritative revalidation could not finish safely.",
};

const ACTIVATION_NEXT_ACTION: Record<
	VaultGitActivationRestrictionCause,
	VaultGitActivationRestriction["nextAction"]
> = {
	admission_missing: {
		id: "review_prepared",
		summary: "Open human review for the current prepared evidence.",
	},
	human_capability_required: {
		id: "return_to_human_review",
		summary: "Return to the human review surface for the final choice.",
	},
	evidence_changed: {
		id: "prepare_fresh",
		summary: "Prepare fresh V2 evidence, then return to human review.",
	},
	binding_changed: {
		id: "prepare_fresh",
		summary: "Prepare fresh V2 evidence, then return to human review.",
	},
	invalidated: {
		id: "prepare_fresh",
		summary: "Prepare fresh V2 evidence, then return to human review.",
	},
	revoked: {
		id: "prepare_fresh",
		summary: "Prepare fresh V2 evidence, then return to human review.",
	},
	revalidation_unavailable: {
		id: "run_doctor",
		summary: "Run read-only Doctor, then retry explicit preparation.",
	},
};

/** Build the one semantic restriction object consumed by all projections. */
export function createVaultGitActivationRestriction(
	input: VaultGitActivationRestrictionInput,
): VaultGitActivationRestriction {
	const valid = [
		VAULT_GIT_ACTIVATION_STOPPED_ACTIONS.includes(input.stoppedAction),
		VAULT_GIT_ACTIVATION_RESTRICTION_CAUSES.includes(input.cause),
	].every(Boolean);
	if (!valid) throw new Error("activation restriction invalid");
	return Object.freeze({
		privacy: "public",
		stoppedAction: input.stoppedAction,
		cause: Object.freeze({
			id: input.cause,
			summary: ACTIVATION_CAUSE_SUMMARY[input.cause],
		}),
		protection: "Vault Git kept canonical write permission denied.",
		observedSafeState: "Nothing changed.",
		writePermission: "denied",
		changedState: "none",
		manualHandoff: Object.freeze({
			availability: "unavailable",
			summary: "Manual handoff is not available from activation trust.",
		}),
		nextAction: Object.freeze({ ...ACTIVATION_NEXT_ACTION[input.cause] }),
	});
}

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

/** Read-side classification of one local transaction receipt. */
export const VAULT_GIT_TRANSACTION_STATES = [
	"absent",
	"active",
	"expired",
	"superseded",
	"unknown",
	"push_pending",
	"repairable",
	"human_required",
	"closed",
] as const;

/** Read-side classification of one local transaction receipt. */
export type VaultGitTransactionState =
	(typeof VAULT_GIT_TRANSACTION_STATES)[number];

/** Durable receipt transition vocabulary. */
export const VAULT_GIT_RECEIPT_TRANSITIONS = [
	"acquisition_intent",
	"lease_won",
	"write_authority_granted",
	"paths_joined",
	"completion_requested",
	"commit_candidate_frozen",
	"push_outcome_unknown",
	"deterministic_repair_available",
	"human_intervention_required",
	"superseded",
	"closed",
] as const;

/** One append-only receipt transition. */
export type VaultGitReceiptTransition =
	(typeof VAULT_GIT_RECEIPT_TRANSITIONS)[number];

/** Bounded, non-sensitive continuations persisted in private receipts. */
export const VAULT_GIT_RECEIPT_NEXT_ACTIONS = [
	"retry_remote",
	"request_operator_takeover",
	"preserve_local_edits",
	"inspect_status",
	"resume_writing",
	"complete_transaction",
	"continue_outer_transaction",
	"run_owned_path_checks",
	"retry_push",
	"run_doctor",
	"run_repair",
	"request_operator_review",
	"reconcile_quarantine",
	"none",
] as const;

/** One bounded continuation persisted in a receipt. */
export type VaultGitReceiptNextAction =
	(typeof VAULT_GIT_RECEIPT_NEXT_ACTIONS)[number];

/** Admission evidence for one frozen owned leaf path. */
export interface VaultGitOwnedPathReceipt {
	/** Repository-relative leaf path. */
	readonly path: string;
	/** Hash before admission, or null for an admitted absent file. */
	readonly baselineHash: string | null;
	/** Whether the path was absent and may begin untracked. */
	readonly admittedNewFile: boolean;
}

/** Full unrelated status and index intent captured at admission. */
export interface VaultGitUnrelatedStateSnapshot {
	/** NUL-safe hexadecimal encoding of porcelain-v2 status output. */
	readonly statusHex: string;
	/** NUL-safe hexadecimal encoding of index entries outside owned paths. */
	readonly indexHex: string;
}

/** Durable atomic-publication observation. */
export type VaultGitPushOutcome =
	| "not_attempted"
	| "unknown"
	| "closed"
	| "host_contract_breach";

/** Private, capability-free state persisted for one transaction transition. */
export interface VaultGitReceipt {
	/** Exact receipt schema version. */
	readonly schemaVersion: 2;
	/** Store-local opaque acquisition correlation id. */
	readonly receiptId: string;
	/** Remote transaction id after lease acquisition. */
	readonly transactionId: string | null;
	/** Monotonic history revision. */
	readonly revision: number;
	/** Durable transaction phase. */
	readonly phase: Exclude<VaultGitTransactionPhase, "unavailable" | "inspecting">;
	/** Transition recorded by this revision. */
	readonly transition: VaultGitReceiptTransition;
	/** Injected ISO timestamp. */
	readonly recordedAt: string;
	/** Immutable meaningful event. */
	readonly event: VaultGitEventType;
	/** Immutable non-secret actor identity. */
	readonly actor: string;
	/** Immutable non-secret host identity. */
	readonly host: string;
	/** Immutable named remote bound at admission. */
	readonly remote: string;
	/** Frozen admitted owned leaf paths and their pre-state. */
	readonly ownedPaths: readonly VaultGitOwnedPathReceipt[];
	/** Full begin-time status and index intent outside the owned leaf set. */
	readonly unrelatedState: VaultGitUnrelatedStateSnapshot;
	/** Local main baseline. */
	readonly localMainHead: string;
	/** Remote main baseline. */
	readonly remoteMainHead: string;
	/** Ledger generation observed before acquisition. */
	readonly expectedLeaseGeneration: string | null;
	/** Won fencing generation after acquisition. */
	readonly leaseGeneration: string | null;
	/** Lease acquisition time after acquisition. */
	readonly leaseAcquiredAt: string | null;
	/** Diagnostic lease duration; expiry does not grant takeover. */
	readonly leaseDurationMs: number;
	/** Local candidate commit when one exists. */
	readonly commitId: string | null;
	/** Exact main commit expected after atomic publication. */
	readonly expectedMainCommit: string | null;
	/** Exact release-ledger commit expected after atomic publication. */
	readonly ledgerReleaseId: string | null;
	/** Last durable atomic publication classification. */
	readonly pushOutcome: VaultGitPushOutcome;
	/** Exactly one engine-owned safe continuation id. */
	readonly nextSafeAction: VaultGitReceiptNextAction;
	/** Opaque diagnostics reference, never a private path. */
	readonly diagnosticsReference: string;
}

/**
 * Build the next append-only receipt revision from the previous one.
 *
 * Shared by the engine and repair flows so revision advancement, schema
 * pinning, and receipt-id preservation cannot drift between call sites.
 *
 * @param previous - Latest durable receipt revision
 * @param changes - Field changes recorded by the next revision
 * @returns New receipt with the same receipt id and an incremented revision
 * @throws Never
 *
 * @example
 * ```typescript
 * const closed = nextVaultGitReceipt(receipt, {
 *   phase: "closed",
 *   transition: "closed",
 *   nextSafeAction: "none",
 *   recordedAt: now,
 * })
 * ```
 */
export function nextVaultGitReceipt(
	previous: VaultGitReceipt,
	changes: Partial<VaultGitReceipt>,
): VaultGitReceipt {
	return {
		...previous,
		...changes,
		schemaVersion: 2,
		receiptId: previous.receiptId,
		revision: previous.revision + 1,
	};
}

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
	"activation_blocked",
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
	"offline_mode",
	"receipt_corrupt",
	"capability_invalid",
	"capability_role_mismatch",
	"vault_identity_changed",
	"owned_path_not_admitted",
	"commit_subject_invalid",
	"identity_label_invalid",
	"owned_path_changed",
	"unrelated_state_changed",
	"completion_baseline_changed",
	"completion_interrupted",
	"empty_event",
	"vault_check_failed",
	"transaction_mismatch",
	"doctor_proof_stale",
	"doctor_token_invalid",
	"host_quarantined",
	"deterministic_repair_mismatch",
	"repair_action_required",
	"dirty_tree",
	"checker_unadmitted",
	"checker_changed",
	"checker_output_invalid",
	"checker_repair_refused",
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

/** Closed doctor findings safe for command output and automation. */
export const VAULT_GIT_DOCTOR_FINDINGS = [
	"activation_missing",
	"no_receipt",
	"receipt_corrupt",
	"acquisition_not_started",
	"lease_acknowledgement_missing",
	"lease_acquired",
	"writes_in_progress",
	"checks_interrupted",
	"commit_interrupted",
	"local_commit_recovered",
	"publication_pending",
	"publication_already_closed",
	"remote_outcome_unknown",
	"remote_contract_breach",
	"deterministic_failure",
	"operator_intervention_recorded",
	"transaction_closed",
	"lease_expired",
	"lease_superseded",
	"host_quarantined",
] as const;

/** One evidence-backed doctor classification. */
export type VaultGitDoctorFinding =
	(typeof VAULT_GIT_DOCTOR_FINDINGS)[number];

/** Stable lifecycle result outcomes. */
export const VAULT_GIT_RESULT_OUTCOMES = [
	"read_only",
	"discovered",
	"unavailable",
	"invalid_usage",
	"admitted",
	"joined",
	"advanced",
	"completed",
	"repaired",
	"refused",
] as const;

/** One package-owned lifecycle result outcome. */
export type VaultGitResultOutcome = (typeof VAULT_GIT_RESULT_OUTCOMES)[number];

/** Stable next-action ids emitted by the U3 transaction engine. */
export const VAULT_GIT_ENGINE_NEXT_ACTION_IDS = [
	...VAULT_GIT_RECEIPT_NEXT_ACTIONS,
	"begin_transaction",
	"capture_private_draft",
	"change_commit_summary",
	"change_owned_paths",
	"continue_transaction",
	"inspect_configured_vault",
	"inspect_private_receipt",
	"inspect_remote_lease",
	"reload_capability",
	"request_operator_admission",
	"use_join_capability",
	"use_owner_capability",
] as const;

/** One engine-emitted safe continuation id. */
export type VaultGitEngineNextActionId =
	(typeof VAULT_GIT_ENGINE_NEXT_ACTION_IDS)[number];

/** Stable next-action ids emitted by the complete CLI and transaction engine. */
export const VAULT_GIT_NEXT_ACTION_IDS = [
	...VAULT_GIT_ENGINE_NEXT_ACTION_IDS,
	"wait_for_runtime",
	"inspect_commands",
	"change_input",
	"run_janitor",
] as const;

/** Closed trigger vocabulary for one bounded hygiene worker. */
export const VAULT_GIT_HYGIENE_WORKER_TRIGGERS = [
	"transaction_close",
	"tidy_now",
	"nightly",
] as const;

/** One admitted source for a bounded hygiene worker. */
export type VaultGitHygieneWorkerTrigger =
	(typeof VAULT_GIT_HYGIENE_WORKER_TRIGGERS)[number];

/** Vault mutation posture while a hygiene worker changes lease state. */
export type VaultGitHygieneVaultPosture = "normal" | "read_only";

/**
 * Private operator admission for the R34 runtime activation gate.
 *
 * Until this record exists in the private store, every write-capable engine
 * command refuses with blocker `activation_blocked`; U9 qualification admits
 * the live vault after acceptance.
 */
export interface VaultGitActivationRecord {
	/** Activation record schema. */
	readonly schemaVersion: 2;
	/** Exact V2 prepared evidence reviewed for this admission. */
	readonly evidenceId: string;
	/** Operator-controlled admission timestamp. */
	readonly admittedAt: string;
	/** Non-secret single-line admission context. */
	readonly note: string;
}

/** Exact prepared binding names that can invalidate activation. */
export const VAULT_GIT_ACTIVATION_BINDINGS = [
	"repositoryIdentity",
	"remoteIdentity",
	"hostIdentity",
	"runtimeIdentity",
	"executableIdentity",
	"privateStateIdentity",
	"localMainHead",
	"remoteMainHead",
	"ledgerGeneration",
	"gitIdentity",
	"sshIdentity",
	"checkerClosure",
] as const;

/** One exact prepared binding checked against live authoritative state. */
export type VaultGitActivationBinding =
	(typeof VAULT_GIT_ACTIVATION_BINDINGS)[number];

/** Durable human-only revocation marker for one exact evidence snapshot. */
export interface VaultGitActivationRevocationRecord {
	readonly schemaVersion: 1;
	readonly evidenceId: string;
	readonly revokedAt: string;
	readonly note: string;
}

/** Durable changed-binding invalidation marker for one exact evidence snapshot. */
export interface VaultGitActivationInvalidationRecord {
	readonly schemaVersion: 1;
	readonly evidenceId: string;
	readonly binding: VaultGitActivationBinding;
	readonly invalidatedAt: string;
}

/** Private operator admission for one exact checker implementation bundle. */
export interface VaultGitCheckerAdmissionRecord {
	/** Admission record schema. */
	readonly schemaVersion: 1;
	/** SHA-256 of the declared checker entrypoint. */
	readonly entrypointHash: string;
	/** SHA-256 of the checker dependency bundle. */
	readonly dependencyBundleHash: string;
	/** Operator-controlled admission timestamp. */
	readonly admittedAt: string;
}

/** Bounded count of private material removed by one hygiene pass. */
export interface VaultGitPrivateHygieneResult {
	/** Closed-receipt owner and join capability files removed. */
	readonly capabilityFiles: number;
	/** Consumed or expired doctor-token record groups removed. */
	readonly doctorTokenRecords: number;
	/** Oldest Janitor report files removed beyond the newest fifty retained. */
	readonly janitorReports: number;
}

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
	/** Public transaction correlation when one exists. */
	readonly transaction_id?: string;
	/** Read-side transaction state when classification produced one. */
	readonly transaction_state?: VaultGitTransactionState;
	/** Exact doctor-admitted repair action when one exists. */
	readonly repair_action?: VaultGitRepairAction;
	/** Closed doctor finding when the doctor command produced one. */
	readonly finding?: VaultGitDoctorFinding;
	/** Exactly one next safe action. */
	readonly next_action: VaultGitNextAction;
	/** Cause-specific public activation refusal, when activation stopped a write. */
	readonly activation_restriction?: VaultGitActivationRestrictionJsonV1;
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
