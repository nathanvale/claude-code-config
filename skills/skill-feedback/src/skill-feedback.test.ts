import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import type { CloseoutReceipt, Receipt } from "./command-contract";
import { skillFeedbackContracts } from "./command-contract";
import {
	closeoutSkillFeedbackReceipt,
	createDefaultSkillFeedbackRuntime,
	parseRecordFlags,
	parseStdinTelemetry,
	recordSkillFeedbackReceipt,
	reviewSkillFeedbackInbox,
	type SkillFeedbackRuntime,
} from "./skill-feedback-runner";

const cleanupPaths: string[] = [];
const GENERATED_TS = "2026-06-11T09:00:00.000Z";
const RUNNER_PATH = new URL("./skill-feedback-runner.ts", import.meta.url)
	.pathname;
const REPO_ROOT = new URL("../../..", import.meta.url).pathname;

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

function stubRuntime(
	root: string,
	overrides: Partial<SkillFeedbackRuntime> = {},
): SkillFeedbackRuntime {
	return createDefaultSkillFeedbackRuntime({
		repoRoot: () => root,
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

function parseEnvelope(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout) as Record<string, unknown>;
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

async function run(command: readonly string[], cwd: string) {
	const child = Bun.spawn([...command], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	await new Response(child.stdout).text();
	await new Response(child.stderr).text();
	return child.exited;
}

async function runCli(
	args: readonly string[],
	options: { stdin?: string; cwd?: string } = {},
) {
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
	return collectCliResult(child);
}

async function collectCliResult(child: {
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number>;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

describe("skill-feedback U6 redaction and write gate", () => {
	for (const [label, secret] of [
		["bearer", "Bearer live-secret-token"],
		["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature"],
		[
			"pem",
			"-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
		],
		["dsn", "postgresql://user:secret-password@localhost/db"],
		["ghp", "ghp_1234567890abcdefghijklmnopqrstuvwxyz"],
		["github_pat", "github_pat_1234567890abcdefghijklmnopqrstuvwxyz"],
		["xoxb", "xoxb-123456789012-abcdefghijklmnop"],
		["xoxp", "xoxp-123456789012-abcdefghijklmnop"],
		["akia", "AKIA1234567890ABCDEF"],
		["sk", "sk-1234567890abcdefghijklmnopqrstuvwxyz"],
		["sk-proj", "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz"],
		["glpat", "glpat-1234567890abcdefghijklmnop"],
	] as const) {
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
	});

	test("runner front door renders help", async () => {
		const result = await runCli(["--help"], { cwd: REPO_ROOT });

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("record --skill");
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

	test("review coalesces coverage only with trusted skill_run_id provenance", async () => {
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
		expectReviewCoverage(result.stdout, {
			total_reports: 2,
			closeout_count: 1,
			capture_only_count: 0,
			closeout_rate: 1,
			low_coverage: false,
		});
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

	test("review --plain renders open items, retention, and pilot checkpoint", async () => {
		const root = await makeRoot();
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
		expect(data.review_units).toHaveLength(1);
		expect(data.review_units[0]?.trusted_run).toBe(true);
		expect(data.ledger_entries).toHaveLength(1);
		// Shared trusted run with mixed sources earns corroborated (KTD6).
		expect(data.ledger_entries[0]?.evidence_tier).toBe("corroborated");
		expect(data.ledger_entries[0]?.allowed_claims).toContain("corroborated");
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
				friction: { category: "none", note: "Clean run." },
				verification_burden: { level: "light", note: "Focused check." },
				observations: [
					{
						kind: "tool_failure",
						target: { type: "path", value: "src/real.ts" },
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

	test("telemetry is trusted: a secret-shaped model is NOT redacted", async () => {
		// model is engine-read, on the trusted side of the boundary — the
		// redactor must not scrub it. (An agent can never author it: no flag.)
		const secretShapedModel = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
		const { disk } = await writeRecord(NARRATED_ONLY, {
			readStdinTelemetry: async () => ({ model: secretShapedModel }),
		});

		expect(disk).toContain(secretShapedModel);
		expect(disk).toContain('"redactions": 0');
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
