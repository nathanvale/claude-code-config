// ---------------------------------------------------------------------------
// Browser Target Discovery (plan U5).
//
// Owns the targets-list workflow: read adapter-proof + route facts through the
// runtime, project raw pages into display-safe candidates, and emit the
// discovery success/failure envelopes. Imports down into core (substrate),
// runtime (I/O port), and transport (mcporter). The driver calls runTargetsList
// from here; selection and operations read discovery's evidence builders.
// ---------------------------------------------------------------------------

import {
	type CliWriter,
	type RuntimeActionGuidance,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_ADAPTER_PROOF_ADAPTERS,
	BROWSER_ADAPTER_PROOF_CONTRACT_ID,
	BROWSER_ADAPTER_ROUTER_CAPABILITIES,
	BROWSER_ADAPTER_ROUTER_CONTRACT_ID,
	browserUseTargetDiscoveryFailureActions,
	browserUseTargetDiscoverySuccessActions,
} from "./command-contract";
import type {
	AdapterCapability,
	BrowserAdapterId,
	RouteBinding,
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
	isBrowserAdapterId,
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

// ---------------------------------------------------------------------------
// Browser Target Discovery (plan U5).
//
// `browser-use targets list` discovers Browser Target Candidates through a
// proven adapter in two modes:
//   - recovery (R19, R20): requested adapter + fresh Adapter Proof. Candidates
//     are evidence-gathering only; they feed `prepare --target-discovery`, never
//     `targets select` or `operate` (R25). route_bound/operation_ready = false.
//   - route-bound (R18, R20): full route success + fresh Adapter Proof for the
//     selected adapter. Candidates are operation-ready and carry the route slice.
//
// Privacy is a release gate (R32, KTD7): query strings, fragments, auth-bearing
// path segments, adapter page ids, CDP target ids, and WebSocket debugger URLs
// never reach JSON, logs, or diagnostics. Public candidate facts are the ordinal,
// a derived candidate id, a redacted origin, an optional redacted path shape
// (--show-url only), and a length-bounded title. Display facts stay separate from
// the raw adapter list, which is consumed and discarded inside this module.
//
// Each failure outcome (invalid proof, mismatched proof, invalid route, empty
// candidate set, transport timeout/dependency/override) maps to its own code and
// continuation action — never silently to success or the wrong recovery.
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

// Raw adapter proof facts parsed from --adapter-proof. Consumed for binding and
// adapter-match checks; never re-emitted verbatim.
export type AdapterProofFacts = {
	adapter: BrowserAdapterId;
	warmChromeRunId: string;
	adapterProofId: string;
	verifiedEndpointIdentity: string;
};

// Route success facts parsed from --route in route-bound mode.
export type RouteFacts = {
	runId: string;
	selectedAdapter: BrowserAdapterId;
	warmChromeRunId: string;
	adapterProofId: string;
	verifiedEndpointIdentity: string;
	routeEvidenceHash: string;
	binding: RouteBinding;
};

export async function runTargetsList(input: {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: () => number;
}): Promise<number> {
	const { parsed, runtime } = input;
	const flags = parsed.flagValues;
	const modeRaw = flags["--mode"];
	if (modeRaw !== "recovery" && modeRaw !== "route-bound") {
		return emitTargetDiscoveryFailure({
			failure: usageDiscoveryFailure(
				"targets list requires --mode recovery or --mode route-bound.",
			),
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});
	}
	const mode: TargetDiscoveryMode = modeRaw;

	const adapterProofPath = flags["--adapter-proof"];
	if (!adapterProofPath) {
		return emitTargetDiscoveryFailure({
			failure: {
				code: "target_discovery_adapter_proof_invalid",
				message: "targets list requires --adapter-proof.",
				actionId: "supply_adapter_proof",
				exitCode: TARGET_DISCOVERY_EXIT_CODE,
				recoverability: "change_input",
			},
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});
	}

	const proofParse = await readAdapterProofFacts(runtime, adapterProofPath);
	if (!proofParse.ok) {
		return emitTargetDiscoveryFailure({
			failure: proofParse.failure,
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});
	}
	const proof = proofParse.facts;

	// Resolve the requested adapter and the run-scoped binding facts per mode,
	// then fail closed on any adapter / proof-id / endpoint mismatch (R9).
	let requestedAdapter: BrowserAdapterId;
	let routeEvidenceHash: string | undefined;
	let runId = input.runId;
	if (mode === "recovery") {
		const adapter = flags["--adapter"];
		if (!isBrowserAdapterId(adapter)) {
			return emitTargetDiscoveryFailure({
				failure: usageDiscoveryFailure(
					"recovery-mode targets list requires --adapter <id>.",
				),
				outputMode: parsed.outputMode,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				durationMs: input.durationMs(),
			});
		}
		if (proof.adapter !== adapter) {
			return emitTargetDiscoveryFailure({
				failure: proofMismatchFailure(
					`The supplied Adapter Proof is for ${proof.adapter}, not the requested ${adapter}.`,
				),
				outputMode: parsed.outputMode,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				durationMs: input.durationMs(),
			});
		}
		requestedAdapter = adapter;
	} else {
		const routePath = flags["--route"];
		if (!routePath) {
			return emitTargetDiscoveryFailure({
				failure: {
					code: "target_discovery_route_invalid",
					message: "route-bound targets list requires --route <path>.",
					actionId: "rerun_route_bound_target_discovery",
					exitCode: TARGET_DISCOVERY_EXIT_CODE,
					recoverability: "change_input",
				},
				outputMode: parsed.outputMode,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				durationMs: input.durationMs(),
			});
		}
		const routeParse = await readRouteFacts(runtime, routePath);
		if (!routeParse.ok) {
			return emitTargetDiscoveryFailure({
				failure: routeParse.failure,
				outputMode: parsed.outputMode,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				durationMs: input.durationMs(),
			});
		}
		const route = routeParse.facts;
		// A supplied --adapter (a recovery-mode flag) that contradicts the route's
		// selected adapter is a caller mistake. The route is authoritative, but
		// silently discarding the contradiction would mask the error; fail closed.
		const pinnedAdapter = flags["--adapter"];
		if (pinnedAdapter && pinnedAdapter !== route.selectedAdapter) {
			return emitTargetDiscoveryFailure({
				failure: usageDiscoveryFailure(
					`--adapter ${pinnedAdapter} contradicts the route's selected adapter ${route.selectedAdapter}; omit --adapter in route-bound mode.`,
				),
				outputMode: parsed.outputMode,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				durationMs: input.durationMs(),
			});
		}
		// Route/proof binding must agree (R9): the proof must be for the route's
		// selected adapter and carry the same proof id and verified endpoint.
		if (
			proof.adapter !== route.selectedAdapter ||
			proof.adapterProofId !== route.adapterProofId ||
			proof.verifiedEndpointIdentity !== route.verifiedEndpointIdentity ||
			proof.warmChromeRunId !== route.warmChromeRunId
		) {
			return emitTargetDiscoveryFailure({
				failure: proofMismatchFailure(
					"The supplied Adapter Proof does not match the route's selected adapter binding.",
				),
				outputMode: parsed.outputMode,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				durationMs: input.durationMs(),
			});
		}
		requestedAdapter = route.selectedAdapter;
		routeEvidenceHash = route.routeEvidenceHash;
		runId = route.runId;
	}

	// Discover live Browser Targets through the proven adapter.
	const discovery = await discoverPages(runtime, requestedAdapter);
	if (!discovery.ok) {
		return emitTargetDiscoveryFailure({
			failure: discovery.failure,
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});
	}

	const showUrl = flags["--show-url"] !== undefined;
	const targetEnvelopeId = targetEnvelopeIdOf({
		runId,
		mode,
		adapter: requestedAdapter,
		adapterProofId: proof.adapterProofId,
		routeEvidenceHash,
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
		return emitTargetDiscoveryFailure({
			failure: {
				code: "target_discovery_no_candidates",
				message:
					"No Browser Target Candidates were discovered through the proven adapter.",
				actionId: "open_browser_target",
				exitCode: TARGET_DISCOVERY_EXIT_CODE,
				recoverability: "retry",
			},
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});
	}

	const binding: TargetDiscoveryBinding = {
		run_id: runId,
		warm_chrome_run_id: proof.warmChromeRunId,
		adapter_proof_id: proof.adapterProofId,
		selected_adapter_id: requestedAdapter,
		verified_endpoint_identity: proof.verifiedEndpointIdentity,
		target_envelope_id: targetEnvelopeId,
		...(routeEvidenceHash ? { route_evidence_hash: routeEvidenceHash } : {}),
	};

	const envelope: TargetDiscoveryEnvelope = {
		mode,
		route_bound: mode === "route-bound",
		operation_ready: mode === "route-bound",
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

// --- Evidence parsers (read-then-assemble; mirror prepare's proof parser) ----

type AdapterProofParse =
	| { ok: true; facts: AdapterProofFacts }
	| { ok: false; failure: TargetDiscoveryFailure };

export async function readAdapterProofFacts(
	runtime: BrowserUseRuntime,
	path: string,
): Promise<AdapterProofParse> {
	let raw: string;
	try {
		raw = await runtime.readTextFile(path);
	} catch {
		return {
			ok: false,
			failure: {
				code: "target_discovery_adapter_proof_invalid",
				message: "The --adapter-proof file could not be read.",
				actionId: "supply_adapter_proof",
				exitCode: TARGET_DISCOVERY_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	const value = safeJsonObject(raw);
	const data = value && isJsonObject(value.data) ? value.data : undefined;
	const invalid = (detail: string): AdapterProofParse => ({
		ok: false,
		failure: {
			code: "target_discovery_adapter_proof_invalid",
			message: `The supplied Adapter Proof is not a valid success proof: ${detail}.`,
			actionId: "supply_adapter_proof",
			exitCode: TARGET_DISCOVERY_EXIT_CODE,
			recoverability: "change_input",
		},
	});
	if (!value || value.status !== "ok") return invalid("status is not ok");
	if (!data || data.ok !== true) return invalid("data is not a success proof");
	if (data.contract !== BROWSER_ADAPTER_PROOF_CONTRACT_ID) {
		return invalid("contract id does not match");
	}
	const adapter = data.adapter;
	if (!isBrowserAdapterId(adapter)) return invalid("adapter id missing");
	const warmChromeRunId = stringField(data.warm_chrome_run_id);
	if (!warmChromeRunId) return invalid("warm Chrome run id missing");
	const adapterProofId = stringField(data.adapter_proof_id);
	if (!adapterProofId) return invalid("adapter proof id missing");
	const verifiedEndpointIdentity = stringField(data.verified_endpoint_identity);
	if (!verifiedEndpointIdentity) {
		return invalid("verified endpoint identity missing");
	}
	return {
		ok: true,
		facts: {
			adapter,
			warmChromeRunId,
			adapterProofId,
			verifiedEndpointIdentity,
		},
	};
}

type RouteParse =
	| { ok: true; facts: RouteFacts }
	| { ok: false; failure: TargetDiscoveryFailure };

export async function readRouteFacts(
	runtime: BrowserUseRuntime,
	path: string,
): Promise<RouteParse> {
	let raw: string;
	try {
		raw = await runtime.readTextFile(path);
	} catch {
		return {
			ok: false,
			failure: routeInvalidFailure("the --route file could not be read"),
		};
	}
	const value = safeJsonObject(raw);
	const data = value && isJsonObject(value.data) ? value.data : undefined;
	if (!value || value.status !== "ok") {
		return { ok: false, failure: routeInvalidFailure("route status is not ok") };
	}
	if (!data || data.outcome !== "selected") {
		return {
			ok: false,
			failure: routeInvalidFailure("route is not a success envelope"),
		};
	}
	// Require the Router contract id. A route success that is about to authorize
	// discovery must positively identify as Router output; a missing contract is
	// rejected, not waved through, so a hand-written or partial file cannot pass.
	if (data.contract !== BROWSER_ADAPTER_ROUTER_CONTRACT_ID) {
		return {
			ok: false,
			failure: routeInvalidFailure("route contract id missing or does not match"),
		};
	}
	const selectedAdapter = data.selected_adapter;
	if (!isBrowserAdapterId(selectedAdapter)) {
		return {
			ok: false,
			failure: routeInvalidFailure("route selected adapter missing"),
		};
	}
	// Operation-capable routes carry the binding tuple (U2 R8). Target discovery
	// is operation-facing, so a route-bound list requires it: a route without a
	// binding never authorized a Browser Operation and cannot bind candidates.
	const binding = isJsonObject(data.binding) ? data.binding : undefined;
	if (!binding) {
		return {
			ok: false,
			failure: routeInvalidFailure(
				"route success carries no operation binding; re-route with fresh proof",
			),
		};
	}
	// The binding's selected adapter must agree with the route's top-level
	// selected_adapter. A file where they disagree is internally inconsistent and
	// must not authorize discovery against either adapter (fail closed, R9).
	const bindingAdapter = stringField(binding.selected_adapter_id);
	if (bindingAdapter !== selectedAdapter) {
		return {
			ok: false,
			failure: routeInvalidFailure(
				"route binding selected_adapter_id does not match route selected_adapter",
			),
		};
	}
	const runId = stringField(binding.run_id) ?? stringField(value.run_id);
	const warmChromeRunId = stringField(binding.warm_chrome_run_id);
	const adapterProofId = stringField(binding.adapter_proof_id);
	const verifiedEndpointIdentity = stringField(
		binding.verified_endpoint_identity,
	);
	const routeEvidenceHash = stringField(binding.route_evidence_hash);
	const authorizedCapabilities = parseAdapterCapabilities(
		binding.authorized_capabilities,
	);
	const emittedAt = stringField(binding.emitted_at);
	const expiresAt = stringField(binding.expires_at);
	if (
		!runId ||
		!warmChromeRunId ||
		!adapterProofId ||
		!verifiedEndpointIdentity ||
		!routeEvidenceHash ||
		!authorizedCapabilities ||
		!emittedAt ||
		!expiresAt
	) {
		return {
			ok: false,
			failure: routeInvalidFailure("route binding fields incomplete"),
		};
	}
	const routeBinding: RouteBinding = {
		run_id: runId,
		selected_adapter_id: selectedAdapter,
		warm_chrome_run_id: warmChromeRunId,
		adapter_proof_id: adapterProofId,
		verified_endpoint_identity: verifiedEndpointIdentity,
		route_evidence_hash: routeEvidenceHash,
		authorized_capabilities: authorizedCapabilities,
		emitted_at: emittedAt,
		expires_at: expiresAt,
	};
	return {
		ok: true,
		facts: {
			runId,
			selectedAdapter,
			warmChromeRunId,
			adapterProofId,
			verifiedEndpointIdentity,
			routeEvidenceHash,
			binding: routeBinding,
		},
	};
}

// --- Live target listing through the proven adapter ------------------------

type DiscoverResult =
	| { ok: true; pages: RawPage[] }
	| { ok: false; failure: TargetDiscoveryFailure };

export async function discoverPages(
	runtime: BrowserUseRuntime,
	adapter: BrowserAdapterId,
): Promise<DiscoverResult> {
	// MVP implements the page-listing transport for chrome-devtools only. A route
	// or recovery request can name another registry adapter (agent-browser,
	// playwright-cdp); fail closed rather than silently listing chrome-devtools
	// pages against the wrong adapter, until those transports land (V2).
	if (!(BROWSER_ADAPTER_PROOF_ADAPTERS as readonly string[]).includes(adapter)) {
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
		code: "target_discovery_route_invalid",
		message,
		actionId: "change_target_discovery_input",
		exitCode: USAGE_EXIT_CODE,
		recoverability: "change_input",
	};
}

function proofMismatchFailure(message: string): TargetDiscoveryFailure {
	return {
		code: "target_discovery_adapter_proof_mismatch",
		message,
		actionId: "refresh_adapter_proof",
		exitCode: TARGET_DISCOVERY_EXIT_CODE,
		recoverability: "change_input",
	};
}

function routeInvalidFailure(detail: string): TargetDiscoveryFailure {
	return {
		code: "target_discovery_route_invalid",
		message: `The supplied route success envelope is invalid: ${detail}.`,
		actionId: "rerun_route_bound_target_discovery",
		exitCode: TARGET_DISCOVERY_EXIT_CODE,
		recoverability: "change_input",
	};
}

// Map a shared-transport failure onto the target discovery taxonomy. A missing
// dependency routes to dependency recovery, never adapter fallback or Warm Chrome
// repair (mirrors Adapter Proof / U4).
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
		input.envelope.mode === "route-bound"
			? "select_browser_target"
			: "prepare_with_target_discovery";
	if (input.outputMode === "plain") {
		input.stdout.write(
			[
				"browser_targets_listed",
				`mode=${input.envelope.mode}`,
				`route_bound=${input.envelope.route_bound}`,
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
			error: {
				run_id: input.runId,
				code: failure.code,
				message: redactUnsafeText(failure.message),
				exit_code: failure.exitCode,
				severity: "error",
				recoverability: failure.recoverability,
				retryable: failure.recoverability === "retry",
				failure_domain: "browser_use",
			},
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

function parseAdapterCapabilities(
	value: unknown,
): AdapterCapability[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const capabilities: AdapterCapability[] = [];
	for (const entry of value) {
		if (
			typeof entry !== "string" ||
			!(BROWSER_ADAPTER_ROUTER_CAPABILITIES as readonly string[]).includes(entry)
		) {
			return undefined;
		}
		capabilities.push(entry as AdapterCapability);
	}
	return capabilities;
}

