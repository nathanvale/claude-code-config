import type { AgentWorktreeSeam } from "./model.ts";

/**
 * Output projection modes for context-heavy reads.
 */
export const PROJECTION_MODES = ["summary", "detail"] as const;

/**
 * Output projection mode.
 */
export type ProjectionMode = (typeof PROJECTION_MODES)[number];

/**
 * Named field sets for future read-command density controls.
 *
 * reserved: v2 --fields projection for doctor, list, status, and handoff.
 */
export const PROJECTION_FIELD_SETS = [
	"default",
	"refs",
	"evidence",
	"actions",
] as const;

/**
 * Projection field-set name.
 */
export type ProjectionFieldSet = (typeof PROJECTION_FIELD_SETS)[number];

/**
 * Default result limits by projection mode.
 *
 * Summary mode stays small for agent context. Detail mode permits more records
 * but still gives commands a bounded default.
 */
export const DEFAULT_PROJECTION_LIMITS = {
	summary: 20,
	detail: 100,
} as const satisfies Record<ProjectionMode, number>;

/**
 * Projection options accepted by read-heavy command handlers.
 *
 * @example
 * ```typescript
 * const options: ProjectionOptions = { mode: "summary", fields: ["refs"] }
 * ```
 */
export interface ProjectionOptions {
	/** Output density. */
	mode: ProjectionMode;
	/** Maximum number of records returned by a collection command. */
	limit: number;
	/** reserved: v2 --fields field groups. */
	fields: readonly ProjectionFieldSet[];
}

/**
 * Metadata that tells agents whether bounded output hid records.
 *
 * @example
 * ```typescript
 * const summary = summarizeProjection(42, 20)
 * ```
 */
export interface ProjectionSummary {
	/** Total records available before slicing. */
	total: number;
	/** Limit applied to the projected output. */
	limit: number;
	/** True when records were omitted by the projection limit. */
	truncated: boolean;
}

/**
 * Normalize projection options for bounded output.
 *
 * @param input - Partial caller options
 * @returns Projection options with a mode, limit, and deduplicated field set
 *
 * @example
 * ```typescript
 * const options = normalizeProjectionOptions({ mode: "detail", limit: 500 })
 * ```
 */
export function normalizeProjectionOptions(
	input: Partial<ProjectionOptions> = {},
): ProjectionOptions {
	const mode =
		input.mode ??
		(input.limit && input.limit > DEFAULT_PROJECTION_LIMITS.summary
			? "detail"
			: "summary");
	const defaultLimit = DEFAULT_PROJECTION_LIMITS[mode];
	const limit = Math.min(Math.max(input.limit ?? defaultLimit, 1), defaultLimit);
	const defaultFields: readonly ProjectionFieldSet[] = ["default"];
	const fields = [...new Set(input.fields ?? defaultFields)];
	return { mode, limit, fields };
}

/**
 * Summarize bounded output after applying a projection limit.
 *
 * @param total - Number of records available before slicing
 * @param limit - Projection limit applied by the caller
 * @returns Projection metadata for machine-readable results
 *
 * @example
 * ```typescript
 * summarizeProjection(25, 20)
 * ```
 */
export function summarizeProjection(
	total: number,
	limit: number,
): ProjectionSummary {
	return {
		total,
		limit,
		truncated: total > limit,
	};
}

/**
 * Scaffold shell: projection owns bounded output contracts.
 *
 * Status: earned.
 * Deletion test: deleting this seam makes doctor, list, status, and handoff
 * invent separate context-budget controls.
 */
export const PROJECTION_SEAM = {
	id: "projection",
	ownerPath: "runtime/agent-worktree/src/projection.ts",
	status: "earned",
	deletionTest:
		"Deleting projection makes read commands invent separate output-budget controls.",
	nextUnit: "U7",
} as const satisfies AgentWorktreeSeam;
