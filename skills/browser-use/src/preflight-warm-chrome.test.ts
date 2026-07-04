// The front door is a thin delegator to @side-quest/warm-chrome; the package's
// own station/proof suites (runtime/warm-chrome/tests) own proof behavior. The
// one seam that lives here is the BROWSER_USE_* -> WARM_CHROME_* env bridge that
// preserves browser-use's public env contract and run-id correlation. These
// tests pin that bridge (the coverage the old implementation's test file held
// for the env inputs), driven against an isolated env map, never process.env.
import { describe, expect, test } from "bun:test";

import { bridgeWarmChromeEnv } from "./preflight-warm-chrome";

describe("preflight-warm-chrome env bridge", () => {
	test("BROWSER_USE_* fills the package var when WARM_CHROME_* is unset", () => {
		const env: Record<string, string | undefined> = {
			BROWSER_USE_CDP_PORT: "9250",
			BROWSER_USE_PROFILE_DIR: "/Users/warm/.agent-warm-profile",
			BROWSER_USE_RUN_ID: "abc",
		};
		bridgeWarmChromeEnv(env);
		expect(env.WARM_CHROME_CDP_PORT).toBe("9250");
		expect(env.WARM_CHROME_PROFILE_DIR).toBe("/Users/warm/.agent-warm-profile");
		expect(env.WARM_CHROME_RUN_ID).toBe("abc");
	});

	test("explicit WARM_CHROME_* wins over BROWSER_USE_* (precedence)", () => {
		const env: Record<string, string | undefined> = {
			WARM_CHROME_CDP_PORT: "9260",
			BROWSER_USE_CDP_PORT: "9250",
		};
		bridgeWarmChromeEnv(env);
		expect(env.WARM_CHROME_CDP_PORT).toBe("9260");
	});

	test("neither var set injects no key, leaving package defaults to apply", () => {
		const env: Record<string, string | undefined> = {};
		bridgeWarmChromeEnv(env);
		expect("WARM_CHROME_CDP_PORT" in env).toBe(false);
		expect("WARM_CHROME_PROFILE_DIR" in env).toBe(false);
		expect("WARM_CHROME_RUN_ID" in env).toBe(false);
	});

	test("run-id correlation: BROWSER_USE_RUN_ID surfaces as WARM_CHROME_RUN_ID", () => {
		const env: Record<string, string | undefined> = { BROWSER_USE_RUN_ID: "run-42" };
		bridgeWarmChromeEnv(env);
		expect(env.WARM_CHROME_RUN_ID).toBe("run-42");
	});

	test("returns the same env reference it mutated", () => {
		const env: Record<string, string | undefined> = { BROWSER_USE_CDP_PORT: "9299" };
		expect(bridgeWarmChromeEnv(env)).toBe(env);
	});
});
