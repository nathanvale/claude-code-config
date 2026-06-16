import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

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
};

const CONFIG_FILE = ".agent-skills.yml";
const SUPPORTED_KEYS = new Set(["catalog", "ignore"]);

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

	while (true) {
		if (
			existsSync(join(current, ".git")) ||
			existsSync(join(current, "skills")) ||
			existsSync(join(current, "package.json"))
		) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) return resolve(cwd);
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
	if (!loaded.ok) {
		if (loaded.error.code !== "missing_config") return loaded;
		const repoRoot = resolveRepoRoot(cwd);
		const config = {
			catalog: "./skills",
			ignore: update([]),
		};
		await writeConfig(repoRoot, config);
		return loadAgentSkillsConfig(cwd);
	}
	if (loaded.config.autoDefault) {
		const config = {
			catalog: loaded.config.catalog,
			ignore: update([...loaded.config.ignore]),
		};
		await writeConfig(loaded.config.repoRoot, config);
		return loadAgentSkillsConfig(cwd);
	}

	const config = {
		catalog: loaded.config.catalog,
		ignore: update([...loaded.config.ignore]),
	};
	await writeConfig(loaded.config.repoRoot, config);
	return loadAgentSkillsConfig(cwd);
}

function parseConfigText(
	text: string,
	path: string,
): { ok: true; config: { catalog?: string; ignore?: string[] } } | {
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

	return {
		ok: true,
		config: {
			catalog: raw.catalog,
			ignore: raw.ignore as string[] | undefined,
		},
	};
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
	config: { catalog: string; ignore: readonly string[] },
): Promise<void> {
	await mkdir(repoRoot, { recursive: true });
	await writeFile(join(repoRoot, CONFIG_FILE), Bun.YAML.stringify(config), "utf8");
}
