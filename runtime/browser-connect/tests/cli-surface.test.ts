import { describe, expect, test } from "bun:test";
import {
	findCommandDiscoveryTreeDrift,
	findCommandFacadeMetadataDrift,
	renderCommandUsage,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";

import {
	BROWSER_CONNECT_CLI_NAME,
	BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS,
	BROWSER_CONNECT_CONTRACT_ID,
	BROWSER_CONNECT_FAILURE_ACTION_IDS,
	BROWSER_CONNECT_SCHEMA_VERSION,
	BROWSER_CONNECT_SUCCESS_ACTION_IDS,
} from "../src/model.ts";
import {
	BROWSER_CONNECT_COMMANDS,
	BROWSER_CONNECT_GLOBAL_DIAGNOSTIC_FLAGS,
	BROWSER_CONNECT_PREVIEW_NOTES,
	browserConnectContractEntries,
	browserConnectContracts,
	browserConnectContractFailureActions,
	browserConnectContractSuccessActions,
	browserConnectReadExitCodes,
	browserConnectRunExitCodes,
	projectBrowserConnectCommandDiscoveryTree,
} from "../src/command-contract.ts";

const CONTRACT_PATH = "runtime/browser-connect/src/command-contract.ts";
const MUTATING_COMMANDS = ["connect", "run"] as const;
const READ_COMMANDS = ["dashboard", "check"] as const;
const GLOBAL_DIAGNOSTIC_FLAGS = BROWSER_CONNECT_GLOBAL_DIAGNOSTIC_FLAGS;

describe("browser-connect command contract (U3 R2/R7/R15/R17)", () => {
	test("declares exactly the four public commands on the browser-connect script", () => {
		expect(Object.keys(browserConnectContracts).sort()).toEqual(
			[...BROWSER_CONNECT_COMMANDS].sort(),
		);
		expect([...BROWSER_CONNECT_COMMANDS].sort()).toEqual([
			"check",
			"connect",
			"dashboard",
			"run",
		]);
		for (const command of BROWSER_CONNECT_COMMANDS) {
			expect(browserConnectContracts[command].script).toBe(
				BROWSER_CONNECT_CLI_NAME,
			);
		}
		expect(browserConnectContractEntries.map(([command]) => command)).toEqual([
			...BROWSER_CONNECT_COMMANDS,
		]);
	});

	test("dashboard is the operator read-only surface; check/connect/run are agent surfaces", () => {
		expect(browserConnectContracts.dashboard.audience).toBe("operator");
		expect(browserConnectContracts.dashboard.mutation).toBe("check");
		expect(browserConnectContracts.dashboard.sideEffects).toEqual(["read"]);
		expect(browserConnectContracts.check.audience).toBe("agent");
		expect(browserConnectContracts.connect.audience).toBe("agent");
		expect(browserConnectContracts.run.audience).toBe("agent");
		for (const command of BROWSER_CONNECT_COMMANDS) {
			expect(browserConnectContracts[command].json).toBe(true);
		}
	});

	test("read commands declare baseline 0/1/2 plus package-owned 20; run adds 127 (KTD4)", () => {
		for (const command of READ_COMMANDS) {
			expect(
				Object.keys(browserConnectContracts[command].exitCodes).sort(
					(a, b) => Number(a) - Number(b),
				),
			).toEqual(["0", "1", "2", "20"]);
		}
		for (const command of MUTATING_COMMANDS) {
			const codes = Object.keys(browserConnectContracts[command].exitCodes).sort(
				(a, b) => Number(a) - Number(b),
			);
			// connect keeps the read exit set; run adds 127.
			if (command === "run") {
				expect(codes).toEqual(["0", "1", "2", "20", "127"]);
			} else {
				expect(codes).toEqual(["0", "1", "2", "20"]);
			}
		}
		// Exit-20 meaning is agent-visible and carries the fail-closed,
		// no-fallback continuation meaning (R11).
		expect(browserConnectReadExitCodes["20"].toLowerCase()).toContain(
			"no adapter fallback",
		);
		expect(browserConnectRunExitCodes["127"]).toContain("Wrapped command");
	});

	test("facade metadata drift validator returns no findings", () => {
		expect(
			findCommandFacadeMetadataDrift(browserConnectContracts, {
				path: CONTRACT_PATH,
				writeImplyingMutations: new Set(["browser"]),
			}),
		).toEqual([]);
	});

	test("run usage line declares the -- separator boundary and the wrapped command", () => {
		const usage = browserConnectContracts.run.usage.join("\n");
		expect(usage).toContain("--");
		expect(usage).toContain("<command>");
	});

	test("connect and run name an <adapter> operand in usage", () => {
		for (const command of MUTATING_COMMANDS) {
			expect(browserConnectContracts[command].usage.join("\n")).toContain(
				"<adapter>",
			);
		}
	});
});

describe("browser-connect help flag surface (U3)", () => {
	test("every advertised flag renders in help; no command-foreign flag leaks", () => {
		for (const command of BROWSER_CONNECT_COMMANDS) {
			const contract = browserConnectContracts[command];
			assertCommandHelpFlagSurface({
				command,
				contract,
				help: renderCommandUsage(contract),
				// No command in slice one owns a private flag beyond --json, so a
				// foreign-flag probe uses a flag no command declares.
				absentFlags: ["--chrome", "--port", "--endpoint"],
			});
		}
	});

	test("global diagnostic flags are discovery-visible without becoming command flags", () => {
		const tree = projectBrowserConnectCommandDiscoveryTree();
		for (const command of BROWSER_CONNECT_COMMANDS) {
			for (const flag of GLOBAL_DIAGNOSTIC_FLAGS) {
				expect(Object.keys(browserConnectContracts[command].flags)).not.toContain(
					flag,
				);
				expect(tree.commands[command]?.global_diagnostic_flags).toContain(flag);
			}
		}
	});
});

describe("browser-connect runtime actions (U3 R2 surface)", () => {
	test("failure and success actions carry the declared stable ids", () => {
		expect(browserConnectContractFailureActions.map((action) => action.id)).toEqual([
			...BROWSER_CONNECT_FAILURE_ACTION_IDS,
		]);
		expect(browserConnectContractSuccessActions.map((action) => action.id)).toEqual([
			...BROWSER_CONNECT_SUCCESS_ACTION_IDS,
		]);
		expect(BROWSER_CONNECT_SUCCESS_ACTION_IDS).toContain("use_verified_handoff");
	});

	test("no action carries an executable command template", () => {
		for (const action of [
			...browserConnectContractFailureActions,
			...browserConnectContractSuccessActions,
		]) {
			expect(Object.keys(action).sort()).toEqual([
				"id",
				"sideEffects",
				"summary",
			]);
			expect(action.summary.trim().length).toBeGreaterThan(0);
		}
	});

	test("every command advertises the action affordances in discovery", () => {
		const tree = projectBrowserConnectCommandDiscoveryTree();
		for (const command of BROWSER_CONNECT_COMMANDS) {
			const affordances = tree.commands[command]?.action_affordances;
			expect(affordances?.failure?.map((action) => action.id)).toEqual([
				...BROWSER_CONNECT_FAILURE_ACTION_IDS,
			]);
			expect(affordances?.success?.map((action) => action.id)).toEqual([
				...BROWSER_CONNECT_SUCCESS_ACTION_IDS,
			]);
			for (const group of Object.values(affordances ?? {})) {
				for (const action of group) {
					expect(Object.keys(action).sort()).toEqual([
						"id",
						"side_effects",
						"summary",
					]);
				}
			}
		}
	});
});

describe("browser-connect write preview honesty (U3 R15)", () => {
	test("mutating commands declare browser side effects and a previewExemption naming check", () => {
		for (const command of MUTATING_COMMANDS) {
			const contract = browserConnectContracts[command];
			expect(contract.mutation).toBe("browser");
			expect(contract.sideEffects).toContain("browser");
			expect(contract.previewExemption?.reason).toContain("check");
			expect(contract.executionModes).toEqual(["normal"]);
		}
	});

	test("read surfaces stay check-only with no browser side effects (R15)", () => {
		for (const command of READ_COMMANDS) {
			const contract = browserConnectContracts[command];
			expect(contract.mutation).toBe("check");
			expect(contract.executionModes).toEqual(["check"]);
			expect(contract.sideEffects).not.toContain("browser");
			expect(contract.sideEffects).not.toContain("write");
			expect(contract.previewExemption).toBeUndefined();
		}
		// R15: the dashboard is a plain read; it declares only the read side effect
		// and no network probe.
		expect(browserConnectContracts.dashboard.sideEffects).toEqual(["read"]);
	});

	test("discovery carries the agent-visible preview notes for mutating commands", () => {
		const tree = projectBrowserConnectCommandDiscoveryTree();
		expect(tree.commands.connect?.preview_note).toBe(
			BROWSER_CONNECT_PREVIEW_NOTES.connect,
		);
		expect(tree.commands.run?.preview_note).toBe(
			BROWSER_CONNECT_PREVIEW_NOTES.run,
		);
		expect(tree.commands.run?.preview_note).toContain("check");
		expect(tree.commands.dashboard?.preview_note).toBeUndefined();
		expect(tree.commands.check?.preview_note).toBeUndefined();
	});
});

describe("browser-connect discovery projection (U3 R2)", () => {
	test("exposes all four commands, exit 20 with its meaning, and the result contract id", () => {
		const tree = projectBrowserConnectCommandDiscoveryTree();
		expect(Object.keys(tree.commands).sort()).toEqual([
			"check",
			"connect",
			"dashboard",
			"run",
		]);
		for (const command of BROWSER_CONNECT_COMMANDS) {
			const entry = tree.commands[command];
			expect(entry?.exit_codes["20"]).toBe(browserConnectReadExitCodes["20"]);
			expect(entry?.result_contract).toEqual({
				id: BROWSER_CONNECT_CONTRACT_ID,
				kind: "Browser Adapter verified handoff.",
				schema_version: BROWSER_CONNECT_SCHEMA_VERSION,
			});
			expect(entry?.usage.length).toBeGreaterThan(0);
		}
		expect(tree.commands.run?.exit_codes["127"]).toBe(
			browserConnectRunExitCodes["127"],
		);
		expect(tree.commands.dashboard?.capability_roles).toEqual(["diagnostic"]);
		expect(tree.commands.check?.capability_roles).toEqual(["diagnostic"]);
	});

	test("discovery-tree drift validator returns no findings", () => {
		expect(
			findCommandDiscoveryTreeDrift(
				projectBrowserConnectCommandDiscoveryTree(),
				{ path: CONTRACT_PATH },
			),
		).toEqual([]);
	});

	test("discovery marks compatibility-only action ids on every command (R20)", () => {
		const tree = projectBrowserConnectCommandDiscoveryTree();
		for (const command of BROWSER_CONNECT_COMMANDS) {
			expect(tree.commands[command]?.compatibility_only_action_ids).toEqual([
				...BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS,
			]);
		}
		// The marking never removes the ids from the discoverable affordances.
		for (const actionId of BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS) {
			expect(
				tree.commands.connect?.action_affordances?.failure?.map(
					(action) => action.id,
				),
			).toContain(actionId);
		}
	});

	test("the additive repair action ids are discoverable affordances (R2/R20)", () => {
		const tree = projectBrowserConnectCommandDiscoveryTree();
		const failureIds = tree.commands.connect?.action_affordances?.failure?.map(
			(action) => action.id,
		);
		for (const actionId of [
			"use_suggested_port",
			"upgrade_adapter_to_pin",
			"adjust_adapter_pin",
			"review_adapter_definition",
		]) {
			expect(failureIds).toContain(actionId);
		}
	});
});
