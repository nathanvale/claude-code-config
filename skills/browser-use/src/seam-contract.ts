/**
 * Ordered seam names for the browser-use architecture scaffold.
 *
 * The order mirrors the dependency direction: facade at the top, core as
 * the leaf. Plan 2 migrates behavior into these seams after the scaffold.
 *
 * @example
 * ```typescript
 * for (const seam of SEAM_NAMES) console.log(seam)
 * ```
 */
export const SEAM_NAMES = [
	"facade",
	"adapter",
	"oracle",
	"router",
	"perception",
	"verify",
	"redaction",
	"core",
] as const;

/**
 * Browser-use seam name.
 *
 * Names are architecture lookup handles, not CLI front doors.
 */
export type SeamName = (typeof SEAM_NAMES)[number];

/**
 * Promotion status for a seam's pattern name.
 *
 * - `earned` -- backed by the GoF naming decision log or equivalent proof.
 * - `provisional` -- scaffolded as an ICA seam with no earned pattern name yet.
 */
export type SeamStatus = "earned" | "provisional";

/**
 * Machine-readable marker exported by each seam entry file.
 *
 * The matching header comment gives LLMs the same status and deletion test
 * before they read code; tests keep the two surfaces aligned.
 *
 * @example
 * ```typescript
 * export const SEAM = {
 *   name: "core",
 *   pattern: null,
 *   status: "provisional",
 *   deletionTest: "remove it -> shared leaf symbols drift upward",
 * } as const satisfies Seam
 * ```
 */
export type Seam = {
	/** Directory name under `src/`. */
	name: SeamName;
	/** Earned pattern or locality label; null while provisional. */
	pattern: string | null;
	/** Whether the pattern name is earned by evidence. */
	status: SeamStatus;
	/** Consequence when the seam is deleted. */
	deletionTest: string;
};

/**
 * Allowed seam-to-seam import direction.
 *
 * Facade can depend on every lower seam. Middle seams can depend on core.
 * Core is the keystone leaf and imports no internal seam.
 *
 * @example
 * ```typescript
 * SEAM_DIRECTION.facade.includes("core") // true
 * SEAM_DIRECTION.core.length // 0
 * ```
 */
export const SEAM_DIRECTION = {
	facade: ["adapter", "oracle", "router", "perception", "verify", "redaction", "core"],
	adapter: ["core"],
	oracle: ["core"],
	router: ["core"],
	perception: ["core"],
	verify: ["core"],
	redaction: ["core"],
	core: [],
} as const satisfies Record<SeamName, readonly SeamName[]>;
