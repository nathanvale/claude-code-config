// fallow-ignore-file unused-file, code-duplication, complexity
// Bun test entrypoint with process-boundary fixtures; package runner invokes this file without static imports.
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
	skillFeedbackBranchStationEvidence,
} from "./branch-station-evidence";
import {
	type CloseoutReceipt,
	SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
	SKILL_FEEDBACK_PURGE_CONTRACT_ID,
	SKILL_FEEDBACK_QUEUE_CONTRACT_ID,
	SKILL_FEEDBACK_REPORT_CONTRACT_ID,
	SKILL_FEEDBACK_REPORTS_CONTRACT_ID,
	SKILL_FEEDBACK_USAGE_CONTRACT_ID,
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
type SkillFeedbackBranchStation =
	(typeof skillFeedbackBranchStationCatalog)[number];

type RuntimeEnvelope = {
	status?: "ok" | "error";
	data?: Record<string, unknown>;
	error?: { code?: string };
};

type StationScenario = {
	run: (station: SkillFeedbackBranchStation) => Promise<SkillFeedbackBranchStationEvidence>;
};

type StationProbe = {
	root: string;
	result: CliProcessResult;
	envelope: RuntimeEnvelope;
};

type IgnoredGitStationOptions = {
	args: readonly string[];
	stdin?: string;
	label?: string;
	prepare?: (root: string) => Promise<void>;
	assert?: (probe: StationProbe) => Promise<void> | void;
};

type ExistingRootStationOptions = {
	root: string;
	args: readonly string[];
	label?: string;
	assert?: (probe: StationProbe) => Promise<void> | void;
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
	"dashboard.missing_inbox": { run: runDashboardMissingInbox },
	"dashboard.populated_inbox": { run: runDashboardPopulatedInbox },
	"dashboard.unsafe_inbox": { run: runDashboardUnsafeInbox },
	"reports.primary_recent": { run: runReportsPrimaryRecent },
	"reports.low_signal_opt_in": { run: runReportsLowSignalOptIn },
	"reports.empty_inbox": { run: runReportsEmptyInbox },
	"reports.invalid_usage": { run: runReportsInvalidUsage },
	"report.primary_detail": { run: runReportPrimaryDetail },
	"report.low_signal_requires_opt_in": { run: runReportLowSignalRequiresOptIn },
	"report.low_signal_detail_opt_in": { run: runReportLowSignalDetailOptIn },
	"report.unknown_ref": { run: runReportUnknownRef },
	"report.duplicate_ref": { run: runReportDuplicateRef },
	"report.cross_lane_duplicate_ref": { run: runReportCrossLaneDuplicateRef },
	"report.invalid_ref_path": { run: runReportInvalidRefPath },
	"report.invalid_usage": { run: runReportInvalidUsage },
	"usage.skill_ranking": { run: runUsageSkillRanking },
	"usage.separates_low_signal": { run: runUsageSeparatesLowSignal },
	"usage.empty_inbox": { run: runUsageEmptyInbox },
	"usage.invalid_usage": { run: runUsageInvalidUsage },
	"queue.owner_path_strong": { run: runQueueOwnerPathStrong },
	"queue.skill_fallback": { run: runQueueSkillFallback },
	"queue.skill_filter_fallback": { run: runQueueSkillFilterFallback },
	"queue.weak_requires_opt_in": { run: runQueueWeakRequiresOptIn },
	"queue.weak_opt_in": { run: runQueueWeakOptIn },
	"queue.no_build": { run: runQueueNoBuild },
	"queue.empty_inbox": { run: runQueueEmptyInbox },
	"queue.invalid_usage": { run: runQueueInvalidUsage },
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
		expect(evidence).toEqual(skillFeedbackBranchStationEvidence);
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
	}, 15_000);

	test("shared process JSON parse failures include process context", async () => {
		const result = await runSkillFeedback(["--help"], {
			label: "skill-feedback help non-json",
		});

		expect(() => parseCliProcessJson(result)).toThrow(
			/label=skill-feedback help non-json[\s\S]*argv=[\s\S]*stdout=/,
		);
	});

	test("zero-arg front door renders the dashboard through the process boundary", async () => {
		const root = await makeIgnoredGitRoot();

		const result = await runSkillFeedback([], {
			cwd: root,
			label: "skill-feedback front-door dashboard",
		});

		expect(result.exitCode, describeCliProcessRun(result)).toBe(0);
		expect(result.stderr, describeCliProcessRun(result)).toBe("");
		expect(result.stdout).toContain("Skill Feedback");
		expect(result.stdout).toContain("Dashboard paths:");
		expect(result.stdout).toContain("Next Safe Actions:");
		expect(result.stdout).toContain("skill-feedback reports");
		expect(() => parseCliProcessJson(result)).toThrow();
		expect(await Bun.file(join(root, ".skill-feedback")).exists()).toBe(false);
	});
});

async function runRecordSuccess(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		args: [
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
		assert: async ({ root, result, envelope }) => {
			expect(envelope.data?.skill, describeCliProcessRun(result)).toBe(
				"create-skill",
			);
			expect(await listInboxJsonFiles(root)).toHaveLength(1);
		},
	});
}

async function runRecordProofAttached(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		args: [
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
		assert: async ({ root, envelope }) => {
			const report = await readOnlyInboxReport(root);
			expect(report.writer_proof).toMatchObject({ algorithm: "hmac-sha256" });
			expect(envelope.data?.writer_proof).toMatchObject({
				algorithm: "hmac-sha256",
			});
			expect(envelope.data?.proof_status).toBe("attached");
			expect(envelope.data?.proof_diagnostics).toEqual([]);
		},
	});
}

async function runRecordProofUnavailable(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: writeUnusableTrustKey,
		args: [
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
		assert: async ({ root, envelope }) => {
			const report = await readOnlyInboxReport(root);
			expect(report.writer_proof).toBeUndefined();
			expect(envelope.data?.writer_proof).toBeUndefined();
			expect(envelope.data?.proof_status).toBe("unavailable");
			expect(envelope.data?.proof_diagnostics).toEqual([
				"trust_store_key_unusable",
			]);
		},
	});
}

async function runRecordInvalidUsage(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		args: ["record", "--skill", "create-skill"],
		assert: async ({ root }) => {
			expect(await listInboxJsonFiles(root)).toEqual([]);
		},
	});
}

async function runCloseoutSuccessStdin(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		args: ["closeout"],
		stdin: `${JSON.stringify(BASE_CLOSEOUT)}\n`,
		assert: async ({ root, result, envelope }) => {
			expect(envelope.data?.contract, describeCliProcessRun(result)).toBe(
				SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
			);
			const writtenPath = envelope.data?.written_path;
			expect(typeof writtenPath, describeCliProcessRun(result)).toBe("string");
			expect((await stat(join(root, writtenPath as string))).isFile()).toBe(true);
		},
	});
}

async function runCloseoutProofAttached(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		args: ["closeout"],
		stdin: `${JSON.stringify(BASE_CLOSEOUT)}\n`,
		assert: async ({ root, envelope }) => {
			const report = await readOnlyInboxReport(root);
			expect(report.writer_proof).toMatchObject({ algorithm: "hmac-sha256" });
			expect(report.skill_run_id_provenance).toBeUndefined();
			expect(envelope.data?.proof_status).toBe("attached");
			expect(envelope.data?.proof_diagnostics).toEqual([]);
		},
	});
}

async function runCloseoutProofUnavailable(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: writeUnusableTrustKey,
		args: ["closeout"],
		stdin: `${JSON.stringify(BASE_CLOSEOUT)}\n`,
		assert: async ({ root, envelope }) => {
			const report = await readOnlyInboxReport(root);
			expect(report.writer_proof).toBeUndefined();
			expect(envelope.data?.proof_status).toBe("unavailable");
			expect(envelope.data?.proof_diagnostics).toEqual([
				"trust_store_key_unusable",
			]);
		},
	});
}

async function runCloseoutInvalidReceipt(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		args: ["closeout"],
		stdin: "[]\n",
		assert: async ({ root }) => {
			expect(await listInboxJsonFiles(root)).toEqual([]);
		},
	});
}

async function runDashboardMissingInbox(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	const result = await runSkillFeedback(["dashboard"], {
		cwd: root,
		label: station.id,
	});
	expectDashboardPlainResult(station, result);
	expect(result.stdout).toContain("Reports: primary=0 low-signal=0");
	expect(result.stdout).toContain("Dashboard paths:");
	expect(result.stdout).toContain("1. Browse recent reports - `skill-feedback reports`.");
	expect(() => parseCliProcessJson(result)).toThrow();
	expect(await Bun.file(join(root, ".skill-feedback")).exists()).toBe(false);
	return evidenceForPlain(station, result);
}

async function runDashboardPopulatedInbox(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await writeInboxReport(
		root,
		"dashboard-populated.json",
		v1CloseoutReport("report-dashboard-populated", GENERATED_TS),
	);
	const result = await runSkillFeedback(["dashboard"], {
		cwd: root,
		label: station.id,
	});
	expectDashboardPlainResult(station, result);
	expect(result.stdout).toContain("Reports: primary=1 low-signal=0");
	expect(result.stdout).toContain(
		"Open latest report - `skill-feedback report report:report-dashboard-populated`.",
	);
	expect(result.stdout).toContain("Recent:");
	expect(() => parseCliProcessJson(result)).toThrow();
	return evidenceForPlain(station, result);
}

async function runDashboardUnsafeInbox(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	const outside = await makeRoot();
	await symlink(outside, join(root, ".skill-feedback"));
	const result = await runSkillFeedback(["dashboard"], {
		cwd: root,
		label: station.id,
	});
	expectDashboardPlainResult(station, result);
	expect(result.stdout).toContain("Reports: primary=0 low-signal=0");
	expect(result.stdout).toContain("Signal: inbox is unsafe");
	expect(() => parseCliProcessJson(result)).toThrow();
	return evidenceForPlain(station, result);
}

async function runReportsPrimaryRecent(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeInboxReport(
				root,
				"older.json",
				v1HumanReport({ reportId: "report-older", generatedTs: "2026-06-01T00:00:00.000Z" }),
			);
			await writeInboxReport(
				root,
				"newer.json",
				v1HumanReport({ reportId: "report-newer", generatedTs: GENERATED_TS }),
			);
		},
		args: ["reports", "--json"],
		assert: ({ envelope }) => {
			expect(envelope.data?.contract).toBe(SKILL_FEEDBACK_REPORTS_CONTRACT_ID);
			const reports = (envelope.data?.reports as Array<{ report_ref: string }>);
			expect(reports.map((report) => report.report_ref)).toEqual([
				"report:report-newer",
				"report:report-older",
			]);
		},
	});
}

async function runReportsLowSignalOptIn(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeLowSignalInboxReport(
				root,
				"low.json",
				v1HumanReport({ reportId: "report-low-signal", generatedTs: GENERATED_TS }),
			);
		},
		args: ["reports", "--json", "--lane", "low-signal"],
		assert: ({ envelope }) => {
			const reports = envelope.data?.reports as Array<{
				lane: string;
				report_ref: string;
				detail_command: string;
			}>;
			expect(reports).toEqual([
				expect.objectContaining({
					lane: "low-signal",
					report_ref: "report:report-low-signal",
					detail_command:
						"skill-feedback report report:report-low-signal --low-signal",
				}),
			]);
		},
	});
}

async function runReportsEmptyInbox(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await mkdir(join(root, ".skill-feedback"), { recursive: true });
		},
		args: ["reports", "--json"],
		assert: ({ envelope }) => {
			expect(envelope.data?.reports).toEqual([]);
		},
	});
}

async function runReportsInvalidUsage(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		args: ["reports", "--lane", "archive"],
	});
}

async function runReportPrimaryDetail(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeInboxReport(
				root,
				"primary.json",
				v1HumanReport({ reportId: "report-primary", generatedTs: GENERATED_TS }),
			);
		},
		args: ["report", "report:report-primary", "--json"],
		assert: ({ envelope }) => {
			expect(envelope.data?.contract).toBe(SKILL_FEEDBACK_REPORT_CONTRACT_ID);
			expect(envelope.data).toMatchObject({
				report_ref: "report:report-primary",
				lane: "primary",
			});
		},
	});
}

async function runReportLowSignalRequiresOptIn(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeLowSignalInboxReport(
				root,
				"low.json",
				v1HumanReport({ reportId: "report-low-only", generatedTs: GENERATED_TS }),
			);
		},
		args: ["report", "report:report-low-only", "--json"],
	});
}

async function runReportLowSignalDetailOptIn(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeLowSignalInboxReport(
				root,
				"low.json",
				v1HumanReport({ reportId: "report-low-detail", generatedTs: GENERATED_TS }),
			);
		},
		args: ["report", "report:report-low-detail", "--json", "--low-signal"],
		assert: ({ envelope }) => {
			expect(envelope.data).toMatchObject({
				report_ref: "report:report-low-detail",
				lane: "low-signal",
			});
		},
	});
}

async function runReportUnknownRef(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		args: ["report", "report:missing", "--json"],
	});
}

async function runReportDuplicateRef(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeInboxReport(
				root,
				"dup-one.json",
				v1HumanReport({ reportId: "report-dup", generatedTs: GENERATED_TS }),
			);
			await writeInboxReport(
				root,
				"dup-two.json",
				v1HumanReport({ reportId: "report-dup", generatedTs: "2026-06-12T00:00:00.000Z" }),
			);
		},
		args: ["report", "report:report-dup", "--json"],
	});
}

async function runReportCrossLaneDuplicateRef(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeInboxReport(
				root,
				"primary.json",
				v1HumanReport({ reportId: "report-cross-dup", generatedTs: GENERATED_TS }),
			);
			await writeLowSignalInboxReport(
				root,
				"low.json",
				v1HumanReport({
					reportId: "report-cross-dup",
					generatedTs: "2026-06-12T00:00:00.000Z",
				}),
			);
		},
		args: ["report", "report:report-cross-dup", "--json"],
		assert: ({ envelope }) => {
			expect(envelope.error?.code).toBe("report_ref_duplicate");
		},
	});
}

async function runReportInvalidRefPath(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		args: ["report", "report:../outside", "--json"],
		assert: ({ envelope }) => {
			expect(envelope.error?.code).toBe("report_ref_invalid");
		},
	});
}

async function runReportInvalidUsage(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		args: ["report", "--json"],
	});
}

async function runUsageSkillRanking(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeInboxReport(root, "a1.json", v1HumanReport({ reportId: "a1", skill: "alpha", generatedTs: GENERATED_TS }));
			await writeInboxReport(root, "a2.json", v1HumanReport({ reportId: "a2", skill: "alpha", generatedTs: "2026-06-12T00:00:00.000Z" }));
			await writeInboxReport(root, "b1.json", v1HumanReport({ reportId: "b1", skill: "beta", generatedTs: "2026-06-11T00:00:00.000Z" }));
		},
		args: ["usage", "--json"],
		assert: ({ envelope }) => {
			expect(envelope.data?.contract).toBe(SKILL_FEEDBACK_USAGE_CONTRACT_ID);
			const skills = envelope.data?.skills as Array<{ skill: string; primary_count: number }>;
			expect(skills[0]).toMatchObject({ skill: "alpha", primary_count: 2 });
		},
	});
}

async function runUsageSeparatesLowSignal(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeInboxReport(root, "primary.json", v1HumanReport({ reportId: "primary", skill: "alpha", generatedTs: GENERATED_TS }));
			await writeLowSignalInboxReport(root, "low.json", v1HumanReport({ reportId: "low", skill: "alpha", generatedTs: "2026-06-12T00:00:00.000Z" }));
		},
		args: ["usage", "--json"],
		assert: ({ envelope }) => {
			const row = (envelope.data?.skills as Array<{ skill: string; primary_count: number; low_signal_count: number }>)[0];
			expect(row).toMatchObject({
				skill: "alpha",
				primary_count: 1,
				low_signal_count: 1,
			});
		},
	});
}

async function runUsageEmptyInbox(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await mkdir(join(root, ".skill-feedback"), { recursive: true });
		},
		args: ["usage", "--json"],
		assert: ({ envelope }) => {
			expect(envelope.data?.skills).toEqual([]);
		},
	});
}

async function runUsageInvalidUsage(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		args: ["usage", "--limit", "0"],
	});
}

async function runQueueOwnerPathStrong(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeInboxReport(
				root,
				"owner.json",
				v1HumanReport({
					reportId: "queue-owner",
					generatedTs: GENERATED_TS,
					verificationLevel: "heavy",
					touchedSurfaces: [{ type: "path", value: "skills/skill-feedback/SKILL.md" }],
				}),
			);
		},
		args: ["queue", "--json"],
		assert: ({ envelope }) => {
			expect(envelope.data?.contract).toBe(SKILL_FEEDBACK_QUEUE_CONTRACT_ID);
			const rows = envelope.data?.rows as Array<{ target: string; evidence_strength: string }>;
			expect(rows[0]).toMatchObject({
				target: "skills/skill-feedback/SKILL.md",
				evidence_strength: "strong",
			});
		},
	});
}

async function runQueueSkillFallback(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeInboxReport(root, "skill-a.json", v1HumanReport({ reportId: "skill-a", skill: "fallow", generatedTs: GENERATED_TS, touchedSurfaces: [] }));
			await writeInboxReport(root, "skill-b.json", v1HumanReport({ reportId: "skill-b", skill: "fallow", generatedTs: "2026-06-12T00:00:00.000Z", touchedSurfaces: [] }));
		},
		args: ["queue", "--json"],
		assert: ({ envelope }) => {
			const rows = envelope.data?.rows as Array<{ target_type: string; target: string }>;
			expect(rows[0]).toMatchObject({ target_type: "skill", target: "fallow" });
		},
	});
}

async function runQueueSkillFilterFallback(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeInboxReport(
				root,
				"owner.json",
				v1HumanReport({
					reportId: "owner",
					skill: "create-skill",
					generatedTs: GENERATED_TS,
					verificationLevel: "heavy",
					touchedSurfaces: [{ type: "path", value: "skills/create-skill/SKILL.md" }],
				}),
			);
			await writeInboxReport(root, "fallow-a.json", v1HumanReport({ reportId: "fallow-a", skill: "fallow", generatedTs: "2026-06-12T00:00:00.000Z", touchedSurfaces: [] }));
			await writeInboxReport(root, "fallow-b.json", v1HumanReport({ reportId: "fallow-b", skill: "fallow", generatedTs: "2026-06-13T00:00:00.000Z", touchedSurfaces: [] }));
		},
		args: ["queue", "--json", "--skill", "fallow"],
		assert: ({ envelope }) => {
			const rows = envelope.data?.rows as Array<{ target_type: string; target: string }>;
			expect(rows[0]).toMatchObject({ target_type: "skill", target: "fallow" });
			expect(envelope.data?.no_build).toBeUndefined();
		},
	});
}

async function runQueueWeakRequiresOptIn(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: writeWeakQueueFixture,
		args: ["queue", "--json"],
		assert: ({ envelope }) => {
			expect(envelope.data?.rows).toEqual([]);
			expect(
				(envelope.data?.counts as { weak_available_count?: number })
					.weak_available_count,
			).toBeGreaterThan(0);
		},
	});
}

async function runQueueWeakOptIn(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: writeWeakQueueFixture,
		args: ["queue", "--json", "--include-weak"],
		assert: ({ envelope }) => {
			const rows = envelope.data?.rows as Array<{
				evidence_strength: string;
				target_type: string;
				target: string;
			}>;
			expect(rows[0]).toMatchObject({
				evidence_strength: "weak",
				target_type: "owner_path",
				target: "skills/skill-feedback/SKILL.md",
			});
		},
	});
}

async function runQueueNoBuild(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeInboxReport(
				root,
				"single.json",
				v1HumanReport({ reportId: "single", generatedTs: GENERATED_TS, touchedSurfaces: [] }),
			);
		},
		args: ["queue", "--json"],
		assert: ({ envelope }) => {
			expect(envelope.data?.rows).toEqual([]);
			expect(envelope.data?.no_build).toBeDefined();
		},
	});
}

async function runQueueEmptyInbox(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await mkdir(join(root, ".skill-feedback"), { recursive: true });
		},
		args: ["queue", "--json"],
		assert: ({ envelope }) => {
			expect(envelope.data?.rows).toEqual([]);
		},
	});
}

async function runQueueInvalidUsage(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		args: ["queue", "--limit", "0"],
	});
}

async function runReviewEmptyInbox(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await mkdir(join(root, ".skill-feedback"), { recursive: true });
		},
		args: ["review"],
		assert: ({ envelope }) => {
			expect(envelope.data?.coverage).toMatchObject({ total_reports: 0 });
			expect(envelope.data?.inbox_status).toBe("empty");
		},
	});
}

async function runReviewTargetResolutionFailed(
	station: SkillFeedbackBranchStation,
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
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await writeInboxReport(
				root,
				"populated.json",
				v1CloseoutReport("report-health-populated", GENERATED_TS),
			);
		},
		args: ["health"],
		assert: ({ envelope }) => {
			expect(envelope.data?.inbox_status).toBe("populated");
			expect(envelope.data?.counts).toMatchObject({ primary: 1 });
		},
	});
}

async function runHealthProofDiagnostics(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			await runRecordFixture(root, `${station.id}:setup`, {
				goal: "Health proof diagnostics station.",
			});
			await writeFile(join(root, ".skill-feedback", ".trust", "key"), "bad\n");
			await chmod(join(root, ".skill-feedback", ".trust", "key"), 0o600);
		},
		args: ["health"],
		assert: ({ envelope }) => {
			expect(envelope.data?.proof_health).toMatchObject({
				verified_count: 0,
				evidence_only_count: 1,
			});
			expect(
				(envelope.data?.proof_health as { diagnostics?: string[] }).diagnostics,
			).toContain("trust_store_key_unusable");
		},
	});
}

async function runHealthCorrelationWitnessDiagnostics(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await runRecordFixture(root, `${station.id}:setup`, {
		goal: "Health witness diagnostics station.",
	});
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
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: async (root) => {
			const outside = await makeRoot();
			await symlink(outside, join(root, ".skill-feedback"));
		},
		args: ["health"],
		assert: ({ envelope }) => {
			expect(envelope.data?.inbox_status).toBe("unsafe");
		},
	});
}

async function runPurgePreview(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: writePurgeReports,
		args: ["purge", "--keep-latest", "1"],
		assert: async ({ root, envelope }) => {
			expect(envelope.data).toMatchObject({
				contract: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
				mode: "preview",
				candidate_count: 1,
				deleted_count: 0,
			});
			expect(await listInboxJsonFiles(root)).toHaveLength(2);
		},
	});
}

async function runPurgeExecute(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: writePurgeReports,
		args: ["purge", "--keep-latest", "1", "--execute"],
		assert: async ({ root, envelope }) => {
			expect(envelope.data).toMatchObject({
				contract: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
				mode: "execute",
				candidate_count: 1,
				deleted_count: 1,
			});
			expect(await listInboxJsonFiles(root)).toHaveLength(1);
		},
	});
}

async function runPurgeInvalidUsage(
	station: SkillFeedbackBranchStation,
): Promise<SkillFeedbackBranchStationEvidence> {
	return coverIgnoredGitStation(station, {
		prepare: writePurgeReports,
		args: ["purge", "--execute"],
		assert: async ({ root }) => {
			expect(await listInboxJsonFiles(root)).toHaveLength(2);
		},
	});
}

async function runCorrelatePreviewRepairable(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const setup = await writeRepairableCorrelationFixture("preview");
	return coverExistingRootStation(station, {
		root: setup.root,
		args: ["correlate"],
		assert: async ({ root, envelope }) => {
			expect(envelope.data).toMatchObject({
				mode: "preview",
				counts: { repairable_count: 1, written_count: 0 },
			});
			expect(await listCorrelationWitnessFiles(root)).toEqual([]);
		},
	});
}

async function runCorrelateExecuteWritten(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const setup = await writeRepairableCorrelationFixture("execute");
	return coverExistingRootStation(station, {
		root: setup.root,
		args: ["correlate", "--execute"],
		assert: async ({ root, envelope }) => {
			expect(envelope.data).toMatchObject({
				mode: "execute",
				counts: { repairable_count: 1, written_count: 1 },
			});
			expect(await listCorrelationWitnessFiles(root)).toHaveLength(1);
		},
	});
}

async function runCorrelateAlreadyLinked(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const setup = await writeRepairableCorrelationFixture("linked");
	await runSkillFeedback(["correlate", "--execute"], {
		cwd: setup.root,
		label: `${station.id}:setup`,
	});
	return coverExistingRootStation(station, {
		root: setup.root,
		args: ["correlate", "--execute"],
		assert: async ({ root, envelope }) => {
			expect(envelope.data).toMatchObject({
				mode: "execute",
				counts: { already_linked_count: 1, written_count: 0 },
			});
			expect(await listCorrelationWitnessFiles(root)).toHaveLength(1);
		},
	});
}

async function runCorrelateAmbiguous(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const setup = await writeAmbiguousCorrelationFixture();
	return coverExistingRootStation(station, {
		root: setup.root,
		args: ["correlate"],
		assert: async ({ root, envelope }) => {
			expect(envelope.data).toMatchObject({
				mode: "preview",
				counts: { ambiguous_count: 1, repairable_count: 0 },
			});
			expect(await listCorrelationWitnessFiles(root)).toEqual([]);
		},
	});
}

async function runCorrelateInsufficientEvidence(
	station: (typeof skillFeedbackBranchStationCatalog)[number],
): Promise<SkillFeedbackBranchStationEvidence> {
	const setup = await writeInsufficientCorrelationFixture();
	return coverExistingRootStation(station, {
		root: setup.root,
		args: ["correlate"],
		assert: ({ envelope }) => {
			expect(envelope.data).toMatchObject({
				mode: "preview",
				counts: { insufficient_evidence_count: 1, repairable_count: 0 },
				next_action: { action_id: "no_repair_available" },
			});
		},
	});
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

async function coverIgnoredGitStation(
	station: SkillFeedbackBranchStation,
	options: IgnoredGitStationOptions,
): Promise<SkillFeedbackBranchStationEvidence> {
	const root = await makeIgnoredGitRoot();
	await options.prepare?.(root);
	const result = await runSkillFeedback(options.args, {
		cwd: root,
		label: options.label ?? station.id,
		stdin: options.stdin,
	});
	const envelope = expectStationEnvelope(station, result);
	await options.assert?.({ root, result, envelope });
	return evidenceFor(station, result, envelope);
}

async function coverExistingRootStation(
	station: SkillFeedbackBranchStation,
	options: ExistingRootStationOptions,
): Promise<SkillFeedbackBranchStationEvidence> {
	const result = await runSkillFeedback(options.args, {
		cwd: options.root,
		label: options.label ?? station.id,
	});
	const envelope = expectStationEnvelope(station, result);
	await options.assert?.({ root: options.root, result, envelope });
	return evidenceFor(station, result, envelope);
}

async function runRecordFixture(
	root: string,
	label: string,
	input: { goal: string },
): Promise<CliProcessResult> {
	return runSkillFeedback(
		[
			"record",
			"--skill",
			"create-skill",
			"--goal",
			input.goal,
			"--outcome",
			"confirmed",
			"--friction",
			"Clean run.",
			"--generated-ts",
			GENERATED_TS,
		],
		{ cwd: root, label },
	);
}

function expectStationEnvelope(
	station: SkillFeedbackBranchStation,
	result: CliProcessResult,
): RuntimeEnvelope {
	const expected = stationEnvelopeExpectation(station);
	expect(result.exitCode, describeCliProcessRun(result)).toBe(
		station.expectedExitCode,
	);
	const envelope = parseCliProcessJson<RuntimeEnvelope>(result);
	expect(envelope.status, describeCliProcessRun(result)).toBe(
		expected.envelopeStatus,
	);
	const observedContract = observedResultContractId(envelope);
	expect(observedContract, describeCliProcessRun(result)).toBe(
		expected.resultContractId,
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

function stationEnvelopeExpectation(station: SkillFeedbackBranchStation): {
	envelopeStatus: "ok" | "error";
	resultContractId: string;
} {
	if (
		!("expectedEnvelopeStatus" in station) ||
		!("expectedResultContractId" in station)
	) {
		throw new Error(`${station.id} does not declare a JSON envelope expectation.`);
	}
	return {
		envelopeStatus: station.expectedEnvelopeStatus,
		resultContractId: station.expectedResultContractId,
	};
}

function expectDashboardPlainResult(
	station: SkillFeedbackBranchStation,
	result: CliProcessResult,
): void {
	expect(result.exitCode, describeCliProcessRun(result)).toBe(
		station.expectedExitCode,
	);
	expect(result.stderr, describeCliProcessRun(result)).toBe("");
	expect(result.stdout, describeCliProcessRun(result)).toContain(
		"Dashboard paths:",
	);
}

function evidenceFor(
	station: SkillFeedbackBranchStation,
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

function evidenceForPlain(
	station: SkillFeedbackBranchStation,
	result: CliProcessResult,
): SkillFeedbackBranchStationEvidence {
	return {
		stationId: station.id,
		status: "covered",
		observedExitCode: result.exitCode ?? undefined,
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

async function writeLowSignalInboxReport(
	root: string,
	name: string,
	value: unknown,
): Promise<void> {
	const inbox = join(root, ".skill-feedback", "low-signal");
	await mkdir(inbox, { recursive: true });
	await writeFile(join(inbox, name), `${JSON.stringify(value, null, "\t")}\n`);
}

async function writeWeakQueueFixture(root: string): Promise<void> {
	await writeInboxReport(
		root,
		"weak.json",
		v1HumanReport({
			reportId: "queue-weak",
			generatedTs: GENERATED_TS,
			verificationLevel: "light",
			touchedSurfaces: [
				{ type: "path", value: "skills/skill-feedback/SKILL.md" },
			],
		}),
	);
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

function v1HumanReport(input: {
	reportId: string;
	generatedTs: string;
	skill?: string;
	outcome?: "confirmed" | "failed" | "ambiguous";
	verificationLevel?: "none" | "light" | "moderate" | "heavy";
	touchedSurfaces?: Array<{ type: "path" | "label"; value: string }>;
}) {
	return {
		...v1CloseoutReport(input.reportId, input.generatedTs),
		report_card: {
			...BASE_CLOSEOUT,
			skill: input.skill ?? BASE_CLOSEOUT.skill,
			outcome: input.outcome ?? BASE_CLOSEOUT.outcome,
			verification_burden: {
				level: input.verificationLevel ?? BASE_CLOSEOUT.verification_burden.level,
				note: "Integration verification burden.",
			},
			touched_surfaces: input.touchedSurfaces ?? BASE_CLOSEOUT.touched_surfaces,
		},
	};
}
