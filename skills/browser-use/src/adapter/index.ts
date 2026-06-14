// SEAM: adapter | earned | pattern: Adapter | deletion-test: remove it -> facade reaches only chrome-devtools and N collapses to one
import type { Seam } from "../seam-contract";

/**
 * Browser Adapter seam marker.
 *
 * Adapter is earned by the two-axis mapping from engine-native vocabulary and
 * dispatch shape into the Browser Facade contract.
 *
 * @example
 * ```typescript
 * SEAM.pattern
 * ```
 */
export const SEAM = {
	name: "adapter",
	pattern: "Adapter",
	status: "earned",
	deletionTest:
		"remove it -> facade reaches only chrome-devtools and N collapses to one",
} as const satisfies Seam;
