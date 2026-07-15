import type {
	CommandFacadeSideEffect,
	RuntimeActionGuidance,
	RuntimeContinuationConstraint,
	RuntimeRecoveryChoice,
} from "@side-quest/cli-command-facade";

import {
	BROWSER_CONNECT_ADAPTER_IDS,
	type BrowserConnectAdapterId,
} from "./adapters/registry.ts";
import type { BrowserConnectCommand } from "./command-contract.ts";
import {
	BROWSER_CONNECT_SAFE_VERSION_PATTERN as SAFE_VERSION_PATTERN,
	type BrowserConnectFailureActionId,
	type BrowserConnectFailureClass,
	type BrowserConnectIsolatedInstallEvidence,
	type BrowserConnectRepairCause,
	type BrowserConnectRepairChainHop,
	type BrowserConnectRepairContext,
	type BrowserConnectSuggestedPortEvidence,
	browserConnectFailureActions,
} from "./model.ts";

// ---------------------------------------------------------------------------
// Recovery policy owner (KTD3): one plain module of switches and small
// records. Selection is exhaustive over the 12 failure classes and their
// typed causes (R4) — every class switch ends in a `never` assignment, so an
// unhandled class is a compile error, while out-of-contract runtime values
// fail closed to an operator stage (R9). Gateways own bounded transient
// retries BEFORE projection (KTD12); this module never emits re-proof or
// re-probe actions (KTD14) and never ingests listener ownership (R32/KTD19).
// ---------------------------------------------------------------------------

/**
 * Repair Action Contract version (R14/KTD5). Versioned docs fragments are
 * append-only: an incompatible procedure change mints a new version prefix,
 * never a rewritten `v1` heading.
 *
 * @defaultValue "v1"
 */
export const BROWSER_CONNECT_REPAIR_CONTRACT_VERSION = "v1" as const;

/**
 * Public, main-branch REPAIR.md base URL (R14). Heading publication on main
 * gates binary release; the URL shape itself is package-owned and stable.
 */
export const BROWSER_CONNECT_REPAIR_DOCS_BASE_URL =
	"https://github.com/nathanvale/claude-code-config/blob/main/runtime/browser-connect/REPAIR.md" as const;

/**
 * Build the versioned public docs URL for a stable action id (R2/R14/KTD5):
 * contract version plus action id, nothing derived from runtime state.
 *
 * @param actionId - Stable repair action id
 * @returns Absolute `REPAIR.md#v1-<action-id>` URL
 */
export function browserConnectRepairDocsUrl(
	actionId: BrowserConnectFailureActionId,
): string {
	return `${BROWSER_CONNECT_REPAIR_DOCS_BASE_URL}#${BROWSER_CONNECT_REPAIR_CONTRACT_VERSION}-${actionId}`;
}

/**
 * Continuation Constraint Catalogue ids (R25). Every recovery posture emits
 * all applicable entries; every operator stage names at least one.
 */
export const BROWSER_CONNECT_CONTINUATION_CONSTRAINT_IDS = [
	"no_adapter_fallback",
	"no_internal_port_switch",
	"no_unverified_listener_connection",
	"no_process_destruction",
	"no_pin_policy_change",
	"no_cross_invocation_retry",
	"no_synthesized_caller_input",
	"no_mutation_from_diagnostics",
] as const;

/**
 * Continuation constraint id union.
 */
export type BrowserConnectContinuationConstraintId =
	(typeof BROWSER_CONNECT_CONTINUATION_CONSTRAINT_IDS)[number];

/**
 * Continuation Constraint Catalogue records (R25). Mechanical forbids are
 * deliberately minimal so no catalogue constraint conflicts with a stage's
 * own next action or choices; the facade rejects such conflicts.
 */
export const browserConnectContinuationConstraints: Record<
	BrowserConnectContinuationConstraintId,
	RuntimeContinuationConstraint
> = {
	no_adapter_fallback: {
		id: "no_adapter_fallback",
		summary:
			"Do not switch to adapter discovery, a cold browser, or another browser environment after proof failure.",
		forbidden_action_ids: ["select_compatible_route"],
	},
	no_internal_port_switch: {
		id: "no_internal_port_switch",
		summary:
			"The failed invocation cannot consume the suggested explicit port; only a fresh explicit invocation may use it.",
	},
	no_unverified_listener_connection: {
		id: "no_unverified_listener_connection",
		summary:
			"Never attach to, replace, or treat an unverified listener as Agent Chrome.",
	},
	no_process_destruction: {
		id: "no_process_destruction",
		summary:
			"browser-connect cannot stop, kill, replace, or free a process-owned port, and accepts no external ownership evidence as authority.",
		forbidden_side_effects: ["destructive"],
	},
	no_pin_policy_change: {
		id: "no_pin_policy_change",
		summary:
			"Automatic recovery cannot edit or reinterpret an Adapter Definition pin.",
		forbidden_action_ids: ["adjust_adapter_pin"],
	},
	no_cross_invocation_retry: {
		id: "no_cross_invocation_retry",
		summary:
			"No fresh invocation can claim or reset an earlier transient retry budget; a repair-chain hop of one forbids another suggested-port action.",
		forbidden_action_ids: ["use_suggested_port"],
	},
	no_synthesized_caller_input: {
		id: "no_synthesized_caller_input",
		summary:
			"Corrected input, wrapped commands, and replacement identities stay caller-owned; policy never synthesizes them from error prose or installed state.",
	},
	no_mutation_from_diagnostics: {
		id: "no_mutation_from_diagnostics",
		summary:
			"Diagnostic inspection alone never authorizes mutation; only a fresh typed cause selects the next repair.",
		forbidden_side_effects: ["write", "destructive"],
	},
};

/**
 * Allowed postures for a repair action (Repair Action Contract identity row).
 */
export type BrowserConnectRepairActionPosture =
	| "automatic"
	| "operator-choice"
	| "compatibility-only";

/**
 * Executable owner for a repair action (R19/KTD9): every automatic action
 * names a non-interactive owner or a deterministic caller-rerun recipe.
 */
export type BrowserConnectRepairActionOwner =
	| "caller_rerun"
	| "gateway"
	| "repair_adapter_command"
	| "operator"
	| "legacy_discovery";

/**
 * Repair Action Contract record (R17): selection causes, required typed
 * inputs, owner, side effects, retry posture, success evidence, stop
 * condition, and the versioned public docs anchor.
 */
export type BrowserConnectRepairActionDefinition = {
	id: BrowserConnectFailureActionId;
	postures: readonly BrowserConnectRepairActionPosture[];
	selection_causes: readonly BrowserConnectRepairCause[];
	required_context: readonly string[];
	owner: BrowserConnectRepairActionOwner;
	side_effects: readonly CommandFacadeSideEffect[];
	retry: {
		same_input_safe: boolean;
		attempt_budget: 0 | 1;
		exhausted_posture: "operator";
	};
	success_evidence: string;
	stop_condition: string;
	docs_url: string;
};

const failureActionById = new Map(
	browserConnectFailureActions.map((action) => [action.id, action]),
);

function modelSideEffects(
	actionId: BrowserConnectFailureActionId,
): readonly CommandFacadeSideEffect[] {
	const action = failureActionById.get(actionId);
	if (!action) {
		throw new Error(`missing model affordance for action id ${actionId}`);
	}
	return action.sideEffects;
}

/**
 * Complete Repair Action Catalogue (R17): one contract record per stable
 * action id. Side effects mirror the model affordance catalog exactly.
 */
export const browserConnectRepairActionDefinitions: Record<
	BrowserConnectFailureActionId,
	BrowserConnectRepairActionDefinition
> = {
	change_input: {
		id: "change_input",
		postures: ["automatic", "operator-choice"],
		selection_causes: ["usage_invalid", "unregistered_adapter"],
		required_context: [
			"deterministic_correction",
			"deterministic_replacement_adapter_id",
		],
		owner: "caller_rerun",
		side_effects: modelSideEffects("change_input"),
		retry: { same_input_safe: true, attempt_budget: 1, exhausted_posture: "operator" },
		success_evidence: "The fresh invocation parses and reaches its next gate.",
		stop_condition:
			"A missing replacement or multiple valid replacements requires operator input.",
		docs_url: browserConnectRepairDocsUrl("change_input"),
	},
	add_run_separator: {
		id: "add_run_separator",
		postures: ["automatic", "operator-choice"],
		selection_causes: ["separator_missing", "wrapped_command_missing"],
		required_context: ["wrapped_command_present"],
		owner: "caller_rerun",
		side_effects: modelSideEffects("add_run_separator"),
		retry: { same_input_safe: true, attempt_budget: 1, exhausted_posture: "operator" },
		success_evidence: "The rerun invocation reaches the pre-exec connection gate.",
		stop_condition: "An empty or unknown wrapped command requires operator input.",
		docs_url: browserConnectRepairDocsUrl("add_run_separator"),
	},
	launch_agent_chrome: {
		id: "launch_agent_chrome",
		postures: ["automatic"],
		selection_causes: ["no_listener"],
		required_context: ["explicit_port_free"],
		owner: "gateway",
		side_effects: modelSideEffects("launch_agent_chrome"),
		retry: { same_input_safe: false, attempt_budget: 1, exhausted_posture: "operator" },
		success_evidence: "The recheck verifies Agent Chrome on the same explicit port.",
		stop_condition:
			"Any listener, a changed port, an unverified child, or an exhausted launch attempt stops the action.",
		docs_url: browserConnectRepairDocsUrl("launch_agent_chrome"),
	},
	inspect_listener: {
		id: "inspect_listener",
		postures: ["operator-choice"],
		selection_causes: [
			"occupied_listener",
			"foreign_listener",
			"unverified_listener",
		],
		required_context: [],
		owner: "operator",
		side_effects: modelSideEffects("inspect_listener"),
		retry: { same_input_safe: true, attempt_budget: 0, exhausted_posture: "operator" },
		success_evidence:
			"A fresh invocation proves the original or operator-selected explicit port after external remediation.",
		stop_condition:
			"Never terminate from pid, port, basename, or prose; never emit a follow-on process action.",
		docs_url: browserConnectRepairDocsUrl("inspect_listener"),
	},
	inspect_diagnostics: {
		id: "inspect_diagnostics",
		postures: ["operator-choice"],
		selection_causes: [
			"no_listener",
			"launch_failed",
			"transient_proof_failure",
			"wrapped_executable_absent",
			"unexpected_runtime_error",
		],
		required_context: [],
		owner: "operator",
		side_effects: modelSideEffects("inspect_diagnostics"),
		retry: { same_input_safe: true, attempt_budget: 0, exhausted_posture: "operator" },
		success_evidence: "A typed cause or a human diagnosis exists.",
		stop_condition: "Diagnostics alone never authorize mutation.",
		docs_url: browserConnectRepairDocsUrl("inspect_diagnostics"),
	},
	list_registered_adapters: {
		id: "list_registered_adapters",
		postures: ["compatibility-only"],
		selection_causes: [],
		required_context: [],
		owner: "legacy_discovery",
		side_effects: modelSideEffects("list_registered_adapters"),
		retry: { same_input_safe: true, attempt_budget: 0, exhausted_posture: "operator" },
		success_evidence: "Not applicable; retained for released schema-1 consumers.",
		stop_condition: "Tests forbid use as an outer continuation next action.",
		docs_url: browserConnectRepairDocsUrl("list_registered_adapters"),
	},
	install_adapter: {
		id: "install_adapter",
		postures: ["automatic", "operator-choice"],
		selection_causes: ["executable_absent"],
		required_context: [
			"adapter_id",
			"automatic_install.recipe_complete",
			"automatic_install.lock_origins_canonical",
			"automatic_install.dependency_integrity_complete",
			"automatic_install.lifecycle_scripts_disabled",
		],
		owner: "repair_adapter_command",
		side_effects: modelSideEffects("install_adapter"),
		retry: { same_input_safe: false, attempt_budget: 1, exhausted_posture: "operator" },
		success_evidence:
			"The repair command proves fresh exact-pin provenance, then the original connect or run proves attachment.",
		stop_condition:
			"A missing isolated recipe, non-canonical lock origins, incomplete dependency integrity, or a lifecycle-script requirement stops automatic install.",
		docs_url: browserConnectRepairDocsUrl("install_adapter"),
	},
	select_compatible_route: {
		id: "select_compatible_route",
		postures: ["compatibility-only"],
		selection_causes: [],
		required_context: [],
		owner: "legacy_discovery",
		side_effects: modelSideEffects("select_compatible_route"),
		retry: { same_input_safe: true, attempt_budget: 0, exhausted_posture: "operator" },
		success_evidence:
			"Not applicable; trusted cross-adapter operator choices reference this versioned procedure.",
		stop_condition: "Tests forbid use as an outer or legacy next action.",
		docs_url: browserConnectRepairDocsUrl("select_compatible_route"),
	},
	inspect_attachment_probe: {
		id: "inspect_attachment_probe",
		postures: ["operator-choice"],
		selection_causes: ["transient_probe_failure", "probe_failed"],
		required_context: [],
		owner: "operator",
		side_effects: modelSideEffects("inspect_attachment_probe"),
		retry: { same_input_safe: true, attempt_budget: 0, exhausted_posture: "operator" },
		success_evidence: "The operator identifies the adapter, endpoint, or route fault.",
		stop_condition: "Never weaken environment proof or switch to adapter discovery.",
		docs_url: browserConnectRepairDocsUrl("inspect_attachment_probe"),
	},
	resolve_connect_failure: {
		id: "resolve_connect_failure",
		postures: ["compatibility-only"],
		selection_causes: [],
		required_context: [],
		owner: "legacy_discovery",
		side_effects: modelSideEffects("resolve_connect_failure"),
		retry: { same_input_safe: true, attempt_budget: 0, exhausted_posture: "operator" },
		success_evidence:
			"Not applicable; pre-exec failures inherit the exact underlying repair.",
		stop_condition: "Tests forbid use as a primary continuation next action.",
		docs_url: browserConnectRepairDocsUrl("resolve_connect_failure"),
	},
	fix_wrapped_command: {
		id: "fix_wrapped_command",
		postures: ["automatic", "operator-choice"],
		selection_causes: ["wrapped_executable_absent"],
		required_context: ["deterministic_correction"],
		owner: "caller_rerun",
		side_effects: modelSideEffects("fix_wrapped_command"),
		retry: { same_input_safe: true, attempt_budget: 1, exhausted_posture: "operator" },
		success_evidence: "The wrapped command starts and its exit passes through.",
		stop_condition:
			"An unknown replacement, a prompt, or privilege escalation requires an operator.",
		docs_url: browserConnectRepairDocsUrl("fix_wrapped_command"),
	},
	use_suggested_port: {
		id: "use_suggested_port",
		postures: ["automatic"],
		selection_causes: [
			"occupied_listener",
			"foreign_listener",
			"unverified_listener",
		],
		required_context: [
			"command",
			"repair_chain_hop",
			"suggested_explicit_port.port",
			"suggested_explicit_port.verified_free",
		],
		owner: "caller_rerun",
		side_effects: modelSideEffects("use_suggested_port"),
		retry: { same_input_safe: false, attempt_budget: 1, exhausted_posture: "operator" },
		success_evidence:
			"The fresh invocation launches or verifies Agent Chrome, then proves adapter attachment.",
		stop_condition:
			"A check surface, hop one, a stale suggestion, or another failure emits an operator stage and never another suggested-port action.",
		docs_url: browserConnectRepairDocsUrl("use_suggested_port"),
	},
	upgrade_adapter_to_pin: {
		id: "upgrade_adapter_to_pin",
		postures: ["automatic"],
		selection_causes: ["version_mismatch"],
		required_context: [
			"adapter_id",
			"observed_version",
			"pinned_version",
			"transition_allowlisted",
			"automatic_install.recipe_complete",
			"automatic_install.lock_origins_canonical",
			"automatic_install.dependency_integrity_complete",
			"automatic_install.lifecycle_scripts_disabled",
		],
		owner: "repair_adapter_command",
		side_effects: modelSideEffects("upgrade_adapter_to_pin"),
		retry: { same_input_safe: false, attempt_budget: 1, exhausted_posture: "operator" },
		success_evidence:
			"The repair command proves fresh exact-pin provenance, then the original connect or run proves attachment.",
		stop_condition:
			"Inferred semantic-version safety, lock drift, missing integrity, lifecycle scripts, a downgrade, an unknown version, a prompt, or registry ambiguity requires an operator.",
		docs_url: browserConnectRepairDocsUrl("upgrade_adapter_to_pin"),
	},
	adjust_adapter_pin: {
		id: "adjust_adapter_pin",
		postures: ["operator-choice"],
		selection_causes: ["version_mismatch"],
		required_context: [],
		owner: "operator",
		side_effects: modelSideEffects("adjust_adapter_pin"),
		retry: { same_input_safe: true, attempt_budget: 0, exhausted_posture: "operator" },
		success_evidence:
			"Registry, provenance, type, and attachment tests pass after review.",
		stop_condition: "Never mutate pin policy from a runtime envelope.",
		docs_url: browserConnectRepairDocsUrl("adjust_adapter_pin"),
	},
	review_adapter_definition: {
		id: "review_adapter_definition",
		postures: ["operator-choice"],
		selection_causes: ["executable_absent", "version_mismatch"],
		required_context: [],
		owner: "operator",
		side_effects: modelSideEffects("review_adapter_definition"),
		retry: { same_input_safe: true, attempt_budget: 0, exhausted_posture: "operator" },
		success_evidence:
			"Registry, provenance, integrity, type, and attachment tests pass with reviewed metadata.",
		stop_condition:
			"Never infer registry fields from installed state, package-manager output, caller prose, or third-party text.",
		docs_url: browserConnectRepairDocsUrl("review_adapter_definition"),
	},
};

/**
 * The closed legacy compatibility stop set (R30): the only values the legacy
 * selector may emit for an operator stage. All four declare read/check
 * effects only.
 */
export const BROWSER_CONNECT_LEGACY_COMPATIBILITY_STOP_IDS = [
	"change_input",
	"inspect_listener",
	"inspect_diagnostics",
	"list_registered_adapters",
] as const satisfies readonly BrowserConnectFailureActionId[];

/**
 * Legacy compatibility stop union.
 */
export type BrowserConnectLegacyCompatibilityStopId =
	(typeof BROWSER_CONNECT_LEGACY_COMPATIBILITY_STOP_IDS)[number];

/**
 * Policy invocation facts (R15/R23): which command surface failed and which
 * bounded repair-chain hop it ran at. Only `connect`/`run` at hop `0` may
 * select `use_suggested_port` (KTD20).
 */
export type BrowserConnectRepairInvocation = {
	command: BrowserConnectCommand;
	repair_chain_hop: BrowserConnectRepairChainHop;
};

/**
 * Automatic recovery stage: ordered runtime actions plus exactly one
 * `next_action_id`, with all applicable catalogue constraints.
 */
export type BrowserConnectAutomaticRepairStage = {
	posture: "automatic";
	runtime_actions: readonly RuntimeActionGuidance[];
	continuation: {
		next_action_id: BrowserConnectFailureActionId;
		constraints?: readonly RuntimeContinuationConstraint[];
	};
};

/**
 * Operator recovery stage: `requires_operator`, catalogue choices, no next
 * action, and at least one constraint (the facade rejects zero, R25).
 */
export type BrowserConnectOperatorRepairStage = {
	posture: "operator";
	continuation: {
		requires_operator: true;
		constraints: readonly RuntimeContinuationConstraint[];
		choices?: readonly RuntimeRecoveryChoice[];
	};
};

/**
 * Recovery stage union.
 */
export type BrowserConnectRepairStage =
	| BrowserConnectAutomaticRepairStage
	| BrowserConnectOperatorRepairStage;

// ---------------------------------------------------------------------------
// Stage and choice builders. All projected text is package-owned prose; no
// caller-authored or third-party value ever enters a label, summary, or id
// (R24) — adapter-derived choice ids use trusted registry ids only (KTD18).
// ---------------------------------------------------------------------------

function actionGuidance(
	actionId: BrowserConnectFailureActionId,
): RuntimeActionGuidance {
	const action = failureActionById.get(actionId);
	if (!action) {
		throw new Error(`missing model affordance for action id ${actionId}`);
	}
	return {
		id: action.id,
		summary: action.summary,
		side_effects: [...action.sideEffects],
		docs_url: browserConnectRepairDocsUrl(actionId),
	};
}

function constraintsFor(
	constraintIds: readonly BrowserConnectContinuationConstraintId[],
): RuntimeContinuationConstraint[] {
	return [...new Set(constraintIds)].map(
		(constraintId) => browserConnectContinuationConstraints[constraintId],
	);
}

function automaticStage(
	actionId: BrowserConnectFailureActionId,
	constraintIds: readonly BrowserConnectContinuationConstraintId[],
): BrowserConnectAutomaticRepairStage {
	const constraints = constraintsFor(constraintIds);
	return {
		posture: "automatic",
		runtime_actions: [actionGuidance(actionId)],
		continuation: {
			next_action_id: actionId,
			...(constraints.length > 0 ? { constraints } : {}),
		},
	};
}

function operatorStage(
	choices: readonly RuntimeRecoveryChoice[],
	constraintIds: readonly BrowserConnectContinuationConstraintId[],
): BrowserConnectOperatorRepairStage {
	return {
		posture: "operator",
		continuation: {
			requires_operator: true,
			constraints: constraintsFor(constraintIds),
			...(choices.length > 0 ? { choices } : {}),
		},
	};
}

/**
 * Package-owned operator choices from the Operator Choice Catalogue. Direct
 * side effects and versioned docs URLs; never an `action_id` (KTD18).
 */
const OPERATOR_CHOICES = {
	provide_corrected_input: {
		id: "provide_corrected_input",
		label: "Provide corrected input",
		summary:
			"Supply corrected command input that matches the accepted usage reference.",
		recoverability: "change_input",
		side_effects: ["check"],
		docs_url: browserConnectRepairDocsUrl("change_input"),
	},
	provide_wrapped_command: {
		id: "provide_wrapped_command",
		label: "Provide the wrapped command",
		summary:
			"Rerun with a non-empty wrapped command after the run separator boundary.",
		recoverability: "change_input",
		side_effects: ["check"],
		docs_url: browserConnectRepairDocsUrl("add_run_separator"),
	},
	inspect_listener: {
		id: "inspect_listener",
		label: "Inspect the listener",
		summary:
			"Inspect the unverified listener through its own process owner; remediation stays external and a fresh invocation must re-prove the port.",
		recoverability: "repair_state",
		side_effects: ["read", "check"],
		docs_url: browserConnectRepairDocsUrl("inspect_listener"),
	},
	inspect_diagnostics: {
		id: "inspect_diagnostics",
		label: "Inspect diagnostics",
		summary:
			"Rerun the owning read-only diagnostic surface with the same run correlation to obtain a typed cause.",
		recoverability: "repair_state",
		side_effects: ["read", "check"],
		docs_url: browserConnectRepairDocsUrl("inspect_diagnostics"),
	},
	inspect_attachment_probe: {
		id: "inspect_attachment_probe",
		label: "Inspect the attachment probe",
		summary:
			"Inspect adapter attachment probe evidence for the verified endpoint; the environment proof stays authoritative.",
		recoverability: "repair_state",
		side_effects: ["read", "check", "browser"],
		docs_url: browserConnectRepairDocsUrl("inspect_attachment_probe"),
	},
	adjust_adapter_pin: {
		id: "adjust_adapter_pin",
		label: "Adjust the adapter pin",
		summary:
			"Review package support and change the Adapter Definition pin through normal source review.",
		recoverability: "repair_state",
		side_effects: ["write"],
		docs_url: browserConnectRepairDocsUrl("adjust_adapter_pin"),
	},
	fix_wrapped_command: {
		id: "fix_wrapped_command",
		label: "Fix the wrapped command",
		summary:
			"Correct or install the intended wrapped command through its own owner, then start a fresh run.",
		recoverability: "change_input",
		side_effects: ["check", "network", "write"],
		docs_url: browserConnectRepairDocsUrl("fix_wrapped_command"),
	},
} as const satisfies Record<string, RuntimeRecoveryChoice>;

/**
 * Catalogue-owned inspect_diagnostics choice for emitters that project an
 * operator stop outside the pure selector (id, effects, recoverability, and
 * docs URL stay single-sourced; callers may override the summary prose).
 */
export const BROWSER_CONNECT_INSPECT_DIAGNOSTICS_CHOICE =
	OPERATOR_CHOICES.inspect_diagnostics;

function isTrustedAdapterId(value: string): value is BrowserConnectAdapterId {
	return (BROWSER_CONNECT_ADAPTER_IDS as readonly string[]).includes(value);
}

/**
 * Filter caller-supplied candidates to trusted Adapter Definition ids in
 * registry order (R24/AE20): unregistered or caller-authored candidates
 * produce no choice, and duplicates collapse.
 */
function trustedAdapterIds(
	candidates: readonly string[],
): readonly BrowserConnectAdapterId[] {
	if (!Array.isArray(candidates)) return [];
	return BROWSER_CONNECT_ADAPTER_IDS.filter((adapterId) =>
		candidates.includes(adapterId),
	);
}

function chooseRegisteredAdapterChoice(
	adapterId: BrowserConnectAdapterId,
): RuntimeRecoveryChoice {
	return {
		id: `choose_registered_adapter:${adapterId}`,
		label: `Choose registered adapter ${adapterId}`,
		summary:
			"Start a fresh invocation with this registered adapter; it declares an implemented compatible route.",
		recoverability: "change_input",
		side_effects: ["check", "network", "browser", "write"],
		docs_url: browserConnectRepairDocsUrl("select_compatible_route"),
	};
}

function manualInstallChoice(
	adapterId: BrowserConnectAdapterId,
): RuntimeRecoveryChoice {
	return {
		id: `install_registered_adapter_manually:${adapterId}`,
		label: `Install registered adapter ${adapterId} manually`,
		summary:
			"Install the registered adapter at its exact pinned version outside agent execution, then rerun the original command.",
		recoverability: "repair_state",
		side_effects: ["network", "write"],
		docs_url: browserConnectRepairDocsUrl("install_adapter"),
	};
}

function reviewAdapterDefinitionChoice(
	adapterId: BrowserConnectAdapterId,
): RuntimeRecoveryChoice {
	return {
		id: `review_adapter_definition:${adapterId}`,
		label: `Review Adapter Definition ${adapterId}`,
		summary:
			"Review the named Adapter Definition source metadata through normal source review before any install decision.",
		recoverability: "repair_state",
		side_effects: ["write"],
		docs_url: browserConnectRepairDocsUrl("review_adapter_definition"),
	};
}

// ---------------------------------------------------------------------------
// Required-context validators (KTD11): policy cannot select an action until
// its declared required context fields exist and validate.
// ---------------------------------------------------------------------------

function isValidExplicitPort(port: unknown): boolean {
	return (
		typeof port === "number" &&
		Number.isInteger(port) &&
		port >= 1 &&
		port <= 65535
	);
}

function isUsableSuggestedPort(
	evidence: BrowserConnectSuggestedPortEvidence | undefined,
): boolean {
	return (
		evidence !== undefined &&
		evidence.verified_free === true &&
		isValidExplicitPort(evidence.port)
	);
}

function isCompleteInstallEvidence(
	evidence: BrowserConnectIsolatedInstallEvidence | undefined,
): boolean {
	return (
		evidence !== undefined &&
		evidence.recipe_complete === true &&
		evidence.lock_origins_canonical === true &&
		evidence.dependency_integrity_complete === true &&
		evidence.lifecycle_scripts_disabled === true
	);
}


/**
 * Normalized wrapped-executable basename (R26): a bare program name with no
 * path separators, whitespace, or leading punctuation.
 */
const SAFE_BASENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

// ---------------------------------------------------------------------------
// Selection (R4): exhaustive over failure classes and typed causes.
// ---------------------------------------------------------------------------

/**
 * Select the recovery stage for a typed failure context (R1/R4/R9).
 *
 * Pure and total: every typed context yields exactly one automatic or
 * operator stage, and unknown, missing, or ambiguous context fails closed to
 * the operator diagnostics stage — never a throw, never a mutating default.
 *
 * @param invocation - Failed command surface and bounded repair-chain hop
 * @param context - Typed repair context from the owning gateway
 * @returns Exactly one facade-valid automatic or operator stage
 */
export function selectBrowserConnectRepairPath(
	invocation: BrowserConnectRepairInvocation,
	context: BrowserConnectRepairContext,
): BrowserConnectRepairStage {
	if (invocation.repair_chain_hop !== 0 && invocation.repair_chain_hop !== 1) {
		return unknownRepairContextStage();
	}
	return selectByFailureClass(invocation, context);
}

function selectByFailureClass(
	invocation: BrowserConnectRepairInvocation,
	context: BrowserConnectRepairContext,
): BrowserConnectRepairStage {
	switch (context.failure_class) {
		case "usage-invalid":
			return selectUsageInvalid(context);
		case "run-missing-separator":
			return selectRunMissingSeparator(context);
		case "environment-absent":
			return selectEnvironmentAbsent(invocation, context);
		case "foreign-listener":
			return selectForeignListener(invocation, context);
		case "launch-failed":
			return selectLaunchFailed(invocation, context);
		case "adapter-unknown":
			return selectAdapterUnknown(context);
		case "adapter-not-installed":
			return selectAdapterNotInstalled(context);
		case "route-incompatible":
			return selectRouteIncompatible(context);
		case "attachment-failed":
			return selectAttachmentFailed(context);
		case "preexec-connect-failed":
			// R12/AE10: a pre-exec connection failure inherits the exact underlying
			// environment or adapter posture; resolve_connect_failure never leads.
			return selectByFailureClass(invocation, context.underlying);
		case "wrapped-command-not-found":
			return selectWrappedCommandNotFound(context);
		case "runtime-error-unexpected":
			return operatorStage(
				[OPERATOR_CHOICES.inspect_diagnostics],
				["no_mutation_from_diagnostics"],
			);
	}
	// R4: compile-time exhaustiveness — an unhandled failure class fails this
	// never assignment. R9: an out-of-contract runtime value falls through the
	// switch and fails closed to the operator diagnostics stage.
	const unhandledClass: never = context;
	void unhandledClass;
	return unknownRepairContextStage();
}

function unknownRepairContextStage(): BrowserConnectOperatorRepairStage {
	return operatorStage(
		[OPERATOR_CHOICES.inspect_diagnostics],
		["no_mutation_from_diagnostics"],
	);
}

function selectUsageInvalid(
	context: Extract<
		BrowserConnectRepairContext,
		{ failure_class: "usage-invalid" }
	>,
): BrowserConnectRepairStage {
	switch (context.cause) {
		case "usage_invalid": {
			if (context.deterministic_correction === true) {
				return automaticStage("change_input", []);
			}
			return operatorStage(
				[OPERATOR_CHOICES.provide_corrected_input],
				["no_synthesized_caller_input"],
			);
		}
	}
	const unhandledCause: never = context.cause;
	void unhandledCause;
	return unknownRepairContextStage();
}

function selectRunMissingSeparator(
	context: Extract<
		BrowserConnectRepairContext,
		{ failure_class: "run-missing-separator" }
	>,
): BrowserConnectRepairStage {
	switch (context.cause) {
		case "separator_missing": {
			if (context.wrapped_command_present === true) {
				return automaticStage("add_run_separator", []);
			}
			return operatorStage(
				[OPERATOR_CHOICES.provide_wrapped_command],
				["no_synthesized_caller_input"],
			);
		}
		case "wrapped_command_missing":
			return operatorStage(
				[OPERATOR_CHOICES.provide_wrapped_command],
				["no_synthesized_caller_input"],
			);
	}
	const unhandledCause: never = context;
	void unhandledCause;
	return unknownRepairContextStage();
}

function selectEnvironmentAbsent(
	invocation: BrowserConnectRepairInvocation,
	context: Extract<
		BrowserConnectRepairContext,
		{ failure_class: "environment-absent" }
	>,
): BrowserConnectRepairStage {
	switch (context.cause) {
		case "no_listener": {
			// R23/matrix: at hop 1 every environment failure is operator-only.
			if (
				invocation.repair_chain_hop === 0 &&
				context.explicit_port_free === true
			) {
				return automaticStage("launch_agent_chrome", [
					"no_adapter_fallback",
					"no_process_destruction",
				]);
			}
			const constraintIds: BrowserConnectContinuationConstraintId[] = [
				"no_adapter_fallback",
			];
			if (context.explicit_port_free !== true) {
				constraintIds.push("no_process_destruction");
			}
			if (invocation.repair_chain_hop === 1) {
				constraintIds.push("no_cross_invocation_retry");
			}
			constraintIds.push("no_mutation_from_diagnostics");
			return operatorStage(
				[OPERATOR_CHOICES.inspect_diagnostics],
				constraintIds,
			);
		}
		case "transient_proof_failure": {
			const constraintIds: BrowserConnectContinuationConstraintId[] = [
				"no_adapter_fallback",
			];
			if (
				context.recheck_attempted === true ||
				invocation.repair_chain_hop === 1
			) {
				constraintIds.push("no_cross_invocation_retry");
			}
			constraintIds.push("no_mutation_from_diagnostics");
			return operatorStage(
				[OPERATOR_CHOICES.inspect_diagnostics],
				constraintIds,
			);
		}
	}
	const unhandledCause: never = context;
	void unhandledCause;
	return unknownRepairContextStage();
}

function selectForeignListener(
	invocation: BrowserConnectRepairInvocation,
	context: Extract<
		BrowserConnectRepairContext,
		{ failure_class: "foreign-listener" }
	>,
): BrowserConnectRepairStage {
	const suggestion = context.suggested_explicit_port;
	// KTD20: only connect/run own a launch capable of completing the repair;
	// check (and the dashboard) preserve the suggestion as diagnostic data.
	if (
		invocation.repair_chain_hop === 0 &&
		(invocation.command === "connect" || invocation.command === "run") &&
		isUsableSuggestedPort(suggestion)
	) {
		return automaticStage("use_suggested_port", [
			"no_adapter_fallback",
			"no_internal_port_switch",
			"no_unverified_listener_connection",
			"no_process_destruction",
		]);
	}
	const constraintIds: BrowserConnectContinuationConstraintId[] = [
		"no_adapter_fallback",
		"no_unverified_listener_connection",
		"no_process_destruction",
	];
	if (suggestion !== undefined) {
		constraintIds.push("no_internal_port_switch");
	}
	if (invocation.repair_chain_hop === 1) {
		constraintIds.push("no_cross_invocation_retry");
	}
	constraintIds.push("no_mutation_from_diagnostics");
	// R32/KTD19: terminal operator handoff — inspection only, no follow-on
	// process action, no ownership ingestion.
	return operatorStage([OPERATOR_CHOICES.inspect_listener], constraintIds);
}

function selectLaunchFailed(
	invocation: BrowserConnectRepairInvocation,
	context: Extract<
		BrowserConnectRepairContext,
		{ failure_class: "launch-failed" }
	>,
): BrowserConnectRepairStage {
	switch (context.cause) {
		case "launch_failed": {
			const constraintIds: BrowserConnectContinuationConstraintId[] = [
				"no_adapter_fallback",
			];
			if (invocation.repair_chain_hop === 1) {
				constraintIds.push("no_cross_invocation_retry");
			}
			constraintIds.push("no_mutation_from_diagnostics");
			return operatorStage(
				[OPERATOR_CHOICES.inspect_diagnostics],
				constraintIds,
			);
		}
	}
	const unhandledCause: never = context.cause;
	void unhandledCause;
	return unknownRepairContextStage();
}

function selectAdapterUnknown(
	context: Extract<
		BrowserConnectRepairContext,
		{ failure_class: "adapter-unknown" }
	>,
): BrowserConnectRepairStage {
	switch (context.cause) {
		case "unregistered_adapter": {
			const replacement = context.deterministic_replacement_adapter_id;
			if (replacement !== undefined && isTrustedAdapterId(replacement)) {
				return automaticStage("change_input", []);
			}
			const choices = trustedAdapterIds(context.candidate_adapter_ids).map(
				chooseRegisteredAdapterChoice,
			);
			return operatorStage(choices, ["no_synthesized_caller_input"]);
		}
	}
	const unhandledCause: never = context.cause;
	void unhandledCause;
	return unknownRepairContextStage();
}

function selectAdapterNotInstalled(
	context: Extract<
		BrowserConnectRepairContext,
		{ failure_class: "adapter-not-installed" }
	>,
): BrowserConnectRepairStage {
	switch (context.cause) {
		case "executable_absent": {
			if (!isTrustedAdapterId(context.adapter_id)) {
				return unknownRepairContextStage();
			}
			if (isCompleteInstallEvidence(context.automatic_install)) {
				return automaticStage("install_adapter", ["no_pin_policy_change"]);
			}
			if (context.manual_install_inputs_complete === true) {
				return operatorStage(
					[manualInstallChoice(context.adapter_id)],
					["no_pin_policy_change"],
				);
			}
			return operatorStage(
				[reviewAdapterDefinitionChoice(context.adapter_id)],
				["no_pin_policy_change"],
			);
		}
		case "version_mismatch": {
			if (!isTrustedAdapterId(context.adapter_id)) {
				return unknownRepairContextStage();
			}
			if (context.transition_allowlisted !== true) {
				return operatorStage(
					[OPERATOR_CHOICES.adjust_adapter_pin],
					["no_pin_policy_change"],
				);
			}
			const versionsSafe =
				SAFE_VERSION_PATTERN.test(context.observed_version) &&
				SAFE_VERSION_PATTERN.test(context.pinned_version);
			if (
				versionsSafe &&
				isCompleteInstallEvidence(context.automatic_install)
			) {
				return automaticStage("upgrade_adapter_to_pin", [
					"no_pin_policy_change",
				]);
			}
			return operatorStage(
				[reviewAdapterDefinitionChoice(context.adapter_id)],
				["no_pin_policy_change"],
			);
		}
	}
	const unhandledCause: never = context;
	void unhandledCause;
	return unknownRepairContextStage();
}

function selectRouteIncompatible(
	context: Extract<
		BrowserConnectRepairContext,
		{ failure_class: "route-incompatible" }
	>,
): BrowserConnectRepairStage {
	switch (context.cause) {
		case "route_unsupported": {
			// KTD21: same-adapter routes were already exhausted; the only path is a
			// trusted operator handoff, never an automatic adapter switch.
			const choices = trustedAdapterIds(context.candidate_adapter_ids).map(
				chooseRegisteredAdapterChoice,
			);
			return operatorStage(choices, ["no_adapter_fallback"]);
		}
	}
	const unhandledCause: never = context.cause;
	void unhandledCause;
	return unknownRepairContextStage();
}

function selectAttachmentFailed(
	context: Extract<
		BrowserConnectRepairContext,
		{ failure_class: "attachment-failed" }
	>,
): BrowserConnectRepairStage {
	switch (context.cause) {
		case "transient_probe_failure": {
			const constraintIds: BrowserConnectContinuationConstraintId[] = [
				"no_adapter_fallback",
			];
			if (context.re_probe_attempted === true) {
				constraintIds.push("no_cross_invocation_retry");
			}
			constraintIds.push("no_mutation_from_diagnostics");
			return operatorStage(
				[OPERATOR_CHOICES.inspect_attachment_probe],
				constraintIds,
			);
		}
		case "probe_failed":
			return operatorStage(
				[OPERATOR_CHOICES.inspect_attachment_probe],
				["no_adapter_fallback", "no_mutation_from_diagnostics"],
			);
	}
	const unhandledCause: never = context;
	void unhandledCause;
	return unknownRepairContextStage();
}

function selectWrappedCommandNotFound(
	context: Extract<
		BrowserConnectRepairContext,
		{ failure_class: "wrapped-command-not-found" }
	>,
): BrowserConnectRepairStage {
	switch (context.cause) {
		case "wrapped_executable_absent": {
			const basename = context.executable_basename;
			// R26: an unnormalized or unsafe basename is unsafe executable
			// identity — fail closed and project nothing.
			if (basename !== undefined && !SAFE_BASENAME_PATTERN.test(basename)) {
				return operatorStage(
					[OPERATOR_CHOICES.inspect_diagnostics],
					["no_synthesized_caller_input", "no_mutation_from_diagnostics"],
				);
			}
			if (context.deterministic_correction === true) {
				return automaticStage("fix_wrapped_command", []);
			}
			return operatorStage(
				[OPERATOR_CHOICES.fix_wrapped_command],
				["no_synthesized_caller_input"],
			);
		}
	}
	const unhandledCause: never = context.cause;
	void unhandledCause;
	return unknownRepairContextStage();
}

// ---------------------------------------------------------------------------
// Legacy compatibility selector (R16/R30/KTD6). Automatic stages mirror the
// exact outer next action. Operator stages degrade to a cause-appropriate
// non-mutating compatibility stop from the compile-time closed map below;
// a missing or conflicting entry falls back to inspect_diagnostics, and a
// conflicting fallback fails closed instead of serializing.
// ---------------------------------------------------------------------------

const LEGACY_OPERATOR_STOP_BY_CLASS = {
	"usage-invalid": "change_input",
	"run-missing-separator": "change_input",
	"environment-absent": "inspect_diagnostics",
	"foreign-listener": "inspect_listener",
	"launch-failed": "inspect_diagnostics",
	"adapter-unknown": "list_registered_adapters",
	"adapter-not-installed": "list_registered_adapters",
	"route-incompatible": "list_registered_adapters",
	"attachment-failed": "inspect_diagnostics",
	"wrapped-command-not-found": "change_input",
	"runtime-error-unexpected": "inspect_diagnostics",
} as const satisfies Record<
	Exclude<BrowserConnectFailureClass, "preexec-connect-failed">,
	BrowserConnectLegacyCompatibilityStopId
>;

function legacyCompatibilityStop(
	context: BrowserConnectRepairContext,
): BrowserConnectLegacyCompatibilityStopId | undefined {
	if (context.failure_class === "preexec-connect-failed") {
		// KTD6: apply the underlying typed posture before the compatibility value.
		return legacyCompatibilityStop(context.underlying);
	}
	const stop: BrowserConnectLegacyCompatibilityStopId | undefined =
		LEGACY_OPERATOR_STOP_BY_CLASS[context.failure_class];
	return stop;
}

function isLegacyStopAllowed(
	stopId: BrowserConnectLegacyCompatibilityStopId,
	stage: BrowserConnectOperatorRepairStage,
): boolean {
	const forbiddenActionIds = new Set<string>();
	const forbiddenSideEffects = new Set<string>();
	for (const constraint of stage.continuation.constraints) {
		for (const actionId of constraint.forbidden_action_ids ?? []) {
			forbiddenActionIds.add(actionId);
		}
		for (const sideEffect of constraint.forbidden_side_effects ?? []) {
			forbiddenSideEffects.add(sideEffect);
		}
	}
	if (forbiddenActionIds.has(stopId)) return false;
	for (const sideEffect of browserConnectRepairActionDefinitions[stopId]
		.side_effects) {
		// R30: compatibility stops resolve only to read/check action records.
		if (sideEffect !== "read" && sideEffect !== "check") return false;
		if (forbiddenSideEffects.has(sideEffect)) return false;
	}
	return true;
}

/**
 * Select the legacy schema-1 `data.next_action_id` value (R16/R30).
 *
 * @param input - The typed context and the stage the outer policy selected
 * @returns The mirrored automatic action, or a closed non-mutating stop
 * @throws When even the inspect_diagnostics fallback conflicts with outer
 *   constraints — envelope construction must fail closed, not serialize
 */
export function selectBrowserConnectLegacyNextAction(input: {
	context: BrowserConnectRepairContext;
	stage: BrowserConnectRepairStage;
}): BrowserConnectFailureActionId {
	if (input.stage.posture === "automatic") {
		return input.stage.continuation.next_action_id;
	}
	const mapped = legacyCompatibilityStop(input.context);
	const candidate =
		mapped !== undefined && isLegacyStopAllowed(mapped, input.stage)
			? mapped
			: "inspect_diagnostics";
	if (!isLegacyStopAllowed(candidate, input.stage)) {
		throw new Error(
			"legacy compatibility fallback inspect_diagnostics conflicts with outer constraints; refusing to serialize a legacy next action",
		);
	}
	return candidate;
}
