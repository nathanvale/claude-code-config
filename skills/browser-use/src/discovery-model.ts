// ---------------------------------------------------------------------------
// Live discovery model (migration U2, KTD4).
//
// Owns the discovery-facing types the live browser-use modules share
// (discovery, selection, operations, core) plus the registry-aligned adapter
// id / capability aliases. Hoisted out of the dormant Browser Adapter Router
// model so live code carries no import edge into the dormant router cluster;
// the dormant model re-imports the aliases from here (one-way dormant->live).
// ---------------------------------------------------------------------------

import type { AdapterSessionReleaseDebt } from "@side-quest/browser-connect/adapters";
import { BROWSER_USE_ADAPTER_LANE_IDS } from "./browser-use-adapter-model";
import type { BrowserAdapterRouterCapability } from "./command-contract";

// Live adapter identity (migration U4, KTD5; ownership moved to the Adapter
// Lane Registry model in auth plan U1, R3): browser-use keys adapters on the
// envelope's `attachment.adapter_id` verbatim — one adapter vocabulary across
// the browser-connect seam, owned by browser-use-adapter-model and re-exported
// here for the live discovery/selection/operations surfaces. Membership is
// known identity, not routability: agent-browser and playwright-cdp are
// registered with no implemented transport (BROWSER_USE_TRANSPORT_ADAPTERS
// gates that separately, derived from the same lane table).
export const BROWSER_USE_LIVE_ADAPTERS = BROWSER_USE_ADAPTER_LANE_IDS;
export type BrowserAdapterId = (typeof BROWSER_USE_LIVE_ADAPTERS)[number];
// Capability names stay sourced from the retained R9 vocabulary; only the
// adapter-id axis re-pointed to envelope ids.
export type AdapterCapability = BrowserAdapterRouterCapability;

// ---------------------------------------------------------------------------
// Browser Target Discovery (U5, evidence re-based in migration U1).
// `browser-use targets list` discovers Browser Target Candidates in two modes:
//   - handoff-bound: a browser-connect Verified Handoff Envelope ->
//     operation-ready candidates that can feed `targets select` and `operate`.
//   - recovery: requested adapter + optional handoff evidence (verified, a
//     connect failure state, or explicit no-evidence entry) ->
//     evidence-gathering candidates only.
// The binding tuple derives from envelope fields (KTD1): browser-use computes
// its own handoff evidence id; browser-connect's envelope schema is untouched.
// ---------------------------------------------------------------------------

export type TargetDiscoveryMode = "recovery" | "handoff-bound";

// Display-safe candidate facts (R32, KTD6, KTD7). The candidate ordinal is the
// only public target handle (scoped to one target envelope, R21); `origin` and
// `path_shape` are redaction-gated projections. Raw adapter page ids, CDP target
// ids, query strings, fragments, and auth-bearing path segments never appear
// here — display facts stay separate from any machine evidence.
export type BrowserTargetCandidate = {
	// Candidate ordinal scoped to the target envelope (R21). Public target handle.
	candidate_ordinal: number;
	// Stable per-envelope candidate id. Derived from the target envelope id and
	// ordinal, never from raw adapter page/CDP ids (R32, KTD6).
	candidate_id: string;
	// Redacted origin (scheme + host + port). Empty when the raw url is unparsable.
	origin: string;
	// Redacted path shape: pathname only, no query string or fragment. Present
	// only when `--show-url` is requested (R32, AE11).
	path_shape?: string;
	// Redacted, length-bounded page title. Semantic Browser Target Hint surface.
	title?: string;
};

// Handoff-derived binding the discovery envelope carries. Recovery mode may
// omit the identity slice (no verified endpoint / evidence id) because
// recovery candidates are never operation-authorized (R20, R25) and a connect
// failure state or no-evidence entry carries no verified identity.
export type TargetDiscoveryBinding = {
	run_id: string;
	selected_adapter_id: BrowserAdapterId;
	// Target envelope id scopes candidate ordinals (R21). Content hash over the
	// run-scoped binding facts (run id, mode, adapter, handoff evidence id); no
	// clock or randomness. In handoff-bound mode the run id comes from the
	// envelope, so re-running against the same handoff yields the same envelope
	// id. In recovery mode the run id is the per-invocation run id, so the
	// envelope id scopes ordinals within one listing.
	target_envelope_id: string;
	// Identity slice, present when discovery ran from a verified handoff:
	// host:port of the verified endpoint, and browser-use's content hash over
	// the envelope's binding-relevant fields (KTD1). Required for an
	// operation-ready listing; `targets select` and `operate` fail closed on
	// mismatched or cross-run evidence through these.
	verified_endpoint_identity?: string;
	handoff_evidence_id?: string;
};

export type TargetDiscoveryEnvelope = {
	// Self-describing result identity (BROWSER_USE_TARGETS_CONTRACT_ID + schema
	// version): `targets select` positively identifies its input by these, so a
	// hand-written or foreign envelope cannot pass.
	contract: string;
	schema_version: string;
	mode: TargetDiscoveryMode;
	// R20: recovery candidates are evidence-gathering only; handoff-bound
	// candidates are operation-ready. These flags are the gate `targets select`
	// and `operate` read to reject recovery candidates (R25).
	handoff_bound: boolean;
	operation_ready: boolean;
	requested_adapter: BrowserAdapterId;
	binding: TargetDiscoveryBinding;
	candidate_count: number;
	candidates: readonly BrowserTargetCandidate[];
	release?: AdapterSessionReleaseDebt;
};
