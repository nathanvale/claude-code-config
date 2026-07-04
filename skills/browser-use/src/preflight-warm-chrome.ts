#!/usr/bin/env bun
// browser-use's Warm Chrome front door. The ~2030-line implementation that once
// lived here now ships in @side-quest/warm-chrome; this file is a thin delegator
// so the `preflight-warm-chrome` bin, its dist entrypoint, and the SKILL step 1
// keep working while the package owns the browser-entry proof (see
// rules/browser-access.md and runtime/warm-chrome/CONTEXT.md).
//
// Two seams the package cannot see live here:
//   1. Env namespace. browser-use's public contract exposes BROWSER_USE_* env
//      vars; the package reads WARM_CHROME_*. This bridge resolves
//      WARM_CHROME_X ?? BROWSER_USE_X for the three inputs the package consumes
//      (CDP_PORT, PROFILE_DIR, RUN_ID), setting a key only when its source is
//      defined so the package's own defaults still apply when neither is set.
//   2. Run-id correlation. The package's main() reads the run id from
//      runtime.env.WARM_CHROME_RUN_ID, but its last-resort unhandled-failure net
//      reads process.env.WARM_CHROME_RUN_ID directly. The bridge writes the
//      resolved values back into process.env so the correlation id survives even
//      the escape path.

import { createDefaultRuntime, main } from "@side-quest/warm-chrome";

/** The three env inputs the package reads, paired with browser-use's public name. */
const WARM_CHROME_ENV_BRIDGE = [
	["WARM_CHROME_CDP_PORT", "BROWSER_USE_CDP_PORT"],
	["WARM_CHROME_PROFILE_DIR", "BROWSER_USE_PROFILE_DIR"],
	["WARM_CHROME_RUN_ID", "BROWSER_USE_RUN_ID"],
] as const;

/**
 * Resolve `WARM_CHROME_X ?? BROWSER_USE_X` for each bridged input, mutating `env`
 * in place so both `main()`'s runtime seam and the package's out-of-seam
 * unhandled-failure net (which reads `process.env` directly) observe the same
 * value. A key is set only when its source is defined, so the package's own
 * defaults still apply when neither var is present.
 *
 * @param env - Mutable environment map (defaults to `process.env`)
 * @returns The same `env` reference, after bridging
 */
export function bridgeWarmChromeEnv(
	env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
	for (const [warmKey, browserUseKey] of WARM_CHROME_ENV_BRIDGE) {
		const resolved = env[warmKey] ?? env[browserUseKey];
		if (resolved !== undefined) env[warmKey] = resolved;
	}
	return env;
}

if (import.meta.main) {
	const runtime = createDefaultRuntime({ env: bridgeWarmChromeEnv() });
	const exitCode = await main(Bun.argv.slice(2), { runtime });
	process.exit(exitCode);
}
