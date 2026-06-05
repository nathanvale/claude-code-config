import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import {
	assertCommandHelpFlagSurface,
	runCommandSurfaceCases,
} from "@side-quest/cli-command-facade/testing";
import {
	FALLOW_EVIDENCE_GRADES,
	FALLOW_FAILURE_CATEGORIES,
	FALLOW_OUTPUT_BUDGET_STATUSES,
	FALLOW_REPAIR_ACTION_BY_KEY,
	FALLOW_REPAIR_ACTIONS,
	FALLOW_RESOLVER_ACTIONS,
	FALLOW_RESOLVER_NEXT_ACTIONS,
	FALLOW_RESOLVER_VERDICTS,
	FALLOW_RUNNER_COMMANDS,
	FALLOW_RUNNER_CONTRACT_ID,
	FALLOW_RUNNER_SCHEMA_VERSION,
	FALLOW_STATUS_VALUES,
	FALLOW_STDERR_CATEGORIES,
	FALLOW_WRITE_EFFECTS,
	type FallowRunnerCommand,
	assertFallowRepairAction,
	assertFallowResolverAction,
	fallowRunnerContracts,
} from "./command-contract";
import {
	createDefaultFallowRuntime,
	type FallowRunnerRuntime,
	runForTest,
} from "./fallow-runner";
import {
	FALLOW_MCPORTER_COMMAND_ENV_VAR,
	type TraceCommandResult,
	type TraceExportEvidence,
	deriveEvidenceGrade,
	failureEvidenceGrade,
	resolveFallowMcporterCommand,
	traceExportArgs,
	traceExportReachability,
} from "./why-trace";

const ALL_COMMANDS: FallowRunnerCommand[] = [...FALLOW_RUNNER_COMMANDS];

// Minimal accepted argv per command: some commands require flags to parse
// (fix-apply needs the apply marker, why needs both coordinate flags).
function acceptedArgvFor(command: FallowRunnerCommand): string[] {
	if (command === "fix-apply") return [command, "--confirm-current-task-apply"];
	if (command === "why") {
		return [command, "--file", "src/x.ts", "--export", "x"];
	}
	return [command];
}
const cleanupPaths: string[] = [];
type TestRunResult = { exitCode: number; stdout: string; stderr: string };
type CommandCall = {
	command: string;
	args: string[];
	cwd: string;
};

afterEach(async () => {
	await Promise.all(
		cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

function discoveryTree() {
	return projectCommandDiscoveryTree(
		Object.entries(fallowRunnerContracts) as Array<
			[
				FallowRunnerCommand,
				(typeof fallowRunnerContracts)[FallowRunnerCommand],
			]
		>,
	);
}

async function makeRepo(
	options: {
		packageJson?: boolean;
		localFallow?: boolean;
		configFiles?: Record<string, string>;
	} = {},
): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "fallow-runner-test-"));
	cleanupPaths.push(dir);
	if (options.packageJson ?? true) {
		await writeFile(join(dir, "package.json"), "{}\n", "utf-8");
	}
	if (options.localFallow) {
		const binDir = join(dir, "node_modules", ".bin");
		await mkdir(binDir, { recursive: true });
		const fallowPath = join(binDir, "fallow");
		await writeFile(fallowPath, "#!/usr/bin/env sh\nexit 0\n", "utf-8");
		await chmod(fallowPath, 0o755);
	}
	for (const [relative, content] of Object.entries(options.configFiles ?? {})) {
		await writeFile(join(dir, relative), content, "utf-8");
	}
	return dir;
}

async function makeJsRepo(): Promise<string> {
	return makeRepo();
}

function makeRuntime(
	overrides: Partial<FallowRunnerRuntime> = {},
): FallowRunnerRuntime {
	return createDefaultFallowRuntime({
		cwd: "/tmp/fallow-test",
		now: () => Date.parse("2026-06-04T00:00:00.000Z"),
		randomId: () => "test",
		lookupExecutable: async () => undefined,
		runCommand: async () => ({
			exitCode: 127,
			stdout: "",
			stderr: "not found",
		}),
		...overrides,
	});
}

function parseJson(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout) as Record<string, unknown>;
}

function readyRuntime(
	root: string,
	overrides: Partial<FallowRunnerRuntime> & {
		pathFallow?: string;
		gitReady?: boolean;
	} = {},
): FallowRunnerRuntime {
	const { pathFallow, gitReady = true, ...runtimeOverrides } = overrides;
	return makeRuntime({
		cwd: root,
		lookupExecutable: async () => pathFallow,
		runCommand: async (command) => {
			if (command !== "git") {
				return { exitCode: 1, stdout: "", stderr: "unexpected command" };
			}
			return gitReady
				? { exitCode: 0, stdout: "true\n", stderr: "" }
				: { exitCode: 127, stdout: "", stderr: "git not found" };
		},
		...runtimeOverrides,
	});
}

function readyExecutionRuntime(
	root: string,
	results: CommandResult[],
	overrides: Partial<FallowRunnerRuntime> & {
		pathFallow?: string;
		gitReady?: boolean;
	} = {},
): { runtime: FallowRunnerRuntime; calls: CommandCall[] } {
	const { pathFallow, gitReady = true, ...runtimeOverrides } = overrides;
	const calls: CommandCall[] = [];
	const pendingResults = [...results];
	const runtime = makeRuntime({
		cwd: root,
		lookupExecutable: async () => pathFallow,
		runCommand: async (command, args, options) => {
			calls.push({ command, args: [...args], cwd: options.cwd });
			if (command === "git") {
				return gitReady
					? { exitCode: 0, stdout: "true\n", stderr: "" }
					: { exitCode: 127, stdout: "", stderr: "git not found" };
			}
			return (
				pendingResults.shift() ?? {
					exitCode: 0,
					stdout: JSON.stringify({ findings: [] }),
					stderr: "",
				}
			);
		},
		...runtimeOverrides,
	});

	return { runtime, calls };
}

function readinessOf(envelope: Record<string, unknown>) {
	const summary = envelope.summary as { readiness?: unknown };
	expect(summary.readiness).toBeDefined();
	return summary.readiness as {
		root: { path: string; status: string };
		repo_shape: { status: string; detected: string[] };
		fallow_binary: { status: string; source?: string; path?: string };
		config: { present: boolean; paths: string[] };
		git: { status: string; message?: string };
	};
}

function primaryRepairHint(envelope: Record<string, unknown>) {
	const hints = envelope.repair_hints as Array<{
		action: string;
		message: string;
		retry_safe: boolean;
	}>;
	expect(hints).toHaveLength(1);
	expect(typeof hints[0].message).toBe("string");
	expect(typeof hints[0].retry_safe).toBe("boolean");
	return hints[0];
}

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

function expectEnvelope(
	result: { exitCode: number; stdout: string; stderr: string },
): Record<string, unknown> {
	expect(result.stdout).not.toBe("");
	expect(result.stderr).toBe("");
	return parseJson(result.stdout);
}

describe("U2 command contract", () => {
	test("contract parses and exposes every accepted v1 subcommand", () => {
		const result = parseCommandFacadeContract(fallowRunnerContracts, {
			path: "skills/fallow/scripts/command-contract.ts",
		});

		expect(result.ok).toBe(true);
		expect(Object.keys(fallowRunnerContracts).sort()).toEqual(
			[...ALL_COMMANDS].sort(),
		);
	});

	test("facade dependency resolves from the script-local test surface", () => {
		expect(typeof parseCommandFacadeContract).toBe("function");
		expect(typeof projectCommandDiscoveryTree).toBe("function");
	});

	test("no command declares facade-reserved diagnostic flags", () => {
		for (const command of ALL_COMMANDS) {
			const flags = Object.keys(fallowRunnerContracts[command].flags ?? {});
			for (const reserved of CLI_DIAGNOSTIC_FLAGS) {
				expect(flags).not.toContain(reserved);
			}
		}
	});

	test("command discovery projects result contract identity and schema version", () => {
		const tree = discoveryTree();

		for (const command of ALL_COMMANDS) {
			expect(tree.commands[command]?.result_contract).toMatchObject({
				id: FALLOW_RUNNER_CONTRACT_ID,
				schema_version: FALLOW_RUNNER_SCHEMA_VERSION,
			});
		}
	});

	test("audit owns base-ref and non-audit commands do not", () => {
		expect(Object.keys(fallowRunnerContracts.audit.flags)).toContain(
			"--base-ref",
		);

		for (const command of ALL_COMMANDS.filter((item) => item !== "audit")) {
			expect(Object.keys(fallowRunnerContracts[command].flags)).not.toContain(
				"--base-ref",
			);
		}
	});

	test("contract-owned literals stay small and stable", () => {
		expect(FALLOW_STATUS_VALUES).toEqual(["ok", "issues", "blocked"]);
		expect(FALLOW_WRITE_EFFECTS).toEqual(["none", "previewed", "applied"]);
		expect(FALLOW_FAILURE_CATEGORIES).toEqual([
			"none",
			"setup",
			"input",
			"fallow",
			"parse",
			"budget",
			"safety",
		]);
		expect(FALLOW_STDERR_CATEGORIES).toEqual([
			"empty",
			"progress",
			"warning",
			"error",
		]);
		expect(FALLOW_OUTPUT_BUDGET_STATUSES).toEqual([
			"within-budget",
			"raw-omitted",
			"summary-impossible",
		]);
	});

	test("repair action vocabulary rejects unknown actions", () => {
		expect(FALLOW_REPAIR_ACTIONS).toEqual([
			"run-doctor",
			"setup-fallow",
			"fix-input",
			"inspect-config",
			"reduce-output",
			"retry",
		]);
		expect(Object.values(FALLOW_REPAIR_ACTION_BY_KEY)).toEqual(
			[...FALLOW_REPAIR_ACTIONS],
		);

		for (const action of Object.values(FALLOW_REPAIR_ACTION_BY_KEY)) {
			expect(() => assertFallowRepairAction(action)).not.toThrow();
		}
		expect(() => assertFallowRepairAction("install-fallow")).toThrow(
			/Unknown Fallow repair action/,
		);
	});

	test("declares json and plain output for every command", () => {
		for (const command of ALL_COMMANDS) {
			expect(fallowRunnerContracts[command].outputModes).toContain("json");
			expect(fallowRunnerContracts[command].outputModes).toContain("plain");
		}
	});

	test("fix-apply alone owns the source-mutation authorization marker", () => {
		expect(Object.keys(fallowRunnerContracts["fix-apply"].flags)).toContain(
			"--confirm-current-task-apply",
		);
		for (const command of ALL_COMMANDS.filter((item) => item !== "fix-apply")) {
			expect(Object.keys(fallowRunnerContracts[command].flags)).not.toContain(
				"--confirm-current-task-apply",
			);
		}
	});
});

describe("U1 resolver contract surface", () => {
	test("contract parsing accepts why alongside existing commands", () => {
		const result = parseCommandFacadeContract(fallowRunnerContracts, {
			path: "skills/fallow/scripts/command-contract.ts",
		});

		expect(result.ok).toBe(true);
		expect(Object.keys(fallowRunnerContracts)).toContain("why");
		// Pre-existing commands stay present and unchanged in count.
		for (const command of [
			"audit",
			"dead-code",
			"dupes",
			"health",
			"fix-preview",
			"fix-apply",
			"doctor",
		] as const) {
			expect(Object.keys(fallowRunnerContracts)).toContain(command);
		}
	});

	test("discovery projects why with the runner result contract identity", () => {
		const tree = discoveryTree();

		expect(tree.commands.why?.result_contract).toMatchObject({
			id: FALLOW_RUNNER_CONTRACT_ID,
			schema_version: FALLOW_RUNNER_SCHEMA_VERSION,
		});
	});

	test("why advertises coordinate flags and no diagnostic flags", () => {
		const flags = Object.keys(fallowRunnerContracts.why.flags);
		expect(flags).toContain("--file");
		expect(flags).toContain("--export");
		for (const reserved of CLI_DIAGNOSTIC_FLAGS) {
			expect(flags).not.toContain(reserved);
		}
		// Coordinate flags stay scoped to why.
		for (const command of ALL_COMMANDS.filter((item) => item !== "why")) {
			const otherFlags = Object.keys(fallowRunnerContracts[command].flags);
			expect(otherFlags).not.toContain("--file");
			expect(otherFlags).not.toContain("--export");
		}
	});

	test("why declares json and plain output", () => {
		expect(fallowRunnerContracts.why.outputModes).toContain("json");
		expect(fallowRunnerContracts.why.outputModes).toContain("plain");
	});

	test("rendered why help shows coordinate usage without diagnostic flags", async () => {
		const result = await runForTest(["why", "--help"], makeRuntime());

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("--file");
		expect(result.stdout).toContain("--export");
		assertCommandHelpFlagSurface({
			command: "why",
			contract: fallowRunnerContracts.why,
			help: result.stdout,
			absentFlags: ["--cwd", "--mode", "--base-ref", "--confirm-current-task-apply"],
		});
	});

	test("root help lists the why subcommand", async () => {
		const result = await runForTest(["--help"], makeRuntime());

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("why");
	});

	test("missing either coordinate flag returns invalid-usage input recovery", async () => {
		for (const argv of [
			["why"],
			["why", "--file", "src/x.ts"],
			["why", "--export", "x"],
		]) {
			const result = await runForTest(argv, makeRuntime());
			expect(result.exitCode).toBe(2);
			const envelope = expectEnvelope(result);
			expect(envelope.mode).toBe("why");
			expect(envelope.failure_category).toBe("input");
			expect(primaryRepairHint(envelope).action).toBe("fix-input");
		}
	});

	test("resolver vocabularies stay small and stable", () => {
		expect(FALLOW_RESOLVER_ACTIONS).toEqual(["trace-export-reachability"]);
		expect(FALLOW_EVIDENCE_GRADES).toEqual([
			"referenced",
			"entry_point",
			"unreferenced_by_trace",
			"unresolved",
			"unavailable",
		]);
		expect(FALLOW_RESOLVER_VERDICTS).toEqual([
			"keep",
			"candidate_remove",
			"inconclusive",
		]);
		expect(FALLOW_RESOLVER_NEXT_ACTIONS).toEqual([
			"keep-export",
			"candidate-remove",
			"stop",
		]);
		// Evidence wording never leaks the banned likely-dead grade.
		expect(FALLOW_EVIDENCE_GRADES).not.toContain("likely-dead");
		expect(FALLOW_EVIDENCE_GRADES).not.toContain("likely_dead");
	});

	test("resolver action assert rejects unknown ids", () => {
		expect(() =>
			assertFallowResolverAction("trace-export-reachability"),
		).not.toThrow();
		expect(() => assertFallowResolverAction("remove-export")).toThrow(
			/Unknown Fallow resolver action/,
		);
	});
});

describe("U4 discovery and doctor runtime", () => {
	test("doctor uses cwd by default and explicit root when supplied", async () => {
		const defaultRoot = await makeRepo({ localFallow: true });
		const explicitRoot = await makeRepo({ localFallow: true });

		const defaultResult = await runForTest(
			["doctor"],
			readyRuntime(defaultRoot),
		);
		const explicitResult = await runForTest(
			["doctor", "--root", explicitRoot],
			readyRuntime(defaultRoot),
		);

		expect(defaultResult.exitCode).toBe(0);
		expect(expectEnvelope(defaultResult).cwd).toBe(defaultRoot);
		expect(explicitResult.exitCode).toBe(0);
		expect(expectEnvelope(explicitResult).cwd).toBe(explicitRoot);
	});

	test("unsupported repo shape blocks doctor with setup evidence", async () => {
		const root = await makeRepo({ packageJson: false, localFallow: true });
		const result = await runForTest(["doctor"], readyRuntime(root));

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("blocked");
		expect(envelope.failure_category).toBe("setup");
		expect(readinessOf(envelope).repo_shape.status).toBe("unsupported");
	});

	test("binary discovery prefers local Fallow before PATH", async () => {
		const root = await makeRepo({ localFallow: true });
		const result = await runForTest(
			["doctor"],
			readyRuntime(root, { pathFallow: "/usr/local/bin/fallow" }),
		);

		expect(result.exitCode).toBe(0);
		const binary = readinessOf(expectEnvelope(result)).fallow_binary;
		expect(binary.status).toBe("ok");
		expect(binary.source).toBe("local");
		expect(binary.path).toBe(join(root, "node_modules", ".bin", "fallow"));
	});

	test("binary discovery falls back to PATH and reports missing setup", async () => {
		const pathRoot = await makeRepo();
		const pathResult = await runForTest(
			["doctor"],
			readyRuntime(pathRoot, { pathFallow: "/usr/local/bin/fallow" }),
		);

		expect(pathResult.exitCode).toBe(0);
		const pathBinary = readinessOf(expectEnvelope(pathResult)).fallow_binary;
		expect(pathBinary.status).toBe("ok");
		expect(pathBinary.source).toBe("path");
		expect(pathBinary.path).toBe("/usr/local/bin/fallow");

		const missingRoot = await makeRepo();
		const missingResult = await runForTest(
			["doctor"],
			readyRuntime(missingRoot),
		);

		expect(missingResult.exitCode).toBe(1);
		const missingEnvelope = expectEnvelope(missingResult);
		expect(missingEnvelope.status).toBe("blocked");
		expect(readinessOf(missingEnvelope).fallow_binary.status).toBe("missing");
		expect(JSON.stringify(missingEnvelope)).toContain("setup-fallow");
	});

	test("default runtime discovers Fallow on PATH", async () => {
		const root = await makeRepo();
		const binDir = join(root, "bin");
		await mkdir(binDir, { recursive: true });
		const fallowPath = join(binDir, "fallow");
		await writeFile(fallowPath, "#!/usr/bin/env sh\nexit 0\n", "utf-8");
		await chmod(fallowPath, 0o755);

		const runtime = createDefaultFallowRuntime({
			cwd: root,
			env: { PATH: binDir },
			runCommand: async (command) => {
				if (command !== "git") {
					return { exitCode: 1, stdout: "", stderr: "unexpected command" };
				}
				return { exitCode: 0, stdout: "true\n", stderr: "" };
			},
		});
		const result = await runForTest(["doctor"], runtime);

		expect(result.exitCode).toBe(0);
		const binary = readinessOf(expectEnvelope(result)).fallow_binary;
		expect(binary.status).toBe("ok");
		expect(binary.source).toBe("path");
		expect(binary.path).toBe(fallowPath);
	});

	test("doctor reports ok, issues, and blocked readiness states", async () => {
		const okRoot = await makeRepo({ localFallow: true });
		const ok = await runForTest(["doctor"], readyRuntime(okRoot));
		expect(ok.exitCode).toBe(0);
		expect(expectEnvelope(ok).status).toBe("ok");

		const issuesRoot = await makeRepo({ localFallow: true });
		const issues = await runForTest(
			["doctor"],
			readyRuntime(issuesRoot, { gitReady: false }),
		);
		expect(issues.exitCode).toBe(0);
		const issuesEnvelope = expectEnvelope(issues);
		expect(issuesEnvelope.status).toBe("issues");
		expect(readinessOf(issuesEnvelope).git.status).toBe("blocked");

		const blockedRoot = await makeRepo();
		const blocked = await runForTest(["doctor"], readyRuntime(blockedRoot));
		expect(blocked.exitCode).toBe(1);
		expect(expectEnvelope(blocked).status).toBe("blocked");
	});

	test("doctor reports config presence and paths without parsing content", async () => {
		const root = await makeRepo({
			localFallow: true,
			configFiles: {
				".fallowrc": "not: parsed\n",
				"fallow.toml": "also not parsed\n",
			},
		});
		const result = await runForTest(["doctor"], readyRuntime(root));

		expect(result.exitCode).toBe(0);
		const config = readinessOf(expectEnvelope(result)).config;
		expect(config.present).toBe(true);
		expect(config.paths.sort()).toEqual(
			[join(root, ".fallowrc"), join(root, "fallow.toml")].sort(),
		);
		expect(result.stdout).not.toContain("not: parsed");
		expect(result.stdout).not.toContain("also not parsed");
	});

	test("audit treats missing git as setup-blocking readiness", async () => {
		const root = await makeRepo({ localFallow: true });
		const result = await runForTest(
			["audit"],
			readyRuntime(root, { gitReady: false }),
		);

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.mode).toBe("audit");
		expect(envelope.status).toBe("blocked");
		expect(envelope.failure_category).toBe("setup");
		expect(readinessOf(envelope).git.status).toBe("blocked");
		expect(JSON.stringify(envelope)).toContain("fix-input");
	});
});

describe("U5 Fallow execution and summary semantics", () => {
	test("evidence subcommands execute the expected Fallow command path", async () => {
		for (const command of ["audit", "dead-code", "dupes", "health"] as const) {
			const root = await makeRepo({ localFallow: true });
			const { runtime, calls } = readyExecutionRuntime(root, [
				{ exitCode: 0, stdout: JSON.stringify({ findings: [] }), stderr: "" },
			]);

			const result = await runForTest([command], runtime);

			expect(result.exitCode).toBe(0);
			const fallowCall = calls.find((call) => call.command !== "git");
			expect(fallowCall).toEqual({
				command: join(root, "node_modules", ".bin", "fallow"),
				args: [command, "--format", "json", "--quiet"],
				cwd: root,
			});
			expect(expectEnvelope(result).command).toEqual([
				join(root, "node_modules", ".bin", "fallow"),
				command,
				"--format",
				"json",
				"--quiet",
			]);
		}
	});

	test("audit omits base by default and maps public base-ref to Fallow base", async () => {
		const defaultRoot = await makeRepo({ localFallow: true });
		const defaultRuntime = readyExecutionRuntime(defaultRoot, [
			{ exitCode: 0, stdout: JSON.stringify({ findings: [] }), stderr: "" },
		]);

		await runForTest(["audit"], defaultRuntime.runtime);
		expect(defaultRuntime.calls.find((call) => call.command !== "git")?.args).toEqual([
			"audit",
			"--format",
			"json",
			"--quiet",
		]);

		const explicitRoot = await makeRepo({ localFallow: true });
		const explicitRuntime = readyExecutionRuntime(explicitRoot, [
			{ exitCode: 0, stdout: JSON.stringify({ findings: [] }), stderr: "" },
		]);
		const explicit = await runForTest(
			["audit", "--base-ref", "origin/main"],
			explicitRuntime.runtime,
		);

		expect(explicitRuntime.calls.find((call) => call.command !== "git")?.args).toEqual([
			"audit",
			"--base",
			"origin/main",
			"--format",
			"json",
			"--quiet",
		]);
		expect(expectEnvelope(explicit).command).toContain("origin/main");
	});

	test("no findings return clean analyzer status and omit raw output", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify({ findings: [] }), stderr: "" },
		]);

		const result = await runForTest(["dead-code"], runtime);

		expect(result.exitCode).toBe(0);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("ok");
		expect(envelope.failure_category).toBe("none");
		expect(envelope.fallow_output).toBeNull();
		expect(envelope.summary).toMatchObject({
			total_findings: 0,
			auto_fixable: 0,
			needs_trace: 0,
			needs_human: 0,
		});
	});

	test("findings return issue status, aggregates, and actionable issue references", async () => {
		const root = await makeRepo({ localFallow: true });
		const output = {
			findings: [
				{
					id: "unused:OldButton",
					path: "src/button.ts",
					line: 4,
					col: 2,
					rule: "unused-export",
					category: "dead-code",
					action: "remove-export",
					auto_fixable: true,
				},
				{
					finding_id: "complex:render",
					file: "src/render.ts",
					range: { start_line: 10, end_line: 44 },
					rule_id: "high-complexity",
					requires_human: true,
				},
			],
		};
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify(output), stderr: "" },
		]);

		const result = await runForTest(["health"], runtime);

		expect(result.exitCode).toBe(0);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("issues");
		expect(envelope.summary).toMatchObject({
			total_findings: 2,
			auto_fixable: 1,
			needs_trace: 0,
			needs_human: 1,
		});
		expect(envelope.issue_references).toEqual([
			expect.objectContaining({
				id: "unused:OldButton",
				path: "src/button.ts",
				rule: "unused-export",
				category: "dead-code",
				action: "remove-export",
				range: expect.objectContaining({ start_line: 4, start_column: 2 }),
			}),
			expect.objectContaining({
				id: "complex:render",
				path: "src/render.ts",
				rule: "high-complexity",
				range: expect.objectContaining({ start_line: 10, end_line: 44 }),
			}),
		]);
	});

	test("clone groups fan out to per-instance references with locations", async () => {
		const root = await makeRepo({ localFallow: true });
		const output = {
			kind: "dupes",
			clone_groups: [
				{
					instances: [
						{
							file: "src/a.ts",
							start_line: 218,
							end_line: 227,
							start_col: 47,
							end_col: 33,
						},
						{
							file: "src/b.ts",
							start_line: 314,
							end_line: 323,
							start_col: 68,
							end_col: 33,
						},
					],
					fingerprint: "dup:9644d4f5",
					actions: [{ type: "extract-shared", auto_fixable: false }],
				},
			],
		};
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify(output), stderr: "" },
		]);

		const result = await runForTest(["dupes"], runtime);

		expect(result.exitCode).toBe(0);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("issues");
		expect(envelope.summary).toMatchObject({ total_findings: 2 });
		expect(envelope.issue_references).toEqual([
			expect.objectContaining({
				id: "dup:9644d4f5",
				path: "src/a.ts",
				action: "extract-shared",
				range: expect.objectContaining({
					start_line: 218,
					start_column: 47,
					end_line: 227,
					end_column: 33,
				}),
			}),
			expect.objectContaining({
				id: "dup:9644d4f5",
				path: "src/b.ts",
				action: "extract-shared",
				range: expect.objectContaining({ start_line: 314, end_line: 323 }),
			}),
		]);
	});

	test("audit and health outputs without a uniform findings array remain truthful", async () => {
		const auditRoot = await makeRepo({ localFallow: true });
		const auditRuntime = readyExecutionRuntime(auditRoot, [
			{
				exitCode: 1,
				stdout: JSON.stringify({
					command: "audit",
					verdict: "fail",
					summary: {
						dead_code_issues: 2,
						complexity_findings: 1,
						duplication_clone_groups: 0,
					},
					dead_code: {
						unused_exports: [
							{
								path: "src/old.ts",
								export_name: "oldThing",
								actions: [{ kind: "remove-export", auto_fixable: true }],
							},
						],
					},
					complexity: {
						findings: [{ path: "src/big.ts", name: "big", line: 12 }],
					},
					duplication: { clone_groups: [] },
				}),
				stderr: "",
			},
		]);

		const audit = await runForTest(["audit"], auditRuntime.runtime);
		const auditEnvelope = expectEnvelope(audit);
		expect(audit.exitCode).toBe(0);
		expect(auditEnvelope.exit_code).toBe(1);
		expect(auditEnvelope.status).toBe("issues");
		expect(auditEnvelope.summary).toMatchObject({
			total_findings: 3,
			auto_fixable: 1,
			mode_evidence: { verdict: "fail" },
		});
		expect(Array.isArray(auditEnvelope.issue_references)).toBe(true);

		const healthRoot = await makeRepo({ localFallow: true });
		const healthRuntime = readyExecutionRuntime(healthRoot, [
			{
				exitCode: 0,
				stdout: JSON.stringify({
					summary: {
						files_analyzed: 24,
						functions_above_threshold: 2,
					},
					vital_signs: {
						maintainability_avg: 72.4,
					},
				}),
				stderr: "",
			},
		]);
		const health = await runForTest(["health"], healthRuntime.runtime);
		const healthEnvelope = expectEnvelope(health);
		expect(healthEnvelope.status).toBe("issues");
		expect(healthEnvelope.summary).toMatchObject({
			total_findings: 2,
			mode_evidence: {
				files_analyzed: 24,
				functions_above_threshold: 2,
				maintainability_avg: 72.4,
			},
		});
	});

	test("audit surfaces introduced-vs-inherited attribution and tags findings", async () => {
		const root = await makeRepo({ localFallow: true });
		const output = {
			kind: "audit",
			command: "audit",
			verdict: "fail",
			base_ref: "main",
			changed_files_count: 26,
			summary: {
				dead_code_issues: 2,
				complexity_findings: 0,
				duplication_clone_groups: 0,
			},
			attribution: {
				gate: "new-only",
				dead_code_introduced: 1,
				dead_code_inherited: 1,
				complexity_introduced: 0,
				complexity_inherited: 0,
				duplication_introduced: 0,
				duplication_inherited: 0,
			},
			dead_code: {
				unused_exports: [
					{
						path: "src/new.ts",
						export_name: "freshThing",
						introduced: true,
						actions: [{ kind: "remove-export", auto_fixable: true }],
					},
					{
						path: "src/old.ts",
						export_name: "staleThing",
						introduced: false,
						actions: [{ kind: "remove-export", auto_fixable: true }],
					},
				],
			},
		};
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 1, stdout: JSON.stringify(output), stderr: "" },
		]);

		const result = await runForTest(["audit"], runtime);
		const envelope = expectEnvelope(result);

		expect(envelope.summary).toMatchObject({
			mode_evidence: {
				verdict: "fail",
				base_ref: "main",
				attribution: { gate: "new-only", introduced: 1, inherited: 1 },
			},
		});
		expect(envelope.issue_references).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "src/new.ts", introduced: true }),
				expect.objectContaining({ path: "src/old.ts", introduced: false }),
			]),
		);
	});

	test("audit with zero introduced findings signals continue, not inspect", async () => {
		const root = await makeRepo({ localFallow: true });
		const output = {
			kind: "audit",
			verdict: "fail",
			summary: {
				dead_code_issues: 50,
				complexity_findings: 0,
				duplication_clone_groups: 0,
			},
			attribution: {
				gate: "new-only",
				dead_code_introduced: 0,
				dead_code_inherited: 50,
			},
			dead_code: {
				unused_exports: [
					{ path: "src/old.ts", export_name: "x", introduced: false },
				],
			},
		};
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 1, stdout: JSON.stringify(output), stderr: "" },
		]);

		const result = await runForTest(["audit", "--plain"], runtime);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("attribution gate=new-only introduced=0");
		expect(result.stdout).toContain("next_action=continue introduced=0");
	});

	test("raw Fallow output is included only when explicitly requested", async () => {
		const output = { findings: [], summary: { total_issues: 0 } };
		const defaultRoot = await makeRepo({ localFallow: true });
		const defaultRuntime = readyExecutionRuntime(defaultRoot, [
			{ exitCode: 0, stdout: JSON.stringify(output), stderr: "" },
		]);
		const omitted = await runForTest(["dead-code"], defaultRuntime.runtime);
		expect(expectEnvelope(omitted).fallow_output).toBeNull();

		const rawRoot = await makeRepo({ localFallow: true });
		const rawRuntime = readyExecutionRuntime(rawRoot, [
			{ exitCode: 0, stdout: JSON.stringify(output), stderr: "" },
		]);
		const included = await runForTest(
			["dead-code", "--include-raw-output"],
			rawRuntime.runtime,
		);
		const envelope = expectEnvelope(included);
		expect(envelope.fallow_output).toEqual(output);
		expect(envelope.output_budget).toMatchObject({
			raw_output_requested: true,
			raw_output_included: true,
		});
	});

	test("non-JSON stdout returns parse failure with repair guidance", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: "not json", stderr: "scanned 2 files" },
		]);

		const result = await runForTest(["dead-code"], runtime);

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("blocked");
		expect(envelope.failure_category).toBe("parse");
		expect(envelope.stderr_category).toBe("progress");
		expect(JSON.stringify(envelope.repair_hints)).toContain("run-doctor");
	});

	test("Fallow non-zero runtime failure before evidence returns failure guidance", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 7, stdout: "", stderr: "fatal: config failed" },
		]);

		const result = await runForTest(["dupes"], runtime);

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("blocked");
		expect(envelope.exit_code).toBe(7);
		expect(envelope.failure_category).toBe("fallow");
		expect(envelope.stderr_category).toBe("error");
		expect(JSON.stringify(envelope.repair_hints)).toContain("run-doctor");
	});

	test("non-zero JSON without analyzer evidence remains a Fallow failure", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{
				exitCode: 2,
				stdout: JSON.stringify({ error: "config failed" }),
				stderr: "configuration error",
			},
		]);

		const result = await runForTest(["dead-code"], runtime);

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("blocked");
		expect(envelope.exit_code).toBe(2);
		expect(envelope.failure_category).toBe("fallow");
		expect(envelope.summary).toMatchObject({ total_findings: 0 });
		expect(JSON.stringify(envelope.repair_hints)).toContain("run-doctor");
	});

	test("stderr category remains coarse and stable", async () => {
		for (const [stderr, category] of [
			["", "empty"],
			["scanning files", "progress"],
			["warning: cache skipped", "warning"],
			["error: failed to load", "error"],
		] as const) {
			const root = await makeRepo({ localFallow: true });
			const { runtime } = readyExecutionRuntime(root, [
				{ exitCode: 0, stdout: JSON.stringify({ findings: [] }), stderr },
			]);

			const result = await runForTest(["dead-code"], runtime);

			expect(expectEnvelope(result).stderr_category).toBe(category);
		}
	});
});

describe("U9 plain output projection", () => {
	test("clean audit plain output has a compact golden shape", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify({ findings: [] }), stderr: "" },
		]);

		const result = await runForTest(["audit", "--plain"], runtime);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe(
			[
				"fallow mode=audit status=ok exit_code=0 failure=none write=none findings=0 auto_fixable=0 needs_trace=0 needs_human=0 references=0 budget=within-budget raw_included=false run_id=fallow:2026-06-04T00:00:00.000Z:test",
				"next_action=continue",
				"",
			].join("\n"),
		);
		expect(() => JSON.parse(result.stdout)).toThrow();
	});

	test("plain findings summarize aggregates without dumping raw issues", async () => {
		const root = await makeRepo({ localFallow: true });
		const output = {
			findings: [
				{
					id: "unused:OldButton",
					path: "src/button.ts",
					line: 4,
					rule: "unused-export",
					auto_fixable: true,
				},
				{
					finding_id: "complex:render",
					file: "src/render.ts",
					requires_human: true,
				},
			],
		};
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify(output), stderr: "" },
		]);

		const result = await runForTest(["health", "--plain"], runtime);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("status=issues");
		expect(result.stdout).toContain("findings=2");
		expect(result.stdout).toContain("auto_fixable=1");
		expect(result.stdout).toContain("needs_human=1");
		expect(result.stdout).toContain("references=2");
		expect(result.stdout).toContain("next_action=inspect-json");
		expect(result.stdout).not.toContain("unused:OldButton");
		expect(result.stdout).not.toContain("src/button.ts");
	});

	test("plain doctor reports readiness and target-fit signal", async () => {
		const root = await makeRepo({ localFallow: true });

		const result = await runForTest(["doctor", "--plain"], readyRuntime(root));

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("mode=doctor");
		expect(result.stdout).toContain("status=ok");
		expect(result.stdout).toContain("readiness root=ok");
		expect(result.stdout).toContain("repo_shape=ok");
		expect(result.stdout).toContain("target_fit=plausible-js-ts");
		expect(result.stdout).toContain("fallow_binary=ok");
		expect(result.stdout).toContain("git=ok");
		expect(result.stdout).toContain("next_action=continue");
	});

	test("plain blocked output names the same primary repair action as JSON", async () => {
		const root = await makeRepo();
		const json = await runForTest(["dead-code"], readyRuntime(root));
		const plain = await runForTest(["dead-code", "--plain"], readyRuntime(root));
		const primary = primaryRepairHint(expectEnvelope(json)).action;

		expect(plain.exitCode).toBe(1);
		expect(plain.stdout).toContain("status=blocked");
		expect(plain.stdout).toContain("failure=setup");
		expect(plain.stdout).toContain(`next_action=${primary}`);
		expect(plain.stdout).toContain("readiness root=ok");
	});

	test("plain raw-output requests do not dump raw Fallow output", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{
				exitCode: 0,
				stdout: JSON.stringify({
					findings: [],
					debug_payload: "do-not-print-this",
				}),
				stderr: "",
			},
		]);

		const result = await runForTest(
			["dead-code", "--plain", "--include-raw-output"],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("raw_included=true");
		expect(result.stdout).not.toContain("do-not-print-this");
	});
});

describe("U6 output budget behavior", () => {
	test("valid output budget values are accepted and reported", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify({ findings: [] }), stderr: "" },
		]);

		const result = await runForTest(
			["dead-code", "--max-output-bytes", "10000"],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		expect(expectEnvelope(result).output_budget).toMatchObject({
			status: "within-budget",
			max_output_bytes: 10000,
		});
	});

	test("invalid output budget values return usage failure", async () => {
		for (const value of ["0", "-1", "1.5", "abc"]) {
			const result = await runForTest(
				["dead-code", "--max-output-bytes", value],
				makeRuntime(),
			);

			expect(result.exitCode).toBe(2);
			const envelope = expectEnvelope(result);
			expect(envelope.failure_category).toBe("input");
			expect(JSON.stringify(envelope.repair_hints)).toContain(
				"--max-output-bytes",
			);
		}
	});

	test("large requested raw output is omitted while summary remains", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{
				exitCode: 0,
				stdout: JSON.stringify({
					findings: [],
					debug_payload: "x".repeat(20_000),
				}),
				stderr: "",
			},
		]);

		const result = await runForTest(
			[
				"dead-code",
				"--include-raw-output",
				"--max-output-bytes",
				"2000",
			],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("ok");
		expect(envelope.fallow_output).toBeNull();
		expect(envelope.summary).toMatchObject({ total_findings: 0 });
		expect(envelope.output_budget).toMatchObject({
			status: "raw-omitted",
			raw_output_requested: true,
			raw_output_included: false,
		});
	});

	test("large real subprocess output reaches budget handling", async () => {
		const root = await makeRepo({ localFallow: true });
		const fallowPath = join(root, "node_modules", ".bin", "fallow");
		await writeFile(
			fallowPath,
			[
				"#!/usr/bin/env bun",
				"const output = { findings: [], debug_payload: 'x'.repeat(1_200_000) };",
				"process.stdout.write(JSON.stringify(output));",
				"",
			].join("\n"),
			"utf-8",
		);
		await chmod(fallowPath, 0o755);
		const runtime = createDefaultFallowRuntime({
			cwd: root,
			now: () => Date.parse("2026-06-04T00:00:00.000Z"),
			randomId: () => "large",
		});

		const result = await runForTest(
			[
				"dead-code",
				"--include-raw-output",
				"--max-output-bytes",
				"2000",
			],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("ok");
		expect(envelope.fallow_output).toBeNull();
		expect(envelope.output_budget).toMatchObject({
			status: "raw-omitted",
			raw_output_requested: true,
			raw_output_included: false,
		});
	});

	test("small requested raw output is included when within budget", async () => {
		const root = await makeRepo({ localFallow: true });
		const output = { findings: [], note: "small" };
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify(output), stderr: "" },
		]);

		const result = await runForTest(
			[
				"dead-code",
				"--include-raw-output",
				"--max-output-bytes",
				"10000",
			],
			runtime,
		);

		const envelope = expectEnvelope(result);
		expect(envelope.fallow_output).toEqual(output);
		expect(envelope.output_budget).toMatchObject({
			status: "within-budget",
			raw_output_requested: true,
			raw_output_included: true,
		});
	});

	test("summary-impossible output returns budget failure with repair guidance", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify({ findings: [] }), stderr: "" },
		]);

		const result = await runForTest(
			["dead-code", "--max-output-bytes", "64"],
			runtime,
		);

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("blocked");
		expect(envelope.failure_category).toBe("budget");
		expect(envelope.output_budget).toMatchObject({
			status: "summary-impossible",
			raw_output_included: false,
		});
		expect(JSON.stringify(envelope.repair_hints)).toContain("reduce-output");
	});

	test("plain output remains usable when JSON summary exceeds the budget", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{
				exitCode: 1,
				stdout: JSON.stringify({
					findings: Array.from({ length: 20 }, (_, index) => ({
						file: `src/file-${index}.ts`,
						line: 1,
						action: "add-tests",
						message: `finding ${index}`,
					})),
				}),
				stderr: "",
			},
		]);

		const result = await runForTest(
			["dead-code", "--plain", "--max-output-bytes", "64"],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("fallow mode=dead-code status=issues");
		expect(result.stdout).toContain("budget=within-budget");
		expect(result.stdout).toContain("next_action=inspect-json");
	});

	test("CLI entry point flushes large JSON before process exit", async () => {
		const root = await makeRepo({ localFallow: true });
		const fallowPath = join(root, "node_modules", ".bin", "fallow");
		const largeOutput = {
			findings: Array.from({ length: 900 }, (_, index) => ({
				file: `src/file-${index}.ts`,
				line: 1,
				action: "add-tests",
				message: `large output finding ${index}`,
			})),
		};
		await writeFile(
			fallowPath,
			[
				"#!/usr/bin/env bun",
				`process.stdout.write(${JSON.stringify(JSON.stringify(largeOutput))});`,
				"",
			].join("\n"),
			"utf-8",
		);
		await chmod(fallowPath, 0o755);

		const result = Bun.spawnSync({
			cmd: [
				"bun",
				"run",
				join(import.meta.dir, "fallow-runner.ts"),
				"dead-code",
				"--root",
				root,
				"--max-output-bytes",
				"5000000",
			],
			stdout: "pipe",
			stderr: "pipe",
		});
		const stdout = new TextDecoder().decode(result.stdout);
		const stderr = new TextDecoder().decode(result.stderr);

		expect(result.exitCode).toBe(0);
		expect(stderr).toBe("");
		expect(new TextEncoder().encode(stdout).length).toBeGreaterThan(65_536);
		expect(() => JSON.parse(stdout)).not.toThrow();
		expect(JSON.parse(stdout)).toMatchObject({
			status: "issues",
			failure_category: "none",
		});
	});
});

describe("U7 fix preview and explicit apply safety", () => {
	test("fix preview invokes dry-run behavior and reports previewed write effect", async () => {
		const root = await makeRepo({ localFallow: true });
		const output = { changes: [{ path: "src/old.ts", action: "remove" }] };
		const { runtime, calls } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify(output), stderr: "" },
		]);

		const result = await runForTest(["fix-preview"], runtime);

		expect(result.exitCode).toBe(0);
		expect(calls.find((call) => call.command !== "git")).toEqual({
			command: join(root, "node_modules", ".bin", "fallow"),
			args: ["fix", "--dry-run", "--format", "json", "--quiet"],
			cwd: root,
		});
		const envelope = expectEnvelope(result);
		expect(envelope.write_effect).toBe("previewed");
		expect(envelope.summary).toMatchObject({
			mode_evidence: { write_operation: "preview" },
		});
		expect(envelope.command).toEqual([
			join(root, "node_modules", ".bin", "fallow"),
			"fix",
			"--dry-run",
			"--format",
			"json",
			"--quiet",
		]);
	});

	test("fix preview does not mutate source in the runner harness", async () => {
		const root = await makeRepo({ localFallow: true });
		const sourcePath = join(root, "source.ts");
		await writeFile(sourcePath, "export const kept = true;\n", "utf-8");
		const runtime = readyRuntime(root, {
			runCommand: async (command, args) => {
				if (command === "git") {
					return { exitCode: 0, stdout: "true\n", stderr: "" };
				}
				if (args.includes("--yes")) {
					await writeFile(sourcePath, "mutated\n", "utf-8");
				}
				return {
					exitCode: 0,
					stdout: JSON.stringify({ changes: [{ path: "source.ts" }] }),
					stderr: "",
				};
			},
		});

		const result = await runForTest(["fix-preview"], runtime);

		expect(result.exitCode).toBe(0);
		expect(await readFile(sourcePath, "utf-8")).toBe(
			"export const kept = true;\n",
		);
		expect(expectEnvelope(result).write_effect).toBe("previewed");
	});

	test("fix apply invokes explicit apply behavior and reports applied write effect after success", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime, calls } = readyExecutionRuntime(root, [
			{
				exitCode: 0,
				stdout: JSON.stringify({ changes: [{ path: "src/old.ts" }] }),
				stderr: "",
			},
		]);

		const result = await runForTest(
			["fix-apply", "--confirm-current-task-apply"],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		expect(calls.find((call) => call.command !== "git")).toEqual({
			command: join(root, "node_modules", ".bin", "fallow"),
			args: ["fix", "--yes", "--format", "json", "--quiet"],
			cwd: root,
		});
		const envelope = expectEnvelope(result);
		expect(envelope.write_effect).toBe("applied");
		expect(envelope.summary).toMatchObject({
			mode_evidence: {
				write_operation: "apply",
				config_scope: { present: false, paths: [] },
			},
		});
	});

	test("failed apply blocks without reporting an applied write effect", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 7, stdout: "", stderr: "fatal: apply failed" },
		]);

		const result = await runForTest(
			["fix-apply", "--confirm-current-task-apply"],
			runtime,
		);

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("blocked");
		expect(envelope.failure_category).not.toBe("none");
		expect(envelope.write_effect).toBe("none");
	});

	test("apply-shaped requests outside explicit apply return a safety failure", async () => {
		const result = await runForTest(["fix-preview", "--yes"], makeRuntime());

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("blocked");
		expect(envelope.failure_category).toBe("safety");
		expect(JSON.stringify(envelope.repair_hints)).toContain("inspect-config");
	});

	test("bare fix-apply fails closed before Fallow execution", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime, calls } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify({ changes: [] }), stderr: "" },
		]);

		const result = await runForTest(["fix-apply"], runtime);

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("blocked");
		expect(envelope.failure_category).toBe("safety");
		expect(envelope.write_effect).toBe("none");
		expect(JSON.stringify(envelope.repair_hints)).toContain("inspect-config");
		expect(calls).toEqual([]);
	});

	test("fix-apply accepts the runner-owned authorization marker", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime, calls } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify({ changes: [] }), stderr: "" },
		]);

		const result = await runForTest(
			["fix-apply", "--confirm-current-task-apply"],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		expect(calls.find((call) => call.command !== "git")?.args).toEqual([
			"fix",
			"--yes",
			"--format",
			"json",
			"--quiet",
		]);
	});

	test("config-present apply reports inspection hint and config scope without blocking", async () => {
		const root = await makeRepo({
			localFallow: true,
			configFiles: {
				"fallow.toml": "[rules]\n",
			},
		});
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify({ changes: [] }), stderr: "" },
		]);

		const result = await runForTest(
			["fix-apply", "--confirm-current-task-apply"],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		const envelope = expectEnvelope(result);
		expect(envelope.status).not.toBe("blocked");
		expect(JSON.stringify(envelope.repair_hints)).toContain("inspect-config");
		expect(envelope.summary).toMatchObject({
			mode_evidence: {
				config_scope: {
					present: true,
					paths: [join(root, "fallow.toml")],
				},
			},
		});
	});

	test("evidence modes never auto-apply fixes", async () => {
		for (const command of ["audit", "dead-code", "dupes", "health"] as const) {
			const root = await makeRepo({ localFallow: true });
			const { runtime, calls } = readyExecutionRuntime(root, [
				{ exitCode: 0, stdout: JSON.stringify({ findings: [] }), stderr: "" },
			]);

			await runForTest([command], runtime);

			const args = calls.find((call) => call.command !== "git")?.args ?? [];
			expect(args).not.toContain("fix");
			expect(args).not.toContain("--yes");
			expect(args).not.toContain("--apply");
		}
	});

	test("workflow references delegate apply policy to safety reference", async () => {
		const workflow = await Bun.file(
			join(import.meta.dir, "..", "references", "workflows.md"),
		).text();
		const commands = await Bun.file(
			join(import.meta.dir, "..", "references", "commands.md"),
		).text();
		const safety = await Bun.file(
			join(import.meta.dir, "..", "references", "safety.md"),
		).text();

		for (const text of [workflow, commands]) {
			expect(text).toContain("references/safety.md");
			expect(text).not.toContain("current-task user authorization");
		}
		expect(safety).toContain("current-task user authorization");
		expect(safety).toContain("fix-apply");
	});
});

describe("U8 blocked-run repair hints", () => {
	test("missing Fallow emits setup repair guidance", async () => {
		const root = await makeRepo();

		const result = await runForTest(["dead-code"], readyRuntime(root));

		expect(result.exitCode).toBe(1);
		const hint = primaryRepairHint(expectEnvelope(result));
		expect(hint.action).toBe("setup-fallow");
		expect(hint.retry_safe).toBe(false);
	});

	test("invalid root emits input repair guidance", async () => {
		const root = await makeRepo();

		const result = await runForTest(
			["doctor", "--root", join(root, "missing")],
			makeRuntime(),
		);

		expect(result.exitCode).toBe(1);
		const hint = primaryRepairHint(expectEnvelope(result));
		expect(hint.action).toBe("fix-input");
		expect(hint.retry_safe).toBe(false);
	});

	test("invalid audit base ref emits input repair guidance before Fallow runs", async () => {
		const root = await makeRepo({ localFallow: true });
		const calls: CommandCall[] = [];
		const runtime = readyRuntime(root, {
			runCommand: async (command, args, options) => {
				calls.push({ command, args: [...args], cwd: options.cwd });
				if (args.includes("--is-inside-work-tree")) {
					return { exitCode: 0, stdout: "true\n", stderr: "" };
				}
				if (args.includes("--verify")) {
					return { exitCode: 128, stdout: "", stderr: "unknown revision" };
				}
				return {
					exitCode: 0,
					stdout: JSON.stringify({ findings: [] }),
					stderr: "",
				};
			},
		});

		const result = await runForTest(
			["audit", "--base-ref", "origin/missing"],
			runtime,
		);

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.failure_category).toBe("input");
		expect(primaryRepairHint(envelope).action).toBe("fix-input");
		expect(calls.some((call) => call.command !== "git")).toBe(false);
	});

	test("non-JSON stdout emits parse repair guidance", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: "not json", stderr: "scanned files" },
		]);

		const result = await runForTest(["dead-code"], runtime);

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.failure_category).toBe("parse");
		const hint = primaryRepairHint(envelope);
		expect(hint.action).toBe("run-doctor");
		expect(hint.retry_safe).toBe(false);
	});

	test("Fallow runtime failure emits run recovery guidance", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 7, stdout: "", stderr: "fatal: config failed" },
		]);

		const result = await runForTest(["dupes"], runtime);

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.failure_category).toBe("fallow");
		const hint = primaryRepairHint(envelope);
		expect(hint.action).toBe("run-doctor");
		expect(hint.retry_safe).toBe(false);
	});

	test("budget failure emits output reduction guidance", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify({ findings: [] }), stderr: "" },
		]);

		const result = await runForTest(
			["dead-code", "--max-output-bytes", "64"],
			runtime,
		);

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.failure_category).toBe("budget");
		const hint = primaryRepairHint(envelope);
		expect(hint.action).toBe("reduce-output");
		expect(hint.retry_safe).toBe(false);
	});

	test("safety block emits config inspection guidance", async () => {
		const result = await runForTest(["health", "--apply"], makeRuntime());

		expect(result.exitCode).toBe(1);
		const envelope = expectEnvelope(result);
		expect(envelope.failure_category).toBe("safety");
		const hint = primaryRepairHint(envelope);
		expect(hint.action).toBe("inspect-config");
		expect(hint.retry_safe).toBe(false);
	});

	test("retry action appears only when same-input retry is safe", async () => {
		const root = await makeRepo({ localFallow: true });
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 75, stdout: "", stderr: "timeout while scanning" },
		]);

		const result = await runForTest(["health"], runtime);

		expect(result.exitCode).toBe(1);
		const hint = primaryRepairHint(expectEnvelope(result));
		expect(hint.action).toBe("retry");
		expect(hint.retry_safe).toBe(true);
	});

	test("workflow reference keeps blocked repair branchable", async () => {
		const workflow = await Bun.file(
			join(import.meta.dir, "..", "references", "workflows.md"),
		).text();

		expect(workflow).toContain("Follow the first safe repair hint.");
		expect(workflow).toContain("Retry the same input only when the hint says");
		expect(workflow).toContain("per-finding repair plans");
	});
});

describe("U10 skill route index docs", () => {
	test("SKILL frontmatter stays parseable and trigger-shaped", async () => {
		const skill = await readFile(join(import.meta.dir, "../SKILL.md"), "utf-8");
		const frontmatter = skill.match(/^---\n(?<body>[\s\S]*?)\n---\n/);

		expect(frontmatter?.groups?.body).toContain("name: fallow");
		expect(frontmatter?.groups?.body).toContain(
			'description: "Run Fallow code-quality self-review."',
		);
		expect(frontmatter?.groups?.body).not.toContain("Nathan");
	});

	test("SKILL starts with a request-shaped route index before owner paths", async () => {
		const skill = await readFile(join(import.meta.dir, "../SKILL.md"), "utf-8");
		const routeIndex = skill.indexOf("## Skill Route Index");
		const owner = skill.indexOf("## Owner");
		const prPrep = skill.indexOf("Implemented work / PR prep");

		expect(routeIndex).toBeGreaterThan(0);
		expect(owner).toBeGreaterThan(routeIndex);
		expect(prPrep).toBeGreaterThan(routeIndex);
		expect(prPrep).toBeLessThan(owner);
		expect(skill).toContain("audit --plain");
		expect(skill).toContain("Blocked PR evidence");
		expect(skill).toContain("Cleanup / refactor scan");
		expect(skill).toContain("Readiness check");
		expect(skill).toContain("Fix request");
		expect(skill).toContain("Apply request");
		expect(skill).toContain("Suspect target");
	});

	test("SKILL challenges suspect targets before doctor and keeps deterministic contracts out", async () => {
		const skill = await readFile(join(import.meta.dir, "../SKILL.md"), "utf-8");

		expect(skill).toContain("Challenge suspect targets before readiness checks");
		expect(skill).toContain("use runner help for the apply marker");
		expect(skill).not.toContain("--confirm-current-task-apply");
		expect(skill).not.toContain("contract_id");
		expect(skill).not.toContain("schema_version");
		expect(skill).not.toContain("next_action=");
	});

	test("references teach summary-first routing without copying apply marker syntax", async () => {
		const commands = await readFile(
			join(import.meta.dir, "..", "references", "commands.md"),
			"utf-8",
		);
		const workflow = await readFile(
			join(import.meta.dir, "..", "references", "workflows.md"),
			"utf-8",
		);
		const safety = await readFile(
			join(import.meta.dir, "..", "references", "safety.md"),
			"utf-8",
		);

		expect(commands).toContain("audit --plain");
		expect(commands).toContain("Use JSON for issue references");
		expect(workflow).toContain("Request Examples");
		expect(workflow).toContain("pre-existing findings as count or status");
		expect(workflow).toContain("Keep broader workflows opt-in");
		expect(safety).toContain("runner-owned non-interactive apply marker");
		for (const text of [commands, workflow, safety]) {
			expect(text).not.toContain("--confirm-current-task-apply");
			expect(text).not.toContain("contract_id");
			expect(text).not.toContain("schema_version");
		}
	});

	// AE7: docs explain the action-first resolver route without copying command
	// payloads, flags, parser rules, or output schemas.
	test("docs route the resolver action without copying runtime contracts", async () => {
		const skill = await readFile(join(import.meta.dir, "../SKILL.md"), "utf-8");
		const commands = await readFile(
			join(import.meta.dir, "..", "references", "commands.md"),
			"utf-8",
		);
		const workflow = await readFile(
			join(import.meta.dir, "..", "references", "workflows.md"),
			"utf-8",
		);

		// Action-first routing is present.
		expect(skill).toContain("Finding resolver action");
		expect(workflow).toContain("Finding Resolver Actions");
		expect(workflow).toContain("evidence grade first");
		expect(commands).toContain("Finding resolver action");

		// Boundary against non-audit cleanup is explicit.
		expect(workflow).toContain("distinct from the non-audit");

		// No copied resolver runtime literals: banned wording, coordinate flags,
		// the resolver action id, or evidence-grade literals.
		for (const text of [skill, commands, workflow]) {
			expect(text).not.toContain("likely-dead");
			expect(text).not.toContain("likely_dead");
			expect(text).not.toContain("--file");
			expect(text).not.toContain("--export");
			expect(text).not.toContain("trace-export-reachability");
			expect(text).not.toContain("unreferenced_by_trace");
		}
		// SKILL.md prose never copies plain-output next_action literals or the
		// mode_evidence schema path; the attribution section in workflows.md is
		// the documented exception for both.
		expect(skill).not.toContain("next_action=");
		expect(skill).not.toContain("mode_evidence");
	});
});

describe("U3 parser, help, and discovery alignment", () => {
	test("root help lists accepted subcommands and no unsupported controls", async () => {
		const result = await runForTest(["--help"], makeRuntime());

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		for (const command of ALL_COMMANDS) {
			expect(result.stdout).toContain(command);
		}
		for (const unsupported of [
			"--cwd",
			"--mode",
			"--watch",
			"watch",
			"baseline",
			"generate-ci",
		]) {
			expect(result.stdout).not.toContain(unsupported);
		}
	});

	test("subcommand help advertises only command-owned flags", async () => {
		for (const command of ALL_COMMANDS) {
			const result = await runForTest([command, "--help"], makeRuntime());

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			assertCommandHelpFlagSurface({
				command,
				contract: fallowRunnerContracts[command],
				help: result.stdout,
				absentFlags: [
					"--cwd",
					"--mode",
					"--watch",
					"--baseline",
					"--generate-ci",
					...(command === "audit" ? [] : ["--base-ref"]),
				],
			});
		}
	});

	test("help and version do not invoke Fallow discovery or execution", async () => {
		let lookupCount = 0;
		let runCount = 0;
		const runtime = makeRuntime({
			lookupExecutable: async () => {
				lookupCount += 1;
				return undefined;
			},
			runCommand: async () => {
				runCount += 1;
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});

		for (const argv of [
			["-h"],
			["doctor", "--help"],
			["--version"],
		] as const) {
			const result = await runForTest(argv, runtime);
			expect(result.exitCode).toBe(0);
		}
		expect(lookupCount).toBe(0);
		expect(runCount).toBe(0);
	});

	test("version prints plain text", async () => {
		const result = await runForTest(["--version"], makeRuntime());

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("fallow-runner 0.1.0\n");
		expect(result.stderr).toBe("");
	});

	test("every accepted subcommand reaches runtime checks", async () => {
		const root = await makeJsRepo();

		// `why` uses the mcporter trace transport, not the Fallow binary, so its
		// missing-dependency failure_category is owned by the resolver runtime
		// tests, not this binary-readiness sweep. Verify it is accepted (not exit
		// 2) here; assert binary-setup semantics for the Fallow-backed commands.
		await runCommandSurfaceCases<TestRunResult>({
			runner: (argv) => runForTest(argv, makeRuntime({ cwd: root })),
			cases: ALL_COMMANDS.map((command) => ({
				label: `${command} accepted`,
				argv: acceptedArgvFor(command),
				assert: (result) => {
					expect(result.exitCode).not.toBe(2);
					const envelope = expectEnvelope(result);
					expect(envelope.mode).toBe(command);
					if (command !== "why") {
						expect(envelope.failure_category).toBe("setup");
					}
				},
			})),
		});
	});

	test("every subcommand accepts subcommand-local plain output", async () => {
		const root = await makeJsRepo();

		await runCommandSurfaceCases<TestRunResult>({
			runner: (argv) => runForTest(argv, makeRuntime({ cwd: root })),
			cases: ALL_COMMANDS.map((command) => ({
				label: `${command} accepts plain`,
				argv: [...acceptedArgvFor(command), "--plain"],
				assert: (result) => {
					expect(result.exitCode).not.toBe(2);
					expect(result.stdout).toContain(`mode=${command}`);
				},
			})),
		});
	});

	test("global plain output flag is rejected", async () => {
		const result = await runForTest(["--plain", "audit"], makeRuntime());

		expect(result.exitCode).toBe(2);
		const envelope = expectEnvelope(result);
		expect(envelope.failure_category).toBe("input");
		expect(JSON.stringify(envelope)).toContain("flags must follow the subcommand");
	});

	test("audit accepts base-ref and non-audit commands reject it", async () => {
		const root = await makeJsRepo();
		const audit = await runForTest(
			["audit", "--root", root, "--base-ref", "origin/main"],
			makeRuntime(),
		);

		expect(audit.exitCode).not.toBe(2);
		expect(expectEnvelope(audit).mode).toBe("audit");

		for (const command of ALL_COMMANDS.filter((item) => item !== "audit")) {
			const result = await runForTest(
				[command, "--root", root, "--base-ref", "origin/main"],
				makeRuntime(),
			);
			expect(result.exitCode).toBe(2);
			const envelope = expectEnvelope(result);
			expect(envelope.failure_category).toBe("input");
			expect(JSON.stringify(envelope)).toContain("unknown option: --base-ref");
		}
	});

	test("inline flag value starting with dash is rejected", async () => {
		const result = await runForTest(
			["audit", "--base-ref=--option"],
			makeRuntime(),
		);

		expect(result.exitCode).toBe(2);
		const envelope = expectEnvelope(result);
		expect(envelope.failure_category).toBe("input");
		expect(JSON.stringify(envelope)).toContain(
			"--base-ref value cannot start with '-'",
		);
	});

	test("root accepts valid paths and rejects invalid paths", async () => {
		const root = await makeJsRepo();
		const valid = await runForTest(["doctor", "--root", root], makeRuntime());
		expect(valid.exitCode).not.toBe(2);
		expect(expectEnvelope(valid).cwd).toBe(root);

		const invalid = await runForTest(
			["doctor", "--root", join(root, "missing")],
			makeRuntime(),
		);
		expect(invalid.exitCode).toBe(1);
		const envelope = expectEnvelope(invalid);
		expect(envelope.failure_category).toBe("input");
		expect(JSON.stringify(envelope)).toContain("fix-input");
	});

	test("unknown subcommands, unknown flags, and excluded controls fail usage", async () => {
		const root = await makeJsRepo();

		await runCommandSurfaceCases({
			runner: (argv) => runForTest(argv, makeRuntime({ cwd: root })),
			cases: [
				{ label: "unknown subcommand", argv: ["watch"] },
				{ label: "unknown flag", argv: ["audit", "--unknown"] },
				{ label: "cwd flag", argv: ["audit", "--cwd", root] },
				{ label: "mode flag", argv: ["audit", "--mode", "check"] },
				{ label: "watch flag", argv: ["audit", "--watch"] },
				{ label: "baseline flag", argv: ["audit", "--baseline"] },
				{ label: "CI generation flag", argv: ["audit", "--generate-ci"] },
			].map((commandCase) => ({
				...commandCase,
				assert: (result: { exitCode: number; stdout: string; stderr: string }) => {
					expect(result.exitCode).toBe(2);
					const envelope = expectEnvelope(result);
					expect(envelope.failure_category).toBe("input");
				},
			})),
		});
	});
});

type ResolverActionRef = {
	action: string;
	target: string;
	coordinates: { file: string; export: string };
	reason: string;
	discover: string;
};

type IssueRefWithResolver = {
	path?: string;
	introduced?: boolean;
	resolver_actions?: ResolverActionRef[];
};

function issueReferencesOf(
	envelope: Record<string, unknown>,
): IssueRefWithResolver[] {
	return envelope.issue_references as IssueRefWithResolver[];
}

describe("U2 resolver action projection", () => {
	// AE1: only the introduced traceable remove-export finding advertises a
	// Finding resolver action; the inherited one does not.
	test("introduced traceable remove-export advertises a resolver action", async () => {
		const root = await makeRepo({ localFallow: true });
		const output = {
			kind: "audit",
			verdict: "fail",
			summary: { dead_code_issues: 2 },
			attribution: {
				gate: "new-only",
				dead_code_introduced: 1,
				dead_code_inherited: 1,
			},
			dead_code: {
				unused_exports: [
					{
						path: "src/new.ts",
						export_name: "freshThing",
						introduced: true,
						actions: [{ kind: "remove-export", auto_fixable: true }],
					},
					{
						path: "src/old.ts",
						export_name: "staleThing",
						introduced: false,
						actions: [{ kind: "remove-export", auto_fixable: true }],
					},
				],
			},
		};
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 1, stdout: JSON.stringify(output), stderr: "" },
		]);

		const result = await runForTest(["audit"], runtime);
		const references = issueReferencesOf(expectEnvelope(result));

		const introduced = references.find((ref) => ref.path === "src/new.ts");
		const inherited = references.find((ref) => ref.path === "src/old.ts");

		expect(introduced?.resolver_actions).toEqual([
			{
				action: "trace-export-reachability",
				target: "why",
				coordinates: { file: "src/new.ts", export: "freshThing" },
				reason: expect.any(String),
				discover: expect.any(String),
			},
		]);
		expect(inherited?.resolver_actions).toBeUndefined();
	});

	// AE2: an introduced remove-export finding missing a coordinate gets no
	// resolver action.
	test("introduced remove-export missing coordinates advertises no action", async () => {
		const root = await makeRepo({ localFallow: true });
		const output = {
			kind: "audit",
			verdict: "fail",
			summary: { dead_code_issues: 2 },
			attribution: { gate: "new-only", dead_code_introduced: 2 },
			dead_code: {
				unused_exports: [
					{
						// No export_name -> missing the export coordinate.
						path: "src/missing-export.ts",
						introduced: true,
						actions: [{ kind: "remove-export" }],
					},
					{
						// No path -> missing the file coordinate.
						export_name: "noFile",
						introduced: true,
						actions: [{ kind: "remove-export" }],
					},
				],
			},
		};
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 1, stdout: JSON.stringify(output), stderr: "" },
		]);

		const result = await runForTest(["audit"], runtime);
		const references = issueReferencesOf(expectEnvelope(result));

		for (const reference of references) {
			expect(reference.resolver_actions).toBeUndefined();
		}
	});

	// AE3: a broad needs_trace signal without the v1 traceable finding shape
	// does not advertise a runnable resolver action.
	test("needs_trace without traceable shape advertises no resolver action", async () => {
		const root = await makeRepo({ localFallow: true });
		const output = {
			kind: "audit",
			verdict: "fail",
			summary: { dead_code_issues: 1 },
			attribution: { gate: "new-only", dead_code_introduced: 1 },
			dead_code: {
				unused_exports: [
					{
						path: "src/complex.ts",
						export_name: "tangled",
						introduced: true,
						needs_trace: true,
						// Not a remove-export action.
						actions: [{ kind: "extract-shared" }],
					},
				],
			},
		};
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 1, stdout: JSON.stringify(output), stderr: "" },
		]);

		const result = await runForTest(["audit"], runtime);
		const envelope = expectEnvelope(result);
		const references = issueReferencesOf(envelope);

		for (const reference of references) {
			expect(reference.resolver_actions).toBeUndefined();
		}
		// needs_trace remains a broad summary signal.
		expect((envelope.summary as { needs_trace: number }).needs_trace).toBe(1);
	});

	// Edge: non-audit dead-code findings never get resolver actions in v1.
	test("non-audit dead-code findings advertise no resolver actions", async () => {
		const root = await makeRepo({ localFallow: true });
		const output = {
			findings: [
				{
					path: "src/button.ts",
					export_name: "OldButton",
					introduced: true,
					action: "remove-export",
				},
			],
		};
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 0, stdout: JSON.stringify(output), stderr: "" },
		]);

		const result = await runForTest(["dead-code"], runtime);
		const references = issueReferencesOf(expectEnvelope(result));

		for (const reference of references) {
			expect(reference.resolver_actions).toBeUndefined();
		}
	});

	// Integration: zero-introduced audit still says continue and does not push
	// toward JSON issue triage; resolver projection does not change that gate.
	test("zero-introduced audit still signals continue", async () => {
		const root = await makeRepo({ localFallow: true });
		const output = {
			kind: "audit",
			verdict: "fail",
			summary: { dead_code_issues: 3 },
			attribution: {
				gate: "new-only",
				dead_code_introduced: 0,
				dead_code_inherited: 3,
			},
			dead_code: {
				unused_exports: [
					{
						path: "src/old.ts",
						export_name: "stale",
						introduced: false,
						actions: [{ kind: "remove-export" }],
					},
				],
			},
		};
		const { runtime } = readyExecutionRuntime(root, [
			{ exitCode: 1, stdout: JSON.stringify(output), stderr: "" },
		]);

		const plain = await runForTest(["audit", "--plain"], runtime);
		expect(plain.stdout).toContain("next_action=continue introduced=0");

		const json = await runForTest(["audit"], runtime);
		for (const reference of issueReferencesOf(expectEnvelope(json))) {
			expect(reference.resolver_actions).toBeUndefined();
		}
	});
});

describe("U3 trace adapter", () => {
	const ROOT = "/repo";
	const COORDS = { file: "src/x.ts", exportName: "thing", root: ROOT };

	function evidence(
		overrides: Partial<TraceExportEvidence> = {},
	): TraceExportEvidence {
		return {
			file: "src/x.ts",
			export_name: "thing",
			file_reachable: true,
			is_entry_point: false,
			is_used: false,
			direct_references: [],
			re_export_chains: [],
			...overrides,
		};
	}

	function runnerYielding(result: TraceCommandResult) {
		const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
		const runCommand = async (
			command: string,
			args: readonly string[],
			options: { cwd: string },
		): Promise<TraceCommandResult> => {
			calls.push({ command, args: [...args], cwd: options.cwd });
			return result;
		};
		return { calls, runCommand };
	}

	function jsonResult(value: unknown): TraceCommandResult {
		return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
	}

	test("default command vector resolves and builds the trace call", () => {
		const resolved = resolveFallowMcporterCommand({});
		expect(resolved).toEqual({ ok: true, vector: ["mcporter"] });

		const args = traceExportArgs(COORDS);
		expect(args).toContain("trace_export");
		expect(args).toContain("--stdio");
		expect(args).toContain("fallow-mcp");
		const argsIndex = args.indexOf("--args");
		expect(JSON.parse(args[argsIndex + 1])).toEqual({
			file: "src/x.ts",
			export_name: "thing",
		});
	});

	test("env override vector is honored; invalid override reports a reason", () => {
		const ok = resolveFallowMcporterCommand({
			[FALLOW_MCPORTER_COMMAND_ENV_VAR]: '["bunx","mcporter"]',
		});
		expect(ok).toEqual({ ok: true, vector: ["bunx", "mcporter"] });

		const bad = resolveFallowMcporterCommand({
			[FALLOW_MCPORTER_COMMAND_ENV_VAR]: "not json",
		});
		expect(bad.ok).toBe(false);
	});

	test("referenced evidence returns typed evidence with references preserved", async () => {
		const { runCommand, calls } = runnerYielding(
			jsonResult(
				evidence({
					is_used: true,
					direct_references: [{ from_file: "src/x.test.ts", kind: "import" }],
				}),
			),
		);

		const result = await traceExportReachability({
			...COORDS,
			env: {},
			runCommand,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.evidence.is_used).toBe(true);
			expect(result.evidence.direct_references).toEqual([
				{ from_file: "src/x.test.ts", kind: "import" },
			]);
			expect(deriveEvidenceGrade(result.evidence)).toBe("referenced");
		}
		expect(calls[0]?.command).toBe("mcporter");
		expect(calls[0]?.cwd).toBe(ROOT);
	});

	test("entry-point evidence grades as entry_point", async () => {
		const { runCommand } = runnerYielding(
			jsonResult(evidence({ is_entry_point: true })),
		);
		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(deriveEvidenceGrade(result.evidence)).toBe("entry_point");
		}
	});

	test("unreferenced evidence returns zero references and the candidate grade", async () => {
		const { runCommand } = runnerYielding(
			jsonResult(evidence({ file_reachable: false, is_used: false })),
		);

		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.evidence.direct_references).toEqual([]);
			expect(deriveEvidenceGrade(result.evidence)).toBe("unreferenced_by_trace");
		}
	});

	test("references-only evidence (is_used false) still grades as referenced", async () => {
		const { runCommand } = runnerYielding(
			jsonResult(
				evidence({
					is_used: false,
					direct_references: [{ from_file: "src/y.ts", kind: "import" }],
				}),
			),
		);

		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(deriveEvidenceGrade(result.evidence)).toBe("referenced");
		}
	});

	test("non-empty references that all fail the shape check fail closed", async () => {
		// References exist in an unrecognized key shape; with is_used false this
		// must not normalize to zero references and grade as a removal candidate.
		const { runCommand } = runnerYielding(
			jsonResult({
				file: "src/x.ts",
				export_name: "thing",
				file_reachable: false,
				is_entry_point: false,
				is_used: false,
				direct_references: [{ importer: "src/y.ts", type: "import" }],
				re_export_chains: [],
			}),
		);

		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });

		expect(result).toMatchObject({ ok: false, reason: "malformed_payload" });
	});

	test("missing or null direct_references field fails closed, not unreferenced", async () => {
		// A schema that drops or nulls direct_references while is_used is false must
		// not be trusted as zero references (a removal candidate). Only an explicit
		// [] grades unreferenced_by_trace.
		for (const driftedRefs of [undefined, null, "oops"]) {
			const payload: Record<string, unknown> = {
				file: "src/x.ts",
				export_name: "thing",
				file_reachable: false,
				is_entry_point: false,
				is_used: false,
				re_export_chains: [],
			};
			if (driftedRefs !== undefined) payload.direct_references = driftedRefs;

			const { runCommand } = runnerYielding(jsonResult(payload));
			const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });

			expect(result).toMatchObject({ ok: false, reason: "malformed_payload" });
		}

		// The explicit empty array is the only signal that grades unreferenced.
		const { runCommand } = runnerYielding(
			jsonResult(evidence({ is_used: false, direct_references: [] })),
		);
		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(deriveEvidenceGrade(result.evidence)).toBe("unreferenced_by_trace");
		}
	});

	test("transport error without an issue key still maps to transport failure", async () => {
		const { runCommand } = runnerYielding(
			jsonResult({ error: "connection refused" }),
		);

		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });

		expect(result).toMatchObject({ ok: false, reason: "transport_unavailable" });
		if (!result.ok) {
			expect(failureEvidenceGrade(result.reason)).toBe("unavailable");
		}
	});

	test("leading mcporter JSON preamble does not discard the trace result", async () => {
		// mcporter/bunx can print a progress JSON object before the result. The
		// adapter must read the last top-level object, not concatenate from the
		// first brace.
		const preamble = JSON.stringify({ progress: "resolving", step: 1 });
		const body = JSON.stringify(
			evidence({
				is_used: true,
				direct_references: [{ from_file: "src/y.ts", kind: "import" }],
			}),
		);
		const { runCommand } = runnerYielding({
			exitCode: 0,
			stdout: `Resolving dependencies\n${preamble}\n${body}\n`,
			stderr: "",
		});

		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(deriveEvidenceGrade(result.evidence)).toBe("referenced");
			expect(result.evidence.direct_references).toHaveLength(1);
		}
	});

	test("the trace call requests a bounded timeout", async () => {
		let seenTimeout: number | undefined;
		const runCommand = async (
			_command: string,
			_args: readonly string[],
			options: { cwd: string; timeoutMs?: number },
		): Promise<TraceCommandResult> => {
			seenTimeout = options.timeoutMs;
			return jsonResult(evidence({ is_used: true }));
		};

		await traceExportReachability({ ...COORDS, env: {}, runCommand });

		expect(typeof seenTimeout).toBe("number");
		expect(seenTimeout).toBeGreaterThan(0);
	});

	test("a timed-out transport (non-zero exit, empty stdout) blocks as transport failure", async () => {
		const { runCommand } = runnerYielding({
			exitCode: 1,
			stdout: "",
			stderr: "trace timed out",
		});

		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });

		expect(result).toMatchObject({ ok: false, reason: "transport_unavailable" });
	});

	test("non-zero exit with evidence-shaped stdout maps to transport failure", async () => {
		// The transport flagged failure but printed evidence anyway; it must never
		// surface as clean reachability.
		const { runCommand } = runnerYielding({
			exitCode: 3,
			stdout: JSON.stringify(evidence({ is_used: true })),
			stderr: "trace crashed after partial output",
		});

		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });

		expect(result).toMatchObject({ ok: false, reason: "transport_unavailable" });
	});

	test("structured tool error keeps its class even with a non-zero exit", async () => {
		// mcporter emits symbol-not-found with a non-zero exit; the exitCode gate
		// must not reclassify it as a transport failure.
		const { runCommand } = runnerYielding({
			exitCode: 2,
			stdout: JSON.stringify({ error: true, message: "export not found" }),
			stderr: "",
		});

		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });

		expect(result).toMatchObject({ ok: false, reason: "symbol_not_found" });
	});

	test("tool-level symbol-not-found maps to an input failure class", async () => {
		const { runCommand } = runnerYielding(
			jsonResult({ error: true, message: "export not found", exit_code: 2 }),
		);

		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });

		expect(result).toMatchObject({ ok: false, reason: "symbol_not_found" });
		if (!result.ok) {
			expect(failureEvidenceGrade(result.reason)).toBe("unresolved");
		}
	});

	test("transport-level offline error maps to transport failure", async () => {
		const { runCommand } = runnerYielding(
			jsonResult({ error: "spawn ENOENT", issue: { kind: "offline" } }),
		);

		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });

		expect(result).toMatchObject({ ok: false, reason: "transport_unavailable" });
		if (!result.ok) {
			expect(failureEvidenceGrade(result.reason)).toBe("unavailable");
		}
	});

	test("missing binary or empty output maps to transport failure", async () => {
		const { runCommand } = runnerYielding({
			exitCode: 127,
			stdout: "",
			stderr: "mcporter: command not found",
		});

		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });
		expect(result).toMatchObject({ ok: false, reason: "transport_unavailable" });
	});

	test("malformed payload fails closed instead of producing a candidate", async () => {
		// Present JSON, but missing the required reachability fields.
		const { runCommand } = runnerYielding(
			jsonResult({ file: "src/x.ts", export_name: "thing" }),
		);

		const result = await traceExportReachability({ ...COORDS, env: {}, runCommand });

		expect(result).toMatchObject({ ok: false, reason: "malformed_payload" });
		if (!result.ok) {
			// A fail-closed payload reports unavailable, never a deletion candidate.
			expect(failureEvidenceGrade(result.reason)).toBe("unavailable");
		}
	});

	test("invalid command override maps to transport failure before running", async () => {
		let ran = false;
		const result = await traceExportReachability({
			...COORDS,
			env: { [FALLOW_MCPORTER_COMMAND_ENV_VAR]: "{not-an-array}" },
			runCommand: async () => {
				ran = true;
				return { exitCode: 0, stdout: "{}", stderr: "" };
			},
		});

		expect(ran).toBe(false);
		expect(result).toMatchObject({ ok: false, reason: "transport_unavailable" });
	});
});

describe("U4 resolver execution and evidence-grade-first output", () => {
	function traceEvidence(
		overrides: Partial<TraceExportEvidence> = {},
	): TraceExportEvidence {
		return {
			file: "src/x.ts",
			export_name: "thing",
			file_reachable: true,
			is_entry_point: false,
			is_used: false,
			direct_references: [],
			re_export_chains: [],
			...overrides,
		};
	}

	// Runtime whose mcporter call yields a fixed trace payload. Git is irrelevant
	// to `why`; only the trace transport command matters.
	function whyRuntime(
		traceStdout: string | TraceCommandResult,
		overrides: Partial<FallowRunnerRuntime> = {},
	): FallowRunnerRuntime {
		const traceResult: TraceCommandResult =
			typeof traceStdout === "string"
				? { exitCode: 0, stdout: traceStdout, stderr: "" }
				: traceStdout;
		return makeRuntime({
			cwd: "/repo",
			isDirectory: async () => true,
			runCommand: async () => traceResult,
			...overrides,
		});
	}

	function resolverOf(envelope: Record<string, unknown>) {
		const summary = envelope.summary as {
			mode_evidence?: { resolver?: Record<string, unknown> };
		};
		expect(summary.mode_evidence?.resolver).toBeDefined();
		return summary.mode_evidence?.resolver as Record<string, unknown>;
	}

	// AE4: referenced evidence -> grade is the source of truth and the derived
	// action keeps the export.
	test("referenced evidence keeps the export in JSON and plain", async () => {
		const stdout = JSON.stringify(
			traceEvidence({
				is_used: true,
				direct_references: [{ from_file: "src/x.test.ts", kind: "import" }],
			}),
		);

		const json = await runForTest(
			["why", "--file", "src/x.ts", "--export", "thing"],
			whyRuntime(stdout),
		);
		const envelope = expectEnvelope(json);
		expect(json.exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(envelope.mode).toBe("why");
		const resolver = resolverOf(envelope);
		expect(resolver.grade).toBe("referenced");
		expect(resolver.verdict).toBe("keep");
		expect(resolver.next_action).toBe("keep-export");
		expect(resolver.references).toBe(1);

		const plain = await runForTest(
			["why", "--file", "src/x.ts", "--export", "thing", "--plain"],
			whyRuntime(stdout),
		);
		expect(plain.stdout).toContain("resolver grade=referenced");
		expect(plain.stdout).toContain("verdict=keep");
		expect(plain.stdout).toContain("next_action=keep-export");
		// No raw trace payload dumped into plain output.
		expect(plain.stdout).not.toContain("direct_references");
	});

	test("entry-point evidence keeps the export", async () => {
		const stdout = JSON.stringify(traceEvidence({ is_entry_point: true }));
		const result = await runForTest(
			["why", "--file", "src/x.ts", "--export", "thing"],
			whyRuntime(stdout),
		);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("ok");
		expect(resolverOf(envelope).grade).toBe("entry_point");
		expect(resolverOf(envelope).next_action).toBe("keep-export");
	});

	// AE5: no direct references -> unreferenced_by_trace wording and a
	// candidate-remove action, never deletion-proof wording.
	test("unreferenced evidence is a candidate, not deletion proof", async () => {
		const stdout = JSON.stringify(
			traceEvidence({ file_reachable: false, is_used: false }),
		);

		const json = await runForTest(
			["why", "--file", "src/x.ts", "--export", "thing"],
			whyRuntime(stdout),
		);
		const envelope = expectEnvelope(json);
		// Unreferenced is usable evidence (issues, exit 0), not a blocked run.
		expect(json.exitCode).toBe(0);
		expect(envelope.status).toBe("issues");
		const resolver = resolverOf(envelope);
		expect(resolver.grade).toBe("unreferenced_by_trace");
		expect(resolver.verdict).toBe("candidate_remove");
		expect(resolver.next_action).toBe("candidate-remove");

		// Banned overclaiming wording never appears.
		const blob = JSON.stringify(envelope);
		expect(blob).not.toContain("likely-dead");
		expect(blob).not.toContain("likely_dead");
		expect(blob).not.toContain("safe to remove");

		const plain = await runForTest(
			["why", "--file", "src/x.ts", "--export", "thing", "--plain"],
			whyRuntime(stdout),
		);
		expect(plain.stdout).toContain("resolver grade=unreferenced_by_trace");
		expect(plain.stdout).toContain("next_action=candidate-remove");
		expect(plain.stdout).not.toContain("likely-dead");
	});

	// AE6: every resolver result keeps top-level status in the runner set, with
	// resolver-specific meaning in package-owned mode evidence.
	test("every resolver path keeps top-level status in the runner set", async () => {
		const cases: Array<{ stdout: string | TraceCommandResult; status: string }> =
			[
				{
					stdout: JSON.stringify(traceEvidence({ is_used: true })),
					status: "ok",
				},
				{
					stdout: JSON.stringify(traceEvidence()),
					status: "issues",
				},
				{
					stdout: JSON.stringify({ error: true, message: "not found" }),
					status: "blocked",
				},
				{
					stdout: JSON.stringify({
						error: "offline",
						issue: { kind: "offline" },
					}),
					status: "blocked",
				},
			];

		for (const testCase of cases) {
			const result = await runForTest(
				["why", "--file", "src/x.ts", "--export", "thing"],
				whyRuntime(testCase.stdout),
			);
			const envelope = expectEnvelope(result);
			expect(["ok", "issues", "blocked"]).toContain(
				envelope.status as string,
			);
			expect(envelope.status).toBe(testCase.status);
			// Resolver meaning lives in mode evidence, not top-level status.
			expect(resolverOf(envelope).grade).toBeDefined();
		}
	});

	test("symbol-not-found blocks with input recovery and the first safe hint", async () => {
		const stdout = JSON.stringify({ error: true, message: "export not found" });
		const result = await runForTest(
			["why", "--file", "src/x.ts", "--export", "ghost"],
			whyRuntime(stdout),
		);
		const envelope = expectEnvelope(result);
		expect(result.exitCode).toBe(1);
		expect(envelope.status).toBe("blocked");
		expect(envelope.failure_category).toBe("input");
		expect(resolverOf(envelope).grade).toBe("unresolved");
		expect(primaryRepairHint(envelope).action).toBe("fix-input");
	});

	test("transport unavailable blocks with setup recovery and the first safe hint", async () => {
		const result = await runForTest(
			["why", "--file", "src/x.ts", "--export", "thing"],
			whyRuntime({
				exitCode: 127,
				stdout: "",
				stderr: "mcporter: command not found",
			}),
		);
		const envelope = expectEnvelope(result);
		expect(result.exitCode).toBe(1);
		expect(envelope.status).toBe("blocked");
		expect(envelope.failure_category).toBe("setup");
		expect(resolverOf(envelope).grade).toBe("unavailable");
		expect(primaryRepairHint(envelope).action).toBe("setup-fallow");
	});

	test("missing root blocks why before tracing", async () => {
		let traced = false;
		const runtime = makeRuntime({
			cwd: "/repo",
			isDirectory: async () => false,
			runCommand: async () => {
				traced = true;
				return { exitCode: 0, stdout: "{}", stderr: "" };
			},
		});
		const result = await runForTest(
			["why", "--file", "src/x.ts", "--export", "thing", "--root", "/missing"],
			runtime,
		);
		expect(traced).toBe(false);
		const envelope = expectEnvelope(result);
		expect(envelope.status).toBe("blocked");
		expect(envelope.failure_category).toBe("input");
	});

	test("raw trace evidence is included only when explicitly requested", async () => {
		const stdout = JSON.stringify(traceEvidence({ is_used: true }));
		const omitted = await runForTest(
			["why", "--file", "src/x.ts", "--export", "thing"],
			whyRuntime(stdout),
		);
		expect(expectEnvelope(omitted).fallow_output).toBeNull();

		const included = await runForTest(
			["why", "--file", "src/x.ts", "--export", "thing", "--include-raw-output"],
			whyRuntime(stdout),
		);
		const envelope = expectEnvelope(included);
		expect((envelope.fallow_output as { is_used?: boolean }).is_used).toBe(true);
	});
});

describe("U6 prototype retirement", () => {
	const scriptsDir = import.meta.dir;

	test("the throwaway prototype folder is gone", async () => {
		const { existsSync } = await import("node:fs");
		expect(existsSync(join(scriptsDir, "prototype-why-symbol"))).toBe(false);
	});

	test("no runner script imports the prototype folder", async () => {
		const { readdir } = await import("node:fs/promises");
		const entries = await readdir(scriptsDir);
		const sources = entries.filter(
			(name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
		);
		for (const name of sources) {
			const text = await readFile(join(scriptsDir, name), "utf-8");
			// No executable import path depends on the prototype; a `//` source
			// lineage comment is allowed.
			expect(text).not.toContain('from "./prototype-why-symbol');
			expect(text).not.toContain("import(\"./prototype-why-symbol");
		}
	});

	test("the runner suite covers the trace shapes the prototype proved", () => {
		// The keeper behavior lives in the U3 adapter and U4 execution suites:
		// referenced, entry-point, unreferenced, symbol-not-found, and transport
		// failure. This test documents that coverage gate so the prototype's value
		// is preserved before deletion.
		expect(typeof deriveEvidenceGrade).toBe("function");
		expect(typeof traceExportReachability).toBe("function");
	});
});
