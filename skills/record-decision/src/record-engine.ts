import { basename } from "node:path";
import {
	type DecisionSource,
	type ParsedDecisionInput,
	RECORD_DECISION_REQUIRED_SECTIONS,
	type RecordDecisionPlan,
	type RecordDecisionRequiredSection,
	RecordDecisionInputError,
} from "./model.ts";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const DEFAULT_NEXT_SAFE_ACTION =
	"Review the dry-run plan; execute writes are deferred in this proof slice.";

type FrontmatterValue = string | boolean | string[];

type RawFrontmatter = Record<string, FrontmatterValue>;

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
 * Build a no-write mutation plan from validated decision input.
 *
 * @param input - Parsed and validated decision input
 * @returns Dry-run mutation plan for the target decision log
 *
 * @example
 * ```typescript
 * const plan = planDecisionRecord(input)
 * ```
 */
export function planDecisionRecord(input: ParsedDecisionInput): RecordDecisionPlan {
	const targetLog =
		input.logPath ??
		`docs/decisions/${new Date().toISOString().slice(0, 10)}-001-${slugify(
			input.owner,
		)}-decision-log.md`;
	const proposedDecisionId = `${slugify(input.owner)}-next`;
	return {
		action: "plan_record_decision",
		target_log: targetLog,
		proposed_decision_id: proposedDecisionId,
		planned_mutations: [
			{
				kind: "append_decision",
				target_log: targetLog,
				proposed_decision_id: proposedDecisionId,
			},
		],
		validation: {
			status: "passed",
			checked: [
				"accepted",
				"owner",
				"source",
				"decision",
				"required_sections",
				"allow_create",
			],
		},
		changed_state: "none",
		next_safe_action: DEFAULT_NEXT_SAFE_ACTION,
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

function invalidInput(message: string): RecordDecisionInputError {
	return new RecordDecisionInputError("invalid_input", message, "Fix the decision input and rerun dry-run planning.");
}
