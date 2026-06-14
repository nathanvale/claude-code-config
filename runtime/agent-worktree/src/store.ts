import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
	AgentWorktreeChangedState,
	AgentWorktreeCommand,
	AgentWorktreeRef,
	AgentWorktreeRecoveryRetrySafety,
	AgentWorktreeSeam,
} from "./model.ts";
import { AGENT_WORKTREE_STORE_DIRS } from "./model.ts";

/**
 * Operation journal event kinds for durable run history.
 *
 * This is a minimal append-only journal, not event sourcing. It records enough
 * evidence for inspect and recovery after partial command failures.
 */
export const AGENT_WORKTREE_OPERATION_EVENT_KINDS = [
	"run_started",
	"step_started",
	"step_completed",
	"step_failed",
	"run_completed",
] as const;

/**
 * Operation journal event kind.
 */
export type AgentWorktreeOperationEventKind =
	(typeof AGENT_WORKTREE_OPERATION_EVENT_KINDS)[number];

/**
 * Operation step status values persisted in run records.
 */
export const AGENT_WORKTREE_OPERATION_STEP_STATUSES = [
	// reserved: v2 mid-run persistence and status-watch states.
	"pending",
	"running",
	"completed",
	"failed",
	// reserved: v2 operation-plan skip states.
	"skipped",
] as const;

/**
 * Operation step status.
 */
export type AgentWorktreeOperationStepStatus =
	(typeof AGENT_WORKTREE_OPERATION_STEP_STATUSES)[number];

/**
 * Durable event appended during a mutating command.
 *
 * @example
 * ```typescript
 * const event: AgentWorktreeOperationEvent = {
 *   kind: "step_failed",
 *   runId: "run-1",
 *   stepId: "delete_branch",
 *   changedState: "partial",
 * }
 * ```
 */
export interface AgentWorktreeOperationEvent {
	/** Event kind in the run journal. */
	kind: AgentWorktreeOperationEventKind;
	/** Package-owned run record id. */
	runId: string;
	/** Optional step id when the event belongs to one step. */
	stepId?: string;
	/** Changed-state after this event. */
	changedState: AgentWorktreeChangedState;
	/** Durable ref created by this event, when one exists. */
	ref?: AgentWorktreeRef;
	/** Stable summary for inspect and handoff output. */
	summary?: string;
	/** Epoch millis when the event was recorded. */
	createdAtMs?: number;
}

/**
 * One planned or completed operation step inside a run.
 *
 * Steps give agents a compact recovery map without reconstructing terminal
 * output or reading the full event trail.
 */
export interface AgentWorktreeOperationStep {
	/** Stable step id inside the run. */
	id: string;
	/** Human-readable action name owned by the command implementation. */
	action: string;
	/** Current step status. */
	status: AgentWorktreeOperationStepStatus;
	/** Changed-state after this step. */
	changedState: AgentWorktreeChangedState;
	/** Failure ref created for this step, when it failed durably. */
	failureRef?: AgentWorktreeRef;
}

/**
 * Durable run record stored under `.agent-worktree/runs`.
 *
 * @example
 * ```typescript
 * const record: AgentWorktreeRunRecord = {
 *   runId: "run-1",
 *   command: "delete",
 *   status: "failed",
 *   changedState: "partial",
 *   steps: [],
 *   events: [],
 * }
 * ```
 */
export interface AgentWorktreeRunRecord {
	/** Package-owned run id. */
	runId: string;
	/** Facade run id for cross-envelope correlation. */
	facadeRunId?: string;
	/** CLI command that produced the run. */
	command: AgentWorktreeCommand;
	/** Aggregate run status. */
	status: "running" | "completed" | "failed";
	/** Aggregate changed-state for recovery routing. */
	changedState: AgentWorktreeChangedState;
	/** Ordered operation steps. */
	steps: readonly AgentWorktreeOperationStep[];
	/** Append-only event trail for this run. */
	events: readonly AgentWorktreeOperationEvent[];
	/** Epoch millis when the record was created. */
	createdAtMs?: number;
	/** Exact backup ref created for branch deletion, when any. */
	backupRef?: string;
}

/**
 * Durable failure record stored under `.agent-worktree/failures`.
 *
 * @example
 * ```typescript
 * const failure: AgentWorktreeFailureRecord = {
 *   ref: { kind: "failure", id: "run-1/delete_branch" },
 *   runId: "run-1",
 *   stepId: "delete_branch",
 *   changedState: "partial",
 *   retrySafety: "inspect_first",
 *   whatHappened: "Branch deletion failed.",
 *   whatChanged: ["Worktree removed."],
 *   nextSafeActions: ["inspect"],
 * }
 * ```
 */
export interface AgentWorktreeFailureRecord {
	/** Durable failure ref. */
	ref: AgentWorktreeRef;
	/** Owning run id. */
	runId: string;
	/** Step that failed. */
	stepId: string;
	/** Changed-state after failure. */
	changedState: AgentWorktreeChangedState;
	/** Same-input retry safety summary. */
	retrySafety: AgentWorktreeRecoveryRetrySafety;
	/** What happened. */
	whatHappened: string;
	/** What changed before failure. */
	whatChanged: readonly string[];
	/** Safe next actions. */
	nextSafeActions: readonly string[];
	/** Diagnostic trail path or id. */
	diagnosticTrail?: string;
	/** Backup ref created during this run, when any. */
	backupRef?: string;
}

/**
 * Durable worktree record stored under `.agent-worktree/worktrees`.
 */
export interface AgentWorktreeRecord {
	/** Durable worktree ref. */
	ref: AgentWorktreeRef;
	/** Worktree branch. */
	branch: string;
	/** Worktree path. */
	path: string;
	/** Last observed HEAD object id. */
	head?: string;
	/** Last observed epoch millis. */
	observedAtMs: number;
}

/**
 * Store read/write port used by lifecycle and inspect commands.
 *
 * @example
 * ```typescript
 * const store = createFileStore("/repo/.agent-worktree")
 * ```
 */
export interface AgentWorktreeStore {
	/** Root directory for the main-owner store. */
	root: string;
	/** Ensure store subdirectories exist. */
	ensure(): Promise<void>;
	/** Write a run record and its JSONL event trail. */
	writeRun(record: AgentWorktreeRunRecord): Promise<void>;
	/** Read a run record. */
	readRun(id: string): Promise<AgentWorktreeRunRecord | null>;
	/** List run records for handoff and retention checks. */
	listRuns(): Promise<readonly AgentWorktreeRunRecord[]>;
	/** Write a failure record. */
	writeFailure(record: AgentWorktreeFailureRecord): Promise<void>;
	/** Read a failure record. */
	readFailure(id: string): Promise<AgentWorktreeFailureRecord | null>;
	/** List failure records for handoff and retention checks. */
	listFailures(): Promise<readonly AgentWorktreeFailureRecord[]>;
	/** Write a worktree record. */
	writeWorktree(record: AgentWorktreeRecord): Promise<void>;
	/** Read a worktree record. */
	readWorktree(id: string): Promise<AgentWorktreeRecord | null>;
	/** List worktree records for handoff and retention checks. */
	listWorktrees(): Promise<readonly AgentWorktreeRecord[]>;
}

/**
 * Create a filesystem-backed store.
 *
 * @param root - Main-owner `.agent-worktree` root
 * @returns Store port for durable records
 *
 * @example
 * ```typescript
 * const store = createFileStore("/repo/.agent-worktree")
 * await store.ensure()
 * ```
 */
export function createFileStore(root: string): AgentWorktreeStore {
	let ensurePromise: Promise<void> | undefined;
	const ensure = async (): Promise<void> => {
		ensurePromise ??= Promise.all(
			AGENT_WORKTREE_STORE_DIRS.map((dir) =>
				mkdir(join(root, dir), { recursive: true }),
			),
		).then(() => undefined);
		try {
			await ensurePromise;
		} catch (error) {
			ensurePromise = undefined;
			throw error;
		}
	};
	return {
		root,
		ensure,
		async writeRun(record) {
			await ensure();
			await writeJson(storeJsonPath(root, "runs", record.runId), record);
			await writeFile(
				join(root, "runs", `${record.runId}.jsonl`),
				record.events.map((event) => JSON.stringify(event)).join("\n") +
					(record.events.length > 0 ? "\n" : ""),
			);
		},
		readRun(id) {
			return readJson<AgentWorktreeRunRecord>(storeJsonPath(root, "runs", id));
		},
		listRuns() {
			return listJsonRecords<AgentWorktreeRunRecord>(root, "runs");
		},
		async writeFailure(record) {
			await ensure();
			await writeJson(
				storeJsonPath(root, "failures", record.ref.id),
				record,
			);
		},
		readFailure(id) {
			return readJson<AgentWorktreeFailureRecord>(
				storeJsonPath(root, "failures", id),
			);
		},
		listFailures() {
			return listJsonRecords<AgentWorktreeFailureRecord>(root, "failures");
		},
		async writeWorktree(record) {
			await ensure();
			await writeJson(
				storeJsonPath(root, "worktrees", record.ref.id),
				record,
			);
		},
		readWorktree(id) {
			return readJson<AgentWorktreeRecord>(
				storeJsonPath(root, "worktrees", id),
			);
		},
		listWorktrees() {
			return listJsonRecords<AgentWorktreeRecord>(root, "worktrees");
		},
	};
}

function storeJsonPath(
	root: string,
	dir: (typeof AGENT_WORKTREE_STORE_DIRS)[number],
	id: string,
): string {
	return join(root, dir, `${id}.json`);
}

/**
 * Build a package-owned run id from the facade run id.
 *
 * @param facadeRunId - Facade run id
 * @returns Filesystem-safe package run id
 *
 * @example
 * ```typescript
 * const id = packageRunId("run_abc")
 * ```
 */
export function packageRunId(facadeRunId: string): string {
	return facadeRunId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Derive aggregate changed-state from operation steps.
 *
 * @param steps - Ordered operation steps in a run
 * @returns Changed-state that should be exposed on run and failure envelopes
 *
 * @example
 * ```typescript
 * const state = summarizeOperationChangedState([
 *   { id: "remove_worktree", action: "remove", status: "completed", changedState: "complete" },
 * ])
 * ```
 */
export function summarizeOperationChangedState(
	steps: readonly AgentWorktreeOperationStep[],
): AgentWorktreeChangedState {
	const terminalSteps = steps.filter(
		(step) => step.status !== "pending" && step.status !== "skipped",
	);
	if (terminalSteps.length === 0) return "none";
	if (terminalSteps.some((step) => step.changedState === "unknown")) {
		return "unknown";
	}
	if (terminalSteps.some((step) => step.changedState === "partial")) {
		return "partial";
	}
	if (terminalSteps.every((step) => step.changedState === "complete")) {
		return "complete";
	}
	if (terminalSteps.some((step) => step.changedState === "complete")) {
		return "partial";
	}
	return "none";
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`);
}

async function readJson<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function listJsonRecords<T>(
	root: string,
	dir: (typeof AGENT_WORKTREE_STORE_DIRS)[number],
): Promise<readonly T[]> {
	try {
		const entries = await listJsonFiles(join(root, dir));
		const records = await Promise.all(
			entries.map((entry) => readJson<T>(entry)),
		);
		const present: T[] = [];
		for (const record of records) {
			if (record !== null) present.push(record as T);
		}
		return present;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function listJsonFiles(root: string): Promise<readonly string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const paths = await Promise.all(
		entries.map(async (entry) => {
			const path = join(root, entry.name);
			if (entry.isDirectory()) return listJsonFiles(path);
			return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
		}),
	);
	return paths.flat();
}

/**
 * Scaffold shell: store owns durable refs and event trails.
 *
 * Status: earned.
 * Deletion test: deleting this seam drops the only durable recovery surface for
 * partial worktree mutations.
 */
export const STORE_SEAM = {
	id: "store",
	ownerPath: "runtime/agent-worktree/src/store.ts",
	status: "earned",
	deletionTest:
		"Deleting store drops the durable recovery surface for partial mutations.",
	nextUnit: "U4",
} as const satisfies AgentWorktreeSeam;
