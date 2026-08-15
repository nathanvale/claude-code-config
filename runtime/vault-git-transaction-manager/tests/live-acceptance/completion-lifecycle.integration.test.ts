import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	parseCliProcessJson,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";

import { VAULT_GIT_LEDGER_REF } from "../../src/model.ts";
import {
	cleanupLiveAcceptanceRoots,
	createFixture,
	recordedPushes,
	waitForFile,
} from "./fixture.ts";

setDefaultTimeout(30_000);

afterEach(cleanupLiveAcceptanceRoots);

describe("Completion lifecycle and foreground detachment", () => {
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

		const foregroundPromise = fixture.run([
			"complete",
			"--transaction-id",
			transactionId,
			"--summary",
			"docs(vault): record background event",
			"--json",
		]);
		let foreground: CliProcessResult | null = null;
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
			foreground = await foregroundPromise;
			foregroundEnvelope = parseCliProcessJson<{
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
				}>(foreground);
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

		expect({
			foregroundStatus: foregroundEnvelope?.status,
			foregroundError: foregroundEnvelope?.error?.code,
			foregroundData: foregroundEnvelope?.data,
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
			foregroundStatus: "ok",
			foregroundError: undefined,
			foregroundData: {
				contract_id: "vault-git.lifecycle-result",
				transaction_id: transactionId,
				task_id: taskId,
			},
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
		"stale takeover private launch budget exceeds one Git push timeout",
		async () => {
			const fixture = await createFixture({
				leaseDurationMs: 1,
				privateLegacyRepairLaunchTimeoutMs: 50,
				privateRepairLaunchTimeoutMs: 500,
				privateChildDelayMs: 100,
				privateChildMode: "delayed_repair_result",
			});
			const transactionId = await fixture.begin("notes/event.md");
			await Bun.sleep(20);

			const repaired = await fixture.run([
				"repair",
				"stale-lease-takeover",
				"--transaction-id",
				transactionId,
				"--prior-writer-stopped",
				"--json",
			]);

			expect({
				exitCode: repaired.exitCode,
				envelope: parseCliProcessJson(repaired),
			}).toMatchObject({
				exitCode: 0,
				envelope: {
					status: "ok",
					data: {
						command: "repair",
						outcome: "repaired",
						transaction_state: "superseded",
					},
				},
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

});
