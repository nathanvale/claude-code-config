import { existsSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { deepFreeze } from "./immutable.ts";
import type { SetupFindingId, SetupScope } from "./model.ts";
import { hasErrorCode, isInsideOrEqual } from "./path-safety.ts";

export interface ProjectionRoot {
	readonly id: "claude" | "codex" | "legacy_codex";
	readonly path: string;
	readonly safe: boolean;
	readonly legacy?: boolean;
	readonly finding_id?: Extract<SetupFindingId, "unsafe_root">;
}

export interface SetupScopeInspection {
	readonly scope: SetupScope;
	readonly source_anchor: string;
	readonly target_anchor: string;
	readonly catalog_root: string;
	readonly provider_evidence_root: string;
	readonly projection_roots: readonly ProjectionRoot[];
	readonly legacy_roots: readonly ProjectionRoot[];
}

export interface ResolveSetupScopeInput {
	readonly scope: SetupScope;
	readonly sourceRepoRoot: string;
	readonly projectRepoRoot?: string;
	readonly homeDir?: string;
}

/** Resolve source and target anchors, then containment-check projection roots. */
export async function resolveSetupScope(
	input: ResolveSetupScopeInput,
): Promise<SetupScopeInspection> {
	const personalSource = resolve(input.sourceRepoRoot);
	const target =
		input.scope === "project"
			? resolve(requiredProject(input.projectRepoRoot))
			: resolve(input.homeDir ?? homedir());
	const source = input.scope === "project" ? target : personalSource;
	const roots = await Promise.all([
		checkRoot("claude", target, join(target, ".claude/skills")),
		checkRoot("codex", target, join(target, ".agents/skills")),
	]);
	const legacyRoots =
		input.scope === "user"
			? [
					await checkRoot(
						"legacy_codex",
						target,
						join(target, ".codex/skills"),
						true,
					),
				]
			: [];
	return deepFreeze({
		scope: input.scope,
		source_anchor: source,
		target_anchor: target,
		catalog_root: join(source, "skills"),
		provider_evidence_root: source,
		projection_roots: roots,
		legacy_roots: legacyRoots,
	});
}

async function checkRoot(
	id: ProjectionRoot["id"],
	anchor: string,
	path: string,
	legacy = false,
): Promise<ProjectionRoot> {
	const canonicalAnchor = existsSync(anchor) ? await realpath(anchor) : resolve(anchor);
	const nearest = await nearestExistingPath(path, anchor);
	let safe = nearest === undefined;
	if (nearest !== undefined) {
		try {
			safe = isInsideOrEqual(canonicalAnchor, await realpath(nearest));
		} catch {
			safe = false;
		}
	}
	return safe
		? { id, path, safe: true, ...(legacy ? { legacy: true } : {}) }
		: {
				id,
				path,
				safe: false,
				...(legacy ? { legacy: true } : {}),
				finding_id: "unsafe_root",
			};
}

async function nearestExistingPath(
	path: string,
	anchor: string,
): Promise<string | undefined> {
	let cursor = resolve(path);
	const stop = resolve(anchor);
	while (isInsideOrEqual(stop, cursor)) {
		try {
			await lstat(cursor);
			return cursor;
		} catch (error) {
			if (!isMissing(error)) return cursor;
		}
		if (cursor === stop) return cursor;
		cursor = dirname(cursor);
	}
	return undefined;
}

function isMissing(error: unknown): boolean {
	return hasErrorCode(error, "ENOENT");
}

function requiredProject(value: string | undefined): string {
	if (!value) throw new Error("Project scope requires projectRepoRoot.");
	return value;
}
