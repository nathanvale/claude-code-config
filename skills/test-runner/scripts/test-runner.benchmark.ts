#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const TOKEN_ESTIMATE_METHOD = "estimate: chars/4 rounded up" as const;
const DEFAULT_MCP_BASELINE_PATH = ".benchmark-input/mcp-baseline.json";
const DEFAULT_OUTPUT_DIR = ".benchmark-output";
const DEFAULT_FAILURE_BUDGET_CHARS = 12_000;

export type FixtureKind = "pass" | "fail" | "timeout";
export type VariantKind =
	| "native_bun"
	| "mcp_artifact"
	| "local_runner"
	| "synthetic";
export type BenchmarkMode = "calibration" | "fixed-gate";

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
	};
};

export type FidelitySignal = {
	failing_file: boolean;
	failing_test: boolean;
	assertion_signal: boolean;
	bounded_diagnostics: boolean;
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
	notes: string[];
};

export type BenchmarkEvidence = {
	schema_version: "1";
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
	min_fidelity_score: number | null;
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
	localRunnerCommand: string | null;
	includeSynthetic: boolean;
	gateFile: string | null;
	fixtureLabels: Set<string> | null;
};

type ProcessResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	wallTimeMs: number;
};

type McpArtifact = {
	rows?: Partial<BenchmarkRow>[];
	fixtures?: Record<string, Partial<BenchmarkRow>>;
};

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
		},
	},
	{
		label: "timeout",
		kind: "timeout",
		file: "fixtures/timeout.test.ts",
		expectedExitCode: 1,
		bunArgs: ["--timeout", "50"],
		expectedSignals: {
			failingFile: "timeout.test.ts",
			failingTests: ["times out a slow promise"],
			assertionPatterns: ["timeout", "50"],
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

	rows.push(...(await loadMcpRows(cwd, args.mcpBaselinePath, fixtures)));

	if (args.localRunnerCommand) {
		for (const fixture of fixtures) {
			rows.push(await runLocalRunnerFixture(cwd, fixture, args.localRunnerCommand));
		}
	}

	if (args.includeSynthetic) rows.push(...createSyntheticRows(fixtures));

	applyScores(rows);

	const outputDir = join(cwd, args.outputDir);
	await mkdir(outputDir, { recursive: true });
	const outputPath = join(outputDir, `${args.runId}-${args.mode}.json`);
	const evidence: BenchmarkEvidence = {
		schema_version: "1",
		mode: args.mode,
		run_id: args.runId,
		generated_at: (options.now ?? new Date()).toISOString(),
		token_estimate_method: TOKEN_ESTIMATE_METHOD,
		fixtures,
		rows,
		calibration: {
			candidate_gates: createCandidateGates(rows),
			...(args.gateFile ? { fixed_gate_input: args.gateFile } : {}),
		},
		gate_result:
			args.mode === "fixed-gate"
				? await evaluateFixedGates(cwd, args.gateFile, rows)
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
		localRunnerCommand: null,
		includeSynthetic: false,
		gateFile: null,
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
			case "--local-runner":
				parsed.localRunnerCommand = requireNext(args, index, "--local-runner");
				index += 1;
				break;
			case "--gate-file":
				parsed.gateFile = requireNext(args, index, "--gate-file");
				index += 1;
				break;
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

	if (parsed.mode === "fixed-gate" && !parsed.gateFile) {
		throw new Error("--mode fixed-gate requires --gate-file.");
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
	return createMeasuredRow("native-bun", "native_bun", fixture, result);
}

async function runLocalRunnerFixture(
	cwd: string,
	fixture: BenchmarkFixture,
	command: string,
): Promise<BenchmarkRow> {
	const result = await runProcess(
		[
			...splitCommand(command),
			"--cwd",
			cwd,
			"--json",
			"--",
			fixture.file,
			...fixture.bunArgs,
		],
		cwd,
	);
	return createMeasuredRow("local-runner", "local_runner", fixture, result);
}

async function runProcess(command: string[], cwd: string): Promise<ProcessResult> {
	const startedAt = performance.now();
	const proc = Bun.spawn(command, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return {
		exitCode,
		stdout,
		stderr,
		wallTimeMs: Math.round(performance.now() - startedAt),
	};
}

function createMeasuredRow(
	variant: string,
	variantKind: VariantKind,
	fixture: BenchmarkFixture,
	result: ProcessResult,
): BenchmarkRow {
	const combined = `${result.stdout}\n${result.stderr}`;
	return {
		fixture: fixture.label,
		variant,
		variant_kind: variantKind,
		status: "measured",
		exit_code: result.exitCode,
		expected_exit_code: fixture.expectedExitCode,
		exit_correct: result.exitCode === fixture.expectedExitCode,
		wall_time_ms: result.wallTimeMs,
		token_estimate: estimateTokens(combined),
		token_estimate_method: TOKEN_ESTIMATE_METHOD,
		fidelity: scoreFidelity(fixture, combined),
		score: null,
		diagnostic_chars: combined.length,
		stdout_sample: truncateSample(result.stdout),
		stderr_sample: truncateSample(result.stderr),
		notes: [],
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
	const output = `${source.stdout_sample ?? ""}\n${source.stderr_sample ?? ""}`;
	const exitCode = typeof source.exit_code === "number" ? source.exit_code : null;
	return {
		fixture: fixture.label,
		variant: source.variant ?? "mcp-artifact",
		variant_kind: "mcp_artifact",
		status: "measured",
		exit_code: exitCode,
		expected_exit_code: fixture.expectedExitCode,
		exit_correct: exitCode === null ? null : exitCode === fixture.expectedExitCode,
		wall_time_ms: source.wall_time_ms ?? null,
		token_estimate: source.token_estimate ?? estimateTokens(output),
		token_estimate_method: TOKEN_ESTIMATE_METHOD,
		fidelity: source.fidelity ?? scoreFidelity(fixture, output),
		score: null,
		diagnostic_chars: source.diagnostic_chars ?? output.length,
		stdout_sample: source.stdout_sample,
		stderr_sample: source.stderr_sample,
		notes: ["loaded from MCP baseline artifact"],
	};
}

function createSkippedMcpRow(
	fixture: BenchmarkFixture,
	reason: string,
): BenchmarkRow {
	return {
		fixture: fixture.label,
		variant: "mcp-artifact",
		variant_kind: "mcp_artifact",
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
	if (fixture.kind === "pass") {
		return {
			applicable: false,
			score: 1,
			signals: {
				failing_file: true,
				failing_test: true,
				assertion_signal: true,
				bounded_diagnostics: output.length <= DEFAULT_FAILURE_BUDGET_CHARS,
			},
			missing: [],
		};
	}

	const lowerOutput = output.toLowerCase();
	const signals: FidelitySignal = {
		failing_file: fixture.expectedSignals.failingFile
			? output.includes(fixture.expectedSignals.failingFile)
			: true,
		failing_test: fixture.expectedSignals.failingTests.some((testName) =>
			output.includes(testName),
		),
		assertion_signal: fixture.expectedSignals.assertionPatterns.some((pattern) =>
			lowerOutput.includes(pattern.toLowerCase()),
		),
		bounded_diagnostics: output.length <= DEFAULT_FAILURE_BUDGET_CHARS,
	};
	const missing = Object.entries(signals)
		.filter(([, present]) => !present)
		.map(([name]) => name);
	return {
		applicable: true,
		score:
			Object.values(signals).filter(Boolean).length / Object.values(signals).length,
		signals,
		missing,
	};
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
			source: "observed_calibration",
		}));
}

async function evaluateFixedGates(
	cwd: string,
	gateFile: string | null,
	rows: BenchmarkRow[],
): Promise<GateResult> {
	if (!gateFile) return { status: "not_applicable", failures: [] };
	const gates = JSON.parse(await readFile(join(cwd, gateFile), "utf-8")) as {
		candidate_gates?: CandidateGate[];
	};
	const failures: string[] = [];
	for (const gate of gates.candidate_gates ?? []) {
		const row = rows.find(
			(candidate) =>
				candidate.fixture === gate.fixture && candidate.variant === gate.variant,
		);
		if (!row) {
			failures.push(`${gate.variant}/${gate.fixture}: row missing`);
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
		if (
			gate.min_fidelity_score !== null &&
			(row.fidelity?.score ?? 0) < gate.min_fidelity_score
		) {
			failures.push(`${gate.variant}/${gate.fixture}: fidelity score below gate`);
		}
	}
	return { status: failures.length === 0 ? "pass" : "fail", failures };
}

export function renderEvidenceTable(evidence: BenchmarkEvidence): string {
	const header = [
		"fixture",
		"variant",
		"status",
		"exit",
		"tokens(est)",
		"fidelity",
		"score",
		"notes",
	];
	const rows = evidence.rows.map((row) => [
		row.fixture,
		row.variant,
		row.status,
		renderExit(row),
		row.token_estimate === null ? "-" : String(row.token_estimate),
		row.fidelity ? renderFidelity(row.fidelity) : "-",
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
		schema_version: "1",
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
		"  --run-id <id>                  Set evidence run id.",
		"  --output-dir <path>            Write evidence JSON under this directory.",
		"  --mcp-baseline <path>          Read MCP baseline artifact when present.",
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
		process.stderr.write(`test-runner benchmark error: ${message}\n`);
		process.exit(2);
	}
}

