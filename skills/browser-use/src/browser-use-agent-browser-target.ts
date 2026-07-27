import type { McporterCommandResult } from "./mcporter-transport";
import type {
	AgentBrowserExecutionResult,
	AgentBrowserPostcondition,
	AgentBrowserTask,
} from "./browser-use-agent-browser";

const CONNECTION_ESTABLISH_ATTEMPTS = 3;
const CONNECTION_FAILURE_SIGNALS = [
	"cdp websocket connect failed",
	"cdp discovery methods failed",
	"failed to connect to cdp",
	"websocket connect failed",
	"connection refused",
	"connection reset",
	"error sending request",
] as const;

type JsonObject = Record<string, unknown>;
type ExecutionFailure = Extract<AgentBrowserExecutionResult, { ok: false }>;
type NativeCommand = (
	args: readonly string[],
) => Promise<McporterCommandResult | undefined>;

function asObject(value: unknown): JsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as JsonObject)
		: undefined;
}

function parseSuccessData(
	result: McporterCommandResult | undefined,
): JsonObject | undefined {
	if (
		result === undefined ||
		result.exitCode !== 0 ||
		result.timedOut === true
	) {
		return undefined;
	}
	try {
		const envelope = asObject(JSON.parse(result.stdout));
		return envelope?.success === true ? asObject(envelope.data) : undefined;
	} catch {
		return undefined;
	}
}

function connectionSignalOf(
	result: McporterCommandResult | undefined,
): string | undefined {
	if (result === undefined) return "adapter invocation failed";
	if (result.timedOut === true) return "cdp command timed out";
	try {
		const envelope = asObject(JSON.parse(result.stdout));
		if (envelope?.success !== false || typeof envelope.error !== "string") {
			return undefined;
		}
		const errorText = envelope.error;
		return CONNECTION_FAILURE_SIGNALS.some((signal) =>
			errorText.toLowerCase().includes(signal),
		)
			? errorText
			: undefined;
	} catch {
		return undefined;
	}
}

function failure(
	code: ExecutionFailure["code"],
	outcome: ExecutionFailure["outcome"],
	message: string,
): ExecutionFailure {
	return {
		ok: false,
		code,
		outcome,
		message,
		executed_steps: 0,
		mutation_dispatched: false,
	};
}

/**
 * Normalize and admit the exact HTTP(S) origins carried by a task.
 *
 * @param origins - Candidate task origins
 * @returns Exact normalized origins, or undefined for malformed input
 * @internal
 */
export function agentBrowserAllowedOriginSet(
	origins: readonly string[],
): Set<string> | undefined {
	if (origins.length === 0) return undefined;
	const normalized = new Set<string>();
	for (const origin of origins) {
		try {
			const parsed = new URL(origin);
			if (
				(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
				parsed.origin !== origin
			) {
				return undefined;
			}
			normalized.add(parsed.origin);
		} catch {
			return undefined;
		}
	}
	return normalized;
}

/**
 * Check one URL against an exact admitted-origin set.
 *
 * @param value - Candidate page URL
 * @param allowed - Exact admitted origins
 * @returns True only when the URL parses to an admitted HTTP(S) origin
 * @internal
 */
export function agentBrowserOriginIsAllowed(
	value: string,
	allowed: ReadonlySet<string>,
): boolean {
	try {
		return allowed.has(new URL(value).origin);
	} catch {
		return false;
	}
}

/**
 * Check one page URL against one exact expected origin.
 *
 * @param value - Candidate page URL
 * @param expectedOrigin - Exact origin bound to a reviewed action
 * @returns True only for an exact origin match
 * @internal
 */
export function agentBrowserHasExactOrigin(
	value: string,
	expectedOrigin: string,
): boolean {
	try {
		return new URL(value).origin === expectedOrigin;
	} catch {
		return false;
	}
}

/**
 * Attach to the named tab with bounded connection-only retries.
 *
 * @param run - Native command seam already bound to the verified handoff
 * @param task - Task carrying the selected tab identity
 * @param allowedOrigins - Exact task origin policy
 * @returns A typed refusal, or undefined after attachment
 * @internal
 */
export async function selectAgentBrowserTarget(
	run: NativeCommand,
	task: AgentBrowserTask,
	allowedOrigins: ReadonlySet<string>,
): Promise<ExecutionFailure | undefined> {
	let attempts = 0;
	let lastSignal = "no connection attempt completed";
	while (attempts < CONNECTION_ESTABLISH_ATTEMPTS) {
		attempts += 1;
		const listed = await run(["tab", "list", "--json"]);
		const data = parseSuccessData(listed);
		if (data === undefined) {
			const signal = connectionSignalOf(listed);
			if (signal === undefined) {
				return failure(
					"agent_browser_target_unavailable",
					"not-achieved",
					"Agent Browser could not list tabs through the verified handoff.",
				);
			}
			lastSignal = signal;
			if (attempts < CONNECTION_ESTABLISH_ATTEMPTS) {
				await run(["get", "cdp-url", "--json"]);
				continue;
			}
			return {
				...failure(
					"agent_browser_connection_unstable",
					"not-achieved",
					"Agent Browser could not hold a stable CDP link to the verified endpoint after a bounded reconnect; inspect the connection diagnostic before retry.",
				),
				connection: {
					attempts,
					max_attempts: CONNECTION_ESTABLISH_ATTEMPTS,
					last_signal: lastSignal,
					next_repair_action:
						"Re-mint a Verified Handoff Envelope through `browser-connect connect --json` for the agent-browser lane, then rerun; a persistent connection failure means Warm Chrome is unready and needs a Browser Entry Handoff.",
				},
			};
		}
		if (!Array.isArray(data.tabs)) {
			return failure(
				"agent_browser_target_unavailable",
				"not-achieved",
				"Agent Browser returned no typed tab list.",
			);
		}
		const target = data.tabs
			.map((tab) => asObject(tab))
			.find((tab) => tab?.tabId === task.target_tab_id);
		if (target === undefined || typeof target.url !== "string") {
			return failure(
				"agent_browser_target_unavailable",
				"not-achieved",
				"The requested tab is not present in the verified Agent Browser session.",
			);
		}
		if (!agentBrowserOriginIsAllowed(target.url, allowedOrigins)) {
			return failure(
				"agent_browser_target_origin_refused",
				"not-achieved",
				"The requested tab is outside the task's allowed origins.",
			);
		}
		const selected = await run(["tab", task.target_tab_id, "--json"]);
		if (parseSuccessData(selected) !== undefined) return undefined;
		const signal = connectionSignalOf(selected);
		if (signal === undefined) {
			return failure(
				"agent_browser_target_unavailable",
				"not-achieved",
				"Agent Browser could not explicitly select the requested tab.",
			);
		}
		lastSignal = signal;
		if (attempts < CONNECTION_ESTABLISH_ATTEMPTS) {
			await run(["get", "cdp-url", "--json"]);
			continue;
		}
	}
	return {
		...failure(
			"agent_browser_connection_unstable",
			"not-achieved",
			"Agent Browser could not hold a stable CDP link to the verified endpoint after a bounded reconnect; inspect the connection diagnostic before retry.",
		),
		connection: {
			attempts,
			max_attempts: CONNECTION_ESTABLISH_ATTEMPTS,
			last_signal: lastSignal,
			next_repair_action:
				"Re-mint a Verified Handoff Envelope through `browser-connect connect --json` for the agent-browser lane, then rerun; a persistent connection failure means Warm Chrome is unready and needs a Browser Entry Handoff.",
		},
	};
}

/**
 * Freshly prove the selected tab still belongs to an admitted origin.
 *
 * @param run - Native command seam already bound to the selected tab
 * @param allowedOrigins - Exact task origin policy
 * @returns Allowed, refused, or unavailable proof truth
 * @internal
 */
export async function reproveAgentBrowserOrigin(
	run: NativeCommand,
	allowedOrigins: ReadonlySet<string>,
): Promise<"allowed" | "refused" | "unavailable"> {
	const data = parseSuccessData(await run(["get", "url", "--json"]));
	if (typeof data?.url !== "string") return "unavailable";
	return agentBrowserOriginIsAllowed(data.url, allowedOrigins)
		? "allowed"
		: "refused";
}

/**
 * Verify one declared postcondition only from freshly admitted page structure.
 *
 * @param run - Native command seam already bound to the selected tab
 * @param postcondition - Structural truth requested by the task
 * @param allowedOrigins - Exact task origin policy
 * @returns Confirmed, not-achieved, or unavailable structural truth
 * @internal
 */
export async function verifyAgentBrowserPostcondition(
	run: NativeCommand,
	postcondition: AgentBrowserPostcondition,
	allowedOrigins: ReadonlySet<string>,
): Promise<"confirmed" | "not-achieved" | "unavailable"> {
	if (postcondition.kind === "url-equals") {
		if (!agentBrowserOriginIsAllowed(postcondition.url, allowedOrigins)) {
			return "not-achieved";
		}
		const data = parseSuccessData(await run(["get", "url", "--json"]));
		if (
			typeof data?.url !== "string" ||
			!agentBrowserOriginIsAllowed(data.url, allowedOrigins)
		) {
			return "unavailable";
		}
		return data.url === postcondition.url ? "confirmed" : "not-achieved";
	}
	if (
		postcondition.selector.startsWith("@") ||
		postcondition.selector.trim() === ""
	) {
		return "not-achieved";
	}
	if ((await reproveAgentBrowserOrigin(run, allowedOrigins)) !== "allowed") {
		return "unavailable";
	}
	const data =
		postcondition.kind === "value-equals"
			? parseSuccessData(
					await run(["get", "value", postcondition.selector, "--json"]),
				)
			: parseSuccessData(
					await run(["is", "visible", postcondition.selector, "--json"]),
				);
	if (data === undefined) return "unavailable";
	if (postcondition.kind === "value-equals") {
		return data.value === postcondition.value ? "confirmed" : "not-achieved";
	}
	return data.visible === true ? "confirmed" : "not-achieved";
}
