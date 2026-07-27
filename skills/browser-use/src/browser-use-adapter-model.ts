// ---------------------------------------------------------------------------
// Browser Use Adapter Lane model (auth plan 2026-07-21-003 U1, R1-R6).
//
// The ONE owner of Browser Use adapter lane identity and the code-owned lane
// table: lane ids keyed on the Verified Handoff Envelope's
// `attachment.adapter_id` verbatim (R3), the rejected identity aliases that
// resolve the pre-rollout id drift, the evidence-class/producer vocabulary,
// and the immutable evidence-reference shape producers register through.
// Leaf module: imports node:crypto only, so discovery-model, command-contract,
// and the registry can all derive from it without cycles. Composition and
// fail-closed evaluation live in browser-use-adapter-registry.ts.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

// Lane identity axis (R3): the envelope's attachment.adapter_id verbatim.
// discovery-model re-exports this as BROWSER_USE_LIVE_ADAPTERS — one adapter
// vocabulary, one owner, no second identity table.
export const BROWSER_USE_ADAPTER_LANE_IDS = [
	"chrome-devtools-mcp",
	"agent-browser",
	"playwright-cdp",
] as const;
export type BrowserUseAdapterLaneId =
	(typeof BROWSER_USE_ADAPTER_LANE_IDS)[number];

// Resolved identity drift (R3): these ids circulated in earlier vocabularies
// (the Router-era registry's bare chrome-devtools id; the Playwright CLI
// product name) and are rejected as lane keys, never silently mapped. The
// mapping value names the exact lane a caller should key on instead.
export const BROWSER_USE_REJECTED_LANE_ALIASES: Readonly<
	Record<string, BrowserUseAdapterLaneId>
> = {
	"chrome-devtools": "chrome-devtools-mcp",
	"playwright-cli": "playwright-cdp",
};

// Evidence classes composed by the lane registry (R3): connection facts from
// Browser Connect, task-lane conformance from the lane Implementation, and
// auth conformance from the auth conformance suite. Each class has exactly
// one producer; a claim never has two owners.
export const BROWSER_USE_LANE_EVIDENCE_CLASSES = [
	"connection",
	"task",
	"auth-conformance",
] as const;
export type BrowserUseLaneEvidenceClass =
	(typeof BROWSER_USE_LANE_EVIDENCE_CLASSES)[number];

export const BROWSER_USE_LANE_EVIDENCE_PRODUCERS = {
	connection: "browser-connect",
	task: "lane-implementation",
	"auth-conformance": "auth-conformance-suite",
} as const satisfies Record<BrowserUseLaneEvidenceClass, string>;

// Auth method vocabulary the auth-conformance class may claim (R5). Advertised
// support is always evidence-derived; every lane starts unproven (KTD8/KTD9:
// session reuse is the universal baseline, fresh methods gate on conformance).
export const BROWSER_USE_LANE_AUTH_METHODS = [
	"session-reuse",
	"password",
	"otp",
	"user-presence",
] as const;
export type BrowserUseLaneAuthMethod =
	(typeof BROWSER_USE_LANE_AUTH_METHODS)[number];

// Lane-specific execution Interface ids (R5, KTD2): a lane's native
// Implementation is registered here, not inferred, and the Chrome MCP
// transport is one lane's Interface, never a universal abstraction.
export const BROWSER_USE_LANE_EXECUTION_INTERFACES = [
	"mcporter-envelope-call",
	"agent-browser-native-call",
] as const;
export type BrowserUseLaneExecutionInterface =
	(typeof BROWSER_USE_LANE_EXECUTION_INTERFACES)[number];

/**
 * One lane's native Implementation slot: an implemented registered execution
 * Interface, or honest typed unavailability with the next repair action
 * (KTD4 — evidence and typed states, never guessed booleans).
 */
export type BrowserUseLaneNativeImplementation =
	| {
			implemented: true;
			execution_interface: BrowserUseLaneExecutionInterface;
	  }
	| {
			implemented: false;
			unavailable_reason: string;
			next_repair_action: string;
	  };

/**
 * Code-owned per-lane baseline (R3): operation capability vocabulary each
 * lane's task evidence may claim, and the lane's native Implementation slot.
 * Capability literals are compile-checked against the public capability
 * vocabulary where command-contract derives its per-adapter table.
 */
export const BROWSER_USE_ADAPTER_LANE_TABLE = {
	"chrome-devtools-mcp": {
		// The Chrome DevTools MCP executor (browser-use-chrome-task.ts) proves a
		// read-only debugging/performance evidence surface against the live
		// adapter: console-read -> list_console_messages (console_debug),
		// network-read/network-request -> list_network_requests/get_network_request
		// (network_inspection), performance-trace -> performance_start_trace/
		// performance_stop_trace (performance_profile), and lighthouse-insight ->
		// performance_analyze_insight (devtools_performance_insight). memory_debug /
		// react_vitals are NOT advertised — the executor does not prove them.
		operation_capabilities: [
			"snapshot_refs",
			"screenshot_media",
			"viewport_emulation",
			"console_debug",
			"network_inspection",
			"performance_profile",
			"devtools_performance_insight",
		],
		native_implementation: {
			implemented: true,
			execution_interface: "mcporter-envelope-call",
		},
	},
	"agent-browser": {
		// The Agent Browser executor (browser-use-agent-browser.ts) proves a
		// current-snapshot ref surface (snapshot -> snapshot_refs) and ref-scoped
		// element mutation (click/fill -> element_actions). open (navigation) and
		// evaluate (page JS) have no capability-vocabulary member, so they are not
		// advertised here — the lane claims only what the executor proves.
		operation_capabilities: ["snapshot_refs", "element_actions"],
		native_implementation: {
			implemented: true,
			execution_interface: "agent-browser-native-call",
		},
	},
	"playwright-cdp": {
		operation_capabilities: [],
		native_implementation: {
			implemented: false,
			unavailable_reason:
				"No lane-specific execution Interface is registered for this lane yet.",
			next_repair_action:
				"Register the Playwright lane Implementation through the platform plan's connection-lane unit before advertising task capability.",
		},
	},
} as const satisfies Record<
	BrowserUseAdapterLaneId,
	{
		operation_capabilities: readonly string[];
		native_implementation: BrowserUseLaneNativeImplementation;
	}
>;

/**
 * Implementation integrity identity a capability claim binds to (R4):
 * executable realpath and content digest (or package integrity), dependency
 * lock identity, protocol/help fingerprint, platform, and security-policy
 * revision. A same-version replacement changes this identity and fails
 * closed; version strings alone never prove anything.
 */
export type BrowserUseLaneImplementationIntegrity = {
	executable_realpath: string;
	content_digest: string;
	dependency_lock_identity: string;
	protocol_fingerprint: string;
	platform: string;
	security_policy_revision: string;
};

/**
 * The immutable evidence reference producers register (R3/R4). The stable
 * producer Interface: exactly these fields, nothing more — a producer never
 * extends the registry schema. `evidence_digest` is the reference's content
 * digest; the registry recomputes it and rejects an edited reference.
 */
export type BrowserUseLaneEvidenceReference = {
	lane_id: BrowserUseAdapterLaneId;
	evidence_class: BrowserUseLaneEvidenceClass;
	producer: string;
	/** Claims this evidence proves, drawn from the class's vocabulary (R4). */
	claims: readonly string[];
	integrity: BrowserUseLaneImplementationIntegrity;
	probed_at_epoch_ms: number;
	stale_after_ms: number;
	evidence_digest: string;
};

/** The exact key set of the stable producer Interface. */
export const BROWSER_USE_LANE_EVIDENCE_REFERENCE_KEYS = [
	"lane_id",
	"evidence_class",
	"producer",
	"claims",
	"integrity",
	"probed_at_epoch_ms",
	"stale_after_ms",
	"evidence_digest",
] as const;

/** The exact key set of the integrity identity — a nested field outside this
 * set is a schema extension and fails admission, same as a top-level one. */
export const BROWSER_USE_LANE_INTEGRITY_KEYS = [
	"executable_realpath",
	"content_digest",
	"dependency_lock_identity",
	"protocol_fingerprint",
	"platform",
	"security_policy_revision",
] as const satisfies readonly (keyof BrowserUseLaneImplementationIntegrity)[];

/**
 * The transport-eligible adapter ids derived from the lane table (R5): exactly
 * the lanes with an implemented registered execution Interface. Consumed by
 * the public command contract so no second transport-eligibility copy exists.
 *
 * @returns Lane ids with an implemented native execution Interface
 */
export function transportAdapterIdsFromLaneTable(): BrowserUseAdapterLaneId[] {
	return BROWSER_USE_ADAPTER_LANE_IDS.filter(
		(laneId) =>
			BROWSER_USE_ADAPTER_LANE_TABLE[laneId].native_implementation.implemented,
	);
}

/**
 * Canonical serialization of one Implementation integrity identity. The ONE
 * field-order owner shared by the evidence digest and the registry's drift
 * comparison, so a field added to the integrity type can never be covered by
 * one and silently missed by the other.
 *
 * @param integrity - Implementation integrity identity
 * @returns Canonical JSON array string over the integrity key set
 */
export function integrityKeyOf(
	integrity: BrowserUseLaneImplementationIntegrity,
): string {
	return JSON.stringify(
		BROWSER_USE_LANE_INTEGRITY_KEYS.map((key) => integrity[key]),
	);
}

/**
 * Deterministic content digest of one evidence reference (R3): canonical
 * JSON array over every producer-supplied field in fixed order, sha256,
 * 32 hex chars — the same no-clock no-randomness discipline as the handoff
 * evidence id.
 *
 * @param reference - Evidence reference fields, minus the digest itself
 * @returns 32-hex-char content digest
 */
export function laneEvidenceDigestOf(
	reference: Omit<BrowserUseLaneEvidenceReference, "evidence_digest">,
): string {
	const canonical = JSON.stringify([
		reference.lane_id,
		reference.evidence_class,
		reference.producer,
		[...reference.claims],
		integrityKeyOf(reference.integrity),
		reference.probed_at_epoch_ms,
		reference.stale_after_ms,
	]);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
