import { existsSync, realpathSync } from "node:fs";
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
import {
	canonicalSkillId,
	readSkillsLock,
	SKILLS_LOCK_FILE,
	type SkillsLockEntry,
	type SkillsLockReadResult,
} from "./skills-lock.ts";

/**
 * Lock records keyed by canonical, compatibility-aware id.
 *
 * Consumers must look up disk ids and catalog ids through the same fold so a
 * case/Unicode-variant lock id cannot classify one filesystem path two
 * ways.
 */
type LockRecordMap = ReadonlyMap<string, SkillsLockEntry>;

function buildLockRecords(entries: readonly SkillsLockEntry[]): LockRecordMap {
	return new Map(entries.map((entry) => [canonicalSkillId(entry.id), entry]));
}

/**
 * A lock entry is a benign self-install when its local source binds to this
 * exact catalog id. A source that only points somewhere inside the catalog is
 * forgeable conflict suppression, not ownership evidence.
 */
function isSelfInstall(
	record: SkillsLockEntry | undefined,
	repoRoot: string,
	catalogRoot: string,
	id: string,
): boolean {
	if (!record || record.sourceType !== "local" || !record.source) return false;
	const resolved = resolve(repoRoot, record.source);
	// catalogRoot is realpath'd by planProjection, so a lexical /var/... source
	// must be canonicalized the same way (macOS /var -> /private/var) before
	// comparison, else a genuine self-install misses and wedges as a conflict.
	const canonicalResolved = existsSync(resolved)
		? realpathSync(resolved)
		: resolved;
	const expected = resolve(catalogRoot, id);
	const canonicalExpected = existsSync(expected)
		? realpathSync(expected)
		: expected;
	return isInsideOrEqual(catalogRoot, canonicalResolved) &&
		canonicalResolved === canonicalExpected;
}

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

type ProjectionRootCheck =
	| { ok: true; root: string; absoluteRoot: string }
	| { ok: false; root: string; absoluteRoot: string; blocker: ProjectionBlocker };

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
	const lockRecords = buildLockRecords(lock.entries);
	const visible = input.visibility.filter((entry) => entry.state === "visible");
	const ignored = input.visibility.filter((entry) => entry.state === "ignored");
	const invalid = input.visibility.filter((entry) => entry.state === "invalid");
	const rootChecks = await Promise.all(
		projectionRoots.map((root) => resolveProjectionRoot(input.repoRoot, root)),
	);
	const safeProjectionRoots = rootChecks
		.filter((check): check is Extract<ProjectionRootCheck, { ok: true }> => check.ok)
		.map((check) => check.root);
	const rootBlockers = rootChecks
		.filter((check): check is Extract<ProjectionRootCheck, { ok: false }> => !check.ok)
		.map((check) => check.blocker);
	// A catalog entry whose realpath escapes the catalog must never be projected:
	// its live link would resolve outside managedTargets and the next plan would
	// condemn it as a permanent foreign_symlink, wedging sync (finding #3).
	const visibleTargets: Record<string, string> = {};
	const escapingCatalogTargets: SkillVisibility[] = [];
	for (const entry of visible) {
		const target = existsSync(entry.path)
			? await realpath(entry.path)
			: resolve(entry.path);
		if (isManagedTarget(managedTargets, target)) {
			visibleTargets[entry.id] = target;
		} else {
			escapingCatalogTargets.push(entry);
		}
	}
	const snapshot = await readSnapshot(input.repoRoot);
	const entries = (
		await Promise.all(
			safeProjectionRoots.map((root) =>
				readProjectionRoot(
					input.repoRoot,
					root,
					managedTargets,
					lockRecords,
				),
			),
		)
	).flat();
	const externals: ExternalProjectionEntry[] = entries
		.filter((entry) => entry.state === "external")
		.map((entry) => {
			const record = lockRecords.get(canonicalSkillId(entry.id));
			return {
				root: entry.root,
				id: entry.id,
				path: entry.path,
				shape: entry.shape,
				source: record?.source,
				has_hash: record?.computedHash !== undefined,
			};
		});
	const externalCanonicalOnDisk = new Set(
		externals.map((entry) => canonicalSkillId(entry.id)),
	);
	// A benign self-install is projected as a managed catalog link, never as an
	// `external` disk entry, so it is absent from externalCanonicalOnDisk by
	// design. Excluding it here keeps it out of missing_external_ids — reporting
	// a self-install alias as a missing external is false status for the case
	// the model deliberately treats as benign.
	const missingExternalIds = lock.entries
		.filter(
			(entry) =>
				!externalCanonicalOnDisk.has(canonicalSkillId(entry.id)) &&
				!isSelfInstall(entry, input.repoRoot, catalogRoot, entry.id),
		)
		.map((entry) => entry.id)
		.sort();
	const blockers: ProjectionBlocker[] = [
		...rootBlockers,
		...catalogConflictBlockers(
			input.repoRoot,
			catalogRoot,
			input.visibility,
			lockRecords,
		),
		...escapingCatalogTargets.map((entry) => ({
			root: relative(input.repoRoot, dirname(entry.path)),
			id: entry.id,
			path: entry.path,
			reason: "foreign_symlink" as const,
			why: `catalog skill '${entry.id}' (${entry.path}) resolves outside the catalog; projecting it would create an escaping link the next plan condemns. Point the catalog entry inside the catalog or ignore it.`,
		})),
		...entries
			.filter((entry) => entry.state === "blocker")
			.map((entry) => ({
				root: entry.root,
				id: entry.id,
				path: entry.path,
				reason: entry.blockerReason ?? ("real_entry" as const),
				why: lock.parseFailure
					? `${lock.parseFailure} Repair ${SKILLS_LOCK_FILE} before deleting projection entries that may be external installs.`
					: undefined,
			})),
	];
	const changes = planChanges(entries, visibleTargets, safeProjectionRoots);
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

	const rootChecks = await Promise.all(
		plan.projectionRoots.map((root) =>
			resolveProjectionRoot(plan.status.repo_root, root),
		),
	);
	if (rootChecks.some((check) => !check.ok)) {
		throw new Error("unmanaged_blocker");
	}
	for (const check of rootChecks) {
		if (check.ok) await mkdir(check.absoluteRoot, { recursive: true });
	}

	// The plan is a snapshot of a world two other tools (the skills CLI, other
	// projectors) may write concurrently. Re-read the lock and re-classify every
	// path immediately before mutating so a stale plan cannot delete a
	// now-external entry, overwrite a concurrently-landed external, or crash on a
	// real directory that appeared after planning (findings #2, #11, #12, #13,
	// #17). Any surprise fails closed: skip the mutation and throw so the next
	// plan re-surfaces it as a blocker instead of forcing through a stale write.
	const catalogRoot = plan.status.catalog_root;
	let deferred = false;

	for (const change of plan.status.changes.remove) {
		const removePath = join(plan.status.repo_root, change);
		const id = change.split("/").at(-1);
		const freshLock = buildLockRecords(
			(await readSkillsLock(plan.status.repo_root)).entries,
		);
		if (id && freshLock.has(canonicalSkillId(id))) {
			// A concurrently-landed lock entry now owns this id: never delete it.
			deferred = true;
			continue;
		}
		if (!(await removeIfOwnedLink(removePath, [catalogRoot]))) deferred = true;
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
		const freshLock = buildLockRecords(
			(await readSkillsLock(plan.status.repo_root)).entries,
		);
		const record = freshLock.get(canonicalSkillId(id));
		if (record && !isSelfInstall(record, plan.status.repo_root, catalogRoot, id)) {
			// A lock entry landed for this id since planning; it is now external.
			deferred = true;
			continue;
		}
		if (!(await removeIfOwnedLink(linkPath, [catalogRoot]))) {
			deferred = true;
			continue;
		}
		try {
			await symlink(target, linkPath);
		} catch {
			deferred = true;
		}
	}

	if (deferred) {
		// At least one target changed ownership mid-apply. Fail closed so the
		// caller re-plans against current disk state rather than trusting a
		// partially applied stale plan.
		throw new Error("unmanaged_blocker");
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
	const lockRecords = buildLockRecords(lock.entries);
	const rootChecks = await Promise.all(
		projectionRoots.map((root) => resolveProjectionRoot(repoRoot, root)),
	);
	if (rootChecks.some((check) => !check.ok)) {
		throw new Error("unmanaged_blocker");
	}
	const safeProjectionRoots = rootChecks
		.filter((check): check is Extract<ProjectionRootCheck, { ok: true }> => check.ok)
		.map((check) => check.root);
	const entries = (
		await Promise.all(
			safeProjectionRoots.map((root) =>
				readProjectionRoot(
					repoRoot,
					root,
					managedTargets,
					lockRecords,
				),
			),
		)
	).flat();
	const managed = entries.filter(
		(entry) =>
			(entry.state === "managed" || entry.state === "broken") &&
			entry.shape === "symlink",
	);
	if (!check) {
		for (const entry of managed) {
			await removeIfOwnedLink(entry.path, managedTargets);
		}
	}
	return managed.map((entry) => relative(repoRoot, entry.path)).sort();
}

async function resolveProjectionRoot(
	repoRoot: string,
	root: string,
): Promise<ProjectionRootCheck> {
	const canonicalRepoRoot = existsSync(repoRoot)
		? await realpath(repoRoot)
		: resolve(repoRoot);
	const absoluteRoot = resolve(canonicalRepoRoot, root);
	if (!isInsideOrEqual(canonicalRepoRoot, absoluteRoot)) {
		return {
			ok: false,
			root,
			absoluteRoot,
			blocker: projectionRootBlocker(repoRoot, root, absoluteRoot),
		};
	}

	const nearest = await nearestExistingPath(absoluteRoot, canonicalRepoRoot);
	if (nearest) {
		const resolvedNearest = await realpath(nearest);
		if (!isInsideOrEqual(canonicalRepoRoot, resolvedNearest)) {
			return {
				ok: false,
				root,
				absoluteRoot,
				blocker: projectionRootBlocker(repoRoot, root, absoluteRoot),
			};
		}
	}

	return { ok: true, root, absoluteRoot };
}

async function nearestExistingPath(
	path: string,
	stopAt: string,
): Promise<string | undefined> {
	let current = resolve(path);
	const stop = resolve(stopAt);
	while (isInsideOrEqual(stop, current)) {
		if (existsSync(current)) return current;
		if (current === stop) return undefined;
		current = dirname(current);
	}
	return undefined;
}

function projectionRootBlocker(
	repoRoot: string,
	root: string,
	path: string,
): ProjectionBlocker {
	return {
		root: dirname(root),
		id: basename(root),
		path,
		reason: "foreign_symlink",
		why: `projection root '${root}' resolves outside the repo; restore it to a directory inside ${repoRoot} before syncing or unlinking.`,
	};
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
	lockRecords: LockRecordMap = new Map(),
): Promise<ProjectionEntry[]> {
	const absoluteRoot = join(repoRoot, root);
	if (!existsSync(absoluteRoot)) return [];
	const children = await readdir(absoluteRoot);
	const entries: ProjectionEntry[] = [];

	for (const id of children) {
		const path = join(absoluteRoot, id);
		let stats: Awaited<ReturnType<typeof lstat>>;
		try {
			stats = await lstat(path);
		} catch {
			// A concurrent skills CLI, git checkout, or another projector can remove
			// a child between readdir and lstat. A vanished child is absent, not a
			// reason to reject the whole plan (finding #16).
			continue;
		}
		const shape = stats.isSymbolicLink()
			? ("symlink" as const)
			: ("real_entry" as const);
		const record = lockRecords.get(canonicalSkillId(id));

		// Tool-owned symlinks win over lock recognition. A symlink resolving (or
		// raw-pointing) into the catalog is an agent-skills artifact: classify it
		// managed/broken so unlink and sync retain their escape hatch even when a
		// lock entry later claims the same id (findings #8, #9). Real dirs and
		// foreign symlinks defer to lock evidence below.
		if (shape === "symlink") {
			try {
				const target = await realpath(path);
				if (isManagedTarget(managedTargets, target)) {
					entries.push({ id, root, path, state: "managed", shape, target });
					continue;
				}
			} catch {
				const rawTarget = await danglingLinkTarget(path);
				if (
					rawTarget !== undefined &&
					isManagedTarget(managedTargets, rawTarget)
				) {
					entries.push({ id, root, path, state: "broken", shape });
					continue;
				}
			}
		}

		// Recognition is by lock evidence, not disk shape (ownership-by-record,
		// ADR 0016): a real dir or a canonical-copy symlink whose id the lock
		// names is external and never touched. Benign self-install only applies to
		// catalog-conflict suppression for an id-bound local source; disk entries
		// still need tool-owned link evidence before they classify managed.
		if (record) {
			entries.push({
				id,
				root,
				path,
				state: "external",
				shape,
			});
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
		// Non-catalog symlink with no lock record: unmanaged foreign link.
		entries.push({
			id,
			root,
			path,
			state: "blocker",
			shape,
			blockerReason: "foreign_symlink",
		});
	}

	return entries;
}

function catalogConflictBlockers(
	repoRoot: string,
	catalogRoot: string,
	visibility: readonly SkillVisibility[],
	lockRecords: LockRecordMap,
): ProjectionBlocker[] {
	// A catalog id colliding with a lock id must fail closed with a distinct
	// reason: raw `skills add` overwrites foreign same-name skills, so a silent
	// winner on this side would reproduce that hazard in reverse. Only *visible*
	// catalog entries are projection candidates: an ignored or invalid entry
	// sharing a lock id is not projected and must not wedge sync (findings #6,
	// #7). Comparison uses the canonical Unicode fold so a variant lock id
	// cannot slip past (findings #1, #10). A benign self-install aliases only
	// the same catalog id rather than conflicting (findings #4, #5).
	return visibility
		.filter((entry) => entry.state === "visible")
		.filter((entry) => {
			const record = lockRecords.get(canonicalSkillId(entry.id));
			return (
				record !== undefined &&
				!isSelfInstall(record, repoRoot, catalogRoot, entry.id)
			);
		})
		.map((entry) => {
			const source = lockRecords.get(canonicalSkillId(entry.id))?.source;
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

/**
 * Remove a path only when it is a symlink or already absent.
 *
 * Sync writes symlinks; a real file or directory at a projection path is never
 * agent-skills' to delete. `rm` without `recursive` also throws on a non-empty
 * directory, which is how a stale plan crashed mid-apply (findings #2, #13,
 * #17). Refusing to touch real entries removes both hazards at once.
 *
 * @returns `true` when the path is now clear to write, `false` when a real
 * entry must be left untouched
 */
async function removeIfOwnedLink(
	path: string,
	managedTargets: readonly string[],
): Promise<boolean> {
	let stats: Awaited<ReturnType<typeof lstat>>;
	try {
		stats = await lstat(path);
	} catch {
		return true; // absent: clear to write
	}
	if (!stats.isSymbolicLink()) return false; // real entry: not ours
	let target: string | undefined;
	try {
		target = await realpath(path);
	} catch {
		target = await danglingLinkTarget(path);
		if (target === undefined) return true; // vanished after lstat
	}
	if (!isManagedTarget(managedTargets, target)) return false;
	try {
		await rm(path, { force: true });
	} catch {
		return false;
	}
	return true;
}

function isManagedTarget(managedTargets: readonly string[], target: string): boolean {
	return managedTargets.some(
		(root) => isInsideOrEqual(root, target),
	);
}

function isInsideOrEqual(root: string, child: string): boolean {
	return resolve(child) === resolve(root) || isInside(root, child);
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
