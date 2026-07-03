import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Lockfile name written by the community skills CLI at the repo root.
 *
 * @defaultValue "skills-lock.json"
 */
export const SKILLS_LOCK_FILE = "skills-lock.json" as const;

/**
 * One external skill record read from the lockfile.
 */
export interface SkillsLockEntry {
	/** Skill id; validated as a single path-component token. */
	id: string;
	/** Best-effort install source; the provider may omit it. */
	source?: string;
	/** Best-effort install source type (`local`, `github`, ...) when present. */
	sourceType?: string;
	/** Content hash recorded at install time, when present. */
	computedHash?: string;
}

/**
 * Fold a skill id to a canonical key for collision-safe comparison.
 *
 * Case-insensitive volumes (macOS APFS default, Windows) and Unicode
 * normalization collapse ids that differ by full case-fold or compatibility
 * forms to one filesystem path. Exact-string map keys would then classify the
 * same path two ways: the classifier and the conflict check must fold
 * identically or a case/normalization-variant lock id can bypass the
 * fail-closed `catalog_conflict` guard.
 *
 * @param id - Raw skill id from a lock record, catalog dir, or disk entry
 * @returns Case-folded, compatibility-normalized key
 *
 * @example
 * ```typescript
 * canonicalSkillId("Fallow") === canonicalSkillId("fallow")
 * ```
 */
export function canonicalSkillId(id: string): string {
	return id
		.normalize("NFKC")
		.toLowerCase()
		.replaceAll("ß", "ss")
		.replaceAll("ς", "σ")
		.normalize("NFC");
}

/**
 * Read-only view of the repo's skills lockfile.
 */
export interface SkillsLockReadResult {
	/** Valid external entries keyed by id order. */
	entries: readonly SkillsLockEntry[];
	/** Named diagnostic when a present lock yields no parseable entries. */
	parseFailure?: string;
}

const EMPTY: SkillsLockReadResult = { entries: [] };

/**
 * Read `skills-lock.json` tolerantly; never write, never throw.
 *
 * Normalizes the observed object shape
 * (`{version, skills: {name: {source, computedHash}}}`) and the upstream
 * array shape (`{skills: [{name, source, hash}]}`). Malformed input degrades
 * to an empty entry set plus a named parse-failure diagnostic so triage points
 * at the lockfile instead of at deletable directories.
 *
 * @param repoRoot - Repo root that may contain the lockfile
 * @returns External entries plus an optional parse-failure diagnostic
 *
 * @example
 * ```typescript
 * const lock = await readSkillsLock("/repo")
 * ```
 */
export async function readSkillsLock(
	repoRoot: string,
): Promise<SkillsLockReadResult> {
	const path = join(repoRoot, SKILLS_LOCK_FILE);
	if (!existsSync(path)) return EMPTY;

	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		return parseFailure(
			`could not read file: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return parseFailure(
			`invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return parseFailure("expected a top-level object.");
	}
	const skills = (parsed as { skills?: unknown }).skills;
	if (skills === undefined || skills === null) {
		return parseFailure("missing skills field.");
	}

	const raw = Array.isArray(skills)
		? skills.map((record) => [recordName(record), record] as const)
		: typeof skills === "object"
			? Object.entries(skills as Record<string, unknown>)
			: undefined;
	if (raw === undefined) {
		return parseFailure("skills must be an object map or an array.");
	}

	const entries: SkillsLockEntry[] = [];
	const seenCanonical = new Map<string, string>();
	for (const [name, record] of raw) {
		// A crafted lock key must not smuggle an arbitrary directory past the
		// blocker model: only single path-component tokens enter the external set.
		if (!isValidLockId(name)) continue;
		// Two ids that fold to the same canonical key (e.g. `Fallow`/`fallow`, or
		// NFC/NFD variants) name one filesystem path. Downstream folds to that key,
		// so a last-writer-wins map would let one lock record silently hide
		// another. Fail closed: a canonical collision degrades to a parse failure
		// rather than trusting an ambiguous lock.
		const canonical = canonicalSkillId(name);
		const prior = seenCanonical.get(canonical);
		if (prior !== undefined) {
			return parseFailure(
				`ids '${prior}' and '${name}' fold to the same canonical key '${canonical}'; one lock record would hide the other.`,
			);
		}
		seenCanonical.set(canonical, name);
		entries.push({
			id: name,
			source: recordString(record, "source"),
			sourceType: recordString(record, "sourceType"),
			computedHash:
				recordString(record, "computedHash") ?? recordString(record, "hash"),
		});
	}

	if (entries.length === 0 && raw.length > 0) {
		return parseFailure("no entry has a usable skill id.");
	}
	return { entries };
}

function isValidLockId(name: unknown): name is string {
	return (
		typeof name === "string" &&
		name.length > 0 &&
		name !== "." &&
		name !== ".." &&
		!name.includes("/") &&
		!name.includes("\\") &&
		!name.includes("\0")
	);
}

function recordName(record: unknown): string | undefined {
	return recordString(record, "name") ?? recordString(record, "id");
}

function recordString(record: unknown, key: string): string | undefined {
	if (typeof record !== "object" || record === null) return undefined;
	const value = (record as Record<string, unknown>)[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseFailure(detail: string): SkillsLockReadResult {
	return {
		entries: [],
		parseFailure: `${SKILLS_LOCK_FILE} could not be read (${detail}); external installs fall back to blocker classification until the lockfile is repaired.`,
	};
}
