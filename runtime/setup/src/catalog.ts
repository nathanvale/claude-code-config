import { existsSync } from "node:fs";
import { readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import { deepFreeze } from "./immutable.ts";
import type { SetupFinding, SetupFindingId } from "./model.ts";
import { isInsideOrEqual } from "./path-safety.ts";

export type CatalogEntryState = "valid" | "invalid" | "escape" | "collision";

export interface CatalogEntry {
	readonly id: string;
	readonly canonical_id: string;
	readonly path: string;
	readonly state: CatalogEntryState;
	readonly name?: string;
	readonly description?: string;
	readonly finding_id?: Extract<
		SetupFindingId,
		"invalid_skill" | "catalog_escape" | "canonical_id_collision"
	>;
}

export interface CatalogInspection {
	readonly root: string;
	readonly entries: readonly CatalogEntry[];
	readonly findings: readonly SetupFinding[];
}

/** Compatibility-aware fold shared by catalog, provider, and disk comparisons. */
export function canonicalSkillId(id: string): string {
	return id
		.normalize("NFKC")
		.toLowerCase()
		.replaceAll("ß", "ss")
		.replaceAll("ς", "σ")
		.normalize("NFC");
}

/** Group raw ids that name one compatibility-folded filesystem identity. */
export function findCanonicalSkillIdCollisions(
	ids: readonly string[],
): ReadonlyMap<string, readonly string[]> {
	const grouped = new Map<string, string[]>();
	for (const id of ids) {
		const canonical = canonicalSkillId(id);
		const group = grouped.get(canonical) ?? [];
		group.push(id);
		grouped.set(canonical, group);
	}
	return new Map([...grouped].filter(([, group]) => group.length > 1));
}

/** Inspect direct source-catalog children without changing the filesystem. */
export async function inspectCatalog(
	catalogRoot: string,
): Promise<CatalogInspection> {
	const root = resolve(catalogRoot);
	if (!existsSync(root)) return deepFreeze({ root, entries: [], findings: [] });
	const canonicalRoot = await realpath(root);
	const children = await readdir(root, { withFileTypes: true });
	const inspected = await Promise.all(
		children
			.filter((child) => child.isDirectory() || child.isSymbolicLink())
			.map((child) => inspectCatalogEntry(root, canonicalRoot, child.name)),
	);
	const byCanonical = new Map<string, CatalogEntry[]>();
	for (const entry of inspected) {
		const group = byCanonical.get(entry.canonical_id) ?? [];
		group.push(entry);
		byCanonical.set(entry.canonical_id, group);
	}

	const entries = inspected
		.map((entry): CatalogEntry => {
			const group = byCanonical.get(entry.canonical_id) ?? [];
			return group.length > 1
				? {
						...entry,
						state: "collision",
						finding_id: "canonical_id_collision",
					}
				: entry;
		})
		.sort((left, right) => left.id.localeCompare(right.id));
	const findings: SetupFinding[] = [];
	for (const [canonical, group] of [...byCanonical].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		if (group.length < 2) continue;
		findings.push({
			id: "canonical_id_collision",
			owner: "setup.catalog",
			path: root,
			summary: `Catalog ids ${group.map((entry) => `'${entry.id}'`).join(", ")} fold to '${canonical}'.`,
			repair: "human_repair",
		});
	}
	for (const entry of entries) {
		if (entry.state === "collision" || !entry.finding_id) continue;
		findings.push(catalogFinding(entry));
	}
	return deepFreeze({ root, entries, findings });
}

async function inspectCatalogEntry(
	root: string,
	canonicalRoot: string,
	id: string,
): Promise<CatalogEntry> {
	const path = join(root, id);
	let target: string;
	try {
		target = await realpath(path);
	} catch {
		return invalidEntry(id, path);
	}
	if (!isInsideOrEqual(canonicalRoot, target)) {
		return {
			id,
			canonical_id: canonicalSkillId(id),
			path,
			state: "escape",
			finding_id: "catalog_escape",
		};
	}
	try {
		const parsed = parseSkillFrontmatter(await readFile(join(path, "SKILL.md"), "utf8"));
		if (!parsed) return invalidEntry(id, path);
		return {
			id,
			canonical_id: canonicalSkillId(id),
			path,
			state: "valid",
			name: parsed.name,
			description: parsed.description,
		};
	} catch {
		return invalidEntry(id, path);
	}
}

function invalidEntry(id: string, path: string): CatalogEntry {
	return {
		id,
		canonical_id: canonicalSkillId(id),
		path,
		state: "invalid",
		finding_id: "invalid_skill",
	};
}

function parseSkillFrontmatter(
	text: string,
): { name: string; description: string } | undefined {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return undefined;
	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(match[1] ?? "");
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return undefined;
	}
	const record = parsed as Record<string, unknown>;
	return typeof record.name === "string" &&
		record.name.trim() !== "" &&
		typeof record.description === "string" &&
		record.description.trim() !== ""
		? { name: record.name, description: record.description }
		: undefined;
}

function catalogFinding(entry: CatalogEntry): SetupFinding {
	return {
		id: entry.finding_id ?? "invalid_skill",
		owner: "setup.catalog",
		path: entry.path,
		summary:
			entry.state === "escape"
				? `Catalog skill '${entry.id}' resolves outside its catalog.`
				: `Catalog skill '${entry.id}' has no valid SKILL.md.`,
		repair: "human_repair",
	};
}
