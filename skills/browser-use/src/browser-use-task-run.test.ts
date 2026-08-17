import { afterAll, describe, expect, test } from "bun:test";
import {
	BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES,
	browserUseContracts,
} from "./command-contract";
import {
	BROWSER_USE_TASK_INTENT_DEFINITIONS,
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
// agent-browser and Playwright dispatch, inadmissible override refusal, resume
// of an existing run, unknown-effect terminal, and the intent-enum drift pin.
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
	const normalized =
		typeof data === "object" &&
		data !== null &&
		"tabs" in data &&
		Array.isArray(data.tabs)
			? {
					...data,
					tabs: data.tabs.map((tab) =>
						typeof tab === "object" && tab !== null && !(`targetId` in tab)
							? {
									...tab,
									targetId: `cdp-target-${"tabId" in tab ? String(tab.tabId) : "unknown"}`,
								}
							: tab,
					),
				}
			: data;
	return JSON.stringify({ success: true, data: normalized, error: null });
}
function adapterCdpFailure(): string {
	return JSON.stringify({
		error: "CDP WebSocket connect failed: IO error: Connection refused (os error 61)",
		success: false,
	});
}

function isTypedTabListResponse(response: {
	stdout?: string;
	exitCode?: number;
	timedOut?: boolean;
}): boolean {
	if (response.exitCode !== undefined && response.exitCode !== 0) return false;
	if (response.timedOut === true || response.stdout === undefined) return false;
	try {
		const envelope = JSON.parse(response.stdout) as {
			success?: boolean;
			data?: { tabs?: unknown };
		};
		return envelope.success === true && Array.isArray(envelope.data?.tabs);
	} catch {
		return false;
	}
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
	onCall?: (call: readonly string[]) => Promise<void>,
) {
	let index = 0;
	let stableTabList:
		| { stdout?: string; exitCode?: number; timedOut?: boolean }
		| undefined;
	let stableTabListReproved = false;
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
				if (input.args.includes("close")) {
					return {
						exitCode: 0,
						stdout: adapterSuccess({ closed: true }),
						stderr: "",
					};
				}
				if (input.args[0] === "session" && input.args[1] === "list") {
					return {
						exitCode: 0,
						stdout: adapterSuccess({ sessions: [] }),
						stderr: "",
					};
				}
				const call = [input.command, ...input.args];
				calls.push(call);
				await onCall?.(call);
				const pinIndex = input.args.indexOf("--pin-tab");
				const semantic =
					pinIndex >= 0 ? input.args.slice(pinIndex + 1) : input.args.slice(4);
				const isTabList = semantic[0] === "tab" && semantic[1] === "list";
				let response: {
					stdout?: string;
					exitCode?: number;
					timedOut?: boolean;
				};
				if (
					isTabList &&
					stableTabList !== undefined &&
					!stableTabListReproved &&
					!isTypedTabListResponse(responses[index] ?? {})
				) {
					stableTabListReproved = true;
					response = stableTabList;
				} else {
					response = responses[index++] ?? {};
					if (isTabList && isTypedTabListResponse(response)) {
						stableTabList = response;
					}
				}
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

	// Rewritten for the internal mint (design brief D4): a fresh --intent run
	// without --handoff engages the runtime's mintHandoff seam instead of
	// erroring; the fail-closed mint stub surfaces its connect failure verbatim.
	// The RESUME path still hard-requires the caller-managed envelope.
	test("task run --intent without --handoff engages the internal mint", async () => {
		const store = await makeStore();
		const result = await runForTest(
			["task", "run", "--intent", "scrape", "--json"],
			makeRuntime({ env: store.env }),
		);
		// makeRuntime's mint stub fails closed with exit 20 — proof the mint path
		// ran (a parser rejection would have exited 2 before any mint).
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "mint_not_faked",
		});
	});

	test("task run --run without --handoff is a usage error", async () => {
		const store = await makeStore();
		const result = await runForTest(
			["task", "run", "--run", "run-1", "--json"],
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
	test("every advertised intent selects its declared lane or reports that exact lane unavailable", () => {
		const registry = baselineRegistry();

		for (const definition of BROWSER_USE_TASK_INTENT_DEFINITIONS) {
			const preferred = definition.preferred_adapter;
			if (preferred === undefined) {
				throw new Error(`advertised intent ${definition.task_intent} has no preferred adapter`);
			}
			const routed = routeTaskRun({
				intent: definition.task_intent,
				registry,
				handoffAdapter: preferred,
				capabilityCovers: laneCapabilityCovers,
			});

			if (
				definition.task_intent === "trace-inspection" ||
				definition.task_intent === "http-replay"
			) {
				// R22: Browser Use does not own these intents' specialist artifact /
				// archive-input contract yet, so they are honest typed unavailability
				// (intent_unrouted) naming the missing contract — NOT a misleading
				// "re-probe stale lane evidence" refusal (that could never add a
				// contract that does not exist).
				expect(routed).toMatchObject({
					ok: false,
					refusal: { code: "intent_unrouted" },
				});
				if (!routed.ok) {
					expect(routed.refusal.message).toContain("contract");
				}
				continue;
			}

			expect(routed).toMatchObject({
				ok: true,
				route: {
					intent: definition.task_intent,
					lane_id: preferred,
					source: "intent-preferred",
					required_capability:
						BROWSER_USE_TASK_INTENT_REQUIRED_CAPABILITY[
							definition.task_intent
						],
				},
			});
		}
	});

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

	test("an explicit override to a lane lacking the intent capability fails closed", () => {
		const routed = routeTaskRun({
			intent: "routine-automation",
			registry: baselineRegistry(),
			handoffAdapter: "agent-browser",
			laneOverride: "playwright-cdp",
			capabilityCovers: laneCapabilityCovers,
		});
		expect(routed.ok).toBe(false);
		if (!routed.ok) {
			expect(routed.refusal.code).toBe("lane_override_inadmissible");
		}
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
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
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
		expect(result.exitCode, result.stdout).toBe(0);
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

	test("routine automation resolves one current semantic target, clicks, and verifies its named postcondition", async () => {
		const store = await makeStore();
		const { runtime, calls } = taskRunRuntime(store.env, [
			{
				stdout: adapterSuccess({
					tabs: [
						{
							tabId: "t7",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{
				stdout: adapterSuccess({
					snapshot: "@e1 button Save",
					refs: { e1: { role: "button", name: "Save" } },
				}),
			},
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{ stdout: adapterSuccess({ visible: true }) },
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
				"t7",
				"--allowed-origin",
				"https://example.test",
				"--click-role",
				"button",
				"--click-name",
				"Save",
				"--postcondition-id",
				"saved",
				"--expect-visible",
				"[data-persisted='true']",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		const run = data.run as Record<string, unknown>;
		expect(run).toMatchObject({
			state: "confirmed",
			task_intent: "routine-automation",
			postcondition: {
				id: "saved",
				summary: "The declared element is visible after mutation.",
			},
			mutation_dispatched: true,
		});
		expect(data.executed_steps).toBe(2);
		expect(calls.map((call) => call.slice(-3))).toContainEqual([
			"click",
			"@e1",
			"--json",
		]);
		expect(calls.map((call) => call.slice(-4))).toContainEqual([
			"is",
			"visible",
			"[data-persisted='true']",
			"--json",
		]);
	});

	test("routine automation auto-resolves one admissible tab before a semantic click", async () => {
		const store = await makeStore();
		const listedTab = {
			tabId: "t7",
			active: true,
			type: "page",
			url: "https://example.test/",
		};
		const { runtime, calls } = taskRunRuntime(store.env, [
			{ stdout: adapterSuccess({ tabs: [listedTab] }) },
			{ stdout: adapterSuccess({ tabs: [listedTab] }) },
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{
				stdout: adapterSuccess({
					snapshot: "@e1 button Save",
					refs: { e1: { role: "button", name: "Save" } },
				}),
			},
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{ stdout: adapterSuccess({ visible: true }) },
		]);

		const result = await runForTest(
			[
				"task", "run",
				"--intent", "routine-automation",
				"--handoff", store.handoffPath,
				"--allowed-origin", "https://example.test",
				"--click-role", "button",
				"--click-name", "Save",
				"--postcondition-id", "saved",
				"--expect-visible", "[data-persisted='true']",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.run).toMatchObject({
			state: "confirmed",
			mutation_dispatched: true,
		});
		expect(calls.slice(0, 3).map((call) => call.slice(-3))).toEqual([
			["tab", "list", "--json"],
			["tab", "list", "--json"],
			["tab", "cdp-target-t7", "--json"],
		]);
		expect(calls.map((call) => call.slice(-3))).toContainEqual([
			"click",
			"@e1",
			"--json",
		]);
	});

	test.each([
		[
			"zero",
			[
				{ tabId: "t7", active: true, type: "page", url: "https://other.test/" },
			],
			"agent_browser_target_unavailable",
		],
		[
			"multiple",
			[
				{ tabId: "t7", active: true, type: "page", url: "https://example.test/one" },
				{ tabId: "t8", active: false, type: "page", url: "https://example.test/two" },
			],
			"agent_browser_target_ambiguous",
		],
	] as const)(
		"routine automation without a tab fails closed for %s exact-origin matches",
		async (_matchCount, tabs, laneOutcome) => {
			const store = await makeStore();
			const { runtime, calls } = taskRunRuntime(store.env, [
				{ stdout: adapterSuccess({ tabs }) },
			]);
			const result = await runForTest(
				[
					"task", "run",
					"--intent", "routine-automation",
					"--handoff", store.handoffPath,
					"--allowed-origin", "https://example.test",
					"--click-role", "button",
					"--click-name", "Save",
					"--postcondition-id", "saved",
					"--expect-visible", "[data-persisted='true']",
					"--json",
				],
				runtime,
			);

			expect(result.exitCode).toBe(20);
			const data = parseJson(result.stdout).data as Record<string, unknown>;
			expect(data).toMatchObject({
				lane_outcome: laneOutcome,
				external_effect: "none",
			});
			const loaded = await loadSharedRun(store.deps, "run-task-run-1");
			expect(loaded.ok).toBe(true);
			if (loaded.ok) {
				expect(loaded.run).toMatchObject({
					state: "not-achieved",
					mutation_dispatched: false,
				});
			}
			expect(calls.map((call) => call.slice(-3))).toEqual([
				["tab", "list", "--json"],
			]);
		},
	);

	test("the shared run records mutation dispatch before the adapter receives the click", async () => {
		const store = await makeStore();
		let markerObservedBeforeClick = false;
		const { runtime } = taskRunRuntime(
			store.env,
			[
				{
					stdout: adapterSuccess({
						tabs: [
							{
								tabId: "t7",
								active: true,
								type: "page",
								url: "https://example.test/",
							},
						],
					}),
				},
				{ stdout: adapterSuccess({}) },
				{ stdout: adapterSuccess({ url: "https://example.test/" }) },
				{
					stdout: adapterSuccess({
						snapshot: "@e1 button Save",
						refs: { e1: { role: "button", name: "Save" } },
					}),
				},
				{ stdout: adapterSuccess({ url: "https://example.test/" }) },
				{ stdout: adapterSuccess({}) },
				{ stdout: adapterSuccess({ url: "https://example.test/" }) },
				{ stdout: adapterSuccess({ visible: true }) },
			],
			async (call) => {
				if (!call.includes("click")) return;
				const loaded = await loadSharedRun(store.deps, "run-task-run-1");
				markerObservedBeforeClick =
					loaded.ok && loaded.run.mutation_dispatched;
			},
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
				"t7",
				"--allowed-origin",
				"https://example.test",
				"--click-role",
				"button",
				"--click-name",
				"Save",
				"--postcondition-id",
				"saved",
				"--expect-visible",
				"[data-persisted='true']",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		expect(markerObservedBeforeClick).toBe(true);
	});

	test("a whitespace-only visible selector is refused before mutation", async () => {
		const store = await makeStore();
		const { runtime, calls } = taskRunRuntime(store.env, [
			{
				stdout: adapterSuccess({
					tabs: [
						{
							tabId: "t7",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{
				stdout: adapterSuccess({
					snapshot: "@e1 button Save",
					refs: { e1: { role: "button", name: "Save" } },
				}),
			},
			{ stdout: adapterSuccess({}) },
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
				"t7",
				"--allowed-origin",
				"https://example.test",
				"--click-role",
				"button",
				"--click-name",
				"Save",
				"--postcondition-id",
				"saved",
				"--expect-visible",
				"   ",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "task_run_lane_refused",
		});
		expect(calls.some((call) => call.includes("click"))).toBe(false);
		const loaded = await loadSharedRun(store.deps, "run-task-run-1");
		expect(loaded.ok).toBe(false);
	});

	test("a stale ref reassigned to different semantics cannot dispatch the click", async () => {
		const store = await makeStore();
		const { runtime, calls } = taskRunRuntime(store.env, [
			{
				stdout: adapterSuccess({
					tabs: [
						{
							tabId: "t7",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{
				stdout: adapterSuccess({
					snapshot: "@e1 link Cancel",
					refs: { e1: { role: "link", name: "Cancel" } },
				}),
			},
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
				"t7",
				"--allowed-origin",
				"https://example.test",
				"--click-role",
				"button",
				"--click-name",
				"Save",
				"--postcondition-id",
				"saved",
				"--expect-visible",
				"[data-persisted='true']",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "task_run_lane_refused" });
		expect(json.data).toMatchObject({
			lane_outcome: "agent_browser_ref_invalid",
			external_effect: "none",
		});
		const loaded = await loadSharedRun(store.deps, "run-task-run-1");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run).toMatchObject({
				state: "not-achieved",
				mutation_dispatched: false,
			});
		}
		expect(calls.some((call) => call.includes("click"))).toBe(false);
	});

	test("zero and duplicate semantic matches preserve exact no-effect truth", async () => {
		for (const refs of [
			{},
			{
				e1: { role: "button", name: "Save" },
				e2: { role: "button", name: "Save" },
			},
		]) {
			const store = await makeStore();
			const { runtime, calls } = taskRunRuntime(store.env, [
				{
					stdout: adapterSuccess({
						tabs: [
							{
								tabId: "t7",
								active: true,
								type: "page",
								url: "https://example.test/",
							},
						],
					}),
				},
				{ stdout: adapterSuccess({}) },
				{ stdout: adapterSuccess({ url: "https://example.test/" }) },
				{ stdout: adapterSuccess({ snapshot: "", refs }) },
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
					"t7",
					"--allowed-origin",
					"https://example.test",
					"--click-role",
					"button",
					"--click-name",
					"Save",
					"--postcondition-id",
					"saved",
					"--expect-visible",
					"[data-persisted='true']",
					"--json",
				],
				runtime,
			);

			expect(result.exitCode).toBe(20);
			const json = parseJson(result.stdout);
			expect(json.error).toMatchObject({ code: "task_run_lane_refused" });
			expect(json.data).toMatchObject({
				lane_outcome: "agent_browser_ref_invalid",
				external_effect: "none",
			});
			const loaded = await loadSharedRun(store.deps, "run-task-run-1");
			expect(loaded.ok).toBe(true);
			if (loaded.ok) {
				expect(loaded.run).toMatchObject({
					state: "not-achieved",
					mutation_dispatched: false,
				});
			}
			expect(calls.some((call) => call.includes("click"))).toBe(false);
		}
	});

	test("verification loss after semantic click records unknown and never repeats the mutation", async () => {
		const store = await makeStore();
		const { runtime, calls } = taskRunRuntime(store.env, [
			{
				stdout: adapterSuccess({
					tabs: [
						{
							tabId: "t7",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{
				stdout: adapterSuccess({
					snapshot: "@e1 button Submit",
					refs: { e1: { role: "button", name: "Submit" } },
				}),
			},
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterCdpFailure(), exitCode: 1, timedOut: true },
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
				"t7",
				"--allowed-origin",
				"https://example.test",
				"--click-role",
				"button",
				"--click-name",
				"Submit",
				"--postcondition-id",
				"submitted",
				"--expect-visible",
				"[data-submitted='true']",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "task_run_effect_unknown" });
		expect(json.data).toMatchObject({
			lane_outcome: "agent_browser_mutation_effect_unknown",
			external_effect: "unknown",
		});
		const loaded = await loadSharedRun(store.deps, "run-task-run-1");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run).toMatchObject({
				state: "unknown",
				mutation_dispatched: true,
				postcondition: { id: "submitted" },
			});
		}
		expect(calls.filter((call) => call.includes("click"))).toHaveLength(1);
		expect(
			(json.continuation as Record<string, unknown>).next_action_id,
		).toBe("inspect_task_run_result");
	});

	test("ambient success text cannot override a false named structural postcondition", async () => {
		const store = await makeStore();
		const { runtime } = taskRunRuntime(store.env, [
			{
				stdout: adapterSuccess({
					tabs: [
						{
							tabId: "t7",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{
				stdout: adapterSuccess({
					snapshot: "Saved successfully\n@e1 button Save",
					refs: { e1: { role: "button", name: "Save" } },
				}),
			},
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{ stdout: adapterSuccess({ message: "Saved successfully" }) },
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{ stdout: adapterSuccess({ visible: false }) },
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
				"t7",
				"--allowed-origin",
				"https://example.test",
				"--click-role",
				"button",
				"--click-name",
				"Save",
				"--postcondition-id",
				"persisted",
				"--expect-visible",
				"[data-persisted='true']",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "task_run_not_achieved" });
		expect(json.data).toMatchObject({
			lane_outcome: "agent_browser_postcondition_not_achieved",
			external_effect: "unknown",
		});
		const loaded = await loadSharedRun(store.deps, "run-task-run-1");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run).toMatchObject({
				state: "not-achieved",
				mutation_dispatched: true,
				postcondition: { id: "persisted" },
			});
		}
		expect(result.stdout).not.toContain("Saved successfully");
	});

	test("successful Playwright dispatch selects the intended tab and returns snapshot evidence", async () => {
		const store = await makeStore();
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			store.handoffPath,
			JSON.stringify(handoffFor("playwright-cdp", "run-playwright")),
			"utf-8",
		);
		const { runtime, calls } = taskRunRuntime(store.env, [
			{ stdout: "" },
			{ stdout: "" },
			{
				stdout:
					"### Page\n- Page URL: https://example.test/account\n### Snapshot\n- heading \"Account\"\n",
			},
			{ stdout: "" },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "frontend-test",
				"--handoff", store.handoffPath,
				"--tab", "1",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.selected_lane).toBe("playwright-cdp");
		expect((data.run as Record<string, unknown>).state).toBe("confirmed");
		expect(calls.map((call) => call.slice(1))).toEqual([
			[
				"attach",
				"--cdp=http://127.0.0.1:9222",
				"--session=browser-use-run-playwright",
			],
			["--session=browser-use-run-playwright", "tab-select", "1"],
			["--session=browser-use-run-playwright", "snapshot"],
			["--session=browser-use-run-playwright", "detach"],
		]);
	});

	test("Playwright semantic mutation marks dispatch before click and confirms only from fresh structure", async () => {
		const store = await makeStore();
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			store.handoffPath,
			JSON.stringify(handoffFor("playwright-cdp", "run-playwright-mutation")),
			"utf-8",
		);
		let markerObservedBeforeClick = false;
		const { runtime, calls } = taskRunRuntime(
			store.env,
			[
				{ stdout: "" },
				{ stdout: "" },
				{
					stdout: [
						"### Page",
						"- Page URL: https://example.test/account",
						"### Snapshot",
						'- button "Save" [ref=e7]',
					].join("\n"),
				},
				{ stdout: "" },
				{ stdout: "true\n" },
				{ stdout: "" },
			],
			async (call) => {
				if (!call.includes("click")) return;
				const loaded = await loadSharedRun(
					store.deps,
					"run-playwright-mutation",
				);
				markerObservedBeforeClick =
					loaded.ok && loaded.run.mutation_dispatched;
			},
		);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "frontend-test",
				"--handoff", store.handoffPath,
				"--tab", "1",
				"--allowed-origin", "https://example.test",
				"--click-role", "button",
				"--click-name", "Save",
				"--postcondition-id", "saved",
				"--expect-visible", "[data-persisted='true']",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(0);
		expect(markerObservedBeforeClick).toBe(true);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data).toMatchObject({
			selected_lane: "playwright-cdp",
			executed_steps: 6,
			external_effect: "none",
		});
		expect(data.run).toMatchObject({
			state: "confirmed",
			mutation_dispatched: true,
			postcondition: {
				id: "saved",
				summary: "The declared element is visible after mutation.",
			},
		});
		expect(calls.map((call) => call.slice(1))).toEqual([
			[
				"attach",
				"--cdp=http://127.0.0.1:9222",
				"--session=browser-use-run-playwright-mutation",
			],
			["--session=browser-use-run-playwright-mutation", "tab-select", "1"],
			["--session=browser-use-run-playwright-mutation", "snapshot"],
			["--session=browser-use-run-playwright-mutation", "click", "e7"],
			[
				"--session=browser-use-run-playwright-mutation",
				"--raw",
				"eval",
				"el => !!(el && el.isConnected && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0)",
				"[data-persisted='true']",
			],
			["--session=browser-use-run-playwright-mutation", "detach"],
		]);
	});

	test("Playwright stale semantic refs refuse before mutation and cannot confirm the run", async () => {
		const store = await makeStore();
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			store.handoffPath,
			JSON.stringify(handoffFor("playwright-cdp", "run-playwright-stale")),
			"utf-8",
		);
		const { runtime, calls } = taskRunRuntime(store.env, [
			{ stdout: "" },
			{ stdout: "" },
			{
				stdout: [
					"### Page",
					"- Page URL: https://example.test/account",
					"### Snapshot",
					'- link "Cancel" [ref=e7]',
				].join("\n"),
			},
			{ stdout: "" },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "locator-aria-assertion",
				"--handoff", store.handoffPath,
				"--tab", "1",
				"--allowed-origin", "https://example.test",
				"--click-role", "button",
				"--click-name", "Save",
				"--postcondition-id", "saved",
				"--expect-visible", "[data-persisted='true']",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "task_run_lane_refused" });
		expect(json.data).toMatchObject({
			selected_lane: "playwright-cdp",
			lane_outcome: "playwright_task_ref_invalid",
			external_effect: "none",
		});
		const loaded = await loadSharedRun(store.deps, "run-playwright-stale");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run).toMatchObject({
				state: "not-achieved",
				mutation_dispatched: false,
			});
		}
		expect(calls.some((call) => call.includes("click"))).toBe(false);
		expect(calls.at(-1)?.at(-1)).toBe("detach");
	});

	test("Playwright click uncertainty records unknown once and blocks retry", async () => {
		const store = await makeStore();
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			store.handoffPath,
			JSON.stringify(handoffFor("playwright-cdp", "run-playwright-unknown")),
			"utf-8",
		);
		const { runtime, calls } = taskRunRuntime(store.env, [
			{ stdout: "" },
			{ stdout: "" },
			{
				stdout: [
					"### Page",
					"- Page URL: https://example.test/account",
					"### Snapshot",
					'- button "Save" [ref=e7]',
				].join("\n"),
			},
			{ stdout: "", exitCode: 1, timedOut: true },
			{ stdout: "" },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "frontend-test",
				"--handoff", store.handoffPath,
				"--tab", "1",
				"--allowed-origin", "https://example.test",
				"--click-role", "button",
				"--click-name", "Save",
				"--postcondition-id", "saved",
				"--expect-visible", "[data-persisted='true']",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "task_run_effect_unknown" });
		expect(json.data).toMatchObject({
			selected_lane: "playwright-cdp",
			lane_outcome: "playwright_task_mutation_effect_unknown",
			external_effect: "unknown",
		});
		const loaded = await loadSharedRun(store.deps, "run-playwright-unknown");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run).toMatchObject({
				state: "unknown",
				mutation_dispatched: true,
			});
		}
		expect(
			calls.filter((call) => call.includes("click")),
		).toHaveLength(1);
		expect(json.continuation).toMatchObject({
			next_action_id: "inspect_task_run_result",
		});
	});

	test("Playwright ambient success cannot override a false named postcondition", async () => {
		const store = await makeStore();
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			store.handoffPath,
			JSON.stringify(handoffFor("playwright-cdp", "run-playwright-false")),
			"utf-8",
		);
		const { runtime } = taskRunRuntime(store.env, [
			{ stdout: "" },
			{ stdout: "" },
			{
				stdout: [
					"### Page",
					"- Page URL: https://example.test/account",
					"### Snapshot",
					'- button "Save" [ref=e7]',
				].join("\n"),
			},
			{ stdout: "Saved successfully" },
			{ stdout: "false\n" },
			{ stdout: "" },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "frontend-test",
				"--handoff", store.handoffPath,
				"--tab", "1",
				"--allowed-origin", "https://example.test",
				"--click-role", "button",
				"--click-name", "Save",
				"--postcondition-id", "saved",
				"--expect-visible", "[data-persisted='true']",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "task_run_not_achieved" });
		expect(json.data).toMatchObject({
			lane_outcome: "playwright_task_postcondition_not_achieved",
			external_effect: "unknown",
		});
		const loaded = await loadSharedRun(store.deps, "run-playwright-false");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run).toMatchObject({
				state: "not-achieved",
				mutation_dispatched: true,
			});
		}
		expect(result.stdout).not.toContain("Saved successfully");
	});

	test("Playwright connection failure blocks the same run without adapter fallback", async () => {
		const store = await makeStore();
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			store.handoffPath,
			JSON.stringify(handoffFor("playwright-cdp", "run-playwright-connect")),
			"utf-8",
		);
		const { runtime } = taskRunRuntime(store.env, [
			{ stdout: "", exitCode: 1 },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "frontend-test",
				"--handoff", store.handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({
			code: "task_run_connection_unstable",
		});
		expect((json.data as Record<string, unknown>).selected_lane).toBe(
			"playwright-cdp",
		);
		expect(
			(json.continuation as Record<string, unknown>).next_action_id,
		).toBe("resume_shared_run");
		expect(JSON.stringify(json)).not.toContain("agent-browser");
	});

	test("Playwright origin mismatch records not achieved and never switches lanes", async () => {
		const store = await makeStore();
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			store.handoffPath,
			JSON.stringify(handoffFor("playwright-cdp", "run-playwright-origin")),
			"utf-8",
		);
		const { runtime, calls } = taskRunRuntime(store.env, [
			{ stdout: "" },
			{ stdout: "" },
			{ stdout: "### Page\n- Page URL: https://other.test/account\n" },
			{ stdout: "" },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "locator-aria-assertion",
				"--handoff", store.handoffPath,
				"--tab", "2",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "task_run_lane_refused" });
		expect((json.data as Record<string, unknown>).lane_outcome).toBe(
			"playwright_task_origin_refused",
		);
		expect(calls.at(-1)?.at(-1)).toBe("detach");
		expect(JSON.stringify(json)).not.toContain("agent-browser");
	});

	// An unregistered --lane value (e.g. playwright-cli, not a registered adapter)
	// is refused at the PARSER as a usage error before the live/dry-run split —
	// the contract declares --lane as an enum of BROWSER_USE_LIVE_ADAPTERS, so a
	// value outside it never reaches live admission (finding #8, R27). The
	// engine's own lane_override_inadmissible branch is still covered directly at
	// routeTaskRun ("a rejected identity alias override fails closed").
	test("an unregistered lane override is refused at the parser (usage error, R27)", async () => {
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
		expect(result.exitCode).toBe(2);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "usage_error" });
		expect(`${result.stdout}\n${result.stderr}`).toContain("--lane must be one of:");
	});

	test("an override cannot route an intent through a Playwright lane lacking its capability", async () => {
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
		expect(json.error).toMatchObject({
			code: "task_run_lane_override_inadmissible",
		});
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"choose_admissible_lane",
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
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
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
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
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

	test("a missing --allowed-origin is refused BEFORE any run is created; a corrected retry proceeds", async () => {
		const store = await makeStore();
		const first = await runForTest(
			[
				"task", "run",
				"--intent", "routine-automation",
				"--handoff", store.handoffPath,
				"--tab", "t7",
				"--json",
			],
			makeRuntime({ env: store.env }),
		);
		expect(first.exitCode).toBe(2);
		expect(parseJson(first.stdout).error).toMatchObject({
			code: "task_run_lane_refused",
		});
		// The usage error must NOT have persisted a run keyed on the handoff's run
		// id: an orphaned `running` run here would make every corrected retry with
		// the same handoff a store_record_conflict.
		const orphan = await loadSharedRun(store.deps, "run-task-run-1");
		expect(orphan.ok).toBe(false);
		// Corrected retry with the SAME handoff: creates the run cleanly.
		const { runtime } = taskRunRuntime(store.env, [
			{
				stdout: adapterSuccess({
					tabs: [{ tabId: "t7", active: true, type: "page", url: "https://example.test/" }],
				}),
			},
			{ stdout: adapterSuccess({}) },
			{ stdout: adapterSuccess({ url: "https://example.test/" }) },
			{ stdout: adapterSuccess({ snapshot: "@e1 button", refs: { e1: {} } }) },
		]);
		const retried = await runForTest(
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
		expect(retried.exitCode).toBe(0);
		const run = (parseJson(retried.stdout).data as Record<string, unknown>)
			.run as Record<string, unknown>;
		expect(run.run_id).toBe("run-task-run-1");
		expect(run.state).toBe("confirmed");
	});
});
