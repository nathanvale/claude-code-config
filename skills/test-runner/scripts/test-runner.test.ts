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

// biome-ignore lint/suspicious/noExplicitAny: JSON envelope tests assert many package-owned fields.
function parseEnvelope(result: { stdout: string }): any {
	return JSON.parse(result.stdout);
}

function shortRunKey(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 6);
}

describe("test runner command contract", () => {
	test("declares facade contract for run, status, and detail", () => {
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
		expect(TEST_RUNNER_SCHEMA_VERSION).toBe("2");
		expect(testRunnerContracts.run.flags).toHaveProperty("--cwd");
		expect(testRunnerContracts.run.flags).toHaveProperty("--timeout-ms");
		expect(testRunnerContracts.run.flags).toHaveProperty("--mode");
		expect(testRunnerContracts.run.flags).toHaveProperty("--format");
		expect(testRunnerContracts.run.flags).not.toHaveProperty("--handle");
		expect(testRunnerContracts.detail.flags).toHaveProperty("--handle");
		for (const contract of Object.values(testRunnerContracts)) {
			for (const flag of CLI_DIAGNOSTIC_FLAGS) {
				expect(contract.flags).not.toHaveProperty(flag);
			}
		}
	});

	test("help renders advertised flags from the contract", async () => {
		const runHelp = await runForTest(["help", "run"]);
		const statusHelp = await runForTest(["help", "status"]);
		const detailHelp = await runForTest(["help", "detail"]);

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
		assertCommandHelpFlagSurface({
			command: "detail",
			contract: testRunnerContracts.detail,
			help: detailHelp.stdout,
			absentFlags: ["--cwd", "--timeout-ms", "--debug-output", "--mode"],
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

	test("scores local Bun timeout context as complete", async () => {
		const result = await runBenchmark(
			[
				"--fixture",
				"timeout",
				"--local-runner",
				"./test-runner.sh",
				"--run-id",
				"unit-timeout-fidelity",
			],
			{ cwd: scriptsDir, now: new Date("2026-06-04T00:00:00.000Z") },
		);

		const row = result.evidence.rows.find(
			(candidate) => candidate.variant === "local-runner-compact",
		);
		expect(row?.fidelity?.signals.assertion_signal).toBe(true);
		expect(row?.fidelity?.missing).toEqual([]);
		expect(row?.fidelity?.score).toBe(1);
	});

	test("reports repair, triage, and detail roundtrip dimensions separately", async () => {
		const result = await runBenchmark(
			[
				"--fixture",
				"fail",
				"--local-runner",
				"./test-runner.sh",
				"--run-id",
				"unit-mode-aware",
			],
			{ cwd: scriptsDir, now: new Date("2026-06-05T00:00:00.000Z") },
		);

		const repair = result.evidence.rows.find(
			(row) => row.variant === "local-runner-repair",
		);
		const repairJson = result.evidence.rows.find(
			(row) => row.variant === "local-runner-repair-json",
		);
		const repairToon = result.evidence.rows.find(
			(row) => row.variant === "local-runner-repair-toon",
		);
		const triage = result.evidence.rows.find(
			(row) => row.variant === "local-runner-triage",
		);
		const raw = result.evidence.rows.find((row) => row.context_mode === "raw");
		const repairToonGate = result.evidence.calibration.candidate_gates.find(
			(gate) => gate.variant === "local-runner-repair-toon",
		);

		expect(result.evidence.schema_version).toBe("2");
		expect(repair?.context_mode).toBe("repair");
		expect(repair?.lookup_available).toBe(true);
		expect(repair?.detail_roundtrip?.lookup_available).toBe(true);
		expect(repair?.detail_roundtrip?.richer_detail).toBe(true);
		expect(repair?.detail_roundtrip?.test_reruns).toBe(0);
		expect(repair?.fidelity?.signals.expected_value).toBe(true);
		expect(repair?.fidelity?.signals.received_value).toBe(true);
		expect(repairJson?.context_mode).toBe("repair-json");
		expect(repairJson?.lookup_available).toBe(true);
		expect(repairJson?.detail_roundtrip?.richer_detail).toBe(true);
		expect(repairJson?.fidelity?.score).toBe(1);
		expect(repairToon?.context_mode).toBe("repair-toon");
		expect(repairToon?.lookup_available).toBe(true);
		expect(repairToon?.detail_roundtrip?.lookup_available).toBe(true);
		expect(repairToon?.detail_roundtrip?.richer_detail).toBe(true);
		expect(repairToon?.detail_roundtrip?.test_reruns).toBe(0);
		expect(repairToon?.fidelity?.score).toBe(1);
		expect(repairToonGate?.require_lookup_available).toBe(true);
		expect(repairToonGate?.require_detail_roundtrip).toBe(true);
		expect(triage?.context_mode).toBe("triage");
		expect(triage?.notes.join("\n")).toContain("triage is smaller than raw Bun");
		expect(raw?.context_mode).toBe("raw");
	});

	test("broad failure matrix keeps local projections faithful", async () => {
		const fixtures = [
			"string-quotes",
			"string-commas",
			"string-newlines",
			"deep-nested",
			"long-message",
			"snapshot-inline",
			"thrown-error",
			"runtime-error",
			"three-plus-fail",
			"fallback-incomplete",
		];
		const result = await runBenchmark(
			[
				"--fixture",
				fixtures.join(","),
				"--local-runner",
				"./test-runner.sh",
				"--run-id",
				"unit-broad-failure-matrix",
			],
			{ cwd: scriptsDir, now: new Date("2026-06-05T00:00:00.000Z") },
		);
		const projectedRows = result.evidence.rows.filter(
			(row) => row.variant_kind === "local_runner",
		);
		const repairLikeRows = projectedRows.filter(
			(row) =>
				row.context_mode === "repair" ||
				row.context_mode === "repair-json" ||
				row.context_mode === "repair-toon" ||
				row.context_mode === "triage",
		);
		const threePlusToon = result.evidence.rows.find(
			(row) =>
				row.fixture === "three-plus-fail" &&
				row.variant === "local-runner-repair-toon",
		);
		const fallbackJson = result.evidence.rows.find(
			(row) =>
				row.fixture === "fallback-incomplete" &&
				row.variant === "local-runner-repair-json",
		);

		expect(result.exitCode).toBe(0);
		expect(projectedRows).toHaveLength(fixtures.length * 5);
		for (const row of projectedRows) {
			expect(row.exit_correct).toBe(true);
			expect(row.fidelity?.score).toBe(1);
			expect(row.fidelity?.missing).toEqual([]);
			expect(row.fidelity?.signals.failure_count).toBe(true);
		}
		for (const row of repairLikeRows) {
			expect(row.lookup_available).toBe(true);
			expect(row.detail_roundtrip?.lookup_available).toBe(true);
			expect(row.detail_roundtrip?.richer_detail).toBe(true);
			expect(row.detail_roundtrip?.test_reruns).toBe(0);
		}
		expect(threePlusToon?.stdout_sample).toContain("o:1");
		expect(fallbackJson?.fidelity?.signals.expected_value).toBe(true);
		expect(fallbackJson?.fidelity?.signals.received_value).toBe(true);
	});

	test("fixed gates require lookup and detail roundtrip for repair rows", async () => {
		const gatePath = ".benchmark-output/unit-repair-lookup-gate.json";
		const baselinePath = ".benchmark-output/unit-repair-no-lookup-baseline.json";
		await mkdir(join(scriptsDir, ".benchmark-output"), { recursive: true });
		await writeFile(
			join(scriptsDir, baselinePath),
			`${JSON.stringify({
				rows: [
					{
						fixture: "fail",
						variant: "local-runner-repair",
						exit_code: 1,
						stdout_sample: [
							"fixtures/fail.test.ts:9 failing fixture > calculates tax-inclusive price",
							"error: expect(received).toBe(expected)",
							"Expected: 13",
							"Received: 11",
						].join("\n"),
						stderr_sample: "",
					},
				],
			})}\n`,
		);
		await writeFile(
			join(scriptsDir, gatePath),
			`${JSON.stringify({
				candidate_gates: [
					{
						fixture: "fail",
						variant: "local-runner-repair",
						exit_correctness_required: true,
						max_token_estimate: 999,
						min_fidelity_score: 1,
						require_lookup_available: true,
						require_detail_roundtrip: true,
						source: "observed_calibration",
					},
				],
			})}\n`,
		);

		const result = await runBenchmark(
			[
				"--fixture",
				"fail",
				"--mode",
				"fixed-gate",
				"--gate-file",
				gatePath,
				"--mcp-baseline",
				baselinePath,
				"--run-id",
				"unit-repair-lookup-gate",
			],
			{ cwd: scriptsDir, now: new Date("2026-06-05T00:00:00.000Z") },
		);

		expect(result.evidence.gate_result?.status).toBe("fail");
		expect(result.evidence.gate_result?.failures.join("\n")).toContain(
			"lookup unavailable",
		);
	});

	test("legacy fixed gate local-runner resolves to compact row", async () => {
		const gatePath = ".benchmark-output/unit-legacy-local-runner-gate.json";
		await mkdir(join(scriptsDir, ".benchmark-output"), { recursive: true });
		await writeFile(
			join(scriptsDir, gatePath),
			`${JSON.stringify({
				candidate_gates: [
					{
						fixture: "fail",
						variant: "local-runner",
						exit_correctness_required: true,
						max_token_estimate: 999,
						min_fidelity_score: 1,
						source: "observed_calibration",
					},
				],
			})}\n`,
		);

		const result = await runBenchmark(
			[
				"--fixture",
				"fail",
				"--local-runner",
				"./test-runner.sh",
				"--mode",
				"fixed-gate",
				"--gate-file",
				gatePath,
				"--run-id",
				"unit-legacy-local-runner-gate",
			],
			{ cwd: scriptsDir, now: new Date("2026-06-05T00:00:00.000Z") },
		);

		expect(result.evidence.gate_result?.status).toBe("pass");
	});

	test("benchmark CLI emits JSON errors when JSON is requested", async () => {
		const proc = Bun.spawn(
			[
				"bun",
				"run",
				"test-runner.benchmark.ts",
				"--json",
				"--run-id",
				"unit-json-error",
				"--unknown",
			],
			{
				cwd: scriptsDir,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		expect(exitCode).toBe(2);
		expect(stderr).toBe("");
		const envelope = JSON.parse(stdout);
		expect(envelope.status).toBe("error");
		expect(envelope.schema_version).toBe("2");
		expect(envelope.run_id).toBe("unit-json-error");
		expect(envelope.error.code).toBe("benchmark_usage_error");
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
		expect(envelope.data.failures[0].line).toBe(9);
		expect(envelope.data.failures[0].expected).toBe("13");
		expect(envelope.data.failures[0].received).toBe("11");
		expect(envelope.data.failures[0].detail_handle).toStartWith("tr_");
		expect(envelope.data.failures[0].context.join("\n")).toContain("Expected:");
		expect(envelope.continuation.next_action_id).toBe("lookup_failure_detail");
	});

	test("repair mode emits hot-context packet with lookup handle", async () => {
		const result = await runForTest([
			"--cwd",
			scriptsDir,
			"--mode",
			"repair",
			"--run-id",
			"repair-packet",
			"--",
			"fixtures/fail.test.ts",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toStartWith("repair\n");
		expect(result.stderr).toContain("fail.test.ts:9");
		expect(result.stderr).toContain("calculates tax-inclusive price");
		expect(result.stderr).toContain("Expected:13");
		expect(result.stderr).toContain("Received:11");
		expect(result.stderr).toContain("tr_");
		expect(result.stderr).not.toContain("run_id=");
		expect(result.stderr).not.toContain("duration_ms=");
		expect(result.stderr).not.toContain("tests_failed");
		expect(result.stderr).not.toContain(" at <anonymous>");
		expect(result.stderr).not.toContain(" | ");
	});

	test("repair mode emits compact JSON projection when requested", async () => {
		const result = await runForTest([
			"--cwd",
			scriptsDir,
			"--mode",
			"repair",
			"--format",
			"json-compact",
			"--run-id",
			"repair-json-packet",
			"--",
			"fixtures/fail.test.ts",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		expect(payload.s).toBe(2);
		expect(payload.m).toBe("repair");
		expect(payload.x).toBe(1);
		expect(payload.k).toBe("loc,test,assertion,expected,received,detail");
		expect(payload.f[0][0]).toBe("fixtures/fail.test.ts:9");
		expect(payload.f[0][1]).toContain("calculates tax-inclusive price");
		expect(payload.f[0][2]).toContain("expect(received).toBe(expected)");
		expect(payload.f[0][3]).toBe("13");
		expect(payload.f[0][4]).toBe("11");
		expect(payload.f[0][5]).toStartWith("tr_");
		expect(result.stdout).not.toContain("Expected:");
		expect(result.stdout).not.toContain(" at <anonymous>");
	});

	test("repair mode emits TOON projection with lookup handle", async () => {
		const result = await runForTest([
			"--cwd",
			scriptsDir,
			"--mode",
			"repair",
			"--format",
			"toon",
			"--run-id",
			"repair-toon-packet",
			"--",
			"fixtures/fail.test.ts",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("");
		expect(result.stdout).toStartWith("f[1]{l,t,a,e,r,d}:\n");
		expect(result.stdout).toContain(
			"fail.test.ts:9,calculates tax-inclusive price,expect(received).toBe(expected),13,11,tr_",
		);
		expect(result.stdout).not.toContain("Expected:");
		expect(result.stdout).not.toContain("Received:");

		const handle = result.stdout.match(/tr_[a-z0-9._-]+/)?.[0];
		expect(handle).toBeTruthy();
		const detail = await runForTest(["detail", "--handle", handle ?? ""]);
		expect(detail.exitCode).toBe(0);
		expect(detail.stdout).toContain("context:");
		expect(detail.stdout).toContain("calculates tax-inclusive price");
	});

	test("triage mode emits bounded cold-context orientation", async () => {
		const result = await runForTest([
			"--cwd",
			scriptsDir,
			"--mode",
			"triage",
			"--run-id",
			"triage-packet",
			"--",
			"fixtures/multi-fail.test.ts",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toStartWith("triage\n");
		expect(result.stderr).toContain("target=fixtures/multi-fail.test.ts:");
		expect(result.stderr).toContain("test=multi failure fixture > builds initials");
		expect(result.stderr).toContain("test=multi failure fixture > handles empty names");
		expect(result.stderr).toContain('context=expect(initials("Ada Lovelace")).toBe("AD");');
		expect(result.stderr).not.toContain("context=^");
		expect(result.stderr).toContain("detail=tr_");
		expect(result.stderr.length).toBeLessThan(1_200);
	});

	test("detail lookup returns same-run detail without rerunning Bun", async () => {
		let runCount = 0;
		const runtime: TestRunnerRuntime = createDefaultTestRunnerRuntime({
			cwd: () => scriptsDir,
			findBun: async () => "bun",
			runBunTest: async () => {
				runCount += 1;
				return {
					exitCode: 1,
					stdout: "",
					stderr: [
						"fixtures/fail.test.ts:",
						"8 | \ttest(\"calculates tax-inclusive price\", () => {",
						"9 | \t\texpect(priceWithTax(10)).toBe(13);",
						"                               ^",
						"error: expect(received).toBe(expected)",
						"",
						"Expected: 13",
						"Received: 11",
						"",
						`      at <anonymous> (${join(scriptsDir, "fixtures/fail.test.ts")}:9:28)`,
						"(fail) failing fixture > calculates tax-inclusive price [0.13ms]",
						"",
						" 0 pass",
						" 1 fail",
						" 1 expect() calls",
						"Ran 1 test across 1 file. [11.00ms]",
					].join("\n"),
					timedOut: false,
					wallTimeMs: 7,
				};
			},
		});

		const repair = await runForTest(
			[
				"--cwd",
				scriptsDir,
				"--mode",
				"repair",
				"--run-id",
				"detail-roundtrip",
				"--",
				"fixtures/fail.test.ts",
			],
			runtime,
		);
		const handle = repair.stderr.match(/tr_[a-z0-9._-]+/)?.[0];
		expect(typeof handle).toBe("string");

		const detail = await runForTest(["detail", "--handle", handle ?? ""], runtime);

		expect(runCount).toBe(1);
		expect(detail.exitCode).toBe(0);
		expect(detail.stdout).toContain("detail tr_");
		expect(detail.stdout).toContain("target=fixtures/fail.test.ts:9");
		expect(detail.stdout).toContain("Expected: 13");
		expect(detail.stdout).not.toContain(scriptsDir);
	});

	test("detail artifact write failure suppresses dangling handles", async () => {
		const runtime: TestRunnerRuntime = createDefaultTestRunnerRuntime({
			writeText: async () => {
				throw new Error("disk unavailable");
			},
		});
		const result = await runForTest(
			[
				"--cwd",
				scriptsDir,
				"--json",
				"--run-id",
				"detail-write-fails",
				"--",
				"fixtures/fail.test.ts",
			],
			runtime,
		);

		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result);
		expect(envelope.data.action).toBe("tests_failed");
		expect(envelope.error.code).toBe("bun_tests_failed");
		expect(envelope.data.detail_available).toBe(false);
		expect(envelope.data.detail_diagnostic.code).toBe("detail_unavailable");
		expect(envelope.data.failures[0].detail_handle).toBeNull();
	});

	test("plain repair reports unavailable detail recovery without masking failures", async () => {
		const runtime: TestRunnerRuntime = createDefaultTestRunnerRuntime({
			writeText: async () => {
				throw new Error("disk unavailable");
			},
		});
		const result = await runForTest(
			[
				"--cwd",
				scriptsDir,
				"--mode",
				"repair",
				"--run-id",
				"plain-detail-write-fails",
				"--",
				"fixtures/fail.test.ts",
			],
			runtime,
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("detail=detail_unavailable");
		expect(result.stderr).toContain("detail_next=");
		expect(result.stderr).not.toContain("detail=tr_");
		expect(result.stderr).toContain("fail.test.ts:9");
	});

	test("triage detail lookup returns same-run detail without rerunning Bun", async () => {
		let runCount = 0;
		const runtime: TestRunnerRuntime = createDefaultTestRunnerRuntime({
			cwd: () => scriptsDir,
			findBun: async () => "bun",
			runBunTest: async () => {
				runCount += 1;
				return {
					exitCode: 1,
					stdout: "",
					stderr: [
						"fixtures/fail.test.ts:",
						"9 | \t\texpect(priceWithTax(10)).toBe(13);",
						"                               ^",
						"error: expect(received).toBe(expected)",
						"Expected: 13",
						"Received: 11",
						`      at <anonymous> (${join(scriptsDir, "fixtures/fail.test.ts")}:9:28)`,
						"(fail) failing fixture > calculates tax-inclusive price [0.13ms]",
					].join("\n"),
					timedOut: false,
					wallTimeMs: 7,
				};
			},
		});

		const triage = await runForTest(
			[
				"--cwd",
				scriptsDir,
				"--mode",
				"triage",
				"--run-id",
				"triage-roundtrip",
				"--",
				"fixtures/fail.test.ts",
			],
			runtime,
		);
		const handle = triage.stderr.match(/tr_[a-z0-9._-]+/)?.[0];

		const detail = await runForTest(["detail", "--handle", handle ?? ""], runtime);

		expect(runCount).toBe(1);
		expect(detail.exitCode).toBe(0);
		expect(detail.stdout).toContain("detail tr_");
		expect(detail.stdout).toContain("source_run_id=triage-roundtrip");
		expect(detail.stdout).toContain("lookup_run_id=");
		expect(detail.stdout).toContain("context:");
		expect(detail.stdout).not.toContain(scriptsDir);
	});

	test("detail lookup distinguishes missing, malformed, wrong-run, and expired artifacts", async () => {
		const outputDir = join(scriptsDir, ".runner-output");
		await mkdir(outputDir, { recursive: true });
		const artifactHandle = `tr_${shortRunKey("artifact-run")}_1`;
		const malformedHandle = `tr_${shortRunKey("malformed-run")}_1`;
		const wrongRunHandle = `tr_${shortRunKey("source-run")}_1`;
		const expiredHandle = `tr_${shortRunKey("expired-run")}_1`;
		const baseDetail = {
			handle: artifactHandle,
			run_id: "artifact-run",
			failure_id: "failure-one",
			file: "fixtures/fail.test.ts",
			line: 9,
			test_name: "failing fixture > calculates tax-inclusive price",
			message: "error: expect(received).toBe(expected)",
			assertion_signal: "expect(received).toBe(expected)",
			expected: "13",
			received: "11",
			context: ["Expected: 13", "Received: 11"],
			raw_excerpt: ["fixtures/fail.test.ts:", "Expected: 13", "Received: 11"],
			created_at_ms: Date.now(),
			expires_at_ms: Date.now() + 60_000,
		};
		await writeFile(
			join(outputDir, `${malformedHandle}.json`),
			"{not json",
		);
		await writeFile(
			join(outputDir, `${wrongRunHandle}.json`),
			`${JSON.stringify({ ...baseDetail, handle: wrongRunHandle, run_id: "other-run" })}\n`,
		);
		await writeFile(
			join(outputDir, `${expiredHandle}.json`),
			`${JSON.stringify({
				...baseDetail,
				handle: expiredHandle,
				run_id: "expired-run",
				expires_at_ms: 1,
			})}\n`,
		);

		const missing = parseEnvelope(
			await runForTest(["detail", "--json", "--handle", "tr_missing_1"]),
		);
		const malformed = parseEnvelope(
			await runForTest(["detail", "--json", "--handle", malformedHandle]),
		);
		const wrongRun = parseEnvelope(
			await runForTest(["detail", "--json", "--handle", wrongRunHandle]),
		);
		const expired = parseEnvelope(
			await runForTest(["detail", "--json", "--handle", expiredHandle]),
		);

		expect(missing.error.code).toBe("detail_not_found");
		expect(malformed.error.code).toBe("detail_malformed");
		expect(wrongRun.error.code).toBe("detail_wrong_run");
		expect(expired.error.code).toBe("detail_expired");
		for (const envelope of [missing, malformed, wrongRun, expired]) {
			expect(typeof envelope.data.diagnostic.next_action).toBe("string");
			expect(JSON.stringify(envelope)).not.toContain(scriptsDir);
		}
	});

	test("unsafe detail handles fail closed", async () => {
		const result = await runForTest([
			"detail",
			"--json",
			"--handle",
			"../secret",
		]);

		expect(result.exitCode).toBe(1);
		const envelope = parseEnvelope(result);
		expect(envelope.error.code).toBe("detail_unsafe");
		expect(envelope.data.diagnostic.next_action).toContain("lookup handle");
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

	test("Bun timeout failure keeps timeout detail", async () => {
		const result = await runForTest([
			"--cwd",
			scriptsDir,
			"--",
			"fixtures/timeout.test.ts",
			"--timeout",
			"50",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("timeout fixture > times out a slow promise");
		expect(result.stderr).toContain("this test timed out after 50ms");
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
