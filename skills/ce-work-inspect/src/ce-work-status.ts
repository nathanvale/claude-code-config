import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";

const CONTRACT_ID = "ce-work-inspect.result";
const SCHEMA_VERSION = "1";
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const SAFE_UPSTREAM_ERROR_WORD = /^[A-Za-z0-9._-]{1,64}$/;
const CONTROLLER_TIMEOUT_MS = 10_000;
const MAX_UPSTREAM_STDERR_LENGTH = 512;
const TERMINAL_STATES = new Set(["cleaned", "native-completed"]);

/** Stable inspector failure categories. */
export type InspectionErrorCode =
	| "controller_not_found"
	| "no_run"
	| "state_unreadable"
	| "unit_not_found"
	| "unsupported_controller"
	| "usage_error"
	| `upstream_${string}`;

interface UpstreamStatus {
	run_id: string;
	revision: number;
	source?: { kind?: string };
	units: Record<string, UpstreamUnit>;
	integration_lock?: Record<string, unknown> | null;
	verifications?: Array<Record<string, unknown>>;
	blockers?: Array<Record<string, unknown>>;
}

interface UpstreamUnit {
	state?: string;
	wave?: {
		id?: string | null;
		position?: number;
	};
	workspace?: {
		path?: string;
		registered?: boolean;
	};
	attempts?: Array<{
		process_state?: string;
		activity?: {
			latest_at?: string | null;
		};
		fallback?: {
			completed?: {
				accepted_head?: string;
			} | null;
		};
	}>;
	integration?: {
		verification?: Record<string, unknown> | null;
		canonical_commit?: {
			commit?: string;
		} | null;
	};
}

/** Stable unit summary emitted by the inspector. */
export interface UnitSummary {
	/** Plan unit identifier. */
	unit_id: string;
	/** Controller-owned lifecycle state. */
	state: string;
	/** External worker process state from the latest attempt. */
	process_state: string;
	/** Parallel wave identifier, when present. */
	wave_id: string | null;
	/** Position within the wave, when present. */
	wave_position: number | null;
	/** Recorded controller worktree path, when present. */
	worktree_path: string | null;
	/** Worktree ownership boundary. */
	ownership: "ce-work-controller";
	/** Unit-level verification projection. */
	verification: "passed" | "pending";
	/** Read-only continuation for the skill driver. */
	next_action: "wait_and_refresh" | "return_to_ce_work" | "none";
	/** Latest recorded activity timestamp. */
	latest_activity_at: string | null;
}

/** Stable wave summary emitted by the inspector. */
export interface WaveSummary {
	/** CE Work wave identifier. */
	wave_id: string;
	/** Unit identifiers in recorded wave order. */
	unit_ids: string[];
}

/** Successful machine-readable inspection result. */
export interface InspectionResult {
	/** Package-owned result contract. */
	contract_id: typeof CONTRACT_ID;
	/** Package-owned schema version. */
	schema_version: typeof SCHEMA_VERSION;
	/** Successful inspection status. */
	status: "ok";
	/** Per-invocation correlation identifier. */
	inspection_id: string;
	/** Explicit side-effect assertion. */
	read_only: true;
	/** Bounded run identity and revision. */
	run: {
		run_id: string;
		revision: number;
		source_kind: string;
	};
	/** Parallel waves recorded by CE Work. */
	waves: WaveSummary[];
	/** Bounded unit summaries. */
	units: UnitSummary[];
	/** Run-wide verification state. */
	verification: {
		run: "passed" | "failed" | "pending";
	};
	/** Whether canonical integration is currently locked. */
	integration: {
		locked: boolean;
		unit_id: string | null;
		phase: string | null;
	};
	/** Count of controller-recorded blockers. */
	blocker_count: number;
	/** One current safe continuation. */
	next_action: {
		id: "wait_and_refresh" | "return_to_ce_work" | "run_complete";
	};
	/** Upstream deterministic source used for the inspection. */
	source: {
		controller: string;
		status_word: "STATUS";
	};
}

/** Machine-readable failure returned when inspection cannot continue safely. */
export interface InspectionFailure {
	/** Package-owned result contract. */
	contract_id: typeof CONTRACT_ID;
	/** Package-owned schema version. */
	schema_version: typeof SCHEMA_VERSION;
	/** Classified failure state. */
	status: "blocked" | "no_run";
	/** Per-invocation correlation identifier. */
	inspection_id: string;
	/** Explicit side-effect assertion. */
	read_only: true;
	/** Repair-oriented error data. */
	error: {
		code: InspectionErrorCode;
		message: string;
		retry_safe: true;
	};
	/** One current safe continuation. */
	next_action: {
		id:
			| "fix_arguments"
			| "inspect_run"
			| "return_to_ce_work_recovery"
			| "start_or_supply_ce_run"
			| "update_ce_work";
	};
}

/**
 * Error raised when the inspector cannot safely obtain or understand CE state.
 */
export class InspectionError extends Error {
	/**
	 * Create a classified inspector failure.
	 *
	 * @param code - Stable package-owned failure category
	 * @param message - Human repair context
	 *
	 * @example
	 * ```typescript
	 * throw new InspectionError("state_unreadable", "manifest is unavailable")
	 * ```
	 */
	constructor(
		readonly code: InspectionErrorCode,
		message: string,
	) {
		super(message);
		this.name = "InspectionError";
	}
}

/**
 * Convert a classified inspection error into stable machine output.
 *
 * @param error - Classified inspector failure
 * @returns Read-only repair envelope
 *
 * @example
 * ```typescript
 * const result = buildFailureResult(new InspectionError("no_run", "No run"))
 * ```
 */
export function buildFailureResult(error: InspectionError): InspectionFailure {
	const nextAction =
		error.code === "no_run"
			? "start_or_supply_ce_run"
			: error.code === "unit_not_found"
				? "inspect_run"
				: error.code === "usage_error"
					? "fix_arguments"
					: error.code === "controller_not_found" ||
						  error.code === "unsupported_controller"
						? "update_ce_work"
						: "return_to_ce_work_recovery";
	return {
		contract_id: CONTRACT_ID,
		schema_version: SCHEMA_VERSION,
		status: error.code === "no_run" ? "no_run" : "blocked",
		inspection_id: `ce-work-inspect-${randomUUID()}`,
		read_only: true,
		error: {
			code: error.code,
			message:
				error.code === "no_run"
					? "No CE Work run exists for the supplied run ID."
					: error.message,
			retry_safe: true,
		},
		next_action: { id: nextAction },
	};
}

/**
 * Map a classified failure to the CLI exit contract.
 *
 * @param code - Stable package-owned failure category
 * @returns Process exit code
 *
 * @example
 * ```typescript
 * process.exitCode = failureExitCode("no_run")
 * ```
 */
export function failureExitCode(code: InspectionErrorCode): number {
	if (code === "usage_error") {
		return 2;
	}
	if (
		code === "no_run" ||
		code === "unit_not_found" ||
		code === "controller_not_found"
	) {
		return 3;
	}
	return 4;
}

function assertSafeRunId(runId: string): void {
	if (!SAFE_ID.test(runId) || !runId.replaceAll(".", "")) {
		throw new InspectionError("usage_error", `unsafe run ID: ${runId}`);
	}
}

function upstreamErrorWord(output: string): string {
	const word = output.trim().split(/\r?\n/, 1)[0] ?? "";
	return SAFE_UPSTREAM_ERROR_WORD.test(word) ? word.toLowerCase() : "failed";
}

function boundedUpstreamStderr(output: string): string {
	return output
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_UPSTREAM_STDERR_LENGTH);
}

function assertPrivatePath(
	path: string,
	expectedKind: "directory" | "file",
	expectedMode: number,
	missingCode: "no_run" | "state_unreadable",
): void {
	let state: ReturnType<typeof lstatSync>;
	try {
		state = lstatSync(path);
	} catch {
		throw new InspectionError(
			missingCode,
			`required CE state is absent: ${path}`,
		);
	}
	if (state.isSymbolicLink()) {
		throw new InspectionError("state_unreadable", `CE state path is a symlink: ${path}`);
	}
	if (
		(expectedKind === "directory" && !state.isDirectory()) ||
		(expectedKind === "file" && !state.isFile())
	) {
		throw new InspectionError(
			"state_unreadable",
			`CE state path has the wrong type: ${path}`,
		);
	}
	if ((state.mode & 0o777) !== expectedMode) {
		throw new InspectionError(
			"state_unreadable",
			`CE state mode is not ${expectedMode.toString(8)}: ${path}`,
		);
	}
	if (typeof process.getuid === "function" && state.uid !== process.getuid()) {
		throw new InspectionError(
			"state_unreadable",
			`CE state is not owned by the current user: ${path}`,
		);
	}
}

function preflightReadOnlyState(runsRoot: string, runId: string): void {
	const runRoot = join(runsRoot, runId);
	assertPrivatePath(runsRoot, "directory", 0o700, "no_run");
	assertPrivatePath(
		join(runsRoot, ".locks"),
		"directory",
		0o700,
		"state_unreadable",
	);
	assertPrivatePath(runRoot, "directory", 0o700, "no_run");
	assertPrivatePath(
		join(runRoot, "manifest.lock"),
		"file",
		0o600,
		"state_unreadable",
	);
	assertPrivatePath(
		join(runRoot, "manifest.json"),
		"file",
		0o600,
		"state_unreadable",
	);
}

function assertController(controllerPath: string): void {
	let state: ReturnType<typeof lstatSync>;
	try {
		state = lstatSync(controllerPath);
	} catch {
		throw new InspectionError(
			"controller_not_found",
			"CE Work unit-workspace.py controller is not installed at the supplied path",
		);
	}
	if (state.isSymbolicLink() || !state.isFile()) {
		throw new InspectionError(
			"unsupported_controller",
			"CE Work controller path is not a regular file",
		);
	}
}

function resolveRunsRoot(environment: NodeJS.ProcessEnv): string {
	if (environment.CE_WORK_RUNS_ROOT) {
		return resolve(environment.CE_WORK_RUNS_ROOT);
	}
	if (environment.CE_PEER_JOBS_ROOT) {
		return join(resolve(environment.CE_PEER_JOBS_ROOT), "ce-work");
	}
	if (typeof process.getuid !== "function") {
		throw new InspectionError(
			"state_unreadable",
			"current user ID is unavailable; cannot resolve CE Work state",
		);
	}
	return `/tmp/compound-engineering-${process.getuid()}/ce-work`;
}

function parseStatusOutput(output: string): UpstreamStatus {
	const lines = output.trimEnd().split("\n");
	if (lines[0] !== "STATUS" || lines.length !== 2) {
		throw new InspectionError(
			"unsupported_controller",
			"CE Work status did not return STATUS plus one JSON document",
		);
	}
	let body: unknown;
	try {
		body = JSON.parse(lines[1] ?? "");
	} catch {
		throw new InspectionError(
			"unsupported_controller",
			"CE Work status returned malformed JSON",
		);
	}
	if (
		!body ||
		typeof body !== "object" ||
		typeof (body as Partial<UpstreamStatus>).run_id !== "string" ||
		typeof (body as Partial<UpstreamStatus>).revision !== "number" ||
		!(body as Partial<UpstreamStatus>).units ||
		typeof (body as Partial<UpstreamStatus>).units !== "object"
	) {
		throw new InspectionError(
			"unsupported_controller",
			"CE Work status JSON is missing required fields",
		);
	}
	return body as UpstreamStatus;
}

function unitVerification(unit: UpstreamUnit): "passed" | "pending" {
	if (unit.integration?.verification) {
		return "passed";
	}
	const fallback = unit.attempts?.at(-1)?.fallback?.completed;
	return fallback?.accepted_head ? "passed" : "pending";
}

function unitNextAction(
	state: string,
): "wait_and_refresh" | "return_to_ce_work" | "none" {
	if (state === "authoring") {
		return "wait_and_refresh";
	}
	if (TERMINAL_STATES.has(state)) {
		return "none";
	}
	return "return_to_ce_work";
}

function summarizeUnits(status: UpstreamStatus): UnitSummary[] {
	return Object.entries(status.units)
		.map(([unitId, unit]) => {
			const attempt = unit.attempts?.at(-1);
			const state = unit.state ?? "unknown";
			return {
				unit_id: unitId,
				state,
				process_state: attempt?.process_state ?? "unknown",
				wave_id: unit.wave?.id ?? null,
				wave_position:
					typeof unit.wave?.position === "number" ? unit.wave.position : null,
				worktree_path: unit.workspace?.path ?? null,
				ownership: "ce-work-controller" as const,
				verification: unitVerification(unit),
				next_action: unitNextAction(state),
				latest_activity_at: attempt?.activity?.latest_at ?? null,
			};
		})
		.sort((left, right) => {
			const leftPosition = left.wave_position ?? Number.MAX_SAFE_INTEGER;
			const rightPosition = right.wave_position ?? Number.MAX_SAFE_INTEGER;
			return leftPosition - rightPosition || left.unit_id.localeCompare(right.unit_id);
		});
}

function summarizeWaves(units: readonly UnitSummary[]): WaveSummary[] {
	const waves = new Map<string, string[]>();
	for (const unit of units) {
		if (!unit.wave_id) {
			continue;
		}
		const members = waves.get(unit.wave_id) ?? [];
		members.push(unit.unit_id);
		waves.set(unit.wave_id, members);
	}
	return [...waves.entries()].map(([waveId, unitIds]) => ({
		wave_id: waveId,
		unit_ids: unitIds,
	}));
}

function acceptedUnitCommits(
	status: UpstreamStatus,
): Record<string, string> | null {
	const accepted: Record<string, string> = {};
	for (const [unitId, unit] of Object.entries(status.units)) {
		const commit =
			unit.integration?.canonical_commit?.commit ??
			unit.attempts?.at(-1)?.fallback?.completed?.accepted_head;
		if (!TERMINAL_STATES.has(unit.state ?? "") || !commit) {
			return null;
		}
		accepted[unitId] = commit;
	}
	return accepted;
}

function equalCommitMaps(
	left: Record<string, string>,
	right: unknown,
): boolean {
	if (!right || typeof right !== "object" || Array.isArray(right)) {
		return false;
	}
	const rightMap = right as Record<string, unknown>;
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(rightMap).sort();
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key, index) =>
				key === rightKeys[index] && left[key] === rightMap[key],
		)
	);
}

function runVerification(
	status: UpstreamStatus,
): "passed" | "failed" | "pending" {
	const accepted = acceptedUnitCommits(status);
	if (!accepted) {
		return "pending";
	}
	const receipts = status.verifications ?? [];
	for (const receipt of receipts.toReversed()) {
		if (!equalCommitMaps(accepted, receipt.accepted_units)) {
			continue;
		}
		return receipt.verification_exit === 0 ? "passed" : "failed";
	}
	return "pending";
}

function overallNextAction(
	units: readonly UnitSummary[],
	verification: "passed" | "failed" | "pending",
	blockerCount: number,
): "wait_and_refresh" | "return_to_ce_work" | "run_complete" {
	if (blockerCount > 0 || verification === "failed") {
		return "return_to_ce_work";
	}
	if (units.some((unit) => unit.state === "authoring")) {
		return "wait_and_refresh";
	}
	if (
		units.length > 0 &&
		units.every((unit) => TERMINAL_STATES.has(unit.state)) &&
		verification === "passed"
	) {
		return "run_complete";
	}
	return "return_to_ce_work";
}

/**
 * Inspect one CE Work controller run through its supported status command.
 *
 * @param input - Explicit run and controller identity
 * @returns Bounded read-only status projection
 * @throws {InspectionError} When state is absent, unsafe, or unsupported
 *
 * @example
 * ```typescript
 * const status = inspectCeWorkStatus({
 *   runId: "run-42",
 *   controllerPath: "/path/to/unit-workspace.py",
 *   environment: process.env,
 * })
 * ```
 */
export function inspectCeWorkStatus(input: {
	runId: string;
	controllerPath: string;
	environment: NodeJS.ProcessEnv;
	unitId?: string;
}): InspectionResult {
	assertSafeRunId(input.runId);
	const controllerPath = resolve(input.controllerPath);
	assertController(controllerPath);
	const runsRoot = resolveRunsRoot(input.environment);
	preflightReadOnlyState(runsRoot, input.runId);
	const controller = Bun.spawnSync({
		cmd: ["python3", controllerPath, "status", "--run-id", input.runId],
		env: input.environment,
		stdout: "pipe",
		stderr: "pipe",
		timeout: CONTROLLER_TIMEOUT_MS,
	});
	if (controller.exitCode !== 0) {
		const word = upstreamErrorWord(controller.stdout.toString());
		const stderr = boundedUpstreamStderr(controller.stderr.toString());
		throw new InspectionError(
			`upstream_${word}`,
			`CE Work status failed with ${word}; stderr: ${stderr || "(empty)"}`,
		);
	}
	const status = parseStatusOutput(controller.stdout.toString());
	if (status.run_id !== input.runId) {
		throw new InspectionError(
			"unsupported_controller",
			"CE Work status returned a different run ID",
		);
	}
	let units = summarizeUnits(status);
	if (input.unitId) {
		units = units.filter((unit) => unit.unit_id === input.unitId);
		if (units.length === 0) {
			throw new InspectionError(
				"unit_not_found",
				`CE Work run has no unit ${input.unitId}`,
			);
		}
	}
	const verification = runVerification(status);
	const blockerCount = status.blockers?.length ?? 0;
	const lock = status.integration_lock;
	return {
		contract_id: CONTRACT_ID,
		schema_version: SCHEMA_VERSION,
		status: "ok",
		inspection_id: `ce-work-inspect-${randomUUID()}`,
		read_only: true,
		run: {
			run_id: status.run_id,
			revision: status.revision,
			source_kind: status.source?.kind ?? "unknown",
		},
		waves: summarizeWaves(units),
		units,
		verification: { run: verification },
		integration: {
			locked: Boolean(lock),
			unit_id:
				lock && typeof lock.unit_id === "string" ? lock.unit_id : null,
			phase: lock && typeof lock.phase === "string" ? lock.phase : null,
		},
		blocker_count: blockerCount,
		next_action: {
			id: overallNextAction(units, verification, blockerCount),
		},
		source: {
			controller: controllerPath,
			status_word: "STATUS",
		},
	};
}
