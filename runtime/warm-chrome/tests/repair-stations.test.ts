// U7: both repair stations plus the R11 never-kill-unverified and
// never-follow-symlink invariants, driven through main(argv, deps) with a
// stateful fake runtime seam (repairs must be observable: chmod flips the
// stored mode, ensureProfileDir creates the entry, writeTextFile updates the
// DevToolsActivePort state the re-prove reads). Proof failures reached via
// repair are asserted mechanically against the U3 re-emit map.
import { describe, expect, test } from "bun:test";
import type { BranchStation } from "@side-quest/cli-command-facade";
import {
	assertStationEnvelope,
	buildStationEvidence,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";

import {
	resolveWarmChromeReemittedStations,
	warmChromeBranchStationCatalog,
} from "../src/branch-station-catalog.ts";
import {
	listMissingWarmChromeBranchStationEvidence,
	projectWarmChromeBranchStationEvidence,
	type WarmChromeBranchStationEvidence,
} from "../src/branch-station-evidence.ts";
import { main } from "../src/cli.ts";
import {
	WARM_CHROME_CONTRACT_ID,
	WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID,
	WARM_CHROME_SCHEMA_VERSION,
} from "../src/model.ts";
import {
	createRepairCommandHandler,
	WARM_CHROME_REPAIR_REASONS,
	type WarmChromeRepairDeps,
	type WarmChromeRepairFileKind,
	type WarmChromeRepairReason,
} from "../src/repair.ts";
import {
	createDefaultRuntime,
	type ListenerProcess,
	type ProfileStat,
	REAL_GOOGLE_CHROME_BINARY,
	type WarmChromeRuntime,
	WarmChromeRuntimeError,
} from "../src/runtime.ts";

const HOME = "/Users/warm";
const DEDICATED_PROFILE = `${HOME}/.agent-warm-profile`;
const ACTIVE_PORT_PATH = `${DEDICATED_PROFILE}/DevToolsActivePort`;
const BROWSER_WS = "ws://127.0.0.1:9222/devtools/browser/warm-chrome-token";
const BROWSER_WS_PATH = "/devtools/browser/warm-chrome-token";
const OBSERVED_BUILD = "Chrome/138.0.7204.49";
const HEADED_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

function chromeCommand(
	overrides: { port?: string; profile?: string } = {},
): string {
	return `${REAL_GOOGLE_CHROME_BINARY} --remote-debugging-port=${
		overrides.port ?? "9222"
	} --user-data-dir=${overrides.profile ?? DEDICATED_PROFILE} --no-first-run`;
}

function chromeListener(
	overrides: Parameters<typeof chromeCommand>[0] & { pid?: number } = {},
): ListenerProcess {
	return { pid: overrides.pid ?? 4242, command: chromeCommand(overrides) };
}

const FOREIGN_LISTENER: ListenerProcess = {
	pid: 6001,
	command: "/usr/local/bin/node /srv/dev-server.js",
};

function healthyVersion(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		Browser: OBSERVED_BUILD,
		"Protocol-Version": "1.3",
		"User-Agent": HEADED_UA,
		webSocketDebuggerUrl: BROWSER_WS,
		...overrides,
	};
}

function profileStat(
	path: string,
	overrides: Partial<ProfileStat> = {},
): ProfileStat {
	return { realPath: path, mode: "700", owner: "501", ...overrides };
}

type CdpEntry = Record<string, unknown> | Error;

function healthyCdp(
	overrides: Record<string, CdpEntry> = {},
): Record<string, CdpEntry> {
	return {
		"Browser.getVersion": { product: OBSERVED_BUILD, userAgent: HEADED_UA },
		"Target.getBrowserContexts": { browserContextIds: [] },
		"Target.getTargets": {
			targetInfos: [
				{ type: "page", targetId: "page-1", url: "https://example.com/" },
			],
		},
		...overrides,
	};
}

type VersionStep = Record<string, unknown> | Error;

type RepairFixtureOptions = {
	listeners?: Record<string, ListenerProcess | null>;
	/** Raw error thrown by findListener for port 9222. */
	findListenerError?: Error;
	/** /json/version script. Arrays play per call; the last entry repeats. */
	version?: VersionStep | ReadonlyArray<VersionStep>;
	cdp?: Record<string, CdpEntry>;
	/** Mutable statProfile store; chmod/ensureProfileDir repairs update it. */
	profiles?: Record<string, ProfileStat>;
	/** Initial DevToolsActivePort state; writes through the seam update it. */
	activePort?: { port: string; wsPath: string } | null;
	/** Paths whose lstat probe reports a planted symlink. */
	symlinkPaths?: readonly string[];
	ensureProfileDirError?: Error;
};

type RepairFixture = {
	runtime: WarmChromeRuntime;
	deps: WarmChromeRepairDeps;
	calls: {
		fetchJsonUrls: string[];
		findListenerPorts: string[];
		chmodPaths: string[];
		writes: Array<{ path: string; content: string }>;
		ensureProfileDirPaths: string[];
		lstatPaths: string[];
		spawnChrome: number;
		/** Kills issued through any spawn handle — the seam's only process-affecting call. */
		kills: number;
	};
};

// Local stateful variant of check-stations' warmChromeFixture (repo precedent:
// fixtures stay test-file-local). Repair mutations must be observable by the
// re-prove, so chmod, ensureProfileDir, and writeTextFile update fixture state.
function repairFixture(options: RepairFixtureOptions = {}): RepairFixture {
	const calls: RepairFixture["calls"] = {
		fetchJsonUrls: [],
		findListenerPorts: [],
		chmodPaths: [],
		writes: [],
		ensureProfileDirPaths: [],
		lstatPaths: [],
		spawnChrome: 0,
		kills: 0,
	};
	const versionScript: readonly VersionStep[] = Array.isArray(options.version)
		? options.version
		: [options.version ?? healthyVersion()];
	let versionCursor = 0;
	const listeners = options.listeners ?? { "9222": chromeListener() };
	const profiles = options.profiles ?? {
		[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE),
	};
	const cdp = options.cdp ?? healthyCdp();
	const state = { activePort: options.activePort ?? null };

	const runtime = createDefaultRuntime({
		env: { HOME },
		now: () => Date.now(),
		fetchJson: async (url) => {
			calls.fetchJsonUrls.push(url);
			const step =
				versionScript[Math.min(versionCursor, versionScript.length - 1)];
			versionCursor += 1;
			if (step instanceof Error) throw step;
			return step;
		},
		findListener: async (port) => {
			calls.findListenerPorts.push(port);
			if (options.findListenerError && port === "9222") {
				throw options.findListenerError;
			}
			return listeners[port] ?? null;
		},
		currentUser: async () => "501",
		statProfile: async (path) => {
			const stat = profiles[path];
			if (!stat) throw new Error(`no profile directory at ${path}`);
			return stat;
		},
		ensureProfileDir: async (path) => {
			calls.ensureProfileDirPaths.push(path);
			if (options.ensureProfileDirError) throw options.ensureProfileDirError;
			profiles[path] = profileStat(path);
			return path;
		},
		chmod: async (path, mode) => {
			calls.chmodPaths.push(path);
			for (const stat of Object.values(profiles)) {
				if (stat.realPath === path) {
					stat.mode = (mode & 0o777).toString(8);
				}
			}
		},
		writeTextFile: async (path, content) => {
			calls.writes.push({ path, content });
			const [port = "", wsPath = ""] = content
				.split("\n")
				.map((line) => line.trim());
			state.activePort = { port, wsPath };
		},
		spawnChrome: async () => {
			calls.spawnChrome += 1;
			return {
				pid: 1,
				kill: async () => {
					calls.kills += 1;
					return true;
				},
			};
		},
		readSingletonLock: async () => null,
		sleep: (ms) =>
			new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))),
	});

	const deps: WarmChromeRepairDeps = {
		cdpRoundTrip: async (_wsUrl, method) => {
			const entry = cdp[method];
			if (!entry) throw new Error(`unexpected CDP method: ${method}`);
			if (entry instanceof Error) throw entry;
			return entry;
		},
		readDevToolsActivePort: async () => state.activePort,
		lstatFileKind: async (path): Promise<WarmChromeRepairFileKind> => {
			calls.lstatPaths.push(path);
			if (options.symlinkPaths?.includes(path)) return "symlink";
			return state.activePort === null ? "missing" : "other";
		},
	};

	return { runtime, deps, calls };
}

interface MemoryWriter {
	output: string;
	write(chunk: string): true;
}

function createMemoryWriter(): MemoryWriter {
	return {
		output: "",
		write(chunk: string) {
			this.output += chunk;
			return true;
		},
	};
}

type CliRun = { exitCode: number; stdout: string; stderr: string };

async function runRepair(
	argv: readonly string[],
	fixture: RepairFixture,
): Promise<CliRun> {
	const stdout = createMemoryWriter();
	const stderr = createMemoryWriter();
	const exitCode = await main(argv, {
		runtime: fixture.runtime,
		handlers: { repair: createRepairCommandHandler(fixture.deps) },
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.output, stderr: stderr.output };
}

type ParsedEnvelope = {
	status: string;
	data?: Record<string, unknown>;
	error?: { code: string; exit_code: number; failure_domain?: string };
	runtime_actions?: Array<{ id: string; summary: string }>;
	continuation?: {
		next_action_id?: string;
		constraints?: Array<{ id: string; forbidden_action_ids?: string[] }>;
	};
};

function parseEnvelope(run: CliRun): ParsedEnvelope {
	return JSON.parse(run.stdout) as ParsedEnvelope;
}

function toProcessResult(
	label: string,
	argv: readonly string[],
	run: CliRun,
): CliProcessResult {
	return {
		label,
		argv: ["warm-chrome", ...argv],
		cwd: "/",
		exitCode: run.exitCode,
		stdout: run.stdout,
		stderr: run.stderr,
		timedOut: false,
		signal: null,
		timeoutMs: 0,
	};
}

function repairStation(stationId: string): BranchStation {
	const station = (
		warmChromeBranchStationCatalog as readonly BranchStation[]
	).find((candidate) => candidate.id === stationId);
	if (!station) throw new Error(`unknown station: ${stationId}`);
	return station;
}

function expectRepaired(run: CliRun): ParsedEnvelope {
	if (run.exitCode !== 0) {
		throw new Error(
			`expected exit 0, got ${run.exitCode}\nstdout=${run.stdout}\nstderr=${run.stderr}`,
		);
	}
	const envelope = parseEnvelope(run);
	expect(envelope.status).toBe("ok");
	expect(envelope.data?.contract_id).toBe(WARM_CHROME_CONTRACT_ID);
	expect(envelope.data?.schema_version).toBe(WARM_CHROME_SCHEMA_VERSION);
	expect(envelope.runtime_actions?.[0]?.id).toBe("use_verified_endpoint");
	// R8: guidance carries the ACTUAL verified endpoint.
	expect(envelope.runtime_actions?.[0]?.summary).toContain(
		"http://127.0.0.1:9222",
	);
	expect(envelope.continuation?.next_action_id).toBe("use_verified_endpoint");
	return envelope;
}

function expectUnrepairable(
	run: CliRun,
	reason: WarmChromeRepairReason,
): ParsedEnvelope {
	if (run.exitCode !== 20) {
		throw new Error(
			`expected exit 20, got ${run.exitCode}\nstdout=${run.stdout}\nstderr=${run.stderr}`,
		);
	}
	const envelope = parseEnvelope(run);
	expect(envelope.error?.code).toBe("unrepairable");
	expect(envelope.data?.reason).toBe(reason);
	expect(envelope.data?.contract_id).toBe(WARM_CHROME_CONTRACT_ID);
	expect(envelope.data?.schema_version).toBe(WARM_CHROME_SCHEMA_VERSION);
	// Catalog pin: unrepairable routes to inspect_diagnostics.
	expect(envelope.runtime_actions?.[0]?.id).toBe("inspect_diagnostics");
	expect(envelope.continuation?.next_action_id).toBe("inspect_diagnostics");
	// Exit-20 envelopes always carry the no_adapter_fallback constraint (R12).
	expect(envelope.continuation?.constraints?.[0]?.id).toBe(
		WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID,
	);
	return envelope;
}

// The seam's only process-affecting primitive is the spawn handle's kill; a
// repair that never spawns can never terminate anything (R11).
function expectNoProcessAffectingCalls(fixture: RepairFixture): void {
	expect(fixture.calls.spawnChrome).toBe(0);
	expect(fixture.calls.kills).toBe(0);
}

describe("warm-chrome repair.repaired (U7): profile repair then re-prove", () => {
	test("unsafe profile permissions are chmodded 0700 and the re-prove verifies", async () => {
		const fixture = repairFixture({
			profiles: {
				[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE, { mode: "755" }),
			},
		});
		const run = await runRepair(["repair", "--run-id", "perms-run"], fixture);

		const envelope = expectRepaired(run);
		expect(envelope.data?.repair_actions).toEqual(["profile_permissions"]);
		// Mutation pin: the cross-tool-visible chmod names its exact target path.
		expect(envelope.data?.repair_mutations).toEqual([
			{ id: "profile_permissions", path: DEDICATED_PROFILE },
		]);
		expect(fixture.calls.chmodPaths).toEqual([DEDICATED_PROFILE]);
		expect(envelope.data?.profile_permissions).toBe("700");
		expect(envelope.data?.web_socket_debugger_url).toBe(BROWSER_WS);
		expectNoProcessAffectingCalls(fixture);
	});

	test("missing profile dir is created and the re-prove verifies", async () => {
		const fixture = repairFixture({ profiles: {} });
		const run = await runRepair(["repair"], fixture);

		const envelope = expectRepaired(run);
		expect(envelope.data?.repair_actions).toEqual(["profile_dir_created"]);
		expect(envelope.data?.repair_mutations).toEqual([
			{ id: "profile_dir_created", path: DEDICATED_PROFILE },
		]);
		expect(fixture.calls.ensureProfileDirPaths).toEqual([DEDICATED_PROFILE]);
		expectNoProcessAffectingCalls(fixture);
	});

	test("stale DevToolsActivePort is rewritten from the live endpoint and the re-prove verifies", async () => {
		const fixture = repairFixture({
			activePort: { port: "9222", wsPath: "/devtools/browser/stale-token" },
		});
		const run = await runRepair(["repair"], fixture);

		const envelope = expectRepaired(run);
		expect(envelope.data?.repair_actions).toEqual(["devtools_active_port"]);
		expect(envelope.data?.repair_mutations).toEqual([
			{ id: "devtools_active_port", path: ACTIVE_PORT_PATH },
		]);
		// The write landed inside the profile dir with the live endpoint id.
		expect(fixture.calls.writes).toEqual([
			{ path: ACTIVE_PORT_PATH, content: `9222\n${BROWSER_WS_PATH}\n` },
		]);
		// The guard consulted the no-follow probe before writing.
		expect(fixture.calls.lstatPaths).toEqual([ACTIVE_PORT_PATH]);
		expectNoProcessAffectingCalls(fixture);
	});

	test("healthy warm Chrome is idempotent: repaired with zero mutations", async () => {
		const fixture = repairFixture();
		const run = await runRepair(["repair", "--run-id", "idempotent"], fixture);

		const envelope = expectRepaired(run);
		expect(envelope.data?.repair_actions).toEqual([]);
		expect(envelope.data?.repair_mutations).toEqual([]);
		expect(fixture.calls.chmodPaths).toEqual([]);
		expect(fixture.calls.writes).toEqual([]);
		expect(fixture.calls.ensureProfileDirPaths).toEqual([]);
		expectNoProcessAffectingCalls(fixture);
	});
});

describe("warm-chrome repair.unrepairable (U7): fail closed without touching unverified state", () => {
	test("R11 negative: a foreign listener on the port is never terminated or repaired around", async () => {
		const fixture = repairFixture({
			listeners: { "9222": FOREIGN_LISTENER },
		});
		const run = await runRepair(["repair", "--run-id", "foreign"], fixture);

		const envelope = expectUnrepairable(run, "foreign_listener_on_port");
		// Redaction chokepoint holds: pid + basename only, no cmdline paths.
		expect(envelope.data?.listener).toEqual({
			pid: 6001,
			process: "node",
			foreign: true,
		});
		expect(run.stdout).not.toContain("/srv/dev-server.js");
		// No kill, no spawn, no chmod, no write, no dir creation, no probe past
		// the listener inspection: repair refused before acting.
		expectNoProcessAffectingCalls(fixture);
		expect(fixture.calls.chmodPaths).toEqual([]);
		expect(fixture.calls.writes).toEqual([]);
		expect(fixture.calls.ensureProfileDirPaths).toEqual([]);
		expect(fixture.calls.fetchJsonUrls).toEqual([]);
	});

	test("never-follow-symlink negative: a symlink planted at DevToolsActivePort refuses the write", async () => {
		const fixture = repairFixture({
			activePort: { port: "9222", wsPath: "/devtools/browser/stale-token" },
			symlinkPaths: [ACTIVE_PORT_PATH],
		});
		const run = await runRepair(["repair"], fixture);

		const envelope = expectUnrepairable(run, "devtools_active_port_symlink");
		expect(envelope.data?.devtools_active_port_path).toBe(ACTIVE_PORT_PATH);
		// The invariant: zero writes through the seam — the symlink target was
		// never followed, inside or outside the profile dir.
		expect(fixture.calls.writes).toEqual([]);
		expect(fixture.calls.lstatPaths).toEqual([ACTIVE_PORT_PATH]);
		expectNoProcessAffectingCalls(fixture);
	});

	test("a profile owned by another user is never chmodded", async () => {
		const fixture = repairFixture({
			profiles: {
				[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE, {
					mode: "755",
					owner: "0",
				}),
			},
		});
		const run = await runRepair(["repair"], fixture);

		expectUnrepairable(run, "profile_not_owned");
		expect(fixture.calls.chmodPaths).toEqual([]);
		expectNoProcessAffectingCalls(fixture);
	});

	test("an uncreatable profile dir fails closed", async () => {
		const fixture = repairFixture({
			profiles: {},
			ensureProfileDirError: new Error("EACCES: permission denied"),
		});
		const run = await runRepair(["repair"], fixture);

		const envelope = expectUnrepairable(run, "profile_dir_uncreatable");
		expect(envelope.data?.profile_dir).toBe(DEDICATED_PROFILE);
		// The hostile seam error message never leaks into the envelope.
		expect(run.stdout).not.toContain("EACCES");
		expectNoProcessAffectingCalls(fixture);
	});

	test("plain mode renders the unrepairable diagnostic on stderr with exit 20", async () => {
		const fixture = repairFixture({
			listeners: { "9222": FOREIGN_LISTENER },
		});
		const run = await runRepair(
			["repair", "--plain", "--run-id", "plain-unrepairable"],
			fixture,
		);

		expect(run.exitCode).toBe(20);
		expect(run.stdout).toBe("");
		expect(run.stderr).toContain("unrepairable");
		expect(run.stderr).toContain("run_id=plain-unrepairable");
	});
});

type ReemitScenario = {
	label: string;
	checkStationId: string;
	reason: string;
	argv?: readonly string[];
	fixture: () => RepairFixture;
};

const CONNECTION_REFUSED = () => new Error("connect ECONNREFUSED");

const reemitScenarios: readonly ReemitScenario[] = [
	{
		label: "no listener answers on the resolved endpoint",
		checkStationId: "check.endpoint_unreachable",
		reason: "no_listener",
		fixture: () =>
			repairFixture({ version: CONNECTION_REFUSED(), listeners: {} }),
	},
	{
		label: "localhost alias endpoint",
		checkStationId: "check.non_loopback",
		reason: "localhost_alias",
		argv: ["repair", "--endpoint", "http://localhost:9222"],
		fixture: () => repairFixture(),
	},
	{
		label: "malformed /json/version payload",
		checkStationId: "check.invalid_cdp",
		reason: "malformed_json_version",
		fixture: () =>
			repairFixture({
				version: { "User-Agent": HEADED_UA, webSocketDebuggerUrl: BROWSER_WS },
			}),
	},
	{
		label: "listener probe uninspectable while CDP answers",
		checkStationId: "check.port_occupied_foreign",
		reason: "listener_uninspectable",
		fixture: () =>
			repairFixture({
				findListenerError: new WarmChromeRuntimeError(
					"listener_uninspectable",
					"Could not run the CDP listener probe.",
				),
			}),
	},
	{
		label: "real Chrome answers headless (binary passes, UA rejects)",
		checkStationId: "check.wrong_browser",
		reason: "headless_not_headed",
		fixture: () =>
			repairFixture({
				cdp: healthyCdp({
					"Browser.getVersion": {
						product: "HeadlessChrome/138.0.7204.49",
						userAgent:
							"Mozilla/5.0 (Macintosh) AppleWebKit/537.36 HeadlessChrome/138.0.0.0 Safari/537.36",
					},
				}),
			}),
	},
	{
		label: "throwaway temporary listener profile is never mutated",
		checkStationId: "check.unsafe_profile",
		reason: "throwaway_profile",
		fixture: () =>
			repairFixture({
				listeners: { "9222": chromeListener({ profile: "/tmp/warm-profile" }) },
				profiles: { "/tmp/warm-profile": profileStat("/tmp/warm-profile") },
			}),
	},
	{
		label: "listener argv uses a different CDP port",
		checkStationId: "check.listener_mismatch",
		reason: "port_mismatch",
		fixture: () =>
			repairFixture({ listeners: { "9222": chromeListener({ port: "9333" }) } }),
	},
];

describe("warm-chrome repair re-emit rule (U7): proof failures via repair are check-owned stations", () => {
	const reemitted = resolveWarmChromeReemittedStations("repair");

	for (const scenario of reemitScenarios) {
		test(`${scenario.checkStationId}/${scenario.reason}: ${scenario.label}`, async () => {
			// Mechanical lookup through the U3 re-emit map: the station object is
			// the check-owned declaration by reference, so a diverging envelope is
			// caught as drift here, not re-declared as a repair station.
			const station = reemitted.find(
				(candidate) => candidate.id === scenario.checkStationId,
			);
			if (!station) {
				throw new Error(
					`re-emit map does not reference ${scenario.checkStationId}`,
				);
			}
			const argv = scenario.argv ?? ["repair"];
			const fixture = scenario.fixture();
			const run = await runRepair(argv, fixture);

			const envelope = assertStationEnvelope(
				station,
				toProcessResult(scenario.checkStationId, argv, run),
			);
			expect(
				(envelope as { data?: Record<string, unknown> }).data?.reason,
			).toBe(scenario.reason);
			expectNoProcessAffectingCalls(fixture);
		});
	}

	test("chassis-owned invalid_usage and runtime_failure re-emit through repair too", async () => {
		const usageStation = reemitted.find(
			(candidate) => candidate.id === "check.invalid_usage",
		);
		const failureStation = reemitted.find(
			(candidate) => candidate.id === "check.runtime_failure",
		);
		if (!usageStation || !failureStation) {
			throw new Error("re-emit map is missing the chassis-owned stations");
		}

		const usageArgv = ["repair", "--bogus"];
		const usageRun = await runRepair(usageArgv, repairFixture());
		assertStationEnvelope(
			usageStation,
			toProcessResult("check.invalid_usage", usageArgv, usageRun),
		);

		const failureArgv = ["repair"];
		const failureRun = await runRepair(
			failureArgv,
			repairFixture({
				findListenerError: new Error("lsof exploded with a hostile message"),
			}),
		);
		assertStationEnvelope(
			failureStation,
			toProcessResult("check.runtime_failure", failureArgv, failureRun),
		);
		expect(failureRun.stdout).not.toContain("hostile message");
	});
});

describe("warm-chrome repair station evidence (U7)", () => {
	test("both repair stations attach evidence and stop being missing", async () => {
		const evidence: WarmChromeBranchStationEvidence[] = [];

		const stationRuns: Array<{
			stationId: string;
			argv: readonly string[];
			fixture: RepairFixture;
		}> = [
			{
				stationId: "repair.repaired",
				argv: ["repair"],
				fixture: repairFixture({
					profiles: {
						[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE, {
							mode: "755",
						}),
					},
				}),
			},
			{
				stationId: "repair.unrepairable",
				argv: ["repair"],
				fixture: repairFixture({ listeners: { "9222": FOREIGN_LISTENER } }),
			},
		];

		for (const { stationId, argv, fixture } of stationRuns) {
			const station = repairStation(stationId);
			const run = await runRepair(argv, fixture);
			const result = toProcessResult(stationId, argv, run);
			const envelope = assertStationEnvelope(station, result);
			evidence.push(buildStationEvidence(station, result, envelope));
		}

		const expectedMissing = (
			warmChromeBranchStationCatalog as readonly BranchStation[]
		)
			.map((station) => station.id)
			.filter((stationId) => !stationId.startsWith("repair."))
			.sort();
		expect(listMissingWarmChromeBranchStationEvidence(evidence)).toEqual(
			expectedMissing,
		);

		const stationMap = projectWarmChromeBranchStationEvidence(evidence);
		const repairFindings = stationMap.findings.filter((finding) =>
			finding.station_id.startsWith("repair."),
		);
		expect(repairFindings).toEqual([]);
	});
});

describe("warm-chrome repair reason union (U7)", () => {
	test("every unrepairable scenario reason is a member of the closed repair-owned union", () => {
		const reasons: readonly string[] = WARM_CHROME_REPAIR_REASONS.unrepairable;
		for (const reason of [
			"foreign_listener_on_port",
			"devtools_active_port_symlink",
			"profile_not_owned",
			"profile_dir_uncreatable",
		]) {
			expect(reasons).toContain(reason);
		}
	});
});
