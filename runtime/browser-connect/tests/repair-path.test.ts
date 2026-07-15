import { describe, expect, test } from "bun:test";
import {
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	type RuntimeContinuationConstraint,
} from "@side-quest/cli-command-facade";

import { BROWSER_CONNECT_ADAPTER_IDS } from "../src/adapters/registry.ts";
import {
	BROWSER_CONNECT_ADAPTER_REPAIR_CAUSES,
	BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS,
	BROWSER_CONNECT_ENVIRONMENT_REPAIR_CAUSES,
	BROWSER_CONNECT_FAILURE_ACTION_IDS,
	BROWSER_CONNECT_FAILURE_CLASSES,
	BROWSER_CONNECT_REPAIR_CAUSES,
	BROWSER_CONNECT_REPAIR_CHAIN_HOPS,
	BROWSER_CONNECT_RUN_REPAIR_CAUSES,
	browserConnectFailureActions,
	type BrowserConnectAdapterRepairContext,
	type BrowserConnectEnvironmentRepairContext,
	type BrowserConnectFailureActionId,
	type BrowserConnectFailureClass,
	type BrowserConnectRepairContext,
} from "../src/model.ts";
import {
	BROWSER_CONNECT_CONTINUATION_CONSTRAINT_IDS,
	BROWSER_CONNECT_LEGACY_COMPATIBILITY_STOP_IDS,
	BROWSER_CONNECT_REPAIR_CONTRACT_VERSION,
	BROWSER_CONNECT_REPAIR_DOCS_BASE_URL,
	browserConnectContinuationConstraints,
	browserConnectRepairActionDefinitions,
	browserConnectRepairDocsUrl,
	selectBrowserConnectLegacyNextAction,
	selectBrowserConnectRepairPath,
	type BrowserConnectContinuationConstraintId,
	type BrowserConnectOperatorRepairStage,
	type BrowserConnectRepairInvocation,
	type BrowserConnectRepairStage,
} from "../src/repair-path.ts";

// ---------------------------------------------------------------------------
// Type-level proof (R4): the typed repair context covers exactly the failure
// class union. Removing a class variant or adding a 13th class without a
// context variant fails this assignment at compile time.
// ---------------------------------------------------------------------------
type RepairContextClass = BrowserConnectRepairContext["failure_class"];
const _repairContextCoversEveryFailureClass: [RepairContextClass] extends [
	BrowserConnectFailureClass,
]
	? [BrowserConnectFailureClass] extends [RepairContextClass]
		? true
		: never
	: never = true;
void _repairContextCoversEveryFailureClass;

const CDM = BROWSER_CONNECT_ADAPTER_IDS[0];
const AB = BROWSER_CONNECT_ADAPTER_IDS[1];

const COMPLETE_INSTALL_EVIDENCE = {
	recipe_complete: true,
	lock_origins_canonical: true,
	dependency_integrity_complete: true,
	lifecycle_scripts_disabled: true,
} as const;

function inv(
	command: BrowserConnectRepairInvocation["command"],
	hop: BrowserConnectRepairInvocation["repair_chain_hop"],
): BrowserConnectRepairInvocation {
	return { command, repair_chain_hop: hop };
}

const CONNECT_0 = inv("connect", 0);
const CONNECT_1 = inv("connect", 1);
const RUN_0 = inv("run", 0);
const CHECK_0 = inv("check", 0);

type ExpectedStage =
	| {
			posture: "automatic";
			next_action_id: BrowserConnectFailureActionId;
			constraint_ids: readonly BrowserConnectContinuationConstraintId[];
	  }
	| {
			posture: "operator";
			choice_ids: readonly string[];
			constraint_ids: readonly BrowserConnectContinuationConstraintId[];
	  };

type MatrixRow = {
	name: string;
	invocation: BrowserConnectRepairInvocation;
	context: BrowserConnectRepairContext;
	expected: ExpectedStage;
	legacy: BrowserConnectFailureActionId;
};

const UNDERLYING_NO_LISTENER: BrowserConnectEnvironmentRepairContext = {
	failure_class: "environment-absent",
	cause: "no_listener",
	explicit_port_free: true,
};

const UNDERLYING_OCCUPIED_WITH_SUGGESTION: BrowserConnectEnvironmentRepairContext =
	{
		failure_class: "foreign-listener",
		cause: "occupied_listener",
		suggested_explicit_port: { port: 9333, verified_free: true },
	};

const UNDERLYING_PROBE_FAILED: BrowserConnectAdapterRepairContext = {
	failure_class: "attachment-failed",
	cause: "probe_failed",
};

/**
 * The Failure Cause to Repair Matrix (R18), table-driven: one row per typed
 * cause posture. Constraint sets are compared as sorted member sets.
 */
const MATRIX_ROWS: readonly MatrixRow[] = [
	// --- usage ---------------------------------------------------------------
	{
		name: "usage-invalid with deterministic correction is automatic change_input",
		invocation: CHECK_0,
		context: {
			failure_class: "usage-invalid",
			cause: "usage_invalid",
			deterministic_correction: true,
		},
		expected: {
			posture: "automatic",
			next_action_id: "change_input",
			constraint_ids: [],
		},
		legacy: "change_input",
	},
	{
		name: "usage-invalid without deterministic correction requires operator input",
		invocation: CHECK_0,
		context: {
			failure_class: "usage-invalid",
			cause: "usage_invalid",
			deterministic_correction: false,
		},
		expected: {
			posture: "operator",
			choice_ids: ["provide_corrected_input"],
			constraint_ids: ["no_synthesized_caller_input"],
		},
		legacy: "change_input",
	},
	// --- run separator ---------------------------------------------------------
	{
		name: "separator missing with non-empty command marker is automatic add_run_separator",
		invocation: RUN_0,
		context: {
			failure_class: "run-missing-separator",
			cause: "separator_missing",
			wrapped_command_present: true,
		},
		expected: {
			posture: "automatic",
			next_action_id: "add_run_separator",
			constraint_ids: [],
		},
		legacy: "add_run_separator",
	},
	{
		name: "separator missing without command marker requires the wrapped command",
		invocation: RUN_0,
		context: {
			failure_class: "run-missing-separator",
			cause: "separator_missing",
			wrapped_command_present: false,
		},
		expected: {
			posture: "operator",
			choice_ids: ["provide_wrapped_command"],
			constraint_ids: ["no_synthesized_caller_input"],
		},
		legacy: "change_input",
	},
	{
		name: "wrapped command missing requires the wrapped command",
		invocation: RUN_0,
		context: {
			failure_class: "run-missing-separator",
			cause: "wrapped_command_missing",
		},
		expected: {
			posture: "operator",
			choice_ids: ["provide_wrapped_command"],
			constraint_ids: ["no_synthesized_caller_input"],
		},
		legacy: "change_input",
	},
	// --- environment -----------------------------------------------------------
	{
		name: "no listener with proven-free port is automatic launch_agent_chrome",
		invocation: CONNECT_0,
		context: {
			failure_class: "environment-absent",
			cause: "no_listener",
			explicit_port_free: true,
		},
		expected: {
			posture: "automatic",
			next_action_id: "launch_agent_chrome",
			constraint_ids: ["no_adapter_fallback", "no_process_destruction"],
		},
		legacy: "launch_agent_chrome",
	},
	{
		name: "no listener without free-port proof fails closed to diagnostics",
		invocation: CONNECT_0,
		context: {
			failure_class: "environment-absent",
			cause: "no_listener",
			explicit_port_free: false,
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_diagnostics"],
			constraint_ids: [
				"no_adapter_fallback",
				"no_process_destruction",
				"no_mutation_from_diagnostics",
			],
		},
		legacy: "inspect_diagnostics",
	},
	{
		name: "no listener at hop 1 is operator-only even with free-port proof",
		invocation: CONNECT_1,
		context: {
			failure_class: "environment-absent",
			cause: "no_listener",
			explicit_port_free: true,
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_diagnostics"],
			constraint_ids: [
				"no_adapter_fallback",
				"no_cross_invocation_retry",
				"no_mutation_from_diagnostics",
			],
		},
		legacy: "inspect_diagnostics",
	},
	{
		name: "transient proof failure after the bounded recheck exhausts retries",
		invocation: CONNECT_0,
		context: {
			failure_class: "environment-absent",
			cause: "transient_proof_failure",
			recheck_attempted: true,
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_diagnostics"],
			constraint_ids: [
				"no_adapter_fallback",
				"no_cross_invocation_retry",
				"no_mutation_from_diagnostics",
			],
		},
		legacy: "inspect_diagnostics",
	},
	{
		name: "transient proof failure without the recheck stays operator diagnostics",
		invocation: CONNECT_0,
		context: {
			failure_class: "environment-absent",
			cause: "transient_proof_failure",
			recheck_attempted: false,
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_diagnostics"],
			constraint_ids: ["no_adapter_fallback", "no_mutation_from_diagnostics"],
		},
		legacy: "inspect_diagnostics",
	},
	{
		name: "connect at hop 0 with a verified suggested port is automatic use_suggested_port",
		invocation: CONNECT_0,
		context: {
			failure_class: "foreign-listener",
			cause: "occupied_listener",
			suggested_explicit_port: { port: 9333, verified_free: true },
		},
		expected: {
			posture: "automatic",
			next_action_id: "use_suggested_port",
			constraint_ids: [
				"no_adapter_fallback",
				"no_internal_port_switch",
				"no_unverified_listener_connection",
				"no_process_destruction",
			],
		},
		legacy: "use_suggested_port",
	},
	{
		name: "run at hop 0 with a verified suggested port is automatic use_suggested_port",
		invocation: RUN_0,
		context: {
			failure_class: "foreign-listener",
			cause: "occupied_listener",
			suggested_explicit_port: { port: 9333, verified_free: true },
		},
		expected: {
			posture: "automatic",
			next_action_id: "use_suggested_port",
			constraint_ids: [
				"no_adapter_fallback",
				"no_internal_port_switch",
				"no_unverified_listener_connection",
				"no_process_destruction",
			],
		},
		legacy: "use_suggested_port",
	},
	{
		name: "check preserves the suggestion as diagnostic data and stays operator",
		invocation: CHECK_0,
		context: {
			failure_class: "foreign-listener",
			cause: "occupied_listener",
			suggested_explicit_port: { port: 9333, verified_free: true },
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_listener"],
			constraint_ids: [
				"no_adapter_fallback",
				"no_unverified_listener_connection",
				"no_process_destruction",
				"no_internal_port_switch",
				"no_mutation_from_diagnostics",
			],
		},
		legacy: "inspect_listener",
	},
	{
		name: "dashboard never selects use_suggested_port",
		invocation: inv("dashboard", 0),
		context: {
			failure_class: "foreign-listener",
			cause: "occupied_listener",
			suggested_explicit_port: { port: 9333, verified_free: true },
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_listener"],
			constraint_ids: [
				"no_adapter_fallback",
				"no_unverified_listener_connection",
				"no_process_destruction",
				"no_internal_port_switch",
				"no_mutation_from_diagnostics",
			],
		},
		legacy: "inspect_listener",
	},
	{
		name: "hop 1 with another suggestion cannot emit a second suggested-port action",
		invocation: CONNECT_1,
		context: {
			failure_class: "foreign-listener",
			cause: "occupied_listener",
			suggested_explicit_port: { port: 9444, verified_free: true },
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_listener"],
			constraint_ids: [
				"no_adapter_fallback",
				"no_unverified_listener_connection",
				"no_process_destruction",
				"no_internal_port_switch",
				"no_cross_invocation_retry",
				"no_mutation_from_diagnostics",
			],
		},
		legacy: "inspect_listener",
	},
	{
		name: "a stale suggestion fails closed to listener inspection",
		invocation: CONNECT_0,
		context: {
			failure_class: "foreign-listener",
			cause: "unverified_listener",
			suggested_explicit_port: { port: 9333, verified_free: false },
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_listener"],
			constraint_ids: [
				"no_adapter_fallback",
				"no_unverified_listener_connection",
				"no_process_destruction",
				"no_internal_port_switch",
				"no_mutation_from_diagnostics",
			],
		},
		legacy: "inspect_listener",
	},
	{
		name: "an out-of-range suggested port fails closed to listener inspection",
		invocation: CONNECT_0,
		context: {
			failure_class: "foreign-listener",
			cause: "occupied_listener",
			suggested_explicit_port: { port: 70000, verified_free: true },
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_listener"],
			constraint_ids: [
				"no_adapter_fallback",
				"no_unverified_listener_connection",
				"no_process_destruction",
				"no_internal_port_switch",
				"no_mutation_from_diagnostics",
			],
		},
		legacy: "inspect_listener",
	},
	{
		name: "a foreign listener without a suggestion is a terminal operator handoff",
		invocation: CONNECT_0,
		context: {
			failure_class: "foreign-listener",
			cause: "foreign_listener",
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_listener"],
			constraint_ids: [
				"no_adapter_fallback",
				"no_unverified_listener_connection",
				"no_process_destruction",
				"no_mutation_from_diagnostics",
			],
		},
		legacy: "inspect_listener",
	},
	{
		name: "launch failure is operator diagnostics",
		invocation: CONNECT_0,
		context: { failure_class: "launch-failed", cause: "launch_failed" },
		expected: {
			posture: "operator",
			choice_ids: ["inspect_diagnostics"],
			constraint_ids: ["no_adapter_fallback", "no_mutation_from_diagnostics"],
		},
		legacy: "inspect_diagnostics",
	},
	// --- adapter -----------------------------------------------------------------
	{
		name: "unknown adapter with one trusted replacement is automatic change_input",
		invocation: CONNECT_0,
		context: {
			failure_class: "adapter-unknown",
			cause: "unregistered_adapter",
			candidate_adapter_ids: [CDM, AB],
			deterministic_replacement_adapter_id: AB,
		},
		expected: {
			posture: "automatic",
			next_action_id: "change_input",
			constraint_ids: [],
		},
		legacy: "change_input",
	},
	{
		name: "unknown adapter with an untrusted replacement offers registered handoffs",
		invocation: CONNECT_0,
		context: {
			failure_class: "adapter-unknown",
			cause: "unregistered_adapter",
			candidate_adapter_ids: [CDM, AB],
			deterministic_replacement_adapter_id: "totally-unregistered",
		},
		expected: {
			posture: "operator",
			choice_ids: [
				`choose_registered_adapter:${CDM}`,
				`choose_registered_adapter:${AB}`,
			],
			constraint_ids: ["no_synthesized_caller_input"],
		},
		legacy: "list_registered_adapters",
	},
	{
		name: "unknown adapter filters untrusted candidates out of the choice set",
		invocation: CONNECT_0,
		context: {
			failure_class: "adapter-unknown",
			cause: "unregistered_adapter",
			candidate_adapter_ids: [AB, "evil-adapter"],
		},
		expected: {
			posture: "operator",
			choice_ids: [`choose_registered_adapter:${AB}`],
			constraint_ids: ["no_synthesized_caller_input"],
		},
		legacy: "list_registered_adapters",
	},
	{
		name: "unknown adapter with no trusted candidates stops without choices",
		invocation: CONNECT_0,
		context: {
			failure_class: "adapter-unknown",
			cause: "unregistered_adapter",
			candidate_adapter_ids: [],
		},
		expected: {
			posture: "operator",
			choice_ids: [],
			constraint_ids: ["no_synthesized_caller_input"],
		},
		legacy: "list_registered_adapters",
	},
	{
		name: "absent executable with complete isolated evidence is automatic install_adapter",
		invocation: CONNECT_0,
		context: {
			failure_class: "adapter-not-installed",
			cause: "executable_absent",
			adapter_id: CDM,
			manual_install_inputs_complete: true,
			automatic_install: COMPLETE_INSTALL_EVIDENCE,
		},
		expected: {
			posture: "automatic",
			next_action_id: "install_adapter",
			constraint_ids: ["no_pin_policy_change"],
		},
		legacy: "install_adapter",
	},
	{
		name: "absent executable with a failed safety gate offers manual install",
		invocation: CONNECT_0,
		context: {
			failure_class: "adapter-not-installed",
			cause: "executable_absent",
			adapter_id: CDM,
			manual_install_inputs_complete: true,
			automatic_install: {
				...COMPLETE_INSTALL_EVIDENCE,
				lifecycle_scripts_disabled: false,
			},
		},
		expected: {
			posture: "operator",
			choice_ids: [`install_registered_adapter_manually:${CDM}`],
			constraint_ids: ["no_pin_policy_change"],
		},
		legacy: "list_registered_adapters",
	},
	{
		name: "absent executable without trusted install inputs offers definition review",
		invocation: CONNECT_0,
		context: {
			failure_class: "adapter-not-installed",
			cause: "executable_absent",
			adapter_id: AB,
			manual_install_inputs_complete: false,
		},
		expected: {
			posture: "operator",
			choice_ids: [`review_adapter_definition:${AB}`],
			constraint_ids: ["no_pin_policy_change"],
		},
		legacy: "list_registered_adapters",
	},
	{
		name: "absent executable for an untrusted adapter id fails closed",
		invocation: CONNECT_0,
		context: {
			failure_class: "adapter-not-installed",
			cause: "executable_absent",
			adapter_id: "not-in-registry",
			manual_install_inputs_complete: true,
			automatic_install: COMPLETE_INSTALL_EVIDENCE,
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_diagnostics"],
			constraint_ids: ["no_mutation_from_diagnostics"],
		},
		legacy: "list_registered_adapters",
	},
	{
		name: "allowlisted version transition with valid gates is automatic upgrade",
		invocation: CONNECT_0,
		context: {
			failure_class: "adapter-not-installed",
			cause: "version_mismatch",
			adapter_id: AB,
			observed_version: "0.26.0",
			pinned_version: "0.31.2",
			transition_allowlisted: true,
			automatic_install: COMPLETE_INSTALL_EVIDENCE,
		},
		expected: {
			posture: "automatic",
			next_action_id: "upgrade_adapter_to_pin",
			constraint_ids: ["no_pin_policy_change"],
		},
		legacy: "upgrade_adapter_to_pin",
	},
	{
		name: "allowlisted transition with missing integrity requires definition review",
		invocation: CONNECT_0,
		context: {
			failure_class: "adapter-not-installed",
			cause: "version_mismatch",
			adapter_id: AB,
			observed_version: "0.26.0",
			pinned_version: "0.31.2",
			transition_allowlisted: true,
			automatic_install: {
				...COMPLETE_INSTALL_EVIDENCE,
				dependency_integrity_complete: false,
			},
		},
		expected: {
			posture: "operator",
			choice_ids: [`review_adapter_definition:${AB}`],
			constraint_ids: ["no_pin_policy_change"],
		},
		legacy: "list_registered_adapters",
	},
	{
		name: "a version mismatch without an allowlisted transition requires a pin decision",
		invocation: CONNECT_0,
		context: {
			failure_class: "adapter-not-installed",
			cause: "version_mismatch",
			adapter_id: CDM,
			observed_version: "0.6.0",
			pinned_version: "0.8.1",
			transition_allowlisted: false,
		},
		expected: {
			posture: "operator",
			choice_ids: ["adjust_adapter_pin"],
			constraint_ids: ["no_pin_policy_change"],
		},
		legacy: "list_registered_adapters",
	},
	{
		name: "a malformed observed version blocks the automatic upgrade",
		invocation: CONNECT_0,
		context: {
			failure_class: "adapter-not-installed",
			cause: "version_mismatch",
			adapter_id: AB,
			observed_version: "unknown build",
			pinned_version: "0.31.2",
			transition_allowlisted: true,
			automatic_install: COMPLETE_INSTALL_EVIDENCE,
		},
		expected: {
			posture: "operator",
			choice_ids: [`review_adapter_definition:${AB}`],
			constraint_ids: ["no_pin_policy_change"],
		},
		legacy: "list_registered_adapters",
	},
	{
		name: "route incompatibility offers trusted registered adapter handoffs",
		invocation: CONNECT_0,
		context: {
			failure_class: "route-incompatible",
			cause: "route_unsupported",
			candidate_adapter_ids: [AB, CDM],
		},
		expected: {
			posture: "operator",
			choice_ids: [
				`choose_registered_adapter:${CDM}`,
				`choose_registered_adapter:${AB}`,
			],
			constraint_ids: ["no_adapter_fallback"],
		},
		legacy: "list_registered_adapters",
	},
	{
		name: "route incompatibility with no trusted candidate stops without choices",
		invocation: CONNECT_0,
		context: {
			failure_class: "route-incompatible",
			cause: "route_unsupported",
			candidate_adapter_ids: ["caller-authored-adapter"],
		},
		expected: {
			posture: "operator",
			choice_ids: [],
			constraint_ids: ["no_adapter_fallback"],
		},
		legacy: "list_registered_adapters",
	},
	{
		name: "a transient probe failure after the bounded re-probe exhausts retries",
		invocation: CONNECT_0,
		context: {
			failure_class: "attachment-failed",
			cause: "transient_probe_failure",
			re_probe_attempted: true,
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_attachment_probe"],
			constraint_ids: [
				"no_adapter_fallback",
				"no_cross_invocation_retry",
				"no_mutation_from_diagnostics",
			],
		},
		legacy: "inspect_diagnostics",
	},
	{
		name: "a transient probe failure before the re-probe stays operator",
		invocation: CONNECT_0,
		context: {
			failure_class: "attachment-failed",
			cause: "transient_probe_failure",
			re_probe_attempted: false,
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_attachment_probe"],
			constraint_ids: ["no_adapter_fallback", "no_mutation_from_diagnostics"],
		},
		legacy: "inspect_diagnostics",
	},
	{
		name: "a non-transient probe failure is operator probe inspection",
		invocation: CONNECT_0,
		context: { failure_class: "attachment-failed", cause: "probe_failed" },
		expected: {
			posture: "operator",
			choice_ids: ["inspect_attachment_probe"],
			constraint_ids: ["no_adapter_fallback", "no_mutation_from_diagnostics"],
		},
		legacy: "inspect_diagnostics",
	},
	// --- run wrapped command -------------------------------------------------------
	{
		name: "a deterministic wrapped-command correction is automatic fix_wrapped_command",
		invocation: RUN_0,
		context: {
			failure_class: "wrapped-command-not-found",
			cause: "wrapped_executable_absent",
			deterministic_correction: true,
			executable_basename: "agent-browser",
		},
		expected: {
			posture: "automatic",
			next_action_id: "fix_wrapped_command",
			constraint_ids: [],
		},
		legacy: "fix_wrapped_command",
	},
	{
		name: "a non-deterministic wrapped-command correction requires the operator",
		invocation: RUN_0,
		context: {
			failure_class: "wrapped-command-not-found",
			cause: "wrapped_executable_absent",
			deterministic_correction: false,
		},
		expected: {
			posture: "operator",
			choice_ids: ["fix_wrapped_command"],
			constraint_ids: ["no_synthesized_caller_input"],
		},
		legacy: "change_input",
	},
	{
		name: "an unsafe executable basename fails closed to diagnostics",
		invocation: RUN_0,
		context: {
			failure_class: "wrapped-command-not-found",
			cause: "wrapped_executable_absent",
			deterministic_correction: true,
			executable_basename: "../bin/evil tool",
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_diagnostics"],
			constraint_ids: [
				"no_synthesized_caller_input",
				"no_mutation_from_diagnostics",
			],
		},
		legacy: "change_input",
	},
	// --- pre-exec inheritance --------------------------------------------------------
	{
		name: "a pre-exec connect failure inherits the underlying automatic launch",
		invocation: RUN_0,
		context: {
			failure_class: "preexec-connect-failed",
			cause: "preexec_connect_failure",
			underlying: UNDERLYING_NO_LISTENER,
		},
		expected: {
			posture: "automatic",
			next_action_id: "launch_agent_chrome",
			constraint_ids: ["no_adapter_fallback", "no_process_destruction"],
		},
		legacy: "launch_agent_chrome",
	},
	{
		name: "a pre-exec connect failure inherits the underlying suggested-port rerun",
		invocation: RUN_0,
		context: {
			failure_class: "preexec-connect-failed",
			cause: "preexec_connect_failure",
			underlying: UNDERLYING_OCCUPIED_WITH_SUGGESTION,
		},
		expected: {
			posture: "automatic",
			next_action_id: "use_suggested_port",
			constraint_ids: [
				"no_adapter_fallback",
				"no_internal_port_switch",
				"no_unverified_listener_connection",
				"no_process_destruction",
			],
		},
		legacy: "use_suggested_port",
	},
	{
		name: "a pre-exec connect failure inherits the underlying operator posture",
		invocation: RUN_0,
		context: {
			failure_class: "preexec-connect-failed",
			cause: "preexec_connect_failure",
			underlying: UNDERLYING_PROBE_FAILED,
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_attachment_probe"],
			constraint_ids: ["no_adapter_fallback", "no_mutation_from_diagnostics"],
		},
		legacy: "inspect_diagnostics",
	},
	// --- unexpected ---------------------------------------------------------------
	{
		name: "an unexpected runtime error is operator diagnostics",
		invocation: CONNECT_0,
		context: {
			failure_class: "runtime-error-unexpected",
			cause: "unexpected_runtime_error",
		},
		expected: {
			posture: "operator",
			choice_ids: ["inspect_diagnostics"],
			constraint_ids: ["no_mutation_from_diagnostics"],
		},
		legacy: "inspect_diagnostics",
	},
];

function selectStage(row: MatrixRow): BrowserConnectRepairStage {
	return selectBrowserConnectRepairPath(row.invocation, row.context);
}

function sorted(values: readonly string[]): readonly string[] {
	return [...values].toSorted();
}

function stageConstraintIds(stage: BrowserConnectRepairStage): string[] {
	return (stage.continuation.constraints ?? []).map(
		(constraint) => constraint.id,
	);
}

function stageChoiceIds(stage: BrowserConnectRepairStage): string[] {
	if (stage.posture !== "operator") return [];
	return (stage.continuation.choices ?? []).map((choice) => choice.id);
}

/**
 * Prove a stage is facade-valid by constructing a real runtime error envelope
 * from it. This exercises the facade's continuation, constraint, choice, and
 * docs-url validation exactly as the CLI projection will.
 */
function proveStageFacadeValid(stage: BrowserConnectRepairStage): void {
	const error = createCliRuntimeError({
		run_id: "run-repair-1",
		code: "repair_stage_under_test",
		message: "Repair stage under test.",
		exit_code: 20,
		recoverability: "none",
		retryable: false,
	});
	if (stage.posture === "automatic") {
		createCliRuntimeErrorEnvelope({
			run_id: "run-repair-1",
			process_exit_code: 20,
			error,
			runtime_actions: stage.runtime_actions,
			continuation: stage.continuation,
		});
		return;
	}
	createCliRuntimeErrorEnvelope({
		run_id: "run-repair-1",
		process_exit_code: 20,
		error,
		continuation: stage.continuation,
	});
}

describe("repair-path matrix selection (R4/R18)", () => {
	for (const row of MATRIX_ROWS) {
		test(row.name, () => {
			const stage = selectStage(row);
			expect(stage.posture).toBe(row.expected.posture);
			expect(sorted(stageConstraintIds(stage))).toEqual(
				sorted(row.expected.constraint_ids),
			);
			if (row.expected.posture === "automatic") {
				if (stage.posture !== "automatic") throw new Error("posture mismatch");
				expect(stage.continuation.next_action_id).toBe(
					row.expected.next_action_id,
				);
				expect(stage.runtime_actions.length).toBeGreaterThan(0);
				expect(stage.runtime_actions[0]?.id).toBe(row.expected.next_action_id);
			} else {
				if (stage.posture !== "operator") throw new Error("posture mismatch");
				expect(stage.continuation.requires_operator).toBe(true);
				expect(sorted(stageChoiceIds(stage))).toEqual(
					sorted(row.expected.choice_ids),
				);
			}
		});
	}

	test("matrix rows cover all 12 failure classes", () => {
		const covered = new Set(MATRIX_ROWS.map((row) => row.context.failure_class));
		for (const failureClass of BROWSER_CONNECT_FAILURE_CLASSES) {
			expect(covered.has(failureClass)).toBe(true);
		}
	});

	test("matrix rows cover every typed repair cause (R18)", () => {
		const covered = new Set<string>();
		for (const row of MATRIX_ROWS) {
			covered.add(row.context.cause);
			if (row.context.failure_class === "preexec-connect-failed") {
				covered.add(row.context.underlying.cause);
			}
		}
		for (const cause of BROWSER_CONNECT_REPAIR_CAUSES) {
			expect(covered.has(cause)).toBe(true);
		}
		expect(new Set(BROWSER_CONNECT_REPAIR_CAUSES).size).toBe(
			BROWSER_CONNECT_REPAIR_CAUSES.length,
		);
	});

	test("cause vocabulary groups stay stable", () => {
		expect(BROWSER_CONNECT_ENVIRONMENT_REPAIR_CAUSES).toEqual([
			"no_listener",
			"occupied_listener",
			"foreign_listener",
			"unverified_listener",
			"launch_failed",
			"transient_proof_failure",
		]);
		expect(BROWSER_CONNECT_ADAPTER_REPAIR_CAUSES).toEqual([
			"unregistered_adapter",
			"executable_absent",
			"version_mismatch",
			"route_unsupported",
			"transient_probe_failure",
			"probe_failed",
		]);
		expect(BROWSER_CONNECT_RUN_REPAIR_CAUSES).toEqual([
			"separator_missing",
			"wrapped_command_missing",
			"wrapped_executable_absent",
			"preexec_connect_failure",
		]);
		expect(BROWSER_CONNECT_REPAIR_CHAIN_HOPS).toEqual([0, 1]);
	});
});

describe("repair-path facade validity (R1/R25)", () => {
	for (const row of MATRIX_ROWS) {
		test(`facade-valid: ${row.name}`, () => {
			expect(() => proveStageFacadeValid(selectStage(row))).not.toThrow();
		});
	}

	test("every operator stage names at least one catalogue constraint (R25)", () => {
		for (const row of MATRIX_ROWS) {
			const stage = selectStage(row);
			if (stage.posture !== "operator") continue;
			expect(stage.continuation.constraints.length).toBeGreaterThan(0);
			for (const constraint of stage.continuation.constraints) {
				expect(
					(BROWSER_CONNECT_CONTINUATION_CONSTRAINT_IDS as readonly string[]).includes(
						constraint.id,
					),
				).toBe(true);
				expect(constraint.summary.trim().length).toBeGreaterThan(0);
			}
		}
	});

	test("the facade floor rejects an operator stage with zero constraints", () => {
		const error = createCliRuntimeError({
			run_id: "run-repair-floor",
			code: "constraint_floor",
			message: "Constraint floor under test.",
			exit_code: 20,
			recoverability: "none",
			retryable: false,
		});
		expect(() =>
			createCliRuntimeErrorEnvelope({
				run_id: "run-repair-floor",
				process_exit_code: 20,
				error,
				continuation: { requires_operator: true },
			}),
		).toThrow(/constraint summary/);
	});

	test("operator stages carry no next action and choices carry no action_id (KTD1)", () => {
		for (const row of MATRIX_ROWS) {
			const stage = selectStage(row);
			if (stage.posture !== "operator") continue;
			expect(
				(stage.continuation as { next_action_id?: string }).next_action_id,
			).toBeUndefined();
			for (const choice of stage.continuation.choices ?? []) {
				expect(choice.action_id).toBeUndefined();
				expect(choice.side_effects?.length ?? 0).toBeGreaterThan(0);
				expect(choice.docs_url).toBeDefined();
				expect(choice.label.trim().length).toBeGreaterThan(0);
				expect(choice.summary.trim().length).toBeGreaterThan(0);
			}
		}
	});

	test("automatic stages emit ordered actions with docs urls and one next action", () => {
		for (const row of MATRIX_ROWS) {
			const stage = selectStage(row);
			if (stage.posture !== "automatic") continue;
			expect(stage.runtime_actions.length).toBeGreaterThan(0);
			const ids = stage.runtime_actions.map((action) => action.id);
			expect(ids).toContain(stage.continuation.next_action_id);
			for (const action of stage.runtime_actions) {
				expect(action.docs_url).toBe(
					browserConnectRepairDocsUrl(action.id as BrowserConnectFailureActionId),
				);
				expect(action.side_effects.length).toBeGreaterThan(0);
			}
		}
	});
});

describe("repair-path compatibility-only exclusion (R20)", () => {
	test("compatibility-only ids never become the outer next action", () => {
		for (const row of MATRIX_ROWS) {
			const stage = selectStage(row);
			if (stage.posture === "automatic") {
				expect(
					(BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS as readonly string[]).includes(
						stage.continuation.next_action_id,
					),
				).toBe(false);
				for (const action of stage.runtime_actions) {
					expect(
						(BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS as readonly string[]).includes(
							action.id,
						),
					).toBe(false);
				}
			}
		}
	});

	test("resolve_connect_failure is never the primary continuation for pre-exec failures", () => {
		for (const row of MATRIX_ROWS) {
			if (row.context.failure_class !== "preexec-connect-failed") continue;
			const stage = selectStage(row);
			const serialized = JSON.stringify(stage);
			expect(serialized).not.toContain("resolve_connect_failure");
		}
	});

	test("compatibility-only ids stay discoverable in the action vocabulary", () => {
		for (const actionId of BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS) {
			expect(BROWSER_CONNECT_FAILURE_ACTION_IDS).toContain(actionId);
			expect(
				browserConnectRepairActionDefinitions[actionId].postures,
			).toEqual(["compatibility-only"]);
		}
	});
});

describe("repair-path legacy compatibility selector (R16/R30)", () => {
	for (const row of MATRIX_ROWS) {
		test(`legacy: ${row.name}`, () => {
			const stage = selectStage(row);
			expect(
				selectBrowserConnectLegacyNextAction({ context: row.context, stage }),
			).toBe(row.legacy);
		});
	}

	test("automatic stages mirror the exact outer next action", () => {
		for (const row of MATRIX_ROWS) {
			const stage = selectStage(row);
			if (stage.posture !== "automatic") continue;
			expect(
				selectBrowserConnectLegacyNextAction({ context: row.context, stage }),
			).toBe(stage.continuation.next_action_id);
		}
	});

	test("operator stages degrade only to the closed non-mutating stop set", () => {
		expect(BROWSER_CONNECT_LEGACY_COMPATIBILITY_STOP_IDS).toEqual([
			"change_input",
			"inspect_listener",
			"inspect_diagnostics",
			"list_registered_adapters",
		]);
		for (const row of MATRIX_ROWS) {
			const stage = selectStage(row);
			if (stage.posture !== "operator") continue;
			const legacy = selectBrowserConnectLegacyNextAction({
				context: row.context,
				stage,
			});
			expect(
				(BROWSER_CONNECT_LEGACY_COMPATIBILITY_STOP_IDS as readonly string[]).includes(
					legacy,
				),
			).toBe(true);
			const effects = browserConnectRepairActionDefinitions[legacy].side_effects;
			for (const effect of effects) {
				expect(["read", "check"]).toContain(effect);
			}
		}
	});

	test("legacy stops carry no forbidden mutating side effects (R30)", () => {
		for (const stopId of BROWSER_CONNECT_LEGACY_COMPATIBILITY_STOP_IDS) {
			const effects = browserConnectRepairActionDefinitions[stopId].side_effects;
			for (const banned of ["network", "write", "browser", "auth", "destructive"]) {
				expect(effects).not.toContain(banned);
			}
		}
	});

	test("a conflicting map entry falls back to inspect_diagnostics", () => {
		const context: BrowserConnectRepairContext = {
			failure_class: "foreign-listener",
			cause: "foreign_listener",
		};
		const stage = selectBrowserConnectRepairPath(CONNECT_0, context);
		if (stage.posture !== "operator") throw new Error("expected operator");
		const doctored: BrowserConnectOperatorRepairStage = {
			...stage,
			continuation: {
				...stage.continuation,
				constraints: [
					...stage.continuation.constraints,
					{
						id: "test_forbid_listener_stop",
						summary: "Forbid the listener stop for the conflict test.",
						forbidden_action_ids: ["inspect_listener"],
					},
				],
			},
		};
		expect(
			selectBrowserConnectLegacyNextAction({ context, stage: doctored }),
		).toBe("inspect_diagnostics");
	});

	test("a conflicting fallback fails closed instead of serializing", () => {
		const context: BrowserConnectRepairContext = {
			failure_class: "foreign-listener",
			cause: "foreign_listener",
		};
		const stage = selectBrowserConnectRepairPath(CONNECT_0, context);
		if (stage.posture !== "operator") throw new Error("expected operator");
		const doctored: BrowserConnectOperatorRepairStage = {
			...stage,
			continuation: {
				...stage.continuation,
				constraints: [
					...stage.continuation.constraints,
					{
						id: "test_forbid_all_stops",
						summary: "Forbid both compatibility stops for the conflict test.",
						forbidden_action_ids: ["inspect_listener", "inspect_diagnostics"],
					},
				],
			},
		};
		expect(() =>
			selectBrowserConnectLegacyNextAction({ context, stage: doctored }),
		).toThrow();
	});
});

describe("repair-path operator choice derivation (R24/R31)", () => {
	test("adapter handoff choices derive from trusted Adapter Definition ids in registry order", () => {
		const stage = selectBrowserConnectRepairPath(CONNECT_0, {
			failure_class: "route-incompatible",
			cause: "route_unsupported",
			candidate_adapter_ids: [AB, "evil-adapter", CDM, AB],
		});
		if (stage.posture !== "operator") throw new Error("expected operator");
		expect(stageChoiceIds(stage)).toEqual([
			`choose_registered_adapter:${CDM}`,
			`choose_registered_adapter:${AB}`,
		]);
		for (const choice of stage.continuation.choices ?? []) {
			expect(choice.recoverability).toBe("change_input");
			expect(sorted(choice.side_effects ?? [])).toEqual(
				sorted(["check", "network", "browser", "write"]),
			);
			expect(choice.docs_url).toBe(
				browserConnectRepairDocsUrl("select_compatible_route"),
			);
		}
	});

	test("manual install and review choices carry catalogue metadata", () => {
		const manualStage = selectBrowserConnectRepairPath(CONNECT_0, {
			failure_class: "adapter-not-installed",
			cause: "executable_absent",
			adapter_id: CDM,
			manual_install_inputs_complete: true,
		});
		if (manualStage.posture !== "operator") throw new Error("expected operator");
		const manualChoice = (manualStage.continuation.choices ?? [])[0];
		expect(manualChoice?.id).toBe(`install_registered_adapter_manually:${CDM}`);
		expect(manualChoice?.recoverability).toBe("repair_state");
		expect(sorted(manualChoice?.side_effects ?? [])).toEqual(
			sorted(["network", "write"]),
		);
		expect(manualChoice?.docs_url).toBe(
			browserConnectRepairDocsUrl("install_adapter"),
		);

		const reviewStage = selectBrowserConnectRepairPath(CONNECT_0, {
			failure_class: "adapter-not-installed",
			cause: "executable_absent",
			adapter_id: CDM,
			manual_install_inputs_complete: false,
		});
		if (reviewStage.posture !== "operator") throw new Error("expected operator");
		const reviewChoice = (reviewStage.continuation.choices ?? [])[0];
		expect(reviewChoice?.id).toBe(`review_adapter_definition:${CDM}`);
		expect(reviewChoice?.recoverability).toBe("repair_state");
		expect(sorted(reviewChoice?.side_effects ?? [])).toEqual(sorted(["write"]));
		expect(reviewChoice?.docs_url).toBe(
			browserConnectRepairDocsUrl("review_adapter_definition"),
		);
	});

	test("inspect and pin choices use package-owned catalogue metadata", () => {
		const listenerStage = selectBrowserConnectRepairPath(CONNECT_0, {
			failure_class: "foreign-listener",
			cause: "foreign_listener",
		});
		if (listenerStage.posture !== "operator") {
			throw new Error("expected operator");
		}
		const listenerChoice = (listenerStage.continuation.choices ?? [])[0];
		expect(listenerChoice?.id).toBe("inspect_listener");
		expect(listenerChoice?.recoverability).toBe("repair_state");
		expect(sorted(listenerChoice?.side_effects ?? [])).toEqual(
			sorted(["read", "check"]),
		);

		const pinStage = selectBrowserConnectRepairPath(CONNECT_0, {
			failure_class: "adapter-not-installed",
			cause: "version_mismatch",
			adapter_id: CDM,
			observed_version: "0.6.0",
			pinned_version: "0.8.1",
			transition_allowlisted: false,
		});
		if (pinStage.posture !== "operator") throw new Error("expected operator");
		const pinChoice = (pinStage.continuation.choices ?? [])[0];
		expect(pinChoice?.id).toBe("adjust_adapter_pin");
		expect(pinChoice?.recoverability).toBe("repair_state");
		expect(sorted(pinChoice?.side_effects ?? [])).toEqual(sorted(["write"]));

		const probeStage = selectBrowserConnectRepairPath(CONNECT_0, {
			failure_class: "attachment-failed",
			cause: "probe_failed",
		});
		if (probeStage.posture !== "operator") throw new Error("expected operator");
		const probeChoice = (probeStage.continuation.choices ?? [])[0];
		expect(probeChoice?.id).toBe("inspect_attachment_probe");
		expect(sorted(probeChoice?.side_effects ?? [])).toEqual(
			sorted(["read", "check", "browser"]),
		);
	});
});

describe("repair-path listener terminality (R32/KTD14)", () => {
	test("no stage ever projects a process-destructive or pruned action", () => {
		for (const row of MATRIX_ROWS) {
			const serialized = JSON.stringify(selectStage(row));
			expect(serialized).not.toContain("free_occupied_port");
			expect(serialized).not.toContain("terminate_listener");
			expect(serialized).not.toContain("reprove_environment");
			expect(serialized).not.toContain("reprobe_attachment");
		}
	});

	test("pruned action ids stay out of the action vocabulary", () => {
		for (const banned of [
			"free_occupied_port",
			"terminate_listener",
			"reprove_environment",
			"reprobe_attachment",
		]) {
			expect(BROWSER_CONNECT_FAILURE_ACTION_IDS).not.toContain(banned);
		}
	});

	test("listener stages are terminal: only listener inspection, no follow-on action", () => {
		const stage = selectBrowserConnectRepairPath(CONNECT_0, {
			failure_class: "foreign-listener",
			cause: "foreign_listener",
		});
		if (stage.posture !== "operator") throw new Error("expected operator");
		expect(stageChoiceIds(stage)).toEqual(["inspect_listener"]);
		const constraintIds = stageConstraintIds(stage);
		expect(constraintIds).toContain("no_process_destruction");
		expect(constraintIds).toContain("no_unverified_listener_connection");
	});

	test("listener contexts carry no ownership-ingestion fields", () => {
		const context: BrowserConnectRepairContext = {
			failure_class: "foreign-listener",
			cause: "occupied_listener",
			suggested_explicit_port: { port: 9333, verified_free: true },
		};
		expect(Object.keys(context).toSorted()).toEqual([
			"cause",
			"failure_class",
			"suggested_explicit_port",
		]);
	});
});

describe("repair-path run-context non-projection (R26)", () => {
	test("separator repair context carries only the non-empty-command marker", () => {
		const context: BrowserConnectRepairContext = {
			failure_class: "run-missing-separator",
			cause: "separator_missing",
			wrapped_command_present: true,
		};
		expect(Object.keys(context).toSorted()).toEqual([
			"cause",
			"failure_class",
			"wrapped_command_present",
		]);
	});

	test("stages never echo hostile context values into projected text", () => {
		const hostile = {
			failure_class: "run-missing-separator",
			cause: "separator_missing",
			wrapped_command_present: true,
			wrapped_argv: ["--flag=hostile-value-never-projected"],
			executable_path: "/Users/hostile/bin/never-projected",
		} as unknown as BrowserConnectRepairContext;
		const serialized = JSON.stringify(
			selectBrowserConnectRepairPath(RUN_0, hostile),
		);
		expect(serialized).not.toContain("hostile");
		expect(serialized).not.toContain("never-projected");
	});

	test("a safe basename is never copied into stage prose", () => {
		const stage = selectBrowserConnectRepairPath(RUN_0, {
			failure_class: "wrapped-command-not-found",
			cause: "wrapped_executable_absent",
			deterministic_correction: true,
			executable_basename: "distinctive-basename",
		});
		expect(JSON.stringify(stage)).not.toContain("distinctive-basename");
	});
});

describe("repair-path fail-closed unknown context (R9)", () => {
	test("an unknown failure class fails closed to operator diagnostics", () => {
		const stage = selectBrowserConnectRepairPath(CONNECT_0, {
			failure_class: "brand-new-class",
			cause: "mystery",
		} as unknown as BrowserConnectRepairContext);
		expect(stage.posture).toBe("operator");
		expect(stageChoiceIds(stage)).toEqual(["inspect_diagnostics"]);
		expect(stageConstraintIds(stage)).toContain("no_mutation_from_diagnostics");
	});

	test("an unknown cause within a known class fails closed", () => {
		const stage = selectBrowserConnectRepairPath(CONNECT_0, {
			failure_class: "adapter-not-installed",
			cause: "mystery_cause",
		} as unknown as BrowserConnectRepairContext);
		expect(stage.posture).toBe("operator");
		expect(stageChoiceIds(stage)).toEqual(["inspect_diagnostics"]);
	});

	test("an out-of-contract repair-chain hop fails closed", () => {
		const stage = selectBrowserConnectRepairPath(
			{ command: "connect", repair_chain_hop: 2 } as unknown as
				BrowserConnectRepairInvocation,
			{
				failure_class: "environment-absent",
				cause: "no_listener",
				explicit_port_free: true,
			},
		);
		expect(stage.posture).toBe("operator");
		expect(stageChoiceIds(stage)).toEqual(["inspect_diagnostics"]);
	});

	test("unknown context degrades legacy compatibility to inspect_diagnostics", () => {
		const context = {
			failure_class: "brand-new-class",
			cause: "mystery",
		} as unknown as BrowserConnectRepairContext;
		const stage = selectBrowserConnectRepairPath(CONNECT_0, context);
		expect(selectBrowserConnectLegacyNextAction({ context, stage })).toBe(
			"inspect_diagnostics",
		);
	});
});

describe("repair-path action contract catalogue (R2/R17)", () => {
	test("stable action vocabulary includes the additive repair ids", () => {
		expect(BROWSER_CONNECT_FAILURE_ACTION_IDS).toEqual([
			"change_input",
			"add_run_separator",
			"launch_agent_chrome",
			"inspect_listener",
			"inspect_diagnostics",
			"list_registered_adapters",
			"install_adapter",
			"select_compatible_route",
			"inspect_attachment_probe",
			"resolve_connect_failure",
			"fix_wrapped_command",
			"use_suggested_port",
			"upgrade_adapter_to_pin",
			"adjust_adapter_pin",
			"review_adapter_definition",
		]);
	});

	test("every action id carries one complete Repair Action Contract record", () => {
		const definedIds = Object.keys(browserConnectRepairActionDefinitions);
		expect(definedIds.toSorted()).toEqual(
			[...BROWSER_CONNECT_FAILURE_ACTION_IDS].toSorted(),
		);
		for (const actionId of BROWSER_CONNECT_FAILURE_ACTION_IDS) {
			const definition = browserConnectRepairActionDefinitions[actionId];
			expect(definition.id).toBe(actionId);
			expect(definition.postures.length).toBeGreaterThan(0);
			expect(definition.owner.trim().length).toBeGreaterThan(0);
			expect(definition.side_effects.length).toBeGreaterThan(0);
			expect(definition.success_evidence.trim().length).toBeGreaterThan(0);
			expect(definition.stop_condition.trim().length).toBeGreaterThan(0);
			expect(definition.docs_url).toBe(browserConnectRepairDocsUrl(actionId));
			expect([0, 1]).toContain(definition.retry.attempt_budget);
			expect(definition.retry.exhausted_posture).toBe("operator");
			if (definition.postures.includes("compatibility-only")) {
				expect(definition.selection_causes).toEqual([]);
			} else {
				expect(definition.selection_causes.length).toBeGreaterThan(0);
			}
			if (definition.postures.includes("automatic")) {
				expect(definition.required_context.length).toBeGreaterThan(0);
			}
		}
	});

	test("definition side effects match the model affordance catalog", () => {
		for (const action of browserConnectFailureActions) {
			expect(
				browserConnectRepairActionDefinitions[action.id].side_effects,
			).toEqual(action.sideEffects);
		}
	});

	test("selection causes resolve to typed repair causes", () => {
		for (const actionId of BROWSER_CONNECT_FAILURE_ACTION_IDS) {
			for (const cause of browserConnectRepairActionDefinitions[actionId]
				.selection_causes) {
				expect(BROWSER_CONNECT_REPAIR_CAUSES).toContain(cause);
			}
		}
	});
});

describe("repair-path versioned docs urls (R2/R14)", () => {
	test("urls derive from the contract version and stable action id", () => {
		expect(BROWSER_CONNECT_REPAIR_CONTRACT_VERSION).toBe("v1");
		expect(BROWSER_CONNECT_REPAIR_DOCS_BASE_URL).toBe(
			"https://github.com/nathanvale/claude-code-config/blob/main/runtime/browser-connect/REPAIR.md",
		);
		expect(browserConnectRepairDocsUrl("install_adapter")).toBe(
			"https://github.com/nathanvale/claude-code-config/blob/main/runtime/browser-connect/REPAIR.md#v1-install_adapter",
		);
	});

	test("every definition docs url uses a versioned fragment for a known action", () => {
		const pattern =
			/^https:\/\/github\.com\/nathanvale\/claude-code-config\/blob\/main\/runtime\/browser-connect\/REPAIR\.md#v1-([a-z_]+)$/;
		for (const actionId of BROWSER_CONNECT_FAILURE_ACTION_IDS) {
			const match =
				browserConnectRepairActionDefinitions[actionId].docs_url.match(pattern);
			expect(match?.[1]).toBe(actionId);
		}
	});

	test("every emitted choice docs url resolves to a known action fragment", () => {
		const pattern = /#v1-([a-z_]+)$/;
		for (const row of MATRIX_ROWS) {
			const stage = selectStage(row);
			if (stage.posture !== "operator") continue;
			for (const choice of stage.continuation.choices ?? []) {
				const fragment = choice.docs_url?.match(pattern)?.[1];
				expect(fragment).toBeDefined();
				expect(BROWSER_CONNECT_FAILURE_ACTION_IDS).toContain(
					fragment as BrowserConnectFailureActionId,
				);
			}
		}
	});
});

describe("repair-path constraint catalogue (R25)", () => {
	test("the catalogue covers exactly the eight declared constraints", () => {
		expect([...BROWSER_CONNECT_CONTINUATION_CONSTRAINT_IDS].toSorted()).toEqual(
			[
				"no_adapter_fallback",
				"no_cross_invocation_retry",
				"no_internal_port_switch",
				"no_mutation_from_diagnostics",
				"no_pin_policy_change",
				"no_process_destruction",
				"no_synthesized_caller_input",
				"no_unverified_listener_connection",
			],
		);
		for (const constraintId of BROWSER_CONNECT_CONTINUATION_CONSTRAINT_IDS) {
			const constraint: RuntimeContinuationConstraint =
				browserConnectContinuationConstraints[constraintId];
			expect(constraint.id).toBe(constraintId);
			expect(constraint.summary.trim().length).toBeGreaterThan(0);
		}
	});

	test("hop-1 constraints forbid another suggested-port continuation (R23)", () => {
		const constraint =
			browserConnectContinuationConstraints.no_cross_invocation_retry;
		expect(constraint.forbidden_action_ids).toContain("use_suggested_port");
	});

	test("process destruction is mechanically forbidden on listener stages", () => {
		const constraint =
			browserConnectContinuationConstraints.no_process_destruction;
		expect(constraint.forbidden_side_effects).toContain("destructive");
	});
});
