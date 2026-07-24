// ---------------------------------------------------------------------------
// Browser Use Adapter Lane Registry (auth plan 2026-07-21-003 U1, R1-R6; AE1).
//
// The one Browser Use owner composing adapter lane identity, native
// Implementation, and evidence into inspectable lane views. Keyed on the
// exact handoff `attachment.adapter_id` (R3); Browser Connect stays
// authoritative for connection identity and handoff proof, lane
// Implementations produce task evidence, auth conformance produces auth
// evidence — this registry composes their immutable digests and never
// duplicates producer facts. Every unknown id, identity alias, duplicate
// producer, unknown claim, edited reference, stale probe, or integrity drift
// fails closed with a typed reason (R4, KTD4).
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import {
	type BrowserUseAdapterLaneId,
	type BrowserUseLaneEvidenceClass,
	type BrowserUseLaneEvidenceReference,
	type BrowserUseLaneNativeImplementation,
	BROWSER_USE_ADAPTER_LANE_IDS,
	BROWSER_USE_ADAPTER_LANE_TABLE,
	BROWSER_USE_LANE_AUTH_METHODS,
	BROWSER_USE_LANE_EVIDENCE_CLASSES,
	BROWSER_USE_LANE_EVIDENCE_PRODUCERS,
	BROWSER_USE_LANE_EVIDENCE_REFERENCE_KEYS,
	BROWSER_USE_LANE_INTEGRITY_KEYS,
	BROWSER_USE_REJECTED_LANE_ALIASES,
	integrityKeyOf,
	laneEvidenceDigestOf,
} from "./browser-use-adapter-model";
import { sanitizeUsageValue } from "./browser-use-core";
import {
	BROWSER_CONNECT_HANDOFF_CONTRACT_ID,
	BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION,
} from "./command-contract";

// --- Lane views ---------------------------------------------------------------

/** Per-class evidence status: proven, honest unproven, or stale (R4). */
export type BrowserUseLaneEvidenceStatus = "proven" | "unproven" | "stale";

/** One composed evidence slot on a lane view. */
export type BrowserUseLaneEvidenceSlot = {
	status: BrowserUseLaneEvidenceStatus;
	evidence_digest?: string;
	probed_at_epoch_ms?: number;
};

/**
 * One public Browser Use Adapter Lane (AE1): exactly one handoff binding pin,
 * exactly one native Implementation slot, and evidence-derived claims that
 * fail closed on staleness or integrity drift.
 */
export type BrowserUseAdapterLaneView = {
	lane_id: BrowserUseAdapterLaneId;
	/** The handoff contract this lane is keyed by (drift tripwire pins). */
	handoff: { contract_id: string; schema_version: string };
	native_implementation: BrowserUseLaneNativeImplementation;
	/** Consistent, or drifted when evidence integrity identities disagree. */
	integrity_state: "consistent" | "drifted";
	evidence: Record<BrowserUseLaneEvidenceClass, BrowserUseLaneEvidenceSlot>;
	/** Task capability claims backed by proven, integrity-consistent evidence. */
	proven_task_claims: readonly string[];
	/** Auth methods backed by proven, integrity-consistent conformance evidence. */
	advertised_auth_methods: readonly string[];
	/** Deterministic digest over this lane's composed evidence. */
	lane_evidence_digest: string;
	/** Present when any slot is stale or the lane drifted. */
	next_repair_action?: string;
};

export type BrowserUseAdapterLaneRegistry = {
	lanes: readonly BrowserUseAdapterLaneView[];
	/** Deterministic digest over every lane's composed evidence. */
	composed_digest: string;
};

// --- Typed rejections and failures --------------------------------------------

export type BrowserUseLaneEvidenceRejectionCode =
	| "lane_evidence_schema_extended"
	| "lane_evidence_schema_incomplete"
	| "lane_evidence_lane_unknown"
	| "lane_evidence_class_unknown"
	| "lane_evidence_producer_mismatch"
	| "lane_evidence_claim_unknown"
	| "lane_evidence_freshness_invalid"
	| "lane_evidence_digest_invalid"
	| "lane_evidence_duplicate_producer"
	| "lane_registry_clock_invalid";

export type BrowserUseLaneEvidenceRejection = {
	code: BrowserUseLaneEvidenceRejectionCode;
	message: string;
	/** Exactly one deterministic machine-readable repair action (R27, KTD4). */
	next_repair_action: string;
};

export type BrowserUseLaneRegistryResult =
	| { ok: true; registry: BrowserUseAdapterLaneRegistry }
	| { ok: false; rejection: BrowserUseLaneEvidenceRejection };

export type BrowserUseLaneResolutionFailure = {
	code: "lane_unknown" | "lane_alias_rejected";
	message: string;
};

export type BrowserUseLaneResolution =
	| { ok: true; lane: BrowserUseAdapterLaneView }
	| { ok: false; failure: BrowserUseLaneResolutionFailure };

// --- Registry construction -----------------------------------------------------

const REFERENCE_KEY_SET = new Set<string>(BROWSER_USE_LANE_EVIDENCE_REFERENCE_KEYS);
const INTEGRITY_KEY_SET = new Set<string>(BROWSER_USE_LANE_INTEGRITY_KEYS);

const REPAIR_STALE =
	"Re-run the lane conformance probe against the pinned adapter build; stale evidence never advertises capability.";
const REPAIR_DRIFTED =
	"Evidence integrity identities disagree for this lane; verify the pinned adapter build and re-probe before any claim is advertised.";

/**
 * Code-owned policy ceiling on producer-selected staleness windows (R4): a
 * window past this never admits, so no producer can grant itself effectively
 * permanent freshness.
 */
export const BROWSER_USE_LANE_EVIDENCE_MAX_STALE_AFTER_MS =
	30 * 24 * 60 * 60 * 1000;

// One deterministic repair action per rejection code (R27): the producer
// boundary repairs from this field alone, never by parsing prose.
const REJECTION_REPAIR_ACTIONS = {
	lane_evidence_schema_extended:
		"Remove every field outside the stable producer Interface key set and re-register the reference.",
	lane_evidence_schema_incomplete:
		"Populate every stable producer Interface field, including each integrity identity field as a non-empty string, and re-register the reference.",
	lane_evidence_lane_unknown:
		"Re-register the reference keyed by the envelope's attachment.adapter_id verbatim for a registered lane.",
	lane_evidence_class_unknown:
		"Re-register the reference under one registered evidence class from the code-owned class vocabulary.",
	lane_evidence_producer_mismatch:
		"Re-register the reference through the one producer that owns its evidence class.",
	lane_evidence_claim_unknown:
		"Restrict claims to the class's code-owned vocabulary for this lane and re-register the reference.",
	lane_evidence_freshness_invalid:
		"Re-probe and re-register with a non-negative safe-integer probe time and a positive staleness window within the registry's TTL ceiling.",
	lane_evidence_digest_invalid:
		"Recompute the evidence digest from the reference's exact registered content and re-register; an edited or replayed reference never admits.",
	lane_evidence_duplicate_producer:
		"Replace the existing reference for this lane and class with one re-probed reference; never register two.",
	lane_registry_clock_invalid:
		"Evaluate the registry with a non-negative safe-integer epoch-milliseconds clock.",
} as const satisfies Record<BrowserUseLaneEvidenceRejectionCode, string>;

function rejectionOf(
	code: BrowserUseLaneEvidenceRejectionCode,
	message: string,
): BrowserUseLaneEvidenceRejection {
	return { code, message, next_repair_action: REJECTION_REPAIR_ACTIONS[code] };
}

// Claim vocabulary per evidence class (R4): task claims draw from the lane's
// code-owned operation capabilities; auth claims draw from the auth method
// vocabulary; connection evidence carries no claims of its own (Browser
// Connect facts stay Browser Connect's — the registry composes, never copies).
function claimVocabularyFor(
	laneId: BrowserUseAdapterLaneId,
	evidenceClass: BrowserUseLaneEvidenceClass,
): readonly string[] {
	if (evidenceClass === "task") {
		return BROWSER_USE_ADAPTER_LANE_TABLE[laneId].operation_capabilities;
	}
	if (evidenceClass === "auth-conformance") {
		return BROWSER_USE_LANE_AUTH_METHODS;
	}
	return [];
}

/**
 * Compose an Adapter Lane Registry from producer-registered evidence (R3).
 * Every reference is admitted through the stable producer Interface: exact
 * key set, known lane, class-owning producer, known claims, and a recomputed
 * content digest. One producer per lane/class pair — a duplicate is a typed
 * rejection, never a merge.
 *
 * @param input - Producer evidence references and the caller's clock
 * @returns The composed registry, or one typed rejection
 */
export function createAdapterLaneRegistry(input: {
	evidence: readonly BrowserUseLaneEvidenceReference[];
	at_epoch_ms: number;
}): BrowserUseLaneRegistryResult {
	// Clock validation (R4, finding #3): a NaN or non-integer evaluation clock
	// makes both future-probe and expiry comparisons false, so expired evidence
	// would read as proven. An invalid clock composes nothing.
	if (!Number.isSafeInteger(input.at_epoch_ms) || input.at_epoch_ms < 0) {
		return {
			ok: false,
			rejection: rejectionOf(
				"lane_registry_clock_invalid",
				"registry evaluation clock must be a non-negative safe-integer epoch-milliseconds value; an invalid clock would revive stale evidence.",
			),
		};
	}
	const admitted = new Map<string, BrowserUseLaneEvidenceReference>();
	for (const reference of input.evidence) {
		const rejection = admitEvidenceReference(
			reference,
			admitted,
			input.at_epoch_ms,
		);
		if (rejection) return { ok: false, rejection };
		admitted.set(
			`${reference.lane_id}\0${reference.evidence_class}`,
			reference,
		);
	}
	const lanes = BROWSER_USE_ADAPTER_LANE_IDS.map((laneId) =>
		composeLaneView(laneId, admitted, input.at_epoch_ms),
	);
	const composed = createHash("sha256")
		.update(JSON.stringify(lanes.map((lane) => lane.lane_evidence_digest)))
		.digest("hex")
		.slice(0, 32);
	return { ok: true, registry: { lanes, composed_digest: composed } };
}

function admitEvidenceReference(
	reference: BrowserUseLaneEvidenceReference,
	admitted: ReadonlyMap<string, BrowserUseLaneEvidenceReference>,
	atEpochMs: number,
): BrowserUseLaneEvidenceRejection | undefined {
	// Exact-shape admission (R3/R4, finding #2): both key sets validate
	// bidirectionally. An extra field rides outside the digest's canonical
	// field set; a missing field would hash as null and admit an incomplete
	// identity — each fails closed before any producer or digest work.
	// The reference itself validates first: a null or non-object entry (a
	// deserialized producer payload is untrusted) is a typed rejection, never
	// an uncaught TypeError.
	if (
		typeof reference !== "object" ||
		reference === null ||
		Array.isArray(reference)
	) {
		return rejectionOf(
			"lane_evidence_schema_incomplete",
			"evidence reference must be a plain object over the stable producer Interface key set.",
		);
	}
	for (const key of Object.keys(reference)) {
		if (!REFERENCE_KEY_SET.has(key)) {
			return rejectionOf(
				"lane_evidence_schema_extended",
				`evidence field ${sanitizeUsageValue(key)} is not part of the stable producer Interface; producers never extend the registry schema.`,
			);
		}
	}
	for (const key of BROWSER_USE_LANE_EVIDENCE_REFERENCE_KEYS) {
		if ((reference as Record<string, unknown>)[key] === undefined) {
			return rejectionOf(
				"lane_evidence_schema_incomplete",
				`evidence field ${key} is missing; the stable producer Interface requires every field populated.`,
			);
		}
	}
	// String identity fields validate as non-empty strings before any use:
	// the rejection paths interpolate them through sanitizeUsageValue, which
	// itself requires a string — a number here must reject, never crash.
	for (const key of [
		"lane_id",
		"evidence_class",
		"producer",
		"evidence_digest",
	] as const) {
		const value = (reference as Record<string, unknown>)[key];
		if (typeof value !== "string" || value.length === 0) {
			return rejectionOf(
				"lane_evidence_schema_incomplete",
				`evidence field ${key} must be a non-empty string.`,
			);
		}
	}
	// Claims must be an array of unique non-empty strings: a null claims value
	// would crash the vocabulary loop, a string would iterate characters, and
	// a duplicate would perturb the digest without changing capability.
	const claims: unknown = reference.claims;
	if (
		!Array.isArray(claims) ||
		claims.some(
			(claim) => typeof claim !== "string" || claim.length === 0,
		) ||
		new Set(claims).size !== claims.length
	) {
		return rejectionOf(
			"lane_evidence_schema_incomplete",
			"evidence claims must be an array of unique non-empty claim strings.",
		);
	}
	// The nested integrity object is part of the same stable Interface and
	// validates the same way: plain object, exact key set, every identity
	// fact a non-empty string (never hashed as null).
	const integrity: unknown = reference.integrity;
	if (
		typeof integrity !== "object" ||
		integrity === null ||
		Array.isArray(integrity)
	) {
		return rejectionOf(
			"lane_evidence_schema_incomplete",
			"evidence integrity must be a plain object over the integrity identity key set.",
		);
	}
	for (const key of Object.keys(integrity)) {
		if (!INTEGRITY_KEY_SET.has(key)) {
			return rejectionOf(
				"lane_evidence_schema_extended",
				`integrity field ${sanitizeUsageValue(key)} is not part of the stable producer Interface; producers never extend the registry schema.`,
			);
		}
	}
	for (const key of BROWSER_USE_LANE_INTEGRITY_KEYS) {
		const value = (integrity as Record<string, unknown>)[key];
		if (typeof value !== "string" || value.length === 0) {
			return rejectionOf(
				"lane_evidence_schema_incomplete",
				`integrity field ${key} must be a non-empty string; an absent identity fact never admits.`,
			);
		}
	}
	if (
		!(BROWSER_USE_ADAPTER_LANE_IDS as readonly string[]).includes(
			reference.lane_id,
		)
	) {
		return rejectionOf(
			"lane_evidence_lane_unknown",
			`evidence names unknown lane ${sanitizeUsageValue(reference.lane_id)}; lanes are keyed by the envelope's attachment.adapter_id verbatim.`,
		);
	}
	// Class membership validates BEFORE producer lookup (finding #2): an
	// unknown class must fail as unknown, never ride an undefined producer.
	if (
		!(BROWSER_USE_LANE_EVIDENCE_CLASSES as readonly string[]).includes(
			reference.evidence_class,
		)
	) {
		return rejectionOf(
			"lane_evidence_class_unknown",
			`evidence class ${sanitizeUsageValue(reference.evidence_class)} is not a registered class; class membership validates before producer lookup.`,
		);
	}
	if (
		reference.producer !==
		BROWSER_USE_LANE_EVIDENCE_PRODUCERS[reference.evidence_class]
	) {
		return rejectionOf(
			"lane_evidence_producer_mismatch",
			`evidence class ${reference.evidence_class} is owned by producer ${BROWSER_USE_LANE_EVIDENCE_PRODUCERS[reference.evidence_class]}; each claim has exactly one producer.`,
		);
	}
	const vocabulary = claimVocabularyFor(
		reference.lane_id,
		reference.evidence_class,
	);
	for (const claim of reference.claims) {
		if (!vocabulary.includes(claim)) {
			return rejectionOf(
				"lane_evidence_claim_unknown",
				`claim ${sanitizeUsageValue(claim)} is unknown for evidence class ${reference.evidence_class} on lane ${reference.lane_id}; unknown claims fail closed.`,
			);
		}
	}
	// Freshness sanity (R4, finding #3): safe-integer probe times and windows
	// only (NaN/Infinity comparisons read as never-stale), a code-owned TTL
	// ceiling, and no expiry overflow past the safe-integer range.
	if (
		!Number.isSafeInteger(reference.probed_at_epoch_ms) ||
		reference.probed_at_epoch_ms < 0 ||
		!Number.isSafeInteger(reference.stale_after_ms) ||
		reference.stale_after_ms <= 0 ||
		reference.stale_after_ms > BROWSER_USE_LANE_EVIDENCE_MAX_STALE_AFTER_MS ||
		!Number.isSafeInteger(
			reference.probed_at_epoch_ms + reference.stale_after_ms,
		) ||
		reference.probed_at_epoch_ms > atEpochMs
	) {
		return rejectionOf(
			"lane_evidence_freshness_invalid",
			`evidence freshness is invalid for class ${reference.evidence_class} on lane ${reference.lane_id}: probe time and staleness window must be non-negative safe integers, the window positive and within the registry TTL ceiling, the expiry unoverflowed, and the probe not in the future.`,
		);
	}
	if (laneEvidenceDigestOf(reference) !== reference.evidence_digest) {
		return rejectionOf(
			"lane_evidence_digest_invalid",
			`evidence digest for class ${reference.evidence_class} on lane ${reference.lane_id} does not match its recomputed content; an edited or replayed reference is rejected.`,
		);
	}
	if (admitted.has(`${reference.lane_id}\0${reference.evidence_class}`)) {
		return rejectionOf(
			"lane_evidence_duplicate_producer",
			`evidence class ${reference.evidence_class} on lane ${reference.lane_id} already has a registered reference; one producer per claim class.`,
		);
	}
	return undefined;
}

function composeLaneView(
	laneId: BrowserUseAdapterLaneId,
	admitted: ReadonlyMap<string, BrowserUseLaneEvidenceReference>,
	atEpochMs: number,
): BrowserUseAdapterLaneView {
	const references = BROWSER_USE_LANE_EVIDENCE_CLASSES.flatMap(
		(evidenceClass) => {
			const reference = admitted.get(`${laneId}\0${evidenceClass}`);
			return reference ? [reference] : [];
		},
	);
	// Integrity binding (R4): every evidence reference for one lane must
	// describe one Implementation identity. A same-version replacement changes
	// the identity, so agreement is on the full identity tuple, never the
	// version string. integrityKeyOf is the shared field-order owner with the
	// evidence digest, so drift comparison and digest coverage cannot diverge.
	const identities = new Set(
		references.map((reference) => integrityKeyOf(reference.integrity)),
	);
	const drifted = identities.size > 1;
	let anyStale = false;
	const evidence = {} as Record<
		BrowserUseLaneEvidenceClass,
		BrowserUseLaneEvidenceSlot
	>;
	for (const evidenceClass of BROWSER_USE_LANE_EVIDENCE_CLASSES) {
		const reference = admitted.get(`${laneId}\0${evidenceClass}`);
		if (!reference) {
			evidence[evidenceClass] = { status: "unproven" };
			continue;
		}
		const stale =
			reference.probed_at_epoch_ms + reference.stale_after_ms < atEpochMs;
		if (stale) anyStale = true;
		evidence[evidenceClass] = {
			status: stale ? "stale" : "proven",
			evidence_digest: reference.evidence_digest,
			probed_at_epoch_ms: reference.probed_at_epoch_ms,
		};
	}
	const nativeImplementation =
		BROWSER_USE_ADAPTER_LANE_TABLE[laneId].native_implementation;
	const claimsFrom = (
		evidenceClass: BrowserUseLaneEvidenceClass,
	): readonly string[] => {
		if (drifted) return [];
		// Auth methods gate on a usable lane (R5, finding #1): a lane with no
		// implemented execution Interface cannot preserve same-lane execution,
		// so conformance evidence alone never advertises an auth method there.
		if (
			evidenceClass === "auth-conformance" &&
			!nativeImplementation.implemented
		) {
			return [];
		}
		if (evidence[evidenceClass].status !== "proven") return [];
		const reference = admitted.get(`${laneId}\0${evidenceClass}`);
		return reference ? [...reference.claims] : [];
	};
	const repair = drifted ? REPAIR_DRIFTED : anyStale ? REPAIR_STALE : undefined;
	const view: Omit<BrowserUseAdapterLaneView, "lane_evidence_digest"> = {
		lane_id: laneId,
		handoff: {
			contract_id: BROWSER_CONNECT_HANDOFF_CONTRACT_ID,
			schema_version: BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION,
		},
		native_implementation: nativeImplementation,
		integrity_state: drifted ? "drifted" : "consistent",
		evidence,
		proven_task_claims: claimsFrom("task"),
		advertised_auth_methods: claimsFrom("auth-conformance"),
		...(repair ? { next_repair_action: repair } : {}),
	};
	return { ...view, lane_evidence_digest: adapterLaneViewDigestOf(view) };
}

/**
 * Deterministic digest over one lane's complete material view (finding #4):
 * the handoff pin, native Implementation, per-class evidence state, integrity
 * state, derived claims, and repair state all participate. A consumer fencing
 * on this digest (or the registry composed_digest) therefore never treats two
 * materially different lane views as identical.
 *
 * @param view - Composed lane view without its digest
 * @returns 32-hex-char digest of the canonical material projection
 */
export function adapterLaneViewDigestOf(
	view: Omit<BrowserUseAdapterLaneView, "lane_evidence_digest">,
): string {
	const {
		lane_id,
		handoff,
		native_implementation,
		integrity_state,
		evidence,
		proven_task_claims,
		advertised_auth_methods,
		next_repair_action,
		...unprojected
	} = view;
	// Compile-time exhaustiveness: a new material field on the lane view lands
	// in `unprojected` and breaks this assignment until the digest projects it.
	const noUnprojectedMaterialField: Record<PropertyKey, never> = unprojected;
	void noUnprojectedMaterialField;
	const canonical = JSON.stringify([
		lane_id,
		[handoff.contract_id, handoff.schema_version],
		native_implementation.implemented
			? ["implemented", native_implementation.execution_interface]
			: [
					"unavailable",
					native_implementation.unavailable_reason,
					native_implementation.next_repair_action,
				],
		integrity_state,
		BROWSER_USE_LANE_EVIDENCE_CLASSES.map((evidenceClass) => [
			evidence[evidenceClass].evidence_digest ?? null,
			evidence[evidenceClass].status,
			evidence[evidenceClass].probed_at_epoch_ms ?? null,
		]),
		[...proven_task_claims],
		[...advertised_auth_methods],
		next_repair_action ?? null,
	]);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

// --- Lane resolution -----------------------------------------------------------

/**
 * Resolve one lane by exact handoff adapter id (R3, AE1). A known identity
 * alias is rejected with the exact-id rule, never silently mapped; an unknown
 * id fails closed before any evidence or secret work.
 *
 * @param registry - Composed lane registry
 * @param requestedId - Caller-supplied adapter id
 * @returns The lane view, or one typed resolution failure
 */
export function resolveAdapterLane(
	registry: BrowserUseAdapterLaneRegistry,
	requestedId: string,
): BrowserUseLaneResolution {
	const lane = registry.lanes.find((entry) => entry.lane_id === requestedId);
	if (lane) return { ok: true, lane };
	// Own-key lookup only: a prototype-chain id ("toString", "constructor",
	// "__proto__") must resolve as unknown, not as an inherited alias hit.
	const aliasTarget = Object.hasOwn(BROWSER_USE_REJECTED_LANE_ALIASES, requestedId)
		? BROWSER_USE_REJECTED_LANE_ALIASES[requestedId]
		: undefined;
	if (aliasTarget) {
		return {
			ok: false,
			failure: {
				code: "lane_alias_rejected",
				message: `id ${sanitizeUsageValue(requestedId)} is a rejected identity alias; key lanes by the envelope's attachment.adapter_id verbatim (${aliasTarget}).`,
			},
		};
	}
	return {
		ok: false,
		failure: {
			code: "lane_unknown",
			message: `id ${sanitizeUsageValue(requestedId)} is not a registered Browser Use adapter lane.`,
		},
	};
}

