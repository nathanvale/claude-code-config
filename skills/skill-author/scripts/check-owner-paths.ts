#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type Severity = "error";

type Diagnostic = {
	severity: Severity;
	code: string;
	message: string;
	file: string;
	ownerPath: string;
	resolvedPath?: string;
};

type CheckResult = {
	status: "ok" | "error";
	root: string;
	files: string[];
	diagnostics: Diagnostic[];
};

type Options = {
	root: string;
	json: boolean;
	files: string[];
};

const REPO_LOCAL_PREFIXES = [
	"skills/",
	"context/",
	"docs/",
	"scripts/",
	"runtime/",
	"rules/",
];

const SKILL_RELATIVE_PREFIXES = [
	"references/",
	"scripts/",
	"assets/",
	"templates/",
];

const SKILL_ROOT_FILES = new Set([
	"SKILL.md",
	"CONTEXT.md",
	"TASKS.md",
]);

const REPO_ROOT_FILES = new Set([
	"AGENTS.md",
	"CLAUDE.md",
	"biome.jsonc",
]);

function printHelp(): void {
	console.log(`Usage: check-owner-paths.ts [--root <dir>] [--json] [file ...]

Checks backticked local owner paths in changed skill docs.

Without file arguments, checks changed skills/*/SKILL.md and skills/*/references/*.md files.
Explicit file arguments may name any repo-local doc (skills/, runtime/, docs/, ...).
Relative paths such as references/foo.md and scripts/foo.ts resolve from the owning
skills/<name> or runtime/<name> package root.

Options:
  --root <dir>  Repo root. Defaults to current working directory.
  --json        Emit JSON.
  -h, --help    Show help.`);
}

function parseArgs(argv: string[]): Options {
	const options: Options = {
		root: process.cwd(),
		json: false,
		files: [],
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
		if (arg.startsWith("-")) throw new Error(`Unknown argument: ${arg}`);
		options.files.push(arg);
	}

	return options;
}

function changedSkillDocs(root: string): string[] {
	const result = spawnSync("git", ["diff", "--name-only", "--", "skills/**/SKILL.md", "skills/**/references/*.md"], {
		cwd: root,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || "git diff --name-only failed");
	}
	return result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

const PACKAGE_ROOT_PARENTS = new Set(["skills", "runtime"]);

function packageRootForFile(relativeFile: string): string | undefined {
	const parts = relativeFile.split("/");
	if (parts.length < 3 || !PACKAGE_ROOT_PARENTS.has(parts[0] ?? "")) return undefined;
	return parts.slice(0, 2).join("/");
}

function stripAnchor(ownerPath: string): string {
	return ownerPath.replace(/#.*/, "");
}

function isLikelyCommand(token: string): boolean {
	return /\s/.test(token) || token.startsWith("--") || token.startsWith("-");
}

function isPlaceholder(token: string): boolean {
	return /[<>*]/.test(token);
}

function isExternal(token: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(token) || token.startsWith("mailto:");
}

function isArchiveNote(file: string): boolean {
	return file.includes("/archive/") || file.endsWith(".archive");
}

function classifyOwnerPath(token: string): "repo" | "skill" | undefined {
	if (REPO_LOCAL_PREFIXES.some((prefix) => token.startsWith(prefix))) return "repo";
	if (SKILL_RELATIVE_PREFIXES.some((prefix) => token.startsWith(prefix))) return "skill";
	if (SKILL_ROOT_FILES.has(token)) return "skill";
	if (REPO_ROOT_FILES.has(token)) return "repo";
	// "./" tokens are target-repo config examples (e.g. `./skills`), not owner paths.
	if (token.startsWith("../")) return "skill";
	return undefined;
}

function backtickedTokens(text: string): string[] {
	return [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

function resolveOwner(root: string, file: string, token: string): string | undefined {
	const cleanToken = stripAnchor(token);
	if (!cleanToken) return undefined;
	const kind = classifyOwnerPath(cleanToken);
	if (!kind) return undefined;
	if (kind === "repo") return path.join(root, cleanToken);

	const packageRoot = packageRootForFile(file);
	if (!packageRoot) return undefined;
	return path.normalize(path.join(root, packageRoot, cleanToken));
}

function resolveExistingOwner(root: string, file: string, token: string): string | undefined {
	const cleanToken = stripAnchor(token);
	if (!cleanToken) return undefined;

	const packageRoot = packageRootForFile(file);
	if (packageRoot && SKILL_RELATIVE_PREFIXES.some((prefix) => cleanToken.startsWith(prefix))) {
		const skillCandidate = path.normalize(path.join(root, packageRoot, cleanToken));
		if (existsSync(skillCandidate)) return skillCandidate;
		const repoCandidate = path.join(root, cleanToken);
		if (existsSync(repoCandidate)) return repoCandidate;
		return skillCandidate;
	}

	return resolveOwner(root, file, token);
}

function shouldSkipToken(token: string, file: string): boolean {
	return (
		isLikelyCommand(token) ||
		isPlaceholder(token) ||
		isExternal(token) ||
		isArchiveNote(file)
	);
}

function checkFile(root: string, file: string): Diagnostic[] {
	const absoluteFile = path.join(root, file);
	if (!existsSync(absoluteFile)) return [];
	const text = readFileSync(absoluteFile, "utf8");
	const diagnostics: Diagnostic[] = [];
	for (const token of backtickedTokens(text)) {
		if (shouldSkipToken(token, file)) continue;
		const resolved = resolveExistingOwner(root, file, token);
		if (!resolved) continue;
		if (existsSync(resolved)) continue;
		diagnostics.push({
			severity: "error",
			code: "owner_path_missing",
			file,
			ownerPath: token,
			resolvedPath: path.relative(root, resolved),
			message: "local owner path does not exist",
		});
	}
	return diagnostics;
}

function check(options: Options): CheckResult {
	const files = (options.files.length > 0 ? options.files : changedSkillDocs(options.root))
		.map((file) => path.relative(options.root, path.resolve(options.root, file)))
		.filter((file) => REPO_LOCAL_PREFIXES.some((prefix) => file.startsWith(prefix)))
		.sort();
	const diagnostics = files.flatMap((file) => checkFile(options.root, file));
	return {
		status: diagnostics.length === 0 ? "ok" : "error",
		root: options.root,
		files,
		diagnostics,
	};
}

function printText(result: CheckResult): void {
	console.log(`Owner path check: ${result.status}`);
	console.log(`Files checked: ${result.files.length}`);
	for (const diagnostic of result.diagnostics) {
		console.log(
			`${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.file}: ${diagnostic.ownerPath} -> ${diagnostic.resolvedPath}`,
		);
	}
}

try {
	const options = parseArgs(Bun.argv.slice(2));
	const result = check(options);
	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		printText(result);
	}
	process.exit(result.status === "ok" ? 0 : 1);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	if (Bun.argv.includes("--json")) {
		console.log(JSON.stringify({ status: "error", diagnostics: [{ severity: "error", code: "exception", message }] }, null, 2));
	} else {
		console.error(message);
	}
	process.exit(1);
}
