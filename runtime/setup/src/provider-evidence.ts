import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalSkillId } from "./catalog.ts";
import { deepFreeze } from "./immutable.ts";
import type { SetupFinding } from "./model.ts";

export const PROVIDER_EVIDENCE_FILE = "skills-lock.json" as const;

export interface ProviderEvidenceEntry {
	readonly id: string;
	readonly canonical_id: string;
	readonly source?: string;
	readonly source_type?: string;
	readonly has_hash?: boolean;
}

export interface ProviderEvidence {
	readonly path: string;
	readonly entries: readonly ProviderEvidenceEntry[];
	readonly finding?: SetupFinding;
}

/** Read provider evidence for attribution only. Missing evidence is healthy. */
export async function readProviderEvidence(
	root: string,
): Promise<ProviderEvidence> {
	const path = join(root, PROVIDER_EVIDENCE_FILE);
	if (!existsSync(path)) return deepFreeze({ path, entries: [] });
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		return malformed(path, `could not parse JSON: ${message(error)}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return malformed(path, "top level is not an object");
	}
	const skills = (parsed as { skills?: unknown }).skills;
	const records = Array.isArray(skills)
		? skills.map((record) => [stringField(record, "name") ?? stringField(record, "id"), record] as const)
		: typeof skills === "object" && skills !== null
			? Object.entries(skills as Record<string, unknown>)
			: undefined;
	if (!records) return malformed(path, "skills is not an object map or array");
	const entries: ProviderEvidenceEntry[] = [];
	const seen = new Set<string>();
	for (const [id, record] of records) {
		if (!validId(id)) continue;
		const canonical = canonicalSkillId(id);
		if (seen.has(canonical)) {
			return malformed(path, `multiple ids fold to '${canonical}'`);
		}
		seen.add(canonical);
		entries.push({
			id,
			canonical_id: canonical,
			source: stringField(record, "source"),
			source_type: stringField(record, "sourceType"),
			has_hash:
				stringField(record, "computedHash") !== undefined ||
				stringField(record, "hash") !== undefined,
		});
	}
	if (records.length > 0 && entries.length === 0) {
		return malformed(path, "no entry has a usable skill id");
	}
	return deepFreeze({ path, entries: entries.sort((a, b) => a.id.localeCompare(b.id)) });
}

function malformed(path: string, detail: string): ProviderEvidence {
	return deepFreeze({
		path,
		entries: [],
		finding: {
			id: "malformed_provider_lock",
			owner: "bunx skills",
			path,
			summary: `${PROVIDER_EVIDENCE_FILE} is malformed (${detail}); it grants no attribution.`,
			repair: "human_repair",
		},
	});
}

function validId(value: unknown): value is string {
	return typeof value === "string" &&
		value !== "" &&
		value !== "." &&
		value !== ".." &&
		!value.includes("/") &&
		!value.includes("\\") &&
		!value.includes("\0");
}

function stringField(value: unknown, key: string): string | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" && field !== "" ? field : undefined;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
