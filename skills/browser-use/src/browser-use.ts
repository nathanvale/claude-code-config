#!/usr/bin/env bun

// Browser Use CLI (platform plan 2026-07-21-002, U1).
//
// One public surface for live Browser Targets/Operations plus the platform
// task/run/runbook/migration/artifact/repair command families.
//
// Command surfaces:
//   targets list|select|status   — Browser Target Discovery/Selection (shell).
//   operate snapshot|screenshot|emulate — Browser Operations (shell).
//   task|run|runbook|migration|artifact|repair — Platform contracts.

import {
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	type RuntimeActionGuidance,
	type RuntimeErrorRecoverability,
	CliUsageError,
	configureCliDiagnostics,
	createCliDiagnosticContext,
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	resetCliDiagnostics,
	usageError,
	withCliDiagnosticContext,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_CONNECT_ENVIRONMENT_NAME,
	BROWSER_CONNECT_ENVIRONMENT_PROFILE,
	BROWSER_USE_ADAPTER_LANES_CONTRACT_ID,
	BROWSER_USE_ADAPTER_LANES_SCHEMA_VERSION,
	BROWSER_USE_ARTIFACT_MANIFEST_CONTRACT_ID,
	BROWSER_USE_REPAIR_STATUS_CONTRACT_ID,
	BROWSER_USE_SHARED_RUN_CONTRACT_ID,
	BROWSER_USE_TASK_INTENTS_CONTRACT_ID,
	BROWSER_USE_TASK_INTENTS_SCHEMA_VERSION,
	BROWSER_USE_TRANSPORT_ADAPTERS,
	type BrowserUseCommand,
	type BrowserUseFamily,
	browserUseAdapterLanesFailureActions,
	browserUsePlatformStoreFailureActions,
	browserUsePlatformStoreSuccessActions,
} from "./command-contract";
import {
	type BrowserUseAdapterLaneView,
	createAdapterLaneRegistry,
	resolveAdapterLane,
} from "./browser-use-adapter-registry";
import {
	BROWSER_USE_LIVE_ADAPTERS,
} from "./discovery-model";
import {
	BROWSER_USE_TASK_INTENT_DEFINITIONS,
	BROWSER_USE_TERMINAL_RUN_STATES,
	type BrowserUseCallerMetadata,
	type BrowserUseRunState,
	type BrowserUseSharedRun,
	classifyCancellation,
} from "./browser-use-run-model";
import {
	emitWithDiagnostics,
	quietDiagnosticWriter,
} from "./cli-diagnostics-bootstrap";
import {
	type OutputMode,
	type ResultKind,
	BINDING_FAIL_CLOSED_EXIT_CODE,
	NOT_IMPLEMENTED_EXIT_CODE,
	RUNTIME_FAILURE_EXIT_CODE,
	USAGE_EXIT_CODE,
	actionFor,
	redactUnsafeText,
	stringField,
	truncateText,
} from "./browser-use-core";
import {
	type BrowserUseRuntime,
	createDefaultBrowserUseRuntime,
} from "./browser-use-runtime";
import { retryabilityForRecoverability } from "./runtime-error-retryability";
import {
	type BrowserUsePathRefusal,
	inspectBrowserUsePaths,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	acquireLease,
	listLeases,
	releaseLease,
	withActivationEpochBarrier,
} from "./browser-use-locks";
import {
	deleteArtifact,
	listPendingTombstones,
	readArtifactStatus,
} from "./browser-use-retention";
import {
	type RunResumeObservedIdentity,
	type RunStoreDeps,
	casUpdateSharedRun,
	leaseKeyForRun,
	listSharedRunReceipts,
	loadSharedRun,
	resumeSharedRun,
} from "./browser-use-runs";
import {
	listOrphanTempFiles,
	removeOrphanTempFiles,
} from "./browser-use-store";
import { runTargetsList } from "./browser-use-discovery";
import {
	runTargetsSelect,
	runTargetsStatus,
} from "./browser-use-selection";
import { runOperate } from "./browser-use-operations";
import {
	type ParsedBrowserUseCommand,
	applyEnvRunId,
	errorOutputMode,
	parseBrowserUseArgv,
	parsedRunIdFlag,
	renderHelp,
	writeVersion,
} from "./browser-use-parser";

// ---------------------------------------------------------------------------
// CLI driver. Mirrors browser-adapter-router.ts structure.
// ---------------------------------------------------------------------------

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
			try {
				return await executeCommand({
					parsed,
					runtime,
					stdout,
					stderr,
					runId,
					runIdExplicit,
					diagnosticVerbose: diagnosticArgv.options.verbose,
					durationMs,
				});
			} catch (error) {
				return emitCliError({
					error,
					outputMode: parsed.outputMode,
					stdout,
					stderr,
					runId,
					durationMs: durationMs(),
				});
			}
		});
	} finally {
		resetCliDiagnostics();
	}
}

// One family -> result kind mapping for the mock/not-implemented envelopes.
const RESULT_KIND_BY_FAMILY: Record<BrowserUseFamily, ResultKind> = {
	targets: "browser_targets",
	operate: "browser_operation",
	task: "task_intents",
	lanes: "adapter_lanes",
	run: "shared_run",
	runbook: "runbook_catalog",
	migration: "migration_status",
	artifact: "artifact_manifest",
	repair: "repair_status",
};

// Non-authoritative caller metadata (platform plan U1, R35): --caller wins
// over BROWSER_USE_CALLER. Audit record only — redaction-gated, length-bounded,
// and never branched on anywhere in the driver or engines.
function callerMetadataFrom(
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>,
	runtime: BrowserUseRuntime,
): BrowserUseCallerMetadata {
	const raw =
		stringField(parsed.flagValues["--caller"]) ??
		stringField(runtime.env.BROWSER_USE_CALLER);
	if (!raw) return { label: null };
	const bounded = truncateText(raw, 64);
	return {
		label: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(bounded)
			? bounded
			: "[redacted]",
	};
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
	const resultKind: ResultKind = RESULT_KIND_BY_FAMILY[parsed.family];
	const caller = callerMetadataFrom(parsed, runtime);

	// Browser Target Discovery (U5). The first live `browser-use` surface: real
	// recovery and handoff-bound target listing through an attached adapter.
	// Dry-run still short-circuits to the mock envelope below.
	if (parsed.command === "targets-list" && !parsed.dryRun) {
		return runTargetsList({
			parsed,
			runtime,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			runIdExplicit: input.runIdExplicit,
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

	// Task Intent catalog (platform plan U1): a live pure projection of the
	// code-owned vocabulary — no browser call, no store read.
	if (parsed.command === "task-list" && !parsed.dryRun) {
		return emitTaskIntents({
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			runId: input.runId,
			caller,
			durationMs: input.durationMs(),
		});
	}

	// Adapter Lane Registry projections (auth plan U1): live compositions of
	// the code-owned lane table. No evidence producer registers through the CLI
	// yet, so every evidence slot projects honest unproven — never a guess.
	if (parsed.command === "lanes-list" && !parsed.dryRun) {
		return emitAdapterLanes({
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			runId: input.runId,
			caller,
			atEpochMs: runtime.now(),
			durationMs: input.durationMs(),
		});
	}
	if (parsed.command === "lanes-show" && !parsed.dryRun) {
		return emitAdapterLaneShow({
			outputMode: parsed.outputMode,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			caller,
			requestedAdapterId: stringField(parsed.flagValues["--adapter"]) ?? "",
			atEpochMs: runtime.now(),
			durationMs: input.durationMs,
		});
	}

	// Platform store-backed commands (platform plan U2): run/artifact/repair
	// inspection over the durable XDG substrate. Dry-run keeps its existing
	// mock envelope below (run resume/cancel already reject --dry-run at the
	// parser since the flag is undeclared). `runbook list` and `migration
	// status` stay typed not-implemented shells for U3/U4.
	if (
		(parsed.command === "run-status" ||
			parsed.command === "run-resume" ||
			parsed.command === "run-cancel" ||
			parsed.command === "artifact-list" ||
			parsed.command === "repair-status" ||
			parsed.command === "repair-apply") &&
		!parsed.dryRun
	) {
		const platformInput: PlatformCommandInput = {
			parsed,
			runtime,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			caller,
			durationMs: input.durationMs,
		};
		if (parsed.command === "run-status") return runRunStatus(platformInput);
		if (parsed.command === "run-resume") return runRunResume(platformInput);
		if (parsed.command === "run-cancel") return runRunCancel(platformInput);
		if (parsed.command === "artifact-list") return runArtifactList(platformInput);
		if (parsed.command === "repair-status") return runRepairStatus(platformInput);
		return runRepairApply(platformInput);
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
	// not-implemented result rather than touching a browser (platform U2-U7
	// and the auth plan own the live bodies). Caller metadata is echoed as an
	// audit fact only — the envelope, exit code, and error are identical for
	// every caller.
	return emitNotImplemented({
		command: parsed.command,
		resultKind,
		outputMode: parsed.outputMode,
		stdout: input.stdout,
		stderr: input.stderr,
		runId: input.runId,
		caller,
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
			error: createCliRuntimeError({
				run_id: input.runId,
				code,
				message,
				exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
				severity: "error",
				recoverability: "change_input",
				retryable: false,
				failure_domain: "browser_use",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return BINDING_FAIL_CLOSED_EXIT_CODE;
}

// Project the code-owned Task Intent catalog (platform plan U1). Rows carry
// the preferred registered lane when one exists; a missing preferred adapter
// is honest typed unavailability (KTD12), and lane registration is derived
// from the live adapter registry, never asserted.
function emitTaskIntents(input: {
	outputMode: OutputMode;
	stdout: CliWriter;
	runId: string;
	caller: BrowserUseCallerMetadata;
	durationMs: number;
}): number {
	const rows = BROWSER_USE_TASK_INTENT_DEFINITIONS.map((definition) => ({
		task_intent: definition.task_intent,
		summary: definition.summary,
		...(definition.preferred_adapter !== undefined
			? { preferred_adapter: definition.preferred_adapter }
			: {}),
		lane_registered:
			definition.preferred_adapter !== undefined &&
			(BROWSER_USE_LIVE_ADAPTERS as readonly string[]).includes(
				definition.preferred_adapter,
			),
	}));
	if (input.outputMode === "plain") {
		input.stdout.write(
			`contract=${BROWSER_USE_TASK_INTENTS_CONTRACT_ID} schema=${BROWSER_USE_TASK_INTENTS_SCHEMA_VERSION} caller=${input.caller.label ?? "none"}\n`,
		);
		for (const row of rows) {
			input.stdout.write(
				`${row.task_intent} lane=${row.preferred_adapter ?? "unregistered"} registered=${row.lane_registered} ${row.summary}\n`,
			);
		}
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				contract: BROWSER_USE_TASK_INTENTS_CONTRACT_ID,
				schema_version: BROWSER_USE_TASK_INTENTS_SCHEMA_VERSION,
				task_intent_count: rows.length,
				task_intents: rows,
				caller: input.caller,
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return 0;
}

// Project one composed lane view into the envelope row shape shared by
// `lanes list` and `lanes show` (auth plan U1, R27: human output projects the
// same state as JSON, never a second vocabulary). The return type anchors the
// row to the complete view: a field dropped from this projection is a compile
// error, so plain-parity tests always compare against the full lane state.
export function adapterLaneRow(
	lane: BrowserUseAdapterLaneView,
): BrowserUseAdapterLaneView {
	return {
		lane_id: lane.lane_id,
		handoff: lane.handoff,
		native_implementation: lane.native_implementation,
		integrity_state: lane.integrity_state,
		evidence: lane.evidence,
		proven_task_claims: lane.proven_task_claims,
		advertised_auth_methods: lane.advertised_auth_methods,
		lane_evidence_digest: lane.lane_evidence_digest,
		...(lane.next_repair_action
			? { next_repair_action: lane.next_repair_action }
			: {}),
	};
}

/**
 * Render one lane's plain projection (R27, finding #7): every safe material
 * field of the JSON row on one `key=value` line — handoff pin, native
 * Implementation (with unavailability reason and repair), integrity state,
 * per-class evidence status/digest/probe time, derived claims, lane digest,
 * and lane repair. Free-text values are JSON-quoted so the line stays
 * machine-splittable; a human and an agent repair from the same state.
 */
export function renderAdapterLaneLine(lane: BrowserUseAdapterLaneView): string {
	const evidenceField = (slot: BrowserUseAdapterLaneView["evidence"]["task"]) =>
		slot.evidence_digest !== undefined
			? `${slot.status}@${slot.evidence_digest}@${slot.probed_at_epoch_ms}`
			: slot.status;
	const implementation = lane.native_implementation.implemented
		? [`implementation=${lane.native_implementation.execution_interface}`]
		: [
				"implementation=unavailable",
				`unavailable_reason=${JSON.stringify(lane.native_implementation.unavailable_reason)}`,
				`implementation_repair=${JSON.stringify(lane.native_implementation.next_repair_action)}`,
			];
	const fields = [
		lane.lane_id,
		`handoff=${lane.handoff.contract_id}@${lane.handoff.schema_version}`,
		...implementation,
		`integrity=${lane.integrity_state}`,
		`connection=${evidenceField(lane.evidence.connection)}`,
		`task=${evidenceField(lane.evidence.task)}`,
		`auth=${evidenceField(lane.evidence["auth-conformance"])}`,
		`task_claims=${lane.proven_task_claims.join(",") || "none"}`,
		`auth_methods=${lane.advertised_auth_methods.join(",") || "none"}`,
		`digest=${lane.lane_evidence_digest}`,
		...(lane.next_repair_action
			? [`repair=${JSON.stringify(lane.next_repair_action)}`]
			: []),
	];
	return `${fields.join(" ")}\n`;
}

// Compose the baseline registry the CLI projects (auth plan U1). Evidence
// producers register through the library Interface, not the CLI, so this
// composition carries no evidence yet; a composition failure here is a
// programming error, not a user state.
function composedLaneRegistry(atEpochMs: number) {
	const result = createAdapterLaneRegistry({
		evidence: [],
		at_epoch_ms: atEpochMs,
	});
	if (!result.ok) {
		throw new Error(
			`adapter lane registry composition failed: ${result.rejection.code}`,
		);
	}
	return result.registry;
}

// Project the Adapter Lane Registry (auth plan U1, R27, AE1).
function emitAdapterLanes(input: {
	outputMode: OutputMode;
	stdout: CliWriter;
	runId: string;
	caller: BrowserUseCallerMetadata;
	atEpochMs: number;
	durationMs: number;
}): number {
	const registry = composedLaneRegistry(input.atEpochMs);
	if (input.outputMode === "plain") {
		input.stdout.write(
			`contract=${BROWSER_USE_ADAPTER_LANES_CONTRACT_ID} schema=${BROWSER_USE_ADAPTER_LANES_SCHEMA_VERSION} caller=${input.caller.label ?? "none"}\n`,
		);
		for (const lane of registry.lanes) {
			input.stdout.write(renderAdapterLaneLine(lane));
		}
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				contract: BROWSER_USE_ADAPTER_LANES_CONTRACT_ID,
				schema_version: BROWSER_USE_ADAPTER_LANES_SCHEMA_VERSION,
				lane_count: registry.lanes.length,
				lanes: registry.lanes.map(adapterLaneRow),
				composed_digest: registry.composed_digest,
				caller: input.caller,
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return 0;
}

// Resolve one lane by exact handoff adapter id (auth plan U1, R3/AE1): a
// mismatched or unknown adapter id fails closed before any evidence or secret
// work, and a rejected identity alias is named as such, never silently mapped.
function emitAdapterLaneShow(input: {
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	caller: BrowserUseCallerMetadata;
	requestedAdapterId: string;
	atEpochMs: number;
	durationMs: () => number;
}): number {
	const registry = composedLaneRegistry(input.atEpochMs);
	const resolved = resolveAdapterLane(registry, input.requestedAdapterId);
	if (!resolved.ok) {
		const code =
			resolved.failure.code === "lane_alias_rejected"
				? "browser_lane_alias_rejected"
				: "browser_lane_unknown";
		if (input.outputMode === "plain") {
			input.stderr.write(
				`browser_use ${code}: ${resolved.failure.message} (run_id=${input.runId})\n`,
			);
			return BINDING_FAIL_CLOSED_EXIT_CODE;
		}
		const failureAction = browserUseAdapterLanesFailureActions[0];
		writeJsonEnvelope(
			input.stdout,
			createCliRuntimeErrorEnvelope({
				run_id: input.runId,
				process_exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
				data: {
					contract: BROWSER_USE_ADAPTER_LANES_CONTRACT_ID,
					schema_version: BROWSER_USE_ADAPTER_LANES_SCHEMA_VERSION,
					// Machine-readable recovery (R27): the exact ids a retry may use,
					// so an agent repairs from this envelope without prose parsing.
					valid_lane_ids: registry.lanes.map((lane) => lane.lane_id),
					caller: input.caller,
				},
				error: createCliRuntimeError({
					run_id: input.runId,
					code,
					message: resolved.failure.message,
					exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
					severity: "error",
					recoverability: "change_input",
					retryable: false,
					failure_domain: "browser_use",
				}),
				runtime_actions: [
					{
						id: failureAction.id,
						summary: failureAction.summary,
						side_effects: [...failureAction.sideEffects],
					},
				],
				continuation: { next_action_id: failureAction.id },
			}),
			{ runId: input.runId, durationMs: input.durationMs() },
		);
		return BINDING_FAIL_CLOSED_EXIT_CODE;
	}
	if (input.outputMode === "plain") {
		input.stdout.write(
			`contract=${BROWSER_USE_ADAPTER_LANES_CONTRACT_ID} schema=${BROWSER_USE_ADAPTER_LANES_SCHEMA_VERSION} caller=${input.caller.label ?? "none"}\n`,
		);
		input.stdout.write(renderAdapterLaneLine(resolved.lane));
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				contract: BROWSER_USE_ADAPTER_LANES_CONTRACT_ID,
				schema_version: BROWSER_USE_ADAPTER_LANES_SCHEMA_VERSION,
				lane: adapterLaneRow(resolved.lane),
				caller: input.caller,
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return 0;
}

function emitNotImplemented(input: {
	command: BrowserUseCommand;
	resultKind: ResultKind;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	caller: BrowserUseCallerMetadata;
	durationMs: number;
}): number {
	const code = "browser_use_not_implemented";
	const message = "Live browser-use logic for this command is not implemented yet.";
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
			data: {
				command: input.command,
				result_kind: input.resultKind,
				caller: input.caller,
			},
			error: createCliRuntimeError({
				run_id: input.runId,
				code,
				message,
				exit_code: NOT_IMPLEMENTED_EXIT_CODE,
				severity: "error",
				recoverability: "none",
				retryable: false,
				failure_domain: "browser_use",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return NOT_IMPLEMENTED_EXIT_CODE;
}

// ---------------------------------------------------------------------------
// Platform store-backed commands (platform plan 2026-07-21-002 U2).
//
// The `run status|resume|cancel`, `artifact list`, and `repair status` entries
// over the durable XDG substrate. Driver-level composition mirroring the
// task-list precedent: every command opens the store through the ONE path
// owner (`openBrowserUsePaths`), emits the identical typed XDG refusal on
// admission failure (AE4), and projects run/artifact/repair truth through the
// U2 library seams with JSON/plain parity (R35). No run byte is written here
// outside `casUpdateSharedRun`, and the opaque `auth_fragment` is NEVER
// emitted by any CLI surface (R6).
// ---------------------------------------------------------------------------

/** Shared input shape for the U2 store-backed command entries (spec B2). */
type PlatformCommandInput = {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	caller: BrowserUseCallerMetadata;
	durationMs: () => number;
};

const platformStoreActions = [
	...browserUsePlatformStoreFailureActions,
	...browserUsePlatformStoreSuccessActions,
] as const;
// Keyed on plain string so the blocked-resume path can probe whether a run's
// persisted continuation id is a registry action.
const platformStoreActionById = new Map<
	string,
	(typeof platformStoreActions)[number]
>(platformStoreActions.map((action) => [action.id, action]));
type PlatformStoreActionId = (typeof platformStoreActions)[number]["id"];

function platformStoreAction(id: PlatformStoreActionId): RuntimeActionGuidance {
	return actionFor(platformStoreActionById, id, "platform store");
}

// The observed lane identity the U2 platform can honestly assert at resume
// time: the pinned Browser Connect schema-2 environment identity plus the one
// transport-implemented adapter lane. A ready/running run bound to any other
// lane cannot resume on this platform, so the U1 same-lane gate refuses it
// truthfully; live observation replaces this static pin in U4.
const RESUME_OBSERVED_IDENTITY: RunResumeObservedIdentity = {
	adapter_id: BROWSER_USE_TRANSPORT_ADAPTERS[0],
	environment_profile: {
		environment: BROWSER_CONNECT_ENVIRONMENT_NAME,
		profile: BROWSER_CONNECT_ENVIRONMENT_PROFILE,
	},
};

/** Contract schema version every U2 result contract declares (B1 table). */
const PLATFORM_STORE_SCHEMA_VERSION = "1";

function isTerminalRunState(state: BrowserUseRunState): boolean {
	return (
		BROWSER_USE_TERMINAL_RUN_STATES as readonly BrowserUseRunState[]
	).includes(state);
}

// The auth_fragment is stored opaque and surfaces only through the auth Port;
// every other run field is redaction-safe by construction (R6, S20).
function projectRunForCli(
	run: BrowserUseSharedRun,
): Omit<BrowserUseSharedRun, "auth_fragment"> {
	const { auth_fragment: _fragment, ...projection } = run;
	return projection;
}

// One typed failure record per store-backed refusal: code, exit code, and the
// exactly-one continuation drawn from the U2 action tables (spec D).
type PlatformStoreFailure = {
	code: string;
	message: string;
	actionId: PlatformStoreActionId;
	exitCode: number;
	recoverability: RuntimeErrorRecoverability;
};

function platformErrorCode(error: unknown): string {
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" && code !== "" ? code : "unknown";
}

// Map library refusal codes onto exit codes and continuations. Every store
// state failure fails closed at 20 (the U1 platform exit table); only
// execution-unavailable reports the runtime-dependency exit 1.
function platformStoreFailureOf(
	code: string,
	message: string,
): PlatformStoreFailure {
	switch (code) {
		case "run_not_found":
			return {
				code,
				message,
				actionId: "supply_run_id",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			};
		case "run_revision_stale":
			return {
				code,
				message,
				actionId: "refresh_run_revision",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "retry",
			};
		case "lease_held":
		case "store_lock_contended":
			return {
				code,
				message,
				actionId: "wait_for_lease",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "retry",
			};
		case "run_record_corrupt":
		case "run_record_invalid":
		case "store_record_corrupt":
			return {
				code,
				message,
				actionId: "inspect_corrupt_store_record",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			};
		case "store_read_failed":
			return {
				code,
				message,
				actionId: "repair_xdg_root",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			};
		default:
			// Lease fencing/epoch/expiry and remaining repairable store faults
			// route through the bounded repair projection.
			return {
				code,
				message,
				actionId: "inspect_repair_status",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			};
	}
}

function emitPlatformStoreFailure(
	input: PlatformCommandInput,
	failure: PlatformStoreFailure,
): number {
	const message = redactUnsafeText(failure.message);
	if (input.parsed.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${failure.code}: ${message} action=${failure.actionId} (run_id=${input.runId})\n`,
		);
		return failure.exitCode;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: failure.exitCode,
			data: {
				command: input.parsed.command,
				result_kind: RESULT_KIND_BY_FAMILY[input.parsed.family],
				caller: input.caller,
			},
			runtime_actions: [platformStoreAction(failure.actionId)],
			continuation: { next_action_id: failure.actionId },
			error: createCliRuntimeError({
				run_id: input.runId,
				code: failure.code,
				message,
				exit_code: failure.exitCode,
				severity: "error",
				...retryabilityForRecoverability(failure.recoverability),
				failure_domain: "browser_use",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return failure.exitCode;
}

// The AE4 refusal: identical code, message, continuation, and exit code from
// every store-backed command. The refusal carries its own exactly-one
// repair_xdg_root continuation from the path owner.
function emitXdgRefusal(
	input: PlatformCommandInput,
	refusal: BrowserUsePathRefusal,
): number {
	return emitPlatformStoreFailure(input, {
		code: refusal.code,
		message: refusal.message,
		actionId: refusal.continuation.next_action_id,
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "repair_state",
	});
}

// Open the store through the one XDG path owner. RunStoreDeps is structurally
// identical to the lease/retention deps, so one deps object feeds every U2
// library seam.
async function openPlatformStore(
	input: PlatformCommandInput,
	access: "read" | "write" = "read",
): Promise<{ ok: true; deps: RunStoreDeps } | { ok: false; exitCode: number }> {
	const opened =
		access === "write"
			? await openBrowserUsePaths(input.runtime.platformFs, input.runtime.env)
			: await inspectBrowserUsePaths(input.runtime.platformFs, input.runtime.env);
	if (!opened.ok) {
		return { ok: false, exitCode: emitXdgRefusal(input, opened.refusal) };
	}
	return {
		ok: true,
		deps: {
			fs: input.runtime.platformFs,
			paths: opened.paths,
			clock: input.runtime.now,
		},
	};
}

// Plain projection of one shared run: the SAME fields the JSON envelope
// carries, as stable key=value lines (the emitTaskIntents pattern, R35).
function writeRunPlain(
	stdout: CliWriter,
	run: Omit<BrowserUseSharedRun, "auth_fragment">,
): void {
	stdout.write(
		[
			`run_id=${run.run_id}`,
			`revision=${run.revision}`,
			`state=${run.state}`,
			`task_intent=${run.task_intent}`,
			`environment=${run.environment_profile.environment}`,
			`profile=${run.environment_profile.profile}`,
			`adapter=${run.adapter_id ?? "unbound"}`,
			`mutation_dispatched=${run.mutation_dispatched}`,
			...(run.auth_attestation !== undefined
				? [
						`attestation_digest=${run.auth_attestation.attestation_digest}`,
						`attestation_fresh_until=${run.auth_attestation.fresh_until_epoch_ms}`,
					]
				: []),
		].join(" ") + "\n",
	);
	if (run.continuation !== undefined) {
		stdout.write(
			`continuation=${run.continuation.next_action_id} ${run.continuation.summary}\n`,
		);
	}
	for (const artifact of run.artifacts) {
		stdout.write(
			`artifact=${artifact.artifact_id} sensitivity=${artifact.sensitivity} retention=${artifact.retention}\n`,
		);
	}
}

function platformPlainHeader(
	contract: string,
	caller: BrowserUseCallerMetadata,
	extra: readonly string[] = [],
): string {
	return (
		[
			`contract=${contract}`,
			`schema=${PLATFORM_STORE_SCHEMA_VERSION}`,
			`caller=${caller.label ?? "none"}`,
			...extra,
		].join(" ") + "\n"
	);
}

// One shared-run success envelope (status/resume/cancel). The continuation is
// EXACTLY one: the caller-chosen table action, or — for a blocked resume —
// the run's own persisted next safe action (the continuation IS the resume
// answer in U2), projected as the envelope's single runtime action so the
// facade's continuation/actions pairing holds.
function emitSharedRunSuccess(input: {
	command: PlatformCommandInput;
	run: BrowserUseSharedRun;
	continuationId: string;
	dataExtra?: Record<string, unknown>;
	plainExtra?: readonly string[];
}): number {
	const projection = projectRunForCli(input.run);
	const { command } = input;
	if (command.parsed.outputMode === "plain") {
		command.stdout.write(
			platformPlainHeader(BROWSER_USE_SHARED_RUN_CONTRACT_ID, command.caller, [
				`action=${input.continuationId}`,
				...(input.plainExtra ?? []),
			]),
		);
		writeRunPlain(command.stdout, projection);
		return 0;
	}
	// A non-registry id is the run's own persisted next safe action (blocked
	// resume). Its summary is run-authored prose, so the validated action
	// guidance carries a fixed pointer while data.continuation carries the
	// persisted summary verbatim.
	const action: RuntimeActionGuidance = platformStoreActionById.has(
		input.continuationId,
	)
		? platformStoreAction(input.continuationId as PlatformStoreActionId)
		: {
				id: input.continuationId,
				summary: "Follow the run's persisted next safe action.",
				side_effects: ["check"],
			};
	writeJsonEnvelope(
		command.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: command.runId,
			data: {
				contract: BROWSER_USE_SHARED_RUN_CONTRACT_ID,
				schema_version: PLATFORM_STORE_SCHEMA_VERSION,
				run: projection,
				...(input.dataExtra ?? {}),
				caller: command.caller,
			},
			runtime_actions: [action],
			continuation: { next_action_id: input.continuationId },
		}),
		{ runId: command.runId, durationMs: command.durationMs() },
	);
	return 0;
}

/**
 * `run status` (R24/R35, AE15 substrate). Without `--run`: the redacted
 * receipt listing — the "fresh agent discovers all safe next actions"
 * surface; each blocked run's receipt names its one continuation. With
 * `--run <id>`: the full shared-run projection under the shared-run contract
 * (auth readiness reference only; the `auth_fragment` never surfaces).
 *
 * @param input - Store-backed command input
 * @returns Process exit code
 */
async function runRunStatus(input: PlatformCommandInput): Promise<number> {
	const store = await openPlatformStore(input);
	if (!store.ok) return store.exitCode;
	const runFlag = stringField(input.parsed.flagValues["--run"]);
	if (runFlag === undefined) {
		let receipts: Awaited<ReturnType<typeof listSharedRunReceipts>>;
		try {
			receipts = await listSharedRunReceipts(store.deps);
		} catch (error) {
			return emitPlatformStoreFailure(
				input,
				platformStoreFailureOf(
					"store_read_failed",
					`shared-run receipt listing failed (${platformErrorCode(error)}).`,
				),
			);
		}
		if (input.parsed.outputMode === "plain") {
			input.stdout.write(
				platformPlainHeader(BROWSER_USE_SHARED_RUN_CONTRACT_ID, input.caller, [
					"action=inspect_shared_run",
					`run_count=${receipts.length}`,
				]),
			);
			for (const receipt of receipts) {
				input.stdout.write(
					`run_id=${receipt.run_id} revision=${receipt.revision} state=${receipt.state} receipt_digest=${receipt.receipt_digest} ${receipt.summary}\n`,
				);
			}
			return 0;
		}
		writeJsonEnvelope(
			input.stdout,
			createCliRuntimeSuccessEnvelope({
				run_id: input.runId,
				data: {
					contract: BROWSER_USE_SHARED_RUN_CONTRACT_ID,
					schema_version: PLATFORM_STORE_SCHEMA_VERSION,
					run_count: receipts.length,
					receipts,
					caller: input.caller,
				},
				runtime_actions: [platformStoreAction("inspect_shared_run")],
				continuation: { next_action_id: "inspect_shared_run" },
			}),
			{ runId: input.runId, durationMs: input.durationMs() },
		);
		return 0;
	}
	const loaded = await loadSharedRun(store.deps, runFlag);
	if (!loaded.ok) {
		return emitPlatformStoreFailure(
			input,
			platformStoreFailureOf(loaded.code, loaded.message),
		);
	}
	// A blocked run's next safe action is resuming it; anything else is
	// inspection truth.
	const continuationId =
		loaded.run.continuation !== undefined && !isTerminalRunState(loaded.run.state)
			? "resume_shared_run"
			: "inspect_shared_run";
	return emitSharedRunSuccess({
		command: input,
		run: loaded.run,
		continuationId,
	});
}

/**
 * `run resume` (R28/R36, AE7/AE15 substrate). Blocked: re-emits the run plus
 * its exactly-one persisted continuation (state unchanged — the continuation
 * IS the resume answer in U2). Ready/running: the U1 same-lane gate runs
 * against the pinned observed identity, then live execution reports typed
 * unavailability (exit 1; lanes land in U4). Terminal truth never re-enters
 * execution (exit 20).
 *
 * @param input - Store-backed command input
 * @returns Process exit code
 */
async function runRunResume(input: PlatformCommandInput): Promise<number> {
	const store = await openPlatformStore(input);
	if (!store.ok) return store.exitCode;
	const runFlag = stringField(input.parsed.flagValues["--run"]) ?? "";
	const projection = await resumeSharedRun(store.deps, {
		runId: runFlag,
		observed: RESUME_OBSERVED_IDENTITY,
	});
	switch (projection.kind) {
		case "blocked":
			return emitSharedRunSuccess({
				command: input,
				run: projection.run,
				continuationId: projection.continuation.next_action_id,
				dataExtra: {
					resume: "blocked",
					continuation: projection.continuation,
				},
				plainExtra: ["resume=blocked"],
			});
		case "execution-unavailable":
			return emitPlatformStoreFailure(input, {
				code: "run_resume_execution_unavailable",
				message: `run ${projection.run.run_id} is ${projection.run.state}; persistence and resume are proven, live lane execution is not implemented yet.`,
				actionId: "inspect_shared_run",
				exitCode: RUNTIME_FAILURE_EXIT_CODE,
				recoverability: "none",
			});
		case "lane-mismatch":
			return emitPlatformStoreFailure(input, {
				code: projection.refusal.code,
				message: projection.refusal.message,
				actionId: "inspect_shared_run",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none",
			});
		case "terminal":
			return emitPlatformStoreFailure(input, {
				code: "run_terminal_truth",
				message: `run ${projection.run.run_id} holds terminal truth ${projection.run.state}; terminal truth never re-enters execution.`,
				actionId: "inspect_shared_run",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none",
			});
		case "load-failed":
			return emitPlatformStoreFailure(
				input,
				platformStoreFailureOf(
					projection.failure.code,
					projection.failure.message,
				),
			);
	}
}

/**
 * `run cancel` (R37, AE15). Terminal-truth mapping through the U1 classifier:
 * external effect `none` -> terminal `not-achieved`, `unknown` -> terminal
 * `unknown`; `rolled_back` is ALWAYS the literal false. Cancelling an
 * already-terminal run is an idempotent projection of the standing truth —
 * no write, no revision bump.
 *
 * @param input - Store-backed command input
 * @returns Process exit code
 */
async function runRunCancel(input: PlatformCommandInput): Promise<number> {
	const store = await openPlatformStore(input, "write");
	if (!store.ok) return store.exitCode;
	const runFlag = stringField(input.parsed.flagValues["--run"]) ?? "";
	const loaded = await loadSharedRun(store.deps, runFlag);
	if (!loaded.ok) {
		return emitPlatformStoreFailure(
			input,
			platformStoreFailureOf(loaded.code, loaded.message),
		);
	}
	const report = classifyCancellation(loaded.run);
	const cancellationExtra = {
		dataExtra: { cancellation: report },
		plainExtra: [
			`external_effect=${report.external_effect}`,
			`rolled_back=${report.rolled_back}`,
		],
	};
	if (isTerminalRunState(loaded.run.state)) {
		return emitSharedRunSuccess({
			command: input,
			run: loaded.run,
			continuationId: "inspect_shared_run",
			...cancellationExtra,
		});
	}
	const targetState: BrowserUseRunState =
		report.external_effect === "none" ? "not-achieved" : "unknown";
	const acquired = await acquireLease(store.deps, {
		key: leaseKeyForRun(loaded.run),
		holderId: `cancel-${runFlag}`,
		ttlMs: 10_000,
	});
	if (!acquired.ok) {
		const message =
			acquired.code === "lease_held"
				? acquired.continuation.summary
				: acquired.message;
		return emitPlatformStoreFailure(
			input,
			platformStoreFailureOf(acquired.code, message),
		);
	}
	const claim = {
		fencing_token: acquired.lease.fencing_token,
		activation_epoch: acquired.lease.activation_epoch,
		holderId: acquired.lease.holder_id,
	};
	let updated: Awaited<ReturnType<typeof casUpdateSharedRun>>;
	try {
		updated = await casUpdateSharedRun(store.deps, {
			runId: runFlag,
			expectedRevision: loaded.run.revision,
			lease: claim,
			mutate: (run) => {
				// Terminal truth carries no blocked-state continuation; everything
				// else (artifacts, attestation reference, dispatch truth) survives.
				const { continuation: _continuation, ...rest } = run;
				return { ...rest, state: targetState };
			},
		});
	} finally {
		await releaseLease(store.deps, acquired.lease);
	}
	if (!updated.ok) {
		return emitPlatformStoreFailure(
			input,
			platformStoreFailureOf(updated.code, updated.message),
		);
	}
	return emitSharedRunSuccess({
		command: input,
		run: updated.run,
		continuationId: "inspect_shared_run",
		...cancellationExtra,
	});
}

// Artifact metadata record suffixes (the retention naming contract; path
// construction stays owned by browser-use-retention's helpers).
const ARTIFACT_MANIFEST_SUFFIX = ".manifest.json";
const ARTIFACT_TOMBSTONE_SUFFIX = ".tombstone.json";

// One artifact listing row: the four-way R29 truth plus its redacted
// retention facts. Deleted rows appear WITH their tombstone classification
// (AE14 substrate); corrupt rows carry the redacted message only.
async function artifactRowsForRun(
	deps: RunStoreDeps,
	runId: string,
): Promise<Record<string, unknown>[]> {
	const runDir = deps.paths.state.artifactDir(runId);
	const dirStat = await deps.fs.lstat(runDir);
	if (dirStat === undefined || dirStat.kind !== "directory") return [];
	const artifactIds = new Set<string>();
	for (const entry of await deps.fs.readDirectory(runDir)) {
		if (entry.endsWith(ARTIFACT_MANIFEST_SUFFIX)) {
			artifactIds.add(entry.slice(0, -ARTIFACT_MANIFEST_SUFFIX.length));
		} else if (entry.endsWith(ARTIFACT_TOMBSTONE_SUFFIX)) {
			artifactIds.add(entry.slice(0, -ARTIFACT_TOMBSTONE_SUFFIX.length));
		}
	}
	const rows: Record<string, unknown>[] = [];
	for (const artifactId of [...artifactIds].sort()) {
		const status = await readArtifactStatus(deps, { runId, artifactId });
		if (status.status === "missing") continue;
		if (status.status === "present") {
			rows.push({
				artifact_id: artifactId,
				run_id: runId,
				status: "present",
				sensitivity: status.manifest.sensitivity,
				retention: status.manifest.retention,
				content_hash: status.manifest.content_hash,
				outcome_ref: status.manifest.outcome_ref,
				exported: status.manifest.export_receipt !== null,
			});
			continue;
		}
		if (status.status === "deleted") {
			rows.push({
				artifact_id: artifactId,
				run_id: runId,
				status: "deleted",
				retention: status.tombstone.retention,
				reason: status.tombstone.reason,
				phase: status.tombstone.phase,
				deleted_at_epoch_ms: status.tombstone.deleted_at_epoch_ms,
			});
			continue;
		}
		rows.push({
			artifact_id: artifactId,
			run_id: runId,
			status: "corrupt",
			message: status.message,
		});
	}
	return rows;
}

/**
 * `artifact list [--run <id>]` (R29/R35, AE14 substrate). Projects manifests
 * AND tombstones so deleted artifacts stay distinguishable from missing ones;
 * `--run` narrows to one shared run.
 *
 * @param input - Store-backed command input
 * @returns Process exit code
 */
async function runArtifactList(input: PlatformCommandInput): Promise<number> {
	const store = await openPlatformStore(input);
	if (!store.ok) return store.exitCode;
	const runFilter = stringField(input.parsed.flagValues["--run"]);
	let runIds: string[];
	if (runFilter !== undefined) {
		try {
			store.deps.paths.state.artifactDir(runFilter);
		} catch {
			return emitPlatformStoreFailure(
				input,
				platformStoreFailureOf(
					"run_not_found",
					"the --run filter is not a safe run id segment.",
				),
			);
		}
		runIds = [runFilter];
	} else {
		const artifactsDir = store.deps.paths.state.artifactsDir;
		const dirStat = await store.deps.fs.lstat(artifactsDir);
		runIds =
			dirStat !== undefined && dirStat.kind === "directory"
				? [...(await store.deps.fs.readDirectory(artifactsDir))].sort()
				: [];
	}
	const rows: Record<string, unknown>[] = [];
	for (const runId of runIds) {
		rows.push(...(await artifactRowsForRun(store.deps, runId)));
	}
	if (input.parsed.outputMode === "plain") {
		input.stdout.write(
			platformPlainHeader(BROWSER_USE_ARTIFACT_MANIFEST_CONTRACT_ID, input.caller, [
				"action=inspect_shared_run",
				...(runFilter !== undefined ? [`run=${runFilter}`] : []),
				`artifact_count=${rows.length}`,
			]),
		);
		for (const row of rows) {
			input.stdout.write(
				Object.entries(row)
					.map(([key, value]) => `${key}=${value}`)
					.join(" ") + "\n",
			);
		}
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				contract: BROWSER_USE_ARTIFACT_MANIFEST_CONTRACT_ID,
				schema_version: PLATFORM_STORE_SCHEMA_VERSION,
				...(runFilter !== undefined ? { run: runFilter } : {}),
				artifact_count: rows.length,
				artifacts: rows,
				caller: input.caller,
			},
			runtime_actions: [platformStoreAction("inspect_shared_run")],
			continuation: { next_action_id: "inspect_shared_run" },
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return 0;
}

/**
 * `repair status` (R27/R35). Projects the admitted roots, the runtime
 * fallback flag, every durable lease with its liveness classification,
 * orphan temp files, and pending tombstones — plus EXACTLY one next safe
 * action: a live lease -> wait_for_lease; a pending tombstone or orphan ->
 * apply_repair; otherwise inspect_shared_run.
 * Success data shows the operator's own admitted root paths (they are the
 * repair surface); error envelopes never echo paths.
 *
 * @param input - Store-backed command input
 * @returns Process exit code
 */
async function runRepairStatus(input: PlatformCommandInput): Promise<number> {
	const store = await openPlatformStore(input);
	if (!store.ok) return store.exitCode;
	const { deps } = store;
	const leases = await listLeases(deps);
	const orphans = await listOrphanTempFiles(
		deps.fs,
		deps.paths.resolution.roots.state,
	);
	const tombstones = await listPendingTombstones(deps);
	const nextActionId: PlatformStoreActionId = leases.some((lease) => lease.live)
		? "wait_for_lease"
		: tombstones.length > 0 || orphans.length > 0
			? "apply_repair"
			: "inspect_shared_run";
	const { roots } = deps.paths.resolution;
	const runtimeFallback = deps.paths.resolution.runtime_fallback;
	if (input.parsed.outputMode === "plain") {
		input.stdout.write(
			platformPlainHeader(BROWSER_USE_REPAIR_STATUS_CONTRACT_ID, input.caller, [
				`action=${nextActionId}`,
			]),
		);
		for (const [kind, root] of Object.entries(roots)) {
			input.stdout.write(`root_${kind}=${root}\n`);
		}
		input.stdout.write(
			`runtime_fallback=${runtimeFallback.active}${runtimeFallback.reason !== undefined ? ` reason=${runtimeFallback.reason}` : ""}\n`,
		);
		for (const lease of leases) {
			input.stdout.write(
				`lease=${JSON.stringify(lease.key)} holder=${lease.holder_id} fencing_token=${lease.fencing_token} activation_epoch=${lease.activation_epoch} heartbeat_at=${lease.heartbeat_at_epoch_ms} expires_at=${lease.expires_at_epoch_ms} live=${lease.live} recovered_from=${lease.recovered_from === null ? "none" : lease.recovered_from.holder_id}\n`,
			);
		}
		for (const orphan of orphans) {
			input.stdout.write(`orphan_temp_file=${orphan}\n`);
		}
		for (const tombstone of tombstones) {
			input.stdout.write(
				`pending_tombstone=${tombstone.artifact_id} run=${tombstone.run_id} reason=${tombstone.reason}\n`,
			);
		}
		input.stdout.write(`next_action=${nextActionId}\n`);
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				contract: BROWSER_USE_REPAIR_STATUS_CONTRACT_ID,
				schema_version: PLATFORM_STORE_SCHEMA_VERSION,
				roots,
				runtime_fallback: runtimeFallback,
				leases,
				orphan_temp_files: orphans,
				pending_tombstones: tombstones,
				next_action: nextActionId,
				caller: input.caller,
			},
			runtime_actions: [platformStoreAction(nextActionId)],
			continuation: { next_action_id: nextActionId },
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return 0;
}

/**
 * Apply the bounded plan projected by `repair status`. Live leases block all
 * changes. Pending tombstones converge through the retention owner; only
 * recognized durable-write temp orphans are removed.
 */
async function runRepairApply(input: PlatformCommandInput): Promise<number> {
	const store = await openPlatformStore(input, "write");
	if (!store.ok) return store.exitCode;
	const { deps } = store;
	const applied = await withActivationEpochBarrier(
		deps,
		{ holderId: "repair-apply" },
		async () => {
			const leases = await listLeases(deps);
			if (leases.some((lease) => lease.live)) {
				return {
					ok: false as const,
					code: "lease_held",
					message:
						"a live lease holds platform state; repair apply made no changes.",
				};
			}
			const repairedArtifactIds: string[] = [];
			for (const tombstone of await listPendingTombstones(deps)) {
				const deleted = await deleteArtifact(deps, {
					runId: tombstone.run_id,
					artifactId: tombstone.artifact_id,
					reason: tombstone.reason,
				});
				if (!deleted.ok) {
					return {
						ok: false as const,
						code: deleted.code,
						message: deleted.message,
					};
				}
				repairedArtifactIds.push(tombstone.artifact_id);
			}
			const removed = await removeOrphanTempFiles(
				deps.fs,
				deps.paths.resolution.roots.state,
			);
			if (!removed.ok) {
				return {
					ok: false as const,
					code: removed.failure.code,
					message: removed.failure.message,
				};
			}
			return {
				ok: true as const,
				repairedArtifactIds,
				removedOrphanCount: removed.removed,
			};
		},
	);
	if (!applied.ok) {
		return emitPlatformStoreFailure(
			input,
			platformStoreFailureOf(applied.code, applied.message),
		);
	}
	const { repairedArtifactIds, removedOrphanCount } = applied;
	const nextActionId: PlatformStoreActionId = "inspect_repair_status";
	if (input.parsed.outputMode === "plain") {
		input.stdout.write(
			platformPlainHeader(BROWSER_USE_REPAIR_STATUS_CONTRACT_ID, input.caller, [
				`repaired_tombstone_count=${repairedArtifactIds.length}`,
				`removed_orphan_count=${removedOrphanCount}`,
				`next_action=${nextActionId}`,
			]),
		);
		for (const artifactId of repairedArtifactIds) {
			input.stdout.write(`repaired_artifact=${artifactId}\n`);
		}
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				contract: BROWSER_USE_REPAIR_STATUS_CONTRACT_ID,
				schema_version: PLATFORM_STORE_SCHEMA_VERSION,
				repaired_tombstone_count: repairedArtifactIds.length,
				removed_orphan_count: removedOrphanCount,
				repaired_artifact_ids: repairedArtifactIds,
				next_action: nextActionId,
				caller: input.caller,
			},
			runtime_actions: [platformStoreAction(nextActionId)],
			continuation: { next_action_id: nextActionId },
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return 0;
}

// ---------------------------------------------------------------------------
// --- Small shared field helpers --------------------------------------------


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
			error: createCliRuntimeError({
				run_id: input.runId,
				code: isUsage ? "usage_error" : "runtime_error",
				message: safeMessage,
				exit_code: exitCode,
				severity: isUsage ? "error" : "fatal",
				recoverability: isUsage ? "change_input" : "none",
				retryable: false,
				failure_domain: isUsage ? "input" : "runtime_diagnostics",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return exitCode;
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
} from "./command-contract";
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
	type OperationResolution,
	type OperationResolutionInput,
	type OperationTargetHints,
	resolveOperationTarget,
} from "./browser-use-selection";

if (import.meta.main) {
	const exitCode = await runBrowserUseCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
