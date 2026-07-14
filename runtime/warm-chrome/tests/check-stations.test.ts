// U5: one scenario per check station plus the research reject rules, driven
// through main(argv, deps) with a fake runtime seam and fake proof deps.
// Evidence rows follow the U3 manifest pattern (assertStationEnvelope /
// buildStationEvidence) so the ten check stations stop being "missing".
import { describe, expect, test } from "bun:test";
import type { BranchStation } from "@side-quest/cli-command-facade";
import {
	assertCommandResultContract,
	assertNoRuntimeContractFixtureLeaks,
	assertStationEnvelope,
	buildStationEvidence,
	type CliProcessResult,
	RUNTIME_CONTRACT_REDACTION_FIXTURES,
} from "@side-quest/cli-command-facade/testing";

import { warmChromeBranchStationCatalog } from "../src/branch-station-catalog.ts";
import {
	listMissingWarmChromeBranchStationEvidence,
	projectWarmChromeBranchStationEvidence,
	type WarmChromeBranchStationEvidence,
} from "../src/branch-station-evidence.ts";
import { main } from "../src/cli.ts";
import {
	projectWarmChromeCommandDiscoveryTree,
	warmChromeContracts,
} from "../src/command-contract.ts";
import {
	WARM_CHROME_CHECK_REASONS,
	WARM_CHROME_CONTRACT_ID,
	WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID,
	WARM_CHROME_SCHEMA_VERSION,
	type WarmChromeCheckErrorCode,
	type WarmChromeCheckReason,
} from "../src/model.ts";
import {
	createCheckCommandHandler,
	WARM_CHROME_SUGGESTED_PORT_WINDOW,
	type WarmChromeProofDeps,
} from "../src/proof.ts";
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
const DEFAULT_PROFILE_ROOT = `${HOME}/Library/Application Support/Google/Chrome`;
const BROWSER_WS = "ws://127.0.0.1:9222/devtools/browser/warm-chrome-token";
const OBSERVED_BUILD = "Chrome/138.0.7204.49";
const HEADED_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

function chromeCommand(
	overrides: { port?: string | null; profile?: string | null; extraArgs?: string } = {},
): string {
	const port = overrides.port === null ? "" : ` --remote-debugging-port=${overrides.port ?? "9222"}`;
	const profile =
		overrides.profile === null
			? ""
			: ` --user-data-dir=${overrides.profile ?? DEDICATED_PROFILE}`;
	const extra = overrides.extraArgs ? ` ${overrides.extraArgs}` : "";
	return `${REAL_GOOGLE_CHROME_BINARY}${port}${profile} --no-first-run${extra}`;
}

function chromeListener(
	overrides: Parameters<typeof chromeCommand>[0] & { pid?: number } = {},
): ListenerProcess {
	return { pid: overrides.pid ?? 4242, command: chromeCommand(overrides) };
}

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

function contentionVersion(): Record<string, unknown> {
	const payload = healthyVersion();
	delete payload.webSocketDebuggerUrl;
	return payload;
}

function profileStat(path: string, overrides: Partial<ProfileStat> = {}): ProfileStat {
	return { realPath: path, mode: "700", owner: "501", ...overrides };
}

type CdpEntry = Record<string, unknown> | Error;

// Real Chrome stamps default-context page targets with the same non-empty
// GUID getBrowserContexts reports as defaultBrowserContextId (empirically
// confirmed on Chrome 149); the baseline fixture must model that shape.
const DEFAULT_CONTEXT_ID = "13DC4DAD9E537E4F4485D2F948EEA31E";

function healthyCdp(overrides: Record<string, CdpEntry> = {}): Record<string, CdpEntry> {
	return {
		"Browser.getVersion": { product: OBSERVED_BUILD, userAgent: HEADED_UA },
		"Target.getBrowserContexts": {
			browserContextIds: [],
			defaultBrowserContextId: DEFAULT_CONTEXT_ID,
		},
		"Target.getTargets": {
			targetInfos: [
				{
					type: "page",
					targetId: "page-1",
					url: "https://example.com/",
					browserContextId: DEFAULT_CONTEXT_ID,
				},
			],
		},
		...overrides,
	};
}

type VersionStep = Record<string, unknown> | Error | "hang";

type FixtureOptions = {
	/** Per-port listener answers. Arrays play per call; the last entry repeats. */
	listeners?: Record<string, ListenerProcess | null | ReadonlyArray<ListenerProcess | null>>;
	/** Raw error thrown by findListener for the named port (default 9222). */
	findListenerError?: Error;
	findListenerErrorPort?: string;
	/** /json/version script. Arrays play per call; the last entry repeats. */
	version?: VersionStep | ReadonlyArray<VersionStep>;
	/** CDP round-trip results keyed by method; an Error entry throws. */
	cdp?: Record<string, CdpEntry>;
	/** statProfile answers keyed by requested path; unknown paths throw. */
	profiles?: Record<string, ProfileStat>;
	/** DevToolsActivePort file content; null means the file is absent. */
	activePort?: { port: string; wsPath: string } | null;
};

type Fixture = {
	runtime: WarmChromeRuntime;
	deps: WarmChromeProofDeps;
	calls: {
		fetchJsonUrls: string[];
		findListenerPorts: string[];
		cdpMethods: string[];
		spawnChrome: number;
		writeTextFile: number;
		chmod: number;
		ensureProfileDir: number;
	};
};

// U6/U7 reuse shape: canned /json/version payloads through fetchJson, per-port
// listener scripts through findListener, per-method CDP round-trip results,
// statProfile keyed by path, and mutation spies proving read-only stations
// never spawn or write.
function warmChromeFixture(options: FixtureOptions = {}): Fixture {
	const calls: Fixture["calls"] = {
		fetchJsonUrls: [],
		findListenerPorts: [],
		cdpMethods: [],
		spawnChrome: 0,
		writeTextFile: 0,
		chmod: 0,
		ensureProfileDir: 0,
	};
	const versionScript: readonly VersionStep[] = Array.isArray(options.version)
		? options.version
		: [options.version ?? healthyVersion()];
	let versionCursor = 0;
	const listeners = options.listeners ?? { "9222": chromeListener() };
	const listenerCursor = new Map<string, number>();
	const profiles = options.profiles ?? {
		[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE),
	};
	const cdp = options.cdp ?? healthyCdp();
	const errorPort = options.findListenerErrorPort ?? "9222";

	const runtime = createDefaultRuntime({
		env: { HOME },
		now: () => Date.now(),
		fetchJson: async (url) => {
			calls.fetchJsonUrls.push(url);
			const step = versionScript[Math.min(versionCursor, versionScript.length - 1)];
			versionCursor += 1;
			if (step === "hang") return new Promise<never>(() => {});
			if (step instanceof Error) throw step;
			return step;
		},
		findListener: async (port) => {
			calls.findListenerPorts.push(port);
			if (options.findListenerError && port === errorPort) {
				throw options.findListenerError;
			}
			const script = listeners[port];
			if (script === undefined || script === null) return null;
			if (Array.isArray(script)) {
				const cursor = listenerCursor.get(port) ?? 0;
				listenerCursor.set(port, cursor + 1);
				const step = script[Math.min(cursor, script.length - 1)];
				return step ?? null;
			}
			return script as ListenerProcess;
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
		spawnChrome: async () => {
			calls.spawnChrome += 1;
			return { pid: 1, kill: async () => true };
		},
		readSingletonLock: async () => null,
		// Small real timer: an immediate fetch always beats it; a hanging fetch
		// trips the attach-timeout race quickly instead of after 3s.
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))),
	});

	const deps: WarmChromeProofDeps = {
		cdpRoundTrip: async (_wsUrl, method) => {
			calls.cdpMethods.push(method);
			const entry = cdp[method];
			if (!entry) throw new Error(`unexpected CDP method: ${method}`);
			if (entry instanceof Error) throw entry;
			return entry;
		},
		readDevToolsActivePort: async () => options.activePort ?? null,
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

async function runWarmChrome(
	argv: readonly string[],
	fixture: Fixture,
	options: { defaultRegistry?: boolean } = {},
): Promise<CliRun> {
	const stdout = createMemoryWriter();
	const stderr = createMemoryWriter();
	const exitCode = await main(argv, {
		runtime: fixture.runtime,
		...(options.defaultRegistry
			? {}
			: { handlers: { check: createCheckCommandHandler(fixture.deps) } }),
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.output, stderr: stderr.output };
}

type ParsedEnvelope = {
	status: string;
	run_id: string;
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

function toProcessResult(label: string, argv: readonly string[], run: CliRun): CliProcessResult {
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
	const station = (warmChromeBranchStationCatalog as readonly BranchStation[]).find(
		(candidate) => candidate.id === stationId,
	);
	if (!station) throw new Error(`unknown station: ${stationId}`);
	return station;
}

type FailureScenario = {
	label: string;
	argv?: readonly string[];
	fixture: () => Fixture;
	code: WarmChromeCheckErrorCode;
	reason: WarmChromeCheckReason;
};

const CONNECTION_REFUSED = () => new Error("connect ECONNREFUSED");
const HTTP_404 = () => new Error("request failed: 404");
const SOCKET_HANG_UP = () => new Error("socket hang up");

const failureScenarios: readonly FailureScenario[] = [
	{
		label: "no listener answers on the resolved endpoint",
		fixture: () =>
			warmChromeFixture({ version: CONNECTION_REFUSED(), listeners: {} }),
		code: "endpoint_unreachable",
		reason: "no_listener",
	},
	{
		label: "pipe-only argv with no TCP CDP answer",
		fixture: () =>
			warmChromeFixture({
				version: CONNECTION_REFUSED(),
				listeners: {
					"9222": {
						pid: 4242,
						command: `${REAL_GOOGLE_CHROME_BINARY} --remote-debugging-pipe --user-data-dir=${DEDICATED_PROFILE}`,
					},
				},
			}),
		code: "endpoint_unreachable",
		reason: "pipe_only_no_tcp",
	},
	{
		label: "real Chrome listener with failed HTTP probe is not a free port",
		fixture: () =>
			warmChromeFixture({
				version: CONNECTION_REFUSED(),
				listeners: { "9222": chromeListener() },
			}),
		code: "invalid_cdp",
		reason: "roundtrip_failed",
	},
	{
		label: "HTTP hang past the bounded attach timeout",
		fixture: () => warmChromeFixture({ version: "hang" }),
		code: "endpoint_unreachable",
		reason: "attach_timeout",
	},
	{
		// A fetch that ABORTED (timeout) is a hang, not proof the port is free:
		// it must classify as attach_timeout, never no_listener — the reason
		// launch's spawn gate treats as safe to spawn.
		label: "aborted fetch (AbortError) is an attach timeout, not a free port",
		fixture: () => {
			const abort = new Error("The operation timed out");
			abort.name = "TimeoutError";
			return warmChromeFixture({ version: abort, listeners: {} });
		},
		code: "endpoint_unreachable",
		reason: "attach_timeout",
	},
	{
		// The abort classification must win even when a real Chrome listener
		// occupies the port — an aborted probe is a hang, not a CDP round-trip
		// verdict on the listener.
		label: "aborted fetch with a real Chrome listener present is still an attach timeout",
		fixture: () => {
			const abort = new Error("The operation was aborted");
			abort.name = "AbortError";
			return warmChromeFixture({
				version: abort,
				listeners: { "9222": chromeListener() },
			});
		},
		code: "endpoint_unreachable",
		reason: "attach_timeout",
	},
	{
		// The endpoint probe failed AND the listener probe is unavailable
		// (lsof blocked). The port cannot be proven free, so this must fail
		// closed with a distinct reason that never licenses a launch spawn.
		label: "listener probe unavailable while nothing answers: probe_unavailable, not no_listener",
		fixture: () =>
			warmChromeFixture({
				version: CONNECTION_REFUSED(),
				findListenerError: new WarmChromeRuntimeError(
					"listener_uninspectable",
					"lsof is unavailable.",
				),
			}),
		code: "endpoint_unreachable",
		reason: "probe_unavailable",
	},
	{
		label: "unattributed socket fault is not proof of a free port",
		fixture: () =>
			warmChromeFixture({
				version: SOCKET_HANG_UP(),
				listeners: {},
			}),
		code: "endpoint_unreachable",
		reason: "probe_unavailable",
	},
	{
		label: "unattributed HTTP response is treated as occupied",
		fixture: () =>
			warmChromeFixture({
				version: HTTP_404(),
				listeners: {},
			}),
		code: "port_occupied_foreign",
		reason: "listener_uninspectable",
	},
	{
		label: "localhost alias endpoint is rejected before any probe trusts it",
		argv: ["check", "--endpoint", "http://localhost:9222"],
		fixture: () => warmChromeFixture(),
		code: "non_loopback",
		reason: "localhost_alias",
	},
	{
		label: "non-loopback endpoint",
		argv: ["check", "--endpoint", "http://192.168.1.20:9222"],
		fixture: () => warmChromeFixture(),
		code: "non_loopback",
		reason: "non_loopback_endpoint",
	},
	{
		label: "non-loopback websocket in /json/version",
		fixture: () =>
			warmChromeFixture({
				version: healthyVersion({
					webSocketDebuggerUrl: "ws://192.168.1.20:9222/devtools/browser/x",
				}),
			}),
		code: "non_loopback",
		reason: "non_loopback_websocket",
	},
	{
		label: "malformed /json/version payload",
		fixture: () =>
			warmChromeFixture({
				version: { "User-Agent": HEADED_UA, webSocketDebuggerUrl: BROWSER_WS },
			}),
		code: "invalid_cdp",
		reason: "malformed_json_version",
	},
	{
		label: "ws-only config: listener speaks HTTP but serves no /json/version",
		fixture: () => warmChromeFixture({ version: HTTP_404() }),
		code: "invalid_cdp",
		reason: "ws_only_no_http",
	},
	{
		label: "Browser.getVersion round-trip fails",
		fixture: () =>
			warmChromeFixture({
				cdp: healthyCdp({ "Browser.getVersion": new Error("socket closed") }),
			}),
		code: "invalid_cdp",
		reason: "roundtrip_failed",
	},
	{
		label: "missing webSocketDebuggerUrl under contention (browser still alive)",
		fixture: () =>
			warmChromeFixture({ version: [contentionVersion(), healthyVersion()] }),
		code: "invalid_cdp",
		reason: "cdp_contention",
	},
	{
		label: "foreign process owns the requested CDP port",
		fixture: () =>
			warmChromeFixture({
				version: CONNECTION_REFUSED(),
				listeners: {
					"9222": { pid: 6001, command: "/usr/local/bin/node /srv/dev-server.js" },
				},
			}),
		code: "port_occupied_foreign",
		reason: "foreign_listener",
	},
	{
		label: "/json/version answers while pointed at the default profile (R6c)",
		fixture: () =>
			warmChromeFixture({
				listeners: { "9222": chromeListener({ profile: DEFAULT_PROFILE_ROOT }) },
			}),
		code: "port_occupied_foreign",
		reason: "json_answers_on_default_profile",
	},
	{
		label: "lsof-invisible listener: findListener null but the connection succeeds",
		fixture: () => warmChromeFixture({ listeners: {} }),
		code: "port_occupied_foreign",
		reason: "listener_uninspectable",
	},
	{
		label: "listener probe itself is uninspectable while CDP answers",
		fixture: () =>
			warmChromeFixture({
				findListenerError: new WarmChromeRuntimeError(
					"listener_uninspectable",
					"Could not run the CDP listener probe.",
				),
			}),
		code: "port_occupied_foreign",
		reason: "listener_uninspectable",
	},
	{
		label: "clean CDP banner but Chrome-for-Testing binary path still rejects",
		fixture: () =>
			warmChromeFixture({
				listeners: {
					"9222": {
						pid: 4242,
						command: `"/Users/warm/.cache/puppeteer/chrome/mac-138/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" --remote-debugging-port=9222 --user-data-dir=${DEDICATED_PROFILE}`,
					},
				},
			}),
		code: "wrong_browser",
		reason: "chrome_for_testing",
	},
	{
		label: "Chromium binary",
		fixture: () =>
			warmChromeFixture({
				listeners: {
					"9222": {
						pid: 4242,
						command: `/Applications/Chromium.app/Contents/MacOS/Chromium --remote-debugging-port=9222 --user-data-dir=${DEDICATED_PROFILE}`,
					},
				},
			}),
		code: "wrong_browser",
		reason: "chromium",
	},
	{
		label: "Electron-style CDP endpoint (Slack)",
		fixture: () =>
			warmChromeFixture({
				listeners: {
					"9222": {
						pid: 4242,
						command: `/Applications/Slack.app/Contents/MacOS/Slack --remote-debugging-port=9222 --user-data-dir=${DEDICATED_PROFILE}`,
					},
				},
			}),
		code: "wrong_browser",
		reason: "electron_or_other",
	},
	{
		label: "HeadlessChrome user agent from Browser.getVersion",
		fixture: () =>
			warmChromeFixture({
				cdp: healthyCdp({
					"Browser.getVersion": {
						product: "HeadlessChrome/138.0.7204.49",
						userAgent:
							"Mozilla/5.0 (Macintosh) AppleWebKit/537.36 HeadlessChrome/138.0.0.0 Safari/537.36",
					},
				}),
			}),
		code: "wrong_browser",
		reason: "headless_not_headed",
	},
	{
		label: "reachable warm Chrome but only isolated/incognito contexts (R6a)",
		fixture: () =>
			warmChromeFixture({
				cdp: healthyCdp({
					"Target.getBrowserContexts": { browserContextIds: ["ctx-isolated"] },
					"Target.getTargets": {
						targetInfos: [{ type: "page", browserContextId: "ctx-isolated" }],
					},
				}),
			}),
		code: "wrong_browser",
		reason: "isolated_context",
	},
	{
		label: "provided --profile points at the default Chrome profile",
		argv: ["check", "--profile", DEFAULT_PROFILE_ROOT],
		fixture: () => warmChromeFixture(),
		code: "unsafe_profile",
		reason: "default_profile",
	},
	{
		label: "listener uses a relative --user-data-dir",
		fixture: () =>
			warmChromeFixture({
				listeners: {
					"9222": chromeListener({ profile: "relative-warm-profile" }),
				},
			}),
		code: "unsafe_profile",
		reason: "invalid_profile_path",
	},
	{
		label: "throwaway temporary listener profile",
		fixture: () =>
			warmChromeFixture({
				listeners: { "9222": chromeListener({ profile: "/tmp/warm-profile" }) },
				profiles: { "/tmp/warm-profile": profileStat("/tmp/warm-profile") },
				version: healthyVersion({
					webSocketDebuggerUrl: BROWSER_WS,
				}),
			}),
		code: "unsafe_profile",
		reason: "throwaway_profile",
	},
	{
		label: "listener profile permissions are not owner-only",
		fixture: () =>
			warmChromeFixture({
				profiles: {
					[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE, { mode: "755" }),
				},
			}),
		code: "unsafe_profile",
		reason: "unsafe_profile_permissions",
	},
	{
		label: "listener profile path cannot be resolved",
		fixture: () => warmChromeFixture({ profiles: {} }),
		code: "unsafe_profile",
		reason: "invalid_profile_path",
	},
	{
		label: "resolved profile path remaps outside the dedicated user-data-dir (Chrome 136+)",
		fixture: () =>
			warmChromeFixture({
				listeners: {
					"9222": chromeListener({ extraArgs: "--profile-directory=Work" }),
				},
				profiles: {
					[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE),
					[`${DEDICATED_PROFILE}/Work`]: profileStat(`${DEDICATED_PROFILE}/Work`, {
						realPath: "/Users/warm/elsewhere/Work",
					}),
				},
			}),
		code: "unsafe_profile",
		reason: "profile_dir_remap",
	},
	{
		label: "listener argv uses a different CDP port than requested",
		fixture: () =>
			warmChromeFixture({ listeners: { "9222": chromeListener({ port: "9333" }) } }),
		code: "listener_mismatch",
		reason: "port_mismatch",
	},
	{
		label: "provided profile does not match the listener profile",
		argv: ["check", "--profile", "/Users/warm/other-profile"],
		fixture: () =>
			warmChromeFixture({
				profiles: {
					[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE),
					"/Users/warm/other-profile": profileStat("/Users/warm/other-profile"),
				},
			}),
		code: "listener_mismatch",
		reason: "profile_mismatch",
	},
	{
		label: "listener disappears during verification",
		fixture: () =>
			warmChromeFixture({ listeners: { "9222": [chromeListener(), null] } }),
		code: "listener_mismatch",
		reason: "listener_missing",
	},
	{
		label: "listener pid changes during verification",
		fixture: () =>
			warmChromeFixture({
				listeners: {
					"9222": [chromeListener({ pid: 4242 }), chromeListener({ pid: 999 })],
				},
			}),
		code: "listener_mismatch",
		reason: "pid_mismatch",
	},
	{
		label: "crafted /json/version reports a pid disagreeing with findListener",
		fixture: () => warmChromeFixture({ version: healthyVersion({ pid: 31337 }) }),
		code: "listener_mismatch",
		reason: "pid_mismatch",
	},
];

function expectProofFailure(
	run: CliRun,
	expected: { code: WarmChromeCheckErrorCode; reason: WarmChromeCheckReason },
	label: string,
): ParsedEnvelope {
	if (run.exitCode !== 20) {
		throw new Error(
			`${label}: expected exit 20, got ${run.exitCode}\nstdout=${run.stdout}\nstderr=${run.stderr}`,
		);
	}
	const envelope = parseEnvelope(run);
	if (envelope.error?.code !== expected.code) {
		throw new Error(
			`${label}: expected code ${expected.code}, got ${envelope.error?.code}\nstdout=${run.stdout}`,
		);
	}
	if (envelope.data?.reason !== expected.reason) {
		throw new Error(
			`${label}: expected reason ${expected.reason}, got ${String(envelope.data?.reason)}\nstdout=${run.stdout}`,
		);
	}
	expect(envelope.data?.contract_id).toBe(WARM_CHROME_CONTRACT_ID);
	expect(envelope.data?.schema_version).toBe(WARM_CHROME_SCHEMA_VERSION);
	const constraint = envelope.continuation?.constraints?.[0];
	expect(constraint?.id).toBe(WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID);
	return envelope;
}

describe("warm-chrome check stations (U5): canonical codes and reason details", () => {
	for (const scenario of failureScenarios) {
		test(`${scenario.code}/${scenario.reason}: ${scenario.label}`, async () => {
			const fixture = scenario.fixture();
			const run = await runWarmChrome(
				scenario.argv ?? ["check", "--run-id", "station-run"],
				fixture,
			);
			expectProofFailure(run, scenario, scenario.label);
		});
	}

	test("healthy fixed-port Chrome verifies from live evidence despite a stale DevToolsActivePort hint (R8/R17)", async () => {
		const fixture = warmChromeFixture({
			activePort: { port: "9222", wsPath: "/devtools/browser/stale-token" },
		});
		const run = await runWarmChrome(["check", "--run-id", "verified-run"], fixture);

		expect(run.exitCode).toBe(0);
		const envelope = parseEnvelope(run);
		expect(envelope.status).toBe("ok");
		assertCommandResultContract({
			command: "check",
			contract: warmChromeContracts.check,
			envelope: JSON.parse(run.stdout),
		});
		expect(envelope.data?.browser).toBe(OBSERVED_BUILD);
		expect(envelope.data?.web_socket_debugger_url).toBe(BROWSER_WS);
		expect(envelope.data?.endpoint).toBe("http://127.0.0.1:9222");
		expect(envelope.data?.browser_pid).toBe(4242);
		expect(envelope.data?.profile_dir).toBe(DEDICATED_PROFILE);
		const action = envelope.runtime_actions?.[0];
		expect(action?.id).toBe("use_verified_endpoint");
		// R8: guidance carries the ACTUAL endpoint, never the 9222 convention.
		expect(action?.summary).toContain("http://127.0.0.1:9222");
		expect(envelope.continuation?.next_action_id).toBe("use_verified_endpoint");
	});

	test("healthy warm Chrome can verify with no open page targets", async () => {
		const fixture = warmChromeFixture({
			cdp: healthyCdp({
				"Target.getTargets": { targetInfos: [] },
			}),
		});
		const run = await runWarmChrome(["check"], fixture);

		expect(run.exitCode).toBe(0);
		const envelope = parseEnvelope(run);
		expect(envelope.status).toBe("ok");
	});

	test("late isolated context target fails closed instead of counting as default context", async () => {
		const fixture = warmChromeFixture({
			cdp: healthyCdp({
				"Target.getBrowserContexts": { browserContextIds: [] },
				"Target.getTargets": {
					targetInfos: [{ type: "page", browserContextId: "ctx-late" }],
				},
			}),
		});
		const run = await runWarmChrome(["check"], fixture);

		expectProofFailure(
			run,
			{ code: "wrong_browser", reason: "isolated_context" },
			"late isolated context",
		);
	});

	test("page without a browserContextId still counts as default context", async () => {
		const fixture = warmChromeFixture({
			cdp: healthyCdp({
				"Target.getTargets": {
					targetInfos: [{ type: "page", targetId: "page-1" }],
				},
			}),
		});
		const run = await runWarmChrome(["check"], fixture);

		expect(run.exitCode).toBe(0);
		expect(parseEnvelope(run).status).toBe("ok");
	});

	test("isolated page fails closed even when defaultBrowserContextId is reported", async () => {
		const fixture = warmChromeFixture({
			cdp: healthyCdp({
				"Target.getTargets": {
					targetInfos: [{ type: "page", browserContextId: "ctx-incognito" }],
				},
			}),
		});
		const run = await runWarmChrome(["check"], fixture);

		expectProofFailure(
			run,
			{ code: "wrong_browser", reason: "isolated_context" },
			"isolated page with default id present",
		);
	});

	test("localhost alias is rejected before any network or listener probe runs", async () => {
		const fixture = warmChromeFixture();
		const run = await runWarmChrome(
			["check", "--endpoint", "http://localhost:9222"],
			fixture,
		);

		expectProofFailure(
			run,
			{ code: "non_loopback", reason: "localhost_alias" },
			"localhost alias",
		);
		expect(fixture.calls.fetchJsonUrls).toEqual([]);
		expect(fixture.calls.findListenerPorts).toEqual([]);
	});

	test("parser-minted non-loopback errors carry command endpoint and port context", async () => {
		const fixture = warmChromeFixture();
		const run = await runWarmChrome(
			["check", "--endpoint", "http://192.168.1.20:9222"],
			fixture,
		);

		const envelope = expectProofFailure(
			run,
			{ code: "non_loopback", reason: "non_loopback_endpoint" },
			"non-loopback parser context",
		);
		expect(envelope.data?.command).toBe("check");
		expect(envelope.data?.endpoint).toBe("http://192.168.1.20:9222");
		expect(envelope.data?.port).toBe("9222");
	});

	test("cdp_contention re-probes /json/version before any browser-down verdict (R7a)", async () => {
		const fixture = warmChromeFixture({
			version: [contentionVersion(), healthyVersion()],
		});
		const run = await runWarmChrome(["check"], fixture);

		expectProofFailure(
			run,
			{ code: "invalid_cdp", reason: "cdp_contention" },
			"cdp contention",
		);
		// The re-probe ran: the browser was not declared dead on one bad read.
		expect(fixture.calls.fetchJsonUrls.length).toBe(2);
	});

	test("only no_listener endpoint_unreachable routes to launch", async () => {
		const noListener = warmChromeFixture({
			version: CONNECTION_REFUSED(),
			listeners: {},
		});
		const noListenerRun = await runWarmChrome(["check"], noListener);
		expect(parseEnvelope(noListenerRun).continuation?.next_action_id).toBe(
			"launch_warm_chrome",
		);

		const attachTimeout = warmChromeFixture({ version: "hang" });
		const timeoutRun = await runWarmChrome(["check"], attachTimeout);
		expect(parseEnvelope(timeoutRun).continuation?.next_action_id).toBe(
			"inspect_listener",
		);
	});

	test("contention with a dead re-probe fails closed instead of licensing spawn", async () => {
		const fixture = warmChromeFixture({
			version: [contentionVersion(), CONNECTION_REFUSED()],
		});
		const run = await runWarmChrome(["check"], fixture);

		expectProofFailure(
			run,
			{ code: "invalid_cdp", reason: "roundtrip_failed" },
			"dead re-probe",
		);
	});

	test("runtime_failure: an unexpected seam fault exits 1 with the canonical code", async () => {
		const fixture = warmChromeFixture({
			findListenerError: new Error("lsof exploded with a hostile message"),
		});
		const run = await runWarmChrome(["check", "--run-id", "fault-run"], fixture);

		expect(run.exitCode).toBe(1);
		const envelope = parseEnvelope(run);
		expect(envelope.error?.code).toBe("runtime_failure");
		expect(run.stdout).not.toContain("hostile message");
	});

	// An unexpected findListener fault reached via the UNREACHABLE-classification
	// path (endpoint probe also failed) must never collapse to no_listener — the
	// one reason launch's gate treats as safe to spawn. It rethrows to
	// runtime_failure, fail-closed, exactly like resolveListener's path above.
	test("runtime_failure: an unexpected findListener fault during unreachable classification never becomes no_listener", async () => {
		const fixture = warmChromeFixture({
			version: CONNECTION_REFUSED(),
			findListenerError: new Error("lsof segfaulted mid-classify"),
		});
		const run = await runWarmChrome(["check"], fixture);

		expect(run.exitCode).toBe(1);
		const envelope = parseEnvelope(run);
		expect(envelope.error?.code).toBe("runtime_failure");
		// Critically NOT the spawn-licensing endpoint_unreachable/no_listener.
		expect(envelope.error?.code).not.toBe("endpoint_unreachable");
		expect(run.stdout).not.toContain("segfaulted");
	});

	test("invalid_usage: unsupported flags exit 2 before any probe", async () => {
		const fixture = warmChromeFixture();
		const run = await runWarmChrome(["check", "--bogus"], fixture);

		expect(run.exitCode).toBe(2);
		const envelope = parseEnvelope(run);
		expect(envelope.error?.code).toBe("invalid_usage");
		expect(fixture.calls.fetchJsonUrls).toEqual([]);
	});
});

describe("warm-chrome suggested explicit port (U5 R7)", () => {
	test("foreign listener on 9222 suggests the first verifiably free window port without allocating", async () => {
		const fixture = warmChromeFixture({
			version: CONNECTION_REFUSED(),
			listeners: {
				"9222": { pid: 6001, command: "/usr/local/bin/node /srv/dev-server.js" },
			},
		});
		const run = await runWarmChrome(["check"], fixture);

		const envelope = expectProofFailure(
			run,
			{ code: "port_occupied_foreign", reason: "foreign_listener" },
			"suggested port",
		);
		const suggested = envelope.data?.suggested_explicit_port;
		expect(suggested).toBe(WARM_CHROME_SUGGESTED_PORT_WINDOW.start);
		expect(typeof suggested).toBe("number");
		expect(suggested as number).toBeGreaterThanOrEqual(
			WARM_CHROME_SUGGESTED_PORT_WINDOW.start,
		);
		expect(suggested as number).toBeLessThanOrEqual(
			WARM_CHROME_SUGGESTED_PORT_WINDOW.end,
		);
		// Freeness proven through the seam, per candidate.
		expect(fixture.calls.findListenerPorts).toContain(String(suggested));
		expect(await fixture.runtime.findListener(String(suggested))).toBeNull();
		// Non-allocator proof: no spawn, no persistence, no rebinding.
		expect(fixture.calls.spawnChrome).toBe(0);
		expect(fixture.calls.writeTextFile).toBe(0);
		expect(fixture.calls.chmod).toBe(0);
		expect(fixture.calls.ensureProfileDir).toBe(0);
		// The window never dips below 1024 by construction.
		expect(WARM_CHROME_SUGGESTED_PORT_WINDOW.start).toBeGreaterThan(1024);
	});

	test("scan-window exhaustion omits the field", async () => {
		const occupied: Record<string, ListenerProcess> = {
			"9222": { pid: 6001, command: "/usr/local/bin/node /srv/dev-server.js" },
		};
		for (
			let port = WARM_CHROME_SUGGESTED_PORT_WINDOW.start;
			port <= WARM_CHROME_SUGGESTED_PORT_WINDOW.end;
			port += 1
		) {
			occupied[String(port)] = { pid: 7000 + port, command: "/usr/local/bin/node busy.js" };
		}
		const fixture = warmChromeFixture({
			version: CONNECTION_REFUSED(),
			listeners: occupied,
		});
		const run = await runWarmChrome(["check"], fixture);

		const envelope = expectProofFailure(
			run,
			{ code: "port_occupied_foreign", reason: "foreign_listener" },
			"window exhaustion",
		);
		expect(envelope.data).not.toContainKey("suggested_explicit_port");
	});

	test("a suggestion is not an allocation: check --port <suggested> against nothing is endpoint_unreachable", async () => {
		const fixture = warmChromeFixture({
			version: CONNECTION_REFUSED(),
			listeners: {},
		});
		const run = await runWarmChrome(
			["check", "--port", String(WARM_CHROME_SUGGESTED_PORT_WINDOW.start)],
			fixture,
		);

		expectProofFailure(
			run,
			{ code: "endpoint_unreachable", reason: "no_listener" },
			"suggested port rerun",
		);
	});
});

describe("warm-chrome check redaction boundary (U5 R13)", () => {
	test("a hostile foreign listener cmdline never leaks beyond pid and basename", async () => {
		const secrets = RUNTIME_CONTRACT_REDACTION_FIXTURES.map((entry) => entry.value);
		const fixture = warmChromeFixture({
			version: CONNECTION_REFUSED(),
			listeners: {
				"9222": {
					pid: 6001,
					command: `/opt/tools/proxy-server --password=${secrets[0]} --state ${secrets[5]} --upstream ${secrets[9]}`,
				},
			},
		});
		const run = await runWarmChrome(["check"], fixture);

		const envelope = expectProofFailure(
			run,
			{ code: "port_occupied_foreign", reason: "foreign_listener" },
			"hostile listener",
		);
		assertNoRuntimeContractFixtureLeaks(JSON.parse(run.stdout));
		expect(envelope.data?.listener).toEqual({
			pid: 6001,
			process: "proxy-server",
			foreign: true,
		});
	});

	test("an lsof-invisible listener envelope omits pid entirely", async () => {
		const fixture = warmChromeFixture({ listeners: {} });
		const run = await runWarmChrome(["check"], fixture);

		const envelope = expectProofFailure(
			run,
			{ code: "port_occupied_foreign", reason: "listener_uninspectable" },
			"uninspectable listener",
		);
		expect(envelope.data).not.toContainKey("listener");
		expect(run.stdout).not.toContain('"pid"');
	});
});

describe("warm-chrome dispatch wiring (U5): default registry runs the proof chain", () => {
	test("check runs the proof chain through main without a handler override", async () => {
		const fixture = warmChromeFixture({
			version: CONNECTION_REFUSED(),
			listeners: {},
		});
		const run = await runWarmChrome(["check", "--run-id", "wired-run"], fixture, {
			defaultRegistry: true,
		});

		expectProofFailure(
			run,
			{ code: "endpoint_unreachable", reason: "no_listener" },
			"default registry check",
		);
	});

	test("status alias runs the same proof chain and renders plain", async () => {
		const fixture = warmChromeFixture({
			version: CONNECTION_REFUSED(),
			listeners: {},
		});
		const run = await runWarmChrome(["status", "--run-id", "wired-status"], fixture, {
			defaultRegistry: true,
		});

		expect(run.exitCode).toBe(20);
		expect(run.stdout).toBe("");
		expect(run.stderr).toContain("endpoint_unreachable");
		expect(run.stderr).toContain("run_id=wired-status");
	});
});

describe("warm-chrome status context parity (U5)", () => {
	test("status renders identical station data plain for a verified endpoint", async () => {
		const jsonRun = await runWarmChrome(["check"], warmChromeFixture());
		const plainRun = await runWarmChrome(["status"], warmChromeFixture());

		expect(plainRun.exitCode).toBe(jsonRun.exitCode);
		expect(plainRun.exitCode).toBe(0);
		expect(plainRun.stdout).toContain("browser_ready");
		expect(plainRun.stdout).toContain("command=status");
		expect(plainRun.stdout).toContain("port=9222");
		expect(plainRun.stdout).toContain(`browser=${OBSERVED_BUILD}`);
		expect(plainRun.stdout).toContain("endpoint=http://127.0.0.1:9222");
	});

	test("status surfaces the same station verdict as check for a failure", async () => {
		const makeFixture = () =>
			warmChromeFixture({
				version: CONNECTION_REFUSED(),
				listeners: {
					"9222": { pid: 6001, command: "/usr/local/bin/node /srv/dev-server.js" },
				},
			});
		const jsonRun = await runWarmChrome(["check"], makeFixture());
		const plainRun = await runWarmChrome(["status"], makeFixture());

		const envelope = expectProofFailure(
			jsonRun,
			{ code: "port_occupied_foreign", reason: "foreign_listener" },
			"parity json",
		);
		expect(plainRun.exitCode).toBe(jsonRun.exitCode);
		expect(plainRun.stderr).toContain(envelope.error?.code ?? "");
	});
});

describe("warm-chrome cold-agent envelopes (U5 R12)", () => {
	test("every error envelope's action id and continuation resolve against discovery without external context", async () => {
		const discovery = projectWarmChromeCommandDiscoveryTree() as {
			commands: Record<
				string,
				{ action_affordances?: Record<string, ReadonlyArray<{ id: string }>> }
			>;
		};
		const affordances = discovery.commands.check?.action_affordances ?? {};
		const discoveryActionIds = new Set(
			Object.values(affordances).flatMap((group) => group.map((action) => action.id)),
		);
		expect(discoveryActionIds.size).toBeGreaterThan(0);

		const runs: Array<{ label: string; run: CliRun }> = [];
		for (const scenario of failureScenarios) {
			runs.push({
				label: scenario.label,
				run: await runWarmChrome(scenario.argv ?? ["check"], scenario.fixture()),
			});
		}
		runs.push({
			label: "invalid usage",
			run: await runWarmChrome(["check", "--bogus"], warmChromeFixture()),
		});
		runs.push({
			label: "runtime failure",
			run: await runWarmChrome(
				["check"],
				warmChromeFixture({ findListenerError: new Error("boom") }),
			),
		});

		for (const { label, run } of runs) {
			const envelope = parseEnvelope(run);
			const nextActionId = envelope.continuation?.next_action_id;
			if (!nextActionId) {
				throw new Error(`${label}: envelope has no continuation.next_action_id`);
			}
			const actionIds = (envelope.runtime_actions ?? []).map((action) => action.id);
			if (!actionIds.includes(nextActionId)) {
				throw new Error(
					`${label}: next_action_id ${nextActionId} missing from runtime_actions ${actionIds.join(",")}`,
				);
			}
			for (const actionId of actionIds) {
				if (!discoveryActionIds.has(actionId)) {
					throw new Error(
						`${label}: action id ${actionId} does not resolve against the discovery projection`,
					);
				}
			}
		}
	});
});

describe("warm-chrome check station evidence (U5)", () => {
	test("all ten check stations attach evidence and stop being missing", async () => {
		const evidence: WarmChromeBranchStationEvidence[] = [];

		const proofStationRuns: Array<{
			stationId: string;
			argv: readonly string[];
			fixture: Fixture;
		}> = [
			{ stationId: "check.verified", argv: ["check"], fixture: warmChromeFixture() },
			{
				stationId: "check.endpoint_unreachable",
				argv: ["check"],
				fixture: warmChromeFixture({ version: CONNECTION_REFUSED(), listeners: {} }),
			},
			{
				stationId: "check.port_occupied_foreign",
				argv: ["check"],
				fixture: warmChromeFixture({
					version: CONNECTION_REFUSED(),
					listeners: {
						"9222": { pid: 6001, command: "/usr/local/bin/node /srv/dev-server.js" },
					},
				}),
			},
			{
				stationId: "check.wrong_browser",
				argv: ["check"],
				fixture: warmChromeFixture({
					listeners: {
						"9222": {
							pid: 4242,
							command: `/Applications/Chromium.app/Contents/MacOS/Chromium --remote-debugging-port=9222 --user-data-dir=${DEDICATED_PROFILE}`,
						},
					},
				}),
			},
			{
				stationId: "check.unsafe_profile",
				argv: ["check"],
				fixture: warmChromeFixture({
					profiles: {
						[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE, { mode: "755" }),
					},
				}),
			},
			{
				stationId: "check.non_loopback",
				argv: ["check", "--endpoint", "http://localhost:9222"],
				fixture: warmChromeFixture(),
			},
			{
				stationId: "check.invalid_cdp",
				argv: ["check"],
				fixture: warmChromeFixture({
					version: { "User-Agent": HEADED_UA, webSocketDebuggerUrl: BROWSER_WS },
				}),
			},
			{
				stationId: "check.listener_mismatch",
				argv: ["check", "--profile", "/Users/warm/other-profile"],
				fixture: warmChromeFixture({
					profiles: {
						[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE),
						"/Users/warm/other-profile": profileStat("/Users/warm/other-profile"),
					},
				}),
			},
			// Chassis-owned stations: the chassis merges the result contract
			// metadata into every error envelope's data (R12), so these reconcile
			// through the same evidence path as the proof stations.
			{
				stationId: "check.runtime_failure",
				argv: ["check"],
				fixture: warmChromeFixture({ findListenerError: new Error("boom") }),
			},
			{
				stationId: "check.invalid_usage",
				argv: ["check", "--bogus"],
				fixture: warmChromeFixture(),
			},
		];

		for (const { stationId, argv, fixture } of proofStationRuns) {
			const station = stationById(stationId);
			const run = await runWarmChrome(argv, fixture);
			const result = toProcessResult(stationId, argv, run);
			const envelope = assertStationEnvelope(station, result);
			evidence.push(buildStationEvidence(station, result, envelope));
		}

		expect(listMissingWarmChromeBranchStationEvidence(evidence)).toEqual(
			[
				"launch.already_verified",
				"launch.launched",
				"launch.port_occupied_foreign",
				"launch.spawned_unverified",
				"repair.repaired",
				"repair.unrepairable",
			].sort(),
		);

		const stationMap = projectWarmChromeBranchStationEvidence(evidence);
		const checkFindings = stationMap.findings.filter((finding) =>
			finding.station_id.startsWith("check."),
		);
		// All ten check stations reconcile clean: every envelope carries the
		// result contract metadata, including the chassis-owned stations.
		expect(checkFindings).toEqual([]);
	});
});

describe("warm-chrome check reason union (U5 R5)", () => {
	test("every scenario reason is a member of the closed package-owned union", () => {
		for (const scenario of failureScenarios) {
			const reasons: readonly string[] = WARM_CHROME_CHECK_REASONS[scenario.code];
			expect(reasons).toContain(scenario.reason);
		}
	});
});
