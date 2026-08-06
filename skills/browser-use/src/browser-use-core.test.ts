import { describe, expect, test } from "bun:test";
import {
	redactUnsafeText,
	stringField,
	truncateText,
} from "./browser-use-core";
import {
	browserUseOperationFailureActions,
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
	test("the rerun_handoff_bound_target_discovery continuation shared by selection and operation has one summary", () => {
		// command-contract declares this id shared across the selection and
		// operation failure surfaces with an identical summary (the other shared
		// ids carry deliberately per-surface prose: "re-run targets select" vs
		// "re-run browser-use operate"). The arrays build into separate Maps per
		// surface, so nothing fails at runtime if they drift — guard it here.
		// Assert presence in BOTH arrays first so the equality check can never
		// pass vacuously if the id is renamed or dropped on one side.
		const sharedId = "rerun_handoff_bound_target_discovery";
		const selection = browserUseTargetSelectionFailureActions.find(
			(action) => action.id === sharedId,
		);
		const operation = browserUseOperationFailureActions.find(
			(action) => action.id === sharedId,
		);
		expect(selection).toBeDefined();
		expect(operation).toBeDefined();
		expect(operation?.summary as string).toBe(selection?.summary as string);
	});
});
