import { describe, expect, test } from "bun:test";
import {
	type CommandFacadeContract,
	type CommandResultData,
	type CommandResultPayload,
	createCommandResultData,
	renderCommandUsage,
} from "@side-quest/cli-command-facade";
import {
	assertCommandResultContract,
	assertCommandHelpFlagSurface,
	assertJsonErrorEnvelope,
	runCommandSurfaceCases,
} from "@side-quest/cli-command-facade/testing";

describe("CLI command facade testing subpath", () => {
	const reportContract = {
		script: "tools/report.ts",
		summary: "Report command state.",
		usage: ["report --adapter <id> [--capability <id>] [--json|--plain]"],
		json: true,
		audience: "agent",
		mutation: "read-only",
		sideEffects: ["check"],
		flags: {
			"--adapter": {
				type: "enum",
				values: ["alpha"],
				description: "Adapter id.",
			},
			"--capability": {
				type: "enum",
				values: ["snapshot_refs"],
				description: "Capability id.",
			},
			"--json": { type: "boolean", description: "Emit JSON." },
			"--plain": { type: "boolean", description: "Emit text." },
		},
		exitCodes: {
			"0": "report emitted",
			"1": "report failed",
			"2": "usage error",
		},
		resultContract: {
			id: "example.report",
			schema_version: 1,
		},
	} satisfies CommandFacadeContract<"report">;

	const jsonContract = {
		...reportContract,
		usage: ["report [--json]"],
		flags: {
			"--json": { type: "boolean", description: "Emit JSON." },
		},
	} satisfies CommandFacadeContract<"report">;

	test("derives present flags from the contract and accepts caller-owned absent flags", () => {
		expect(() =>
			assertCommandHelpFlagSurface({
				command: "report",
				contract: reportContract,
				help: renderCommandUsage(reportContract),
				absentFlags: ["--envelope"],
			}),
		).not.toThrow();
	});

	test("reports leaked caller-absent flags with command and classification", () => {
		expect(() =>
			assertCommandHelpFlagSurface({
				command: "report",
				contract: reportContract,
				help: `${renderCommandUsage(reportContract)}--envelope Read envelope.\n`,
				absentFlags: ["--envelope"],
			}),
		).toThrow(/command=report flag=--envelope classification=leaked-absent/);
	});

	test("reports missing contract flags with command and classification", () => {
		expect(() =>
			assertCommandHelpFlagSurface({
				command: "report",
				contract: jsonContract,
				help: "Usage: report\nReport command state.\n",
			}),
		).toThrow(/command=report flag=--json classification=missing-present/);
	});

	test("does not treat a longer flag token as satisfying a shorter flag", () => {
		expect(() =>
			assertCommandHelpFlagSurface({
				command: "report",
				contract: jsonContract,
				help: "Usage: report [--jsonl]\n--jsonl Emit JSON lines.\n",
			}),
		).toThrow(/command=report flag=--json classification=missing-present/);
	});

	test("ignores unsupported flag mentions outside usage and option lines", () => {
		expect(() =>
			assertCommandHelpFlagSurface({
				command: "report",
				contract: jsonContract,
				help: [
					"Usage: report [--json]",
					"",
					"Report command state.",
					"--json Emit JSON.",
					"Use the route command for --envelope; report does not support it.",
				].join("\n"),
				absentFlags: ["--envelope"],
			}),
		).not.toThrow();
	});

	test("reads equals-form flags from option lines", () => {
		expect(() =>
			assertCommandHelpFlagSurface({
				command: "report",
				contract: jsonContract,
				help: "Usage: report\n\nReport command state.\n--json=<mode> Emit JSON.\n",
			}),
		).not.toThrow();
	});

	test("reads flags from continued usage lines", () => {
		const contractWithContinuedUsage = {
			...jsonContract,
			usage: ["report", "report [--json=<mode>]"],
		};
		expect(() =>
			assertCommandHelpFlagSurface({
				command: "report",
				contract: contractWithContinuedUsage,
				help: "Usage: report\n       report [--json=<mode>]\n",
			}),
		).not.toThrow();
	});

	test("wraps command data with the command result contract", () => {
		type ReportPayload = CommandResultPayload<{ total: number }>;
		type ReportResult = CommandResultData<ReportPayload>;
		const typedPayload: ReportPayload = { total: 1 };
		const typedResult: ReportResult = {
			contract_id: "example.report",
			schema_version: 1,
			total: 1,
		};
		// @ts-expect-error reserved facade metadata belongs to the helper
		const reservedPayload: ReportPayload = { contract_id: "other", total: 1 };
		expect(reservedPayload as unknown).toEqual({
			contract_id: "other",
			total: 1,
		});
		expect(typedResult.total).toBe(1);
		expect(typedResult.contract_id).toBe("example.report");

		const literalResultContract = {
			resultContract: {
				id: "example.report",
				schema_version: 1,
			},
		} as const;
		const resultData = createCommandResultData(literalResultContract, {
			total: 1,
		});
		const _literalContractId: "example.report" = resultData.contract_id;
		const _literalSchemaVersion: 1 = resultData.schema_version;
		expect(_literalContractId).toBe("example.report");
		expect(_literalSchemaVersion).toBe(1);
		expect(resultData).toEqual({
			contract_id: "example.report",
			schema_version: 1,
			total: 1,
		});
		expect(createCommandResultData(reportContract, typedPayload)).toEqual({
			contract_id: "example.report",
			schema_version: 1,
			total: 1,
		});
		expect(() =>
			createCommandResultData(reportContract, { contract_id: "other" } as never),
		).toThrow(/must not define contract_id/);
		expect(() =>
			createCommandResultData({ ...reportContract, resultContract: undefined }, {
				total: 1,
			}),
		).toThrow(/result contract is required/);
		expect(() =>
			createCommandResultData(
				{ ...reportContract, resultContract: { id: "   " } },
				{ total: 1 },
			),
		).toThrow(/id must be a non-empty string/);
		expect(() =>
			createCommandResultData(reportContract, { schema_version: 1 } as never),
		).toThrow(/must not define schema_version/);
		expect(
			createCommandResultData(
				{
					...reportContract,
					resultContract: { id: "example.no_schema" },
				},
				{ total: 1 },
			),
		).toEqual({
			contract_id: "example.no_schema",
			total: 1,
		});
		expect(() =>
			createCommandResultData(
				{
					...reportContract,
					resultContract: {
						id: "example.report",
						schema_version: { major: 1 } as never,
					},
				},
				{ total: 1 },
			),
		).toThrow(/schema_version must be a string or number/);
		expect(() =>
			createCommandResultData(
				{
					...reportContract,
					resultContract: {
						id: "example.report",
						schema_version: "",
					},
				},
				{ total: 1 },
			),
		).toThrow(/schema_version must be a non-empty string/);
		expect(() =>
			createCommandResultData(
				{
					...reportContract,
					resultContract: {
						id: "example.report",
						schema_version: Number.NaN,
					},
				},
				{ total: 1 },
			),
		).toThrow(/schema_version must be a finite number/);
		expect(() =>
			createCommandResultData(reportContract, null as never),
		).toThrow(/plain object/);
		expect(() =>
			createCommandResultData(reportContract, ["bad"] as never),
		).toThrow(/plain object/);
		expect(() =>
			createCommandResultData(reportContract, (() => ({ total: 1 })) as never),
		).toThrow(/plain object/);
		expect(
			createCommandResultData(
				reportContract,
				Object.assign(Object.create(null), { total: 1 }),
			),
		).toEqual({
			contract_id: "example.report",
			schema_version: 1,
			total: 1,
		});
	});

	test("asserts command result contract ids from JSON envelopes", () => {
		const envelope = {
			status: "ok",
			run_id: "run-test-1",
			duration_ms: 42,
			data: createCommandResultData(reportContract, { total: 1 }),
		};

		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: reportContract,
				envelope,
			}),
		).not.toThrow();
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: reportContract,
				envelope: {
					...envelope,
					data: { contract_id: "example.other" },
				},
			}),
		).toThrow(
			/command=report expected=example\.report actual=example\.other/,
		);
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: reportContract,
				envelope: {
					...envelope,
					data: { contract_id: "example.report" },
				},
			}),
		).toThrow(
			/command=report schema_version expected=1 actual=undefined/,
		);
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: reportContract,
				envelope: {
					...envelope,
					data: { contract_id: "example.report", schema_version: 2 },
				},
			}),
		).toThrow(/command=report schema_version expected=1 actual=2/);
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: { ...reportContract, resultContract: undefined },
				envelope,
			}),
		).toThrow(/command=report classification=missing-contract/);
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: { ...reportContract, json: false, outputModes: ["plain"] },
				envelope,
			}),
		).toThrow(/command=report classification=non-json-result-contract/);
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: reportContract,
				envelope: { status: "ok", run_id: "run-test-1" },
			}),
		).toThrow(/command=report classification=missing-data/);
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: reportContract,
				envelope: {
					...envelope,
					duration_ms: -1,
				},
			}),
		).toThrow(/duration_ms must be a non-negative number/);
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: reportContract,
				envelope: "not-json",
			}),
		).toThrow(/classification=missing-envelope/);
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: reportContract,
				envelope: {
					...envelope,
					run_id: " ",
				},
			}),
		).toThrow(/classification=missing-run-id/);
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: reportContract,
				envelope: {
					...envelope,
					extra: true,
				},
			}),
		).toThrow(/classification=unsupported-field fields=extra/);
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: reportContract,
				envelope: {
					...envelope,
					runtime_actions: [
						{
							id: "inspect-report",
							summary: "Inspect report output.",
							side_effects: ["check"],
						},
					],
				},
			}),
		).toThrow(/classification=invalid-success-envelope/);
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: reportContract,
				envelope: {
					...envelope,
					runtime_actions: [
						{
							id: "inspect-report",
							summary: "Inspect report output.",
							side_effects: ["check"],
						},
					],
					continuation: { next_action_id: "inspect-report" },
					diagnostic_trail: {
						run_id: "run-test-1",
						summary: "Report diagnostics captured.",
						surface: { kind: "diagnostic_capability", id: "report" },
					},
				},
			}),
		).not.toThrow();
		expect(() =>
			assertCommandResultContract({
				command: "report",
				contract: reportContract,
				envelope: {
					status: "error",
					run_id: "run-test-1",
					data: createCommandResultData(reportContract, { total: 1 }),
				},
			}),
		).toThrow(/command=report classification=not-success-envelope/);
	});

	test("asserts JSON error envelopes against the runtime contract", () => {
		const envelope = {
			status: "error",
			run_id: "run-test-1",
			error: {
				run_id: "run-test-1",
				code: "config_missing",
				message: "Config is missing.",
				exit_code: 1,
				severity: "error",
				recoverability: "repair_state",
				retryable: false,
				failure_domain: "workspace_config",
			},
			duration_ms: 42,
		} as const;

		const writtenEnvelope = assertJsonErrorEnvelope(envelope, {
			code: "config_missing",
			recoverability: "repair_state",
			processExitCode: 1,
			runId: "run-test-1",
			failureDomain: "workspace_config",
		});
		const _durationMs: number | undefined = writtenEnvelope.duration_ms;
		expect(_durationMs).toBe(42);
		expect(writtenEnvelope).toBe(envelope);
		expect(() =>
			assertJsonErrorEnvelope(
				{
					...envelope,
					duration_ms: Number.NaN,
				},
				{
					code: "config_missing",
					recoverability: "repair_state",
					processExitCode: 1,
				},
			),
		).toThrow(/duration_ms must be a non-negative number/);
		expect(() =>
			assertJsonErrorEnvelope(
				{
					...envelope,
					error: { ...envelope.error, retryable: true },
				},
				{
					code: "config_missing",
					recoverability: "repair_state",
					processExitCode: 1,
				},
			),
		).toThrow(/retryable true requires recoverability retry/);
		expect(() =>
			assertJsonErrorEnvelope(
				{ ...envelope, status: "ok" },
				{
					code: "config_missing",
					recoverability: "repair_state",
					processExitCode: 1,
				},
			),
		).toThrow(/status=error/);
		expect(() =>
			assertJsonErrorEnvelope(
				{ ...envelope, runtime_actions: [] },
				{
					code: "config_missing",
					recoverability: "repair_state",
					processExitCode: 1,
				},
			),
		).toThrow(/runtime_actions must be omitted/);
		expect(() =>
			assertJsonErrorEnvelope(
				{ ...envelope, unsupported_field: true },
				{
					code: "config_missing",
					recoverability: "repair_state",
					processExitCode: 1,
				},
			),
		).toThrow(/unsupported field/);
		expect(() =>
			assertJsonErrorEnvelope(envelope, {
				code: "usage_error",
				recoverability: "repair_state",
				processExitCode: 1,
			}),
		).toThrow(/code mismatch: expected=usage_error actual=config_missing/);
		expect(() =>
			assertJsonErrorEnvelope(envelope, {
				code: "config_missing",
				recoverability: "repair_state",
				runId: "run-other",
				processExitCode: 1,
			}),
		).toThrow(/run_id mismatch: expected=run-other actual=run-test-1/);
		expect(() =>
			assertJsonErrorEnvelope(envelope, {
				code: "config_missing",
				recoverability: "repair_state",
				processExitCode: 2,
			}),
		).toThrow(/error.exit_code must match process_exit_code/);
		expect(() =>
			assertJsonErrorEnvelope(
				{ ...envelope, data: { note: "missing contract metadata" } },
				{
					code: "config_missing",
					recoverability: "repair_state",
					processExitCode: 1,
					errorResultContract: {
						id: "example.error",
						schema_version: 1,
					},
				},
			),
		).toThrow(/metadata missing/);
		expect(() =>
			assertJsonErrorEnvelope(envelope, {
				code: "config_missing",
				recoverability: "repair_state",
				processExitCode: 1,
				errorResultContract: {
					id: "example.error",
					schema_version: 1,
				},
			}),
		).toThrow(/missing data/);
		expect(() =>
			assertJsonErrorEnvelope(
				{
					...envelope,
					data: { contract_id: "example.report", schema_version: 1 },
				},
				{
					code: "config_missing",
					recoverability: "repair_state",
					processExitCode: 1,
				},
			),
		).toThrow(/requires errorResultContract/);
		expect(
			assertJsonErrorEnvelope(
				{
					...envelope,
					data: { contract_id: "example.error", schema_version: 1 },
				},
				{
					code: "config_missing",
					recoverability: "repair_state",
					processExitCode: 1,
					errorResultContract: {
						id: "example.error",
						schema_version: 1,
					},
				},
			).data,
		).toEqual({ contract_id: "example.error", schema_version: 1 });
		expect(() =>
			assertJsonErrorEnvelope(
				{
					...envelope,
					data: { contract_id: "example.error", schema_version: 2 },
				},
				{
					code: "config_missing",
					recoverability: "repair_state",
					processExitCode: 1,
					errorResultContract: {
						id: "example.error",
						schema_version: 1,
					},
				},
			),
		).toThrow(/schema_version mismatch/);
		expect(() =>
			assertJsonErrorEnvelope(
				{
					...envelope,
					runtime_actions: [
						{
							id: "repair-config",
							summary: "Repair config file.",
							side_effects: ["write"],
						},
					],
					continuation: { next_action_id: "repair-config" },
					diagnostic_trail: {
						run_id: "run-test-1",
						summary: "Config diagnostics captured.",
						surface: { kind: "diagnostic_capability", id: "report" },
					},
				},
				{
					code: "config_missing",
					recoverability: "repair_state",
					processExitCode: 1,
					failureDomain: "workspace_config",
				},
			),
		).not.toThrow();
	});

	test("rejects empty public argv case lists", async () => {
		await expect(
			runCommandSurfaceCases({
				runner: async () => ({ exitCode: 0 }),
				cases: [],
			}),
		).rejects.toThrow(/at least one case/);
	});

	test("runs labeled public argv cases through a caller-owned runner", async () => {
		const calls: string[][] = [];

		await runCommandSurfaceCases({
			runner: async (argv) => {
				calls.push([...argv]);
				return { argv };
			},
			cases: [
				{
					label: "json report",
					argv: ["report", "--json"],
					assert: (result) => {
						expect(result.argv).toEqual(["report", "--json"]);
					},
				},
				{
					label: "plain report",
					argv: ["report", "--plain"],
					assert: (result, context) => {
						expect(context.label).toBe("plain report");
						expect(result.argv).toEqual(["report", "--plain"]);
					},
				},
			],
		});

		expect(calls).toEqual([
			["report", "--json"],
			["report", "--plain"],
		]);
	});

	test("annotates callback failures with the case label and argv", async () => {
		await expect(
			runCommandSurfaceCases({
				runner: async () => ({ exitCode: 0 }),
				cases: [
					{
						label: "bad assertion",
						argv: ["report", "--plain"],
						assert: () => {
							throw new Error("expected another result");
						},
					},
				],
			}),
		).rejects.toThrow(
			/label=bad assertion argv=\["report","--plain"\]\nexpected another result/,
		);
	});

	test("preserves callback failures as the wrapped error cause", async () => {
		const failure = new Error("expected another result");
		let wrapped: unknown;

		try {
			await runCommandSurfaceCases({
				runner: async () => ({ exitCode: 0 }),
				cases: [
					{
						label: "bad assertion",
						argv: ["report", "--plain"],
						assert: () => {
							throw failure;
						},
					},
				],
			});
		} catch (error) {
			wrapped = error;
		}

		expect(wrapped).toBeInstanceOf(Error);
		expect((wrapped as Error & { cause?: unknown }).cause).toBe(failure);
	});

	test("annotates runner failures with the case label and argv", async () => {
		await expect(
			runCommandSurfaceCases({
				runner: async () => {
					throw new Error("runner failed");
				},
				cases: [
					{
						label: "runner failure",
						argv: ["report", "--json"],
						assert: () => {},
					},
				],
			}),
		).rejects.toThrow(
			/label=runner failure argv=\["report","--json"\]\nrunner failed/,
		);
	});

	test("annotates runner failures with the original argv snapshot", async () => {
		const argv = ["report", "--json"];

		await expect(
			runCommandSurfaceCases({
				runner: async (runnerArgv) => {
					(runnerArgv as string[]).push("--mutated");
					throw new Error("runner failed");
				},
				cases: [
					{
						label: "runner failure",
						argv,
						assert: () => {},
					},
				],
			}),
		).rejects.toThrow(
			/label=runner failure argv=\["report","--json"\]\nrunner failed/,
		);
		expect(argv).toEqual(["report", "--json"]);
	});

	test("annotates callback failures with the original argv snapshot", async () => {
		await expect(
			runCommandSurfaceCases({
				runner: async () => ({ exitCode: 0 }),
				cases: [
					{
						label: "bad assertion",
						argv: ["report", "--plain"],
						assert: (_result, context) => {
							(context.argv as string[]).push("--mutated");
							throw new Error("expected another result");
						},
					},
				],
			}),
		).rejects.toThrow(
			/label=bad assertion argv=\["report","--plain"\]\nexpected another result/,
		);
	});

	test("passes result objects through without inspecting package meaning", async () => {
		const output = {
			exitCode: 77,
			stdout: "{not-json",
			stderr: "package-owned",
			runtimeActionIds: ["package-owned-action"],
		};

		await runCommandSurfaceCases({
			runner: async () => output,
			cases: [
				{
					label: "opaque result",
					argv: ["report", "--json"],
					assert: (result) => {
						expect(result).toBe(output);
					},
				},
			],
		});
	});
});
