#!/usr/bin/env bun

// Browser Adapter Router (plan 2026-06-02-004).
//
// Evidence-first router. Requests enter `browser-use`; the Router asks for
// supplied evidence and ranks only proven candidates. It does NOT probe
// adapters, run Browser Adapter Proof, or invoke self-report commands during
// `route` — it consumes a caller-assembled evidence envelope (KTD1e, KTD1f,
// KTD1g). Missing/stale/partial/docs-only evidence becomes structured recovery,
// never inference (KTD1).
//
// Command surfaces:
//   route   — select an adapter from a supplied envelope (pure evaluation).
//   report  — discover/validate one capability report (manifest or self-report).
//   status  — human projection of a supplied envelope (same pure evaluator).

import { readFile } from "node:fs/promises";
import {
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	type StructuredRuntimeError,
	CliUsageError,
	configureCliDiagnostics,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	resetCliDiagnostics,
	usageError,
	withCliDiagnosticContext,
	createCliDiagnosticContext,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_ADAPTER_ROUTER_ADAPTERS,
	BROWSER_ADAPTER_ROUTER_BUNDLES,
	BROWSER_ADAPTER_ROUTER_MODES,
	type BrowserAdapterRouterBundle,
	type BrowserAdapterRouterCommand,
	type BrowserAdapterRouterMode,
	browserAdapterRouterContracts,
} from "./command-contract";
import type {
	AdapterCapability,
	BrowserAdapterId,
	RouteFailure,
	RouteFailureData,
	RouteSuccess,
} from "./browser-adapter-router-model";
import {
	type PrepareFailure,
	type PrepareInputs,
	type PrepareSuccess,
	assemblePrepare,
	canonicalMissingFact,
} from "./browser-adapter-router-prepare";
import {
	evaluateRoute,
	isReportStale,
	resolveRequiredCapabilities,
} from "./browser-adapter-router-engine";
import {
	type ReportDiscovery,
	discoverReport,
} from "./browser-adapter-router-discovery";
import {
	isBrowserAdapter,
	isCapability,
	validateCapabilityReport,
} from "./browser-adapter-router-report-validation";
import {
	type ValidatedRouteEvidenceEnvelope,
	RouteEvidenceError,
	parseRouteEvidenceEnvelope,
	validateRouteEvidenceEnvelope,
} from "./browser-adapter-router-validation";
import {
	continuationForCode,
	prepareContinuationForCode,
	prepareRecoverabilityForCode,
	recoverabilityForCode,
	researchRecoveryDiagnosticTrail,
	routeValidityConstraint,
	runtimeActionForId,
	validateRouterContinuationEnvelope,
	validateRouterErrorEnvelope,
} from "./browser-adapter-router-recovery";

const VERSION = "0.1.0";
const ROUTE_FAIL_CLOSED_EXIT_CODE = 20;
const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;

const quietDiagnosticWriter: CliWriter = { write: () => true };

export {
	continuationForCode,
	discoverReport,
	evaluateRoute,
	isBrowserAdapter,
	isReportStale,
	isCapability,
	recoverabilityForCode,
	resolveRequiredCapabilities,
	routeValidityConstraint,
	runtimeActionForId,
	researchRecoveryDiagnosticTrail,
	validateRouterContinuationEnvelope,
	validateRouterErrorEnvelope,
	validateCapabilityReport,
	validateRouteEvidenceEnvelope,
};
// Legacy alias for existing callers; route validation lives in
// browser-adapter-router-validation.ts.
export const parseEvidenceEnvelope = parseRouteEvidenceEnvelope;
export type * from "./browser-adapter-router-model";
export type { ReportDiscovery } from "./browser-adapter-router-discovery";
export type { ReportValidationResult } from "./browser-adapter-router-report-validation";
export type {
	RouteValidationResult,
	ValidatedRouteEvidenceEnvelope,
} from "./browser-adapter-router-validation";

// Today's date as YYYY-MM-DD (UTC). The runtime default evaluation date; tests
// pin a fixed date via the runtime override so this is never called under test.
function todayIsoDate(): string {
	return new Date().toISOString().slice(0, 10);
}

export type RouterRuntime = {
	env: Record<string, string | undefined>;
	now: () => number;
	cwd: string;
	readTextFile: (path: string) => Promise<string>;
	readStdin: () => Promise<string>;
	evaluationDate: string;
};

export function createDefaultRouterRuntime(
	overrides: Partial<RouterRuntime> = {},
): RouterRuntime {
	return {
		// `now` mirrors the facade diagnostic clock (Date.now epoch ms) so
		// duration_ms = now() - startedAtMs is a sane elapsed value.
		env: { ...process.env },
		now: () => Date.now(),
		cwd: process.cwd(),
		readTextFile: (path: string) => readFile(path, "utf-8"),
		readStdin: () => readAllStdin(),
		// Freshness evaluates against today's date by default. Tests and CI pin a
		// fixed date via BROWSER_USE_ROUTER_EVAL_DATE for determinism; a frozen
		// literal default here would silently stale every manifest once its
		// window elapsed.
		evaluationDate:
			process.env.BROWSER_USE_ROUTER_EVAL_DATE ?? todayIsoDate(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// CLI driver (U0). Mirrors preflight-browser-adapter.ts structure.
// ---------------------------------------------------------------------------

type OutputMode = "json" | "plain";

type ParsedRouterCommand =
	| { kind: "help"; command?: BrowserAdapterRouterCommand }
	| { kind: "version"; outputMode: OutputMode }
	| {
			kind: "prepare";
			outputMode: OutputMode;
			warmChromeProofPath?: string;
			adapterProofPath?: string;
			reportPaths: string[];
			targetDiscoveryPath?: string;
			mode?: BrowserAdapterRouterMode;
			adapter?: BrowserAdapterId;
			fallbackAllowed?: boolean;
			bundle?: BrowserAdapterRouterBundle;
			capabilities: AdapterCapability[];
			targetOrigin?: string;
	  }
	| {
			kind: "route";
			outputMode: OutputMode;
			envelopePath?: string;
	  }
	| {
			kind: "report";
			outputMode: OutputMode;
			adapter: BrowserAdapterId;
			capability?: AdapterCapability;
	  };

export async function runBrowserAdapterRouterCli(
	argv: readonly string[],
	options: {
		runtime?: RouterRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultRouterRuntime();
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const diagnosticInput = applyEnvRunId(argv, runtime.env.BROWSER_USE_RUN_ID);
	let diagnosticArgv: ParsedCliDiagnosticArgv;

	try {
		diagnosticArgv = parseCliDiagnosticArgv(diagnosticInput);
	} catch (error) {
		diagnosticArgv = parseCliDiagnosticFallbackArgv(diagnosticInput);
		const outputMode = inferCommandOutputMode(argv, findCommand(argv));
		configureCliDiagnostics({
			categoryRoot: "browser-use.adapter-router",
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

	const outputMode = inferCommandOutputMode(
		diagnosticArgv.argv,
		findCommand(diagnosticArgv.argv),
	);
	let parsed: ParsedRouterCommand;
	try {
		parsed = parseRouterArgv(diagnosticArgv.argv);
	} catch (error) {
		configureCliDiagnostics({
			categoryRoot: "browser-use.adapter-router",
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
		stdout.write(renderHelp(parsed.command));
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
		categoryRoot: "browser-use.adapter-router",
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
			if (parsed.kind === "prepare") {
				return executePrepare({
					parsed,
					runtime,
					stdout,
					stderr,
					runId,
					durationMs,
				});
			}
			if (parsed.kind === "report") {
				return executeReport({
					parsed,
					runtime,
					stdout,
					stderr,
					runId,
					durationMs,
				});
			}
			return executeRoute({
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

async function executePrepare(input: {
	parsed: Extract<ParsedRouterCommand, { kind: "prepare" }>;
	runtime: RouterRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: () => number;
}): Promise<number> {
	const { parsed, runtime } = input;
	// prepare does the file I/O; the assembler stays pure (R7, testability). An
	// unreadable input path is caller input, not a runtime fault: it becomes a
	// change_prepare_input fact, never a generic runtime error. The path is never
	// echoed into diagnostics.
	let warmChromeProofRaw: string | undefined;
	let adapterProofRaw: string | undefined;
	let targetDiscoveryRaw: string | undefined;
	const reportRaws: string[] = [];
	const readErrors: string[] = [];

	if (parsed.warmChromeProofPath) {
		const read = await readOptionalFile(parsed.warmChromeProofPath, runtime);
		if (read.ok) warmChromeProofRaw = read.content;
		else readErrors.push("warm Chrome proof file could not be read");
	}
	if (parsed.adapterProofPath) {
		const read = await readOptionalFile(parsed.adapterProofPath, runtime);
		if (read.ok) adapterProofRaw = read.content;
		else readErrors.push("adapter proof file could not be read");
	}
	if (parsed.targetDiscoveryPath) {
		const read = await readOptionalFile(parsed.targetDiscoveryPath, runtime);
		if (read.ok) targetDiscoveryRaw = read.content;
		else readErrors.push("target discovery file could not be read");
	}
	for (const [index, reportPath] of parsed.reportPaths.entries()) {
		const read = await readOptionalFile(reportPath, runtime);
		if (read.ok) reportRaws.push(read.content);
		else readErrors.push(`report[${index}] file could not be read`);
	}

	const inputs: PrepareInputs = {
		warmChromeProofRaw,
		adapterProofRaw,
		reportRaws,
		targetDiscoveryRaw,
		mode: parsed.mode,
		adapter: parsed.adapter,
		fallbackAllowed: parsed.fallbackAllowed,
		bundle: parsed.bundle,
		capabilities: parsed.capabilities,
		targetOrigin: parsed.targetOrigin,
		fallbackRunId:
			runtime.env.BROWSER_USE_ROUTER_PREPARE_RUN_ID ??
			runtime.env.BROWSER_USE_RUN_ID,
		evaluationDate: runtime.evaluationDate,
	};

	const result = assemblePrepare(inputs);
	// Read failures are prepare input faults: fold them into the missing-fact set
	// so they resolve to change_prepare_input alongside any assembler findings.
	if (readErrors.length > 0) {
		const merged: PrepareFailure = {
			ok: false,
			missing_facts: [
				...(result.ok ? [] : result.missing_facts),
				...readErrors.map((detail) => ({
					kind: "prepare_input" as const,
					code: "prepare_input_invalid" as const,
					detail,
				})),
			],
		};
		return emitPrepareFailure({
			failure: merged,
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});
	}

	if (result.ok) {
		writePrepareSuccess(input.stdout, result, parsed.outputMode, {
			runId: input.runId,
			durationMs: input.durationMs(),
		});
		return 0;
	}
	return emitPrepareFailure({
		failure: result,
		outputMode: parsed.outputMode,
		stdout: input.stdout,
		stderr: input.stderr,
		runId: input.runId,
		durationMs: input.durationMs(),
	});
}

async function readOptionalFile(
	path: string,
	runtime: RouterRuntime,
): Promise<{ ok: true; content: string } | { ok: false }> {
	try {
		return { ok: true, content: await runtime.readTextFile(path) };
	} catch {
		return { ok: false };
	}
}

async function executeRoute(input: {
	parsed: Extract<ParsedRouterCommand, { kind: "route" }>;
	runtime: RouterRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: () => number;
}): Promise<number> {
	let raw: string;
	try {
		raw = await readEnvelopeSource(input.parsed.envelopePath, input.runtime);
	} catch (error) {
		return emitRouteEvidenceError({
			error,
			outputMode: input.parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});
	}

	let envelope: ValidatedRouteEvidenceEnvelope;
	try {
		envelope = parseEvidenceEnvelope(raw);
	} catch (error) {
		return emitRouteEvidenceError({
			error,
			outputMode: input.parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			durationMs: input.durationMs(),
		});
	}

	const evaluation = evaluateRoute(envelope, input.runtime.evaluationDate);
	if (evaluation.outcome === "selected") {
		writeRouteSuccess(
			input.stdout,
			evaluation,
			input.parsed.outputMode,
			{ runId: input.runId, durationMs: input.durationMs() },
		);
		return 0;
	}
	return emitRouteFailure({
		failure: evaluation,
		outputMode: input.parsed.outputMode,
		stdout: input.stdout,
		stderr: input.stderr,
		runId: input.runId,
		durationMs: input.durationMs(),
	});
}

async function executeReport(input: {
	parsed: Extract<ParsedRouterCommand, { kind: "report" }>;
	runtime: RouterRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: () => number;
}): Promise<number> {
	// V1 has no registry-declared executable self-report command vector. The
	// env override carries a caller-supplied self-report JSON for the validated
	// self-report path; otherwise discovery falls back to the manifest.
	const selfReportRaw = input.runtime.env.BROWSER_USE_ROUTER_SELF_REPORT_JSON;
	let selfReport: unknown;
	if (selfReportRaw) {
		try {
			selfReport = JSON.parse(selfReportRaw);
		} catch {
			return emitCliError({
				error: usageError(
					"BROWSER_USE_ROUTER_SELF_REPORT_JSON is not valid JSON.",
				),
				outputMode: input.parsed.outputMode,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				durationMs: input.durationMs(),
			});
		}
	}

	const discovery = discoverReport(
		input.parsed.adapter,
		input.runtime.evaluationDate,
		selfReport,
	);
	if (discovery.found) {
		if (
			input.parsed.capability &&
			!discovery.report.capabilities.some(
				(entry) => entry.capability === input.parsed.capability,
			)
		) {
			return emitReportFailure({
				adapter: input.parsed.adapter,
				discovery: {
					found: false,
					code: "adapter_capability_unknown",
					diagnostics: [
						`No current report for requested capability ${input.parsed.capability}.`,
					],
				},
				outputMode: input.parsed.outputMode,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				durationMs: input.durationMs(),
			});
		}
		writeReportSuccess(
			input.stdout,
			input.parsed,
			discovery,
			input.parsed.outputMode,
			{ runId: input.runId, durationMs: input.durationMs() },
		);
		return 0;
	}
	return emitReportFailure({
		adapter: input.parsed.adapter,
		discovery,
		outputMode: input.parsed.outputMode,
		stdout: input.stdout,
		stderr: input.stderr,
		runId: input.runId,
		durationMs: input.durationMs(),
	});
}

async function readEnvelopeSource(
	envelopePath: string | undefined,
	runtime: RouterRuntime,
): Promise<string> {
	if (envelopePath) {
		try {
			return await runtime.readTextFile(envelopePath);
		} catch {
			// A missing/unreadable envelope file is caller input, not a runtime
			// fault: fail closed with route_evidence_invalid (exit 20) rather than
			// the generic runtime error (exit 1). The path is omitted from the
			// message so it is not echoed into stderr/logs.
			throw new RouteEvidenceError(
				"route_evidence_invalid",
				"Evidence envelope file could not be read.",
			);
		}
	}
	const inline = runtime.env.BROWSER_USE_ROUTER_ENVELOPE_JSON;
	if (inline) return inline;
	return runtime.readStdin();
}

// ---------------------------------------------------------------------------
// Output writers.
// ---------------------------------------------------------------------------

function writeRouteSuccess(
	stdout: CliWriter,
	success: RouteSuccess,
	outputMode: OutputMode,
	runtime: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		stdout.write(
			[
				"adapter_selected",
				`mode=${success.mode}`,
				`requested=${success.requested_adapter ?? "none"}`,
				`selected=${success.selected_adapter}`,
				`confidence=${success.route_confidence}`,
				`capabilities=${success.required_capabilities.join(",") || "none"}`,
				"action=use_selected_browser_adapter",
				`run_id=${runtime.runId}`,
				`duration_ms=${runtime.durationMs}`,
			].join(" ") + "\n",
		);
		return;
	}
	const envelope = createCliRuntimeSuccessEnvelope({
			run_id: runtime.runId,
			data: success,
			runtime_actions: [runtimeActionForId("use_selected_browser_adapter")],
			continuation: {
				next_action_id: "use_selected_browser_adapter",
				constraints: [routeValidityConstraint()],
			},
		});
	const issues = validateRouterContinuationEnvelope(envelope, {
		requireRouteValidity: true,
	});
	if (issues.length > 0) {
		throw new Error(
			`Invalid Browser Adapter Router continuation envelope: ${issues.join("; ")}`,
		);
	}
	writeJsonEnvelope(stdout, envelope, runtime);
}

function writePrepareSuccess(
	stdout: CliWriter,
	success: PrepareSuccess,
	outputMode: OutputMode,
	runtime: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		stdout.write(
			[
				"route_evidence_prepared",
				`mode=${success.route_input_mode}`,
				`reports=${success.envelope.reports.length}`,
				`next=${success.next_command_intent}`,
				"action=route_prepared_evidence",
				`run_id=${runtime.runId}`,
				`duration_ms=${runtime.durationMs}`,
			].join(" ") + "\n",
		);
		return;
	}
	const envelope = createCliRuntimeSuccessEnvelope({
		run_id: runtime.runId,
		data: {
			envelope: success.envelope,
			route_input_mode: success.route_input_mode,
			next_command_intent: success.next_command_intent,
		},
		runtime_actions: [runtimeActionForId("route_prepared_evidence")],
		continuation: { next_action_id: "route_prepared_evidence" },
	});
	const issues = validateRouterContinuationEnvelope(envelope);
	if (issues.length > 0) {
		throw new Error(
			`Invalid Browser Adapter Router prepare envelope: ${issues.join("; ")}`,
		);
	}
	writeJsonEnvelope(stdout, envelope, runtime);
}

function emitPrepareFailure(input: {
	failure: PrepareFailure;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const canonical = canonicalMissingFact(input.failure.missing_facts);
	// canonical is always defined here: emitPrepareFailure is only called with a
	// non-empty missing-fact set.
	const code = canonical?.code ?? "prepare_input_invalid";
	const nextAction = prepareContinuationForCode(code);
	const message =
		canonical?.detail ?? "prepare could not assemble route evidence.";
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_adapter_router ${code}: ${message} action=${nextAction} (run_id=${input.runId})\n`,
		);
		return ROUTE_FAIL_CLOSED_EXIT_CODE;
	}
	// runtime_actions lists every relevant recovery action across the missing
	// facts; the canonical continuation follows dependency order (R6).
	const actionIds = [
		nextAction,
		...input.failure.missing_facts
			.map((fact) => prepareContinuationForCode(fact.code))
			.filter((id) => id !== nextAction),
	];
	const seen = new Set<string>();
	const runtimeActions = actionIds
		.filter((id) => {
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		})
		.map((id) => runtimeActionForId(id));
	const envelope = createCliRuntimeErrorEnvelope({
		run_id: input.runId,
		process_exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
		data: {
			failure_kind: "prepare_failure",
			missing_facts: input.failure.missing_facts,
		},
		error: {
			run_id: input.runId,
			code,
			message,
			exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
			severity: "error",
			recoverability: prepareRecoverabilityForCode(code),
			retryable: false,
			failure_domain: "browser_adapter_router",
		},
		runtime_actions: runtimeActions,
		continuation: { next_action_id: nextAction },
	});
	const issues = validateRouterErrorEnvelope(envelope);
	if (issues.length > 0) {
		throw new Error(
			`Invalid Browser Adapter Router prepare error envelope: ${issues.join("; ")}`,
		);
	}
	writeJsonEnvelope(input.stdout, envelope, {
		runId: input.runId,
		durationMs: input.durationMs,
	});
	return ROUTE_FAIL_CLOSED_EXIT_CODE;
}

function writeReportSuccess(
	stdout: CliWriter,
	parsed: Extract<ParsedRouterCommand, { kind: "report" }>,
	discovery: Extract<ReportDiscovery, { found: true }>,
	outputMode: OutputMode,
	runtime: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		stdout.write(
			[
				"report_found",
				`adapter=${parsed.adapter}`,
				`source=${discovery.source}`,
				`attachment=${discovery.report.attachment_model}`,
				`checked_at=${discovery.report.provenance.checked_at}`,
				`run_id=${runtime.runId}`,
				`duration_ms=${runtime.durationMs}`,
			].join(" ") + "\n",
		);
		return;
	}
	const capability = parsed.capability;
	const data = capability
		? {
				adapter_id: parsed.adapter,
				report_source: discovery.source,
				capability: discovery.report.capabilities.find(
					(entry) => entry.capability === capability,
				),
				provenance: discovery.report.provenance,
			}
		: {
				adapter_id: parsed.adapter,
				report_source: discovery.source,
				report: discovery.report,
			};
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({ run_id: runtime.runId, data }),
		runtime,
	);
}

function writeVersion(
	stdout: CliWriter,
	outputMode: OutputMode,
	runtime: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		stdout.write(`browser-adapter-router ${VERSION}\n`);
		return;
	}
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: runtime.runId,
			data: {
				name: "browser-adapter-router",
				version: VERSION,
			},
		}),
		runtime,
	);
}

function emitRouteFailure(input: {
	failure: RouteFailure;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const { failure } = input;
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_adapter_router ${failure.code}: ${failure.message} action=${failure.next_action_id} (run_id=${input.runId})\n`,
		);
		return ROUTE_FAIL_CLOSED_EXIT_CODE;
	}
	const error: StructuredRuntimeError = {
		run_id: input.runId,
		code: failure.code,
		message: failure.message,
		exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
		severity: "error",
		recoverability: recoverabilityForCode(failure.code),
		retryable: false,
		failure_domain: "browser_adapter_router",
	};
	const envelope = createCliRuntimeErrorEnvelope({
		run_id: input.runId,
		data: routeFailureData(failure),
		process_exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
		error,
		runtime_actions: [runtimeActionForId(failure.next_action_id)],
		continuation: {
			next_action_id: failure.next_action_id,
			constraints: [routeValidityConstraint()],
		},
		...(failure.next_action_id === "research_adapter_capability"
			? { diagnostic_trail: researchRecoveryDiagnosticTrail(input.runId) }
			: {}),
	});
	const issues = validateRouterErrorEnvelope(envelope, {
		requireRouteValidity: true,
	});
	if (issues.length > 0) {
		throw new Error(
			`Invalid Browser Adapter Router error envelope: ${issues.join("; ")}`,
		);
	}
	writeJsonEnvelope(input.stdout, envelope, {
		runId: input.runId,
		durationMs: input.durationMs,
	});
	return ROUTE_FAIL_CLOSED_EXIT_CODE;
}

function routeFailureData(failure: RouteFailure): RouteFailureData {
	return {
		failure_kind: "route_failure",
		evaluation_date: failure.evaluation_date,
		required_capabilities: failure.required_capabilities,
		routing_started: failure.candidate_decisions.length > 0,
		candidate_decisions: failure.candidate_decisions,
		informational_alternatives: failure.informational_alternatives,
		...(failure.research
			? {
					research: {
						adapter_id: failure.research.adapter_id,
						capability: failure.research.capability,
						diagnostic_trail_id:
							"browser-adapter-router.research_adapter_capability",
					},
				}
			: {}),
	};
}

function emitReportFailure(input: {
	adapter: BrowserAdapterId;
	discovery: Extract<ReportDiscovery, { found: false }>;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const code = input.discovery.code;
	const message = input.discovery.diagnostics.join("; ");
	if (input.outputMode === "plain") {
		input.stderr.write(
			`browser_adapter_router ${code}: ${message} (run_id=${input.runId})\n`,
		);
		return ROUTE_FAIL_CLOSED_EXIT_CODE;
	}
	// Share the route path's per-code continuation mapping; report failures
	// (unknown or stale) both resolve to research_adapter_capability there.
	const nextAction = continuationForCode(code);
	const envelope = createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
			error: {
				run_id: input.runId,
				code,
				message,
				exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
				severity: "error",
				recoverability: recoverabilityForCode(code),
				retryable: false,
				failure_domain: "browser_adapter_router",
			},
			runtime_actions: [runtimeActionForId(nextAction)],
			continuation: { next_action_id: nextAction },
			...(nextAction === "research_adapter_capability"
				? { diagnostic_trail: researchRecoveryDiagnosticTrail(input.runId) }
				: {}),
		});
	const issues = validateRouterErrorEnvelope(envelope);
	if (issues.length > 0) {
		throw new Error(
			`Invalid Browser Adapter Router error envelope: ${issues.join("; ")}`,
		);
	}
	writeJsonEnvelope(input.stdout, envelope, {
		runId: input.runId,
		durationMs: input.durationMs,
	});
	return ROUTE_FAIL_CLOSED_EXIT_CODE;
}

function emitRouteEvidenceError(input: {
	error: unknown;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	if (input.error instanceof RouteEvidenceError) {
		const code = input.error.code;
		if (input.outputMode === "plain") {
			input.stderr.write(
				`browser_adapter_router ${code}: ${input.error.message} (run_id=${input.runId})\n`,
			);
			return ROUTE_FAIL_CLOSED_EXIT_CODE;
		}
		const nextAction = continuationForCode(code);
		const envelope = createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
			error: {
				run_id: input.runId,
				code,
				message: input.error.message,
				exit_code: ROUTE_FAIL_CLOSED_EXIT_CODE,
				severity: "error",
				recoverability: recoverabilityForCode(code),
				retryable: false,
				failure_domain: "browser_adapter_router",
			},
			runtime_actions: [runtimeActionForId(nextAction)],
			continuation: {
				next_action_id: nextAction,
			},
		});
		const issues = validateRouterErrorEnvelope(envelope);
		if (issues.length > 0) {
			throw new Error(
				`Invalid Browser Adapter Router error envelope: ${issues.join("; ")}`,
			);
		}
		writeJsonEnvelope(input.stdout, envelope, {
			runId: input.runId,
			durationMs: input.durationMs,
		});
		return ROUTE_FAIL_CLOSED_EXIT_CODE;
	}
	return emitCliError({
		error: input.error,
		outputMode: input.outputMode,
		stdout: input.stdout,
		stderr: input.stderr,
		runId: input.runId,
		durationMs: input.durationMs,
	});
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
			`browser_adapter_router ${isUsage ? "usage_error" : "runtime_error"}: ${safeMessage} (run_id=${input.runId})\n`,
		);
		return exitCode;
	}
	const envelope = createCliRuntimeErrorEnvelope({
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
			// A usage error is caller-correctable (change input); a fatal runtime
			// error needs an operator. Either way the envelope carries an explicit
			// continuation rather than leaving the agent to guess.
			...(isUsage
				? {
						runtime_actions: [runtimeActionForId("change_route_input")],
						continuation: { next_action_id: "change_route_input" },
					}
				: { continuation: { requires_operator: true } }),
		});
	if (isUsage) {
		const issues = validateRouterErrorEnvelope(envelope);
		if (issues.length > 0) {
			throw new Error(
				`Invalid Browser Adapter Router error envelope: ${issues.join("; ")}`,
			);
		}
	}
	writeJsonEnvelope(input.stdout, envelope, {
		runId: input.runId,
		durationMs: input.durationMs,
	});
	return exitCode;
}

// ---------------------------------------------------------------------------
// Argv parsing.
// ---------------------------------------------------------------------------

function parseRouterArgv(argv: readonly string[]): ParsedRouterCommand {
	if (argv.includes("--version")) {
		return {
			kind: "version",
			outputMode: argv.includes("--json") ? "json" : "plain",
		};
	}
	const command = findCommand(argv);
	if (argv.includes("-h") || argv.includes("--help")) {
		return { kind: "help", command };
	}
	if (!command) {
		throw usageError(
			"missing command: expected prepare, route, report, or status.",
		);
	}
	const outputMode = inferCommandOutputMode(argv, command);
	const rest = argv.filter((arg) => arg !== command);

	if (command === "prepare") {
		const mode = readEnumFlag(rest, "--mode", isMode);
		const adapter = readEnumFlag(rest, "--adapter", isPrepareAdapter);
		const bundle = readEnumFlag(rest, "--bundle", isBundle);
		const capabilities = readRepeatedEnumFlag(
			rest,
			"--capability",
			isCapability,
		);
		const reportPaths = readRepeatedArgFlagValue(rest, "--report");
		const targetOrigin = readArgFlagValue(rest, "--target-origin");
		const fallbackAllowed = rest.includes("--fallback-allowed")
			? true
			: undefined;
		rejectUnknownFlags(rest, [
			"--warm-chrome-proof",
			"--adapter-proof",
			"--report",
			"--target-discovery",
			"--mode",
			"--adapter",
			"--fallback-allowed",
			"--bundle",
			"--capability",
			"--target-origin",
			"--json",
			"--plain",
		]);
		return {
			kind: "prepare",
			outputMode,
			warmChromeProofPath: readArgFlagValue(rest, "--warm-chrome-proof"),
			adapterProofPath: readArgFlagValue(rest, "--adapter-proof"),
			reportPaths,
			targetDiscoveryPath: readArgFlagValue(rest, "--target-discovery"),
			mode,
			adapter,
			fallbackAllowed,
			bundle,
			capabilities,
			targetOrigin,
		};
	}

	if (command === "report") {
		const adapter = readEnumFlag(rest, "--adapter", isBrowserAdapter);
		if (!adapter) {
			throw usageError("report requires --adapter <id>.");
		}
		const capability = readEnumFlag(rest, "--capability", isCapability);
		rejectUnknownFlags(rest, [
			"--adapter",
			"--capability",
			"--json",
			"--plain",
		]);
		return { kind: "report", outputMode, adapter, capability };
	}

	const envelopePath = readArgFlagValue(rest, "--envelope");
	rejectUnknownFlags(rest, ["--envelope", "--json", "--plain"]);
	return {
		kind: "route",
		outputMode,
		envelopePath,
	};
}

function findCommand(
	argv: readonly string[],
): BrowserAdapterRouterCommand | undefined {
	return argv.find(isRouterCommand);
}

function isRouterCommand(
	value: string | undefined,
): value is BrowserAdapterRouterCommand {
	return (
		value === "prepare" ||
		value === "route" ||
		value === "report" ||
		value === "status"
	);
}

function readEnumFlag<T extends string>(
	argv: readonly string[],
	flag: string,
	guard: (value: unknown) => value is T,
): T | undefined {
	const value = readArgFlagValue(argv, flag);
	if (value === undefined) return undefined;
	if (!guard(value)) {
		throw usageError(`invalid value for ${flag}: ${sanitizeUsageValue(value)}`);
	}
	return value;
}

function isMode(value: unknown): value is BrowserAdapterRouterMode {
	return (
		typeof value === "string" &&
		(BROWSER_ADAPTER_ROUTER_MODES as readonly string[]).includes(value)
	);
}

function isPrepareAdapter(value: unknown): value is BrowserAdapterId {
	return (
		typeof value === "string" &&
		(BROWSER_ADAPTER_ROUTER_ADAPTERS as readonly string[]).includes(value)
	);
}

function isBundle(value: unknown): value is BrowserAdapterRouterBundle {
	return (
		typeof value === "string" &&
		(BROWSER_ADAPTER_ROUTER_BUNDLES as readonly string[]).includes(value)
	);
}

function readRepeatedArgFlagValue(
	argv: readonly string[],
	flag: string,
): string[] {
	const values: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === flag) {
			const next = argv[index + 1];
			if (next === undefined || next.startsWith("--")) {
				throw usageError(`${flag} requires a value.`);
			}
			values.push(next);
			index += 1;
		} else if (arg.startsWith(`${flag}=`)) {
			values.push(arg.slice(flag.length + 1));
		}
	}
	return values;
}

function readRepeatedEnumFlag<T extends string>(
	argv: readonly string[],
	flag: string,
	guard: (value: unknown) => value is T,
): T[] {
	return readRepeatedArgFlagValue(argv, flag).map((value) => {
		if (!guard(value)) {
			throw usageError(`invalid value for ${flag}: ${sanitizeUsageValue(value)}`);
		}
		return value;
	});
}

function readArgFlagValue(
	argv: readonly string[],
	flag: string,
): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === flag) {
			const next = argv[index + 1];
			if (next === undefined || next.startsWith("--")) {
				throw usageError(`${flag} requires a value.`);
			}
			return next;
		}
		if (arg.startsWith(`${flag}=`)) {
			return arg.slice(flag.length + 1);
		}
	}
	return undefined;
}

function rejectUnknownFlags(
	argv: readonly string[],
	allowed: readonly string[],
): void {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
		if (!allowed.includes(name)) {
			throw usageError(`unknown option: ${sanitizeUsageValue(name)}`);
		}
		// Skip the value token for space-separated flags.
		if (!arg.includes("=") && argv[index + 1] && !argv[index + 1].startsWith("--")) {
			index += 1;
		}
	}
}

function inferCommandOutputMode(
	argv: readonly string[],
	command: BrowserAdapterRouterCommand | undefined,
): OutputMode {
	if (argv.includes("--plain")) return "plain";
	if (argv.includes("--json")) return "json";
	if (command === "status") return "plain";
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

function renderHelp(command?: BrowserAdapterRouterCommand): string {
	if (command) return renderCommandUsage(browserAdapterRouterContracts[command]);
	const commandLines = Object.entries(browserAdapterRouterContracts).map(
		([name, contract]) => `  ${name.padEnd(8)} ${contract.summary}`,
	);
	return [
		"Usage: browser-adapter-router <command> [flags]",
		"",
		"Commands:",
		...commandLines,
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

// ---------------------------------------------------------------------------
// stdin + test harness.
// ---------------------------------------------------------------------------

async function readAllStdin(): Promise<string> {
	// Fail fast instead of hanging when route/status is invoked with no envelope
	// source and stdin is an interactive terminal. The contract is non-interactive
	// (interactivity: none), so a blocking read on a TTY is a usage error.
	if (process.stdin.isTTY) {
		throw usageError(
			"route requires --envelope <path>, BROWSER_USE_ROUTER_ENVELOPE_JSON, or piped stdin JSON.",
		);
	}
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf-8");
}

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
	runtime: RouterRuntime,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runBrowserAdapterRouterCli(argv, {
		runtime,
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

export function validateErrorEnvelopeForTest(envelope: unknown): string[] {
	return validateRouterErrorEnvelope(envelope);
}

if (import.meta.main) {
	const exitCode = await runBrowserAdapterRouterCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
