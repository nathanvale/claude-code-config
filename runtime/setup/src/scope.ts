import { existsSync, lstatSync, realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

/** Typed project-target failure translated by the CLI into invalid_target. */
export class InvalidTargetError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidTargetError";
	}
}

/** Resolve an existing target to the owning Git root and validate its catalog. */
export function resolveProjectRepoRoot(value: string | undefined): string {
	if (!value || !existsSync(value)) {
		throw new InvalidTargetError("Project target must exist and own a skills catalog.");
	}
	let target: string;
	try {
		target = realpathSync(value);
		if (!lstatSync(target).isDirectory()) {
			throw new InvalidTargetError("Project target must be a directory inside a Git repository.");
		}
	} catch (error) {
		if (error instanceof InvalidTargetError) throw error;
		throw new InvalidTargetError("Project target cannot be inspected.");
	}
	const probe = Bun.spawnSync(["git", "-C", target, "rev-parse", "--show-toplevel"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if (probe.exitCode !== 0) {
		throw new InvalidTargetError("Project target is not inside a Git repository.");
	}
	let root: string;
	try {
		root = realpathSync(resolve(decodeGitRecord(probe.stdout)));
	} catch {
		throw new InvalidTargetError("Project repository root cannot be resolved safely.");
	}
	const targetFromRoot = relative(root, target);
	if (
		isAbsolute(targetFromRoot) ||
		targetFromRoot === ".." ||
		targetFromRoot.startsWith(`..${sep}`)
	) {
		throw new InvalidTargetError("Project target must remain inside its Git repository root.");
	}
	const catalog = resolve(root, "skills");
	if (!existsSync(catalog) || !lstatSync(catalog).isDirectory()) {
		throw new InvalidTargetError("Project repository must own a skills catalog.");
	}
	return root;
}

function decodeGitRecord(output: Uint8Array): string {
	if (output.length < 2 || output.at(-1) !== 0x0a) {
		throw new InvalidTargetError("Git did not return a terminated repository-root record.");
	}
	return new TextDecoder().decode(output.subarray(0, -1));
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
