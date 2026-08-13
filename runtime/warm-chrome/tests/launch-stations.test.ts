// U6: launch lifecycle stations driven through main(argv, deps) with a fake
// runtime seam and fake proof deps, mirroring check-stations.test.ts. The
// fixture is a local variant (repo test convention: copy, don't cross-import
// test helpers) with one deliberate difference: a VIRTUAL CLOCK advanced by
// runtime.sleep, so the exported readiness budget is exercised mechanically
// without real 15s waits.
import { describe, expect, test } from "bun:test";
import type { BranchStation } from "@side-quest/cli-command-facade";
import {
	assertStationEnvelope,
	buildStationEvidence,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";

import {
	projectWarmChromeStationEnvelopeExpectation,
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
	createLaunchCommandHandler,
	WARM_CHROME_LAUNCH_READINESS_BUDGET_MS,
	WARM_CHROME_LAUNCH_READINESS_POLL_INTERVAL_MS,
	WARM_CHROME_LAUNCH_REASONS,
} from "../src/launch.ts";
import {
	WARM_CHROME_CHECK_REASONS,
	WARM_CHROME_CONTRACT_ID,
	WARM_CHROME_DEFAULT_CDP_PORT,
	WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID,
	WARM_CHROME_SCHEMA_VERSION,
} from "../src/model.ts";
import {
	createCheckCommandHandler,
	WARM_CHROME_SUGGESTED_PORT_WINDOW,
	type WarmChromeProofDeps,
} from "../src/proof.ts";
import {
	createDefaultRuntime,
	type LaunchChromeInput,
	type ListenerProcess,
	type ProfileStat,
	REAL_GOOGLE_CHROME_BINARY,
	type SingletonLock,
	type SpawnedChrome,
	type WarmChromeRuntime,
} from "../src/runtime.ts";

const HOME = "/Users/warm";
const DEDICATED_PROFILE = `${HOME}/.agent-warm-profile`;
const DEFAULT_PROFILE_ROOT = `${HOME}/Library/Application Support/Google/Chrome`;
const OBSERVED_BUILD = "Chrome/138.0.7204.49";
const HEADED_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const SPAWNED_PID = 555;
const FOREIGN_LISTENER: ListenerProcess = {
	pid: 6001,
	command: "/usr/local/bin/node /srv/dev-server.js",
};

function wsFor(port: string): string {
	return `ws://127.0.0.1:${port}/devtools/browser/warm-chrome-token`;
}

function chromeCommand(
	overrides: { port?: string; profile?: string; extraArgs?: string } = {},
): string {
	const port = ` --remote-debugging-port=${overrides.port ?? WARM_CHROME_DEFAULT_CDP_PORT}`;
	const profile = ` --user-data-dir=${overrides.profile ?? DEDICATED_PROFILE}`;
	const extra = overrides.extraArgs ? ` ${overrides.extraArgs}` : "";
	return `${REAL_GOOGLE_CHROME_BINARY}${port}${profile} --no-first-run${extra}`;
}

function chromeListener(
	overrides: Parameters<typeof chromeCommand>[0] & { pid?: number } = {},
): ListenerProcess {
	return { pid: overrides.pid ?? 4242, command: chromeCommand(overrides) };
}

function healthyVersionFor(
	port: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		Browser: OBSERVED_BUILD,
		"Protocol-Version": "1.3",
		"User-Agent": HEADED_UA,
		webSocketDebuggerUrl: wsFor(port),
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

const CONNECTION_REFUSED = () => new Error("connect ECONNREFUSED");

type VersionStep = Record<string, unknown> | Error | "hang";
type Script<T> = T | readonly T[];

type FixtureControls = {
	setListener(port: string, listener: Script<ListenerProcess | null>): void;
	setVersion(port: string, version: Script<VersionStep>): void;
};

type LaunchFixtureOptions = {
	/** Per-port listener answers. Arrays play per call; the last entry repeats. */
	listeners?: Record<string, Script<ListenerProcess | null>>;
	/** Raw error thrown by findListener for the named port (default 9242). */
	findListenerError?: Error;
	findListenerErrorPort?: string;
	/** /json/version scripts keyed by port; a missing port refuses connections. */
	versions?: Record<string, Script<VersionStep>>;
	/** CDP round-trip results keyed by method; an Error entry throws. */
	cdp?: Record<string, CdpEntry>;
	/** statProfile answers keyed by requested path; unknown paths throw. */
	profiles?: Record<string, ProfileStat>;
	/** SingletonLock answers keyed by profile dir; absent means no lock. Arrays play per read; the last entry repeats. */
	singletonLocks?: Record<string, Script<SingletonLock | null | Error>>;
	/** Process-liveness answers keyed by pid; absent means alive. */
	processAlive?: Record<number, boolean>;
	/** Extra env vars merged over the fixture's HOME. */
	env?: Record<string, string>;
	/**
	 * DevToolsActivePort file content; null means the file is absent. An array
	 * is played per read (last entry sticks) so a stale value can settle across
	 * readiness polls.
	 */
	activePort?: Script<{ port: string; wsPath: string } | null>;
	/** Spawn behavior; the default binds a healthy Warm Chrome on the port. */
	spawn?: (input: LaunchChromeInput, controls: FixtureControls) => SpawnedChrome;
};

type Fixture = {
	runtime: WarmChromeRuntime;
	deps: WarmChromeProofDeps;
	calls: {
		fetchJsonUrls: string[];
		findListenerPorts: string[];
		spawnChrome: number;
		spawnInputs: LaunchChromeInput[];
		killCalls: number;
		writeTextFile: number;
		chmod: number;
		ensureProfileDir: number;
		readDevToolsActivePort: number;
	};
	/** Virtual milliseconds consumed through runtime.now()/runtime.sleep. */
	elapsedMs: () => number;
};

// Chrome that spawned successfully binds its port and answers /json/version.
function bindHealthyWarmChrome(
	input: LaunchChromeInput,
	controls: FixtureControls,
): SpawnedChrome {
	controls.setListener(input.port, {
		pid: SPAWNED_PID,
		command: chromeCommand({ port: input.port, profile: input.profileDir }),
	});
	controls.setVersion(input.port, healthyVersionFor(input.port));
	return { pid: SPAWNED_PID, kill: async () => true };
}

function launchFixture(options: LaunchFixtureOptions = {}): Fixture {
	const calls: Fixture["calls"] = {
		fetchJsonUrls: [],
		findListenerPorts: [],
		spawnChrome: 0,
		spawnInputs: [],
		killCalls: 0,
		writeTextFile: 0,
		chmod: 0,
		ensureProfileDir: 0,
		readDevToolsActivePort: 0,
	};
	const toScript = <T,>(value: Script<T>): readonly T[] =>
		(Array.isArray(value) ? value : [value]) as readonly T[];
	const listenerScripts = new Map<
		string,
		{ script: readonly (ListenerProcess | null)[]; cursor: number }
	>();
	const versionScripts = new Map<
		string,
		{ script: readonly VersionStep[]; cursor: number }
	>();
	const controls: FixtureControls = {
		setListener: (port, listener) => {
			listenerScripts.set(port, { script: toScript(listener), cursor: 0 });
		},
		setVersion: (port, version) => {
			versionScripts.set(port, { script: toScript(version), cursor: 0 });
		},
	};
	for (const [port, script] of Object.entries(options.listeners ?? {})) {
		controls.setListener(port, script);
	}
	for (const [port, script] of Object.entries(options.versions ?? {})) {
		controls.setVersion(port, script);
	}
	const lockScripts = new Map<
		string,
		{ script: readonly (SingletonLock | null | Error)[]; cursor: number }
	>();
	for (const [dir, script] of Object.entries(options.singletonLocks ?? {})) {
		lockScripts.set(dir, { script: toScript(script), cursor: 0 });
	}
	const profiles = options.profiles ?? {
		[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE),
	};
	const cdp = options.cdp ?? healthyCdp();
	const errorPort =
		options.findListenerErrorPort ?? WARM_CHROME_DEFAULT_CDP_PORT;
	const spawnImpl = options.spawn ?? bindHealthyWarmChrome;

	// Virtual clock: sleeping advances virtual time (plus one real macrotask so
	// pending fetch microtasks always win the attach race), so the readiness
	// budget is proven against runtime.now() without real waits. The base is
	// offset above wall time so envelope durations stay positive.
	const startedAt = Date.now() + 60_000;
	let clock = startedAt;

	const runtime = createDefaultRuntime({
		env: { HOME, ...options.env },
		now: () => clock,
		sleep: async (ms: number) => {
			clock += ms;
			await new Promise((resolve) => setTimeout(resolve, 0));
		},
		fetchJson: async (url) => {
			calls.fetchJsonUrls.push(url);
			const port = new URL(url).port;
			const entry = versionScripts.get(port);
			if (!entry) throw CONNECTION_REFUSED();
			const step = entry.script[Math.min(entry.cursor, entry.script.length - 1)];
			entry.cursor += 1;
			if (step === undefined) throw CONNECTION_REFUSED();
			if (step === "hang") return new Promise<never>(() => {});
			if (step instanceof Error) throw step;
			return step;
		},
		findListener: async (port) => {
			calls.findListenerPorts.push(port);
			if (options.findListenerError && port === errorPort) {
				throw options.findListenerError;
			}
			const entry = listenerScripts.get(port);
			if (!entry) return null;
			const step = entry.script[Math.min(entry.cursor, entry.script.length - 1)];
			entry.cursor += 1;
			return step ?? null;
		},
		currentUser: async () => "501",
		statProfile: async (path) => {
			const stat = profiles[path];
			if (!stat) throw new Error(`no profile directory at ${path}`);
			return stat;
		},
		ensureProfileDir: async (path) => {
			calls.ensureProfileDir += 1;
			return path;
		},
		chmod: async () => {
			calls.chmod += 1;
		},
		writeTextFile: async () => {
			calls.writeTextFile += 1;
		},
		spawnChrome: async (input) => {
			calls.spawnChrome += 1;
			calls.spawnInputs.push(input);
			const handle = spawnImpl(input, controls);
			return {
				pid: handle.pid,
				kill: async () => {
					calls.killCalls += 1;
					return handle.kill();
				},
			};
		},
		readSingletonLock: async (profileDir) => {
			const entry = lockScripts.get(profileDir);
			if (!entry) return null;
			const step = entry.script[Math.min(entry.cursor, entry.script.length - 1)];
			entry.cursor += 1;
			if (step instanceof Error) throw step;
			return step ?? null;
		},
		isProcessAlive: async (pid) => options.processAlive?.[pid] ?? true,
	});

	const activePortScript = toScript(options.activePort ?? null);
	let activePortCursor = 0;
	const deps: WarmChromeProofDeps = {
		cdpRoundTrip: async (_wsUrl, method) => {
			const entry = cdp[method];
			if (!entry) throw new Error(`unexpected CDP method: ${method}`);
			if (entry instanceof Error) throw entry;
			return entry;
		},
		readDevToolsActivePort: async () => {
			calls.readDevToolsActivePort += 1;
			const step =
				activePortScript[
					Math.min(activePortCursor, activePortScript.length - 1)
				];
			activePortCursor += 1;
			return step ?? null;
		},
	};

	return { runtime, deps, calls, elapsedMs: () => clock - startedAt };
}

function healthyWarmChromeFixture(
	extra: Omit<LaunchFixtureOptions, "listeners" | "versions"> = {},
): Fixture {
	return launchFixture({
		listeners: {
			[WARM_CHROME_DEFAULT_CDP_PORT]: chromeListener({
				port: WARM_CHROME_DEFAULT_CDP_PORT,
			}),
		},
		versions: {
			[WARM_CHROME_DEFAULT_CDP_PORT]: healthyVersionFor(
				WARM_CHROME_DEFAULT_CDP_PORT,
			),
		},
		...extra,
	});
}

function foreignPortFixture(): Fixture {
	return launchFixture({
		listeners: { [WARM_CHROME_DEFAULT_CDP_PORT]: FOREIGN_LISTENER },
	});
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

async function runWarmChrome(
	argv: readonly string[],
	fixture: Fixture,
): Promise<CliRun> {
	const stdout = createMemoryWriter();
	const stderr = createMemoryWriter();
	const exitCode = await main(argv, {
		runtime: fixture.runtime,
		handlers: {
			launch: createLaunchCommandHandler(fixture.deps),
			check: createCheckCommandHandler(fixture.deps),
		},
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.output, stderr: stderr.output };
}

type ParsedEnvelope = {
	status: string;
	run_id: string;
	data?: Record<string, unknown>;
	error?: {
		code: string;
		exit_code: number;
		failure_domain?: string;
		hint?: { summary?: string };
	};
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

function stationById(stationId: string): BranchStation {
	const station = (
		warmChromeBranchStationCatalog as readonly BranchStation[]
	).find((candidate) => candidate.id === stationId);
	if (!station) throw new Error(`unknown station: ${stationId}`);
	return station;
}

function expectSpawnedUnverified(
	run: CliRun,
	expectedReason: string,
	label: string,
): ParsedEnvelope {
	if (run.exitCode !== 20) {
		throw new Error(
			`${label}: expected exit 20, got ${run.exitCode}\nstdout=${run.stdout}\nstderr=${run.stderr}`,
		);
	}
	const envelope = parseEnvelope(run);
	expect(envelope.error?.code).toBe("spawned_unverified");
	expect(envelope.data?.reason).toBe(expectedReason);
	expect(envelope.data?.contract_id).toBe(WARM_CHROME_CONTRACT_ID);
	expect(envelope.data?.schema_version).toBe(WARM_CHROME_SCHEMA_VERSION);
	// Catalog pin: spawned_unverified routes to inspect_diagnostics, and the
	// exit-20 envelope carries the no_adapter_fallback constraint.
	expect(envelope.continuation?.next_action_id).toBe("inspect_diagnostics");
	expect(envelope.continuation?.constraints?.[0]?.id).toBe(
		WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID,
	);
	return envelope;
}

describe("warm-chrome launch stations (U6): spawn lifecycle", () => {
	test("launch.launched: free convention port spawns Chrome and the ok envelope reflects the actual port", async () => {
		const fixture = launchFixture();
		const argv = ["launch", "--run-id", "launched-run"] as const;
		const run = await runWarmChrome(argv, fixture);

		expect(run.exitCode).toBe(0);
		const envelope = assertStationEnvelope(
			stationById("launch.launched"),
			toProcessResult("launch.launched", argv, run),
		);
		const parsed = parseEnvelope(run);
		expect(parsed.data?.endpoint).toBe(
			`http://127.0.0.1:${WARM_CHROME_DEFAULT_CDP_PORT}`,
		);
		expect(parsed.data?.port).toBe(WARM_CHROME_DEFAULT_CDP_PORT);
		expect(parsed.data?.browser_pid).toBe(SPAWNED_PID);
		expect(parsed.data?.launch_performed).toBe(true);
		expect(parsed.data?.web_socket_debugger_url).toBe(
			wsFor(WARM_CHROME_DEFAULT_CDP_PORT),
		);
		const action = parsed.runtime_actions?.[0];
		expect(action?.id).toBe("use_verified_endpoint");
		// R8: guidance carries the ACTUAL verified endpoint.
		expect(action?.summary).toContain(
			`http://127.0.0.1:${WARM_CHROME_DEFAULT_CDP_PORT}`,
		);
		expect(parsed.continuation?.next_action_id).toBe("use_verified_endpoint");
		// writes_browser_state pin: the spawn seam ran exactly once.
		expect(fixture.calls.spawnChrome).toBe(1);
		expect(fixture.calls.ensureProfileDir).toBe(1);
		expect(fixture.calls.spawnInputs[0]?.profileDirectory).toBe("Default");
		expect(envelope.status).toBe("ok");
	});

	test("launch.already_verified: healthy Warm Chrome short-circuits and the spawn seam is never touched (no_spawn pin)", async () => {
		const fixture = healthyWarmChromeFixture();
		const argv = ["launch", "--run-id", "verified-run"] as const;
		const run = await runWarmChrome(argv, fixture);

		expect(run.exitCode).toBe(0);
		assertStationEnvelope(
			stationById("launch.already_verified"),
			toProcessResult("launch.already_verified", argv, run),
		);
		const parsed = parseEnvelope(run);
		expect(parsed.data?.launch_performed).toBe(false);
		expect(parsed.data?.endpoint).toBe(
			`http://127.0.0.1:${WARM_CHROME_DEFAULT_CDP_PORT}`,
		);
		// no_spawn pin proven through the seam spies.
		expect(fixture.calls.spawnChrome).toBe(0);
		expect(fixture.calls.writeTextFile).toBe(0);
		expect(fixture.calls.chmod).toBe(0);
		expect(fixture.calls.ensureProfileDir).toBe(0);
	});

		test("zero-flag launch reuses any verified dedicated profile instead of injecting the default", async () => {
			const otherProfile = `${HOME}/other-warm-profile`;
			const fixture = launchFixture({
				listeners: {
					[WARM_CHROME_DEFAULT_CDP_PORT]: chromeListener({
						port: WARM_CHROME_DEFAULT_CDP_PORT,
						profile: otherProfile,
					}),
				},
				versions: {
					[WARM_CHROME_DEFAULT_CDP_PORT]: healthyVersionFor(
						WARM_CHROME_DEFAULT_CDP_PORT,
					),
				},
				profiles: { [otherProfile]: profileStat(otherProfile) },
			});
		const run = await runWarmChrome(["launch"], fixture);

		expect(run.exitCode).toBe(0);
		const parsed = parseEnvelope(run);
		expect(parsed.data?.profile_dir).toBe(otherProfile);
		expect(parsed.data?.launch_performed).toBe(false);
		expect(fixture.calls.spawnChrome).toBe(0);
	});

	test("WARM_CHROME_PROFILE_DIR env supplies the launch profile when --profile is absent", async () => {
		const envProfile = `${HOME}/env-warm-profile`;
		const fixture = launchFixture({
			env: { WARM_CHROME_PROFILE_DIR: envProfile },
			profiles: { [envProfile]: profileStat(envProfile) },
		});
		const run = await runWarmChrome(["launch"], fixture);

		expect(run.exitCode).toBe(0);
		expect(fixture.calls.spawnInputs[0]?.profileDir).toBe(envProfile);
	});

	test("explicitly-empty WARM_CHROME_PROFILE_DIR still falls back to the dedicated default profile", async () => {
		const fixture = launchFixture({
			env: { WARM_CHROME_PROFILE_DIR: "" },
		});
		const run = await runWarmChrome(["launch"], fixture);

		expect(run.exitCode).toBe(0);
		expect(fixture.calls.spawnInputs[0]?.profileDir).toBe(DEDICATED_PROFILE);
	});

	test("competing-instance guard (R10a): launch --port 9250 with healthy Warm Chrome on 9222 lands already_verified carrying the 9222 endpoint, no spawn", async () => {
		// The guard probes the CONVENTION port (9222), not the default: seed a
		// healthy Warm Chrome there so --port 9250 folds back onto it.
		const fixture = launchFixture({
			listeners: { "9222": chromeListener({ port: "9222" }) },
			versions: { "9222": healthyVersionFor("9222") },
		});
		const run = await runWarmChrome(["launch", "--port", "9250"], fixture);

		expect(run.exitCode).toBe(0);
		const parsed = parseEnvelope(run);
		expect(parsed.status).toBe("ok");
		// The ok envelope is the endpoint authority: it names the verified 9222
		// Warm Chrome, not the requested 9250 convention drift feeder.
		expect(parsed.data?.endpoint).toBe("http://127.0.0.1:9222");
		expect(parsed.data?.port).toBe("9222");
		expect(parsed.data?.launch_performed).toBe(false);
		expect(parsed.runtime_actions?.[0]?.summary).toContain(
			"http://127.0.0.1:9222",
		);
		expect(fixture.calls.spawnChrome).toBe(0);
		expect(fixture.calls.ensureProfileDir).toBe(0);
	});

	test("competing-instance guard honors an explicit --profile: a verified convention Chrome on another profile fails loudly, no spawn, no exit 0", async () => {
		const otherProfile = `${HOME}/.warm-b`;
		const fixture = launchFixture({
			listeners: { "9222": chromeListener({ port: "9222" }) },
			versions: { "9222": healthyVersionFor("9222") },
			profiles: {
				[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE),
				[otherProfile]: profileStat(otherProfile),
			},
		});
		const run = await runWarmChrome(
			["launch", "--port", "9300", "--profile", otherProfile],
			fixture,
		);

		// The caller's declared profile expectation is violated by the verified
		// 9222 Chrome: never an exit-0 already_verified with the wrong profile,
		// and never a second Warm Chrome spawn.
		expect(run.exitCode).toBe(20);
		const parsed = parseEnvelope(run);
		expect(parsed.error?.code).toBe("listener_mismatch");
		expect(parsed.data?.reason).toBe("profile_mismatch");
		expect(fixture.calls.spawnChrome).toBe(0);
	});

	test("competing-instance guard escape (sixth-pass HIGH): a not-yet-existing --profile must still block the spawn, not fall through", async () => {
		// Same as the honors-explicit-profile test, but the caller's --profile
		// does NOT exist yet. The convention probe against 9222 reaches the
		// provided-profile step and statProfile throws, so the proof fails with
		// unsafe_profile/invalid_profile_path — NOT listener_mismatch. The guard
		// keyed only on listener_mismatch would fall through and spawn a second
		// Warm Chrome (the adapter-drift feeder the guard exists to block).
		const missingProfile = `${HOME}/.warm-not-yet`;
		const fixture = launchFixture({
			listeners: { "9222": chromeListener({ port: "9222" }) },
			versions: { "9222": healthyVersionFor("9222") },
			profiles: {
				[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE),
				// missingProfile deliberately absent — statProfile throws for it.
			},
		});
		const run = await runWarmChrome(
			["launch", "--port", "9300", "--profile", missingProfile],
			fixture,
		);

		// A verified Warm Chrome already holds the convention port: refuse loudly
		// and never spawn a second instance, regardless of the --profile verdict
		// shape. Exit 20, no spawn, no profile writes.
		expect(fixture.calls.spawnChrome).toBe(0);
		expect(run.exitCode).toBe(20);
	});

	test("launch.port_occupied_foreign: foreign listener fails closed without spawn and carries a suggestion", async () => {
		const fixture = foreignPortFixture();
		const argv = ["launch", "--run-id", "foreign-run"] as const;
		const run = await runWarmChrome(argv, fixture);

		expect(run.exitCode).toBe(20);
		assertStationEnvelope(
			stationById("launch.port_occupied_foreign"),
			toProcessResult("launch.port_occupied_foreign", argv, run),
		);
		const parsed = parseEnvelope(run);
		expect(parsed.error?.code).toBe("port_occupied_foreign");
		expect(parsed.data?.reason).toBe("foreign_listener");
		expect(parsed.data?.suggested_explicit_port).toBe(
			WARM_CHROME_SUGGESTED_PORT_WINDOW.start,
		);
		expect(parsed.continuation?.next_action_id).toBe(
			"rerun_with_explicit_port",
		);
		expect(parsed.continuation?.constraints?.[0]?.id).toBe(
			WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID,
		);
		// fails_closed_without_spawn pin: no spawn, no writes, no profile setup.
		expect(fixture.calls.spawnChrome).toBe(0);
		expect(fixture.calls.writeTextFile).toBe(0);
		expect(fixture.calls.chmod).toBe(0);
		expect(fixture.calls.ensureProfileDir).toBe(0);
	});

	test("rerun-with-proof: launch --port <suggested> verifies on the new port while a bare check still fails on the default port (default did not move)", async () => {
		const fixture = foreignPortFixture();
		const suggested = String(WARM_CHROME_SUGGESTED_PORT_WINDOW.start);
		const launchRun = await runWarmChrome(
			["launch", "--port", suggested],
			fixture,
		);

		expect(launchRun.exitCode).toBe(0);
		const launched = parseEnvelope(launchRun);
		expect(launched.data?.endpoint).toBe(`http://127.0.0.1:${suggested}`);
		expect(launched.data?.port).toBe(suggested);
		expect(launched.data?.launch_performed).toBe(true);
		expect(fixture.calls.spawnChrome).toBe(1);
		expect(fixture.calls.spawnInputs[0]?.port).toBe(suggested);

		const checkRun = await runWarmChrome(["check"], fixture);
		expect(checkRun.exitCode).toBe(20);
		const checked = parseEnvelope(checkRun);
		expect(checked.error?.code).toBe("port_occupied_foreign");
		expect(checked.data?.reason).toBe("foreign_listener");
	});

	test("pre-bind refusal (R9): a SingletonLock on the dedicated profile with a silent port refuses to spawn", async () => {
		const fixture = launchFixture({
			singletonLocks: {
				[DEDICATED_PROFILE]: {
					raw: "warm-mac.local-4321",
					hostname: "warm-mac.local",
					pid: 4321,
					local: true,
				},
			},
		});
		const run = await runWarmChrome(["launch"], fixture);

		const envelope = expectSpawnedUnverified(
			run,
			"prior_launch_mid_startup",
			"pre-bind refusal",
		);
		expect(envelope.data?.lock_pid).toBe(4321);
		// The refusal happens before any mutation: no spawn, no profile setup.
		expect(fixture.calls.spawnChrome).toBe(0);
		expect(fixture.calls.ensureProfileDir).toBe(0);
		expect(fixture.calls.writeTextFile).toBe(0);
	});

	test("stale SingletonLock with a dead pid does not permanently brick launch", async () => {
		const fixture = launchFixture({
			singletonLocks: {
				[DEDICATED_PROFILE]: {
					raw: "warm-mac.local-4321",
					hostname: "warm-mac.local",
					pid: 4321,
					local: true,
				},
			},
			processAlive: { 4321: false },
		});
		const run = await runWarmChrome(["launch"], fixture);

		expect(run.exitCode).toBe(0);
		const parsed = parseEnvelope(run);
		expect(parsed.status).toBe("ok");
		expect(parsed.data?.launch_performed).toBe(true);
		expect(fixture.calls.spawnChrome).toBe(1);
		expect(fixture.calls.ensureProfileDir).toBe(1);
	});

	// Regression (re-audit): a foreign-host lock (synced/NFS home shared across a
	// fleet) names a pid the local kernel cannot probe. Its remote pid must NOT be
	// aliased onto a live local process — that would re-brick launch exactly like
	// the stale same-host lock the liveness gate was added to fix. processAlive
	// reports the aliased pid alive, but launch must ignore the foreign lock and
	// spawn anyway.
	test("foreign-host SingletonLock does not brick launch even when its pid aliases a live local process", async () => {
		const fixture = launchFixture({
			singletonLocks: {
				[DEDICATED_PROFILE]: {
					raw: "other-host-77",
					hostname: "other-host",
					pid: 77,
					local: false,
				},
			},
			processAlive: { 77: true },
		});
		const run = await runWarmChrome(["launch"], fixture);

		expect(run.exitCode).toBe(0);
		const parsed = parseEnvelope(run);
		expect(parsed.status).toBe("ok");
		expect(parsed.data?.launch_performed).toBe(true);
		expect(fixture.calls.spawnChrome).toBe(1);
	});

	test("readiness budget exhaustion: a spawn that never binds lands spawned_unverified within the exported budget", async () => {
		// Never-bound-timeout case: the port is genuinely free (no SingletonLock),
		// so the spawn is PERMITTED; the bounded poll then exhausts.
		const fixture = launchFixture({
			spawn: () => ({ pid: 777, kill: async () => true }),
		});
		const argv = ["launch", "--run-id", "timeout-run"] as const;
		const run = await runWarmChrome(argv, fixture);

		const envelope = expectSpawnedUnverified(
			run,
			"readiness_timeout",
			"readiness timeout",
		);
		assertStationEnvelope(
			stationById("launch.spawned_unverified"),
			toProcessResult("launch.spawned_unverified", argv, run),
		);
		expect(fixture.calls.spawnChrome).toBe(1);
		expect(envelope.data?.spawned_pid).toBe(777);
		expect(envelope.data?.readiness_budget_ms).toBe(
			WARM_CHROME_LAUNCH_READINESS_BUDGET_MS,
		);
		expect(envelope.data?.last_check_code).toBe("endpoint_unreachable");
		// The envelope names the mutated state and forbids a blind respawn.
		expect(run.stdout).toContain("browser state");
		// The poll is bounded: the virtual clock proves the budget was consumed
		// and the loop then stopped.
		expect(WARM_CHROME_LAUNCH_READINESS_BUDGET_MS).toBe(15_000);
		expect(WARM_CHROME_LAUNCH_READINESS_POLL_INTERVAL_MS).toBe(500);
		expect(fixture.elapsedMs()).toBeGreaterThanOrEqual(
			WARM_CHROME_LAUNCH_READINESS_BUDGET_MS,
		);
	});

	test("post-spawn unsafe_profile keeps repair_profile as the secondary action alongside inspect_diagnostics", async () => {
		const fixture = launchFixture({
			profiles: {
				[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE, { mode: "755" }),
			},
		});
		const run = await runWarmChrome(["launch"], fixture);

		const envelope = expectSpawnedUnverified(
			run,
			"unsafe_profile_permissions",
			"post-spawn unsafe_profile",
		);
		expect(fixture.calls.spawnChrome).toBe(1);
		expect(envelope.data?.failed_check_code).toBe("unsafe_profile");
		// The check station's primary action rides runtime_actions as a
		// secondary entry so the agent keeps the known-good repair path
		// after the spawn mutation (plan: launch/repair carry-through rule).
		expect(envelope.runtime_actions?.map((action) => action.id)).toEqual([
			"inspect_diagnostics",
			"repair_profile",
		]);
		expect(envelope.continuation?.next_action_id).toBe("inspect_diagnostics");
		expect(envelope.error?.hint?.summary).toContain("browser state");
		expect(envelope.error?.hint?.summary).toContain("Repair owner-only");
	});

	test("spawn failure lands spawned_unverified instead of generic runtime_failure", async () => {
		const fixture = launchFixture({
			spawn: () => {
				throw new Error("ENOENT");
			},
		});
		const run = await runWarmChrome(["launch"], fixture);

		const envelope = expectSpawnedUnverified(run, "spawn_failed", "spawn failed");
		expect(envelope.data?.profile_dir).toBe(DEDICATED_PROFILE);
		expect(fixture.calls.spawnChrome).toBe(1);
		expect(fixture.calls.ensureProfileDir).toBe(1);
	});

	test("spawned child exit during readiness poll lands spawned_unverified without burning the full budget", async () => {
		const fixture = launchFixture({
			spawn: () => ({ pid: 777, kill: async () => true }),
			processAlive: { 777: false },
		});
		const run = await runWarmChrome(["launch"], fixture);

		const envelope = expectSpawnedUnverified(run, "spawn_failed", "spawn exit");
		expect(envelope.data?.spawned_pid).toBe(777);
		expect(fixture.elapsedMs()).toBeLessThan(
			WARM_CHROME_LAUNCH_READINESS_BUDGET_MS,
		);
	});
});

describe("warm-chrome launch race policy (U6 R10)", () => {
	const loserSpawn = (killResult: () => Promise<boolean>) => {
		return (input: LaunchChromeInput, controls: FixtureControls): SpawnedChrome => {
			// The interleaved rival bound the port first: the verified listener is
			// pid 100, our own spawned child is pid 200.
			controls.setListener(input.port, {
				pid: 100,
				command: chromeCommand({ port: input.port, profile: input.profileDir }),
			});
			controls.setVersion(input.port, healthyVersionFor(input.port));
			return { pid: 200, kill: killResult };
		};
	};

	const deadChildBeforeWinnerFixture = (
		lockScript: Script<SingletonLock | null | Error>,
	) =>
		launchFixture({
			listeners: {
				[WARM_CHROME_DEFAULT_CDP_PORT]: [
					null,
					null,
					{
						pid: 100,
						command: chromeCommand({
							port: WARM_CHROME_DEFAULT_CDP_PORT,
							profile: DEDICATED_PROFILE,
						}),
					},
				],
			},
			versions: {
				[WARM_CHROME_DEFAULT_CDP_PORT]: [
					CONNECTION_REFUSED(),
					CONNECTION_REFUSED(),
					healthyVersionFor(WARM_CHROME_DEFAULT_CDP_PORT),
				],
			},
			spawn: () => ({ pid: 200, kill: async () => true }),
			processAlive: { 200: false, 100: true },
			singletonLocks: {
				[DEDICATED_PROFILE]: lockScript,
			},
		});

	test("interleaved launches: the loser compares pids, kills only its own child, and lands already_verified", async () => {
		const fixture = launchFixture({ spawn: loserSpawn(async () => true) });
		const argv = ["launch", "--run-id", "race-run"] as const;
		const run = await runWarmChrome(argv, fixture);

		expect(run.exitCode).toBe(0);
		assertStationEnvelope(
			stationById("launch.already_verified"),
			toProcessResult("launch.already_verified", argv, run),
		);
		const parsed = parseEnvelope(run);
		// Exactly one surviving Chrome: the verified winner, never our child.
		expect(parsed.data?.browser_pid).toBe(100);
		expect(parsed.data?.launch_performed).toBe(true);
		expect(fixture.calls.spawnChrome).toBe(1);
		expect(fixture.calls.killCalls).toBe(1);
	});

	test("own-child kill returning false lands spawned_unverified with reason own_child_kill_failed", async () => {
		const fixture = launchFixture({ spawn: loserSpawn(async () => false) });
		const run = await runWarmChrome(["launch"], fixture);

		const envelope = expectSpawnedUnverified(
			run,
			"own_child_kill_failed",
			"kill failed",
		);
		expect(envelope.data?.spawned_pid).toBe(200);
		expect(envelope.data?.verified_pid).toBe(100);
		expect(fixture.calls.killCalls).toBe(1);
	});

	test("loser child dead before the winner's endpoint verifies: the poll keeps going and converges on already_verified", async () => {
		// The retired loser (pid 200, already exited) must not mint spawn_failed
		// while the winner (pid 100, holding the SingletonLock) is still binding
		// its endpoint — the exact interleaved-launch window resolveSpawnRace
		// exists to converge.
		const fixture = deadChildBeforeWinnerFixture([
			null,
			{
				raw: "warm-mac.local-100",
				hostname: "warm-mac.local",
				pid: 100,
				local: true,
			},
		]);
		const run = await runWarmChrome(["launch"], fixture);

		expect(run.exitCode).toBe(0);
		const parsed = parseEnvelope(run);
		expect(parsed.status).toBe("ok");
		expect(parsed.data?.browser_pid).toBe(100);
		expect(parsed.data?.launch_performed).toBe(true);
	});

	test("unreadable SingletonLock during a dead-child race keeps polling instead of minting spawn_failed", async () => {
		const fixture = deadChildBeforeWinnerFixture([
			null,
			new Error("EACCES: SingletonLock unreadable during race"),
		]);
		const run = await runWarmChrome(["launch"], fixture);

		expect(run.exitCode).toBe(0);
		const parsed = parseEnvelope(run);
		expect(parsed.status).toBe("ok");
		expect(parsed.data?.browser_pid).toBe(100);
		expect(parsed.data?.launch_performed).toBe(true);
	});

	test("ProcessSingleton pre-retired the child: kill on the already-exited pid does not change the station", async () => {
		const fixture = launchFixture({
			spawn: loserSpawn(async () => {
				throw new Error("kill ESRCH: no such process");
			}),
		});
		const run = await runWarmChrome(["launch"], fixture);

		expect(run.exitCode).toBe(0);
		const parsed = parseEnvelope(run);
		expect(parsed.status).toBe("ok");
		expect(parsed.data?.browser_pid).toBe(100);
		expect(parsed.data?.launch_performed).toBe(true);
		expect(fixture.calls.killCalls).toBe(1);
	});

	test("transient listener disappearance during startup keeps polling and recovers", async () => {
		const fixture = launchFixture({
			spawn: (input, controls) => {
				controls.setListener(input.port, [
					{
						pid: SPAWNED_PID,
						command: chromeCommand({
							port: input.port,
							profile: input.profileDir,
						}),
					},
					null,
					{
						pid: SPAWNED_PID,
						command: chromeCommand({
							port: input.port,
							profile: input.profileDir,
						}),
					},
					{
						pid: SPAWNED_PID,
						command: chromeCommand({
							port: input.port,
							profile: input.profileDir,
						}),
					},
				]);
				controls.setVersion(input.port, healthyVersionFor(input.port));
				return { pid: SPAWNED_PID, kill: async () => true };
			},
		});
		const run = await runWarmChrome(["launch"], fixture);

		expect(run.exitCode).toBe(0);
		const parsed = parseEnvelope(run);
		expect(parsed.status).toBe("ok");
		expect(parsed.data?.launch_performed).toBe(true);
		expect(fixture.calls.fetchJsonUrls.length).toBeGreaterThanOrEqual(2);
	});

	// Chrome only writes DevToolsActivePort for an ephemeral port. A persistent
	// file beside a fixed-port launch is stale hint material, not browser identity;
	// the live HTTP, process, websocket, CDP, and profile proof remains authority.
	test("persistent stale DevToolsActivePort does not reject a fixed-port launch", async () => {
		const fixture = launchFixture({
			activePort: { port: "9222", wsPath: "/devtools/browser/stale-token" },
		});
		const argv = ["launch", "--run-id", "stale-fixed-port"] as const;
		const run = await runWarmChrome(argv, fixture);

		expect(run.exitCode).toBe(0);
		assertStationEnvelope(
			stationById("launch.launched"),
			toProcessResult("launch.launched", argv, run),
		);
		const envelope = parseEnvelope(run);
		expect(envelope.data?.launch_performed).toBe(true);
		expect(fixture.calls.readDevToolsActivePort).toBe(0);
		expect(fixture.elapsedMs()).toBeLessThan(
			WARM_CHROME_LAUNCH_READINESS_BUDGET_MS,
		);
	});
});

describe("warm-chrome launch pre-spawn guards (U6)", () => {
	test("launch --chrome with a non-real binary fails closed before any probe or spawn", async () => {
		const fixture = healthyWarmChromeFixture();
		const run = await runWarmChrome(
			[
				"launch",
				"--chrome",
				"/Applications/Chromium.app/Contents/MacOS/Chromium",
			],
			fixture,
		);

		expect(run.exitCode).toBe(20);
		const parsed = parseEnvelope(run);
		expect(parsed.error?.code).toBe("wrong_browser");
		expect(parsed.data?.reason).toBe("chromium");
		// A healthy endpoint proves the RUNNING Chrome, not the supplied binary:
		// the guard fires before the reuse probe could mask it.
		expect(fixture.calls.fetchJsonUrls).toEqual([]);
		expect(fixture.calls.spawnChrome).toBe(0);
	});

	test("launch --profile pointing at the default Chrome profile fails closed without spawn", async () => {
		const fixture = launchFixture();
		const run = await runWarmChrome(
			["launch", "--profile", DEFAULT_PROFILE_ROOT],
			fixture,
		);

		expect(run.exitCode).toBe(20);
		const parsed = parseEnvelope(run);
		expect(parsed.error?.code).toBe("unsafe_profile");
		expect(parsed.data?.reason).toBe("default_profile");
		expect(parsed.continuation?.next_action_id).toBe("change_input");
		expect(fixture.calls.spawnChrome).toBe(0);
		expect(fixture.calls.ensureProfileDir).toBe(0);
	});

	// A dedicated-looking --profile that is a SYMLINK resolving into the default
	// Chrome tree passes the textual guard; statProfile resolves the realpath,
	// so posture must be re-asserted against it and the launch must fail closed
	// BEFORE ensureProfileDir chmods or spawnChrome attaches to the everyday
	// profile.
	test("launch --profile symlinked into the default Chrome tree fails closed before any spawn or chmod", async () => {
		const symlink = `${HOME}/warm-link`;
		const fixture = launchFixture({
			profiles: {
				// The realpath resolves into the default Chrome profile.
				[symlink]: profileStat(symlink, {
					realPath: `${DEFAULT_PROFILE_ROOT}/Default`,
				}),
			},
		});
		const run = await runWarmChrome(["launch", "--profile", symlink], fixture);

		expect(run.exitCode).toBe(20);
		const parsed = parseEnvelope(run);
		expect(parsed.error?.code).toBe("unsafe_profile");
		expect(parsed.data?.reason).toBe("default_profile");
		expect(parsed.continuation?.next_action_id).toBe("change_input");
		// No mutation and no spawn against the resolved default profile.
		expect(fixture.calls.spawnChrome).toBe(0);
		expect(fixture.calls.ensureProfileDir).toBe(0);
		expect(fixture.calls.chmod).toBe(0);
	});
});

describe("warm-chrome launch re-emit rule (U6 via U3 map)", () => {
	type ReemitScenario = {
		label: string;
		stationId: string;
		expectedActionId?: string;
		argv?: readonly string[];
		fixture: () => Fixture;
	};

	const reemitScenarios: readonly ReemitScenario[] = [
		{
			label: "usage failure: launch --bogus-flag",
			stationId: "check.invalid_usage",
			argv: ["launch", "--bogus-flag"],
			fixture: () => launchFixture(),
		},
		{
			label: "attach hang past the bounded budget (port occupied, fail closed)",
			stationId: "check.endpoint_unreachable",
			expectedActionId: "inspect_listener",
			fixture: () =>
				launchFixture({ versions: { [WARM_CHROME_DEFAULT_CDP_PORT]: "hang" } }),
		},
		{
			label: "malformed /json/version payload",
			stationId: "check.invalid_cdp",
			fixture: () =>
				launchFixture({
					listeners: {
						[WARM_CHROME_DEFAULT_CDP_PORT]: chromeListener({
							port: WARM_CHROME_DEFAULT_CDP_PORT,
						}),
					},
					versions: {
						[WARM_CHROME_DEFAULT_CDP_PORT]: {
							"User-Agent": HEADED_UA,
							webSocketDebuggerUrl: wsFor(WARM_CHROME_DEFAULT_CDP_PORT),
						},
					},
				}),
		},
		{
			label: "Chromium listener on the requested port",
			stationId: "check.wrong_browser",
			fixture: () =>
				launchFixture({
					listeners: {
						[WARM_CHROME_DEFAULT_CDP_PORT]: {
							pid: 4242,
							command: `/Applications/Chromium.app/Contents/MacOS/Chromium --remote-debugging-port=${WARM_CHROME_DEFAULT_CDP_PORT} --user-data-dir=${DEDICATED_PROFILE}`,
						},
					},
					versions: {
						[WARM_CHROME_DEFAULT_CDP_PORT]: healthyVersionFor(
							WARM_CHROME_DEFAULT_CDP_PORT,
						),
					},
				}),
		},
		{
			label: "pre-spawn unsafe profile permissions on a live listener",
			stationId: "check.unsafe_profile",
			fixture: () =>
				launchFixture({
					listeners: {
						[WARM_CHROME_DEFAULT_CDP_PORT]: chromeListener({
							port: WARM_CHROME_DEFAULT_CDP_PORT,
						}),
					},
					versions: {
						[WARM_CHROME_DEFAULT_CDP_PORT]: healthyVersionFor(
							WARM_CHROME_DEFAULT_CDP_PORT,
						),
					},
					profiles: {
						[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE, {
							mode: "755",
						}),
					},
				}),
		},
		{
			label: "listener argv uses a different CDP port",
			stationId: "check.listener_mismatch",
			fixture: () =>
				launchFixture({
					listeners: {
						[WARM_CHROME_DEFAULT_CDP_PORT]: chromeListener({ port: "9333" }),
					},
					versions: {
						[WARM_CHROME_DEFAULT_CDP_PORT]: healthyVersionFor(
							WARM_CHROME_DEFAULT_CDP_PORT,
						),
					},
				}),
		},
		{
			label: "non-loopback endpoint",
			stationId: "check.non_loopback",
			argv: ["launch", "--endpoint", "http://192.168.1.20:9222"],
			fixture: () => launchFixture(),
		},
		{
			label: "raw seam fault during verification",
			stationId: "check.runtime_failure",
			fixture: () =>
				launchFixture({
					versions: {
						[WARM_CHROME_DEFAULT_CDP_PORT]: healthyVersionFor(
							WARM_CHROME_DEFAULT_CDP_PORT,
						),
					},
					findListenerError: new Error("lsof exploded"),
				}),
		},
	];

	for (const scenario of reemitScenarios) {
		test(`${scenario.stationId}: ${scenario.label}`, async () => {
			const checkStation = stationById(scenario.stationId);
			// The re-emit map declares the station by reference (U3): the launch
			// envelope must be mechanically equivalent to the check-owned station.
			const reemitted = resolveWarmChromeReemittedStations("launch");
			expect(reemitted.map((station) => station.id)).toContain(
				scenario.stationId,
			);

			const fixture = scenario.fixture();
			const argv = scenario.argv ?? (["launch"] as const);
			const run = await runWarmChrome(argv, fixture);
			const envelope = assertStationEnvelope(
				checkStation,
				toProcessResult(scenario.stationId, argv, run),
			);
			const expectation =
				projectWarmChromeStationEnvelopeExpectation(checkStation);
			if (expectation.expectedActionId) {
				const parsed = parseEnvelope(run);
				expect(parsed.continuation?.next_action_id).toBe(
					scenario.expectedActionId ?? expectation.expectedActionId,
				);
			}
			// Every re-emitted verdict fails closed: nothing spawned.
			expect(fixture.calls.spawnChrome).toBe(0);
			expect(envelope.status).toBe("error");
		});
	}

	test("launch.port_occupied_foreign projects the same envelope expectation as check.port_occupied_foreign", () => {
		expect(
			projectWarmChromeStationEnvelopeExpectation(
				stationById("launch.port_occupied_foreign"),
			),
		).toEqual(
			projectWarmChromeStationEnvelopeExpectation(
				stationById("check.port_occupied_foreign"),
			),
		);
	});
});

describe("warm-chrome launch station evidence (U6)", () => {
	test("all four launch stations attach evidence and stop being missing", async () => {
		const evidence: WarmChromeBranchStationEvidence[] = [];
		const stationRuns: Array<{
			stationId: string;
			argv: readonly string[];
			fixture: Fixture;
		}> = [
			{ stationId: "launch.launched", argv: ["launch"], fixture: launchFixture() },
			{
				stationId: "launch.already_verified",
				argv: ["launch"],
				fixture: healthyWarmChromeFixture(),
			},
			{
				stationId: "launch.port_occupied_foreign",
				argv: ["launch"],
				fixture: foreignPortFixture(),
			},
			{
				stationId: "launch.spawned_unverified",
				argv: ["launch"],
				fixture: launchFixture({
					spawn: () => ({ pid: 777, kill: async () => true }),
				}),
			},
		];

		for (const { stationId, argv, fixture } of stationRuns) {
			const station = stationById(stationId);
			const run = await runWarmChrome(argv, fixture);
			const result = toProcessResult(stationId, argv, run);
			const envelope = assertStationEnvelope(station, result);
			evidence.push(buildStationEvidence(station, result, envelope));
		}

		expect(listMissingWarmChromeBranchStationEvidence(evidence)).toEqual(
			[
				"check.endpoint_unreachable",
				"check.invalid_cdp",
				"check.invalid_usage",
				"check.listener_mismatch",
				"check.non_loopback",
				"check.port_occupied_foreign",
				"check.runtime_failure",
				"check.unsafe_profile",
				"check.verified",
				"check.wrong_browser",
				"repair.repaired",
				"repair.unrepairable",
			].sort(),
		);

		const stationMap = projectWarmChromeBranchStationEvidence(evidence);
		const launchFindings = stationMap.findings.filter((finding) =>
			finding.station_id.startsWith("launch."),
		);
		expect(launchFindings).toEqual([]);
	});
});

describe("warm-chrome launch reason ownership (U6)", () => {
	test("spawned_unverified local reasons stay separate while wrong_browser reuses browser-class reasons", () => {
		const checkReasons = new Set<string>(
			Object.values(WARM_CHROME_CHECK_REASONS).flat(),
		);
		for (const reason of WARM_CHROME_LAUNCH_REASONS.spawned_unverified) {
			expect(checkReasons.has(reason)).toBe(false);
		}
		expect(WARM_CHROME_LAUNCH_REASONS.spawned_unverified).toContain(
			"readiness_timeout",
		);
		expect(WARM_CHROME_LAUNCH_REASONS.spawned_unverified).toContain(
			"spawn_failed",
		);
		expect(WARM_CHROME_LAUNCH_REASONS.spawned_unverified).toContain(
			"own_child_kill_failed",
		);
		expect(WARM_CHROME_LAUNCH_REASONS.wrong_browser).toContain(
			"chrome_for_testing",
		);
		expect(WARM_CHROME_LAUNCH_REASONS.wrong_browser).toContain("chromium");
		expect(WARM_CHROME_LAUNCH_REASONS.wrong_browser).toContain(
			"launch_binary_not_real_chrome",
		);
	});
});
