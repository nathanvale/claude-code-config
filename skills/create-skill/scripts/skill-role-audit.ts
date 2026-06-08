#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync, type Stats } from "node:fs";
import path from "node:path";

type Severity = "error";

type Diagnostic = {
	severity: Severity;
	code: string;
	message: string;
	skill?: string;
	path?: string;
	role?: string;
	ability?: string;
};

type AuditResult = {
	status: "ok" | "error";
	root: string;
	skillCount: number;
	allowedRoles: string[];
	allowedAbilities: string[];
	diagnostics: Diagnostic[];
};

type Options = {
	root: string;
	json: boolean;
};

const ALLOWED_ROLES = [
	"main-entry",
	"advisor",
	"tool-workflow",
	"support-reference",
	"control-plane",
	"quality-gate",
	"bridge",
];

const ALLOWED_ABILITIES = [
	"accepted-doc-capture",
	"temp-report-generation",
];

function printHelp(): void {
	console.log(`Usage: skill-role-audit.ts [--root <dir>] [--json]

Audits active skills/*/SKILL.md frontmatter for required role labels and optional ability labels.

Options:
  --root <dir>  Repo root. Defaults to current working directory.
  --json        Emit JSON.
  -h, --help    Show help.`);
}

function parseArgs(argv: string[]): Options {
	const options: Options = {
		root: process.cwd(),
		json: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--root") {
			const value = argv[index + 1];
			if (!value) throw new Error("--root requires a value");
			options.root = path.resolve(value);
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
				severity: "error",
				code: "skill_path_unreadable",
				path: path.relative(root, skillPath),
				message: "cannot stat skill path",
			});
			continue;
		}
		if (!skillStat.isDirectory()) continue;
		const file = path.join(skillPath, "SKILL.md");
		try {
			if (statSync(file).isFile()) files.push(file);
		} catch {
			// Skill folders without SKILL.md are ignored.
		}
	}

	return { files, diagnostics };
}

function extractFrontmatter(text: string): string | undefined {
	const match = text.match(/^---\n([\s\S]*?)\n---\n/);
	return match?.[1];
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
	for (const line of frontmatter.split("\n")) {
		const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
		if (!match) continue;
		const raw = match[1] ?? "";
		if (raw === ">" || raw === "|") return undefined;
		return unquoteYamlScalar(raw);
	}
	return undefined;
}

function readStringList(frontmatter: string, key: string): string[] {
	const lines = frontmatter.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
		if (!match) continue;
		const raw = (match[1] ?? "").trim();
		if (raw.length > 0) {
			if (raw.startsWith("[") && raw.endsWith("]")) {
				return raw
					.slice(1, -1)
					.split(",")
					.map((value) => unquoteYamlScalar(value))
					.filter(Boolean);
			}
			return [unquoteYamlScalar(raw)];
		}

		const values: string[] = [];
		for (let childIndex = index + 1; childIndex < lines.length; childIndex += 1) {
			const child = lines[childIndex];
			if (/^\S/.test(child)) break;
			const item = child.match(/^\s*-\s*(.+)$/);
			if (item) values.push(unquoteYamlScalar(item[1] ?? ""));
		}
		return values.filter(Boolean);
	}
	return [];
}

function audit(options: Options): AuditResult {
	const { files, diagnostics } = listSkillFiles(options.root);
	for (const file of files) {
		const relativePath = path.relative(options.root, file);
		const text = readFileSync(file, "utf8");
		const frontmatter = extractFrontmatter(text);
		if (!frontmatter) {
			diagnostics.push({
				severity: "error",
				code: "frontmatter_missing",
				path: relativePath,
				message: "SKILL.md is missing YAML frontmatter",
			});
			continue;
		}

		const name = readScalar(frontmatter, "name") ?? path.basename(path.dirname(file));
		const role = readScalar(frontmatter, "role");
		if (!role) {
			diagnostics.push({
				severity: "error",
				code: "role_missing",
				skill: name,
				path: relativePath,
				message: "active skill is missing frontmatter role",
			});
			continue;
		}

		if (!ALLOWED_ROLES.includes(role)) {
			diagnostics.push({
				severity: "error",
				code: "role_invalid",
				skill: name,
				path: relativePath,
				role,
				message: `role must be one of: ${ALLOWED_ROLES.join(", ")}`,
			});
		}

		for (const ability of readStringList(frontmatter, "abilities")) {
			if (ALLOWED_ABILITIES.includes(ability)) continue;
			diagnostics.push({
				severity: "error",
				code: "ability_invalid",
				skill: name,
				path: relativePath,
				ability,
				message: `ability must be one of: ${ALLOWED_ABILITIES.join(", ")}`,
			});
		}
	}

	return {
		status: diagnostics.length === 0 ? "ok" : "error",
		root: options.root,
		skillCount: files.length,
		allowedRoles: ALLOWED_ROLES,
		allowedAbilities: ALLOWED_ABILITIES,
		diagnostics,
	};
}

function printText(result: AuditResult): void {
	console.log(`Skill role audit: ${result.status}`);
	console.log(`Skills checked: ${result.skillCount}`);
	if (result.diagnostics.length === 0) return;
	for (const diagnostic of result.diagnostics) {
		const where = diagnostic.path ? ` ${diagnostic.path}` : "";
		console.log(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}${where}: ${diagnostic.message}`);
	}
}

try {
	const options = parseArgs(Bun.argv.slice(2));
	const result = audit(options);
	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		printText(result);
	}
	process.exitCode = result.status === "error" ? 1 : 0;
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`skill-role-audit: ${message}`);
	process.exitCode = 2;
}
