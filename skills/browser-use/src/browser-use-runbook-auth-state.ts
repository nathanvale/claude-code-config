import {
	type AgentBrowserExecutionRuntime,
	type AgentBrowserVerifiedHandoff,
	type BrowserUseNativeDocumentReadPort,
	type BrowserUseNativeTargetProofPort,
	type BrowserUseNativeTargetProofV1,
	executeAgentBrowserTask,
	proveAgentBrowserTarget,
	readAgentBrowserDocument,
} from "./browser-use-agent-browser";
import type { BrowserUseGenerationReviewedActionRef } from "./browser-use-generation-schemas";
import {
	type BrowserUseActionGenerationSeam,
	actionValueMatchesSchema,
	resolveReviewedAction,
} from "./browser-use-runbook-actions";

const AUTH_FIELDS = ["username", "password", "otp"] as const;
type RunbookAuthField = (typeof AUTH_FIELDS)[number];

export type BrowserUseReviewedAuthState =
	| { status: "fields-required"; fields: readonly RunbookAuthField[] }
	| {
			status: "human-presence-required";
			challenge: "mfa" | "captcha" | "passkey";
	  }
	| { status: "unproven" };

function exactKeys(
	value: Readonly<Record<string, unknown>>,
	expected: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function parseReviewedAuthState(value: unknown): BrowserUseReviewedAuthState {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { status: "unproven" };
	}
	const candidate = value as Record<string, unknown>;
	if (
		candidate.schema_version !== "1" ||
		typeof candidate.status !== "string"
	) {
		return { status: "unproven" };
	}
	if (candidate.status === "fields-required") {
		if (
			!exactKeys(candidate, ["schema_version", "status", "fields"]) ||
			!Array.isArray(candidate.fields) ||
			candidate.fields.length === 0 ||
			candidate.fields.length > AUTH_FIELDS.length
		) {
			return { status: "unproven" };
		}
		const fields = candidate.fields;
		let priorIndex = -1;
		for (const field of fields) {
			const index = AUTH_FIELDS.indexOf(field as RunbookAuthField);
			if (index <= priorIndex) return { status: "unproven" };
			priorIndex = index;
		}
		return {
			status: "fields-required",
			fields: [...(fields as RunbookAuthField[])],
		};
	}
	if (
		candidate.status === "human-presence-required" &&
		exactKeys(candidate, ["schema_version", "status", "challenge"]) &&
		["mfa", "captcha", "passkey"].includes(candidate.challenge as string)
	) {
		return {
			status: "human-presence-required",
			challenge: candidate.challenge as "mfa" | "captcha" | "passkey",
		};
	}
	return { status: "unproven" };
}

function targetProofsEqual(
	left: BrowserUseNativeTargetProofV1,
	right: BrowserUseNativeTargetProofV1,
): boolean {
	return (
		left.lane_id === right.lane_id &&
		left.target_id === right.target_id &&
		left.page_id === right.page_id &&
		left.frame_id === right.frame_id &&
		left.document_id === right.document_id &&
		left.top_level_origin === right.top_level_origin &&
		left.frame_origin === right.frame_origin &&
		left.target_proof_digest === right.target_proof_digest
	);
}

/**
 * Execute one digest-pinned read action against the exact IdP target.
 *
 * Native target proof brackets the reviewed read. Any action, result-shape,
 * origin, frame, or target drift collapses to `unproven`.
 */
export async function identifyRunbookAuthState(input: {
	approvedOrigins: readonly string[];
	action: BrowserUseGenerationReviewedActionRef;
	actionSeam: BrowserUseActionGenerationSeam;
	runCommand: AgentBrowserExecutionRuntime["runCommand"];
	targetProof: BrowserUseNativeTargetProofPort;
	handoff: AgentBrowserVerifiedHandoff;
	runId: string;
	targetId: string;
	expectedTargetProofDigest?: string;
	documentRead?: BrowserUseNativeDocumentReadPort;
	expectedDocumentProof?: BrowserUseNativeTargetProofV1;
}): Promise<BrowserUseReviewedAuthState> {
	if (
		(input.documentRead === undefined) !==
		(input.expectedDocumentProof === undefined)
	) {
		return { status: "unproven" };
	}
	const before =
		input.expectedDocumentProof === undefined
			? await proveAgentBrowserTarget({
					targetProof: input.targetProof,
					handoff: input.handoff,
					target_id: input.targetId,
				})
			: {
					ok: true as const,
					proof: input.expectedDocumentProof,
				};
	if (
		!before.ok ||
		before.proof.target_id !== input.targetId ||
		before.proof.top_level_origin !== before.proof.frame_origin ||
		(input.expectedTargetProofDigest !== undefined &&
			before.proof.target_proof_digest !==
				input.expectedTargetProofDigest) ||
		!input.approvedOrigins.includes(before.proof.top_level_origin)
	) {
		return { status: "unproven" };
	}
	const resolved = await resolveReviewedAction({
		actionId: input.action.action_id,
		expectedDigest: input.action.expected_digest,
		requestedOrigin: before.proof.top_level_origin,
		inputs: {},
		seam: input.actionSeam,
	});
	if (
		!resolved.ok ||
		resolved.resolved.effect_class !== "read" ||
		resolved.resolved.step.effect !== "read" ||
		resolved.resolved.result_sensitivity !== "low"
	) {
		return { status: "unproven" };
	}
	if (
		input.documentRead !== undefined &&
		input.expectedDocumentProof !== undefined
	) {
		const execution = await readAgentBrowserDocument({
			documentRead: input.documentRead,
			handoff: input.handoff,
			expectedProof: input.expectedDocumentProof,
			step: resolved.resolved.step,
		});
		if (
			!execution.ok ||
			!actionValueMatchesSchema(
				execution.data,
				resolved.resolved.result_schema,
			)
		) {
			return { status: "unproven" };
		}
		return parseReviewedAuthState(execution.data);
	}
	const execution = await executeAgentBrowserTask(
		{ runCommand: input.runCommand },
		{
			handoff: input.handoff,
			run_id: input.runId,
			target_tab_id: input.targetId,
			allowed_origins: [before.proof.top_level_origin],
			steps: [
				{ kind: "snapshot", interactive: false },
				resolved.resolved.step,
			],
		},
	);
	const after = await proveAgentBrowserTarget({
		targetProof: input.targetProof,
		handoff: input.handoff,
		target_id: input.targetId,
	});
	if (
		!after.ok ||
		!targetProofsEqual(before.proof, after.proof) ||
		!execution.ok ||
		execution.outcome !== "confirmed" ||
		execution.executed_steps !== 2 ||
		execution.mutation_dispatched ||
		execution.target_tab_id !== before.proof.target_id ||
		execution.read_results?.length !== 1 ||
		execution.read_results[0]?.action_id !== input.action.action_id ||
		execution.read_results[0]?.item_key !== undefined
	) {
		return { status: "unproven" };
	}
	const observation = execution.read_results[0].data;
	if (
		!actionValueMatchesSchema(
			observation,
			resolved.resolved.result_schema,
		)
	) {
		return { status: "unproven" };
	}
	return parseReviewedAuthState(observation);
}
