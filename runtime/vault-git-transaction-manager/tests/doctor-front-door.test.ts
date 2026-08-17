import { readFile, readdir, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
	createVaultGitDoctorFrontDoor,
	type VaultGitBackgroundDoctorRuntime,
} from "../src/doctor-front-door.ts";
import { createVaultGitDoctorTaskLifecycle } from "../src/doctor-task-lifecycle.ts";
import { createVaultGitDoctorTaskStore } from "../src/doctor-task-store.ts";
import type {
	VaultGitDoctorPublicationEvidence,
	VaultGitDoctorValidationRouteEvidence,
	VaultGitReceipt,
} from "../src/model.ts";
import { createReceiptStore } from "../src/store.ts";

/**
 * Deep Doctor seam (ADR-0002 U4, Stale-Lease Takeover table row 2): a terminal
 * Doctor Task whose durable terminal carries the burned/missing-Takeover-Token
 * evidence (finding lease_expired, no repair action, persisted run_doctor
 * carrier) must publicly continue to reattest_stale_lease_takeover: needs_human,
 * external owner vault_git_operator, condition stale_lease_takeover_reattested;
 * and a terminal Doctor Task never projects run_doctor. Both durable carriers
 * exist in the wild: the legacy { id, summary } object and the new-write
 * semantic nextActionId. Real owner: createVaultGitDoctorFrontDoor over the real
 * doctor task store. Independent oracle: the ADR table literals plus raw fs
 * reads of the persisted history, never the writer response.
 */

const roots: string[] = [];
const REPO_ID = "a".repeat(64);
const TXN_ID = `txn_${"c".repeat(32)}`;
const LAUNCH_GENERATION = `doctor_launch_${"9".repeat(32)}`;

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

function deterministicRuntime(): VaultGitBackgroundDoctorRuntime<null> {
	return {
		now: () => 0,
		recordedAt: () => new Date("2026-08-14T02:00:00.000Z"),
		sleep: async () => {},
		spawnWorker: () => {
			throw new Error("terminal inspection must not spawn a worker");
		},
		readProcessIdentity: () => {
			throw new Error("terminal inspection must not read process identity");
		},
		stopUnacknowledgedWorker: () => {},
		stopExpiredWorker: async () => true,
		processIdentityMatches: () => false,
	};
}

async function seedBurnedTokenTerminalTask(
	stateRoot: string,
	carrier:
		| { readonly nextAction: { readonly id: "run_doctor"; readonly summary: string } }
		| { readonly nextActionId: "run_doctor" },
): Promise<string> {
	const taskStore = createVaultGitDoctorTaskStore({
		stateRoot,
		repositoryId: REPO_ID,
	});
	const admitted = await taskStore.claimOrJoin(
		{
			repositoryId: REPO_ID,
			activationEvidenceId: null,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: TXN_ID,
			normalizedInput: '{"command":"doctor","transactionId":null}',
		},
		"2026-08-14T01:00:00.000Z",
	);
	if (admitted.launch === "refused") throw new Error("seed claim refused");
	const taskId = admitted.state.taskId;
	const running = await taskStore.transition(taskId, admitted.state.revision, {
		state: "in_progress",
		phase: "running",
		updatedAt: "2026-08-14T01:00:01.000Z",
		heartbeatAt: "2026-08-14T01:00:01.000Z",
		checkpoint: "checking_remote",
		launchGeneration: LAUNCH_GENERATION,
		launchExpiresAt: null,
		workerPid: 42,
		workerProcessIdentity: "f".repeat(64),
		launchAttempt: 1,
		terminalResult: null,
	});
	if (running.status !== "transitioned") throw new Error("seed run failed");
	const terminalized = await taskStore.transition(taskId, running.state.revision, {
		state: "closed",
		phase: "terminal",
		updatedAt: "2026-08-14T01:00:02.000Z",
		heartbeatAt: "2026-08-14T01:00:02.000Z",
		checkpoint: "terminal",
		launchGeneration: LAUNCH_GENERATION,
		launchExpiresAt: null,
		workerPid: 42,
		workerProcessIdentity: "f".repeat(64),
		launchAttempt: 1,
		terminalResult: {
			kind: "doctor_result",
			status: "diagnosed",
			state: "expired",
			phase: "writing",
			finding: "lease_expired",
			changedState: "local",
			retrySafety: "operator_required",
			transactionId: TXN_ID,
			...carrier,
		},
	});
	if (terminalized.status !== "transitioned") throw new Error("seed terminal failed");
	return taskId;
}

function composeFrontDoor(stateRoot: string) {
	return createVaultGitDoctorFrontDoor({
		store: createReceiptStore({
			stateRoot,
			repositoryIdentity: "doctor-front-door-test",
		}),
		taskStore: createVaultGitDoctorTaskStore({
			stateRoot,
			repositoryId: REPO_ID,
		}),
		runtime: deterministicRuntime(),
		spawnContext: null,
		now: () => Date.parse("2026-08-14T02:00:00.000Z"),
	});
}

async function rawHistory(
	stateRoot: string,
	taskId: string,
): Promise<Record<string, string>> {
	const dir = join(
		stateRoot,
		"vault-git-transaction-manager",
		REPO_ID,
		"doctor-tasks",
		taskId,
		"history",
	);
	const bytes: Record<string, string> = {};
	for (const name of (await readdir(dir)).sort()) {
		bytes[name] = await readFile(join(dir, name), "utf8");
	}
	return bytes;
}

async function seedRegisteredLaunchingTask(
	stateRoot: string,
	workerPid: number,
): Promise<string> {
	const taskStore = createVaultGitDoctorTaskStore({
		stateRoot,
		repositoryId: REPO_ID,
	});
	const admitted = await taskStore.claimOrJoin(
		{
			repositoryId: REPO_ID,
			activationEvidenceId: null,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: TXN_ID,
			normalizedInput: '{"command":"doctor","transactionId":null}',
		},
		"2026-08-14T01:00:00.000Z",
	);
	if (admitted.launch === "refused") throw new Error("seed claim refused");
	const taskId = admitted.state.taskId;
	const launching = await taskStore.transition(taskId, admitted.state.revision, {
		state: "launching",
		phase: "admitted",
		updatedAt: "2026-08-14T01:00:01.000Z",
		heartbeatAt: null,
		checkpoint: "local_classified",
		launchGeneration: LAUNCH_GENERATION,
		launchExpiresAt: "2026-08-14T02:10:00.000Z",
		workerPid,
		workerProcessIdentity: "f".repeat(64),
		launchAttempt: 1,
		terminalResult: null,
	});
	if (launching.status !== "transitioned") throw new Error("seed launch failed");
	return taskId;
}

async function latestPersistedTerminal(
	stateRoot: string,
	taskId: string,
): Promise<Record<string, unknown>> {
	const bytes = await rawHistory(stateRoot, taskId);
	const names = Object.keys(bytes).sort();
	const latest = bytes[names.at(-1) as string];
	if (!latest) throw new Error("no persisted history");
	return JSON.parse(latest) as Record<string, unknown>;
}

const COMPLETION_TASK_ID = `task_${"d".repeat(32)}`;
const REPAIR_ID = "frontmatter.fix-title";

/**
 * Persist one terminal Doctor Task carrying validation-route evidence through
 * the production store writer. The persisted carrier is deliberately the
 * legacy-plausible run_repair/resume diagnosis: a projection that ignores the
 * evidence and follows the carrier emits an invoke of `repair resume`, so every
 * row test fails if the front door stops routing through the closed matrix.
 */
async function seedValidationTerminalTask(
	stateRoot: string,
	validationEvidence: VaultGitDoctorValidationRouteEvidence,
): Promise<string> {
	const taskStore = createVaultGitDoctorTaskStore({
		stateRoot,
		repositoryId: REPO_ID,
	});
	const admitted = await taskStore.claimOrJoin(
		{
			repositoryId: REPO_ID,
			activationEvidenceId: null,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: TXN_ID,
			normalizedInput: '{"command":"doctor","transactionId":null}',
		},
		"2026-08-14T01:00:00.000Z",
	);
	if (admitted.launch === "refused") throw new Error("seed claim refused");
	const taskId = admitted.state.taskId;
	const running = await taskStore.transition(taskId, admitted.state.revision, {
		state: "in_progress",
		phase: "running",
		updatedAt: "2026-08-14T01:00:01.000Z",
		heartbeatAt: "2026-08-14T01:00:01.000Z",
		checkpoint: "checking_remote",
		launchGeneration: LAUNCH_GENERATION,
		launchExpiresAt: null,
		workerPid: 42,
		workerProcessIdentity: "f".repeat(64),
		launchAttempt: 1,
		terminalResult: null,
	});
	if (running.status !== "transitioned") throw new Error("seed run failed");
	const terminalized = await taskStore.transition(taskId, running.state.revision, {
		state: "closed",
		phase: "terminal",
		updatedAt: "2026-08-14T01:00:02.000Z",
		heartbeatAt: "2026-08-14T01:00:02.000Z",
		checkpoint: "terminal",
		launchGeneration: LAUNCH_GENERATION,
		launchExpiresAt: null,
		workerPid: 42,
		workerProcessIdentity: "f".repeat(64),
		launchAttempt: 1,
		terminalResult: {
			kind: "doctor_result",
			status: "diagnosed",
			state: "repairable",
			phase: "repairable",
			finding: "deterministic_failure",
			changedState: "none",
			retrySafety: "same_input_unsafe",
			nextActionId: "run_repair",
			repairAction: "resume",
			transactionId: TXN_ID,
			validationEvidence,
		},
	});
	if (terminalized.status !== "transitioned") throw new Error("seed terminal failed");
	return taskId;
}

async function inspectValidationRoute(
	validationEvidence: VaultGitDoctorValidationRouteEvidence,
) {
	const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
	roots.push(stateRoot);
	const taskId = await seedValidationTerminalTask(stateRoot, validationEvidence);
	return composeFrontDoor(stateRoot).inspectDoctorTask({ taskId });
}

describe("vault-git U4 deep Doctor: closed validation route matrix", () => {
	test("candidate_setup proven enrollment defect routes to preview_host_enrollment_repair", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "candidate_setup",
			setup: "proven_enrollment_defect",
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "invoke",
			action_id: "preview_host_enrollment_repair",
			executable: "setup",
			argv: ["sync", "--domain", "vault-git", "--check", "--json"],
		});
		expect(projection.payload.blockers).toEqual([]);
	});

	test("candidate_setup missing private enrollment inputs routes to provide_host_enrollment_inputs", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "candidate_setup",
			setup: "missing_private_enrollment_inputs",
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_input",
			action_id: "provide_host_enrollment_inputs",
			input_contract_id: "setup.vault-git.host-enrollment",
			fields: [
				{ id: "ssh_identity_file_path", input_channel: "private_stdin" },
				{ id: "ssh_public_key_path", input_channel: "private_stdin" },
				{ id: "ssh_known_hosts_path", input_channel: "private_stdin" },
			],
		});
	});

	test("candidate_setup absent external SSH prerequisites routes to provision_repository_ssh", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "candidate_setup",
			setup: "absent_external_ssh_prerequisites",
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "provision_repository_ssh",
			handoff_kind: "external_prerequisite",
			owner: "repository_ssh_owner",
			condition: "dedicated_identity_ready",
		});
	});

	test("candidate_setup integrity defect escalates with candidate_integrity_reconciled", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "candidate_setup",
			setup: "proven_candidate_integrity_defect",
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "escalate_validation_evidence",
			owner: "vault_git_operator",
			condition: "candidate_integrity_reconciled",
		});
	});

	test("candidate_setup insufficient evidence escalates with validation_evidence_required", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "candidate_setup",
			setup: "insufficient",
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "escalate_validation_evidence",
			owner: "vault_git_operator",
			condition: "validation_evidence_required",
		});
	});

	test("vault_content deterministic with admitted repair routes the semantic apply id behind the U5 gate", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "vault_content",
			content: "deterministic_with_admitted_repair",
			repairId: REPAIR_ID,
		});
		// Semantic carrier separate from executability: the route names
		// apply_vault_content_repair while the catalog's vault_content_repair
		// feature gate (U5) keeps the projection fail-closed, so no unreal
		// command escapes before the repair surface ships.
		expect(projection.payload.next_action).toMatchObject({
			kind: "none",
			id: "apply_vault_content_repair",
			action_id: "none",
		});
		expect(projection.payload.blockers).toContain("continuation_unavailable");
		expect(projection.payload.retry_safety).toBe("operator_required");
	});

	test("vault_content without deterministic evidence escalates with deterministic_content_repair_available", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "vault_content",
			content: "insufficient",
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "escalate_validation_evidence",
			owner: "vault_git_operator",
			condition: "deterministic_content_repair_available",
		});
	});

	test("stage budget exhaustion at vault_check hands off to the performance owner with stage metadata", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "stage_budget_exceeded",
			stage: "vault_check",
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "diagnose_validation_budget",
			owner: "vault_git_performance_owner",
			condition: "validation_stage_budget_diagnosed",
		});
		const terminal = projection.payload.task_terminal_result;
		if (!terminal || !("kind" in terminal) || terminal.kind !== "doctor_result") {
			throw new Error("terminal doctor_result missing from payload");
		}
		expect(terminal.validationEvidence).toEqual({
			failureClass: "stage_budget_exceeded",
			stage: "vault_check",
		});
	});

	test("candidate_cleanup with active owner routes to inspect_completion_task", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "candidate_cleanup",
			residue: "active_owned",
			taskId: COMPLETION_TASK_ID,
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "invoke",
			id: "inspect_status",
			action_id: "inspect_completion_task",
			executable: "vault-git",
			argv: ["status", "--task-id", COMPLETION_TASK_ID, "--json"],
		});
	});

	test("candidate_cleanup with old proven-unowned residue routes to run_janitor", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "candidate_cleanup",
			residue: "old_proven_unowned",
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "invoke",
			action_id: "run_janitor",
			executable: "vault-git",
			argv: ["janitor", "--json"],
		});
	});

	test("candidate_cleanup with young residue stops at terminal none carrying eligible_after", async () => {
		const eligibleAfter = "2026-08-14T02:00:02.000Z";
		const projection = await inspectValidationRoute({
			failureClass: "candidate_cleanup",
			residue: "young_proven_unowned",
			eligibleAfter,
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "none",
			id: "none",
			action_id: "none",
		});
		// No scheduler is implied: the age gate travels as evidence for the
		// next observation only.
		expect(projection.payload.blockers).toEqual([]);
		const terminal = projection.payload.task_terminal_result;
		if (!terminal || !("kind" in terminal) || terminal.kind !== "doctor_result") {
			throw new Error("terminal doctor_result missing from payload");
		}
		expect(terminal.validationEvidence).toEqual({
			failureClass: "candidate_cleanup",
			residue: "young_proven_unowned",
			eligibleAfter,
		});
	});

	test("candidate_cleanup with absent or removed residue stops at terminal none", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "candidate_cleanup",
			residue: "absent_or_removed",
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "none",
			id: "none",
			action_id: "none",
		});
		expect(projection.payload.blockers).toEqual([]);
	});

	test("candidate_cleanup with unknown ownership escalates with validation_evidence_required", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "candidate_cleanup",
			residue: "unknown_ownership",
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "escalate_validation_evidence",
			owner: "vault_git_operator",
			condition: "validation_evidence_required",
		});
	});

	test("cleanup-stage budget exhaustion folds into the residue rows", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "stage_budget_exceeded",
			stage: "candidate_cleanup",
			residue: "old_proven_unowned",
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "invoke",
			action_id: "run_janitor",
			argv: ["janitor", "--json"],
		});
	});

	test("out-of-vocabulary persisted evidence fails closed as a corrupt record", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedValidationTerminalTask(stateRoot, {
			failureClass: "candidate_setup",
			setup: "proven_enrollment_defect",
		});
		// Corrupt the durable evidence out of vocabulary through raw bytes.
		const dir = join(
			stateRoot,
			"vault-git-transaction-manager",
			REPO_ID,
			"doctor-tasks",
			taskId,
			"history",
		);
		const names = (await readdir(dir)).sort();
		const latestName = names.at(-1) as string;
		const latestPath = join(dir, latestName);
		const state = JSON.parse(await readFile(latestPath, "utf8"));
		state.terminalResult.validationEvidence = {
			failureClass: "candidate_setup",
			setup: "bogus_evidence",
		};
		const { writeFile } = await import("node:fs/promises");
		await writeFile(latestPath, `${JSON.stringify(state, null, 2)}\n`, {
			mode: 0o600,
		});

		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
			taskId,
		});
		expect(projection.success).toBe(false);
		expect(projection.errorCode).toBe("continuation_unavailable");
		expect(projection.payload.blockers).toEqual(["continuation_unavailable"]);
		expect(projection.payload.next_action).toMatchObject({
			kind: "none",
			action_id: "none",
		});
		expect(projection.payload.retry_safety).toBe("operator_required");
	});
});

/**
 * Persist one terminal Doctor Task carrying Unknown Publication Outcome
 * evidence through the production store writer. The persisted carrier is again
 * the divergence-bait run_repair/resume diagnosis; every row test fails if the
 * front door stops routing the closed publication table. `withTransactionId`
 * false seeds a task whose binding AND terminal carry no transaction id, so an
 * invoke row has no durable selector and must fail closed. A null
 * `publicationEvidence` seeds the same carrier with nothing for a closed table
 * to route, which is the genuine run_repair compatibility terminal.
 */
async function seedPublicationTerminalTask(
	stateRoot: string,
	publicationEvidence: VaultGitDoctorPublicationEvidence | null,
	withTransactionId = true,
	receiptRevision = 7,
): Promise<string> {
	const taskStore = createVaultGitDoctorTaskStore({
		stateRoot,
		repositoryId: REPO_ID,
	});
	const admitted = await taskStore.claimOrJoin(
		{
			repositoryId: REPO_ID,
			activationEvidenceId: null,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision,
			transactionId: withTransactionId ? TXN_ID : null,
			normalizedInput: '{"command":"doctor","transactionId":null}',
		},
		"2026-08-14T01:00:00.000Z",
	);
	if (admitted.launch === "refused") throw new Error("seed claim refused");
	const taskId = admitted.state.taskId;
	const running = await taskStore.transition(taskId, admitted.state.revision, {
		state: "in_progress",
		phase: "running",
		updatedAt: "2026-08-14T01:00:01.000Z",
		heartbeatAt: "2026-08-14T01:00:01.000Z",
		checkpoint: "checking_remote",
		launchGeneration: LAUNCH_GENERATION,
		launchExpiresAt: null,
		workerPid: 42,
		workerProcessIdentity: "f".repeat(64),
		launchAttempt: 1,
		terminalResult: null,
	});
	if (running.status !== "transitioned") throw new Error("seed run failed");
	const terminalized = await taskStore.transition(taskId, running.state.revision, {
		state: "closed",
		phase: "terminal",
		updatedAt: "2026-08-14T01:00:02.000Z",
		heartbeatAt: "2026-08-14T01:00:02.000Z",
		checkpoint: "terminal",
		launchGeneration: LAUNCH_GENERATION,
		launchExpiresAt: null,
		workerPid: 42,
		workerProcessIdentity: "f".repeat(64),
		launchAttempt: 1,
		terminalResult: {
			kind: "doctor_result",
			status: "diagnosed",
			state: "human_required",
			phase: "push_pending",
			finding: "remote_outcome_unknown",
			changedState: "none",
			retrySafety: "operator_required",
			nextActionId: "run_repair",
			repairAction: "resume",
			...(withTransactionId ? { transactionId: TXN_ID } : {}),
			...(publicationEvidence ? { publicationEvidence } : {}),
		},
	});
	if (terminalized.status !== "transitioned") throw new Error("seed terminal failed");
	return taskId;
}

async function inspectPublicationRoute(
	publicationEvidence: VaultGitDoctorPublicationEvidence,
	withTransactionId = true,
) {
	const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
	roots.push(stateRoot);
	const taskId = await seedPublicationTerminalTask(
		stateRoot,
		publicationEvidence,
		withTransactionId,
	);
	return composeFrontDoor(stateRoot).inspectDoctorTask({ taskId });
}

async function corruptLatestTerminal(
	stateRoot: string,
	taskId: string,
	mutate: (terminal: Record<string, unknown>) => void,
): Promise<void> {
	const dir = join(
		stateRoot,
		"vault-git-transaction-manager",
		REPO_ID,
		"doctor-tasks",
		taskId,
		"history",
	);
	const names = (await readdir(dir)).sort();
	const latestPath = join(dir, names.at(-1) as string);
	const state = JSON.parse(await readFile(latestPath, "utf8"));
	mutate(state.terminalResult);
	const { writeFile } = await import("node:fs/promises");
	await writeFile(latestPath, `${JSON.stringify(state, null, 2)}\n`, {
		mode: 0o600,
	});
}

describe("vault-git U4 deep Doctor: Unknown Publication Outcome routes", () => {
	test("remotely closed routes to close_verified_publication", async () => {
		const projection = await inspectPublicationRoute("remotely_closed");
		expect(projection.payload.next_action).toMatchObject({
			kind: "invoke",
			action_id: "close_verified_publication",
			executable: "vault-git",
			argv: ["repair", "close-verified", "--transaction-id", TXN_ID, "--json"],
		});
		expect(projection.payload.blockers).toEqual([]);
	});

	test("proven not published with origin-host and fences intact routes to retry_proven_unpublished", async () => {
		const projection = await inspectPublicationRoute(
			"proven_not_published_origin_intact",
		);
		expect(projection.payload.next_action).toMatchObject({
			kind: "invoke",
			action_id: "retry_proven_unpublished",
			executable: "vault-git",
			argv: ["repair", "retry-push", "--transaction-id", TXN_ID, "--json"],
		});
	});

	test("unavailable evidence hands off to obtain_remote_evidence", async () => {
		const projection = await inspectPublicationRoute("unavailable");
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "obtain_remote_evidence",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "remote_evidence_available",
		});
	});

	test("conflicting evidence hands off to resolve_publication_conflict", async () => {
		const projection = await inspectPublicationRoute("conflicting");
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "resolve_publication_conflict",
			owner: "vault_git_operator",
			condition: "publication_conflict_resolved",
		});
	});

	test("contract breach hands off to restore_remote_contract", async () => {
		const projection = await inspectPublicationRoute("contract_breach");
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "restore_remote_contract",
			owner: "vault_git_operator",
			condition: "remote_contract_restored",
		});
	});

	test("an invoke row without a durable transaction selector fails closed, never a selector-less retry", async () => {
		const projection = await inspectPublicationRoute(
			"proven_not_published_origin_intact",
			false,
		);
		expect(projection.payload.next_action).toMatchObject({
			kind: "none",
			id: "retry_proven_unpublished",
			action_id: "none",
		});
		expect(projection.payload.blockers).toContain("continuation_unavailable");
		expect(projection.payload.retry_safety).toBe("operator_required");
	});

	test("a terminal transaction that mismatches its Doctor Task binding fails closed", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedPublicationTerminalTask(
			stateRoot,
			"proven_not_published_origin_intact",
		);
		await corruptLatestTerminal(stateRoot, taskId, (terminal) => {
			terminal.transactionId = `txn_${"8".repeat(32)}`;
		});

		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
			taskId,
		});

		expect(projection.success).toBe(false);
		expect(projection.errorCode).toBe("continuation_unavailable");
		expect(projection.payload.blockers).toEqual(["continuation_unavailable"]);
		expect(projection.payload.transaction_id).toBe(TXN_ID);
		expect(projection.payload.next_action).toMatchObject({
			kind: "none",
			action_id: "none",
		});
		expect(projection.payload.retry_safety).toBe("operator_required");
	});

	test("a terminal transaction on a null-bound Doctor Task fails closed without a transaction continuation", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedPublicationTerminalTask(
			stateRoot,
			"proven_not_published_origin_intact",
			false,
		);
		await corruptLatestTerminal(stateRoot, taskId, (terminal) => {
			terminal.transactionId = TXN_ID;
		});

		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
			taskId,
		});

		expect(projection.success).toBe(false);
		expect(projection.errorCode).toBe("continuation_unavailable");
		expect(projection.payload.blockers).toEqual(["continuation_unavailable"]);
		expect(projection.payload.transaction_id).toBeUndefined();
		expect(projection.payload.next_action).toMatchObject({
			kind: "none",
			action_id: "none",
		});
		expect(projection.payload.next_action).not.toHaveProperty("argv");
	});

	test("out-of-vocabulary publication evidence fails closed as a corrupt record", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedPublicationTerminalTask(stateRoot, "remotely_closed");
		await corruptLatestTerminal(stateRoot, taskId, (terminal) => {
			terminal.publicationEvidence = "maybe_published";
		});
		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
			taskId,
		});
		expect(projection.success).toBe(false);
		expect(projection.errorCode).toBe("continuation_unavailable");
		expect(projection.payload.blockers).toContain("continuation_unavailable");
		expect(projection.payload.next_action).toMatchObject({
			kind: "none",
			action_id: "none",
		});
		expect(projection.payload.retry_safety).toBe("operator_required");
	});

	test.each([
		["unknown class", (terminal: Record<string, unknown>) => {
			terminal.validationEvidence = { failureClass: "mystery" };
		}],
		["unknown stage", (terminal: Record<string, unknown>) => {
			terminal.validationEvidence = {
				failureClass: "stage_budget_exceeded",
				stage: "mystery",
			};
		}],
		["unknown action", (terminal: Record<string, unknown>) => {
			terminal.nextActionId = "invented_action";
		}],
		["missing action carrier", (terminal: Record<string, unknown>) => {
			delete terminal.nextActionId;
		}],
		["dual action carriers", (terminal: Record<string, unknown>) => {
			terminal.nextAction = { id: "run_repair", summary: "Run repair." };
		}],
		["invalid selector", (terminal: Record<string, unknown>) => {
			terminal.transactionId = "txn_invalid";
		}],
	] as const)(
		"invalid durable route evidence (%s) stays distinct from generic corruption",
		async (_name, mutate) => {
			const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
			roots.push(stateRoot);
			const taskId = await seedPublicationTerminalTask(
				stateRoot,
				"remotely_closed",
			);
			await corruptLatestTerminal(stateRoot, taskId, (terminal) => {
				delete terminal.publicationEvidence;
				mutate(terminal);
			});

			const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
				taskId,
			});
			expect(projection.success).toBe(false);
			expect(projection.errorCode).toBe("continuation_unavailable");
			expect(projection.payload.blockers).toEqual(["continuation_unavailable"]);
			expect(projection.payload.retry_safety).toBe("operator_required");
			expect(projection.payload.next_action).toMatchObject({
				kind: "none",
				action_id: "none",
			});
		},
	);

	test("a terminal carrying both evidence lanes fails closed as an invalid route", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedPublicationTerminalTask(stateRoot, "remotely_closed");
		await corruptLatestTerminal(stateRoot, taskId, (terminal) => {
			terminal.validationEvidence = {
				failureClass: "candidate_setup",
				setup: "insufficient",
			};
		});
		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
			taskId,
		});
		expect(projection.success).toBe(false);
		expect(projection.errorCode).toBe("continuation_unavailable");
		expect(projection.payload.blockers).toEqual(["continuation_unavailable"]);
		expect(projection.payload.retry_safety).toBe("operator_required");
		expect(projection.payload.next_action).toMatchObject({
			kind: "none",
			action_id: "none",
		});
	});

	test.each([
		[
			"validation",
			(stateRoot: string) =>
				seedValidationTerminalTask(stateRoot, {
					failureClass: "candidate_setup",
					setup: "proven_enrollment_defect",
				}),
		],
		[
			"publication",
			(stateRoot: string) =>
				seedPublicationTerminalTask(stateRoot, "remotely_closed"),
		],
	] as const)(
		"invalid persisted run_doctor wins over valid %s evidence routing",
		async (_label, seed) => {
			const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
			roots.push(stateRoot);
			const taskId = await seed(stateRoot);
			await corruptLatestTerminal(stateRoot, taskId, (terminal) => {
				terminal.nextActionId = "run_doctor";
			});

			const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
				taskId,
			});

			expect(projection.success).toBe(false);
			expect(projection.errorCode).toBe("continuation_unavailable");
			expect(projection.payload.blockers).toEqual(["continuation_unavailable"]);
			expect(projection.payload.retry_safety).toBe("operator_required");
			expect(projection.payload.next_action).toMatchObject({
				kind: "none",
				action_id: "none",
			});
		},
	);
});

describe("vault-git U4 deep Doctor: worker execution behind the front door", () => {
	test("burned-token diagnosis terminal write persists semantic reattest_stale_lease_takeover", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const workerPid = 4242;
		const taskId = await seedRegisteredLaunchingTask(stateRoot, workerPid);

		const frontDoor = composeFrontDoor(stateRoot);
		const diagnosis = {
			status: "diagnosed",
			state: "expired",
			phase: "writing",
			finding: "lease_expired",
			changedState: "local",
			retrySafety: "operator_required",
			nextAction: {
				id: "run_doctor",
				summary:
					"Run doctor again for a fresh stale-lease proof; the interrupted takeover never reached the remote.",
			},
			diagnosticsReference: "doctor:test",
			transactionId: TXN_ID,
		} as const;
		const result = await frontDoor.runWorker({
			taskId,
			launchGeneration: LAUNCH_GENERATION,
			workerPid,
			diagnose: async () => diagnosis,
		});
		expect(result).toBe(diagnosis);

		// Independent raw read: the NEW terminal write persists the semantic
		// reattestation id only, with no run_doctor id and no legacy object.
		const persisted = await latestPersistedTerminal(stateRoot, taskId);
		expect(persisted.state).toBe("closed");
		expect(persisted.phase).toBe("terminal");
		const terminal = persisted.terminalResult as Record<string, unknown>;
		expect(terminal.nextActionId).toBe("reattest_stale_lease_takeover");
		expect(terminal.nextAction).toBeUndefined();

		// Read-back through the same public seam projects the ADR row 2 handoff.
		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
			taskId,
		});
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "reattest_stale_lease_takeover",
			owner: "vault_git_operator",
			condition: "stale_lease_takeover_reattested",
		});
	});

	test("non-takeover diagnosis terminal write persists its id verbatim", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const workerPid = 4243;
		const taskId = await seedRegisteredLaunchingTask(stateRoot, workerPid);

		const result = await composeFrontDoor(stateRoot).runWorker({
			taskId,
			launchGeneration: LAUNCH_GENERATION,
			workerPid,
			diagnose: async () => ({
				status: "diagnosed",
				state: "repairable",
				phase: "writing",
				finding: "writes_in_progress",
				changedState: "none",
				retrySafety: "same_input_safe",
				nextAction: {
					id: "run_repair",
					summary: "Run the named resume repair after fresh evidence revalidation.",
				},
				diagnosticsReference: "doctor:test",
				repairAction: "resume",
				transactionId: TXN_ID,
			}),
		});
		expect(result.status).toBe("diagnosed");

		const persisted = await latestPersistedTerminal(stateRoot, taskId);
		const terminal = persisted.terminalResult as Record<string, unknown>;
		expect(terminal.nextActionId).toBe("run_repair");
		expect(terminal.nextAction).toBeUndefined();
	});
});

const OBSERVED_UPDATED_AT = "2026-08-14T01:00:01.000Z";
const OBSERVED_POLL_AFTER = "2026-08-14T01:00:06.000Z";
const OBSERVED_EXPIRY = "2026-08-14T01:10:00.000Z";

async function seedInProgressTask(stateRoot: string): Promise<string> {
	const taskStore = createVaultGitDoctorTaskStore({
		stateRoot,
		repositoryId: REPO_ID,
	});
	const admitted = await taskStore.claimOrJoin(
		{
			repositoryId: REPO_ID,
			activationEvidenceId: null,
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: TXN_ID,
			normalizedInput: '{"command":"doctor","transactionId":null}',
		},
		"2026-08-14T01:00:00.000Z",
	);
	if (admitted.launch === "refused") throw new Error("seed claim refused");
	const running = await taskStore.transition(
		admitted.state.taskId,
		admitted.state.revision,
		{
			state: "in_progress",
			phase: "running",
			updatedAt: OBSERVED_UPDATED_AT,
			heartbeatAt: OBSERVED_UPDATED_AT,
			checkpoint: "checking_remote",
			launchGeneration: LAUNCH_GENERATION,
			launchExpiresAt: null,
			workerPid: 4242,
			workerProcessIdentity: "f".repeat(64),
			launchAttempt: 1,
			terminalResult: null,
		},
	);
	if (running.status !== "transitioned") throw new Error("seed run failed");
	return admitted.state.taskId;
}

function composeFrontDoorAt(
	stateRoot: string,
	nowIso: string,
	identityAlive: boolean,
) {
	return createVaultGitDoctorFrontDoor({
		store: createReceiptStore({
			stateRoot,
			repositoryIdentity: "doctor-front-door-test",
		}),
		taskStore: createVaultGitDoctorTaskStore({
			stateRoot,
			repositoryId: REPO_ID,
		}),
		runtime: {
			now: () => 0,
			recordedAt: () => new Date(nowIso),
			sleep: async () => {},
			spawnWorker: () => {
				throw new Error("observation inspection must not spawn a worker");
			},
			readProcessIdentity: () => {
				throw new Error("observation inspection must not read process identity");
			},
			stopUnacknowledgedWorker: () => {},
			stopExpiredWorker: async () => true,
			processIdentityMatches: () => identityAlive,
		},
		spawnContext: null,
		now: () => Date.parse(nowIso),
	});
}

type DoctorGraphPayload = Awaited<
	ReturnType<ReturnType<typeof composeFrontDoor>["inspectDoctorTask"]>
>["payload"];

interface DoctorGraphRoute {
	readonly name: string;
	readonly taskId: string;
	readonly payload: DoctorGraphPayload;
}

interface DoctorGraphEdge {
	readonly from: string;
	readonly to: string;
	readonly permitted: boolean;
}

async function doctorGraphRoot(): Promise<string> {
	const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-graph-"));
	roots.push(stateRoot);
	return stateRoot;
}

async function collectTakeoverGraphRoutes(): Promise<DoctorGraphRoute[]> {
	const routes: DoctorGraphRoute[] = [];
	for (const [name, carrier] of [
		["takeover legacy", { nextAction: { id: "run_doctor", summary: "legacy" } }],
		["takeover semantic", { nextActionId: "run_doctor" }],
	] as const) {
		const stateRoot = await doctorGraphRoot();
		const taskId = await seedBurnedTokenTerminalTask(stateRoot, carrier);
		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({ taskId });
		routes.push({ name, taskId, payload: projection.payload });
	}
	return routes;
}

const GRAPH_VALIDATION_EVIDENCE: ReadonlyArray<
	readonly [string, VaultGitDoctorValidationRouteEvidence]
> = [
	["setup proven defect", { failureClass: "candidate_setup", setup: "proven_enrollment_defect" }],
	["setup missing inputs", { failureClass: "candidate_setup", setup: "missing_private_enrollment_inputs" }],
	["setup absent ssh", { failureClass: "candidate_setup", setup: "absent_external_ssh_prerequisites" }],
	["setup integrity defect", { failureClass: "candidate_setup", setup: "proven_candidate_integrity_defect" }],
	["setup insufficient", { failureClass: "candidate_setup", setup: "insufficient" }],
	["vault_content deterministic", { failureClass: "vault_content", content: "deterministic_with_admitted_repair", repairId: REPAIR_ID }],
	["vault_content insufficient", { failureClass: "vault_content", content: "insufficient" }],
	["budget vault_check", { failureClass: "stage_budget_exceeded", stage: "vault_check" }],
	["cleanup active owner", { failureClass: "candidate_cleanup", residue: "active_owned", taskId: COMPLETION_TASK_ID }],
	["cleanup old unowned", { failureClass: "candidate_cleanup", residue: "old_proven_unowned" }],
	["cleanup young", { failureClass: "candidate_cleanup", residue: "young_proven_unowned", eligibleAfter: "2026-08-14T02:00:02.000Z" }],
	["cleanup absent", { failureClass: "candidate_cleanup", residue: "absent_or_removed" }],
	["cleanup unknown owner", { failureClass: "candidate_cleanup", residue: "unknown_ownership" }],
	["cleanup budget fold", { failureClass: "stage_budget_exceeded", stage: "candidate_cleanup", residue: "old_proven_unowned" }],
];

async function collectValidationGraphRoutes(): Promise<DoctorGraphRoute[]> {
	const routes: DoctorGraphRoute[] = [];
	for (const [name, evidence] of GRAPH_VALIDATION_EVIDENCE) {
		const stateRoot = await doctorGraphRoot();
		const taskId = await seedValidationTerminalTask(stateRoot, evidence);
		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({ taskId });
		routes.push({ name, taskId, payload: projection.payload });
	}
	return routes;
}

async function collectPublicationGraphRoutes(): Promise<DoctorGraphRoute[]> {
	const routes: DoctorGraphRoute[] = [];
	const evidences: readonly VaultGitDoctorPublicationEvidence[] = [
		"remotely_closed",
		"proven_not_published_origin_intact",
		"unavailable",
		"conflicting",
		"contract_breach",
	];
	for (const evidence of evidences) {
		const stateRoot = await doctorGraphRoot();
		const taskId = await seedPublicationTerminalTask(stateRoot, evidence);
		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({ taskId });
		routes.push({ name: `publication ${evidence}`, taskId, payload: projection.payload });
	}
	const stateRoot = await doctorGraphRoot();
	const taskId = await seedPublicationTerminalTask(
		stateRoot,
		"proven_not_published_origin_intact",
		false,
	);
	const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({ taskId });
	routes.push({ name: "publication missing selector", taskId, payload: projection.payload });
	return routes;
}

async function collectObservationGraphRoutes(): Promise<DoctorGraphRoute[]> {
	const routes: DoctorGraphRoute[] = [];
	const activeRoot = await doctorGraphRoot();
	const activeTaskId = await seedInProgressTask(activeRoot);
	const active = await composeFrontDoorAt(
		activeRoot,
		"2026-08-14T01:05:00.000Z",
		true,
	).inspectDoctorTask({ taskId: activeTaskId });
	routes.push({ name: "nonterminal observation", taskId: activeTaskId, payload: active.payload });
	for (const [name, alive] of [
		["expired live-stalled", true],
		["expired dead worker", false],
	] as const) {
		const stateRoot = await doctorGraphRoot();
		const taskId = await seedInProgressTask(stateRoot);
		const projection = await composeFrontDoorAt(
			stateRoot,
			OBSERVED_EXPIRY,
			alive,
		).inspectDoctorTask({ taskId });
		routes.push({ name, taskId, payload: projection.payload });
	}
	return routes;
}

async function collectFailureGraphRoutes(): Promise<DoctorGraphRoute[]> {
	const missingRoot = await doctorGraphRoot();
	const missingTaskId = `doctor_task_${"9".repeat(32)}`;
	const missing = await composeFrontDoor(missingRoot).inspectDoctorTask({
		taskId: missingTaskId,
	});
	const corruptRoot = await doctorGraphRoot();
	const corruptTaskId = await seedPublicationTerminalTask(corruptRoot, "remotely_closed");
	await corruptLatestTerminal(corruptRoot, corruptTaskId, (terminal) => {
		terminal.publicationEvidence = "maybe_published";
	});
	const corrupt = await composeFrontDoor(corruptRoot).inspectDoctorTask({
		taskId: corruptTaskId,
	});
	return [
		{ name: "missing task", taskId: missingTaskId, payload: missing.payload },
		{ name: "corrupt evidence", taskId: corruptTaskId, payload: corrupt.payload },
	];
}

function graphEdgesForRoute(route: DoctorGraphRoute): DoctorGraphEdge[] {
	const node = `task:${route.name}`;
	const next = route.payload.next_action;
	const argv = "argv" in next ? next.argv : [];
	const observing = route.payload.task_observation_expires_at !== undefined;
	expect(["invoke", "needs_input", "needs_human", "none"]).toContain(next.kind);
	if (next.action_id === "inspect_doctor_task") {
		expect(observing).toBe(true);
		expect(argv).toEqual(["doctor", "--task-id", route.taskId, "--json"]);
		return [{ from: node, to: node, permitted: true }];
	}
	expect(next.action_id).not.toBe("run_doctor");
	if (argv.length === 0) return [];
	expect(argv[0]).not.toBe("doctor");
	expect(argv[0]).not.toBe("preview");
	if (argv[0] === "repair" && argv[1] === "apply-vault-content") {
		expect(route.name).toBe("vault_content deterministic");
	}
	if (next.action_id === "inspect_completion_task") {
		expect(argv).toContain("--task-id");
		expect(argv).not.toContain(route.taskId);
	}
	return [{ from: node, to: `command:${argv[0]}`, permitted: false }];
}

function assertAcyclicDoctorGraph(routes: readonly DoctorGraphRoute[]): void {
	const edges = routes.flatMap(graphEdgesForRoute);
	if (edges.some((edge) => edge.to === "command:doctor")) {
		for (const route of routes) {
			edges.push({
				from: "command:doctor",
				to: `task:${route.name}`,
				permitted: false,
			});
		}
	}
	expect(findForbiddenCycle(edges)).toBe(false);
}

describe("vault-git U4 deep Doctor: acyclic recovery graph", () => {
	// The bounded public-result graph proof (ADR-0002 acyclic invariant): every
	// Doctor route class is re-driven through the production front door over
	// real durable fixtures; nodes and terminality come from the projections
	// themselves. Only the bounded nonterminal observation cycle may repeat;
	// every other reachable path must leave Doctor.
	test("every terminal Doctor route leaves Doctor; only bounded observation may cycle", async () => {
		const routes: DoctorGraphRoute[] = [];
		routes.push(...(await collectTakeoverGraphRoutes()));

		routes.push(...(await collectValidationGraphRoutes()));

		routes.push(...(await collectPublicationGraphRoutes()));

		routes.push(...(await collectObservationGraphRoutes()));
		routes.push(...(await collectFailureGraphRoutes()));

		assertAcyclicDoctorGraph(routes);
	});
});

function findForbiddenCycle(
	edges: ReadonlyArray<{ from: string; to: string; permitted: boolean }>,
): boolean {
	const adjacency = new Map<string, string[]>();
	for (const edge of edges) {
		if (edge.permitted) continue;
		adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (node: string): boolean => {
		if (visiting.has(node)) return true;
		if (visited.has(node)) return false;
		visiting.add(node);
		for (const next of adjacency.get(node) ?? []) {
			if (visit(next)) return true;
		}
		visiting.delete(node);
		visited.add(node);
		return false;
	};
	return [...adjacency.keys()].some(visit);
}

describe("vault-git U4 deep Doctor: bounded observation metadata and expiry", () => {
	test("a nonterminal task strictly within expiry returns inspection with exact observation metadata", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedInProgressTask(stateRoot);

		const projection = await composeFrontDoorAt(
			stateRoot,
			"2026-08-14T01:09:59.999Z",
			true,
		).inspectDoctorTask({ taskId });

		expect(projection.success).toBe(true);
		expect(projection.payload.next_action).toMatchObject({
			kind: "invoke",
			action_id: "inspect_doctor_task",
			argv: ["doctor", "--task-id", taskId, "--json"],
		});
		expect(projection.payload.task_revision).toBe(2);
		expect(projection.payload.task_generation).toBe(LAUNCH_GENERATION);
		expect(projection.payload.task_poll_after).toBe(OBSERVED_POLL_AFTER);
		expect(projection.payload.task_observation_expires_at).toBe(OBSERVED_EXPIRY);
	});

	test("a live-stalled worker at expiry durably terminalizes and refuses an unavailable continuation", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedInProgressTask(stateRoot);

		const projection = await composeFrontDoorAt(
			stateRoot,
			OBSERVED_EXPIRY,
			true,
		).inspectDoctorTask({ taskId });

		expect(projection.success).toBe(false);
		expect(projection.errorCode).toBe("continuation_unavailable");
		expect(projection.payload.blockers).toEqual(["continuation_unavailable"]);
		expect(projection.payload.retry_safety).toBe("operator_required");
		expect(projection.payload.next_action).toMatchObject({
			kind: "none",
			action_id: "none",
		});
		expect(projection.payload.task_poll_after).toBeUndefined();
		expect(projection.payload.task_observation_expires_at).toBeUndefined();

		// Expiry is a durable lifecycle decision. It clears worker identity so a
		// late worker can no longer publish canonical diagnosis authority.
		const reread = await createVaultGitDoctorTaskStore({
			stateRoot,
			repositoryId: REPO_ID,
		}).loadByTaskId(taskId);
		if (reread.status !== "loaded") throw new Error("task unreadable");
		expect(reread.state).toMatchObject({
			state: "unknown",
			phase: "terminal",
			revision: 3,
			workerPid: null,
			workerProcessIdentity: null,
			terminalResult: {
				kind: "observation_expired",
				blocker: "continuation_unavailable",
				retrySafety: "operator_required",
			},
		});
		const late = await createVaultGitDoctorTaskLifecycle({
			store: createVaultGitDoctorTaskStore({ stateRoot, repositoryId: REPO_ID }),
			runtime: {
				...deterministicRuntime(),
				recordedAt: () => new Date("2026-08-14T01:10:01.000Z"),
			},
			spawnContext: null,
		}).terminalizeWorker({
			taskId,
			launchGeneration: LAUNCH_GENERATION,
			workerPid: 4242,
			terminalResult: {
				kind: "doctor_result",
				status: "diagnosed",
				state: "repairable",
				phase: "writing",
				finding: "writes_in_progress",
				changedState: "none",
				retrySafety: "same_input_safe",
				nextActionId: "run_repair",
				repairAction: "resume",
				transactionId: TXN_ID,
			},
		});
		expect(late).toMatchObject({
			kind: "refused",
			reason: "worker_lost",
			state: { terminalResult: { kind: "observation_expired" } },
		});
	});

	test("repeated inspection after expiry re-reads one durable terminal without reopening polling", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedInProgressTask(stateRoot);
		const taskStore = createVaultGitDoctorTaskStore({
			stateRoot,
			repositoryId: REPO_ID,
		});

		const first = await composeFrontDoorAt(
			stateRoot,
			OBSERVED_EXPIRY,
			true,
		).inspectDoctorTask({ taskId });
		const settled = await taskStore.loadByTaskId(taskId);
		if (settled.status !== "loaded") throw new Error("task unreadable");

		const second = await composeFrontDoorAt(
			stateRoot,
			"2026-08-14T01:30:00.000Z",
			true,
		).inspectDoctorTask({ taskId });

		expect(second.success).toBe(false);
		expect(second.errorCode).toBe("continuation_unavailable");
		expect(second.payload.blockers).toEqual(["continuation_unavailable"]);
		expect(second.payload.retry_safety).toBe("operator_required");
		expect(second.payload.next_action).toMatchObject({
			kind: "none",
			action_id: "none",
		});
		expect(second.payload.task_state).toBe("unknown");
		expect(second.payload.task_phase).toBe("terminal");
		expect(second.payload.task_poll_after).toBeUndefined();
		expect(second.payload.task_observation_expires_at).toBeUndefined();
		expect(second.payload.next_action).toEqual(first.payload.next_action);
		expect(second.payload.blockers).toEqual(first.payload.blockers);
		expect(second.payload.retry_safety).toBe(first.payload.retry_safety);

		const reread = await taskStore.loadByTaskId(taskId);
		if (reread.status !== "loaded") throw new Error("task unreadable");
		expect(reread.state.revision).toBe(settled.state.revision);
		expect(reread.state.updatedAt).toBe(settled.state.updatedAt);
		expect(reread.state.terminalResult).toMatchObject({
			kind: "observation_expired",
			blocker: "continuation_unavailable",
		});
	});

	test("a running heartbeat cannot renew the admission-anchored observation deadline", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedInProgressTask(stateRoot);
		const taskStore = createVaultGitDoctorTaskStore({
			stateRoot,
			repositoryId: REPO_ID,
		});
		const heartbeatAt = "2026-08-14T01:09:59.000Z";
		const lifecycle = createVaultGitDoctorTaskLifecycle({
			store: taskStore,
			runtime: {
				...deterministicRuntime(),
				recordedAt: () => new Date(heartbeatAt),
				processIdentityMatches: () => true,
			},
			spawnContext: null,
		});
		const heartbeat = await lifecycle.heartbeatWorker({
			taskId,
			launchGeneration: LAUNCH_GENERATION,
			workerPid: 4242,
		});
		expect(heartbeat.kind).toBe("settled");

		const projection = await composeFrontDoorAt(
			stateRoot,
			"2026-08-14T01:10:00.000Z",
			true,
		).inspectDoctorTask({ taskId });

		expect(projection.success).toBe(false);
		expect(projection.errorCode).toBe("continuation_unavailable");
		expect(projection.payload.blockers).toEqual(["continuation_unavailable"]);
		expect(projection.payload.retry_safety).toBe("operator_required");
		expect(projection.payload.next_action).toMatchObject({
			kind: "none",
			action_id: "none",
		});
		expect(projection.payload.task_observation_expires_at).toBeUndefined();
		const reread = await taskStore.loadByTaskId(taskId);
		if (reread.status !== "loaded") throw new Error("task unreadable");
		expect(reread.state.heartbeatAt).toBe(heartbeatAt);
		expect(reread.state).toMatchObject({
			state: "unknown",
			phase: "terminal",
			terminalResult: {
				kind: "observation_expired",
				blocker: "continuation_unavailable",
			},
		});
	});

	test("a provably dead worker at expiry terminalizes through the exact-identity lifecycle fences", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedInProgressTask(stateRoot);

		const projection = await composeFrontDoorAt(
			stateRoot,
			OBSERVED_EXPIRY,
			false,
		).inspectDoctorTask({ taskId });

		expect(projection.success).toBe(false);
		expect(projection.errorCode).toBe("worker_lost");
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "inspect_private_receipt",
		});
		expect(projection.payload.task_poll_after).toBeUndefined();
		expect(projection.payload.task_observation_expires_at).toBeUndefined();

		const reread = await createVaultGitDoctorTaskStore({
			stateRoot,
			repositoryId: REPO_ID,
		}).loadByTaskId(taskId);
		if (reread.status !== "loaded") throw new Error("task unreadable");
		expect(reread.state.state).toBe("unknown");
		expect(reread.state.phase).toBe("terminal");
	});

	test("a terminal task never carries observation metadata", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedBurnedTokenTerminalTask(stateRoot, {
			nextActionId: "run_doctor",
		});
		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
			taskId,
		});
		expect(projection.payload.task_revision).toBeUndefined();
		expect(projection.payload.task_poll_after).toBeUndefined();
		expect(projection.payload.task_observation_expires_at).toBeUndefined();
	});

	test("foreground join at observation expiry stops instead of renewing inspection", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const receiptStore = createReceiptStore({
			stateRoot,
			repositoryIdentity: "doctor-front-door-test",
		});
		const receipt: VaultGitReceipt = {
			schemaVersion: 2,
			receiptId: `receipt_${"b".repeat(32)}`,
			transactionId: TXN_ID,
			revision: 1,
			phase: "writing",
			transition: "acquisition_intent",
			recordedAt: "2026-08-14T00:59:00.000Z",
			event: "note_created",
			actor: "agent-a",
			host: "laptop",
			remote: "origin",
			ownedPaths: [
				{ path: "notes/example.md", baselineHash: null, admittedNewFile: true },
			],
			unrelatedState: { statusHex: "", indexHex: "" },
			localMainHead: "b".repeat(40),
			remoteMainHead: "b".repeat(40),
			expectedLeaseGeneration: null,
			leaseGeneration: "a".repeat(40),
			leaseAcquiredAt: "2026-08-14T00:59:00.000Z",
			leaseDurationMs: 60_000,
			commitId: null,
			expectedMainCommit: null,
			ledgerReleaseId: null,
			pushOutcome: "not_attempted",
			nextSafeAction: "run_owned_path_checks",
			diagnosticsReference: `receipt:receipt_${"b".repeat(32)}`,
		};
		await receiptStore.initialize(receipt, {
			ownerCapability: new Uint8Array([1]),
			joinCapability: new Uint8Array([2]),
		});

		const taskStore = createVaultGitDoctorTaskStore({
			stateRoot,
			repositoryId: REPO_ID,
		});
		const claimed = await taskStore.claimOrJoin(
			{
				repositoryId: REPO_ID,
				activationEvidenceId: null,
				receiptId: receipt.receiptId,
				receiptRevision: receipt.revision,
				transactionId: TXN_ID,
				normalizedInput: JSON.stringify({
					command: "doctor",
					transactionId: TXN_ID,
				}),
			},
			"2026-08-14T01:00:00.000Z",
		);
		if (claimed.launch === "refused") throw new Error("seed claim refused");
		const running = await taskStore.transition(
			claimed.state.taskId,
			claimed.state.revision,
			{
				state: "in_progress",
				phase: "running",
				updatedAt: "2026-08-14T01:09:59.000Z",
				heartbeatAt: "2026-08-14T01:09:59.000Z",
				checkpoint: "checking_remote",
				launchGeneration: LAUNCH_GENERATION,
				launchExpiresAt: null,
				workerPid: 4242,
				workerProcessIdentity: "f".repeat(64),
				launchAttempt: 1,
				terminalResult: null,
			},
		);
		if (running.status !== "transitioned") throw new Error("seed run failed");

		const frontDoor = createVaultGitDoctorFrontDoor({
			store: receiptStore,
			taskStore,
			runtime: {
				now: () => 0,
				recordedAt: () => new Date(OBSERVED_EXPIRY),
				sleep: async () => {},
				spawnWorker: () => {
					throw new Error("joined task must not spawn another worker");
				},
				readProcessIdentity: () => {
					throw new Error("joined task must not read a new process identity");
				},
				stopUnacknowledgedWorker: () => {},
				stopExpiredWorker: async () => true,
				processIdentityMatches: () => true,
			},
			spawnContext: null,
			now: () => Date.parse(OBSERVED_EXPIRY),
		});

		const admitted = await frontDoor.admitForeground({
			transactionId: TXN_ID,
			args: ["doctor", "--transaction-id", TXN_ID, "--json"],
		});
		if (admitted.kind !== "projected") throw new Error("admission fell through");
		expect(admitted.projection.success).toBe(false);
		expect(admitted.projection.errorCode).toBe("continuation_unavailable");
		expect(admitted.projection.payload.blockers).toEqual([
			"continuation_unavailable",
		]);
		expect(admitted.projection.payload.retry_safety).toBe("operator_required");
		expect(admitted.projection.payload.next_action).toMatchObject({
			kind: "none",
			action_id: "none",
		});
		expect(admitted.projection.payload.task_poll_after).toBeUndefined();
		expect(
			admitted.projection.payload.task_observation_expires_at,
		).toBeUndefined();
		const reread = await taskStore.loadByTaskId(running.state.taskId);
		if (reread.status !== "loaded") throw new Error("task unreadable");
		expect(reread.state).toMatchObject({
			state: "unknown",
			phase: "terminal",
			terminalResult: {
				kind: "observation_expired",
				blocker: "continuation_unavailable",
			},
		});
	});

	test("foreground join of a closed task propagates its unavailable continuation as failure", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const receiptStore = createReceiptStore({
			stateRoot,
			repositoryIdentity: "doctor-front-door-test",
		});
		const receipt: VaultGitReceipt = {
			schemaVersion: 2,
			receiptId: `receipt_${"b".repeat(32)}`,
			transactionId: TXN_ID,
			revision: 1,
			phase: "writing",
			transition: "acquisition_intent",
			recordedAt: "2026-08-14T01:00:00.000Z",
			event: "note_created",
			actor: "agent-a",
			host: "laptop",
			remote: "origin",
			ownedPaths: [
				{ path: "notes/example.md", baselineHash: null, admittedNewFile: true },
			],
			unrelatedState: { statusHex: "", indexHex: "" },
			localMainHead: "b".repeat(40),
			remoteMainHead: "b".repeat(40),
			expectedLeaseGeneration: null,
			leaseGeneration: "a".repeat(40),
			leaseAcquiredAt: "2026-08-14T01:00:00.000Z",
			leaseDurationMs: 60_000,
			commitId: null,
			expectedMainCommit: null,
			ledgerReleaseId: null,
			pushOutcome: "not_attempted",
			nextSafeAction: "run_owned_path_checks",
			diagnosticsReference: `receipt:receipt_${"b".repeat(32)}`,
		};
		await receiptStore.initialize(receipt, {
			ownerCapability: new Uint8Array([1]),
			joinCapability: new Uint8Array([2]),
		});
		const taskId = await seedPublicationTerminalTask(
			stateRoot,
			"proven_not_published_origin_intact",
			true,
			receipt.revision,
		);
		await corruptLatestTerminal(stateRoot, taskId, (terminal) => {
			terminal.transactionId = `txn_${"8".repeat(32)}`;
		});

		const admitted = await createVaultGitDoctorFrontDoor({
			store: receiptStore,
			taskStore: createVaultGitDoctorTaskStore({
				stateRoot,
				repositoryId: REPO_ID,
			}),
			runtime: deterministicRuntime(),
			spawnContext: null,
			now: () => Date.parse("2026-08-14T01:00:03.000Z"),
		}).admitForeground({ args: ["doctor", "--json"] });

		if (admitted.kind !== "projected") throw new Error("admission fell through");
		expect(admitted.projection.success).toBe(false);
		expect(admitted.projection.errorCode).toBe("continuation_unavailable");
		expect(admitted.projection.payload.blockers).toEqual([
			"continuation_unavailable",
		]);
		expect(admitted.projection.payload.next_action).toMatchObject({
			kind: "none",
			action_id: "none",
		});
	});

	test("foreground admission of a real receipt returns the advanced task with exact observation metadata", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const T0 = "2026-08-14T02:00:00.000Z";
		const receiptStore = createReceiptStore({
			stateRoot,
			repositoryIdentity: "doctor-front-door-test",
		});
		const receipt: VaultGitReceipt = {
			schemaVersion: 2,
			receiptId: `receipt_${"b".repeat(32)}`,
			transactionId: TXN_ID,
			revision: 1,
			phase: "writing",
			transition: "acquisition_intent",
			recordedAt: "2026-08-14T01:00:00.000Z",
			event: "note_created",
			actor: "agent-a",
			host: "laptop",
			remote: "origin",
			ownedPaths: [
				{ path: "notes/example.md", baselineHash: null, admittedNewFile: true },
			],
			unrelatedState: { statusHex: "", indexHex: "" },
			localMainHead: "b".repeat(40),
			remoteMainHead: "b".repeat(40),
			expectedLeaseGeneration: null,
			leaseGeneration: "a".repeat(40),
			leaseAcquiredAt: "2026-08-14T01:00:00.000Z",
			leaseDurationMs: 60_000,
			commitId: null,
			expectedMainCommit: null,
			ledgerReleaseId: null,
			pushOutcome: "not_attempted",
			nextSafeAction: "run_owned_path_checks",
			diagnosticsReference: `receipt:receipt_${"b".repeat(32)}`,
		};
		await receiptStore.initialize(receipt, {
			ownerCapability: new Uint8Array([1]),
			joinCapability: new Uint8Array([2]),
		});

		const taskStore = createVaultGitDoctorTaskStore({
			stateRoot,
			repositoryId: REPO_ID,
		});
		let capturedGeneration: string | null = null;
		// The spawn seam stands in for the detached worker: it acknowledges the
		// registered launch through a second real lifecycle over the same durable
		// store, so admission completes exactly as production choreography does.
		const runtime = {
			now: () => performance.now(),
			recordedAt: () => new Date(T0),
			sleep: (milliseconds: number) => Bun.sleep(milliseconds),
			spawnWorker: (
				_context: null,
				taskId: string,
				launchGeneration: string,
			): number => {
				capturedGeneration = launchGeneration;
				void (async () => {
					await createVaultGitDoctorTaskLifecycle({
						store: taskStore,
						runtime,
						spawnContext: null,
					}).acknowledgeWorker({
						taskId,
						launchGeneration,
						workerPid: 4242,
					});
				})();
				return 4242;
			},
			readProcessIdentity: () => "f".repeat(64),
			stopUnacknowledgedWorker: () => {},
			stopExpiredWorker: async () => true,
			processIdentityMatches: () => true,
		};
		const frontDoor = createVaultGitDoctorFrontDoor({
			store: receiptStore,
			taskStore,
			runtime,
			spawnContext: null,
			now: () => Date.parse(T0),
		});

		const admitted = await frontDoor.admitForeground({
			transactionId: TXN_ID,
			args: ["doctor", "--json"],
		});
		if (admitted.kind !== "projected") throw new Error("admission fell through");
		const payload = admitted.projection.payload;
		expect(payload.outcome).toBe("advanced");
		expect(payload.task_state).toBe("in_progress");
		expect(payload.blockers).toEqual([]);
		expect(payload.task_revision).toBe(4);
		expect(payload.task_generation).toBe(capturedGeneration ?? "");
		expect(payload.task_poll_after).toBe("2026-08-14T02:00:05.000Z");
		expect(payload.task_observation_expires_at).toBe("2026-08-14T02:10:00.000Z");
		// An admitted, running Doctor Task emits inspect_doctor_task (ADR-0002 U4).
		expect(payload.next_action).toMatchObject({
			kind: "invoke",
			action_id: "inspect_doctor_task",
		});
	});
});

describe("vault-git U4 deep Doctor: terminal Stale-Lease Takeover continuation", () => {
	test("legacy run_doctor terminal projects reattest_stale_lease_takeover without rewriting history", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedBurnedTokenTerminalTask(stateRoot, {
			nextAction: {
				id: "run_doctor",
				summary:
					"Run doctor again for a fresh stale-lease proof; the interrupted takeover never reached the remote.",
			},
		});
		const before = await rawHistory(stateRoot, taskId);

		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
			taskId,
		});

		expect(projection.success).toBe(true);
		expect(projection.errorCode).toBe("");
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "reattest_stale_lease_takeover",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "stale_lease_takeover_reattested",
		});
		expect(projection.payload.next_action.id).not.toBe("run_doctor");
		const terminal = projection.payload.task_terminal_result;
		if (!terminal || !("kind" in terminal) || terminal.kind !== "doctor_result") {
			throw new Error("terminal doctor_result missing from payload");
		}
		expect(terminal.nextActionId).toBe("reattest_stale_lease_takeover");

		// The projection never rewrites durable history: the persisted legacy
		// carrier still names run_doctor byte-for-byte.
		expect(await rawHistory(stateRoot, taskId)).toEqual(before);
		const reread = await createVaultGitDoctorTaskStore({
			stateRoot,
			repositoryId: REPO_ID,
		}).loadByTaskId(taskId);
		if (reread.status !== "loaded") throw new Error("terminal task unreadable");
		const persisted = reread.state.terminalResult;
		if (!persisted || persisted.kind !== "doctor_result") {
			throw new Error("persisted terminal missing");
		}
		expect(persisted.nextAction?.id).toBe("run_doctor");
	});

	test("semantic run_doctor terminal projects reattest_stale_lease_takeover", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedBurnedTokenTerminalTask(stateRoot, {
			nextActionId: "run_doctor",
		});

		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
			taskId,
		});

		expect(projection.success).toBe(true);
		expect(projection.payload.next_action).toMatchObject({
			kind: "needs_human",
			action_id: "reattest_stale_lease_takeover",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "stale_lease_takeover_reattested",
		});
		expect(projection.payload.next_action.id).not.toBe("run_doctor");
	});

	test.each([
		["wrong finding", { finding: "writes_in_progress" }],
		["quarantine not reconciled", { changedState: "none" }],
		["repair still admitted", { repairAction: "resume" }],
	] as const)(
		"persisted run_doctor with %s fails closed instead of reattesting",
		async (_name, mutation) => {
			const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
			roots.push(stateRoot);
			const taskId = await seedBurnedTokenTerminalTask(stateRoot, {
				nextActionId: "run_doctor",
			});
			await corruptLatestTerminal(stateRoot, taskId, (terminal) => {
				Object.assign(terminal, mutation);
			});

			const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
				taskId,
			});
			expect(projection.success).toBe(false);
			expect(projection.errorCode).toBe("continuation_unavailable");
			expect(projection.payload.blockers).toContain("continuation_unavailable");
			expect(projection.payload.next_action).toMatchObject({
				kind: "none",
				action_id: "none",
			});
		},
	);
});

/**
 * Public payload consistency (issue #390 U4): when a closed route table derives
 * the continuation from proven evidence, the persisted repair action is stale
 * carrier residue, not admitted repair authority. Publishing it beside an
 * evidence-derived action tells an agent a Deterministic Repair is admitted when
 * the route proved otherwise. Only the projected run_repair compatibility
 * carrier, which the catalog resolves FROM that repair action, may publish it.
 */
describe("vault-git U4 deep Doctor: stale repair_action is never published", () => {
	test("evidence-routed publication terminal publishes no stale repair action", async () => {
		const projection = await inspectPublicationRoute(
			"proven_not_published_origin_intact",
		);
		expect(projection.payload.next_action).toMatchObject({
			action_id: "retry_proven_unpublished",
		});
		expect(projection.payload.repair_action).toBeUndefined();
	});

	test("evidence-routed validation escalation publishes no stale repair action", async () => {
		const projection = await inspectValidationRoute({
			failureClass: "candidate_setup",
			setup: "insufficient",
		});
		expect(projection.payload.next_action).toMatchObject({
			action_id: "escalate_validation_evidence",
		});
		expect(projection.payload.repair_action).toBeUndefined();
	});

	test("genuine run_repair carrier still publishes its exact repair action", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "vault-git-doctor-front-door-"));
		roots.push(stateRoot);
		const taskId = await seedPublicationTerminalTask(stateRoot, null);

		const projection = await composeFrontDoor(stateRoot).inspectDoctorTask({
			taskId,
		});

		expect(projection.payload.next_action).toMatchObject({
			action_id: "run_repair",
		});
		expect(projection.payload.repair_action).toBe("resume");
	});
});
