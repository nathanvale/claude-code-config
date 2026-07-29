import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { projectCommandDiscoveryTree } from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_ADAPTER_LANES_CONTRACT_ID,
	BROWSER_USE_ARTIFACT_MANIFEST_CONTRACT_ID,
	BROWSER_USE_AUTH_READINESS_CONTRACT_ID,
	BROWSER_USE_FAMILIES,
	BROWSER_USE_FAMILY_SUBCOMMANDS,
	BROWSER_USE_GENERATION_RESULT_CONTRACT_ID,
	BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID,
	BROWSER_USE_REPAIR_STATUS_CONTRACT_ID,
	BROWSER_USE_RUNBOOK_CATALOG_CONTRACT_ID,
	BROWSER_USE_RUNBOOK_DEFINITION_CONTRACT_ID,
	BROWSER_USE_SHARED_RUN_CONTRACT_ID,
	BROWSER_USE_TASK_INTENTS_CONTRACT_ID,
	browserUseContracts,
	browserUseGenerationFailureActions,
	browserUseMigrationFailureActions,
} from "./command-contract";
import { BROWSER_USE_TASK_INTENTS } from "./browser-use-run-model";
import type { BrowserUseRunbook } from "./browser-use-runbook-model";
import { renderHelp } from "./browser-use-parser";
import {
	type BrowserUsePlatformFs,
	createDefaultPlatformFs,
	openBrowserUsePaths,
	resolveBrowserUsePaths,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

function writeTrackingPlatformFs(): {
	fs: BrowserUsePlatformFs;
	writeProbeCount: () => number;
} {
	const base = createDefaultPlatformFs();
	let writeProbes = 0;
	return {
		fs: {
			...base,
			async writeFile(path, contents, mode) {
				writeProbes += 1;
				await base.writeFile(path, contents, mode);
			},
		},
		writeProbeCount: () => writeProbes,
	};
}

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
			// `guide` renders inside the Start here block as a full command form;
			// every other family renders as a grouped `  <family>  <summary>` row.
			expect(help).toContain(
				family === "guide" ? "browser-use guide" : `  ${family}`,
			);
		}
		// Single front door (design brief D2): root help is agent-first and never
		// teaches a secondary CLI; envelope-level prerequisites live on the
		// advanced leaf help of the commands that consume --handoff.
		expect(help).toContain("Start here (for AI agents)");
		expect(help).not.toContain("browser-connect");
	});

	test("family help renders every declared subcommand from the contract table", () => {
		for (const family of BROWSER_USE_FAMILIES) {
			const help = renderHelp(family);
			for (const sub of BROWSER_USE_FAMILY_SUBCOMMANDS[family]) {
				expect(help).toContain(sub);
			}
		}
	});

	test("handoff-consuming families point at the prerequisite; the rest do not", () => {
		// targets/operate consume the handoff; `task` now does too via `task run`
		// (release contract R3), and `runbook` does via `runbook run` (platform U4)
		// — the prerequisite pointer is contract-driven, so a family with any
		// --handoff subcommand shows it.
		expect(renderHelp("targets")).toContain("Verified Handoff Envelope");
		expect(renderHelp("operate")).toContain("Verified Handoff Envelope");
		expect(renderHelp("task")).toContain("Verified Handoff Envelope");
		expect(renderHelp("runbook")).toContain("Verified Handoff Envelope");
		for (const family of ["run", "migration", "artifact", "repair"] as const) {
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
			"lanes-list": BROWSER_USE_ADAPTER_LANES_CONTRACT_ID,
			"lanes-show": BROWSER_USE_ADAPTER_LANES_CONTRACT_ID,
			"run-status": BROWSER_USE_SHARED_RUN_CONTRACT_ID,
			"run-resume": BROWSER_USE_SHARED_RUN_CONTRACT_ID,
			"run-cancel": BROWSER_USE_SHARED_RUN_CONTRACT_ID,
			"runbook-list": BROWSER_USE_RUNBOOK_CATALOG_CONTRACT_ID,
			"runbook-show": BROWSER_USE_RUNBOOK_DEFINITION_CONTRACT_ID,
			"runbook-run": BROWSER_USE_SHARED_RUN_CONTRACT_ID,
			"migration-status": BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID,
			"migration-inventory": BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID,
			"migration-plan": BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID,
			"migration-apply": BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID,
			"migration-verify": BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID,
			"migration-generate": BROWSER_USE_GENERATION_RESULT_CONTRACT_ID,
			"migration-activate": BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID,
			"artifact-list": BROWSER_USE_ARTIFACT_MANIFEST_CONTRACT_ID,
			"repair-status": BROWSER_USE_REPAIR_STATUS_CONTRACT_ID,
			"repair-apply": BROWSER_USE_REPAIR_STATUS_CONTRACT_ID,
			"auth-enroll-browser-automation-token":
				BROWSER_USE_AUTH_READINESS_CONTRACT_ID,
			"auth-repair-vault-grant": BROWSER_USE_AUTH_READINESS_CONTRACT_ID,
			"auth-repair-item-binding": BROWSER_USE_AUTH_READINESS_CONTRACT_ID,
			"auth-request-binding-selection-grant":
				BROWSER_USE_AUTH_READINESS_CONTRACT_ID,
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
			// Runbook commands (platform plan U4) read/write the XDG data root
			// through the one path owner: list/show discover runbooks, run binds a
			// durable shared run.
			"runbook-list",
			"runbook-show",
			"runbook-run",
			"migration-status",
			"migration-inventory",
			"migration-plan",
			"migration-apply",
			"migration-verify",
			"migration-generate",
			"migration-activate",
			// R27 auth repair commands read the run store when --run binds the
			// evaluation to a blocked run (auth plan U3a).
			"auth-enroll-browser-automation-token",
			"auth-repair-vault-grant",
			"auth-repair-item-binding",
			"auth-request-binding-selection-grant",
		]);
		for (const [command, contractId] of Object.entries(expectedContractIds)) {
			const discovered = tree.commands[command];
			expect(discovered?.result_contract?.id).toBe(contractId);
			expect(discovered?.result_contract?.schema_version).toBe(
				contractId === BROWSER_USE_SHARED_RUN_CONTRACT_ID ||
					contractId === BROWSER_USE_MIGRATION_STATUS_CONTRACT_ID
					? "2"
					: "1",
			);
			expect(discovered?.env_vars?.map((entry) => entry.name)).toEqual(
				STORE_BACKED.has(command) ? STORE_ENV_VARS : PLATFORM_ENV_VARS,
			);
		}
	});

	test("migration generate discovery describes one activation-ready immutable generation", () => {
		const help = renderHelp("migration", "migration-generate");
		expect(help).toContain(
			"migration generate --source <absolute-candidate-bundle>",
		);
		expect(help).toContain("complete activation-ready candidate bundle");
		expect(help).toContain("Not a legacy corpus root");
		expect(help).not.toContain("--generation");

		const contract = browserUseContracts["migration-generate"];
		expect(contract.audience).toBe("agent");
		expect(contract.sideEffects).toEqual(["check", "write"]);
		expect(contract.interactivity).toBe("none");
		expect(contract.outputModes).toEqual(["json", "plain"]);
		expect(contract.previewExemption?.reason).toContain(
			"inactive immutable generation",
		);
		expect(Object.keys(contract.flags).sort()).toEqual([
			"--caller",
			"--json",
			"--plain",
			"--source",
		]);
			expect(typeof contract.exitCodes["0"]).toBe("string");
			expect(typeof contract.exitCodes["2"]).toBe("string");
			expect(typeof contract.exitCodes["20"]).toBe("string");
		expect(
			contract.actionAffordances?.failure.map((action) => action.id),
		).toEqual(browserUseGenerationFailureActions.map((action) => action.id));

		const discovered = projectCommandDiscoveryTree(
			Object.entries(browserUseContracts),
		).commands["migration-generate"];
		expect(discovered?.result_contract).toEqual({
			id: BROWSER_USE_GENERATION_RESULT_CONTRACT_ID,
			kind: expect.stringContaining("generation_id"),
			schema_version: "1",
		});
		expect(discovered?.mutation).toBe("write");
		expect(discovered?.side_effects).toEqual(["check", "write"]);
		expect(discovered?.output_modes).toEqual(["json", "plain"]);
	});

	test("migration activate help advertises generation without source", () => {
		const help = renderHelp("migration", "migration-activate");
		expect(help).toContain("migration activate");
		expect(help).toContain("--generation");
		expect(help).not.toContain("--source");
		const discovered = projectCommandDiscoveryTree(
			Object.entries(browserUseContracts),
		).commands["migration-activate"];
		expect(discovered?.mutation).toBe("write");
		expect(discovered?.side_effects).toEqual(["check", "write"]);
	});

	test("migration status exposes active-generation fields in discovery, JSON, and plain output", async () => {
		const xdg = makeTempXdgEnv();
		try {
			const resolved = resolveBrowserUsePaths(xdg.env);
			if (!resolved.ok) throw new Error(resolved.refusal.code);
			const tracked = writeTrackingPlatformFs();
			const runtime = makeRuntime({ env: xdg.env, platformFs: tracked.fs });
			const discovered = projectCommandDiscoveryTree(
				Object.entries(browserUseContracts),
			).commands["migration-status"];
			expect(discovered?.result_contract?.kind).toContain(
				"active_generation",
			);

			const jsonResult = await runForTest(
				["migration", "status", "--json"],
				runtime,
			);
			expect(jsonResult.exitCode).toBe(0);
			expect(parseJson(jsonResult.stdout).data).toMatchObject({
				active_generation: {
					state: "never-activated",
					current: null,
					prior: null,
					retained: [],
					activation_epoch: null,
					pending: "none",
					effect_fence: "not-applicable",
				},
			});
			expect(tracked.writeProbeCount()).toBe(0);
			expect(existsSync(resolved.resolution.roots.state)).toBe(false);

			const plainResult = await runForTest(
				["migration", "status", "--plain"],
				runtime,
			);
			expect(plainResult.exitCode).toBe(0);
			expect(plainResult.stdout).toContain(
				"active_generation_state=never-activated",
			);
			expect(plainResult.stdout).toContain("active_generation_current=none");
			expect(plainResult.stdout).toContain("active_generation_prior=none");
			expect(plainResult.stdout).toContain("active_generation_retained=none");
			expect(plainResult.stdout).toContain("activation_epoch=none");
			expect(plainResult.stdout).toContain("pending_activation=none");
			expect(plainResult.stdout).toContain(
				"active_generation_effect_fence=not-applicable",
			);

			const fs = createDefaultPlatformFs();
			const opened = await openBrowserUsePaths(fs, xdg.env);
			if (!opened.ok) throw new Error(opened.refusal.code);
			await fs.mkdir(opened.paths.state.migrationsDir, {
				recursive: true,
				mode: 0o700,
			});
			await fs.writeFileDurable(
				join(opened.paths.state.migrationsDir, "migration-state.json"),
				'{"contract":',
				0o600,
			);
			const corruptResult = await runForTest(
				["migration", "status", "--json"],
				runtime,
			);
			expect(corruptResult.exitCode).toBe(20);
			const corruptEnvelope = parseJson(corruptResult.stdout);
			expect(corruptEnvelope.error).toMatchObject({
				code: "migration_state_corrupt",
				recoverability: "repair_state",
				retryable: false,
			});
			expect(corruptEnvelope.runtime_actions).toMatchObject([
				{ id: "inspect_migration_state" },
			]);
			expect(corruptEnvelope.runtime_actions).toHaveLength(1);
			expect(corruptEnvelope.continuation).toEqual({
				next_action_id: "inspect_migration_state",
			});
		} finally {
			xdg.dispose();
		}
	});

	test("migration activate dispatches its activation engine and preserves output channels", async () => {
		const xdg = makeTempXdgEnv();
		try {
			const runtime = makeRuntime({ env: xdg.env });
			const jsonResult = await runForTest(
				[
					"migration",
					"activate",
					"--generation",
					"generation-not-staged",
					"--json",
				],
				runtime,
			);
			expect(jsonResult.exitCode).toBe(20);
			expect(jsonResult.stderr).toBe("");
			const envelope = parseJson(jsonResult.stdout);
			expect(envelope.data).toMatchObject({ command: "migration-activate" });
			const error = envelope.error as Record<string, unknown>;
			expect(error).toMatchObject({
				code: "migration_not_verified",
				recoverability: "repair_state",
				retryable: false,
			});
			expect(envelope.runtime_actions).toMatchObject([
				{ id: "inspect_migration_state" },
			]);
			expect(envelope.continuation).toEqual({
				next_action_id: "inspect_migration_state",
			});
			const migrationFailureActionIds = browserUseMigrationFailureActions.map(
				(action) => action.id,
			);
			for (const command of [
				"migration-status",
				"migration-inventory",
				"migration-plan",
				"migration-apply",
				"migration-verify",
				"migration-activate",
			] as const) {
				expect(
					browserUseContracts[command].actionAffordances?.failure.map(
						(action) => action.id,
					),
				).toEqual(migrationFailureActionIds);
			}

			const plainResult = await runForTest(
				[
					"migration",
					"activate",
					"--generation",
					"generation-not-staged",
					"--plain",
				],
				runtime,
			);
			expect(plainResult.exitCode).toBe(20);
			expect(plainResult.stdout).toBe("");
			expect(plainResult.stderr).toContain(String(error.code));
			expect(plainResult.stderr).toContain(
				"action=inspect_migration_state",
			);

			const defaultTarget = await runForTest(
				["migration", "activate", "--json"],
				runtime,
			);
			expect(defaultTarget.exitCode).toBe(20);
			expect(defaultTarget.stderr).toBe("");
			expect(parseJson(defaultTarget.stdout).error).toMatchObject({
				code: "migration_not_verified",
				recoverability: "repair_state",
				retryable: false,
			});
		} finally {
			xdg.dispose();
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
		// Preferred lanes are honest: a row with a preferred_adapter reports
		// lane_registered true iff that adapter is a registered live lane; a row
		// without one reports false (KTD12 typed unavailability). Every intent now
		// carries a registered preferred lane (U4 wired the chrome intents).
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
		// Every intent now routes to a registered live lane: routine/runbook/scrape
		// -> agent-browser, frontend/locator/trace/http-replay -> playwright-cdp,
		// debug/performance-profile/lighthouse-audit -> chrome-devtools-mcp (U4).
		expect(plain.stdout).toContain("registered=true");
		expect(plain.stdout).not.toContain("registered=false");
	});
});

describe("platform families are all live (no not-implemented shell remains)", () => {
	// U2 made run status/resume/cancel, artifact list, and repair status live
	// over the XDG store; U3 made the migration family live; U4 made the runbook
	// family live (list/show/run). No family falls through to the typed
	// not-implemented shell any more — runbook list now opens the store like the
	// other store-backed commands, so an unresolvable XDG root fails closed the
	// same way run status does (agent audience: JSON refusal on stdout, exit 20).
	test("runbook list is live and fails closed on an unresolvable XDG root", async () => {
		const result = await runForTest(["runbook", "list", "--json"], makeRuntime());
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "xdg_root_relative" });
		expect(JSON.stringify(json.error)).not.toContain("browser_use_not_implemented");
		const data = json.data as Record<string, unknown>;
		expect(data.command).toBe("runbook-list");
	});

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

	// The probe command is `runbook list` with no resolvable XDG root: it fails
	// closed at path resolution (exit 20) deterministically without needing a
	// store, so the parity proof stays store-free. The live store-backed parity
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
			expect(result.exitCode).toBe(20);
			const json = parseJson(result.stdout);
			expect(json.error).toMatchObject({ code: "xdg_root_relative" });
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

describe("runbook input custody CLI boundary", () => {
	test("a missing runbook refuses before private-file reads or write admission", async () => {
		const xdg = makeTempXdgEnv();
		const resolved = resolveBrowserUsePaths(xdg.env);
		if (!resolved.ok) throw new Error(resolved.refusal.code);
		const tracked = writeTrackingPlatformFs();
		try {
			const result = await runForTest(
				[
					"runbook",
					"run",
					"--service",
					"missing",
					"--flow",
					"missing",
					"--input-file",
					`payload=${join(
						resolved.resolution.roots.runtime,
						"private-inputs",
						"missing.json",
					)}`,
					"--json",
				],
				makeRuntime({ env: xdg.env, platformFs: tracked.fs }),
			);
			expect(result.exitCode).toBe(20);
			expect(parseJson(result.stdout).error).toMatchObject({
				code: "runbook_not_found",
			});
			expect(tracked.writeProbeCount()).toBe(0);
			expect(existsSync(resolved.resolution.roots.state)).toBe(false);
		} finally {
			xdg.dispose();
		}
	});

	async function fixture() {
		const xdg = makeTempXdgEnv();
		const runtime = makeRuntime({ env: xdg.env });
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);
		const runbook: BrowserUseRunbook = {
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "custody",
			flow_id: "check",
			flow_name: "check-input-custody",
			version: "1",
			summary: "Check public and private input custody.",
			allowed_origins: ["https://example.test"],
			inputs: [
				{
					id: "query",
					summary: "Ordinary query.",
					required: false,
					custody: "ordinary",
					schema: { kind: "string" },
				},
				{
					id: "payload",
					summary: "Sensitive structured payload.",
					required: false,
					custody: "sensitive",
					schema: {
						kind: "object",
						fields: {
							name: {
								schema: { kind: "string" },
								required: true,
							},
						},
					},
				},
			],
			steps: [{ kind: "snapshot", interactive: false }],
		};
		const runbookDirectory = join(
			opened.paths.data.root,
			"runbooks",
			runbook.service_id,
			runbook.flow_id,
		);
		await fs.mkdir(runbookDirectory, { recursive: true, mode: 0o700 });
		await fs.writeFileDurable(
			join(runbookDirectory, "runbook.json"),
			`${JSON.stringify(runbook)}\n`,
			0o600,
		);
		const privateRoot = join(
			opened.paths.resolution.roots.runtime,
			"private-inputs",
			);
			await fs.mkdir(privateRoot, { recursive: true, mode: 0o700 });
			const sentinel = "custody-secret-sentinel";
			const privateQueryPath = join(privateRoot, "query.json");
			const privatePayloadPath = join(privateRoot, "payload.json");
			const invalidPrivatePayloadPath = join(
				privateRoot,
				"invalid-payload.json",
			);
			await fs.writeFileDurable(
				privateQueryPath,
				`${JSON.stringify(sentinel)}\n`,
				0o600,
			);
			await fs.writeFileDurable(
				privatePayloadPath,
				`${JSON.stringify({ name: sentinel })}\n`,
				0o600,
			);
			await fs.writeFileDurable(
				invalidPrivatePayloadPath,
				"{invalid-json\n",
				0o600,
			);
			return {
				xdg,
				runtime,
				opened,
				sentinel,
				privateQueryPath,
				privatePayloadPath,
				invalidPrivatePayloadPath,
			};
		}

	const baseArgv = [
		"runbook",
		"run",
		"--service",
		"custody",
		"--flow",
		"check",
	] as const;

	for (const scenario of [
		{
			name: "sensitive value supplied through public argv",
			args: (input: Awaited<ReturnType<typeof fixture>>) => [
				"--input",
				`payload=${input.sentinel}`,
			],
			code: "runbook_input_custody_mismatch",
		},
		{
			name: "unknown public input id",
			args: (input: Awaited<ReturnType<typeof fixture>>) => [
				"--input",
				`missing=${input.sentinel}`,
			],
			code: "runbook_input_unknown",
		},
		{
			name: "same id supplied through public and private sources",
			args: (input: Awaited<ReturnType<typeof fixture>>) => [
				"--input",
				`query=${input.sentinel}`,
				"--input-file",
				`query=${input.privateQueryPath}`,
			],
			code: "runbook_input_source_conflict",
		},
	] as const) {
		test(`${scenario.name} refuses before durable writes`, async () => {
			const input = await fixture();
			try {
				const result = await runForTest(
					[
						...baseArgv,
						...scenario.args(input),
						"--verbose",
						"--json",
					],
					input.runtime,
				);
				expect(result.exitCode).toBe(20);
				const envelope = parseJson(result.stdout);
				expect(envelope.error).toMatchObject({
					code: scenario.code,
					recoverability: "change_input",
					retryable: false,
				});
				expect(envelope.runtime_actions).toMatchObject([
					{ id: "change_runbook_input" },
				]);
				expect(envelope.continuation).toEqual({
					next_action_id: "change_runbook_input",
				});
				expect(`${result.stdout}\n${result.stderr}`).not.toContain(
					input.sentinel,
				);
				expect(
					existsSync(input.opened.paths.state.runsDir)
						? readdirSync(input.opened.paths.state.runsDir)
						: [],
				).toEqual([]);
			} finally {
				input.xdg.dispose();
			}
		});
	}

	test("plain refusal keeps code/action parity without the value", async () => {
		const input = await fixture();
		try {
			const result = await runForTest(
				[
					...baseArgv,
					"--input",
					`payload=${input.sentinel}`,
					"--plain",
				],
				input.runtime,
			);
			expect(result.exitCode).toBe(20);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain(
				"runbook_input_custody_mismatch",
			);
			expect(result.stderr).toContain("action=change_runbook_input");
			expect(result.stderr).not.toContain(input.sentinel);
		} finally {
			input.xdg.dispose();
		}
	});

	test("private path refusal uses the declared input-correction action in JSON", async () => {
		const input = await fixture();
		try {
			const result = await runForTest(
				[
					...baseArgv,
					"--input-file",
					`payload=${join(input.xdg.base, "outside.json")}`,
					"--json",
				],
				input.runtime,
			);
			expect(result.exitCode).toBe(20);
			expect(parseJson(result.stdout)).toMatchObject({
				error: { code: "private_input_path_unsafe" },
				runtime_actions: [{ id: "change_runbook_input" }],
				continuation: { next_action_id: "change_runbook_input" },
			});
		} finally {
			input.xdg.dispose();
		}
	});

	test("private JSON refusal keeps plain code/action parity", async () => {
		const input = await fixture();
		try {
			const result = await runForTest(
				[
					...baseArgv,
					"--input-file",
					`payload=${input.invalidPrivatePayloadPath}`,
					"--plain",
				],
				input.runtime,
			);
			expect(result.exitCode).toBe(20);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain("private_input_json_invalid");
			expect(result.stderr).toContain("action=change_runbook_input");
		} finally {
			input.xdg.dispose();
		}
	});

	test("correct private custody advances without value disclosure", async () => {
		const input = await fixture();
		try {
			const result = await runForTest(
				[
					...baseArgv,
					"--input-file",
					`payload=${input.privatePayloadPath}`,
					"--json",
				],
				input.runtime,
			);
			expect(result.exitCode).not.toBe(2);
			const envelope = parseJson(result.stdout);
			expect([
				"runbook_input_unknown",
				"runbook_input_source_conflict",
				"runbook_input_custody_mismatch",
			]).not.toContain(
				(envelope.error as Record<string, unknown> | undefined)?.code,
			);
			expect(`${result.stdout}\n${result.stderr}`).not.toContain(
				input.sentinel,
			);
		} finally {
			input.xdg.dispose();
		}
	});
});
