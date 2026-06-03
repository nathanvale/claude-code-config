import {
	type DiagnosticTrailReference,
	type RuntimeActionGuidance,
	type StructuredRuntimeError,
	validateStructuredRuntimeError,
} from "@side-quest/cli-command-facade";
import {
	type BrowserAdapterRouterDiagnosticCode,
	type BrowserAdapterRouterPrepareDiagnosticCode,
	browserAdapterRouterFailureActions,
	browserAdapterRouterPrepareFailureActions,
	browserAdapterRouterPrepareSuccessActions,
	browserAdapterRouterSuccessActions,
} from "./command-contract";
import type {
	RouterFailureActionId,
	RouterSuccessActionId,
	RouterPrepareFailureActionId,
	RouterPrepareSuccessActionId,
} from "./browser-adapter-router-model";

const routerRuntimeActions = [
	...browserAdapterRouterFailureActions,
	...browserAdapterRouterSuccessActions,
	...browserAdapterRouterPrepareFailureActions,
	...browserAdapterRouterPrepareSuccessActions,
] as const;

const routerRuntimeActionById = new Map(
	routerRuntimeActions.map((action) => [action.id, action]),
);

export function continuationForCode(
	code: BrowserAdapterRouterDiagnosticCode,
): RouterFailureActionId {
	switch (code) {
		case "adapter_attachment_unverified":
			return "prove_adapter_attachment";
		case "adapter_capability_stale":
		case "adapter_capability_unknown":
			return "research_adapter_capability";
		case "adapter_capability_partial":
			return "change_route_input";
		case "auth_session_unverified":
			return "verify_auth_session";
		case "target_origin_unverified":
			return "verify_target_origin";
		case "adapter_capability_none":
		case "adapter_attachment_incompatible":
		case "route_evidence_invalid":
		case "route_evidence_mixed_run":
		case "route_evidence_stale":
			return "change_route_input";
		default:
			return assertNeverDiagnosticCode(code);
	}
}

export function recoverabilityForCode(
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
			void (code satisfies never);
			return "change_input";
	}
}

// Continuation + recoverability for prepare missing-fact codes (R6). prepare
// codes name missing input facts, distinct from route evaluation codes.
export function prepareContinuationForCode(
	code: BrowserAdapterRouterPrepareDiagnosticCode,
): RouterPrepareFailureActionId {
	switch (code) {
		case "prepare_warm_chrome_missing":
			return "prove_warm_chrome";
		case "prepare_report_missing":
			return "discover_capability_report";
		case "prepare_adapter_proof_missing":
			return "prove_adapter_attachment";
		case "prepare_input_invalid":
			return "change_prepare_input";
		default:
			void (code satisfies never);
			return "change_prepare_input";
	}
}

export function prepareRecoverabilityForCode(
	code: BrowserAdapterRouterPrepareDiagnosticCode,
): StructuredRuntimeError["recoverability"] {
	switch (code) {
		case "prepare_warm_chrome_missing":
		case "prepare_adapter_proof_missing":
			return "repair_state";
		case "prepare_report_missing":
		case "prepare_input_invalid":
			return "change_input";
		default:
			void (code satisfies never);
			return "change_input";
	}
}

export function runtimeActionForId(
	id:
		| RouterFailureActionId
		| RouterSuccessActionId
		| RouterPrepareFailureActionId
		| RouterPrepareSuccessActionId,
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

export function routeValidityConstraint() {
	return {
		id: "route_validity",
		summary:
			"Route is valid for one Bounded Browser Outcome: no adapter switching, no cold-browser fallback; reroute when bundle, target origin, selected adapter, proof, capability evidence, or preconditions change or expire.",
		forbidden_action_ids: ["adapter_fallback", "cold_browser_fallback"],
	};
}

export function researchRecoveryDiagnosticTrail(
	runId: string,
): DiagnosticTrailReference {
	return {
		run_id: runId,
		surface: {
			kind: "diagnostic_capability",
			id: "browser-adapter-router.research_adapter_capability",
		},
		summary:
			"Router-owned bounded research detail for stale or unknown adapter capability evidence.",
	};
}

export function validateRouterErrorEnvelope(
	envelope: unknown,
	options: { requireRouteValidity?: boolean } = {},
): string[] {
	const issues = validateRouterContinuationEnvelope(envelope, options);
	if (!isJsonObject(envelope) || !("error" in envelope)) {
		return [...issues, "envelope.error missing"];
	}
	const error = envelope.error;
	const runId =
		"run_id" in envelope && typeof envelope.run_id === "string"
			? envelope.run_id
			: undefined;
	const exitCode =
		error && typeof error === "object" && "exit_code" in error
			? (error as { exit_code: unknown }).exit_code
			: undefined;
	return [
		...issues,
		...validateStructuredRuntimeError(error, {
			run_id: runId,
			process_exit_code: typeof exitCode === "number" ? exitCode : undefined,
		}),
	];
}

export function validateRouterContinuationEnvelope(
	envelope: unknown,
	options: { requireRouteValidity?: boolean } = {},
): string[] {
	if (!isJsonObject(envelope)) return ["envelope must be a JSON object"];
	const continuation = isJsonObject(envelope.continuation)
		? envelope.continuation
		: undefined;
	if (!continuation) return ["envelope.continuation missing"];
	if (continuation.requires_operator === true) return [];

	const nextAction = continuation.next_action_id;
	const issues: string[] = [];
	if (typeof nextAction !== "string") {
		issues.push("envelope.continuation.next_action_id missing");
	} else {
		const actionIds = Array.isArray(envelope.runtime_actions)
			? envelope.runtime_actions
					.filter(isJsonObject)
					.map((action) => action.id)
					.filter((id): id is string => typeof id === "string")
			: [];
		if (!actionIds.includes(nextAction)) {
			issues.push(
				"envelope.continuation.next_action_id missing from runtime_actions",
			);
		}
	}

	if (options.requireRouteValidity) {
		const constraints = Array.isArray(continuation.constraints)
			? continuation.constraints
			: [];
		if (
			!constraints
				.filter(isJsonObject)
				.some((constraint) => constraint.id === "route_validity")
		) {
			issues.push("envelope.continuation.route_validity missing");
		}
	}

	return issues;
}

function assertNeverDiagnosticCode(code: never): "change_route_input" {
	void code;
	return "change_route_input";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
