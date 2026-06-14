// SEAM: router | earned | pattern: evidence-first selection | deletion-test: remove it -> engines route on unproven manifests and false capability claims
import type { Seam } from "../seam-contract";

/**
 * Browser Adapter Router seam marker.
 *
 * Evidence-first selection is earned by the admission gate: proof and
 * capability evidence are required before an adapter can be selected.
 *
 * @example
 * ```typescript
 * SEAM.status
 * ```
 */
export const SEAM = {
	name: "router",
	pattern: "evidence-first selection",
	status: "earned",
	deletionTest:
		"remove it -> engines route on unproven manifests and false capability claims",
} as const satisfies Seam;
