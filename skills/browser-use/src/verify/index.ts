// SEAM: verify | provisional | pattern: none | deletion-test: remove it -> post-state proof leaks into operation callers
import type { Seam } from "../seam-contract";

/**
 * Verify seam marker.
 *
 * This seam is provisional until post-state proof earns a pattern name through
 * a proof gate.
 *
 * @example
 * ```typescript
 * SEAM.status
 * ```
 */
export const SEAM = {
	name: "verify",
	pattern: null,
	status: "provisional",
	deletionTest: "remove it -> post-state proof leaks into operation callers",
} as const satisfies Seam;
