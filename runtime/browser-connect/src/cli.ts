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
} from "./command-contract.ts";
import {
	type BrowserConnectDashboard,
	type DashboardDeps,
	projectBrowserConnectDashboard,
} from "./dashboard.ts";
import {
	proveAgentChromeEnvironment,
	type EnvironmentGatewayResult,
} from "./environment.ts";
import {
	type AdapterDefinition,
	type AdapterRuntime,
	findAdapterDefinition as defaultFindAdapterDefinition,
	listAdapterDefinitions as defaultListAdapterDefinitions,
	spawnAdapterCommand,
} from "./adapters/registry.ts";
import { selectCompatibleRoute } from "./compatibility.ts";
import {
	BROWSER_CONNECT_CLI_NAME,
	BROWSER_CONNECT_CONTRACT_ID,
	type BrowserConnectAuthorizedAttachment,
	type BrowserConnectEnvironmentIdentity,
	type BrowserConnectEnvelopeData,
	type BrowserConnectFailureActionId,
	type BrowserConnectFailureClass,
	type BrowserConnectLaunchProvenance,
	type BrowserConnectProofEvidence,
	type BrowserConnectRouteId,
	type BrowserConnectVerifiedEndpoint,
	BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS,
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

/**
 * The Agent Chrome environment identity slice one names (R10).
 */
const AGENT_CHROME_IDENTITY: BrowserConnectEnvironmentIdentity = {
	name: "agent-chrome",
};

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
	now: () => number;
};

type ParsedInvocation =
	| { kind: "help"; command?: BrowserConnectCommand }
	| { kind: "version" }
	| { kind: "dashboard"; outputMode: OutputMode }
	| { kind: "check"; outputMode: OutputMode }
	| { kind: "connect"; adapterId: string; outputMode: OutputMode };

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
		now: deps.now ?? (() => Date.now()),
	};

	let diagnosticArgv: ParsedCliDiagnosticArgv;
	try {
		diagnosticArgv = parseCliDiagnosticArgv(argv);
	} catch (error) {
		diagnosticArgv = parseCliDiagnosticFallbackArgv(argv);
		const outputMode = inferOutputMode(argv);
		configureDiagnostics(diagnosticArgv, resolved.stderr);
		try {
			return emitFailure(resolved, {
				outputMode,
				runId: diagnosticArgv.options.runId,
				durationMs:
					resolved.now() - diagnosticArgv.options.startedAtMs,
				failureClass: "usage-invalid",
				command: "check",
				message:
					error instanceof Error ? error.message : "invalid diagnostic flags",
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
				const parsed = parseArgv(diagnosticArgv.argv);
				if (parsed.kind === "help") {
					resolved.stdout.write(renderHelp(parsed.command));
					return 0;
				}
				if (parsed.kind === "version") {
					resolved.stdout.write(`${BROWSER_CONNECT_CLI_NAME} ${VERSION}\n`);
					return 0;
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
		return emitFailure(deps, {
			outputMode: parsed.outputMode,
			runId: ctx.runId,
			durationMs: durationMs(),
			failureClass: result.failure_class,
			command: "check",
			...(result.detail ? { message: result.detail } : {}),
		});
	}

	// connect
	emitCliDiagnostic(BROWSER_CONNECT_CLI_NAME, "info", "command-start", {
		command: "connect",
		phase: "start",
		adapter: parsed.adapterId,
	});
	const gate = await runConnectGate(parsed.adapterId, deps, ctx);
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
 */
export type ConnectGateFailed = {
	outcome: "failed";
	failure_class: BrowserConnectFailureClass;
	launch: BrowserConnectLaunchProvenance;
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
 * @returns A verified handoff or a typed failure
 */
export async function runConnectGate(
	adapterId: string,
	deps: ResolvedDeps,
	ctx: { runId: string; reconfigureDiagnostics: () => void },
): Promise<ConnectGateResult> {
	// Unknown adapter → usage-class rejection, never a probe (R7).
	const definition = deps.findAdapterDefinition(adapterId);
	if (!definition) {
		return {
			outcome: "failed",
			failure_class: "adapter-unknown",
			launch: { launched: false },
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
			...(deps.warmChromeRuntime
				? { warmChromeRuntime: deps.warmChromeRuntime }
				: {}),
		});
	if (environment.outcome === "failed") {
		return {
			outcome: "failed",
			failure_class: environment.failure_class,
			launch: environment.launch,
			...(environment.detail ? { detail: environment.detail } : {}),
		};
	}

	const launch = environment.launch;

	// Adapter installed + version-matched? (never a probe on a mismatch, R7)
	const provenance = await definition.checkProvenance(deps.adapterRuntime);
	if (!provenance.installed) {
		return {
			outcome: "failed",
			failure_class: provenance.failureClass,
			launch,
			detail: provenance.detail,
		};
	}

	// Route compatibility: does the environment share a route the adapter
	// declares? (pure check, R7)
	const route = selectCompatibleRoute(
		environment.environment.name,
		definition.routes.map((capability) => capability.route),
	);
	if (route === undefined) {
		return {
			outcome: "failed",
			failure_class: "route-incompatible",
			launch,
			detail: `no route shared by ${environment.environment.name} and ${definition.id}`,
		};
	}

	// The adapter runs its OWN attachment probe (R4). browser-connect never
	// probes on the adapter's behalf.
	const probe = await definition.probeAttachment(
		deps.adapterRuntime,
		environment.endpoint,
		route,
	);
	if (!probe.attached) {
		return {
			outcome: "failed",
			failure_class: probe.failureClass,
			launch,
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
// ---------------------------------------------------------------------------

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
	},
): number {
	const actionId: BrowserConnectFailureActionId =
		BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS[input.failureClass];
	const exitCode = FAILURE_CLASS_EXIT_CODE[input.failureClass];
	const branchId = FAILURE_CLASS_BRANCH_ID[input.failureClass];
	const safeMessage = input.message
		? input.failureClass === "usage-invalid"
			? sanitizeBrowserConnectUsageMessage(input.message)
			: redactBrowserConnectText(input.message)
		: defaultMessageFor(input.failureClass);

	const data = createBrowserConnectEnvelopeData({
		outcome: "failed",
		failure_class: input.failureClass,
		next_action_id: actionId,
		environment: AGENT_CHROME_IDENTITY,
		launch: input.launch ?? { launched: false },
		detail: safeMessage,
	});

	emitCliDiagnostic(BROWSER_CONNECT_CLI_NAME, "error", branchId, {
		code: branchId,
		exit_code: exitCode,
	});

	const action = failureActionById.get(actionId);
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
		next_action_id: actionId,
	};

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
			runtime_actions: runtimeActions,
			continuation,
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

/**
 * Map a caught error to a failure envelope. A facade usage error becomes the
 * usage-invalid station (exit 2); anything else is the runtime-error-unexpected
 * station (exit 1) with a fixed message — a raw error's text never reaches the
 * envelope (R14 leak surface).
 */
function emitCaughtError(
	deps: ResolvedDeps,
	input: {
		error: unknown;
		outputMode: OutputMode;
		runId: string;
		durationMs: number;
	},
): number {
	if (input.error instanceof CliUsageError) {
		return emitFailure(deps, {
			outputMode: input.outputMode,
			runId: input.runId,
			durationMs: input.durationMs,
			failureClass: "usage-invalid",
			command: "check",
			message: input.error.options.showMessage
				? input.error.message
				: "help requested",
		});
	}
	return emitFailure(deps, {
		outputMode: input.outputMode,
		runId: input.runId,
		durationMs: input.durationMs,
		failureClass: "runtime-error-unexpected",
		command: "check",
		message: "browser-connect hit an unexpected runtime failure.",
	});
}

// ---------------------------------------------------------------------------
// Argv parsing. Bare invocation → dashboard (R15). `check`/`connect` are the
// explicit subcommands this unit owns; `run` is reserved for U7 and rejected
// here with a not-yet-implemented usage error until U7 lands its parser.
// ---------------------------------------------------------------------------

function parseArgv(argv: readonly string[]): ParsedInvocation {
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
		assertNoUnknownFlags(rest);
		return { kind: "check", outputMode: inferOutputMode(rest) };
	}
	if (first === "connect") {
		const adapterId = firstPositional(rest);
		if (adapterId === undefined) {
			throw usageError("connect requires an adapter id");
		}
		assertNoUnknownFlags(rest);
		return { kind: "connect", adapterId, outputMode: inferOutputMode(rest) };
	}
	// first === "run": owned by U7.
	throw usageError(
		"run is not implemented in this build; use connect for the machine surface",
	);
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
		([name, contract]) => `  ${name.padEnd(10)} ${contract.summary}`,
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
 * Default production dependencies: the real warm-chrome `main`, the real
 * adapter runtime (PATH resolution + no-shell spawn), and the real registry.
 */
async function createProductionDeps(): Promise<BrowserConnectMainDeps> {
	const { main: warmChromeMain } = await import("@side-quest/warm-chrome/cli");
	const adapterRuntime: AdapterRuntime = {
		env: process.env,
		resolveExecutable: (command) => {
			const path = Bun.which(command);
			return path ? { resolved: true, path } : { resolved: false };
		},
		runCommand: spawnAdapterCommand,
	};
	return { warmChromeMain, adapterRuntime };
}

if (import.meta.main) {
	const deps = await createProductionDeps();
	const exitCode = await main(Bun.argv.slice(2), deps);
	process.exit(exitCode);
}
