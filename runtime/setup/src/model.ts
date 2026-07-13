/** Package-owned result contract for Setup inspection and mutation outcomes. */
export const SETUP_RESULT_CONTRACT_ID = "setup.result" as const;

/** Package-owned result contract for command discovery. */
export const SETUP_COMMANDS_CONTRACT_ID = "setup.commands" as const;

/** Machine schema version for Setup v1 results. */
export const SETUP_SCHEMA_VERSION = "1" as const;

/** Canonical CLI and workspace binary name. */
export const SETUP_CLI_NAME = "setup" as const;

/** Public facade command order. No argv is a parser-owned alias of status. */
export const SETUP_COMMANDS = [
	"status",
	"doctor",
	"sync",
	"unlink",
	"catalog",
	"commands",
] as const;

export type SetupCommand = (typeof SETUP_COMMANDS)[number];

/** Supported projection scopes. */
export const SETUP_SCOPES = ["user", "project"] as const;

export type SetupScope = (typeof SETUP_SCOPES)[number];

/** Stable finding ids shared by inspection, planning, and rendering. */
export const SETUP_FINDING_IDS = [
	"missing_link",
	"wrong_link",
	"broken_managed_link",
	"source_missing",
	"real_entry",
	"foreign_symlink",
	"external_entry",
	"legacy_codex_root",
	"invalid_skill",
	"catalog_escape",
	"canonical_id_collision",
	"duplicate_scope",
	"malformed_provider_lock",
	"unsafe_root",
	"operation_busy",
	"stale_operation_lock",
	"dependency_unhealthy",
	"hook_unhealthy",
	"instruction_unhealthy",
	"runbook_artifact_unhealthy",
] as const;

export type SetupFindingId = (typeof SETUP_FINDING_IDS)[number];

/** Stable discovery and runtime continuation action ids. */
export const SETUP_ACTION_IDS = [
	"preview_sync",
	"run_sync",
	"run_doctor",
	"human_repair",
	"change_input",
	"inspect_diagnostics",
	"repair_dependency",
	"inspect_lock",
	"retry",
	"setup_healthy",
	"rerun_check",
	"repair_hooks",
	"repair_instructions",
	"repair_runbook",
	"run_unlink",
	"clean_state",
	"inspect_results",
	"inspect_catalog",
	"use_source",
	"discover_external",
] as const;

export type SetupActionId = (typeof SETUP_ACTION_IDS)[number];

/** Result states used by aggregate setup outcomes. */
export const SETUP_RESULT_STATES = [
	"healthy",
	"clean_slate",
	"drift",
	"repairable",
	"changes",
	"blocked",
	"partial",
	"applied",
	"removed",
	"noop",
	"failed",
] as const;

export type SetupResultState = (typeof SETUP_RESULT_STATES)[number];

/** One package-owned diagnostic finding. */
export interface SetupFinding {
	id: SetupFindingId;
	owner: string;
	path?: string;
	summary: string;
	why?: string;
	repair: SetupActionId;
}

/** One deterministic filesystem operation proposed from immutable evidence. */
export interface SetupOperation {
	domain: string;
	action: "create_link" | "relink";
	root_id: "claude" | "codex";
	root_path: string;
	id: string;
	canonical_id: string;
	destination: string;
	desired_source: string;
	expected_ownership: "missing" | "managed_link" | "broken_managed_link";
	link_form: "absolute" | "relative";
}

/** Per-root preflight evidence retained for apply-time atomicity checks. */
export interface SetupProjectionTargetPlan {
	root_id: "claude" | "codex";
	root_path: string;
	blocked: boolean;
	blockers: readonly SetupFinding[];
	operations: readonly SetupOperation[];
	preserved: readonly string[];
}

/** Bounded counts used by status without hiding verbose path evidence. */
export interface SetupCounts {
	catalog: number;
	managed: number;
	external: number;
	planned: number;
	blockers: number;
}

/** Catalog entry projected into stable command output. */
export interface SetupCatalogResultEntry {
	id: string;
	canonical_id: string;
	state: "valid" | "invalid" | "escape" | "collision" | "missing";
	path?: string;
	name?: string;
	description?: string;
	occupancy: readonly string[];
}

/** Exact path evidence returned by every write-domain result. */
export interface SetupDomainResult {
	domain: string;
	planned: readonly string[];
	applied: readonly string[];
	deferred: readonly string[];
	preserved: readonly string[];
	failed: readonly string[];
}

/** Shared Setup result payload before facade metadata is attached. */
export interface SetupResult {
	command: SetupCommand;
	scope: SetupScope;
	state: SetupResultState;
	findings: readonly SetupFinding[];
	domains: readonly SetupDomainResult[];
	operations: readonly SetupOperation[];
	projection_targets: readonly SetupProjectionTargetPlan[];
	counts: SetupCounts;
	catalog_root: string;
	destination_roots: readonly string[];
	catalog_entries?: readonly SetupCatalogResultEntry[];
	station: string;
	next_action?: SetupActionId;
	evidence_fingerprint?: string;
}

/** Explicit migration disposition for superseded agent-skills behavior. */
export const AGENT_SKILLS_FEATURE_DISPOSITION = {
	status: "keep",
	check_apply: "keep",
	managed_unlink: "keep",
	command_discovery: "keep",
	catalog_visibility: "keep",
	external_preservation: "keep",
	canonical_safety: "keep",
	ignore_editing: "drop",
	new_since_snapshot: "drop",
	custom_roots_and_catalogs: "drop",
	external_acquisition: "external",
} as const;

/** Explicit migration disposition for superseded install.sh behavior. */
export const INSTALL_SH_FEATURE_DISPOSITION = {
	startup_links: "keep",
	hook_installation: "keep_stronger_safety",
	instruction_health: "keep",
	runbook_artifact: "keep",
	status: "keep",
	unlink: "keep_narrower_proof",
	whole_folder_claude_skills: "replace",
	legacy_codex_skills: "replace",
} as const;
