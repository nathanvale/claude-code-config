// SEAM: facade | earned | pattern: Facade | deletion-test: remove it -> caller must name engines and handle five vocabularies
import type { Seam } from "../seam-contract";

/**
 * Browser Facade action-surface seam marker.
 *
 * Facade is earned only for operate, observe, and verify callers that should
 * not name an engine.
 *
 * @example
 * ```typescript
 * SEAM.status
 * ```
 */
export const SEAM = {
	name: "facade",
	pattern: "Facade",
	status: "earned",
	deletionTest:
		"remove it -> caller must name engines and handle five vocabularies",
} as const satisfies Seam;
