import {
	BROWSER_ADAPTER_ROUTER_BUNDLES,
	BROWSER_ADAPTER_ROUTER_MODES,
	type BrowserAdapterRouterDiagnosticCode,
	type BrowserAdapterRouterMode,
} from "./command-contract";
import type {
	CapabilityReport,
	RouteEvidenceEnvelope,
	RoutePolicy,
	RoutePreconditionEvidence,
	RouteTask,
} from "./browser-adapter-router-model";
import {
	isBrowserAdapter,
	isCapability,
	validateCapabilityReport,
} from "./browser-adapter-router-report-validation";

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
