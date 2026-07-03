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
