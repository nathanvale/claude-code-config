import { afterEach, describe, expect, test } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	describeCliProcessRun,
	parseCliProcessJson,
	runCliProcess,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";
import {
	skillFeedbackBranchStationCatalog,
} from "./branch-station-catalog";
import {
	type SkillFeedbackBranchStationEvidence,
	listMissingSkillFeedbackBranchStationEvidence,
	projectSkillFeedbackBranchStationEvidence,
} from "./branch-station-evidence";
import {
	type CloseoutReceipt,
	SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
	SKILL_FEEDBACK_PURGE_CONTRACT_ID,
	createCorrelationWitness,
	createWriterProof,
} from "./command-contract";

const RUNNER_PATH = new URL("./skill-feedback-runner.ts", import.meta.url)
	.pathname;
const PACKAGE_ROOT = new URL("..", import.meta.url).pathname;
const GENERATED_TS = "2026-06-11T09:00:00.000Z";
const cleanupPaths: string[] = [];

type SkillFeedbackStationId =
	(typeof skillFeedbackBranchStationCatalog)[number]["id"];

type RuntimeEnvelope = {
	status?: "ok" | "error";
	data?: Record<string, unknown>;
	error?: { code?: string };
};

type StationScenario = {
	run: (station: (typeof skillFeedbackBranchStationCatalog)[number]) => Promise<SkillFeedbackBranchStationEvidence>;
};

const BASE_CLOSEOUT: CloseoutReceipt = {
	skill: "create-skill",
	outcome: "confirmed",
	goal: "Exercise the station map integration path.",
	friction: {
		category: "none",
		note: "Clean integration probe.",
	},
	verification_burden: {
		level: "light",
		note: "Process-boundary assertion.",
	},
	touched_surfaces: [{ type: "path", value: "skills/create-skill/SKILL.md" }],
	observations: [],
};

const stationScenarios = {
	"record.success": { run: runRecordSuccess },
	"record.proof_attached": { run: runRecordProofAttached },
	"record.proof_unavailable": { run: runRecordProofUnavailable },
	"record.invalid_usage": { run: runRecordInvalidUsage },
	"closeout.success_stdin": { run: runCloseoutSuccessStdin },
	"closeout.proof_attached": { run: runCloseoutProofAttached },
	"closeout.proof_unavailable": { run: runCloseoutProofUnavailable },
	"closeout.invalid_receipt": { run: runCloseoutInvalidReceipt },
	"review.empty_inbox": { run: runReviewEmptyInbox },
	"review.target_resolution_failed": { run: runReviewTargetResolutionFailed },
	"health.populated_inbox": { run: runHealthPopulatedInbox },
	"health.proof_diagnostics": { run: runHealthProofDiagnostics },
	"health.correlation_witness_diagnostics": {
		run: runHealthCorrelationWitnessDiagnostics,
	},
	"health.unsafe_inbox": { run: runHealthUnsafeInbox },
	"purge.preview": { run: runPurgePreview },
	"purge.execute": { run: runPurgeExecute },
	"purge.invalid_usage": { run: runPurgeInvalidUsage },
	"correlate.preview_repairable": { run: runCorrelatePreviewRepairable },
	"correlate.execute_written": { run: runCorrelateExecuteWritten },
	"correlate.already_linked": { run: runCorrelateAlreadyLinked },
	"correlate.ambiguous": { run: runCorrelateAmbiguous },
	"correlate.insufficient_evidence": { run: runCorrelateInsufficientEvidence },
	"correlate.unsafe_inbox": { run: runCorrelateUnsafeInbox },
	"correlate.invalid_usage": { run: runCorrelateInvalidUsage },
} satisfies Record<SkillFeedbackStationId, StationScenario>;

afterEach(async () => {
	const paths = cleanupPaths.splice(0);
	await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
});

describe("skill-feedback Branch Station integration", () => {
	test("every catalog station has a process-boundary scenario row", () => {
		expect(Object.keys(stationScenarios).sort()).toEqual(
			skillFeedbackBranchStationCatalog.map((station) => station.id).sort(),
		);
	});

	test("catalog-driven process-boundary rows cover required stations", async () => {
		const evidence: SkillFeedbackBranchStationEvidence[] = [];

		for (const station of skillFeedbackBranchStationCatalog) {
			const scenario = stationScenarios[station.id];
			evidence.push(await scenario.run(station));
		}

		expect(listMissingSkillFeedbackBranchStationEvidence(evidence)).toEqual([]);
		const stationMap = projectSkillFeedbackBranchStationEvidence(evidence);
		expect(stationMap.drift).toEqual([]);
		expect(stationMap.findings).toEqual([]);
		expect(
			stationMap.stations.map((station) => [
				station.station_id,
				station.evidence.status,
			]),
		).toEqual(
			[...skillFeedbackBranchStationCatalog]
				.sort((left, right) => left.id.localeCompare(right.id))
				.map((station) => [station.id, "covered"]),
		);
	});

	test("shared process JSON parse failures include process context", async () => {
		const result = await runSkillFeedback(["--help"], {
			label: "skill-feedback help non-json",
		});

		expect(() => parseCliProcessJson(result)).toThrow(
			/label=skill-feedback help non-json[\s\S]*argv=[\s\S]*stdout=/,
		);
	});
});

async function runRecordSuccess(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	const result = await runSkillFeedback(
		[
			"record",
			"--skill",
			"create-skill",
			"--goal",
			"Record integration station.",
			"--outcome",
			"confirmed",
			"--friction",
			"Clean run.",
			"--generated-ts",
			GENERATED_TS,
			"--explanation",
			"Process evidence.",
		],
		{ cwd: root, label: station.id },
	);
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data?.skill, describeCliProcessRun(result)).toBe("create-skill");
	expect(await listInboxJsonFiles(root)).toHaveLength(1);
	return evidenceFor(station, result, envelope);
}

async function runRecordProofAttached(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	const result = await runSkillFeedback(
		[
			"record",
			"--skill",
			"create-skill",
			"--goal",
			"Record proof station.",
			"--outcome",
			"confirmed",
			"--friction",
			"Clean run.",
			"--generated-ts",
			GENERATED_TS,
		],
		{ cwd: root, label: station.id },
	);
	const envelope = expectStationEnvelope(station, result);
	const report = await readOnlyInboxReport(root);
	expect(report.writer_proof).toMatchObject({ algorithm: "hmac-sha256" });
	expect(envelope.data?.writer_proof).toMatchObject({ algorithm: "hmac-sha256" });
	expect(envelope.data?.proof_status).toBe("attached");
	expect(envelope.data?.proof_diagnostics).toEqual([]);
	return evidenceFor(station, result, envelope);
}

async function runRecordProofUnavailable(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await writeUnusableTrustKey(root);
	const result = await runSkillFeedback(
		[
			"record",
			"--skill",
			"create-skill",
			"--goal",
			"Record proof unavailable station.",
			"--outcome",
			"confirmed",
			"--friction",
			"Clean run.",
			"--generated-ts",
			GENERATED_TS,
		],
		{ cwd: root, label: station.id },
	);
	const envelope = expectStationEnvelope(station, result);
	const report = await readOnlyInboxReport(root);
	expect(report.writer_proof).toBeUndefined();
	expect(envelope.data?.writer_proof).toBeUndefined();
	expect(envelope.data?.proof_status).toBe("unavailable");
	expect(envelope.data?.proof_diagnostics).toEqual(["trust_store_key_unusable"]);
	return evidenceFor(station, result, envelope);
}

async function runRecordInvalidUsage(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	const result = await runSkillFeedback(["record", "--skill", "create-skill"], {
		cwd: root,
		label: station.id,
	});
	const envelope = expectStationEnvelope(station, result);
	expect(await listInboxJsonFiles(root)).toEqual([]);
	return evidenceFor(station, result, envelope);
}

async function runCloseoutSuccessStdin(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	const result = await runSkillFeedback(["closeout"], {
		cwd: root,
		label: station.id,
		stdin: `${JSON.stringify(BASE_CLOSEOUT)}\n`,
	});
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data?.contract, describeCliProcessRun(result)).toBe(
		SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
	);
	const writtenPath = envelope.data?.written_path;
	expect(typeof writtenPath, describeCliProcessRun(result)).toBe("string");
	expect((await stat(join(root, writtenPath as string))).isFile()).toBe(true);
	return evidenceFor(station, result, envelope);
}

async function runCloseoutProofAttached(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	const result = await runSkillFeedback(["closeout"], {
		cwd: root,
		label: station.id,
		stdin: `${JSON.stringify(BASE_CLOSEOUT)}\n`,
	});
	const envelope = expectStationEnvelope(station, result);
	const report = await readOnlyInboxReport(root);
	expect(report.writer_proof).toMatchObject({ algorithm: "hmac-sha256" });
	expect(report.skill_run_id_provenance).toBeUndefined();
	expect(envelope.data?.proof_status).toBe("attached");
	expect(envelope.data?.proof_diagnostics).toEqual([]);
	return evidenceFor(station, result, envelope);
}

async function runCloseoutProofUnavailable(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await writeUnusableTrustKey(root);
	const result = await runSkillFeedback(["closeout"], {
		cwd: root,
		label: station.id,
		stdin: `${JSON.stringify(BASE_CLOSEOUT)}\n`,
	});
	const envelope = expectStationEnvelope(station, result);
	const report = await readOnlyInboxReport(root);
	expect(report.writer_proof).toBeUndefined();
	expect(envelope.data?.proof_status).toBe("unavailable");
	expect(envelope.data?.proof_diagnostics).toEqual(["trust_store_key_unusable"]);
	return evidenceFor(station, result, envelope);
}

async function runCloseoutInvalidReceipt(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	const result = await runSkillFeedback(["closeout"], {
		cwd: root,
		label: station.id,
		stdin: "[]\n",
	});
	const envelope = expectStationEnvelope(station, result);
	expect(await listInboxJsonFiles(root)).toEqual([]);
	return evidenceFor(station, result, envelope);
}

async function runReviewEmptyInbox(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await mkdir(join(root, ".skill-feedback"), { recursive: true });
	const result = await runSkillFeedback(["review"], { cwd: root, label: station.id });
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data?.coverage).toMatchObject({ total_reports: 0 });
	expect(envelope.data?.inbox_status).toBe("empty");
	return evidenceFor(station, result, envelope);
}

async function runReviewTargetResolutionFailed(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const nonRepo = await makeRoot();
	const result = await runSkillFeedback(["review", "--repo", nonRepo], {
		label: station.id,
	});
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data?.read_target_failure).toMatchObject({
		explicit: true,
		target_path: nonRepo,
	});
	return evidenceFor(station, result, envelope);
}

async function runHealthPopulatedInbox(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await writeInboxReport(
		root,
		"populated.json",
		v1CloseoutReport("report-health-populated", GENERATED_TS),
	);
	const result = await runSkillFeedback(["health"], { cwd: root, label: station.id });
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data?.inbox_status).toBe("populated");
	expect(envelope.data?.counts).toMatchObject({ primary: 1 });
	return evidenceFor(station, result, envelope);
}

async function runHealthProofDiagnostics(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await runSkillFeedback(
		[
			"record",
			"--skill",
			"create-skill",
			"--goal",
			"Health proof diagnostics station.",
			"--outcome",
			"confirmed",
			"--friction",
			"Clean run.",
			"--generated-ts",
			GENERATED_TS,
		],
		{ cwd: root, label: `${station.id}:setup` },
	);
	await writeFile(join(root, ".skill-feedback", ".trust", "key"), "bad\n");
	await chmod(join(root, ".skill-feedback", ".trust", "key"), 0o600);
	const result = await runSkillFeedback(["health"], { cwd: root, label: station.id });
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data?.proof_health).toMatchObject({
		verified_count: 0,
		evidence_only_count: 1,
	});
	expect(
		(envelope.data?.proof_health as { diagnostics?: string[] }).diagnostics,
	).toContain("trust_store_key_unusable");
	return evidenceFor(station, result, envelope);
}

async function runHealthCorrelationWitnessDiagnostics(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await runSkillFeedback(
		[
			"record",
			"--skill",
			"create-skill",
			"--goal",
			"Health witness diagnostics station.",
			"--outcome",
			"confirmed",
			"--friction",
			"Clean run.",
			"--generated-ts",
			GENERATED_TS,
		],
		{ cwd: root, label: `${station.id}:setup` },
	);
	const key = Buffer.from(
		(await readFile(join(root, ".skill-feedback", ".trust", "key"), "utf8")).trim(),
		"hex",
	);
	const witness = createCorrelationWitness(
		{
			skill: "create-skill",
			runtime_source: "claude_stop",
			hook_report_id: "hook_missing",
			closeout_report_id: "closeout_missing",
			skill_run_id: "run-missing",
			created_ts: GENERATED_TS,
		},
		key,
		"aa".repeat(16),
	);
	const witnessDir = join(root, ".skill-feedback", ".correlation");
	await mkdir(witnessDir, { recursive: true, mode: 0o700 });
	await chmod(witnessDir, 0o700);
	const witnessPath = join(witnessDir, `${witness.witness_id}.json`);
	await writeFile(witnessPath, `${JSON.stringify(witness, null, "\t")}\n`);
	await chmod(witnessPath, 0o600);

	const result = await runSkillFeedback(["health"], { cwd: root, label: station.id });
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data?.correlation_witnesses).toMatchObject({
		verified_count: 0,
		blocked_count: 1,
		orphan_count: 1,
	});
	expect(
		(envelope.data?.correlation_witnesses as { diagnostics?: string[] })
			.diagnostics,
	).toContain("correlation_witness_orphan_report");
	return evidenceFor(station, result, envelope);
}

async function runHealthUnsafeInbox(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	const outside = await makeRoot();
	await symlink(outside, join(root, ".skill-feedback"));
	const result = await runSkillFeedback(["health"], { cwd: root, label: station.id });
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data?.inbox_status).toBe("unsafe");
	return evidenceFor(station, result, envelope);
}

async function runPurgePreview(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await writePurgeReports(root);
	const result = await runSkillFeedback(["purge", "--keep-latest", "1"], {
		cwd: root,
		label: station.id,
	});
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data).toMatchObject({
		contract: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
		mode: "preview",
		candidate_count: 1,
		deleted_count: 0,
	});
	expect(await listInboxJsonFiles(root)).toHaveLength(2);
	return evidenceFor(station, result, envelope);
}

async function runPurgeExecute(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await writePurgeReports(root);
	const result = await runSkillFeedback(
		["purge", "--keep-latest", "1", "--execute"],
		{ cwd: root, label: station.id },
	);
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data).toMatchObject({
		contract: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
		mode: "execute",
		candidate_count: 1,
		deleted_count: 1,
	});
	expect(await listInboxJsonFiles(root)).toHaveLength(1);
	return evidenceFor(station, result, envelope);
}

async function runPurgeInvalidUsage(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await writePurgeReports(root);
	const result = await runSkillFeedback(["purge", "--execute"], {
		cwd: root,
		label: station.id,
	});
	const envelope = expectStationEnvelope(station, result);
	expect(await listInboxJsonFiles(root)).toHaveLength(2);
	return evidenceFor(station, result, envelope);
}

async function runCorrelatePreviewRepairable(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const setup = await writeRepairableCorrelationFixture("preview");
	const result = await runSkillFeedback(["correlate"], {
		cwd: setup.root,
		label: station.id,
	});
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data).toMatchObject({
		mode: "preview",
		counts: { repairable_count: 1, written_count: 0 },
	});
	expect(await listCorrelationWitnessFiles(setup.root)).toEqual([]);
	return evidenceFor(station, result, envelope);
}

async function runCorrelateExecuteWritten(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const setup = await writeRepairableCorrelationFixture("execute");
	const result = await runSkillFeedback(["correlate", "--execute"], {
		cwd: setup.root,
		label: station.id,
	});
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data).toMatchObject({
		mode: "execute",
		counts: { repairable_count: 1, written_count: 1 },
	});
	expect(await listCorrelationWitnessFiles(setup.root)).toHaveLength(1);
	return evidenceFor(station, result, envelope);
}

async function runCorrelateAlreadyLinked(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const setup = await writeRepairableCorrelationFixture("linked");
	await runSkillFeedback(["correlate", "--execute"], {
		cwd: setup.root,
		label: `${station.id}:setup`,
	});
	const result = await runSkillFeedback(["correlate", "--execute"], {
		cwd: setup.root,
		label: station.id,
	});
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data).toMatchObject({
		mode: "execute",
		counts: { already_linked_count: 1, written_count: 0 },
	});
	expect(await listCorrelationWitnessFiles(setup.root)).toHaveLength(1);
	return evidenceFor(station, result, envelope);
}

async function runCorrelateAmbiguous(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const setup = await writeAmbiguousCorrelationFixture();
	const result = await runSkillFeedback(["correlate"], {
		cwd: setup.root,
		label: station.id,
	});
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data).toMatchObject({
		mode: "preview",
		counts: { ambiguous_count: 1, repairable_count: 0 },
	});
	expect(await listCorrelationWitnessFiles(setup.root)).toEqual([]);
	return evidenceFor(station, result, envelope);
}

async function runCorrelateInsufficientEvidence(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const setup = await writeInsufficientCorrelationFixture();
	const result = await runSkillFeedback(["correlate"], {
		cwd: setup.root,
		label: station.id,
	});
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data).toMatchObject({
		mode: "preview",
		counts: { insufficient_evidence_count: 1, repairable_count: 0 },
		next_action: { action_id: "no_repair_available" },
	});
	return evidenceFor(station, result, envelope);
}

async function runCorrelateUnsafeInbox(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await mkdir(join(root, ".skill-feedback"), { recursive: true });
	await chmod(join(root, ".skill-feedback"), 0o700);
	const outside = await makeRoot();
	await symlink(outside, join(root, ".skill-feedback", ".correlation"));
	const result = await runSkillFeedback(["correlate"], {
		cwd: root,
		label: station.id,
	});
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data).toMatchObject({
		changed_state: "none",
		diagnostics: ["correlation_witness_dir_unsafe"],
	});
	return evidenceFor(station, result, envelope);
}

async function runCorrelateInvalidUsage(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	const result = await runSkillFeedback(["correlate", "--hook-report-id", "x"], {
		cwd: root,
		label: station.id,
	});
	const envelope = expectStationEnvelope(station, result);
	expect(envelope.data).toMatchObject({ changed_state: "none" });
	return evidenceFor(station, result, envelope);
}

async function runSkillFeedback(
	args: readonly string[],
	options: { cwd?: string; stdin?: string; label: string },
): Promise<CliProcessResult> {
	return runCliProcess({
		label: options.label,
		argv: [process.execPath, RUNNER_PATH, ...args],
		cwd: options.cwd ?? PACKAGE_ROOT,
		stdin: options.stdin,
		timeoutMs: 8_000,
	});
}

function expectStationEnvelope(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
	result: CliProcessResult,
): RuntimeEnvelope {
	expect(result.exitCode, describeCliProcessRun(result)).toBe(
		station.expectedExitCode,
	);
	const envelope = parseCliProcessJson<RuntimeEnvelope>(result);
	expect(envelope.status, describeCliProcessRun(result)).toBe(
		station.expectedEnvelopeStatus,
	);
	const observedContract = observedResultContractId(envelope);
	expect(observedContract, describeCliProcessRun(result)).toBe(
		station.expectedResultContractId,
	);
	const expectedErrorCode =
		"expectedErrorCode" in station ? station.expectedErrorCode : undefined;
	if (expectedErrorCode) {
		expect(envelope.error?.code, describeCliProcessRun(result)).toBe(
			expectedErrorCode,
		);
	}
	return envelope;
}

function evidenceFor(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
	result: CliProcessResult,
	envelope: RuntimeEnvelope,
): SkillFeedbackBranchStationEvidence {
	return {
		stationId: station.id,
		status: "covered",
		observedExitCode: result.exitCode ?? undefined,
		observedEnvelopeStatus: envelope.status,
		observedResultContractId: observedResultContractId(envelope),
		...(envelope.error?.code ? { observedErrorCode: envelope.error.code } : {}),
	};
}

function observedResultContractId(
	envelope: RuntimeEnvelope,
): string | undefined {
	const dataContract = envelope.data?.contract ?? envelope.data?.contract_id;
	if (typeof dataContract === "string") return dataContract;
	return undefined;
}

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "skill-feedback-integration-"));
	cleanupPaths.push(root);
	return root;
}

async function makeIgnoredGitRoot(): Promise<string> {
	const root = await makeRoot();
	await runSetup(["git", "init"], root);
	await writeFile(join(root, ".gitignore"), ".skill-feedback/\n", "utf8");
	return root;
}

async function runSetup(argv: readonly string[], cwd: string): Promise<void> {
	const result = await runCliProcess({
		label: argv.join(" "),
		argv,
		cwd,
		timeoutMs: 5_000,
	});
	if (result.exitCode !== 0) {
		throw new Error(`Setup command failed:\n${describeCliProcessRun(result)}`);
	}
}

async function writeInboxReport(
	root: string,
	name: string,
	value: unknown,
): Promise<void> {
	const inbox = join(root, ".skill-feedback");
	await mkdir(inbox, { recursive: true });
	await writeFile(join(inbox, name), `${JSON.stringify(value, null, "\t")}\n`);
}

async function readOnlyInboxReport(root: string): Promise<Record<string, unknown>> {
	const reports = await listInboxJsonFiles(root);
	expect(reports).toHaveLength(1);
	return JSON.parse(
		await readFile(join(root, ".skill-feedback", reports[0] ?? ""), "utf8"),
	) as Record<string, unknown>;
}

async function writeUnusableTrustKey(root: string): Promise<void> {
	const trustDir = join(root, ".skill-feedback", ".trust");
	await mkdir(trustDir, { recursive: true, mode: 0o700 });
	await chmod(join(root, ".skill-feedback"), 0o700);
	await chmod(trustDir, 0o700);
	const keyPath = join(trustDir, "key");
	await writeFile(keyPath, "bad\n");
	await chmod(keyPath, 0o600);
}

async function writePurgeReports(root: string): Promise<void> {
	await writeInboxReport(
		root,
		"old.json",
		v1CloseoutReport("report-old", "2026-05-01T00:00:00.000Z"),
	);
	await writeInboxReport(
		root,
		"new.json",
		v1CloseoutReport("report-new", "2026-06-01T00:00:00.000Z"),
	);
}

async function writeRepairableCorrelationFixture(suffix: string): Promise<{
	root: string;
	hookReportId: string;
	closeoutReportId: string;
}> {
	const root = await makeIgnoredGitRoot();
	const key = await writeTrustKey(root);
	const hook = await writeSignedCorrelationReport(root, {
		fileName: `hook-${suffix}.json`,
		key,
		nonce: `${suffix.length}`.repeat(32).slice(0, 32).padEnd(32, "1"),
		reportId: `report-hook-${suffix}`,
		evidenceSource: "hook_capture",
		captureRuntime: "claude_stop",
		skillRunId: `run-${suffix}`,
		skillRunIdProvenance: "runtime_owned",
	});
	const closeout = await writeSignedCorrelationReport(root, {
		fileName: `closeout-${suffix}.json`,
		key,
		nonce: `${suffix.length + 1}`.repeat(32).slice(0, 32).padEnd(32, "2"),
		reportId: `report-closeout-${suffix}`,
		evidenceSource: "driver_closeout",
	});
	await writeCorrelationDiagnostic(root, `diagnostic_${"a".repeat(16)}.json`, {
		schema_version: "1",
		kind: "correlation_diagnostic",
		created_ts: GENERATED_TS,
		skill: "create-skill",
		hook_report_id: hook.reportId,
		diagnostics: ["correlation_candidate_missing"],
		repair_candidates: [
			{
				source: "correlation_finalizer",
				skill: "create-skill",
				hook_report_id: hook.reportId,
				hook_written_path: hook.relativePath,
				closeout_report_id: closeout.reportId,
				closeout_written_path: closeout.relativePath,
				closeout_proof_status: "attached",
				skill_run_id: `run-${suffix}`,
			},
		],
	});
	return {
		root,
		hookReportId: hook.reportId,
		closeoutReportId: closeout.reportId,
	};
}

async function writeAmbiguousCorrelationFixture(): Promise<{ root: string }> {
	const setup = await writeRepairableCorrelationFixture("ambiguous");
	await rm(
		join(
			setup.root,
			".skill-feedback",
			".correlation",
			`diagnostic_${"a".repeat(16)}.json`,
		),
	);
	const key = await readTrustKey(setup.root);
	const second = await writeSignedCorrelationReport(setup.root, {
		fileName: "closeout-ambiguous-two.json",
		key,
		nonce: "3".repeat(32),
		reportId: "report-closeout-ambiguous-two",
		evidenceSource: "driver_closeout",
	});
	await writeCorrelationDiagnostic(setup.root, `diagnostic_${"b".repeat(16)}.json`, {
		schema_version: "1",
		kind: "correlation_diagnostic",
		created_ts: GENERATED_TS,
		skill: "create-skill",
		hook_report_id: setup.hookReportId,
		diagnostics: ["correlation_candidate_missing"],
		repair_candidates: [
			{
				source: "correlation_finalizer",
				skill: "create-skill",
				hook_report_id: setup.hookReportId,
				hook_written_path: ".skill-feedback/hook-ambiguous.json",
				closeout_report_id: setup.closeoutReportId,
				closeout_written_path: ".skill-feedback/closeout-ambiguous.json",
				closeout_proof_status: "attached",
				skill_run_id: "run-ambiguous",
			},
			{
				source: "correlation_finalizer",
				skill: "create-skill",
				hook_report_id: setup.hookReportId,
				hook_written_path: ".skill-feedback/hook-ambiguous.json",
				closeout_report_id: second.reportId,
				closeout_written_path: second.relativePath,
				closeout_proof_status: "attached",
				skill_run_id: "run-ambiguous",
			},
		],
	});
	return { root: setup.root };
}

async function writeInsufficientCorrelationFixture(): Promise<{ root: string }> {
	const root = await makeIgnoredGitRoot();
	const key = await writeTrustKey(root);
	const hook = await writeSignedCorrelationReport(root, {
		fileName: "hook-insufficient.json",
		key,
		nonce: "4".repeat(32),
		reportId: "report-hook-insufficient",
		evidenceSource: "hook_capture",
		captureRuntime: "claude_stop",
		skillRunId: "run-insufficient",
		skillRunIdProvenance: "runtime_owned",
	});
	await writeCorrelationDiagnostic(root, `diagnostic_${"c".repeat(16)}.json`, {
		schema_version: "1",
		kind: "correlation_diagnostic",
		created_ts: GENERATED_TS,
		skill: "create-skill",
		hook_report_id: hook.reportId,
		diagnostics: ["correlation_candidate_missing"],
	});
	return { root };
}

async function writeTrustKey(root: string): Promise<Buffer> {
	const inbox = join(root, ".skill-feedback");
	const trustDir = join(inbox, ".trust");
	await mkdir(trustDir, { recursive: true, mode: 0o700 });
	await chmod(inbox, 0o700);
	await chmod(trustDir, 0o700);
	const key = Buffer.from("12".repeat(32), "hex");
	const keyPath = join(trustDir, "key");
	await writeFile(keyPath, `${key.toString("hex")}\n`);
	await chmod(keyPath, 0o600);
	return key;
}

async function readTrustKey(root: string): Promise<Buffer> {
	return Buffer.from(
		(await readFile(join(root, ".skill-feedback", ".trust", "key"), "utf8")).trim(),
		"hex",
	);
}

async function writeSignedCorrelationReport(
	root: string,
	input: {
		fileName: string;
		key: Buffer;
		nonce: string;
		reportId: string;
		evidenceSource: "hook_capture" | "driver_closeout";
		captureRuntime?: "claude_stop";
		skillRunId?: string;
		skillRunIdProvenance?: "runtime_owned";
	},
): Promise<{ reportId: string; relativePath: string }> {
	const relativePath = `.skill-feedback/${input.fileName}`;
	const report: Record<string, unknown> = {
		schema_version: "2",
		report_id: input.reportId,
		untrusted_evidence: true,
		generated_ts: GENERATED_TS,
		evidence_source: input.evidenceSource,
		...(input.captureRuntime ? { capture_runtime: input.captureRuntime } : {}),
		correlation_status: "unlinked",
		...(input.skillRunId ? { skill_run_id: input.skillRunId } : {}),
		...(input.skillRunIdProvenance
			? { skill_run_id_provenance: input.skillRunIdProvenance }
			: {}),
		runtime: { git_sha: "1234567890abcdef1234567890abcdef12345678" },
		report_card: BASE_CLOSEOUT,
		evidence_gaps: [],
		skill: "create-skill",
		redactions: 0,
	};
	const signed = {
		...report,
		writer_proof: createWriterProof(report, input.key, input.nonce),
	};
	await writeInboxReport(root, input.fileName, signed);
	await chmod(join(root, relativePath), 0o600);
	return { reportId: input.reportId, relativePath };
}

async function writeCorrelationDiagnostic(
	root: string,
	name: string,
	value: unknown,
): Promise<void> {
	const directory = join(root, ".skill-feedback", ".correlation");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const path = join(directory, name);
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`);
	await chmod(path, 0o600);
}

async function listCorrelationWitnessFiles(root: string): Promise<string[]> {
	try {
		const entries = await readdir(join(root, ".skill-feedback", ".correlation"));
		return entries.filter((entry) => entry.startsWith("witness_")).sort();
	} catch {
		return [];
	}
}

async function listInboxJsonFiles(root: string): Promise<string[]> {
	try {
		const entries = await readdir(join(root, ".skill-feedback"));
		return entries.filter((entry) => entry.endsWith(".json")).sort();
	} catch {
		return [];
	}
}

function v1CloseoutReport(reportId: string, generatedTs: string) {
	return {
		schema_version: "1",
		report_id: reportId,
		untrusted_evidence: true,
		generated_ts: generatedTs,
		evidence_source: "driver_closeout",
		correlation_status: "unlinked",
		runtime: { git_sha: "1234567890abcdef1234567890abcdef12345678" },
		report_card: BASE_CLOSEOUT,
		evidence_gaps: [],
	};
}
