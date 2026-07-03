/**
 * Package-owned contract id for Warm Chrome browser-entry proof results.
 *
 * The legacy `browser-use.warm-chrome-preflight` contract id stays owned by
 * `skills/browser-use` until the deferred parity switchover; this package
 * versions its results independently.
 *
 * @defaultValue "warm-chrome.browser-entry"
 */
export const WARM_CHROME_CONTRACT_ID = "warm-chrome.browser-entry" as const;

/**
 * Machine schema version for v1 warm-chrome JSON results.
 *
 * @defaultValue "1"
 */
export const WARM_CHROME_SCHEMA_VERSION = "1" as const;

/**
 * Canonical CLI name (bin entry and discovery surface).
 *
 * @defaultValue "warm-chrome"
 */
export const WARM_CHROME_CLI_NAME = "warm-chrome" as const;

/**
 * Public v1 command ids (plan U2 R2).
 *
 * `check` is the agent proof surface (JSON default); `status` is its
 * presentation alias (plain default); `launch` and `repair` are the mutating
 * lifecycles.
 */
export const WARM_CHROME_COMMANDS = [
	"check",
	"status",
	"launch",
	"repair",
] as const;

/**
 * Command id union for facade-backed routing.
 */
export type WarmChromeCommand = (typeof WARM_CHROME_COMMANDS)[number];

/**
 * Package-owned exit code for browser-entry failure (plan U2 R3).
 *
 * Baseline semantics stay facade-owned: 0 ok, 1 runtime failure, 2 invalid
 * usage. 20 is the browser-entry handoff and never means adapter fallback.
 *
 * @defaultValue "20"
 */
export const WARM_CHROME_BROWSER_ENTRY_EXIT_CODE = "20" as const;

/**
 * Stable failure runtime-action ids (plan U2 R12 surface).
 *
 * Order is the discovery order agents read; ids are the
 * `continuation.next_action_id` vocabulary the U4+ envelopes emit.
 */
export const WARM_CHROME_FAILURE_ACTION_IDS = [
	"launch_warm_chrome",
	"repair_profile",
	"rerun_with_explicit_port",
	"inspect_listener",
	"inspect_diagnostics",
	"change_input",
] as const;

/**
 * Failure runtime-action id union.
 */
export type WarmChromeFailureActionId =
	(typeof WARM_CHROME_FAILURE_ACTION_IDS)[number];

/**
 * Stable success runtime-action ids (plan U2 R12 surface).
 */
export const WARM_CHROME_SUCCESS_ACTION_IDS = ["use_verified_endpoint"] as const;

/**
 * Success runtime-action id union.
 */
export type WarmChromeSuccessActionId =
	(typeof WARM_CHROME_SUCCESS_ACTION_IDS)[number];

/**
 * Runtime-action id union across failure and success groups.
 */
export type WarmChromeRuntimeActionId =
	| WarmChromeFailureActionId
	| WarmChromeSuccessActionId;

/**
 * Continuation constraint id every exit-20 envelope carries (plan U2 R12).
 *
 * U4 emits the envelope; this constant anchors the stable literal so contract,
 * runtime, and tests agree on one spelling.
 *
 * @defaultValue "no_adapter_fallback"
 */
export const WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID =
	"no_adapter_fallback" as const;
