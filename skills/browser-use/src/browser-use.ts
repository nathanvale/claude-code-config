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
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import {
	type CliWriter,
	type CommandFacadeSideEffect,
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
	BROWSER_ADAPTER_PROOF_ADAPTERS,
	BROWSER_ADAPTER_PROOF_CONTRACT_ID,
	BROWSER_ADAPTER_ROUTER_ADAPTERS,
	BROWSER_ADAPTER_ROUTER_CAPABILITIES,
	BROWSER_ADAPTER_ROUTER_CONTRACT_ID,
	BROWSER_USE_OPERATION_CONTRACT_ID,
	BROWSER_USE_OPERATION_SCHEMA_VERSION,
	BROWSER_USE_FAMILIES,
	BROWSER_USE_OPERATE_SUBCOMMANDS,
	BROWSER_USE_TARGETS_CONTRACT_ID,
	BROWSER_USE_TARGETS_SUBCOMMANDS,
	type BrowserUseCommand,
	type BrowserUseFamily,
	type BrowserUseOperateSubcommand,
	type BrowserUseTargetsSubcommand,
	browserUseContracts,
	browserUseOperationFailureActions,
	browserUseOperationSuccessActions,
	browserUseTargetDiscoveryFailureActions,
	browserUseTargetDiscoverySuccessActions,
	browserUseTargetSelectionFailureActions,
	browserUseTargetSelectionSuccessActions,
} from "./command-contract";
import type {
	AdapterCapability,
	BrowserAdapterId,
	BrowserOperationClass,
	BrowserTargetCandidate,
	RouteBinding,
	TargetDiscoveryBinding,
	TargetDiscoveryEnvelope,
	TargetDiscoveryMode,
} from "./browser-adapter-router-model";
import { authorizesOperationClass } from "./browser-adapter-router-engine";
import {
	emitWithDiagnostics,
	quietDiagnosticWriter,
} from "./cli-diagnostics-bootstrap";
import {
	type McporterCommandInput,
	type McporterCommandResult,
	spawnMcporterCommand,
} from "./mcporter-transport";
import {
	type BrowserOperationTransportFailure,
	type BrowserOperationTransportResult,
	runBrowserUseMcporter,
} from "./browser-use-transport";

const VERSION = "0.1.0";
const BINDING_FAIL_CLOSED_EXIT_CODE = 20;
const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const NOT_IMPLEMENTED_EXIT_CODE = 1;
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
	// Read a supplied evidence file (--route, --adapter-proof) or selected-target
	// state (--state). Kept on the runtime so the discovery/selection assembler
	// stays pure and the CLI driver owns all I/O (mirrors AdapterProofRuntime /
	// prepare's read-then-assemble split).
	readTextFile: (path: string) => Promise<string>;
	// Write run-scoped selected-target state (U6). Owner-only and atomic: the
	// default writes a temp sibling with 0600 perms then renames it over the
	// target so a partial write is never observed and the file is never group/
	// world readable. Kept on the runtime so the selection assembler stays pure
	// and the CLI driver owns the single write.
	writeTextFile: (path: string, contents: string) => Promise<void>;
	// Create local artifact directories before browser operations that write files.
	// This keeps filesystem failures before live browser focus/operation side
	// effects.
	ensureDirectory: (path: string) => Promise<void>;
	// Read the piped stdin envelope `targets select` resolves against (U6),
	// mirroring the Router envelope seam. Returns "" when nothing is piped; the
	// inline env var is the fallback the CLI driver applies when this is empty.
	readStdin: () => Promise<string>;
};

export function createDefaultBrowserUseRuntime(
	overrides: Partial<BrowserUseRuntime> = {},
): BrowserUseRuntime {
		return {
			env: { ...process.env },
			now: () => Date.now(),
			runCommand: (input: McporterCommandInput) => spawnMcporterCommand(input),
			readTextFile: (path: string) => readFile(path, "utf-8"),
			writeTextFile: (path: string, contents: string) =>
				writeStateFileAtomically(path, contents),
			ensureDirectory: async (path: string) => {
				await mkdir(path, { recursive: true, mode: 0o700 });
			},
			readStdin: () => readAllStdin(),
			...overrides,
		};
	}

// Read all of stdin as UTF-8. An interactive terminal has no piped envelope, so
// return "" rather than blocking on a TTY; the CLI driver then falls back to the
// inline env var. Mirrors the Router stdin seam: collect raw chunks and decode
// ONCE over the joined bytes. Decoding per chunk (`data += toString` per chunk)
// corrupts any multi-byte UTF-8 codepoint split across a chunk boundary (finding
// #5); Buffer.concat then a single decode keeps codepoints intact.
async function readAllStdin(): Promise<string> {
	if (process.stdin.isTTY) return "";
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
	}
	return decodeStdinChunks(chunks);
}

// Concatenate raw stdin byte chunks and decode ONCE as UTF-8. Decoding each
// chunk independently corrupts a multi-byte codepoint that straddles a chunk
// boundary; joining the bytes first then decoding keeps codepoints intact
// (finding #5). Exported so the boundary-decode behavior is unit-testable
// without a live stdin pipe.
export function decodeStdinChunks(
	chunks: readonly Uint8Array[],
): string {
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
		"utf-8",
	);
}

// Atomic, owner-only state write. Write a temp sibling in the same directory
// (so rename stays on one filesystem and is atomic), force 0600 via the open
// mode, then rename over the target. A crash mid-write leaves the temp file, not
// a half-written state file. The temp suffix carries the pid so two processes
// writing the same run state do not clobber each other's temp file before the
// rename. No randomness or clock reads here: the suffix need only be unique per
// concurrent writer, not unpredictable, and the state contents own freshness.
async function writeStateFileAtomically(
	path: string,
	contents: string,
): Promise<void> {
	const tempPath = `${path}.tmp-${process.pid}`;
	await writeFile(tempPath, contents, { mode: 0o600 });
	await rename(tempPath, path);
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
		return emitWithDiagnostics({
			categoryRoot: "browser-use.cli",
			options: diagnosticArgv.options,
			stderr,
			run: () =>
				emitCliError({
					error:
						error instanceof Error
							? usageError(error.message)
							: usageError("invalid diagnostic flags"),
					outputMode,
					stdout,
					stderr,
					runId: diagnosticArgv.options.runId,
					durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
				}),
		});
	}

	const outputMode = errorOutputMode(diagnosticArgv.argv);
	let parsed: ParsedBrowserUseCommand;
	try {
		parsed = parseBrowserUseArgv(diagnosticArgv.argv);
	} catch (error) {
		return emitWithDiagnostics({
			categoryRoot: "browser-use.cli",
			options: diagnosticArgv.options,
			stderr,
			run: () =>
				emitCliError({
					error,
					outputMode,
					stdout,
					stderr,
					runId: diagnosticArgv.options.runId,
					durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
				}),
		});
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
			// A run id is EXPLICIT when the caller set it via the --run-id flag or
			// BROWSER_USE_RUN_ID env; otherwise runId is the facade's per-invocation
			// random id, which must NOT drive run-scoped state correlation (U6).
			// Detect the flag with a proper flag parse (stops at the `--` terminator,
			// requires a standalone --run-id token), NOT a raw argv substring scan: a
			// substring scan flips true for a value smuggled past `--` (e.g. a state
			// path literally named --run-id) while the diagnostic layer left runId
			// random, producing a spurious cross-run failure.
			const runIdExplicit =
				stringField(runtime.env.BROWSER_USE_RUN_ID) !== undefined ||
				parsedRunIdFlag(diagnosticInput) !== undefined;
			const durationMs = () =>
				runtime.now() - diagnosticArgv.options.startedAtMs;
				return executeCommand({
					parsed,
					runtime,
					stdout,
					stderr,
					runId,
					runIdExplicit,
					diagnosticVerbose: diagnosticArgv.options.verbose,
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
	runIdExplicit: boolean;
	diagnosticVerbose: boolean;
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

	// Browser Target Selection (U6). `targets select` resolves a route-bound
	// discovery envelope to one candidate and writes run-scoped state; `targets
	// status` projects that state. Both are live state surfaces, so dry-run still
	// short-circuits to the mock envelope below.
	if (parsed.command === "targets-select" && !parsed.dryRun) {
			return runTargetsSelect({
				parsed,
				runtime,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				runIdExplicit: input.runIdExplicit,
				durationMs: input.durationMs,
			});
	}
	if (parsed.command === "targets-status" && !parsed.dryRun) {
			return runTargetsStatus({
				parsed,
				runtime,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				runIdExplicit: input.runIdExplicit,
				durationMs: input.durationMs,
			});
	}

	if (parsed.family === "operate" && !parsed.dryRun) {
		return runOperate({
			parsed,
			runtime,
			stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				runIdExplicit: input.runIdExplicit,
				diagnosticVerbose: input.diagnosticVerbose,
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

// Shared failure record. actionId is the only axis that varies per surface;
// the recoverability literal is owned here once.
type Failure<A extends string> = {
	code: string;
	message: string;
	actionId: A;
	exitCode: number;
	recoverability: "change_input" | "retry" | "repair_state" | "none";
};

type TargetDiscoveryFailure = Failure<TargetDiscoveryActionId>;

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
	binding: RouteBinding;
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

type RawPage = { id?: string; title?: string; url?: string };

type DiscoverResult =
	| { ok: true; pages: RawPage[] }
	| { ok: false; failure: TargetDiscoveryFailure };

async function discoverPages(
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
		candidate_id: candidateIdOf(targetEnvelopeId, candidateIdentityOf(page, ordinal)),
		origin: parsed?.origin ?? "",
		...(showUrl && parsed ? { path_shape: redactPathShape(parsed) } : {}),
		...(title ? { title } : {}),
	};
}

function candidateIdentityOf(page: RawPage, ordinal: number): unknown[] {
	const pageId = stringField(page.id);
	if (pageId) return ["adapter_page_id", pageId];
	const parsed = parseUrlSafe(page.url);
	return [
		"display_fallback",
		parsed?.origin ?? "",
		parsed?.pathname ?? "",
		redactTitle(page.title) ?? "",
		ordinal,
	];
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

// Redacted path shape (R32, AE11): a structural projection of the pathname, not
// the literal segments. Query strings and fragments are dropped entirely (an
// opaque marker records that one existed); each path segment is replaced with a
// type token when it looks like an identifier or secret (numeric id, UUID,
// opaque hex/long token), so reset links, invite codes, and opaque ids never
// leak. Short readable words are kept as semantic hints. Depth is capped.
const PATH_SHAPE_MAX_SEGMENTS = 6;

function redactPathShape(parsed: URL): string {
	const segments = parsed.pathname.split("/").filter((s) => s !== "");
	const shaped = segments
		.slice(0, PATH_SHAPE_MAX_SEGMENTS)
		.map(shapePathSegment);
	if (segments.length > PATH_SHAPE_MAX_SEGMENTS) shaped.push("…");
	const path = shaped.length === 0 ? "/" : `/${shaped.join("/")}`;
	const marker = parsed.search !== "" || parsed.hash !== "" ? " […]" : "";
	return `${truncateText(path, 120)}${marker}`;
}

// Map one path segment to a type token when it carries identifier/secret shape,
// otherwise keep a short readable literal. Errs toward redaction: a segment that
// mixes letters and digits, or is long, reads as an opaque handle and is shaped
// rather than echoed. Only pure readable words survive as semantic hints.
function shapePathSegment(segment: string): string {
	const decoded = safeDecode(segment);
	if (/^\d+$/.test(decoded)) return ":num";
	if (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded)
	) {
		return ":uuid";
	}
	// Anything with a non-word character (encoded bytes, separators beyond . _ -)
	// is opaque.
	if (/[^a-zA-Z0-9._-]/.test(decoded)) return ":str";
	// A segment mixing letters and digits is an identifier/handle (invite codes,
	// short ids, hex blobs), not a readable noun; shape it.
	if (/\d/.test(decoded) && /[a-zA-Z]/.test(decoded)) return ":id";
	// Long pure-letter segment is more likely an opaque token than a word.
	if (decoded.length > 24) return ":id";
	return decoded;
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
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

function candidateIdOf(targetEnvelopeId: string, identity: unknown[]): string {
	const canonical = JSON.stringify([targetEnvelopeId, identity]);
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

// Project a registry action into runtime guidance. The id-param type is pinned
// by each per-surface wrapper below; this helper stays untyped on id.
function actionFor(
	map: Map<
		string,
		{
			id: string;
			summary: string;
			sideEffects: readonly CommandFacadeSideEffect[];
		}
	>,
	id: string,
	label: string,
): RuntimeActionGuidance {
	const action = map.get(id);
	if (!action) {
		throw new Error(`Unknown ${label} action id: ${id}`);
	}
	return {
		id: action.id,
		summary: action.summary,
		side_effects: [...action.sideEffects],
	};
}

function targetDiscoveryAction(id: TargetDiscoveryActionId): RuntimeActionGuidance {
	return actionFor(targetDiscoveryActionById, id, "target discovery");
}

// ---------------------------------------------------------------------------
// Browser Target Selection (plan U6).
//
// `browser-use targets select` turns a route-bound `targets list` success
// envelope plus one selector (a candidate ordinal OR Browser Target Hints) into
// run-scoped selected-target state. `browser-use targets status` projects that
// state for a human. A pure resolver (resolveOperationTarget) is exported for
// the U7 `operate` front door.
//
// Selection discipline (R20, R25, AE5): only route-bound, operation-ready
// candidates are selectable. A recovery-mode envelope (route_bound=false or
// operation_ready=false) is rejected — its candidates are evidence-gathering
// only. The supplied envelope is the candidate source; --route/--adapter-proof,
// when supplied, are cross-checked against the envelope binding and must agree
// (U5 review rigor: require contract identity, reject internally inconsistent
// bindings, fail closed on mismatch).
//
// State discipline: selected state is explicit run state, not ambient latest-tab
// state. It is written owner-only and atomically, carries a short TTL, and binds
// to the run/route/proof/target envelope so `status` and `operate` fail closed
// on stale, mismatched, or cross-run state. Every distinct state cause (missing,
// unreadable, stale, mismatched, cross-run) maps to its own code + continuation.
//
// Privacy (R32, KTD7): state display facts reuse the same redaction the U5
// candidate projection uses — origin plus an optional redacted path shape and a
// length-bounded title. No query strings, fragments, raw page ids, CDP target
// ids, or WebSocket debugger URLs are ever written to state, JSON, or logs.
// ---------------------------------------------------------------------------

const TARGET_SELECTION_EXIT_CODE = 20;
// Selected-target state shares the Browser Targets result-contract identity, so
// a foreign or hand-written file cannot pass as selected state.
const SELECTED_TARGET_STATE_CONTRACT_ID = BROWSER_USE_TARGETS_CONTRACT_ID;
const SELECTED_TARGET_STATE_SCHEMA_VERSION = "1";
// Short TTL: selected state binds to a live tab and a fresh proof; a stale
// selection must be re-made rather than silently operated against.
const SELECTED_TARGET_STATE_TTL_MS = 15 * 60_000;

type SelectionActionId =
	| (typeof browserUseTargetSelectionFailureActions)[number]["id"]
	| (typeof browserUseTargetSelectionSuccessActions)[number]["id"];
type SelectionFailureActionId =
	(typeof browserUseTargetSelectionFailureActions)[number]["id"];

const selectionActions = [
	...browserUseTargetSelectionFailureActions,
	...browserUseTargetSelectionSuccessActions,
] as const;
const selectionActionById = new Map(
	selectionActions.map((action) => [action.id, action]),
);

type SelectionFailure = Failure<SelectionFailureActionId>;

// Run-scoped selected-target state. Written by `targets select`, read by
// `targets status` and (U7) `operate`. Display facts are already redacted; the
// binding mirrors the route-bound discovery binding plus the selected candidate.
type SelectedTargetState = {
	// The persisted contract id as read. status/operate reject any value other
	// than SELECTED_TARGET_STATE_CONTRACT_ID; carrying the real value (not a
	// constant) is what makes the wrong-contract check observable.
	contract: string;
	schema_version: string;
	run_id: string;
	selected_adapter_id: BrowserAdapterId;
	warm_chrome_run_id: string;
	adapter_proof_id: string;
	verified_endpoint_identity: string;
	route_evidence_hash: string;
	target_envelope_id: string;
	// The selected candidate. candidate_id is the per-envelope id; ordinal is the
	// public handle scoped to target_envelope_id.
	target_candidate_id: string;
	selected_candidate_ordinal: number;
	// Epoch-ms freshness, derived from runtime.now(); no wall-clock formatting.
	emitted_at_ms: number;
	expires_at_ms: number;
	// Redacted display facts (same projection as U5 candidates).
	display: { origin: string; path_shape?: string; title?: string };
};

// Route-bound discovery binding parsed from the supplied envelope. Every field
// is required for an operation-ready selection.
type SelectionEnvelopeBinding = {
	runId: string;
	selectedAdapter: BrowserAdapterId;
	warmChromeRunId: string;
	adapterProofId: string;
	verifiedEndpointIdentity: string;
	routeEvidenceHash: string;
	targetEnvelopeId: string;
};

type SelectionEnvelope = {
	binding: SelectionEnvelopeBinding;
	candidates: BrowserTargetCandidate[];
};

async function runTargetsSelect(input: {
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
	const fail = (failure: SelectionFailure) =>
		emitSelectionFailure({
			failure,
			command: "targets-select",
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});

	// 1. Read the route-bound targets list success envelope (stdin, else inline
	// env). Empty input is a distinct, recoverable usage failure, not a crash.
	const stdin = await runtime.readStdin();
	const rawEnvelope =
		stdin.trim() !== ""
			? stdin
			: (runtime.env.BROWSER_USE_TARGETS_ENVELOPE_JSON ?? "");
	if (rawEnvelope.trim() === "") {
		return fail({
			code: "target_selection_envelope_invalid",
			message:
				"targets select requires a route-bound targets list success envelope on stdin or BROWSER_USE_TARGETS_ENVELOPE_JSON.",
			actionId: "rerun_route_bound_target_discovery",
			exitCode: TARGET_SELECTION_EXIT_CODE,
			recoverability: "change_input",
		});
	}

	const envelopeParse = parseSelectionEnvelope(rawEnvelope);
	if (!envelopeParse.ok) return fail(envelopeParse.failure);
	const envelope = envelopeParse.envelope;

	// 2. Cross-check supplied route/proof evidence against the envelope binding.
	// The envelope is the candidate source, but a caller may also pass --route /
	// --adapter-proof; if they disagree with what produced the envelope, fail
	// closed rather than selecting against ambiguous evidence (R9 rigor).
	const crossCheck = await crossCheckSelectionEvidence(
		runtime,
		flags,
		envelope.binding,
	);
	if (crossCheck) return fail(crossCheck);

	// 2b. When the caller asserts a run (explicit --run-id / BROWSER_USE_RUN_ID),
	// the envelope's route run must be that run. Selecting an envelope from a
	// different route run into this run's state is a cross-run mistake; fail
	// closed at select time rather than writing state that `status`/`operate`
	// would later reject. With no explicit run id, the envelope's route run is
	// authoritative and is used to correlate the run end to end.
	if (input.runIdExplicit && envelope.binding.runId !== input.runId) {
		return fail({
			code: "target_state_cross_run",
			message:
				"The supplied targets list envelope belongs to a different run than the asserted run id.",
			actionId: "rerun_route_bound_target_discovery",
			exitCode: TARGET_SELECTION_EXIT_CODE,
			recoverability: "change_input",
		});
	}

	// 3. Resolve exactly one candidate from the envelope via ordinal XOR hints.
	const selector = readSelector(flags);
	if (!selector.ok) return fail(selector.failure);
	const resolution = resolveSelectionCandidate(envelope.candidates, selector.value);
	if (!resolution.ok) return fail(resolution.failure);
	const candidate = resolution.candidate;

	// 4. Resolve the state path (--state, else deterministic env-derived path).
	// Key the env-derived path on the canonical invocation run id so `status` and
	// `operate` — which only know the invocation run id, not the envelope —
	// resolve the SAME path. In correct end-to-end use the envelope's route run
	// equals input.runId (enforced above when explicit), so this is coherent; the
	// state's own run_id still records the envelope's route run for provenance.
	const statePath = resolveStatePath(
		flags,
		runtime.env,
		input.runId,
		input.runIdExplicit,
	);
	if (!statePath.ok) return fail(statePath.failure);

	// 5. Assemble and atomically write run-scoped selected state.
	const emittedAtMs = runtime.now();
	const state: SelectedTargetState = {
		contract: SELECTED_TARGET_STATE_CONTRACT_ID,
		schema_version: SELECTED_TARGET_STATE_SCHEMA_VERSION,
		run_id: envelope.binding.runId,
		selected_adapter_id: envelope.binding.selectedAdapter,
		warm_chrome_run_id: envelope.binding.warmChromeRunId,
		adapter_proof_id: envelope.binding.adapterProofId,
		verified_endpoint_identity: envelope.binding.verifiedEndpointIdentity,
		route_evidence_hash: envelope.binding.routeEvidenceHash,
		target_envelope_id: envelope.binding.targetEnvelopeId,
		target_candidate_id: candidate.candidate_id,
		selected_candidate_ordinal: candidate.candidate_ordinal,
		emitted_at_ms: emittedAtMs,
		expires_at_ms: emittedAtMs + SELECTED_TARGET_STATE_TTL_MS,
		display: {
			origin: candidate.origin,
			...(candidate.path_shape ? { path_shape: candidate.path_shape } : {}),
			...(candidate.title ? { title: candidate.title } : {}),
		},
	};

	try {
		await runtime.writeTextFile(statePath.path, `${JSON.stringify(state)}\n`);
	} catch {
		// Conflict / permission / IO failure on the write. The path itself is
		// already redacted before it reaches output; do not echo the OS error.
		return fail({
			code: "target_selection_state_write_failed",
			message: "The run-scoped selected-target state could not be written.",
			actionId: "repair_target_state",
			exitCode: TARGET_SELECTION_EXIT_CODE,
			recoverability: "repair_state",
		});
	}

	return emitSelectionSuccess({
		state,
		outputMode: parsed.outputMode,
		stdout: input.stdout,
		runId: input.runId,
		durationMs: input.durationMs(),
	});
}

async function runTargetsStatus(input: {
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
	const fail = (failure: SelectionFailure) =>
		emitSelectionFailure({
			failure,
			command: "targets-status",
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});

	const statePath = resolveStatePath(
		flags,
		runtime.env,
		input.runId,
		input.runIdExplicit,
	);
	if (!statePath.ok) return fail(statePath.failure);

	// Cross-run check keys on the canonical invocation run id (input.runId, which
	// the facade resolves from --run-id OR BROWSER_USE_RUN_ID), gated on it being
	// EXPLICIT. The facade's per-invocation random id would force a spurious
	// cross-run failure on every ad-hoc status call, so an unset run id skips the
	// check; an explicitly-asserted run id makes a state from another run a real
	// cross-run mismatch — covering both the flag and env sources (finding #2).
	const load = await loadSelectedState(runtime, statePath.path, {
		now: runtime.now(),
		expectedRunId: input.runIdExplicit ? input.runId : undefined,
	});
	if (!load.ok) return fail(load.failure);

	return emitStatusSuccess({
		state: load.state,
		now: runtime.now(),
		outputMode: parsed.outputMode,
		stdout: input.stdout,
		runId: input.runId,
		durationMs: input.durationMs(),
	});
}

// --- Selection envelope parsing --------------------------------------------

type SelectionEnvelopeParse =
	| { ok: true; envelope: SelectionEnvelope }
	| { ok: false; failure: SelectionFailure };

// Parse and validate the supplied route-bound targets list success envelope.
// Rejects recovery-mode envelopes (AE5), envelopes missing the Browser Targets
// result-contract identity, and internally inconsistent bindings.
function parseSelectionEnvelope(raw: string): SelectionEnvelopeParse {
	const invalid = (detail: string): SelectionEnvelopeParse => ({
		ok: false,
		failure: {
			code: "target_selection_envelope_invalid",
			message: `The supplied targets list envelope is invalid: ${detail}.`,
			actionId: "rerun_route_bound_target_discovery",
			exitCode: TARGET_SELECTION_EXIT_CODE,
			recoverability: "change_input",
		},
	});
	const value = safeJsonObject(raw);
	if (!value) return invalid("not a JSON object");
	if (value.status !== "ok") return invalid("status is not ok");
	const data = isJsonObject(value.data) ? value.data : undefined;
	if (!data) return invalid("data is missing");
	// Require the Browser Targets result-contract identity. A missing contract is
	// rejected outright, not waved through (U5 review rigor).
	if (data.contract !== SELECTED_TARGET_STATE_CONTRACT_ID) {
		return invalid("data.contract is not the Browser Targets contract");
	}
	// AE5 / R25: only route-bound, operation-ready candidates are selectable.
	if (data.route_bound !== true || data.operation_ready !== true) {
		return {
			ok: false,
			failure: {
				code: "target_selection_recovery_rejected",
				message:
					"The supplied targets list output is recovery-mode (evidence-gathering only); selection requires route-bound, operation-ready candidates.",
				actionId: "rerun_route_bound_target_discovery",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	const binding = isJsonObject(data.binding) ? data.binding : undefined;
	if (!binding) return invalid("binding is missing");
	const selectedAdapter = binding.selected_adapter_id;
	if (!isBrowserAdapterId(selectedAdapter)) {
		return invalid("binding selected adapter is missing or unknown");
	}
	// requested_adapter must agree with the binding's selected adapter; a mismatch
	// is an internally inconsistent envelope and must not authorize a selection.
	if (
		data.requested_adapter !== undefined &&
		data.requested_adapter !== selectedAdapter
	) {
		return invalid(
			"requested_adapter disagrees with binding selected_adapter_id",
		);
	}
	const runId = stringField(binding.run_id);
	const warmChromeRunId = stringField(binding.warm_chrome_run_id);
	const adapterProofId = stringField(binding.adapter_proof_id);
	const verifiedEndpointIdentity = stringField(
		binding.verified_endpoint_identity,
	);
	const targetEnvelopeId = stringField(binding.target_envelope_id);
	// Route-bound bindings carry the route slice (R18); a route-bound envelope
	// without it is internally inconsistent.
	const routeEvidenceHash = stringField(binding.route_evidence_hash);
	if (
		!runId ||
		!warmChromeRunId ||
		!adapterProofId ||
		!verifiedEndpointIdentity ||
		!targetEnvelopeId ||
		!routeEvidenceHash
	) {
		return invalid("binding fields are incomplete for an operation-ready route");
	}
	const candidates = parseEnvelopeCandidates(data.candidates);
	if (!candidates) return invalid("candidates are missing or malformed");
	if (candidates.length === 0) return invalid("candidate set is empty");
	// Ordinals and candidate ids must be unique within the envelope: `--candidate
	// <ordinal>` and hint resolution both assume one candidate per handle, so a
	// duplicate would let resolveSelectionCandidate silently pick the first match.
	// Reject the malformed envelope rather than resolve ambiguously.
	const seenOrdinals = new Set<number>();
	const seenIds = new Set<string>();
	for (const candidate of candidates) {
		if (seenOrdinals.has(candidate.candidate_ordinal)) {
			return invalid("duplicate candidate_ordinal in envelope");
		}
		if (seenIds.has(candidate.candidate_id)) {
			return invalid("duplicate candidate_id in envelope");
		}
		seenOrdinals.add(candidate.candidate_ordinal);
		seenIds.add(candidate.candidate_id);
	}
	// candidate_count, when present, must match the candidate array length.
	if (
		typeof data.candidate_count === "number" &&
		data.candidate_count !== candidates.length
	) {
		return invalid("candidate_count does not match the candidate array");
	}
	return {
		ok: true,
		envelope: {
			binding: {
				runId,
				selectedAdapter,
				warmChromeRunId,
				adapterProofId,
				verifiedEndpointIdentity,
				routeEvidenceHash,
				targetEnvelopeId,
			},
			candidates,
		},
	};
}

// Parse the candidate array from the supplied envelope into display-safe
// candidates. Only the public candidate facts are read; any extra fields are
// dropped. Ordinals must be present and positive.
function parseEnvelopeCandidates(
	value: unknown,
): BrowserTargetCandidate[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const candidates: BrowserTargetCandidate[] = [];
	for (const entry of value) {
		if (!isJsonObject(entry)) return undefined;
			const ordinal = entry.candidate_ordinal;
			const candidateId = stringField(entry.candidate_id);
			if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 1) {
				return undefined;
			}
			if (!candidateId) return undefined;
			const display = safeDisplayFacts(candidateId, entry);
			if (!display) return undefined;
			candidates.push({
				candidate_ordinal: ordinal,
				candidate_id: candidateId,
				origin: display.origin,
				...(display.path_shape ? { path_shape: display.path_shape } : {}),
				...(display.title ? { title: display.title } : {}),
			});
		}
		return candidates;
	}

function safeDisplayFacts(
	candidateId: string,
	display: Record<string, unknown>,
): { origin: string; path_shape?: string; title?: string } | undefined {
	const candidateUrl = parseUrlSafe(candidateId);
	if (candidateUrl) {
		return {
			origin: candidateUrl.origin,
			path_shape: redactPathShape(candidateUrl),
			title: safeDisplayTitle(display.title),
		};
	}

	const origin = safeDisplayOrigin(display.origin);
	if (!origin) return undefined;
	const pathShape = safeDisplayPathShape(display.path_shape);
	const title = safeDisplayTitle(display.title);
	return {
		origin,
		...(pathShape ? { path_shape: pathShape } : {}),
		...(title ? { title } : {}),
	};
}

function safeDisplayOrigin(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const parsed = parseUrlSafe(value);
	if (!parsed || parsed.origin !== value) return undefined;
	return parsed.origin;
}

function safeDisplayPathShape(value: unknown): string | undefined {
	if (typeof value !== "string" || value.trim() === "") return undefined;
	if (value.includes("?") || value.includes("#")) return undefined;
	if (value.length > 140) return undefined;
	return truncateText(value.trim(), 120);
}

function safeDisplayTitle(value: unknown): string | undefined {
	return typeof value === "string" ? redactTitle(value) : undefined;
}

// --- Route/proof cross-check (optional, fail-closed on disagreement) -------

// When the caller also supplies --route / --adapter-proof, they must agree with
// the envelope's binding. The envelope already encodes which route+proof
// produced it; a contradicting flag is a caller mistake we must not silently
// discard. Returns a failure when supplied evidence disagrees, else undefined.
async function crossCheckSelectionEvidence(
	runtime: BrowserUseRuntime,
	flags: Record<string, string>,
	binding: SelectionEnvelopeBinding,
): Promise<SelectionFailure | undefined> {
	const proofPath = flags["--adapter-proof"];
	if (proofPath) {
		const proofParse = await readAdapterProofFacts(runtime, proofPath);
		if (!proofParse.ok) {
			return {
				code: "target_selection_envelope_invalid",
				message:
					"The supplied --adapter-proof could not be validated against the selection envelope.",
				actionId: "change_selection_input",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			};
		}
		const proof = proofParse.facts;
		if (
			proof.adapter !== binding.selectedAdapter ||
			proof.adapterProofId !== binding.adapterProofId ||
			proof.verifiedEndpointIdentity !== binding.verifiedEndpointIdentity ||
			proof.warmChromeRunId !== binding.warmChromeRunId
		) {
			return {
				code: "target_selection_envelope_invalid",
				message:
					"The supplied --adapter-proof does not match the selection envelope binding.",
				actionId: "change_selection_input",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			};
		}
	}
	const routePath = flags["--route"];
	if (routePath) {
		const routeParse = await readRouteFacts(runtime, routePath);
		if (!routeParse.ok) {
			return {
				code: "target_selection_envelope_invalid",
				message:
					"The supplied --route could not be validated against the selection envelope.",
				actionId: "change_selection_input",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			};
		}
		const route = routeParse.facts;
		// Compare the FULL route binding, not a subset. readRouteFacts already
		// parsed warm_chrome_run_id and verified_endpoint_identity; omitting them
		// would let a route that agrees on adapter/proof/hash but disagrees on the
		// warm-Chrome run or endpoint pass the cross-check and bind selected state
		// to the wrong endpoint facts.
		if (
			route.selectedAdapter !== binding.selectedAdapter ||
			route.adapterProofId !== binding.adapterProofId ||
			route.warmChromeRunId !== binding.warmChromeRunId ||
			route.verifiedEndpointIdentity !== binding.verifiedEndpointIdentity ||
			route.routeEvidenceHash !== binding.routeEvidenceHash ||
			route.runId !== binding.runId
		) {
			return {
				code: "target_selection_envelope_invalid",
				message:
					"The supplied --route does not match the selection envelope binding.",
				actionId: "change_selection_input",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			};
		}
	}
	return undefined;
}

// --- Selector (ordinal XOR hints) ------------------------------------------

// Browser Target Hints (R22). Origin / URL substring / title substring. The
// candidate ordinal is a precise handle, NOT a hint (plan: "Candidate ordinal
// does not count as a Browser Target Hint").
type TargetHints = {
	origin?: string;
	urlContains?: string;
	titleContains?: string;
};

type Selector =
	| { kind: "ordinal"; ordinal: number }
	| { kind: "hints"; hints: TargetHints };

type SelectorRead =
	| { ok: true; value: Selector }
	| { ok: false; failure: SelectionFailure };

// Read the selector from flags. A candidate ordinal and hints are mutually
// exclusive (the ordinal is exact; mixing them is ambiguous intent). Exactly one
// selector must be supplied.
function readSelector(flags: Record<string, string>): SelectorRead {
	const candidateRaw = flags["--candidate"];
	const hints: TargetHints = {
		...(stringField(flags["--origin"])
			? { origin: flags["--origin"] }
			: {}),
		...(stringField(flags["--url-contains"])
			? { urlContains: flags["--url-contains"] }
			: {}),
		...(stringField(flags["--title-contains"])
			? { titleContains: flags["--title-contains"] }
			: {}),
	};
	const hasHints =
		hints.origin !== undefined ||
		hints.urlContains !== undefined ||
		hints.titleContains !== undefined;

	if (candidateRaw !== undefined) {
		if (hasHints) {
			return {
				ok: false,
				failure: selectionUsageFailure(
					"--candidate and Browser Target Hints are mutually exclusive; supply one selector.",
				),
			};
		}
		const ordinal = Number(candidateRaw);
		if (
			!Number.isInteger(ordinal) ||
			ordinal < 1 ||
			`${ordinal}` !== candidateRaw.trim()
		) {
			return {
				ok: false,
				failure: {
					code: "target_selection_candidate_invalid",
					message:
						"--candidate must be a positive integer candidate ordinal scoped to the supplied envelope.",
					actionId: "choose_target_candidate",
					exitCode: TARGET_SELECTION_EXIT_CODE,
					recoverability: "change_input",
				},
			};
		}
		return { ok: true, value: { kind: "ordinal", ordinal } };
	}

	if (!hasHints) {
		return {
			ok: false,
			failure: selectionUsageFailure(
				"targets select requires a --candidate ordinal or at least one Browser Target Hint (--origin, --url-contains, --title-contains).",
			),
		};
	}
	return { ok: true, value: { kind: "hints", hints } };
}

type CandidateResolution =
	| { ok: true; candidate: BrowserTargetCandidate }
	| { ok: false; failure: SelectionFailure };

// Resolve exactly one candidate. Ordinal must exist in the supplied envelope;
// hints must match exactly one candidate (zero -> no_match, >1 -> ambiguous).
function resolveSelectionCandidate(
	candidates: BrowserTargetCandidate[],
	selector: Selector,
): CandidateResolution {
	if (selector.kind === "ordinal") {
		const candidate = candidates.find(
			(c) => c.candidate_ordinal === selector.ordinal,
		);
		if (!candidate) {
			return {
				ok: false,
				failure: {
					code: "target_selection_candidate_invalid",
					message: `No candidate with ordinal ${selector.ordinal} exists in the supplied envelope.`,
					actionId: "choose_target_candidate",
					exitCode: TARGET_SELECTION_EXIT_CODE,
					recoverability: "change_input",
				},
			};
		}
		return { ok: true, candidate };
	}
	const matches = candidates.filter((c) => candidateMatchesHints(c, selector.hints));
	if (matches.length === 0) {
		// A --url-contains hint matches against origin + redacted path_shape, and
		// path_shape exists only when the envelope was produced with
		// `targets list --show-url`. When the hint matched nothing, distinguish two
		// causes (finding #4): if the substring is NOT present in any origin (so it
		// targets a path) AND at least one candidate carries no path_shape, the miss
		// is plausibly because that candidate's path detail is absent — point the
		// caller at --show-url rather than telling them to refine a hint that can
		// never match. Otherwise it is a genuine refine-the-hint miss. Reasoning
		// from the actual match outcome (not a global pre-check) avoids both the
		// mixed-envelope gap and the origin-coincidence wrong-select.
		const urlContains = selector.hints.urlContains;
		if (urlContains !== undefined) {
			const needle = urlContains.toLowerCase();
			const matchesAnyOrigin = candidates.some((c) =>
				c.origin.toLowerCase().includes(needle),
			);
			const anyMissingPathShape = candidates.some(
				(c) => c.path_shape === undefined,
			);
			if (!matchesAnyOrigin && anyMissingPathShape) {
				return {
					ok: false,
					failure: {
						code: "target_selection_hint_no_match",
						message:
							"--url-contains matched no candidate, and the supplied envelope carries no path detail for some targets. Re-run targets list with --show-url, then select against that envelope.",
						actionId: "rerun_route_bound_target_discovery",
						exitCode: TARGET_SELECTION_EXIT_CODE,
						recoverability: "change_input",
					},
				};
			}
		}
		return {
			ok: false,
			failure: {
				code: "target_selection_hint_no_match",
				message:
					"No Browser Target Candidate matches the supplied hints in the route-bound envelope.",
				actionId: "refine_target_hint",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	if (matches.length > 1) {
		return {
			ok: false,
			failure: {
				code: "target_selection_hint_ambiguous",
				message: `Browser Target Hints matched ${matches.length} candidates; refine the hint or pick a candidate ordinal.`,
				actionId: "refine_target_hint",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	return { ok: true, candidate: matches[0] };
}

// A candidate matches the hints when every supplied hint matches. Origin is an
// exact (case-insensitive) match; URL/title substrings match against the
// redacted display facts only — there is no raw url to match against, by design
// (R32). URL-substring matches against origin + path_shape.
function candidateMatchesHints(
	candidate: BrowserTargetCandidate,
	hints: TargetHints,
): boolean {
	if (
		hints.origin !== undefined &&
		candidate.origin.toLowerCase() !== hints.origin.toLowerCase()
	) {
		return false;
	}
	if (hints.urlContains !== undefined) {
		const haystack = `${candidate.origin}${candidate.path_shape ?? ""}`.toLowerCase();
		if (!haystack.includes(hints.urlContains.toLowerCase())) return false;
	}
	if (hints.titleContains !== undefined) {
		const title = (candidate.title ?? "").toLowerCase();
		if (!title.includes(hints.titleContains.toLowerCase())) return false;
	}
	return true;
}

// --- State path resolution -------------------------------------------------

type StatePathResult =
	| { ok: true; path: string }
	| { ok: false; failure: SelectionFailure };

// Resolve the run-scoped state path. --state wins. Otherwise derive
// deterministically from BROWSER_USE_TARGET_STATE_DIR and the run id — but ONLY
// when the run id is EXPLICIT. The diagnostic run id is a fresh random UUID per
// invocation when unset, so keying the env-derived path on a non-explicit run id
// would make select and a separate status process resolve different files; the
// state would then never be found. Require --state or an explicit run id, and
// fail clearly otherwise — state is never placed under a random, unreplayable id.
function resolveStatePath(
	flags: Record<string, string>,
	env: Record<string, string | undefined>,
	runId: string,
	runIdExplicit: boolean,
): StatePathResult {
	const explicit = stringField(flags["--state"]);
	if (explicit) return { ok: true, path: explicit };
	const dir = stringField(env.BROWSER_USE_TARGET_STATE_DIR);
	if (dir && runIdExplicit && stringField(runId)) {
		return {
			ok: true,
			path: join(dir, `browser-use-target-state-${runScopedKey(runId)}.json`),
		};
	}
	const detail =
		dir && !runIdExplicit
			? "set an explicit run id (--run-id or BROWSER_USE_RUN_ID) so the env-derived path is stable across commands"
			: "supply --state <path> or set BROWSER_USE_TARGET_STATE_DIR with an explicit run id";
	return {
		ok: false,
		failure: {
			code: "target_selection_state_path_missing",
			message: `No selected-target state path: ${detail}.`,
			actionId: "change_selection_input",
			exitCode: TARGET_SELECTION_EXIT_CODE,
			recoverability: "change_input",
		},
	};
}

function runScopedKey(runId: string): string {
	return createHash("sha256").update(runId).digest("hex").slice(0, 32);
}

// --- State load + validation (status, and U7 operate reuse) ----------------

type StateLoad =
	| { ok: true; state: SelectedTargetState }
	| { ok: false; failure: SelectionFailure };

// Load selected state and fail closed, distinctly, on every cause: missing,
// unreadable/malformed, stale (expired), mismatched (wrong contract/shape), and
// cross-run (state run id disagrees with the expected run id).
async function loadSelectedState(
	runtime: BrowserUseRuntime,
	path: string,
	check: { now: number; expectedRunId?: string },
): Promise<StateLoad> {
	let raw: string;
	try {
		raw = await runtime.readTextFile(path);
	} catch (error) {
		// Distinguish "no state selected yet" (ENOENT) from "state exists but the
		// file could not be read" (permission, EISDIR, other IO). The contract
		// promises distinct target_state_missing vs target_state_unreadable
		// outcomes; collapsing both into "missing" sends the wrong recovery.
		const code =
			error && typeof error === "object" && "code" in error
				? String((error as { code?: unknown }).code)
				: undefined;
		if (code === "ENOENT") {
			return {
				ok: false,
				failure: {
					code: "target_state_missing",
					message:
						"No run-scoped selected-target state was found; select a Browser Target first.",
					actionId: "refresh_target_selection",
					exitCode: TARGET_SELECTION_EXIT_CODE,
					recoverability: "change_input",
				},
			};
		}
		return {
			ok: false,
			failure: {
				code: "target_state_unreadable",
				message:
					"The selected-target state file could not be read; repair or replace it before retrying.",
				actionId: "repair_target_state",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "repair_state",
			},
		};
	}
	const parsed = parseSelectedState(raw);
	if (!parsed) {
		return {
			ok: false,
			failure: {
				code: "target_state_unreadable",
				message:
					"The selected-target state file is unreadable or malformed; reselect a Browser Target.",
				actionId: "refresh_target_selection",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "repair_state",
			},
		};
	}
	if (parsed.contract !== SELECTED_TARGET_STATE_CONTRACT_ID) {
		return {
			ok: false,
			failure: {
				code: "target_state_mismatch",
				message:
					"The state file is not run-scoped selected-target state (wrong contract); reselect a Browser Target.",
				actionId: "refresh_target_selection",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "repair_state",
			},
		};
	}
	// Enforce the schema version, not just its presence. A state file written by a
	// different (future/older) build may carry incompatible field semantics under
	// the same contract id; treat a version it does not recognize as a mismatch
	// rather than operating against a shape it does not understand (finding #7).
	if (parsed.schema_version !== SELECTED_TARGET_STATE_SCHEMA_VERSION) {
		return {
			ok: false,
			failure: {
				code: "target_state_mismatch",
				message:
					"The selected-target state was written by an incompatible schema version; reselect a Browser Target.",
				actionId: "refresh_target_selection",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "repair_state",
			},
		};
	}
	if (
		check.expectedRunId !== undefined &&
		parsed.run_id !== check.expectedRunId
	) {
		return {
			ok: false,
			failure: {
				code: "target_state_cross_run",
				message:
					"The selected-target state belongs to a different run; reselect a Browser Target for this run.",
				actionId: "refresh_target_selection",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	if (check.now >= parsed.expires_at_ms) {
		return {
			ok: false,
			failure: {
				code: "target_state_stale",
				message:
					"The run-scoped selected-target state has expired; reselect a Browser Target.",
				actionId: "refresh_target_selection",
				exitCode: TARGET_SELECTION_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	return { ok: true, state: parsed };
}

// Parse persisted state strictly. Any missing/typewrong field returns undefined
// (-> target_state_unreadable), never a partial state object.
function parseSelectedState(raw: string): SelectedTargetState | undefined {
	const value = safeJsonObject(raw);
	if (!value) return undefined;
	const contract = stringField(value.contract);
	const schemaVersion = stringField(value.schema_version);
	const runId = stringField(value.run_id);
	const selectedAdapter = value.selected_adapter_id;
	const warmChromeRunId = stringField(value.warm_chrome_run_id);
	const adapterProofId = stringField(value.adapter_proof_id);
	const verifiedEndpointIdentity = stringField(value.verified_endpoint_identity);
	const routeEvidenceHash = stringField(value.route_evidence_hash);
	const targetEnvelopeId = stringField(value.target_envelope_id);
	const targetCandidateId = stringField(value.target_candidate_id);
	const ordinal = value.selected_candidate_ordinal;
	const emittedAtMs = value.emitted_at_ms;
	const expiresAtMs = value.expires_at_ms;
	const display = isJsonObject(value.display) ? value.display : undefined;
	if (
		!contract ||
		!schemaVersion ||
		!runId ||
		!isBrowserAdapterId(selectedAdapter) ||
		!warmChromeRunId ||
		!adapterProofId ||
		!verifiedEndpointIdentity ||
		!routeEvidenceHash ||
		!targetEnvelopeId ||
		!targetCandidateId ||
		typeof ordinal !== "number" ||
		!Number.isInteger(ordinal) ||
		ordinal < 1 ||
		typeof emittedAtMs !== "number" ||
		typeof expiresAtMs !== "number" ||
		!display
	) {
		return undefined;
	}
	const safeDisplay = safeDisplayFacts(targetCandidateId, display);
	if (!safeDisplay) return undefined;
	return {
		contract,
		schema_version: schemaVersion,
		run_id: runId,
		selected_adapter_id: selectedAdapter,
		warm_chrome_run_id: warmChromeRunId,
		adapter_proof_id: adapterProofId,
		verified_endpoint_identity: verifiedEndpointIdentity,
		route_evidence_hash: routeEvidenceHash,
		target_envelope_id: targetEnvelopeId,
		target_candidate_id: targetCandidateId,
		selected_candidate_ordinal: ordinal,
		emitted_at_ms: emittedAtMs,
		expires_at_ms: expiresAtMs,
		display: {
			origin: safeDisplay.origin,
			...(safeDisplay.path_shape ? { path_shape: safeDisplay.path_shape } : {}),
			...(safeDisplay.title ? { title: safeDisplay.title } : {}),
		},
	};
}

// --- Operation-time target resolution (pure; exported for U7 operate) ------

// Per-operation Browser Target Hints supplied directly to `operate` (U7), the
// same hint surface `select` accepts.
export type OperationTargetHints = TargetHints;

// The route-bound discovery context an operation already holds: its candidate
// set and whether the discovery binding is fresh. Selected state is optional;
// hints are optional. U7 owns the I/O that produces these; this resolver is pure.
export type OperationResolutionInput = {
	hints: OperationTargetHints;
	candidates: readonly BrowserTargetCandidate[];
	// Run-scoped selected state, when present and already validated fresh by the
	// caller (loadSelectedState). A stale/missing state is passed as undefined.
	selectedState?: {
		target_candidate_id: string;
		selected_candidate_ordinal: number;
	};
	// True only for a fresh, route-bound discovery binding. The exactly-one
	// fallback is gated on this (R: "Exactly-one-candidate fallback runs only with
	// route-bound discovery and fresh binding").
	routeBoundFreshBinding: boolean;
};

export type OperationResolution =
	| { kind: "resolved"; source: "hints" | "selected_state" | "single_candidate"; candidate: BrowserTargetCandidate }
	| { kind: "ambiguous"; matchCount: number }
	// Per-operation hints matched no candidate (-> refine_target_hint in U7).
	| { kind: "no_match" }
	// Selected state's candidate is no longer in the candidate set; the selection
	// must be re-made (-> refresh_target_selection in U7), distinct from a hint
	// miss so U7 maps each cause to its own continuation (finding #3 / altitude).
	| { kind: "selection_moved" }
	| { kind: "no_target" };

// Resolve the Browser Operation Target. Precedence (plan U6 + AE7, AE8):
//   1. Per-operation hints win over selected state. If hints are supplied, they
//      decide the outcome — a hint that matches nothing or many does NOT fall
//      back to selected state (AE8); it fails on the hints.
//   2. With no hints, use selected state when present.
//   3. With no hints and no selected state, the exactly-one-candidate fallback
//      applies ONLY when the discovery binding is route-bound and fresh.
export function resolveOperationTarget(
	input: OperationResolutionInput,
): OperationResolution {
	const hasHints =
		input.hints.origin !== undefined ||
		input.hints.urlContains !== undefined ||
		input.hints.titleContains !== undefined;

	if (hasHints) {
		const matches = input.candidates.filter((c) =>
			candidateMatchesHints(c, input.hints),
		);
		if (matches.length === 1) {
			return { kind: "resolved", source: "hints", candidate: matches[0] };
		}
		if (matches.length === 0) return { kind: "no_match" };
		// >1: ambiguous, and explicitly NO fallback to selected state (AE8).
		return { kind: "ambiguous", matchCount: matches.length };
	}

	if (input.selectedState) {
		// Match ONLY on the stable per-envelope candidate id, never the ordinal.
		// Ordinals are dense positions reassigned each discovery run, so a tab that
		// closed can leave its ordinal pointing at a DIFFERENT page; matching on
		// ordinal would silently rebind the selection to that other page (finding
		// #3). candidate_id is content-derived and unique to one target, so a miss
		// here means the selected target genuinely left the set.
		const candidate = input.candidates.find(
			(c) => c.candidate_id === input.selectedState?.target_candidate_id,
		);
		if (candidate) {
			return { kind: "resolved", source: "selected_state", candidate };
		}
		// Selected state exists but its candidate is not in the current candidate
		// set — the tab list changed. Surface as a moved selection that must be
		// re-made, distinct from a hint miss, so U7 can map it to
		// refresh_target_selection rather than refine_target_hint.
		return { kind: "selection_moved" };
	}

	if (input.routeBoundFreshBinding && input.candidates.length === 1) {
		return {
			kind: "resolved",
			source: "single_candidate",
			candidate: input.candidates[0],
		};
	}
	if (input.candidates.length > 1) {
		return { kind: "ambiguous", matchCount: input.candidates.length };
	}
	return { kind: "no_target" };
}

// ---------------------------------------------------------------------------
// Browser Operations (plan U7).
// ---------------------------------------------------------------------------

const SNAPSHOT_MAX_BYTES = 64 * 1024;
const SNAPSHOT_MAX_LINES = 1000;

type OperationActionId =
	| (typeof browserUseOperationFailureActions)[number]["id"]
	| (typeof browserUseOperationSuccessActions)[number]["id"];

const operationActions = [
	...browserUseOperationFailureActions,
	...browserUseOperationSuccessActions,
] as const;
const operationActionById = new Map(
	operationActions.map((action) => [action.id, action]),
);

type OperationFailure = Failure<OperationActionId>;

type OperationSideEffects = {
	focus?: boolean;
};

type OperationTargetEntry = {
	candidate: BrowserTargetCandidate;
	pageId?: number;
};

type ScreenshotArtifact = {
	path: string;
	relativePath: string;
	root: string;
	format: "png";
	fullPage: boolean;
};

type ViewportEmulation = {
	width: number;
	height: number;
	device_scale_factor: number;
	mobile: boolean;
	touch: boolean;
	landscape: boolean;
	viewport_arg: string;
};

type OperationInputs = {
	operation: BrowserOperationClass;
	screenshot?: ScreenshotArtifact;
	viewport?: ViewportEmulation;
};

type OperationBindingContext = {
	route: RouteFacts;
	proof: AdapterProofFacts;
};

type OperationTargetContext = {
	targetEnvelopeId: string;
	targetEntries: OperationTargetEntry[];
};

type ResolvedOperationTarget = {
	candidate: BrowserTargetCandidate;
	source: "hints" | "selected_state" | "single_candidate";
	pageId: number;
};

async function runOperate(input: {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	runIdExplicit: boolean;
	diagnosticVerbose: boolean;
	durationMs: () => number;
}): Promise<number> {
	const { parsed, runtime } = input;
	const flags = parsed.flagValues;
	const fail = (failure: OperationFailure, sideEffects: OperationSideEffects = {}) =>
		emitOperationFailure({
			failure,
			command: parsed.command,
			sideEffects,
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});

	const operationInputs = readOperationInputs({
		command: parsed.command,
		flags,
		env: runtime.env,
		runId: input.runId,
	});
	if (!operationInputs.ok) return fail(operationInputs.failure);

	const binding = await loadOperationBinding({
		runtime,
		flags,
		operation: operationInputs.inputs.operation,
		now: runtime.now(),
	});
	if (!binding.ok) return fail(binding.failure);

	const targetContext = await loadOperationTargetContext(runtime, binding.context);
	if (!targetContext.ok) return fail(targetContext.failure);

	const target = await resolveOperationTargetEntry({
		runtime,
		flags,
		runId: input.runId,
		runIdExplicit: input.runIdExplicit,
		targetEnvelopeId: targetContext.context.targetEnvelopeId,
		targetEntries: targetContext.context.targetEntries,
		route: binding.context.route,
		now: runtime.now(),
	});
	if (!target.ok) return fail(target.failure);

	const artifactDirectory = operationInputs.inputs.screenshot
		? await ensureScreenshotArtifactDirectory(
				runtime,
				operationInputs.inputs.screenshot,
			)
		: undefined;
	if (artifactDirectory && !artifactDirectory.ok) return fail(artifactDirectory.failure);

	const bringToFront = flags["--bring-to-front"] !== undefined;
	const selectedPage = await selectOperationPage({
		runtime,
		adapter: binding.context.route.selectedAdapter,
		pageId: target.target.pageId,
		bringToFront,
	});
	if (!selectedPage.ok) return fail(selectedPage.failure);

	const operationCall = await runOperationTransport({
		runtime,
		adapter: binding.context.route.selectedAdapter,
		operation: operationInputs.inputs.operation,
		screenshot: operationInputs.inputs.screenshot,
		viewport: operationInputs.inputs.viewport,
		verbose: input.diagnosticVerbose,
	});
	if (!operationCall.ok) {
		return fail(operationFailureFromTransport(operationCall.failure), {
			focus: true,
		});
	}
	if (operationCall.result.exitCode !== 0) {
		return fail(
			operationTransportExitedFailure("The adapter Browser Operation call failed."),
			{ focus: true },
		);
	}

	return emitOperationSuccess({
		command: parsed.command,
		operation: operationInputs.inputs.operation,
		adapter: binding.context.route.selectedAdapter,
		route: binding.context.route,
		target: target.target.candidate,
		targetSource: target.target.source,
		outputMode: parsed.outputMode,
		stdout: input.stdout,
		runId: input.runId,
		durationMs: input.durationMs(),
		transportResult: operationCall.result,
		...(operationInputs.inputs.screenshot
			? { screenshot: operationInputs.inputs.screenshot }
			: {}),
		...(operationInputs.inputs.viewport
			? { viewport: operationInputs.inputs.viewport }
			: {}),
		focusSideEffect: bringToFront,
	});
}

function readOperationInputs(input: {
	command: BrowserUseCommand;
	flags: Record<string, string>;
	env: Record<string, string | undefined>;
	runId: string;
}): { ok: true; inputs: OperationInputs } | { ok: false; failure: OperationFailure } {
	const operation = operationClassForCommand(input.command);
	const screenshot = input.command === "operate-screenshot"
		? readScreenshotArtifact(input.flags, input.env, input.runId)
		: undefined;
	if (screenshot && !screenshot.ok) return { ok: false, failure: screenshot.failure };

	const viewport = input.command === "operate-emulate"
		? readViewportEmulation(input.flags)
		: undefined;
	if (viewport && !viewport.ok) return { ok: false, failure: viewport.failure };

	return {
		ok: true,
		inputs: {
			operation,
			...(screenshot?.ok ? { screenshot: screenshot.artifact } : {}),
			...(viewport?.ok ? { viewport: viewport.viewport } : {}),
		},
	};
}

async function loadOperationBinding(input: {
	runtime: BrowserUseRuntime;
	flags: Record<string, string>;
	operation: BrowserOperationClass;
	now: number;
}): Promise<
	{ ok: true; context: OperationBindingContext } | { ok: false; failure: OperationFailure }
> {
	const routePath = stringField(input.flags["--route"]);
	if (!routePath) {
		return { ok: false, failure: operationRouteFailure("operate requires --route <path>.") };
	}
	const proofPath = stringField(input.flags["--adapter-proof"]);
	if (!proofPath) {
		return {
			ok: false,
			failure: operationProofInvalidFailure("operate requires --adapter-proof <path>."),
		};
	}

	const routeParse = await readRouteFacts(input.runtime, routePath);
	if (!routeParse.ok) {
		return { ok: false, failure: operationRouteFailure(routeParse.failure.message) };
	}
	const route = routeParse.facts;
	const routeFresh = routeFreshForOperation(route.binding, input.now);
	if (!routeFresh.ok) return { ok: false, failure: routeFresh.failure };

	const proofParse = await readAdapterProofFacts(input.runtime, proofPath);
	if (!proofParse.ok) {
		return {
			ok: false,
			failure: operationProofInvalidFailure(proofParse.failure.message),
		};
	}
	const proof = proofParse.facts;
	const mismatch = operationProofMismatch(route, proof);
	if (mismatch) return { ok: false, failure: mismatch };

	if (!authorizesOperationClass(route.binding, input.operation)) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_capability_unauthorized",
				message:
					"The route success envelope does not authorize the requested Browser Operation capability.",
				actionId: "rerun_route_bound_target_discovery",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}

	return { ok: true, context: { route, proof } };
}

function operationProofMismatch(
	route: RouteFacts,
	proof: AdapterProofFacts,
): OperationFailure | undefined {
	if (
		proof.adapter === route.selectedAdapter &&
		proof.adapterProofId === route.adapterProofId &&
		proof.verifiedEndpointIdentity === route.verifiedEndpointIdentity &&
		proof.warmChromeRunId === route.warmChromeRunId
	) {
		return undefined;
	}
	return {
		code: "browser_operation_adapter_proof_mismatch",
		message:
			"The supplied Adapter Proof does not match the route's selected adapter binding.",
		actionId: "refresh_adapter_proof",
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "change_input",
	};
}

async function loadOperationTargetContext(
	runtime: BrowserUseRuntime,
	binding: OperationBindingContext,
): Promise<
	{ ok: true; context: OperationTargetContext } | { ok: false; failure: OperationFailure }
> {
	const discovery = await discoverPages(runtime, binding.route.selectedAdapter);
	if (!discovery.ok) {
		return { ok: false, failure: operationFailureFromDiscovery(discovery.failure) };
	}

	const targetEnvelopeId = targetEnvelopeIdOf({
		runId: binding.route.runId,
		mode: "route-bound",
		adapter: binding.route.selectedAdapter,
		adapterProofId: binding.proof.adapterProofId,
		routeEvidenceHash: binding.route.routeEvidenceHash,
	});
	const targetEntries = operationTargetEntries(discovery.pages, targetEnvelopeId);
	if (targetEntries.length === 0) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_target_missing",
				message:
					"No operation-ready Browser Target Candidates were discovered through the proven adapter.",
				actionId: "rerun_route_bound_target_discovery",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "retry",
			},
		};
	}

	return { ok: true, context: { targetEnvelopeId, targetEntries } };
}

async function resolveOperationTargetEntry(input: {
	runtime: BrowserUseRuntime;
	flags: Record<string, string>;
	runId: string;
	runIdExplicit: boolean;
	targetEnvelopeId: string;
	targetEntries: OperationTargetEntry[];
	route: RouteFacts;
	now: number;
}): Promise<
	{ ok: true; target: ResolvedOperationTarget } | { ok: false; failure: OperationFailure }
> {
	const selectedState = await loadOperationSelectedState({
		runtime: input.runtime,
		flags: input.flags,
		env: input.runtime.env,
		runId: input.runId,
		runIdExplicit: input.runIdExplicit,
		targetEnvelopeId: input.targetEnvelopeId,
		route: input.route,
		now: input.now,
	});
	if (!selectedState.ok) return { ok: false, failure: selectedState.failure };

	const hints = readOperationHints(input.flags);
	const resolution = resolveOperationTarget({
		hints,
		candidates: input.targetEntries.map((entry) => entry.candidate),
		...(selectedState.state
			? {
					selectedState: {
						target_candidate_id: selectedState.state.target_candidate_id,
						selected_candidate_ordinal:
							selectedState.state.selected_candidate_ordinal,
					},
				}
			: {}),
		routeBoundFreshBinding: true,
	});
	if (resolution.kind !== "resolved") {
		return {
			ok: false,
			failure: operationFailureFromResolution(resolution, hasOperationHints(hints)),
		};
	}

	const targetEntry = input.targetEntries.find(
		(entry) => entry.candidate.candidate_id === resolution.candidate.candidate_id,
	);
	if (!targetEntry || targetEntry.pageId === undefined) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_target_missing",
				message:
					"The resolved Browser Target no longer carries an adapter page handle; re-run route-bound target discovery.",
				actionId: "rerun_route_bound_target_discovery",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "retry",
			},
		};
	}

	return {
		ok: true,
		target: {
			candidate: resolution.candidate,
			source: resolution.source,
			pageId: targetEntry.pageId,
		},
	};
}

async function selectOperationPage(input: {
	runtime: BrowserUseRuntime;
	adapter: BrowserAdapterId;
	pageId: number;
	bringToFront: boolean;
}): Promise<{ ok: true } | { ok: false; failure: OperationFailure }> {
	const selectPage = await runBrowserUseMcporter(input.runtime, [
		"call",
		`${input.adapter}.select_page`,
		"--args",
		JSON.stringify({
			pageId: input.pageId,
			bringToFront: input.bringToFront,
		}),
		"--output",
		"json",
	]);
	if (!selectPage.ok) {
		return { ok: false, failure: operationFailureFromTransport(selectPage.failure) };
	}
	if (selectPage.result.exitCode !== 0) {
		return {
			ok: false,
			failure: operationTransportExitedFailure("The adapter select_page call failed."),
		};
	}
	return { ok: true };
}

function operationClassForCommand(command: BrowserUseCommand): BrowserOperationClass {
	if (command === "operate-snapshot") return "snapshot";
	if (command === "operate-screenshot") return "screenshot";
	if (command === "operate-emulate") return "emulate";
	throw new Error(`Unsupported Browser Operation command: ${command}`);
}

function readOperationHints(flags: Record<string, string>): OperationTargetHints {
	return {
		...(stringField(flags["--origin"]) ? { origin: flags["--origin"] } : {}),
		...(stringField(flags["--url-contains"])
			? { urlContains: flags["--url-contains"] }
			: {}),
		...(stringField(flags["--title-contains"])
			? { titleContains: flags["--title-contains"] }
			: {}),
	};
}

function hasOperationHints(hints: OperationTargetHints): boolean {
	return (
		hints.origin !== undefined ||
		hints.urlContains !== undefined ||
		hints.titleContains !== undefined
	);
}

function operationTargetEntries(
	pages: readonly RawPage[],
	targetEnvelopeId: string,
): OperationTargetEntry[] {
	return pages
		.filter((page) => parseUrlSafe(page.url))
		.map((page, index) => ({
			candidate: toCandidate(page, index, targetEnvelopeId, true),
			pageId: parseAdapterPageId(page.id),
		}));
}

function parseAdapterPageId(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

type OperationStateLoad =
	| { ok: true; state?: SelectedTargetState }
	| { ok: false; failure: OperationFailure };

async function loadOperationSelectedState(input: {
	runtime: BrowserUseRuntime;
	flags: Record<string, string>;
	env: Record<string, string | undefined>;
	runId: string;
	runIdExplicit: boolean;
	targetEnvelopeId: string;
	route: RouteFacts;
	now: number;
}): Promise<OperationStateLoad> {
	const hasStateSource =
		stringField(input.flags["--state"]) !== undefined ||
		stringField(input.env.BROWSER_USE_TARGET_STATE_DIR) !== undefined;
	if (!hasStateSource) return { ok: true };

	const statePath = resolveStatePath(
		input.flags,
		input.env,
		input.runId,
		input.runIdExplicit,
	);
	if (!statePath.ok) {
		return { ok: false, failure: operationFailureFromSelection(statePath.failure) };
	}
	const load = await loadSelectedState(input.runtime, statePath.path, {
		now: input.now,
		expectedRunId: input.runIdExplicit ? input.runId : undefined,
	});
	if (!load.ok) {
		return { ok: false, failure: operationFailureFromSelection(load.failure) };
	}
	const state = load.state;
	if (
		state.selected_adapter_id !== input.route.selectedAdapter ||
		state.warm_chrome_run_id !== input.route.warmChromeRunId ||
		state.adapter_proof_id !== input.route.adapterProofId ||
		state.verified_endpoint_identity !== input.route.verifiedEndpointIdentity ||
		state.route_evidence_hash !== input.route.routeEvidenceHash ||
		state.target_envelope_id !== input.targetEnvelopeId
	) {
		return {
			ok: false,
			failure: {
				code: "target_state_mismatch",
				message:
					"The selected-target state does not match the supplied route and Adapter Proof binding.",
				actionId: "refresh_target_selection",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	return { ok: true, state };
}

function routeFreshForOperation(
	binding: RouteBinding,
	now: number,
): { ok: true } | { ok: false; failure: OperationFailure } {
	const expiresAt = Date.parse(binding.expires_at);
	if (Number.isNaN(expiresAt)) {
		return { ok: false, failure: operationRouteFailure("route expiry is invalid") };
	}
	if (now >= expiresAt) {
		return {
			ok: false,
			failure: operationRouteFailure(
				"route success has expired; re-run prepare and route before operating",
			),
		};
	}
	return { ok: true };
}

function readScreenshotArtifact(
	flags: Record<string, string>,
	env: Record<string, string | undefined>,
	runId: string,
): { ok: true; artifact: ScreenshotArtifact } | { ok: false; failure: OperationFailure } {
	const raw = stringField(flags["--out"]);
	if (!raw) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_artifact_path_required",
				message: "operate screenshot requires --out <path>.",
				actionId: "change_operation_input",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	const root = screenshotArtifactRoot(env, runId);
	if (!root.ok) return { ok: false, failure: root.failure };
	const normalized = normalize(raw);
	const segments = normalized.split(/[\\/]+/);
	if (
		raw.includes("\0") ||
		isAbsolute(raw) ||
		normalized === "." ||
		normalized.startsWith("..") ||
		segments.includes("..")
	) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_artifact_path_unsafe",
				message:
					"operate screenshot --out must be a relative path inside the run-scoped artifact root.",
				actionId: "change_operation_input",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	const resolvedRoot = resolve(root.root);
	const artifactPath = resolve(resolvedRoot, normalized);
	const relativeToRoot = relative(resolvedRoot, artifactPath);
	if (
		relativeToRoot === "" ||
		relativeToRoot.startsWith("..") ||
		isAbsolute(relativeToRoot)
	) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_artifact_path_unsafe",
				message:
					"operate screenshot --out must resolve inside the run-scoped artifact root.",
				actionId: "change_operation_input",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	return {
		ok: true,
		artifact: {
			path: artifactPath,
			relativePath: normalized,
			root: resolvedRoot,
			format: "png",
			fullPage: flags["--full-page"] !== undefined,
		},
	};
}

function screenshotArtifactRoot(
	env: Record<string, string | undefined>,
	runId: string,
): { ok: true; root: string } | { ok: false; failure: OperationFailure } {
	const explicit = stringField(env.BROWSER_USE_ARTIFACT_ROOT);
	if (explicit) {
		if (explicit.includes("\0") || !isAbsolute(explicit)) {
			return {
				ok: false,
				failure: {
					code: "browser_operation_artifact_path_unsafe",
					message:
						"BROWSER_USE_ARTIFACT_ROOT must be an absolute run-scoped artifact root.",
					actionId: "change_operation_input",
					exitCode: USAGE_EXIT_CODE,
					recoverability: "change_input",
				},
			};
		}
		return { ok: true, root: explicit };
	}
	return {
		ok: true,
		root: join(tmpdir(), "browser-use-artifacts", runScopedKey(runId)),
	};
}

async function ensureScreenshotArtifactDirectory(
	runtime: BrowserUseRuntime,
	artifact: ScreenshotArtifact,
): Promise<{ ok: true } | { ok: false; failure: OperationFailure }> {
	try {
		await runtime.ensureDirectory(dirname(artifact.path));
		return { ok: true };
	} catch {
		return {
			ok: false,
			failure: {
				code: "browser_operation_artifact_root_unwritable",
				message:
					"Could not create the screenshot artifact directory under the run-scoped artifact root.",
				actionId: "change_operation_input",
				exitCode: RUNTIME_FAILURE_EXIT_CODE,
				recoverability: "repair_state",
			},
		};
	}
}

function readViewportEmulation(
	flags: Record<string, string>,
): { ok: true; viewport: ViewportEmulation } | { ok: false; failure: OperationFailure } {
	const width = positiveIntFlag(flags["--width"]);
	const height = positiveIntFlag(flags["--height"]);
	const dpr = positiveNumberFlag(flags["--dpr"] ?? "1");
	if (!width || !height || !dpr) {
		return {
			ok: false,
			failure: {
				code: "browser_operation_viewport_invalid",
				message:
					"operate emulate requires positive --width, --height, and optional positive --dpr values.",
				actionId: "change_operation_input",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			},
		};
	}
	const mobile = flags["--mobile"] !== undefined;
	const touch = flags["--touch"] !== undefined;
	const landscape = flags["--landscape"] !== undefined;
	const modifiers = [
		mobile ? "mobile" : "",
		touch ? "touch" : "",
		landscape ? "landscape" : "",
	].filter((part) => part !== "");
	const viewportArg = `${width}x${height}x${dpr}${modifiers.length > 0 ? `,${modifiers.join(",")}` : ""}`;
	return {
		ok: true,
		viewport: {
			width,
			height,
			device_scale_factor: dpr,
			mobile,
			touch,
			landscape,
			viewport_arg: viewportArg,
		},
	};
}

function positiveIntFlag(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveNumberFlag(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function runOperationTransport(input: {
	runtime: BrowserUseRuntime;
	adapter: BrowserAdapterId;
	operation: BrowserOperationClass;
	screenshot?: ScreenshotArtifact;
	viewport?: ViewportEmulation;
	verbose: boolean;
}): Promise<BrowserOperationTransportResult> {
	if (input.operation === "snapshot") {
		return runBrowserUseMcporter(input.runtime, [
			"call",
			`${input.adapter}.take_snapshot`,
			"--args",
			JSON.stringify(input.verbose ? { verbose: true } : {}),
			"--output",
			"json",
		]);
	}
	if (input.operation === "screenshot") {
		return runBrowserUseMcporter(input.runtime, [
			"call",
			`${input.adapter}.take_screenshot`,
			"--args",
			JSON.stringify({
				filePath: input.screenshot?.path,
				fullPage: input.screenshot?.fullPage ?? false,
				format: "png",
			}),
			"--output",
			"json",
		]);
	}
	return runBrowserUseMcporter(input.runtime, [
		"call",
		`${input.adapter}.emulate`,
		"--args",
		JSON.stringify({ viewport: input.viewport?.viewport_arg }),
		"--output",
		"json",
	]);
}

function operationRouteFailure(detail: string): OperationFailure {
	return {
		code: "browser_operation_route_invalid",
		message: `The supplied route success envelope cannot authorize the operation: ${detail}.`,
		actionId: "rerun_route_bound_target_discovery",
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "change_input",
	};
}

function operationProofInvalidFailure(detail: string): OperationFailure {
	return {
		code: "browser_operation_adapter_proof_invalid",
		message: `The supplied Adapter Proof cannot authorize the operation: ${detail}.`,
		actionId: "supply_adapter_proof",
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "change_input",
	};
}

function operationFailureFromSelection(
	failure: SelectionFailure,
): OperationFailure {
	return {
		code: failure.code,
		message: failure.message,
		actionId: failure.actionId,
		exitCode: failure.exitCode,
		recoverability: failure.recoverability,
	};
}

function operationFailureFromDiscovery(
	failure: TargetDiscoveryFailure,
): OperationFailure {
	if (failure.code === "target_discovery_dependency_missing") {
		return dependencyOperationFailure("browser_operation_dependency_missing", failure.message);
	}
	if (failure.code === "target_discovery_command_override_invalid") {
		return dependencyOperationFailure(
			"browser_operation_command_override_invalid",
			failure.message,
		);
	}
	if (failure.code === "target_discovery_transport_timeout") {
		return {
			code: "browser_operation_transport_timeout",
			message: failure.message,
			actionId: "inspect_operation_diagnostics",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "retry",
		};
	}
	return operationTransportExitedFailure(failure.message);
}

function operationFailureFromTransport(
	failure: BrowserOperationTransportFailure,
): OperationFailure {
	if (failure.kind === "dependency_missing") {
		return dependencyOperationFailure(failure.code, failure.hintSummary);
	}
	if (failure.kind === "command_override_invalid") {
		return dependencyOperationFailure(failure.code, failure.hintSummary);
	}
	if (failure.kind === "transport_timeout") {
		return {
			code: failure.code,
			message: failure.hintSummary,
			actionId: "inspect_operation_diagnostics",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "retry",
		};
	}
	return operationTransportExitedFailure(failure.hintSummary);
}

function dependencyOperationFailure(code: string, message: string): OperationFailure {
	return {
		code,
		message,
		actionId: "configure_operation_dependency",
		exitCode: RUNTIME_FAILURE_EXIT_CODE,
		recoverability: "repair_state",
	};
}

function operationTransportExitedFailure(message: string): OperationFailure {
	return {
		code: "browser_operation_transport_failed",
		message,
		actionId: "inspect_operation_diagnostics",
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "retry",
	};
}

function operationFailureFromResolution(
	resolution: Exclude<OperationResolution, { kind: "resolved" }>,
	hasHints: boolean,
): OperationFailure {
	if (resolution.kind === "ambiguous") {
		return {
			code: "browser_operation_target_ambiguous",
			message: `Browser Operation target resolution matched ${resolution.matchCount} candidates.`,
			actionId: hasHints ? "refine_target_hint" : "choose_target_candidate",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		};
	}
	if (resolution.kind === "no_match") {
		return {
			code: "browser_operation_target_no_match",
			message:
				"No Browser Target Candidate matches the supplied operation hints.",
			actionId: "refine_target_hint",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		};
	}
	if (resolution.kind === "selection_moved") {
		return {
			code: "browser_operation_target_moved",
			message:
				"The selected Browser Target is no longer present in the current route-bound target set.",
			actionId: "refresh_target_selection",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		};
	}
	return {
		code: "browser_operation_target_missing",
		message:
			"No Browser Target was selected and no single route-bound candidate is available.",
		actionId: "choose_target_candidate",
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "change_input",
	};
}

function operationAction(id: OperationActionId): RuntimeActionGuidance {
	return actionFor(operationActionById, id, "operation");
}

function emitOperationFailure(input: {
	failure: OperationFailure;
	command: BrowserUseCommand;
	sideEffects: OperationSideEffects;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const { failure } = input;
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${failure.code}: ${redactUnsafeText(failure.message)} action=${failure.actionId} focus_side_effect=${input.sideEffects.focus === true} (run_id=${input.runId})\n`,
		);
		return failure.exitCode;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: failure.exitCode,
			data: {
				command: input.command,
				result_kind: "browser_operation",
				side_effects: { focus: input.sideEffects.focus === true },
			},
			runtime_actions: [operationAction(failure.actionId)],
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

function emitOperationSuccess(input: {
	command: BrowserUseCommand;
	operation: BrowserOperationClass;
	adapter: BrowserAdapterId;
	route: RouteFacts;
	target: BrowserTargetCandidate;
	targetSource: "hints" | "selected_state" | "single_candidate";
	outputMode: OutputMode;
	stdout: CliWriter;
	runId: string;
	durationMs: number;
	transportResult: McporterCommandResult;
	screenshot?: ScreenshotArtifact;
	viewport?: ViewportEmulation;
	focusSideEffect: boolean;
}): number {
	if (input.outputMode === "plain") {
		input.stdout.write(
			[
				"browser_operation_completed",
				`operation=${input.operation}`,
				`adapter=${input.adapter}`,
				`target_source=${input.targetSource}`,
				`candidate_ordinal=${input.target.candidate_ordinal}`,
				`focus_side_effect=${input.focusSideEffect}`,
				"action=inspect_operation_result",
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
				contract: BROWSER_USE_OPERATION_CONTRACT_ID,
				schema_version: BROWSER_USE_OPERATION_SCHEMA_VERSION,
				command: input.command,
				result_kind: "browser_operation",
				operation: input.operation,
				adapter: input.adapter,
				binding: {
					run_id: input.route.runId,
					adapter_proof_id: input.route.adapterProofId,
					route_evidence_hash: input.route.routeEvidenceHash,
					target_candidate_id: input.target.candidate_id,
				},
				target_source: input.targetSource,
				target: {
					candidate_ordinal: input.target.candidate_ordinal,
					candidate_id: input.target.candidate_id,
					origin: input.target.origin,
					...(input.target.path_shape
						? { path_shape: input.target.path_shape }
						: {}),
					...(input.target.title ? { title: input.target.title } : {}),
				},
				side_effects: {
					focus: input.focusSideEffect,
				},
				...operationPayload(input),
			},
			runtime_actions: [operationAction("inspect_operation_result")],
			continuation: { next_action_id: "inspect_operation_result" },
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return 0;
}

function operationPayload(input: {
	operation: BrowserOperationClass;
	transportResult: McporterCommandResult;
	screenshot?: ScreenshotArtifact;
	viewport?: ViewportEmulation;
}): Record<string, unknown> {
	switch (input.operation) {
		case "snapshot":
			return { snapshot: normalizeSnapshot(input.transportResult.stdout) };
		case "screenshot":
			return {
				screenshot: {
					artifact: input.screenshot
						? {
								path: input.screenshot.path,
								relative_path: input.screenshot.relativePath,
								root: input.screenshot.root,
								format: input.screenshot.format,
								full_page: input.screenshot.fullPage,
							}
						: undefined,
				},
			};
		case "emulate":
			return {
				emulation: {
					viewport: input.viewport
						? {
								width: input.viewport.width,
								height: input.viewport.height,
								device_scale_factor: input.viewport.device_scale_factor,
								mobile: input.viewport.mobile,
								touch: input.viewport.touch,
								landscape: input.viewport.landscape,
							}
						: undefined,
				},
			};
		default: {
			const exhaustive: never = input.operation;
			throw new Error(`Unsupported Browser Operation: ${exhaustive}`);
		}
	}
}

function normalizeSnapshot(stdout: string): Record<string, unknown> {
	const text = extractTextContent(parseTransportOutput(stdout));
	const bounded = boundSnapshotText(text);
	return {
		text: bounded.text,
		line_count: bounded.lineCount,
		byte_count: bounded.byteCount,
		truncated: bounded.truncated,
		limits: {
			max_bytes: SNAPSHOT_MAX_BYTES,
			max_lines: SNAPSHOT_MAX_LINES,
		},
	};
}

function parseTransportOutput(stdout: string): unknown {
	if (stdout.trim() === "") return "";
	try {
		return JSON.parse(stdout);
	} catch {
		return stdout;
	}
}

function extractTextContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (!isJsonObject(value)) return "";
	if (typeof value.text === "string") return value.text;
	if (typeof value.result === "string") return value.result;
	const content = value.content;
	if (Array.isArray(content)) {
		return content
			.flatMap((entry) =>
				isJsonObject(entry) && typeof entry.text === "string" ? [entry.text] : [],
			)
			.join("\n");
	}
	return "";
}

function boundSnapshotText(text: string): {
	text: string;
	lineCount: number;
	byteCount: number;
	truncated: boolean;
} {
	const lines = text.split("\n");
	let bounded = lines.slice(0, SNAPSHOT_MAX_LINES).join("\n");
	let truncated = lines.length > SNAPSHOT_MAX_LINES;
	while (Buffer.byteLength(bounded, "utf-8") > SNAPSHOT_MAX_BYTES) {
		bounded = bounded.slice(0, Math.max(0, bounded.length - 1024));
		truncated = true;
	}
	return {
		text: bounded,
		lineCount: bounded === "" ? 0 : bounded.split("\n").length,
		byteCount: Buffer.byteLength(bounded, "utf-8"),
		truncated,
	};
}

// --- Selection failure builders + emitters ---------------------------------

function selectionUsageFailure(message: string): SelectionFailure {
	return {
		code: "target_selection_candidate_invalid",
		message,
		actionId: "change_selection_input",
		exitCode: USAGE_EXIT_CODE,
		recoverability: "change_input",
	};
}

function selectionAction(id: SelectionActionId): RuntimeActionGuidance {
	return actionFor(selectionActionById, id, "target selection");
}

function emitSelectionSuccess(input: {
	state: SelectedTargetState;
	outputMode: OutputMode;
	stdout: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const { state } = input;
	if (input.outputMode === "plain") {
		input.stdout.write(
			[
				"browser_target_selected",
				`run_id=${state.run_id}`,
				`adapter=${state.selected_adapter_id}`,
				`candidate_ordinal=${state.selected_candidate_ordinal}`,
				`target_envelope_id=${state.target_envelope_id}`,
				`origin=${state.display.origin}`,
				`expires_at_ms=${state.expires_at_ms}`,
				`action=operate_selected_browser_target`,
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
				command: "targets-select",
				result_kind: "browser_targets",
				selected_target: selectedTargetView(state),
			},
			runtime_actions: [
				selectionAction("operate_selected_browser_target"),
				selectionAction("inspect_selected_target_state"),
			],
			continuation: { next_action_id: "operate_selected_browser_target" },
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return 0;
}

function emitStatusSuccess(input: {
	state: SelectedTargetState;
	now: number;
	outputMode: OutputMode;
	stdout: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const { state } = input;
	const expiresInMs = Math.max(0, state.expires_at_ms - input.now);
	if (input.outputMode === "plain") {
		input.stdout.write(
			[
				"browser_target_state",
				`run_id=${state.run_id}`,
				`adapter=${state.selected_adapter_id}`,
				`candidate_ordinal=${state.selected_candidate_ordinal}`,
				`origin=${state.display.origin}`,
				state.display.path_shape ? `path_shape=${state.display.path_shape}` : "",
				`expires_in_ms=${expiresInMs}`,
			]
				.filter((part) => part !== "")
				.join(" ") + "\n",
		);
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				command: "targets-status",
				result_kind: "browser_targets",
				selected_target: {
					...selectedTargetView(state),
					expires_in_ms: expiresInMs,
				},
			},
			runtime_actions: [selectionAction("operate_selected_browser_target")],
			continuation: { next_action_id: "operate_selected_browser_target" },
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return 0;
}

// Public projection of selected state. Already-redacted display facts plus the
// binding ids; no raw page/CDP handles ever exist in the state to leak.
function selectedTargetView(state: SelectedTargetState): Record<string, unknown> {
	return {
		run_id: state.run_id,
		selected_adapter_id: state.selected_adapter_id,
		adapter_proof_id: state.adapter_proof_id,
		route_evidence_hash: state.route_evidence_hash,
		target_envelope_id: state.target_envelope_id,
		target_candidate_id: state.target_candidate_id,
		candidate_ordinal: state.selected_candidate_ordinal,
		emitted_at_ms: state.emitted_at_ms,
		expires_at_ms: state.expires_at_ms,
		display: state.display,
	};
}

function emitSelectionFailure(input: {
	failure: SelectionFailure;
	// The invoking command, passed explicitly by the caller. Inferring it from the
	// failure code prefix is wrong: `targets status` can fail with a
	// `target_selection_*` code (e.g. state_path_missing), which would mislabel the
	// envelope as `targets-select` (finding #6).
	command: "targets-select" | "targets-status";
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const { failure, command } = input;
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
			data: { command, result_kind: "browser_targets" },
			runtime_actions: [selectionAction(failure.actionId)],
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

// --- Small shared field helpers --------------------------------------------

function isBrowserAdapterId(value: unknown): value is BrowserAdapterId {
	return (
		typeof value === "string" &&
		(BROWSER_ADAPTER_ROUTER_ADAPTERS as readonly string[]).includes(value)
	);
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

// Extract an explicit `--run-id` flag value with a real flag parse, stopping at
// the `--` end-of-options terminator. Returns the value when a standalone
// `--run-id <value>` (or `--run-id=<value>`) appears in the options region,
// else undefined. Used only to decide whether the run id is EXPLICIT; unlike a
// raw `argv.includes("--run-id")` it does not flip true for a `--run-id` token
// smuggled past `--` or carried as another flag's value, which would otherwise
// assert a run the diagnostic layer never resolved.
function parsedRunIdFlag(argv: readonly string[]): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") return undefined;
		if (token === "--run-id") {
			const value = argv[index + 1];
			return value !== undefined && !value.startsWith("--") ? value : undefined;
		}
		if (token.startsWith("--run-id=")) {
			return stringField(token.slice("--run-id=".length));
		}
	}
	return undefined;
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
export {
	type BrowserOperationTransportFailure,
	type BrowserOperationTransportResult,
	runBrowserUseMcporter,
} from "./browser-use-transport";

if (import.meta.main) {
	const exitCode = await runBrowserUseCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
