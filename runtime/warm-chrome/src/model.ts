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
 * Dedicated profile path used when a mutating lifecycle needs a profile target.
 *
 * `check` does not inject this default; launch and repair apply it only when
 * they must create or repair local Warm Chrome profile state.
 *
 * @defaultValue "~/.agent-warm-profile"
 */
export const WARM_CHROME_DEFAULT_PROFILE_DIR = "~/.agent-warm-profile" as const;

/**
 * Default CDP port when neither `--port`/`--endpoint` nor `WARM_CHROME_CDP_PORT`
 * is supplied.
 *
 * Deliberately NOT 9222: the 9222 DevTools convention is the most collision-prone
 * port on a developer machine (real Chrome, Chrome for Testing, and stale
 * sessions all gravitate to it), so a 9222 default makes the agent path refuse
 * `foreign_listener` whenever anything else holds it. This dedicated port sits in
 * the agent suggested-port window (`WARM_CHROME_SUGGESTED_PORT_WINDOW`, 9223-9299)
 * and pairs with the dedicated `WARM_CHROME_DEFAULT_PROFILE_DIR`. Explicit
 * `--port 9222` / `WARM_CHROME_CDP_PORT=9222` still works for anyone who wants it.
 *
 * @defaultValue "9242"
 */
export const WARM_CHROME_DEFAULT_CDP_PORT = "9242" as const;

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

/**
 * Closed reason-detail union for the `check` proof chain (plan U5 R5).
 *
 * One station carries one canonical error code; fine-grained cause lives in
 * the machine-readable `data.reason` field, never in the error code. The
 * union is package-owned and closed: a new reason lands here first and a
 * station test pins it before the runtime may emit it.
 */
export const WARM_CHROME_CHECK_REASONS = {
	endpoint_unreachable: [
		"no_listener",
		"pipe_only_no_tcp",
		"attach_timeout",
		"probe_unavailable",
	],
	non_loopback: [
		"localhost_alias",
		"non_loopback_endpoint",
		"non_loopback_websocket",
	],
	invalid_cdp: [
		"malformed_json_version",
		"ws_only_no_http",
		"cdp_contention",
		"roundtrip_failed",
	],
	port_occupied_foreign: [
		"foreign_listener",
		"json_answers_on_default_profile",
		"listener_uninspectable",
	],
	wrong_browser: [
		"headless_not_headed",
		"chrome_for_testing",
		"chromium",
		"electron_or_other",
		"isolated_context",
	],
	unsafe_profile: [
		"default_profile",
		"throwaway_profile",
		"unsafe_profile_permissions",
		"invalid_profile_path",
		"profile_dir_remap",
	],
	listener_mismatch: [
		"port_mismatch",
		"profile_mismatch",
		"listener_missing",
		"pid_mismatch",
	],
} as const;

/**
 * Canonical check-station error code union (the exit-20 check verdicts).
 */
export type WarmChromeCheckErrorCode = keyof typeof WARM_CHROME_CHECK_REASONS;

/**
 * Closed reason-detail union across every check error code.
 */
export type WarmChromeCheckReason =
	(typeof WARM_CHROME_CHECK_REASONS)[WarmChromeCheckErrorCode][number];

/**
 * Closed repair-owned reason union for the `unrepairable` station.
 *
 * Profile-only reasons stay neutral enough for facade-projected envelopes;
 * human output owns Chrome preference names and saved-login wording.
 */
export const WARM_CHROME_REPAIR_REASONS = {
	unrepairable: [
		"foreign_listener_on_port",
		"profile_not_owned",
		"profile_mismatch",
		"profile_dir_uncreatable",
		"profile_permissions_unrepairable",
		"devtools_active_port_symlink",
		"devtools_active_port_unwritable",
		"profile_path_noncanonical",
		"profile_path_symlink",
		"profile_path_invalid",
		"profile_path_uninspectable",
		"profile_locked",
		"profile_login_data_present",
		"profile_preferences_unreadable",
		"profile_preferences_too_large",
		"profile_preferences_unwritable",
	] as const,
} as const;

/** Repair-owned reason detail emitted under `repair.unrepairable`. */
export type WarmChromeRepairReason =
	(typeof WARM_CHROME_REPAIR_REASONS.unrepairable)[number];

/**
 * Cross-tool-visible repair mutation ids.
 *
 * Each id pins one observable profile mutation reported with its exact path.
 */
export const WARM_CHROME_REPAIR_ACTION_IDS = [
	"profile_dir_created",
	"profile_permissions",
	"devtools_active_port",
	"profile_preferences",
] as const;

/** Repair mutation id reported by the `repair.repaired` result. */
export type WarmChromeRepairActionId =
	(typeof WARM_CHROME_REPAIR_ACTION_IDS)[number];

/** JSON object shape accepted for Chrome preference traversal. */
export type JsonObject = Record<string, unknown>;

/**
 * Narrow unknown JSON values to non-null, non-array objects.
 *
 * @param value - Parsed JSON value to inspect
 * @returns Whether the value is a JSON object
 *
 * @example
 * ```typescript
 * const value: unknown = JSON.parse('{"enabled":true}')
 * if (isJsonObject(value)) console.log(value.enabled)
 * ```
 */
export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
