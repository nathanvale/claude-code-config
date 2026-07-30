import { describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_GENERATION_RESULT_CONTRACT_ID,
	BROWSER_USE_CONTINUATION_CLAIM_RESULTS,
	BROWSER_USE_CONTINUATION_REQUIRED_ACTORS,
	BROWSER_USE_CONTINUATION_STATES,
	BROWSER_USE_OPERATION_CONTRACT_ID,
	BROWSER_USE_OPERATION_SCHEMA_VERSION,
	BROWSER_USE_DIAGNOSTIC_CODES,
	BROWSER_USE_PRIVATE_INPUT_DIAGNOSTIC_CODES,
	BROWSER_USE_TARGETS_CONTRACT_ID,
	BROWSER_USE_TARGETS_SCHEMA_VERSION,
	type BrowserUseCommand,
	type BrowserUseSecretFreeContinuation,
	browserUseContracts,
	browserUseGenerationFailureActions,
	browserUseGenerationSuccessActions,
	browserUseOperationFailureActions,
	browserUseOperationSuccessActions,
	browserUseRunbookAuthFailureActions,
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
	"migration-import",
	"migration-generate",
	"migration-activate",
	"artifact-list",
	"repair-status",
	"repair-apply",
	// Environment-token lifecycle plus R27 auth repair surface.
	"auth-status",
	"auth-record-admin-authority-receipt",
	"auth-install-token",
	"auth-remove-token",
	"auth-enroll-browser-automation-token",
	"auth-repair-vault-grant",
	"auth-repair-item-binding",
	"auth-request-binding-selection-grant",
	"auth-choose-supported-auth-method",
	"auth-inspect-capability-loss",
	"auth-inspect-auth-readiness",
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

	test("registers every admin authority receipt diagnostic emitted by the driver", () => {
		for (const code of [
			"admin_authority_lane_unavailable",
			"admin_authority_metadata_unavailable",
			"admin_authority_vault_scope_invalid",
			"admin_authority_receipt_unavailable",
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

	test("runbook discovery declares every runtime auth-repair continuation", () => {
		const expected = browserUseRunbookAuthFailureActions.map(
			(action) => action.id,
		);
		const declared =
			browserUseContracts["runbook-run"].actionAffordances?.failure.map(
				(action) => action.id,
			) ?? [];
		const discovered =
			discoveryTree().commands["runbook-run"]?.action_affordances?.failure.map(
				(action) => action.id,
			) ?? [];

		expect(declared).toEqual(expect.arrayContaining(expected));
		expect(discovered).toEqual(expect.arrayContaining(expected));
	});

	test("run-bound auth continuations conservatively advertise shared-run writes", () => {
		for (const command of [
			"auth-enroll-browser-automation-token",
			"auth-repair-vault-grant",
			"auth-repair-item-binding",
			"auth-request-binding-selection-grant",
			"auth-choose-supported-auth-method",
			"auth-inspect-capability-loss",
			"auth-inspect-auth-readiness",
		] as const) {
			expect(browserUseContracts[command]).toMatchObject({
				mutation: "write",
				sideEffects: ["check", "write"],
				executionModes: ["normal"],
			});
			expect(discoveryTree().commands[command]).toMatchObject({
				mutation: "write",
				side_effects: ["check", "write"],
			});
		}
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
		expect(contractFlags("auth-status")).toEqual([
			"--caller",
			"--json",
			"--plain",
		]);
		expect(contractFlags("auth-install-token")).toEqual([
			"--caller",
			"--json",
			"--plain",
			"--stdin",
		]);
		expect(contractFlags("auth-remove-token")).toEqual([
			"--caller",
			"--json",
			"--plain",
		]);
	});

	test("token lifecycle discovery exposes the accepted input channel and human gate", () => {
		const tree = discoveryTree();
		expect(tree.commands["auth-install-token"]).toMatchObject({
			interactivity: "optional",
			result_contract: {
				id: "browser-use.environment-token-lifecycle",
				schema_version: "1",
			},
		});
		expect(tree.commands["auth-install-token"]?.flags["--stdin"]).toMatchObject({
			type: "boolean",
		});
		expect(tree.commands["auth-status"]?.interactivity).toBe("none");
		expect(tree.commands["auth-remove-token"]?.interactivity).toBe("none");
	});

	test("R16 continuation schema and stable claim exits stay code-owned", () => {
			const fixture = {
				schema_version: "1",
				kind: "auth",
				continuation_id: "continuation-1",
				run_id: "run-1",
			state: "pending",
			reason: "user-presence-required",
			required_actor: "human",
			safe_to_retry: false,
			checkpoint: "before-auth-submit",
			expires_at_epoch_ms: 2_000,
				resume_action: {
					command: "run",
					args: ["resume", "--run", "run-1", "--json"],
				},
				bindings: {
					generation_id: "generation-1",
					activation_epoch: 3,
					route_digest: "e".repeat(64),
					lane_id: "daily-work",
					adapter_id: "agent-browser",
					handoff_evidence_id: "handoff-1",
					target_binding_id: "target-1",
					environment: "agent-chrome",
					profile: "default",
					expected_identity: {
						subject_ref: "subject-oncore-primary",
						account_ref: "account-oncore-primary",
						tenant_ref: "tenant-monash",
					},
				},
				next_action_id: "resume-auth-continuation",
				summary: "Claim and re-prove this auth continuation before resuming.",
			} as const satisfies BrowserUseSecretFreeContinuation;
		expect(fixture.required_actor).toBe("human");
		expect(BROWSER_USE_CONTINUATION_REQUIRED_ACTORS).toEqual(["agent", "human"]);
		expect(BROWSER_USE_CONTINUATION_STATES).toEqual([
			"pending",
			"claimed",
			"in-progress",
			"completed",
			"expired",
			"invalidated",
		]);
		expect(BROWSER_USE_CONTINUATION_CLAIM_RESULTS).toEqual([
			"claimed",
			"already-claimed",
				"in-progress",
				"terminal",
				"mismatch",
			]);
		expect(browserUseContracts["run-resume"].exitCodes).toMatchObject({
			"21": expect.stringContaining("human"),
			"22": expect.stringContaining("claimed"),
		});
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
