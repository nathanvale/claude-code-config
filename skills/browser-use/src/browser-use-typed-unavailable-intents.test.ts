import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import type { RunStoreDeps } from "./browser-use-runs";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";
import { LIVE_CLEAN_PROFILE_POSTURE_FIXTURE } from "./browser-connect-handoff-fixtures";

// =========================================================================
// Daily Driver Acceptance Ledger — status-families cluster: typed-unavailable
// task intents.
//
// DDA-B23  `trace-inspection` returns typed-unavailable naming the missing
//          artifact contract, plus a continuation.
// DDA-B24  `http-replay` returns typed-unavailable naming the archive-input
//          contract, plus a continuation — same envelope shape as B23.
//
// The intents advertise a playwright-cdp preferred lane, but Browser Use does
// not yet own their artifact (trace) / archive-input (HAR) contracts, so the
// executor cannot run them. The front door must return an HONEST typed
// unavailability naming the exact missing contract and a continuation the agent
// can act on — never a misleading "stale evidence, re-probe" refusal, and never
// a silent lane substitution.
//
// Contract (C) + process (E): the REAL CLI driver over a real temp XDG store,
// with a fixture playwright-cdp handoff file. No live browser, no network.
// =========================================================================

const disposables: { dispose(): void }[] = [];
afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

// A verified playwright-cdp handoff `data` payload (schema 3, explicit-cdp,
// verified-live) so acquisition succeeds and routing runs on a matching lane.
const PLAYWRIGHT_HANDOFF = {
	status: "ok",
	run_id: "run-typed-unavailable-1",
	data: {
		outcome: "verified",
		environment: { name: "agent-chrome", profile: "default" },
		browser_entry_mode: "explicit-cdp",
		attachment: {
			adapter_id: "playwright-cdp",
			route: "explicit-cdp",
			probe_executable: "/opt/browser-connect/playwright",
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
	const handoffPath = `${xdg.base}/handoff.json`;
	const { writeFileSync } = await import("node:fs");
	writeFileSync(handoffPath, JSON.stringify(PLAYWRIGHT_HANDOFF), "utf-8");
	return {
		env: xdg.env,
		deps: { fs, paths: opened.paths, clock: fixedClock().now },
		handoffPath,
	};
}

async function runIntent(
	intent: string,
): Promise<{ exitCode: number; json: Record<string, unknown> }> {
	const store = await makeStore();
	const result = await runForTest(
		[
			"task",
			"run",
			"--intent",
			intent,
			"--handoff",
			store.handoffPath,
			"--allowed-origin",
			"https://example.com",
			"--json",
		],
		makeRuntime({
			env: store.env,
			readTextFile: (path: string) =>
				import("node:fs/promises").then((m) => m.readFile(path, "utf-8")),
			// A runCommand that throws proves execution NEVER reached the lane: the
			// front door must refuse these intents before any dispatch.
			runCommand: async () => {
				throw new Error("no lane dispatch may occur for a typed-unavailable intent");
			},
		}),
	);
	return { exitCode: result.exitCode, json: parseJson(result.stdout) };
}

describe("DDA-B23 trace-inspection returns typed-unavailable naming the missing artifact contract", () => {
	test("the failure envelope names the trace artifact contract and carries a usable continuation", async () => {
		const { exitCode, json } = await runIntent("trace-inspection");

		// Typed unavailability fails closed at the binding exit code, never exit 0.
		expect(exitCode).toBe(20);
		const error = json.error as Record<string, unknown>;
		expect(error).toBeTruthy();
		// It names the exact gap: the intent's ARTIFACT contract is not owned yet.
		const message = String(error.message).toLowerCase();
		expect(message).toContain("trace");
		expect(message).toContain("artifact");
		expect(message).toContain("contract");
		// Exactly one continuation the agent can act on.
		const continuation = json.continuation as Record<string, unknown>;
		expect(typeof continuation.next_action_id).toBe("string");
		expect(String(continuation.next_action_id).length).toBeGreaterThan(0);
		// The runtime action set carries that same continuation id.
		const runtimeActions = json.runtime_actions as
			| Array<Record<string, unknown>>
			| undefined;
		expect(runtimeActions?.[0]?.id).toBe(continuation.next_action_id);
	});
});

describe("DDA-B24 http-replay returns typed-unavailable naming the archive-input contract", () => {
	test("the failure envelope names the archive-input contract and carries a usable continuation", async () => {
		const { exitCode, json } = await runIntent("http-replay");

		expect(exitCode).toBe(20);
		const error = json.error as Record<string, unknown>;
		expect(error).toBeTruthy();
		const message = String(error.message).toLowerCase();
		// It names the exact gap: the intent's ARCHIVE-INPUT contract is not owned.
		expect(message).toContain("archive");
		expect(message).toContain("contract");
		const continuation = json.continuation as Record<string, unknown>;
		expect(typeof continuation.next_action_id).toBe("string");
		expect(String(continuation.next_action_id).length).toBeGreaterThan(0);
		const runtimeActions = json.runtime_actions as
			| Array<Record<string, unknown>>
			| undefined;
		expect(runtimeActions?.[0]?.id).toBe(continuation.next_action_id);
	});

	test("both intents share the same typed-unavailable envelope shape", async () => {
		const trace = await runIntent("trace-inspection");
		const http = await runIntent("http-replay");
		expect(trace.exitCode).toBe(http.exitCode);
		// Same diagnostic code and continuation id: one typed-unavailable class.
		expect((trace.json.error as Record<string, unknown>).code).toBe(
			(http.json.error as Record<string, unknown>).code,
		);
		expect(
			(trace.json.continuation as Record<string, unknown>).next_action_id,
		).toBe((http.json.continuation as Record<string, unknown>).next_action_id);
	});
});

// =========================================================================
// E-tier: the SAME B23/B24 oracles proven across a real process boundary.
//
// The in-process cases above drive runForTest, which never crosses a process
// boundary. Tier E demands the REAL CLI spawned as a subprocess: `bun
// browser-use.ts task run --intent <intent> --handoff <file>` against a
// hermetic temp XDG store, with the verified playwright-cdp handoff written to
// disk (read for real by the default runtime). The intent short-circuit
// (routeTaskRun's missing-contract branch) fires BEFORE lane resolution, so no
// adapter is ever spawned — no browser is touched even without a runCommand
// stub, and the spawned process exits on its own. The proof is the boundary,
// not a captured fixture (fakes must match real output shape).
// =========================================================================

const BROWSER_USE_CLI = join(
	dirname(fileURLToPath(import.meta.url)),
	"browser-use.ts",
);
const SPAWN_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = SPAWN_TIMEOUT_MS + 10_000;

// Spawn the real CLI over a hermetic store: HOME plus the temp XDG roots are the
// child's only relevant env, and the verified playwright-cdp handoff is written
// to disk so `--handoff` is read for real. Returns the parsed stdout envelope.
async function spawnIntent(
	intent: string,
): Promise<{ exitCode: number; stdout: string; json: Record<string, unknown> }> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	// A real, admitted store so acquireVerifiedHandoff + openPlatformStore both
	// succeed and execution reaches routeTaskRun — the same store the in-process
	// makeStore builds, opened here to prove admission before the spawn.
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	const handoffPath = join(xdg.base, "handoff.json");
	writeFileSync(handoffPath, JSON.stringify(PLAYWRIGHT_HANDOFF), "utf-8");

	const child = Bun.spawn(
		[
			process.execPath,
			BROWSER_USE_CLI,
			"task",
			"run",
			"--intent",
			intent,
			"--handoff",
			handoffPath,
			"--allowed-origin",
			"https://example.com",
			"--json",
		],
		{
			// Only the temp HOME + XDG roots: the child inherits no repo state, and
			// every store path resolves under the hermetic base.
			env: {
				HOME: xdg.env.HOME,
				XDG_CONFIG_HOME: xdg.env.XDG_CONFIG_HOME,
				XDG_DATA_HOME: xdg.env.XDG_DATA_HOME,
				XDG_STATE_HOME: xdg.env.XDG_STATE_HOME,
				XDG_CACHE_HOME: xdg.env.XDG_CACHE_HOME,
			} as Record<string, string>,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const timeout = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
	const [stdout, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		child.exited,
	]);
	clearTimeout(timeout);
	return { exitCode, stdout, json: parseJson(stdout) };
}

describe("DDA-B23 (E) spawned trace-inspection returns typed-unavailable at the process boundary", () => {
	test(
		"the real spawned CLI refuses with intent_unrouted naming the trace artifact contract",
		async () => {
			const { exitCode, json } = await spawnIntent("trace-inspection");

			// Typed unavailability fails closed at the binding exit code across the
			// process boundary, never exit 0.
			expect(exitCode).toBe(20);
			const error = json.error as Record<string, unknown>;
			expect(error).toBeTruthy();
			// The typed-unavailable class the driver maps intent_unrouted onto.
			expect(error.code).toBe("task_run_intent_unrouted");
			const message = String(error.message).toLowerCase();
			expect(message).toContain("trace");
			expect(message).toContain("artifact");
			expect(message).toContain("contract");
			// A usable continuation the agent can act on: await_intent_lane.
			const continuation = json.continuation as Record<string, unknown>;
			expect(continuation.next_action_id).toBe("await_intent_lane");
			// The runtime action set carries that same continuation id.
			const runtimeActions = json.runtime_actions as
				| Array<Record<string, unknown>>
				| undefined;
			expect(runtimeActions?.[0]?.id).toBe(continuation.next_action_id);
		},
		TEST_TIMEOUT_MS,
	);
});

describe("DDA-B24 (E) spawned http-replay returns typed-unavailable at the process boundary", () => {
	test(
		"the real spawned CLI refuses with intent_unrouted naming the archive-input contract",
		async () => {
			const { exitCode, json } = await spawnIntent("http-replay");

			expect(exitCode).toBe(20);
			const error = json.error as Record<string, unknown>;
			expect(error).toBeTruthy();
			expect(error.code).toBe("task_run_intent_unrouted");
			const message = String(error.message).toLowerCase();
			expect(message).toContain("archive");
			expect(message).toContain("contract");
			const continuation = json.continuation as Record<string, unknown>;
			expect(continuation.next_action_id).toBe("await_intent_lane");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"both spawned intents share the identical typed-unavailable envelope class at the boundary",
		async () => {
			const trace = await spawnIntent("trace-inspection");
			const http = await spawnIntent("http-replay");
			expect(trace.exitCode).toBe(http.exitCode);
			expect(trace.exitCode).toBe(20);
			// One typed-unavailable class: same diagnostic code and continuation id.
			expect((trace.json.error as Record<string, unknown>).code).toBe(
				(http.json.error as Record<string, unknown>).code,
			);
			expect(
				(trace.json.continuation as Record<string, unknown>).next_action_id,
			).toBe(
				(http.json.continuation as Record<string, unknown>).next_action_id,
			);
		},
		TEST_TIMEOUT_MS,
	);
});
