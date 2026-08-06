/**
 * Clean-break migration phases visible through every migration command.
 */
export type BrowserUseMigrationPhase =
	| "empty"
	| "inventoried"
	| "planned"
	| "staged"
	| "verified";

/**
 * Artifact class for one source entry (R2/R3). Formal artifacts are the only
 * entries a later unit may execute; every other class is supporting knowledge
 * that is classified but never promoted merely because it was found (KTD3).
 *
 * - `formal-runbook` / `formal-playbook`: explicit runbook/playbook artifacts.
 * - `script`: unreviewed executable code (never trusted; R3 script tally).
 * - `domain-script-action`: a script that also carries a registry action id
 *   (R3 "10 domain-script actions that are also scripts"). It is both a
 *   `script` (by extension) and an action (by registry membership), so it is
 *   counted in both overlapping predicates.
 * - `auth-narrative`: a login/okta walkthrough routed to auth ownership (R29),
 *   never a business runbook.
 * - `login-capability`: a candidate login capability descriptor.
 * - `domain-prose` / `run-evidence` / `selector-asset` / `supporting`: notes,
 *   observed proof, selectors, and other non-executable knowledge.
 */
export const BROWSER_USE_ARTIFACT_CLASSES = [
	"formal-runbook",
	"formal-playbook",
	"script",
	"domain-script-action",
	"auth-narrative",
	"login-capability",
	"domain-prose",
	"run-evidence",
	"selector-asset",
	"supporting",
] as const;

export type BrowserUseArtifactClass =
	(typeof BROWSER_USE_ARTIFACT_CLASSES)[number];

/**
 * Overlapping mechanical census of the frozen corpus (R3). Each field is an
 * independent predicate count; a domain-script action is counted in both
 * `scripts` and `domain_script_actions`, so the sums intentionally overlap.
 * Count drift against a recorded baseline blocks planning until the new
 * entries receive dispositions (R3).
 */
export type BrowserUseCorpusCensus = {
	/** Formal runbook + playbook artifacts (R3: 12). */
	formal_artifacts: number;
	/** Logical Target Flows declared in domain prose + formal artifacts (R3: 52). */
	target_flows: number;
	/** Executable script files (R3: 24). */
	scripts: number;
	/** Verified auth narratives routed to auth ownership (R3: 3). */
	auth_narratives: number;
	/** Candidate login capabilities (R3: 2). */
	login_capabilities: number;
	/** Domain-script actions that are also scripts (R3: 10). */
	domain_script_actions: number;
};

/**
 * One canonical flow and the complete set of source entries that provide its
 * lineage (R4). A canonical target may absorb or supersede multiple sources —
 * the two Oncore fill-timesheet candidates resolve to ONE canonical id — while
 * every source keeps its own disposition and one provenance edge back here.
 */
export type BrowserUseCanonicalTarget = {
	/** Stable canonical flow id, e.g. `oncore/fill-timesheet`. */
	canonical_target_id: string;
	/** Every source relative path that feeds this canonical flow (>= 1). */
	source_relative_paths: readonly string[];
};

/**
 * Durable status shared by inventory, plan, apply, verify, and status.
 *
 * Absolute source paths stay out of durable state. `source_root_identity` is a
 * digest used to reject a different source root on a later phase.
 *
 * schema_version 2 (U1) adds mechanical corpus census + canonical-target
 * provenance edges; schema_version 1 state is not read back (clean break).
 */
export type BrowserUseMigrationState = {
	contract: "browser-use.migration-status";
	schema_version: "2";
	phase: BrowserUseMigrationPhase;
	snapshot_id: string | null;
	snapshot_digest: string | null;
	source_root_identity: string | null;
	source_entry_count: number;
	disposition_count: number;
	dispositions: readonly BrowserUseMigrationDisposition[];
	/** Overlapping mechanical census; null until planning classifies entries. */
	corpus_census: BrowserUseCorpusCensus | null;
	/** Canonical flow provenance edges (R4); empty until planning. */
	canonical_targets: readonly BrowserUseCanonicalTarget[];
	staged_generation: string | null;
	last_apply_verified_noop: boolean | null;
	activation_state: "unchanged";
};

/**
 * One source-entry decision with complete transform and destination provenance.
 *
 * `artifact_class`, `formal_flow_id`, and `canonical_target_id` (U1) make the
 * scope and provenance of each entry mechanically inspectable (R2-R4).
 */
export type BrowserUseMigrationDisposition = {
	source_relative_path: string;
	source_content_hash: string;
	/** Classified artifact class for this entry (R2/R3). */
	artifact_class: BrowserUseArtifactClass;
	/** Declared formal-flow identity, when the entry is a formal artifact (R4). */
	formal_flow_id: string | null;
	/** Canonical flow this entry feeds, when it has one (R4). */
	canonical_target_id: string | null;
	disposition:
		| "stage"
		| "quarantine-backup"
		| "quarantine-secret"
		| "quarantine-executable"
		| "quarantine-obsolete"
		| "quarantine-unsupported";
	reason: string;
	transform_version: string;
	logical_destination_id: string | null;
	expected_hash: string | null;
};

/**
 * Typed migration engine refusal.
 */
export type BrowserUseMigrationFailure = {
	ok: false;
	code:
		| "migration_source_invalid"
		| "migration_source_drift"
		| "migration_state_missing"
		| "migration_state_corrupt"
		| "migration_yaml_invalid"
		| "migration_yaml_duplicate_key"
		| "migration_disposition_incomplete"
		| "migration_count_drift"
		| "migration_collision"
		| "migration_verify_failed"
		| "store_flush_failed"
		| "store_lock_contended"
		| "retention_collision";
	message: string;
};
