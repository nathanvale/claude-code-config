import { createHash } from "node:crypto";

import {
	VAULT_GIT_BLOCKER_IDS,
	VAULT_GIT_DOCTOR_FINDINGS,
	VAULT_GIT_DOCTOR_PUBLICATION_EVIDENCE,
	VAULT_GIT_DOCTOR_RESIDUE_EVIDENCE,
	VAULT_GIT_DOCTOR_SETUP_EVIDENCE,
	VAULT_GIT_ENGINE_NEXT_ACTION_IDS,
	VAULT_GIT_REPAIR_ACTIONS,
	VAULT_GIT_RETRY_SAFETIES,
	VAULT_GIT_TRANSACTION_PHASES,
	VAULT_GIT_TRANSACTION_STATES,
	type VaultGitDoctorFinding,
	type VaultGitDoctorResidueEvidence,
	type VaultGitDoctorSetupEvidence,
	type VaultGitDoctorTaskCheckpoint,
	type VaultGitDoctorTaskObservationExpired,
	type VaultGitDoctorTaskTerminal,
	type VaultGitDoctorTaskTerminalResult,
	type VaultGitDoctorTaskWorkerFailure,
	type VaultGitEngineNextActionId,
	type VaultGitRetrySafety,
	type VaultGitTransactionPhase,
	type VaultGitTransactionState,
} from "./model.ts";
import { VAULT_GIT_NEXT_SAFE_ACTION_IDS } from "./next-safe-action.ts";

export type {
	VaultGitDoctorTaskCheckpoint,
	VaultGitDoctorTaskObservationExpired,
	VaultGitDoctorTaskTerminal,
	VaultGitDoctorTaskTerminalResult,
	VaultGitDoctorTaskWorkerFailure,
} from "./model.ts";

/** Invalid durable routing evidence, distinct from generic task corruption. @internal */
export class VaultGitDoctorTaskInvalidRouteError extends Error {
	constructor() {
		super("doctor task durable route invalid");
		this.name = "VaultGitDoctorTaskInvalidRouteError";
	}
}

/** Closed durable lifecycle vocabulary for one Doctor Task. */
export const VAULT_GIT_DOCTOR_TASK_STATES = [
	"claimed",
	"launching",
	"in_progress",
	"closed",
	"unknown",
] as const;

/** One durable Doctor Task lifecycle state. */
export type VaultGitDoctorTaskLifecycleState =
	(typeof VAULT_GIT_DOCTOR_TASK_STATES)[number];

/** One durable Doctor Task phase. */
export type VaultGitDoctorTaskPhase = "admitted" | "running" | "terminal";

/** Immutable receipt, transaction, activation, and invocation claim inputs. */
export interface VaultGitDoctorTaskBindingInput {
	readonly repositoryId: string;
	readonly activationEvidenceId: string | null;
	readonly receiptId: string | null;
	readonly receiptRevision: number | null;
	readonly transactionId: string | null;
	readonly normalizedInput: string;
}

/** Capability-free durable state for one admitted Doctor Task. */
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

/** Mutable fields accepted by one monotonic Doctor Task transition. */
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

const DOCTOR_TERMINAL_REQUIRED_KEYS = [
	"kind",
	"status",
	"state",
	"phase",
	"finding",
	"changedState",
	"retrySafety",
] as const;

const DOCTOR_TERMINAL_KEYS = [
	...DOCTOR_TERMINAL_REQUIRED_KEYS,
	// Exactly one next-action carrier: the new durable semantic id, or the legacy
	// { id, summary } object read without rewrite.
	"nextActionId",
	"nextAction",
	"blocker",
	"repairAction",
	"transactionId",
	"validationEvidence",
	"publicationEvidence",
] as const;

const WORKER_FAILURE_KEYS = [
	"kind",
	"blocker",
	"retrySafety",
	"nextAction",
] as const;

const OBSERVATION_EXPIRED_KEYS = ["kind", "blocker", "retrySafety"] as const;

const NEXT_ACTION_KEYS = ["id", "summary"] as const;

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
	if (isWorkerFailureTerminal(value)) {
		return Object.freeze(
			value as unknown as VaultGitDoctorTaskWorkerFailure,
		);
	}
	if (isObservationExpiredTerminal(value)) {
		return Object.freeze(
			value as unknown as VaultGitDoctorTaskObservationExpired,
		);
	}
	// Guard record-ness before any Object.hasOwn / property read, so a malformed
	// null or scalar fails closed with the domain error, not a raw TypeError.
	if (!isRecord(value)) {
		throw new Error("doctor task terminal result invalid");
	}
	if (hasInvalidDoctorRouteEvidence(value)) {
		throw new VaultGitDoctorTaskInvalidRouteError();
	}
	if (!isDoctorResultTerminal(value)) {
		throw new Error("doctor task terminal result invalid");
	}
	return Object.freeze(
		value as unknown as VaultGitDoctorTaskTerminalResult,
	);
}

function hasInvalidDoctorRouteEvidence(
	value: Record<string, unknown>,
): boolean {
	if (value.kind !== "doctor_result") return false;
	return (
		hasInvalidDoctorActionRoute(value) ||
		hasInvalidDoctorEvidenceRoute(value) ||
		hasInvalidDoctorSelectorRoute(value)
	);
}

function hasInvalidDoctorActionRoute(value: Record<string, unknown>): boolean {
	const hasSemantic = Object.hasOwn(value, "nextActionId");
	const hasLegacy = Object.hasOwn(value, "nextAction");
	if (hasSemantic === hasLegacy) return true;
	if (hasSemantic) {
		return (
			typeof value.nextActionId !== "string" ||
			(!VAULT_GIT_NEXT_SAFE_ACTION_IDS.includes(value.nextActionId) &&
				!VAULT_GIT_ENGINE_NEXT_ACTION_IDS.includes(
					value.nextActionId as VaultGitEngineNextActionId,
				))
		);
	}
	if (!isRecord(value.nextAction) || typeof value.nextAction.id !== "string") {
		return false;
	}
	return !VAULT_GIT_ENGINE_NEXT_ACTION_IDS.includes(
		value.nextAction.id as VaultGitEngineNextActionId,
	);
}

function hasInvalidDoctorEvidenceRoute(
	value: Record<string, unknown>,
): boolean {
	if (
		Object.hasOwn(value, "validationEvidence") &&
		Object.hasOwn(value, "publicationEvidence")
	) {
		return true;
	}
	if (
		Object.hasOwn(value, "validationEvidence") &&
		!isValidationRouteEvidence(value.validationEvidence)
	) {
		return true;
	}
	if (
		Object.hasOwn(value, "publicationEvidence") &&
		!isOptionalCatalogValue(
			value.publicationEvidence,
			VAULT_GIT_DOCTOR_PUBLICATION_EVIDENCE,
		)
	) {
		return true;
	}
	return (
		Object.hasOwn(value, "repairAction") &&
		!isOptionalCatalogValue(value.repairAction, VAULT_GIT_REPAIR_ACTIONS)
	);
}

function hasInvalidDoctorSelectorRoute(
	value: Record<string, unknown>,
): boolean {
	return (
		Object.hasOwn(value, "transactionId") &&
		!isOptionalTransactionId(value.transactionId)
	);
}

function isObservationExpiredTerminal(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return [
		hasExactKeys(value, OBSERVATION_EXPIRED_KEYS),
		value.kind === "observation_expired",
		// The blocker and retry safety are fixed, not free vocabulary: the public
		// projection is derived from the kind alone, never from a persisted carrier.
		value.blocker === "continuation_unavailable",
		value.retrySafety === "operator_required",
	].every(Boolean);
}

function isWorkerFailureTerminal(value: unknown): boolean {
	if (!isRecord(value) || !isRecord(value.nextAction)) return false;
	return [
		hasExactKeys(value, WORKER_FAILURE_KEYS) &&
			value.kind === "worker_failure",
		value.blocker === "worker_launch_protocol_failed" || value.blocker === "worker_lost",
		value.retrySafety === "operator_required",
		hasExactKeys(value.nextAction, NEXT_ACTION_KEYS),
		value.nextAction.id === "inspect_private_receipt",
		typeof value.nextAction.summary === "string",
		typeof value.nextAction.summary === "string" &&
			value.nextAction.summary.trim().length > 0,
	].every(Boolean);
}

function hasValidDoctorActionCarrier(value: Record<string, unknown>): boolean {
	const hasSemantic = Object.hasOwn(value, "nextActionId");
	const hasLegacy = Object.hasOwn(value, "nextAction");
	if (hasSemantic === hasLegacy) return false;
	if (hasSemantic) {
		return (
			typeof value.nextActionId === "string" &&
			(VAULT_GIT_NEXT_SAFE_ACTION_IDS.includes(value.nextActionId) ||
				VAULT_GIT_ENGINE_NEXT_ACTION_IDS.includes(
					value.nextActionId as VaultGitEngineNextActionId,
				))
		);
	}
	return (
		isRecord(value.nextAction) &&
		hasExactKeys(value.nextAction, NEXT_ACTION_KEYS) &&
		VAULT_GIT_ENGINE_NEXT_ACTION_IDS.includes(
			value.nextAction.id as VaultGitEngineNextActionId,
		) &&
		typeof value.nextAction.summary === "string" &&
		value.nextAction.summary.trim().length > 0
	);
}

function hasValidDoctorRequiredFields(value: Record<string, unknown>): boolean {
	return [
		DOCTOR_TERMINAL_REQUIRED_KEYS.every((key) => Object.hasOwn(value, key)),
		value.kind === "doctor_result",
		value.status === "diagnosed",
		VAULT_GIT_TRANSACTION_STATES.includes(value.state as VaultGitTransactionState),
		VAULT_GIT_TRANSACTION_PHASES.includes(value.phase as VaultGitTransactionPhase),
		VAULT_GIT_DOCTOR_FINDINGS.includes(value.finding as VaultGitDoctorFinding),
		value.changedState === "none" || value.changedState === "local",
		VAULT_GIT_RETRY_SAFETIES.includes(value.retrySafety as VaultGitRetrySafety),
	].every(Boolean);
}

function hasValidDoctorOptionalFields(value: Record<string, unknown>): boolean {
	return [
		isOptionalCatalogValue(value.blocker, VAULT_GIT_BLOCKER_IDS),
		isOptionalCatalogValue(value.repairAction, VAULT_GIT_REPAIR_ACTIONS),
		isOptionalTransactionId(value.transactionId),
		isOptionalValidationEvidence(value.validationEvidence),
		isOptionalCatalogValue(
			value.publicationEvidence,
			VAULT_GIT_DOCTOR_PUBLICATION_EVIDENCE,
		),
		value.validationEvidence === undefined || value.publicationEvidence === undefined,
	].every(Boolean);
}

function isOptionalCatalogValue(
	value: unknown,
	catalog: readonly string[],
): boolean {
	return value === undefined || (typeof value === "string" && catalog.includes(value));
}

function isOptionalTransactionId(value: unknown): boolean {
	return (
		value === undefined ||
		(typeof value === "string" && /^txn_[0-9a-f]{32}$/u.test(value))
	);
}

function isOptionalValidationEvidence(value: unknown): boolean {
	return value === undefined || isValidationRouteEvidence(value);
}

function isDoctorResultTerminal(value: Record<string, unknown>): boolean {
	return (
		hasOnlyKeys(value, DOCTOR_TERMINAL_KEYS) &&
		hasValidDoctorRequiredFields(value) &&
		hasValidDoctorActionCarrier(value) &&
		hasValidDoctorOptionalFields(value)
	);
}

/**
 * Exact-shape validation for the closed U4 validation-route evidence. Every arm
 * admits only its own keys and vocabulary; an unknown class, stage, sub-evidence,
 * or missing per-row discriminator fails closed as a corrupt record; no default
 * is ever invented for durable evidence.
 */
function isValidationRouteEvidence(value: unknown): boolean {
	if (!isRecord(value) || typeof value.failureClass !== "string") return false;
	switch (value.failureClass) {
		case "candidate_setup":
			return isSetupRouteEvidence(value);
		case "vault_content":
			return isContentRouteEvidence(value);
		case "stage_budget_exceeded":
			return isBudgetRouteEvidence(value);
		case "candidate_cleanup":
			return isResidueRouteEvidence(value, ["failureClass"]);
		default:
			return false;
	}
}

function isSetupRouteEvidence(value: Record<string, unknown>): boolean {
	return (
		hasExactKeys(value, ["failureClass", "setup"]) &&
		typeof value.setup === "string" &&
		VAULT_GIT_DOCTOR_SETUP_EVIDENCE.includes(
			value.setup as VaultGitDoctorSetupEvidence,
		)
	);
}

function isContentRouteEvidence(value: Record<string, unknown>): boolean {
	if (value.content !== "deterministic_with_admitted_repair") {
		return [
			hasExactKeys(value, ["failureClass", "content"]) &&
				value.content === "insufficient",
		].every(Boolean);
	}
	return [
		hasExactKeys(value, ["failureClass", "content", "repairId"]) &&
			typeof value.repairId === "string",
		typeof value.repairId === "string" &&
			/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(value.repairId),
	].every(Boolean);
}

function isBudgetRouteEvidence(value: Record<string, unknown>): boolean {
	if (value.stage === "candidate_setup" || value.stage === "vault_check") {
		return hasExactKeys(value, ["failureClass", "stage"]);
	}
	return (
		value.stage === "candidate_cleanup" &&
		isResidueRouteEvidence(value, ["failureClass", "stage"])
	);
}

function isResidueRouteEvidence(
	value: Record<string, unknown>,
	extraKeys: readonly string[],
): boolean {
	if (
		typeof value.residue !== "string" ||
		!VAULT_GIT_DOCTOR_RESIDUE_EVIDENCE.includes(
			value.residue as VaultGitDoctorResidueEvidence,
		)
	) {
		return false;
	}
	if (value.residue === "active_owned") {
		return (
			hasExactKeys(value, [...extraKeys, "residue", "taskId"]) &&
			typeof value.taskId === "string" &&
			/^task_[0-9a-f]{32}$/u.test(value.taskId)
		);
	}
	if (value.residue === "young_proven_unowned") {
		return (
			hasExactKeys(value, [...extraKeys, "residue", "eligibleAfter"]) &&
			isTimestamp(value.eligibleAfter)
		);
	}
	return hasExactKeys(value, [...extraKeys, "residue"]);
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

function hasOnlyKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
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
