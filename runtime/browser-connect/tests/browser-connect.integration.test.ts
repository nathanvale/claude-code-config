import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertStationEnvelope,
	buildSkippedStationEvidence,
	buildStationEvidence,
	type CliProcessResult,
	describeCliProcessRun,
	runCliProcess,
	type StationRuntimeEnvelope,
	type StationScenario,
} from "@side-quest/cli-command-facade/testing";
import type {
	BranchStation,
	BranchStationEvidence,
} from "@side-quest/cli-command-facade";
import {
	createCleanupRegistry,
	drainCleanup,
	type FixtureServerHandle,
	makeTempDir,
	startFixtureServer,
} from "@side-quest/cli-test-fixtures";
import {
	type BrowserConnectStationId,
	browserConnectBranchStationCatalog,
	findBrowserConnectBranchStationCatalogDrift,
	projectBrowserConnectStationMap,
} from "../src/branch-station-catalog.ts";
import { chromeDevtoolsMcpDefinition } from "../src/adapters/chrome-devtools-mcp.ts";
import {
	browserConnectRecoveryExpectations,
	type BrowserConnectErrorStationId,
} from "../src/recovery-expectations.ts";

// ===========================================================================
// U8 catalog-driven integration proof (R11/R12/R14 at the process boundary;
// KTD6). Every one of the nineteen Branch Stations is proven through a REAL
// `browser-connect` process spawn or skipped WITH a recorded rationale. A
// `Record<BrowserConnectStationId, StationScenario>` keyed on the catalog's
// union type makes scenario-map coverage exhaustive at COMPILE time — a missing
// or stray key is a type error, not a runtime surprise.
//
// The environment-seam split (doc-review decision 2026-07-14) is authoritative:
//
// - Gateway stations (verified / launched / launch-failed and every station
//   that first needs a VERIFIED Agent Chrome behind the prove-or-launch gate):
//   warm-chrome is consumed IN-PROCESS (KTD2) and its runtime pins the REAL
//   Chrome app-binary path, so it cannot be faked as a binary at the process
//   boundary and a verified environment cannot be synthesized without a real
//   Agent Chrome. These are proven in-process by U4 (gateway) and U6/U7
//   (dispatcher + run wrapper) unit tests with injected deps and captured
//   writers, and end-to-end by the Verification Contract live smoke. Here they
//   are `buildSkippedStationEvidence` with that rationale.
//
// - Foreign-listener stations reach warm-chrome's REAL proof at the process
//   boundary via endpoint passthrough: `WARM_CHROME_CDP_PORT` points warm-chrome
//   at a `startFixtureServer` listener. The fixture answers `/json/version` but
//   is not an inspectable Google Chrome process, so warm-chrome's proof rejects
//   its identity and fails closed (exit 20, `port_occupied_foreign` →
//   browser-connect `foreign-listener`).
//
// - Pre-environment stations (usage-invalid, run-missing-separator,
//   adapter-unknown) fail BEFORE any environment work and are proven directly
//   with a real spawn.
// ===========================================================================

const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RUN_ID = "u8-integration";
const SPAWN_TIMEOUT_MS = 20_000;

// -- Cleanup --

const registry = createCleanupRegistry();

afterEach(() => {
	drainCleanup(registry);
});

// -- Process runner: the REAL browser-connect entrypoint, package-cwd, --silent
// parity with the root warm-chrome spawn. Each scenario gets its own env so the
// WARM_CHROME_CDP_PORT passthrough never leaks across rows. --

type BrowserConnectRunOptions = {
	label: string;
	env?: Record<string, string>;
};

async function runBrowserConnect(
	args: readonly string[],
	options: BrowserConnectRunOptions,
): Promise<CliProcessResult> {
	return runCliProcess({
		label: options.label,
		argv: [process.execPath, CLI_PATH, ...args],
		cwd: PACKAGE_ROOT,
		timeoutMs: SPAWN_TIMEOUT_MS,
		// Each scenario owns its env; only the rows that need it set
		// WARM_CHROME_CDP_PORT, and each binds a fresh ephemeral fixture port.
		env: { ...process.env, ...(options.env ?? {}) },
	});
}

// -- Foreign-listener fixture: a bare /json/version responder that is NOT an
// inspectable Google Chrome process. warm-chrome's real proof answers the
// round-trip but then fails to resolve an inspectable local Chrome listener that
// owns the port, so it rejects the identity and fails closed (exit 20,
// port_occupied_foreign → browser-connect foreign-listener). Each call binds its
// OWN ephemeral port (Bun.serve port:0) and is torn down in afterEach — no
// cross-test port contention. --

function startForeignCdpListener(): FixtureServerHandle {
	const handle = startFixtureServer(registry, (req: Request) => {
		const path = new URL(req.url).pathname;
		if (path === "/json/version") {
			const body = JSON.stringify({
				Browser: "Chrome/150.0.0.0",
				"Protocol-Version": "1.3",
				"User-Agent": "Mozilla/5.0 (Macintosh) Chrome/150.0.0.0",
				webSocketDebuggerUrl: `ws://127.0.0.1:${handle.port}/devtools/browser/foreign`,
			});
			return new Response(body, {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return new Response("{}", {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	});
	return handle;
}

// -- Assertion helper: assert a failure station and record the covered evidence.
// --

function assertFailureStation(
	station: BranchStation,
	result: CliProcessResult,
	envelope: StationRuntimeEnvelope,
): void {
	if (station.expectedActionId) {
		expect(
			(envelope.data as Record<string, unknown> | undefined)?.next_action_id,
			describeCliProcessRun(result),
		).toBe(station.expectedActionId);
	}
}

// ===========================================================================
// Real-spawn scenarios: pre-environment stations (fail before any env work).
// ===========================================================================

async function runUsageInvalid(
	station: BranchStation,
): Promise<BranchStationEvidence> {
	// An unknown command is a usage-class rejection before any environment read.
	const result = await runBrowserConnect(
		["definitely-not-a-command", "--json", "--run-id", RUN_ID],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	assertFailureStation(station, result, envelope);
	return buildStationEvidence(station, result, envelope);
}

async function runAdapterUnknown(
	station: BranchStation,
): Promise<BranchStationEvidence> {
	// An unknown adapter is rejected BEFORE any environment prove/launch (R7):
	// exit 2, adapter_unknown, list_registered_adapters. No warm-chrome env.
	const result = await runBrowserConnect(
		["connect", "no-such-adapter", "--json", "--run-id", RUN_ID],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	assertFailureStation(station, result, envelope);
	return buildStationEvidence(station, result, envelope);
}

async function runMissingSeparator(
	station: BranchStation,
): Promise<BranchStationEvidence> {
	// `run` with no `--` but a wrapped command preserved only in parser memory
	// is a pure parse failure (exit 2) that projects the AUTOMATIC
	// add_run_separator repair (U4/AE6). KTD5: run's failure envelope is on
	// STDERR — stdout belongs to the wrapped command end-to-end — so stdout
	// stays empty and the envelope is the last JSON line on stderr.
	const result = await runBrowserConnect(
		["run", "agent-browser", "wrapped-tool", "wrapped-arg", "--run-id", RUN_ID],
		{ label: station.id },
	);
	expect(result.exitCode, describeCliProcessRun(result)).toBe(
		station.expectedExitCode ?? null,
	);
	expect(result.stdout, describeCliProcessRun(result)).toBe("");
	const envelope = parseLastStderrJson(result);
	expect(envelope.status, describeCliProcessRun(result)).toBe(
		station.expectedEnvelopeStatus,
	);
	expect(envelope.error?.code, describeCliProcessRun(result)).toBe(
		station.expectedErrorCode,
	);
	expect(
		(envelope.data as Record<string, unknown> | undefined)?.next_action_id,
		describeCliProcessRun(result),
	).toBe(station.expectedActionId);
	// U4 serialization proof: process-boundary JSON preserves the projected
	// automatic recovery fields (runtime_actions, one next action, docs url).
	expect(
		envelope.continuation?.next_action_id,
		describeCliProcessRun(result),
	).toBe("add_run_separator");
	expect(
		envelope.runtime_actions?.map((action) => action.id),
		describeCliProcessRun(result),
	).toEqual(["add_run_separator"]);
	expect(String(envelope.runtime_actions?.[0]?.docs_url)).toContain(
		"#v1-add_run_separator",
	);
	// R26 at the process boundary: the wrapped words never serialize.
	expect(result.stderr, describeCliProcessRun(result)).not.toContain(
		"wrapped-tool",
	);
	expect(result.stderr, describeCliProcessRun(result)).not.toContain(
		"wrapped-arg",
	);
	// Stdout-channel evidence: assertStationEnvelope parses stdout, but this
	// station emits on stderr, so hand-build the covered evidence from the
	// stderr envelope with the station's declared expectations.
	return {
		stationId: station.id,
		status: "covered",
		...(result.exitCode !== null ? { observedExitCode: result.exitCode } : {}),
		...(envelope.status ? { observedEnvelopeStatus: envelope.status } : {}),
		...(station.expectedResultContractId
			? { observedResultContractId: station.expectedResultContractId }
			: {}),
		...(envelope.error?.code ? { observedErrorCode: envelope.error.code } : {}),
	};
}

/**
 * Station envelope plus the U4 recovery fields the process-boundary
 * serialization proofs assert (runtime_actions, continuation, choices,
 * constraints, docs urls).
 */
type RecoveryEnvelope = StationRuntimeEnvelope & {
	runtime_actions?: Array<{ id?: string; docs_url?: string }>;
	continuation?: {
		next_action_id?: string;
		requires_operator?: boolean;
		constraints?: Array<{ id?: string; summary?: string }>;
		choices?: Array<{ id?: string; docs_url?: string }>;
	};
};

function parseLastStderrJson(result: CliProcessResult): RecoveryEnvelope {
	const line = result.stderr
		.trim()
		.split("\n")
		.filter((l) => l.startsWith("{"))
		.at(-1);
	if (!line) {
		throw new Error(
			`No JSON line on stderr:\n${describeCliProcessRun(result)}`,
		);
	}
	return JSON.parse(line) as RecoveryEnvelope;
}

// ===========================================================================
// Real-spawn scenarios: foreign-listener stations (warm-chrome's REAL proof at
// the process boundary via WARM_CHROME_CDP_PORT endpoint passthrough). browser-
// connect's production path calls warm-chrome's real main in-process; pointing it
// at a fixture listener that answers /json/version but is not an inspectable
// Chrome makes the real proof fail closed (exit 20). No real Chrome needed.
// ===========================================================================

async function runCheckForeignListener(
	station: BranchStation,
): Promise<BranchStationEvidence> {
	const listener = startForeignCdpListener();
	const result = await runBrowserConnect(
		["check", "--json", "--run-id", RUN_ID],
		{ label: station.id, env: { WARM_CHROME_CDP_PORT: String(listener.port) } },
	);
	const envelope = assertStationEnvelope(station, result) as RecoveryEnvelope;
	assertFailureStation(station, result, envelope);
	// U4 serialization proof (operator posture): process-boundary JSON
	// preserves requires_operator, package choices, constraints, docs urls, and
	// the legacy data value; check never projects a suggested-port continuation
	// (KTD20).
	expect(
		envelope.continuation?.requires_operator,
		describeCliProcessRun(result),
	).toBe(true);
	expect(
		envelope.continuation?.next_action_id,
		describeCliProcessRun(result),
	).toBeUndefined();
	expect(
		envelope.continuation?.choices?.map((choice) => choice.id),
		describeCliProcessRun(result),
	).toEqual(["inspect_listener"]);
	expect(String(envelope.continuation?.choices?.[0]?.docs_url)).toContain(
		"#v1-inspect_listener",
	);
	const constraintIds = (envelope.continuation?.constraints ?? []).map(
		(constraint) => constraint.id,
	);
	expect(constraintIds.length, describeCliProcessRun(result)).toBeGreaterThan(0);
	expect(constraintIds).toContain("no_unverified_listener_connection");
	return buildStationEvidence(station, result, envelope);
}

async function runConnectForeignListener(
	station: BranchStation,
): Promise<BranchStationEvidence> {
	const listener = startForeignCdpListener();
	// connect defaults to auto-launch, but a FOREIGN listener is never launched
	// over (fail closed, R11): the first check rejects the identity and stops.
	const result = await runBrowserConnect(
		["connect", "agent-browser", "--json", "--run-id", RUN_ID],
		{ label: station.id, env: { WARM_CHROME_CDP_PORT: String(listener.port) } },
	);
	const envelope = assertStationEnvelope(station, result) as RecoveryEnvelope;
	assertFailureStation(station, result, envelope);
	// U4: real warm-chrome may or may not prove a free suggested port on this
	// machine, so the arm is context dependent — either the automatic
	// use_suggested_port mirror or the terminal operator inspection. Both arms
	// must match the recovery-expectation map exactly (AE1).
	assertForeignListenerRecoveryArm(station.id, result, envelope);
	return buildStationEvidence(station, result, envelope);
}

/**
 * Arm-tolerant recovery assertion for real-warm-chrome foreign-listener rows:
 * exactly one of the two map-declared arms, never a mixture.
 */
function assertForeignListenerRecoveryArm(
	stationId: string,
	result: CliProcessResult,
	envelope: RecoveryEnvelope,
): void {
	const expectation =
		browserConnectRecoveryExpectations[
			stationId as BrowserConnectErrorStationId
		];
	const legacy = envelope.data?.next_action_id;
	expect(
		expectation.legacy_next_action_ids as readonly string[],
		describeCliProcessRun(result),
	).toContain(String(legacy));
	if (envelope.continuation?.next_action_id !== undefined) {
		// Automatic arm: the suggested-port mirror with ordered runtime actions.
		expect(envelope.continuation.next_action_id).toBe("use_suggested_port");
		expect(envelope.continuation.requires_operator).toBeUndefined();
		expect(envelope.continuation.choices).toBeUndefined();
		expect(envelope.runtime_actions?.map((action) => action.id)).toEqual([
			"use_suggested_port",
		]);
		expect(legacy).toBe("use_suggested_port");
	} else {
		// Operator arm: terminal listener inspection with constraints.
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(
			envelope.continuation?.choices?.map((choice) => choice.id),
		).toEqual(["inspect_listener"]);
		expect(
			(envelope.continuation?.constraints ?? []).length,
		).toBeGreaterThan(0);
		expect(legacy).toBe("inspect_listener");
	}
}

async function runPreexecConnectFailed(
	station: BranchStation,
): Promise<BranchStationEvidence> {
	// `run` reuses the connect gate; a foreign listener fails the gate BEFORE
	// exec (R17/AE6). The wrapped command never starts, the failure envelope is
	// on STDERR (KTD5), and exit is the connect-family 20. Any connect-family
	// failure homes on this single pre-exec station. The wrapped tail carries
	// auth-bearing values to prove run-repair privacy at the process boundary
	// (R26/AE14): none of them may serialize anywhere.
	const listener = startForeignCdpListener();
	const result = await runBrowserConnect(
		[
			"run",
			"agent-browser",
			"--run-id",
			RUN_ID,
			"--",
			"curl",
			"--header",
			"Authorization: Bearer boundary-sekret-token",
			"https://user:boundary-sekret-pw@internal.example/timesheet",
		],
		{ label: station.id, env: { WARM_CHROME_CDP_PORT: String(listener.port) } },
	);
	expect(result.exitCode, describeCliProcessRun(result)).toBe(
		station.expectedExitCode ?? null,
	);
	// stdout is untouched — the wrapped command never ran.
	expect(result.stdout, describeCliProcessRun(result)).toBe("");
	const envelope = parseLastStderrJson(result);
	expect(envelope.status, describeCliProcessRun(result)).toBe(
		station.expectedEnvelopeStatus,
	);
	expect(envelope.error?.code, describeCliProcessRun(result)).toBe(
		station.expectedErrorCode,
	);
	// U4/AE10: the pre-exec station inherits the exact underlying posture; the
	// legacy value is never resolve_connect_failure (R20).
	assertForeignListenerRecoveryArm("run.preexec_connect_failed", result, envelope);
	expect(
		envelope.data?.next_action_id,
		describeCliProcessRun(result),
	).not.toBe("resolve_connect_failure");
	// R26/AE14 at the process boundary: no wrapped argv, auth value, or URL
	// serializes into the envelope or any diagnostic on either stream.
	expect(result.stderr).not.toContain("boundary-sekret-token");
	expect(result.stderr).not.toContain("boundary-sekret-pw");
	expect(result.stderr).not.toContain("internal.example");
	expect(result.stderr).not.toContain("--header");
	return {
		stationId: station.id,
		status: "covered",
		...(result.exitCode !== null ? { observedExitCode: result.exitCode } : {}),
		...(envelope.status ? { observedEnvelopeStatus: envelope.status } : {}),
		...(station.expectedResultContractId
			? { observedResultContractId: station.expectedResultContractId }
			: {}),
		...(envelope.error?.code ? { observedErrorCode: envelope.error.code } : {}),
	};
}

// ===========================================================================
// Skip rationales.
// ===========================================================================

// Gateway stations that need a VERIFIED Agent Chrome. warm-chrome is consumed
// in-process (KTD2) and pins the real Chrome app-binary path, so a verified
// environment cannot be synthesized at the process boundary without a real
// Agent Chrome. Proven in-process by U4/U6/U7 injected-dep unit tests and by the
// Verification Contract live smoke (AE1).
const VERIFIED_ENV_RATIONALE =
	"Requires a verified Agent Chrome behind the prove-or-launch gate; warm-chrome is consumed in-process (KTD2) and pins the real Chrome app-binary path, so a verified environment cannot be synthesized at the process boundary without a real Agent Chrome. Proven in-process by U4 gateway and U6/U7 dispatcher and run-wrapper unit tests with injected deps and captured writers, and end-to-end by the Verification Contract live smoke.";

const RUNTIME_ERROR_RATIONALE =
	"No deterministic non-usage runtime throw exists at the process boundary; the exit-1 runtime-error path is driven by a caught non-CliUsageError, proven in-process by U6/U7 caught-error unit tests with an injected throwing dep.";

function skip(rationale: string) {
	return (
		station: BranchStation,
	): Promise<BranchStationEvidence> =>
		Promise.resolve(buildSkippedStationEvidence(station, rationale));
}

// ===========================================================================
// Station scenario map — keyed on the catalog's union type. Compile-time
// exhaustiveness: a missing or stray key is a TYPE error.
// ===========================================================================

const stationScenarios: Record<BrowserConnectStationId, StationScenario> = {
	// -- Real process-boundary spawns --
	"dashboard.ok": { run: runDashboardOk },
	"check.usage_invalid": { run: runUsageInvalid },
	"connect.adapter_unknown": { run: runAdapterUnknown },
	"run.missing_separator": { run: runMissingSeparator },
	// Foreign-listener seam via WARM_CHROME_CDP_PORT + fixture listener: real
	// warm-chrome proof rejects the identity and fails closed (exit 20).
	"check.foreign_listener": { run: runCheckForeignListener },
	"connect.foreign_listener": { run: runConnectForeignListener },
	"run.preexec_connect_failed": { run: runPreexecConnectFailed },

	// -- Skipped: gateway stations needing a verified Agent Chrome --
	"check.verified": { run: skip(VERIFIED_ENV_RATIONALE) },
	"connect.verified_existing": { run: skip(VERIFIED_ENV_RATIONALE) },
	"connect.verified_launched": { run: skip(VERIFIED_ENV_RATIONALE) },
	"connect.launch_failed": { run: skip(VERIFIED_ENV_RATIONALE) },
	"check.environment_absent": { run: skip(VERIFIED_ENV_RATIONALE) },
	"connect.adapter_not_installed": { run: skip(VERIFIED_ENV_RATIONALE) },
	"connect.route_incompatible": { run: skip(VERIFIED_ENV_RATIONALE) },
	"connect.attachment_failed": { run: skip(VERIFIED_ENV_RATIONALE) },
	"run.wrapped_not_found": { run: skip(VERIFIED_ENV_RATIONALE) },
	"run.passthrough_success": { run: skip(VERIFIED_ENV_RATIONALE) },
	"run.passthrough_failure": { run: skip(VERIFIED_ENV_RATIONALE) },

	// -- Skipped: no deterministic boundary trigger --
	"check.runtime_error": { run: skip(RUNTIME_ERROR_RATIONALE) },

	// -- U5/U4 repair-adapter stations: all four are REAL process rows --
	// The preview is fully reachable at the process boundary: it re-reads the
	// committed adapter-install source manifests and the machine's provenance,
	// reports eligibility, and performs zero network and zero mutation — every
	// machine state yields exit 0 with an ok envelope.
	"repair-adapter.preview": { run: runRepairAdapterPreview },
	// installed/upgraded run the REAL main at a real process boundary through a
	// temp wrapper entry that injects the hermetic install engine (stubbed
	// canonical-origin probe, real filesystem, real no-shell spawn of a real
	// fake package-manager executable) — zero network, mutation confined to a
	// temp install root.
	"repair-adapter.installed": {
		run: (station) => runRepairAdapterExecuted(station, "install"),
	},
	"repair-adapter.upgraded": {
		run: (station) => runRepairAdapterExecuted(station, "upgrade"),
	},
	// operator_stop is reachable through the REAL production entrypoint: a
	// PATH-shadowed fake adapter binary reports a non-allowlisted version, so
	// --execute stops fail-closed BEFORE the executor (zero network).
	"repair-adapter.operator_stop": { run: runRepairAdapterOperatorStop },
};

async function runRepairAdapterPreview(
	station: BranchStation,
): Promise<BranchStationEvidence> {
	const result = await runBrowserConnect(
		["repair-adapter", "chrome-devtools-mcp", "--check", "--json", "--run-id", RUN_ID],
		{ label: station.id },
	);
	const envelope = assertStationEnvelope(station, result);
	expect(
		(envelope.data as Record<string, unknown> | undefined)?.outcome,
		describeCliProcessRun(result),
	).toBe("repair_preview");
	return buildStationEvidence(station, result, envelope);
}

// -- repair-adapter --execute rows (U4): the REAL main at a real process
// boundary via a temp wrapper entry. The wrapper injects only the declared
// test seams (install engine with a stubbed canonical-origin probe, fake
// package-manager path, temp install root, scripted provenance); argv parsing,
// policy selection, the isolated installer sequence, the REAL no-shell spawn
// of the fake package manager, the atomic publish, and the fresh provenance
// read from the published bin all run for real. Zero network. --

const SRC_DIR = dirname(CLI_PATH);
const CDM_PIN = chromeDevtoolsMcpDefinition.pinnedVersion;
const CDM_ALLOWLISTED_FROM =
	chromeDevtoolsMcpDefinition.installPolicy.safeUpgradeTransitions[0]?.from ??
	"1.4.0";

function repairWrapperSource(): string {
	return `// @ts-nocheck
// Generated U4 integration wrapper: real main(), hermetic install seams.
import { main } from ${JSON.stringify(CLI_PATH)};
import { agentBrowserDefinition } from ${JSON.stringify(join(SRC_DIR, "adapters/agent-browser.ts"))};
import { chromeDevtoolsMcpDefinition } from ${JSON.stringify(join(SRC_DIR, "adapters/chrome-devtools-mcp.ts"))};
import { spawnAdapterCommand } from ${JSON.stringify(join(SRC_DIR, "adapters/registry.ts"))};
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";

const fakePmPath = process.env.FAKE_PM_PATH ?? "";
const installRoot = process.env.FAKE_INSTALL_ROOT ?? "";
const observedVersion = process.env.FAKE_OBSERVED_VERSION;

const engine = {
	env: process.env,
	fileExists: async (path) => {
		try {
			await access(path);
			return true;
		} catch {
			return false;
		}
	},
	readTextFile: (path) => readFile(path, "utf8"),
	writeTextFile: (path, contents) => writeFile(path, contents, "utf8"),
	makeDir: async (path) => {
		await mkdir(path, { recursive: true });
	},
	makeTempDir: (prefix) => mkdtemp(prefix),
	removeDir: (path) => rm(path, { recursive: true, force: true }),
	publishDir: (fromPath, toPath) => rename(fromPath, toPath),
	// Hermetic egress stub: reports the canonical origin reachable without a
	// network request; the isolated installer spawn below is REAL.
	probeOrigin: async () => ({ status: 200 }),
	runCommand: spawnAdapterCommand,
};

const definitions = [
	{
		...chromeDevtoolsMcpDefinition,
		installPolicy: {
			...chromeDevtoolsMcpDefinition.installPolicy,
			packageManager: { approvedAbsoluteCandidates: [fakePmPath] },
		},
	},
	agentBrowserDefinition,
];

const adapterRuntime = {
	env: process.env,
	resolveExecutable: (command) =>
		observedVersion && command === "chrome-devtools-mcp"
			? { resolved: true, path: "/fake/bin/chrome-devtools-mcp" }
			: { resolved: false },
	runCommand: async (input) => {
		if (
			input.command === "/fake/bin/chrome-devtools-mcp" &&
			input.args.includes("--version")
		) {
			return {
				exitCode: 0,
				stdout: "chrome-devtools-mcp " + observedVersion + String.fromCharCode(10),
				stderr: "",
			};
		}
		return spawnAdapterCommand(input);
	},
};

const exitCode = await main(process.argv.slice(2), {
	warmChromeMain: async () => {
		throw new Error("warm-chrome must not run for repair-adapter");
	},
	adapterRuntime,
	listAdapterDefinitions: () => definitions,
	findAdapterDefinition: (id) => definitions.find((d) => d.id === id),
	adapterInstallEngine: engine,
	adapterInstallRoot: installRoot,
});
process.exit(exitCode);
`;
}

function writeShFakePackageManager(dir: string): string {
	const pmPath = join(dir, "fake-pm");
	writeFileSync(
		pmPath,
		[
			"#!/bin/sh",
			"# Fabricate the staged install tree a lifecycle-script-free npm ci",
			"# would produce; the source lockfile is left untouched.",
			"mkdir -p node_modules/.bin",
			"cat > node_modules/.bin/chrome-devtools-mcp <<'EOF'",
			"#!/bin/sh",
			`echo "chrome-devtools-mcp ${CDM_PIN}"`,
			"EOF",
			"chmod +x node_modules/.bin/chrome-devtools-mcp",
			"exit 0",
			"",
		].join("\n"),
	);
	chmodSync(pmPath, 0o755);
	return pmPath;
}

async function runRepairAdapterExecuted(
	station: BranchStation,
	arm: "install" | "upgrade",
): Promise<BranchStationEvidence> {
	const root = makeTempDir(registry, "browser-connect-u4-repair");
	const wrapperPath = join(root, "repair-entry.ts");
	writeFileSync(wrapperPath, repairWrapperSource());
	const pmPath = writeShFakePackageManager(root);
	const installRoot = join(root, "install-root");

	const result = await runCliProcess({
		label: station.id,
		argv: [
			process.execPath,
			wrapperPath,
			"repair-adapter",
			"chrome-devtools-mcp",
			"--execute",
			"--json",
			"--run-id",
			RUN_ID,
		],
		cwd: PACKAGE_ROOT,
		timeoutMs: SPAWN_TIMEOUT_MS,
		env: {
			...process.env,
			FAKE_PM_PATH: pmPath,
			FAKE_INSTALL_ROOT: installRoot,
			...(arm === "upgrade"
				? { FAKE_OBSERVED_VERSION: CDM_ALLOWLISTED_FROM }
				: {}),
		},
	});

	const envelope = assertStationEnvelope(station, result);
	const data = envelope.data as Record<string, unknown> | undefined;
	expect(data?.outcome, describeCliProcessRun(result)).toBe("repair_executed");
	expect(data?.performed, describeCliProcessRun(result)).toBe(
		arm === "install" ? "install_adapter" : "upgrade_adapter_to_pin",
	);
	expect(data?.observed_version, describeCliProcessRun(result)).toBe(CDM_PIN);
	// Real mutation, confined to the temp install root: the versioned tree was
	// atomically published and its bin proves the exact pin (R33).
	expect(
		existsSync(
			join(
				installRoot,
				"chrome-devtools-mcp",
				CDM_PIN,
				"node_modules",
				".bin",
				"chrome-devtools-mcp",
			),
		),
		describeCliProcessRun(result),
	).toBe(true);
	return buildStationEvidence(station, result, envelope);
}

async function runRepairAdapterOperatorStop(
	station: BranchStation,
): Promise<BranchStationEvidence> {
	// PATH-shadow the adapter executable with a fake reporting a version the
	// registry does not allowlist: --execute must stop fail-closed BEFORE the
	// executor — an operator stage with zero network and zero mutation (R22).
	const root = makeTempDir(registry, "browser-connect-u4-stop");
	const binDir = join(root, "bin");
	const homeDir = join(root, "home");
	mkdirSync(binDir, { recursive: true });
	mkdirSync(homeDir, { recursive: true });
	const fakeAdapter = join(binDir, "chrome-devtools-mcp");
	writeFileSync(fakeAdapter, '#!/bin/sh\necho "chrome-devtools-mcp 9.9.9"\n');
	chmodSync(fakeAdapter, 0o755);

	const result = await runBrowserConnect(
		[
			"repair-adapter",
			"chrome-devtools-mcp",
			"--execute",
			"--json",
			"--run-id",
			RUN_ID,
		],
		{
			label: station.id,
			env: {
				PATH: `${binDir}:${process.env.PATH ?? ""}`,
				HOME: homeDir,
			},
		},
	);

	const envelope = assertStationEnvelope(station, result) as RecoveryEnvelope;
	const data = envelope.data as Record<string, unknown> | undefined;
	expect(data?.outcome, describeCliProcessRun(result)).toBe("repair_stopped");
	expect(data?.stop_cause, describeCliProcessRun(result)).toBe(
		"transition_not_allowlisted",
	);
	// U4 serialization proof: operator posture with package choices and
	// constraints survives the process boundary; legacy data stays the
	// non-mutating discovery stop (R30/AE19).
	expect(
		envelope.continuation?.requires_operator,
		describeCliProcessRun(result),
	).toBe(true);
	expect(
		envelope.continuation?.choices?.map((choice) => choice.id),
		describeCliProcessRun(result),
	).toEqual(["adjust_adapter_pin"]);
	const constraintIds = (envelope.continuation?.constraints ?? []).map(
		(constraint) => constraint.id,
	);
	expect(constraintIds, describeCliProcessRun(result)).toContain(
		"no_pin_policy_change",
	);
	expect(data?.next_action_id, describeCliProcessRun(result)).toBe(
		"list_registered_adapters",
	);
	return buildStationEvidence(station, result, envelope);
}

// The bare dashboard is a stateless read-only projection (R15): it reads static
// registry + provenance and NEVER proves an environment, launches, or probes.
// It is fully reachable at the process boundary — provenance simply reports the
// real adapters as not-installed on a machine without them, which is the honest
// read.
async function runDashboardOk(
	station: BranchStation,
): Promise<BranchStationEvidence> {
	const result = await runBrowserConnect(["--json", "--run-id", RUN_ID], {
		label: station.id,
	});
	const envelope = assertStationEnvelope(station, result);
	expect(
		(envelope.data as Record<string, unknown> | undefined)?.outcome,
		describeCliProcessRun(result),
	).toBe("dashboard");
	return buildStationEvidence(station, result, envelope);
}

// ===========================================================================
// Tests.
// ===========================================================================

describe("browser-connect Branch Station integration (U8)", () => {
	test("every catalog station has a process-boundary scenario row", () => {
		expect(Object.keys(stationScenarios).sort()).toEqual(
			browserConnectBranchStationCatalog
				.map((station) => station.id)
				.sort(),
		);
	});

	test(
		"catalog-driven rows cover reachable stations or skip with rationale; no drift",
		async () => {
			const evidence: BranchStationEvidence[] = [];
			for (const station of browserConnectBranchStationCatalog) {
				const scenario = stationScenarios[station.id];
				evidence.push(await scenario.run(station));
			}

			const map = projectBrowserConnectStationMap(evidence);
			// No catalog/evidence drift (unsafe text, unknown ids, missing
			// rationale on skips, etc.).
			expect(map.drift).toEqual([]);

			// Every station is either covered by a real spawn or skipped with a
			// recorded rationale — full coverage-or-skip. U4 target counts (plan
			// Verification Contract): 23 stations = 11 real process rows + 12
			// justified skips.
			const covered = evidence.filter((r) => r.status === "covered");
			const skipped = evidence.filter((r) => r.status === "skipped");
			expect(covered.length + skipped.length).toBe(
				browserConnectBranchStationCatalog.length,
			);
			expect(covered.length).toBe(11);
			expect(skipped.length).toBe(12);
			for (const skip of skipped) {
				expect(skip.rationale, `skip ${skip.stationId} needs a rationale`)
					.toBeTruthy();
			}

			// The Station Map reports no missing/drifted stations — only covered or
			// skipped remain in the reconciled projection.
			expect(
				map.stations.filter(
					(s) =>
						s.evidence.status === "covered" ||
						s.evidence.status === "skipped",
				).length,
			).toBe(browserConnectBranchStationCatalog.length);

			// Every real-spawn station reconciled to `covered` (observed matches
			// the catalog's declared exit code, envelope status, contract id, and
			// error code — the projector marks any mismatch `drifted`).
			const coveredIds = new Set(covered.map((r) => r.stationId));
			for (const projected of map.stations) {
				if (coveredIds.has(projected.station_id)) {
					expect(
						projected.evidence.status,
						`real-spawn station ${projected.station_id} drifted`,
					).toBe("covered");
				}
			}
		},
		120_000,
	);

	test("catalog validates against live command discovery (no command drift)", () => {
		const drift = findBrowserConnectBranchStationCatalogDrift();
		const commandDrift = drift.filter(
			(d) => d.category === "branch-station-command-unknown",
		);
		expect(commandDrift).toEqual([]);
	});
});
