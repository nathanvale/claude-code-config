/**
 * Package-owned Storybook docs-loop result vocabulary.
 *
 * Contract ids, schema versions, command names, ledger fields, and status
 * literals live here so the CLI, help, discovery, and tests share one source.
 */

/** Schema version shared by docs-loop result contracts. */
export const DOCS_LOOP_SCHEMA_VERSION = "1";

/** Result contract for component run-card output. */
export const DOCS_LOOP_RUN_CARD_CONTRACT_ID = "storybook-docs-loop.run-card";

/** Result contract for run status output. */
export const DOCS_LOOP_STATUS_CONTRACT_ID = "storybook-docs-loop.status";

/** Result contract for verification receipt output. */
export const DOCS_LOOP_MARK_CONTRACT_ID = "storybook-docs-loop.mark";

/** Result contract for loop diagnostic output. */
export const DOCS_LOOP_DOCTOR_CONTRACT_ID = "storybook-docs-loop.doctor";

/** Result contract for purge preview or deletion output. */
export const DOCS_LOOP_PURGE_CONTRACT_ID = "storybook-docs-loop.purge";

/** Result contract for command discovery output. */
export const DOCS_LOOP_COMMANDS_CONTRACT_ID = "storybook-docs-loop.commands";

/** Commands exposed by the docs-loop front door. */
export const DOCS_LOOP_COMMANDS = [
	"single",
	"batch",
	"resume",
	"status",
	"advance",
	"mark",
	"doctor",
	"purge",
	"commands",
] as const;

/** Command names exposed by the docs-loop front door. */
export type StorybookDocsLoopCommand = (typeof DOCS_LOOP_COMMANDS)[number];

/** Item states used by durable docs-loop runs. */
export const DOCS_LOOP_ITEM_STATUSES = [
	"queued",
	"editing",
	"verified",
	"degraded",
	"blocked",
	"skipped",
] as const;

/** Item state derived from verification receipts. */
export type DocsLoopItemStatus = (typeof DOCS_LOOP_ITEM_STATUSES)[number];

/** Per-field verification receipt statuses. */
export const DOCS_LOOP_RECEIPT_STATUSES = ["done", "na", "blocked"] as const;

/** Verification receipt status accepted by the mark command. */
export type DocsLoopReceiptStatus = (typeof DOCS_LOOP_RECEIPT_STATUSES)[number];

/** Verification fields tracked for each docs-loop item. */
export const DOCS_LOOP_VERIFICATION_FIELDS = [
	"default_primary",
	"matrix",
	"ux_tips",
	"focused_stories",
	"optional_docs_inclusion",
	"preview",
	"a11y_story_tests",
	"screenshot",
	"registry",
	"fallow",
	"blocker_or_degraded_reason",
] as const;

/** Verification field names accepted by the mark command. */
export type DocsLoopVerificationField =
	(typeof DOCS_LOOP_VERIFICATION_FIELDS)[number];

/** Required verification fields from the docs workflow checklist. */
export const DOCS_LOOP_REQUIRED_FIELDS = [
	"default_primary",
	"matrix",
	"ux_tips",
	"preview",
	"a11y_story_tests",
	"screenshot",
	"registry",
	"fallow",
] as const satisfies readonly DocsLoopVerificationField[];

/** Optional verification fields from the docs workflow checklist. */
export const DOCS_LOOP_OPTIONAL_FIELDS = [
	"focused_stories",
	"optional_docs_inclusion",
	"blocker_or_degraded_reason",
] as const satisfies readonly DocsLoopVerificationField[];

/** Side-effect stance rendered in docs-loop success and error payloads. */
export type DocsLoopSideEffectStance =
	| "read_only"
	| "loop_state_write"
	| "cache_destroy";

/** Minimal run status payload. */
export interface DocsLoopStatusPayload {
	/** Correlates this output with the durable run, when one exists. */
	run: string | null;
	/** Whether this output changed durable docs-loop state. */
	changed_state: "none";
	/** Same-input retry safety for the command result. */
	retry_safe: boolean;
	/** Declared side-effect stance for the command result. */
	side_effect_stance: "read_only";
	/** Current continuation for the next agent. */
	next_safe_action: string;
}

/** Minimal receipt payload for mark command responses. */
export interface DocsLoopMarkPayload {
	/** Correlates this output with the durable run, when one exists. */
	run: string | null;
	/** Verification field that was requested. */
	field: DocsLoopVerificationField | null;
	/** Receipt status that was requested. */
	status: DocsLoopReceiptStatus | null;
	/** Whether this output changed durable docs-loop state. */
	changed_state: "loop_state";
	/** Same-input retry safety for the command result. */
	retry_safe: boolean;
	/** Declared side-effect stance for the command result. */
	side_effect_stance: "loop_state_write";
	/** Current continuation for the next agent. */
	next_safe_action: string;
}

/** Minimal diagnostic payload for doctor command responses. */
export interface DocsLoopDoctorPayload {
	/** Correlates this output with the durable run, when one exists. */
	run: string | null;
	/** Diagnostic status for loop state. */
	status: "ok" | "repairable";
	/** Whether this output changed durable docs-loop state. */
	changed_state: "none";
	/** Same-input retry safety for the command result. */
	retry_safe: boolean;
	/** Declared side-effect stance for the command result. */
	side_effect_stance: "read_only";
	/** Current continuation for the next agent. */
	next_safe_action: string;
}

/** Minimal purge payload for preview and forced deletion responses. */
export interface DocsLoopPurgePayload {
	/** Correlates this output with the durable run, when one exists. */
	run: string | null;
	/** Whether the command deleted state or cache. */
	deleted: boolean;
	/** Whether this output changed durable docs-loop state. */
	changed_state: "none" | "loop_state";
	/** Same-input retry safety for the command result. */
	retry_safe: boolean;
	/** Declared side-effect stance for the command result. */
	side_effect_stance: "read_only" | "cache_destroy";
	/** Current continuation for the next agent. */
	next_safe_action: string;
}

/** Error payload attached to docs-loop runtime envelopes. */
export interface DocsLoopErrorPayload {
	/** Whether a failed command changed durable state. */
	changed_state: "none";
	/** Same-input retry safety for the failed command. */
	retry_safe: boolean;
	/** Declared side-effect stance for the failed command. */
	side_effect_stance: DocsLoopSideEffectStance;
	/** Current continuation for the next agent. */
	next_safe_action: string;
}
