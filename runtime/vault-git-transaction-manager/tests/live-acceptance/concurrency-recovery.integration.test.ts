import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	parseCliProcessJson,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";

import { VAULT_GIT_LEDGER_REF } from "../../src/model.ts";

import {
	beginArgs,
	cleanupLiveAcceptanceRoots,
	createFixture,
	createSibling,
	killWorkerForTask,
	readTaskStates,
	waitForTaskState,
} from "./fixture.ts";

setDefaultTimeout(30_000);

afterEach(cleanupLiveAcceptanceRoots);

describe("Completion concurrency and process-death recovery", () => {
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

});
