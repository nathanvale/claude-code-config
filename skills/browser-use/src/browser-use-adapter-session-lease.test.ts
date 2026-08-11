import { describe, expect, test } from "bun:test";
import {
	deriveSessionName,
	shouldRelease,
} from "./browser-use-adapter-session-lease";
import {
	BROWSER_USE_BLOCKED_RUN_STATES,
	BROWSER_USE_TERMINAL_RUN_STATES,
} from "./browser-use-run-model";

describe("Adapter Session Lease", () => {
	test("derives the session identity from the run id", () => {
		expect(deriveSessionName("run-42")).toBe("browser-use-run-42");
	});

	test("holds the session while the run is running", () => {
		expect(shouldRelease("running")).toBe(false);
	});

	test("holds the session while the run is ready", () => {
		expect(shouldRelease("ready")).toBe(false);
	});

	for (const state of BROWSER_USE_BLOCKED_RUN_STATES) {
		test(`holds the session while the run is ${state}`, () => {
			expect(shouldRelease(state)).toBe(false);
		});
	}

	for (const state of BROWSER_USE_TERMINAL_RUN_STATES) {
		test(`releases the session after the run is ${state}`, () => {
			expect(shouldRelease(state)).toBe(true);
		});
	}

	test("releases the session when no run exists", () => {
		expect(shouldRelease(undefined)).toBe(true);
	});
});
