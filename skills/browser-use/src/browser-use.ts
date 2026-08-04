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

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	type RuntimeActionGuidance,
	type RuntimeErrorRecoverability,
	CliUsageError,
	configureCliDiagnostics,
	createCliDiagnosticContext,
	createCommandResultData,
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
	BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES,
	BROWSER_USE_APPROVAL_BROKER_ENV,
	BROWSER_USE_ARTIFACT_MANIFEST_CONTRACT_ID,
	BROWSER_USE_AUTH_READINESS_CONTRACT_ID,
	BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID,
	BROWSER_USE_AUTH_READINESS_SCHEMA_VERSION,
	BROWSER_USE_REPAIR_STATUS_CONTRACT_ID,
	BROWSER_USE_REVIEWED_ACTION_AUTHORING_CONTRACT_ID,
	BROWSER_USE_RUNBOOK_CATALOG_CONTRACT_ID,
	BROWSER_USE_RUNBOOK_CATALOG_SCHEMA_VERSION,
	BROWSER_USE_RUNBOOK_AUTHORING_CONTRACT_ID,
	BROWSER_USE_RUNBOOK_ACTIVATION_CONTRACT_ID,
	BROWSER_USE_RUNBOOK_ACTIVATION_SCHEMA_VERSION,
	BROWSER_USE_RUNBOOK_DEFINITION_CONTRACT_ID,
	BROWSER_USE_RUNBOOK_DEFINITION_SCHEMA_VERSION,
	BROWSER_USE_SHARED_RUN_CONTRACT_ID,
	BROWSER_USE_SHARED_RUN_SCHEMA_VERSION,
	BROWSER_USE_TASK_INTENTS_CONTRACT_ID,
	BROWSER_USE_TASK_INTENTS_SCHEMA_VERSION,
	BROWSER_USE_TRANSPORT_ADAPTERS,
	type BrowserUseAuthRepairSubcommand,
	type BrowserUseAuthSubcommand,
	type BrowserUseCommand,
	type BrowserUseFamily,
	type BrowserUseGuideTopic,
	browserUseAdapterLanesFailureActions,
	browserUseContracts,
	browserUseAuthRepairActions,
	browserUseAuthRepairFailureActions,
	browserUsePlatformStoreFailureActions,
	browserUsePlatformStoreSuccessActions,
	browserUseTaskRunFailureActions,
	browserUseTaskRunSuccessActions,
} from "./command-contract";
import {
	type BrowserUseOpCredentialField,
	type BrowserUseTokenRetrievalPort,
	type BrowserUseTokenRetrievalRejection,
	blockOfRetrievalRejection,
	proveVaultScope,
} from "./browser-use-op";
import type { BrowserUseDeliveryHook } from "./browser-use-confidential-field-delivery";
import type { BrowserUseEnvironmentTokenRetrievalPort } from "./browser-use-environment-op";
import {
	type BrowserUseDevToolsRequest,
	type BrowserUseDevToolsTransport,
	type BrowserUseMintedVerifiedTarget,
	mintBrowserUseVerifiedTarget,
	resolveBrowserUseCdpTargetIdentity,
} from "./browser-use-target-proof";
import {
	type BrowserUseAdapterLaneView,
	createAdapterLaneRegistry,
	resolveAdapterLane,
} from "./browser-use-adapter-registry";
import {
	type BrowserUseLaneEvidenceReference,
	BROWSER_USE_ADAPTER_LANE_IDS,
	BROWSER_USE_LANE_EVIDENCE_PRODUCERS,
	laneEvidenceDigestOf,
} from "./browser-use-adapter-model";
import {
	conformanceEvidenceClaims,
	runAuthConformanceMatrix,
} from "./browser-use-auth-conformance";
import {
	type BrowserAdapterId,
	BROWSER_USE_LIVE_ADAPTERS,
} from "./discovery-model";
import {
	BROWSER_USE_TASK_INTENT_DEFINITIONS,
	BROWSER_USE_TERMINAL_RUN_STATES,
	type BrowserUseCancellationReport,
	type BrowserUseCallerMetadata,
	type BrowserUseRunState,
	type BrowserUseRunStructuredResult,
	type BrowserUseSharedRun,
	type BrowserUseTaskIntent,
	classifyCancellation,
	revalidateAuthAttestation,
} from "./browser-use-run-model";
import { createBrowserUseAuthContract } from "./browser-use-auth";
import { BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE } from "./browser-use-auth-model";
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
	stripControlChars,
	stringField,
	targetEnvelopeIdOf,
	truncateText,
} from "./browser-use-core";
import {
	AUTH_TOKEN_FORBIDDEN_ENV_KEYS,
	AUTH_TOKEN_SOURCE_RELOAD_OWNER_TIMEOUT_MS,
	type AuthTokenSupervisorInput,
	type BrowserUseRuntime,
	createProductionBrowserUseRuntime as createProductionBrowserUseRuntimeInternal,
	isAuthTokenSourceReference,
	readBoundedAuthChildOutput,
	resolveWarmChromeProfilePath,
} from "./browser-use-runtime";
import { retryabilityForRecoverability } from "./runtime-error-retryability";
import {
	type BrowserUsePathRefusal,
	inspectBrowserUsePaths,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	type LeaseWriteClaim,
	acquireLease,
	heartbeatLease,
	listLeases,
	releaseLease,
	withActivationEpochBarrier,
} from "./browser-use-locks";
import type {
	BrowserUseArtifactManifestPayload,
	BrowserUseLeasePayload,
} from "./browser-use-schemas";
import {
	artifactBytesPath,
	deleteArtifact,
	listPendingTombstones,
	readArtifactStatus,
	writeArtifactManifest,
} from "./browser-use-retention";
import type {
	BrowserUseMigrationFailure,
	BrowserUseMigrationState,
} from "./browser-use-migration-model";
import {
	BROWSER_USE_R3_CORPUS_BASELINE,
	applyBrowserUseMigration,
	inventoryBrowserUseMigration,
	planBrowserUseMigration,
	readBrowserUseMigrationStatus,
	verifyBrowserUseMigration,
} from "./browser-use-migration";
import {
	type RunResumeObservedIdentity,
	type RunStoreDeps,
	attestationByDigestFrom,
	casUpdateSharedRun,
	createSharedRun,
	leaseKeyForRun,
	listSharedRunReceipts,
	loadSharedRun,
	resumeSharedRun,
} from "./browser-use-runs";
import {
	type BrowserUseAuthProvider,
	createBrowserUseAuthProvider,
} from "./browser-use-auth-provider";
import type {
	BrowserUseAuthContext,
	BrowserUseItemBinding,
} from "./browser-use-auth-bindings";
import {
	type BrowserUseCdpObserverRequest,
	createBrowserUseCdpObserver,
} from "./browser-use-cdp-observer";
import {
	listOrphanTempFiles,
	readDurableFile,
	removeOrphanTempFiles,
} from "./browser-use-store";
import {
	type HandoffFacts,
	parseHandoffFacts,
	readHandoffFacts,
	runTargetsList,
} from "./browser-use-discovery";
import {
	type AgentBrowserExecutionResult,
	type AgentBrowserTargetResolutionResult,
	type AgentBrowserTask,
	type AgentBrowserVerifiedHandoff,
	executeAgentBrowserTask,
	resolveAgentBrowserTaskTarget,
} from "./browser-use-agent-browser";
import { semanticClickInputIsValid } from "./browser-use-agent-browser-semantics";
import {
	type ChromeTask,
	type ChromeTaskArtifact,
	type ChromeTaskExecutionResult,
	type ChromeTaskIntent,
	compileChromeOperationSet,
	executeChromeTask,
} from "./browser-use-chrome-task";
import {
	type PlaywrightTask,
	type PlaywrightTaskIntent,
	type PlaywrightTaskResult,
	executePlaywrightTask,
} from "./browser-use-playwright-task";
import {
	type BrowserUseRunbookAuthDelivery,
	type BrowserUseRunbookExecutionResult,
	executePreparedRunbook,
	listRunbooks,
	prepareRunbookExecution,
	readPrivateStructuredInput,
	showRunbook,
} from "./browser-use-runbook";
import { runBrowserUseRunbookAuth } from "./browser-use-runbook-auth";
import { loadPrivateRunbookCatalogFromGit } from "./browser-use-private-runbook-catalog";
import {
	applyRunbookDraft,
	deleteRunbookDraft,
	parseRunbookDraftDocument,
	readRunbookSourceCatalog,
	runbookAuthoringSchema,
	validateRunbookDraftForSource,
} from "./browser-use-runbook-authoring";
import {
	applyReviewedActionCandidate,
	type BrowserUseAuthoredReviewedActionRecord,
	parseReviewedActionCandidate,
	readReviewedActionSourceState,
	reviewedActionAuthoringSchema,
	validateReviewedActionCandidate,
	verifyAuthoredReviewedActionPromotion,
} from "./browser-use-reviewed-action-authoring";
import {
	createNativeReviewedActionOperatorBroker,
	runReviewedActionPromotionFrontDoor,
} from "./browser-use-reviewed-action-promotion";
import {
	activateRunbookGeneration,
	createSelectedGenerationActionSeam,
	createSelectedGenerationRunbookSeam,
	projectRunbookGenerationSynchronization,
	resolveRetainedRunbookGeneration,
	resolveSelectedRunbookGeneration,
	withRunbookGenerationSelectionBarrier,
} from "./browser-use-runbook-generation";
import { itemKeySequenceDigest, normalizedInputDigest } from "./browser-use-runbook-actions";
import {
	type BrowserUseRunbook,
	type BrowserUseRunbookCatalogRow,
	type BrowserUseRunbookInputs,
	nextRunbookStepAfterExecution,
	projectRunbookCatalogRow,
} from "./browser-use-runbook-model";
import {
	type BrowserUseGovernedSurface,
	type BrowserUseSensitiveRunGuard,
	assertContainmentBeforeRelease,
	beginSensitiveRunGuard,
	markRunSensitive,
} from "./browser-use-sensitive-run";
import { deriveSentinelSet } from "./browser-use-secret-scan";
import type { BrowserUseArtifactReference } from "./browser-use-run-model";
import {
	type TaskRunRoutingRefusal,
	routeTaskRun,
} from "./browser-use-task-run";
import {
	runTargetsSelect,
	runTargetsStatus,
} from "./browser-use-selection";
import {
	captureBrowserUseScreenshotMedia,
	runOperate,
} from "./browser-use-operations";
import {
	type ParsedBrowserUseCommand,
	applyEnvRunId,
	errorOutputMode,
	parseBrowserUseArgv,
	parsedRunIdFlag,
	renderHelp,
	renderLauncher,
	writeVersion,
} from "./browser-use-parser";
import { renderGuide } from "./browser-use-guide";

// ---------------------------------------------------------------------------
// CLI driver. Mirrors browser-adapter-router.ts structure.
// ---------------------------------------------------------------------------

/**
 * Non-authority inputs admitted by production composition.
 *
 * Authority ports stay available only through test helpers. Production may
 * select its process environment and setup-admitted source checkout, but it
 * cannot replace credential, approval, native-admission, or identity-proof
 * owners.
 */
export type BrowserUseProductionRuntimeOptions = {
	/** Process environment consumed as data by production-owned adapters. */
	env?: Record<string, string | undefined>;
	/** Setup-admitted source root; null models a packaged installation. */
	sourceCheckoutRoot?: string | null;
};

/**
 * Compose the production runtime without accepting injectable authority.
 *
 * @param options - Explicit non-authority production inputs
 * @returns Runtime backed only by production-owned authority discovery
 */
export async function createProductionBrowserUseRuntime(
	options: BrowserUseProductionRuntimeOptions = {},
): Promise<BrowserUseRuntime> {
	return await createProductionBrowserUseRuntimeInternal({
		...(options.env === undefined ? {} : { env: options.env }),
		...(options.sourceCheckoutRoot === undefined
			? {}
			: { sourceCheckoutRoot: options.sourceCheckoutRoot }),
	});
}

export async function runBrowserUseCli(
	argv: readonly string[],
	options: {
		runtime?: BrowserUseRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
		authDoctor?: AuthDoctorOrchestrationDeps;
	} = {},
): Promise<number> {
	const runtime =
		options.runtime ?? (await createProductionBrowserUseRuntime());
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
	let fixScope: AuthDoctorFixScope;
	try {
		const fixRequest = extractAuthDoctorFixRequest(diagnosticArgv.argv);
		fixScope = fixRequest.fixScope;
		parsed = parseBrowserUseArgv(fixRequest.argv);
		if (fixRequest.fixScope !== undefined && parsed.kind === "command") {
			parsed = {
				...parsed,
				flagValues: {
					...parsed.flagValues,
					"--fix": "",
				},
			};
		}
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
	if (parsed.kind === "launcher") {
		stdout.write(renderLauncher());
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
					...(fixScope === undefined ? {} : { fixScope }),
					...(options.authDoctor === undefined
						? {}
						: { authDoctor: options.authDoctor }),
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

type AuthDoctorFixScope = "all" | "profile" | undefined;

function extractAuthDoctorFixRequest(argv: readonly string[]): {
	argv: readonly string[];
	fixScope: AuthDoctorFixScope;
} {
	if (argv[0] !== "auth" || argv[1] !== "doctor") {
		return { argv, fixScope: undefined };
	}
	const stripped = [...argv];
	const fixIndexes: number[] = [];
	let inlineFix = false;
	for (let index = 2; index < stripped.length; index += 1) {
		if (stripped[index] === "--caller") {
			index += 1;
			continue;
		}
		if (stripped[index] === "--fix") fixIndexes.push(index);
		if (stripped[index]?.startsWith("--fix=") === true) inlineFix = true;
	}
	if (fixIndexes.length === 0) {
		if (inlineFix) {
			throw usageError("--fix does not take a value; use optional profile after it.");
		}
		return { argv, fixScope: undefined };
	}
	if (fixIndexes.length !== 1) throw usageError("--fix may be supplied once.");
	const index = fixIndexes[0] ?? -1;
	stripped.splice(index, 1);
	const profileOnly = stripped[index] === "profile";
	if (profileOnly) stripped.splice(index, 1);
	return { argv: stripped, fixScope: profileOnly ? "profile" : "all" };
}

// One family -> result kind mapping for the mock/not-implemented envelopes.
const RESULT_KIND_BY_FAMILY: Record<BrowserUseFamily, ResultKind> = {
	// guide-show is a pure bundled-content render and never reaches the mock or
	// not-implemented envelope paths; the entry exists for type completeness.
	guide: "guide",
	targets: "browser_targets",
	operate: "browser_operation",
	task: "task_intents",
	lanes: "adapter_lanes",
	run: "shared_run",
	runbook: "runbook_catalog",
	action: "reviewed_action",
	migration: "migration_status",
	artifact: "artifact_manifest",
	repair: "repair_status",
	auth: "auth_readiness",
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
	fixScope?: AuthDoctorFixScope;
	authDoctor?: AuthDoctorOrchestrationDeps;
}): Promise<number> {
	const { parsed, runtime } = input;
	// Version-matched bundled guidance (D3): a pure render of the guide content
	// module. Plain by default (prose for an agent to read); --json wraps the
	// same text in the standard success envelope for machine consumers.
	if (parsed.command === "guide-show") {
		const topic = (stringField(parsed.flagValues["--topic"]) ??
			"core") as BrowserUseGuideTopic;
		const guide = renderGuide(topic, parsed.flagValues["--full"] !== undefined);
		if (parsed.outputMode === "json") {
			writeJsonEnvelope(
				input.stdout,
				createCliRuntimeSuccessEnvelope({
					run_id: input.runId,
					data: { result_kind: "guide", topic, guide },
				}),
				{ runId: input.runId, durationMs: input.durationMs() },
			);
			return 0;
		}
		input.stdout.write(guide);
		return 0;
	}
	// `task run` and `runbook run` return the shared-run contract, not the family
	// default catalog; every other command keys resultKind off its family.
	const resultKind: ResultKind =
		parsed.command === "task-run" || parsed.command === "runbook-run"
			? "shared_run"
			: RESULT_KIND_BY_FAMILY[parsed.family];
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

	// Wave-2 task run front door (release contract R6-R11, R23; flows F1, F7):
	// route -> create/resume the durable shared run -> attach through the verified
	// handoff -> dispatch to the selected lane -> record evidence -> return
	// result + observed external-effect state + selected lane + next safe action.
	if (parsed.command === "task-run" && !parsed.dryRun) {
		return runTaskRun({
			parsed,
			runtime,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			caller,
			durationMs: input.durationMs,
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

	if (parsed.family === "action" && !parsed.dryRun) {
		const actionInput: PlatformCommandInput = {
			parsed,
			runtime,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			caller,
			durationMs: input.durationMs,
		};
		if (runtime.reviewedActionApprovalVerifierIssue !== undefined) {
			return emitReviewedActionFailure(
				actionInput,
				runtime.reviewedActionApprovalVerifierIssue.code,
				runtime.reviewedActionApprovalVerifierIssue.message,
			);
		}
		return runReviewedActionCommand(actionInput);
	}

	// Browser Runbook family (platform plan U4): list/show project the discovered
	// runbook catalog and one validated definition; run compiles a runbook and
	// dispatches it through the agent-browser lane via the shared run-store
	// pipeline. Live from U4 — runbooks no longer fall through to the
	// not-implemented shell.
	if (parsed.family === "runbook" && !parsed.dryRun) {
		const runbookInput: PlatformCommandInput = {
			parsed,
			runtime,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			caller,
			durationMs: input.durationMs,
		};
		if (runtime.reviewedActionApprovalVerifierIssue !== undefined) {
			return emitPlatformStoreFailure(runbookInput, {
				code: runtime.reviewedActionApprovalVerifierIssue.code,
				message: runtime.reviewedActionApprovalVerifierIssue.message,
				actionId: "activate_runbook_catalog",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			});
		}
		if (
			parsed.command === "runbook-schema" ||
			parsed.command === "runbook-validate" ||
			parsed.command === "runbook-apply" ||
			parsed.command === "runbook-delete"
		) return runRunbookAuthoringCommand(runbookInput);
		if (parsed.command === "runbook-list") return runRunbookList(runbookInput);
		if (parsed.command === "runbook-show") return runRunbookShow(runbookInput);
		if (parsed.command === "runbook-activate") return runRunbookActivate(runbookInput);
		return runRunbookRun(runbookInput);
	}

	// Platform store-backed commands (platform plan U2): run/artifact/repair
	// inspection over the durable XDG substrate. Dry-run keeps its existing
	// mock envelope below (run resume/cancel already reject --dry-run at the
	// parser since the flag is undeclared). The migration family is live from U3
	// below; the runbook family is live from U4 above.
	if (
		(parsed.command === "run-status" ||
			parsed.command === "run-resume" ||
			parsed.command === "run-approve" ||
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
		if (parsed.command === "run-approve") return runRunApprove(platformInput);
		if (parsed.command === "run-cancel") return runRunCancel(platformInput);
		if (parsed.command === "artifact-list") return runArtifactList(platformInput);
		if (parsed.command === "repair-status") return runRepairStatus(platformInput);
		return runRepairApply(platformInput);
	}

	// Clean-break migration commands (platform plan U3): status projects the
	// standing migration state; inventory/plan/apply/verify drive the engine
	// phases against one --source root over the durable store. Live from U3 —
	// migration no longer falls through to the not-implemented shell.
	if (parsed.family === "migration") {
		return runMigration({
			parsed,
			runtime,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			caller,
			durationMs: input.durationMs,
		});
	}

	// Auth repair continuations plus ADR 0030 environment-token lifecycle.
	if (
		parsed.family === "auth" &&
		!parsed.dryRun
	) {
		if (
			parsed.subcommand === "install-token" ||
			parsed.subcommand === "remove-token" ||
			parsed.subcommand === "status" ||
			parsed.subcommand === "doctor" ||
			parsed.subcommand === "reload"
		) {
			return runAuthTokenLifecycle({
				parsed,
				runtime,
				stdout: input.stdout,
				stderr: input.stderr,
				runId: input.runId,
				caller,
				durationMs: input.durationMs,
				...(input.fixScope === undefined
					? {}
					: { fixScope: input.fixScope }),
				...(input.authDoctor === undefined
					? {}
					: { authDoctor: input.authDoctor }),
			});
		}
		return runAuthReadiness({
			parsed,
			runtime,
			stdout: input.stdout,
			stderr: input.stderr,
			runId: input.runId,
			caller,
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

// Freshness window the CLI stamps onto the auth-conformance evidence it derives
// from the matrix (well within the registry's TTL ceiling). The matrix is
// recomputed each invocation from the same epoch, so probed_at == atEpochMs and
// the window only bounds staleness for a persisted registry, never this
// per-invocation projection.
const AUTH_CONFORMANCE_EVIDENCE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

// A stable conformance-suite Implementation-integrity identity per lane. The
// auth-conformance producer is the suite itself (a pure contract-level engine),
// not a live adapter binary, so its identity is a fixed suite identity — every
// field a non-empty string as the registry's admission requires. When live
// conformance later binds to a real adapter build, this derives from that build.
function authConformanceSuiteIntegrity(laneId: string) {
	return {
		executable_realpath: "auth-conformance-suite",
		content_digest: `auth-conformance-suite:${laneId}`,
		dependency_lock_identity: "auth-conformance-suite",
		protocol_fingerprint: "auth-conformance-suite",
		platform: "conformance-harness",
		security_policy_revision: "conformance-1",
	};
}

// Build the auth-conformance evidence references the CLI publishes into the
// lane registry (auth plan U9, R22; release L190). Steps per the wiring spec:
// run the matrix, compute each lane's conformant auth-method claims, and — only
// when a lane has at least one proven claim — construct one auth-conformance
// evidence reference bound to a suite integrity identity with a recomputed
// digest. Because every DELIVERY cell stays `unproven` at contract level today,
// claims is [] for every lane, so this yields an empty array and `lanes list`
// keeps advertising advertised_auth_methods=none honestly. The registry gates
// auth methods on an implemented lane, so this never fabricates a method — it
// only projects what the matrix actually proved once live conformance flips a
// delivery cell to conformant.
function composedLaneAuthConformanceEvidence(
	atEpochMs: number,
): BrowserUseLaneEvidenceReference[] {
	const matrix = runAuthConformanceMatrix({ at_epoch_ms: atEpochMs });
	const references: BrowserUseLaneEvidenceReference[] = [];
	for (const laneId of BROWSER_USE_ADAPTER_LANE_IDS) {
		const claims = conformanceEvidenceClaims(matrix, laneId);
		if (claims.length === 0) continue;
		const base = {
			lane_id: laneId,
			evidence_class: "auth-conformance" as const,
			producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS["auth-conformance"],
			claims,
			integrity: authConformanceSuiteIntegrity(laneId),
			probed_at_epoch_ms: atEpochMs,
			stale_after_ms: AUTH_CONFORMANCE_EVIDENCE_STALE_AFTER_MS,
		};
		references.push({ ...base, evidence_digest: laneEvidenceDigestOf(base) });
	}
	return references;
}

// Compose the baseline registry the CLI projects (auth plan U1, U9). The task
// and connection evidence producers register through the library Interface, not
// the CLI, so those slots stay unproven here; the CLI itself owns the
// auth-conformance publication by projecting the code-owned conformance matrix
// (composedLaneAuthConformanceEvidence). A composition failure here is a
// programming error, not a user state.
function composedLaneRegistry(atEpochMs: number) {
	const result = createAdapterLaneRegistry({
		evidence: composedLaneAuthConformanceEvidence(atEpochMs),
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
	fixScope?: AuthDoctorFixScope;
	authDoctor?: AuthDoctorOrchestrationDeps;
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

type BrowserUseSharedRunCliProjection = Omit<
	BrowserUseSharedRun,
	"auth_fragment" | "runbook_target_binding"
> & {
	runbook_target?: {
		bound: true;
		mode: "exact" | "automatic";
		schema_version: "1";
	};
};

// The auth fragment and opaque binding stay private. Public target state exposes
// only the bounded lifecycle facts agents need to choose a safe next action.
function projectRunForCli(
	run: BrowserUseSharedRun,
): BrowserUseSharedRunCliProjection {
	const {
		auth_fragment: _fragment,
		runbook_target_binding: _targetBinding,
		...projection
	} = run;
	return {
		...projection,
		...(run.runbook_target_binding !== undefined
			? {
					runbook_target: {
						bound: true as const,
						mode: run.runbook_target_binding.mode,
						schema_version: run.runbook_target_binding.schema_version,
					},
				}
			: {}),
	};
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

const RUNBOOK_DISPATCH_LEASE_TTL_MS = 600_000;
const RUNBOOK_DISPATCH_HEARTBEAT_INTERVAL_MS =
	RUNBOOK_DISPATCH_LEASE_TTL_MS / 3;

function startRunbookDispatchLeaseHeartbeat(
	deps: RunStoreDeps,
	lease: BrowserUseLeasePayload,
): {
	failure: () => PlatformStoreFailure | undefined;
	stop: () => Promise<BrowserUseLeasePayload>;
} {
	let currentLease = lease;
	let failure: PlatformStoreFailure | undefined;
	let stopRequested = false;
	let wake: (() => void) | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const completed = (async () => {
		while (!stopRequested) {
			await new Promise<void>((resolve) => {
				const finishWait = () => {
					if (timer !== undefined) clearTimeout(timer);
					timer = undefined;
					wake = undefined;
					resolve();
				};
				wake = finishWait;
				timer = setTimeout(
					finishWait,
					RUNBOOK_DISPATCH_HEARTBEAT_INTERVAL_MS,
				);
			});
			if (stopRequested) break;
			const renewed = await heartbeatLease(deps, currentLease, {
				ttlMs: RUNBOOK_DISPATCH_LEASE_TTL_MS,
			});
			if (!renewed.ok) {
				const message =
					"message" in renewed
						? renewed.message
						: renewed.continuation.summary;
				failure = platformStoreFailureOf(renewed.code, message);
				break;
			}
			currentLease = renewed.lease;
		}
	})();
	return {
		failure: () => failure,
		stop: async () => {
			stopRequested = true;
			wake?.();
			await completed;
			return currentLease;
		},
	};
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
	run: BrowserUseSharedRunCliProjection,
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
			...(run.runbook_target !== undefined
				? [
						`target_bound=${run.runbook_target.bound}`,
						`target_mode=${run.runbook_target.mode}`,
						`target_schema=${run.runbook_target.schema_version}`,
					]
				: []),
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
	for (const approval of run.approvals ?? []) {
		stdout.write(
			`approval=${approval.continuation_id} artifact=${approval.artifact_id} approved_at=${approval.approved_at_epoch_ms}\n`,
		);
	}
	for (const result of run.structured_results ?? []) {
		stdout.write(
			result.ok
				? `structured_result=${result.action_id} item=${result.item_key ?? "none"} ok=true digest=${result.outcome.result_digest}\n`
				: `structured_result=${result.action_id} item=${result.item_key ?? "none"} ok=false code=${result.refusal.code}\n`,
		);
	}
}

function platformPlainHeader(
	contract: string,
	caller: BrowserUseCallerMetadata,
	extra: readonly string[] = [],
): string {
	const schema =
		contract === BROWSER_USE_SHARED_RUN_CONTRACT_ID
			? BROWSER_USE_SHARED_RUN_SCHEMA_VERSION
			: PLATFORM_STORE_SCHEMA_VERSION;
	return (
		[
			`contract=${contract}`,
			`schema=${schema}`,
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
				schema_version: BROWSER_USE_SHARED_RUN_SCHEMA_VERSION,
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
					schema_version: BROWSER_USE_SHARED_RUN_SCHEMA_VERSION,
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

/** Record explicit operator approval without dispatching any browser action. */
async function runRunApprove(input: PlatformCommandInput): Promise<number> {
	const store = await openPlatformStore(input, "write");
	if (!store.ok) return store.exitCode;
	const runId = stringField(input.parsed.flagValues["--run"]) ?? "";
	const continuationId =
		stringField(input.parsed.flagValues["--continuation"]) ?? "";
	const artifactId = stringField(input.parsed.flagValues["--artifact"]) ?? "";
	const loaded = await loadSharedRun(store.deps, runId);
	if (!loaded.ok) {
		return emitPlatformStoreFailure(
			input,
			platformStoreFailureOf(loaded.code, loaded.message),
		);
	}
	if (
		loaded.run.state !== "awaiting-approval" ||
		loaded.run.continuation?.next_action_id !== "complete-submit-approval" ||
		continuationId !== loaded.run.continuation.next_action_id
	) {
		return emitPlatformStoreFailure(input, {
			code: "run_approval_continuation_mismatch",
			message:
				"the run is not waiting on the exact submit-approval continuation supplied by the operator.",
			actionId: "inspect_shared_run",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	if (!loaded.run.artifacts.some((artifact) => artifact.artifact_id === artifactId)) {
		return emitPlatformStoreFailure(input, {
			code: "run_approval_artifact_mismatch",
			message:
				"the supplied review artifact is not attached to this awaiting-approval run.",
			actionId: "inspect_shared_run",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	const approvalArtifact = await readArtifactStatus(store.deps, {
		runId,
		artifactId,
	});
	if (approvalArtifact.status !== "present") {
		return emitPlatformStoreFailure(input, {
			code: "run_approval_artifact_unavailable",
			message:
				"the supplied review artifact bytes are not present; approval was refused.",
			actionId: "inspect_shared_run",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
		});
	}
	const approvedAt = input.runtime.now();
	const updated = await persistRunbookPrivateState(
		store.deps,
		loaded.run,
		(current) => {
			const { continuation: _continuation, ...rest } = current;
			const progress = current.runbook_progress;
			return {
				...rest,
				state: "running",
				...(progress === undefined
					? {}
					: {
							runbook_progress: {
								...progress,
								next_step: progress.next_step + 1,
							},
						}),
				approvals: [
					...(current.approvals ?? []),
					{
						continuation_id: continuationId,
						artifact_id: artifactId,
						approved_at_epoch_ms: approvedAt,
					},
				],
			};
		},
		undefined,
		"record",
	);
	if (!updated.ok) return emitPlatformStoreFailure(input, updated.failure);
	return emitSharedRunSuccess({
		command: input,
		run: updated.run,
		continuationId: "resume_runbook_execution",
		dataExtra: {
			approval: {
				continuation_id: continuationId,
				artifact_id: artifactId,
				approved_at_epoch_ms: approvedAt,
			},
		},
		plainExtra: ["approval=recorded", `artifact=${artifactId}`],
	});
}

/**
 * `run cancel` (R37, AE15). A pre-dispatch run becomes terminal
 * `not-achieved`; a dispatched run refuses because external write truth may
 * be unresolved. `rolled_back` is ALWAYS the literal false. Cancelling an
 * already-terminal run is an idempotent projection of the standing truth:
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
	const cancellationExtra = (
		outcome: "cancelled" | "already-terminal",
		report: BrowserUseCancellationReport,
	) => ({
		dataExtra: { cancellation: { outcome, ...report } },
		plainExtra: [
			`cancellation=${outcome}`,
			`external_effect=${report.external_effect}`,
			`rolled_back=${report.rolled_back}`,
		],
	});
	if (isTerminalRunState(loaded.run.state)) {
		return emitSharedRunSuccess({
			command: input,
			run: loaded.run,
			continuationId: "inspect_shared_run",
			...cancellationExtra("already-terminal", {
				external_effect: "none",
				rolled_back: false,
			}),
		});
	}
	const classification = classifyCancellation(loaded.run);
	if (!classification.ok) {
		return emitPlatformStoreFailure(input, {
			code: classification.code,
			message: `run ${loaded.run.run_id}: ${classification.message}`,
			actionId: "inspect_shared_run",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
		});
	}
	const { report } = classification;
	const targetState: BrowserUseRunState = "not-achieved";
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
			authFragmentAction: "cancel",
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
		...cancellationExtra("cancelled", report),
	});
}

// ---------------------------------------------------------------------------
// Wave-2 task run front door (release contract R6-R11, R23; flows F1, F7).
//
// The driver seam of `browser-use task run`: it opens the durable store, reads
// the Verified Handoff Envelope, resolves the intent, routes to one admissible
// lane through the PURE routing engine (browser-use-task-run.ts), creates or
// resumes the shared run, dispatches to the selected lane's execution
// interface, records the terminal/blocked truth on the run, and returns the
// shared run + observed external-effect state + selected lane + next safe
// action. No lane is ever substituted (R10, R11); an unknown external effect is
// terminal and blocks retry/adapter switch (R26, F7).
// ---------------------------------------------------------------------------

const taskRunActions = [
	...browserUseTaskRunFailureActions,
	...browserUseTaskRunSuccessActions,
] as const;
const taskRunActionById = new Map<string, (typeof taskRunActions)[number]>(
	taskRunActions.map((action) => [action.id, action]),
);
type TaskRunActionId = (typeof taskRunActions)[number]["id"];

function taskRunAction(id: TaskRunActionId): RuntimeActionGuidance {
	return actionFor(taskRunActionById, id, "task run");
}

// One typed task-run failure: diagnostic code, redaction-safe message, the
// exactly-one continuation, exit code, and recoverability. Failure ids are
// always task-run failure actions so the facade continuation/actions pairing
// holds; a refused route or unknown effect NEVER carries a retry action.
type TaskRunFailure = {
	code: string;
	message: string;
	actionId: TaskRunActionId;
	exitCode: number;
	recoverability: RuntimeErrorRecoverability;
	dataExtra?: Record<string, unknown>;
};

// Map one PURE routing refusal onto the driver's typed diagnostic + continuation
// (R27: the engine names the class, the driver owns the exit code + action id).
function taskRunFailureOfRoutingRefusal(
	refusal: TaskRunRoutingRefusal,
): TaskRunFailure {
	switch (refusal.code) {
		case "intent_unknown":
			return {
				code: "task_run_intent_unknown",
				message: refusal.message,
				actionId: "choose_registered_intent",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			};
		case "intent_unrouted":
			return {
				code: "task_run_intent_unrouted",
				message: refusal.message,
				actionId: "await_intent_lane",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none",
			};
		case "lane_override_inadmissible":
			return {
				code: "task_run_lane_override_inadmissible",
				message: refusal.message,
				actionId: "choose_admissible_lane",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			};
		case "no_admissible_lane":
			return {
				code: "task_run_no_admissible_lane",
				message: refusal.message,
				actionId: "refresh_lane_evidence",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			};
		case "handoff_lane_mismatch":
			return {
				code: "task_run_handoff_lane_mismatch",
				message: refusal.message,
				actionId: "supply_matching_handoff",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			};
		case "lane_not_installed":
			return {
				code: "task_run_lane_not_installed",
				message: refusal.message,
				actionId: "install_lane_adapter",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			};
	}
}

// Emit one typed task-run failure envelope (JSON) or line (plain). Mirrors the
// platform-store failure emitter so both surfaces carry the same envelope shape.
function emitTaskRunFailure(
	input: PlatformCommandInput,
	runIdForData: string | undefined,
	failure: TaskRunFailure,
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
				result_kind: "shared_run",
				...(runIdForData !== undefined ? { run_id: runIdForData } : {}),
				...(failure.dataExtra ?? {}),
				caller: input.caller,
			},
			runtime_actions: [taskRunAction(failure.actionId)],
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

// Capability coverage over the code-owned per-adapter operation table (R6): the
// pure routing engine takes this so it never imports the lane table directly.
function laneCapabilityCovers(
	lane: { lane_id: keyof typeof BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES },
	capability: string,
): boolean {
	const capabilities = BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES[lane.lane_id];
	return (capabilities as readonly string[]).includes(capability);
}

const SAFE_POSTCONDITION_ID = /^[A-Za-z0-9._-]{1,128}$/;

type TaskRunSemanticClick = {
	role: string;
	name: string;
	postconditionId: string;
	visibleSelector: string;
};

// Compile the public task-run semantic input once so target admission and
// execution prove the same exact step sequence.
function baselineAgentBrowserSteps(
	semanticClick: TaskRunSemanticClick | undefined,
): AgentBrowserTask["steps"] {
	return [
		{ kind: "snapshot", interactive: true },
		...(semanticClick === undefined
			? []
			: [
					{
						kind: "click-semantic" as const,
						role: semanticClick.role,
						name: semanticClick.name,
						postcondition: {
							kind: "element-visible" as const,
							selector: semanticClick.visibleSelector,
						},
					},
				]),
	];
}

// The Agent Browser task the front door dispatches for a routed intent (F1):
// one fresh interactive snapshot, optionally followed by one semantic click
// resolved from that snapshot and one structural postcondition. Raw refs never
// cross the public task-run boundary.
function baselineAgentBrowserTask(input: {
	handoff: HandoffFacts;
	rawHandoff: unknown;
	runId: string;
	targetTabId: string;
	expectedTargetUrl?: string;
	allowedOrigin: string;
	steps: AgentBrowserTask["steps"];
}): AgentBrowserTask {
	return {
		// The executor re-validates the handoff shape itself; the driver passes the
		// verbatim envelope payload it already parsed.
		handoff: input.rawHandoff as AgentBrowserTask["handoff"],
		run_id: input.runId,
		target_tab_id: input.targetTabId,
		...(input.expectedTargetUrl !== undefined
			? { expected_target_url: input.expectedTargetUrl }
			: {}),
		allowed_origins: [input.allowedOrigin],
		steps: input.steps,
	};
}

// The read-only baseline task the front door dispatches for a routed chrome
// intent (F6, R21, R23; AE9): the operation set is COMPILED from the routed
// intent by browser-use-chrome-task.ts's owner (debug -> console+network,
// performance-profile -> trace artifact, lighthouse-audit -> insight artifact)
// rather than a hardcoded console-read. Only debug/performance-profile/
// lighthouse-audit route to this lane (BROWSER_USE_TASK_INTENT_DEFINITIONS
// preferred_adapter), so the `as ChromeTaskIntent` narrowing is safe — a
// non-chrome intent never reaches here. No caller-supplied reload/insightName is
// threaded yet, so the compiler's defaults (reload=true, insightName=LCPBreakdown)
// apply. The executor re-validates its own schema-2 / chrome-devtools-mcp handoff
// guard, so the driver passes the verbatim envelope payload it already parsed.
// artifact_dir is set only for artifact-producing intents; debug compiles to
// console+network (no artifact op) and needs none.
function baselineChromeTask(input: {
	rawHandoff: unknown;
	runId: string;
	pageId: number;
	allowedOrigin: string;
	intent: BrowserUseTaskIntent;
	artifactDir?: string;
}): ChromeTask {
	return {
		handoff: input.rawHandoff as ChromeTask["handoff"],
		run_id: input.runId,
		target_page_id: input.pageId,
		allowed_origins: [input.allowedOrigin],
		operations: compileChromeOperationSet(input.intent as ChromeTaskIntent),
		...(input.artifactDir !== undefined
			? { artifact_dir: input.artifactDir }
			: {}),
	};
}

// The first Playwright CLI vertical slice: frontend and locator/ARIA intents
// attach to the verified endpoint, select one numeric tab, capture a fresh
// accessibility snapshot, prove its exact origin, and detach. Trace inspection
// and HTTP replay remain outside admission until their artifact/input contracts
// exist, so they cannot reach this narrowing.
function baselinePlaywrightTask(input: {
	rawHandoff: unknown;
	runId: string;
	tabIndex: number;
	allowedOrigin: string;
	intent: BrowserUseTaskIntent;
	semanticClick?: TaskRunSemanticClick;
}): PlaywrightTask {
	return {
		handoff: input.rawHandoff as PlaywrightTask["handoff"],
		run_id: input.runId,
		target_tab_index: input.tabIndex,
		allowed_origins: [input.allowedOrigin],
		intent: input.intent as PlaywrightTaskIntent,
		...(input.semanticClick !== undefined
			? {
					mutation: {
						role: input.semanticClick.role,
						name: input.semanticClick.name,
						visible_selector: input.semanticClick.visibleSelector,
					},
				}
			: {}),
	};
}

function mapPlaywrightOutcome(
	result: PlaywrightTaskResult,
): AgentBrowserDispatchMapping {
	if (result.ok) {
		return {
			kind: "confirmed",
			executedSteps: result.executed_commands,
			mutationDispatched: result.mutation_dispatched,
		};
	}
	if (result.code === "playwright_task_connection_unstable") {
		return {
			kind: "blocked",
			state: "needs-human",
			continuation: {
				next_action_id: "resume_shared_run",
				summary:
					"Re-mint a verified playwright-cdp handoff, then resume the same run.",
			},
			mutationDispatched: result.mutation_dispatched,
			failure: {
				code: "task_run_connection_unstable",
				message: result.message,
				actionId: "resume_shared_run",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "retry",
				dataExtra: { lane_outcome: result.code },
			},
		};
	}
	if (result.outcome === "unknown") {
		return {
			kind: "terminal",
			state: "unknown",
			mutationDispatched: result.mutation_dispatched,
			failure: {
				code: "task_run_effect_unknown",
				message: result.message,
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none",
				dataExtra: { lane_outcome: result.code },
			},
		};
	}
	const isRefusal =
		result.code === "playwright_task_handoff_invalid" ||
		result.code === "playwright_task_input_invalid" ||
		result.code === "playwright_task_origin_refused" ||
		result.code === "playwright_task_ref_invalid" ||
		result.code === "playwright_task_mutation_marker_unavailable";
	return {
		kind: "terminal",
		state: "not-achieved",
		mutationDispatched: result.mutation_dispatched,
		failure: {
			code: isRefusal ? "task_run_lane_refused" : "task_run_not_achieved",
			message: result.message,
			actionId: "inspect_task_run_result",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "none",
			dataExtra: { lane_outcome: result.code },
		},
	};
}

// Map a chrome-devtools-mcp executor outcome onto the SHARED dispatch mapping
// (reusing AgentBrowserDispatchMapping so both lanes flow through the one
// recordTaskRunOutcome persistence pipeline). Every chrome operation in this
// lane is read-only, so `outcome === "unknown"` never occurs — but it is
// handled defensively as unknown terminal (blocking retry/adapter-switch).
// Lane refusals (handoff/task invalid, origin refused, artifact-dir required,
// operation unknown) map to task_run_lane_refused; target-unavailable and
// command-failed map to task_run_not_achieved; connection instability blocks
// with the executor's own repair continuation.
function mapChromeOutcome(
	result: ChromeTaskExecutionResult,
): AgentBrowserDispatchMapping {
	if (result.ok) {
		return { kind: "confirmed", executedSteps: result.executed_operations };
	}
	if (result.code === "chrome_task_connection_unstable") {
		const repair =
			result.connection?.next_repair_action ??
			"Re-mint a Verified Handoff Envelope through browser-connect connect chrome-devtools-mcp --json, then resume.";
		return {
			kind: "blocked",
			state: "needs-human",
			continuation: {
				next_action_id: "resume_shared_run",
				summary: repair,
			},
			failure: {
				code: "task_run_connection_unstable",
				message: result.message,
				actionId: "resume_shared_run",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "retry",
				dataExtra: {
					lane_outcome: result.code,
					...(result.connection !== undefined
						? { connection: result.connection }
						: {}),
				},
			},
		};
	}
	if (result.outcome === "unknown") {
		return {
			kind: "terminal",
			state: "unknown",
			failure: {
				code: "task_run_effect_unknown",
				message: result.message,
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none",
				dataExtra: { lane_outcome: result.code },
			},
		};
	}
	const isRefusal =
		result.code === "chrome_task_handoff_invalid" ||
		result.code === "chrome_task_invalid" ||
		result.code === "chrome_task_target_origin_refused" ||
		result.code === "chrome_task_artifact_dir_required" ||
		result.code === "chrome_task_operation_unknown";
	return {
		kind: "terminal",
		state: "not-achieved",
		failure: {
			code: isRefusal ? "task_run_lane_refused" : "task_run_not_achieved",
			message: result.message,
			actionId: "inspect_task_run_result",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "none",
			dataExtra: { lane_outcome: result.code },
		},
	};
}

// Project the chrome executor's native artifact references (R21) onto the shared
// run's artifact-reference shape: artifact_id from the path basename, sensitivity
// verbatim, retention "export" (explicit perf/Lighthouse artifacts transfer out
// of default retention). Only a confirmed run carries artifacts.
function chromeArtifactReferences(
	result: ChromeTaskExecutionResult,
): readonly BrowserUseArtifactReference[] {
	if (!result.ok) return [];
	return result.artifacts.map((artifact: ChromeTaskArtifact) => ({
		artifact_id: artifact.path.slice(artifact.path.lastIndexOf("/") + 1),
		sensitivity: artifact.sensitivity,
		retention: "export" as const,
	}));
}

// Derive a bounded base36 run-scoped sentinel nonce (auth plan U4): a
// deterministic, distinctive per-run token the sentinel owner folds into every
// derived marker so two runs never collide on a sentinel. Only [0-9a-z] appears
// (SAFE_NONCE in browser-use-secret-scan), and it is length-bounded — a run id
// is already a bounded safe identifier, so hashing it to base36 and truncating
// keeps the nonce inside the sentinel owner's accepted range.
function runScopedSentinelNonce(runId: string): string {
	return createHash("sha256")
		.update(runId)
		.digest("hex")
		.split("")
		.map((c) => Number.parseInt(c, 16).toString(36))
		.join("")
		.slice(0, 32);
}

// The guard outcome for one dispatch: `ok: true` threads the guard (sensitive
// when delivery evidence engaged, the untouched baseline otherwise); `ok: false`
// means confidential delivery ENGAGED but its containment sentinels could not be
// registered — the caller must withhold release, never proceed unguarded.
type DeliveryGuardOutcome =
	| { ok: true; guard: BrowserUseSensitiveRunGuard | undefined }
	| {
			ok: false;
			reason:
				| "guard_unavailable"
				| "sentinel_derivation_failed"
				| "sensitive_mark_failed";
	  };

// When an agent-browser (or runbook) dispatch engaged confidential delivery, the
// run turns sensitive exactly once (auth plan U4/U5, DO#2): derive the sentinel
// set from the delivered field shapes under the run-scoped nonce and mark the
// guard. Delivery evidence is read REGARDLESS of the task's terminal truth — a
// delivery followed by a later failure already put the secret on the page, so
// the failure result carries the same evidence slot. A non-delivery result
// leaves the baseline guard untouched. A missing guard or a derivation/mark
// rejection after a delivery is a typed `ok: false` — the call sites translate
// it into a withheld task-run failure so a run whose sentinels could not be
// registered is never released.
function markGuardForDeliveryOutcome(
	baseGuard: BrowserUseSensitiveRunGuard | undefined,
	result: AgentBrowserExecutionResult,
): DeliveryGuardOutcome {
	if (result.delivery === undefined) return { ok: true, guard: baseGuard };
	if (baseGuard === undefined) {
		return { ok: false, reason: "guard_unavailable" };
	}
	const set = deriveSentinelSet(
		result.delivery.resume.delivered_shapes,
		runScopedSentinelNonce(baseGuard.run_id),
	);
	if (!set.ok) return { ok: false, reason: "sentinel_derivation_failed" };
	const marked = markRunSensitive(baseGuard, {
		trigger: "confidential-field-delivery",
		sentinels: set.sentinels,
	});
	if (!marked.ok) return { ok: false, reason: "sensitive_mark_failed" };
	return { ok: true, guard: marked.guard };
}

// Fail-closed translation of a `DeliveryGuardOutcome` refusal (auth plan U4):
// confidential delivery engaged but the run's containment sentinels could not be
// registered, so no governed surface may be released. The typed failure names
// the cause and preserves a repair path; it carries no adapter or page text, so
// it is secret-free by construction.
function sentinelRegistrationWithheldFailure(
	reason: Extract<DeliveryGuardOutcome, { ok: false }>["reason"],
): TaskRunFailure {
	return {
		code: "task_run_lane_refused",
		message: `confidential delivery engaged but containment sentinels could not be registered (${reason}); governed outputs were withheld and the run was not released.`,
		actionId: "inspect_task_run_result",
		exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
		recoverability: "repair_state",
	};
}

// Map an agent-browser executor outcome onto the shared-run terminal/blocked
// truth plus the driver's typed failure taxonomy (F7): confirmed -> confirmed
// terminal; connection instability -> blocked + next-safe-action carrying the
// diagnostic; unknown effect -> unknown terminal blocking retry/adapter-switch;
// not-achieved / lane refusal -> not-achieved terminal.
type AgentBrowserDispatchMapping =
	| {
			kind: "confirmed";
			executedSteps: number;
			mutationDispatched?: boolean;
	  }
	| {
			kind: "blocked";
			state: BrowserUseRunState;
			continuation: { next_action_id: string; summary: string };
			failure: TaskRunFailure;
			mutationDispatched?: boolean;
	  }
	| {
			kind: "terminal";
			state: BrowserUseRunState;
			failure: TaskRunFailure;
			mutationDispatched?: boolean;
	  };

function mapAgentBrowserOutcome(
	result: AgentBrowserExecutionResult,
): AgentBrowserDispatchMapping {
	if (result.ok) {
		return {
			kind: "confirmed",
			executedSteps: result.executed_steps,
			mutationDispatched: result.mutation_dispatched,
		};
	}
	if (result.code === "agent_browser_connection_unstable") {
		const repair =
			result.connection?.next_repair_action ??
			"Re-mint a Verified Handoff Envelope through browser-connect connect --json for the agent-browser lane, then resume.";
		return {
			kind: "blocked",
			state: "needs-human",
			continuation: {
				next_action_id: "resume_shared_run",
				summary: repair,
			},
			mutationDispatched: result.mutation_dispatched,
			failure: {
				code: "task_run_connection_unstable",
				message: result.message,
				actionId: "resume_shared_run",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "retry",
				dataExtra: {
					lane_outcome: result.code,
					...(result.connection !== undefined
						? { connection: result.connection }
						: {}),
				},
			},
		};
	}
	if (result.outcome === "unknown") {
		return {
			kind: "terminal",
			state: "unknown",
			mutationDispatched: result.mutation_dispatched,
			failure: {
				code: "task_run_effect_unknown",
				message: result.message,
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none",
				dataExtra: { lane_outcome: result.code },
			},
		};
	}
	// Remaining ok:false outcomes are not-achieved: a refused task input (invalid
	// task, refused origin, confidential input without the auth transaction) or an
	// unmet postcondition. Both are not-achieved terminal truth.
	const isRefusal =
		result.code === "agent_browser_handoff_invalid" ||
		result.code === "agent_browser_task_invalid" ||
		result.code === "agent_browser_target_origin_refused" ||
		result.code === "agent_browser_confidential_input_requires_auth_transaction" ||
		result.code === "agent_browser_confidential_delivery_blocked" ||
			result.code === "agent_browser_action_integrity_refused" ||
			result.code === "agent_browser_action_target_refused" ||
			result.code === "agent_browser_mutation_marker_unavailable" ||
			result.code === "agent_browser_current_snapshot_required" ||
		result.code === "agent_browser_ref_invalid";
	return {
		kind: "terminal",
		state: "not-achieved",
		mutationDispatched: result.mutation_dispatched,
		failure: {
			code: isRefusal ? "task_run_lane_refused" : "task_run_not_achieved",
			message: result.message,
			actionId: "inspect_task_run_result",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "none",
			dataExtra: { lane_outcome: result.code },
		},
	};
}

function runbookTargetRepairMapping(
	result: Extract<AgentBrowserTargetResolutionResult, { ok: false }>,
): AgentBrowserDispatchMapping {
	return {
		kind: "blocked",
		state: "needs-human",
		continuation: {
			next_action_id: "restore_bound_runbook_target",
			summary:
				"Restore the exact tab bound to this run, then resume with the same verified handoff; otherwise start a new run.",
		},
		mutationDispatched: result.mutation_dispatched,
		failure: {
			code: result.code,
			message: result.message,
			actionId: "restore_bound_runbook_target",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
			dataExtra: {
				lane_outcome: result.code,
				external_effect: "none",
			},
		},
	};
}

function mapRunbookAgentBrowserOutcome(
	result: AgentBrowserExecutionResult,
): AgentBrowserDispatchMapping {
	if (
		!result.ok &&
		(result.code === "agent_browser_target_unavailable" ||
			result.code === "agent_browser_target_ambiguous" ||
			result.code === "agent_browser_target_moved")
	) {
		return runbookTargetRepairMapping(result);
	}
	return mapAgentBrowserOutcome(result);
}

/**
 * `task run` (release contract R6-R11, R23; flows F1, F7). Routes one Task
 * Intent (or resumes an existing run) to an admissible lane, attaches through
 * the verified Browser Connect handoff, dispatches the read-only baseline task,
 * records the run's terminal/blocked truth, and returns the shared run plus the
 * observed external-effect state, selected lane, and next safe action.
 *
 * @param input - Store-backed command input plus explicit-run-id awareness
 * @returns Process exit code
 */
// R3: the handoff is the only attachment route for task and runbook execution.
// ONE shared acquisition + validation sequence (CodeRabbit PR 263: the earlier
// per-command copies drifted on resume semantics): caller-managed --handoff
// (advanced/back-compat) or the internal in-process mint (design brief D4). A
// mint failure IS browser-connect's failure envelope, surfaced verbatim with
// its exit code — one Repair Path, no re-wrapping. Validation is the single
// parseHandoffFacts path; the raw payload re-parses from the SAME in-memory
// bytes for the executor's own schema-2 guard. Resume-requires-handoff is
// enforced uniformly at the parser for both commands, so it needs no flag here.
async function acquireVerifiedHandoff(input: {
	command: PlatformCommandInput;
	/** Adapter to mint for when --handoff is absent; undefined fails typed. */
	mintAdapterId: string | undefined;
	/** Failure-message subject: "a task" | "a runbook". */
	subject: string;
}): Promise<
	| { ok: true; handoff: HandoffFacts; rawHandoffData: unknown }
	| { ok: false; exitCode: number }
> {
	const command = input.command;
	const flags = command.parsed.flagValues;
	const fail = (message: string): { ok: false; exitCode: number } => ({
		ok: false,
		exitCode: emitTaskRunFailure(command, undefined, {
			code: "task_run_handoff_lane_mismatch",
			message,
			actionId: "supply_matching_handoff",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		}),
	});
	const handoffPath = stringField(flags["--handoff"]);
	let handoffRaw: string;
	if (handoffPath === undefined) {
		if (input.mintAdapterId === undefined) {
			return fail(
				"no adapter to attach: the intent has no registered preferred lane; pass --lane <id> or --handoff <path>.",
			);
		}
		const minted = await command.runtime.mintHandoff({
			adapterId: input.mintAdapterId,
			runId: command.runId,
		});
		if (minted.exitCode !== 0) {
			if (minted.stderr.length > 0) command.stderr.write(minted.stderr);
			if (minted.stdout.length > 0) command.stdout.write(minted.stdout);
			return { ok: false, exitCode: minted.exitCode };
		}
		handoffRaw = minted.stdout;
	} else {
		try {
			handoffRaw = await command.runtime.readTextFile(handoffPath);
		} catch {
			return fail("the --handoff file could not be read");
		}
	}
	const parse = parseHandoffFacts(handoffRaw);
	if (!parse.ok) return fail(parse.failure.message);
	if (parse.kind !== "verified") {
		return fail(
			`the supplied handoff is a connect-failure envelope, not a verified attachment; mint a verified handoff before running ${input.subject}.`,
		);
	}
	let rawHandoffData: unknown;
	try {
		rawHandoffData = (JSON.parse(handoffRaw) as { data?: unknown }).data;
	} catch {
		rawHandoffData = undefined;
	}
	return { ok: true, handoff: parse.facts, rawHandoffData };
}

async function runTaskRun(input: PlatformCommandInput): Promise<number> {
	const flags = input.parsed.flagValues;

	// Fresh --intent runs mint for the --lane override, else the intent's
	// preferred adapter (D4); acquisition + validation live in the shared
	// acquireVerifiedHandoff sequence.
	const acquired = await acquireVerifiedHandoff({
		command: input,
		mintAdapterId:
			stringField(flags["--lane"]) ??
			BROWSER_USE_TASK_INTENT_DEFINITIONS.find(
				(definition) =>
					definition.task_intent === stringField(flags["--intent"]),
			)?.preferred_adapter,
		subject: "a task",
	});
	if (!acquired.ok) return acquired.exitCode;
	const handoff = acquired.handoff;
	const rawHandoffData = acquired.rawHandoffData;

	const store = await openPlatformStore(input, "write");
	if (!store.ok) return store.exitCode;

	const runFlag = stringField(flags["--run"]);
	const requestedTabId = stringField(flags["--tab"]);
	const allowedOrigin = stringField(flags["--allowed-origin"]);

	// Resolve the run to route: an existing run to resume (R23) loads and re-proves
	// its own intent so a lane switch across a pause is impossible (R11); a fresh
	// run needs a supplied intent.
	let existingRun: BrowserUseSharedRun | undefined;
	let intent: BrowserUseTaskIntent;
	if (runFlag !== undefined) {
		const loaded = await loadSharedRun(store.deps, runFlag);
		if (!loaded.ok) {
			return emitPlatformStoreFailure(
				input,
				platformStoreFailureOf(loaded.code, loaded.message),
			);
		}
		if (isTerminalRunState(loaded.run.state)) {
			return emitTaskRunFailure(input, loaded.run.run_id, {
				code: "task_run_effect_unknown",
				message: `run ${loaded.run.run_id} holds terminal truth ${loaded.run.state}; terminal truth never re-enters execution.`,
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none",
			});
		}
		existingRun = loaded.run;
		intent = loaded.run.task_intent;
	} else {
		intent = stringField(flags["--intent"]) as BrowserUseTaskIntent;
	}

	// Route (R6, R10, R11) through the pure engine. A resumed run re-routes on its
	// own intent; a lane override is honored only for a fresh run (a resume stays
	// on the run's bound lane).
	const routed = routeTaskRun({
		intent,
		registry: composedLaneRegistry(input.runtime.now()),
		handoffAdapter: handoff.adapter,
		...(stringField(flags["--lane"]) !== undefined && existingRun === undefined
			? { laneOverride: stringField(flags["--lane"]) }
			: {}),
		capabilityCovers: laneCapabilityCovers,
	});
	if (!routed.ok) {
		return emitTaskRunFailure(
			input,
			runFlag,
			taskRunFailureOfRoutingRefusal(routed.refusal),
		);
	}
	const route = routed.route;

	const clickRole = stringField(flags["--click-role"]);
	const clickName = stringField(flags["--click-name"]);
	const postconditionId = stringField(flags["--postcondition-id"]);
	const visibleSelector = stringField(flags["--expect-visible"]);
	const semanticClickValues = [
		clickRole,
		clickName,
		postconditionId,
		visibleSelector,
	];
	const hasSemanticClick = semanticClickValues.some(
		(value) => value !== undefined,
	);
	let semanticClick: TaskRunSemanticClick | undefined;
	if (hasSemanticClick) {
		if (semanticClickValues.some((value) => value === undefined)) {
			return emitTaskRunFailure(input, existingRun?.run_id ?? runFlag, {
				code: "task_run_lane_refused",
				message:
					"semantic click requires --click-role, --click-name, --postcondition-id, and --expect-visible together.",
				actionId: "change_task_run_input",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			});
		}
		if (
			existingRun !== undefined ||
			!(
				(route.lane_id === "agent-browser" &&
					intent === "routine-automation") ||
				(route.lane_id === "playwright-cdp" &&
					(intent === "frontend-test" ||
						intent === "locator-aria-assertion"))
			)
		) {
			return emitTaskRunFailure(input, existingRun?.run_id ?? runFlag, {
				code: "task_run_lane_refused",
				message:
					"semantic click is available only on a fresh mutation-capable run routed to agent-browser or playwright-cdp.",
				actionId: "change_task_run_input",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			});
		}
		if (
			!semanticClickInputIsValid({
				role: clickRole ?? "",
				name: clickName ?? "",
				visibleSelector: visibleSelector ?? "",
			}) ||
			!SAFE_POSTCONDITION_ID.test(postconditionId ?? "")
		) {
			return emitTaskRunFailure(input, runFlag, {
				code: "task_run_lane_refused",
				message:
					"semantic click role, name, postcondition id, and visible selector must be bounded safe values.",
				actionId: "change_task_run_input",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			});
		}
		semanticClick = {
			role: clickRole ?? "",
			name: clickName ?? "",
			postconditionId: postconditionId ?? "",
			visibleSelector: visibleSelector ?? "",
		};
	}

	// Validate lane inputs BEFORE binding the durable run. A usage error must
	// never create (or poison) a shared run keyed on the handoff's run id: the
	// caller corrects the flag and retries with the SAME handoff, so a run
	// persisted here would make every retry a store_record_conflict and orphan a
	// stray `running` run in the store.
	//
	// An intent requiring an allowed origin cannot dispatch without one; the
	// baseline snapshot task needs an origin to bound the executor (R6).
	if (allowedOrigin === undefined) {
		return emitTaskRunFailure(input, existingRun?.run_id ?? runFlag, {
			code: "task_run_lane_refused",
			message:
				"the selected lane task requires --allowed-origin <origin> to bound execution to one exact HTTP(S) origin.",
			actionId: "change_task_run_input",
			exitCode: USAGE_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	// A numeric page id is required on the chrome lane: chrome-devtools-mcp keys
	// pages by the numeric ordering from list_pages, not a string tab id. --tab
	// must parse to a non-negative integer; default 0 (the first/selected page).
	let numericTabIndex: number | undefined;
	if (
		route.lane_id === "chrome-devtools-mcp" ||
		route.lane_id === "playwright-cdp"
	) {
		numericTabIndex = parseTabPageId(stringField(flags["--tab"]));
		if (numericTabIndex === undefined) {
			return emitTaskRunFailure(input, existingRun?.run_id ?? runFlag, {
				code: "task_run_lane_refused",
				message: `the ${route.lane_id} lane addresses pages by numeric index; pass --tab <non-negative integer> (default 0).`,
				actionId: "change_task_run_input",
				exitCode: USAGE_EXIT_CODE,
				recoverability: "change_input",
			});
		}
	}

	// Bind the run: resume the existing one (proving same-lane, same-profile,
	// R28/R11) or create a fresh one now that routing admitted the lane (R23).
	let run: BrowserUseSharedRun;
	if (existingRun !== undefined) {
		const check = checkSameLaneResumeForTaskRun(
			existingRun,
			route.lane_id,
			handoff,
		);
		if (check !== undefined) {
			return emitTaskRunFailure(input, existingRun.run_id, check);
		}
		run = existingRun;
	} else {
		// The durable shared run id is the handoff's run id — the one id that
		// threads discovery, selection, and this run (R23), so the run correlates
		// to the exact verified attachment. A duplicate create against the same
		// handoff surfaces as a typed store conflict, never a silent second run.
		const created = await createSharedRun(store.deps, {
			run_id: handoff.runId,
			state: "running",
			task_intent: intent,
			environment_profile: {
				environment: handoff.environmentName,
				profile: handoff.environmentProfile,
			},
			adapter_id: route.lane_id,
			handoff_evidence_id: handoff.handoffEvidenceId,
			...(semanticClick !== undefined
				? {
						postcondition: {
							id: semanticClick.postconditionId,
							summary: "The declared element is visible after mutation.",
						},
					}
				: {}),
			mutation_dispatched: false,
			artifacts: [],
		});
		if (!created.ok) {
			return emitPlatformStoreFailure(
				input,
				platformStoreFailureOf(created.code, created.message),
			);
		}
		run = created.run;
	}

	// Sensitive Run Guard (auth plan U4): attach once per run just after the run
	// is resolved/created. The run stays non-sensitive until confidential
	// delivery participates (out of this unit's scope: the Confidential Field
	// Delivery Helper calls markRunSensitive at its own seam). The guard threads
	// through to recordTaskRunOutcome, which asserts containment before releasing
	// any governed surface once the run has turned sensitive.
	const guardResult = beginSensitiveRunGuard(run.run_id);
	const taskRunGuard: BrowserUseSensitiveRunGuard | undefined = guardResult.ok
		? guardResult.guard
		: undefined;

	// Dispatch to the selected lane's execution interface. agent-browser runs a
	// fresh snapshot and may resolve one semantic click with a named structural
	// postcondition; chrome-devtools-mcp runs a read-only debugging/performance
	// baseline through its envelope-derived executor; playwright-cdp attaches to
	// a numeric tab index, enforces the allowed origin, and runs the intent via
	// baselinePlaywrightTask.
	if (route.lane_id === "agent-browser") {
		const steps = baselineAgentBrowserSteps(semanticClick);
		let targetTabId = requestedTabId;
		let expectedTargetUrl: string | undefined;
		if (targetTabId === undefined) {
			const targetEnvelopeId = targetEnvelopeIdOf({
				runId: run.run_id,
				mode: "handoff-bound",
				adapter: "agent-browser",
				handoffEvidenceId: handoff.handoffEvidenceId,
			});
			const targetResolution = await resolveAgentBrowserTaskTarget(
				{ runCommand: input.runtime.runCommand },
				{
					handoff: rawHandoffData as AgentBrowserVerifiedHandoff,
					run_id: run.run_id,
					allowed_origins: [allowedOrigin],
					steps,
					target: { kind: "auto", target_envelope_id: targetEnvelopeId },
				},
			);
			if (!targetResolution.ok) {
				return await recordTaskRunOutcome(
					input,
					store.deps,
					run,
					route,
					mapAgentBrowserOutcome(targetResolution),
					{
						...(taskRunGuard !== undefined ? { guard: taskRunGuard } : {}),
					},
				);
			}
			targetTabId = targetResolution.target_tab_id;
			expectedTargetUrl = targetResolution.target_url;
		}
		let dispatchRun = run;
		let mutationMarkerFailure: PlatformStoreFailure | undefined;
		const result = await executeAgentBrowserTask(
			{
				runCommand: input.runtime.runCommand,
				beforeMutationDispatch: async ({ run_id }) => {
					if (run_id !== dispatchRun.run_id) return { ok: false };
					const marked = await persistTaskRunMutationDispatch(
						store.deps,
						dispatchRun,
					);
					if (!marked.ok) {
						mutationMarkerFailure = marked.failure;
						return { ok: false };
					}
					dispatchRun = marked.run;
					return { ok: true };
				},
			},
			baselineAgentBrowserTask({
				handoff,
				rawHandoff: rawHandoffData,
				runId: run.run_id,
				targetTabId,
				...(expectedTargetUrl !== undefined ? { expectedTargetUrl } : {}),
				allowedOrigin,
				steps,
			}),
		);
		if (mutationMarkerFailure !== undefined) {
			return emitPlatformStoreFailure(input, mutationMarkerFailure);
		}
		// If confidential delivery engaged in this dispatch, the run turns
		// sensitive exactly once (auth plan U4/U5); the sensitive guard threads
		// into recordTaskRunOutcome's release gate. The baseline snapshot task
		// carries no auth-delivery context, so this is the baseline guard until a
		// confidential runbook/task supplies one. A delivery whose sentinels could
		// not be registered withholds release (fail closed), never runs ungated.
		const dispatchGuard = markGuardForDeliveryOutcome(taskRunGuard, result);
		if (!dispatchGuard.ok) {
			return emitTaskRunFailure(
				input,
				run.run_id,
				sentinelRegistrationWithheldFailure(dispatchGuard.reason),
			);
		}
		return await recordTaskRunOutcome(
			input,
			store.deps,
			dispatchRun,
			route,
			mapAgentBrowserOutcome(result),
			{
				...(dispatchGuard.guard !== undefined
					? { guard: dispatchGuard.guard }
					: {}),
			},
		);
	}

	if (route.lane_id === "chrome-devtools-mcp") {
		// The page id was validated before the run was bound; the ?? 0 default can
		// never engage (parseTabPageId returned a number or the command already
		// refused), it only spares a non-null assertion.
		const pageId = numericTabIndex ?? 0;
		// Artifact-producing intents (performance-profile/lighthouse-audit) need a
		// run-scoped artifact directory created before dispatch (R21); the baseline
		// console-read intent produces no artifact and needs none.
		const producesArtifacts =
			route.intent === "performance-profile" ||
			route.intent === "lighthouse-audit";
		let artifactDir: string | undefined;
		if (producesArtifacts) {
			artifactDir = store.deps.paths.state.artifactDir(run.run_id);
			await input.runtime.ensureDirectory(artifactDir);
		}
		const result = await executeChromeTask(
			input.runtime,
			baselineChromeTask({
				rawHandoff: rawHandoffData,
				runId: run.run_id,
				pageId,
				allowedOrigin,
				intent: route.intent,
				...(artifactDir !== undefined ? { artifactDir } : {}),
			}),
		);
		return await recordTaskRunOutcome(
			input,
			store.deps,
			run,
			route,
			mapChromeOutcome(result),
			{
				artifacts: chromeArtifactReferences(result),
				...(taskRunGuard !== undefined ? { guard: taskRunGuard } : {}),
			},
		);
	}

	if (route.lane_id === "playwright-cdp") {
		let dispatchRun = run;
		let mutationMarkerFailure: PlatformStoreFailure | undefined;
		const result = await executePlaywrightTask(
			{
				runCommand: input.runtime.runCommand,
				beforeMutationDispatch: async ({ run_id }) => {
					if (run_id !== dispatchRun.run_id) return { ok: false };
					const marked = await persistTaskRunMutationDispatch(
						store.deps,
						dispatchRun,
					);
					if (!marked.ok) {
						mutationMarkerFailure = marked.failure;
						return { ok: false };
					}
					dispatchRun = marked.run;
					return { ok: true };
				},
			},
			baselinePlaywrightTask({
				rawHandoff: rawHandoffData,
				runId: run.run_id,
				tabIndex: numericTabIndex ?? 0,
				allowedOrigin,
				intent: route.intent,
				...(semanticClick !== undefined ? { semanticClick } : {}),
			}),
		);
		if (mutationMarkerFailure !== undefined) {
			return emitPlatformStoreFailure(input, mutationMarkerFailure);
		}
		return await recordTaskRunOutcome(
			input,
			store.deps,
			dispatchRun,
			route,
			mapPlaywrightOutcome(result),
			{
				...(taskRunGuard !== undefined ? { guard: taskRunGuard } : {}),
			},
		);
	}

	// Any future admitted lane without a task binding fails closed.
	return emitTaskRunFailure(input, run.run_id, {
		code: "task_run_dispatch_unavailable",
		message: `lane ${route.lane_id} routed and admitted, but no task-run dispatch binding is wired for its execution interface yet.`,
		actionId: "inspect_task_run_result",
		exitCode: RUNTIME_FAILURE_EXIT_CODE,
		recoverability: "none",
		dataExtra: { selected_lane: route.lane_id },
	});
}

// Parse the --tab flag as a chrome page id: a non-negative integer, or 0 by
// default. Returns undefined for a non-integer/negative value so the caller
// fails closed rather than defaulting a malformed id to page 0.
function parseTabPageId(raw: string | undefined): number | undefined {
	if (raw === undefined) return 0;
	if (!/^\d+$/.test(raw)) return undefined;
	const value = Number(raw);
	return Number.isInteger(value) && value >= 0 ? value : undefined;
}

// Resume same-lane / same-profile gate for a task-run resume (R28, R11): the
// loaded run must already be bound to the routed lane and the handoff's
// environment/profile identity. A mismatch is a typed refusal, never a switch.
function checkSameLaneResumeForTaskRun(
	run: BrowserUseSharedRun,
	routedLaneId: string,
	handoff: HandoffFacts,
): TaskRunFailure | undefined {
	if (run.adapter_id !== undefined && run.adapter_id !== routedLaneId) {
		return {
			code: "task_run_handoff_lane_mismatch",
			message: `run ${run.run_id} is bound to lane ${run.adapter_id}; resume routed to ${routedLaneId}. browser-use never switches lanes mid-task.`,
			actionId: "supply_matching_handoff",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		};
	}
	if (
		run.environment_profile.environment !== handoff.environmentName ||
		run.environment_profile.profile !== handoff.environmentProfile
	) {
		return {
			code: "task_run_handoff_lane_mismatch",
			message: `run ${run.run_id} is bound to a different environment/profile identity; the supplied handoff proves a different one.`,
			actionId: "supply_matching_handoff",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		};
	}
	return undefined;
}

async function persistTaskRunMutationDispatch(
	deps: RunStoreDeps,
	run: BrowserUseSharedRun,
	heldClaim?: LeaseWriteClaim,
): Promise<
	| { ok: true; run: BrowserUseSharedRun }
	| { ok: false; failure: PlatformStoreFailure }
> {
	if (run.mutation_dispatched) return { ok: true, run };
	return persistFencedSharedRun(
		deps,
		run,
		`task-run-dispatch-${run.run_id}`,
		(current) => ({ ...current, mutation_dispatched: true }),
		heldClaim,
	);
}

async function persistRunbookMutationDispatch(
	deps: RunStoreDeps,
	run: BrowserUseSharedRun,
	atEpochMs: number,
	heldClaim: LeaseWriteClaim,
): Promise<
	| { ok: true; run: BrowserUseSharedRun }
	| { ok: false; failure: PlatformStoreFailure }
> {
	const approvals = run.approvals ?? [];
	const latestApproval = approvals.at(-1);
	if (latestApproval === undefined) {
		return await persistTaskRunMutationDispatch(deps, run, heldClaim);
	}
	if (latestApproval.dispatch_started_at_epoch_ms !== undefined) {
		return {
			ok: false,
			failure: {
				code: "run_approved_dispatch_already_started",
				message:
					"the approved submit dispatch already crossed write-ahead; inspect its outcome before any redispatch.",
				actionId: "inspect_shared_run",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none",
			},
		};
	}
	return await persistRunbookPrivateState(
		deps,
		run,
		(current) => ({
			...current,
			mutation_dispatched: true,
			approvals: (current.approvals ?? []).map((approval, index, currentApprovals) =>
				index === currentApprovals.length - 1
					? { ...approval, dispatch_started_at_epoch_ms: atEpochMs }
					: approval,
			),
		}),
		heldClaim,
		"mark-dispatch",
	);
}

async function persistFencedSharedRun(
	deps: RunStoreDeps,
	run: BrowserUseSharedRun,
	holderId: string,
	mutate: (current: BrowserUseSharedRun) => BrowserUseSharedRun,
	heldClaim?: LeaseWriteClaim,
	approvalAction?: "record" | "mark-dispatch",
): Promise<
	| { ok: true; run: BrowserUseSharedRun }
	| { ok: false; failure: PlatformStoreFailure }
> {
	if (heldClaim !== undefined) {
		const updated = await casUpdateSharedRun(deps, {
			runId: run.run_id,
			expectedRevision: run.revision,
			lease: heldClaim,
			mutate,
			...(approvalAction === undefined ? {} : { approvalAction }),
		});
		return updated.ok
			? { ok: true, run: updated.run }
			: {
					ok: false,
					failure: platformStoreFailureOf(updated.code, updated.message),
				};
	}
	const acquired = await acquireLease(deps, {
		key: leaseKeyForRun(run),
		holderId,
		ttlMs: 10_000,
	});
	if (!acquired.ok) {
		return {
			ok: false,
			failure: platformStoreFailureOf(
				acquired.code,
				acquired.code === "lease_held"
					? acquired.continuation.summary
					: acquired.message,
			),
		};
	}
	const claim = {
		fencing_token: acquired.lease.fencing_token,
		activation_epoch: acquired.lease.activation_epoch,
		holderId: acquired.lease.holder_id,
	};
	let updated: Awaited<ReturnType<typeof casUpdateSharedRun>>;
	try {
		updated = await casUpdateSharedRun(deps, {
			runId: run.run_id,
			expectedRevision: run.revision,
			lease: claim,
			mutate,
			...(approvalAction === undefined ? {} : { approvalAction }),
		});
	} finally {
		await releaseLease(deps, acquired.lease);
	}
	if (!updated.ok) {
		return {
			ok: false,
			failure: platformStoreFailureOf(updated.code, updated.message),
		};
	}
	return { ok: true, run: updated.run };
}

async function persistRunbookPrivateState(
	deps: RunStoreDeps,
	run: BrowserUseSharedRun,
	mutate: (current: BrowserUseSharedRun) => BrowserUseSharedRun,
	heldClaim?: LeaseWriteClaim,
	approvalAction?: "record" | "mark-dispatch",
): Promise<
	| { ok: true; run: BrowserUseSharedRun }
	| { ok: false; failure: PlatformStoreFailure }
> {
	return persistFencedSharedRun(
		deps,
		run,
		`runbook-state-${run.run_id}`,
		mutate,
		heldClaim,
		approvalAction,
	);
}

async function enterSubmitApprovalGate(input: {
	command: PlatformCommandInput;
	deps: RunStoreDeps;
	run: BrowserUseSharedRun;
	handoff: HandoffFacts;
	targetTabId: string;
	targetUrl: string;
	gateStepIndex: number;
	heldClaim: LeaseWriteClaim;
	structuredResults?: readonly BrowserUseRunStructuredResult[];
	guard?: BrowserUseSensitiveRunGuard;
}): Promise<number> {
	let checkpointedRun = input.run;
	if (checkpointedRun.runbook_progress?.next_step !== input.gateStepIndex) {
		const checkpointed = await persistRunbookPrivateState(
			input.deps,
			checkpointedRun,
			(current) => {
				const structuredResults = [
					...(current.structured_results ?? []),
					...(input.structuredResults ?? []),
				];
				return {
					...current,
					state: "running",
					runbook_progress:
						current.runbook_progress === undefined
							? undefined
							: {
									...current.runbook_progress,
									next_step: input.gateStepIndex,
								},
					...(structuredResults.length === 0
						? {}
						: { structured_results: structuredResults }),
				};
			},
			input.heldClaim,
		);
		if (!checkpointed.ok) {
			return emitPlatformStoreFailure(input.command, checkpointed.failure);
		}
		checkpointedRun = checkpointed.run;
	}

	let target: URL;
	try {
		target = new URL(input.targetUrl);
	} catch {
		return emitPlatformStoreFailure(input.command, {
			code: "run_approval_target_invalid",
			message: "the approval screenshot target is not a valid URL.",
			actionId: "inspect_shared_run",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
		});
	}
	if (target.protocol !== "https:" && target.protocol !== "http:") {
		return emitPlatformStoreFailure(input.command, {
			code: "run_approval_target_invalid",
			message: "the approval screenshot target is not an http(s) page.",
			actionId: "inspect_shared_run",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
		});
	}

	const artifactId = `submit-approval-${input.gateStepIndex}.png`;
	const existing = await readArtifactStatus(input.deps, {
		runId: checkpointedRun.run_id,
		artifactId,
	});
	if (existing.status === "corrupt" || existing.status === "deleted") {
		return emitPlatformStoreFailure(
			input.command,
			platformStoreFailureOf(
				"artifact_corrupt",
				"the approval screenshot artifact is unavailable; inspect retention state before approval.",
			),
		);
	}
	if (existing.status === "missing") {
		const artifactRoot = input.deps.paths.state.artifactDir(
			checkpointedRun.run_id,
		);
		const artifactPath = artifactBytesPath(
			input.deps.paths,
			checkpointedRun.run_id,
			artifactId,
		);
		const captured = await captureBrowserUseScreenshotMedia({
			runtime: input.command.runtime,
			handoff: input.handoff,
			adapterPageRef: input.targetTabId,
			artifact: {
				path: artifactPath,
				relativePath: artifactId,
				root: artifactRoot,
				format: "png",
				fullPage: true,
			},
		});
		if (!captured.ok) {
			return emitPlatformStoreFailure(
				input.command,
				platformStoreFailureOf(captured.code, captured.message),
			);
		}
		let contentHash: string;
		try {
			contentHash = await input.deps.fs.hashFile(artifactPath);
		} catch (error) {
			return emitPlatformStoreFailure(
				input.command,
				platformStoreFailureOf(
					"artifact_hash_failed",
					`the approval screenshot bytes could not be hashed (${platformErrorCode(error)}).`,
				),
			);
		}
		const manifest: BrowserUseArtifactManifestPayload = {
			artifact_id: artifactId,
			run_id: checkpointedRun.run_id,
			task_intent: "runbook-execution",
			adapter_id: input.handoff.adapter,
			adapter_version: "verified-handoff-v2",
			sanitized_target: {
				origin: target.origin,
				path_shape: target.pathname,
			},
			producer_capability: "screenshot_media",
			content_hash: contentHash,
			sensitivity: "high",
			retention: "ephemeral",
			outcome_ref: `approval:${checkpointedRun.run_id}`,
			created_at_epoch_ms: input.command.runtime.now(),
			export_receipt: null,
		};
		const written = await writeArtifactManifest(input.deps, manifest);
		if (!written.ok) {
			return emitPlatformStoreFailure(
				input.command,
				platformStoreFailureOf(written.code, written.message),
			);
		}
	}

	const blocked = BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["submit-approval-required"];
	const awaiting = await persistRunbookPrivateState(
		input.deps,
		checkpointedRun,
		(current) => ({
			...current,
			state: blocked.run_state,
			continuation: structuredClone(blocked.continuation),
			artifacts: current.artifacts.some(
				(artifact) => artifact.artifact_id === artifactId,
			)
				? current.artifacts
				: [
						...current.artifacts,
						{
							artifact_id: artifactId,
							sensitivity: "high",
							retention: "ephemeral",
						},
					],
		}),
		input.heldClaim,
	);
	if (!awaiting.ok) {
		return emitPlatformStoreFailure(input.command, awaiting.failure);
	}
	return await emitSubmitApprovalGate({
		command: input.command,
		deps: input.deps,
		run: awaiting.run,
		continuationId: blocked.continuation.next_action_id,
		artifactId,
		...(input.guard === undefined ? {} : { guard: input.guard }),
	});
}

async function emitSubmitApprovalGate(input: {
	command: PlatformCommandInput;
	deps: RunStoreDeps;
	run: BrowserUseSharedRun;
	continuationId: string;
	artifactId: string;
	guard?: BrowserUseSensitiveRunGuard;
}): Promise<number> {
	const emitApprovalGate = (target: PlatformCommandInput): number =>
		emitSharedRunSuccess({
			command: target,
			run: input.run,
			continuationId: input.continuationId,
			dataExtra: {
				approval_review: {
					artifact_id: input.artifactId,
					producer_capability: "screenshot_media",
				},
			},
			plainExtra: [
				`approval_artifact=${input.artifactId}`,
				"producer_capability=screenshot_media",
			],
		});
	if (input.guard?.sensitive) {
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];
		const exitCode = emitApprovalGate({
			...input.command,
			stdout: { write: (chunk: string) => stdoutChunks.push(chunk) },
			stderr: { write: (chunk: string) => stderrChunks.push(chunk) },
		});
		const release = assertContainmentBeforeRelease(input.guard, [
			...(await collectRunGovernedSurfaces(input.deps, input.run.run_id)),
			{
				kind: "stdout-envelope",
				label: `approval-gate-envelope:${input.run.run_id}`,
				content: stdoutChunks.join("") + stderrChunks.join(""),
			},
		]);
		if (!release.release) {
			return emitTaskRunFailure(input.command, input.run.run_id, {
				code: "task_run_lane_refused",
				message: `sensitive run containment failed (${release.reason}); approval outputs were withheld and a human repair path is preserved.`,
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			});
		}
		for (const chunk of stdoutChunks) input.command.stdout.write(chunk);
		for (const chunk of stderrChunks) input.command.stderr.write(chunk);
		return exitCode;
	}
	return emitApprovalGate(input.command);
}

// Persist the dispatch outcome onto the shared run (its terminal or blocked
// truth) and emit the shared-run envelope + observed external-effect state +
// selected lane + next safe action. The run write goes through the same fenced
// lease + CAS pipeline every durable run mutation uses (R13/R27).
async function recordTaskRunOutcome(
	input: PlatformCommandInput,
	deps: RunStoreDeps,
	run: BrowserUseSharedRun,
	route: { lane_id: BrowserAdapterId; source: string; intent: BrowserUseTaskIntent },
	mapping: AgentBrowserDispatchMapping,
	options: {
		artifacts?: readonly BrowserUseArtifactReference[];
		guard?: BrowserUseSensitiveRunGuard;
		runbookNextStep?: number;
		heldClaim?: LeaseWriteClaim;
		structuredResults?: readonly BrowserUseRunStructuredResult[];
	} = {},
): Promise<number> {
	const artifacts = options.artifacts ?? [];
	const structuredResults = options.structuredResults ?? [];
	const captureRefusal = structuredResults.find(
		(result): result is Extract<BrowserUseRunStructuredResult, { ok: false }> =>
			!result.ok,
	);
	const provenRunbookNextStep =
		captureRefusal === undefined ? options.runbookNextStep : undefined;
	const resolvedMapping: AgentBrowserDispatchMapping =
		captureRefusal !== undefined && mapping.kind === "confirmed"
			? {
					kind: "terminal",
					state: "not-achieved",
					mutationDispatched: mapping.mutationDispatched,
					failure: {
						code: "runbook_structured_result_refused",
						message: captureRefusal.refusal.message,
						actionId: "inspect_task_run_result",
						exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
						recoverability: "repair_state",
						dataExtra: {
							capture_refusal_code: captureRefusal.refusal.code,
						},
					},
				}
			: mapping;
	const targetState: BrowserUseRunState =
		resolvedMapping.kind === "confirmed" ? "confirmed" : resolvedMapping.state;
	// The lane reports write-ahead mutation truth separately from terminal
	// classification. A semantic target refusal leaves this false; confirmed,
	// unmet-postcondition, and verification-unavailable outcomes after dispatch
	// preserve true.
	const mutationDispatched = resolvedMapping.mutationDispatched ?? false;
	const continuation =
		resolvedMapping.kind === "blocked"
			? resolvedMapping.continuation
			: undefined;

	const updated = await persistFencedSharedRun(
		deps,
		run,
		`task-run-${run.run_id}`,
		(current) => {
				const { continuation: _prior, ...rest } = current;
				const progress =
					current.runbook_progress !== undefined &&
					provenRunbookNextStep !== undefined
						? {
								...current.runbook_progress,
								next_step: provenRunbookNextStep,
							}
						: current.runbook_progress;
				return {
					...rest,
					state: targetState,
					mutation_dispatched: current.mutation_dispatched || mutationDispatched,
					...(progress !== undefined ? { runbook_progress: progress } : {}),
					// Persist any native artifact references the lane produced (R21);
					// existing references survive so a resume never drops evidence.
					...(artifacts.length > 0
						? { artifacts: [...current.artifacts, ...artifacts] }
						: {}),
					...(structuredResults.length > 0
						? {
								structured_results: [
									...(current.structured_results ?? []),
									...structuredResults,
								],
							}
						: {}),
					...(continuation !== undefined ? { continuation } : {}),
				};
			},
		options.heldClaim,
	);
	if (!updated.ok) {
		return emitPlatformStoreFailure(input, updated.failure);
	}

	const externalEffect =
		mutationDispatched && targetState !== "confirmed" ? "unknown" : "none";
	const dataExtra: Record<string, unknown> = {
		selected_lane: route.lane_id,
		lane_source: route.source,
		external_effect: externalEffect,
		...(resolvedMapping.kind === "confirmed"
			? { executed_steps: resolvedMapping.executedSteps }
			: {}),
	};
	const plainExtra = [
		`selected_lane=${route.lane_id}`,
		`lane_source=${route.source}`,
		`external_effect=${externalEffect}`,
	];

	// The one pending stdout/stderr emission this outcome produces: the shared-run
	// success envelope, or the typed failure envelope merging the lane + effect
	// facts. Factored as a closure over a target writer pair so a sensitive run
	// can render the EXACT bytes into a capture buffer, sweep them, and only then
	// replay them onto the real streams.
	const emitOutcome = (target: PlatformCommandInput): number => {
		if (resolvedMapping.kind === "confirmed") {
			return emitSharedRunSuccess({
				command: target,
				run: updated.run,
				continuationId: "inspect_task_run_result",
				dataExtra,
				plainExtra,
			});
		}
		// A blocked or terminal dispatch is a typed failure envelope carrying the
		// run projection reference; the failure's own data extras merge in the lane
		// + effect facts so the caller sees the selected lane and observed effect.
		return emitTaskRunFailure(target, updated.run.run_id, {
			...resolvedMapping.failure,
			dataExtra: {
				...dataExtra,
				...(resolvedMapping.failure.dataExtra ?? {}),
			},
		});
	};

	// Sensitive Run Guard release gate (auth plan U4): once the run has turned
	// sensitive, no governed surface may be emitted until the containment sweep
	// proves clean over the on-disk run bytes (read back after commit) PLUS the
	// pending stdout/stderr envelope, captured byte-for-byte before release. An
	// ordinary (non-sensitive) run skips the gate and releases normally. A failed
	// sweep withholds every surface — including the pending envelope, which is
	// never written — and fails closed with a repair path preserved.
	if (options.guard !== undefined && options.guard.sensitive) {
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];
		const exitCode = emitOutcome({
			...input,
			stdout: { write: (chunk: string) => stdoutChunks.push(chunk) },
			stderr: { write: (chunk: string) => stderrChunks.push(chunk) },
		});
		const surfaces: BrowserUseGovernedSurface[] = [
			...(await collectRunGovernedSurfaces(deps, updated.run.run_id)),
			{
				kind: "stdout-envelope",
				label: `task-run-envelope:${updated.run.run_id}`,
				content: stdoutChunks.join("") + stderrChunks.join(""),
			},
		];
		const release = assertContainmentBeforeRelease(options.guard, surfaces);
		if (!release.release) {
			return emitTaskRunFailure(input, updated.run.run_id, {
				code: "task_run_lane_refused",
				message: `sensitive run containment failed (${release.reason}); outputs were withheld and a human repair path is preserved.`,
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			});
		}
		for (const chunk of stdoutChunks) input.stdout.write(chunk);
		for (const chunk of stderrChunks) input.stderr.write(chunk);
		return exitCode;
	}

	return emitOutcome(input);
}

// ---------------------------------------------------------------------------
// Browser Runbook family (platform plan 2026-07-21-002 U4, R30/R31/R35).
//
// list projects the discovered runbook catalog; show returns one validated
// definition + health; run compiles a runbook and dispatches it through the
// agent-browser lane using the SAME shared run-store pipeline task-run uses.
// The engine (browser-use-runbook.ts) owns discovery, validation, and the
// plan; this driver seam owns store I/O, handoff reads, and envelope emission.
// ---------------------------------------------------------------------------

type RunbookAuthoringCommandPayload = {
	command: string;
	result: unknown;
	caller: BrowserUseCallerMetadata;
};

function emitRunbookAuthoringSuccess(
	input: PlatformCommandInput,
	result: unknown,
): number {
	const payload: RunbookAuthoringCommandPayload = {
		command: input.parsed.command,
		result,
		caller: input.caller,
	};
	if (input.parsed.outputMode === "plain") {
		input.stdout.write(
			platformPlainHeader(
				BROWSER_USE_RUNBOOK_AUTHORING_CONTRACT_ID,
				input.caller,
				[`command=${input.parsed.command}`],
			),
		);
		input.stdout.write(`${JSON.stringify(result)}\n`);
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: createCommandResultData(
				browserUseContracts[input.parsed.command],
				payload,
			),
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return 0;
}

function emitRunbookAuthoringFailure(
	input: PlatformCommandInput,
	code: string,
	message: string,
	data: Record<string, unknown> = {},
): number {
	const safeMessage = redactUnsafeText(message);
	if (input.parsed.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${code}: ${safeMessage} (run_id=${input.runId})\n`,
		);
		return BINDING_FAIL_CLOSED_EXIT_CODE;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
			data: {
				command: input.parsed.command,
				result_kind: RESULT_KIND_BY_FAMILY[input.parsed.family],
				caller: input.caller,
				...data,
			},
			error: createCliRuntimeError({
				run_id: input.runId,
				code,
				message: safeMessage,
				exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
				severity: "error",
				...retryabilityForRecoverability(
					code.endsWith("_stale") ? "change_input" : "repair_state",
				),
				failure_domain: "browser_use",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return BINDING_FAIL_CLOSED_EXIT_CODE;
}

async function readRunbookDocumentFile(
	input: PlatformCommandInput,
): Promise<{ ok: true; bytes: string } | { ok: false; exitCode: number }> {
	try {
		return {
			ok: true,
			bytes: await input.runtime.readTextFile(
				stringField(input.parsed.flagValues["--file"]) ?? "",
			),
		};
	} catch {
		return {
			ok: false,
			exitCode: emitRunbookAuthoringFailure(
				input,
				"runbook_document_unreadable",
				"the Runbook document file could not be read.",
			),
		};
	}
}

async function runRunbookAuthoringCommand(
	input: PlatformCommandInput,
): Promise<number> {
	if (input.parsed.command === "runbook-schema") {
		return emitRunbookAuthoringSuccess(input, runbookAuthoringSchema());
	}
	const sourceRoot = owningSourceCheckoutRoot(input.runtime);
	if (input.parsed.command === "runbook-delete") {
		if (sourceRoot === undefined) {
			return emitRunbookAuthoringFailure(
				input,
				"runbook_source_checkout_required",
				"packaged runtime cannot mutate private Runbook source; use the setup-owned source checkout front door.",
			);
		}
		const deleted = await deleteRunbookDraft({
			sourceRoot,
			serviceId: stringField(input.parsed.flagValues["--service"]) ?? "",
			flowId: stringField(input.parsed.flagValues["--flow"]) ?? "",
			...(stringField(input.parsed.flagValues["--expected-record-digest"]) === undefined
				? {}
				: {
						expectedRecordDigest: stringField(
							input.parsed.flagValues["--expected-record-digest"],
						) as string,
					}),
		});
		return deleted.ok
			? emitRunbookAuthoringSuccess(input, deleted)
			: emitRunbookAuthoringFailure(input, deleted.code, deleted.message, {
					...(deleted.current_record_digest === undefined
						? {}
						: { current_record_digest: deleted.current_record_digest }),
				});
	}
	if (input.parsed.command === "runbook-apply" && sourceRoot === undefined) {
		return emitRunbookAuthoringFailure(
			input,
			"runbook_source_checkout_required",
			"packaged runtime cannot mutate private Runbook source; use the setup-owned source checkout front door.",
		);
	}
	const loaded = await readRunbookDocumentFile(input);
	if (!loaded.ok) return loaded.exitCode;
	if (input.parsed.command === "runbook-validate") {
		const parsed = parseRunbookDraftDocument(loaded.bytes);
		if (!parsed.ok) {
			return emitRunbookAuthoringFailure(input, parsed.code, parsed.message, {
				issues: parsed.issues,
				repair: parsed.repair,
			});
		}
		const hasActions = parsed.runbook.steps.some(
			(step) => step.kind === "action" || step.kind === "iterate",
		);
		if (!hasActions) {
			return emitRunbookAuthoringSuccess(input, {
				ok: true,
				record_digest: parsed.record_digest,
			});
		}
		if (sourceRoot === undefined) {
			return emitRunbookAuthoringFailure(
				input,
				"runbook_source_checkout_required",
				"packaged validation cannot resolve the private Reviewed Action closure; use the setup-owned source checkout front door.",
			);
		}
		const validated = await validateRunbookDraftForSource({
			sourceRoot,
			bytes: loaded.bytes,
			...(input.runtime.reviewedActionApprovalVerifier === undefined
				? {}
				: { approvalVerifier: input.runtime.reviewedActionApprovalVerifier }),
		});
		return validated.ok
			? emitRunbookAuthoringSuccess(input, {
					ok: true,
					record_digest: validated.record_digest,
				})
			: emitRunbookAuthoringFailure(input, validated.code, validated.message);
	}
	const applied = await applyRunbookDraft({
		sourceRoot: sourceRoot as string,
		bytes: loaded.bytes,
		...(stringField(input.parsed.flagValues["--expected-record-digest"]) === undefined
			? {}
			: {
					expectedRecordDigest: stringField(
						input.parsed.flagValues["--expected-record-digest"],
					) as string,
				}),
		...(input.runtime.reviewedActionApprovalVerifier === undefined
			? {}
			: { approvalVerifier: input.runtime.reviewedActionApprovalVerifier }),
	});
	return applied.ok
		? emitRunbookAuthoringSuccess(input, applied)
		: emitRunbookAuthoringFailure(input, applied.code, applied.message, {
				...(applied.current_record_digest === undefined
					? {}
					: { current_record_digest: applied.current_record_digest }),
			});
}

function owningSourceCheckoutRoot(runtime: BrowserUseRuntime): string | undefined {
	if (runtime.sourceCheckoutRoot !== undefined) {
		return runtime.sourceCheckoutRoot === null
			? undefined
			: normalize(runtime.sourceCheckoutRoot);
	}
	const moduleDirectory = dirname(fileURLToPath(import.meta.url));
	if (basename(moduleDirectory) !== "src") return undefined;
	return normalize(join(moduleDirectory, "..", "..", ".."));
}

async function nonterminalMutationRunIds(
	deps: RunStoreDeps,
	_activeGenerationId: string | null,
): Promise<readonly string[]> {
	const stat = await deps.fs.lstat(deps.paths.state.runsDir);
	if (stat === undefined || stat.kind !== "directory") return [];
	const blockers: string[] = [];
	for (const runId of await deps.fs.readDirectory(deps.paths.state.runsDir)) {
		const loaded = await loadSharedRun(deps, runId);
		if (!loaded.ok) {
			blockers.push(runId);
			continue;
		}
		if (isTerminalRunState(loaded.run.state)) continue;
		if (loaded.run.mutation_dispatched) {
			blockers.push(runId);
			continue;
		}
		const binding = loaded.run.run_execution_binding;
		if (binding !== undefined) {
			const retained = await resolveRetainedRunbookGeneration(deps, binding);
			if (!retained.ok) {
				blockers.push(runId);
				continue;
			}
			const shown = await createSelectedGenerationRunbookSeam(deps, retained).loadRunbook({
				serviceId: binding.service_id,
				flowId: binding.flow_id,
			});
			if (!shown.ok || projectRunbookCatalogRow(shown.runbook, shown.health).effect_class === "mutation") blockers.push(runId);
			continue;
		}
		const progress = loaded.run.runbook_progress;
		if (progress === undefined) continue;
		const shown = await showRunbook(deps.fs, deps.paths.data.root, { serviceId: progress.service_id, flowId: progress.flow_id });
		if (!shown.ok || projectRunbookCatalogRow(shown.runbook, shown.health).effect_class === "mutation") blockers.push(runId);
	}
	return blockers.sort();
}



function emitReviewedActionSuccess(input: PlatformCommandInput, result: unknown): number {
	const payload: RunbookAuthoringCommandPayload = { command: input.parsed.command, result, caller: input.caller };
	if (input.parsed.outputMode === "plain") {
		input.stdout.write(platformPlainHeader(BROWSER_USE_REVIEWED_ACTION_AUTHORING_CONTRACT_ID, input.caller, [`command=${input.parsed.command}`]));
		input.stdout.write(`${JSON.stringify(result)}\n`);
		return 0;
	}
	writeJsonEnvelope(input.stdout, createCliRuntimeSuccessEnvelope({ run_id: input.runId, data: createCommandResultData(browserUseContracts[input.parsed.command], payload) }), { runId: input.runId, durationMs: input.durationMs() });
	return 0;
}

function emitReviewedActionFailure(input: PlatformCommandInput, code: string, message: string, exitCode = BINDING_FAIL_CLOSED_EXIT_CODE): number {
	const safeMessage = redactUnsafeText(message);
	if (input.parsed.outputMode === "plain") {
		input.stderr.write(`browser_use ${code}: ${safeMessage} (run_id=${input.runId})\n`);
		return exitCode;
	}
	writeJsonEnvelope(input.stdout, createCliRuntimeErrorEnvelope({
		run_id: input.runId, process_exit_code: exitCode,
		data: { command: input.parsed.command, result_kind: "reviewed_action", caller: input.caller },
		error: createCliRuntimeError({ run_id: input.runId, code, message: safeMessage, exit_code: exitCode, severity: "error", ...retryabilityForRecoverability(code === "action_replacement_digest_stale" ? "change_input" : "repair_state"), failure_domain: "browser_use" }),
	}), { runId: input.runId, durationMs: input.durationMs() });
	return exitCode;
}

async function readActionCandidateFile(input: PlatformCommandInput): Promise<
	| { ok: true; candidate: ReturnType<typeof parseReviewedActionCandidate> & { ok: true } }
	| { ok: false; exitCode: number }
> {
	const file = stringField(input.parsed.flagValues["--file"]) ?? "";
	let raw: string;
	try { raw = await input.runtime.readTextFile(file); } catch {
		return { ok: false, exitCode: emitReviewedActionFailure(input, "action_document_unreadable", "the Reviewed Action candidate file could not be read.") };
	}
	const parsed = parseReviewedActionCandidate(raw);
	if (!parsed.ok) return { ok: false, exitCode: emitReviewedActionFailure(input, parsed.code, parsed.message) };
	return { ok: true, candidate: parsed };
}

async function runReviewedActionCommand(input: PlatformCommandInput): Promise<number> {
	if (input.parsed.command === "action-schema") return emitReviewedActionSuccess(input, reviewedActionAuthoringSchema());
	if (input.parsed.command === "action-status") {
		const sourceRoot = owningSourceCheckoutRoot(input.runtime);
		if (sourceRoot === undefined) return emitReviewedActionFailure(input, "action_source_checkout_required", "packaged runtime cannot read private source promotion state; use the setup-owned source checkout front door.");
		const state = await readReviewedActionSourceState({ sourceRoot, actionId: stringField(input.parsed.flagValues["--id"]) ?? "" });
		return state.ok ? emitReviewedActionSuccess(input, state) : emitReviewedActionFailure(input, state.code, state.message);
	}
	if (input.parsed.command === "action-promote") {
		const sourceRoot = owningSourceCheckoutRoot(input.runtime);
		if (sourceRoot === undefined) return emitReviewedActionFailure(input, "action_source_checkout_required", "packaged runtime cannot mutate Reviewed Action source; use the setup-owned source checkout front door.");
		const brokerPath = stringField(input.runtime.env[BROWSER_USE_APPROVAL_BROKER_ENV]);
		if (brokerPath === undefined) return emitReviewedActionFailure(input, "action_promotion_broker_unavailable", `${BROWSER_USE_APPROVAL_BROKER_ENV} must name the absolute signed ApprovalBroker executable.`);
		const promoted = await runReviewedActionPromotionFrontDoor({
			sourceRoot,
			actionId: stringField(input.parsed.flagValues["--id"]) ?? "",
			approvalReference: stringField(input.parsed.flagValues["--approval-reference"]) ?? "",
			env: input.runtime.env,
			broker: createNativeReviewedActionOperatorBroker(brokerPath),
		});
		return promoted.ok ? emitReviewedActionSuccess(input, promoted) : emitReviewedActionFailure(input, promoted.code, promoted.message);
	}
	const loaded = await readActionCandidateFile(input);
	if (!loaded.ok) return loaded.exitCode;
	if (input.parsed.command === "action-validate") {
		const validated = validateReviewedActionCandidate(loaded.candidate.candidate);
		return validated.ok ? emitReviewedActionSuccess(input, validated) : emitReviewedActionFailure(input, validated.issues[0]?.code ?? "action_candidate_invalid", validated.repair);
	}
	const sourceRoot = owningSourceCheckoutRoot(input.runtime);
	if (sourceRoot === undefined) return emitReviewedActionFailure(input, "action_source_checkout_required", "packaged runtime cannot mutate Reviewed Action source; use the setup-owned source checkout front door.");
	const expectedRecordDigest = stringField(input.parsed.flagValues["--expected-record-digest"]);
	const applied = await applyReviewedActionCandidate({ sourceRoot, candidate: loaded.candidate.candidate, ...(expectedRecordDigest === undefined ? {} : { expectedRecordDigest }) });
	return applied.ok ? emitReviewedActionSuccess(input, applied) : emitReviewedActionFailure(input, applied.code, applied.message);
}

async function runRunbookActivate(input: PlatformCommandInput): Promise<number> {
	const repoRoot = owningSourceCheckoutRoot(input.runtime);
	if (repoRoot === undefined) {
		return emitPlatformStoreFailure(input, {
			code: "catalog_source_unavailable",
			message:
				"packaged runtime cannot mutate or activate the private source catalog; use the setup-owned source checkout front door.",
			actionId: "activate_runbook_catalog",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
		});
	}
	// Validate caller-correctable flags up front so a malformed epoch/digest is a
	// change_input usage error, not an activation repair_state failure that points
	// the operator at catalog repair.
	const rawCatalogDigest = stringField(input.parsed.flagValues["--catalog-digest"]) ?? "";
	const rawExpectedEpoch = stringField(input.parsed.flagValues["--expected-epoch"]);
	if (!/^[0-9a-f]{64}$/.test(rawCatalogDigest)) {
		return emitPlatformStoreFailure(input, { code: "activation_flag_invalid", message: "--catalog-digest must be 64 lowercase hex characters (the reviewed whole-catalog digest).", actionId: "activate_runbook_catalog", exitCode: BINDING_FAIL_CLOSED_EXIT_CODE, recoverability: "change_input" });
	}
	if (rawExpectedEpoch === undefined || !/^(0|[1-9][0-9]*)$/.test(rawExpectedEpoch)) {
		return emitPlatformStoreFailure(input, { code: "activation_flag_invalid", message: "--expected-epoch must be a non-negative integer.", actionId: "activate_runbook_catalog", exitCode: BINDING_FAIL_CLOSED_EXIT_CODE, recoverability: "change_input" });
	}
	const catalog = await loadPrivateRunbookCatalogFromGit({
		repoRoot,
		...(input.runtime.reviewedActionApprovalVerifier === undefined ? {} : { promotionVerifier: { verify: async (verification) => {
			const result = verifyAuthoredReviewedActionPromotion({ commit: verification.commit, record: verification.record as BrowserUseAuthoredReviewedActionRecord, assetBytes: verification.assetBytes, promotionHistory: verification.promotionHistory, verifier: input.runtime.reviewedActionApprovalVerifier as NonNullable<BrowserUseRuntime["reviewedActionApprovalVerifier"]> });
			return result.ok ? { ok: true as const } : result;
		} } }),
	});
	if (!catalog.ok) {
		return emitPlatformStoreFailure(input, {
			code: catalog.code,
			message: catalog.message,
			actionId: "activate_runbook_catalog",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
		});
	}
	const store = await openPlatformStore(input, "write");
	if (!store.ok) return store.exitCode;
	const activated = await activateRunbookGeneration({
		...store.deps,
		nonterminalMutationRuns: (activeGenerationId) =>
			nonterminalMutationRunIds(store.deps, activeGenerationId),
	}, {
		catalog: catalog.catalog,
		reviewedCatalogDigest: rawCatalogDigest,
		expectedEpoch: Number.parseInt(rawExpectedEpoch, 10),
	});
	if (!activated.ok) {
		return emitPlatformStoreFailure(input, {
			code: activated.code,
			message: activated.message,
			actionId: "activate_runbook_catalog",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
		});
	}
	if (input.parsed.outputMode === "plain") {
		input.stdout.write(
			platformPlainHeader(BROWSER_USE_RUNBOOK_ACTIVATION_CONTRACT_ID, input.caller, [
				`changed=${activated.changed}`,
				`generation=${activated.generation_id}`,
				`catalog_digest=${activated.catalog_digest}`,
				`epoch=${activated.epoch}`,
				`previous=${activated.previous_generation_id ?? "none"}`,
			]),
		);
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				contract: BROWSER_USE_RUNBOOK_ACTIVATION_CONTRACT_ID,
				schema_version: BROWSER_USE_RUNBOOK_ACTIVATION_SCHEMA_VERSION,
				changed: activated.changed,
				generation_id: activated.generation_id,
				previous_generation_id: activated.previous_generation_id,
				catalog_digest: activated.catalog_digest,
				epoch: activated.epoch,
				caller: input.caller,
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return 0;
}

/**
 * `runbook list` (R35). Projects every discovered valid runbook as a redacted
 * catalog row under the runbook-catalog contract. Discovery is read-only, so
 * the store opens read access; an empty runbooks root is an empty catalog.
 *
 * @param input - Store-backed command input
 * @returns Process exit code
 */
async function runRunbookList(input: PlatformCommandInput): Promise<number> {
	const store = await openPlatformStore(input);
	if (!store.ok) return store.exitCode;
	const repoRoot = owningSourceCheckoutRoot(input.runtime);
	const source = repoRoot === undefined ? undefined : await readRunbookSourceCatalog({
		sourceRoot: repoRoot,
		...(input.runtime.reviewedActionApprovalVerifier === undefined
			? {}
			: { approvalVerifier: input.runtime.reviewedActionApprovalVerifier }),
	});
	if (source !== undefined && !source.ok) return emitPlatformStoreFailure(input, { code: source.code, message: source.message, actionId: "activate_runbook_catalog", exitCode: BINDING_FAIL_CLOSED_EXIT_CODE, recoverability: "repair_state" });
	const activeResult = await resolveSelectedRunbookGeneration(store.deps);
	if (!activeResult.ok && activeResult.code !== "pre_cutover_unavailable") return emitPlatformStoreFailure(input, { code: activeResult.code, message: activeResult.message, actionId: "activate_runbook_catalog", exitCode: BINDING_FAIL_CLOSED_EXIT_CODE, recoverability: "repair_state" });
	const active = activeResult.ok ? activeResult : undefined;
	const legacyRows = !activeResult.ok && activeResult.code === "pre_cutover_unavailable" ? await listRunbooks(store.deps.fs, store.deps.paths.data.root) : [];
	const separatedIds = new Set(source?.ok === true ? source.catalog.separated.map((entry) => entry.record_id) : []);
	const sourceRecords = source?.ok === true ? Object.fromEntries(source.catalog.records.flatMap((record) => record.record_digest === null || separatedIds.has(record.id) ? [] : [[record.id, record.record_digest]])) : {};
	const activeRecords = active === undefined ? {} : Object.fromEntries(active.manifest.runbooks.map((record) => [`${record.service_id}/${record.flow_id}`, record.record_digest]));
	const synchronizationBase = projectRunbookGenerationSynchronization(
		source?.ok === true ? { available: true, catalog_digest: source.catalog.catalog_digest, records: sourceRecords } : { available: false },
		active === undefined ? { available: false } : { available: true, catalog_digest: active.catalog_digest, generation_id: active.generation_id, epoch: active.epoch, records: activeRecords },
	);
	const synchronization =
		source?.ok === true && source.catalog.activation_blockers.length > 0
			? { ...synchronizationBase, catalog_status: "activation-required" as const }
			: synchronizationBase;
	const rowById = new Map<string, BrowserUseRunbookCatalogRow & { record_digest: string }>();
	if (source?.ok === true) for (const record of source.catalog.records) {
		if (record.runbook !== undefined && record.record_digest !== null) rowById.set(record.id, { ...projectRunbookCatalogRow(record.runbook, record.activation_blocker === undefined ? "healthy" : "stale"), record_digest: record.record_digest });
	}
	if (active !== undefined) {
		const seam = createSelectedGenerationRunbookSeam(store.deps, active);
		for (const record of active.manifest.runbooks) {
			const id = `${record.service_id}/${record.flow_id}`;
			if (rowById.has(id)) continue;
			const loaded = await seam.loadRunbook({ serviceId: record.service_id, flowId: record.flow_id });
			if (!loaded.ok) return emitPlatformStoreFailure(input, runbookFailureOf("failure" in loaded ? loaded.failure.code : "runbook_record_corrupt", "failure" in loaded ? loaded.failure.message : "active generation Runbook is missing."));
			rowById.set(id, { ...projectRunbookCatalogRow(loaded.runbook, loaded.health), record_digest: record.record_digest });
		}
	}
	for (const row of legacyRows) {
		const id = `${row.service_id}/${row.flow_id}`;
		if (!rowById.has(id)) rowById.set(id, { ...row, record_digest: createHash("sha256").update(JSON.stringify(row)).digest("hex") });
	}
	const statusById = new Map(synchronization.records.map((record) => [record.id, record.status]));
	const rows = [...rowById.entries()].map(([id, row]) => ({ ...row, synchronization_status: separatedIds.has(id) ? "separated" : statusById.get(id) ?? "new-pending-activation" })).sort((left, right) => `${left.service_id}/${left.flow_id}`.localeCompare(`${right.service_id}/${right.flow_id}`));
	if (input.parsed.outputMode === "plain") {
		input.stdout.write(
			platformPlainHeader(BROWSER_USE_RUNBOOK_CATALOG_CONTRACT_ID, input.caller, [
				`runbook_count=${rows.length}`,
			]),
		);
		for (const row of rows) {
			input.stdout.write(
				`service=${row.service_id} flow=${row.flow_id} health=${row.health} sync=${row.synchronization_status} ${row.summary}\n`,
			);
		}
		if (source?.ok === true) for (const blocker of source.catalog.activation_blockers) {
			input.stdout.write(`blocker=${blocker.id} code=${blocker.code}\n`);
		}
		if (source?.ok === true) for (const separated of source.catalog.separated) {
			input.stdout.write(`separated=${separated.record_id} code=${separated.code}\n`);
		}
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				contract: BROWSER_USE_RUNBOOK_CATALOG_CONTRACT_ID,
				schema_version: BROWSER_USE_RUNBOOK_CATALOG_SCHEMA_VERSION,
				runbook_count: rows.length,
				runbooks: rows,
				activation_blockers:
					source?.ok === true ? source.catalog.activation_blockers : [],
				separated: source?.ok === true ? source.catalog.separated : [],
				...synchronization,
				source_view: source?.ok === true ? "available" : "source_unavailable",
				caller: input.caller,
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return 0;
}

// Map a runbook discovery/execution refusal onto the driver's typed platform
// failure. A missing/invalid id is caller-correctable (CHANGE_INPUT); a
// corrupt/invalid record needs a repair (RUNTIME_FAILURE with a repair
// continuation); a confidential runbook needs the auth transaction (fail
// closed with the auth continuation pointer).
function runbookFailureOf(
	code: string,
	message: string,
): PlatformStoreFailure {
	switch (code) {
		case "runbook_not_found":
		case "runbook_id_invalid":
		case "runbook_input_missing":
		case "runbook_input_rejected":
		case "runbook_resume_out_of_range":
			return {
				code,
				message,
				actionId: "supply_run_id",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			};
		case "runbook_record_corrupt":
		case "runbook_record_invalid":
		case "runbook_invalid":
			return {
				code,
				message,
				actionId: "inspect_corrupt_store_record",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			};
		default:
			// runbook_confidential_native_capability_absent,
			// runbook_confidential_delivery_unavailable, and any future refusal route
			// to the run's own persisted next safe action; the auth continuation is
			// named in the message.
			return {
				code,
				message:
					code === "runbook_confidential_native_capability_absent"
						? `${message} Continue with browser-use auth install-token, then browser-use auth status --json, then re-run this command.`
						: message,
				actionId: "inspect_shared_run",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
			};
	}
}

/**
 * `runbook show --service <id> --flow <id>` (R30/R31). Loads and validates one
 * runbook, then emits its definition + health under the runbook-definition
 * contract. A missing/corrupt/invalid record fails closed with a typed refusal.
 *
 * @param input - Store-backed command input
 * @returns Process exit code
 */
async function runRunbookShow(input: PlatformCommandInput): Promise<number> {
	const store = await openPlatformStore(input);
	if (!store.ok) return store.exitCode;
	const serviceId = stringField(input.parsed.flagValues["--service"]) ?? "";
	const flowId = stringField(input.parsed.flagValues["--flow"]) ?? "";
	const id = `${serviceId}/${flowId}`;
	const repoRoot = owningSourceCheckoutRoot(input.runtime);
	const source = repoRoot === undefined ? undefined : await readRunbookSourceCatalog({
		sourceRoot: repoRoot,
		...(input.runtime.reviewedActionApprovalVerifier === undefined
			? {}
			: { approvalVerifier: input.runtime.reviewedActionApprovalVerifier }),
	});
	if (source !== undefined && !source.ok) return emitPlatformStoreFailure(input, { code: source.code, message: source.message, actionId: "activate_runbook_catalog", exitCode: BINDING_FAIL_CLOSED_EXIT_CODE, recoverability: "repair_state" });
	const activeResult = await resolveSelectedRunbookGeneration(store.deps);
	if (!activeResult.ok && activeResult.code !== "pre_cutover_unavailable") return emitPlatformStoreFailure(input, { code: activeResult.code, message: activeResult.message, actionId: "activate_runbook_catalog", exitCode: BINDING_FAIL_CLOSED_EXIT_CODE, recoverability: "repair_state" });
	const active = activeResult.ok ? activeResult : undefined;
	const sourceRecord = source?.ok === true ? source.catalog.records.find((record) => record.id === id) : undefined;
	const sourceSeparation = source?.ok === true ? source.catalog.separated.find((entry) => entry.record_id === id) : undefined;
	const activeRecord = active?.manifest.runbooks.find((record) => record.service_id === serviceId && record.flow_id === flowId);
	if (sourceRecord?.activation_blocker !== undefined && sourceSeparation === undefined) {
		return emitPlatformStoreFailure(input, {
			code: sourceRecord.activation_blocker.code,
			message: sourceRecord.activation_blocker.message,
			actionId: "activate_runbook_catalog",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
		});
	}
	let shown: { ok: true; runbook: BrowserUseRunbook; health: "healthy" | "degrading" | "stale" } | { ok: false; failure: { code: string; message: string } };
	if (sourceRecord?.runbook !== undefined) shown = { ok: true, runbook: sourceRecord.runbook, health: sourceSeparation === undefined ? "healthy" : "stale" };
	else if (active !== undefined && activeRecord !== undefined) {
		const loaded = await createSelectedGenerationRunbookSeam(store.deps, active).loadRunbook({ serviceId, flowId });
		shown = loaded.ok ? loaded : { ok: false, failure: "failure" in loaded ? loaded.failure : { code: "runbook_not_found", message: `no runbook is defined for ${serviceId}/${flowId}.` } };
	} else if (active === undefined && !activeResult.ok && activeResult.code === "pre_cutover_unavailable") shown = await showRunbook(store.deps.fs, store.deps.paths.data.root, { serviceId, flowId });
	else shown = { ok: false, failure: { code: "runbook_not_found", message: `no runbook is defined for ${serviceId}/${flowId}.` } };
	if (!shown.ok) {
		return emitPlatformStoreFailure(input, runbookFailureOf(shown.failure.code, shown.failure.message));
	}
	const sourceDigest = source?.ok === true ? source.catalog.catalog_digest : null;
	const recordStatus = sourceSeparation !== undefined ? "separated" : sourceRecord !== undefined && activeRecord?.record_digest === sourceRecord.record_digest ? "in-sync" : sourceRecord !== undefined ? "new-pending-activation" : activeRecord !== undefined ? "deletion-pending-activation" : "new-pending-activation";
	const catalogStatus = source === undefined ? "source-unavailable" : active?.catalog_digest === sourceDigest ? "in-sync" : "activation-required";
	if (input.parsed.outputMode === "plain") {
		input.stdout.write(
			platformPlainHeader(
				BROWSER_USE_RUNBOOK_DEFINITION_CONTRACT_ID,
				input.caller,
				[
					`service=${shown.runbook.service_id}`,
					`flow=${shown.runbook.flow_id}`,
					`health=${shown.health}`,
					`catalog_sync=${catalogStatus}`,
					`record_sync=${recordStatus}`,
				],
			),
		);
		input.stdout.write(
			`version=${shown.runbook.version} steps=${shown.runbook.steps.length}${sourceSeparation === undefined ? "" : ` separated=${sourceSeparation.code}`}\n`,
		);
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				contract: BROWSER_USE_RUNBOOK_DEFINITION_CONTRACT_ID,
				schema_version: BROWSER_USE_RUNBOOK_DEFINITION_SCHEMA_VERSION,
				runbook: shown.runbook,
				health: shown.health,
				record_digest: sourceRecord?.record_digest ?? activeRecord?.record_digest ?? null,
				synchronization_status: recordStatus,
				separated: sourceSeparation ?? null,
				catalog_status: catalogStatus,
				source_catalog_digest: sourceDigest,
				active_catalog_digest: active?.catalog_digest ?? null,
				active_generation_id: active?.generation_id ?? null,
				active_epoch: active?.epoch ?? null,
				source_view: source === undefined ? "source_unavailable" : "available",
				caller: input.caller,
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return 0;
}

// Parse repeatable --input <id>=<value> pairs into the runbook input map. A
// malformed pair (no `=`, or an empty id) is a usage refusal so a caller never
// silently loses a binding.
function parseRunbookInputs(
	pairs: readonly string[],
):
	| { ok: true; inputs: BrowserUseRunbookInputs }
	| { ok: false; message: string } {
	const inputs: Record<string, string> = {};
	for (const pair of pairs) {
		const eq = pair.indexOf("=");
		if (eq <= 0) {
			return {
				ok: false,
				message: `each --input must be <id>=<value>; received ${sanitizeInputPairForError(pair)}.`,
			};
		}
		inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
	}
	return { ok: true, inputs };
}

type PrivateRunbookInputBinding = {
	inputId: string;
	filePath: string;
};

function parsePrivateRunbookInputBindings(
	pairs: readonly string[],
):
	| { ok: true; bindings: readonly PrivateRunbookInputBinding[] }
	| { ok: false; code: string; message: string } {
	const inputIds = new Set<string>();
	const bindings: PrivateRunbookInputBinding[] = [];
	for (const pair of pairs) {
		const equals = pair.indexOf("=");
		if (equals <= 0 || equals === pair.length - 1) {
			return {
				ok: false,
				code: "private_input_shape_invalid",
				message:
					"each --input-file must be <id>=<absolute-path>; private paths and values are withheld.",
			};
		}
		const inputId = pair.slice(0, equals);
		if (inputIds.has(inputId)) {
			return {
				ok: false,
				code: "private_input_shape_invalid",
				message: "a private input id may be supplied only once.",
			};
		}
		inputIds.add(inputId);
		bindings.push({ inputId, filePath: pair.slice(equals + 1) });
	}
	return { ok: true, bindings };
}

async function readPrivateRunbookInputs(
	bindings: readonly PrivateRunbookInputBinding[],
	inputRoot: string,
): Promise<
	| { ok: true; inputs: BrowserUseRunbookInputs }
	| { ok: false; code: string; message: string }
> {
	const inputs: Record<string, unknown> = {};
	for (const binding of bindings) {
		const read = await readPrivateStructuredInput({
			inputId: binding.inputId,
			inputRoot,
			filePath: binding.filePath,
		});
		if (!read.ok) {
			return {
				ok: false,
				code: read.refusal.code,
				message: read.refusal.message,
			};
		}
		Object.assign(inputs, read.inputs);
	}
	return { ok: true, inputs };
}

// Redact an --input pair for an error message: never echo the value bytes (a
// confidential value could ride in), only the id portion.
function sanitizeInputPairForError(pair: string): string {
	const eq = pair.indexOf("=");
	return eq > 0 ? `${pair.slice(0, eq)}=[redacted]` : "[redacted]";
}

type CloseableTargetTransport = {
	transport: {
		request(
			request:
				| BrowserUseDevToolsRequest
				| BrowserUseCdpObserverRequest
				| {
						method: "Page.navigate";
						sessionId: string;
						params: { url: string };
					  },
		): Promise<unknown>;
	};
	close(): void;
};

async function navigateRunbookAuthTarget(
	transport: CloseableTargetTransport["transport"],
	input: { target_id: string; url: string },
): Promise<{ ok: true } | { ok: false; cause: "target-proof-invalid" }> {
	let sessionId: string | undefined;
	try {
		const attached = await transport.request({
			method: "Target.attachToTarget",
			params: { targetId: input.target_id, flatten: true },
		});
		sessionId =
			typeof attached === "object" &&
			attached !== null &&
			"sessionId" in attached &&
			typeof attached.sessionId === "string"
				? attached.sessionId
				: undefined;
		if (sessionId === undefined) {
			return { ok: false, cause: "target-proof-invalid" };
		}
		await transport.request({
			method: "Page.navigate",
			sessionId,
			params: { url: input.url },
		});
		return { ok: true };
	} catch {
		return { ok: false, cause: "target-proof-invalid" };
	} finally {
		if (sessionId !== undefined) {
			try {
				await transport.request({
					method: "Target.detachFromTarget",
					params: { sessionId },
				});
			} catch {
				// Navigation already dispatched once. Later proof fails closed on drift.
			}
		}
	}
}

type RunbookAuthDeliveryBuilderDeps = {
	tokenRetrieval: BrowserUseTokenRetrievalPort;
	resolveApprovedBinding?(input: {
		binding_ref: string;
		service_id: string;
		auth_context: BrowserUseAuthContext;
		environment: string;
		profile: string;
	}): Promise<BrowserUseItemBinding | null>;
	createTargetTransport(
		handoff: AgentBrowserVerifiedHandoff,
	): CloseableTargetTransport;
	createDeliveryHook(input: {
		tokenRetrieval: BrowserUseTokenRetrievalPort;
		handoff: AgentBrowserVerifiedHandoff;
		expectedTargetUrl: string;
		target: BrowserUseMintedVerifiedTarget;
		descriptorByField?: Readonly<
			Partial<
				Record<
					BrowserUseOpCredentialField,
					{ role: string; accessible_name: string }
				>
			>
		>;
	}): BrowserUseDeliveryHook | undefined;
};

function preparationRefusalMessage(
	outcome: Extract<
		Awaited<ReturnType<BrowserUseAuthProvider["prepareSecretFree"]>>,
		{ ok: false }
	>,
): string {
	const selection =
		outcome.detail.kind === "selection"
			? ` Ranked redacted candidates: ${outcome.detail.selection
					.map(
						(candidate) =>
							`rank ${candidate.rank} item ${candidate.item_id}`,
					)
					.join(", ")}.`
			: "";
	const tokenSetup =
		outcome.event.cause === "missing-token"
			? " Continue with browser-use auth install-token, then browser-use auth status --json, then rerun."
			: "";
	return `binding resolution blocked (${outcome.event.cause}); continuation ${outcome.continuation.next_action_id}: ${outcome.continuation.summary}${selection}${tokenSetup}`;
}

function bindingIdentity(binding: {
	vault_id: string;
	item_id: string;
	binding_revision: number;
}): string {
	return `${binding.vault_id}\0${binding.item_id}\0${binding.binding_revision}`;
}

function fieldMethod(
	field: BrowserUseOpCredentialField,
): "password" | "otp" {
	return field === "otp-current" ? "otp" : "password";
}

function runbookLoginPathOf(expectedTargetUrl: string): string | null {
	try {
		return new URL(expectedTargetUrl).pathname;
	} catch {
		return null;
	}
}

async function prepareApprovedRunbookBinding(input: {
	provider: BrowserUseAuthProvider;
	deps: RunbookAuthDeliveryBuilderDeps;
	request: Parameters<BrowserUseRunbookAuthDelivery>[0];
	bindingRef: string;
	field: Parameters<BrowserUseRunbookAuthDelivery>[0]["confidentialFields"][number];
	loginPath: string | null;
}) {
	const approvedBinding =
		(await input.deps.resolveApprovedBinding?.({
			binding_ref: input.bindingRef,
			service_id: input.request.serviceId,
			auth_context: "interactive-login",
			environment: input.request.handoff.environment.name,
			profile: input.request.handoff.environment.profile,
		})) ?? null;
	return await input.provider.prepareSecretFree({
		service_id: input.request.serviceId,
		auth_context: "interactive-login",
		target_origins: input.request.allowedOrigins,
		login_path: input.loginPath,
		method: fieldMethod(input.field.credentialField),
		binding: approvedBinding,
		candidate_hint: {
			hint_item_id: input.bindingRef,
			legacy_vault_name: null,
		},
	});
}

function environmentDeliveryHook(input: {
	tokenRetrieval: BrowserUseTokenRetrievalPort;
	handoff: AgentBrowserVerifiedHandoff;
	expectedTargetUrl: string;
	target: BrowserUseMintedVerifiedTarget;
	descriptorByField?: Readonly<
		Partial<
			Record<
				BrowserUseOpCredentialField,
				{ role: string; accessible_name: string }
			>
		>
	>;
}): BrowserUseDeliveryHook | undefined {
	const port = input.tokenRetrieval as Partial<BrowserUseEnvironmentTokenRetrievalPort>;
	if (typeof port.redeemCredentialField !== "function") return undefined;
	return async ({ handle, target }) => {
		// Each redemption re-resolves its node in the delivery child from THIS
		// descriptor, so it must name the field being redeemed — a constant
		// first-field descriptor would write a later secret into the wrong node.
		const descriptor = input.descriptorByField?.[handle.field] ?? {
			role: input.target.field.role,
			accessible_name: input.target.field.accessible_name,
		};
		const delivered = await port.redeemCredentialField?.({
			handle,
			target_digest: target.target_proof_digest,
			ws_url: input.handoff.endpoint.ws,
			target_url: input.target.top_level_url,
			target_origin: target.frame_origin,
			field: {
				role: descriptor.role,
				accessible_name: descriptor.accessible_name,
			},
		});
		if (delivered?.ok) return delivered;
		const rejection = delivered?.rejection.code;
		const targetDrift =
			rejection === "target-digest-mismatch" ||
			rejection === "origin-mismatch" ||
			rejection === "target-proof-invalid";
		return {
			ok: false,
			reason: targetDrift
				? "target-drift"
				: delivered?.external_effect_possible === true
					? "helper-crash"
					: "helper-unavailable",
			field_cleared: delivered?.field_cleared ?? false,
		};
	};
}

function environmentLoginDeliveryHook(input: {
	tokenRetrieval: BrowserUseTokenRetrievalPort;
	handoff: AgentBrowserVerifiedHandoff;
}): BrowserUseDeliveryHook | undefined {
	const port = input.tokenRetrieval as Partial<BrowserUseEnvironmentTokenRetrievalPort>;
	if (typeof port.redeemCredentialField !== "function") return undefined;
	return async ({ handle, target }) => {
		const mintedTarget = target as Partial<BrowserUseMintedVerifiedTarget>;
		const field = mintedTarget.field;
		if (field === undefined || typeof mintedTarget.top_level_url !== "string") {
			return { ok: false, reason: "target-drift", field_cleared: false };
		}
		const delivered = await port.redeemCredentialField?.({
			handle,
			target_digest: target.target_proof_digest,
			ws_url: input.handoff.endpoint.ws,
			target_url: mintedTarget.top_level_url,
			target_origin: target.frame_origin,
			field: {
				role: field.role,
				accessible_name: field.accessible_name,
			},
		});
		if (delivered?.ok) return delivered;
		const rejection = delivered?.rejection.code;
		return {
			ok: false,
			reason:
				rejection === "target-digest-mismatch" ||
				rejection === "origin-mismatch" ||
				rejection === "target-proof-invalid"
					? "target-drift"
					: delivered?.external_effect_possible === true
						? "helper-crash"
						: "helper-unavailable",
			field_cleared: delivered?.field_cleared ?? false,
		};
	};
}

function createWebSocketTargetTransport(
	handoff: AgentBrowserVerifiedHandoff,
): CloseableTargetTransport {
	const socket = new WebSocket(handoff.endpoint.ws);
	const pending = new Map<
		number,
		{
			resolve(value: unknown): void;
			reject(reason: Error): void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	let nextId = 1;
	let closed = false;
	const opened = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("DevTools transport open timed out.")),
			10_000,
		);
		socket.addEventListener(
			"open",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
		socket.addEventListener(
			"error",
			() => {
				clearTimeout(timer);
				reject(new Error("DevTools transport could not open."));
			},
			{ once: true },
		);
	});
	socket.addEventListener("message", (event) => {
		if (typeof event.data !== "string") return;
		let response: unknown;
		try {
			response = JSON.parse(event.data);
		} catch {
			return;
		}
		if (
			typeof response !== "object" ||
			response === null ||
			!("id" in response) ||
			typeof response.id !== "number"
		) {
			return;
		}
		const waiter = pending.get(response.id);
		if (waiter === undefined) return;
		pending.delete(response.id);
		clearTimeout(waiter.timer);
		if ("error" in response) {
			waiter.reject(new Error("DevTools request was refused."));
			return;
		}
		waiter.resolve("result" in response ? response.result : undefined);
	});
	const rejectPending = () => {
		closed = true;
		for (const waiter of pending.values()) {
			clearTimeout(waiter.timer);
			waiter.reject(new Error("DevTools transport closed."));
		}
		pending.clear();
	};
	socket.addEventListener("close", rejectPending);
	return {
		transport: {
			async request(
				request: BrowserUseDevToolsRequest | BrowserUseCdpObserverRequest,
			): Promise<unknown> {
				await opened;
				if (closed) throw new Error("DevTools transport is closed.");
				const id = nextId;
				nextId += 1;
				return await new Promise<unknown>((resolve, reject) => {
					const timer = setTimeout(() => {
						pending.delete(id);
						reject(new Error("DevTools request timed out."));
					}, 10_000);
					pending.set(id, { resolve, reject, timer });
					socket.send(JSON.stringify({ id, ...request }));
				});
			},
		},
		close() {
			if (closed) return;
			rejectPending();
			socket.close();
		},
	};
}

// Auth-delivery seam for `runbook run`. Built only when a Token Retrieval Port
// exists. Every refusal carries the blocking cause and its repair continuation.
function buildRunbookAuthDelivery(
	provider: BrowserUseAuthProvider,
	deps: RunbookAuthDeliveryBuilderDeps,
): BrowserUseRunbookAuthDelivery {
	return async (input) => {
		let closeable: CloseableTargetTransport | undefined;
		let lease:
			| Extract<
					Awaited<
						ReturnType<BrowserUseAuthProvider["acquireSensitiveIntervalLease"]>
					>,
					{ granted: true }
			  >["lease"]
			| undefined;
		const release = async () => {
			if (lease !== undefined) {
				await provider.releaseSensitiveIntervalLease({ lease });
				lease = undefined;
			}
			closeable?.close();
			closeable = undefined;
		};
		try {
			const fieldBySlug = new Map(
				input.confidentialFields.map((field) => [
					field.bindingSlug,
					field,
				]),
			);
			const preparedBindings = [];
			const loginPath = runbookLoginPathOf(input.expectedTargetUrl);
			for (const slug of input.pendingItemBindings) {
				const field = fieldBySlug.get(slug);
				if (field === undefined) {
					return {
						ok: false,
						message:
							"binding resolution blocked (capability-loss); continuation inspect-auth-capability: the runbook binding has no confidential field plan.",
					};
				}
				const prepared = await prepareApprovedRunbookBinding({
					provider,
					deps,
					request: input,
					bindingRef: slug,
					field,
					loginPath,
				});
				if (!prepared.ok) {
					return { ok: false, message: preparationRefusalMessage(prepared) };
				}
				if (prepared.binding === null) {
					return {
						ok: false,
						message:
							"binding resolution blocked (capability-loss); continuation inspect-auth-capability: confidential delivery produced no Item Binding.",
					};
				}
				preparedBindings.push(prepared.binding);
			}
			const binding = preparedBindings[0];
			if (binding === undefined) {
				return {
					ok: false,
					message:
						"binding resolution blocked (capability-loss); continuation inspect-auth-capability: no pending Item Binding was supplied.",
				};
			}
			if (
				new Set(preparedBindings.map((candidate) => bindingIdentity(candidate)))
					.size !== 1
			) {
				return {
					ok: false,
					message:
						"binding resolution blocked (single-binding-v1); continuation split-confidential-runbook: pending slugs resolved to more than one distinct Item Binding.",
				};
			}

			const firstField = input.confidentialFields[0];
			if (firstField === undefined) {
				return {
					ok: false,
					message:
						"target proof blocked (target-proof-invalid); continuation refresh-runbook-target: no confidential field target was supplied.",
				};
			}
			closeable = deps.createTargetTransport(input.handoff);
			const proof = await mintBrowserUseVerifiedTarget(closeable.transport, {
				lane_id: "agent-browser",
				run_id: input.runId,
				expected_url: input.expectedTargetUrl,
				allowed_origins: input.allowedOrigins,
				binding,
				field: {
					role: firstField.target.role,
					accessible_name: firstField.target.name,
				},
			});
			if (!proof.ok) {
				await release();
				return {
					ok: false,
					message: `target proof blocked (${proof.cause}); continuation refresh-runbook-target: refresh the verified handoff target, then rerun.`,
				};
			}

			const acquired = await provider.acquireSensitiveIntervalLease({
				run: {
					environment_profile: {
						environment: input.handoff.environment.name,
						profile: input.handoff.environment.profile,
					},
				},
				holder_id: `runbook-sensitive-${input.runId}`,
				ttl_ms: 30_000,
				scope: { target_id: proof.target.target_id },
				key_family: "sensitive-interval",
			});
			if (!acquired.granted) {
				await release();
				return {
					ok: false,
					message: `sensitive interval blocked (${acquired.blocked_cause}); continuation ${acquired.continuation.next_action_id}: ${acquired.continuation.summary}`,
				};
			}
			lease = acquired.lease;
			// Per-field node descriptors from the runbook's confidential field plan:
			// each redemption selects ITS OWN descriptor, never the first field's.
			const descriptorByField: Partial<
				Record<
					BrowserUseOpCredentialField,
					{ role: string; accessible_name: string }
				>
			> = {};
			for (const field of input.confidentialFields) {
				descriptorByField[field.credentialField] ??= {
					role: field.target.role,
					accessible_name: field.target.name,
				};
			}
			const deliver = deps.createDeliveryHook({
				tokenRetrieval: deps.tokenRetrieval,
				handoff: input.handoff,
				expectedTargetUrl: input.expectedTargetUrl,
				target: proof.target,
				descriptorByField,
			});
			if (deliver === undefined) {
				await release();
				return {
					ok: false,
					message:
						"sensitive interval blocked (capability-loss); continuation install-token: the active credential lane cannot redeem a confidential delivery handle.",
				};
			}
			const field_by_binding_slug = Object.fromEntries(
				input.confidentialFields.map((field) => [
					field.bindingSlug,
					field.credentialField,
				]),
			);
			return {
				ok: true,
				context: provider.buildAgentBrowserDeliveryContext({
					binding,
					target: proof.target,
					deliver,
					reproveTarget: proof.reproveTarget,
					field_by_binding_slug,
					in_sensitive_interval: true,
				}),
				release,
			};
		} catch {
			await release();
			return {
				ok: false,
				message:
					"sensitive interval blocked (capability-loss); continuation inspect-auth-capability: live confidential delivery composition failed closed.",
			};
		}
	};
}

/**
 * `runbook run --service <id> --flow <id> --handoff <path>` (R30, F7). Mirrors
 * runTaskRun's opening: reads the verified agent-browser handoff, opens the
 * store for write, creates/resumes the shared run under the runbook-execution
 * intent, compiles + dispatches the runbook through the agent-browser lane, and
 * records terminal/blocked truth through the SAME recordTaskRunOutcome pipeline.
 *
 * @param input - Store-backed command input
 * @returns Process exit code
 */
async function runRunbookRun(
	input: PlatformCommandInput,
	generationConflictRetries = 1,
): Promise<number> {
	const flags = input.parsed.flagValues;
	const serviceId = stringField(flags["--service"]) ?? "";
	const flowId = stringField(flags["--flow"]) ?? "";

	// Runbooks always execute on the agent-browser lane, so an absent --handoff
	// mints for that adapter (D4); acquisition + validation live in the shared
	// acquireVerifiedHandoff sequence.
	const acquired = await acquireVerifiedHandoff({
		command: input,
		mintAdapterId: "agent-browser",
		subject: "a runbook",
	});
	if (!acquired.ok) return acquired.exitCode;
	const handoff = acquired.handoff;
	const rawHandoffData = acquired.rawHandoffData;
	// Runbooks execute through the agent-browser lane; a non-agent-browser handoff
	// is a lane mismatch, never a substitution (R11).
	if (handoff.adapter !== "agent-browser") {
		return emitTaskRunFailure(input, undefined, {
			code: "task_run_handoff_lane_mismatch",
			message: `runbook execution runs on the agent-browser lane; the verified handoff attached adapter ${handoff.adapter}.`,
			actionId: "supply_matching_handoff",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}

	const parsedInputs = parseRunbookInputs(
		input.parsed.repeatedFlagValues["--input"] ?? [],
	);
	if (!parsedInputs.ok) {
		return emitTaskRunFailure(input, undefined, {
			code: "task_run_lane_refused",
			message: parsedInputs.message,
			actionId: "change_task_run_input",
			exitCode: USAGE_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	const privateInputBindings = parsePrivateRunbookInputBindings(
		input.parsed.repeatedFlagValues["--input-file"] ?? [],
	);
	if (!privateInputBindings.ok) {
		return emitTaskRunFailure(input, undefined, {
			code: privateInputBindings.code,
			message: privateInputBindings.message,
			actionId: "change_task_run_input",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	const publicInputIds = new Set(Object.keys(parsedInputs.inputs));
	const conflictingInput = privateInputBindings.bindings.find((binding) =>
		publicInputIds.has(binding.inputId),
	);
	if (conflictingInput !== undefined) {
		return emitTaskRunFailure(input, undefined, {
			code: "runbook_input_source_conflict",
			message: `runbook input ${conflictingInput.inputId} may use either --input or --input-file, not both.`,
			actionId: "change_task_run_input",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}

	const store = await openPlatformStore(input, "write");
	if (!store.ok) return store.exitCode;
	const privateInputs = await readPrivateRunbookInputs(
		privateInputBindings.bindings,
		join(store.deps.paths.resolution.roots.runtime, "private-inputs"),
	);
	if (!privateInputs.ok) {
		return emitTaskRunFailure(input, undefined, {
			code: privateInputs.code,
			message: privateInputs.message,
			actionId: "change_task_run_input",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "change_input",
		});
	}
	const runbookInputs: BrowserUseRunbookInputs = {
		...parsedInputs.inputs,
		...privateInputs.inputs,
	};

	const runFlag = stringField(flags["--run"]);
	const explicitTabId = stringField(flags["--tab"]);

	// Load resume state before planning. Fresh runs are created only after the
	// plan and target both resolve, so a caller-correctable failure leaves no
	// orphan running record.
	let run: BrowserUseSharedRun | undefined;
	let resumeFromStep = 0;
	if (runFlag !== undefined) {
		const loaded = await loadSharedRun(store.deps, runFlag);
		if (!loaded.ok) {
			return emitPlatformStoreFailure(
				input,
				platformStoreFailureOf(loaded.code, loaded.message),
			);
		}
		if (isTerminalRunState(loaded.run.state)) {
			if (loaded.run.state === "confirmed") {
				return emitSharedRunSuccess({
					command: input,
					run: loaded.run,
					continuationId: "inspect_task_run_result",
					dataExtra: {
						selected_lane: "agent-browser",
						lane_source: "intent-preferred",
						external_effect: "none",
						executed_steps: 0,
						resume: "confirmed-no-op",
					},
					plainExtra: [
						"selected_lane=agent-browser",
						"lane_source=intent-preferred",
						"external_effect=none",
						"executed_steps=0",
						"resume=confirmed-no-op",
					],
				});
			}
			return emitTaskRunFailure(input, loaded.run.run_id, {
				code: "task_run_effect_unknown",
				message: `run ${loaded.run.run_id} holds terminal truth ${loaded.run.state}; terminal truth never re-enters execution.`,
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none",
			});
		}
		const check = checkSameLaneResumeForTaskRun(
			loaded.run,
			"agent-browser",
			handoff,
		);
		if (check !== undefined) {
			return emitTaskRunFailure(input, loaded.run.run_id, check);
		}
		if (loaded.run.runbook_target_binding === undefined) {
			return emitTaskRunFailure(input, loaded.run.run_id, {
				code: "agent_browser_target_moved",
				message:
					"the existing run has no durable target binding and cannot be resumed safely; start a replacement run.",
				actionId: "restore_bound_runbook_target",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "repair_state",
				dataExtra: {
					lane_outcome: "agent_browser_target_moved",
					external_effect: "none",
				},
			});
		}
		if (
			loaded.run.state === "awaiting-approval" &&
			loaded.run.continuation?.next_action_id ===
				"complete-submit-approval"
		) {
			const approvalArtifact = loaded.run.artifacts.at(-1);
			return emitSharedRunSuccess({
				command: input,
				run: loaded.run,
				continuationId: "complete-submit-approval",
				...(approvalArtifact === undefined
					? {}
					: {
							dataExtra: {
								approval_review: {
									artifact_id: approvalArtifact.artifact_id,
									producer_capability: "screenshot_media",
								},
							},
						}),
			});
		}
		run = loaded.run;
		resumeFromStep = runbookResumeCursorOf(loaded.run);
	}

	const generationResolution = run?.run_execution_binding !== undefined
		? await resolveRetainedRunbookGeneration(store.deps, run.run_execution_binding)
		: await resolveSelectedRunbookGeneration(store.deps);
	const selectedGeneration = generationResolution.ok ? generationResolution : undefined;
	if (!generationResolution.ok && generationResolution.code !== "pre_cutover_unavailable") return emitPlatformStoreFailure(input, { code: generationResolution.code, message: generationResolution.message, actionId: "activate_runbook_catalog", exitCode: BINDING_FAIL_CLOSED_EXIT_CODE, recoverability: "repair_state" });
	if (run !== undefined && run.run_execution_binding === undefined && selectedGeneration !== undefined) return emitPlatformStoreFailure(input, { code: "activation_generation_corrupt", message: "the retained run has no immutable generation binding and cannot acquire current authority during resume.", actionId: "activate_runbook_catalog", exitCode: BINDING_FAIL_CLOSED_EXIT_CODE, recoverability: "repair_state" });
	// A binding needs a real runbook_digest to detect resume drift. If the selected
	if (run?.run_execution_binding?.normalized_input_digest !== undefined && run.run_execution_binding.normalized_input_digest !== normalizedInputDigest(runbookInputs)) return emitPlatformStoreFailure(input, { code: "activation_generation_corrupt", message: "the resumed input does not match the immutable run execution binding.", actionId: "activate_runbook_catalog", exitCode: BINDING_FAIL_CLOSED_EXIT_CODE, recoverability: "repair_state" });

	const prepared = await prepareRunbookExecution(
		store.deps.fs,
		store.deps.paths.data.root,
		{
			serviceId,
			flowId,
			inputs: runbookInputs,
			resumeFromStep,
			...(selectedGeneration !== undefined ? {
				actionSeam: createSelectedGenerationActionSeam(
					store.deps,
					selectedGeneration,
					input.runtime.reviewedActionApprovalVerifier,
				),
			} : {}),
			...(selectedGeneration !== undefined ? { runbookSeam: createSelectedGenerationRunbookSeam(store.deps, selectedGeneration) } : {}),
		},
	);
	if (!prepared.ok) {
		if (
			prepared.refusal.code === "runbook_not_found" ||
			prepared.refusal.code === "runbook_id_invalid" ||
			prepared.refusal.code === "runbook_input_missing" ||
			prepared.refusal.code === "runbook_input_rejected" ||
			prepared.refusal.code === "runbook_resume_out_of_range"
		) {
			return emitTaskRunFailure(input, run?.run_id, {
				code: prepared.refusal.code,
				message: prepared.refusal.message,
				actionId: "change_task_run_input",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "change_input",
			});
		}
		return emitPlatformStoreFailure(
			input,
			runbookFailureOf(prepared.refusal.code, prepared.refusal.message),
		);
	}
	const plan = prepared.plan;
	// A binding needs a real runbook_digest to detect resume drift. If the selected
	// generation manifest holds no record for this plan, generation and plan
	// disagree (already inconsistent); fail closed rather than persist an empty,
	// unverifiable digest. (Must sit after `plan` is declared.)
	const boundRunbookDigest = selectedGeneration?.manifest.runbooks.find((record) => record.service_id === plan.service_id && record.flow_id === plan.flow_id)?.record_digest;
	if (selectedGeneration !== undefined && boundRunbookDigest === undefined) return emitPlatformStoreFailure(input, { code: "activation_generation_corrupt", message: "the selected generation has no record for this Runbook; the generation and plan disagree.", actionId: "activate_runbook_catalog", exitCode: BINDING_FAIL_CLOSED_EXIT_CODE, recoverability: "repair_state" });
	if (
		run?.runbook_progress !== undefined &&
		(run.runbook_progress.service_id !== plan.service_id ||
			run.runbook_progress.flow_id !== plan.flow_id ||
			run.runbook_progress.runbook_version !== plan.version ||
			run.runbook_progress.total_steps !== plan.total_steps)
	) {
		return emitTaskRunFailure(input, run.run_id, {
			code: "runbook_progress_identity_mismatch",
			message:
				"the resumed run is bound to a different runbook identity or version.",
			actionId: "inspect_task_run_result",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
		});
	}
	if (run?.mutation_dispatched) {
		const latestApproval = run.approvals?.at(-1);
		const gateCapturePending =
			plan.steps.length === 0 &&
			plan.approval_gate?.runbook_step_index === resumeFromStep;
		const approvedDispatchPending =
			run.state === "running" &&
			latestApproval !== undefined &&
			latestApproval.dispatch_started_at_epoch_ms === undefined;
		if (!gateCapturePending && !approvedDispatchPending) {
			return emitTaskRunFailure(input, run.run_id, {
				code: "task_run_effect_unknown",
				message:
					"the prior process ended after business write-ahead; inspect outcome before any redispatch.",
				actionId: "inspect_task_run_result",
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none",
				dataExtra: { external_effect: "unknown" },
			});
		}
	}
	if (
		plan.auth_context_ref !== undefined &&
		input.runtime.runbookAuthenticatedStateProof === undefined &&
		input.runtime.runbookHumanIdentityAttestation === undefined
	) {
		return emitTaskRunFailure(input, run?.run_id ?? handoff.runId, {
			code: "human-identity-attestation-required",
			message:
				"runbook authentication requires an approved fresh identity-proof owner before any browser dispatch.",
			actionId: "inspect_task_run_result",
			exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
			recoverability: "repair_state",
			dataExtra: { external_effect: "none" },
		});
	}

	// A nonterminal crash residue may already have confirmed every step. Close it
	// without resolving a browser target or entering auth again.
	if (
		run !== undefined &&
		plan.steps.length === 0 &&
		plan.approval_gate === undefined
	) {
		return await recordTaskRunOutcome(
			input,
			store.deps,
			run,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			{
				kind: "confirmed",
				executedSteps: 0,
				mutationDispatched: run.mutation_dispatched,
			},
			{ runbookNextStep: plan.total_steps },
		);
	}

	const targetEnvelopeId = targetEnvelopeIdOf({
		runId: run?.run_id ?? handoff.runId,
		mode: "handoff-bound",
		adapter: "agent-browser",
		handoffEvidenceId: handoff.handoffEvidenceId,
	});
	const storedBinding = run?.runbook_target_binding;
	const targetResolution = await resolveAgentBrowserTaskTarget(
		{ runCommand: input.runtime.runCommand },
		{
			handoff: rawHandoffData as AgentBrowserVerifiedHandoff,
			run_id: run?.run_id ?? handoff.runId,
			allowed_origins: plan.allowed_origins,
			steps: plan.steps,
			target:
				explicitTabId !== undefined
					? {
							kind: "exact",
							tab_id: explicitTabId,
							target_envelope_id: targetEnvelopeId,
						}
					: {
							kind: "auto",
							target_envelope_id: targetEnvelopeId,
							...(storedBinding !== undefined
								? {
										bound_target_candidate_id: storedBinding.binding_id,
									}
								: {}),
						},
		},
	);
	if (!targetResolution.ok) {
		if (run === undefined) {
			const actionId =
				explicitTabId !== undefined
					? "change_task_run_input"
					: targetResolution.code === "agent_browser_connection_unstable"
						? "refresh_runbook_handoff"
						: "prepare_unique_runbook_target";
			return emitTaskRunFailure(input, undefined, {
				code: targetResolution.code,
				message: targetResolution.message,
				actionId,
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability:
					actionId === "refresh_runbook_handoff"
						? "repair_state"
						: "change_input",
				dataExtra: { external_effect: "none" },
			});
		}
		return await recordTaskRunOutcome(
			input,
			store.deps,
			run,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			runbookTargetRepairMapping(targetResolution),
			{ runbookNextStep: resumeFromStep },
		);
	}
	if (
		run !== undefined &&
		storedBinding !== undefined &&
		storedBinding.binding_id !== targetResolution.binding.target_candidate_id
	) {
		const mismatchSubject =
			explicitTabId === undefined
				? "the automatically resolved target"
				: "the explicit --tab target";
		const moved: Extract<AgentBrowserTargetResolutionResult, { ok: false }> = {
			ok: false,
			code: "agent_browser_target_moved",
			outcome: "not-achieved",
			message: `${mismatchSubject} does not match the target bound to this run.`,
			executed_steps: 0,
			mutation_dispatched: false,
		};
		return await recordTaskRunOutcome(
			input,
			store.deps,
			run,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			runbookTargetRepairMapping(moved),
			{ runbookNextStep: resumeFromStep },
		);
	}

	const progress = {
		schema_version: "1" as const,
		service_id: plan.service_id,
		flow_id: plan.flow_id,
		runbook_version: plan.version,
		next_step: resumeFromStep,
		total_steps: plan.total_steps,
	};
	const durableTargetBinding = {
		schema_version: "1",
		mode: explicitTabId === undefined ? "automatic" : "exact",
		binding_id: targetResolution.binding.target_candidate_id,
	} as const;
	if (run === undefined) {
		const create = async () => await createSharedRun(store.deps, {
			run_id: handoff.runId,
			state: "running",
			task_intent: "runbook-execution",
			environment_profile: {
				environment: handoff.environmentName,
				profile: handoff.environmentProfile,
			},
			adapter_id: "agent-browser",
			handoff_evidence_id: handoff.handoffEvidenceId,
			runbook_target_binding: durableTargetBinding,
			runbook_progress: progress,
			...(selectedGeneration !== undefined ? {
				run_execution_binding: {
					schema_version: "1" as const,
					generation_id: selectedGeneration.generation_id,
					activation_epoch: selectedGeneration.epoch,
					service_id: plan.service_id,
					flow_id: plan.flow_id,
					runbook_version: plan.version,
					runbook_digest: boundRunbookDigest ?? "",
					action_registry_digest: selectedGeneration.action_registry_digest,
					normalized_input_digest: normalizedInputDigest(runbookInputs),
					item_key_digest: itemKeySequenceDigest([]),
					target_scope: plan.allowed_origins[0] ?? "",
					postcondition: { id: `${plan.service_id}/${plan.flow_id}`, summary: "Runbook completion postcondition." },
				},
			} : {}),
			mutation_dispatched: false,
			artifacts: [],
		});
		const created = selectedGeneration === undefined ? await create() : await withRunbookGenerationSelectionBarrier(store.deps, selectedGeneration, create);
		if (!created.ok) {
			// Target preparation is read-only. If activation wins before the fresh
			// run commits its immutable binding, restart the public command once and
			// prepare wholly against the newly selected manifest + epoch. Never carry
			// the prior plan, target proof, or generation facts into the retry.
			if (
				created.code === "activation_epoch_conflict" &&
				generationConflictRetries > 0
			) {
				return await runRunbookRun(input, generationConflictRetries - 1);
			}
			return emitPlatformStoreFailure(
				input,
				platformStoreFailureOf(created.code, created.message),
			);
		}
		run = created.run;
	} else if (run.runbook_progress === undefined) {
		const upgraded = await persistRunbookPrivateState(
			store.deps,
			run,
			(current) => ({
				...current,
				...(current.runbook_progress === undefined
					? { runbook_progress: progress }
					: {}),
			}),
		);
		if (!upgraded.ok) {
			return emitPlatformStoreFailure(input, upgraded.failure);
		}
		run = upgraded.run;
	}

	// Hold the run's fenced profile lease across reproof, auth, execution, and
	// outcome commit. A concurrent resume may inspect the target, but it cannot
	// dispatch a second executor while this command owns the durable truth.
	const dispatchLease = await acquireLease(store.deps, {
		key: leaseKeyForRun(run),
		holderId: `runbook-dispatch-${run.run_id}`,
		ttlMs: RUNBOOK_DISPATCH_LEASE_TTL_MS,
	});
	if (!dispatchLease.ok) {
		return emitPlatformStoreFailure(
			input,
			platformStoreFailureOf(
				dispatchLease.code,
				dispatchLease.code === "lease_held"
					? dispatchLease.continuation.summary
					: dispatchLease.message,
			),
		);
	}
	const dispatchClaim: LeaseWriteClaim = {
		fencing_token: dispatchLease.lease.fencing_token,
		activation_epoch: dispatchLease.lease.activation_epoch,
		holderId: dispatchLease.lease.holder_id,
	};
	const dispatchHeartbeat = startRunbookDispatchLeaseHeartbeat(
		store.deps,
		dispatchLease.lease,
	);
	try {
	// Sensitive Run Guard (auth plan U4): attach at run resolution. The run stays
	// non-sensitive until confidential delivery participates. A confidential
	// runbook turns the run sensitive exactly once when the auth-delivery context
	// engages (below); the guard is held for the command's lifetime.
	const guardResult = beginSensitiveRunGuard(run.run_id);
	const guard = guardResult.ok ? guardResult.guard : undefined;

	// Auth-delivery wiring (auth plan U11): the Browser Authentication provider is
	// constructed ONLY when the runtime carries a native Token Retrieval Port
	// (store + tokenRetrieval + the store-backed attestation lookup). On this
	// (unsigned) machine the port is absent, so no seam is threaded and the engine
	// fails a confidential runbook closed with a typed native-capability-absent
	// repair pointer — never a public bypass. When the port exists, the provider
	// builds the sensitive-interval delivery context the agent-browser executor
	// routes each confidential fill through.
	const tokenRetrieval = input.runtime.authTokenRetrieval;
	const authProvider =
		tokenRetrieval !== undefined
			? createBrowserUseAuthProvider({
					store: store.deps,
					tokenRetrieval,
					attestationByDigest: attestationByDigestFrom(store.deps),
				})
			: undefined;
	const authExpectedTargetUrl =
		plan.auth_context_ref !== undefined &&
		targetResolution.target_url === "about:blank" &&
		plan.steps[0]?.kind === "open"
			? plan.steps[0].url
			: targetResolution.target_url;
	let executionExpectedTargetUrl = targetResolution.target_url;

	if (plan.auth_context_ref !== undefined) {
		const actionPolicyHash =
			run.run_execution_binding?.action_registry_digest ??
			run.run_execution_binding?.runbook_digest;
		if (authProvider === undefined || tokenRetrieval === undefined) {
			return await recordTaskRunOutcome(
				input,
				store.deps,
				run,
				{ lane_id: "agent-browser", source: "intent-preferred", intent: "runbook-execution" },
				{
					kind: "blocked",
					state: "awaiting-auth",
					continuation: {
						next_action_id: "enroll-browser-automation-token",
						summary: "Enroll or repair the Browser Automation service-account token.",
					},
					mutationDispatched: false,
					failure: {
						code: "runbook_auth_capability_absent",
						message: "runbook authentication requires the native Token Retrieval capability.",
						actionId: "inspect_task_run_result",
						exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
						recoverability: "repair_state",
					},
				},
				{ runbookNextStep: resumeFromStep, heldClaim: dispatchClaim },
			);
		}
		const authTransport =
			input.runtime.runbookAuthTransport?.() ??
			createWebSocketTargetTransport(
				rawHandoffData as AgentBrowserVerifiedHandoff,
			);
		try {
			const authTarget = await resolveBrowserUseCdpTargetIdentity(
				authTransport.transport,
				{
					expected_url: targetResolution.target_url,
					allowed_origins: plan.allowed_origins,
				},
			);
			if (!authTarget.ok) {
				return emitPlatformStoreFailure(
					input,
					runbookFailureOf(
						authTarget.cause,
						"the adapter-selected page could not be resolved to one browser-level CDP target.",
					),
				);
			}
			const deliver = environmentLoginDeliveryHook({
				tokenRetrieval,
				handoff: rawHandoffData as AgentBrowserVerifiedHandoff,
			});
			if (deliver === undefined) {
				return emitPlatformStoreFailure(input, {
					code: "runbook_auth_delivery_unavailable",
					message: "the native credential lane cannot redeem a generic login field.",
					actionId: "inspect_shared_run",
					exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
					recoverability: "repair_state",
				});
			}
			const authenticated = await runBrowserUseRunbookAuth(
				{
					store: store.deps,
					provider: authProvider,
					implementation_integrity_key: "agent-browser:verified-handoff-v2",
					...(input.runtime.runbookApprovedBindingResolver === undefined
						? {}
						: {
								resolveApprovedBinding:
									input.runtime.runbookApprovedBindingResolver,
							}),
					...(input.runtime.runbookHumanIdentityAttestation === undefined
						? {}
						: {
								humanIdentityAttestation:
									input.runtime.runbookHumanIdentityAttestation,
							}),
					login: {
						observer: createBrowserUseCdpObserver(authTransport.transport),
						proveTarget: async (proofInput) =>
							await mintBrowserUseVerifiedTarget(authTransport.transport, proofInput),
						tokenRetrieval,
						deliver,
						waitForPostActivation: async () =>
							await new Promise<void>((resolve) => setTimeout(resolve, 50)),
						...(input.runtime.runbookAuthenticatedStateProof !== undefined
							? { proveAuthenticatedState: input.runtime.runbookAuthenticatedStateProof }
							: {}),
					},
					navigateToDeclaredTarget: async (navigation) =>
						await navigateRunbookAuthTarget(
							authTransport.transport,
							navigation,
						),
				},
				{
					run,
					dispatch_claim: dispatchClaim,
					service_id: plan.service_id,
					flow_id: plan.flow_id,
					action_policy_hash: actionPolicyHash ?? null,
					auth_context_ref: plan.auth_context_ref as BrowserUseAuthContext,
					allowed_origins: plan.allowed_origins,
					expected_url: authExpectedTargetUrl,
					observed_url: targetResolution.target_url,
					target_id: authTarget.target.target_id,
				},
			);
			if (!authenticated.ok) {
				if ("blocked" in authenticated) {
					return emitSharedRunSuccess({
						command: input,
						run: authenticated.run,
						continuationId: authenticated.blocked.continuation.next_action_id,
						dataExtra: { selected_lane: "agent-browser", external_effect: "none" },
					});
				}
				return emitPlatformStoreFailure(
					input,
					platformStoreFailureOf(
						authenticated.failure.code,
						authenticated.failure.message,
					),
				);
			}
			run = authenticated.run;
			const attestation = await revalidateAuthAttestation(
				run,
				{
					at_epoch_ms: input.runtime.now(),
					adapter_id: "agent-browser",
					handoff_evidence_id: handoff.handoffEvidenceId,
				},
				createBrowserUseAuthContract({
					attestationByDigest: attestationByDigestFrom(store.deps),
				}),
			);
			if (!attestation.valid) {
				return emitPlatformStoreFailure(input, {
					code: attestation.code,
					message: attestation.message,
					actionId: "inspect_shared_run",
					exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
					recoverability: "repair_state",
				});
			}
			const postAuthTarget = await resolveAgentBrowserTaskTarget(
				{ runCommand: input.runtime.runCommand },
				{
					handoff: rawHandoffData as AgentBrowserVerifiedHandoff,
					run_id: run.run_id,
					allowed_origins: plan.allowed_origins,
					steps: plan.steps,
					target: {
						kind: "exact",
						tab_id: targetResolution.target_tab_id,
						target_envelope_id: targetEnvelopeId,
					},
				},
			);
			if (!postAuthTarget.ok) {
				return emitPlatformStoreFailure(
					input,
					runbookFailureOf(postAuthTarget.code, postAuthTarget.message),
				);
			}
			if (
				postAuthTarget.binding.target_candidate_id !==
				targetResolution.binding.target_candidate_id
			) {
				return emitPlatformStoreFailure(
					input,
					runbookFailureOf(
						"agent_browser_target_moved",
						"the authenticated target no longer matches the runbook target binding.",
					),
				);
			}
			executionExpectedTargetUrl = postAuthTarget.target_url;
		} finally {
			authTransport.close();
		}
	}
	if (plan.steps.length === 0 && plan.approval_gate !== undefined) {
		return await enterSubmitApprovalGate({
			command: input,
			deps: store.deps,
			run,
			handoff,
			targetTabId: targetResolution.target_tab_id,
			targetUrl: executionExpectedTargetUrl,
			gateStepIndex: plan.approval_gate.runbook_step_index,
			heldClaim: dispatchClaim,
		});
	}

	let dispatchRun = run;
	let mutationMarkerFailure: PlatformStoreFailure | undefined;
	const outcome: BrowserUseRunbookExecutionResult = await executePreparedRunbook(
		{
			runtime: {
				runCommand: input.runtime.runCommand,
				beforeMutationDispatch: async ({ run_id }) => {
					if (run_id !== dispatchRun.run_id) return { ok: false };
					const marked = await persistRunbookMutationDispatch(
						store.deps,
						dispatchRun,
						input.runtime.now(),
						dispatchClaim,
					);
					if (!marked.ok) {
						mutationMarkerFailure = marked.failure;
						return { ok: false };
					}
					dispatchRun = marked.run;
					return { ok: true };
				},
			},
			...(authProvider !== undefined
				? {
						authDelivery: buildRunbookAuthDelivery(authProvider, {
							tokenRetrieval:
								tokenRetrieval as BrowserUseTokenRetrievalPort,
							resolveApprovedBinding:
								input.runtime.runbookApprovedBindingResolver,
							createTargetTransport: createWebSocketTargetTransport,
							createDeliveryHook: environmentDeliveryHook,
						}),
					}
				: {}),
			afterNeutralOpen: async (nextStep) => {
				const checkpointed = await persistRunbookPrivateState(
					store.deps,
					dispatchRun,
					(current) => ({
						...current,
						runbook_progress:
							current.runbook_progress === undefined
								? progress
								: { ...current.runbook_progress, next_step: nextStep },
					}),
					dispatchClaim,
				);
				if (!checkpointed.ok) {
					return false;
				}
				dispatchRun = checkpointed.run;
				return true;
			},
		},
		{
			plan,
			handoff: rawHandoffData as AgentBrowserVerifiedHandoff,
			runId: run.run_id,
			targetTabId: targetResolution.target_tab_id,
			expectedTargetUrl: executionExpectedTargetUrl,
		},
	);
	if (mutationMarkerFailure !== undefined) {
		return emitPlatformStoreFailure(input, mutationMarkerFailure);
	}
	if (!outcome.ok) {
		return emitPlatformStoreFailure(
			input,
			runbookFailureOf(outcome.refusal.code, outcome.refusal.message),
		);
	}
	const heartbeatFailure = dispatchHeartbeat.failure();
	if (heartbeatFailure !== undefined) {
		return emitPlatformStoreFailure(input, heartbeatFailure);
	}

	// Persist the executor's structural truth through the shared pipeline. If
	// confidential delivery engaged (a confidential runbook routed through the
	// auth-delivery context), the run turns sensitive exactly once and the
	// sensitive guard threads through; otherwise the baseline guard flows so
	// recordTaskRunOutcome asserts containment over the committed on-disk run
	// bytes before releasing any governed surface. A delivery whose sentinels
	// could not be registered withholds release (fail closed).
	const dispatchGuard = markGuardForDeliveryOutcome(guard, outcome.result);
	if (!dispatchGuard.ok) {
		return emitTaskRunFailure(
			input,
			run.run_id,
			sentinelRegistrationWithheldFailure(dispatchGuard.reason),
		);
	}
	const mapping = mapRunbookAgentBrowserOutcome(outcome.result);
	const nextStep = nextRunbookStepAfterExecution(
		outcome.plan,
		outcome.result.executed_steps,
	);
	if (mapping.kind === "confirmed" && outcome.plan.approval_gate !== undefined) {
		return await enterSubmitApprovalGate({
			command: input,
			deps: store.deps,
			run: dispatchRun,
			handoff,
			targetTabId: targetResolution.target_tab_id,
			targetUrl: executionExpectedTargetUrl,
			gateStepIndex: outcome.plan.approval_gate.runbook_step_index,
			heldClaim: dispatchClaim,
			structuredResults: outcome.structured_results ?? [],
			...(dispatchGuard.guard !== undefined
				? { guard: dispatchGuard.guard }
				: {}),
		});
	}
	return await recordTaskRunOutcome(
		input,
		store.deps,
		dispatchRun,
		{ lane_id: "agent-browser", source: "intent-preferred", intent: "runbook-execution" },
		mapping,
		{
			...(dispatchGuard.guard !== undefined
				? { guard: dispatchGuard.guard }
				: {}),
			runbookNextStep: nextStep,
			heldClaim: dispatchClaim,
			structuredResults: outcome.structured_results ?? [],
		},
	);
	} finally {
		const currentDispatchLease = await dispatchHeartbeat.stop();
		await releaseLease(store.deps, currentDispatchLease);
	}
}

// New runs use first-class progress. Read the legacy continuation cursor only
// for pre-upgrade records, then persist progress before execution resumes.
function runbookResumeCursorOf(run: BrowserUseSharedRun): number {
	if (run.runbook_progress !== undefined) {
		return run.runbook_progress.next_step;
	}
	const id = run.continuation?.next_action_id ?? "";
	const match = id.match(/^runbook-resume:(\d+)$/);
	return match ? Number(match[1]) : 0;
}

// Read back every persisted governed surface for a run so the containment sweep
// checks the on-disk bytes, not only the in-memory projection (auth plan U4).
// The run.json file is the durable surface; artifacts/diagnostics are added as
// their own surfaces once confidential delivery produces them.
async function collectRunGovernedSurfaces(
	deps: RunStoreDeps,
	runId: string,
): Promise<readonly BrowserUseGovernedSurface[]> {
	const surfaces: BrowserUseGovernedSurface[] = [];
	const read = await readDurableFile(deps.fs, deps.paths.state.runFile(runId));
	if (read.status === "present") {
		surfaces.push({
			kind: "run-store-file",
			label: `run:${runId}`,
			content: read.raw,
		});
	}
	return surfaces;
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
// Clean-break migration commands (platform plan 2026-07-21-002 U3).
//
// inventory/plan/apply/verify drive the migration engine phases against one
// exact --source root; status projects the standing state. Every phase and
// status opens the durable store through the ONE path owner (write access: the
// phases stage frozen snapshots and inactive generations), then maps the
// engine's typed refusal to a fail-closed exit 20 envelope, or its ok:true
// state to the shared migration-status success envelope. RetentionDeps is
// structurally RunStoreDeps, so openPlatformStore's deps feed the engine
// directly. A migration engine refusal NEVER surfaces as the exit-1
// not-implemented stub — it is a typed, recoverable binding failure (R27).
// ---------------------------------------------------------------------------

// Migration engine refusals fail closed at exit 20 (the platform binding exit
// code); their recoverability keys on the refusal class so an agent knows
// whether to correct input, retry, or repair the durable migration state.
function migrationRecoverabilityOf(
	code: BrowserUseMigrationFailure["code"],
): RuntimeErrorRecoverability {
	switch (code) {
		case "migration_source_invalid":
		case "migration_yaml_invalid":
		case "migration_yaml_duplicate_key":
			return "change_input";
		case "migration_source_drift":
		case "store_lock_contended":
			return "retry";
		default:
			// State-missing, disposition-incomplete, collision, verify-mismatch, and
			// store/retention faults all repair the durable migration state.
			return "repair_state";
	}
}

function emitMigrationFailure(
	input: PlatformCommandInput,
	failure: BrowserUseMigrationFailure,
): number {
	const message = redactUnsafeText(failure.message);
	if (input.parsed.outputMode === "plain") {
		input.stderr.write(
			`browser_use ${failure.code}: ${message} (run_id=${input.runId})\n`,
		);
		return BINDING_FAIL_CLOSED_EXIT_CODE;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
			data: {
				command: input.parsed.command,
				result_kind: RESULT_KIND_BY_FAMILY[input.parsed.family],
				caller: input.caller,
			},
			error: createCliRuntimeError({
				run_id: input.runId,
				code: failure.code,
				message,
				exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
				severity: "error",
				...retryabilityForRecoverability(
					migrationRecoverabilityOf(failure.code),
				),
				failure_domain: "browser_use",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return BINDING_FAIL_CLOSED_EXIT_CODE;
}

function emitMigrationState(
	input: PlatformCommandInput,
	state: BrowserUseMigrationState,
): number {
	if (input.parsed.outputMode === "plain") {
		const census = state.corpus_census;
		input.stdout.write(
			platformPlainHeader(BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID, input.caller, [
				`phase=${state.phase}`,
				`snapshot_id=${state.snapshot_id ?? "none"}`,
				`snapshot_digest=${state.snapshot_digest ?? "none"}`,
				`source_entry_count=${state.source_entry_count}`,
				`disposition_count=${state.disposition_count}`,
				`census=${
					census === null
						? "none"
						: `formal_artifacts=${census.formal_artifacts} target_flows=${census.target_flows} scripts=${census.scripts} auth_narratives=${census.auth_narratives} login_capabilities=${census.login_capabilities} domain_script_actions=${census.domain_script_actions}`
				}`,
				`canonical_target_count=${state.canonical_targets.length}`,
				`staged_generation=${state.staged_generation ?? "none"}`,
				`last_apply_verified_noop=${state.last_apply_verified_noop ?? "none"}`,
				`activation_state=${state.activation_state}`,
			]),
		);
		for (const disposition of state.dispositions) {
			input.stdout.write(
				`disposition=${disposition.source_relative_path} class=${disposition.artifact_class} kind=${disposition.disposition} flow=${disposition.formal_flow_id ?? "none"} canonical=${disposition.canonical_target_id ?? "none"} destination=${disposition.logical_destination_id ?? "none"}\n`,
			);
		}
		for (const target of state.canonical_targets) {
			input.stdout.write(
				`canonical_target=${target.canonical_target_id} sources=${target.source_relative_paths.join(",")}\n`,
			);
		}
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				...state,
				result_kind: RESULT_KIND_BY_FAMILY[input.parsed.family],
				caller: input.caller,
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return 0;
}

/**
 * `migration status|inventory|plan|apply|verify` (platform plan U3). status
 * projects the standing migration state; the four phase commands drive the
 * engine against one exact --source root. Typed engine refusals fail closed at
 * exit 20 with their own code and recoverability; a successful phase re-emits
 * the shared migration-status state.
 *
 * @param input - Store-backed command input
 * @returns Process exit code
 */
async function runMigration(input: PlatformCommandInput): Promise<number> {
	const store = await openPlatformStore(input, "write");
	if (!store.ok) return store.exitCode;
	const command = input.parsed.command;
	// RetentionDeps is structurally RunStoreDeps (fs/paths/clock); the engine
	// consumes the same admitted-store deps every other U2 command opens.
	const deps = store.deps;
	let result: { ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure;
	if (command === "migration-status") {
		result = await readBrowserUseMigrationStatus(deps);
	} else {
		// The parser has already proven --source is present for the four phase
		// commands (a bare phase without --source never reaches here).
		const source = stringField(input.parsed.flagValues["--source"]) ?? "";
		const legacyCorpusRoot = join(
			dirname(deps.paths.config.root),
			"side-quest",
			"browser-automation",
			"domains",
		);
		const [canonicalSource, canonicalLegacyCorpusRoot] = await Promise.all([
			deps.fs.realpath(source),
			deps.fs.realpath(legacyCorpusRoot),
		]);
		const expectedCensus =
			canonicalSource !== undefined &&
			canonicalLegacyCorpusRoot !== undefined &&
			normalize(canonicalSource) === normalize(canonicalLegacyCorpusRoot)
				? BROWSER_USE_R3_CORPUS_BASELINE
				: undefined;
		result =
			command === "migration-inventory"
				? await inventoryBrowserUseMigration(deps, source)
				: command === "migration-plan"
					? await planBrowserUseMigration(deps, source, expectedCensus)
					: command === "migration-apply"
						? await applyBrowserUseMigration(deps, source)
						: await verifyBrowserUseMigration(deps, source);
	}
	if (!result.ok) return emitMigrationFailure(input, result);
	return emitMigrationState(input, result.state);
}

// ---------------------------------------------------------------------------
// R27 auth repair surface (auth plan U3a; ADR 0028).
//
// Each subcommand IS a blocked-cause continuation id: an agent holding a
// blocked run's continuation dispatches it verbatim. U3a bodies are pure
// check evaluations over the injected TokenRetrievalPort; the port is ABSENT
// on an unenrolled machine (native custody ships with U3b), and that absence
// is the typed acquire-native-capability state — never a crash, never a stub.
// Blocked evaluations CHAIN: a scope repair blocked on the token names
// enroll-browser-automation-token as its continuation, exactly as the
// blocked-cause table would.
// ---------------------------------------------------------------------------

const authRepairActionList = [
	...browserUseAuthRepairActions,
	...browserUseAuthRepairFailureActions,
] as const;
const authActionById = new Map<string, (typeof authRepairActionList)[number]>(
	authRepairActionList.map((action) => [action.id, action]),
);
type AuthActionId = (typeof authRepairActionList)[number]["id"];

function authAction(id: AuthActionId): RuntimeActionGuidance {
	return actionFor(authActionById, id, "auth repair");
}

/** One typed evaluation: status facts plus exactly one next safe action. */
type AuthReadinessEvaluation = {
	status: string;
	blocked_cause?: string;
	detail?: Record<string, unknown>;
	continuationId: AuthActionId;
};

const AUTH_TOKEN_SUPERVISOR_STATES = new Set([
	"ready",
	"installed",
	"replaced",
	"removed",
	"removed-sync-unproven",
	"missing",
	"cleanup-required",
	"blocked",
]);
export const AUTH_TOKEN_SUPERVISOR_CAUSES = [
	"invalid-arguments",
	"unsafe-ancestry",
	"unsafe-config-root",
	"unsafe-custody-directory",
	"backup-exclusion-unproven",
	"sync-exclusion-unproven",
	"token-missing",
	"token-already-installed",
	"token-unsafe",
	"staging-residue",
	"removal-residue",
	"input-cancelled",
	"input-invalid",
	"write-failed",
	"invalid-service-account",
	"invalid-vault-scope",
	"validation-failed",
	"validation-timeout",
	"validation-unavailable",
	"path-identity-changed",
	"atomic-replace-failed",
	"cleanup-failed",
	"parent-sync-failed",
	"core-dump-disable-failed",
	"op-path-not-absolute",
	"op-path-unapproved",
	"op-path-unavailable",
	"op-path-unsafe",
	"op-path-not-executable",
	"op-binary-untrusted",
	"op-staging-failed",
	"op-version-invalid",
	"op-version-unsupported",
	"op-session-unavailable",
	"token-invalid",
	"timeout",
	"output-too-large",
	"process-failed",
	"process-signalled",
	"io-failure",
	"output-shape-invalid",
	"item-missing",
	"validator-protocol-invalid",
	"profile-policy-unproven",
	"profile-policy-unsafe",
	"source-file-unsafe",
	"source-fetch-failed",
	"source-missing",
	"source-reference-invalid",
	"source-write-failed",
	"token-supervisor-unavailable",
	"token-supervisor-output-too-large",
] as const;
export type AuthTokenSupervisorCause =
	(typeof AUTH_TOKEN_SUPERVISOR_CAUSES)[number];
const AUTH_TOKEN_SUPERVISOR_CAUSE_SET = new Set<string>(
	AUTH_TOKEN_SUPERVISOR_CAUSES,
);

export const AUTH_TOKEN_GATE_ORDER = [
	"token_file",
	"op",
	"token",
	"vault_scope",
	"profile_policy",
] as const;
export type AuthTokenCustodyGate = (typeof AUTH_TOKEN_GATE_ORDER)[number];
export type AuthTokenDoctorGate = "runtime" | AuthTokenCustodyGate;
export type AuthTokenRepairPosture = "auto-fixable" | "manual-only";
export type AuthTokenRepairPath = {
	repairCommand: string;
	posture: AuthTokenRepairPosture;
	successSignal: string;
	stopCondition: string;
};

const BUILD_TOKEN_SUPERVISOR_REPAIR = {
	repairCommand:
		"bun --cwd runtime/browser-use-environment-auth run build:release",
	posture: "manual-only",
	successSignal:
		"The runtime gate can start the supervisor built from this worktree.",
	stopCondition:
		"Stop if the build fails or the release artifact does not belong to this worktree.",
} as const satisfies AuthTokenRepairPath;

const INSTALL_OP_CLI_REPAIR = {
	repairCommand:
		'brew bundle --file "$HOME/code/dotfiles/config/brew/Brewfile"',
	posture: "manual-only",
	successSignal: "The runtime gate resolves an approved executable OP CLI path.",
	stopCondition:
		"Stop if the resolved OP CLI path remains missing, unsafe, or untrusted.",
} as const satisfies AuthTokenRepairPath;

const AUTHENTICATE_OP_SESSION = {
	repairCommand: "op signin",
	posture: "manual-only",
	successSignal: "The operator OP session passes the bounded identity check.",
	stopCondition: "Stop if the operator session remains locked or unavailable.",
} as const satisfies AuthTokenRepairPath;

const REPAIR_CONFIG_ROOT = {
	repairCommand: "browser-use auth install-token",
	posture: "manual-only",
	successSignal:
		"The browser-use configuration root resolves as an owner-only real directory.",
	stopCondition:
		"Stop if the configuration root ancestry remains missing, linked, or unsafe.",
} as const satisfies AuthTokenRepairPath;

const INSPECT_AUTH_STATUS = {
	repairCommand: "browser-use auth status --json",
	posture: "manual-only",
	successSignal: "The status envelope reports a known cause and typed action.",
	stopCondition:
		"Stop if status remains invalid or does not report a code-owned cause.",
} as const satisfies AuthTokenRepairPath;

const REINSTALL_TOKEN = {
	repairCommand: "browser-use auth install-token --replace",
	posture: "manual-only",
	successSignal: "The token file gate reports ready after atomic replacement.",
	stopCondition:
		"Stop if native validation fails or the prior admitted token cannot be preserved.",
} as const satisfies AuthTokenRepairPath;

const RELOAD_TOKEN = {
	repairCommand: "browser-use auth reload",
	posture: "auto-fixable",
	successSignal: "The token and token file gates both report ready.",
	stopCondition:
		"Stop if the admitted source is absent, invalid, interactive, or still rejected.",
} as const satisfies AuthTokenRepairPath;

const REPAIR_VAULT_GRANT = {
	repairCommand: "browser-use auth repair-vault-grant",
	posture: "manual-only",
	successSignal: "The vault scope gate reports exactly one visible vault.",
	stopCondition:
		"Stop if the grant still exposes zero or multiple vaults after re-proof.",
} as const satisfies AuthTokenRepairPath;

const REPAIR_PROFILE_POLICY = {
	repairCommand: "browser-use auth doctor --fix profile",
	posture: "auto-fixable",
	successSignal: "The profile policy gate reports ready after owner verification.",
	stopCondition:
		"Stop if the profile owner refuses the path, live state, or saved-login state.",
} as const satisfies AuthTokenRepairPath;

const RECREATE_UNSAFE_PROFILE = {
	repairCommand: "browser-use auth doctor --fix profile",
	posture: "manual-only",
	successSignal: "A fresh dedicated profile passes the profile policy gate.",
	stopCondition:
		"Stop before deleting, scrubbing, or rewriting an unsafe existing profile.",
} as const satisfies AuthTokenRepairPath;

export const AUTH_TOKEN_REPAIR_PATHS = {
	"invalid-arguments": INSPECT_AUTH_STATUS,
	"unsafe-ancestry": REINSTALL_TOKEN,
	"unsafe-config-root": REPAIR_CONFIG_ROOT,
	"unsafe-custody-directory": REINSTALL_TOKEN,
	"backup-exclusion-unproven": REINSTALL_TOKEN,
	"sync-exclusion-unproven": REINSTALL_TOKEN,
	"token-missing": RELOAD_TOKEN,
	"token-already-installed": INSPECT_AUTH_STATUS,
	"token-unsafe": REINSTALL_TOKEN,
	"staging-residue": REINSTALL_TOKEN,
	"removal-residue": REINSTALL_TOKEN,
	"input-cancelled": REINSTALL_TOKEN,
	"input-invalid": REINSTALL_TOKEN,
	"write-failed": REINSTALL_TOKEN,
	"invalid-service-account": RELOAD_TOKEN,
	"invalid-vault-scope": REPAIR_VAULT_GRANT,
	"validation-failed": RELOAD_TOKEN,
	"validation-timeout": RELOAD_TOKEN,
	"validation-unavailable": INSTALL_OP_CLI_REPAIR,
	"path-identity-changed": REINSTALL_TOKEN,
	"atomic-replace-failed": REINSTALL_TOKEN,
	"cleanup-failed": REINSTALL_TOKEN,
	"parent-sync-failed": REINSTALL_TOKEN,
	"core-dump-disable-failed": REINSTALL_TOKEN,
	"op-path-not-absolute": INSTALL_OP_CLI_REPAIR,
	"op-path-unapproved": INSTALL_OP_CLI_REPAIR,
	"op-path-unavailable": INSTALL_OP_CLI_REPAIR,
	"op-path-unsafe": INSTALL_OP_CLI_REPAIR,
	"op-path-not-executable": INSTALL_OP_CLI_REPAIR,
	"op-binary-untrusted": INSTALL_OP_CLI_REPAIR,
	"op-staging-failed": INSTALL_OP_CLI_REPAIR,
	"op-version-invalid": INSTALL_OP_CLI_REPAIR,
	"op-version-unsupported": INSTALL_OP_CLI_REPAIR,
	"op-session-unavailable": AUTHENTICATE_OP_SESSION,
	"token-invalid": RELOAD_TOKEN,
	timeout: RELOAD_TOKEN,
	"output-too-large": RELOAD_TOKEN,
	"process-failed": RELOAD_TOKEN,
	"process-signalled": RELOAD_TOKEN,
	"io-failure": RELOAD_TOKEN,
	"output-shape-invalid": INSTALL_OP_CLI_REPAIR,
	"item-missing": REINSTALL_TOKEN,
	"validator-protocol-invalid": INSTALL_OP_CLI_REPAIR,
	"profile-policy-unproven": REPAIR_PROFILE_POLICY,
	"profile-policy-unsafe": RECREATE_UNSAFE_PROFILE,
	"source-file-unsafe": REINSTALL_TOKEN,
	"source-fetch-failed": REINSTALL_TOKEN,
	"source-missing": REINSTALL_TOKEN,
	"source-reference-invalid": REINSTALL_TOKEN,
	"source-write-failed": REINSTALL_TOKEN,
	"token-supervisor-unavailable": BUILD_TOKEN_SUPERVISOR_REPAIR,
	"token-supervisor-output-too-large": BUILD_TOKEN_SUPERVISOR_REPAIR,
} as const satisfies Record<AuthTokenSupervisorCause, AuthTokenRepairPath>;

const AUTH_TOKEN_EXPLAIN_PATHS = {
	runtime: {
		repairCommand: "browser-use auth status --json",
		posture: "manual-only",
		successSignal: "The runtime gate reports a code-owned cause.",
		stopCondition:
			"Stop and explain the unmapped runtime cause before attempting repair.",
	},
	token_file: {
		repairCommand: "browser-use auth status --json",
		posture: "manual-only",
		successSignal: "The token file gate reports a code-owned cause.",
		stopCondition:
			"Stop and explain the unmapped token file cause before attempting repair.",
	},
	op: {
		repairCommand: "browser-use auth status --json",
		posture: "manual-only",
		successSignal: "The OP gate reports a code-owned cause.",
		stopCondition:
			"Stop and explain the unmapped OP cause before attempting repair.",
	},
	token: {
		repairCommand: "browser-use auth status --json",
		posture: "manual-only",
		successSignal: "The token gate reports a code-owned cause.",
		stopCondition:
			"Stop and explain the unmapped token cause before attempting repair.",
	},
	vault_scope: {
		repairCommand: "browser-use auth status --json",
		posture: "manual-only",
		successSignal: "The vault scope gate reports a code-owned cause.",
		stopCondition:
			"Stop and explain the unmapped vault scope cause before attempting repair.",
	},
	profile_policy: {
		repairCommand: "browser-use auth status --json",
		posture: "manual-only",
		successSignal: "The profile policy gate reports a code-owned cause.",
		stopCondition:
			"Stop and explain the unmapped profile policy cause before attempting repair.",
	},
} as const satisfies Record<AuthTokenDoctorGate, AuthTokenRepairPath>;

export function authTokenRepairPathFor(
	cause: string,
	gate: AuthTokenDoctorGate,
): AuthTokenRepairPath {
	return Object.hasOwn(AUTH_TOKEN_REPAIR_PATHS, cause)
		? AUTH_TOKEN_REPAIR_PATHS[cause as AuthTokenSupervisorCause]
		: AUTH_TOKEN_EXPLAIN_PATHS[gate];
}
const AUTH_TOKEN_SUPERVISOR_ACTIONS = new Set<AuthActionId>([
	"auth-status",
	"rerun-confidential-command",
	"repair-token-custody",
	"repair-op-admission",
	"build-token-supervisor",
	"install-op-cli",
	"authenticate-op-session",
	"repair-config-root",
	"repair-vault-grant",
	"create-credential-clean-profile",
	"revoke-service-account-token-remotely",
	"install-token",
]);
const AUTH_TOKEN_CHECK_STATUSES = new Set([
	"ready",
	"blocked",
	"missing",
	"unproven",
]);

type AuthTokenSupervisorProjection = {
	ok: boolean;
	state: string;
	cause?: string;
	nextAction: AuthActionId;
	detail?: Record<string, unknown>;
};

type AuthDoctorOwnerSpawnInput = {
	argv: readonly string[];
	env: Record<string, string | undefined>;
	timeoutMs: number;
};

type AuthDoctorOwnerResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	failureReason?: "owner_output_too_large" | "owner_spawn_failed";
};

type AuthDoctorOrchestrationDeps = {
	spawnOwner?: (
		input: AuthDoctorOwnerSpawnInput,
	) => Promise<AuthDoctorOwnerResult>;
	warmChromeEntrypoint?: string | null;
};

const AUTH_DOCTOR_PROFILE_OWNER_TIMEOUT_MS = 10_000;
const AUTH_DOCTOR_VAULT_OWNER_TIMEOUT_MS = 10_000;

async function spawnAuthDoctorOwner(
	input: AuthDoctorOwnerSpawnInput,
): Promise<AuthDoctorOwnerResult> {
	const child = Bun.spawn([...input.argv], {
		env: input.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		timeout: input.timeoutMs,
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		readBoundedAuthChildOutput(child.stdout, child),
		readBoundedAuthChildOutput(child.stderr, child),
		child.exited,
	]);
	if (!stdout.ok || !stderr.ok) {
		return {
			exitCode,
			stdout: "",
			stderr: "",
			timedOut: child.signalCode !== null,
			failureReason: "owner_output_too_large",
		};
	}
	return {
		exitCode,
		stdout: stdout.text,
		stderr: stderr.text,
		// SIGTERM from timeout or external kill; both surface as owner_timeout.
		timedOut: child.signalCode !== null,
	};
}

export const __authDoctorOwnerForTest = {
	spawn: spawnAuthDoctorOwner,
} as const;

function authDoctorOwnerEnv(
	env: Record<string, string | undefined>,
): Record<string, string | undefined> {
	const allowed = [
		"HOME",
		"PATH",
		"LANG",
		"LC_ALL",
		"TMPDIR",
		"XDG_CONFIG_HOME",
		"WARM_CHROME_PROFILE_DIR",
		"OP_ACCOUNT",
	] as const;
	const childEnv: Record<string, string | undefined> = {
		PATH: env.PATH ?? "/usr/bin:/bin",
	};
	for (const key of allowed) {
		if (env[key] !== undefined) childEnv[key] = env[key];
	}
	for (const [key, value] of Object.entries(env)) {
		if (key.startsWith("OP_SESSION_") && value !== undefined) {
			childEnv[key] = value;
		}
	}
	for (const key of AUTH_TOKEN_FORBIDDEN_ENV_KEYS) delete childEnv[key];
	return childEnv;
}

function defaultWarmChromeEntrypoint(): string | undefined {
	const entrypoint = join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"..",
		"..",
		"runtime",
		"warm-chrome",
		"src",
		"cli.ts",
	);
	return existsSync(entrypoint) ? entrypoint : undefined;
}

function authDoctorCheck(
	projection: AuthTokenSupervisorProjection,
	gate: AuthTokenCustodyGate,
): Record<string, unknown> | undefined {
	return recordField(recordField(projection.detail?.checks)?.[gate]);
}

function authDoctorGateIsRed(
	projection: AuthTokenSupervisorProjection,
	gate: AuthTokenCustodyGate,
): boolean {
	return stringField(authDoctorCheck(projection, gate)?.status) !== "ready";
}

function authDoctorGateCause(
	projection: AuthTokenSupervisorProjection,
	gate: AuthTokenCustodyGate,
): string {
	return stringField(authDoctorCheck(projection, gate)?.cause) ?? "unknown";
}

function authDoctorOwnerFailure(result: AuthDoctorOwnerResult): string {
	if (result.failureReason !== undefined) return result.failureReason;
	if (result.timedOut) return "owner_timeout";
	try {
		const envelope = recordField(JSON.parse(result.stdout));
		const code = stringField(recordField(envelope?.error)?.code);
		if (code !== undefined) return code;
	} catch {
		// Owner output is only interpreted when it is a structured envelope.
	}
	return `owner_exit_${result.exitCode}`;
}

function authDoctorOwnerManualStep(
	result: AuthDoctorOwnerResult,
	fallback: string,
): string {
	try {
		const envelope = recordField(JSON.parse(result.stdout));
		const reason = stringField(recordField(envelope?.data)?.reason);
		const message = stringField(recordField(envelope?.error)?.message);
		if (reason !== undefined && message !== undefined) {
			return `reason=${reason}; ${message.replaceAll(/\s+/g, " ").trim()}`;
		}
	} catch {
		// Only a typed owner refusal may replace the fallback repair command.
	}
	return fallback;
}

async function runBoundedAuthDoctorOwner(
	spawnOwner: NonNullable<AuthDoctorOrchestrationDeps["spawnOwner"]>,
	input: AuthDoctorOwnerSpawnInput,
): Promise<AuthDoctorOwnerResult> {
	try {
		return await spawnOwner(input);
	} catch {
		return {
			exitCode: RUNTIME_FAILURE_EXIT_CODE,
			stdout: "",
			stderr: "",
			timedOut: false,
			failureReason: "owner_spawn_failed",
		};
	}
}

async function readAuthDoctorProjection(
	input: PlatformCommandInput,
): Promise<AuthTokenSupervisorProjection> {
	const result =
		input.runtime.runAuthTokenSupervisor === undefined
			? { exitCode: BINDING_FAIL_CLOSED_EXIT_CODE, stdout: "", stderr: "" }
			: await input.runtime.runAuthTokenSupervisor({ mode: "status" });
	return (
		parseAuthTokenSupervisorResult(result.stdout, result.exitCode) ?? {
			ok: false,
			state: "blocked",
			cause: "token-supervisor-unavailable",
			nextAction: "repair-op-admission",
		}
	);
}

async function runAuthDoctorFix(input: PlatformCommandInput): Promise<number> {
	const initial = await readAuthDoctorProjection(input);
	const notes: string[] = [];
	const spawnOwner = input.authDoctor?.spawnOwner ?? spawnAuthDoctorOwner;
	const ownerEnv = authDoctorOwnerEnv(input.runtime.env);
	const browserUseEntrypoint = fileURLToPath(import.meta.url);
	const profileOnly = input.fixScope === "profile";
	let vaultReproofAttempted = false;

	if (recordField(initial.detail?.checks) === undefined) {
		const cause = initial.cause ?? "unknown";
		notes.push(
			`fix runtime: refused; manual: ${authTokenRepairPathFor(cause, "runtime").repairCommand}`,
		);
	} else {
		let tokenDependencyBlocked = false;
		const delegatedCommands = new Set<string>();
		if (!profileOnly) {
			for (const gate of ["token_file", "op", "token"] as const) {
				if (!authDoctorGateIsRed(initial, gate)) continue;
				const cause = authDoctorGateCause(initial, gate);
				const repair = authTokenRepairPathFor(cause, gate);
				if (tokenDependencyBlocked) {
					notes.push(
						`fix ${gate}: skipped; manual: ${repair.repairCommand}`,
					);
					continue;
				}
				if (repair.posture === "manual-only") {
					notes.push(
						`fix ${gate}: refused; manual: ${repair.repairCommand}`,
					);
					tokenDependencyBlocked = true;
					continue;
				}
				if (delegatedCommands.has(repair.repairCommand)) continue;
				delegatedCommands.add(repair.repairCommand);
				const result = await runBoundedAuthDoctorOwner(spawnOwner, {
					argv: [
						process.execPath,
						browserUseEntrypoint,
						"auth",
						"reload",
						"--json",
						"--quiet",
					],
					env: ownerEnv,
					timeoutMs: AUTH_TOKEN_SOURCE_RELOAD_OWNER_TIMEOUT_MS,
				});
				if (result.exitCode === 0 && !result.timedOut) {
					notes.push(`fix ${gate}: delegated`);
				} else {
					notes.push(
						`fix ${gate}: owner_failed reason=${authDoctorOwnerFailure(result)}; manual: ${repair.repairCommand}`,
					);
					tokenDependencyBlocked = true;
				}
			}

			if (authDoctorGateIsRed(initial, "vault_scope")) {
				const repair = authTokenRepairPathFor(
					authDoctorGateCause(initial, "vault_scope"),
					"vault_scope",
				);
				if (tokenDependencyBlocked) {
					notes.push(
						`fix vault_scope: skipped; manual: ${repair.repairCommand}`,
					);
				} else {
					vaultReproofAttempted = true;
					const result = await runBoundedAuthDoctorOwner(spawnOwner, {
						argv: [
							process.execPath,
							browserUseEntrypoint,
							"auth",
							"repair-vault-grant",
							"--json",
							"--quiet",
						],
						env: ownerEnv,
						timeoutMs: AUTH_DOCTOR_VAULT_OWNER_TIMEOUT_MS,
					});
					notes.push(
						result.exitCode === 0 && !result.timedOut
							? "fix vault_scope: re-proved"
							: `fix vault_scope: owner_failed reason=${authDoctorOwnerFailure(result)}; manual: ${repair.repairCommand}`,
					);
				}
			}
		}

		if (authDoctorGateIsRed(initial, "profile_policy")) {
			const cause = authDoctorGateCause(initial, "profile_policy");
			const repair = authTokenRepairPathFor(cause, "profile_policy");
			const profilePath = resolveWarmChromeProfilePath(input.runtime.env);
			const configuredEntrypoint = input.authDoctor?.warmChromeEntrypoint;
			const warmChromeEntrypoint =
				configuredEntrypoint === null
					? undefined
					: configuredEntrypoint ?? defaultWarmChromeEntrypoint();
			const manualCommand =
				profilePath === undefined
					? repair.repairCommand
					: `warm-chrome repair --profile-only --profile ${JSON.stringify(profilePath)}`;
			if (
				profilePath === undefined ||
				warmChromeEntrypoint === undefined
			) {
				notes.push(`fix profile_policy: refused; manual: ${manualCommand}`);
			} else {
				const result = await runBoundedAuthDoctorOwner(spawnOwner, {
					argv: [
						process.execPath,
						warmChromeEntrypoint,
						"repair",
						"--profile-only",
						"--profile",
						profilePath,
						"--json",
						"--quiet",
					],
					env: ownerEnv,
					timeoutMs: AUTH_DOCTOR_PROFILE_OWNER_TIMEOUT_MS,
				});
				if (result.exitCode === 0 && !result.timedOut) {
					notes.push("fix profile_policy: delegated");
				} else {
					const manualStep = authDoctorOwnerManualStep(result, manualCommand);
					notes.push(
						`fix profile_policy: owner_failed reason=${authDoctorOwnerFailure(result)}; manual: ${manualStep}`,
					);
				}
			}
		}
	}

	const finalProjection = await readAuthDoctorProjection(input);
	if (
		vaultReproofAttempted &&
		authDoctorGateIsRed(finalProjection, "vault_scope")
	) {
		notes.push(
			"fix vault_scope: refused; manual: Grant the service account access to exactly one vault in 1Password, then rerun browser-use auth repair-vault-grant",
		);
	}
	if (input.parsed.outputMode === "plain") {
		if (notes.length > 0) input.stdout.write(`${notes.join("\n")}\n`);
		input.stdout.write(renderAuthTokenDoctor(finalProjection));
		return finalProjection.ok ? 0 : BINDING_FAIL_CLOSED_EXIT_CODE;
	}
	return emitAuthTokenLifecycleResult(
		input,
		finalProjection,
		"auth_token_supervisor_failed",
	);
}

function recordField(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function safeAuthTokenCause(value: unknown): string | undefined {
	return typeof value === "string" && AUTH_TOKEN_SUPERVISOR_CAUSE_SET.has(value)
		? value
		: undefined;
}

function safeAuthTokenCheck(value: unknown): Record<string, unknown> | undefined {
	const check = recordField(value);
	if (
		check === undefined ||
		typeof check.status !== "string" ||
		!AUTH_TOKEN_CHECK_STATUSES.has(check.status)
	) {
		return undefined;
	}
	const cause = safeAuthTokenCause(check.cause);
	if (check.cause !== undefined && cause === undefined) return undefined;
	const visibleCount = check.visible_count;
	if (
		visibleCount !== undefined &&
		(!Number.isSafeInteger(visibleCount) || (visibleCount as number) < 0)
	) {
		return undefined;
	}
	return {
		status: check.status,
		...(cause === undefined ? {} : { cause }),
		...(visibleCount === undefined ? {} : { visible_count: visibleCount }),
	};
}

function parseAuthTokenSupervisorResult(
	stdout: string,
	exitCode: number,
): AuthTokenSupervisorProjection | undefined {
	let value: unknown;
	try {
		value = JSON.parse(stdout);
	} catch {
		return undefined;
	}
	const object = recordField(value);
	if (
		object === undefined ||
		object.schema_version !== 1 ||
		typeof object.ok !== "boolean" ||
		typeof object.state !== "string" ||
		!AUTH_TOKEN_SUPERVISOR_STATES.has(object.state) ||
		typeof object.next_action !== "string" ||
		!AUTH_TOKEN_SUPERVISOR_ACTIONS.has(object.next_action as AuthActionId) ||
		(object.ok ? exitCode !== 0 : exitCode !== BINDING_FAIL_CLOSED_EXIT_CODE)
	) {
		return undefined;
	}
	const cause = safeAuthTokenCause(object.cause);
	if (object.cause !== undefined && cause === undefined) return undefined;
	const detail: Record<string, unknown> = {};
	const lane = recordField(object.lane);
	const checks = recordField(object.checks);
	if (lane !== undefined || checks !== undefined) {
		if (
			lane?.selected !== "environment-injected-op" ||
			typeof lane.status !== "string" ||
			!AUTH_TOKEN_CHECK_STATUSES.has(lane.status) ||
			checks === undefined
		) {
			return undefined;
		}
		const safeChecks = {
			token_file: safeAuthTokenCheck(checks.token_file),
			op: safeAuthTokenCheck(checks.op),
			token: safeAuthTokenCheck(checks.token),
			vault_scope: safeAuthTokenCheck(checks.vault_scope),
			profile_policy: safeAuthTokenCheck(checks.profile_policy),
		};
		if (Object.values(safeChecks).some((check) => check === undefined)) {
			return undefined;
		}
		detail.lane = { selected: lane.selected, status: lane.status };
		detail.checks = safeChecks;
	}
	if (object.remote_authority === "may-remain-live") {
		detail.remote_authority = "may-remain-live";
	}
	return {
		ok: object.ok,
		state: object.state,
		...(cause === undefined ? {} : { cause }),
		nextAction: object.next_action as AuthActionId,
		...(Object.keys(detail).length === 0 ? {} : { detail }),
	};
}

function renderAuthTokenDoctor(
	projection: AuthTokenSupervisorProjection,
): string {
	const lane = recordField(projection.detail?.lane);
	const checks = recordField(projection.detail?.checks);
	const lines = [
		"browser-use auth doctor",
		`lane: ${stringField(lane?.selected) ?? "unknown"}`,
		`${"gate".padEnd(16)}${"verdict".padEnd(9)}state`,
	];
	let green = 0;
	let red = 0;
	let unknown = 0;

	if (checks === undefined) {
		const cause = projection.cause ?? "unknown";
		lines.push(
			`${"runtime".padEnd(16)}${"red".padEnd(9)}${projection.state} cause=${cause}`,
			`  repair: ${authTokenRepairPathFor(cause, "runtime").repairCommand}`,
		);
		red += 1;
		for (const gate of AUTH_TOKEN_GATE_ORDER) {
			lines.push(`${gate.padEnd(16)}${"unknown".padEnd(9)}unknown`);
			unknown += 1;
		}
		lines.push(`summary: ${red} red, ${unknown} unknown`);
		return `${lines.join("\n")}\n`;
	}

	for (const gate of AUTH_TOKEN_GATE_ORDER) {
		const check = recordField(checks[gate]);
		const status = stringField(check?.status);
		if (status === undefined) {
			lines.push(`${gate.padEnd(16)}${"unknown".padEnd(9)}unknown`);
			unknown += 1;
			continue;
		}
		const verdict = status === "ready" ? "green" : "red";
		if (verdict === "green") green += 1;
		else red += 1;
		const cause = stringField(check?.cause);
		const visibleCount = check?.visible_count;
		lines.push(
			`${gate.padEnd(16)}${verdict.padEnd(9)}${status}${
				visibleCount === undefined ? "" : ` visible_count=${visibleCount}`
			}${cause === undefined ? "" : ` cause=${cause}`}`,
		);
		if (verdict === "red") {
			lines.push(
				`  repair: ${authTokenRepairPathFor(cause ?? "unknown", gate).repairCommand}`,
			);
		}
	}

	lines.push(
		unknown === 0
			? `summary: ${green} green, ${red} red`
			: `summary: ${green} green, ${red} red, ${unknown} unknown`,
	);
	return `${lines.join("\n")}\n`;
}

function emitAuthTokenLifecycleResult(
	input: PlatformCommandInput,
	projection: AuthTokenSupervisorProjection,
	errorCode:
		| "auth_token_input_rejected"
		| "auth_token_source_invalid"
		| "auth_token_source_auth_required"
		| "auth_token_source_missing"
		| "auth_token_source_unavailable"
		| "auth_token_source_unsafe"
		| "auth_token_source_write_failed"
		| "auth_token_supervisor_failed",
): number {
	const subcommand = input.parsed.subcommand as BrowserUseAuthSubcommand;
	if (subcommand === "doctor" && input.parsed.outputMode === "plain") {
		input.stdout.write(renderAuthTokenDoctor(projection));
		return 0;
	}
	const evaluation = {
		status: projection.state,
		...(projection.cause === undefined
			? {}
			: { blocked_cause: projection.cause }),
		...(projection.detail === undefined ? {} : { detail: projection.detail }),
	};
	if (input.parsed.outputMode === "plain") {
		const line = [
			`action=${subcommand}`,
			`status=${projection.state}`,
			`continuation=${projection.nextAction}`,
			...(projection.cause === undefined
				? []
				: [`blocked_cause=${projection.cause}`]),
		].join(" ");
		const writer = projection.ok ? input.stdout : input.stderr;
		writer.write(
			`${platformPlainHeader(BROWSER_USE_AUTH_READINESS_CONTRACT_ID, input.caller)}${line}\n`,
		);
		return projection.ok ? 0 : BINDING_FAIL_CLOSED_EXIT_CODE;
	}
	const envelopeInput = {
		run_id: input.runId,
		data: {
			contract: BROWSER_USE_AUTH_READINESS_CONTRACT_ID,
			schema_version: BROWSER_USE_AUTH_READINESS_SCHEMA_VERSION,
			action: subcommand === "doctor" ? "status" : subcommand,
			evaluation,
			caller: input.caller,
		},
		runtime_actions: [authAction(projection.nextAction)],
		continuation: { next_action_id: projection.nextAction },
	};
	if (projection.ok) {
		writeJsonEnvelope(
			input.stdout,
			createCliRuntimeSuccessEnvelope(envelopeInput),
			{ runId: input.runId, durationMs: input.durationMs() },
		);
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			...envelopeInput,
			process_exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
			error: createCliRuntimeError({
				run_id: input.runId,
				code: errorCode,
				message: authTokenLifecycleErrorMessage(errorCode),
				exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
				severity: "error",
				...retryabilityForRecoverability("repair_state"),
				failure_domain: "browser_use",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return BINDING_FAIL_CLOSED_EXIT_CODE;
}

function authTokenLifecycleErrorMessage(
	errorCode:
		| "auth_token_input_rejected"
		| "auth_token_source_invalid"
		| "auth_token_source_auth_required"
		| "auth_token_source_missing"
		| "auth_token_source_unavailable"
		| "auth_token_source_unsafe"
		| "auth_token_source_write_failed"
		| "auth_token_supervisor_failed",
): string {
	switch (errorCode) {
		case "auth_token_input_rejected":
			return "token input through process environment is forbidden; use native hidden input or --stdin.";
		case "auth_token_source_invalid":
			return "the source reference is invalid or conflicts with standard input; use one OP item field reference.";
		case "auth_token_source_auth_required":
			return "the operator OP session is unavailable; follow the typed continuation before retrying.";
		case "auth_token_source_missing":
			return "no recorded source is available and standard input is not interactive; use the manual install step.";
		case "auth_token_source_unavailable":
			return "the recorded source could not be fetched; use the manual install step before retrying.";
		case "auth_token_source_unsafe":
			return "the recorded source failed owner-only file validation; use the manual install step.";
		case "auth_token_source_write_failed":
			return "the token changed but its reload source could not be recorded; repeat the source install after inspecting custody.";
		case "auth_token_supervisor_failed":
			return "native token custody operation was blocked; follow the typed continuation.";
	}
}

function authProjectionWithSourcePresence(
	projection: AuthTokenSupervisorProjection,
	sourcePresent: boolean,
): AuthTokenSupervisorProjection {
	return {
		...projection,
		detail: {
			...(projection.detail ?? {}),
			source_present: sourcePresent,
		},
	};
}

function authTokenLifecycleErrorForProjection(
	projection: AuthTokenSupervisorProjection | undefined,
):
	| "auth_token_source_auth_required"
	| "auth_token_source_unavailable"
	| "auth_token_supervisor_failed" {
	if (projection?.cause === "op-session-unavailable") {
		return "auth_token_source_auth_required";
	}
	if (projection?.cause === "source-fetch-failed") {
		return "auth_token_source_unavailable";
	}
	return "auth_token_supervisor_failed";
}

function buildNativeSupervisorInput(
	input: PlatformCommandInput,
	sourceRef: string | undefined,
): AuthTokenSupervisorInput {
	const subcommand = input.parsed.subcommand;
	if (subcommand === "install-token" || subcommand === "reload") {
		if (sourceRef !== undefined) {
			return {
				mode: "install",
				input: "source",
				replace:
					subcommand === "reload" ||
					input.parsed.flagValues["--replace"] !== undefined,
				sourceRef,
			};
		}
		return {
			mode: "install",
			input:
				subcommand === "reload" ||
				input.parsed.flagValues["--stdin"] === undefined
					? "prompt"
					: "stdin",
			replace:
				subcommand === "reload" ||
				input.parsed.flagValues["--replace"] !== undefined,
		};
	}
	if (subcommand === "remove-token") return { mode: "remove" };
	return { mode: "status" };
}

async function runAuthTokenLifecycle(
	input: PlatformCommandInput,
): Promise<number> {
	let sourceRef = stringField(input.parsed.flagValues["--from"]);
	let sourcePresence: boolean | undefined;
	if (
		input.parsed.subcommand === "install-token" &&
		sourceRef !== undefined &&
		(!isAuthTokenSourceReference(sourceRef) ||
			input.parsed.flagValues["--stdin"] !== undefined)
	) {
		return emitAuthTokenLifecycleResult(
			input,
			{
				ok: false,
				state: "blocked",
				cause: "input-invalid",
				nextAction: "install-token",
			},
			"auth_token_source_invalid",
		);
	}
	if (
		AUTH_TOKEN_FORBIDDEN_ENV_KEYS.some(
			(key) => input.runtime.env[key] !== undefined,
		)
	) {
		return emitAuthTokenLifecycleResult(
			input,
			{
				ok: false,
				state: "blocked",
				cause: "input-invalid",
				nextAction: "install-token",
			},
			"auth_token_input_rejected",
		);
	}
	if (
		input.parsed.subcommand === "doctor" &&
		input.parsed.flagValues["--fix"] !== undefined
	) {
		return runAuthDoctorFix(input);
	}
	if (input.parsed.subcommand === "reload") {
		const stored =
			input.runtime.readAuthTokenSource === undefined
				? ({ status: "blocked", cause: "source-file-unsafe" } as const)
				: await input.runtime.readAuthTokenSource();
		if (stored.status === "blocked") {
			return emitAuthTokenLifecycleResult(
				input,
				{
					ok: false,
					state: "blocked",
					cause: stored.cause,
					nextAction: "install-token",
					detail: { source_present: false },
				},
				stored.cause === "source-reference-invalid"
					? "auth_token_source_invalid"
					: "auth_token_source_unsafe",
			);
		}
		if (stored.status === "missing") {
			sourcePresence = false;
			if (input.runtime.stdinIsTTY?.() !== true) {
				return emitAuthTokenLifecycleResult(
					input,
					{
						ok: false,
						state: "blocked",
						cause: "source-missing",
						nextAction: "install-token",
						detail: { source_present: false },
					},
					"auth_token_source_missing",
				);
			}
		} else {
			sourceRef = stored.sourceRef;
			sourcePresence = true;
		}
	}
	const subcommand = input.parsed.subcommand;
	const nativeInput = buildNativeSupervisorInput(input, sourceRef);
	const result =
		input.runtime.runAuthTokenSupervisor === undefined
			? {
					exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
					stdout: "",
					stderr: "",
				}
			: await input.runtime.runAuthTokenSupervisor(nativeInput);
	const projection = parseAuthTokenSupervisorResult(
		result.stdout,
		result.exitCode,
	);
	if (subcommand === "install-token" && sourceRef !== undefined && projection?.ok) {
		const persisted =
			input.runtime.writeAuthTokenSource === undefined
				? ({ ok: false, cause: "source-write-failed" } as const)
				: await input.runtime.writeAuthTokenSource(sourceRef);
		if (!persisted.ok) {
			return emitAuthTokenLifecycleResult(
				input,
				{
					ok: false,
					state: "blocked",
					cause: persisted.cause,
					nextAction: "install-token",
					detail: { source_present: false },
				},
				persisted.cause === "source-write-failed"
					? "auth_token_source_write_failed"
					: "auth_token_source_unsafe",
			);
		}
		return emitAuthTokenLifecycleResult(
			input,
			authProjectionWithSourcePresence(projection, true),
			"auth_token_supervisor_failed",
		);
	}
	if (subcommand === "install-token" && sourceRef === undefined && projection?.ok) {
		const removed =
			input.runtime.removeAuthTokenSource === undefined
				? ({ ok: false, cause: "source-write-failed" } as const)
				: await input.runtime.removeAuthTokenSource();
		if (!removed.ok) {
			return emitAuthTokenLifecycleResult(
				input,
				{
					ok: false,
					state: "blocked",
					cause: removed.cause,
					nextAction: "install-token",
					detail: { source_present: false },
				},
				removed.cause === "source-write-failed"
					? "auth_token_source_write_failed"
					: "auth_token_source_unsafe",
			);
		}
		return emitAuthTokenLifecycleResult(
			input,
			projection,
			"auth_token_supervisor_failed",
		);
	}
	return emitAuthTokenLifecycleResult(
		input,
		projection === undefined
			? {
					ok: false,
					state: "blocked",
					cause: "token-supervisor-unavailable",
					nextAction: "repair-op-admission",
				}
			: sourcePresence === undefined
				? projection
				: authProjectionWithSourcePresence(projection, sourcePresence),
		authTokenLifecycleErrorForProjection(projection),
	);
}

// Map a retrieval block back onto the ONE repair command that discharges it;
// causes outside the four dispatchable continuations route to inspection.
function authContinuationForCause(cause: string): AuthActionId {
	switch (cause) {
		case "missing-token":
			return "install-token";
		case "invalid-vault-scope":
			return "repair-vault-grant";
		case "revoked-binding":
			return "repair-item-binding";
		case "binding-approval-required":
		case "ambiguous-binding-selection":
			return "request-binding-selection-grant";
		default:
			return "inspect-auth-readiness";
	}
}

const NATIVE_CAPABILITY_ABSENT: AuthReadinessEvaluation = {
	status: "native-capability-absent",
	blocked_cause: "missing-token",
	continuationId: "install-token",
};

// Retrieval blocked before the evaluation could answer: report the block's
// cause and chain to its discharging command.
function retrievalBlockedEvaluation(
	rejection: BrowserUseTokenRetrievalRejection,
): AuthReadinessEvaluation {
	const block = blockOfRetrievalRejection(rejection);
	return {
		status: "retrieval-rejected",
		blocked_cause: block.blocked_cause,
		detail: { rejection_code: rejection.code },
		continuationId: authContinuationForCause(block.blocked_cause),
	};
}

async function evaluateAuthReadiness(
	subcommand: BrowserUseAuthRepairSubcommand,
	input: PlatformCommandInput,
): Promise<AuthReadinessEvaluation> {
	const port = input.runtime.authTokenRetrieval;
	if (port === undefined) return NATIVE_CAPABILITY_ABSENT;
	switch (subcommand) {
		case "enroll-browser-automation-token": {
			const vaults = await port.listVaults();
			if (!vaults.ok) {
				// Every token-lifecycle failure is the legal missing-token state;
				// re-enrollment is native custody, so the honest next action is
				// the U3b gate, not this command again.
				const block = blockOfRetrievalRejection(vaults.rejection);
				return {
					status: "token-rejected",
					blocked_cause: block.blocked_cause,
					detail: { rejection_code: vaults.rejection.code },
					continuationId: "install-token",
				};
			}
			return {
				status: "token-operational",
				continuationId: "inspect-auth-readiness",
			};
		}
		case "repair-vault-grant": {
			const vaults = await port.listVaults();
			if (!vaults.ok) return retrievalBlockedEvaluation(vaults.rejection);
			const proof = proveVaultScope(vaults.vaults);
			if (proof.ok) {
				return {
					status: "scope-proven",
					detail: { vault_id: proof.vault_id },
					continuationId: "inspect-auth-readiness",
				};
			}
			// Zero or multiple visible vaults: the grant itself needs the human
			// repair the cause table names; the command stays the continuation.
			return {
				status: "invalid-vault-scope",
				blocked_cause: proof.blocked_cause,
				detail: { visible_count: proof.visible_count },
				continuationId: "repair-vault-grant",
			};
		}
		case "repair-item-binding": {
			const vaultId = stringField(input.parsed.flagValues["--vault-id"]) ?? "";
			const itemId = stringField(input.parsed.flagValues["--item-id"]) ?? "";
			const item = await port.getLoginItem({
				vault_id: vaultId,
				item_id: itemId,
			});
			if (!item.ok) {
				const block = blockOfRetrievalRejection(item.rejection);
				return {
					status: "binding-unusable",
					blocked_cause: block.blocked_cause,
					detail: { rejection_code: item.rejection.code },
					continuationId: authContinuationForCause(block.blocked_cause),
				};
			}
			return {
				status: "binding-live",
				detail: {
					vault_id: item.item.vault_id,
					item_id: item.item.item_id,
					item_state: item.item.state,
					supported_methods: item.item.supported_methods,
				},
				continuationId: "inspect-auth-readiness",
			};
		}
		case "request-binding-selection-grant": {
			const vaultId = stringField(input.parsed.flagValues["--vault-id"]) ?? "";
			const items = await port.listLoginItems({ vault_id: vaultId });
			if (!items.ok) return retrievalBlockedEvaluation(items.rejection);
			// The selection set the signed one-use grant must bind (R20).
			// Signing needs the native Approval Broker — absent until U3b — so
			// the projection is honest about what remains.
			return {
				status: "selection-candidates-projected",
				detail: {
					vault_id: vaultId,
					candidate_count: items.items.length,
					candidates: items.items.map((item, index) => ({
						ordinal: index + 1,
						item_id: item.item_id,
						item_state: item.state,
					})),
				},
				continuationId: "acquire-native-capability",
			};
		}
	}
}

function emitAuthContinuationMismatch(
	input: PlatformCommandInput,
	runId: string,
	persistedActionId: string | undefined,
): number {
	const persisted = persistedActionId ?? "none";
	const message = redactUnsafeText(
		`run ${runId} does not name ${input.parsed.subcommand} as its next safe action (persisted continuation: ${persisted}).`,
	);
	if (input.parsed.outputMode === "plain") {
		input.stderr.write(
			`browser_use auth_continuation_mismatch: ${message} action=follow_run_continuation (run_id=${input.runId})\n`,
		);
		return BINDING_FAIL_CLOSED_EXIT_CODE;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
			data: {
				command: input.parsed.command,
				result_kind: RESULT_KIND_BY_FAMILY[input.parsed.family],
				// The shared run the caller asked about — distinct from the
				// envelope's own run_id (the CLI invocation id).
				requested_run_id: runId,
				persisted_continuation_id: persistedActionId ?? null,
				caller: input.caller,
			},
			runtime_actions: [authAction("follow_run_continuation")],
			continuation: { next_action_id: "follow_run_continuation" },
			error: createCliRuntimeError({
				run_id: input.runId,
				code: "auth_continuation_mismatch",
				message,
				exit_code: BINDING_FAIL_CLOSED_EXIT_CODE,
				severity: "error",
				...retryabilityForRecoverability("change_input"),
				failure_domain: "browser_use",
			}),
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return BINDING_FAIL_CLOSED_EXIT_CODE;
}

/**
 * The four `auth <continuation-id>` commands (R27). With `--run`: the run's
 * own persisted continuation must name this command — the run stays the one
 * truth about its next safe action — then the evaluation runs and the
 * envelope carries both the run binding and the typed evaluation. Without
 * `--run`: a standalone readiness evaluation.
 *
 * @param input - Store-backed command input
 * @returns Process exit code
 */
async function runAuthReadiness(input: PlatformCommandInput): Promise<number> {
	const subcommand = input.parsed.subcommand as BrowserUseAuthRepairSubcommand;
	const runFlag = stringField(input.parsed.flagValues["--run"]);
	let runBinding:
		| { run_id: string; state: BrowserUseRunState; continuation_id: string }
		| undefined;
	if (runFlag !== undefined) {
		const store = await openPlatformStore(input);
		if (!store.ok) return store.exitCode;
		const loaded = await loadSharedRun(store.deps, runFlag);
		if (!loaded.ok) {
			return emitPlatformStoreFailure(
				input,
				platformStoreFailureOf(loaded.code, loaded.message),
			);
		}
		const persisted = loaded.run.continuation?.next_action_id;
		if (persisted !== subcommand) {
			return emitAuthContinuationMismatch(input, runFlag, persisted);
		}
		// Sensitive Run Guard (auth plan U4): attach once per run just after the
		// run is resolved. This U3a readiness check emits only a non-secret
		// readiness projection, so the guard stays non-sensitive and the surface
		// releases normally; the seam is wired for when native auth custody
		// (token launcher, approval broker) lands in U3b and participates in
		// confidential delivery.
		const guardResult = beginSensitiveRunGuard(loaded.run.run_id);
		void (guardResult.ok ? guardResult.guard : undefined);
		runBinding = {
			run_id: loaded.run.run_id,
			state: loaded.run.state,
			continuation_id: persisted,
		};
	}
	const evaluation = await evaluateAuthReadiness(subcommand, input);
	if (input.parsed.outputMode === "plain") {
		input.stdout.write(
			platformPlainHeader(BROWSER_USE_AUTH_READINESS_CONTRACT_ID, input.caller, [
				`action=${subcommand}`,
				`continuation=${evaluation.continuationId}`,
			]),
		);
		input.stdout.write(
			[
				`status=${evaluation.status}`,
				...(evaluation.blocked_cause !== undefined
					? [`blocked_cause=${evaluation.blocked_cause}`]
					: []),
				...(runBinding !== undefined
					? [`run_id=${runBinding.run_id}`, `run_state=${runBinding.state}`]
					: []),
			].join(" ") + "\n",
		);
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data: {
				contract: BROWSER_USE_AUTH_READINESS_CONTRACT_ID,
				schema_version: BROWSER_USE_AUTH_READINESS_SCHEMA_VERSION,
				action: subcommand,
				evaluation: {
					status: evaluation.status,
					...(evaluation.blocked_cause !== undefined
						? { blocked_cause: evaluation.blocked_cause }
						: {}),
					...(evaluation.detail !== undefined
						? { detail: evaluation.detail }
						: {}),
				},
				...(runBinding !== undefined ? { run: runBinding } : {}),
				caller: input.caller,
			},
			runtime_actions: [authAction(evaluation.continuationId)],
			continuation: { next_action_id: evaluation.continuationId },
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
	// The last-resort emitter must be total. redactUnsafeText scrubs VALUES
	// (op:// refs, sensitive --flags, paths) while the envelope leak-guard
	// bans VOCABULARY, so a message can pass the scrub and still be rejected
	// (e.g. an upstream CliRuntimeContractError whose issue text quotes a
	// banned label). Withhold the message rather than crash with a stack trace.
	const buildError = (message: string) =>
		createCliRuntimeError({
			run_id: input.runId,
			code: isUsage ? "usage_error" : "runtime_error",
			message,
			exit_code: exitCode,
			severity: isUsage ? "error" : "fatal",
			recoverability: isUsage ? "change_input" : "none",
			retryable: false,
			failure_domain: isUsage ? "input" : "runtime_diagnostics",
		});
	let structuredError: ReturnType<typeof buildError>;
	try {
		structuredError = buildError(safeMessage);
	} catch {
		structuredError = buildError(
			"runtime error message withheld: it did not pass the runtime-contract text safety gate.",
		);
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: exitCode,
			error: structuredError,
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
	authDoctor?: AuthDoctorOrchestrationDeps,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runBrowserUseCli(argv, {
		runtime,
		stdout,
		stderr,
		...(authDoctor === undefined ? {} : { authDoctor }),
	});
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
	decodeStdinChunks,
} from "./browser-use-runtime";
export {
	type OperationResolution,
	type OperationResolutionInput,
	type OperationTargetHints,
	resolveOperationTarget,
} from "./browser-use-selection";

// Test-only seam over the confidential-delivery run-driver internals (auth
// plan U5). Exposes the private helpers a driver test needs to prove the
// end-to-end seam — deriving the run-scoped sentinel nonce, marking the guard
// sensitive from a delivery outcome, translating a sentinel-registration
// refusal into the withheld failure, and the outcome recorder whose release
// gate sweeps the on-disk run bytes plus the pending envelope — without
// widening the public CLI surface. Not part of any command contract.
export const __confidentialDeliveryDriverForTest = {
	runScopedSentinelNonce,
	markGuardForDeliveryOutcome,
	collectRunGovernedSurfaces,
	sentinelRegistrationWithheldFailure,
	recordTaskRunOutcome,
	emitSubmitApprovalGate,
	buildRunbookAuthDelivery,
	environmentDeliveryHook,
} as const;

if (import.meta.main) {
	const exitCode = await runBrowserUseCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
