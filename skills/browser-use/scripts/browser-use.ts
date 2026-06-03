#!/usr/bin/env bun

// Browser Use CLI (plan 2026-06-04-001, U3).
//
// Contract shell for live Browser Targets and Browser Operations. Router owns
// `prepare`/`route`; this surface owns `targets` and `operate` (KTD3). U3 ships
// help text, command discovery metadata, parser acceptance/rejection, and the
// result contracts. Subcommand bodies emit dry-run/mock envelopes (gated by
// --dry-run) or a structured not-implemented result. NO live browser calls,
// target discovery, or operations here — those land in U5/U6/U7.
//
// Command surfaces:
//   targets list|select|status   — Browser Target Discovery/Selection (shell).
//   operate snapshot|screenshot|emulate — Browser Operations (shell).

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	type RuntimeActionGuidance,
	CliUsageError,
	configureCliDiagnostics,
	createCliDiagnosticContext,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	resetCliDiagnostics,
	usageError,
	withCliDiagnosticContext,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_ADAPTER_PROOF_CONTRACT_ID,
	BROWSER_ADAPTER_ROUTER_ADAPTERS,
	BROWSER_ADAPTER_ROUTER_CONTRACT_ID,
	BROWSER_USE_FAMILIES,
	BROWSER_USE_OPERATE_SUBCOMMANDS,
	BROWSER_USE_TARGETS_SUBCOMMANDS,
	type BrowserUseCommand,
	type BrowserUseFamily,
	type BrowserUseOperateSubcommand,
	type BrowserUseTargetsSubcommand,
	browserUseContracts,
	browserUseTargetDiscoveryFailureActions,
	browserUseTargetDiscoverySuccessActions,
} from "./command-contract";
import type {
	BrowserAdapterId,
	BrowserTargetCandidate,
	TargetDiscoveryBinding,
	TargetDiscoveryEnvelope,
	TargetDiscoveryMode,
} from "./browser-adapter-router-model";
import {
	type McporterCommandInput,
	type McporterCommandResult,
	isMissingCommandResult,
	mcporterDependencyHintText,
	mcporterOverrideInvalidHintText,
	runMcporter,
	spawnMcporterCommand,
} from "./mcporter-transport";

const VERSION = "0.1.0";
const BINDING_FAIL_CLOSED_EXIT_CODE = 20;
const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const NOT_IMPLEMENTED_EXIT_CODE = 1;
// Browser Operation transport timeout. Independent of Adapter Proof's adapter
// timing; the shared transport is timeout-agnostic and takes this per call.
const OPERATION_TRANSPORT_TIMEOUT_MS = 8000;

const quietDiagnosticWriter: CliWriter = { write: () => true };

// One-line pointer the help surface uses to send agents back to the
// route-bound prerequisites without copying route evidence schemas (R17, U3
// scenario 8). browser-use never re-declares the route envelope shape.
const ROUTE_PREREQUISITE_POINTER =
	"Prerequisite: get route evidence from `browser-adapter-router prepare` then `browser-adapter-router route` (--route).";

export type BrowserUseRuntime = {
	env: Record<string, string | undefined>;
	now: () => number;
	// Structured, shell-free command runner the shared mcporter transport drives
	// (plan U4). Same shape Browser Adapter Proof uses, so both surfaces run the
	// command vector identically.
	runCommand: (input: McporterCommandInput) => Promise<McporterCommandResult>;
	// Read a supplied evidence file (--route, --adapter-proof). Kept on the runtime
	// so the discovery assembler stays pure and the CLI driver owns all I/O
	// (mirrors AdapterProofRuntime / prepare's read-then-assemble split).
	readTextFile: (path: string) => Promise<string>;
};

export function createDefaultBrowserUseRuntime(
	overrides: Partial<BrowserUseRuntime> = {},
): BrowserUseRuntime {
	return {
		env: { ...process.env },
		now: () => Date.now(),
		runCommand: (input: McporterCommandInput) => spawnMcporterCommand(input),
		readTextFile: (path: string) => readFile(path, "utf-8"),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// CLI driver. Mirrors browser-adapter-router.ts structure.
// ---------------------------------------------------------------------------

type OutputMode = "json" | "plain";

type ParsedBrowserUseCommand =
	| { kind: "help"; family?: BrowserUseFamily; command?: BrowserUseCommand }
	| { kind: "version"; outputMode: OutputMode }
	| {
			kind: "command";
			command: BrowserUseCommand;
			family: BrowserUseFamily;
			subcommand: string;
			outputMode: OutputMode;
			dryRun: boolean;
			// Raw declared-flag values for the resolved command. Booleans map to "";
			// value-bearing flags map to their string value. Undefined when absent.
			flagValues: Record<string, string>;
	  };

export async function runBrowserUseCli(
	argv: readonly string[],
	options: {
		runtime?: BrowserUseRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultBrowserUseRuntime();
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const diagnosticInput = applyEnvRunId(argv, runtime.env.BROWSER_USE_RUN_ID);
	let diagnosticArgv: ParsedCliDiagnosticArgv;

	try {
		diagnosticArgv = parseCliDiagnosticArgv(diagnosticInput);
	} catch (error) {
		diagnosticArgv = parseCliDiagnosticFallbackArgv(diagnosticInput);
		const outputMode = errorOutputMode(argv);
		configureCliDiagnostics({
			categoryRoot: "browser-use.cli",
			options: diagnosticArgv.options,
			diagnosticWriter: diagnosticArgv.options.quiet
				? quietDiagnosticWriter
				: stderr,
		});
		try {
			return emitCliError({
				error:
					error instanceof Error
						? usageError(error.message)
						: usageError("invalid diagnostic flags"),
				outputMode,
				stdout,
				stderr,
				runId: diagnosticArgv.options.runId,
				durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
			});
		} finally {
			resetCliDiagnostics();
		}
	}

	const outputMode = errorOutputMode(diagnosticArgv.argv);
	let parsed: ParsedBrowserUseCommand;
	try {
		parsed = parseBrowserUseArgv(diagnosticArgv.argv);
	} catch (error) {
		configureCliDiagnostics({
			categoryRoot: "browser-use.cli",
			options: diagnosticArgv.options,
			diagnosticWriter: diagnosticArgv.options.quiet
				? quietDiagnosticWriter
				: stderr,
		});
		try {
			return emitCliError({
				error,
				outputMode,
				stdout,
				stderr,
				runId: diagnosticArgv.options.runId,
				durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
			});
		} finally {
			resetCliDiagnostics();
		}
	}

	if (parsed.kind === "help") {
		stdout.write(renderHelp(parsed.family, parsed.command));
		return 0;
	}
	if (parsed.kind === "version") {
		writeVersion(stdout, parsed.outputMode, {
			runId: diagnosticArgv.options.runId,
			durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
		});
		return 0;
	}

	configureCliDiagnostics({
		categoryRoot: "browser-use.cli",
		options: diagnosticArgv.options,
		diagnosticWriter: diagnosticArgv.options.quiet
			? quietDiagnosticWriter
			: stderr,
	});

	try {
		const context = createCliDiagnosticContext(diagnosticArgv.options);
		return await withCliDiagnosticContext(context, async () => {
			const runId = diagnosticArgv.options.runId;
			const durationMs = () =>
				runtime.now() - diagnosticArgv.options.startedAtMs;
			return executeCommand({
				parsed,
				runtime,
				stdout,
				stderr,
				runId,
				durationMs,
			});
		});
	} finally {
		resetCliDiagnostics();
	}
}

async function executeCommand(input: {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: () => number;
}): Promise<number> {
	const { parsed, runtime } = input;
	const resultKind: ResultKind =
		parsed.family === "targets" ? "browser_targets" : "browser_operation";

	// Browser Target Discovery (U5). The first live `browser-use` surface: real
	// recovery and route-bound target listing through a proven adapter. Dry-run
	// still short-circuits to the mock envelope below.
	if (parsed.command === "targets-list" && !parsed.dryRun) {
		return runTargetsList({
			parsed,
			runtime,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs,
		});
	}

	// Dry-run/mock: exercise success and failure envelopes without any live
	// browser call (R7-shell, U3 scenario 7). The mock outcome selector keeps
	// the failure path testable without inventing a live fault.
	if (parsed.dryRun) {
		const mockOutcome =
			runtime.env.BROWSER_USE_MOCK_OUTCOME === "failure"
				? "failure"
				: "success";
		if (mockOutcome === "failure") {
			return emitMockFailure({
				command: parsed.command,
				resultKind,
				outputMode: parsed.outputMode,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				durationMs: input.durationMs(),
			});
		}
		return emitMockSuccess({
			command: parsed.command,
			resultKind,
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			runId: input.runId,
			durationMs: input.durationMs(),
		});
	}

	// Live path is not implemented in the contract shell. Emit a structured
	// not-implemented result rather than touching a browser (U5/U6/U7 own it).
	return emitNotImplemented({
		command: parsed.command,
		resultKind,
		outputMode: parsed.outputMode,
		stdout: input.stdout,
		stderr: input.stderr,
		runId: input.runId,
		durationMs: input.durationMs(),
	});
}

// ---------------------------------------------------------------------------
// Output writers.
// ---------------------------------------------------------------------------

type ResultKind = "browser_targets" | "browser_operation";

function emitMockSuccess(input: {
	command: BrowserUseCommand;
	resultKind: ResultKind;
	outputMode: OutputMode;
	stdout: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	if (input.outputMode === "plain") {
		input.stdout.write(
			[
				"browser_use_mock_success",
				`command=${input.command}`,
				`result=${input.resultKind}`,
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
			data: {
				command: input.command,
				result_kind: input.resultKind,
				mode: "dry_run",
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return 0;
}

function emitMockFailure(input: {
	command: BrowserUseCommand;
	resultKind: ResultKind;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const code = "browser_use_mock_failure";
	const message = "Dry-run mock failure outcome.";
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${code}: ${message} (run_id=${input.runId})\n`,
		);
		return BINDING_FAIL_CLOSED_EXIT_CODE;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
			data: { command: input.command, result_kind: input.resultKind, mode: "dry_run" },
			error: {
				run_id: input.runId,
				code,
				message,
				exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
				severity: "error",
				recoverability: "change_input",
				retryable: false,
				failure_domain: "browser_use",
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return BINDING_FAIL_CLOSED_EXIT_CODE;
}

function emitNotImplemented(input: {
	command: BrowserUseCommand;
	resultKind: ResultKind;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const code = "browser_use_not_implemented";
	const message =
		"Live browser-use logic is not implemented yet; rerun with --dry-run for the mock envelope.";
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${code}: ${message} (run_id=${input.runId})\n`,
		);
		return NOT_IMPLEMENTED_EXIT_CODE;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: NOT_IMPLEMENTED_EXIT_CODE,
			data: { command: input.command, result_kind: input.resultKind },
			error: {
				run_id: input.runId,
				code,
				message,
				exit_code: NOT_IMPLEMENTED_EXIT_CODE,
				severity: "error",
				recoverability: "none",
				retryable: false,
				failure_domain: "browser_use",
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return NOT_IMPLEMENTED_EXIT_CODE;
}

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

const TARGET_DISCOVERY_EXIT_CODE = 20;
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

type TargetDiscoveryFailure = {
	code: string;
	message: string;
	actionId: TargetDiscoveryActionId;
	exitCode: number;
	recoverability: "change_input" | "retry" | "repair_state" | "none";
};

// Raw adapter proof facts parsed from --adapter-proof. Consumed for binding and
// adapter-match checks; never re-emitted verbatim.
type AdapterProofFacts = {
	adapter: BrowserAdapterId;
	warmChromeRunId: string;
	adapterProofId: string;
	verifiedEndpointIdentity: string;
};

// Route success facts parsed from --route in route-bound mode.
type RouteFacts = {
	runId: string;
	selectedAdapter: BrowserAdapterId;
	warmChromeRunId: string;
	adapterProofId: string;
	verifiedEndpointIdentity: string;
	routeEvidenceHash: string;
};

async function runTargetsList(input: {
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
	const discovery = await discoverPages(runtime);
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

async function readAdapterProofFacts(
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

async function readRouteFacts(
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
	if (data.contract !== undefined && data.contract !== BROWSER_ADAPTER_ROUTER_CONTRACT_ID) {
		return {
			ok: false,
			failure: routeInvalidFailure("route contract id does not match"),
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
	const runId = stringField(binding.run_id) ?? stringField(value.run_id);
	const warmChromeRunId = stringField(binding.warm_chrome_run_id);
	const adapterProofId = stringField(binding.adapter_proof_id);
	const verifiedEndpointIdentity = stringField(
		binding.verified_endpoint_identity,
	);
	const routeEvidenceHash = stringField(binding.route_evidence_hash);
	if (
		!runId ||
		!warmChromeRunId ||
		!adapterProofId ||
		!verifiedEndpointIdentity ||
		!routeEvidenceHash
	) {
		return {
			ok: false,
			failure: routeInvalidFailure("route binding fields incomplete"),
		};
	}
	return {
		ok: true,
		facts: {
			runId,
			selectedAdapter,
			warmChromeRunId,
			adapterProofId,
			verifiedEndpointIdentity,
			routeEvidenceHash,
		},
	};
}

// --- Live target listing through the proven adapter ------------------------

type RawPage = { id?: string; title?: string; url?: string };

type DiscoverResult =
	| { ok: true; pages: RawPage[] }
	| { ok: false; failure: TargetDiscoveryFailure };

async function discoverPages(
	runtime: BrowserUseRuntime,
): Promise<DiscoverResult> {
	const transport = await runBrowserUseMcporter(runtime, [
		"call",
		"chrome-devtools.list_pages",
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

// --- Candidate projection + redaction (privacy release gate, R32) ----------

// Project one raw adapter page into a display-safe Browser Target Candidate. The
// raw id is used only to derive a per-envelope candidate id (hashed, never
// surfaced); origin/path_shape/title are redaction-gated. No query string,
// fragment, raw page id, or CDP target id survives into the candidate.
function toCandidate(
	page: RawPage,
	index: number,
	targetEnvelopeId: string,
	showUrl: boolean,
): BrowserTargetCandidate {
	const ordinal = index + 1;
	const parsed = parseUrlSafe(page.url);
	const title = redactTitle(page.title);
	return {
		candidate_ordinal: ordinal,
		candidate_id: candidateIdOf(targetEnvelopeId, ordinal),
		origin: parsed?.origin ?? "",
		...(showUrl && parsed ? { path_shape: redactPathShape(parsed) } : {}),
		...(title ? { title } : {}),
	};
}

// Titles are author-controlled semantic hints (R22), but document.title can
// mirror a URL with a query string or fragment (OAuth callbacks, SPA routers,
// error pages). Defensively drop any query/fragment tail before length-bounding,
// so a title carrying ?token=… or #frag cannot leak through the privacy gate
// (R32) the way url path_shape is already protected.
function redactTitle(title: string | undefined): string | undefined {
	if (!title) return undefined;
	const stripped = title.replace(/[?#]\S*/g, "").trim();
	return stripped === "" ? undefined : truncateText(stripped, 80);
}

// Only http(s) Browser Targets are navigable pages. Other schemes — ws:// (the
// WebSocket debugger), devtools://, chrome://, file:// — are adapter transport
// plumbing or non-navigable surfaces, never a public Browser Target. Treating
// them as unparsable keeps WebSocket debugger URLs and devtools handles out of
// the candidate origin/path entirely (R32 privacy gate).
function parseUrlSafe(value: string | undefined): URL | undefined {
	if (!value) return undefined;
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

// Redacted path shape (R32, AE11): pathname only. Query strings and fragments
// are dropped entirely; an opaque marker records that a query/fragment existed
// without disclosing its content. Long path segments are length-bounded.
function redactPathShape(parsed: URL): string {
	const path = parsed.pathname === "" ? "/" : parsed.pathname;
	const hadQuery = parsed.search !== "";
	const hadFragment = parsed.hash !== "";
	const marker = hadQuery || hadFragment ? " […]" : "";
	return `${truncateText(path, 120)}${marker}`;
}

function truncateText(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

// --- Deterministic ids -----------------------------------------------------

// Target envelope id scopes candidate ordinals (R21). Content hash over the
// run-scoped binding facts; no clock or randomness. adapter_proof_id already
// folds in warm_chrome_run_id and verified_endpoint_identity (it is itself a
// hash of them), so they are covered transitively. In route-bound mode runId is
// the route's run id, so the same route reproduces the same envelope id; in
// recovery mode runId is per-invocation, scoping ordinals within one listing.
function targetEnvelopeIdOf(input: {
	runId: string;
	mode: TargetDiscoveryMode;
	adapter: BrowserAdapterId;
	adapterProofId: string;
	routeEvidenceHash: string | undefined;
}): string {
	const canonical = JSON.stringify([
		input.runId,
		input.mode,
		input.adapter,
		input.adapterProofId,
		input.routeEvidenceHash ?? null,
	]);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

function candidateIdOf(targetEnvelopeId: string, ordinal: number): string {
	const canonical = JSON.stringify([targetEnvelopeId, ordinal]);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
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

function targetDiscoveryAction(id: TargetDiscoveryActionId): RuntimeActionGuidance {
	const action = targetDiscoveryActionById.get(id);
	if (!action) {
		throw new Error(`Unknown target discovery action id: ${id}`);
	}
	return {
		id: action.id,
		summary: action.summary,
		side_effects: [...action.sideEffects],
	};
}

// --- Small shared field helpers --------------------------------------------

function isBrowserAdapterId(value: unknown): value is BrowserAdapterId {
	return (
		typeof value === "string" &&
		(BROWSER_ADAPTER_ROUTER_ADAPTERS as readonly string[]).includes(value)
	);
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function safeJsonObject(raw: string): Record<string, unknown> | undefined {
	try {
		const value = JSON.parse(raw);
		return isJsonObject(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeVersion(
	stdout: CliWriter,
	outputMode: OutputMode,
	runtime: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		stdout.write(`browser-use ${VERSION}\n`);
		return;
	}
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: runtime.runId,
			data: { name: "browser-use", version: VERSION },
		}),
		runtime,
	);
}

function emitCliError(input: {
	error: unknown;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const isUsage = input.error instanceof CliUsageError;
	const exitCode = isUsage ? USAGE_EXIT_CODE : RUNTIME_FAILURE_EXIT_CODE;
	const message =
		input.error instanceof Error ? input.error.message : "Unknown runtime error.";
	const safeMessage = redactUnsafeText(message);
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${isUsage ? "usage_error" : "runtime_error"}: ${safeMessage} (run_id=${input.runId})\n`,
		);
		return exitCode;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: exitCode,
			error: {
				run_id: input.runId,
				code: isUsage ? "usage_error" : "runtime_error",
				message: safeMessage,
				exit_code: exitCode,
				severity: isUsage ? "error" : "fatal",
				recoverability: isUsage ? "change_input" : "none",
				retryable: false,
				failure_domain: isUsage ? "input" : "runtime_diagnostics",
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return exitCode;
}

// ---------------------------------------------------------------------------
// Shared mcporter transport (plan U4).
//
// Browser Operation execution (the live operate path U7 lands) runs mcporter
// subcommands through the same transport Browser Adapter Proof uses. This wrapper
// resolves and prefixes the command vector via the shared core, then maps the
// neutral failure reasons onto the Browser Operation diagnostic taxonomy:
//   - invalid override   -> browser_operation_command_override_invalid (input)
//   - missing binary     -> browser_operation_dependency_missing (dependency
//                            recovery; never Warm Chrome repair or adapter
//                            fallback)
// AE10: identical command-vector semantics across both surfaces. The argv vector
// is passed positionally to runtime.runCommand and never shell-evaluated.
// ---------------------------------------------------------------------------

export type BrowserOperationTransportFailure =
	| {
			kind: "command_override_invalid";
			code: "browser_operation_command_override_invalid";
			message: string;
			hintSummary: string;
	  }
	| {
			kind: "dependency_missing";
			code: "browser_operation_dependency_missing";
			message: string;
			hintSummary: string;
	  }
	| {
			kind: "transport_timeout";
			code: "browser_operation_transport_timeout";
			message: string;
			hintSummary: string;
	  }
	| {
			kind: "execution_failed";
			code: "browser_operation_transport_failed";
			message: string;
			hintSummary: string;
	  };

export type BrowserOperationTransportResult =
	| { ok: true; result: McporterCommandResult }
	| { ok: false; failure: BrowserOperationTransportFailure };

// Run an mcporter subcommand for a Browser Operation. Returns a structured
// result U7's operation path maps onto its operation envelope. Failure routing
// mirrors Browser Adapter Proof so the two surfaces stay aligned (AE10): a
// missing binary or missing-command result routes to dependency recovery, a
// timed-out call routes to a distinct transport-timeout failure, and an invalid
// override routes to override-invalid. None fall back to an adapter or cold
// browser.
export async function runBrowserUseMcporter(
	runtime: BrowserUseRuntime,
	args: readonly string[],
): Promise<BrowserOperationTransportResult> {
	const outcome = await runMcporter(
		runtime,
		args,
		OPERATION_TRANSPORT_TIMEOUT_MS,
	);
	if (!outcome.ok) {
		if (outcome.reason === "invalid_override") {
			return {
				ok: false,
				failure: {
					kind: "command_override_invalid",
					code: "browser_operation_command_override_invalid",
					message: "mcporter command override is invalid.",
					hintSummary: mcporterOverrideInvalidHintText(outcome.message),
				},
			};
		}
		if (outcome.reason === "execution_failed") {
			// The command runner threw for a reason other than a spawn/start
			// failure. Report a distinct transport failure rather than telling the
			// operator mcporter is missing.
			return {
				ok: false,
				failure: {
					kind: "execution_failed",
					code: "browser_operation_transport_failed",
					message: "mcporter command execution failed unexpectedly.",
					hintSummary:
						"The mcporter transport failed without starting cleanly. Inspect the command runner before retrying the operation.",
				},
			};
		}
		return {
			ok: false,
			failure: dependencyMissingFailure(
				`${outcome.command} could not be started from the selected mcporter command vector.`,
			),
		};
	}
	// Guard the timeout before the missing-command check, matching Adapter Proof's
	// leaf ordering. A timed-out result carries exitCode 1 and empty output, so
	// without this branch it would be misreported as a clean success.
	if (outcome.result.timedOut) {
		return {
			ok: false,
			failure: {
				kind: "transport_timeout",
				code: "browser_operation_transport_timeout",
				message: "mcporter call timed out before the Browser Operation completed.",
				hintSummary:
					"The mcporter transport timed out. Retry, or repair Warm Chrome and the Browser Adapter before reattempting the operation.",
			},
		};
	}
	if (isMissingCommandResult(outcome.result)) {
		return {
			ok: false,
			failure: dependencyMissingFailure(
				"mcporter or the configured runner is missing.",
			),
		};
	}
	return { ok: true, result: outcome.result };
}

function dependencyMissingFailure(
	problem: string,
): Extract<BrowserOperationTransportFailure, { kind: "dependency_missing" }> {
	return {
		kind: "dependency_missing",
		code: "browser_operation_dependency_missing",
		message: "mcporter could not be started.",
		hintSummary: mcporterDependencyHintText(problem),
	};
}

// ---------------------------------------------------------------------------
// Argv parsing.
// ---------------------------------------------------------------------------

function parseBrowserUseArgv(
	argv: readonly string[],
): ParsedBrowserUseCommand {
	if (argv.includes("--version")) {
		return {
			kind: "version",
			outputMode: argv.includes("--json") ? "json" : "plain",
		};
	}

	const helpRequested = argv.includes("-h") || argv.includes("--help");

	// Resolve family/subcommand POSITIONALLY from the leading non-flag tokens.
	// The public form is `browser-use <family> <subcommand> [flags]`. Scanning
	// the whole argv by value (argv.find) would misread a flag VALUE equal to a
	// reserved word (e.g. `--state status`, `--origin targets`) as the
	// family/subcommand. Diagnostic flags are already stripped upstream, so any
	// remaining `--`-prefixed token starts the flag section.
	const positionals: string[] = [];
	for (const arg of argv) {
		if (arg.startsWith("-")) break;
		positionals.push(arg);
	}
	const familyToken = positionals[0];
	const family = isFamily(familyToken) ? familyToken : undefined;

	if (!family) {
		if (helpRequested) return { kind: "help" };
		throw usageError("missing command family: expected targets or operate.");
	}

	const subcommandToken = positionals[1];
	const subcommand =
		subcommandToken && subcommandsFor(family).includes(subcommandToken)
			? subcommandToken
			: undefined;

	if (helpRequested) {
		if (!subcommand) return { kind: "help", family };
		return {
			kind: "help",
			family,
			command: toCommand(family, subcommand),
		};
	}

	if (!subcommand) {
		throw usageError(
			`missing subcommand for ${family}: expected ${subcommandsFor(family).join(", ")}.`,
		);
	}

	const command = toCommand(family, subcommand);
	// Strip exactly the two leading positional tokens, not every occurrence of
	// their string value, so a flag value equal to the family/subcommand word
	// survives into rejectUnknownFlags' value-pairing.
	const rest = argv.slice(2);
	const flags = browserUseContracts[command].flags ?? {};
	rejectUnknownFlags(rest, flags);
	const flagValues = collectFlagValues(rest, flags);
	const dryRun = rest.includes("--dry-run");

	return {
		kind: "command",
		command,
		family,
		subcommand,
		outputMode: outputModeFor(command, rest),
		dryRun,
		flagValues,
	};
}

// Collect declared-flag values from the post-positional argv slice. Mirrors
// rejectUnknownFlags' value-pairing: boolean flags map to "", value-bearing
// flags (per declared type, not token shape) take the next token even when it
// starts with "--". The contract already accepted these flags, so this never
// sees an unknown flag.
function collectFlagValues(
	argv: readonly string[],
	flags: Readonly<Record<string, FlagSpec>>,
): Record<string, string> {
	const values: Record<string, string> = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		const hasInline = arg.includes("=");
		const name = hasInline ? arg.slice(0, arg.indexOf("=")) : arg;
		const spec = flags[name];
		if (!spec) continue;
		if (spec.type === "boolean") {
			values[name] = "";
			continue;
		}
		if (hasInline) {
			values[name] = arg.slice(arg.indexOf("=") + 1);
			continue;
		}
		if (index + 1 < argv.length) {
			values[name] = argv[index + 1];
			index += 1;
		}
	}
	return values;
}

function isFamily(value: string | undefined): value is BrowserUseFamily {
	return (BROWSER_USE_FAMILIES as readonly string[]).includes(value ?? "");
}

function subcommandsFor(family: BrowserUseFamily): readonly string[] {
	return family === "targets"
		? BROWSER_USE_TARGETS_SUBCOMMANDS
		: BROWSER_USE_OPERATE_SUBCOMMANDS;
}

function toCommand(
	family: BrowserUseFamily,
	subcommand: string,
): BrowserUseCommand {
	return `${family}-${subcommand}` as BrowserUseCommand;
}

type FlagSpec = { type?: string };

function rejectUnknownFlags(
	argv: readonly string[],
	flags: Readonly<Record<string, FlagSpec>>,
): void {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
		const spec = flags[name];
		if (!spec) {
			throw usageError(`unknown option: ${sanitizeUsageValue(name)}`);
		}
		// Consume the value token for space-separated value-bearing flags. Use the
		// declared flag type, not the next token's shape, so a value that itself
		// starts with `--` (e.g. `--title-contains --beta`) is still its value and
		// is not misread as a separate unknown flag.
		if (!arg.includes("=") && spec.type !== "boolean" && index + 1 < argv.length) {
			index += 1;
		}
	}
}

// Output mode keys on the resolved command, then explicit flags. status is a
// human projection (plain default); every other command is machine-first JSON.
// Keying on the command (not an argv token scan) keeps a flag VALUE of "status"
// from flipping output mode.
function outputModeFor(
	command: BrowserUseCommand,
	rest: readonly string[],
): OutputMode {
	if (rest.includes("--plain")) return "plain";
	if (rest.includes("--json")) return "json";
	return command === "targets-status" ? "plain" : "json";
}

// Output mode for pre-parse error paths (diagnostic-parse or command-parse
// failure) where no command is resolved yet. Flag-only; default JSON so an
// agent can machine-read the error explaining what went wrong.
function errorOutputMode(argv: readonly string[]): OutputMode {
	if (argv.includes("--plain")) return "plain";
	return "json";
}

function applyEnvRunId(
	argv: readonly string[],
	runId: string | undefined,
): readonly string[] {
	if (!runId) return argv;
	if (argv.includes("--run-id")) return argv;
	return [...argv, "--run-id", runId];
}

// ---------------------------------------------------------------------------
// Redaction + help.
// ---------------------------------------------------------------------------

function sanitizeUsageValue(value: string): string {
	if (
		value.startsWith("/") ||
		value.startsWith("~/") ||
		value.startsWith("op://") ||
		hasSensitiveOptionName(value)
	) {
		return "[redacted]";
	}
	return redactUnsafeText(value);
}

function redactUnsafeText(value: string): string {
	return value
		.replace(/\bop:\/\/\S+/gi, "[redacted]")
		.replace(/--[A-Za-z0-9][\w-]*(?:=\S*)?/g, (match) =>
			hasSensitiveOptionName(match) ? "[redacted]" : match,
		)
		.replace(/(^|[\s:(])(?:~\/|\/)\S+/g, "$1[redacted]");
}

function hasSensitiveOptionName(value: string): boolean {
	return /(?:password|passwd|passphrase|secret|token|api[-_]?key|credential|auth|cookie|session)/i.test(
		value,
	);
}

function renderHelp(
	family?: BrowserUseFamily,
	command?: BrowserUseCommand,
): string {
	if (command) {
		return `${renderCommandUsage(browserUseContracts[command])}\n${ROUTE_PREREQUISITE_POINTER}\n`;
	}
	if (family) return renderFamilyHelp(family);
	return renderRootHelp();
}

function renderFamilyHelp(family: BrowserUseFamily): string {
	const subLines = subcommandsFor(family).map((sub) => {
		const contract = browserUseContracts[toCommand(family, sub)];
		return `  ${sub.padEnd(10)} ${contract.summary}`;
	});
	return [
		`Usage: browser-use ${family} <subcommand> [flags]`,
		"",
		"Subcommands:",
		...subLines,
		"",
		ROUTE_PREREQUISITE_POINTER,
		"",
	].join("\n");
}

function renderRootHelp(): string {
	const familyLines = BROWSER_USE_FAMILIES.map((family) => {
		const summary =
			family === "targets"
				? "Browser Target Discovery, Selection, and status."
				: "Browser Operations: snapshot, screenshot, emulate.";
		return `  ${family.padEnd(8)} ${summary}`;
	});
	return [
		"Usage: browser-use <family> <subcommand> [flags]",
		"",
		"Command families:",
		...familyLines,
		"",
		"Global diagnostic flags:",
		"  --run-id <id>   Set run correlation id.",
		"  --quiet         Suppress diagnostics.",
		"  --verbose       Emit info diagnostics to stderr.",
		"  --debug         Emit debug diagnostics to stderr.",
		"  --version       Print version.",
		"",
		ROUTE_PREREQUISITE_POINTER,
		"",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Test harness.
// ---------------------------------------------------------------------------

class BufferWriter implements CliWriter {
	private content = "";
	write(value: string): boolean {
		this.content += value;
		return true;
	}
	toString(): string {
		return this.content;
	}
}

export async function runForTest(
	argv: readonly string[],
	runtime: BrowserUseRuntime,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runBrowserUseCli(argv, { runtime, stdout, stderr });
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

export {
	BROWSER_USE_OPERATE_SUBCOMMANDS,
	BROWSER_USE_TARGETS_SUBCOMMANDS,
	type BrowserUseCommand,
	type BrowserUseOperateSubcommand,
	type BrowserUseTargetsSubcommand,
};

if (import.meta.main) {
	const exitCode = await runBrowserUseCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
