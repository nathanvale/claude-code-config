import { describe, expect, test } from "bun:test";
import {
	redactUnsafeText,
	stringField,
	truncateText,
} from "./browser-use-core";
import {
	browserUseTargetDiscoveryFailureActions,
	browserUseTargetSelectionFailureActions,
} from "./command-contract";

// =========================================================================
// Shared substrate (core leaf)
// =========================================================================
//
// Direct coverage for assertions the U-block suites only made incidentally:
// the pure substrate functions below, plus the action-id drift guard over the
// command-contract action arrays (no CLI driver), which lives here because it
// is substrate-level rather than driver-level (plan U14).

describe("core substrate — pure functions", () => {
	test("stringField returns strings and rejects non-strings", () => {
		expect(stringField("hello")).toBe("hello");
		expect(stringField(42)).toBeUndefined();
		expect(stringField(null)).toBeUndefined();
		expect(stringField(undefined)).toBeUndefined();
	});

	test("truncateText caps length with an ellipsis and leaves short input intact", () => {
		expect(truncateText("short", 120)).toBe("short");
		const long = "x".repeat(200);
		const capped = truncateText(long, 120);
		expect(capped.length).toBeLessThanOrEqual(120);
		expect(capped.endsWith("…")).toBe(true);
	});

	test("redactUnsafeText redacts op:// refs, sensitive flags, and filesystem paths (R32)", () => {
		expect(redactUnsafeText("token op://vault/item here")).toBe(
			"token [redacted] here",
		);
		expect(redactUnsafeText("read /Users/me/secret.txt")).toBe(
			"read [redacted]",
		);
		expect(redactUnsafeText("run --headed --json")).toBe("run --headed --json");
	});
});

describe("core substrate", () => {
	test("a runtime action id shared across discovery and selection has one summary", () => {
		// A continuation id declared in both action arrays (e.g. a shared recovery
		// id) builds into separate Maps per surface, so nothing fails at runtime if
		// they drift — guard here that one continuation id never documents two
		// different recovery strings.
		const discovery = new Map<string, string>(
			browserUseTargetDiscoveryFailureActions.map((a) => [a.id, a.summary]),
		);
		for (const action of browserUseTargetSelectionFailureActions) {
			const shared = discovery.get(action.id);
			if (shared !== undefined) {
				expect(action.summary as string).toBe(shared);
			}
		}
	});
});
