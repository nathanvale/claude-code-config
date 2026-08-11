import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
} from "@side-quest/cli-command-facade";
import { assertNoRuntimeContractFixtureLeaks } from "@side-quest/cli-command-facade/testing";
import type { WarmChromeMainDeps } from "@side-quest/warm-chrome/cli";

import {
	browserConnectBranchStationCatalog,
} from "../src/branch-station-catalog.ts";
import {
	BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS,
	BROWSER_CONNECT_FAILURE_ACTION_IDS,
	BROWSER_CONNECT_REPAIR_CAUSES,
	redactBrowserConnectText,
	type BrowserConnectFailureActionId,
	type BrowserConnectRepairCause,
	type BrowserConnectRepairContext,
} from "../src/model.ts";
import {
	BROWSER_CONNECT_CONTINUATION_CONSTRAINT_IDS,
	BROWSER_CONNECT_LEGACY_COMPATIBILITY_STOP_IDS,
	BROWSER_CONNECT_REPAIR_DOCS_BASE_URL,
	selectBrowserConnectLegacyNextAction,
	selectBrowserConnectRepairPath,
	type BrowserConnectRepairInvocation,
} from "../src/repair-path.ts";
import {
	BROWSER_CONNECT_ERROR_STATION_IDS,
	BROWSER_CONNECT_SUCCESS_STATION_IDS,
	browserConnectRecoveryExpectations,
	type BrowserConnectErrorStationId,
	type BrowserConnectStationRecoveryExpectation,
} from "../src/recovery-expectations.ts";
import { buildFailureEnvelopeParts, main } from "../src/cli.ts";
import type {
	AdapterCommandInput,
	AdapterCommandResult,
	AdapterDefinition,
	AdapterExecutableResolution,
	AdapterRuntime,
} from "../src/adapters/registry.ts";
import { agentBrowserDefinition } from "../src/adapters/agent-browser.ts";
import { chromeDevtoolsMcpDefinition } from "../src/adapters/chrome-devtools-mcp.ts";
import type { RunSpawner } from "../src/run-exec.ts";
import { agentBrowserReleaseResult } from "./agent-browser-release-fixture.ts";

// ===========================================================================
// U4 recovery-expectation proof (R1/R13/AE1). The package map declares each
// error station's permitted recovery postures; these tests drive every
// RUNTIME-reachable arm of all 14 target error stations through the real
// main(argv, deps) and reject any projection the map does not declare:
// automatic arms must project ordered runtime_actions plus one
// continuation.next_action_id; operator arms must project requires_operator,
// package choices, at least one constraint, and NO next action; and the
// legacy schema-1 data.next_action_id must stay inside the station's declared
// mirror/stop vocabulary (R16/R30).
// ===========================================================================

const RUN_ID = "u4-recovery";

// -- Minimal in-process harness (entrypoint.test.ts idiom) --

type MemoryWriter = { output: string; write(chunk: string): true };

function memoryWriter(): MemoryWriter {
	return {
		output: "",
		write(chunk: string) {
			this.output += chunk;
			return true;
		},
	};
}

function warmChromeOkEnvelope(port: string): string {
	return `${JSON.stringify(
		{
			status: "ok",
			run_id: RUN_ID,
			data: {
				contract_id: "warm-chrome.browser-entry",
				schema_version: "1",
				endpoint: `http://127.0.0.1:${port}`,
				web_socket_debugger_url: `ws://127.0.0.1:${port}/devtools/browser/u4`,
			},
		},
		null,
		2,
	)}\n`;
}

function warmChromeErrorEnvelope(input: {
	code: string;
	reason: string;
	suggestedExplicitPort?: number;
}): string {
	return `${JSON.stringify(
		{
			status: "error",
			run_id: RUN_ID,
			process_exit_code: 20,
			error: { code: input.code, message: `rejected: ${input.code}`, exit_code: 20 },
			data: {
				reason: input.reason,
				...(input.suggestedExplicitPort === undefined
					? {}
					: { suggested_explicit_port: input.suggestedExplicitPort }),
			},
		},
		null,
		2,
	)}\n`;
}

type WarmChromeStep = { envelope: string; exitCode: number };

function scriptedWarmChromeMain(script: readonly WarmChromeStep[]) {
	let index = 0;
	return async (
		_argv: readonly string[],
		deps: WarmChromeMainDeps = {},
	): Promise<number> => {
		const step = script[index];
		index += 1;
		if (!step) throw new Error("scripted warm-chrome main exhausted");
		deps.stdout?.write(step.envelope);
		return step.exitCode;
	};
}

const neverWarmChrome = async (): Promise<number> => {
	throw new Error("warm-chrome must not run for this scenario");
};

const okStep = (port = "9222"): WarmChromeStep => ({
	envelope: warmChromeOkEnvelope(port),
	exitCode: 0,
});

const absentStep: WarmChromeStep = {
	envelope: warmChromeErrorEnvelope({
		code: "endpoint_unreachable",
		reason: "no_listener",
	}),
	exitCode: 20,
};

const occupiedStep = (suggestedExplicitPort?: number): WarmChromeStep => ({
	envelope: warmChromeErrorEnvelope({
		code: "port_occupied_foreign",
		reason: "foreign_listener",
		...(suggestedExplicitPort === undefined ? {} : { suggestedExplicitPort }),
	}),
	exitCode: 20,
});

const PINNED = {
	"chrome-devtools-mcp": chromeDevtoolsMcpDefinition.pinnedVersion,
	"agent-browser": agentBrowserDefinition.pinnedVersion,
} as const;

function fakeAdapterRuntime(script: {
	version?: Record<string, string | undefined>;
	probeExit?: Record<string, number>;
	unresolvable?: readonly string[];
}): AdapterRuntime {
	const unresolvable = new Set(script.unresolvable ?? []);
	return {
		env: {},
		resolveExecutable: (command): AdapterExecutableResolution =>
			unresolvable.has(command)
				? { resolved: false }
				: { resolved: true, path: `/fake/bin/${command}` },
		runCommand: async (
			input: AdapterCommandInput,
		): Promise<AdapterCommandResult> => {
			const executable = input.command.replace("/fake/bin/", "");
			if (input.args.includes("--version")) {
				const version = script.version?.[executable];
				if (version === undefined) {
					return { exitCode: 127, stdout: "", stderr: "command not found" };
				}
				return { exitCode: 0, stdout: `${executable} ${version}\n`, stderr: "" };
			}
			const releaseResult = agentBrowserReleaseResult(
				"/fake/bin/agent-browser",
				input,
			);
			if (releaseResult) return releaseResult;
			const exit = script.probeExit?.[executable] ?? 0;
			return { exitCode: exit, stdout: exit === 0 ? "attached\n" : "", stderr: "" };
		},
	};
}

function realRegistryAccessors() {
	const byId: Record<string, AdapterDefinition> = {
		"chrome-devtools-mcp": chromeDevtoolsMcpDefinition,
		"agent-browser": agentBrowserDefinition,
	};
	return {
		listAdapterDefinitions: () => [
			chromeDevtoolsMcpDefinition,
			agentBrowserDefinition,
		],
		findAdapterDefinition: (id: string) => byId[id],
	};
}

type ScenarioDeps = Omit<Parameters<typeof main>[1], "stdout" | "stderr">;

type ScenarioRun = { exitCode: number; stdout: string; stderr: string };

async function runScenario(
	argv: readonly string[],
	deps: ScenarioDeps,
): Promise<ScenarioRun> {
	const stdout = memoryWriter();
	const stderr = memoryWriter();
	const exitCode = await main(argv, { ...deps, stdout, stderr });
	return { exitCode, stdout: stdout.output, stderr: stderr.output };
}

type ProjectedEnvelope = {
	status?: string;
	data?: Record<string, unknown>;
	error?: { code?: string; exit_code?: number };
	runtime_actions?: Array<{ id: string; docs_url?: string; summary?: string }>;
	continuation?: {
		next_action_id?: string;
		requires_operator?: boolean;
		constraints?: Array<{ id: string; summary?: string }>;
		choices?: Array<{ id: string; docs_url?: string; summary?: string }>;
	};
};

function parseStdoutEnvelope(run: ScenarioRun): ProjectedEnvelope {
	return JSON.parse(run.stdout) as ProjectedEnvelope;
}

function parseLastStderrJson(run: ScenarioRun): ProjectedEnvelope {
	const line = run.stderr
		.trim()
		.split("\n")
		.filter((candidate) => candidate.startsWith("{"))
		.at(-1);
	if (!line) throw new Error(`no JSON envelope on stderr:\n${run.stderr}`);
	return JSON.parse(line) as ProjectedEnvelope;
}

// -- Arm expectations ------------------------------------------------------

type ArmExpectation =
	| {
			posture: "automatic";
			action: BrowserConnectFailureActionId;
			legacy: BrowserConnectFailureActionId;
			constraintIncludes?: readonly string[];
	  }
	| {
			posture: "operator";
			choiceIds: readonly string[];
			legacy: BrowserConnectFailureActionId;
			constraintIncludes?: readonly string[];
	  };

function assertArm(
	station: BrowserConnectErrorStationId,
	envelope: ProjectedEnvelope,
	arm: ArmExpectation,
): void {
	const expectation: BrowserConnectStationRecoveryExpectation =
		browserConnectRecoveryExpectations[station];
	const label = `station ${station}`;

	// The legacy schema-1 field stays required and inside the declared
	// mirror/stop vocabulary (R16/R30).
	expect(envelope.data?.next_action_id, `${label} legacy value`).toBe(arm.legacy);
	expect(
		expectation.legacy_next_action_ids,
		`${label} legacy vocabulary`,
	).toContain(arm.legacy);

	// Compatibility-only ids never lead the outer continuation (R20).
	for (const compatibilityOnly of BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS) {
		expect(
			envelope.continuation?.next_action_id,
			`${label} compatibility-only exclusion`,
		).not.toBe(compatibilityOnly);
	}

	if (arm.posture === "automatic") {
		expect(expectation.automatic_action_ids, `${label} automatic vocabulary`).toContain(
			arm.action,
		);
		expect(envelope.continuation?.next_action_id, `${label} next action`).toBe(
			arm.action,
		);
		expect(
			envelope.continuation?.requires_operator,
			`${label} automatic never requires operator`,
		).toBeUndefined();
		expect(
			envelope.continuation?.choices,
			`${label} choices never beside an automatic action`,
		).toBeUndefined();
		expect(
			envelope.runtime_actions?.map((action) => action.id),
			`${label} ordered runtime actions`,
		).toEqual([arm.action]);
		expect(
			envelope.runtime_actions?.[0]?.docs_url,
			`${label} versioned docs url`,
		).toContain(`#v1-${arm.action}`);
	} else {
		expect(
			envelope.continuation?.requires_operator,
			`${label} requires operator`,
		).toBe(true);
		expect(
			envelope.continuation?.next_action_id,
			`${label} operator has no next action`,
		).toBeUndefined();
		const choiceIds = (envelope.continuation?.choices ?? []).map(
			(choice) => choice.id,
		);
		expect(choiceIds.toSorted(), `${label} operator choices`).toEqual(
			[...arm.choiceIds].toSorted(),
		);
		for (const choiceId of choiceIds) {
			expect(expectation.operator_choice_ids, `${label} choice vocabulary`).toContain(
				choiceId,
			);
		}
		const constraintIds = (envelope.continuation?.constraints ?? []).map(
			(constraint) => constraint.id,
		);
		expect(
			constraintIds.length,
			`${label} operator constraint floor (R25)`,
		).toBeGreaterThan(0);
		for (const floorId of expectation.operator_constraint_floor) {
			expect(constraintIds, `${label} constraint floor ${floorId}`).toContain(floorId);
		}
		for (const constraintId of constraintIds) {
			expect(
				BROWSER_CONNECT_CONTINUATION_CONSTRAINT_IDS as readonly string[],
				`${label} catalogue constraint`,
			).toContain(constraintId);
		}
	}

	for (const constraintId of arm.constraintIncludes ?? []) {
		const constraintIds = (envelope.continuation?.constraints ?? []).map(
			(constraint) => constraint.id,
		);
		expect(constraintIds, `${label} expected constraint ${constraintId}`).toContain(
			constraintId,
		);
	}
}

// -- Map shape reconciliation ------------------------------------------------

describe("recovery-expectation map shape (U4 R13)", () => {
	test("map keys reconcile exactly with the catalog's error stations", () => {
		const catalogErrorStations = browserConnectBranchStationCatalog
			.filter((station) => station.expectedEnvelopeStatus === "error")
			.map((station) => station.id)
			.toSorted();
		expect([...BROWSER_CONNECT_ERROR_STATION_IDS].toSorted()).toEqual(
			catalogErrorStations,
		);
		expect(BROWSER_CONNECT_ERROR_STATION_IDS).toHaveLength(14);
	});

	test("success exclusions plus error stations cover the whole catalog", () => {
		const all = [
			...BROWSER_CONNECT_SUCCESS_STATION_IDS,
			...BROWSER_CONNECT_ERROR_STATION_IDS,
		].toSorted();
		expect(all).toEqual(
			browserConnectBranchStationCatalog.map((station) => station.id).toSorted(),
		);
	});

	test("inspect_* is never an automatic next action (R13)", () => {
		for (const expectation of Object.values(browserConnectRecoveryExpectations)) {
			for (const actionId of expectation.automatic_action_ids) {
				expect(actionId.startsWith("inspect_")).toBe(false);
			}
		}
	});

	test("automatic ids are model actions and never compatibility-only (R20)", () => {
		for (const expectation of Object.values(browserConnectRecoveryExpectations)) {
			for (const actionId of expectation.automatic_action_ids) {
				expect(BROWSER_CONNECT_FAILURE_ACTION_IDS).toContain(actionId);
				expect(
					BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS as readonly string[],
				).not.toContain(actionId);
			}
		}
	});

	test("constraint floors resolve to catalogue constraint ids (R25)", () => {
		for (const expectation of Object.values(browserConnectRecoveryExpectations)) {
			for (const constraintId of expectation.operator_constraint_floor) {
				expect(BROWSER_CONNECT_CONTINUATION_CONSTRAINT_IDS).toContain(constraintId);
			}
		}
	});

	test("legacy values outside the automatic mirrors stay in the closed stop set (R30)", () => {
		for (const expectation of Object.values(browserConnectRecoveryExpectations)) {
			for (const legacyId of expectation.legacy_next_action_ids) {
				const isMirror = expectation.automatic_action_ids.includes(legacyId);
				if (!isMirror) {
					expect(
						BROWSER_CONNECT_LEGACY_COMPATIBILITY_STOP_IDS as readonly string[],
					).toContain(legacyId);
				}
			}
		}
	});
});

// -- Station arm drives --------------------------------------------------------

type StationArms = Record<BrowserConnectErrorStationId, () => Promise<void>>;

const installedRuntime = () =>
	fakeAdapterRuntime({
		version: {
			"agent-browser": PINNED["agent-browser"],
			"chrome-devtools-mcp": PINNED["chrome-devtools-mcp"],
		},
	});

const stationArmDrives: StationArms = {
	"check.usage_invalid": async () => {
		const run = await runScenario(
			["check", "--port", "70000", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: neverWarmChrome,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(run.exitCode).toBe(2);
		const envelope = parseStdoutEnvelope(run);
		expect(envelope.error?.code).toBe("usage_invalid");
		assertArm("check.usage_invalid", envelope, {
			posture: "operator",
			choiceIds: ["provide_corrected_input"],
			legacy: "change_input",
			constraintIncludes: ["no_synthesized_caller_input"],
		});
	},

	"run.missing_separator": async () => {
		// Automatic arm: a missing `--` with a non-empty wrapped command preserved
		// only in parser memory (AE6). The wrapped words never serialize (R26).
		const automatic = await runScenario(
			["run", "agent-browser", "agent-browser", "snapshot", "--run-id", RUN_ID],
			{
				warmChromeMain: neverWarmChrome,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(automatic.exitCode).toBe(2);
		expect(automatic.stdout).toBe("");
		const automaticEnvelope = parseLastStderrJson(automatic);
		expect(automaticEnvelope.error?.code).toBe("missing_separator");
		assertArm("run.missing_separator", automaticEnvelope, {
			posture: "automatic",
			action: "add_run_separator",
			legacy: "add_run_separator",
		});
		expect(automatic.stderr).toMatch(/("cause":"|cause=)separator_missing/);
		expect(automatic.stderr).not.toContain("snapshot");

		// Operator arm A: `--` present but the tail is empty — the distinct
		// wrapped_command_missing cause on the SAME station.
		const emptyTail = await runScenario(
			["run", "agent-browser", "--run-id", RUN_ID, "--"],
			{
				warmChromeMain: neverWarmChrome,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(emptyTail.exitCode).toBe(2);
		const emptyTailEnvelope = parseLastStderrJson(emptyTail);
		expect(emptyTailEnvelope.error?.code).toBe("missing_separator");
		assertArm("run.missing_separator", emptyTailEnvelope, {
			posture: "operator",
			choiceIds: ["provide_wrapped_command"],
			legacy: "change_input",
			constraintIncludes: ["no_synthesized_caller_input"],
		});
		expect(emptyTail.stderr).toMatch(/("cause":"|cause=)wrapped_command_missing/);

		// Operator arm B: no `--` and no wrapped words — separator_missing without
		// the parser-memory marker.
		const bare = await runScenario(["run", "agent-browser", "--run-id", RUN_ID], {
			warmChromeMain: neverWarmChrome,
			adapterRuntime: fakeAdapterRuntime({}),
			...realRegistryAccessors(),
		});
		expect(bare.exitCode).toBe(2);
		const bareEnvelope = parseLastStderrJson(bare);
		assertArm("run.missing_separator", bareEnvelope, {
			posture: "operator",
			choiceIds: ["provide_wrapped_command"],
			legacy: "change_input",
		});
		expect(bare.stderr).toMatch(/("cause":"|cause=)separator_missing/);
	},

	"check.environment_absent": async () => {
		const automatic = await runScenario(["check", "--json", "--run-id", RUN_ID], {
			warmChromeMain: scriptedWarmChromeMain([absentStep]),
			adapterRuntime: fakeAdapterRuntime({}),
			...realRegistryAccessors(),
		});
		expect(automatic.exitCode).toBe(20);
		const automaticEnvelope = parseStdoutEnvelope(automatic);
		expect(automaticEnvelope.error?.code).toBe("environment_absent");
		assertArm("check.environment_absent", automaticEnvelope, {
			posture: "automatic",
			action: "launch_agent_chrome",
			legacy: "launch_agent_chrome",
			constraintIncludes: ["no_adapter_fallback", "no_process_destruction"],
		});

		// Hop 1 fails closed to the operator (R23): no relaunch advice.
		const hopOne = await runScenario(
			["check", "--repair-chain-hop", "1", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([absentStep]),
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(hopOne.exitCode).toBe(20);
		assertArm("check.environment_absent", parseStdoutEnvelope(hopOne), {
			posture: "operator",
			choiceIds: ["inspect_diagnostics"],
			legacy: "inspect_diagnostics",
			constraintIncludes: ["no_cross_invocation_retry"],
		});
	},

	"check.foreign_listener": async () => {
		// KTD20: check preserves the suggestion as typed evidence but NEVER emits
		// a suggested-port continuation.
		const run = await runScenario(["check", "--json", "--run-id", RUN_ID], {
			warmChromeMain: scriptedWarmChromeMain([occupiedStep(9333)]),
			adapterRuntime: fakeAdapterRuntime({}),
			...realRegistryAccessors(),
		});
		expect(run.exitCode).toBe(20);
		const envelope = parseStdoutEnvelope(run);
		expect(envelope.error?.code).toBe("foreign_listener");
		assertArm("check.foreign_listener", envelope, {
			posture: "operator",
			choiceIds: ["inspect_listener"],
			legacy: "inspect_listener",
			constraintIncludes: ["no_internal_port_switch", "no_process_destruction"],
		});
	},

	"connect.launch_failed": async () => {
		const run = await runScenario(
			["connect", "agent-browser", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([absentStep, absentStep]),
				adapterRuntime: installedRuntime(),
				...realRegistryAccessors(),
			},
		);
		expect(run.exitCode).toBe(20);
		const envelope = parseStdoutEnvelope(run);
		expect(envelope.error?.code).toBe("launch_failed");
		assertArm("connect.launch_failed", envelope, {
			posture: "operator",
			choiceIds: ["inspect_diagnostics"],
			legacy: "inspect_diagnostics",
			constraintIncludes: ["no_adapter_fallback"],
		});
	},

	"connect.foreign_listener": async () => {
		// Automatic arm: hop 0 with a verified suggestion selects the sole
		// cross-invocation continuation (R23/AE3).
		const automatic = await runScenario(
			["connect", "agent-browser", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([occupiedStep(9333)]),
				adapterRuntime: installedRuntime(),
				...realRegistryAccessors(),
			},
		);
		expect(automatic.exitCode).toBe(20);
		const automaticEnvelope = parseStdoutEnvelope(automatic);
		expect(automaticEnvelope.error?.code).toBe("foreign_listener");
		assertArm("connect.foreign_listener", automaticEnvelope, {
			posture: "automatic",
			action: "use_suggested_port",
			legacy: "use_suggested_port",
			constraintIncludes: [
				"no_internal_port_switch",
				"no_unverified_listener_connection",
			],
		});

		// Operator arm: no suggestion → terminal listener inspection (AE4/AE21).
		const operator = await runScenario(
			["connect", "agent-browser", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([occupiedStep()]),
				adapterRuntime: installedRuntime(),
				...realRegistryAccessors(),
			},
		);
		expect(operator.exitCode).toBe(20);
		assertArm("connect.foreign_listener", parseStdoutEnvelope(operator), {
			posture: "operator",
			choiceIds: ["inspect_listener"],
			legacy: "inspect_listener",
		});

		// Hop 1 with a fresh suggestion can never emit another suggested-port
		// action (R23/AE3).
		const hopOne = await runScenario(
			[
				"connect",
				"agent-browser",
				"--port",
				"9333",
				"--repair-chain-hop",
				"1",
				"--json",
				"--run-id",
				RUN_ID,
			],
			{
				warmChromeMain: scriptedWarmChromeMain([occupiedStep(9444)]),
				adapterRuntime: installedRuntime(),
				...realRegistryAccessors(),
			},
		);
		expect(hopOne.exitCode).toBe(20);
		const hopOneEnvelope = parseStdoutEnvelope(hopOne);
		assertArm("connect.foreign_listener", hopOneEnvelope, {
			posture: "operator",
			choiceIds: ["inspect_listener"],
			legacy: "inspect_listener",
			constraintIncludes: ["no_cross_invocation_retry"],
		});
		// The forbidden id may appear inside the constraint record itself; the
		// LIVE affordances must not offer it: no next action, no runtime actions,
		// and no choice named use_suggested_port.
		expect(hopOneEnvelope.runtime_actions).toBeUndefined();
		expect(
			(hopOneEnvelope.continuation?.choices ?? []).map((choice) => choice.id),
		).not.toContain("use_suggested_port");
	},

	"connect.adapter_unknown": async () => {
		// Automatic arm: exactly one registered case-insensitive correction is a
		// deterministic trusted replacement (matrix: adapter-unknown with one
		// deterministic registered correction → change_input).
		const automatic = await runScenario(
			["connect", "AGENT-BROWSER", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: neverWarmChrome,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(automatic.exitCode).toBe(2);
		const automaticEnvelope = parseStdoutEnvelope(automatic);
		expect(automaticEnvelope.error?.code).toBe("adapter_unknown");
		assertArm("connect.adapter_unknown", automaticEnvelope, {
			posture: "automatic",
			action: "change_input",
			legacy: "change_input",
		});

		// Operator arm: no deterministic correction → trusted registered handoff
		// choices only (R24/AE20).
		const operator = await runScenario(
			["connect", "no-such-adapter", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: neverWarmChrome,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(operator.exitCode).toBe(2);
		assertArm("connect.adapter_unknown", parseStdoutEnvelope(operator), {
			posture: "operator",
			choiceIds: [
				"choose_registered_adapter:chrome-devtools-mcp",
				"choose_registered_adapter:agent-browser",
			],
			legacy: "list_registered_adapters",
			constraintIncludes: ["no_synthesized_caller_input"],
		});
	},

	"connect.adapter_not_installed": async () => {
		// Automatic install: absent adapter with the committed isolated recipe
		// (real adapter-install manifests, file reads only).
		const install = await runScenario(
			["connect", "chrome-devtools-mcp", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([okStep()]),
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(install.exitCode).toBe(20);
		const installEnvelope = parseStdoutEnvelope(install);
		expect(installEnvelope.error?.code).toBe("adapter_not_installed");
		assertArm("connect.adapter_not_installed", installEnvelope, {
			posture: "automatic",
			action: "install_adapter",
			legacy: "install_adapter",
			constraintIncludes: ["no_pin_policy_change"],
		});

		// Automatic upgrade: exact allowlisted observed-to-pin transition (AE5).
		const upgrade = await runScenario(
			["connect", "chrome-devtools-mcp", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([okStep()]),
				adapterRuntime: fakeAdapterRuntime({
					version: { "chrome-devtools-mcp": "1.4.0" },
				}),
				...realRegistryAccessors(),
			},
		);
		expect(upgrade.exitCode).toBe(20);
		assertArm("connect.adapter_not_installed", parseStdoutEnvelope(upgrade), {
			posture: "automatic",
			action: "upgrade_adapter_to_pin",
			legacy: "upgrade_adapter_to_pin",
		});

		// Operator arm: lifecycle-script-bound adapter degrades to the manual
		// install choice (R29/AE18/AE19) with the non-mutating legacy stop.
		const manual = await runScenario(
			["connect", "agent-browser", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([okStep()]),
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(manual.exitCode).toBe(20);
		assertArm("connect.adapter_not_installed", parseStdoutEnvelope(manual), {
			posture: "operator",
			choiceIds: ["install_registered_adapter_manually:agent-browser"],
			legacy: "list_registered_adapters",
			constraintIncludes: ["no_pin_policy_change"],
		});

		// Operator arm: a non-allowlisted version decision stays operator-owned
		// (R21/R22).
		const pinDecision = await runScenario(
			["connect", "chrome-devtools-mcp", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([okStep()]),
				adapterRuntime: fakeAdapterRuntime({
					version: { "chrome-devtools-mcp": "1.6.0" },
				}),
				...realRegistryAccessors(),
			},
		);
		expect(pinDecision.exitCode).toBe(20);
		assertArm("connect.adapter_not_installed", parseStdoutEnvelope(pinDecision), {
			posture: "operator",
			choiceIds: ["adjust_adapter_pin"],
			legacy: "list_registered_adapters",
		});
	},

	"connect.route_incompatible": async () => {
		// A registered-id definition whose only implemented route the environment
		// does not offer; agent-browser stays the trusted implemented candidate.
		const uiOnly: AdapterDefinition = {
			...chromeDevtoolsMcpDefinition,
			routes: [{ route: "ui-consent", evidence: "documented", implemented: true }],
		};
		const run = await runScenario(
			["connect", "chrome-devtools-mcp", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([okStep()]),
				adapterRuntime: installedRuntime(),
				listAdapterDefinitions: () => [uiOnly, agentBrowserDefinition],
				findAdapterDefinition: (id) =>
					id === "chrome-devtools-mcp"
						? uiOnly
						: id === "agent-browser"
							? agentBrowserDefinition
							: undefined,
			},
		);
		expect(run.exitCode).toBe(20);
		const envelope = parseStdoutEnvelope(run);
		expect(envelope.error?.code).toBe("route_incompatible");
		assertArm("connect.route_incompatible", envelope, {
			posture: "operator",
			choiceIds: ["choose_registered_adapter:agent-browser"],
			legacy: "list_registered_adapters",
			constraintIncludes: ["no_adapter_fallback"],
		});
	},

	"connect.attachment_failed": async () => {
		const run = await runScenario(
			["connect", "agent-browser", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([okStep()]),
				adapterRuntime: fakeAdapterRuntime({
					version: {
						"agent-browser": PINNED["agent-browser"],
						"chrome-devtools-mcp": PINNED["chrome-devtools-mcp"],
					},
					probeExit: { "agent-browser": 1 },
				}),
				...realRegistryAccessors(),
			},
		);
		expect(run.exitCode).toBe(20);
		const envelope = parseStdoutEnvelope(run);
		expect(envelope.error?.code).toBe("attachment_failed");
		assertArm("connect.attachment_failed", envelope, {
			posture: "operator",
			choiceIds: ["inspect_attachment_probe"],
			legacy: "inspect_diagnostics",
			constraintIncludes: ["no_adapter_fallback", "no_mutation_from_diagnostics"],
		});
	},

	"run.preexec_connect_failed": async () => {
		// Inherited automatic posture (AE10): the underlying suggested-port repair
		// leads; resolve_connect_failure never does.
		const automatic = await runScenario(
			["run", "agent-browser", "--run-id", RUN_ID, "--", "tool"],
			{
				warmChromeMain: scriptedWarmChromeMain([occupiedStep(9333)]),
				adapterRuntime: installedRuntime(),
				...realRegistryAccessors(),
			},
		);
		expect(automatic.exitCode).toBe(20);
		expect(automatic.stdout).toBe("");
		const automaticEnvelope = parseLastStderrJson(automatic);
		expect(automaticEnvelope.error?.code).toBe("preexec_connect_failed");
		assertArm("run.preexec_connect_failed", automaticEnvelope, {
			posture: "automatic",
			action: "use_suggested_port",
			legacy: "use_suggested_port",
		});

		// Inherited operator posture: terminal listener inspection.
		const operator = await runScenario(
			["run", "agent-browser", "--run-id", RUN_ID, "--", "tool"],
			{
				warmChromeMain: scriptedWarmChromeMain([occupiedStep()]),
				adapterRuntime: installedRuntime(),
				...realRegistryAccessors(),
			},
		);
		expect(operator.exitCode).toBe(20);
		const operatorEnvelope = parseLastStderrJson(operator);
		expect(operatorEnvelope.error?.code).toBe("preexec_connect_failed");
		assertArm("run.preexec_connect_failed", operatorEnvelope, {
			posture: "operator",
			choiceIds: ["inspect_listener"],
			legacy: "inspect_listener",
		});
	},

	"run.wrapped_not_found": async () => {
		const spawnFailed: RunSpawner = async () => ({
			outcome: "spawn-failed",
			detail: "spawn no-such-binary ENOENT",
		});
		const operator = await runScenario(
			["run", "agent-browser", "--run-id", RUN_ID, "--", "no-such-binary"],
			{
				warmChromeMain: scriptedWarmChromeMain([okStep()]),
				adapterRuntime: installedRuntime(),
				...realRegistryAccessors(),
				runSpawner: spawnFailed,
			},
		);
		expect(operator.exitCode).toBe(127);
		const operatorEnvelope = parseLastStderrJson(operator);
		expect(operatorEnvelope.error?.code).toBe("wrapped_not_found");
		assertArm("run.wrapped_not_found", operatorEnvelope, {
			posture: "operator",
			choiceIds: ["fix_wrapped_command"],
			legacy: "change_input",
			constraintIncludes: ["no_synthesized_caller_input"],
		});

		// An unsafe wrapped-executable identity fails closed to diagnostics (R26):
		// no basename projection, no correction advice.
		const unsafe = await runScenario(
			["run", "agent-browser", "--run-id", RUN_ID, "--", "bad~~name!!"],
			{
				warmChromeMain: scriptedWarmChromeMain([okStep()]),
				adapterRuntime: installedRuntime(),
				...realRegistryAccessors(),
				runSpawner: spawnFailed,
			},
		);
		expect(unsafe.exitCode).toBe(127);
		const unsafeEnvelope = parseLastStderrJson(unsafe);
		assertArm("run.wrapped_not_found", unsafeEnvelope, {
			posture: "operator",
			// Unsafe executable identity degrades to diagnostics-only choices; the
			// legacy stop stays the class's non-mutating change_input (R30).
			choiceIds: ["inspect_diagnostics"],
			legacy: "change_input",
			constraintIncludes: [
				"no_synthesized_caller_input",
				"no_mutation_from_diagnostics",
			],
		});
		expect(unsafe.stderr).not.toContain("bad~~name!!");
	},

	"check.runtime_error": async () => {
		const run = await runScenario(["--json", "--run-id", RUN_ID], {
			warmChromeMain: neverWarmChrome,
			adapterRuntime: fakeAdapterRuntime({}),
			listAdapterDefinitions: () => {
				throw new Error("registry read failed unexpectedly");
			},
			findAdapterDefinition: () => undefined,
		});
		expect(run.exitCode).toBe(1);
		const envelope = parseStdoutEnvelope(run);
		expect(envelope.error?.code).toBe("runtime_error");
		assertArm("check.runtime_error", envelope, {
			posture: "operator",
			choiceIds: ["inspect_diagnostics"],
			legacy: "inspect_diagnostics",
			constraintIncludes: ["no_mutation_from_diagnostics"],
		});
	},

	"repair-adapter.operator_stop": async () => {
		// A non-allowlisted observed version makes --execute stop fail-closed
		// BEFORE any executor work (R22): zero network, zero mutation.
		const run = await runScenario(
			[
				"repair-adapter",
				"chrome-devtools-mcp",
				"--execute",
				"--json",
				"--run-id",
				RUN_ID,
			],
			{
				warmChromeMain: neverWarmChrome,
				adapterRuntime: fakeAdapterRuntime({
					version: { "chrome-devtools-mcp": "1.6.0" },
				}),
				...realRegistryAccessors(),
			},
		);
		expect(run.exitCode).toBe(20);
		const envelope = parseStdoutEnvelope(run);
		expect(envelope.error?.code).toBe("operator_stop");
		assertArm("repair-adapter.operator_stop", envelope, {
			posture: "operator",
			choiceIds: ["adjust_adapter_pin"],
			legacy: "list_registered_adapters",
			constraintIncludes: ["no_pin_policy_change"],
		});
	},
};

describe("recovery-expectation station arms (U4 R1/AE1)", () => {
	test("the arm-drive table covers every error station exactly once", () => {
		expect(Object.keys(stationArmDrives).toSorted()).toEqual(
			[...BROWSER_CONNECT_ERROR_STATION_IDS].toSorted(),
		);
	});

	for (const stationId of BROWSER_CONNECT_ERROR_STATION_IDS) {
		test(`station ${stationId} projects only map-declared recovery postures`, async () => {
			await stationArmDrives[stationId]();
		});
	}
});

// ===========================================================================
// U4 cause-to-repair matrix proof (R18/AE1): every typed environment, adapter,
// and run cause drives the PROJECTED envelope through the chokepoint —
// buildFailureEnvelopeParts — not just the pure selector. Each row asserts
// posture, action ordering, constraints, compatibility-only exclusions, and
// the legacy schema-1 data value, then round-trips the full facade envelope
// through JSON to prove the recovery fields serialize intact.
// ===========================================================================

const COMPLETE_INSTALL_EVIDENCE = {
	recipe_complete: true,
	lock_origins_canonical: true,
	dependency_integrity_complete: true,
	lifecycle_scripts_disabled: true,
} as const;

type ProjectionExpectation =
	| {
			posture: "automatic";
			action: BrowserConnectFailureActionId;
			legacy: BrowserConnectFailureActionId;
	  }
	| {
			posture: "operator";
			choiceIds: readonly string[];
			constraintIncludes: readonly string[];
			legacy: BrowserConnectFailureActionId;
	  };

type ProjectionMatrixRow = {
	name: string;
	cause: BrowserConnectRepairCause;
	invocation: BrowserConnectRepairInvocation;
	context: BrowserConnectRepairContext;
	expected: ProjectionExpectation;
};

const PROJECTION_MATRIX: readonly ProjectionMatrixRow[] = [
	{
		name: "usage_invalid deterministic → automatic change_input",
		cause: "usage_invalid",
		invocation: { command: "check", repair_chain_hop: 0 },
		context: {
			failure_class: "usage-invalid",
			cause: "usage_invalid",
			deterministic_correction: true,
		},
		expected: { posture: "automatic", action: "change_input", legacy: "change_input" },
	},
	{
		name: "usage_invalid without correction → operator input",
		cause: "usage_invalid",
		invocation: { command: "check", repair_chain_hop: 0 },
		context: {
			failure_class: "usage-invalid",
			cause: "usage_invalid",
			deterministic_correction: false,
		},
		expected: {
			posture: "operator",
			choiceIds: ["provide_corrected_input"],
			constraintIncludes: ["no_synthesized_caller_input"],
			legacy: "change_input",
		},
	},
	{
		name: "separator_missing with parser-memory command → automatic add_run_separator",
		cause: "separator_missing",
		invocation: { command: "run", repair_chain_hop: 0 },
		context: {
			failure_class: "run-missing-separator",
			cause: "separator_missing",
			wrapped_command_present: true,
		},
		expected: {
			posture: "automatic",
			action: "add_run_separator",
			legacy: "add_run_separator",
		},
	},
	{
		name: "separator_missing without command → operator wrapped-command input",
		cause: "separator_missing",
		invocation: { command: "run", repair_chain_hop: 0 },
		context: {
			failure_class: "run-missing-separator",
			cause: "separator_missing",
			wrapped_command_present: false,
		},
		expected: {
			posture: "operator",
			choiceIds: ["provide_wrapped_command"],
			constraintIncludes: ["no_synthesized_caller_input"],
			legacy: "change_input",
		},
	},
	{
		name: "wrapped_command_missing → operator wrapped-command input",
		cause: "wrapped_command_missing",
		invocation: { command: "run", repair_chain_hop: 0 },
		context: {
			failure_class: "run-missing-separator",
			cause: "wrapped_command_missing",
		},
		expected: {
			posture: "operator",
			choiceIds: ["provide_wrapped_command"],
			constraintIncludes: ["no_synthesized_caller_input"],
			legacy: "change_input",
		},
	},
	{
		name: "no_listener with free port at hop 0 → automatic launch_agent_chrome",
		cause: "no_listener",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "environment-absent",
			cause: "no_listener",
			explicit_port_free: true,
		},
		expected: {
			posture: "automatic",
			action: "launch_agent_chrome",
			legacy: "launch_agent_chrome",
		},
	},
	{
		name: "no_listener at hop 1 → operator diagnostics (no relaunch loop)",
		cause: "no_listener",
		invocation: { command: "connect", repair_chain_hop: 1 },
		context: {
			failure_class: "environment-absent",
			cause: "no_listener",
			explicit_port_free: true,
		},
		expected: {
			posture: "operator",
			choiceIds: ["inspect_diagnostics"],
			constraintIncludes: ["no_cross_invocation_retry", "no_adapter_fallback"],
			legacy: "inspect_diagnostics",
		},
	},
	{
		name: "no_listener without free-port proof → operator diagnostics",
		cause: "no_listener",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "environment-absent",
			cause: "no_listener",
			explicit_port_free: false,
		},
		expected: {
			posture: "operator",
			choiceIds: ["inspect_diagnostics"],
			constraintIncludes: ["no_process_destruction"],
			legacy: "inspect_diagnostics",
		},
	},
	{
		name: "transient_proof_failure after the bounded recheck → operator, retry exhausted",
		cause: "transient_proof_failure",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "environment-absent",
			cause: "transient_proof_failure",
			recheck_attempted: true,
		},
		expected: {
			posture: "operator",
			choiceIds: ["inspect_diagnostics"],
			constraintIncludes: ["no_cross_invocation_retry"],
			legacy: "inspect_diagnostics",
		},
	},
	{
		name: "occupied_listener with verified suggestion at connect hop 0 → automatic use_suggested_port",
		cause: "occupied_listener",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "foreign-listener",
			cause: "occupied_listener",
			suggested_explicit_port: { port: 9333, verified_free: true },
		},
		expected: {
			posture: "automatic",
			action: "use_suggested_port",
			legacy: "use_suggested_port",
		},
	},
	{
		name: "occupied_listener with suggestion on check → operator listener inspection",
		cause: "occupied_listener",
		invocation: { command: "check", repair_chain_hop: 0 },
		context: {
			failure_class: "foreign-listener",
			cause: "occupied_listener",
			suggested_explicit_port: { port: 9333, verified_free: true },
		},
		expected: {
			posture: "operator",
			choiceIds: ["inspect_listener"],
			constraintIncludes: [
				"no_internal_port_switch",
				"no_unverified_listener_connection",
			],
			legacy: "inspect_listener",
		},
	},
	{
		name: "occupied_listener at hop 1 → operator; never a second suggested-port action",
		cause: "occupied_listener",
		invocation: { command: "connect", repair_chain_hop: 1 },
		context: {
			failure_class: "foreign-listener",
			cause: "occupied_listener",
			suggested_explicit_port: { port: 9444, verified_free: true },
		},
		expected: {
			posture: "operator",
			choiceIds: ["inspect_listener"],
			constraintIncludes: ["no_cross_invocation_retry"],
			legacy: "inspect_listener",
		},
	},
	{
		name: "foreign_listener without suggestion → terminal operator inspection",
		cause: "foreign_listener",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: { failure_class: "foreign-listener", cause: "foreign_listener" },
		expected: {
			posture: "operator",
			choiceIds: ["inspect_listener"],
			constraintIncludes: ["no_process_destruction"],
			legacy: "inspect_listener",
		},
	},
	{
		name: "unverified_listener with a stale suggestion → operator inspection",
		cause: "unverified_listener",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "foreign-listener",
			cause: "unverified_listener",
			suggested_explicit_port: { port: 9333, verified_free: false },
		},
		expected: {
			posture: "operator",
			choiceIds: ["inspect_listener"],
			constraintIncludes: ["no_unverified_listener_connection"],
			legacy: "inspect_listener",
		},
	},
	{
		name: "launch_failed → operator diagnostics",
		cause: "launch_failed",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: { failure_class: "launch-failed", cause: "launch_failed" },
		expected: {
			posture: "operator",
			choiceIds: ["inspect_diagnostics"],
			constraintIncludes: ["no_adapter_fallback"],
			legacy: "inspect_diagnostics",
		},
	},
	{
		name: "unregistered_adapter with deterministic replacement → automatic change_input",
		cause: "unregistered_adapter",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "adapter-unknown",
			cause: "unregistered_adapter",
			candidate_adapter_ids: ["chrome-devtools-mcp", "agent-browser"],
			deterministic_replacement_adapter_id: "agent-browser",
		},
		expected: { posture: "automatic", action: "change_input", legacy: "change_input" },
	},
	{
		name: "unregistered_adapter without replacement → operator registered handoff",
		cause: "unregistered_adapter",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "adapter-unknown",
			cause: "unregistered_adapter",
			candidate_adapter_ids: ["chrome-devtools-mcp", "agent-browser"],
		},
		expected: {
			posture: "operator",
			choiceIds: [
				"choose_registered_adapter:chrome-devtools-mcp",
				"choose_registered_adapter:agent-browser",
			],
			constraintIncludes: ["no_synthesized_caller_input"],
			legacy: "list_registered_adapters",
		},
	},
	{
		name: "executable_absent with complete isolated evidence → automatic install_adapter",
		cause: "executable_absent",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "adapter-not-installed",
			cause: "executable_absent",
			adapter_id: "chrome-devtools-mcp",
			manual_install_inputs_complete: true,
			automatic_install: COMPLETE_INSTALL_EVIDENCE,
		},
		expected: {
			posture: "automatic",
			action: "install_adapter",
			legacy: "install_adapter",
		},
	},
	{
		name: "executable_absent with manual inputs only → operator manual install",
		cause: "executable_absent",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "adapter-not-installed",
			cause: "executable_absent",
			adapter_id: "agent-browser",
			manual_install_inputs_complete: true,
			automatic_install: {
				...COMPLETE_INSTALL_EVIDENCE,
				lifecycle_scripts_disabled: false,
			},
		},
		expected: {
			posture: "operator",
			choiceIds: ["install_registered_adapter_manually:agent-browser"],
			constraintIncludes: ["no_pin_policy_change"],
			legacy: "list_registered_adapters",
		},
	},
	{
		name: "executable_absent without trusted inputs → operator definition review",
		cause: "executable_absent",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "adapter-not-installed",
			cause: "executable_absent",
			adapter_id: "agent-browser",
			manual_install_inputs_complete: false,
		},
		expected: {
			posture: "operator",
			choiceIds: ["review_adapter_definition:agent-browser"],
			constraintIncludes: ["no_pin_policy_change"],
			legacy: "list_registered_adapters",
		},
	},
	{
		name: "version_mismatch with allowlisted transition → automatic upgrade_adapter_to_pin",
		cause: "version_mismatch",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "adapter-not-installed",
			cause: "version_mismatch",
			adapter_id: "agent-browser",
			observed_version: "0.26.0",
			pinned_version: "0.31.2",
			transition_allowlisted: true,
			automatic_install: COMPLETE_INSTALL_EVIDENCE,
		},
		expected: {
			posture: "automatic",
			action: "upgrade_adapter_to_pin",
			legacy: "upgrade_adapter_to_pin",
		},
	},
	{
		name: "version_mismatch without allowlisted transition → operator pin decision",
		cause: "version_mismatch",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "adapter-not-installed",
			cause: "version_mismatch",
			adapter_id: "chrome-devtools-mcp",
			observed_version: "1.6.0",
			pinned_version: "1.5.0",
			transition_allowlisted: false,
			automatic_install: COMPLETE_INSTALL_EVIDENCE,
		},
		expected: {
			posture: "operator",
			choiceIds: ["adjust_adapter_pin"],
			constraintIncludes: ["no_pin_policy_change"],
			legacy: "list_registered_adapters",
		},
	},
	{
		name: "route_unsupported with trusted candidates → operator adapter handoff",
		cause: "route_unsupported",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "route-incompatible",
			cause: "route_unsupported",
			candidate_adapter_ids: ["agent-browser"],
		},
		expected: {
			posture: "operator",
			choiceIds: ["choose_registered_adapter:agent-browser"],
			constraintIncludes: ["no_adapter_fallback"],
			legacy: "list_registered_adapters",
		},
	},
	{
		name: "transient_probe_failure after the bounded re-probe → operator, retry exhausted",
		cause: "transient_probe_failure",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: {
			failure_class: "attachment-failed",
			cause: "transient_probe_failure",
			re_probe_attempted: true,
		},
		expected: {
			posture: "operator",
			choiceIds: ["inspect_attachment_probe"],
			constraintIncludes: ["no_cross_invocation_retry"],
			legacy: "inspect_diagnostics",
		},
	},
	{
		name: "probe_failed → operator attachment inspection",
		cause: "probe_failed",
		invocation: { command: "connect", repair_chain_hop: 0 },
		context: { failure_class: "attachment-failed", cause: "probe_failed" },
		expected: {
			posture: "operator",
			choiceIds: ["inspect_attachment_probe"],
			constraintIncludes: ["no_adapter_fallback"],
			legacy: "inspect_diagnostics",
		},
	},
	{
		name: "preexec_connect_failure inherits the underlying automatic action (AE10)",
		cause: "preexec_connect_failure",
		invocation: { command: "run", repair_chain_hop: 0 },
		context: {
			failure_class: "preexec-connect-failed",
			cause: "preexec_connect_failure",
			underlying: {
				failure_class: "environment-absent",
				cause: "no_listener",
				explicit_port_free: true,
			},
		},
		expected: {
			posture: "automatic",
			action: "launch_agent_chrome",
			legacy: "launch_agent_chrome",
		},
	},
	{
		name: "preexec_connect_failure inherits the underlying operator posture (AE10)",
		cause: "preexec_connect_failure",
		invocation: { command: "run", repair_chain_hop: 0 },
		context: {
			failure_class: "preexec-connect-failed",
			cause: "preexec_connect_failure",
			underlying: { failure_class: "attachment-failed", cause: "probe_failed" },
		},
		expected: {
			posture: "operator",
			choiceIds: ["inspect_attachment_probe"],
			constraintIncludes: ["no_adapter_fallback"],
			legacy: "inspect_diagnostics",
		},
	},
	{
		name: "wrapped_executable_absent with deterministic correction → automatic fix_wrapped_command",
		cause: "wrapped_executable_absent",
		invocation: { command: "run", repair_chain_hop: 0 },
		context: {
			failure_class: "wrapped-command-not-found",
			cause: "wrapped_executable_absent",
			deterministic_correction: true,
			executable_basename: "agent-browser",
		},
		expected: {
			posture: "automatic",
			action: "fix_wrapped_command",
			legacy: "fix_wrapped_command",
		},
	},
	{
		name: "wrapped_executable_absent without correction → operator fix choice",
		cause: "wrapped_executable_absent",
		invocation: { command: "run", repair_chain_hop: 0 },
		context: {
			failure_class: "wrapped-command-not-found",
			cause: "wrapped_executable_absent",
			deterministic_correction: false,
			executable_basename: "credential-tool",
		},
		expected: {
			posture: "operator",
			choiceIds: ["fix_wrapped_command"],
			constraintIncludes: ["no_synthesized_caller_input"],
			legacy: "change_input",
		},
	},
	{
		name: "wrapped_executable_absent with unsafe identity → operator diagnostics (R26)",
		cause: "wrapped_executable_absent",
		invocation: { command: "run", repair_chain_hop: 0 },
		context: {
			failure_class: "wrapped-command-not-found",
			cause: "wrapped_executable_absent",
			deterministic_correction: true,
			executable_basename: "bad name$(rm)",
		},
		expected: {
			posture: "operator",
			choiceIds: ["inspect_diagnostics"],
			constraintIncludes: ["no_mutation_from_diagnostics"],
			legacy: "change_input",
		},
	},
	{
		name: "unexpected_runtime_error → operator diagnostics",
		cause: "unexpected_runtime_error",
		invocation: { command: "check", repair_chain_hop: 0 },
		context: {
			failure_class: "runtime-error-unexpected",
			cause: "unexpected_runtime_error",
		},
		expected: {
			posture: "operator",
			choiceIds: ["inspect_diagnostics"],
			constraintIncludes: ["no_mutation_from_diagnostics"],
			legacy: "inspect_diagnostics",
		},
	},
];

/** REPAIR.md headings (`## v1-<action>`), parsed once for fragment proofs. */
const REPAIR_MD_HEADINGS = new Set(
	[...readFileSync(new URL("../REPAIR.md", import.meta.url), "utf8").matchAll(
		/^## (v\d+-[a-z_]+)$/gm,
	)].map((match) => match[1]),
);

function expectResolvableDocsUrl(docsUrl: unknown): void {
	expect(typeof docsUrl).toBe("string");
	const url = String(docsUrl);
	expect(url.startsWith(`${BROWSER_CONNECT_REPAIR_DOCS_BASE_URL}#`)).toBe(true);
	const fragment = url.split("#")[1];
	expect(REPAIR_MD_HEADINGS.has(String(fragment)), `fragment ${fragment}`).toBe(
		true,
	);
}

describe("cause-to-repair matrix drives the projected envelope (U4 R18)", () => {
	test("the matrix covers every typed repair cause (R18)", () => {
		const covered = new Set(PROJECTION_MATRIX.map((row) => row.cause));
		expect([...covered].toSorted()).toEqual(
			[...BROWSER_CONNECT_REPAIR_CAUSES].toSorted(),
		);
	});

	for (const row of PROJECTION_MATRIX) {
		test(row.name, () => {
			const parts = buildFailureEnvelopeParts({
				command: row.invocation.command,
				failureClass: row.context.failure_class,
				safeMessage: "matrix probe detail.",
				repairContext: row.context,
				repairChainHop: row.invocation.repair_chain_hop,
			});

			// Projection fidelity: the chokepoint projects the pure selector's
			// stage verbatim — posture, ordering, constraints, choices.
			const stage = selectBrowserConnectRepairPath(row.invocation, row.context);
			expect(parts.stage).toEqual(stage);
			expect(parts.continuation).toEqual(stage.continuation);
			expect(parts.actionId).toBe(
				selectBrowserConnectLegacyNextAction({ context: row.context, stage }),
			);

			// Row expectation: posture, action/choices, constraints, legacy value.
			expect(parts.actionId).toBe(row.expected.legacy);
			if (row.expected.posture === "automatic") {
				expect(parts.stage.posture).toBe("automatic");
				expect(parts.continuation.next_action_id).toBe(row.expected.action);
				expect(parts.runtimeActions.map((action) => action.id)).toEqual([
					row.expected.action,
				]);
				expectResolvableDocsUrl(parts.runtimeActions[0]?.docs_url);
			} else {
				expect(parts.stage.posture).toBe("operator");
				expect(parts.continuation.requires_operator).toBe(true);
				expect(parts.continuation.next_action_id).toBeUndefined();
				expect(parts.runtimeActions).toEqual([]);
				expect(
					(parts.continuation.choices ?? []).map((choice) => choice.id),
				).toEqual([...row.expected.choiceIds]);
				const constraintIds = (parts.continuation.constraints ?? []).map(
					(constraint) => constraint.id,
				);
				expect(constraintIds.length).toBeGreaterThan(0);
				for (const constraintId of row.expected.constraintIncludes) {
					expect(constraintIds).toContain(constraintId);
				}
				for (const choice of parts.continuation.choices ?? []) {
					expectResolvableDocsUrl(choice.docs_url);
				}
			}

			// Compatibility-only exclusion (R20): never the outer next action.
			for (const compatibilityOnly of BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS) {
				expect(parts.continuation.next_action_id).not.toBe(compatibilityOnly);
			}

			// Legacy compatibility data (R16/R30): required, released-schema shaped.
			const data = parts.data as unknown as Record<string, unknown>;
			expect(data.next_action_id).toBe(row.expected.legacy);
			expect(data.failure_class).toBe(row.context.failure_class);
			expect(data.schema_version).toBe("2");
		});
	}
});

describe("projection serialization proofs (U4 R3/R14/R26)", () => {
	function serializedEnvelope(row: ProjectionMatrixRow): {
		parts: ReturnType<typeof buildFailureEnvelopeParts>;
		json: string;
		parsed: Record<string, unknown>;
	} {
		const parts = buildFailureEnvelopeParts({
			command: row.invocation.command,
			failureClass: row.context.failure_class,
			safeMessage: "serialization probe detail.",
			repairContext: row.context,
			repairChainHop: row.invocation.repair_chain_hop,
		});
		const envelope = createCliRuntimeErrorEnvelope({
			run_id: RUN_ID,
			process_exit_code: parts.exitCode,
			error: createCliRuntimeError({
				run_id: RUN_ID,
				code: parts.branchId,
				message: "serialization probe detail.",
				exit_code: parts.exitCode,
				severity: "error",
				recoverability: "none",
				retryable: false,
			}),
			data: parts.data,
			...(parts.runtimeActions.length > 0
				? { runtime_actions: parts.runtimeActions }
				: {}),
			continuation: parts.continuation,
		});
		const json = JSON.stringify(envelope);
		return { parts, json, parsed: JSON.parse(json) as Record<string, unknown> };
	}

	test("every matrix row serializes a facade-valid envelope preserving recovery fields", () => {
		for (const row of PROJECTION_MATRIX) {
			const { parts, parsed } = serializedEnvelope(row);
			const continuation = parsed.continuation as Record<string, unknown>;
			expect(continuation).toEqual(
				JSON.parse(JSON.stringify(parts.continuation)) as Record<
					string,
					unknown
				>,
			);
			const data = parsed.data as Record<string, unknown>;
			expect(data.next_action_id).toBe(parts.actionId);
			if (parts.stage.posture === "automatic") {
				expect(parsed.runtime_actions).toEqual(
					JSON.parse(JSON.stringify(parts.runtimeActions)),
				);
			} else {
				expect(parsed.runtime_actions).toBeUndefined();
				expect(continuation.requires_operator).toBe(true);
				expect(
					(continuation.constraints as unknown[] | undefined)?.length ?? 0,
				).toBeGreaterThan(0);
			}
		}
	});

	test("every projected summary and label passes text safety unchanged (R2)", () => {
		for (const row of PROJECTION_MATRIX) {
			const parts = buildFailureEnvelopeParts({
				command: row.invocation.command,
				failureClass: row.context.failure_class,
				safeMessage: "text safety probe.",
				repairContext: row.context,
				repairChainHop: row.invocation.repair_chain_hop,
			});
			const texts: string[] = [];
			for (const action of parts.runtimeActions) texts.push(action.summary);
			for (const constraint of parts.continuation.constraints ?? []) {
				texts.push(constraint.summary);
			}
			for (const choice of parts.continuation.choices ?? []) {
				texts.push(choice.label, choice.summary);
			}
			for (const text of texts) {
				expect(redactBrowserConnectText(text)).toBe(text);
				assertNoRuntimeContractFixtureLeaks(text);
			}
		}
	});

	test("suggested-port evidence serializes as typed envelope data: hop-0 carried, hop-1 and unusable omitted (R6/R23/KTD20)", () => {
		const findRow = (
			predicate: (row: ProjectionMatrixRow) => boolean,
		): ProjectionMatrixRow => {
			const row = PROJECTION_MATRIX.find(predicate);
			if (!row) throw new Error("expected matrix row not found");
			return row;
		};
		const evidenceOf = (
			parsed: Record<string, unknown>,
		): { port: number; verified_free: boolean } | undefined =>
			(parsed.data as Record<string, unknown>).suggested_explicit_port as
				| { port: number; verified_free: boolean }
				| undefined;

		// The automatic occupied+suggestion arm: a headless driver can build the
		// hop-1 rerun from data alone — the port never lives only in a stderr
		// diagnostic.
		const automatic = serializedEnvelope(
			findRow(
				(row) =>
					row.cause === "occupied_listener" &&
					row.invocation.command === "connect" &&
					row.invocation.repair_chain_hop === 0,
			),
		);
		expect(automatic.parts.continuation.next_action_id).toBe(
			"use_suggested_port",
		);
		expect(evidenceOf(automatic.parsed)).toEqual({
			port: 9333,
			verified_free: true,
		});

		// check preserves the evidence WITHOUT an automatic continuation
		// (R6/KTD20): diagnostic posture, evidence intact.
		const check = serializedEnvelope(
			findRow(
				(row) =>
					row.cause === "occupied_listener" &&
					row.invocation.command === "check",
			),
		);
		expect(evidenceOf(check.parsed)).toEqual({ port: 9333, verified_free: true });
		const checkContinuation = check.parsed.continuation as Record<string, unknown>;
		expect(checkContinuation.next_action_id).toBeUndefined();
		expect(checkContinuation.requires_operator).toBe(true);

		// Hop 1 never re-advertises a port (the one-hop budget is spent, R23).
		const hopOne = serializedEnvelope(
			findRow(
				(row) =>
					row.cause === "occupied_listener" &&
					row.invocation.repair_chain_hop === 1,
			),
		);
		expect(evidenceOf(hopOne.parsed)).toBeUndefined();

		// Absent and unverified (stale) suggestions are omitted.
		const absent = serializedEnvelope(
			findRow((row) => row.cause === "foreign_listener"),
		);
		expect(evidenceOf(absent.parsed)).toBeUndefined();
		const stale = serializedEnvelope(
			findRow((row) => row.cause === "unverified_listener"),
		);
		expect(evidenceOf(stale.parsed)).toBeUndefined();
	});

	test("run repair privacy: no wrapped argv, basename, or marker field serializes (R26/AE14)", () => {
		const privacyRows = PROJECTION_MATRIX.filter(
			(row) =>
				row.context.failure_class === "run-missing-separator" ||
				row.context.failure_class === "wrapped-command-not-found",
		);
		expect(privacyRows.length).toBeGreaterThan(0);
		for (const row of privacyRows) {
			const { json } = serializedEnvelope(row);
			// The typed context fields stay in memory: neither the parser-memory
			// marker nor the normalized basename reaches serialized output.
			expect(json).not.toContain("wrapped_command_present");
			expect(json).not.toContain("executable_basename");
			expect(json).not.toContain("credential-tool");
			expect(json).not.toContain("bad name$(rm)");
		}
	});

	test("wrapped-command non-projection: pre-exec rows inherit without resolve_connect_failure (R20/AE10)", () => {
		const preexecRows = PROJECTION_MATRIX.filter(
			(row) => row.cause === "preexec_connect_failure",
		);
		expect(preexecRows.length).toBeGreaterThan(0);
		for (const row of preexecRows) {
			const { parsed } = serializedEnvelope(row);
			const continuation = parsed.continuation as Record<string, unknown>;
			expect(continuation.next_action_id).not.toBe("resolve_connect_failure");
			const data = parsed.data as Record<string, unknown>;
			expect(data.next_action_id).not.toBe("resolve_connect_failure");
		}
	});

	test("every emitted docs fragment resolves to a REPAIR.md heading (R14/AE7)", () => {
		expect(REPAIR_MD_HEADINGS.size).toBeGreaterThanOrEqual(15);
		for (const row of PROJECTION_MATRIX) {
			const parts = buildFailureEnvelopeParts({
				command: row.invocation.command,
				failureClass: row.context.failure_class,
				safeMessage: "docs probe.",
				repairContext: row.context,
				repairChainHop: row.invocation.repair_chain_hop,
			});
			for (const action of parts.runtimeActions) {
				expectResolvableDocsUrl(action.docs_url);
			}
			for (const choice of parts.continuation.choices ?? []) {
				expectResolvableDocsUrl(choice.docs_url);
			}
		}
	});
});
