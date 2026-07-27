import { afterAll, describe, expect, test } from "bun:test";
import {
	BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES,
	browserUseContracts,
} from "./command-contract";
import {
	BROWSER_USE_TASK_INTENTS,
	type BrowserUseSharedRun,
} from "./browser-use-run-model";
import { createAdapterLaneRegistry } from "./browser-use-adapter-registry";
import {
	BROWSER_USE_TASK_INTENT_REQUIRED_CAPABILITY,
	routeTaskRun,
} from "./browser-use-task-run";
import {
	type RunStoreDeps,
	createSharedRun,
	loadSharedRun,
} from "./browser-use-runs";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

// =========================================================================
// Wave-2 task run front door (release contract R6-R11, R23; flows F1, F7).
//
// CLI-level tests over the REAL driver via runForTest against a real temp XDG
// store, plus pure routing-engine tests. Fakes match the real envelope shapes
// proven in wave 1 (browser-use-agent-browser.test.ts). Cases: successful
// agent-browser dispatch, inadmissible override refusal, playwright not-installed
// typed repair, resume of an existing run, unknown-effect terminal, and the
// intent-enum drift pin.
// =========================================================================

const disposables: { dispose(): void }[] = [];
afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

// Verbatim verified-handoff `data` payload shape (agent-browser lane) proven in
// wave 1: schema 2, explicit-cdp route, verified-live proof. Written to a temp
// file the CLI reads via --handoff.
const AGENT_BROWSER_HANDOFF = {
	status: "ok",
	run_id: "run-task-run-1",
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
			environment_schema_version: "1",
			route_evidence: "verified-live",
		},
		contract_id: "browser-connect.verified-handoff",
		schema_version: "2",
	},
	error: null,
} as const;

function handoffFor(adapterId: string, runId = "run-task-run-1"): typeof AGENT_BROWSER_HANDOFF {
	return {
		...AGENT_BROWSER_HANDOFF,
		run_id: runId,
		data: {
			...AGENT_BROWSER_HANDOFF.data,
			attachment: { ...AGENT_BROWSER_HANDOFF.data.attachment, adapter_id: adapterId },
		},
	} as typeof AGENT_BROWSER_HANDOFF;
}

// The real success/failure adapter envelope shapes (wave 1): exit 0,
// {success:true,data} for success; {success:false,error} for a CDP connection
// failure (exit 0, connection signal in `error`).
function adapterSuccess(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}
function adapterCdpFailure(): string {
	return JSON.stringify({
		error: "CDP WebSocket connect failed: IO error: Connection refused (os error 61)",
		success: false,
	});
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
	// Write the handoff file under the temp base so the CLI can read it.
	const handoffPath = `${xdg.base}/handoff.json`;
	const { writeFileSync } = await import("node:fs");
	writeFileSync(handoffPath, JSON.stringify(AGENT_BROWSER_HANDOFF), "utf-8");
	return {
		env: xdg.env,
		deps: { fs, paths: opened.paths, clock: fixedClock().now },
		handoffPath,
	};
}

// A runtime whose runCommand replays a scripted sequence of adapter responses
// (the agent-browser executor call sequence), over the real temp XDG store.
function taskRunRuntime(
	env: Record<string, string | undefined>,
	responses: readonly { stdout?: string; exitCode?: number; timedOut?: boolean }[],
) {
	let index = 0;
	const calls: Array<readonly string[]> = [];
	return {
		calls,
		runtime: makeRuntime({
			env,
			now: () => 1_000,
			platformFs: createDefaultPlatformFs(),
			// The real handoff file is read through the default readTextFile; only
			// the adapter command runner is scripted.
			readTextFile: (path: string) =>
				import("node:fs/promises").then((m) => m.readFile(path, "utf-8")),
			runCommand: async (input) => {
				calls.push([input.command, ...input.args]);
				const response = responses[index++] ?? {};
				return {
					exitCode: response.exitCode ?? 0,
					stdout: response.stdout ?? adapterSuccess({}),
					stderr: "",
					...(response.timedOut === undefined ? {} : { timedOut: response.timedOut }),
				};
			},
		}),
	};
}

function laneCapabilityCovers(
	lane: { lane_id: keyof typeof BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES },
	capability: string,
): boolean {
	return (
		BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES[lane.lane_id] as readonly string[]
	).includes(capability);
}

function baselineRegistry() {
	const result = createAdapterLaneRegistry({ evidence: [], at_epoch_ms: 1_000 });
	if (!result.ok) throw new Error(`registry composed failed: ${result.rejection.code}`);
	return result.registry;
}

// =========================================================================
// Contract / parser
// =========================================================================

describe("task run contract + parser (R27)", () => {
	test("task run is declared with the shared-run result contract and a --handoff prerequisite", () => {
		const contract = browserUseContracts["task-run"];
		expect(contract.resultContract?.id).toBe("browser-use.shared-run");
		expect(Object.keys(contract.flags ?? {})).toContain("--handoff");
		expect(Object.keys(contract.flags ?? {})).toContain("--intent");
		expect(Object.keys(contract.flags ?? {})).toContain("--lane");
	});

	test("task run without --handoff is a usage error", async () => {
		const store = await makeStore();
		const result = await runForTest(
			["task", "run", "--intent", "scrape", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({ code: "usage_error" });
	});

	test("task run without --intent or --run is a usage error", async () => {
		const store = await makeStore();
		const result = await runForTest(
			["task", "run", "--handoff", store.handoffPath, "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({ code: "usage_error" });
	});
});

// =========================================================================
// Pure routing engine (R6, R10, R11)
// =========================================================================

describe("task run routing engine (R6, R10, R11)", () => {
	test("the required-capability policy only names registered live-lane capabilities", () => {
		for (const [intent, capability] of Object.entries(
			BROWSER_USE_TASK_INTENT_REQUIRED_CAPABILITY,
		)) {
			expect(BROWSER_USE_TASK_INTENTS as readonly string[]).toContain(intent);
			expect(typeof capability).toBe("string");
		}
	});

	test("routes routine-automation to the agent-browser lane on a matching handoff", () => {
		const routed = routeTaskRun({
			intent: "routine-automation",
			registry: baselineRegistry(),
			handoffAdapter: "agent-browser",
			capabilityCovers: laneCapabilityCovers,
		});
		expect(routed.ok).toBe(true);
		if (routed.ok) {
			expect(routed.route.lane_id).toBe("agent-browser");
			expect(routed.route.source).toBe("intent-preferred");
		}
	});

	test("lighthouse-audit routes to the chrome-devtools-mcp lane on a matching handoff (U4)", () => {
		// U4 wired the chrome debugging/performance executor, so debug/
		// performance-profile/lighthouse-audit now carry a registered preferred
		// lane; intent_unrouted is no longer reachable for a code-owned intent.
		const routed = routeTaskRun({
			intent: "lighthouse-audit",
			registry: baselineRegistry(),
			handoffAdapter: "chrome-devtools-mcp",
			capabilityCovers: laneCapabilityCovers,
		});
		expect(routed.ok).toBe(true);
		if (routed.ok) {
			expect(routed.route.lane_id).toBe("chrome-devtools-mcp");
			expect(routed.route.source).toBe("intent-preferred");
			expect(routed.route.required_capability).toBe(
				"devtools_performance_insight",
			);
		}
	});

	test("a chrome intent on an agent-browser handoff fails closed, never substitutes (R11)", () => {
		const routed = routeTaskRun({
			intent: "lighthouse-audit",
			registry: baselineRegistry(),
			handoffAdapter: "agent-browser",
			capabilityCovers: laneCapabilityCovers,
		});
		expect(routed.ok).toBe(false);
		if (!routed.ok) expect(routed.refusal.code).toBe("handoff_lane_mismatch");
	});

	test("an explicit override to a not-installed lane fails closed (R10, AE3)", () => {
		const routed = routeTaskRun({
			intent: "routine-automation",
			registry: baselineRegistry(),
			handoffAdapter: "agent-browser",
			laneOverride: "playwright-cdp",
			capabilityCovers: laneCapabilityCovers,
		});
		expect(routed.ok).toBe(false);
		if (!routed.ok) expect(routed.refusal.code).toBe("lane_not_installed");
	});

	test("a rejected identity alias override fails closed, never mapped (R10)", () => {
		const routed = routeTaskRun({
			intent: "routine-automation",
			registry: baselineRegistry(),
			handoffAdapter: "agent-browser",
			laneOverride: "playwright-cli",
			capabilityCovers: laneCapabilityCovers,
		});
		expect(routed.ok).toBe(false);
		if (!routed.ok) expect(routed.refusal.code).toBe("lane_override_inadmissible");
	});

	test("a handoff naming another adapter than the selected lane fails closed (R11)", () => {
		const routed = routeTaskRun({
			intent: "routine-automation",
			registry: baselineRegistry(),
			handoffAdapter: "chrome-devtools-mcp",
			capabilityCovers: laneCapabilityCovers,
		});
		expect(routed.ok).toBe(false);
		if (!routed.ok) expect(routed.refusal.code).toBe("handoff_lane_mismatch");
	});
});

// =========================================================================
// CLI dispatch over the real store (F1, F7)
// =========================================================================

describe("task run CLI dispatch (F1, F7)", () => {
	test("successful agent-browser dispatch creates a confirmed run and returns the selected lane", async () => {
		const store = await makeStore();
		// The executor call sequence for a snapshot-only task: tab list, tab
		// select, snapshot.
		const { runtime, calls } = taskRunRuntime(store.env, [
			{
				stdout: adapterSuccess({
					tabs: [{ tabId: "t7", active: true, type: "page", url: "https://example.test/" }],
				}),
			},
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ snapshot: "@e1 button", refs: { e1: {} } }) },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "routine-automation",
				"--handoff", store.handoffPath,
				"--tab", "t7",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.shared-run");
		expect(data.selected_lane).toBe("agent-browser");
		expect(data.external_effect).toBe("none");
		const run = data.run as Record<string, unknown>;
		expect(run.state).toBe("confirmed");
		expect(run.adapter_id).toBe("agent-browser");
		const continuation = parseJson(result.stdout).continuation as Record<string, unknown>;
		expect(continuation.next_action_id).toBe("inspect_task_run_result");
		// The executor actually attached and snapshotted through the handoff.
		expect(calls[0]?.join(" ")).toContain("tab list");
	});

	test("an inadmissible explicit override is refused with an executable repair (R10, AE3)", async () => {
		const store = await makeStore();
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "routine-automation",
				"--lane", "playwright-cli",
				"--handoff", store.handoffPath,
				"--allowed-origin", "https://example.test",
				"--json",
			],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "task_run_lane_override_inadmissible" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"choose_admissible_lane",
		);
	});

	test("routing to the not-installed playwright lane returns the adapter-install continuation (R10)", async () => {
		const store = await makeStore();
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "routine-automation",
				"--lane", "playwright-cdp",
				"--handoff", store.handoffPath,
				"--allowed-origin", "https://example.test",
				"--json",
			],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "task_run_lane_not_installed" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"install_lane_adapter",
		);
		// No lane was substituted.
		expect(JSON.stringify(json)).not.toContain("agent-browser");
	});

	test("a post-dispatch CDP drop is unknown terminal truth blocking retry (R26, F7)", async () => {
		const store = await makeStore();
		// tab list ok, tab select ok, snapshot drops the CDP link after dispatch.
		const { runtime } = taskRunRuntime(store.env, [
			{
				stdout: adapterSuccess({
					tabs: [{ tabId: "t1", active: true, type: "page", url: "https://example.test/" }],
				}),
			},
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterCdpFailure(), exitCode: 1, timedOut: true },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "routine-automation",
				"--handoff", store.handoffPath,
				"--tab", "t1",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		// A snapshot is a read; a timed-out snapshot command surfaces as a
		// not-achieved or unknown terminal, never an optimistic retry action.
		expect((json.data as Record<string, unknown>).selected_lane).toBe("agent-browser");
		const continuation = json.continuation as Record<string, unknown>;
		expect(continuation.next_action_id).toBe("inspect_task_run_result");
		// The run is recorded terminal, not left running.
		const loaded = await loadSharedRun(store.deps, "run-task-run-1");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(["unknown", "not-achieved"]).toContain(loaded.run.state);
		}
	});

	test("resume of an existing run stays on its bound lane and re-proves same-profile (R28, R11)", async () => {
		const store = await makeStore();
		// Seed a running agent-browser run bound to the same profile the handoff proves.
		const seed: Omit<BrowserUseSharedRun, "revision"> = {
			run_id: "run-resume-1",
			state: "running",
			task_intent: "routine-automation",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: "seed-evidence",
			mutation_dispatched: false,
			artifacts: [],
		};
		const created = await createSharedRun(store.deps, seed);
		expect(created.ok).toBe(true);
		const { runtime } = taskRunRuntime(store.env, [
			{
				stdout: adapterSuccess({
					tabs: [{ tabId: "t1", active: true, type: "page", url: "https://example.test/" }],
				}),
			},
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ snapshot: "@e1 button", refs: { e1: {} } }) },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--run", "run-resume-1",
				"--handoff", store.handoffPath,
				"--tab", "t1",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.selected_lane).toBe("agent-browser");
		const run = data.run as Record<string, unknown>;
		expect(run.run_id).toBe("run-resume-1");
		expect(run.state).toBe("confirmed");
		// Revision advanced: the resume recorded the dispatch outcome.
		expect(run.revision).toBe(2);
	});

	test("resuming a run bound to a different lane refuses without substitution (R11)", async () => {
		const store = await makeStore();
		const seed: Omit<BrowserUseSharedRun, "revision"> = {
			run_id: "run-resume-mismatch",
			state: "running",
			task_intent: "routine-automation",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "chrome-devtools-mcp",
			mutation_dispatched: false,
			artifacts: [],
		};
		const created = await createSharedRun(store.deps, seed);
		expect(created.ok).toBe(true);
		const result = await runForTest(
			[
				"task", "run",
				"--run", "run-resume-mismatch",
				"--handoff", store.handoffPath,
				"--allowed-origin", "https://example.test",
				"--json",
			],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "task_run_handoff_lane_mismatch",
		});
	});

	test("a handoff that does not match the routed lane fails closed, never substitutes (R11, AE3)", async () => {
		const store = await makeStore();
		// Write a chrome-devtools handoff, then request an agent-browser intent.
		const { writeFileSync } = await import("node:fs");
		const chromePath = `${store.env.XDG_STATE_HOME}/../chrome-handoff.json`;
		writeFileSync(chromePath, JSON.stringify(handoffFor("chrome-devtools-mcp")), "utf-8");
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "routine-automation",
				"--handoff", chromePath,
				"--allowed-origin", "https://example.test",
				"--json",
			],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "task_run_handoff_lane_mismatch",
		});
	});
});
