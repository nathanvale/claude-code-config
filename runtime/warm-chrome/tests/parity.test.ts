// U8: golden-envelope parity harness (plan R15/R16).
//
// Shared runtime-seam fixture scenarios drive BOTH implementations — the old
// authoritative preflight (`skills/browser-use/src/preflight-warm-chrome.ts`,
// via its exported `runForTest(argv, runtime)`) and this package's
// `main(argv, deps)` — and compare station, exit, and envelope outcomes.
//
// Parity is MEASURED, not asserted: the translation is keyed on
// `(fixture id, command) → expected station` with a recorded rationale per
// row, because the old fine-grained codes are not a function of one input.
// Old codes with no new home are enumerated up front as intended divergences
// (INTENDED_DIVERGENCES); every station-level difference must reference one,
// and the final test prints the station-level diff report the deferred
// switchover checklist consumes.
//
// Seam-shape adaptation (plan U8): the two implementations share one fixture
// spec through thin per-implementation adapters this harness owns —
// old `spawnChrome: Promise<void>` vs new `{ pid, kill() }`; the new seam adds
// `readSingletonLock`; the new proof deps add `cdpRoundTrip` and
// `readDevToolsActivePort` (no old equivalent — those proofs are new-only).
// The old seam owns its attach timeout inside `fetchJson` (AbortSignal in the
// old default runtime), so the old adapter maps a "hang" version step to a
// thrown timeout while the new adapter returns a pending promise and lets the
// new proof's bounded attach race decide.
import { describe, expect, test } from "bun:test";

import {
	type PreflightRuntime,
	runForTest,
} from "../../../skills/browser-use/src/preflight-warm-chrome";

import { main } from "../src/cli.ts";
import { createCheckCommandHandler } from "../src/proof.ts";
import { createLaunchCommandHandler } from "../src/launch.ts";
import {
	createRepairCommandHandler,
	type WarmChromeRepairDeps,
	type WarmChromeRepairFileKind,
} from "../src/repair.ts";
import {
	createDefaultRuntime,
	type LaunchChromeInput,
	type ListenerProcess,
	type ProfileStat,
	REAL_GOOGLE_CHROME_BINARY,
	type SingletonLock,
	type WarmChromeRuntime,
} from "../src/runtime.ts";

const HOME = "/Users/warm";
const DEDICATED_PROFILE = `${HOME}/.agent-warm-profile`;
const OTHER_PROFILE = `${HOME}/other-profile`;
const DEFAULT_PROFILE_ROOT = `${HOME}/Library/Application Support/Google/Chrome`;
const ACTIVE_PORT_PATH = `${DEDICATED_PROFILE}/DevToolsActivePort`;
const OBSERVED_BUILD = "Chrome/138.0.7204.49";
const HEADED_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const SPAWNED_PID = 555;
const CFT_BINARY =
	"/Users/warm/.cache/puppeteer/chrome/mac-138/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

function wsFor(port: string): string {
	return `ws://127.0.0.1:${port}/devtools/browser/warm-chrome-token`;
}

function chromeCommand(
	overrides: { port?: string | null; profile?: string | null; extraArgs?: string } = {},
): string {
	const port =
		overrides.port === null
			? ""
			: ` --remote-debugging-port=${overrides.port ?? "9222"}`;
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

const FOREIGN_LISTENER: ListenerProcess = {
	pid: 6001,
	command: "/usr/local/bin/node /srv/dev-server.js",
};

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

function healthyCdp(overrides: Record<string, CdpEntry> = {}): Record<string, CdpEntry> {
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

// "hang" models an unreachable attach: the new proof races its bounded attach
// timeout; the old seam's fetchJson owns the timeout, so its adapter throws.
type VersionStep = Record<string, unknown> | Error | "hang";
type Script<T> = T | readonly T[];

/**
 * One shared fixture scenario both seam adapters realize.
 */
type ParityFixtureSpec = {
	platform?: NodeJS.Platform;
	/** Per-port listener answers. Arrays play per call; the last entry repeats. */
	listeners?: Record<string, Script<ListenerProcess | null>>;
	/** Raw error message findListener throws for port 9222. */
	findListenerFaultMessage?: string;
	/** /json/version scripts keyed by port; a missing port refuses connections. */
	versions?: Record<string, Script<VersionStep>>;
	cdp?: Record<string, CdpEntry>;
	/** statProfile answers keyed by path; mutable (chmod/ensureProfileDir). */
	profiles?: Record<string, ProfileStat>;
	singletonLocks?: Record<string, SingletonLock | null>;
	activePort?: { port: string; wsPath: string } | null;
	symlinkPaths?: readonly string[];
	ensureProfileDirFails?: boolean;
	/** Spawn behavior: bind a healthy Warm Chrome, or bind nothing. */
	spawn?: "bind_healthy" | "bind_nothing";
};

type SideCalls = {
	spawns: number;
	writes: number;
	chmods: number;
};

type SideOutcome = {
	status: "ok" | "error";
	code: string | null;
	exit: number;
	reason: string | null;
	calls: SideCalls;
	envelope: Record<string, unknown>;
};

type ScriptState<T> = { script: readonly T[]; cursor: number };

function toScript<T>(value: Script<T>): readonly T[] {
	return (Array.isArray(value) ? value : [value]) as readonly T[];
}

function playScript<T>(state: ScriptState<T>): T {
	const step = state.script[Math.min(state.cursor, state.script.length - 1)] as T;
	state.cursor += 1;
	return step;
}

// Shared mutable fixture state one side runs against. Each side builds its
// own instance from the same spec, so cursors and repairs never bleed across.
type FixtureState = {
	listeners: Map<string, ScriptState<ListenerProcess | null>>;
	versions: Map<string, ScriptState<VersionStep>>;
	profiles: Record<string, ProfileStat>;
	activePort: { port: string; wsPath: string } | null;
	calls: SideCalls;
	clockNow: () => number;
	advanceClock: (ms: number) => void;
};

function buildFixtureState(spec: ParityFixtureSpec): FixtureState {
	const listeners = new Map<string, ScriptState<ListenerProcess | null>>();
	for (const [port, script] of Object.entries(
		spec.listeners ?? { "9222": chromeListener() },
	)) {
		listeners.set(port, { script: toScript(script), cursor: 0 });
	}
	const versions = new Map<string, ScriptState<VersionStep>>();
	for (const [port, script] of Object.entries(
		spec.versions ?? { "9222": healthyVersionFor("9222") },
	)) {
		versions.set(port, { script: toScript(script), cursor: 0 });
	}
	const profiles: Record<string, ProfileStat> = {};
	for (const [path, stat] of Object.entries(
		spec.profiles ?? { [DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE) },
	)) {
		profiles[path] = { ...stat };
	}
	// Virtual clock offset above wall time keeps envelope durations positive
	// while readiness budgets elapse without real waits.
	let clock = Date.now() + 60_000;
	return {
		listeners,
		versions,
		profiles,
		activePort: spec.activePort ?? null,
		calls: { spawns: 0, writes: 0, chmods: 0 },
		clockNow: () => clock,
		advanceClock: (ms) => {
			clock += ms;
		},
	};
}

const CONNECTION_REFUSED_MESSAGE = "connect ECONNREFUSED";

function fetchVersionStep(
	state: FixtureState,
	url: string,
	onHang: "pending" | "throw_timeout",
): Promise<unknown> | unknown {
	const parsed = new URL(url);
	if (parsed.pathname.endsWith("/json/list")) {
		// Old-preflight target listing; the old fetchTargetList tolerates any
		// answer. One page target mirrors the shared healthy CDP fixture.
		return [{ id: "page-1" }];
	}
	const entry = state.versions.get(parsed.port);
	if (!entry) throw new Error(CONNECTION_REFUSED_MESSAGE);
	const step = playScript(entry);
	if (step === "hang") {
		if (onHang === "throw_timeout") {
			// The old seam owns the attach timeout (AbortSignal inside the old
			// default fetchJson); its fake honors that seam contract by throwing.
			throw new Error("The operation timed out.");
		}
		return new Promise<never>(() => {});
	}
	if (step instanceof Error) throw step;
	return step;
}

function findListenerStep(
	state: FixtureState,
	spec: ParityFixtureSpec,
	port: string,
): ListenerProcess | null {
	if (spec.findListenerFaultMessage && port === "9222") {
		throw new Error(spec.findListenerFaultMessage);
	}
	const entry = state.listeners.get(port);
	if (!entry) return null;
	return playScript(entry);
}

function bindSpawned(state: FixtureState, input: LaunchChromeInput): void {
	state.listeners.set(input.port, {
		script: [
			{
				pid: SPAWNED_PID,
				command: chromeCommand({ port: input.port, profile: input.profileDir }),
			},
		],
		cursor: 0,
	});
	state.versions.set(input.port, {
		script: [healthyVersionFor(input.port)],
		cursor: 0,
	});
}

function statProfileStep(state: FixtureState, path: string): ProfileStat {
	const stat = state.profiles[path];
	if (!stat) throw new Error(`no profile directory at ${path}`);
	return stat;
}

function chmodStep(state: FixtureState, path: string, mode: number): void {
	state.calls.chmods += 1;
	for (const stat of Object.values(state.profiles)) {
		if (stat.realPath === path) {
			stat.mode = (mode & 0o777).toString(8);
		}
	}
}

function writeTextFileStep(state: FixtureState, content: string): void {
	state.calls.writes += 1;
	const [port = "", wsPath = ""] = content.split("\n").map((line) => line.trim());
	state.activePort = { port, wsPath };
}

function ensureProfileDirStep(
	state: FixtureState,
	spec: ParityFixtureSpec,
	path: string,
): string {
	if (spec.ensureProfileDirFails) {
		throw new Error(`cannot create profile directory at ${path}`);
	}
	state.profiles[path] ??= profileStat(path);
	return path;
}

const isTemporaryPath = (path: string): boolean =>
	path.startsWith("/tmp/") ||
	path.startsWith("/private/tmp/") ||
	path.startsWith("/var/folders/") ||
	path.startsWith("/private/var/folders/");

// Old-implementation seam adapter: PreflightRuntime over the shared state.
// spawnChrome is the old fire-and-forget Promise<void>; there is no
// readSingletonLock and no CDP round-trip seam.
function buildOldRuntime(
	spec: ParityFixtureSpec,
	state: FixtureState,
): PreflightRuntime {
	return {
		env: { HOME },
		platform: spec.platform ?? "darwin",
		now: state.clockNow,
		fetchJson: async (url) => fetchVersionStep(state, url, "throw_timeout"),
		findListener: async (port) => findListenerStep(state, spec, port),
		currentUser: async () => "501",
		statProfile: async (path) => statProfileStep(state, path),
		ensureProfileDir: async (path) => ensureProfileDirStep(state, spec, path),
		chmod: async (path, mode) => chmodStep(state, path, mode),
		writeTextFile: async (_path, content) => writeTextFileStep(state, content),
		spawnChrome: async (input) => {
			state.calls.spawns += 1;
			if ((spec.spawn ?? "bind_healthy") === "bind_healthy") {
				bindSpawned(state, input);
			}
		},
		sleep: async (ms) => {
			state.advanceClock(ms);
			await new Promise((resolve) => setTimeout(resolve, 0));
		},
		isTemporaryPath,
	};
}

// New-implementation seam adapter: WarmChromeRuntime + proof/repair deps over
// the same shared state. spawnChrome returns the { pid, kill() } handle.
function buildNewRuntime(
	spec: ParityFixtureSpec,
	state: FixtureState,
): { runtime: WarmChromeRuntime; deps: WarmChromeRepairDeps } {
	const runtime = createDefaultRuntime({
		env: { HOME },
		platform: spec.platform ?? "darwin",
		now: state.clockNow,
		fetchJson: async (url) => fetchVersionStep(state, url, "pending"),
		findListener: async (port) => findListenerStep(state, spec, port),
		currentUser: async () => "501",
		statProfile: async (path) => statProfileStep(state, path),
		ensureProfileDir: async (path) => ensureProfileDirStep(state, spec, path),
		chmod: async (path, mode) => chmodStep(state, path, mode),
		writeTextFile: async (_path, content) => writeTextFileStep(state, content),
		spawnChrome: async (input) => {
			state.calls.spawns += 1;
			if ((spec.spawn ?? "bind_healthy") === "bind_healthy") {
				bindSpawned(state, input);
			}
			return { pid: SPAWNED_PID, kill: async () => true };
		},
		readSingletonLock: async (profileDir) =>
			spec.singletonLocks?.[profileDir] ?? null,
		isProcessAlive: async () => true,
		sleep: async (ms) => {
			state.advanceClock(ms);
			await new Promise((resolve) => setTimeout(resolve, 0));
		},
		isTemporaryPath,
	});
	const cdp = spec.cdp ?? healthyCdp();
	const deps: WarmChromeRepairDeps = {
		cdpRoundTrip: async (_wsUrl, method) => {
			const entry = cdp[method];
			if (!entry) throw new Error(`unexpected CDP method: ${method}`);
			if (entry instanceof Error) throw entry;
			return entry;
		},
		readDevToolsActivePort: async () => state.activePort,
		lstatFileKind: async (path): Promise<WarmChromeRepairFileKind> => {
			if (spec.symlinkPaths?.includes(path)) return "symlink";
			return state.activePort === null ? "missing" : "other";
		},
	};
	return { runtime, deps };
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

function extractOutcome(
	exitCode: number,
	stdout: string,
	calls: SideCalls,
	label: string,
): SideOutcome {
	let envelope: Record<string, unknown>;
	try {
		envelope = JSON.parse(stdout) as Record<string, unknown>;
	} catch (error) {
		throw new Error(`${label}: stdout is not a JSON envelope:\n${stdout}`, {
			cause: error,
		});
	}
	const status = envelope.status === "ok" ? "ok" : "error";
	const errorRecord = envelope.error as Record<string, unknown> | undefined;
	const data = envelope.data as Record<string, unknown> | undefined;
	return {
		status,
		code: status === "ok" ? null : String(errorRecord?.code ?? "missing_code"),
		exit: exitCode,
		reason: typeof data?.reason === "string" ? data.reason : null,
		calls: { ...calls },
		envelope,
	};
}

async function runOldSide(
	argv: readonly string[],
	spec: ParityFixtureSpec,
): Promise<SideOutcome> {
	const state = buildFixtureState(spec);
	const result = await runForTest(argv, buildOldRuntime(spec, state));
	return extractOutcome(result.exitCode, result.stdout, state.calls, "old side");
}

async function runNewSide(
	argv: readonly string[],
	spec: ParityFixtureSpec,
): Promise<SideOutcome> {
	const state = buildFixtureState(spec);
	const { runtime, deps } = buildNewRuntime(spec, state);
	const stdout = createMemoryWriter();
	const stderr = createMemoryWriter();
	const exitCode = await main(argv, {
		runtime,
		handlers: {
			check: createCheckCommandHandler(deps),
			launch: createLaunchCommandHandler(deps),
			repair: createRepairCommandHandler(deps),
		},
		stdout,
		stderr,
	});
	return extractOutcome(exitCode, stdout.output, state.calls, "new side");
}

/**
 * Old codes and behaviors with no 1:1 new home, enumerated UP FRONT (plan U8).
 * Every station-level difference a parity row expects must reference one of
 * these ids; the report lists them for the deferred switchover checklist.
 */
const INTENDED_DIVERGENCES = [
	{
		id: "canonical-code-collapse",
		note:
			"Old fine-grained codes (invalid_cdp_version, non_loopback_endpoint, non_loopback_websocket, chrome_for_testing, not_real_google_chrome, port_mismatch, unsafe_profile_permissions, default_profile, throwaway_profile, profile_missing, missing_profile, listener_missing) collapse into canonical station codes; the fine-grained cause survives as the machine-readable data.reason detail (decision: canonical-intent-level-error-codes).",
	},
	{
		id: "already-running-becomes-ok",
		note:
			"Old warm_chrome_already_running (error, exit 2, input domain) becomes launch.already_verified: an ok envelope carrying the verified 9222 convention endpoint as the only endpoint authority (R8/R10a).",
	},
	{
		id: "missing-profile-is-foreign",
		note:
			"Old missing_profile (listener argv without --user-data-dir) is reclassified by R6c: a /json/version answering on the default profile is a foreign instance, so it lands port_occupied_foreign reason json_answers_on_default_profile — as does the old default_profile listener verdict.",
	},
	{
		id: "profile-mismatch-exit-20",
		note:
			"Old profile_mismatch (exit 2, input domain) lands listener_mismatch reason profile_mismatch at exit 20: a listener that does not match the expected profile is a browser-entry verdict, not an argv correction.",
	},
	{
		id: "wrong-browser-exit-20",
		note:
			"Old launch-binary rejections chrome_for_testing / not_real_google_chrome (exit 2, input domain) land wrong_browser exit 20 with a reason detail; a wrong browser is a browser-entry handoff wherever it is detected and always carries no_adapter_fallback.",
	},
	{
		id: "invalid-profile-path-exit-20",
		note:
			"Old pre-spawn invalid_profile_path (exit 2, input domain) lands unsafe_profile reason invalid_profile_path at exit 20.",
	},
	{
		id: "foreign-port-vocabulary",
		note:
			"A foreign-owned port that the old preflight reported as endpoint_unreachable (check), listener_missing (lsof-invisible), or not_real_google_chrome (launch) lands the new port_occupied_foreign station with the informational suggested_explicit_port scan (decision: port-occupied-foreign-vocabulary).",
	},
	{
		id: "readiness-timeout-station",
		note:
			"Old post-spawn readiness timeout (endpoint_unreachable with primary inspect_listener) lands launch.spawned_unverified reason readiness_timeout — the sixteenth station: a post-spawn failure has mutated the workspace where a read-only check failure has not.",
	},
	{
		id: "launch-writes-are-diagnosed",
		note:
			"The old preflight wrote DevToolsActivePort on every launch and repair; the new launch never writes it, and the new repair writes it only when the proof diagnosed stale content (endpoint_id_mismatch) — mutation idempotence.",
	},
	{
		id: "repair-refuses-foreign",
		note:
			"New repair refuses CfT/Chromium/Electron/foreign listeners pre-proof as unrepairable reason foreign_listener_on_port (R11: never repair around an unverified listener); the old repair classified the same state through check codes (not_real_google_chrome).",
	},
	{
		id: "repair-ownership-unrepairable",
		note:
			"Old repair ownership failure (unsafe_profile_permissions, exit 2, input domain) lands repair.unrepairable reason profile_not_owned at exit 20.",
	},
	{
		id: "new-only-proof-steps",
		note:
			"Research-surfaced proofs with no old branch — the old preflight verifies these fixtures: localhost-alias reject, headless-UA reject, isolated-context reject, DevToolsActivePort endpoint-id cross-check, CDP round-trip failures, listener re-check (listener_missing/pid_mismatch during verification), profile_dir_remap, ws_only_no_http, cdp_contention re-probe, SingletonLock pre-bind refusal, DevToolsActivePort symlink refusal, pid-compare race policy.",
	},
	{
		id: "listener-uninspectable-reasonified",
		note:
			"Old listener_uninspectable survives as a port_occupied_foreign reason detail; the old listener_missing verdict for an lsof-invisible listener maps to the same reason.",
	},
	{
		id: "unsupported-platform-dropped",
		note:
			"Old unsupported_platform (exit 1 on non-darwin platforms) has no new home: the new seam carries platform but no station guards it. Switchover checklist item: decide whether the package needs a platform guard before browser-use switches.",
	},
] as const;

type IntendedDivergenceId = (typeof INTENDED_DIVERGENCES)[number]["id"];

const INTENDED_DIVERGENCE_IDS = new Set<string>(
	INTENDED_DIVERGENCES.map((entry) => entry.id),
);

type ParityExpectation = {
	status: "ok" | "error";
	code: string | null;
	exit: number;
};

type ParityRow = {
	id: string;
	argv: readonly string[];
	fixture: ParityFixtureSpec;
	rationale: string;
	old: ParityExpectation;
	new: ParityExpectation & { reason: string | null };
	/** Intended-divergence ids this row evidences; empty means station+exit agree. */
	divergenceIds: readonly IntendedDivergenceId[];
	assertCalls?: (sides: { old: SideCalls; new: SideCalls }) => void;
	assertEnvelopes?: (sides: {
		old: Record<string, unknown>;
		new: Record<string, unknown>;
	}) => void;
};

const CHECK = ["check"] as const;

const PARITY_ROWS: readonly ParityRow[] = [
	{
		id: "check_healthy_convention",
		argv: CHECK,
		fixture: {},
		rationale:
			"Healthy Warm Chrome on the 9222 convention verifies in both implementations.",
		old: { status: "ok", code: null, exit: 0 },
		new: { status: "ok", code: null, exit: 0, reason: null },
		divergenceIds: [],
	},
	{
		id: "check_nothing_listens",
		argv: CHECK,
		fixture: { listeners: {}, versions: {} },
		rationale:
			"Nothing on the port: both land endpoint_unreachable exit 20; the new side adds reason no_listener.",
		old: { status: "error", code: "endpoint_unreachable", exit: 20 },
		new: {
			status: "error",
			code: "endpoint_unreachable",
			exit: 20,
			reason: "no_listener",
		},
		divergenceIds: [],
	},
	{
		id: "check_pipe_only",
		argv: CHECK,
		fixture: {
			versions: {},
			listeners: {
				"9222": {
					pid: 4242,
					command: `${REAL_GOOGLE_CHROME_BINARY} --remote-debugging-pipe --user-data-dir=${DEDICATED_PROFILE}`,
				},
			},
		},
		rationale:
			"Pipe-only Chrome: same station and exit; only the new side attributes the cause (reason pipe_only_no_tcp) because the old check never consults the listener after a failed fetch.",
		old: { status: "error", code: "endpoint_unreachable", exit: 20 },
		new: {
			status: "error",
			code: "endpoint_unreachable",
			exit: 20,
			reason: "pipe_only_no_tcp",
		},
		divergenceIds: [],
	},
	{
		id: "check_attach_hang",
		argv: CHECK,
		fixture: { versions: { "9222": "hang" } },
		rationale:
			"Unreachable attach hang: the old seam's fetchJson owns the timeout (adapter throws for it); the new proof owns a bounded attach race above the seam. Same station and exit.",
		old: { status: "error", code: "endpoint_unreachable", exit: 20 },
		new: {
			status: "error",
			code: "endpoint_unreachable",
			exit: 20,
			reason: "attach_timeout",
		},
		divergenceIds: [],
	},
	{
		id: "check_localhost_alias",
		argv: ["check", "--endpoint", "http://localhost:9222"],
		fixture: {},
		rationale:
			"The old preflight accepted the localhost alias and verified; the new proof rejects it before any probe trusts the endpoint (a mangled hosts file can point the alias anywhere).",
		old: { status: "ok", code: null, exit: 0 },
		new: { status: "error", code: "non_loopback", exit: 20, reason: "localhost_alias" },
		divergenceIds: ["new-only-proof-steps"],
	},
	{
		id: "check_non_loopback_endpoint",
		argv: ["check", "--endpoint", "http://192.168.1.20:9222"],
		fixture: {},
		rationale:
			"Non-loopback endpoint: old non_loopback_endpoint exited 2 (input); the canonical non_loopback station pins exit 20 while keeping the change_input routing.",
		old: { status: "error", code: "non_loopback_endpoint", exit: 2 },
		new: {
			status: "error",
			code: "non_loopback",
			exit: 20,
			reason: "non_loopback_endpoint",
		},
		divergenceIds: ["canonical-code-collapse"],
	},
	{
		id: "check_non_loopback_websocket",
		argv: CHECK,
		fixture: {
			versions: {
				"9222": healthyVersionFor("9222", {
					webSocketDebuggerUrl: "ws://192.168.1.20:9222/devtools/browser/x",
				}),
			},
		},
		rationale:
			"Non-loopback websocket in /json/version: old fine-grained non_loopback_websocket collapses into non_loopback with the same string as reason.",
		old: { status: "error", code: "non_loopback_websocket", exit: 20 },
		new: {
			status: "error",
			code: "non_loopback",
			exit: 20,
			reason: "non_loopback_websocket",
		},
		divergenceIds: ["canonical-code-collapse"],
	},
	{
		id: "check_malformed_json_version",
		argv: CHECK,
		fixture: {
			versions: {
				"9222": {
					"User-Agent": HEADED_UA,
					webSocketDebuggerUrl: wsFor("9222"),
				},
			},
		},
		rationale:
			"Missing Browser field: old invalid_cdp_version collapses into invalid_cdp reason malformed_json_version.",
		old: { status: "error", code: "invalid_cdp_version", exit: 20 },
		new: {
			status: "error",
			code: "invalid_cdp",
			exit: 20,
			reason: "malformed_json_version",
		},
		divergenceIds: ["canonical-code-collapse"],
	},
	{
		id: "check_ws_only_no_http",
		argv: CHECK,
		fixture: { versions: { "9222": new Error("request failed: 404") } },
		rationale:
			"Listener speaks HTTP but serves no /json/version: the old check could not distinguish a 404 from a refused connection (endpoint_unreachable); the new proof classifies it invalid_cdp/ws_only_no_http.",
		old: { status: "error", code: "endpoint_unreachable", exit: 20 },
		new: { status: "error", code: "invalid_cdp", exit: 20, reason: "ws_only_no_http" },
		divergenceIds: ["new-only-proof-steps"],
	},
	{
		id: "check_endpoint_id_mismatch",
		argv: CHECK,
		fixture: {
			activePort: { port: "9222", wsPath: "/devtools/browser/another-token" },
		},
		rationale:
			"DevToolsActivePort id disagrees with the live /json/version id: the old preflight never read the file, so it verified; the new endpoint-id cross-check rejects (R6c).",
		old: { status: "ok", code: null, exit: 0 },
		new: {
			status: "error",
			code: "invalid_cdp",
			exit: 20,
			reason: "endpoint_id_mismatch",
		},
		divergenceIds: ["new-only-proof-steps"],
	},
	{
		id: "check_cdp_roundtrip_failed",
		argv: CHECK,
		fixture: {
			cdp: healthyCdp({ "Browser.getVersion": new Error("socket closed") }),
		},
		rationale:
			"Browser.getVersion round-trip fails: the old preflight had no CDP round-trip seam and verified on a parseable /json/version alone.",
		old: { status: "ok", code: null, exit: 0 },
		new: { status: "error", code: "invalid_cdp", exit: 20, reason: "roundtrip_failed" },
		divergenceIds: ["new-only-proof-steps"],
	},
	{
		id: "check_cdp_contention",
		argv: CHECK,
		fixture: {
			versions: {
				"9222": [
					{
						Browser: OBSERVED_BUILD,
						"Protocol-Version": "1.3",
						"User-Agent": HEADED_UA,
					},
					healthyVersionFor("9222"),
				],
			},
		},
		rationale:
			"Missing webSocketDebuggerUrl under multi-client contention: old invalid_cdp_version; the new proof re-probes before any browser-down verdict (R7a) and names the contention.",
		old: { status: "error", code: "invalid_cdp_version", exit: 20 },
		new: { status: "error", code: "invalid_cdp", exit: 20, reason: "cdp_contention" },
		divergenceIds: ["canonical-code-collapse"],
	},
	{
		id: "check_foreign_listener",
		argv: CHECK,
		fixture: { versions: {}, listeners: { "9222": FOREIGN_LISTENER } },
		rationale:
			"Foreign process owns 9222 with no CDP answer: the old check reported endpoint_unreachable (it never consulted the listener after a failed fetch); the new station is port_occupied_foreign with suggested_explicit_port.",
		old: { status: "error", code: "endpoint_unreachable", exit: 20 },
		new: {
			status: "error",
			code: "port_occupied_foreign",
			exit: 20,
			reason: "foreign_listener",
		},
		divergenceIds: ["foreign-port-vocabulary"],
		assertEnvelopes: ({ new: newEnvelope }) => {
			const data = newEnvelope.data as Record<string, unknown>;
			expect(typeof data.suggested_explicit_port).toBe("number");
		},
	},
	{
		id: "check_default_profile_listener",
		argv: CHECK,
		fixture: {
			listeners: { "9222": chromeListener({ profile: DEFAULT_PROFILE_ROOT }) },
			profiles: {
				[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE),
				[DEFAULT_PROFILE_ROOT]: profileStat(DEFAULT_PROFILE_ROOT),
			},
		},
		rationale:
			"Chrome answering CDP on the everyday default profile: old default_profile; R6c reclassifies it as a foreign instance (Chrome 144+ hardening means the real default-profile server has no HTTP endpoint).",
		old: { status: "error", code: "default_profile", exit: 20 },
		new: {
			status: "error",
			code: "port_occupied_foreign",
			exit: 20,
			reason: "json_answers_on_default_profile",
		},
		divergenceIds: ["missing-profile-is-foreign"],
	},
	{
		id: "check_no_user_data_dir",
		argv: CHECK,
		fixture: { listeners: { "9222": chromeListener({ profile: null }) } },
		rationale:
			"Chrome listener without --user-data-dir: old missing_profile; the new proof reads it as running on the default profile, which answering /json/version marks foreign (R6c).",
		old: { status: "error", code: "missing_profile", exit: 20 },
		new: {
			status: "error",
			code: "port_occupied_foreign",
			exit: 20,
			reason: "json_answers_on_default_profile",
		},
		divergenceIds: ["missing-profile-is-foreign"],
	},
	{
		id: "check_lsof_invisible_listener",
		argv: CHECK,
		fixture: { listeners: {} },
		rationale:
			"CDP answers but no listener is attributable: old listener_missing; the new station is port_occupied_foreign reason listener_uninspectable (an unattributable answering port is foreign until proven).",
		old: { status: "error", code: "listener_missing", exit: 20 },
		new: {
			status: "error",
			code: "port_occupied_foreign",
			exit: 20,
			reason: "listener_uninspectable",
		},
		divergenceIds: ["listener-uninspectable-reasonified"],
	},
	{
		id: "check_chrome_for_testing_listener",
		argv: CHECK,
		fixture: {
			listeners: {
				"9222": {
					pid: 4242,
					command: `"${CFT_BINARY}" --remote-debugging-port=9222 --user-data-dir=${DEDICATED_PROFILE}`,
				},
			},
		},
		rationale:
			"Chrome for Testing listener: old chrome_for_testing collapses into wrong_browser with the same string as reason; identity decided by binary path, not banner (R6).",
		old: { status: "error", code: "chrome_for_testing", exit: 20 },
		new: {
			status: "error",
			code: "wrong_browser",
			exit: 20,
			reason: "chrome_for_testing",
		},
		divergenceIds: ["canonical-code-collapse"],
	},
	{
		id: "check_chromium_listener",
		argv: CHECK,
		fixture: {
			listeners: {
				"9222": {
					pid: 4242,
					command: `/Applications/Chromium.app/Contents/MacOS/Chromium --remote-debugging-port=9222 --user-data-dir=${DEDICATED_PROFILE}`,
				},
			},
		},
		rationale:
			"Chromium listener: the old forbidden-binary check filed Chromium under chrome_for_testing; the new reason vocabulary names it chromium.",
		old: { status: "error", code: "chrome_for_testing", exit: 20 },
		new: { status: "error", code: "wrong_browser", exit: 20, reason: "chromium" },
		divergenceIds: ["canonical-code-collapse"],
	},
	{
		id: "check_electron_listener",
		argv: CHECK,
		fixture: {
			listeners: {
				"9222": {
					pid: 4242,
					command: `/Applications/Slack.app/Contents/MacOS/Slack --remote-debugging-port=9222 --user-data-dir=${DEDICATED_PROFILE}`,
				},
			},
		},
		rationale:
			"Electron CDP endpoint: old not_real_google_chrome collapses into wrong_browser reason electron_or_other.",
		old: { status: "error", code: "not_real_google_chrome", exit: 20 },
		new: {
			status: "error",
			code: "wrong_browser",
			exit: 20,
			reason: "electron_or_other",
		},
		divergenceIds: ["canonical-code-collapse"],
	},
	{
		id: "check_headless_ua",
		argv: CHECK,
		fixture: {
			cdp: healthyCdp({
				"Browser.getVersion": {
					product: "HeadlessChrome/138.0.7204.49",
					userAgent:
						"Mozilla/5.0 (Macintosh) AppleWebKit/537.36 HeadlessChrome/138.0.0.0 Safari/537.36",
				},
			}),
		},
		rationale:
			"Headless-new is endpoint-indistinguishable from headed since Chrome 112; the only CDP tell is the Browser.getVersion UA the old preflight never fetched (R6b).",
		old: { status: "ok", code: null, exit: 0 },
		new: {
			status: "error",
			code: "wrong_browser",
			exit: 20,
			reason: "headless_not_headed",
		},
		divergenceIds: ["new-only-proof-steps"],
	},
	{
		id: "check_isolated_context",
		argv: CHECK,
		fixture: {
			cdp: healthyCdp({
				"Target.getBrowserContexts": { browserContextIds: ["ctx-isolated"] },
				"Target.getTargets": {
					targetInfos: [{ type: "page", browserContextId: "ctx-isolated" }],
				},
			}),
		},
		rationale:
			"Only isolated/incognito contexts: the default-context assertion (R6a) is a new-only CDP proof.",
		old: { status: "ok", code: null, exit: 0 },
		new: {
			status: "error",
			code: "wrong_browser",
			exit: 20,
			reason: "isolated_context",
		},
		divergenceIds: ["new-only-proof-steps"],
	},
	{
		id: "check_provided_profile_is_default",
		argv: ["check", "--profile", DEFAULT_PROFILE_ROOT],
		fixture: {
			profiles: {
				[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE),
				[DEFAULT_PROFILE_ROOT]: profileStat(DEFAULT_PROFILE_ROOT),
			},
		},
		rationale:
			"--profile naming the everyday default profile: the old check compared it against the listener first (profile_mismatch, exit 2); the new proof rejects the unsafe posture itself (unsafe_profile/default_profile, exit 20).",
		old: { status: "error", code: "profile_mismatch", exit: 2 },
		new: { status: "error", code: "unsafe_profile", exit: 20, reason: "default_profile" },
		divergenceIds: ["canonical-code-collapse", "profile-mismatch-exit-20"],
	},
	{
		id: "check_throwaway_profile",
		argv: CHECK,
		fixture: {
			listeners: { "9222": chromeListener({ profile: "/tmp/warm-profile" }) },
			profiles: { "/tmp/warm-profile": profileStat("/tmp/warm-profile") },
		},
		rationale:
			"Throwaway temp listener profile: old throwaway_profile collapses into unsafe_profile with the same string as reason.",
		old: { status: "error", code: "throwaway_profile", exit: 20 },
		new: {
			status: "error",
			code: "unsafe_profile",
			exit: 20,
			reason: "throwaway_profile",
		},
		divergenceIds: ["canonical-code-collapse"],
	},
	{
		id: "check_unsafe_profile_permissions",
		argv: CHECK,
		fixture: {
			profiles: {
				[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE, { mode: "755" }),
			},
		},
		rationale:
			"Group-readable profile: old unsafe_profile_permissions collapses into unsafe_profile with the same string as reason.",
		old: { status: "error", code: "unsafe_profile_permissions", exit: 20 },
		new: {
			status: "error",
			code: "unsafe_profile",
			exit: 20,
			reason: "unsafe_profile_permissions",
		},
		divergenceIds: ["canonical-code-collapse"],
	},
	{
		id: "check_profile_stat_missing",
		argv: CHECK,
		fixture: { profiles: {} },
		rationale:
			"Listener profile cannot be resolved: old profile_missing collapses into unsafe_profile reason invalid_profile_path.",
		old: { status: "error", code: "profile_missing", exit: 20 },
		new: {
			status: "error",
			code: "unsafe_profile",
			exit: 20,
			reason: "invalid_profile_path",
		},
		divergenceIds: ["canonical-code-collapse"],
	},
	{
		id: "check_profile_dir_remap",
		argv: CHECK,
		fixture: {
			listeners: {
				"9222": chromeListener({ extraArgs: "--profile-directory=Work" }),
			},
			profiles: {
				[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE),
				[`${DEDICATED_PROFILE}/Work`]: profileStat(`${DEDICATED_PROFILE}/Work`, {
					realPath: "/Users/warm/elsewhere/Work",
				}),
			},
		},
		rationale:
			"--profile-directory resolving outside the dedicated user-data-dir (Chrome 136+ remap): the old preflight ignored the flag and verified.",
		old: { status: "ok", code: null, exit: 0 },
		new: {
			status: "error",
			code: "unsafe_profile",
			exit: 20,
			reason: "profile_dir_remap",
		},
		divergenceIds: ["new-only-proof-steps"],
	},
	{
		id: "check_listener_port_mismatch",
		argv: CHECK,
		fixture: { listeners: { "9222": chromeListener({ port: "9333" }) } },
		rationale:
			"Listener argv names a different CDP port: old port_mismatch collapses into listener_mismatch with the same string as reason.",
		old: { status: "error", code: "port_mismatch", exit: 20 },
		new: { status: "error", code: "listener_mismatch", exit: 20, reason: "port_mismatch" },
		divergenceIds: ["canonical-code-collapse"],
	},
	{
		id: "check_provided_profile_mismatch",
		argv: ["check", "--profile", OTHER_PROFILE],
		fixture: {
			profiles: {
				[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE),
				[OTHER_PROFILE]: profileStat(OTHER_PROFILE),
			},
		},
		rationale:
			"--profile disagrees with the listener profile: old profile_mismatch exited 2 (input); the new station listener_mismatch pins exit 20 with profile_mismatch as reason.",
		old: { status: "error", code: "profile_mismatch", exit: 2 },
		new: {
			status: "error",
			code: "listener_mismatch",
			exit: 20,
			reason: "profile_mismatch",
		},
		divergenceIds: ["profile-mismatch-exit-20"],
	},
	{
		id: "check_listener_disappears",
		argv: CHECK,
		fixture: { listeners: { "9222": [chromeListener(), null] } },
		rationale:
			"Listener disappears during verification: the old check inspected the listener once and verified; the new final-consistency re-check catches it.",
		old: { status: "ok", code: null, exit: 0 },
		new: {
			status: "error",
			code: "listener_mismatch",
			exit: 20,
			reason: "listener_missing",
		},
		divergenceIds: ["new-only-proof-steps"],
	},
	{
		id: "check_listener_pid_changes",
		argv: CHECK,
		fixture: {
			listeners: {
				"9222": [chromeListener({ pid: 4242 }), chromeListener({ pid: 999 })],
			},
		},
		rationale:
			"Listener pid changes during verification: new-only final-consistency re-check (reason pid_mismatch).",
		old: { status: "ok", code: null, exit: 0 },
		new: {
			status: "error",
			code: "listener_mismatch",
			exit: 20,
			reason: "pid_mismatch",
		},
		divergenceIds: ["new-only-proof-steps"],
	},
	{
		id: "check_runtime_fault",
		argv: CHECK,
		fixture: { findListenerFaultMessage: "lsof exploded" },
		rationale:
			"A raw seam fault escapes as runtime_failure exit 1 in both implementations, with the untrusted message kept out of the envelope.",
		old: { status: "error", code: "runtime_failure", exit: 1 },
		new: { status: "error", code: "runtime_failure", exit: 1, reason: null },
		divergenceIds: [],
	},
	{
		id: "check_invalid_usage",
		argv: ["check", "--bogus"],
		fixture: {},
		rationale: "Unknown flags exit 2 with invalid_usage in both implementations.",
		old: { status: "error", code: "invalid_usage", exit: 2 },
		new: { status: "error", code: "invalid_usage", exit: 2, reason: null },
		divergenceIds: [],
	},
	{
		id: "check_non_darwin_platform",
		argv: CHECK,
		fixture: { platform: "linux" },
		rationale:
			"Non-darwin platform over a healthy fixture: the old preflight refused (unsupported_platform, exit 1); the new package has no platform guard and verifies.",
		old: { status: "error", code: "unsupported_platform", exit: 1 },
		new: { status: "ok", code: null, exit: 0, reason: null },
		divergenceIds: ["unsupported-platform-dropped"],
	},
	// ---- launch ----
	{
		id: "launch_already_verified",
		argv: ["launch", "--profile", DEDICATED_PROFILE],
		fixture: {},
		rationale:
			"Launch against an already-verified Warm Chrome: both return ok without spawning; the old preflight wrote DevToolsActivePort on every launch, the new launch never writes it.",
		old: { status: "ok", code: null, exit: 0 },
		new: { status: "ok", code: null, exit: 0, reason: null },
		divergenceIds: ["launch-writes-are-diagnosed"],
		assertCalls: ({ old, new: fresh }) => {
			expect(old.spawns).toBe(0);
			expect(fresh.spawns).toBe(0);
			expect(old.writes).toBe(1);
			expect(fresh.writes).toBe(0);
		},
	},
	{
		id: "launch_spawns_and_verifies",
		argv: ["launch", "--profile", DEDICATED_PROFILE],
		fixture: { listeners: {}, versions: {}, spawn: "bind_healthy" },
		rationale:
			"Nothing listens, spawn succeeds: both spawn once and verify; only the old side writes DevToolsActivePort.",
		old: { status: "ok", code: null, exit: 0 },
		new: { status: "ok", code: null, exit: 0, reason: null },
		divergenceIds: ["launch-writes-are-diagnosed"],
		assertCalls: ({ old, new: fresh }) => {
			expect(old.spawns).toBe(1);
			expect(fresh.spawns).toBe(1);
			expect(old.writes).toBe(1);
			expect(fresh.writes).toBe(0);
		},
	},
	{
		id: "launch_foreign_port_fails_closed",
		argv: ["launch", "--profile", DEDICATED_PROFILE],
		fixture: { versions: {}, listeners: { "9222": FOREIGN_LISTENER } },
		rationale:
			"Foreign process on the requested port: both fail closed without spawning; old classified the squatter as not_real_google_chrome, new re-emits port_occupied_foreign with suggested_explicit_port.",
		old: { status: "error", code: "not_real_google_chrome", exit: 20 },
		new: {
			status: "error",
			code: "port_occupied_foreign",
			exit: 20,
			reason: "foreign_listener",
		},
		divergenceIds: ["foreign-port-vocabulary"],
		assertCalls: ({ old, new: fresh }) => {
			expect(old.spawns).toBe(0);
			expect(fresh.spawns).toBe(0);
		},
	},
	{
		id: "launch_explicit_port_while_convention_verified",
		argv: ["launch", "--port", "9500", "--profile", DEDICATED_PROFILE],
		fixture: {},
		rationale:
			"Launch on another port while a verified Warm Chrome holds 9222: old refused with warm_chrome_already_running (error, exit 2); new lands launch.already_verified — an ok envelope whose endpoint authority is the verified 9222 convention endpoint (R8/R10a).",
		old: { status: "error", code: "warm_chrome_already_running", exit: 2 },
		new: { status: "ok", code: null, exit: 0, reason: null },
		divergenceIds: ["already-running-becomes-ok"],
		assertCalls: ({ old, new: fresh }) => {
			expect(old.spawns).toBe(0);
			expect(fresh.spawns).toBe(0);
		},
		assertEnvelopes: ({ new: newEnvelope }) => {
			const data = newEnvelope.data as Record<string, unknown>;
			expect(data.endpoint).toBe("http://127.0.0.1:9222");
			expect(data.launch_performed).toBe(false);
		},
	},
	{
		id: "launch_readiness_timeout",
		argv: ["launch", "--profile", DEDICATED_PROFILE],
		fixture: { listeners: {}, versions: {}, spawn: "bind_nothing" },
		rationale:
			"Chrome spawns but never verifies inside the readiness budget: old endpoint_unreachable; new lands the sixteenth station launch.spawned_unverified reason readiness_timeout, because browser state was mutated.",
		old: { status: "error", code: "endpoint_unreachable", exit: 20 },
		new: {
			status: "error",
			code: "spawned_unverified",
			exit: 20,
			reason: "readiness_timeout",
		},
		divergenceIds: ["readiness-timeout-station"],
		assertCalls: ({ old, new: fresh }) => {
			expect(old.spawns).toBe(1);
			expect(fresh.spawns).toBe(1);
		},
	},
	{
		id: "launch_chrome_for_testing_binary",
		argv: [
			"launch",
			"--chrome",
			CFT_BINARY,
			"--profile",
			DEDICATED_PROFILE,
		],
		fixture: { listeners: {}, versions: {} },
		rationale:
			"--chrome names Chrome for Testing: old chrome_for_testing exited 2 (input); new wrong_browser exits 20 with the reason — a wrong browser is a browser-entry handoff wherever it is detected.",
		old: { status: "error", code: "chrome_for_testing", exit: 2 },
		new: {
			status: "error",
			code: "wrong_browser",
			exit: 20,
			reason: "chrome_for_testing",
		},
		divergenceIds: ["wrong-browser-exit-20"],
		assertCalls: ({ old, new: fresh }) => {
			expect(old.spawns).toBe(0);
			expect(fresh.spawns).toBe(0);
		},
	},
	{
		id: "launch_uncreatable_profile",
		argv: ["launch", "--profile", `${HOME}/uncreatable`],
		fixture: { listeners: {}, versions: {}, ensureProfileDirFails: true },
		rationale:
			"Profile directory cannot be created pre-spawn: old invalid_profile_path exited 2 (input); new unsafe_profile exits 20 with invalid_profile_path as reason.",
		old: { status: "error", code: "invalid_profile_path", exit: 2 },
		new: {
			status: "error",
			code: "unsafe_profile",
			exit: 20,
			reason: "invalid_profile_path",
		},
		divergenceIds: ["invalid-profile-path-exit-20"],
	},
	{
		id: "launch_singleton_lock_held",
		argv: ["launch", "--profile", DEDICATED_PROFILE],
		fixture: {
			listeners: {},
			versions: {},
			singletonLocks: {
				[DEDICATED_PROFILE]: {
				raw: "warm-host-77",
				hostname: "warm-host",
				pid: 77,
				local: true,
			},
			},
			spawn: "bind_healthy",
		},
		rationale:
			"SingletonLock held while the port looks free (prior launch mid-startup): the old preflight had no lock probe and spawned a second Chrome; the new pre-bind refusal (R9) lands spawned_unverified without spawning.",
		old: { status: "ok", code: null, exit: 0 },
		new: {
			status: "error",
			code: "spawned_unverified",
			exit: 20,
			reason: "prior_launch_mid_startup",
		},
		divergenceIds: ["new-only-proof-steps"],
		assertCalls: ({ old, new: fresh }) => {
			expect(old.spawns).toBe(1);
			expect(fresh.spawns).toBe(0);
		},
	},
	// ---- repair ----
	{
		id: "repair_unsafe_permissions",
		argv: ["repair", "--profile", DEDICATED_PROFILE],
		fixture: {
			profiles: {
				[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE, { mode: "755" }),
			},
		},
		rationale:
			"Group-readable profile repaired: both chmod 0o700 and re-verify; the old repair also wrote DevToolsActivePort unconditionally, the new writes only on a diagnosed stale file.",
		old: { status: "ok", code: null, exit: 0 },
		new: { status: "ok", code: null, exit: 0, reason: null },
		divergenceIds: ["launch-writes-are-diagnosed"],
		assertCalls: ({ old, new: fresh }) => {
			expect(old.chmods).toBe(1);
			expect(fresh.chmods).toBe(1);
			expect(old.writes).toBe(1);
			expect(fresh.writes).toBe(0);
		},
	},
	{
		id: "repair_foreign_listener_refused",
		argv: ["repair"],
		fixture: {
			listeners: {
				"9222": {
					pid: 4242,
					command: `/Applications/Slack.app/Contents/MacOS/Slack --remote-debugging-port=9222 --user-data-dir=${DEDICATED_PROFILE}`,
				},
			},
		},
		rationale:
			"Non-Chrome listener on the port: old repair classified it through check codes (not_real_google_chrome); new repair refuses pre-proof as unrepairable/foreign_listener_on_port and never mutates (R11).",
		old: { status: "error", code: "not_real_google_chrome", exit: 20 },
		new: {
			status: "error",
			code: "unrepairable",
			exit: 20,
			reason: "foreign_listener_on_port",
		},
		divergenceIds: ["repair-refuses-foreign"],
		assertCalls: ({ new: fresh }) => {
			expect(fresh.chmods).toBe(0);
			expect(fresh.writes).toBe(0);
		},
	},
	{
		id: "repair_profile_not_owned",
		argv: ["repair", "--profile", DEDICATED_PROFILE],
		fixture: {
			profiles: {
				[DEDICATED_PROFILE]: profileStat(DEDICATED_PROFILE, {
					mode: "755",
					owner: "502",
				}),
			},
		},
		rationale:
			"Profile owned by another user: old unsafe_profile_permissions exited 2 (input); new repair refuses as unrepairable/profile_not_owned at exit 20 — repairing state we do not own fails closed.",
		old: { status: "error", code: "unsafe_profile_permissions", exit: 2 },
		new: {
			status: "error",
			code: "unrepairable",
			exit: 20,
			reason: "profile_not_owned",
		},
		divergenceIds: ["repair-ownership-unrepairable"],
	},
	{
		id: "repair_stale_devtools_active_port",
		argv: ["repair", "--profile", DEDICATED_PROFILE],
		fixture: {
			activePort: { port: "9222", wsPath: "/devtools/browser/stale-token" },
		},
		rationale:
			"Stale DevToolsActivePort content: both repair and verify; the old wrote unconditionally, the new diagnosed the stale id first (endpoint_id_mismatch) and wrote from the live /json/version answer.",
		old: { status: "ok", code: null, exit: 0 },
		new: { status: "ok", code: null, exit: 0, reason: null },
		divergenceIds: ["launch-writes-are-diagnosed"],
		assertCalls: ({ old, new: fresh }) => {
			expect(old.writes).toBe(1);
			expect(fresh.writes).toBe(1);
		},
	},
	{
		id: "repair_symlinked_devtools_active_port",
		argv: ["repair", "--profile", DEDICATED_PROFILE],
		fixture: {
			activePort: { port: "9222", wsPath: "/devtools/browser/stale-token" },
			symlinkPaths: [ACTIVE_PORT_PATH],
		},
		rationale:
			"Symlink planted at DevToolsActivePort: the old repair wrote through it (out-of-profile write hazard); the new lstat no-follow guard refuses as unrepairable/devtools_active_port_symlink without writing.",
		old: { status: "ok", code: null, exit: 0 },
		new: {
			status: "error",
			code: "unrepairable",
			exit: 20,
			reason: "devtools_active_port_symlink",
		},
		divergenceIds: ["new-only-proof-steps"],
		assertCalls: ({ old, new: fresh }) => {
			expect(old.writes).toBe(1);
			expect(fresh.writes).toBe(0);
		},
	},
];

function stationLabel(expectation: {
	status: string;
	code: string | null;
	exit: number;
}): string {
	return `${expectation.status}:${expectation.code ?? "-"}/exit ${expectation.exit}`;
}

function stationDiffers(row: ParityRow): boolean {
	return (
		row.old.status !== row.new.status ||
		row.old.code !== row.new.code ||
		row.old.exit !== row.new.exit
	);
}

type MeasuredRow = {
	row: ParityRow;
	old: SideOutcome;
	new: SideOutcome;
};

const measured: MeasuredRow[] = [];

describe("warm-chrome parity harness (U8 R15/R16): measured golden-envelope parity", () => {
	test("row table bookkeeping: every station-level difference references an enumerated intended divergence", () => {
		const ids = new Set<string>();
		for (const row of PARITY_ROWS) {
			expect(ids.has(row.id)).toBe(false);
			ids.add(row.id);
			for (const divergenceId of row.divergenceIds) {
				expect(INTENDED_DIVERGENCE_IDS.has(divergenceId)).toBe(true);
			}
			if (stationDiffers(row)) {
				if (row.divergenceIds.length === 0) {
					throw new Error(
						`${row.id}: expected outcomes differ (${stationLabel(row.old)} vs ${stationLabel(row.new)}) without a recorded intended divergence`,
					);
				}
			}
		}
	});

	test("every enumerated intended divergence is evidenced by at least one measured row", () => {
		const covered = new Set(PARITY_ROWS.flatMap((row) => [...row.divergenceIds]));
		const uncovered = INTENDED_DIVERGENCES.map((entry) => entry.id).filter(
			(id) => !covered.has(id),
		);
		expect(uncovered).toEqual([]);
	});

	for (const row of PARITY_ROWS) {
		test(`${row.id}: old ${stationLabel(row.old)} | new ${stationLabel(row.new)}`, async () => {
			const oldOutcome = await runOldSide(row.argv, row.fixture);
			const newOutcome = await runNewSide(row.argv, row.fixture);
			measured.push({ row, old: oldOutcome, new: newOutcome });

			const context = `${row.id}\nrationale: ${row.rationale}`;
			expect(
				{ status: oldOutcome.status, code: oldOutcome.code, exit: oldOutcome.exit },
				`old side drifted from the recorded translation row\n${context}`,
			).toEqual(row.old);
			expect(
				{ status: newOutcome.status, code: newOutcome.code, exit: newOutcome.exit },
				`new side drifted from the recorded translation row\n${context}`,
			).toEqual({ status: row.new.status, code: row.new.code, exit: row.new.exit });
			expect(newOutcome.reason, context).toBe(row.new.reason);

			row.assertCalls?.({ old: oldOutcome.calls, new: newOutcome.calls });
			row.assertEnvelopes?.({
				old: oldOutcome.envelope,
				new: newOutcome.envelope,
			});
		});
	}

	test("parity divergence report: station-level diff for the deferred switchover checklist", () => {
		expect(measured.length).toBe(PARITY_ROWS.length);
		const agree = measured.filter((entry) => !stationDiffers(entry.row));
		const diverge = measured.filter((entry) => stationDiffers(entry.row));

		const lines: string[] = [
			"",
			"warm-chrome parity report (fixture-measured; old = skills/browser-use preflight, new = @side-quest/warm-chrome)",
			`rows: ${measured.length} | station+exit agreement: ${agree.length} | station-level divergences (all intended): ${diverge.length}`,
			"",
			"intended divergences (enumerated up front):",
			...INTENDED_DIVERGENCES.map((entry) => `  [${entry.id}] ${entry.note}`),
			"",
			"station-level diff:",
		];
		for (const entry of measured) {
			const marker = stationDiffers(entry.row) ? "DIVERGE" : "AGREE  ";
			const reason = entry.new.reason === null ? "" : ` reason=${entry.new.reason}`;
			const refs =
				entry.row.divergenceIds.length === 0
					? ""
					: ` [${entry.row.divergenceIds.join(", ")}]`;
			lines.push(
				`  ${marker} ${entry.row.id}: old ${stationLabel(entry.old)} -> new ${stationLabel(entry.new)}${reason}${refs}`,
			);
		}
		lines.push("");
		console.log(lines.join("\n"));
	});
});
