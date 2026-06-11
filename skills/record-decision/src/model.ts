/**
 * Stable result contract identity for record-decision mutation envelopes.
 */
export const RECORD_DECISION_CONTRACT_ID = "record-decision.record" as const;

/**
 * Schema version for package-owned record-decision result data.
 */
export const RECORD_DECISION_SCHEMA_VERSION = "2" as const;

/**
 * Canonical prose sections required by the proof-slice input.
 */
export const RECORD_DECISION_REQUIRED_SECTIONS = [
	"Rationale",
	"Consequences",
	"Next",
	"V2 Ideas",
] as const;

/**
 * Required section name recognized in the proof-slice input body.
 */
export type RecordDecisionRequiredSection =
	(typeof RECORD_DECISION_REQUIRED_SECTIONS)[number];

/**
 * Source entry after proof-slice source classification.
 */
export type DecisionSource = {
	kind: "path" | "label";
	value: string;
};

/**
 * Parsed and validated proof-slice decision input.
 */
export type ParsedDecisionInput = {
	accepted: true;
	owner: string;
	decision: string;
	source: readonly DecisionSource[];
	logPath?: string;
	allowCreate: boolean;
	decisionBody?: string;
	sections: Record<RecordDecisionRequiredSection, string>;
};

/**
 * Resolved target log metadata shared by dry-run and execute paths.
 */
export type ResolvedDecisionTarget = {
	target_log: string;
	target_exists: boolean;
	log_slug: string;
	decision_number: number;
	decision_id: string;
};

/**
 * One dry-run mutation the command would perform in execute mode.
 */
export type PlannedDecisionMutation = {
	kind: "append_decision";
	target_log: string;
	decision_id: string;
	decision_number: number;
};

/**
 * One completed mutation performed by execute mode.
 */
export type CompletedDecisionMutation = {
	kind: "append_decision";
	target_log: string;
	decision_id: string;
	decision_number: number;
};

/**
 * Validation evidence attached to dry-run success data.
 */
export type ValidationSummary = {
	status: "passed";
	checked: readonly string[];
};

/**
 * Package-owned dry-run plan data carried inside the facade success envelope.
 */
export type RecordDecisionPlan = {
	action: "plan_record_decision";
	target_log: string;
	proposed_decision_id: string;
	proposed_decision_number: number;
	planned_mutations: readonly PlannedDecisionMutation[];
	validation: ValidationSummary;
	changed_state: "none";
	next_safe_action: string;
};

/**
 * Package-owned execute result data carried inside the facade success envelope.
 */
export type RecordDecisionExecuteResult = {
	action: "execute_record_decision";
	target_log: string;
	created_decision_id: string;
	created_decision_number: number;
	completed_mutations: readonly CompletedDecisionMutation[];
	validation: ValidationSummary;
	changed_state: "written";
	retry_safe: false;
	next_safe_action: string;
};

/**
 * Rendered append operation shared by dry-run and execute mode.
 */
export type PreparedDecisionRecord = {
	target: ResolvedDecisionTarget;
	rendered_entry: string;
	replacement_text: string;
	validation: ValidationSummary;
};

/**
 * User-repairable input failure surfaced before mutation planning.
 */
export class RecordDecisionInputError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly nextSafeAction: string,
	) {
		super(message);
		this.name = "RecordDecisionInputError";
	}
}
