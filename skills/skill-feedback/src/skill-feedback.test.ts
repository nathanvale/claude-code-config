import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { Receipt } from "./command-contract";
import {
	createDefaultSkillFeedbackRuntime,
	recordSkillFeedbackReceipt,
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

afterEach(async () => {
	await Promise.all(
		cleanupPaths.splice(0).map((path) =>
			rm(path, { recursive: true, force: true }),
		),
	);
});

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

function parseEnvelope(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout) as Record<string, unknown>;
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

async function runCli(args: readonly string[]) {
	const child = Bun.spawn(
		[process.execPath, RUNNER_PATH, ...args],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

async function runPackageCli(args: readonly string[]) {
	const child = Bun.spawn(
		[
			"bun",
			"--filter",
			"skill-feedback-scripts",
			"skill-feedback-runner",
			"--",
			...args,
		],
		{
			cwd: REPO_ROOT,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
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
	});

	test("package script front door renders help", async () => {
		const result = await runPackageCli(["--help"]);

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
});
