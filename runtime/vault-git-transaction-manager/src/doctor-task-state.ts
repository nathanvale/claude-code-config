import { createHash } from "node:crypto";

import type { VaultGitDoctorResult } from "./doctor.ts";

export const VAULT_GIT_DOCTOR_TASK_STATES = [
	"claimed",
	"launching",
	"in_progress",
	"closed",
	"unknown",
] as const;

export type VaultGitDoctorTaskLifecycleState =
	(typeof VAULT_GIT_DOCTOR_TASK_STATES)[number];

export type VaultGitDoctorTaskPhase = "admitted" | "running" | "terminal";

export type VaultGitDoctorTaskCheckpoint =
	| "local_classified"
	| "checking_remote"
	| "terminal";

export interface VaultGitDoctorTaskTerminalResult {
	readonly kind: "doctor_result";
	readonly status: VaultGitDoctorResult["status"];
	readonly state: VaultGitDoctorResult["state"];
	readonly phase: VaultGitDoctorResult["phase"];
	readonly finding: VaultGitDoctorResult["finding"];
	readonly changedState: VaultGitDoctorResult["changedState"];
	readonly retrySafety: VaultGitDoctorResult["retrySafety"];
	readonly nextAction: VaultGitDoctorResult["nextAction"];
	readonly blocker?: VaultGitDoctorResult["blocker"];
	readonly repairAction?: VaultGitDoctorResult["repairAction"];
	readonly transactionId?: string;
}

export interface VaultGitDoctorTaskWorkerFailure {
	readonly kind: "worker_failure";
	readonly blocker: "worker_launch_protocol_failed" | "worker_lost";
	readonly retrySafety: "operator_required";
	readonly nextAction: {
		readonly id: "inspect_private_receipt";
		readonly summary: string;
	};
}

export type VaultGitDoctorTaskTerminal =
	| VaultGitDoctorTaskTerminalResult
	| VaultGitDoctorTaskWorkerFailure;

export interface VaultGitDoctorTaskBindingInput {
	readonly repositoryId: string;
	readonly activationEvidenceId: string | null;
	readonly receiptId: string | null;
	readonly receiptRevision: number | null;
	readonly transactionId: string | null;
	readonly normalizedInput: string;
}

export interface VaultGitDoctorTaskState {
	readonly schemaVersion: 1;
	readonly taskId: string;
	readonly bindingDigest: string;
	readonly receiptId: string | null;
	readonly receiptRevision: number | null;
	readonly transactionId: string | null;
	readonly revision: number;
	readonly state: VaultGitDoctorTaskLifecycleState;
	readonly phase: VaultGitDoctorTaskPhase;
	readonly recordedAt: string;
	readonly updatedAt: string;
	readonly heartbeatAt: string | null;
	readonly checkpoint: VaultGitDoctorTaskCheckpoint | null;
	readonly launchGeneration: string | null;
	readonly launchExpiresAt: string | null;
	readonly workerPid: number | null;
	readonly workerProcessIdentity: string | null;
	readonly launchAttempt: number;
	readonly terminalResult: VaultGitDoctorTaskTerminal | null;
}

export type VaultGitDoctorTaskAdvanceInput = Omit<
	VaultGitDoctorTaskState,
	| "schemaVersion"
	| "taskId"
	| "bindingDigest"
	| "receiptId"
	| "receiptRevision"
	| "transactionId"
	| "revision"
	| "recordedAt"
>;

const STATE_KEYS = [
	"schemaVersion",
	"taskId",
	"bindingDigest",
	"receiptId",
	"receiptRevision",
	"transactionId",
	"revision",
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
] as const;

export function digestVaultGitDoctorTaskBinding(
	input: VaultGitDoctorTaskBindingInput,
): string {
	if (
		!isDigest(input.repositoryId) ||
		(input.activationEvidenceId !== null &&
			!/^vault-git:prepared:v2:[0-9a-f]{64}$/u.test(input.activationEvidenceId)) ||
		(input.receiptId !== null && !/^receipt_[0-9a-f]{32}$/u.test(input.receiptId)) ||
		(input.receiptRevision !== null &&
			(!Number.isSafeInteger(input.receiptRevision) || input.receiptRevision < 1)) ||
		(input.transactionId !== null &&
			!/^txn_[0-9a-f]{32}$/u.test(input.transactionId)) ||
		input.normalizedInput.length === 0
	) {
		throw new Error("doctor task binding invalid");
	}
	return createHash("sha256")
		.update(
			JSON.stringify({
				repositoryId: input.repositoryId,
				activationEvidenceId: input.activationEvidenceId,
				receiptId: input.receiptId,
				receiptRevision: input.receiptRevision,
				transactionId: input.transactionId,
				normalizedInput: input.normalizedInput,
			}),
		)
		.digest("hex");
}

export function digestVaultGitDoctorTaskClaimSlot(
	input: VaultGitDoctorTaskBindingInput,
): string {
	digestVaultGitDoctorTaskBinding(input);
	return createHash("sha256")
		.update(
			JSON.stringify({
				repositoryId: input.repositoryId,
				receiptId: input.receiptId,
				receiptRevision: input.receiptRevision,
			}),
		)
		.digest("hex");
}

export function createVaultGitDoctorTaskState(input: {
	readonly taskId: string;
	readonly binding: VaultGitDoctorTaskBindingInput;
	readonly recordedAt: string;
}): VaultGitDoctorTaskState {
	return parseVaultGitDoctorTaskState({
		schemaVersion: 1,
		taskId: input.taskId,
		bindingDigest: digestVaultGitDoctorTaskBinding(input.binding),
		receiptId: input.binding.receiptId,
		receiptRevision: input.binding.receiptRevision,
		transactionId: input.binding.transactionId,
		revision: 1,
		state: "claimed",
		phase: "admitted",
		recordedAt: input.recordedAt,
		updatedAt: input.recordedAt,
		heartbeatAt: null,
		checkpoint: "local_classified",
		launchGeneration: null,
		launchExpiresAt: null,
		workerPid: null,
		workerProcessIdentity: null,
		launchAttempt: 0,
		terminalResult: null,
	});
}

export function advanceVaultGitDoctorTaskState(
	previous: VaultGitDoctorTaskState,
	input: VaultGitDoctorTaskAdvanceInput,
): VaultGitDoctorTaskState {
	if (
		previous.phase === "terminal" ||
		Date.parse(input.updatedAt) < Date.parse(previous.updatedAt) ||
		input.launchAttempt < previous.launchAttempt ||
		(input.phase === "terminal") !== (input.terminalResult !== null) ||
		(input.phase === "admitted" &&
			input.state !== "claimed" &&
			input.state !== "launching") ||
		(input.phase === "running" && input.state !== "in_progress") ||
		(input.phase === "terminal" &&
			input.state !== "closed" &&
			input.state !== "unknown")
	) {
		throw new Error("doctor task transition invalid");
	}
	return parseVaultGitDoctorTaskState({
		...previous,
		...input,
		revision: previous.revision + 1,
	});
}

export function isVaultGitDoctorTaskWorkerLost(
	state: VaultGitDoctorTaskState,
	nowMs: number,
	staleAfterMs: number,
	processIdentityAlive: (pid: number, identity: string) => boolean,
): boolean {
	return (
		state.state === "in_progress" &&
		state.heartbeatAt !== null &&
		nowMs - Date.parse(state.heartbeatAt) > staleAfterMs &&
		state.workerPid !== null &&
		state.workerProcessIdentity !== null &&
		!processIdentityAlive(state.workerPid, state.workerProcessIdentity)
	);
}

export function parseVaultGitDoctorTaskState(
	value: unknown,
): VaultGitDoctorTaskState {
	if (!isRecord(value) || !hasExactKeys(value, STATE_KEYS)) {
		throw new Error("doctor task state malformed");
	}
	if (
		value.schemaVersion !== 1 ||
		typeof value.taskId !== "string" ||
		!/^doctor_task_[0-9a-f]{32}$/u.test(value.taskId) ||
		typeof value.bindingDigest !== "string" ||
		!isDigest(value.bindingDigest) ||
		(value.receiptId !== null &&
			(typeof value.receiptId !== "string" ||
				!/^receipt_[0-9a-f]{32}$/u.test(value.receiptId))) ||
		(value.receiptRevision !== null &&
			(typeof value.receiptRevision !== "number" ||
				!Number.isSafeInteger(value.receiptRevision) ||
				value.receiptRevision < 1)) ||
		(value.transactionId !== null &&
			(typeof value.transactionId !== "string" ||
				!/^txn_[0-9a-f]{32}$/u.test(value.transactionId))) ||
		typeof value.revision !== "number" ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 1 ||
		!VAULT_GIT_DOCTOR_TASK_STATES.includes(
			value.state as VaultGitDoctorTaskLifecycleState,
		) ||
		!["admitted", "running", "terminal"].includes(String(value.phase)) ||
		!isTimestamp(value.recordedAt) ||
		!isTimestamp(value.updatedAt) ||
		(value.heartbeatAt !== null && !isTimestamp(value.heartbeatAt)) ||
		(value.checkpoint !== null &&
			!["local_classified", "checking_remote", "terminal"].includes(
				String(value.checkpoint),
			)) ||
		(value.launchGeneration !== null &&
			(typeof value.launchGeneration !== "string" ||
				!/^doctor_launch_[0-9a-f]{32}$/u.test(value.launchGeneration))) ||
		(value.launchExpiresAt !== null && !isTimestamp(value.launchExpiresAt)) ||
		(value.workerPid !== null &&
			(typeof value.workerPid !== "number" ||
				!Number.isSafeInteger(value.workerPid) ||
				value.workerPid < 1)) ||
		(value.workerProcessIdentity !== null &&
			(typeof value.workerProcessIdentity !== "string" ||
				!isDigest(value.workerProcessIdentity))) ||
		(value.workerPid === null) !== (value.workerProcessIdentity === null) ||
		typeof value.launchAttempt !== "number" ||
		!Number.isSafeInteger(value.launchAttempt) ||
		value.launchAttempt < 0 ||
		(value.phase === "terminal") !== (value.terminalResult !== null)
	) {
		throw new Error("doctor task state invalid");
	}
	return Object.freeze({
		...(value as unknown as VaultGitDoctorTaskState),
		terminalResult:
			value.terminalResult === null
				? null
				: parseTerminalResult(value.terminalResult),
	});
}

function parseTerminalResult(value: unknown): VaultGitDoctorTaskTerminal {
	if (
		isRecord(value) &&
		value.kind === "worker_failure" &&
		(value.blocker === "worker_launch_protocol_failed" ||
			value.blocker === "worker_lost") &&
		value.retrySafety === "operator_required" &&
		isRecord(value.nextAction) &&
		value.nextAction.id === "inspect_private_receipt" &&
		typeof value.nextAction.summary === "string" &&
		Object.keys(value).length === 4
	) {
		return Object.freeze(
			value as unknown as VaultGitDoctorTaskWorkerFailure,
		);
	}
	if (
		!isRecord(value) ||
		value.kind !== "doctor_result" ||
		typeof value.status !== "string" ||
		typeof value.state !== "string" ||
		typeof value.phase !== "string" ||
		typeof value.finding !== "string" ||
		typeof value.changedState !== "string" ||
		typeof value.retrySafety !== "string" ||
		!isRecord(value.nextAction) ||
		typeof value.nextAction.id !== "string" ||
		typeof value.nextAction.summary !== "string" ||
		(value.blocker !== undefined && typeof value.blocker !== "string") ||
		(value.repairAction !== undefined && typeof value.repairAction !== "string") ||
		(value.transactionId !== undefined &&
			(typeof value.transactionId !== "string" ||
				!/^txn_[0-9a-f]{32}$/u.test(value.transactionId)))
	) {
		throw new Error("doctor task terminal result invalid");
	}
	return Object.freeze(
		value as unknown as VaultGitDoctorTaskTerminalResult,
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	return (
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}

function isTimestamp(value: unknown): value is string {
	return (
		typeof value === "string" &&
		Number.isFinite(Date.parse(value)) &&
		new Date(value).toISOString() === value
	);
}

function isDigest(value: string): boolean {
	return /^[0-9a-f]{64}$/u.test(value);
}
