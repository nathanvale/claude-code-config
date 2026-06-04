import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import {
	TEST_RUNNER_CONTRACT_ID,
	TEST_RUNNER_SCHEMA_VERSION,
	testRunnerContracts,
	} from "./command-contract";
import { runBenchmark } from "./test-runner.benchmark";
import {
	createDefaultTestRunnerRuntime,
	runForTest,
	type TestRunnerRuntime,
} from "./test-runner";

const scriptsDir = import.meta.dir;

function parseEnvelope(result: { stdout: string }): any {
	return JSON.parse(result.stdout);
}

describe("test runner command contract", () => {
	test("declares facade contract for run and status", () => {
		const parsed = parseCommandFacadeContract(testRunnerContracts, {
			path: "skills/test-runner/scripts/command-contract.ts",
			writeImplyingMutations: new Set(["write", "destructive"]),
		});

		expect(parsed.ok).toBe(true);
		expect(testRunnerContracts.run.resultContract?.id).toBe(
			TEST_RUNNER_CONTRACT_ID,
		);
		expect(testRunnerContracts.run.resultContract?.schema_version).toBe(
			TEST_RUNNER_SCHEMA_VERSION,
		);
		expect(testRunnerContracts.run.flags).toHaveProperty("--cwd");
		expect(testRunnerContracts.run.flags).toHaveProperty("--timeout-ms");
		for (const contract of Object.values(testRunnerContracts)) {
			for (const flag of CLI_DIAGNOSTIC_FLAGS) {
				expect(contract.flags).not.toHaveProperty(flag);
			}
		}
	});

	test("help renders advertised flags from the contract", async () => {
		const runHelp = await runForTest(["help", "run"]);
		const statusHelp = await runForTest(["help", "status"]);

		expect(runHelp.exitCode).toBe(0);
		assertCommandHelpFlagSurface({
			command: "run",
			contract: testRunnerContracts.run,
			help: runHelp.stdout,
		});
		assertCommandHelpFlagSurface({
			command: "status",
			contract: testRunnerContracts.status,
			help: statusHelp.stdout,
			absentFlags: ["--timeout-ms", "--debug-output"],
		});
	});
});

describe("runner benchmark fidelity", () => {
	test("requires every expected failing test signal", async () => {
		const baselinePath = ".benchmark-output/partial-fidelity-baseline.json";
		await mkdir(join(scriptsDir, ".benchmark-output"), { recursive: true });
		await writeFile(
			join(scriptsDir, baselinePath),
			`${JSON.stringify(
				{
					rows: [
						{
							fixture: "multi-fail",
							variant: "partial-mcp",
							exit_code: 1,
							stdout_sample: [
								"multi-fail.test.ts multi failure fixture > builds initials",
								"error: expect(received).toBe(expected)",
								'Expected: "AD"',
								'Received: "AL"',
							].join("\n"),
							stderr_sample: "",
						},
					],
				},
				null,
				2,
			)}\n`,
		);

		const result = await runBenchmark(
			[
				"--fixture",
				"multi-fail",
				"--mcp-baseline",
				baselinePath,
				"--run-id",
				"unit-fidelity",
			],
			{ cwd: scriptsDir, now: new Date("2026-06-04T00:00:00.000Z") },
		);

		const row = result.evidence.rows.find((candidate) => candidate.variant === "partial-mcp");
		expect(row?.fidelity?.signals.failing_test).toBe(false);
		expect(row?.fidelity?.missing).toContain("failing_test");
		expect(row?.fidelity?.score).toBeLessThan(1);
	});
});

describe("test runner runtime", () => {
	test("passing fixture emits tiny plain output and exits 0", async () => {
		const result = await runForTest([
			"--cwd",
			scriptsDir,
			"--",
			"fixtures/pass.test.ts",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("tests_passed");
		expect(result.stdout).toContain("exit=0");
		expect(result.stdout).toContain("failed=0");
		expect(result.stdout.length).toBeLessThan(220);
	});

	test("JSON mode parses for passing fixture", async () => {
		const result = await runForTest([
			"--cwd",
			scriptsDir,
			"--json",
			"--",
			"fixtures/pass.test.ts",
		]);

		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("ok");
		expect(envelope.data.action).toBe("tests_passed");
		expect(envelope.data.summary.passed).toBe(2);
		expect(envelope.data.bun_args).toEqual(["fixtures/pass.test.ts"]);
		expect(envelope.data.run_id).toBe(envelope.run_id);
	});

	test("multiple failures emit bounded repair context and exit non-zero", async () => {
		const result = await runForTest([
			"--cwd",
			scriptsDir,
			"--",
			"fixtures/multi-fail.test.ts",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("tests_failed");
		expect(result.stderr).toContain("multi-fail.test.ts");
		expect(result.stderr).toContain("builds initials");
		expect(result.stderr).toContain("handles empty names");
		expect(result.stderr).toContain("Expected:");
		expect(result.stderr).toContain('Received: "AL"');
		expect(result.stderr).toContain('Received: ""');
		expect(result.stderr.length).toBeLessThan(1_400);
	});

	test("JSON mode preserves failure diagnostics and correlation", async () => {
		const result = await runForTest([
			"--cwd",
			scriptsDir,
			"--json",
			"--run-id",
			"runner-json-fail",
			"--",
			"fixtures/fail.test.ts",
		]);

		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("error");
		expect(envelope.run_id).toBe("runner-json-fail");
		expect(envelope.error.code).toBe("bun_tests_failed");
		expect(envelope.error.retryable).toBe(false);
		expect(envelope.data.failures[0].file).toBe("fixtures/fail.test.ts");
		expect(envelope.data.failures[0].test_name).toContain(
			"calculates tax-inclusive price",
		);
		expect(envelope.data.failures[0].context.join("\n")).toContain("Expected:");
	});

	test("invalid cwd returns actionable diagnostic", async () => {
		const result = await runForTest([
			"--cwd",
			join(scriptsDir, "missing-directory"),
			"--json",
			"--",
			"fixtures/pass.test.ts",
		]);

		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result);
		expect(envelope.error.code).toBe("invalid_cwd");
		expect(envelope.error.retryable).toBe(false);
		expect(envelope.data.diagnostic.next_action).toContain("--cwd");
	});

	test("missing Bun returns structured recovery diagnostic", async () => {
		const runtime = createDefaultTestRunnerRuntime({
			findBun: async () => null,
		});
		const result = await runForTest(
			["--cwd", scriptsDir, "--json", "--", "fixtures/pass.test.ts"],
			runtime,
		);

		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result);
		expect(envelope.error.code).toBe("missing_bun");
		expect(envelope.error.recoverability).toBe("repair_state");
		expect(envelope.data.diagnostic.cause).toContain("PATH");
	});

	test("runner timeout returns retry-safe diagnostic", async () => {
		const result = await runForTest([
			"--cwd",
			scriptsDir,
			"--json",
			"--timeout-ms",
			"30",
			"--",
			"fixtures/timeout.test.ts",
		]);

		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result);
		expect(envelope.error.code).toBe("runner_timeout");
		expect(envelope.error.retryable).toBe(true);
		expect(envelope.continuation.next_action_id).toBe("increase_timeout");
	});

	test("Bun args pass through only after explicit separator", async () => {
		const result = await runForTest([
			"--cwd",
			scriptsDir,
			"--json",
			"--",
			"fixtures/pass.test.ts",
			"--test-name-pattern",
			"adds positive",
		]);

		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.data.bun_args).toEqual([
			"fixtures/pass.test.ts",
			"--test-name-pattern",
			"adds positive",
		]);
		expect(envelope.data.summary.tests).toBe(1);
	});

	test("unknown runner-side args fail clearly", async () => {
		const result = await runForTest([
			"--json",
			"fixtures/pass.test.ts",
		]);

		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result);
		expect(envelope.error.code).toBe("usage_error");
		expect(envelope.error.message).toContain("after --");
	});

	test("status checks readiness without executing tests", async () => {
		let runCount = 0;
		const runtime: TestRunnerRuntime = createDefaultTestRunnerRuntime({
			runBunTest: async () => {
				runCount += 1;
				throw new Error("should not execute tests");
			},
		});
		const result = await runForTest(["status", "--cwd", scriptsDir, "--json"], runtime);

		expect(result.exitCode).toBe(0);
		expect(runCount).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.data.action).toBe("runner_ready");
		expect(envelope.data.cwd).toBe(resolve(scriptsDir));
	});

	test("shell wrapper passes through version", async () => {
		const proc = Bun.spawn(
			["bash", join(scriptsDir, "test-runner.sh"), "--version"],
			{
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/^test-runner 0\.1\.0\n$/);
		expect(stderr).toBe("");
	});

	test("shell wrapper owns missing runtime JSON diagnostic", async () => {
		const proc = Bun.spawn(
			[
				"/bin/bash",
				join(scriptsDir, "test-runner.sh"),
				"--json",
				"--run-id",
				"shell-missing-runtime",
				"--",
				"fixtures/pass.test.ts",
			],
			{
				env: { PATH: "/usr/bin:/bin" },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toBe("");
		const envelope = JSON.parse(stdout);
		expect(envelope.run_id).toBe("shell-missing-runtime");
		expect(envelope.error.code).toBe("missing_bun");
		expect(envelope.error.recoverability).toBe("repair_state");
	});

	test("shell wrapper owns missing runtime plain diagnostic", async () => {
		const proc = Bun.spawn(
			[
				"/bin/bash",
				join(scriptsDir, "test-runner.sh"),
				"--run-id=shell-plain",
				"--",
				"--json",
			],
			{
				env: { PATH: "/usr/bin:/bin" },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		expect(exitCode).toBe(1);
		expect(stdout).toBe("");
		expect(stderr).toContain("missing_bun");
		expect(stderr).toContain("shell-plain");
	});

	test("shell wrapper sanitizes invalid missing-runtime run ids", async () => {
		const proc = Bun.spawn(
			[
				"/bin/bash",
				join(scriptsDir, "test-runner.sh"),
				"--json",
				"--run-id",
				"bad run id \" quote",
			],
			{
				env: { PATH: "/usr/bin:/bin" },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);

		expect(exitCode).toBe(1);
		const envelope = JSON.parse(stdout);
		expect(envelope.run_id).toMatch(/^test-runner-shell-/);
	});
});
