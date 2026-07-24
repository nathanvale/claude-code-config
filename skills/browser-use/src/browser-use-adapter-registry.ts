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
	| "lane_evidence_lane_unknown"
	| "lane_evidence_producer_mismatch"
	| "lane_evidence_claim_unknown"
	| "lane_evidence_freshness_invalid"
	| "lane_evidence_digest_invalid"
	| "lane_evidence_duplicate_producer";

export type BrowserUseLaneEvidenceRejection = {
	code: BrowserUseLaneEvidenceRejectionCode;
	message: string;
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
	for (const key of Object.keys(reference)) {
		if (!REFERENCE_KEY_SET.has(key)) {
			return {
				code: "lane_evidence_schema_extended",
				message: `evidence field ${sanitizeUsageValue(key)} is not part of the stable producer Interface; producers never extend the registry schema.`,
			};
		}
	}
	// The nested integrity object is part of the same stable Interface: an
	// extra field there would ride outside the digest's canonical field set,
	// so it is a schema extension exactly like a top-level one.
	for (const key of Object.keys(reference.integrity)) {
		if (!INTEGRITY_KEY_SET.has(key)) {
			return {
				code: "lane_evidence_schema_extended",
				message: `integrity field ${sanitizeUsageValue(key)} is not part of the stable producer Interface; producers never extend the registry schema.`,
			};
		}
	}
	// Freshness sanity (R4): a non-finite window or a probe claiming to come
	// from the future would read as proven forever (NaN comparisons are false
	// and JSON canonicalization folds Infinity/NaN to null on both digest
	// sides), so the window itself is admission-checked.
	if (
		!Number.isFinite(reference.probed_at_epoch_ms) ||
		!Number.isFinite(reference.stale_after_ms) ||
		reference.stale_after_ms <= 0 ||
		reference.probed_at_epoch_ms > atEpochMs
	) {
		return {
			code: "lane_evidence_freshness_invalid",
			message:
				"evidence freshness is invalid: probe time and staleness window must be finite, the window positive, and the probe not in the future.",
		};
	}
	if (
		!(BROWSER_USE_ADAPTER_LANE_IDS as readonly string[]).includes(
			reference.lane_id,
		)
	) {
		return {
			code: "lane_evidence_lane_unknown",
			message: `evidence names unknown lane ${sanitizeUsageValue(reference.lane_id)}; lanes are keyed by the envelope's attachment.adapter_id verbatim.`,
		};
	}
	if (
		reference.producer !==
		BROWSER_USE_LANE_EVIDENCE_PRODUCERS[reference.evidence_class]
	) {
		return {
			code: "lane_evidence_producer_mismatch",
			message: `evidence class ${reference.evidence_class} is owned by producer ${BROWSER_USE_LANE_EVIDENCE_PRODUCERS[reference.evidence_class]}; each claim has exactly one producer.`,
		};
	}
	const vocabulary = claimVocabularyFor(
		reference.lane_id,
		reference.evidence_class,
	);
	for (const claim of reference.claims) {
		if (!vocabulary.includes(claim)) {
			return {
				code: "lane_evidence_claim_unknown",
				message: `claim ${sanitizeUsageValue(claim)} is unknown for evidence class ${reference.evidence_class} on lane ${reference.lane_id}; unknown claims fail closed.`,
			};
		}
	}
	if (laneEvidenceDigestOf(reference) !== reference.evidence_digest) {
		return {
			code: "lane_evidence_digest_invalid",
			message:
				"evidence digest does not match its recomputed content; an edited or replayed reference is rejected.",
		};
	}
	if (admitted.has(`${reference.lane_id}\0${reference.evidence_class}`)) {
		return {
			code: "lane_evidence_duplicate_producer",
			message: `evidence class ${reference.evidence_class} on lane ${reference.lane_id} already has a registered reference; one producer per claim class.`,
		};
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
	const claimsFrom = (
		evidenceClass: BrowserUseLaneEvidenceClass,
	): readonly string[] => {
		if (drifted) return [];
		if (evidence[evidenceClass].status !== "proven") return [];
		const reference = admitted.get(`${laneId}\0${evidenceClass}`);
		return reference ? [...reference.claims] : [];
	};
	// Lane digest binds the composed VIEW, not just the evidence set: the same
	// references evaluated fresh vs stale advertise different claims, so status
	// and integrity state participate in the hash. A consumer fencing on this
	// digest (or the registry composed_digest) therefore never treats two
	// materially different capability views as identical.
	const laneDigest = createHash("sha256")
		.update(
			JSON.stringify([
				laneId,
				BROWSER_USE_LANE_EVIDENCE_CLASSES.map((evidenceClass) => [
					evidence[evidenceClass].evidence_digest ?? null,
					evidence[evidenceClass].status,
				]),
				drifted ? "drifted" : "consistent",
			]),
		)
		.digest("hex")
		.slice(0, 32);
	const repair = drifted ? REPAIR_DRIFTED : anyStale ? REPAIR_STALE : undefined;
	return {
		lane_id: laneId,
		handoff: {
			contract_id: BROWSER_CONNECT_HANDOFF_CONTRACT_ID,
			schema_version: BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION,
		},
		native_implementation:
			BROWSER_USE_ADAPTER_LANE_TABLE[laneId].native_implementation,
		integrity_state: drifted ? "drifted" : "consistent",
		evidence,
		proven_task_claims: claimsFrom("task"),
		advertised_auth_methods: claimsFrom("auth-conformance"),
		lane_evidence_digest: laneDigest,
		...(repair ? { next_repair_action: repair } : {}),
	};
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

