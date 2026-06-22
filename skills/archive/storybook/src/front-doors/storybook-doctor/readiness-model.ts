/**
 * Package-owned Storybook readiness proof vocabulary.
 *
 * Status, finding categories, next-action ids, and result contract constants
 * live here so the CLI, tests, and skill docs share one source of truth.
 */

export const STORYBOOK_DOCTOR_CONTRACT_ID = "storybook-doctor.check";
export const STORYBOOK_DOCTOR_DEEP_CONTRACT_ID = "storybook-doctor.deep";
export const STORYBOOK_DOCTOR_COMMANDS_CONTRACT_ID = "storybook-doctor.commands";
export const STORYBOOK_DOCTOR_SCHEMA_VERSION = "1";

export const READINESS_STATUSES = ["ready", "degraded", "blocked"] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

export const FINDING_CATEGORIES = [
	"target_failure",
	"setup_failure",
	"mcp_setup_failure",
	"safety_failure",
	"live_readiness",
	"mcp_failure",
	"mcp_proof",
	"setup_hint",
	"helper_gap",
	"test_gap",
	"a11y_gap",
	"process_owner_hint",
	"deep_proof",
	"local_tool_gap",
	"doctor_finding",
	"output_safety",
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const NEXT_ACTION_IDS = [
	"create_package_json",
	"add_storybook_config",
	"install_storybook",
	"install_mcp_addon",
	"configure_mcp_addon",
	"add_storybook_script",
	"start_storybook",
	"use_loopback_url",
	"check_mcp_addon",
	"install_mcporter",
	"install_test_tools",
	"install_a11y_tools",
	"install_tmux",
	"install_local_storybook",
	"fix_storybook_doctor_issues",
	"none",
] as const;
export type NextActionId = (typeof NEXT_ACTION_IDS)[number];

export const STORYBOOK_DOCTOR_DIAGNOSTIC_CODES = [
	"usage_error",
	"target_not_found",
	"config_missing",
	"dependency_missing",
	"mcp_addon_missing",
	"session_missing",
	"safety_violation",
	"mcp_unreachable",
	"runtime_failure",
	"deep_binary_missing",
	"deep_doctor_failed",
	"deep_output_truncated",
] as const;
export type StorybookDoctorDiagnosticCode =
	(typeof STORYBOOK_DOCTOR_DIAGNOSTIC_CODES)[number];

export type ReadinessFinding = {
	readonly id: string;
	readonly category: FindingCategory;
	readonly severity: ReadinessStatus;
	readonly message: string;
	readonly detail?: string;
};

export type NextSafeAction = {
	readonly id: NextActionId;
	readonly summary: string;
};

export type ReadinessResult = {
	readonly status: ReadinessStatus;
	readonly findings: readonly ReadinessFinding[];
	readonly next_safe_action: NextSafeAction;
	readonly target: TargetInfo;
	readonly session: SessionInfo | null;
};

export type TargetInfo = {
	readonly resolved_path: string;
	readonly has_package_json: boolean;
	readonly has_storybook_config: boolean;
	readonly has_storybook_dependency: boolean;
	readonly has_mcp_addon_dependency: boolean;
	readonly has_mcp_addon_config: boolean;
	readonly has_storybook_script: boolean;
};

export type SessionInfo = {
	readonly url: string;
	readonly is_loopback: boolean;
	readonly manager_reachable: boolean;
	readonly mcp_reachable: boolean;
	readonly mcp_tools_count: number | null;
	readonly port_owner_pid: number | null;
	readonly port_owner_command: string | null;
};

export type DeepResult = ReadinessResult & {
	readonly deep: DeepEvidence;
};

export type DeepEvidence = {
	readonly local_binary_found: boolean;
	readonly doctor_exit_code: number | null;
	readonly doctor_summary: readonly string[];
	readonly truncated: boolean;
	readonly redacted_count: number;
};
