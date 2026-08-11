// ---------------------------------------------------------------------------
// Shared Browser Use run model (platform plan 2026-07-21-002 U1).
//
// The ONE shared run schema (R6, R24-R28): task intent vocabulary, run
// state/revision, environment/profile identity, the opaque versioned auth
// fragment slot, the bounded auth attestation reference, postcondition,
// receipt, artifact, continuation, and non-authoritative caller metadata —
// each defined once. Pure model + guards only: persistence, XDG stores, and
// leases land in platform U2; auth transaction internals live in the auth
// plan and reach this run ONLY through the integration Port below. Platform
// code is the sole run-store writer; auth code returns fragments and never
// touches run persistence.
// ---------------------------------------------------------------------------

import type { BrowserAdapterId } from "./discovery-model";
import { BROWSER_USE_LIVE_ADAPTERS } from "./discovery-model";
import { SAFE_BATCH_ITEM_KEY } from "./browser-use-identifiers";

// --- Task intents (R21-R23) -------------------------------------------------

/**
 * Code-owned Task Intent vocabulary (R21). Distinctions the plan fixes:
 * runbook execution is not trace inspection or HAR replay (R22), and a
 * Lighthouse audit is not performance profiling (R23).
 */
export const BROWSER_USE_TASK_INTENTS = [
	"routine-automation",
	"runbook-execution",
	"scrape",
	"frontend-test",
	"locator-aria-assertion",
	"trace-inspection",
	"http-replay",
	"debug",
	"performance-profile",
	"lighthouse-audit",
] as const;

/** Task intent union. */
export type BrowserUseTaskIntent = (typeof BROWSER_USE_TASK_INTENTS)[number];

/**
 * Discovery-facing Task Intent definition. `preferred_adapter` is present
 * only when the preferred lane is a registered live adapter; a missing value
 * is honest typed unavailability (KTD12), never an invitation to guess. The
 * Chrome DevTools CLI lane registers in platform U5.
 */
export type BrowserUseTaskIntentDefinition = {
	task_intent: BrowserUseTaskIntent;
	summary: string;
	preferred_adapter?: BrowserAdapterId;
};

/**
 * The code-owned Task Intent catalog `browser-use task list` projects.
 * Preferred lanes follow the platform plan's product table; the
 * debug/performance-profile/lighthouse-audit intents route to the
 * chrome-devtools-mcp lane now that its read-only debugging/performance
 * executor (browser-use-chrome-task.ts) is wired into `task run`.
 */
export const BROWSER_USE_TASK_INTENT_DEFINITIONS: readonly BrowserUseTaskIntentDefinition[] = [
	{
		task_intent: "routine-automation",
		summary: "Routine portal automation through the daily-work lane.",
		preferred_adapter: "agent-browser",
	},
	{
		task_intent: "runbook-execution",
		summary: "Execute one active Browser Runbook mechanically.",
		preferred_adapter: "agent-browser",
	},
	{
		task_intent: "scrape",
		summary: "Provenance-labelled extraction from a proven page.",
		preferred_adapter: "agent-browser",
	},
	{
		task_intent: "frontend-test",
		summary: "Frontend interaction proof with native artifacts.",
		preferred_adapter: "playwright-cdp",
	},
	{
		task_intent: "locator-aria-assertion",
		summary: "Locator and ARIA evidence; not a complete accessibility audit.",
		preferred_adapter: "playwright-cdp",
	},
	{
		task_intent: "trace-inspection",
		summary: "Inspect trace evidence; a trace is evidence, not a runbook.",
		preferred_adapter: "playwright-cdp",
	},
	{
		task_intent: "http-replay",
		summary: "Replay captured HTTP archives against a proven target.",
		preferred_adapter: "playwright-cdp",
	},
	{
		task_intent: "debug",
		summary: "Console, network, and heap debugging.",
		preferred_adapter: "chrome-devtools-mcp",
	},
	{
		task_intent: "performance-profile",
		summary: "Performance trace profiling; distinct from a Lighthouse audit.",
		preferred_adapter: "chrome-devtools-mcp",
	},
	{
		task_intent: "lighthouse-audit",
		summary: "Lighthouse audit; distinct from performance profiling.",
		preferred_adapter: "chrome-devtools-mcp",
	},
];

// --- Run states (R24) -------------------------------------------------------

/**
 * Shared run states (R24). Exactly one per run; blocked states carry exactly
 * one next safe action.
 */
export const BROWSER_USE_RUN_STATES = [
	"awaiting-auth",
	"awaiting-approval",
	"awaiting-user-presence",
	"ready",
	"running",
	"confirmed",
	"not-achieved",
	"unknown",
	"needs-human",
] as const;

/** Run state union. */
export type BrowserUseRunState = (typeof BROWSER_USE_RUN_STATES)[number];

/**
 * Blocked states (R24): a run here MUST carry exactly one continuation.
 */
export const BROWSER_USE_BLOCKED_RUN_STATES = [
	"awaiting-auth",
	"awaiting-approval",
	"awaiting-user-presence",
	"needs-human",
] as const satisfies readonly BrowserUseRunState[];

/**
 * Terminal truth states (R25): evidence classification, never optimism.
 * `unknown` blocks retry and adapter switch (R26).
 */
export const BROWSER_USE_TERMINAL_RUN_STATES = [
	"confirmed",
	"not-achieved",
	"unknown",
] as const satisfies readonly BrowserUseRunState[];

// --- Field vocabularies defined once (U1) ------------------------------------

/**
 * Logical environment/profile identity (KTD13, R3). Mirrors the Verified
 * Handoff Envelope's schema-2 environment identity; Warm Chrome owns the
 * physical profile bytes, so no filesystem path ever appears here.
 */
export type BrowserUseEnvironmentProfileIdentity = {
	environment: string;
	profile: string;
};

/**
 * Non-authoritative caller metadata (R35). Audit record only: no code path
 * may branch on it, and it never changes semantics, authority, or schema.
 */
export type BrowserUseCallerMetadata = {
	label: string | null;
};

/**
 * Opaque versioned auth fragment slot (R6, KTD10 of the auth plan). The auth
 * plan owns the fragment's content and versioning; the platform stores it
 * verbatim and never introspects beyond `schema_version`. No secret material
 * is ever legal here — the auth fragment is secret-free by its own contract.
 */
export type BrowserUseAuthFragmentSlot = {
	schema_version: string;
	fragment: unknown;
};

/**
 * Bounded auth attestation reference (R6/R30 consumer view). Opaque digest
 * plus a freshness bound; the auth plan owns attestation content. A run
 * cannot become `ready` without one.
 */
export type BrowserUseAuthAttestationReference = {
	attestation_digest: string;
	fresh_until_epoch_ms: number;
};

/**
 * Auth-owned runtime verification seam for the opaque fragment and bounded
 * attestation. Platform code invokes this Port before persistence or
 * mutation; it never guesses whether auth-owned content is secret-free or
 * reconstructs the attestation's full binding digest.
 */
export type BrowserUseAuthContractPort = {
	validateSecretFreeFragment(fragment: BrowserUseAuthFragmentSlot): boolean;
	/**
	 * Async because the production attestation source is the durable store
	 * (auth plan U3a): the verifier looks the record up by digest before it
	 * can re-prove binding and freshness.
	 */
	verifyAttestation(input: {
		reference: BrowserUseAuthAttestationReference;
		run_id: string;
		environment_profile: BrowserUseEnvironmentProfileIdentity;
		adapter_id: BrowserAdapterId;
		handoff_evidence_id: string;
		at_epoch_ms: number;
	}): Promise<boolean>;
};

/**
 * Structural postcondition declared before mutation (R25).
 */
export type BrowserUseRunPostcondition = {
	id: string;
	summary: string;
};

/**
 * Redacted per-run receipt projection (R24/R29). Summary facts only; no
 * secret, endpoint, or raw target detail is legal in a receipt.
 */
export type BrowserUseRunReceipt = {
	run_id: string;
	revision: number;
	state: BrowserUseRunState;
	summary: string;
};

/**
 * Artifact retention classes (R29): raw authenticated artifacts default
 * ephemeral; failure/drift evidence has bounded retention; explicit exports
 * transfer ownership out of default retention.
 */
const BROWSER_USE_ARTIFACT_RETENTION_CLASSES = [
	"ephemeral",
	"failure-evidence",
	"export",
] as const;

/** Artifact retention class union. */
export type BrowserUseArtifactRetentionClass =
	(typeof BROWSER_USE_ARTIFACT_RETENTION_CLASSES)[number];

/**
 * Artifact reference carried by the shared run (R29). The full manifest is a
 * platform U2 store concern; the run carries references only.
 */
export type BrowserUseArtifactReference = {
	artifact_id: string;
	sensitivity: "low" | "high";
	retention: BrowserUseArtifactRetentionClass;
};

/** Durable explicit approval bound to the exact continuation and review artifact. */
export type BrowserUseRunApprovalRecord = {
	continuation_id: string;
	artifact_id: string;
	approved_at_epoch_ms: number;
	/** Write-ahead marker set immediately before the approved mutation dispatch. */
	dispatch_started_at_epoch_ms?: number;
};

/**
 * Exactly-one next safe action for a blocked run (R24).
 */
export type BrowserUseRunContinuation = {
	next_action_id: string;
	summary: string;
};

/** Private durable binding to one Agent Browser target. */
export type BrowserUseRunbookTargetBinding = {
	schema_version: "1";
	mode: "exact" | "automatic";
	/** Opaque candidate identity; never the raw adapter tab id. */
	binding_id: string;
};

/** Durable runbook identity and first unproven step. */
export type BrowserUseRunbookProgress = {
	schema_version: "1";
	service_id: string;
	flow_id: string;
	runbook_version: string;
	next_step: number;
	total_steps: number;
};

/**
 * The IMMUTABLE run execution binding persisted at run creation (R38, KTD13).
 * Pins a run to one exact catalog identity so a resume resolves ONLY the pinned
 * generation and rejects any replacement authority from flags. The rich
 * resolver logic (drift/epoch/input/item-key checks) lives in
 * browser-use-runbook-actions.ts; the run carries the pinned facts durably.
 * Exactly one of `normalized_input_digest` / `governed_input_artifact_ref` is
 * present (R41 — an ordinary input keeps only a digest; a sensitive input is a
 * retention-owned artifact ref).
 */
export type BrowserUseRunExecutionBindingState = {
	schema_version: "1";
	generation_id: string;
	activation_epoch: number;
	service_id: string;
	flow_id: string;
	runbook_version: string;
	runbook_digest: string;
	action_registry_digest: string;
	normalized_input_digest?: string;
	governed_input_artifact_ref?: string;
	item_key_digest: string;
	target_scope: string;
	postcondition: { id: string; summary: string };
};

/**
 * One durable stable-key item checkpoint (R12): the item key and its proven
 * outcome. A `confirmed` checkpoint is immutable; an `unknown` checkpoint blocks
 * the batch (never redispatched, no later item runs). Outcome vocabulary mirrors
 * browser-use-runbook-actions.ts.
 */
export type BrowserUseRunItemCheckpoint = {
	item_key: string;
	outcome: "pending" | "confirmed" | "not-achieved" | "unknown";
};

/** Durable bounded-iteration batch state (R12): ordered keys plus checkpoints. */
export type BrowserUseRunItemBatchState = {
	schema_version: "1";
	item_keys: readonly string[];
	checkpoints: readonly BrowserUseRunItemCheckpoint[];
};

/** Typed durable item-batch transition check (R12). */
export type BrowserUseRunItemBatchTransitionCheck =
	| { ok: true }
	| {
			ok: false;
			code:
				| "item_key_sequence_immutable"
				| "item_checkpoint_immutable"
				| "item_checkpoint_pending_forbidden"
				| "item_batch_blocked";
			message: string;
	  };

/**
 * Maximum bounded summary length accepted on a durable structured result.
 *
 * The capture owner imports this limit so admission and persistence cannot
 * drift on the shared-run contract.
 */
export const BROWSER_USE_RUN_STRUCTURED_RESULT_SUMMARY_MAX_LENGTH = 512;

/** Typed refusal codes that may ride a durable read-result outcome. */
export type BrowserUseRunStructuredResultRefusalCode =
	| "structured_result_schema_mismatch"
	| "structured_result_unredactable"
	| "structured_result_spillover_unavailable"
	| "structured_result_metadata_missing";

/**
 * One admitted or refused read result persisted on the shared run (R21/R24).
 *
 * Raw values never enter this shape. Admitted results carry only bounded
 * summary and digest proof; iterated reads additionally carry their stable
 * `item_key`.
 */
export type BrowserUseRunStructuredResult =
	| {
			ok: true;
			action_id: string;
			item_key?: string;
			outcome: {
				schema_id: string;
				sensitivity: "low" | "high";
				summary: string;
				result_digest: string;
				governed_artifact_ref?: string;
				inline: boolean;
			};
	  }
	| {
			ok: false;
			action_id: string;
			item_key?: string;
			refusal: {
				code: BrowserUseRunStructuredResultRefusalCode;
				message: string;
			};
	  };

// --- The shared run ----------------------------------------------------------

/**
 * The shared Browser Use run (R6, R24-R28). One schema consumed by platform
 * and auth; the platform is its only writer. `revision` is the
 * compare-and-swap token every commit must present; persistence (U2) rejects
 * any write against a stale revision.
 */
export type BrowserUseSharedRun = {
	run_id: string;
	revision: number;
	state: BrowserUseRunState;
	task_intent: BrowserUseTaskIntent;
	environment_profile: BrowserUseEnvironmentProfileIdentity;
	/** Selected lane identity — the same-lane resume gate (R28). */
	adapter_id?: BrowserAdapterId;
	/** Binding to one Verified Handoff Envelope (KTD13). */
	handoff_evidence_id?: string;
	/** Private Agent Browser binding. Public projections must omit it. */
	runbook_target_binding?: BrowserUseRunbookTargetBinding;
	/** Independent progress cursor; repair continuations cannot replace it. */
	runbook_progress?: BrowserUseRunbookProgress;
	/** Immutable execution binding (R38); a resume resolves only its pinned generation. */
	run_execution_binding?: BrowserUseRunExecutionBindingState;
	/** Durable bounded-iteration checkpoints (R12); an unknown item blocks the batch. */
	item_batch?: BrowserUseRunItemBatchState;
	/** Bounded admitted read results and typed capture refusals (R21/R24). */
	structured_results?: readonly BrowserUseRunStructuredResult[];
	/** Opaque versioned auth fragment; auth-owned content (R6). */
	auth_fragment?: BrowserUseAuthFragmentSlot;
	/** Bounded auth attestation reference; required before `ready` (R6). */
	auth_attestation?: BrowserUseAuthAttestationReference;
	/** Declared before mutation; terminal truth classifies against it (R25). */
	postcondition?: BrowserUseRunPostcondition;
	/** Write-ahead truth: a mutation may have reached the site (R26/R37). */
	mutation_dispatched: boolean;
	artifacts: readonly BrowserUseArtifactReference[];
	/** Explicit operator approvals; append-only and bound to one review artifact. */
	approvals?: readonly BrowserUseRunApprovalRecord[];
	/** Exactly one next safe action; required in blocked states (R24). */
	continuation?: BrowserUseRunContinuation;
	/** Audit-only caller metadata (R35); never authority. */
	caller?: BrowserUseCallerMetadata;
};

// --- Validation (R6, R24) ----------------------------------------------------

/** Typed shared-run validation issue codes. */
export type BrowserUseRunIssueCode =
	| "run_blocked_without_continuation"
	| "run_blocked_with_attestation"
	| "run_ready_without_attestation"
	| "run_ready_with_continuation"
	| "run_adapter_unregistered"
	| "runbook_private_state_incomplete"
	| "runbook_target_binding_invalid"
	| "runbook_progress_invalid"
	| "run_execution_binding_invalid"
	| "run_item_batch_invalid"
	| "run_structured_results_invalid"
	| "run_approvals_invalid";

/** One typed validation issue. */
export type BrowserUseRunIssue = {
	code: BrowserUseRunIssueCode;
	message: string;
};

export function isBlockedState(state: BrowserUseRunState): boolean {
	return (BROWSER_USE_BLOCKED_RUN_STATES as readonly BrowserUseRunState[]).includes(
		state,
	);
}

export function isTerminalState(state: BrowserUseRunState): boolean {
	return (BROWSER_USE_TERMINAL_RUN_STATES as readonly BrowserUseRunState[]).includes(
		state,
	);
}

const FULL_DIGEST = /^[0-9a-f]{64}$/;
const ITEM_BATCH_MAX_KEYS = 512;
const STRUCTURED_RESULT_MAX_COUNT = 512;

/**
 * Validate shared-run invariants (R6, R24).
 *
 * - A blocked state (`awaiting-auth`, `awaiting-approval`,
 *   `awaiting-user-presence`, `needs-human`) must carry exactly one
 *   continuation.
 * - `ready` requires a committed bounded auth attestation reference.
 * - A selected adapter id must be a registered live adapter.
 *
 * @param run - Shared run to validate
 * @returns Empty array when the run satisfies every invariant
 */
export function validateSharedRun(run: BrowserUseSharedRun): BrowserUseRunIssue[] {
	const issues: BrowserUseRunIssue[] = [];
	if (isBlockedState(run.state) && run.continuation === undefined) {
		issues.push({
			code: "run_blocked_without_continuation",
			message: `state ${run.state} requires exactly one next safe action.`,
		});
	}
	if (
		isBlockedState(run.state) &&
		run.auth_attestation !== undefined &&
		!(
			run.state === "awaiting-approval" &&
			run.continuation?.next_action_id === "complete-submit-approval"
		)
	) {
		issues.push({
			code: "run_blocked_with_attestation",
			message: `state ${run.state} cannot carry a mutation-authorizing attestation.`,
		});
	}
	if (run.state === "ready" && run.auth_attestation === undefined) {
		issues.push({
			code: "run_ready_without_attestation",
			message:
				"a run cannot become ready without a committed bounded auth attestation.",
		});
	}
	if (run.state === "ready" && run.continuation !== undefined) {
		issues.push({
			code: "run_ready_with_continuation",
			message: "a ready run cannot carry a blocked-state continuation.",
		});
	}
	if (
		run.adapter_id !== undefined &&
		!(BROWSER_USE_LIVE_ADAPTERS as readonly string[]).includes(run.adapter_id)
	) {
		issues.push({
			code: "run_adapter_unregistered",
			message: `adapter ${run.adapter_id} is not a registered browser-use adapter.`,
		});
	}
	const binding = run.runbook_target_binding;
	const progress = run.runbook_progress;
	if (
		(binding === undefined) !== (progress === undefined) ||
		((run.run_execution_binding !== undefined ||
			run.item_batch !== undefined ||
			run.structured_results !== undefined) &&
			(binding === undefined || progress === undefined))
	) {
		issues.push({
			code: "runbook_private_state_incomplete",
			message:
				"runbook_target_binding and runbook_progress must be committed together; execution-binding, item-batch, and structured-result state require both.",
		});
	}
	if (
		binding !== undefined &&
		(binding.schema_version !== "1" ||
			(binding.mode !== "exact" && binding.mode !== "automatic") ||
			typeof binding.binding_id !== "string" ||
			binding.binding_id.length === 0 ||
			run.adapter_id !== "agent-browser" ||
			typeof run.handoff_evidence_id !== "string" ||
			run.handoff_evidence_id.length === 0 ||
			run.task_intent !== "runbook-execution")
	) {
		issues.push({
			code: "runbook_target_binding_invalid",
			message:
				"runbook_target_binding requires schema version 1, an exact or automatic mode, an opaque binding id, and a handoff-bound agent-browser runbook run.",
		});
	}
	if (
		progress !== undefined &&
		(progress.schema_version !== "1" ||
			typeof progress.service_id !== "string" ||
			progress.service_id.length === 0 ||
			typeof progress.flow_id !== "string" ||
			progress.flow_id.length === 0 ||
			typeof progress.runbook_version !== "string" ||
			progress.runbook_version.length === 0 ||
			!Number.isInteger(progress.next_step) ||
			progress.next_step < 0 ||
			!Number.isInteger(progress.total_steps) ||
			progress.total_steps < 0 ||
			progress.next_step > progress.total_steps ||
			run.task_intent !== "runbook-execution")
	) {
		issues.push({
			code: "runbook_progress_invalid",
			message:
				"runbook_progress requires schema version 1, runbook identity, and an integer cursor between zero and total_steps.",
		});
	}
	const execBinding = run.run_execution_binding;
	const execBindingProblem =
		execBinding === undefined
			? undefined
			: runExecutionBindingValidationProblem(execBinding);
	if (execBindingProblem !== undefined) {
		issues.push({
			code: "run_execution_binding_invalid",
			message: execBindingProblem,
		});
	}
	const itemBatch = run.item_batch;
	const itemBatchProblem =
		itemBatch === undefined
			? undefined
			: runItemBatchValidationProblem(itemBatch);
	if (itemBatchProblem !== undefined) {
		issues.push({
			code: "run_item_batch_invalid",
			message: itemBatchProblem,
		});
	}
	const structuredResultsProblem =
		run.structured_results === undefined
			? undefined
			: runStructuredResultsValidationProblem(run.structured_results);
	if (structuredResultsProblem !== undefined) {
		issues.push({
			code: "run_structured_results_invalid",
			message: structuredResultsProblem,
		});
	}
	const approvalsProblem = runApprovalsValidationProblem(
		run.approvals ?? [],
		run.artifacts,
	);
	if (approvalsProblem !== undefined) {
		issues.push({
			code: "run_approvals_invalid",
			message: approvalsProblem,
		});
	}
	return issues;
}

function runApprovalsValidationProblem(
	approvals: readonly BrowserUseRunApprovalRecord[],
	artifacts: readonly BrowserUseArtifactReference[],
): string | undefined {
	const artifactIds = new Set(artifacts.map((artifact) => artifact.artifact_id));
	const approvalKeys = new Set<string>();
	for (const approval of approvals) {
		if (
			approval.continuation_id !== "complete-submit-approval" ||
			typeof approval.artifact_id !== "string" ||
			approval.artifact_id.length === 0 ||
			!Number.isSafeInteger(approval.approved_at_epoch_ms) ||
			approval.approved_at_epoch_ms < 0 ||
			(approval.dispatch_started_at_epoch_ms !== undefined &&
				(!Number.isSafeInteger(approval.dispatch_started_at_epoch_ms) ||
					approval.dispatch_started_at_epoch_ms <
						approval.approved_at_epoch_ms)) ||
			!artifactIds.has(approval.artifact_id)
		) {
			return "each approval must bind the submit continuation, one attached artifact, and a non-negative approval time.";
		}
		const key = `${approval.continuation_id}\0${approval.artifact_id}`;
		if (approvalKeys.has(key)) return "approval records cannot be duplicated.";
		approvalKeys.add(key);
	}
	return undefined;
}

function objectHasExactlyKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
): boolean {
	const keys = Object.keys(value);
	return (
		keys.length === allowed.length &&
		keys.every((key) => allowed.includes(key))
	);
}

/**
 * Return the first durable structured-result validation problem.
 *
 * The closed nested key sets mechanically prevent raw observations from being
 * smuggled beside the bounded proof projection.
 *
 * @param value - Candidate durable structured-result array
 * @returns Undefined when every result is bounded and raw-free
 */
function structuredResultIdentityProblem(
	result: Record<string, unknown>,
	index: number,
): string | undefined {
	const itemKey = result.item_key;
	if (
		typeof result.action_id !== "string" ||
		!SAFE_BATCH_ITEM_KEY.test(result.action_id) ||
		(itemKey !== undefined &&
			(typeof itemKey !== "string" || !SAFE_BATCH_ITEM_KEY.test(itemKey)))
	) {
		return `structured_results.${index} must carry safe action_id and optional item_key values.`;
	}
	return undefined;
}

function admittedStructuredResultProblem(
	result: Record<string, unknown>,
	index: number,
): string | undefined {
	const expectedKeys =
		result.item_key === undefined
			? ["ok", "action_id", "outcome"]
			: ["ok", "action_id", "item_key", "outcome"];
	if (!objectHasExactlyKeys(result, expectedKeys)) {
		return `structured_results.${index} admitted result contains unsupported fields.`;
	}
	const outcome = result.outcome;
	if (typeof outcome !== "object" || outcome === null || Array.isArray(outcome)) {
		return `structured_results.${index}.outcome must be a JSON object.`;
	}
	const proof = outcome as Record<string, unknown>;
	const hasArtifact = proof.governed_artifact_ref !== undefined;
	const expectedOutcomeKeys = hasArtifact
		? [
				"schema_id",
				"sensitivity",
				"summary",
				"result_digest",
				"governed_artifact_ref",
				"inline",
			]
		: ["schema_id", "sensitivity", "summary", "result_digest", "inline"];
	if (
		!objectHasExactlyKeys(proof, expectedOutcomeKeys) ||
		typeof proof.schema_id !== "string" ||
		!FULL_DIGEST.test(proof.schema_id) ||
		(proof.sensitivity !== "low" && proof.sensitivity !== "high") ||
		typeof proof.summary !== "string" ||
		proof.summary.length >
			BROWSER_USE_RUN_STRUCTURED_RESULT_SUMMARY_MAX_LENGTH ||
		typeof proof.result_digest !== "string" ||
		!FULL_DIGEST.test(proof.result_digest) ||
		typeof proof.inline !== "boolean" ||
		(proof.inline && hasArtifact) ||
		// A high-sensitivity result must ALWAYS spill to a governed artifact
		// (R21): it can never ride inline. The capture path enforces this, but
		// this validator is the durable gate — a hand-authored or tampered
		// record claiming high sensitivity with inline: true must fail closed
		// here rather than persist a sensitive payload into shared-run state.
		(proof.sensitivity === "high" && proof.inline) ||
		(!proof.inline &&
			(typeof proof.governed_artifact_ref !== "string" ||
				proof.governed_artifact_ref.length === 0))
	) {
		return `structured_results.${index}.outcome must carry bounded digest, sensitivity, summary, and inline/artifact proof.`;
	}
	return undefined;
}

function refusedStructuredResultProblem(
	result: Record<string, unknown>,
	index: number,
): string | undefined {
	const expectedKeys =
		result.item_key === undefined
			? ["ok", "action_id", "refusal"]
			: ["ok", "action_id", "item_key", "refusal"];
	if (result.ok !== false || !objectHasExactlyKeys(result, expectedKeys)) {
		return `structured_results.${index} refusal contains unsupported fields.`;
	}
	const refusal = result.refusal;
	if (
		typeof refusal !== "object" ||
		refusal === null ||
		Array.isArray(refusal)
	) {
		return `structured_results.${index}.refusal must be a JSON object.`;
	}
	const refusalRecord = refusal as Record<string, unknown>;
	if (
		!objectHasExactlyKeys(refusalRecord, ["code", "message"]) ||
		!(
			[
				"structured_result_schema_mismatch",
				"structured_result_unredactable",
				"structured_result_spillover_unavailable",
				"structured_result_metadata_missing",
			] as readonly unknown[]
		).includes(refusalRecord.code) ||
		typeof refusalRecord.message !== "string" ||
		refusalRecord.message.length === 0 ||
		refusalRecord.message.length >
			BROWSER_USE_RUN_STRUCTURED_RESULT_SUMMARY_MAX_LENGTH
	) {
		return `structured_results.${index}.refusal must carry a typed code and bounded message.`;
	}
	return undefined;
}

function runStructuredResultsValidationProblem(
	value: unknown,
): string | undefined {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > STRUCTURED_RESULT_MAX_COUNT
	) {
		return "structured_results must contain between 1 and 512 outcomes.";
	}
	for (const [index, candidate] of value.entries()) {
		if (
			typeof candidate !== "object" ||
			candidate === null ||
			Array.isArray(candidate)
		) {
			return `structured_results.${index} must be a JSON object.`;
		}
		const result = candidate as Record<string, unknown>;
		const identityProblem = structuredResultIdentityProblem(result, index);
		if (identityProblem !== undefined) return identityProblem;
		const resultProblem =
			result.ok === true
				? admittedStructuredResultProblem(result, index)
				: refusedStructuredResultProblem(result, index);
		if (resultProblem !== undefined) return resultProblem;
	}
	return undefined;
}

/**
 * Return the first execution-binding validation problem for untrusted input.
 *
 * @param value - Candidate durable execution binding
 * @returns Undefined when every execution-binding invariant holds
 */
export function runExecutionBindingValidationProblem(
	value: unknown,
): string | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return "run_execution_binding must be a JSON object.";
	}
	const binding = value as Record<string, unknown>;
	if (binding.schema_version !== "1") {
		return "run_execution_binding.schema_version must be 1.";
	}
	for (const field of [
		"generation_id",
		"service_id",
		"flow_id",
		"runbook_version",
		"target_scope",
	] as const) {
		if (typeof binding[field] !== "string" || binding[field].length === 0) {
			return `run_execution_binding.${field} must be a non-empty string.`;
		}
	}
	if (
		!Number.isInteger(binding.activation_epoch) ||
		(binding.activation_epoch as number) < 1
	) {
		return "run_execution_binding.activation_epoch must be an integer >= 1.";
	}
	for (const digestField of [
		"runbook_digest",
		"action_registry_digest",
		"item_key_digest",
	] as const) {
		if (
			typeof binding[digestField] !== "string" ||
			!FULL_DIGEST.test(binding[digestField] as string)
		) {
			return `run_execution_binding.${digestField} must be a 64-hex digest.`;
		}
	}
	const hasDigest = binding.normalized_input_digest !== undefined;
	const hasGoverned = binding.governed_input_artifact_ref !== undefined;
	if (hasDigest === hasGoverned) {
		return "run_execution_binding must carry exactly one of normalized_input_digest or governed_input_artifact_ref.";
	}
	if (
		hasDigest &&
		(typeof binding.normalized_input_digest !== "string" ||
			!FULL_DIGEST.test(binding.normalized_input_digest))
	) {
		return "run_execution_binding.normalized_input_digest must be a 64-hex digest.";
	}
	if (
		hasGoverned &&
		(typeof binding.governed_input_artifact_ref !== "string" ||
			binding.governed_input_artifact_ref.length === 0)
	) {
		return "run_execution_binding.governed_input_artifact_ref must be a non-empty string.";
	}
	const postcondition = binding.postcondition;
	if (
		typeof postcondition !== "object" ||
		postcondition === null ||
		Array.isArray(postcondition) ||
		typeof (postcondition as Record<string, unknown>).id !== "string" ||
		(postcondition as Record<string, unknown>).id === "" ||
		typeof (postcondition as Record<string, unknown>).summary !== "string" ||
		(postcondition as Record<string, unknown>).summary === ""
	) {
		return "run_execution_binding.postcondition must carry non-empty id and summary strings.";
	}
	return undefined;
}

/**
 * Return the first item-batch validation problem for untrusted input.
 *
 * @param value - Candidate durable item-batch state
 * @returns Undefined when every bounded batch invariant holds
 */
export function runItemBatchValidationProblem(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return "item_batch must be a JSON object.";
	}
	const batch = value as Record<string, unknown>;
	if (
		batch.schema_version !== "1" ||
		!Array.isArray(batch.item_keys) ||
		batch.item_keys.length === 0 ||
		batch.item_keys.length > ITEM_BATCH_MAX_KEYS
	) {
		return "item_batch requires schema version 1 and between 1 and 512 stable item keys.";
	}
	const keys = new Set<string>();
	for (const key of batch.item_keys) {
		if (
			typeof key !== "string" ||
			!SAFE_BATCH_ITEM_KEY.test(key) ||
			keys.has(key)
		) {
			return "item_batch.item_keys must contain unique safe stable keys.";
		}
		keys.add(key);
	}
	if (!Array.isArray(batch.checkpoints)) {
		return "item_batch.checkpoints must be an array.";
	}
	const outcomes = new Map<
		string,
		BrowserUseRunItemCheckpoint["outcome"]
	>();
	for (const candidate of batch.checkpoints) {
		const checkpoint =
			typeof candidate === "object" &&
			candidate !== null &&
			!Array.isArray(candidate)
				? (candidate as Record<string, unknown>)
				: undefined;
		if (
			checkpoint === undefined ||
			typeof checkpoint.item_key !== "string" ||
			!keys.has(checkpoint.item_key) ||
			outcomes.has(checkpoint.item_key) ||
			!["pending", "confirmed", "not-achieved", "unknown"].includes(
				checkpoint.outcome as string,
			)
		) {
			return "item_batch.checkpoints must reference batch keys once with valid outcomes.";
		}
		outcomes.set(
			checkpoint.item_key,
			checkpoint.outcome as BrowserUseRunItemCheckpoint["outcome"],
		);
	}
	let blocked = false;
	for (const key of batch.item_keys) {
		const outcome = outcomes.get(key) ?? "pending";
		if (blocked && outcome !== "pending") {
			return "item_batch cannot advance a checkpoint after the first unconfirmed item.";
		}
		if (outcome !== "confirmed") blocked = true;
	}
	return undefined;
}

/**
 * Check one durable item-batch mutation against the R12 checkpoint reducer.
 * The generic CAS may initialize a pending batch, then record only the first
 * item not already confirmed. Recorded truth cannot regress to `pending`.
 *
 * @param previous - Durable state before the mutation
 * @param next - Candidate durable state
 * @returns Ok, or one typed repairable refusal
 */
export function checkRunItemBatchTransition(
	previous: BrowserUseRunItemBatchState | undefined,
	next: BrowserUseRunItemBatchState | undefined,
): BrowserUseRunItemBatchTransitionCheck {
	if (previous === undefined && next === undefined) return { ok: true };
	if (previous !== undefined && next === undefined) {
		return {
			ok: false,
			code: "item_key_sequence_immutable",
			message:
				"item_batch cannot be removed after its ordered item-key sequence is committed; start a new run for a different batch.",
		};
	}
	if (next === undefined) return { ok: true };
	if (
		previous !== undefined &&
		(previous.item_keys.length !== next.item_keys.length ||
			previous.item_keys.some((key, index) => key !== next.item_keys[index]))
	) {
		return {
			ok: false,
			code: "item_key_sequence_immutable",
			message:
				"item_batch.item_keys cannot be reordered or replaced after creation; start a new run with the required ordered keys.",
		};
	}

	const previousOutcomes = new Map<
		string,
		BrowserUseRunItemCheckpoint["outcome"]
	>();
	for (const checkpoint of previous?.checkpoints ?? []) {
		previousOutcomes.set(checkpoint.item_key, checkpoint.outcome);
	}
	const nextOutcomes = new Map<
		string,
		BrowserUseRunItemCheckpoint["outcome"]
	>();
	for (const checkpoint of next.checkpoints) {
		nextOutcomes.set(checkpoint.item_key, checkpoint.outcome);
	}

	for (const [targetIndex, key] of next.item_keys.entries()) {
		const before = previousOutcomes.get(key) ?? "pending";
		const after = nextOutcomes.get(key) ?? "pending";
		if (before === "confirmed" && after !== "confirmed") {
			return {
				ok: false,
				code: "item_checkpoint_immutable",
				message: `the confirmed checkpoint for item ${key} is immutable; keep it confirmed or start a new run.`,
			};
		}
		if (before !== "pending" && after === "pending") {
			return {
				ok: false,
				code: "item_checkpoint_pending_forbidden",
				message: `the recorded checkpoint for item ${key} cannot regress to pending; reconcile it to a freshly proven outcome.`,
			};
		}
		if (before === after || after === "pending") continue;
		for (let index = 0; index < targetIndex; index += 1) {
			const priorKey = next.item_keys[index] as string;
			const priorOutcome = previousOutcomes.get(priorKey) ?? "pending";
			if (priorOutcome !== "confirmed") {
				return {
					ok: false,
					code: "item_batch_blocked",
					message: `item ${key} cannot advance while earlier item ${priorKey} is ${priorOutcome}; confirm or reconcile ${priorKey} first, then retry.`,
				};
			}
		}
	}
	return { ok: true };
}

// --- Auth integration Port (R6, KTD10) ---------------------------------------

/**
 * Summary the auth transaction returns alongside its fragment. The platform
 * maps it onto run state; auth never names a platform-internal state it is
 * not allowed to produce (`running`, `confirmed`, `not-achieved`, `unknown`
 * are task-execution truth, not auth outcomes).
 */
export type BrowserUseAuthCommitSummary =
	| {
			state: "ready";
			attestation: BrowserUseAuthAttestationReference;
			continuation?: never;
	  }
	| {
			state: Extract<
				BrowserUseRunState,
				| "awaiting-auth"
				| "awaiting-approval"
				| "awaiting-user-presence"
				| "needs-human"
			>;
			attestation?: never;
			continuation: BrowserUseRunContinuation;
	  };

/**
 * Runtime candidate accepted by the pure reducer before it proves the stricter
 * {@link BrowserUseAuthCommitSummary} invariants. Persistence adapters may
 * decode untrusted or stale stored values, so compile-time shape is not the
 * admission check.
 */
export type BrowserUseAuthCommitCandidate = {
	state: Extract<
		BrowserUseRunState,
		| "awaiting-auth"
		| "awaiting-approval"
		| "awaiting-user-presence"
		| "ready"
		| "needs-human"
	>;
	attestation?: BrowserUseAuthAttestationReference;
	continuation?: BrowserUseRunContinuation;
};

/** Typed auth-commit rejection codes. */
export type BrowserUseAuthCommitRejectionCode =
	| "run_revision_stale"
	| "run_ready_without_attestation"
	| "run_ready_with_continuation"
	| "run_blocked_without_continuation"
	| "run_blocked_with_attestation"
	| "auth_fragment_unsafe"
	// A ready summary whose bounded attestation the auth-owned verifier could
	// not re-prove against a durable record (U3a: no durable attestation, no
	// ready run).
	| "run_ready_attestation_unverified"
	| "run_terminal";

/** Typed auth-commit rejection. */
export type BrowserUseAuthCommitRejection = {
	code: BrowserUseAuthCommitRejectionCode;
	message: string;
};

/** Auth-commit result: the next run value, or one typed rejection. */
export type BrowserUseAuthCommitResult =
	| { ok: true; run: BrowserUseSharedRun }
	| { ok: false; rejection: BrowserUseAuthCommitRejection };

/**
 * The one integration Port through which an auth outcome enters the shared
 * run (R6). Platform code implements it over the run store (U2); auth code
 * calls it and never writes run state directly. `expected_revision` is the
 * compare-and-swap guard: a commit against any other revision is stale.
 */
export type BrowserUseRunIntegrationPort = {
	commitAuthOutcome(input: {
		run_id: string;
		expected_revision: number;
		fragment: BrowserUseAuthFragmentSlot;
		summary: BrowserUseAuthCommitSummary;
	}): Promise<BrowserUseAuthCommitResult>;
};

/**
 * Pure commit semantics of the integration Port (R6): the reducer platform
 * U2 wraps with persistence. Atomically applies fragment plus summary against
 * the expected revision; every rejection is typed and leaves the input run
 * untouched.
 *
 * @param run - Current shared run value
 * @param input - Expected revision, opaque fragment, and auth summary
 * @param authContract - Auth-owned runtime fragment admission
 * @returns The next run value at `revision + 1`, or one typed rejection
 */
export function applyAuthCommit(
	run: BrowserUseSharedRun,
	input: {
		expected_revision: number;
		fragment: BrowserUseAuthFragmentSlot;
		summary: BrowserUseAuthCommitCandidate;
	},
	authContract: Pick<BrowserUseAuthContractPort, "validateSecretFreeFragment">,
): BrowserUseAuthCommitResult {
	if (input.expected_revision !== run.revision) {
		return {
			ok: false,
			rejection: {
				code: "run_revision_stale",
				message: `expected revision ${input.expected_revision} but the run is at ${run.revision}.`,
			},
		};
	}
	if (isTerminalState(run.state)) {
		return {
			ok: false,
			rejection: {
				code: "run_terminal",
				message: `run is terminal (${run.state}); auth outcomes cannot re-enter it.`,
			},
		};
	}
	const { summary } = input;
	if (summary.state === "ready" && summary.attestation === undefined) {
		return {
			ok: false,
			rejection: {
				code: "run_ready_without_attestation",
				message:
					"a run cannot become ready without a committed bounded auth attestation.",
			},
		};
	}
	if (summary.state === "ready" && summary.continuation !== undefined) {
		return {
			ok: false,
			rejection: {
				code: "run_ready_with_continuation",
				message: "a ready auth outcome cannot carry a blocked continuation.",
			},
		};
	}
	if (summary.state !== "ready" && summary.continuation === undefined) {
		return {
			ok: false,
			rejection: {
				code: "run_blocked_without_continuation",
				message: `auth state ${summary.state} requires exactly one next safe action.`,
			},
		};
	}
	if (summary.state !== "ready" && summary.attestation !== undefined) {
		return {
			ok: false,
			rejection: {
				code: "run_blocked_with_attestation",
				message:
					"a blocked auth outcome cannot carry a mutation-authorizing attestation.",
			},
		};
	}
	let fragmentIsSecretFree = false;
	try {
		fragmentIsSecretFree = authContract.validateSecretFreeFragment(input.fragment);
	} catch {
		fragmentIsSecretFree = false;
	}
	if (!fragmentIsSecretFree) {
		return {
			ok: false,
			rejection: {
				code: "auth_fragment_unsafe",
				message:
					"the auth-owned runtime validator rejected the fragment; it was not persisted.",
			},
		};
	}
	return {
		ok: true,
		run: {
			...run,
			revision: run.revision + 1,
			state: summary.state,
			auth_fragment: input.fragment,
			auth_attestation: summary.attestation,
			continuation: summary.continuation,
		},
	};
}

// --- Attestation revalidation (R6/R30) ---------------------------------------

/** Typed attestation revalidation outcome. */
export type BrowserUseAttestationRevalidation =
	| { valid: true }
	| {
			valid: false;
			code:
				| "attestation_missing"
				| "attestation_state_invalid"
				| "attestation_expired"
				| "attestation_lane_changed"
				| "attestation_handoff_changed"
				| "attestation_binding_invalid";
			message: string;
	  };

/**
 * Revalidate the bounded auth attestation immediately before task mutation
 * (R6/R30). Freshness expiry, an adapter (lane) change, or a handoff change
 * invalidates it; a stale auth outcome never authorizes mutation.
 *
 * Async because the auth-owned verifier consults the durable attestation
 * store (U3a).
 *
 * @param run - Shared run holding the attestation reference
 * @param observed - Current instant and the identities observed right now
 * @param authContract - Auth-owned full-binding and integrity verifier
 * @returns Valid, or one typed invalidation
 */
export async function revalidateAuthAttestation(
	run: BrowserUseSharedRun,
	observed: {
		at_epoch_ms: number;
		adapter_id: BrowserAdapterId | undefined;
		handoff_evidence_id: string | undefined;
	},
	authContract: Pick<BrowserUseAuthContractPort, "verifyAttestation">,
): Promise<BrowserUseAttestationRevalidation> {
	const reference = run.auth_attestation;
	if (reference === undefined) {
		return {
			valid: false,
			code: "attestation_missing",
			message: "no bounded auth attestation is committed on this run.",
		};
	}
	if (run.state !== "ready" && run.state !== "running") {
		return {
			valid: false,
			code: "attestation_state_invalid",
			message: `state ${run.state} cannot authorize task mutation.`,
		};
	}
	if (observed.at_epoch_ms > reference.fresh_until_epoch_ms) {
		return {
			valid: false,
			code: "attestation_expired",
			message: "the bounded auth attestation freshness window has passed.",
		};
	}
	if (run.adapter_id === undefined || observed.adapter_id !== run.adapter_id) {
		return {
			valid: false,
			code: "attestation_lane_changed",
			message:
				"the selected adapter lane is missing or changed after attestation.",
		};
	}
	if (
		run.handoff_evidence_id === undefined ||
		observed.handoff_evidence_id !== run.handoff_evidence_id
	) {
		return {
			valid: false,
			code: "attestation_handoff_changed",
			message: "the bound Verified Handoff Envelope changed after attestation.",
		};
	}
	let bindingValid = false;
	try {
		bindingValid = await authContract.verifyAttestation({
			reference,
			run_id: run.run_id,
			environment_profile: run.environment_profile,
			adapter_id: run.adapter_id,
			handoff_evidence_id: run.handoff_evidence_id,
			at_epoch_ms: observed.at_epoch_ms,
		});
	} catch {
		bindingValid = false;
	}
	if (!bindingValid) {
		return {
			valid: false,
			code: "attestation_binding_invalid",
			message:
				"the auth-owned verifier rejected the attestation binding or integrity.",
		};
	}
	return { valid: true };
}

// --- Same-lane resume (R28) ---------------------------------------------------

/** Typed resume outcome. */
export type BrowserUseResumeCheck =
	| { ok: true }
	| {
			ok: false;
			code:
				| "run_lane_unbound"
				| "run_lane_mismatch"
				| "run_profile_mismatch";
			message: string;
	  };

/**
 * Same-lane resume gate (R28): a run resumes only on its original adapter
 * lane and environment/profile identity. A mismatch is a typed refusal —
 * adapters never switch across a pause, and a profile change is an identity
 * change.
 *
 * @param run - Shared run being resumed
 * @param observed - Lane and environment/profile identity observed now
 * @returns Ok, or one typed mismatch refusal
 */
export function checkSameLaneResume(
	run: BrowserUseSharedRun,
	observed: {
		adapter_id: BrowserAdapterId | undefined;
		environment_profile: BrowserUseEnvironmentProfileIdentity;
	},
): BrowserUseResumeCheck {
	if (run.adapter_id === undefined) {
		return {
			ok: false,
			code: "run_lane_unbound",
			message: "run has no bound adapter lane; resume refused.",
		};
	}
	if (observed.adapter_id !== run.adapter_id) {
		return {
			ok: false,
			code: "run_lane_mismatch",
			message: `run is bound to adapter ${run.adapter_id}; resume observed ${observed.adapter_id ?? "no adapter"}.`,
		};
	}
	if (
		observed.environment_profile.environment !==
			run.environment_profile.environment ||
		observed.environment_profile.profile !== run.environment_profile.profile
	) {
		return {
			ok: false,
			code: "run_profile_mismatch",
			message:
				"run is bound to a different environment/profile identity; resume refused.",
		};
	}
	return { ok: true };
}

// --- Cancellation truth (R26, R37) -------------------------------------------

/**
 * Cancellation report: the last proven external-effect classification.
 * `rolled_back` is the literal `false` — cancellation NEVER implies rollback
 * after a mutation may have reached the site (R37).
 */
export type BrowserUseCancellationReport = {
	external_effect: "none";
	rolled_back: false;
};

/** Cancellation admission: pre-dispatch truth or a fail-closed write refusal. */
export type BrowserUseCancellationClassification =
	| { ok: true; report: BrowserUseCancellationReport }
	| {
			ok: false;
			code: "run_cancel_mutation_dispatched";
			message: string;
	  };

/**
 * Classify cancellation admission truthfully (R26/R37). Once a mutation was
 * dispatched, cancellation refuses because terminalising the run would hide
 * a possible in-flight or applied external write.
 *
 * @param run - Shared run being cancelled
 * @returns Pre-dispatch external-effect truth, or the typed dispatch refusal
 */
export function classifyCancellation(
	run: BrowserUseSharedRun,
): BrowserUseCancellationClassification {
	if (run.mutation_dispatched) {
		return {
			ok: false,
			code: "run_cancel_mutation_dispatched",
			message:
				"the run dispatched a mutation; inspect its external effect instead of cancelling it.",
		};
	}
	return {
		ok: true,
		report: { external_effect: "none", rolled_back: false },
	};
}
