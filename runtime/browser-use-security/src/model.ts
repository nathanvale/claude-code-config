// Per-target identity, admission-manifest schema, and bundle-id vocabulary for
// the Browser Use Security native product (ADR 0027/0028).
//
// This module is pure TypeScript. It mints no Swift, signs nothing, and holds
// no secret bytes. Absence of the native product is a legal, typed state
// (`native-capability-absent`); every admission path is fail-closed and never
// crashes. The literal `com.side-quest.*` bundle strings are minted below and
// mirror the Xcode targets' `PRODUCT_BUNDLE_IDENTIFIER` values exactly. The
// `BUNDLE_ID_PLACEHOLDER` sentinel remains the fail-closed value the code-owned
// manifest ships until a signed install supplies a minted claim.

/**
 * Stable target ids for the three separately signed executable targets.
 *
 * The set is closed and fixed by ADR 0027: Browser Use Security is one product
 * with exactly these three targets. Packaging never unions their privilege or
 * secret custody. This is not a registry seam — there is no fourth target and
 * no external extension boundary; a new target requires a new decision.
 *
 * - `approval-broker` — Touch ID-backed presence; receives no OP token, no raw
 *   credential, and no browser channel.
 * - `token-retrieval-launcher` — app-like bundle embedding a provisioning
 *   profile (ADR 0028); receives no browser channel.
 * - `confidential-field-delivery-xpc` — receives no OP token and holds no
 *   network entitlement.
 */
export const BROWSER_USE_SECURITY_TARGET_IDS = [
	"approval-broker",
	"token-retrieval-launcher",
	"confidential-field-delivery-xpc",
] as const;

/**
 * Target id union across the three signed executable targets.
 */
export type BrowserUseSecurityTargetId =
	(typeof BROWSER_USE_SECURITY_TARGET_IDS)[number];

/**
 * Sentinel marking an unminted placeholder bundle identity.
 *
 * A later unit replaces each placeholder with the real `com.*` string. Until
 * then this literal is the only inhabited value, and admission logic treats any
 * bundle id equal to it as not admitted. Reusing one sentinel across all three
 * targets is deliberate: it forces per-target replacement rather than allowing
 * a single global stub to satisfy admission.
 *
 * @defaultValue "PLACEHOLDER:mint-com-bundle-id"
 */
export const BUNDLE_ID_PLACEHOLDER = "PLACEHOLDER:mint-com-bundle-id" as const;

/**
 * Placeholder-sentinel literal type.
 */
export type BundleIdPlaceholder = typeof BUNDLE_ID_PLACEHOLDER;

declare const bundleIdBrand: unique symbol;

/**
 * Branded macOS bundle identity for a signed target.
 *
 * The brand prevents an arbitrary string from being passed where a minted
 * bundle id is required — a value only enters this type through
 * {@link mintedBundleId} (real `com.*` strings a later unit supplies) or as the
 * {@link BUNDLE_ID_PLACEHOLDER} sentinel. The sentinel inhabits the type so the
 * scaffold compiles, but {@link isMintedBundleId} rejects it and admission
 * stays fail-closed until the real string lands.
 */
export type BundleId = (string & { readonly [bundleIdBrand]: "bundle-id" }) | BundleIdPlaceholder;

/**
 * Brand a real, minted `com.*` bundle id string.
 *
 * A later unit calls this with the literal target bundle strings. It performs
 * no validation beyond branding; {@link isMintedBundleId} is the admission
 * guard that rejects the placeholder sentinel.
 *
 * @param value - A minted reverse-DNS bundle id (for example `com.example.app`)
 * @returns The same string branded as a {@link BundleId}
 *
 * @example
 * ```typescript
 * const brokerId = mintedBundleId('com.example.browser-use-security.broker')
 * ```
 */
export function mintedBundleId(value: string): BundleId {
	return value as BundleId;
}

/**
 * Whether a bundle id is a real minted value rather than the placeholder.
 *
 * Admission logic gates on this: a placeholder bundle id is never admitted, so
 * the scaffold cannot pass admission until a later unit mints the real strings.
 *
 * @param value - The bundle id to test
 * @returns True only when `value` is not the placeholder sentinel
 *
 * @example
 * ```typescript
 * isMintedBundleId(BUNDLE_ID_PLACEHOLDER) // false — forces replacement
 * ```
 */
export function isMintedBundleId(value: BundleId): boolean {
	return value !== BUNDLE_ID_PLACEHOLDER;
}

/**
 * The product-level reverse-DNS bundle prefix for Browser Use Security.
 *
 * ADR 0027 ships one product; each target's bundle id is a child of this
 * prefix. The `com.side-quest` scope matches the owner's existing
 * `@side-quest/*` package namespace, and no prior repo `CFBundleIdentifier`
 * convention bound this product, so the scope is minted here.
 *
 * @defaultValue "com.side-quest.browser-use-security"
 */
export const PRODUCT_BUNDLE_PREFIX =
	"com.nathanvow.browser-use-security" as const;

/**
 * Minted, literal bundle identities per target, keyed by
 * {@link BrowserUseSecurityTargetId}.
 *
 * Each value is the real `com.side-quest.browser-use-security.*` string and
 * mirrors the matching Xcode target's `PRODUCT_BUNDLE_IDENTIFIER` and its
 * `Info.plist` `CFBundleIdentifier` exactly. The delivery target's bundle id
 * ends in `confidential-field-delivery` (not `-xpc`); the `-xpc` suffix is the
 * target id, not the bundle id. Every value passes {@link isMintedBundleId}, so
 * a manifest built from these can be admitted; the {@link BUNDLE_ID_PLACEHOLDER}
 * sentinel still gates the code-owned manifest that ships fail-closed.
 */
export const TARGET_BUNDLE_IDS: Readonly<
	Record<BrowserUseSecurityTargetId, BundleId>
> = {
	"approval-broker": mintedBundleId(`${PRODUCT_BUNDLE_PREFIX}.approval-broker`),
	"token-retrieval-launcher": mintedBundleId(
		`${PRODUCT_BUNDLE_PREFIX}.token-retrieval-launcher`,
	),
	"confidential-field-delivery-xpc": mintedBundleId(
		`${PRODUCT_BUNDLE_PREFIX}.confidential-field-delivery`,
	),
} as const;

/**
 * Admission-manifest schema version.
 *
 * A new manifest shape lands here first; drift tests pin the version before the
 * runtime may emit or admit it.
 *
 * @defaultValue "1"
 */
export const ADMISSION_MANIFEST_SCHEMA_VERSION = "1" as const;

/**
 * Custody a target may hold, summarized as a closed set of boolean claims.
 *
 * ADR 0027 forbids unioning privilege or secret custody across targets:
 * packaging never grants a target more than its charter. This summary is the
 * code-side witness of that split — admission rejects any target that widens
 * its custody beyond the baseline (a broker that suddenly holds the OP token, a
 * delivery target that suddenly holds a network entitlement).
 *
 * These are evidence claims, not secret bytes. Every value is a boolean; no
 * token, credential, or channel handle is ever carried here.
 *
 * - `holds_op_token` — the 1Password token (broker and delivery: never).
 * - `holds_raw_credential` — a raw retrieved credential (broker: never).
 * - `holds_browser_channel` — the browser CDP channel (broker and launcher:
 *   never).
 * - `holds_network` — an outbound-network entitlement (delivery: never).
 */
export interface TargetEntitlementsSummary {
	holds_op_token: boolean
	holds_raw_credential: boolean
	holds_browser_channel: boolean
	holds_network: boolean
}

/**
 * Process lifetime posture for a target (ADR 0027: targets run on demand; no
 * LaunchAgent or daemon is introduced).
 *
 * - `on-demand` — launched per operation, exits when done. The only posture
 *   ADR 0027 permits; a `daemon` value exists so admission can reject it, not
 *   because any target may claim it.
 * - `daemon` — a persistent background process. Never admissible under ADR 0027
 *   without a new decision.
 */
export type TargetLifetime = "on-demand" | "daemon";

/**
 * Custody posture for a target: where its authority is rooted.
 *
 * Names the trust root each target owns without unioning it with any other
 * target's. Closed set; a new custody root requires a new decision.
 *
 * - `touch-id-presence` — Approval Broker: Touch ID-backed presence only.
 * - `provisioning-profile-bundle` — Token Retrieval Launcher: app-like bundle
 *   embedding a provisioning profile (ADR 0028).
 * - `xpc-peer-pinned` — Confidential Field Delivery XPC: pinned to its XPC peer.
 */
export type TargetCustody =
	| "touch-id-presence"
	| "provisioning-profile-bundle"
	| "xpc-peer-pinned";

/**
 * Per-target admission entry: the identity and evidence Browser Use verifies
 * for one signed target.
 *
 * Carries no secret bytes and no OP token — only identity, code-signing
 * evidence references, and closed boolean/enum posture claims. Each target is
 * verified independently (ADR 0027); this entry is that target's slice of the
 * manifest, with its distinct bundle identity, entitlements summary, lifetime,
 * and custody root.
 *
 * @example
 * ```typescript
 * const entry: TargetAdmissionEntry = {
 *   target_id: 'approval-broker',
 *   bundle_id: TARGET_BUNDLE_IDS['approval-broker'],
 *   team_identifier: mintedBundleId('TEAMID0001'),
 *   designated_requirement: mintedBundleId('anchor apple generic and identifier "com.side-quest.browser-use-security.approval-broker"'),
 *   entitlements: { holds_op_token: false, holds_raw_credential: false, holds_browser_channel: false, holds_network: false },
 *   lifetime: 'on-demand',
 *   custody: 'touch-id-presence',
 * }
 * ```
 */
export interface TargetAdmissionEntry {
	/** Which of the three signed targets this entry admits. */
	target_id: BrowserUseSecurityTargetId
	/** Minted bundle identity, or the placeholder sentinel while unminted. */
	bundle_id: BundleId
	/** Signing team identifier; placeholder until a later unit mints it. */
	team_identifier: BundleId
	/** Code-signing designated requirement; placeholder until minted. */
	designated_requirement: BundleId
	/** Closed custody summary; admission rejects any widening (ADR 0027). */
	entitlements: TargetEntitlementsSummary
	/** Process lifetime posture; only `on-demand` is admissible (ADR 0027). */
	lifetime: TargetLifetime
	/** Custody root this target owns, never unioned with another's. */
	custody: TargetCustody
}

/**
 * Code-owned admission manifest: the three per-target entries Browser Use
 * admits as one product version.
 *
 * ADR 0027 requires a code-owned admission manifest with drift tests. Browser
 * Use admits one product version while verifying every target independently, so
 * the manifest carries exactly one entry per {@link BrowserUseSecurityTargetId}.
 *
 * @example
 * ```typescript
 * const manifest: AdmissionManifest = {
 *   schema_version: ADMISSION_MANIFEST_SCHEMA_VERSION,
 *   product_version: '0.1.0',
 *   targets: [ ... ], // one entry per target id
 * }
 * ```
 */
export interface AdmissionManifest {
	/** Manifest schema version; pinned by drift tests before emission. */
	schema_version: typeof ADMISSION_MANIFEST_SCHEMA_VERSION
	/** The single product version admitted across all targets. */
	product_version: string
	/** Exactly one admission entry per signed target. */
	targets: readonly TargetAdmissionEntry[]
}

/**
 * Admission verdict for one target or the whole product.
 *
 * `native-capability-absent` is a first-class legal state (ADR 0028): the
 * native product may be entirely absent, and every absent path stays
 * fail-closed and typed rather than crashing. `not-admitted` covers a present
 * but unverified target — including any target still carrying a placeholder
 * bundle id.
 *
 * - `admitted` — the target is present and its identity evidence verified.
 * - `not-admitted` — the target is present but failed verification (placeholder
 *   bundle id, mismatched identity, missing evidence).
 * - `native-capability-absent` — the native product is not installed; a legal,
 *   tested state, never a crash or a stub.
 */
export type AdmissionVerdict =
	| "admitted"
	| "not-admitted"
	| "native-capability-absent";
