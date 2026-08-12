import {
	VAULT_GIT_TASK_PHASES,
	type VaultGitTaskState,
	type VaultGitTaskStateInput,
} from "./model.ts";

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
