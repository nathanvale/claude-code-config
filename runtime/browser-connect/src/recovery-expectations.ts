import type { BrowserConnectStationId } from "./branch-station-catalog.ts";
import type {
	BrowserConnectFailureActionId,
	BrowserConnectFailureClass,
} from "./model.ts";
import type {
	BrowserConnectContinuationConstraintId,
	BrowserConnectLegacyCompatibilityStopId,
} from "./repair-path.ts";

// ---------------------------------------------------------------------------
// Package recovery-expectation map (R13/AE1). One record per target error
// station, separate from Station Map reconciliation: the Station Map proves
// envelope shape at the process boundary; THIS map declares which recovery
// postures a station may project — its automatic action ids, its operator
// choice ids, the constraint floor every operator stage must carry, and the
// legacy schema-1 `data.next_action_id` values allowed for it (R16/R30).
// Tests drive each station arm through the projection chokepoint and reject
// any posture this map does not declare.
// ---------------------------------------------------------------------------

/**
 * Success-station ids excluded from recovery expectations. Kept as an explicit
 * exclusion (rather than a copied error list) so a NEW catalog station fails
 * compilation until it is classified here or in the expectation map.
 */
export const BROWSER_CONNECT_SUCCESS_STATION_IDS = [
	"dashboard.ok",
	"check.verified",
	"connect.verified_existing",
	"connect.verified_launched",
	"run.passthrough_success",
	"run.passthrough_failure",
	"repair-adapter.preview",
	"repair-adapter.installed",
	"repair-adapter.upgraded",
] as const satisfies readonly BrowserConnectStationId[];

/**
 * The 14 target error stations (R1): every catalog station that is not a
 * success station.
 */
export type BrowserConnectErrorStationId = Exclude<
	BrowserConnectStationId,
	(typeof BROWSER_CONNECT_SUCCESS_STATION_IDS)[number]
>;

/**
 * Recovery expectation for one error station (R13).
 *
 * - `failure_classes`: the typed failure classes homing on this station.
 * - `automatic_action_ids`: every action id the station may project as an
 *   automatic `continuation.next_action_id`. Empty means operator-only.
 * - `operator_choice_ids`: the complete package/registry-derived choice-id
 *   vocabulary an operator stage on this station may offer.
 * - `operator_constraint_floor`: constraint ids present on EVERY operator
 *   stage of this station (each stage may add more; the facade already
 *   rejects an operator stage with zero constraint summaries, R25).
 * - `legacy_next_action_ids`: every schema-1 `data.next_action_id` value the
 *   station may serialize — the automatic mirrors plus the closed
 *   non-mutating compatibility stops (R30).
 */
export type BrowserConnectStationRecoveryExpectation = {
	failure_classes: readonly BrowserConnectFailureClass[];
	automatic_action_ids: readonly BrowserConnectFailureActionId[];
	operator_choice_ids: readonly string[];
	operator_constraint_floor: readonly BrowserConnectContinuationConstraintId[];
	legacy_next_action_ids: readonly BrowserConnectFailureActionId[];
};

const ADAPTER_HANDOFF_CHOICE_IDS = [
	"choose_registered_adapter:chrome-devtools-mcp",
	"choose_registered_adapter:agent-browser",
] as const;

const ADAPTER_INSTALL_DECISION_CHOICE_IDS = [
	"install_registered_adapter_manually:chrome-devtools-mcp",
	"install_registered_adapter_manually:agent-browser",
	"review_adapter_definition:chrome-devtools-mcp",
	"review_adapter_definition:agent-browser",
	"adjust_adapter_pin",
] as const;

const LEGACY_STOPS = {
	change_input: "change_input",
	inspect_listener: "inspect_listener",
	inspect_diagnostics: "inspect_diagnostics",
	list_registered_adapters: "list_registered_adapters",
} as const satisfies Record<
	BrowserConnectLegacyCompatibilityStopId,
	BrowserConnectLegacyCompatibilityStopId
>;

/**
 * The exhaustive recovery-expectation map (R13/AE1): a Record over the full
 * error-station union, so a new error station fails compilation until its
 * recovery posture is declared here.
 */
export const browserConnectRecoveryExpectations: Record<
	BrowserConnectErrorStationId,
	BrowserConnectStationRecoveryExpectation
> = {
	"check.usage_invalid": {
		failure_classes: ["usage-invalid"],
		automatic_action_ids: ["change_input"],
		operator_choice_ids: ["provide_corrected_input"],
		operator_constraint_floor: ["no_synthesized_caller_input"],
		legacy_next_action_ids: [LEGACY_STOPS.change_input],
	},
	"run.missing_separator": {
		failure_classes: ["run-missing-separator"],
		automatic_action_ids: ["add_run_separator"],
		operator_choice_ids: ["provide_wrapped_command"],
		operator_constraint_floor: ["no_synthesized_caller_input"],
		legacy_next_action_ids: ["add_run_separator", LEGACY_STOPS.change_input],
	},
	"check.environment_absent": {
		failure_classes: ["environment-absent"],
		automatic_action_ids: ["launch_agent_chrome"],
		operator_choice_ids: ["inspect_diagnostics"],
		operator_constraint_floor: ["no_adapter_fallback", "no_mutation_from_diagnostics"],
		legacy_next_action_ids: [
			"launch_agent_chrome",
			LEGACY_STOPS.inspect_diagnostics,
		],
	},
	"check.foreign_listener": {
		failure_classes: ["foreign-listener"],
		automatic_action_ids: [],
		operator_choice_ids: ["inspect_listener"],
		operator_constraint_floor: [
			"no_adapter_fallback",
			"no_unverified_listener_connection",
			"no_process_destruction",
			"no_mutation_from_diagnostics",
		],
		legacy_next_action_ids: [LEGACY_STOPS.inspect_listener],
	},
	"connect.launch_failed": {
		failure_classes: ["launch-failed"],
		automatic_action_ids: [],
		operator_choice_ids: ["inspect_diagnostics"],
		operator_constraint_floor: ["no_adapter_fallback", "no_mutation_from_diagnostics"],
		legacy_next_action_ids: [LEGACY_STOPS.inspect_diagnostics],
	},
	"connect.foreign_listener": {
		failure_classes: ["foreign-listener"],
		automatic_action_ids: ["use_suggested_port"],
		operator_choice_ids: ["inspect_listener"],
		operator_constraint_floor: [
			"no_adapter_fallback",
			"no_unverified_listener_connection",
			"no_process_destruction",
			"no_mutation_from_diagnostics",
		],
		legacy_next_action_ids: [
			"use_suggested_port",
			LEGACY_STOPS.inspect_listener,
		],
	},
	"connect.adapter_unknown": {
		failure_classes: ["adapter-unknown"],
		automatic_action_ids: ["change_input"],
		operator_choice_ids: [...ADAPTER_HANDOFF_CHOICE_IDS],
		operator_constraint_floor: ["no_synthesized_caller_input"],
		legacy_next_action_ids: [
			"change_input",
			LEGACY_STOPS.list_registered_adapters,
		],
	},
	"connect.adapter_not_installed": {
		failure_classes: ["adapter-not-installed"],
		automatic_action_ids: ["install_adapter", "upgrade_adapter_to_pin"],
		operator_choice_ids: [...ADAPTER_INSTALL_DECISION_CHOICE_IDS],
		operator_constraint_floor: ["no_pin_policy_change"],
		legacy_next_action_ids: [
			"install_adapter",
			"upgrade_adapter_to_pin",
			LEGACY_STOPS.list_registered_adapters,
		],
	},
	"connect.route_incompatible": {
		failure_classes: ["route-incompatible"],
		automatic_action_ids: [],
		operator_choice_ids: [...ADAPTER_HANDOFF_CHOICE_IDS],
		operator_constraint_floor: ["no_adapter_fallback"],
		legacy_next_action_ids: [LEGACY_STOPS.list_registered_adapters],
	},
	"connect.attachment_failed": {
		failure_classes: ["attachment-failed"],
		automatic_action_ids: [],
		operator_choice_ids: ["inspect_attachment_probe"],
		operator_constraint_floor: ["no_adapter_fallback", "no_mutation_from_diagnostics"],
		legacy_next_action_ids: [LEGACY_STOPS.inspect_diagnostics],
	},
	"run.preexec_connect_failed": {
		// R12/AE10: the pre-exec station inherits the exact underlying
		// environment or adapter posture; its expectation is the union of the
		// inheritable stations' expectations, and resolve_connect_failure stays
		// compatibility-only (never a projected continuation).
		failure_classes: ["preexec-connect-failed"],
		automatic_action_ids: [
			"launch_agent_chrome",
			"use_suggested_port",
			"change_input",
			"install_adapter",
			"upgrade_adapter_to_pin",
		],
		operator_choice_ids: [
			"inspect_listener",
			"inspect_diagnostics",
			"inspect_attachment_probe",
			...ADAPTER_HANDOFF_CHOICE_IDS,
			...ADAPTER_INSTALL_DECISION_CHOICE_IDS,
		],
		operator_constraint_floor: [],
		legacy_next_action_ids: [
			"launch_agent_chrome",
			"use_suggested_port",
			"install_adapter",
			"upgrade_adapter_to_pin",
			LEGACY_STOPS.change_input,
			LEGACY_STOPS.inspect_listener,
			LEGACY_STOPS.inspect_diagnostics,
			LEGACY_STOPS.list_registered_adapters,
		],
	},
	"run.wrapped_not_found": {
		failure_classes: ["wrapped-command-not-found"],
		automatic_action_ids: ["fix_wrapped_command"],
		operator_choice_ids: ["fix_wrapped_command", "inspect_diagnostics"],
		operator_constraint_floor: ["no_synthesized_caller_input"],
		legacy_next_action_ids: [
			"fix_wrapped_command",
			LEGACY_STOPS.change_input,
			LEGACY_STOPS.inspect_diagnostics,
		],
	},
	"check.runtime_error": {
		failure_classes: ["runtime-error-unexpected"],
		automatic_action_ids: [],
		operator_choice_ids: ["inspect_diagnostics"],
		operator_constraint_floor: ["no_mutation_from_diagnostics"],
		legacy_next_action_ids: [LEGACY_STOPS.inspect_diagnostics],
	},
	"repair-adapter.operator_stop": {
		failure_classes: ["adapter-not-installed"],
		automatic_action_ids: [],
		operator_choice_ids: [
			...ADAPTER_INSTALL_DECISION_CHOICE_IDS,
			"inspect_diagnostics",
		],
		operator_constraint_floor: [],
		legacy_next_action_ids: [
			LEGACY_STOPS.list_registered_adapters,
			LEGACY_STOPS.inspect_diagnostics,
		],
	},
};

/**
 * Error-station ids in catalog order, for reconciliation tests.
 */
export const BROWSER_CONNECT_ERROR_STATION_IDS = Object.keys(
	browserConnectRecoveryExpectations,
) as readonly BrowserConnectErrorStationId[];
