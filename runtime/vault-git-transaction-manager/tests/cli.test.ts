import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
	createVaultGitCliComposition,
	projectVaultGitBackgroundWorkerEnvironment,
	readVaultGitProcessIdentity,
	runVaultGitForTest,
	type VaultGitCliComposition,
} from "../src/cli.ts";
import type { VaultGitActivationFrontDoor } from "../src/activation-front-door.ts";
import { createNodeProcessPort } from "../src/git-adapter.ts";
import { createVaultGitActivationRestriction } from "../src/activation-restriction.ts";
import { resolveVaultRepositoryIdentity } from "../src/repository-identity.ts";
import type {
	VaultGitEngineResult,
	VaultGitTransactionEngine,
} from "../src/engine.ts";
import type {
	VaultGitReceipt,
	VaultGitRepairAction,
	VaultGitTaskState,
} from "../src/model.ts";
import type { VaultGitRuntimePort } from "../src/ports.ts";
import type {
	VaultGitRepairInput,
	VaultGitRepairResult,
} from "../src/repair.ts";
import { createReceiptStore, type VaultGitReceiptStore } from "../src/store.ts";
import {
	admitActivationForTest,
	admittedActivationAuthorityForTest,
} from "./activation-fixture.ts";
import { createTempDirectoryFixture } from "./temp-directory-fixture.ts";

const tempDirectories = createTempDirectoryFixture();
const ACTIVATION_EVIDENCE_REFERENCE =
	`vault-git:prepared:v2:${"f".repeat(64)}`;

afterEach(tempDirectories.cleanup);

describe("vault-git CLI composition", () => {
	test("scrubs ambient authority before detached worker launch", () => {
		expect(
			projectVaultGitBackgroundWorkerEnvironment({
				HOME: "/profile",
				PATH: "/bin",
				VAULT_GIT_REPOSITORY_PATH: "/vault",
				AWS_SECRET_ACCESS_KEY: "must-not-cross",
				BITBUCKET_API_TOKEN: "must-not-cross",
				VAULT_GIT_TASK_ID: "hostile-parent-task",
				VAULT_GIT_TASK_LAUNCH_GENERATION: "hostile-parent-generation",
			}),
		).toEqual({
			HOME: "/profile",
			PATH: "/bin",
			VAULT_GIT_REPOSITORY_PATH: "/vault",
		});
	});

	test("derives portable process identity from Linux start ticks with a C-locale ps fallback", () => {
		const pid = 42;
		const statFields = ["S", ...Array.from({ length: 18 }, (_, index) => String(index)), "987654"];
		const procIdentity = readVaultGitProcessIdentity(pid, {
			platform: "linux",
			readLinuxProcStat: () => `${pid} (worker ) name) ${statFields.join(" ")}`,
			readPsStart: () => {
				throw new Error("ps fallback not expected");
			},
		});
		expect(procIdentity).toBe(
			createHash("sha256").update(`${pid}\0${"987654"}`).digest("hex"),
		);

		let observedLocale: string | undefined;
		const fallbackIdentity = readVaultGitProcessIdentity(pid, {
			platform: "linux",
			readLinuxProcStat: () => {
				throw new Error("proc unavailable");
			},
			readPsStart: (_candidatePid, env) => {
				observedLocale = env.LC_ALL;
				return "Thu Aug 13 12:00:00 2026";
			},
		});
		expect(observedLocale).toBe("C");
		expect(fallbackIdentity).toBe(
			createHash("sha256")
				.update(`${pid}\0Thu Aug 13 12:00:00 2026`)
				.digest("hex"),
		);
	});

	test("withholds process-fixture controls unless the harness opts in", () => {
		const fixtureControls = {
			VAULT_GIT_REAL_GIT: "/tmp/shim/git",
			VAULT_GIT_SHIM_MODE: "remote_offline",
			VAULT_GIT_TEST_INTERRUPT_POINT: "after_local_commit",
			VAULT_GIT_TEST_INTERRUPT_GATE: "/tmp/gate",
			VAULT_GIT_TEST_PRIVATE_CHILD_MODE: "malformed_ack",
		} as const;

		expect(
			projectVaultGitBackgroundWorkerEnvironment({
				PATH: "/bin",
				...fixtureControls,
			}),
		).toEqual({ PATH: "/bin" });

		expect(
			projectVaultGitBackgroundWorkerEnvironment({
				PATH: "/bin",
				VAULT_GIT_TEST_HARNESS: "1",
				...fixtureControls,
			}),
		).toEqual({
			PATH: "/bin",
			VAULT_GIT_TEST_HARNESS: "1",
			...fixtureControls,
		});
	});

	test("derives the private-store identity from the configured checkout", async () => {
		const repositoryPath = await temp("vault-git-composition-identity-");
		const initialized = spawnSync(
			"git",
			["init", "--initial-branch=main", repositoryPath],
			{ encoding: "utf8" },
		);
		expect(initialized.status).toBe(0);
		const stateRoot = await temp("vault-git-composition-state-");
		const process = createNodeProcessPort();
		const resolved = await resolveVaultRepositoryIdentity({
			repositoryPath,
			process,
			timeoutMs: 5_000,
		});

		const composition = await createVaultGitCliComposition({
			repositoryPath,
			checkRepositoryPath: repositoryPath,
			stateRoot,
			actor: "agent-a",
			host: "host-a",
			process,
		});

		expect(composition.store.repositoryId).toBe(
			createReceiptStore({
				stateRoot,
				repositoryIdentity: resolved.identity,
			}).repositoryId,
		);
	});

	test("refuses admission when the configured Git repository is replaced after composition", async () => {
		const repositoryPath = await temp("vault-git-composition-replaced-");
		const git = (...args: readonly string[]) =>
			spawnSync("git", args, { cwd: repositoryPath, encoding: "utf8" });
		expect(git("init", "--initial-branch=main").status).toBe(0);
		expect(
			git(
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@example.invalid",
				"commit",
				"--allow-empty",
				"-m",
				"initial",
			).status,
		).toBe(0);
		const composition = await createVaultGitCliComposition({
			repositoryPath,
			checkRepositoryPath: repositoryPath,
			stateRoot: await temp("vault-git-composition-replaced-state-"),
			actor: "agent-a",
			host: "host-a",
			activationAuthority: admittedActivationAuthorityForTest,
		});
		await admitActivationForTest(composition.store);

		await rm(join(repositoryPath, ".git"), { recursive: true });
		expect(git("init", "--initial-branch=main").status).toBe(0);
		expect(
			git(
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@example.invalid",
				"commit",
				"--allow-empty",
				"-m",
				"replacement",
			).status,
		).toBe(0);

		const result = await composition.engine.begin({
			event: "note_created",
			requestedPaths: ["notes/new.md"],
			remote: "origin",
			leaseDurationMs: 15 * 60_000,
		});
		expect(result).toMatchObject({
			status: "refused",
			blocker: "vault_identity_changed",
			changedState: "none",
		});
	});

	test("refuses check and repository ports rooted at different vaults", async () => {
		const repositoryPath = await temp("vault-git-composition-repository-");
		const checkRepositoryPath = await temp("vault-git-composition-check-");
		await expect(
			createVaultGitCliComposition({
				repositoryPath,
				checkRepositoryPath,
				stateRoot: await temp("vault-git-composition-state-"),
				repositoryIdentity: "fixture-vault",
				actor: "agent-a",
				host: "host-a",
			}),
		).rejects.toThrow("must resolve to the same root");
	});

	test("dispatches begin to the transaction engine and exposes safe correlation", async () => {
		let observedPaths: readonly string[] = [];
		const engine = fakeEngine({
			async begin(input) {
				observedPaths = input.requestedPaths;
				return engineResult({
					status: "admitted",
					phase: "writing",
					writePermission: "owner",
					changedState: "remote",
					transactionId: "txn_00000000000000000000000000000001",
					nextAction: {
						id: "complete_transaction",
						summary: "Complete the meaningful event explicitly.",
					},
				});
			},
		});
		const run = await runVaultGitForTest(
			[
				"begin",
				"--event",
				"note_created",
				"--path",
				"notes/new.md",
				"--json",
			],
			{ composition: fakeComposition(engine), launchPrivate: false },
		);
		expect(run.exitCode).toBe(0);
		expect(run.stderr).toBe("");
		expect(observedPaths).toEqual(["notes/new.md"]);
		expect(JSON.parse(run.stdout)).toMatchObject({
			status: "ok",
			data: {
				outcome: "admitted",
				phase: "writing",
				write_permission: "owner",
				changed_state: "remote",
				transaction_id: "txn_00000000000000000000000000000001",
				next_action: { id: "complete_transaction" },
			},
			continuation: { next_action_id: "complete_transaction" },
		});
		expect(run.stdout).not.toMatch(/capability|\/private\/|\/Users\//);
	});

	test("renders the same cause-specific activation restriction in JSON and text", async () => {
		const activationRestriction = createVaultGitActivationRestriction({
			stoppedAction: "vault_write",
			cause: "revoked",
		});
		const engine = fakeEngine({
			async begin() {
				return engineResult({
					status: "refused",
					blocker: "activation_blocked",
					retrySafety: "same_input_unsafe",
					nextAction: {
						...activationRestriction.nextAction,
					},
					activationRestriction,
				});
			},
		});
		const argv = [
			"begin",
			"--event",
			"note_created",
			"--path",
			"notes/new.md",
		] as const;

		const json = await runVaultGitForTest([...argv, "--json"], {
			composition: fakeComposition(engine),
			launchPrivate: false,
		});
		expect(json.exitCode).toBe(1);
		expect(JSON.parse(json.stdout).data).toMatchObject({
			blockers: ["activation_blocked"],
			next_action: { id: "prepare_fresh" },
			activation_restriction: {
				status: "restricted",
				stopped_action: "vault_write",
				cause: { id: "revoked" },
				next_action: { id: "prepare_fresh" },
			},
		});
		expect(JSON.parse(json.stdout).continuation).toMatchObject({
			next_action_id: "prepare_fresh",
		});

		const text = await runVaultGitForTest(argv, {
			composition: fakeComposition(engine),
			launchPrivate: false,
		});
		expect(text.exitCode).toBe(1);
		expect(text.stderr).toContain("cause: revoked | A human revoked this activation evidence.");
		expect(text.stderr).toContain("next: prepare_fresh | Prepare fresh V2 evidence");
		expect(text.stderr).not.toContain("request_operator_admission");
	});

	test("routes activation inspect and prepare through the V2 public result", async () => {
		const frontDoor = fakeActivationFrontDoor();
		const composition = {
			...fakeComposition(fakeEngine()),
			activationFrontDoor: frontDoor,
		};

		const inspected = await runVaultGitForTest(["activation", "--json"], {
			composition,
		});
		const prepared = await runVaultGitForTest(
			["activation", "prepare", "--no-input", "--json"],
			{ composition },
		);

		for (const run of [inspected, prepared]) {
			expect(run.exitCode).toBe(0);
			expect(run.stderr).toBe("");
			expect(JSON.parse(run.stdout)).toMatchObject({
				status: "ok",
				data: {
					contract_id: "vault-git.activation-result",
					schema_version: "2",
					status: "prepared",
					authority: "evidence_only",
					write_permission: "denied",
					changed_state: "none",
					next_action: { id: "review_prepared" },
				},
				continuation: { next_action_id: "review_prepared" },
			});
		}

		const plain = await runVaultGitForTest(["activation"], { composition });
		expect(plain.exitCode).toBe(0);
		expect(plain.stderr).toBe("");
		expect(plain.stdout).toContain("status: prepared");
		expect(plain.stdout).toContain("write_permission: denied");
		expect(plain.stdout).toContain("next: review_prepared");
	});

	test("keeps review non-agent-callable and passes only a confirmed human choice", async () => {
		const decisions: string[] = [];
		const frontDoor = fakeActivationFrontDoor({
			async review(request) {
				decisions.push(request.decision);
				return activatedResult();
			},
		});
		const composition = {
			...fakeComposition(fakeEngine()),
			activationFrontDoor: frontDoor,
		};
		const argv = [
			"activation",
			"review",
			ACTIVATION_EVIDENCE_REFERENCE,
			"--json",
		] as const;

		const nonInteractive = await runVaultGitForTest(argv, {
			composition,
			humanActivationReview: {
				isInteractive: () => false,
				async decide() {
					throw new Error("non-interactive review must not request a decision");
				},
			},
		});
		expect(nonInteractive.exitCode).toBe(1);
		expect(JSON.parse(nonInteractive.stdout)).toMatchObject({
			status: "error",
			error: {
				code: "human_capability_required",
				recoverability: "contact_support",
				retryable: false,
			},
			data: {
				contract_id: "vault-git.activation-result",
				status: "restricted",
				cause: { id: "human_capability_required" },
				changed_state: "none",
				next_action: { id: "return_to_human_review" },
			},
		});
		expect(decisions).toEqual([]);

		const noInput = await runVaultGitForTest([...argv, "--no-input"], {
			composition,
			humanActivationReview: {
				isInteractive: () => true,
				async decide() {
					decisions.push("unexpected-human-review");
					return "activate";
				},
			},
		});
		expect(noInput.exitCode).toBe(1);
		expect(JSON.parse(noInput.stdout).error.code).toBe(
			"human_capability_required",
		);
		expect(decisions).toEqual([]);

		const confirmed = await runVaultGitForTest(argv, {
			composition,
			humanActivationReview: {
				isInteractive: () => true,
				async decide() {
					return "activate";
				},
			},
		});
		expect(confirmed.exitCode).toBe(0);
		expect(JSON.parse(confirmed.stdout).data).toMatchObject({
			status: "activated",
			authority: "human_admission",
			changed_state: "local",
		});
		expect(decisions).toEqual(["activate"]);
	});

	test("marks missing activation configuration retryable after operator repair", async () => {
		const composition = {
			...fakeComposition(fakeEngine()),
			activationConfigurationMissing: ["ssh_identity_file"] as const,
		};

		const result = await runVaultGitForTest(
			["activation", "prepare", "--no-input", "--json"],
			{ composition },
		);

		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "error",
			error: {
				code: "configuration_missing",
				recoverability: "retry",
				retryable: true,
			},
			data: {
				cause: { id: "configuration_missing" },
				missing_configuration: ["ssh_identity_file"],
				next_action: { id: "configure_activation_identity" },
			},
		});
	});

	test("routes explicit Defer and Revoke only after matching human confirmation", async () => {
		const calls: string[] = [];
		const frontDoor = fakeActivationFrontDoor({
			async review(request) {
				calls.push(request.decision);
				return {
					...preparedActivationResult(),
					status: "deferred",
				};
			},
			async revoke() {
				calls.push("revoke");
				return {
					...preparedActivationResult(),
					status: "revoked",
					authority: "none",
					changed_state: "local",
					next_action: {
						id: "prepare_fresh",
						summary: "Prepare fresh evidence before later review.",
					},
				};
			},
		});
		const composition = {
			...fakeComposition(fakeEngine()),
			activationFrontDoor: frontDoor,
		};
		const choices = ["defer", "revoke"] as const;
		for (const choice of choices) {
			const run = await runVaultGitForTest(
				["activation", choice, ACTIVATION_EVIDENCE_REFERENCE, "--json"],
				{
					composition,
					humanActivationReview: {
						isInteractive: () => true,
						async decide() {
							return choice;
						},
					},
				},
			);
			expect(run.exitCode).toBe(0);
			expect(JSON.parse(run.stdout).data.status).toBe(
				choice === "defer" ? "deferred" : "revoked",
			);
		}
		expect(calls).toEqual(["defer", "revoke"]);
	});

	test("keeps the configured dashboard read-only with one continuation", async () => {
		const run = await runVaultGitForTest(["--json"], {
			composition: fakeComposition(fakeEngine()),
			launchPrivate: false,
		});
		const envelope = JSON.parse(run.stdout);
		expect(run.exitCode).toBe(0);
		expect(envelope.data).toMatchObject({
			command: "status",
			outcome: "read_only",
			write_permission: "denied",
			changed_state: "none",
			next_action: { id: "begin_transaction" },
		});
		expect(envelope.runtime_actions).toHaveLength(1);
	});

	test("keeps Doctor authority-free while allowing owner-private task evidence reconciliation", async () => {
		let issueTakeoverToken: boolean | undefined;
		const engine = fakeEngine({
			async doctor(input) {
				issueTakeoverToken = input?.issueTakeoverToken;
				return {
					status: "diagnosed",
					state: "absent",
					phase: "blocked",
					finding: "no_receipt",
					changedState: "none",
					retrySafety: "same_input_safe",
					nextAction: {
						id: "begin_transaction",
						summary: "Begin one transaction before canonical writes.",
					},
					diagnosticsReference: "doctor:fixture",
				};
			},
		});
		const run = await runVaultGitForTest(["doctor", "--json"], {
			composition: fakeComposition(engine),
			launchPrivate: false,
		});
		expect(run.exitCode).toBe(0);
		expect(issueTakeoverToken).toBe(false);
		expect(JSON.parse(run.stdout).data).toMatchObject({
			command: "doctor",
			outcome: "read_only",
			changed_state: "none",
			write_permission: "denied",
		});
	});

	test("maps owner capability read failures to a Doctor-owned recovery action", async () => {
		for (const failure of [
			Object.assign(new Error("missing"), { code: "ENOENT" }),
			Object.assign(new Error("not private"), { code: "EPERM" }),
		]) {
			const composition = fakeComposition(fakeEngine(), {
				async load() {
					return { status: "loaded", receipt: activeReceipt(), history: [], historyPaths: [] };
				},
				async readCapability() {
					throw failure;
				},
			});
			const run = await runVaultGitForTest(
				[
					"complete",
					"--transaction-id",
					activeReceipt().transactionId ?? "missing",
					"--summary",
					"docs(vault): record note",
					"--json",
				],
				{ composition },
			);
			const envelope = JSON.parse(run.stdout);
			const expectedBlocker = failure.code === "ENOENT"
				? "capability_missing"
				: "receipt_conflict";

			expect(run.exitCode).toBe(1);
			expect(envelope).toMatchObject({
				status: "error",
				error: { code: expectedBlocker },
				data: {
					outcome: "refused",
					blockers: [expectedBlocker],
					changed_state: "none",
					next_action: { id: "run_doctor" },
				},
				continuation: { next_action_id: "run_doctor" },
			});
			expect(run.stderr).toBe("");
		}
	});

	test("keeps expired-launch recovery inside the original acknowledgement budget", async () => {
		let state = taskState({
			state: "launching",
			launchGeneration: "launch_expired",
			launchExpiresAt: "1970-01-01T00:00:00.000Z",
			workerPid: 99,
			workerProcessIdentity: "identity-expired",
			launchAttempt: 1,
		});
		const base = fakeComposition(fakeEngine(), {
			async load() {
				return { status: "loaded", receipt: activeReceipt(), history: [], historyPaths: [] };
			},
			async readCapability() {
				return new Uint8Array([1, 2, 3]);
			},
		});
		const composition: VaultGitCliComposition = {
			...base,
			taskStore: {
				repositoryId: "task-store-fixture",
				paths: { repositoryRoot: "/private", claims: "/private/claims", tasks: "/private/tasks" },
				claimPath: () => "/private/claims/receipt",
				async claimOrJoin(input) {
					expect(input.capabilityDigest).toBe(
						createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex"),
					);
					return { status: "existing", launch: "joined", state };
				},
				async load() { return { status: "loaded", state, history: [state] }; },
				async loadByTaskId() { return { status: "loaded", state, history: [state] }; },
				async materializeClaimState() { return { status: "loaded", state }; },
				async transition(_taskId, expectedRevision, changes) {
					expect(expectedRevision).toBe(state.revision);
					state = {
						...state,
						...changes,
						revision: state.revision + 1,
					} as VaultGitTaskState;
					return { status: "transitioned", state };
				},
			},
		};
		let monotonicMs = 0;
		let sleptMs = 0;
		const run = await runVaultGitForTest(
			[
				"complete",
				"--transaction-id",
				activeReceipt().transactionId ?? "missing",
				"--summary",
				"docs(vault): recover launch",
				"--json",
			],
			{
				composition,
				backgroundCompletionRuntime: {
					now: () => monotonicMs,
					async sleep(milliseconds) {
						monotonicMs += milliseconds;
						sleptMs += milliseconds;
					},
					spawnWorker: () => 100,
					readProcessIdentity: () => "replacement-identity",
					async stopExpiredWorker() {
						monotonicMs += 1_000;
						return true;
					},
				},
			},
		);

		expect(run.exitCode).toBe(1);
		expect(JSON.parse(run.stdout)).toMatchObject({
			error: { code: "worker_launch_protocol_failed" },
			data: { task_state: "launching" },
		});
		expect(sleptMs).toBe(500);
		expect(monotonicMs).toBe(1_500);
	});

	test("projects lease_generation verbatim in public task JSON", async () => {
		const state = taskState({ state: "in_progress", phase: "running" });
		const base = fakeComposition(fakeEngine());
		const composition: VaultGitCliComposition = {
			...base,
			taskStore: {
				repositoryId: "task-store-fixture",
				paths: { repositoryRoot: "/private", claims: "/private/claims", tasks: "/private/tasks" },
				claimPath: () => "/private/claims/receipt",
				async claimOrJoin() { throw new Error("claim not expected"); },
				async load() { return { status: "loaded", state, history: [state] }; },
				async loadByTaskId() { return { status: "loaded", state, history: [state] }; },
				async materializeClaimState() { return { status: "loaded", state }; },
				async transition() { throw new Error("transition not expected"); },
			},
		};
		const run = await runVaultGitForTest(
			["status", "--task-id", state.taskId, "--json"],
			{ composition, launchPrivate: false },
		);

		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout).data.lease_generation).toBe(
			state.leaseGeneration,
		);
		expect(run.stdout).toContain(state.leaseGeneration);
	});

	test("reports an unknown task locally with one cause-specific action", async () => {
		const base = fakeComposition(fakeEngine());
		const composition: VaultGitCliComposition = {
			...base,
			taskStore: {
				repositoryId: "task-store-fixture",
				paths: { repositoryRoot: "/private", claims: "/private/claims", tasks: "/private/tasks" },
				claimPath: () => "/private/claims/receipt",
				async claimOrJoin() { throw new Error("claim not expected"); },
				async load() { return { status: "absent" }; },
				async loadByTaskId() { return { status: "absent" }; },
				async materializeClaimState() { return { status: "absent" }; },
				async transition() { throw new Error("transition not expected"); },
			},
		};
		const taskId = "task_11111111111111111111111111111111";
		const run = await runVaultGitForTest(["status", "--task-id", taskId, "--json"], {
			composition,
			launchPrivate: false,
		});
		const envelope = JSON.parse(run.stdout);

		expect(run.exitCode).toBe(1);
		expect(envelope.data).toMatchObject({
			command: "status",
			blockers: ["task_not_found"],
			task_id: taskId,
			next_action: { id: "change_input" },
		});
		expect(envelope.runtime_actions).toHaveLength(1);
		expect(run.stderr).toBe("");
	});

	test("fails closed when selected task state is corrupt", async () => {
		const base = fakeComposition(fakeEngine());
		const composition: VaultGitCliComposition = {
			...base,
			taskStore: {
				repositoryId: "a".repeat(64),
				paths: { repositoryRoot: "/private", claims: "/private/claims", tasks: "/private/tasks" },
				claimPath() { return "/private/claim"; },
				async claimOrJoin() { throw new Error("claim not expected"); },
				async load() { return { status: "absent" }; },
				async loadByTaskId() { return { status: "corrupt", reason: "malformed" }; },
				async materializeClaimState() { return { status: "absent" }; },
				async transition() { throw new Error("transition not expected"); },
			},
		};
		const taskId = "task_22222222222222222222222222222222";
		const run = await runVaultGitForTest(["status", "--task-id", taskId, "--json"], {
			composition,
			launchPrivate: false,
		});
		const envelope = JSON.parse(run.stdout);

		expect(run.exitCode).toBe(1);
		expect(envelope.data).toMatchObject({
			blockers: ["receipt_corrupt"],
			task_id: taskId,
			next_action: { id: "inspect_private_receipt" },
		});
	});

	test("keeps an unexpected runtime failure diagnostic on stderr", async () => {
		const engine = fakeEngine({
			async begin() {
				throw new Error("private implementation detail");
			},
		});
		const run = await runVaultGitForTest(
			[
				"begin",
				"--event",
				"note_created",
				"--path",
				"notes/a.md",
				"--json",
			],
			{ composition: fakeComposition(engine), launchPrivate: false },
		);
		expect(run.exitCode).toBe(1);
		expect(JSON.parse(run.stdout).error.code).toBe("unexpected_runtime_failure");
		expect(run.stderr).toContain("unexpected runtime failure");
		expect(`${run.stdout}${run.stderr}`).not.toContain(
			"private implementation detail",
		);
	});

	test("dispatches janitor and tidy now through the bounded worker triggers", async () => {
		const triggers: string[] = [];
		const base = fakeComposition(fakeEngine());
		const composition: VaultGitCliComposition = {
			...base,
			janitor: {
				async run(input) {
					triggers.push(input.trigger);
					return {
						status: "preview",
						trigger: input.trigger === "tidy_now" ? "tidy_now" : "nightly",
						staleReceipts: [],
						leaseAnomalies: [],
						pushPending: false,
						proposedTransactionGroups: [],
						skippedRepairs: [],
						privateHygiene: { capabilityFiles: 0, doctorTokenRecords: 0, janitorReports: 0 },
						vaultPosture: "normal",
						foregroundNonVaultWorkAllowed: true,
						nextAction: { id: "none", summary: "No repair pending." },
					};
				},
			},
		};
		for (const argv of [["janitor", "--json"], ["tidy", "now", "--json"]]) {
			const run = await runVaultGitForTest(argv, {
				composition,
				launchPrivate: false,
			});
			expect(run.exitCode).toBe(0);
			expect(JSON.parse(run.stdout).data).toMatchObject({
				outcome: "read_only",
				janitor_report: { status: "preview", push_pending: false },
				worker_eligibility: { eligible: true, requires_new_transaction: true },
			});
		}
		expect(triggers).toEqual(["nightly", "tidy_now"]);
	});

	test("dispatches the exact stale takeover path with FD token proof", async () => {
		let observedRepair: VaultGitRepairInput | undefined;
		const engine = fakeEngine({
			async doctor() {
				return {
					status: "diagnosed",
					state: "expired",
					phase: "writing",
					finding: "lease_expired",
					changedState: "none",
					retrySafety: "operator_required",
					nextAction: { id: "run_repair", summary: "Run the admitted repair." },
					diagnosticsReference: "doctor:fixture",
					repairAction: "stale-lease-takeover",
					transactionId: "txn_00000000000000000000000000000001",
					ledgerGeneration: "generation-a",
				};
			},
			async repair(input) {
				observedRepair = input;
				return {
					status: "repaired",
					action: "stale-lease-takeover",
					state: "closed",
					phase: "closed",
					changedState: "remote",
					retrySafety: "same_input_safe",
					nextAction: { id: "none", summary: "No further action." },
					diagnosticsReference: "repair:fixture",
				};
			},
		});
		const composition = fakeComposition(engine, {
			async readDoctorProof() {
				return {
					transactionId: "txn_00000000000000000000000000000001",
					ledgerGeneration: "generation-a",
					receiptId: "receipt-fixture",
					receiptRevision: 1,
					proofFingerprint: "fingerprint-fixture",
					issuedAt: "2026-01-01T00:00:00.000Z",
				};
			},
		});
		const run = await runVaultGitForTest(
			[
				"repair",
				"stale-lease-takeover",
				"--transaction-id",
				"txn_00000000000000000000000000000001",
				"--prior-writer-stopped",
				"--capability-fd",
				"7",
				"--json",
			],
			{
				composition,
				launchPrivate: false,
				readCapability: async () => new Uint8Array([1, 2, 3]),
			},
		);
		expect(run.exitCode).toBe(0);
		expect(observedRepair).toMatchObject({
			action: "stale-lease-takeover",
			transactionId: "txn_00000000000000000000000000000001",
			expectedLedgerGeneration: "generation-a",
			priorWriterStopped: true,
		});
		expect(observedRepair?.doctorToken).toEqual(new Uint8Array([1, 2, 3]));
	});

	test("projects write authority only for active writing resume repairs", async () => {
		const transactionId = "txn_00000000000000000000000000000001";
		const cases = [
			{
				action: "close-verified",
				result: repairResult("close-verified", "closed", "closed", "none"),
				writePermission: "denied",
			},
			{
				action: "retry-push",
				result: repairResult("retry-push", "closed", "closed", "none"),
				writePermission: "denied",
			},
			{
				action: "stale-lease-takeover",
				result: repairResult(
					"stale-lease-takeover",
					"superseded",
					"closed",
					"reconcile_quarantine",
				),
				writePermission: "denied",
			},
			{
				action: "reconcile-quarantine",
				result: repairResult(
					"reconcile-quarantine",
					"closed",
					"closed",
					"none",
				),
				writePermission: "denied",
			},
			{
				action: "resume",
				result: repairResult(
					"resume",
					"active",
					"writing",
					"complete_transaction",
				),
				writePermission: "owner",
			},
		] as const satisfies readonly {
			readonly action: VaultGitRepairAction;
			readonly result: VaultGitRepairResult;
			readonly writePermission: "denied" | "owner";
		}[];

		for (const repairCase of cases) {
			const engine = fakeEngine({
				async doctor() {
					return {
						status: "diagnosed",
						state: "expired",
						phase: "writing",
						finding: "lease_expired",
						changedState: "none",
						retrySafety: "operator_required",
						nextAction: {
							id: "run_repair",
							summary: "Run the admitted repair.",
						},
						diagnosticsReference: "doctor:fixture",
						repairAction: "stale-lease-takeover",
						transactionId,
						ledgerGeneration: "generation-a",
					};
				},
				async repair() {
					return repairCase.result;
				},
			});
			const composition = fakeComposition(engine, {
				async readDoctorProof() {
					return {
						transactionId,
						ledgerGeneration: "generation-a",
						receiptId: "receipt-fixture",
						receiptRevision: 1,
						proofFingerprint: "fingerprint-fixture",
						issuedAt: "2026-01-01T00:00:00.000Z",
					};
				},
			});
			const args = [
				"repair",
				repairCase.action,
				...(repairCase.action === "stale-lease-takeover"
					? ["--transaction-id", transactionId, "--prior-writer-stopped"]
					: []),
				"--capability-fd",
				"7",
			];
			const options = {
				composition,
				launchPrivate: false,
				readCapability: async () => new Uint8Array([1]),
			};

			const json = await runVaultGitForTest([...args, "--json"], options);
			expect(json.exitCode).toBe(0);
			expect(JSON.parse(json.stdout)).toMatchObject({
				status: "ok",
				data: {
					outcome: "repaired",
					phase: repairCase.result.phase,
					transaction_state: repairCase.result.state,
					write_permission: repairCase.writePermission,
					next_action: { id: repairCase.result.nextAction.id },
				},
				continuation: {
					next_action_id: repairCase.result.nextAction.id,
				},
			});

			const plain = await runVaultGitForTest(args, options);
			expect(plain.exitCode).toBe(0);
			expect(plain.stdout).toContain(
				`write_permission: ${repairCase.writePermission}`,
			);
			expect(
				plain.stdout
					.trim()
					.split("\n")
					.filter((line) => line.startsWith("next:")),
			).toEqual([`next: ${repairCase.result.nextAction.id}`]);
		}
	});
});

async function temp(prefix: string): Promise<string> {
	return tempDirectories.create(prefix);
}

function fakeComposition(
	engine: VaultGitTransactionEngine,
	storeOverrides: Partial<VaultGitReceiptStore> = {},
): VaultGitCliComposition {
	// Partial-typed fake: any drift in the VaultGitReceiptStore interface
	// fails typecheck here; the single cast happens at the final assignment.
	const store: Partial<VaultGitReceiptStore> &
		Pick<VaultGitReceiptStore, "load"> = {
		async load() {
			return { status: "absent" as const };
		},
		...storeOverrides,
	};
	const runtime: VaultGitRuntimePort = {
		now: () => new Date(0),
		actor: () => "agent-a",
		host: () => "host-a",
		newReceiptId: () => "receipt-fixture",
		interrupt: () => {},
	};
	return {
		engine,
		janitor: {
			async run(input) {
				return {
					status: "preview",
					trigger: input.trigger === "tidy_now" ? "tidy_now" : "nightly",
					staleReceipts: [],
					leaseAnomalies: [],
					pushPending: false,
					proposedTransactionGroups: [],
					skippedRepairs: [],
					privateHygiene: { capabilityFiles: 0, doctorTokenRecords: 0, janitorReports: 0 },
					vaultPosture: "normal",
					foregroundNonVaultWorkAllowed: true,
					nextAction: { id: "none", summary: "No repair pending." },
				};
			},
		},
		store: store as VaultGitReceiptStore,
		runtime,
		repositoryPath: "/fixture-vault",
		remote: "origin",
		leaseDurationMs: 60_000,
		privateEntrypointPath: import.meta.path,
	};
}

function fakeActivationFrontDoor(
	overrides: Partial<VaultGitActivationFrontDoor> = {},
): VaultGitActivationFrontDoor {
	return {
		async inspect() {
			return preparedActivationResult();
		},
		async prepare() {
			return preparedActivationResult();
		},
		async review() {
			return activatedResult();
		},
		async revoke() {
			return {
				...preparedActivationResult(),
				status: "revoked",
				authority: "none",
				changed_state: "local",
				next_action: {
					id: "prepare_fresh",
					summary: "Prepare fresh evidence before later review.",
				},
			};
		},
		async validate() {
			return {
				status: "admitted",
				evidenceId: ACTIVATION_EVIDENCE_REFERENCE,
			};
		},
		...overrides,
	};
}

function preparedActivationResult() {
	return {
		contract_id: "vault-git.activation-result" as const,
		schema_version: "2" as const,
		status: "prepared" as const,
		authority: "evidence_only" as const,
		write_permission: "denied" as const,
		changed_state: "none" as const,
		evidence_reference: ACTIVATION_EVIDENCE_REFERENCE,
		captured_at: "2026-08-12T00:00:00.000Z",
		display_fresh_until: "2026-08-12T00:10:00.000Z",
		next_action: {
			id: "review_prepared" as const,
			summary: "Review the prepared evidence without granting write permission.",
		},
	};
}

function activatedResult() {
	return {
		contract_id: "vault-git.activation-result" as const,
		schema_version: "2" as const,
		status: "activated" as const,
		authority: "human_admission" as const,
		write_permission: "denied" as const,
		changed_state: "local" as const,
		evidence_reference: ACTIVATION_EVIDENCE_REFERENCE,
		next_action: {
			id: "begin_transaction" as const,
			summary: "Begin one fenced transaction.",
		},
	};
}

function fakeEngine(
	overrides: Partial<VaultGitTransactionEngine> = {},
): VaultGitTransactionEngine {
	return {
		async begin() {
			return engineResult();
		},
		async join() {
			return engineResult();
		},
		async complete() {
			return engineResult();
		},
		async inspect() {
			return engineResult();
		},
		async recordPhase() {
			return engineResult();
		},
		async doctor() {
			throw new Error("doctor not expected");
		},
		async repair() {
			throw new Error("repair not expected");
		},
		async inspectJanitorPreflight() {
			throw new Error("Janitor preflight not expected");
		},
		async readCheckerAdmission() {
			return null;
		},
		async prunePrivateHygiene() {
			return { capabilityFiles: 0, doctorTokenRecords: 0, janitorReports: 0 };
		},
		async recordJanitorReport() {},
		async runHygieneTransaction() {
			throw new Error("hygiene transaction not expected");
		},
		...overrides,
	};
}

function engineResult(
	overrides: Partial<VaultGitEngineResult> = {},
): VaultGitEngineResult {
	return {
		status: "inspected",
		state: "absent",
		phase: "blocked",
		writePermission: "denied",
		changedState: "none",
		retrySafety: "same_input_safe",
		nextAction: {
			id: "begin_transaction",
			summary: "Begin one transaction before canonical writes.",
		},
		...overrides,
	};
}

function repairResult(
	action: VaultGitRepairAction,
	state: VaultGitRepairResult["state"],
	phase: VaultGitRepairResult["phase"],
	nextAction: VaultGitRepairResult["nextAction"]["id"],
): VaultGitRepairResult {
	return {
		status: "repaired",
		action,
		state,
		phase,
		changedState: "none",
		retrySafety: "same_input_safe",
		nextAction: { id: nextAction, summary: "Fixture next action." },
		diagnosticsReference: "repair:fixture",
	};
}

function activeReceipt(): VaultGitReceipt {
	return {
		schemaVersion: 2,
		receiptId: "receipt_11111111111111111111111111111111",
		transactionId: "txn_11111111111111111111111111111111",
		revision: 2,
		phase: "writing",
		transition: "write_authority_granted",
		recordedAt: "2026-08-13T00:00:00.000Z",
		event: "note_created",
		actor: "agent-a",
		host: "host-a",
		remote: "origin",
		ownedPaths: [
			{ path: "notes/example.md", baselineHash: null, admittedNewFile: true },
		],
		unrelatedState: { statusHex: "", indexHex: "" },
		localMainHead: "a".repeat(40),
		remoteMainHead: "a".repeat(40),
		expectedLeaseGeneration: "b".repeat(40),
		leaseGeneration: "c".repeat(40),
		leaseAcquiredAt: "2026-08-13T00:00:00.000Z",
		leaseDurationMs: 60_000,
		commitId: null,
		expectedMainCommit: null,
		ledgerReleaseId: null,
		pushOutcome: "not_attempted",
		nextSafeAction: "resume_writing",
		diagnosticsReference: "receipt:fixture",
	};
}

function taskState(overrides: Partial<VaultGitTaskState> = {}): VaultGitTaskState {
	return {
		schemaVersion: 1,
		taskId: "task_11111111111111111111111111111111",
		receiptId: activeReceipt().receiptId,
		transactionId: activeReceipt().transactionId ?? "missing",
		leaseGeneration: activeReceipt().leaseGeneration ?? "missing",
		revision: 1,
		state: "claimed",
		phase: "admitted",
		recordedAt: "1970-01-01T00:00:00.000Z",
		updatedAt: "1970-01-01T00:00:00.000Z",
		heartbeatAt: null,
		checkpoint: null,
		launchGeneration: null,
		launchExpiresAt: null,
		workerPid: null,
		workerProcessIdentity: null,
		launchAttempt: 0,
		terminalResult: null,
		...overrides,
	};
}
