import { describe, expect, test } from "bun:test";

import { createNativeRuntime } from "../app/native-runtime.ts";
import {
	type LaunchChromeInput,
	REAL_GOOGLE_CHROME_BINARY,
} from "../src/runtime.ts";

const INPUT: LaunchChromeInput = {
	chromeBin: REAL_GOOGLE_CHROME_BINARY,
	port: "9242",
	profileDir:
		"/Users/warm/Library/Application Support/Agent Chrome/Chrome User Data",
	profileDirectory: "Default",
	startupUrl: "https://example.com/",
};

describe("Agent Chrome native runtime", () => {
	test("Launch Services pid becomes race authority and an unrelated reused pid is never terminated", async () => {
		const observed: LaunchChromeInput[] = [];
		const runtime = createNativeRuntime({
			launchChrome: async (input) => {
				observed.push(input);
				return process.pid;
			},
		});

		const launched = await runtime.spawnChrome(INPUT);
		expect(observed).toEqual([INPUT]);
		expect(launched.pid).toBe(process.pid);
		expect(await launched.kill()).toBe(false);
		expect(runtime.isProcessAlive(process.pid)).resolves.toBe(true);
	});
});
