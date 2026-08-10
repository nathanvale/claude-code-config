import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import {
	type AdapterReleaseResult,
	findAdapterDefinition,
} from "@side-quest/browser-connect/adapters";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import { TRANSPORT_STDIN_MAX_BYTES } from "@side-quest/mcporter-transport";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import type { BrowserUseAuthMethodStep } from "./browser-use-auth-model";
import type {
	BrowserUseAccessibilitySnapshot,
	BrowserUseCdpObserver,
} from "./browser-use-cdp-observer";
import {
	type BrowserUseDeliveryHook,
	type BrowserUseDeliveryResumeDirective,
	type BrowserUseTargetReproof,
	type BrowserUseVerifiedTarget,
	deliverConfidentialFields,
} from "./browser-use-confidential-field-delivery";
import type {
	BrowserUseOpCredentialField,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";
import type { BrowserUseDeliveredFieldShape } from "./browser-use-secret-scan";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";
import { deriveSessionName } from "./browser-use-adapter-session-lease";
import {
	projectAgentBrowserSnapshotRefs,
	resolveUniqueSemanticRef,
	semanticClickInputIsValid,
} from "./browser-use-agent-browser-semantics";
import {
	agentBrowserAllowedOriginSet,
	agentBrowserHasExactOrigin,
	agentBrowserOriginIsAllowed,
	neutralTargetIsAllowed,
	reproveAgentBrowserOrigin,
	resolveAgentBrowserTarget,
	selectAgentBrowserTarget,
	verifyAgentBrowserPostcondition,
} from "./browser-use-agent-browser-target";
import {
	SAFE_BATCH_ITEM_KEY,
	SAFE_RUN_ID,
	SAFE_TAB_ID,
} from "./browser-use-identifiers";

const HANDOFF_CONTRACT_ID = "browser-connect.verified-handoff";
const HANDOFF_SCHEMA_VERSION = "2";

// Each delivered credential field maps onto exactly one sensitive-interval
// method step (R15): a successful field delivery is the lane's evidence that
// the auth transaction's FSM may record that method-step-complete event.
const METHOD_STEP_BY_FIELD: Readonly<
	Record<BrowserUseOpCredentialField, BrowserUseAuthMethodStep>
> = {
	username: "fill-username",
	password: "fill-password",
	"otp-current": "fill-otp",
};
const COMMAND_TIMEOUT_MS = 30_000;
const SAFE_REF = /^@e[1-9][0-9]*$/;

/**
 * Verified Browser Connect payload pinned to the schema this consumer knows.
 */
export type AgentBrowserVerifiedHandoff = BrowserConnectHandoffPayload & {
	contract_id: string;
	schema_version: string;
};

/**
 * Structural evidence checked after an Agent Browser mutation.
 */
export type AgentBrowserPostcondition =
	| { kind: "url-equals"; url: string }
	| { kind: "url-starts-with"; url: string }
	| { kind: "value-equals"; selector: string; value: string }
	| { kind: "element-visible"; selector: string };

/**
 * One bounded native Agent Browser action.
 *
 * Refs are legal only immediately after this task's own snapshot. Confidential
 * field delivery remains owned by the Browser Authentication Transaction.
 */
export type AgentBrowserTaskStep =
	| { kind: "snapshot"; interactive: boolean }
	| {
			kind: "open";
			url: string;
			postcondition: Extract<
				AgentBrowserPostcondition,
				{ kind: "url-equals" | "url-starts-with" }
			>;
	  }
	| {
			kind: "click";
			ref: string;
			postcondition: AgentBrowserPostcondition;
	  }
	| {
			kind: "click-semantic";
			role: string;
			name: string;
			postcondition: Extract<
				AgentBrowserPostcondition,
				{ kind: "element-visible" }
			>;
	  }
	| {
			kind: "fill";
			ref: string;
			/** Binding slug resolved by confidential delivery at fill time. */
			item_binding?: string;
			value: string;
			sensitivity: "ordinary" | "confidential";
			/**
			 * Optional runtime-resolved semantic target (runbook v2, R11). When
			 * present, the executor resolves the fill ref from a FRESH snapshot by
			 * role + name and dispatches only when EXACTLY ONE current ref matches,
			 * overriding the durable `ref` placeholder. Absent for adapter-native
			 * @eN fills that already hold a snapshot ref.
			 */
			target?: { role: string; name: string };
			postcondition: AgentBrowserPostcondition;
	  }
	| {
			kind: "evaluate";
			action_id: string;
			/** Stable identity for one expanded iterate item (R12/R21). */
			item_key?: string;
			script: string;
			script_sha256: string;
			review_status: "approved" | "pending" | "rejected";
			allowed_origin: string;
			effect: "read" | "mutation";
			inputs: Readonly<Record<string, unknown>>;
			postcondition?: AgentBrowserPostcondition;
	  };

/**
 * The OPTIONAL auth-delivery context the auth wiring supplies for a task whose
 * confidential-fill steps must route through the Confidential Field Delivery
 * choreography instead of refusing (auth plan U5, R13-R16; release R13-R16).
 *
 * The context is only ever handed in DURING the auth transaction's
 * sensitive-interval (`in_sensitive_interval` — post lease-granted, pre
 * submission-dispatched); `field_by_binding_slug` names, per runbook binding,
 * credential field the choreography must deliver into that field. Every effect
 * is an injected port owned by the auth wiring: the disposable delivery helper
 * (`deliver`), the fresh target re-proof (`reproveTarget`), the verified target
 * proof bundle (`target`), the approved item binding (`binding`), and the
 * opaque-handle TokenRetrievalPort (`tokenRetrieval`). No secret material ever
 * flows through this context — the executor never observes a value.
 *
 * WITHOUT this context, a confidential fill is refused exactly as before
 * (`agent_browser_confidential_input_requires_auth_transaction`); the default
 * must not weaken. When no `tokenRetrieval` port exists at all (native
 * capability absent), the auth wiring supplies no context, so the typed refusal
 * stands — native-capability-absent behavior is unchanged.
 */
export type AgentBrowserAuthDeliveryContext = {
	/** True only while the auth transaction sits in its sensitive-interval. */
	in_sensitive_interval: boolean;
	binding: BrowserUseItemBinding;
	target: BrowserUseVerifiedTarget;
	tokenRetrieval: BrowserUseTokenRetrievalPort;
	deliver: BrowserUseDeliveryHook;
	reproveTarget: BrowserUseTargetReproof;
	/** Runbook binding slug -> credential field delivered for that step. */
	field_by_binding_slug: Readonly<
		Record<string, BrowserUseOpCredentialField>
	>;
};

/**
 * Complete input for one same-session Agent Browser task. `auth_delivery` is
 * optional: present only when the Browser Authentication Transaction has routed
 * a sensitive-interval delivery through this lane.
 */
export type AgentBrowserTask = {
	handoff: AgentBrowserVerifiedHandoff;
	run_id: string;
	target_tab_id: string;
	/**
	 * Exact process-local URL observed when the target was resolved.
	 *
	 * When supplied, target selection must reprove this URL before execution.
	 */
	expected_target_url?: string;
	allowed_origins: readonly string[];
	steps: readonly AgentBrowserTaskStep[];
	/** Admit exact about:blank only when the first remaining step is `open`. */
	allow_neutral_target?: boolean;
	auth_delivery?: AgentBrowserAuthDeliveryContext;
};

/**
 * Opaque, deterministic target binding safe for durable caller state.
 */
export type AgentBrowserTargetBinding = {
	schema_version: "1";
	target_candidate_id: string;
};

/**
 * One pre-execution target request.
 *
 * Exact adapter ids are input-only overrides. Automatic resumes use only the
 * opaque candidate binding produced by a prior successful resolution.
 */
export type AgentBrowserTargetRequest =
	| {
			kind: "exact";
			tab_id: string;
			target_envelope_id: string;
	  }
	| {
			kind: "auto";
			target_envelope_id: string;
			bound_target_candidate_id?: string;
	  };

/**
 * Input for target preflight through the verified Agent Browser handoff.
 */
export type AgentBrowserTargetResolutionInput = {
	handoff: AgentBrowserVerifiedHandoff;
	run_id: string;
	allowed_origins: readonly string[];
	steps: readonly AgentBrowserTaskStep[];
	target: AgentBrowserTargetRequest;
};

/**
 * Target preflight truth. Raw tab identity is transient execution input only.
 */
export type AgentBrowserTargetResolutionResult =
	| {
			ok: true;
			target_tab_id: string;
			/** Process-local resolution evidence. Never persist this URL. */
			target_url: string;
			binding: AgentBrowserTargetBinding;
	  }
	| Extract<AgentBrowserExecutionResult, { ok: false }>;

/**
 * Structured command seam shared with the Browser Use process runtime.
 */
export type AgentBrowserExecutionRuntime = {
	runCommand(input: McporterCommandInput): Promise<McporterCommandResult>;
	/**
	 * Persist write-ahead mutation truth before a native mutation command.
	 *
	 * The executor refuses when this seam is absent or cannot record the marker.
	 */
	beforeMutationDispatch?(
		input: Readonly<{ run_id: string }>,
	): Promise<{ ok: true } | { ok: false }>;
	/**
	 * Persist one iterated mutation's structural outcome before a later item.
	 *
	 * Structurally false postconditions collapse to `unknown` for durable retry
	 * safety because the mutation may already have changed browser state.
	 *
	 * A confirmed mutation whose checkpoint cannot be recorded becomes unknown;
	 * the executor stops so no later item can pass uncommitted truth.
	 */
	afterItemCheckpoint?(
		input: Readonly<{
			run_id: string;
			item_key: string;
			outcome: "confirmed" | "unknown";
		}>,
	): Promise<{ ok: true } | { ok: false }>;
};

async function checkpointItem(
	runtime: AgentBrowserExecutionRuntime,
	input: Readonly<{
		run_id: string;
		item_key: string;
		outcome: "confirmed" | "unknown";
	}>,
): Promise<boolean> {
	try {
		return (await runtime.afterItemCheckpoint?.(input))?.ok === true;
	} catch {
		return false;
	}
}

/**
 * Stable native lane refusal codes.
 */
export type AgentBrowserExecutionFailureCode =
	| "agent_browser_handoff_invalid"
	| "agent_browser_task_invalid"
	| "agent_browser_connection_unstable"
	| "agent_browser_target_unavailable"
	| "agent_browser_target_ambiguous"
	| "agent_browser_target_moved"
	| "agent_browser_target_origin_refused"
	| "agent_browser_command_failed"
	| "agent_browser_current_snapshot_required"
	| "agent_browser_ref_invalid"
	| "agent_browser_confidential_input_requires_auth_transaction"
	| "agent_browser_confidential_delivery_blocked"
	| "agent_browser_action_integrity_refused"
	| "agent_browser_action_target_refused"
	| "agent_browser_action_read_not_achieved"
	| "agent_browser_mutation_marker_unavailable"
	| "agent_browser_item_checkpoint_unavailable"
	| "agent_browser_mutation_effect_unknown"
	| "agent_browser_postcondition_not_achieved";

/**
 * Inspectable evidence of what a bounded reconnect actually observed (release
 * theme "no flaky CDP connections"). It is diagnostic only — never a retry
 * authority — and carries the adapter's own connection-class signal verbatim so
 * a caller can distinguish a genuinely-down browser from transient flakiness.
 */
export type AgentBrowserConnectionDiagnostic = {
	attempts: number;
	max_attempts: number;
	last_signal: string;
	next_repair_action: string;
};

/**
 * Structural evidence a confidential-field delivery produced inside this task
 * (auth plan U5). It is secret-free by construction: the delivered field shapes
 * (kind + byte length) feed the sentinel owner, the FSM method-step-complete
 * events name the ordered steps the auth transaction must record, and the
 * resume directive names the discard-stale-refs / fresh-identity-basis demand
 * the lane obeyed. Never a value on any field.
 */
export type AgentBrowserDeliveryEvidence = {
	delivered_shapes: readonly BrowserUseDeliveredFieldShape[];
	method_step_events: readonly BrowserUseAuthMethodStep[];
	resume: BrowserUseDeliveryResumeDirective;
};

/**
 * One read `evaluate` action's raw evaluated data, keyed by its action id
 * (R21, R24). The executor carries the raw value ONLY as far as the runbook
 * engine, which validates and redacts it through `captureStructuredResult`
 * before any of it reaches durable shared-run state. A read action that emits
 * no native `result` field yields `data: undefined` — a clean empty observation, never a
 * fabricated value. This shape never rides a mutation result and never carries
 * adapter stdout, endpoints, or secrets past the engine's redaction admission.
 */
export type AgentBrowserReadResult = {
	action_id: string;
	/** Stable identity when this read came from an expanded iterate item. */
	item_key?: string;
	data: unknown;
};

type AgentBrowserSessionReleaseDebt = Extract<
	AdapterReleaseResult,
	{ released: false }
>;

/**
 * Native Agent Browser execution result. It carries structural truth only,
 * never adapter stdout, page text, field values, endpoints, or secrets.
 */
export type AgentBrowserExecutionResult =
	| {
			ok: true;
			outcome: "confirmed";
			executed_steps: number;
			target_tab_id: string;
			mutation_dispatched: boolean;
			/** Non-fatal debt when the adapter session could not be released. */
			release?: AgentBrowserSessionReleaseDebt;
			/** Present only when a confidential delivery engaged in this task. */
			delivery?: AgentBrowserDeliveryEvidence;
			/**
			 * Raw evaluated data from each read `evaluate` action in this task, in
			 * execution order (R21, R24). Empty unless a read action ran. The engine
			 * is the only consumer: it validates + redacts each entry before the
			 * bounded structured result reaches durable state.
			 */
			read_results?: readonly AgentBrowserReadResult[];
	  }
	| {
			ok: false;
			code: AgentBrowserExecutionFailureCode;
			outcome: "not-achieved" | "unknown";
			message: string;
			executed_steps: number;
			mutation_dispatched: boolean;
			/** Non-fatal debt when the adapter session could not be released. */
			release?: AgentBrowserSessionReleaseDebt;
			/** Present only on `agent_browser_connection_unstable`. */
			connection?: AgentBrowserConnectionDiagnostic;
			/**
			 * Present only when a confidential delivery engaged in this task.
			 * A delivery that happened before a later failure is still delivered:
			 * the evidence rides the failure so the caller's sensitive-run guard
			 * engages regardless of the task's terminal truth.
			 */
			delivery?: AgentBrowserDeliveryEvidence;
	  };

type JsonObject = Record<string, unknown>;
type AgentBrowserExecutionFailure = Extract<
	AgentBrowserExecutionResult,
	{ ok: false }
>;

function failure(
	code: AgentBrowserExecutionFailureCode,
	outcome: "not-achieved" | "unknown",
	message: string,
	executedSteps = 0,
	mutationDispatched = false,
): AgentBrowserExecutionFailure {
	return {
		ok: false,
		code,
		outcome,
		message,
		executed_steps: executedSteps,
		mutation_dispatched: mutationDispatched,
	};
}

async function releaseAgentBrowserTaskSession(
	runtime: AgentBrowserExecutionRuntime,
	task: AgentBrowserTask,
): Promise<AdapterReleaseResult> {
	const releaseSession = findAdapterDefinition("agent-browser")?.releaseSession;
	if (!releaseSession) {
		return {
			released: false,
			cause: "command-failed",
			detail: "The agent-browser adapter has no registered session release mechanic.",
		};
	}
	return releaseSession(
		{
			env: {},
			resolveExecutable: () => ({
				resolved: true,
				path: task.handoff.attachment.probe_executable,
			}),
			runCommand: runtime.runCommand,
		},
		{ sessionName: deriveSessionName(task.run_id) },
	);
}

async function markMutationDispatch(
	runtime: AgentBrowserExecutionRuntime,
	task: AgentBrowserTask,
	executedSteps: number,
): Promise<AgentBrowserExecutionFailure | undefined> {
	if (runtime.beforeMutationDispatch === undefined) {
		return failure(
			"agent_browser_mutation_marker_unavailable",
			"not-achieved",
			"Mutation dispatch was refused because durable write-ahead truth is unavailable.",
			executedSteps,
		);
	}
	try {
		const marked = await runtime.beforeMutationDispatch({ run_id: task.run_id });
		if (marked.ok) return undefined;
	} catch {
		// The durable owner supplies repair detail outside the executor. This lane
		// carries only structural refusal truth.
	}
	return failure(
		"agent_browser_mutation_marker_unavailable",
		"not-achieved",
		"Mutation dispatch was refused because durable write-ahead truth could not be recorded.",
		executedSteps,
	);
}

function asObject(value: unknown): JsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as JsonObject)
		: undefined;
}

function parseSuccessData(stdout: string): JsonObject | undefined {
	try {
		const envelope = asObject(JSON.parse(stdout));
		if (envelope?.success !== true) return undefined;
		return asObject(envelope.data);
	} catch {
		return undefined;
	}
}

function actionIntegrityIsValid(
	step: Extract<AgentBrowserTaskStep, { kind: "evaluate" }>,
	allowedOrigins: ReadonlySet<string>,
): boolean {
	if (
		!SAFE_RUN_ID.test(step.action_id) ||
		(step.item_key !== undefined && !SAFE_BATCH_ITEM_KEY.test(step.item_key)) ||
		step.review_status !== "approved" ||
		step.script.length === 0 ||
		step.script.length > 100_000 ||
		!allowedOrigins.has(step.allowed_origin) ||
		step.script_sha256 !==
			createHash("sha256").update(step.script).digest("hex") ||
		(step.effect === "mutation" && step.postcondition === undefined)
	) {
		return false;
	}
	try {
		return (
			Buffer.byteLength(reviewedActionPayload(step), "utf-8") <=
			TRANSPORT_STDIN_MAX_BYTES
		);
	} catch {
		return false;
	}
}

function reviewedActionPayload(
	step: Extract<AgentBrowserTaskStep, { kind: "evaluate" }>,
): string {
	// Emit a single async-IIFE EXPRESSION, not a top-level `await` statement: the
	// native `eval` harness evaluates the payload as one expression and awaits the
	// returned promise. A bare `await action(...)` is top-level await, which the
	// evaluation context rejects with `SyntaxError: await is only valid in async
	// functions`, failing every async reviewed action before it runs.
	return `(async () => { const action = (${step.script}); return await action({ inputs: ${JSON.stringify(step.inputs)} }); })()`;
}

type AgentBrowserCommandContext = Pick<
	AgentBrowserTask,
	"handoff" | "run_id"
>;

function baseArgs(task: AgentBrowserCommandContext): string[] {
	return [
		"--cdp",
		task.handoff.endpoint.ws,
		"--session",
		`browser-use-${task.run_id}`,
	];
}

async function runNative(
	runtime: AgentBrowserExecutionRuntime,
	task: AgentBrowserCommandContext,
	args: readonly string[],
	stdinText?: string,
): Promise<McporterCommandResult | undefined> {
	try {
		return await runtime.runCommand({
			command: task.handoff.attachment.probe_executable,
			args: [...baseArgs(task), ...args],
			...(stdinText === undefined ? {} : { stdinText }),
			timeoutMs: COMMAND_TIMEOUT_MS,
		});
	} catch {
		return undefined;
	}
}

function commandSucceeded(result: McporterCommandResult | undefined): boolean {
	return (
		result !== undefined &&
		result.exitCode === 0 &&
		result.timedOut !== true &&
		parseSuccessData(result.stdout) !== undefined
	);
}

type AgentBrowserValidationInput = Pick<
	AgentBrowserTask,
	"handoff" | "run_id" | "allowed_origins" | "steps"
>;

function validateExecutionContext(
	task: AgentBrowserValidationInput,
):
	| { ok: true; allowedOrigins: ReadonlySet<string> }
	| AgentBrowserExecutionFailure {
	if (
		task.handoff.contract_id !== HANDOFF_CONTRACT_ID ||
		task.handoff.schema_version !== HANDOFF_SCHEMA_VERSION ||
		task.handoff.outcome !== "verified" ||
		task.handoff.attachment.adapter_id !== "agent-browser" ||
		task.handoff.attachment.route !== "explicit-cdp" ||
		task.handoff.browser_entry_mode !== "explicit-cdp" ||
		task.handoff.proof.route_evidence !== "verified-live" ||
		!isAbsolute(task.handoff.attachment.probe_executable) ||
		task.handoff.endpoint.ws.length === 0
	) {
		return failure(
			"agent_browser_handoff_invalid",
			"not-achieved",
			"Agent Browser execution requires a schema-2 verified-live Browser Connect handoff for the agent-browser lane.",
		);
	}
	if (!SAFE_RUN_ID.test(task.run_id)) {
		return failure(
			"agent_browser_task_invalid",
			"not-achieved",
			"Run identity must be a bounded safe identifier.",
		);
	}
	const allowedOrigins = agentBrowserAllowedOriginSet(task.allowed_origins);
	if (allowedOrigins === undefined) {
		return failure(
			"agent_browser_task_invalid",
			"not-achieved",
			"At least one exact HTTP(S) origin is required.",
		);
	}
	if (
		task.steps.some(
			(step) =>
				step.kind === "click-semantic" &&
				!semanticClickInputIsValid({
					role: step.role,
					name: step.name,
					visibleSelector: step.postcondition.selector,
				}),
		)
	) {
		return failure(
			"agent_browser_task_invalid",
			"not-achieved",
			"Semantic click targets require one bounded accessible role and name.",
		);
	}
	return { ok: true, allowedOrigins };
}

function validateTask(
	task: AgentBrowserTask,
):
	| { ok: true; allowedOrigins: ReadonlySet<string> }
	| AgentBrowserExecutionFailure {
	const validation = validateExecutionContext(task);
	if (!validation.ok) return validation;
	if (!SAFE_TAB_ID.test(task.target_tab_id)) {
		return failure(
			"agent_browser_task_invalid",
			"not-achieved",
			"Tab identity must be a bounded safe identifier.",
		);
	}
	if (
		task.expected_target_url !== undefined &&
		(task.expected_target_url.length === 0 ||
			task.expected_target_url.length > 8192 ||
			(!agentBrowserOriginIsAllowed(
				task.expected_target_url,
				validation.allowedOrigins,
			) &&
				!(
					task.allow_neutral_target === true &&
					neutralTargetIsAllowed(task.expected_target_url, task.steps)
				)))
	) {
		return failure(
			"agent_browser_task_invalid",
			"not-achieved",
			"Expected target URL must be a bounded exact URL.",
		);
	}
	return validation;
}

/**
 * Resolve one exact execution target through a verified handoff.
 *
 * This wrapper owns the native argv so callers never reconstruct the Browser
 * Connect attachment contract. Persist only `binding`; pass `target_tab_id`
 * directly to the immediate executor call.
 *
 * @param runtime - Structured no-shell command runner
 * @param input - Verified handoff, target policy, remaining steps, and request
 * @returns One transient raw tab id plus opaque binding, or typed repair truth
 */
export async function resolveAgentBrowserTaskTarget(
	runtime: AgentBrowserExecutionRuntime,
	input: AgentBrowserTargetResolutionInput,
): Promise<AgentBrowserTargetResolutionResult> {
	const validation = validateExecutionContext(input);
	if (!validation.ok) return validation;
	if (
		!/^[a-f0-9]{32}$/.test(input.target.target_envelope_id) ||
		(input.target.kind === "exact" && !SAFE_TAB_ID.test(input.target.tab_id)) ||
		(input.target.kind === "auto" &&
			input.target.bound_target_candidate_id !== undefined &&
			!/^[a-f0-9]{24}$/.test(input.target.bound_target_candidate_id))
	) {
		return failure(
			"agent_browser_task_invalid",
			"not-achieved",
			"Target requests require bounded exact or opaque identities.",
		);
	}
	const nativeCommand = (args: readonly string[]) =>
		runNative(runtime, input, args);
	return resolveAgentBrowserTarget(
		nativeCommand,
		input,
		validation.allowedOrigins,
	);
}

/**
 * Execute one bounded task through Agent Browser's native CLI.
 *
 * Browser Connect remains the only attachment owner: this consumer uses the
 * handed-off executable and endpoint verbatim, names one session and one tab,
 * requires a current snapshot before ref mutation, discards refs after every
 * mutation, and verifies fresh structure before reporting confirmed.
 *
 * @param runtime - Structured no-shell command runner
 * @param task - Verified handoff, target, origin policy, and bounded steps
 * @returns Structural task truth with no raw adapter or page output
 *
 * @example
 * ```ts
 * const result = await executeAgentBrowserTask(runtime, task)
 * if (!result.ok && result.outcome === "unknown") inspectBeforeRetry()
 * ```
 */
export async function executeAgentBrowserTask(
	runtime: AgentBrowserExecutionRuntime,
	task: AgentBrowserTask,
): Promise<AgentBrowserExecutionResult> {
	const validation = validateTask(task);
	if (!validation.ok) return validation;
	if (
		task.steps.some(
			(step) =>
				step.kind === "evaluate" &&
				step.effect === "mutation" &&
				step.item_key !== undefined,
		) &&
		runtime.afterItemCheckpoint === undefined
	) {
		return failure(
			"agent_browser_item_checkpoint_unavailable",
			"not-achieved",
			"An iterated mutation requires a durable per-item checkpoint seam before browser dispatch.",
		);
	}
	const nativeCommand = (args: readonly string[]) =>
		runNative(runtime, task, args);
	const targetFailure = await selectAgentBrowserTarget(
		nativeCommand,
		task,
		validation.allowedOrigins,
	);
	let taskOutcome: AgentBrowserExecutionResult | undefined = targetFailure;

	let currentRefs = new Set<string>();
	let currentRefMetadata = new Map<string, { role: string; name: string }>();
	let hasCurrentSnapshot = false;
	let executedSteps = 0;
	let mutationDispatched = false;
	// Raw read-action data captured across this task's read `evaluate` steps
	// (R21, R24). Stays empty for mutation-only or ref-only tasks. The engine
	// validates + redacts each entry; the executor never persists it.
	const readResults: AgentBrowserReadResult[] = [];
	// Confidential-delivery evidence accumulates across the task's confidential
	// fills (auth plan U5): the delivered shapes feed the sentinel owner, the
	// method-step-complete events name the FSM steps the auth transaction records,
	// and the last resume directive carries the discard-refs / fresh-identity
	// demand. Empty unless the auth-delivery context engages at least once.
	const deliveredShapes: BrowserUseDeliveredFieldShape[] = [];
	const methodStepEvents: BrowserUseAuthMethodStep[] = [];
	let lastResume: BrowserUseDeliveryResumeDirective | undefined;
	// A failure AFTER at least one delivered shape must still carry the delivery
	// evidence: the secret already reached the page, so the caller's sensitive-run
	// guard has to engage even though the task did not confirm. Invariant:
	// lastResume is defined whenever deliveredShapes is non-empty (both are set
	// together on a successful delivery); the guard below enforces it structurally.
	const withDelivery = (
		result: AgentBrowserExecutionFailure,
	): AgentBrowserExecutionFailure =>
		deliveredShapes.length > 0 && lastResume !== undefined
			? {
					...result,
					delivery: {
						delivered_shapes: [...deliveredShapes],
						method_step_events: [...methodStepEvents],
						resume: lastResume,
					},
				}
			: result;
	for (const step of taskOutcome === undefined ? task.steps : []) {
		if (step.kind === "snapshot") {
			const result = await runNative(runtime, task, [
				"snapshot",
				...(step.interactive ? ["-i"] : []),
				"--json",
			]);
			if (!commandSucceeded(result)) {
				taskOutcome = withDelivery(failure(
					"agent_browser_command_failed",
					"not-achieved",
					"Agent Browser could not observe fresh page structure.",
					executedSteps,
				));
				break;
			}
			const projected = projectAgentBrowserSnapshotRefs(
				parseSuccessData(result?.stdout ?? "")?.refs,
			);
			currentRefs = new Set(projected.refs);
			currentRefMetadata = new Map(projected.metadata);
			hasCurrentSnapshot = true;
			executedSteps += 1;
			continue;
		}

		if (step.kind === "open") {
			if (!agentBrowserOriginIsAllowed(step.url, validation.allowedOrigins)) {
				taskOutcome = withDelivery(failure(
					"agent_browser_target_origin_refused",
					"not-achieved",
					"Navigation is outside the task's allowed origins.",
					executedSteps,
				));
				break;
			}
			const markerFailure = await markMutationDispatch(
				runtime,
				task,
				executedSteps,
			);
			if (markerFailure !== undefined) {
				taskOutcome = withDelivery(markerFailure);
				break;
			}
			mutationDispatched = true;
			const opened = await runNative(runtime, task, ["open", step.url, "--json"]);
			currentRefs = new Set();
			currentRefMetadata = new Map();
			hasCurrentSnapshot = false;
			if (!commandSucceeded(opened)) {
				taskOutcome = withDelivery(failure(
					"agent_browser_mutation_effect_unknown",
					"unknown",
					"Navigation may have reached the browser; inspect before retry.",
					executedSteps,
					mutationDispatched,
				));
				break;
			}
			const verified = await verifyAgentBrowserPostcondition(
				nativeCommand,
				step.postcondition,
				validation.allowedOrigins,
			);
			if (verified !== "confirmed") {
				taskOutcome = withDelivery(failure(
					verified === "unavailable"
						? "agent_browser_mutation_effect_unknown"
						: "agent_browser_postcondition_not_achieved",
					verified === "unavailable" ? "unknown" : "not-achieved",
					verified === "unavailable"
						? "Navigation completed without fresh structural proof; inspect before retry."
						: "Fresh structure did not satisfy the declared navigation postcondition.",
					executedSteps + 1,
					mutationDispatched,
				));
				break;
			}
			executedSteps += 1;
			continue;
		}

		if (!hasCurrentSnapshot) {
			taskOutcome = withDelivery(failure(
				"agent_browser_current_snapshot_required",
				"not-achieved",
				"A fresh task-local snapshot is required immediately before ref mutation.",
				executedSteps,
			));
			break;
		}
		if (step.kind === "evaluate") {
			if (!actionIntegrityIsValid(step, validation.allowedOrigins)) {
				taskOutcome = withDelivery(failure(
					"agent_browser_action_integrity_refused",
					"not-achieved",
					"Evaluated actions require an approved hash-bound script, admitted origin, bounded input, and mutation postcondition.",
					executedSteps,
				));
				break;
			}
			const currentUrl = await runNative(runtime, task, ["get", "url", "--json"]);
			const observedUrl = parseSuccessData(currentUrl?.stdout ?? "")?.url;
			if (
				!commandSucceeded(currentUrl) ||
				typeof observedUrl !== "string" ||
				!agentBrowserHasExactOrigin(observedUrl, step.allowed_origin)
			) {
				taskOutcome = withDelivery(failure(
					"agent_browser_action_target_refused",
					"not-achieved",
					"The reviewed action's exact allowed origin is not freshly proven.",
					executedSteps,
				));
				break;
			}
			if (step.effect === "mutation") {
				const markerFailure = await markMutationDispatch(
					runtime,
					task,
					executedSteps,
				);
				if (markerFailure !== undefined) {
					taskOutcome = withDelivery(markerFailure);
					break;
				}
				mutationDispatched = true;
			}
			const evaluated = await runNative(
				runtime,
				task,
				["eval", "--stdin", "--json"],
				reviewedActionPayload(step),
			);
			currentRefs = new Set();
			currentRefMetadata = new Map();
			hasCurrentSnapshot = false;
			if (!commandSucceeded(evaluated)) {
				// A mutation that may have dispatched is `unknown` (no retry). A read
				// dispatches no browser effect, so its failure is a clean
				// `not-achieved` — it never manufactures a possible mutation (R21).
				if (
					step.effect === "mutation" &&
					step.item_key !== undefined
				) {
					await checkpointItem(runtime, {
						run_id: task.run_id,
						item_key: step.item_key,
						outcome: "unknown",
					});
				}
				taskOutcome = withDelivery(
					step.effect === "mutation"
						? failure(
								"agent_browser_mutation_effect_unknown",
								"unknown",
								"The reviewed action may have dispatched browser effects; inspect before retry.",
								executedSteps,
								mutationDispatched,
							)
						: failure(
								"agent_browser_action_read_not_achieved",
								"not-achieved",
								"The reviewed read action did not return an observation.",
								executedSteps,
								mutationDispatched,
							),
				);
				break;
			}
			if (step.effect === "read") {
				// Carry the raw read observation only as far as the engine, which
				// validates + redacts it (R21). A read that emits no `result` field is a
				// clean empty observation.
				readResults.push({
					action_id: step.action_id,
					...(step.item_key !== undefined ? { item_key: step.item_key } : {}),
					data: parseSuccessData(evaluated?.stdout ?? "")?.result,
				});
			}
			if (step.effect === "mutation" && step.postcondition !== undefined) {
				const verified = await verifyAgentBrowserPostcondition(
					nativeCommand,
					step.postcondition,
					validation.allowedOrigins,
				);
				if (verified !== "confirmed") {
					if (
						step.item_key !== undefined
					) {
						await checkpointItem(runtime, {
							run_id: task.run_id,
							item_key: step.item_key,
							outcome: "unknown",
						});
					}
					taskOutcome = withDelivery(failure(
						verified === "unavailable"
							? "agent_browser_mutation_effect_unknown"
							: "agent_browser_postcondition_not_achieved",
						verified === "unavailable" ? "unknown" : "not-achieved",
						verified === "unavailable"
							? "Reviewed mutation completed without fresh structural proof; inspect before retry."
							: "Fresh structure did not satisfy the reviewed action postcondition.",
						executedSteps + 1,
						mutationDispatched,
					));
					break;
				}
				if (step.item_key !== undefined) {
					const checkpointed = await checkpointItem(runtime, {
						run_id: task.run_id,
						item_key: step.item_key,
						outcome: "confirmed",
					});
					if (!checkpointed) {
						taskOutcome = withDelivery(failure(
							"agent_browser_mutation_effect_unknown",
							"unknown",
							"The iterated mutation confirmed structurally, but its durable item checkpoint could not be recorded; inspect before retry.",
							executedSteps + 1,
							mutationDispatched,
						));
						break;
					}
				}
			}
			executedSteps += 1;
			continue;
		}
		const semanticTarget: { role: string; name: string } | undefined =
			step.kind === "click-semantic"
				? { role: step.role, name: step.name }
				: step.kind === "fill" && step.target !== undefined
					? step.target
					: undefined;
		const mutationRef =
			semanticTarget !== undefined
				? resolveUniqueSemanticRef(
						{ refs: currentRefs, metadata: currentRefMetadata },
						semanticTarget,
					)
				: step.kind === "click-semantic"
					? undefined
					: step.ref;
		if (
			mutationRef === undefined ||
			!SAFE_REF.test(mutationRef) ||
			!currentRefs.has(mutationRef)
		) {
			taskOutcome = withDelivery(failure(
				"agent_browser_ref_invalid",
				"not-achieved",
				semanticTarget !== undefined
					? "The semantic mutation target did not resolve to exactly one ref in the current task-local snapshot."
					: "The requested ref is absent from the current task-local snapshot.",
				executedSteps,
			));
			break;
		}
		if (!(step.kind === "fill" && step.sensitivity === "confidential")) {
			const originProof = await reproveAgentBrowserOrigin(
				nativeCommand,
				validation.allowedOrigins,
			);
			if (originProof !== "allowed") {
				taskOutcome = withDelivery(failure(
					originProof === "refused"
						? "agent_browser_target_origin_refused"
						: "agent_browser_target_unavailable",
					"not-achieved",
					originProof === "refused"
						? "The selected tab moved outside the task's allowed origins before mutation."
						: "The selected tab's exact origin could not be freshly proven before mutation.",
					executedSteps,
				));
				break;
			}
		}
		if (step.kind === "fill" && step.sensitivity === "confidential") {
			const delivery = task.auth_delivery;
			// Default (no auth-delivery context, or the transaction is not in its
			// sensitive-interval): the typed refusal stands unchanged. A missing
			// TokenRetrievalPort (native capability absent) means the auth wiring
			// supplies no context, so this refusal is exactly the pre-U5 behavior.
			if (delivery === undefined || !delivery.in_sensitive_interval) {
				taskOutcome = withDelivery(failure(
					"agent_browser_confidential_input_requires_auth_transaction",
					"not-achieved",
					"Confidential input must use the Browser Authentication Transaction.",
					executedSteps,
				));
				break;
			}
			// The context is present and we are inside the sensitive interval: route
			// this field through the Confidential Field Delivery choreography instead
			// of the executor's own `fill`. The choreography re-proves the target,
			// mints an opaque handle, and performs one bounded write inside the
			// disposable delivery helper — the executor never observes a value.
			const field =
				step.item_binding === undefined
					? undefined
					: delivery.field_by_binding_slug[step.item_binding];
			if (field === undefined) {
				taskOutcome = withDelivery(failure(
					"agent_browser_confidential_delivery_blocked",
					"not-achieved",
					"The confidential fill binding has no mapped credential field in the auth-delivery context.",
					executedSteps,
				));
				break;
			}
			const outcome = await deliverConfidentialFields({
				binding: delivery.binding,
				target: delivery.target,
				fields: [field],
				tokenRetrieval: delivery.tokenRetrieval,
				deliver: delivery.deliver,
				reproveTarget: delivery.reproveTarget,
			});
			// The resume directive demands stale refs be discarded before any
			// post-auth proof (R15/R22): drop the current snapshot now so the
			// step's postcondition re-observes fresh structure, never a stale ref.
			currentRefs = new Set();
			currentRefMetadata = new Map();
			hasCurrentSnapshot = false;
			if (!outcome.ok) {
				// A blocked delivery is a not-achieved refusal carrying the auth
				// choreography's own blocked cause; the executor never invents a
				// retry — the caller inspects the blocked cause before resuming.
				// withDelivery: an earlier fill in this task may already have
				// delivered, so prior evidence still rides this refusal.
					taskOutcome = withDelivery({
						ok: false,
						code: "agent_browser_confidential_delivery_blocked",
						outcome: "not-achieved",
						message: `Confidential field delivery was blocked (${outcome.blocked.blocked_cause}); resolve the blocked cause through the Browser Authentication Transaction before resuming.`,
						executed_steps: executedSteps,
						mutation_dispatched:
							mutationDispatched || outcome.blocked.external_effect_possible,
					});
					break;
				}
			mutationDispatched = true;
			for (const shape of outcome.resume.delivered_shapes) {
				deliveredShapes.push(shape);
				methodStepEvents.push(METHOD_STEP_BY_FIELD[shape.field]);
			}
			lastResume = outcome.resume;
			// Post-auth proof: the delivered field's structural postcondition, freshly
			// observed after the resume directive discarded stale refs.
			const verified = await verifyAgentBrowserPostcondition(
				nativeCommand,
				step.postcondition,
				validation.allowedOrigins,
			);
			if (verified !== "confirmed") {
				taskOutcome = withDelivery(failure(
					verified === "unavailable"
						? "agent_browser_mutation_effect_unknown"
						: "agent_browser_postcondition_not_achieved",
					verified === "unavailable" ? "unknown" : "not-achieved",
					verified === "unavailable"
						? "Confidential delivery completed without fresh structural proof; inspect before retry."
						: "Fresh structure did not satisfy the confidential fill postcondition.",
					executedSteps + 1,
					mutationDispatched,
				));
				break;
			}
			executedSteps += 1;
			continue;
		}

		const mutationArgs =
			step.kind === "fill"
				? ["fill", mutationRef, step.value, "--json"]
				: ["click", mutationRef, "--json"];
		const markerFailure = await markMutationDispatch(
			runtime,
			task,
			executedSteps,
		);
		if (markerFailure !== undefined) {
			taskOutcome = withDelivery(markerFailure);
			break;
		}
		mutationDispatched = true;
		const mutated = await runNative(runtime, task, mutationArgs);
		currentRefs = new Set();
		currentRefMetadata = new Map();
		hasCurrentSnapshot = false;
		if (!commandSucceeded(mutated)) {
			taskOutcome = withDelivery(failure(
				"agent_browser_mutation_effect_unknown",
				"unknown",
				"Agent Browser may have dispatched the mutation; inspect before retry.",
				executedSteps,
				mutationDispatched,
			));
			break;
		}
		const verified = await verifyAgentBrowserPostcondition(
			nativeCommand,
			step.postcondition,
			validation.allowedOrigins,
		);
		if (verified !== "confirmed") {
			taskOutcome = withDelivery(failure(
				verified === "unavailable"
					? "agent_browser_mutation_effect_unknown"
					: "agent_browser_postcondition_not_achieved",
				verified === "unavailable" ? "unknown" : "not-achieved",
				verified === "unavailable"
					? "Mutation completed without fresh structural proof; inspect before retry."
					: "Fresh structure did not satisfy the declared mutation postcondition.",
				executedSteps + 1,
				mutationDispatched,
			));
			break;
		}
		executedSteps += 1;
	}

	if (taskOutcome === undefined) {
		taskOutcome = {
			ok: true,
			outcome: "confirmed",
			executed_steps: executedSteps,
			target_tab_id: task.target_tab_id,
			mutation_dispatched: mutationDispatched,
			...(lastResume !== undefined
				? {
						delivery: {
							delivered_shapes: deliveredShapes,
							method_step_events: methodStepEvents,
							resume: lastResume,
						},
					}
				: {}),
			...(readResults.length > 0 ? { read_results: readResults } : {}),
		};
	}

	const release = await releaseAgentBrowserTaskSession(runtime, task);
	return release.released ? taskOutcome : { ...taskOutcome, release };
}

// ---------------------------------------------------------------------------
// Pause/resume continuity around confidential delivery (R18, AE10).
//
// The task lane pauses at the confidential step; the choreography
// (browser-use-confidential-field-delivery.ts) emits the resume directive.
// This section is the lane-side obedience: discard every adapter ref captured
// before delivery and re-observe one fresh identity basis before continuing.
// Ref staleness is judged by VISIBILITY/OPERABILITY over the non-secret
// main-process CDP observer (browser-use-cdp-observer.ts) — a still-resolvable
// but hidden node IS stale. SPA logins hide rather than remove screens, so a
// succeeding DOM.resolveNode is a false still-valid signal; the observer's
// probe API never consults it.
// ---------------------------------------------------------------------------

/**
 * One adapter-local ref captured BEFORE a confidential delivery, bridged to
 * the browser-global backend node id the main-process observer can probe. The
 * bridge exists so staleness is judged by rendered visibility and operability,
 * never by the adapter ref (or its DOM node) continuing to resolve.
 */
export type AgentBrowserCapturedRef = {
	ref: string;
	backend_node_id: number;
};

/**
 * Probe-grounded staleness verdict for one captured ref. A node that still
 * resolves but is hidden or inoperable IS stale (R18): the SPA advanced by
 * hiding the previous screen, so acting through the old ref would write into
 * an invisible surface.
 */
export type AgentBrowserRefStaleness =
	| { stale: false }
	| {
			stale: true;
			cause: "ref-not-visible" | "ref-not-operable" | "ref-unobservable";
	  };

/**
 * Judge one captured ref through the observer's visibility/operability probe
 * (R18). An unobservable node (target gone, snapshot refused, or the node
 * absent from the fresh tree) is stale, not an error: the ref cannot be
 * proven live, so it must not be reused.
 *
 * @param observer - U8 main-process CDP observer bound to a verified endpoint
 * @param input - Exact CDP target id and the browser-global backend node id
 * @returns Fresh-probe staleness truth; never consults DOM.resolveNode
 */
export async function judgeAgentBrowserRefStaleness(
	observer: BrowserUseCdpObserver,
	input: { cdp_target_id: string; backend_node_id: number },
): Promise<AgentBrowserRefStaleness> {
	const probed = await observer.probeNode({
		target_id: input.cdp_target_id,
		backend_node_id: input.backend_node_id,
	});
	if (!probed.ok) return { stale: true, cause: "ref-unobservable" };
	if (!probed.probe.visible) return { stale: true, cause: "ref-not-visible" };
	if (!probed.probe.operable) return { stale: true, cause: "ref-not-operable" };
	return { stale: false };
}

/**
 * Typed reuse refusal for a ref captured before delivery. The refusal is
 * unconditional; the probe evidence names why the underlying node is (or is
 * not) still live so the caller sees the screen-advance truth, never a bare
 * policy "no".
 */
export type AgentBrowserRefReuseRefusal = {
	reusable: false;
	code: "agent_browser_stale_ref_refused";
	message: string;
	/** Probe evidence at refusal time; a still-live node is still refused. */
	staleness: AgentBrowserRefStaleness;
};

/**
 * Refuse reuse of one pre-delivery adapter ref (R18/AE10). The resume
 * directive discarded every ref captured before delivery, so reuse is refused
 * unconditionally — repair is obeying the directive through
 * {@link resumeAgentBrowserAfterDelivery}, never retrying the old ref. The
 * attached staleness verdict is freshly probed by visibility/operability.
 *
 * @param observer - U8 main-process CDP observer bound to a verified endpoint
 * @param input - Exact CDP target id and the captured pre-delivery ref
 * @returns The typed refusal with probe-grounded staleness evidence
 */
export async function refuseAgentBrowserPreDeliveryRef(
	observer: BrowserUseCdpObserver,
	input: { cdp_target_id: string; captured: AgentBrowserCapturedRef },
): Promise<AgentBrowserRefReuseRefusal> {
	const staleness = await judgeAgentBrowserRefStaleness(observer, {
		cdp_target_id: input.cdp_target_id,
		backend_node_id: input.captured.backend_node_id,
	});
	return {
		reusable: false,
		code: "agent_browser_stale_ref_refused",
		message: `Ref ${input.captured.ref} was captured before confidential delivery; obey the resume directive — discard stale refs and re-observe a fresh identity basis — instead of reusing it.`,
		staleness,
	};
}

/**
 * Input for obeying one delivery resume directive on the task lane.
 */
export type AgentBrowserResumeContinuityInput = {
	resume: BrowserUseDeliveryResumeDirective;
	/** Exact CDP target id observed fresh — never an adapter-owned page ref. */
	cdp_target_id: string;
	/** Every adapter ref the lane captured before the delivery pause. */
	captured_refs: readonly AgentBrowserCapturedRef[];
};

/**
 * Resume continuity truth. Success carries the discarded pre-delivery refs and
 * ONE fresh identity basis — the only legal source of post-resume refs. When
 * no fresh basis is observable the lane must not continue at all, and when the
 * offered CDP target is not the directive's target the lane is refused before
 * any observation happens.
 */
export type AgentBrowserResumeContinuityResult =
	| {
			ok: true;
			/** The SAME lane resumes (R5/KTD3) — identity echoed from the directive. */
			lane_id: string;
			run_id: string;
			/** Every pre-delivery ref, discarded per `resume.discard_stale_refs`. */
			discarded_refs: readonly string[];
			/** One fresh basis per `resume.require_fresh_identity_basis`. */
			basis: BrowserUseAccessibilitySnapshot;
	  }
	| {
			ok: false;
			code: "agent_browser_resume_target_mismatch";
			message: string;
	  }
	| {
			ok: false;
			code: "agent_browser_fresh_identity_basis_unavailable";
			message: string;
	  };

/**
 * Obey one resume directive before the task lane continues (R18). The offered
 * CDP target must BE the directive's target: `resume.target_id` and
 * `cdp_target_id` name the same CDP target, so a mismatch is refused before
 * any snapshot — resuming on a different target would mint an identity basis
 * the delivery never verified. Then discards every pre-delivery ref and takes
 * exactly one fresh observer snapshot as the new identity basis. The
 * directive's demands are type-level truths (`discard_stale_refs: true`,
 * `require_fresh_identity_basis: true`), so obedience is unconditional —
 * there is no branch that keeps an old ref.
 *
 * @param observer - U8 main-process CDP observer bound to a verified endpoint
 * @param input - The choreography's directive, exact CDP target, captured refs
 * @returns Fresh identity basis plus discarded refs, or a typed refusal
 *
 * @example
 * ```ts
 * const resumed = await resumeAgentBrowserAfterDelivery(observer, {
 *   resume: delivery.resume,
 *   cdp_target_id: "cdp-target-7",
 *   captured_refs: [{ ref: "@e2", backend_node_id: 41 }],
 * })
 * if (resumed.ok) continueFrom(resumed.basis)
 * ```
 */
export async function resumeAgentBrowserAfterDelivery(
	observer: BrowserUseCdpObserver,
	input: AgentBrowserResumeContinuityInput,
): Promise<AgentBrowserResumeContinuityResult> {
	if (input.cdp_target_id !== input.resume.target_id) {
		return {
			ok: false,
			code: "agent_browser_resume_target_mismatch",
			message: `The resume directive names CDP target ${input.resume.target_id} but the lane offered ${input.cdp_target_id}; resume only on the directive's target — a fresh identity basis on any other target was never verified by delivery.`,
		};
	}
	const discarded_refs = input.captured_refs.map((captured) => captured.ref);
	const observed = await observer.snapshot({
		target_id: input.cdp_target_id,
	});
	if (!observed.ok) {
		return {
			ok: false,
			code: "agent_browser_fresh_identity_basis_unavailable",
			message:
				"The resumed lane could not observe a fresh identity basis; repair the target before continuing — pre-delivery refs stay discarded.",
		};
	}
	return {
		ok: true,
		lane_id: input.resume.lane_id,
		run_id: input.resume.run_id,
		discarded_refs,
		basis: observed.snapshot,
	};
}
