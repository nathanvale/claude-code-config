// ---------------------------------------------------------------------------
// Detection-sentinel owner (auth plan 2026-07-21-003 U4, R14, R16-R18;
// AE5, AE12; release contract R14, AE5).
//
// The Sensitive Run Guard (browser-use-sensitive-run.ts) sweeps every
// governed surface for a set of SENTINELS. This module owns the derivation of
// that set. A sentinel is a DETECTION MARKER, not a secret: it is a synthetic,
// distinctive, length-bounded structural token derived from the SHAPE of a
// delivered field (its field kind and its byte length) and NOTHING else. The
// raw value is never retained, echoed, hashed-into, or otherwise carried
// (R14/R16) — only its length and field kind flow into the derived marker.
//
// Two roles, one owner:
//   * PRODUCTION: the disposable Confidential Field Delivery Helper (R16) is
//     the only component that ever holds raw bytes. It reports back the SHAPE
//     of each field it delivered (kind + length); this module turns those
//     shapes into the sentinel set markRunSensitive registers. The sweep then
//     proves no derived marker appears on any governed surface. (In production
//     the raw bytes and the markers are distinct strings, so a clean sweep is
//     a structural-containment assertion over the marker vocabulary, backed by
//     the design invariant that raw bytes never route to a governed surface.)
//   * CONFORMANCE (AE5 leak harness): the delivery-helper fake is fed the
//     derived sentinels AS its field values, so a leak of a delivered value is
//     literally a leak of a registered sentinel and the disk-backed sweep
//     catches it. `deriveConformanceSentinel` mints those value==sentinel
//     markers deterministically per (field, nonce) so a test drives real bytes
//     equal to what the sweep hunts for.
//
// Pure module: no I/O, no clock, no randomness. Deterministic given inputs.
// ---------------------------------------------------------------------------

import type { BrowserUseOpCredentialField } from "./browser-use-op";

// The guard's sentinel bounds are the contract this owner must satisfy: a
// sentinel too short false-matches ordinary tokens; too long is unusable. These
// mirror browser-use-sensitive-run.ts (MIN_SENTINEL_LENGTH/MAX_SENTINEL_LENGTH)
// intentionally — the derivation must never emit a marker the guard rejects.
// A dedicated assertion (markerSatisfiesGuardBounds) proves membership.
const SENTINEL_MIN_LENGTH = 6;
const SENTINEL_MAX_LENGTH = 4096;

// A fixed, distinctive marker namespace. Every derived sentinel begins with it
// so a match on a governed surface is unambiguous evidence of a delivered-field
// leak rather than a coincidental substring of ordinary run data.
const SENTINEL_NAMESPACE = "BU-CFD-SENTINEL";

// Only base36 [0-9a-z] appears in the shape/nonce segments so a sentinel is a
// single contiguous token with no separators an envelope serializer might
// split. The namespace uses a hyphen deliberately (it is fixed, not derived).
const SAFE_NONCE = /^[0-9a-z]{1,64}$/;

/**
 * The SHAPE of one delivered field, reported by the delivery helper AFTER a
 * bounded field action. It carries the field kind and the byte length only —
 * never the value, never a hash of the value, never any prefix/suffix of it.
 * This is the sole channel by which delivered material informs the sentinel
 * set, and it is structurally incapable of carrying a secret.
 */
export type BrowserUseDeliveredFieldShape = {
	field: BrowserUseOpCredentialField;
	/** Byte length of the delivered value. Bounded and non-secret. */
	byte_length: number;
};

/** Typed derivation rejection: shapes that cannot yield a safe marker. */
export type BrowserUseSecretScanRejection = {
	code:
		| "secret_scan_field_length_invalid"
		| "secret_scan_nonce_invalid"
		| "secret_scan_no_shapes";
	message: string;
};

/** Derivation result: the registered sentinel set, or one typed rejection. */
export type BrowserUseSentinelSetResult =
	| { ok: true; sentinels: readonly string[] }
	| { ok: false; rejection: BrowserUseSecretScanRejection };

// A field's shape maps to a short structural tag so the marker records WHICH
// field kind it stands for without re-encoding the value. otp-current uses
// "otpc" so the three fields never collide on their first tag character.
const FIELD_TAG: Readonly<Record<BrowserUseOpCredentialField, string>> = {
	username: "user",
	password: "pass",
	"otp-current": "otpc",
};

// A delivered field's length is a non-secret structural fact, but an absurd
// length is a shape error, not deliverable material. Cap at the op timeout-era
// field ceiling so a corrupted shape report fails closed.
const MAX_FIELD_BYTE_LENGTH = 4096;

/**
 * Prove a candidate marker sits inside the Sensitive Run Guard's accepted
 * sentinel bounds (SENTINEL_MIN_LENGTH..SENTINEL_MAX_LENGTH). Exported so the
 * unit test can assert the two owners agree without importing private guard
 * constants — a drift in either bound is then a failing test, never a silent
 * runtime rejection when markRunSensitive is called.
 */
export function markerSatisfiesGuardBounds(marker: string): boolean {
	return (
		typeof marker === "string" &&
		marker.length >= SENTINEL_MIN_LENGTH &&
		marker.length <= SENTINEL_MAX_LENGTH
	);
}

/**
 * Derive ONE structural sentinel marker from a delivered field's shape and a
 * bounded run-scoped nonce. The marker encodes only the field tag, the byte
 * length, and the nonce — no value material. Deterministic: the same shape and
 * nonce always yield the same marker, so the delivery helper (production) and
 * the conformance harness derive identical sweep tokens.
 *
 * @param shape - The delivered field's kind and byte length (no value)
 * @param nonce - A bounded run-scoped base36 nonce distinguishing this run
 * @returns The marker string, or one typed rejection
 */
export function deriveFieldSentinel(
	shape: BrowserUseDeliveredFieldShape,
	nonce: string,
):
	| { ok: true; marker: string }
	| { ok: false; rejection: BrowserUseSecretScanRejection } {
	if (
		!Number.isInteger(shape.byte_length) ||
		shape.byte_length < 0 ||
		shape.byte_length > MAX_FIELD_BYTE_LENGTH
	) {
		return {
			ok: false,
			rejection: {
				code: "secret_scan_field_length_invalid",
				message: `delivered ${shape.field} byte length is out of the admitted range.`,
			},
		};
	}
	if (!SAFE_NONCE.test(nonce)) {
		return {
			ok: false,
			rejection: {
				code: "secret_scan_nonce_invalid",
				message: "the run-scoped sentinel nonce must be a bounded base36 token.",
			},
		};
	}
	const tag = FIELD_TAG[shape.field];
	// Namespace + tag + length + nonce. All segments are structural facts; the
	// length is encoded in base36 to stay compact. The namespace alone is 15
	// chars, so the marker always clears SENTINEL_MIN_LENGTH.
	const marker = `${SENTINEL_NAMESPACE}-${tag}-${shape.byte_length.toString(36)}-${nonce}`;
	return { ok: true, marker };
}

/**
 * Derive the full sentinel SET the guard registers for a sensitive run, one
 * marker per delivered field shape. De-duplicates markers (two fields of the
 * same kind and length under the same nonce would collide only if delivered
 * identically, which is safe to fold). Fails closed on an empty shape list —
 * a sensitive run that delivered nothing has no containment to prove, so the
 * caller must not treat an empty set as a guarantee (mirrors the guard's
 * empty-sentinel refusal in markRunSensitive).
 *
 * @param shapes - Every delivered field's shape (kind + byte length)
 * @param nonce - The run-scoped base36 nonce
 * @returns The de-duplicated sentinel set, or one typed rejection
 */
export function deriveSentinelSet(
	shapes: readonly BrowserUseDeliveredFieldShape[],
	nonce: string,
): BrowserUseSentinelSetResult {
	if (shapes.length === 0) {
		return {
			ok: false,
			rejection: {
				code: "secret_scan_no_shapes",
				message:
					"a sensitive run must report at least one delivered field shape to derive sentinels.",
			},
		};
	}
	const seen = new Set<string>();
	const sentinels: string[] = [];
	for (const shape of shapes) {
		const derived = deriveFieldSentinel(shape, nonce);
		if (!derived.ok) return derived;
		if (!seen.has(derived.marker)) {
			seen.add(derived.marker);
			sentinels.push(derived.marker);
		}
	}
	return { ok: true, sentinels };
}

/**
 * Mint ONE conformance sentinel value for a field (AE5 leak harness). The
 * delivery-helper fake is driven with this exact string AS the field value, so
 * that a value leaked onto any governed surface is literally the registered
 * sentinel the sweep hunts for. The returned `value` EQUALS the marker
 * `deriveSentinelSet([shape], nonce)` produces for the returned `shape` — the
 * loop is closed by construction: what is delivered is exactly what is hunted.
 *
 * The value is `deriveFieldSentinel({ field, byte_length: L }, nonce)` where L
 * is that marker's OWN length (a fixpoint: the marker encodes the byte length
 * as a base36 segment, so `byte_length` must equal the marker's length). Length
 * is a structural fact, so this uses no value material — only the field kind and
 * nonce plus the marker's own length. A short fixpoint iteration settles the
 * length because appending a longer base36 segment can grow the marker by at
 * most one character per decimal order of magnitude.
 *
 * @param field - The credential field this stand-in value represents
 * @param nonce - The run-scoped base36 nonce
 * @returns The conformance value plus the shape to report, or a typed rejection
 */
export function deriveConformanceSentinel(
	field: BrowserUseOpCredentialField,
	nonce: string,
):
	| { ok: true; value: string; shape: BrowserUseDeliveredFieldShape }
	| { ok: false; rejection: BrowserUseSecretScanRejection } {
	if (!SAFE_NONCE.test(nonce)) {
		return {
			ok: false,
			rejection: {
				code: "secret_scan_nonce_invalid",
				message: "the run-scoped sentinel nonce must be a bounded base36 token.",
			},
		};
	}
	// Fixpoint: find L such that the marker built for byte_length=L has length L.
	// Start from a rough estimate and iterate; the map L -> len(marker(L)) is
	// non-decreasing and grows by <=1 per order of magnitude, so it converges in
	// a few steps well inside MAX_FIELD_BYTE_LENGTH.
	let length = 0;
	for (let i = 0; i < 8; i += 1) {
		const derived = deriveFieldSentinel({ field, byte_length: length }, nonce);
		if (!derived.ok) return derived;
		if (derived.marker.length === length) {
			return { ok: true, value: derived.marker, shape: { field, byte_length: length } };
		}
		length = derived.marker.length;
	}
	// Non-convergence is impossible for admitted inputs, but fail closed rather
	// than emit a value/marker mismatch that would make the harness vacuous.
	return {
		ok: false,
		rejection: {
			code: "secret_scan_field_length_invalid",
			message: "conformance sentinel length did not converge to a fixpoint.",
		},
	};
}
