import { afterEach, describe, expect, test } from "bun:test";
import { dirname } from "node:path";
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
	startFixtureServer,
} from "@side-quest/cli-test-fixtures";
import {
	type BrowserConnectStationId,
	browserConnectBranchStationCatalog,
	findBrowserConnectBranchStationCatalogDrift,
	projectBrowserConnectStationMap,
} from "../src/branch-station-catalog.ts";

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
	// `run` with no `--` is a pure parse failure (exit 2). KTD5: run's failure
	// envelope is on STDERR — stdout belongs to the wrapped command end-to-end —
	// so stdout stays empty and the envelope is the last JSON line on stderr.
	const result = await runBrowserConnect(
		["run", "agent-browser", "--run-id", RUN_ID],
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

function parseLastStderrJson(result: CliProcessResult): StationRuntimeEnvelope {
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
	return JSON.parse(line) as StationRuntimeEnvelope;
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
	const envelope = assertStationEnvelope(station, result);
	assertFailureStation(station, result, envelope);
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
	const envelope = assertStationEnvelope(station, result);
	assertFailureStation(station, result, envelope);
	return buildStationEvidence(station, result, envelope);
}

async function runPreexecConnectFailed(
	station: BranchStation,
): Promise<BranchStationEvidence> {
	// `run` reuses the connect gate; a foreign listener fails the gate BEFORE
	// exec (R17/AE6). The wrapped command never starts, the failure envelope is
	// on STDERR (KTD5), and exit is the connect-family 20. Any connect-family
	// failure homes on this single pre-exec station.
	const listener = startForeignCdpListener();
	const result = await runBrowserConnect(
		["run", "agent-browser", "--run-id", RUN_ID, "--", "true"],
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
	expect(
		(envelope.data as Record<string, unknown> | undefined)?.next_action_id,
		describeCliProcessRun(result),
	).toBe(station.expectedActionId);
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

// repair-adapter --execute stations require package mutation through the
// isolated installer; hermetic tests forbid real network and real package
// mutation, and the production engine has no process-boundary injection seam.
// Proven in-process by U5 entrypoint tests with an injected install engine,
// a fake package-manager executable spawned at a real process boundary, and
// fixture lockfiles.
const PACKAGE_MUTATION_RATIONALE =
	"Requires package mutation through the isolated installer against the real canonical package registry; hermetic tests forbid real network and real package mutation. Proven in-process by U5 entrypoint tests with an injected install engine, a fake package-manager executable spawned at a real process boundary, and fixture lockfiles.";

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

	// -- U5 repair-adapter stations --
	// The preview is fully reachable at the process boundary: it re-reads the
	// committed adapter-install source manifests and the machine's provenance,
	// reports eligibility, and performs zero network and zero mutation — every
	// machine state yields exit 0 with an ok envelope.
	"repair-adapter.preview": { run: runRepairAdapterPreview },
	"repair-adapter.installed": { run: skip(PACKAGE_MUTATION_RATIONALE) },
	"repair-adapter.upgraded": { run: skip(PACKAGE_MUTATION_RATIONALE) },
	"repair-adapter.operator_stop": { run: skip(PACKAGE_MUTATION_RATIONALE) },
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
			// recorded rationale — full coverage-or-skip.
			const covered = evidence.filter((r) => r.status === "covered");
			const skipped = evidence.filter((r) => r.status === "skipped");
			expect(covered.length + skipped.length).toBe(
				browserConnectBranchStationCatalog.length,
			);
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
