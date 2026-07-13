import type { Stats } from "node:fs";
import { existsSync } from "node:fs";
import { lstat, readdir, readlink, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { canonicalSkillId } from "./catalog.ts";
import type { SetupFinding, SetupFindingId } from "./model.ts";
import type { ProviderEvidence } from "./provider-evidence.ts";
import type { ProjectionRoot } from "./scope.ts";

export type OwnershipClassification =
	| "managed_link"
	| "broken_managed_link"
	| "external_entry"
	| "real_entry"
	| "foreign_symlink"
	| "legacy_codex_root"
	| "unknown_entry";

export interface OwnershipEntry {
	readonly root_id: ProjectionRoot["id"];
	readonly id: string;
	readonly canonical_id: string;
	readonly path: string;
	readonly shape: "directory" | "file" | "symlink" | "other" | "unknown";
	readonly ownership: OwnershipClassification;
	readonly target?: string;
	readonly provider?: ProviderEvidence["entries"][number];
	readonly finding_id?: SetupFindingId;
}

export interface OwnershipInspection {
	readonly entries: readonly OwnershipEntry[];
	readonly findings: readonly SetupFinding[];
}

export interface OwnershipInput {
	readonly catalogRoot: string;
	readonly roots: readonly ProjectionRoot[];
	readonly providerEvidence: ProviderEvidence;
}

export interface OwnershipIo {
	readonly readdir: (path: string) => Promise<readonly string[]>;
	readonly lstat: (path: string) => Promise<Stats>;
}

const defaultIo: OwnershipIo = {
	readdir: async (path) => readdir(path),
	lstat,
};

/** Classify every stable disk child once. Never creates, removes, or rewrites. */
export async function inspectProjectionRoots(
	input: OwnershipInput,
	io: OwnershipIo = defaultIo,
): Promise<OwnershipInspection> {
	const canonicalCatalog = existsSync(input.catalogRoot)
		? await realpath(input.catalogRoot)
		: resolve(input.catalogRoot);
	const providers = new Map(
		input.providerEvidence.entries.map((entry) => [entry.canonical_id, entry]),
	);
	const entries: OwnershipEntry[] = [];
	const findings: SetupFinding[] = [];
	for (const root of input.roots) {
		if (!root.safe) {
			findings.push({
				id: "unsafe_root",
				owner: "setup.scope",
				path: root.path,
				summary: `Projection root '${root.path}' escapes its scope anchor.`,
				repair: "human_repair",
			});
			continue;
		}
		if (!existsSync(root.path)) continue;
		let children: readonly string[];
		try {
			children = await io.readdir(root.path);
		} catch {
			findings.push({
				id: "unsafe_root",
				owner: "setup.scope",
				path: root.path,
				summary: `Projection root '${root.path}' cannot be inspected safely.`,
				repair: "human_repair",
			});
			continue;
		}
		for (const id of [...children].sort((a, b) => a.localeCompare(b))) {
			const path = join(root.path, id);
			let stats: Stats;
			try {
				stats = await io.lstat(path);
			} catch (error) {
				if (isMissing(error)) continue;
				const entry: OwnershipEntry = {
					root_id: root.id,
					id,
					canonical_id: canonicalSkillId(id),
					path,
					shape: "unknown",
					ownership: "unknown_entry",
					finding_id: "real_entry",
				};
				entries.push(entry);
				findings.push(ownershipFinding(entry));
				continue;
			}
			const entry = root.legacy
				? legacyEntry(root, id, path, stats)
				: await classifyEntry(
						root,
						id,
						path,
						stats,
						canonicalCatalog,
						providers.get(canonicalSkillId(id)),
					);
			entries.push(entry);
			if (entry.finding_id) findings.push(ownershipFinding(entry));
		}
	}
	return freeze({ entries, findings });
}

async function classifyEntry(
	root: ProjectionRoot,
	id: string,
	path: string,
	stats: Stats,
	catalogRoot: string,
	provider: ProviderEvidence["entries"][number] | undefined,
): Promise<OwnershipEntry> {
	const common = {
		root_id: root.id,
		id,
		canonical_id: canonicalSkillId(id),
		path,
	};
	if (stats.isSymbolicLink()) {
		try {
			const target = await realpath(path);
			if (isInsideOrEqual(catalogRoot, target)) {
				return { ...common, shape: "symlink", ownership: "managed_link", target };
			}
		} catch {
			const target = await danglingTarget(path);
			if (target && isInsideOrEqual(catalogRoot, target)) {
				return {
					...common,
					shape: "symlink",
					ownership: "broken_managed_link",
					target,
					finding_id: "broken_managed_link",
				};
			}
		}
	}
	if (provider) {
		return {
			...common,
			shape: diskShape(stats),
			ownership: "external_entry",
			provider,
			finding_id: "external_entry",
		};
	}
	if (stats.isSymbolicLink()) {
		return {
			...common,
			shape: "symlink",
			ownership: "foreign_symlink",
			finding_id: "foreign_symlink",
		};
	}
	return {
		...common,
		shape: diskShape(stats),
		ownership: "real_entry",
		finding_id: "real_entry",
	};
}

function legacyEntry(
	root: ProjectionRoot,
	id: string,
	path: string,
	stats: Stats,
): OwnershipEntry {
	return {
		root_id: root.id,
		id,
		canonical_id: canonicalSkillId(id),
		path,
		shape: diskShape(stats),
		ownership: "legacy_codex_root",
		finding_id: "legacy_codex_root",
	};
}

async function danglingTarget(path: string): Promise<string | undefined> {
	try {
		const raw = await readlink(path);
		const target = isAbsolute(raw) ? resolve(raw) : resolve(dirname(path), raw);
		try {
			return join(await realpath(dirname(target)), basename(target));
		} catch {
			return target;
		}
	} catch {
		return undefined;
	}
}

function diskShape(stats: Stats): OwnershipEntry["shape"] {
	if (stats.isSymbolicLink()) return "symlink";
	if (stats.isDirectory()) return "directory";
	if (stats.isFile()) return "file";
	return "other";
}

function ownershipFinding(entry: OwnershipEntry): SetupFinding {
	const repair =
		entry.ownership === "broken_managed_link" ? "run_sync" : "human_repair";
	return {
		id: entry.finding_id ?? "real_entry",
		owner:
			entry.ownership === "external_entry" ? "bunx skills" : "setup.ownership",
		path: entry.path,
		summary: `Projection entry '${entry.id}' is ${entry.ownership.replaceAll("_", " ")}.`,
		repair,
	};
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT";
}

function isInsideOrEqual(root: string, path: string): boolean {
	const child = relative(resolve(root), resolve(path));
	return child === "" || (!child.startsWith("..") && !child.startsWith("/"));
}

function freeze<T extends object>(value: T): T {
	Object.freeze(value);
	for (const child of Object.values(value)) {
		if (child && typeof child === "object" && !Object.isFrozen(child)) freeze(child);
	}
	return value;
}
