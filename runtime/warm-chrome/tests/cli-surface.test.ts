import { describe, expect, test } from "bun:test";
import {
	findCommandDiscoveryTreeDrift,
	findCommandFacadeMetadataDrift,
	renderCommandUsage,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";

import {
	WARM_CHROME_BROWSER_ENTRY_EXIT_CODE,
	WARM_CHROME_CLI_NAME,
	WARM_CHROME_COMMANDS,
	WARM_CHROME_CONTRACT_ID,
	WARM_CHROME_FAILURE_ACTION_IDS,
	WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID,
	WARM_CHROME_SCHEMA_VERSION,
	WARM_CHROME_DEFAULT_CDP_PORT,
	WARM_CHROME_SUCCESS_ACTION_IDS,
} from "../src/model.ts";
import { WARM_CHROME_SUGGESTED_PORT_WINDOW } from "../src/proof.ts";
import {
	projectWarmChromeCommandDiscoveryTree,
	WARM_CHROME_GLOBAL_DIAGNOSTIC_FLAGS,
	WARM_CHROME_PREVIEW_NOTES,
	warmChromeContractEntries,
	warmChromeContracts,
	warmChromeExitCodes,
	warmChromeFailureActions,
	warmChromeSuccessActions,
} from "../src/command-contract.ts";

const CONTRACT_PATH = "runtime/warm-chrome/src/command-contract.ts";
const MUTATING_COMMANDS = ["launch", "repair"] as const;
const GLOBAL_DIAGNOSTIC_FLAGS = WARM_CHROME_GLOBAL_DIAGNOSTIC_FLAGS;

describe("warm-chrome command contract (U2 R2/R3)", () => {
	test("declares exactly the four public commands on the warm-chrome script", () => {
		expect(Object.keys(warmChromeContracts).sort()).toEqual(
			[...WARM_CHROME_COMMANDS].sort(),
		);
		expect([...WARM_CHROME_COMMANDS].sort()).toEqual([
			"check",
			"launch",
			"repair",
			"status",
		]);
		for (const command of WARM_CHROME_COMMANDS) {
			expect(warmChromeContracts[command].script).toBe(WARM_CHROME_CLI_NAME);
		}
		expect(warmChromeContractEntries.map(([command]) => command)).toEqual([
			...WARM_CHROME_COMMANDS,
		]);
	});

	test("check is the agent proof surface with JSON default; status is the operator presentation", () => {
		expect(warmChromeContracts.check.audience).toBe("agent");
		expect(warmChromeContracts.check.json).toBe(true);
		expect(warmChromeContracts.check.outputModes).toEqual(["json", "plain"]);
		expect(warmChromeContracts.status.audience).toBe("operator");
	});

	test("status resolves as a presentation alias of check with plain default", () => {
		expect(warmChromeContracts.status.alias).toEqual({
			command: "check",
			defaultArgs: ["--plain"],
		});
		const tree = projectWarmChromeCommandDiscoveryTree();
		expect(tree.commands.status?.alias_of).toBe("check");
		expect(tree.commands.status?.default_args).toEqual(["--plain"]);
	});

	test("every command declares baseline 0/1/2 plus package-owned 20 (R3)", () => {
		for (const command of WARM_CHROME_COMMANDS) {
			expect(
				Object.keys(warmChromeContracts[command].exitCodes).sort(
					(a, b) => Number(a) - Number(b),
				),
			).toEqual(["0", "1", "2", "20"]);
		}
		expect(WARM_CHROME_BROWSER_ENTRY_EXIT_CODE).toBe("20");
		// Exit-20 meaning is agent-visible and carries the no-adapter-fallback
		// continuation meaning the R12 envelopes (U4+) will enforce.
		expect(warmChromeExitCodes["20"]).toContain("Browser entry");
		expect(warmChromeExitCodes["20"].toLowerCase()).toContain(
			"no adapter fallback",
		);
		expect(WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID).toBe(
			"no_adapter_fallback",
		);
	});

	test("facade metadata drift validators return no findings", () => {
		expect(
			findCommandFacadeMetadataDrift(warmChromeContracts, {
				path: CONTRACT_PATH,
				writeImplyingMutations: new Set(["write", "browser"]),
			}),
		).toEqual([]);
	});

	test("port and endpoint are declared mutually exclusive in every usage line", () => {
		for (const command of WARM_CHROME_COMMANDS) {
			const usage = warmChromeContracts[command].usage.join("\n");
			expect(usage).toContain("[--port <port> | --endpoint <endpoint>]");
		}
	});

	// The 9222 DevTools convention is the most collision-prone port on a dev
	// machine, so defaulting to it makes the agent path refuse foreign_listener
	// whenever anything else (a real Chrome, Chrome for Testing, a stale session)
	// holds it. The default must live in the dedicated agent suggested-port
	// window and never be 9222; explicit --port 9222 stays available.
	test("the default CDP port is off the 9222 convention and inside the agent window", () => {
		expect(WARM_CHROME_DEFAULT_CDP_PORT).not.toBe("9222");
		const port = Number(WARM_CHROME_DEFAULT_CDP_PORT);
		expect(Number.isInteger(port)).toBe(true);
		expect(port).toBeGreaterThanOrEqual(WARM_CHROME_SUGGESTED_PORT_WINDOW.start);
		expect(port).toBeLessThanOrEqual(WARM_CHROME_SUGGESTED_PORT_WINDOW.end);
	});
});

describe("warm-chrome help flag surface (U2)", () => {
	test("every advertised flag appears in rendered help; --chrome stays launch-only", () => {
		for (const command of WARM_CHROME_COMMANDS) {
			const contract = warmChromeContracts[command];
			assertCommandHelpFlagSurface({
				command,
				contract,
				help: renderCommandUsage(contract),
				...(command === "launch" ? {} : { absentFlags: ["--chrome"] }),
			});
		}
	});

	test("global diagnostic flags are discovery-visible without becoming command flags", () => {
		const tree = projectWarmChromeCommandDiscoveryTree();
		for (const command of WARM_CHROME_COMMANDS) {
			for (const flag of GLOBAL_DIAGNOSTIC_FLAGS) {
				expect(Object.keys(warmChromeContracts[command].flags)).not.toContain(
					flag,
				);
				expect(tree.commands[command]?.global_diagnostic_flags).toContain(flag);
			}
		}
	});

	test("mutating profile flag descriptions disclose filesystem writes", () => {
		expect(warmChromeContracts.check.flags["--profile"]?.description).toContain(
			"verifies only",
		);
		expect(warmChromeContracts.launch.flags["--profile"]?.description).toContain(
			"create and chmod",
		);
		expect(warmChromeContracts.repair.flags["--profile"]?.description).toContain(
			"rewrite local profile",
		);
		const chromeFlag = Object.entries(warmChromeContracts.launch.flags).find(
			([flag]) => flag === "--chrome",
		)?.[1];
		expect(chromeFlag?.description).toContain(
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		);
		expect(warmChromeContracts.check.flags["--endpoint"]?.description).toContain(
			"Numeric loopback",
		);
	});

	test("check cannot accept launch-only input", () => {
		expect(Object.keys(warmChromeContracts.check.flags)).not.toContain(
			"--chrome",
		);
		expect(Object.keys(warmChromeContracts.status.flags)).not.toContain(
			"--chrome",
		);
		expect(Object.keys(warmChromeContracts.repair.flags)).not.toContain(
			"--chrome",
		);
		expect(Object.keys(warmChromeContracts.launch.flags)).toContain("--chrome");
	});
});

describe("warm-chrome runtime actions (U2 R12 surface)", () => {
	test("failure and success actions carry the declared stable ids", () => {
		expect(warmChromeFailureActions.map((action) => action.id)).toEqual([
			...WARM_CHROME_FAILURE_ACTION_IDS,
		]);
		expect(warmChromeSuccessActions.map((action) => action.id)).toEqual([
			...WARM_CHROME_SUCCESS_ACTION_IDS,
		]);
		expect(WARM_CHROME_FAILURE_ACTION_IDS).toContain("rerun_with_explicit_port");
		expect(WARM_CHROME_SUCCESS_ACTION_IDS).toContain("use_verified_endpoint");
	});

	test("no action carries an executable command template", () => {
		for (const action of [
			...warmChromeFailureActions,
			...warmChromeSuccessActions,
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
		const tree = projectWarmChromeCommandDiscoveryTree();
		for (const command of WARM_CHROME_COMMANDS) {
			const affordances = tree.commands[command]?.action_affordances;
			expect(affordances?.failure?.map((action) => action.id)).toEqual([
				...WARM_CHROME_FAILURE_ACTION_IDS,
			]);
			expect(affordances?.success?.map((action) => action.id)).toEqual([
				...WARM_CHROME_SUCCESS_ACTION_IDS,
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

describe("warm-chrome write preview honesty (U2)", () => {
	test("mutating commands declare write side effects and a previewExemption naming check", () => {
		for (const command of MUTATING_COMMANDS) {
			const contract = warmChromeContracts[command];
			expect(contract.sideEffects).toContain("write");
			expect(contract.previewExemption?.reason).toContain("check");
			// The facade write-preview cross-check is per-command: launch/repair
			// must not advertise a phantom check/dry_run execution mode.
			expect(contract.executionModes).toEqual(["normal"]);
		}
		expect(warmChromeContracts.launch.sideEffects).toContain("browser");
		expect(warmChromeContracts.launch.mutation).toBe("browser");
		expect(warmChromeContracts.repair.mutation).toBe("write");
	});

	test("read surfaces stay check-only with no write side effects", () => {
		for (const command of ["check", "status"] as const) {
			const contract = warmChromeContracts[command];
			expect(contract.executionModes).toEqual(["check"]);
			expect(contract.sideEffects).not.toContain("write");
			expect(contract.sideEffects).not.toContain("browser");
			expect(contract.previewExemption).toBeUndefined();
		}
	});

	test("discovery carries the agent-visible note that launch-input validation is not previewable", () => {
		const tree = projectWarmChromeCommandDiscoveryTree();
		expect(tree.commands.launch?.preview_note).toBe(
			WARM_CHROME_PREVIEW_NOTES.launch,
		);
		expect(tree.commands.repair?.preview_note).toBe(
			WARM_CHROME_PREVIEW_NOTES.repair,
		);
		expect(tree.commands.launch?.preview_note).toContain("--chrome");
		expect(tree.commands.launch?.preview_note).toContain(
			"cannot be previewed",
		);
		expect(tree.commands.launch?.preview_note).toContain("check");
		expect(tree.commands.repair?.preview_note).toContain("check");
		expect(tree.commands.check?.preview_note).toBeUndefined();
		expect(tree.commands.status?.preview_note).toBeUndefined();
	});
});

describe("warm-chrome discovery projection (U2 R14)", () => {
	test("exposes all four commands, exit 20 with its meaning, capability_roles, and the result contract id", () => {
		const tree = projectWarmChromeCommandDiscoveryTree();
		expect(Object.keys(tree.commands).sort()).toEqual([
			"check",
			"launch",
			"repair",
			"status",
		]);
		for (const command of WARM_CHROME_COMMANDS) {
			const entry = tree.commands[command];
			expect(entry?.exit_codes["20"]).toBe(warmChromeExitCodes["20"]);
			expect(entry?.result_contract).toEqual({
				id: WARM_CHROME_CONTRACT_ID,
				kind: "Warm Chrome browser-entry proof.",
				schema_version: WARM_CHROME_SCHEMA_VERSION,
			});
			expect(entry?.usage.length).toBeGreaterThan(0);
		}
		expect(tree.commands.check?.capability_roles).toEqual(["diagnostic"]);
		expect(tree.commands.status?.capability_roles).toEqual(["diagnostic"]);
	});

	test("discovery-tree drift validator returns no findings", () => {
		expect(
			findCommandDiscoveryTreeDrift(projectWarmChromeCommandDiscoveryTree(), {
				path: CONTRACT_PATH,
			}),
		).toEqual([]);
	});
});
