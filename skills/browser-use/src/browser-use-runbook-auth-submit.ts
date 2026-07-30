import {
	type AgentBrowserExecutionRuntime,
	type AgentBrowserVerifiedHandoff,
	type BrowserUseNativeTargetProofPort,
	executeAgentBrowserReviewedAuthSubmit,
	proveAgentBrowserTarget,
} from "./browser-use-agent-browser";
import type { BrowserUseGenerationReviewedActionRef } from "./browser-use-generation-schemas";
import {
	type BrowserUseActionGenerationSeam,
	resolveReviewedAction,
} from "./browser-use-runbook-actions";

/** Secret-free outcome from one reviewed authentication-form submission. */
export type BrowserUseReviewedAuthSubmitOutcome =
	| {
			status: "confirmed";
			page_departed: true;
			document_id: string;
			target_proof_digest: string;
	  }
	| { status: "blocked" }
	| { status: "unknown" };

/**
 * Execute only an explicitly purposed authentication-form submit action.
 *
 * The reviewed action's structural postcondition proves the bounded mutation,
 * not authentication. Callers still need post-submit classification and exact
 * Session Identity Proof before a run can become ready.
 *
 * @param input - Digest-pinned action, exact target authority, and final write-ahead hook
 * @returns Confirmed structural mutation, clean pre-dispatch block, or unsafe unknown
 * @internal
 */
export async function submitReviewedRunbookAuthAction(input: {
	approvedIdentityProviderOrigins: readonly string[];
	approvedPostSubmitOrigins: readonly string[];
	action: BrowserUseGenerationReviewedActionRef;
	actionSeam: BrowserUseActionGenerationSeam;
	runCommand: AgentBrowserExecutionRuntime["runCommand"];
	targetProof: BrowserUseNativeTargetProofPort;
	handoff: AgentBrowserVerifiedHandoff;
	runId: string;
	targetId: string;
	beforeMutationDispatch: NonNullable<
		AgentBrowserExecutionRuntime["beforeMutationDispatch"]
	>;
}): Promise<BrowserUseReviewedAuthSubmitOutcome> {
	const before = await proveAgentBrowserTarget({
		targetProof: input.targetProof,
		handoff: input.handoff,
		target_id: input.targetId,
	});
	if (
		!before.ok ||
		before.proof.target_id !== input.targetId ||
		before.proof.top_level_origin !== before.proof.frame_origin ||
		!input.approvedIdentityProviderOrigins.includes(
			before.proof.top_level_origin,
		)
	) {
		return { status: "blocked" };
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
		resolved.resolved.effect_class !== "mutation" ||
		resolved.resolved.step.effect !== "mutation" ||
		resolved.resolved.purpose !== "runbook-auth-submit" ||
		resolved.resolved.step.item_key !== undefined ||
		resolved.resolved.step.postcondition === undefined ||
		Object.keys(resolved.resolved.step.inputs).length !== 0
	) {
		return { status: "blocked" };
	}
	const postcondition = resolved.resolved.step.postcondition;
	if (postcondition.kind !== "url-equals") {
		return { status: "blocked" };
	}
	try {
		if (
			!input.approvedPostSubmitOrigins.includes(
				new URL(postcondition.url).origin,
			)
		) {
			return { status: "blocked" };
		}
	} catch {
		return { status: "blocked" };
	}

	const execution = await executeAgentBrowserReviewedAuthSubmit(
		{
			runCommand: input.runCommand,
			beforeMutationDispatch: async ({ run_id }) => {
				const immediate = await proveAgentBrowserTarget({
					targetProof: input.targetProof,
					handoff: input.handoff,
					target_id: input.targetId,
				});
				if (
					!immediate.ok ||
					immediate.proof.lane_id !== before.proof.lane_id ||
					immediate.proof.target_id !== before.proof.target_id ||
					immediate.proof.page_id !== before.proof.page_id ||
					immediate.proof.frame_id !== before.proof.frame_id ||
					immediate.proof.top_level_origin !==
						before.proof.top_level_origin ||
					immediate.proof.frame_origin !==
						before.proof.frame_origin ||
					immediate.proof.target_proof_digest !==
						before.proof.target_proof_digest
				) {
					return { ok: false };
				}
				return await input.beforeMutationDispatch({ run_id });
			},
		},
		{
			handoff: input.handoff,
			run_id: input.runId,
			target_tab_id: input.targetId,
			allowed_origins: [
				...new Set([
					...input.approvedIdentityProviderOrigins,
					...input.approvedPostSubmitOrigins,
				]),
			],
			steps: [resolved.resolved.step],
		},
	);
	if (!execution.mutation_dispatched) {
		return { status: "blocked" };
	}

	const after = await proveAgentBrowserTarget({
		targetProof: input.targetProof,
		handoff: input.handoff,
		target_id: input.targetId,
	});
	if (
		!after.ok ||
		after.proof.lane_id !== before.proof.lane_id ||
		after.proof.target_id !== before.proof.target_id ||
		after.proof.top_level_origin !== after.proof.frame_origin ||
		!input.approvedPostSubmitOrigins.includes(
			after.proof.top_level_origin,
		)
	) {
		return { status: "unknown" };
	}
	return execution.ok &&
		execution.outcome === "confirmed" &&
		execution.executed_steps === 1 &&
		execution.target_tab_id === input.targetId &&
		after.proof.document_id !== before.proof.document_id
		? {
				status: "confirmed",
				page_departed: true,
				document_id: after.proof.document_id,
				target_proof_digest:
					after.proof.target_proof_digest,
			}
		: { status: "unknown" };
}
