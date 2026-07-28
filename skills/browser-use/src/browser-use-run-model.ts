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
	/** Opaque versioned auth fragment; auth-owned content (R6). */
	auth_fragment?: BrowserUseAuthFragmentSlot;
	/** Bounded auth attestation reference; required before `ready` (R6). */
	auth_attestation?: BrowserUseAuthAttestationReference;
	/** Declared before mutation; terminal truth classifies against it (R25). */
	postcondition?: BrowserUseRunPostcondition;
	/** Write-ahead truth: a mutation may have reached the site (R26/R37). */
	mutation_dispatched: boolean;
	artifacts: readonly BrowserUseArtifactReference[];
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
	| "run_item_batch_invalid";

/** One typed validation issue. */
export type BrowserUseRunIssue = {
	code: BrowserUseRunIssueCode;
	message: string;
};

function isBlockedState(state: BrowserUseRunState): boolean {
	return (BROWSER_USE_BLOCKED_RUN_STATES as readonly BrowserUseRunState[]).includes(
		state,
	);
}

const FULL_DIGEST = /^[0-9a-f]{64}$/;
const SAFE_BATCH_ITEM_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const ITEM_BATCH_MAX_KEYS = 512;

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
	if (isBlockedState(run.state) && run.auth_attestation !== undefined) {
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
	if ((binding === undefined) !== (progress === undefined)) {
		issues.push({
			code: "runbook_private_state_incomplete",
			message:
				"runbook_target_binding and runbook_progress must be committed together or both absent.",
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
	if (execBinding !== undefined && !runExecutionBindingValid(execBinding)) {
		issues.push({
			code: "run_execution_binding_invalid",
			message:
				"run_execution_binding requires schema version 1, pinned generation/flow/version identity, 64-hex digests, an item-key digest, a target scope, a postcondition, and exactly one of a normalized-input digest or a governed-input artifact reference.",
		});
	}
	const itemBatch = run.item_batch;
	if (itemBatch !== undefined && !itemBatchStateValid(itemBatch)) {
		issues.push({
			code: "run_item_batch_invalid",
			message:
				"item_batch requires schema version 1, a bounded stable-key sequence, and checkpoints referencing only keys in that sequence.",
		});
	}
	return issues;
}

function runExecutionBindingValid(
	binding: BrowserUseRunExecutionBindingState,
): boolean {
	const hasDigest = binding.normalized_input_digest !== undefined;
	const hasGoverned = binding.governed_input_artifact_ref !== undefined;
	return (
		binding.schema_version === "1" &&
		typeof binding.generation_id === "string" &&
		binding.generation_id.length > 0 &&
		Number.isInteger(binding.activation_epoch) &&
		binding.activation_epoch >= 1 &&
		typeof binding.service_id === "string" &&
		binding.service_id.length > 0 &&
		typeof binding.flow_id === "string" &&
		binding.flow_id.length > 0 &&
		typeof binding.runbook_version === "string" &&
		binding.runbook_version.length > 0 &&
		FULL_DIGEST.test(binding.runbook_digest) &&
		FULL_DIGEST.test(binding.action_registry_digest) &&
		FULL_DIGEST.test(binding.item_key_digest) &&
		typeof binding.target_scope === "string" &&
		binding.target_scope.length > 0 &&
		typeof binding.postcondition?.id === "string" &&
		binding.postcondition.id.length > 0 &&
		typeof binding.postcondition.summary === "string" &&
		// Exactly one input-custody form (R41).
		hasDigest !== hasGoverned &&
		(!hasDigest || FULL_DIGEST.test(binding.normalized_input_digest as string)) &&
		(!hasGoverned ||
			(typeof binding.governed_input_artifact_ref === "string" &&
				(binding.governed_input_artifact_ref as string).length > 0))
	);
}

function itemBatchStateValid(batch: BrowserUseRunItemBatchState): boolean {
	if (
		batch.schema_version !== "1" ||
		!Array.isArray(batch.item_keys) ||
		batch.item_keys.length === 0 ||
		batch.item_keys.length > ITEM_BATCH_MAX_KEYS
	) {
		return false;
	}
	const keys = new Set<string>();
	for (const key of batch.item_keys) {
		if (!SAFE_BATCH_ITEM_KEY.test(key) || keys.has(key)) return false;
		keys.add(key);
	}
	for (const checkpoint of batch.checkpoints) {
		if (
			!keys.has(checkpoint.item_key) ||
			!["pending", "confirmed", "not-achieved", "unknown"].includes(
				checkpoint.outcome,
			)
		) {
			return false;
		}
	}
	return true;
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
	if (
		(BROWSER_USE_TERMINAL_RUN_STATES as readonly BrowserUseRunState[]).includes(
			run.state,
		)
	) {
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
	external_effect: "none" | "unknown";
	rolled_back: false;
};

/**
 * Classify a cancellation truthfully (R26/R37). Once a mutation was
 * dispatched and the run holds no confirmed terminal truth, the external
 * effect is `unknown` — same-lane inspection is the only continuation, never
 * retry, adapter switch, or a rollback claim.
 *
 * @param run - Shared run being cancelled
 * @returns External-effect truth with rollback structurally denied
 */
export function classifyCancellation(
	run: BrowserUseSharedRun,
): BrowserUseCancellationReport {
	const effectKnownNone = !run.mutation_dispatched;
	return {
		external_effect: effectKnownNone ? "none" : "unknown",
		rolled_back: false,
	};
}
