import { createHash } from "node:crypto";
import {
	BROWSER_ADAPTER_ROUTER_ADAPTERS,
	BROWSER_ADAPTER_ROUTER_COMPATIBLE_ATTACHMENT_MODEL,
	BROWSER_ADAPTER_ROUTER_MIN_ROUTE_CONFIDENCE,
	type BrowserAdapterRouterBundle,
	type BrowserAdapterRouterDiagnosticCode,
	type BrowserAdapterRouterMode,
} from "./command-contract";
import type {
	AdapterCapability,
	BrowserAdapterId,
	BrowserOperationClass,
	CapabilityReport,
	CapabilityReportProvenance,
	CandidateDecision,
	MediaProofMetadata,
	ResearchRecovery,
	RouteBinding,
	RouteEvidenceFreshness,
	RouteEvaluation,
	RouteFailure,
	RoutePolicy,
	RoutePreconditionEvidence,
	RouteSuccess,
	RouteTask,
	RouterFailureActionId,
} from "./browser-adapter-router-model";
import type { ValidatedRouteEvidenceEnvelope } from "./browser-adapter-router-validation";
import { continuationForCode } from "./browser-adapter-router-recovery";

const CHROME_DEVTOOLS_DOCS_URL =
	"https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session";

// Numeric research signals are capped below the route threshold (plan Capability
// Discovery V1: "Numeric research signals are capped below the route
// threshold"). Docs-only evidence can never reach routable confidence.
const MAX_RESEARCH_SIGNAL = BROWSER_ADAPTER_ROUTER_MIN_ROUTE_CONFIDENCE - 1;

// ---------------------------------------------------------------------------
// Bundle resolution (R5a). Task-facing bundle names resolve to concrete
// required capabilities before routing. Exact members stay runtime-owned.
// ---------------------------------------------------------------------------

const BUNDLE_CAPABILITIES = {
	snapshot_page_action: ["snapshot_refs", "element_actions", "screenshot_media"],
	visual_proof_capture: ["screenshot_media"],
	runtime_debug_inspection: ["network_inspection", "console_debug"],
	performance_profile: ["performance_profile"],
	runbook_step_execution: [
		"snapshot_refs",
		"element_actions",
		"selector_actions",
	],
} as const satisfies Record<
	BrowserAdapterRouterBundle,
	readonly AdapterCapability[]
>;

export function resolveRequiredCapabilities(
	task: RouteTask,
): AdapterCapability[] {
	// Guard the lookup: an unknown bundle name resolves to no bundle capabilities
	// rather than spreading `undefined`. parseEvidenceEnvelope already rejects
	// unknown bundle names, so this is defense in depth.
	const fromBundle = task.bundle ? (BUNDLE_CAPABILITIES[task.bundle] ?? []) : [];
	const merged = new Set<AdapterCapability>([
		...fromBundle,
		...(task.required_capabilities ?? []),
	]);
	return [...merged];
}

// ---------------------------------------------------------------------------
// Operation capability mapping (U2 R10, R11). Each Browser Operation class
// authorizes only when its required capability is present in the route's
// authorized capability set. Runtime-owned so the public operation vocabulary
// never leaks adapter method names.
// ---------------------------------------------------------------------------

const OPERATION_CLASS_CAPABILITY = {
	snapshot: "snapshot_refs",
	screenshot: "screenshot_media",
	emulate: "viewport_emulation",
} as const satisfies Record<BrowserOperationClass, AdapterCapability>;

// Capabilities that authorize a Browser Operation class (U2 R12). A route that
// requests any of these is operation-capable and must carry proof binding.
const OPERATION_CAPABILITIES = new Set<AdapterCapability>(
	Object.values(OPERATION_CLASS_CAPABILITY),
);

function requestsOperationCapability(
	requiredCapabilities: readonly AdapterCapability[],
): boolean {
	return requiredCapabilities.some((cap) => OPERATION_CAPABILITIES.has(cap));
}

export function authorizesOperationClass(
	binding: RouteBinding,
	operationClass: BrowserOperationClass,
): boolean {
	const required = OPERATION_CLASS_CAPABILITY[operationClass];
	return binding.authorized_capabilities.includes(required);
}

// ---------------------------------------------------------------------------
// Freshness (R17a, KTD1h). Pure date math: caller supplies an evaluation date
// so the runtime never calls `Date.now()` (deterministic for tests + resume).
// ---------------------------------------------------------------------------

export function isReportStale(
	provenance: CapabilityReportProvenance,
	evaluationDate: string,
): boolean {
	if (
		typeof provenance.stale_after_days !== "number" ||
		!Number.isFinite(provenance.stale_after_days) ||
		provenance.stale_after_days <= 0
	) {
		return true;
	}
	const checked = Date.parse(provenance.checked_at);
	const now = Date.parse(evaluationDate);
	if (Number.isNaN(checked) || Number.isNaN(now)) return true;
	const ageDays = (now - checked) / (1000 * 60 * 60 * 24);
	// A future checked_at (negative age) is not evidence of freshness — it is a
	// misconfigured or forged report. Fail closed rather than treating it as
	// always-fresh.
	if (ageDays < 0) return true;
	return ageDays > provenance.stale_after_days;
}

function isFreshnessExpired(
	freshness: RouteEvidenceFreshness,
	evaluationDate: string,
): boolean {
	return isReportStale(
		{
			adapter_version: "",
			source_url: "",
			verification_method: "",
			checked_at: freshness.checked_at,
			stale_after_days: freshness.stale_after_days,
		},
		evaluationDate,
	);
}

// Registry ranking order (KTD10): used when the task supplies no ranking.
const REGISTRY_RANK = new Map<BrowserAdapterId, number>(
	BROWSER_ADAPTER_ROUTER_ADAPTERS.map((id, index) => [id, index]),
);

type EvaluateCandidateInput = {
	adapter: BrowserAdapterId;
	report: CapabilityReport | undefined;
	requiredCapabilities: readonly AdapterCapability[];
	preconditions: RoutePreconditionEvidence;
	allowDegraded: boolean;
	evaluationDate: string;
};

function evaluateCandidate(input: EvaluateCandidateInput): CandidateDecision {
	const registry_rank = REGISTRY_RANK.get(input.adapter) ?? Number.MAX_SAFE_INTEGER;
	const base = { adapter_id: input.adapter, registry_rank };

	// Attachment proof precondition (R12a, KTD1e). Missing proof -> recovery.
	const attached =
		input.preconditions.adapter_attached_verified_browser?.[input.adapter];
	if (attached !== true) {
		return {
			...base,
			status: "skipped",
			reason: "Browser Adapter Proof evidence is missing for this adapter.",
			code: "adapter_attachment_unverified",
		};
	}

	if (!input.report) {
		return {
			...base,
			status: "rejected",
			reason: "No valid current capability report exists.",
			code: "adapter_capability_unknown",
		};
	}

	// Attachment model compatibility (R12b, R12c, KTD9). A full action capability
	// is insufficient when the adapter cannot attach to verified Warm Chrome.
	if (
		input.report.attachment_model !==
		BROWSER_ADAPTER_ROUTER_COMPATIBLE_ATTACHMENT_MODEL
	) {
		return {
			...base,
			status: "rejected",
			reason: `attachment_model ${input.report.attachment_model} is incompatible with Browser Adapter Router V1.`,
			code: "adapter_attachment_incompatible",
		};
	}

	// Stale report -> recovery (plan Capability Discovery V1).
	if (isReportStale(input.report.provenance, input.evaluationDate)) {
		return {
			...base,
			status: "rejected",
			reason: "Capability report exceeded its freshness policy.",
			code: "adapter_capability_stale",
		};
	}

	const byCapability = new Map(
		input.report.capabilities.map((entry) => [entry.capability, entry]),
	);
	let minConfidence = 100;
	for (const capability of input.requiredCapabilities) {
		const entry = byCapability.get(capability);
		if (!entry || entry.support === "unknown") {
			return {
				...base,
				status: "rejected",
				reason: `No current report for required capability ${capability}.`,
				code: "adapter_capability_unknown",
			};
		}
		if (entry.support === "stale") {
			return {
				...base,
				status: "rejected",
				reason: `Required capability ${capability} reports stale.`,
				code: "adapter_capability_stale",
			};
		}
		if (entry.support === "none") {
			return {
				...base,
				status: "rejected",
				reason: `Required capability ${capability} reports none.`,
				code: "adapter_capability_none",
			};
		}
		if (entry.support === "partial" && !input.allowDegraded) {
			return {
				...base,
				status: "rejected",
				reason: `Required capability ${capability} reports partial; fails closed by default.`,
				code: "adapter_capability_partial",
			};
		}
		// `full` (or accepted `partial` under explicit degraded mode) must still
		// clear the confidence floor (plan: ">=75 for every required capability").
		if (entry.confidence < BROWSER_ADAPTER_ROUTER_MIN_ROUTE_CONFIDENCE) {
			return {
				...base,
				status: "rejected",
				reason: `Required capability ${capability} confidence ${entry.confidence} below route threshold.`,
				code: "adapter_capability_unknown",
			};
		}
		minConfidence = Math.min(minConfidence, entry.confidence);
	}

	return {
		...base,
		status: "selectable",
		reason: "Fresh full support for all required capabilities with compatible attachment.",
		// Route confidence is the minimum confidence across required capabilities.
		route_confidence: input.requiredCapabilities.length === 0 ? 100 : minConfidence,
	};
}

// ---------------------------------------------------------------------------
// Pure route evaluator (U0: route + status share this; differ only by renderer).
// ---------------------------------------------------------------------------

export function evaluateRoute(
	envelope: ValidatedRouteEvidenceEnvelope,
	evaluationDate: string,
): RouteEvaluation {
	const mode = envelope.policy.mode;
	const requested = envelope.policy.adapter_id ?? null;
	const requiredCapabilities = resolveRequiredCapabilities(envelope.task);

	// --- Precondition gate (KTD1b): run facts pass before capability ranking. ---
	const preconditionFailure = checkPreconditions({
		envelope,
		requiredCapabilities,
		evaluationDate,
	});
	if (preconditionFailure) return preconditionFailure;

	const allowDegraded = false; // allow_degraded is not routed in V1 (R20).

	const reportByAdapter = indexReportsByAdapter(envelope.reports);

	const candidateOrder = candidateAdaptersForMode(envelope.policy);
	const decisions = candidateOrder.map((adapter) =>
		evaluateCandidate({
			adapter,
			report: reportByAdapter.get(adapter),
			requiredCapabilities,
			preconditions: envelope.preconditions,
			allowDegraded,
			evaluationDate,
		}),
	);

	const selectable = decisions.filter((d) => d.status === "selectable");

	if (mode === "force") {
		// Force asks only the forced adapter; never falls back (R3, KTD5a).
		const decision = decisions[0];
		if (decision && decision.status === "selectable") {
			return buildSuccess({
				envelope,
				evaluationDate,
				mode,
				requested,
				selected: decision.adapter_id,
				requiredCapabilities,
				decisions,
				reportByAdapter,
			});
		}
		return buildFailureFromDecision({
			envelope,
			evaluationDate,
			mode,
			requested,
			decision,
			decisions,
			// Alternatives are informational only (AE2a, R3).
			informational: fullAlternatives({
				envelope,
				reportByAdapter,
				requiredCapabilities,
				evaluationDate,
			}),
		});
	}

	if (mode === "prefer") {
		const preferred = requested
			? decisions.find((d) => d.adapter_id === requested)
			: undefined;
		if (preferred && preferred.status === "selectable") {
			return buildSuccess({
				envelope,
				evaluationDate,
				mode,
				requested,
				selected: preferred.adapter_id,
				requiredCapabilities,
				decisions,
				reportByAdapter,
			});
		}
		const fallbackAllowed = envelope.policy.fallback_allowed === true;
		if (fallbackAllowed && selectable.length > 0) {
			const winner = rankSelectable(selectable, envelope);
			return buildSuccess({
				envelope,
				evaluationDate,
				mode,
				requested,
				selected: winner.adapter_id,
				requiredCapabilities,
				decisions,
				reportByAdapter,
			});
		}
		return buildFailureFromDecision({
			envelope,
			evaluationDate,
			mode,
			requested,
			decision: preferred,
			decisions,
			informational: [],
		});
	}

	// auto: filter to fully evidenced candidates, choose by ranking (R2).
	if (selectable.length > 0) {
		const winner = rankSelectable(selectable, envelope);
		return buildSuccess({
			envelope,
			evaluationDate,
			mode,
			requested,
			selected: winner.adapter_id,
			requiredCapabilities,
			decisions,
			reportByAdapter,
		});
	}
	// Auto does not route silently when candidates were skipped (U2).
	return buildFailureFromDecision({
		envelope,
		evaluationDate,
		mode,
		requested,
		decision: decisions[0],
		decisions,
		informational: [],
	});
}

function candidateAdaptersForMode(policy: RoutePolicy): BrowserAdapterId[] {
	if (policy.mode === "force") {
		return policy.adapter_id ? [policy.adapter_id] : [];
	}
	if (policy.mode === "prefer") {
		const preferred = policy.adapter_id ? [policy.adapter_id] : [];
		const rest = BROWSER_ADAPTER_ROUTER_ADAPTERS.filter(
			(id) => id !== policy.adapter_id,
		);
		return [...preferred, ...rest];
	}
	return [...BROWSER_ADAPTER_ROUTER_ADAPTERS];
}

// Ranking (KTD10): task bundle priority, registry priority, route confidence,
// then lexicographic adapter id as the final deterministic tie-break.
function rankSelectable(
	selectable: readonly CandidateDecision[],
	envelope: ValidatedRouteEvidenceEnvelope,
): CandidateDecision {
	const taskRanking = envelope.task.adapter_ranking ?? [];
	const taskPriority = (id: BrowserAdapterId): number => {
		const index = taskRanking.indexOf(id);
		return index === -1 ? Number.MAX_SAFE_INTEGER : index;
	};
	return [...selectable].sort((a, b) => {
		const taskDelta = taskPriority(a.adapter_id) - taskPriority(b.adapter_id);
		if (taskDelta !== 0) return taskDelta;
		if (a.registry_rank !== b.registry_rank) {
			return a.registry_rank - b.registry_rank;
		}
		const confDelta = (b.route_confidence ?? 0) - (a.route_confidence ?? 0);
		if (confDelta !== 0) return confDelta;
		return a.adapter_id.localeCompare(b.adapter_id);
	})[0];
}

export function rankSelectableForTest(
	selectable: readonly CandidateDecision[],
	envelope: ValidatedRouteEvidenceEnvelope,
): CandidateDecision {
	return rankSelectable(selectable, envelope);
}

function buildSuccess(input: {
	envelope: ValidatedRouteEvidenceEnvelope;
	evaluationDate: string;
	mode: BrowserAdapterRouterMode;
	requested: BrowserAdapterId | null;
	selected: BrowserAdapterId;
	requiredCapabilities: AdapterCapability[];
	decisions: readonly CandidateDecision[];
	reportByAdapter: Map<BrowserAdapterId, CapabilityReport>;
}): RouteSuccess | RouteFailure {
	// Operation-capable routes require proof binding for the selected adapter
	// (U2 R9, R12). The route hands one bound proof to the Browser Operation
	// Front Door; a selected adapter without proof cannot satisfy that contract,
	// so fail closed. Non-operation routes (pure capability discovery) carry no
	// proof binding and select normally.
	const selectedProof =
		input.envelope.preconditions.adapter_proof?.[input.selected];
	if (
		requestsOperationCapability(input.requiredCapabilities) &&
		!selectedProof
	) {
		return preconditionFailure(
			input.mode,
			input.requested,
			input.requiredCapabilities,
			input.evaluationDate,
			"route_evidence_binding_mismatch",
			`Operation-capable route selected ${input.selected} without Browser Adapter Proof binding.`,
			"prove_adapter_attachment",
		);
	}

	const selectedDecision = input.decisions.find(
		(d) => d.adapter_id === input.selected,
	);
	const taskRanking = input.envelope.task.adapter_ranking ?? [];
	const ranking = input.decisions
		.filter((d) => d.status === "selectable")
		.sort((a, b) => {
			const taskPriority = (id: BrowserAdapterId): number => {
				const index = taskRanking.indexOf(id);
				return index === -1 ? Number.MAX_SAFE_INTEGER : index;
			};
			const taskDelta = taskPriority(a.adapter_id) - taskPriority(b.adapter_id);
			if (taskDelta !== 0) return taskDelta;
			if (a.registry_rank !== b.registry_rank) {
				return a.registry_rank - b.registry_rank;
			}
			const confDelta = (b.route_confidence ?? 0) - (a.route_confidence ?? 0);
			if (confDelta !== 0) return confDelta;
			return a.adapter_id.localeCompare(b.adapter_id);
		})
		.map((d) => ({
			adapter_id: d.adapter_id,
			ranking: {
				task_priority: (() => {
					const index = taskRanking.indexOf(d.adapter_id);
					return index === -1 ? null : index;
				})(),
				registry_priority: d.registry_rank,
				route_confidence: d.route_confidence ?? 0,
			},
		}));
	const provenance_summary = [...input.reportByAdapter.values()]
		.filter((report) =>
			input.decisions.some(
				(d) => d.adapter_id === report.adapter_id && d.status === "selectable",
			),
		)
		.map((report) => ({
			adapter_id: report.adapter_id,
			report_source: report.report_source,
			checked_at: report.provenance.checked_at,
		}));

	return {
		outcome: "selected",
		evaluation_date: input.evaluationDate,
		mode: input.mode,
		requested_adapter: input.requested,
		selected_adapter: input.selected,
		required_capabilities: input.requiredCapabilities,
		route_confidence: selectedDecision?.route_confidence ?? 100,
		ranking,
		candidate_decisions: input.decisions,
		provenance_summary,
		...(() => {
			const binding = buildRouteBinding(input);
			return binding ? { binding } : {};
		})(),
		...(input.envelope.task.media_proof?.requested
			? { media_proof: buildMediaProof(input.envelope.task.media_proof) }
			: {}),
	};
}

// Build the route/proof binding tuple slice (U2 R8). The selected adapter's
// run-scoped proof identity is surfaced so Browser Operations bind to one
// proof. Returns undefined for non-operation routes that carry no proof
// binding; checkPreconditions has already failed closed if an operation-capable
// route reached selection without proof (R9, R12).
function buildRouteBinding(input: {
	envelope: ValidatedRouteEvidenceEnvelope;
	evaluationDate: string;
	selected: BrowserAdapterId;
	requiredCapabilities: AdapterCapability[];
}): RouteBinding | undefined {
	const proof = input.envelope.preconditions.adapter_proof?.[input.selected];
	if (!proof) return undefined;
	return {
		run_id: input.envelope.run_id,
		selected_adapter_id: input.selected,
		warm_chrome_run_id: proof.warm_chrome_run_id,
		adapter_proof_id: proof.adapter_proof_id,
		verified_endpoint_identity: proof.verified_endpoint_identity,
		route_evidence_hash: hashRouteEvidence(input.envelope),
		authorized_capabilities: [...input.requiredCapabilities],
		emitted_at: input.evaluationDate,
		expires_at: deriveExpiry(input.envelope.preconditions.freshness),
	};
}

// Deterministic content hash of the validated evidence envelope (U2 R8). No
// clock or randomness so identical evidence always yields the same hash, which
// downstream Browser Operations compare against to detect tampering or reuse.
function hashRouteEvidence(envelope: ValidatedRouteEvidenceEnvelope): string {
	const canonical = JSON.stringify({
		run_id: envelope.run_id,
		policy: envelope.policy,
		task: envelope.task,
		preconditions: envelope.preconditions,
		reports: envelope.reports,
	});
	return createHash("sha256").update(canonical).digest("hex");
}

// Derive route evidence expiry from precondition freshness (U2 R8). Pure date
// math on caller-supplied values; the runtime never reads a wall clock.
function deriveExpiry(freshness: RouteEvidenceFreshness): string {
	const checked = Date.parse(freshness.checked_at);
	if (Number.isNaN(checked)) return freshness.checked_at;
	const expiry = new Date(
		checked + freshness.stale_after_days * 24 * 60 * 60 * 1000,
	);
	return expiry.toISOString().slice(0, 10);
}

function buildMediaProof(request: {
	requested: boolean;
	run_scoped_path: string;
}): MediaProofMetadata {
	return {
		requested: request.requested,
		run_scoped_path: request.run_scoped_path,
		retention: "per_run",
		disclose_to_user: true,
		owner: "browser-use",
	};
}

// Index reports by adapter id once; shared by the route evaluator and the
// force-mode informational-alternatives scan so keying stays in one place.
function indexReportsByAdapter(
	reports: readonly CapabilityReport[],
): Map<BrowserAdapterId, CapabilityReport> {
	const byAdapter = new Map<BrowserAdapterId, CapabilityReport>();
	for (const report of reports) {
		byAdapter.set(report.adapter_id, report);
	}
	return byAdapter;
}

// Force mode evaluates only the forced adapter, so the non-forced candidates
// are not in `decisions`. Evaluate them here for the informational-only list
// (AE2a) using the already-built report index.
function fullAlternatives(input: {
	envelope: ValidatedRouteEvidenceEnvelope;
	reportByAdapter: Map<BrowserAdapterId, CapabilityReport>;
	requiredCapabilities: readonly AdapterCapability[];
	evaluationDate: string;
}): BrowserAdapterId[] {
	return BROWSER_ADAPTER_ROUTER_ADAPTERS.filter((adapter) => {
		if (adapter === input.envelope.policy.adapter_id) return false;
		const decision = evaluateCandidate({
			adapter,
			report: input.reportByAdapter.get(adapter),
			requiredCapabilities: input.requiredCapabilities,
			preconditions: input.envelope.preconditions,
			allowDegraded: false,
			evaluationDate: input.evaluationDate,
		});
		return decision.status === "selectable";
	});
}

// Map a rejected/skipped candidate decision into a fail-closed route, choosing
// the canonical continuation action and (for stale) a research recovery (U3).
function buildFailureFromDecision(input: {
	envelope: ValidatedRouteEvidenceEnvelope;
	evaluationDate: string;
	mode: BrowserAdapterRouterMode;
	requested: BrowserAdapterId | null;
	decision: CandidateDecision | undefined;
	decisions: readonly CandidateDecision[];
	informational: readonly BrowserAdapterId[];
}): RouteFailure {
	const code = input.decision?.code ?? "adapter_capability_unknown";
	const message =
		input.decision?.reason ?? "No routable Browser Adapter candidate.";
	const next_action_id = continuationForCode(code);

	let research: ResearchRecovery | undefined;
	if (code === "adapter_capability_stale" && input.decision) {
		research = buildResearchRecovery({
			envelope: input.envelope,
			adapter: input.decision.adapter_id,
			staleReason: message,
		});
	}

	return {
		outcome: "fail_closed",
		evaluation_date: input.evaluationDate,
		mode: input.mode,
		requested_adapter: input.requested,
		code,
		message,
		next_action_id,
		required_capabilities: resolveRequiredCapabilities(input.envelope.task),
		...(research ? { research } : {}),
		candidate_decisions: input.decisions,
		informational_alternatives: input.informational,
	};
}

function buildResearchRecovery(input: {
	envelope: ValidatedRouteEvidenceEnvelope;
	adapter: BrowserAdapterId;
	staleReason: string;
}): ResearchRecovery {
	const requiredCapabilities = resolveRequiredCapabilities(input.envelope.task);
	const capability = requiredCapabilities[0] ?? "snapshot_refs";
	return {
		adapter_id: input.adapter,
		capability,
		query: `${input.adapter} ${capability} capability current support`,
		sources: [CHROME_DEVTOOLS_DOCS_URL],
		last_checked: "unknown",
		stale_reason: input.staleReason,
		retry_posture: "bounded",
		max_retries: 2,
		terminal_condition:
			"Stop after max_retries or once a verified report refresh exists.",
		// Capped below route threshold; docs-only never routes (plan).
		research_signal: MAX_RESEARCH_SIGNAL,
	};
}

// Validate supplied Browser Adapter Proof binding identity (U2 R9). Returns a
// failure message when proof evidence is incomplete or cross-run, else null.
// Pure check on supplied facts; selection has not happened yet, so every
// supplied proof entry is validated.
function checkProofBinding(
	pre: RoutePreconditionEvidence,
): string | null {
	const proofs = pre.adapter_proof;
	if (!proofs) return null;
	for (const [adapter, proof] of Object.entries(proofs)) {
		if (!proof) continue;
		if (
			!proof.adapter_proof_id ||
			!proof.warm_chrome_run_id ||
			!proof.verified_endpoint_identity
		) {
			return `Browser Adapter Proof for ${adapter} is missing binding identity fields.`;
		}
		if (
			pre.warm_chrome_run_id &&
			proof.warm_chrome_run_id !== pre.warm_chrome_run_id
		) {
			return `Browser Adapter Proof for ${adapter} binds to a different Warm Chrome run than the route run.`;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Precondition gate (U5). Run facts must pass before adapter capability ranking.
// ---------------------------------------------------------------------------

function checkPreconditions(input: {
	envelope: ValidatedRouteEvidenceEnvelope;
	requiredCapabilities: readonly AdapterCapability[];
	evaluationDate: string;
}): RouteFailure | null {
	const { envelope, evaluationDate } = input;
	const pre = envelope.preconditions;
	const mode = envelope.policy.mode;
	const requested = envelope.policy.adapter_id ?? null;

	// Freshness metadata required; missing or stale fails closed (R17a, KTD1h).
	if (!pre.freshness || isFreshnessExpired(pre.freshness, evaluationDate)) {
		return preconditionFailure(
			mode,
			requested,
			input.requiredCapabilities,
			evaluationDate,
			"route_evidence_stale",
			"Route evidence freshness is missing or expired.",
		);
	}

	// Run correlation across supplied evidence (R17b, KTD1i).
	if (pre.run_id !== envelope.run_id) {
		return preconditionFailure(
			mode,
			requested,
			input.requiredCapabilities,
			evaluationDate,
			"route_evidence_mixed_run",
			"Precondition evidence run id does not match the route run id.",
		);
	}

	// Binding tuple consistency (U2 R9). Any supplied adapter proof must carry a
	// complete, self-consistent identity, and when a run-scoped Warm Chrome run
	// id is supplied, every proof must bind to that same session. Fail closed on
	// mismatched, incomplete, or cross-run proof evidence before selection.
	const bindingMismatch = checkProofBinding(pre);
	if (bindingMismatch) {
		return preconditionFailure(
			mode,
			requested,
			input.requiredCapabilities,
			evaluationDate,
			"route_evidence_binding_mismatch",
			bindingMismatch,
		);
	}


	if (pre.warm_chrome_ready !== true) {
		return preconditionFailure(
			mode,
			requested,
			input.requiredCapabilities,
			evaluationDate,
			"adapter_attachment_unverified",
			"Warm Chrome is not verified ready.",
			"prove_adapter_attachment",
		);
	}

	// Auth/session precondition (R15, R16). Only enforced when declared.
	if (pre.auth_session?.required) {
		const auth = pre.auth_session;
		if (
			!auth.target_origin ||
			!auth.verified_profile_identity ||
			auth.account_session_match !== true
		) {
			return preconditionFailure(
				mode,
				requested,
				input.requiredCapabilities,
				evaluationDate,
				"auth_session_unverified",
				"Auth/session precondition requires target origin and verified profile identity.",
			);
		}
	}

	// Target page/origin precondition (R16b).
	if (pre.target_origin?.required) {
		const origin = pre.target_origin;
		if (!origin.observed || origin.observed !== origin.expected) {
			return preconditionFailure(
				mode,
				requested,
				input.requiredCapabilities,
				evaluationDate,
				"target_origin_unverified",
				"Target origin precondition requires matching supplied evidence.",
			);
		}
	}

	return null;
}

function preconditionFailure(
	mode: BrowserAdapterRouterMode,
	requested: BrowserAdapterId | null,
	requiredCapabilities: readonly AdapterCapability[],
	evaluationDate: string,
	code: BrowserAdapterRouterDiagnosticCode,
	message: string,
	nextAction?: RouterFailureActionId,
): RouteFailure {
	return {
		outcome: "fail_closed",
		evaluation_date: evaluationDate,
		mode,
		requested_adapter: requested,
		code,
		message,
		next_action_id: nextAction ?? continuationForCode(code),
		required_capabilities: [...requiredCapabilities],
		candidate_decisions: [],
		informational_alternatives: [],
	};
}
