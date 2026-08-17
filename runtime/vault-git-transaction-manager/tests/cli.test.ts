import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
import { createVaultGitDoctorTaskStore } from "../src/doctor-task-store.ts";
import {
	createVaultGitTaskStore,
	type VaultGitTaskStore,
} from "../src/task-store.ts";
import { projectVaultGitNextAction } from "../src/next-safe-action.ts";
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
	test("rejects a Background Doctor delegate without main", async () => {
		const delegateRoot = await temp("vault-git-doctor-delegate-");
		const delegatePath = join(delegateRoot, "delegate.ts");
		await writeFile(delegatePath, "export const unavailable = true;\n");

		const worker = spawnSync(
			process.execPath,
			[join(import.meta.dir, "../src/doctor-worker.ts")],
			{
				encoding: "utf8",
				env: {
					...process.env,
					VAULT_GIT_DOCTOR_TASK_DELEGATE_ENTRYPOINT: delegatePath,
				},
			},
		);

		expect(worker.status).not.toBe(0);
		expect(worker.stderr).toContain(
			"Background Doctor delegate main unavailable",
		);
	});

	test("maps a failed Doctor spawn without an unhandled child error", async () => {
		const stateRoot = await temp("vault-git-doctor-spawn-");
		const repositoryId = "a".repeat(64);
		let receiptLoads = 0;
		const composition: VaultGitCliComposition = {
			...fakeComposition(fakeEngine(), {
				async load() {
					receiptLoads += 1;
					return {
						status: "loaded",
						receipt: activeReceipt(),
						history: [],
						historyPaths: [],
					};
				},
				async readActivation() {
					return null;
				},
			}),
			repositoryPath: join(stateRoot, "missing-checkout"),
			doctorTaskStore: createVaultGitDoctorTaskStore({
				stateRoot,
				repositoryId,
			}),
		};

		const run = await runVaultGitForTest(["doctor", "--json"], {
			composition,
			env: { PATH: process.env.PATH },
		});
		await Bun.sleep(0);

		expect(run.exitCode).toBe(1);
		expect(JSON.parse(run.stdout)).toMatchObject({
			error: { code: "worker_launch_failed" },
			data: { blockers: ["worker_launch_failed"] },
		});
		expect(receiptLoads).toBe(1);
	});

	test("terminalizes Background Doctor execution and publication failures", async () => {
		for (const failurePoint of ["execution", "terminalization"] as const) {
			const stateRoot = await temp("vault-git-doctor-worker-failure-");
			const repositoryId = "a".repeat(64);
			const durableStore = createVaultGitDoctorTaskStore({
				stateRoot,
				repositoryId,
			});
			const binding = {
				repositoryId,
				activationEvidenceId: null,
				receiptId: `receipt_${"b".repeat(32)}`,
				receiptRevision: 7,
				transactionId: `txn_${"c".repeat(32)}`,
				normalizedInput: '{"command":"doctor"}',
			} as const;
			const admitted = await durableStore.claimOrJoin(
				binding,
				"1970-01-01T00:00:00.000Z",
			);
			const launchGeneration = `doctor_launch_${"d".repeat(32)}`;
			const launching = await durableStore.transition(
				admitted.state.taskId,
				admitted.state.revision,
				{
					state: "launching",
					phase: "admitted",
					updatedAt: "1970-01-01T00:00:00.000Z",
					heartbeatAt: null,
					checkpoint: "local_classified",
					launchGeneration,
					launchExpiresAt: "1970-01-01T00:00:02.000Z",
					workerPid: process.pid,
					workerProcessIdentity: "f".repeat(64),
					launchAttempt: 1,
					terminalResult: null,
				},
			);
			if (launching.status !== "transitioned") throw new Error("launch lost");
			const doctorTaskStore = {
				...durableStore,
				async transition(
					...args: Parameters<typeof durableStore.transition>
				) {
					if (
						failurePoint === "terminalization" &&
						args[2].terminalResult?.kind === "doctor_result"
					) {
						return { status: "stale" as const, state: launching.state };
					}
					return durableStore.transition(...args);
				},
			};
			const engine = fakeEngine({
				async doctor() {
					if (failurePoint === "execution") {
						throw new Error("Doctor execution unavailable");
					}
					return {
						status: "diagnosed",
						state: "repairable",
						phase: "writing",
						finding: "writes_in_progress",
						changedState: "none",
						retrySafety: "same_input_safe",
						nextAction: { id: "run_repair", summary: "Run repair." },
						diagnosticsReference: "doctor:fixture",
						transactionId: binding.transactionId,
						repairAction: "resume",
					};
				},
			});
			const composition: VaultGitCliComposition = {
				...fakeComposition(engine),
				doctorTaskStore,
			};

			const run = await runVaultGitForTest(["doctor", "--json"], {
				composition,
				launchPrivate: false,
				env: {
					VAULT_GIT_DOCTOR_TASK_ID: admitted.state.taskId,
					VAULT_GIT_DOCTOR_TASK_LAUNCH_GENERATION: launchGeneration,
				},
			});

			expect(run.exitCode).toBe(1);
			expect(JSON.parse(run.stdout).error.code).toBe(
				"unexpected_runtime_failure",
			);
			await expect(
				durableStore.loadByTaskId(admitted.state.taskId),
			).resolves.toMatchObject({
				status: "loaded",
				state: {
					state: "unknown",
					phase: "terminal",
					terminalResult: {
						kind: "worker_failure",
						blocker: "worker_lost",
					},
				},
			});
		}
	});

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
					schema_version: "3",
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
					next_action: projectVaultGitNextAction({
						id: "prepare_fresh",
						summary: "Prepare fresh evidence before later review.",
					}),
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
				async authorizeRepair() { return { status: "refused" }; },
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
					stopUnacknowledgedWorker() {},
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

	test("stops a spawned worker when process identity registration fails", async () => {
		let state = taskState();
		const stoppedPids: number[] = [];
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
				async claimOrJoin() {
					return { status: "created", launch: "winner", state };
				},
				async load() { return { status: "loaded", state }; },
				async loadByTaskId() { return { status: "loaded", state }; },
				async materializeClaimState() { return { status: "loaded", state }; },
				async authorizeRepair() { return { status: "refused" }; },
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
		const run = await runVaultGitForTest(
			[
				"complete",
				"--transaction-id",
				activeReceipt().transactionId ?? "missing",
				"--summary",
				"docs(vault): register worker",
				"--json",
			],
			{
				composition,
				backgroundCompletionRuntime: {
					now: () => monotonicMs,
					async sleep(milliseconds) {
						monotonicMs += milliseconds;
					},
					spawnWorker: () => 101,
					readProcessIdentity() {
						throw new Error("identity unavailable");
					},
					stopUnacknowledgedWorker(pid) {
						stoppedPids.push(pid);
					},
					async stopExpiredWorker() {
						throw new Error("expired worker stop not expected");
					},
				},
			},
		);

		expect(stoppedPids).toEqual([101]);
		expect(run.exitCode).toBe(1);
		expect(JSON.parse(run.stdout)).toMatchObject({
			error: { code: "worker_launch_failed" },
			data: { task_state: "repair_needed" },
		});
	});

	test("projects exact attempt evidence in public task JSON and plain output", async () => {
		const state = taskState({
			state: "in_progress",
			phase: "running",
			attemptNumber: 2,
			previousTerminalResult: {
				outcome: "refused",
				phase: "checking",
				blocker: "vault_check_failed",
				changedState: "local",
				retrySafety: "operator_required",
				validationFailure: {
					failureClass: "vault_content",
					stage: "vault_check",
				},
			},
		});
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
				async authorizeRepair() { return { status: "refused" }; },
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
		expect(JSON.parse(run.stdout).data.task_attempt_number).toBe(2);
		expect(JSON.parse(run.stdout).data.task_previous_failure).toMatchObject({
			blocker: "vault_check_failed",
			validationFailure: {
				failureClass: "vault_content",
				stage: "vault_check",
			},
		});
		expect(run.stdout).toContain(state.leaseGeneration);

		const plain = await runVaultGitForTest(
			["status", "--task-id", state.taskId],
			{ composition, launchPrivate: false },
		);
		expect(plain.exitCode).toBe(0);
		expect(plain.stdout).toContain("task_attempt_number: 2");
		expect(plain.stdout).toContain(
			"task_previous_failure: vault_check_failed",
		);
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
				async authorizeRepair() { return { status: "absent" }; },
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

	test("reports an unknown Doctor Task with its bindable Doctor Task id contract", async () => {
		const stateRoot = await temp("vault-git-missing-doctor-task-");
		const composition: VaultGitCliComposition = {
			...fakeComposition(fakeEngine()),
			doctorTaskStore: createVaultGitDoctorTaskStore({
				stateRoot,
				repositoryId: "e".repeat(64),
			}),
		};
		const taskId = `doctor_task_${"1".repeat(32)}`;
		const run = await runVaultGitForTest(
			["doctor", "--task-id", taskId, "--json"],
			{ composition, launchPrivate: false },
		);
		const envelope = JSON.parse(run.stdout);

		expect(run.exitCode).toBe(1);
		expect(envelope.data).toMatchObject({
			command: "doctor",
			blockers: ["task_not_found"],
			task_id: taskId,
			next_action: {
				kind: "needs_input",
				id: "change_input",
				action_id: "correct_doctor_task_id",
				input_contract_id: "vault-git.doctor-task-id",
				fields: [{ id: "doctor_task_id", input_channel: "public" }],
			},
		});
		expect(envelope.data.blockers).not.toContain("continuation_unavailable");
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
				async authorizeRepair() { return { status: "refused" }; },
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

	test("known engine and Janitor recovery states keep executable continuations", async () => {
		const transactionId = `txn_${"2".repeat(32)}`;
		const repairableEngine = fakeEngine({
			async inspect() {
				return engineResult({
					state: "repairable",
					phase: "writing",
					retrySafety: "same_input_unsafe",
					transactionId,
					nextAction: {
						id: "run_repair",
						summary: "Run the classified repair.",
					},
				});
			},
		});
		const status = await runVaultGitForTest(["status", "--json"], {
			composition: fakeComposition(repairableEngine),
			launchPrivate: false,
		});
		const statusData = JSON.parse(status.stdout).data;
		expect(statusData).toMatchObject({
			retry_safety: "same_input_unsafe",
			next_action: {
				kind: "invoke",
				id: "run_doctor",
				action_id: "run_doctor",
				argv: ["doctor", "--transaction-id", transactionId, "--json"],
			},
		});
		expect(statusData.blockers).not.toContain("continuation_unavailable");

		const base = fakeComposition(fakeEngine());
		const janitorComposition: VaultGitCliComposition = {
			...base,
			janitor: {
				async run() {
					return {
						status: "refused",
						trigger: "nightly",
						staleReceipts: [],
						leaseAnomalies: [],
						pushPending: false,
						proposedTransactionGroups: [],
						skippedRepairs: [],
						privateHygiene: {
							capabilityFiles: 0,
							doctorTokenRecords: 0,
							janitorReports: 0,
						},
						blocker: "remote_unavailable",
						changedState: "none",
						vaultPosture: "normal",
						foregroundNonVaultWorkAllowed: true,
						nextAction: {
							id: "retry_remote",
							summary: "Restore remote access, then retry Janitor.",
						},
					};
				},
			},
		};
		const janitor = await runVaultGitForTest(["janitor", "--json"], {
			composition: janitorComposition,
			launchPrivate: false,
		});
		const janitorData = JSON.parse(janitor.stdout).data;
		expect(janitorData).toMatchObject({
			retry_safety: "same_input_safe",
			blockers: ["remote_unavailable"],
			next_action: {
				kind: "invoke",
				id: "run_janitor",
				action_id: "run_janitor",
				argv: ["janitor", "--json"],
			},
		});
		expect(janitorData.blockers).not.toContain("continuation_unavailable");
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
			const envelope = JSON.parse(json.stdout);
			expect(envelope).toMatchObject({
				status: "ok",
				data: {
					outcome: "repaired",
					phase: repairCase.result.phase,
					transaction_state: repairCase.result.state,
					write_permission: repairCase.writePermission,
					next_action: { id: repairCase.result.nextAction.id },
				},
			});
			// A terminal none repair result omits the continuation (nothing to run and
			// nothing to escalate); a runnable result references its runtime action.
			if (repairCase.result.nextAction.id === "none") {
				expect(envelope.continuation).toBeUndefined();
				expect(envelope.runtime_actions).toBeUndefined();
			} else {
				expect(envelope.continuation).toEqual({
					next_action_id: repairCase.result.nextAction.id,
				});
				expect(envelope.runtime_actions).toHaveLength(1);
				expect(envelope.runtime_actions[0].id).toBe(
					envelope.data.next_action.id,
				);
				expect(envelope.runtime_actions[0].id).toBe(
					envelope.continuation.next_action_id,
				);
			}

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

	test("repair projection binds the receipt-owned transaction id when the caller omits the selector", async () => {
		const receiptTransactionId = "txn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const engine = fakeEngine({
			async repair() {
				return {
					...repairResult(
						"reconcile-quarantine",
						"superseded",
						"closed",
						"reconcile_quarantine",
					),
					transactionId: receiptTransactionId,
				};
			},
		});
		const run = await runVaultGitForTest(
			["repair", "reconcile-quarantine", "--capability-fd", "7", "--json"],
			{
				composition: fakeComposition(engine),
				launchPrivate: false,
				readCapability: async () => new Uint8Array([1]),
			},
		);
		expect(run.exitCode).toBe(0);
		const envelope = JSON.parse(run.stdout);
		expect(envelope.data.transaction_id).toBe(receiptTransactionId);
		expect(envelope.data.next_action).toMatchObject({
			kind: "invoke",
			action_id: "reconcile_quarantine",
			executable: "vault-git",
			argv: [
				"repair",
				"reconcile-quarantine",
				"--transaction-id",
				receiptTransactionId,
				"--json",
			],
		});
		expect(envelope.data.blockers ?? []).not.toContain(
			"continuation_unavailable",
		);
	});

	test("repair projection prefers the receipt-owned transaction id over a mismatched caller selector", async () => {
		const receiptTransactionId = "txn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const hostileTransactionId = "txn_00000000000000000000000000000001";
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
					transactionId: hostileTransactionId,
					ledgerGeneration: "generation-a",
				};
			},
			async repair() {
				return {
					...repairResult(
						"stale-lease-takeover",
						"superseded",
						"closed",
						"reconcile_quarantine",
					),
					transactionId: receiptTransactionId,
				};
			},
		});
		const composition = fakeComposition(engine, {
			async readDoctorProof() {
				return {
					transactionId: hostileTransactionId,
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
				hostileTransactionId,
				"--prior-writer-stopped",
				"--capability-fd",
				"7",
				"--json",
			],
			{
				composition,
				launchPrivate: false,
				readCapability: async () => new Uint8Array([1]),
			},
		);
		expect(run.exitCode).toBe(0);
		const envelope = JSON.parse(run.stdout);
		expect(envelope.data.transaction_id).toBe(receiptTransactionId);
		expect(envelope.data.next_action).toMatchObject({
			kind: "invoke",
			action_id: "reconcile_quarantine",
			argv: [
				"repair",
				"reconcile-quarantine",
				"--transaction-id",
				receiptTransactionId,
				"--json",
			],
		});
		expect(JSON.stringify(envelope.data.next_action.argv)).not.toContain(
			hostileTransactionId,
		);
	});
});

// U1 (ADR-0002 point 4, 7): data.next_action is the authoritative Next Safe Action
// union at the public CLI, and facade runtime_actions, continuation.next_action_id,
// and the human `next:` line all derive from that one union. A terminal none result
// emits no facade runtime action. The Completion Task semantic-ID reader stays
// regression-covered by reading REAL persisted task state. Real owners:
// createVaultGitTaskStore (persisted reader, not faked) injected into a fakeEngine
// composition, driven through status --task-id.
describe("vault-git U1 next_action union at the public CLI", () => {
	const RECEIPT_ID = "receipt_10101010101010101010101010101010";
	const TXN_ID = "txn_20202020202020202020202020202020";
	const LEASE = "a".repeat(40);
	const LAUNCH = "launch_30303030303030303030303030303030";
	const REPO_IDENTITY = "vault@u1-cli";
	const REPO_ID = createHash("sha256").update(REPO_IDENTITY).digest("hex");

	function completionTaskComposition(
		taskStore: VaultGitTaskStore,
	): VaultGitCliComposition {
		// Fake engine only; the persisted task reader is the REAL store.
		return { ...fakeComposition(fakeEngine()), taskStore } as VaultGitCliComposition;
	}

	function historyDir(stateRoot: string, taskId: string): string {
		return join(
			stateRoot,
			"vault-git-transaction-manager",
			REPO_ID,
			"tasks",
			taskId,
			"history",
		);
	}

	async function rawHistory(
		stateRoot: string,
		taskId: string,
	): Promise<{ names: string[]; bytes: Record<string, string> }> {
		const dir = historyDir(stateRoot, taskId);
		const names = (await readdir(dir)).filter((n) => /^\d{12}\.json$/.test(n)).sort();
		const bytes: Record<string, string> = {};
		for (const name of names) bytes[name] = await readFile(join(dir, name), "utf8");
		return { names, bytes };
	}

	// Build genuine persisted Completion Task state through the store's public
	// methods, then advance to the requested terminal/live state.
	async function seedTask(
		stateRoot: string,
		advance: Parameters<VaultGitTaskStore["transition"]>[2],
	): Promise<{ store: VaultGitTaskStore; taskId: string }> {
		const store = createVaultGitTaskStore({
			stateRoot,
			repositoryIdentity: REPO_IDENTITY,
		});
		const admitted = await store.claimOrJoin({
			claimReceiptId: RECEIPT_ID,
			receiptId: RECEIPT_ID,
			transactionId: TXN_ID,
			remote: "origin",
			generation: LEASE,
			capabilityDigest: "0".repeat(64),
			normalizedInput: '{"command":"complete"}',
			recordedAt: "2026-08-13T09:00:00.000Z",
		});
		if (admitted.status === "refused") throw new Error("seed claim refused");
		const moved = await store.transition(
			admitted.state.taskId,
			admitted.state.revision,
			advance,
		);
		if (moved.status !== "transitioned") throw new Error("seed transition failed");
		return { store, taskId: admitted.state.taskId };
	}

	test("the private completion worker copies the engine validation failure into the durable terminal task", async () => {
		const stateRoot = await temp("vault-git-worker-validation-failure-");
		const { store, taskId } = await seedTask(stateRoot, {
			state: "launching",
			phase: "admitted",
			updatedAt: "2026-08-13T09:00:01.000Z",
			heartbeatAt: null,
			checkpoint: null,
			launchGeneration: LAUNCH,
			launchExpiresAt: "2026-08-13T09:10:00.000Z",
			workerPid: process.pid,
			workerProcessIdentity: "f".repeat(64),
			launchAttempt: 1,
			terminalResult: null,
		});
		const engine = fakeEngine({
			async complete() {
				return {
					status: "refused",
					state: "repairable",
					phase: "repairable",
					writePermission: "denied",
					changedState: "local",
					retrySafety: "same_input_unsafe",
					nextAction: {
						id: "run_repair",
						summary: "Repair the vault-owned check failure before replaying completion.",
					},
					blocker: "vault_check_failed",
					validationFailure: {
						failureClass: "vault_content",
						stage: "vault_check",
					},
				};
			},
		});
		const base = fakeComposition(engine);
		const composition: VaultGitCliComposition = {
			...base,
			taskStore: store,
			runtime: {
				...base.runtime,
				now: () => new Date("2026-08-13T09:00:02.000Z"),
			},
		};
		const run = await runVaultGitForTest(
			[
				"complete",
				"--transaction-id",
				TXN_ID,
				"--summary",
				"docs(vault): background completion",
				"--capability-fd",
				"7",
				"--json",
			],
			{
				composition,
				launchPrivate: false,
				readCapability: async () => new Uint8Array(32),
				env: {
					VAULT_GIT_TASK_ID: taskId,
					VAULT_GIT_TASK_LAUNCH_GENERATION: LAUNCH,
				},
			},
		);
		expect(run.exitCode).toBe(1);
		const reloaded = await store.loadByTaskId(taskId);
		expect(reloaded).toMatchObject({
			status: "loaded",
			state: {
				state: "repair_needed",
				phase: "terminal",
				terminalResult: {
					blocker: "vault_check_failed",
					validationFailure: {
						failureClass: "vault_content",
						stage: "vault_check",
					},
				},
			},
		});
	});

	// Point 4 + contextual split: a live Completion Task read through the REAL store
	// projects the authoritative union with semantic action_id inspect_completion_task
	// and exact argv, while the compat id preserves the legacy inspect_status. The
	// facade surfaces derive from the same union; the persisted history is unchanged
	// by the read.
	test("live Completion Task reads to the inspect_completion_task union with unchanged history", async () => {
		const stateRoot = await temp("vault-git-u1-cli-live-");
		const { store, taskId } = await seedTask(stateRoot, {
			state: "in_progress",
			phase: "running",
			updatedAt: "2026-08-13T09:00:01.000Z",
			heartbeatAt: "2026-08-13T09:00:01.000Z",
			checkpoint: "checking",
			launchGeneration: LAUNCH,
			launchAttempt: 1,
			terminalResult: null,
		});
		const before = await rawHistory(stateRoot, taskId);

		const run = await runVaultGitForTest(
			["status", "--task-id", taskId, "--json"],
			{ composition: completionTaskComposition(store), launchPrivate: false },
		);
		expect(run.stderr).toBe("");
		const envelope = JSON.parse(run.stdout);
		const next = envelope.data.next_action;
		// Authoritative semantic id + exact argv.
		expect(next).toMatchObject({
			kind: "invoke",
			action_id: "inspect_completion_task",
			executable: "vault-git",
			argv: ["status", "--task-id", taskId, "--json"],
		});
		// Legacy compatibility id preserved on the union.
		expect(next.id).toBe("inspect_status");
		// One projection drives both facade surfaces (compat id).
		expect(envelope.continuation.next_action_id).toBe(next.id);
		expect(envelope.runtime_actions[0].id).toBe(next.id);
		expect(envelope.data.schema_version).toBe("2");

		// The read did not rewrite persisted history bytes or revision.
		const after = await rawHistory(stateRoot, taskId);
		expect(after.names).toEqual(before.names);
		expect(after.bytes).toEqual(before.bytes);
	});

	// Point 4: plain lane derives the human `next:` line from the same union compat id.
	test("plain lane derives the human next: line from the same union id", async () => {
		const stateRoot = await temp("vault-git-u1-cli-plain-");
		const { store, taskId } = await seedTask(stateRoot, {
			state: "in_progress",
			phase: "running",
			updatedAt: "2026-08-13T09:00:01.000Z",
			heartbeatAt: "2026-08-13T09:00:01.000Z",
			checkpoint: "checking",
			launchGeneration: LAUNCH,
			launchAttempt: 1,
			terminalResult: null,
		});
		const composition = completionTaskComposition(store);
		const json = await runVaultGitForTest(
			["status", "--task-id", taskId, "--json"],
			{ composition, launchPrivate: false },
		);
		const plain = await runVaultGitForTest(["status", "--task-id", taskId], {
			composition,
			launchPrivate: false,
		});
		const unionId = JSON.parse(json.stdout).data.next_action.id;
		expect(plain.stdout).toContain(`next: ${unionId}`);
		expect(plain.stdout).not.toContain('"contract_id"');
	});

	// Point 4: a closed Completion Task deterministically emits a terminal none
	// continuation (cli.ts action("none")); a none union emits NO facade runtime
	// action. Asserted unconditionally against real persisted terminal state.
	test("a closed Completion Task emits a terminal none union with no runtime action", async () => {
		const stateRoot = await temp("vault-git-u1-cli-none-");
		const { store, taskId } = await seedTask(stateRoot, {
			state: "closed",
			phase: "terminal",
			updatedAt: "2026-08-13T09:00:01.000Z",
			heartbeatAt: null,
			checkpoint: "closed",
			launchGeneration: LAUNCH,
			launchAttempt: 1,
			terminalResult: {
				outcome: "completed",
				phase: "closed",
				changedState: "none",
				blocker: null,
				retrySafety: "same_input_safe",
			},
		});
		const run = await runVaultGitForTest(
			["status", "--task-id", taskId, "--json"],
			{ composition: completionTaskComposition(store), launchPrivate: false },
		);
		const envelope = JSON.parse(run.stdout);
		expect(envelope.data.next_action.kind).toBe("none");
		expect(envelope.data.next_action.id).toBe("none");
		// The facade omits runtime_actions entirely (never an empty array) for a
		// terminal none, and a legitimate terminal stop carries no continuation.
		expect(envelope.runtime_actions).toBeUndefined();
		expect(envelope.continuation).toBeUndefined();
	});

	// Point 5 through the public CLI: a terminal Doctor Task whose legacy persisted
	// continuation is inspect_status must project to inspect_doctor_task (a Doctor
	// Task inspection), NEVER inspect_transaction. Real owner: createVaultGitDoctorTaskStore
	// injected into the CLI; the legacy terminal history is pre-existing on-disk data.
	test("a legacy Doctor Task terminal inspect_status projects to inspect_doctor_task via the CLI", async () => {
		const stateRoot = await temp("vault-git-u1-cli-doctor-legacy-");
		const doctorRepoId = "a".repeat(64);
		const doctorTaskId = `doctor_task_${"7".repeat(32)}`;
		const historyDir = join(
			stateRoot,
			"vault-git-transaction-manager",
			doctorRepoId,
			"doctor-tasks",
			doctorTaskId,
			"history",
		);
		await mkdir(historyDir, { recursive: true, mode: 0o700 });
		const legacyState = {
			schemaVersion: 1,
			taskId: doctorTaskId,
			bindingDigest: "d".repeat(64),
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: `txn_${"c".repeat(32)}`,
			revision: 3,
			state: "closed",
			phase: "terminal",
			recordedAt: "2026-08-14T01:00:00.000Z",
			updatedAt: "2026-08-14T01:00:03.000Z",
			heartbeatAt: null,
			checkpoint: "terminal",
			launchGeneration: `doctor_launch_${"9".repeat(32)}`,
			launchExpiresAt: null,
			workerPid: null,
			workerProcessIdentity: null,
			launchAttempt: 1,
			terminalResult: {
				kind: "doctor_result",
				status: "diagnosed",
				state: "repairable",
				phase: "writing",
				finding: "writes_in_progress",
				changedState: "none",
				retrySafety: "same_input_safe",
				nextAction: { id: "inspect_status", summary: "legacy text" },
				repairAction: "resume",
				transactionId: `txn_${"c".repeat(32)}`,
			},
		};
		const file = join(historyDir, "000000000003.json");
		await writeFile(file, `${JSON.stringify(legacyState, null, 2)}\n`, { mode: 0o600 });
		await chmod(file, 0o600);

		const composition = {
			...fakeComposition(fakeEngine()),
			doctorTaskStore: createVaultGitDoctorTaskStore({
				stateRoot,
				repositoryId: doctorRepoId,
			}),
		} as VaultGitCliComposition;
		const run = await runVaultGitForTest(
			["doctor", "--task-id", doctorTaskId, "--json"],
			{ composition, launchPrivate: false },
		);
		const next = JSON.parse(run.stdout).data.next_action;
		// Authoritative Doctor Task inspection, not a transaction inspection.
		expect(next).toMatchObject({
			kind: "invoke",
			action_id: "inspect_doctor_task",
			executable: "vault-git",
			argv: ["doctor", "--task-id", doctorTaskId, "--json"],
		});
		expect(next.id).toBe("inspect_status");
		expect(next.summary).toBe("Inspect the Doctor Task.");
		expect(run.stdout).not.toContain("legacy text");
		// The read did not rewrite the legacy on-disk history bytes.
		expect(await readFile(file, "utf8")).toBe(
			`${JSON.stringify(legacyState, null, 2)}\n`,
		);
	});

	test("Doctor Task terminal context survives legacy run_repair and semantic retry_remote reads", async () => {
		const transactionId = `txn_${"c".repeat(32)}`;
		const cases = [
			{
				label: "legacy-run-repair",
				repositoryId: "c".repeat(64),
				taskId: `doctor_task_${"5".repeat(32)}`,
				terminalAction: {
					nextAction: { id: "run_repair", summary: "legacy repair" },
					repairAction: "resume",
				},
				expected: {
					action_id: "run_repair",
					argv: [
						"repair",
						"resume",
						"--transaction-id",
						transactionId,
						"--json",
					],
				},
			},
			{
				label: "semantic-retry-remote",
				repositoryId: "d".repeat(64),
				taskId: `doctor_task_${"6".repeat(32)}`,
				terminalAction: { nextActionId: "retry_remote" },
				expected: {
					action_id: "inspect_remote_lease",
					argv: [
						"doctor",
						"--transaction-id",
						transactionId,
						"--json",
					],
				},
			},
		] as const;

		for (const fixture of cases) {
			const stateRoot = await temp(`vault-git-u1-cli-${fixture.label}-`);
			const historyDir = join(
				stateRoot,
				"vault-git-transaction-manager",
				fixture.repositoryId,
				"doctor-tasks",
				fixture.taskId,
				"history",
			);
			await mkdir(historyDir, { recursive: true, mode: 0o700 });
			const state = {
				schemaVersion: 1,
				taskId: fixture.taskId,
				bindingDigest: "d".repeat(64),
				receiptId: `receipt_${"b".repeat(32)}`,
				receiptRevision: 7,
				transactionId,
				revision: 3,
				state: "closed",
				phase: "terminal",
				recordedAt: "2026-08-14T01:00:00.000Z",
				updatedAt: "2026-08-14T01:00:03.000Z",
				heartbeatAt: null,
				checkpoint: "terminal",
				launchGeneration: `doctor_launch_${"9".repeat(32)}`,
				launchExpiresAt: null,
				workerPid: null,
				workerProcessIdentity: null,
				launchAttempt: 1,
				terminalResult: {
					kind: "doctor_result",
					status: "diagnosed",
					state: "repairable",
					phase: "writing",
					finding: "writes_in_progress",
					changedState: "none",
					retrySafety: "same_input_safe",
					...fixture.terminalAction,
					transactionId,
				},
			};
			const historyPath = join(historyDir, "000000000003.json");
			await writeFile(historyPath, `${JSON.stringify(state, null, 2)}\n`, {
				mode: 0o600,
			});
			await chmod(historyPath, 0o600);

			const composition = {
				...fakeComposition(fakeEngine()),
				doctorTaskStore: createVaultGitDoctorTaskStore({
					stateRoot,
					repositoryId: fixture.repositoryId,
				}),
			} as VaultGitCliComposition;
			const run = await runVaultGitForTest(
				["doctor", "--task-id", fixture.taskId, "--json"],
				{ composition, launchPrivate: false },
			);

			expect(run.exitCode).toBe(0);
			expect(JSON.parse(run.stdout).data.next_action).toMatchObject({
				kind: "invoke",
				executable: "vault-git",
				...fixture.expected,
			});
		}
	});

	// New-write carrier: a terminal Doctor Task persisted with the semantic id only
	// (nextActionId: inspect_doctor_task, no summary/object) projects the same
	// authoritative union via the CLI — semantic inspect_doctor_task, compat
	// inspect_status, exact doctor argv.
	test("a new persisted inspect_doctor_task terminal projects the same union via the CLI", async () => {
		const stateRoot = await temp("vault-git-u1-cli-doctor-new-");
		const doctorRepoId = "b".repeat(64);
		const doctorTaskId = `doctor_task_${"8".repeat(32)}`;
		const historyDir = join(
			stateRoot,
			"vault-git-transaction-manager",
			doctorRepoId,
			"doctor-tasks",
			doctorTaskId,
			"history",
		);
		await mkdir(historyDir, { recursive: true, mode: 0o700 });
		const newState = {
			schemaVersion: 1,
			taskId: doctorTaskId,
			bindingDigest: "d".repeat(64),
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			transactionId: `txn_${"c".repeat(32)}`,
			revision: 3,
			state: "closed",
			phase: "terminal",
			recordedAt: "2026-08-14T01:00:00.000Z",
			updatedAt: "2026-08-14T01:00:03.000Z",
			heartbeatAt: null,
			checkpoint: "terminal",
			launchGeneration: `doctor_launch_${"9".repeat(32)}`,
			launchExpiresAt: null,
			workerPid: null,
			workerProcessIdentity: null,
			launchAttempt: 1,
			terminalResult: {
				kind: "doctor_result",
				status: "diagnosed",
				state: "repairable",
				phase: "writing",
				finding: "writes_in_progress",
				changedState: "none",
				retrySafety: "same_input_safe",
				// Semantic id only: no summary, no { id, summary } object.
				nextActionId: "inspect_doctor_task",
				repairAction: "resume",
				transactionId: `txn_${"c".repeat(32)}`,
			},
		};
		const file = join(historyDir, "000000000003.json");
		await writeFile(file, `${JSON.stringify(newState, null, 2)}\n`, { mode: 0o600 });
		await chmod(file, 0o600);

		const composition = {
			...fakeComposition(fakeEngine()),
			doctorTaskStore: createVaultGitDoctorTaskStore({
				stateRoot,
				repositoryId: doctorRepoId,
			}),
		} as VaultGitCliComposition;
		const run = await runVaultGitForTest(
			["doctor", "--task-id", doctorTaskId, "--json"],
			{ composition, launchPrivate: false },
		);
		const next = JSON.parse(run.stdout).data.next_action;
		expect(next).toMatchObject({
			kind: "invoke",
			action_id: "inspect_doctor_task",
			executable: "vault-git",
			argv: ["doctor", "--task-id", doctorTaskId, "--json"],
		});
		expect(next.id).toBe("inspect_status");
	});

	// Fail-closed must not erase durable semantic meaning: a terminal whose persisted
	// semantic action needs a transaction selector that no durable state carries fails
	// the OUTER next_action closed (terminal none + continuation_unavailable), while
	// the nested task_terminal_result keeps the persisted semantic id.
	test("a missing continuation selector fails the outer action closed without erasing the persisted semantic id", async () => {
		const stateRoot = await temp("vault-git-u1-cli-doctor-selectorless-");
		const doctorRepoId = "e".repeat(64);
		const doctorTaskId = `doctor_task_${"4".repeat(32)}`;
		const historyDir = join(
			stateRoot,
			"vault-git-transaction-manager",
			doctorRepoId,
			"doctor-tasks",
			doctorTaskId,
			"history",
		);
		await mkdir(historyDir, { recursive: true, mode: 0o700 });
		const selectorlessState = {
			schemaVersion: 1,
			taskId: doctorTaskId,
			bindingDigest: "d".repeat(64),
			receiptId: `receipt_${"b".repeat(32)}`,
			receiptRevision: 7,
			// No transaction correlation anywhere: the reconcile_quarantine
			// continuation cannot rebuild its argv.
			transactionId: null,
			revision: 3,
			state: "closed",
			phase: "terminal",
			recordedAt: "2026-08-14T01:00:00.000Z",
			updatedAt: "2026-08-14T01:00:03.000Z",
			heartbeatAt: null,
			checkpoint: "terminal",
			launchGeneration: `doctor_launch_${"9".repeat(32)}`,
			launchExpiresAt: null,
			workerPid: null,
			workerProcessIdentity: null,
			launchAttempt: 1,
			terminalResult: {
				kind: "doctor_result",
				status: "diagnosed",
				state: "superseded",
				phase: "closed",
				finding: "host_quarantined",
				changedState: "none",
				retrySafety: "same_input_safe",
				nextActionId: "reconcile_quarantine",
			},
		};
		const file = join(historyDir, "000000000003.json");
		await writeFile(file, `${JSON.stringify(selectorlessState, null, 2)}\n`, {
			mode: 0o600,
		});
		await chmod(file, 0o600);

		const composition = {
			...fakeComposition(fakeEngine()),
			doctorTaskStore: createVaultGitDoctorTaskStore({
				stateRoot,
				repositoryId: doctorRepoId,
			}),
		} as VaultGitCliComposition;
		const run = await runVaultGitForTest(
			["doctor", "--task-id", doctorTaskId, "--json"],
			{ composition, launchPrivate: false },
		);
		const data = JSON.parse(run.stdout).data;
		// Outer continuation fails closed as a visible blocker, never a runnable guess.
		expect(data.next_action).toMatchObject({
			kind: "none",
			id: "reconcile_quarantine",
			action_id: "none",
		});
		expect(data.blockers).toContain("continuation_unavailable");
		expect(data.retry_safety).toBe("operator_required");
		// The nested durable terminal keeps its persisted semantic action id.
		expect(data.task_terminal_result.nextActionId).toBe(
			"reconcile_quarantine",
		);
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
				next_action: projectVaultGitNextAction({
					id: "prepare_fresh",
					summary: "Prepare fresh evidence before later review.",
				}),
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
		schema_version: "3" as const,
		status: "prepared" as const,
		authority: "evidence_only" as const,
		write_permission: "denied" as const,
		changed_state: "none" as const,
		evidence_reference: ACTIVATION_EVIDENCE_REFERENCE,
		captured_at: "2026-08-12T00:00:00.000Z",
		display_fresh_until: "2026-08-12T00:10:00.000Z",
		// The production preparer emits the authoritative Next Safe Action union;
		// mirror it (review_prepared is a command handoff bound to the evidence).
		next_action: projectVaultGitNextAction({
			id: "review_prepared",
			summary: "Review the prepared evidence without granting write permission.",
			selectors: { evidence_reference: ACTIVATION_EVIDENCE_REFERENCE },
		}),
	};
}

function activatedResult() {
	return {
		contract_id: "vault-git.activation-result" as const,
		schema_version: "3" as const,
		status: "activated" as const,
		authority: "human_admission" as const,
		write_permission: "denied" as const,
		changed_state: "local" as const,
		evidence_reference: ACTIVATION_EVIDENCE_REFERENCE,
		next_action: projectVaultGitNextAction({
			id: "begin_transaction",
			summary: "Begin one fenced transaction.",
		}),
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
		schemaVersion: 2,
		taskId: "task_11111111111111111111111111111111",
		receiptId: activeReceipt().receiptId,
		transactionId: activeReceipt().transactionId ?? "missing",
		leaseGeneration: activeReceipt().leaseGeneration ?? "missing",
		revision: 1,
		attemptNumber: 1,
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
		previousTerminalResult: null,
		repairReentryBlocked: false,
		repairAuthorization: null,
		...overrides,
	};
}
