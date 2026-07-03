import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SkillCatalogEntry, SkillVisibility } from "./model.ts";
import { canonicalSkillId } from "./skills-lock.ts";

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
	const foldedPattern = canonicalSkillId(pattern);
	const escaped = foldedPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
	return regex.test(canonicalSkillId(id));
}

async function readCatalogEntry(
	catalogRoot: string,
	id: string,
): Promise<SkillCatalogEntry> {
	const path = resolve(catalogRoot, id);
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
