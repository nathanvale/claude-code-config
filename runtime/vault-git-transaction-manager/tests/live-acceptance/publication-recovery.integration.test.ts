import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseCliProcessJson } from "@side-quest/cli-command-facade/testing";

import { VAULT_GIT_LEDGER_REF } from "../../src/model.ts";
import {
	cleanupLiveAcceptanceRoots,
	createFixture,
	createSibling,
	runDoctorToTerminal,
} from "./fixture.ts";

setDefaultTimeout(30_000);

afterEach(cleanupLiveAcceptanceRoots);

describe("Remote movement and atomic-close recovery", () => {
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
		const doctor = await runDoctorToTerminal(fixture, [
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
			const doctor = await runDoctorToTerminal(fixture, [
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
		const doctor = await runDoctorToTerminal(fixture, ["doctor", "--json"]);
		expect(parseCliProcessJson(doctor)).toMatchObject({
			data: {
				finding: "remote_contract_breach",
				blockers: ["host_contract_breach"],
			},
		});
		expect(JSON.stringify(parseCliProcessJson(doctor))).not.toContain("retry-push");
	});

});
