#!/usr/bin/env bun
// auditor — audit a facade-backed CLI's agent-execution experience against the
// per-lane contract.
//
// Facade-backed CLI (KTD5). The command surface (the audit command, flags, exit
// codes, action affordances) is declared in command-contract.ts; this runner
// parses argv against that contract and renders runtime envelopes. Audit logic
// lives in audit-engine.ts so the runner stays a thin transport.
//
// Commands:
//   audit <target> [--only <clause>] [--ledger <path>] [--json]
//
// Exit codes (per contract):
//   0 target clean — all lane clauses pass
//   1 findings exist against the lane contract
//   2 usage error

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
import { AUDIT_CLAUSE_IDS, getClause } from "./clause-catalog.ts";
import { auditorContracts } from "./command-contract.ts";

const VERSION = "0.1.0";

// --- parsed command shape ---

type OutputMode = "plain" | "json";

type ParsedAuditCommand =
	| { kind: "help" }
	| { kind: "version" }
	| {
			kind: "audit";
			outputMode: OutputMode;
			target: string;
			only: string | null;
			ledger: string | null;
	  };

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

function parseClauseId(flag: string, value: string): string {
	if (!AUDIT_CLAUSE_IDS.includes(value)) {
		throw usageError(`${flag} must be one of: ${AUDIT_CLAUSE_IDS.join(", ")}`);
	}
	return value;
}

// --- argv parsing (validated against the contract's flags) ---

function parseAuditorArgv(argv: readonly string[]): ParsedAuditCommand {
	if (argv.includes("--version")) return { kind: "version" };
	if (argv.includes("--help") || argv.includes("-h")) return { kind: "help" };

	const args = [...argv];
	// The first non-flag token is the command; "audit" is the only command and
	// also the default, so a bare `auditor <target>` is accepted.
	if (args[0] === "audit") args.shift();
	if (args[0] === "help") return { kind: "help" };

	let outputMode: OutputMode = "plain";
	let only: string | null = null;
	let ledger: string | null = null;
	let target: string | null = null;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--json":
				outputMode = "json";
				break;
			case "--only":
				only = parseClauseId("--only", requireNext(args, index, "--only"));
				index += 1;
				break;
			case "--ledger":
				ledger = requireNext(args, index, "--ledger");
				index += 1;
				break;
			default:
				if (arg.startsWith("--only=")) {
					only = parseClauseId("--only", requireInlineValue(arg, "--only"));
				} else if (arg.startsWith("--ledger=")) {
					ledger = requireInlineValue(arg, "--ledger");
				} else if (arg.startsWith("-")) {
					throw usageError(`unknown option: ${arg}`);
				} else if (target === null) {
					target = arg;
				} else {
					throw usageError(`unexpected argument: ${arg}`);
				}
		}
	}

	if (target === null) {
		throw usageError("audit requires a target: audit <target> [--only <clause>] [--json]");
	}
	return { kind: "audit", outputMode, target, only, ledger };
}

// --- runtime (injectable for tests; the engine reads the real filesystem) ---

/** A single clause finding the engine surfaces. */
export interface AuditFinding {
	clauseId: string;
	kind: "static" | "surface";
	summary: string;
	/** Invocation that surfaced it; [] for a static clause. */
	argv: readonly string[];
}

/** The engine's result for one target. */
export interface AuditOutcome {
	target: string;
	laneDetected: boolean;
	skipReason?: string;
	findings: AuditFinding[];
	ledgerPath?: string;
}

export type AuditorRuntime = {
	now: () => number;
	audit: (input: { target: string; only: string | null; ledger: string | null }) => Promise<AuditOutcome>;
};

/**
 * U3 stub runtime: no checks yet. U4/U5 replace `audit` with the real engine.
 * Kept injectable so the scaffold's drift tests run without the engine.
 */
export function createDefaultAuditorRuntime(
	overrides: Partial<AuditorRuntime> = {},
): AuditorRuntime {
	return {
		now: () => Date.now(),
		audit: async ({ target }) => ({
			target,
			laneDetected: false,
			skipReason: "no checks yet — engine lands in U4/U5",
			findings: [],
		}),
		...overrides,
	};
}

// --- command result ---

interface AuditResult {
	run_id: string;
	duration_ms: number;
	exit_code: number;
	action: string;
	target: string;
	lane_detected: boolean;
	skip_reason?: string;
	findings: AuditFinding[];
	ledger_path?: string;
}

async function runAudit(input: {
	parsed: Extract<ParsedAuditCommand, { kind: "audit" }>;
	runtime: AuditorRuntime;
	runId: string;
	startedAt: number;
}): Promise<AuditResult> {
	const outcome = await input.runtime.audit({
		target: input.parsed.target,
		only: input.parsed.only,
		ledger: input.parsed.ledger,
	});
	const hasFinding = outcome.findings.length > 0;
	return {
		run_id: input.runId,
		duration_ms: input.runtime.now() - input.startedAt,
		exit_code: hasFinding ? 1 : 0,
		action: hasFinding
			? "findings_present"
			: outcome.skipReason
				? "target_skipped"
				: "target_clean",
		target: outcome.target,
		lane_detected: outcome.laneDetected,
		skip_reason: outcome.skipReason,
		findings: outcome.findings,
		ledger_path: outcome.ledgerPath,
	};
}

// --- output ---

function clauseKindLabel(clauseId: string): string {
	return getClause(clauseId)?.kind ?? "?";
}

function renderPlain(result: AuditResult): string {
	if (result.skip_reason && result.findings.length === 0) {
		return `• ${result.target}: ${result.skip_reason}\n`;
	}
	if (result.findings.length === 0) {
		return `✅ ${result.target}: lane contract clean — all clauses pass\n`;
	}
	const lines: string[] = [`⚠️ ${result.target}: ${result.findings.length} finding(s)`];
	for (const f of result.findings) {
		lines.push(`  [${clauseKindLabel(f.clauseId)}] ${f.clauseId}: ${f.summary}`);
	}
	if (result.ledger_path) lines.push(`  ledger: ${result.ledger_path}`);
	return `${lines.join("\n")}\n`;
}

function writeResult(stdout: CliWriter, result: AuditResult, outputMode: OutputMode): void {
	if (outputMode === "json") {
		if (result.exit_code === 0) {
			writeJsonEnvelope(
				stdout,
				createCliRuntimeSuccessEnvelope({ run_id: result.run_id, data: result }),
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
					code: "findings_present",
					message: "Lane-contract findings present; see findings[] and the ledger.",
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

export async function runAuditorCli(
	argv: readonly string[],
	options: {
		runtime?: AuditorRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultAuditorRuntime();
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

	let parsed: ParsedAuditCommand;
	try {
		parsed = parseAuditorArgv(parsedDiagnostics.argv);
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
		stdout.write(`auditor ${VERSION}\n`);
		return 0;
	}
	if (parsed.kind === "help") {
		stdout.write(renderCommandUsage(auditorContracts.audit));
		return 0;
	}

	let result: AuditResult;
	try {
		result = await runAudit({ parsed, runtime, runId, startedAt });
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
	runtime: AuditorRuntime = createDefaultAuditorRuntime(),
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runAuditorCli(argv, { runtime, stdout, stderr });
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

export { AUDITOR_SCHEMA_VERSION } from "./command-contract.ts";

if (import.meta.main) {
	const exitCode = await runAuditorCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
