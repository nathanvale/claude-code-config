import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	extractPageId,
	normalizeTask,
	normalizeTaskId,
	parseCli,
	runCommand,
	type Envelope,
} from "./coding-task-tracker";

const dataSourceUrl = "collection://22ca3712-3878-8195-ad9e-000be535aa4b";
const readyViewUrl = "view://379a3712-3878-81bd-ab8a-000cecd65006";
const allTasksViewUrl = "view://22ca3712-3878-8133-a843-000c16abdab1";

const seedRow = {
	Repo: "claude-code-config",
	Priority: "P2",
	Status: "Ready",
	Category: "enhancement",
	"Task ID": "29",
	Branch: "",
	"Triage State": "ready-for-agent",
	Agent: "",
	"Reference URL": "https://app.notion.com/p/18ba3712387880d8b075f0b165f1d627",
	"Blocked Reason": "",
	"Pull Request": "",
	Name: "Seed task: prove Notion agent tracker workflow",
	url: "https://app.notion.com/p/379a3712387881c59074fd922da3e96d",
};

function withTempOwner(run: (ownerPath: string, childPath: string) => void) {
	const ownerPath = mkdtempSync(path.join(tmpdir(), "ctt-owner-"));
	const childPath = path.join(ownerPath, "skills", "example");
	mkdirSync(childPath, { recursive: true });
	mkdirSync(path.join(ownerPath, ".coding-task-tracker"), { recursive: true });
	writeFileSync(
		path.join(ownerPath, ".coding-task-tracker", "repo.json"),
		`${JSON.stringify({ owner_key: "claude-code-config", owner_uuid: "00000000-0000-4000-8000-000000000029", provider: "notion" }, null, 2)}\n`,
	);
	writeFileSync(
		path.join(ownerPath, ".coding-task-tracker", "local.json"),
		`${JSON.stringify({ data_source_url: dataSourceUrl, ready_view_url: readyViewUrl, all_tasks_view_url: allTasksViewUrl }, null, 2)}\n`,
	);
	try {
		run(ownerPath, childPath);
	} finally {
		rmSync(ownerPath, { recursive: true, force: true });
	}
}

function taskFetchText(parentDataSourceUrl = dataSourceUrl, row: typeof seedRow = seedRow): string {
	return `<parent-data-source url="${parentDataSourceUrl}"><properties>${JSON.stringify(row)}</properties></parent-data-source>`;
}

type RunnerOptions = {
	queryRows?: Array<Record<string, unknown>>;
	dataSourceText?: string;
	taskPageText?: string;
};

function makeRunner(calls: Array<{ tool: string; payload: Record<string, unknown> }>, options: RunnerOptions = {}) {
	return (tool: string, payload: Record<string, unknown>) => {
		calls.push({ tool, payload });
		if (tool === "notion-query-database-view") {
			return {
				exitCode: 0,
				stdout: JSON.stringify({ results: options.queryRows ?? [seedRow], has_more: false }),
				stderr: "",
			};
		}
		if (tool === "notion-fetch" && payload.id === dataSourceUrl) {
			return {
				exitCode: 0,
				stdout: JSON.stringify({
					text: options.dataSourceText ?? `<data-source url="{{${dataSourceUrl}}}">{"url":"${dataSourceUrl}"}</data-source>`,
				}),
				stderr: "",
			};
		}
		if (tool === "notion-fetch" && (payload.id === extractPageId(seedRow.url) || payload.id === seedRow.url)) {
			return {
				exitCode: 0,
				stdout: JSON.stringify({ text: options.taskPageText ?? taskFetchText() }),
				stderr: "",
			};
		}
		if (tool === "notion-update-page") {
			return {
				exitCode: 0,
				stdout: JSON.stringify({ ok: true }),
				stderr: "",
			};
		}
		return {
			exitCode: 1,
			stdout: "",
			stderr: `unexpected ${tool}`,
		};
	};
}

function expectWriteBlockedBeforeUpdate(
	result: Envelope,
	calls: Array<{ tool: string; payload: Record<string, unknown> }>,
	code: string,
) {
	expect(result.status).toBe("error");
	expect(result.error?.code).toBe(code);
	expect(result.mutation.attempted).toBe(false);
	expect(calls.some((call) => call.tool === "notion-update-page")).toBe(false);
}

describe("normalization", () => {
	test("normalizes task ID variants", () => {
		expect(normalizeTaskId("29")).toBe("29");
		expect(normalizeTaskId("TASK-29")).toBe("29");
	});

	test("extracts hyphenated page IDs from Notion URLs", () => {
		expect(extractPageId("https://app.notion.com/p/379a3712387881c59074fd922da3e96d")).toBe(
			"379a3712-3878-81c5-9074-fd922da3e96d",
		);
	});

	test("marks only ready agent tasks as pickable", () => {
		const task = normalizeTask(seedRow);
		expect(task.task_id).toBe("TASK-29");
		expect(task.pickable).toBe(true);
		expect(task.next_safe_action).toBe("claim");
	});
});

describe("cli parser", () => {
	test("defaults to front door when no command is provided", () => {
		expect(parseCli([])).toMatchObject({ command: "front-door", help: false });
		expect(parseCli(["--json"])).toMatchObject({ command: "front-door", json: true, help: false });
	});

	test("accepts owner before or after command", () => {
		expect(parseCli(["--owner", "../..", "ready", "--json"])).toMatchObject({
			command: "ready",
			flags: { owner: "../..", json: true },
		});
		expect(parseCli(["ready", "--owner", "../..", "--json"])).toMatchObject({
			command: "ready",
			flags: { owner: "../..", json: true },
		});
	});

	test("top-level help wins", () => {
		expect(parseCli(["--help"])).toMatchObject({ command: "help", help: true });
	});

	test("help shows triage status promotion", () => {
		const result = runCommand(parseCli(["--help"]), makeRunner([]), process.cwd());

		expect(result.status).toBe("ok");
		expect(String((result.data as { help: string }).help)).toContain(
			"triage <target> [--status <Backlog|Ready>] [--triage-state <state>] [--category <category>]",
		);
	});
});

describe("commands", () => {
	test("front door asks which repo domain should own tracking", () => {
		withTempOwner((_ownerPath, childPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(parseCli(["--json"]), makeRunner(calls), childPath);
			const data = result.data as {
				question: string;
				candidates: Array<{ owner_arg: string; configured: boolean; recommended: boolean }>;
			};

			expect(result.status).toBe("ok");
			expect(result.command).toBe("front-door");
			expect(result.next_action).toBe("choose-tracker-owner-domain");
			expect(result.owner_resolution?.status).toBe("inherited");
			expect(data.question).toBe("Which part of this repo should own the task tracker?");
			expect(data.candidates.some((candidate) => candidate.owner_arg === "." && !candidate.configured)).toBe(true);
			expect(data.candidates.some((candidate) => candidate.owner_arg === "../.." && candidate.configured)).toBe(true);
			expect(calls).toHaveLength(0);
		});
	});

	test("ready queries the ready view from an inherited owner", () => {
		withTempOwner((_ownerPath, childPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(parseCli(["ready", "--json"]), makeRunner(calls), childPath);

			expect(result.status).toBe("ok");
			expect(result.owner_resolution?.status).toBe("inherited");
			expect(result.owner_resolution?.write_allowed).toBe(false);
			expect(result.next_action).toBe("confirm-owner-before-write");
			expect(calls[0]?.tool).toBe("notion-query-database-view");
			expect(calls[0]?.payload.view_url).toBe(readyViewUrl);
			expect(((result as Envelope).data as { count: number }).count).toBe(1);
		});
	});

	test("ready queries the ready view from an exact owner", () => {
		withTempOwner((ownerPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(parseCli(["ready", "--json"]), makeRunner(calls), ownerPath);

			expect(result.status).toBe("ok");
			expect(result.owner_resolution?.status).toBe("exact");
			expect(result.owner_resolution?.write_allowed).toBe(true);
			expect(result.next_action).toBe("claim-task");
		});
	});

	test("missing owner config blocks reads before Notion access", () => {
		const ownerPath = mkdtempSync(path.join(tmpdir(), "ctt-no-owner-"));
		try {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(parseCli(["ready", "--json"]), makeRunner(calls), ownerPath);

			expect(result.status).toBe("error");
			expect(result.error?.code).toBe("tracker_not_configured");
			expect(result.mutation.attempted).toBe(false);
			expect(calls).toHaveLength(0);
		} finally {
			rmSync(ownerPath, { recursive: true, force: true });
		}
	});

	test("broken child owner config blocks fallback to parent", () => {
		withTempOwner((_ownerPath, childPath) => {
			mkdirSync(path.join(childPath, ".coding-task-tracker"), { recursive: true });
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(parseCli(["ready", "--json"]), makeRunner(calls), childPath);

			expect(result.status).toBe("error");
			expect(result.error?.code).toBe("tracker_config_broken");
			expect(result.owner_resolution?.status).toBe("broken");
			expect(result.owner_resolution?.owner_path).toBe(childPath);
			expect(calls).toHaveLength(0);
		});
	});

	test("bind writes split owner config after Notion validation", () => {
		const ownerPath = mkdtempSync(path.join(tmpdir(), "ctt-bind-"));
		try {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(
				parseCli([
					"bind",
					"--owner",
					".",
					"--owner-key",
					"example-skill",
					"--owner-uuid",
					"00000000-0000-4000-8000-000000000123",
					"--data-source",
					dataSourceUrl,
					"--ready-view",
					readyViewUrl,
					"--all-tasks-view",
					allTasksViewUrl,
					"--json",
				]),
				makeRunner(calls),
				ownerPath,
			);

			expect(result.status).toBe("ok");
			expect(calls[0]?.tool).toBe("notion-fetch");
			expect(JSON.parse(readFileSync(path.join(ownerPath, ".coding-task-tracker", "repo.json"), "utf8"))).toEqual({
				owner_key: "example-skill",
				owner_uuid: "00000000-0000-4000-8000-000000000123",
				provider: "notion",
			});
			expect(JSON.parse(readFileSync(path.join(ownerPath, ".coding-task-tracker", "local.json"), "utf8"))).toEqual({
				data_source_url: dataSourceUrl,
				ready_view_url: readyViewUrl,
				all_tasks_view_url: allTasksViewUrl,
			});
		} finally {
			rmSync(ownerPath, { recursive: true, force: true });
		}
	});

	test("claim refuses non-pickable tasks before mutation", () => {
		withTempOwner((ownerPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(
				parseCli(["claim", "--task-id", "29", "--agent", "codex", "--branch", "codex/task-29", "--json"]),
				makeRunner(calls, { queryRows: [{ ...seedRow, Status: "Backlog", "Triage State": "needs-triage" }] }),
				ownerPath,
			);

			expectWriteBlockedBeforeUpdate(result, calls, "not_pickable");
		});
	});

	test("inherited owner write blocks before Notion access", () => {
		withTempOwner((_ownerPath, childPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(
				parseCli(["claim", "--task-id", "TASK-29", "--agent", "codex", "--branch", "codex/task-29", "--json"]),
				makeRunner(calls),
				childPath,
			);

			expect(result.status).toBe("error");
			expect(result.error?.code).toBe("inherited_owner_write_blocked");
			expect(result.owner_resolution?.status).toBe("inherited");
			expect(calls).toHaveLength(0);
		});
	});

	test("global owner allows write from a child path", () => {
		withTempOwner((ownerPath, childPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(
				parseCli(["--owner", ownerPath, "claim", "--task-id", "TASK-29", "--agent", "codex", "--branch", "codex/task-29", "--json"]),
				makeRunner(calls),
				childPath,
			);

			expect(result.status).toBe("ok");
			expect(result.owner_resolution?.status).toBe("exact");
			expect(result.mutation.confirmed).toBe(true);
			const update = calls.find((call) => call.tool === "notion-update-page");
			expect(update?.payload.page_id).toBe("379a3712-3878-81c5-9074-fd922da3e96d");
			expect(update?.payload.properties).toEqual({
				Status: "Doing",
				Agent: "codex",
				Branch: "codex/task-29",
			});
		});
	});

	test("stale view binding blocks writes before update", () => {
		withTempOwner((ownerPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(
				parseCli(["claim", "--task-id", "TASK-29", "--agent", "codex", "--branch", "codex/task-29", "--json"]),
				makeRunner(calls, {
					dataSourceText: `<data-source>{"url":"${dataSourceUrl}"}</data-source>`,
					taskPageText: taskFetchText("collection://wrong"),
				}),
				ownerPath,
			);

			expectWriteBlockedBeforeUpdate(result, calls, "view_data_source_mismatch");
		});
	});

	test("triage mutation output preserves unchanged task fields", () => {
		withTempOwner((ownerPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(
				parseCli(["triage", "--task-id", "29", "--triage-state", "ready-for-agent", "--json"]),
				makeRunner(calls),
				ownerPath,
			);

			expect(result.status).toBe("ok");
			const task = (result.data as { task: { status: string; priority: string; repo: string } }).task;
			expect(task.status).toBe("Ready");
			expect(task.priority).toBe("P2");
			expect(task.repo).toBe("claude-code-config");
		});
	});

	test("get can fetch a task by page id", () => {
		withTempOwner((ownerPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const pageId = extractPageId(seedRow.url);
			const result = runCommand(parseCli(["get", "--page-id", pageId, "--json"]), makeRunner(calls), ownerPath);

			expect(result.status).toBe("ok");
			const task = (result.data as { task: { task_id: string } }).task;
			expect(task.task_id).toBe("TASK-29");
			expect(calls.some((call) => call.tool === "notion-fetch" && call.payload.id === pageId)).toBe(true);
		});
	});

	test("triage can update a task by page id", () => {
		withTempOwner((ownerPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const pageId = extractPageId(seedRow.url);
			const result = runCommand(
				parseCli(["triage", "--page-id", pageId, "--triage-state", "ready-for-human", "--json"]),
				makeRunner(calls),
				ownerPath,
			);

			expect(result.status).toBe("ok");
			const update = calls.find((call) => call.tool === "notion-update-page");
			expect(update?.payload.page_id).toBe(pageId);
			expect(update?.payload.properties).toEqual({
				"Triage State": "ready-for-human",
			});
		});
	});

	test("triage can make backlog work pickable", () => {
		withTempOwner((ownerPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(
				parseCli(["triage", "--task-id", "29", "--status", "Ready", "--triage-state", "ready-for-agent", "--json"]),
				makeRunner(calls, { queryRows: [{ ...seedRow, Status: "Backlog", "Triage State": "needs-triage" }] }),
				ownerPath,
			);

			expect(result.status).toBe("ok");
			const task = (result.data as { task: { status: string; triage_state: string; pickable: boolean } }).task;
			expect(task.status).toBe("Ready");
			expect(task.triage_state).toBe("ready-for-agent");
			expect(task.pickable).toBe(true);
			const update = calls.find((call) => call.tool === "notion-update-page");
			expect(update?.payload.properties).toEqual({
				Status: "Ready",
				"Triage State": "ready-for-agent",
			});
		});
	});

	test("triage rejects implementation statuses before mutation", () => {
		withTempOwner((ownerPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(
				parseCli(["triage", "--task-id", "29", "--status", "Done", "--json"]),
				makeRunner(calls),
				ownerPath,
			);

			expect(result.status).toBe("error");
			expect(result.error?.code).toBe("invalid_option");
			expect(result.mutation.attempted).toBe(false);
			expect(calls).toHaveLength(0);
		});
	});

	test("triage missing input mentions status repair", () => {
		withTempOwner((ownerPath) => {
			const result = runCommand(parseCli(["triage", "--task-id", "29", "--json"]), makeRunner([]), ownerPath);

			expect(result.status).toBe("error");
			expect(result.error?.message).toContain("--status");
			expect(result.next_action).toBe("rerun-with-status-triage-state-or-category");
		});
	});

	test("invalid priority fails before mutation", () => {
		withTempOwner((ownerPath) => {
			const calls: Array<{ tool: string; payload: Record<string, unknown> }> = [];
			const result = runCommand(
				parseCli(["priority", "--task-id", "29", "--priority", "P9", "--json"]),
				makeRunner(calls),
				ownerPath,
			);

			expect(result.status).toBe("error");
			expect(result.error?.code).toBe("invalid_option");
			expect(result.mutation.attempted).toBe(false);
			expect(result.owner_resolution?.status).toBe("exact");
			expect(calls).toHaveLength(0);
		});
	});
});
