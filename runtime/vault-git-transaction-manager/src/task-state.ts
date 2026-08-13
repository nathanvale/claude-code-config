import { createHash } from "node:crypto";

import {
	VAULT_GIT_TASK_PHASES,
	VAULT_GIT_TASK_STATES,
	VAULT_GIT_CHANGED_STATES,
	VAULT_GIT_BLOCKER_IDS,
	VAULT_GIT_RESULT_OUTCOMES,
	VAULT_GIT_RETRY_SAFETIES,
	VAULT_GIT_TRANSACTION_PHASES,
	type VaultGitTaskState,
	type VaultGitTaskStateInput,
	type VaultGitTaskRepairAuthorization,
	type VaultGitTaskTerminalResult,
} from "./model.ts";

/** Mutable fields accepted by one monotonic task-state transition. */
export interface VaultGitTaskStateAdvanceInput {
	readonly state: VaultGitTaskState["state"];
	readonly phase: VaultGitTaskState["phase"];
	readonly updatedAt: string;
	readonly heartbeatAt: string | null;
	readonly checkpoint: VaultGitTaskState["checkpoint"];
	readonly launchGeneration?: string | null;
	readonly launchExpiresAt?: string | null;
	readonly workerPid?: number | null;
	readonly workerProcessIdentity?: string | null;
	readonly launchAttempt?: number;
	readonly terminalResult?: VaultGitTaskTerminalResult | null;
}

/** Immutable inputs that decide whether a completion caller may join a task. */
export interface VaultGitTaskBindingInput {
	/** Receipt proposed by the completion caller. */
	readonly receiptId: string;
	/** Exact transaction selected for completion. */
	readonly transactionId: string;
	/** Exact named remote bound by the receipt. */
	readonly remote: string;
	/** Exact fencing generation owned by the receipt. */
	readonly generation: string;
	/** SHA-256 digest of the inherited owner capability, never its bytes. */
	readonly capabilityDigest: string;
	/** Canonical completion input supplied by the CLI owner. */
	readonly normalizedInput: string;
}

/** Private immutable task claim with a one-way caller-binding digest. */
export type VaultGitTaskClaim = Readonly<
	VaultGitTaskState & { readonly bindingDigest: string }
>;

const VAULT_GIT_TASK_STATE_KEYS = [
	"schemaVersion",
	"taskId",
	"receiptId",
	"transactionId",
	"leaseGeneration",
	"revision",
	"attemptNumber",
	"state",
	"phase",
	"recordedAt",
	"updatedAt",
	"heartbeatAt",
	"checkpoint",
	"launchGeneration",
	"launchExpiresAt",
	"workerPid",
	"workerProcessIdentity",
	"launchAttempt",
	"terminalResult",
	"previousTerminalResult",
	"repairReentryBlocked",
	"repairAuthorization",
] as const;

const LEGACY_VAULT_GIT_TASK_STATE_KEYS = VAULT_GIT_TASK_STATE_KEYS.filter(
	(key) =>
		key !== "attemptNumber" &&
		key !== "previousTerminalResult" &&
		key !== "repairReentryBlocked" &&
		key !== "repairAuthorization",
);

const VAULT_GIT_TASK_CLAIM_KEYS = [
	...VAULT_GIT_TASK_STATE_KEYS,
	"bindingDigest",
] as const;

const LEGACY_VAULT_GIT_TASK_CLAIM_KEYS = [
	...LEGACY_VAULT_GIT_TASK_STATE_KEYS,
	"bindingDigest",
] as const;

/** Exact durable acknowledgement required before one task-worker launch. */
export interface VaultGitTaskWorkerAcknowledgement {
	readonly schemaVersion: 1;
	readonly taskId: string;
	readonly launchGeneration: string;
	readonly acknowledgedAt: string;
}

/** Fields supplied to the durable worker-acknowledgement owner. */
export type VaultGitTaskWorkerAcknowledgementInput = Omit<
	VaultGitTaskWorkerAcknowledgement,
	"schemaVersion"
>;

/** Proof that this acknowledgement call won its exact durable CAS transition. */
export interface VaultGitTaskWorkerAcknowledgementTransitioned {
	readonly schemaVersion: 1;
	readonly status: "transitioned";
	readonly acknowledgement: VaultGitTaskWorkerAcknowledgement;
}

/** Capability-free refusal when this call did not win a fresh durable transition. */
export interface VaultGitTaskWorkerAcknowledgementNotTransitioned {
	readonly schemaVersion: 1;
	readonly status: "existing" | "stale" | "uncertain";
}

/** Exact durable CAS result returned by the acknowledgement owner. */
export type VaultGitTaskWorkerAcknowledgementResult =
	| VaultGitTaskWorkerAcknowledgementTransitioned
	| VaultGitTaskWorkerAcknowledgementNotTransitioned;

/**
 * Create the first immutable state for a receipt-scoped background task.
 *
 * @param input - Store-generated task identity and receipt claim
 * @returns Frozen, capability-free revision-one task state
 * @throws {Error} When an identifier or timestamp is invalid
 *
 * @example
 * ```typescript
 * const state = createVaultGitTaskState({
 *   taskId: "task_11111111111111111111111111111111",
 *   receiptId: "receipt_22222222222222222222222222222222",
 *   transactionId: "txn_33333333333333333333333333333333",
 *   leaseGeneration: "a".repeat(40),
 *   recordedAt: "2026-08-12T11:30:00.000Z",
 * })
 * ```
 */
export function createVaultGitTaskState(
	input: VaultGitTaskStateInput,
): VaultGitTaskState {
	return parseVaultGitTaskState({
		schemaVersion: 2,
		taskId: input.taskId,
		receiptId: input.receiptId,
		transactionId: input.transactionId,
		leaseGeneration: input.leaseGeneration,
		revision: 1,
		attemptNumber: 1,
		state: "claimed",
		phase: "admitted",
		recordedAt: input.recordedAt,
		updatedAt: input.recordedAt,
		heartbeatAt: null,
		checkpoint: null,
		launchGeneration: null,
		launchExpiresAt: null,
		workerPid: null,
		workerProcessIdentity: null,
		launchAttempt: 0,
		terminalResult: null,
		previousTerminalResult: null,
		repairReentryBlocked: false,
		repairAuthorization: null,
	});
}

/** Build the next monotonic task revision without granting worker authority. */
export function advanceVaultGitTaskState(
	previous: VaultGitTaskState,
	input: VaultGitTaskStateAdvanceInput,
): VaultGitTaskState {
	// Doctor may refine an unclassified outcome into a known repair, but never the
	// reverse: a proven repair must not decay back into unknown, and closed absorbs.
	const terminalRefinement =
		previous.state === "unknown" && input.state === "repair_needed";
	if (
		(previous.phase === "terminal" &&
			!terminalRefinement &&
			(previous.state === "closed" || input.state !== "closed")) ||
		(input.phase === "terminal") !== (input.terminalResult != null) ||
		(input.phase === "admitted" &&
			input.state !== "claimed" &&
			input.state !== "launching") ||
		(input.phase === "running" && input.state !== "in_progress") ||
		(input.phase === "terminal" &&
			!(["closed", "repair_needed", "unknown"] as const).includes(
				input.state as never,
			)) ||
		(input.launchAttempt !== undefined &&
			input.launchAttempt < previous.launchAttempt) ||
		Date.parse(input.updatedAt) < Date.parse(previous.updatedAt)
	) {
		throw new Error("task state transition invalid");
	}
	return parseVaultGitTaskState({
		...previous,
		revision: previous.revision + 1,
		state: input.state,
		phase: input.phase,
		updatedAt: input.updatedAt,
		heartbeatAt: input.heartbeatAt,
		checkpoint: input.checkpoint,
		launchGeneration:
			input.launchGeneration === undefined
				? previous.launchGeneration
				: input.launchGeneration,
		launchExpiresAt:
			input.launchExpiresAt === undefined
				? previous.launchExpiresAt
				: input.launchExpiresAt,
		workerPid: input.workerPid === undefined ? previous.workerPid : input.workerPid,
		workerProcessIdentity: input.workerProcessIdentity === undefined
			? previous.workerProcessIdentity
			: input.workerProcessIdentity,
		launchAttempt: input.launchAttempt === undefined
			? previous.launchAttempt
			: input.launchAttempt,
		terminalResult: input.terminalResult ?? null,
		previousTerminalResult: previous.previousTerminalResult,
		repairReentryBlocked:
			previous.repairReentryBlocked ||
			previous.state === "unknown" ||
			input.state === "unknown",
		repairAuthorization:
			input.state === "closed" ? null : previous.repairAuthorization,
	});
}

/**
 * Bind one immutable task state to the exact completion caller inputs.
 *
 * @param state - Validated capability-free task state
 * @param input - Exact transaction, receipt, fence, capability digest, and input
 * @returns Frozen claim whose one-way binding contains no raw capability or input
 * @throws {Error} When a binding field is malformed
 */
export function createVaultGitTaskClaim(
	state: VaultGitTaskState,
	input: VaultGitTaskBindingInput,
): VaultGitTaskClaim {
	return Object.freeze({
		...state,
		bindingDigest: digestVaultGitTaskBinding(input),
	});
}

/**
 * Parse one exact persisted task claim.
 *
 * @param value - Unknown private claim value
 * @returns Frozen validated task claim
 * @throws {Error} When the claim is malformed or contains additional fields
 */
export function parseVaultGitTaskClaim(value: unknown): VaultGitTaskClaim {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("task claim invalid");
	}
	const record = value as Record<string, unknown>;
	const exactCurrent =
		Object.keys(record).length === VAULT_GIT_TASK_CLAIM_KEYS.length &&
		VAULT_GIT_TASK_CLAIM_KEYS.every((key) => Object.hasOwn(record, key));
	const exactLegacy =
		Object.keys(record).length === LEGACY_VAULT_GIT_TASK_CLAIM_KEYS.length &&
		LEGACY_VAULT_GIT_TASK_CLAIM_KEYS.every((key) => Object.hasOwn(record, key));
	if (
		(!exactCurrent && !exactLegacy) ||
		typeof record.bindingDigest !== "string" ||
		!/^[0-9a-f]{64}$/.test(record.bindingDigest)
	) {
		throw new Error("task claim invalid");
	}
	const { bindingDigest: _bindingDigest, ...stateValue } = record;
	const state = parseVaultGitTaskState(stateValue);
	return Object.freeze({ ...state, bindingDigest: record.bindingDigest });
}

/**
 * Parse one exact durable worker acknowledgement.
 *
 * @param value - Unknown acknowledgement returned by its persistence owner
 * @returns Frozen acknowledgement with an exact task and launch generation
 * @throws {Error} When the record is malformed or contains additional fields
 */
export function parseVaultGitTaskWorkerAcknowledgement(
	value: unknown,
): VaultGitTaskWorkerAcknowledgement {
	const expectedKeys = [
		"schemaVersion",
		"taskId",
		"launchGeneration",
		"acknowledgedAt",
	] as const;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("task worker acknowledgement invalid");
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).length !== expectedKeys.length ||
		!expectedKeys.every((key) => Object.hasOwn(record, key)) ||
		record.schemaVersion !== 1 ||
		typeof record.taskId !== "string" ||
		!/^task_[0-9a-f]{32}$/.test(record.taskId) ||
		typeof record.launchGeneration !== "string" ||
		!/^launch_[0-9a-f]{32}$/.test(record.launchGeneration) ||
		typeof record.acknowledgedAt !== "string" ||
		!isExactIsoTimestamp(record.acknowledgedAt)
	) {
		throw new Error("task worker acknowledgement invalid");
	}
	return Object.freeze({
		schemaVersion: 1,
		taskId: record.taskId,
		launchGeneration: record.launchGeneration,
		acknowledgedAt: record.acknowledgedAt,
	});
}

/**
 * Parse the acknowledgement owner's exact durable CAS outcome.
 *
 * Only `transitioned` carries proof that this invocation wrote the exact
 * task-generation acknowledgement. Every other outcome remains capability-free.
 *
 * @param value - Unknown result returned by the durable acknowledgement owner
 * @returns Frozen transitioned proof or a frozen non-transition outcome
 * @throws {Error} When the result is malformed or contains additional fields
 */
export function parseVaultGitTaskWorkerAcknowledgementResult(
	value: unknown,
): VaultGitTaskWorkerAcknowledgementResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("task worker acknowledgement result invalid");
	}
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== 1 || typeof record.status !== "string") {
		throw new Error("task worker acknowledgement result invalid");
	}
	if (record.status === "transitioned") {
		const expectedKeys = [
			"schemaVersion",
			"status",
			"acknowledgement",
		] as const;
		if (
			Object.keys(record).length !== expectedKeys.length ||
			!expectedKeys.every((key) => Object.hasOwn(record, key))
		) {
			throw new Error("task worker acknowledgement result invalid");
		}
		return Object.freeze({
			schemaVersion: 1,
			status: "transitioned",
			acknowledgement: parseVaultGitTaskWorkerAcknowledgement(
				record.acknowledgement,
			),
		});
	}
	if (
		(record.status === "existing" ||
			record.status === "stale" ||
			record.status === "uncertain") &&
		Object.keys(record).length === 2 &&
		Object.hasOwn(record, "schemaVersion") &&
		Object.hasOwn(record, "status")
	) {
		return Object.freeze({
			schemaVersion: 1,
			status: record.status,
		});
	}
	throw new Error("task worker acknowledgement result invalid");
}

/** Produce the canonical one-way binding for claim comparison. */
export function digestVaultGitTaskBinding(
	input: VaultGitTaskBindingInput,
): string {
	if (
		!/^receipt_[0-9a-f]{32}$/.test(input.receiptId) ||
		!/^txn_[0-9a-f]{32}$/.test(input.transactionId) ||
		input.remote.length === 0 ||
		input.remote !== input.remote.trim() ||
		!(/^[0-9a-f]{40}$/.test(input.generation) ||
			/^[0-9a-f]{64}$/.test(input.generation)) ||
		!/^[0-9a-f]{64}$/.test(input.capabilityDigest) ||
		input.normalizedInput.length === 0
	) {
		throw new Error("task binding invalid");
	}
	return createHash("sha256")
		.update(
			JSON.stringify({
				receiptId: input.receiptId,
				transactionId: input.transactionId,
				remote: input.remote,
				generation: input.generation,
				capabilityDigest: input.capabilityDigest,
				normalizedInput: input.normalizedInput,
			}),
		)
		.digest("hex");
}

/**
 * Parse one exact task-state record without accepting capability-shaped data.
 *
 * @param value - Unknown private-state value
 * @returns Frozen validated task state
 * @throws {Error} When the record is malformed or contains additional fields
 *
 * @example
 * ```typescript
 * const state = parseVaultGitTaskState(JSON.parse(source))
 * ```
 */
export function parseVaultGitTaskState(value: unknown): VaultGitTaskState {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value)
	) {
		throw new Error("task state invalid");
	}
	const source = value as Record<string, unknown>;
	const exactLegacy =
		Object.keys(source).length === LEGACY_VAULT_GIT_TASK_STATE_KEYS.length &&
		LEGACY_VAULT_GIT_TASK_STATE_KEYS.every((key) => Object.hasOwn(source, key)) &&
		source.schemaVersion === 1;
	const record: Record<string, unknown> = exactLegacy
		? {
			...source,
			schemaVersion: 2,
			attemptNumber: 1,
			previousTerminalResult: null,
			repairReentryBlocked: source.state === "unknown",
			repairAuthorization: null,
		}
		: source;
	if (
		Object.keys(record).length !== VAULT_GIT_TASK_STATE_KEYS.length ||
		!VAULT_GIT_TASK_STATE_KEYS.every((key) => Object.hasOwn(record, key)) ||
		record.schemaVersion !== 2 ||
		typeof record.taskId !== "string" ||
		!/^task_[0-9a-f]{32}$/.test(record.taskId) ||
		typeof record.receiptId !== "string" ||
		!/^receipt_[0-9a-f]{32}$/.test(record.receiptId) ||
		typeof record.transactionId !== "string" ||
		!/^txn_[0-9a-f]{32}$/.test(record.transactionId) ||
		typeof record.leaseGeneration !== "string" ||
		!(/^[0-9a-f]{40}$/.test(record.leaseGeneration) ||
			/^[0-9a-f]{64}$/.test(record.leaseGeneration)) ||
		typeof record.revision !== "number" ||
		!Number.isSafeInteger(record.revision) ||
		record.revision < 1 ||
		typeof record.attemptNumber !== "number" ||
		!Number.isSafeInteger(record.attemptNumber) ||
		record.attemptNumber < 1 ||
		!VAULT_GIT_TASK_STATES.includes(record.state as never) ||
		!VAULT_GIT_TASK_PHASES.includes(record.phase as never) ||
		typeof record.recordedAt !== "string" ||
		!isExactIsoTimestamp(record.recordedAt) ||
		typeof record.updatedAt !== "string" ||
		!isExactIsoTimestamp(record.updatedAt) ||
		(record.heartbeatAt !== null &&
			(typeof record.heartbeatAt !== "string" ||
				!isExactIsoTimestamp(record.heartbeatAt))) ||
		(record.checkpoint !== null &&
			!VAULT_GIT_TRANSACTION_PHASES.includes(record.checkpoint as never)) ||
		(record.launchGeneration !== null &&
			(typeof record.launchGeneration !== "string" ||
				!/^launch_[0-9a-f]{32}$/.test(record.launchGeneration))) ||
		(record.launchExpiresAt !== null &&
			(typeof record.launchExpiresAt !== "string" ||
				!isExactIsoTimestamp(record.launchExpiresAt))) ||
		(record.workerPid !== null &&
			(typeof record.workerPid !== "number" ||
				!Number.isSafeInteger(record.workerPid) ||
				record.workerPid <= 0)) ||
		(record.workerProcessIdentity !== null &&
			(typeof record.workerProcessIdentity !== "string" ||
				!/^[0-9a-f]{64}$/u.test(record.workerProcessIdentity))) ||
		typeof record.launchAttempt !== "number" ||
		!Number.isSafeInteger(record.launchAttempt) ||
		record.launchAttempt < 0 ||
		record.launchAttempt > 2 ||
		(record.workerPid === null) !== (record.workerProcessIdentity === null) ||
		!isTaskTerminalResult(record.terminalResult) ||
		!isTaskTerminalResult(record.previousTerminalResult) ||
		typeof record.repairReentryBlocked !== "boolean" ||
		!isTaskRepairAuthorization(record.repairAuthorization) ||
		(record.repairAuthorization !== null && record.repairReentryBlocked) ||
		(record.repairAuthorization !== null &&
			(record.state !== "repair_needed" || record.phase !== "terminal")) ||
		(record.phase === "terminal") !== (record.terminalResult !== null) ||
		(record.phase === "admitted" &&
			record.state !== "claimed" &&
			record.state !== "launching") ||
		(record.state === "launching" &&
			(record.launchGeneration === null || record.launchExpiresAt === null)) ||
		(record.state === "in_progress" &&
			(record.launchGeneration === null || record.launchExpiresAt !== null)) ||
		(record.phase === "running" && record.state !== "in_progress") ||
		(record.phase === "terminal" &&
			!(["closed", "repair_needed", "unknown"] as const).includes(
				record.state as never,
			))
	) {
		throw new Error("task state invalid");
	}
	return Object.freeze({
		schemaVersion: 2,
		taskId: record.taskId,
		receiptId: record.receiptId,
		transactionId: record.transactionId,
		leaseGeneration: record.leaseGeneration,
		revision: record.revision,
		attemptNumber: record.attemptNumber as number,
		state: record.state as VaultGitTaskState["state"],
		phase: record.phase as VaultGitTaskState["phase"],
		recordedAt: record.recordedAt,
		updatedAt: record.updatedAt,
		heartbeatAt: record.heartbeatAt as string | null,
		checkpoint: record.checkpoint as VaultGitTaskState["checkpoint"],
		launchGeneration: record.launchGeneration as string | null,
		launchExpiresAt: record.launchExpiresAt as string | null,
		workerPid: record.workerPid as number | null,
		workerProcessIdentity: record.workerProcessIdentity as string | null,
		launchAttempt: record.launchAttempt as number,
		terminalResult:
			record.terminalResult as VaultGitTaskTerminalResult | null,
		previousTerminalResult:
			record.previousTerminalResult as VaultGitTaskTerminalResult | null,
		repairReentryBlocked: record.repairReentryBlocked,
		repairAuthorization:
			record.repairAuthorization as VaultGitTaskRepairAuthorization | null,
	});
}

function isTaskRepairAuthorization(value: unknown): boolean {
	if (value === null) return true;
	if (typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		Object.keys(record).length === 7 &&
		record.schemaVersion === 1 &&
		record.action === "resume" &&
		typeof record.failedAttemptNumber === "number" &&
		Number.isSafeInteger(record.failedAttemptNumber) &&
		record.failedAttemptNumber >= 1 &&
		typeof record.failedTaskRevision === "number" &&
		Number.isSafeInteger(record.failedTaskRevision) &&
		record.failedTaskRevision >= 1 &&
		typeof record.repairedReceiptRevision === "number" &&
		Number.isSafeInteger(record.repairedReceiptRevision) &&
		record.repairedReceiptRevision >= 1 &&
		typeof record.bindingDigest === "string" &&
		/^[0-9a-f]{64}$/u.test(record.bindingDigest) &&
		typeof record.authorizedAt === "string" &&
		isExactIsoTimestamp(record.authorizedAt)
	);
}

function isTaskTerminalResult(value: unknown): boolean {
	if (value === null) return true;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		Object.keys(record).length === 5 &&
		Object.hasOwn(record, "outcome") &&
		Object.hasOwn(record, "phase") &&
		Object.hasOwn(record, "changedState") &&
		Object.hasOwn(record, "blocker") &&
		Object.hasOwn(record, "retrySafety") &&
		VAULT_GIT_RESULT_OUTCOMES.includes(record.outcome as never) &&
		VAULT_GIT_TRANSACTION_PHASES.includes(record.phase as never) &&
		VAULT_GIT_CHANGED_STATES.includes(record.changedState as never) &&
		(record.blocker === null ||
			(typeof record.blocker === "string" &&
				VAULT_GIT_BLOCKER_IDS.includes(record.blocker as never))) &&
		VAULT_GIT_RETRY_SAFETIES.includes(record.retrySafety as never)
	);
}

function isExactIsoTimestamp(value: string): boolean {
	return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
