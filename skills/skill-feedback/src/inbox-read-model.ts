import type { Stats } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
	NormalizedSoftwareLearningReport,
	ReviewResultData,
	WriterProofContext,
	WriterProofHealth,
} from "./command-contract";
import { verifyWriterProof } from "./command-contract";
import { duplicateStringSet, rawStringField } from "./raw-object";
import { normalizeReport } from "./report-normalizer";
import {
	isContainedPath,
	isNodeErrorCode,
	isPermissionErrorCode,
	lstatOptional,
} from "./runtime-file-safety";
import type { SkillFeedbackRuntime } from "./runtime-contract";

const INBOX_DIR = ".skill-feedback";
const TRUST_DIR = ".trust";
export const LOW_SIGNAL_INBOX_DIR = "low-signal" as const;
const LOW_SIGNAL_UNKNOWN_SKILL_REASON_ID = "unknown_skill_codex_stop" as const;
const LOW_SIGNAL_LANE_REPORT_REASON_ID = "low_signal_lane_report" as const;

/**
 * Root state for a safe inbox scan.
 */
export type InboxRootStatus = "missing" | "readable" | "unsafe";

/**
 * Logical report lane discovered by the safe scanner.
 */
export type InboxArtifactLane = "primary" | "low-signal";

/**
 * Low-signal reason ids included in review and health projections.
 */
export type LowSignalReasonId =
	| typeof LOW_SIGNAL_UNKNOWN_SKILL_REASON_ID
	| typeof LOW_SIGNAL_LANE_REPORT_REASON_ID;

/**
 * Normalized report plus why it is excluded from primary ledger claims.
 */
export type LowSignalReport = {
	report: NormalizedSoftwareLearningReport;
	reasonId: LowSignalReasonId;
};

/**
 * Safe JSON report path found under a report lane.
 */
export type SafeInboxJsonFile = {
	path: string;
	relativePath: string;
	lane: InboxArtifactLane;
};

/**
 * Raw parsed report plus safe path metadata.
 */
export type RawInboxReport = {
	file: SafeInboxJsonFile;
	raw: unknown;
};

/**
 * Raw read failure kept as evidence rather than thrown away.
 */
export type RawInboxReadFailure = {
	file: SafeInboxJsonFile;
	reason: "permission" | "invalid_json";
};

/**
 * Normalized report plus safe path metadata.
 */
export type NormalizedInboxReport = {
	file: SafeInboxJsonFile;
	report: NormalizedSoftwareLearningReport;
};

/**
 * Normalization failure for a parsed inbox report.
 */
export type NormalizedInboxReadFailure = {
	file: SafeInboxJsonFile;
	reason: "invalid_report";
};

/**
 * Safe inbox scan facts consumed by read and repair commands.
 */
export type InboxJsonFileScan = {
	rootStatus: InboxRootStatus;
	files: SafeInboxJsonFile[];
	skippedUnsafeCount: number;
	skippedUnsafePaths: string[];
	invalidPaths: string[];
};

/**
 * Read-side projection consumed by review and health.
 */
export type ReviewInboxRead = {
	primaryReports: NormalizedSoftwareLearningReport[];
	lowSignalReports: LowSignalReport[];
	inboxRootStatus: InboxRootStatus;
	skippedUnsafeCount: number;
	invalidCount: number;
	proofDiagnostics: string[];
	correlationDiagnostics: string[];
	verifiedCorrelationWitnessCount: number;
	blockedCorrelationWitnessCount: number;
	orphanCorrelationWitnessCount: number;
};

/**
 * Private writer-proof key read result supplied by the runner trust owner.
 */
export type WriterProofKeyRead =
	| { ok: true; key: Uint8Array; diagnostics: string[] }
	| { ok: false; diagnostics: string[] };

/**
 * Purge candidate projected from safe inbox reads.
 */
export type SkillFeedbackPurgeCandidate = {
	path: string;
	relativePath: string;
	lane: InboxArtifactLane;
	generatedTs: string;
	generatedMs: number;
};

/**
 * Read-only purge scan facts. Execute deletion remains runner-owned.
 */
export type SkillFeedbackPurgeScan = {
	candidates: SkillFeedbackPurgeCandidate[];
	skippedUnsafeCount: number;
	skippedUnsafePaths: string[];
	invalidPaths: string[];
};

/**
 * Trust-store key reader provided by the runner.
 */
export type WriterProofKeyReader = (
	repoRoot: string,
	runtime: SkillFeedbackRuntime,
) => Promise<WriterProofKeyRead>;

/**
 * Optional correlation overlay hook supplied by the witness workflow.
 */
export type CorrelationWitnessOverlay = (input: {
	repoRoot: string;
	runtime: SkillFeedbackRuntime;
	proofKey: WriterProofKeyRead;
	reports: readonly NormalizedSoftwareLearningReport[];
	state: ReviewInboxRead;
}) => Promise<readonly NormalizedSoftwareLearningReport[]>;

/**
 * Read the inbox once for review and health consumers.
 *
 * @param input - Repo root, runtime, proof-key reader, and optional witness overlay.
 * @returns Mutation-free inbox read projection.
 *
 * @example
 * ```typescript
 * const inbox = await readReviewInbox({ repoRoot, runtime, readWriterProofKey })
 * ```
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export async function readReviewInbox(input: {
	repoRoot: string;
	runtime: SkillFeedbackRuntime;
	readWriterProofKey: WriterProofKeyReader;
	applyVerifiedCorrelationWitnesses?: CorrelationWitnessOverlay;
}): Promise<ReviewInboxRead> {
	const scan = await scanSafeInboxJsonFiles(input.repoRoot, input.runtime);
	const state: ReviewInboxRead = {
		...emptyReviewInboxRead(),
		inboxRootStatus: scan.rootStatus,
		skippedUnsafeCount: scan.skippedUnsafeCount,
		invalidCount: scan.invalidPaths.length,
	};
	const proofKey =
		scan.rootStatus === "readable"
			? await input.readWriterProofKey(input.repoRoot, input.runtime)
			: ({ ok: false, diagnostics: [] } satisfies WriterProofKeyRead);
	state.proofDiagnostics.push(...proofKey.diagnostics);
	const rawRead = await readRawInboxReports(scan.files, input.runtime);
	for (const failure of rawRead.failures) {
		if (failure.reason === "permission") state.skippedUnsafeCount += 1;
		else state.invalidCount += 1;
	}
	const normalizedRead = normalizeRawInboxReports({
		rawReports: rawRead.reports,
		proofKey,
	});
	state.invalidCount += normalizedRead.failures.length;
	const normalizedReports = normalizedRead.reports;
	const overlaidReports = input.applyVerifiedCorrelationWitnesses
		? await input.applyVerifiedCorrelationWitnesses({
				repoRoot: input.repoRoot,
				runtime: input.runtime,
				proofKey,
				reports: normalizedReports.map((entry) => entry.report),
				state,
			})
		: normalizedReports.map((entry) => entry.report);
	for (let index = 0; index < normalizedReports.length; index += 1) {
		const entry = normalizedReports[index];
		if (!entry) continue;
		const overlaid = overlaidReports[index] ?? entry.report;
		const lowSignalReasonId = lowSignalReasonIdFor(entry.file, overlaid);
		if (lowSignalReasonId) {
			state.lowSignalReports.push({
				report: overlaid,
				reasonId: lowSignalReasonId,
			});
		} else {
			state.primaryReports.push(overlaid);
		}
	}
	return state;
}

/**
 * Scan report JSON files under the primary and low-signal inbox lanes.
 *
 * @param repoRoot - Repository root to contain the inbox.
 * @param runtime - Filesystem runtime abstraction.
 * @returns Safe path facts plus skipped and invalid artifacts.
 *
 * @example
 * ```typescript
 * const scan = await scanSafeInboxJsonFiles(repoRoot, runtime)
 * ```
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export async function scanSafeInboxJsonFiles(
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
		markSkippedUnsafePath(state, repoRoot, inboxPath);
		return state;
	}
	let repoReal: string;
	let inboxReal: string;
	try {
		repoReal = await runtime.realpathPath(repoRoot);
		inboxReal = await runtime.realpathPath(inboxPath);
	} catch (error) {
		if (!isPermissionErrorCode(error)) throw error;
		state.rootStatus = "unsafe";
		markSkippedUnsafePath(state, repoRoot, inboxPath);
		return state;
	}
	if (!isContainedPath(repoReal, inboxReal)) {
		state.rootStatus = "unsafe";
		markSkippedUnsafePath(state, repoRoot, inboxPath);
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

/**
 * Read parsed raw JSON for safe inbox files.
 *
 * @param files - Safe files returned by the scanner.
 * @param runtime - Filesystem runtime abstraction.
 * @returns Parsed reports plus read failures.
 *
 * @example
 * ```typescript
 * const raw = await readRawInboxReports(scan.files, runtime)
 * ```
 */
export async function readRawInboxReports(
	files: readonly SafeInboxJsonFile[],
	runtime: SkillFeedbackRuntime,
): Promise<{ reports: RawInboxReport[]; failures: RawInboxReadFailure[] }> {
	const reports: RawInboxReport[] = [];
	const failures: RawInboxReadFailure[] = [];
	for (const file of files) {
		try {
			reports.push({
				file,
				raw: JSON.parse(await runtime.readText(file.path)) as unknown,
			});
		} catch (error) {
			failures.push({
				file,
				reason: isPermissionErrorCode(error) ? "permission" : "invalid_json",
			});
		}
	}
	return { reports, failures };
}

/**
 * Normalize raw inbox reports with duplicate-proof replay diagnostics.
 *
 * @param input - Raw reports and writer-proof context.
 * @returns Normalized reports plus invalid-report failures.
 *
 * @example
 * ```typescript
 * const normalized = normalizeRawInboxReports({ rawReports, proofKey })
 * ```
 */
export function normalizeRawInboxReports(input: {
	rawReports: readonly RawInboxReport[];
	proofKey: WriterProofKeyRead;
}): {
	reports: NormalizedInboxReport[];
	failures: NormalizedInboxReadFailure[];
} {
	const duplicateReportIds = duplicateReportIdSet(
		input.rawReports.map((entry) => entry.raw),
	);
	const duplicateProofNonces = duplicateWriterProofNonceSet(
		input.rawReports.map((entry) => entry.raw),
	);
	const reports: NormalizedInboxReport[] = [];
	const failures: NormalizedInboxReadFailure[] = [];
	for (const { file, raw } of input.rawReports) {
		const proofContext = proofContextForRawReport({
			raw,
			proofKey: input.proofKey,
			duplicateReportIds,
			duplicateProofNonces,
		});
		const normalized = normalizeReport(raw, proofContext);
		if (normalized.kind === "ok") reports.push({ file, report: normalized.report });
		else failures.push({ file, reason: "invalid_report" });
	}
	return { reports, failures };
}

/**
 * Build a purge candidate projection without deleting files.
 *
 * @param input - Repo root, runtime, and proof-key reader.
 * @returns Current purge candidates and skipped/invalid paths.
 *
 * @example
 * ```typescript
 * const scan = await scanPurgeCandidates({ repoRoot, runtime, readWriterProofKey })
 * ```
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export async function scanPurgeCandidates(input: {
	repoRoot: string;
	runtime: SkillFeedbackRuntime;
	readWriterProofKey: WriterProofKeyReader;
}): Promise<SkillFeedbackPurgeScan> {
	const scan = await scanSafeInboxJsonFiles(input.repoRoot, input.runtime);
	const proofKey =
		scan.rootStatus === "readable"
			? await input.readWriterProofKey(input.repoRoot, input.runtime)
			: ({ ok: false, diagnostics: [] } satisfies WriterProofKeyRead);
	const candidates: SkillFeedbackPurgeCandidate[] = [];
	const invalidPaths: string[] = [...scan.invalidPaths];
	const rawRead = await readRawInboxReports(scan.files, input.runtime);
	invalidPaths.push(...rawRead.failures.map((failure) => failure.file.relativePath));
	const normalizedRead = normalizeRawInboxReports({
		rawReports: rawRead.reports,
		proofKey,
	});
	invalidPaths.push(
		...normalizedRead.failures.map((failure) => failure.file.relativePath),
	);
	for (const { file, report } of normalizedRead.reports) {
		const generatedMs = Date.parse(report.generated_ts);
		if (!Number.isFinite(generatedMs)) {
			invalidPaths.push(file.relativePath);
			continue;
		}
		candidates.push({
			path: file.path,
			relativePath: file.relativePath,
			lane:
				file.lane === "low-signal" || isLowSignalCodexStopReport(report)
					? "low-signal"
					: "primary",
			generatedTs: report.generated_ts,
			generatedMs,
		});
	}
	return {
		candidates,
		skippedUnsafeCount: scan.skippedUnsafeCount,
		skippedUnsafePaths: scan.skippedUnsafePaths,
		invalidPaths,
	};
}

/**
 * Summarize writer-proof state for review and health outputs.
 *
 * @param reports - Normalized reports to summarize.
 * @param extraDiagnostics - Read-level diagnostics outside individual reports.
 * @returns Proof-health contract data.
 *
 * @example
 * ```typescript
 * const proof = writerProofHealth(reports, inbox.proofDiagnostics)
 * ```
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export function writerProofHealth(
	reports: readonly NormalizedSoftwareLearningReport[],
	extraDiagnostics: readonly string[] = [],
): WriterProofHealth {
	const diagnostics = new Set(extraDiagnostics);
	let verifiedCount = 0;
	let replayDiagnosticsCount = 0;
	for (const report of reports) {
		if (report.writer_proof_verified) verifiedCount += 1;
		let hasReplayDiagnostic = false;
		for (const diagnostic of report.proof_diagnostics ?? []) {
			diagnostics.add(diagnostic);
			if (
				diagnostic === "duplicate_report_id" ||
				diagnostic === "duplicate_writer_proof_nonce"
			) {
				hasReplayDiagnostic = true;
			}
		}
		if (hasReplayDiagnostic) replayDiagnosticsCount += 1;
	}
	return {
		verified_count: verifiedCount,
		evidence_only_count: reports.length - verifiedCount,
		replay_diagnostics_count: replayDiagnosticsCount,
		diagnostics: [...diagnostics].sort(),
	};
}

/**
 * Summarize primary, low-signal, skipped, and invalid inbox facts.
 *
 * @param primaryReports - Reports eligible for primary review claims.
 * @param lowSignalReports - Reports excluded from primary claims.
 * @param skippedUnsafeCount - Unsafe artifacts skipped by the safe scanner.
 * @param invalidCount - Invalid JSON, temp, or malformed report count.
 * @returns Review inbox-health projection.
 *
 * @example
 * ```typescript
 * const inboxHealth = deriveInboxHealth(primary, lowSignal, skipped, invalid)
 * ```
 */
export function deriveInboxHealth(
	primaryReports: readonly NormalizedSoftwareLearningReport[],
	lowSignalReports: readonly LowSignalReport[],
	skippedUnsafeCount: number,
	invalidCount: number,
): ReviewResultData["inbox_health"] {
	const lowSignalAges = lowSignalReports
		.map((entry) => entry.report.generated_ts)
		.filter((value) => Number.isFinite(Date.parse(value)))
		.sort();
	const lowSignalReasonIds = uniqueSorted(
		lowSignalReports.map((entry) => entry.reasonId),
	);
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
 * Detect legacy unknown-skill Codex Stop reports that stay low-signal.
 *
 * @param report - Report-like fields needed for classification.
 * @returns True when the report belongs in the low-signal lane.
 *
 * @example
 * ```typescript
 * if (isLowSignalCodexStopReport(report)) routeToLowSignal()
 * ```
 */
// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
export function isLowSignalCodexStopReport(report: {
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

function emptyReviewInboxRead(): ReviewInboxRead {
	return {
		primaryReports: [],
		lowSignalReports: [],
		inboxRootStatus: "missing",
		skippedUnsafeCount: 0,
		invalidCount: 0,
		proofDiagnostics: [],
		correlationDiagnostics: [],
		verifiedCorrelationWitnessCount: 0,
		blockedCorrelationWitnessCount: 0,
		orphanCorrelationWitnessCount: 0,
	};
}

function markSkippedUnsafePath(
	state: InboxJsonFileScan,
	repoRoot: string,
	artifactPath: string,
): void {
	state.skippedUnsafeCount += 1;
	state.skippedUnsafePaths.push(relative(repoRoot, artifactPath));
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function proofContextForRawReport(input: {
	raw: unknown;
	proofKey: WriterProofKeyRead;
	duplicateReportIds: ReadonlySet<string>;
	duplicateProofNonces: ReadonlySet<string>;
}): WriterProofContext {
	const diagnostics: string[] = [];
	const reportId = rawStringField(input.raw, "report_id");
	const nonce = writerProofNonce(input.raw);
	if (input.duplicateReportIds.has(reportId ?? "")) {
		diagnostics.push("duplicate_report_id");
	}
	if (input.duplicateProofNonces.has(nonce ?? "")) {
		diagnostics.push("duplicate_writer_proof_nonce");
	}
	if (!input.proofKey.ok) {
		diagnostics.push(...input.proofKey.diagnostics);
		return { verified: false, diagnostics: uniqueSorted(diagnostics) };
	}
	const verified = verifyWriterProof(input.raw, input.proofKey.key);
	diagnostics.push(...(verified.diagnostics ?? []));
	return {
		verified: verified.verified && diagnostics.length === 0,
		diagnostics: uniqueSorted(diagnostics),
	};
}

function duplicateReportIdSet(reports: readonly unknown[]): ReadonlySet<string> {
	return duplicateStringSet(
		reports.map((report) => rawStringField(report, "report_id")),
	);
}

function duplicateWriterProofNonceSet(
	reports: readonly unknown[],
): ReadonlySet<string> {
	return duplicateStringSet(reports.map(writerProofNonce));
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function writerProofNonce(raw: unknown): string | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const proof = (raw as Record<string, unknown>).writer_proof;
	if (!proof || typeof proof !== "object" || Array.isArray(proof)) return undefined;
	const nonce = (proof as Record<string, unknown>).nonce;
	return typeof nonce === "string" ? nonce : undefined;
}

function lowSignalReasonIdFor(
	file: SafeInboxJsonFile,
	report: NormalizedSoftwareLearningReport,
): LowSignalReasonId | undefined {
	if (isLowSignalCodexStopReport(report)) return LOW_SIGNAL_UNKNOWN_SKILL_REASON_ID;
	if (file.lane === "low-signal") return LOW_SIGNAL_LANE_REPORT_REASON_ID;
	return undefined;
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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
		markSkippedUnsafePath(input.state, input.repoRoot, lowSignalPath);
		return;
	}
	let lowSignalReal: string;
	try {
		lowSignalReal = await input.runtime.realpathPath(lowSignalPath);
	} catch (error) {
		if (!isPermissionErrorCode(error)) throw error;
		markSkippedUnsafePath(input.state, input.repoRoot, lowSignalPath);
		return;
	}
	if (!isContainedPath(input.inboxReal, lowSignalReal)) {
		markSkippedUnsafePath(input.state, input.repoRoot, lowSignalPath);
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

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
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
		if (isPermissionErrorCode(error)) {
			markSkippedUnsafePath(input.state, input.repoRoot, input.directoryPath);
			return;
		}
		throw error;
	}
	for (const entry of entries.sort()) {
		const reportPath = join(input.directoryPath, entry);
		if (entry === TRUST_DIR) continue;
		if (!entry.endsWith(".json")) {
			if (isPartialInboxTempEntry(entry)) {
				input.state.invalidPaths.push(relative(input.repoRoot, reportPath));
			}
			continue;
		}
		let stats: Stats | undefined;
		try {
			stats = await lstatOptional(reportPath, input.runtime);
		} catch (error) {
			if (!isPermissionErrorCode(error)) throw error;
			markSkippedUnsafePath(input.state, input.repoRoot, reportPath);
			continue;
		}
		if (!stats) continue;
		if (stats.isSymbolicLink() || !stats.isFile()) {
			markSkippedUnsafePath(input.state, input.repoRoot, reportPath);
			continue;
		}
		let reportReal: string;
		try {
			reportReal = await input.runtime.realpathPath(reportPath);
		} catch (error) {
			if (!isPermissionErrorCode(error)) throw error;
			markSkippedUnsafePath(input.state, input.repoRoot, reportPath);
			continue;
		}
		if (!isContainedPath(input.inboxReal, reportReal)) {
			markSkippedUnsafePath(input.state, input.repoRoot, reportPath);
			continue;
		}
		input.state.files.push({
			path: reportPath,
			relativePath: relative(input.repoRoot, reportPath),
			lane: input.lane,
		});
	}
}

function isPartialInboxTempEntry(entry: string): boolean {
	return entry.endsWith(".json.tmp") || entry.includes(".json.tmp-");
}

function isNonPlaceholderSkill(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return (
		normalized !== "" &&
		normalized !== "unknown" &&
		normalized !== "unknown-skill"
	);
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
	return [...new Set(values)].sort();
}
