// ---------------------------------------------------------------------------
// Chrome DevTools MCP task executor (release contract R9, R21; flow F6;
// platform U6 chrome portion). The debugging / performance / Lighthouse lane's
// native Implementation for the "mcporter-envelope-call" execution Interface.
//
// This is the chrome-devtools-mcp sibling of executeAgentBrowserTask
// (browser-use-agent-browser.ts): same result contract shape (confirmed /
// not-achieved / unknown outcomes, typed connection diagnostics, bounded
// no-shell runner injection), same fail-closed discipline, but driving
// chrome-devtools-mcp through the envelope-derived mcporter transport
// (browser-use-transport.ts runEnvelopeAdapterCall, R1/R2) instead of the
// agent-browser native CLI.
//
// Lane discipline (release contract R5, R9, R11):
//   - Browser Connect is the ONLY attachment owner. This consumer uses the
//     handoff's pinned probe_executable and verified endpoint verbatim, never a
//     configured mcporter server, never a self-discovered browser.
//   - The operation set is READ-ONLY debugging/performance evidence: console
//     read, network read (list + single request), a performance trace, and a
//     Lighthouse-capable performance-insight analysis. None navigate, click, or
//     mutate the page. F6's outcome is "records findings without changing
//     browser identity."
//   - Native artifacts (trace / Lighthouse output) are WRITTEN to the driver's
//     run-scoped artifact_dir by the executor (which holds the native evidence)
//     and surfaced as run artifact REFERENCES pointing at the file on disk (R21),
//     never inlined into the model-visible result. The written bytes are the
//     auth-scrubbed native evidence, never raw adapter stdout or secrets.
//
// Secret containment (R14, AE9): captured evidence is BOUNDED and auth-scrubbed.
// Console text, network URLs, and analysis text are truncated to a bounded
// budget and passed through a redactor that refuses auth material (Authorization
// / Cookie / Set-Cookie headers, bearer tokens, and query-string secret params)
// before it can reach the result. A page whose current URL is outside the task's
// allowed origins is refused before any evidence read, so cross-origin secrets
// never enter the capture path.
// ---------------------------------------------------------------------------

import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import {
	type BrowserOperationTransportResult,
	type EnvelopeAdapterCall,
	runEnvelopeAdapterCall,
} from "./browser-use-transport";
import { isExactLiveCleanHandoffProof } from "./browser-connect-profile-posture";
import type { BrowserUseRuntime } from "./browser-use-runtime";
import { SAFE_RUN_ID } from "./browser-use-identifiers";

const HANDOFF_CONTRACT_ID = "browser-connect.verified-handoff";
const HANDOFF_SCHEMA_VERSION = "3";
const SAFE_INSIGHT_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Bounded reconnect budget for the connection-establishment phase only (R23,
 * release theme "no flaky CDP connections"). A small code-owned ceiling, never
 * an unbounded loop: connection-class failures observed BEFORE any evidence
 * read are re-probed at most this many times with a liveness probe between
 * attempts, then reported as a typed connection failure with a repair action.
 * Because every operation in this lane is read-only, a reconnect can never
 * double-apply an effect — but the establishment/read split is kept identical to
 * the agent-browser executor so the two lanes share one robustness story.
 */
const CONNECTION_ESTABLISH_ATTEMPTS = 3;

/**
 * Deterministic connection-class signal substrings. mcporter surfaces a failed
 * chrome-devtools-mcp spawn or a dropped CDP link either as a non-zero-exit /
 * timed-out transport failure or as an MCP-error envelope whose text carries one
 * of these fragments. A semantic failure (adapter connected, page genuinely
 * absent) carries none of these and is never retried. `mcp error -32000` is the
 * chrome-devtools-mcp connection/transport error family; `-32602` is input
 * validation (a semantic refusal) and is deliberately absent here.
 */
const CONNECTION_FAILURE_SIGNALS = [
	"cdp websocket connect failed",
	"failed to connect to cdp",
	"websocket connect failed",
	"connection refused",
	"connection reset",
	"error sending request",
	"browser is not connected",
	"target closed",
	"mcp error -32000",
] as const;

/** Bounded per-capture evidence budget (R14/AE9): captured evidence is proof,
 *  not a page dump. Console and analysis text are truncated to this many chars;
 *  network requests to this many rows. */
const MAX_EVIDENCE_TEXT_CHARS = 4_000;
const MAX_NETWORK_ROWS = 25;

/**
 * Verified Browser Connect payload pinned to the schema this consumer knows,
 * for the chrome-devtools-mcp lane.
 */
export type ChromeTaskVerifiedHandoff = BrowserConnectHandoffPayload & {
	contract_id: string;
	schema_version: string;
};

/**
 * The chrome-devtools-mcp read-only operation set (R9, R21, F6). Each maps to
 * one chrome-devtools-mcp tool; the capability each proves is named in the
 * wiring_spec. console-read / network-read / list_pages were exercised live
 * against the running adapter on 2026-07-27 (see the process-boundary fixtures).
 * performance-trace / lighthouse-insight name the adapter's real trace tools;
 * a full live trace round-trip is operator-gated behind a Warm Chrome that
 * exposes an HTTP CDP discovery endpoint (the 2026-07-27 session's Chrome
 * returned 404 on /json/version — see REAL_NOT_CONNECTED_ERROR).
 *
 *   - console-read        -> list_console_messages   (network_inspection-class
 *                            console evidence)
 *   - network-read        -> list_network_requests   (bounded rows)
 *   - network-request     -> get_network_request     (one request by url)
 *   - performance-trace   -> performance_start_trace / performance_stop_trace
 *                            (native trace artifact)
 *   - lighthouse-insight  -> performance_analyze_insight (Lighthouse-capable
 *                            insight analysis over a captured trace)
 */
export type ChromeTaskOperation =
	| { kind: "console-read" }
	| { kind: "network-read" }
	| { kind: "network-request"; url: string }
	| {
			kind: "performance-trace";
			/** Reload the page to capture a cold trace. Read-only w.r.t. site state:
			 *  a reload of the already-loaded verified page, never a navigation to a
			 *  new origin. */
			reload: boolean;
	  }
	| { kind: "lighthouse-insight"; insight_name: string };

/**
 * The chrome-devtools-mcp Task Intents this lane serves (release contract R21,
 * R23; AE9). A narrow, code-owned subset of the shared Task Intent vocabulary
 * (owner: browser-use-run-model.ts) — kept as its own literal union so the
 * operation-set compiler cannot silently accept a non-chrome intent, and so this
 * module never imports upward into run-model. R23's fixed distinction holds
 * here: `performance-profile` (a trace) is NOT `lighthouse-audit` (an insight
 * analysis), and each compiles to a different operation set.
 */
export type ChromeTaskIntent =
	| "debug"
	| "performance-profile"
	| "lighthouse-audit";

/**
 * The default Lighthouse-capable insight the `lighthouse-audit` intent analyzes
 * when the caller names none. `LCPBreakdown` is a chrome-devtools-mcp
 * performance-insight name (Largest Contentful Paint phase breakdown) — the
 * single most load-bearing Core Web Vital for an audit baseline.
 */
export const DEFAULT_LIGHTHOUSE_INSIGHT = "LCPBreakdown";

/**
 * Compile a chrome Task Intent into its read-only operation set (R21, R23; AE9).
 * The whole point of the wave-3 gap closeout: the baseline was console-read
 * ONLY, so `performance-profile` and `lighthouse-audit` produced no trace or
 * insight artifact. This compiler makes each intent produce the evidence AE9
 * requires while keeping every operation read-only w.r.t. portal state:
 *
 *   - debug              -> console-read + network-read (bounded native evidence,
 *                           no artifact, no page mutation)
 *   - performance-profile-> a performance trace (start/stop) producing a native
 *                           trace artifact; `reload` captures a cold trace by
 *                           reloading the ALREADY-loaded verified page (never a
 *                           navigation to a new origin)
 *   - lighthouse-audit   -> a Lighthouse-capable performance-insight analysis
 *                           producing a native insight artifact
 *
 * `reload` and `insightName` are optional caller overrides; their defaults keep
 * the artifact-producing intents runnable from a bare intent. The returned set
 * is `readonly` so a caller cannot mutate a compiled plan in place.
 *
 * @param intent - A chrome Task Intent (debug / performance-profile / lighthouse-audit)
 * @param options - Optional trace reload flag and Lighthouse insight name
 * @returns The read-only operation set for the intent
 */
export function compileChromeOperationSet(
	intent: ChromeTaskIntent,
	options: { reload?: boolean; insightName?: string } = {},
): readonly ChromeTaskOperation[] {
	switch (intent) {
		case "debug":
			return [{ kind: "console-read" }, { kind: "network-read" }];
		case "performance-profile":
			return [
				{ kind: "performance-trace", reload: options.reload ?? true },
			];
		case "lighthouse-audit":
			return [
				{
					kind: "lighthouse-insight",
					insight_name: options.insightName ?? DEFAULT_LIGHTHOUSE_INSIGHT,
				},
			];
	}
}

/**
 * Complete input for one chrome-devtools-mcp debugging/performance task.
 * `target_page_id` is the numeric page id from the adapter's own `list_pages`
 * ordering under --experimentalPageIdRouting (proven live); the executor
 * re-proves the page's origin is admitted before reading any evidence.
 */
export type ChromeTask = {
	handoff: ChromeTaskVerifiedHandoff;
	run_id: string;
	target_page_id: number;
	allowed_origins: readonly string[];
	operations: readonly ChromeTaskOperation[];
	/** Absolute directory the driver created for native artifacts (R21). When
	 *  absent, artifact-producing operations fail closed rather than inlining. */
	artifact_dir?: string;
};

/** Stable chrome lane refusal codes (mirrors the agent-browser taxonomy shape). */
export type ChromeTaskExecutionFailureCode =
	| "chrome_task_handoff_invalid"
	| "chrome_task_invalid"
	| "chrome_task_connection_unstable"
	| "chrome_task_target_unavailable"
	| "chrome_task_target_origin_refused"
	| "chrome_task_command_failed"
	| "chrome_task_artifact_dir_required"
	| "chrome_task_operation_unknown";

/**
 * Inspectable evidence of what a bounded reconnect observed. Diagnostic only —
 * never a retry authority — carrying the adapter's own connection-class signal
 * verbatim so a caller can distinguish a down browser from transient flakiness.
 */
export type ChromeTaskConnectionDiagnostic = {
	attempts: number;
	max_attempts: number;
	last_signal: string;
	next_repair_action: string;
};

/** One captured, bounded, auth-scrubbed evidence finding (R9, AE9). Structural
 *  only: never a full page dump, never a raw header block. */
export type ChromeTaskEvidence =
	| { kind: "console"; message_count: number; text: string }
	| { kind: "network"; request_count: number; text: string }
	| { kind: "network-request"; text: string }
	| { kind: "analysis"; text: string };

/** One native artifact the run should persist (R21): a path reference plus its
 *  sensitivity, never inlined bytes. */
export type ChromeTaskArtifact = {
	kind: "performance-trace" | "lighthouse";
	path: string;
	sensitivity: "low" | "high";
};

/**
 * Chrome DevTools MCP execution result. Carries structural truth plus bounded
 * auth-scrubbed evidence and artifact references only — never raw adapter
 * stdout, full page text, headers, endpoints, or secrets.
 */
export type ChromeTaskExecutionResult =
	| {
			ok: true;
			outcome: "confirmed";
			executed_operations: number;
			target_page_id: number;
			evidence: readonly ChromeTaskEvidence[];
			artifacts: readonly ChromeTaskArtifact[];
	  }
	| {
			ok: false;
			code: ChromeTaskExecutionFailureCode;
			outcome: "not-achieved" | "unknown";
			message: string;
			executed_operations: number;
			/** Present only on `chrome_task_connection_unstable`. */
			connection?: ChromeTaskConnectionDiagnostic;
	  };

type JsonObject = Record<string, unknown>;
type ChromeTaskExecutionFailure = Extract<
	ChromeTaskExecutionResult,
	{ ok: false }
>;

function failure(
	code: ChromeTaskExecutionFailureCode,
	outcome: "not-achieved" | "unknown",
	message: string,
	executedOperations = 0,
): ChromeTaskExecutionFailure {
	return {
		ok: false,
		code,
		outcome,
		message,
		executed_operations: executedOperations,
	};
}

function asObject(value: unknown): JsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as JsonObject)
		: undefined;
}

// --- Envelope parsing (proven live 2026-07-27) -------------------------------
// chrome-devtools-mcp answers over mcporter as an MCP content envelope:
//   success: {"content":[{"type":"text","text":"..."}]}
//   error:   {"content":[{"type":"text","text":"MCP error -32602: ..."}],
//             "isError":true}
// This differs from the agent-browser {"success":bool,"data":...,"error":...}
// envelope — captured verbatim from a live probe so this parser cannot silently
// diverge from the real adapter.

type McpEnvelope = { text: string; isError: boolean };

function parseMcpEnvelope(stdout: string): McpEnvelope | undefined {
	try {
		const envelope = asObject(JSON.parse(stdout));
		if (envelope === undefined) return undefined;
		const content = envelope.content;
		if (!Array.isArray(content)) return undefined;
		const text = content
			.map((entry) => asObject(entry))
			.filter((entry) => entry?.type === "text" && typeof entry.text === "string")
			.map((entry) => entry?.text as string)
			.join("\n");
		return { text, isError: envelope.isError === true };
	} catch {
		return undefined;
	}
}

/**
 * Classify a transport/envelope failure as connection-class (the adapter could
 * not hold the CDP link) versus semantic (adapter connected, request
 * unsatisfiable). Only connection-class failures are eligible for bounded
 * reconnect; everything else fails closed immediately.
 *
 * @returns The matched connection signal, or undefined for a semantic failure
 */
function connectionSignalOf(
	outcome: BrowserOperationTransportResult,
): string | undefined {
	if (!outcome.ok) {
		if (outcome.failure.kind === "transport_timeout") {
			return "chrome-devtools-mcp call timed out";
		}
		// dependency_missing / command_override_invalid / execution_failed are not
		// connection-class: a missing binary or a bad override is a repair-once
		// input/dependency failure, never transient flakiness.
		return undefined;
	}
	if (outcome.result.timedOut === true) return "chrome-devtools-mcp call timed out";
	const envelope = parseMcpEnvelope(outcome.result.stdout);
	if (envelope === undefined || !envelope.isError) return undefined;
	const haystack = envelope.text.toLowerCase();
	if (CONNECTION_FAILURE_SIGNALS.some((signal) => haystack.includes(signal))) {
		return envelope.text.slice(0, 300);
	}
	return undefined;
}

/** A clean success envelope: transport ok, not timed out, MCP content present,
 *  isError false. */
function envelopeOf(
	outcome: BrowserOperationTransportResult,
): McpEnvelope | undefined {
	if (!outcome.ok || outcome.result.timedOut === true) return undefined;
	const envelope = parseMcpEnvelope(outcome.result.stdout);
	if (envelope === undefined || envelope.isError) return undefined;
	return envelope;
}

// --- Origin admission --------------------------------------------------------

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

// --- Auth-material redaction (R14, AE9) --------------------------------------
// Bounded, deterministic scrub applied to EVERY captured evidence string before
// it can reach the result. This is defense in depth on top of origin admission:
// even in-origin evidence must never carry a live credential to the model.

const REDACTED = "[redacted]";

/** Header lines that carry credentials. Matched case-insensitively at line
 *  start (chrome-devtools-mcp renders network detail as `Header: value` lines). */
const SENSITIVE_HEADER_PREFIXES = [
	"authorization:",
	"proxy-authorization:",
	"cookie:",
	"set-cookie:",
	"x-api-key:",
	"x-auth-token:",
];

/** Query-string params whose values are secrets (bearer flows, SAML, OAuth). */
const SENSITIVE_QUERY_PARAMS = new Set([
	"token",
	"access_token",
	"id_token",
	"refresh_token",
	"code",
	"client_secret",
	"samlrequest",
	"samlresponse",
	"password",
	"otp",
	"sig",
	"signature",
	"apikey",
	"api_key",
	"key",
]);

/** Bearer/basic token patterns anywhere in text. */
const BEARER_PATTERN = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

function redactUrlSecrets(text: string): string {
	// Rewrite any URL's sensitive query params to [redacted] without dropping the
	// structural URL (path/origin remain useful debugging evidence).
	return text.replace(/https?:\/\/[^\s)"']+/g, (raw) => {
		try {
			const url = new URL(raw);
			let touched = false;
			for (const [param] of [...url.searchParams]) {
				if (SENSITIVE_QUERY_PARAMS.has(param.toLowerCase())) {
					url.searchParams.set(param, REDACTED);
					touched = true;
				}
			}
			return touched ? url.toString() : raw;
		} catch {
			return raw;
		}
	});
}

/**
 * Scrub auth material from one captured evidence string (R14/AE9). Refuses
 * credential header lines, bearer/basic tokens, and secret query params, then
 * bounds the result. Deterministic and side-effect free so the same input
 * always yields the same scrubbed evidence.
 *
 * @param raw - Adapter-rendered evidence text
 * @param maxChars - Bounded budget (default MAX_EVIDENCE_TEXT_CHARS)
 * @returns Bounded, auth-scrubbed evidence text
 */
export function scrubEvidence(
	raw: string,
	maxChars = MAX_EVIDENCE_TEXT_CHARS,
): string {
	const lines = raw.split("\n").map((line) => {
		const lower = line.toLowerCase().trimStart();
		if (SENSITIVE_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
			const colon = line.indexOf(":");
			return colon >= 0 ? `${line.slice(0, colon + 1)} ${REDACTED}` : REDACTED;
		}
		return line;
	});
	let scrubbed = lines.join("\n");
	scrubbed = redactUrlSecrets(scrubbed);
	scrubbed = scrubbed.replace(BEARER_PATTERN, (match) => {
		const [scheme] = match.split(/\s+/, 1);
		return `${scheme} ${REDACTED}`;
	});
	if (scrubbed.length > maxChars) {
		scrubbed = `${scrubbed.slice(0, maxChars)}\n[truncated]`;
	}
	return scrubbed;
}

/** Bound console/network text to N rows before scrubbing so a huge log cannot
 *  blow the budget purely on row count. */
function boundRows(text: string, maxRows: number): { text: string; count: number } {
	const rows = text.split("\n").filter((line) => line.trim().length > 0);
	const kept = rows.slice(0, maxRows);
	return {
		text: kept.join("\n"),
		count: rows.length,
	};
}

// --- Adapter call construction ----------------------------------------------

function callFor(
	task: ChromeTask,
	tool: string,
	args: JsonObject,
): EnvelopeAdapterCall {
	return {
		probeExecutable: task.handoff.attachment.probe_executable,
		endpointHttp: task.handoff.endpoint.http,
		tool,
		argsJson: JSON.stringify(args),
	};
}

async function runTool(
	runtime: BrowserUseRuntime,
	task: ChromeTask,
	tool: string,
	args: JsonObject,
): Promise<BrowserOperationTransportResult> {
	return runEnvelopeAdapterCall(runtime, callFor(task, tool, args));
}

// --- Validation --------------------------------------------------------------

function validateTask(
	task: ChromeTask,
):
	| { ok: true; allowedOrigins: ReadonlySet<string> }
	| ChromeTaskExecutionFailure {
	if (
		task.handoff.contract_id !== HANDOFF_CONTRACT_ID ||
		task.handoff.schema_version !== HANDOFF_SCHEMA_VERSION ||
		task.handoff.outcome !== "verified" ||
		task.handoff.attachment.adapter_id !== "chrome-devtools-mcp" ||
		task.handoff.attachment.route !== "explicit-cdp" ||
		task.handoff.browser_entry_mode !== "explicit-cdp" ||
		task.handoff.proof.route_evidence !== "verified-live" ||
		!isExactLiveCleanHandoffProof(task.handoff) ||
		task.handoff.attachment.probe_executable.length === 0 ||
		task.handoff.endpoint.http.length === 0
	) {
		return failure(
			"chrome_task_handoff_invalid",
			"not-achieved",
			"Chrome DevTools MCP execution requires a schema-3 verified-live Browser Connect handoff with live-clean profile posture for the chrome-devtools-mcp lane.",
		);
	}
	if (
		!SAFE_RUN_ID.test(task.run_id) ||
		!Number.isInteger(task.target_page_id) ||
		task.target_page_id < 0
	) {
		return failure(
			"chrome_task_invalid",
			"not-achieved",
			"Run identity must be a bounded safe identifier and the target page id a non-negative integer.",
		);
	}
	const allowedOrigins = allowedOriginSet(task.allowed_origins);
	if (allowedOrigins === undefined) {
		return failure(
			"chrome_task_invalid",
			"not-achieved",
			"At least one exact HTTP(S) origin is required.",
		);
	}
	return { ok: true, allowedOrigins };
}

// --- Connection establishment + origin proof (bounded reconnect) -------------

type SelectPageOutcome =
	| { kind: "attached" }
	| { kind: "connection-unstable"; signal: string }
	| { kind: "refused"; failure: ChromeTaskExecutionFailure };

/**
 * Prove the target page exists in the adapter's own list and its current origin
 * is admitted, before any evidence read (R12 origin-proof discipline). Parses
 * the proven-live `list_pages` text envelope: each page renders as
 * `<pageId>: <title> (<url>) [selected]?`.
 */
async function selectPageOnce(
	runtime: BrowserUseRuntime,
	task: ChromeTask,
	allowedOrigins: ReadonlySet<string>,
): Promise<SelectPageOutcome> {
	const listed = await runTool(runtime, task, "list_pages", {});
	const signal = connectionSignalOf(listed);
	if (signal !== undefined) return { kind: "connection-unstable", signal };
	const envelope = envelopeOf(listed);
	if (envelope === undefined) {
		return {
			kind: "refused",
			failure: failure(
				"chrome_task_target_unavailable",
				"not-achieved",
				"Chrome DevTools MCP could not list pages through the verified handoff.",
			),
		};
	}
	const url = pageUrlFromListing(envelope.text, task.target_page_id);
	if (url === undefined) {
		return {
			kind: "refused",
			failure: failure(
				"chrome_task_target_unavailable",
				"not-achieved",
				"The requested page id is not present in the verified Chrome DevTools MCP session.",
			),
		};
	}
	if (!originIsAllowed(url, allowedOrigins)) {
		return {
			kind: "refused",
			failure: failure(
				"chrome_task_target_origin_refused",
				"not-achieved",
				"The requested page is outside the task's allowed origins.",
			),
		};
	}
	return { kind: "attached" };
}

/**
 * Extract the current URL of one page id from a `list_pages` text envelope.
 * Lines look like: `1: some title (http://host/path) [selected]`. The URL is the
 * last parenthesized `http(s)://…` group on the matching id's line.
 *
 * @returns The page's URL, or undefined when the id is absent / unparsable
 */
export function pageUrlFromListing(
	listingText: string,
	pageId: number,
): string | undefined {
	for (const line of listingText.split("\n")) {
		const match = line.match(/^\s*(\d+):\s*(.*)$/);
		if (match === null || Number(match[1]) !== pageId) continue;
		const urlMatch = match[2]?.match(/\((https?:\/\/[^)]+)\)/);
		return urlMatch?.[1];
	}
	return undefined;
}

async function selectPage(
	runtime: BrowserUseRuntime,
	task: ChromeTask,
	allowedOrigins: ReadonlySet<string>,
): Promise<ChromeTaskExecutionFailure | undefined> {
	let attempts = 0;
	let lastSignal = "no connection attempt completed";
	while (attempts < CONNECTION_ESTABLISH_ATTEMPTS) {
		attempts += 1;
		const outcome = await selectPageOnce(runtime, task, allowedOrigins);
		if (outcome.kind === "attached") return undefined;
		if (outcome.kind === "refused") return outcome.failure;
		lastSignal = outcome.signal;
		if (attempts < CONNECTION_ESTABLISH_ATTEMPTS) {
			// Liveness probe between attempts: evidence of whether the CDP link
			// recovered, never a success authority (a re-list is itself read-only).
			await runTool(runtime, task, "list_pages", {});
		}
	}
	return {
		ok: false,
		code: "chrome_task_connection_unstable",
		outcome: "not-achieved",
		message:
			"Chrome DevTools MCP could not hold a stable CDP link to the verified endpoint after a bounded reconnect; inspect the connection diagnostic before retry.",
		executed_operations: 0,
		connection: {
			attempts,
			max_attempts: CONNECTION_ESTABLISH_ATTEMPTS,
			last_signal: lastSignal,
			next_repair_action:
				"Re-mint a Verified Handoff Envelope through `browser-connect connect chrome-devtools-mcp --json`, then rerun; a persistent connection failure means Warm Chrome is unready and needs a Browser Entry Handoff.",
		},
	};
}

// --- Operation execution -----------------------------------------------------

type OperationOutcome =
	| { kind: "evidence"; evidence: ChromeTaskEvidence }
	| { kind: "artifact"; evidence: ChromeTaskEvidence; artifact: ChromeTaskArtifact }
	| { kind: "failure"; failure: ChromeTaskExecutionFailure };

async function runOperation(
	runtime: BrowserUseRuntime,
	task: ChromeTask,
	op: ChromeTaskOperation,
	executedSoFar: number,
): Promise<OperationOutcome> {
	const pageId = task.target_page_id;

	if (op.kind === "console-read") {
		const outcome = await runTool(runtime, task, "list_console_messages", {
			pageId,
		});
		const envelope = envelopeOf(outcome);
		if (envelope === undefined) {
			return commandOutcome(outcome, executedSoFar, "read console messages");
		}
		const bounded = boundRows(envelope.text, MAX_NETWORK_ROWS);
		return {
			kind: "evidence",
			evidence: {
				kind: "console",
				message_count: bounded.count,
				text: scrubEvidence(bounded.text),
			},
		};
	}

	if (op.kind === "network-read") {
		const outcome = await runTool(runtime, task, "list_network_requests", {
			pageId,
			pageSize: MAX_NETWORK_ROWS,
		});
		const envelope = envelopeOf(outcome);
		if (envelope === undefined) {
			return commandOutcome(outcome, executedSoFar, "read network requests");
		}
		const bounded = boundRows(envelope.text, MAX_NETWORK_ROWS);
		return {
			kind: "evidence",
			evidence: {
				kind: "network",
				request_count: bounded.count,
				text: scrubEvidence(bounded.text),
			},
		};
	}

	if (op.kind === "network-request") {
		const outcome = await runTool(runtime, task, "get_network_request", {
			pageId,
			url: op.url,
		});
		const envelope = envelopeOf(outcome);
		if (envelope === undefined) {
			return commandOutcome(outcome, executedSoFar, "read a network request");
		}
		return {
			kind: "evidence",
			evidence: { kind: "network-request", text: scrubEvidence(envelope.text) },
		};
	}

	if (op.kind === "performance-trace") {
		if (task.artifact_dir === undefined) {
			return {
				kind: "failure",
				failure: failure(
					"chrome_task_artifact_dir_required",
					"not-achieved",
					"A performance trace produces a native artifact and requires an artifact directory; the driver must create one before dispatch.",
					executedSoFar,
				),
			};
		}
		// start_trace + stop_trace: the trace summary lands in the envelope text.
		// The executor holds the native trace evidence here, so it WRITES the
		// scrubbed capture to the derived path (the artifact reference then points
		// at a file that exists). The path is derived, not adapter-returned, so no
		// adapter stdout is trusted for filesystem paths.
		const started = await runTool(runtime, task, "performance_start_trace", {
			pageId,
			reload: op.reload,
			autoStop: false,
		});
		if (connectionSignalOf(started) !== undefined || envelopeOf(started) === undefined) {
			return commandOutcome(started, executedSoFar, "start a performance trace");
		}
		const stopped = await runTool(runtime, task, "performance_stop_trace", {
			pageId,
		});
		const envelope = envelopeOf(stopped);
		if (envelope === undefined) {
			return commandOutcome(stopped, executedSoFar, "stop the performance trace");
		}
		const scrubbed = scrubEvidence(envelope.text);
		const path = `${task.artifact_dir}/${task.run_id}-perf-trace.json`;
		return persistArtifactOutcome(
			runtime,
			task.artifact_dir,
			path,
			scrubbed,
			{ kind: "performance-trace", path, sensitivity: "high" },
			executedSoFar,
			"persist the performance trace",
		);
	}

	if (op.kind === "lighthouse-insight") {
		if (task.artifact_dir === undefined) {
			return {
				kind: "failure",
				failure: failure(
					"chrome_task_artifact_dir_required",
					"not-achieved",
					"A Lighthouse-capable insight analysis produces a native artifact and requires an artifact directory; the driver must create one before dispatch.",
					executedSoFar,
				),
			};
		}
		// insight_name is caller-supplied and lands verbatim in the artifact path
		// below; a value with `/` or `..` would escape the run artifact directory.
		// Bound it to a safe identifier BEFORE it reaches the path.
		if (!SAFE_INSIGHT_NAME.test(op.insight_name)) {
			return {
				kind: "failure",
				failure: failure(
					"chrome_task_invalid",
					"not-achieved",
					"The requested insight name is not a bounded safe identifier.",
					executedSoFar,
				),
			};
		}
		const outcome = await runTool(runtime, task, "performance_analyze_insight", {
			pageId,
			insightName: op.insight_name,
		});
		const envelope = envelopeOf(outcome);
		if (envelope === undefined) {
			return commandOutcome(outcome, executedSoFar, "analyze a performance insight");
		}
		const scrubbed = scrubEvidence(envelope.text);
		const path = `${task.artifact_dir}/${task.run_id}-lighthouse-${op.insight_name}.json`;
		return persistArtifactOutcome(
			runtime,
			task.artifact_dir,
			path,
			scrubbed,
			{ kind: "lighthouse", path, sensitivity: "high" },
			executedSoFar,
			"persist the performance insight",
		);
	}

	return {
		kind: "failure",
		failure: failure(
			"chrome_task_operation_unknown",
			"not-achieved",
			"The requested operation is not a code-owned Chrome DevTools MCP operation.",
			executedSoFar,
		),
	};
}

/**
 * Persist one native artifact to disk and return the artifact outcome. The
 * executor holds the trace/insight evidence at this point, so it owns the write:
 * `scrubbed` is the already-auth-scrubbed native evidence (never the raw
 * envelope, never inlined secrets), which becomes the on-disk artifact bytes so
 * the returned artifact reference points at a file that now exists (R21). The
 * write goes through the runtime's owner-only atomic writeTextFile; a failed
 * write fails closed as a command failure rather than advertising a path with no
 * file behind it.
 */
async function persistArtifactOutcome(
	runtime: BrowserUseRuntime,
	artifactDir: string,
	path: string,
	scrubbed: string,
	artifact: ChromeTaskArtifact,
	executedSoFar: number,
	what: string,
): Promise<OperationOutcome> {
	try {
		await runtime.ensureDirectory(artifactDir);
		await runtime.writeTextFile(path, scrubbed);
	} catch {
		return {
			kind: "failure",
			failure: failure(
				"chrome_task_command_failed",
				"not-achieved",
				`Chrome DevTools MCP could not ${what} to the run artifact directory.`,
				executedSoFar,
			),
		};
	}
	return {
		kind: "artifact",
		evidence: { kind: "analysis", text: scrubbed },
		artifact,
	};
}

/**
 * Map a failed read to a typed outcome. Every operation in this lane is
 * READ-ONLY, so a failed read never left an unknown external effect — it is
 * always `not-achieved`, never `unknown`. A connection-class failure surfaced
 * mid-task is reported as a command failure (the establishment phase owns the
 * reconnect budget); a semantic failure is a plain command failure.
 */
function commandOutcome(
	outcome: BrowserOperationTransportResult,
	executedSoFar: number,
	what: string,
): OperationOutcome {
	return {
		kind: "failure",
		failure: failure(
			"chrome_task_command_failed",
			"not-achieved",
			`Chrome DevTools MCP could not ${what} through the verified handoff.`,
			executedSoFar,
		),
	};
}

/**
 * Execute one bounded Chrome DevTools MCP debugging/performance task (R9, R21,
 * F6).
 *
 * Browser Connect remains the only attachment owner: this consumer drives
 * chrome-devtools-mcp through the envelope-derived mcporter transport using the
 * handed-off binary and endpoint verbatim, proves the target page's origin is
 * admitted before any read, runs only the read-only debugging/performance
 * operation set, scrubs auth material from every captured evidence string (R14),
 * and surfaces native trace / Lighthouse output as artifact references (R21) —
 * never inlined bytes or raw adapter stdout.
 *
 * @param runtime - Browser Use runtime carrying the no-shell command runner
 * @param task - Verified handoff, target page, origin policy, and operations
 * @returns Structural task truth plus bounded evidence and artifact references
 *
 * @example
 * ```ts
 * const result = await executeChromeTask(runtime, task)
 * if (result.ok) persistArtifacts(result.artifacts)
 * ```
 */
export async function executeChromeTask(
	runtime: BrowserUseRuntime,
	task: ChromeTask,
): Promise<ChromeTaskExecutionResult> {
	const validation = validateTask(task);
	if (!validation.ok) return validation;

	const targetFailure = await selectPage(
		runtime,
		task,
		validation.allowedOrigins,
	);
	if (targetFailure !== undefined) return targetFailure;

	const evidence: ChromeTaskEvidence[] = [];
	const artifacts: ChromeTaskArtifact[] = [];
	let executedOperations = 0;
	for (const op of task.operations) {
		const outcome = await runOperation(runtime, task, op, executedOperations);
		if (outcome.kind === "failure") return outcome.failure;
		evidence.push(outcome.evidence);
		if (outcome.kind === "artifact") artifacts.push(outcome.artifact);
		executedOperations += 1;
	}

	return {
		ok: true,
		outcome: "confirmed",
		executed_operations: executedOperations,
		target_page_id: task.target_page_id,
		evidence,
		artifacts,
	};
}
