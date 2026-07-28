// Admission verification against the code-owned manifest (U02).
//
// This module owns two things ADR 0027 requires: the code-owned admission
// manifest (the trusted baseline of per-target identity, custody, lifetime, and
// entitlements) and the verification that decides whether an observed claim
// matches that baseline. Browser Use admits one product version while verifying
// every target independently, so verification is per-target and any drift —
// replaced binary, re-signed identity, removed target, widened custody, skewed
// version, unsupported schema, or an unminted placeholder — fails closed.
//
// Pure TypeScript: no Swift, no signing, no secret bytes. The error-code union
// is compile-time-exhaustive (`satisfies Record<AdmissionErrorCode, string>`)
// so a new admission reason cannot silently degrade into an untyped string.

import {
	ADMISSION_MANIFEST_SCHEMA_VERSION,
	type AdmissionManifest,
	type BrowserUseSecurityTargetId,
	BROWSER_USE_SECURITY_TARGET_IDS,
	type BundleId,
	BUNDLE_ID_PLACEHOLDER,
	isMintedBundleId,
	mintedBundleId,
	type TargetAdmissionEntry,
	type TargetCustody,
	type TargetEntitlementsSummary,
	type TargetLifetime,
} from "./model.ts";

// Re-exported so admission consumers import the manifest shape from the
// admission owner. index.ts also `export *`s model.ts; TS dedupes a re-export
// that resolves to the same declaration, so this does not collide.
export type {
	AdmissionManifest,
	TargetAdmissionEntry,
} from "./model.ts";

/**
 * The closed set of reasons a target claim can fail admission.
 *
 * Every reason maps to a stable, path-free explanation string in
 * {@link ADMISSION_ERROR_CODES}, whose `satisfies Record<AdmissionErrorCode, …>`
 * annotation forces exhaustiveness at compile time: adding a member here without
 * an entry there is a type error, so a new admission reason can never silently
 * degrade into an untyped fallthrough.
 *
 * - `unknown-target` — the claim names an id outside the three ADR-0027 targets
 *   (a removed or ghost target).
 * - `schema-version-unsupported` — the manifest's schema version is not the one
 *   this code pins (a stale claim against an older/newer shape).
 * - `product-version-skew` — the claim's product version differs from the
 *   admitted product version.
 * - `placeholder-bundle-id` — the manifest entry or the claim still carries the
 *   unminted placeholder sentinel.
 * - `bundle-id-mismatch` — the claimed bundle id is not the manifest's (a
 *   replaced/different signed binary).
 * - `team-identifier-mismatch` — the claimed signing team differs (re-signed
 *   under a foreign identity).
 * - `designated-requirement-mismatch` — the claimed code-signing designated
 *   requirement differs (same bundle id, re-signed).
 * - `entitlements-widened` — the claim grants custody the baseline withholds
 *   (custody union forbidden by ADR 0027).
 * - `lifetime-changed` — the claim runs a posture the baseline forbids (for
 *   example a daemon where only on-demand is admissible).
 * - `custody-changed` — the claimed custody root differs from the baseline.
 */
export type AdmissionErrorCode =
	| "unknown-target"
	| "schema-version-unsupported"
	| "product-version-skew"
	| "placeholder-bundle-id"
	| "bundle-id-mismatch"
	| "team-identifier-mismatch"
	| "designated-requirement-mismatch"
	| "entitlements-widened"
	| "lifetime-changed"
	| "custody-changed";

/**
 * Stable, path-free reason strings per {@link AdmissionErrorCode}.
 *
 * The `satisfies` annotation makes this the compile-time exhaustiveness gate:
 * every union member must have an entry, and no extra key may appear. Strings
 * carry no filesystem path, no secret, and no observed byte — only the reason.
 */
export const ADMISSION_ERROR_CODES = {
	"unknown-target":
		"the claim names a target outside the three signed targets (ADR 0027).",
	"schema-version-unsupported":
		"the manifest schema version is not the one this code admits.",
	"product-version-skew":
		"the claim's product version differs from the admitted product version.",
	"placeholder-bundle-id":
		"the target still carries the unminted placeholder bundle id.",
	"bundle-id-mismatch":
		"the claimed bundle id is not the admitted target's bundle id.",
	"team-identifier-mismatch":
		"the claimed signing team identifier is not the admitted one.",
	"designated-requirement-mismatch":
		"the claimed code-signing designated requirement is not the admitted one.",
	"entitlements-widened":
		"the claim grants custody the baseline withholds (ADR 0027 forbids custody union).",
	"lifetime-changed":
		"the claim runs a process lifetime the baseline does not admit.",
	"custody-changed":
		"the claimed custody root is not the admitted target's custody root.",
} satisfies Record<AdmissionErrorCode, string>;

/**
 * A claim about one observed target the verifier compares against the manifest.
 *
 * Shaped like a {@link TargetAdmissionEntry} plus the product version the
 * observed install reports, so version skew is verified alongside identity.
 * Carries only evidence claims — no secret bytes.
 */
export interface AdmissionClaim {
	target_id: BrowserUseSecurityTargetId;
	bundle_id: BundleId;
	team_identifier: BundleId;
	designated_requirement: BundleId;
	entitlements: TargetEntitlementsSummary;
	lifetime?: TargetLifetime;
	custody?: TargetCustody;
	product_version: string;
}

/**
 * Per-target admission verdict.
 *
 * `admitted` carries the target id it cleared; `not-admitted` carries the exact
 * typed {@link AdmissionErrorCode} so the caller never has to parse prose.
 */
export type TargetAdmissionVerdict =
	| { verdict: "admitted"; target_id: BrowserUseSecurityTargetId }
	| {
			verdict: "not-admitted";
			target_id: BrowserUseSecurityTargetId | null;
			error_code: AdmissionErrorCode;
	  };

const TARGET_ID_SET: ReadonlySet<string> = new Set(
	BROWSER_USE_SECURITY_TARGET_IDS,
);

/**
 * The baseline custody, lifetime, and entitlements each target owns (ADR 0027).
 *
 * This is the split ADR 0027 forbids unioning: the broker receives no OP token,
 * no raw credential, and no browser channel; the launcher receives no browser
 * channel; the delivery target receives no OP token and no network entitlement.
 * Admission rejects any claim that widens beyond its target's row here.
 */
const TARGET_POSTURE: Readonly<
	Record<
		BrowserUseSecurityTargetId,
		{
			entitlements: TargetEntitlementsSummary;
			lifetime: TargetLifetime;
			custody: TargetCustody;
		}
	>
> = {
	"approval-broker": {
		entitlements: {
			holds_op_token: false,
			holds_raw_credential: false,
			holds_browser_channel: false,
			holds_network: false,
		},
		lifetime: "on-demand",
		custody: "touch-id-presence",
	},
	"token-retrieval-launcher": {
		entitlements: {
			holds_op_token: true,
			holds_raw_credential: true,
			holds_browser_channel: false,
			holds_network: true,
		},
		lifetime: "on-demand",
		custody: "provisioning-profile-bundle",
	},
	"confidential-field-delivery-xpc": {
		entitlements: {
			holds_op_token: false,
			holds_raw_credential: true,
			holds_browser_channel: true,
			holds_network: false,
		},
		lifetime: "on-demand",
		custody: "xpc-peer-pinned",
	},
};

/**
 * The code-owned admission manifest (ADR 0027).
 *
 * Exactly one entry per signed target, each still carrying the
 * {@link BUNDLE_ID_PLACEHOLDER} sentinel for its bundle id, team identifier, and
 * designated requirement — a later unit mints the literal `com.*` strings. Until
 * then admission of this manifest fails closed on `placeholder-bundle-id`. The
 * custody baseline (entitlements, lifetime, custody root) is already real: it
 * encodes the ADR-0027 split so drift tests bite before the strings are minted.
 *
 * `product_version` is the placeholder sentinel too, so the unminted manifest
 * cannot accidentally satisfy a real version claim.
 */
export const CODE_OWNED_ADMISSION_MANIFEST: AdmissionManifest = {
	schema_version: ADMISSION_MANIFEST_SCHEMA_VERSION,
	product_version: BUNDLE_ID_PLACEHOLDER,
	targets: BROWSER_USE_SECURITY_TARGET_IDS.map((target_id) => ({
		target_id,
		bundle_id: BUNDLE_ID_PLACEHOLDER,
		team_identifier: BUNDLE_ID_PLACEHOLDER,
		designated_requirement: BUNDLE_ID_PLACEHOLDER,
		entitlements: TARGET_POSTURE[target_id].entitlements,
		lifetime: TARGET_POSTURE[target_id].lifetime,
		custody: TARGET_POSTURE[target_id].custody,
	})),
};

/**
 * Inputs for {@link buildAdmittedManifest}: the product version plus the minted
 * per-target signing strings a later unit supplies. Custody, lifetime, and
 * entitlements are always taken from the ADR-0027 baseline, never from the
 * caller — the caller mints identity strings, not privilege.
 */
export interface AdmittedManifestInput {
	product_version: string;
	targets: Record<
		BrowserUseSecurityTargetId,
		{
			bundle_id: string;
			team_identifier: string;
			designated_requirement: string;
		}
	>;
}

/**
 * Build a fully-minted admission manifest from real signing strings.
 *
 * The custody baseline ({@link TARGET_POSTURE}) is authoritative and injected
 * here — the caller supplies only identity strings, so a caller can never widen
 * a target's custody through this door. Used by a later unit (and by tests) to
 * produce the manifest that actually admits; the code-owned placeholder manifest
 * stays fail-closed on its own.
 *
 * @param input - Product version and per-target minted signing strings
 * @returns A manifest with real bundle identities and the ADR-0027 custody baseline
 */
export function buildAdmittedManifest(
	input: AdmittedManifestInput,
): AdmissionManifest {
	return {
		schema_version: ADMISSION_MANIFEST_SCHEMA_VERSION,
		product_version: input.product_version,
		targets: BROWSER_USE_SECURITY_TARGET_IDS.map((target_id) => {
			const minted = input.targets[target_id];
			return {
				target_id,
				bundle_id: mintedBundleId(minted.bundle_id),
				team_identifier: mintedBundleId(minted.team_identifier),
				designated_requirement: mintedBundleId(minted.designated_requirement),
				entitlements: TARGET_POSTURE[target_id].entitlements,
				lifetime: TARGET_POSTURE[target_id].lifetime,
				custody: TARGET_POSTURE[target_id].custody,
			};
		}),
	};
}

/**
 * Whether an observed claim widens custody beyond the baseline entry.
 *
 * A claim is a widening if it turns ON any custody bit the baseline holds OFF.
 * Turning a bit that is ON to OFF is a narrowing, which is safe; only widening
 * unions privilege and is forbidden by ADR 0027.
 */
function widensEntitlements(
	baseline: TargetEntitlementsSummary,
	claim: TargetEntitlementsSummary,
): boolean {
	const keys: readonly (keyof TargetEntitlementsSummary)[] = [
		"holds_op_token",
		"holds_raw_credential",
		"holds_browser_channel",
		"holds_network",
	];
	return keys.some((key) => claim[key] && !baseline[key]);
}

/**
 * Verify one observed target claim against the admission manifest (ADR 0027).
 *
 * Fail-closed by construction: the first mismatch wins and the verdict carries
 * its typed {@link AdmissionErrorCode}. Order is deliberate — schema and known
 * target first (a stale or ghost claim can't reach identity checks), then the
 * placeholder guard (an unminted identity is never admitted), then product
 * version, then per-field identity, then custody posture. Never throws.
 *
 * @param manifest - The trusted admission manifest (code-owned or minted)
 * @param claim - The observed target claim to verify
 * @returns A typed per-target admission verdict
 *
 * @example
 * ```typescript
 * const verdict = admitTarget(manifest, claim)
 * if (verdict.verdict === 'not-admitted') report(verdict.error_code)
 * ```
 */
export function admitTarget(
	manifest: AdmissionManifest,
	claim: AdmissionClaim,
): TargetAdmissionVerdict {
	// Stale claim: the manifest schema version is not the one this code admits.
	if (manifest.schema_version !== ADMISSION_MANIFEST_SCHEMA_VERSION) {
		return {
			verdict: "not-admitted",
			target_id: null,
			error_code: "schema-version-unsupported",
		};
	}

	// Removed / ghost target: an id outside the three signed targets.
	if (!TARGET_ID_SET.has(claim.target_id)) {
		return {
			verdict: "not-admitted",
			target_id: null,
			error_code: "unknown-target",
		};
	}

	const entry = manifest.targets.find(
		(candidate) => candidate.target_id === claim.target_id,
	);
	if (!entry) {
		return {
			verdict: "not-admitted",
			target_id: claim.target_id,
			error_code: "unknown-target",
		};
	}

	// Placeholder guard: an unminted bundle id — in the manifest entry OR in the
	// claim — is never admitted. This keeps the code-owned placeholder manifest
	// fail-closed until a later unit mints the real strings.
	if (!isMintedBundleId(entry.bundle_id) || !isMintedBundleId(claim.bundle_id)) {
		return {
			verdict: "not-admitted",
			target_id: claim.target_id,
			error_code: "placeholder-bundle-id",
		};
	}

	// One product version admitted across all targets.
	if (claim.product_version !== manifest.product_version) {
		return {
			verdict: "not-admitted",
			target_id: claim.target_id,
			error_code: "product-version-skew",
		};
	}

	// Identity: bundle id, team identifier, designated requirement.
	if (claim.bundle_id !== entry.bundle_id) {
		return {
			verdict: "not-admitted",
			target_id: claim.target_id,
			error_code: "bundle-id-mismatch",
		};
	}
	if (claim.team_identifier !== entry.team_identifier) {
		return {
			verdict: "not-admitted",
			target_id: claim.target_id,
			error_code: "team-identifier-mismatch",
		};
	}
	if (claim.designated_requirement !== entry.designated_requirement) {
		return {
			verdict: "not-admitted",
			target_id: claim.target_id,
			error_code: "designated-requirement-mismatch",
		};
	}

	// Custody: no widening, no lifetime change, no custody-root change. The
	// trusted baseline is ALWAYS the code-owned TARGET_POSTURE, never the
	// manifest entry — a widened installed manifest would carry a widened entry,
	// so comparing the claim to the entry would compare a widening to itself and
	// admit it. Rooting the baseline in code makes drift detectable regardless of
	// what the (possibly-tampered) installed manifest claims for itself.
	const baseline = TARGET_POSTURE[claim.target_id];
	if (widensEntitlements(baseline.entitlements, claim.entitlements)) {
		return {
			verdict: "not-admitted",
			target_id: claim.target_id,
			error_code: "entitlements-widened",
		};
	}
	if (claim.lifetime !== undefined && claim.lifetime !== baseline.lifetime) {
		return {
			verdict: "not-admitted",
			target_id: claim.target_id,
			error_code: "lifetime-changed",
		};
	}
	if (claim.custody !== undefined && claim.custody !== baseline.custody) {
		return {
			verdict: "not-admitted",
			target_id: claim.target_id,
			error_code: "custody-changed",
		};
	}

	return { verdict: "admitted", target_id: claim.target_id };
}

/**
 * Turn a manifest entry into the claim that exactly matches it.
 *
 * Used by the runtime seam to verify an installed manifest against itself plus
 * the code-owned baseline: the entry's own fields become the observed claim.
 */
export function claimFromEntry(
	entry: TargetAdmissionEntry,
	product_version: string,
): AdmissionClaim {
	return {
		target_id: entry.target_id,
		bundle_id: entry.bundle_id,
		team_identifier: entry.team_identifier,
		designated_requirement: entry.designated_requirement,
		entitlements: entry.entitlements,
		lifetime: entry.lifetime,
		custody: entry.custody,
		product_version,
	};
}
