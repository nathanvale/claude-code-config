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
//   station-map <target> [--ledger <path>] [--json]
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
import { resolve } from "node:path";
import { runFullAudit } from "./audit-engine.ts";
import { AUDIT_CLAUSE_IDS, getClause } from "./clause-catalog.ts";
import { auditorContracts } from "./command-contract.ts";
import { readLedgerFile, upsertFinding, writeLedgerFile } from "./ledger/index.ts";
import {
	runStationMapAudit,
	type StationFinding,
	type StationMapOutcome,
} from "./station-map.ts";

const VERSION = "0.2.0";

// --- parsed command shape ---

type OutputMode = "plain" | "json";

type ParsedAuditorCommand =
	| { kind: "help" }
	| { kind: "version" }
	| {
			kind: "audit";
			outputMode: OutputMode;
			target: string;
			only: string | null;
			ledger: string | null;
	  }
	| {
			kind: "station-map";
			outputMode: OutputMode;
			target: string;
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

function parseAuditorArgv(argv: readonly string[]): ParsedAuditorCommand {
	if (argv.includes("--version")) return { kind: "version" };
	if (argv.includes("--help") || argv.includes("-h")) return { kind: "help" };

	const args = [...argv];
	const command = args[0] === "station-map" ? "station-map" : "audit";
	// The first non-flag token is the command; "audit" is also the default, so a
	// bare `auditor <target>` is accepted.
	if (args[0] === "audit" || args[0] === "station-map") args.shift();
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
				if (command === "station-map") throw usageError("unknown option: --only");
				only = parseClauseId("--only", requireNext(args, index, "--only"));
				index += 1;
				break;
			case "--ledger":
				ledger = requireNext(args, index, "--ledger");
				index += 1;
				break;
			default:
				if (arg.startsWith("--only=")) {
					if (command === "station-map") throw usageError("unknown option: --only");
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
		throw usageError(
			command === "audit"
				? "audit requires a target: audit <target> [--only <clause>] [--json]"
				: "station-map requires a target: station-map <target> [--json]",
		);
	}
	if (command === "station-map") {
		return { kind: "station-map", outputMode, target, ledger };
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
	stationMap: (input: { target: string; ledger: string | null }) => Promise<StationMapOutcome>;
};

/** Default ledger path for a target: docs/cli-audits/<cli-name>/audit.md. */
function defaultLedgerPath(targetRoot: string, cliName: string): string {
	return resolve(targetRoot, "docs", "cli-audits", cliName, "audit.md");
}

/**
 * Default runtime: runs the real engine (static + surface), writes the findings
 * to the auditor-local ledger, and returns the outcome with the ledger path.
 * Injectable so tests can stub the engine.
 */
export function createDefaultAuditorRuntime(
	overrides: Partial<AuditorRuntime> = {},
): AuditorRuntime {
	return {
		now: () => Date.now(),
		audit: async ({ target, only, ledger }) => {
			const targetRoot = resolve(target);
			const outcome = await runFullAudit({ targetRoot, only });

			// A non-facade skip or an acquisition failure writes no ledger — there is
			// nothing auditable to record a findings table for.
			if (!outcome.laneDetected) {
				return {
					target: outcome.target,
					laneDetected: false,
					skipReason: outcome.skipReason,
					findings: outcome.findings,
				};
			}

			// Read the existing ledger (if any) so re-runs dedupe by signature and
			// preserve finding history across runs (never-delete, R6) — then upsert
			// this run's findings and persist. Writing fresh would lose prior
			// history and make cross-run dedupe a no-op.
			const ledgerPath = ledger ?? defaultLedgerPath(targetRoot, outcome.target);
			const ledgerState = await readLedgerFile(ledgerPath, outcome.target);
			for (const finding of outcome.findings) {
				upsertFinding(ledgerState, {
					clauseId: finding.clauseId,
					kind: finding.kind,
					summary: finding.summary,
					argv: finding.argv,
				});
			}
			await writeLedgerFile(ledgerPath, ledgerState);

			return {
				target: outcome.target,
				laneDetected: true,
				skipReason: outcome.skipReason,
				findings: outcome.findings,
				ledgerPath,
			};
		},
		stationMap: async ({ target, ledger }) => {
			const targetRoot = resolve(target);
			const outcome = await runStationMapAudit({ targetRoot });
			if (!outcome.catalogDetected) return outcome;

			const ledgerPath = ledger ?? defaultLedgerPath(targetRoot, outcome.target);
			const ledgerState = await readLedgerFile(ledgerPath, outcome.target);
			for (const finding of outcome.findings) {
				upsertFinding(ledgerState, {
					clauseId: "station-map",
					kind: "station",
					summary: finding.summary,
					station: {
						stationId: finding.stationId,
						command: finding.command,
						findingKind: finding.findingKind,
					},
				});
			}
			await writeLedgerFile(ledgerPath, ledgerState);

			return { ...outcome, ledgerPath };
		},
		...overrides,
	};
}

// --- command result ---

interface AuditResult {
	report_kind: "audit";
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

interface StationMapResult {
	report_kind: "station-map";
	run_id: string;
	duration_ms: number;
	exit_code: number;
	action: string;
	target: string;
	lane_detected: boolean;
	catalog_detected: boolean;
	skip_reason?: string;
	catalog_path?: string;
	evidence_path?: string;
	completeness_claim?: string;
	station_map?: StationMapOutcome["stationMap"];
	findings: StationFinding[];
	ledger_path?: string;
}

async function runAudit(input: {
	parsed: Extract<ParsedAuditorCommand, { kind: "audit" }>;
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
		report_kind: "audit",
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

async function runStationMapCommand(input: {
	parsed: Extract<ParsedAuditorCommand, { kind: "station-map" }>;
	runtime: AuditorRuntime;
	runId: string;
	startedAt: number;
}): Promise<StationMapResult> {
	const outcome = await input.runtime.stationMap({
		target: input.parsed.target,
		ledger: input.parsed.ledger,
	});
	const hasFinding = outcome.findings.length > 0;
	return {
		report_kind: "station-map",
		run_id: input.runId,
		duration_ms: input.runtime.now() - input.startedAt,
		exit_code: hasFinding ? 1 : 0,
		action: hasFinding
			? "station_findings_present"
			: outcome.skipReason
				? "station_map_skipped"
				: "declared_branch_coverage_clean",
		target: outcome.target,
		lane_detected: outcome.laneDetected,
		catalog_detected: outcome.catalogDetected,
		skip_reason: outcome.skipReason,
		catalog_path: outcome.catalogPath,
		evidence_path: outcome.evidencePath,
		completeness_claim: outcome.stationMap?.completeness_claim,
		station_map: outcome.stationMap,
		findings: outcome.findings,
		ledger_path: outcome.ledgerPath,
	};
}

// --- output ---

function clauseKindLabel(clauseId: string): string {
	return getClause(clauseId)?.kind ?? "?";
}

function renderPlainAudit(result: AuditResult): string {
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

function renderPlainStationMap(result: StationMapResult): string {
	if (result.skip_reason && result.findings.length === 0) {
		return `• ${result.target}: ${result.skip_reason}\n`;
	}
	if (result.findings.length === 0) {
		return `${result.target}: Station Map clean (${result.completeness_claim ?? "no catalog"})\n`;
	}
	const lines: string[] = [`${result.target}: ${result.findings.length} station finding(s)`];
	for (const finding of result.findings) {
		lines.push(`  [${finding.findingKind}] ${finding.stationId}: ${finding.summary}`);
	}
	if (result.ledger_path) lines.push(`  ledger: ${result.ledger_path}`);
	return `${lines.join("\n")}\n`;
}

type AuditorCommandResult = AuditResult | StationMapResult;

function renderPlain(result: AuditorCommandResult): string {
	return result.report_kind === "audit"
		? renderPlainAudit(result)
		: renderPlainStationMap(result);
}

function writeResult(
	stdout: CliWriter,
	result: AuditorCommandResult,
	outputMode: OutputMode,
): void {
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
					message:
						result.report_kind === "audit"
							? "Lane-contract findings present; see findings[] and the ledger."
							: "Station Map findings present; see findings[] and the ledger.",
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

function renderAuditorHelp(): string {
	return [
		renderCommandUsage(auditorContracts.audit).trimEnd(),
		"",
		renderCommandUsage(auditorContracts["station-map"]).trimEnd(),
		"",
	].join("\n");
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

	let parsed: ParsedAuditorCommand;
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
		stdout.write(renderAuditorHelp());
		return 0;
	}

	let result: AuditorCommandResult;
	try {
		result =
			parsed.kind === "audit"
				? await runAudit({ parsed, runtime, runId, startedAt })
				: await runStationMapCommand({ parsed, runtime, runId, startedAt });
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
