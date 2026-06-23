import { describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_OPERATION_CONTRACT_ID,
	BROWSER_USE_OPERATION_SCHEMA_VERSION,
	BROWSER_USE_TARGETS_CONTRACT_ID,
	BROWSER_USE_TARGETS_SCHEMA_VERSION,
	BROWSER_USE_WARM_START_CONTRACT_ID,
	BROWSER_USE_WARM_START_SCHEMA_VERSION,
	type BrowserUseCommand,
	browserUseContracts,
	browserUseOperationFailureActions,
	browserUseOperationSuccessActions,
	browserUseWarmStartFailureActions,
	browserUseWarmStartSuccessActions,
} from "./command-contract";
import { contractFlags } from "./browser-use-test-helpers";

const ALL_COMMANDS: BrowserUseCommand[] = [
	"warm-start",
	"targets-list",
	"targets-select",
	"targets-status",
	"operate-snapshot",
	"operate-screenshot",
	"operate-emulate",
];

function discoveryTree() {
	return projectCommandDiscoveryTree(
		Object.entries(browserUseContracts) as Array<
			[BrowserUseCommand, (typeof browserUseContracts)[BrowserUseCommand]]
		>,
	);
}

// =========================================================================
// Command contract / discovery
// =========================================================================

describe("U3 command contract", () => {
	test("contract parses and exposes the warm, targets, and operate families", () => {
		const result = parseCommandFacadeContract(browserUseContracts, {
			path: "skills/browser-use/src/command-contract.ts",
		});
		expect(result.ok).toBe(true);
		expect(Object.keys(browserUseContracts).sort()).toEqual([...ALL_COMMANDS].sort());
	});

	test("no command declares a facade-reserved diagnostic flag", () => {
		for (const command of ALL_COMMANDS) {
			const flags = Object.keys(browserUseContracts[command].flags ?? {});
			for (const reserved of CLI_DIAGNOSTIC_FLAGS) {
				expect(flags).not.toContain(reserved);
			}
		}
	});

	test("subcommands expose only their declared flags", () => {
		expect(contractFlags("warm-start")).toEqual([
			"--adapter",
			"--endpoint",
			"--json",
			"--plain",
			"--port",
			"--profile",
			"--repair-adapter-config",
		]);
		expect(contractFlags("targets-status")).toEqual([
			"--json",
			"--plain",
			"--state",
		]);
		expect(contractFlags("operate-screenshot")).toContain("--out");
		expect(contractFlags("operate-emulate")).toContain("--width");
	});

	// Scenario 5: command discovery exposes both result contracts with versions.
	test("command discovery exposes warm-start, browser-targets, and browser-operation result contracts with versions", () => {
		const tree = discoveryTree();
		expect(tree.commands["warm-start"]?.result_contract).toMatchObject({
			id: BROWSER_USE_WARM_START_CONTRACT_ID,
			schema_version: BROWSER_USE_WARM_START_SCHEMA_VERSION,
		});
		for (const command of ["targets-list", "targets-select", "targets-status"] as const) {
			expect(tree.commands[command]?.result_contract).toMatchObject({
				id: BROWSER_USE_TARGETS_CONTRACT_ID,
				schema_version: BROWSER_USE_TARGETS_SCHEMA_VERSION,
			});
		}
		for (const command of ["operate-snapshot", "operate-screenshot", "operate-emulate"] as const) {
			expect(tree.commands[command]?.result_contract).toMatchObject({
				id: BROWSER_USE_OPERATION_CONTRACT_ID,
				schema_version: BROWSER_USE_OPERATION_SCHEMA_VERSION,
			});
		}
		expect(BROWSER_USE_WARM_START_CONTRACT_ID).toBe("browser-use.warm-start");
		expect(BROWSER_USE_TARGETS_CONTRACT_ID).toBe("browser-use.browser-targets");
		expect(BROWSER_USE_OPERATION_CONTRACT_ID).toBe("browser-use.browser-operation");
	});

	test("warm start command discovery exposes runtime action affordances", () => {
		const tree = discoveryTree();
		const affordances = tree.commands["warm-start"]?.action_affordances;
		expect(affordances?.success?.map((a) => a.id)).toEqual(
			browserUseWarmStartSuccessActions.map((a) => a.id),
		);
		expect(affordances?.failure?.map((a) => a.id)).toEqual(
			browserUseWarmStartFailureActions.map((a) => a.id),
		);
	});

	test("operate command discovery exposes runtime action affordances", () => {
		const tree = discoveryTree();
		for (const command of ["operate-snapshot", "operate-screenshot", "operate-emulate"] as const) {
			const affordances = tree.commands[command]?.action_affordances;
			expect(affordances?.success?.map((a) => a.id)).toEqual(
				browserUseOperationSuccessActions.map((a) => a.id),
			);
			expect(affordances?.failure?.map((a) => a.id)).toEqual(
				browserUseOperationFailureActions.map((a) => a.id),
			);
		}
	});
});
