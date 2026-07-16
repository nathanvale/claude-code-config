// ---------------------------------------------------------------------------
// Browser Target Discovery (plan U5, evidence re-based in migration U1).
//
// Owns the targets-list workflow: read the browser-connect Verified Handoff
// Envelope through the runtime, derive browser-use's binding identity from its
// fields (KTD1), project raw pages into display-safe candidates, and emit the
// discovery success/failure envelopes. Imports down into core (substrate),
// runtime (I/O port), and transport (mcporter). The driver calls runTargetsList
// from here; selection and operations read discovery's envelope parser.
// ---------------------------------------------------------------------------

import {
	type CliWriter,
	type RuntimeActionGuidance,
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_TRANSPORT_ADAPTERS,
	BROWSER_CONNECT_ATTACHMENT_ADAPTERS,
	BROWSER_CONNECT_HANDOFF_CONTRACT_ID,
	BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION,
	BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES,
	BROWSER_USE_TARGETS_CONTRACT_ID,
	BROWSER_USE_TARGETS_SCHEMA_VERSION,
	browserUseTargetDiscoveryFailureActions,
	browserUseTargetDiscoverySuccessActions,
} from "./command-contract";
import type {
	AdapterCapability,
	BrowserAdapterId,
	TargetDiscoveryBinding,
	TargetDiscoveryEnvelope,
	TargetDiscoveryMode,
} from "./browser-adapter-router-model";
import type { ParsedBrowserUseCommand } from "./browser-use-parser";
import {
	type Failure,
	type OutputMode,
	type RawPage,
	TARGET_DISCOVERY_EXIT_CODE,
	USAGE_EXIT_CODE,
	actionFor,
	handoffEvidenceIdOf,
	isJsonObject,
	parseUrlSafe,
	redactUnsafeText,
	safeJsonObject,
	stringField,
	targetEnvelopeIdOf,
	toCandidate,
} from "./browser-use-core";
import {
	type BrowserOperationTransportFailure,
	runBrowserUseMcporter,
} from "./browser-use-transport";
import type { BrowserUseRuntime } from "./browser-use-runtime";
import { retryabilityForRecoverability } from "./runtime-error-retryability";

// ---------------------------------------------------------------------------
// `browser-use targets list` discovers Browser Target Candidates in two modes:
//   - recovery (R2, R20): requested adapter + optional handoff evidence
//     (verified envelope, a connect failure state, or explicit no-evidence
//     entry). Candidates are evidence-gathering only; they never feed `targets
//     select` or `operate` (R25). handoff_bound/operation_ready = false.
//   - handoff-bound (R1, R20): a verified handoff envelope for the attached
//     adapter. Candidates are operation-ready and carry the identity slice.
//
// Privacy is a release gate (R32, KTD7): query strings, fragments, auth-bearing
// path segments, adapter page ids, CDP target ids, and WebSocket debugger URLs
// never reach JSON, logs, or diagnostics. The envelope's verified ws endpoint
// participates in the evidence hash but is never re-emitted. Public candidate
// facts are the ordinal, a derived candidate id, a redacted origin, an optional
// redacted path shape (--show-url only), and a length-bounded title.
//
// Each failure outcome (invalid/failed/drift-rejected envelope, adapter
// mismatch, run mismatch, empty candidate set, transport timeout/dependency/
// override) maps to its own code and continuation action — never silently to
// success or the wrong recovery.
// ---------------------------------------------------------------------------

const TARGET_DISCOVERY_DEPENDENCY_EXIT_CODE = 1;

type TargetDiscoveryActionId =
	| (typeof browserUseTargetDiscoveryFailureActions)[number]["id"]
	| (typeof browserUseTargetDiscoverySuccessActions)[number]["id"];

const targetDiscoveryActions = [
	...browserUseTargetDiscoveryFailureActions,
	...browserUseTargetDiscoverySuccessActions,
] as const;
const targetDiscoveryActionById = new Map(
	targetDiscoveryActions.map((action) => [action.id, action]),
);

// Shared failure record. actionId is the only axis that varies per surface;
// the recoverability literal is owned here once.
export type TargetDiscoveryFailure = Failure<TargetDiscoveryActionId>;

// Binding facts derived from a verified handoff envelope (KTD1). Consumed by
// discovery, selection cross-checks, and operations; envelope fields that are
// not binding-relevant are never re-emitted.
export type HandoffFacts = {
	// browser-use adapter id (mcporter server name) the attachment maps to.
	adapter: BrowserAdapterId;
	// browser-connect attachment adapter id, verbatim (e.g. chrome-devtools-mcp).
	attachmentAdapterId: string;
	// Outer envelope run id (facade-owned, caller-suppliable via --run-id).
	runId: string;
	// host:port of the verified endpoint, derived from endpoint.http.
	verifiedEndpointIdentity: string;
	// browser-use's content hash over the envelope's binding-relevant fields.
	handoffEvidenceId: string;
	// Operation capabilities browser-use authorizes for the mapped adapter.
	authorizedCapabilities: readonly AdapterCapability[];
};

export async function runTargetsList(input: {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	runIdExplicit: boolean;
	durationMs: () => number;
}): Promise<number> {
	const { parsed, runtime } = input;
	const flags = parsed.flagValues;
	const fail = (failure: TargetDiscoveryFailure) =>
		emitTargetDiscoveryFailure({
			failure,
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});

	const modeRaw = flags["--mode"];
	if (modeRaw !== "recovery" && modeRaw !== "handoff-bound") {
		return fail(
			usageDiscoveryFailure(
				"targets list requires --mode recovery or --mode handoff-bound.",
			),
		);
	}
	const mode: TargetDiscoveryMode = modeRaw;

	// Resolve the requested adapter and the handoff-derived binding facts per
	// mode, then fail closed on any adapter or run mismatch (R9-era rigor).
	let requestedAdapter: BrowserAdapterId;
	let handoff: HandoffFacts | undefined;
	let runId = input.runId;
	if (mode === "handoff-bound") {
		const handoffPath = flags["--handoff"];
		if (!handoffPath) {
			return fail(
				handoffInvalidFailure(
					"handoff-bound targets list requires --handoff <path>",
				),
			);
		}
		const parse = await readHandoffFacts(runtime, handoffPath);
		if (!parse.ok) return fail(parse.failure);
		if (parse.kind === "failed") {
			return fail(
				handoffInvalidFailure(
					"the supplied envelope is a browser-connect failure envelope; it authorizes no attachment",
				),
			);
		}
		handoff = parse.facts;
		// A supplied --adapter (a recovery-mode flag) that contradicts the
		// envelope's attached adapter is a caller mistake. The envelope is
		// authoritative, but silently discarding the contradiction would mask the
		// error; fail closed.
		const pinnedAdapter = flags["--adapter"];
		if (pinnedAdapter && pinnedAdapter !== handoff.adapter) {
			return fail(
				usageDiscoveryFailure(
					`--adapter ${pinnedAdapter} contradicts the handoff envelope's attached adapter ${handoff.adapter}; omit --adapter in handoff-bound mode.`,
				),
			);
		}
		// One run id threads the chain (R3): an explicitly asserted run id must be
		// the envelope's run id; with no explicit run id the envelope's run id is
		// inherited and correlates the run end to end.
		if (input.runIdExplicit && input.runId !== handoff.runId) {
			return fail({
				code: "target_discovery_run_mismatch",
				message:
					"The asserted --run-id does not match the handoff envelope's run id.",
				actionId: "supply_verified_handoff",
				exitCode: TARGET_DISCOVERY_EXIT_CODE,
				recoverability: "change_input",
			});
		}
		requestedAdapter = handoff.adapter;
		runId = handoff.runId;
	} else {
		const adapter = flags["--adapter"];
		if (!isKnownAdapterId(adapter)) {
			return fail(
				usageDiscoveryFailure(
					"recovery-mode targets list requires --adapter <id>.",
				),
			);
		}
		requestedAdapter = adapter;
		// Recovery evidence is optional (R2): a verified envelope binds identity
		// facts; a connect failure envelope is accepted as evidence of attempted
		// entry; no --handoff at all is an explicit no-evidence entry.
		const handoffPath = flags["--handoff"];
		if (handoffPath) {
			const parse = await readHandoffFacts(runtime, handoffPath);
			if (!parse.ok) return fail(parse.failure);
			if (parse.kind === "verified") {
				if (parse.facts.adapter !== adapter) {
					return fail({
						code: "target_discovery_handoff_mismatch",
						message: `The supplied handoff envelope attaches ${parse.facts.adapter}, not the requested ${adapter}.`,
						actionId: "refresh_verified_handoff",
						exitCode: TARGET_DISCOVERY_EXIT_CODE,
						recoverability: "change_input",
					});
				}
				handoff = parse.facts;
			}
		}
	}

	// Discover live Browser Targets through the adapter.
	const discovery = await discoverPages(runtime, requestedAdapter);
	if (!discovery.ok) return fail(discovery.failure);

	const showUrl = flags["--show-url"] !== undefined;
	const targetEnvelopeId = targetEnvelopeIdOf({
		runId,
		mode,
		adapter: requestedAdapter,
		handoffEvidenceId: handoff?.handoffEvidenceId,
	});
	// Keep only navigable http(s) Browser Targets. Non-navigable surfaces (ws://
	// debugger, devtools://, chrome://) are not public targets; dropping them
	// before ordinal assignment keeps ordinals dense and transport handles out of
	// the candidate set entirely (R32).
	const navigablePages = discovery.pages.filter((page) =>
		parseUrlSafe(page.url),
	);
	const candidates = navigablePages.map((page, index) =>
		toCandidate(page, index, targetEnvelopeId, showUrl),
	);

	if (candidates.length === 0) {
		return fail({
			code: "target_discovery_no_candidates",
			message:
				"No Browser Target Candidates were discovered through the attached adapter.",
			actionId: "open_browser_target",
			exitCode: TARGET_DISCOVERY_EXIT_CODE,
			recoverability: "retry",
		});
	}

	const binding: TargetDiscoveryBinding = {
		run_id: runId,
		selected_adapter_id: requestedAdapter,
		target_envelope_id: targetEnvelopeId,
		...(handoff
			? {
					verified_endpoint_identity: handoff.verifiedEndpointIdentity,
					handoff_evidence_id: handoff.handoffEvidenceId,
				}
			: {}),
	};

	const envelope: TargetDiscoveryEnvelope = {
		contract: BROWSER_USE_TARGETS_CONTRACT_ID,
		schema_version: BROWSER_USE_TARGETS_SCHEMA_VERSION,
		mode,
		handoff_bound: mode === "handoff-bound",
		operation_ready: mode === "handoff-bound",
		requested_adapter: requestedAdapter,
		binding,
		candidate_count: candidates.length,
		candidates,
	};

	return emitTargetDiscoverySuccess({
		envelope,
		outputMode: parsed.outputMode,
		stdout: input.stdout,
		runId: input.runId,
		durationMs: input.durationMs(),
	});
}

// --- Verified Handoff Envelope parser (KTD1) --------------------------------

export type HandoffParse =
	// A verified handoff: binding facts derived from envelope fields.
	| { ok: true; kind: "verified"; facts: HandoffFacts }
	// A structurally valid browser-connect FAILURE envelope (connect failed
	// closed). Acceptable recovery-mode evidence; never authorizes attachment.
	| { ok: true; kind: "failed" }
	| { ok: false; failure: TargetDiscoveryFailure };

// Parse a browser-connect Verified Handoff Envelope. One parser for every
// surviving surface: validates the pinned contract id and schema version (the
// KTD1 drift tripwire), discriminates verified/failed outcomes, and derives
// browser-use's binding identity from the envelope's attachment and endpoint
// fields. Never trusts unmapped adapters and never re-emits endpoint forms.
export async function readHandoffFacts(
	runtime: BrowserUseRuntime,
	path: string,
): Promise<HandoffParse> {
	let raw: string;
	try {
		raw = await runtime.readTextFile(path);
	} catch {
		return {
			ok: false,
			failure: handoffInvalidFailure("the --handoff file could not be read"),
		};
	}
	const invalid = (detail: string): HandoffParse => ({
		ok: false,
		failure: handoffInvalidFailure(
			`the supplied envelope is not a browser-connect verified handoff: ${detail}`,
		),
	});
	const value = safeJsonObject(raw);
	if (!value) return invalid("not a JSON object");
	const data = isJsonObject(value.data) ? value.data : undefined;
	if (!data) return invalid("data is missing");
	// Positive contract identity plus the pinned schema version (KTD1). A
	// missing contract is rejected, not waved through, so a hand-written or
	// foreign file cannot pass; a future browser-connect schema rev fails closed
	// here instead of being half-parsed.
	if (data.contract_id !== BROWSER_CONNECT_HANDOFF_CONTRACT_ID) {
		return invalid("contract id missing or does not match");
	}
	if (data.schema_version !== BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION) {
		return invalid(
			`schema version ${String(data.schema_version)} is not the pinned version ${BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION}`,
		);
	}
	if (data.outcome === "failed") return { ok: true, kind: "failed" };
	if (data.outcome !== "verified") return invalid("outcome is not verified");
	const attachment = isJsonObject(data.attachment) ? data.attachment : undefined;
	if (!attachment) return invalid("attachment is missing");
	const attachmentAdapterId = stringField(attachment.adapter_id);
	if (!attachmentAdapterId) return invalid("attachment adapter id missing");
	const adapter = mappedAdapterId(attachmentAdapterId);
	if (!adapter) {
		return invalid(
			`attachment adapter ${attachmentAdapterId} is not a registered browser-use adapter`,
		);
	}
	const route = stringField(attachment.route);
	if (!route) return invalid("attachment route missing");
	const endpoint = isJsonObject(data.endpoint) ? data.endpoint : undefined;
	const endpointHttp = endpoint ? stringField(endpoint.http) : undefined;
	const endpointWs = endpoint ? stringField(endpoint.ws) : undefined;
	if (!endpointHttp || !endpointWs) return invalid("endpoint forms missing");
	const endpointUrl = safeUrl(endpointHttp);
	if (!endpointUrl) return invalid("endpoint http form is not a valid URL");
	const proof = isJsonObject(data.proof) ? data.proof : undefined;
	const proofContractId = proof
		? stringField(proof.environment_contract_id)
		: undefined;
	const proofSchemaVersion = proof
		? stringField(proof.environment_schema_version)
		: undefined;
	if (!proofContractId || !proofSchemaVersion) {
		return invalid("proof evidence missing");
	}
	const runId = stringField(value.run_id);
	if (!runId) return invalid("run id missing");
	return {
		ok: true,
		kind: "verified",
		facts: {
			adapter,
			attachmentAdapterId,
			runId,
			verifiedEndpointIdentity: endpointUrl.host,
			handoffEvidenceId: handoffEvidenceIdOf({
				runId,
				attachmentAdapterId,
				route,
				endpointHttp,
				endpointWs,
				proofContractId,
				proofSchemaVersion,
			}),
			authorizedCapabilities: BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES[adapter],
		},
	};
}

function mappedAdapterId(
	attachmentAdapterId: string,
): BrowserAdapterId | undefined {
	const map: Record<string, BrowserAdapterId> = BROWSER_CONNECT_ATTACHMENT_ADAPTERS;
	return map[attachmentAdapterId];
}

function isKnownAdapterId(value: unknown): value is BrowserAdapterId {
	return (
		typeof value === "string" &&
		value in BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES
	);
}

// The envelope's endpoint.http comes verbatim from the environment proof; a
// URL parse here is identity derivation, not navigation, so it does not go
// through parseUrlSafe's http(s)-page filter.
function safeUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}

// --- Live target listing through the attached adapter -----------------------

type DiscoverResult =
	| { ok: true; pages: RawPage[] }
	| { ok: false; failure: TargetDiscoveryFailure };

export async function discoverPages(
	runtime: BrowserUseRuntime,
	adapter: BrowserAdapterId,
): Promise<DiscoverResult> {
	// The page-listing transport is implemented for chrome-devtools only. A
	// handoff or recovery request can name another registry adapter
	// (agent-browser, playwright-cdp); fail closed rather than silently listing
	// chrome-devtools pages against the wrong adapter, until those transports
	// land (V2).
	if (!(BROWSER_USE_TRANSPORT_ADAPTERS as readonly string[]).includes(adapter)) {
		return {
			ok: false,
			failure: {
				code: "target_discovery_transport_failed",
				message: `Browser Target Discovery is not implemented for adapter ${adapter} yet.`,
				actionId: "change_target_discovery_input",
				exitCode: TARGET_DISCOVERY_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	const transport = await runBrowserUseMcporter(runtime, [
		"call",
		`${adapter}.list_pages`,
		"--args",
		"{}",
		"--output",
		"json",
	]);
	if (!transport.ok) {
		return { ok: false, failure: transportDiscoveryFailure(transport.failure) };
	}
	const result = transport.result;
	if (result.exitCode !== 0) {
		return {
			ok: false,
			failure: {
				code: "target_discovery_transport_failed",
				message: "The adapter list_pages call failed.",
				actionId: "inspect_target_discovery_diagnostics",
				exitCode: TARGET_DISCOVERY_EXIT_CODE,
				recoverability: "retry",
			},
		};
	}
	if (result.stdout.trim() === "") return { ok: true, pages: [] };
	let parsed: unknown;
	try {
		parsed = JSON.parse(result.stdout);
	} catch {
		return {
			ok: false,
			failure: {
				code: "target_discovery_transport_failed",
				message: "The adapter list_pages call returned unparsable output.",
				actionId: "inspect_target_discovery_diagnostics",
				exitCode: TARGET_DISCOVERY_EXIT_CODE,
				recoverability: "retry",
			},
		};
	}
	return { ok: true, pages: extractRawPages(parsed) };
}

function extractRawPages(value: unknown): RawPage[] {
	const list = pageArray(value);
	return list.flatMap((entry): RawPage[] => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
		const object = entry as Record<string, unknown>;
		return [
			{
				...(typeof object.id === "string" ? { id: object.id } : {}),
				...(typeof object.title === "string" ? { title: object.title } : {}),
				...(typeof object.url === "string" ? { url: object.url } : {}),
			},
		];
	});
}

function pageArray(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (!value || typeof value !== "object") return [];
	const object = value as Record<string, unknown>;
	for (const key of ["pages", "tabs", "targets"]) {
		const field = object[key];
		if (Array.isArray(field)) return field;
	}
	const content = object.content;
	if (Array.isArray(content)) {
		return content.flatMap((entry) => {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
			const text = (entry as Record<string, unknown>).text;
			return typeof text === "string" ? parsePagesText(text) : [];
		});
	}
	return [];
}

function parsePagesText(text: string): RawPage[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.flatMap((line): RawPage[] => {
			const match = line.match(/^(\d+):\s+(\S+)(?:\s+\[[^\]]+\])?$/);
			if (!match) return [];
			const [, id, url] = match;
			return [{ id, url }];
		});
}

// --- Failure builders ------------------------------------------------------

function usageDiscoveryFailure(message: string): TargetDiscoveryFailure {
	return {
		code: "target_discovery_input_invalid",
		message,
		actionId: "change_target_discovery_input",
		exitCode: USAGE_EXIT_CODE,
		recoverability: "change_input",
	};
}

function handoffInvalidFailure(detail: string): TargetDiscoveryFailure {
	return {
		code: "target_discovery_handoff_invalid",
		message: `The supplied Verified Handoff Envelope cannot authorize discovery: ${detail}.`,
		actionId: "supply_verified_handoff",
		exitCode: TARGET_DISCOVERY_EXIT_CODE,
		recoverability: "change_input",
	};
}

// Map a shared-transport failure onto the target discovery taxonomy. A missing
// dependency routes to dependency recovery, never adapter fallback or browser
// re-entry repair.
function transportDiscoveryFailure(
	failure: BrowserOperationTransportFailure,
): TargetDiscoveryFailure {
	switch (failure.kind) {
		case "command_override_invalid":
			return {
				code: "target_discovery_command_override_invalid",
				message: failure.hintSummary,
				actionId: "configure_target_dependency",
				exitCode: TARGET_DISCOVERY_DEPENDENCY_EXIT_CODE,
				recoverability: "repair_state",
			};
		case "dependency_missing":
			return {
				code: "target_discovery_dependency_missing",
				message: failure.hintSummary,
				actionId: "configure_target_dependency",
				exitCode: TARGET_DISCOVERY_DEPENDENCY_EXIT_CODE,
				recoverability: "repair_state",
			};
		case "transport_timeout":
			return {
				code: "target_discovery_transport_timeout",
				message: failure.hintSummary,
				actionId: "inspect_target_discovery_diagnostics",
				exitCode: TARGET_DISCOVERY_EXIT_CODE,
				recoverability: "retry",
			};
		case "execution_failed":
			return {
				code: "target_discovery_transport_failed",
				message: failure.hintSummary,
				actionId: "inspect_target_discovery_diagnostics",
				exitCode: TARGET_DISCOVERY_EXIT_CODE,
				recoverability: "retry",
			};
	}
}

// --- Output writers --------------------------------------------------------

function emitTargetDiscoverySuccess(input: {
	envelope: TargetDiscoveryEnvelope;
	outputMode: OutputMode;
	stdout: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const successActionId: TargetDiscoveryActionId =
		input.envelope.mode === "handoff-bound"
			? "select_browser_target"
			: "connect_verified_browser";
	if (input.outputMode === "plain") {
		input.stdout.write(
			[
				"browser_targets_listed",
				`mode=${input.envelope.mode}`,
				`handoff_bound=${input.envelope.handoff_bound}`,
				`operation_ready=${input.envelope.operation_ready}`,
				`adapter=${input.envelope.requested_adapter}`,
				`candidates=${input.envelope.candidate_count}`,
				`target_envelope_id=${input.envelope.binding.target_envelope_id}`,
				`action=${successActionId}`,
				`run_id=${input.runId}`,
				`duration_ms=${input.durationMs}`,
			].join(" ") + "\n",
		);
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: input.envelope,
			runtime_actions: [targetDiscoveryAction(successActionId)],
			continuation: { next_action_id: successActionId },
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return 0;
}

function emitTargetDiscoveryFailure(input: {
	failure: TargetDiscoveryFailure;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const { failure } = input;
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${failure.code}: ${redactUnsafeText(failure.message)} action=${failure.actionId} (run_id=${input.runId})\n`,
		);
		return failure.exitCode;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: failure.exitCode,
			data: { command: "targets-list", result_kind: "browser_targets" },
			runtime_actions: [targetDiscoveryAction(failure.actionId)],
			continuation: { next_action_id: failure.actionId },
			error: createCliRuntimeError({
				run_id: input.runId,
				code: failure.code,
				message: redactUnsafeText(failure.message),
				exit_code: failure.exitCode,
				severity: "error",
				...retryabilityForRecoverability(failure.recoverability),
				failure_domain: "browser_use",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return failure.exitCode;
}

// Project a registry action into runtime guidance. The id-param type is pinned
// by each per-surface wrapper below; this helper stays untyped on id.
function targetDiscoveryAction(id: TargetDiscoveryActionId): RuntimeActionGuidance {
	return actionFor(targetDiscoveryActionById, id, "target discovery");
}
