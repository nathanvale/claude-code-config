// SEAM: perception | provisional | pattern: none | deletion-test: remove it -> observation kinds smear across callers before the proof gate names the seam
import type { Seam } from "../seam-contract";

/**
 * Perception seam marker.
 *
 * This seam is provisional until observation modes earn a pattern name through
 * a proof gate.
 *
 * @example
 * ```typescript
 * SEAM.pattern
 * ```
 */
export const SEAM = {
	name: "perception",
	pattern: null,
	status: "provisional",
	deletionTest:
		"remove it -> observation kinds smear across callers before the proof gate names the seam",
} as const satisfies Seam;
