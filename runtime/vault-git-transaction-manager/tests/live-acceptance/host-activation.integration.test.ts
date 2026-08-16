import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	parseCliProcessJson,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";

import {
	beginArgs,
	cleanupLiveAcceptanceRoots,
	createFixture,
	hostileScenarios,
	projectPolicy,
} from "./fixture.ts";

setDefaultTimeout(30_000);

afterEach(cleanupLiveAcceptanceRoots);

describe("Host policy, activation, and hostile inputs", () => {
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
			const envelope = parseCliProcessJson(refused) as {
				status: string;
				error: { code: string };
				data: {
					changed_state?: string;
					blockers?: string[];
					next_action?: { id?: string; kind?: string; action_id?: string };
					activation_restriction?: {
						cause?: { id?: string };
						next_action?: { id?: string; kind?: string; action_id?: string };
					};
				};
				continuation?: {
					requires_operator?: boolean;
					constraints?: { id?: string }[];
					next_action_id?: string;
				};
				runtime_actions?: unknown[];
			};
			expect(envelope, args.join(" ")).toMatchObject({
				status: "error",
				error: { code: "activation_blocked" },
				data: { changed_state: "none" },
			});
			expect(envelope.data.blockers, args.join(" ")).toContain(
				"activation_blocked",
			);
			// The refusal's guidance routes through the review_prepared restriction. That
			// command handoff needs an evidence reference the restriction cannot carry,
			// so the authoritative U1 continuation fails closed: compat id review_prepared
			// preserved, union kind none / action_id none, continuation requires operator
			// review with a continuation_unavailable constraint (and blocker), and no
			// runtime action. The restriction cause (admission_missing) explains the stop.
			expect(envelope.data.next_action, args.join(" ")).toMatchObject({
				id: "review_prepared",
				kind: "none",
				action_id: "none",
			});
			expect(envelope.data.activation_restriction?.cause?.id, args.join(" ")).toBe(
				"admission_missing",
			);
			expect(
				envelope.data.activation_restriction?.next_action,
				args.join(" "),
			).toMatchObject({ id: "review_prepared", kind: "none", action_id: "none" });
			expect(envelope.data.blockers, args.join(" ")).toContain(
				"continuation_unavailable",
			);
			expect(envelope.continuation?.next_action_id, args.join(" ")).toBeUndefined();
			expect(envelope.continuation?.requires_operator, args.join(" ")).toBe(true);
			expect(
				(envelope.continuation?.constraints ?? []).map((c) => c.id),
				args.join(" "),
			).toContain("continuation_unavailable");
			expect(envelope.runtime_actions, args.join(" ")).toBeUndefined();
		}
		expect(fixture.remoteRefs()).toEqual(refsBefore);
		expect(fixture.git("status", "--porcelain=v2", "-z")).toBe(localBefore);
	});
});
