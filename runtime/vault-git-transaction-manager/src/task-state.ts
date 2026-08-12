import { createHash } from "node:crypto";

import {
	VAULT_GIT_TASK_PHASES,
	type VaultGitTaskState,
	type VaultGitTaskStateInput,
} from "./model.ts";

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
 *   recordedAt: "2026-08-12T11:30:00.000Z",
 * })
 * ```
 */
export function createVaultGitTaskState(
	input: VaultGitTaskStateInput,
): VaultGitTaskState {
	return parseVaultGitTaskState({
		schemaVersion: 1,
		taskId: input.taskId,
		receiptId: input.receiptId,
		revision: 1,
		phase: "admitted",
		recordedAt: input.recordedAt,
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
	const expectedKeys = [
		"schemaVersion",
		"taskId",
		"receiptId",
		"revision",
		"phase",
		"recordedAt",
		"bindingDigest",
	] as const;
	if (
		Object.keys(record).length !== expectedKeys.length ||
		!expectedKeys.every((key) => Object.hasOwn(record, key)) ||
		typeof record.bindingDigest !== "string" ||
		!/^[0-9a-f]{64}$/.test(record.bindingDigest)
	) {
		throw new Error("task claim invalid");
	}
	const state = parseVaultGitTaskState({
		schemaVersion: record.schemaVersion,
		taskId: record.taskId,
		receiptId: record.receiptId,
		revision: record.revision,
		phase: record.phase,
		recordedAt: record.recordedAt,
	});
	return Object.freeze({ ...state, bindingDigest: record.bindingDigest });
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
	const expectedKeys = [
		"schemaVersion",
		"taskId",
		"receiptId",
		"revision",
		"phase",
		"recordedAt",
	] as const;
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value)
	) {
		throw new Error("task state invalid");
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).length !== expectedKeys.length ||
		!expectedKeys.every((key) => Object.hasOwn(record, key)) ||
		record.schemaVersion !== 1 ||
		typeof record.taskId !== "string" ||
		!/^task_[0-9a-f]{32}$/.test(record.taskId) ||
		typeof record.receiptId !== "string" ||
		!/^receipt_[0-9a-f]{32}$/.test(record.receiptId) ||
		record.revision !== 1 ||
		!VAULT_GIT_TASK_PHASES.includes(record.phase as never) ||
		typeof record.recordedAt !== "string" ||
		Number.isNaN(Date.parse(record.recordedAt)) ||
		new Date(record.recordedAt).toISOString() !== record.recordedAt
	) {
		throw new Error("task state invalid");
	}
	return Object.freeze({
		schemaVersion: 1,
		taskId: record.taskId,
		receiptId: record.receiptId,
		revision: 1,
		phase: "admitted",
		recordedAt: record.recordedAt,
	});
}
