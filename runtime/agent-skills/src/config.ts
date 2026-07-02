import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { AGENT_SKILLS_PROJECTION_ROOTS } from "./model.ts";

/**
 * Supported v1 repo config.
 */
export interface AgentSkillsConfig {
	/** Repo root used as local visibility boundary. */
	repoRoot: string;
	/** Absolute path to the resolved catalog. */
	catalogRoot: string;
	/** Configured catalog value before path resolution. */
	catalog: string;
	/** Ignore globs matched against direct Skill Catalog Entry ids. */
	ignore: readonly string[];
	/** Repo-relative projection roots generated from the catalog. */
	projectionRoots: readonly string[];
	/** CCC-owned skill ids symlinked into the repo catalog before projection. */
	imports: readonly string[];
	/** Whether config came from the catalog-repo auto-default. */
	autoDefault: boolean;
}

/**
 * Repairable config error.
 */
export interface AgentSkillsConfigError {
	/** Config error code used by JSON output. */
	code: "missing_config" | "invalid_config";
	/** Concise human-readable message. */
	message: string;
	/** Repo-local path when a config file exists. */
	path?: string;
}

/**
 * Config load result.
 */
export type AgentSkillsConfigResult =
	| { ok: true; config: AgentSkillsConfig }
	| { ok: false; error: AgentSkillsConfigError };

type RawAgentSkillsConfig = {
	catalog?: unknown;
	ignore?: unknown;
	projection_roots?: unknown;
	imports?: unknown;
};

const CONFIG_FILE = ".agent-skills.yml";
const SUPPORTED_KEYS = new Set(["catalog", "ignore", "projection_roots", "imports"]);
const DEFAULT_PROJECTION_ROOTS = [...AGENT_SKILLS_PROJECTION_ROOTS];

/**
 * Resolve a repo root from a cwd by walking toward the filesystem root.
 *
 * @param cwd - Starting directory
 * @returns Nearest directory with repo markers, or the starting directory
 *
 * @example
 * ```typescript
 * const repo = resolveRepoRoot(process.cwd())
 * ```
 */
export function resolveRepoRoot(cwd: string): string {
	let current = resolve(cwd);
	// `.git` wins over softer markers: a nested package.json (monorepo package)
	// must not shrink the visibility boundary below the repo/worktree root.
	let fallback: string | undefined;

	while (true) {
		if (existsSync(join(current, ".git"))) return current;
		if (
			fallback === undefined &&
			(existsSync(join(current, "skills")) ||
				existsSync(join(current, "package.json")))
		) {
			fallback = current;
		}
		const parent = dirname(current);
		if (parent === current) return fallback ?? resolve(cwd);
		current = parent;
	}
}

/**
 * Load `.agent-skills.yml` or the catalog-repo auto-default.
 *
 * @param cwd - Directory inside the target repo or worktree
 * @returns Supported config or a repairable config error
 *
 * @example
 * ```typescript
 * const result = await loadAgentSkillsConfig(process.cwd())
 * ```
 */
export async function loadAgentSkillsConfig(
	cwd: string,
): Promise<AgentSkillsConfigResult> {
	const repoRoot = resolveRepoRoot(cwd);
	const configPath = join(repoRoot, CONFIG_FILE);

	if (!existsSync(configPath)) {
		const defaultCatalog = join(repoRoot, "skills");
		if (!existsSync(defaultCatalog)) {
			return {
				ok: false,
				error: {
					code: "missing_config",
					message:
						"Missing .agent-skills.yml and no catalog-repo ./skills default exists.",
				},
			};
		}
		return {
			ok: true,
			config: {
				repoRoot,
				catalogRoot: defaultCatalog,
				catalog: "./skills",
				ignore: [],
				projectionRoots: DEFAULT_PROJECTION_ROOTS,
				imports: [],
				autoDefault: true,
			},
		};
	}

	const text = await readFile(configPath, "utf8");
	const parsed = parseConfigText(text, configPath);
	if (!parsed.ok) return parsed;

	const catalog = parsed.config.catalog ?? "./skills";
	const catalogRoot = isAbsolute(catalog)
		? resolve(catalog)
		: resolve(repoRoot, catalog);

	return {
		ok: true,
		config: {
			repoRoot,
			catalogRoot,
			catalog,
			ignore: parsed.config.ignore ?? [],
			projectionRoots:
				parsed.config.projection_roots?.map(normalizeProjectionRoot) ??
				DEFAULT_PROJECTION_ROOTS,
			imports: parsed.config.imports ?? [],
			autoDefault: false,
		},
	};
}

/**
 * Add an ignore glob to the supported v1 config shape.
 *
 * @param cwd - Directory inside the target repo or worktree
 * @param pattern - Direct Skill Catalog Entry id glob
 * @returns Updated config or a repairable config error
 *
 * @example
 * ```typescript
 * await addIgnorePattern(process.cwd(), "fixture-*")
 * ```
 */
export async function addIgnorePattern(
	cwd: string,
	pattern: string,
): Promise<AgentSkillsConfigResult> {
	return updateIgnorePatterns(cwd, (patterns) =>
		patterns.includes(pattern) ? patterns : [...patterns, pattern],
	);
}

/**
 * Remove an ignore glob from the supported v1 config shape.
 *
 * @param cwd - Directory inside the target repo or worktree
 * @param pattern - Direct Skill Catalog Entry id glob
 * @returns Updated config or a repairable config error
 *
 * @example
 * ```typescript
 * await removeIgnorePattern(process.cwd(), "fixture-*")
 * ```
 */
export async function removeIgnorePattern(
	cwd: string,
	pattern: string,
): Promise<AgentSkillsConfigResult> {
	return updateIgnorePatterns(cwd, (patterns) =>
		patterns.filter((entry) => entry !== pattern),
	);
}

async function updateIgnorePatterns(
	cwd: string,
	update: (patterns: string[]) => string[],
): Promise<AgentSkillsConfigResult> {
	const loaded = await loadAgentSkillsConfig(cwd);
	if (!loaded.ok) return loaded;
	if (!loaded.config.autoDefault) {
		const configPath = join(loaded.config.repoRoot, CONFIG_FILE);
		const text = await readFile(configPath, "utf8");
		if (hasYamlComments(text)) {
			return invalidConfig(
				configPath,
				"Config contains comments; edit the ignore list manually to preserve them.",
			);
		}
	}
	await writeConfig(loaded.config.repoRoot, updatedConfig(loaded.config, update));
	return loadAgentSkillsConfig(cwd);
}

function hasYamlComments(text: string): boolean {
	return text
		.split("\n")
		.some((line) => line.trimStart().startsWith("#") || / #/.test(line));
}

function updatedConfig(
	config: AgentSkillsConfig,
	update: (patterns: string[]) => string[],
): {
	catalog: string;
	ignore: readonly string[];
	projection_roots: readonly string[];
	imports: readonly string[];
} {
	return {
		catalog: config.catalog,
		ignore: update([...config.ignore]),
		projection_roots: config.projectionRoots,
		imports: config.imports,
	};
}

function parseConfigText(
	text: string,
	path: string,
):
	| {
			ok: true;
			config: {
				catalog?: string;
				ignore?: string[];
				projection_roots?: string[];
				imports?: string[];
			};
	  }
	| {
			ok: false;
			error: AgentSkillsConfigError;
	  } {
	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(text);
	} catch (error) {
		return invalidConfig(path, `Invalid YAML: ${(error as Error).message}`);
	}

	if (parsed === null) parsed = {};
	if (typeof parsed !== "object" || Array.isArray(parsed)) {
		return invalidConfig(path, "Config must be a top-level mapping.");
	}

	const raw = parsed as RawAgentSkillsConfig;
	for (const key of Object.keys(raw)) {
		if (!SUPPORTED_KEYS.has(key)) {
			return invalidConfig(path, `Unsupported config key: ${key}.`);
		}
	}
	if (raw.catalog !== undefined && typeof raw.catalog !== "string") {
		return invalidConfig(path, "catalog must be a string path.");
	}
	if (raw.catalog !== undefined && raw.catalog.trim().length === 0) {
		return invalidConfig(path, "catalog must not be blank.");
	}
	if (
		raw.ignore !== undefined &&
		(!Array.isArray(raw.ignore) ||
			!raw.ignore.every((entry) => typeof entry === "string"))
	) {
		return invalidConfig(path, "ignore must be a list of strings.");
	}
	if (raw.projection_roots !== undefined) {
		if (
			!Array.isArray(raw.projection_roots) ||
			!raw.projection_roots.every((entry) => typeof entry === "string")
		) {
			return invalidConfig(path, "projection_roots must be a list of strings.");
		}
		const invalidRoot = raw.projection_roots.find(
			(entry) => !isValidProjectionRoot(entry),
		);
		if (invalidRoot !== undefined) {
			return invalidConfig(
				path,
				`projection_roots entry must be a repo-relative path: ${invalidRoot}`,
			);
		}
	}
	if (
		raw.imports !== undefined &&
		(!Array.isArray(raw.imports) ||
			!raw.imports.every((entry) => isValidImportId(entry)))
	) {
		return invalidConfig(path, "imports must be a list of skill ids.");
	}

	return {
		ok: true,
		config: {
			catalog: raw.catalog,
			ignore: raw.ignore as string[] | undefined,
			projection_roots: (raw.projection_roots as string[] | undefined)?.map(
				normalizeProjectionRoot,
			),
			imports: raw.imports as string[] | undefined,
		},
	};
}

function isValidProjectionRoot(entry: string): boolean {
	const normalized = normalizeProjectionRoot(entry);
	return (
		entry.trim().length > 0 &&
		!isAbsolute(entry) &&
		normalized !== "." &&
		!normalized.startsWith("..")
	);
}

function normalizeProjectionRoot(entry: string): string {
	return normalize(entry);
}

function isValidImportId(entry: unknown): entry is string {
	return (
		typeof entry === "string" &&
		/^[a-z0-9][a-z0-9-]*$/.test(entry)
	);
}

function invalidConfig(
	path: string,
	message: string,
): { ok: false; error: AgentSkillsConfigError } {
	return {
		ok: false,
		error: {
			code: "invalid_config",
			path,
			message,
		},
	};
}

async function writeConfig(
	repoRoot: string,
	config: {
		catalog: string;
		ignore: readonly string[];
		projection_roots: readonly string[];
		imports: readonly string[];
	},
): Promise<void> {
	await mkdir(repoRoot, { recursive: true });
	await writeFile(join(repoRoot, CONFIG_FILE), Bun.YAML.stringify(config), "utf8");
}
