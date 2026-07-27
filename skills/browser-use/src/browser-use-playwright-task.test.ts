import { describe, expect, test } from "bun:test";
import {
	executePlaywrightTask,
	type PlaywrightTask,
} from "./browser-use-playwright-task";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";

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
		environment_schema_version: "1",
		route_evidence: "verified-live",
	},
	contract_id: "browser-connect.verified-handoff",
	schema_version: "2",
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
