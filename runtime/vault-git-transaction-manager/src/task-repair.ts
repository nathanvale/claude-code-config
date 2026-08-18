import type {
	VaultGitTaskRepairAuthorization,
	VaultGitTaskState,
} from "./model.ts";
import { parseVaultGitTaskState } from "./task-state.ts";

/** Exact repaired-receipt evidence needed to authorize one new attempt. */
export interface VaultGitTaskRepairAuthorizationInput {
	readonly repairedReceiptRevision: number;
	readonly bindingDigest: string;
	readonly recordedAt: string;
}

/** Add one exact single-use repair authorization to a known failed attempt. */
export function authorizeVaultGitTaskRepair(
	previous: VaultGitTaskState,
	input: VaultGitTaskRepairAuthorizationInput,
): VaultGitTaskState {
	if (
		previous.state !== "repair_needed" ||
		previous.phase !== "terminal" ||
		previous.repairReentryBlocked ||
		previous.repairAuthorization !== null ||
		previous.receiptRevision === null ||
		!Number.isSafeInteger(input.repairedReceiptRevision) ||
		input.repairedReceiptRevision <= previous.receiptRevision ||
		!/^[0-9a-f]{64}$/u.test(input.bindingDigest) ||
		!isExactIsoTimestamp(input.recordedAt) ||
		Date.parse(input.recordedAt) < Date.parse(previous.updatedAt)
	) throw new Error("task repair authorization invalid");
	const repairAuthorization: VaultGitTaskRepairAuthorization = Object.freeze({
		schemaVersion: 1,
		action: "resume",
		failedAttemptNumber: previous.attemptNumber,
		failedTaskRevision: previous.revision,
		repairedReceiptRevision: input.repairedReceiptRevision,
		bindingDigest: input.bindingDigest,
		authorizedAt: input.recordedAt,
	});
	return parseVaultGitTaskState({
		...previous,
		revision: previous.revision + 1,
		updatedAt: input.recordedAt,
		repairAuthorization,
	});
}

/** Consume one exact repair authorization and admit the next semantic attempt. */
export function consumeVaultGitTaskRepairAuthorization(
	previous: VaultGitTaskState,
	input: { readonly repairedReceiptRevision: number; readonly recordedAt: string },
): VaultGitTaskState {
	const authorization = previous.repairAuthorization;
	if (
		previous.state !== "repair_needed" ||
		previous.phase !== "terminal" ||
		previous.repairReentryBlocked ||
		authorization === null ||
		authorization.failedAttemptNumber !== previous.attemptNumber ||
		authorization.failedTaskRevision >= previous.revision ||
		authorization.repairedReceiptRevision !== input.repairedReceiptRevision ||
		!isExactIsoTimestamp(input.recordedAt) ||
		Date.parse(input.recordedAt) < Date.parse(previous.updatedAt)
	) throw new Error("task repair authorization mismatch");
	return parseVaultGitTaskState({
		...previous,
		revision: previous.revision + 1,
		receiptRevision: input.repairedReceiptRevision,
		attemptNumber: previous.attemptNumber + 1,
		state: "claimed",
		phase: "admitted",
		updatedAt: input.recordedAt,
		heartbeatAt: null,
		checkpoint: null,
		launchGeneration: null,
		launchExpiresAt: null,
		workerPid: null,
		workerProcessIdentity: null,
		launchAttempt: 0,
		terminalResult: null,
		previousTerminalResult: previous.terminalResult,
		repairReentryBlocked: previous.repairReentryBlocked,
		repairAuthorization: null,
	});
}

function isExactIsoTimestamp(value: string): boolean {
	return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
