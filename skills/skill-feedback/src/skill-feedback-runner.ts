#!/usr/bin/env bun

import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
	chmod,
	link,
	lstat,
	mkdir,
	open,
	readFile,
	readdir,
	realpath,
	unlink,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
	type CliRuntimeSuccessEnvelope,
	type AgentHint,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	renderCommandUsage,
} from "@side-quest/cli-command-facade";
import {
	SKILL_FEEDBACK_CONTRACT_ID,
	SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
	SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
	SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
	SKILL_FEEDBACK_PURGE_CONTRACT_ID,
	SKILL_FEEDBACK_PURGE_LANES,
	SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_OUTCOMES,
	SKILL_FEEDBACK_SCHEMA_VERSION,
	type CaptureMetadata,
	type CloseoutReceipt,
	type CloseoutResultData,
	type CorrelationStatus,
	type EvidenceGap,
	type EvidenceGapCode,
	type FrictionCategory,
	type HealthClaimReadiness,
	type HealthInboxStatus,
	type HealthNextAction,
	type HealthResultData,
	type HealthWarning,
	type HealthWarningReasonId,
	type NormalizedSoftwareLearningReport,
	type Receipt,
	type ReportCardObservation,
	type ReportCardSoftwareLearningReport,
	type ReviewClaimReadiness,
	type ReviewClaimReadinessFact,
	type ReviewOpenItem,
	type ReviewReadTarget,
	type ReportCardTarget,
	type ReviewResultData,
	type ReviewResultDataV1,
	type SkillFeedbackPurgeResultData,
	type SkillFeedbackPurgeLane,
	type SkillFeedbackOutcome,
	type SoftwareLearningReport,
	SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION,
	buildSoftwareLearningReport,
	isCaptureRuntime,
	isSkillIdentityProvenance,
	normalizeReport,
	parseCloseoutReceipt,
	parseReceipt,
	skillFeedbackContracts,
} from "./command-contract";
import {
	redactReportCardSoftwareLearningReport,
	redactSoftwareLearningReport,
} from "./redaction";
import { reduceReviewLedger, trustedSkillRunId } from "./review-ledger-reducer";
import {
	evidenceGap,
	stableReportId,
	uniqueEvidenceGaps,
} from "./report-helpers";

const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const INBOX_DIR = ".skill-feedback";
const LOW_SIGNAL_INBOX_DIR = "low-signal";
const LOW_SIGNAL_UNKNOWN_SKILL_REASON_ID = "unknown_skill_codex_stop";
const LOW_SIGNAL_LANE_REPORT_REASON_ID = "low_signal_lane_report";
const PILOT_MARKER_FILE = "pilot_started_at";
const MAX_CLOSEOUT_STDIN_BYTES = 64_000;
const DEFAULT_RUNNER_PROCESS_TIMEOUT_MS = 6_000;
const HEALTH_LOW_SIGNAL_WARNING_THRESHOLD = 10;
const RETENTION_AGE_WARNING_DAYS = 14;
const RETENTION_COUNT_WARNING_THRESHOLD = 100;
const CLOSEOUT_RECEIPT_DOCS_URL =
	"https://github.com/nathanvale/claude-code-config/blob/main/skills/skill-feedback/references/closeout-receipt.md";
const NON_ACTIONABLE_EVIDENCE_GAP_CODES: ReadonlySet<EvidenceGapCode> = new Set([
	"cost_unavailable",
	"unlinked_correlation",
	"missing_runtime_model",
]);
const REVIEW_OPEN_REASON_RANK: Record<ReviewOpenItem["open_reason"], number> = {
	owner_path_observation: 0,
	high_verification_burden: 1,
	repeated_friction: 2,
	evidence_gap: 3,
	unlinked_correlation_spike: 4,
};
const REVIEW_OPEN_SEVERITY_RANK: Record<ReviewOpenItem["severity"], number> = {
	action: 0,
	warning: 1,
	info: 2,
};
const SKILL_FEEDBACK_HELP_COMMANDS = [
	"record",
	"closeout",
	"review",
	"health",
	"purge",
] as const satisfies readonly (keyof typeof skillFeedbackContracts)[];

type HealthNextActionInput = {
	status: HealthInboxStatus;
	counts: HealthResultData["counts"];
	retentionWarning?: string;
};

type HealthNextActionRule = {
	matches: (input: HealthNextActionInput) => boolean;
	action: HealthNextAction;
};

type HealthInboxStatusRule = {
	matches: (inbox: ReviewInboxRead) => boolean;
	status: HealthInboxStatus;
};

const HEALTH_INBOX_STATUS_RULES: readonly HealthInboxStatusRule[] = [
	{ matches: hasUnsafeInboxRoot, status: "unsafe" },
	{ matches: hasMissingInboxRoot, status: "missing" },
	{ matches: hasPartialReadability, status: "partially_readable" },
	{ matches: hasNoReadableReports, status: "empty" },
];

const HEALTH_STATUS_WARNINGS: Record<
	HealthInboxStatus,
	readonly HealthWarning[]
> = {
	missing: [
		healthWarning(
			"inbox_missing",
			"No .skill-feedback/ inbox exists in the selected repository.",
		),
	],
	empty: [healthWarning("inbox_empty", "The inbox exists but has no reports.")],
	unsafe: [
		healthWarning(
			"unsafe_inbox",
			"The inbox root is not a safe private directory.",
		),
	],
	partially_readable: [
		healthWarning(
			"partial_readability",
			"Some inbox artifacts were invalid or skipped as unsafe.",
		),
	],
	populated: [],
};

const HEALTH_DEFAULT_NEXT_ACTION: HealthNextAction = {
	action_id: "run-review",
	summary: "Run review for claim-safe ledger detail.",
};

const HEALTH_NEXT_ACTION_RULES: readonly HealthNextActionRule[] = [
	{
		matches: needsInboxRepair,
		action: {
			action_id: "repair-inbox-state",
			summary: "Repair unsafe or invalid inbox artifacts before drawing conclusions.",
		},
	},
	{
		matches: needsCapturePathConfirmation,
		action: {
			action_id: "confirm-capture-path",
			summary: "Confirm .skill-feedback/ is ignored before capture creates reports.",
		},
	},
	{
		matches: needsCorrelationInspection,
		action: {
			action_id: "inspect-report-correlation",
			summary:
				"Interpret primary reports as report-level evidence until correlation exists.",
		},
	},
	{
		matches: needsCaptureIdentityInspection,
		action: {
			action_id: "inspect-capture-identity",
			summary: "Inspect runtime capture and skill identity before promotion.",
		},
	},
	{
		matches: needsPurgePreview,
		action: {
			action_id: "preview-purge",
			summary: "Preview explicit purge; health does not delete reports.",
		},
	},
];
type SkillFeedbackErrorHint =
	| string
	| {
			summary: string;
			action?: AgentHint["action"];
			docs_url?: string;
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
	| typeof SKILL_FEEDBACK_HEALTH_CONTRACT_ID
	| typeof SKILL_FEEDBACK_PURGE_CONTRACT_ID;

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

/**
 * Repository target selected for read commands, or repair-state context.
 */
export type ReadTargetResolution =
	| {
			ok: true;
			explicit: boolean;
			seedPath: string;
			repoRoot: string;
			inboxPath: string;
	  }
	| {
			ok: false;
			explicit: boolean;
			seedPath: string;
			code: "read_target_resolution_failed";
			message: string;
			hint: string;
			gitExitCode?: number;
	  };

/**
 * Engine-read telemetry merged into the receipt from stdin (KTD2a).
 *
 * `model` is NEVER a CLI flag — it arrives only here, lifted from the harness
 * transcript by the Stop hook and piped to the runner over stdin. Reading it as
 * a trusted side input (parallel to {@link SkillFeedbackRuntime.readGitSha}) is
 * what keeps "telemetry trusted, narration redacted" a real invariant: there is
 * no flag an agent could use to author it and dodge the redactor.
 *
 * `usage` is intentionally NOT carried here in v0 — the transcript holds no
 * skill-scoped token total (the skill runs inline after the Stop hook's view),
 * so usage stays an explicit record gap until v1 sources it from OTel.
 */
export type StdinTelemetry = {
	model?: string;
} & CaptureMetadata;

export type SkillFeedbackRuntime = {
	repoRoot: () => string;
	resolveReadTarget: (targetPath?: string) => Promise<ReadTargetResolution>;
	readGitSha: () => Promise<string>;
	readSkillVersion: (skill: string) => Promise<string>;
	readStdinTelemetry: () => Promise<StdinTelemetry>;
	readStdinText: () => Promise<string>;
	checkIgnored: (repoRoot: string, relativePath: string) => Promise<number>;
	mkdirPrivate: (path: string, mode: number) => Promise<void>;
	writePrivateFile: (path: string, content: string, mode: number) => Promise<void>;
	removeFile: (path: string) => Promise<void>;
	lstatPath: (path: string) => Promise<Stats>;
	realpathPath: (path: string) => Promise<string>;
	readText: (path: string) => Promise<string>;
	nowIso: () => string;
};

type SkillFeedbackRuntimeOverrides = Partial<SkillFeedbackRuntime> & {
	runGit?: SkillFeedbackGitRunner;
};

export function createDefaultSkillFeedbackRuntime(
	overrides: SkillFeedbackRuntimeOverrides = {},
): SkillFeedbackRuntime {
	const runGit = overrides.runGit ?? defaultGitRunner;
	return {
		repoRoot: () => process.cwd(),
		resolveReadTarget:
			overrides.resolveReadTarget ??
			((targetPath) =>
				resolveSkillFeedbackReadTarget({
					targetPath,
					cwd: process.cwd(),
					runGit,
				})),
		readGitSha: async () => {
			const result = await runProcess(["git", "rev-parse", "HEAD"], process.cwd());
			return result.exitCode === 0 ? result.stdout.trim() : "";
		},
		readSkillVersion: async (skill) => skillVersionFromPackage(skill),
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

export async function recordSkillFeedbackReceipt(
	rawReceipt: unknown,
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
	} = {},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-record";
	const repoRoot = resolve(runtime.repoRoot());

	const prepared = await prepareReceipt(rawReceipt, runtime);
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

	const report = buildSoftwareLearningReport(parsed, prepared.captureMetadata);
	const redacted = redactSoftwareLearningReport(report).value;
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
	const lane = isLowSignalCodexStopReport(redacted) ? "low-signal" : "primary";
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
	const reportPath = join(inboxPath, reportFileName(redacted));
	try {
		await runtime.writePrivateFile(
			reportPath,
			`${JSON.stringify(redacted, null, "\t")}\n`,
			0o600,
		);
	} catch {
		const rollback = await rollbackReportPath(reportPath, runtime);
		return errorResult(
			runId,
			RUNTIME_FAILURE_EXIT_CODE,
			"record_write_failed",
			"Skill-feedback record could not be written.",
			{
				recoverability: "repair_state",
				hint: "Inspect inbox ownership and permissions before retrying.",
				changedState: rollback === "failed" ? "partial" : "none",
			},
		);
	}

	const envelope = createCliRuntimeSuccessEnvelope({
		run_id: runId,
		data: redacted,
	}) satisfies CliRuntimeSuccessEnvelope<SoftwareLearningReport>;
	return {
		exitCode: 0,
		stdout: `${JSON.stringify(envelope)}\n`,
		stderr: "",
		reportPath,
	};
}

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
		const correlationStatus: CorrelationStatus = receipt.skill_run_id
			? "linked"
			: "unlinked";
		const evidenceGaps = closeoutEvidenceGaps(
			parsed.evidence_gaps,
			runtimeTelemetry,
			correlationStatus,
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
		const fileName = reportFileName(redacted.value);
		const reportPath = join(inboxPath, fileName);
		try {
			await runtime.writePrivateFile(
				reportPath,
				`${JSON.stringify(redacted.value, null, "\t")}\n`,
				0o600,
			);
		} catch {
			const rollback = await rollbackReportPath(reportPath, runtime);
			return errorResult(
				runId,
				RUNTIME_FAILURE_EXIT_CODE,
				"closeout_write_failed",
				"Closeout report could not be written.",
				{
					recoverability: "repair_state",
					hint: "Inspect inbox ownership and permissions before retrying.",
					contract: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
					changedState: rollback === "failed" ? "partial" : "none",
				},
			);
		}
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
			report_id: redacted.value.report_id,
			...(redacted.value.skill_run_id
				? { skill_run_id: redacted.value.skill_run_id }
				: {}),
			correlation_status: redacted.value.correlation_status,
			evidence_gaps: redacted.value.evidence_gaps,
			redactions: redacted.redactions,
			written_path: `${INBOX_DIR}/${fileName}`,
			closeout_coverage_contribution: "material_closeout",
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
				data: {
					read_target: {
						explicit: readTarget.explicit,
						target_path: readTarget.seedPath,
						...(readTarget.gitExitCode === undefined
							? {}
							: { git_exit_code: readTarget.gitExitCode }),
					},
				},
			},
		);
	}
	const repoRoot = readTarget.repoRoot;
	try {
		const inbox = await readReviewInbox(repoRoot, runtime);
		const pilotStartedAt = await readPilotStartedAt(repoRoot, runtime);
		const data = buildReviewResultData({
			inbox,
			nowIso: runtime.nowIso(),
			pilotStartedAt,
			readTarget,
		});
		if (options.plain) {
			return {
				exitCode: 0,
				stdout: renderPlainReview(data),
				stderr: "",
			};
		}
		const actionId =
			data.open_items.length > 0
				? "inspect-open-items"
				: "review-complete";
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
	} catch {
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
}

export async function healthSkillFeedbackInbox(
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
		plain?: boolean;
		targetPath?: string;
	} = {},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-health";
	const readTarget = await runtime.resolveReadTarget(options.targetPath);
	if (!readTarget.ok) {
		return healthReadTargetError(runId, readTarget);
	}
	return readHealthProcessResult(runId, readTarget, runtime, options.plain === true);
}

async function readHealthProcessResult(
	runId: string,
	readTarget: Extract<ReadTargetResolution, { ok: true }>,
	runtime: SkillFeedbackRuntime,
	plain: boolean,
): Promise<SkillFeedbackProcessResult> {
	try {
		const inbox = await readReviewInbox(readTarget.repoRoot, runtime);
		return healthProcessResult(
			runId,
			buildHealthResultData({
				inbox,
				nowIso: runtime.nowIso(),
			}),
			plain,
		);
	} catch {
		return healthFailedError(runId);
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
			data: {
				read_target: {
					explicit: readTarget.explicit,
					target_path: readTarget.seedPath,
					...(readTarget.gitExitCode === undefined
						? {}
						: { git_exit_code: readTarget.gitExitCode }),
				},
			},
		},
	);
}

function healthProcessResult(
	runId: string,
	data: HealthResultData,
	plain: boolean,
): SkillFeedbackProcessResult {
	if (plain) return healthPlainResult(data);
	if (data.inbox_status === "unsafe") return healthUnsafeResult(runId, data);
	return healthSuccessResult(runId, data);
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

function healthFailedError(runId: string): SkillFeedbackProcessResult {
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

type SkillFeedbackPurgeCandidate = {
	path: string;
	relativePath: string;
	lane: Exclude<SkillFeedbackPurgeLane, "all">;
	generatedTs: string;
	generatedMs: number;
};

type SkillFeedbackPurgeScan = {
	candidates: SkillFeedbackPurgeCandidate[];
	skippedUnsafePaths: string[];
	invalidPaths: string[];
};

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
	const scan = await scanPurgeCandidates(repoRoot, runtime);
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

type ReviewInboxRead = {
	primaryReports: NormalizedSoftwareLearningReport[];
	lowSignalReports: LowSignalReport[];
	inboxRootStatus: InboxRootStatus;
	skippedUnsafeCount: number;
	invalidCount: number;
};

type InboxRootStatus = "missing" | "readable" | "unsafe";

type InboxArtifactLane = "primary" | "low-signal";

type LowSignalReasonId =
	| typeof LOW_SIGNAL_UNKNOWN_SKILL_REASON_ID
	| typeof LOW_SIGNAL_LANE_REPORT_REASON_ID;

type LowSignalReport = {
	report: NormalizedSoftwareLearningReport;
	reasonId: LowSignalReasonId;
};

type SafeInboxJsonFile = {
	path: string;
	relativePath: string;
	lane: InboxArtifactLane;
};

type InboxJsonFileScan = {
	rootStatus: InboxRootStatus;
	files: SafeInboxJsonFile[];
	skippedUnsafeCount: number;
	skippedUnsafePaths: string[];
	invalidPaths: string[];
};

function emptyReviewInboxRead(): ReviewInboxRead {
	return {
		primaryReports: [],
		lowSignalReports: [],
		inboxRootStatus: "missing",
		skippedUnsafeCount: 0,
		invalidCount: 0,
	};
}

async function readReviewInbox(
	repoRoot: string,
	runtime: SkillFeedbackRuntime,
): Promise<ReviewInboxRead> {
	const scan = await scanSafeInboxJsonFiles(repoRoot, runtime);
	const state: ReviewInboxRead = {
		...emptyReviewInboxRead(),
		inboxRootStatus: scan.rootStatus,
		skippedUnsafeCount: scan.skippedUnsafeCount,
		invalidCount: scan.invalidPaths.length,
	};
	for (const file of scan.files) {
		let raw: unknown;
		try {
			raw = JSON.parse(await runtime.readText(file.path)) as unknown;
		} catch {
			state.invalidCount += 1;
			continue;
		}
		const normalized = normalizeReport(raw);
		if (normalized.kind !== "ok") {
			state.invalidCount += 1;
			continue;
		}
		const lowSignalReasonId = lowSignalReasonIdFor(file, normalized.report);
		if (lowSignalReasonId) {
			state.lowSignalReports.push({
				report: normalized.report,
				reasonId: lowSignalReasonId,
			});
		} else {
			state.primaryReports.push(normalized.report);
		}
	}
	return state;
}

function lowSignalReasonIdFor(
	file: SafeInboxJsonFile,
	report: NormalizedSoftwareLearningReport,
): LowSignalReasonId | undefined {
	if (isLowSignalCodexStopReport(report)) return LOW_SIGNAL_UNKNOWN_SKILL_REASON_ID;
	if (file.lane === "low-signal") return LOW_SIGNAL_LANE_REPORT_REASON_ID;
	return undefined;
}

async function scanSafeInboxJsonFiles(
	repoRoot: string,
	runtime: SkillFeedbackRuntime,
): Promise<InboxJsonFileScan> {
	const inboxPath = join(repoRoot, INBOX_DIR);
	const state: InboxJsonFileScan = {
		rootStatus: "missing",
		files: [],
		skippedUnsafeCount: 0,
		skippedUnsafePaths: [],
		invalidPaths: [],
	};
	const inboxStats = await lstatOptional(inboxPath, runtime);
	if (!inboxStats) return state;
	if (inboxStats.isSymbolicLink() || !inboxStats.isDirectory()) {
		state.rootStatus = "unsafe";
		state.skippedUnsafeCount += 1;
		state.skippedUnsafePaths.push(relative(repoRoot, inboxPath));
		return state;
	}
	const repoReal = await runtime.realpathPath(repoRoot);
	const inboxReal = await runtime.realpathPath(inboxPath);
	if (!isContainedPath(repoReal, inboxReal)) {
		state.rootStatus = "unsafe";
		state.skippedUnsafeCount += 1;
		state.skippedUnsafePaths.push(relative(repoRoot, inboxPath));
		return state;
	}
	state.rootStatus = "readable";
	await scanSafeJsonDirectory({
		directoryPath: inboxPath,
		inboxReal,
		repoRoot,
		lane: "primary",
		state,
		runtime,
	});
	await scanLowSignalInboxDirectory({
		inboxPath,
		inboxReal,
		repoRoot,
		state,
		runtime,
	});
	return state;
}

async function scanLowSignalInboxDirectory(input: {
	inboxPath: string;
	inboxReal: string;
	repoRoot: string;
	state: InboxJsonFileScan;
	runtime: SkillFeedbackRuntime;
}): Promise<void> {
	const lowSignalPath = join(input.inboxPath, LOW_SIGNAL_INBOX_DIR);
	const stats = await lstatOptional(lowSignalPath, input.runtime);
	if (!stats) return;
	if (stats.isSymbolicLink() || !stats.isDirectory()) {
		input.state.skippedUnsafeCount += 1;
		input.state.skippedUnsafePaths.push(relative(input.repoRoot, lowSignalPath));
		return;
	}
	const lowSignalReal = await input.runtime.realpathPath(lowSignalPath);
	if (!isContainedPath(input.inboxReal, lowSignalReal)) {
		input.state.skippedUnsafeCount += 1;
		input.state.skippedUnsafePaths.push(relative(input.repoRoot, lowSignalPath));
		return;
	}
	await scanSafeJsonDirectory({
		directoryPath: lowSignalPath,
		inboxReal: input.inboxReal,
		repoRoot: input.repoRoot,
		lane: "low-signal",
		state: input.state,
		runtime: input.runtime,
	});
}

async function scanSafeJsonDirectory(input: {
	directoryPath: string;
	inboxReal: string;
	repoRoot: string;
	lane: InboxArtifactLane;
	state: InboxJsonFileScan;
	runtime: SkillFeedbackRuntime;
}): Promise<void> {
	let entries: string[];
	try {
		entries = await readdir(input.directoryPath);
	} catch (error) {
		if (isNodeErrorCode(error, "ENOENT")) return;
		throw error;
	}
	for (const entry of entries.sort()) {
		const reportPath = join(input.directoryPath, entry);
		if (!entry.endsWith(".json")) {
			if (isPartialInboxTempEntry(entry)) {
				input.state.invalidPaths.push(relative(input.repoRoot, reportPath));
			}
			continue;
		}
		const stats = await lstatOptional(reportPath, input.runtime);
		if (!stats) continue;
		if (stats.isSymbolicLink() || !stats.isFile()) {
			input.state.skippedUnsafeCount += 1;
			input.state.skippedUnsafePaths.push(relative(input.repoRoot, reportPath));
			continue;
		}
		const reportReal = await input.runtime.realpathPath(reportPath);
		if (!isContainedPath(input.inboxReal, reportReal)) {
			input.state.skippedUnsafeCount += 1;
			input.state.skippedUnsafePaths.push(relative(input.repoRoot, reportPath));
			continue;
		}
		input.state.files.push({
			path: reportPath,
			relativePath: relative(input.repoRoot, reportPath),
			lane: input.lane,
		});
	}
}

async function scanPurgeCandidates(
	repoRoot: string,
	runtime: SkillFeedbackRuntime,
): Promise<SkillFeedbackPurgeScan> {
	const scan = await scanSafeInboxJsonFiles(repoRoot, runtime);
	const candidates: SkillFeedbackPurgeCandidate[] = [];
	const invalidPaths: string[] = [...scan.invalidPaths];
	for (const file of scan.files) {
		let raw: unknown;
		try {
			raw = JSON.parse(await runtime.readText(file.path)) as unknown;
		} catch {
			invalidPaths.push(file.relativePath);
			continue;
		}
		const normalized = normalizeReport(raw);
		if (normalized.kind !== "ok") {
			invalidPaths.push(file.relativePath);
			continue;
		}
		const generatedMs = Date.parse(normalized.report.generated_ts);
		if (!Number.isFinite(generatedMs)) {
			invalidPaths.push(file.relativePath);
			continue;
		}
		candidates.push({
			path: file.path,
			relativePath: file.relativePath,
			lane:
				file.lane === "low-signal" ||
				isLowSignalCodexStopReport(normalized.report)
					? "low-signal"
					: "primary",
			generatedTs: normalized.report.generated_ts,
			generatedMs,
		});
	}
	return {
		candidates,
		skippedUnsafePaths: scan.skippedUnsafePaths,
		invalidPaths,
	};
}

function isPartialInboxTempEntry(entry: string): boolean {
	return entry.includes(".json.tmp-") || entry.endsWith(".json.tmp");
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

async function safeRealpath(
	path: string,
	runtime: SkillFeedbackRuntime,
): Promise<string | undefined> {
	try {
		return await runtime.realpathPath(path);
	} catch {
		return undefined;
	}
}

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

function buildReviewResultData(input: {
	inbox: ReviewInboxRead;
	nowIso: string;
	pilotStartedAt?: string;
	readTarget: Extract<ReadTargetResolution, { ok: true }>;
}): ReviewResultData {
	const reports = input.inbox.primaryReports;
	const lowSignalReports = input.inbox.lowSignalReports;
	const reviewUnits = coalesceReviewUnits(reports);
	const closeoutUnits = reviewUnits.filter(hasCloseoutEvidence);
	const captureOnlyUnits = reviewUnits.filter(
		(unit) => hasCaptureEvidence(unit) && !hasCloseoutEvidence(unit),
	);
	const signalContext = reviewSignalContext(reports);
	const openItems = deriveReviewOpenItems(reports, signalContext);
	const closeoutRate =
		reviewUnits.length === 0
			? 0
			: roundRatio(closeoutUnits.length / reviewUnits.length);
	const coverage = {
		total_reports: reports.length,
		closeout_count: closeoutUnits.length,
		capture_only_count: captureOnlyUnits.length,
		unlinked_count: reports.filter(
			(report) => report.correlation_status === "unlinked",
		).length,
		evidence_gap_count: reports.reduce(
			(sum, report) => sum + report.evidence_gaps.length,
			0,
		),
		closeout_rate: closeoutRate,
		low_coverage: reports.length > 0 && closeoutRate < 0.5,
		...(reports.length > 0 && closeoutRate < 0.5
			? {
					low_coverage_warning:
						"Closeout coverage is low; suppress target-skill quality conclusions.",
				}
			: {}),
	};
	const ledger = reduceReviewLedger(reports);
	const claimReadiness = deriveClaimReadiness([
		...reports,
		...lowSignalReports.map((entry) => entry.report),
	]);
	const inboxStatus = healthInboxStatus(input.inbox);
	const correlation = healthCorrelation(reports);
	const counts = healthCounts(input.inbox, correlation);
	const retention = retentionSummary(reports, input.nowIso);
	const warnings = deriveHealthWarnings({
		status: inboxStatus,
		counts,
		retentionWarning: retention.warning,
	});
	const nextAction = deriveHealthNextAction({
		status: inboxStatus,
		counts,
		retentionWarning: retention.warning,
	});
	const pilotCheckpoint = pilotCheckpointSummary({
		startedAt: input.pilotStartedAt,
		nowIso: input.nowIso,
		closeoutCount: closeoutUnits.length,
		actionableCloseoutCount: closeoutUnits.filter((unit) =>
			unit.reports.some((report) => reportHasReviewOpenSignal(report, signalContext)),
		).length,
		noAction: openItems.length === 0,
	});
	const readTarget = reviewReadTargetData(input.readTarget, inboxStatus);
	return {
		contract: SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
		schema_version: SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION,
		coverage,
		inbox_health: deriveInboxHealth(
			reports,
			lowSignalReports,
			input.inbox.skippedUnsafeCount,
			input.inbox.invalidCount,
		),
		inbox_status: inboxStatus,
		counts,
		warnings,
		next_action: nextAction,
		...(readTarget ? { read_target: readTarget } : {}),
		open_items: openItems,
		open_actions: deriveOpenActions(openItems),
		...(openItems.length === 0
			? {
					no_action: {
						rationale:
							reports.length === 0
								? "No skill-feedback reports found."
								: "No high-signal open items found in this review window.",
					},
				}
			: {}),
		retention,
		...(pilotCheckpoint ? { pilot_checkpoint: pilotCheckpoint } : {}),
		review_units: ledger.review_units,
		ledger_entries: ledger.ledger_entries,
		anchor_miss_telemetry: ledger.anchor_miss_telemetry,
		claim_readiness: claimReadiness,
	};
}

function reviewReadTargetData(
	resolution: Extract<ReadTargetResolution, { ok: true }>,
	inboxStatus: HealthInboxStatus,
): ReviewReadTarget | undefined {
	if (!resolution.explicit && inboxStatus === "populated") return undefined;
	return {
		explicit: resolution.explicit,
		repo_root: resolution.repoRoot,
		inbox_path: resolution.inboxPath,
		target_path: resolution.seedPath,
	};
}

function buildHealthResultData(input: {
	inbox: ReviewInboxRead;
	nowIso: string;
}): HealthResultData {
	const primaryReports = input.inbox.primaryReports;
	const lowSignalReports = input.inbox.lowSignalReports;
	const inboxStatus = healthInboxStatus(input.inbox);
	const correlation = healthCorrelation(primaryReports);
	const counts = healthCounts(input.inbox, correlation);
	const retention = retentionSummary(primaryReports, input.nowIso);
	const warnings = deriveHealthWarnings({
		status: inboxStatus,
		counts,
		retentionWarning: retention.warning,
	});
	const nextAction = deriveHealthNextAction({
		status: inboxStatus,
		counts,
		retentionWarning: retention.warning,
	});
	const claimReadiness = toHealthClaimReadiness(
		deriveClaimReadiness([
			...primaryReports,
			...lowSignalReports.map((entry) => entry.report),
		]),
	);
	return {
		contract: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
		schema_version: SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
		inbox_status: inboxStatus,
		counts,
		newest: {
			...newestGeneratedTs(primaryReports, "primary_generated_ts"),
			...newestGeneratedTs(
				lowSignalReports.map((entry) => entry.report),
				"low_signal_generated_ts",
			),
		},
		warnings,
		claim_readiness: claimReadiness,
		correlation,
		next_action: nextAction,
	};
}

function healthInboxStatus(inbox: ReviewInboxRead): HealthInboxStatus {
	return (
		HEALTH_INBOX_STATUS_RULES.find((rule) => rule.matches(inbox))?.status ??
		"populated"
	);
}

function healthCounts(
	inbox: ReviewInboxRead,
	correlation: HealthResultData["correlation"],
): HealthResultData["counts"] {
	return {
		primary: inbox.primaryReports.length,
		low_signal: inbox.lowSignalReports.length,
		invalid: inbox.invalidCount,
		skipped_unsafe: inbox.skippedUnsafeCount,
		unlinked_primary: correlation.unlinked_primary_count,
	};
}

function newestGeneratedTs<Key extends keyof HealthResultData["newest"]>(
	reports: readonly NormalizedSoftwareLearningReport[],
	key: Key,
): Partial<Pick<HealthResultData["newest"], Key>> {
	const values = reports
		.map((report) => report.generated_ts)
		.filter((value) => Number.isFinite(Date.parse(value)))
		.sort();
	if (values.length === 0) return {};
	return { [key]: values[values.length - 1] } as Partial<
		Pick<HealthResultData["newest"], Key>
	>;
}

function deriveHealthWarnings(input: {
	status: HealthInboxStatus;
	counts: HealthResultData["counts"];
	retentionWarning?: string;
}): HealthWarning[] {
	const warnings = [...HEALTH_STATUS_WARNINGS[input.status]];
	if (input.counts.unlinked_primary > 0) {
		warnings.push(
			healthWarning(
				"unlinked_primary_reports",
				"Primary reports lack trusted skill-run correlation.",
			),
		);
	}
	if (input.counts.low_signal >= HEALTH_LOW_SIGNAL_WARNING_THRESHOLD) {
		warnings.push(
			healthWarning(
				"low_signal_threshold",
				"Low-signal runtime capture volume needs identity inspection.",
			),
		);
	}
	if (input.retentionWarning) {
		warnings.push(
			healthWarning(
				"retention_preview_recommended",
				"Primary report volume or age is ready for explicit purge preview.",
			),
		);
	}
	return warnings;
}

function deriveHealthNextAction(input: {
	status: HealthInboxStatus;
	counts: HealthResultData["counts"];
	retentionWarning?: string;
}): HealthNextAction {
	return (
		HEALTH_NEXT_ACTION_RULES.find((rule) => rule.matches(input))?.action ??
		HEALTH_DEFAULT_NEXT_ACTION
	);
}

function healthWarning(
	reasonId: HealthWarningReasonId,
	summary: string,
): HealthWarning {
	return { reason_id: reasonId, summary };
}

function hasUnsafeInboxRoot(inbox: ReviewInboxRead): boolean {
	return inbox.inboxRootStatus === "unsafe";
}

function hasMissingInboxRoot(inbox: ReviewInboxRead): boolean {
	return inbox.inboxRootStatus === "missing";
}

function hasPartialReadability(inbox: ReviewInboxRead): boolean {
	return inbox.skippedUnsafeCount > 0 || inbox.invalidCount > 0;
}

function hasNoReadableReports(inbox: ReviewInboxRead): boolean {
	return inbox.primaryReports.length === 0 && inbox.lowSignalReports.length === 0;
}

function needsInboxRepair(input: HealthNextActionInput): boolean {
	return input.status === "unsafe" || input.status === "partially_readable";
}

function needsCapturePathConfirmation(input: HealthNextActionInput): boolean {
	return input.status === "missing" || input.status === "empty";
}

function needsCorrelationInspection(input: HealthNextActionInput): boolean {
	return (
		input.counts.primary > 0 &&
		input.counts.unlinked_primary === input.counts.primary
	);
}

function needsCaptureIdentityInspection(input: HealthNextActionInput): boolean {
	return input.counts.low_signal >= HEALTH_LOW_SIGNAL_WARNING_THRESHOLD;
}

function needsPurgePreview(input: HealthNextActionInput): boolean {
	return input.retentionWarning !== undefined;
}

function toHealthClaimReadiness(
	readiness: ReviewClaimReadiness,
): HealthClaimReadiness {
	return {
		runtime_capture: healthReadinessFact(readiness.runtime_capture),
		trusted_skill_identity: healthReadinessFact(
			readiness.trusted_skill_identity,
		),
		daily_pilot: healthReadinessFact(readiness.daily_pilot),
	};
}

function healthReadinessFact(fact: ReviewClaimReadinessFact) {
	return {
		status: fact.status,
		reason_ids: fact.reason_ids,
	};
}

function healthCorrelation(
	reports: readonly NormalizedSoftwareLearningReport[],
): HealthResultData["correlation"] {
	const unlinked = reports.filter(
		(report) => report.correlation_status === "unlinked",
	).length;
	const linked = reports.length - unlinked;
	return {
		status:
			reports.length === 0
				? "none"
				: unlinked === 0
					? "linked"
				: linked === 0
					? "all_unlinked"
					: "partially_linked",
		linked_primary_count: linked,
		unlinked_primary_count: unlinked,
	};
}

/**
 * Project v1 open items into v2 open actions. Open actions carry a stable key,
 * the open reason, optional target, next safe action, and evidence pointers so
 * future agents act on the same facts the reducer exposed (R1).
 */
function deriveOpenActions(
	openItems: readonly ReviewOpenItem[],
): ReviewResultData["open_actions"] {
	return [...openItems]
		.map((item) => ({
			item,
			action: {
				action_key: reviewActionKey(item),
				open_reason: item.open_reason,
				...(item.target ? { target: item.target } : {}),
				next_safe_action: item.next_action,
				evidence_refs: item.evidence_refs,
			},
		}))
		.sort((left, right) => compareReviewOpenItems(left.item, right.item))
		.map(({ action }) => action);
}

function compareReviewOpenItems(
	left: ReviewOpenItem,
	right: ReviewOpenItem,
): number {
	const leftRank = reviewOpenItemRank(left);
	const rightRank = reviewOpenItemRank(right);
	const rank = leftRank.reduce(
		(result, value, index) => result || value - (rightRank[index] ?? 0),
		0,
	);
	if (rank !== 0) return rank;
	return reviewActionKey(left).localeCompare(reviewActionKey(right));
}

function reviewOpenItemRank(item: ReviewOpenItem): readonly number[] {
	return [
		REVIEW_OPEN_SEVERITY_RANK[item.severity],
		REVIEW_OPEN_REASON_RANK[item.open_reason],
		-item.evidence_refs.length,
		reviewOpenItemOwnerRank(item),
		reviewOpenItemNextActionRank(item),
	];
}

function reviewOpenItemOwnerRank(item: ReviewOpenItem): number {
	if (item.target?.type === "path") return 0;
	if (item.target) return 1;
	return 2;
}

function reviewOpenItemNextActionRank(item: ReviewOpenItem): number {
	return item.next_action.trim() === "" ? 1 : 0;
}

function reviewActionKey(item: ReviewOpenItem): string {
	const target = item.target ? `${item.target.type}:${item.target.value}` : "";
	const seed = JSON.stringify({
		open_reason: item.open_reason,
		evidence_refs: [...item.evidence_refs].sort(),
		target,
	});
	return `action:${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function reportEvidenceRef(report: NormalizedSoftwareLearningReport): string {
	return `report:${report.report_id}`;
}

function deriveInboxHealth(
	primaryReports: readonly NormalizedSoftwareLearningReport[],
	lowSignalReports: readonly LowSignalReport[],
	skippedUnsafeCount: number,
	invalidCount: number,
): ReviewResultData["inbox_health"] {
	const lowSignalAges = lowSignalReports
		.map((entry) => entry.report.generated_ts)
		.filter((value) => Number.isFinite(Date.parse(value)))
		.sort();
	const lowSignalReasonIds = [
		...new Set(lowSignalReports.map((entry) => entry.reasonId)),
	].sort();
	return {
		primary_count: primaryReports.length,
		low_signal_count: lowSignalReports.length,
		...(lowSignalAges.length > 0
			? {
					low_signal_newest_generated_ts:
						lowSignalAges[lowSignalAges.length - 1],
				}
			: {}),
		low_signal_reason_ids: lowSignalReasonIds,
		skipped_unsafe_count: skippedUnsafeCount,
		invalid_count: invalidCount,
	};
}

/**
 * Derive split readiness facts (R20, R21, KTD7). Runtime capture, Trusted skill
 * identity, and Daily pilot are tracked as separate claims, not one global
 * gate: runtime capture can become ready while Daily pilot stays blocked on its
 * dependencies. Each fact carries a status, reason ids, and evidence pointers.
 */
function deriveClaimReadiness(
	reports: readonly NormalizedSoftwareLearningReport[],
): ReviewClaimReadiness {
	const codexStopReports = reports.filter(
		(report) =>
			report.evidence_source === "hook_capture" &&
			report.capture_runtime === "codex_stop",
	);
	const trustedCodexStop = codexStopReports.filter(isTrustedCodexStopReport);
	const legacyNotify = reports.filter(
		(report) =>
			report.evidence_source === "hook_capture" &&
			report.capture_runtime === "codex_notify",
	);

	const runtimeCapture: ReviewClaimReadinessFact = (() => {
		const reasonIds: string[] = [];
		if (codexStopReports.length === 0) {
			reasonIds.push("no_codex_stop_runtime_evidence");
		}
		if (legacyNotify.length > 0) {
			reasonIds.push("legacy_notify_evidence_not_ready");
		}
		// Runtime capture stays evidence-only: hook-approval state is not yet
		// machine-observable, so it cannot reach `ready` (R21 dependency).
		if (codexStopReports.length > 0) {
			reasonIds.push("hook_approval_state_not_machine_observable");
		}
		const status =
			codexStopReports.length > 0 && legacyNotify.length === 0
				? "evidence_only"
				: "blocked";
		return {
			status,
			reason_ids: reasonIds,
			evidence_refs: codexStopReports.map((report) => report.report_id),
		};
	})();

	const trustedSkillIdentity: ReviewClaimReadinessFact = {
		// No engine-owned identity source exists yet (R17, R18); identity is
		// blocked regardless of how much runtime evidence accumulates.
		status: "blocked",
		reason_ids: ["missing_engine_owned_identity"],
		evidence_refs: trustedCodexStop.map((report) => report.report_id),
	};

	const dailyPilot: ReviewClaimReadinessFact = {
		// Daily pilot needs the accepted pilot gate, machine-observable approval,
		// and Trusted skill identity evidence (R21, KTD7) — none are present.
		status: "blocked",
		reason_ids: [
			"pilot_gate_not_accepted",
			"daily_pilot_needs_machine_observable_approval",
			"trusted_skill_identity_missing",
		],
		evidence_refs: [],
	};

	return {
		runtime_capture: runtimeCapture,
		trusted_skill_identity: trustedSkillIdentity,
		daily_pilot: dailyPilot,
	};
}

type ReviewUnit = {
	key: string;
	trustedRun: boolean;
	trustedSkillRunId?: string;
	reports: NormalizedSoftwareLearningReport[];
};

type ReviewSignalContext = {
	repeatedFrictionCategories: ReadonlySet<FrictionCategory>;
	unlinkedSpike: boolean;
};

type OwnerPathObservation = ReportCardObservation & {
	target: { type: "path"; value: string };
};

type ReviewOpenReasonEvidence =
	| { open_reason: "high_verification_burden" }
	| { open_reason: "evidence_gap"; gaps: readonly EvidenceGap[] }
	| {
			open_reason: "owner_path_observation";
			observation: OwnerPathObservation;
	  }
	| { open_reason: "repeated_friction"; category: FrictionCategory }
	| { open_reason: "unlinked_correlation_spike" };

function coalesceReviewUnits(
	reports: readonly NormalizedSoftwareLearningReport[],
): ReviewUnit[] {
	const units: ReviewUnit[] = [];
	const linkedUnits = new Map<string, ReviewUnit>();
	for (const report of reports) {
		const trustedRunId = trustedSkillRunId(report);
		if (!trustedRunId) {
			units.push({
				key: `report:${report.report_id}`,
				trustedRun: false,
				reports: [report],
			});
			continue;
		}
		let unit = linkedUnits.get(trustedRunId);
		if (!unit) {
			unit = {
				key: `run:${trustedRunId}`,
				trustedRun: true,
				trustedSkillRunId: trustedRunId,
				reports: [],
			};
			linkedUnits.set(trustedRunId, unit);
			units.push(unit);
		}
		unit.reports.push(report);
	}
	return units;
}

function hasCloseoutEvidence(unit: ReviewUnit): boolean {
	return unit.reports.some((report) => report.evidence_source === "driver_closeout");
}

function hasCaptureEvidence(unit: ReviewUnit): boolean {
	return unit.reports.some((report) => report.evidence_source === "hook_capture");
}

function isTrustedCodexStopReport(
	report: NormalizedSoftwareLearningReport,
): boolean {
	return (
		report.evidence_source === "hook_capture" &&
		report.capture_runtime === "codex_stop" &&
		report.skill_identity_provenance?.trusted === true &&
		report.skill_identity_provenance.source === "codex_stop_payload" &&
		isNonPlaceholderSkill(report.skill) &&
		isNonPlaceholderRuntimeValue(report.runtime.model) &&
		isNonPlaceholderRuntimeValue(report.runtime.skill_version)
	);
}

function isLowSignalCodexStopReport(report: {
	evidence_source?: string;
	capture_runtime?: string;
	skill?: string;
}): boolean {
	if (report.evidence_source && report.evidence_source !== "hook_capture") {
		return false;
	}
	return (
		report.capture_runtime === "codex_stop" &&
		!isNonPlaceholderSkill(report.skill ?? "")
	);
}

function isNonPlaceholderSkill(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return normalized !== "" && normalized !== "unknown" && normalized !== "unknown-skill";
}

function isNonPlaceholderRuntimeValue(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized !== "" && normalized !== "unknown";
}

function reviewSignalContext(
	reports: readonly NormalizedSoftwareLearningReport[],
): ReviewSignalContext {
	return {
		repeatedFrictionCategories: new Set(
			repeatedFriction(reports).map(([category]) => category),
		),
		unlinkedSpike:
			reports.filter((report) => report.correlation_status === "unlinked")
				.length >= 2,
	};
}

function deriveReviewOpenItems(
	reports: readonly NormalizedSoftwareLearningReport[],
	signalContext: ReviewSignalContext,
): ReviewOpenItem[] {
	const items: ReviewOpenItem[] = [];
	const repeatedFrictionCategories = new Set<FrictionCategory>();
	let hasUnlinkedSpikeReason = false;
	for (const report of reports) {
		for (const reason of reviewOpenReasons(report, signalContext)) {
			switch (reason.open_reason) {
				case "high_verification_burden":
					items.push({
						open_reason: "high_verification_burden",
						severity: "action",
						evidence: `${report.skill} reported heavy verification burden.`,
						evidence_refs: [reportEvidenceRef(report)],
						next_action:
							"Inspect the verification burden note against source and tests.",
					});
					break;
				case "evidence_gap":
					items.push({
						open_reason: "evidence_gap",
						severity: "warning",
						evidence: `${report.skill} has ${reason.gaps.length} actionable evidence gap(s).`,
						evidence_refs: [reportEvidenceRef(report)],
						next_action:
							"Inspect missing evidence before drawing skill-quality conclusions.",
					});
					break;
				case "owner_path_observation":
					items.push({
						open_reason: "owner_path_observation",
						severity: "action",
						evidence: reason.observation.summary,
						evidence_refs: [reportEvidenceRef(report)],
						target: reason.observation.target,
						next_action:
							"Inspect the owner path and confirm evidence before editing.",
					});
					break;
				case "repeated_friction":
					repeatedFrictionCategories.add(reason.category);
					break;
				case "unlinked_correlation_spike":
					hasUnlinkedSpikeReason = true;
					break;
			}
		}
	}
	for (const category of repeatedFrictionCategories) {
		const refs = reports
			.filter((report) => report.friction?.category === category)
			.map(reportEvidenceRef)
			.sort();
		items.push({
			open_reason: "repeated_friction",
			severity: "warning",
			evidence: `${refs.length} reports mention ${category} friction.`,
			evidence_refs: refs,
			next_action: "Group reports by friction category and inspect the common owner.",
		});
	}
	if (hasUnlinkedSpikeReason) {
		const refs = reports
			.filter((report) => report.correlation_status === "unlinked")
			.map(reportEvidenceRef)
			.sort();
		items.push({
			open_reason: "unlinked_correlation_spike",
			severity: "warning",
			evidence: `${refs.length} reports are unlinked.`,
			evidence_refs: refs,
			next_action: "Inspect skill-feedback or runtime adapter correlation.",
		});
	}
	return items;
}

function reportHasReviewOpenSignal(
	report: NormalizedSoftwareLearningReport,
	signalContext: ReviewSignalContext,
): boolean {
	return reviewOpenReasons(report, signalContext).length > 0;
}

function reviewOpenReasons(
	report: NormalizedSoftwareLearningReport,
	signalContext: ReviewSignalContext,
): ReviewOpenReasonEvidence[] {
	const reasons: ReviewOpenReasonEvidence[] = [];
	if (report.verification_burden?.level === "heavy") {
		reasons.push({ open_reason: "high_verification_burden" });
	}
	const gaps = actionableEvidenceGaps(report);
	if (gaps.length > 0) {
		reasons.push({ open_reason: "evidence_gap", gaps });
	}
	for (const observation of ownerPathObservations(report)) {
		reasons.push({ open_reason: "owner_path_observation", observation });
	}
	const category = report.friction?.category;
	if (category && signalContext.repeatedFrictionCategories.has(category)) {
		reasons.push({ open_reason: "repeated_friction", category });
	}
	if (signalContext.unlinkedSpike && report.correlation_status === "unlinked") {
		reasons.push({ open_reason: "unlinked_correlation_spike" });
	}
	return reasons;
}

function actionableEvidenceGaps(
	report: NormalizedSoftwareLearningReport,
): EvidenceGap[] {
	return report.evidence_gaps.filter(isActionableEvidenceGap);
}

function ownerPathObservations(
	report: NormalizedSoftwareLearningReport,
): OwnerPathObservation[] {
	return report.observations.filter(
		(observation): observation is OwnerPathObservation =>
			observation.target?.type === "path",
	);
}

function isActionableEvidenceGap(gap: EvidenceGap): boolean {
	return !NON_ACTIONABLE_EVIDENCE_GAP_CODES.has(gap.code);
}

function repeatedFriction(
	reports: readonly NormalizedSoftwareLearningReport[],
): Array<[FrictionCategory, number]> {
	const counts = new Map<FrictionCategory, number>();
	for (const report of reports) {
		const category = report.friction?.category;
		if (!category || category === "none") continue;
		counts.set(category, (counts.get(category) ?? 0) + 1);
	}
	return [...counts.entries()].filter(([, count]) => count >= 2);
}

function retentionSummary(
	reports: readonly NormalizedSoftwareLearningReport[],
	nowIso: string,
): ReviewResultDataV1["retention"] {
	const ages = reports
		.map((report) => daysBetween(report.generated_ts, nowIso))
		.filter((age): age is number => age !== undefined);
	const oldest = ages.length > 0 ? Math.max(...ages) : undefined;
	const warning =
		(oldest !== undefined && oldest >= RETENTION_AGE_WARNING_DAYS) ||
		reports.length >= RETENTION_COUNT_WARNING_THRESHOLD
			? "Inbox is ready for a future gated purge workflow."
			: undefined;
	return {
		report_count: reports.length,
		...(oldest !== undefined ? { oldest_report_age_days: oldest } : {}),
		...(warning
			? {
					warning,
					future_purge_action: "Run a future explicit purge workflow; review does not delete.",
				}
			: {}),
	};
}

function pilotCheckpointSummary(input: {
	startedAt?: string;
	nowIso: string;
	closeoutCount: number;
	actionableCloseoutCount: number;
	noAction: boolean;
}): ReviewResultDataV1["pilot_checkpoint"] | undefined {
	if (!input.startedAt) return undefined;
	const ageDays = daysBetween(input.startedAt, input.nowIso);
	if (ageDays === undefined || ageDays < 7) return undefined;
	const denominator = input.closeoutCount;
	const numerator =
		denominator === 0
			? 0
			: input.noAction
				? denominator
				: input.actionableCloseoutCount;
	return {
		started_at: input.startedAt,
		age_days: ageDays,
		actionable_feedback_numerator: numerator,
		material_closeout_denominator: denominator,
		density: denominator === 0 ? 0 : roundRatio(numerator / denominator),
		next_action:
			"Review pilot density and run the future purge workflow when it exists.",
	};
}

/**
 * Render v2 review as plain text. v1 triage (coverage, low-signal, no-action,
 * open items) comes before ledger detail (R2). Claim labels come only from
 * reducer-owned `allowed_claims`; the renderer never re-derives corroboration,
 * trust, or readiness (R22, KTD5). Untrusted strings are sanitized so labels
 * cannot spoof sections (R23, AE8).
 */
function renderPlainReview(data: ReviewResultData): string {
	const lines = ["Skill Feedback Review"];
	appendPlainReviewHealthBlock(lines, data);
	appendPlainReviewCoverage(lines, data);
	appendPlainReviewTriage(lines, data);
	appendPlainReadiness(lines, data.claim_readiness);
	appendPlainReviewLedger(lines, data);
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
	if (!hasReviewHealthBlockSignal(data)) return;
	lines.push(...plainReviewHealthBlockLines(data));
}

function hasReviewHealthBlockSignal(
	data: Pick<
		ReviewResultData,
		"inbox_status" | "counts" | "warnings" | "read_target"
	>,
): boolean {
	return (
		data.inbox_status !== "populated" ||
		data.counts.low_signal > 0 ||
		data.warnings.length > 0 ||
		data.read_target !== undefined
	);
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
	data: Pick<ReviewResultData, "open_items" | "no_action">,
): void {
	if (data.open_items.length === 0) {
		appendPlainNoAction(lines, data.no_action);
		return;
	}
	appendPlainOpenItems(lines, data.open_items);
}

function appendPlainNoAction(
	lines: string[],
	noAction: ReviewResultData["no_action"],
): void {
	lines.push(`No action: ${plainSafe(noActionRationale(noAction))}`);
}

function noActionRationale(noAction: ReviewResultData["no_action"]): string {
	if (noAction) return noAction.rationale;
	return "No open items.";
}

function appendPlainOpenItems(
	lines: string[],
	openItems: ReviewResultData["open_items"],
): void {
	lines.push("Open items:");
	for (const item of openItems) {
		lines.push(`- ${item.open_reason}: ${plainSafe(item.evidence)}`);
	}
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
	for (const entry of entries) {
		lines.push(plainLedgerEntry(entry));
	}
}

function plainLedgerEntry(entry: ReviewResultData["ledger_entries"][number]): string {
	const claims = plainClaims(entry.allowed_claims);
	const runtimes = plainRuntimeMix(entry.capture_runtime_mix);
	const targets = plainAttemptedTargets(entry.attempted_targets);
	const anchor = plainLedgerAnchor(entry);
	return `- ${plainSafe(anchor)} tier=${entry.evidence_tier} sources=${entry.source_mix.join("/")}${runtimes}${claims}${targets}`;
}

function plainClaims(claims: ReviewResultData["ledger_entries"][number]["allowed_claims"]): string {
	if (claims.length === 0) return "";
	return ` claims=${claims.join(",")}`;
}

function plainRuntimeMix(
	runtimes: ReviewResultData["ledger_entries"][number]["capture_runtime_mix"],
): string {
	if (runtimes.length === 0) return "";
	return ` runtimes=${runtimes.join("/")}`;
}

function plainAttemptedTargets(
	targets: ReviewResultData["ledger_entries"][number]["attempted_targets"],
): string {
	if (targets.length === 0) return "";
	return ` targets=${targets.map(plainTarget).join(",")}`;
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
	for (const [label, fact] of [
		["runtime capture", readiness.runtime_capture],
		["trusted skill identity", readiness.trusted_skill_identity],
		["daily pilot", readiness.daily_pilot],
	] as const) {
		const reasons =
			fact.reason_ids.length > 0 ? ` (${fact.reason_ids.join(", ")})` : "";
		lines.push(`- ${label}: ${fact.status}${reasons}`);
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

function daysBetween(startIso: string, endIso: string): number | undefined {
	const start = Date.parse(startIso);
	const end = Date.parse(endIso);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
	return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function roundRatio(value: number): number {
	return Math.round(value * 1000) / 1000;
}

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
	const subdirectoryPath = join(parentPath, name);
	const existing = await lstatOptional(subdirectoryPath, runtime);
	if (existing?.isSymbolicLink()) {
		return {
			ok: false,
			code: "skill_feedback_low_signal_symlink_refused",
			hint: "Replace .skill-feedback/low-signal with a private directory.",
		};
	}
	if (existing && !existing.isDirectory()) {
		return {
			ok: false,
			code: "skill_feedback_low_signal_not_directory",
			hint: "Replace .skill-feedback/low-signal with a private directory.",
		};
	}
	if (!existing) {
		await runtime.mkdirPrivate(subdirectoryPath, 0o700);
	}

	const verified = await lstatOptional(subdirectoryPath, runtime);
	if (!verified) {
		return {
			ok: false,
			code: "skill_feedback_low_signal_missing_after_create",
			hint: "Inspect .skill-feedback/low-signal ownership and rerun.",
		};
	}
	if (verified.isSymbolicLink()) {
		return {
			ok: false,
			code: "skill_feedback_low_signal_symlink_refused",
			hint: "Replace .skill-feedback/low-signal with a private directory.",
		};
	}
	if (!verified.isDirectory()) {
		return {
			ok: false,
			code: "skill_feedback_low_signal_not_directory",
			hint: "Replace .skill-feedback/low-signal with a private directory.",
		};
	}

	const parentReal = await runtime.realpathPath(parentPath);
	const subdirectoryReal = await runtime.realpathPath(subdirectoryPath);
	if (!isContainedPath(parentReal, subdirectoryReal)) {
		return {
			ok: false,
			code: "skill_feedback_low_signal_escape_refused",
			hint: "Move .skill-feedback/low-signal inside the inbox and rerun.",
		};
	}
	return { ok: true, path: subdirectoryPath };
}

async function lstatOptional(
	path: string,
	runtime: SkillFeedbackRuntime,
): Promise<Stats | undefined> {
	try {
		return await runtime.lstatPath(path);
	} catch (error) {
		if (isNodeErrorCode(error, "ENOENT")) return undefined;
		throw error;
	}
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

function isContainedPath(parent: string, child: string): boolean {
	const childRelativePath = relative(parent, child);
	return (
		childRelativePath !== "" &&
		!childRelativePath.startsWith("..") &&
		!isAbsolute(childRelativePath)
	);
}

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

function closeoutEvidenceGaps(
	closeoutGaps: readonly EvidenceGap[],
	runtimeTelemetry: ReportCardSoftwareLearningReport["runtime"],
	correlationStatus: CorrelationStatus,
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
	if (correlationStatus === "unlinked") {
		gaps.push(
			evidenceGap(
				"unlinked_correlation",
				"skill_run_id",
				"Closeout did not include an explicit skill run id.",
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
		...(input.receipt.skill_run_id
			? { skill_run_id: input.receipt.skill_run_id }
			: {}),
		runtime: input.runtimeTelemetry,
		report_card: input.receipt,
		evidence_gaps: input.evidenceGaps,
	};
}

async function inspectPilotMarker(
	inboxPath: string,
	runtime: SkillFeedbackRuntime,
): Promise<SkillFeedbackRepairResult<{ state: "missing" | "present" }>> {
	const markerPath = join(inboxPath, PILOT_MARKER_FILE);
	let marker: Stats;
	try {
		marker = await runtime.lstatPath(markerPath);
	} catch (error) {
		if (isNodeErrorCode(error, "ENOENT")) {
			return { ok: true, state: "missing" };
		}
		throw error;
	}
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

function isNodeErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === code
	);
}

async function prepareReceipt(
	rawReceipt: unknown,
	runtime: SkillFeedbackRuntime,
): Promise<
	| { ok: true; fields: Partial<Receipt>; captureMetadata: CaptureMetadata }
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
	// Engine-read telemetry (KTD2a): model arrives only from stdin, never from a
	// flag. It is merged here, alongside git_sha/skill_version, so it lives on
	// the redactor's trusted side without an agent-authorable flag bypass. A
	// receipt can never already carry it (no flag exists), so the stdin value is
	// authoritative. usage is not sourced in v0 — it stays a record gap.
	const telemetry = await runtime.readStdinTelemetry();
	if (telemetry.model) {
		fields.model = telemetry.model;
	}
	const captureMetadata: CaptureMetadata = {
		...(telemetry.capture_runtime
			? { capture_runtime: telemetry.capture_runtime }
			: {}),
		...(telemetry.skill_identity_provenance
			? { skill_identity_provenance: telemetry.skill_identity_provenance }
			: {}),
	};
	return { ok: true, fields, captureMetadata };
}

function errorResult(
	runId: string,
	exitCode: number,
	code: string,
	message: string,
	options: {
		recoverability: "change_input" | "repair_state";
		hint: SkillFeedbackErrorHint;
		contract?: SkillFeedbackResultContractId;
		changedState?: "none" | "partial";
		data?: Record<string, unknown>;
	},
): SkillFeedbackProcessResult {
	const hintAction: AgentHint["action"] =
		options.recoverability === "repair_state" ? "repair_state" : "change_input";
	const hint: AgentHint =
		typeof options.hint === "string"
			? { summary: options.hint, action: hintAction }
			: {
					summary: options.hint.summary,
					action: options.hint.action ?? hintAction,
					...(options.hint.docs_url
						? { docs_url: options.hint.docs_url }
						: {}),
				};
	const envelope = createCliRuntimeErrorEnvelope({
		run_id: runId,
		process_exit_code: exitCode,
		error: {
			run_id: runId,
			code,
			message,
			exit_code: exitCode,
			severity: exitCode === USAGE_EXIT_CODE ? "error" : "fatal",
			recoverability: options.recoverability,
			retryable: false,
			failure_domain: "skill_feedback",
			hint,
		},
		data: {
			...options.data,
			changed_state: options.changedState ?? "none",
			contract: options.contract ?? SKILL_FEEDBACK_CONTRACT_ID,
			schema_version: schemaVersionForContract(options.contract),
		},
	});
	return { exitCode, stdout: `${JSON.stringify(envelope)}\n`, stderr: "" };
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
	const skillName =
		"skill" in report ? report.skill : (report.report_card.skill ?? "");
	const skill = skillName.replace(/[^a-zA-Z0-9._-]/g, "_") || "unknown-skill";
	const hash = createHash("sha256")
		.update(JSON.stringify(report))
		.digest("hex")
		.slice(0, 12);
	return `${ts}-${skill}-${hash}.json`;
}

async function skillVersionFromPackage(skill: string): Promise<string> {
	const packagePath = join(process.cwd(), "skills", skill, "package.json");
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
 * Parse engine-read stdin into validated telemetry.
 *
 * Garbled, empty, or partially-typed input degrades to `{}` (R21) rather than
 * throwing — a missing or malformed telemetry channel must never break the
 * capture turn (KTD6). Only `model` (a non-empty string) is accepted; every
 * other field is ignored, so no transcript prose smuggled onto the channel can
 * reach the record. v0 carries no usage on this channel.
 */
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
	if (isCaptureRuntime(object.capture_runtime)) {
		telemetry.capture_runtime = object.capture_runtime;
	}
	if (isSkillIdentityProvenance(object.skill_identity_provenance)) {
		telemetry.skill_identity_provenance = object.skill_identity_provenance;
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

export async function runSkillFeedbackCli(
	argv: readonly string[],
	options: SkillFeedbackCliOptions = {},
): Promise<number> {
	const command = argv[0];
	if (argv.includes("--help") || argv.includes("-h")) {
		return writeHelp(command);
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
	command: string | undefined,
): SkillFeedbackCliHandler | undefined {
	if (command === undefined || command === "record" || command.startsWith("--")) {
		return runRecordCommandCli;
	}
	return SKILL_FEEDBACK_CLI_HANDLERS[command];
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
		const result = errorResult(
			options.runId ?? "skill-feedback-record",
			USAGE_EXIT_CODE,
			"usage_error",
			receipt.message,
			{
				recoverability: "change_input",
				hint: "Run skill-feedback record --help and retry with valid flags.",
			},
		);
		process.stdout.write(result.stdout);
		return result.exitCode;
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
	closeout: runCloseoutCommandCli,
	review: (argv, options) => runReadCommandCli("review", argv.slice(1), options),
	health: (argv, options) => runReadCommandCli("health", argv.slice(1), options),
	purge: runPurgeCommandCli,
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
		const result = errorResult(
			options.runId ?? `skill-feedback-${command}`,
			USAGE_EXIT_CODE,
			"usage_error",
			parsed.message,
			{
				recoverability: "change_input",
				hint: `Run skill-feedback ${command} --help and retry with valid flags.`,
				contract: readCommandContract(command),
			},
		);
		process.stdout.write(result.stdout);
		return result.exitCode;
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
	return `${SKILL_FEEDBACK_HELP_COMMANDS.map((helpCommand) =>
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
	| { ok: false; code: string; message: string; hint: SkillFeedbackErrorHint }
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
	const value = args[index + 1];
	if (value === undefined || value.startsWith("--")) {
		return { ok: false, message: "--repo requires a value." };
	}
	return {
		ok: true,
		nextIndex: index + 1,
		apply: (state) => {
			state.targetPath = value;
		},
	};
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
