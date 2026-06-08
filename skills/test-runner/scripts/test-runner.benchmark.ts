#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const TOKEN_ESTIMATE_METHOD = "estimate: chars/4 rounded up" as const;
const DEFAULT_MCP_BASELINE_PATH = ".benchmark-input/mcp-baseline.json";
const DEFAULT_OUTPUT_DIR = ".benchmark-output";
const DEFAULT_FAILURE_BUDGET_CHARS = 12_000;
const DEFAULT_PROCESS_TIMEOUT_MS = 5_000;

export type FixtureKind = "pass" | "fail" | "timeout";
export type VariantKind =
	| "native_bun"
	| "mcp_artifact"
	| "local_runner"
	| "synthetic";
export type ContextMode =
	| "raw"
	| "mcp"
	| "compact"
	| "repair"
	| "repair-json"
	| "repair-toon"
	| "triage";
export type BenchmarkMode = "calibration" | "fixed-gate";
export type GatePreset = "bun-no-mcp";

export type BenchmarkFixture = {
	label: string;
	kind: FixtureKind;
	file: string;
	expectedExitCode: number;
	bunArgs: string[];
	expectedSignals: {
		failingFile?: string;
		failingTests: string[];
		assertionPatterns: string[];
		expectedFailureCount?: number;
		expectedValueAvailable?: boolean;
		receivedValueAvailable?: boolean;
	};
};

export type FidelitySignal = {
	failure_count: boolean;
	failing_file: boolean;
	failing_test: boolean;
	assertion_signal: boolean;
	bounded_diagnostics: boolean;
	lookup_handle: boolean;
	expected_value: boolean;
	received_value: boolean;
};

export type FidelityScore = {
	applicable: boolean;
	score: number;
	signals: FidelitySignal;
	missing: string[];
};

export type BenchmarkRow = {
	fixture: string;
	variant: string;
	variant_kind: VariantKind;
	context_mode: ContextMode;
	status: "measured" | "skipped";
	exit_code: number | null;
	expected_exit_code: number;
	exit_correct: boolean | null;
	wall_time_ms: number | null;
	token_estimate: number | null;
	token_estimate_method: typeof TOKEN_ESTIMATE_METHOD;
	fidelity: FidelityScore | null;
	score: number | null;
	skip_reason?: string;
	diagnostic_chars?: number;
	stdout_sample?: string;
	stderr_sample?: string;
	lookup_available?: boolean;
	detail_roundtrip?: DetailRoundtripScore;
	notes: string[];
};

export type DetailRoundtripScore = {
	applicable: boolean;
	handle: string | null;
	lookup_exit_code: number | null;
	lookup_available: boolean;
	richer_detail: boolean;
	test_reruns: number;
};

export type BenchmarkEvidence = {
	schema_version: "2";
	mode: BenchmarkMode;
	run_id: string;
	generated_at: string;
	token_estimate_method: typeof TOKEN_ESTIMATE_METHOD;
	fixtures: BenchmarkFixture[];
	rows: BenchmarkRow[];
	calibration: {
		candidate_gates: CandidateGate[];
		fixed_gate_input?: string;
	};
	gate_result: GateResult | null;
	output_path: string;
};

type CandidateGate = {
	fixture: string;
	variant: string;
	exit_correctness_required: true;
	max_token_estimate: number | null;
	max_token_estimate_variant?: string;
	max_token_estimate_variant_kind?: VariantKind;
	token_exception?: string;
	min_fidelity_score: number | null;
	require_lookup_available?: boolean;
	require_detail_roundtrip?: boolean;
	max_detail_test_reruns?: number;
	max_diagnostic_chars?: number;
	require_no_false_expected_received?: boolean;
	source: "observed_calibration";
};

type GateResult = {
	status: "pass" | "fail" | "not_applicable";
	failures: string[];
};

type ParsedArgs = {
	mode: BenchmarkMode;
	json: boolean;
	help: boolean;
	runId: string;
	outputDir: string;
	mcpBaselinePath: string;
	includeMcpBaseline: boolean;
	localRunnerCommand: string | null;
	includeSynthetic: boolean;
	gateFile: string | null;
	gatePreset: GatePreset | null;
	fixtureLabels: Set<string> | null;
};

type ProcessResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	wallTimeMs: number;
	timedOut: boolean;
};

type McpArtifact = {
	rows?: Partial<BenchmarkRow>[];
	fixtures?: Record<string, Partial<BenchmarkRow>>;
};

type LocalRunnerProjection = {
	variant: string;
	contextMode: Extract<
		ContextMode,
		"compact" | "repair" | "repair-json" | "repair-toon" | "triage"
	>;
	runMode: "compact" | "repair" | "triage";
	format: "plain" | "json-compact" | "toon";
};

const LOCAL_RUNNER_PROJECTIONS: LocalRunnerProjection[] = [
	{
		variant: "local-runner-compact",
		contextMode: "compact",
		runMode: "compact",
		format: "plain",
	},
	{
		variant: "local-runner-repair",
		contextMode: "repair",
		runMode: "repair",
		format: "plain",
	},
	{
		variant: "local-runner-repair-json",
		contextMode: "repair-json",
		runMode: "repair",
		format: "json-compact",
	},
	{
		variant: "local-runner-repair-toon",
		contextMode: "repair-toon",
		runMode: "repair",
		format: "toon",
	},
	{
		variant: "local-runner-triage",
		contextMode: "triage",
		runMode: "triage",
		format: "plain",
	},
];

export const BENCHMARK_FIXTURES: BenchmarkFixture[] = [
	{
		label: "pass",
		kind: "pass",
		file: "fixtures/pass.test.ts",
		expectedExitCode: 0,
		bunArgs: [],
		expectedSignals: {
			failingTests: [],
			assertionPatterns: [],
		},
	},
	{
		label: "fail",
		kind: "fail",
		file: "fixtures/fail.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "fail.test.ts",
			failingTests: ["calculates tax-inclusive price"],
			assertionPatterns: ["expect", "toBe", "13"],
			expectedFailureCount: 1,
			expectedValueAvailable: true,
			receivedValueAvailable: true,
		},
	},
	{
		label: "coverage",
		kind: "pass",
		file: "fixtures/coverage.test.ts",
		expectedExitCode: 0,
		bunArgs: ["--coverage"],
		expectedSignals: {
			failingTests: [],
			assertionPatterns: ["coverage-target.ts", "75.00"],
		},
	},
	{
		label: "multi-fail",
		kind: "fail",
		file: "fixtures/multi-fail.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "multi-fail.test.ts",
			failingTests: ["builds initials", "handles empty names"],
			assertionPatterns: ["expect", "toBe"],
			expectedFailureCount: 2,
			expectedValueAvailable: true,
			receivedValueAvailable: true,
		},
	},
	{
		label: "timeout",
		kind: "timeout",
		file: "fixtures/timeout.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "timeout.test.ts",
			failingTests: ["times out a slow promise"],
			assertionPatterns: ["timeout", "50"],
			expectedFailureCount: 1,
			expectedValueAvailable: false,
			receivedValueAvailable: false,
		},
	},
	{
		label: "string-quotes",
		kind: "fail",
		file: "fixtures/string-quotes.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "string-quotes.test.ts",
			failingTests: ["preserves quoted plan label"],
			assertionPatterns: ["alpha", "beta", "toBe"],
			expectedFailureCount: 1,
			expectedValueAvailable: true,
			receivedValueAvailable: true,
		},
	},
	{
		label: "string-commas",
		kind: "fail",
		file: "fixtures/string-commas.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "string-commas.test.ts",
			failingTests: ["keeps comma separated status line"],
			assertionPatterns: ["ready, blocked, done", "ready, waiting, done"],
			expectedFailureCount: 1,
			expectedValueAvailable: true,
			receivedValueAvailable: true,
		},
	},
	{
		label: "string-newlines",
		kind: "fail",
		file: "fixtures/string-newlines.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "string-newlines.test.ts",
			failingTests: ["keeps multiline summary shape"],
			assertionPatterns: ["expect(received).toBe(expected)"],
			expectedFailureCount: 1,
			expectedValueAvailable: false,
			receivedValueAvailable: false,
		},
	},
	{
		label: "deep-nested",
		kind: "fail",
		file: "fixtures/deep-nested.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "deep-nested.test.ts",
			failingTests: ["renders leaf packet"],
			assertionPatterns: ["expected", "received", "leaf-packet-v2"],
			expectedFailureCount: 1,
			expectedValueAvailable: true,
			receivedValueAvailable: true,
		},
	},
	{
		label: "long-message",
		kind: "fail",
		file: "fixtures/long-message.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "long-message.test.ts",
			failingTests: ["surfaces long assertion message"],
			assertionPatterns: ["expected operation packet", "repair hints"],
			expectedFailureCount: 1,
			expectedValueAvailable: true,
			receivedValueAvailable: true,
		},
	},
	{
		label: "snapshot-inline",
		kind: "fail",
		file: "fixtures/snapshot-inline.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "snapshot-inline.test.ts",
			failingTests: ["matches inline snapshot"],
			assertionPatterns: ["toMatchInlineSnapshot", "stable snapshot"],
			expectedFailureCount: 1,
			expectedValueAvailable: true,
			receivedValueAvailable: true,
		},
	},
	{
		label: "thrown-error",
		kind: "fail",
		file: "fixtures/thrown-error.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "thrown-error.test.ts",
			failingTests: ["reports domain exception"],
			assertionPatterns: ["domain exception", "customer id missing"],
			expectedFailureCount: 1,
			expectedValueAvailable: false,
			receivedValueAvailable: false,
		},
	},
	{
		label: "runtime-error",
		kind: "fail",
		file: "fixtures/runtime-error.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "runtime-error.test.ts",
			failingTests: ["reports runtime type failure"],
			assertionPatterns: ["TypeError"],
			expectedFailureCount: 1,
			expectedValueAvailable: false,
			receivedValueAvailable: false,
		},
	},
	{
		label: "three-plus-fail",
		kind: "fail",
		file: "fixtures/three-plus-fail.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "three-plus-fail.test.ts",
			failingTests: [
				"formats account code",
				"rounds invoice total",
				"marks overdue invoice",
			],
			assertionPatterns: ["expect", "toBe"],
			expectedFailureCount: 4,
			expectedValueAvailable: true,
			receivedValueAvailable: true,
		},
	},
	{
		label: "fallback-incomplete",
		kind: "fail",
		file: "fixtures/fallback-incomplete.test.ts",
		expectedExitCode: 1,
		bunArgs: [],
		expectedSignals: {
			failingFile: "fallback-incomplete.test.ts",
			failingTests: ["keeps parser fallback useful"],
			assertionPatterns: ["manual failure without matcher facts"],
			expectedFailureCount: 1,
			expectedValueAvailable: false,
			receivedValueAvailable: false,
		},
	},
];

export async function runBenchmark(
	argv: readonly string[],
	options: { cwd?: string; now?: Date } = {},
): Promise<{ exitCode: number; stdout: string; evidence: BenchmarkEvidence }> {
	const cwd = options.cwd ?? import.meta.dir;
	const args = parseArgs(argv);
	if (args.help) return { exitCode: 0, stdout: renderHelp(), evidence: emptyEvidence(cwd, args) };

	const fixtures = selectFixtures(args.fixtureLabels);
	const rows: BenchmarkRow[] = [];

	for (const fixture of fixtures) {
		rows.push(await runNativeBunFixture(cwd, fixture));
	}

	if (args.includeMcpBaseline) {
		rows.push(...(await loadMcpRows(cwd, args.mcpBaselinePath, fixtures)));
	}

	if (args.localRunnerCommand) {
		for (const fixture of fixtures) {
			for (const projection of LOCAL_RUNNER_PROJECTIONS) {
				rows.push(
					await runLocalRunnerFixture(
						cwd,
						fixture,
						args.localRunnerCommand,
						projection,
					),
				);
			}
		}
	}

	if (args.includeSynthetic) rows.push(...createSyntheticRows(fixtures));

	applyScores(rows);

	const outputDir = join(cwd, args.outputDir);
	await mkdir(outputDir, { recursive: true });
	const outputPath = join(outputDir, `${args.runId}-${args.mode}.json`);
	const evidence: BenchmarkEvidence = {
		schema_version: "2",
		mode: args.mode,
		run_id: args.runId,
		generated_at: (options.now ?? new Date()).toISOString(),
		token_estimate_method: TOKEN_ESTIMATE_METHOD,
		fixtures,
		rows,
		calibration: {
			candidate_gates: createCandidateGates(rows),
			...(args.gateFile ? { fixed_gate_input: args.gateFile } : {}),
			...(args.gatePreset ? { fixed_gate_input: args.gatePreset } : {}),
		},
		gate_result:
			args.mode === "fixed-gate"
				? await evaluateFixedGates(cwd, args.gateFile, args.gatePreset, rows)
				: null,
		output_path: relative(cwd, outputPath),
	};

	await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);

	const stdout = args.json
		? `${JSON.stringify(evidence, null, 2)}\n`
		: `${renderEvidenceTable(evidence)}\n\nJSON: ${evidence.output_path}\n`;
	const exitCode =
		evidence.gate_result?.status === "fail" || rows.some((row) => row.exit_correct === false)
			? 1
			: 0;
	return { exitCode, stdout, evidence };
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	const args = [...argv];
	const parsed: ParsedArgs = {
		mode: "calibration",
		json: false,
		help: false,
		runId: createRunId(),
		outputDir: DEFAULT_OUTPUT_DIR,
		mcpBaselinePath: DEFAULT_MCP_BASELINE_PATH,
		includeMcpBaseline: true,
		localRunnerCommand: null,
		includeSynthetic: false,
		gateFile: null,
		gatePreset: null,
		fixtureLabels: null,
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--help":
			case "-h":
				parsed.help = true;
				break;
			case "--json":
				parsed.json = true;
				break;
			case "--mode": {
				const value = requireNext(args, index, "--mode");
				if (value !== "calibration" && value !== "fixed-gate") {
					throw new Error("--mode must be calibration or fixed-gate.");
				}
				parsed.mode = value;
				index += 1;
				break;
			}
			case "--run-id":
				parsed.runId = requireNext(args, index, "--run-id");
				index += 1;
				break;
			case "--output-dir":
				parsed.outputDir = requireNext(args, index, "--output-dir");
				index += 1;
				break;
			case "--mcp-baseline":
				parsed.mcpBaselinePath = requireNext(args, index, "--mcp-baseline");
				index += 1;
				break;
			case "--no-mcp-baseline":
				parsed.includeMcpBaseline = false;
				break;
			case "--local-runner":
				parsed.localRunnerCommand = requireNext(args, index, "--local-runner");
				index += 1;
				break;
			case "--gate-file":
				parsed.gateFile = requireNext(args, index, "--gate-file");
				index += 1;
				break;
			case "--gate-preset": {
				const value = requireNext(args, index, "--gate-preset");
				if (value !== "bun-no-mcp") {
					throw new Error("--gate-preset must be bun-no-mcp.");
				}
				parsed.gatePreset = value;
				index += 1;
				break;
			}
			case "--include-synthetic":
				parsed.includeSynthetic = true;
				break;
			case "--fixture": {
				const labels = requireNext(args, index, "--fixture")
					.split(",")
					.map((label) => label.trim())
					.filter(Boolean);
				parsed.fixtureLabels = new Set(labels);
				index += 1;
				break;
			}
			default:
				throw new Error(`unknown option: ${arg}`);
		}
	}

	if (parsed.mode === "fixed-gate" && !parsed.gateFile && !parsed.gatePreset) {
		throw new Error("--mode fixed-gate requires --gate-file or --gate-preset.");
	}

	return parsed;
}

function selectFixtures(labels: Set<string> | null): BenchmarkFixture[] {
	if (!labels) return BENCHMARK_FIXTURES;
	const selected = BENCHMARK_FIXTURES.filter((fixture) => labels.has(fixture.label));
	const missing = [...labels].filter(
		(label) => !BENCHMARK_FIXTURES.some((fixture) => fixture.label === label),
	);
	if (missing.length > 0) throw new Error(`unknown fixture: ${missing.join(", ")}`);
	return selected;
}

async function runNativeBunFixture(
	cwd: string,
	fixture: BenchmarkFixture,
): Promise<BenchmarkRow> {
	const result = await runProcess(
		["bun", "test", fixture.file, ...fixture.bunArgs],
		cwd,
	);
	return createMeasuredRow("native-bun", "native_bun", "raw", fixture, result);
}

async function runLocalRunnerFixture(
	cwd: string,
	fixture: BenchmarkFixture,
	command: string,
	projection: LocalRunnerProjection,
): Promise<BenchmarkRow> {
	const outputFormatArgs =
		projection.format === "plain"
			? ["--plain"]
			: ["--format", projection.format];
	const result = await runProcess(
		[
			...splitCommand(command),
			"--cwd",
			cwd,
			...outputFormatArgs,
			"--mode",
			projection.runMode,
			"--",
			fixture.file,
			...fixture.bunArgs,
		],
		cwd,
	);
	const row = createMeasuredRow(
		projection.variant,
		"local_runner",
		projection.contextMode,
		fixture,
		result,
	);
	if (
		projection.contextMode === "repair" ||
		projection.contextMode === "repair-json" ||
		projection.contextMode === "repair-toon" ||
		projection.contextMode === "triage"
	) {
		row.detail_roundtrip = await measureDetailRoundtrip(cwd, command, fixture, result);
		row.lookup_available = row.detail_roundtrip.lookup_available;
	}
	return row;
}

async function runProcess(command: string[], cwd: string): Promise<ProcessResult> {
	const startedAt = performance.now();
	const proc = Bun.spawn(command, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill("SIGTERM");
	}, DEFAULT_PROCESS_TIMEOUT_MS);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]).finally(() => clearTimeout(timer));
	return {
		exitCode,
		stdout,
		stderr,
		wallTimeMs: Math.round(performance.now() - startedAt),
		timedOut,
	};
}

async function measureDetailRoundtrip(
	cwd: string,
	command: string,
	fixture: BenchmarkFixture,
	result: ProcessResult,
): Promise<DetailRoundtripScore> {
	if (fixture.kind === "pass") {
		return {
			applicable: false,
			handle: null,
			lookup_exit_code: null,
			lookup_available: false,
			richer_detail: false,
			test_reruns: 0,
		};
	}
	const handle = `${result.stdout}\n${result.stderr}`.match(/tr_[a-z0-9._-]+/)?.[0] ?? null;
	if (!handle) {
		return {
			applicable: true,
			handle: null,
			lookup_exit_code: null,
			lookup_available: false,
			richer_detail: false,
			test_reruns: 0,
		};
	}
	const lookup = await runProcess(
		[...splitCommand(command), "detail", "--handle", handle],
		cwd,
	);
	const output = sanitizeBenchmarkOutput(`${lookup.stdout}\n${lookup.stderr}`);
	return {
		applicable: true,
		handle,
		lookup_exit_code: lookup.exitCode,
		lookup_available: lookup.exitCode === 0,
		richer_detail:
			lookup.exitCode === 0 &&
			output.includes("context:") &&
			output.includes(fixture.expectedSignals.failingTests[0] ?? fixture.file),
		test_reruns: countObservedTestReruns(output),
	};
}

function countObservedTestReruns(output: string): number {
	return (output.match(/^bun test v/gm) ?? []).length;
}

function createMeasuredRow(
	variant: string,
	variantKind: VariantKind,
	contextMode: ContextMode,
	fixture: BenchmarkFixture,
	result: ProcessResult,
): BenchmarkRow {
	const stdout = sanitizeBenchmarkOutput(result.stdout);
	const stderr = sanitizeBenchmarkOutput(result.stderr);
	const combined = `${stdout}\n${stderr}`;
	const fidelity = scoreFidelity(fixture, combined);
	return {
		fixture: fixture.label,
		variant,
		variant_kind: variantKind,
		context_mode: contextMode,
		status: "measured",
		exit_code: result.exitCode,
		expected_exit_code: fixture.expectedExitCode,
		exit_correct: result.timedOut ? false : result.exitCode === fixture.expectedExitCode,
		wall_time_ms: result.wallTimeMs,
		token_estimate: estimateTokens(combined),
		token_estimate_method: TOKEN_ESTIMATE_METHOD,
		fidelity,
		score: null,
		diagnostic_chars: combined.length,
		stdout_sample: truncateSample(stdout),
		stderr_sample: truncateSample(stderr),
		lookup_available: fixture.kind !== "pass" && fidelity.signals.lookup_handle,
		notes: result.timedOut ? ["benchmark subprocess timed out"] : [],
	};
}

async function loadMcpRows(
	cwd: string,
	path: string,
	fixtures: BenchmarkFixture[],
): Promise<BenchmarkRow[]> {
	const fullPath = join(cwd, path);
	let artifact: McpArtifact;
	try {
		artifact = JSON.parse(await readFile(fullPath, "utf-8")) as McpArtifact;
	} catch {
		return fixtures.map((fixture) => createSkippedMcpRow(fixture, "MCP baseline artifact missing."));
	}

	const rows: BenchmarkRow[] = [];
	for (const fixture of fixtures) {
		const fromRows = artifact.rows?.find((row) => row.fixture === fixture.label);
		const fromFixture = artifact.fixtures?.[fixture.label];
		const source = fromRows ?? fromFixture;
		if (!source) {
			rows.push(createSkippedMcpRow(fixture, "MCP baseline fixture row missing."));
			continue;
		}
		rows.push(normalizeArtifactRow(fixture, source));
	}
	return rows;
}

function normalizeArtifactRow(
	fixture: BenchmarkFixture,
	source: Partial<BenchmarkRow>,
): BenchmarkRow {
	if (source.skip_reason) {
		return createSkippedMcpRow(fixture, source.skip_reason, source.variant);
	}
	const output = `${source.stdout_sample ?? ""}\n${source.stderr_sample ?? ""}`;
	const exitCode = typeof source.exit_code === "number" ? source.exit_code : null;
	const fidelity = isCurrentFidelityScore(source.fidelity)
		? source.fidelity
		: scoreFidelity(fixture, output);
	return {
		fixture: fixture.label,
		variant: source.variant ?? "mcp-artifact",
		variant_kind: "mcp_artifact",
		context_mode: "mcp",
		status: "measured",
		exit_code: exitCode,
		expected_exit_code: fixture.expectedExitCode,
		exit_correct: exitCode === null ? null : exitCode === fixture.expectedExitCode,
		wall_time_ms: source.wall_time_ms ?? null,
		token_estimate: source.token_estimate ?? estimateTokens(output),
		token_estimate_method: TOKEN_ESTIMATE_METHOD,
		fidelity,
		score: null,
		diagnostic_chars: source.diagnostic_chars ?? output.length,
		stdout_sample: source.stdout_sample,
		stderr_sample: source.stderr_sample,
		lookup_available: fixture.kind !== "pass" && fidelity.signals.lookup_handle,
		notes: source.notes ?? ["loaded from MCP baseline artifact"],
	};
}

function createSkippedMcpRow(
	fixture: BenchmarkFixture,
	reason: string,
	variant = "mcp-artifact",
): BenchmarkRow {
	return {
		fixture: fixture.label,
		variant,
		variant_kind: "mcp_artifact",
		context_mode: "mcp",
		status: "skipped",
		exit_code: null,
		expected_exit_code: fixture.expectedExitCode,
		exit_correct: null,
		wall_time_ms: null,
		token_estimate: null,
		token_estimate_method: TOKEN_ESTIMATE_METHOD,
		fidelity: null,
		score: null,
		skip_reason: reason,
		notes: ["MCP skipped status blocks guidance deprecation without maintainer waiver."],
	};
}

function createSyntheticRows(fixtures: BenchmarkFixture[]): BenchmarkRow[] {
	const failingFixture =
		fixtures.find((fixture) => fixture.kind !== "pass") ?? fixtures[0];
	if (!failingFixture) return [];
	const tinyOutput = `${basename(failingFixture.file)} failed\n`;
	const wrongExitOutput = `${failingFixture.expectedSignals.failingTests[0] ?? "test"} passed incorrectly\n`;
	return [
		{
			fixture: failingFixture.label,
			variant: "tiny-envelope",
			variant_kind: "synthetic",
			context_mode: "repair",
			status: "measured",
			exit_code: failingFixture.expectedExitCode,
			expected_exit_code: failingFixture.expectedExitCode,
			exit_correct: true,
			wall_time_ms: 1,
			token_estimate: estimateTokens(tinyOutput),
			token_estimate_method: TOKEN_ESTIMATE_METHOD,
			fidelity: scoreFidelity(failingFixture, tinyOutput),
			score: null,
			diagnostic_chars: tinyOutput.length,
			stdout_sample: tinyOutput,
			stderr_sample: "",
			notes: ["synthetic token win with intentionally poor repair context"],
		},
		{
			fixture: failingFixture.label,
			variant: "wrong-exit",
			variant_kind: "synthetic",
			context_mode: "repair",
			status: "measured",
			exit_code: 0,
			expected_exit_code: failingFixture.expectedExitCode,
			exit_correct: 0 === failingFixture.expectedExitCode,
			wall_time_ms: 1,
			token_estimate: estimateTokens(wrongExitOutput),
			token_estimate_method: TOKEN_ESTIMATE_METHOD,
			fidelity: scoreFidelity(failingFixture, wrongExitOutput),
			score: null,
			diagnostic_chars: wrongExitOutput.length,
			stdout_sample: wrongExitOutput,
			stderr_sample: "",
			notes: ["synthetic exit correctness gate failure"],
		},
	];
}

function scoreFidelity(
	fixture: BenchmarkFixture,
	output: string,
): FidelityScore {
	if (
		fixture.kind === "pass" &&
		fixture.expectedSignals.assertionPatterns.length === 0
	) {
		return {
			applicable: false,
			score: 1,
			signals: {
				failure_count: true,
				failing_file: true,
				failing_test: true,
				assertion_signal: true,
				bounded_diagnostics: output.length <= DEFAULT_FAILURE_BUDGET_CHARS,
				lookup_handle: true,
				expected_value: true,
				received_value: true,
			},
			missing: [],
		};
	}

	const lowerOutput = output.toLowerCase();
	const compactRows = parseCompactJsonFailureRows(output);
	const toonRows = parseToonFailureRows(output);
	if (fixture.kind === "pass") {
		const signals: FidelitySignal = {
			failure_count: true,
			failing_file: true,
			failing_test: true,
			assertion_signal: fixture.expectedSignals.assertionPatterns.every((pattern) =>
				lowerOutput.includes(pattern.toLowerCase()),
			),
			bounded_diagnostics: output.length <= DEFAULT_FAILURE_BUDGET_CHARS,
			lookup_handle: true,
			expected_value: true,
			received_value: true,
		};
		const fidelitySignalEntries = Object.entries(signals).filter(
			([name]) => name !== "lookup_handle",
		);
		const missing = fidelitySignalEntries
			.filter(([, present]) => !present)
			.map(([name]) => name);
		return {
			applicable: true,
			score:
				fidelitySignalEntries.filter(([, present]) => present).length /
				fidelitySignalEntries.length,
			signals,
			missing,
		};
	}

	const expectedFailureCount = fixture.expectedSignals.expectedFailureCount ?? 1;
	const expectedValueAvailable =
		fixture.expectedSignals.expectedValueAvailable ?? fixture.kind !== "timeout";
	const receivedValueAvailable =
		fixture.expectedSignals.receivedValueAvailable ?? fixture.kind !== "timeout";
	const expectedValuePresent = hasExpectedValueSignal(output, compactRows, toonRows);
	const receivedValuePresent = hasReceivedValueSignal(output, compactRows, toonRows);
	const signals: FidelitySignal = {
		failure_count: observedFailureCount(output, compactRows, toonRows) === expectedFailureCount,
		failing_file: fixture.expectedSignals.failingFile
			? output.includes(fixture.expectedSignals.failingFile)
			: true,
		failing_test: fixture.expectedSignals.failingTests.every((testName) =>
			output.includes(testName),
		),
		assertion_signal: fixture.expectedSignals.assertionPatterns.every((pattern) =>
			lowerOutput.includes(pattern.toLowerCase()),
		),
		bounded_diagnostics: output.length <= DEFAULT_FAILURE_BUDGET_CHARS,
		lookup_handle: /tr_[a-z0-9._-]+/.test(output),
		expected_value: expectedValueAvailable
			? expectedValuePresent
			: !expectedValuePresent,
		received_value: receivedValueAvailable
			? receivedValuePresent
			: !receivedValuePresent,
	};
	const fidelitySignalEntries = Object.entries(signals).filter(
		([name]) => name !== "lookup_handle",
	);
	const missing = fidelitySignalEntries
		.filter(([, present]) => !present)
		.map(([name]) => name);
	return {
		applicable: true,
		score:
			fidelitySignalEntries.filter(([, present]) => present).length /
			fidelitySignalEntries.length,
		signals,
		missing,
	};
}

function observedFailureCount(
	output: string,
	compactRows: readonly unknown[][],
	toonRows: readonly string[][],
): number | null {
	if (compactRows.length > 0) return compactRows.length + observedOmittedCount(output);
	if (toonRows.length > 0) return toonRows.length + observedOmittedCount(output);
	const bunSummary = output.match(/^\s*(\d+) fail$/m);
	if (bunSummary?.[1]) return Number(bunSummary[1]);
	const compactSummary = output.match(/failed=(\d+)/);
	if (compactSummary?.[1]) return Number(compactSummary[1]);
	const jsonSummary = output.match(/"failed"\s*:\s*(\d+)/);
	if (jsonSummary?.[1]) return Number(jsonSummary[1]);
	const failMarkers = (output.match(/^\(fail\) /gm) ?? []).length;
	const detailHandles = new Set(output.match(/tr_[a-z0-9._-]+/g) ?? []);
	const renderedFailures = Math.max(failMarkers, detailHandles.size);
	if (renderedFailures > 0) return renderedFailures + observedOmittedCount(output);
	return null;
}

function observedOmittedCount(output: string): number {
	const toonOmitted = output.match(/^o:(\d+)$/m);
	if (toonOmitted?.[1]) return Number(toonOmitted[1]);
	const plainOmitted = output.match(/- (\d+) more failure\(s\) omitted/);
	if (plainOmitted?.[1]) return Number(plainOmitted[1]);
	const compactOmitted = output.match(/"o"\s*:\s*(\d+)/);
	if (compactOmitted?.[1]) return Number(compactOmitted[1]);
	return 0;
}

function hasExpectedValueSignal(
	output: string,
	compactRows: readonly unknown[][],
	toonRows: readonly string[][],
): boolean {
	return (
		compactRows.some((row) => row[3] !== null && row[3] !== undefined) ||
		toonRows.some((row) => row[3] !== "") ||
		output.includes("Expected:") ||
		output.includes("expected=")
	);
}

function hasReceivedValueSignal(
	output: string,
	compactRows: readonly unknown[][],
	toonRows: readonly string[][],
): boolean {
	return (
		compactRows.some((row) => row[4] !== null && row[4] !== undefined) ||
		toonRows.some((row) => row[4] !== "") ||
		output.includes("Received:") ||
		output.includes("received=")
	);
}

function parseCompactJsonFailureRows(output: string): unknown[][] {
	try {
		const payload = JSON.parse(output) as { f?: unknown };
		return Array.isArray(payload.f)
			? payload.f.filter((row): row is unknown[] => Array.isArray(row))
			: [];
	} catch {
		return [];
	}
}

function parseToonFailureRows(output: string): string[][] {
	const lines = output.split(/\r?\n/);
	const headerIndex = lines.findIndex((line) => /^f\[\d+\]\{l,t,a,e,r,d\}:$/.test(line));
	if (headerIndex === -1) return [];
	const rows: string[][] = [];
	for (const line of lines.slice(headerIndex + 1)) {
		if (!line || /^[a-z]\{/.test(line) || /^[a-z]:/.test(line)) break;
		const row = parseToonCsvLine(line);
		if (row.length >= 6) rows.push(row);
	}
	return rows;
}

function parseToonCsvLine(line: string): string[] {
	const cells: string[] = [];
	let current = "";
	let quoted = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		const next = line[index + 1];
		if (quoted && char === '"' && next === '"') {
			current += '"';
			index += 1;
			continue;
		}
		if (char === '"') {
			quoted = !quoted;
			continue;
		}
		if (!quoted && char === ",") {
			cells.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	cells.push(current);
	return cells;
}

function isCurrentFidelityScore(
	value: Partial<FidelityScore> | null | undefined,
): value is FidelityScore {
	const signals = value?.signals as Partial<FidelitySignal> | undefined;
	return (
		typeof value?.score === "number" &&
		Array.isArray(value.missing) &&
			typeof signals?.failing_file === "boolean" &&
			typeof signals.failure_count === "boolean" &&
			typeof signals.failing_test === "boolean" &&
		typeof signals.assertion_signal === "boolean" &&
		typeof signals.bounded_diagnostics === "boolean" &&
		typeof signals.lookup_handle === "boolean" &&
		typeof signals.expected_value === "boolean" &&
		typeof signals.received_value === "boolean"
	);
}

function applyScores(rows: BenchmarkRow[]): void {
	for (const row of rows) {
		if (row.status === "skipped") {
			row.score = null;
			continue;
		}
		if (!row.exit_correct) {
			row.score = 0;
			row.notes.push("exit correctness failed before token or fidelity scoring");
			continue;
		}
		const nativeBaseline = rows.find(
			(candidate) =>
				candidate.fixture === row.fixture &&
				candidate.variant_kind === "native_bun" &&
				candidate.token_estimate,
		);
		const baselineTokens = nativeBaseline?.token_estimate ?? row.token_estimate ?? 0;
		const tokenReduction =
			baselineTokens > 0 && row.token_estimate !== null
				? Math.max(0, (baselineTokens - row.token_estimate) / baselineTokens)
				: 0;
		const fidelityScore = row.fidelity?.score ?? 0;
		row.score = round2(tokenReduction * 50 + fidelityScore * 50);
		if (
			row.context_mode === "repair" ||
			row.context_mode === "repair-json" ||
			row.context_mode === "repair-toon"
		) {
			const mcp = rows.find(
				(candidate) =>
					candidate.fixture === row.fixture &&
					candidate.variant_kind === "mcp_artifact" &&
					candidate.token_estimate !== null,
			);
			if (mcp?.token_estimate !== null && mcp?.token_estimate !== undefined) {
				const label =
					row.context_mode === "repair-json"
						? "repair JSON"
						: row.context_mode === "repair-toon"
							? "repair TOON"
							: "repair";
				row.notes.push(
					row.token_estimate !== null && row.token_estimate < mcp.token_estimate
						? `${label} token estimate beats MCP artifact`
						: `${label} token estimate does not beat MCP artifact`,
				);
			}
		}
		if (row.context_mode === "triage") {
			const raw = rows.find(
				(candidate) =>
					candidate.fixture === row.fixture && candidate.context_mode === "raw",
			);
			if (raw?.token_estimate !== null && raw?.token_estimate !== undefined) {
				row.notes.push(
					row.token_estimate !== null && row.token_estimate < raw.token_estimate
						? "triage is smaller than raw Bun"
						: "triage is not smaller than raw Bun",
				);
			}
		}
	}
}

function createCandidateGates(rows: BenchmarkRow[]): CandidateGate[] {
	return rows
		.filter((row) => row.status === "measured" && row.exit_correct === true)
		.map((row) => ({
			fixture: row.fixture,
			variant: row.variant,
			exit_correctness_required: true,
			max_token_estimate: row.token_estimate,
			min_fidelity_score: row.fidelity?.score ?? null,
			...(row.context_mode === "repair" ||
			row.context_mode === "repair-json" ||
			row.context_mode === "repair-toon" ||
			row.context_mode === "triage"
				? {
						require_lookup_available: true,
						require_detail_roundtrip: true,
					}
				: {}),
			source: "observed_calibration",
		}));
}

async function evaluateFixedGates(
	cwd: string,
	gateFile: string | null,
	gatePreset: GatePreset | null,
	rows: BenchmarkRow[],
): Promise<GateResult> {
	const candidateGates = gatePreset
		? createPresetGates(gatePreset)
		: await loadFixedGateFile(cwd, gateFile);
	const failures: string[] = [];
	for (const gate of candidateGates) {
		const row = findGateRow(rows, gate);
		if (!row) {
			failures.push(`${gate.variant}/${gate.fixture}: row missing`);
			continue;
		}
		if (row.status === "skipped") {
			failures.push(
				`${gate.variant}/${gate.fixture}: skipped - ${
					row.skip_reason ?? "reason unavailable"
				}`,
			);
			continue;
		}
		if (row.exit_correct !== true) {
			failures.push(`${gate.variant}/${gate.fixture}: exit correctness failed`);
			continue;
		}
		if (
			gate.max_token_estimate !== null &&
			(row.token_estimate === null || row.token_estimate > gate.max_token_estimate)
		) {
			failures.push(`${gate.variant}/${gate.fixture}: token estimate exceeded gate`);
		}
		if (gate.max_token_estimate_variant) {
			const comparison = findComparisonRow(rows, gate);
			if (comparison?.status === "skipped") {
				failures.push(
					`${gate.variant}/${gate.fixture}: comparison row ${
						gate.max_token_estimate_variant
					} skipped - ${comparison.skip_reason ?? "reason unavailable"}`,
				);
			} else if (!comparison || comparison.token_estimate === null) {
				failures.push(
					`${gate.variant}/${gate.fixture}: comparison row ${gate.max_token_estimate_variant} missing`,
				);
			} else if (
				row.token_estimate === null ||
				row.token_estimate > comparison.token_estimate
			) {
				if (!gate.token_exception) {
					failures.push(
						`${gate.variant}/${gate.fixture}: token estimate exceeded ${gate.max_token_estimate_variant}`,
					);
				}
			}
		}
		if (
			gate.min_fidelity_score !== null &&
			(row.fidelity?.score ?? 0) < gate.min_fidelity_score
		) {
			failures.push(`${gate.variant}/${gate.fixture}: fidelity score below gate`);
		}
		if (gate.require_lookup_available && row.lookup_available !== true) {
			failures.push(`${gate.variant}/${gate.fixture}: lookup unavailable`);
		}
		if (
			gate.require_detail_roundtrip &&
			row.detail_roundtrip?.richer_detail !== true
		) {
			failures.push(`${gate.variant}/${gate.fixture}: detail roundtrip failed`);
		}
		if (
			gate.max_detail_test_reruns !== undefined &&
			(row.detail_roundtrip?.test_reruns ?? 0) > gate.max_detail_test_reruns
		) {
			failures.push(`${gate.variant}/${gate.fixture}: detail lookup reran tests`);
		}
		if (
			gate.max_diagnostic_chars !== undefined &&
			(row.diagnostic_chars ?? Number.POSITIVE_INFINITY) > gate.max_diagnostic_chars
		) {
			failures.push(`${gate.variant}/${gate.fixture}: diagnostic chars exceeded gate`);
		}
		if (
			gate.require_no_false_expected_received &&
			(row.fidelity?.signals.expected_value !== true ||
				row.fidelity.signals.received_value !== true)
		) {
			failures.push(
				`${gate.variant}/${gate.fixture}: expected/received availability gate failed`,
			);
		}
	}
	return { status: failures.length === 0 ? "pass" : "fail", failures };
}

async function loadFixedGateFile(
	cwd: string,
	gateFile: string | null,
): Promise<CandidateGate[]> {
	if (!gateFile) return [];
	const gates = JSON.parse(await readFile(join(cwd, gateFile), "utf-8")) as {
		candidate_gates?: CandidateGate[];
		calibration?: { candidate_gates?: CandidateGate[] };
	};
	return gates.candidate_gates ?? gates.calibration?.candidate_gates ?? [];
}

function createPresetGates(preset: GatePreset): CandidateGate[] {
	if (preset !== "bun-no-mcp") return [];
	const gates: CandidateGate[] = [];
	for (const fixture of BENCHMARK_FIXTURES) {
		gates.push({
			fixture: fixture.label,
			variant: "native-bun",
			exit_correctness_required: true,
			max_token_estimate: null,
			min_fidelity_score: 1,
			max_diagnostic_chars: DEFAULT_FAILURE_BUDGET_CHARS,
			source: "observed_calibration",
		});
		for (const variant of ["local-runner-repair-toon", "local-runner-triage"]) {
			gates.push({
				fixture: fixture.label,
				variant,
				exit_correctness_required: true,
				max_token_estimate: null,
				max_token_estimate_variant: "native-bun",
				max_token_estimate_variant_kind: "native_bun",
				min_fidelity_score: 1,
				...(fixture.kind !== "pass"
					? {
							require_lookup_available: true,
							require_detail_roundtrip: true,
							max_detail_test_reruns: 0,
						}
					: {}),
				max_diagnostic_chars: DEFAULT_FAILURE_BUDGET_CHARS,
				source: "observed_calibration",
			});
		}
	}
	return gates;
}

function findGateRow(
	rows: readonly BenchmarkRow[],
	gate: CandidateGate,
): BenchmarkRow | undefined {
	const exact = rows.find(
		(candidate) =>
			candidate.fixture === gate.fixture && candidate.variant === gate.variant,
	);
	if (exact || gate.variant !== "local-runner") return exact;
	return rows.find(
		(candidate) =>
			candidate.fixture === gate.fixture &&
			candidate.variant === "local-runner-compact",
	);
}

function findComparisonRow(
	rows: readonly BenchmarkRow[],
	gate: CandidateGate,
): BenchmarkRow | undefined {
	return rows.find(
		(candidate) =>
			candidate.fixture === gate.fixture &&
			candidate.variant === gate.max_token_estimate_variant &&
			(!gate.max_token_estimate_variant_kind ||
				candidate.variant_kind === gate.max_token_estimate_variant_kind),
	);
}

export function renderEvidenceTable(evidence: BenchmarkEvidence): string {
	const header = [
		"fixture",
		"variant",
		"mode",
		"status",
		"exit",
		"tokens(est)",
		"fidelity",
		"lookup",
		"score",
		"notes",
	];
	const rows = evidence.rows.map((row) => [
		row.fixture,
		row.variant,
		row.context_mode,
		row.status,
		renderExit(row),
		row.token_estimate === null ? "-" : String(row.token_estimate),
		row.fidelity ? renderFidelity(row.fidelity) : "-",
		renderLookup(row),
		row.score === null ? "-" : String(row.score),
		row.skip_reason ?? row.notes.join("; ") ?? "",
	]);
	const widths = header.map((cell, index) =>
		Math.max(cell.length, ...rows.map((row) => row[index]?.length ?? 0)),
	);
	return [
		`Runner Benchmark Evidence (${evidence.mode})`,
		`token_estimate_method=${evidence.token_estimate_method}`,
		formatRow(header, widths),
		formatRow(widths.map((width) => "-".repeat(width)), widths),
		...rows.map((row) => formatRow(row, widths)),
	].join("\n");
}

function renderExit(row: BenchmarkRow): string {
	if (row.exit_correct === null) return "-";
	const marker = row.exit_correct ? "ok" : "bad";
	return `${marker}:${row.exit_code}/${row.expected_exit_code}`;
}

function renderFidelity(fidelity: FidelityScore): string {
	if (!fidelity.applicable) return "n/a";
	return `${round2(fidelity.score)} missing=${fidelity.missing.length}`;
}

function renderLookup(row: BenchmarkRow): string {
	if (!row.detail_roundtrip?.applicable) return row.lookup_available ? "yes" : "-";
	return row.detail_roundtrip.lookup_available && row.detail_roundtrip.richer_detail
		? "roundtrip"
		: "missing";
}

function formatRow(row: string[], widths: number[]): string {
	return row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function truncateSample(text: string): string {
	if (text.length <= 1_500) return text;
	return `${text.slice(0, 1_500)}\n[truncated ${text.length - 1_500} chars]`;
}

function sanitizeBenchmarkOutput(text: string): string {
	return text.replace(
		/\((?:[^()]*\/)?([^/()]+\.test\.[cm]?[tj]sx?:\d+:\d+)\)/g,
		"($1)",
	);
}

function splitCommand(command: string): string[] {
	const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
	return parts.map((part) => part.replace(/^"|"$/g, ""));
}

function requireNext(args: readonly string[], index: number, flag: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
	return value;
}

function createRunId(): string {
	return `bench-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
}

function emptyEvidence(cwd: string, args: ParsedArgs): BenchmarkEvidence {
	return {
		schema_version: "2",
		mode: args.mode,
		run_id: args.runId,
		generated_at: new Date().toISOString(),
		token_estimate_method: TOKEN_ESTIMATE_METHOD,
		fixtures: [],
		rows: [],
		calibration: { candidate_gates: [] },
		gate_result: null,
		output_path: relative(cwd, join(cwd, args.outputDir, `${args.runId}.json`)),
	};
}

function renderHelp(): string {
	return [
		"Usage: test-runner.benchmark.ts [flags]",
		"",
		"Compare Bun test runner variants over stable fixtures.",
		"",
		"Flags:",
		"  --json                         Print JSON evidence to stdout.",
		"  --mode calibration|fixed-gate  Select evidence mode.",
		"  --gate-file <path>             Fixed-gate JSON from a prior calibration.",
		"  --gate-preset bun-no-mcp       Use built-in no-MCP Bun adoption gate.",
		"  --run-id <id>                  Set evidence run id.",
		"  --output-dir <path>            Write evidence JSON under this directory.",
		"  --mcp-baseline <path>          Read MCP baseline artifact when present.",
		"  --no-mcp-baseline              Omit MCP artifact rows from this evidence run.",
		"  --local-runner <command>       Add local runner comparison.",
		"  --include-synthetic            Include scoring probe variants.",
		"  --fixture <a,b>                Limit fixtures by label.",
		"",
	].join("\n");
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

if (import.meta.main) {
	try {
		const result = await runBenchmark(Bun.argv.slice(2));
		process.stdout.write(result.stdout);
		process.exit(result.exitCode);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown benchmark error.";
		if (Bun.argv.includes("--json")) {
			process.stdout.write(
				`${JSON.stringify(
					{
						schema_version: "2",
						status: "error",
						run_id: inferBenchmarkRunId(Bun.argv.slice(2)),
						error: {
							code: "benchmark_usage_error",
							message,
							exit_code: 2,
							hint: "Correct benchmark arguments and rerun.",
						},
					},
					null,
					2,
				)}\n`,
			);
			process.exit(2);
		}
		process.stderr.write(`test-runner benchmark error: ${message}\n`);
		process.exit(2);
	}
}

function inferBenchmarkRunId(argv: readonly string[]): string {
	const index = argv.indexOf("--run-id");
	if (index !== -1 && argv[index + 1]) return argv[index + 1] ?? "unknown";
	return createRunId();
}
