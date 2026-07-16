import {
	BROWSER_ADAPTER_ROUTER_ADAPTERS,
	BROWSER_ADAPTER_ROUTER_ATTACHMENT_MODELS,
	BROWSER_ADAPTER_ROUTER_BUNDLES,
	BROWSER_ADAPTER_ROUTER_CAPABILITIES,
	BROWSER_ADAPTER_ROUTER_MODES,
	BROWSER_ADAPTER_ROUTER_SUPPORT_STATES,
	type BrowserAdapterRouterAttachmentModel,
	type BrowserAdapterRouterDiagnosticCode,
	type BrowserAdapterRouterMode,
	type BrowserAdapterRouterSupportState,
} from "./command-contract";
import type {
	AdapterCapability,
	BrowserAdapterId,
	CapabilityEntry,
	CapabilityReport,
	CapabilityReportProvenance,
	RouteEvidenceEnvelope,
	RoutePolicy,
	RoutePreconditionEvidence,
	RouteTask,
} from "./browser-adapter-router-model";

declare const validatedRouteEvidenceEnvelopeBrand: unique symbol;

export type ValidatedRouteEvidenceEnvelope = RouteEvidenceEnvelope & {
	readonly [validatedRouteEvidenceEnvelopeBrand]: true;
};

export type RouteValidationResult =
	| { ok: true; envelope: ValidatedRouteEvidenceEnvelope }
	| { ok: false; diagnostics: string[] };

// Envelope-shape failures surface as runtime/usage errors, not RouteEvaluation.
export class RouteEvidenceError extends Error {
	readonly code: BrowserAdapterRouterDiagnosticCode;
	constructor(code: BrowserAdapterRouterDiagnosticCode, message: string) {
		super(message);
		this.name = "RouteEvidenceError";
		this.code = code;
	}
}

export function parseRouteEvidenceEnvelope(
	raw: string,
): ValidatedRouteEvidenceEnvelope {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new RouteEvidenceError(
			"route_evidence_invalid",
			"Evidence envelope is not valid JSON.",
		);
	}
	const result = validateRouteEvidenceEnvelope(value);
	if (!result.ok) {
		throw new RouteEvidenceError(
			"route_evidence_invalid",
			`Evidence envelope is schema-invalid: ${result.diagnostics.join("; ")}`,
		);
	}
	return result.envelope;
}

export function validateRouteEvidenceEnvelope(
	value: unknown,
): RouteValidationResult {
	if (!isJsonObject(value)) {
		return {
			ok: false,
			diagnostics: ["Evidence envelope must be a JSON object."],
		};
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
		if (
			(policy.mode === "force" || policy.mode === "prefer") &&
			policy.adapter_id === undefined
		) {
			issues.push("envelope.policy.adapter_id is required in force/prefer mode");
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
		if (
			bundle !== undefined &&
			!(
				typeof bundle === "string" &&
				(BROWSER_ADAPTER_ROUTER_BUNDLES as readonly string[]).includes(bundle)
			)
		) {
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
		const adapterRanking = value.task.adapter_ranking;
		if (adapterRanking !== undefined) {
			if (
				!Array.isArray(adapterRanking) ||
				!adapterRanking.every(isBrowserAdapter)
			) {
				issues.push(
					"envelope.task.adapter_ranking must be known registry adapters",
				);
			}
		}
		const mediaProof = value.task.media_proof;
		if (mediaProof !== undefined) {
			if (
				!isJsonObject(mediaProof) ||
				typeof mediaProof.requested !== "boolean" ||
				typeof mediaProof.run_scoped_path !== "string" ||
				mediaProof.run_scoped_path === ""
			) {
				issues.push(
					"envelope.task.media_proof must include boolean requested and non-empty run_scoped_path",
				);
			}
		}
	}
	if (issues.length > 0) {
		return { ok: false, diagnostics: issues };
	}

	// Validate every supplied report through the shared validator (R8b). An
	// invalid report makes the whole envelope invalid — the caller must assemble
	// validated reports.
	const reports: CapabilityReport[] = [];
	for (const [index, report] of (value.reports as unknown[]).entries()) {
		const result = validateCapabilityReport(report);
		if (!result.ok) {
			return {
				ok: false,
				diagnostics: [
					`envelope.reports[${index}] is invalid: ${result.diagnostics.join("; ")}`,
				],
			};
		}
		reports.push(result.report);
	}

	return {
		ok: true,
		envelope: ({
			run_id: value.run_id as string,
			policy: value.policy as RoutePolicy,
			task: (isJsonObject(value.task) ? value.task : {}) as RouteTask,
			preconditions: value.preconditions as RoutePreconditionEvidence,
			reports,
		} as unknown) as ValidatedRouteEvidenceEnvelope,
	};
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMode(value: unknown): value is BrowserAdapterRouterMode {
	return (
		typeof value === "string" &&
		(BROWSER_ADAPTER_ROUTER_MODES as readonly string[]).includes(value)
	);
}

// ---------------------------------------------------------------------------
// Capability report validation. Moved verbatim from the deleted
// browser-adapter-router-report-validation.ts (migration cleanup U3): the
// route-evidence validator above is its only surviving caller. The same
// validator runs against every report supplied in a route evidence envelope
// (R8b).
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
	if (value.validation !== "valid") {
		diagnostics.push("report.validation must be valid");
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
	if (
		!isJsonObject(value.evidence) ||
		typeof value.evidence.verification_method !== "string" ||
		value.evidence.verification_method === ""
	) {
		issues.push(
			`report.capabilities[${index}].evidence.verification_method is required`,
		);
	}
	return issues;
}

export function isBrowserAdapter(value: unknown): value is BrowserAdapterId {
	return (
		typeof value === "string" &&
		(BROWSER_ADAPTER_ROUTER_ADAPTERS as readonly string[]).includes(value)
	);
}

export function isCapability(value: unknown): value is AdapterCapability {
	return (
		typeof value === "string" &&
		(BROWSER_ADAPTER_ROUTER_CAPABILITIES as readonly string[]).includes(value)
	);
}

function isSupportState(
	value: unknown,
): value is BrowserAdapterRouterSupportState {
	return (
		typeof value === "string" &&
		(BROWSER_ADAPTER_ROUTER_SUPPORT_STATES as readonly string[]).includes(value)
	);
}

function isAttachmentModel(
	value: unknown,
): value is BrowserAdapterRouterAttachmentModel {
	return (
		typeof value === "string" &&
		(BROWSER_ADAPTER_ROUTER_ATTACHMENT_MODELS as readonly string[]).includes(value)
	);
}
