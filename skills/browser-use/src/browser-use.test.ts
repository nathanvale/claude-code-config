import { describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_GENERATION_RESULT_CONTRACT_ID,
	BROWSER_USE_OPERATION_CONTRACT_ID,
	BROWSER_USE_OPERATION_SCHEMA_VERSION,
	BROWSER_USE_DIAGNOSTIC_CODES,
	BROWSER_USE_PRIVATE_INPUT_DIAGNOSTIC_CODES,
	BROWSER_USE_TARGETS_CONTRACT_ID,
	BROWSER_USE_TARGETS_SCHEMA_VERSION,
	type BrowserUseCommand,
	browserUseContracts,
	browserUseGenerationFailureActions,
	browserUseGenerationSuccessActions,
	browserUseOperationFailureActions,
	browserUseOperationSuccessActions,
} from "./command-contract";
import { contractFlags } from "./browser-use-test-helpers";

const ALL_COMMANDS: BrowserUseCommand[] = [
	// Version-matched bundled guidance (agent-first front door, design brief D3).
	"guide-show",
	"targets-list",
	"targets-select",
	"targets-status",
	"operate-snapshot",
	"operate-screenshot",
	"operate-emulate",
	// Platform families (platform plan 2026-07-21-002 U1).
	"task-list",
	// Wave-2 task run front door (release contract R6-R11, R23; flows F1, F7).
	"task-run",
	// Adapter Lane Registry discovery (auth plan 2026-07-21-003 U1).
	"lanes-list",
	"lanes-show",
	"run-status",
	"run-resume",
	"run-cancel",
	"runbook-list",
	// Runbook show/run (platform plan 2026-07-21-002 U4).
	"runbook-show",
	"runbook-run",
	"migration-status",
	"migration-inventory",
	"migration-plan",
	"migration-apply",
	"migration-verify",
	"migration-generate",
	"migration-activate",
	"artifact-list",
	"repair-status",
	"repair-apply",
	// R27 auth repair surface (auth plan 2026-07-21-003 U3a).
	"auth-enroll-browser-automation-token",
	"auth-repair-vault-grant",
	"auth-repair-item-binding",
	"auth-request-binding-selection-grant",
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
	test("contract parses and exposes the targets and operate families", () => {
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

	test("registers every runbook, private-input, and resume diagnostic emitted by the driver", () => {
		for (const code of [
			"runbook_catalog_drift",
			"runbook_inactive",
			"runbook_input_unknown",
			"runbook_input_source_conflict",
			"runbook_input_custody_mismatch",
			...BROWSER_USE_PRIVATE_INPUT_DIAGNOSTIC_CODES,
			"resume_generation_drift",
			"resume_generation_unavailable",
			"resume_binding_invalid",
		] as const) {
			expect(BROWSER_USE_DIAGNOSTIC_CODES).toContain(code);
		}
	});

	test("registers every generation producer refusal and recovery", () => {
		for (const code of [
			"generation_source_invalid",
			"generation_candidate_missing",
			"generation_candidate_invalid",
			"generation_stage_failed",
			"generation_staged_copy_corrupt",
			"generation_closure_invalid",
		] as const) {
			expect(BROWSER_USE_DIAGNOSTIC_CODES).toContain(code);
		}
		expect(browserUseGenerationFailureActions.map((action) => action.id)).toEqual([
			"repair_generation_source",
			"choose_new_generation_id",
			"inspect_generation_store",
		]);
		expect(browserUseGenerationFailureActions.map((action) => action.sideEffects)).toEqual([
			["write"],
			["write"],
			["check"],
		]);
		expect(
			browserUseContracts["migration-generate"].actionAffordances?.success,
		).toEqual(browserUseGenerationSuccessActions);
		expect(
			discoveryTree().commands["migration-generate"]?.action_affordances?.success,
		).toEqual([
			{
				id: "activate_staged_generation",
				summary:
					"Validate and activate the staged generation through browser-use migration activate.",
				side_effects: ["check", "write"],
			},
		]);
	});

	test("runbook discovery declares the input-correction continuation", () => {
		expect(
			browserUseContracts["runbook-run"].actionAffordances?.failure.map(
				(action) => action.id,
			),
		).toContain("change_runbook_input");
	});

	test("subcommands expose only their declared flags", () => {
		expect(contractFlags("targets-status")).toEqual([
			"--json",
			"--plain",
			"--state",
		]);
		expect(contractFlags("operate-screenshot")).toContain("--out");
		expect(contractFlags("operate-emulate")).toContain("--width");
		expect(contractFlags("runbook-run")).toContain("--input-file");
		expect(
			browserUseContracts["runbook-run"].flags?.["--input"]?.description,
		).toContain("sensitive inputs are refused");
		expect(
			browserUseContracts["runbook-run"].flags?.["--input-file"]?.description,
		).toContain("Sensitive private");
		expect(contractFlags("migration-activate")).toEqual([
			"--caller",
			"--generation",
			"--json",
			"--plain",
		]);
		expect(contractFlags("migration-generate")).toEqual([
			"--caller",
			"--json",
			"--plain",
			"--source",
		]);
	});

	// Scenario 5: command discovery exposes both result contracts with versions.
	test("command discovery exposes browser-targets and browser-operation result contracts with versions", () => {
		const tree = discoveryTree();
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
		expect(BROWSER_USE_TARGETS_CONTRACT_ID).toBe("browser-use.browser-targets");
		expect(BROWSER_USE_OPERATION_CONTRACT_ID).toBe("browser-use.browser-operation");
		expect(
			discoveryTree().commands["migration-generate"]?.result_contract?.id,
		).toBe(BROWSER_USE_GENERATION_RESULT_CONTRACT_ID);
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
