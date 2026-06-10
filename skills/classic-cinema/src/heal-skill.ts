#!/usr/bin/env bun
// heal-skill — diagnose the classic-cinema skill's health and apply safe repairs.
//
// Facade-backed CLI. The command surface (commands, flags, exit codes, action
// affordances) is declared in command-contract.ts; this runner parses argv
// against that contract and renders runtime envelopes. Diagnosis logic lives in
// heal-engine.ts so the runner stays a thin transport.
//
// Commands:
//   check    [--only <check-id>] [--json]              read-only diagnosis (default)
//   repair   [--only <check-id>] [--execute] [--no-input] [--json]
//                                                       preview (default) or apply safe repairs
//   explain  <check-id> [--json]                        what a finding means + safe fix
//
// Exit codes (per contract):
//   0 healthy / repair fully succeeded
//   1 findings exist, none repaired
//   2 usage error
// Repair handoff (findings that need a human) also exits 1 with handoffNeeded set.

import {
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	usageError,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	HEAL_SKILL_CHECK_IDS,
	HEAL_SKILL_SCHEMA_VERSION,
	type HealSkillCommand,
	healSkillContracts,
} from "./command-contract.ts";
import {
	CHECK_EXPLAIN,
	type Finding,
	knownCheckIds,
	type RepairResult,
	repairBookingLog,
	runChecks,
} from "./heal-engine.ts";

const VERSION = "0.1.0";

// --- parsed command shapes ---

type ParsedHealCommand =
	| { kind: "help"; command: HealSkillCommand | null }
	| { kind: "version" }
	| { kind: "check"; outputMode: OutputMode; only: string | null }
	| {
			kind: "repair";
			outputMode: OutputMode;
			only: string | null;
			execute: boolean;
			noInput: boolean;
	  }
	| { kind: "explain"; outputMode: OutputMode; checkId: string };

type OutputMode = "plain" | "json";

function isCommand(value: string | undefined): value is HealSkillCommand {
	return value === "check" || value === "repair" || value === "explain";
}

function findCommand(argv: readonly string[]): HealSkillCommand | null {
	for (const arg of argv) {
		if (isCommand(arg)) return arg;
	}
	return null;
}

function requireNext(args: readonly string[], index: number, flag: string): string {
	const value = args[index + 1];
	if (value === undefined || value.startsWith("-")) {
		throw usageError(`${flag} requires a value.`);
	}
	return value;
}

function requireInlineValue(arg: string, flag: string): string {
	const value = arg.slice(`${flag}=`.length);
	if (value === "") throw usageError(`${flag} requires a value.`);
	return value;
}

function parseCheckId(flag: string, value: string): string {
	if (!(HEAL_SKILL_CHECK_IDS as readonly string[]).includes(value)) {
		throw usageError(
			`${flag} must be one of: ${HEAL_SKILL_CHECK_IDS.join(", ")}`,
		);
	}
	return value;
}

// --- argv parsing (validated against the contract's per-command flags) ---

function parseHealSkillArgv(argv: readonly string[]): ParsedHealCommand {
	if (argv.includes("--version")) return { kind: "version" };
	if (argv.includes("--help") || argv.includes("-h")) {
		return { kind: "help", command: findCommand(argv) };
	}

	const args = [...argv];
	let command: HealSkillCommand = "check";
	if (args[0] && !args[0].startsWith("-")) {
		const candidate = args.shift();
		if (candidate === "help") {
			return { kind: "help", command: findCommand(args) };
		}
		if (!isCommand(candidate)) throw usageError(`unknown command: ${candidate}`);
		command = candidate;
	}

	let outputMode: OutputMode = "plain";
	let only: string | null = null;
	let execute = false;
	let noInput = false;
	let explainId: string | null = null;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--json":
				outputMode = "json";
				break;
			case "--only":
				only = parseCheckId("--only", requireNext(args, index, "--only"));
				index += 1;
				break;
			case "--execute":
				execute = true;
				break;
			case "--no-input":
				noInput = true;
				break;
			default:
				if (arg.startsWith("--only=")) {
					only = parseCheckId("--only", requireInlineValue(arg, "--only"));
				} else if (command === "explain" && !arg.startsWith("-") && explainId === null) {
					explainId = arg;
				} else if (arg.startsWith("-")) {
					throw usageError(`unknown option: ${arg}`);
				} else {
					throw usageError(`unexpected argument: ${arg}`);
				}
		}
	}

	if (command === "check") {
		if (execute) throw usageError("check does not accept --execute.");
		if (noInput) throw usageError("check does not accept --no-input.");
		return { kind: "check", outputMode, only };
	}

	if (command === "repair") {
		return { kind: "repair", outputMode, only, execute, noInput };
	}

	// explain
	if (only) throw usageError("explain does not accept --only.");
	if (execute) throw usageError("explain does not accept --execute.");
	if (noInput) throw usageError("explain does not accept --no-input.");
	if (!explainId) {
		throw usageError(
			`explain requires a check id: ${knownCheckIds().join(", ")}`,
		);
	}
	return { kind: "explain", outputMode, checkId: explainId };
}

// --- runtime (injectable for tests; the engine reads the real filesystem) ---

export type HealSkillRuntime = {
	now: () => number;
	runChecks: (only: string | null) => Promise<Finding[]>;
	repairBookingLog: (execute: boolean) => Promise<RepairResult>;
};

export function createDefaultHealSkillRuntime(
	overrides: Partial<HealSkillRuntime> = {},
): HealSkillRuntime {
	return {
		now: () => Date.now(),
		runChecks,
		repairBookingLog,
		...overrides,
	};
}

// --- command results ---

interface HealResult {
	run_id: string;
	duration_ms: number;
	exit_code: number;
	action: string;
	findings?: Finding[];
	repairs?: RepairResult[];
	mode?: "preview" | "execute";
	handoff_needed?: boolean;
	explanation?: { checkId: string; explanation: string };
}

async function runCheck(input: {
	parsed: Extract<ParsedHealCommand, { kind: "check" }>;
	runtime: HealSkillRuntime;
	runId: string;
	startedAt: number;
}): Promise<HealResult> {
	const findings = await input.runtime.runChecks(input.parsed.only);
	const hasFinding = findings.some((f) => f.status !== "ok");
	return {
		run_id: input.runId,
		duration_ms: input.runtime.now() - input.startedAt,
		exit_code: hasFinding ? 1 : 0,
		action: hasFinding ? "findings_present" : "skill_healthy",
		findings,
	};
}

async function runRepair(input: {
	parsed: Extract<ParsedHealCommand, { kind: "repair" }>;
	runtime: HealSkillRuntime;
	runId: string;
	startedAt: number;
}): Promise<HealResult> {
	// Run the targeted (or full) checks first so we only repair what's broken.
	const findings = await input.runtime.runChecks(input.parsed.only);
	const repairs: RepairResult[] = [];
	let handoffNeeded = false;
	for (const f of findings) {
		if (f.status === "ok") continue;
		if (f.checkId === "booking-log-valid" && f.autoRepairable) {
			repairs.push(await input.runtime.repairBookingLog(input.parsed.execute));
		} else if (f.status === "handoff" || !f.autoRepairable) {
			handoffNeeded = true;
		}
	}
	const applied = repairs.some((r) => r.applied);
	// 0 if repaired and no handoff; 1 if handoff still needed or findings remain
	// with nothing applied; 0 if nothing was broken.
	const exitCode = handoffNeeded
		? 1
		: applied
			? 0
			: findings.some((f) => f.status !== "ok")
				? 1
				: 0;
	return {
		run_id: input.runId,
		duration_ms: input.runtime.now() - input.startedAt,
		exit_code: exitCode,
		action: applied ? "repaired" : handoffNeeded ? "handoff_needed" : "no_repair_needed",
		mode: input.parsed.execute ? "execute" : "preview",
		findings,
		repairs,
		handoff_needed: handoffNeeded,
	};
}

function runExplain(input: {
	parsed: Extract<ParsedHealCommand, { kind: "explain" }>;
	runtime: HealSkillRuntime;
	runId: string;
	startedAt: number;
}): HealResult {
	const id = input.parsed.checkId;
	const explanation = CHECK_EXPLAIN[id];
	if (!explanation) {
		throw usageError(`explain needs a known check id: ${knownCheckIds().join(", ")}`);
	}
	return {
		run_id: input.runId,
		duration_ms: input.runtime.now() - input.startedAt,
		exit_code: 0,
		action: "explained",
		explanation: { checkId: id, explanation },
	};
}

// --- output ---

function statusEmoji(s: Finding["status"]): string {
	return { ok: "✅", finding: "⚠️", repaired: "🔧", handoff: "🚑" }[s];
}

function renderPlain(result: HealResult): string {
	const lines: string[] = [];
	if (result.explanation) {
		lines.push(`${result.explanation.checkId}\n\n${result.explanation.explanation}`);
		return `${lines.join("\n")}\n`;
	}
	const findings = result.findings ?? [];
	const findingsOnly = findings.filter((f) => f.status !== "ok");
	if (findingsOnly.length === 0 && (result.repairs ?? []).length === 0) {
		return "✅ classic-cinema healthy — all checks pass\n";
	}
	for (const f of findings) {
		if (f.status === "ok") continue;
		lines.push(`${statusEmoji(f.status)} ${f.checkId}: ${f.summary}`);
		if (f.detail) lines.push(`   ${f.detail}`);
		lines.push(`   → ${f.nextAction}`);
	}
	for (const r of result.repairs ?? []) {
		lines.push(`${r.applied ? "🔧" : "👁"} ${r.checkId}: ${r.summary}`);
		if (r.backupPath) lines.push(`   backup: ${r.backupPath}`);
		for (const p of r.previewLines ?? []) lines.push(`   ${p}`);
	}
	if (result.mode === "preview" && (result.repairs ?? []).length > 0) {
		lines.push("\nPreview only. Re-run with --execute to apply.");
	}
	return `${lines.join("\n")}\n`;
}

function writeResult(
	stdout: CliWriter,
	result: HealResult,
	outputMode: OutputMode,
): void {
	if (outputMode === "json") {
		if (result.exit_code === 0) {
			writeJsonEnvelope(
				stdout,
				createCliRuntimeSuccessEnvelope({
					run_id: result.run_id,
					data: result,
				}),
				{ runId: result.run_id, durationMs: result.duration_ms },
			);
			return;
		}
		writeJsonEnvelope(
			stdout,
			createCliRuntimeErrorEnvelope({
				run_id: result.run_id,
				process_exit_code: result.exit_code,
				error: {
					run_id: result.run_id,
					code: result.handoff_needed ? "repair_incomplete" : "findings_present",
					message:
						result.action === "handoff_needed"
							? "Findings need a human handoff; see findings[].nextAction."
							: "Findings present; see findings[].nextAction.",
					exit_code: result.exit_code,
					severity: "warning",
					recoverability: "repair_state",
					retryable: false,
				},
				data: result,
			}),
			{ runId: result.run_id, durationMs: result.duration_ms },
		);
		return;
	}
	stdout.write(renderPlain(result));
}

function inferOutputMode(argv: readonly string[]): OutputMode {
	return argv.includes("--json") ? "json" : "plain";
}

function emitUsageError(input: {
	error: unknown;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const message = input.error instanceof Error ? input.error.message : String(input.error);
	if (input.outputMode === "json") {
		writeJsonEnvelope(
			input.stdout,
			createCliRuntimeErrorEnvelope({
				run_id: input.runId,
				process_exit_code: 2,
				error: {
					run_id: input.runId,
					code: "usage_error",
					message,
					exit_code: 2,
					severity: "error",
					recoverability: "change_input",
					retryable: false,
				},
			}),
			{ runId: input.runId, durationMs: input.durationMs },
		);
	} else {
		input.stderr.write(`${message}\n`);
	}
	return 2;
}

// --- entry / dispatch ---

export async function runHealSkillCli(
	argv: readonly string[],
	options: {
		runtime?: HealSkillRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultHealSkillRuntime();
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;

	let parsedDiagnostics: ParsedCliDiagnosticArgv;
	try {
		parsedDiagnostics = parseCliDiagnosticArgv(argv);
	} catch (error) {
		parsedDiagnostics = parseCliDiagnosticFallbackArgv(argv);
		return emitUsageError({
			error,
			outputMode: inferOutputMode(argv),
			stdout,
			stderr,
			runId: parsedDiagnostics.options.runId,
			durationMs: runtime.now() - parsedDiagnostics.options.startedAtMs,
		});
	}

	const runId = parsedDiagnostics.options.runId;
	const startedAt = parsedDiagnostics.options.startedAtMs;

	let parsed: ParsedHealCommand;
	try {
		parsed = parseHealSkillArgv(parsedDiagnostics.argv);
	} catch (error) {
		return emitUsageError({
			error,
			outputMode: inferOutputMode(parsedDiagnostics.argv),
			stdout,
			stderr,
			runId,
			durationMs: runtime.now() - startedAt,
		});
	}

	if (parsed.kind === "version") {
		stdout.write(`heal-skill ${VERSION}\n`);
		return 0;
	}
	if (parsed.kind === "help") {
		const command = parsed.command ?? "check";
		stdout.write(renderCommandUsage(healSkillContracts[command]));
		return 0;
	}

	let result: HealResult;
	try {
		result =
			parsed.kind === "check"
				? await runCheck({ parsed, runtime, runId, startedAt })
				: parsed.kind === "repair"
					? await runRepair({ parsed, runtime, runId, startedAt })
					: runExplain({ parsed, runtime, runId, startedAt });
	} catch (error) {
		return emitUsageError({
			error,
			outputMode: parsed.outputMode,
			stdout,
			stderr,
			runId,
			durationMs: runtime.now() - startedAt,
		});
	}

	writeResult(stdout, result, parsed.outputMode);
	return result.exit_code;
}

// --- test harness ---

class BufferWriter implements CliWriter {
	private chunks: string[] = [];

	write(chunk: string): true {
		this.chunks.push(chunk);
		return true;
	}

	toString(): string {
		return this.chunks.join("");
	}
}

export async function runForTest(
	argv: readonly string[],
	runtime: HealSkillRuntime = createDefaultHealSkillRuntime(),
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runHealSkillCli(argv, { runtime, stdout, stderr });
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

export { HEAL_SKILL_SCHEMA_VERSION };

if (import.meta.main) {
	const exitCode = await runHealSkillCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
