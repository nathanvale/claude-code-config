/**
 * Package-owned contract id for local skill projection results.
 *
 * @defaultValue "agent-skills.projection"
 */
export const AGENT_SKILLS_CONTRACT_ID = "agent-skills.projection" as const;

/**
 * Machine schema version for v1 agent-skills JSON results.
 *
 * @defaultValue "1"
 */
export const AGENT_SKILLS_SCHEMA_VERSION = "1" as const;

/**
 * Canonical package and CLI name.
 *
 * @defaultValue "agent-skills"
 */
export const AGENT_SKILLS_CLI_NAME = "agent-skills" as const;

/**
 * Public v1 command ids.
 */
export const AGENT_SKILLS_COMMANDS = [
	"sync",
	"status",
	"list",
	"ignore",
	"unlink",
	"commands",
] as const;

/**
 * Command id union for facade-backed routing.
 */
export type AgentSkillsCommand = (typeof AGENT_SKILLS_COMMANDS)[number];

/**
 * Projection roots owned by the local runtime.
 */
export const AGENT_SKILLS_PROJECTION_ROOTS = [
	".agents/skills",
	".claude/skills",
] as const;

/**
 * Snapshot path for generated local projection state.
 *
 * @defaultValue ".agents/agent-skills-snapshot.json"
 */
export const AGENT_SKILLS_SNAPSHOT_PATH =
	".agents/agent-skills-snapshot.json" as const;

/**
 * Visible-count threshold above which status adds a soft noise hint.
 *
 * @defaultValue 40
 */
export const AGENT_SKILLS_NOISE_THRESHOLD = 40 as const;

/**
 * Branch Station ids for initial agent-visible outcomes.
 */
export const AGENT_SKILLS_STATIONS = [
	"clean",
	"needs_sync",
	"synced",
	"unmanaged_blocker",
	"invalid_config",
	"invalid_usage",
] as const;

/**
 * Runtime outcome vocabulary shared by CLI results and Branch Stations.
 */
export type AgentSkillsStation = (typeof AGENT_SKILLS_STATIONS)[number];

/**
 * Projection health values shown by status and JSON output.
 */
export const AGENT_SKILLS_HEALTH_VALUES = [
	"clean",
	"needs_sync",
	"broken",
	"blocked",
] as const;

/**
 * Projection health union.
 */
export type AgentSkillsHealth = (typeof AGENT_SKILLS_HEALTH_VALUES)[number];

/**
 * One valid or invalid catalog entry.
 */
export interface SkillCatalogEntry {
	/** Direct child directory id used for projection and ignore matching. */
	id: string;
	/** Absolute path to the catalog entry directory. */
	path: string;
	/** Absolute local catalog symlink path when this entry is imported. */
	importLinkPath?: string;
	/** Frontmatter name when present. */
	name?: string;
	/** Frontmatter description when present. */
	description?: string;
	/** Whether this entry passes the v1 validity bar. */
	valid: boolean;
	/** Repairable invalid reason when not valid. */
	reason?: "missing_skill_file" | "invalid_frontmatter";
}

/**
 * Visible or ignored catalog entry with an inspectable reason.
 */
export interface SkillVisibility {
	/** Catalog entry id. */
	id: string;
	/** Absolute catalog entry path. */
	path: string;
	/** Frontmatter name when available. */
	name?: string;
	/** Visibility classification. */
	state: "visible" | "ignored" | "invalid";
	/** Human-readable reason for list --why. */
	reason: string;
	/** Matching ignore rule when ignored. */
	matchingIgnore?: string;
}

/**
 * Snapshot persisted after a successful sync.
 */
export interface AgentSkillsSnapshot {
	/** Projected Skill Catalog Entry ids at sync time. */
	projected_ids: readonly string[];
	/** Resolved target path by projected id. */
	targets: Record<string, string>;
	/** ISO timestamp for the last projection. */
	projected_at: string;
}

/**
 * Projection change categories computed before writes.
 */
export interface ProjectionChanges {
	/** Links that need creation or update. */
	create_or_update: readonly string[];
	/** Managed links that should be removed. */
	remove: readonly string[];
	/** Broken links that need repair. */
	broken: readonly string[];
}

/**
 * Unmanaged local projection entry that blocks writes.
 */
export interface ProjectionBlocker {
	/** Projection root containing the blocker. */
	root: string;
	/** Entry id under the projection root. */
	id: string;
	/** Absolute path to the blocker. */
	path: string;
	/** Blocker reason. */
	reason: "real_entry" | "foreign_symlink";
}

/**
 * Full projection status model shared by renderers.
 */
export interface AgentSkillsStatus {
	/** Package contract id. */
	contract_id: typeof AGENT_SKILLS_CONTRACT_ID;
	/** JSON schema version. */
	schema_version: typeof AGENT_SKILLS_SCHEMA_VERSION;
	/** Repo root used as local visibility boundary. */
	repo_root: string;
	/** Absolute catalog root. */
	catalog_root: string;
	/** Projection roots checked. */
	checked_roots: readonly string[];
	/** Count of valid non-ignored catalog skills. */
	visible_count: number;
	/** Count of ignored valid catalog skills. */
	ignored_count: number;
	/** Count of invalid catalog entries. */
	invalid_count: number;
	/** Last projected snapshot timestamp, when present. */
	last_projected_at?: string;
	/** Projection health value. */
	health: AgentSkillsHealth;
	/** Agent-visible outcome station. */
	station: AgentSkillsStation;
	/** Planned changes by category. */
	changes: ProjectionChanges;
	/** Unmanaged blockers that prevent writes. */
	blockers: readonly ProjectionBlocker[];
	/** Newly visible ids since the last snapshot. */
	newly_visible: readonly string[];
	/** Previously projected ids no longer visible. */
	removed_since_snapshot: readonly string[];
	/** One package-owned next action id. */
	next_action: "none" | "sync" | "inspect_blocker" | "fix_config";
	/** One concise next action summary. */
	next_action_summary: string;
	/** Soft warning when the visible set is likely noisy. */
	noise_hint?: string;
}
