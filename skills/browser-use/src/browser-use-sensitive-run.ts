// ---------------------------------------------------------------------------
// Sensitive Run Guard + value-aware containment scanner (auth plan
// 2026-07-21-003 U4, R7, R14, R16-R18, R22-R24; AE5, AE8-AE9; release
// contract R14-R16, AE5).
//
// Defensive containment proof for the OPERATOR'S OWN credentials. A shared
// Browser Use run becomes "sensitive" the moment confidential delivery
// participates in it (a Confidential Field Delivery Helper field action).
// From that instant, every GOVERNED OUTPUT SURFACE that Browser Use owns —
// stdout envelopes, evidence/artifacts, diagnostics, crash/error surfaces,
// and persisted run-store files — must pass CONTAINMENT: no raw secret
// material may appear on them, mechanically checkable with sentinel values.
//
// This module is PURE (no I/O, no clock, no process control): it owns the
// sensitive-run marker lifecycle and the sentinel scanner. Actual capture
// suppression, the fenced lease, quarantine markers, and the signed XPC
// delivery helper are platform/native concerns named in R17 and owned by
// `runtime/browser-use-security/`; this guard is the mechanically-provable
// containment gate the CLI attaches to a run and asserts before releasing
// any governed surface. The delivery helper and the disposable `op` helper
// are the ONLY components that ever observe raw bytes (R16); this guard never
// receives them either — it registers the sentinels the harness sweeps for.
// ---------------------------------------------------------------------------

// --- Governed output surfaces (R17-R18; release R14-R16) --------------------

/**
 * Every Browser Use-governed output surface a sensitive run may emit onto.
 * Containment is asserted over EACH kind — a raw secret on any one is a
 * stop-condition (plan line 22). This enum is the checklist the leak harness
 * sweeps and the CLI proves clean before release.
 *
 * - `stdout-envelope`  — JSON command envelopes printed to stdout/stderr.
 * - `run-store-file`   — persisted run.json / outcome / attestation bytes
 *                        under the state XDG root.
 * - `artifact`         — evidence-root artifacts (<state>/artifacts/...).
 * - `diagnostic`       — inspectable diagnostics (connection, repair hints).
 * - `crash-surface`    — crash/error/thrown-mid-delivery surfaces, incl.
 *                        heap/core/error strings the runtime may emit.
 * - `log`              — console/network/adapter log lines.
 */
export const BROWSER_USE_GOVERNED_SURFACE_KINDS = [
	"stdout-envelope",
	"run-store-file",
	"artifact",
	"diagnostic",
	"crash-surface",
	"log",
] as const;

/** One governed output surface kind. */
export type BrowserUseGovernedSurfaceKind =
	(typeof BROWSER_USE_GOVERNED_SURFACE_KINDS)[number];

/**
 * One captured governed surface: its kind, an inspectable label (a path, an
 * envelope name — never a secret), and the raw bytes/text emitted onto it.
 * The scanner treats `content` as an opaque byte-carrying string.
 */
export type BrowserUseGovernedSurface = {
	kind: BrowserUseGovernedSurfaceKind;
	label: string;
	content: string;
};

// --- Sensitive-run marker lifecycle (R17) -----------------------------------

/**
 * Why a run turned sensitive. Only confidential delivery participation flips
 * the marker — an ordinary agent-browser fill of a `confidential`-typed field
 * is already refused upstream (agent_browser_confidential_input_requires_
 * auth_transaction), so the marker rises exactly when the Confidential Field
 * Delivery Helper is engaged for one bounded field action.
 */
export type BrowserUseSensitiveTrigger =
	| "confidential-field-delivery"
	| "secret-lease-acquired";

/**
 * The Sensitive Run Guard state. Deterministic and secret-free: it holds the
 * run identity, whether the sensitive marker is raised, the registered
 * sentinels the containment sweep matches, and the reason. Copied on every
 * transition (never mutated in place) so a caller can persist snapshots.
 */
export type BrowserUseSensitiveRunGuard = {
	run_id: string;
	sensitive: boolean;
	trigger: BrowserUseSensitiveTrigger | null;
	/**
	 * Sentinel byte-strings this run's containment sweep must find NOWHERE on
	 * any governed surface. In production these are never real secrets — the
	 * guard never receives raw bytes (R16). In the leak harness they are the
	 * representative sentinel username/password/OTP values.
	 */
	sentinels: readonly string[];
};

/** Typed guard-transition rejection. */
export type BrowserUseSensitiveRunRejection = {
	code:
		| "sensitive_run_id_invalid"
		| "sensitive_sentinel_invalid"
		| "sensitive_already_marked";
	message: string;
};

/** Guard-transition result: the next guard value, or one typed rejection. */
export type BrowserUseSensitiveRunResult =
	| { ok: true; guard: BrowserUseSensitiveRunGuard }
	| { ok: false; rejection: BrowserUseSensitiveRunRejection };

const SAFE_RUN_ID = /^[A-Za-z0-9._-]{1,128}$/;
// A sentinel short enough to plausibly appear in one field is a scanner
// weakness, not a strength: a 3-char sentinel would match ordinary tokens and
// produce false leaks. Require a bounded, distinctive minimum so a match is
// unambiguous evidence of a real leak.
const MIN_SENTINEL_LENGTH = 6;
const MAX_SENTINEL_LENGTH = 4096;

/**
 * Begin the guard for a run in its NON-sensitive baseline. No governed
 * surface is gated yet; the run behaves like any ordinary shared run until
 * confidential delivery participates.
 *
 * @param run_id - The shared run identity (bounded safe id)
 * @returns The baseline guard, or one typed rejection
 */
export function beginSensitiveRunGuard(
	run_id: string,
): BrowserUseSensitiveRunResult {
	if (!SAFE_RUN_ID.test(run_id)) {
		return {
			ok: false,
			rejection: {
				code: "sensitive_run_id_invalid",
				message: "run id must be a bounded safe identifier.",
			},
		};
	}
	return {
		ok: true,
		guard: { run_id, sensitive: false, trigger: null, sentinels: [] },
	};
}

/**
 * Mark the run sensitive because confidential delivery participates (R17).
 * Registers the sentinels the containment sweep will enforce absent from
 * every governed surface. Idempotent-by-refusal: a second mark is a typed
 * rejection, never a silent no-op, so a double-engagement of the delivery
 * helper is visible rather than masked.
 *
 * @param guard - The current (baseline) guard
 * @param input - The trigger and the sentinels to register
 * @returns The sensitive guard, or one typed rejection
 */
export function markRunSensitive(
	guard: BrowserUseSensitiveRunGuard,
	input: {
		trigger: BrowserUseSensitiveTrigger;
		sentinels: readonly string[];
	},
): BrowserUseSensitiveRunResult {
	if (guard.sensitive) {
		return {
			ok: false,
			rejection: {
				code: "sensitive_already_marked",
				message: "the run is already marked sensitive; delivery must be bounded to one engagement.",
			},
		};
	}
	if (input.sentinels.length === 0) {
		return {
			ok: false,
			rejection: {
				code: "sensitive_sentinel_invalid",
				message: "at least one sentinel is required to gate a sensitive run.",
			},
		};
	}
	for (const sentinel of input.sentinels) {
		if (
			typeof sentinel !== "string" ||
			sentinel.length < MIN_SENTINEL_LENGTH ||
			sentinel.length > MAX_SENTINEL_LENGTH
		) {
			return {
				ok: false,
				rejection: {
					code: "sensitive_sentinel_invalid",
					message: `each sentinel must be a distinctive string between ${MIN_SENTINEL_LENGTH} and ${MAX_SENTINEL_LENGTH} characters.`,
				},
			};
		}
	}
	return {
		ok: true,
		guard: {
			...guard,
			sensitive: true,
			trigger: input.trigger,
			sentinels: [...input.sentinels],
		},
	};
}

// --- Containment sweep (R17-R18; AE5; release R14-R16) ----------------------

/** One sentinel occurrence found on a governed surface. */
export type BrowserUseContainmentLeak = {
	surface_kind: BrowserUseGovernedSurfaceKind;
	surface_label: string;
	/**
	 * WHICH registered sentinel matched. Reports the sentinel's identity by
	 * index only, never re-emits the raw value into the finding — a leak
	 * report that quoted the leaked bytes would itself be a new leak surface.
	 */
	sentinel_index: number;
	/** Number of occurrences of that sentinel on this surface. */
	occurrences: number;
};

/**
 * The containment verdict for a sensitive run. `contained: true` means every
 * governed surface was swept and no registered sentinel appears anywhere —
 * the mechanically-provable form of "no raw secret material on any Browser
 * Use-governed surface" (release R14-R16, AE5). `contained: false` names each
 * leak by surface and sentinel index (never by value).
 */
export type BrowserUseContainmentVerdict =
	| {
			contained: true;
			swept_surfaces: number;
			swept_kinds: readonly BrowserUseGovernedSurfaceKind[];
	  }
	| {
			contained: false;
			swept_surfaces: number;
			leaks: readonly BrowserUseContainmentLeak[];
	  };

function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let from = 0;
	for (;;) {
		const at = haystack.indexOf(needle, from);
		if (at === -1) return count;
		count += 1;
		from = at + needle.length;
	}
}

/**
 * Sweep every governed surface for every registered sentinel (AE5). This is
 * the assertion the CLI runs before releasing a sensitive run's outputs and
 * the leak harness runs across the whole flow, including the crash path: a
 * step that throws mid-delivery still routes its crash/error text through a
 * `crash-surface` surface, and this sweep must find it clean.
 *
 * Fail-closed on a non-sensitive guard: sweeping a run that never registered
 * sentinels can never PROVE containment (there is nothing to match), so the
 * caller must not treat a trivially-empty sweep of an unmarked run as a
 * containment guarantee. That is a caller contract, not a scanner branch — a
 * guard with `sensitive: false` has no sentinels and every sweep is vacuous;
 * the CLI only asserts containment on `sensitive: true` guards.
 *
 * @param guard - The sensitive-run guard carrying the registered sentinels
 * @param surfaces - Every governed surface captured during the run
 * @returns Contained, or the typed leak set (sentinels named by index only)
 */
export function sweepGovernedSurfaces(
	guard: BrowserUseSensitiveRunGuard,
	surfaces: readonly BrowserUseGovernedSurface[],
): BrowserUseContainmentVerdict {
	const leaks: BrowserUseContainmentLeak[] = [];
	for (const surface of surfaces) {
		guard.sentinels.forEach((sentinel, sentinel_index) => {
			const occurrences = countOccurrences(surface.content, sentinel);
			if (occurrences > 0) {
				leaks.push({
					surface_kind: surface.kind,
					surface_label: surface.label,
					sentinel_index,
					occurrences,
				});
			}
		});
	}
	if (leaks.length > 0) {
		return { contained: false, swept_surfaces: surfaces.length, leaks };
	}
	const swept_kinds = [
		...new Set(surfaces.map((surface) => surface.kind)),
	] as BrowserUseGovernedSurfaceKind[];
	return { contained: true, swept_surfaces: surfaces.length, swept_kinds };
}

/**
 * The assertion the CLI attaches AT RELEASE: a sensitive run may only publish
 * its outputs once the sweep proves containment (R17-R18). Returns the typed
 * verdict; a caller that observes `contained: false` must fail the run closed
 * and preserve a human repair path (plan U4 "Verification"), never release
 * the surfaces. A non-sensitive guard is a caller error here — release-gating
 * only applies once the run turned sensitive.
 *
 * @param guard - The sensitive-run guard
 * @param surfaces - Every governed surface captured during the run
 * @returns `{ release: true }` when contained; the verdict with `release:false` otherwise
 */
export function assertContainmentBeforeRelease(
	guard: BrowserUseSensitiveRunGuard,
	surfaces: readonly BrowserUseGovernedSurface[],
):
	| { release: true; verdict: Extract<BrowserUseContainmentVerdict, { contained: true }> }
	| {
			release: false;
			reason: "run_not_sensitive" | "sentinels_missing" | "containment_failed";
			verdict?: BrowserUseContainmentVerdict;
	  } {
	if (!guard.sensitive) {
		return { release: false, reason: "run_not_sensitive" };
	}
	if (guard.sentinels.length === 0) {
		return { release: false, reason: "sentinels_missing" };
	}
	const verdict = sweepGovernedSurfaces(guard, surfaces);
	if (verdict.contained) return { release: true, verdict };
	return { release: false, reason: "containment_failed", verdict };
}
