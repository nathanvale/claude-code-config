#!/usr/bin/env bun

// U6 dispatcher: the facade-backed machine surface. Bare invocation renders the
// read-only dashboard (R15); `check` reads the Agent Chrome environment; and
// `connect <adapter>` runs the full prove-or-launch + adapter gate and emits the
// decision-complete Verified Handoff Envelope (R2/R4/R7/R10/R16). `run` is U7.
//
// Mirrors warm-chrome's cli.ts chassis: injectable deps (writers, the
// environment-gateway warm-chrome `main`, the adapter runtime, and a registry
// accessor so unit tests inject fakes — no real Chrome, no real adapter
// binaries), configureCliDiagnostics(...) at entry, resetCliDiagnostics() in the
// finally, usage errors through the facade, and continuation guidance built from
// the U2 affordance catalog.

import { existsSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import {
	type CliDiagnosticRedactor,
	type CliDiagnosticSerializableRecord,
	CliUsageError,
	type CliWriter,
	configureCliDiagnostics,
	createCliDiagnosticContext,
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	emitCliDiagnostic,
	type ParsedCliDiagnosticArgv,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	redactGenericCliDiagnosticRecord,
	renderCommandUsage,
	resetCliDiagnostics,
	type RuntimeActionGuidance,
	type RuntimeContinuationGuidance,
	type StructuredRuntimeError,
	usageError,
	withCliDiagnosticContext,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";

import type { WarmChromeRuntime } from "@side-quest/warm-chrome";
import type { WarmChromeMainDeps } from "@side-quest/warm-chrome/cli";

import {
	BROWSER_CONNECT_COMMANDS,
	type BrowserConnectCommand,
	BROWSER_CONNECT_GLOBAL_DIAGNOSTIC_FLAGS,
	browserConnectContractEntries,
	browserConnectContracts,
	extractBrowserConnectGatewayOptions,
} from "./command-contract.ts";
import {
	type BrowserConnectDashboard,
	type DashboardDeps,
	projectBrowserConnectDashboard,
} from "./dashboard.ts";
import {
	AGENT_CHROME_IDENTITY,
	proveAgentChromeEnvironment,
	type EnvironmentGatewayResult,
} from "./environment.ts";
import {
	type AdapterDefinition,
	type AdapterInstallAssessment,
	type AdapterInstallEngine,
	type AdapterInstallStopCause,
	type AdapterProvenanceResult,
	type AdapterRuntime,
	assessAdapterInstallPolicy,
	buildIsolatedInstallerEnvironment,
	extractVersion,
	findAdapterDefinition as defaultFindAdapterDefinition,
	isAllowlistedAdapterUpgrade,
	listAdapterDefinitions as defaultListAdapterDefinitions,
	manualAdapterInstallInputsComplete,
	resolveApprovedPackageManagerExecutable,
	spawnAdapterCommand,
	VERSION_READ_TIMEOUT_MS,
} from "./adapters/registry.ts";
import {
	BROWSER_CONNECT_INSPECT_DIAGNOSTICS_CHOICE,
	type BrowserConnectOperatorRepairStage,
	type BrowserConnectRepairStage,
	browserConnectContinuationConstraints,
	selectBrowserConnectLegacyNextAction,
	selectBrowserConnectRepairPath,
} from "./repair-path.ts";
import { selectCompatibleRoute } from "./compatibility.ts";
import {
	type RunSpawner,
	runWrappedCommand,
	spawnRunWrappedCommand,
	splitRunArgv,
} from "./run-exec.ts";
import {
	BROWSER_CONNECT_CLI_NAME,
	BROWSER_CONNECT_CONTRACT_ID,
	type BrowserConnectAdapterRepairContext,
	type BrowserConnectAuthorizedAttachment,
	type BrowserConnectEnvironmentIdentity,
	type BrowserConnectEnvironmentRepairContext,
	type BrowserConnectEnvelopeData,
	type BrowserConnectFailureActionId,
	type BrowserConnectFailureClass,
	type BrowserConnectLaunchProvenance,
	type BrowserConnectProofEvidence,
	type BrowserConnectRepairChainHop,
	type BrowserConnectRepairContext,
	type BrowserConnectRouteId,
	type BrowserConnectSuggestedPortEvidence,
	type BrowserConnectVerifiedEndpoint,
	BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS,
	BROWSER_CONNECT_SAFE_VERSION_PATTERN,
	BROWSER_CONNECT_SCHEMA_VERSION,
	browserConnectFailureActions,
	browserConnectSuccessActions,
	createBrowserConnectEnvelopeData,
	redactBrowserConnectText,
	sanitizeBrowserConnectUsageMessage,
} from "./model.ts";

const VERSION = "0.1.0";
const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const CONNECTION_ENTRY_EXIT_CODE = 20;

type OutputMode = "json" | "plain";

// AGENT_CHROME_IDENTITY (R10) is owned + exported by environment.ts; imported above.

// ---------------------------------------------------------------------------
// Station homing: every failure class maps to a canonical station error code
// (the station's `<command>.<branch>` branch id) so the emitted envelope's
// `error.code` matches the Branch Station Catalog. The affordance catalog
// (model.ts) owns the one next_action_id per failure class.
//
// Command-scoped stations share a failure class but carry command-local error
// codes: `check.environment_absent` and `connect`'s prove-path both use the
// `environment-absent` class, but the branch id differs by command. The
// dispatcher passes the command context so the right branch id is stamped.
// ---------------------------------------------------------------------------

/**
 * Branch-id (station error code) for a failure class within a command context.
 * Kept flat: each failure class has exactly one branch id in slice one, so the
 * command prefix is supplied by the caller and the branch id is the class's
 * canonical code.
 */
const FAILURE_CLASS_BRANCH_ID: Record<BrowserConnectFailureClass, string> = {
	"usage-invalid": "usage_invalid",
	"run-missing-separator": "missing_separator",
	"environment-absent": "environment_absent",
	"foreign-listener": "foreign_listener",
	"launch-failed": "launch_failed",
	"adapter-unknown": "adapter_unknown",
	"adapter-not-installed": "adapter_not_installed",
	"route-incompatible": "route_incompatible",
	"attachment-failed": "attachment_failed",
	"preexec-connect-failed": "preexec_connect_failed",
	"wrapped-command-not-found": "wrapped_not_found",
	"runtime-error-unexpected": "runtime_error",
};

/**
 * Exit code per failure class (KTD4). Usage failures exit 2; the connection
 * family and all proof/adapter failures exit 20 (fail closed, no fallback);
 * wrapped-command-not-found exits 127; an unexpected runtime error exits 1.
 */
const FAILURE_CLASS_EXIT_CODE: Record<BrowserConnectFailureClass, number> = {
	"usage-invalid": USAGE_EXIT_CODE,
	"run-missing-separator": USAGE_EXIT_CODE,
	"adapter-unknown": USAGE_EXIT_CODE,
	"environment-absent": CONNECTION_ENTRY_EXIT_CODE,
	"foreign-listener": CONNECTION_ENTRY_EXIT_CODE,
	"launch-failed": CONNECTION_ENTRY_EXIT_CODE,
	"adapter-not-installed": CONNECTION_ENTRY_EXIT_CODE,
	"route-incompatible": CONNECTION_ENTRY_EXIT_CODE,
	"attachment-failed": CONNECTION_ENTRY_EXIT_CODE,
	"preexec-connect-failed": CONNECTION_ENTRY_EXIT_CODE,
	"wrapped-command-not-found": 127,
	"runtime-error-unexpected": RUNTIME_FAILURE_EXIT_CODE,
};

const failureActionById = new Map(
	browserConnectFailureActions.map((action) => [action.id, action]),
);
const successActionById = new Map(
	browserConnectSuccessActions.map((action) => [action.id, action]),
);

/**
 * Injectable dependencies for {@link main}. Tests replace the writers, the
 * warm-chrome `main`, the adapter runtime, and the registry accessors so the
 * full entrypoint runs in-process with fakes — no real Chrome, no real adapter
 * binaries.
 */
export type BrowserConnectMainDeps = {
	stdout?: CliWriter;
	stderr?: CliWriter;
	/** warm-chrome's `main` (from `@side-quest/warm-chrome/cli`). */
	warmChromeMain: (
		argv: readonly string[],
		deps?: WarmChromeMainDeps,
	) => Promise<number>;
	/** Optional warm-chrome runtime override forwarded to the gateway (tests). */
	warmChromeRuntime?: WarmChromeRuntime;
	/** Adapter runtime seam — provenance + probe. Tests inject fakes. */
	adapterRuntime: AdapterRuntime;
	/** Registry list accessor; defaults to the real registry. */
	listAdapterDefinitions?: () => readonly AdapterDefinition[];
	/** Registry lookup accessor; defaults to the real registry. */
	findAdapterDefinition?: (id: string) => AdapterDefinition | undefined;
	/**
	 * Wrapped-command spawner for `run` (U7). Tests inject a fake child so no
	 * real process is spawned; production defaults to the stdio-inheriting,
	 * signal-forwarding spawner.
	 */
	runSpawner?: RunSpawner;
	/**
	 * Base environment the wrapped command inherits before adapter injection is
	 * merged over it (`run`). Defaults to `process.env`.
	 */
	runBaseEnv?: Record<string, string | undefined>;
	/**
	 * Isolated-install effect seam for `repair-adapter` (U5/KTD16). Tests
	 * inject a recording engine with a fake package-manager executable;
	 * production wires real fs, a redirect-refusing origin probe, and the
	 * no-shell spawner.
	 */
	adapterInstallEngine?: AdapterInstallEngine;
	/**
	 * User-owned root the versioned install trees publish under (R28 install
	 * scope). Defaults to `$HOME/.side-quest/browser-connect/adapters`.
	 */
	adapterInstallRoot?: string;
	/** Monotonic clock for envelope duration (tests can pin it). */
	now?: () => number;
};

/**
 * A resolved dependency bundle after defaults are applied.
 */
type ResolvedDeps = {
	stdout: CliWriter;
	stderr: CliWriter;
	warmChromeMain: BrowserConnectMainDeps["warmChromeMain"];
	warmChromeRuntime?: WarmChromeRuntime;
	adapterRuntime: AdapterRuntime;
	listAdapterDefinitions: () => readonly AdapterDefinition[];
	findAdapterDefinition: (id: string) => AdapterDefinition | undefined;
	runSpawner: RunSpawner;
	runBaseEnv: Record<string, string | undefined>;
	adapterInstallEngine: AdapterInstallEngine;
	adapterInstallRoot: string;
	now: () => number;
};

type ParsedInvocation =
	| { kind: "help"; command?: BrowserConnectCommand }
	| { kind: "version" }
	| { kind: "dashboard"; outputMode: OutputMode }
	| {
			kind: "check";
			outputMode: OutputMode;
			port?: number;
			repairChainHop: BrowserConnectRepairChainHop;
	  }
	| {
			kind: "connect";
			adapterId: string;
			outputMode: OutputMode;
			port?: number;
			repairChainHop: BrowserConnectRepairChainHop;
	  }
	| {
			kind: "run";
			adapterId: string;
			tail: readonly string[];
			outputMode: OutputMode;
			port?: number;
			repairChainHop: BrowserConnectRepairChainHop;
	  }
	| {
			kind: "run-missing-separator";
			/** Distinct typed causes on the one station (R12/AE6). */
			cause: "separator_missing" | "wrapped_command_missing";
			/** Parser-memory marker only; the wrapped words never leave the parser (R26). */
			wrappedCommandPresent: boolean;
	  }
	| {
			kind: "repair-adapter";
			adapterId: string;
			mode: "check" | "execute";
			outputMode: OutputMode;
	  };

const quietDiagnosticWriter: CliWriter = { write: () => true };

/**
 * Diagnostic redactor for every browser-connect LogTape sink (R14/KTD10).
 * Applies the package redaction chokepoint to serialized diagnostic records so
 * no diagnostic — visible stream or post-mortem flush — carries a local path,
 * secret reference, or command string.
 */
export const browserConnectDiagnosticRedactor: CliDiagnosticRedactor = (
	record,
) =>
	redactGenericCliDiagnosticRecord(
		JSON.parse(
			redactBrowserConnectText(JSON.stringify(record)),
		) as CliDiagnosticSerializableRecord,
	);

/**
 * CLI entry point.
 *
 * @param argv - Process argv tail after the executable name
 * @param deps - Writers, warm-chrome `main`, adapter runtime, and registry
 *   accessors; production wires real ones at the bottom of this file
 * @returns Process exit code
 *
 * @example
 * ```typescript
 * const exitCode = await main(["connect", "agent-browser", "--json"], deps)
 * ```
 */
export async function main(
	argv: readonly string[],
	deps: BrowserConnectMainDeps,
): Promise<number> {
	const resolved: ResolvedDeps = {
		stdout: deps.stdout ?? process.stdout,
		stderr: deps.stderr ?? process.stderr,
		warmChromeMain: deps.warmChromeMain,
		...(deps.warmChromeRuntime ? { warmChromeRuntime: deps.warmChromeRuntime } : {}),
		adapterRuntime: deps.adapterRuntime,
		listAdapterDefinitions:
			deps.listAdapterDefinitions ?? defaultListAdapterDefinitions,
		findAdapterDefinition:
			deps.findAdapterDefinition ?? defaultFindAdapterDefinition,
		runSpawner: deps.runSpawner ?? spawnRunWrappedCommand,
		runBaseEnv: deps.runBaseEnv ?? process.env,
		adapterInstallEngine:
			deps.adapterInstallEngine ?? createDefaultAdapterInstallEngine(),
		adapterInstallRoot:
			deps.adapterInstallRoot ?? defaultAdapterInstallRoot(),
		now: deps.now ?? (() => Date.now()),
	};

	// CRITICAL parser-ordering hazard (R17): parseCliDiagnosticArgv treats `--`
	// as an end-of-options marker — it STRIPS the separator and would scan the
	// tail. For `run`, the tail after `--` is the wrapped command verbatim and
	// must never be parsed as browser-connect argv. So split the RAW argv at the
	// first `--` up front and feed ONLY the head (with the `run` word) to the
	// diagnostic parser; the tail passes through this closure untouched.
	let runTail: readonly string[] | undefined;
	let argvForDiagnostics = argv;
	if (argv[0] === "run") {
		const split = splitRunArgv(argv.slice(1));
		if (split.kind === "split") {
			runTail = split.tail;
			argvForDiagnostics = ["run", ...split.head];
		}
	}

	let diagnosticArgv: ParsedCliDiagnosticArgv;
	try {
		diagnosticArgv = parseCliDiagnosticArgv(argvForDiagnostics);
	} catch (error) {
		diagnosticArgv = parseCliDiagnosticFallbackArgv(argv);
		// Output mode comes from the PRE-SPLIT HEAD only: for `run`, the tail
		// after `--` is the wrapped command verbatim and a hostile `--plain`
		// there must never flip this failure's output mode (R17/R26).
		const outputMode = inferOutputMode(argvForDiagnostics);
		configureDiagnostics(diagnosticArgv, resolved.stderr);
		const message =
			error instanceof Error ? error.message : "invalid diagnostic flags";
		try {
			// A `run` head keeps stdout for the wrapped command even when the
			// invocation dies in the diagnostic pre-parse: the usage envelope
			// goes to STDERR with the honest run command context (KTD5).
			if (argv[0] === "run") {
				return emitRunStderrFailure(resolved, {
					outputMode,
					runId: diagnosticArgv.options.runId,
					durationMs: resolved.now() - diagnosticArgv.options.startedAtMs,
					failureClass: "usage-invalid",
					message,
					repairContext: USAGE_INVALID_REPAIR_CONTEXT,
				});
			}
			return emitFailure(resolved, {
				outputMode,
				runId: diagnosticArgv.options.runId,
				durationMs:
					resolved.now() - diagnosticArgv.options.startedAtMs,
				failureClass: "usage-invalid",
				command: "check",
				message,
				repairContext: USAGE_INVALID_REPAIR_CONTEXT,
			});
		} finally {
			resetCliDiagnostics();
		}
	}

	configureDiagnostics(diagnosticArgv, resolved.stderr);
	const reconfigureDiagnostics = () =>
		configureDiagnostics(diagnosticArgv, resolved.stderr);
	try {
		const context = createCliDiagnosticContext(diagnosticArgv.options);
		return await withCliDiagnosticContext(context, async () => {
			const outputMode = inferOutputMode(diagnosticArgv.argv);
			const runId = diagnosticArgv.options.runId;
			const startedAtMs = diagnosticArgv.options.startedAtMs;
			try {
				const parsed = parseArgv(diagnosticArgv.argv, runTail);
				if (parsed.kind === "help") {
					resolved.stdout.write(renderHelp(parsed.command));
					return 0;
				}
				if (parsed.kind === "version") {
					resolved.stdout.write(`${BROWSER_CONNECT_CLI_NAME} ${VERSION}\n`);
					return 0;
				}
				if (parsed.kind === "run-missing-separator") {
					// R17/KTD5: run's own usage failure. It emits to STDERR (stdout
					// belongs to the wrapped command end-to-end), exit 2, exec never
					// starts. The typed cause distinguishes a missing `--` from an
					// empty tail on the one station (R12/AE6).
					return emitRunStderrFailure(resolved, {
						outputMode,
						runId,
						durationMs: resolved.now() - startedAtMs,
						failureClass: "run-missing-separator",
						message:
							parsed.cause === "wrapped_command_missing"
								? "run received a -- separator with no wrapped command after it."
								: "run requires a -- separator between its options and the wrapped command.",
						repairContext:
							parsed.cause === "wrapped_command_missing"
								? {
										failure_class: "run-missing-separator",
										cause: "wrapped_command_missing",
									}
								: {
										failure_class: "run-missing-separator",
										cause: "separator_missing",
										wrapped_command_present: parsed.wrappedCommandPresent,
									},
					});
				}
				if (parsed.kind === "repair-adapter") {
					return await dispatchRepairAdapter(parsed, resolved, {
						runId,
						startedAtMs,
					});
				}
				if (parsed.kind === "run") {
					return await dispatchRun(parsed, resolved, {
						runId,
						startedAtMs,
						reconfigureDiagnostics,
					});
				}
				return await dispatch(parsed, resolved, {
					runId,
					startedAtMs,
					reconfigureDiagnostics,
				});
			} catch (error) {
				return emitCaughtError(resolved, {
					error,
					outputMode,
					runId,
					durationMs: resolved.now() - startedAtMs,
					// The raw invocation head: a `run` usage rejection must keep
					// stdout untouched for the wrapped command (KTD5).
					invokedRun: argv[0] === "run",
				});
			}
		});
	} finally {
		resetCliDiagnostics();
	}
}

async function dispatch(
	parsed: Extract<
		ParsedInvocation,
		{ kind: "dashboard" | "check" | "connect" }
	>,
	deps: ResolvedDeps,
	ctx: {
		runId: string;
		startedAtMs: number;
		reconfigureDiagnostics: () => void;
	},
): Promise<number> {
	const durationMs = () => deps.now() - ctx.startedAtMs;
	if (parsed.kind === "dashboard") {
		emitCliDiagnostic(BROWSER_CONNECT_CLI_NAME, "info", "command-start", {
			command: "dashboard",
			phase: "start",
		});
		const dashboard = await projectBrowserConnectDashboard(
			dashboardDeps(deps),
		);
		writeDashboardSuccess(deps, parsed.outputMode, dashboard, {
			runId: ctx.runId,
			durationMs: durationMs(),
		});
		return 0;
	}

	if (parsed.kind === "check") {
		emitCliDiagnostic(BROWSER_CONNECT_CLI_NAME, "info", "command-start", {
			command: "check",
			phase: "start",
		});
		// check is a pure environment read: prove-only, never launch (R15).
		const result = await proveAgentChromeEnvironment({
			warmChromeMain: deps.warmChromeMain,
			reconfigureDiagnostics: ctx.reconfigureDiagnostics,
			runId: ctx.runId,
			autoLaunch: false,
			...(parsed.port === undefined ? {} : { explicitPort: parsed.port }),
			...(deps.warmChromeRuntime
				? { warmChromeRuntime: deps.warmChromeRuntime }
				: {}),
		});
		if (result.outcome === "verified") {
			writeCheckSuccess(deps, parsed.outputMode, result, {
				runId: ctx.runId,
				durationMs: durationMs(),
			});
			return 0;
		}
		// KTD20: check preserves any suggestion inside the typed context as
		// diagnostic evidence only — it never becomes a suggested-port
		// continuation on this surface.
		return emitFailure(deps, {
			outputMode: parsed.outputMode,
			runId: ctx.runId,
			durationMs: durationMs(),
			failureClass: result.failure_class,
			command: "check",
			...(result.detail ? { message: result.detail } : {}),
			repairContext: result.repair_context,
			repairChainHop: parsed.repairChainHop,
			...(parsed.port === undefined ? {} : { requestedPort: parsed.port }),
		});
	}

	// connect
	emitCliDiagnostic(BROWSER_CONNECT_CLI_NAME, "info", "command-start", {
		command: "connect",
		phase: "start",
		adapter: parsed.adapterId,
	});
	const gate = await runConnectGate(parsed.adapterId, deps, ctx, {
		...(parsed.port === undefined ? {} : { explicitPort: parsed.port }),
	});
	if (gate.outcome === "verified") {
		writeConnectSuccess(deps, parsed.outputMode, gate, {
			runId: ctx.runId,
			durationMs: durationMs(),
		});
		return 0;
	}
	return emitFailure(deps, {
		outputMode: parsed.outputMode,
		runId: ctx.runId,
		durationMs: durationMs(),
		failureClass: gate.failure_class,
		command: "connect",
		...(gate.detail ? { message: gate.detail } : {}),
		repairContext: gate.repair_context,
		repairChainHop: parsed.repairChainHop,
		...(parsed.port === undefined ? {} : { requestedPort: parsed.port }),
	});
}

// ---------------------------------------------------------------------------
// Connect gate (R4/R7/R10): resolve environment (default agent-chrome, R10),
// prove-or-launch via the gateway (U4), verify the adapter installed +
// route-compatible (U5), run the adapter's own attachment probe (U5). U7 reuses
// this gate for the run wrapper.
// ---------------------------------------------------------------------------

/**
 * A verified connect result: the environment proof, the chosen route, the
 * adapter injection, and the adapter-performed attachment. Decision-complete —
 * U7 injects `injection` into the wrapped command's argv/env.
 */
export type ConnectGateVerified = {
	outcome: "verified";
	environment: BrowserConnectEnvironmentIdentity;
	endpoint: BrowserConnectVerifiedEndpoint;
	launch: BrowserConnectLaunchProvenance;
	proof: BrowserConnectProofEvidence;
	route: BrowserConnectRouteId;
	attachment: BrowserConnectAuthorizedAttachment;
	injection: { argv: readonly string[]; env?: Record<string, string> };
};

/**
 * A failed connect result: the failure class plus launch provenance so far.
 * `detail` is free text that passes the redaction chokepoint on the way out.
 * `repair_context` preserves the gateway's typed environment evidence — reason,
 * suggested port, port-free proof — for repair-path selection (R6); adapter
 * stages gain their typed contexts in a later unit.
 */
export type ConnectGateFailed = {
	outcome: "failed";
	failure_class: BrowserConnectFailureClass;
	launch: BrowserConnectLaunchProvenance;
	repair_context:
		| BrowserConnectEnvironmentRepairContext
		| BrowserConnectAdapterRepairContext;
	detail?: string;
};

/**
 * Connect gate result union. U7's run wrapper reuses this: a verified result
 * carries the injection to exec with; a failed result maps to the
 * `preexec-connect-failed` station before exec ever starts.
 */
export type ConnectGateResult = ConnectGateVerified | ConnectGateFailed;

/**
 * Run the full connect gate sequence for a named adapter (R4/R7/R10).
 *
 * Order matters: an UNKNOWN adapter is a usage-class rejection (exit 2) BEFORE
 * any environment work; a known adapter drives prove-or-launch (auto-launch on,
 * R3/AE1), then provenance (installed + version), then route compatibility, then
 * the adapter's own attachment probe (R4). Any failure short-circuits with the
 * matching failure class — fail closed, no fallback (R11).
 *
 * @param adapterId - Adapter id from caller input
 * @param deps - Resolved dependency bundle
 * @param ctx - Run id and diagnostics re-config hook
 * @param options - Validated gateway options: the explicit port forwarded
 *   unchanged to the environment gateway (R15/KTD7)
 * @returns A verified handoff or a typed failure
 */
export async function runConnectGate(
	adapterId: string,
	deps: ResolvedDeps,
	ctx: { runId: string; reconfigureDiagnostics: () => void },
	options: { explicitPort?: number } = {},
): Promise<ConnectGateResult> {
	// Unknown adapter → usage-class rejection, never a probe (R7). The typed
	// context carries the trusted registered candidates only (R24).
	const definition = deps.findAdapterDefinition(adapterId);
	if (!definition) {
		return {
			outcome: "failed",
			failure_class: "adapter-unknown",
			launch: { launched: false },
			repair_context: unregisteredAdapterContext(adapterId, deps),
			detail: `adapter ${adapterId} is not in the registry`,
		};
	}

	// Prove or launch Agent Chrome (default environment, R10; auto-launch R3).
	const environment: EnvironmentGatewayResult =
		await proveAgentChromeEnvironment({
			warmChromeMain: deps.warmChromeMain,
			reconfigureDiagnostics: ctx.reconfigureDiagnostics,
			runId: ctx.runId,
			autoLaunch: true,
			...(options.explicitPort === undefined
				? {}
				: { explicitPort: options.explicitPort }),
			...(deps.warmChromeRuntime
				? { warmChromeRuntime: deps.warmChromeRuntime }
				: {}),
		});
	if (environment.outcome === "failed") {
		return {
			outcome: "failed",
			failure_class: environment.failure_class,
			launch: environment.launch,
			repair_context: environment.repair_context,
			...(environment.detail ? { detail: environment.detail } : {}),
		};
	}

	const launch = environment.launch;

	// Adapter installed + version-matched? (never a probe on a mismatch, R7).
	// The rejection carries typed provenance evidence plus the definition-owned
	// isolated-install assessment (file reads only), so repair-path policy can
	// select install vs. allowlisted upgrade vs. operator without prose (R11).
	const provenance = await definition.checkProvenance(deps.adapterRuntime);
	if (!provenance.installed) {
		return {
			outcome: "failed",
			failure_class: provenance.failureClass,
			launch,
			repair_context: buildAdapterNotInstalledContext(
				definition,
				provenance,
				await assessAdapterInstallPolicy(
					definition,
					deps.adapterInstallEngine,
				),
			),
			detail: provenance.detail,
		};
	}

	// Route compatibility: does the environment share a route the adapter
	// declares? (pure check, R7). The typed context names only trusted
	// registered candidates with an IMPLEMENTED compatible route (AE20).
	const route = selectCompatibleRoute(
		environment.environment.name,
		definition.routes.map((capability) => capability.route),
	);
	if (route === undefined) {
		return {
			outcome: "failed",
			failure_class: "route-incompatible",
			launch,
			repair_context: {
				failure_class: "route-incompatible",
				cause: "route_unsupported",
				candidate_adapter_ids: compatibleRegisteredCandidates(
					deps,
					environment.environment.name,
					definition.id,
				),
			},
			detail: `no route shared by ${environment.environment.name} and ${definition.id}`,
		};
	}

	// The adapter runs its OWN attachment probe (R4). browser-connect never
	// probes on the adapter's behalf. One bounded in-invocation read-only
	// re-probe is permitted ONLY for an explicitly transient cause (R23/KTD12);
	// a non-transient failure is never retried.
	let probe = await definition.probeAttachment(
		deps.adapterRuntime,
		environment.endpoint,
		route,
	);
	let reProbeAttempted = false;
	if (!probe.attached && probe.cause === "transient_probe_failure") {
		reProbeAttempted = true;
		probe = await definition.probeAttachment(
			deps.adapterRuntime,
			environment.endpoint,
			route,
		);
	}
	if (!probe.attached) {
		return {
			outcome: "failed",
			failure_class: probe.failureClass,
			launch,
			repair_context:
				probe.cause === "transient_probe_failure"
					? {
							failure_class: "attachment-failed",
							cause: "transient_probe_failure",
							re_probe_attempted: reProbeAttempted,
						}
					: { failure_class: "attachment-failed", cause: "probe_failed" },
			detail: probe.detail,
		};
	}

	const injection = definition.inject(environment.endpoint);
	return {
		outcome: "verified",
		environment: environment.environment,
		endpoint: environment.endpoint,
		launch,
		proof: environment.proof,
		route,
		attachment: probe.attachment,
		injection: {
			argv: injection.argv,
			...(injection.env ? { env: injection.env } : {}),
		},
	};
}

// ---------------------------------------------------------------------------
// U5 repair-adapter (R19/R28/R29/R33/R34; KTD9/KTD13/KTD16/KTD17/KTD22).
//
// `--check` re-reads trusted registry + provenance state and reports the
// exact currently-eligible action: zero network, zero mutation. `--execute`
// re-reads the SAME trusted state (a preview grants no authority), validates
// every lock-entry origin BEFORE any network, resolves the approved absolute
// package manager, gates egress on a redirect-refusing canonical-origin
// probe, copies the source manifest+lock into a neutral staging root, runs
// the registry-owned isolated installer (allowlisted env, no shell, no
// prompt), verifies the expected bin, atomically publishes the versioned
// install tree, and proves fresh exact-pin provenance from the published bin
// itself. Every safety-gate failure stops fail-closed into the
// repair-adapter.operator_stop station.
// ---------------------------------------------------------------------------

const REPAIR_ADAPTER_STOP_ERROR_CODE = "operator_stop";
const REPAIR_ADAPTER_INSTALL_TIMEOUT_MS = 180_000;

/** Adapter install state projected into repair envelopes (safe fields only). */
type RepairInstallState = "absent" | "version_mismatch" | "installed_at_pin";


/**
 * The full trusted-state read both modes share: structured provenance, the
 * definition-owned install assessment, the typed repair context (when a
 * repair is needed), and the U1 policy stage selected from it.
 */
type RepairAssessment = {
	definition: AdapterDefinition;
	installState: RepairInstallState;
	observedVersion?: string;
	assessment: AdapterInstallAssessment;
	context?: BrowserConnectAdapterRepairContext;
	stage?: BrowserConnectRepairStage;
};

/**
 * Build the typed adapter-not-installed repair context (R11) from structured
 * provenance plus the definition-owned install assessment. Shared by the
 * connect gate and repair-adapter so policy always sees the same evidence.
 */
function buildAdapterNotInstalledContext(
	definition: AdapterDefinition,
	provenance: Extract<AdapterProvenanceResult, { installed: false }>,
	assessment: AdapterInstallAssessment,
): BrowserConnectAdapterRepairContext {
	if (provenance.cause === "version_mismatch") {
		return {
			failure_class: "adapter-not-installed",
			cause: "version_mismatch",
			adapter_id: definition.id,
			// An unreadable version is projected as the safe literal "unknown";
			// it can never match a transition allowlist entry (R22).
			observed_version: provenance.observedVersion ?? "unknown",
			pinned_version: definition.pinnedVersion,
			transition_allowlisted:
				provenance.observedVersion !== undefined &&
				isAllowlistedAdapterUpgrade(
					definition.installPolicy,
					provenance.observedVersion,
					definition.pinnedVersion,
				),
			automatic_install: assessment.evidence,
		};
	}
	return {
		failure_class: "adapter-not-installed",
		cause: "executable_absent",
		adapter_id: definition.id,
		manual_install_inputs_complete: manualAdapterInstallInputsComplete(definition),
		automatic_install: assessment.evidence,
	};
}

/**
 * Typed adapter-unknown context (R24). Candidates are the trusted registered
 * ids; a deterministic replacement exists only when exactly one registered id
 * matches the caller's input case-insensitively (the matrix's "one
 * deterministic registered correction" arm) — the replacement is always a
 * trusted registry id, never caller prose.
 */
function unregisteredAdapterContext(
	adapterId: string,
	deps: Pick<ResolvedDeps, "listAdapterDefinitions">,
): Extract<
	BrowserConnectAdapterRepairContext,
	{ cause: "unregistered_adapter" }
> {
	const candidates = deps
		.listAdapterDefinitions()
		.map((candidate) => candidate.id);
	const lowered = adapterId.toLowerCase();
	const replacements = candidates.filter(
		(candidate) => candidate.toLowerCase() === lowered,
	);
	const replacement = replacements.length === 1 ? replacements[0] : undefined;
	return {
		failure_class: "adapter-unknown",
		cause: "unregistered_adapter",
		candidate_adapter_ids: candidates,
		...(replacement === undefined
			? {}
			: { deterministic_replacement_adapter_id: replacement }),
	};
}

/**
 * Trusted registered candidates whose IMPLEMENTED routes include one the
 * environment offers (AE16/AE20) — the only ids a cross-adapter handoff
 * choice may name.
 */
function compatibleRegisteredCandidates(
	deps: Pick<ResolvedDeps, "listAdapterDefinitions">,
	environmentName: BrowserConnectEnvironmentIdentity["name"],
	excludeAdapterId?: string,
): string[] {
	return deps
		.listAdapterDefinitions()
		.filter((candidate) => candidate.id !== excludeAdapterId)
		.filter(
			(candidate) =>
				selectCompatibleRoute(
					environmentName,
					candidate.routes
						.filter((capability) => capability.implemented)
						.map((capability) => capability.route),
				) !== undefined,
		)
		.map((candidate) => candidate.id);
}

/**
 * Re-read the trusted state for one adapter (both modes run this fresh):
 * structured provenance through the adapter runtime, the definition-owned
 * install assessment through the engine (file reads only), and the U1 policy
 * stage. Zero network, zero mutation.
 */
async function assessRepairAdapter(
	definition: AdapterDefinition,
	deps: ResolvedDeps,
): Promise<RepairAssessment> {
	const assessment = await assessAdapterInstallPolicy(
		definition,
		deps.adapterInstallEngine,
	);
	const provenance = await definition.checkProvenance(deps.adapterRuntime);
	if (provenance.installed) {
		return {
			definition,
			installState: "installed_at_pin",
			observedVersion: provenance.version,
			assessment,
		};
	}
	const context = buildAdapterNotInstalledContext(
		definition,
		provenance,
		assessment,
	);
	const stage = selectBrowserConnectRepairPath(
		{ command: "repair-adapter", repair_chain_hop: 0 },
		context,
	);
	return {
		definition,
		installState:
			provenance.cause === "version_mismatch" ? "version_mismatch" : "absent",
		...(provenance.observedVersion === undefined
			? {}
			: { observedVersion: provenance.observedVersion }),
		assessment,
		context,
		stage,
	};
}

/** Safe projected fields shared by every repair envelope (no paths, R11). */
function repairProvenanceFields(repair: RepairAssessment): Record<string, unknown> {
	return {
		adapter_id: repair.definition.id,
		install_state: repair.installState,
		...(repair.observedVersion !== undefined &&
		BROWSER_CONNECT_SAFE_VERSION_PATTERN.test(repair.observedVersion)
			? { observed_version: repair.observedVersion }
			: {}),
		pinned_version: repair.definition.pinnedVersion,
	};
}

async function dispatchRepairAdapter(
	parsed: Extract<ParsedInvocation, { kind: "repair-adapter" }>,
	deps: ResolvedDeps,
	ctx: { runId: string; startedAtMs: number },
): Promise<number> {
	const durationMs = () => deps.now() - ctx.startedAtMs;
	emitCliDiagnostic(BROWSER_CONNECT_CLI_NAME, "info", "command-start", {
		command: "repair-adapter",
		phase: "start",
		adapter: parsed.adapterId,
		mode: parsed.mode,
	});

	// Unknown adapter → usage-class rejection before any assessment (R33).
	const definition = deps.findAdapterDefinition(parsed.adapterId);
	if (!definition) {
		return emitFailure(deps, {
			outputMode: parsed.outputMode,
			runId: ctx.runId,
			durationMs: durationMs(),
			failureClass: "adapter-unknown",
			command: "repair-adapter",
			message: `adapter ${parsed.adapterId} is not in the registry`,
			repairContext: unregisteredAdapterContext(parsed.adapterId, deps),
		});
	}

	// Both modes re-read the same trusted state; the preview grants no
	// authority (KTD9/R33).
	const repair = await assessRepairAdapter(definition, deps);

	if (parsed.mode === "check") {
		writeRepairPreview(deps, parsed.outputMode, repair, {
			runId: ctx.runId,
			durationMs: durationMs(),
		});
		return 0;
	}

	// --execute with nothing eligible:
	// - already at the exact pin: read-only success, zero mutation;
	// - operator posture: fail-closed stop (exit 20) with the policy stage.
	if (repair.stage === undefined) {
		writeRepairExecuted(deps, parsed.outputMode, repair, "none", {
			runId: ctx.runId,
			durationMs: durationMs(),
		});
		return 0;
	}
	if (repair.stage.posture !== "automatic") {
		return emitRepairOperatorStop(deps, {
			outputMode: parsed.outputMode,
			runId: ctx.runId,
			durationMs: durationMs(),
			repair,
			stage: repair.stage,
			stopCause: primaryRepairStopCause(repair),
			message:
				"automatic package repair is not eligible for this adapter state; an operator owns the continuation.",
		});
	}

	const performed =
		repair.stage.continuation.next_action_id === "upgrade_adapter_to_pin"
			? "upgrade_adapter_to_pin"
			: "install_adapter";
	const execution = await executeIsolatedAdapterRepair(repair, deps);
	if (execution.outcome === "stopped") {
		return emitRepairOperatorStop(deps, {
			outputMode: parsed.outputMode,
			runId: ctx.runId,
			durationMs: durationMs(),
			repair,
			stage: repairExecutionStopStage(),
			stopCause: execution.stopCause,
			message: execution.detail,
		});
	}
	writeRepairExecuted(
		deps,
		parsed.outputMode,
		{
			...repair,
			installState: "installed_at_pin",
			observedVersion: repair.definition.pinnedVersion,
		},
		performed,
		{ runId: ctx.runId, durationMs: durationMs() },
	);
	return 0;
}

/** The primary (first) stop cause behind an operator posture. */
function primaryRepairStopCause(repair: RepairAssessment): string {
	if (repair.context?.cause === "version_mismatch") {
		if (repair.context.transition_allowlisted !== true) {
			return "transition_not_allowlisted";
		}
	}
	return repair.assessment.stop_causes[0] ?? "automatic_repair_unavailable";
}

/**
 * Stop causes the isolated-repair executor itself returns (fail-closed stops,
 * R28/R34). `manifest_missing` is shared with the assessment vocabulary
 * ({@link AdapterInstallStopCause}); the rest are execution-boundary causes.
 * Named (not `string`) so a new stop site must extend this union explicitly.
 */
type RepairExecutionStopCause =
	| Extract<AdapterInstallStopCause, "manifest_missing">
	| "package_manager_unavailable"
	| "install_root_unavailable"
	| "registry_unreachable"
	| "registry_redirect"
	| "installer_timeout"
	| "installer_failed"
	| "expected_bin_missing"
	| "lock_rewritten"
	| "publish_conflict"
	| "provenance_mismatch";

type RepairExecutionResult =
	| { outcome: "executed" }
	| { outcome: "stopped"; stopCause: RepairExecutionStopCause; detail: string };

/**
 * The isolated installer boundary (R28/R34; KTD16/KTD17). Preconditions: the
 * fresh assessment selected an automatic package action, so recipe, canonical
 * origins, full integrity, and lifecycle-free eligibility already validated
 * with zero network. Order: approved-executable resolution (local) → egress
 * gate probe (the ONLY pre-install network touch; redirects are refused, not
 * followed) → neutral staging copy → isolated no-shell spawn → expected-bin
 * and lock-rewrite verification → atomic versioned publish → fresh exact-pin
 * provenance from the published bin.
 */
async function executeIsolatedAdapterRepair(
	repair: RepairAssessment,
	deps: ResolvedDeps,
): Promise<RepairExecutionResult> {
	const engine = deps.adapterInstallEngine;
	const policy = repair.definition.installPolicy;
	const { manifestText, lockText } = repair.assessment;
	if (manifestText === undefined || lockText === undefined) {
		return {
			outcome: "stopped",
			stopCause: "manifest_missing",
			detail: "install source texts were not readable at execution time.",
		};
	}

	// Approved absolute package-manager resolution (R28): local, before any
	// network; PATH is never consulted.
	const packageManagerPath = await resolveApprovedPackageManagerExecutable(
		policy,
		engine,
	);
	if (packageManagerPath === undefined) {
		return {
			outcome: "stopped",
			stopCause: "package_manager_unavailable",
			detail:
				"no approved absolute package-manager executable exists on this machine.",
		};
	}
	if (deps.adapterInstallRoot.length === 0) {
		return {
			outcome: "stopped",
			stopCause: "install_root_unavailable",
			detail: "no user-owned install root is available.",
		};
	}

	// Egress gate (R34/AE23): one canonical-origin probe with redirects
	// REFUSED — a 3xx stops here with no redirected request and no mutation.
	const packumentUrl = `${policy.canonicalRegistry.replace(/\/+$/, "")}/${policy.packageName}`;
	let probeStatus: number;
	try {
		probeStatus = (await engine.probeOrigin(packumentUrl)).status;
	} catch {
		return {
			outcome: "stopped",
			stopCause: "registry_unreachable",
			detail: "the canonical registry origin probe failed before install.",
		};
	}
	if (probeStatus >= 300 && probeStatus < 400) {
		return {
			outcome: "stopped",
			stopCause: "registry_redirect",
			detail:
				"the canonical registry answered with a redirect; the egress gate never follows redirects.",
		};
	}
	if (probeStatus < 200 || probeStatus >= 300) {
		return {
			outcome: "stopped",
			stopCause: "registry_unreachable",
			detail: "the canonical registry origin probe was not successful.",
		};
	}

	// Neutral staging root under the user-owned install root (same volume, so
	// the publish rename stays atomic). Source manifest + lock are COPIED in;
	// the caller's cwd and config never participate (AE17).
	let stagingDir: string;
	try {
		await engine.makeDir(deps.adapterInstallRoot);
		stagingDir = await engine.makeTempDir(
			`${deps.adapterInstallRoot}/.staging-${repair.definition.id}-`,
		);
	} catch {
		return {
			outcome: "stopped",
			stopCause: "install_root_unavailable",
			detail: "the user-owned install root could not be prepared.",
		};
	}
	try {
		await engine.writeTextFile(`${stagingDir}/package.json`, manifestText);
		await engine.writeTextFile(`${stagingDir}/package-lock.json`, lockText);
		const userConfigPath = `${stagingDir}/.npmrc`;
		const globalConfigPath = `${stagingDir}/.npmrc-global`;
		await engine.writeTextFile(userConfigPath, "");
		await engine.writeTextFile(globalConfigPath, "");

		const childEnv = buildIsolatedInstallerEnvironment({
			baseEnv: engine.env,
			canonicalRegistry: policy.canonicalRegistry,
			stagingDir,
			userConfigPath,
			globalConfigPath,
			cachePath: `${stagingDir}/.npm-cache`,
		});

		// Isolated no-shell spawn (KTD16): approved absolute executable, the
		// definition-owned argv plus the pinned registry, neutral cwd, exact
		// allowlisted env, stdin ignored (no prompt), bounded timeout.
		const install = await engine.runCommand({
			command: packageManagerPath,
			args: [...policy.installArgv, `--registry=${policy.canonicalRegistry}`],
			cwd: stagingDir,
			env: childEnv,
			exactEnv: true,
			timeoutMs: REPAIR_ADAPTER_INSTALL_TIMEOUT_MS,
		});
		if (install.timedOut) {
			return {
				outcome: "stopped",
				stopCause: "installer_timeout",
				detail:
					"the isolated installer timed out (a prompt cannot be answered; stdin is closed).",
			};
		}
		if (install.exitCode !== 0) {
			return {
				outcome: "stopped",
				stopCause: "installer_failed",
				detail: `the isolated installer exited ${install.exitCode} without publishing.`,
			};
		}

		// Verify the expected bin and that the source lock was not rewritten.
		const stagedBin = `${stagingDir}/node_modules/.bin/${policy.expectedBin}`;
		if (!(await engine.fileExists(stagedBin))) {
			return {
				outcome: "stopped",
				stopCause: "expected_bin_missing",
				detail: "the staged install tree does not contain the expected bin.",
			};
		}
		const stagedLock = await engine.readTextFile(`${stagingDir}/package-lock.json`);
		if (stagedLock !== lockText) {
			return {
				outcome: "stopped",
				stopCause: "lock_rewritten",
				detail:
					"the installer rewrote the lockfile; the source-controlled dependency graph is authoritative.",
			};
		}

		// Atomic publish of the versioned install tree (R28 user scope).
		const finalDir = `${deps.adapterInstallRoot}/${repair.definition.id}/${repair.definition.pinnedVersion}`;
		try {
			await engine.makeDir(`${deps.adapterInstallRoot}/${repair.definition.id}`);
			await engine.publishDir(stagingDir, finalDir);
		} catch {
			return {
				outcome: "stopped",
				stopCause: "publish_conflict",
				detail:
					"the versioned install tree could not be published atomically (a tree may already exist).",
			};
		}

		// Fresh exact-pin provenance from the published bin itself (R33).
		const provenance = await engine.runCommand({
			command: `${finalDir}/node_modules/.bin/${policy.expectedBin}`,
			args: ["--version"],
			cwd: finalDir,
			env: childEnv,
			exactEnv: true,
			timeoutMs: VERSION_READ_TIMEOUT_MS,
		});
		const publishedVersion = extractVersion(provenance.stdout, provenance.stderr);
		if (provenance.exitCode !== 0 || publishedVersion !== repair.definition.pinnedVersion) {
			// The publish already happened, but the tree failed its own proof.
			// Remove the unproven tree (best effort) so a later --execute is not
			// wedged on publish_conflict by an artifact this run refused to trust.
			try {
				await engine.removeDir(finalDir);
			} catch {
				// Best effort; the fail-closed stop below is authoritative either way.
			}
			return {
				outcome: "stopped",
				stopCause: "provenance_mismatch",
				detail:
					"the published install tree did not prove the exact pinned version; do not treat it as authoritative.",
			};
		}
		return { outcome: "executed" };
	} finally {
		// Best-effort staging cleanup; a successful publish already renamed the
		// staging dir away, so this only removes leftovers from stop paths.
		try {
			await engine.removeDir(stagingDir);
		} catch {
			// Leftover staging is diagnosable but never blocks the outcome.
		}
	}
}

/**
 * Executor-owned operator stop stage for a mid-execution failure. The fresh
 * pre-execution assessment stays authoritative for eligibility; a failed
 * attempt exhausts the single execute budget (R19) and hands off to read-only
 * diagnostics under the package constraints.
 */
function repairExecutionStopStage(): BrowserConnectOperatorRepairStage {
	return {
		posture: "operator",
		continuation: {
			requires_operator: true,
			constraints: [
				browserConnectContinuationConstraints.no_pin_policy_change,
				browserConnectContinuationConstraints.no_mutation_from_diagnostics,
			],
			choices: [
				{
					...BROWSER_CONNECT_INSPECT_DIAGNOSTICS_CHOICE,
					summary:
						"Rerun the repair preview with diagnostics to obtain the typed stop cause; execution stopped fail-closed.",
				},
			],
		},
	};
}

function writeRepairPreview(
	deps: ResolvedDeps,
	outputMode: OutputMode,
	repair: RepairAssessment,
	run: { runId: string; durationMs: number },
): void {
	const stage = repair.stage;
	const posture =
		stage === undefined ? "none" : stage.posture === "automatic" ? "automatic" : "operator";
	const data = {
		outcome: "repair_preview" as const,
		...repairProvenanceFields(repair),
		posture,
		...(stage?.posture === "automatic"
			? { eligible_action_id: stage.continuation.next_action_id }
			: {}),
		...(stage?.posture === "operator"
			? {
					operator_choice_ids: (stage.continuation.choices ?? []).map(
						(choice) => choice.id,
					),
				}
			: {}),
		...(repair.context !== undefined
			? { automatic_install: repair.assessment.evidence }
			: {}),
		...(repair.assessment.stop_causes.length > 0
			? { stop_causes: [...repair.assessment.stop_causes] }
			: {}),
		contract_id: BROWSER_CONNECT_CONTRACT_ID,
		schema_version: BROWSER_CONNECT_SCHEMA_VERSION,
	};
	if (outputMode === "plain") {
		deps.stdout.write(
			`repair_preview adapter=${repair.definition.id} state=${repair.installState} posture=${posture} run_id=${run.runId} duration_ms=${run.durationMs}\n`,
		);
		return;
	}
	// Facade rule: choices are error-envelope-only, so an operator-posture
	// preview projects requires_operator + constraints and carries the choice
	// ids in data only.
	writeJsonEnvelope(
		deps.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: run.runId,
			data,
			...(stage?.posture === "automatic"
				? {
						runtime_actions: [...stage.runtime_actions],
						continuation: stage.continuation,
					}
				: {}),
			...(stage?.posture === "operator"
				? {
						continuation: {
							requires_operator: true,
							constraints: stage.continuation.constraints,
						},
					}
				: {}),
		}),
		run,
	);
}

function writeRepairExecuted(
	deps: ResolvedDeps,
	outputMode: OutputMode,
	repair: RepairAssessment,
	performed: "install_adapter" | "upgrade_adapter_to_pin" | "none",
	run: { runId: string; durationMs: number },
): void {
	const data = {
		outcome: "repair_executed" as const,
		...repairProvenanceFields(repair),
		performed,
		contract_id: BROWSER_CONNECT_CONTRACT_ID,
		schema_version: BROWSER_CONNECT_SCHEMA_VERSION,
	};
	if (outputMode === "plain") {
		deps.stdout.write(
			`repair_executed adapter=${repair.definition.id} performed=${performed} version=${repair.definition.pinnedVersion} run_id=${run.runId} duration_ms=${run.durationMs}\n`,
		);
		return;
	}
	writeJsonEnvelope(
		deps.stdout,
		createCliRuntimeSuccessEnvelope({ run_id: run.runId, data }),
		run,
	);
}

/**
 * Emit the repair-adapter.operator_stop envelope (exit 20, error code
 * `operator_stop`): a facade-valid operator stage with constraints and
 * package-owned choices, plus the R30-consistent non-mutating legacy
 * `data.next_action_id` (never install_adapter or upgrade_adapter_to_pin).
 */
function emitRepairOperatorStop(
	deps: ResolvedDeps,
	input: {
		outputMode: OutputMode;
		runId: string;
		durationMs: number;
		repair: RepairAssessment;
		/** Always an operator stage: this emitter never projects an automatic arm. */
		stage: BrowserConnectOperatorRepairStage;
		stopCause: string;
		message: string;
	},
): number {
	const exitCode = CONNECTION_ENTRY_EXIT_CODE;
	const safeMessage = redactBrowserConnectText(input.message);
	emitCliDiagnostic(BROWSER_CONNECT_CLI_NAME, "error", REPAIR_ADAPTER_STOP_ERROR_CODE, {
		code: REPAIR_ADAPTER_STOP_ERROR_CODE,
		exit_code: exitCode,
		adapter: input.repair.definition.id,
		stop_cause: input.stopCause,
	});

	const legacyNextAction =
		input.repair.context !== undefined
			? selectBrowserConnectLegacyNextAction({
					context: input.repair.context,
					stage: input.stage,
				})
			: ("inspect_diagnostics" as const);
	const data = {
		outcome: "repair_stopped" as const,
		...repairProvenanceFields(input.repair),
		stop_cause: input.stopCause,
		...(input.repair.assessment.stop_causes.length > 0
			? { stop_causes: [...input.repair.assessment.stop_causes] }
			: {}),
		next_action_id: legacyNextAction,
		contract_id: BROWSER_CONNECT_CONTRACT_ID,
		schema_version: BROWSER_CONNECT_SCHEMA_VERSION,
	};

	if (input.outputMode === "plain") {
		deps.stderr.write(
			`${REPAIR_ADAPTER_STOP_ERROR_CODE}: ${safeMessage} stop_cause=${input.stopCause} (run_id=${input.runId})\n`,
		);
		return exitCode;
	}

	const structured: StructuredRuntimeError = createCliRuntimeError({
		run_id: input.runId,
		code: REPAIR_ADAPTER_STOP_ERROR_CODE,
		message: safeMessage,
		exit_code: exitCode,
		severity: "error",
		recoverability: "repair_state",
		retryable: false,
		hint: {
			summary:
				"A package safety gate stopped automatic adapter repair; an operator owns the continuation.",
		},
		failure_domain: "browser_entry_handoff",
	});

	const continuation: RuntimeContinuationGuidance = input.stage.continuation;

	writeJsonEnvelope(
		deps.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: exitCode,
			error: structured,
			data,
			continuation,
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return exitCode;
}

// ---------------------------------------------------------------------------
// run dispatch (R1/R14/R17/R18; KTD4/KTD5). Reuse the connect gate, emit the
// verified handoff envelope on STDERR before exec (stdout belongs to the wrapped
// command end-to-end), inject the endpoint into the wrapped command's argv/env,
// then spawn-and-wait with exit passthrough. On gate failure: emit the pre-exec
// failure envelope on STDERR (exit 20 family), exec never starts. On spawn
// failure (wrapped binary missing): exit 127 AFTER the envelope, plus a SECOND
// stderr diagnostic line so browser-connect's 127 is distinguishable from a
// wrapped tool's own 127. Passthrough args are NEVER echoed into any envelope or
// diagnostic (R14/KTD10) — only the verified attachment + endpoint are named.
// ---------------------------------------------------------------------------

async function dispatchRun(
	parsed: Extract<ParsedInvocation, { kind: "run" }>,
	deps: ResolvedDeps,
	ctx: {
		runId: string;
		startedAtMs: number;
		reconfigureDiagnostics: () => void;
	},
): Promise<number> {
	const durationMs = () => deps.now() - ctx.startedAtMs;
	emitCliDiagnostic(BROWSER_CONNECT_CLI_NAME, "info", "command-start", {
		command: "run",
		phase: "start",
		adapter: parsed.adapterId,
		// R14/KTD10: the wrapped command's args are NEVER logged here.
	});

	const gate = await runConnectGate(parsed.adapterId, deps, ctx, {
		...(parsed.port === undefined ? {} : { explicitPort: parsed.port }),
	});

	// Gate FAILURE → pre-exec connect failure on STDERR (exit 20 family); exec
	// never starts. Every connect-family failure homes on the single run pre-exec
	// station (run.preexec_connect_failed), so exit 20 is reserved to pre-exec and
	// stays mechanically distinguishable from any wrapped-tool exit (R17/AE6).
	if (gate.outcome === "failed") {
		return emitRunStderrFailure(deps, {
			outputMode: parsed.outputMode,
			runId: ctx.runId,
			durationMs: durationMs(),
			failureClass: "preexec-connect-failed",
			launch: gate.launch,
			...(gate.detail ? { message: gate.detail } : {}),
			// R12: the pre-exec station retains the underlying typed failure so
			// repair-path selection inherits its exact posture (AE10).
			repairContext: {
				failure_class: "preexec-connect-failed",
				cause: "preexec_connect_failure",
				underlying: gate.repair_context,
			},
			repairChainHop: parsed.repairChainHop,
			...(parsed.port === undefined ? {} : { requestedPort: parsed.port }),
		});
	}

	// Gate SUCCESS → post-gate phase (KTD5/AE6). Once the gate has verified, ANY
	// throw from here on — including a synchronous failure in the handoff-envelope
	// WRITE itself — must NOT reach main's outer catch. That catch routes through
	// emitFailure, which in json mode writes a `runtime-error-unexpected` envelope
	// onto STDOUT (contaminating the wrapped command's byte-exact stdout channel,
	// the exact hazard KTD5 exists to prevent) and exits 1 (which AE6 says can
	// never happen post-gate). So the try starts at the handoff write and wraps the
	// exec path: any post-gate throw routes to STDERR via the run emitter with exit
	// 1 (browser-connect's own unexpected-runtime code — an internal error, distinct
	// from passthrough — but on stderr, never stdout).
	try {
		// Write the verified handoff envelope to STDERR BEFORE exec (KTD5). stdout is
		// untouched so the wrapped command owns it end-to-end. Inside the try so a
		// throw here routes to emitRunUnexpectedStderrFailure, not main's stdout
		// emitter.
		writeRunHandoffEnvelopeToStderr(deps, parsed.outputMode, gate, {
			runId: ctx.runId,
			durationMs: durationMs(),
		});

		// Inject the verified endpoint into the wrapped command, then spawn-and-wait.
		const spawnResult = await runWrappedCommand(
			parsed.tail,
			gate.injection,
			deps.runBaseEnv,
			deps.runSpawner,
		);

		if (spawnResult.outcome === "spawn-failed") {
			// KTD4: the wrapped binary was missing. The envelope is already on stderr;
			// emit a SECOND stderr JSON diagnostic line (wrapped-command-not-found +
			// its affordance id) so browser-connect's 127 is distinguishable from a
			// wrapped tool's OWN 127 (which passes through with NO diagnostic line).
			// The typed context carries at most a NORMALIZED basename (R26) — policy
			// re-validates it and fails closed on unsafe identity; no argv, no env
			// values, no full path ever enters the context. The spawner's raw
			// detail is DROPPED (R26): a quoted full executable path inside it can
			// survive the free-text redactor, so a fixed package-owned message is
			// the only prose that serializes.
			const wrappedBasename = parsed.tail[0]?.split("/").at(-1);
			return emitRunStderrFailure(deps, {
				outputMode: parsed.outputMode,
				runId: ctx.runId,
				durationMs: durationMs(),
				failureClass: "wrapped-command-not-found",
				launch: gate.launch,
				message:
					"the wrapped command's executable could not be started (missing or not executable).",
				repairContext: {
					failure_class: "wrapped-command-not-found",
					cause: "wrapped_executable_absent",
					deterministic_correction: false,
					...(wrappedBasename === undefined || wrappedBasename.length === 0
						? {}
						: { executable_basename: wrappedBasename }),
				},
			});
		}

		// Passthrough: the wrapped tool's exit code (or 128+signal) is returned
		// unchanged, with NO connect-failure envelope (R17/AE6). stdout was the
		// wrapped tool's alone.
		return spawnResult.exitCode;
	} catch (_error) {
		// A post-handoff throw during exec (e.g. the spawner rejected for a reason
		// other than the caught spawn-failed case). Route it to STDERR — never
		// stdout (KTD5) — as a runtime-error-unexpected envelope, exit 1. The raw
		// error text never reaches the envelope (R14 leak surface).
		return emitRunUnexpectedStderrFailure(deps, {
			outputMode: parsed.outputMode,
			runId: ctx.runId,
			durationMs: durationMs(),
			launch: gate.launch,
		});
	}
}

function dashboardDeps(deps: ResolvedDeps): DashboardDeps {
	return {
		adapterRuntime: deps.adapterRuntime,
		listAdapterDefinitions: deps.listAdapterDefinitions,
	};
}

// ---------------------------------------------------------------------------
// Success envelopes. Each command's structured payload is built ONLY via U2's
// createBrowserConnectEnvelopeData (no hand-built literals) and wrapped by the
// facade success-envelope builder. --json mode writes the envelope to STDOUT.
// ---------------------------------------------------------------------------

function writeConnectSuccess(
	deps: ResolvedDeps,
	outputMode: OutputMode,
	gate: ConnectGateVerified,
	run: { runId: string; durationMs: number },
): void {
	const data: BrowserConnectEnvelopeData = createBrowserConnectEnvelopeData({
		outcome: "verified",
		environment: gate.environment,
		browser_entry_mode: gate.attachment.route,
		attachment: gate.attachment,
		endpoint: gate.endpoint,
		launch: gate.launch,
		proof: gate.proof,
	});
	writeSuccessEnvelope(deps, outputMode, data, {
		runId: run.runId,
		durationMs: run.durationMs,
		plain: `verified adapter=${gate.attachment.adapter_id} route=${gate.attachment.route} launched=${gate.launch.launched}`,
	});
}

function writeCheckSuccess(
	deps: ResolvedDeps,
	outputMode: OutputMode,
	result: Extract<EnvironmentGatewayResult, { outcome: "verified" }>,
	run: { runId: string; durationMs: number },
): void {
	// check reports the verified environment; it authorizes no adapter
	// attachment, so it emits the environment proof with the browser-entry mode
	// named by the environment's declared route evidence — a read, not a handoff.
	const data = createBrowserConnectEnvelopeData({
		outcome: "verified",
		environment: result.environment,
		browser_entry_mode: "explicit-cdp",
		attachment: {
			adapter_id: "none",
			route: "explicit-cdp",
			probe_executable: "none",
		},
		endpoint: result.endpoint,
		launch: result.launch,
		proof: result.proof,
	});
	writeSuccessEnvelope(deps, outputMode, data, {
		runId: run.runId,
		durationMs: run.durationMs,
		plain: `environment_verified environment=${result.environment.name} launched=${result.launch.launched}`,
	});
}

function writeSuccessEnvelope(
	deps: ResolvedDeps,
	outputMode: OutputMode,
	data: Record<string, unknown>,
	run: { runId: string; durationMs: number; plain: string },
): void {
	const action = successActionById.get("use_verified_handoff");
	const runtimeActions: RuntimeActionGuidance[] = action
		? [
				{
					id: action.id,
					summary: action.summary,
					side_effects: [
						...action.sideEffects,
					] as RuntimeActionGuidance["side_effects"],
				},
			]
		: [];
	const continuation: RuntimeContinuationGuidance = {
		next_action_id: "use_verified_handoff",
	};
	if (outputMode === "plain") {
		deps.stdout.write(
			`${run.plain} run_id=${run.runId} duration_ms=${run.durationMs}\n`,
		);
		return;
	}
	writeJsonEnvelope(
		deps.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: run.runId,
			data,
			runtime_actions: runtimeActions,
			continuation,
		}),
		run,
	);
}

function writeDashboardSuccess(
	deps: ResolvedDeps,
	outputMode: OutputMode,
	dashboard: BrowserConnectDashboard,
	run: { runId: string; durationMs: number },
): void {
	// The dashboard is a read-only projection, not a handoff; it still self-
	// describes its result contract so a reader sees the schema version (R16).
	const data = {
		outcome: "dashboard" as const,
		environment: dashboard.environment,
		environment_routes: [...dashboard.environment_routes],
		adapters: dashboard.adapters.map((adapter) => ({
			adapter_id: adapter.adapter_id,
			display_name: adapter.display_name,
			installed: adapter.installed,
			connectable: adapter.connectable,
			...(adapter.provenance_detail
				? { provenance_detail: redactBrowserConnectText(adapter.provenance_detail) }
				: {}),
			routes: adapter.routes.map((route) => ({ ...route })),
		})),
		contract_id: BROWSER_CONNECT_CONTRACT_ID,
		schema_version: BROWSER_CONNECT_SCHEMA_VERSION,
	};
	if (outputMode === "plain") {
		const lines = dashboard.adapters.map(
			(adapter) =>
				`  ${adapter.adapter_id} installed=${adapter.installed} connectable=${adapter.connectable}`,
		);
		deps.stdout.write(
			[
				`dashboard environment=${dashboard.environment} run_id=${run.runId} duration_ms=${run.durationMs}`,
				...lines,
				"",
			].join("\n"),
		);
		return;
	}
	writeJsonEnvelope(
		deps.stdout,
		createCliRuntimeSuccessEnvelope({ run_id: run.runId, data }),
		run,
	);
}

// ---------------------------------------------------------------------------
// Failure envelopes. Every failure routes through the affordance catalog: one
// action id per failure class (R2). The station error code (branch id) is
// stamped so the emitted envelope matches the Branch Station Catalog.
//
// The three emitters (emitFailure on stdout, emitRunStderrFailure and
// emitRunUnexpectedStderrFailure on stderr) all share the same action-id /
// exit-code / branch-id / envelope-data / runtime-actions / continuation
// construction. That shared shape is safety-relevant (redaction, exit codes,
// action ids) so it lives in ONE builder — buildFailureEnvelopeParts — and each
// emitter reduces to: derive its failure-class-specific `safeMessage`, call the
// builder, then pick the writer (stdout vs stderr) + line format (writeJson-
// Envelope vs writeRunEnvelopeLine) + the class-specific severity/failure_domain.
// ---------------------------------------------------------------------------

/**
 * The shared, per-failure parts every failure emitter needs: the policy stage,
 * the legacy schema-1 action id + record, exit code, station branch id, the U2
 * envelope data payload, and the runtime-actions + continuation guidance.
 * Emitters supply the already-derived `safeMessage` (its redaction differs by
 * caller) and choose the stream + line format + severity/failure_domain.
 */
export type FailureEnvelopeParts = {
	/** The U1 recovery stage the policy selected for this failure. */
	stage: BrowserConnectRepairStage;
	/** Legacy schema-1 `data.next_action_id` value (R16/R30). */
	actionId: BrowserConnectFailureActionId;
	exitCode: number;
	branchId: string;
	action: (typeof browserConnectFailureActions)[number] | undefined;
	data: BrowserConnectEnvelopeData;
	/** Ordered automatic actions; EMPTY for operator stages (emit nothing). */
	runtimeActions: RuntimeActionGuidance[];
	continuation: RuntimeContinuationGuidance;
};

/**
 * The single projection chokepoint (U4/R1/R3): every failure emitter — the
 * check/connect stdout envelope, the run stderr envelopes, and repair-adapter's
 * usage rejection — flows through here. It selects the U1 recovery stage from
 * the full typed invocation (command + bounded hop + typed repair context) and
 * projects it verbatim:
 *
 * - automatic stage → ordered `runtime_actions` plus exactly one
 *   `continuation.next_action_id` (with all applicable constraints);
 * - operator stage → `continuation.requires_operator: true`, package choices,
 *   at least one constraint summary, and NO next action.
 *
 * Legacy `data.next_action_id` comes from the U1 compatibility selector: the
 * exact automatic mirror, or a closed non-mutating stop (R16/R30). Drivers
 * follow the outer continuation; policy is never inferred from prose (R3).
 */
export function buildFailureEnvelopeParts(input: {
	command: BrowserConnectCommand;
	failureClass: BrowserConnectFailureClass;
	safeMessage: string;
	launch?: BrowserConnectLaunchProvenance;
	repairContext: BrowserConnectRepairContext;
	repairChainHop?: BrowserConnectRepairChainHop;
	requestedPort?: number;
}): FailureEnvelopeParts {
	const stage = selectBrowserConnectRepairPath(
		{
			command: input.command,
			repair_chain_hop: input.repairChainHop ?? 0,
		},
		input.repairContext,
	);
	const actionId = selectBrowserConnectLegacyNextAction({
		context: input.repairContext,
		stage,
	});
	const exitCode = FAILURE_CLASS_EXIT_CODE[input.failureClass];
	const branchId = FAILURE_CLASS_BRANCH_ID[input.failureClass];

	// Usable hop-0 suggested-port evidence is projected INTO the envelope data
	// (R6): the value a `use_suggested_port` continuation needs must be machine-
	// readable, never scraped from a stderr diagnostic. A hop-1 failure never
	// re-advertises a port (the one-hop budget is spent, R23), and an
	// unverified suggestion is preserved as diagnostics only.
	const suggestedEvidence = suggestedPortEvidenceOf(input.repairContext);
	const projectedSuggestedPort =
		suggestedEvidence !== undefined &&
		suggestedEvidence.verified_free === true &&
		(input.repairChainHop ?? 0) === 0
			? suggestedEvidence
			: undefined;

	const data = createBrowserConnectEnvelopeData({
		outcome: "failed",
		failure_class: input.failureClass,
		next_action_id: actionId,
		environment: AGENT_CHROME_IDENTITY,
		launch: input.launch ?? { launched: false },
		...(projectedSuggestedPort === undefined
			? {}
			: { suggested_explicit_port: projectedSuggestedPort }),
		detail: input.safeMessage,
	});

	// The branch diagnostic names the typed evidence so the runtime provably
	// received the parsed port, hop, cause, and preserved suggestion unchanged.
	const suggestedPort = suggestedEvidence?.port;
	emitCliDiagnostic(BROWSER_CONNECT_CLI_NAME, "error", branchId, {
		code: branchId,
		exit_code: exitCode,
		posture: stage.posture,
		...(input.repairChainHop === undefined
			? {}
			: { repair_chain_hop: input.repairChainHop }),
		...(input.requestedPort === undefined
			? {}
			: { requested_port: input.requestedPort }),
		cause: input.repairContext.cause,
		...(suggestedPort === undefined ? {} : { suggested_port: suggestedPort }),
	});

	const action = failureActionById.get(actionId);
	const runtimeActions: RuntimeActionGuidance[] =
		stage.posture === "automatic" ? [...stage.runtime_actions] : [];
	const continuation: RuntimeContinuationGuidance = stage.continuation;

	return {
		stage,
		actionId,
		exitCode,
		branchId,
		action,
		data,
		runtimeActions,
		continuation,
	};
}

/**
 * The preserved suggested-port evidence inside a typed repair context, if any
 * (R6). A pre-exec run failure inherits its underlying context's suggestion.
 */
function suggestedPortEvidenceOf(
	context: BrowserConnectRepairContext | undefined,
): BrowserConnectSuggestedPortEvidence | undefined {
	if (context === undefined) return undefined;
	if (context.failure_class === "foreign-listener") {
		return context.suggested_explicit_port;
	}
	if (context.failure_class === "preexec-connect-failed") {
		return suggestedPortEvidenceOf(context.underlying);
	}
	return undefined;
}

/**
 * Emit the structured failure envelope for a failure class + command context.
 *
 * Builds the failure payload ONLY via U2's createBrowserConnectEnvelopeData
 * (which enforces the one-authorized-action-per-class rule and redacts free
 * text), then wraps it in the facade runtime-error envelope with the station
 * branch-id error code and the exit code from the KTD4 policy.
 */
function emitFailure(
	deps: ResolvedDeps,
	input: {
		outputMode: OutputMode;
		runId: string;
		durationMs: number;
		failureClass: BrowserConnectFailureClass;
		command: BrowserConnectCommand;
		message?: string;
		launch?: BrowserConnectLaunchProvenance;
		repairContext: BrowserConnectRepairContext;
		repairChainHop?: BrowserConnectRepairChainHop;
		requestedPort?: number;
	},
): number {
	const safeMessage = input.message
		? input.failureClass === "usage-invalid"
			? sanitizeBrowserConnectUsageMessage(input.message)
			: redactBrowserConnectText(input.message)
		: defaultMessageFor(input.failureClass);

	const parts = buildFailureEnvelopeParts({
		command: input.command,
		failureClass: input.failureClass,
		safeMessage,
		...(input.launch ? { launch: input.launch } : {}),
		repairContext: input.repairContext,
		...(input.repairChainHop === undefined
			? {}
			: { repairChainHop: input.repairChainHop }),
		...(input.requestedPort === undefined
			? {}
			: { requestedPort: input.requestedPort }),
	});
	const { actionId, exitCode, branchId, action, data } = parts;

	if (input.outputMode === "plain") {
		deps.stderr.write(
			`${branchId}: ${safeMessage} action=${actionId} (run_id=${input.runId})\n`,
		);
		return exitCode;
	}

	const structured: StructuredRuntimeError = createCliRuntimeError({
		run_id: input.runId,
		code: branchId,
		message: safeMessage,
		exit_code: exitCode,
		severity: exitCode === RUNTIME_FAILURE_EXIT_CODE ? "fatal" : "error",
		recoverability: "none",
		retryable: false,
		hint: { summary: action?.summary ?? safeMessage },
		failure_domain:
			input.failureClass === "usage-invalid" ||
			input.failureClass === "run-missing-separator" ||
			input.failureClass === "adapter-unknown"
				? "input"
				: "browser_entry_handoff",
	});

	writeJsonEnvelope(
		deps.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: exitCode,
			error: structured,
			data,
			...(parts.runtimeActions.length > 0
				? { runtime_actions: parts.runtimeActions }
				: {}),
			continuation: parts.continuation,
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return exitCode;
}

function defaultMessageFor(failureClass: BrowserConnectFailureClass): string {
	const action =
		failureActionById.get(
			BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS[failureClass],
		) ?? undefined;
	return action?.summary ?? `browser-connect failure: ${failureClass}`;
}

// ---------------------------------------------------------------------------
// run stderr emitters (KTD5). The verified handoff and every run failure go to
// STDERR — stdout belongs to the wrapped command end-to-end. These mirror the
// stdout emitters above but target deps.stderr and stamp the run-command station
// branch ids.
//
// Envelope channel discipline (KTD5): each run envelope is written as ONE
// compact JSON LINE, not the facade's pretty multi-line form. stderr is a shared
// channel — browser-connect diagnostics and (during exec) the wrapped command's
// own stderr also land here — so the envelope must be a single, independently
// recoverable line. writeRunEnvelopeLine injects the facade-owned run_id +
// duration_ms exactly as writeJsonEnvelope would, then serializes on one line.
// ---------------------------------------------------------------------------

/**
 * Write one facade envelope to STDERR as a single compact JSON line (KTD5).
 * Injects the facade-owned top-level `run_id` and `duration_ms` (matching
 * writeJsonEnvelope's contract) so the line is a complete, standalone envelope
 * recoverable from a shared stderr stream.
 */
function writeRunEnvelopeLine(
	deps: ResolvedDeps,
	envelope: Record<string, unknown>,
	run: { runId: string; durationMs: number },
): void {
	deps.stderr.write(
		`${JSON.stringify({
			...envelope,
			run_id: run.runId,
			duration_ms: run.durationMs,
		})}\n`,
	);
}

/**
 * Write the verified handoff envelope to STDERR before exec (KTD5/R17). Built
 * ONLY via U2's createBrowserConnectEnvelopeData; the wrapped command's args
 * never enter it (R14/KTD10) — it names the authorized attachment + endpoint.
 */
function writeRunHandoffEnvelopeToStderr(
	deps: ResolvedDeps,
	outputMode: OutputMode,
	gate: ConnectGateVerified,
	run: { runId: string; durationMs: number },
): void {
	const data: BrowserConnectEnvelopeData = createBrowserConnectEnvelopeData({
		outcome: "verified",
		environment: gate.environment,
		browser_entry_mode: gate.attachment.route,
		attachment: gate.attachment,
		endpoint: gate.endpoint,
		launch: gate.launch,
		proof: gate.proof,
	});
	const action = successActionById.get("use_verified_handoff");
	const runtimeActions: RuntimeActionGuidance[] = action
		? [
				{
					id: action.id,
					summary: action.summary,
					side_effects: [
						...action.sideEffects,
					] as RuntimeActionGuidance["side_effects"],
				},
			]
		: [];
	const continuation: RuntimeContinuationGuidance = {
		next_action_id: "use_verified_handoff",
	};
	if (outputMode === "plain") {
		deps.stderr.write(
			`verified adapter=${gate.attachment.adapter_id} route=${gate.attachment.route} launched=${gate.launch.launched} run_id=${run.runId} duration_ms=${run.durationMs}\n`,
		);
		return;
	}
	writeRunEnvelopeLine(
		deps,
		createCliRuntimeSuccessEnvelope({
			run_id: run.runId,
			data,
			runtime_actions: runtimeActions,
			continuation,
		}) as unknown as Record<string, unknown>,
		run,
	);
}

/**
 * Emit a run failure envelope to STDERR (KTD5). Handles the four run failure
 * classes: usage-invalid (exit 2, a run head rejected before dispatch),
 * run-missing-separator (exit 2), preexec-connect-failed (exit 20, exec never
 * started), and wrapped-command-not-found (exit 127, the SECOND diagnostic
 * line after the handoff envelope). All free text passes the redaction
 * chokepoint; the wrapped command's args are never included (R14).
 */
function emitRunStderrFailure(
	deps: ResolvedDeps,
	input: {
		outputMode: OutputMode;
		runId: string;
		durationMs: number;
		failureClass: Extract<
			BrowserConnectFailureClass,
			| "usage-invalid"
			| "run-missing-separator"
			| "preexec-connect-failed"
			| "wrapped-command-not-found"
		>;
		message?: string;
		launch?: BrowserConnectLaunchProvenance;
		repairContext: BrowserConnectRepairContext;
		repairChainHop?: BrowserConnectRepairChainHop;
		requestedPort?: number;
	},
): number {
	const safeMessage = input.message
		? input.failureClass === "usage-invalid"
			? sanitizeBrowserConnectUsageMessage(input.message)
			: redactBrowserConnectText(input.message)
		: defaultMessageFor(input.failureClass);

	const parts = buildFailureEnvelopeParts({
		command: "run",
		failureClass: input.failureClass,
		safeMessage,
		...(input.launch ? { launch: input.launch } : {}),
		repairContext: input.repairContext,
		...(input.repairChainHop === undefined
			? {}
			: { repairChainHop: input.repairChainHop }),
		...(input.requestedPort === undefined
			? {}
			: { requestedPort: input.requestedPort }),
	});
	const { actionId, exitCode, branchId, action, data } = parts;

	if (input.outputMode === "plain") {
		deps.stderr.write(
			`${branchId}: ${safeMessage} action=${actionId} (run_id=${input.runId})\n`,
		);
		return exitCode;
	}

	const structured: StructuredRuntimeError = createCliRuntimeError({
		run_id: input.runId,
		code: branchId,
		message: safeMessage,
		exit_code: exitCode,
		severity: "error",
		recoverability: "none",
		retryable: false,
		hint: { summary: action?.summary ?? safeMessage },
		failure_domain:
			input.failureClass === "usage-invalid" ||
			input.failureClass === "run-missing-separator"
				? "input"
				: "browser_entry_handoff",
	});

	writeRunEnvelopeLine(
		deps,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: exitCode,
			error: structured,
			data,
			...(parts.runtimeActions.length > 0
				? { runtime_actions: parts.runtimeActions }
				: {}),
			continuation: parts.continuation,
		}) as unknown as Record<string, unknown>,
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return exitCode;
}

/**
 * Emit a `runtime-error-unexpected` failure envelope to STDERR (KTD5/AE6) for a
 * post-handoff throw during run's exec phase. Distinct from
 * {@link emitRunStderrFailure} (whose three run failure classes are all
 * pre-exec/spawn-attribution): this is browser-connect's OWN unexpected-runtime
 * code (exit 1, fatal), and it MUST land on STDERR — never stdout — because the
 * verified handoff envelope was already written to stderr and stdout belongs to
 * the wrapped command byte-exact. No raw error text reaches the envelope (R14).
 */
function emitRunUnexpectedStderrFailure(
	deps: ResolvedDeps,
	input: {
		outputMode: OutputMode;
		runId: string;
		durationMs: number;
		launch?: BrowserConnectLaunchProvenance;
	},
): number {
	const failureClass: BrowserConnectFailureClass = "runtime-error-unexpected";
	const safeMessage = "browser-connect hit an unexpected runtime failure.";

	const parts = buildFailureEnvelopeParts({
		command: "run",
		failureClass,
		safeMessage,
		...(input.launch ? { launch: input.launch } : {}),
		repairContext: UNEXPECTED_RUNTIME_REPAIR_CONTEXT,
	});
	const { actionId, exitCode, branchId, action, data } = parts;

	if (input.outputMode === "plain") {
		deps.stderr.write(
			`${branchId}: ${safeMessage} action=${actionId} (run_id=${input.runId})\n`,
		);
		return exitCode;
	}

	const structured: StructuredRuntimeError = createCliRuntimeError({
		run_id: input.runId,
		code: branchId,
		message: safeMessage,
		exit_code: exitCode,
		severity: "fatal",
		recoverability: "none",
		retryable: false,
		hint: { summary: action?.summary ?? safeMessage },
		failure_domain: "browser_entry_handoff",
	});

	writeRunEnvelopeLine(
		deps,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: exitCode,
			error: structured,
			data,
			...(parts.runtimeActions.length > 0
				? { runtime_actions: parts.runtimeActions }
				: {}),
			continuation: parts.continuation,
		}) as unknown as Record<string, unknown>,
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return exitCode;
}

/**
 * Typed context for a parse-phase usage failure (R9): no deterministic
 * correction exists for a rejected argv, so policy selects the operator
 * input-correction stage and the legacy stop stays `change_input`.
 */
const USAGE_INVALID_REPAIR_CONTEXT: BrowserConnectRepairContext = {
	failure_class: "usage-invalid",
	cause: "usage_invalid",
	deterministic_correction: false,
};

/**
 * Typed context for an unexpected runtime failure (R9): fail closed to the
 * operator diagnostics stage.
 */
const UNEXPECTED_RUNTIME_REPAIR_CONTEXT: BrowserConnectRepairContext = {
	failure_class: "runtime-error-unexpected",
	cause: "unexpected_runtime_error",
};

/**
 * Map a caught error to a failure envelope. A facade usage error becomes the
 * usage-invalid station (exit 2); anything else is the runtime-error-unexpected
 * station (exit 1) with a fixed message — a raw error's text never reaches the
 * envelope (R14 leak surface).
 *
 * A `run` invocation's usage rejection routes through the run STDERR path
 * (KTD5): stdout belongs to the wrapped command end-to-end, so the envelope
 * is one stderr JSON line, exit 2, with the honest `run` command context —
 * never the stdout emitter's hardcoded `check`.
 */
function emitCaughtError(
	deps: ResolvedDeps,
	input: {
		error: unknown;
		outputMode: OutputMode;
		runId: string;
		durationMs: number;
		invokedRun: boolean;
	},
): number {
	if (input.error instanceof CliUsageError) {
		const message = input.error.options.showMessage
			? input.error.message
			: "help requested";
		if (input.invokedRun) {
			return emitRunStderrFailure(deps, {
				outputMode: input.outputMode,
				runId: input.runId,
				durationMs: input.durationMs,
				failureClass: "usage-invalid",
				message,
				repairContext: USAGE_INVALID_REPAIR_CONTEXT,
			});
		}
		return emitFailure(deps, {
			outputMode: input.outputMode,
			runId: input.runId,
			durationMs: input.durationMs,
			failureClass: "usage-invalid",
			command: "check",
			message,
			repairContext: USAGE_INVALID_REPAIR_CONTEXT,
		});
	}
	// A pre-gate run failure must keep stdout untouched for the wrapped
	// command (KTD5): the unexpected-runtime arm branches on the invocation
	// head exactly like the usage arm above.
	if (input.invokedRun) {
		return emitRunUnexpectedStderrFailure(deps, {
			outputMode: input.outputMode,
			runId: input.runId,
			durationMs: input.durationMs,
		});
	}
	return emitFailure(deps, {
		outputMode: input.outputMode,
		runId: input.runId,
		durationMs: input.durationMs,
		failureClass: "runtime-error-unexpected",
		command: "check",
		message: "browser-connect hit an unexpected runtime failure.",
		repairContext: UNEXPECTED_RUNTIME_REPAIR_CONTEXT,
	});
}

// ---------------------------------------------------------------------------
// Argv parsing. Bare invocation → dashboard (R15). `check`/`connect` are the
// explicit subcommands this unit owns; `run` is reserved for U7 and rejected
// here with a not-yet-implemented usage error until U7 lands its parser.
// ---------------------------------------------------------------------------

function parseArgv(
	argv: readonly string[],
	runTail?: readonly string[],
): ParsedInvocation {
	// `run` is handled FIRST, before the whole-argv --help/--version scan below.
	// The tail after `--` was already split from the RAW argv in main (before the
	// diagnostic pre-parser could strip `--` or scan the tail); it arrives here as
	// `runTail`. `argv` here is the diagnostic-stripped HEAD only. Only the HEAD is
	// parsed as browser-connect argv; the tail is the wrapped command verbatim.
	if (argv[0] === "run") {
		return parseRunArgv(argv.slice(1), runTail);
	}

	// `repair-adapter` is also handled before the global --help/--version scan:
	// every non-mode flag — INCLUDING `--version` — is a rejected package-policy
	// override on this surface (R33). `--help` stays discoverable inside its own
	// parser.
	if (argv[0] === "repair-adapter") {
		return parseRepairAdapterArgv(argv.slice(1));
	}

	if (argv.includes("--help") || argv.includes("-h")) {
		return { kind: "help", ...helpCommand(findCommandArg(argv)) };
	}
	if (argv.includes("--version")) {
		return { kind: "version" };
	}

	if (argv.length === 0) {
		return { kind: "dashboard", outputMode: "json" };
	}

	const first = argv[0];
	// A bare invocation with only flags (e.g. `--json`) is still the dashboard.
	if (first.startsWith("-")) {
		assertNoUnknownFlags(argv);
		return { kind: "dashboard", outputMode: inferOutputMode(argv) };
	}

	if (first === "help") {
		return { kind: "help", ...helpCommand(findCommandArg(argv.slice(1))) };
	}

	if (!isBrowserConnectCommand(first)) {
		throw usageError(`unknown command: ${first}`);
	}

	const rest = argv.slice(1);
	if (first === "dashboard") {
		assertNoUnknownFlags(rest);
		return { kind: "dashboard", outputMode: inferOutputMode(rest) };
	}
	if (first === "check") {
		// R15/KTD7: the contract owner validates --port/--repair-chain-hop ONCE;
		// only the extracted rest is parsed as command-local argv.
		const gateway = extractBrowserConnectGatewayOptions(rest);
		assertNoUnknownFlags(gateway.rest);
		return {
			kind: "check",
			outputMode: inferOutputMode(gateway.rest),
			...(gateway.options.port === undefined
				? {}
				: { port: gateway.options.port }),
			repairChainHop: gateway.options.repairChainHop,
		};
	}
	if (first === "connect") {
		// Extract gateway options BEFORE the positional scan so an option value
		// (e.g. `--port 9333`) can never be mistaken for the adapter id.
		const gateway = extractBrowserConnectGatewayOptions(rest);
		const adapterId = firstPositional(gateway.rest);
		if (adapterId === undefined) {
			throw usageError("connect requires an adapter id");
		}
		assertNoUnknownFlags(gateway.rest);
		return {
			kind: "connect",
			adapterId,
			outputMode: inferOutputMode(gateway.rest),
			...(gateway.options.port === undefined
				? {}
				: { port: gateway.options.port }),
			repairChainHop: gateway.options.repairChainHop,
		};
	}
	// first === "run" is handled at the top of parseArgv (before the global
	// --help/--version scan). Any other command is unreachable here.
	throw usageError(`unknown command: ${first}`);
}

/**
 * Parse a `run` invocation's HEAD (everything after the `run` command word, with
 * the `--` and tail already split off in main).
 *
 * `runHead` is the diagnostic-stripped head (adapter id + `--json`; the global
 * diagnostic flags were already consumed by the pre-parser). `runTail` is the
 * verbatim wrapped command, pre-split from the RAW argv so the diagnostic parser
 * never saw the `--` or scanned the tail. When `runTail` is undefined, no `--`
 * was present → the run-missing-separator station (exit 2), unless the head asked
 * for help (kept discoverable).
 *
 * An EMPTY tail (`run <adapter> --` with nothing after the `--`) is a purely
 * syntactic input error, not a runtime failure: there is no wrapped command to
 * run. It maps to the SAME run-missing-separator station (exit 2, STDERR) as a
 * missing `--`, and — critically — is rejected HERE in the parse phase, BEFORE
 * the connect gate runs any environment proof or auto-launch. Otherwise the gate
 * would do real environment work only for `applyInjection` to reject the empty
 * tail as an unexpected runtime error (exit 1) downstream.
 */
function parseRunArgv(
	runHead: readonly string[],
	runTail?: readonly string[],
): ParsedInvocation {
	// A --help on the head (before `--`) is command help — keep it discoverable
	// regardless of whether a separator/tail is present.
	if (runHead.includes("--help") || runHead.includes("-h")) {
		return { kind: "help", command: "run" };
	}

	// No `--` at all, OR a `--` with an EMPTY tail: both are the run-missing-
	// separator station (exit 2), rejected in the parse phase before any gate.
	// The two arms carry DISTINCT typed causes (R12/AE6): an empty tail proves
	// the wrapped command is missing; a missing `--` may still hold a non-empty
	// wrapped command in parser memory (extra positionals beyond the adapter
	// id), preserved only as a boolean marker — never echoed (R26).
	if (runTail === undefined) {
		return {
			kind: "run-missing-separator",
			cause: "separator_missing",
			wrappedCommandPresent: headHoldsWrappedCommand(runHead),
		};
	}
	if (runTail.length === 0) {
		return {
			kind: "run-missing-separator",
			cause: "wrapped_command_missing",
			wrappedCommandPresent: false,
		};
	}

	// Gateway options live in the HEAD only (R15); the tail is the wrapped
	// command verbatim and is never scanned. Extract before the positional scan
	// so an option value can never be mistaken for the adapter id.
	const gateway = extractBrowserConnectGatewayOptions(runHead);
	const adapterId = firstPositional(gateway.rest);
	if (adapterId === undefined) {
		throw usageError("run requires an adapter id before the -- separator");
	}
	assertNoUnknownFlags(gateway.rest);
	return {
		kind: "run",
		adapterId,
		tail: runTail,
		outputMode: inferOutputMode(gateway.rest),
		...(gateway.options.port === undefined
			? {}
			: { port: gateway.options.port }),
		repairChainHop: gateway.options.repairChainHop,
	};
}

/**
 * Parse a `repair-adapter` invocation (U5 R33/KTD22).
 *
 * Exactly one positional adapter id and exactly one of the mutually exclusive
 * `--check`/`--execute` modes. Every undeclared flag — including `--version`,
 * `--registry`, `--package`, `--pin`, `--lockfile`, `--path`, and `--recipe`
 * shapes — is rejected as an unknown option BEFORE any engine work: the
 * command accepts no package-policy override. A second positional operand is
 * rejected the same way (an override-shaped operand, e.g. a version).
 */
function parseRepairAdapterArgv(argv: readonly string[]): ParsedInvocation {
	if (argv.includes("--help") || argv.includes("-h")) {
		return { kind: "help", command: "repair-adapter" };
	}
	let check = false;
	let execute = false;
	const positionals: string[] = [];
	for (const arg of argv) {
		if (arg === "--check") {
			if (check) throw usageError("duplicate option: --check");
			check = true;
			continue;
		}
		if (arg === "--execute") {
			if (execute) throw usageError("duplicate option: --execute");
			execute = true;
			continue;
		}
		if (arg === "--json" || arg === "--plain") continue;
		if (arg.startsWith("-")) {
			if (isGlobalDiagnosticFlag(arg)) continue;
			// Fixed package-owned text (R24/R33): the rejected flag is never
			// echoed, so no caller-authored value reaches the usage envelope.
			throw usageError(
				"repair-adapter accepts no package-policy override or unknown option; only --check, --execute, --json, and --plain are accepted",
			);
		}
		positionals.push(arg);
	}
	const adapterId = positionals[0];
	if (adapterId === undefined) {
		throw usageError("repair-adapter requires an adapter id");
	}
	if (positionals.length > 1) {
		// A second operand is an override-shaped input (e.g. a version); fixed
		// text, never echoed (R24/R33).
		throw usageError(
			"repair-adapter accepts exactly one adapter operand and no extra arguments",
		);
	}
	if (check && execute) {
		throw usageError(
			"repair-adapter accepts exactly one of --check or --execute, not both",
		);
	}
	if (!check && !execute) {
		throw usageError("repair-adapter requires exactly one of --check or --execute");
	}
	return {
		kind: "repair-adapter",
		adapterId,
		mode: check ? "check" : "execute",
		outputMode: inferOutputMode(argv),
	};
}

/**
 * Parser-memory proof that a `run` head with no `--` still holds a non-empty
 * wrapped command: any positional beyond the adapter id (R12/AE6). Gateway
 * option values are consumed first so `--port 9333` can never count as a
 * wrapped word; a head that cannot be parsed proves nothing and the marker
 * stays false (fail closed, R9). Only the BOOLEAN leaves this function (R26).
 */
function headHoldsWrappedCommand(runHead: readonly string[]): boolean {
	let rest: readonly string[];
	try {
		rest = extractBrowserConnectGatewayOptions(runHead).rest;
	} catch {
		return false;
	}
	const positionals = rest.filter((arg) => !arg.startsWith("-"));
	return positionals.length > 1;
}

function firstPositional(argv: readonly string[]): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === undefined) continue;
		if (!arg.startsWith("-")) return arg;
	}
	return undefined;
}

function assertNoUnknownFlags(argv: readonly string[]): void {
	for (const arg of argv) {
		if (!arg.startsWith("-")) continue;
		if (arg === "--json" || arg === "--plain") continue;
		if (isGlobalDiagnosticFlag(arg)) continue;
		throw usageError(`unknown option: ${arg}`);
	}
}

function isGlobalDiagnosticFlag(arg: string): boolean {
	const name = arg.split("=")[0];
	return (BROWSER_CONNECT_GLOBAL_DIAGNOSTIC_FLAGS as readonly string[]).includes(
		name,
	);
}

function helpCommand(command: BrowserConnectCommand | undefined): {
	command?: BrowserConnectCommand;
} {
	return command === undefined ? {} : { command };
}

function findCommandArg(
	argv: readonly string[],
): BrowserConnectCommand | undefined {
	return argv.find(isBrowserConnectCommand);
}

function isBrowserConnectCommand(
	value: string | undefined,
): value is BrowserConnectCommand {
	return (
		value !== undefined &&
		(BROWSER_CONNECT_COMMANDS as readonly string[]).includes(value)
	);
}

function inferOutputMode(argv: readonly string[]): OutputMode {
	let outputMode: OutputMode = "json";
	for (const arg of argv) {
		if (arg === "--json") outputMode = "json";
		if (arg === "--plain") outputMode = "plain";
	}
	return outputMode;
}

function configureDiagnostics(
	diagnosticArgv: ParsedCliDiagnosticArgv,
	stderr: CliWriter,
): void {
	configureCliDiagnostics({
		categoryRoot: BROWSER_CONNECT_CLI_NAME,
		options: diagnosticArgv.options,
		diagnosticWriter: diagnosticArgv.options.quiet
			? quietDiagnosticWriter
			: stderr,
		redact: browserConnectDiagnosticRedactor,
	});
}

function renderHelp(command?: BrowserConnectCommand): string {
	if (command) return renderCommandUsage(browserConnectContracts[command]);
	const commandLines = browserConnectContractEntries.map(
		([name, contract]) => `  ${name.padEnd(15)} ${contract.summary}`,
	);
	return [
		`Usage: ${BROWSER_CONNECT_CLI_NAME} [command] [flags]`,
		"",
		"Commands:",
		"  (no command)  Read-only dashboard of registered adapters and route evidence.",
		...commandLines,
		"  help          Show help for all commands or one command.",
		"",
		"Global diagnostic flags:",
		"  --run-id <id>   Set run correlation id.",
		"  --quiet         Suppress diagnostics.",
		"  --verbose       Emit info diagnostics to stderr.",
		"  --debug         Emit debug diagnostics to stderr.",
		"  --version       Print version.",
		"",
	].join("\n");
}

/**
 * Default user-owned install root (R28 install scope): under $HOME only. An
 * empty result fails closed inside the executor (install_root_unavailable).
 */
function defaultAdapterInstallRoot(): string {
	const home = process.env.HOME;
	if (!home) return "";
	return `${home}/.side-quest/browser-connect/adapters`;
}

/**
 * Default production install engine (KTD16): real fs, `fs.mkdtemp` staging,
 * atomic `fs.rename` publish, a redirect-REFUSING fetch probe (`redirect:
 * "manual"` — a 3xx is reported, never followed), and the package no-shell
 * spawner. Tests never use this; they inject a recording engine.
 */
function createDefaultAdapterInstallEngine(): AdapterInstallEngine {
	return {
		env: process.env,
		fileExists: async (path) => {
			try {
				await fsPromises.access(path);
				return true;
			} catch {
				return false;
			}
		},
		readTextFile: async (path) => fsPromises.readFile(path, "utf8"),
		writeTextFile: async (path, contents) => {
			await fsPromises.writeFile(path, contents, "utf8");
		},
		makeDir: async (path) => {
			await fsPromises.mkdir(path, { recursive: true });
		},
		makeTempDir: async (prefix) => fsPromises.mkdtemp(prefix),
		removeDir: async (path) => {
			await fsPromises.rm(path, { recursive: true, force: true });
		},
		publishDir: async (fromPath, toPath) => {
			await fsPromises.rename(fromPath, toPath);
		},
		probeOrigin: async (url) => {
			const response = await fetch(url, {
				redirect: "manual",
				signal: AbortSignal.timeout(10_000),
			});
			// Drain nothing: status only. A 3xx is REPORTED so the executor stops;
			// the Location target is never requested (AE23).
			return { status: response.status };
		},
		runCommand: spawnAdapterCommand,
	};
}

/**
 * Resolve a registered adapter executable from the published versioned install
 * trees (R28) after a PATH miss: `repair-adapter --execute` publishes under
 * `defaultAdapterInstallRoot()` as `<root>/<id>/<pin>/node_modules/.bin/<bin>`.
 * Only a registered definition whose declared executable matches the command
 * can resolve here — never arbitrary caller input — and the root derivation is
 * read fresh per call (env/HOME), matching the executor's publish scope.
 */
function resolvePublishedAdapterExecutable(command: string): string | undefined {
	const installRoot = defaultAdapterInstallRoot();
	if (installRoot.length === 0) return undefined;
	for (const definition of defaultListAdapterDefinitions()) {
		if (definition.executable !== command) continue;
		const candidate = `${installRoot}/${definition.id}/${definition.pinnedVersion}/node_modules/.bin/${definition.installPolicy.expectedBin}`;
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

/**
 * Production adapter runtime: PATH resolution first (`Bun.which` keeps
 * precedence), then the published install-tree fallback, then an honest miss.
 * Without the fallback, the tree `repair-adapter --execute` publishes would be
 * unreachable in production (the repair chain could never close). Exported so
 * the repair-chain closure proof drives this REAL resolver against a published
 * tree instead of a hand-wired test resolver.
 */
export function createProductionAdapterRuntime(): AdapterRuntime {
	return {
		env: process.env,
		resolveExecutable: (command) => {
			const path = Bun.which(command);
			if (path) return { resolved: true, path };
			const published = resolvePublishedAdapterExecutable(command);
			return published === undefined
				? { resolved: false }
				: { resolved: true, path: published };
		},
		runCommand: spawnAdapterCommand,
	};
}

/**
 * Default production dependencies: the real warm-chrome `main`, the real
 * adapter runtime (PATH + published-tree resolution, no-shell spawn), and the
 * real registry.
 *
 * Exported for in-process embedding (browser-use's internal envelope mint,
 * design brief D4): the embedder passes these deps to `main` with captured
 * writers so the one production wiring lives here, never copied.
 */
export async function createProductionDeps(): Promise<BrowserConnectMainDeps> {
	const { main: warmChromeMain } = await import("@side-quest/warm-chrome/cli");
	return { warmChromeMain, adapterRuntime: createProductionAdapterRuntime() };
}

if (import.meta.main) {
	const deps = await createProductionDeps();
	const exitCode = await main(Bun.argv.slice(2), deps);
	process.exit(exitCode);
}
