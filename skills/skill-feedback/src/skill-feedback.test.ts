import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import type {
	CloseoutReceipt,
	HealthResultData,
	Receipt,
	ReviewResultData,
} from "./command-contract";
import {
	SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
	SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_PURGE_CONTRACT_ID,
	SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
	SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION,
	skillFeedbackContracts,
} from "./command-contract";
import {
	closeoutSkillFeedbackReceipt,
	createDefaultSkillFeedbackRuntime,
	healthSkillFeedbackInbox,
	parseHealthArgs,
	parsePurgeArgs,
	parseRecordFlags,
	parseReviewArgs,
	parseStdinTelemetry,
	purgeSkillFeedbackInbox,
	recordSkillFeedbackReceipt,
	reviewSkillFeedbackInbox,
	resolveSkillFeedbackReadTarget,
	runProcessForTest,
	type SkillFeedbackGitResult,
	type SkillFeedbackGitRunner,
	type SkillFeedbackRuntime,
} from "./skill-feedback-runner";

const cleanupPaths: string[] = [];
const GENERATED_TS = "2026-06-11T09:00:00.000Z";
const RUNNER_PATH = new URL("./skill-feedback-runner.ts", import.meta.url)
	.pathname;
const REPO_ROOT = new URL("../../..", import.meta.url).pathname;

type TestProcessResult = {
	command: readonly string[];
	cwd?: string;
	stdout: string;
	stderr: string;
	exitCode: number;
};

type V1CloseoutReportInput = {
	reportId: string;
	generatedTs: string;
	skill?: string;
	evidenceSource?: "driver_closeout" | "hook_capture";
	captureRuntime?: "claude_stop" | "codex_stop";
	correlationStatus?: "linked" | "unlinked";
	skillRunId?: string;
	skillRunIdProvenance?:
		| "runtime_owned"
		| "correlation_owned"
		| "report_authored";
};

type ReviewEnvelopeData = Pick<ReviewResultData, "coverage" | "read_target">;

const BASE_RECEIPT: Receipt = {
	skill: "create-skill",
	goal: "Repair the skill route.",
	outcome: "confirmed",
	friction: "Clean run.",
	explanation: "No extra explanation.",
	skill_version: "create-skill@0.1.0",
	git_sha: "1234567890abcdef1234567890abcdef12345678",
	model: "gpt-5-codex",
	usage: {
		input_tokens: 100,
		output_tokens: 30,
		cache_read_tokens: 12,
	},
	generated_ts: GENERATED_TS,
};

const BASE_CLOSEOUT: CloseoutReceipt = {
	skill: "create-skill",
	outcome: "confirmed",
	goal: "Repair the skill route.",
	friction: {
		category: "none",
		note: "Clean closeout.",
	},
	verification_burden: {
		level: "light",
		note: "Focused verification only.",
	},
	touched_surfaces: [{ type: "path", value: "skills/create-skill/SKILL.md" }],
	observations: [],
};

afterEach(removeCreatedRoots);

async function removeCreatedRoots(): Promise<void> {
	const createdRoots = cleanupPaths.splice(0);
	await Promise.all(createdRoots.map(removeRoot));
}

async function removeRoot(root: string): Promise<void> {
	await rm(root, { recursive: true, force: true });
}

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "skill-feedback-test-"));
	cleanupPaths.push(root);
	return root;
}

async function makeIgnoredGitRoot(): Promise<string> {
	const root = await makeRoot();
	await run(["git", "init"], root);
	await writeFile(join(root, ".gitignore"), ".skill-feedback/\n", "utf-8");
	return root;
}

function stubRuntime(
	root: string,
	overrides: Partial<SkillFeedbackRuntime> = {},
): SkillFeedbackRuntime {
	return createDefaultSkillFeedbackRuntime({
		repoRoot: () => root,
		resolveReadTarget: async (targetPath) => ({
			ok: true,
			explicit: targetPath !== undefined,
			seedPath: targetPath ?? root,
			repoRoot: root,
			inboxPath: join(root, ".skill-feedback"),
		}),
		checkIgnored: async () => 0,
		readGitSha: async () => BASE_RECEIPT.git_sha,
		readSkillVersion: async (skill) => `${skill}@0.1.0`,
		readStdinTelemetry: async () => ({}),
		...overrides,
	});
}

async function writeRecord(
	receipt: Partial<Receipt>,
	runtimeOverrides: Partial<SkillFeedbackRuntime> = {},
) {
	const root = await makeRoot();
	const runtime = stubRuntime(root, runtimeOverrides);
	const result = await recordSkillFeedbackReceipt(receipt, {
		runtime,
		runId: "skill-feedback-test",
	});
	const disk = result.reportPath
		? await readFile(result.reportPath, "utf-8")
		: "";
	return { root, result, disk };
}

async function writeCloseout(
	closeout: Partial<CloseoutReceipt>,
	runtimeOverrides: Partial<SkillFeedbackRuntime> = {},
) {
	const root = await makeRoot();
	const runtime = stubRuntime(root, {
		nowIso: () => GENERATED_TS,
		...runtimeOverrides,
	});
	const result = await closeoutSkillFeedbackReceipt(closeout, {
		runtime,
		runId: "skill-feedback-closeout-test",
	});
	const disk = result.reportPath
		? await readFile(result.reportPath, "utf-8")
		: "";
	return { root, result, disk };
}

async function writeInboxReport(root: string, name: string, value: unknown) {
	const inbox = join(root, ".skill-feedback");
	await mkdir(inbox, { recursive: true });
	await writeFile(join(inbox, name), `${JSON.stringify(value, null, "\t")}\n`);
}

async function writeLowSignalInboxReport(
	root: string,
	name: string,
	value: unknown,
) {
	const inbox = join(root, ".skill-feedback", "low-signal");
	await mkdir(inbox, { recursive: true });
	await writeFile(join(inbox, name), `${JSON.stringify(value, null, "\t")}\n`);
}

function v1CloseoutReport(input: V1CloseoutReportInput) {
	return {
		schema_version: "1",
		report_id: input.reportId,
		untrusted_evidence: true,
		generated_ts: input.generatedTs,
		evidence_source: input.evidenceSource ?? "driver_closeout",
		capture_runtime: input.captureRuntime,
		correlation_status: input.correlationStatus ?? "unlinked",
		skill_run_id: input.skillRunId,
		skill_run_id_provenance: input.skillRunIdProvenance,
		runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
		report_card: {
			...BASE_CLOSEOUT,
			skill: input.skill ?? BASE_CLOSEOUT.skill,
		},
		evidence_gaps: [],
	};
}

async function writeV1CloseoutInboxReport(
	root: string,
	name: string,
	input: V1CloseoutReportInput,
): Promise<void> {
	await writeInboxReport(root, name, v1CloseoutReport(input));
}

function describeProcessResult(result: TestProcessResult): string {
	return [
		`command=${result.command.join(" ")}`,
		...(result.cwd ? [`cwd=${result.cwd}`] : []),
		`exit=${result.exitCode}`,
		`stdout=${JSON.stringify(result.stdout)}`,
		`stderr=${JSON.stringify(result.stderr)}`,
	].join("\n");
}

function parseEnvelope(
	result: TestProcessResult | string,
): Record<string, unknown> {
	const stdout = typeof result === "string" ? result : result.stdout;
	try {
		return JSON.parse(stdout) as Record<string, unknown>;
	} catch (error) {
		const context =
			typeof result === "string"
				? `stdout=${JSON.stringify(stdout)}`
				: describeProcessResult(result);
		throw new Error(`Could not parse JSON envelope:\n${context}`, {
			cause: error,
		});
	}
}

function expectReviewCoverage(
	stdout: string,
	expected: {
		total_reports: number;
		closeout_count: number;
		capture_only_count: number;
		closeout_rate: number;
		low_coverage: boolean;
	},
): void {
	const data = parseEnvelope(stdout).data as {
		coverage: {
			total_reports: number;
			closeout_count: number;
			capture_only_count: number;
			closeout_rate: number;
			low_coverage: boolean;
		};
	};
	expect(data.coverage).toMatchObject(expected);
}

function parseReviewEnvelopeData(result: TestProcessResult): ReviewEnvelopeData {
	return parseEnvelope(result).data as ReviewEnvelopeData;
}

function parseHealthEnvelopeData(
	result: { stdout: string },
): HealthResultData {
	return parseEnvelope(result.stdout).data as HealthResultData;
}

function expectReviewTotalReports(
	result: TestProcessResult,
	totalReports: number,
): ReviewEnvelopeData {
	expect(result.exitCode).toBe(0);
	const data = parseReviewEnvelopeData(result);
	expect(data.coverage.total_reports).toBe(totalReports);
	return data;
}

function expectReadTargetResolutionFailure(
	result: TestProcessResult,
	expected: {
		explicit: boolean;
		targetPath: string;
		changedState?: string;
		contract?: string;
		schemaVersion?: string;
	},
): void {
	expect(result.exitCode).toBe(1);
	const envelope = parseEnvelope(result);
	expect((envelope.error as { code: string }).code).toBe(
		"read_target_resolution_failed",
	);
	expect(envelope.data).toMatchObject({
		...(expected.changedState ? { changed_state: expected.changedState } : {}),
		contract: expected.contract ?? SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
		...(expected.schemaVersion
			? { schema_version: expected.schemaVersion }
			: {}),
		read_target: {
			explicit: expected.explicit,
			target_path: expected.targetPath,
		},
	});
}

async function run(
	command: readonly string[],
	cwd: string,
): Promise<TestProcessResult> {
	const child = Bun.spawn([...command], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const result = await collectCliResult(child, command, cwd);
	if (result.exitCode !== 0) {
		throw new Error(`Test setup command failed:\n${describeProcessResult(result)}`);
	}
	return result;
}

async function runCli(
	args: readonly string[],
	options: { stdin?: string; cwd?: string } = {},
): Promise<TestProcessResult> {
	const stdin = options.stdin ?? "";
	const child = Bun.spawn(
		[process.execPath, RUNNER_PATH, ...args],
		{
			cwd: options.cwd,
			stdin: stdin === "" ? undefined : "pipe",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	if (stdin !== "" && child.stdin) {
		child.stdin.write(stdin);
		child.stdin.end();
	}
	return collectCliResult(
		child,
		[process.execPath, RUNNER_PATH, ...args],
		options.cwd,
	);
}

async function collectCliResult(child: {
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number>;
}, command: readonly string[], cwd?: string): Promise<TestProcessResult> {
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { command, cwd, stdout, stderr, exitCode };
}

function fakeGitRunner(
	outputs: Record<string, SkillFeedbackGitResult | string>,
): SkillFeedbackGitRunner & { calls: Array<{ args: readonly string[]; cwd: string }> } {
	const calls: Array<{ args: readonly string[]; cwd: string }> = [];
	const runner = async (
		args: readonly string[],
		options: { cwd: string },
	): Promise<SkillFeedbackGitResult> => {
		calls.push({ args: [...args], cwd: options.cwd });
		const output = outputs[args.join(" ")];
		if (output === undefined) {
			return { ok: false, stdout: "", stderr: "missing fake output", code: 1 };
		}
		if (typeof output === "string") {
			return { ok: true, stdout: output, stderr: "", code: 0 };
		}
		return output;
	};
	return Object.assign(runner, { calls });
}

function syntheticSecretFixtures(): Array<readonly [string, string]> {
	const lower = "a".repeat(26);
	const lowerShort = "b".repeat(16);
	const digits = "1".repeat(12);
	const alphaNumeric = "A1".repeat(8);
	const jwtPart = (seed: string) => `eyJ${seed.repeat(8)}`;
	return [
		["bearer", `Bearer ${"token".repeat(4)}`],
		["jwt", `${jwtPart("a")}.${jwtPart("b")}.${"signature".repeat(2)}`],
		[
			"pem",
			`-----BEGIN PRIVATE KEY-----\n${"x".repeat(12)}\n-----END PRIVATE KEY-----`,
		],
		["dsn", `postgresql://user:${"pw".repeat(8)}@localhost/db`],
		["ghp", `ghp_${lower}`],
		["github_pat", `github_pat_${lower}`],
		["xoxb", `xoxb-${digits}-${lowerShort}`],
		["xoxp", `xoxp-${digits}-${lowerShort}`],
		["akia", `AKIA${alphaNumeric}`],
		["sk", `sk-${lower}`],
		["sk-proj", `sk-proj-${lower}`],
		["glpat", `glpat-${lower}`],
	];
}

describe("skill-feedback test harness helpers", () => {
	test("setup command failures include process context", async () => {
		const root = await makeRoot();

		await expect(run(["git", "not-a-real-skill-feedback-test-command"], root))
			.rejects.toThrow(/command=git not-a-real-skill-feedback-test-command[\s\S]*cwd=/);
	});

	test("JSON envelope parse failures include command context", () => {
		expect(() =>
			parseEnvelope({
				command: ["skill-feedback-runner", "review"],
				cwd: "/tmp/skill-feedback-fixture",
				exitCode: 1,
				stdout: "not json",
				stderr: "diagnostic stderr",
			}),
		).toThrow(/stdout="not json"[\s\S]*stderr="diagnostic stderr"/);
	});

	test("fake git runner records cwd and branches by argv key", async () => {
		const git = fakeGitRunner({
			"git rev-parse --show-toplevel": "/repo\n",
		});

		const result = await git(["git", "rev-parse", "--show-toplevel"], {
			cwd: "/repo/package",
		});

		expect(result).toMatchObject({ ok: true, stdout: "/repo\n", code: 0 });
		expect(git.calls).toEqual([
			{
				args: ["git", "rev-parse", "--show-toplevel"],
				cwd: "/repo/package",
			},
		]);
	});
});

describe("skill-feedback U6 redaction and write gate", () => {
	for (const [label, secret] of syntheticSecretFixtures()) {
		test(`redacts ${label} secret from written friction bytes`, async () => {
			const { result, disk } = await writeRecord({
				...BASE_RECEIPT,
				friction: `Observed ${secret} while closing.`,
			});

			expect(result.exitCode).toBe(0);
			expect(disk).not.toContain(secret);
			expect(parseEnvelope(result.stdout).data).toHaveProperty("redactions");
			expect(
				(parseEnvelope(result.stdout).data as { redactions: number }).redactions,
			).toBeGreaterThanOrEqual(1);
		});
	}

	test("http credential URL keeps scheme but strips query token on disk", async () => {
		const scheme = "https://";
		const queryToken = "SECRET-query-token-value";
		const url = `https://user:pw@api.example.com/path?token=${queryToken}`;
		const { result, disk } = await writeRecord({
			...BASE_RECEIPT,
			friction: `Observed ${url} while closing.`,
		});

		expect(result.exitCode).toBe(0);
		expect(disk).toContain(scheme);
		expect(disk).not.toContain(queryToken);
		expect(disk).not.toContain("pw@");
	});

	test("redacts narrated goal and explanation fields before writing", async () => {
		const goalSecret = "ghp_goal1234567890abcdefghijklmnop";
		const explanationSecret = "sk-explanation1234567890abcdefghijk";
		const { disk } = await writeRecord({
			...BASE_RECEIPT,
			goal: `Goal had ${goalSecret}`,
			explanation: `Explanation had ${explanationSecret}`,
		});

		expect(disk).not.toContain(goalSecret);
		expect(disk).not.toContain(explanationSecret);
	});

	test("does not over-redact a legitimate 40-character hash in friction", async () => {
		const hash = "abcdef1234567890abcdef1234567890abcdef12";
		const { disk } = await writeRecord({
			...BASE_RECEIPT,
			friction: `Need to inspect commit ${hash}.`,
		});

		expect(disk).toContain(hash);
		expect(disk).toContain('"redactions": 0');
	});

	test("schema rejection does not echo a raw token in error output", async () => {
		const secret = "ghp_error1234567890abcdefghijklmnop";
		const { result } = await writeRecord({
			...BASE_RECEIPT,
			friction: `Do not echo ${secret}`,
			unknown: "field",
		} as Partial<Receipt>);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).not.toContain(secret);
		expect(result.stderr).not.toContain(secret);
	});

	test("unknown-field error hint names the offending field", async () => {
		const { result } = await writeRecord({
			...BASE_RECEIPT,
			surprise: "value",
		} as Partial<Receipt>);

		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result.stdout);
		const error = envelope.error as Record<string, unknown>;
		expect(error.code).toBe("unknown_receipt_field");
		const hint = error.hint as Record<string, unknown>;
		expect(hint.summary).toContain("surprise");
	});

	test("invalid-field error hint names the offending field", async () => {
		const { result } = await writeRecord({
			...BASE_RECEIPT,
			goal: 42 as unknown as string,
		});

		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result.stdout);
		const error = envelope.error as Record<string, unknown>;
		expect(error.code).toBe("invalid_receipt_field");
		const hint = error.hint as Record<string, unknown>;
		expect(hint.summary).toContain("goal");
	});

	test("clean free text passes through unchanged with zero redactions", async () => {
		const { disk } = await writeRecord({
			...BASE_RECEIPT,
			friction: "Selector wording was ambiguous but secret-free.",
		});

		expect(disk).toContain("Selector wording was ambiguous but secret-free.");
		expect(disk).toContain('"redactions": 0');
	});

	for (const [label, checkIgnored] of [
		["complete path", async () => 1],
		["degraded path", async () => 1],
		["error status", async () => 128],
		["timeout status", async () => 124],
	] as const) {
		test(`gitignore gate fail-closed blocks writes on ${label}`, async () => {
			const receipt =
				label === "degraded path"
					? {
							skill: BASE_RECEIPT.skill,
							goal: BASE_RECEIPT.goal,
							outcome: BASE_RECEIPT.outcome,
							generated_ts: BASE_RECEIPT.generated_ts,
						}
					: BASE_RECEIPT;
			const { root, result } = await writeRecord(receipt, { checkIgnored });

			expect(result.exitCode).toBe(1);
			expect(result.reportPath).toBeUndefined();
			expect(result.stdout).toContain("gitignore_gate_refused");
			expect(await Bun.file(join(root, ".skill-feedback")).exists()).toBe(false);
		});
	}

	test("gitignore negation is refused by real git check-ignore", async () => {
		const root = await makeRoot();
		await run(["git", "init"], root);
		await writeFile(
			join(root, ".gitignore"),
			".skill-feedback/\n!.skill-feedback/\n",
			"utf-8",
		);
		const result = await recordSkillFeedbackReceipt(BASE_RECEIPT, {
			runtime: createDefaultSkillFeedbackRuntime({ repoRoot: () => root }),
			runId: "negation",
		});

		expect(result.exitCode).toBe(1);
		expect(result.reportPath).toBeUndefined();
	});

	test("real git integration writes only when the inbox is ignored", async () => {
		const root = await makeRoot();
		await run(["git", "init"], root);
		const refused = await recordSkillFeedbackReceipt(BASE_RECEIPT, {
			runtime: createDefaultSkillFeedbackRuntime({ repoRoot: () => root }),
			runId: "not-ignored",
		});
		expect(refused.exitCode).toBe(1);

		await writeFile(join(root, ".gitignore"), ".skill-feedback/\n", "utf-8");
		const written = await recordSkillFeedbackReceipt(BASE_RECEIPT, {
			runtime: createDefaultSkillFeedbackRuntime({ repoRoot: () => root }),
			runId: "ignored",
		});
		expect(written.exitCode).toBe(0);
		expect(written.reportPath).toBeTruthy();
	});

	test("successful writes create restrictive inbox and file permissions", async () => {
		const { root, result } = await writeRecord(BASE_RECEIPT);
		if (!result.reportPath) throw new Error("expected report path");

		const dirMode = (await stat(join(root, ".skill-feedback"))).mode & 0o777;
		const fileMode = (await stat(result.reportPath)).mode & 0o777;
		expect(dirMode).toBe(0o700);
		expect(fileMode).toBe(0o600);
	});

	test("record write failure returns an envelope and rolls back final paths", async () => {
		const root = await makeRoot();
		const finalPaths: string[] = [];
		const result = await recordSkillFeedbackReceipt(BASE_RECEIPT, {
			runtime: stubRuntime(root, {
				writePrivateFile: async (path) => {
					finalPaths.push(path);
					await writeFile(path, "{partial");
					throw new Error("write failed");
				},
			}),
			runId: "record-write-failed",
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("");
		const envelope = parseEnvelope(result.stdout);
		expect((envelope.error as { code: string }).code).toBe(
			"record_write_failed",
		);
		expect(envelope.data).toMatchObject({ changed_state: "none" });
		expect(result.stdout).not.toContain("write failed");
		await expect(readFile(finalPaths[0] ?? "", "utf-8")).rejects.toThrow();
	});

	test("closeout write failure returns an envelope with no changed state", async () => {
		const { result } = await writeCloseout(BASE_CLOSEOUT, {
			writePrivateFile: async () => {
				throw new Error("closeout write failed");
			},
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("");
		const envelope = parseEnvelope(result.stdout);
		expect((envelope.error as { code: string }).code).toBe(
			"closeout_write_failed",
		);
		expect(envelope.data).toMatchObject({
			contract: "skill-feedback.closeout",
			changed_state: "none",
		});
		expect(result.stdout).not.toContain("closeout write failed");
	});

	test("review reports partial temp files as inbox health", async () => {
		const root = await makeRoot();
		await mkdir(join(root, ".skill-feedback"), { recursive: true });
		await writeFile(
			join(root, ".skill-feedback", "partial.json.tmp-fixture"),
			"{partial",
		);

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-temp-health",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			coverage: { total_reports: number };
			inbox_health: { invalid_count: number };
		};
		expect(data.coverage.total_reports).toBe(0);
		expect(data.inbox_health.invalid_count).toBe(1);
	});

	test("runner subprocess helper returns after its timeout", async () => {
		const root = await makeRoot();
		const start = Date.now();
		const result = await runProcessForTest(["/bin/sleep", "1"], root, 50);

		expect(result.exitCode).toBe(124);
		expect(result.stderr).toContain("timed out after 50ms");
		expect(Date.now() - start).toBeLessThan(900);
	});

	test("malformed or missing generated_ts is rejected before write", async () => {
		const malformed = await writeRecord({
			...BASE_RECEIPT,
			generated_ts: "not an iso timestamp",
		});
		expect(malformed.result.exitCode).toBe(2);
		expect(malformed.result.reportPath).toBeUndefined();

		const missing = await writeRecord({
			...BASE_RECEIPT,
			generated_ts: undefined,
		});
		expect(missing.result.exitCode).toBe(2);
		expect(missing.result.reportPath).toBeUndefined();
	});

	test("CLI help renders the record command usage", async () => {
		const result = await runCli(["--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		for (const flag of [
			"--skill",
			"--goal",
			"--outcome",
			"--friction",
			"--explanation",
			"--generated-ts",
		]) {
			expect(result.stdout).toContain(flag);
		}
		for (const engineReadFlag of ["--model", "--git-sha", "--skill-version"]) {
			expect(result.stdout).not.toContain(engineReadFlag);
		}

		const closeoutHelp = await runCli(["closeout", "--help"]);
		expect(closeoutHelp.exitCode).toBe(0);
		expect(closeoutHelp.stderr).toBe("");
		expect(closeoutHelp.stdout).toContain("closeout < receipt.json");
		assertCommandHelpFlagSurface({
			command: "closeout",
			contract: skillFeedbackContracts.closeout,
			help: closeoutHelp.stdout,
			absentFlags: ["--goal", "--friction", "--model", "--skill-version"],
		});

		const reviewHelp = await runCli(["review", "--help"]);
		expect(reviewHelp.exitCode).toBe(0);
		expect(reviewHelp.stderr).toBe("");
		expect(reviewHelp.stdout).toContain("review [--plain]");
		assertCommandHelpFlagSurface({
			command: "review",
			contract: skillFeedbackContracts.review,
			help: reviewHelp.stdout,
			absentFlags: ["--goal", "--friction", "--model", "--skill-version"],
		});

		const healthHelp = await runCli(["health", "--help"]);
		expect(healthHelp.exitCode).toBe(0);
		expect(healthHelp.stderr).toBe("");
		expect(healthHelp.stdout).toContain("health [--plain]");
		assertCommandHelpFlagSurface({
			command: "health",
			contract: skillFeedbackContracts.health,
			help: healthHelp.stdout,
			absentFlags: ["--goal", "--friction", "--model", "--skill-version"],
		});

		const purgeHelp = await runCli(["purge", "--help"]);
		expect(purgeHelp.exitCode).toBe(0);
		expect(purgeHelp.stderr).toBe("");
		expect(purgeHelp.stdout).toContain("purge [--lane");
		expect(purgeHelp.stdout).toContain("Default: all");
		assertCommandHelpFlagSurface({
			command: "purge",
			contract: skillFeedbackContracts.purge,
			help: purgeHelp.stdout,
			absentFlags: [
				"--plain",
				"--goal",
				"--friction",
				"--model",
				"--skill-version",
			],
		});
	});

	test("runner front door renders help", async () => {
		const result = await runCli(["--help"], { cwd: REPO_ROOT });

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("record --skill");
		expect(result.stdout).toContain("health [--plain]");
		expect(result.stdout).toContain("purge [--lane");
	});

	test("CLI usage errors return JSON without writing", async () => {
		const result = await runCli(["record", "--unknown", "value"]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toBe("");
		const envelope = parseEnvelope(result.stdout);
		expect(envelope.status).toBe("error");
		expect((envelope.error as { code: string }).code).toBe("usage_error");
	});

	test("valid closeout stdin writes a v1 report and starts the pilot marker", async () => {
		const root = await makeRoot();
		await run(["git", "init"], root);
		await writeFile(join(root, ".gitignore"), ".skill-feedback/\n", "utf-8");
		const result = await runCli(
			["closeout"],
			{
				cwd: root,
				stdin: `${JSON.stringify(BASE_CLOSEOUT)}\n`,
			},
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		const envelope = parseEnvelope(result.stdout);
		expect(envelope.status).toBe("ok");
		expect(envelope.data).toMatchObject({
			correlation_status: "unlinked",
			closeout_coverage_contribution: "material_closeout",
		});
		const data = envelope.data as { written_path: string; report_id: string };
		const reportPath = join(root, data.written_path);
		const disk = await readFile(reportPath, "utf-8");
		expect(disk).toContain(`"report_id": "${data.report_id}"`);
		const markerPath = join(root, ".skill-feedback", "pilot_started_at");
		const markerBefore = await readFile(markerPath, "utf-8");
		expect(markerBefore.trim()).not.toBe("");
		expect((await stat(markerPath)).mode & 0o777).toBe(0o600);
		expect((await stat(reportPath)).mode & 0o777).toBe(0o600);

		const second = await runCli(["closeout"], {
			cwd: root,
			stdin: `${JSON.stringify({ ...BASE_CLOSEOUT, goal: "Second closeout." })}\n`,
		});
		expect(second.exitCode).toBe(0);
		expect(await readFile(markerPath, "utf-8")).toBe(markerBefore);
	});

	test("closeout rejects argv receipt fields and malformed stdin without leaking raw input", async () => {
		const secret = "ghp_closeout1234567890abcdefghijklmnop";
		const argvResult = await runCli(["closeout", "--goal", secret], {
			stdin: `${JSON.stringify(BASE_CLOSEOUT)}\n`,
		});
		expect(argvResult.exitCode).toBe(2);
		expect(argvResult.stdout).not.toContain(secret);

		const emptyResult = await runCli(["closeout"], { stdin: " " });
		expect(emptyResult.exitCode).toBe(2);
		expect(emptyResult.stderr).toBe("");
		expect(emptyResult.stdout).not.toContain(secret);
		const emptyEnvelope = parseEnvelope(emptyResult.stdout);
		expect(emptyEnvelope.status).toBe("error");
		expect(emptyEnvelope.error).toMatchObject({
			code: "closeout_stdin_empty",
			hint: {
				action: "change_input",
				docs_url:
					"https://github.com/nathanvale/claude-code-config/blob/main/skills/skill-feedback/references/closeout-receipt.md",
			},
		});
		const emptyHint = emptyEnvelope.error as {
			hint: { summary: string };
		};
		expect(emptyHint.hint.summary).toContain("empty stdin");
		expect(emptyHint.hint.summary).not.toContain("bun ");
		expect(emptyHint.hint.summary).not.toContain("skills/");
		expect(emptyHint.hint.summary).not.toContain("/Users/");

		for (const stdin of [
			`{"goal":"${secret}"`,
			"x".repeat(65_001),
		] as const) {
			const result = await runCli(["closeout"], { stdin });
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toBe("");
			expect(result.stdout).not.toContain(secret);
			expect(parseEnvelope(result.stdout).status).toBe("error");
			expect(result.stdout).toContain("closeout");
		}
	});

	test("closeout redacts v1 agent-authored report-card lanes", async () => {
		const frictionSecret = "ghp_friction1234567890abcdefghijklmnop";
		const surfaceSecret = "sk-surface1234567890abcdefghijklmnop";
		const summarySecret = "Bearer closeout-summary-token";
		const { result, disk } = await writeCloseout({
			...BASE_CLOSEOUT,
			friction: {
				category: "tool_failure",
				note: `Tool output exposed ${frictionSecret}.`,
			},
			touched_surfaces: [{ type: "label", value: `label ${surfaceSecret}` }],
			observations: [
				{
					kind: "tool_failure",
					summary: `Observed ${summarySecret}.`,
					evidence_basis: "driver_observed",
				},
			],
		});

		expect(result.exitCode).toBe(0);
		expect(disk).not.toContain(frictionSecret);
		expect(disk).not.toContain(surfaceSecret);
		expect(disk).not.toContain(summarySecret);
		const data = parseEnvelope(result.stdout).data as { redactions: number };
		expect(data.redactions).toBeGreaterThanOrEqual(3);
	});

	test("record and closeout refuse symlinked inbox directories before writing", async () => {
		const recordRoot = await makeRoot();
		const recordOutside = await makeRoot();
		await symlink(recordOutside, join(recordRoot, ".skill-feedback"));
		const record = await recordSkillFeedbackReceipt(BASE_RECEIPT, {
			runtime: stubRuntime(recordRoot),
			runId: "record-symlink-inbox",
		});
		expect(record.exitCode).toBe(1);
		expect(record.reportPath).toBeUndefined();
		expect(record.stdout).toContain("skill_feedback_inbox_symlink_refused");
		expect(await readdir(recordOutside)).toEqual([]);

		const closeoutRoot = await makeRoot();
		const closeoutOutside = await makeRoot();
		await symlink(closeoutOutside, join(closeoutRoot, ".skill-feedback"));
		const closeout = await closeoutSkillFeedbackReceipt(BASE_CLOSEOUT, {
			runtime: stubRuntime(closeoutRoot),
			runId: "closeout-symlink-inbox",
		});
		expect(closeout.exitCode).toBe(1);
		expect(closeout.reportPath).toBeUndefined();
		expect(closeout.stdout).toContain("skill_feedback_inbox_symlink_refused");
		expect(await readdir(closeoutOutside)).toEqual([]);
	});

	test("closeout refuses pilot marker symlink paths before writing", async () => {
		const root = await makeRoot();
		const inbox = join(root, ".skill-feedback");
		await mkdir(inbox, { recursive: true });
		await symlink(join(root, "outside-marker"), join(inbox, "pilot_started_at"));
		const result = await closeoutSkillFeedbackReceipt(BASE_CLOSEOUT, {
			runtime: stubRuntime(root),
			runId: "symlink-marker",
		});

		expect(result.exitCode).toBe(1);
		expect(result.reportPath).toBeUndefined();
		expect(result.stdout).toContain("pilot_marker_symlink_refused");
	});

	test("closeout rolls back the report when first pilot marker write fails", async () => {
		const root = await makeRoot();
		const baseRuntime = stubRuntime(root);
		const result = await closeoutSkillFeedbackReceipt(BASE_CLOSEOUT, {
			runtime: {
				...baseRuntime,
				writePrivateFile: async (path, content, mode) => {
					if (path.endsWith("pilot_started_at")) {
						throw Object.assign(new Error("marker blocked"), { code: "EACCES" });
					}
					await baseRuntime.writePrivateFile(path, content, mode);
				},
			},
			runId: "marker-write-fails",
		});

		expect(result.exitCode).toBe(1);
		expect(result.reportPath).toBeUndefined();
		const envelope = parseEnvelope(result.stdout);
		expect(envelope.data).toMatchObject({ changed_state: "none" });
		expect(result.stdout).toContain("pilot_marker_write_failed");
		const inboxEntries = await readdir(join(root, ".skill-feedback"));
		expect(inboxEntries.filter((entry) => entry.endsWith(".json"))).toEqual([]);
	});

	test("review returns no-action output for an empty inbox", async () => {
		const root = await makeRoot();
		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-empty",
		});

		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result.stdout);
		expect(envelope.status).toBe("ok");
		expect(envelope.data).toMatchObject({
			open_items: [],
			no_action: {
				rationale: "No skill-feedback reports found.",
			},
		});

		const plain = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-empty-plain",
			plain: true,
		});
		expect(plain.exitCode).toBe(0);
		expect(plain.stdout).toContain("No action: No skill-feedback reports found.");
	});

	test("review failure envelope uses the review result schema version", async () => {
		const root = await makeRoot();
		await writeFile(join(root, ".skill-feedback"), "not a directory");

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-failure-contract",
		});

		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result.stdout);
		expect(envelope.data).toMatchObject({
			contract: SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION,
		});
	});

	test("review resolves the containing git root from a nested package cwd", async () => {
		const root = await makeIgnoredGitRoot();
		const packageCwd = join(root, "skills", "skill-feedback");
		await mkdir(packageCwd, { recursive: true });
		await writeV1CloseoutInboxReport(root, "root-report.json", {
			reportId: "report-at-root",
			generatedTs: GENERATED_TS,
		});

		const result = await runCli(["review"], { cwd: packageCwd });

		const data = expectReviewTotalReports(result, 1);
		expect(data.read_target).toBeUndefined();
	});

	test("review --repo resolves an explicit target without reading caller cwd", async () => {
		const caller = await makeIgnoredGitRoot();
		await writeV1CloseoutInboxReport(caller, "caller-a.json", {
			reportId: "report-caller-a",
			generatedTs: GENERATED_TS,
		});
		await writeV1CloseoutInboxReport(caller, "caller-b.json", {
			reportId: "report-caller-b",
			generatedTs: "2026-06-12T00:00:00.000Z",
		});
		const target = await makeIgnoredGitRoot();
		const realTarget = await realpath(target);
		const nestedTarget = join(target, "nested", "package");
		await mkdir(nestedTarget, { recursive: true });
		await writeV1CloseoutInboxReport(target, "target.json", {
			reportId: "report-target",
			generatedTs: GENERATED_TS,
		});

		const result = await runCli(["review", "--repo", nestedTarget], { cwd: caller });

		const data = expectReviewTotalReports(result, 1);
		expect(data.read_target).toMatchObject({
			explicit: true,
			repo_root: realTarget,
			inbox_path: join(realTarget, ".skill-feedback"),
			target_path: nestedTarget,
		});
	});

	test("review --repo failure does not fall back to caller cwd", async () => {
		const caller = await makeIgnoredGitRoot();
		await writeV1CloseoutInboxReport(caller, "caller.json", {
			reportId: "report-caller",
			generatedTs: GENERATED_TS,
		});
		const outsideGit = await makeRoot();

		const result = await runCli(["review", "--repo", outsideGit], { cwd: caller });

		expectReadTargetResolutionFailure(result, {
			explicit: true,
			targetPath: outsideGit,
			changedState: "none",
		});
	});

	test("review outside git returns a repair-state envelope", async () => {
		const outsideGit = await makeRoot();
		const realOutsideGit = await realpath(outsideGit);

		const result = await runCli(["review"], { cwd: outsideGit });

		expectReadTargetResolutionFailure(result, {
			explicit: false,
			targetPath: realOutsideGit,
		});
	});

	test("review resolves a linked worktree top-level instead of the main checkout", async () => {
		const main = await makeIgnoredGitRoot();
		await run(["git", "config", "user.name", "Skill Feedback Test"], main);
		await run(["git", "config", "user.email", "skill-feedback@example.test"], main);
		await run(["git", "add", ".gitignore"], main);
		await run(["git", "commit", "-m", "chore: seed repo"], main);
		const linkedParent = await makeRoot();
		const linked = join(linkedParent, "linked");
		await run(["git", "worktree", "add", "-b", "feat/linked", linked], main);
		await writeV1CloseoutInboxReport(main, "main-a.json", {
			reportId: "report-main-a",
			generatedTs: GENERATED_TS,
		});
		await writeV1CloseoutInboxReport(main, "main-b.json", {
			reportId: "report-main-b",
			generatedTs: "2026-06-12T00:00:00.000Z",
		});
		await writeV1CloseoutInboxReport(linked, "linked.json", {
			reportId: "report-linked",
			generatedTs: GENERATED_TS,
		});

		const result = await runCli(["review"], { cwd: linked });

		const data = expectReviewTotalReports(result, 1);
		expect(data.read_target).toBeUndefined();
	});

	test("health reports a missing inbox in a valid repo without exposing local paths", async () => {
		const root = await makeIgnoredGitRoot();

		const result = await runCli(["health"], { cwd: root });

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		const data = parseHealthEnvelopeData(result);
		expect(data).toMatchObject({
			contract: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
			inbox_status: "missing",
			counts: {
				primary: 0,
				low_signal: 0,
				invalid: 0,
				skipped_unsafe: 0,
				unlinked_primary: 0,
			},
			next_action: {
				action_id: "confirm-capture-path",
			},
		});
		expect(data.warnings.map((warning) => warning.reason_id)).toContain(
			"inbox_missing",
		);
		expect(result.stdout).not.toContain(root);
		expect(result.stdout).not.toContain("repo_root");
		expect(result.stdout).not.toContain("inbox_path");
	});

	test("health reports an empty inbox as exit-zero ready state", async () => {
		const root = await makeIgnoredGitRoot();
		await mkdir(join(root, ".skill-feedback"));

		const result = await runCli(["health"], { cwd: root });

		expect(result.exitCode).toBe(0);
		const data = parseHealthEnvelopeData(result);
		expect(data.inbox_status).toBe("empty");
		expect(data.counts.primary).toBe(0);
		expect(data.warnings.map((warning) => warning.reason_id)).toContain(
			"inbox_empty",
		);
	});

	test("health --plain renders status, counts, warnings, readiness, correlation, and action", async () => {
		const root = await makeIgnoredGitRoot();

		const result = await runCli(["health", "--plain"], { cwd: root });

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("Skill Feedback Health");
		expect(result.stdout).toContain("Inbox status: missing");
		expect(result.stdout).toContain("Counts: primary=0 low-signal=0");
		expect(result.stdout).toContain("Warnings:");
		expect(result.stdout).toContain("- inbox_missing:");
		expect(result.stdout).toContain("Readiness:");
		expect(result.stdout).toContain("Correlation: none linked=0 unlinked=0");
		expect(result.stdout).toContain("Next action: confirm-capture-path");
	});

	test("health usage errors return the health envelope contract", async () => {
		const result = await runCli(["health", "--execute"]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toBe("");
		const envelope = parseEnvelope(result);
		expect((envelope.error as { code: string }).code).toBe("usage_error");
		expect(envelope.data).toMatchObject({
			contract: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
			changed_state: "none",
		});
	});

	test("health --repo resolves the explicit target without reading caller cwd", async () => {
		const caller = await makeIgnoredGitRoot();
		await writeV1CloseoutInboxReport(caller, "caller.json", {
			reportId: "report-caller",
			generatedTs: GENERATED_TS,
		});
		const target = await makeIgnoredGitRoot();
		const nestedTarget = join(target, "nested", "package");
		await mkdir(nestedTarget, { recursive: true });

		const result = await runCli(["health", "--repo", nestedTarget], {
			cwd: caller,
		});

		expect(result.exitCode).toBe(0);
		const data = parseHealthEnvelopeData(result);
		expect(data.inbox_status).toBe("missing");
		expect(data.counts.primary).toBe(0);
		expect(result.stdout).not.toContain(caller);
		expect(result.stdout).not.toContain(target);
	});

	test("health --repo failure does not fall back to caller cwd", async () => {
		const caller = await makeIgnoredGitRoot();
		await writeV1CloseoutInboxReport(caller, "caller.json", {
			reportId: "report-caller",
			generatedTs: GENERATED_TS,
		});
		const outsideGit = await makeRoot();

		const result = await runCli(["health", "--repo", outsideGit], {
			cwd: caller,
		});

		expectReadTargetResolutionFailure(result, {
			explicit: true,
			targetPath: outsideGit,
			contract: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
			schemaVersion: SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
			changedState: "none",
		});
	});

	test("health exits nonzero for unsafe inbox roots", async () => {
		for (const setup of ["symlink", "file"] as const) {
			const root = await makeRoot();
			if (setup === "symlink") {
				const outside = await makeRoot();
				await symlink(outside, join(root, ".skill-feedback"));
			} else {
				await writeFile(join(root, ".skill-feedback"), "not a directory");
			}

			const result = await healthSkillFeedbackInbox({
				runtime: stubRuntime(root),
				runId: `health-unsafe-${setup}`,
			});

			expect(result.exitCode, setup).toBe(1);
			const envelope = parseEnvelope(result.stdout);
			expect((envelope.error as { code: string }).code).toBe(
				"health_inbox_unsafe",
			);
			expect(envelope.data).toMatchObject({
				contract: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
				schema_version: SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
				inbox_status: "unsafe",
				counts: {
					primary: 0,
					skipped_unsafe: 1,
				},
			});
		}
	});

	test("health reports partial readability while review remains allowed", async () => {
		const root = await makeRoot();
		await writeV1CloseoutInboxReport(root, "valid.json", {
			reportId: "report-valid",
			generatedTs: GENERATED_TS,
		});
		await writeFile(join(root, ".skill-feedback", "invalid.json"), "{nope");
		await writeFile(join(root, ".skill-feedback", "partial.json.tmp"), "{}");

		const health = await healthSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "health-partial",
		});

		expect(health.exitCode).toBe(0);
		const healthData = parseHealthEnvelopeData(health);
		expect(healthData).toMatchObject({
			inbox_status: "partially_readable",
			counts: {
				primary: 1,
				invalid: 2,
			},
			next_action: {
				action_id: "repair-inbox-state",
			},
		});
		expect(healthData.warnings.map((warning) => warning.reason_id)).toContain(
			"partial_readability",
		);

		const review = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-after-health-partial",
		});
		expect(review.exitCode).toBe(0);
		expectReviewCoverage(review.stdout, {
			total_reports: 1,
			closeout_count: 1,
			capture_only_count: 0,
			closeout_rate: 1,
			low_coverage: false,
		});
	});

	test("health summarizes all-unlinked primary reports as report-level evidence", async () => {
		const root = await makeRoot();
		await writeV1CloseoutInboxReport(root, "a.json", {
			reportId: "report-unlinked-a",
			generatedTs: GENERATED_TS,
		});
		await writeV1CloseoutInboxReport(root, "b.json", {
			reportId: "report-unlinked-b",
			generatedTs: "2026-06-12T00:00:00.000Z",
		});

		const result = await healthSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "health-all-unlinked",
		});

		expect(result.exitCode).toBe(0);
		const data = parseHealthEnvelopeData(result);
		expect(data.counts.unlinked_primary).toBe(2);
		expect(data.correlation).toMatchObject({
			status: "all_unlinked",
			linked_primary_count: 0,
			unlinked_primary_count: 2,
		});
		expect(data.next_action.action_id).toBe("inspect-report-correlation");
		expect(data.warnings.map((warning) => warning.reason_id)).toContain(
			"unlinked_primary_reports",
		);
	});

	test("health treats unknown-skill Codex Stop as runtime evidence while identity stays blocked", async () => {
		const root = await makeRoot();
		await writeLowSignalInboxReport(
			root,
			"codex-stop-low.json",
			v1CloseoutReport({
				reportId: "report-codex-stop-low",
				generatedTs: GENERATED_TS,
				skill: "unknown-skill",
				evidenceSource: "hook_capture",
				captureRuntime: "codex_stop",
			}),
		);

		const result = await healthSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "health-codex-low",
		});

		expect(result.exitCode).toBe(0);
		const data = parseHealthEnvelopeData(result);
		expect(data.inbox_status).toBe("populated");
		expect(data.counts.primary).toBe(0);
		expect(data.counts.low_signal).toBe(1);
		expect(data.claim_readiness.runtime_capture.status).toBe("evidence_only");
		expect(data.claim_readiness.trusted_skill_identity.status).toBe("blocked");
	});

	test("health warns on low-signal volume without deleting reports", async () => {
		const root = await makeRoot();
		for (let index = 0; index < 10; index += 1) {
			await writeLowSignalInboxReport(
				root,
				`low-${index}.json`,
				v1CloseoutReport({
					reportId: `report-low-${index}`,
					generatedTs: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
					skill: "unknown-skill",
					evidenceSource: "hook_capture",
					captureRuntime: "codex_stop",
				}),
			);
		}

		const result = await healthSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "health-low-signal-volume",
		});

		expect(result.exitCode).toBe(0);
		const data = parseHealthEnvelopeData(result);
		expect(data.counts).toMatchObject({
			primary: 0,
			low_signal: 10,
		});
		expect(data.warnings.map((warning) => warning.reason_id)).toContain(
			"low_signal_threshold",
		);
		expect(data.next_action.action_id).toBe("inspect-capture-identity");
		expect(await readdir(join(root, ".skill-feedback", "low-signal"))).toHaveLength(
			10,
		);
	});

	test("health emits retention preview guidance without deleting reports", async () => {
		const root = await makeRoot();
		for (let index = 0; index < 100; index += 1) {
			await writeV1CloseoutInboxReport(root, `old-${index}.json`, {
				reportId: `report-old-${index}`,
				generatedTs: "2026-05-20T00:00:00.000Z",
				correlationStatus: "linked",
				skillRunId: `run-old-${index}`,
				skillRunIdProvenance: "correlation_owned",
			});
		}

		const result = await healthSkillFeedbackInbox({
			runtime: stubRuntime(root, {
				nowIso: () => "2026-06-13T00:00:00.000Z",
			}),
			runId: "health-retention",
		});

		expect(result.exitCode).toBe(0);
		const data = parseHealthEnvelopeData(result);
		expect(data.counts.primary).toBe(100);
		expect(data.warnings.map((warning) => warning.reason_id)).toContain(
			"retention_preview_recommended",
		);
		expect(data.next_action.action_id).toBe("preview-purge");
		expect(await readdir(join(root, ".skill-feedback"))).toHaveLength(100);
	});

	test("read-target resolver passes full git argv and cwd to the runner", async () => {
		const git = fakeGitRunner({
			"git -C /repo/package rev-parse --show-toplevel": "/repo\n",
		});

		const resolution = await resolveSkillFeedbackReadTarget({
			targetPath: "/repo/package",
			cwd: "/caller",
			runGit: git,
		});

		expect(resolution).toMatchObject({
			ok: true,
			explicit: true,
			seedPath: "/repo/package",
			repoRoot: "/repo",
			inboxPath: "/repo/.skill-feedback",
		});
		expect(git.calls).toEqual([
			{
				args: ["git", "-C", "/repo/package", "rev-parse", "--show-toplevel"],
				cwd: "/repo/package",
			},
		]);
	});

	test("read-target resolver resolves relative targets from the injected cwd", async () => {
		const git = fakeGitRunner({
			"git -C /caller/package rev-parse --show-toplevel": "/caller\n",
		});

		const resolution = await resolveSkillFeedbackReadTarget({
			targetPath: "package",
			cwd: "/caller",
			runGit: git,
		});

		expect(resolution).toMatchObject({
			ok: true,
			explicit: true,
			seedPath: "/caller/package",
			repoRoot: "/caller",
			inboxPath: "/caller/.skill-feedback",
		});
		expect(git.calls).toEqual([
			{
				args: ["git", "-C", "/caller/package", "rev-parse", "--show-toplevel"],
				cwd: "/caller/package",
			},
		]);
	});

	test("read-target resolver reports git, empty-output, and thrown failures", async () => {
		const gitFailure = await resolveSkillFeedbackReadTarget({
			targetPath: "/repo/package",
			cwd: "/caller",
			runGit: fakeGitRunner({
				"git -C /repo/package rev-parse --show-toplevel": {
					ok: false,
					stdout: "",
					stderr: "fatal: not a git repository",
					code: 128,
				},
			}),
		});
		expect(gitFailure).toMatchObject({
			ok: false,
			explicit: true,
			seedPath: "/repo/package",
			code: "read_target_resolution_failed",
			gitExitCode: 128,
		});

		const emptyOutput = await resolveSkillFeedbackReadTarget({
			cwd: "/caller",
			runGit: fakeGitRunner({
				"git -C /caller rev-parse --show-toplevel": "\n",
			}),
		});
		expect(emptyOutput).toMatchObject({
			ok: false,
			explicit: false,
			seedPath: "/caller",
			code: "read_target_resolution_failed",
			gitExitCode: 0,
		});

		const thrown = await resolveSkillFeedbackReadTarget({
			targetPath: "/repo/package",
			cwd: "/caller",
			runGit: async () => {
				throw new Error("git unavailable");
			},
		});
		expect(thrown).toMatchObject({
			ok: false,
			explicit: true,
			seedPath: "/repo/package",
			code: "read_target_resolution_failed",
		});
		expect(thrown).not.toHaveProperty("gitExitCode");
	});

	test("review treats low-signal mixed v0 and v1 reports as no-action", async () => {
		const root = await makeRoot();
		await writeInboxReport(root, "v1-low.json", {
			schema_version: "1",
			report_id: "report-low",
			untrusted_evidence: true,
			generated_ts: GENERATED_TS,
			evidence_source: "driver_closeout",
			correlation_status: "linked",
			skill_run_id: "run-low",
			runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
			report_card: {
				...BASE_CLOSEOUT,
				friction: { category: "none", note: "Clean run." },
				verification_burden: { level: "light", note: "Focused check." },
			},
			evidence_gaps: [],
		});
		await recordSkillFeedbackReceipt(
			BASE_RECEIPT,
			{ runtime: stubRuntime(root), runId: "review-v0" },
		);

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-low-signal",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			coverage: { low_coverage: boolean; capture_only_count: number };
			open_items: unknown[];
			no_action?: { rationale: string };
		};
		expect(data.coverage.capture_only_count).toBe(1);
		expect(data.open_items).toEqual([]);
		expect(data.no_action?.rationale).toContain("No high-signal");
	});

	test("record routes unknown-skill Codex Stop capture to the low-signal lane", async () => {
		const { result, disk } = await writeRecord(
			{
				...BASE_RECEIPT,
				skill: "unknown-skill",
			},
			{
				readStdinTelemetry: async () => ({
					model: "gpt-5-codex",
					capture_runtime: "codex_stop",
					skill_identity_provenance: {
						source: "none",
						trusted: false,
						reason: "codex_stop_payload_has_no_trusted_skill_identity",
					},
				}),
			},
		);

		expect(result.exitCode).toBe(0);
		expect(result.reportPath).toContain(join(".skill-feedback", "low-signal"));
		expect(disk).toContain('"capture_runtime": "codex_stop"');
	});

	test("review reports low-signal lane and legacy unknown-skill health without ledger entries", async () => {
		const root = await makeRoot();
		const lowSignal = {
			schema_version: "1",
			report_id: "report-low-signal",
			untrusted_evidence: true,
			generated_ts: GENERATED_TS,
			evidence_source: "hook_capture",
			capture_runtime: "codex_stop",
			skill_identity_provenance: {
				source: "none",
				trusted: false,
				reason: "codex_stop_payload_has_no_trusted_skill_identity",
			},
			correlation_status: "unlinked",
			runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
			report_card: {
				...BASE_CLOSEOUT,
				skill: "unknown-skill",
			},
			evidence_gaps: [],
		};
		const lowSignalInbox = join(root, ".skill-feedback", "low-signal");
		await mkdir(lowSignalInbox, { recursive: true });
		await writeFile(
			join(lowSignalInbox, "new-low.json"),
			`${JSON.stringify(lowSignal, null, "\t")}\n`,
		);
		await writeFile(
			join(lowSignalInbox, "lane-only-low.json"),
			`${JSON.stringify(
				{
					schema_version: "1",
					report_id: "report-lane-only-low-signal",
					untrusted_evidence: true,
					generated_ts: "2026-06-09T09:00:00.000Z",
					evidence_source: "driver_closeout",
					correlation_status: "linked",
					runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
					report_card: {
						...BASE_CLOSEOUT,
						skill: "create-skill",
					},
					evidence_gaps: [],
				},
				null,
				"\t",
			)}\n`,
		);
		await writeInboxReport(root, "legacy-low.json", {
			...lowSignal,
			report_id: "report-legacy-low-signal",
			generated_ts: "2026-06-10T09:00:00.000Z",
		});

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-low-signal-health",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			coverage: { total_reports: number };
			inbox_health: {
				low_signal_count: number;
				low_signal_newest_generated_ts?: string;
				low_signal_reason_ids: string[];
			};
			ledger_entries: unknown[];
			open_items: unknown[];
		};
		expect(data.coverage.total_reports).toBe(0);
		expect(data.inbox_health.low_signal_count).toBe(3);
		expect(data.inbox_health.low_signal_newest_generated_ts).toBe(GENERATED_TS);
		expect(data.inbox_health.low_signal_reason_ids).toEqual([
			"low_signal_lane_report",
			"unknown_skill_codex_stop",
		]);
		expect(data.ledger_entries).toEqual([]);
		expect(data.open_items).toEqual([]);

		const plain = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-low-signal-health-plain",
			plain: true,
		});
		expect(plain.stdout).toContain("Inbox health: low-signal=3");
	});

	test("review reports unsafe and invalid artifacts as inbox health", async () => {
		const root = await makeRoot();
		await writeInboxReport(root, "valid.json", {
			schema_version: "1",
			report_id: "report-valid",
			untrusted_evidence: true,
			generated_ts: GENERATED_TS,
			evidence_source: "driver_closeout",
			correlation_status: "linked",
			runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
			report_card: BASE_CLOSEOUT,
			evidence_gaps: [],
		});
		await writeFile(join(root, ".skill-feedback", "invalid.json"), "{nope");
		const outside = join(root, "outside.json");
		await writeFile(outside, "{}");
		await symlink(outside, join(root, ".skill-feedback", "unsafe.json"));

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-health-invalid",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			coverage: { total_reports: number };
			inbox_health: {
				primary_count: number;
				skipped_unsafe_count: number;
				invalid_count: number;
			};
		};
		expect(data.coverage.total_reports).toBe(1);
		expect(data.inbox_health.primary_count).toBe(1);
		expect(data.inbox_health.skipped_unsafe_count).toBe(1);
		expect(data.inbox_health.invalid_count).toBe(1);

		const plain = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-health-invalid-plain",
			plain: true,
		});
		expect(plain.stdout).toContain("Inbox health: low-signal=0 skipped=1 invalid=1");
	});

	test("purge preview lists old safe candidates without deleting", async () => {
		const root = await makeRoot();
		await writeInboxReport(
			root,
			"old.json",
			v1CloseoutReport({
				reportId: "report-old",
				generatedTs: "2026-05-20T00:00:00.000Z",
			}),
		);
		await writeInboxReport(
			root,
			"new.json",
			v1CloseoutReport({
				reportId: "report-new",
				generatedTs: "2026-06-12T00:00:00.000Z",
			}),
		);

		const result = await purgeSkillFeedbackInbox({
			runtime: stubRuntime(root, {
				nowIso: () => "2026-06-13T00:00:00.000Z",
			}),
			runId: "purge-preview",
			purge: {
				lane: "all",
				execute: false,
				retention: { kind: "older_than", raw: "14d", durationMs: 1_209_600_000 },
			},
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			mode: string;
			candidate_count: number;
			deleted_count: number;
			candidate_paths: string[];
		};
		expect(data.mode).toBe("preview");
		expect(data.candidate_count).toBe(1);
		expect(data.deleted_count).toBe(0);
		expect(data.candidate_paths).toEqual([".skill-feedback/old.json"]);
		await expect(readFile(join(root, ".skill-feedback", "old.json"), "utf-8"))
			.resolves.toContain("report-old");
	});

	test("purge execute deletes selected low-signal reports only", async () => {
		const root = await makeRoot();
		await writeInboxReport(
			root,
			"old-primary.json",
			v1CloseoutReport({
				reportId: "report-old-primary",
				generatedTs: "2026-05-20T00:00:00.000Z",
			}),
		);
		const lowSignalInbox = join(root, ".skill-feedback", "low-signal");
		await mkdir(lowSignalInbox, { recursive: true });
		await writeFile(
			join(lowSignalInbox, "old-low.json"),
			`${JSON.stringify(
				v1CloseoutReport({
					reportId: "report-old-low",
					generatedTs: "2026-05-19T00:00:00.000Z",
					skill: "unknown-skill",
					evidenceSource: "hook_capture",
					captureRuntime: "codex_stop",
				}),
				null,
				"\t",
			)}\n`,
		);

		const result = await purgeSkillFeedbackInbox({
			runtime: stubRuntime(root, {
				nowIso: () => "2026-06-13T00:00:00.000Z",
			}),
			runId: "purge-execute",
			purge: {
				lane: "low-signal",
				execute: true,
				retention: { kind: "older_than", raw: "14d", durationMs: 1_209_600_000 },
			},
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			mode: string;
			candidate_count: number;
			deleted_count: number;
			deleted_paths: string[];
		};
		expect(data.mode).toBe("execute");
		expect(data.candidate_count).toBe(1);
		expect(data.deleted_count).toBe(1);
		expect(data.deleted_paths).toEqual([
			".skill-feedback/low-signal/old-low.json",
		]);
		await expect(
			readFile(join(root, ".skill-feedback", "old-primary.json"), "utf-8"),
		).resolves.toContain("report-old-primary");
		await expect(
			readFile(join(lowSignalInbox, "old-low.json"), "utf-8"),
		).rejects.toThrow();
	});

	test("purge delete failure reports partial state and deleted paths", async () => {
		const root = await makeRoot();
		await writeInboxReport(
			root,
			"old-a.json",
			v1CloseoutReport({
				reportId: "report-old-a",
				generatedTs: "2026-05-19T00:00:00.000Z",
			}),
		);
		await writeInboxReport(
			root,
			"old-b.json",
			v1CloseoutReport({
				reportId: "report-old-b",
				generatedTs: "2026-05-20T00:00:00.000Z",
			}),
		);
		let deleteCount = 0;

		const result = await purgeSkillFeedbackInbox({
			runtime: stubRuntime(root, {
				nowIso: () => "2026-06-13T00:00:00.000Z",
				removeFile: async (path) => {
					deleteCount += 1;
					if (deleteCount === 1) {
						await rm(path);
						return;
					}
					throw new Error("simulated delete failure");
				},
			}),
			runId: "purge-partial-delete",
			purge: {
				lane: "all",
				execute: true,
				retention: { kind: "older_than", raw: "14d", durationMs: 1_209_600_000 },
			},
		});

		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result.stdout);
		expect((envelope.error as { code: string }).code).toBe(
			"purge_delete_failed",
		);
		expect(envelope.data).toMatchObject({
			contract: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION,
			changed_state: "partial",
			deleted_paths: [".skill-feedback/old-a.json"],
		});
		await expect(
			readFile(join(root, ".skill-feedback", "old-a.json"), "utf-8"),
		).rejects.toThrow();
		await expect(
			readFile(join(root, ".skill-feedback", "old-b.json"), "utf-8"),
		).resolves.toContain("report-old-b");
	});

	test("purge execute lane all spans primary and low-signal reports", async () => {
		const root = await makeRoot();
		await writeInboxReport(
			root,
			"old-primary.json",
			v1CloseoutReport({
				reportId: "report-old-primary",
				generatedTs: "2026-05-19T00:00:00.000Z",
			}),
		);
		const lowSignalInbox = join(root, ".skill-feedback", "low-signal");
		await mkdir(lowSignalInbox, { recursive: true });
		await writeFile(
			join(lowSignalInbox, "old-low.json"),
			`${JSON.stringify(
				v1CloseoutReport({
					reportId: "report-old-low",
					generatedTs: "2026-05-20T00:00:00.000Z",
					skill: "unknown-skill",
					evidenceSource: "hook_capture",
					captureRuntime: "codex_stop",
				}),
				null,
				"\t",
			)}\n`,
		);

		const result = await purgeSkillFeedbackInbox({
			runtime: stubRuntime(root, {
				nowIso: () => "2026-06-13T00:00:00.000Z",
			}),
			runId: "purge-all-execute",
			purge: {
				lane: "all",
				execute: true,
				retention: { kind: "older_than", raw: "14d", durationMs: 1_209_600_000 },
			},
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			candidate_count: number;
			deleted_count: number;
			deleted_paths: string[];
		};
		expect(data.candidate_count).toBe(2);
		expect(data.deleted_count).toBe(2);
		expect(data.deleted_paths).toEqual([
			".skill-feedback/old-primary.json",
			".skill-feedback/low-signal/old-low.json",
		]);
	});

	test("purge keep-latest execute keeps newest selected-lane report", async () => {
		const root = await makeRoot();
		await writeInboxReport(
			root,
			"oldest.json",
			v1CloseoutReport({
				reportId: "report-oldest",
				generatedTs: "2026-05-19T00:00:00.000Z",
			}),
		);
		await writeInboxReport(
			root,
			"middle.json",
			v1CloseoutReport({
				reportId: "report-middle",
				generatedTs: "2026-05-20T00:00:00.000Z",
			}),
		);
		await writeInboxReport(
			root,
			"newest.json",
			v1CloseoutReport({
				reportId: "report-newest",
				generatedTs: "2026-06-12T00:00:00.000Z",
			}),
		);

		const result = await purgeSkillFeedbackInbox({
			runtime: stubRuntime(root, {
				nowIso: () => "2026-06-13T00:00:00.000Z",
			}),
			runId: "purge-keep-latest",
			purge: {
				lane: "primary",
				execute: true,
				retention: { kind: "keep_latest", count: 1 },
			},
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			candidate_paths: string[];
			deleted_paths: string[];
		};
		expect(data.candidate_paths).toEqual([
			".skill-feedback/oldest.json",
			".skill-feedback/middle.json",
		]);
		expect(data.deleted_paths).toEqual(data.candidate_paths);
		await expect(
			readFile(join(root, ".skill-feedback", "newest.json"), "utf-8"),
		).resolves.toContain("report-newest");
	});

	test("purge reports unsafe and invalid artifacts without following them", async () => {
		const root = await makeRoot();
		await writeInboxReport(
			root,
			"old.json",
			v1CloseoutReport({
				reportId: "report-old",
				generatedTs: "2026-05-20T00:00:00.000Z",
			}),
		);
		await writeFile(join(root, ".skill-feedback", "invalid.json"), "{nope");
		const outside = join(root, "outside.json");
		await writeFile(outside, "{}");
		await symlink(outside, join(root, ".skill-feedback", "unsafe.json"));

		const result = await purgeSkillFeedbackInbox({
			runtime: stubRuntime(root, {
				nowIso: () => "2026-06-13T00:00:00.000Z",
			}),
			runId: "purge-health",
			purge: {
				lane: "all",
				execute: false,
				retention: { kind: "older_than", raw: "14d", durationMs: 1_209_600_000 },
			},
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			candidate_count: number;
			skipped_unsafe_count: number;
			invalid_count: number;
			skipped_paths: string[];
			invalid_paths: string[];
		};
		expect(data.candidate_count).toBe(1);
		expect(data.skipped_unsafe_count).toBe(1);
		expect(data.invalid_count).toBe(1);
		expect(data.skipped_paths).toEqual([".skill-feedback/unsafe.json"]);
		expect(data.invalid_paths).toEqual([".skill-feedback/invalid.json"]);
	});

	test("purge public argv rejects execute without a retention selector", async () => {
		const root = await makeRoot();
		const result = await runCli(["purge", "--execute"], { cwd: root });

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toBe("");
		const envelope = parseEnvelope(result.stdout);
		expect((envelope.error as { code: string }).code).toBe("usage_error");
		expect(envelope.data).toMatchObject({
			contract: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION,
			changed_state: "none",
		});
	});

	test("review treats raw inbox skill_run_id provenance as evidence-only", async () => {
		const root = await makeRoot();
		const linkedReport = {
			schema_version: "1",
			untrusted_evidence: true,
			generated_ts: GENERATED_TS,
			correlation_status: "linked",
			skill_run_id: "run-linked",
			skill_run_id_provenance: "correlation_owned",
			runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
			report_card: {
				...BASE_CLOSEOUT,
				friction: { category: "none", note: "Clean run." },
				verification_burden: { level: "light", note: "Focused check." },
			},
			evidence_gaps: [],
		};
		await writeInboxReport(root, "capture-linked.json", {
			...linkedReport,
			report_id: "report-capture-linked",
			evidence_source: "hook_capture",
		});
		await writeInboxReport(root, "closeout-linked.json", {
			...linkedReport,
			report_id: "report-closeout-linked",
			evidence_source: "driver_closeout",
		});

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-linked-coverage",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			coverage: {
				total_reports: number;
				closeout_count: number;
				capture_only_count: number;
				closeout_rate: number;
				low_coverage: boolean;
			};
			review_units: Array<{ trusted_run: boolean }>;
			ledger_entries: Array<{ allowed_claims: string[]; evidence_tier: string }>;
		};
		expect(data.coverage).toMatchObject({
			total_reports: 2,
			closeout_count: 1,
			capture_only_count: 1,
			closeout_rate: 0.5,
			low_coverage: false,
		});
		expect(data.review_units).toHaveLength(2);
		expect(data.review_units.every((unit) => unit.trusted_run === false)).toBe(true);
		expect(data.ledger_entries).toHaveLength(1);
		expect(data.ledger_entries[0]?.allowed_claims).toContain(
			"mixed_evidence_sources",
		);
		expect(data.ledger_entries[0]?.allowed_claims).not.toContain(
			"same_trusted_run",
		);
		expect(data.ledger_entries[0]?.allowed_claims).not.toContain("corroborated");
		expect(data.ledger_entries[0]?.evidence_tier).not.toBe("corroborated");
	});

	test("real runner keeps Codex Stop unknown-skill capture low-signal beside closeout", async () => {
		const root = await makeIgnoredGitRoot();
		const capture = await runCli(
			[
				"record",
				"--skill",
				"unknown-skill",
				"--goal",
				"Harness hook observed a completed skill run.",
				"--outcome",
				"ambiguous",
				"--friction",
				"Hook captured no transcript payload.",
				"--generated-ts",
				"2026-06-11T10:00:00.000Z",
			],
			{
				cwd: root,
				stdin: JSON.stringify({
					model: "gpt-5-codex",
					capture_runtime: "codex_stop",
					skill_identity_provenance: {
						source: "none",
						trusted: false,
						reason: "codex_stop_payload_has_no_trusted_skill_identity",
					},
				}),
			},
		);
		expect(capture.exitCode).toBe(0);

		const closeout = await runCli(["closeout"], {
			cwd: root,
			stdin: `${JSON.stringify({
				...BASE_CLOSEOUT,
				skill: "fallow",
				touched_surfaces: [{ type: "path", value: "skills/fallow/SKILL.md" }],
			})}\n`,
		});
		expect(closeout.exitCode).toBe(0);

		const review = await runCli(["review"], { cwd: root });

		expect(review.exitCode).toBe(0);
		const data = parseEnvelope(review.stdout).data as {
			schema_version: string;
			coverage: { total_reports: number };
			inbox_health: { primary_count: number; low_signal_count: number };
			ledger_entries: Array<{ owner_paths: string[]; allowed_claims: string[] }>;
			claim_readiness: { runtime_capture: { status: string } };
		};
		expect(data.schema_version).toBe(SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION);
		expect(data.coverage.total_reports).toBe(1);
		expect(data.inbox_health.primary_count).toBe(1);
		expect(data.inbox_health.low_signal_count).toBe(1);
		expect(data.claim_readiness.runtime_capture.status).toBe("evidence_only");
		expect(data.ledger_entries).toHaveLength(1);
		expect(data.ledger_entries[0]?.owner_paths).toEqual([
			"skills/fallow/SKILL.md",
		]);
		expect(data.ledger_entries[0]?.allowed_claims).not.toContain(
			"corroborated",
		);
	});

	test("real runner keeps named Claude Stop capture in the primary lane", async () => {
		const root = await makeIgnoredGitRoot();
		const capture = await runCli(
			[
				"record",
				"--skill",
				"fallow",
				"--goal",
				"Harness hook observed a completed skill run.",
				"--outcome",
				"ambiguous",
				"--friction",
				"Hook captured no transcript payload.",
				"--generated-ts",
				"2026-06-11T10:00:00.000Z",
			],
			{
				cwd: root,
				stdin: JSON.stringify({
					model: "claude-opus-4-8",
					capture_runtime: "claude_stop",
					skill_identity_provenance: {
						source: "claude_transcript_skill_tool_result",
						trusted: true,
						field: "toolUseResult.commandName",
						reason: "claude_transcript_detection",
					},
				}),
			},
		);
		expect(capture.exitCode).toBe(0);

		const review = await runCli(["review"], { cwd: root });

		expect(review.exitCode).toBe(0);
		const data = parseEnvelope(review.stdout).data as {
			coverage: { total_reports: number; capture_only_count: number };
			inbox_health: { low_signal_count: number };
		};
		expect(data.coverage.total_reports).toBe(1);
		expect(data.coverage.capture_only_count).toBe(1);
		expect(data.inbox_health.low_signal_count).toBe(0);
	});

	test("primary hook capture and closeout with one strong anchor show mixed evidence only", async () => {
		const root = await makeRoot();
		await writeInboxReport(
			root,
			"capture.json",
			v1CloseoutReport({
				reportId: "report-primary-capture",
				generatedTs: "2026-06-11T10:00:00.000Z",
				skill: "fallow",
				evidenceSource: "hook_capture",
				captureRuntime: "claude_stop",
			}),
		);
		await writeInboxReport(
			root,
			"closeout.json",
			v1CloseoutReport({
				reportId: "report-primary-closeout",
				generatedTs: "2026-06-11T10:01:00.000Z",
				skill: "fallow",
				evidenceSource: "driver_closeout",
			}),
		);

		const review = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-primary-mixed",
		});

		expect(review.exitCode).toBe(0);
		const data = parseEnvelope(review.stdout).data as {
			inbox_health: { low_signal_count: number };
			ledger_entries: Array<{ allowed_claims: string[] }>;
		};
		expect(data.inbox_health.low_signal_count).toBe(0);
		expect(data.ledger_entries).toHaveLength(1);
		expect(data.ledger_entries[0]?.allowed_claims).toContain(
			"repeated_anchor",
		);
		expect(data.ledger_entries[0]?.allowed_claims).toContain(
			"mixed_evidence_sources",
		);
		expect(data.ledger_entries[0]?.allowed_claims).not.toContain(
			"corroborated",
		);
	});

	test("review keeps untrusted shared skill_run_id reports separate", async () => {
		const root = await makeRoot();
		const rawLinkedReport = {
			schema_version: "1",
			untrusted_evidence: true,
			generated_ts: GENERATED_TS,
			correlation_status: "linked",
			skill_run_id: "run-untrusted",
			runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
			report_card: {
				...BASE_CLOSEOUT,
				friction: { category: "none", note: "Clean run." },
				verification_burden: { level: "light", note: "Focused check." },
			},
			evidence_gaps: [],
		};
		await writeInboxReport(root, "capture-raw-linked.json", {
			...rawLinkedReport,
			report_id: "report-capture-raw-linked",
			evidence_source: "hook_capture",
		});
		await writeInboxReport(root, "closeout-raw-linked.json", {
			...rawLinkedReport,
			report_id: "report-closeout-raw-linked",
			evidence_source: "driver_closeout",
		});

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-raw-linked-coverage",
		});

		expect(result.exitCode).toBe(0);
		expectReviewCoverage(result.stdout, {
			total_reports: 2,
			closeout_count: 1,
			capture_only_count: 1,
			closeout_rate: 0.5,
			low_coverage: false,
		});
	});

	test("review treats expected closeout telemetry gaps as no-action", async () => {
		const { root } = await writeCloseout(BASE_CLOSEOUT);

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-clean-closeout",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			coverage: { evidence_gap_count: number; unlinked_count: number };
			open_items: unknown[];
			no_action?: { rationale: string };
		};
		expect(data.coverage.evidence_gap_count).toBeGreaterThan(0);
		expect(data.coverage.unlinked_count).toBe(1);
		expect(data.open_items).toEqual([]);
		expect(data.no_action?.rationale).toContain("No high-signal");
	});

	test("review opens high verification burden, repeated friction, gaps, and owner-path observations", async () => {
		const root = await makeRoot();
		const report = {
			schema_version: "1",
			report_id: "report-heavy",
			untrusted_evidence: true,
			generated_ts: GENERATED_TS,
			evidence_source: "driver_closeout",
			correlation_status: "linked",
			skill_run_id: "run-1",
			runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
			report_card: {
				...BASE_CLOSEOUT,
				friction: { category: "tool_failure", note: "Tool failed twice." },
				verification_burden: {
					level: "heavy",
					note: "Needed full focused and hook suites.",
				},
				observations: [
					{
						kind: "tool_failure",
						target: {
							type: "path",
							value: "skills/skill-feedback/SKILL.md",
						},
						summary: "The owner path needed inspection.",
						evidence_basis: "driver_observed",
					},
				],
			},
			evidence_gaps: [
				{
					code: "missing_runtime_git_sha",
					path: "runtime.git_sha",
					message: "No git SHA source.",
				},
			],
		};
		await writeInboxReport(root, "one.json", report);
		await writeInboxReport(root, "two.json", {
			...report,
			report_id: "report-repeat",
			skill_run_id: "run-2",
			report_card: {
				...report.report_card,
				verification_burden: { level: "light", note: "Focused check." },
				observations: [],
			},
			evidence_gaps: [],
		});

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-open",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			open_items: Array<{ open_reason: string }>;
		};
		const reasons = data.open_items.map((item) => item.open_reason);
		expect(reasons).toEqual(
			expect.arrayContaining([
				"high_verification_burden",
				"repeated_friction",
				"evidence_gap",
				"owner_path_observation",
			]),
		);
	});

	test("review open actions use stable refs instead of prose or inbox order", async () => {
		const makeReport = (reportId: string, skillRunId: string) => ({
			schema_version: "1",
			report_id: reportId,
			untrusted_evidence: true,
			generated_ts: GENERATED_TS,
			evidence_source: "driver_closeout",
			correlation_status: "linked",
			skill_run_id: skillRunId,
			runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
			report_card: {
				...BASE_CLOSEOUT,
				friction: { category: "tool_failure", note: "Tool failed twice." },
				verification_burden: {
					level: reportId === "report-heavy" ? "heavy" : "light",
					note: "Focused check.",
				},
				observations:
					reportId === "report-heavy"
						? [
								{
									kind: "tool_failure",
									target: {
										type: "path",
										value: "skills/skill-feedback/SKILL.md",
									},
									summary: "The owner path needed inspection.",
									evidence_basis: "driver_observed",
								},
							]
						: [],
			},
			evidence_gaps:
				reportId === "report-heavy"
					? [
							{
								code: "missing_runtime_git_sha",
								path: "runtime.git_sha",
								message: "No git SHA source.",
							},
						]
					: [],
		});
		const readActionSummary = async (
			files: Array<{ name: string; value: unknown }>,
		) => {
			const root = await makeRoot();
			for (const file of files) {
				await writeInboxReport(root, file.name, file.value);
			}
			const result = await reviewSkillFeedbackInbox({
				runtime: stubRuntime(root),
				runId: "review-actions-stable",
			});
			expect(result.exitCode).toBe(0);
			const data = parseEnvelope(result.stdout).data as {
				open_actions: Array<{
					action_key: string;
					open_reason: string;
					evidence_refs: string[];
				}>;
			};
			return data.open_actions
				.map((action) => ({
					key: action.action_key,
					reason: action.open_reason,
					refs: [...action.evidence_refs].sort(),
				}))
				.sort((left, right) => left.key.localeCompare(right.key));
		};
		const heavy = makeReport("report-heavy", "run-heavy");
		const repeat = makeReport("report-repeat", "run-repeat");

		const first = await readActionSummary([
			{ name: "a-heavy.json", value: heavy },
			{ name: "b-repeat.json", value: repeat },
		]);
		const second = await readActionSummary([
			{ name: "a-repeat.json", value: repeat },
			{ name: "b-heavy.json", value: heavy },
		]);

		expect(second).toEqual(first);
		for (const action of first) {
			expect(action.refs.every((ref) => ref.startsWith("report:"))).toBe(true);
			expect(action.refs.join(" ")).not.toContain("owner path needed");
			expect(action.refs.join(" ")).not.toContain("Tool failed");
		}
	});

	test("review --plain renders open items, retention, and pilot checkpoint", async () => {
		const root = await makeIgnoredGitRoot();
		await writeInboxReport(root, "plain-heavy.json", {
			schema_version: "1",
			report_id: "report-plain-heavy",
			untrusted_evidence: true,
			generated_ts: "2020-01-01T00:00:00.000Z",
			evidence_source: "driver_closeout",
			correlation_status: "linked",
			skill_run_id: "run-plain",
			runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
			report_card: {
				...BASE_CLOSEOUT,
				friction: { category: "tool_failure", note: "Tool failed." },
				verification_burden: {
					level: "heavy",
					note: "Needed full verification.",
				},
			},
			evidence_gaps: [
				{
					code: "missing_runtime_git_sha",
					path: "runtime.git_sha",
					message: "No git SHA source.",
				},
			],
		});
		await writeFile(
			join(root, ".skill-feedback", "pilot_started_at"),
			"2020-01-01T00:00:00.000Z\n",
			"utf-8",
		);

		const direct = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-plain-direct",
			plain: true,
		});
		expect(direct.exitCode).toBe(0);
		expect(direct.stderr).toBe("");
		expect(direct.stdout).toContain("Open items:");

		const result = await runCli(["review", "--plain"], { cwd: root });

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("Skill Feedback Review");
		expect(result.stdout).toContain("Reports: 1");
		expect(result.stdout).toContain("Open items:");
		expect(result.stdout).toContain("- high_verification_burden:");
		expect(result.stdout).toContain("- evidence_gap:");
		expect(result.stdout).toContain(
			"Retention: Inbox is ready for a future gated purge workflow.",
		);
		expect(result.stdout).toContain("Pilot checkpoint:");
	});

	test("review pilot density counts closeouts with open signal when action exists", async () => {
		const root = await makeRoot();
		const report = {
			schema_version: "1",
			untrusted_evidence: true,
			generated_ts: "2026-06-01T00:00:00.000Z",
			evidence_source: "driver_closeout",
			correlation_status: "linked",
			runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
			evidence_gaps: [],
		};
		await writeInboxReport(root, "heavy.json", {
			...report,
			report_id: "report-heavy-density",
			skill_run_id: "run-heavy-density",
			report_card: {
				...BASE_CLOSEOUT,
				verification_burden: {
					level: "heavy",
					note: "Needed broad verification.",
				},
			},
		});
		await writeInboxReport(root, "clean.json", {
			...report,
			report_id: "report-clean-density",
			skill_run_id: "run-clean-density",
			report_card: {
				...BASE_CLOSEOUT,
				goal: "Clean closeout.",
				verification_burden: {
					level: "light",
					note: "Focused check.",
				},
			},
		});
		await writeFile(
			join(root, ".skill-feedback", "pilot_started_at"),
			"2026-06-01T00:00:00.000Z\n",
			"utf-8",
		);

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root, {
				nowIso: () => "2026-06-08T00:00:00.000Z",
			}),
			runId: "review-pilot-density",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			pilot_checkpoint?: {
				actionable_feedback_numerator: number;
				material_closeout_denominator: number;
				density: number;
			};
		};
		expect(data.pilot_checkpoint).toMatchObject({
			actionable_feedback_numerator: 1,
			material_closeout_denominator: 2,
			density: 0.5,
		});
	});

	test("review emits a pilot checkpoint after seven days without mutating marker", async () => {
		const { root } = await writeCloseout(BASE_CLOSEOUT, {
			nowIso: () => "2026-06-01T00:00:00.000Z",
		});
		const markerPath = join(root, ".skill-feedback", "pilot_started_at");
		const markerBefore = await readFile(markerPath, "utf-8");
		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root, {
				nowIso: () => "2026-06-08T00:00:00.000Z",
			}),
			runId: "review-pilot",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			pilot_checkpoint?: { age_days: number; density: number };
		};
		expect(data.pilot_checkpoint).toMatchObject({
			age_days: 7,
			density: 1,
		});
		expect(await readFile(markerPath, "utf-8")).toBe(markerBefore);
	});

	test("review ignores symlinked pilot marker paths", async () => {
		const root = await makeRoot();
		await writeInboxReport(
			root,
			"closeout.json",
			v1CloseoutReport({
				reportId: "report-symlink-marker",
				generatedTs: GENERATED_TS,
			}),
		);
		const outsideMarker = join(root, "outside-pilot-started-at");
		await writeFile(outsideMarker, "2026-06-01T00:00:00.000Z\n", "utf-8");
		await symlink(
			outsideMarker,
			join(root, ".skill-feedback", "pilot_started_at"),
		);

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root, {
				nowIso: () => "2026-06-08T00:00:00.000Z",
			}),
			runId: "review-symlink-marker",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			pilot_checkpoint?: unknown;
		};
		expect(data.pilot_checkpoint).toBeUndefined();
	});

	test("review emits retention warning without deleting old reports", async () => {
		const root = await makeRoot();
		await writeInboxReport(root, "old.json", {
			schema_version: "1",
			report_id: "report-old",
			untrusted_evidence: true,
			generated_ts: "2026-05-25T00:00:00.000Z",
			evidence_source: "driver_closeout",
			correlation_status: "linked",
			skill_run_id: "run-old",
			runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
			report_card: BASE_CLOSEOUT,
			evidence_gaps: [],
		});
		const reportPath = join(root, ".skill-feedback", "old.json");
		const before = await readFile(reportPath, "utf-8");
		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root, {
				nowIso: () => "2026-06-08T00:00:00.000Z",
			}),
			runId: "review-retention",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			retention: { oldest_report_age_days?: number; warning?: string };
		};
		expect(data.retention.oldest_report_age_days).toBe(14);
		expect(data.retention.warning).toContain("future gated purge");
		expect(await readFile(reportPath, "utf-8")).toBe(before);
	});
});

describe("skill-feedback U6 review v2 renderers", () => {
	const linkedBase = (skillRunId: string) => ({
		schema_version: "1",
		untrusted_evidence: true,
		generated_ts: GENERATED_TS,
		correlation_status: "linked",
		skill_run_id: skillRunId,
		skill_run_id_provenance: "correlation_owned",
		runtime: { git_sha: BASE_RECEIPT.git_sha, skill_version: "0.1.0" },
		report_card: {
			...BASE_CLOSEOUT,
			friction: { category: "none", note: "Clean run." },
			verification_burden: { level: "light", note: "Focused check." },
		},
		evidence_gaps: [],
	});

	test("JSON exposes review units, ledger entries, claim readiness, and no global allowed_claims", async () => {
		const root = await makeRoot();
		await writeInboxReport(root, "capture.json", {
			...linkedBase("run-corrob"),
			report_id: "report-capture",
			evidence_source: "hook_capture",
			capture_runtime: "claude_stop",
		});
		await writeInboxReport(root, "closeout.json", {
			...linkedBase("run-corrob"),
			report_id: "report-closeout",
			evidence_source: "driver_closeout",
		});

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-v2-json",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			review_units: Array<{ review_unit_key: string; trusted_run: boolean }>;
			ledger_entries: Array<{
				evidence_tier: string;
				allowed_claims: string[];
			}>;
			claim_readiness: { runtime_capture: { status: string } };
			allowed_claims?: unknown;
		};
		expect(data.review_units).toHaveLength(2);
		expect(data.review_units.every((unit) => unit.trusted_run === false)).toBe(true);
		expect(data.ledger_entries).toHaveLength(1);
		// Raw inbox JSON cannot mint trusted-run proof; mixed sources stay visible
		// but below corroborated until a writer-owned correlation source exists.
		expect(data.ledger_entries[0]?.evidence_tier).toBe("runtime_observed");
		expect(data.ledger_entries[0]?.allowed_claims).toContain(
			"mixed_evidence_sources",
		);
		expect(data.ledger_entries[0]?.allowed_claims).not.toContain(
			"same_trusted_run",
		);
		expect(data.ledger_entries[0]?.allowed_claims).not.toContain("corroborated");
		// Claude Stop capture is not Codex runtime evidence, so Codex runtime
		// capture readiness stays blocked (R19: Claude Stop does not prove Codex).
		expect(data.claim_readiness.runtime_capture.status).toBe("blocked");
		// Claims stay entry-local; no global allowed_claims (Decision 24).
		expect(data.allowed_claims).toBeUndefined();
	});

	test("plain output shows triage before ledger and renders claims only from allowed_claims (AE1, AE7)", async () => {
		const root = await makeRoot();
		// Same anchor, mixed sources, but NO shared trusted run.
		await writeInboxReport(root, "capture.json", {
			...linkedBase("run-a"),
			skill_run_id: "run-a",
			skill_run_id_provenance: "report_authored",
			report_id: "report-capture",
			evidence_source: "hook_capture",
			capture_runtime: "codex_stop",
		});
		await writeInboxReport(root, "closeout.json", {
			...linkedBase("run-b"),
			skill_run_id: "run-b",
			skill_run_id_provenance: "report_authored",
			report_id: "report-closeout",
			evidence_source: "driver_closeout",
		});

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-v2-plain",
			plain: true,
		});

		expect(result.exitCode).toBe(0);
		const out = result.stdout;
		// Triage (No action / Readiness) appears before the Ledger section (R2/AE7).
		const readinessIndex = out.indexOf("Readiness:");
		const ledgerIndex = out.indexOf("Ledger:");
		expect(readinessIndex).toBeGreaterThan(-1);
		expect(ledgerIndex).toBeGreaterThan(readinessIndex);
		// Same anchor without a shared trusted run: repeated_anchor + mixed
		// sources allowed, but the renderer cannot show corroborated (AE1).
		expect(out).toContain("repeated_anchor");
		expect(out).toContain("mixed_evidence_sources");
		expect(out).toContain("runtimes=codex_stop");
		expect(out).not.toContain("corroborated");
	});

	test("untrusted labels with control characters cannot spoof plain sections (AE8)", async () => {
		const root = await makeRoot();
		await writeInboxReport(root, "spoof.json", {
			...linkedBase("run-spoof"),
			report_id: "report-spoof",
			evidence_source: "driver_closeout",
			report_card: {
				...BASE_CLOSEOUT,
				skill: "create-skill\nReadiness:\n- spoofed",
				friction: { category: "none", note: "Clean run." },
				verification_burden: { level: "heavy", note: "Focused check." },
				touched_surfaces: [
					{ type: "label", value: "runtime\nLedger:\n- spoofed-target" },
				],
				observations: [
					{
						kind: "tool_failure",
						target: { type: "label", value: "observed\nReadiness:\n- spoofed" },
						summary: "Real owner path observation.\nLedger:\n- spoofed",
						evidence_basis: "driver_observed",
					},
				],
			},
		});

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-v2-spoof",
			plain: true,
		});

		expect(result.exitCode).toBe(0);
		// Exactly one real "Ledger:" section heading survives; the injected
		// newline-prefixed "Ledger:" in the label is neutralized.
		const ledgerHeadings = result.stdout
			.split("\n")
			.filter((line) => line === "Ledger:");
		expect(ledgerHeadings).toHaveLength(1);
		const readinessHeadings = result.stdout
			.split("\n")
			.filter((line) => line === "Readiness:");
		expect(readinessHeadings).toHaveLength(1);
		expect(result.stdout).toContain(
			"targets=label:runtime Ledger: - spoofed-target",
		);
	});
});

describe("skill-feedback U7 docs", () => {
	test("docs name review, low-signal, and purge owners without copying purge flags", async () => {
		const skill = await readFile(
			new URL("../SKILL.md", import.meta.url),
			"utf-8",
		);
		const context = await readFile(
			new URL("../CONTEXT.md", import.meta.url),
			"utf-8",
		);
		const reportShape = await readFile(
			new URL("../references/report-shape.md", import.meta.url),
			"utf-8",
		);

		expect(skill).toContain("Keep review mutation-free");
		expect(skill).toContain("Run `purge`");
		expect(skill).not.toContain("--older-than");
		expect(context).toContain("Low-signal lane");
		expect(context).toContain("Health command");
		expect(context).toContain("Purge workflow");
		expect(reportShape).toContain("Health Output");
		expect(reportShape).toContain("inbox_health");
		expect(reportShape).toContain("low-signal");
		expect(reportShape).toContain("purge");
	});
});

describe("skill-feedback engine-read stdin telemetry (KTD2a)", () => {
	const NARRATED_ONLY: Partial<Receipt> = {
		skill: "fallow",
		goal: "Close the fallow run.",
		outcome: "confirmed",
		friction: "Clean run.",
		explanation: "Captured by claude-stop.",
		generated_ts: GENERATED_TS,
	};

	test("stdin model merges in; usage stays an explicit gap (v0)", async () => {
		const { result, disk } = await writeRecord(NARRATED_ONLY, {
			readStdinTelemetry: async () => ({ model: "claude-opus-4-8" }),
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			model: string;
			degraded: boolean;
			gaps: string[];
		};
		expect(data.model).toBe("claude-opus-4-8");
		// model is no longer a gap; usage remains one (not sourced in v0).
		expect(data.gaps).not.toContain("model");
		expect(data.gaps).toContain("usage");
		expect(data.degraded).toBe(true);
		expect(disk).toContain("claude-opus-4-8");
	});

	test("absent stdin telemetry degrades model and usage, never crashes", async () => {
		const { result } = await writeRecord(NARRATED_ONLY, {
			readStdinTelemetry: async () => ({}),
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			degraded: boolean;
			gaps: string[];
		};
		expect(data.degraded).toBe(true);
		expect(data.gaps).toContain("model");
		expect(data.gaps).toContain("usage");
	});

	for (const [label, raw] of [
		["not json", "}{ broken"],
		["json array", "[1,2,3]"],
		["json null", "null"],
		["no model key", '{"other":"x"}'],
	] as const) {
		test(`garbled stdin (${label}) degrades to no model`, () => {
			const telemetry = parseStdinTelemetry(raw);
			expect(telemetry.model).toBeUndefined();
		});
	}

	test("stdin telemetry extracts model only, ignoring stray keys", () => {
		const telemetry = parseStdinTelemetry(
			'{"model":"claude-opus-4-8","usage":{"input_tokens":1},"goal":"x"}',
		);
		expect(telemetry).toEqual({ model: "claude-opus-4-8" });
	});

	test("stdin telemetry extracts capture provenance without new flags", () => {
		const telemetry = parseStdinTelemetry(
			JSON.stringify({
				model: "gpt-5-codex",
				capture_runtime: "codex_stop",
				skill_identity_provenance: {
					source: "none",
					trusted: false,
					reason: "codex_stop_payload_has_no_trusted_skill_identity",
				},
				transcript_path: "/tmp/should-not-persist",
			}),
		);

		expect(telemetry).toEqual({
			model: "gpt-5-codex",
			capture_runtime: "codex_stop",
			skill_identity_provenance: {
				source: "none",
				trusted: false,
				reason: "codex_stop_payload_has_no_trusted_skill_identity",
			},
		});
	});

	test("Codex Stop evidence without trusted identity blocks readiness", async () => {
		const { root, disk } = await writeRecord(NARRATED_ONLY, {
			readStdinTelemetry: async () => ({
				model: "gpt-5-codex",
				capture_runtime: "codex_stop",
				skill_identity_provenance: {
					source: "none",
					trusted: false,
					reason: "codex_stop_payload_has_no_trusted_skill_identity",
				},
			}),
		});
		expect(disk).toContain('"capture_runtime": "codex_stop"');
		expect(disk).not.toContain("transcript_path");

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-codex-stop-blocked",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			claim_readiness: {
				runtime_capture: { status: string; reason_ids: string[] };
				trusted_skill_identity: { status: string };
				daily_pilot: { status: string };
			};
		};
		// Codex Stop evidence is runtime_observed only (R18): runtime capture is
		// evidence_only, identity and daily pilot stay blocked.
		expect(data.claim_readiness.runtime_capture.status).toBe("evidence_only");
		expect(data.claim_readiness.trusted_skill_identity.status).toBe("blocked");
		expect(data.claim_readiness.daily_pilot.status).toBe("blocked");
		expect(data.claim_readiness.runtime_capture.reason_ids).toContain(
			"hook_approval_state_not_machine_observable",
		);

		const plain = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-codex-stop-blocked-plain",
			plain: true,
		});
		expect(plain.stdout).toContain("runtime capture: evidence_only");
		expect(plain.stdout).toContain("trusted skill identity: blocked");
	});

	test("trusted Codex Stop provenance with placeholder runtime stays evidence-only", async () => {
		const root = await makeRoot();
		await writeInboxReport(root, "placeholder-codex-stop.json", {
			schema_version: "1",
			report_id: "report-placeholder-codex-stop",
			untrusted_evidence: true,
			generated_ts: GENERATED_TS,
			evidence_source: "hook_capture",
			capture_runtime: "codex_stop",
			skill_identity_provenance: {
				source: "codex_stop_payload",
				trusted: true,
				field: "skill.name",
				reason: "trusted_codex_stop_payload_identity",
			},
			correlation_status: "unlinked",
			runtime: {
				git_sha: BASE_RECEIPT.git_sha,
				skill_version: "unknown",
				model: "unknown",
			},
			report_card: {
				...BASE_CLOSEOUT,
				skill: "unknown-skill",
			},
			evidence_gaps: [],
		});

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-codex-placeholder-blocked",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			claim_readiness: {
				runtime_capture: { status: string };
				trusted_skill_identity: { status: string };
			};
		};
		// Placeholder runtime values cannot prove trusted skill identity; runtime
		// capture is still evidence_only, identity stays blocked.
		expect(data.claim_readiness.runtime_capture.status).toBe("evidence_only");
		expect(data.claim_readiness.trusted_skill_identity.status).toBe("blocked");
	});

	test("trusted Codex Stop identity stays evidence-only, never ready (R18)", async () => {
		const { root } = await writeRecord(NARRATED_ONLY, {
			readStdinTelemetry: async () => ({
				model: "gpt-5-codex",
				capture_runtime: "codex_stop",
				skill_identity_provenance: {
					source: "codex_stop_payload",
					trusted: true,
					field: "skill.name",
					reason: "trusted_codex_stop_payload_identity",
				},
			}),
		});

		const result = await reviewSkillFeedbackInbox({
			runtime: stubRuntime(root),
			runId: "review-codex-stop-ready",
		});

		expect(result.exitCode).toBe(0);
		const data = parseEnvelope(result.stdout).data as {
			claim_readiness: {
				runtime_capture: { status: string; reason_ids: string[] };
				trusted_skill_identity: { status: string };
				daily_pilot: { status: string };
			};
			coverage: { evidence_gap_count: number };
		};
		// Even trusted-provenance Codex Stop evidence cannot reach `ready`: it is
		// runtime_observed only (R18). Runtime capture is evidence_only; identity
		// and daily pilot stay blocked. This is the readiness collapse U5 prevents.
		expect(data.claim_readiness.runtime_capture.status).toBe("evidence_only");
		expect(data.claim_readiness.trusted_skill_identity.status).toBe("blocked");
		expect(data.claim_readiness.daily_pilot.status).toBe("blocked");
		expect(data.claim_readiness.runtime_capture.reason_ids).toContain(
			"hook_approval_state_not_machine_observable",
		);
		expect(data.coverage.evidence_gap_count).toBeGreaterThan(0);
	});

	test("public stdin telemetry cannot persist a secret-shaped model unredacted", async () => {
		const secretShapedModel = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
		const { disk } = await writeRecord(NARRATED_ONLY, {
			readStdinTelemetry: async () => ({ model: secretShapedModel }),
		});

		expect(disk).not.toContain(secretShapedModel);
		expect(disk).toContain("[redacted]");
	});
});

describe("skill-feedback parseRecordFlags", () => {
	test("parses narrated record flags into a partial receipt", () => {
		const result = parseRecordFlags([
			"record",
			"--skill",
			"create-skill",
			"--goal",
			"ship the contract",
			"--outcome",
			"confirmed",
			"--friction",
			"none",
			"--explanation",
			"clean run",
			"--generated-ts",
			GENERATED_TS,
		]);

		expect(result).toEqual({
			ok: true,
			receipt: {
				skill: "create-skill",
				goal: "ship the contract",
				outcome: "confirmed",
				friction: "none",
				explanation: "clean run",
				generated_ts: GENERATED_TS,
			},
		});
	});

	test("treats a leading record subcommand as optional", () => {
		const withSubcommand = parseRecordFlags(["record", "--skill", "fallow"]);
		const withoutSubcommand = parseRecordFlags(["--skill", "fallow"]);

		expect(withSubcommand).toEqual({ ok: true, receipt: { skill: "fallow" } });
		expect(withoutSubcommand).toEqual({ ok: true, receipt: { skill: "fallow" } });
	});

	test("rejects non-flag tokens, missing values, and unknown flags", () => {
		expect(parseRecordFlags(["create-skill"])).toEqual({
			ok: false,
			message: "Expected a record flag.",
		});
		expect(parseRecordFlags(["--skill"])).toEqual({
			ok: false,
			message: "--skill requires a value.",
		});
		expect(parseRecordFlags(["--skill", "--goal"])).toEqual({
			ok: false,
			message: "--skill requires a value.",
		});
		expect(parseRecordFlags(["--unknown", "value"])).toEqual({
			ok: false,
			message: "Unknown flag --unknown.",
		});
	});

	test("rejects an invalid outcome enum", () => {
		expect(parseRecordFlags(["--outcome", "maybe"])).toEqual({
			ok: false,
			message: "--outcome is invalid.",
		});
	});
});

describe("skill-feedback parseReviewArgs", () => {
	test("parses plain and explicit repo flags", () => {
		expect(parseReviewArgs(["review", "--plain", "--repo", "/repo"])).toEqual({
			ok: true,
			options: {
				plain: true,
				targetPath: "/repo",
			},
		});
	});

	test("parses empty args and rejects positional review inputs", () => {
		expect(parseReviewArgs([])).toEqual({
			ok: true,
			options: { plain: false, targetPath: undefined },
		});
		expect(parseReviewArgs(["review"])).toEqual({
			ok: true,
			options: { plain: false, targetPath: undefined },
		});
		expect(parseReviewArgs(["/repo"])).toMatchObject({
			ok: false,
			message: "Expected a review flag.",
		});
	});

	test("rejects missing repo values and unknown review flags", () => {
		expect(parseReviewArgs(["--repo"])).toMatchObject({
			ok: false,
			message: "--repo requires a value.",
		});
		expect(parseReviewArgs(["--repo", "--plain"])).toMatchObject({
			ok: false,
			message: "--repo requires a value.",
		});
		expect(parseReviewArgs(["--execute"])).toMatchObject({
			ok: false,
			message: "Unknown flag --execute.",
		});
	});
});

describe("skill-feedback parseHealthArgs", () => {
	test("parses plain and explicit repo flags", () => {
		expect(parseHealthArgs(["health", "--plain", "--repo", "/repo"])).toEqual({
			ok: true,
			options: {
				plain: true,
				targetPath: "/repo",
			},
		});
	});

	test("parses empty args and rejects positional health inputs", () => {
		expect(parseHealthArgs([])).toEqual({
			ok: true,
			options: { plain: false, targetPath: undefined },
		});
		expect(parseHealthArgs(["health"])).toEqual({
			ok: true,
			options: { plain: false, targetPath: undefined },
		});
		expect(parseHealthArgs(["/repo"])).toMatchObject({
			ok: false,
			message: "Expected a health flag.",
		});
	});

	test("rejects missing repo values and unknown health flags", () => {
		expect(parseHealthArgs(["--repo"])).toMatchObject({
			ok: false,
			message: "--repo requires a value.",
		});
		expect(parseHealthArgs(["--repo", "--plain"])).toMatchObject({
			ok: false,
			message: "--repo requires a value.",
		});
		expect(parseHealthArgs(["--execute"])).toMatchObject({
			ok: false,
			message: "Unknown flag --execute.",
		});
	});
});

describe("skill-feedback parsePurgeArgs", () => {
	test("parses preview and execute purge flags", () => {
		expect(parsePurgeArgs(["purge", "--older-than", "14d"])).toEqual({
			ok: true,
			options: {
				lane: "all",
				execute: false,
				retention: {
					kind: "older_than",
					raw: "14d",
					durationMs: 1_209_600_000,
				},
			},
		});
		expect(
			parsePurgeArgs([
				"--lane",
				"low-signal",
				"--keep-latest",
				"5",
				"--execute",
			]),
		).toEqual({
			ok: true,
			options: {
				lane: "low-signal",
				execute: true,
				retention: { kind: "keep_latest", count: 5 },
			},
		});
	});

	test("rejects unsafe or ambiguous purge selectors", () => {
		expect(parsePurgeArgs(["--execute"])).toEqual({
			ok: false,
			message: "Purge requires exactly one retention selector.",
		});
		expect(parsePurgeArgs(["--older-than", "14d", "--keep-latest", "5"])).toEqual({
			ok: false,
			message: "Purge requires exactly one retention selector.",
		});
		expect(parsePurgeArgs(["--older-than", "0d"])).toEqual({
			ok: false,
			message: "--older-than must use a positive duration such as 14d or 48h.",
		});
		expect(parsePurgeArgs(["--lane", "archive", "--older-than", "14d"])).toEqual({
			ok: false,
			message: "--lane is invalid.",
		});
	});
});
