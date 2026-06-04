#!/usr/bin/env bun

import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { delimiter, join, resolve } from "node:path";
import {
	type CliWriter,
	CliUsageError,
	renderCommandUsage,
	usageError,
} from "@side-quest/cli-command-facade";
import {
	DEFAULT_MAX_OUTPUT_BYTES,
	FALLOW_EVIDENCE_GRADE_BY_KEY,
	FALLOW_OUTPUT_BUDGET_STATUS_BY_KEY,
	FALLOW_REPAIR_ACTION_BY_KEY,
	FALLOW_RESOLVER_ACTION_BY_KEY,
	FALLOW_RESOLVER_NEXT_ACTION_BY_KEY,
	FALLOW_RESOLVER_VERDICT_BY_KEY,
	FALLOW_RUNNER_COMMANDS,
	FALLOW_RUNNER_CONTRACT_ID,
	FALLOW_RUNNER_SCHEMA_VERSION,
	FALLOW_STDERR_CATEGORY_BY_KEY,
	type FallowEvidenceGrade,
	type FallowFailureCategory,
	type FallowOutputBudgetStatus,
	type FallowRepairAction,
	type FallowResolverAction,
	type FallowResolverNextAction,
	type FallowResolverVerdict,
	type FallowRunnerCommand,
	type FallowStatus,
	type FallowStderrCategory,
	type FallowWriteEffect,
	fallowRunnerContracts,
} from "./command-contract";
import {
	type TraceFailureReason,
	type TraceResult,
	deriveEvidenceGrade,
	failureEvidenceGrade,
	traceExportReachability,
} from "./why-trace";

const VERSION = "0.1.0";
const FALLOW_PROCESS_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const execFileAsync = promisify(execFile);

type OutputMode = "json" | "plain";

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type FallowRunnerRuntime = {
	cwd: string;
	env: Record<string, string | undefined>;
	now: () => number;
	randomId: () => string;
	isDirectory: (path: string) => Promise<boolean>;
	pathExists: (path: string) => Promise<boolean>;
	isExecutable: (path: string) => Promise<boolean>;
	lookupExecutable: (name: string) => Promise<string | undefined>;
	runCommand: (
		command: string,
		args: readonly string[],
		options: { cwd: string },
	) => Promise<CommandResult>;
};

type ParsedCommand = {
	kind: "command";
	command: FallowRunnerCommand;
	root?: string;
	includeRawOutput: boolean;
	maxOutputBytes: number;
	outputMode: OutputMode;
	baseRef?: string;
	applyAuthorized: boolean;
	file?: string;
	exportName?: string;
};

type ParsedArgv =
	| { kind: "help"; command?: FallowRunnerCommand }
	| { kind: "version" }
	| ParsedCommand;

type RepairHint = {
	action: FallowRepairAction;
	message: string;
	retry_safe: boolean;
};

type RepairHintKind =
	| "invalid-root"
	| "invalid-usage"
	| "unsupported-root"
	| "missing-fallow"
	| "git-readiness"
	| "invalid-base-ref"
	| "runtime-failure"
	| "parse-output"
	| "reduce-output"
	| "apply-shaped"
	| "config-before-apply"
	| "transient-retry"
	| "trace-symbol"
	| "trace-transport";

type BinaryReadiness = {
	status: "ok" | "missing";
	source?: "local" | "path";
	path?: string;
};

type RepoShapeReadiness = {
	status: "ok" | "unsupported";
	detected: string[];
};

type GitReadiness = {
	status: "ok" | "blocked";
	message?: string;
};

type ConfigReadiness = {
	present: boolean;
	paths: string[];
};

type ReadinessSummary = {
	root: {
		status: "ok";
		path: string;
	};
	repo_shape: RepoShapeReadiness;
	fallow_binary: BinaryReadiness;
	config: ConfigReadiness;
	git: GitReadiness;
};

type FallowRunnerSummary = {
	total_findings: number | null;
	auto_fixable: number;
	needs_trace: number;
	needs_human: number;
	mode_evidence?: Record<string, unknown>;
	readiness?: ReadinessSummary;
};

// A tiny per-finding continuation that names a runnable evidence-gathering
// target for one finding. Distinct from blocked-run repair_hints: resolver
// actions belong to usable finding evidence, not failure recovery. Payload
// stays minimal (R6/R9): action identity, runnable target, required
// coordinates, a reason, and a discovery pointer. Exact flags and output shape
// live in command help and discovery, not in this payload (R10) — `discover`
// names where a prompt-free agent resolves `target` into exact syntax.
type FallowResolverActionRef = {
	action: FallowResolverAction;
	target: FallowRunnerCommand;
	coordinates: { file: string; export: string };
	reason: string;
	discover: string;
};

type FallowIssueReference = {
	id?: string;
	path?: string;
	range?: {
		start_line?: number;
		start_column?: number;
		end_line?: number;
		end_column?: number;
	};
	rule?: string;
	category?: string;
	action?: string;
	symbol?: string;
	// audit `--gate new-only`: true when the changeset introduced the finding,
	// false when inherited from the base. Absent outside audit.
	introduced?: boolean;
	// Advertised only for introduced traceable `remove-export` findings (U2).
	resolver_actions?: FallowResolverActionRef[];
};

type FallowRunnerEnvelope = {
	contract_id: typeof FALLOW_RUNNER_CONTRACT_ID;
	schema_version: typeof FALLOW_RUNNER_SCHEMA_VERSION;
	status: FallowStatus;
	mode: FallowRunnerCommand;
	run_id: string;
	command: string[];
	cwd: string;
	exit_code: number;
	stderr_category: FallowStderrCategory;
	failure_category: FallowFailureCategory;
	write_effect: FallowWriteEffect;
	fallow_output: unknown;
	issue_references: FallowIssueReference[];
	output_budget: {
		status: FallowOutputBudgetStatus;
		max_output_bytes: number;
		raw_output_requested: boolean;
		raw_output_included: boolean;
	};
	summary: FallowRunnerSummary;
	repair_hints: RepairHint[];
};

type FallowEnvelopeInput = {
	status: FallowStatus;
	mode: FallowRunnerCommand;
	runId: string;
	command: string[];
	cwd: string;
	exitCode: number;
	stderrCategory?: FallowStderrCategory;
	failureCategory: FallowFailureCategory;
	writeEffect: FallowWriteEffect;
	maxOutputBytes: number;
	rawRequested: boolean;
	rawOutputIncluded?: boolean;
	outputBudgetStatus?: FallowOutputBudgetStatus;
	fallowOutput?: unknown;
	summary?: FallowRunnerSummary;
	issueReferences?: FallowIssueReference[];
	repairHints?: RepairHint[];
	outputMode?: OutputMode;
};

const COMMON_CONFIG_PATHS = [
	".fallowrc",
	".fallowrc.json",
	"fallow.toml",
	"fallow.config.js",
	"fallow.config.ts",
] as const;

const LOCAL_FALLOW_PATHS = [
	"node_modules/.bin/fallow",
	"node_modules/.bin/fallow.cmd",
] as const;

const UNSUPPORTED_PUBLIC_CONTROLS = new Set([
	"--cwd",
	"--mode",
	"--watch",
	"--baseline",
	"--generate-ci",
	"--ci",
	"--create-ci",
	"--update-baseline",
]);

const APPLY_SHAPED_CONTROLS = new Set([
	"--apply",
	"--fix",
	"--write",
	"--yes",
]);

export function createDefaultFallowRuntime(
	overrides: Partial<FallowRunnerRuntime> = {},
): FallowRunnerRuntime {
	const env = { ...process.env, ...(overrides.env ?? {}) };
	const runtime: FallowRunnerRuntime = {
		cwd: process.cwd(),
		env,
		now: () => Date.now(),
		randomId: () => Math.random().toString(36).slice(2, 8),
		isDirectory: async (path) => {
			try {
				return (await stat(path)).isDirectory();
			} catch {
				return false;
			}
		},
		pathExists: async (path) => {
			try {
				await stat(path);
				return true;
			} catch {
				return false;
			}
		},
		isExecutable: async (path) => {
			try {
				await access(path, constants.X_OK);
				return true;
			} catch {
				return false;
			}
		},
		lookupExecutable: async (name) => lookupExecutable(name, env),
		runCommand: async (command, args, options) => runCommand(command, args, options),
	};
	return { ...runtime, ...overrides, env };
}

export async function runFallowRunnerCli(
	argv: readonly string[],
	options: {
		runtime?: FallowRunnerRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultFallowRuntime();
	const stdout = options.stdout ?? process.stdout;
	let parsed: ParsedArgv;
	try {
		parsed = parseFallowArgv(argv);
	} catch (error) {
		if (error instanceof CliUsageError) {
			return emitUsageError(argv, runtime, stdout, error);
		}
		throw error;
	}

	if (parsed.kind === "help") {
		stdout.write(renderHelp(parsed.command));
		return 0;
	}
	if (parsed.kind === "version") {
		stdout.write(`fallow-runner ${VERSION}\n`);
		return 0;
	}

	return runParsedCommand(parsed, runtime, stdout);
}

async function runParsedCommand(
	parsed: ParsedCommand,
	runtime: FallowRunnerRuntime,
	stdout: CliWriter,
): Promise<number> {
	const runId = makeRunId(runtime);
	const root = resolve(runtime.cwd, parsed.root ?? ".");
	const maxOutputBytes = parsed.maxOutputBytes;
	const rawRequested = parsed.includeRawOutput;

	if (!(await runtime.isDirectory(root))) {
		writeEnvelope(
			stdout,
			makeEnvelope({
				status: "blocked",
				mode: parsed.command,
				runId,
				command: commandFor(parsed),
				cwd: root,
				exitCode: 1,
				failureCategory: "input",
				writeEffect: "none",
				maxOutputBytes,
				rawRequested,
				repairHints: [repairHintFor("invalid-root")],
			}),
			parsed.outputMode,
		);
		return 1;
	}

	if (parsed.command === "fix-apply" && !parsed.applyAuthorized) {
		writeEnvelope(
			stdout,
			makeEnvelope({
				status: "blocked",
				mode: parsed.command,
				runId,
				command: ["fallow-runner", "fix-apply"],
				cwd: root,
				exitCode: 1,
				failureCategory: "safety",
				writeEffect: "none",
				maxOutputBytes,
				rawRequested,
				repairHints: [repairHintFor("apply-shaped")],
			}),
			parsed.outputMode,
		);
		return 1;
	}

	// The resolver target runs on the mcporter trace transport, not the Fallow
	// CLI, so it skips Fallow-binary readiness and ordinary evidence dispatch.
	if (parsed.command === "why") {
		return emitWhy(parsed, root, runtime, stdout, runId);
	}

	const readiness = await inspectReadiness(root, runtime);
	if (parsed.command === "doctor") {
		return emitDoctor(parsed, readiness, runtime, stdout, runId);
	}

	const blockingHint = blockingReadinessHint(parsed.command, readiness);
	if (blockingHint) {
		writeEnvelope(
			stdout,
			makeEnvelope({
				status: "blocked",
				mode: parsed.command,
				runId,
				command: commandFor(parsed),
				cwd: root,
				exitCode: 1,
				failureCategory: "setup",
				writeEffect: "none",
				maxOutputBytes,
				rawRequested,
				summary: summaryWithReadiness(readiness),
				repairHints: [blockingHint],
			}),
			parsed.outputMode,
		);
		return 1;
	}

	const auditBaseRefHint = await validateAuditBaseRef(parsed, root, runtime);
	if (auditBaseRefHint) {
		writeEnvelope(
			stdout,
			makeEnvelope({
				status: "blocked",
				mode: parsed.command,
				runId,
				command: commandFor(parsed),
				cwd: root,
				exitCode: 1,
				failureCategory: "input",
				writeEffect: "none",
				maxOutputBytes,
				rawRequested,
				summary: summaryWithReadiness(readiness),
				repairHints: [auditBaseRefHint],
			}),
			parsed.outputMode,
		);
		return 1;
	}

	if (isEvidenceCommand(parsed.command)) {
		const invocation = fallowInvocationFor(parsed, readiness);
		const command = [invocation.command, ...invocation.args];
		const result = await runtime.runCommand(invocation.command, invocation.args, {
			cwd: root,
		});
		const stderrCategory = categorizeStderr(result.stderr);

		if (result.exitCode !== 0 && result.stdout.trim() === "") {
			writeEnvelope(
				stdout,
				makeEnvelope({
					status: "blocked",
					mode: parsed.command,
					runId,
					command,
					cwd: root,
					exitCode: result.exitCode,
					stderrCategory,
					failureCategory: "fallow",
					writeEffect: "none",
					maxOutputBytes,
					rawRequested,
					summary: summaryWithReadiness(readiness),
					repairHints: [
						repairHintFor(runtimeFailureHintKind(parsed.command, result.stderr)),
					],
				}),
				parsed.outputMode,
			);
			return 1;
		}

		const parsedOutput = parseJsonOutput(result.stdout);
		if (!parsedOutput.ok) {
			writeEnvelope(
				stdout,
				makeEnvelope({
					status: "blocked",
					mode: parsed.command,
					runId,
					command,
					cwd: root,
					exitCode: result.exitCode === 0 ? 1 : result.exitCode,
					stderrCategory,
					failureCategory: "parse",
					writeEffect: "none",
					maxOutputBytes,
					rawRequested,
					summary: summaryWithReadiness(readiness),
					repairHints: [repairHintFor("parse-output")],
				}),
				parsed.outputMode,
			);
			return 1;
		}

		if (
			result.exitCode !== 0 &&
			!hasRecognizableAnalyzerEvidence(parsed.command, parsedOutput.value)
		) {
			writeEnvelope(
				stdout,
				makeEnvelope({
					status: "blocked",
					mode: parsed.command,
					runId,
					command,
					cwd: root,
					exitCode: result.exitCode,
					stderrCategory,
					failureCategory: "fallow",
					writeEffect: "none",
					maxOutputBytes,
					rawRequested,
					summary: summaryWithReadiness(readiness),
					repairHints: [
						repairHintFor(runtimeFailureHintKind(parsed.command, result.stderr)),
					],
				}),
				parsed.outputMode,
			);
			return 1;
		}

		const evidence = summarizeFallowEvidence(
			parsed.command,
			parsedOutput.value,
		);
		return writeBudgetedEnvelope(stdout, {
			status: evidence.status,
			mode: parsed.command,
			runId,
			command,
			cwd: root,
			exitCode: result.exitCode,
			stderrCategory,
			failureCategory: "none",
			writeEffect: "none",
			maxOutputBytes,
			rawRequested,
			rawOutputIncluded: rawRequested,
			fallowOutput: rawRequested ? parsedOutput.value : null,
			summary: evidence.summary,
			issueReferences: evidence.issueReferences,
			outputMode: parsed.outputMode,
		});
	}

	if (isWriteCommand(parsed.command)) {
		const invocation = fallowInvocationFor(parsed, readiness);
		const command = [invocation.command, ...invocation.args];
		const configSafetyHints = configSafetyHintsFor(parsed.command, readiness);
		const result = await runtime.runCommand(invocation.command, invocation.args, {
			cwd: root,
		});
		const stderrCategory = categorizeStderr(result.stderr);

		if (result.exitCode !== 0) {
			writeEnvelope(
				stdout,
				makeEnvelope({
					status: "blocked",
					mode: parsed.command,
					runId,
					command,
					cwd: root,
					exitCode: result.exitCode,
					stderrCategory,
					failureCategory: "fallow",
					writeEffect: "none",
					maxOutputBytes,
					rawRequested,
					summary: writeSummaryWithReadiness(parsed.command, null, readiness),
					repairHints:
						configSafetyHints.length > 0
							? configSafetyHints
							: [repairHintFor("runtime-failure")],
				}),
				parsed.outputMode,
			);
			return 1;
		}

		const parsedOutput = parseJsonOutput(result.stdout);
		if (!parsedOutput.ok) {
			writeEnvelope(
				stdout,
				makeEnvelope({
					status: "blocked",
					mode: parsed.command,
					runId,
					command,
					cwd: root,
					exitCode: 1,
					stderrCategory,
					failureCategory: "parse",
					writeEffect: "none",
					maxOutputBytes,
					rawRequested,
					summary: writeSummaryWithReadiness(parsed.command, null, readiness),
					repairHints:
						configSafetyHints.length > 0
							? configSafetyHints
							: [repairHintFor("parse-output")],
				}),
				parsed.outputMode,
			);
			return 1;
		}

		const writeSummary = summarizeFallowWrite(
			parsed.command,
			parsedOutput.value,
			readiness,
		);
		return writeBudgetedEnvelope(stdout, {
			status: writeSummary.status,
			mode: parsed.command,
			runId,
			command,
			cwd: root,
			exitCode: result.exitCode,
			stderrCategory,
			failureCategory: "none",
			writeEffect: parsed.command === "fix-preview" ? "previewed" : "applied",
			maxOutputBytes,
			rawRequested,
			rawOutputIncluded: rawRequested,
			fallowOutput: rawRequested ? parsedOutput.value : null,
			summary: writeSummary.summary,
			issueReferences: writeSummary.issueReferences,
			repairHints: configSafetyHints,
			outputMode: parsed.outputMode,
		});
	}

	writeEnvelope(
		stdout,
		makeEnvelope({
			status: "blocked",
			mode: parsed.command,
			runId,
			command: commandFor(parsed),
			cwd: root,
			exitCode: 1,
			failureCategory: "fallow",
			writeEffect: "none",
			maxOutputBytes,
			rawRequested,
			summary: summaryWithReadiness(readiness),
			repairHints: [repairHintFor("runtime-failure")],
		}),
		parsed.outputMode,
	);
	return 1;
}

function emitDoctor(
	parsed: ParsedCommand,
	readiness: ReadinessSummary,
	runtime: FallowRunnerRuntime,
	stdout: CliWriter,
	runId: string,
): number {
	const mandatoryBlocked =
		readiness.repo_shape.status !== "ok" ||
		readiness.fallow_binary.status !== "ok";
	const status: FallowStatus = mandatoryBlocked
		? "blocked"
		: readiness.git.status === "ok"
			? "ok"
			: "issues";
	const exitCode = mandatoryBlocked ? 1 : 0;
	const repairHints = mandatoryBlocked
		? [blockingReadinessHint("doctor", readiness)].filter(isRepairHint)
		: readiness.git.status === "ok"
			? []
			: [repairHintFor("git-readiness")];

	writeEnvelope(
		stdout,
		makeEnvelope({
			status,
			mode: "doctor",
			runId,
			command: ["fallow-runner", "doctor"],
			cwd: readiness.root.path,
			exitCode,
			failureCategory: mandatoryBlocked ? "setup" : "none",
			writeEffect: "none",
			maxOutputBytes: parsed.maxOutputBytes,
			rawRequested: parsed.includeRawOutput,
			summary: summaryWithReadiness(readiness),
			repairHints,
		}),
		parsed.outputMode,
	);
	return exitCode;
}

type ResolverDerivation = {
	status: FallowStatus;
	failureCategory: FallowFailureCategory;
	exitCode: number;
	verdict: FallowResolverVerdict;
	nextAction: FallowResolverNextAction;
};

// Evidence grade is the source of truth; verdict, next action, and runner
// status are derived helpers (R14-R19). Absence of references is a candidate
// removal, never deletion proof; unresolved or unavailable evidence blocks
// deletion and stops.
function deriveResolver(grade: FallowEvidenceGrade): ResolverDerivation {
	if (
		grade === FALLOW_EVIDENCE_GRADE_BY_KEY.referenced ||
		grade === FALLOW_EVIDENCE_GRADE_BY_KEY.entryPoint
	) {
		return {
			status: "ok",
			failureCategory: "none",
			exitCode: 0,
			verdict: FALLOW_RESOLVER_VERDICT_BY_KEY.keep,
			nextAction: FALLOW_RESOLVER_NEXT_ACTION_BY_KEY.keepExport,
		};
	}
	if (grade === FALLOW_EVIDENCE_GRADE_BY_KEY.unreferencedByTrace) {
		return {
			status: "issues",
			failureCategory: "none",
			exitCode: 0,
			verdict: FALLOW_RESOLVER_VERDICT_BY_KEY.candidateRemove,
			nextAction: FALLOW_RESOLVER_NEXT_ACTION_BY_KEY.candidateRemove,
		};
	}
	// unresolved (bad coordinates) -> input; unavailable (transport) -> setup.
	return {
		status: "blocked",
		failureCategory:
			grade === FALLOW_EVIDENCE_GRADE_BY_KEY.unresolved ? "input" : "setup",
		exitCode: 1,
		verdict: FALLOW_RESOLVER_VERDICT_BY_KEY.inconclusive,
		nextAction: FALLOW_RESOLVER_NEXT_ACTION_BY_KEY.stop,
	};
}

function repairKindForTraceFailure(reason: TraceFailureReason): RepairHintKind {
	return reason === "symbol_not_found" ? "trace-symbol" : "trace-transport";
}

async function emitWhy(
	parsed: ParsedCommand,
	root: string,
	runtime: FallowRunnerRuntime,
	stdout: CliWriter,
	runId: string,
): Promise<number> {
	// parseCommandOptions guarantees both coordinates for `why`.
	const file = parsed.file as string;
	const exportName = parsed.exportName as string;

	const trace: TraceResult = await traceExportReachability({
		file,
		exportName,
		root,
		env: runtime.env,
		runCommand: runtime.runCommand,
	});

	const grade = trace.ok
		? deriveEvidenceGrade(trace.evidence)
		: failureEvidenceGrade(trace.reason);
	const derivation = deriveResolver(grade);

	const resolver: Record<string, unknown> = {
		grade,
		verdict: derivation.verdict,
		next_action: derivation.nextAction,
		file,
		export: exportName,
	};
	if (trace.ok) {
		resolver.references = trace.evidence.direct_references.length;
		resolver.entry_point = trace.evidence.is_entry_point;
		resolver.file_reachable = trace.evidence.file_reachable;
	} else {
		resolver.detail = trace.message;
	}

	// Repair hints attach only to blocked trace failures; clean evidence (keep
	// or candidate-remove) carries its next action in the resolver block.
	const repairHints = trace.ok
		? []
		: [repairHintFor(repairKindForTraceFailure(trace.reason))];

	return writeBudgetedEnvelope(stdout, {
		status: derivation.status,
		mode: "why",
		runId,
		command: ["fallow-runner", "why"],
		cwd: root,
		exitCode: derivation.exitCode,
		failureCategory: derivation.failureCategory,
		writeEffect: "none",
		maxOutputBytes: parsed.maxOutputBytes,
		rawRequested: parsed.includeRawOutput,
		rawOutputIncluded: parsed.includeRawOutput,
		fallowOutput:
			parsed.includeRawOutput && trace.ok ? trace.evidence : null,
		summary: { ...emptySummary(), mode_evidence: { resolver } },
		repairHints,
		outputMode: parsed.outputMode,
	});
}

async function inspectReadiness(
	root: string,
	runtime: FallowRunnerRuntime,
): Promise<ReadinessSummary> {
	const [repoShape, fallowBinary, config, git] = await Promise.all([
		detectRepoShape(root, runtime),
		resolveFallowBinary(root, runtime),
		detectConfig(root, runtime),
		checkGitReadiness(root, runtime),
	]);

	return {
		root: { status: "ok", path: root },
		repo_shape: repoShape,
		fallow_binary: fallowBinary,
		config,
		git,
	};
}

async function detectRepoShape(
	root: string,
	runtime: FallowRunnerRuntime,
): Promise<RepoShapeReadiness> {
	const probes = [
		["package.json", "package.json"],
		["tsconfig.json", "tsconfig.json"],
		["jsconfig.json", "jsconfig.json"],
	] as const;
	const detected: string[] = [];
	for (const [relative, label] of probes) {
		if (await runtime.pathExists(join(root, relative))) detected.push(label);
	}
	return {
		status: detected.length > 0 ? "ok" : "unsupported",
		detected,
	};
}

async function resolveFallowBinary(
	root: string,
	runtime: FallowRunnerRuntime,
): Promise<BinaryReadiness> {
	for (const relative of LOCAL_FALLOW_PATHS) {
		const path = join(root, relative);
		if ((await runtime.pathExists(path)) && (await runtime.isExecutable(path))) {
			return { status: "ok", source: "local", path };
		}
	}

	const path = await runtime.lookupExecutable("fallow");
	if (path) return { status: "ok", source: "path", path };
	return { status: "missing" };
}

async function detectConfig(
	root: string,
	runtime: FallowRunnerRuntime,
): Promise<ConfigReadiness> {
	const paths: string[] = [];
	for (const relative of COMMON_CONFIG_PATHS) {
		const path = join(root, relative);
		if (await runtime.pathExists(path)) paths.push(path);
	}
	return { present: paths.length > 0, paths };
}

async function checkGitReadiness(
	root: string,
	runtime: FallowRunnerRuntime,
): Promise<GitReadiness> {
	const result = await runtime.runCommand(
		"git",
		["-C", root, "rev-parse", "--is-inside-work-tree"],
		{ cwd: root },
	);
	if (result.exitCode === 0 && result.stdout.trim() === "true") {
		return { status: "ok" };
	}
	return {
		status: "blocked",
		message: result.stderr.trim() || "git work tree not available",
	};
}

function blockingReadinessHint(
	command: FallowRunnerCommand,
	readiness: ReadinessSummary,
): RepairHint | undefined {
	if (readiness.repo_shape.status !== "ok") {
		return repairHintFor("unsupported-root");
	}
	if (readiness.fallow_binary.status !== "ok") {
		return repairHintFor("missing-fallow");
	}
	if (command === "audit" && readiness.git.status !== "ok") {
		return repairHintFor("git-readiness");
	}
	return undefined;
}

async function validateAuditBaseRef(
	parsed: ParsedCommand,
	root: string,
	runtime: FallowRunnerRuntime,
): Promise<RepairHint | undefined> {
	if (parsed.command !== "audit" || !parsed.baseRef) return undefined;
	const result = await runtime.runCommand(
		"git",
		["-C", root, "rev-parse", "--verify", parsed.baseRef],
		{ cwd: root },
	);
	return result.exitCode === 0 ? undefined : repairHintFor("invalid-base-ref");
}

function summaryWithReadiness(readiness: ReadinessSummary): FallowRunnerSummary {
	return {
		...emptySummary(),
		readiness,
	};
}

function writeBudgetedEnvelope(
	stdout: CliWriter,
	input: FallowEnvelopeInput,
): number {
	const envelope = makeEnvelope(input);
	if (envelopeByteLength(envelope) <= input.maxOutputBytes) {
		writeEnvelope(stdout, envelope, input.outputMode ?? "json");
		return input.status === "blocked" ? 1 : 0;
	}

	if (input.rawRequested && input.rawOutputIncluded) {
		const summaryOnly = makeEnvelope({
			...input,
			fallowOutput: null,
			rawOutputIncluded: false,
			outputBudgetStatus: FALLOW_OUTPUT_BUDGET_STATUS_BY_KEY.rawOmitted,
		});
		if (envelopeByteLength(summaryOnly) <= input.maxOutputBytes) {
			writeEnvelope(stdout, summaryOnly, input.outputMode ?? "json");
			return input.status === "blocked" ? 1 : 0;
		}
	}

	writeEnvelope(
		stdout,
		makeEnvelope({
			...input,
			status: "blocked",
			exitCode: 1,
			failureCategory: "budget",
			fallowOutput: null,
			rawOutputIncluded: false,
			outputBudgetStatus: FALLOW_OUTPUT_BUDGET_STATUS_BY_KEY.summaryImpossible,
			repairHints: [repairHintFor("reduce-output")],
		}),
		input.outputMode ?? "json",
	);
	return 1;
}

function envelopeByteLength(envelope: FallowRunnerEnvelope): number {
	return new TextEncoder().encode(`${JSON.stringify(envelope, null, 2)}\n`)
		.length;
}

function makeEnvelope(input: FallowEnvelopeInput): FallowRunnerEnvelope {
	return {
		contract_id: FALLOW_RUNNER_CONTRACT_ID,
		schema_version: FALLOW_RUNNER_SCHEMA_VERSION,
		status: input.status,
		mode: input.mode,
		run_id: input.runId,
		command: input.command,
		cwd: input.cwd,
		exit_code: input.exitCode,
		stderr_category:
			input.stderrCategory ?? FALLOW_STDERR_CATEGORY_BY_KEY.empty,
		failure_category: input.failureCategory,
		write_effect: input.writeEffect,
		fallow_output: input.fallowOutput ?? null,
		issue_references: input.issueReferences ?? [],
		output_budget: {
			status:
				input.outputBudgetStatus ??
				FALLOW_OUTPUT_BUDGET_STATUS_BY_KEY.withinBudget,
			max_output_bytes: input.maxOutputBytes,
			raw_output_requested: input.rawRequested,
			raw_output_included: input.rawOutputIncluded ?? false,
		},
		summary: input.summary ?? emptySummary(),
		repair_hints: input.repairHints ?? [],
	};
}

function emptySummary(): FallowRunnerSummary {
	return {
		total_findings: 0,
		auto_fixable: 0,
		needs_trace: 0,
		needs_human: 0,
	};
}

function isEvidenceCommand(
	command: FallowRunnerCommand,
): command is Extract<
	FallowRunnerCommand,
	"audit" | "dead-code" | "dupes" | "health"
> {
	return (
		command === "audit" ||
		command === "dead-code" ||
		command === "dupes" ||
		command === "health"
	);
}

function isWriteCommand(
	command: FallowRunnerCommand,
): command is Extract<FallowRunnerCommand, "fix-preview" | "fix-apply"> {
	return command === "fix-preview" || command === "fix-apply";
}

function fallowInvocationFor(
	parsed: ParsedCommand,
	readiness: ReadinessSummary,
): { command: string; args: string[] } {
	return {
		command: readiness.fallow_binary.path ?? "fallow",
		args: fallowArgsFor(parsed),
	};
}

function parseJsonOutput(
	stdout: string,
): { ok: true; value: unknown } | { ok: false } {
	try {
		return { ok: true, value: JSON.parse(stdout) as unknown };
	} catch {
		return { ok: false };
	}
}

function summarizeFallowEvidence(
	mode: Extract<FallowRunnerCommand, "audit" | "dead-code" | "dupes" | "health">,
	output: unknown,
): {
	status: FallowStatus;
	summary: FallowRunnerSummary;
	issueReferences: FallowIssueReference[];
} {
	const issueItems = collectIssueItems(output);
	const issueReferences = issueItems
		.map(issueReferenceFrom)
		.filter(isIssueReference)
		.map((reference) =>
			mode === "audit" ? withResolverActions(reference) : reference,
		);
	const totalFindings = totalFindingsFor(mode, output, issueItems);
	const summary: FallowRunnerSummary = {
		total_findings: totalFindings,
		auto_fixable: issueItems.filter(isAutoFixable).length,
		needs_trace: issueItems.filter(hasTraceNeed).length,
		needs_human: issueItems.filter(hasHumanNeed).length,
	};
	const modeEvidence = modeEvidenceFor(mode, output);
	if (Object.keys(modeEvidence).length > 0) {
		summary.mode_evidence = modeEvidence;
	}

	return {
		status: hasAnalyzerIssues(output, totalFindings) ? "issues" : "ok",
		summary,
		issueReferences,
	};
}

function hasRecognizableAnalyzerEvidence(
	mode: Extract<FallowRunnerCommand, "audit" | "dead-code" | "dupes" | "health">,
	output: unknown,
): boolean {
	const issueItems = collectIssueItems(output);
	return (
		directFindingsCount(output) !== null ||
		totalFindingsFor(mode, output, issueItems) !== null ||
		Object.keys(modeEvidenceFor(mode, output)).length > 0
	);
}

function summarizeFallowWrite(
	mode: Extract<FallowRunnerCommand, "fix-preview" | "fix-apply">,
	output: unknown,
	readiness: ReadinessSummary,
): {
	status: FallowStatus;
	summary: FallowRunnerSummary;
	issueReferences: FallowIssueReference[];
} {
	const issueItems = collectIssueItems(output);
	const issueReferences = issueItems
		.map(issueReferenceFrom)
		.filter(isIssueReference);
	const totalFindings =
		directFindingsCount(output) ?? (issueItems.length > 0 ? issueItems.length : 0);
	const summary = writeSummaryWithReadiness(mode, output, readiness);

	return {
		status: totalFindings > 0 ? "issues" : "ok",
		summary,
		issueReferences,
	};
}

function writeSummaryWithReadiness(
	mode: Extract<FallowRunnerCommand, "fix-preview" | "fix-apply">,
	output: unknown,
	readiness: ReadinessSummary,
): FallowRunnerSummary {
	const issueItems = collectIssueItems(output);
	const totalFindings =
		output === null
			? 0
			: directFindingsCount(output) ??
				(issueItems.length > 0 ? issueItems.length : 0);
	const summary: FallowRunnerSummary = {
		total_findings: totalFindings,
		auto_fixable: issueItems.filter(isAutoFixable).length,
		needs_trace: issueItems.filter(hasTraceNeed).length,
		needs_human: issueItems.filter(hasHumanNeed).length,
	};
	const modeEvidence = compactRecord({
		write_operation: mode === "fix-preview" ? "preview" : "apply",
		config_scope:
			mode === "fix-apply"
				? {
						present: readiness.config.present,
						paths: readiness.config.paths,
					}
				: undefined,
	});
	if (Object.keys(modeEvidence).length > 0) {
		summary.mode_evidence = modeEvidence;
	}
	return summary;
}

function configSafetyHintsFor(
	command: Extract<FallowRunnerCommand, "fix-preview" | "fix-apply">,
	readiness: ReadinessSummary,
): RepairHint[] {
	if (command !== "fix-apply" || !readiness.config.present) return [];
	return [repairHintFor("config-before-apply")];
}

function runtimeFailureHintKind(
	command: FallowRunnerCommand,
	stderr: string,
): RepairHintKind {
	if (isEvidenceCommand(command) && isTransientRuntimeFailure(stderr)) {
		return "transient-retry";
	}
	return "runtime-failure";
}

function isTransientRuntimeFailure(stderr: string): boolean {
	return /\b(timeout|timed out|temporar(y|ily)|econnreset|again|busy)\b/i.test(
		stderr,
	);
}

function repairHintFor(
	kind: RepairHintKind,
	messageOverride?: string,
): RepairHint {
	if (kind === "invalid-root") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.fixInput,
			messageOverride ?? "Choose an existing target repository root.",
		);
	}
	if (kind === "invalid-usage") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.fixInput,
			messageOverride ?? "Correct runner arguments before retrying.",
		);
	}
	if (kind === "unsupported-root") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.fixInput,
			"Choose a JavaScript or TypeScript repository root.",
		);
	}
	if (kind === "missing-fallow") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.setupFallow,
			"Expose a project-local or PATH Fallow binary.",
		);
	}
	if (kind === "git-readiness") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.fixInput,
			"Repair git readiness before audit.",
		);
	}
	if (kind === "invalid-base-ref") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.fixInput,
			"Choose a valid audit base ref.",
		);
	}
	if (kind === "trace-symbol") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.fixInput,
			messageOverride ??
				"Confirm the file and export coordinates name a real export.",
		);
	}
	if (kind === "trace-transport") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.setupFallow,
			messageOverride ??
				"Expose the Fallow trace transport (fallow-mcp and mcporter) before retrying.",
		);
	}
	if (kind === "runtime-failure") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.runDoctor,
			"Run diagnostics before retrying Fallow.",
		);
	}
	if (kind === "parse-output") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.runDoctor,
			"Confirm Fallow JSON output before retrying.",
		);
	}
	if (kind === "reduce-output") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.reduceOutput,
			"Increase output budget or omit raw output before retrying.",
		);
	}
	if (kind === "apply-shaped") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.inspectConfig,
			"Use fix-preview first, then explicit fix-apply after current-task authorization.",
		);
	}
	if (kind === "config-before-apply") {
		return repairHint(
			FALLOW_REPAIR_ACTION_BY_KEY.inspectConfig,
			"Inspect Fallow config paths before apply.",
		);
	}
	return repairHint(
		FALLOW_REPAIR_ACTION_BY_KEY.retry,
		"Retry the same input; the failure looks transient.",
		true,
	);
}

function repairHint(
	action: FallowRepairAction,
	message: string,
	retrySafe = false,
): RepairHint {
	return {
		action,
		message,
		retry_safe: retrySafe,
	};
}

function totalFindingsFor(
	mode: Extract<FallowRunnerCommand, "audit" | "dead-code" | "dupes" | "health">,
	output: unknown,
	issueItems: unknown[],
): number | null {
	if (mode === "audit") return auditTotalFindings(output);
	if (mode === "dead-code") return deadCodeTotalFindings(output, issueItems);
	if (mode === "dupes") return duplicationTotalFindings(output, issueItems);
	if (mode === "health") return healthTotalFindings(output, issueItems);
	return directFindingsCount(output) ?? (issueItems.length > 0 ? issueItems.length : null);
}

// Audit's `--gate new-only` attribution is its highest-signal output: it
// separates findings the changeset introduced from inherited base findings.
// Surface the gate, the per-category split, and introduced/inherited totals so
// callers can act on "what did my change add" instead of the raw finding count.
function auditAttribution(output: unknown): Record<string, unknown> | undefined {
	const attribution = objectValue(objectValue(output, "attribution"));
	if (!attribution || Object.keys(attribution).length === 0) return undefined;
	const introduced = sumPresentNumbers(attribution, [
		"dead_code_introduced",
		"complexity_introduced",
		"duplication_introduced",
	]);
	const inherited = sumPresentNumbers(attribution, [
		"dead_code_inherited",
		"complexity_inherited",
		"duplication_inherited",
	]);
	const summary = compactRecord({
		gate: stringField(attribution, ["gate"]),
		introduced: introduced ?? undefined,
		inherited: inherited ?? undefined,
		dead_code_introduced: numberAt(attribution, ["dead_code_introduced"]),
		complexity_introduced: numberAt(attribution, ["complexity_introduced"]),
		duplication_introduced: numberAt(attribution, ["duplication_introduced"]),
	});
	return Object.keys(summary).length > 0 ? summary : undefined;
}

function auditTotalFindings(output: unknown): number | null {
	const summary = objectValue(objectValue(output, "summary"));
	const summaryTotal = sumPresentNumbers(summary, [
		"dead_code_issues",
		"complexity_findings",
		"duplication_clone_groups",
	]);
	if (summaryTotal !== null) return summaryTotal;

	const attribution = objectValue(objectValue(output, "attribution"));
	const introducedTotal = sumPresentNumbers(attribution, [
		"dead_code_introduced",
		"complexity_introduced",
		"duplication_introduced",
	]);
	if (introducedTotal !== null) return introducedTotal;

	return directFindingsCount(output);
}

function deadCodeTotalFindings(
	output: unknown,
	issueItems: unknown[],
): number | null {
	return (
		numberAt(output, ["total_issues"]) ??
		numberAt(output, ["summary", "total_issues"]) ??
		numberAt(output, ["summary", "dead_code_issues"]) ??
		directFindingsCount(output) ??
		(issueItems.length > 0 ? issueItems.length : null)
	);
}

function duplicationTotalFindings(
	output: unknown,
	issueItems: unknown[],
): number | null {
	// issueItems are the fanned-out clone instances (one per duplicated site).
	// Count those so total_findings matches the emitted references, rather than
	// the clone-group count, which undercounts the actual duplicated sites.
	if (issueItems.length > 0) return issueItems.length;
	return (
		arrayAt(output, ["clone_groups"])?.length ??
		numberAt(output, ["summary", "clone_groups"]) ??
		numberAt(output, ["summary", "duplication_clone_groups"]) ??
		directFindingsCount(output)
	);
}

function healthTotalFindings(
	output: unknown,
	issueItems: unknown[],
): number | null {
	const vitalCounts = objectValue(
		objectValue(objectValue(output, "vital_signs")),
		"counts",
	);
	const vitalTotal = sumPresentNumbers(vitalCounts, [
		"dead_files",
		"dead_exports",
		"unused_deps",
		"circular_deps",
	]);
	return (
		directFindingsCount(output) ??
		arrayAt(output, ["targets"])?.length ??
		numberAt(output, ["summary", "functions_above_threshold"]) ??
		vitalTotal ??
		(issueItems.length > 0 ? issueItems.length : null)
	);
}

function directFindingsCount(output: unknown): number | null {
	return (
		arrayAt(output, ["findings"])?.length ??
		arrayAt(output, ["issues"])?.length ??
		null
	);
}

function hasAnalyzerIssues(output: unknown, totalFindings: number | null): boolean {
	if (totalFindings !== null) return totalFindings > 0;
	const verdict = stringField(output, ["verdict", "status"]);
	if (!verdict) return false;
	return ["fail", "failed", "issues", "error"].includes(verdict.toLowerCase());
}

function modeEvidenceFor(
	mode: Extract<FallowRunnerCommand, "audit" | "dead-code" | "dupes" | "health">,
	output: unknown,
): Record<string, unknown> {
	if (mode === "audit") {
		return compactRecord({
			verdict: stringField(output, ["verdict"]),
			base_ref: stringField(output, ["base_ref"]),
			changed_files_count: numberAt(output, ["changed_files_count"]),
			attribution: auditAttribution(output),
		});
	}
	if (mode === "health") {
		return compactRecord({
			files_analyzed: numberAt(output, ["summary", "files_analyzed"]),
			functions_analyzed: numberAt(output, ["summary", "functions_analyzed"]),
			functions_above_threshold: numberAt(output, [
				"summary",
				"functions_above_threshold",
			]),
			maintainability_avg: numberAt(output, [
				"vital_signs",
				"maintainability_avg",
			]),
			unused_dep_count: numberAt(output, ["vital_signs", "unused_dep_count"]),
			circular_dep_count: numberAt(output, ["vital_signs", "circular_dep_count"]),
		});
	}
	if (mode === "dupes") {
		return compactRecord({
			duplication_percentage: numberAt(output, [
				"stats",
				"duplication_percentage",
			]),
		});
	}
	return compactRecord({
		total_issues: numberAt(output, ["total_issues"]),
	});
}

function collectIssueItems(output: unknown): unknown[] {
	const issueKeys = new Set([
		"findings",
		"issues",
		"unused_exports",
		"unused_dependencies",
		"clone_groups",
		"targets",
		"changes",
	]);
	const items: unknown[] = [];
	collectIssueItemsFrom(output, issueKeys, items);
	return items;
}

function collectIssueItemsFrom(
	value: unknown,
	issueKeys: Set<string>,
	items: unknown[],
): void {
	if (Array.isArray(value)) {
		for (const item of value) collectIssueItemsFrom(item, issueKeys, items);
		return;
	}
	if (!isRecord(value)) return;

	for (const [key, child] of Object.entries(value)) {
		if (key === "clone_groups" && Array.isArray(child)) {
			for (const group of child) items.push(...cloneGroupInstances(group));
			continue;
		}
		if (issueKeys.has(key) && Array.isArray(child)) {
			items.push(...child.filter(isRecord));
			continue;
		}
		if (key !== "actions") collectIssueItemsFrom(child, issueKeys, items);
	}
}

// Clone groups nest their locations one level deeper than every other mode: the
// file/line live in `instances[]`, while the action and fingerprint live on the
// group. Fan each instance into its own item so `issueReferenceFrom` finds a
// path and range; carry the group's actions and fingerprint down for an action
// and a stable id that re-groups duplicate sites.
function cloneGroupInstances(group: unknown): Record<string, unknown>[] {
	if (!isRecord(group) || !Array.isArray(group.instances)) return [];
	const shared = compactRecord({
		actions: group.actions,
		fingerprint: group.fingerprint,
	});
	return group.instances
		.filter(isRecord)
		.map((instance) => ({ ...shared, ...instance }));
}

function issueReferenceFrom(value: unknown): FallowIssueReference | undefined {
	if (!isRecord(value)) return undefined;
	const line = numberField(value, ["line", "start_line", "line_number"]);
	const column = numberField(value, ["col", "column", "start_column", "start_col"]);
	const range = rangeFrom(value, line, column);
	const reference = compactRecord({
		id: stringField(value, [
			"id",
			"finding_id",
			"findingId",
			"key",
			"fingerprint",
		]),
		path: stringField(value, ["path", "file", "filename", "filepath"]),
		range,
		rule: stringField(value, ["rule", "rule_id", "ruleId", "code"]),
		category: stringField(value, ["category", "kind"]),
		action: actionFrom(value),
		symbol: stringField(value, ["symbol", "export_name", "name"]),
		introduced: boolField(value, ["introduced"]),
	}) as FallowIssueReference;
	return Object.keys(reference).length > 0 ? reference : undefined;
}

function boolField(
	value: unknown,
	keys: readonly string[],
): boolean | undefined {
	if (!isRecord(value)) return undefined;
	for (const key of keys) {
		const item = value[key];
		if (typeof item === "boolean") return item;
	}
	return undefined;
}

function rangeFrom(
	value: Record<string, unknown>,
	line: number | undefined,
	column: number | undefined,
): FallowIssueReference["range"] | undefined {
	const nested = objectValue(value.range);
	const range = compactRecord({
		start_line:
			numberField(nested, ["start_line", "startLine", "line"]) ?? line,
		start_column:
			numberField(nested, [
				"start_column",
				"startColumn",
				"column",
				"col",
				"start_col",
			]) ?? column,
		// End fields may sit on a nested `range` object or, for clone instances,
		// directly on the item; check both.
		end_line:
			numberField(nested, ["end_line", "endLine"]) ??
			numberField(value, ["end_line", "endLine"]),
		end_column:
			numberField(nested, ["end_column", "endColumn", "end_col"]) ??
			numberField(value, ["end_column", "endColumn", "end_col"]),
	}) as FallowIssueReference["range"];
	return range && Object.keys(range).length > 0 ? range : undefined;
}

function actionFrom(value: Record<string, unknown>): string | undefined {
	const direct = stringField(value, ["action", "suggested_action", "type"]);
	if (direct) return direct;
	const actions = value.actions;
	if (!Array.isArray(actions)) return undefined;
	for (const action of actions) {
		if (!isRecord(action)) continue;
		const actionId = stringField(action, ["id", "kind", "type", "action"]);
		if (actionId) return actionId;
	}
	return undefined;
}

// Attach a Finding resolver action only to introduced traceable findings: an
// introduced `remove-export` finding that carries both coordinates (R1-R3,
// R5). Inherited findings, coordinate-missing findings, and broad needs_trace
// signals get no action (R4, R6). The action points at the discoverable `why`
// target; exact command syntax stays in help and discovery, not this payload.
function withResolverActions(
	reference: FallowIssueReference,
): FallowIssueReference {
	if (reference.introduced !== true) return reference;
	if (reference.action !== "remove-export") return reference;
	const file = reference.path;
	const symbol = reference.symbol;
	if (!file || !symbol) return reference;

	const resolverAction: FallowResolverActionRef = {
		action: FALLOW_RESOLVER_ACTION_BY_KEY.traceExportReachability,
		target: "why",
		coordinates: { file, export: symbol },
		reason:
			"Introduced remove-export finding; gather reachability evidence before removal.",
		// Names the discovery owner so a JSON-only agent resolves `target` into
		// exact flags via runner help/command discovery, without this payload
		// copying the command contract.
		discover: "why --help",
	};
	return { ...reference, resolver_actions: [resolverAction] };
}

function isAutoFixable(value: unknown): boolean {
	return hasTruthyDeep(value, [
		"auto_fixable",
		"autofixable",
		"fixable",
		"can_fix",
		"safe_to_fix",
	]);
}

function hasTraceNeed(value: unknown): boolean {
	return hasTruthyDeep(value, [
		"needs_trace",
		"requires_trace",
		"trace_required",
	]);
}

function hasHumanNeed(value: unknown): boolean {
	return hasTruthyDeep(value, [
		"needs_human",
		"requires_human",
		"manual_review",
	]);
}

function hasTruthyDeep(value: unknown, keys: readonly string[]): boolean {
	if (Array.isArray(value)) return value.some((item) => hasTruthyDeep(item, keys));
	if (!isRecord(value)) return false;
	for (const [key, child] of Object.entries(value)) {
		if (keys.includes(key) && child === true) return true;
		if (hasTruthyDeep(child, keys)) return true;
	}
	return false;
}

function categorizeStderr(stderr: string): FallowStderrCategory {
	const text = stderr.trim();
	if (!text) return FALLOW_STDERR_CATEGORY_BY_KEY.empty;
	if (/\b(error|failed|fatal|exception|panic)\b/i.test(text)) {
		return FALLOW_STDERR_CATEGORY_BY_KEY.error;
	}
	if (/\bwarn(ing)?\b/i.test(text)) return FALLOW_STDERR_CATEGORY_BY_KEY.warning;
	return FALLOW_STDERR_CATEGORY_BY_KEY.progress;
}

function compactRecord(
	input: Record<string, unknown | undefined>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(input).filter(([, value]) => value !== undefined),
	);
}

function numberAt(value: unknown, path: readonly string[]): number | undefined {
	let current = value;
	for (const key of path) {
		current = propertyValue(current, key);
	}
	return typeof current === "number" && Number.isFinite(current)
		? current
		: undefined;
}

function arrayAt(value: unknown, path: readonly string[]): unknown[] | undefined {
	let current = value;
	for (const key of path) {
		current = propertyValue(current, key);
	}
	return Array.isArray(current) ? current : undefined;
}

function sumPresentNumbers(
	value: Record<string, unknown> | undefined,
	keys: readonly string[],
): number | null {
	if (!value) return null;
	let total = 0;
	let found = false;
	for (const key of keys) {
		const item = value[key];
		if (typeof item === "number" && Number.isFinite(item)) {
			total += item;
			found = true;
		}
	}
	return found ? total : null;
}

function stringField(
	value: unknown,
	keys: readonly string[],
): string | undefined {
	if (!isRecord(value)) return undefined;
	for (const key of keys) {
		const item = value[key];
		if (typeof item === "string" && item.length > 0) return item;
	}
	return undefined;
}

function numberField(
	value: unknown,
	keys: readonly string[],
): number | undefined {
	if (!isRecord(value)) return undefined;
	for (const key of keys) {
		const item = value[key];
		if (typeof item === "number" && Number.isFinite(item)) return item;
	}
	return undefined;
}

function objectValue(
	value: unknown,
	key?: string,
): Record<string, unknown> | undefined {
	const item = key === undefined ? value : propertyValue(value, key);
	return isRecord(item) ? item : undefined;
}

function propertyValue(value: unknown, key: string): unknown {
	return isRecord(value) ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIssueReference(
	value: FallowIssueReference | undefined,
): value is FallowIssueReference {
	return value !== undefined;
}

function parseFallowArgv(argv: readonly string[]): ParsedArgv {
	if (argv.includes("-h") || argv.includes("--help")) {
		return { kind: "help", command: findCommand(argv) };
	}
	if (argv.includes("--version")) {
		return { kind: "version" };
	}

	const command = findCommand(argv);
	if (!command) {
		throw usageError(
			`missing command: expected ${FALLOW_RUNNER_COMMANDS.join(", ")}.`,
		);
	}

	const commandIndex = argv.findIndex((arg) => arg === command);
	if (commandIndex > 0) {
		throw usageError("flags must follow the subcommand");
	}
	const rest = [
		...argv.slice(0, commandIndex),
		...argv.slice(commandIndex + 1),
	];
	return parseCommandOptions(command, rest);
}

function parseCommandOptions(
	command: FallowRunnerCommand,
	argv: readonly string[],
): ParsedCommand {
	const parsed: ParsedCommand = {
		kind: "command",
		command,
		includeRawOutput: false,
		maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
		outputMode: "json",
		applyAuthorized: false,
	};
	const allowedFlags = new Set(Object.keys(fallowRunnerContracts[command].flags));

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("-")) {
			throw usageError(`unexpected argument: ${arg}`);
		}

		const { name, inlineValue } = splitFlag(arg);
		if (UNSUPPORTED_PUBLIC_CONTROLS.has(name) || !allowedFlags.has(name)) {
			throw usageError(`unknown option: ${name}`);
		}

		if (name === "--include-raw-output") {
			if (inlineValue !== undefined) {
				throw usageError(`${name} does not accept a value`);
			}
			parsed.includeRawOutput = true;
			continue;
		}
		if (name === "--plain") {
			if (inlineValue !== undefined) {
				throw usageError(`${name} does not accept a value`);
			}
			parsed.outputMode = "plain";
			continue;
		}
		if (name === "--confirm-current-task-apply") {
			if (inlineValue !== undefined) {
				throw usageError(`${name} does not accept a value`);
			}
			parsed.applyAuthorized = true;
			continue;
		}

		const value = inlineValue ?? readRequiredFlagValue(argv, index, name);
		if (inlineValue === undefined) index += 1;
		else if (value.startsWith("-")) {
			throw usageError(`${name} value cannot start with '-'`);
		}

		if (name === "--root") parsed.root = value;
		else if (name === "--base-ref") parsed.baseRef = value;
		else if (name === "--file") parsed.file = value;
		else if (name === "--export") parsed.exportName = value;
		else if (name === "--max-output-bytes") {
			parsed.maxOutputBytes = parseMaxOutputBytes(value);
		}
	}

	if (command === "why") {
		if (!parsed.file) throw usageError("why requires --file <path>");
		if (!parsed.exportName) throw usageError("why requires --export <symbol>");
	}

	return parsed;
}

function findCommand(
	argv: readonly string[],
): FallowRunnerCommand | undefined {
	const candidate = argv.find((arg) => !arg.startsWith("-"));
	if (!candidate) return undefined;
	if ((FALLOW_RUNNER_COMMANDS as readonly string[]).includes(candidate)) {
		return candidate as FallowRunnerCommand;
	}
	throw usageError(`unknown command: ${candidate}`);
}

function splitFlag(arg: string): { name: string; inlineValue?: string } {
	const index = arg.indexOf("=");
	if (index === -1) return { name: arg };
	return { name: arg.slice(0, index), inlineValue: arg.slice(index + 1) };
}

function readRequiredFlagValue(
	argv: readonly string[],
	index: number,
	flag: string,
): string {
	const value = argv[index + 1];
	if (!value || value.startsWith("-")) {
		throw usageError(`${flag} requires a value`);
	}
	return value;
}

function parseMaxOutputBytes(value: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw usageError("--max-output-bytes must be a positive integer");
	}
	return parsed;
}

function commandFor(parsed: ParsedCommand): string[] {
	if (parsed.command === "doctor") return ["fallow-runner", "doctor"];
	if (parsed.command === "why") return ["fallow-runner", "why"];
	return ["fallow", ...fallowArgsFor(parsed)];
}

function fallowArgsFor(parsed: ParsedCommand): string[] {
	if (parsed.command === "fix-preview") {
		return ["fix", "--dry-run", "--format", "json", "--quiet"];
	}
	if (parsed.command === "fix-apply") {
		return ["fix", "--yes", "--format", "json", "--quiet"];
	}

	const args = [parsed.command] as string[];
	if (parsed.command === "audit" && parsed.baseRef) {
		args.push("--base", parsed.baseRef);
	}
	args.push("--format", "json", "--quiet");
	return args;
}

function renderHelp(command?: FallowRunnerCommand): string {
	if (command) return renderCommandUsage(fallowRunnerContracts[command]);
	const commandLines = Object.entries(fallowRunnerContracts).map(
		([name, contract]) => `  ${name.padEnd(12)} ${contract.summary}`,
	);
	return [
		"Usage: fallow-runner <command> [flags]",
		"",
		"Commands:",
		...commandLines,
		"",
		"Other:",
		"  -h, --help     Show help.",
		"  --version      Print version.",
		"",
	].join("\n");
}

function makeRunId(runtime: FallowRunnerRuntime): string {
	return `fallow:${new Date(runtime.now()).toISOString()}:${runtime.randomId()}`;
}

function writeEnvelope(
	stdout: CliWriter,
	envelope: FallowRunnerEnvelope,
	outputMode: OutputMode = "json",
): void {
	if (outputMode === "plain") {
		stdout.write(renderPlainEnvelope(envelope));
		return;
	}
	stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

function renderPlainEnvelope(envelope: FallowRunnerEnvelope): string {
	const summary = envelope.summary;
	const lines = [
		[
			"fallow",
			`mode=${envelope.mode}`,
			`status=${envelope.status}`,
			`exit_code=${envelope.exit_code}`,
			`failure=${envelope.failure_category}`,
			`write=${envelope.write_effect}`,
			`findings=${countLabel(summary.total_findings)}`,
			`auto_fixable=${summary.auto_fixable}`,
			`needs_trace=${summary.needs_trace}`,
			`needs_human=${summary.needs_human}`,
			`references=${envelope.issue_references.length}`,
			`budget=${envelope.output_budget.status}`,
			`raw_included=${envelope.output_budget.raw_output_included}`,
			`run_id=${envelope.run_id}`,
		].join(" "),
	];

	if (summary.readiness) {
		lines.push(renderReadinessLine(summary.readiness));
	}

	const attributionLine = renderAttributionLine(summary);
	if (attributionLine) lines.push(attributionLine);

	const resolverLine = renderResolverLine(summary);
	if (resolverLine) lines.push(resolverLine);

	const nextAction = nextPlainAction(envelope);
	if (nextAction) lines.push(nextAction);

	return `${lines.join("\n")}\n`;
}

// Resolver output names the evidence grade first, then the derived verdict and
// next action. Raw trace references are summarized as a count, never dumped.
function renderResolverLine(
	summary: FallowRunnerSummary,
): string | undefined {
	const resolver = objectValue(objectValue(summary.mode_evidence), "resolver");
	if (!resolver) return undefined;
	const grade = stringField(resolver, ["grade"]);
	if (!grade) return undefined;
	const verdict = stringField(resolver, ["verdict"]);
	const nextAction = stringField(resolver, ["next_action"]);
	const references = numberAt(resolver, ["references"]);
	return [
		"resolver",
		`grade=${grade}`,
		verdict ? `verdict=${verdict}` : undefined,
		nextAction ? `next_action=${nextAction}` : undefined,
		references !== undefined ? `references=${references}` : undefined,
	]
		.filter((token): token is string => token !== undefined)
		.join(" ");
}

// Audit attribution is the signal worth reading first: surface introduced vs
// inherited in the plain summary so callers do not need JSON to see whether the
// changeset added anything.
function renderAttributionLine(
	summary: FallowRunnerSummary,
): string | undefined {
	const attribution = objectValue(
		objectValue(summary.mode_evidence),
		"attribution",
	);
	if (!attribution) return undefined;
	const introduced = numberAt(attribution, ["introduced"]);
	const inherited = numberAt(attribution, ["inherited"]);
	const gate = stringField(attribution, ["gate"]);
	if (introduced === undefined && inherited === undefined) return undefined;
	return [
		"attribution",
		gate ? `gate=${gate}` : undefined,
		introduced !== undefined ? `introduced=${introduced}` : undefined,
		inherited !== undefined ? `inherited=${inherited}` : undefined,
	]
		.filter((token): token is string => token !== undefined)
		.join(" ");
}

function renderReadinessLine(readiness: ReadinessSummary): string {
	const targetFit =
		readiness.repo_shape.status === "ok" ? "plausible-js-ts" : "unsupported";
	return [
		"readiness",
		`root=${readiness.root.status}`,
		`repo_shape=${readiness.repo_shape.status}`,
		`target_fit=${targetFit}`,
		`fallow_binary=${readiness.fallow_binary.status}`,
		`git=${readiness.git.status}`,
		`config=${readiness.config.present}`,
	].join(" ");
}

function nextPlainAction(envelope: FallowRunnerEnvelope): string | undefined {
	const hint = envelope.repair_hints[0];
	if (hint) {
		return `next_action=${hint.action} retry_safe=${hint.retry_safe}`;
	}
	// The resolver line already carries the derived next action; do not append a
	// generic continue/inspect-json signal that would compete with it.
	const resolver = objectValue(
		objectValue(envelope.summary.mode_evidence),
		"resolver",
	);
	if (resolver) return undefined;
	if (envelope.status === "issues") {
		// Audit with zero introduced findings means the changeset added nothing;
		// inherited findings are not this run's concern.
		const attribution = objectValue(
			objectValue(envelope.summary.mode_evidence),
			"attribution",
		);
		if (attribution && numberAt(attribution, ["introduced"]) === 0) {
			return "next_action=continue introduced=0";
		}
		return "next_action=inspect-json";
	}
	if (envelope.status === "ok") return "next_action=continue";
	return undefined;
}

function countLabel(value: number | null): string {
	return value === null ? "unknown" : String(value);
}

function isRepairHint(value: RepairHint | undefined): value is RepairHint {
	return value !== undefined;
}

async function lookupExecutable(
	name: string,
	env: Record<string, string | undefined>,
): Promise<string | undefined> {
	for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
		const path = join(directory, name);
		try {
			await access(path, constants.X_OK);
			return path;
		} catch {
			// Continue searching PATH.
		}
	}
	return undefined;
}

async function runCommand(
	command: string,
	args: readonly string[],
	options: { cwd: string },
): Promise<CommandResult> {
	try {
		const result = await execFileAsync(command, [...args], {
			cwd: options.cwd,
			encoding: "utf-8",
			maxBuffer: FALLOW_PROCESS_MAX_BUFFER_BYTES,
		});
		return {
			exitCode: 0,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	} catch (error) {
		if (isExecError(error)) {
			return {
				exitCode:
					typeof error.code === "number" ? error.code : 1,
				stdout: typeof error.stdout === "string" ? error.stdout : "",
				stderr: typeof error.stderr === "string" ? error.stderr : "",
			};
		}
		return { exitCode: 1, stdout: "", stderr: String(error) };
	}
}

function isExecError(
	error: unknown,
): error is { code?: unknown; stdout?: unknown; stderr?: unknown } {
	return typeof error === "object" && error !== null;
}

class BufferWriter implements CliWriter {
	private content = "";

	write(value: string): boolean {
		this.content += value;
		return true;
	}

	toString(): string {
		return this.content;
	}
}

export async function runForTest(
	argv: readonly string[],
	runtime: FallowRunnerRuntime = createDefaultFallowRuntime(),
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runFallowRunnerCli(argv, { runtime, stdout, stderr });
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

function emitUsageError(
	argv: readonly string[],
	runtime: FallowRunnerRuntime,
	stdout: CliWriter,
	error: CliUsageError,
): number {
	const command = safeFindCommand(argv);
	const safetyBlock = isApplyShapedOutsideApply(argv, command);
	const exitCode = safetyBlock ? 1 : error.options.exitCode ?? 2;
	const placeholderCommand: ParsedCommand | undefined = command
		? {
				kind: "command",
				command,
				includeRawOutput: false,
				maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
				outputMode: "json",
				applyAuthorized: false,
			}
		: undefined;
	writeEnvelope(
		stdout,
		makeEnvelope({
			status: "blocked",
			mode: command ?? "doctor",
			runId: makeRunId(runtime),
			command: placeholderCommand ? commandFor(placeholderCommand) : ["fallow-runner"],
			cwd: runtime.cwd,
			exitCode,
			failureCategory: safetyBlock ? "safety" : "input",
			writeEffect: "none",
			maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
			rawRequested: false,
			repairHints: safetyBlock
				? [repairHintFor("apply-shaped")]
				: [repairHintFor("invalid-usage", error.message)],
		}),
		usageOutputMode(argv, command),
	);
	return exitCode;
}

function usageOutputMode(
	argv: readonly string[],
	command: FallowRunnerCommand | undefined,
): OutputMode {
	if (!command) return "json";
	const commandIndex = argv.findIndex((arg) => arg === command);
	if (commandIndex === -1) return "json";
	return argv.slice(commandIndex + 1).some((arg) => splitFlag(arg).name === "--plain")
		? "plain"
		: "json";
}

function isApplyShapedOutsideApply(
	argv: readonly string[],
	command: FallowRunnerCommand | undefined,
): boolean {
	return (
		command !== "fix-apply" &&
		argv.some((arg) => APPLY_SHAPED_CONTROLS.has(splitFlag(arg).name))
	);
}

function safeFindCommand(argv: readonly string[]): FallowRunnerCommand | undefined {
	const candidate = argv.find((arg) => !arg.startsWith("-"));
	if (
		candidate &&
		(FALLOW_RUNNER_COMMANDS as readonly string[]).includes(candidate)
	) {
		return candidate as FallowRunnerCommand;
	}
	return undefined;
}

if (import.meta.main) {
	let exitCode = 0;
	try {
		exitCode = await runFallowRunnerCli(Bun.argv.slice(2));
	} catch (error) {
		if (error instanceof CliUsageError) {
			process.stderr.write(`${error.message}\n`);
			exitCode = error.options.exitCode ?? 2;
		} else {
			throw error;
		}
	}
	process.exit(exitCode);
}
