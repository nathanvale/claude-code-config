// Fallow-owned trace adapter (plan 2026-06-05-003, U3).
//
// Encapsulates mcporter-backed `trace_export` execution behind a typed,
// testable boundary. Lifted from the throwaway prototype-why-symbol spike: the
// mcporter call shape (transport keeper) and the reachability evidence shape
// (verdict keeper). No MCP protocol plumbing leaks past this module — mcporter
// owns the handshake and unwraps the two-layer content JSON for us.
//
// Failure layers stay separate (confirmed live in the spike):
//   - tool-level symbol-not-found ({ error: true, message }) -> input class
//   - transport-level offline/missing/timeout/spawn -> setup class
//   - malformed/incomplete payload -> fail closed, never a deletion candidate
//
// The mcporter command vector follows the house override contract conceptually
// (browser-use/scripts/mcporter-transport.ts) without importing it: a single
// JSON-array env override, default `mcporter`, no shell eval, no auto package
// runner. A shared utility is deferred until a third consumer exists (KTD5).

import {
	FALLOW_EVIDENCE_GRADE_BY_KEY,
	type FallowEvidenceGrade,
} from "./command-contract";

/**
 * Env override channel for the mcporter command vector.
 *
 * A JSON array of non-empty strings, e.g. `["bunx","mcporter"]`. Missing
 * resolves to the bare `mcporter` default.
 */
export const FALLOW_MCPORTER_COMMAND_ENV_VAR =
	"FALLOW_MCPORTER_COMMAND_JSON" as const;

/**
 * Default mcporter command vector when no override is set.
 */
export const FALLOW_MCPORTER_DEFAULT_COMMAND = ["mcporter"] as const;

/**
 * Reachability evidence returned by `trace_export`.
 *
 * Schema key names are the trusted ones from the spike: `file_reachable` and
 * `is_entry_point` (siblings `is_reachable` / `entry_point` can be null).
 */
export type TraceExportEvidence = {
	file: string;
	export_name: string;
	file_reachable: boolean;
	is_entry_point: boolean;
	is_used: boolean;
	direct_references: Array<{ from_file: string; kind: string }>;
	re_export_chains: unknown[];
};

/**
 * Coarse trace failure classes mapped onto the runner's failure taxonomy.
 *
 * `symbol_not_found` is a tool-level input failure (bad coordinates).
 * `transport_unavailable` is a setup failure (mcporter or the MCP server could
 * not run). `malformed_payload` fails closed when the payload is unusable.
 */
export type TraceFailureReason =
	| "symbol_not_found"
	| "transport_unavailable"
	| "malformed_payload";

/**
 * Discriminated trace outcome. Never throws across the module boundary.
 */
export type TraceResult =
	| { ok: true; evidence: TraceExportEvidence }
	| { ok: false; reason: TraceFailureReason; message: string };

/**
 * Structured command result the adapter runs `trace_export` through.
 *
 * Matches the runner's existing `runCommand` shape so the same runtime seam
 * backs both the Fallow CLI and the trace transport.
 */
export type TraceCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

/**
 * Injected command runner. Pure-over-runner keeps the adapter testable without
 * live mcporter.
 */
export type TraceCommandRunner = (
	command: string,
	args: readonly string[],
	options: { cwd: string },
) => Promise<TraceCommandResult>;

export type ResolveMcporterCommandResult =
	| { ok: true; vector: readonly [string, ...string[]] }
	| { ok: false; message: string };

/**
 * Resolve the mcporter command vector from an env override, or report why it is
 * invalid. Pure over env: no side effects, never throws. Mirrors the house
 * override contract (JSON array of non-empty strings; default `mcporter`; no
 * shell strings; no auto package-runner fallback).
 */
export function resolveFallowMcporterCommand(
	env: Record<string, string | undefined>,
): ResolveMcporterCommandResult {
	const rawOverride = env[FALLOW_MCPORTER_COMMAND_ENV_VAR];
	if (rawOverride === undefined) {
		return { ok: true, vector: [...FALLOW_MCPORTER_DEFAULT_COMMAND] };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawOverride);
	} catch {
		return {
			ok: false,
			message: `${FALLOW_MCPORTER_COMMAND_ENV_VAR} must be a JSON array of non-empty strings.`,
		};
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		return {
			ok: false,
			message: `${FALLOW_MCPORTER_COMMAND_ENV_VAR} must be a non-empty JSON array of strings.`,
		};
	}
	const vector: string[] = [];
	for (const value of parsed) {
		if (typeof value !== "string" || value.trim() === "") {
			return {
				ok: false,
				message: `${FALLOW_MCPORTER_COMMAND_ENV_VAR} entries must be non-empty strings.`,
			};
		}
		vector.push(value.trim());
	}
	const [command, ...args] = vector;
	return { ok: true, vector: [command, ...args] };
}

/**
 * Build the mcporter argv (after the command word) for one trace_export call.
 *
 * Confirmed live shape:
 *   mcporter call --stdio fallow-mcp --tool trace_export \
 *     --cwd <root> --output json --args '{"file":...,"export_name":...}'
 */
export function traceExportArgs(coordinates: {
	file: string;
	exportName: string;
	root: string;
}): string[] {
	return [
		"call",
		"--stdio",
		"fallow-mcp",
		"--tool",
		"trace_export",
		"--cwd",
		coordinates.root,
		"--output",
		"json",
		"--args",
		JSON.stringify({
			file: coordinates.file,
			export_name: coordinates.exportName,
		}),
	];
}

/**
 * Run `trace_export` for one export and classify the outcome.
 *
 * Pure over the injected runner and env. Never throws; every failure maps to a
 * {@link TraceFailureReason}. A missing override binary, non-zero exit with no
 * JSON, or empty output all map to `transport_unavailable`; a tool-level
 * `{ error: true }` maps to `symbol_not_found`; any unusable payload maps to
 * `malformed_payload` so absence of references never reads as a clean trace.
 */
export async function traceExportReachability(input: {
	file: string;
	exportName: string;
	root: string;
	env: Record<string, string | undefined>;
	runCommand: TraceCommandRunner;
}): Promise<TraceResult> {
	const resolved = resolveFallowMcporterCommand(input.env);
	if (!resolved.ok) {
		return { ok: false, reason: "transport_unavailable", message: resolved.message };
	}

	const [command, ...baseArgs] = resolved.vector;
	const args = [
		...baseArgs,
		...traceExportArgs({
			file: input.file,
			exportName: input.exportName,
			root: input.root,
		}),
	];

	const result = await input.runCommand(command, args, { cwd: input.root });

	const json = extractJson(result.stdout);
	if (json === undefined) {
		// No JSON at all: treat as transport failure (missing binary, crash,
		// offline server) rather than a malformed-but-present payload.
		return {
			ok: false,
			reason: "transport_unavailable",
			message:
				result.stderr.trim() ||
				`trace transport produced no JSON (exit ${result.exitCode}).`,
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return {
			ok: false,
			reason: "malformed_payload",
			message: "trace payload was not valid JSON.",
		};
	}

	// Transport-level failure: mcporter could not reach the server. mcporter
	// wraps these as { error: string, issue: {...} }.
	if (isTransportError(parsed)) {
		return {
			ok: false,
			reason: "transport_unavailable",
			message: String((parsed as { error: string }).error),
		};
	}
	// Tool-level failure: Fallow could not find the symbol ({ error: true }).
	if (isToolError(parsed)) {
		return {
			ok: false,
			reason: "symbol_not_found",
			message:
				(parsed as { message?: string }).message ?? "export not found",
		};
	}

	// A non-zero exit that is not one of the structured error envelopes above
	// means the transport failed even though it printed evidence-shaped output
	// (stale cache, best-effort dump before a crash). Never treat that as clean
	// reachability; classify it as a transport failure.
	if (result.exitCode !== 0) {
		return {
			ok: false,
			reason: "transport_unavailable",
			message:
				result.stderr.trim() ||
				`trace transport exited ${result.exitCode} with non-error output.`,
		};
	}

	const evidence = asTraceEvidence(parsed);
	if (!evidence) {
		// Fail closed: an incomplete payload must never become a deletion
		// candidate.
		return {
			ok: false,
			reason: "malformed_payload",
			message: "trace payload was missing required reachability fields.",
		};
	}
	return { ok: true, evidence };
}

/**
 * Derive the evidence grade from reachability evidence.
 *
 * The grade is the primary meaning of resolver output. Absence of references
 * derives `unreferenced_by_trace` (a deletion candidate), never deletion proof.
 * Entry-point and referenced status keep the export.
 */
export function deriveEvidenceGrade(
	evidence: TraceExportEvidence,
): FallowEvidenceGrade {
	if (evidence.is_entry_point) return FALLOW_EVIDENCE_GRADE_BY_KEY.entryPoint;
	if (evidence.is_used || evidence.direct_references.length > 0) {
		return FALLOW_EVIDENCE_GRADE_BY_KEY.referenced;
	}
	return FALLOW_EVIDENCE_GRADE_BY_KEY.unreferencedByTrace;
}

/**
 * Map a trace failure reason to the evidence grade reported when no clean
 * reachability evidence exists. `symbol_not_found` is unresolved input; a
 * transport or payload failure is unavailable.
 */
export function failureEvidenceGrade(
	reason: TraceFailureReason,
): FallowEvidenceGrade {
	if (reason === "symbol_not_found") {
		return FALLOW_EVIDENCE_GRADE_BY_KEY.unresolved;
	}
	return FALLOW_EVIDENCE_GRADE_BY_KEY.unavailable;
}

function isTransportError(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.error === "string" &&
		"issue" in value
	);
}

function isToolError(value: unknown): boolean {
	return isRecord(value) && value.error === true;
}

function asTraceEvidence(value: unknown): TraceExportEvidence | undefined {
	if (!isRecord(value)) return undefined;
	if (
		typeof value.file !== "string" ||
		typeof value.export_name !== "string" ||
		typeof value.file_reachable !== "boolean" ||
		typeof value.is_entry_point !== "boolean" ||
		typeof value.is_used !== "boolean"
	) {
		return undefined;
	}
	// Fail closed on reference-shape drift: if the payload reports references but
	// none match the known shape, the export may be referenced. Treating that as
	// zero references would grade it `unreferenced_by_trace` (a removal
	// candidate) — a fail-open. Reject the payload instead so the resolver
	// reports `unavailable`, never a false candidate.
	if (
		Array.isArray(value.direct_references) &&
		value.direct_references.length > 0
	) {
		const directReferences = value.direct_references.filter(isDirectReference);
		if (directReferences.length === 0) return undefined;
	}
	const directReferences = Array.isArray(value.direct_references)
		? value.direct_references.filter(isDirectReference)
		: [];
	const reExportChains = Array.isArray(value.re_export_chains)
		? value.re_export_chains
		: [];
	return {
		file: value.file,
		export_name: value.export_name,
		file_reachable: value.file_reachable,
		is_entry_point: value.is_entry_point,
		is_used: value.is_used,
		direct_references: directReferences,
		re_export_chains: reExportChains,
	};
}

function isDirectReference(
	value: unknown,
): value is { from_file: string; kind: string } {
	return (
		isRecord(value) &&
		typeof value.from_file === "string" &&
		typeof value.kind === "string"
	);
}

// bunx/npx print resolver lines before the JSON body. Take from the first `{`
// to the end — the call payload is the last JSON object on stdout.
function extractJson(stdout: string): string | undefined {
	const start = stdout.indexOf("{");
	if (start === -1) return undefined;
	return stdout.slice(start);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
