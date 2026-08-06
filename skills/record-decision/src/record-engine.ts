import { basename } from "node:path";
import {
	type DecisionSource,
	type PreparedDecisionRecord,
	type ParsedDecisionInput,
	RECORD_DECISION_REQUIRED_SECTIONS,
	type RecordDecisionExecuteResult,
	type RecordDecisionPlan,
	type RecordDecisionRequiredSection,
	RecordDecisionInputError,
} from "./model.ts";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const DEFAULT_NEXT_SAFE_ACTION =
	"Review the dry-run plan, or rerun with --execute --json to append the decision.";
const EXECUTE_NEXT_SAFE_ACTION = "Review the updated decision log.";

type FrontmatterValue = string | boolean | string[];

type RawFrontmatter = Record<string, FrontmatterValue>;
type DecisionLogMetadata = {
	slug: string;
	nextDecisionNumber: number;
};

/**
 * Parse the proof-slice hybrid Markdown envelope into validated input.
 *
 * @param markdown - Raw decision input file contents
 * @returns Parsed input ready for mutation planning
 * @throws {RecordDecisionInputError} When required frontmatter or sections are missing
 *
 * @example
 * ```typescript
 * const input = parseDecisionInput(markdown)
 * ```
 */
export function parseDecisionInput(markdown: string): ParsedDecisionInput {
	const match = markdown.match(FRONTMATTER_PATTERN);
	if (!match) {
		throw new RecordDecisionInputError(
			"invalid_input",
			"Decision input must start with YAML frontmatter.",
			"Add frontmatter with accepted, owner, source, and decision.",
		);
	}

	const frontmatter = parseFrontmatter(match[1] ?? "");
	const body = markdown.slice(match[0].length);
	const accepted = frontmatter.accepted;
	if (accepted !== true) {
		throw new RecordDecisionInputError(
			"acceptance_required",
			"Decision input requires accepted: true before planning a record mutation.",
			"Set accepted: true only after the decision is accepted.",
		);
	}

	const owner = requireString(frontmatter, "owner");
	const decision = requireString(frontmatter, "decision");
	const source = parseSources(frontmatter.source);
	const allowCreate =
		frontmatter.allow_create === undefined
			? false
			: requireBoolean(frontmatter, "allow_create");
	const logPath =
		frontmatter.log_path === undefined
			? undefined
			: requireString(frontmatter, "log_path");
	const sections = parseSections(body);
	const decisionBody = parseOptionalSection(body, "Decision");

	return {
		accepted,
		owner,
		decision,
		source,
		...(logPath ? { logPath } : {}),
		allowCreate,
		...(decisionBody ? { decisionBody } : {}),
		sections,
	};
}

/**
 * Resolve the target log path for a parsed input.
 *
 * @param input - Parsed and validated decision input
 * @param decidedAt - Date used when deriving a new log path
 * @returns Repo-relative target decision-log path
 * @throws {RecordDecisionInputError} When the target path is outside repo scope
 *
 * @example
 * ```typescript
 * const targetLog = resolveDecisionTargetLog(input, "2026-06-11")
 * ```
 */
export function resolveDecisionTargetLog(
	input: ParsedDecisionInput,
	decidedAt = new Date().toISOString().slice(0, 10),
): string {
	const targetLog =
		input.logPath ??
		`docs/decisions/${decidedAt}-001-${slugify(input.owner)}-decision-log.md`;
	if (!isSafeRepoRelativePath(targetLog)) {
		throw new RecordDecisionInputError(
			"invalid_input",
			"Target decision log must be a repo-relative path.",
			"Set log_path to a repo-relative docs/decisions path.",
		);
	}
	return targetLog;
}

/**
 * Resolve rendered append data shared by dry-run and execute mode.
 *
 * @param input - Parsed and validated decision input
 * @param options - Existing target log and decision date used for deterministic output
 * @returns Rendered append operation for planning or execution
 * @throws {RecordDecisionInputError} When the target log is missing or incompatible
 *
 * @example
 * ```typescript
 * const prepared = prepareDecisionRecord(input, { existingLogText })
 * ```
 */
export function prepareDecisionRecord(
	input: ParsedDecisionInput,
	options: { existingLogText?: string; decidedAt?: string } = {},
): PreparedDecisionRecord {
	const decidedAt = options.decidedAt ?? new Date().toISOString().slice(0, 10);
	const targetLog = resolveDecisionTargetLog(input, decidedAt);
	if (options.existingLogText === undefined) {
		throw new RecordDecisionInputError(
			input.allowCreate ? "log_create_deferred" : "target_log_unavailable",
			input.allowCreate
				? "Creating new decision logs is not implemented yet."
				: "Target decision log does not exist and allow_create is false.",
			input.allowCreate
				? "Create the decision log manually, then rerun execute mode."
				: "Set log_path to an existing decision log or make an explicit create-log decision.",
		);
	}

	const metadata = parseDecisionLogMetadata(options.existingLogText, targetLog);
	const decisionNumber = metadata.nextDecisionNumber;
	const decisionId = `${metadata.slug}-${String(decisionNumber).padStart(3, "0")}`;
	const renderedEntry = renderDecisionEntry(input, {
		decidedAt,
		decisionId,
		decisionNumber,
	});
	const replacementText = appendDecisionEntry(options.existingLogText, renderedEntry);
	validateReplacement(replacementText, {
		targetLog,
		decisionId,
		decisionNumber,
	});
	return {
		target: {
			target_log: targetLog,
			target_exists: true,
			log_slug: metadata.slug,
			decision_number: decisionNumber,
			decision_id: decisionId,
		},
		rendered_entry: renderedEntry,
		replacement_text: replacementText,
		validation: validationSummary(),
	};
}

/**
 * Build a no-write mutation plan from a prepared append operation.
 *
 * @param prepared - Shared append operation produced before dry-run or execute
 * @returns Dry-run mutation plan for the target decision log
 *
 * @example
 * ```typescript
 * const plan = planDecisionRecord(prepared)
 * ```
 */
export function planDecisionRecord(
	prepared: PreparedDecisionRecord,
): RecordDecisionPlan {
	return {
		action: "plan_record_decision",
		target_log: prepared.target.target_log,
		proposed_decision_id: prepared.target.decision_id,
		proposed_decision_number: prepared.target.decision_number,
		planned_mutations: [
			{
				kind: "append_decision",
				target_log: prepared.target.target_log,
				decision_id: prepared.target.decision_id,
				decision_number: prepared.target.decision_number,
			},
		],
		validation: prepared.validation,
		changed_state: "none",
		next_safe_action: DEFAULT_NEXT_SAFE_ACTION,
	};
}

/**
 * Build execute success data from the same prepared append operation as dry-run.
 *
 * @param prepared - Shared append operation that was written to disk
 * @returns Completed mutation result for the facade success envelope
 *
 * @example
 * ```typescript
 * const result = executeDecisionRecord(prepared)
 * ```
 */
export function executeDecisionRecord(
	prepared: PreparedDecisionRecord,
): RecordDecisionExecuteResult {
	return {
		action: "execute_record_decision",
		target_log: prepared.target.target_log,
		created_decision_id: prepared.target.decision_id,
		created_decision_number: prepared.target.decision_number,
		completed_mutations: [
			{
				kind: "append_decision",
				target_log: prepared.target.target_log,
				decision_id: prepared.target.decision_id,
				decision_number: prepared.target.decision_number,
			},
		],
		validation: prepared.validation,
		changed_state: "written",
		retry_safe: false,
		next_safe_action: EXECUTE_NEXT_SAFE_ACTION,
	};
}

function parseFrontmatter(text: string): RawFrontmatter {
	const result: RawFrontmatter = {};
	const lines = text.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
		const match = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
		if (!match) {
			throw invalidInput(`Unsupported frontmatter line: ${line}`);
		}
		const key = match[1] ?? "";
		const rawValue = match[2] ?? "";
		if (rawValue === "") {
			const values: string[] = [];
			while (lines[index + 1]?.match(/^\s+-\s+/)) {
				index += 1;
				values.push(unquote(lines[index].replace(/^\s+-\s+/, "").trim()));
			}
			result[key] = values;
			continue;
		}
		result[key] = parseScalar(rawValue.trim());
	}
	return result;
}

function parseScalar(value: string): FrontmatterValue {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value.startsWith("[") && value.endsWith("]")) {
		const inner = value.slice(1, -1).trim();
		if (inner === "") return [];
		return inner.split(",").map((item) => unquote(item.trim()));
	}
	return unquote(value);
}

function unquote(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function requireString(frontmatter: RawFrontmatter, key: string): string {
	const value = frontmatter[key];
	if (typeof value !== "string" || value.trim() === "") {
		throw invalidInput(`Frontmatter requires ${key}.`);
	}
	return value;
}

function requireBoolean(frontmatter: RawFrontmatter, key: string): boolean {
	const value = frontmatter[key];
	if (typeof value !== "boolean") {
		throw invalidInput(`Frontmatter ${key} must be true or false.`);
	}
	return value;
}

function parseSources(value: FrontmatterValue | undefined): DecisionSource[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw invalidInput("Frontmatter requires source with at least one entry.");
	}
	return value.map((source) => ({
		kind: isRepoRelativePath(source) ? "path" : "label",
		value: source,
	}));
}

function isRepoRelativePath(value: string): boolean {
	return (
		!value.startsWith("/") &&
		!value.includes("://") &&
		(value.includes("/") || /\.[A-Za-z0-9]+$/.test(basename(value)))
	);
}

function isSafeRepoRelativePath(value: string): boolean {
	return (
		!value.startsWith("/") &&
		!value.includes("://") &&
		!value.split(/[\\/]+/).includes("..")
	);
}

function parseSections(
	body: string,
): Record<RecordDecisionRequiredSection, string> {
	const sections = {} as Record<RecordDecisionRequiredSection, string>;
	for (const section of RECORD_DECISION_REQUIRED_SECTIONS) {
		const content = parseOptionalSection(body, section);
		if (!content) {
			throw invalidInput(`Decision input requires ## ${section}.`);
		}
		sections[section] = content;
	}
	return sections;
}

function parseOptionalSection(body: string, heading: string): string | undefined {
	const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m");
	const match = body.match(headingPattern);
	if (!match || match.index === undefined) return undefined;
	const contentStart = match.index + match[0].length;
	const rest = body.slice(contentStart);
	const nextHeading = rest.search(/^##\s+/m);
	const content = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
	return content ? content : undefined;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "decision"
	);
}

function parseDecisionLogMetadata(
	text: string,
	targetLog: string,
): DecisionLogMetadata {
	const match = text.match(FRONTMATTER_PATTERN);
	if (!match) {
		throw new RecordDecisionInputError(
			"target_log_invalid",
			`Target decision log is missing frontmatter: ${targetLog}.`,
			"Repair the decision log shape before recording a new decision.",
		);
	}
	const frontmatter = parseFrontmatter(match[1] ?? "");
	const slug = frontmatter.slug;
	if (typeof slug !== "string" || slug.trim() === "") {
		throw new RecordDecisionInputError(
			"target_log_invalid",
			`Target decision log is missing slug: ${targetLog}.`,
			"Repair the decision log frontmatter before recording a new decision.",
		);
	}
	const decisionNumbers = [...text.matchAll(/^## Decision\s+(\d+):/gm)]
		.map((candidate) => Number(candidate[1]))
		.filter(Number.isFinite);
	const highestDecisionNumber =
		decisionNumbers.length === 0 ? 0 : Math.max(...decisionNumbers);
	return {
		slug,
		nextDecisionNumber: highestDecisionNumber + 1,
	};
}

function renderDecisionEntry(
	input: ParsedDecisionInput,
	options: {
		decidedAt: string;
		decisionId: string;
		decisionNumber: number;
	},
): string {
	return [
		`## Decision ${options.decisionNumber}: ${renderDecisionTitle(input.decision)}`,
		"",
		"```yaml",
		`id: ${options.decisionId}`,
		"status: accepted",
		`decided_at: ${yamlString(options.decidedAt)}`,
		`decision: ${yamlString(input.decision)}`,
		`owner: ${yamlString(input.owner)}`,
		"source:",
		...input.source.map((source) => `  - ${yamlString(source.value)}`),
		"```",
		"",
		"Decision:",
		"",
		normalizeSection(input.decisionBody ?? `- ${input.decision}`),
		"",
		"Rationale:",
		"",
		normalizeSection(input.sections.Rationale),
		"",
		"Consequences:",
		"",
		normalizeSection(input.sections.Consequences),
		"",
		"Next:",
		"",
		normalizeSection(input.sections.Next),
		"",
		"V2 Ideas:",
		"",
		normalizeSection(input.sections["V2 Ideas"]),
	].join("\n");
}

function appendDecisionEntry(existingText: string, renderedEntry: string): string {
	return `${existingText.trimEnd()}\n\n${renderedEntry.trimEnd()}\n`;
}

function validateReplacement(
	replacementText: string,
	input: {
		targetLog: string;
		decisionId: string;
		decisionNumber: number;
	},
): void {
	if (!replacementText.includes(`id: ${input.decisionId}`)) {
		throw new RecordDecisionInputError(
			"target_log_invalid",
			`Rendered decision entry is missing id ${input.decisionId}.`,
			"Repair the input renderer before retrying execute mode.",
		);
	}
	if (!replacementText.includes(`## Decision ${input.decisionNumber}:`)) {
		throw new RecordDecisionInputError(
			"target_log_invalid",
			`Rendered decision entry is missing heading for ${input.targetLog}.`,
			"Repair the input renderer before retrying execute mode.",
		);
	}
	parseDecisionLogMetadata(replacementText, input.targetLog);
}

function validationSummary() {
	return {
		status: "passed",
		checked: [
			"accepted",
			"owner",
			"source",
			"decision",
			"required_sections",
			"allow_create",
			"target_log",
			"decision_id",
			"replacement_content",
		],
	} as const;
}

function renderDecisionTitle(decision: string): string {
	const title = decision.replace(/[`*_#]/g, "").replace(/\s+/g, " ").trim();
	if (title.length <= 80) return title;
	return `${title.slice(0, 77).trimEnd()}...`;
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function normalizeSection(value: string): string {
	return value.trim();
}

function invalidInput(message: string): RecordDecisionInputError {
	return new RecordDecisionInputError(
		"invalid_input",
		message,
		"Fix the decision input and rerun dry-run planning.",
	);
}
