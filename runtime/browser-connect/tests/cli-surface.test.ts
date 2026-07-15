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
	BROWSER_CONNECT_REPAIR_CHAIN_HOP_VALUES,
	type BrowserConnectCommand,
	browserConnectContractEntries,
	browserConnectContracts,
	browserConnectContractFailureActions,
	browserConnectContractSuccessActions,
	browserConnectReadExitCodes,
	browserConnectRepairAdapterExitCodes,
	browserConnectRunExitCodes,
	extractBrowserConnectGatewayOptions,
	projectBrowserConnectCommandDiscoveryTree,
} from "../src/command-contract.ts";

const CONTRACT_PATH = "runtime/browser-connect/src/command-contract.ts";
const MUTATING_COMMANDS = ["connect", "run"] as const;
const READ_COMMANDS = ["dashboard", "check"] as const;
const GLOBAL_DIAGNOSTIC_FLAGS = BROWSER_CONNECT_GLOBAL_DIAGNOSTIC_FLAGS;

describe("browser-connect command contract (U3 R2/R7/R15/R17)", () => {
	test("declares exactly the five public commands on the browser-connect script", () => {
		expect(Object.keys(browserConnectContracts).sort()).toEqual(
			[...BROWSER_CONNECT_COMMANDS].sort(),
		);
		expect([...BROWSER_CONNECT_COMMANDS].sort()).toEqual([
			"check",
			"connect",
			"dashboard",
			"repair-adapter",
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

	test("dashboard is the operator read-only surface; the rest are agent surfaces", () => {
		expect(browserConnectContracts.dashboard.audience).toBe("operator");
		expect(browserConnectContracts.dashboard.mutation).toBe("check");
		expect(browserConnectContracts.dashboard.sideEffects).toEqual(["read"]);
		expect(browserConnectContracts.check.audience).toBe("agent");
		expect(browserConnectContracts.connect.audience).toBe("agent");
		expect(browserConnectContracts.run.audience).toBe("agent");
		expect(browserConnectContracts["repair-adapter"].audience).toBe("agent");
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
				writeImplyingMutations: new Set(["browser", "package"]),
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
		// The gateway options belong to check/connect/run only (R15); the
		// dashboard is a pure registry read and must not leak them. --chrome and
		// --endpoint stay foreign everywhere (warm-chrome-owned inputs).
		const absentFlagProbes: Record<BrowserConnectCommand, readonly string[]> = {
			dashboard: ["--chrome", "--endpoint", "--port", "--repair-chain-hop"],
			check: ["--chrome", "--endpoint"],
			connect: ["--chrome", "--endpoint"],
			run: ["--chrome", "--endpoint"],
			// repair-adapter accepts NO gateway options and NO package-policy
			// override flags (R33): only --check/--execute/--json are declared.
			"repair-adapter": [
				"--chrome",
				"--endpoint",
				"--port",
				"--repair-chain-hop",
				"--package",
				"--pin",
				"--registry",
				"--lockfile",
				"--recipe",
				"--path",
				"--scope",
			],
		};
		for (const command of BROWSER_CONNECT_COMMANDS) {
			const contract = browserConnectContracts[command];
			assertCommandHelpFlagSurface({
				command,
				contract,
				help: renderCommandUsage(contract),
				absentFlags: absentFlagProbes[command],
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
	test("exposes all five commands, exit 20 with its meaning, and the result contract id", () => {
		const tree = projectBrowserConnectCommandDiscoveryTree();
		expect(Object.keys(tree.commands).sort()).toEqual([
			"check",
			"connect",
			"dashboard",
			"repair-adapter",
			"run",
		]);
		for (const command of BROWSER_CONNECT_COMMANDS) {
			const entry = tree.commands[command];
			// repair-adapter owns its own exit-20 meaning (fail-closed repair stop);
			// every other command shares the connection-entry meaning.
			if (command === "repair-adapter") {
				expect(entry?.exit_codes["20"]).toBe(
					browserConnectRepairAdapterExitCodes["20"],
				);
			} else {
				expect(entry?.exit_codes["20"]).toBe(browserConnectReadExitCodes["20"]);
			}
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

// ---------------------------------------------------------------------------
// U3 explicit-port option surface (R15/KTD7): one contract owner supplies the
// flag declarations, discovery metadata, rendered help, and validation for
// --port and --repair-chain-hop on check, connect, and run.
// ---------------------------------------------------------------------------

const GATEWAY_OPTION_COMMANDS = ["check", "connect", "run"] as const;

describe("browser-connect explicit-port option contract (U3 R15/KTD7)", () => {
	test("check, connect, and run declare --port and --repair-chain-hop; dashboard declares neither", () => {
		for (const command of GATEWAY_OPTION_COMMANDS) {
			const flags = browserConnectContracts[command].flags;
			expect(Object.keys(flags)).toContain("--port");
			expect(Object.keys(flags)).toContain("--repair-chain-hop");
		}
		expect(Object.keys(browserConnectContracts.dashboard.flags)).not.toContain(
			"--port",
		);
		expect(
			Object.keys(browserConnectContracts.dashboard.flags),
		).not.toContain("--repair-chain-hop");
	});

	test("--port names its validation range; --repair-chain-hop declares the closed 0|1 value set", () => {
		for (const command of GATEWAY_OPTION_COMMANDS) {
			const flags = browserConnectContracts[command].flags;
			const port = flags["--port"];
			expect(port?.type).toBe("string");
			expect(port?.description).toContain("1");
			expect(port?.description).toContain("65535");
			const hop = flags["--repair-chain-hop"];
			expect(hop?.type).toBe("enum");
			if (hop?.type !== "enum") throw new Error("unreachable");
			expect(hop.values).toEqual([...BROWSER_CONNECT_REPAIR_CHAIN_HOP_VALUES]);
			expect(hop.description).toContain("0");
		}
		expect(BROWSER_CONNECT_REPAIR_CHAIN_HOP_VALUES).toEqual(["0", "1"]);
	});

	test("the three commands share ONE option meaning: identical descriptors, no per-command drift", () => {
		const reference = browserConnectContracts.check.flags as Record<
			string,
			unknown
		>;
		for (const command of GATEWAY_OPTION_COMMANDS) {
			const flags = browserConnectContracts[command].flags as Record<
				string,
				unknown
			>;
			expect(flags["--port"]).toEqual(reference["--port"]);
			expect(flags["--repair-chain-hop"]).toEqual(reference["--repair-chain-hop"]);
		}
	});

	test("usage lines expose both options on all three commands", () => {
		for (const command of GATEWAY_OPTION_COMMANDS) {
			const usage = browserConnectContracts[command].usage.join("\n");
			expect(usage).toContain("--port <port>");
			expect(usage).toContain("--repair-chain-hop <0|1>");
		}
	});

	test("rendered help exposes both options with their meaning", () => {
		for (const command of GATEWAY_OPTION_COMMANDS) {
			const help = renderCommandUsage(browserConnectContracts[command]);
			expect(help).toContain("--port");
			expect(help).toContain("65535");
			expect(help).toContain("--repair-chain-hop");
		}
		expect(renderCommandUsage(browserConnectContracts.dashboard)).not.toContain(
			"--port",
		);
	});

	test("discovery metadata exposes both options and their validation (R15)", () => {
		const tree = projectBrowserConnectCommandDiscoveryTree();
		for (const command of GATEWAY_OPTION_COMMANDS) {
			const flags = tree.commands[command]?.flags as Record<
				string,
				{ type: string; description?: string; values?: readonly string[] }
			>;
			expect(flags["--port"]?.type).toBe("string");
			expect(flags["--port"]?.description).toContain("65535");
			expect(flags["--repair-chain-hop"]?.type).toBe("enum");
			expect(flags["--repair-chain-hop"]?.values).toEqual([
				...BROWSER_CONNECT_REPAIR_CHAIN_HOP_VALUES,
			]);
		}
		const dashboardFlags = tree.commands.dashboard?.flags as Record<
			string,
			unknown
		>;
		expect(dashboardFlags["--port"]).toBeUndefined();
		expect(dashboardFlags["--repair-chain-hop"]).toBeUndefined();
	});
});

describe("browser-connect gateway option parsing (U3 R15: validate once, one owner)", () => {
	test("accepts a valid port and defaults the hop to 0", () => {
		const { options, rest } = extractBrowserConnectGatewayOptions([
			"--port",
			"9333",
			"--json",
		]);
		expect(options.port).toBe(9333);
		expect(options.repairChainHop).toBe(0);
		expect(rest).toEqual(["--json"]);
	});

	test("accepts inline = forms and preserves surrounding argv order", () => {
		const { options, rest } = extractBrowserConnectGatewayOptions([
			"agent-browser",
			"--port=9333",
			"--repair-chain-hop=1",
			"--json",
		]);
		expect(options.port).toBe(9333);
		expect(options.repairChainHop).toBe(1);
		expect(rest).toEqual(["agent-browser", "--json"]);
	});

	test("accepts exactly the declared hop values and the port bounds", () => {
		for (const hop of BROWSER_CONNECT_REPAIR_CHAIN_HOP_VALUES) {
			const { options } = extractBrowserConnectGatewayOptions([
				"--repair-chain-hop",
				hop,
			]);
			expect(String(options.repairChainHop)).toBe(hop);
		}
		expect(extractBrowserConnectGatewayOptions(["--port", "1"]).options.port).toBe(1);
		expect(
			extractBrowserConnectGatewayOptions(["--port", "65535"]).options.port,
		).toBe(65535);
	});

	test("no options: port stays absent, hop defaults to 0, argv passes through", () => {
		const { options, rest } = extractBrowserConnectGatewayOptions([
			"agent-browser",
			"--json",
		]);
		expect(options.port).toBeUndefined();
		expect(options.repairChainHop).toBe(0);
		expect(rest).toEqual(["agent-browser", "--json"]);
	});

	test("rejects invalid ports with one consistent message per cause", () => {
		expect(() => extractBrowserConnectGatewayOptions(["--port", "abc"])).toThrow(
			"--port must be numeric",
		);
		expect(() => extractBrowserConnectGatewayOptions(["--port", "1.5"])).toThrow(
			"--port must be numeric",
		);
		expect(() => extractBrowserConnectGatewayOptions(["--port", "-1"])).toThrow(
			"--port must be numeric",
		);
		expect(() => extractBrowserConnectGatewayOptions(["--port", "0"])).toThrow(
			"--port must be between 1 and 65535",
		);
		expect(() =>
			extractBrowserConnectGatewayOptions(["--port", "65536"]),
		).toThrow("--port must be between 1 and 65535");
		expect(() => extractBrowserConnectGatewayOptions(["--port="])).toThrow(
			"--port requires a value",
		);
		expect(() => extractBrowserConnectGatewayOptions(["--port"])).toThrow(
			"--port requires a value",
		);
	});

	test("rejects invalid hop values against the declared value set", () => {
		expect(() =>
			extractBrowserConnectGatewayOptions(["--repair-chain-hop", "2"]),
		).toThrow("--repair-chain-hop must be 0 or 1");
		expect(() =>
			extractBrowserConnectGatewayOptions(["--repair-chain-hop", "01"]),
		).toThrow("--repair-chain-hop must be 0 or 1");
		expect(() =>
			extractBrowserConnectGatewayOptions(["--repair-chain-hop", "one"]),
		).toThrow("--repair-chain-hop must be 0 or 1");
		expect(() =>
			extractBrowserConnectGatewayOptions(["--repair-chain-hop"]),
		).toThrow("--repair-chain-hop requires a value");
	});

	test("rejects duplicate options across both spellings (validate once)", () => {
		expect(() =>
			extractBrowserConnectGatewayOptions(["--port", "1", "--port", "2"]),
		).toThrow("duplicate option: --port");
		expect(() =>
			extractBrowserConnectGatewayOptions(["--port=1", "--port", "2"]),
		).toThrow("duplicate option: --port");
		expect(() =>
			extractBrowserConnectGatewayOptions([
				"--repair-chain-hop",
				"0",
				"--repair-chain-hop=1",
			]),
		).toThrow("duplicate option: --repair-chain-hop");
	});
});

// ---------------------------------------------------------------------------
// U5 repair-adapter command surface (R33/KTD22): discovery metadata, rendered
// help, and the parser expose the same mutually exclusive --check/--execute
// modes; no package-policy override is declared anywhere.
// ---------------------------------------------------------------------------

describe("browser-connect repair-adapter contract surface (U5 R33/KTD22)", () => {
	const contract = browserConnectContracts["repair-adapter"];

	test("declares the package mutation class with an agent audience and a check preview mode", () => {
		expect(contract.mutation).toBe("package");
		expect(contract.audience).toBe("agent");
		// --check is a first-class preview execution mode (KTD9/KTD22): the
		// write-preview capability is a real mode, not an exemption.
		expect(contract.executionModes).toEqual(["check", "normal"]);
		expect(contract.previewExemption).toBeUndefined();
		expect(contract.sideEffects).toEqual(["check", "network", "write"]);
		expect(contract.interactivity).toBe("none");
	});

	test("declares exactly the mutually exclusive modes plus --json; nothing else", () => {
		expect(Object.keys(contract.flags).sort()).toEqual([
			"--check",
			"--execute",
			"--json",
		]);
		const check = contract.flags["--check"];
		const execute = contract.flags["--execute"];
		expect(check?.type).toBe("boolean");
		expect(execute?.type).toBe("boolean");
		expect(check?.description).toContain("--execute");
		expect(execute?.description).toContain("--check");
		expect(check?.description?.toLowerCase()).toContain("read-only");
		expect(execute?.description?.toLowerCase()).toContain("mutation");
	});

	test("usage names the adapter operand and both modes", () => {
		const usage = contract.usage.join("\n");
		expect(usage).toContain("<adapter>");
		expect(usage).toContain("--check");
		expect(usage).toContain("--execute");
	});

	test("rendered help exposes both modes with their meaning", () => {
		const help = renderCommandUsage(contract);
		expect(help).toContain("--check");
		expect(help).toContain("--execute");
		expect(help).toContain("--json");
	});

	test("exit codes: baseline plus the fail-closed repair stop at 20", () => {
		expect(Object.keys(contract.exitCodes).sort((a, b) => Number(a) - Number(b))).toEqual([
			"0",
			"1",
			"2",
			"20",
		]);
		expect(browserConnectRepairAdapterExitCodes["20"].toLowerCase()).toContain(
			"operator",
		);
	});

	test("discovery projects the repair-adapter preview note", () => {
		const tree = projectBrowserConnectCommandDiscoveryTree();
		expect(tree.commands["repair-adapter"]?.preview_note).toBe(
			BROWSER_CONNECT_PREVIEW_NOTES["repair-adapter"],
		);
		expect(tree.commands["repair-adapter"]?.preview_note).toContain("--check");
	});
});
