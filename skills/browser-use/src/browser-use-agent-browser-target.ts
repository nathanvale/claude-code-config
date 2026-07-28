import type { McporterCommandResult } from "./mcporter-transport";
import type {
	AgentBrowserExecutionResult,
	AgentBrowserPostcondition,
	AgentBrowserTask,
	AgentBrowserTargetBinding,
	AgentBrowserTargetResolutionInput,
	AgentBrowserTargetResolutionResult,
} from "./browser-use-agent-browser";
import { toCandidate } from "./browser-use-core";
import { SAFE_TAB_ID } from "./browser-use-identifiers";

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
type AgentBrowserTab = {
	tabId: string;
	url: string;
	type?: string;
};
type ResolvedTabList =
	| { ok: true; tabs: AgentBrowserTab[] }
	| { ok: false; failure: ExecutionFailure };

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

function targetBindingOf(
	targetEnvelopeId: string,
	tabId: string,
): AgentBrowserTargetBinding {
	return {
		schema_version: "1",
		target_candidate_id: toCandidate(
			{ id: tabId },
			0,
			targetEnvelopeId,
			false,
		).candidate_id,
	};
}

function parseTabs(data: JsonObject): AgentBrowserTab[] | undefined {
	if (!Array.isArray(data.tabs)) return undefined;
	return data.tabs.flatMap((raw): AgentBrowserTab[] => {
		const tab = asObject(raw);
		if (
			tab === undefined ||
			typeof tab.tabId !== "string" ||
			!SAFE_TAB_ID.test(tab.tabId) ||
			typeof tab.url !== "string" ||
			(typeof tab.type === "string" && tab.type !== "page")
		) {
			return [];
		}
		return [
			{
				tabId: tab.tabId,
				url: tab.url,
				...(typeof tab.type === "string" ? { type: tab.type } : {}),
			},
		];
	});
}

async function listTabsForResolution(
	run: NativeCommand,
): Promise<ResolvedTabList> {
	let attempts = 0;
	let lastSignal = "no connection attempt completed";
	while (attempts < CONNECTION_ESTABLISH_ATTEMPTS) {
		attempts += 1;
		const listed = await run(["tab", "list", "--json"]);
		const data = parseSuccessData(listed);
		if (data !== undefined) {
			const tabs = parseTabs(data);
			return tabs === undefined
				? {
						ok: false,
						failure: failure(
							"agent_browser_target_unavailable",
							"not-achieved",
							"Agent Browser returned no typed tab list.",
						),
					}
				: { ok: true, tabs };
		}

		lastSignal =
			connectionSignalOf(listed) ?? "Agent Browser tab-list command failed";
		if (attempts < CONNECTION_ESTABLISH_ATTEMPTS) {
			await run(["get", "cdp-url", "--json"]);
		}
	}
	return {
		ok: false,
		failure: {
			...failure(
				"agent_browser_connection_unstable",
				"not-achieved",
				"Agent Browser could not hold a stable CDP link while resolving the target.",
			),
			connection: {
				attempts,
				max_attempts: CONNECTION_ESTABLISH_ATTEMPTS,
				last_signal: lastSignal,
				next_repair_action:
					"Re-mint a Verified Handoff Envelope through `browser-connect connect --json` for the agent-browser lane, then rerun.",
			},
		},
	};
}

function neutralTargetIsAllowed(
	url: string,
	steps: AgentBrowserTargetResolutionInput["steps"],
): boolean {
	return url === "about:blank" && steps[0]?.kind === "open";
}

function targetIsAdmissible(
	tab: AgentBrowserTab,
	allowedOrigins: ReadonlySet<string>,
	steps: AgentBrowserTargetResolutionInput["steps"],
): boolean {
	return (
		agentBrowserOriginIsAllowed(tab.url, allowedOrigins) ||
		neutralTargetIsAllowed(tab.url, steps)
	);
}

/**
 * Resolve one raw Agent Browser tab before durable task execution.
 *
 * The raw adapter id stays process-local. Callers persist only the returned
 * candidate binding, scoped by their target-envelope id.
 *
 * @param run - Native command seam already bound to the verified handoff
 * @param input - Origin policy, remaining steps, and exact or automatic request
 * @param allowedOrigins - Exact normalized origin policy
 * @returns One exact tab plus opaque binding, or typed repair truth
 * @internal
 */
export async function resolveAgentBrowserTarget(
	run: NativeCommand,
	input: AgentBrowserTargetResolutionInput,
	allowedOrigins: ReadonlySet<string>,
): Promise<AgentBrowserTargetResolutionResult> {
	const listed = await listTabsForResolution(run);
	if (!listed.ok) return listed.failure;
	const { tabs } = listed;

	if (input.target.kind === "exact") {
		const exactTabId = input.target.tab_id;
		const exact = tabs.find((tab) => tab.tabId === exactTabId);
		if (exact === undefined) {
			return failure(
				"agent_browser_target_unavailable",
				"not-achieved",
				"The requested tab is not present in the verified Agent Browser session.",
			);
		}
		if (!targetIsAdmissible(exact, allowedOrigins, input.steps)) {
			return failure(
				"agent_browser_target_origin_refused",
				"not-achieved",
				"The requested tab is outside the task's allowed origins.",
			);
		}
		return {
			ok: true,
			target_tab_id: exact.tabId,
			target_url: exact.url,
			binding: targetBindingOf(input.target.target_envelope_id, exact.tabId),
		};
	}

	const boundCandidateId = input.target.bound_target_candidate_id;
	if (boundCandidateId !== undefined) {
		const bound = tabs.find(
			(tab) =>
				targetBindingOf(input.target.target_envelope_id, tab.tabId)
					.target_candidate_id === boundCandidateId,
		);
		if (
			bound === undefined ||
			!targetIsAdmissible(bound, allowedOrigins, input.steps)
		) {
			return failure(
				"agent_browser_target_moved",
				"not-achieved",
				"The bound Agent Browser target is no longer present and admissible.",
			);
		}
		return {
			ok: true,
			target_tab_id: bound.tabId,
			target_url: bound.url,
			binding: targetBindingOf(input.target.target_envelope_id, bound.tabId),
		};
	}

	const admissible = tabs.filter((tab) =>
		targetIsAdmissible(tab, allowedOrigins, input.steps),
	);
	if (admissible.length === 0) {
		return failure(
			"agent_browser_target_unavailable",
			"not-achieved",
			"No admissible Agent Browser tab is available for this task.",
		);
	}
	if (admissible.length > 1) {
		return failure(
			"agent_browser_target_ambiguous",
			"not-achieved",
			"Multiple admissible Agent Browser tabs are available; select one explicitly.",
		);
	}
	const [selected] = admissible;
	if (selected === undefined) {
		return failure(
			"agent_browser_target_unavailable",
			"not-achieved",
			"No admissible Agent Browser tab is available for this task.",
		);
	}
	return {
		ok: true,
		target_tab_id: selected.tabId,
		target_url: selected.url,
		binding: targetBindingOf(input.target.target_envelope_id, selected.tabId),
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
		const tabs = parseTabs(data);
		const target = tabs?.find((tab) => tab.tabId === task.target_tab_id);
		if (target === undefined) {
			return failure(
				"agent_browser_target_unavailable",
				"not-achieved",
				"The requested tab is not present in the verified Agent Browser session.",
			);
		}
		if (
			!agentBrowserOriginIsAllowed(target.url, allowedOrigins) &&
			!(
				task.allow_neutral_target === true &&
				neutralTargetIsAllowed(target.url, task.steps)
			)
		) {
			return failure(
				"agent_browser_target_origin_refused",
				"not-achieved",
				"The requested tab is outside the task's allowed origins.",
			);
		}
		const selected = await run(["tab", task.target_tab_id, "--json"]);
		if (parseSuccessData(selected) !== undefined) {
			const reproved = parseSuccessData(await run(["get", "url", "--json"]));
			if (typeof reproved?.url !== "string") {
				return failure(
					"agent_browser_target_unavailable",
					"not-achieved",
					"Agent Browser could not freshly prove the selected tab.",
				);
			}
			const expectedTargetUrl = task.expected_target_url ?? target.url;
			if (
				reproved.url !== expectedTargetUrl ||
				(!agentBrowserOriginIsAllowed(reproved.url, allowedOrigins) &&
					!(
						task.allow_neutral_target === true &&
						neutralTargetIsAllowed(reproved.url, task.steps)
					))
			) {
				return failure(
					"agent_browser_target_moved",
					"not-achieved",
					"The selected Agent Browser target changed before execution.",
				);
			}
			return undefined;
		}
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
