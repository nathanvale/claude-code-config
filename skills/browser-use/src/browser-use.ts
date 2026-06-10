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

import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
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
	BROWSER_USE_OPERATION_CONTRACT_ID,
	BROWSER_USE_OPERATION_SCHEMA_VERSION,
	BROWSER_USE_FAMILIES,
	BROWSER_USE_OPERATE_SUBCOMMANDS,
	BROWSER_USE_TARGETS_SUBCOMMANDS,
	type BrowserUseCommand,
	type BrowserUseFamily,
	type BrowserUseOperateSubcommand,
	type BrowserUseTargetsSubcommand,
	browserUseContracts,
	browserUseOperationFailureActions,
	browserUseOperationSuccessActions,
} from "./command-contract";
import type {
	BrowserAdapterId,
	BrowserOperationClass,
	BrowserTargetCandidate,
	RouteBinding,
} from "./browser-adapter-router-model";
import { authorizesOperationClass } from "./browser-adapter-router-engine";
import {
	emitWithDiagnostics,
	quietDiagnosticWriter,
} from "./cli-diagnostics-bootstrap";
import type { McporterCommandResult } from "./mcporter-transport";
import {
	type BrowserOperationTransportFailure,
	type BrowserOperationTransportResult,
	runBrowserUseMcporter,
} from "./browser-use-transport";
import {
	type Failure,
	type OutputMode,
	type RawPage,
	type ResultKind,
	BINDING_FAIL_CLOSED_EXIT_CODE,
	NOT_IMPLEMENTED_EXIT_CODE,
	RUNTIME_FAILURE_EXIT_CODE,
	USAGE_EXIT_CODE,
	actionFor,
	isJsonObject,
	parseUrlSafe,
	redactUnsafeText,
	sanitizeUsageValue,
	stringField,
	targetEnvelopeIdOf,
	toCandidate,
} from "./browser-use-core";
import {
	type BrowserUseRuntime,
	createDefaultBrowserUseRuntime,
} from "./browser-use-runtime";
import {
	type AdapterProofFacts,
	type RouteFacts,
	type TargetDiscoveryFailure,
	discoverPages,
	readAdapterProofFacts,
	readRouteFacts,
	runTargetsList,
} from "./browser-use-discovery";
import {
	type OperationResolution,
	type OperationTargetHints,
	type SelectedTargetState,
	type SelectionFailure,
	loadSelectedState,
	resolveOperationTarget,
	resolveStatePath,
	runScopedKey,
	runTargetsSelect,
	runTargetsStatus,
} from "./browser-use-selection";

const VERSION = "0.1.0";
// One-line pointer the help surface uses to send agents back to the
// route-bound prerequisites without copying route evidence schemas (R17, U3
// scenario 8). browser-use never re-declares the route envelope shape.
const ROUTE_PREREQUISITE_POINTER =
	"Prerequisite: get route evidence from `browser-adapter-router prepare` then `browser-adapter-router route` (--route).";

// ---------------------------------------------------------------------------
// CLI driver. Mirrors browser-adapter-router.ts structure.
// ---------------------------------------------------------------------------

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


// --- Small shared field helpers --------------------------------------------

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
	// Temporary barrel export so the region modules (discovery/selection/
	// operations) can type-only import this until it relocates to the parser
	// module at U7 (KTD2). Type-only consumers erase at runtime: no cycle.
	type ParsedBrowserUseCommand,
};
export {
	type BrowserOperationTransportFailure,
	type BrowserOperationTransportResult,
	runBrowserUseMcporter,
} from "./browser-use-transport";
export {
	type BrowserUseRuntime,
	createDefaultBrowserUseRuntime,
	decodeStdinChunks,
} from "./browser-use-runtime";
export {
	type OperationResolutionInput,
	resolveOperationTarget,
} from "./browser-use-selection";

if (import.meta.main) {
	const exitCode = await runBrowserUseCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
