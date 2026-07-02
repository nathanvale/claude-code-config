import { existsSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillCatalogEntry, SkillVisibility } from "./model.ts";

const BUNDLED_CATALOG_ROOT = new URL("../../../skills/", import.meta.url);

/**
 * Absolute path of the bundled CCC skill catalog used by `imports`.
 *
 * @returns Bundled catalog directory path
 */
export function bundledCatalogRoot(): string {
	return fileURLToPath(BUNDLED_CATALOG_ROOT);
}

/**
 * Catalog symlink into the bundled catalog that is no longer imported.
 */
export interface StaleImportLink {
	/** Catalog entry id. */
	id: string;
	/** Absolute local catalog symlink path. */
	path: string;
}

/**
 * Find catalog symlinks into the bundled catalog not covered by `imports`.
 *
 * These are generated import state from a previous config; sync removes them
 * so dropped imports do not stay visible or wedge projection cleanup.
 *
 * @param catalogRoot - Absolute target catalog directory
 * @param imports - Currently configured import ids
 * @returns Stale import links safe to remove (always symlinks)
 */
export async function findStaleImportLinks(
	catalogRoot: string,
	imports: readonly string[],
): Promise<readonly StaleImportLink[]> {
	if (!existsSync(catalogRoot)) return [];
	const bundledPath = bundledCatalogRoot();
	const bundled = existsSync(bundledPath)
		? await realpath(bundledPath)
		: resolve(bundledPath);
	const resolvedCatalog = await realpath(catalogRoot);
	// Inside the bundled catalog repo itself, catalog-internal symlinks are
	// source, not import state; never auto-remove them.
	if (resolvedCatalog === bundled) return [];
	const importIds = new Set(imports);
	const children = await readdir(catalogRoot, { withFileTypes: true });
	const stale: StaleImportLink[] = [];
	for (const child of children) {
		if (!child.isSymbolicLink() || importIds.has(child.name)) continue;
		const path = join(catalogRoot, child.name);
		try {
			const target = await realpath(path);
			const rel = relative(bundled, target);
			if (rel.length > 0 && !rel.startsWith("..")) {
				stale.push({ id: child.name, path });
			}
		} catch {
			// Dangling catalog symlinks surface as invalid entries instead.
		}
	}
	return stale;
}

/**
 * Discover direct child skill entries in a catalog root.
 *
 * @param catalogRoot - Absolute catalog directory
 * @returns Valid and invalid direct child catalog entries
 *
 * @example
 * ```typescript
 * const entries = await discoverCatalog("/repo/skills")
 * ```
 */
export async function discoverCatalog(
	catalogRoot: string,
): Promise<readonly SkillCatalogEntry[]> {
	if (!existsSync(catalogRoot)) return [];

	const children = await readdir(catalogRoot, { withFileTypes: true });
	const entries = await Promise.all(
		children
			.filter((child) => child.isDirectory() || child.isSymbolicLink())
			.map((child) => readCatalogEntry(catalogRoot, child.name)),
	);

	return entries.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Discover configured CCC-owned imports as managed symlink catalog entries.
 *
 * @param catalogRoot - Absolute target catalog directory
 * @param imports - Skill ids imported from the bundled CCC catalog
 * @returns Imported entries addressed by their source catalog path
 */
export async function discoverImportedCatalog(
	catalogRoot: string,
	imports: readonly string[],
): Promise<readonly SkillCatalogEntry[]> {
	return Promise.all(
		imports.map(async (id) => {
			const sourcePath = resolve(fileURLToPath(BUNDLED_CATALOG_ROOT), id);
			const targetPath = resolve(catalogRoot, id);
			const entry = await readCatalogEntryFromPath(id, sourcePath);
			return {
				...entry,
				path: sourcePath,
				importLinkPath: targetPath,
			};
		}),
	);
}

/**
 * Apply ignore globs to valid catalog entries and retain invalid entries.
 *
 * @param entries - Catalog entries from discovery
 * @param ignore - Direct id globs from config
 * @returns Visibility records for list and projection planning
 *
 * @example
 * ```typescript
 * const visibility = applyVisibility(entries, ["fixture-*"])
 * ```
 */
export function applyVisibility(
	entries: readonly SkillCatalogEntry[],
	ignore: readonly string[],
): readonly SkillVisibility[] {
	return entries.map((entry) => {
		if (!entry.valid) {
			return {
				id: entry.id,
				path: entry.path,
				name: entry.name,
				state: "invalid",
				reason:
					entry.reason === "missing_skill_file"
						? "missing SKILL.md"
						: "invalid SKILL.md frontmatter",
			};
		}

		const matchingIgnore = ignore.find((pattern) =>
			matchesSkillIdGlob(entry.id, pattern),
		);
		if (matchingIgnore) {
			return {
				id: entry.id,
				path: entry.path,
				name: entry.name,
				state: "ignored",
				reason: `ignored by ${matchingIgnore}`,
				matchingIgnore,
			};
		}

		return {
			id: entry.id,
			path: entry.path,
			name: entry.name,
			state: "visible",
			reason: "valid catalog skill",
		};
	});
}

/**
 * Match an ignore pattern against a direct Skill Catalog Entry id.
 *
 * @param id - Direct catalog child id
 * @param pattern - Glob with `*` wildcards
 * @returns Whether the pattern matches the id
 *
 * @example
 * ```typescript
 * matchesSkillIdGlob("fixture-demo", "fixture-*")
 * ```
 */
export function matchesSkillIdGlob(id: string, pattern: string): boolean {
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
	return regex.test(id);
}

async function readCatalogEntry(
	catalogRoot: string,
	id: string,
): Promise<SkillCatalogEntry> {
	const path = resolve(catalogRoot, id);
	return readCatalogEntryFromPath(id, path);
}

async function readCatalogEntryFromPath(
	id: string,
	path: string,
): Promise<SkillCatalogEntry> {
	const skillPath = join(path, "SKILL.md");
	if (!existsSync(skillPath)) {
		return {
			id,
			path,
			valid: false,
			reason: "missing_skill_file",
		};
	}

	try {
		const frontmatter = parseSkillFrontmatter(await readFile(skillPath, "utf8"));
		if (!frontmatter) {
			return {
				id,
				path,
				valid: false,
				reason: "invalid_frontmatter",
			};
		}
		return {
			id,
			path,
			name: frontmatter.name,
			description: frontmatter.description,
			valid: true,
		};
	} catch {
		return {
			id,
			path,
			valid: false,
			reason: "invalid_frontmatter",
		};
	}
}

function parseSkillFrontmatter(
	text: string,
): { name: string; description: string } | null {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return null;
	const parsed = Bun.YAML.parse(match[1] ?? "");
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return null;
	}
	const record = parsed as Record<string, unknown>;
	return typeof record.name === "string" &&
		typeof record.description === "string" &&
		record.name.trim().length > 0 &&
		record.description.trim().length > 0
		? { name: record.name, description: record.description }
		: null;
}
