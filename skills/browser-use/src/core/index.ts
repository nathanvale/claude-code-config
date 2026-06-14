// SEAM: core | provisional | pattern: none | deletion-test: remove it -> shared leaf symbols climb back into higher seams and cycles return
import type { Seam } from "../seam-contract";

/**
 * Core leaf seam marker.
 *
 * This seam is provisional as a shared leaf; its invariant is import direction,
 * not an earned GoF pattern.
 *
 * @example
 * ```typescript
 * SEAM.name
 * ```
 */
export const SEAM = {
	name: "core",
	pattern: null,
	status: "provisional",
	deletionTest:
		"remove it -> shared leaf symbols climb back into higher seams and cycles return",
} as const satisfies Seam;
