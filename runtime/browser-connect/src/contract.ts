// ---------------------------------------------------------------------------
// Verified Handoff Envelope payload contract (KTD6/R8).
//
// Value-free by design: this module declares only types so consumers can
// `import type` the envelope payload shape without pulling any browser-connect
// runtime into their bundle. The leaf unions are declared as literal unions
// here; `model.ts` keeps the runtime const arrays and enforces compile-time
// parity in both directions, so the literals cannot drift.
//
// Consumers pin the contract id and schema version LOCALLY (Decision 1): a
// schema rev must fail closed on an unrevised consumer, so those constants are
// deliberately not exported from here.
// ---------------------------------------------------------------------------

/**
 * Environment name union (vocabulary: Human Chrome / Agent Chrome). v1 has
 * exactly one Agent Chrome instance; future multi-identity means multiple
 * Agent Chrome instances distinguished by envelope environment identity,
 * never new environment names.
 *
 * Runtime source: `BROWSER_CONNECT_ENVIRONMENT_NAMES` in `model.ts`.
 */
export type BrowserConnectEnvironmentName = "agent-chrome";

/**
 * Route id union — also the browser-entry mode vocabulary the envelope names
 * (R16): the door through which the browser session is entered. Three-door
 * route model (KTD7); slice one implements `explicit-cdp` only.
 *
 * Runtime source: `BROWSER_CONNECT_ROUTES` in `model.ts`.
 */
export type BrowserConnectRouteId = "explicit-cdp" | "ui-consent" | "extension";

/**
 * Evidence status a route capability carries per Adapter Definition (KTD7).
 *
 * Runtime source: `BROWSER_CONNECT_ROUTE_EVIDENCE_STATUSES` in `model.ts`.
 */
export type BrowserConnectRouteEvidenceStatus =
	| "verified-live"
	| "documented"
	| "candidate";

/**
 * Environment identity (R2): whose browser this is. v1 names exactly one
 * Agent Chrome; future multi-identity distinguishes instances here.
 */
export type BrowserConnectEnvironmentIdentity = {
	name: BrowserConnectEnvironmentName;
};

/**
 * Verified endpoint forms (R2). Both forms come verbatim from the environment
 * proof (structured ok-envelope exemption — the JSON envelope is the one
 * surface that carries the verified websocket URL intact); neither is ever
 * derived from the port convention.
 */
export type BrowserConnectVerifiedEndpoint = {
	http: string;
	ws: string;
};

/**
 * The specific adapter attachment the envelope authorizes (R16). The
 * `probe_executable` names which executable performed the attachment probe
 * (R4: proof names a handshake the adapter itself performed).
 */
export type BrowserConnectAuthorizedAttachment = {
	adapter_id: string;
	route: BrowserConnectRouteId;
	probe_executable: string;
};

/**
 * Launch provenance (R3): mandatory structured field on every envelope.
 * `launched` is true only when browser-connect launched Agent Chrome during
 * this run.
 */
export type BrowserConnectLaunchProvenance = {
	launched: boolean;
};

/**
 * Proof evidence summary (R2): names the environment proof contract that
 * vouched for the endpoint and the declared evidence status of the authorized
 * route.
 */
export type BrowserConnectProofEvidence = {
	environment_contract_id: string;
	environment_schema_version: string;
	route_evidence: BrowserConnectRouteEvidenceStatus;
};

/**
 * Verified handoff payload (R2/R16): decision-complete in one read — names
 * the browser-entry mode and the specific adapter attachment it authorizes.
 * Run-id correlation stays facade-owned on the outer runtime envelope
 * (`run_id`, caller-suppliable, warm-chrome `--run-id` parity).
 */
export type BrowserConnectHandoffPayload = {
	outcome: "verified";
	environment: BrowserConnectEnvironmentIdentity;
	browser_entry_mode: BrowserConnectRouteId;
	attachment: BrowserConnectAuthorizedAttachment;
	endpoint: BrowserConnectVerifiedEndpoint;
	launch: BrowserConnectLaunchProvenance;
	proof: BrowserConnectProofEvidence;
};
