// SEAM: oracle | earned | pattern: N-version programming | deletion-test: remove it -> lose the disagreement signal that is the product moat
import type { Seam } from "../seam-contract";

/**
 * Differential Oracle seam marker.
 *
 * N-version programming is earned because independent Browser Adapters
 * re-derive one state and expose consensus, confidence, and divergence.
 *
 * @example
 * ```typescript
 * SEAM.pattern
 * ```
 */
export const SEAM = {
	name: "oracle",
	pattern: "N-version programming",
	status: "earned",
	deletionTest:
		"remove it -> lose the disagreement signal that is the product moat",
} as const satisfies Seam;
