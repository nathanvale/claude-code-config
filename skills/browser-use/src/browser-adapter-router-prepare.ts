// Browser Adapter Router `prepare` assembler (plan U1, R1-R7).
//
// prepare is a pure on-ramp: it reads supplied proof/report/discovery envelopes
// plus task and policy facts, then assembles a RouteEvidenceEnvelope that
// `browser-adapter-router route` accepts (R5, AE3). It never runs Warm Chrome
// Preflight, Browser Adapter Proof, Router report, or target discovery (R7).
//
// Missing or invalid facts do not throw: they aggregate into `missing_facts[]`
// and resolve to one canonical continuation chosen in dependency order
// prove_warm_chrome -> discover_capability_report -> prove_adapter_attachment ->
// change_prepare_input (R6). runtime_actions still lists every relevant action.

import {
	WARM_CHROME_PREFLIGHT_CONTRACT_ID,
	BROWSER_ADAPTER_PROOF_CONTRACT_ID,
	type BrowserAdapterRouterBundle,
	type BrowserAdapterRouterMode,
	type BrowserAdapterRouterPrepareDiagnosticCode,
} from "./command-contract";
import type {
	AdapterCapability,
	BrowserAdapterId,
	CapabilityReport,
	RouteEvidenceEnvelope,
	RoutePolicy,
	RouteTask,
} from "./browser-adapter-router-model";
import { validateCapabilityReport } from "./browser-adapter-router-report-validation";

// Default freshness window stamped onto the assembled precondition block. The
// proofs prepare consumes do not carry a route-level freshness window, so prepare
// stamps the evaluation date as `checked_at` and a conservative stale window.
// Route evaluation still fails closed if the date is later staled (R17a).
const PREPARE_FRESHNESS_STALE_AFTER_DAYS = 1 as const;

export type PrepareMissingFactKind =
	| "warm_chrome_proof"
	| "capability_report"
	| "adapter_proof"
	| "prepare_input";

export type PrepareMissingFact = {
	kind: PrepareMissingFactKind;
	code: BrowserAdapterRouterPrepareDiagnosticCode;
	detail: string;
};

export type PrepareInputs = {
	// Already-read file contents keyed by role. Undefined when the flag was
	// omitted. prepare does not perform I/O — the CLI driver reads files and
	// passes raw strings here so the assembler stays pure and testable.
	warmChromeProofRaw?: string;
	adapterProofRaw?: string;
	reportRaws: readonly string[];
	targetDiscoveryRaw?: string;
	mode?: BrowserAdapterRouterMode;
	adapter?: BrowserAdapterId;
	fallbackAllowed?: boolean;
	bundle?: BrowserAdapterRouterBundle;
	capabilities: readonly AdapterCapability[];
	targetOrigin?: string;
	// Run id stamped into the assembled envelope when no proof supplies one.
	fallbackRunId?: string;
	evaluationDate: string;
};

export type PrepareSuccess = {
	ok: true;
	envelope: RouteEvidenceEnvelope;
	route_input_mode: BrowserAdapterRouterMode;
	next_command_intent: "route";
};

export type PrepareFailure = {
	ok: false;
	missing_facts: PrepareMissingFact[];
};

export type PrepareResult = PrepareSuccess | PrepareFailure;

// Dependency order for the canonical continuation (R6). Earlier kinds win.
const MISSING_FACT_PRIORITY: readonly PrepareMissingFactKind[] = [
	"warm_chrome_proof",
	"capability_report",
	"adapter_proof",
	"prepare_input",
];

export function canonicalMissingFact(
	missing: readonly PrepareMissingFact[],
): PrepareMissingFact | undefined {
	for (const kind of MISSING_FACT_PRIORITY) {
		const found = missing.find((fact) => fact.kind === kind);
		if (found) return found;
	}
	return missing[0];
}

export function assemblePrepare(inputs: PrepareInputs): PrepareResult {
	const missing: PrepareMissingFact[] = [];

	// --- Policy facts (R4). mode defaults to auto; force/prefer need an adapter.
	const mode: BrowserAdapterRouterMode = inputs.mode ?? "auto";
	if ((mode === "force" || mode === "prefer") && !inputs.adapter) {
		missing.push({
			kind: "prepare_input",
			code: "prepare_input_invalid",
			detail: `mode ${mode} requires --adapter <id>.`,
		});
	}

	// --- Warm Chrome proof (R3). Presence + ok proof => warm_chrome_ready.
	const warmChrome = parseProofEnvelope(
		inputs.warmChromeProofRaw,
		WARM_CHROME_PREFLIGHT_CONTRACT_ID,
	);
	if (!inputs.warmChromeProofRaw) {
		missing.push({
			kind: "warm_chrome_proof",
			code: "prepare_warm_chrome_missing",
			detail: "Warm Chrome proof not supplied (--warm-chrome-proof).",
		});
	} else if (!warmChrome.ok) {
		missing.push({
			kind: "warm_chrome_proof",
			code: "prepare_warm_chrome_missing",
			detail: `Warm Chrome proof is not a verified proof: ${warmChrome.detail}`,
		});
	}

	// --- Capability reports (R3). At least one valid report is required to route.
	const reports: CapabilityReport[] = [];
	for (const [index, raw] of inputs.reportRaws.entries()) {
		const parsed = parseReport(raw);
		if (parsed.ok) {
			reports.push(parsed.report);
		} else {
			missing.push({
				kind: "prepare_input",
				code: "prepare_input_invalid",
				detail: `--report[${index}] is invalid: ${parsed.detail}`,
			});
		}
	}
	if (inputs.reportRaws.length === 0) {
		missing.push({
			kind: "capability_report",
			code: "prepare_report_missing",
			detail: "No capability report supplied (--report).",
		});
	}

	// --- Adapter proof (R3). Presence + ok proof => attachment for that adapter.
	const adapterProof = parseAdapterProof(inputs.adapterProofRaw);
	if (!inputs.adapterProofRaw) {
		missing.push({
			kind: "adapter_proof",
			code: "prepare_adapter_proof_missing",
			detail: "Browser Adapter Proof not supplied (--adapter-proof).",
		});
	} else if (!adapterProof.ok) {
		missing.push({
			kind: "adapter_proof",
			code: "prepare_adapter_proof_missing",
			detail: `Browser Adapter Proof is not a verified proof: ${adapterProof.detail}`,
		});
	}

	// --- Cross-run binding (R6, R9 basic): adapter proof must tie to warm chrome.
	if (warmChrome.ok && adapterProof.ok) {
		if (adapterProof.warmChromeRunId !== warmChrome.runId) {
			missing.push({
				kind: "prepare_input",
				code: "prepare_input_invalid",
				detail:
					"Adapter proof warm Chrome run id does not match the warm Chrome proof run id.",
			});
		}
	}

	// --- Optional target discovery precondition (R3). When supplied it must be a
	// recovery-mode discovery envelope; malformed input is a prepare input error.
	let targetOriginObserved: string | undefined;
	if (inputs.targetDiscoveryRaw !== undefined) {
		const discovery = parseTargetDiscovery(inputs.targetDiscoveryRaw);
		if (!discovery.ok) {
			missing.push({
				kind: "prepare_input",
				code: "prepare_input_invalid",
				detail: `--target-discovery is invalid: ${discovery.detail}`,
			});
		} else {
			targetOriginObserved = discovery.observedOrigin;
		}
	}

	if (missing.length > 0) {
		return { ok: false, missing_facts: missing };
	}

	// All facts present. Assemble a route-acceptable envelope. The non-null
	// assertions are safe: the missing-fact checks above guarantee these.
	const runId =
		warmChrome.ok && warmChrome.runId
			? warmChrome.runId
			: (inputs.fallbackRunId ?? "prepare-run");
	const adapterId = adapterProof.ok ? adapterProof.adapter : undefined;
	// Proof binding (plan U2 R8). When the adapter proof verifies, prepare emits
	// run-scoped binding identity so the route it produces is operation-capable:
	// route success surfaces this binding for the Browser Operation Front Door.
	const proofBinding =
		adapterProof.ok && adapterId
			? {
					warm_chrome_run_id: adapterProof.warmChromeRunId,
					adapter_proof: {
						[adapterId]: {
							adapter_proof_id: adapterProof.adapterProofId,
							warm_chrome_run_id: adapterProof.warmChromeRunId,
							verified_endpoint_identity:
								adapterProof.verifiedEndpointIdentity,
						},
					},
				}
			: undefined;

	const policy: RoutePolicy = {
		mode,
		...(inputs.adapter ? { adapter_id: inputs.adapter } : {}),
		...(inputs.fallbackAllowed !== undefined
			? { fallback_allowed: inputs.fallbackAllowed }
			: {}),
	};

	const task: RouteTask = {
		...(inputs.bundle ? { bundle: inputs.bundle } : {}),
		...(inputs.capabilities.length > 0
			? { required_capabilities: [...inputs.capabilities] }
			: {}),
	};

	const envelope: RouteEvidenceEnvelope = {
		run_id: runId,
		policy,
		task,
		preconditions: {
			run_id: runId,
			freshness: {
				checked_at: inputs.evaluationDate,
				stale_after_days: PREPARE_FRESHNESS_STALE_AFTER_DAYS,
			},
			warm_chrome_ready: true,
			...(adapterId
				? { adapter_attached_verified_browser: { [adapterId]: true } }
				: {}),
			...(proofBinding ?? {}),
			...(inputs.targetOrigin
				? {
						target_origin: {
							required: true,
							expected: inputs.targetOrigin,
							...(targetOriginObserved
								? { observed: targetOriginObserved }
								: {}),
						},
					}
				: {}),
		},
		reports,
	};

	return {
		ok: true,
		envelope,
		route_input_mode: mode,
		next_command_intent: "route",
	};
}

// --- Proof / report / discovery parsers ----------------------------------

type ProofParse =
	| { ok: true; runId: string }
	| { ok: false; detail: string };

// A proof envelope is the JSON the warm-chrome / adapter preflight emits:
// { status: "ok", run_id, data: { ok: true, contract, ... } }. prepare treats a
// present, ok, contract-matching envelope as evidence; anything else is "not a
// verified proof" and routes to the proof's recovery action.
function parseProofEnvelope(
	raw: string | undefined,
	expectedContract: string,
): ProofParse {
	if (raw === undefined) return { ok: false, detail: "not supplied" };
	const value = safeJsonObject(raw);
	if (!value) return { ok: false, detail: "not valid JSON object" };
	if (value.status !== "ok") {
		return { ok: false, detail: "proof status is not ok" };
	}
	const data = isJsonObject(value.data) ? value.data : undefined;
	if (!data || data.ok !== true) {
		return { ok: false, detail: "proof data is not a success proof" };
	}
	if (data.contract !== expectedContract) {
		return { ok: false, detail: "proof contract id does not match" };
	}
	const runId =
		typeof value.run_id === "string" && value.run_id !== ""
			? value.run_id
			: undefined;
	if (!runId) return { ok: false, detail: "proof run id missing" };
	return { ok: true, runId };
}

type AdapterProofParse =
	| {
			ok: true;
			adapter: BrowserAdapterId;
			warmChromeRunId: string;
			adapterProofId: string;
			verifiedEndpointIdentity: string;
	  }
	| { ok: false; detail: string };

function parseAdapterProof(raw: string | undefined): AdapterProofParse {
	if (raw === undefined) return { ok: false, detail: "not supplied" };
	const base = parseProofEnvelope(raw, BROWSER_ADAPTER_PROOF_CONTRACT_ID);
	if (!base.ok) return base;
	const value = safeJsonObject(raw);
	const data = value && isJsonObject(value.data) ? value.data : undefined;
	const adapter = data?.adapter;
	if (typeof adapter !== "string") {
		return { ok: false, detail: "adapter id missing" };
	}
	const warmChromeRunId = data?.warm_chrome_run_id;
	if (typeof warmChromeRunId !== "string" || warmChromeRunId === "") {
		return { ok: false, detail: "warm Chrome run id missing" };
	}
	const adapterProofId = data?.adapter_proof_id;
	if (typeof adapterProofId !== "string" || adapterProofId === "") {
		return { ok: false, detail: "adapter proof id missing" };
	}
	const verifiedEndpointIdentity = data?.verified_endpoint_identity;
	if (
		typeof verifiedEndpointIdentity !== "string" ||
		verifiedEndpointIdentity === ""
	) {
		return { ok: false, detail: "verified endpoint identity missing" };
	}
	return {
		ok: true,
		adapter: adapter as BrowserAdapterId,
		warmChromeRunId,
		adapterProofId,
		verifiedEndpointIdentity,
	};
}

type ReportParse =
	| { ok: true; report: CapabilityReport }
	| { ok: false; detail: string };

// A report file may be a bare capability report or a Router `report` success
// envelope ({ status, data: { report } }). Both resolve to the validated report.
function parseReport(raw: string): ReportParse {
	const value = safeJsonValue(raw);
	if (value === undefined) return { ok: false, detail: "not valid JSON" };
	const candidate = unwrapReport(value);
	// prepare only rejects schema-invalid reports so the envelope route receives
	// is well-formed; route evaluation owns the attachment-incompatible decision.
	const result = validateCapabilityReport(candidate);
	if (!result.ok) {
		return { ok: false, detail: result.diagnostics.join("; ") };
	}
	return { ok: true, report: result.report };
}

function unwrapReport(value: unknown): unknown {
	if (!isJsonObject(value)) return value;
	// Router report success envelope shape.
	if (isJsonObject(value.data)) {
		if (isJsonObject(value.data.report)) return value.data.report;
		// `report --capability` projects a single capability, not a full report;
		// that projection is not a routable report input.
	}
	return value;
}

type TargetDiscoveryParse =
	| { ok: true; observedOrigin?: string }
	| { ok: false; detail: string };

// Target discovery feeds an optional target_origin observed value. U1 keeps this
// shallow: a present JSON object is accepted; richer recovery-mode binding is U5.
function parseTargetDiscovery(raw: string): TargetDiscoveryParse {
	const value = safeJsonObject(raw);
	if (!value) return { ok: false, detail: "not valid JSON object" };
	const data = isJsonObject(value.data) ? value.data : value;
	const observed = data.observed_origin;
	return {
		ok: true,
		...(typeof observed === "string" && observed !== ""
			? { observedOrigin: observed }
			: {}),
	};
}

function safeJsonValue(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function safeJsonObject(raw: string): Record<string, unknown> | undefined {
	const value = safeJsonValue(raw);
	return isJsonObject(value) ? value : undefined;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
