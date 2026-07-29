import { describe, expect, test } from "bun:test";
import {
	executePlaywrightTask,
	type PlaywrightTask,
} from "./browser-use-playwright-task";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";
import { LIVE_CLEAN_PROFILE_POSTURE_FIXTURE } from "./browser-connect-handoff-fixtures";

const HANDOFF = {
	outcome: "verified",
	environment: { name: "agent-chrome", profile: "default" },
	browser_entry_mode: "explicit-cdp",
	attachment: {
		adapter_id: "playwright-cdp",
		route: "explicit-cdp",
		probe_executable: "/opt/adapters/playwright-cli",
	},
	endpoint: {
		http: "http://127.0.0.1:9222",
		ws: "ws://127.0.0.1:9222/devtools/browser/fixture",
	},
	launch: { launched: false },
	proof: {
		environment_contract_id: "warm-chrome.browser-entry",
		environment_schema_version: "2",
		route_evidence: "verified-live",
		profile_posture: LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
	},
	contract_id: "browser-connect.verified-handoff",
	schema_version: "3",
} as const;

function task(
	overrides: Partial<PlaywrightTask> = {},
): PlaywrightTask {
	return {
		handoff: HANDOFF,
		run_id: "run-playwright-1",
		target_tab_index: 1,
		allowed_origins: ["https://example.com"],
		intent: "frontend-test",
		...overrides,
	};
}

function result(
	stdout = "",
	overrides: Partial<McporterCommandResult> = {},
): McporterCommandResult {
	return { exitCode: 0, stdout, stderr: "", ...overrides };
}

describe("Playwright task lane", () => {
	test("attaches, selects the intended tab, snapshots its allowed origin, and detaches", async () => {
		const commands: McporterCommandInput[] = [];
		const outcome = await executePlaywrightTask(
			{
				runCommand: async (input) => {
					commands.push(input);
					if (input.args.at(-1) === "snapshot") {
						return result(
							"### Page\n- Page URL: https://example.com/account\n### Snapshot\n- heading \"Account\"\n",
						);
					}
					return result();
				},
			},
			task(),
		);

		expect(outcome).toMatchObject({
			ok: true,
			outcome: "confirmed",
			executed_commands: 4,
		});
		expect(commands.map((command) => command.args)).toEqual([
			[
				"attach",
				"--cdp=http://127.0.0.1:9222",
				"--session=browser-use-run-playwright-1",
			],
			["--session=browser-use-run-playwright-1", "tab-select", "1"],
			["--session=browser-use-run-playwright-1", "snapshot"],
			["--session=browser-use-run-playwright-1", "detach"],
		]);
	});

	test("resolves one fresh semantic ref, marks dispatch before click, and confirms a fresh visible postcondition", async () => {
		const commands: McporterCommandInput[] = [];
		let mutationMarked = false;
		let mutationMarkedBeforeClick = false;
		const outcome = await executePlaywrightTask(
			{
				runCommand: async (input) => {
					commands.push(input);
					if (input.args.at(-1) === "snapshot") {
						return result(
							[
								"### Page",
								"- Page URL: https://example.com/account",
								"### Snapshot",
								'- button "Save" [ref=e7] [cursor=pointer] [box=10,20,80,24]',
							].join("\n"),
						);
					}
					if (input.args.includes("click")) {
						mutationMarkedBeforeClick = mutationMarked;
					}
					if (input.args.includes("eval")) {
						return result("true\n");
					}
					return result();
				},
				beforeMutationDispatch: async () => {
					mutationMarked = true;
					return { ok: true };
				},
			},
			task({
				mutation: {
					role: "button",
					name: "Save",
					visible_selector: "[data-persisted='true']",
				},
			}),
		);

		expect(outcome).toMatchObject({
			ok: true,
			outcome: "confirmed",
			executed_commands: 6,
			mutation_dispatched: true,
		});
		expect(mutationMarkedBeforeClick).toBe(true);
		expect(commands.map((command) => command.args)).toEqual([
			[
				"attach",
				"--cdp=http://127.0.0.1:9222",
				"--session=browser-use-run-playwright-1",
			],
			["--session=browser-use-run-playwright-1", "tab-select", "1"],
			["--session=browser-use-run-playwright-1", "snapshot"],
			["--session=browser-use-run-playwright-1", "click", "e7"],
			[
				"--session=browser-use-run-playwright-1",
				"--raw",
				"eval",
				"el => !!(el && el.isConnected && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0)",
				"[data-persisted='true']",
			],
			["--session=browser-use-run-playwright-1", "detach"],
		]);
	});

	test.each([
		"- heading \"Account\" [ref=e1]",
		[
			'- button "Save" [ref=e7]',
			'- button "Save" [ref=e8]',
		].join("\n"),
	])("zero or duplicate current semantic matches refuse before mutation: %s", async (snapshotBody) => {
		const commands: McporterCommandInput[] = [];
		let markerCalls = 0;
		const outcome = await executePlaywrightTask(
			{
				runCommand: async (input) => {
					commands.push(input);
					return input.args.at(-1) === "snapshot"
						? result(
								[
									"### Page",
									"- Page URL: https://example.com/account",
									"### Snapshot",
									snapshotBody,
								].join("\n"),
							)
						: result();
				},
				beforeMutationDispatch: async () => {
					markerCalls += 1;
					return { ok: true };
				},
			},
			task({
				mutation: {
					role: "button",
					name: "Save",
					visible_selector: "[data-persisted='true']",
				},
			}),
		);

		expect(outcome).toMatchObject({
			ok: false,
			outcome: "not-achieved",
			code: "playwright_task_ref_invalid",
			mutation_dispatched: false,
		});
		expect(markerCalls).toBe(0);
		expect(commands.some((command) => command.args.includes("click"))).toBe(false);
		expect(commands.at(-1)?.args.at(-1)).toBe("detach");
	});

	test("a click command failure after the write-ahead marker becomes unknown and never retries", async () => {
		const commands: McporterCommandInput[] = [];
		const outcome = await executePlaywrightTask(
			{
				runCommand: async (input) => {
					commands.push(input);
					if (input.args.at(-1) === "snapshot") {
						return result(
							[
								"### Page",
								"- Page URL: https://example.com/account",
								"### Snapshot",
								'- button "Save" [ref=e7]',
							].join("\n"),
						);
					}
					return input.args.includes("click")
						? result("", { exitCode: 1, timedOut: true })
						: result();
				},
				beforeMutationDispatch: async () => ({ ok: true }),
			},
			task({
				mutation: {
					role: "button",
					name: "Save",
					visible_selector: "[data-persisted='true']",
				},
			}),
		);

		expect(outcome).toMatchObject({
			ok: false,
			outcome: "unknown",
			code: "playwright_task_mutation_effect_unknown",
			mutation_dispatched: true,
		});
		expect(
			commands.filter((command) => command.args.includes("click")),
		).toHaveLength(1);
		expect(commands.at(-1)?.args.at(-1)).toBe("detach");
	});

	test("refuses a snapshot from another origin and still detaches", async () => {
		const commands: McporterCommandInput[] = [];
		const outcome = await executePlaywrightTask(
			{
				runCommand: async (input) => {
					commands.push(input);
					return input.args.at(-1) === "snapshot"
						? result("### Page\n- Page URL: https://evil.example/account\n")
						: result();
				},
			},
			task(),
		);

		expect(outcome).toMatchObject({
			ok: false,
			code: "playwright_task_origin_refused",
			outcome: "not-achieved",
		});
		expect(commands.at(-1)?.args.at(-1)).toBe("detach");
	});

	test("classifies a failed read-only snapshot as not achieved and detaches", async () => {
		const commands: McporterCommandInput[] = [];
		const outcome = await executePlaywrightTask(
			{
				runCommand: async (input) => {
					commands.push(input);
					return input.args.at(-1) === "snapshot"
						? result("", { exitCode: 3, stderr: "target closed" })
						: result();
				},
			},
			task({ intent: "locator-aria-assertion" }),
		);

		expect(outcome).toMatchObject({
			ok: false,
			code: "playwright_task_command_failed",
			outcome: "not-achieved",
		});
		expect(commands.at(-1)?.args.at(-1)).toBe("detach");
	});

	test("invalid handoff evidence fails before any process starts", async () => {
		let calls = 0;
		const outcome = await executePlaywrightTask(
			{
				runCommand: async () => {
					calls += 1;
					return result();
				},
			},
			task({
				handoff: {
					...HANDOFF,
					attachment: {
						...HANDOFF.attachment,
						adapter_id: "agent-browser",
					},
				} as PlaywrightTask["handoff"],
			}),
		);

		expect(outcome).toMatchObject({
			ok: false,
			code: "playwright_task_handoff_invalid",
		});
		expect(calls).toBe(0);
	});

	test("forged posture provenance and endpoint binding fail before any process starts", async () => {
		for (const handoff of [
			{
				...HANDOFF,
				proof: {
					...HANDOFF.proof,
					environment_contract_id: "foreign.contract",
				},
			},
			{
				...HANDOFF,
				endpoint: {
					...HANDOFF.endpoint,
					ws: "ws://127.0.0.1:9243/devtools/browser/foreign",
				},
			},
		]) {
			let calls = 0;
			const outcome = await executePlaywrightTask(
				{
					runCommand: async () => {
						calls += 1;
						return result();
					},
				},
				task({ handoff }),
			);
			expect(outcome).toMatchObject({
				ok: false,
				code: "playwright_task_handoff_invalid",
			});
			expect(calls).toBe(0);
		}
	});

	for (const scenario of [
		{
			name: "missing",
			posture: undefined,
		},
		{
			name: "unsafe",
			posture: {
				...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
				effective: {
					...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE.effective,
					fill_exposure: "source-present",
				},
			},
		},
		{
			name: "unknown-key",
			posture: {
				...LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
				untrusted_extension: true,
			},
		},
	] as const) {
		test(`${scenario.name} profile posture fails before any Playwright process starts`, async () => {
			let calls = 0;
			const proof = {
				...HANDOFF.proof,
				...(scenario.posture === undefined
					? {}
					: { profile_posture: scenario.posture }),
			} as Record<string, unknown>;
			if (scenario.posture === undefined) delete proof.profile_posture;

			const outcome = await executePlaywrightTask(
				{
					runCommand: async () => {
						calls += 1;
						return result();
					},
				},
				task({
					handoff: {
						...HANDOFF,
						proof,
					} as unknown as PlaywrightTask["handoff"],
				}),
			);

			expect(outcome).toMatchObject({
				ok: false,
				code: "playwright_task_handoff_invalid",
			});
			expect(calls).toBe(0);
		});
	}

	test("attach failure is a typed connection result with no browser fallback", async () => {
		const outcome = await executePlaywrightTask(
			{
				runCommand: async () =>
					result("", { exitCode: 1, stderr: "connection refused" }),
			},
			task(),
		);

		expect(outcome).toMatchObject({
			ok: false,
			code: "playwright_task_connection_unstable",
		});
	});

	test("tab selection failure detaches before reporting not achieved", async () => {
		let call = 0;
		const commands: McporterCommandInput[] = [];
		const outcome = await executePlaywrightTask(
			{
				runCommand: async (input) => {
					commands.push(input);
					call += 1;
					return call === 2 ? result("", { exitCode: 2 }) : result();
				},
			},
			task(),
		);

		expect(outcome).toMatchObject({
			ok: false,
			code: "playwright_task_tab_unavailable",
		});
		expect(commands.at(-1)?.args.at(-1)).toBe("detach");
	});

	test("detach failure overrides otherwise confirmed evidence", async () => {
		const outcome = await executePlaywrightTask(
			{
				runCommand: async (input) => {
					if (input.args.at(-1) === "snapshot") {
						return result(
							"### Page\n- Page URL: https://example.com/account\n",
						);
					}
					return input.args.at(-1) === "detach"
						? result("", { timedOut: true })
						: result();
				},
			},
			task(),
		);

		expect(outcome).toMatchObject({
			ok: false,
			code: "playwright_task_detach_failed",
		});
	});

	test.each([
		{ run_id: "bad run" },
		{ target_tab_index: -1 },
		{ allowed_origins: [] },
		{ allowed_origins: ["ftp://example.com"] },
		{ allowed_origins: ["https://example.com/path"] },
	] satisfies Array<Partial<PlaywrightTask>>)(
		"invalid bounded task input fails before attach: %j",
		async (overrides) => {
			let calls = 0;
			const outcome = await executePlaywrightTask(
				{
					runCommand: async () => {
						calls += 1;
						return result();
					},
				},
				task(overrides),
			);

			expect(outcome).toMatchObject({
				ok: false,
				code: "playwright_task_input_invalid",
			});
			expect(calls).toBe(0);
		},
	);

	test("a process-start exception maps to connection instability", async () => {
		const outcome = await executePlaywrightTask(
			{
				runCommand: async () => {
					throw new Error("spawn failed");
				},
			},
			task(),
		);
		expect(outcome).toMatchObject({
			ok: false,
			code: "playwright_task_connection_unstable",
		});
	});
});
