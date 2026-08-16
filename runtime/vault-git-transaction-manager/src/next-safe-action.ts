/**
 * Package-owned Next Safe Action catalog and projection (issue #390 U1).
 *
 * Turns current result evidence into exactly one typed continuation. This is the
 * single semantic action catalog and projection owner; the CLI adapter, facade
 * runtime actions, and the compatibility `{ id, summary }` fields all derive from
 * what this module projects. It is deliberately a concrete catalog of the closed
 * #390 continuations, not a generic routing framework: every entry names a real
 * Vault Git or Setup continuation with a fixed shape.
 */

import { validateVaultCommitSubject } from "./commit-policy.ts";
import {
	EVIDENCE_ID,
	VAULT_GIT_EVENT_TYPES,
	createVaultGitLifecycleResult,
	isVaultGitCliSafeValue,
	isVaultGitNextActionId,
	isVaultGitOwnedPathLeaf,
	type VaultGitBlockerId,
	type VaultGitEventType,
	type VaultGitLifecycleResultPayload,
	type VaultGitNextAction,
	type VaultGitNextActionId,
	type VaultGitRepairAction,
} from "./model.ts";

/** Logical executable owner permitted to run a projected continuation. */
export type VaultGitContinuationExecutable = "vault-git" | "setup";

/** Named external prerequisite owner for a `needs_human` handoff. */
export type VaultGitExternalPrerequisiteOwner =
	| "vault_git_operator"
	| "repository_ssh_owner"
	| "vault_git_performance_owner"
	// Private capability-lane owners: the party holding the owner/join capability,
	// and the internal launcher that reloads it. Grounded in the engine's
	// capability-role and reload emission sites, not a generic operator default.
	| "transaction_owner"
	| "join_owner"
	| "private_launcher";

/**
 * A product capability an action's continuation depends on to be executable.
 * The runtime names product features, never implementation-plan units.
 */
export type VaultGitRequiredFeature =
	| "vault_git_host_enrollment"
	| "vault_content_repair";

/** Public transaction-id selector value, `txn_` + 32 hex. */
const PUBLIC_TRANSACTION_ID = /^txn_[0-9a-f]{32}$/;

/** Public completion task-id selector value, `task_` + 32 hex. */
const PUBLIC_TASK_ID = /^task_[0-9a-f]{32}$/;

/** Public doctor task-id selector value, `doctor_task_` + 32 hex. */
const PUBLIC_DOCTOR_TASK_ID = /^doctor_task_[0-9a-f]{32}$/;

/**
 * Public repair-id selector value. A Repair ID is a checker repair-registry
 * token sourced only from an admitted Doctor Finding; it matches the package's
 * safe checker-token contract, not an opaque `txn_`/`task_` handle.
 */
const PUBLIC_REPAIR_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;


/**
 * Public selectors permitted inside a projected continuation.
 *
 * Every value is validated to its public contract before it can reach argv, so a
 * filesystem path, auth URL, capability handle, or raw output can never be
 * projected into a continuation argument.
 */
export interface VaultGitContinuationSelectors {
	/** Public transaction correlation, `txn_` + 32 hex. */
	readonly transaction_id?: string;
	/** Public Completion Task correlation, `task_` + 32 hex. */
	readonly task_id?: string;
	/** Public Doctor Task correlation, `doctor_task_` + 32 hex. */
	readonly doctor_task_id?: string;
	/** Admitted checker repair-registry id from a Doctor Finding. */
	readonly repair_id?: string;
	/** Prepared-evidence reference, the activation-contract EVIDENCE_ID format. */
	readonly evidence_reference?: string;
}

/** One public selector an invoke continuation requires. */
type RequiredSelector =
	| "transaction_id"
	| "task_id"
	| "doctor_task_id"
	| "repair_id"
	| "evidence_reference";

/** One invocable continuation: a logical executable plus a sanitized argv. */
export interface VaultGitInvokeContinuation {
	readonly kind: "invoke";
	readonly action_id: string;
	readonly summary: string;
	readonly executable: VaultGitContinuationExecutable;
	readonly argv: readonly string[];
}

/** Delivery channel for one ordered input descriptor. */
export type VaultGitInputChannel = "public" | "private_stdin";

/** One ordered input descriptor referencing an owner-defined input contract. */
export interface VaultGitInputFieldDescriptor {
	readonly id: string;
	readonly input_channel: VaultGitInputChannel;
}

/**
 * Internal input field spec. Only `id` and `input_channel` are ever projected
 * into the public continuation; the remaining bind metadata stays internal.
 *
 * A `public` field carries the argv flag and value shape the pure public binder
 * emits. A `private_stdin` field carries no argv flag at all — its value is
 * streamed through the private Setup binder's child stdin and never reaches argv.
 */
type InputFieldSpec =
	| {
			readonly id: string;
			readonly input_channel: "public";
			/** `scalar` binds one value; `list` binds one-or-more repeating `flag`. */
			readonly value_kind: "scalar" | "list";
			/** The argv flag emitted for this field. */
			readonly flag: string;
			/**
			 * Validate one bound value; throw `SelectorRejection` on refusal. When the
			 * field is event-scoped, the durable Vault Event is passed so the shared
			 * commit-policy owner can validate the subject against it.
			 */
			readonly validate: (value: string, event: VaultGitEventType | undefined) => void;
			/** When true, binding this field requires the durable event in context. */
			readonly requires_event?: boolean;
	  }
	| {
			readonly id: string;
			readonly input_channel: "private_stdin";
			/** Validate one private value before it is streamed; never echoed. */
			readonly validate: (value: string) => void;
	  };

/**
 * A resume action plus ordered input descriptors. Carries no values and no argv
 * template; the caller binds input mechanically through the referenced contract.
 */
export interface VaultGitNeedsInputContinuation {
	readonly kind: "needs_input";
	readonly action_id: string;
	readonly summary: string;
	readonly input_contract_id: string;
	readonly fields: readonly VaultGitInputFieldDescriptor[];
}

/**
 * An agent-terminal handoff. A `command` handoff carries one exact human
 * invocation; an `external_prerequisite` handoff names a stable external owner
 * and required condition with no invocation. Both are non-agent-executable.
 */
export type VaultGitNeedsHumanContinuation =
	| {
			readonly kind: "needs_human";
			readonly action_id: string;
			readonly summary: string;
			readonly handoff_kind: "command";
			readonly executable: VaultGitContinuationExecutable;
			readonly argv: readonly string[];
	  }
	| {
			readonly kind: "needs_human";
			readonly action_id: string;
			readonly summary: string;
			readonly handoff_kind: "external_prerequisite";
			readonly owner: VaultGitExternalPrerequisiteOwner;
			readonly condition: string;
	  };

/** A terminal stop. */
export interface VaultGitNoneContinuation {
	readonly kind: "none";
	readonly action_id: string;
	readonly summary: string;
}

/** Exactly one typed Next Safe Action continuation. */
export type VaultGitNextSafeActionContinuation =
	| VaultGitInvokeContinuation
	| VaultGitNeedsInputContinuation
	| VaultGitNeedsHumanContinuation
	| VaultGitNoneContinuation;

/**
 * Minimum explicit public context used to disambiguate legacy semantic ids
 * whose continuation depends on where they were emitted. The caller supplies
 * only public discriminators; when a legacy id needs context that is absent,
 * the projection is unavailable rather than guessed.
 */
export interface VaultGitContinuationContext {
	/**
	 * Which durable evidence produced the result, when a legacy id spans more
	 * than one. `completion_task` and `doctor_task` split legacy `inspect_status`;
	 * `transaction_receipt` is plain transaction inspection. `begin` distinguishes
	 * a pre-remote begin retry from an inspect-time remote retry for `retry_remote`.
	 */
	readonly result_kind?:
		| "transaction_receipt"
		| "completion_task"
		| "doctor_task"
		| "begin"
		| "inspect";
	/**
	 * Which command's admission emitted a shared id like `change_owned_paths`.
	 * `begin` corrects the begin path set (event + paths); `join` corrects the
	 * joined path set (transaction + paths), preserving join-role authority.
	 */
	readonly emission_command?: "begin" | "join";
	/**
	 * The doctor-classified repair action a result already carries, used to
	 * project `run_repair` to its exact repair command rather than looping back
	 * to Doctor. Absent when the result named no repair action.
	 */
	readonly repair_action?: VaultGitRepairAction;
	/**
	 * The durable Vault Event of the transaction, required to validate a supplied
	 * commit subject through the commit-policy owner when binding a completion.
	 */
	readonly event?: VaultGitEventType;
	/** Whether durable, public evidence is complete enough to invoke directly. */
	readonly evidence_complete?: boolean;
}

/** Request to project one continuation from current evidence. */
export interface VaultGitNextSafeActionRequest {
	readonly action_id: string;
	readonly selectors?: VaultGitContinuationSelectors;
	readonly context?: VaultGitContinuationContext;
}

/**
 * Explicit typed projection status. The enclosing lifecycle, activation, and
 * discovery results read this — never the continuation summary text — to decide
 * whether to carry the `continuation_unavailable` blocker and `operator_required`
 * posture. `available` carries a concrete continuation; `unavailable` carries a
 * terminal `none` because the action id was unknown, a required selector was
 * missing, or a selector value failed its public contract.
 */
export type VaultGitNextSafeActionAvailability = "available" | "unavailable";

/** One projected continuation plus its explicit availability classification. */
export interface VaultGitNextSafeActionProjection {
	readonly availability: VaultGitNextSafeActionAvailability;
	readonly continuation: VaultGitNextSafeActionContinuation;
}

/** Internal error thrown by selector or input validation. */
class SelectorRejection extends Error {}

/**
 * Build argv from a fixed prefix, ordered required selectors, and a suffix. A
 * selector with an empty flag is positional (value only); otherwise the flag
 * precedes its validated value. Throws `SelectorRejection` on a missing or
 * invalid selector so the caller fails closed.
 */
function buildSelectorArgv(
	spec: {
		readonly argvPrefix: readonly string[];
		readonly selectors: readonly {
			readonly selector: RequiredSelector;
			readonly flag: string;
			/**
			 * An optional selector is emitted only when the caller supplies a valid
			 * value; an absent optional selector is skipped (not a fail-closed rejection).
			 * A supplied-but-invalid optional value still rejects. Used where a command
			 * legitimately accepts a flag but does not require it (e.g. a non-takeover
			 * repair that can resume a pre-acknowledgement receipt with no transaction id).
			 */
			readonly optional?: boolean;
		}[];
		readonly argvSuffix: readonly string[];
	},
	selectors: VaultGitContinuationSelectors | undefined,
): string[] {
	const argv = [...spec.argvPrefix];
	for (const { selector, flag, optional } of spec.selectors) {
		if (optional && (selectors?.[selector] ?? "").length === 0) continue;
		const value = requireSelector(selector, selectors);
		if (flag === "") argv.push(value);
		else argv.push(flag, value);
	}
	argv.push(...spec.argvSuffix);
	return argv;
}

/** Reject an input value that is not a known event type. */
function validateEventValue(value: string): void {
	if (!(VAULT_GIT_EVENT_TYPES as readonly string[]).includes(value)) {
		throw new SelectorRejection("invalid event value");
	}
}

/**
 * Reject a public argv-bound owned-path input that is not both a safe CLI token AND
 * a safe repository-relative owned leaf path. The leaf rule alone admits literal
 * on-disk paths (leading dash, embedded LF) that are unsafe as argv; a public binder
 * feeds argv, so it composes the CLI-token rule on top. The on-disk adapter and the
 * durable store/ledger use the leaf rule alone for literal paths.
 */
function validateOwnedPathValue(value: string): void {
	if (!isVaultGitCliSafeValue(value) || !isVaultGitOwnedPathLeaf(value)) {
		throw new SelectorRejection("invalid owned path value");
	}
}

/**
 * Reject a private value that is empty or carries a control character. The value
 * is never echoed; only its acceptability is signalled. Deeper path validation
 * belongs to the Setup owner that consumes the private stdin lane.
 */
function validatePrivateValue(value: string): void {
	if (value.length === 0 || /[\0\r\n]/.test(value)) {
		throw new SelectorRejection("invalid private value");
	}
}

/**
 * One authoritative catalog entry. Each variant fixes the continuation kind,
 * summary, and the concrete #390 shape for its action id.
 */
type CatalogEntry =
	| {
			readonly kind: "invoke";
			readonly summary: string;
			readonly executable: VaultGitContinuationExecutable;
			/**
			 * When set, this continuation targets a command that only becomes
			 * executable once the named product feature ships; until then the
			 * projection fails closed to unavailable.
			 */
			readonly requiresFeature?: VaultGitRequiredFeature;
			/** Fixed argv prefix before selector arguments. */
			readonly argvPrefix: readonly string[];
			/** Ordered public selectors this action binds, each with its flag. */
			readonly selectors: readonly {
				readonly selector: RequiredSelector;
				readonly flag: string;
				/** Emit only when supplied; skip when absent (see buildSelectorArgv). */
				readonly optional?: boolean;
			}[];
			/** Fixed argv suffix after selector arguments. */
			readonly argvSuffix: readonly string[];
	  }
	| {
			readonly kind: "needs_input";
			readonly summary: string;
			readonly input_contract_id: string;
			/** See invoke `requiresFeature`: gates this contract until the feature ships. */
			readonly requiresFeature?: VaultGitRequiredFeature;
			/**
			 * Expected Setup action argv for a private contract, anchored so injected
			 * discovery that names an unexpected command or domain is refused before
			 * the private Setup binder spawns anything.
			 */
			readonly setupActionArgv?: readonly string[];
			/**
			 * Ordered input fields the caller must still supply. Public projection
			 * exposes `{ id, input_channel }` only; the extra bind metadata stays
			 * internal so the public continuation never carries an argv template.
			 */
			readonly fields: readonly InputFieldSpec[];
			/**
			 * Required public selectors the result already carries (e.g. the
			 * transaction id). These are not re-entered as input; the binder
			 * revalidates them from the request selectors and emits them ahead of the
			 * supplied input fields.
			 */
			readonly requiredSelectors?: readonly {
				readonly selector: RequiredSelector;
				readonly flag: string;
			}[];
			/**
			 * How the pure public-input binder assembles the resulting invoke. Present
			 * only for all-public contracts; a private_stdin contract has no public
			 * argv bind and is bound through the private Setup binder instead.
			 */
			readonly bind?: {
				readonly executable: VaultGitContinuationExecutable;
				readonly argvPrefix: readonly string[];
				readonly argvSuffix: readonly string[];
			};
	  }
	| {
			readonly kind: "needs_human";
			readonly summary: string;
			readonly handoff_kind: "command";
			readonly executable: VaultGitContinuationExecutable;
			readonly argvPrefix: readonly string[];
			readonly selectors: readonly {
				readonly selector: RequiredSelector;
				readonly flag: string;
			}[];
			readonly argvSuffix: readonly string[];
	  }
	| {
			readonly kind: "needs_human";
			readonly summary: string;
			readonly handoff_kind: "external_prerequisite";
			readonly owner: VaultGitExternalPrerequisiteOwner;
			readonly condition: string;
	  }
	| { readonly kind: "none"; readonly summary: string };

const TXN = { selector: "transaction_id", flag: "--transaction-id" } as const;
const REPAIR = { selector: "repair_id", flag: "--repair-id" } as const;
const TASK = { selector: "task_id", flag: "--task-id" } as const;
const DOCTOR_TASK = {
	selector: "doctor_task_id",
	flag: "--task-id",
} as const;
const EVIDENCE = { selector: "evidence_reference", flag: "" } as const;

/**
 * Validate a commit subject through the shared commit-policy owner, event-scoped.
 * The event is required; an absent event or a refused subject fails closed. The
 * subject value is never echoed into the thrown message.
 */
function validateCommitSummaryValue(
	value: string,
	event: VaultGitEventType | undefined,
): void {
	if (event === undefined) {
		throw new SelectorRejection("commit summary requires the durable event");
	}
	if (validateVaultCommitSubject(value, event).status !== "accepted") {
		throw new SelectorRejection("commit subject refused");
	}
}

/**
 * A `begin` needs_input contract. `begin` requires an event plus one-or-more
 * owned leaf paths — neither is a permitted continuation selector — so the caller
 * supplies both as public input the binder completes into a begin invocation.
 */
function beginContract(summary: string): CatalogEntry {
	return {
		kind: "needs_input",
		summary,
		input_contract_id: "vault-git.begin",
		fields: [
			{
				id: "event",
				input_channel: "public",
				value_kind: "scalar",
				flag: "--event",
				validate: validateEventValue,
			},
			{
				id: "owned_paths",
				input_channel: "public",
				value_kind: "list",
				flag: "--path",
				validate: validateOwnedPathValue,
			},
		],
		bind: {
			executable: "vault-git",
			argvPrefix: ["begin"],
			argvSuffix: ["--json"],
		},
	};
}

/**
 * A `join` needs_input contract. Correcting the joined path set preserves
 * join-role authority: the transaction id is a required selector the result
 * carries, and only the corrected owned paths are caller input. No event — join
 * does not take one.
 */
function joinContract(summary: string): CatalogEntry {
	return {
		kind: "needs_input",
		summary,
		input_contract_id: "vault-git.join",
		requiredSelectors: [TXN],
		fields: [
			{
				id: "owned_paths",
				input_channel: "public",
				value_kind: "list",
				flag: "--path",
				validate: validateOwnedPathValue,
			},
		],
		bind: {
			executable: "vault-git",
			argvPrefix: ["join"],
			argvSuffix: ["--json"],
		},
	};
}

/**
 * A `complete` needs_input contract. The transaction id is a required selector
 * the result already carries (revalidated, not re-entered); only the semantic
 * commit subject is caller input, validated against the durable event.
 */
function completeContract(summary: string): CatalogEntry {
	return {
		kind: "needs_input",
		summary,
		input_contract_id: "vault-git.complete",
		requiredSelectors: [TXN],
		fields: [
			{
				id: "commit_summary",
				input_channel: "public",
				value_kind: "scalar",
				flag: "--summary",
				validate: validateCommitSummaryValue,
				requires_event: true,
			},
		],
		bind: {
			executable: "vault-git",
			argvPrefix: ["complete"],
			argvSuffix: ["--json"],
		},
	};
}

/**
 * The single authoritative Next Safe Action catalog, keyed by action id.
 *
 * Every entry is one closed continuation from the issue #390 recovery tables
 * (ADR 0002): Stale-Lease Takeover, the validation route matrix, interrupted
 * Repair Promotion, and Unknown Publication Outcome, plus the split task
 * inspection ids and the terminal `none`. Command routing, argv projection,
 * summaries, owners, conditions, and required selectors all live here so fixes
 * have one home.
 */
const CATALOG: Readonly<Record<string, CatalogEntry>> = {
	// Stale-Lease Takeover
	reconcile_quarantine: {
		kind: "invoke",
		summary: "Reconcile the quarantined host transaction.",
		executable: "vault-git",
		argvPrefix: ["repair", "reconcile-quarantine"],
		selectors: [TXN],
		argvSuffix: ["--json"],
	},
	reattest_stale_lease_takeover: {
		kind: "needs_human",
		summary: "Reattest the stale-lease takeover with the operator.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "stale_lease_takeover_reattested",
	},

	// Validation route matrix
	preview_host_enrollment_repair: {
		kind: "invoke",
		summary: "Preview the Host Enrollment repair.",
		executable: "setup",
		requiresFeature: "vault_git_host_enrollment",
		argvPrefix: ["sync", "--domain", "vault-git", "--check"],
		selectors: [],
		argvSuffix: ["--json"],
	},
	provide_host_enrollment_inputs: {
		kind: "needs_input",
		summary: "Provide the Host Enrollment inputs.",
		input_contract_id: "setup.vault-git.host-enrollment",
		requiresFeature: "vault_git_host_enrollment",
		setupActionArgv: ["sync", "--domain", "vault-git"],
		// All private: bound only through the private Setup binder's stdin lane,
		// never the public binder. No argv flags, no public bind template.
		fields: [
			{
				id: "ssh_identity_file_path",
				input_channel: "private_stdin",
				validate: validatePrivateValue,
			},
			{
				id: "ssh_public_key_path",
				input_channel: "private_stdin",
				validate: validatePrivateValue,
			},
			{
				id: "ssh_known_hosts_path",
				input_channel: "private_stdin",
				validate: validatePrivateValue,
			},
		],
	},
	// begin needs an event plus one-or-more owned leaf paths; those are not
	// permitted continuation selectors, so it is an all-public needs_input
	// contract the pure public binder completes into a begin invocation.
	begin_transaction: beginContract("Begin a Vault Transaction."),
	provision_repository_ssh: {
		kind: "needs_human",
		summary: "Provision the dedicated repository SSH identity.",
		handoff_kind: "external_prerequisite",
		owner: "repository_ssh_owner",
		condition: "dedicated_identity_ready",
	},
	escalate_validation_evidence: {
		kind: "needs_human",
		summary: "Escalate the validation evidence to the operator.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "validation_evidence_required",
	},
	apply_vault_content_repair: {
		kind: "invoke",
		summary: "Apply the deterministic vault-content repair.",
		executable: "vault-git",
		requiresFeature: "vault_content_repair",
		argvPrefix: ["repair", "apply-vault-content"],
		selectors: [TXN, REPAIR],
		argvSuffix: ["--json"],
	},
	diagnose_validation_budget: {
		kind: "needs_human",
		summary: "Diagnose the validation stage budget with the performance owner.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_performance_owner",
		condition: "validation_stage_budget_diagnosed",
	},
	inspect_completion_task: {
		kind: "invoke",
		summary: "Inspect the Completion Task.",
		executable: "vault-git",
		argvPrefix: ["status"],
		selectors: [TASK],
		argvSuffix: ["--json"],
	},
	run_janitor: {
		kind: "invoke",
		summary: "Run the janitor to remove proven-unowned residue.",
		executable: "vault-git",
		argvPrefix: ["janitor"],
		selectors: [],
		argvSuffix: ["--json"],
	},

	// Interrupted Repair Promotion
	restore_transaction_capability: {
		kind: "needs_human",
		summary: "Restore the transaction owner capability with the operator.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "transaction_owner_capability_available",
	},
	resume_vault_content_promotion: {
		kind: "invoke",
		summary: "Resume the frozen vault-content Repair Promotion.",
		executable: "vault-git",
		requiresFeature: "vault_content_repair",
		argvPrefix: ["repair", "resume-promotion"],
		selectors: [TXN, REPAIR],
		argvSuffix: ["--json"],
	},
	resume_repaired_transaction: {
		kind: "invoke",
		summary: "Resume the repaired transaction back to writing.",
		executable: "vault-git",
		argvPrefix: ["repair", "resume"],
		selectors: [TXN],
		argvSuffix: ["--json"],
	},
	reconcile_repair_promotion: {
		kind: "needs_human",
		summary: "Reconcile the Repair Promotion evidence with the operator.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "repair_promotion_reconciliation_required",
	},

	// Unknown Publication Outcome
	close_verified_publication: {
		kind: "invoke",
		summary: "Close the verified remote publication.",
		executable: "vault-git",
		argvPrefix: ["repair", "close-verified"],
		selectors: [TXN],
		argvSuffix: ["--json"],
	},
	retry_proven_unpublished: {
		kind: "invoke",
		summary: "Retry the proven-unpublished push.",
		executable: "vault-git",
		argvPrefix: ["repair", "retry-push"],
		selectors: [TXN],
		argvSuffix: ["--json"],
	},
	obtain_remote_evidence: {
		kind: "needs_human",
		summary: "Obtain remote publication evidence with the operator.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "remote_evidence_available",
	},
	resolve_publication_conflict: {
		kind: "needs_human",
		summary: "Resolve the publication conflict with the operator.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "publication_conflict_resolved",
	},
	restore_remote_contract: {
		kind: "needs_human",
		summary: "Restore the remote contract with the operator.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "remote_contract_restored",
	},

	// Split task inspection + terminal
	inspect_doctor_task: {
		kind: "invoke",
		summary: "Inspect the Doctor Task.",
		executable: "vault-git",
		argvPrefix: ["doctor"],
		selectors: [DOCTOR_TASK],
		argvSuffix: ["--json"],
	},
	inspect_transaction: {
		kind: "invoke",
		summary: "Inspect the transaction status.",
		executable: "vault-git",
		argvPrefix: ["status"],
		selectors: [],
		argvSuffix: ["--json"],
	},
	inspect_remote_lease: {
		kind: "invoke",
		summary: "Inspect the remote lease through authority-free Doctor.",
		executable: "vault-git",
		argvPrefix: ["doctor"],
		selectors: [TXN],
		argvSuffix: ["--json"],
	},
	// The configured vault and its activation dependencies live at Activation
	// Home (the always-present activation surface), not plain status.
	inspect_configured_vault: {
		kind: "invoke",
		summary: "Inspect the configured vault at Activation Home.",
		executable: "vault-git",
		argvPrefix: ["activation"],
		selectors: [],
		argvSuffix: ["--json"],
	},
	inspect_commands: {
		kind: "invoke",
		summary: "Read command discovery to choose one safe command.",
		executable: "vault-git",
		argvPrefix: ["commands"],
		selectors: [],
		argvSuffix: ["--json"],
	},
	run_doctor: {
		kind: "invoke",
		summary: "Run authority-free Doctor, then follow its next action.",
		executable: "vault-git",
		argvPrefix: ["doctor"],
		selectors: [{ ...TXN, optional: true }],
		argvSuffix: ["--json"],
	},
	// complete family: the transaction is known but the semantic commit subject is
	// not a permitted selector, so these are needs_input contracts the caller
	// completes into a complete invocation.
	complete_transaction: completeContract("Complete the Vault Transaction."),
	continue_transaction: completeContract("Continue the live transaction."),
	// A joiner's work is done once its join succeeds; the outer transaction owner,
	// not this caller, completes. There is no further command for the joiner.
	continue_outer_transaction: {
		kind: "none",
		summary: "Join recorded; the outer transaction owner completes.",
	},
	resume_writing: completeContract("Resume writing, then complete."),
	run_owned_path_checks: completeContract(
		"Run owned-path checks through completion.",
	),
	// change_commit_summary corrects an invalid subject: a needs_input contract.
	change_commit_summary: completeContract("Correct the commit summary."),
	// change_owned_paths is emitted by both begin and join admission; it is routed
	// contextually in resolveEntry (begin -> beginContract, join -> joinContract)
	// and has no static entry so an absent emission_command fails closed.
	//
	// Capability material is private and never a public argv. The owner is grounded
	// in the engine's capability emission sites: the owner/join capability holder,
	// or the internal launcher that reloads it — not a generic operator default.
	use_owner_capability: {
		kind: "needs_human",
		summary: "Re-run the owning command with the owner capability.",
		handoff_kind: "external_prerequisite",
		owner: "transaction_owner",
		condition: "owner_capability_supplied",
	},
	use_join_capability: {
		kind: "needs_human",
		summary: "Re-run join with the join capability.",
		handoff_kind: "external_prerequisite",
		owner: "join_owner",
		condition: "join_capability_supplied",
	},
	reload_capability: {
		kind: "needs_human",
		summary: "Reload the transaction capability through the internal launcher.",
		handoff_kind: "external_prerequisite",
		owner: "private_launcher",
		condition: "transaction_capability_reloaded",
	},
	// Activation-surface continuations.
	prepare_fresh: {
		kind: "invoke",
		summary: "Prepare fresh activation evidence.",
		executable: "vault-git",
		argvPrefix: ["activation", "prepare"],
		selectors: [],
		argvSuffix: ["--json"],
	},
	review_prepared: {
		kind: "needs_human",
		summary: "Open human review for the prepared evidence.",
		handoff_kind: "command",
		executable: "vault-git",
		argvPrefix: ["activation", "review"],
		selectors: [EVIDENCE],
		argvSuffix: ["--json"],
	},
	return_to_human_review: {
		kind: "needs_human",
		summary: "Return to the human review surface for the final choice.",
		handoff_kind: "command",
		executable: "vault-git",
		argvPrefix: ["activation", "review"],
		selectors: [EVIDENCE],
		argvSuffix: ["--json"],
	},
	configure_activation_identity: {
		kind: "needs_human",
		summary: "Configure the host activation identity, then rerun Doctor.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "activation_identity_configured",
	},
	// Operator-review and evidence-preservation handoffs.
	request_operator_review: {
		kind: "needs_human",
		summary: "Ask an operator to review the preserved evidence.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "operator_reviewed_evidence",
	},
	request_operator_takeover: {
		kind: "needs_human",
		summary: "Attest the prior writer stopped, then take over the lease.",
		handoff_kind: "command",
		executable: "vault-git",
		argvPrefix: ["repair", "stale-lease-takeover"],
		selectors: [TXN],
		argvSuffix: ["--prior-writer-stopped", "--json"],
	},
	inspect_private_receipt: {
		kind: "needs_human",
		summary: "Ask an operator to inspect the private receipt.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "private_receipt_inspected",
	},
	preserve_local_edits: {
		kind: "needs_human",
		summary: "Preserve local edits out of band before a fresh transaction.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "local_edits_preserved",
	},
	// retry_push is the legacy alias of the retry-push repair invoke.
	retry_push: {
		kind: "invoke",
		summary: "Retry the push.",
		executable: "vault-git",
		argvPrefix: ["repair", "retry-push"],
		selectors: [TXN],
		argvSuffix: ["--json"],
	},
	// change_input corrections that name a concrete missing task id. The generic
	// usage-failure context names no field and resolves unavailable in resolveEntry.
	correct_completion_task_id: {
		kind: "needs_input",
		summary: "Supply the opaque Completion Task id returned by complete.",
		input_contract_id: "vault-git.completion-task-id",
		fields: [
			{
				id: "task_id",
				input_channel: "public",
				value_kind: "scalar",
				flag: "--task-id",
				validate: (value: string) => {
					if (!PUBLIC_TASK_ID.test(value)) {
						throw new SelectorRejection("invalid task_id value");
					}
				},
			},
		],
		bind: { executable: "vault-git", argvPrefix: ["status"], argvSuffix: ["--json"] },
	},
	correct_doctor_task_id: {
		kind: "needs_input",
		summary: "Supply the opaque Doctor Task id returned by doctor.",
		input_contract_id: "vault-git.doctor-task-id",
		fields: [
			{
				id: "doctor_task_id",
				input_channel: "public",
				value_kind: "scalar",
				flag: "--task-id",
				validate: (value: string) => {
					if (!PUBLIC_DOCTOR_TASK_ID.test(value)) {
						throw new SelectorRejection("invalid doctor_task_id value");
					}
				},
			},
		],
		bind: { executable: "vault-git", argvPrefix: ["doctor"], argvSuffix: ["--json"] },
	},
	// Offline / runtime prerequisites: an owner-owned condition must clear before a
	// safe continuation exists. These are named external prerequisites, not
	// terminal stops.
	capture_private_draft: {
		kind: "needs_human",
		summary: "Preserve the draft locally while offline, then retry when online.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "online_connectivity_restored",
	},
	wait_for_runtime: {
		kind: "needs_human",
		summary: "Wait for the remaining runtime owner before writing.",
		handoff_kind: "external_prerequisite",
		owner: "vault_git_operator",
		condition: "runtime_owner_available",
	},
	none: {
		kind: "none",
		summary: "No further action; this workflow is finished.",
	},
};

/** Every action id owned by the authoritative catalog. */
export const VAULT_GIT_NEXT_SAFE_ACTION_IDS = Object.keys(
	CATALOG,
) as readonly string[];


const SELECTOR_CONTRACTS: Readonly<Record<RequiredSelector, RegExp>> = {
	transaction_id: PUBLIC_TRANSACTION_ID,
	task_id: PUBLIC_TASK_ID,
	doctor_task_id: PUBLIC_DOCTOR_TASK_ID,
	repair_id: PUBLIC_REPAIR_ID,
	// The real prepared-evidence reference format, owned by the activation
	// contract; reused here so the two cannot drift.
	evidence_reference: EVIDENCE_ID,
};

/** Literal, package-owned summary for the fail-closed terminal `none`. */
const UNAVAILABLE_SUMMARY =
	"No safe continuation is available; operator review is required." as const;

/** The single fail-closed projection: terminal `none`, availability unavailable. */
const UNAVAILABLE_PROJECTION: VaultGitNextSafeActionProjection = {
	availability: "unavailable",
	continuation: {
		kind: "none",
		action_id: "none",
		summary: UNAVAILABLE_SUMMARY,
	},
};

function requireSelector(
	selector: RequiredSelector,
	selectors: VaultGitContinuationSelectors | undefined,
): string {
	const value = selectors?.[selector];
	if (value === undefined || value.length === 0) {
		// Incomplete evidence: caller lacks the selector. Fail closed to
		// unavailable without echoing any value.
		throw new SelectorRejection(`missing selector ${selector}`);
	}
	if (!SELECTOR_CONTRACTS[selector].test(value)) {
		// Invalid or private value: never echo it into the message or any result.
		throw new SelectorRejection(`invalid selector ${selector}`);
	}
	return value;
}

/**
 * Build the concrete four-kind continuation for a known catalog entry, stamped
 * with the resolved semantic `actionId` (legacy ids reproject to their semantic
 * id). Throws `SelectorRejection` when a required selector is missing or invalid;
 * the public projector catches that and classifies it to the fail-closed result.
 */
function buildContinuation(
	actionId: string,
	entry: CatalogEntry,
	selectors: VaultGitContinuationSelectors | undefined,
): VaultGitNextSafeActionContinuation {
	if (entry.kind === "invoke") {
		return {
			kind: "invoke",
			action_id: actionId,
			summary: entry.summary,
			executable: entry.executable,
			argv: buildSelectorArgv(entry, selectors),
		};
	}

	if (entry.kind === "needs_input") {
		return {
			kind: "needs_input",
			action_id: actionId,
			summary: entry.summary,
			input_contract_id: entry.input_contract_id,
			// Project only the public descriptor; internal bind metadata never leaks.
			fields: entry.fields.map((field) => ({
				id: field.id,
				input_channel: field.input_channel,
			})),
		};
	}

	if (entry.kind === "needs_human") {
		if (entry.handoff_kind === "command") {
			return {
				kind: "needs_human",
				action_id: actionId,
				summary: entry.summary,
				handoff_kind: "command",
				executable: entry.executable,
				argv: buildSelectorArgv(entry, selectors),
			};
		}
		return {
			kind: "needs_human",
			action_id: actionId,
			summary: entry.summary,
			handoff_kind: "external_prerequisite",
			owner: entry.owner,
			condition: entry.condition,
		};
	}

	return {
		kind: "none",
		action_id: actionId,
		summary: entry.summary,
	};
}

/**
 * Project the single typed continuation for the requested action id.
 *
 * Always returns a projection envelope over the closed four-kind continuation
 * union. An unknown action id, a missing required selector, or a selector value
 * that fails its public contract classifies to `availability: "unavailable"`
 * with a terminal `none` continuation; the enclosing result reads `availability`
 * — never the summary text — to set `continuation_unavailable` and
 * `operator_required`. A rejected selector value is never echoed anywhere.
 *
 * @param request - The action id plus any public selectors it binds.
 * @returns A projection envelope: availability plus one typed continuation.
 */
/**
 * Resolve the semantic action id and catalog entry to project, applying closed
 * contextual reprojection for legacy semantic ids whose continuation depends on
 * emission context. When a context-dependent id is given without the context it
 * needs, returns undefined so the projector fails closed instead of guessing.
 */
function resolveEntry(
	request: VaultGitNextSafeActionRequest,
): { readonly actionId: string; readonly entry: CatalogEntry } | undefined {
	const kind = request.context?.result_kind;
	const bind = (
		actionId: string,
	): { actionId: string; entry: CatalogEntry } | undefined => {
		const entry = Object.hasOwn(CATALOG, actionId)
			? CATALOG[actionId]
			: undefined;
		return entry ? { actionId, entry } : undefined;
	};
	switch (request.action_id) {
		// Legacy inspect_status reprojects to a semantic id by which durable
		// evidence produced it.
		case "inspect_status":
			if (kind === "completion_task") return bind("inspect_completion_task");
			if (kind === "doctor_task") return bind("inspect_doctor_task");
			if (kind === "transaction_receipt") return bind("inspect_transaction");
			return undefined;
		// retry_remote is a begin retry before remote contact, or an inspect-time
		// remote retry through the remote-lease inspection surface. It never loops
		// back to Doctor.
		case "retry_remote":
			if (kind === "begin") return bind("begin_transaction");
			if (kind === "inspect") return bind("inspect_remote_lease");
			return undefined;
		// run_repair carries the exact doctor-classified repair action; project it
		// to that repair's exact command, never a Doctor self-loop.
		case "run_repair": {
			const repairAction = request.context?.repair_action;
			if (repairAction === undefined) return undefined;
			return { actionId: "run_repair", entry: repairEntry(repairAction) };
		}
		// change_input names a concrete task-id correction only when the failing
		// command context identifies which task id was wrong. A generic usage
		// failure names no field and fails closed.
		case "change_input":
			if (kind === "completion_task") return bind("correct_completion_task_id");
			if (kind === "doctor_task") return bind("correct_doctor_task_id");
			return undefined;
		// change_owned_paths is emitted by both begin and join admission. The begin
		// correction needs event + paths; the join correction preserves join-role
		// authority (transaction + paths, no event). Absent the discriminator, fail
		// closed rather than guess.
		case "change_owned_paths": {
			const emission = request.context?.emission_command;
			if (emission === "begin") {
				return {
					actionId: "change_owned_paths",
					entry: beginContract("Correct the owned paths, then begin."),
				};
			}
			if (emission === "join") {
				return {
					actionId: "change_owned_paths",
					entry: joinContract("Correct the joined owned paths."),
				};
			}
			return undefined;
		}
		default:
			return bind(request.action_id);
	}
}

/**
 * Build the catalog entry for a doctor-classified repair action. The four owner
 * repairs are agent-executable invoke continuations; `stale-lease-takeover`
 * carries `--prior-writer-stopped`, a human attestation, so it is a needs_human
 * command handoff and never an agent-executable invoke.
 */
function repairEntry(action: VaultGitRepairAction): CatalogEntry {
	// stale-lease-takeover is the only repair that REQUIRES a transaction id (plus the
	// prior-writer attestation): it cannot resume a receipt, so it fails closed without
	// the selector. Every other repair may resume a pre-acknowledgement receipt with no
	// transaction id (validateInvocation: only takeover requires it), so the
	// transaction id is OPTIONAL — emitted as `--transaction-id <id>` when present, and
	// omitted (a runnable `repair <action> --json`) when absent.
	if (action === "stale-lease-takeover") {
		return {
			kind: "needs_human",
			summary: "Attest the prior writer stopped, then take over the stale lease.",
			handoff_kind: "command",
			executable: "vault-git",
			argvPrefix: ["repair", "stale-lease-takeover"],
			selectors: [TXN],
			argvSuffix: ["--prior-writer-stopped", "--json"],
		};
	}
	return {
		kind: "invoke",
		summary: `Run the ${action} repair.`,
		executable: "vault-git",
		argvPrefix: ["repair", action],
		selectors: [{ ...TXN, optional: true }],
		argvSuffix: ["--json"],
	};
}

export function projectVaultGitNextSafeAction(
	request: VaultGitNextSafeActionRequest,
): VaultGitNextSafeActionProjection {
	const resolved = resolveEntry(request);
	if (resolved === undefined) {
		return UNAVAILABLE_PROJECTION;
	}
	// A feature-gated catalog entry targets a command that only becomes executable
	// once its product feature ships; until then it fails closed exactly like any
	// other unavailable projection, so no caller executes an unreal command. The
	// gate is catalog-owned metadata (requiresFeature), never a public state.
	if (
		(resolved.entry.kind === "invoke" ||
			resolved.entry.kind === "needs_input") &&
		resolved.entry.requiresFeature !== undefined
	) {
		return UNAVAILABLE_PROJECTION;
	}
	try {
		return {
			availability: "available",
			continuation: buildContinuation(
				resolved.actionId,
				resolved.entry,
				request.selectors,
			),
		};
	} catch (error) {
		if (error instanceof SelectorRejection) {
			return UNAVAILABLE_PROJECTION;
		}
		throw error;
	}
}

/**
 * The legacy action reference a lifecycle result carries: a stable public action
 * id plus an optional human summary and the public selectors/context needed to
 * project its authoritative continuation. Callers (the CLI `action()` composer)
 * supply only this; the composer derives everything else exactly once.
 */
export interface VaultGitNextActionRef {
	readonly id: VaultGitNextActionId;
	readonly summary?: string;
	readonly selectors?: VaultGitContinuationSelectors;
	readonly context?: VaultGitContinuationContext;
}

/** Thrown when a supplied already-built next-action diverges from its projection. */
export class VaultGitNextActionDivergenceError extends Error {}

/**
 * Project one legacy action reference into the authoritative Next Safe Action
 * union carried by a public result. The union's discriminant and authoritative
 * fields (`action_id`, `argv`, owner/condition, input contract) come from the
 * single catalog projection; the compat `id` is the supplied public action id and
 * the compat `summary` is the supplied summary or the catalog default. An
 * unavailable projection fails closed to a terminal `none` union carrying the
 * fail-closed summary, so no caller executes an unreal command.
 *
 * @param ref - The legacy action reference (public id + optional summary/context).
 * @returns The authoritative union with derived compat id + summary.
 */
export function projectVaultGitNextAction(
	ref: VaultGitNextActionRef,
): VaultGitNextAction {
	return projectNextActionWithAvailability(ref).union;
}

/**
 * Project the union and report whether the catalog projection was available, so
 * the composer can fail closed when a non-terminal action could not resolve to an
 * executable continuation (unknown id, missing selector, or missing context).
 */
function projectNextActionWithAvailability(ref: VaultGitNextActionRef): {
	readonly union: VaultGitNextAction;
	readonly available: boolean;
} {
	const projection = projectVaultGitNextSafeAction({
		action_id: ref.id,
		...(ref.selectors ? { selectors: ref.selectors } : {}),
		...(ref.context ? { context: ref.context } : {}),
	});
	const continuation = projection.continuation;
	// Compat summary: caller override, else the projected continuation's summary,
	// else (fail-closed) the terminal none summary.
	const summary = ref.summary ?? continuation.summary;
	// Compat id is always the supplied public action id existing consumers read; it
	// stays stable even when the semantic projection is unavailable (the union then
	// carries kind "none" and action_id "none", but the public id is preserved).
	const compatId: VaultGitNextActionId = ref.id;
	const available = projection.availability === "available";
	let union: VaultGitNextAction;
	switch (continuation.kind) {
		case "invoke":
			union = {
				kind: "invoke",
				id: compatId,
				action_id: continuation.action_id,
				summary,
				executable: continuation.executable,
				argv: continuation.argv,
			};
			break;
		case "needs_input":
			union = {
				kind: "needs_input",
				id: compatId,
				action_id: continuation.action_id,
				summary,
				input_contract_id: continuation.input_contract_id,
				fields: continuation.fields,
			};
			break;
		case "needs_human":
			union =
				continuation.handoff_kind === "command"
					? {
							kind: "needs_human",
							id: compatId,
							action_id: continuation.action_id,
							summary,
							handoff_kind: "command",
							executable: continuation.executable,
							argv: continuation.argv,
						}
					: {
							kind: "needs_human",
							id: compatId,
							action_id: continuation.action_id,
							summary,
							handoff_kind: "external_prerequisite",
							owner: continuation.owner,
							condition: continuation.condition,
						};
			break;
		default:
			union = {
				kind: "none",
				id: compatId,
				action_id: continuation.action_id,
				summary,
			};
	}
	return { union, available };
}

/**
 * Closed catalog-owned mapping from a semantic Next Safe Action id back to the
 * stable public compatibility id existing consumers read. A semantic id that was
 * reprojected from a legacy id maps back to that legacy id; every other id is its
 * own compat id. Owned here so the split and its inverse cannot drift apart.
 */
const SEMANTIC_TO_COMPAT_ID: Readonly<Record<string, VaultGitNextActionId>> = {
	inspect_completion_task: "inspect_status",
	inspect_doctor_task: "inspect_status",
	inspect_transaction: "inspect_status",
	correct_completion_task_id: "change_input",
	correct_doctor_task_id: "change_input",
};

/**
 * Rehydrate a persisted semantic Next Safe Action id into a real union. Validates
 * the id against the catalog, projects its exact continuation with the supplied
 * selectors, and stamps the canonical compatibility id via the closed
 * semantic->compat mapping. A semantic id absent from the catalog, or whose
 * projection is unavailable, fails closed to a terminal none carrying the derived
 * compat id — no cast through the legacy action() path, which would throw or lie for
 * a deliberately non-legacy id like inspect_doctor_task.
 *
 * @param semanticId - The durable semantic action id (a Next Safe Action catalog id).
 * @param selectors - Public selectors the continuation binds (e.g. doctor_task_id).
 * @param summary - Optional human summary; the catalog default is used when absent.
 * @returns The authoritative union with the canonical compat id stamped.
 */
export function rehydrateVaultGitPersistedNextAction(
	semanticId: string,
	selectors?: VaultGitContinuationSelectors,
	summary?: string,
): VaultGitNextAction {
	// The compat id is the closed semantic->compat mapping when the semantic id was
	// reprojected from a legacy id; otherwise the id itself only when it is a real
	// public (compatibility) id.
	const mappedCompatId = Object.hasOwn(SEMANTIC_TO_COMPAT_ID, semanticId)
		? SEMANTIC_TO_COMPAT_ID[semanticId]
		: undefined;
	// Fail-closed: a persisted id with no compatibility contract — neither in the
	// semantic->compat mapping nor a public compatibility id — has no public identity,
	// so it must NOT become a runnable continuation. Return a full terminal none (a
	// corrupted or future durable id can never be executed without a contract).
	if (mappedCompatId === undefined && !isVaultGitNextActionId(semanticId)) {
		return {
			kind: "none",
			id: "none",
			action_id: "none",
			summary: summary ?? UNAVAILABLE_SUMMARY,
		};
	}
	// Here semanticId is either mapped, or a proven public compatibility id (the guard
	// above narrows the else branch), so no cast is needed.
	const compatId: VaultGitNextActionId =
		mappedCompatId ?? (isVaultGitNextActionId(semanticId) ? semanticId : "none");
	const projection = projectVaultGitNextSafeAction({
		action_id: semanticId,
		...(selectors ? { selectors } : {}),
	});
	const continuation = projection.continuation;
	const resolvedSummary = summary ?? continuation.summary;
	switch (continuation.kind) {
		case "invoke":
			return {
				kind: "invoke",
				id: compatId,
				action_id: continuation.action_id,
				summary: resolvedSummary,
				executable: continuation.executable,
				argv: continuation.argv,
			};
		case "needs_input":
			return {
				kind: "needs_input",
				id: compatId,
				action_id: continuation.action_id,
				summary: resolvedSummary,
				input_contract_id: continuation.input_contract_id,
				fields: continuation.fields,
			};
		case "needs_human":
			return continuation.handoff_kind === "command"
				? {
						kind: "needs_human",
						id: compatId,
						action_id: continuation.action_id,
						summary: resolvedSummary,
						handoff_kind: "command",
						executable: continuation.executable,
						argv: continuation.argv,
					}
				: {
						kind: "needs_human",
						id: compatId,
						action_id: continuation.action_id,
						summary: resolvedSummary,
						handoff_kind: "external_prerequisite",
						owner: continuation.owner,
						condition: continuation.condition,
					};
		default:
			return {
				kind: "none",
				id: compatId,
				action_id: continuation.action_id,
				summary: resolvedSummary,
			};
	}
}

/**
 * The next-action a lifecycle result carries into the composer: either a legacy
 * reference to project, or an already-built authoritative union. A ref is derived
 * fresh; an already-built union is reprojected from its own compat id + explicit
 * selectors/context and rejected if it diverges.
 */
export type VaultGitComposedNextAction = VaultGitNextActionRef | VaultGitNextAction;

/** Payload accepted by the composer: the core payload with the composed next-action. */
export type VaultGitLifecycleResultComposeInput = Omit<
	VaultGitLifecycleResultPayload,
	"next_action"
> & {
	readonly next_action: VaultGitComposedNextAction;
	/**
	 * Explicit selectors/context to reproject an already-built union for divergence
	 * checking. Ignored when `next_action` is a legacy ref (which carries its own).
	 */
	readonly nextActionSelectors?: VaultGitContinuationSelectors;
	readonly nextActionContext?: VaultGitContinuationContext;
};

/** An already-built next-action union carries a discriminant `kind`. */
function isBuiltNextAction(
	value: VaultGitComposedNextAction,
): value is VaultGitNextAction {
	return "kind" in value;
}

/**
 * The public U1 lifecycle-result construction path. When `next_action` is a legacy
 * ref, project the authoritative union exactly once and derive its compat fields.
 * When it is an already-built union, reproject from its compat id plus explicit
 * selectors/context and reject any divergence in kind, semantic action_id, or the
 * kind-specific authoritative fields (invoke/command argv by exact array, external
 * prerequisite owner/condition). A custom human summary is always allowed and only
 * needs to be non-empty (enforced by the core constructor). Every public result
 * flows through here so `data.next_action`, facade runtime actions, the
 * continuation envelope, and human text all derive from one union.
 *
 * @param input - The core payload plus its composed next-action.
 * @returns The validated payload whose `next_action` is the authoritative union.
 * @throws {VaultGitNextActionDivergenceError} When an already-built union diverges.
 */
export function composeVaultGitLifecycleResult(
	input: VaultGitLifecycleResultComposeInput,
): VaultGitLifecycleResultPayload {
	const composed = input.next_action;
	// Derive projection inputs from the core payload so a bare action ref projects
	// its authoritative continuation without threading selectors through every call
	// site. Explicit ref/input selectors and context override the payload-derived
	// values.
	const payloadSelectors = selectorsFromPayload(input);
	const payloadContext = contextFromPayload(input);
	let nextAction: VaultGitNextAction;
	let available: boolean;
	let requestedId: string;
	if (isBuiltNextAction(composed)) {
		const selectors = { ...payloadSelectors, ...input.nextActionSelectors };
		const context = { ...payloadContext, ...input.nextActionContext };
		const projected = projectNextActionWithAvailability({
			id: composed.id,
			...(hasAny(selectors) ? { selectors } : {}),
			...(hasAny(context) ? { context } : {}),
		});
		assertNoDivergence(composed, projected.union);
		// Preserve the caller's custom summary; adopt the authoritative fields.
		nextAction = { ...projected.union, summary: composed.summary };
		available = projected.available;
		requestedId = composed.id;
	} else {
		const selectors = { ...payloadSelectors, ...composed.selectors };
		const context = { ...payloadContext, ...composed.context };
		const projected = projectNextActionWithAvailability({
			id: composed.id,
			...(composed.summary !== undefined ? { summary: composed.summary } : {}),
			...(hasAny(selectors) ? { selectors } : {}),
			...(hasAny(context) ? { context } : {}),
		});
		nextAction = projected.union;
		available = projected.available;
		requestedId = composed.id;
	}
	const {
		nextActionSelectors: _selectors,
		nextActionContext: _context,
		...core
	} = input;
	// Fail-closed contract: a non-terminal action that could not be projected to an
	// executable continuation must surface as a visible blocker, never a silent
	// semantic degradation. The explicit terminal `none` is a legitimate stop.
	if (!available && requestedId !== "none") {
		return createVaultGitLifecycleResult({
			...core,
			blockers: appendBlocker(core.blockers, "continuation_unavailable"),
			retry_safety: "operator_required",
			next_action: nextAction,
		});
	}
	return createVaultGitLifecycleResult({ ...core, next_action: nextAction });
}

/** Append a blocker once, preserving order and existing entries. */
function appendBlocker(
	blockers: readonly VaultGitBlockerId[],
	blocker: VaultGitBlockerId,
): readonly VaultGitBlockerId[] {
	return blockers.includes(blocker) ? blockers : [...blockers, blocker];
}

/** Whether an object has at least one defined own value. */
function hasAny(value: Record<string, unknown>): boolean {
	return Object.values(value).some((v) => v !== undefined);
}

/**
 * Public selectors carried by the core payload, for projecting its next action. A
 * `doctor_task_`-prefixed task id is also offered as the doctor_task_id selector so
 * a Doctor Task inspect_doctor_task continuation binds it; a plain `task_` id is a
 * Completion Task selector only.
 */
function selectorsFromPayload(
	payload: Omit<VaultGitLifecycleResultComposeInput, "next_action">,
): VaultGitContinuationSelectors {
	const taskId = payload.task_id;
	const isDoctorTask = taskId?.startsWith("doctor_task_") ?? false;
	return {
		...(payload.transaction_id ? { transaction_id: payload.transaction_id } : {}),
		...(taskId && !isDoctorTask ? { task_id: taskId } : {}),
		...(taskId && isDoctorTask ? { doctor_task_id: taskId } : {}),
	};
}

/** Best-effort continuation context derived from core payload fields. */
function contextFromPayload(
	payload: Omit<VaultGitLifecycleResultComposeInput, "next_action">,
): VaultGitContinuationContext {
	return {
		...(payload.repair_action ? { repair_action: payload.repair_action } : {}),
	};
}

/** Exact array equality: same length and element-by-element strict equality. */
function argvEqual(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Reject an already-built union whose authoritative fields diverge from a fresh
 * projection of its own compat id and context. Kind, semantic action_id, and the
 * kind-specific authoritative fields must match; argv is compared as an exact array
 * (never a joined string, which admits delimiter collisions).
 */
function assertNoDivergence(
	built: VaultGitNextAction,
	authoritative: VaultGitNextAction,
): void {
	const diverge = (detail: string): never => {
		throw new VaultGitNextActionDivergenceError(
			`supplied next_action diverges from its projection: ${detail}`,
		);
	};
	if (built.kind !== authoritative.kind) diverge("kind");
	if (built.action_id !== authoritative.action_id) diverge("action_id");
	if (built.kind === "invoke" && authoritative.kind === "invoke") {
		if (built.executable !== authoritative.executable) diverge("executable");
		if (!argvEqual(built.argv, authoritative.argv)) diverge("argv");
	}
	if (built.kind === "needs_human" && authoritative.kind === "needs_human") {
		if (built.handoff_kind !== authoritative.handoff_kind) diverge("handoff_kind");
		if (
			built.handoff_kind === "command" &&
			authoritative.handoff_kind === "command"
		) {
			if (built.executable !== authoritative.executable) diverge("executable");
			if (!argvEqual(built.argv, authoritative.argv)) diverge("argv");
		}
		if (
			built.handoff_kind === "external_prerequisite" &&
			authoritative.handoff_kind === "external_prerequisite"
		) {
			if (built.owner !== authoritative.owner) diverge("owner");
			if (built.condition !== authoritative.condition) diverge("condition");
		}
	}
	if (built.kind === "needs_input" && authoritative.kind === "needs_input") {
		if (built.input_contract_id !== authoritative.input_contract_id) {
			diverge("input_contract_id");
		}
	}
}

/** One ordered public input entry supplied to the public binder. */
export interface VaultGitPublicInputEntry {
	readonly id: string;
	/** A scalar public value, or a list value for a repeating field. */
	readonly value: string | readonly string[];
}

/** Thrown by the public input binder when supplied entries violate the contract. */
export class VaultGitPublicInputError extends Error {}

/**
 * Refuse a supplied needs_input continuation that diverges from the authoritative
 * catalog projection: mismatched summary, contract id, field count, ordered field
 * ids, or input channels. This runs before any value is read, so a forged or
 * stale descriptor can never drive a binding.
 */
function assertNeedsInputMatchesCatalog(
	continuation: VaultGitNeedsInputContinuation,
	entry: Extract<CatalogEntry, { kind: "needs_input" }>,
): void {
	const diverge = (detail: string): never => {
		throw new VaultGitPublicInputError(
			`divergent needs_input descriptor: ${detail}`,
		);
	};
	if (continuation.summary !== entry.summary) diverge("summary");
	if (continuation.input_contract_id !== entry.input_contract_id) {
		diverge("input_contract_id");
	}
	if (continuation.fields.length !== entry.fields.length) diverge("field count");
	for (let index = 0; index < entry.fields.length; index += 1) {
		const supplied = continuation.fields[index];
		const authoritative = entry.fields[index];
		if (supplied.id !== authoritative.id) diverge(`field id at ${index}`);
		if (supplied.input_channel !== authoritative.input_channel) {
			diverge(`field channel at ${index}`);
		}
	}
}

/**
 * Bind ordered public input entries into the complete sanitized invoke.
 *
 * The pure public-input lane: it validates entries against the continuation's
 * public descriptors — refusing missing, extra, duplicate, or unknown field ids,
 * a private contract, a wrong value type, or an invalid value — and emits one
 * argument per list element (never a joined value). It touches no process and no
 * private lane; a private-input contract is refused, not bound here.
 *
 * @param continuation - A public `needs_input` continuation from the catalog.
 * @param entries - Ordered public input entries, one per field id.
 * @returns The complete sanitized invoke continuation.
 * @throws {VaultGitPublicInputError} When the entries violate the public contract.
 *
 * @example
 * ```typescript
 * const { continuation } = projectVaultGitNextSafeAction({ action_id: "begin_transaction" });
 * if (continuation.kind === "needs_input") {
 *   bindVaultGitPublicInput(continuation, [
 *     { id: "event", value: "note_created" },
 *     { id: "owned_paths", value: ["notes/one.md"] },
 *   ]);
 * }
 * ```
 */
export function bindVaultGitPublicInput(
	continuation: VaultGitNeedsInputContinuation,
	entries: readonly VaultGitPublicInputEntry[],
	binding?: {
		readonly selectors?: VaultGitContinuationSelectors;
		readonly context?: VaultGitContinuationContext;
	},
): VaultGitInvokeContinuation {
	const entry = resolveEntry({
		action_id: continuation.action_id,
		...(binding?.context ? { context: binding.context } : {}),
	})?.entry;
	if (entry === undefined || entry.kind !== "needs_input") {
		throw new VaultGitPublicInputError(
			`${continuation.action_id} is not a needs_input action`,
		);
	}
	// Reject a forged or stale continuation before reading any value: the supplied
	// descriptor must match the authoritative catalog projection exactly.
	assertNeedsInputMatchesCatalog(continuation, entry);
	if (entry.bind === undefined || entry.fields.some((f) => f.input_channel !== "public")) {
		throw new VaultGitPublicInputError(
			`${continuation.action_id} is a private input contract; use the Setup binder`,
		);
	}

	const seen = new Set<string>();
	for (const supplied of entries) {
		if (seen.has(supplied.id)) {
			throw new VaultGitPublicInputError(`duplicate field id ${supplied.id}`);
		}
		seen.add(supplied.id);
		if (!entry.fields.some((field) => field.id === supplied.id)) {
			throw new VaultGitPublicInputError(`unknown field id ${supplied.id}`);
		}
	}

	const argv = [...entry.bind.argvPrefix];

	// Required selectors come from durable/result context, not re-entered input.
	// Revalidate them and emit them ahead of the supplied input fields.
	for (const { selector, flag } of entry.requiredSelectors ?? []) {
		let value: string;
		try {
			value = requireSelector(selector, binding?.selectors);
		} catch {
			throw new VaultGitPublicInputError(`missing or invalid selector ${selector}`);
		}
		if (flag === "") argv.push(value);
		else argv.push(flag, value);
	}

	const event = binding?.context?.event;
	const byId = new Map(entries.map((e) => [e.id, e.value]));
	for (const field of entry.fields) {
		if (field.input_channel !== "public") continue;
		if (!byId.has(field.id)) {
			throw new VaultGitPublicInputError(`missing field id ${field.id}`);
		}
		const value = byId.get(field.id);
		if (field.value_kind === "list") {
			if (!Array.isArray(value)) {
				throw new VaultGitPublicInputError(
					`field ${field.id} requires a list value`,
				);
			}
			if (value.length === 0) {
				throw new VaultGitPublicInputError(
					`field ${field.id} requires at least one value`,
				);
			}
			for (const item of value) {
				if (typeof item !== "string") {
					throw new VaultGitPublicInputError(
						`field ${field.id} values must be strings`,
					);
				}
				try {
					field.validate(item, event);
				} catch {
					throw new VaultGitPublicInputError(`invalid value for ${field.id}`);
				}
				argv.push(field.flag, item);
			}
		} else {
			if (typeof value !== "string") {
				throw new VaultGitPublicInputError(
					`field ${field.id} requires a scalar value`,
				);
			}
			try {
				field.validate(value, event);
			} catch {
				throw new VaultGitPublicInputError(`invalid value for ${field.id}`);
			}
			argv.push(field.flag, value);
		}
	}
	argv.push(...entry.bind.argvSuffix);

	return {
		kind: "invoke",
		action_id: continuation.action_id,
		summary: entry.summary,
		executable: entry.bind.executable,
		argv,
	};
}

/** A public reference to a private continuation, carrying no private values. */
export interface VaultGitPrivateSetupContinuationRef {
	readonly action_id: string;
}

/** One private input value supplied out of band to the private Setup binder. */
export interface VaultGitPrivateSetupInputEntry {
	readonly id: string;
	readonly value: string;
}

/**
 * Injected Setup discovery result. The real Setup vault-git domain adapter (a
 * later product feature) supplies this; U1 proves the binder derives argv from
 * it rather than hard-coding a command.
 */
export interface VaultGitSetupDiscoveryResult {
	readonly action_argv: readonly string[];
	readonly input_contract_id: string;
	readonly fields: readonly VaultGitInputFieldDescriptor[];
}

/** Sanitized public Setup result surface (no private values). */
export type VaultGitSetupResult = Readonly<Record<string, unknown>>;

/** Injected child spawn: streams a stdin envelope, returns a sanitized result. */
export type VaultGitSetupSpawn = (input: {
	readonly argv: readonly string[];
	readonly stdin: string;
}) => Promise<VaultGitSetupResult>;

/** Thrown by the private Setup binder; its message never echoes a private value. */
export class VaultGitPrivateSetupError extends Error {}

/** Redact any supplied private value from an outward-facing string. */
function redactPrivateValues(text: string, values: readonly string[]): string {
	let scrubbed = text;
	for (const needle of privateValueNeedles(values)) {
		scrubbed = scrubbed.split(needle).join("[redacted]");
	}
	return scrubbed;
}

/** Raw and JSON-string escaped forms that may appear in child output. */
function privateValueNeedles(values: readonly string[]): readonly string[] {
	const needles = new Set<string>();
	for (const value of values) {
		if (value.length === 0) continue;
		needles.add(value);
		needles.add(JSON.stringify(value).slice(1, -1));
	}
	return [...needles].sort((left, right) => right.length - left.length);
}

/**
 * Private Setup input lane: validate private values against the referenced
 * contract, derive the Setup action argv from injected discovery, append exactly
 * `--input-stdin <contract-id>`, stream a structured (canonical-JSON, field-keyed)
 * stdin envelope through the injected child spawn, and return only the sanitized
 * Setup result. Private values never enter argv, the returned result, a thrown
 * error, or any serialization — a hostile spawn result or error is redacted.
 *
 * @param ref - Public reference to the private continuation (no values).
 * @param values - Ordered private input entries supplied out of band.
 * @param deps - Injected Setup discovery result and child spawn.
 * @returns The sanitized Setup result.
 * @throws {VaultGitPrivateSetupError} On a divergent contract, a public lane, an
 *   invalid/missing/extra/duplicate field, or a redacted downstream failure.
 */
export async function bindVaultGitPrivateSetupInput(
	ref: VaultGitPrivateSetupContinuationRef,
	values: readonly VaultGitPrivateSetupInputEntry[],
	deps: {
		readonly discovery: VaultGitSetupDiscoveryResult;
		readonly spawn: VaultGitSetupSpawn;
	},
): Promise<VaultGitSetupResult> {
	const suppliedValues = values.map((entry) => entry.value);
	const fail = (detail: string): never => {
		throw new VaultGitPrivateSetupError(
			redactPrivateValues(`private Setup input: ${detail}`, suppliedValues),
		);
	};

	const entry = Object.hasOwn(CATALOG, ref.action_id)
		? CATALOG[ref.action_id]
		: undefined;
	if (entry === undefined || entry.kind !== "needs_input") {
		fail(`${ref.action_id} is not a needs_input action`);
	}
	const needsInput = entry as Extract<CatalogEntry, { kind: "needs_input" }>;

	// This lane owns only all-private contracts.
	if (!needsInput.fields.every((field) => field.input_channel === "private_stdin")) {
		fail(`${ref.action_id} is not a private input contract; use the public binder`);
	}

	// Divergence: injected discovery must match the authoritative catalog contract.
	if (deps.discovery.input_contract_id !== needsInput.input_contract_id) {
		fail("divergent discovery input_contract_id");
	}
	const expectedArgv = needsInput.setupActionArgv;
	if (
		expectedArgv === undefined ||
		deps.discovery.action_argv.length !== expectedArgv.length ||
		deps.discovery.action_argv.some((token, index) => token !== expectedArgv[index])
	) {
		fail("divergent discovery action_argv");
	}
	if (deps.discovery.fields.length !== needsInput.fields.length) {
		fail("divergent discovery field count");
	}
	for (let index = 0; index < needsInput.fields.length; index += 1) {
		const discovered = deps.discovery.fields[index];
		const authoritative = needsInput.fields[index];
		if (discovered.id !== authoritative.id) fail(`divergent discovery field id at ${index}`);
		if (discovered.input_channel !== authoritative.input_channel) {
			fail(`divergent discovery field channel at ${index}`);
		}
	}

	// Validate supplied values against the contract: no missing/extra/duplicate.
	const seen = new Set<string>();
	for (const supplied of values) {
		if (seen.has(supplied.id)) fail(`duplicate field id ${supplied.id}`);
		seen.add(supplied.id);
		if (!needsInput.fields.some((field) => field.id === supplied.id)) {
			fail(`unknown field id ${supplied.id}`);
		}
	}
	const byId = new Map(values.map((entry) => [entry.id, entry.value]));
	const envelope: Record<string, string> = {};
	for (const field of needsInput.fields) {
		if (!byId.has(field.id)) fail(`missing field id ${field.id}`);
		if (field.input_channel !== "private_stdin") {
			return fail(`field ${field.id} is not a private field`);
		}
		const value = byId.get(field.id) as string;
		try {
			field.validate(value);
		} catch {
			fail(`invalid value for ${field.id}`);
		}
		envelope[field.id] = value;
	}

	// Derive argv from discovery; append exactly one --input-stdin <contract-id>.
	const argv = [
		...deps.discovery.action_argv,
		"--input-stdin",
		needsInput.input_contract_id,
	];
	// Structured, unambiguous stdin envelope so an embedded newline cannot change
	// field boundaries.
	const stdin = JSON.stringify(envelope);

	let result: VaultGitSetupResult;
	try {
		result = await deps.spawn({ argv, stdin });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new VaultGitPrivateSetupError(
			redactPrivateValues(`Setup process failed: ${message}`, suppliedValues),
		);
	}

	// Sanitize a hostile result that echoes a private value back outward.
	const serialized = JSON.stringify(result);
	if (privateValueNeedles(suppliedValues).some((needle) => serialized.includes(needle))) {
		throw new VaultGitPrivateSetupError(
			"Setup process returned a result carrying private input; refusing to surface it",
		);
	}
	return result;
}
