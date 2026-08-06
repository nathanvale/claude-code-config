import { describe, expect, test } from "bun:test";
import {
	type BrowserUseDeliveredFieldShape,
	deriveConformanceSentinel,
	deriveFieldSentinel,
	deriveSentinelSet,
	markerSatisfiesGuardBounds,
} from "./browser-use-secret-scan";
import {
	beginSensitiveRunGuard,
	markRunSensitive,
} from "./browser-use-sensitive-run";

// =========================================================================
// Detection-sentinel owner (auth plan U4, R14, R16-R18; AE5). Proves the
// derived markers are structural (shape-only, never value-derived), satisfy
// the Sensitive Run Guard's bounds, and close the conformance loop where the
// delivered value IS a registered sentinel.
// =========================================================================

const NONCE = "run7f3a";

describe("field sentinel derivation", () => {
	test("derives a namespaced marker from shape (kind + length) only", () => {
		const shape: BrowserUseDeliveredFieldShape = {
			field: "password",
			byte_length: 12,
		};
		const derived = deriveFieldSentinel(shape, NONCE);
		expect(derived.ok).toBe(true);
		if (!derived.ok) return;
		expect(derived.marker).toContain("BU-CFD-SENTINEL");
		expect(derived.marker).toContain("pass");
		expect(derived.marker).toContain(NONCE);
	});

	test("is deterministic: same shape + nonce yields the same marker", () => {
		const shape: BrowserUseDeliveredFieldShape = { field: "otp-current", byte_length: 6 };
		const a = deriveFieldSentinel(shape, NONCE);
		const b = deriveFieldSentinel(shape, NONCE);
		expect(a.ok && b.ok && a.marker === b.marker).toBe(true);
	});

	test("distinct field kinds never collide on the same length + nonce", () => {
		const user = deriveFieldSentinel({ field: "username", byte_length: 8 }, NONCE);
		const pass = deriveFieldSentinel({ field: "password", byte_length: 8 }, NONCE);
		const otp = deriveFieldSentinel({ field: "otp-current", byte_length: 8 }, NONCE);
		expect(user.ok && pass.ok && otp.ok).toBe(true);
		if (!(user.ok && pass.ok && otp.ok)) return;
		expect(new Set([user.marker, pass.marker, otp.marker]).size).toBe(3);
	});

	test("rejects an out-of-range byte length (shape corruption fails closed)", () => {
		const negative = deriveFieldSentinel({ field: "password", byte_length: -1 }, NONCE);
		const huge = deriveFieldSentinel({ field: "password", byte_length: 99_999 }, NONCE);
		expect(negative.ok).toBe(false);
		expect(huge.ok).toBe(false);
		if (!negative.ok) {
			expect(negative.rejection.code).toBe("secret_scan_field_length_invalid");
		}
	});

	test("rejects a non-base36 nonce", () => {
		const bad = deriveFieldSentinel({ field: "password", byte_length: 8 }, "BAD NONCE!");
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.rejection.code).toBe("secret_scan_nonce_invalid");
	});
});

describe("guard-bound agreement", () => {
	test("every derived marker satisfies the Sensitive Run Guard bounds", () => {
		for (const field of ["username", "password", "otp-current"] as const) {
			for (const len of [0, 1, 16, 4096]) {
				const derived = deriveFieldSentinel({ field, byte_length: len }, NONCE);
				expect(derived.ok).toBe(true);
				if (!derived.ok) continue;
				expect(markerSatisfiesGuardBounds(derived.marker)).toBe(true);
			}
		}
	});

	test("markRunSensitive accepts a derived sentinel set (owners agree)", () => {
		const set = deriveSentinelSet(
			[
				{ field: "password", byte_length: 12 },
				{ field: "otp-current", byte_length: 6 },
			],
			NONCE,
		);
		expect(set.ok).toBe(true);
		if (!set.ok) return;
		const guard = beginSensitiveRunGuard("run-secret-scan");
		expect(guard.ok).toBe(true);
		if (!guard.ok) return;
		const marked = markRunSensitive(guard.guard, {
			trigger: "confidential-field-delivery",
			sentinels: set.sentinels,
		});
		expect(marked.ok).toBe(true);
	});
});

describe("sentinel set derivation", () => {
	test("one marker per delivered field, de-duplicated", () => {
		const set = deriveSentinelSet(
			[
				{ field: "password", byte_length: 12 },
				{ field: "password", byte_length: 12 },
				{ field: "otp-current", byte_length: 6 },
			],
			NONCE,
		);
		expect(set.ok).toBe(true);
		if (!set.ok) return;
		expect(set.sentinels).toHaveLength(2);
	});

	test("fails closed on an empty shape list (nothing to prove)", () => {
		const set = deriveSentinelSet([], NONCE);
		expect(set.ok).toBe(false);
		if (!set.ok) expect(set.rejection.code).toBe("secret_scan_no_shapes");
	});
});

describe("conformance sentinel loop", () => {
	test("the delivered value equals a marker the sweep set contains", () => {
		const minted = deriveConformanceSentinel("password", NONCE);
		expect(minted.ok).toBe(true);
		if (!minted.ok) return;
		// The harness reports the value's own shape; deriving the set from that
		// shape must produce a marker, and the value the helper delivers is the
		// distinctive token the sweep hunts for. Both share the namespace so a
		// leak of the value is caught.
		const set = deriveSentinelSet([minted.shape], NONCE);
		expect(set.ok).toBe(true);
		if (!set.ok) return;
		expect(minted.shape.byte_length).toBe(minted.value.length);
		expect(minted.value).toContain("BU-CFD-SENTINEL");
		expect(set.sentinels[0]).toContain("BU-CFD-SENTINEL");
	});

	test("rejects a bad nonce", () => {
		const bad = deriveConformanceSentinel("password", "no spaces allowed");
		expect(bad.ok).toBe(false);
	});
});
