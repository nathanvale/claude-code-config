import { describe, expect, test } from "bun:test";
import { projectCommandDiscoveryTree } from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_ARTIFACT_MANIFEST_CONTRACT_ID,
	BROWSER_USE_FAMILIES,
	BROWSER_USE_FAMILY_SUBCOMMANDS,
	BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID,
	BROWSER_USE_REPAIR_STATUS_CONTRACT_ID,
	BROWSER_USE_RUNBOOK_CATALOG_CONTRACT_ID,
	BROWSER_USE_SHARED_RUN_CONTRACT_ID,
	BROWSER_USE_TASK_INTENTS_CONTRACT_ID,
	browserUseContracts,
} from "./command-contract";
import { BROWSER_USE_TASK_INTENTS } from "./browser-use-run-model";
import { renderHelp } from "./browser-use-parser";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

// =========================================================================
// Platform command families (platform plan 2026-07-21-002 U1).
//
// Contract-shell proof for task/run/runbook/migration/artifact/repair: help,
// parser acceptance, JSON parity, the live task-intent projection, and
// caller-metadata neutrality (identical semantics for Claude Code, Codex,
// human shells, and external schedulers; spoofing grants nothing).
// =========================================================================

describe("platform family help and discovery", () => {
	test("root help lists every command family", () => {
		const help = renderHelp();
		for (const family of BROWSER_USE_FAMILIES) {
			expect(help).toContain(`  ${family}`);
		}
		expect(help).toContain(
			"Browser attachment commands accepting --handoff require:",
		);
	});

	test("family help renders every declared subcommand from the contract table", () => {
		for (const family of BROWSER_USE_FAMILIES) {
			const help = renderHelp(family);
			for (const sub of BROWSER_USE_FAMILY_SUBCOMMANDS[family]) {
				expect(help).toContain(sub);
			}
		}
	});

	test("platform families do not point at the handoff prerequisite; targets/operate still do", () => {
		expect(renderHelp("targets")).toContain("Verified Handoff Envelope");
		expect(renderHelp("operate")).toContain("Verified Handoff Envelope");
		for (const family of ["task", "run", "runbook", "migration", "artifact", "repair"] as const) {
			expect(renderHelp(family)).not.toContain("Verified Handoff Envelope");
		}
	});

	test("every family/subcommand pair resolves to one declared contract", () => {
		for (const family of BROWSER_USE_FAMILIES) {
			for (const sub of BROWSER_USE_FAMILY_SUBCOMMANDS[family]) {
				const contract =
					browserUseContracts[
						`${family}-${sub}` as keyof typeof browserUseContracts
					];
				expect(contract).toBeDefined();
				expect(contract.script).toBe("browser-use");
			}
		}
	});

	test("platform discovery exposes each result contract and only supported env vars", () => {
		const tree = projectCommandDiscoveryTree(
			Object.entries(browserUseContracts),
		);
		const expectedContractIds = {
			"task-list": BROWSER_USE_TASK_INTENTS_CONTRACT_ID,
			"run-status": BROWSER_USE_SHARED_RUN_CONTRACT_ID,
			"run-resume": BROWSER_USE_SHARED_RUN_CONTRACT_ID,
			"run-cancel": BROWSER_USE_SHARED_RUN_CONTRACT_ID,
			"runbook-list": BROWSER_USE_RUNBOOK_CATALOG_CONTRACT_ID,
			"migration-status": BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID,
			"artifact-list": BROWSER_USE_ARTIFACT_MANIFEST_CONTRACT_ID,
			"repair-status": BROWSER_USE_REPAIR_STATUS_CONTRACT_ID,
			"repair-apply": BROWSER_USE_REPAIR_STATUS_CONTRACT_ID,
		} as const;
		// Store-backed commands (platform plan U2) additionally declare the XDG
		// env vars the one path owner consumes; the pure/shell commands keep the
		// U1 pair only.
		const PLATFORM_ENV_VARS = ["BROWSER_USE_RUN_ID", "BROWSER_USE_CALLER"];
		const STORE_ENV_VARS = [
			...PLATFORM_ENV_VARS,
			"XDG_CONFIG_HOME",
			"XDG_DATA_HOME",
			"XDG_STATE_HOME",
			"XDG_CACHE_HOME",
			"XDG_RUNTIME_DIR",
		];
		const STORE_BACKED = new Set([
			"run-status",
			"run-resume",
			"run-cancel",
			"artifact-list",
			"repair-status",
			"repair-apply",
		]);
		for (const [command, contractId] of Object.entries(expectedContractIds)) {
			const discovered = tree.commands[command];
			expect(discovered?.result_contract?.id).toBe(contractId);
			expect(discovered?.result_contract?.schema_version).toBe("1");
			expect(discovered?.env_vars?.map((entry) => entry.name)).toEqual(
				STORE_BACKED.has(command) ? STORE_ENV_VARS : PLATFORM_ENV_VARS,
			);
		}
	});
});

describe("task list — live Task Intent projection", () => {
	test("task list --json emits the code-owned catalog with the declared contract identity", async () => {
		const result = await runForTest(["task", "list", "--json"], makeRuntime());
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("ok");
		const data = json.data as Record<string, unknown>;
		expect(data.contract).toBe(BROWSER_USE_TASK_INTENTS_CONTRACT_ID);
		expect(data.schema_version).toBe("1");
		expect(data.task_intent_count).toBe(BROWSER_USE_TASK_INTENTS.length);
		const rows = data.task_intents as Array<Record<string, unknown>>;
		expect(rows.map((row) => row.task_intent)).toEqual([
			...BROWSER_USE_TASK_INTENTS,
		]);
		// Preferred lanes are honest: registered adapters only; intents whose
		// preferred lane is not yet registered carry no preferred_adapter and
		// report lane_registered false (KTD12 typed unavailability).
		for (const row of rows) {
			if (row.preferred_adapter === undefined) {
				expect(row.lane_registered).toBe(false);
			} else {
				expect(row.lane_registered).toBe(true);
			}
		}
	});

	test("task list --plain projects the same rows as JSON", async () => {
		const plain = await runForTest(["task", "list", "--plain"], makeRuntime());
		expect(plain.exitCode).toBe(0);
		const lines = plain.stdout.trim().split("\n");
		expect(lines).toHaveLength(BROWSER_USE_TASK_INTENTS.length + 1);
		expect(lines[0]).toBe(
			`contract=${BROWSER_USE_TASK_INTENTS_CONTRACT_ID} schema=1 caller=none`,
		);
		for (const intent of BROWSER_USE_TASK_INTENTS) {
			expect(plain.stdout).toContain(intent);
		}
		expect(plain.stdout).toContain("registered=true");
		expect(plain.stdout).toContain("registered=false");
	});
});

describe("platform shells fail closed as typed not-implemented", () => {
	// U2 made run status/resume/cancel, artifact list, and repair status live
	// over the XDG store (their scenarios live in browser-use-run-commands
	// .test.ts); only the U3/U4 shells remain not-implemented.
	const SHELL_ARGV: readonly (readonly string[])[] = [
		["runbook", "list", "--json"],
		["migration", "status", "--json"],
	];

	for (const argv of SHELL_ARGV) {
		test(`${argv.slice(0, 2).join(" ")} emits a structured not-implemented result`, async () => {
			const result = await runForTest([...argv], makeRuntime());
			expect(result.exitCode).toBe(1);
			const json = parseJson(result.stdout);
			expect(json.error).toMatchObject({ code: "browser_use_not_implemented" });
			const data = json.data as Record<string, unknown>;
			expect(data.command).toBe(`${argv[0]}-${argv[1]}`);
			expect(JSON.stringify(json.error)).not.toContain("--dry-run");
		});
	}

	test("unknown task subcommand is a usage rejection", async () => {
		const result = await runForTest(["task", "explore", "--json"], makeRuntime());
		expect(result.exitCode).toBe(2);
	});

	test("unknown family is a usage rejection naming the full family list", async () => {
		const result = await runForTest(["quorum", "vote", "--json"], makeRuntime());
		expect(result.exitCode).toBe(2);
		const json = parseJson(result.stdout);
		expect(JSON.stringify(json.error)).toContain("task");
	});

	test("run status defaults to the plain operator projection", async () => {
		// makeRuntime's empty env has no HOME, so the store-backed command
		// refuses at XDG resolution — in plain operator mode the typed failure
		// goes to stderr, never a JSON envelope on stdout (AE4 posture).
		const result = await runForTest(["run", "status"], makeRuntime());
		expect(result.exitCode).toBe(20);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("xdg_root_relative");
		expect(result.stderr).toContain("action=repair_xdg_root");
	});
});

describe("caller metadata is audit-only and never authority (R35)", () => {
	const CALLERS = ["claude-code", "codex", "launchd", undefined] as const;

	// The probe command is `runbook list` (still a U3 shell) so the parity
	// proof stays deterministic without a store; the live store-backed parity
	// case (C ledger: run status against a temp store) lives in
	// browser-use-run-commands.test.ts.
	test("identical requests produce identical semantics across callers", async () => {
		// Pin the run id so the whole envelope is deterministic: after removing
		// the audit echo, every caller must produce a byte-identical result.
		const envelopes: Array<Record<string, unknown>> = [];
		for (const caller of CALLERS) {
			const argv = ["runbook", "list", "--json"];
			if (caller !== undefined) argv.push("--caller", caller);
			const result = await runForTest(
				argv,
				makeRuntime({ env: { BROWSER_USE_RUN_ID: "caller-parity" } }),
			);
			expect(result.exitCode).toBe(1);
			const json = parseJson(result.stdout);
			expect(json.error).toMatchObject({ code: "browser_use_not_implemented" });
			const data = json.data as Record<string, unknown>;
			// The audit echo is the ONLY caller-dependent fact in the envelope.
			expect(data.caller).toEqual({ label: caller ?? null });
			const { caller: _audit, ...semantics } = data;
			const { duration_ms: _duration, ...stableEnvelope } = json;
			envelopes.push({ ...stableEnvelope, data: semantics });
		}
		for (const envelope of envelopes.slice(1)) {
			expect(envelope).toEqual(envelopes[0]);
		}
	});

	test("BROWSER_USE_CALLER env supplies the audit label when the flag is absent", async () => {
		const result = await runForTest(
			["runbook", "list", "--json"],
			makeRuntime({ env: { BROWSER_USE_CALLER: "codex" } }),
		);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.caller).toEqual({ label: "codex" });
	});

	test("--caller wins over the env var", async () => {
		const result = await runForTest(
			["runbook", "list", "--caller", "launchd", "--json"],
			makeRuntime({ env: { BROWSER_USE_CALLER: "codex" } }),
		);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.caller).toEqual({ label: "launchd" });
	});

	test("a spoofed privileged-sounding caller changes nothing on existing surfaces", async () => {
		// targets status does not read caller metadata at all: with the run id
		// pinned, identical output with and without a spoofed caller env proves
		// spoofing grants no authority and changes no schema. duration_ms is
		// dropped before comparing: it derives from the real wall-clock
		// startedAtMs, so a millisecond tick between the two invocations would
		// otherwise flake a test about authority, not timing.
		const spoofed = await runForTest(
			["targets", "status", "--json"],
			makeRuntime({
				env: { BROWSER_USE_CALLER: "operator", BROWSER_USE_RUN_ID: "spoof-run" },
			}),
		);
		const plainRun = await runForTest(
			["targets", "status", "--json"],
			makeRuntime({ env: { BROWSER_USE_RUN_ID: "spoof-run" } }),
		);
		expect(spoofed.exitCode).toBe(plainRun.exitCode);
		const { duration_ms: _spoofedDuration, ...spoofedEnvelope } = parseJson(
			spoofed.stdout,
		);
		const { duration_ms: _plainDuration, ...plainEnvelope } = parseJson(
			plainRun.stdout,
		);
		expect(spoofedEnvelope).toEqual(plainEnvelope);
		expect(spoofed.stderr).toBe(plainRun.stderr);
	});

	test("a caller label passes the redaction gate before it is echoed", async () => {
		const result = await runForTest(
			["runbook", "list", "--caller", "op://vault/item", "--json"],
			makeRuntime(),
		);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(JSON.stringify(data.caller)).not.toContain("op://vault/item");
	});
});

describe("platform families reject undeclared flags", () => {
	test("run resume rejects --dry-run: platform shells have no mock mode", async () => {
		const result = await runForTest(
			["run", "resume", "--run", "run-1", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(2);
	});

	for (const subcommand of ["resume", "cancel"] as const) {
		test(`run ${subcommand} requires an explicit shared run id`, async () => {
			const result = await runForTest(
				["run", subcommand, "--json"],
				makeRuntime(),
			);
			expect(result.exitCode).toBe(2);
			expect(parseJson(result.stdout).error).toMatchObject({
				code: "usage_error",
			});
		});
	}
});
