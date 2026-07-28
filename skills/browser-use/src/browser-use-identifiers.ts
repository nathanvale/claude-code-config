// ---------------------------------------------------------------------------
// Bounded-identifier safety guards (single owner).
//
// Run and tab identities travel into spawn argv (session names, tab selectors)
// and into evidence-id hashing. They must be constrained to a small, quoting-
// safe alphabet so a crafted identity can never inject an argument, a path
// segment, or a shell metacharacter at a process boundary. This regex is that
// contract; every discovery, task, and sensitive-run surface imports it here so
// the alphabet cannot drift between copies (a tightened owner used to leave a
// stale hand-copied guard behind).
// ---------------------------------------------------------------------------

/** A bounded, argv- and path-safe run identifier: letters, digits, dot,
 *  underscore, dash; 1–128 chars. Anchored — no partial matches. */
export const SAFE_RUN_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** A bounded, argv-safe tab identifier. Same alphabet and bound as
 *  {@link SAFE_RUN_ID}: both flow into the adapter argv as opaque tokens. */
export const SAFE_TAB_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** A stable batch-item key shared by planning, execution, and durable state. */
export const SAFE_BATCH_ITEM_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/;
