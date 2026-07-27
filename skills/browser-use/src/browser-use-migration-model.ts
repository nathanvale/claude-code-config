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
 * Durable status shared by inventory, plan, apply, verify, and status.
 *
 * Absolute source paths stay out of durable state. `source_root_identity` is a
 * digest used to reject a different source root on a later phase.
 */
export type BrowserUseMigrationState = {
	contract: "browser-use.migration-status";
	schema_version: "1";
	phase: BrowserUseMigrationPhase;
	snapshot_id: string | null;
	snapshot_digest: string | null;
	source_root_identity: string | null;
	source_entry_count: number;
	disposition_count: number;
	dispositions: readonly BrowserUseMigrationDisposition[];
	staged_generation: string | null;
	last_apply_verified_noop: boolean | null;
	activation_state: "unchanged";
};

/**
 * One source-entry decision with complete transform and destination provenance.
 */
export type BrowserUseMigrationDisposition = {
	source_relative_path: string;
	source_content_hash: string;
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
		| "migration_collision"
		| "migration_verify_failed"
		| "store_flush_failed"
		| "store_lock_contended"
		| "retention_collision";
	message: string;
};
