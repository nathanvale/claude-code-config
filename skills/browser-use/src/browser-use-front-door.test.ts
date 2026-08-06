import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BROWSER_USE_REVIEWED_ACTION_AUTHORING_CONTRACT_ID,
	BROWSER_USE_RUNBOOK_AUTHORING_CONTRACT_ID,
	BROWSER_USE_FAMILIES,
	BROWSER_USE_FAMILY_SUBCOMMANDS,
	type BrowserUseFamily,
	browserUseContracts,
} from "./command-contract";
import { verifiedHandoffEnvelope } from "./browser-connect-handoff-fixtures";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

// ---------------------------------------------------------------------------
// Agent-first front-door smoke tests (design brief D1-D7,
// docs/plans/2026-07-27-agent-first-front-door-brief.md).
//
// browser-use is the ONLY public front door. These tests pin the launcher,
// root-help shape, guide family, leaf usage identity, error identity, and
// output budgets so public help, parser acceptance, and command metadata
// cannot drift. Deliberately replaces the split-front-door expectation the
// earlier parser tests carried (handoff 2026-07-27).
// ---------------------------------------------------------------------------

// Output budgets (D7 slice 9). Fixed numbers, not ratios, so a help edit that
// bloats the surface fails loudly here instead of silently taxing every agent
// cold start.
const NO_ARG_BUDGET_LINES = 30;
const ROOT_HELP_BUDGET_LINES = 60;
const GUIDE_DEFAULT_BUDGET_LINES = 150;

const lineCount = (text: string): number =>
	text.split("\n").filter((line) => line.trim() !== "").length;

describe("front door: no-arg launcher (D1)", () => {
	test("no args exits 0 with a compact launcher naming guide", async () => {
		const result = await runForTest([], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("browser-use -");
		expect(result.stdout).toContain("Start here");
		expect(result.stdout).toContain("browser-use guide");
		expect(result.stdout).toContain("--help");
		expect(lineCount(result.stdout)).toBeLessThanOrEqual(NO_ARG_BUDGET_LINES);
	});

	test("launcher teaches no secondary CLI", async () => {
		const result = await runForTest([], makeRuntime());
		expect(result.stdout).not.toContain("browser-connect");
		expect(result.stdout).not.toContain("agent-browser");
	});
});

describe("front door: root help (D2)", () => {
	test("root help is agent-first and intent-grouped", async () => {
		const result = await runForTest(["--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Start here (for AI agents)");
		expect(result.stdout).toContain("browser-use guide");
		expect(result.stdout).toContain("task list");
		expect(lineCount(result.stdout)).toBeLessThanOrEqual(
			ROOT_HELP_BUDGET_LINES,
		);
	});

	test("every command family stays discoverable from root help", async () => {
		const result = await runForTest(["--help"], makeRuntime());
		for (const family of BROWSER_USE_FAMILIES) {
			expect(result.stdout).toContain(family);
		}
	});

	test("root help teaches no secondary CLI (single front door)", async () => {
		const result = await runForTest(["--help"], makeRuntime());
		expect(result.stdout).not.toContain("browser-connect");
		// The lane id is data (lanes list output), not a command agents run from
		// root help.
		expect(result.stdout).not.toContain("agent-browser ");
	});
});

describe("front door: guide family (D3)", () => {
	test("bare `guide` resolves to the core topic and exits 0", async () => {
		const result = await runForTest(["guide"], makeRuntime());
		expect(result.exitCode).toBe(0);
		// Core loop coverage: discovery, everyday run, recovery pointer.
		expect(result.stdout).toContain("task list");
		expect(result.stdout).toContain("task run");
		expect(lineCount(result.stdout)).toBeLessThanOrEqual(
			GUIDE_DEFAULT_BUDGET_LINES,
		);
	});

	test("guide topics render recovery guidance", async () => {
		const result = await runForTest(
			["guide", "show", "--topic", "recovery"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("repair");
	});

	test("guide core teaches the everyday path without secondary CLIs", async () => {
		const result = await runForTest(["guide"], makeRuntime());
		expect(result.stdout).not.toContain("browser-connect connect");
	});

	test("every guide topic renders its own content", async () => {
		const topics: Array<[string, string]> = [
			["auth", "Item Binding"],
			["lanes", "lanes list"],
			["recovery", "Repair Path"],
			["setup", "required_binary"],
		];
		for (const [topic, marker] of topics) {
			const result = await runForTest(
				["guide", "show", "--topic", topic],
				makeRuntime(),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain(marker);
		}
	});

	test("setup guide teaches a bounded human adapter-install handoff", async () => {
		const result = await runForTest(
			["guide", "show", "--topic", "setup"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("repair-adapter <adapter-id> --check --json");
		expect(result.stdout).toContain("package_name");
		expect(result.stdout).toContain("pinned_version");
		expect(result.stdout).toContain("install_scope");
		expect(result.stdout).toContain("lifecycle_scripts_required");
		expect(result.stdout).toContain("tell the human");
		expect(result.stdout).toContain("Never run `agent-browser install`");
		expect(result.stdout).not.toContain("@latest");
		expect(result.stdout).not.toContain("sudo");
	});

	test("guide --full appends the page-action lifecycle to core", async () => {
		const core = await runForTest(["guide"], makeRuntime());
		const full = await runForTest(["guide", "--full"], makeRuntime());
		expect(full.exitCode).toBe(0);
		expect(full.stdout).toContain(core.stdout);
		expect(full.stdout).toContain("Page-action lifecycle (one adapter, one continuity)");
		expect(core.stdout).not.toContain(
			"Page-action lifecycle (one adapter, one continuity)",
		);
	});

	test("guide --full teaches semantic click and auto-attached target discovery", async () => {
		const result = await runForTest(["guide", "--full"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("--click-role");
		expect(result.stdout).toContain("--postcondition-id");
		expect(result.stdout).toContain(
			"The same semantic contract is available to Playwright",
		);
		expect(result.stdout).toContain(
			"targets list --mode handoff-bound --adapter <id>",
		);
		expect(result.stdout).not.toContain("--handoff <envelope>");
	});

	test("guide --json wraps the same text in the standard envelope", async () => {
		const result = await runForTest(["guide", "--json"], makeRuntime());
		expect(result.exitCode).toBe(0);
		const envelope = parseJson(result.stdout) as {
			status: string;
			data: { result_kind: string; topic: string; guide: string };
		};
		expect(envelope.status).toBe("ok");
		expect(envelope.data.result_kind).toBe("guide");
		expect(envelope.data.topic).toBe("core");
		expect(envelope.data.guide).toContain("task run");
	});
});

describe("front door: leaf usage identity (D5)", () => {
	test("every leaf help names the browser-use executable", async () => {
		for (const family of BROWSER_USE_FAMILIES) {
			for (const subcommand of BROWSER_USE_FAMILY_SUBCOMMANDS[
				family as BrowserUseFamily
			]) {
				const result = await runForTest(
					[family, subcommand, "--help"],
					makeRuntime(),
				);
				expect(result.exitCode).toBe(0);
				expect(result.stdout).toContain("Usage: browser-use ");
			}
		}
	});
});

describe("front door: error identity (D6)", () => {
	test("unknown family names the invalid token", async () => {
		const result = await runForTest(["bogus-family"], makeRuntime());
		expect(result.exitCode).toBe(2);
		const envelope = parseJson(result.stdout) as {
			status: string;
			error: { message: string };
		};
		expect(envelope.status).toBe("error");
		expect(envelope.error.message).toContain("bogus-family");
	});

	test("unknown subcommand names the invalid token and its family", async () => {
		const result = await runForTest(["task", "bogus-leaf"], makeRuntime());
		expect(result.exitCode).toBe(2);
		const envelope = parseJson(result.stdout) as {
			status: string;
			error: { message: string };
		};
		expect(envelope.error.message).toContain("bogus-leaf");
		expect(envelope.error.message).toContain("task");
	});

	test("auth status leaf help is derived from its command contract", async () => {
		const result = await runForTest(["auth", "status", "--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Usage: browser-use auth status");
		expect(result.stdout).toContain("--json");
		expect(result.stdout).not.toContain("Subcommands:");
	});

	test("freeform auth login is a discoverable Browser Use leaf", async () => {
		const result = await runForTest(["auth", "login", "--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Usage: browser-use auth login");
		expect(result.stdout).toContain("--handoff");
		expect(result.stdout).toContain("--service");
		expect(result.stdout).toContain("--allowed-origin");
		expect(result.stdout).not.toContain("--vault-id");
		expect(result.stdout).not.toContain("--item-id");
		expect(browserUseContracts["auth-login"].interactivity).toBe("optional");
	});
});

describe("front door: machine discovery stays parseable (D7)", () => {
	test("task list --json parses with registered intents", async () => {
		const result = await runForTest(["task", "list", "--json"], makeRuntime());
		expect(result.exitCode).toBe(0);
		const envelope = parseJson(result.stdout) as {
			status: string;
			data?: unknown;
		};
		expect(envelope.status).toBe("ok");
	});

	test("lanes list --json reports the agent-browser lane", async () => {
		const result = await runForTest(["lanes", "list", "--json"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("agent-browser");
	});

	test("runbook and action schema handlers emit their structured result contracts", async () => {
		const cases = [
			{
				argv: ["runbook", "schema", "--json"],
				command: "runbook-schema",
				contractId: BROWSER_USE_RUNBOOK_AUTHORING_CONTRACT_ID,
			},
			{
				argv: ["action", "schema", "--json"],
				command: "action-schema",
				contractId: BROWSER_USE_REVIEWED_ACTION_AUTHORING_CONTRACT_ID,
			},
		] as const;

		for (const { argv, command, contractId } of cases) {
			const result = await runForTest(argv, makeRuntime());
			expect(result.exitCode).toBe(0);
			const envelope = parseJson(result.stdout);
			expect(envelope.status).toBe("ok");
			expect(envelope.data).toMatchObject({
				contract_id: contractId,
				schema_version: "1",
				command,
				result: expect.any(Object),
			});
		}
	});

	test("every remaining runbook and action leaf reaches a typed handler diagnostic", async () => {
		const agentBrowserHandoff = verifiedHandoffEnvelope((envelope) => {
			envelope.data.attachment.adapter_id = "agent-browser";
			envelope.data.attachment.probe_executable =
				"/opt/browser-connect/agent-browser";
		});
		const runtime = makeRuntime({
			sourceCheckoutRoot: null,
			readTextFile: async (path) => {
				if (path === "handoff.json") return agentBrowserHandoff;
				throw new Error("fixture file is deliberately unavailable");
			},
		});
		const digest = "a".repeat(64);
		const cases = [
			{
				argv: ["runbook", "validate", "--file", "draft.json", "--json"],
				command: "runbook-validate",
				code: "runbook_document_unreadable",
			},
			{
				argv: ["runbook", "apply", "--file", "draft.json", "--json"],
				command: "runbook-apply",
				code: "runbook_source_checkout_required",
			},
			{
				argv: [
					"runbook", "delete", "--service", "service", "--flow", "flow", "--json",
				],
				command: "runbook-delete",
				code: "runbook_source_checkout_required",
			},
			{
				argv: ["runbook", "list", "--json"],
				command: "runbook-list",
				code: "xdg_root_relative",
			},
			{
				argv: [
					"runbook", "show", "--service", "service", "--flow", "flow", "--json",
				],
				command: "runbook-show",
				code: "xdg_root_relative",
			},
			{
				argv: [
					"runbook", "activate", "--catalog-digest", digest,
					"--expected-epoch", "0", "--json",
				],
				command: "runbook-activate",
				code: "catalog_source_unavailable",
			},
			{
				argv: [
					"runbook", "run", "--service", "service", "--flow", "flow",
					"--handoff", "handoff.json", "--json",
				],
				command: "runbook-run",
				code: "xdg_root_relative",
			},
			{
				argv: ["action", "validate", "--file", "candidate.json", "--json"],
				command: "action-validate",
				code: "action_document_unreadable",
			},
			{
				argv: ["action", "apply", "--file", "candidate.json", "--json"],
				command: "action-apply",
				code: "action_document_unreadable",
			},
			{
				argv: ["action", "status", "--id", "action-id", "--json"],
				command: "action-status",
				code: "action_source_checkout_required",
			},
			{
				argv: [
					"action", "promote", "--id", "action-id",
					"--approval-reference", "review-1", "--json",
				],
				command: "action-promote",
				code: "action_source_checkout_required",
			},
		] as const;

		for (const { argv, command, code } of cases) {
			const result = await runForTest(argv, runtime);
			expect(result.exitCode).toBe(20);
			const envelope = parseJson(result.stdout);
			expect(envelope.status).toBe("error");
			expect(envelope.data).toMatchObject({ command });
			expect(envelope.error).toMatchObject({ code });
			expect(envelope.error).not.toMatchObject({
				code: "browser_use_not_implemented",
			});
		}
	});
});

describe("front door: everyday task run needs no caller-managed handoff (D4)", () => {
	test("task run --intent parses without --handoff (internal mint path)", async () => {
		// Dry-run exercises parser acceptance without a live mint or store.
		const result = await runForTest(
			["task", "run", "--intent", "scrape", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(0);
	});

	test("task run --run resume still requires the caller-managed --handoff", async () => {
		const result = await runForTest(
			["task", "run", "--run", "some-run", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(2);
		const envelope = parseJson(result.stdout) as {
			error: { message: string };
		};
		expect(envelope.error.message).toContain("--handoff");
	});

	test("runbook run --run resume also requires the caller-managed --handoff", async () => {
		// CodeRabbit PR 263: the guard must hold for BOTH resume surfaces — a
		// resume must never silently re-attach through a freshly minted envelope.
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "svc",
				"--flow", "flow",
				"--run", "some-run",
				"--json",
			],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(2);
		const envelope = parseJson(result.stdout) as {
			error: { message: string };
		};
		expect(envelope.error.message).toContain("--handoff");
	});

	test("task run leaf help teaches auto-attach, not the secondary CLI", async () => {
		const result = await runForTest(["task", "run", "--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("attaches automatically");
		// The --handoff flag description may NAME the envelope's owning contract;
		// what everyday help must never do is instruct running the secondary CLI.
		expect(result.stdout).not.toContain("browser-connect connect");
	});

	test("targets list leaf help teaches auto-attach, not the secondary CLI", async () => {
		const result = await runForTest(
			["targets", "list", "--help"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("attaches automatically");
		expect(result.stdout).not.toContain("browser-connect connect");
	});
});

describe("front door: installed bin identity (D7 slice 10)", () => {
	test("package.json declares the browser-use bin and setup pathBin", () => {
		const packageJson = JSON.parse(
			readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
		) as {
			bin?: Record<string, string>;
			setup?: { pathBin?: Record<string, string> };
		};
		expect(packageJson.bin?.["browser-use"]).toBeDefined();
		expect(packageJson.setup?.pathBin?.["browser-use"]).toBeDefined();
	});
});
