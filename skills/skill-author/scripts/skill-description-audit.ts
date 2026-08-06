#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync, type Stats } from "node:fs";
import path from "node:path";

type Severity = "error" | "warning";

type Diagnostic = {
	severity: Severity;
	code: string;
	message: string;
	skill?: string;
	path?: string;
};

type SkillDescription = {
	name: string;
	description: string;
	path: string;
	descriptionStyle: "quoted" | "block" | "unquoted" | "missing";
	tokens: Set<string>;
};

type Collision = {
	severity: Severity;
	code: "description_collision";
	left: string;
	right: string;
	score: number;
	sharedTerms: string[];
	message: string;
};

type AuditResult = {
	status: "ok" | "warning" | "error";
	root: string;
	skillCount: number;
	diagnostics: Diagnostic[];
	collisions: Collision[];
};

type Options = {
	root: string;
	json: boolean;
	strict: boolean;
	checkStyle: boolean;
	threshold: number;
};

const STOP_WORDS = new Set([
	"a",
	"about",
	"across",
	"add",
	"agent",
	"agents",
	"all",
	"also",
	"an",
	"and",
	"any",
	"are",
	"as",
	"ask",
	"at",
	"be",
	"before",
	"by",
	"can",
	"code",
	"do",
	"docs",
	"for",
	"from",
	"has",
	"have",
	"help",
	"each",
	"if",
	"in",
	"into",
	"is",
	"it",
	"local",
	"make",
	"new",
	"not",
	"of",
	"on",
	"one",
	"or",
	"output",
	"per",
	"read",
	"repo",
	"run",
	"script",
	"scripts",
	"skill",
	"skills",
	"the",
	"their",
	"this",
	"thi",
	"that",
	"to",
	"tool",
	"tools",
	"trigger",
	"use",
	"user",
	"using",
	"want",
	"when",
	"which",
	"with",
	"workflow",
	"workflows",
	"you",
]);

function printHelp(): void {
	console.log(`Usage: skill-description-audit.ts [--root <dir>] [--json] [--strict] [--check-style] [--threshold <0-1>]

Audits skills/*/SKILL.md descriptions for parse errors and likely routing crossover.

Options:
  --root <dir>       Repo root. Defaults to current working directory.
  --json             Emit JSON.
  --strict           Exit non-zero on warnings as well as errors.
  --check-style      Warn when descriptions are not quoted YAML scalars.
  --threshold <0-1>  Collision score threshold. Default: 0.34.
  -h, --help         Show help.`);
}

function parseArgs(argv: string[]): Options {
	const options: Options = {
		root: process.cwd(),
		json: false,
		strict: false,
		checkStyle: false,
		threshold: 0.34,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--strict") {
			options.strict = true;
			continue;
		}
		if (arg === "--check-style") {
			options.checkStyle = true;
			continue;
		}
		if (arg === "--root") {
			const value = argv[index + 1];
			if (!value) throw new Error("--root requires a value");
			options.root = path.resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--threshold") {
			const value = argv[index + 1];
			if (!value) throw new Error("--threshold requires a value");
			const parsed = Number.parseFloat(value);
			if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
				throw new Error("--threshold must be between 0 and 1");
			}
			options.threshold = parsed;
			index += 1;
			continue;
		}
		if (arg === "-h" || arg === "--help") {
			printHelp();
			process.exit(0);
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
}

function listSkillFiles(root: string): { files: string[]; diagnostics: Diagnostic[] } {
	const skillsDir = path.join(root, "skills");
	const entries = readdirSync(skillsDir).sort();
	const files: string[] = [];
	const diagnostics: Diagnostic[] = [];
	for (const entry of entries) {
		if (entry === "archive") continue;
		const skillPath = path.join(skillsDir, entry);
		let skillStat: Stats;
		try {
			skillStat = statSync(skillPath);
		} catch {
			diagnostics.push({
				severity: "warning",
				code: "skill_path_unreadable",
				path: path.relative(root, skillPath),
				message: "cannot stat skill path; skipping",
			});
			continue;
		}
		if (!skillStat.isDirectory()) continue;
		const file = path.join(skillPath, "SKILL.md");
		try {
			if (statSync(file).isFile()) files.push(file);
		} catch {
			// Skill folders without SKILL.md are ignored by this audit.
		}
	}
	return { files, diagnostics };
}

function extractFrontmatter(text: string): string | undefined {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
	return match?.[1]?.replace(/\r\n/g, "\n");
}

function unquoteYamlScalar(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
	}
	return trimmed;
}

function readScalar(frontmatter: string, key: string): string | undefined {
	const lines = frontmatter.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
		if (!match) continue;
		const raw = match[1] ?? "";
		if (raw === ">" || raw === "|") {
			const block: string[] = [];
			for (let next = index + 1; next < lines.length; next += 1) {
				const child = lines[next];
				if (!child.startsWith(" ") && !child.startsWith("\t")) break;
				block.push(child.trim());
			}
			return block.join(" ").replace(/\s+/g, " ").trim();
		}
		return unquoteYamlScalar(raw);
	}
	return undefined;
}

function descriptionStyle(frontmatter: string): SkillDescription["descriptionStyle"] {
	const line = frontmatter
		.split("\n")
		.find((candidate) => candidate.startsWith("description:"));
	if (!line) return "missing";
	const raw = line.replace(/^description:\s*/, "");
	if (raw === ">" || raw === "|") return "block";
	if (raw.trim().startsWith('"') || raw.trim().startsWith("'")) return "quoted";
	return "unquoted";
}

function normalizeToken(token: string): string {
	return token
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "")
		.replace(/s$/, "");
}

function descriptionTokens(name: string, description: string): Set<string> {
	const rawTokens = `${name} ${description}`
		.toLowerCase()
		.split(/[^a-z0-9-]+/)
		.map(normalizeToken)
		.filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
	return new Set(rawTokens);
}

function loadSkill(file: string, root: string, checkStyle: boolean): {
	skill?: SkillDescription;
	diagnostics: Diagnostic[];
} {
	const relPath = path.relative(root, file);
	const text = readFileSync(file, "utf8");
	const frontmatter = extractFrontmatter(text);
	const diagnostics: Diagnostic[] = [];
	if (!frontmatter) {
		return {
			diagnostics: [
				{
					severity: "error",
					code: "frontmatter_missing",
					path: relPath,
					message: "missing YAML frontmatter",
				},
			],
		};
	}

	const name = readScalar(frontmatter, "name") ?? path.basename(path.dirname(file));
	const description = readScalar(frontmatter, "description");
	const style = descriptionStyle(frontmatter);
	if (!description) {
		diagnostics.push({
			severity: "error",
			code: "description_missing",
			skill: name,
			path: relPath,
			message: "missing description",
		});
	} else {
		if (description.length > 1024) {
			diagnostics.push({
				severity: "error",
				code: "description_too_long",
				skill: name,
				path: relPath,
				message: `description is ${description.length} chars; limit is 1024`,
			});
		}
		if (checkStyle && style !== "quoted") {
			diagnostics.push({
				severity: "warning",
				code: "description_not_quoted",
				skill: name,
				path: relPath,
				message: `description style is ${style}; quote YAML descriptions`,
			});
		}
	}

	return {
		skill: {
			name,
			description: description ?? "",
			path: relPath,
			descriptionStyle: style,
			tokens: descriptionTokens(name, description ?? ""),
		},
		diagnostics,
	};
}

function collisionScore(left: Set<string>, right: Set<string>): {
	score: number;
	sharedTerms: string[];
} {
	const sharedTerms = [...left].filter((token) => right.has(token)).sort();
	const smaller = Math.min(left.size, right.size);
	if (smaller === 0) return { score: 0, sharedTerms };
	return { score: sharedTerms.length / smaller, sharedTerms };
}

function findCollisions(
	skills: SkillDescription[],
	threshold: number,
): Collision[] {
	const collisions: Collision[] = [];
	for (let leftIndex = 0; leftIndex < skills.length; leftIndex += 1) {
		for (
			let rightIndex = leftIndex + 1;
			rightIndex < skills.length;
			rightIndex += 1
		) {
			const left = skills[leftIndex];
			const right = skills[rightIndex];
			const { score, sharedTerms } = collisionScore(left.tokens, right.tokens);
			if (score < threshold || sharedTerms.length < 4) continue;
			collisions.push({
				severity: "warning",
				code: "description_collision",
				left: left.path,
				right: right.path,
				score: Number(score.toFixed(3)),
				sharedTerms: sharedTerms.slice(0, 12),
				message: `${left.name} and ${right.name} share routing terms: ${sharedTerms.slice(0, 8).join(", ")}`,
			});
		}
	}
	return collisions.sort((left, right) => right.score - left.score);
}

function audit(options: Options): AuditResult {
	const diagnostics: Diagnostic[] = [];
	const skills: SkillDescription[] = [];
	const listed = listSkillFiles(options.root);
	diagnostics.push(...listed.diagnostics);
	for (const file of listed.files) {
		const loaded = loadSkill(file, options.root, options.checkStyle);
		diagnostics.push(...loaded.diagnostics);
		if (loaded.skill) skills.push(loaded.skill);
	}
	const collisions = findCollisions(skills, options.threshold);
	const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
	const hasWarnings =
		diagnostics.some((diagnostic) => diagnostic.severity === "warning") ||
		collisions.length > 0;
	return {
		status: hasErrors ? "error" : hasWarnings ? "warning" : "ok",
		root: options.root,
		skillCount: skills.length,
		diagnostics,
		collisions,
	};
}

function printPlain(result: AuditResult): void {
	console.log(`Skill description audit: ${result.status}`);
	console.log(`Skills: ${result.skillCount}`);
	if (result.diagnostics.length > 0) {
		console.log("\nDiagnostics:");
		for (const item of result.diagnostics) {
			console.log(
				`- ${item.severity.toUpperCase()} ${item.code} ${item.path}: ${item.message}`,
			);
		}
	}
	if (result.collisions.length > 0) {
		console.log("\nLikely routing crossovers:");
		for (const item of result.collisions) {
			console.log(
				`- ${item.left} <-> ${item.right} (${item.score}): ${item.sharedTerms.join(", ")}`,
			);
		}
	}
	if (result.diagnostics.length === 0 && result.collisions.length === 0) {
		console.log("No description issues found.");
	}
}

function main(): void {
	try {
		const options = parseArgs(Bun.argv.slice(2));
		const result = audit(options);
		if (options.json) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			printPlain(result);
		}
		const hasErrors = result.status === "error";
		const hasStrictWarnings = options.strict && result.status === "warning";
		if (hasErrors || hasStrictWarnings) {
			process.exitCode = 1;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`skill-description-audit: ${message}`);
		process.exitCode = 2;
	}
}

main();
