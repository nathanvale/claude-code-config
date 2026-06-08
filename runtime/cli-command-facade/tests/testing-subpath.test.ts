import { describe, expect, test } from "bun:test";
import {
	type CommandFacadeContract,
	renderCommandUsage,
} from "@side-quest/cli-command-facade";
import {
	assertCommandHelpFlagSurface,
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
		expect(() =>
			assertCommandHelpFlagSurface({
				command: "report",
				contract: {
					...jsonContract,
					usage: ["report", "report [--json=<mode>]"],
				},
				help: "Usage: report\n       report [--json=<mode>]\n",
			}),
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
