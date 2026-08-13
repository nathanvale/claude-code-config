import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	parseCliProcessJson,
	runCliProcess,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";

import { VAULT_GIT_LEDGER_REF } from "../src/model.ts";
import { createNodeProcessPort } from "../src/git-adapter.ts";
import { resolveVaultRepositoryIdentity } from "../src/repository-identity.ts";
import { createReceiptStore, launchCapabilityProcess } from "../src/store.ts";
import { admitActivationForTest } from "./activation-fixture.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "tests", "process-cli.ts");
const roots: string[] = [];

setDefaultTimeout(30_000);

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("live acceptance across real CLI and Git process boundaries", () => {
	test("full success closes atomically and preserves unrelated bytes", async () => {
		const fixture = await createFixture();
		const unrelatedBefore = await fixture.unrelatedSnapshot();
		const remoteBefore = fixture.remoteRefs();
		expect(remoteBefore).not.toMatch(/vault-system\/probe-/);
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "completed event\n");
		const completed = await fixture.owner([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): record accepted event",
			"--json",
		]);
		expect(completed.exitCode).toBe(0);
		expect(parseCliProcessJson(completed)).toMatchObject({
			status: "ok",
			data: { outcome: "completed", phase: "closed", changed_state: "remote" },
		});
		expect(fixture.gitBare("show", "refs/heads/main:notes/event.md")).toBe(
			"completed event",
		);
		expect(
			JSON.parse(fixture.gitBare("show", `${VAULT_GIT_LEDGER_REF}:ledger.json`)),
		).toMatchObject({
			operation: "release",
			lease: { transaction_id: transactionId, state: "released" },
		});
		expect(await fixture.unrelatedSnapshot()).toEqual(unrelatedBefore);

		// The synthetic capability-probe refs must never materialize: the full
		// remote ref set is exactly the contract pair, with no probe residue.
		const remoteAfter = fixture.remoteRefs();
		expect(remoteAfter).not.toMatch(/vault-system\/probe-/);
		expect(
			remoteAfter
				.split("\n")
				.map((line) => line.split("\0")[0])
				.sort(),
		).toEqual(["refs/heads/main", VAULT_GIT_LEDGER_REF].sort());

		// Shim-recorded push mechanics: the capability probe dry-runs TWO
		// synthetic contract-shaped refs before the one real close, and the
		// real close is the exact atomic two-refspec push (KTD4).
		const pushes = await recordedPushes(fixture);
		const dryRuns = pushes.filter((args) => args.includes("--dry-run"));
		const closes = pushes.filter(
			(args) => args.includes("--atomic") && !args.includes("--dry-run"),
		);
		expect(dryRuns.length).toBeGreaterThanOrEqual(1);
		for (const probe of dryRuns) {
			for (const flag of ["--atomic", "--porcelain", "--no-verify"]) {
				expect(probe).toContain(flag);
			}
			expect(probe).toContain("origin");
			const refspecs = probe.filter((argument) => argument.includes(":refs/"));
			expect(refspecs).toHaveLength(2);
			expect(refspecs[0]).toMatch(
				/^[0-9a-f]{40,64}:refs\/heads\/vault-system\/probe-[0-9a-f]{32}\/main$/,
			);
			expect(refspecs[1]).toMatch(
				/^[0-9a-f]{40,64}:refs\/heads\/vault-system\/probe-[0-9a-f]{32}\/transaction-ledger$/,
			);
		}
		expect(closes).toHaveLength(1);
		const close = closes[0] as string[];
		for (const flag of ["--atomic", "--porcelain", "--no-verify"]) {
			expect(close).toContain(flag);
		}
		expect(close).toContain("origin");
		const mainCommit = fixture.gitBare("rev-parse", "refs/heads/main");
		const ledgerCommit = fixture.gitBare("rev-parse", VAULT_GIT_LEDGER_REF);
		expect(close).toContain(`${mainCommit}:refs/heads/main`);
		expect(close).toContain(`${ledgerCommit}:${VAULT_GIT_LEDGER_REF}`);
		// Sequencing: every dry-run probe precedes the sole real atomic close.
		const closeIndex = pushes.indexOf(close);
		for (const probe of dryRuns) {
			expect(pushes.indexOf(probe)).toBeLessThan(closeIndex);
		}
	});

	test("public complete durably admits one inspectable worker before returning", async () => {
		const fixture = await createFixture({
			blockingCheck: true,
			privateLaunchTimeoutMs: 3_000,
		});
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "background event\n");

		const startedAt = performance.now();
		const foregroundPromise = fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): record background event",
			"--json",
		]);
		let foreground: CliProcessResult | null = null;
		let foregroundElapsedMs = 0;
		let foregroundEnvelope: {
			status?: string;
			error?: { code?: string };
			data?: {
				contract_id?: string;
				schema_version?: string;
				outcome?: string;
				phase?: string;
				transaction_id?: string;
				task_id?: string;
			};
		} | null = null;
		let taskStatusAtReturn: CliProcessResult | null = null;
		let taskStatusAfterDeadline: CliProcessResult | null = null;
		let taskId: string | undefined;
		try {
			await waitForFile(fixture.checkMarker, 10_000);
			foreground = await Promise.race([
				foregroundPromise,
				Bun.sleep(2_000).then(() => null),
			]);
			foregroundElapsedMs = performance.now() - startedAt;
			foregroundEnvelope = foreground
				? parseCliProcessJson<{
					status?: string;
					error?: { code?: string };
					data?: {
						contract_id?: string;
						schema_version?: string;
						outcome?: string;
						phase?: string;
						transaction_id?: string;
						task_id?: string;
					};
				}>(foreground)
				: null;
			taskId = foregroundEnvelope?.data?.task_id;
			if (!taskId) throw new Error("accepted completion omitted task id");
			taskStatusAtReturn = await fixture.run([
				"status",
				"--task-id",
				taskId,
				"--json",
			]);
			// Cross the production launcher's scaled whole-child deadline after the
			// checker proves the worker is alive.
			await Bun.sleep(3_250);
			taskStatusAfterDeadline = await fixture.run([
				"status",
				"--task-id",
				taskId,
				"--json",
			]);
		} finally {
			await fixture.releaseCheck();
		}
		if (!taskStatusAtReturn || !taskStatusAfterDeadline) {
			throw new Error("task status process did not run");
		}
		const taskStatusAtReturnEnvelope = parseCliProcessJson<{
			status?: string;
			error?: { code?: string };
			data?: {
				contract_id?: string;
				schema_version?: string;
				transaction_id?: string;
				task_id?: string;
				task_state?: string;
				foreground_non_vault_work_allowed?: boolean;
			};
		}>(taskStatusAtReturn);
		const taskStatusAfterDeadlineEnvelope = parseCliProcessJson<{
			status?: string;
			error?: { code?: string };
			data?: {
				contract_id?: string;
				transaction_id?: string;
				task_id?: string;
				task_state?: string;
				foreground_non_vault_work_allowed?: boolean;
			};
		}>(taskStatusAfterDeadline);
		const publicTaskSurfaces = [
			foreground?.stdout ?? "",
			taskStatusAtReturn.stdout,
			taskStatusAfterDeadline.stdout,
		].join("\n");

		// Capture the accepted foreground response after releasing the checker gate.
		const settledForeground = await foregroundPromise;
		const settledForegroundEnvelope = parseCliProcessJson<{
			status?: string;
			error?: { code?: string };
		}>(settledForeground);

		expect({
			foregroundElapsedUnderTwoSeconds: foregroundElapsedMs < 2_000,
			foregroundStatus: foregroundEnvelope?.status,
			foregroundError: foregroundEnvelope?.error?.code,
			foregroundData: foregroundEnvelope?.data,
			settledForegroundError: settledForegroundEnvelope.error?.code,
			taskIdIsOpaque:
				typeof taskId === "string" &&
				taskId.length > 0 &&
				taskId !== transactionId,
			statusAtReturnExitCode: taskStatusAtReturn.exitCode,
			statusAtReturnError: taskStatusAtReturnEnvelope.error?.code,
			statusAtReturnData: taskStatusAtReturnEnvelope.data,
			statusAfterDeadlineExitCode: taskStatusAfterDeadline.exitCode,
			statusAfterDeadlineError: taskStatusAfterDeadlineEnvelope.error?.code,
			statusAfterDeadlineData: taskStatusAfterDeadlineEnvelope.data,
			leaksPrivateStateRoot: publicTaskSurfaces.includes(fixture.stateRoot),
			leaksRepositoryPath: publicTaskSurfaces.includes(fixture.clone),
			leaksRawGitCommand:
				publicTaskSurfaces.includes("git push") ||
				publicTaskSurfaces.includes("git commit-tree"),
			leaksAuthBearingUrl: /https?:\/\/[^/\s:@]+:[^/\s@]+@/.test(
				publicTaskSurfaces,
			),
		}).toMatchObject({
			foregroundElapsedUnderTwoSeconds: true,
			foregroundStatus: "ok",
			foregroundError: undefined,
			foregroundData: {
				contract_id: "vault-git.lifecycle-result",
				transaction_id: transactionId,
				task_id: taskId,
			},
			settledForegroundError: undefined,
			taskIdIsOpaque: true,
			statusAtReturnExitCode: 0,
			statusAtReturnError: undefined,
			statusAtReturnData: {
				contract_id: "vault-git.lifecycle-result",
				transaction_id: transactionId,
				task_id: taskId,
				task_state: "in_progress",
				foreground_non_vault_work_allowed: true,
			},
			statusAfterDeadlineExitCode: 0,
			statusAfterDeadlineError: undefined,
			statusAfterDeadlineData: {
				contract_id: "vault-git.lifecycle-result",
				transaction_id: transactionId,
				task_id: taskId,
				task_state: "in_progress",
				foreground_non_vault_work_allowed: true,
			},
			leaksPrivateStateRoot: false,
			leaksRepositoryPath: false,
			leaksRawGitCommand: false,
			leaksAuthBearingUrl: false,
		});
	}, 60_000);

	test(
		"twenty identical public completions join one task and changed input refuses",
		async () => {
			const fixture = await createFixture({
				blockingCheck: true,
			});
			const transactionId = await fixture.begin("notes/event.md");
			await writeFile(join(fixture.clone, "notes/event.md"), "single-flight event\n");
			const exactArgs = [
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): record single-flight event",
				"--json",
			] as const;

			const firstCall = fixture.run(exactArgs);
			try {
				await waitForFile(fixture.checkMarker, 10_000);
			} catch (error) {
				await fixture.releaseCheck();
				throw error;
			}
			const joiningCalls = Array.from({ length: 19 }, () => fixture.run(exactArgs));
			const changedCall = fixture.run([
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): changed task fingerprint",
				"--json",
			]);
			const foreground = await Promise.race([
				Promise.all([firstCall, ...joiningCalls, changedCall]),
				Bun.sleep(5_000).then(() => null),
			]);
			await fixture.releaseCheck();
			const settled = await Promise.all([firstCall, ...joiningCalls, changedCall]);
			const envelopes = settled.map((result) =>
				parseCliProcessJson<{
					status?: string;
					error?: { code?: string };
					data?: {
						outcome?: string;
						transaction_id?: string;
						task_id?: string;
						task_state?: string;
					};
				}>(result),
			);
			const identical = envelopes.slice(0, 20);
			const changed = envelopes[20];
			const taskIds = identical.map((envelope) => envelope.data?.task_id);
			const workerExecutions = (await readFile(fixture.checkLog, "utf8").catch(
				() => "",
			))
				.split("\n")
				.filter(Boolean).length;

			expect({
				allCallersSettledBeforeWorkerClosure: foreground !== null,
				identicalStatuses: new Set(identical.map((envelope) => envelope.status)),
				identicalTaskIds: new Set(taskIds),
				taskIdIsOpaque:
					typeof taskIds[0] === "string" &&
					taskIds[0].length > 0 &&
					taskIds[0] !== transactionId,
				identicalTransactionIds: new Set(
					identical.map((envelope) => envelope.data?.transaction_id),
				),
				workerExecutions,
				changedStatus: changed?.status,
				changedErrorCode: changed?.error?.code,
				changedOutcome: changed?.data?.outcome,
				changedTaskId: changed?.data?.task_id,
			}).toEqual({
				allCallersSettledBeforeWorkerClosure: true,
				identicalStatuses: new Set(["ok"]),
				identicalTaskIds: new Set([taskIds[0]]),
				taskIdIsOpaque: true,
				identicalTransactionIds: new Set([transactionId]),
				workerExecutions: 1,
				changedStatus: "error",
				changedErrorCode: "task_input_mismatch",
				changedOutcome: "refused",
				changedTaskId: undefined,
			});
		},
		60_000,
	);

	test(
		"a parent killed after durable claim leaves one task and one worker on retry",
		async () => {
			const fixture = await createFixture({ blockingCheck: true });
			const transactionId = await fixture.begin("notes/event.md");
			await writeFile(
				join(fixture.clone, "notes/event.md"),
				"claim-before-spawn event\n",
			);
			const summary = "docs(vault): record claim-before-spawn death";

			await fixture.killDuringLaunch(transactionId, summary, "claimed");
			const tasksAfterDeath = await readTaskStates(fixture.stateRoot);

			const retry = fixture.run([
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				summary,
				"--json",
			]);
			await fixture.releaseCheck();
			const settled = await retry;
			const envelope = parseCliProcessJson<{
				status?: string;
				error?: { code?: string };
				data?: { task_id?: string; next_action?: { id?: string } };
			}>(settled);
			const tasksAfterRetry = await readTaskStates(fixture.stateRoot);
			const workerExecutions = (
				await readFile(fixture.checkLog, "utf8").catch(() => "")
			)
				.split("\n")
				.filter(Boolean).length;

			expect({
				tasksAfterDeath: tasksAfterDeath.length,
				tasksAfterRetry: tasksAfterRetry.length,
				retryReturnedSameTask:
					envelope.data?.task_id === tasksAfterDeath[0]?.taskId,
				// Recovery must never fan out into a second writer, whichever side
				// of the checker barrier the killed attempt's worker reached.
				atMostOneWorker: workerExecutions <= 1,
				// The kill can land either side of acknowledgement, so both a join
				// and a launch-fault refusal are correct -- but never a remote
				// outage, and never a continuation other than inspect or repair.
				retryNamesLocalOutcome:
					envelope.error?.code !== "remote_unavailable" &&
					["inspect_status", "run_doctor"].includes(
						envelope.data?.next_action?.id ?? "",
					),
			}).toEqual({
				tasksAfterDeath: 1,
				tasksAfterRetry: 1,
				retryReturnedSameTask: true,
				atMostOneWorker: true,
				retryNamesLocalOutcome: true,
			});
		},
		60_000,
	);

	test(
		"a parent killed after acknowledgement returns the same task and never restarts the worker",
		async () => {
			const fixture = await createFixture({ blockingCheck: true });
			const transactionId = await fixture.begin("notes/event.md");
			await writeFile(
				join(fixture.clone, "notes/event.md"),
				"ack-before-response event\n",
			);
			const summary = "docs(vault): record ack-before-response death";

			// The worker is already acknowledged and running behind the checker
			// barrier when its launching parent dies.
			await fixture.killDuringLaunch(transactionId, summary, "acknowledged");
			const tasksAfterDeath = await readTaskStates(fixture.stateRoot);

			// Let the orphaned worker reach a terminal state before retrying.
			// Retrying while it still owns the transaction makes the second caller
			// wait on that worker, which under parallel suite load outlasts the
			// test budget instead of returning a task projection.
			await fixture.releaseCheck();
			await waitForTaskState(
				fixture.stateRoot,
				(state) =>
					state === "closed" || state === "repair_needed" || state === "unknown",
				30_000,
			);
			const envelope = parseCliProcessJson<{
				status?: string;
				data?: { task_id?: string; task_state?: string };
			}>(
				await fixture.run([
					"complete",
					"--transaction-id",
					transactionId,
					"--summary",
					summary,
					"--json",
				]),
			);
			const workerExecutions = (
				await readFile(fixture.checkLog, "utf8").catch(() => "")
			)
				.split("\n")
				.filter(Boolean).length;

			expect({
				tasksAfterDeath: tasksAfterDeath.length,
				// Acknowledgement was durable before the parent died, so the task
				// records a running worker rather than an unlaunched claim.
				deadParentTaskState: tasksAfterDeath[0]?.state,
				retryReturnedSameTask:
					envelope.data?.task_id === tasksAfterDeath[0]?.taskId,
				tasksAfterRetry: (await readTaskStates(fixture.stateRoot)).length,
				// The contract is idempotent delivery: the retry never starts a
				// second worker for the acknowledged task.
				atMostOneWorker: workerExecutions <= 1,
			}).toEqual({
				tasksAfterDeath: 1,
				deadParentTaskState: "in_progress",
				retryReturnedSameTask: true,
				tasksAfterRetry: 1,
				atMostOneWorker: true,
			});
		},
		60_000,
	);

	test(
		"restarting completion after worker death keeps one task and one worker",
		async () => {
			const fixture = await createFixture({ blockingCheck: true });
			const transactionId = await fixture.begin("notes/event.md");
			await writeFile(
				join(fixture.clone, "notes/event.md"),
				"restart recovery event\n",
			);
			const summary = "docs(vault): record restart recovery";

			await fixture.killDuringLaunch(transactionId, summary, "acknowledged");
			const admitted = await readTaskStates(fixture.stateRoot);
			// Kill the acknowledged worker itself, not just its launching parent.
			expect(admitted).toHaveLength(1);
			const admittedTask = admitted[0];
			if (!admittedTask) throw new Error("acknowledged task state unavailable");
			await killWorkerForTask(fixture.stateRoot, admittedTask.taskId, 10_000);
			await Bun.sleep(250);

			const restarted = await fixture.run([
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				summary,
				"--json",
			]);
			const envelope = parseCliProcessJson<{
				status?: string;
				data?: { task_id?: string };
			}>(restarted);
			await fixture.releaseCheck();
			const tasksAfterRestart = await readTaskStates(fixture.stateRoot);
			const workerExecutions = (
				await readFile(fixture.checkLog, "utf8").catch(() => "")
			)
				.split("\n")
				.filter(Boolean).length;

			expect({
				admittedTasks: admitted.length,
				tasksAfterRestart: tasksAfterRestart.length,
				restartReturnedSameTask:
					envelope.data?.task_id === admitted[0]?.taskId,
				atMostOneWorker: workerExecutions <= 1,
			}).toEqual({
				admittedTasks: 1,
				tasksAfterRestart: 1,
				restartReturnedSameTask: true,
				atMostOneWorker: true,
			});
		},
		60_000,
	);

	test("malformed worker acknowledgement fails closed without claiming a remote outage", async () => {
		const fixture = await createFixture({ privateChildMode: "malformed_ack" });
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "malformed ack event\n");

		const refused = await fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): record malformed acknowledgement",
			"--json",
		]);
		const envelope = parseCliProcessJson<{
			status?: string;
			error?: { code?: string };
			data?: {
				outcome?: string;
				transaction_id?: string;
				task_state?: string;
				changed_state?: string;
				next_action?: { id?: string };
			};
		}>(refused);

		expect({
			exitCode: refused.exitCode,
			status: envelope.status,
			errorIsLaunchSpecific:
				envelope.error?.code !== undefined &&
				envelope.error.code !== "remote_unavailable",
			changedStateIsKnown: envelope.data?.changed_state !== "partial",
			data: envelope.data,
		}).toMatchObject({
			exitCode: 1,
			status: "error",
			errorIsLaunchSpecific: true,
			changedStateIsKnown: true,
			data: {
				outcome: "refused",
				transaction_id: transactionId,
				task_state: "launching",
				next_action: { id: "run_doctor" },
			},
		});

		// The first call only proves the immediate refusal. One replacement launch
		// is permitted, so retry past the launch deadline until the attempt budget
		// is spent, then read the durable classification the issue requires:
		// repair_needed, never remote_unavailable.
		let retried = refused;
		let retriedEnvelope = envelope as {
			error?: { code?: string };
			data?: { task_id?: string; task_state?: string };
		};
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await Bun.sleep(1_750);
			retried = await fixture.run([
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): record malformed acknowledgement",
				"--json",
			]);
			retriedEnvelope = parseCliProcessJson<{
				error?: { code?: string };
				data?: { task_id?: string; task_state?: string };
			}>(retried);
		}
		const taskId = retriedEnvelope.data?.task_id;
		if (!taskId) throw new Error("retried completion omitted task id");
		const inspected = await fixture.run([
			"status",
			"--task-id",
			taskId,
			"--json",
		]);
		const inspectedEnvelope = parseCliProcessJson<{
			data?: {
				task_state?: string;
				next_action?: { id?: string };
				blockers?: readonly string[];
			};
		}>(inspected);

		expect({
			retriedErrorCode: retriedEnvelope.error?.code,
			taskState: inspectedEnvelope.data?.task_state,
			nextAction: inspectedEnvelope.data?.next_action?.id,
			blockersExcludeRemoteOutage:
				!(inspectedEnvelope.data?.blockers ?? []).includes("remote_unavailable"),
		}).toEqual({
			retriedErrorCode: "worker_launch_protocol_failed",
			taskState: "repair_needed",
			nextAction: "run_doctor",
			blockersExcludeRemoteOutage: true,
		});
	}, 60_000);

	test(
		"two clones admit exactly one writer and fence the stale generation",
		async () => {
			// Decision 10 and the plan's success criteria require exactly one
			// winner across 20 repeated races, proven at the process boundary.
			// A single run can pass without the two processes ever overlapping.
			for (let attempt = 0; attempt < 20; attempt += 1) {
				const laptop = await createFixture();
				const mini = await createSibling(laptop, "mac-mini");
				const [first, second] = await Promise.all([
					laptop.run(beginArgs("notes/event.md")),
					mini.run(beginArgs("notes/event.md")),
				]);
				const results = [first, second];
				expect(results.filter((result) => result.exitCode === 0)).toHaveLength(1);
				expect(results.filter((result) => result.exitCode !== 0)).toHaveLength(1);
				const refusal = results.find(
					(result) => result.exitCode !== 0,
				) as CliProcessResult;
				const parsed = parseCliProcessJson(refusal) as {
					error?: { code?: string };
					data?: { changed_state?: string };
				};
				expect(parsed).toMatchObject({
					status: "error",
					data: { outcome: "refused" },
				});
				// `lease_active` is not a fencing outcome: it is what the loser
				// reports when it observed an already-held lease without racing
				// for it, so accepting it lets a no-race run satisfy this proof.
				expect(["remote_moved", "lease_generation_stale"]).toContain(
					parsed.error?.code ?? "missing_refusal_code",
				);
				// A local receipt is expected; reaching the remote is not.
				expect(parsed.data?.changed_state).not.toBe("remote");
				// The winner must own the ledger tip; without this nothing proves
				// the successful exit code corresponds to a real acquisition.
				const ledger = JSON.parse(
					laptop.gitBare("show", `${VAULT_GIT_LEDGER_REF}:ledger.json`),
				) as { lease?: { state?: string; transaction_id?: string } };
				expect(ledger.lease?.state).toBe("held");
				const winner = results.find(
					(result) => result.exitCode === 0,
				) as CliProcessResult;
				const winnerData = parseCliProcessJson(winner) as {
					data?: { transaction_id?: string };
				};
				expect(ledger.lease?.transaction_id).toBe(
					winnerData.data?.transaction_id,
				);
			}
		},
		300_000,
	);

	test("remote main movement stops completion with deliberate replay guidance", async () => {
		const fixture = await createFixture();
		const sibling = await createSibling(fixture, "remote-writer");
		const unrelatedBefore = await fixture.unrelatedSnapshot();
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "preserve me\n");
		await writeFile(join(sibling.clone, "remote-move.md"), "remote movement\n");
		sibling.git("add", "--", "remote-move.md");
		sibling.git("commit", "-m", "test: move remote main");
		sibling.git("push", "origin", "HEAD:refs/heads/main");
		const refused = await fixture.owner([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): record moved event",
			"--json",
		]);
		expect(refused.exitCode).toBe(1);
		expect(parseCliProcessJson(refused)).toMatchObject({
			status: "error",
			error: { code: "remote_moved" },
			continuation: { next_action_id: "preserve_local_edits" },
			data: { changed_state: "none" },
		});
		expect(await fixture.unrelatedSnapshot()).toEqual(unrelatedBefore);
	});

	test("failed atomic push remains pending without disturbing unrelated state", async () => {
		const fixture = await createFixture({ shimMode: "failed_close" });
		const unrelatedBefore = await fixture.unrelatedSnapshot();
		const transactionId = await fixture.begin("notes/event.md");
		const remoteBefore = fixture.remoteRefs();
		await writeFile(join(fixture.clone, "notes/event.md"), "pending event\n");
		const pending = await fixture.owner([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): record pending event",
			"--json",
		]);
		expect(parseCliProcessJson(pending)).toMatchObject({
			data: {
				transaction_state: "push_pending",
				next_action: { id: "run_doctor" },
			},
		});
		expect(fixture.remoteRefs()).toEqual(remoteBefore);
		expect(await fixture.unrelatedSnapshot()).toEqual(unrelatedBefore);
	});

	test("lost atomic-push acknowledgement closes through doctor and close-verified", async () => {
		const fixture = await createFixture({ shimMode: "lost_ack" });
		const unrelatedBefore = await fixture.unrelatedSnapshot();
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "lost ack event\n");
		const pending = await fixture.owner([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): record lost acknowledgement",
			"--json",
		]);
		expect(parseCliProcessJson(pending)).toMatchObject({
			data: { transaction_state: "push_pending" },
		});
		// Independent bare-remote evidence BEFORE doctor classifies anything:
		// the push landed on the remote even though the acknowledgement was
		// lost, so doctor's later "already closed" verdict rests on real state.
		expect(fixture.gitBare("show", "refs/heads/main:notes/event.md")).toBe(
			"lost ack event",
		);
		expect(
			JSON.parse(fixture.gitBare("show", `${VAULT_GIT_LEDGER_REF}:ledger.json`)),
		).toMatchObject({
			operation: "release",
			lease: { transaction_id: transactionId, state: "released" },
		});
		await rm(fixture.shimMarker, { force: true });
		const doctor = await fixture.run([
			"doctor",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			status: "ok",
			data: {
				finding: "publication_already_closed",
				repair_action: "close-verified",
			},
		});
		const repaired = await fixture.owner([
			"repair",
			"close-verified",
			"--transaction-id",
			transactionId,
			"--json",
		]);
		expect(parseCliProcessJson(repaired)).toMatchObject({
			status: "ok",
			data: { outcome: "repaired", phase: "closed" },
		});
		expect(await fixture.unrelatedSnapshot()).toEqual(unrelatedBefore);
	});

	test(
		"a killed checking phase resumes only through doctor and repair",
		async () => {
			const fixture = await createFixture({ blockingCheck: true });
			const transactionId = await fixture.begin("notes/event.md");
			await writeFile(join(fixture.clone, "notes/event.md"), "resumed event\n");
			await fixture.interruptComplete(transactionId);
			// A direct owner complete must refuse mid-interrupt without touching
			// state: resumption is owned by the doctor/repair path alone.
			const direct = await fixture.owner([
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): bypass doctor",
				"--json",
			]);
			expect(direct.exitCode).toBe(1);
			expect(parseCliProcessJson(direct)).toMatchObject({
				status: "error",
				error: { code: "completion_interrupted" },
				data: { changed_state: "none" },
				continuation: { next_action_id: "run_doctor" },
			});
			delete fixture.env.VAULT_GIT_CHECK_MARKER;
			const doctor = await fixture.run([
				"doctor",
				"--transaction-id",
				transactionId,
				"--json",
			]);
			expect(parseCliProcessJson(doctor)).toMatchObject({
				data: { finding: "checks_interrupted", repair_action: "resume" },
			});
			const resumed = await fixture.owner([
				"repair",
				"resume",
				"--transaction-id",
				transactionId,
				"--json",
			]);
			expect(parseCliProcessJson(resumed)).toMatchObject({
				status: "ok",
				data: { outcome: "repaired" },
			});
			const completed = await fixture.owner([
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): record resumed event",
				"--json",
			]);
			expect(parseCliProcessJson(completed)).toMatchObject({
				status: "ok",
				data: { outcome: "completed", phase: "closed" },
			});
		},
		30_000,
	);

	test("fresh HOME and XDG profiles expose identical discovery and refusal policy", async () => {
		const first = await createFixture({ profile: "profile-a" });
		const second = await createFixture({ profile: "profile-b" });
		const discoveries = await Promise.all([
			first.run(["commands", "--json", "--run-id", "profile-a"]),
			second.run(["commands", "--json", "--run-id", "profile-b"]),
		]);
		expect(projectPolicy(discoveries[1] as CliProcessResult)).toEqual(
			projectPolicy(discoveries[0] as CliProcessResult),
		);
		const refusals = await Promise.all([
			first.run(beginArgs(".git/config", "profile-a-refusal")),
			second.run(beginArgs(".git/config", "profile-b-refusal")),
		]);
		expect(projectPolicy(refusals[1] as CliProcessResult)).toEqual(
			projectPolicy(refusals[0] as CliProcessResult),
		);
	});

	test("atomic capability refusal moves no local or remote ref", async () => {
		const fixture = await createFixture({ shimMode: "atomic_unsupported" });
		const localBefore = fixture.git("rev-parse", "refs/heads/main");
		const remoteBefore = fixture.remoteRefs();
		const statusBefore = fixture.git("status", "--porcelain=v2", "-z");
		const refused = await fixture.run(beginArgs("notes/event.md"));
		expect(refused.exitCode).toBe(1);
		expect(parseCliProcessJson(refused)).toMatchObject({
			error: { code: "host_contract_breach" },
			data: { changed_state: "none" },
		});
		expect(fixture.git("rev-parse", "refs/heads/main")).toBe(localBefore);
		expect(fixture.remoteRefs()).toEqual(remoteBefore);
		expect(fixture.git("status", "--porcelain=v2", "-z")).toBe(statusBefore);
	});

	test("an unreachable remote refuses without a hidden local commit", async () => {
		// Decision 10 requires offline refusal among the proven behaviours, and
		// decision 8 forbids a hidden local commit while offline. Proving this
		// only against a fake port never exercises the real transport
		// classifier, which maps any non-atomic-push failure to
		// remote_unavailable through a catch-all.
		const fixture = await createFixture({ shimMode: "remote_offline" });
		const localBefore = fixture.git("rev-parse", "refs/heads/main");
		const remoteBefore = fixture.remoteRefs();
		const statusBefore = fixture.git("status", "--porcelain=v2", "-z");
		const refused = await fixture.run(beginArgs("notes/event.md"));
		expect(refused.exitCode).not.toBe(0);
		expect(parseCliProcessJson(refused)).toMatchObject({
			status: "error",
			data: { outcome: "refused", changed_state: "none" },
		});
		expect(fixture.git("rev-parse", "refs/heads/main")).toBe(localBefore);
		expect(fixture.remoteRefs()).toEqual(remoteBefore);
		expect(fixture.git("status", "--porcelain=v2", "-z")).toBe(statusBefore);
	});

	test("hostile repository and path inputs fail closed without mutation", async () => {
		for (const scenario of hostileScenarios) {
			const fixture = await createFixture();
			await scenario.arrange(fixture);
			const localBefore = fixture.git("rev-parse", "refs/heads/main");
			const remoteBefore = fixture.remoteRefs();
			const statusBefore = fixture.git("status", "--porcelain=v2", "-z");
			const refused = await fixture.run(
				scenario.args ?? beginArgs(scenario.path ?? "notes/event.md"),
			);
			// Assert the MECHANISM, not just failure: the exact refusal code
			// proves the intended guard fired rather than an incidental error.
			expect(refused.exitCode, scenario.name).toBe(
				scenario.expectedCode === "invalid_usage" ? 2 : 1,
			);
			expect(parseCliProcessJson(refused), scenario.name).toMatchObject({
				status: "error",
				error: { code: scenario.expectedCode },
				data: { changed_state: "none" },
			});
			expect(fixture.git("rev-parse", "refs/heads/main"), scenario.name).toBe(
				localBefore,
			);
			expect(fixture.remoteRefs(), scenario.name).toEqual(remoteBefore);
			expect(
				fixture.git("status", "--porcelain=v2", "-z"),
				scenario.name,
			).toBe(statusBefore);
		}
	}, 120_000);

	test("one-ref-only publication is a host contract breach with no retry", async () => {
		const fixture = await createFixture({ shimMode: "partial_close" });
		const transactionId = await fixture.begin("notes/event.md");
		await writeFile(join(fixture.clone, "notes/event.md"), "partial event\n");
		const breached = await fixture.owner([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): reject partial publication",
			"--json",
		]);
		expect(parseCliProcessJson(breached)).toMatchObject({
			status: "error",
			error: { code: "host_contract_breach" },
			data: { retry_safety: "operator_required" },
			continuation: { next_action_id: "request_operator_review" },
		});
		const doctor = await fixture.run(["doctor", "--json"]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			data: {
				finding: "remote_contract_breach",
				blockers: ["host_contract_breach"],
			},
		});
		expect(JSON.stringify(parseCliProcessJson(doctor))).not.toContain("retry-push");
	});

	test("unadmitted activation refuses every write command", async () => {
		const fixture = await createFixture({ activate: false });
		const refsBefore = fixture.remoteRefs();
		const localBefore = fixture.git("status", "--porcelain=v2", "-z");
		const transactionId = `txn_${"1".repeat(32)}`;
		const writes = [
			beginArgs("notes/event.md"),
			["join", "--transaction-id", transactionId, "--path", "notes/event.md", "--json"],
			["complete", "--transaction-id", transactionId, "--summary", "docs(vault): blocked", "--json"],
			["repair", "resume", "--transaction-id", transactionId, "--json"],
			["tidy", "now", "--json"],
			["janitor", "--json"],
		];
		for (const args of writes) {
			const refused = await fixture.run(args);
			expect(parseCliProcessJson(refused)).toMatchObject({
				status: "error",
				error: { code: "activation_blocked" },
				data: { changed_state: "none", blockers: ["activation_blocked"] },
			});
		}
		expect(fixture.remoteRefs()).toEqual(refsBefore);
		expect(fixture.git("status", "--porcelain=v2", "-z")).toBe(localBefore);
	});
});

interface Fixture {
	readonly root: string;
	readonly bare: string;
	readonly clone: string;
	readonly stateRoot: string;
	readonly env: NodeJS.ProcessEnv;
	readonly checkMarker: string;
	readonly checkLog: string;
	readonly shimMarker: string;
	readonly shimLog: string;
	run(args: readonly string[]): Promise<CliProcessResult>;
	begin(path: string): Promise<string>;
	owner(args: readonly string[]): Promise<CliProcessResult>;
	interruptComplete(transactionId: string): Promise<void>;
	killDuringLaunch(
		transactionId: string,
		summary: string,
		until: "claimed" | "acknowledged",
	): Promise<void>;
	releaseCheck(): Promise<void>;
	git(...args: string[]): string;
	gitBare(...args: string[]): string;
	remoteRefs(): string;
	unrelatedSnapshot(): Promise<unknown>;
}

async function createFixture(
	options: {
		readonly activate?: boolean;
		readonly blockingCheck?: boolean;
		readonly privateLaunchTimeoutMs?: number;
		readonly privateChildMode?: "malformed_ack";
		readonly profile?: string;
		readonly shimMode?: string;
	} = {},
): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "vault-git-live-acceptance-"));
	roots.push(root);
	const bare = join(root, "remote.git");
	git(root, "init", "--bare", "--initial-branch=main", bare);
	return createCloneFixture(root, bare, "vault", options);
}

async function createSibling(fixture: Fixture, name: string): Promise<Fixture> {
	return createCloneFixture(fixture.root, fixture.bare, name, {
		profile: `${name}-profile`,
	});
}

async function createCloneFixture(
	root: string,
	bare: string,
	name: string,
	options: {
		readonly activate?: boolean;
		readonly blockingCheck?: boolean;
		readonly privateLaunchTimeoutMs?: number;
		readonly privateChildMode?: "malformed_ack";
		readonly profile?: string;
		readonly shimMode?: string;
	},
): Promise<Fixture> {
	const clone = join(root, name);
	const stateRoot = join(root, `${name}-state`);
	const profileRoot = join(root, options.profile ?? `${name}-profile`);
	const shimMarker = join(root, `${name}-shim-marker`);
	const shimLog = join(root, `${name}-shim-log`);
	const checkMarker = join(root, `${name}-check-marker`);
	const checkLog = join(root, `${name}-check-log`);
	git(root, "clone", bare, clone);
	git(clone, "config", "user.name", "Vault Acceptance Test");
	git(clone, "config", "user.email", "vault-acceptance@example.invalid");
	if (!hasRef(bare, "refs/heads/main")) {
		await mkdir(join(clone, "notes"), { recursive: true });
		await writeFile(join(clone, "notes/event.md"), "baseline event\n");
		await writeFile(join(clone, "staged.md"), "staged baseline\n");
		await writeFile(join(clone, "unstaged.md"), "unstaged baseline\n");
		await writeFile(
			join(clone, "package.json"),
			`${JSON.stringify(
				{
					private: true,
					scripts: { check: "bun run vault-check.ts" },
				},
				null,
				2,
			)}\n`,
		);
		await writeFile(
			join(clone, "vault-check.ts"),
			[
				'import { appendFile, writeFile } from "node:fs/promises";',
				'import { existsSync } from "node:fs";',
				"const marker = process.env.VAULT_GIT_CHECK_MARKER;",
				"const log = process.env.VAULT_GIT_CHECK_LOG;",
				'if (log) await appendFile(log, "worker\\n");',
				'if (marker) { await writeFile(marker, "checking\\n"); while (!existsSync([marker, ".release"].join(""))) await Bun.sleep(10); }',
			].join("\n"),
		);
		await writeFile(join(clone, "bun.lock"), "{}\n");
		git(
			clone,
			"add",
			"--",
			"notes/event.md",
			"staged.md",
			"unstaged.md",
			"package.json",
			"vault-check.ts",
			"bun.lock",
		);
		git(clone, "commit", "-m", "test: seed live acceptance vault");
		git(clone, "push", "-u", "origin", "HEAD:refs/heads/main");
		git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
	}
	await writeFile(join(clone, "staged.md"), `${name} staged bytes\n`);
	git(clone, "add", "--", "staged.md");
	await writeFile(join(clone, "unstaged.md"), `${name} unstaged bytes\n`);
	await writeFile(join(clone, "untracked.md"), `${name} untracked bytes\n`);
	await mkdir(profileRoot, { recursive: true });
	const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
	const shimDirectory = join(root, `${name}-bin`);
	await mkdir(shimDirectory, { recursive: true });
	await writeFile(join(shimDirectory, "git"), gitShimSource());
	await chmod(join(shimDirectory, "git"), 0o755);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		HOME: profileRoot,
		XDG_CONFIG_HOME: join(profileRoot, ".config"),
		XDG_STATE_HOME: join(profileRoot, ".state"),
		PATH: `${shimDirectory}:${process.env.PATH ?? ""}`,
		VAULT_GIT_REPOSITORY_PATH: clone,
		VAULT_GIT_CHECK_REPOSITORY_PATH: clone,
		VAULT_GIT_STATE_ROOT: stateRoot,
		VAULT_GIT_REPOSITORY_IDENTITY: "live-acceptance-vault",
		VAULT_GIT_ACTOR: `agent-${name}`,
		VAULT_GIT_HOST: `host-${name}`,
		VAULT_GIT_REMOTE: "origin",
		VAULT_GIT_REAL_GIT: realGit,
		VAULT_GIT_SHIM_MARKER: shimMarker,
		VAULT_GIT_TEST_HARNESS: "1",
		VAULT_GIT_SHIM_LOG: shimLog,
		VAULT_GIT_CHECK_LOG: checkLog,
		...(options.shimMode ? { VAULT_GIT_SHIM_MODE: options.shimMode } : {}),
		...(options.blockingCheck ? { VAULT_GIT_CHECK_MARKER: checkMarker } : {}),
		...(options.privateLaunchTimeoutMs === undefined
			? {}
			: {
					VAULT_GIT_TEST_PRIVATE_LAUNCH_TIMEOUT_MS: String(
						options.privateLaunchTimeoutMs,
					),
				}),
		...(options.privateChildMode === undefined
			? {}
			: { VAULT_GIT_TEST_PRIVATE_CHILD_MODE: options.privateChildMode }),
	};
	const repositoryIdentity = (
		await resolveVaultRepositoryIdentity({
			repositoryPath: clone,
			process: createNodeProcessPort(),
			timeoutMs: 5_000,
		})
	).identity;
	const store = createReceiptStore({
		stateRoot,
		repositoryIdentity,
	});
	if (options.activate !== false) await admitActivationForTest(store);
	const run = (args: readonly string[]) =>
		runCliProcess({
			label: `vault-git ${args.join(" ")}`,
			argv: ["bun", "run", cliPath, ...args],
			cwd: packageRoot,
			env,
			timeoutMs: 45_000,
		});
	const begin = async (path: string): Promise<string> => {
		const result = await run(beginArgs(path));
		expect(result.exitCode).toBe(0);
		const transactionId = (
			parseCliProcessJson(result) as { data?: { transaction_id?: string } }
		).data?.transaction_id;
		if (!transactionId) throw new Error("begin omitted transaction id");
		return transactionId;
	};
	const owner = async (args: readonly string[]): Promise<CliProcessResult> => {
		const loaded = await store.load();
		if (loaded.status !== "loaded") throw new Error("owner receipt unavailable");
		const launched = await launchCapabilityProcess(store, {
			receiptId: loaded.receipt.receiptId,
			role: "owner",
			command: process.execPath,
			args: [cliPath, ...args],
			cwd: clone,
			timeoutMs: 45_000,
			env,
		});
		return {
			label: `vault-git owner ${args.join(" ")}`,
			argv: [process.execPath, cliPath, ...args, "--capability-fd", "3"],
			cwd: clone,
			exitCode: launched.exitCode,
			stdout: launched.stdout,
			stderr: launched.stderr,
			timedOut: launched.timedOut,
			signal: null,
			timeoutMs: 45_000,
		};
	};
	const interruptComplete = async (transactionId: string): Promise<void> => {
		const loaded = await store.load();
		if (loaded.status !== "loaded") throw new Error("interrupt receipt unavailable");
		const descriptor = openSync(store.capabilityPath(loaded.receipt.receiptId, "owner"), "r");
		const child = spawn(
			process.execPath,
			[
				cliPath,
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				"docs(vault): interrupt checking",
				"--json",
				"--capability-fd",
				"3",
			],
			{ cwd: clone, env, stdio: ["ignore", "pipe", "pipe", descriptor] },
		);
		closeSync(descriptor);
		await waitForFile(checkMarker, 10_000);
		child.kill("SIGKILL");
		await new Promise<void>((resolveChild) => child.once("close", () => resolveChild()));
	};
	// Kill the foreground through the ordinary launch path -- no --capability-fd,
	// so launchBackgroundCompletion actually runs and the detached worker exists.
	const killDuringLaunch = async (
		transactionId: string,
		summary: string,
		until: "claimed" | "acknowledged",
	): Promise<void> => {
		const child = spawn(
			process.execPath,
			[
				"run",
				cliPath,
				"complete",
				"--transaction-id",
				transactionId,
				"--summary",
				summary,
				"--json",
			],
			{ cwd: packageRoot, env, stdio: ["ignore", "pipe", "pipe"] },
		);
		try {
			await waitForTaskState(
				stateRoot,
				until === "claimed"
					? (state) => state === "claimed" || state === "launching"
					: (state) => state === "in_progress",
				10_000,
			);
		} catch {
			// The kill is the point of this helper. Losing the race to the target
			// state still leaves a dead parent, which the caller's assertions cover.
		} finally {
			child.kill("SIGKILL");
			await new Promise<void>((resolveChild) =>
				child.once("close", () => resolveChild()),
			);
		}
	};
	return {
		root,
		bare,
		clone,
		stateRoot,
		env,
		checkMarker,
		checkLog,
		shimMarker,
		shimLog,
		run,
		begin,
		owner,
		interruptComplete,
		killDuringLaunch,
		releaseCheck: () => writeFile(`${checkMarker}.release`, "release\n"),
		git: (...args) => git(clone, ...args),
		gitBare: (...args) => git(bare, ...args),
		remoteRefs: () => remoteRefs(bare),
		unrelatedSnapshot: async () => ({
			status: git(
				clone,
				"status",
				"--porcelain=v2",
				"-z",
				"--",
				":(top)",
				":(top,exclude,literal)notes/event.md",
			),
			index: git(
				clone,
				"ls-files",
				"--stage",
				"-z",
				"--",
				":(top)",
				":(top,exclude,literal)notes/event.md",
			),
			staged: await readFile(join(clone, "staged.md"), "hex"),
			unstaged: await readFile(join(clone, "unstaged.md"), "hex"),
			untracked: await readFile(join(clone, "untracked.md"), "hex"),
		}),
	};
}

const hostileScenarios: readonly {
	readonly name: string;
	readonly path?: string;
	readonly args?: readonly string[];
	readonly expectedCode: string;
	readonly arrange: (fixture: Fixture) => Promise<void>;
}[] = [
	{
		name: "core.hooksPath",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			fixture.git("config", "--local", "core.hooksPath", "hostile-hooks");
		},
	},
	{
		name: "credential helper",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			fixture.git("config", "--local", "credential.helper", "!false");
		},
	},
	{
		name: "repository hook",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			const hook = join(fixture.clone, ".git/hooks/pre-commit");
			await writeFile(hook, "#!/bin/sh\nexit 1\n");
			await chmod(hook, 0o755);
		},
	},
	{
		name: "ext transport",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			fixture.git("remote", "set-url", "origin", "ext::false");
		},
	},
	{
		name: "embedded credentials",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			fixture.git(
				"remote",
				"set-url",
				"origin",
				"https://fixture-user:fixture-pass@example.invalid/vault.git",
			);
		},
	},
	{
		name: "insteadOf rewrite",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			fixture.git(
				"config",
				"--local",
				"url.https://mirror.invalid/.insteadOf",
				"https://origin.invalid/",
			);
		},
	},
	{
		name: "core.sshCommand",
		expectedCode: "host_contract_breach",
		arrange: async (fixture) => {
			fixture.git("config", "--local", "core.sshCommand", "true");
		},
	},
	{
		name: "symlink escape",
		path: "escaped/event.md",
		expectedCode: "owned_path_not_admitted",
		arrange: async (fixture) => {
			await symlink(dirname(fixture.root), join(fixture.clone, "escaped"));
		},
	},
	{
		name: "option-shaped path",
		args: ["begin", "--event", "note_created", "--path", "--force", "--json"],
		expectedCode: "invalid_usage",
		arrange: async () => {},
	},
	{
		name: "option-shaped inline path",
		args: ["begin", "--event", "note_created", "--path=--force", "--json"],
		expectedCode: "invalid_usage",
		arrange: async () => {},
	},
];

function beginArgs(path: string, runId?: string): string[] {
	return [
		"begin",
		"--event",
		"note_created",
		"--path",
		path,
		"--json",
		...(runId ? ["--run-id", runId] : []),
	];
}

function projectPolicy(result: CliProcessResult): Record<string, unknown> {
	const envelope = parseCliProcessJson<Record<string, unknown>>(result);
	const { run_id: _runId, duration_ms: _duration, error, ...policy } = envelope;
	if (!error || typeof error !== "object" || Array.isArray(error)) return policy;
	const { run_id: _errorRunId, ...errorPolicy } = error as Record<string, unknown>;
	return { ...policy, error: errorPolicy };
}

function git(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
	return result.stdout.trim();
}

function hasRef(bare: string, ref: string): boolean {
	return spawnSync("git", ["show-ref", "--verify", "--quiet", ref], {
		cwd: bare,
	}).status === 0;
}

function remoteRefs(bare: string): string {
	// ALL remote refs, not just the contract pair: a synthetic capability-probe
	// ref materializing anywhere on the remote must fail the before/after
	// snapshot comparisons, proving the probe stays dry-run only.
	return git(bare, "for-each-ref", "--format=%(refname)%00%(objectname)");
}

/** Every git push argv the shim observed, in invocation order. */
async function recordedPushes(fixture: Fixture): Promise<string[][]> {
	const raw = await readFile(fixture.shimLog, "utf8").catch(() => "");
	return raw
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as string[]);
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await Bun.file(path).exists()) return;
		await Bun.sleep(10);
	}
	throw new Error(`timed out waiting for ${path}`);
}

/** Read every durable task record the private state root currently holds. */
async function readTaskStates(
	stateRoot: string,
	timeoutMs = 5_000,
): Promise<
	readonly {
		taskId: string;
		state: string;
		phase: string;
		workerPid: number | null;
	}[]
> {
	const managerRoot = join(stateRoot, "vault-git-transaction-manager");
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const repositories = await readdir(managerRoot).catch(() => []);
		const states: {
			taskId: string;
			state: string;
			phase: string;
			workerPid: number | null;
		}[] = [];
		for (const repository of repositories) {
			const tasks = join(managerRoot, repository, "tasks");
			for (const taskId of await readdir(tasks).catch(() => [])) {
				const record = await readLatestTaskRevision(
					join(tasks, taskId, "history"),
				);
				if (!record || record.taskId !== taskId) continue;
				states.push({
					taskId,
					state: record.state,
					phase: record.phase,
					workerPid: record.workerPid,
				});
			}
		}
		if (states.length > 0) return states;
		await Bun.sleep(10);
	}
	throw new Error("timed out waiting for durable task history");
}

async function readLatestTaskRevision(history: string): Promise<{
	readonly taskId: string;
	readonly state: string;
	readonly phase: string;
	readonly workerPid: number | null;
} | null> {
	const latest = (await readdir(history).catch(() => []))
		.filter((name) => /^\d{12}\.json$/.test(name))
		.sort()
		.at(-1);
	if (!latest) return null;
	const source = await readFile(join(history, latest), "utf8").catch(() => "");
	if (!source) return null;
	try {
		const record = JSON.parse(source) as Record<string, unknown>;
		if (
			typeof record.taskId !== "string" ||
			typeof record.state !== "string" ||
			typeof record.phase !== "string" ||
			(record.workerPid !== null &&
				(typeof record.workerPid !== "number" ||
					!Number.isSafeInteger(record.workerPid) ||
					record.workerPid <= 0))
		) {
			return null;
		}
		return {
			taskId: record.taskId,
			state: record.state,
			phase: record.phase,
			workerPid: record.workerPid as number | null,
		};
	} catch {
		return null;
	}
}

async function killWorkerForTask(
	stateRoot: string,
	taskId: string,
	timeoutMs: number,
): Promise<void> {
	if (!/^task_[0-9a-f]{32}$/.test(taskId)) throw new Error("invalid task id");
	const managerRoot = join(stateRoot, "vault-git-transaction-manager");
	const deadline = Date.now() + timeoutMs;
	let workerPid: number | null = null;
	while (Date.now() < deadline && workerPid === null) {
		for (const repository of await readdir(managerRoot).catch(() => [])) {
			const record = await readLatestTaskRevision(
				join(managerRoot, repository, "tasks", taskId, "history"),
			);
			if (record?.taskId === taskId && record.workerPid !== null) {
				workerPid = record.workerPid;
				break;
			}
		}
		if (workerPid === null) await Bun.sleep(10);
	}
	if (workerPid === null) throw new Error("durable task omitted worker pid");
	try {
		process.kill(workerPid, "SIGKILL");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") {
			throw new Error("durable worker pid was already absent", { cause: error });
		}
		throw error;
	}
	const exitDeadline = Date.now() + timeoutMs;
	while (Date.now() < exitDeadline) {
		try {
			process.kill(workerPid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
			throw error;
		}
		await Bun.sleep(10);
	}
	throw new Error("durable worker pid survived SIGKILL");
}

async function waitForTaskState(
	stateRoot: string,
	matches: (state: string) => boolean,
	timeoutMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const states = await readTaskStates(stateRoot);
		if (states.some((task) => matches(task.state))) return;
		await Bun.sleep(10);
	}
	throw new Error("timed out waiting for durable task state");
}

function gitShimSource(): string {
	return `#!/usr/bin/env bun
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = Bun.argv.slice(2);
const realGit = process.env.VAULT_GIT_REAL_GIT ?? "/usr/bin/git";
const mode = process.env.VAULT_GIT_SHIM_MODE;
const marker = process.env.VAULT_GIT_SHIM_MARKER ?? "";
const log = process.env.VAULT_GIT_SHIM_LOG ?? "";
if (log && args[0] === "push") appendFileSync(log, JSON.stringify(args) + "\\n");
const atomic = args[0] === "push" && args.includes("--atomic");
const dryRun = args.includes("--dry-run");
if (mode === "atomic_unsupported" && atomic && dryRun) {
  process.stderr.write("fatal: the receiving end does not support atomic push\\n");
  process.exit(1);
}
// Every network verb fails as if the host were unreachable, so the real
// transport classifier runs against a genuine failure instead of a fake port.
if (mode === "remote_offline" && ["push", "fetch", "ls-remote"].includes(args[0] ?? "")) {
  process.stderr.write("fatal: unable to access remote: Could not resolve host\\n");
  process.exit(128);
}
if (mode === "lost_ack" && marker && existsSync(marker) && ["fetch", "ls-remote"].includes(args[0] ?? "")) {
  process.stderr.write("fatal: simulated reconciliation outage\\n");
  process.exit(1);
}
if (atomic && !dryRun && mode === "failed_close") {
  process.stderr.write("fatal: simulated push failure\\n");
  process.exit(1);
}
if (atomic && !dryRun && mode === "partial_close") {
  const remote = args.find((arg, index) => index > 0 && !arg.startsWith("-"));
  const main = args.find((arg) => arg.endsWith(":refs/heads/main"));
  if (!remote || !main) process.exit(2);
  const result = Bun.spawnSync([realGit, "push", "--porcelain", "--no-verify", remote, main], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exit(result.exitCode === 0 ? 1 : result.exitCode);
}
const result = Bun.spawnSync([realGit, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
if (atomic && !dryRun && mode === "lost_ack" && result.exitCode === 0) {
  writeFileSync(marker, "remote accepted; acknowledgement lost\\n");
  process.exit(1);
}
process.exit(result.exitCode);
`;
}
