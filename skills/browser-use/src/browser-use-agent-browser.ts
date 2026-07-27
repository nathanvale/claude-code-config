import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import type { BrowserUseAuthMethodStep } from "./browser-use-auth-model";
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
const SAFE_RUN_ID = /^[A-Za-z0-9._-]{1,128}$/;
const SAFE_TAB_ID = /^[A-Za-z0-9._-]{1,128}$/;
const SAFE_REF = /^@e[1-9][0-9]*$/;

/**
 * Bounded reconnect budget for the connection-establishment phase only (R23,
 * release theme "no flaky CDP connections"). This is a small code-owned ceiling,
 * never an unbounded loop: connection-class failures observed BEFORE any browser
 * effect are re-probed at most this many times with a liveness probe between
 * attempts, then reported as a typed connection failure with a repair action.
 * Post-dispatch failures are NEVER reconnected — a mutation whose effect may have
 * landed stays `unknown` so flakiness is surfaced, not masked.
 */
const CONNECTION_ESTABLISH_ATTEMPTS = 3;

/**
 * Deterministic connection-class signal substrings drawn from real
 * agent-browser CDP failure envelopes (e.g. `{"success":false,"error":"CDP
 * WebSocket connect failed: ... Connection refused"}`, exit 0). Matched
 * case-insensitively against the adapter's own error text; a semantic failure
 * (adapter connected, tab genuinely absent) carries none of these and is never
 * retried.
 */
const CONNECTION_FAILURE_SIGNALS = [
	"cdp websocket connect failed",
	"cdp discovery methods failed",
	"failed to connect to cdp",
	"websocket connect failed",
	"connection refused",
	"connection reset",
	"error sending request",
] as const;

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
			postcondition: Extract<AgentBrowserPostcondition, { kind: "url-equals" }>;
	  }
	| {
			kind: "click";
			ref: string;
			postcondition: AgentBrowserPostcondition;
	  }
	| {
			kind: "fill";
			ref: string;
			value: string;
			sensitivity: "ordinary" | "confidential";
			postcondition: AgentBrowserPostcondition;
	  }
	| {
			kind: "evaluate";
			action_id: string;
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
 * submission-dispatched); `field_by_ref` names, per snapshot ref, which
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
	/** Snapshot ref -> the credential field the choreography must deliver. */
	field_by_ref: Readonly<Record<string, BrowserUseOpCredentialField>>;
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
	allowed_origins: readonly string[];
	steps: readonly AgentBrowserTaskStep[];
	auth_delivery?: AgentBrowserAuthDeliveryContext;
};

/**
 * Structured command seam shared with the Browser Use process runtime.
 */
export type AgentBrowserExecutionRuntime = {
	runCommand(input: McporterCommandInput): Promise<McporterCommandResult>;
};

/**
 * Stable native lane refusal codes.
 */
export type AgentBrowserExecutionFailureCode =
	| "agent_browser_handoff_invalid"
	| "agent_browser_task_invalid"
	| "agent_browser_connection_unstable"
	| "agent_browser_target_unavailable"
	| "agent_browser_target_origin_refused"
	| "agent_browser_command_failed"
	| "agent_browser_current_snapshot_required"
	| "agent_browser_ref_invalid"
	| "agent_browser_confidential_input_requires_auth_transaction"
	| "agent_browser_confidential_delivery_blocked"
	| "agent_browser_action_integrity_refused"
	| "agent_browser_action_target_refused"
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
 * Native Agent Browser execution result. It carries structural truth only,
 * never adapter stdout, page text, field values, endpoints, or secrets.
 */
export type AgentBrowserExecutionResult =
	| {
			ok: true;
			outcome: "confirmed";
			executed_steps: number;
			target_tab_id: string;
			/** Present only when a confidential delivery engaged in this task. */
			delivery?: AgentBrowserDeliveryEvidence;
	  }
	| {
			ok: false;
			code: AgentBrowserExecutionFailureCode;
			outcome: "not-achieved" | "unknown";
			message: string;
			executed_steps: number;
			/** Present only on `agent_browser_connection_unstable`. */
			connection?: AgentBrowserConnectionDiagnostic;
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
): AgentBrowserExecutionFailure {
	return {
		ok: false,
		code,
		outcome,
		message,
		executed_steps: executedSteps,
	};
}

function connectionUnstable(
	diagnostic: AgentBrowserConnectionDiagnostic,
): AgentBrowserExecutionFailure {
	return {
		ok: false,
		code: "agent_browser_connection_unstable",
		outcome: "not-achieved",
		message:
			"Agent Browser could not hold a stable CDP link to the verified endpoint after a bounded reconnect; inspect the connection diagnostic before retry.",
		executed_steps: 0,
		connection: diagnostic,
	};
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

/**
 * Extract the adapter's own error text from a failure envelope
 * (`{"success":false,"error":"..."}`), if present. Structural only — never the
 * data payload.
 */
function parseErrorText(stdout: string): string | undefined {
	try {
		const envelope = asObject(JSON.parse(stdout));
		if (envelope?.success === false && typeof envelope.error === "string") {
			return envelope.error;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Classify a failed command as connection-class (the adapter could not hold the
 * CDP link) versus semantic (the adapter connected but the request could not be
 * satisfied). Only connection-class failures observed before any browser effect
 * are eligible for bounded reconnect; everything else fails closed immediately.
 *
 * @returns The matched connection signal, or undefined for a semantic failure
 */
function connectionSignalOf(
	result: McporterCommandResult | undefined,
): string | undefined {
	if (result === undefined) return "adapter invocation failed";
	if (result.timedOut === true) return "cdp command timed out";
	const errorText = parseErrorText(result.stdout);
	if (errorText === undefined) return undefined;
	const haystack = errorText.toLowerCase();
	if (CONNECTION_FAILURE_SIGNALS.some((signal) => haystack.includes(signal))) {
		return errorText;
	}
	return undefined;
}

function allowedOriginSet(origins: readonly string[]): Set<string> | undefined {
	if (origins.length === 0) return undefined;
	const admitted = new Set<string>();
	for (const value of origins) {
		try {
			const url = new URL(value);
			if (
				(url.protocol !== "https:" && url.protocol !== "http:") ||
				url.origin !== value
			) {
				return undefined;
			}
			admitted.add(url.origin);
		} catch {
			return undefined;
		}
	}
	return admitted;
}

function originIsAllowed(value: string, allowed: ReadonlySet<string>): boolean {
	try {
		return allowed.has(new URL(value).origin);
	} catch {
		return false;
	}
}

function hasExactOrigin(value: string, expectedOrigin: string): boolean {
	try {
		return new URL(value).origin === expectedOrigin;
	} catch {
		return false;
	}
}

function actionIntegrityIsValid(
	step: Extract<AgentBrowserTaskStep, { kind: "evaluate" }>,
	allowedOrigins: ReadonlySet<string>,
): boolean {
	if (
		!SAFE_RUN_ID.test(step.action_id) ||
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
		JSON.stringify(step.inputs);
		return true;
	} catch {
		return false;
	}
}

function reviewedActionPayload(
	step: Extract<AgentBrowserTaskStep, { kind: "evaluate" }>,
): string {
	const wrapper = [
		`const action = (${step.script});`,
		`await action({ inputs: ${JSON.stringify(step.inputs)} });`,
	].join("\n");
	return Buffer.from(wrapper, "utf-8").toString("base64");
}

function baseArgs(task: AgentBrowserTask): string[] {
	return [
		"--cdp",
		task.handoff.endpoint.ws,
		"--session",
		`browser-use-${task.run_id}`,
	];
}

async function runNative(
	runtime: AgentBrowserExecutionRuntime,
	task: AgentBrowserTask,
	args: readonly string[],
): Promise<McporterCommandResult | undefined> {
	try {
		return await runtime.runCommand({
			command: task.handoff.attachment.probe_executable,
			args: [...baseArgs(task), ...args],
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

function validateTask(
	task: AgentBrowserTask,
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
	if (!SAFE_RUN_ID.test(task.run_id) || !SAFE_TAB_ID.test(task.target_tab_id)) {
		return failure(
			"agent_browser_task_invalid",
			"not-achieved",
			"Run and tab identities must be bounded safe identifiers.",
		);
	}
	const allowedOrigins = allowedOriginSet(task.allowed_origins);
	if (allowedOrigins === undefined) {
		return failure(
			"agent_browser_task_invalid",
			"not-achieved",
			"At least one exact HTTP(S) origin is required.",
		);
	}
	return { ok: true, allowedOrigins };
}

/**
 * Outcome of one connection-establishment attempt. `connection-unstable`
 * signals a connection-class failure that is eligible for bounded reconnect;
 * `refused` is a semantic failure (adapter connected, request unsatisfiable)
 * that fails closed immediately with no retry.
 */
type SelectTargetOutcome =
	| { kind: "attached" }
	| { kind: "connection-unstable"; signal: string }
	| { kind: "refused"; failure: AgentBrowserExecutionFailure };

async function selectTargetOnce(
	runtime: AgentBrowserExecutionRuntime,
	task: AgentBrowserTask,
	allowedOrigins: ReadonlySet<string>,
): Promise<SelectTargetOutcome> {
	const listed = await runNative(runtime, task, ["tab", "list", "--json"]);
	if (!commandSucceeded(listed)) {
		const signal = connectionSignalOf(listed);
		if (signal !== undefined) return { kind: "connection-unstable", signal };
		return {
			kind: "refused",
			failure: failure(
				"agent_browser_target_unavailable",
				"not-achieved",
				"Agent Browser could not list tabs through the verified handoff.",
			),
		};
	}
	const tabs = parseSuccessData(listed?.stdout ?? "")?.tabs;
	if (!Array.isArray(tabs)) {
		return {
			kind: "refused",
			failure: failure(
				"agent_browser_target_unavailable",
				"not-achieved",
				"Agent Browser returned no typed tab list.",
			),
		};
	}
	const target = tabs
		.map((tab) => asObject(tab))
		.find((tab) => tab?.tabId === task.target_tab_id);
	if (target === undefined || typeof target.url !== "string") {
		return {
			kind: "refused",
			failure: failure(
				"agent_browser_target_unavailable",
				"not-achieved",
				"The requested tab is not present in the verified Agent Browser session.",
			),
		};
	}
	if (!originIsAllowed(target.url, allowedOrigins)) {
		return {
			kind: "refused",
			failure: failure(
				"agent_browser_target_origin_refused",
				"not-achieved",
				"The requested tab is outside the task's allowed origins.",
			),
		};
	}
	const selected = await runNative(runtime, task, [
		"tab",
		task.target_tab_id,
		"--json",
	]);
	if (!commandSucceeded(selected)) {
		const signal = connectionSignalOf(selected);
		if (signal !== undefined) return { kind: "connection-unstable", signal };
		return {
			kind: "refused",
			failure: failure(
				"agent_browser_target_unavailable",
				"not-achieved",
				"Agent Browser could not explicitly select the requested tab.",
			),
		};
	}
	return { kind: "attached" };
}

/**
 * Establish the connection with a bounded reconnect (release theme "no flaky
 * CDP connections"). Retries ONLY connection-class failures, at most
 * CONNECTION_ESTABLISH_ATTEMPTS times, running a `get cdp-url` liveness probe
 * between attempts as inspectable evidence. Semantic refusals fail closed with
 * no retry; exhaustion returns a typed connection failure carrying the
 * adapter's own last signal. This phase runs before any browser effect, so a
 * retry can never double-apply a mutation.
 *
 * @returns undefined when attached; a typed failure otherwise
 */
async function selectTarget(
	runtime: AgentBrowserExecutionRuntime,
	task: AgentBrowserTask,
	allowedOrigins: ReadonlySet<string>,
): Promise<AgentBrowserExecutionFailure | undefined> {
	let attempts = 0;
	let lastSignal = "no connection attempt completed";
	while (attempts < CONNECTION_ESTABLISH_ATTEMPTS) {
		attempts += 1;
		const outcome = await selectTargetOnce(runtime, task, allowedOrigins);
		if (outcome.kind === "attached") return undefined;
		if (outcome.kind === "refused") return outcome.failure;
		lastSignal = outcome.signal;
		if (attempts < CONNECTION_ESTABLISH_ATTEMPTS) {
			// Liveness probe between attempts: evidence of whether the CDP link
			// recovered, never a mutation and never a success authority.
			await runNative(runtime, task, ["get", "cdp-url", "--json"]);
		}
	}
	return connectionUnstable({
		attempts,
		max_attempts: CONNECTION_ESTABLISH_ATTEMPTS,
		last_signal: lastSignal,
		next_repair_action:
			"Re-mint a Verified Handoff Envelope through `browser-connect connect --json` for the agent-browser lane, then rerun; a persistent connection failure means Warm Chrome is unready and needs a Browser Entry Handoff.",
	});
}

async function verifyPostcondition(
	runtime: AgentBrowserExecutionRuntime,
	task: AgentBrowserTask,
	postcondition: AgentBrowserPostcondition,
	allowedOrigins: ReadonlySet<string>,
): Promise<"confirmed" | "not-achieved" | "unavailable"> {
	let args: readonly string[];
	if (postcondition.kind === "url-equals") {
		if (!originIsAllowed(postcondition.url, allowedOrigins)) {
			return "not-achieved";
		}
		args = ["get", "url", "--json"];
	} else if (postcondition.kind === "value-equals") {
		if (
			postcondition.selector.startsWith("@") ||
			postcondition.selector.trim() === ""
		) {
			return "not-achieved";
		}
		args = ["get", "value", postcondition.selector, "--json"];
	} else {
		if (
			postcondition.selector.startsWith("@") ||
			postcondition.selector.trim() === ""
		) {
			return "not-achieved";
		}
		args = ["is", "visible", postcondition.selector, "--json"];
	}
	const verified = await runNative(runtime, task, args);
	if (!commandSucceeded(verified)) return "unavailable";
	const data = parseSuccessData(verified?.stdout ?? "");
	if (postcondition.kind === "url-equals") {
		return data?.url === postcondition.url ? "confirmed" : "not-achieved";
	}
	if (postcondition.kind === "value-equals") {
		return data?.value === postcondition.value ? "confirmed" : "not-achieved";
	}
	return data?.visible === true ? "confirmed" : "not-achieved";
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
	const targetFailure = await selectTarget(
		runtime,
		task,
		validation.allowedOrigins,
	);
	if (targetFailure !== undefined) return targetFailure;

	let currentRefs = new Set<string>();
	let hasCurrentSnapshot = false;
	let executedSteps = 0;
	// Confidential-delivery evidence accumulates across the task's confidential
	// fills (auth plan U5): the delivered shapes feed the sentinel owner, the
	// method-step-complete events name the FSM steps the auth transaction records,
	// and the last resume directive carries the discard-refs / fresh-identity
	// demand. Empty unless the auth-delivery context engages at least once.
	const deliveredShapes: BrowserUseDeliveredFieldShape[] = [];
	const methodStepEvents: BrowserUseAuthMethodStep[] = [];
	let lastResume: BrowserUseDeliveryResumeDirective | undefined;
	for (const step of task.steps) {
		if (step.kind === "snapshot") {
			const result = await runNative(runtime, task, [
				"snapshot",
				...(step.interactive ? ["-i"] : []),
				"--json",
			]);
			if (!commandSucceeded(result)) {
				return failure(
					"agent_browser_command_failed",
					"not-achieved",
					"Agent Browser could not observe fresh page structure.",
					executedSteps,
				);
			}
			const refs = asObject(parseSuccessData(result?.stdout ?? "")?.refs);
			currentRefs = new Set(
				Object.keys(refs ?? {}).map((ref) => (ref.startsWith("@") ? ref : `@${ref}`)),
			);
			hasCurrentSnapshot = true;
			executedSteps += 1;
			continue;
		}

		if (step.kind === "open") {
			if (!originIsAllowed(step.url, validation.allowedOrigins)) {
				return failure(
					"agent_browser_target_origin_refused",
					"not-achieved",
					"Navigation is outside the task's allowed origins.",
					executedSteps,
				);
			}
			const opened = await runNative(runtime, task, ["open", step.url, "--json"]);
			currentRefs = new Set();
			hasCurrentSnapshot = false;
			if (!commandSucceeded(opened)) {
				return failure(
					"agent_browser_mutation_effect_unknown",
					"unknown",
					"Navigation may have reached the browser; inspect before retry.",
					executedSteps,
				);
			}
			const verified = await verifyPostcondition(
				runtime,
				task,
				step.postcondition,
				validation.allowedOrigins,
			);
			if (verified !== "confirmed") {
				return failure(
					verified === "unavailable"
						? "agent_browser_mutation_effect_unknown"
						: "agent_browser_postcondition_not_achieved",
					verified === "unavailable" ? "unknown" : "not-achieved",
					verified === "unavailable"
						? "Navigation completed without fresh structural proof; inspect before retry."
						: "Fresh structure did not satisfy the declared navigation postcondition.",
					executedSteps + 1,
				);
			}
			executedSteps += 1;
			continue;
		}

		if (!hasCurrentSnapshot) {
			return failure(
				"agent_browser_current_snapshot_required",
				"not-achieved",
				"A fresh task-local snapshot is required immediately before ref mutation.",
				executedSteps,
			);
		}
		if (step.kind === "evaluate") {
			if (!actionIntegrityIsValid(step, validation.allowedOrigins)) {
				return failure(
					"agent_browser_action_integrity_refused",
					"not-achieved",
					"Evaluated actions require an approved hash-bound script, admitted origin, bounded input, and mutation postcondition.",
					executedSteps,
				);
			}
			const currentUrl = await runNative(runtime, task, ["get", "url", "--json"]);
			const observedUrl = parseSuccessData(currentUrl?.stdout ?? "")?.url;
			if (
				!commandSucceeded(currentUrl) ||
				typeof observedUrl !== "string" ||
				!hasExactOrigin(observedUrl, step.allowed_origin)
			) {
				return failure(
					"agent_browser_action_target_refused",
					"not-achieved",
					"The reviewed action's exact allowed origin is not freshly proven.",
					executedSteps,
				);
			}
			const evaluated = await runNative(runtime, task, [
				"eval",
				"-b",
				reviewedActionPayload(step),
				"--json",
			]);
			currentRefs = new Set();
			hasCurrentSnapshot = false;
			if (!commandSucceeded(evaluated)) {
				return failure(
					"agent_browser_mutation_effect_unknown",
					"unknown",
					"The reviewed action may have dispatched browser effects; inspect before retry.",
					executedSteps,
				);
			}
			if (step.effect === "mutation" && step.postcondition !== undefined) {
				const verified = await verifyPostcondition(
					runtime,
					task,
					step.postcondition,
					validation.allowedOrigins,
				);
				if (verified !== "confirmed") {
					return failure(
						verified === "unavailable"
							? "agent_browser_mutation_effect_unknown"
							: "agent_browser_postcondition_not_achieved",
						verified === "unavailable" ? "unknown" : "not-achieved",
						verified === "unavailable"
							? "Reviewed mutation completed without fresh structural proof; inspect before retry."
							: "Fresh structure did not satisfy the reviewed action postcondition.",
						executedSteps + 1,
					);
				}
			}
			executedSteps += 1;
			continue;
		}
		if (!SAFE_REF.test(step.ref) || !currentRefs.has(step.ref)) {
			return failure(
				"agent_browser_ref_invalid",
				"not-achieved",
				"The requested ref is absent from the current task-local snapshot.",
				executedSteps,
			);
		}
		if (step.kind === "fill" && step.sensitivity === "confidential") {
			const delivery = task.auth_delivery;
			// Default (no auth-delivery context, or the transaction is not in its
			// sensitive-interval): the typed refusal stands unchanged. A missing
			// TokenRetrievalPort (native capability absent) means the auth wiring
			// supplies no context, so this refusal is exactly the pre-U5 behavior.
			if (delivery === undefined || !delivery.in_sensitive_interval) {
				return failure(
					"agent_browser_confidential_input_requires_auth_transaction",
					"not-achieved",
					"Confidential input must use the Browser Authentication Transaction.",
					executedSteps,
				);
			}
			// The context is present and we are inside the sensitive interval: route
			// this field through the Confidential Field Delivery choreography instead
			// of the executor's own `fill`. The choreography re-proves the target,
			// mints an opaque handle, and performs one bounded write inside the
			// disposable delivery helper — the executor never observes a value.
			const field = delivery.field_by_ref[step.ref];
			if (field === undefined) {
				return failure(
					"agent_browser_confidential_delivery_blocked",
					"not-achieved",
					"The confidential fill ref has no mapped credential field in the auth-delivery context.",
					executedSteps,
				);
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
			hasCurrentSnapshot = false;
			if (!outcome.ok) {
				// A blocked delivery is a not-achieved refusal carrying the auth
				// choreography's own blocked cause; the executor never invents a
				// retry — the caller inspects the blocked cause before resuming.
				return {
					ok: false,
					code: "agent_browser_confidential_delivery_blocked",
					outcome: "not-achieved",
					message: `Confidential field delivery was blocked (${outcome.blocked.blocked_cause}); resolve the blocked cause through the Browser Authentication Transaction before resuming.`,
					executed_steps: executedSteps,
				};
			}
			for (const shape of outcome.resume.delivered_shapes) {
				deliveredShapes.push(shape);
				methodStepEvents.push(METHOD_STEP_BY_FIELD[shape.field]);
			}
			lastResume = outcome.resume;
			// Post-auth proof: the delivered field's structural postcondition, freshly
			// observed after the resume directive discarded stale refs.
			const verified = await verifyPostcondition(
				runtime,
				task,
				step.postcondition,
				validation.allowedOrigins,
			);
			if (verified !== "confirmed") {
				return failure(
					verified === "unavailable"
						? "agent_browser_mutation_effect_unknown"
						: "agent_browser_postcondition_not_achieved",
					verified === "unavailable" ? "unknown" : "not-achieved",
					verified === "unavailable"
						? "Confidential delivery completed without fresh structural proof; inspect before retry."
						: "Fresh structure did not satisfy the confidential fill postcondition.",
					executedSteps + 1,
				);
			}
			executedSteps += 1;
			continue;
		}

		const mutationArgs =
			step.kind === "click"
				? ["click", step.ref, "--json"]
				: ["fill", step.ref, step.value, "--json"];
		const mutated = await runNative(runtime, task, mutationArgs);
		currentRefs = new Set();
		hasCurrentSnapshot = false;
		if (!commandSucceeded(mutated)) {
			return failure(
				"agent_browser_mutation_effect_unknown",
				"unknown",
				"Agent Browser may have dispatched the mutation; inspect before retry.",
				executedSteps,
			);
		}
		const verified = await verifyPostcondition(
			runtime,
			task,
			step.postcondition,
			validation.allowedOrigins,
		);
		if (verified !== "confirmed") {
			return failure(
				verified === "unavailable"
					? "agent_browser_mutation_effect_unknown"
					: "agent_browser_postcondition_not_achieved",
				verified === "unavailable" ? "unknown" : "not-achieved",
				verified === "unavailable"
					? "Mutation completed without fresh structural proof; inspect before retry."
					: "Fresh structure did not satisfy the declared mutation postcondition.",
				executedSteps + 1,
			);
		}
		executedSteps += 1;
	}

	return {
		ok: true,
		outcome: "confirmed",
		executed_steps: executedSteps,
		target_tab_id: task.target_tab_id,
		...(lastResume !== undefined
			? {
					delivery: {
						delivered_shapes: deliveredShapes,
						method_step_events: methodStepEvents,
						resume: lastResume,
					},
				}
			: {}),
	};
}
