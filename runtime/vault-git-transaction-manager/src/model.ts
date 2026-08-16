/** Actions that deterministic activation trust can stop. */
export const VAULT_GIT_ACTIVATION_STOPPED_ACTIONS = [
	"activation_preparation",
	"activation_admission",
	"vault_write",
	"activation_revocation",
] as const;

/** Non-secret host configuration fields required for live activation identity. */
export const VAULT_GIT_ACTIVATION_CONFIGURATION_FIELDS = [
	"host_identity",
	"ssh_identity_file",
	"ssh_public_key",
	"ssh_known_hosts",
] as const;

/** Closed public causes produced by deterministic activation trust. */
export const VAULT_GIT_ACTIVATION_RESTRICTION_CAUSES = [
	"configuration_missing",
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

/** Stable public name for one absent activation configuration field. */
export type VaultGitActivationConfigurationField =
	(typeof VAULT_GIT_ACTIVATION_CONFIGURATION_FIELDS)[number];

/** Input selected only from deterministic closed vocabulary. */
export interface VaultGitActivationRestrictionInput {
	readonly stoppedAction: VaultGitActivationStoppedAction;
	readonly cause: VaultGitActivationRestrictionCause;
	/** Absent public configuration field names for configuration_missing only. */
	readonly missingConfiguration?: readonly VaultGitActivationConfigurationField[];
	/** Command-local change already preserved before activation stopped the next write. */
	readonly changedState?: VaultGitChangedState;
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
	readonly observedSafeState: string;
	readonly writePermission: "denied";
	readonly changedState: VaultGitChangedState;
	readonly missingConfiguration?: readonly VaultGitActivationConfigurationField[];
	readonly manualHandoff: {
		readonly availability: "unavailable";
		readonly summary: string;
	};
	readonly nextAction: {
		readonly id:
			| "configure_activation_identity"
			| "review_prepared"
			| "return_to_human_review"
			| "prepare_fresh"
			| "inspect_configured_vault";
		readonly summary: string;
	};
}

/** Public JSON restriction result with no private diagnostics. */
export interface VaultGitActivationRestrictionJsonV3 {
	readonly contract_id: "vault-git.activation-result";
	readonly schema_version: "3";
	readonly status: "restricted";
	readonly privacy: "public";
	readonly stopped_action: VaultGitActivationStoppedAction;
	readonly cause: VaultGitActivationRestriction["cause"];
	readonly protection: string;
	readonly observed_safe_state: string;
	readonly write_permission: "denied";
	readonly changed_state: VaultGitChangedState;
	readonly missing_configuration?: readonly VaultGitActivationConfigurationField[];
	readonly manual_handoff: VaultGitActivationRestriction["manualHandoff"];
	/** One safe continuation as the authoritative Next Safe Action union. */
	readonly next_action: VaultGitNextAction;
}

const ACTIVATION_CAUSE_SUMMARY: Record<
	VaultGitActivationRestrictionCause,
	string
> = {
	configuration_missing: "Required activation identity configuration is missing.",
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
	configuration_missing: {
		id: "configure_activation_identity",
		summary:
			"Configure a stable VAULT_GIT_HOST plus VAULT_GIT_SSH_IDENTITY_FILE_PATH, VAULT_GIT_SSH_PUBLIC_KEY_PATH, and VAULT_GIT_SSH_KNOWN_HOSTS_PATH for this host using its dedicated repository-scoped SSH identity and reviewed owner-only known_hosts, then rerun vault-git doctor --json.",
	},
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
		id: "inspect_configured_vault",
		summary:
			"Inspect the configured vault and restore the unavailable live activation dependency before rerunning Doctor.",
	},
};

const ACTIVATION_OBSERVED_SAFE_STATE: Record<VaultGitChangedState, string> = {
	none: "Nothing changed.",
	local: "Local transaction state is preserved; no canonical commit or publication started.",
	remote: "Remote lease state is preserved; no canonical vault commit or publication started.",
	committed: "A local commit is preserved; remote publication did not start.",
	partial: "Remote completion is unknown; preserved evidence requires Doctor.",
};

/** Build the one semantic restriction object consumed by all projections. */
export function createVaultGitActivationRestriction(
	input: VaultGitActivationRestrictionInput,
): VaultGitActivationRestriction {
	const suppliedMissingConfiguration = input.missingConfiguration ?? [];
	const missingConfiguration = VAULT_GIT_ACTIVATION_CONFIGURATION_FIELDS.filter(
		(field) => suppliedMissingConfiguration.includes(field),
	);
	const valid = [
		VAULT_GIT_ACTIVATION_STOPPED_ACTIONS.includes(input.stoppedAction),
		VAULT_GIT_ACTIVATION_RESTRICTION_CAUSES.includes(input.cause),
		input.changedState === undefined ||
			VAULT_GIT_CHANGED_STATES.includes(input.changedState),
		missingConfiguration.length === suppliedMissingConfiguration.length,
		new Set(suppliedMissingConfiguration).size === suppliedMissingConfiguration.length,
		input.cause === "configuration_missing"
			? missingConfiguration.length > 0
			: missingConfiguration.length === 0,
	].every(Boolean);
	if (!valid) throw new Error("activation restriction invalid");
	const changedState = input.changedState ?? "none";
	return Object.freeze({
		privacy: "public",
		stoppedAction: input.stoppedAction,
		cause: Object.freeze({
			id: input.cause,
			summary: ACTIVATION_CAUSE_SUMMARY[input.cause],
		}),
		protection: "Vault Git kept canonical write permission denied.",
		observedSafeState: ACTIVATION_OBSERVED_SAFE_STATE[changedState],
		writePermission: "denied",
		changedState,
		...(missingConfiguration.length > 0
			? { missingConfiguration: Object.freeze([...missingConfiguration]) }
			: {}),
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
	"quarantine_reconciled",
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

/**
 * Pure CLI-safe value predicate: the single owner of the token-safety rule that
 * every argv-bound value must satisfy. A value is CLI-safe when it is a non-empty
 * string with no NUL or newline control characters and is not option-shaped (a
 * leading `-` would be misread as a flag). This is the token concern only; it
 * makes no claim about repository-relative structure.
 *
 * Command parsing uses this alone so a structurally invalid path still refuses at
 * its owned admission phase rather than at parse time.
 *
 * @param value - Candidate argv value.
 * @returns `true` when the value is a safe CLI token.
 *
 * @example
 * ```typescript
 * isVaultGitCliSafeValue("notes/one.md") // true
 * isVaultGitCliSafeValue("--json")       // false (option-shaped)
 * ```
 */
export function isVaultGitCliSafeValue(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.startsWith("-") &&
		!/[\0\r\n]/.test(value)
	);
}

/**
 * Pure repository-relative Owned Path leaf predicate: the single owner of the
 * leaf-path rule that receipt custody, the remote ledger, the Git adapter, and
 * the Next Safe Action input binder share. It composes CLI-safe token safety with
 * the relative/segment rules: not absolute, no trailing separator, and no empty,
 * `.`, `..`, or case-insensitive `.git` segment. This is the containment-free
 * rule; the Git adapter composes its own realpath escape check on top for on-disk
 * admission.
 *
 * @param value - Candidate repository-relative path.
 * @returns `true` when the value is a safe Owned Path leaf.
 *
 * @example
 * ```typescript
 * isVaultGitOwnedPathLeaf("notes/one.md") // true
 * isVaultGitOwnedPathLeaf("../secret")    // false
 * isVaultGitOwnedPathLeaf("/etc/passwd")  // false
 * ```
 */
export function isVaultGitOwnedPathLeaf(value: unknown): value is string {
	// A repository-relative Owned Path is a literal filesystem path, NOT a CLI token:
	// it may legitimately begin with `-` (a literal leading dash), carry pathspec
	// magic characters, or contain an embedded newline (git handles these via `--` /
	// literal pathspecs and NUL-delimited plumbing). So this predicate does NOT
	// compose the CLI-token rule (isVaultGitCliSafeValue), which exists only for
	// argv-bound values. It applies its own containment-free checks — matching the
	// prior adapter/store/ledger contract exactly: non-empty string, no NUL or CR
	// control byte (the record and plumbing delimiters), not absolute, no trailing
	// separator, and no empty, `.`, `..`, or case-insensitive `.git` segment. The Git
	// adapter composes its own realpath escape check on top for on-disk admission.
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		/[\0\r]/.test(value) ||
		value.startsWith("/") ||
		value.endsWith("/")
	) {
		return false;
	}
	return value
		.split("/")
		.every(
			(segment) =>
				segment.length > 0 &&
				segment !== "." &&
				segment !== ".." &&
				segment.toLowerCase() !== ".git",
		);
}

/** Full unrelated status and index intent captured at admission. */
export interface VaultGitUnrelatedStateSnapshot {
	/** NUL-safe hexadecimal encoding of porcelain-v2 status output. */
	readonly statusHex: string;
	/** NUL-safe hexadecimal encoding of index entries outside owned paths. */
	readonly indexHex: string;
}

/** One staged blob preserved while a superseded transaction is quarantined. */
export interface VaultGitStagedRecoveryEntry {
	/** Repository-relative admitted-new leaf path. */
	readonly path: string;
	/** Exact stage-zero blob object retained by the canonical index. */
	readonly objectId: string;
	/** Regular-file mode retained by the canonical index. */
	readonly mode: "100644" | "100755";
}

/** Durable plan that makes staged-only quarantine recovery restart-safe. */
export interface VaultGitStagedRecoveryPlan {
	/** Exact aligned main head whose tree keeps every recovered path absent. */
	readonly baselineHead: string;
	/** Exact unrelated worktree and index state protected during recovery. */
	readonly unrelatedState: VaultGitUnrelatedStateSnapshot;
	/** Sorted staged additions to materialize before resetting their index entries. */
	readonly entries: readonly VaultGitStagedRecoveryEntry[];
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

/** Public lifecycle states for one durable background-completion task. */
export const VAULT_GIT_TASK_STATES = [
	"claimed",
	"launching",
	"in_progress",
	"closed",
	"repair_needed",
	"unknown",
] as const;

/** Durable phases of one background-completion task. */
export const VAULT_GIT_TASK_PHASES = [
	"admitted",
	"running",
	"terminal",
] as const;

/** One public task lifecycle state. */
export type VaultGitTaskLifecycleState =
	(typeof VAULT_GIT_TASK_STATES)[number];

/** One durable background-completion task phase. */
export type VaultGitTaskPhase = (typeof VAULT_GIT_TASK_PHASES)[number];

/** Validated input for the first immutable task-state revision. */
export interface VaultGitTaskStateInput {
	/** Opaque task correlation generated by the private task store. */
	readonly taskId: string;
	/** Receipt whose exclusive completion claim owns the task. */
	readonly receiptId: string;
	/** Public transaction correlation selected by the task. */
	readonly transactionId: string;
	/** Exact lease generation bound by admission. */
	readonly leaseGeneration: string;
	/** Injected ISO timestamp for deterministic state. */
	readonly recordedAt: string;
}

/** Closed Validation Candidate stage vocabulary. */
export const VAULT_GIT_VALIDATION_STAGES = [
	"candidate_setup",
	"vault_check",
	"candidate_cleanup",
] as const;

/** One Validation Candidate stage owning a product-owned duration budget. */
export type VaultGitValidationStage =
	(typeof VAULT_GIT_VALIDATION_STAGES)[number];

/** Closed Validation Failure Class vocabulary routed through Doctor. */
export const VAULT_GIT_VALIDATION_FAILURE_CLASSES = [
	"candidate_setup",
	"vault_content",
	"stage_budget_exceeded",
	"candidate_cleanup",
] as const;

/** One stable Validation Failure Class. */
export type VaultGitValidationFailureClass =
	(typeof VAULT_GIT_VALIDATION_FAILURE_CLASSES)[number];

/**
 * Stage-classified validation failure carried for later Doctor routing.
 * A closed union so impossible class/stage pairings cannot be represented:
 * only `stage_budget_exceeded` varies its stage.
 */
export type VaultGitValidationFailure =
	| {
			readonly failureClass: "candidate_setup";
			readonly stage: "candidate_setup";
	  }
	| { readonly failureClass: "vault_content"; readonly stage: "vault_check" }
	| {
			readonly failureClass: "candidate_cleanup";
			readonly stage: "candidate_cleanup";
	  }
	| {
			readonly failureClass: "stage_budget_exceeded";
			readonly stage: VaultGitValidationStage;
	  };

/**
 * Manifest fields whose presence makes a vault dependency-bearing. Single
 * dependency-eligibility owner shared by checker admission (which demands a
 * lockfile for these shapes) and the Validation Candidate (which cannot
 * materialize them in isolation and must refuse before the check spawns).
 */
export const VAULT_GIT_LOCKFILE_REQUIRING_MANIFEST_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
	"peerDependenciesMeta",
	"trustedDependencies",
	"bundledDependencies",
	"bundleDependencies",
	"patchedDependencies",
	"overrides",
	"resolutions",
	"catalog",
	"catalogs",
	"workspaces",
] as const;

/** Parse one vault package manifest into its validated object shape. */
export function parseVaultGitManifest(
	manifestBytes: Uint8Array,
): Record<string, unknown> {
	let manifest: unknown;
	try {
		manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
	} catch {
		throw new Error("vault package manifest is not valid JSON");
	}
	if (
		typeof manifest !== "object" ||
		manifest === null ||
		Array.isArray(manifest)
	) {
		throw new Error("vault package manifest is not an object");
	}
	return manifest as Record<string, unknown>;
}

/** First declared dependency surface, or undefined when dependency-free. */
export function findVaultGitDependencySurface(
	manifest: Readonly<Record<string, unknown>>,
): string | undefined {
	return VAULT_GIT_LOCKFILE_REQUIRING_MANIFEST_FIELDS.find((field) =>
		Object.hasOwn(manifest, field),
	);
}

/** The manifest's check script line, or undefined when unavailable. */
export function findVaultGitCheckScript(
	manifest: Readonly<Record<string, unknown>>,
): string | undefined {
	const scripts = manifest.scripts;
	if (
		typeof scripts !== "object" ||
		scripts === null ||
		Array.isArray(scripts)
	) {
		return undefined;
	}
	const script = (scripts as Record<string, unknown>).check;
	return typeof script === "string" && script.trim().length > 0
		? script.trim()
		: undefined;
}

/** Bounded engine result retained by a terminal task revision. */
export interface VaultGitTaskTerminalResult {
	readonly outcome: VaultGitResultOutcome;
	readonly phase: VaultGitTransactionPhase;
	readonly changedState: VaultGitChangedState;
	readonly blocker: VaultGitBlockerId | null;
	readonly retrySafety: VaultGitRetrySafety;
	/** Stage-classified validation failure preserved for Doctor routing. */
	readonly validationFailure?: VaultGitValidationFailure;
}

/** Doctor-owned checkpoints projected through the shared lifecycle envelope. */
export type VaultGitDoctorTaskCheckpoint =
	| "local_classified"
	| "checking_remote"
	| "terminal";

/** Shared fields of a terminal Doctor Task diagnosis, independent of the next-action carrier. */
export interface VaultGitDoctorTaskTerminalResultBase {
	readonly kind: "doctor_result";
	readonly status: "diagnosed";
	readonly state: VaultGitTransactionState;
	readonly phase: VaultGitTransactionPhase;
	readonly finding: VaultGitDoctorFinding;
	readonly changedState: "none" | "local";
	readonly retrySafety: VaultGitRetrySafety;
	readonly blocker?: VaultGitBlockerId;
	readonly repairAction?: VaultGitRepairAction;
	readonly transactionId?: string;
}

/** Legacy on-disk continuation object, read without rewrite. */
export interface VaultGitDoctorTaskTerminalLegacyNextAction {
	readonly id: VaultGitEngineNextActionId;
	readonly summary: string;
}

/**
 * Sanitized authoritative Doctor result retained by a terminal Doctor Task.
 *
 * Exactly one next-action carrier is present: new terminal writes persist the
 * semantic action id only (`nextActionId`, with `nextAction` absent) and the full
 * public continuation is reconstructed on read from that id plus the Next Safe
 * Action catalog; legacy on-disk terminals persist the `nextAction: { id, summary }`
 * object (with `nextActionId` absent) and remain readable without rewrite. The
 * `?: never` arms make the two branches mutually exclusive at the type level.
 */
export type VaultGitDoctorTaskTerminalResult =
	| (VaultGitDoctorTaskTerminalResultBase & {
			readonly nextActionId: string;
			readonly nextAction?: never;
	  })
	| (VaultGitDoctorTaskTerminalResultBase & {
			readonly nextAction: VaultGitDoctorTaskTerminalLegacyNextAction;
			readonly nextActionId?: never;
	  });

/**
 * The durable terminal's next-action carrier, discriminated by which shape was
 * persisted. A `semantic` carrier is a new-write persisted Next Safe Action id (to
 * be rehydrated directly). A `legacy` carrier is the old `{ id, summary }` object
 * whose id is a compatibility id, not a semantic id — it must be reprojected through
 * the normal projector with context, never fed into semantic rehydration.
 */
export type VaultGitDoctorTerminalNextActionCarrier =
	| { readonly kind: "semantic"; readonly actionId: string }
	| { readonly kind: "legacy"; readonly actionId: VaultGitEngineNextActionId; readonly summary: string };

/**
 * Resolve the durable terminal's next-action carrier to its discriminated shape, so
 * one owner reconstructs the union: the semantic branch via persisted-semantic
 * rehydration, the legacy branch via normal projection with Doctor Task context.
 */
export function resolveVaultGitDoctorTerminalNextAction(
	terminal: VaultGitDoctorTaskTerminalResult,
): VaultGitDoctorTerminalNextActionCarrier {
	return terminal.nextActionId !== undefined
		? { kind: "semantic", actionId: terminal.nextActionId }
		: { kind: "legacy", actionId: terminal.nextAction.id, summary: terminal.nextAction.summary };
}

/** Sanitized process failure retained by a terminal Doctor Task. */
export interface VaultGitDoctorTaskWorkerFailure {
	readonly kind: "worker_failure";
	readonly blocker: "worker_launch_protocol_failed" | "worker_lost";
	readonly retrySafety: "operator_required";
	readonly nextAction: {
		readonly id: "inspect_private_receipt";
		readonly summary: string;
	};
}

/** Bounded terminal evidence owned by the Doctor Task lifecycle. */
export type VaultGitDoctorTaskTerminal =
	| VaultGitDoctorTaskTerminalResult
	| VaultGitDoctorTaskWorkerFailure;

/** Checkpoint vocabulary admitted by either public task lifecycle. */
export type VaultGitPublicTaskCheckpoint =
	| VaultGitTransactionPhase
	| VaultGitDoctorTaskCheckpoint;

/** Terminal result vocabulary admitted by either public task lifecycle. */
export type VaultGitPublicTaskTerminalResult =
	| VaultGitTaskTerminalResult
	| VaultGitDoctorTaskTerminal;

/** Single-use private proof that one known failed attempt may be replaced. */
export interface VaultGitTaskRepairAuthorization {
	readonly schemaVersion: 1;
	readonly action: "resume";
	readonly failedAttemptNumber: number;
	readonly failedTaskRevision: number;
	readonly repairedReceiptRevision: number;
	readonly bindingDigest: string;
	readonly authorizedAt: string;
}

/** Capability-free immutable state for one admitted background task. */
export interface VaultGitTaskState {
	/** Exact task-state schema version. */
	readonly schemaVersion: 2;
	/** Opaque task correlation generated independently of the receipt. */
	readonly taskId: string;
	/** Receipt whose exclusive completion claim owns the task. */
	readonly receiptId: string;
	/** Public transaction correlation selected by the task. */
	readonly transactionId: string;
	/** Exact lease generation bound by admission. */
	readonly leaseGeneration: string;
	/** Monotonic compare-and-set revision. */
	readonly revision: number;
	/** Monotonic semantic worker execution within the stable task. */
	readonly attemptNumber: number;
	/** Public task lifecycle state. */
	readonly state: VaultGitTaskLifecycleState;
	/** Durable task phase. */
	readonly phase: VaultGitTaskPhase;
	/** Injected task admission timestamp. */
	readonly recordedAt: string;
	/** Timestamp of this durable revision. */
	readonly updatedAt: string;
	/** Observational worker liveness sample; never authority. */
	readonly heartbeatAt: string | null;
	/** Last engine-owned transaction phase observed by the task. */
	readonly checkpoint: VaultGitTransactionPhase | null;
	/** Exact launch-attempt fence, never authority beyond acknowledgement. */
	readonly launchGeneration: string | null;
	/** Expiry of an unacknowledged launch attempt; null after acknowledgement. */
	readonly launchExpiresAt: string | null;
	/** Private OS process correlation; observational only, never authority. */
	readonly workerPid: number | null;
	/** Digest of OS process identity used to reject PID reuse. */
	readonly workerProcessIdentity: string | null;
	/** Bounded launch count. One initial launch and one recovery launch maximum. */
	readonly launchAttempt: number;
	/** Bounded result present only for a terminal task phase. */
	readonly terminalResult: VaultGitTaskTerminalResult | null;
	/** Sanitized terminal result from the immediately preceding attempt. */
	readonly previousTerminalResult: VaultGitTaskTerminalResult | null;
	/** Monotonic fence once any publication outcome for this task was uncertain. */
	readonly repairReentryBlocked: boolean;
	/** Pending exact repair proof; cleared atomically when the next attempt wins. */
	readonly repairAuthorization: VaultGitTaskRepairAuthorization | null;
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
	"task_not_found",
	"task_input_mismatch",
	"worker_launch_failed",
	"worker_launch_protocol_failed",
	"worker_lost",
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
	"capability_missing",
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
	// A requested next safe action could not be projected to an executable
	// continuation (unknown id, missing selector, or missing disambiguating
	// context); the result fails closed to operator review rather than degrading.
	"continuation_unavailable",
] as const;

/** Stable transaction blocker id. */
export type VaultGitBlockerId = (typeof VAULT_GIT_BLOCKER_IDS)[number];

/** Deterministic repair actions the runtime may classify. */
export const VAULT_GIT_REPAIR_ACTIONS = [
	"resume",
	"retry-push",
	"close-verified",
	"stale-lease-takeover",
	"reconcile-quarantine",
] as const;

/** One package-owned deterministic repair action. */
export type VaultGitRepairAction = (typeof VAULT_GIT_REPAIR_ACTIONS)[number];

/** Closed doctor findings safe for command output and automation. */
export const VAULT_GIT_DOCTOR_FINDINGS = [
	"activation_configuration_missing",
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
	"configure_activation_identity",
	"continue_transaction",
	"inspect_configured_vault",
	"inspect_private_receipt",
	"inspect_remote_lease",
	"prepare_fresh",
	"reload_capability",
	"return_to_human_review",
	"review_prepared",
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

/**
 * Runtime type guard: whether a value is a public master next-action (compatibility)
 * id. Distinct from the larger Next Safe Action semantic catalog, which includes
 * semantic-only ids (e.g. inspect_doctor_task) that are NOT public compatibility ids.
 */
export function isVaultGitNextActionId(
	value: string,
): value is VaultGitNextActionId {
	return (VAULT_GIT_NEXT_ACTION_IDS as readonly string[]).includes(value);
}

/** Exact remote branch used as the append-only lease sequencer. */
export const VAULT_GIT_LEDGER_REF =
	"refs/heads/vault-system/transaction-ledger" as const;

/** Schema version for package-owned JSON results. */
export const VAULT_GIT_SCHEMA_VERSION = "2" as const;

/**
 * Public prepared-evidence identifier shape shared by the activation store
 * validators and the Next Safe Action evidence_reference selector. Owned by this
 * leaf so both the activation contract and the Next Safe Action projector reference
 * it without a module cycle.
 */
export const EVIDENCE_ID = /^vault-git:prepared:v2:[0-9a-f]{64}$/;

/** Lifecycle result contract id. */
export const VAULT_GIT_RESULT_CONTRACT_ID =
	"vault-git.lifecycle-result" as const;

/** Machine command-discovery result contract id. */
export const VAULT_GIT_COMMANDS_CONTRACT_ID =
	"vault-git.command-discovery" as const;

/** Logical executable owner permitted to run a projected continuation. */
export type VaultGitNextActionExecutable = "vault-git" | "setup";

/** Delivery channel for one ordered next-action input descriptor. */
export type VaultGitNextActionInputChannel = "public" | "private_stdin";

/** One ordered next-action input descriptor (public projection only). */
export interface VaultGitNextActionInputField {
	readonly id: string;
	readonly input_channel: VaultGitNextActionInputChannel;
}

/**
 * The flat compatibility next-action pair: a stable public action id plus its human
 * summary, with no projected continuation. Engine-adjacent producers (the janitor
 * report, worker policy) carry this; the CLI re-projects it into the authoritative
 * `VaultGitNextAction` union at the public boundary. It is the master-id compat pair
 * (wider than `VaultGitEngineNextActionId` — it also covers ids such as `run_janitor`
 * and `none`).
 */
export interface VaultGitNextActionCompat {
	readonly id: VaultGitNextActionId;
	readonly summary: string;
}

/**
 * Exactly one safe continuation for a command result, as the authoritative Next
 * Safe Action discriminated union. The compat `id` and `summary` are top-level
 * fields on the union itself (never a nested legacy object): `id` is the stable
 * public action id existing consumers read, `action_id` is the semantic
 * continuation id (they differ only for a legacy id reprojected to its semantic
 * split). The union is constructed and validated by the Next Safe Action owner
 * (`composeVaultGitLifecycleResult`); this leaf type carries no catalog knowledge.
 */
export type VaultGitNextAction =
	| {
			readonly kind: "invoke";
			readonly id: VaultGitNextActionId;
			readonly action_id: string;
			readonly summary: string;
			readonly executable: VaultGitNextActionExecutable;
			readonly argv: readonly string[];
	  }
	| {
			readonly kind: "needs_input";
			readonly id: VaultGitNextActionId;
			readonly action_id: string;
			readonly summary: string;
			readonly input_contract_id: string;
			readonly fields: readonly VaultGitNextActionInputField[];
	  }
	| {
			readonly kind: "needs_human";
			readonly id: VaultGitNextActionId;
			readonly action_id: string;
			readonly summary: string;
			readonly handoff_kind: "command";
			readonly executable: VaultGitNextActionExecutable;
			readonly argv: readonly string[];
	  }
	| {
			readonly kind: "needs_human";
			readonly id: VaultGitNextActionId;
			readonly action_id: string;
			readonly summary: string;
			readonly handoff_kind: "external_prerequisite";
			readonly owner: string;
			readonly condition: string;
	  }
	| {
			readonly kind: "none";
			readonly id: VaultGitNextActionId;
			readonly action_id: string;
			readonly summary: string;
	  };

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
	/** Selected opaque background-task correlation. */
	readonly task_id?: string;
	/** Exact lease generation bound by the selected task. */
	readonly lease_generation?: string;
	/** Exact launch generation bound by a Doctor task worker. */
	readonly task_generation?: string;
	/** Selected task lifecycle state. */
	readonly task_state?: VaultGitTaskLifecycleState;
	/** Monotonic semantic worker attempt within the stable task. */
	readonly task_attempt_number?: number;
	/** Sanitized terminal result from the immediately preceding attempt. */
	readonly task_previous_failure?: VaultGitTaskTerminalResult | null;
	/** Selected task lifecycle phase. */
	readonly task_phase?: VaultGitTaskPhase;
	/** Latest observational heartbeat timestamp. */
	readonly task_heartbeat_at?: string | null;
	/** Last durably observed engine checkpoint. */
	readonly task_checkpoint?: VaultGitPublicTaskCheckpoint | null;
	/** Milliseconds elapsed since durable task admission. */
	readonly task_elapsed_ms?: number;
	/** Bounded terminal engine result, null while non-terminal. */
	readonly task_terminal_result?: VaultGitPublicTaskTerminalResult | null;
	/** Whether foreground work outside this vault transaction may continue. */
	readonly foreground_non_vault_work_allowed?: boolean;
	/** Read-side transaction state when classification produced one. */
	readonly transaction_state?: VaultGitTransactionState;
	/** Exact doctor-admitted repair action when one exists. */
	readonly repair_action?: VaultGitRepairAction;
	/** Closed doctor finding when the doctor command produced one. */
	readonly finding?: VaultGitDoctorFinding;
	/** Exactly one next safe action. */
	readonly next_action: VaultGitNextAction;
	/** Cause-specific public activation refusal, when activation stopped a write. */
	readonly activation_restriction?: VaultGitActivationRestrictionJsonV3;
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

/** Discriminant kinds admitted by the Next Safe Action union. */
export const VAULT_GIT_NEXT_ACTION_KINDS = [
	"invoke",
	"needs_input",
	"needs_human",
	"none",
] as const;

/** One Next Safe Action union discriminant. */
export type VaultGitNextActionKind =
	(typeof VAULT_GIT_NEXT_ACTION_KINDS)[number];

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
	if (!VAULT_GIT_NEXT_ACTION_KINDS.includes(input.next_action.kind)) {
		throw new Error(
			`next_action.kind must be one of: ${VAULT_GIT_NEXT_ACTION_KINDS.join(", ")}`,
		);
	}
	if (input.next_action.action_id.trim().length === 0) {
		throw new Error("next_action.action_id must not be empty");
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
