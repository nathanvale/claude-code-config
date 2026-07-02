#!/usr/bin/env bun

import { createHash, randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import {
	chmod,
	link,
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	type AgentHintActionForRecoverability,
	type AgentHintForRecoverability,
	type CliRuntimeSuccessEnvelope,
	createCliRuntimeError,
	createCliRepairStateRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	renderCommandUsage,
} from "@side-quest/cli-command-facade";
import {
	SKILL_FEEDBACK_CONTRACT_ID,
	SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
	SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
	SKILL_FEEDBACK_CORRELATE_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_DECISION_READINESS_SURFACES,
	SKILL_FEEDBACK_DASHBOARD_CONTRACT_ID,
	SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
	SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
	SKILL_FEEDBACK_PURGE_CONTRACT_ID,
	SKILL_FEEDBACK_PURGE_LANES,
	SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_QUEUE_CONTRACT_ID,
	SKILL_FEEDBACK_QUEUE_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_REPORT_CONTRACT_ID,
	SKILL_FEEDBACK_REPORT_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_REPORTS_CONTRACT_ID,
	SKILL_FEEDBACK_REPORTS_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_USAGE_CONTRACT_ID,
	SKILL_FEEDBACK_USAGE_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_OUTCOMES,
	SKILL_FEEDBACK_SCHEMA_VERSION,
	type CaptureMetadata,
	type CloseoutReceipt,
	type CloseoutResultData,
	type SkillFeedbackCorrelateCounts,
	type SkillFeedbackCorrelateMode,
	type SkillFeedbackCorrelateResultData,
	type CorrelationWitnessHealth,
	type CorrelationStatus,
	type EvidenceGap,
	type FrictionCategory,
	type FrictionSignal,
	type HealthClaimReadiness,
	type HealthResultData,
	type HealthWarning,
	type NormalizedSoftwareLearningReport,
	type Receipt,
	type ReportCardSoftwareLearningReport,
	type ReviewReadTarget,
	type ReportCardTarget,
	type ReviewClaimReadiness,
	type ReviewResultData,
	type SkillFeedbackQueueEvidenceStrength,
	type SkillFeedbackQueueResultData,
	type SkillFeedbackPurgeResultData,
	type SkillFeedbackPurgeLane,
	type SkillFeedbackOutcome,
	type SkillFeedbackReportDetailData,
	type SkillFeedbackReportLane,
	type SkillFeedbackReportLaneFilter,
	type SkillFeedbackReportListRow,
	type SkillFeedbackReportMissingField,
	type SkillFeedbackReportSourceFilter,
	type SkillFeedbackReportsResultData,
	type SkillFeedbackUsageResultData,
	type SkillFeedbackUsageSkillRow,
	type SoftwareLearningReport,
	type WriterProofHealth,
	type WriterProofWriteStatus,
	type VerificationBurdenLevel,
	buildSoftwareLearningReport,
	createWriterProof,
	deriveWriterOwnedSkillRunId,
	isSafeReportId,
	parseCloseoutReceipt,
	parseReceipt,
	skillFeedbackContracts,
} from "./command-contract";
import {
	buildHealthResultData,
	buildReviewResultData,
} from "./decision-surface";
import {
	redactReportCardSoftwareLearningReport,
	redactSoftwareLearningReport,
} from "./redaction";
import {
	LOW_SIGNAL_INBOX_DIR,
	type ReviewInboxRead,
	type SkillFeedbackPurgeCandidate,
	type WriterProofKeyRead,
	isLowSignalCodexStopReport,
	readReviewInbox,
	scanPurgeCandidates,
} from "./inbox-read-model";
import type {
	ReadTargetResolution,
	SkillFeedbackRuntime,
	StdinTelemetry,
} from "./runtime-contract";
import {
	applyVerifiedCorrelationWitnesses,
	executeCorrelationRepairCandidates,
	finalizeSkillFeedbackCorrelationWitness as finalizeCorrelationWitnessWorkflow,
	scanCorrelationRepairCandidates,
	type CorrelationRepairScan,
	type FinalizeCorrelationWitnessInput,
	type FinalizeCorrelationWitnessResult,
} from "./correlation-witness-workflow";
import {
	evidenceGap,
	stableReportId,
	uniqueEvidenceGaps,
} from "./report-helpers";
import {
	hasPrivateMode,
	isContainedPath,
	isNodeErrorCode,
	isPermissionErrorCode,
	lstatOptional,
	safeRealpath,
} from "./runtime-file-safety";

export type {
	CorrelationCloseoutCandidate,
	FinalizeCorrelationWitnessInput,
	FinalizeCorrelationWitnessResult,
} from "./correlation-witness-workflow";
export type {
	ReadTargetResolution,
	SkillFeedbackRuntime,
	StdinTelemetry,
} from "./runtime-contract";

const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const INBOX_DIR = ".skill-feedback";
const TRUST_DIR = ".trust";
const TRUST_KEY_FILE = "key";
const PILOT_MARKER_FILE = "pilot_started_at";
const MAX_CLOSEOUT_STDIN_BYTES = 64_000;
const DEFAULT_RUNNER_PROCESS_TIMEOUT_MS = 6_000;
const CLOSEOUT_RECEIPT_DOCS_URL =
	"https://github.com/nathanvale/claude-code-config/blob/main/skills/skill-feedback/references/closeout-receipt.md";
const SKILL_FEEDBACK_HELP_COMMANDS = [
	"dashboard",
	"reports",
	"report",
	"usage",
	"queue",
	"record",
	"closeout",
	"review",
	"health",
	"purge",
	"correlate",
] as const satisfies readonly (keyof typeof skillFeedbackContracts)[];

type HealthCliOutputMode = "json" | "plain" | "dashboard";
type SkillFeedbackErrorRecoverability = "change_input" | "repair_state";

type SkillFeedbackErrorHint<
	TRecoverability extends SkillFeedbackErrorRecoverability = SkillFeedbackErrorRecoverability,
> =
	| string
	| {
			summary: string;
			action?: AgentHintActionForRecoverability<TRecoverability>;
			docs_url?: string;
	  };

type SkillFeedbackErrorOptions =
	| {
			recoverability: "change_input";
			hint: SkillFeedbackErrorHint<"change_input">;
			contract?: SkillFeedbackResultContractId;
			changedState?: "none" | "partial";
			data?: Record<string, unknown>;
	  }
	| {
			recoverability: "repair_state";
			hint: SkillFeedbackErrorHint<"repair_state">;
			contract?: SkillFeedbackResultContractId;
			changedState?: "none" | "partial";
			data?: Record<string, unknown>;
	  };
type SkillFeedbackReadCommand = "review" | "health";
type SkillFeedbackCliOptions = {
	runtime?: SkillFeedbackRuntime;
	runId?: string;
};
type SkillFeedbackCliHandler = (
	argv: readonly string[],
	options: SkillFeedbackCliOptions,
) => Promise<number>;
type ReadOnlyArgsState = {
	plain: boolean;
	targetPath?: string;
};
type SkillFeedbackOkResult<
	Fields extends object = Record<never, never>,
> = { ok: true } & Fields;
type SkillFeedbackErrorResult<
	Fields extends object = Record<never, never>,
> = { ok: false } & Fields;
type SkillFeedbackResult<
	Success extends object = Record<never, never>,
	Failure extends object = Record<never, never>,
> = SkillFeedbackOkResult<Success> | SkillFeedbackErrorResult<Failure>;
type SkillFeedbackRepairFailure = { code: string; hint: string };
type SkillFeedbackRepairResult<
	Success extends object = Record<never, never>,
> = SkillFeedbackResult<Success, SkillFeedbackRepairFailure>;
type ParsedReadOnlyFlag =
	| {
			ok: true;
			nextIndex: number;
			apply: (state: ReadOnlyArgsState) => void;
	  }
	| { ok: false; message: string };
type SkillFeedbackResultContractId =
	| typeof SKILL_FEEDBACK_CONTRACT_ID
	| typeof SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID
	| typeof SKILL_FEEDBACK_REVIEW_CONTRACT_ID
	| typeof SKILL_FEEDBACK_DASHBOARD_CONTRACT_ID
	| typeof SKILL_FEEDBACK_HEALTH_CONTRACT_ID
	| typeof SKILL_FEEDBACK_PURGE_CONTRACT_ID
	| typeof SKILL_FEEDBACK_CORRELATE_CONTRACT_ID
	| typeof SKILL_FEEDBACK_REPORTS_CONTRACT_ID
	| typeof SKILL_FEEDBACK_REPORT_CONTRACT_ID
	| typeof SKILL_FEEDBACK_USAGE_CONTRACT_ID
	| typeof SKILL_FEEDBACK_QUEUE_CONTRACT_ID;

export type SkillFeedbackProcessResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	reportPath?: string;
};

/**
 * Subprocess result shape for repository discovery calls.
 */
export type SkillFeedbackGitResult = {
	ok: boolean;
	stdout: string;
	stderr: string;
	code: number;
};

/**
 * Injectable git runner used by read-target resolution tests.
 */
export type SkillFeedbackGitRunner = (
	args: readonly string[],
	options: { cwd: string },
) => Promise<SkillFeedbackGitResult>;

export type InternalRecordTelemetry = {
	model?: string;
	captureMetadata?: CaptureMetadata;
	detectionId?: string;
};

type SkillFeedbackRuntimeOverrides = Partial<SkillFeedbackRuntime> & {
	runGit?: SkillFeedbackGitRunner;
};

export function createDefaultSkillFeedbackRuntime(
	overrides: SkillFeedbackRuntimeOverrides = {},
): SkillFeedbackRuntime {
	const runGit = overrides.runGit ?? defaultGitRunner;
	const repoRoot = overrides.repoRoot ?? (() => process.cwd());
	return {
		repoRoot,
		resolveReadTarget:
			overrides.resolveReadTarget ??
			((targetPath) =>
				resolveSkillFeedbackReadTarget({
					targetPath,
					cwd: repoRoot(),
					runGit,
				})),
		readGitSha: async () => {
			const cwd = repoRoot();
			const result = await runProcess(["git", "rev-parse", "HEAD"], cwd);
			return result.exitCode === 0 ? result.stdout.trim() : "";
		},
		readSkillVersion: async (skill) => skillVersionFromPackage(skill, repoRoot()),
		readStdinTelemetry: async () => parseStdinTelemetry(await readStdin()),
		checkIgnored: async (repoRoot, relativePath) => {
			const result = await runProcess(
				["git", "-C", repoRoot, "check-ignore", "--quiet", relativePath],
				repoRoot,
			);
			return result.exitCode;
		},
		mkdirPrivate: async (path, mode) => {
			await mkdir(path, { recursive: true, mode });
			await chmod(path, mode);
		},
		writePrivateFile: writeAtomicPrivateFile,
		removeFile: async (path) => {
			await unlink(path);
		},
		lstatPath: (path) => lstat(path),
		realpathPath: (path) => realpath(path),
		readText: (path) => readFile(path, "utf-8"),
		readStdinText: readStdin,
		nowIso: () => new Date().toISOString(),
		...overrides,
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export async function recordSkillFeedbackReceipt(
	rawReceipt: unknown,
	options: {
		runtime?: SkillFeedbackRuntime;
		internalTelemetry?: InternalRecordTelemetry;
		runId?: string;
	} = {},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-record";
	const repoRoot = resolve(runtime.repoRoot());

	const prepared = await prepareReceipt(rawReceipt, runtime, options.internalTelemetry);
	if (!prepared.ok) {
		const namesField =
			prepared.code === "unknown_receipt_field" ||
			prepared.code === "invalid_receipt_field";
		return errorResult(runId, USAGE_EXIT_CODE, prepared.code, prepared.message, {
			recoverability: "change_input",
			hint: namesField
				? prepared.message
				: "Fix the receipt shape and rerun skill-feedback record.",
		});
	}

	if (!isStrictIsoTimestamp(prepared.fields.generated_ts)) {
		return errorResult(
			runId,
			USAGE_EXIT_CODE,
			"invalid_generated_ts",
			"Receipt generated_ts must be a strict ISO timestamp.",
			{
				recoverability: "change_input",
				hint: "Pass generated_ts as an ISO string ending in Z.",
			},
		);
	}

	const parsed = parseReceipt(prepared.fields);
	if (parsed.kind !== "ok" && parsed.kind !== "degraded") {
		return errorResult(
			runId,
			USAGE_EXIT_CODE,
			"invalid_receipt",
			"Receipt did not match the skill-feedback schema.",
			{
				recoverability: "change_input",
				hint: "Remove unknown fields and correct field types.",
			},
		);
	}

	const legacyReport = buildSoftwareLearningReport(
		parsed,
		prepared.captureMetadata,
	);
	const redactedLegacy = redactSoftwareLearningReport(legacyReport);
	const report = buildHookCaptureReport(
		redactedLegacy.value,
		redactedLegacy.redactions,
	);
	const ignoreStatus = await runtime.checkIgnored(repoRoot, `${INBOX_DIR}/`);
	if (ignoreStatus !== 0) {
		return errorResult(
			runId,
			RUNTIME_FAILURE_EXIT_CODE,
			"gitignore_gate_refused",
			"Skill-feedback inbox is not ignored by git.",
			{
				recoverability: "repair_state",
				hint: "Add .skill-feedback/ to the repo gitignore, then rerun.",
			},
		);
	}

	const inbox = await prepareSkillFeedbackInbox(repoRoot, runtime);
	if (!inbox.ok) {
		return errorResult(
			runId,
			RUNTIME_FAILURE_EXIT_CODE,
			inbox.code,
			"Skill-feedback inbox is unsafe.",
			{
				recoverability: "repair_state",
				hint: inbox.hint,
			},
		);
	}
	const lane = isLowSignalCodexStopReport(report) ? "low-signal" : "primary";
	const laneInbox =
		lane === "low-signal"
			? await prepareSkillFeedbackSubdirectory(
					inbox.path,
					LOW_SIGNAL_INBOX_DIR,
					runtime,
				)
			: { ok: true as const, path: inbox.path };
	if (!laneInbox.ok) {
		return errorResult(
			runId,
			RUNTIME_FAILURE_EXIT_CODE,
			laneInbox.code,
			"Skill-feedback low-signal inbox is unsafe.",
			{
				recoverability: "repair_state",
				hint: laneInbox.hint,
			},
		);
	}
	const inboxPath = laneInbox.path;
	const proof = await attachWriterProof({
		report,
		inboxPath: inbox.path,
		runtime,
		detectionId: prepared.detectionId,
	});
	const persisted = proof.report;
	const reportPath = join(inboxPath, reportFileName(persisted));
	const writeFailure = await writeReportWithRollback({
		reportPath,
		report: persisted,
		runtime,
		runId,
		code: "record_write_failed",
		message: "Skill-feedback record could not be written.",
		hint: "Inspect inbox ownership and permissions before retrying.",
	});
	if (writeFailure) return writeFailure;

	const envelope = createCliRuntimeSuccessEnvelope({
		run_id: runId,
		data: {
			contract: SKILL_FEEDBACK_CONTRACT_ID,
			...persisted,
			...writerProofWriteStatus(proof),
		},
	}) satisfies CliRuntimeSuccessEnvelope<
		ReportCardSoftwareLearningReport & {
			contract: typeof SKILL_FEEDBACK_CONTRACT_ID;
			schema_version: typeof SKILL_FEEDBACK_SCHEMA_VERSION;
		} & WriterProofWriteStatus
	>;
	return {
		exitCode: 0,
		stdout: `${JSON.stringify(envelope)}\n`,
		stderr: "",
		reportPath,
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export async function closeoutSkillFeedbackReceipt(
	rawReceipt: unknown,
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
	} = {},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-closeout";
	const repoRoot = resolve(runtime.repoRoot());

	const parsed = parseCloseoutReceipt(rawReceipt);
	if (parsed.kind === "invalid") {
		return errorResult(
			runId,
			USAGE_EXIT_CODE,
			"invalid_closeout_receipt",
			"Closeout receipt did not match the skill-feedback schema.",
			{
				recoverability: "change_input",
				hint: `Fix closeout field ${parsed.path} (${parsed.reason}) and provide JSON on stdin.`,
				contract: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
			},
		);
	}

	try {
		const generatedTs = runtime.nowIso();
		const receipt = parsed.receipt;
		const runtimeTelemetry = await closeoutRuntimeTelemetry(receipt, runtime);
		const correlationStatus: CorrelationStatus = "unlinked";
		const evidenceGaps = closeoutEvidenceGaps(
			parsed.evidence_gaps,
			runtimeTelemetry,
		);
		const report = buildCloseoutReport({
			generatedTs,
			receipt,
			runtimeTelemetry,
			correlationStatus,
			evidenceGaps,
		});
		const redacted = redactReportCardSoftwareLearningReport(report);

		const ignoreStatus = await runtime.checkIgnored(repoRoot, `${INBOX_DIR}/`);
		if (ignoreStatus !== 0) {
			return errorResult(
				runId,
				RUNTIME_FAILURE_EXIT_CODE,
				"gitignore_gate_refused",
				"Skill-feedback inbox is not ignored by git.",
				{
					recoverability: "repair_state",
					hint: "Add .skill-feedback/ to the repo gitignore, then rerun.",
					contract: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
				},
			);
		}

		const inbox = await prepareSkillFeedbackInbox(repoRoot, runtime);
		if (!inbox.ok) {
			return errorResult(
				runId,
				RUNTIME_FAILURE_EXIT_CODE,
				inbox.code,
				"Skill-feedback inbox is unsafe.",
				{
					recoverability: "repair_state",
					hint: inbox.hint,
					contract: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
				},
			);
		}
		const inboxPath = inbox.path;
		const markerCheck = await inspectPilotMarker(inboxPath, runtime);
		if (!markerCheck.ok) {
			return errorResult(
				runId,
				RUNTIME_FAILURE_EXIT_CODE,
				markerCheck.code,
				"Skill-feedback pilot marker is unsafe.",
				{
					recoverability: "repair_state",
					hint: markerCheck.hint,
					contract: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
				},
			);
		}
		const proof = await attachWriterProof({
			report: redacted.value,
			inboxPath,
			runtime,
		});
		const persisted = proof.report;
		const fileName = reportFileName(persisted);
		const reportPath = join(inboxPath, fileName);
		const writeFailure = await writeReportWithRollback({
			reportPath,
			report: persisted,
			runtime,
			runId,
			code: "closeout_write_failed",
			message: "Closeout report could not be written.",
			hint: "Inspect inbox ownership and permissions before retrying.",
			contract: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
		});
		if (writeFailure) return writeFailure;
		if (markerCheck.state === "missing") {
			const markerWrite = await writeMissingPilotMarker(
				inboxPath,
				generatedTs,
				runtime,
			);
			if (!markerWrite.ok) {
				const rolledBack = await rollbackWrittenReport(reportPath, runtime);
				return errorResult(
					runId,
					RUNTIME_FAILURE_EXIT_CODE,
					markerWrite.code,
					"Closeout pilot marker could not be written.",
					{
						recoverability: "repair_state",
						hint: rolledBack
							? markerWrite.hint
							: `${markerWrite.hint} A closeout report may already exist in .skill-feedback/.`,
						contract: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
						changedState: rolledBack ? "none" : "partial",
					},
				);
			}
		}

		const data: CloseoutResultData = {
			contract: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
			report_id: persisted.report_id,
			...(persisted.skill_run_id
				? { skill_run_id: persisted.skill_run_id }
				: {}),
			correlation_status: persisted.correlation_status,
			evidence_gaps: persisted.evidence_gaps,
			redactions: redacted.redactions,
			written_path: `${INBOX_DIR}/${fileName}`,
			closeout_coverage_contribution: "material_closeout",
			...writerProofWriteStatus(proof),
		};
		const envelope = createCliRuntimeSuccessEnvelope({
			run_id: runId,
			data,
			runtime_actions: [
				{
					id: "review-skill-feedback",
					summary: "Review skill-feedback evidence when ready.",
					side_effects: ["read"],
				},
			],
			continuation: { next_action_id: "review-skill-feedback" },
		}) satisfies CliRuntimeSuccessEnvelope<CloseoutResultData>;
		return {
			exitCode: 0,
			stdout: `${JSON.stringify(envelope)}\n`,
			stderr: "",
			reportPath,
		};
	} catch {
		return errorResult(
			runId,
			RUNTIME_FAILURE_EXIT_CODE,
			"closeout_write_failed",
			"Closeout could not be written.",
			{
				recoverability: "repair_state",
				hint: "Inspect .skill-feedback/ ownership, permissions, and gitignore state before retrying.",
				contract: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
			},
		);
	}
}

export async function finalizeSkillFeedbackCorrelationWitness(
	input: FinalizeCorrelationWitnessInput,
	options: { runtime?: SkillFeedbackRuntime } = {},
): Promise<FinalizeCorrelationWitnessResult> {
	return finalizeCorrelationWitnessWorkflow(input, {
		runtime: options.runtime ?? createDefaultSkillFeedbackRuntime(),
		readWriterProofKey,
	});
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export async function correlateSkillFeedbackInbox(
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
		plain?: boolean;
		targetPath?: string;
		execute?: boolean;
	} = {},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-correlate";
	const readTarget = await runtime.resolveReadTarget(options.targetPath);
	if (!readTarget.ok) {
		return errorResult(
			runId,
			RUNTIME_FAILURE_EXIT_CODE,
			readTarget.code,
			readTarget.message,
			{
				recoverability: "repair_state",
				hint: readTarget.hint,
				contract: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
				data: readTargetFailureData(readTarget),
			},
		);
	}
	const mode: SkillFeedbackCorrelateMode = options.execute ? "execute" : "preview";
	const scan = await scanCorrelationRepairCandidates({
		repoRoot: readTarget.repoRoot,
		runtime,
		readWriterProofKey,
	});
	if (!scan.ok) {
		return correlateRepairStateError(runId, scan.diagnostics);
	}
	const executedScan =
		mode === "execute"
			? await executeCorrelationRepairCandidates({
					scan,
					runtime,
					readWriterProofKey,
					repoRoot: readTarget.repoRoot,
				})
			: scan;
	if (!executedScan.ok) {
		const data = buildCorrelateResultData({
			mode,
			scan: executedScan.scan,
			readTarget,
		});
		return correlateRepairStateError(
			runId,
			executedScan.diagnostics,
			executedScan.changedState,
			data,
		);
	}
	const data = buildCorrelateResultData({
		mode,
		scan: executedScan,
		readTarget,
	});
	if (options.plain) return correlatePlainResult(data);
	const envelope = createCliRuntimeSuccessEnvelope({
		run_id: runId,
		data,
		runtime_actions: [
			{
				id: data.next_action.action_id,
				summary: data.next_action.summary,
				side_effects: data.next_action.side_effects,
			},
		],
		continuation: { next_action_id: data.next_action.action_id },
	}) satisfies CliRuntimeSuccessEnvelope<SkillFeedbackCorrelateResultData>;
	return {
		exitCode: 0,
		stdout: `${JSON.stringify(envelope)}\n`,
		stderr: "",
	};
}

function correlatePlainResult(
	data: SkillFeedbackCorrelateResultData,
): SkillFeedbackProcessResult {
	return {
		exitCode: 0,
		stdout: renderPlainCorrelate(data),
		stderr: "",
	};
}

function buildCorrelateResultData(input: {
	mode: SkillFeedbackCorrelateMode;
	scan: Extract<CorrelationRepairScan, { ok: true }>;
	readTarget: Extract<ReadTargetResolution, { ok: true }>;
}): SkillFeedbackCorrelateResultData {
	const counts = correlateCounts(input.scan);
	const nextAction = correlateNextAction(input.mode, counts);
	return {
		contract: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
		schema_version: SKILL_FEEDBACK_CORRELATE_RESULT_SCHEMA_VERSION,
		mode: input.mode,
		counts,
		candidates: input.scan.candidates.map(({ finalizeInput: _input, ...candidate }) =>
			candidate
		),
		next_action: nextAction,
		...(input.readTarget.explicit
			? { read_target: readTargetDiagnosticData(input.readTarget) }
			: {}),
	};
}

function correlateCounts(
	scan: Extract<CorrelationRepairScan, { ok: true }>,
): SkillFeedbackCorrelateCounts {
	const candidates = scan.candidates;
	return {
		diagnostic_count: scan.diagnosticCount,
		candidate_count: candidates.length,
		repairable_count: candidates.filter((candidate) => candidate.class === "repairable")
			.length,
		ambiguous_count: candidates.filter((candidate) => candidate.class === "ambiguous")
			.length,
		invalid_count: candidates.filter((candidate) => candidate.class === "invalid")
			.length,
		already_linked_count: candidates.filter(
			(candidate) => candidate.class === "already_linked",
		).length,
		insufficient_evidence_count: candidates.filter(
			(candidate) => candidate.class === "insufficient_evidence",
		).length,
		written_count: scan.writtenCount,
		blocked_count: candidates.filter(
			(candidate) =>
				candidate.class === "ambiguous" ||
				candidate.class === "invalid" ||
				candidate.class === "insufficient_evidence",
		).length,
		failed_count: scan.failedCount,
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function correlateNextAction(
	mode: SkillFeedbackCorrelateMode,
	counts: SkillFeedbackCorrelateCounts,
): SkillFeedbackCorrelateResultData["next_action"] {
	if (mode === "preview" && counts.repairable_count > 0) {
		return {
			action_id: "execute_repair",
			summary: "Run correlate --execute to write validated private witnesses.",
			side_effects: ["write"],
		};
	}
	if (
		counts.ambiguous_count > 0 ||
		counts.invalid_count > 0 ||
		counts.failed_count > 0
	) {
		return {
			action_id: "inspect_repair_blockers",
			summary: "Inspect blocked correlate candidates before retrying repair.",
			side_effects: ["read"],
		};
	}
	if (counts.blocked_count > 0 || counts.candidate_count === 0) {
		return {
			action_id: "no_repair_available",
			summary: "No correlation repair is available from current private evidence.",
			side_effects: ["read"],
		};
	}
	return {
		action_id: "repair_complete",
		summary: "Correlation repair has no remaining write candidates.",
		side_effects: ["read"],
	};
}

function correlateRepairStateError(
	runId: string,
	diagnostics: readonly string[],
	changedState: "none" | "partial" = "none",
	data?: SkillFeedbackCorrelateResultData,
): SkillFeedbackProcessResult {
	return errorResult(
		runId,
		RUNTIME_FAILURE_EXIT_CODE,
		"correlate_repair_state_error",
		"Skill-feedback correlate could not safely inspect repair evidence.",
		{
			recoverability: "repair_state",
			hint: "Inspect .skill-feedback/.correlation ownership and rerun correlate preview.",
			contract: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
			changedState,
			data: {
				diagnostics: uniqueSorted(diagnostics),
				...(data ? { result: data } : {}),
			},
		},
	);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export async function reviewSkillFeedbackInbox(
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
		plain?: boolean;
		targetPath?: string;
	} = {},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-review";
	const readTarget = await runtime.resolveReadTarget(options.targetPath);
	if (!readTarget.ok) {
		return errorResult(
			runId,
			RUNTIME_FAILURE_EXIT_CODE,
			readTarget.code,
			readTarget.message,
			{
				recoverability: "repair_state",
				hint: readTarget.hint,
				contract: SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
				data: readTargetFailureData(readTarget),
			},
		);
	}
	const repoRoot = readTarget.repoRoot;
	try {
		const inbox = await readReviewInbox({
			repoRoot,
			runtime,
			readWriterProofKey,
			applyVerifiedCorrelationWitnesses,
		});
		const pilotStartedAt =
			inbox.inboxRootStatus === "unsafe"
				? undefined
				: await readPilotStartedAt(repoRoot, runtime);
		const data = buildReviewResultData({
			inbox,
			nowIso: runtime.nowIso(),
			pilotStartedAt,
			readTarget,
		});
		return reviewProcessResult(runId, data, options.plain === true);
	} catch (error) {
		return reviewFailedError(runId, error);
	}
}

function reviewProcessResult(
	runId: string,
	data: ReviewResultData,
	plain: boolean,
): SkillFeedbackProcessResult {
	if (plain) return reviewPlainResult(data);
	if (data.inbox_status === "unsafe") return reviewUnsafeResult(runId, data);
	return reviewSuccessResult(runId, data);
}

function reviewPlainResult(data: ReviewResultData): SkillFeedbackProcessResult {
	return {
		exitCode: data.inbox_status === "unsafe" ? RUNTIME_FAILURE_EXIT_CODE : 0,
		stdout: renderPlainReview(data),
		stderr: "",
	};
}

function reviewUnsafeResult(
	runId: string,
	data: ReviewResultData,
): SkillFeedbackProcessResult {
	return errorResult(
		runId,
		RUNTIME_FAILURE_EXIT_CODE,
		"review_inbox_unsafe",
		"Skill-feedback review inbox is unsafe.",
		{
			recoverability: "repair_state",
			hint: data.next_action.summary,
			contract: SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
			data,
		},
	);
}

function reviewSuccessResult(
	runId: string,
	data: ReviewResultData,
): SkillFeedbackProcessResult {
	const actionId =
		data.open_items.length > 0 ? "inspect-open-items" : "review-complete";
	const envelope = createCliRuntimeSuccessEnvelope({
		run_id: runId,
		data,
		runtime_actions: [
			{
				id: actionId,
				summary:
					data.open_items.length > 0
						? "Inspect open skill-feedback evidence."
						: "No source change is suggested by this review.",
				side_effects: ["read"],
			},
		],
		continuation: { next_action_id: actionId },
	}) satisfies CliRuntimeSuccessEnvelope<ReviewResultData>;
	return {
		exitCode: 0,
		stdout: `${JSON.stringify(envelope)}\n`,
		stderr: "",
	};
}

function reviewFailedError(
	runId: string,
	error: unknown,
): SkillFeedbackProcessResult {
	if (isPermissionErrorCode(error)) {
		return errorResult(
			runId,
			RUNTIME_FAILURE_EXIT_CODE,
			"review_inbox_permission_denied",
			"Skill-feedback review could not read the inbox because permissions denied access.",
			{
				recoverability: "repair_state",
				hint: "Inspect .skill-feedback/ ownership and permissions before retrying.",
				contract: SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
			},
		);
	}
	return errorResult(
		runId,
		RUNTIME_FAILURE_EXIT_CODE,
		"review_failed",
		"Skill-feedback review could not read the inbox.",
		{
			recoverability: "repair_state",
			hint: "Inspect .skill-feedback/ files and remove invalid report artifacts before retrying.",
			contract: SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
		},
	);
}

export async function healthSkillFeedbackInbox(
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
		plain?: boolean;
		dashboard?: boolean;
		targetPath?: string;
	} = {},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-health";
	const readTarget = await runtime.resolveReadTarget(options.targetPath);
	if (!readTarget.ok) {
		return healthReadTargetError(runId, readTarget);
	}
	return readHealthProcessResult(
		runId,
		readTarget,
		runtime,
		healthOutputMode(options),
	);
}

function healthOutputMode(options: {
	plain?: boolean;
	dashboard?: boolean;
}): HealthCliOutputMode {
	if (options.dashboard === true) return "dashboard";
	return options.plain === true ? "plain" : "json";
}

async function readHealthProcessResult(
	runId: string,
	readTarget: Extract<ReadTargetResolution, { ok: true }>,
	runtime: SkillFeedbackRuntime,
	outputMode: HealthCliOutputMode,
): Promise<SkillFeedbackProcessResult> {
	try {
		const inbox = await readReviewInbox({
			repoRoot: readTarget.repoRoot,
			runtime,
			readWriterProofKey,
			applyVerifiedCorrelationWitnesses,
		});
		const healthData = buildHealthResultData({
			inbox,
			nowIso: runtime.nowIso(),
			readTarget,
		});
		return healthProcessResult(
			runId,
			healthData,
			outputMode,
			inbox,
		);
	} catch (error) {
		return healthFailedError(runId, error);
	}
}

function healthReadTargetError(
	runId: string,
	readTarget: Extract<ReadTargetResolution, { ok: false }>,
): SkillFeedbackProcessResult {
	return errorResult(
		runId,
		RUNTIME_FAILURE_EXIT_CODE,
		readTarget.code,
		readTarget.message,
		{
			recoverability: "repair_state",
			hint: readTarget.hint,
			contract: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
			data: readTargetFailureData(readTarget),
		},
	);
}

function readTargetFailureData(
	readTarget: Extract<ReadTargetResolution, { ok: false }>,
) {
	return {
		read_target_failure: {
			explicit: readTarget.explicit,
			target_path: readTarget.seedPath,
			...(readTarget.gitExitCode === undefined
				? {}
				: { git_exit_code: readTarget.gitExitCode }),
		},
	};
}

function healthProcessResult(
	runId: string,
	data: HealthResultData,
	outputMode: HealthCliOutputMode,
	inbox?: ReviewInboxRead,
): SkillFeedbackProcessResult {
	if (outputMode === "dashboard") return healthDashboardResult(data, inbox);
	if (outputMode === "plain") return healthPlainResult(data);
	if (data.inbox_status === "unsafe") return healthUnsafeResult(runId, data);
	return healthSuccessResult(runId, data);
}

function healthDashboardResult(
	data: HealthResultData,
	inbox: ReviewInboxRead | undefined,
): SkillFeedbackProcessResult {
	return {
		exitCode: data.inbox_status === "unsafe" ? RUNTIME_FAILURE_EXIT_CODE : 0,
		stdout: renderHealthDashboard(data, inbox),
		stderr: "",
	};
}

function healthPlainResult(data: HealthResultData): SkillFeedbackProcessResult {
	return {
		exitCode: data.inbox_status === "unsafe" ? RUNTIME_FAILURE_EXIT_CODE : 0,
		stdout: renderPlainHealth(data),
		stderr: "",
	};
}

function healthUnsafeResult(
	runId: string,
	data: HealthResultData,
): SkillFeedbackProcessResult {
	return errorResult(
		runId,
		RUNTIME_FAILURE_EXIT_CODE,
		"health_inbox_unsafe",
		"Skill-feedback inbox is unsafe.",
		{
			recoverability: "repair_state",
			hint: data.next_action.summary,
			contract: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
			data,
		},
	);
}

function healthSuccessResult(
	runId: string,
	data: HealthResultData,
): SkillFeedbackProcessResult {
	const envelope = createCliRuntimeSuccessEnvelope({
		run_id: runId,
		data,
		runtime_actions: [
			{
				id: data.next_action.action_id,
				summary: data.next_action.summary,
				side_effects: ["read"],
			},
		],
		continuation: { next_action_id: data.next_action.action_id },
	}) satisfies CliRuntimeSuccessEnvelope<HealthResultData>;
	return {
		exitCode: 0,
		stdout: `${JSON.stringify(envelope)}\n`,
		stderr: "",
	};
}

function healthFailedError(
	runId: string,
	error: unknown,
): SkillFeedbackProcessResult {
	if (isPermissionErrorCode(error)) {
		return errorResult(
			runId,
			RUNTIME_FAILURE_EXIT_CODE,
			"health_inbox_permission_denied",
			"Skill-feedback health could not read the inbox because permissions denied access.",
			{
				recoverability: "repair_state",
				hint: "Inspect .skill-feedback/ ownership and permissions before retrying.",
				contract: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
			},
		);
	}
	return errorResult(
		runId,
		RUNTIME_FAILURE_EXIT_CODE,
		"health_failed",
		"Skill-feedback health could not read the inbox.",
		{
			recoverability: "repair_state",
			hint: "Inspect .skill-feedback/ ownership and unreadable artifacts before retrying.",
			contract: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
		},
	);
}

type SkillFeedbackReportEntry = {
	report: NormalizedSoftwareLearningReport;
	lane: SkillFeedbackReportLane;
	lowSignalReasonId?: string;
};

type SkillFeedbackReportsOptions = {
	json: boolean;
	limit: number;
	lane: SkillFeedbackReportLaneFilter;
	source: SkillFeedbackReportSourceFilter;
	skill?: string;
	targetPath?: string;
};

type SkillFeedbackReportDetailOptions = {
	json: boolean;
	ref: string;
	lowSignal: boolean;
	targetPath?: string;
};

type SkillFeedbackUsageOptions = {
	json: boolean;
	limit: number;
	skill?: string;
	targetPath?: string;
};

type SkillFeedbackQueueOptions = {
	json: boolean;
	limit: number;
	includeWeak: boolean;
	skill?: string;
	ownerPath?: string;
	targetPath?: string;
};

type HumanCommandName = "reports" | "report" | "usage" | "queue";

type ParsedHumanCommandFlag =
	| { ok: true; nextIndex: number }
	| { ok: false; message: string };

type ParseHumanCommandArgsResult<TOptions> =
	| { ok: true; options: TOptions }
	| { ok: false; message: string };

type SkillFeedbackHumanReadContext = {
	runtime: SkillFeedbackRuntime;
	readTarget: Extract<ReadTargetResolution, { ok: true }>;
	inbox: ReviewInboxRead;
};

/**
 * Render the recent report list without mutating inbox state.
 *
 * @param options - Runtime, run id, and report-list filters
 * @returns Process-shaped result for CLI and station tests
 */
// Covered by Branch Station process tests; keep command orchestration local.
// fallow-ignore-next-line complexity
export async function listSkillFeedbackReports(
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
		reports: SkillFeedbackReportsOptions;
	},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-reports";
	const context = await readHumanInboxContext(
		runId,
		runtime,
		options.reports.targetPath,
		SKILL_FEEDBACK_REPORTS_CONTRACT_ID,
	);
	if (!context.ok) return context.result;
	if (context.inbox.inboxRootStatus === "unsafe") {
		return inboxUnsafeError(
			runId,
			SKILL_FEEDBACK_REPORTS_CONTRACT_ID,
			"reports_inbox_unsafe",
			"Skill-feedback reports could not safely read the inbox.",
		);
	}
	const data = buildReportsResultData({
		inbox: context.inbox,
		readTarget: context.readTarget,
		options: options.reports,
	});
	if (options.reports.json) {
		return jsonSuccessResult(runId, data, "reports-ready", "Report list is ready.");
	}
	return {
		exitCode: 0,
		stdout: renderPlainReports(data),
		stderr: "",
	};
}

/**
 * Render one report detail by stable `report:<id>` navigation ref.
 *
 * @param options - Runtime, run id, and report-detail options
 * @returns Process-shaped result for CLI and station tests
 */
// Covered by Branch Station process tests; keep command orchestration local.
// fallow-ignore-next-line complexity
export async function showSkillFeedbackReport(
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
		report: SkillFeedbackReportDetailOptions;
	},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-report";
	const reportId = normalizeReportRef(options.report.ref);
	if (!reportId.ok) {
		return reportRefError(runId, "report_ref_invalid", reportId.message);
	}
	const context = await readHumanInboxContext(
		runId,
		runtime,
		options.report.targetPath,
		SKILL_FEEDBACK_REPORT_CONTRACT_ID,
	);
	if (!context.ok) return context.result;
	if (context.inbox.inboxRootStatus === "unsafe") {
		return inboxUnsafeError(
			runId,
			SKILL_FEEDBACK_REPORT_CONTRACT_ID,
			"report_inbox_unsafe",
			"Skill-feedback report could not safely read the inbox.",
		);
	}
	const resolved = resolveReportDetail(
		context.inbox,
		reportId.value,
		options.report.lowSignal,
	);
	if (!resolved.ok) {
		return reportRefError(runId, resolved.code, resolved.message);
	}
	const data = buildReportDetailData({
		entry: resolved.entry,
		readTarget: context.readTarget,
	});
	if (options.report.json) {
		return jsonSuccessResult(runId, data, "report-ready", "Report detail is ready.");
	}
	return {
		exitCode: 0,
		stdout: renderPlainReportDetail(data),
		stderr: "",
	};
}

/**
 * Render the skill-only usage portfolio from inbox evidence.
 *
 * @param options - Runtime, run id, and usage filters
 * @returns Process-shaped result for CLI and station tests
 */
// Covered by Branch Station process tests; keep command orchestration local.
// fallow-ignore-next-line complexity
export async function showSkillFeedbackUsage(
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
		usage: SkillFeedbackUsageOptions;
	},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-usage";
	const context = await readHumanInboxContext(
		runId,
		runtime,
		options.usage.targetPath,
		SKILL_FEEDBACK_USAGE_CONTRACT_ID,
	);
	if (!context.ok) return context.result;
	if (context.inbox.inboxRootStatus === "unsafe") {
		return inboxUnsafeError(
			runId,
			SKILL_FEEDBACK_USAGE_CONTRACT_ID,
			"usage_inbox_unsafe",
			"Skill-feedback usage could not safely read the inbox.",
		);
	}
	const data = buildUsageResultData({
		inbox: context.inbox,
		readTarget: context.readTarget,
		options: options.usage,
	});
	if (options.usage.json) {
		return jsonSuccessResult(runId, data, "usage-ready", "Skill usage is ready.");
	}
	return {
		exitCode: 0,
		stdout: renderPlainUsage(data),
		stderr: "",
	};
}

/**
 * Render the improvement queue from review-ledger evidence.
 *
 * @param options - Runtime, run id, and queue filters
 * @returns Process-shaped result for CLI and station tests
 */
// Covered by Branch Station process tests; keep command orchestration local.
// fallow-ignore-next-line complexity
export async function showSkillFeedbackQueue(
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
		queue: SkillFeedbackQueueOptions;
	},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-queue";
	const context = await readHumanInboxContext(
		runId,
		runtime,
		options.queue.targetPath,
		SKILL_FEEDBACK_QUEUE_CONTRACT_ID,
	);
	if (!context.ok) return context.result;
	if (context.inbox.inboxRootStatus === "unsafe") {
		return inboxUnsafeError(
			runId,
			SKILL_FEEDBACK_QUEUE_CONTRACT_ID,
			"queue_inbox_unsafe",
			"Skill-feedback queue could not safely read the inbox.",
		);
	}
	const review = buildReviewResultData({
		inbox: context.inbox,
		nowIso: runtime.nowIso(),
		readTarget: context.readTarget,
		pilotStartedAt: await readPilotStartedAt(context.readTarget.repoRoot, runtime),
	});
	const data = buildQueueResultData({
		inbox: context.inbox,
		review,
		readTarget: context.readTarget,
		options: options.queue,
	});
	if (options.queue.json) {
		return jsonSuccessResult(runId, data, "queue-ready", "Improvement queue is ready.");
	}
	return {
		exitCode: 0,
		stdout: renderPlainQueue(data),
		stderr: "",
	};
}

async function readHumanInboxContext(
	runId: string,
	runtime: SkillFeedbackRuntime,
	targetPath: string | undefined,
	contract: SkillFeedbackResultContractId,
): Promise<
	| ({ ok: true } & SkillFeedbackHumanReadContext)
	| { ok: false; result: SkillFeedbackProcessResult }
> {
	const readTarget = await runtime.resolveReadTarget(targetPath);
	if (!readTarget.ok) {
		return {
			ok: false,
			result: errorResult(
				runId,
				RUNTIME_FAILURE_EXIT_CODE,
				readTarget.code,
				readTarget.message,
				{
					recoverability: "repair_state",
					hint: readTarget.hint,
					contract,
					data: readTargetFailureData(readTarget),
				},
			),
		};
	}
	try {
		const inbox = await readReviewInbox({
			repoRoot: readTarget.repoRoot,
			runtime,
			readWriterProofKey,
			applyVerifiedCorrelationWitnesses,
		});
		return { ok: true, runtime, readTarget, inbox };
	} catch (error) {
		if (isPermissionErrorCode(error)) {
			return {
				ok: false,
				result: errorResult(
					runId,
					RUNTIME_FAILURE_EXIT_CODE,
					"read_inbox_permission_denied",
					"Skill-feedback could not read the inbox because permissions denied access.",
					{
						recoverability: "repair_state",
						hint: "Inspect .skill-feedback/ ownership and permissions before retrying.",
						contract,
					},
				),
			};
		}
		return {
			ok: false,
			result: errorResult(
				runId,
				RUNTIME_FAILURE_EXIT_CODE,
				"read_inbox_failed",
				"Skill-feedback could not read the inbox.",
				{
					recoverability: "repair_state",
					hint: "Inspect .skill-feedback/ ownership and unreadable artifacts before retrying.",
					contract,
				},
			),
		};
	}
}

function inboxUnsafeError(
	runId: string,
	contract: SkillFeedbackResultContractId,
	code: string,
	message: string,
): SkillFeedbackProcessResult {
	return errorResult(runId, RUNTIME_FAILURE_EXIT_CODE, code, message, {
		recoverability: "repair_state",
		hint: "Inspect inbox health and repair unsafe .skill-feedback/ paths before retrying.",
		contract,
	});
}

function jsonSuccessResult<TData extends object>(
	runId: string,
	data: TData,
	actionId: string,
	summary: string,
): SkillFeedbackProcessResult {
	const envelope = createCliRuntimeSuccessEnvelope({
		run_id: runId,
		data,
		runtime_actions: [{ id: actionId, summary, side_effects: ["read"] }],
		continuation: { next_action_id: actionId },
	}) satisfies CliRuntimeSuccessEnvelope<TData>;
	return {
		exitCode: 0,
		stdout: `${JSON.stringify(envelope)}\n`,
		stderr: "",
	};
}

function buildReportsResultData(input: {
	inbox: ReviewInboxRead;
	readTarget: Extract<ReadTargetResolution, { ok: true }>;
	options: SkillFeedbackReportsOptions;
}): SkillFeedbackReportsResultData {
	const reports = reportEntries(input.inbox)
		.filter((entry) => reportsLaneMatches(entry, input.options.lane))
		.filter((entry) => reportsSourceMatches(entry, input.options.source))
		.filter((entry) => reportsSkillMatches(entry, input.options.skill))
		.sort(compareReportEntriesNewestFirst)
		.slice(0, input.options.limit)
		.map(reportListRow);
	return {
		contract: SKILL_FEEDBACK_REPORTS_CONTRACT_ID,
		schema_version: SKILL_FEEDBACK_REPORTS_RESULT_SCHEMA_VERSION,
		filters: {
			limit: input.options.limit,
			lane: input.options.lane,
			source: input.options.source,
			...(input.options.skill ? { skill: input.options.skill } : {}),
		},
		counts: {
			primary_count: input.inbox.primaryReports.length,
			low_signal_count: input.inbox.lowSignalReports.length,
			returned_count: reports.length,
			skipped_unsafe_count: input.inbox.skippedUnsafeCount,
			invalid_count: input.inbox.invalidCount,
		},
		reports,
		...(input.readTarget.explicit
			? { read_target: readTargetDiagnosticData(input.readTarget) }
			: {}),
	};
}

// Covered by Branch Station process tests; keep result shape near renderer.
// fallow-ignore-next-line complexity
function buildReportDetailData(input: {
	entry: SkillFeedbackReportEntry;
	readTarget: Extract<ReadTargetResolution, { ok: true }>;
}): SkillFeedbackReportDetailData {
	const report = input.entry.report;
	return {
		contract: SKILL_FEEDBACK_REPORT_CONTRACT_ID,
		schema_version: SKILL_FEEDBACK_REPORT_RESULT_SCHEMA_VERSION,
		report_ref: reportRef(report.report_id),
		report_id: report.report_id,
		lane: input.entry.lane,
		...(input.entry.lowSignalReasonId
			? { low_signal_reason_id: input.entry.lowSignalReasonId }
			: {}),
		generated_ts: report.generated_ts,
		skill: report.skill,
		outcome: report.outcome,
		source: report.evidence_source,
		correlation_status: report.correlation_status,
		...(report.goal ? { goal: report.goal } : {}),
		...(report.friction ? { friction: report.friction } : {}),
		...(report.verification_burden
			? { verification_burden: report.verification_burden }
			: {}),
		touched_surfaces: report.touched_surfaces,
		observations: report.observations,
		evidence_gaps: report.evidence_gaps,
		missing_fields: reportDetailMissingFields(report),
		...(input.readTarget.explicit
			? { read_target: readTargetDiagnosticData(input.readTarget) }
			: {}),
	};
}

// Covered by Branch Station process tests; keep result shape near renderer.
// fallow-ignore-next-line complexity
function buildUsageResultData(input: {
	inbox: ReviewInboxRead;
	readTarget: Extract<ReadTargetResolution, { ok: true }>;
	options: SkillFeedbackUsageOptions;
}): SkillFeedbackUsageResultData {
	const groups = new Map<string, SkillFeedbackReportEntry[]>();
	for (const entry of reportEntries(input.inbox)) {
		if (input.options.skill && entry.report.skill !== input.options.skill) continue;
		const bucket = groups.get(entry.report.skill);
		if (bucket) bucket.push(entry);
		else groups.set(entry.report.skill, [entry]);
	}
	const skills = [...groups.entries()]
		.map(([skill, entries]) => usageSkillRow(skill, entries))
		.sort(compareUsageRows)
		.slice(0, input.options.limit);
	return {
		contract: SKILL_FEEDBACK_USAGE_CONTRACT_ID,
		schema_version: SKILL_FEEDBACK_USAGE_RESULT_SCHEMA_VERSION,
		filters: {
			limit: input.options.limit,
			...(input.options.skill ? { skill: input.options.skill } : {}),
		},
		counts: {
			primary_count: input.inbox.primaryReports.length,
			low_signal_count: input.inbox.lowSignalReports.length,
			returned_count: skills.length,
		},
		skills,
		...(input.readTarget.explicit
			? { read_target: readTargetDiagnosticData(input.readTarget) }
			: {}),
	};
}

// Covered by Branch Station process tests; keep result shape near renderer.
// fallow-ignore-next-line complexity
function buildQueueResultData(input: {
	inbox: ReviewInboxRead;
	review: ReviewResultData;
	readTarget: Extract<ReadTargetResolution, { ok: true }>;
	options: SkillFeedbackQueueOptions;
}): SkillFeedbackQueueResultData {
	const reportSkillByRef = reportSkillMap(input.inbox);
	const strongRows = queueOwnerRows(input.review, reportSkillByRef, "strong");
	const weakRows = queueOwnerRows(input.review, reportSkillByRef, "weak");
	const filteredStrongRows = filterQueueRows(strongRows, input.options);
	const filteredWeakRows = filterQueueRows(weakRows, input.options);
	const fallbackRows =
		input.options.ownerPath === undefined && filteredStrongRows.length === 0
			? filterQueueRows(
					queueSkillFallbackRows(input.inbox, input.options.includeWeak),
					input.options,
				)
			: [];
	const candidateRows = input.options.includeWeak
		? [...filteredStrongRows, ...filteredWeakRows, ...fallbackRows]
		: [...filteredStrongRows, ...fallbackRows];
	const rows = candidateRows.slice(0, input.options.limit);
	const filterApplied =
		input.options.skill !== undefined || input.options.ownerPath !== undefined;
	const noBuild =
		rows.length === 0 && !filterApplied
			? {
					reason:
						"Current reports do not justify a skill or owner-doc change.",
					next_safe_action:
						"Record no-build or inspect supporting reports before changing source.",
				}
			: undefined;
	return {
		contract: SKILL_FEEDBACK_QUEUE_CONTRACT_ID,
		schema_version: SKILL_FEEDBACK_QUEUE_RESULT_SCHEMA_VERSION,
		filters: {
			limit: input.options.limit,
			include_weak: input.options.includeWeak,
			...(input.options.skill ? { skill: input.options.skill } : {}),
			...(input.options.ownerPath ? { owner_path: input.options.ownerPath } : {}),
		},
		counts: {
			primary_count: input.inbox.primaryReports.length,
			low_signal_count: input.inbox.lowSignalReports.length,
			returned_count: rows.length,
			weak_available_count: weakRows.length,
		},
		rows,
		...(noBuild ? { no_build: noBuild } : {}),
		...(input.readTarget.explicit
			? { read_target: readTargetDiagnosticData(input.readTarget) }
			: {}),
	};
}

function filterQueueRows(
	rows: SkillFeedbackQueueResultData["rows"],
	options: Pick<SkillFeedbackQueueOptions, "skill" | "ownerPath">,
): SkillFeedbackQueueResultData["rows"] {
	return rows
		.filter((row) => queueSkillMatches(row, options.skill))
		.filter((row) => queueOwnerMatches(row, options.ownerPath));
}

function reportEntries(inbox: ReviewInboxRead): SkillFeedbackReportEntry[] {
	return [
		...inbox.primaryReports.map((report) => ({
			report,
			lane: "primary" as const,
		})),
		...inbox.lowSignalReports.map((entry) => ({
			report: entry.report,
			lane: "low-signal" as const,
			lowSignalReasonId: entry.reasonId,
		})),
	];
}

function reportRef(reportId: string): string {
	return `report:${reportId}`;
}

function reportsLaneMatches(
	entry: SkillFeedbackReportEntry,
	lane: SkillFeedbackReportLaneFilter,
): boolean {
	return lane === "all" || entry.lane === lane;
}

function reportsSourceMatches(
	entry: SkillFeedbackReportEntry,
	source: SkillFeedbackReportSourceFilter,
): boolean {
	return source === "all" || entry.report.evidence_source === source;
}

function reportsSkillMatches(
	entry: SkillFeedbackReportEntry,
	skill: string | undefined,
): boolean {
	return skill === undefined || entry.report.skill === skill;
}

function compareReportEntriesNewestFirst(
	left: SkillFeedbackReportEntry,
	right: SkillFeedbackReportEntry,
): number {
	return (
		reportTime(right.report.generated_ts) - reportTime(left.report.generated_ts) ||
		left.report.report_id.localeCompare(right.report.report_id)
	);
}

function reportTime(generatedTs: string | undefined): number {
	const parsed = Date.parse(generatedTs ?? "");
	return Number.isFinite(parsed) ? parsed : 0;
}

function reportListRow(entry: SkillFeedbackReportEntry): SkillFeedbackReportListRow {
	const report = entry.report;
	return {
		report_ref: reportRef(report.report_id),
		report_id: report.report_id,
		detail_command:
			entry.lane === "low-signal"
				? `skill-feedback report ${reportRef(report.report_id)} --low-signal`
				: `skill-feedback report ${reportRef(report.report_id)}`,
		generated_ts: report.generated_ts,
		skill: report.skill,
		outcome: report.outcome,
		...(report.goal ? { goal: report.goal } : {}),
		lane: entry.lane,
		source: report.evidence_source,
		...(entry.lowSignalReasonId
			? { low_signal_reason_id: entry.lowSignalReasonId }
			: {}),
	};
}

function normalizeReportRef(
	rawRef: string,
): { ok: true; value: string } | { ok: false; message: string } {
	const trimmed = rawRef.trim();
	const reportId = trimmed.startsWith("report:")
		? trimmed.slice("report:".length)
		: trimmed;
	if (!isSafeReportId(reportId)) {
		return {
			ok: false,
			message: "Report refs must be shaped as report:<id> and cannot contain paths.",
		};
	}
	return { ok: true, value: reportId };
}

// Covered by Branch Station process tests; resolver errors are branch stations.
// fallow-ignore-next-line complexity
function resolveReportDetail(
	inbox: ReviewInboxRead,
	reportId: string,
	allowLowSignal: boolean,
):
	| { ok: true; entry: SkillFeedbackReportEntry }
	| { ok: false; code: string; message: string } {
	const primaryMatches = reportEntries(inbox).filter(
		(entry) => entry.lane === "primary" && entry.report.report_id === reportId,
	);
	const lowSignalMatches = reportEntries(inbox).filter(
		(entry) => entry.lane === "low-signal" && entry.report.report_id === reportId,
	);
	if (primaryMatches.length > 1 || primaryMatches.length + lowSignalMatches.length > 1) {
		return {
			ok: false,
			code: "report_ref_duplicate",
			message: `Report ref ${reportRef(reportId)} matches multiple reports.`,
		};
	}
	if (primaryMatches.length === 1 && !allowLowSignal) {
		return { ok: true, entry: primaryMatches[0] };
	}
	if (primaryMatches.length === 1) return { ok: true, entry: primaryMatches[0] };
	if (lowSignalMatches.length === 1 && !allowLowSignal) {
		return {
			ok: false,
			code: "report_low_signal_requires_opt_in",
			message: `Report ref ${reportRef(reportId)} exists only in the low-signal lane; rerun with --low-signal to inspect it.`,
		};
	}
	if (lowSignalMatches.length === 1) return { ok: true, entry: lowSignalMatches[0] };
	return {
		ok: false,
		code: "report_ref_not_found",
		message: `Report ref ${reportRef(reportId)} was not found in readable inbox reports.`,
	};
}

function reportRefError(
	runId: string,
	code: string,
	message: string,
): SkillFeedbackProcessResult {
	return errorResult(runId, USAGE_EXIT_CODE, code, message, {
		recoverability: "change_input",
		hint: "Use skill-feedback reports to copy a report:<id> ref, then retry.",
		contract: SKILL_FEEDBACK_REPORT_CONTRACT_ID,
	});
}

// Covered by Branch Station process tests; missing-field rendering is explicit.
// fallow-ignore-next-line complexity
function reportDetailMissingFields(
	report: SkillFeedbackReportEntry["report"],
): SkillFeedbackReportMissingField[] {
	const missing: SkillFeedbackReportMissingField[] = [];
	if (!report.goal) missing.push("goal");
	if (!report.friction) missing.push("friction");
	if (!report.verification_burden) missing.push("verification_burden");
	if (report.touched_surfaces.length === 0) missing.push("touched_surfaces");
	if (report.observations.length === 0) missing.push("observations");
	if (report.evidence_gaps.length === 0) missing.push("evidence_gaps");
	return missing;
}

function usageSkillRow(
	skill: string,
	entries: readonly SkillFeedbackReportEntry[],
): SkillFeedbackUsageSkillRow {
	const primary = entries.filter((entry) => entry.lane === "primary");
	const lowSignal = entries.filter((entry) => entry.lane === "low-signal");
	const outcomes: Record<SkillFeedbackOutcome, number> = {
		confirmed: 0,
		failed: 0,
		ambiguous: 0,
	};
	for (const entry of primary) outcomes[entry.report.outcome] += 1;
	const lastSeen = entries
		.map((entry) => entry.report.generated_ts)
		.sort((left, right) => reportTime(right) - reportTime(left))[0];
	return {
		skill,
		primary_count: primary.length,
		low_signal_count: lowSignal.length,
		outcomes,
		closeout_count: primary.filter(
			(entry) => entry.report.evidence_source === "driver_closeout",
		).length,
		capture_count: primary.filter(
			(entry) => entry.report.evidence_source === "hook_capture",
		).length,
		...(lastSeen ? { last_seen_generated_ts: lastSeen } : {}),
		...commonUsageSignals(primary),
		report_refs: primary
			.sort(compareReportEntriesNewestFirst)
			.slice(0, REVIEW_PLAIN_EVIDENCE_REF_LIMIT)
			.map((entry) => reportRef(entry.report.report_id)),
	};
}

// Covered by Branch Station process tests; usage row signals stay local.
// fallow-ignore-next-line complexity
function commonUsageSignals(
	entries: readonly SkillFeedbackReportEntry[],
): Pick<SkillFeedbackUsageSkillRow, "common_friction" | "common_verification_burden"> {
	const frictionValues: FrictionCategory[] = [];
	for (const entry of entries) {
		if (entry.report.friction?.category) {
			frictionValues.push(entry.report.friction.category);
		}
	}
	const friction = mostCommon(frictionValues);
	const burden = heaviestVerificationBurden(entries);
	return {
		...(friction ? { common_friction: friction } : {}),
		...(burden ? { common_verification_burden: burden } : {}),
	};
}

// Covered by Branch Station process tests; burden ordering is contract-owned.
// fallow-ignore-next-line complexity
function heaviestVerificationBurden(
	entries: readonly SkillFeedbackReportEntry[],
): VerificationBurdenLevel | undefined {
	let result: VerificationBurdenLevel | undefined;
	for (const entry of entries) {
		const level = entry.report.verification_burden?.level;
		if (!level) continue;
		if (!result || verificationLevelWeight(level) > verificationLevelWeight(result)) {
			result = level;
		}
	}
	return result;
}

function compareUsageRows(
	left: SkillFeedbackUsageSkillRow,
	right: SkillFeedbackUsageSkillRow,
): number {
	return (
		right.primary_count - left.primary_count ||
		right.low_signal_count - left.low_signal_count ||
		reportTime(right.last_seen_generated_ts) - reportTime(left.last_seen_generated_ts) ||
		left.skill.localeCompare(right.skill)
	);
}

function mostCommon<T extends string>(values: readonly T[]): T | undefined {
	const counts = new Map<T, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()].sort(
		(left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
	)[0]?.[0];
}

function reportSkillMap(inbox: ReviewInboxRead): Map<string, string> {
	const map = new Map<string, string>();
	for (const entry of reportEntries(inbox)) {
		map.set(reportRef(entry.report.report_id), entry.report.skill);
	}
	return map;
}

// Covered by Branch Station process tests; queue evidence stance stays explicit.
// fallow-ignore-next-line complexity
function queueOwnerRows(
	review: ReviewResultData,
	reportSkillByRef: ReadonlyMap<string, string>,
	strength: SkillFeedbackQueueEvidenceStrength,
): SkillFeedbackQueueResultData["rows"] {
	const rows: SkillFeedbackQueueResultData["rows"][number][] = [];
	const seen = new Set<string>();
	for (const signal of review.engineering_signals) {
		const signalStrength = queueSignalStrength(signal.reason);
		if (signalStrength !== strength) continue;
			if (seen.has(signal.owner_path)) continue;
			seen.add(signal.owner_path);
			const refs = reviewReportRefs(signal.evidence_refs, review);
			const skill = skillForRefs(refs, reportSkillByRef);
			rows.push({
				target_type: "owner_path",
				target: signal.owner_path,
				reason: queueReason(signal.reason),
				evidence_strength: signalStrength,
				...(skill ? { skill } : {}),
				report_refs: refs,
				next_safe_action: signal.next_safe_action,
			});
	}
	if (strength === "weak") {
		for (const entry of review.ledger_entries) {
			if (entry.anchor_strength !== "weak") continue;
			const target = entry.attempted_targets[0];
			const key = `weak:${target ? plainTarget(target) : entry.ledger_entry_key}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const refs = reviewReportRefs(entry.review_unit_keys, review);
			const skill = skillForRefs(refs, reportSkillByRef);
			rows.push({
				target_type: target?.type === "path" ? "owner_path" : "skill",
				target: target ? plainTarget(target) : "unknown",
				reason: `weak anchor: ${entry.weak_anchor_reason ?? "unknown"}`,
				evidence_strength: "weak",
				...(skill ? { skill } : {}),
				report_refs: refs,
				next_safe_action:
					"Inspect supporting reports before treating this as a shared surface.",
			});
		}
	}
	return rows.sort(compareQueueRows);
}

function queueSignalStrength(
	reason: ReviewResultData["engineering_signals"][number]["reason"],
): SkillFeedbackQueueEvidenceStrength {
	return reason === "driver_declared_owner_path" ? "weak" : "strong";
}

function queueReason(
	reason: ReviewResultData["engineering_signals"][number]["reason"],
): string {
	switch (reason) {
		case "repeated_anchor":
			return "repeated owner-path evidence";
		case "high_verification_burden":
			return "high verification burden";
		case "moderate_verification_burden":
			return "moderate verification burden";
		default:
			return "owner path named by one report";
	}
}

// Covered by Branch Station process tests; fallback rows are queue behavior.
// fallow-ignore-next-line complexity
function queueSkillFallbackRows(
	inbox: ReviewInboxRead,
	includeWeak: boolean,
): SkillFeedbackQueueResultData["rows"] {
	const usage = buildUsageResultData({
		inbox,
		readTarget: {
			ok: true,
			explicit: false,
			seedPath: "",
			repoRoot: "",
			inboxPath: "",
		},
		options: { json: false, limit: 100, targetPath: undefined },
	}).skills;
	return usage
		// Covered by Branch Station process tests; callback is row projection.
		// fallow-ignore-next-line complexity
		.flatMap((row) => {
			const strength: SkillFeedbackQueueEvidenceStrength =
				row.primary_count >= 2 ||
				verificationLevelWeight(row.common_verification_burden ?? "none") >= 3
					? "strong"
					: "weak";
			if (strength === "weak" && !includeWeak) return [];
			return [
				{
					target_type: "skill" as const,
					target: row.skill,
					reason:
						strength === "strong"
							? "repeated skill reports or high verification burden"
							: "single skill report",
					evidence_strength: strength,
					skill: row.skill,
					report_refs: row.report_refs,
					next_safe_action:
						"Inspect supporting reports before changing the skill route.",
				},
			];
		})
		.sort(compareQueueRows);
}

// Covered by Branch Station process tests; review-unit expansion is queue behavior.
// fallow-ignore-next-line complexity
function reviewReportRefs(
	refs: readonly string[],
	review: ReviewResultData,
): string[] {
	const unitByKey = new Map(
		review.review_units.map((unit) => [unit.review_unit_key, unit]),
	);
	const reportRefs: string[] = [];
	for (const ref of refs) {
		if (ref.startsWith("report:")) {
			const reportId = ref.slice("report:".length).split("#")[0] ?? "";
			reportRefs.push(reportRef(reportId));
			continue;
		}
		const unit = unitByKey.get(ref);
		if (unit) {
			reportRefs.push(...unit.report_ids.map(reportRef));
		}
	}
	return uniqueOrdered(reportRefs);
}

function skillForRefs(
	refs: readonly string[],
	reportSkillByRef: ReadonlyMap<string, string>,
): string | undefined {
	return refs.map((ref) => reportSkillByRef.get(ref)).filter(isString)[0];
}

function queueSkillMatches(
	row: SkillFeedbackQueueResultData["rows"][number],
	skill: string | undefined,
): boolean {
	return skill === undefined || row.skill === skill || row.target === skill;
}

function queueOwnerMatches(
	row: SkillFeedbackQueueResultData["rows"][number],
	ownerPath: string | undefined,
): boolean {
	return ownerPath === undefined || row.target === ownerPath;
}

function compareQueueRows(
	left: SkillFeedbackQueueResultData["rows"][number],
	right: SkillFeedbackQueueResultData["rows"][number],
): number {
	return (
		queueStrengthRank(left.evidence_strength) -
			queueStrengthRank(right.evidence_strength) ||
		left.target_type.localeCompare(right.target_type) ||
		left.target.localeCompare(right.target)
	);
}

function queueStrengthRank(strength: SkillFeedbackQueueEvidenceStrength): number {
	return strength === "strong" ? 0 : 1;
}

function verificationLevelWeight(level: "none" | "light" | "moderate" | "heavy"): number {
	switch (level) {
		case "heavy":
			return 3;
		case "moderate":
			return 2;
		case "light":
			return 1;
		default:
			return 0;
	}
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

type SkillFeedbackPurgeRetention =
	| {
			kind: "older_than";
			raw: string;
			durationMs: number;
	  }
	| {
			kind: "keep_latest";
			count: number;
	  };

export type SkillFeedbackPurgeOptions = {
	lane: SkillFeedbackPurgeLane;
	execute: boolean;
	retention: SkillFeedbackPurgeRetention;
};

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export async function purgeSkillFeedbackInbox(
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
		purge: SkillFeedbackPurgeOptions;
	},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-purge";
	const repoRoot = resolve(runtime.repoRoot());
	const purge = options.purge;
	const nowIso = runtime.nowIso();
	const scan = await scanPurgeCandidates({
		repoRoot,
		runtime,
		readWriterProofKey,
	});
	const selected = selectPurgeCandidates(scan.candidates, purge, nowIso);
	const deletedPaths: string[] = [];
	const skippedPaths = [...scan.skippedUnsafePaths];
	if (purge.execute) {
		const inboxPath = join(repoRoot, INBOX_DIR);
		const inboxReal = await safeRealpath(inboxPath, runtime);
		if (!inboxReal) {
			return errorResult(
				runId,
				RUNTIME_FAILURE_EXIT_CODE,
				"purge_inbox_missing",
				"Skill-feedback inbox is missing during purge.",
				{
					recoverability: "repair_state",
					hint: "Re-run purge after confirming the private inbox exists.",
					contract: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
				},
			);
		}
		for (const candidate of selected) {
			const safe = await assertSafePurgeCandidate(candidate, inboxReal, runtime);
			if (!safe.ok) {
				skippedPaths.push(candidate.relativePath);
				continue;
			}
			try {
				await runtime.removeFile(candidate.path);
				deletedPaths.push(candidate.relativePath);
			} catch {
				return errorResult(
					runId,
					RUNTIME_FAILURE_EXIT_CODE,
					"purge_delete_failed",
					"Skill-feedback purge could not delete a selected report.",
					{
						recoverability: "repair_state",
						hint: "Inspect inbox ownership and permissions before retrying.",
						contract: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
						changedState: deletedPaths.length > 0 ? "partial" : "none",
						data: { deleted_paths: deletedPaths },
					},
				);
			}
		}
	}
	const data: SkillFeedbackPurgeResultData = {
		contract: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
		schema_version: SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION,
		mode: purge.execute ? "execute" : "preview",
		lane: purge.lane,
		retention: purgeRetentionOutput(purge.retention, nowIso),
		scanned_count: scan.candidates.length,
		candidate_count: selected.length,
		deleted_count: deletedPaths.length,
		skipped_unsafe_count: skippedPaths.length,
		invalid_count: scan.invalidPaths.length,
		candidate_paths: selected.map((candidate) => candidate.relativePath),
		deleted_paths: deletedPaths,
		skipped_paths: skippedPaths,
		invalid_paths: scan.invalidPaths,
	};
	const actionId = purge.execute ? "purge-complete" : "inspect-purge-preview";
	const envelope = createCliRuntimeSuccessEnvelope({
		run_id: runId,
		data,
		runtime_actions: [
			{
				id: actionId,
				summary: purge.execute
					? "Selected safe inbox reports were deleted."
					: "Inspect selected purge candidates before executing deletion.",
				side_effects: purge.execute ? ["write"] : ["read"],
			},
		],
		continuation: { next_action_id: actionId },
	}) satisfies CliRuntimeSuccessEnvelope<SkillFeedbackPurgeResultData>;
	return {
		exitCode: 0,
		stdout: `${JSON.stringify(envelope)}\n`,
		stderr: "",
	};
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
	return [...new Set(values)].sort();
}

function selectPurgeCandidates(
	candidates: readonly SkillFeedbackPurgeCandidate[],
	options: SkillFeedbackPurgeOptions,
	nowIso: string,
): SkillFeedbackPurgeCandidate[] {
	const scoped = candidates.filter(
		(candidate) => options.lane === "all" || candidate.lane === options.lane,
	);
	if (options.retention.kind === "older_than") {
		const cutoffMs = purgeCutoffMs(options.retention, nowIso);
		return sortOldestFirst(
			scoped.filter((candidate) => candidate.generatedMs < cutoffMs),
		);
	}
	const newestFirst = [...scoped].sort(compareNewestFirst);
	return sortOldestFirst(newestFirst.slice(options.retention.count));
}

function purgeRetentionOutput(
	retention: SkillFeedbackPurgeRetention,
	nowIso: string,
): SkillFeedbackPurgeResultData["retention"] {
	if (retention.kind === "older_than") {
		return {
			kind: "older_than",
			older_than: retention.raw,
			cutoff_ts: new Date(purgeCutoffMs(retention, nowIso)).toISOString(),
		};
	}
	return {
		kind: "keep_latest",
		keep_latest: retention.count,
	};
}

function purgeCutoffMs(
	retention: Extract<SkillFeedbackPurgeRetention, { kind: "older_than" }>,
	nowIso: string,
): number {
	const nowMs = Date.parse(nowIso);
	const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
	return safeNowMs - retention.durationMs;
}

function compareNewestFirst(
	left: SkillFeedbackPurgeCandidate,
	right: SkillFeedbackPurgeCandidate,
): number {
	return (
		right.generatedMs - left.generatedMs ||
		left.relativePath.localeCompare(right.relativePath)
	);
}

function sortOldestFirst(
	candidates: readonly SkillFeedbackPurgeCandidate[],
): SkillFeedbackPurgeCandidate[] {
	return [...candidates].sort(
		(left, right) =>
			left.generatedMs - right.generatedMs ||
			left.relativePath.localeCompare(right.relativePath),
	);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function assertSafePurgeCandidate(
	candidate: SkillFeedbackPurgeCandidate,
	inboxReal: string,
	runtime: SkillFeedbackRuntime,
): Promise<SkillFeedbackResult> {
	const stats = await lstatOptional(candidate.path, runtime);
	if (!stats || stats.isSymbolicLink() || !stats.isFile()) {
		return { ok: false };
	}
	const candidateReal = await safeRealpath(candidate.path, runtime);
	if (!candidateReal || !isContainedPath(inboxReal, candidateReal)) {
		return { ok: false };
	}
	return { ok: true };
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function readPilotStartedAt(
	repoRoot: string,
	runtime: SkillFeedbackRuntime,
): Promise<string | undefined> {
	const inboxPath = join(repoRoot, INBOX_DIR);
	const markerPath = join(inboxPath, PILOT_MARKER_FILE);
	const stats = await lstatOptional(markerPath, runtime);
	if (!stats) return undefined;
	if (stats.isSymbolicLink() || !stats.isFile()) return undefined;
	const inboxReal = await safeRealpath(inboxPath, runtime);
	const markerReal = await safeRealpath(markerPath, runtime);
	if (!inboxReal || !markerReal || !isContainedPath(inboxReal, markerReal)) {
		return undefined;
	}
	try {
		const raw = await runtime.readText(markerPath);
		return raw.trim() || undefined;
	} catch (error) {
		if (isNodeErrorCode(error, "ENOENT")) return undefined;
		throw error;
	}
}

function readTargetDiagnosticData(
	resolution: Extract<ReadTargetResolution, { ok: true }>,
): ReviewReadTarget {
	return {
		explicit: resolution.explicit,
		repo_root: resolution.repoRoot,
		inbox_path: resolution.inboxPath,
		target_path: resolution.seedPath,
	};
}

const REVIEW_PLAIN_OPEN_ACTION_LIMIT = 10;
const REVIEW_PLAIN_LEDGER_ENTRY_LIMIT = 20;
const REVIEW_PLAIN_ENGINEERING_SIGNAL_LIMIT = 10;
const REVIEW_PLAIN_EVIDENCE_REF_LIMIT = 3;

/**
 * Render v2 review as bounded plain text. JSON remains the complete evidence
 * source; this view surfaces health, next action, readiness, top open actions,
 * and top ledger anchors for agent scanning.
 */
function renderPlainReview(data: ReviewResultData): string {
	const lines = ["Skill Feedback Review"];
	appendPlainReviewHealthBlock(lines, data);
	appendPlainProofHealth(lines, data.proof_health);
	appendPlainCorrelationWitnessHealth(lines, data.correlation_witnesses);
	appendPlainReviewCoverage(lines, data);
	appendPlainEngineeringSignals(lines, data.engineering_signals);
	appendPlainReadiness(lines, data.claim_readiness);
	appendPlainReviewTriage(lines, data);
	appendPlainReviewLedger(lines, data);
	lines.push("full_evidence=json");
	appendPlainReviewTail(lines, data);
	return `${lines.join("\n")}\n`;
}

function appendPlainReviewCoverage(lines: string[], data: ReviewResultData): void {
	lines.push(
		`Reports: ${data.coverage.total_reports}`,
		`Closeouts: ${data.coverage.closeout_count}`,
		`Capture-only: ${data.coverage.capture_only_count}`,
		`Unlinked: ${data.coverage.unlinked_count}`,
		`Evidence gaps: ${data.coverage.evidence_gap_count}`,
	);
	if (data.coverage.low_coverage_warning) {
		lines.push(`Low coverage: ${plainSafe(data.coverage.low_coverage_warning)}`);
	}
}

function appendPlainReviewHealthBlock(
	lines: string[],
	data: Pick<
		ReviewResultData,
		"inbox_status" | "counts" | "warnings" | "next_action" | "read_target"
	>,
): void {
	lines.push(...plainReviewHealthBlockLines(data));
}

function plainReviewHealthBlockLines(
	data: Pick<
		ReviewResultData,
		"inbox_status" | "counts" | "warnings" | "next_action" | "read_target"
	>,
): string[] {
	return [
		"Review health:",
		plainReviewHealthCountsLine(data),
		plainReviewTopWarningLine(data.warnings[0]),
		`- next_action=${data.next_action.action_id}: ${plainSafe(data.next_action.summary)}`,
		...plainReviewReadTargetLines(data.read_target),
	];
}

function plainReviewHealthCountsLine(
	data: Pick<ReviewResultData, "inbox_status" | "counts">,
): string {
	return `- inbox_status=${data.inbox_status} counts primary=${data.counts.primary} low-signal=${data.counts.low_signal} invalid=${data.counts.invalid} skipped=${data.counts.skipped_unsafe} unlinked=${data.counts.unlinked_primary}`;
}

function plainReviewTopWarningLine(
	warning: ReviewResultData["warnings"][number] | undefined,
): string {
	if (!warning) return "- top_warning=none";
	return `- top_warning=${warning.reason_id}: ${plainSafe(warning.summary)}`;
}

function plainReviewReadTargetLines(
	readTarget: ReviewResultData["read_target"],
): string[] {
	if (!readTarget) return [];
	return [
		`- repo_root=${plainSafe(readTarget.repo_root)}`,
		`- inbox_path=${plainSafe(readTarget.inbox_path)}`,
		...(readTarget.target_path
			? [`- target_path=${plainSafe(readTarget.target_path)}`]
			: []),
	];
}

function appendPlainReviewTriage(
	lines: string[],
	data: Pick<ReviewResultData, "open_actions" | "no_action">,
): void {
	if (data.open_actions.length === 0) {
		appendPlainNoAction(lines, data.no_action);
		return;
	}
	appendPlainOpenActions(lines, data.open_actions);
}

function appendPlainNoAction(
	lines: string[],
	noAction: ReviewResultData["no_action"],
): void {
	lines.push(`No action: ${plainSafe(noActionRationale(noAction))}`);
}

function noActionRationale(noAction: ReviewResultData["no_action"]): string {
	if (noAction) return noAction.rationale;
	return "No open actions.";
}

function appendPlainOpenActions(
	lines: string[],
	openActions: ReviewResultData["open_actions"],
): void {
	lines.push("Open actions:");
	for (const action of openActions.slice(0, REVIEW_PLAIN_OPEN_ACTION_LIMIT)) {
		lines.push(plainOpenAction(action));
	}
	if (openActions.length > REVIEW_PLAIN_OPEN_ACTION_LIMIT) {
		lines.push(
			`truncated_open_actions=${openActions.length - REVIEW_PLAIN_OPEN_ACTION_LIMIT}`,
		);
	}
}

function plainOpenAction(
	action: ReviewResultData["open_actions"][number],
): string {
	const omitted = plainEvidenceRefsOmitted(action.evidence_refs);
	return [
		`- action=${plainSafe(action.action_key)}`,
		`next=${plainSafe(action.next_safe_action) || "none"}`,
		`evidence=${plainEvidenceRefs(action.evidence_refs)}`,
		...(omitted > 0 ? [`evidence_refs_omitted=${omitted}`] : []),
		`reason=${action.open_reason}`,
		...(action.target ? [`target=${plainTarget(action.target)}`] : []),
	].join(" ");
}

function appendPlainEngineeringSignals(
	lines: string[],
	signals: ReviewResultData["engineering_signals"],
): void {
	if (signals.length === 0) return;
	lines.push("Engineering signals:");
	for (const signal of signals.slice(0, REVIEW_PLAIN_ENGINEERING_SIGNAL_LIMIT)) {
		lines.push(plainEngineeringSignal(signal));
	}
	if (signals.length > REVIEW_PLAIN_ENGINEERING_SIGNAL_LIMIT) {
		lines.push(
			`truncated_engineering_signals=${signals.length - REVIEW_PLAIN_ENGINEERING_SIGNAL_LIMIT}`,
		);
	}
}

function plainEngineeringSignal(
	signal: ReviewResultData["engineering_signals"][number],
): string {
	const omitted = plainEvidenceRefsOmitted(signal.evidence_refs);
	const claims = plainClaims(signal.allowed_claims);
	return [
		`- signal=${plainSafe(signal.signal_key)}`,
		`reason=${signal.reason}`,
		`owner=${plainSafe(signal.owner_path) || "unknown"}`,
		`tier=${signal.evidence_tier}`,
		`sources=${signal.source_mix.join("/")}`,
		claims,
		`evidence=${plainEvidenceRefs(signal.evidence_refs)}`,
		...(omitted > 0 ? [`evidence_refs_omitted=${omitted}`] : []),
		`next=${plainSafe(signal.next_safe_action) || "none"}`,
	]
		.filter((part) => part !== "")
		.join(" ");
}

function appendPlainReviewLedger(
	lines: string[],
	data: Pick<ReviewResultData, "ledger_entries" | "anchor_miss_telemetry">,
): void {
	appendPlainLedgerEntries(lines, data.ledger_entries);
	appendPlainAnchorMissTelemetry(lines, data.anchor_miss_telemetry);
}

function appendPlainLedgerEntries(
	lines: string[],
	entries: ReviewResultData["ledger_entries"],
): void {
	if (entries.length === 0) return;
	lines.push("Ledger:");
	const rankedEntries = [...entries].sort(comparePlainLedgerEntries);
	for (const entry of rankedEntries.slice(0, REVIEW_PLAIN_LEDGER_ENTRY_LIMIT)) {
		lines.push(plainLedgerEntry(entry));
	}
	if (entries.length > REVIEW_PLAIN_LEDGER_ENTRY_LIMIT) {
		lines.push(
			`truncated_ledger_entries=${entries.length - REVIEW_PLAIN_LEDGER_ENTRY_LIMIT}`,
		);
	}
}

function plainLedgerEntry(entry: ReviewResultData["ledger_entries"][number]): string {
	const claims = plainClaims(entry.allowed_claims);
	const runtimes = plainRuntimeMix(entry.capture_runtime_mix);
	const targets = plainAttemptedTargets(entry.attempted_targets);
	const anchor = plainLedgerAnchor(entry);
	const omitted = plainEvidenceRefsOmitted(entry.review_unit_keys);
	return [
		`- owner=${plainLedgerOwner(entry)}`,
		`evidence=${plainEvidenceRefs(entry.review_unit_keys)}`,
		...(omitted > 0 ? [`evidence_refs_omitted=${omitted}`] : []),
		`state=${entry.resolution_state}`,
		`tier=${entry.evidence_tier}`,
		`anchor=${plainSafe(anchor)}`,
		`sources=${entry.source_mix.join("/")}`,
		runtimes,
		claims,
		targets,
		`next=${plainSafe(entry.next_safe_action) || "none"}`,
	]
		.filter((part) => part !== "")
		.join(" ");
}

function comparePlainLedgerEntries(
	left: ReviewResultData["ledger_entries"][number],
	right: ReviewResultData["ledger_entries"][number],
): number {
	const leftRank = plainLedgerRank(left);
	const rightRank = plainLedgerRank(right);
	const rank = leftRank.reduce(
		(result, value, index) => result || value - (rightRank[index] ?? 0),
		0,
	);
	if (rank !== 0) return rank;
	return left.ledger_entry_key.localeCompare(right.ledger_entry_key);
}

function plainLedgerRank(
	entry: ReviewResultData["ledger_entries"][number],
): readonly number[] {
	return [
		plainLedgerResolutionRank(entry),
		plainLedgerOwnerRank(entry),
		-plainVerificationBurdenWeight(entry.verification_burden.level),
		-plainEvidenceTierWeight(entry.evidence_tier),
	];
}

function plainLedgerResolutionRank(
	entry: ReviewResultData["ledger_entries"][number],
): number {
	if (entry.resolution_state === "open") return 0;
	if (entry.resolution_state === "resolved") return 1;
	return 2;
}

function plainLedgerOwnerRank(
	entry: ReviewResultData["ledger_entries"][number],
): number {
	const hasOwnerPath = entry.owner_paths.length > 0;
	return PLAIN_LEDGER_OWNER_RANKS[
		`${entry.anchor_strength}:${hasOwnerPath}` as PlainLedgerOwnerRankKey
	];
}

type PlainLedgerOwnerRankKey =
	`${ReviewResultData["ledger_entries"][number]["anchor_strength"]}:${boolean}`;

const PLAIN_LEDGER_OWNER_RANKS: Record<PlainLedgerOwnerRankKey, number> = {
	"strong_path:true": 0,
	"strong_path:false": 1,
	"weak:true": 2,
	"weak:false": 3,
};

function plainVerificationBurdenWeight(
	level: ReviewResultData["ledger_entries"][number]["verification_burden"]["level"],
): number {
	switch (level) {
		case "heavy":
			return 3;
		case "moderate":
			return 2;
		case "light":
			return 1;
		default:
			return 0;
	}
}

function plainEvidenceTierWeight(
	tier: ReviewResultData["ledger_entries"][number]["evidence_tier"],
): number {
	switch (tier) {
		case "trusted_engine_identity":
			return 4;
		case "corroborated":
			return 3;
		case "runtime_observed":
			return 2;
		default:
			return 1;
	}
}

function plainLedgerOwner(
	entry: ReviewResultData["ledger_entries"][number],
): string {
	const owner = entry.owner_paths[0];
	if (!owner) return "unknown";
	return plainSafe(owner) || "unknown";
}

function plainEvidenceRefs(refs: readonly string[]): string {
	const visibleRefs = refs
		.slice(0, REVIEW_PLAIN_EVIDENCE_REF_LIMIT)
		.map(plainSafe)
		.filter((ref) => ref !== "");
	if (visibleRefs.length === 0) return "none";
	return visibleRefs.join(",");
}

function plainEvidenceRefsOmitted(refs: readonly string[]): number {
	return Math.max(0, refs.length - REVIEW_PLAIN_EVIDENCE_REF_LIMIT);
}

function plainClaims(claims: ReviewResultData["ledger_entries"][number]["allowed_claims"]): string {
	if (claims.length === 0) return "";
	return `claims=${claims.join(",")}`;
}

function plainRuntimeMix(
	runtimes: ReviewResultData["ledger_entries"][number]["capture_runtime_mix"],
): string {
	if (runtimes.length === 0) return "";
	return `runtimes=${runtimes.join("/")}`;
}

function plainAttemptedTargets(
	targets: ReviewResultData["ledger_entries"][number]["attempted_targets"],
): string {
	if (targets.length === 0) return "";
	return `targets=${targets.map(plainTarget).join(",")}`;
}

function plainLedgerAnchor(
	entry: ReviewResultData["ledger_entries"][number],
): string {
	if (entry.anchor_strength === "weak") {
		return `weak:${entry.weak_anchor_reason ?? "unknown"}`;
	}
	return entry.ledger_anchor_key ?? "standalone";
}

function appendPlainAnchorMissTelemetry(
	lines: string[],
	misses: ReviewResultData["anchor_miss_telemetry"],
): void {
	if (misses.length === 0) return;
	const summary = misses
		.map((miss) => `${miss.weak_anchor_reason}×${miss.count}`)
		.join(", ");
	lines.push(`Anchor misses: ${summary}`);
}

function appendPlainReviewTail(lines: string[], data: ReviewResultData): void {
	if (data.retention.warning) {
		lines.push(`Retention: ${plainSafe(data.retention.warning)}`);
	}
	if (data.pilot_checkpoint) {
		lines.push(
			`Pilot checkpoint: ${data.pilot_checkpoint.density} density after ${data.pilot_checkpoint.age_days} days.`,
		);
	}
}

function renderPlainHealth(data: HealthResultData): string {
	const lines = [
		"Skill Feedback Health",
		`Inbox status: ${data.inbox_status}`,
		`Counts: primary=${data.counts.primary} low-signal=${data.counts.low_signal} invalid=${data.counts.invalid} skipped=${data.counts.skipped_unsafe} unlinked=${data.counts.unlinked_primary}`,
	];
	appendPlainProofHealth(lines, data.proof_health);
	appendPlainCorrelationWitnessHealth(lines, data.correlation_witnesses);
	appendHealthNewest(lines, data.newest);
	appendPlainWarnings(lines, data.warnings);
	appendPlainReadiness(lines, data.claim_readiness);
	lines.push(
		`Correlation: ${data.correlation.status} linked=${data.correlation.linked_primary_count} unlinked=${data.correlation.unlinked_primary_count}`,
	);
	lines.push(
		`Next action: ${data.next_action.action_id} - ${plainSafe(data.next_action.summary)}`,
	);
	return `${lines.join("\n")}\n`;
}

function renderHealthDashboard(
	data: HealthResultData,
	inbox: ReviewInboxRead | undefined,
): string {
	const recent = dashboardRecentReports(inbox);
	const latest = recent[0];
	const lines = [
		"Skill Feedback",
		`Reports: primary=${data.counts.primary} low-signal=${data.counts.low_signal} invalid=${data.counts.invalid} skipped=${data.counts.skipped_unsafe}`,
		healthDashboardNewest(data.newest),
		`Signal: ${dashboardSignalSummary(data)}`,
		"",
		"Dashboard paths:",
		"- Reports -> browse recent Software Learning Reports and open one detail view.",
		"- Usage -> compare skills by count, outcome, friction, and last seen time.",
		"- Queue -> inspect evidence-backed skill or owner-path improvement candidates.",
		"- Diagnostics -> inspect health, review, correlation, or purge workflows.",
		"",
		"Next Safe Actions:",
		"1. Browse recent reports - `skill-feedback reports`.",
		latest
			? `2. Open latest report - \`skill-feedback report ${reportRef(latest.report.report_id)}\`.`
			: "2. Check inbox health - `skill-feedback health --plain`.",
		"3. Review skill usage - `skill-feedback usage`.",
		"4. Inspect improvement queue - `skill-feedback queue`.",
		"5. Advanced diagnostics - `skill-feedback health` or `skill-feedback review`.",
		"",
		"Recent:",
	];
	if (recent.length === 0) {
		lines.push("  none");
	} else {
		for (const entry of recent) {
			lines.push(dashboardRecentLine(entry));
		}
	}
	lines.push(
		"",
		"Advanced:",
		"  skill-feedback review",
		"  skill-feedback health",
		"  skill-feedback correlate --plain",
		"  skill-feedback purge --help",
	);
	return `${lines.join("\n")}\n`;
}

// Covered by dashboard process tests; summary branches are user-facing output.
// fallow-ignore-next-line complexity
function dashboardSignalSummary(data: HealthResultData): string {
	if (data.inbox_status === "unsafe") {
		return "inbox is unsafe; repair state before browsing reports.";
	}
	if (data.counts.primary === 0 && data.counts.low_signal === 0) {
		return "no readable reports yet; capture and closeout commands are available.";
	}
	if (data.counts.primary === 0) {
		return "low-signal reports exist; primary report summaries need stronger capture evidence.";
	}
	return `${data.counts.primary} readable primary reports; low-signal separated; correlation diagnostics available in advanced commands.`;
}

function dashboardRecentReports(
	inbox: ReviewInboxRead | undefined,
): SkillFeedbackReportEntry[] {
	if (!inbox) return [];
	return reportEntries(inbox)
		.filter((entry) => entry.lane === "primary")
		.sort(compareReportEntriesNewestFirst)
		.slice(0, 3);
}

function dashboardRecentLine(entry: SkillFeedbackReportEntry): string {
	const report = entry.report;
	const burden = report.verification_burden?.level ?? "unknown";
	return `  ${plainTimestamp(report.generated_ts)}  ${plainSafe(report.skill) || "unknown"}  ${report.outcome}  ${burden}  ${reportRef(report.report_id)}`;
}

function uniqueOrdered(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function healthDashboardNewest(newest: HealthResultData["newest"]): string {
	const primary = newest.primary_generated_ts ?? "none";
	const lowSignal = newest.low_signal_generated_ts ?? "none";
	return `Newest: primary=${primary} low-signal=${lowSignal}`;
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function renderPlainCorrelate(data: SkillFeedbackCorrelateResultData): string {
	const lines = [
		"Skill Feedback Correlate",
		`Mode: ${data.mode}`,
		`Counts: diagnostics=${data.counts.diagnostic_count} candidates=${data.counts.candidate_count} repairable=${data.counts.repairable_count} already-linked=${data.counts.already_linked_count} ambiguous=${data.counts.ambiguous_count} insufficient=${data.counts.insufficient_evidence_count} invalid=${data.counts.invalid_count} written=${data.counts.written_count} failed=${data.counts.failed_count}`,
	];
	if (data.candidates.length > 0) {
		lines.push("Candidates:");
		for (const candidate of data.candidates.slice(0, 20)) {
			const closeouts =
				candidate.closeout_report_refs.length === 0
					? "none"
					: candidate.closeout_report_refs.map(plainSafe).join(",");
			lines.push(
				`- ${plainSafe(candidate.candidate_key)} class=${candidate.class} hook=${plainSafe(candidate.hook_report_ref ?? "none")} closeouts=${closeouts} reasons=${candidate.reason_ids.map(plainSafe).join(",")}`,
			);
		}
		if (data.candidates.length > 20) {
			lines.push(`- truncated=${data.candidates.length - 20}`);
		}
	}
	lines.push(
		`Next action: ${data.next_action.action_id} - ${plainSafe(data.next_action.summary)}`,
	);
	return `${lines.join("\n")}\n`;
}

// Covered by Branch Station process tests; plain output is command contract.
// fallow-ignore-next-line complexity
function renderPlainReports(data: SkillFeedbackReportsResultData): string {
	const lines = [
		"Skill Feedback Reports",
		`Counts: primary=${data.counts.primary_count} low-signal=${data.counts.low_signal_count} invalid=${data.counts.invalid_count} skipped=${data.counts.skipped_unsafe_count}`,
		`Filters: lane=${data.filters.lane} source=${data.filters.source} limit=${data.filters.limit}${data.filters.skill ? ` skill=${plainSafe(data.filters.skill)}` : ""}`,
		"Reports:",
	];
	if (data.reports.length === 0) {
		lines.push("- none");
	} else {
		for (const report of data.reports) {
			lines.push(
				[
					`- ${plainTimestamp(report.generated_ts)}`,
					`skill=${plainSafe(report.skill) || "unknown"}`,
					`outcome=${report.outcome}`,
					`lane=${report.lane}`,
					`source=${report.source}`,
					`ref=${plainSafe(report.report_ref)}`,
					`open=${plainSafe(report.detail_command)}`,
					`goal=${plainSafe(report.goal ?? "not recorded")}`,
				].join(" "),
			);
		}
	}
	lines.push("full_evidence=json");
	return `${lines.join("\n")}\n`;
}

// Covered by Branch Station process tests; plain output is command contract.
// fallow-ignore-next-line complexity
function renderPlainReportDetail(data: SkillFeedbackReportDetailData): string {
	const lines = [
		"Skill Feedback Report",
		`Ref: ${plainSafe(data.report_ref)}`,
		`Generated: ${data.generated_ts}`,
		`Skill: ${plainSafe(data.skill) || "unknown"}`,
		`Outcome: ${data.outcome}`,
		`Lane: ${data.lane}${data.low_signal_reason_id ? ` reason=${plainSafe(data.low_signal_reason_id)}` : ""}`,
		`Source: ${data.source}`,
		`Correlation: ${data.correlation_status}`,
		`Goal: ${plainSafe(data.goal ?? missingFieldText("goal"))}`,
		`Friction: ${plainFriction(data.friction)}`,
		`Verification: ${plainVerificationBurdenDetail(data.verification_burden)}`,
		`Touched surfaces: ${plainTargets(data.touched_surfaces)}`,
		`Observations: ${plainObservations(data.observations)}`,
		`Evidence gaps: ${plainEvidenceGaps(data.evidence_gaps)}`,
	];
	if (data.missing_fields.length > 0) {
		lines.push(`Missing fields: ${data.missing_fields.join(", ")}`);
	}
	lines.push("full_evidence=json");
	return `${lines.join("\n")}\n`;
}

// Covered by Branch Station process tests; plain output is command contract.
// fallow-ignore-next-line complexity
function renderPlainUsage(data: SkillFeedbackUsageResultData): string {
	const lines = [
		"Skill Feedback Usage",
		`Counts: primary=${data.counts.primary_count} low-signal=${data.counts.low_signal_count}`,
		`Filters: limit=${data.filters.limit}${data.filters.skill ? ` skill=${plainSafe(data.filters.skill)}` : ""}`,
		"Skills:",
	];
	if (data.skills.length === 0) {
		lines.push("- none");
	} else {
		for (const row of data.skills) {
			lines.push(
				[
					`- skill=${plainSafe(row.skill) || "unknown"}`,
					`primary=${row.primary_count}`,
					`low-signal=${row.low_signal_count}`,
					`outcomes=confirmed:${row.outcomes.confirmed},failed:${row.outcomes.failed},ambiguous:${row.outcomes.ambiguous}`,
					`closeout=${row.closeout_count}`,
					`capture=${row.capture_count}`,
					`last=${row.last_seen_generated_ts ?? "none"}`,
					...(row.common_friction
						? [`friction=${row.common_friction}`]
						: []),
					...(row.common_verification_burden
						? [`verification=${row.common_verification_burden}`]
						: []),
					`refs=${plainEvidenceRefs(row.report_refs)}`,
				].join(" "),
			);
		}
	}
	lines.push("full_evidence=json");
	return `${lines.join("\n")}\n`;
}

// Covered by Branch Station process tests; plain output is command contract.
// fallow-ignore-next-line complexity
function renderPlainQueue(data: SkillFeedbackQueueResultData): string {
	const lines = [
		"Skill Feedback Queue",
		`Counts: primary=${data.counts.primary_count} low-signal=${data.counts.low_signal_count} weak-available=${data.counts.weak_available_count}`,
		`Filters: limit=${data.filters.limit} include-weak=${data.filters.include_weak}${data.filters.skill ? ` skill=${plainSafe(data.filters.skill)}` : ""}${data.filters.owner_path ? ` owner=${plainSafe(data.filters.owner_path)}` : ""}`,
		"Rows:",
	];
	if (data.rows.length === 0) {
		lines.push("- none");
	} else {
		for (const row of data.rows) {
			lines.push(
				[
					`- target=${plainSafe(row.target) || "unknown"}`,
					`type=${row.target_type}`,
					`strength=${row.evidence_strength}`,
					...(row.skill ? [`skill=${plainSafe(row.skill)}`] : []),
					`reason=${plainSafe(row.reason)}`,
					`refs=${plainEvidenceRefs(row.report_refs)}`,
					`next=${plainSafe(row.next_safe_action)}`,
				].join(" "),
			);
		}
	}
	if (data.no_build) {
		lines.push(
			`No build: ${plainSafe(data.no_build.reason)} next=${plainSafe(data.no_build.next_safe_action)}`,
		);
	}
	lines.push("full_evidence=json");
	return `${lines.join("\n")}\n`;
}

function plainTimestamp(generatedTs: string): string {
	const safe = plainSafe(generatedTs);
	if (safe.length <= 16) return safe;
	return safe.slice(0, 16).replace("T", "T");
}

function missingFieldText(field: SkillFeedbackReportMissingField): string {
	return `${field} was not recorded`;
}

function plainFriction(
	friction: SkillFeedbackReportDetailData["friction"],
): string {
	if (!friction) return missingFieldText("friction");
	return `${friction.category}${friction.note ? ` - ${plainSafe(friction.note)}` : ""}`;
}

function plainVerificationBurdenDetail(
	burden: SkillFeedbackReportDetailData["verification_burden"],
): string {
	if (!burden) return missingFieldText("verification_burden");
	return `${burden.level}${burden.note ? ` - ${plainSafe(burden.note)}` : ""}`;
}

function plainTargets(targets: readonly ReportCardTarget[]): string {
	if (targets.length === 0) return missingFieldText("touched_surfaces");
	return targets.map(plainTarget).join(", ");
}

function plainObservations(
	observations: readonly SkillFeedbackReportDetailData["observations"][number][],
): string {
	if (observations.length === 0) return missingFieldText("observations");
	return observations
		.map((observation) =>
			[
				observation.kind,
				observation.target ? plainTarget(observation.target) : undefined,
				plainSafe(observation.summary),
			]
				.filter(isString)
				.join(":"),
		)
		.join("; ");
}

function plainEvidenceGaps(gaps: readonly EvidenceGap[]): string {
	if (gaps.length === 0) return "none";
	return gaps.map((gap) => `${gap.code}:${plainSafe(gap.path)}`).join(", ");
}

function appendPlainProofHealth(
	lines: string[],
	proofHealth: WriterProofHealth,
): void {
	const diagnostics =
		proofHealth.diagnostics.length === 0
			? ""
			: ` diagnostics=${proofHealth.diagnostics.map(plainSafe).join(",")}`;
	lines.push(
		`Proof: verified=${proofHealth.verified_count} evidence-only=${proofHealth.evidence_only_count} replay=${proofHealth.replay_diagnostics_count}${diagnostics}`,
	);
}

function appendPlainCorrelationWitnessHealth(
	lines: string[],
	health: CorrelationWitnessHealth,
): void {
	const diagnostics =
		health.diagnostics.length === 0
			? ""
			: ` diagnostics=${health.diagnostics.map(plainSafe).join(",")}`;
	lines.push(
		`Witnesses: verified=${health.verified_count} blocked=${health.blocked_count} orphan=${health.orphan_count}${diagnostics}`,
	);
}

function appendHealthNewest(
	lines: string[],
	newest: HealthResultData["newest"],
): void {
	if (newest.primary_generated_ts) {
		lines.push(`Newest primary: ${newest.primary_generated_ts}`);
	}
	if (newest.low_signal_generated_ts) {
		lines.push(`Newest low-signal: ${newest.low_signal_generated_ts}`);
	}
}

function appendPlainWarnings(
	lines: string[],
	warnings: readonly HealthWarning[],
): void {
	lines.push("Warnings:");
	if (warnings.length === 0) {
		lines.push("- none");
		return;
	}
	for (const warning of warnings) {
		lines.push(`- ${warning.reason_id}: ${plainSafe(warning.summary)}`);
	}
}

function appendPlainReadiness(
	lines: string[],
	readiness: HealthClaimReadiness | ReviewClaimReadiness,
): void {
	lines.push("Readiness:");
	for (const surface of SKILL_FEEDBACK_DECISION_READINESS_SURFACES) {
		const fact = readiness[surface.key];
		const reasons =
			fact.reason_ids.length > 0 ? ` (${fact.reason_ids.join(", ")})` : "";
		lines.push(`- ${surface.label}: ${fact.status}${reasons}`);
	}
}

/**
 * Neutralize control characters and newlines in untrusted text so a label
 * cannot inject a fake plain-output section heading (R23, AE8). Reports are
 * already field-redacted on write; this guards against structural spoofing in
 * the rendered layout.
 */
function plainSafe(value: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point.
	return value.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
}

function plainTarget(target: ReportCardTarget): string {
	return plainSafe(`${target.type}:${target.value}`);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function attachWriterProof(input: {
	report: ReportCardSoftwareLearningReport;
	inboxPath: string;
	runtime: SkillFeedbackRuntime;
	detectionId?: string;
}): Promise<{ report: ReportCardSoftwareLearningReport; diagnostics: string[] }> {
	const key = await loadOrCreateWriterProofKey(input.inboxPath, input.runtime);
	if (!key.ok) return { report: input.report, diagnostics: key.diagnostics };
	const report: ReportCardSoftwareLearningReport = { ...input.report };
	const detectionId = normalizeWriterDetectionId(input.detectionId);
	if (
		detectionId &&
		report.evidence_source === "hook_capture" &&
		report.capture_runtime === "claude_stop"
	) {
		report.skill_run_id = deriveWriterOwnedSkillRunId(key.key, detectionId);
		report.skill_run_id_provenance = "runtime_owned";
	}
	if (report.evidence_source === "hook_capture") {
		report.report_id = hookCaptureReportId(report);
	}
	try {
		return {
			report: {
				...report,
				writer_proof: createWriterProof(
					report as unknown as Record<string, unknown>,
					key.key,
					randomBytes(16).toString("hex"),
				),
			},
			diagnostics: [],
		};
	} catch {
		return {
			report,
			diagnostics: ["writer_proof_canonicalization_failed"],
		};
	}
}

function normalizeWriterDetectionId(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed === "" ? undefined : trimmed;
}

function writerProofWriteStatus(input: {
	report: ReportCardSoftwareLearningReport;
	diagnostics: string[];
}): WriterProofWriteStatus {
	return input.report.writer_proof
		? { proof_status: "attached", proof_diagnostics: [] }
		: {
				proof_status: "unavailable",
				proof_diagnostics: uniqueSorted(input.diagnostics),
			};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function loadOrCreateWriterProofKey(
	inboxPath: string,
	runtime: SkillFeedbackRuntime,
): Promise<WriterProofKeyRead> {
	const trustPath = join(inboxPath, TRUST_DIR);
	const safe = await ensureSafeTrustDirectory(inboxPath, trustPath, runtime);
	if (!safe.ok) return { ok: false, diagnostics: [safe.reason] };
	const keyPath = join(trustPath, TRUST_KEY_FILE);
	const existing = await lstatOptional(keyPath, runtime);
	if (!existing) {
		try {
			await runtime.writePrivateFile(
				keyPath,
				`${randomBytes(32).toString("hex")}\n`,
				0o600,
			);
		} catch {
			const raced = await readWriterProofKeyFile(keyPath, runtime);
			if (raced.ok) return raced;
			return { ok: false, diagnostics: ["trust_store_key_unusable"] };
		}
	}
	return readWriterProofKeyFile(keyPath, runtime);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function readWriterProofKey(
	repoRoot: string,
	runtime: SkillFeedbackRuntime,
): Promise<WriterProofKeyRead> {
	const trustPath = join(repoRoot, INBOX_DIR, TRUST_DIR);
	const trustStats = await lstatOptional(trustPath, runtime);
	if (!trustStats) {
		return { ok: false, diagnostics: ["trust_store_not_initialized"] };
	}
	if (
		trustStats.isSymbolicLink() ||
		!trustStats.isDirectory() ||
		!hasPrivateMode(trustStats, 0o077)
	) {
		return { ok: false, diagnostics: ["trust_store_key_unusable"] };
	}
	return readWriterProofKeyFile(join(trustPath, TRUST_KEY_FILE), runtime);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function ensureSafeTrustDirectory(
	inboxPath: string,
	trustPath: string,
	runtime: SkillFeedbackRuntime,
): Promise<SkillFeedbackResult<Record<never, never>, { reason: string }>> {
	const existing = await lstatOptional(trustPath, runtime);
	if (existing?.isSymbolicLink() || (existing && !existing.isDirectory())) {
		return { ok: false, reason: "trust_store_key_unusable" };
	}
	if (!existing) {
		try {
			await runtime.mkdirPrivate(trustPath, 0o700);
		} catch {
			return { ok: false, reason: "trust_store_key_unusable" };
		}
	}
	const verified = await lstatOptional(trustPath, runtime);
	if (
		!verified ||
		verified.isSymbolicLink() ||
		!verified.isDirectory() ||
		!hasPrivateMode(verified, 0o077)
	) {
		return { ok: false, reason: "trust_store_key_unusable" };
	}
	const inboxReal = await safeRealpath(inboxPath, runtime);
	const trustReal = await safeRealpath(trustPath, runtime);
	if (!inboxReal || !trustReal || !isContainedPath(inboxReal, trustReal)) {
		return { ok: false, reason: "trust_store_key_unusable" };
	}
	return { ok: true };
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function readWriterProofKeyFile(
	keyPath: string,
	runtime: SkillFeedbackRuntime,
): Promise<WriterProofKeyRead> {
	let stats: Stats | undefined;
	try {
		stats = await lstatOptional(keyPath, runtime);
	} catch {
		return { ok: false, diagnostics: ["trust_store_key_unusable"] };
	}
	if (!stats) return { ok: false, diagnostics: ["trust_store_not_initialized"] };
	if (stats.isSymbolicLink() || !stats.isFile() || !hasPrivateMode(stats, 0o077)) {
		return { ok: false, diagnostics: ["trust_store_key_unusable"] };
	}
	try {
		const raw = (await runtime.readText(keyPath)).trim();
		if (!/^[0-9a-f]{64}$/.test(raw)) {
			return { ok: false, diagnostics: ["trust_store_key_unusable"] };
		}
		const key = Buffer.from(raw, "hex");
		if (key.byteLength !== 32) {
			return { ok: false, diagnostics: ["trust_store_key_unusable"] };
		}
		return { ok: true, key, diagnostics: [] };
	} catch {
		return { ok: false, diagnostics: ["trust_store_key_unusable"] };
	}
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function prepareSkillFeedbackInbox(
	repoRoot: string,
	runtime: SkillFeedbackRuntime,
): Promise<SkillFeedbackRepairResult<{ path: string }>> {
	const inboxPath = join(repoRoot, INBOX_DIR);
	const existing = await lstatOptional(inboxPath, runtime);
	if (existing?.isSymbolicLink()) {
		return {
			ok: false,
			code: "skill_feedback_inbox_symlink_refused",
			hint: "Replace .skill-feedback with a private directory inside the repository.",
		};
	}
	if (existing && !existing.isDirectory()) {
		return {
			ok: false,
			code: "skill_feedback_inbox_not_directory",
			hint: "Replace .skill-feedback with a private directory.",
		};
	}
	if (!existing) {
		await runtime.mkdirPrivate(inboxPath, 0o700);
	}

	const verified = await lstatOptional(inboxPath, runtime);
	if (!verified) {
		return {
			ok: false,
			code: "skill_feedback_inbox_missing_after_create",
			hint: "Inspect .skill-feedback/ ownership and rerun.",
		};
	}
	if (verified.isSymbolicLink()) {
		return {
			ok: false,
			code: "skill_feedback_inbox_symlink_refused",
			hint: "Replace .skill-feedback with a private directory inside the repository.",
		};
	}
	if (!verified.isDirectory()) {
		return {
			ok: false,
			code: "skill_feedback_inbox_not_directory",
			hint: "Replace .skill-feedback with a private directory.",
		};
	}

	const repoReal = await runtime.realpathPath(repoRoot);
	const inboxReal = await runtime.realpathPath(inboxPath);
	if (!isContainedPath(repoReal, inboxReal)) {
		return {
			ok: false,
			code: "skill_feedback_inbox_escape_refused",
			hint: "Move .skill-feedback inside the repository and rerun.",
		};
	}
	return { ok: true, path: inboxPath };
}

async function prepareSkillFeedbackSubdirectory(
	parentPath: string,
	name: string,
	runtime: SkillFeedbackRuntime,
): Promise<SkillFeedbackRepairResult<{ path: string }>> {
	return preparePrivateSubdirectory(parentPath, name, runtime, {
		symlinkCode: "skill_feedback_low_signal_symlink_refused",
		notDirectoryCode: "skill_feedback_low_signal_not_directory",
		missingAfterCreateCode: "skill_feedback_low_signal_missing_after_create",
		unusableCode: "skill_feedback_low_signal_not_directory",
		escapeCode: "skill_feedback_low_signal_escape_refused",
		replaceHint: "Replace .skill-feedback/low-signal with a private directory.",
		missingHint: "Inspect .skill-feedback/low-signal ownership and rerun.",
		escapeHint: "Move .skill-feedback/low-signal inside the inbox and rerun.",
		requirePrivateMode: false,
	});
}

type PrivateSubdirectoryCodes = {
	symlinkCode: string;
	notDirectoryCode: string;
	missingAfterCreateCode: string;
	unusableCode: string;
	escapeCode: string;
	replaceHint: string;
	missingHint: string;
	escapeHint: string;
	requirePrivateMode: boolean;
};

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function preparePrivateSubdirectory(
	parentPath: string,
	name: string,
	runtime: SkillFeedbackRuntime,
	codes: PrivateSubdirectoryCodes,
): Promise<SkillFeedbackRepairResult<{ path: string }>> {
	const directoryPath = join(parentPath, name);
	const existing = await lstatOptional(directoryPath, runtime);
	if (existing?.isSymbolicLink()) {
		return {
			ok: false,
			code: codes.symlinkCode,
			hint: codes.replaceHint,
		};
	}
	if (existing && !existing.isDirectory()) {
		return {
			ok: false,
			code: codes.notDirectoryCode,
			hint: codes.replaceHint,
		};
	}
	if (!existing) {
		await runtime.mkdirPrivate(directoryPath, 0o700);
	}

	const verified = await lstatOptional(directoryPath, runtime);
	if (!verified) {
		return {
			ok: false,
			code: codes.missingAfterCreateCode,
			hint: codes.missingHint,
		};
	}
	if (
		verified.isSymbolicLink() ||
		!verified.isDirectory() ||
		(codes.requirePrivateMode && !hasPrivateMode(verified, 0o077))
	) {
		return {
			ok: false,
			code: codes.unusableCode,
			hint: codes.replaceHint,
		};
	}

	const inboxReal = await safeRealpath(parentPath, runtime);
	const directoryReal = await safeRealpath(directoryPath, runtime);
	if (!inboxReal || !directoryReal || !isContainedPath(inboxReal, directoryReal)) {
		return {
			ok: false,
			code: codes.escapeCode,
			hint: codes.escapeHint,
		};
	}
	return { ok: true, path: directoryPath };
}

async function writeAtomicPrivateFile(
	path: string,
	content: string,
	mode: number,
): Promise<void> {
	const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random()
		.toString(16)
		.slice(2)}`;
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(tempPath, "wx", mode);
		await handle.writeFile(content, "utf-8");
		await handle.close();
		handle = undefined;
		await chmod(tempPath, mode);
		await link(tempPath, path);
	} finally {
		if (handle) await handle.close().catch(() => undefined);
		await unlink(tempPath).catch(() => undefined);
	}
}

async function rollbackReportPath(
	reportPath: string,
	runtime: SkillFeedbackRuntime,
): Promise<"missing" | "removed" | "failed"> {
	const stats = await lstatOptional(reportPath, runtime);
	if (!stats) return "missing";
	try {
		await runtime.removeFile(reportPath);
		return "removed";
	} catch {
		return "failed";
	}
}

async function writeReportWithRollback(input: {
	reportPath: string;
	report: ReportCardSoftwareLearningReport;
	runtime: SkillFeedbackRuntime;
	runId: string;
	code: string;
	message: string;
	hint: string;
	contract?: SkillFeedbackResultContractId;
}): Promise<SkillFeedbackProcessResult | undefined> {
	try {
		await input.runtime.writePrivateFile(
			input.reportPath,
			`${JSON.stringify(input.report, null, "\t")}\n`,
			0o600,
		);
		return undefined;
	} catch {
		const rollback = await rollbackReportPath(input.reportPath, input.runtime);
		return errorResult(
			input.runId,
			RUNTIME_FAILURE_EXIT_CODE,
			input.code,
			input.message,
			{
				recoverability: "repair_state",
				hint: input.hint,
				...(input.contract ? { contract: input.contract } : {}),
				changedState: rollback === "failed" ? "partial" : "none",
			},
		);
	}
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function closeoutRuntimeTelemetry(
	receipt: Partial<CloseoutReceipt>,
	runtime: SkillFeedbackRuntime,
): Promise<ReportCardSoftwareLearningReport["runtime"]> {
	const runtimeTelemetry: ReportCardSoftwareLearningReport["runtime"] = {};
	const gitSha = await runtime.readGitSha();
	if (gitSha) runtimeTelemetry.git_sha = gitSha;
	if (receipt.skill) {
		const skillVersion = await runtime.readSkillVersion(receipt.skill);
		if (skillVersion && skillVersion !== "unknown") {
			runtimeTelemetry.skill_version = skillVersion;
		}
	}
	return runtimeTelemetry;
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function buildHookCaptureReport(
	report: SoftwareLearningReport,
	redactions: number,
): ReportCardSoftwareLearningReport {
	const runtime: ReportCardSoftwareLearningReport["runtime"] = {
		...(report.git_sha ? { git_sha: report.git_sha } : {}),
		...(report.skill_version ? { skill_version: report.skill_version } : {}),
		...(report.model ? { model: report.model } : {}),
		...(!report.gaps.includes("usage") ? { usage: report.usage } : {}),
	};
	const reportCard: Partial<CloseoutReceipt> = {
		skill: report.skill,
		outcome: report.outcome,
		goal: report.goal,
		friction: hookCaptureFriction(report.friction),
		verification_burden: {
			level: "none",
			note: "Hook capture supplied no driver verification burden.",
		},
		touched_surfaces: [],
		observations: [],
	};
	const persisted: ReportCardSoftwareLearningReport = {
		schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
		report_id: "",
		untrusted_evidence: true,
		generated_ts: report.generated_ts,
		evidence_source: "hook_capture",
		...(report.capture_runtime
			? { capture_runtime: report.capture_runtime }
			: {}),
		...(report.skill_identity_provenance
			? { skill_identity_provenance: report.skill_identity_provenance }
			: {}),
		correlation_status: "unlinked",
		skill: report.skill,
		runtime,
		report_card: reportCard,
		evidence_gaps: hookCaptureEvidenceGaps(report),
		redactions,
	};
	return { ...persisted, report_id: hookCaptureReportId(persisted) };
}

function hookCaptureReportId(report: ReportCardSoftwareLearningReport): string {
	const { report_id, writer_proof, ...seed } = report;
	void report_id;
	void writer_proof;
	return stableReportId("hook", seed);
}

function hookCaptureFriction(note: string): FrictionSignal {
	if (note === "" || note === "Hook captured no transcript payload.") {
		return {
			category: "none",
			note: "Hook capture supplied no friction signal.",
		};
	}
	return { category: "other", note };
}

function hookCaptureEvidenceGaps(
	report: SoftwareLearningReport,
): readonly EvidenceGap[] {
	const gaps = report.gaps
		.filter((field) => field !== "usage")
		.map(hookCaptureGap);
	gaps.push(
		evidenceGap(
			"cost_unavailable",
			"cost",
			"Skill-attributed cost is unavailable in v1.",
		),
	);
	return uniqueEvidenceGaps(gaps);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function hookCaptureGap(field: SoftwareLearningReport["gaps"][number]): EvidenceGap {
	switch (field) {
		case "skill":
			return evidenceGap("missing_skill", field, "Hook capture is missing skill.");
		case "outcome":
			return evidenceGap(
				"missing_outcome",
				field,
				"Hook capture is missing outcome.",
			);
		case "goal":
			return evidenceGap("missing_goal", field, "Hook capture is missing goal.");
		case "friction":
			return evidenceGap(
				"missing_friction",
				field,
				"Hook capture is missing friction.",
			);
		case "model":
			return evidenceGap(
				"missing_runtime_model",
				field,
				"Hook capture is missing model.",
			);
		case "git_sha":
			return evidenceGap(
				"missing_runtime_git_sha",
				field,
				"Hook capture is missing git SHA.",
			);
		case "skill_version":
			return evidenceGap(
				"missing_runtime_skill_version",
				field,
				"Hook capture is missing skill version.",
			);
		default:
			return evidenceGap(
				"cost_unavailable",
				field,
				"Hook capture does not carry trusted skill-attributed cost.",
			);
	}
}

function closeoutEvidenceGaps(
	closeoutGaps: readonly EvidenceGap[],
	runtimeTelemetry: ReportCardSoftwareLearningReport["runtime"],
): readonly EvidenceGap[] {
	const gaps = [...closeoutGaps];
	if (!runtimeTelemetry.git_sha) {
		gaps.push(
			evidenceGap(
				"missing_runtime_git_sha",
				"runtime.git_sha",
				"Closeout could not read git SHA.",
			),
		);
	}
	if (!runtimeTelemetry.skill_version) {
		gaps.push(
			evidenceGap(
				"missing_runtime_skill_version",
				"runtime.skill_version",
				"Closeout could not read skill version.",
			),
		);
	}
	if (!runtimeTelemetry.model) {
		gaps.push(
			evidenceGap(
				"missing_runtime_model",
				"runtime.model",
				"Closeout has no trusted runtime model source.",
			),
		);
	}
	gaps.push(
		evidenceGap(
			"cost_unavailable",
			"cost",
			"Skill-attributed cost is unavailable in v1.",
		),
	);
	return uniqueEvidenceGaps(gaps);
}

function buildCloseoutReport(input: {
	generatedTs: string;
	receipt: Partial<CloseoutReceipt>;
	runtimeTelemetry: ReportCardSoftwareLearningReport["runtime"];
	correlationStatus: CorrelationStatus;
	evidenceGaps: readonly EvidenceGap[];
}): ReportCardSoftwareLearningReport {
	const reportSeed = {
		generated_ts: input.generatedTs,
		report_card: input.receipt,
		runtime: input.runtimeTelemetry,
	};
	return {
		schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
		report_id: stableReportId("closeout", reportSeed),
		untrusted_evidence: true,
		generated_ts: input.generatedTs,
		evidence_source: "driver_closeout",
		correlation_status: input.correlationStatus,
		skill: input.receipt.skill ?? "",
		runtime: input.runtimeTelemetry,
		report_card: input.receipt,
		evidence_gaps: input.evidenceGaps,
		redactions: 0,
	};
}

async function inspectPilotMarker(
	inboxPath: string,
	runtime: SkillFeedbackRuntime,
): Promise<SkillFeedbackRepairResult<{ state: "missing" | "present" }>> {
	const markerPath = join(inboxPath, PILOT_MARKER_FILE);
	const marker = await lstatOptional(markerPath, runtime);
	if (!marker) return { ok: true, state: "missing" };
	if (marker.isSymbolicLink()) {
		return {
			ok: false,
			code: "pilot_marker_symlink_refused",
			hint: "Remove the unsafe pilot marker path and rerun closeout.",
		};
	}
	if (!marker.isFile()) {
		return {
			ok: false,
			code: "pilot_marker_not_file",
			hint: "Replace the pilot marker with a regular private file.",
		};
	}
	return { ok: true, state: "present" };
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function writeMissingPilotMarker(
	inboxPath: string,
	generatedTs: string,
	runtime: SkillFeedbackRuntime,
): Promise<SkillFeedbackRepairResult> {
	const markerPath = join(inboxPath, PILOT_MARKER_FILE);
	try {
		await runtime.writePrivateFile(markerPath, `${generatedTs}\n`, 0o600);
		return { ok: true };
	} catch (error) {
		if (isNodeErrorCode(error, "EEXIST")) {
			const markerCheck = await inspectPilotMarker(inboxPath, runtime);
			if (markerCheck.ok && markerCheck.state === "present") {
				return { ok: true };
			}
			if (!markerCheck.ok) {
				return {
					ok: false,
					code: markerCheck.code,
					hint: markerCheck.hint,
				};
			}
		}
		return {
			ok: false,
			code: "pilot_marker_write_failed",
			hint: "Inspect .skill-feedback/pilot_started_at ownership and retry closeout.",
		};
	}
}

async function rollbackWrittenReport(
	reportPath: string,
	runtime: SkillFeedbackRuntime,
): Promise<boolean> {
	try {
		await runtime.removeFile(reportPath);
		return true;
	} catch {
		return false;
	}
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function prepareReceipt(
	rawReceipt: unknown,
	runtime: SkillFeedbackRuntime,
	internalTelemetry: InternalRecordTelemetry = {},
): Promise<
	| {
			ok: true;
			fields: Partial<Receipt>;
			captureMetadata: CaptureMetadata;
			detectionId?: string;
	  }
	| { ok: false; code: string; message: string }
> {
	if (
		typeof rawReceipt !== "object" ||
		rawReceipt === null ||
		Array.isArray(rawReceipt)
	) {
		return {
			ok: false,
			code: "invalid_receipt",
			message: "Receipt must be an object.",
		};
	}

	const fields = { ...(rawReceipt as Record<string, unknown>) } as Partial<Receipt>;
	const preflight = parseReceipt(fields);
	if (preflight.kind === "unknown-field") {
		return {
			ok: false,
			code: "unknown_receipt_field",
			message: `Receipt contains unknown field ${preflight.field}.`,
		};
	}
	if (preflight.kind === "invalid") {
		return {
			ok: false,
			code: "invalid_receipt_field",
			message: `Receipt field ${preflight.field} is invalid.`,
		};
	}

	if (!fields.git_sha) {
		fields.git_sha = await runtime.readGitSha();
	}
	if (fields.skill && !fields.skill_version) {
		fields.skill_version = await runtime.readSkillVersion(fields.skill);
	}
	// Public stdin is model-only. Trust-bearing capture fields come from the
	// hook-owned direct runner call so agent-authored record input cannot mint
	// runtime proof.
	const telemetry = await runtime.readStdinTelemetry();
	const model = internalTelemetry.model ?? telemetry.model;
	if (model) {
		fields.model = model;
	}
	const detectionId = normalizeWriterDetectionId(internalTelemetry.detectionId);
	return {
		ok: true,
		fields,
		captureMetadata: internalTelemetry.captureMetadata ?? {},
		...(detectionId ? { detectionId } : {}),
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function errorResult(
	runId: string,
	exitCode: number,
	code: string,
	message: string,
	options: SkillFeedbackErrorOptions,
): SkillFeedbackProcessResult {
	const envelope = createCliRuntimeErrorEnvelope({
		run_id: runId,
		process_exit_code: exitCode,
			error:
				options.recoverability === "change_input"
					? createCliRuntimeError({
							run_id: runId,
							code,
							message,
							exit_code: exitCode,
							severity: exitCode === USAGE_EXIT_CODE ? "error" : "fatal",
							recoverability: "change_input",
							retryable: false,
							failure_domain: "skill_feedback",
							hint: skillFeedbackAgentHint("change_input", options.hint),
						})
				: createCliRepairStateRuntimeError({
						run_id: runId,
						code,
						message,
						exit_code: exitCode,
						severity: exitCode === USAGE_EXIT_CODE ? "error" : "fatal",
						failure_domain: "skill_feedback",
						hint: skillFeedbackAgentHint("repair_state", options.hint),
					}),
		data: {
			...options.data,
			changed_state: options.changedState ?? "none",
			contract: options.contract ?? SKILL_FEEDBACK_CONTRACT_ID,
			schema_version: schemaVersionForContract(options.contract),
		},
	});
	return { exitCode, stdout: `${JSON.stringify(envelope)}\n`, stderr: "" };
}

function skillFeedbackAgentHint(
	recoverability: "change_input",
	hint: SkillFeedbackErrorHint<"change_input">,
): AgentHintForRecoverability<"change_input">;
function skillFeedbackAgentHint(
	recoverability: "repair_state",
	hint: SkillFeedbackErrorHint<"repair_state">,
): AgentHintForRecoverability<"repair_state">;
function skillFeedbackAgentHint(
	recoverability: SkillFeedbackErrorRecoverability,
	hint: SkillFeedbackErrorHint<SkillFeedbackErrorRecoverability>,
): AgentHintForRecoverability<SkillFeedbackErrorRecoverability> {
	if (typeof hint === "string") {
		return { summary: hint, action: recoverability };
	}
	return {
		summary: hint.summary,
		action: hint.action ?? recoverability,
		...(hint.docs_url ? { docs_url: hint.docs_url } : {}),
	};
}

function schemaVersionForContract(
	contract: SkillFeedbackResultContractId | undefined,
): string {
	const contractId = contract ?? SKILL_FEEDBACK_CONTRACT_ID;
	return (
		SKILL_FEEDBACK_HELP_COMMANDS.map(
			(command) => skillFeedbackContracts[command].resultContract,
		).find((resultContract) => resultContract?.id === contractId)?.schema_version ??
		SKILL_FEEDBACK_SCHEMA_VERSION
	);
}

function isStrictIsoTimestamp(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
		new Date(value).toISOString() === value
	);
}

function reportFileName(
	report: SoftwareLearningReport | ReportCardSoftwareLearningReport,
): string {
	const ts = report.generated_ts.replace(/[:.]/g, "-");
	const skillName = report.skill;
	const skill = skillName.replace(/[^a-zA-Z0-9._-]/g, "_") || "unknown-skill";
	const hash = createHash("sha256")
		.update(JSON.stringify(report))
		.digest("hex")
		.slice(0, 12);
	return `${ts}-${skill}-${hash}.json`;
}

async function skillVersionFromPackage(
	skill: string,
	repoRoot: string,
): Promise<string> {
	const packagePath = join(repoRoot, "skills", skill, "package.json");
	try {
		const raw = await readFile(packagePath, "utf-8");
		const parsed = JSON.parse(raw) as { version?: unknown };
		return typeof parsed.version === "string" ? parsed.version : "unknown";
	} catch {
		return "unknown";
	}
}

async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) return "";
	try {
		return await Bun.stdin.text();
	} catch {
		return "";
	}
}

/**
 * Parse public record stdin into validated telemetry.
 *
 * Garbled, empty, or partially-typed input degrades to `{}` (R21) rather than
 * throwing — a missing or malformed telemetry channel must never break the
 * capture turn (KTD6). Only `model` (a non-empty string) is accepted; every
 * other field is ignored, so no transcript prose smuggled onto the channel can
 * reach the record. v0 carries no usage on this channel.
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export function parseStdinTelemetry(raw: string): StdinTelemetry {
	const trimmed = raw.trim();
	if (!trimmed) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return {};
	}
	const object = parsed as Record<string, unknown>;
	const telemetry: StdinTelemetry = {};
	if (typeof object.model === "string" && object.model !== "") {
		telemetry.model = object.model;
	}
	return telemetry;
}

async function defaultGitRunner(
	args: readonly string[],
	options: { cwd: string },
): Promise<SkillFeedbackGitResult> {
	const result = await runProcess(args, options.cwd);
	return {
		ok: result.exitCode === 0,
		stdout: result.stdout,
		stderr: result.stderr,
		code: result.exitCode,
	};
}

/**
 * Resolve the repository root a read command should inspect.
 *
 * @param input - Target path, caller cwd, and injectable git runner
 * @returns Resolved repository and inbox paths, or a repair-state failure
 */
export async function resolveSkillFeedbackReadTarget(input: {
	targetPath?: string;
	cwd: string;
	runGit: SkillFeedbackGitRunner;
}): Promise<ReadTargetResolution> {
	const explicit = input.targetPath !== undefined;
	const seedPath =
		input.targetPath === undefined
			? resolve(input.cwd)
			: resolve(input.cwd, input.targetPath);
	const topLevel = await readGitTopLevel(input.runGit, seedPath);
	if (!topLevel.ok) {
		return readTargetResolutionFailure(explicit, seedPath, topLevel.gitExitCode);
	}
	const repoRoot = resolve(topLevel.repoRoot);
	return {
		ok: true,
		explicit,
		seedPath,
		repoRoot,
		inboxPath: join(repoRoot, INBOX_DIR),
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function readGitTopLevel(
	runGit: SkillFeedbackGitRunner,
	seedPath: string,
): Promise<SkillFeedbackResult<{ repoRoot: string }, { gitExitCode?: number }>> {
	let result: SkillFeedbackGitResult;
	try {
		result = await runGit(["git", "-C", seedPath, "rev-parse", "--show-toplevel"], {
			cwd: seedPath,
		});
	} catch {
		return { ok: false };
	}
	const repoRoot = result.stdout.trim();
	if (result.ok && result.code === 0 && repoRoot) {
		return { ok: true, repoRoot };
	}
	return { ok: false, gitExitCode: result.code };
}

function readTargetResolutionFailure(
	explicit: boolean,
	seedPath: string,
	gitExitCode?: number,
): ReadTargetResolution {
	return {
		ok: false,
		explicit,
		seedPath,
		code: "read_target_resolution_failed",
		message: "Skill-feedback read target is outside a repository.",
		hint: "Choose a path inside the intended repository or start from that repository.",
		...(gitExitCode === undefined ? {} : { gitExitCode }),
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function runProcess(
	command: readonly string[],
	cwd: string,
	timeoutMs: number = DEFAULT_RUNNER_PROCESS_TIMEOUT_MS,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = Bun.spawn([...command], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timeout =
		timeoutMs > 0
			? setTimeout(() => {
					timedOut = true;
					child.kill();
				}, timeoutMs)
			: null;
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return {
			exitCode: timedOut ? 124 : exitCode,
			stdout,
			stderr: timedOut
				? appendRunnerTimeoutMessage(stderr, timeoutMs)
				: stderr,
		};
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function appendRunnerTimeoutMessage(stderr: string, timeoutMs: number): string {
	const separator = stderr === "" || stderr.endsWith("\n") ? "" : "\n";
	return `${stderr}${separator}skill-feedback runner subprocess timed out after ${timeoutMs}ms.\n`;
}

export async function runProcessForTest(
	command: readonly string[],
	cwd: string,
	timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return runProcess(command, cwd, timeoutMs);
}

// Covered by unit and process-boundary argv tests; dispatcher branches mirror public CLI routes.
// fallow-ignore-next-line complexity
export async function runSkillFeedbackCli(
	argv: readonly string[],
	options: SkillFeedbackCliOptions = {},
): Promise<number> {
	const command = argv[0];
	if (argv.includes("--help") || argv.includes("-h")) {
		return writeHelp(command);
	}
	if (command === undefined) {
		return runDashboardCommandCli([], options);
	}
	const handler = skillFeedbackCliHandler(command);
	if (!handler) return writeProcessResult(unknownCommandResult(command, options));
	return handler(argv, options);
}

function writeHelp(command: string | undefined): number {
	process.stdout.write(renderSkillFeedbackHelp(command));
	return 0;
}

function skillFeedbackCliHandler(
	command: string,
): SkillFeedbackCliHandler | undefined {
	if (command === "record" || command.startsWith("--")) {
		return runRecordCommandCli;
	}
	return SKILL_FEEDBACK_CLI_HANDLERS[command];
}

// Covered by public dashboard CLI tests; keep runner-local usage branches explicit.
// fallow-ignore-next-line complexity
async function runDashboardCommandCli(
	argv: readonly string[],
	options: SkillFeedbackCliOptions,
): Promise<number> {
	const dashboardUsageMessage =
		argv[0] !== undefined && !argv[0].startsWith("--")
			? "Expected a dashboard flag."
			: argv.includes("--plain")
				? "Unknown flag --plain."
				: undefined;
	if (dashboardUsageMessage) {
		return writeProcessResult(
			errorResult(
				options.runId ?? "skill-feedback-dashboard",
				USAGE_EXIT_CODE,
				"usage_error",
				dashboardUsageMessage,
				{
					recoverability: "change_input",
					hint: "Run skill-feedback dashboard --help and retry with valid flags.",
					contract: SKILL_FEEDBACK_DASHBOARD_CONTRACT_ID,
				},
			),
		);
	}
	const parsed = parseReadOnlyArgs(argv, "health");
	if (!parsed.ok) {
		return writeProcessResult(
			errorResult(
				options.runId ?? "skill-feedback-dashboard",
				USAGE_EXIT_CODE,
				"usage_error",
				parsed.message,
				{
					recoverability: "change_input",
					hint: "Run skill-feedback dashboard --help and retry with valid flags.",
					contract: SKILL_FEEDBACK_DASHBOARD_CONTRACT_ID,
				},
			),
		);
	}
	return writeProcessResult(
		await healthSkillFeedbackInbox({
			...options,
			dashboard: true,
			targetPath: parsed.options.targetPath,
		}),
	);
}

function unknownCommandResult(
	command: string | undefined,
	options: SkillFeedbackCliOptions,
): SkillFeedbackProcessResult {
	return errorResult(
		options.runId ?? "skill-feedback-record",
		USAGE_EXIT_CODE,
		"usage_error",
		`Unknown command ${command}.`,
		{
			recoverability: "change_input",
			hint: "Run skill-feedback --help and retry with a supported command.",
		},
	);
}

async function runRecordCommandCli(
	argv: readonly string[],
	options: SkillFeedbackCliOptions,
): Promise<number> {
	const receipt = parseRecordFlags(argv);
	if (!receipt.ok) {
		return writeProcessResult(
			errorResult(
				options.runId ?? "skill-feedback-record",
				USAGE_EXIT_CODE,
				"usage_error",
				receipt.message,
				{
					recoverability: "change_input",
					hint: "Run skill-feedback record --help and retry with valid flags.",
				},
			),
		);
	}
	const result = await recordSkillFeedbackReceipt(receipt.receipt, options);
	return writeProcessResult(result);
}

async function runCloseoutCommandCli(
	argv: readonly string[],
	options: SkillFeedbackCliOptions,
): Promise<number> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	if (argv.length > 1) {
		return writeProcessResult(closeoutArgvError(options));
	}
	const parsed = parseCloseoutStdin(await runtime.readStdinText());
	if (!parsed.ok) return writeProcessResult(closeoutStdinError(options, parsed));
	return writeProcessResult(
		await closeoutSkillFeedbackReceipt(parsed.receipt, {
			...options,
			runtime,
		}),
	);
}

function closeoutArgvError(
	options: SkillFeedbackCliOptions,
): SkillFeedbackProcessResult {
	return errorResult(
		options.runId ?? "skill-feedback-closeout",
		USAGE_EXIT_CODE,
		"usage_error",
		"Closeout accepts receipt JSON on stdin, not argv fields.",
		{
			recoverability: "change_input",
			hint: "Run skill-feedback closeout --help and pipe receipt JSON on stdin.",
			contract: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
		},
	);
}

function closeoutStdinError(
	options: SkillFeedbackCliOptions,
	parsed: Extract<ReturnType<typeof parseCloseoutStdin>, { ok: false }>,
): SkillFeedbackProcessResult {
	return errorResult(
		options.runId ?? "skill-feedback-closeout",
		USAGE_EXIT_CODE,
		parsed.code,
		parsed.message,
		{
			recoverability: "change_input",
			hint: parsed.hint,
			contract: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
		},
	);
}

async function runPurgeCommandCli(
	argv: readonly string[],
	options: SkillFeedbackCliOptions,
): Promise<number> {
	const parsed = parsePurgeArgs(argv.slice(1));
	if (!parsed.ok) return writeProcessResult(purgeUsageError(options, parsed.message));
	return writeProcessResult(
		await purgeSkillFeedbackInbox({
			...options,
			purge: parsed.options,
		}),
	);
}

async function runCorrelateCommandCli(
	argv: readonly string[],
	options: SkillFeedbackCliOptions,
): Promise<number> {
	const parsed = parseCorrelateArgs(argv.slice(1));
	if (!parsed.ok) {
		return writeProcessResult(
			errorResult(
				options.runId ?? "skill-feedback-correlate",
				USAGE_EXIT_CODE,
				"usage_error",
				parsed.message,
				{
					recoverability: "change_input",
					hint: "Run skill-feedback correlate --help and retry with valid flags.",
					contract: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
				},
			),
		);
	}
	return writeProcessResult(
		await correlateSkillFeedbackInbox({
			...options,
			plain: parsed.options.plain,
			targetPath: parsed.options.targetPath,
			execute: parsed.options.execute,
		}),
	);
}

async function runReportsCommandCli(
	argv: readonly string[],
	options: SkillFeedbackCliOptions,
): Promise<number> {
	const parsed = parseReportsArgs(argv.slice(1));
	if (!parsed.ok) {
		return writeProcessResult(
			humanReadUsageError(
				options,
				"reports",
				SKILL_FEEDBACK_REPORTS_CONTRACT_ID,
				parsed.message,
			),
		);
	}
	return writeProcessResult(
		await listSkillFeedbackReports({ ...options, reports: parsed.options }),
	);
}

async function runReportCommandCli(
	argv: readonly string[],
	options: SkillFeedbackCliOptions,
): Promise<number> {
	const parsed = parseReportArgs(argv.slice(1));
	if (!parsed.ok) {
		return writeProcessResult(
			humanReadUsageError(
				options,
				"report",
				SKILL_FEEDBACK_REPORT_CONTRACT_ID,
				parsed.message,
			),
		);
	}
	return writeProcessResult(
		await showSkillFeedbackReport({ ...options, report: parsed.options }),
	);
}

async function runUsageCommandCli(
	argv: readonly string[],
	options: SkillFeedbackCliOptions,
): Promise<number> {
	const parsed = parseUsageArgs(argv.slice(1));
	if (!parsed.ok) {
		return writeProcessResult(
			humanReadUsageError(
				options,
				"usage",
				SKILL_FEEDBACK_USAGE_CONTRACT_ID,
				parsed.message,
			),
		);
	}
	return writeProcessResult(
		await showSkillFeedbackUsage({ ...options, usage: parsed.options }),
	);
}

async function runQueueCommandCli(
	argv: readonly string[],
	options: SkillFeedbackCliOptions,
): Promise<number> {
	const parsed = parseQueueArgs(argv.slice(1));
	if (!parsed.ok) {
		return writeProcessResult(
			humanReadUsageError(
				options,
				"queue",
				SKILL_FEEDBACK_QUEUE_CONTRACT_ID,
				parsed.message,
			),
		);
	}
	return writeProcessResult(
		await showSkillFeedbackQueue({ ...options, queue: parsed.options }),
	);
}

function humanReadUsageError(
	options: SkillFeedbackCliOptions,
	command: "reports" | "report" | "usage" | "queue",
	contract: SkillFeedbackResultContractId,
	message: string,
): SkillFeedbackProcessResult {
	return errorResult(
		options.runId ?? `skill-feedback-${command}`,
		USAGE_EXIT_CODE,
		"usage_error",
		message,
		{
			recoverability: "change_input",
			hint: `Run skill-feedback ${command} --help and retry with valid flags.`,
			contract,
		},
	);
}

function purgeUsageError(
	options: SkillFeedbackCliOptions,
	message: string,
): SkillFeedbackProcessResult {
	return errorResult(
		options.runId ?? "skill-feedback-purge",
		USAGE_EXIT_CODE,
		"usage_error",
		message,
		{
			recoverability: "change_input",
			hint: "Use purge help and retry with one valid retention selector.",
			contract: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
		},
	);
}

const SKILL_FEEDBACK_CLI_HANDLERS: Partial<Record<string, SkillFeedbackCliHandler>> = {
	dashboard: (argv, options) => runDashboardCommandCli(argv.slice(1), options),
	reports: runReportsCommandCli,
	report: runReportCommandCli,
	usage: runUsageCommandCli,
	queue: runQueueCommandCli,
	closeout: runCloseoutCommandCli,
	review: (argv, options) => runReadCommandCli("review", argv.slice(1), options),
	health: (argv, options) => runReadCommandCli("health", argv.slice(1), options),
	purge: runPurgeCommandCli,
	correlate: runCorrelateCommandCli,
};

function writeProcessResult(result: SkillFeedbackProcessResult): number {
	process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	return result.exitCode;
}

async function runReadCommandCli(
	command: SkillFeedbackReadCommand,
	argv: readonly string[],
	options: { runtime?: SkillFeedbackRuntime; runId?: string },
): Promise<number> {
	const parsed = parseReadCommandArgs(command, argv);
	if (!parsed.ok) {
		return writeProcessResult(
			errorResult(
				options.runId ?? `skill-feedback-${command}`,
				USAGE_EXIT_CODE,
				"usage_error",
				parsed.message,
				{
					recoverability: "change_input",
					hint: `Run skill-feedback ${command} --help and retry with valid flags.`,
					contract: readCommandContract(command),
				},
			),
		);
	}
	return writeProcessResult(
		await runReadCommand(command, {
			...options,
			plain: parsed.options.plain,
			targetPath: parsed.options.targetPath,
		}),
	);
}

function parseReadCommandArgs(
	command: SkillFeedbackReadCommand,
	argv: readonly string[],
): ReturnType<typeof parseReviewArgs> {
	return command === "review" ? parseReviewArgs(argv) : parseHealthArgs(argv);
}

function readCommandContract(
	command: SkillFeedbackReadCommand,
):
	| typeof SKILL_FEEDBACK_REVIEW_CONTRACT_ID
	| typeof SKILL_FEEDBACK_HEALTH_CONTRACT_ID {
	return command === "review"
		? SKILL_FEEDBACK_REVIEW_CONTRACT_ID
		: SKILL_FEEDBACK_HEALTH_CONTRACT_ID;
}

function runReadCommand(
	command: SkillFeedbackReadCommand,
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
		plain?: boolean;
		targetPath?: string;
	},
): Promise<SkillFeedbackProcessResult> {
	return command === "review"
		? reviewSkillFeedbackInbox(options)
		: healthSkillFeedbackInbox(options);
}

function renderSkillFeedbackHelp(command: string | undefined): string {
	if (isSkillFeedbackHelpCommand(command)) {
		return renderCommandUsage(skillFeedbackContracts[command]);
	}
	return `skill-feedback\n\nFront door:\n  skill-feedback                  Show read-only dashboard for the current repo.\n  skill-feedback dashboard        Show the same dashboard with optional repo targeting.\n  skill-feedback health           Show machine-readable health JSON.\n  skill-feedback --help           Show command help.\n\nCommands:\n\n${SKILL_FEEDBACK_HELP_COMMANDS.map((helpCommand) =>
		renderCommandUsage(skillFeedbackContracts[helpCommand]).trimEnd(),
	).join("\n\n")}\n`;
}

function isSkillFeedbackHelpCommand(
	command: string | undefined,
): command is (typeof SKILL_FEEDBACK_HELP_COMMANDS)[number] {
	return SKILL_FEEDBACK_HELP_COMMANDS.includes(
		command as (typeof SKILL_FEEDBACK_HELP_COMMANDS)[number],
	);
}

function parseCloseoutStdin(
	raw: string,
):
	| { ok: true; receipt: unknown }
	| {
			ok: false;
			code: string;
			message: string;
			hint: SkillFeedbackErrorHint<"change_input">;
	  }
{
	const bytes = new TextEncoder().encode(raw).byteLength;
	if (bytes > MAX_CLOSEOUT_STDIN_BYTES) {
		return {
			ok: false,
			code: "closeout_stdin_too_large",
			message: "Closeout stdin exceeds the supported size.",
			hint: "Send one compact closeout receipt JSON object on stdin.",
		};
	}
	const trimmed = raw.trim();
	if (!trimmed) {
		return {
			ok: false,
			code: "closeout_stdin_empty",
			message: "Closeout requires one JSON receipt on stdin.",
			hint: {
				summary:
					"Closeout received empty stdin; use the receipt guide for the stdin-capable invocation.",
				action: "change_input",
				docs_url: CLOSEOUT_RECEIPT_DOCS_URL,
			},
		};
	}
	try {
		return { ok: true, receipt: JSON.parse(trimmed) as unknown };
	} catch {
		return {
			ok: false,
			code: "closeout_stdin_malformed",
			message: "Closeout stdin is not valid JSON.",
			hint: "Fix the closeout receipt JSON and retry.",
		};
	}
}

/**
 * Parse public `review` argv without touching the inbox.
 *
 * @param argv - Review command arguments with or without the leading subcommand
 * @returns Parsed read options or a usage error message
 */
export function parseReviewArgs(
	argv: readonly string[],
):
	| { ok: true; options: { plain: boolean; targetPath?: string } }
	| { ok: false; message: string } {
	return parseReadOnlyArgs(argv, "review");
}

export function parseHealthArgs(
	argv: readonly string[],
):
	| { ok: true; options: { plain: boolean; targetPath?: string } }
	| { ok: false; message: string } {
	return parseReadOnlyArgs(argv, "health");
}

/**
 * Parse public `reports` argv without reading the inbox.
 *
 * @param argv - Reports command arguments with or without the leading subcommand
 * @returns Parsed list filters or a usage error message
 */
// Covered by Branch Station process tests; parser branches are command contract.
// fallow-ignore-next-line complexity
export function parseReportsArgs(
	argv: readonly string[],
): ParseHumanCommandArgsResult<SkillFeedbackReportsOptions> {
	const args = argsWithoutSubcommand(argv, "reports");
	const state: SkillFeedbackReportsOptions = {
		json: false,
		limit: 10,
		lane: "primary",
		source: "all",
	};
	// Covered by Branch Station process tests; callback keeps flag table local.
	// fallow-ignore-next-line complexity
	return parseHumanCommandFlags(args, state, "reports", 0, (flag, index) => {
		const common = parseFilteredListFlag(flag, args, index, state);
		if (common) return common;
		switch (flag) {
			case "--lane": {
				const parsed = parseStringFlagValue(args, index, "--lane");
				if (!parsed.ok) return parsed;
				if (!isReportLaneFilter(parsed.value)) {
					return { ok: false, message: "--lane is invalid." };
				}
				state.lane = parsed.value;
				return { ok: true, nextIndex: parsed.nextIndex };
			}
			case "--source": {
				const parsed = parseStringFlagValue(args, index, "--source");
				if (!parsed.ok) return parsed;
				if (!isReportSourceFilter(parsed.value)) {
					return { ok: false, message: "--source is invalid." };
				}
				state.source = parsed.value;
				return { ok: true, nextIndex: parsed.nextIndex };
			}
			default:
				return undefined;
		}
	});
}

/**
 * Parse public `report` argv without resolving the report ref.
 *
 * @param argv - Report command arguments with or without the leading subcommand
 * @returns Parsed detail options or a usage error message
 */
// Covered by Branch Station process tests; parser branches are command contract.
// fallow-ignore-next-line complexity
export function parseReportArgs(
	argv: readonly string[],
): ParseHumanCommandArgsResult<SkillFeedbackReportDetailOptions> {
	const args = argsWithoutSubcommand(argv, "report");
	const ref = args[0];
	if (!ref || ref.startsWith("--")) {
		return { ok: false, message: "Report requires one report:<id> ref." };
	}
	const state: SkillFeedbackReportDetailOptions = {
		json: false,
		ref,
		lowSignal: false,
	};
	// Covered by Branch Station process tests; callback keeps flag table local.
	// fallow-ignore-next-line complexity
	return parseHumanCommandFlags(args, state, "report", 1, (flag, index) => {
		switch (flag) {
			case "--json":
				return parseJsonFlag(state, index);
			case "--low-signal":
				state.lowSignal = true;
				return { ok: true, nextIndex: index };
			case "--repo":
				return parseTargetPathFlag(args, index, state);
			default:
				return undefined;
		}
	});
}

/**
 * Parse public `usage` argv without reading the inbox.
 *
 * @param argv - Usage command arguments with or without the leading subcommand
 * @returns Parsed usage filters or a usage error message
 */
// Covered by Branch Station process tests; parser branches are command contract.
// fallow-ignore-next-line complexity
export function parseUsageArgs(
	argv: readonly string[],
): ParseHumanCommandArgsResult<SkillFeedbackUsageOptions> {
	const args = argsWithoutSubcommand(argv, "usage");
	const state: SkillFeedbackUsageOptions = { json: false, limit: 10 };
	// Covered by Branch Station process tests; callback keeps flag table local.
	// fallow-ignore-next-line complexity
	return parseHumanCommandFlags(args, state, "usage", 0, (flag, index) => {
		return parseFilteredListFlag(flag, args, index, state);
	});
}

/**
 * Parse public `queue` argv without reading the inbox.
 *
 * @param argv - Queue command arguments with or without the leading subcommand
 * @returns Parsed queue filters or a usage error message
 */
// Covered by Branch Station process tests; parser branches are command contract.
// fallow-ignore-next-line complexity
export function parseQueueArgs(
	argv: readonly string[],
): ParseHumanCommandArgsResult<SkillFeedbackQueueOptions> {
	const args = argsWithoutSubcommand(argv, "queue");
	const state: SkillFeedbackQueueOptions = {
		json: false,
		limit: 10,
		includeWeak: false,
	};
	// Covered by Branch Station process tests; callback keeps flag table local.
	// fallow-ignore-next-line complexity
	return parseHumanCommandFlags(args, state, "queue", 0, (flag, index) => {
		const common = parseFilteredListFlag(flag, args, index, state);
		if (common) return common;
		switch (flag) {
			case "--include-weak":
				state.includeWeak = true;
				return { ok: true, nextIndex: index };
			case "--owner-path": {
				const parsed = parseStringFlagValue(args, index, "--owner-path");
				if (!parsed.ok) return parsed;
				state.ownerPath = parsed.value;
				return { ok: true, nextIndex: parsed.nextIndex };
			}
			default:
				return undefined;
		}
	});
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export function parseCorrelateArgs(
	argv: readonly string[],
):
	| { ok: true; options: { plain: boolean; targetPath?: string; execute: boolean } }
	| { ok: false; message: string } {
	const args = argv[0] === "correlate" ? argv.slice(1) : argv;
	const state: { plain: boolean; targetPath?: string; execute: boolean } = {
		plain: false,
		execute: false,
	};
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index];
		if (!flag?.startsWith("--")) {
			return { ok: false, message: "Expected a correlate flag." };
		}
		switch (flag) {
			case "--plain":
				state.plain = true;
				break;
			case "--execute":
				state.execute = true;
				break;
			case "--repo": {
				const parsed = parseRepoFlagValue(args, index);
				if (!parsed.ok) return parsed;
				state.targetPath = parsed.value;
				index = parsed.nextIndex;
				break;
			}
			default:
				return { ok: false, message: `Unknown flag ${flag}.` };
		}
	}
	return { ok: true, options: state };
}

function parseReadOnlyArgs(
	argv: readonly string[],
	commandName: "review" | "health",
):
	| { ok: true; options: { plain: boolean; targetPath?: string } }
	| { ok: false; message: string } {
	const args = readOnlyArgsWithoutSubcommand(argv, commandName);
	const state: ReadOnlyArgsState = { plain: false };
	for (let index = 0; index < args.length; index += 1) {
		const parsed = parseReadOnlyFlag(args, index, commandName);
		if (!parsed.ok) return { ok: false, message: parsed.message };
		parsed.apply(state);
		index = parsed.nextIndex;
	}
	return { ok: true, options: state };
}

function readOnlyArgsWithoutSubcommand(
	argv: readonly string[],
	commandName: "review" | "health",
): readonly string[] {
	if (argv[0] === commandName) return argv.slice(1);
	return argv;
}

function argsWithoutSubcommand(
	argv: readonly string[],
	commandName: "reports" | "report" | "usage" | "queue",
): readonly string[] {
	if (argv[0] === commandName) return argv.slice(1);
	return argv;
}

// Covered by Branch Station process tests; shared parser loop preserves errors.
// fallow-ignore-next-line complexity
function parseHumanCommandFlags<TOptions>(
	args: readonly string[],
	state: TOptions,
	commandName: HumanCommandName,
	startIndex: number,
	parseFlag: (
		flag: string,
		index: number,
	) => ParsedHumanCommandFlag | undefined,
): ParseHumanCommandArgsResult<TOptions> {
	for (let index = startIndex; index < args.length; index += 1) {
		const flag = args[index];
		if (!flag?.startsWith("--")) {
			return { ok: false, message: `Expected a ${commandName} flag.` };
		}
		const parsed = parseFlag(flag, index);
		if (!parsed) return { ok: false, message: `Unknown flag ${flag}.` };
		if (!parsed.ok) return parsed;
		index = parsed.nextIndex;
	}
	return { ok: true, options: state };
}

// Covered by Branch Station process tests; shared flags are parser contract.
// fallow-ignore-next-line complexity
function parseFilteredListFlag<
	TOptions extends {
		json: boolean;
		targetPath?: string;
		limit: number;
		skill?: string;
	},
>(
	flag: string,
	args: readonly string[],
	index: number,
	state: TOptions,
): ParsedHumanCommandFlag | undefined {
	switch (flag) {
		case "--json":
			return parseJsonFlag(state, index);
		case "--repo":
			return parseTargetPathFlag(args, index, state);
		case "--limit":
			return parseLimitOptionFlag(args, index, state);
		case "--skill":
			return parseSkillOptionFlag(args, index, state);
		default:
			return undefined;
	}
}

function parseJsonFlag<TOptions extends { json: boolean }>(
	state: TOptions,
	index: number,
): ParsedHumanCommandFlag {
	state.json = true;
	return { ok: true, nextIndex: index };
}

function parseTargetPathFlag<TOptions extends { targetPath?: string }>(
	args: readonly string[],
	index: number,
	state: TOptions,
): ParsedHumanCommandFlag {
	const parsed = parseRepoFlagValue(args, index);
	if (!parsed.ok) return parsed;
	state.targetPath = parsed.value;
	return { ok: true, nextIndex: parsed.nextIndex };
}

function parseLimitOptionFlag<TOptions extends { limit: number }>(
	args: readonly string[],
	index: number,
	state: TOptions,
): ParsedHumanCommandFlag {
	const parsed = parseLimitFlagValue(args, index, "--limit");
	if (!parsed.ok) return parsed;
	state.limit = parsed.value;
	return { ok: true, nextIndex: parsed.nextIndex };
}

function parseSkillOptionFlag<TOptions extends { skill?: string }>(
	args: readonly string[],
	index: number,
	state: TOptions,
): ParsedHumanCommandFlag {
	const parsed = parseStringFlagValue(args, index, "--skill");
	if (!parsed.ok) return parsed;
	state.skill = parsed.value;
	return { ok: true, nextIndex: parsed.nextIndex };
}

function parseStringFlagValue(
	args: readonly string[],
	index: number,
	flag: string,
):
	| { ok: true; value: string; nextIndex: number }
	| { ok: false; message: string } {
	const value = args[index + 1];
	if (value === undefined || value.startsWith("--") || value.trim() === "") {
		return { ok: false, message: `${flag} requires a value.` };
	}
	return { ok: true, value, nextIndex: index + 1 };
}

// Covered by Branch Station process tests; limit validation is command contract.
// fallow-ignore-next-line complexity
function parseLimitFlagValue(
	args: readonly string[],
	index: number,
	flag: string,
):
	| { ok: true; value: number; nextIndex: number }
	| { ok: false; message: string } {
	const parsed = parseStringFlagValue(args, index, flag);
	if (!parsed.ok) return parsed;
	const value = Number(parsed.value);
	if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
		return { ok: false, message: `${flag} must be an integer from 1 to 100.` };
	}
	return { ok: true, value, nextIndex: parsed.nextIndex };
}

function isReportLaneFilter(value: string): value is SkillFeedbackReportLaneFilter {
	return value === "primary" || value === "low-signal" || value === "all";
}

function isReportSourceFilter(
	value: string,
): value is SkillFeedbackReportSourceFilter {
	return value === "hook_capture" || value === "driver_closeout" || value === "all";
}

function parseReadOnlyFlag(
	args: readonly string[],
	index: number,
	commandName: "review" | "health",
): ParsedReadOnlyFlag {
	const flag = args[index];
	if (!flag?.startsWith("--")) {
		return { ok: false, message: `Expected a ${commandName} flag.` };
	}
	if (flag === "--plain") return parsedPlainFlag(index);
	if (flag === "--repo") return parseReadOnlyRepoFlag(args, index);
	return { ok: false, message: `Unknown flag ${flag}.` };
}

function parseReadOnlyRepoFlag(
	args: readonly string[],
	index: number,
): ParsedReadOnlyFlag {
	const parsed = parseRepoFlagValue(args, index);
	if (!parsed.ok) return parsed;
	return {
		ok: true,
		nextIndex: parsed.nextIndex,
		apply: (state) => {
			state.targetPath = parsed.value;
		},
	};
}

function parseRepoFlagValue(
	args: readonly string[],
	index: number,
):
	| { ok: true; value: string; nextIndex: number }
	| { ok: false; message: string } {
	return parseStringFlagValue(args, index, "--repo");
}

function parsedPlainFlag(index: number): ParsedReadOnlyFlag {
	return {
		ok: true,
		nextIndex: index,
		apply: (state) => {
			state.plain = true;
		},
	};
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export function parsePurgeArgs(
	argv: readonly string[],
):
	| { ok: true; options: SkillFeedbackPurgeOptions }
	| { ok: false; message: string } {
	const args = argv[0] === "purge" ? argv.slice(1) : argv;
	let lane: SkillFeedbackPurgeLane = "all";
	let execute = false;
	let olderThan: string | undefined;
	let keepLatest: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index];
		if (!flag?.startsWith("--")) {
			return { ok: false, message: "Expected a purge flag." };
		}
		switch (flag) {
			case "--execute":
				execute = true;
				break;
			case "--lane": {
				const value = args[index + 1];
				if (value === undefined || value.startsWith("--")) {
					return { ok: false, message: "--lane requires a value." };
				}
				if (!isPurgeLane(value)) {
					return { ok: false, message: "--lane is invalid." };
				}
				lane = value;
				index += 1;
				break;
			}
			case "--older-than": {
				const value = args[index + 1];
				if (value === undefined || value.startsWith("--")) {
					return { ok: false, message: "--older-than requires a value." };
				}
				olderThan = value;
				index += 1;
				break;
			}
			case "--keep-latest": {
				const value = args[index + 1];
				if (value === undefined || value.startsWith("--")) {
					return { ok: false, message: "--keep-latest requires a value." };
				}
				keepLatest = value;
				index += 1;
				break;
			}
			default:
				return { ok: false, message: `Unknown flag ${flag}.` };
		}
	}
	if ((olderThan ? 1 : 0) + (keepLatest ? 1 : 0) !== 1) {
		return {
			ok: false,
			message: "Purge requires exactly one retention selector.",
		};
	}
	if (olderThan) {
		const durationMs = parsePurgeDurationMs(olderThan);
		if (durationMs === undefined) {
			return {
				ok: false,
				message: "--older-than must use a positive duration such as 14d or 48h.",
			};
		}
		return {
			ok: true,
			options: {
				lane,
				execute,
				retention: { kind: "older_than", raw: olderThan, durationMs },
			},
		};
	}
	const count = Number(keepLatest);
	if (!Number.isSafeInteger(count) || count < 1) {
		return {
			ok: false,
			message: "--keep-latest must be a positive integer.",
		};
	}
	return {
		ok: true,
		options: {
			lane,
			execute,
			retention: { kind: "keep_latest", count },
		},
	};
}

function isPurgeLane(value: string): value is SkillFeedbackPurgeLane {
	return SKILL_FEEDBACK_PURGE_LANES.includes(value as SkillFeedbackPurgeLane);
}

function parsePurgeDurationMs(raw: string): number | undefined {
	const match = /^([1-9][0-9]*)([dh])$/.exec(raw);
	if (!match) return undefined;
	const value = Number(match[1]);
	if (!Number.isSafeInteger(value)) return undefined;
	const unitMs = match[2] === "d" ? 86_400_000 : 3_600_000;
	return value * unitMs;
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export function parseRecordFlags(
	argv: readonly string[],
):
	| { ok: true; receipt: Partial<Receipt> }
	| { ok: false; message: string } {
	const args = argv[0] === "record" ? argv.slice(1) : argv;
	const receipt: Partial<Receipt> = {};
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith("--")) {
			return { ok: false, message: "Expected a record flag." };
		}
		if (value === undefined || value.startsWith("--")) {
			return { ok: false, message: `${flag} requires a value.` };
		}
		index += 1;
		switch (flag) {
			case "--skill":
				receipt.skill = value;
				break;
			case "--goal":
				receipt.goal = value;
				break;
			case "--outcome":
				if (
					SKILL_FEEDBACK_OUTCOMES.includes(value as SkillFeedbackOutcome)
				) {
					receipt.outcome = value as SkillFeedbackOutcome;
					break;
				}
				return { ok: false, message: "--outcome is invalid." };
			case "--friction":
				receipt.friction = value;
				break;
			case "--explanation":
				receipt.explanation = value;
				break;
			case "--generated-ts":
				receipt.generated_ts = value;
				break;
			default:
				return { ok: false, message: `Unknown flag ${flag}.` };
		}
	}
	return { ok: true, receipt };
}

if (import.meta.main) {
	const exitCode = await runSkillFeedbackCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
