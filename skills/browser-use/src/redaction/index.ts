// SEAM: redaction | provisional | pattern: none | deletion-test: remove it -> privacy release rules become optional caller discipline
import type { Seam } from "../seam-contract";

/**
 * Redaction seam marker.
 *
 * This seam is provisional until privacy-boundary mechanics earn a pattern name
 * through a proof gate.
 *
 * @example
 * ```typescript
 * SEAM.pattern
 * ```
 */
export const SEAM = {
	name: "redaction",
	pattern: null,
	status: "provisional",
	deletionTest:
		"remove it -> privacy release rules become optional caller discipline",
} as const satisfies Seam;
