import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnTransportCommand } from "@side-quest/mcporter-transport";
import { ENVELOPE_ADAPTER_CALL_ENV } from "./browser-use-transport";
import type { McporterCommandInput } from "./mcporter-transport";
import { acquireLease, listLeases } from "./browser-use-locks";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import type { RunStoreDeps } from "./browser-use-runs";
import { leaseKeyForRun, loadSharedRun } from "./browser-use-runs";
import type { BrowserUseSharedRun } from "./browser-use-run-model";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";
import { LIVE_CLEAN_PROFILE_POSTURE_FIXTURE } from "./browser-connect-handoff-fixtures";

// =========================================================================
// Daily Driver Acceptance Ledger — process-hygiene cluster.
//
// Fixture-backed acceptance proofs for three UNASSESSED rows. Hermetic (H)
// and process (E) tiers only: real fixture binaries and a real driver process
// where the oracle demands it, but no live browser and no network beyond the
// loopback fixtures the tests spawn themselves.
//
//   DDA-B25  A hanging adapter is bounded by the command timeout and leaves
//            no orphan process or session.
//   DDA-H22  No background daemon or keepalive persists after a command exits.
//   DDA-H21  A leftover named adapter session from a crashed prior run does
//            not block the next run — it recovers with a typed outcome.
// =========================================================================

const disposables: { dispose(): void }[] = [];
const tempRoots: string[] = [];
afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
	for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// Verbatim verified-handoff `data` payload (agent-browser lane), the same shape
// the wave-1 executor proof and the task-run CLI dispatch tests use. Written to
// a temp file the CLI reads via --handoff so the driver reaches the agent-browser
// dispatch + outcome-recording path (where the run lease is acquired).
const AGENT_BROWSER_HANDOFF = {
	status: "ok",
	run_id: "run-proc-hygiene-1",
	data: {
		outcome: "verified",
		environment: { name: "agent-chrome", profile: "default" },
		browser_entry_mode: "explicit-cdp",
		attachment: {
			adapter_id: "agent-browser",
			route: "explicit-cdp",
			probe_executable: "/opt/browser-connect/agent-browser",
		},
		endpoint: {
			http: "http://127.0.0.1:9222",
			ws: "ws://127.0.0.1:9222/devtools/browser/fixture",
		},
		launch: { launched: false },
		proof: {
			environment_contract_id: "warm-chrome.browser-entry",
			environment_schema_version: "2",
			route_evidence: "verified-live",
			profile_posture: LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
		},
		contract_id: "browser-connect.verified-handoff",
		schema_version: "3",
	},
	error: null,
} as const;

function adapterSuccess(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

async function makeStore(): Promise<{
	env: Record<string, string | undefined>;
	deps: RunStoreDeps;
	handoffPath: string;
}> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	const handoffPath = join(xdg.base, "handoff.json");
	writeFileSync(handoffPath, JSON.stringify(AGENT_BROWSER_HANDOFF), "utf-8");
	return {
		env: xdg.env,
		deps: { fs, paths: opened.paths, clock: fixedClock().now },
		handoffPath,
	};
}

// A runtime whose runCommand replays a scripted adapter response sequence over a
// real temp XDG store — the same seam browser-use-task-run.test.ts uses. Only
// the adapter command runner is scripted; the handoff file is read for real.
function taskRunRuntime(
	env: Record<string, string | undefined>,
	responses: readonly {
		stdout?: string;
		exitCode?: number;
		timedOut?: boolean;
	}[],
) {
	let index = 0;
	return makeRuntime({
		env,
		now: () => 1_000,
		platformFs: createDefaultPlatformFs(),
		readTextFile: (path: string) =>
			import("node:fs/promises").then((m) => m.readFile(path, "utf-8")),
		runCommand: async () => {
			const response = responses[index++] ?? {};
			return {
				exitCode: response.exitCode ?? 0,
				stdout: response.stdout ?? adapterSuccess({}),
				stderr: "",
				...(response.timedOut === undefined
					? {}
					: { timedOut: response.timedOut }),
			};
		},
	});
}

// =========================================================================
// DDA-B25: a hanging adapter binary is bounded by the command timeout, exits
// as a typed timeout within timeout + the confirmed-kill grace (2 s), and
// leaves no orphan process. This drives the REAL shell-free transport that
// browser-use's adapter dispatch spawns through (runtime.runCommand ->
// spawnMcporterCommand -> spawnTransportCommand), with a real sleep-forever
// fixture binary — not a scripted fake — so the bound is the process's, not a
// stubbed result. The KILL_CONFIRM_GRACE_MS in the transport is exactly the
// "timeout plus 2 s" the oracle names.
// =========================================================================

describe("DDA-B25 hanging adapter is bounded and leaves no orphan", () => {
	const TIMEOUT_MS = 300;
	// The transport's post-SIGKILL confirmed-exit grace (KILL_CONFIRM_GRACE_MS).
	const GRACE_MS = 2_000;

	test("a sleep-forever fixture binary times out within the bound with a typed result", async () => {
		const started = Date.now();
		const result = await spawnTransportCommand({
			command: "sleep",
			args: ["120"],
			timeoutMs: TIMEOUT_MS,
		});

		// Typed failure, not a hang: the bounded timeout produced a timedOut result.
		expect(result.timedOut).toBe(true);
		expect(result.exitCode).toBe(1);
		// Bounded by timeout plus the 2 s confirmed-kill grace.
		expect(Date.now() - started).toBeLessThan(TIMEOUT_MS + GRACE_MS);
	});

	test("the detached group kill leaves no orphan process behind (clean process tree)", async () => {
		// A parent that spawns a grandchild that would sleep well past the bound.
		// Both PIDs are captured; after the detached timeout kill returns, neither
		// may be alive — a straggler would be the orphan the oracle forbids.
		const root = mkdtempSync(join(tmpdir(), "dda-b25-"));
		tempRoots.push(root);
		const pidFile = join(root, "adapter.pids");
		const script = `echo "$$" > ${pidFile}; sleep 120 & echo "$!" >> ${pidFile}; wait`;
		const result = await spawnTransportCommand({
			command: "bash",
			args: ["-c", script],
			detached: true,
			timeoutMs: TIMEOUT_MS,
		});
		expect(result.timedOut).toBe(true);

		const pids = (await Bun.file(pidFile).text())
			.split("\n")
			.map((line) => Number.parseInt(line.trim(), 10))
			.filter((pid) => Number.isFinite(pid) && pid > 1);
		expect(pids.length).toBe(2);
		for (const pid of pids) {
			expect(isProcessAlive(pid)).toBe(false);
		}
	});

	test("a hanging adapter through `browser-use task run` fails typed and leaves no orphan run", async () => {
		const store = await makeStore();
		// Every adapter command times out: the connection-establishment phase
		// re-probes CONNECTION_ESTABLISH_ATTEMPTS times, each attempt timing out,
		// then fails closed with the typed connection-unstable outcome.
		const runtime = taskRunRuntime(
			store.env,
			Array.from({ length: 8 }, () => ({
				exitCode: 1,
				stdout: "",
				timedOut: true,
			})),
		);
		const result = await runForTest(
			[
				"task",
				"run",
				"--intent",
				"routine-automation",
				"--handoff",
				store.handoffPath,
				"--tab",
				"t1",
				"--allowed-origin",
				"https://example.test",
				"--json",
			],
			runtime,
		);
		// Typed failure, fail-closed exit — never a hang and never a silent success.
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "task_run_connection_unstable" });
		// Exactly one bounded repair continuation, not a retry-forever loop.
		expect(
			(json.continuation as Record<string, unknown>).next_action_id,
		).toBe("resume_shared_run");
		// The run is recorded terminal (not left "running"): no orphan session.
		const loaded = await loadSharedRun(store.deps, AGENT_BROWSER_HANDOFF.run_id);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run.state).not.toBe("running");
		}
	});
});

// =========================================================================
// DDA-H21: a leftover named adapter session from a crashed prior run does not
// block the next run. The durable "named session" serialization unit is the
// environment/profile lease (leaseKeyForRun); a crash leaves its lease record
// behind with no clean release. The next run must DETECT the leftover and
// RECOVER with a typed outcome (a fenced takeover carrying a recovered_from
// proof), never block on it. A still-live leftover is instead a typed,
// bounded lease_held wait — also a typed outcome, never a silent hang.
// =========================================================================

describe("DDA-H21 leftover session from a crashed prior run recovers typed", () => {
	// The shared serialization key the handoff's environment/profile resolves to.
	const collidingRun: Pick<BrowserUseSharedRun, "environment_profile"> = {
		environment_profile: { environment: "agent-chrome", profile: "default" },
	};

	test("an expired leftover lease is recovered by a fenced takeover, not blocked", async () => {
		const store = await makeStore();
		// Simulate the crashed prior run: acquire the env/profile lease at an early
		// clock so it is already expired by the time the next run runs. A crash
		// leaves exactly this — a held lease record with no release.
		const staleClock = () => 0;
		const priorHolder = await acquireLease(
			{ ...store.deps, clock: staleClock },
			{
				key: leaseKeyForRun(collidingRun),
				holderId: "task-run-crashed-prior",
				ttlMs: 1,
			},
		);
		expect(priorHolder.ok).toBe(true);

		// The next run drives a normal successful agent-browser snapshot; its
		// outcome-recording step acquires the SAME env/profile lease.
		const runtime = taskRunRuntime(store.env, [
			{
				stdout: adapterSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{ stdout: adapterSuccess({ snapshot: "@e1 button", refs: { e1: {} } }) },
		]);
		const result = await runForTest(
			[
				"task",
				"run",
				"--intent",
				"routine-automation",
				"--handoff",
				store.handoffPath,
				"--tab",
				"t1",
				"--allowed-origin",
				"https://example.test",
				"--json",
			],
			runtime,
		);
		// Not blocked: the next run completed and confirmed.
		expect(result.exitCode).toBe(0);
		const run = (parseJson(result.stdout).data as Record<string, unknown>)
			.run as Record<string, unknown>;
		expect(run.state).toBe("confirmed");

		// The recovery is typed and inspectable: the current lease on that key
		// carries a recovered_from proof naming the crashed prior holder's token.
		const leases = await listLeases(store.deps);
		const current = leases.find(
			(lease) => lease.key === leaseKeyForRun(collidingRun),
		);
		expect(current).toBeDefined();
		expect(current?.fencing_token).toBeGreaterThan(1);
		// The takeover names the exact crashed prior holder — unambiguous recovery,
		// not a fresh unrelated lease.
		expect(current?.recovered_from?.holder_id).toBe("task-run-crashed-prior");
	});

	test("a still-live leftover lease yields a typed bounded wait, never a silent block", async () => {
		const store = await makeStore();
		// A leftover lease that is still LIVE at the next run's clock (fixedClock
		// returns 1_000): a long TTL from the same instant keeps it held.
		const liveHolder = await acquireLease(store.deps, {
			key: leaseKeyForRun(collidingRun),
			holderId: "task-run-still-live-prior",
			ttlMs: 3_600_000,
		});
		expect(liveHolder.ok).toBe(true);

		const runtime = taskRunRuntime(store.env, [
			{
				stdout: adapterSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ snapshot: "@e1 button", refs: { e1: {} } }) },
		]);
		const result = await runForTest(
			[
				"task",
				"run",
				"--intent",
				"routine-automation",
				"--handoff",
				store.handoffPath,
				"--tab",
				"t1",
				"--allowed-origin",
				"https://example.test",
				"--json",
			],
			runtime,
		);
		// Typed, bounded refusal with a wait continuation — not a silent hang.
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect((json.error as Record<string, unknown>).code).toBe("lease_held");
		expect(
			(json.continuation as Record<string, unknown>).next_action_id,
		).toBe("wait_for_lease");
	});
});

// =========================================================================
// DDA-H22: no background daemon or keepalive persists after any command exits.
// Two proofs:
//   1. Real E-tier process journeys through the actual browser-use CLI leave a
//      clean process tree — after the child exits, it has zero descendant
//      processes (a surviving child would be the daemon the oracle forbids).
//      The child exiting within its bound is itself the "no keepalive holding
//      the process open" evidence.
//   2. The keepalive-gotcha regression guard: the mcporter keepalive gotcha
//      (an mcporter stdio command containing `chrome-devtools-mcp` gets
//      daemon-routed) is defused by MCPORTER_NO_KEEPALIVE on every
//      envelope-derived adapter spawn. This proves the guard reaches the REAL
//      spawn env on the driver's chrome-lane `task run` dispatch path.
// =========================================================================

const CHROME_HANDOFF = {
	status: "ok",
	run_id: "run-proc-hygiene-chrome-1",
	data: {
		outcome: "verified",
		environment: { name: "agent-chrome", profile: "default" },
		browser_entry_mode: "explicit-cdp",
		attachment: {
			adapter_id: "chrome-devtools-mcp",
			route: "explicit-cdp",
			probe_executable: "/opt/browser-connect/chrome-devtools-mcp",
		},
		endpoint: {
			http: "http://127.0.0.1:9222",
			ws: "ws://127.0.0.1:9222/devtools/browser/fixture",
		},
		launch: { launched: false },
		proof: {
			environment_contract_id: "warm-chrome.browser-entry",
			environment_schema_version: "2",
			route_evidence: "verified-live",
			profile_posture: LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
		},
		contract_id: "browser-connect.verified-handoff",
		schema_version: "3",
	},
	error: null,
} as const;

const BROWSER_USE_CLI = join(
	dirname(fileURLToPath(import.meta.url)),
	"browser-use.ts",
);
const SPAWN_TIMEOUT_MS = 15_000;

// Direct child pids of a process, via pgrep -P. An empty list is the clean
// process tree the oracle requires after the CLI exits.
function directChildPids(pid: number): number[] {
	const result = spawnSync("pgrep", ["-P", String(pid)], {
		encoding: "utf8",
	});
	if (result.status !== 0) return [];
	return result.stdout
		.split("\n")
		.map((line) => Number.parseInt(line.trim(), 10))
		.filter((child) => Number.isFinite(child) && child > 1);
}

describe("DDA-H22 no daemon or keepalive survives a command", () => {
	test.each([
		["task list --json", ["task", "list", "--json"]],
		["lanes list --json", ["lanes", "list", "--json"]],
	])(
		"real E-tier journey `%s` exits clean with no surviving child process",
		async (_label, args) => {
			const child = Bun.spawn([process.execPath, BROWSER_USE_CLI, ...args], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const kill = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
			const started = Date.now();
			const [stdout, exitCode] = await Promise.all([
				new Response(child.stdout).text(),
				child.exited,
			]);
			clearTimeout(kill);

			// The journey completed on its own — no keepalive held the process open.
			expect(exitCode).toBe(0);
			expect(Date.now() - started).toBeLessThan(SPAWN_TIMEOUT_MS);
			expect(parseJson(stdout).status).toBe("ok");
			// Process-tree diff is empty: no daemon/keepalive child outlived exit.
			expect(directChildPids(child.pid)).toEqual([]);
		},
		SPAWN_TIMEOUT_MS + 5_000,
	);

	test("the chrome-lane `task run` dispatch spawns every adapter call with the keepalive guard", async () => {
		const store = await makeStore();
		const handoffRoot = mkdtempSync(join(tmpdir(), "dda-h22-"));
		tempRoots.push(handoffRoot);
		const handoffPath = join(handoffRoot, "chrome-handoff.json");
		writeFileSync(handoffPath, JSON.stringify(CHROME_HANDOFF), "utf-8");

		const spawnEnvs: Array<Record<string, string | undefined> | undefined> = [];
		const runtime = makeRuntime({
			env: store.env,
			now: () => 1_000,
			platformFs: createDefaultPlatformFs(),
			readTextFile: (path: string) =>
				import("node:fs/promises").then((m) => m.readFile(path, "utf-8")),
			ensureDirectory: async () => {},
			runCommand: async (input: McporterCommandInput) => {
				spawnEnvs.push(input.env);
				// A shape the chrome executor treats as a connection failure so the
				// journey fails closed quickly; the spawn env is already captured.
				return { exitCode: 1, stdout: "", stderr: "", timedOut: false };
			},
		});
		await runForTest(
			[
				"task",
				"run",
				"--intent",
				"debug",
				"--handoff",
				handoffPath,
				"--tab",
				"0",
				"--allowed-origin",
				"https://example.test",
				"--json",
			],
			runtime,
		);

		// At least one adapter spawn happened, and EVERY spawn carried the
		// keepalive-disabling guard — the mcporter keepalive gotcha regression pin.
		expect(spawnEnvs.length).toBeGreaterThan(0);
		for (const env of spawnEnvs) {
			expect(env?.MCPORTER_NO_KEEPALIVE).toBe(
				ENVELOPE_ADAPTER_CALL_ENV.MCPORTER_NO_KEEPALIVE,
			);
		}
	});
});
