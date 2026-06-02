#!/usr/bin/env bun

// Browser Adapter Router (plan 2026-06-02-004).
//
// Evidence-first router. Requests enter `browser-use`; the Router asks for
// supplied evidence and ranks only proven candidates. It does NOT probe
// adapters, run Browser Adapter Proof, or invoke self-report commands during
// `route` — it consumes a caller-assembled evidence envelope (KTD1e, KTD1f,
// KTD1g). Missing/stale/partial/docs-only evidence becomes structured recovery,
// never inference (KTD1).
//
// Command surfaces:
//   route   — select an adapter from a supplied envelope (pure evaluation).
//   report  — discover/validate one capability report (manifest or self-report).
//   status  — human projection of a supplied envelope (same pure evaluator).

import { readFile } from "node:fs/promises";
import {
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	type RuntimeActionGuidance,
	type StructuredRuntimeError,
	CliUsageError,
	configureCliDiagnostics,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	resetCliDiagnostics,
	usageError,
	validateStructuredRuntimeError,
	withCliDiagnosticContext,
	createCliDiagnosticContext,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_ADAPTER_ROUTER_ADAPTERS,
	BROWSER_ADAPTER_ROUTER_CAPABILITIES,
	BROWSER_ADAPTER_ROUTER_COMPATIBLE_ATTACHMENT_MODEL,
	BROWSER_ADAPTER_ROUTER_MIN_ROUTE_CONFIDENCE,
	type BrowserAdapterRouterAdapter,
	type BrowserAdapterRouterAttachmentModel,
	type BrowserAdapterRouterBundle,
	type BrowserAdapterRouterCapability,
	type BrowserAdapterRouterCommand,
	type BrowserAdapterRouterDiagnosticCode,
	type BrowserAdapterRouterMode,
	type BrowserAdapterRouterReportSource,
	type BrowserAdapterRouterSupportState,
	browserAdapterRouterContracts,
	browserAdapterRouterFailureActions,
	browserAdapterRouterSuccessActions,
} from "./command-contract";
import { BROWSER_ADAPTER_ROUTER_MANIFESTS } from "./browser-adapter-router-manifests";

const VERSION = "0.1.0";
const ROUTE_FAIL_CLOSED_EXIT_CODE = 20;
const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const CHROME_DEVTOOLS_DOCS_URL =
	"https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session";

// Numeric research signals are capped below the route threshold (plan Capability
// Discovery V1: "Numeric research signals are capped below the route
// threshold"). Docs-only evidence can never reach routable confidence.
const MAX_RESEARCH_SIGNAL = BROWSER_ADAPTER_ROUTER_MIN_ROUTE_CONFIDENCE - 1;

const quietDiagnosticWriter: CliWriter = { write: () => true };

// Re-exported registry-aligned types so the manifest module and tests share one
// vocabulary source.
export type BrowserAdapterId = BrowserAdapterRouterAdapter;
export type AdapterCapability = BrowserAdapterRouterCapability;

// ---------------------------------------------------------------------------
// Capability report shape (U1).
// ---------------------------------------------------------------------------

export type CapabilityReportProvenance = {
	adapter_version: string;
	source_url: string;
	checked_at: string;
	verification_method: string;
	stale_after_days: number;
};

export type CapabilityEntryEvidence = {
	verification_method: string;
	source_url?: string;
};

export type CapabilityEntry = {
	capability: AdapterCapability;
	support: BrowserAdapterRouterSupportState;
	confidence: number;
	evidence: CapabilityEntryEvidence;
};

export type CapabilityReport = {
	adapter_id: BrowserAdapterId;
	schema_version: string;
	report_source: BrowserAdapterRouterReportSource;
	resolved_command: string;
	validation: "valid" | "invalid";
	attachment_model: BrowserAdapterRouterAttachmentModel;
	provenance: CapabilityReportProvenance;
	capabilities: readonly CapabilityEntry[];
};

// ---------------------------------------------------------------------------
// Evidence envelope shape (U0/U2/U5). Caller-assembled JSON. Exact fields stay
// runtime-owned (plan R5d); the plan body carries no hand-maintained schema.
// ---------------------------------------------------------------------------

export type RouteEvidenceFreshness = {
	checked_at: string;
	stale_after_days: number;
};

export type RoutePreconditionEvidence = {
	// Run correlation (R17b): run-scoped proof and precondition evidence must tie
	// to the route run. Capability reports are reusable cross-run snapshots gated
	// by their own `checked_at` freshness, not run id; only this run-scoped
	// precondition block carries the run_id the Router correlates against.
	run_id: string;
	freshness: RouteEvidenceFreshness;
	warm_chrome_ready: boolean;
	// Browser Adapter Proof evidence per candidate adapter (R5c).
	adapter_attached_verified_browser?: Partial<Record<BrowserAdapterId, boolean>>;
	// Auth/session precondition (R15, R16). Only present when the task declares it.
	auth_session?: {
		required: boolean;
		target_origin?: string;
		verified_profile_identity?: string;
		account_session_match?: boolean;
	};
	// Target page/origin precondition (R16b).
	target_origin?: {
		required: boolean;
		expected: string;
		observed?: string;
	};
};

export type RoutePolicy = {
	mode: BrowserAdapterRouterMode;
	adapter_id?: BrowserAdapterId;
	minimum_support?: BrowserAdapterRouterSupportState;
	fallback_allowed?: boolean;
	allow_degraded?: boolean;
};

export type RouteTask = {
	bundle?: BrowserAdapterRouterBundle;
	required_capabilities?: readonly AdapterCapability[];
	adapter_ranking?: readonly BrowserAdapterId[];
	// Run-scoped media proof request (U5).
	media_proof?: {
		requested: boolean;
		run_scoped_path: string;
	};
};

export type RouteEvidenceEnvelope = {
	run_id: string;
	policy: RoutePolicy;
	task: RouteTask;
	preconditions: RoutePreconditionEvidence;
	reports: readonly CapabilityReport[];
};

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
// Report validation (U0/U1). The same validator runs against adapter
// self-reports and Router manifests (R8b).
// ---------------------------------------------------------------------------

export type ReportValidationResult =
	| { ok: true; report: CapabilityReport }
	| { ok: false; diagnostics: string[] };

export function validateCapabilityReport(value: unknown): ReportValidationResult {
	const diagnostics: string[] = [];
	if (!isJsonObject(value)) {
		return { ok: false, diagnostics: ["report must be a JSON object"] };
	}
	const adapterId = value.adapter_id;
	if (!isBrowserAdapter(adapterId)) {
		diagnostics.push("report.adapter_id must be a known registry adapter id");
	}
	if (typeof value.schema_version !== "string" || value.schema_version === "") {
		diagnostics.push("report.schema_version must be a non-empty string");
	}
	const attachment = value.attachment_model;
	if (!isAttachmentModel(attachment)) {
		diagnostics.push("report.attachment_model must be a known attachment model");
	}
	const provenanceIssues = validateProvenance(value.provenance);
	diagnostics.push(...provenanceIssues);
	const capabilities = value.capabilities;
	if (!Array.isArray(capabilities) || capabilities.length === 0) {
		diagnostics.push("report.capabilities must be a non-empty array");
	} else {
		// Reject duplicate capability keys. evaluateCandidate indexes capabilities
		// by name (last-write-wins), so a duplicate entry could forge support for a
		// required capability and defeat the fail-closed gates. The same validator
		// runs on adapter self-reports (R8b), so this guard is load-bearing.
		const seen = new Set<string>();
		for (const [index, entry] of capabilities.entries()) {
			diagnostics.push(...validateCapabilityEntry(entry, index));
			const key =
				isJsonObject(entry) && typeof entry.capability === "string"
					? entry.capability
					: undefined;
			if (key !== undefined) {
				if (seen.has(key)) {
					diagnostics.push(
						`report.capabilities has a duplicate entry for ${key}`,
					);
				}
				seen.add(key);
			}
		}
	}
	if (diagnostics.length > 0) {
		return { ok: false, diagnostics };
	}
	const obj = value as Record<string, unknown>;
	return {
		ok: true,
		report: {
			adapter_id: adapterId as BrowserAdapterId,
			schema_version: obj.schema_version as string,
			report_source:
				obj.report_source === "self_report" ? "self_report" : "manifest",
			resolved_command:
				typeof obj.resolved_command === "string" ? obj.resolved_command : "",
			validation: "valid",
			attachment_model: attachment as BrowserAdapterRouterAttachmentModel,
			provenance: obj.provenance as CapabilityReportProvenance,
			capabilities: capabilities as CapabilityEntry[],
		},
	};
}

function validateProvenance(value: unknown): string[] {
	if (!isJsonObject(value)) {
		return ["report.provenance must be present"];
	}
	const issues: string[] = [];
	for (const field of [
		"adapter_version",
		"source_url",
		"checked_at",
		"verification_method",
	] as const) {
		if (typeof value[field] !== "string" || value[field] === "") {
			issues.push(`report.provenance.${field} is required`);
		}
	}
	if (
		typeof value.stale_after_days !== "number" ||
		!Number.isFinite(value.stale_after_days) ||
		value.stale_after_days <= 0
	) {
		issues.push("report.provenance.stale_after_days must be a positive number");
	}
	return issues;
}

function validateCapabilityEntry(value: unknown, index: number): string[] {
	if (!isJsonObject(value)) {
		return [`report.capabilities[${index}] must be an object`];
	}
	const issues: string[] = [];
	if (!isCapability(value.capability)) {
		issues.push(`report.capabilities[${index}].capability is not a known capability`);
	}
	if (!isSupportState(value.support)) {
		issues.push(`report.capabilities[${index}].support is not a known state`);
	}
	if (
		typeof value.confidence !== "number" ||
		!Number.isFinite(value.confidence) ||
		value.confidence < 0 ||
		value.confidence > 100
	) {
		issues.push(`report.capabilities[${index}].confidence must be 0-100`);
	}
	if (!isJsonObject(value.evidence) ||
		typeof value.evidence.verification_method !== "string" ||
		value.evidence.verification_method === "") {
		issues.push(
			`report.capabilities[${index}].evidence.verification_method is required`,
		);
	}
	return issues;
}

// ---------------------------------------------------------------------------
// Freshness (R17a, KTD1h). Pure date math: caller supplies an evaluation date
// so the runtime never calls `Date.now()` (deterministic for tests + resume).
// ---------------------------------------------------------------------------

export function isReportStale(
	provenance: CapabilityReportProvenance,
	evaluationDate: string,
): boolean {
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

// Today's date as YYYY-MM-DD (UTC). The runtime default evaluation date; tests
// pin a fixed date via the runtime override so this is never called under test.
function todayIsoDate(): string {
	return new Date().toISOString().slice(0, 10);
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

// ---------------------------------------------------------------------------
// Candidate evaluation (U2). Per-adapter decision for a resolved capability set.
// ---------------------------------------------------------------------------

export type CandidateDecisionStatus =
	| "selectable"
	| "skipped"
	| "rejected";

export type CandidateDecision = {
	adapter_id: BrowserAdapterId;
	status: CandidateDecisionStatus;
	reason: string;
	code?: BrowserAdapterRouterDiagnosticCode;
	route_confidence?: number;
	registry_rank: number;
};

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

export type RouteRanking = {
	task_priority: number | null;
	registry_priority: number;
	route_confidence: number;
};

export type RouteSuccess = {
	outcome: "selected";
	mode: BrowserAdapterRouterMode;
	requested_adapter: BrowserAdapterId | null;
	selected_adapter: BrowserAdapterId;
	required_capabilities: AdapterCapability[];
	route_confidence: number;
	ranking: readonly { adapter_id: BrowserAdapterId; ranking: RouteRanking }[];
	candidate_decisions: readonly CandidateDecision[];
	provenance_summary: readonly {
		adapter_id: BrowserAdapterId;
		report_source: BrowserAdapterRouterReportSource;
		checked_at: string;
	}[];
	media_proof?: MediaProofMetadata;
};

export type RouteFailure = {
	outcome: "fail_closed";
	mode: BrowserAdapterRouterMode;
	requested_adapter: BrowserAdapterId | null;
	code: BrowserAdapterRouterDiagnosticCode;
	message: string;
	next_action_id: RouterFailureActionId;
	research?: ResearchRecovery;
	candidate_decisions: readonly CandidateDecision[];
	informational_alternatives: readonly BrowserAdapterId[];
};

export type MediaProofMetadata = {
	requested: boolean;
	run_scoped_path: string;
	retention: "per_run";
	disclose_to_user: boolean;
	// Adapters produce artifacts; they never override this metadata (U5).
	owner: "browser-use";
};

export type ResearchRecovery = {
	adapter_id: BrowserAdapterId;
	capability: AdapterCapability;
	query: string;
	sources: readonly string[];
	last_checked: string;
	stale_reason: string;
	retry_posture: "bounded";
	max_retries: number;
	terminal_condition: string;
	research_signal: number;
};

export type RouterFailureActionId =
	(typeof browserAdapterRouterFailureActions)[number]["id"];
export type RouterSuccessActionId =
	(typeof browserAdapterRouterSuccessActions)[number]["id"];

export type RouteEvaluation = RouteSuccess | RouteFailure;

// Envelope-shape failures surface as runtime/usage errors, not RouteEvaluation.
export class RouteEvidenceError extends Error {
	readonly code: BrowserAdapterRouterDiagnosticCode;
	constructor(code: BrowserAdapterRouterDiagnosticCode, message: string) {
		super(message);
		this.name = "RouteEvidenceError";
		this.code = code;
	}
}

export function evaluateRoute(
	envelope: RouteEvidenceEnvelope,
	evaluationDate: string,
): RouteEvaluation {
	const mode = envelope.policy.mode;
	const requested = envelope.policy.adapter_id ?? null;

	// --- Precondition gate (KTD1b): run facts pass before capability ranking. ---
	const preconditionFailure = checkPreconditions(envelope, evaluationDate);
	if (preconditionFailure) return preconditionFailure;

	const requiredCapabilities = resolveRequiredCapabilities(envelope.task);
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
			evaluationDate,
		});
	}

	if (mode === "prefer") {
		const preferred = requested
			? decisions.find((d) => d.adapter_id === requested)
			: undefined;
		if (preferred && preferred.status === "selectable") {
			return buildSuccess({
				envelope,
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
			mode,
			requested,
			decision: preferred,
			decisions,
			informational: [],
			evaluationDate,
		});
	}

	// auto: filter to fully evidenced candidates, choose by ranking (R2).
	if (selectable.length > 0) {
		const winner = rankSelectable(selectable, envelope);
		return buildSuccess({
			envelope,
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
		mode,
		requested,
		decision: decisions[0],
		decisions,
		informational: [],
		evaluationDate,
	});
}

function candidateAdaptersForMode(
	policy: RoutePolicy,
): BrowserAdapterId[] {
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
	envelope: RouteEvidenceEnvelope,
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
		const confDelta =
			(b.route_confidence ?? 0) - (a.route_confidence ?? 0);
		if (confDelta !== 0) return confDelta;
		return a.adapter_id.localeCompare(b.adapter_id);
	})[0];
}

function buildSuccess(input: {
	envelope: RouteEvidenceEnvelope;
	mode: BrowserAdapterRouterMode;
	requested: BrowserAdapterId | null;
	selected: BrowserAdapterId;
	requiredCapabilities: AdapterCapability[];
	decisions: readonly CandidateDecision[];
	reportByAdapter: Map<BrowserAdapterId, CapabilityReport>;
}): RouteSuccess {
	const selectedDecision = input.decisions.find(
		(d) => d.adapter_id === input.selected,
	);
	const taskRanking = input.envelope.task.adapter_ranking ?? [];
	const ranking = input.decisions
		.filter((d) => d.status === "selectable")
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
		mode: input.mode,
		requested_adapter: input.requested,
		selected_adapter: input.selected,
		required_capabilities: input.requiredCapabilities,
		route_confidence: selectedDecision?.route_confidence ?? 100,
		ranking,
		candidate_decisions: input.decisions,
		provenance_summary,
		...(input.envelope.task.media_proof?.requested
			? { media_proof: buildMediaProof(input.envelope.task.media_proof) }
			: {}),
	};
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
	envelope: RouteEvidenceEnvelope;
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
	envelope: RouteEvidenceEnvelope;
	mode: BrowserAdapterRouterMode;
	requested: BrowserAdapterId | null;
	decision: CandidateDecision | undefined;
	decisions: readonly CandidateDecision[];
	informational: readonly BrowserAdapterId[];
	evaluationDate: string;
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
		mode: input.mode,
		requested_adapter: input.requested,
		code,
		message,
		next_action_id,
		...(research ? { research } : {}),
		candidate_decisions: input.decisions,
		informational_alternatives: input.informational,
	};
}

// One canonical continuation per failure code (R18, U3). Alternatives stay
// explanatory only.
function continuationForCode(
	code: BrowserAdapterRouterDiagnosticCode,
): RouterFailureActionId {
	switch (code) {
		case "adapter_attachment_unverified":
			return "prove_adapter_attachment";
		case "adapter_capability_stale":
		case "adapter_capability_unknown":
			return "research_adapter_capability";
		case "adapter_capability_partial":
			return "accept_partial_adapter";
		case "adapter_capability_none":
		case "adapter_attachment_incompatible":
		case "route_evidence_invalid":
		case "route_evidence_mixed_run":
		case "route_evidence_stale":
		case "auth_session_unverified":
		case "target_origin_unverified":
			return "change_route_input";
		default:
			// Exhaustiveness guard: a new diagnostic code added to the union
			// must declare its continuation here, or this fails to compile.
			return assertNeverDiagnosticCode(code);
	}
}

// Compile-time exhaustiveness guard for diagnostic-code switches. Runtime
// fallback is the safe fail-closed input action.
function assertNeverDiagnosticCode(
	code: never,
): "change_route_input" {
	void code;
	return "change_route_input";
}

function buildResearchRecovery(input: {
	envelope: RouteEvidenceEnvelope;
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

// ---------------------------------------------------------------------------
// Precondition gate (U5). Run facts must pass before adapter capability ranking.
// ---------------------------------------------------------------------------

function checkPreconditions(
	envelope: RouteEvidenceEnvelope,
	evaluationDate: string,
): RouteFailure | null {
	const pre = envelope.preconditions;
	const mode = envelope.policy.mode;
	const requested = envelope.policy.adapter_id ?? null;

	// Freshness metadata required; missing or stale fails closed (R17a, KTD1h).
	if (!pre.freshness || isFreshnessExpired(pre.freshness, evaluationDate)) {
		return preconditionFailure(
			mode,
			requested,
			"route_evidence_stale",
			"Route evidence freshness is missing or expired.",
		);
	}

	// Run correlation across supplied evidence (R17b, KTD1i).
	if (pre.run_id !== envelope.run_id) {
		return preconditionFailure(
			mode,
			requested,
			"route_evidence_mixed_run",
			"Precondition evidence run id does not match the route run id.",
		);
	}

	if (pre.warm_chrome_ready !== true) {
		return preconditionFailure(
			mode,
			requested,
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
			auth.account_session_match === false
		) {
			return preconditionFailure(
				mode,
				requested,
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
	code: BrowserAdapterRouterDiagnosticCode,
	message: string,
	nextAction?: RouterFailureActionId,
): RouteFailure {
	return {
		outcome: "fail_closed",
		mode,
		requested_adapter: requested,
		code,
		message,
		next_action_id: nextAction ?? continuationForCode(code),
		candidate_decisions: [],
		informational_alternatives: [],
	};
}

// ---------------------------------------------------------------------------
// Envelope parsing (U0/U2). route/status consume a supplied envelope only.
// ---------------------------------------------------------------------------

export function parseEvidenceEnvelope(raw: string): RouteEvidenceEnvelope {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new RouteEvidenceError(
			"route_evidence_invalid",
			"Evidence envelope is not valid JSON.",
		);
	}
	if (!isJsonObject(value)) {
		throw new RouteEvidenceError(
			"route_evidence_invalid",
			"Evidence envelope must be a JSON object.",
		);
	}
	const issues: string[] = [];
	if (typeof value.run_id !== "string" || value.run_id === "") {
		issues.push("envelope.run_id is required");
	}
	const policy = isJsonObject(value.policy) ? value.policy : undefined;
	if (!policy || !isMode(policy.mode)) {
		issues.push("envelope.policy.mode must be auto, prefer, or force");
	} else {
		// adapter_id is optional for auto, required and registry-valid for
		// force/prefer; an unknown id must fail as invalid input, not as a
		// misleading attachment/capability recovery.
		if (policy.adapter_id !== undefined && !isBrowserAdapter(policy.adapter_id)) {
			issues.push("envelope.policy.adapter_id must be a known registry adapter");
		}
		if (policy.mode === "force" && policy.adapter_id === undefined) {
			issues.push("envelope.policy.adapter_id is required in force mode");
		}
	}
	if (!isJsonObject(value.preconditions)) {
		issues.push("envelope.preconditions is required");
	}
	if (!Array.isArray(value.reports)) {
		issues.push("envelope.reports must be an array");
	}
	// Validate optional task fields so an unknown bundle name fails closed here
	// rather than resolving to an empty capability set downstream.
	if (value.task !== undefined && isJsonObject(value.task)) {
		const bundle = value.task.bundle;
		if (bundle !== undefined && !(bundle as string in BUNDLE_CAPABILITIES)) {
			issues.push("envelope.task.bundle is not a known bundle");
		}
		const required = value.task.required_capabilities;
		if (required !== undefined) {
			if (!Array.isArray(required) || !required.every(isCapability)) {
				issues.push(
					"envelope.task.required_capabilities must be known capabilities",
				);
			}
		}
	}
	if (issues.length > 0) {
		throw new RouteEvidenceError(
			"route_evidence_invalid",
			`Evidence envelope is schema-invalid: ${issues.join("; ")}`,
		);
	}

	// Validate every supplied report through the shared validator (R8b). An
	// invalid report makes the whole envelope invalid — the caller must assemble
	// validated reports.
	const reports: CapabilityReport[] = [];
	for (const [index, report] of (value.reports as unknown[]).entries()) {
		const result = validateCapabilityReport(report);
		if (!result.ok) {
			throw new RouteEvidenceError(
				"route_evidence_invalid",
				`envelope.reports[${index}] is invalid: ${result.diagnostics.join("; ")}`,
			);
		}
		reports.push(result.report);
	}

	return {
		run_id: value.run_id as string,
		policy: value.policy as RoutePolicy,
		task: (isJsonObject(value.task) ? value.task : {}) as RouteTask,
		preconditions: value.preconditions as RoutePreconditionEvidence,
		reports,
	};
}

// ---------------------------------------------------------------------------
// report command (U0). Discover one adapter capability report: validated
// self-report (if the registry declares a command vector) over validated
// manifest. report performs check/network only; never browser action.
// ---------------------------------------------------------------------------

export type ReportDiscovery =
	| {
			found: true;
			source: BrowserAdapterRouterReportSource;
			report: CapabilityReport;
	  }
	| {
			found: false;
			code: Extract<
				BrowserAdapterRouterDiagnosticCode,
				"adapter_capability_unknown" | "adapter_capability_stale"
			>;
			diagnostics: string[];
	  };

export type RouterRuntime = {
	env: Record<string, string | undefined>;
	now: () => number;
	cwd: string;
	readTextFile: (path: string) => Promise<string>;
	readStdin: () => Promise<string>;
	evaluationDate: string;
};

export function createDefaultRouterRuntime(
	overrides: Partial<RouterRuntime> = {},
): RouterRuntime {
	return {
		// `now` mirrors the facade diagnostic clock (Date.now epoch ms) so
		// duration_ms = now() - startedAtMs is a sane elapsed value.
		env: { ...process.env },
		now: () => Date.now(),
		cwd: process.cwd(),
		readTextFile: (path: string) => readFile(path, "utf-8"),
		readStdin: () => readAllStdin(),
		// Freshness evaluates against today's date by default. Tests and CI pin a
		// fixed date via BROWSER_USE_ROUTER_EVAL_DATE for determinism; a frozen
		// literal default here would silently stale every manifest once its
		// window elapsed.
		evaluationDate:
			process.env.BROWSER_USE_ROUTER_EVAL_DATE ?? todayIsoDate(),
		...overrides,
	};
}

export function discoverReport(
	adapter: BrowserAdapterId,
	evaluationDate: string,
	selfReport?: unknown,
): ReportDiscovery {
	// Validated self-report wins over manifest (plan Report source order).
	if (selfReport !== undefined) {
		const result = validateCapabilityReport(selfReport);
		if (result.ok && result.report.adapter_id === adapter) {
			return {
				found: true,
				source: "self_report",
				report: { ...result.report, report_source: "self_report" },
			};
		}
		// Malformed self-report -> unknown plus schema diagnostic (U0).
		return {
			found: false,
			code: "adapter_capability_unknown",
			diagnostics: result.ok
				? ["self-report adapter_id does not match requested adapter"]
				: result.diagnostics,
		};
	}

	const manifest = BROWSER_ADAPTER_ROUTER_MANIFESTS[adapter];
	if (!manifest) {
		return {
			found: false,
			code: "adapter_capability_unknown",
			diagnostics: ["no manifest-backed report exists for this adapter"],
		};
	}
	const result = validateCapabilityReport(manifest);
	if (!result.ok) {
		return {
			found: false,
			code: "adapter_capability_unknown",
			diagnostics: result.diagnostics,
		};
	}
	// Valid report past stale-after is stale, not unknown (U0).
	if (isReportStale(result.report.provenance, evaluationDate)) {
		return {
			found: false,
			code: "adapter_capability_stale",
			diagnostics: ["manifest report exceeded its freshness policy"],
		};
	}
	return { found: true, source: "manifest", report: result.report };
}

// ---------------------------------------------------------------------------
// Type guards.
// ---------------------------------------------------------------------------

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBrowserAdapter(value: unknown): value is BrowserAdapterId {
	return (
		typeof value === "string" &&
		(BROWSER_ADAPTER_ROUTER_ADAPTERS as readonly string[]).includes(value)
	);
}

function isCapability(value: unknown): value is AdapterCapability {
	return (
		typeof value === "string" &&
		(BROWSER_ADAPTER_ROUTER_CAPABILITIES as readonly string[]).includes(value)
	);
}

function isSupportState(
	value: unknown,
): value is BrowserAdapterRouterSupportState {
	return (
		value === "full" ||
		value === "partial" ||
		value === "none" ||
		value === "unknown" ||
		value === "stale"
	);
}

function isAttachmentModel(
	value: unknown,
): value is BrowserAdapterRouterAttachmentModel {
	return (
		value === "verified_warm_chrome" ||
		value === "separate_browser_context" ||
		value === "storage_state_import" ||
		value === "unknown"
	);
}

function isMode(value: unknown): value is BrowserAdapterRouterMode {
	return value === "auto" || value === "prefer" || value === "force";
}

// ---------------------------------------------------------------------------
// CLI driver (U0). Mirrors preflight-browser-adapter.ts structure.
// ---------------------------------------------------------------------------

type OutputMode = "json" | "plain";

type ParsedRouterCommand =
	| { kind: "help"; command?: BrowserAdapterRouterCommand }
	| { kind: "version" }
	| {
			kind: "route";
			outputMode: OutputMode;
			envelopePath?: string;
	  }
	| {
			kind: "report";
			outputMode: OutputMode;
			adapter: BrowserAdapterId;
			capability?: AdapterCapability;
	  };

const routerRuntimeActions = [
	...browserAdapterRouterFailureActions,
	...browserAdapterRouterSuccessActions,
] as const;
const routerRuntimeActionById = new Map(
	routerRuntimeActions.map((action) => [action.id, action]),
);

function runtimeAction(
	id: RouterFailureActionId | RouterSuccessActionId,
): RuntimeActionGuidance {
	const action = routerRuntimeActionById.get(id);
	if (!action) {
		throw new Error(`Unknown Browser Adapter Router runtime action: ${id}`);
	}
	return {
		id,
		summary: action.summary,
		side_effects: [...action.sideEffects] as RuntimeActionGuidance["side_effects"],
	};
}

export async function runBrowserAdapterRouterCli(
	argv: readonly string[],
	options: {
		runtime?: RouterRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultRouterRuntime();
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const diagnosticInput = applyEnvRunId(argv, runtime.env.BROWSER_USE_RUN_ID);
	let diagnosticArgv: ParsedCliDiagnosticArgv;

	try {
		diagnosticArgv = parseCliDiagnosticArgv(diagnosticInput);
	} catch (error) {
		diagnosticArgv = parseCliDiagnosticFallbackArgv(diagnosticInput);
		const outputMode = inferOutputMode(argv);
		configureCliDiagnostics({
			categoryRoot: "browser-use.adapter-router",
			options: diagnosticArgv.options,
			diagnosticWriter: diagnosticArgv.options.quiet
				? quietDiagnosticWriter
				: stderr,
		});
		try {
			return emitCliError({
				error:
					error instanceof Error
						? usageError(error.message)
						: usageError("invalid diagnostic flags"),
				outputMode,
				stdout,
				stderr,
				runId: diagnosticArgv.options.runId,
				durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
			});
		} finally {
			resetCliDiagnostics();
		}
	}

	const outputMode = inferOutputMode(diagnosticArgv.argv);
	let parsed: ParsedRouterCommand;
	try {
		parsed = parseRouterArgv(diagnosticArgv.argv);
	} catch (error) {
		configureCliDiagnostics({
			categoryRoot: "browser-use.adapter-router",
			options: diagnosticArgv.options,
			diagnosticWriter: diagnosticArgv.options.quiet
				? quietDiagnosticWriter
				: stderr,
		});
		try {
			return emitCliError({
				error,
				outputMode,
				stdout,
				stderr,
				runId: diagnosticArgv.options.runId,
				durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
			});
		} finally {
			resetCliDiagnostics();
		}
	}

	if (parsed.kind === "help") {
		stdout.write(renderHelp(parsed.command));
		return 0;
	}
	if (parsed.kind === "version") {
		stdout.write(`browser-adapter-router ${VERSION}\n`);
		return 0;
	}

	configureCliDiagnostics({
		categoryRoot: "browser-use.adapter-router",
		options: diagnosticArgv.options,
		diagnosticWriter: diagnosticArgv.options.quiet
			? quietDiagnosticWriter
			: stderr,
	});

	try {
		const context = createCliDiagnosticContext(diagnosticArgv.options);
		return await withCliDiagnosticContext(context, async () => {
			const runId = diagnosticArgv.options.runId;
			const durationMs = () =>
				runtime.now() - diagnosticArgv.options.startedAtMs;
			if (parsed.kind === "report") {
				return executeReport({
					parsed,
					runtime,
					stdout,
					stderr,
					runId,
					durationMs,
				});
			}
			return executeRoute({
				parsed,
				runtime,
				stdout,
				stderr,
				runId,
				durationMs,
			});
		});
	} finally {
		resetCliDiagnostics();
	}
}

async function executeRoute(input: {
	parsed: Extract<ParsedRouterCommand, { kind: "route" }>;
	runtime: RouterRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: () => number;
}): Promise<number> {
	let raw: string;
	try {
		raw = await readEnvelopeSource(input.parsed.envelopePath, input.runtime);
	} catch (error) {
		return emitRouteEvidenceError({
			error,
			outputMode: input.parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});
	}

	let envelope: RouteEvidenceEnvelope;
	try {
		envelope = parseEvidenceEnvelope(raw);
	} catch (error) {
		return emitRouteEvidenceError({
			error,
			outputMode: input.parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});
	}

	const evaluation = evaluateRoute(envelope, input.runtime.evaluationDate);
	if (evaluation.outcome === "selected") {
		writeRouteSuccess(
			input.stdout,
			evaluation,
			input.parsed.outputMode,
			{ runId: input.runId, durationMs: input.durationMs() },
		);
		return 0;
	}
	return emitRouteFailure({
		failure: evaluation,
		outputMode: input.parsed.outputMode,
		stdout: input.stdout,
		stderr: input.stderr,
		runId: input.runId,
		durationMs: input.durationMs(),
	});
}

async function executeReport(input: {
	parsed: Extract<ParsedRouterCommand, { kind: "report" }>;
	runtime: RouterRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: () => number;
}): Promise<number> {
	// V1 has no registry-declared executable self-report command vector. The
	// env override carries a caller-supplied self-report JSON for the validated
	// self-report path; otherwise discovery falls back to the manifest.
	const selfReportRaw = input.runtime.env.BROWSER_USE_ROUTER_SELF_REPORT_JSON;
	let selfReport: unknown;
	if (selfReportRaw) {
		try {
			selfReport = JSON.parse(selfReportRaw);
		} catch {
			return emitCliError({
				error: usageError(
					"BROWSER_USE_ROUTER_SELF_REPORT_JSON is not valid JSON.",
				),
				outputMode: input.parsed.outputMode,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				durationMs: input.durationMs(),
			});
		}
	}

	const discovery = discoverReport(
		input.parsed.adapter,
		input.runtime.evaluationDate,
		selfReport,
	);
	if (discovery.found) {
		writeReportSuccess(
			input.stdout,
			input.parsed,
			discovery,
			input.parsed.outputMode,
			{ runId: input.runId, durationMs: input.durationMs() },
		);
		return 0;
	}
	return emitReportFailure({
		adapter: input.parsed.adapter,
		discovery,
		outputMode: input.parsed.outputMode,
		stdout: input.stdout,
		stderr: input.stderr,
		runId: input.runId,
		durationMs: input.durationMs(),
	});
}

async function readEnvelopeSource(
	envelopePath: string | undefined,
	runtime: RouterRuntime,
): Promise<string> {
	if (envelopePath) {
		try {
			return await runtime.readTextFile(envelopePath);
		} catch {
			// A missing/unreadable envelope file is caller input, not a runtime
			// fault: fail closed with route_evidence_invalid (exit 20) rather than
			// the generic runtime error (exit 1). The path is omitted from the
			// message so it is not echoed into stderr/logs.
			throw new RouteEvidenceError(
				"route_evidence_invalid",
				"Evidence envelope file could not be read.",
			);
		}
	}
	const inline = runtime.env.BROWSER_USE_ROUTER_ENVELOPE_JSON;
	if (inline) return inline;
	return runtime.readStdin();
}

// ---------------------------------------------------------------------------
// Output writers.
// ---------------------------------------------------------------------------

function writeRouteSuccess(
	stdout: CliWriter,
	success: RouteSuccess,
	outputMode: OutputMode,
	runtime: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		stdout.write(
			[
				"adapter_selected",
				`mode=${success.mode}`,
				`requested=${success.requested_adapter ?? "none"}`,
				`selected=${success.selected_adapter}`,
				`confidence=${success.route_confidence}`,
				`capabilities=${success.required_capabilities.join(",") || "none"}`,
				"action=use_selected_browser_adapter",
				`run_id=${runtime.runId}`,
				`duration_ms=${runtime.durationMs}`,
			].join(" ") + "\n",
		);
		return;
	}
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: runtime.runId,
			data: success,
			runtime_actions: [runtimeAction("use_selected_browser_adapter")],
			continuation: {
				next_action_id: "use_selected_browser_adapter",
				constraints: [routeValidityConstraint()],
			},
		}),
		runtime,
	);
}

function writeReportSuccess(
	stdout: CliWriter,
	parsed: Extract<ParsedRouterCommand, { kind: "report" }>,
	discovery: Extract<ReportDiscovery, { found: true }>,
	outputMode: OutputMode,
	runtime: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		stdout.write(
			[
				"report_found",
				`adapter=${parsed.adapter}`,
				`source=${discovery.source}`,
				`attachment=${discovery.report.attachment_model}`,
				`checked_at=${discovery.report.provenance.checked_at}`,
				`run_id=${runtime.runId}`,
				`duration_ms=${runtime.durationMs}`,
			].join(" ") + "\n",
		);
		return;
	}
	const capability = parsed.capability;
	const data = capability
		? {
				adapter_id: parsed.adapter,
				report_source: discovery.source,
				capability: discovery.report.capabilities.find(
					(entry) => entry.capability === capability,
				),
				provenance: discovery.report.provenance,
			}
		: {
				adapter_id: parsed.adapter,
				report_source: discovery.source,
				report: discovery.report,
			};
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({ run_id: runtime.runId, data }),
		runtime,
	);
}

function routeValidityConstraint() {
	return {
		id: "route_validity",
		summary:
			"Route is valid for one Bounded Browser Outcome: no adapter switching, no cold-browser fallback; reroute when bundle, target origin, selected adapter, proof, capability evidence, or preconditions change or expire.",
		forbidden_action_ids: ["adapter_fallback", "cold_browser_fallback"],
	};
}

function emitRouteFailure(input: {
	failure: RouteFailure;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const { failure } = input;
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_adapter_router ${failure.code}: ${failure.message} action=${failure.next_action_id} (run_id=${input.runId})\n`,
		);
		return ROUTE_FAIL_CLOSED_EXIT_CODE;
	}
	const error: StructuredRuntimeError = {
		run_id: input.runId,
		code: failure.code,
		message: failure.message,
		exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
		severity: "error",
		recoverability: recoverabilityForCode(failure.code),
		retryable: false,
		failure_domain: "browser_adapter_router",
	};
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
			error,
			runtime_actions: [runtimeAction(failure.next_action_id)],
			continuation: {
				next_action_id: failure.next_action_id,
				constraints: [routeValidityConstraint()],
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return ROUTE_FAIL_CLOSED_EXIT_CODE;
}

function emitReportFailure(input: {
	adapter: BrowserAdapterId;
	discovery: Extract<ReportDiscovery, { found: false }>;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const code = input.discovery.code;
	const message = input.discovery.diagnostics.join("; ");
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_adapter_router ${code}: ${message} (run_id=${input.runId})\n`,
		);
		return ROUTE_FAIL_CLOSED_EXIT_CODE;
	}
	// Share the route path's per-code continuation mapping; report failures
	// (unknown or stale) both resolve to research_adapter_capability there.
	const nextAction = continuationForCode(code);
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
			error: {
				run_id: input.runId,
				code,
				message,
				exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
				severity: "error",
				recoverability: "change_input",
				retryable: false,
				failure_domain: "browser_adapter_router",
			},
			runtime_actions: [runtimeAction(nextAction)],
			continuation: { next_action_id: nextAction },
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return ROUTE_FAIL_CLOSED_EXIT_CODE;
}

function recoverabilityForCode(
	code: BrowserAdapterRouterDiagnosticCode,
): StructuredRuntimeError["recoverability"] {
	switch (code) {
		case "auth_session_unverified":
		case "target_origin_unverified":
			return "authenticate";
		case "adapter_attachment_unverified":
			return "repair_state";
		case "route_evidence_invalid":
		case "route_evidence_mixed_run":
		case "route_evidence_stale":
		case "adapter_capability_none":
		case "adapter_capability_unknown":
		case "adapter_capability_stale":
		case "adapter_capability_partial":
		case "adapter_attachment_incompatible":
			return "change_input";
		default:
			// Exhaustiveness guard: a new code must declare its recoverability.
			void (code satisfies never);
			return "change_input";
	}
}

function emitRouteEvidenceError(input: {
	error: unknown;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	if (input.error instanceof RouteEvidenceError) {
		const code = input.error.code;
		if (input.outputMode === "plain") {
			input.stderr.write(
				`browser_adapter_router ${code}: ${input.error.message} (run_id=${input.runId})\n`,
			);
			return ROUTE_FAIL_CLOSED_EXIT_CODE;
		}
		writeJsonEnvelope(
			input.stdout,
			createCliRuntimeErrorEnvelope({
				run_id: input.runId,
				process_exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
				error: {
					run_id: input.runId,
					code,
					message: input.error.message,
					exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
					severity: "error",
					recoverability: "change_input",
					retryable: false,
					failure_domain: "browser_adapter_router",
				},
				runtime_actions: [runtimeAction("change_route_input")],
				continuation: { next_action_id: "change_route_input" },
			}),
			{ runId: input.runId, durationMs: input.durationMs },
		);
		return ROUTE_FAIL_CLOSED_EXIT_CODE;
	}
	return emitCliError({
		error: input.error,
		outputMode: input.outputMode,
		stdout: input.stdout,
		stderr: input.stderr,
		runId: input.runId,
		durationMs: input.durationMs,
	});
}

function emitCliError(input: {
	error: unknown;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const isUsage = input.error instanceof CliUsageError;
	const exitCode = isUsage ? USAGE_EXIT_CODE : RUNTIME_FAILURE_EXIT_CODE;
	const message =
		input.error instanceof Error ? input.error.message : "Unknown runtime error.";
	const safeMessage = redactUnsafeText(message);
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_adapter_router ${isUsage ? "usage_error" : "runtime_error"}: ${safeMessage} (run_id=${input.runId})\n`,
		);
		return exitCode;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: exitCode,
			error: {
				run_id: input.runId,
				code: isUsage ? "usage_error" : "runtime_error",
				message: safeMessage,
				exit_code: exitCode,
				severity: isUsage ? "error" : "fatal",
				recoverability: isUsage ? "change_input" : "none",
				retryable: false,
				failure_domain: isUsage ? "input" : "runtime_diagnostics",
			},
			// A usage error is caller-correctable (change input); a fatal runtime
			// error needs an operator. Either way the envelope carries an explicit
			// continuation rather than leaving the agent to guess.
			...(isUsage
				? {
						runtime_actions: [runtimeAction("change_route_input")],
						continuation: { next_action_id: "change_route_input" },
					}
				: { continuation: { requires_operator: true } }),
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return exitCode;
}

// ---------------------------------------------------------------------------
// Argv parsing.
// ---------------------------------------------------------------------------

function parseRouterArgv(argv: readonly string[]): ParsedRouterCommand {
	if (argv.includes("--version")) return { kind: "version" };
	const command = findCommand(argv);
	if (argv.includes("-h") || argv.includes("--help")) {
		return { kind: "help", command };
	}
	if (!command) {
		throw usageError(
			"missing command: expected route, report, or status.",
		);
	}
	const outputMode = inferOutputMode(argv);
	const rest = argv.filter((arg) => arg !== command);

	if (command === "report") {
		const adapter = readEnumFlag(rest, "--adapter", isBrowserAdapter);
		if (!adapter) {
			throw usageError("report requires --adapter <id>.");
		}
		const capability = readEnumFlag(rest, "--capability", isCapability);
		rejectUnknownFlags(rest, [
			"--adapter",
			"--capability",
			"--json",
			"--plain",
		]);
		return { kind: "report", outputMode, adapter, capability };
	}

	const envelopePath = readArgFlagValue(rest, "--envelope");
	rejectUnknownFlags(rest, ["--envelope", "--json", "--plain"]);
	return {
		kind: "route",
		outputMode,
		envelopePath,
	};
}

function findCommand(
	argv: readonly string[],
): BrowserAdapterRouterCommand | undefined {
	return argv.find(isRouterCommand);
}

function isRouterCommand(
	value: string | undefined,
): value is BrowserAdapterRouterCommand {
	return value === "route" || value === "report" || value === "status";
}

function readEnumFlag<T extends string>(
	argv: readonly string[],
	flag: string,
	guard: (value: unknown) => value is T,
): T | undefined {
	const value = readArgFlagValue(argv, flag);
	if (value === undefined) return undefined;
	if (!guard(value)) {
		throw usageError(`invalid value for ${flag}: ${sanitizeUsageValue(value)}`);
	}
	return value;
}

function readArgFlagValue(
	argv: readonly string[],
	flag: string,
): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === flag) {
			const next = argv[index + 1];
			if (next === undefined || next.startsWith("--")) {
				throw usageError(`${flag} requires a value.`);
			}
			return next;
		}
		if (arg.startsWith(`${flag}=`)) {
			return arg.slice(flag.length + 1);
		}
	}
	return undefined;
}

function rejectUnknownFlags(
	argv: readonly string[],
	allowed: readonly string[],
): void {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
		if (!allowed.includes(name)) {
			throw usageError(`unknown option: ${sanitizeUsageValue(name)}`);
		}
		// Skip the value token for space-separated flags.
		if (!arg.includes("=") && argv[index + 1] && !argv[index + 1].startsWith("--")) {
			index += 1;
		}
	}
}

function inferOutputMode(argv: readonly string[]): OutputMode {
	if (argv.includes("--plain")) return "plain";
	return "json";
}

function applyEnvRunId(
	argv: readonly string[],
	runId: string | undefined,
): readonly string[] {
	if (!runId) return argv;
	if (argv.includes("--run-id")) return argv;
	return [...argv, "--run-id", runId];
}

// ---------------------------------------------------------------------------
// Redaction + help.
// ---------------------------------------------------------------------------

function sanitizeUsageValue(value: string): string {
	if (
		value.startsWith("/") ||
		value.startsWith("~/") ||
		value.startsWith("op://") ||
		hasSensitiveOptionName(value)
	) {
		return "[redacted]";
	}
	return redactUnsafeText(value);
}

function redactUnsafeText(value: string): string {
	return value
		.replace(/\bop:\/\/\S+/gi, "[redacted]")
		.replace(/--[A-Za-z0-9][\w-]*(?:=\S*)?/g, (match) =>
			hasSensitiveOptionName(match) ? "[redacted]" : match,
		)
		.replace(/(^|[\s:(])(?:~\/|\/)\S+/g, "$1[redacted]");
}

function hasSensitiveOptionName(value: string): boolean {
	return /(?:password|passwd|passphrase|secret|token|api[-_]?key|credential|auth|cookie|session)/i.test(
		value,
	);
}

function renderHelp(command?: BrowserAdapterRouterCommand): string {
	if (command) return renderCommandUsage(browserAdapterRouterContracts[command]);
	const commandLines = Object.entries(browserAdapterRouterContracts).map(
		([name, contract]) => `  ${name.padEnd(8)} ${contract.summary}`,
	);
	return [
		"Usage: browser-adapter-router <command> [flags]",
		"",
		"Commands:",
		...commandLines,
		"",
		"Global diagnostic flags:",
		"  --run-id <id>   Set run correlation id.",
		"  --quiet         Suppress diagnostics.",
		"  --verbose       Emit info diagnostics to stderr.",
		"  --debug         Emit debug diagnostics to stderr.",
		"  --version       Print version.",
		"",
	].join("\n");
}

// ---------------------------------------------------------------------------
// stdin + test harness.
// ---------------------------------------------------------------------------

async function readAllStdin(): Promise<string> {
	// Fail fast instead of hanging when route/status is invoked with no envelope
	// source and stdin is an interactive terminal. The contract is non-interactive
	// (interactivity: none), so a blocking read on a TTY is a usage error.
	if (process.stdin.isTTY) {
		throw usageError(
			"route requires --envelope <path>, BROWSER_USE_ROUTER_ENVELOPE_JSON, or piped stdin JSON.",
		);
	}
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf-8");
}

class BufferWriter implements CliWriter {
	private content = "";
	write(value: string): boolean {
		this.content += value;
		return true;
	}
	toString(): string {
		return this.content;
	}
}

export async function runForTest(
	argv: readonly string[],
	runtime: RouterRuntime,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runBrowserAdapterRouterCli(argv, {
		runtime,
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

export function validateErrorEnvelopeForTest(envelope: unknown): string[] {
	if (
		!envelope ||
		typeof envelope !== "object" ||
		Array.isArray(envelope) ||
		!("error" in envelope)
	) {
		return ["envelope.error missing"];
	}
	const error = (envelope as { error: unknown }).error;
	const runId =
		"run_id" in envelope && typeof envelope.run_id === "string"
			? envelope.run_id
			: undefined;
	const exitCode =
		error && typeof error === "object" && "exit_code" in error
			? (error as { exit_code: unknown }).exit_code
			: undefined;
	return validateStructuredRuntimeError(error, {
		run_id: runId,
		process_exit_code: typeof exitCode === "number" ? exitCode : undefined,
	});
}

if (import.meta.main) {
	const exitCode = await runBrowserAdapterRouterCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
