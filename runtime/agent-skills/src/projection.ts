import { existsSync } from "node:fs";
import {
	lstat,
	mkdir,
	readFile,
	readdir,
	readlink,
	realpath,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
	AGENT_SKILLS_CONTRACT_ID,
	AGENT_SKILLS_NOISE_THRESHOLD,
	AGENT_SKILLS_PROJECTION_ROOTS,
	AGENT_SKILLS_SCHEMA_VERSION,
	AGENT_SKILLS_SNAPSHOT_PATH,
	type AgentSkillsSnapshot,
	type AgentSkillsStatus,
	type ExternalProjectionEntry,
	type ProjectionBlocker,
	type ProjectionChanges,
	type SkillVisibility,
} from "./model.ts";
import { SKILLS_LOCK_FILE, type SkillsLockReadResult } from "./skills-lock.ts";

/**
 * Projection plan computed before any filesystem writes.
 */
export interface AgentSkillsProjectionPlan {
	/** Shared status model for rendering. */
	status: AgentSkillsStatus;
	/** Visible skill ids and target paths. */
	visibleTargets: Readonly<Record<string, string>>;
	/** Repo-relative projection roots this plan may read or write. */
	projectionRoots: readonly string[];
}

interface ProjectionEntry {
	id: string;
	root: string;
	path: string;
	state: "managed" | "broken" | "blocker" | "external";
	shape: "real_entry" | "symlink";
	target?: string;
	blockerReason?: ProjectionBlocker["reason"];
}

/**
 * Read the local snapshot if it exists.
 *
 * @param repoRoot - Repo root containing generated local state
 * @returns Snapshot data when present and parseable
 *
 * @example
 * ```typescript
 * const snapshot = await readSnapshot("/repo")
 * ```
 */
export async function readSnapshot(
	repoRoot: string,
): Promise<AgentSkillsSnapshot | undefined> {
	const path = join(repoRoot, AGENT_SKILLS_SNAPSHOT_PATH);
	if (!existsSync(path)) return undefined;
	let parsed: Partial<AgentSkillsSnapshot>;
	try {
		parsed = JSON.parse(await readFile(path, "utf8")) as Partial<AgentSkillsSnapshot>;
	} catch {
		return undefined;
	}
	return Array.isArray(parsed.projected_ids) &&
		typeof parsed.targets === "object" &&
		parsed.targets !== null &&
		typeof parsed.projected_at === "string"
		? {
				projected_ids: parsed.projected_ids.filter(
					(entry): entry is string => typeof entry === "string",
				),
				targets: Object.fromEntries(
					Object.entries(parsed.targets).filter(
						(entry): entry is [string, string] => typeof entry[1] === "string",
					),
				),
				projected_at: parsed.projected_at,
			}
		: undefined;
}

/**
 * Build a projection plan without mutating projection roots or snapshot state.
 *
 * @param input - Repo root, catalog root, and visibility records
 * @returns Planned changes, blockers, change summaries, and health
 *
 * @example
 * ```typescript
 * const plan = await planProjection({ repoRoot, catalogRoot, visibility })
 * ```
 */
export async function planProjection(input: {
	repoRoot: string;
	catalogRoot: string;
	visibility: readonly SkillVisibility[];
	projectionRoots?: readonly string[];
	/** Read-only skills-lock view used to recognize external entries. */
	lock?: SkillsLockReadResult;
}): Promise<AgentSkillsProjectionPlan> {
	const catalogRoot = existsSync(input.catalogRoot)
		? await realpath(input.catalogRoot)
		: resolve(input.catalogRoot);
	const projectionRoots = input.projectionRoots ?? AGENT_SKILLS_PROJECTION_ROOTS;
	const managedTargets = [catalogRoot];
	const lock = input.lock ?? { entries: [] };
	const lockRecords = new Map(lock.entries.map((entry) => [entry.id, entry]));
	const visible = input.visibility.filter((entry) => entry.state === "visible");
	const ignored = input.visibility.filter((entry) => entry.state === "ignored");
	const invalid = input.visibility.filter((entry) => entry.state === "invalid");
	const visibleTargets = Object.fromEntries(
		await Promise.all(
			visible.map(async (entry) => [
				entry.id,
				existsSync(entry.path) ? await realpath(entry.path) : resolve(entry.path),
			]),
		),
	);
	const snapshot = await readSnapshot(input.repoRoot);
	const entries = (
		await Promise.all(
			projectionRoots.map((root) =>
				readProjectionRoot(input.repoRoot, root, managedTargets, lockRecords),
			),
		)
	).flat();
	const externals: ExternalProjectionEntry[] = entries
		.filter((entry) => entry.state === "external")
		.map((entry) => {
			const record = lockRecords.get(entry.id);
			return {
				root: entry.root,
				id: entry.id,
				path: entry.path,
				shape: entry.shape,
				source: record?.source,
				has_hash: record?.computedHash !== undefined,
			};
		});
	const externalIdsOnDisk = new Set(externals.map((entry) => entry.id));
	const missingExternalIds = [...lockRecords.keys()]
		.filter((id) => !externalIdsOnDisk.has(id))
		.sort();
	const blockers: ProjectionBlocker[] = [
		...catalogConflictBlockers(input.repoRoot, input.visibility, lockRecords),
		...entries
			.filter((entry) => entry.state === "blocker")
			.map((entry) => ({
				root: entry.root,
				id: entry.id,
				path: entry.path,
				reason: entry.blockerReason ?? ("real_entry" as const),
			})),
	];
	const changes = planChanges(entries, visibleTargets, projectionRoots);
	const lastProjected = snapshot?.projected_ids ?? [];
	const visibleIds = Object.keys(visibleTargets).sort();
	const newlyVisible = snapshot
		? visibleIds.filter((id) => !lastProjected.includes(id))
		: [];
	const removedSinceSnapshot = snapshot
		? lastProjected.filter((id) => !visibleIds.includes(id)).sort()
		: [];
	const health =
		blockers.length > 0
			? "blocked"
			: changes.broken.length > 0
				? "broken"
				: changes.create_or_update.length > 0 || changes.remove.length > 0
					? "needs_sync"
					: "clean";
	const nextAction =
		health === "blocked"
			? "inspect_blocker"
			: health === "clean"
				? "none"
				: "sync";
	const noiseHint =
		visible.length > AGENT_SKILLS_NOISE_THRESHOLD
			? `Visible set is large (${visible.length}); review with agent-skills ignore suggest.`
			: undefined;

	return {
		projectionRoots,
		visibleTargets,
		status: {
			contract_id: AGENT_SKILLS_CONTRACT_ID,
			schema_version: AGENT_SKILLS_SCHEMA_VERSION,
			repo_root: input.repoRoot,
			catalog_root: catalogRoot,
			checked_roots: projectionRoots.map((root) => join(input.repoRoot, root)),
			visible_count: visible.length,
			ignored_count: ignored.length,
			invalid_count: invalid.length,
			external_count: externals.length,
			externals,
			missing_external_ids: missingExternalIds,
			lock_parse_failure: lock.parseFailure,
			last_projected_at: snapshot?.projected_at,
			health,
			station:
				health === "blocked"
					? "unmanaged_blocker"
					: health === "clean"
						? "clean"
						: "needs_sync",
			changes,
			blockers,
			newly_visible: newlyVisible,
			removed_since_snapshot: removedSinceSnapshot,
			next_action: nextAction,
			next_action_summary: nextActionSummary(nextAction),
			noise_hint: noiseHint,
		},
	};
}

/**
 * Apply a projection plan and write the local snapshot after successful sync.
 *
 * @param plan - Previously computed projection plan
 * @param projectedAt - ISO timestamp for snapshot state
 * @throws When unmanaged blockers are present
 *
 * @example
 * ```typescript
 * await applyProjection(plan, new Date().toISOString())
 * ```
 */
export async function applyProjection(
	plan: AgentSkillsProjectionPlan,
	projectedAt: string,
): Promise<void> {
	if (plan.status.blockers.length > 0) {
		throw new Error("unmanaged_blocker");
	}

	for (const root of plan.projectionRoots) {
		await mkdir(join(plan.status.repo_root, root), { recursive: true });
	}

	for (const change of plan.status.changes.remove) {
		await rm(join(plan.status.repo_root, change), { force: true });
	}
	for (const change of [
		...plan.status.changes.broken,
		...plan.status.changes.create_or_update,
	]) {
		const linkPath = join(plan.status.repo_root, change);
		const id = change.split("/").at(-1);
		if (!id) continue;
		const target = plan.visibleTargets[id];
		if (!target) continue;
		await rm(linkPath, { force: true });
		await symlink(target, linkPath);
	}

	const snapshot: AgentSkillsSnapshot = {
		projected_ids: Object.keys(plan.visibleTargets).sort(),
		targets: Object.fromEntries(
			Object.entries(plan.visibleTargets).sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
		projected_at: projectedAt,
	};
	const snapshotPath = join(plan.status.repo_root, AGENT_SKILLS_SNAPSHOT_PATH);
	await mkdir(dirname(snapshotPath), { recursive: true });
	await writeFile(`${snapshotPath}.tmp`, `${JSON.stringify(snapshot, null, 2)}\n`);
	await rm(snapshotPath, { force: true });
	await rename(`${snapshotPath}.tmp`, snapshotPath);
}

/**
 * Remove managed projection links without touching unmanaged entries.
 *
 * @param repoRoot - Repo root containing projection roots
 * @param catalogRoot - Catalog root used to identify managed links
 * @param check - Preview without removing when true
 * @returns Removed or planned link paths relative to the repo root
 *
 * @example
 * ```typescript
 * const removed = await unlinkManagedProjections(repo, catalog, false)
 * ```
 */
export async function unlinkManagedProjections(
	repoRoot: string,
	catalogRoot: string,
	check: boolean,
	projectionRoots: readonly string[] = AGENT_SKILLS_PROJECTION_ROOTS,
	lock: SkillsLockReadResult = { entries: [] },
): Promise<readonly string[]> {
	const resolvedCatalogRoot = existsSync(catalogRoot)
		? await realpath(catalogRoot)
		: resolve(catalogRoot);
	const managedTargets = [resolvedCatalogRoot];
	const lockRecords = new Map(lock.entries.map((entry) => [entry.id, entry]));
	const entries = (
		await Promise.all(
			projectionRoots.map((root) =>
				readProjectionRoot(repoRoot, root, managedTargets, lockRecords),
			),
		)
	).flat();
	const managed = entries.filter(
		(entry) => entry.state === "managed" || entry.state === "broken",
	);
	if (!check) {
		for (const entry of managed) {
			await rm(entry.path, { force: true });
		}
	}
	return managed.map((entry) => relative(repoRoot, entry.path)).sort();
}

function planChanges(
	entries: readonly ProjectionEntry[],
	visibleTargets: Readonly<Record<string, string>>,
	projectionRoots: readonly string[],
): ProjectionChanges {
	const createOrUpdate = new Set<string>();
	const removeChanges = new Set<string>();
	const broken = new Set<string>();
	const visibleIds = new Set(Object.keys(visibleTargets));

	for (const root of projectionRoots) {
		for (const [id, target] of Object.entries(visibleTargets)) {
			const key = `${root}/${id}`;
			const entry = entries.find(
				(candidate) => candidate.root === root && candidate.id === id,
			);
			if (!entry) {
				createOrUpdate.add(key);
			} else if (entry.state === "broken") {
				broken.add(key);
			} else if (entry.state === "managed" && entry.target !== target) {
				createOrUpdate.add(key);
			}
		}
	}

	for (const entry of entries) {
		if (entry.state !== "managed" && entry.state !== "broken") continue;
		if (!visibleIds.has(entry.id)) {
			removeChanges.add(`${entry.root}/${entry.id}`);
		}
	}

	return {
		create_or_update: [...createOrUpdate].sort(),
		remove: [...removeChanges].sort(),
		broken: [...broken].sort(),
	};
}

async function readProjectionRoot(
	repoRoot: string,
	root: string,
	managedTargets: readonly string[],
	lockRecords: ReadonlyMap<string, unknown> = new Map(),
): Promise<ProjectionEntry[]> {
	const absoluteRoot = join(repoRoot, root);
	if (!existsSync(absoluteRoot)) return [];
	const children = await readdir(absoluteRoot);
	const entries: ProjectionEntry[] = [];

	for (const id of children) {
		const path = join(absoluteRoot, id);
		const stats = await lstat(path);
		const shape = stats.isSymbolicLink()
			? ("symlink" as const)
			: ("real_entry" as const);
		// Recognition is by lock evidence, not disk shape (ownership-by-record,
		// ADR 0016): real dirs, canonical-copy symlinks, and dangling links whose
		// id the lock names are all external and never touched.
		if (lockRecords.has(id)) {
			entries.push({ id, root, path, state: "external", shape });
			continue;
		}
		if (shape === "real_entry") {
			entries.push({
				id,
				root,
				path,
				state: "blocker",
				shape,
				blockerReason: "real_entry",
			});
			continue;
		}
		try {
			const target = await realpath(path);
			if (isManagedTarget(managedTargets, target)) {
				entries.push({ id, root, path, state: "managed", shape, target });
			} else {
				entries.push({
					id,
					root,
					path,
					state: "blocker",
					shape,
					blockerReason: "foreign_symlink",
				});
			}
		} catch {
			// Dangling link: classify by the raw link target so a foreign dangling
			// symlink stays unmanaged instead of being repaired or unlinked.
			const rawTarget = await danglingLinkTarget(path);
			if (rawTarget !== undefined && isManagedTarget(managedTargets, rawTarget)) {
				entries.push({ id, root, path, state: "broken", shape });
			} else {
				entries.push({
					id,
					root,
					path,
					state: "blocker",
					shape,
					blockerReason: "foreign_symlink",
				});
			}
		}
	}

	return entries;
}

function catalogConflictBlockers(
	repoRoot: string,
	visibility: readonly SkillVisibility[],
	lockRecords: ReadonlyMap<string, { source?: string }>,
): ProjectionBlocker[] {
	// A catalog id colliding with a lock id must fail closed with a distinct
	// reason: raw `skills add` overwrites foreign same-name skills, so a silent
	// winner on this side would reproduce that hazard in reverse.
	return visibility
		.filter((entry) => lockRecords.has(entry.id))
		.map((entry) => {
			const source = lockRecords.get(entry.id)?.source;
			return {
				root: relative(repoRoot, dirname(entry.path)),
				id: entry.id,
				path: entry.path,
				reason: "catalog_conflict" as const,
				why: `catalog skill '${entry.id}' (${entry.path}) collides with ${SKILLS_LOCK_FILE} entry '${entry.id}'${source ? ` (source: ${source})` : ""}; rename the catalog skill id, or remove the external install with the skills CLI (bunx skills).`,
			};
		});
}

async function danglingLinkTarget(path: string): Promise<string | undefined> {
	try {
		const raw = await readlink(path);
		const resolved = isAbsolute(raw) ? resolve(raw) : resolve(dirname(path), raw);
		// Canonicalize through the nearest existing parent so lexical paths like
		// /var/... still match a realpath'd catalog root like /private/var/...
		try {
			return join(await realpath(dirname(resolved)), basename(resolved));
		} catch {
			return resolved;
		}
	} catch {
		return undefined;
	}
}

function isManagedTarget(managedTargets: readonly string[], target: string): boolean {
	return managedTargets.some(
		(root) => target === resolve(root) || isInside(root, target),
	);
}

function isInside(root: string, child: string): boolean {
	const relativePath = relative(resolve(root), resolve(child));
	return Boolean(relativePath) && !relativePath.startsWith("..") && relativePath !== ".";
}

function nextActionSummary(action: AgentSkillsStatus["next_action"]): string {
	switch (action) {
		case "none":
			return "Projection clean.";
		case "sync":
			return "Run sync to repair local projections.";
		case "inspect_blocker":
			return "Inspect unmanaged projection entries before syncing.";
		case "fix_config":
			return "Fix .agent-skills.yml and retry.";
	}
}
