import {
	AGENT_WORKTREE_REF_KINDS,
	type AgentWorktreeRef,
	type AgentWorktreeRefKind,
	type AgentWorktreeSeam,
} from "./model.ts";
import {
	type AgentWorktreeStore,
	createFileStore,
} from "./store.ts";
import { normalizeProjectionOptions, summarizeProjection } from "./projection.ts";

/**
 * Resolved store target for an inspectable ref.
 *
 * The relative path is intentionally store-local. Runtime code decides the
 * absolute main-owner `.agent-worktree/` root.
 */
export interface InspectableRefResolution {
	/** Parsed typed ref. */
	ref: AgentWorktreeRef;
	/** Store subdirectory that owns the ref family. */
	storeDir: "worktrees" | "runs" | "failures";
	/** Store-local JSON path for the ref. */
	relativePath: string;
}

/**
 * Inspect command result.
 *
 * @example
 * ```typescript
 * const result: InspectResult = { ref: { kind: "run", id: "abc" }, found: true, record: {} }
 * ```
 */
export interface InspectResult {
	/** Parsed ref. */
	ref: AgentWorktreeRef;
	/** True when a durable record exists. */
	found: boolean;
	/** Store-local path inspected. */
	relativePath: string;
	/** Durable record, when found. */
	record?: unknown;
	/** Safe next actions. */
	nextSafeActions: readonly string[];
}

/**
 * Handoff snapshot result.
 *
 * @example
 * ```typescript
 * const snapshot: HandoffSnapshot = { storeRoot: "/repo/.agent-worktree", latest: [] }
 * ```
 */
export interface HandoffSnapshot {
	/** Store root inspected. */
	storeRoot: string;
	/** Compact latest durable context. */
	latest: readonly unknown[];
	/** Total durable records available before projection. */
	total: number;
	/** True when projection omitted durable records. */
	truncated: boolean;
	/** Safe next actions. */
	nextSafeActions: readonly string[];
}

/**
 * Parse a typed agent-worktree ref.
 *
 * @param value - Raw ref string, such as `failure:run-1/delete_branch`
 * @returns Parsed ref, or null when the string is not a supported typed ref
 *
 * @example
 * ```typescript
 * const ref = parseAgentWorktreeRef("run:abc123")
 * ```
 */
export function parseAgentWorktreeRef(value: string): AgentWorktreeRef | null {
	const separatorIndex = value.indexOf(":");
	if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null;
	const kind = value.slice(0, separatorIndex);
	const id = value.slice(separatorIndex + 1);
	if (!isAgentWorktreeRefKind(kind)) return null;
	if (id.trim().length === 0 || id.includes("..")) return null;
	return { kind, id };
}

/**
 * Resolve a parsed ref to its owning store path.
 *
 * @param ref - Parsed typed ref
 * @returns Store-local resolution for inspect and handoff reads
 *
 * @example
 * ```typescript
 * const resolution = resolveInspectableRef({ kind: "failure", id: "run-1/delete" })
 * ```
 */
export function resolveInspectableRef(
	ref: AgentWorktreeRef,
): InspectableRefResolution {
	const storeDir = storeDirForRefKind(ref.kind);
	return {
		ref,
		storeDir,
		relativePath: `${storeDir}/${ref.id}.json`,
	};
}

/**
 * Inspect a typed ref from a store.
 *
 * @param store - Durable store port
 * @param value - Raw typed ref string
 * @returns Inspect result, or null for unsupported ref syntax
 *
 * @example
 * ```typescript
 * const inspected = await inspectRef(createFileStore("/repo/.agent-worktree"), "run:abc")
 * ```
 */
export async function inspectRef(
	store: AgentWorktreeStore,
	value: string,
): Promise<InspectResult | null> {
	const ref = parseAgentWorktreeRef(value);
	if (!ref) return null;
	const resolution = resolveInspectableRef(ref);
	const record = await readStoreRecord(store, ref);
	return {
		ref,
		found: record !== null,
		relativePath: resolution.relativePath,
		...(record !== null ? { record } : {}),
		nextSafeActions: record === null ? ["doctor"] : ["doctor", "handoff"],
	};
}

/**
 * Build a read-only handoff snapshot from durable store context.
 *
 * @param storeRoot - Main-owner `.agent-worktree` root
 * @returns Handoff snapshot
 *
 * @example
 * ```typescript
 * const snapshot = await buildHandoffSnapshot("/repo/.agent-worktree")
 * ```
 */
export async function buildHandoffSnapshot(
	storeRoot: string,
	options: { limit?: number } = {},
): Promise<HandoffSnapshot> {
	const projection = normalizeProjectionOptions({ limit: options.limit });
	const store = createFileStore(storeRoot);
	const [runs, failures, worktrees] = await Promise.all([
		store.listRuns(),
		store.listFailures(),
		store.listWorktrees(),
	]);
	const runObservedAt = new Map(
		runs.map((record) => [record.runId, record.createdAtMs ?? 0]),
	);
	const latest = [
		...runs.map((record) => ({
			kind: "run",
			ref: { kind: "run", id: record.runId },
			observedAtMs: record.createdAtMs ?? 0,
			record,
		})),
		...failures.map((record) => ({
			kind: "failure",
			ref: record.ref,
			observedAtMs: runObservedAt.get(record.runId) ?? 0,
			record,
		})),
		...worktrees.map((record) => ({
			kind: "worktree",
			ref: record.ref,
			observedAtMs: record.observedAtMs,
			record,
		})),
	].sort((left, right) => right.observedAtMs - left.observedAtMs);
	const projectionSummary = summarizeProjection(latest.length, projection.limit);
	return {
		storeRoot,
		latest: latest.slice(0, projection.limit),
		total: projectionSummary.total,
		truncated: projectionSummary.truncated,
		nextSafeActions: ["doctor", "inspect"],
	};
}

/**
 * Create a file store and inspect a ref.
 *
 * @param storeRoot - Main-owner `.agent-worktree` root
 * @param value - Raw typed ref
 * @returns Inspect result, or null for unsupported ref syntax
 *
 * @example
 * ```typescript
 * const inspected = await inspectRefFromRoot("/repo/.agent-worktree", "failure:run/step")
 * ```
 */
export function inspectRefFromRoot(
	storeRoot: string,
	value: string,
): Promise<InspectResult | null> {
	return inspectRef(createFileStore(storeRoot), value);
}

function isAgentWorktreeRefKind(value: string): value is AgentWorktreeRefKind {
	return AGENT_WORKTREE_REF_KINDS.includes(value as AgentWorktreeRefKind);
}

function storeDirForRefKind(
	kind: AgentWorktreeRefKind,
): InspectableRefResolution["storeDir"] {
	switch (kind) {
		case "worktree":
			return "worktrees";
		case "run":
			return "runs";
		case "failure":
			return "failures";
	}
}

function readStoreRecord(
	store: AgentWorktreeStore,
	ref: AgentWorktreeRef,
): Promise<unknown | null> {
	switch (ref.kind) {
		case "worktree":
			return store.readWorktree(ref.id);
		case "run":
			return store.readRun(ref.id);
		case "failure":
			return store.readFailure(ref.id);
	}
}

/**
 * Scaffold shell: inspect owns typed-ref lookup and handoff snapshots.
 *
 * Status: earned.
 * Deletion test: deleting this seam removes the read path for durable recovery
 * refs after partial mutation failures.
 */
export const INSPECT_SEAM = {
	id: "inspect",
	ownerPath: "runtime/agent-worktree/src/inspect.ts",
	status: "earned",
	deletionTest:
		"Deleting inspect removes the read path for typed refs after partial failures.",
	nextUnit: "U6",
} as const satisfies AgentWorktreeSeam;
