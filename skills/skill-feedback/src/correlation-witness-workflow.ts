import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import {
	type CorrelationWitness,
	type CorrelationWitnessSeed,
	type NormalizedSoftwareLearningReport,
	type SkillFeedbackCorrelateCandidateData,
	type SkillFeedbackCorrelateReasonId,
	correlationWitnessRelativePath,
	createCorrelationWitness,
	isSkillFeedbackCorrelateReasonId,
} from "./command-contract";
import {
	CORRELATION_DIAGNOSTIC_KIND,
	CORRELATION_DIAGNOSTIC_SCHEMA_VERSION,
	type CorrelationDiagnosticArtifact,
	type CorrelationDiagnosticRead,
	type CorrelationRepairCandidateSource,
	prepareCorrelationWitnessDirectory,
	readCorrelationRepairArtifacts,
	readCorrelationWitnesses,
	writeCorrelationDiagnosticArtifact,
} from "./correlation-witness-artifacts";
import {
	type ReviewInboxRead,
	type SafeInboxJsonFile,
	type WriterProofKeyRead,
	type WriterProofKeyReader,
	normalizeRawInboxReports,
	readRawInboxReports,
	scanSafeInboxJsonFiles,
} from "./inbox-read-model";
import type { SkillFeedbackRuntime } from "./runtime-contract";

const INBOX_DIR = ".skill-feedback";

export type CorrelationCloseoutCandidate = {
	reportId: string;
	writtenPath: string;
	proofStatus: string;
};

export type FinalizeCorrelationWitnessInput = {
	skill: string;
	hookReportId: string;
	hookWrittenPath?: string;
	skillRunId: string;
	createdTs: string;
	candidates: readonly CorrelationCloseoutCandidate[];
	closeoutDiagnostics?: readonly string[];
};

export type FinalizeCorrelationWitnessResult =
	| {
			status: "written";
			witnessId: string;
			witnessPath: string;
			diagnostics: readonly string[];
	  }
	| { status: "blocked"; diagnostics: readonly string[] };

type CorrelationCandidateSelection =
	| {
			ok: true;
			candidate: CorrelationCloseoutCandidate;
			diagnostics: string[];
	  }
	| { ok: false; diagnostics: string[] };

export type CorrelationRepairScanCandidate =
	SkillFeedbackCorrelateCandidateData & {
		finalizeInput?: FinalizeCorrelationWitnessInput;
	};

export type CorrelationRepairScan =
	| {
			ok: true;
			diagnosticCount: number;
			candidates: CorrelationRepairScanCandidate[];
			writtenCount: number;
			failedCount: number;
	  }
	| { ok: false; diagnostics: string[] };

export type CorrelationRepairExecuteResult =
	| Extract<CorrelationRepairScan, { ok: true }>
	| {
			ok: false;
			diagnostics: string[];
			changedState: "none" | "partial";
			scan: Extract<CorrelationRepairScan, { ok: true }>;
	  };

type CorrelationReportRead = {
	file: SafeInboxJsonFile;
	report: NormalizedSoftwareLearningReport;
};

const INVALID_CORRELATION_REPAIR_DIAGNOSTICS: ReadonlySet<string> = new Set([
	"correlation_hook_report_missing",
	"correlation_hook_proof_invalid",
	"correlation_hook_runtime_mismatch",
	"correlation_hook_skill_mismatch",
	"correlation_hook_run_id_mismatch",
	"correlation_runtime_unsupported",
	"correlation_inbox_unreadable",
	"correlation_witness_dir_unsafe",
]);

/**
 * Finalize a private witness linking one hook-capture report to one closeout.
 */
export async function finalizeSkillFeedbackCorrelationWitness(
	input: FinalizeCorrelationWitnessInput,
	options: {
		runtime: SkillFeedbackRuntime;
		readWriterProofKey: WriterProofKeyReader;
		repoRoot?: string;
	},
): Promise<FinalizeCorrelationWitnessResult> {
	const runtime = options.runtime;
	const repoRoot = resolve(options.repoRoot ?? runtime.repoRoot());
	const closeoutDiagnostics = uniqueSorted(input.closeoutDiagnostics ?? []);

	const scan = await scanSafeInboxJsonFiles(repoRoot, runtime);
	if (scan.rootStatus !== "readable") {
		return {
			status: "blocked",
			diagnostics: ["correlation_inbox_unreadable"],
		};
	}
	if (input.candidates.length === 0) {
		return blockCorrelationWitnessWithDiagnostic(
			input,
			runtime,
			repoRoot,
			closeoutDiagnostics.length > 0
				? closeoutDiagnostics
				: ["correlation_candidate_missing"],
		);
	}
	const proofKey = await options.readWriterProofKey(repoRoot, runtime);
	if (!proofKey.ok) {
		return {
			status: "blocked",
			diagnostics: uniqueSorted([
				"correlation_writer_proof_key_unusable",
				...proofKey.diagnostics,
			]),
		};
	}
	const reportRead = await readNormalizedReportsForCorrelation({
		files: scan.files,
		proofKey,
		runtime,
	});
	const readDiagnostics = correlationReportReadDiagnosticsForInput(
		reportRead,
		input,
	);
	if (readDiagnostics.length > 0) {
		return blockCorrelationWitnessWithDiagnostic(
			input,
			runtime,
			repoRoot,
			uniqueSorted([...closeoutDiagnostics, ...readDiagnostics]),
		);
	}
	const reports = reportRead.reports;
	const hook = selectCorrelationHookReport(reports, input);
	if (!hook.ok) {
		return blockCorrelationWitnessWithDiagnostic(
			input,
			runtime,
			repoRoot,
			uniqueSorted([...closeoutDiagnostics, ...hook.diagnostics]),
		);
	}
	const selection = selectEligibleCorrelationCandidate(reports, input);
	if (!selection.ok) {
		return blockCorrelationWitnessWithDiagnostic(
			input,
			runtime,
			repoRoot,
			uniqueSorted([...closeoutDiagnostics, ...selection.diagnostics]),
		);
	}
	const ignoreStatus = await runtime.checkIgnored(repoRoot, `${INBOX_DIR}/`);
	if (ignoreStatus !== 0) {
		return blockCorrelationWitnessWithDiagnostic(input, runtime, repoRoot, [
			"correlation_gitignore_gate_refused",
		]);
	}
	const candidateDiagnostics = await persistCorrelationWitnessDiagnostics(
		input,
		runtime,
		repoRoot,
		uniqueSorted([...closeoutDiagnostics, ...selection.diagnostics]),
	);
	const inboxPath = join(repoRoot, INBOX_DIR);
	const witnessDirectory = await prepareCorrelationWitnessDirectory(
		inboxPath,
		runtime,
	);
	if (!witnessDirectory.ok) {
		return { status: "blocked", diagnostics: [witnessDirectory.code] };
	}
	const seed: CorrelationWitnessSeed = {
		skill: input.skill,
		runtime_source: "claude_stop",
		hook_report_id: input.hookReportId,
		closeout_report_id: selection.candidate.reportId,
		skill_run_id: input.skillRunId,
		created_ts: input.createdTs,
	};
	const witness = createCorrelationWitness(
		seed,
		proofKey.key,
		randomBytes(16).toString("hex"),
	);
	const witnessRelativePath = correlationWitnessRelativePath(witness.witness_id);
	const witnessPath = join(inboxPath, witnessRelativePath);
	try {
		await runtime.writePrivateFile(
			witnessPath,
			`${JSON.stringify(witness, null, "\t")}\n`,
			0o600,
		);
	} catch {
		return {
			status: "blocked",
			diagnostics: ["correlation_witness_write_failed"],
		};
	}
	return {
		status: "written",
		witnessId: witness.witness_id,
		witnessPath: `${INBOX_DIR}/${witnessRelativePath}`,
		diagnostics: candidateDiagnostics,
	};
}

/**
 * Read repair diagnostics and classify preview candidates.
 */
export async function scanCorrelationRepairCandidates(input: {
	repoRoot: string;
	runtime: SkillFeedbackRuntime;
	readWriterProofKey: WriterProofKeyReader;
}): Promise<CorrelationRepairScan> {
	const scan = await scanSafeInboxJsonFiles(input.repoRoot, input.runtime);
	if (scan.rootStatus === "unsafe") {
		return { ok: false, diagnostics: ["correlation_inbox_unreadable"] };
	}
	if (scan.rootStatus === "missing") {
		return {
			ok: true,
			diagnosticCount: 0,
			candidates: [],
			writtenCount: 0,
			failedCount: 0,
		};
	}
	const proofKey = await input.readWriterProofKey(input.repoRoot, input.runtime);
	const reportRead = proofKey.ok
		? await readNormalizedReportsForCorrelation({
				files: scan.files,
				proofKey,
				runtime: input.runtime,
			})
		: { reports: [], failures: [] };
	const artifactRead = await readCorrelationRepairArtifacts({
		repoRoot: input.repoRoot,
		runtime: input.runtime,
		proofKey,
	});
	if (!artifactRead.ok) return artifactRead;
	const verifiedByHook = new Map(
		artifactRead.verifiedWitnesses.map((witness) => [
			witness.hook_report_id,
			witness,
		]),
	);
	const candidates = artifactRead.diagnostics.map((diagnostic) =>
		classifyCorrelationRepairDiagnostic({
			diagnostic,
			reports: reportRead.reports,
			reportReadFailures: reportRead.failures,
			verifiedByHook,
			proofKeyUsable: proofKey.ok,
			nowIso: input.runtime.nowIso(),
		}),
	);
	return {
		ok: true,
		diagnosticCount: artifactRead.diagnostics.length,
		candidates,
		writtenCount: 0,
		failedCount: 0,
	};
}

/**
 * Execute validated repair candidates by writing private witnesses.
 */
export async function executeCorrelationRepairCandidates(input: {
	scan: Extract<CorrelationRepairScan, { ok: true }>;
	runtime: SkillFeedbackRuntime;
	readWriterProofKey: WriterProofKeyReader;
	repoRoot?: string;
}): Promise<CorrelationRepairExecuteResult> {
	const candidates: CorrelationRepairScanCandidate[] = [];
	let writtenCount = 0;
	let failedCount = 0;
	const linkedHookReportIds = new Set<string>();
	const linkedCloseoutReportIds = new Set<string>();
	for (const candidate of input.scan.candidates) {
		if (candidate.class !== "repairable" || !candidate.finalizeInput) {
			candidates.push(candidate);
			continue;
		}
		const hookReportId = candidate.finalizeInput.hookReportId;
		const closeoutReportIds = candidate.finalizeInput.candidates.map(
			(closeout) => closeout.reportId,
		);
		if (
			linkedHookReportIds.has(hookReportId) ||
			closeoutReportIds.some((closeoutId) =>
				linkedCloseoutReportIds.has(closeoutId),
			)
		) {
			candidates.push({
				...candidate,
				class: "already_linked",
				reason_ids: ["existing_valid_witness"],
			});
			continue;
		}
		const result = await finalizeSkillFeedbackCorrelationWitness(
			candidate.finalizeInput,
			{
				runtime: input.runtime,
				readWriterProofKey: input.readWriterProofKey,
				...(input.repoRoot ? { repoRoot: input.repoRoot } : {}),
			},
		);
		if (result.status === "written") {
			writtenCount += 1;
			linkedHookReportIds.add(hookReportId);
			for (const closeoutReportId of closeoutReportIds) {
				linkedCloseoutReportIds.add(closeoutReportId);
			}
			candidates.push({
				...candidate,
				reason_ids: ["repairable_candidate"],
			});
			continue;
		}
		failedCount += 1;
		const blocked = blockedCorrelationRepairCandidate(
			{
				schema_version: CORRELATION_DIAGNOSTIC_SCHEMA_VERSION,
				kind: CORRELATION_DIAGNOSTIC_KIND,
				created_ts: candidate.finalizeInput.createdTs,
				skill: candidate.finalizeInput.skill,
				hook_report_id: candidate.finalizeInput.hookReportId,
				diagnostics: result.diagnostics,
			},
			result.diagnostics,
		);
		candidates.push(blocked);
		if (
			writtenCount > 0 ||
			result.diagnostics.includes("correlation_witness_write_failed") ||
			result.diagnostics.includes("correlation_diagnostic_write_failed")
		) {
			const remainingCandidates = input.scan.candidates.slice(candidates.length);
			const failedScan = {
				...input.scan,
				candidates: [...candidates, ...remainingCandidates],
				writtenCount,
				failedCount,
			};
			const diagnostics =
				writtenCount > 0
					? uniqueSorted([
							...result.diagnostics,
							"correlation_partial_write_failed",
						])
					: [...result.diagnostics];
			return {
				ok: false,
				diagnostics,
				changedState: writtenCount > 0 ? "partial" : "none",
				scan: failedScan,
			};
		}
	}
	return {
		...input.scan,
		candidates,
		writtenCount,
		failedCount,
	};
}

/**
 * Overlay verified witnesses onto review/health report projections.
 */
export async function applyVerifiedCorrelationWitnesses(input: {
	repoRoot: string;
	runtime: SkillFeedbackRuntime;
	proofKey: WriterProofKeyRead;
	reports: readonly NormalizedSoftwareLearningReport[];
	state: ReviewInboxRead;
}): Promise<NormalizedSoftwareLearningReport[]> {
	if (input.state.inboxRootStatus !== "readable") return [...input.reports];
	const witnessRead = await readCorrelationWitnesses({
		repoRoot: input.repoRoot,
		runtime: input.runtime,
		proofKey: input.proofKey,
		state: input.state,
	});
	const duplicateCloseouts = duplicateStringSet(
		witnessRead.verified.map((witness) => witness.closeout_report_id),
	);
	const duplicateHooks = duplicateStringSet(
		witnessRead.verified.map((witness) => witness.hook_report_id),
	);
	const reportsById = indexReportsById(input.reports);
	const overlayByCloseoutId = new Map<string, string>();
	for (const witness of witnessRead.verified) {
		if (duplicateHooks.has(witness.hook_report_id)) {
			input.state.correlationDiagnostics.push(
				"correlation_witness_duplicate_hook",
			);
			input.state.blockedCorrelationWitnessCount += 1;
			continue;
		}
		if (duplicateCloseouts.has(witness.closeout_report_id)) {
			input.state.correlationDiagnostics.push(
				"correlation_witness_duplicate_closeout",
			);
			input.state.blockedCorrelationWitnessCount += 1;
			continue;
		}
		const link = validateCorrelationWitnessLink(witness, reportsById);
		if (!link.ok) {
			input.state.correlationDiagnostics.push(...link.diagnostics);
			input.state.blockedCorrelationWitnessCount += 1;
			if (link.diagnostics.includes("correlation_witness_orphan_report")) {
				input.state.orphanCorrelationWitnessCount += 1;
			}
			continue;
		}
		input.state.verifiedCorrelationWitnessCount += 1;
		overlayByCloseoutId.set(witness.closeout_report_id, witness.skill_run_id);
	}
	input.state.correlationDiagnostics = uniqueSorted(
		input.state.correlationDiagnostics,
	);
	if (overlayByCloseoutId.size === 0) return [...input.reports];
	return input.reports.map((report) => {
		const trustedRunId = overlayByCloseoutId.get(report.report_id);
		if (!trustedRunId) return report;
		return {
			...report,
			correlation_status: "linked",
			skill_run_id: trustedRunId,
			skill_run_id_provenance: "correlation_owned",
		};
	});
}

function selectEligibleCorrelationCandidate(
	reports: readonly CorrelationReportRead[],
	input: FinalizeCorrelationWitnessInput,
): CorrelationCandidateSelection {
	const eligible: CorrelationCloseoutCandidate[] = [];
	const diagnostics: string[] = [];
	for (const candidate of input.candidates) {
		const closeout = selectCorrelationCloseoutReport(reports, candidate, input);
		if (closeout.ok) eligible.push(candidate);
		else diagnostics.push(...closeout.diagnostics);
	}
	if (eligible.length === 1) {
		const candidate = eligible[0];
		if (candidate) {
			return {
				ok: true,
				candidate,
				diagnostics: uniqueSorted(diagnostics),
			};
		}
	}
	if (eligible.length > 1) {
		return {
			ok: false,
			diagnostics: uniqueSorted([
				...diagnostics,
				"correlation_candidate_ambiguous",
			]),
		};
	}
	return {
		ok: false,
		diagnostics: uniqueSorted(
			diagnostics.length > 0
				? diagnostics
				: ["correlation_candidate_missing"],
		),
	};
}

async function persistCorrelationWitnessDiagnostics(
	input: FinalizeCorrelationWitnessInput,
	runtime: SkillFeedbackRuntime,
	repoRoot: string,
	diagnostics: readonly string[],
): Promise<string[]> {
	if (diagnostics.length === 0) return [];
	const write = await writeCorrelationDiagnosticArtifact(
		input,
		runtime,
		repoRoot,
		diagnostics,
	);
	return write.ok
		? uniqueSorted(diagnostics)
		: uniqueSorted([...diagnostics, write.code]);
}

async function blockCorrelationWitnessWithDiagnostic(
	input: FinalizeCorrelationWitnessInput,
	runtime: SkillFeedbackRuntime,
	repoRoot: string,
	diagnostics: readonly string[],
): Promise<FinalizeCorrelationWitnessResult> {
	const write = await writeCorrelationDiagnosticArtifact(
		input,
		runtime,
		repoRoot,
		diagnostics,
	);
	return {
		status: "blocked",
		diagnostics: write.ok
			? uniqueSorted(diagnostics)
			: uniqueSorted([...diagnostics, write.code]),
	};
}

function classifyCorrelationRepairDiagnostic(input: {
	diagnostic: CorrelationDiagnosticRead;
	reports: readonly CorrelationReportRead[];
	reportReadFailures: readonly { relativePath: string; diagnostic: string }[];
	verifiedByHook: ReadonlyMap<string, CorrelationWitness>;
	proofKeyUsable: boolean;
	nowIso: string;
}): CorrelationRepairScanCandidate {
	const artifact = input.diagnostic.artifact;
	const existing = input.verifiedByHook.get(artifact.hook_report_id);
	if (existing) {
		return {
			candidate_key: `hook:${artifact.hook_report_id}`,
			class: "already_linked",
			hook_report_ref: reportRef(artifact.hook_report_id),
			closeout_report_refs: [reportRef(existing.closeout_report_id)],
			reason_ids: ["existing_valid_witness"],
		};
	}
	const sources = artifact.repair_candidates ?? [];
	if (sources.length === 0) {
		return blockedCorrelationRepairCandidate(artifact, artifact.diagnostics);
	}
	if (!input.proofKeyUsable) {
		return blockedCorrelationRepairCandidate(artifact, [
			"correlation_writer_proof_key_unusable",
		]);
	}
	const validated = sources.map((source) =>
		validateCorrelationRepairCandidateSource({
			artifact,
			source,
			reports: input.reports,
			reportReadFailures: input.reportReadFailures,
			nowIso: input.nowIso,
		}),
	);
	const repairable = validated.filter(
		(result): result is Extract<typeof result, { ok: true }> => result.ok,
	);
	if (repairable.length === 1) {
		const candidate = repairable[0];
		return {
			candidate_key: `hook:${artifact.hook_report_id}`,
			class: "repairable",
			hook_report_ref: reportRef(artifact.hook_report_id),
			closeout_report_refs: [reportRef(candidate.closeoutReportId)],
			reason_ids: ["repairable_candidate"],
			finalizeInput: candidate.finalizeInput,
		};
	}
	if (repairable.length > 1) {
		return {
			candidate_key: `hook:${artifact.hook_report_id}`,
			class: "ambiguous",
			hook_report_ref: reportRef(artifact.hook_report_id),
			closeout_report_refs: uniqueSorted(
				repairable.map((candidate) => reportRef(candidate.closeoutReportId)),
			),
			reason_ids: ["correlation_candidate_ambiguous"],
		};
	}
	return blockedCorrelationRepairCandidate(
		artifact,
		validated.flatMap((result) => (result.ok ? [] : result.diagnostics)),
	);
}

function validateCorrelationRepairCandidateSource(input: {
	artifact: CorrelationDiagnosticArtifact;
	source: CorrelationRepairCandidateSource;
	reports: readonly CorrelationReportRead[];
	reportReadFailures: readonly { relativePath: string; diagnostic: string }[];
	nowIso: string;
}):
	| {
			ok: true;
			closeoutReportId: string;
			finalizeInput: FinalizeCorrelationWitnessInput;
	  }
	| { ok: false; diagnostics: string[] } {
	const { artifact, source } = input;
	if (
		source.skill !== artifact.skill ||
		source.hook_report_id !== artifact.hook_report_id
	) {
		return {
			ok: false,
			diagnostics: ["correlation_candidate_source_boundary_mismatch"],
		};
	}
	const finalizeInput: FinalizeCorrelationWitnessInput = {
		skill: source.skill,
		hookReportId: source.hook_report_id,
		hookWrittenPath: source.hook_written_path,
		skillRunId: source.skill_run_id,
		createdTs: input.nowIso,
		candidates: [
			{
				reportId: source.closeout_report_id,
				writtenPath: source.closeout_written_path,
				proofStatus: source.closeout_proof_status,
			},
		],
	};
	const readDiagnostics = correlationReportReadDiagnosticsForInput(
		{ failures: input.reportReadFailures },
		finalizeInput,
	);
	if (readDiagnostics.length > 0) {
		return { ok: false, diagnostics: readDiagnostics };
	}
	const hookEntry = input.reports.find(
		(entry) => entry.report.report_id === source.hook_report_id,
	);
	if (!hookEntry || hookEntry.file.relativePath !== source.hook_written_path) {
		return {
			ok: false,
			diagnostics: ["correlation_candidate_source_boundary_mismatch"],
		};
	}
	const hook = selectCorrelationHookReport(input.reports, finalizeInput);
	if (!hook.ok) return { ok: false, diagnostics: hook.diagnostics };
	const selection = selectEligibleCorrelationCandidate(
		input.reports,
		finalizeInput,
	);
	if (!selection.ok) return { ok: false, diagnostics: selection.diagnostics };
	return {
		ok: true,
		closeoutReportId: selection.candidate.reportId,
		finalizeInput,
	};
}

function blockedCorrelationRepairCandidate(
	artifact: CorrelationDiagnosticArtifact,
	diagnostics: readonly string[],
): CorrelationRepairScanCandidate {
	const className = correlationRepairClassForDiagnostics(diagnostics);
	return {
		candidate_key: `hook:${artifact.hook_report_id}`,
		class: className,
		hook_report_ref: reportRef(artifact.hook_report_id),
		closeout_report_refs: [],
		reason_ids: toCorrelateReasonIds(diagnostics, className),
	};
}

function correlationRepairClassForDiagnostics(
	diagnostics: readonly string[],
): SkillFeedbackCorrelateCandidateData["class"] {
	if (diagnostics.includes("correlation_candidate_ambiguous")) {
		return "ambiguous";
	}
	if (
		diagnostics.some((diagnostic) =>
			INVALID_CORRELATION_REPAIR_DIAGNOSTICS.has(diagnostic),
		)
	) {
		return "invalid";
	}
	return "insufficient_evidence";
}

function toCorrelateReasonIds(
	diagnostics: readonly string[],
	className: SkillFeedbackCorrelateCandidateData["class"],
): SkillFeedbackCorrelateReasonId[] {
	const reasonIds = diagnostics.filter(
		(diagnostic): diagnostic is SkillFeedbackCorrelateReasonId =>
			isSkillFeedbackCorrelateReasonId(diagnostic),
	);
	if (reasonIds.length > 0) return uniqueSorted(reasonIds);
	return className === "insufficient_evidence"
		? ["insufficient_evidence"]
		: ["correlation_candidate_source_boundary_mismatch"];
}

function validateCorrelationWitnessLink(
	witness: CorrelationWitness,
	reportsById: ReadonlyMap<string, readonly NormalizedSoftwareLearningReport[]>,
): { ok: true } | { ok: false; diagnostics: string[] } {
	const hookReports = reportsById.get(witness.hook_report_id) ?? [];
	const closeoutReports = reportsById.get(witness.closeout_report_id) ?? [];
	if (hookReports.length !== 1 || closeoutReports.length !== 1) {
		return { ok: false, diagnostics: ["correlation_witness_orphan_report"] };
	}
	const hook = hookReports[0];
	const closeout = closeoutReports[0];
	if (!hook || !closeout) {
		return { ok: false, diagnostics: ["correlation_witness_orphan_report"] };
	}
	const diagnostics: string[] = [];
	if (!hook.writer_proof_verified) {
		diagnostics.push("correlation_witness_hook_proof_invalid");
	}
	if (!closeout.writer_proof_verified) {
		diagnostics.push("correlation_witness_closeout_proof_invalid");
	}
	if (
		hook.evidence_source !== "hook_capture" ||
		hook.capture_runtime !== "claude_stop"
	) {
		diagnostics.push("correlation_witness_hook_runtime_mismatch");
	}
	if (closeout.evidence_source !== "driver_closeout") {
		diagnostics.push("correlation_witness_closeout_source_mismatch");
	}
	if (hook.skill !== witness.skill || closeout.skill !== witness.skill) {
		diagnostics.push("correlation_witness_skill_mismatch");
	}
	if (
		hook.skill_run_id !== witness.skill_run_id ||
		hook.skill_run_id_provenance !== "runtime_owned"
	) {
		diagnostics.push("correlation_witness_run_id_mismatch");
	}
	return diagnostics.length === 0
		? { ok: true }
		: { ok: false, diagnostics: uniqueSorted(diagnostics) };
}

async function readNormalizedReportsForCorrelation(input: {
	files: readonly SafeInboxJsonFile[];
	proofKey: Extract<WriterProofKeyRead, { ok: true }>;
	runtime: SkillFeedbackRuntime;
}): Promise<{
	reports: CorrelationReportRead[];
	failures: Array<{ relativePath: string; diagnostic: string }>;
}> {
	const rawRead = await readRawInboxReports(input.files, input.runtime);
	const failures: Array<{ relativePath: string; diagnostic: string }> =
		rawRead.failures.map((failure) => ({
			relativePath: failure.file.relativePath,
			diagnostic:
				failure.reason === "permission"
					? "correlation_report_unreadable"
					: "correlation_report_invalid_json",
		}));
	const normalizedRead = normalizeRawInboxReports({
		rawReports: rawRead.reports,
		proofKey: input.proofKey,
	});
	failures.push(
		...normalizedRead.failures.map((failure) => ({
			relativePath: failure.file.relativePath,
			diagnostic: "correlation_report_invalid",
		})),
	);
	return { reports: normalizedRead.reports, failures };
}

function correlationReportReadDiagnosticsForInput(
	read: {
		failures: readonly { relativePath: string; diagnostic: string }[];
	},
	input: FinalizeCorrelationWitnessInput,
): string[] {
	const candidatePaths = new Set(
		input.candidates.map((candidate) => candidate.writtenPath),
	);
	if (input.hookWrittenPath) {
		candidatePaths.add(input.hookWrittenPath);
	}
	return uniqueSorted(
		read.failures
			.filter((failure) => candidatePaths.has(failure.relativePath))
			.map((failure) => failure.diagnostic),
	);
}

function selectCorrelationHookReport(
	reports: readonly CorrelationReportRead[],
	input: FinalizeCorrelationWitnessInput,
): { ok: true } | { ok: false; diagnostics: string[] } {
	const matches = reports.filter(
		(entry) => entry.report.report_id === input.hookReportId,
	);
	if (matches.length !== 1) {
		return { ok: false, diagnostics: ["correlation_hook_report_missing"] };
	}
	const match = matches[0];
	if (!match) {
		return { ok: false, diagnostics: ["correlation_hook_report_missing"] };
	}
	const report = match.report;
	const diagnostics: string[] = [];
	if (!report.writer_proof_verified) {
		diagnostics.push("correlation_hook_proof_invalid");
	}
	if (
		report.evidence_source !== "hook_capture" ||
		report.capture_runtime !== "claude_stop"
	) {
		diagnostics.push("correlation_hook_runtime_mismatch");
	}
	if (report.skill !== input.skill) {
		diagnostics.push("correlation_hook_skill_mismatch");
	}
	if (
		report.skill_run_id !== input.skillRunId ||
		report.skill_run_id_provenance !== "runtime_owned"
	) {
		diagnostics.push("correlation_hook_run_id_mismatch");
	}
	return diagnostics.length === 0
		? { ok: true }
		: { ok: false, diagnostics: uniqueSorted(diagnostics) };
}

function selectCorrelationCloseoutReport(
	reports: readonly CorrelationReportRead[],
	candidate: CorrelationCloseoutCandidate,
	input: FinalizeCorrelationWitnessInput,
): { ok: true } | { ok: false; diagnostics: string[] } {
	const matches = reports.filter(
		(entry) => entry.report.report_id === candidate.reportId,
	);
	if (matches.length !== 1) {
		return { ok: false, diagnostics: ["correlation_closeout_report_missing"] };
	}
	const match = matches[0];
	if (!match) {
		return { ok: false, diagnostics: ["correlation_closeout_report_missing"] };
	}
	const report = match.report;
	const diagnostics: string[] = [];
	const expectedWrittenPath = match.file.relativePath;
	if (candidate.writtenPath !== expectedWrittenPath) {
		diagnostics.push("correlation_closeout_path_mismatch");
	}
	if (candidate.proofStatus !== "attached") {
		diagnostics.push("correlation_closeout_proof_unavailable");
	}
	if (!report.writer_proof_verified) {
		diagnostics.push("correlation_closeout_proof_invalid");
	}
	if (report.evidence_source !== "driver_closeout") {
		diagnostics.push("correlation_closeout_source_mismatch");
	}
	if (report.skill !== input.skill) {
		diagnostics.push("correlation_closeout_skill_mismatch");
	}
	return diagnostics.length === 0
		? { ok: true }
		: { ok: false, diagnostics: uniqueSorted(diagnostics) };
}

function indexReportsById(
	reports: readonly NormalizedSoftwareLearningReport[],
): ReadonlyMap<string, NormalizedSoftwareLearningReport[]> {
	const byId = new Map<string, NormalizedSoftwareLearningReport[]>();
	for (const report of reports) {
		const bucket = byId.get(report.report_id);
		if (bucket) bucket.push(report);
		else byId.set(report.report_id, [report]);
	}
	return byId;
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

function reportRef(reportId: string): string {
	return `report:${reportId}`;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
	return [...new Set(values)].sort();
}
