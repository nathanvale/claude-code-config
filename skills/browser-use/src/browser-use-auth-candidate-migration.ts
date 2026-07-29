// ---------------------------------------------------------------------------
// Login-narrative -> Import Candidate transform (auth U7; R29-R37, R40;
// AE10 redaction/candidate part).
//
// A pure transform that turns legacy login narratives and login capabilities
// into redacted BrowserUseImportCandidate records — never a second login
// engine. Candidates PROPOSE; live vault evidence binds and humans resolve
// ambiguity through the U3a match/selection owner. This module never touches
// credential sources, ports, profile paths, cookie/sign-out recipes, or OTP
// command text; it retains only service/auth-context identity, approved
// origins (via normalizeOrigin), a typed method-shape hint, and source
// provenance. Every emitted candidate is required to pass
// validateImportCandidateShape and screenImportCandidate clean, with zero
// secretShapeFindingOf hits on any field (the auth-bindings owner is the
// single guard; nothing is re-declared here). Pure model only: no I/O,
// no Date.now.
// ---------------------------------------------------------------------------

import { isAbsolute } from "node:path";
import {
	type BrowserUseImportCandidate,
	normalizeOrigin,
	screenImportCandidate,
	secretShapeFindingOf,
	validateImportCandidateShape,
} from "./browser-use-auth-bindings";

// --- Method-shape hint vocabulary (closed; typed, never executable steps) --------

/**
 * Closed method-shape hint vocabulary (R13/D5 mirror): the legacy narratives'
 * MFA variation is represented as a typed shape hint, NEVER as executable
 * login steps. `password-totp-three-step` and `password-totp-four-step` differ
 * only by whether an explicit MFA method-selection stage precedes TOTP.
 */
export const BROWSER_USE_AUTH_METHOD_SHAPE_HINTS = [
	"password-totp-three-step",
	"password-totp-four-step",
	"delegated-vendor-login",
] as const;

/** Method-shape hint union. */
export type BrowserUseAuthMethodShapeHint =
	(typeof BROWSER_USE_AUTH_METHOD_SHAPE_HINTS)[number];

// --- Source narrative model (redacted input; strip-at-authoring contract) --------

/**
 * One legacy login source, already stripped of everything sensitive by the
 * caller. This transform is pure and re-screens defensively, but the redaction
 * contract is: personal identity, credential sources, CDP ports, profile
 * paths, cookie/sign-out/process-kill recipes, and OTP command text NEVER
 * enter this shape.
 */
export type BrowserUseLoginNarrativeSource = {
	/** Opaque service identity (e.g. "ellucian-sso"); no personal identity. */
	serviceId: string;
	/** Legacy sign-in origin; normalized here, proposed never authorized. */
	loginOrigin: string;
	/** Typed method-shape hint; MFA variation is data, never steps. */
	methodShapeHint: BrowserUseAuthMethodShapeHint;
	/** Whether an explicit MFA method-selection stage precedes TOTP. */
	mfaSelectionStage: boolean;
	/** Redacted display provenance (flow-shape summary only), or null. */
	contextProse: string | null;
	/** Safe relative provenance path of the source narrative/capability. */
	sourceRelativePath: string;
};

// --- Candidate transform output --------------------------------------------------

/** One inspectable provenance edge for a migrated login source. */
export type BrowserUseAuthCandidateProvenance = {
	source_relative_path: string;
	service_id: string;
	method_shape_hint: BrowserUseAuthMethodShapeHint;
	disposition: "migrated";
};

/** Redacted candidate transform result: candidates plus source provenance. */
export type BrowserUseAuthCandidateMigration = {
	/** One proposed candidate per source; proposes, never binds (SD1). */
	candidates: readonly BrowserUseImportCandidate[];
	/** One inspectable provenance edge per source narrative/capability. */
	provenance: readonly BrowserUseAuthCandidateProvenance[];
};

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SECRET_KEY_HINT_PATTERN = /(password|passwd|secret|seed|totp|credential|token)/i;

/**
 * Redaction-failure markers for the display-only `contextProse` field: the
 * generalizable identity/source/recipe classes the legacy narratives must never
 * carry into a candidate — an email address, a 1Password CLI reference, a vault
 * name, a CDP port, a profile/user-data path, and a cookie-clear / sign-out /
 * process-kill lifecycle recipe. `secretShapeFindingOf` and
 * {@link SECRET_KEY_HINT_PATTERN} catch secret *shapes* and credential key-names;
 * these catch the leaked-context *classes* those two miss (R29/R30 redaction).
 * Deliberately content-class, not personal-name matching: a bare surname would
 * false-positive on legitimate flow-shape prose.
 */
const LEAKED_CONTEXT_PATTERN =
	/(@[\w.-]+\.\w{2,}|\bop (?:read|item)\b|op:\/\/|\bcdp\b|\bport\s*\d{2,5}\b|\b9222\b|user_data_dir|chrome-agent|--otp|cookies?\s+clear|sign\s?-?\s?out|\bkill\b)/i;

function sourceRelativePathValid(value: string): boolean {
	return (
		value.length > 0 &&
		// `isAbsolute` is platform-specific: on POSIX it ignores a Windows drive
		// path (`C:\foo`) or a backslash escape (`..\secret`), which then survive
		// the `/`-split `..` check as a single segment. Reject any backslash so the
		// safe-relative invariant holds on non-Windows CI/dev hosts too.
		!value.includes("\\") &&
		!isAbsolute(value) &&
		!value.split("/").some((segment) => segment === "" || segment === "..")
	);
}

/**
 * Reject any string that is secret-shaped or that would signal a leaked
 * credential source. The auth-bindings guard owns secret-shape classification;
 * this adds only the key-name pattern check the transform needs at authoring
 * time (a source whose prose still names a credential is a redaction failure).
 */
function assertSourceString(field: string, value: string): void {
	if (secretShapeFindingOf(value) !== undefined) {
		throw new Error(
			`Login-narrative migration rejected a secret-shaped value at ${field}.`,
		);
	}
	if (SECRET_KEY_HINT_PATTERN.test(value)) {
		throw new Error(
			`Login-narrative migration rejected a credential-naming value at ${field}.`,
		);
	}
	if (LEAKED_CONTEXT_PATTERN.test(value)) {
		throw new Error(
			`Login-narrative migration rejected leaked context (identity, source, port, profile, or lifecycle recipe) at ${field}.`,
		);
	}
}

function assertSource(source: BrowserUseLoginNarrativeSource): string {
	if (!SAFE_ID_PATTERN.test(source.serviceId)) {
		throw new Error(
			"Login-narrative migration requires a lowercase opaque service id.",
		);
	}
	if (
		!(BROWSER_USE_AUTH_METHOD_SHAPE_HINTS as readonly string[]).includes(
			source.methodShapeHint,
		)
	) {
		throw new Error(
			"Login-narrative migration requires a known typed method-shape hint.",
		);
	}
	if (!sourceRelativePathValid(source.sourceRelativePath)) {
		throw new Error(
			"Login-narrative migration requires a safe relative source provenance path.",
		);
	}
	if (source.contextProse !== null) {
		assertSourceString("contextProse", source.contextProse);
	}
	const normalized = normalizeOrigin(source.loginOrigin);
	if (!normalized.ok) {
		throw new Error(
			"Login-narrative migration requires an exact HTTP(S) login origin.",
		);
	}
	return normalized.origin;
}

/**
 * Build the redacted, display-only context prose. Encodes only the typed
 * method shape and whether an MFA selection stage precedes TOTP — never
 * button labels, field selectors, credential sources, or step recipes.
 */
function candidateProse(source: BrowserUseLoginNarrativeSource): string | null {
	if (source.contextProse !== null) return source.contextProse;
	const mfa = source.mfaSelectionStage
		? "explicit MFA method-selection stage"
		: "no MFA method-selection stage";
	return `${source.methodShapeHint}; ${mfa}.`;
}

/**
 * Transform one already-redacted login source into a single redacted
 * BrowserUseImportCandidate. The candidate PROPOSES: its auth_context is the
 * closed `interactive-login` vocabulary member (legacy prose is never
 * auto-mapped), its origin is a normalizeOrigin fixpoint proposal, and its
 * method shape rides as display prose only. hint_item_id and legacy_vault_name
 * stay null — no credential-source detail crosses this seam (SD6). The output
 * is re-screened before return; any secret-shaped or shape-invalid result is a
 * transform bug and throws rather than emitting an unsafe candidate.
 *
 * @param source - One already-redacted login narrative or capability source
 * @returns One admissible, secret-free Import Candidate
 * @throws {Error} When the source or its transform output fails redaction/shape
 *
 * @example
 * ```typescript
 * const candidate = transformLoginNarrativeToCandidate({
 *   serviceId: "ellucian-sso",
 *   loginOrigin: "https://sso.example.com",
 *   methodShapeHint: "password-totp-three-step",
 *   mfaSelectionStage: true,
 *   contextProse: null,
 *   sourceRelativePath: "ellucian-okta/runbook-okta-login.md",
 * });
 * // candidate.hint_item_id === null; no credential-source detail crosses.
 * ```
 */
export function transformLoginNarrativeToCandidate(
	source: BrowserUseLoginNarrativeSource,
): BrowserUseImportCandidate {
	const origin = assertSource(source);
	const candidate: BrowserUseImportCandidate = {
		candidate_id: `auth-candidate-${source.serviceId}`,
		auth_context: "interactive-login",
		service_id: source.serviceId,
		legacy_context_prose: candidateProse(source),
		// Credential-source detail never crosses this seam (SD6): no vault name,
		// no hint item id derived from any op reference.
		hint_item_id: null,
		proposed_origins: [origin],
		legacy_vault_name: null,
		provenance: "legacy-auth-pointer",
	};
	// Fail closed: the auth-bindings owner is the sole admission/screen. A
	// candidate that does not pass both clean is a transform defect, not data
	// to be emitted and cleaned downstream.
	const issues = validateImportCandidateShape(candidate);
	if (issues.length > 0) {
		const first = issues[0];
		throw new Error(
			`Login-narrative migration produced an inadmissible candidate (${first?.code} at ${first?.path}).`,
		);
	}
	const screened = screenImportCandidate(candidate);
	if (!screened.ok) {
		throw new Error(
			`Login-narrative migration produced a rejected candidate (${screened.rejection.code}).`,
		);
	}
	return screened.candidate;
}

/**
 * Transform a batch of already-redacted login sources into redacted Import
 * Candidates plus one provenance edge per source. Duplicate or same-origin
 * services (e.g. two capabilities that share one vendor origin) stay separate
 * candidates — this transform proposes; the U3a match owner disambiguates
 * against live evidence and never collapses them to a live binding here.
 * Duplicate candidate ids (same service id twice) are rejected: provenance
 * must stay one-to-one and unambiguous.
 *
 * @param sources - Already-redacted login narratives and login capabilities
 * @returns Redacted candidates plus one migrated provenance edge per source
 * @throws {Error} When a source fails redaction/shape or ids are not distinct
 *
 * @example
 * ```typescript
 * const migration = buildAuthCandidateMigration([
 *   ellucianNarrative,
 *   monashNarrative,
 *   confluenceCapability,
 * ]);
 * // migration.candidates: one proposed candidate per source; provenance is 1:1.
 * ```
 */
export function buildAuthCandidateMigration(
	sources: readonly BrowserUseLoginNarrativeSource[],
): BrowserUseAuthCandidateMigration {
	const candidates = sources.map(transformLoginNarrativeToCandidate);
	const ids = new Set(candidates.map((candidate) => candidate.candidate_id));
	if (ids.size !== candidates.length) {
		throw new Error(
			"Login-narrative migration requires distinct candidate ids per source.",
		);
	}
	const paths = new Set(sources.map((source) => source.sourceRelativePath));
	if (paths.size !== sources.length) {
		throw new Error(
			"Login-narrative migration requires distinct source provenance paths.",
		);
	}
	const provenance = sources.map(
		(source): BrowserUseAuthCandidateProvenance => ({
			source_relative_path: source.sourceRelativePath,
			service_id: source.serviceId,
			method_shape_hint: source.methodShapeHint,
			disposition: "migrated",
		}),
	);
	return { candidates, provenance };
}
