import type { Stats } from "node:fs";
import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
	SKILL_FEEDBACK_CORRELATION_WITNESS_DIR,
	type CorrelationWitness,
	isSafeCorrelationWitnessFileName,
	verifyCorrelationWitness,
} from "./command-contract";
import type { ReviewInboxRead, WriterProofKeyRead } from "./inbox-read-model";
import { stableReportId } from "./report-helpers";
import type { SkillFeedbackRuntime } from "./runtime-contract";

const INBOX_DIR = ".skill-feedback";

/**
 * Schema version for private correlation diagnostic artifacts.
 *
 * @defaultValue "1"
 */
export const CORRELATION_DIAGNOSTIC_SCHEMA_VERSION = "1";

/**
 * Kind marker for private correlation diagnostic artifacts.
 *
 * @defaultValue "correlation_diagnostic"
 */
export const CORRELATION_DIAGNOSTIC_KIND = "correlation_diagnostic";

/**
 * Minimal finalizer input needed to write a repairable diagnostic artifact.
 */
export type CorrelationDiagnosticArtifactInput = {
	skill: string;
	hookReportId: string;
	hookWrittenPath?: string;
	skillRunId: string;
	createdTs: string;
	candidates: readonly CorrelationDiagnosticCloseoutCandidate[];
};

/**
 * Closeout candidate fields persisted in repair diagnostics.
 */
export type CorrelationDiagnosticCloseoutCandidate = {
	reportId: string;
	writtenPath: string;
	proofStatus: string;
};

/**
 * Private diagnostic artifact written when witness finalization blocks.
 */
export type CorrelationDiagnosticArtifact = {
	schema_version: typeof CORRELATION_DIAGNOSTIC_SCHEMA_VERSION;
	kind: typeof CORRELATION_DIAGNOSTIC_KIND;
	created_ts: string;
	skill: string;
	hook_report_id: string;
	diagnostics: readonly string[];
	repair_candidates?: readonly CorrelationRepairCandidateSource[];
};

/**
 * Repair source embedded in a diagnostic artifact for later correlation repair.
 */
export type CorrelationRepairCandidateSource = {
	source: "correlation_finalizer";
	skill: string;
	hook_report_id: string;
	hook_written_path: string;
	closeout_report_id: string;
	closeout_written_path: string;
	closeout_proof_status: string;
	skill_run_id: string;
};

/**
 * Parsed diagnostic artifact ready for repair classification.
 */
export type CorrelationDiagnosticRead = {
	artifact: CorrelationDiagnosticArtifact;
};

type CorrelationDirectoryArtifact = {
	fileName: string;
} & (
	| { kind: "witness" | "diagnostic"; raw: unknown }
	| { kind: "invalid"; diagnostic: string }
);

type CorrelationDirectoryRead =
	| { ok: true; artifacts: CorrelationDirectoryArtifact[] }
	| { ok: false; diagnostic: string };

/**
 * Correlation artifacts needed for repair preview classification.
 */
export type CorrelationArtifactRead =
	| {
			ok: true;
			diagnostics: CorrelationDiagnosticRead[];
			verifiedWitnesses: CorrelationWitness[];
	  }
	| { ok: false; diagnostics: string[] };

/**
 * Write a private diagnostic artifact in the correlation witness directory.
 *
 * @param input - Finalizer fields to persist as repair evidence.
 * @param runtime - Runtime filesystem adapter.
 * @param repoRoot - Repository root that owns `.skill-feedback/`.
 * @param diagnostics - Diagnostic codes to persist.
 * @returns Write status and a stable diagnostic code on failure.
 */
export async function writeCorrelationDiagnosticArtifact(
	input: CorrelationDiagnosticArtifactInput,
	runtime: SkillFeedbackRuntime,
	repoRoot: string,
	diagnostics: readonly string[],
): Promise<{ ok: true } | { ok: false; code: string }> {
	const inboxPath = join(repoRoot, INBOX_DIR);
	const witnessDirectory = await prepareCorrelationWitnessDirectory(
		inboxPath,
		runtime,
	);
	if (!witnessDirectory.ok) return { ok: false, code: witnessDirectory.code };
	const artifact: CorrelationDiagnosticArtifact = {
		schema_version: CORRELATION_DIAGNOSTIC_SCHEMA_VERSION,
		kind: CORRELATION_DIAGNOSTIC_KIND,
		created_ts: input.createdTs,
		skill: input.skill,
		hook_report_id: input.hookReportId,
		diagnostics: uniqueSorted(diagnostics),
		...correlationRepairCandidateSourcesForInput(input),
	};
	const diagnosticId = stableReportId("diagnostic", artifact);
	const diagnosticPath = join(
		inboxPath,
		SKILL_FEEDBACK_CORRELATION_WITNESS_DIR,
		`${diagnosticId}.json`,
	);
	try {
		await runtime.writePrivateFile(
			diagnosticPath,
			`${JSON.stringify(artifact, null, "\t")}\n`,
			0o600,
		);
		return { ok: true };
	} catch {
		return { ok: false, code: "correlation_diagnostic_write_failed" };
	}
}

/**
 * Read private diagnostics and verified witnesses used by repair preview.
 *
 * @param input - Repository, runtime, and writer proof key.
 * @returns Parsed diagnostics plus verified witnesses when proof is usable.
 */
export async function readCorrelationRepairArtifacts(input: {
	repoRoot: string;
	runtime: SkillFeedbackRuntime;
	proofKey: WriterProofKeyRead;
}): Promise<CorrelationArtifactRead> {
	const directoryRead = await readCorrelationDirectoryArtifacts(input);
	if (!directoryRead.ok) {
		return { ok: false, diagnostics: [directoryRead.diagnostic] };
	}
	const diagnostics: CorrelationDiagnosticRead[] = [];
	const rawWitnesses: unknown[] = [];
	for (const artifactRead of directoryRead.artifacts) {
		if (artifactRead.kind === "invalid") {
			return { ok: false, diagnostics: [artifactRead.diagnostic] };
		}
		if (artifactRead.kind === "diagnostic") {
			const artifact = parseCorrelationDiagnosticArtifact(artifactRead.raw);
			if (artifact) diagnostics.push({ artifact });
		} else {
			rawWitnesses.push(artifactRead.raw);
		}
	}
	if (rawWitnesses.length > 0 && !input.proofKey.ok) {
		return {
			ok: true,
			diagnostics,
			verifiedWitnesses: [],
		};
	}
	const verifiedWitnesses: CorrelationWitness[] = [];
	if (input.proofKey.ok) {
		for (const raw of rawWitnesses) {
			const context = verifyCorrelationWitness(raw, input.proofKey.key);
			if (context.verified && context.witness) {
				verifiedWitnesses.push(context.witness);
			}
		}
	}
	return { ok: true, diagnostics, verifiedWitnesses };
}

/**
 * Read verified witness artifacts and push artifact diagnostics into inbox state.
 *
 * @param input - Repository, runtime, writer proof key, and mutable read state.
 * @returns Verified witnesses accepted for overlay validation.
 */
export async function readCorrelationWitnesses(input: {
	repoRoot: string;
	runtime: SkillFeedbackRuntime;
	proofKey: WriterProofKeyRead;
	state: ReviewInboxRead;
}): Promise<{ verified: CorrelationWitness[] }> {
	const directoryRead = await readCorrelationDirectoryArtifacts(input);
	if (!directoryRead.ok) {
		input.state.correlationDiagnostics.push(directoryRead.diagnostic);
		input.state.blockedCorrelationWitnessCount += 1;
		return { verified: [] };
	}
	const rawWitnesses: Array<{ fileName: string; raw: unknown }> = [];
	for (const artifactRead of directoryRead.artifacts) {
		if (artifactRead.kind === "invalid") {
			input.state.correlationDiagnostics.push(artifactRead.diagnostic);
			input.state.blockedCorrelationWitnessCount += 1;
			continue;
		}
		if (artifactRead.kind === "diagnostic") {
			const artifact = parseCorrelationDiagnosticArtifact(artifactRead.raw);
			if (!artifact) {
				input.state.correlationDiagnostics.push("correlation_diagnostic_invalid");
			} else {
				input.state.correlationDiagnostics.push(...artifact.diagnostics);
			}
			input.state.blockedCorrelationWitnessCount += 1;
			continue;
		}
		rawWitnesses.push({
			fileName: artifactRead.fileName,
			raw: artifactRead.raw,
		});
	}
	if (rawWitnesses.length > 0 && !input.proofKey.ok) {
		input.state.correlationDiagnostics.push(
			"correlation_writer_proof_key_unusable",
			...input.proofKey.diagnostics,
		);
		input.state.blockedCorrelationWitnessCount += rawWitnesses.length;
		return { verified: [] };
	}
	if (!input.proofKey.ok) return { verified: [] };
	const duplicateWitnessIds = duplicateStringSet(
		rawWitnesses.map((entry) => rawStringField(entry.raw, "witness_id")),
	);
	const verified: CorrelationWitness[] = [];
	for (const { fileName, raw } of rawWitnesses) {
		const witnessId = rawStringField(raw, "witness_id");
		if (duplicateWitnessIds.has(witnessId ?? "")) {
			input.state.correlationDiagnostics.push("correlation_witness_duplicate_id");
			input.state.blockedCorrelationWitnessCount += 1;
			continue;
		}
		if (witnessId && fileName !== `${witnessId}.json`) {
			input.state.correlationDiagnostics.push("correlation_witness_file_mismatch");
			input.state.blockedCorrelationWitnessCount += 1;
			continue;
		}
		const context = verifyCorrelationWitness(raw, input.proofKey.key);
		if (!context.verified || !context.witness) {
			input.state.correlationDiagnostics.push(...context.diagnostics);
			input.state.blockedCorrelationWitnessCount += 1;
			continue;
		}
		verified.push(context.witness);
	}
	return { verified };
}

/**
 * Create and verify the private correlation witness directory.
 *
 * @param inboxPath - Absolute path to `.skill-feedback/`.
 * @param runtime - Runtime filesystem adapter.
 * @returns Directory path, or a stable refusal diagnostic.
 */
export async function prepareCorrelationWitnessDirectory(
	inboxPath: string,
	runtime: SkillFeedbackRuntime,
): Promise<{ ok: true; path: string } | { ok: false; code: string }> {
	const directoryPath = join(
		inboxPath,
		SKILL_FEEDBACK_CORRELATION_WITNESS_DIR,
	);
	const existing = await lstatOptional(directoryPath, runtime);
	if (existing?.isSymbolicLink()) {
		return { ok: false, code: "correlation_witness_dir_symlink_refused" };
	}
	if (existing && !existing.isDirectory()) {
		return { ok: false, code: "correlation_witness_dir_not_directory" };
	}
	if (!existing) {
		await runtime.mkdirPrivate(directoryPath, 0o700);
	}

	const verified = await lstatOptional(directoryPath, runtime);
	if (!verified) {
		return {
			ok: false,
			code: "correlation_witness_dir_missing_after_create",
		};
	}
	if (
		verified.isSymbolicLink() ||
		!verified.isDirectory() ||
		!hasPrivateMode(verified, 0o077)
	) {
		return { ok: false, code: "correlation_witness_dir_unusable" };
	}

	const inboxReal = await safeRealpath(inboxPath, runtime);
	const directoryReal = await safeRealpath(directoryPath, runtime);
	if (!inboxReal || !directoryReal || !isContainedPath(inboxReal, directoryReal)) {
		return { ok: false, code: "correlation_witness_dir_escape_refused" };
	}
	return { ok: true, path: directoryPath };
}

function correlationRepairCandidateSourcesForInput(
	input: CorrelationDiagnosticArtifactInput,
): Pick<CorrelationDiagnosticArtifact, "repair_candidates"> {
	if (!input.hookWrittenPath) return {};
	const sources: CorrelationRepairCandidateSource[] = [];
	for (const candidate of input.candidates) {
		sources.push({
			source: "correlation_finalizer",
			skill: input.skill,
			hook_report_id: input.hookReportId,
			hook_written_path: input.hookWrittenPath,
			closeout_report_id: candidate.reportId,
			closeout_written_path: candidate.writtenPath,
			closeout_proof_status: candidate.proofStatus,
			skill_run_id: input.skillRunId,
		});
	}
	return sources.length > 0 ? { repair_candidates: sources } : {};
}

function parseCorrelationDiagnosticArtifact(
	raw: unknown,
): CorrelationDiagnosticArtifact | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const artifact = raw as Record<string, unknown>;
	if (artifact.schema_version !== CORRELATION_DIAGNOSTIC_SCHEMA_VERSION) {
		return undefined;
	}
	if (artifact.kind !== CORRELATION_DIAGNOSTIC_KIND) return undefined;
	if (typeof artifact.created_ts !== "string") return undefined;
	if (typeof artifact.skill !== "string") return undefined;
	if (typeof artifact.hook_report_id !== "string") return undefined;
	if (!Array.isArray(artifact.diagnostics)) return undefined;
	const diagnostics = artifact.diagnostics.filter(
		(diagnostic): diagnostic is string =>
			typeof diagnostic === "string" && diagnostic.trim() !== "",
	);
	if (diagnostics.length === 0) return undefined;
	const repairCandidates = parseCorrelationRepairCandidateSources(
		artifact.repair_candidates,
	);
	return {
		schema_version: CORRELATION_DIAGNOSTIC_SCHEMA_VERSION,
		kind: CORRELATION_DIAGNOSTIC_KIND,
		created_ts: artifact.created_ts,
		skill: artifact.skill,
		hook_report_id: artifact.hook_report_id,
		diagnostics: uniqueSorted(diagnostics),
		...(repairCandidates.length > 0
			? { repair_candidates: repairCandidates }
			: {}),
	};
}

function parseCorrelationRepairCandidateSources(
	raw: unknown,
): CorrelationRepairCandidateSource[] {
	if (!Array.isArray(raw)) return [];
	const sources: CorrelationRepairCandidateSource[] = [];
	for (const value of raw) {
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const source = value as Record<string, unknown>;
		if (source.source !== "correlation_finalizer") continue;
		if (
			typeof source.skill !== "string" ||
			typeof source.hook_report_id !== "string" ||
			typeof source.hook_written_path !== "string" ||
			typeof source.closeout_report_id !== "string" ||
			typeof source.closeout_written_path !== "string" ||
			typeof source.closeout_proof_status !== "string" ||
			typeof source.skill_run_id !== "string"
		) {
			continue;
		}
		sources.push({
			source: "correlation_finalizer",
			skill: source.skill,
			hook_report_id: source.hook_report_id,
			hook_written_path: source.hook_written_path,
			closeout_report_id: source.closeout_report_id,
			closeout_written_path: source.closeout_written_path,
			closeout_proof_status: source.closeout_proof_status,
			skill_run_id: source.skill_run_id,
		});
	}
	return sources;
}

async function readCorrelationDirectoryArtifacts(input: {
	repoRoot: string;
	runtime: SkillFeedbackRuntime;
}): Promise<CorrelationDirectoryRead> {
	const inboxPath = join(input.repoRoot, INBOX_DIR);
	const witnessDirectoryPath = join(
		inboxPath,
		SKILL_FEEDBACK_CORRELATION_WITNESS_DIR,
	);
	const directoryStats = await lstatOptional(witnessDirectoryPath, input.runtime);
	if (!directoryStats) return { ok: true, artifacts: [] };
	if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
		return { ok: false, diagnostic: "correlation_witness_dir_unsafe" };
	}
	const inboxReal = await safeRealpath(inboxPath, input.runtime);
	const witnessDirectoryReal = await safeRealpath(
		witnessDirectoryPath,
		input.runtime,
	);
	if (
		!inboxReal ||
		!witnessDirectoryReal ||
		!isContainedPath(inboxReal, witnessDirectoryReal)
	) {
		return { ok: false, diagnostic: "correlation_witness_dir_unsafe" };
	}
	let entries: string[];
	try {
		entries = await readdir(witnessDirectoryPath);
	} catch (error) {
		if (isPermissionErrorCode(error)) {
			return { ok: false, diagnostic: "correlation_witness_dir_unsafe" };
		}
		throw error;
	}
	const artifacts: CorrelationDirectoryArtifact[] = [];
	for (const entry of entries.sort()) {
		const isWitness = isSafeCorrelationWitnessFileName(entry);
		const isDiagnostic = isSafeCorrelationDiagnosticFileName(entry);
		if (!isWitness && !isDiagnostic) continue;
		const artifactRead = await readSafeCorrelationJsonArtifact({
			path: join(witnessDirectoryPath, entry),
			witnessDirectoryReal,
			runtime: input.runtime,
		});
		artifacts.push(
			artifactRead.ok
				? {
						fileName: entry,
						kind: isDiagnostic ? "diagnostic" : "witness",
						raw: artifactRead.raw,
					}
				: {
						fileName: entry,
						kind: "invalid",
						diagnostic: artifactRead.diagnostic,
					},
		);
	}
	return { ok: true, artifacts };
}

function isSafeCorrelationDiagnosticFileName(fileName: string): boolean {
	return /^diagnostic_[0-9a-f]{16}\.json$/.test(fileName);
}

async function readSafeCorrelationJsonArtifact(input: {
	path: string;
	witnessDirectoryReal: string;
	runtime: SkillFeedbackRuntime;
}): Promise<
	| { ok: true; raw: unknown }
	| {
			ok: false;
			diagnostic:
				| "correlation_witness_file_unsafe"
				| "correlation_witness_invalid_json";
	  }
> {
	const stats = await lstatOptional(input.path, input.runtime);
	if (!stats || stats.isSymbolicLink() || !stats.isFile()) {
		return { ok: false, diagnostic: "correlation_witness_file_unsafe" };
	}
	const artifactReal = await safeRealpath(input.path, input.runtime);
	if (!artifactReal || !isContainedPath(input.witnessDirectoryReal, artifactReal)) {
		return { ok: false, diagnostic: "correlation_witness_file_unsafe" };
	}
	try {
		return {
			ok: true,
			raw: JSON.parse(await input.runtime.readText(input.path)) as unknown,
		};
	} catch {
		return { ok: false, diagnostic: "correlation_witness_invalid_json" };
	}
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

function hasPrivateMode(stats: Stats, unsafeMask: number): boolean {
	return (stats.mode & unsafeMask) === 0;
}

function isContainedPath(parent: string, child: string): boolean {
	const childRelativePath = relative(parent, child);
	return (
		childRelativePath !== "" &&
		!childRelativePath.startsWith("..") &&
		!isAbsolute(childRelativePath)
	);
}

function duplicateStringSet(
	values: readonly (string | undefined)[],
): ReadonlySet<string> {
	const counts = new Map<string, number>();
	for (const value of values) {
		if (!value) continue;
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return new Set(
		[...counts.entries()]
			.filter(([, count]) => count > 1)
			.map(([value]) => value),
	);
}

function rawStringField(raw: unknown, field: string): string | undefined {
	return raw &&
		typeof raw === "object" &&
		!Array.isArray(raw) &&
		typeof (raw as Record<string, unknown>)[field] === "string"
		? ((raw as Record<string, unknown>)[field] as string)
		: undefined;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
	return [...new Set(values)].sort();
}

function isNodeErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === code
	);
}

function isPermissionErrorCode(error: unknown): boolean {
	return isNodeErrorCode(error, "EACCES") || isNodeErrorCode(error, "EPERM");
}
