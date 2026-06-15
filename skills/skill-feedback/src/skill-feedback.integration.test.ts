import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
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
	"record.invalid_usage": { run: runRecordInvalidUsage },
	"closeout.success_stdin": { run: runCloseoutSuccessStdin },
	"closeout.invalid_receipt": { run: runCloseoutInvalidReceipt },
	"review.empty_inbox": { run: runReviewEmptyInbox },
	"review.target_resolution_failed": { run: runReviewTargetResolutionFailed },
	"health.populated_inbox": { run: runHealthPopulatedInbox },
	"health.unsafe_inbox": { run: runHealthUnsafeInbox },
	"purge.preview": { run: runPurgePreview },
	"purge.execute": { run: runPurgeExecute },
	"purge.invalid_usage": { run: runPurgeInvalidUsage },
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
