import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import type { RunStoreDeps } from "./browser-use-runs";
import { loadSharedRun } from "./browser-use-runs";
import { runbooksRoot } from "./browser-use-runbook";
import type { BrowserUseRunbook } from "./browser-use-runbook-model";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

// =========================================================================
// Wave-3 shared-CLI integration: chrome-devtools-mcp task-run dispatch and the
// live runbook family (list/show/run). CLI-level proof over the REAL driver via
// runForTest against a real temp XDG store. Adapter envelopes match the
// VERBATIM shapes proven in wave 1/2:
//   - agent-browser: {success, data, error}
//   - chrome-devtools-mcp: {content:[{type:"text",text}], isError?}
// =========================================================================

const disposables: { dispose(): void }[] = [];
afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

// --- Handoff fixtures --------------------------------------------------------

function handoffEnvelope(adapterId: string, runId: string) {
	return {
		status: "ok",
		run_id: runId,
		data: {
			outcome: "verified",
			environment: { name: "agent-chrome", profile: "default" },
			browser_entry_mode: "explicit-cdp",
			attachment: {
				adapter_id: adapterId,
				route: "explicit-cdp",
				probe_executable: "/opt/browser-connect/probe",
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
	};
}

// --- MCP / agent-browser envelope shapes -------------------------------------

function mcpText(text: string): string {
	return JSON.stringify({ content: [{ type: "text", text }] });
}
function chromePagesListing(): string {
	return mcpText(
		["## Pages", "0: example (https://example.test/) [selected]"].join("\n"),
	);
}
function chromeConsole(): string {
	return mcpText("## Console messages\n(no messages)");
}
function chromeNetwork(): string {
	return mcpText("## Network requests\n(no requests)");
}
function chromeTraceStarted(): string {
	return mcpText("## Trace\nRecording started.");
}
function chromeTraceStopped(): string {
	return mcpText("## Trace\nRecording stopped; 1 trace captured.");
}
function agentSuccess(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

// --- Store setup -------------------------------------------------------------

async function makeStore(): Promise<{
	env: Record<string, string | undefined>;
	deps: RunStoreDeps;
	dataRoot: string;
	base: string;
}> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return {
		env: xdg.env,
		deps: { fs, paths: opened.paths, clock: fixedClock().now },
		dataRoot: opened.paths.data.root,
		base: xdg.base,
	};
}

function writeHandoff(base: string, adapterId: string, runId: string): string {
	const path = join(base, `handoff-${adapterId}.json`);
	writeFileSync(path, JSON.stringify(handoffEnvelope(adapterId, runId)), "utf-8");
	return path;
}

function seedRunbook(dataRoot: string, runbook: BrowserUseRunbook): void {
	const dir = join(runbooksRoot(dataRoot), runbook.service_id, runbook.flow_id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "runbook.json"), JSON.stringify(runbook), "utf-8");
}

// A read-only seed runbook: one open + one snapshot, no confidential input, no
// declared inputs (so a fresh run reaches total_steps and confirms).
function readOnlyRunbook(): BrowserUseRunbook {
	return {
		contract: "browser-use.runbook",
		schema_version: "1",
		service_id: "oncore",
		flow_id: "snapshot-verify",
		flow_name: "verify-loaded",
		version: "1",
		summary: "Read-only snapshot verification.",
		allowed_origins: ["https://example.test"],
		inputs: [],
		steps: [
			{
				kind: "open",
				url: "https://example.test/",
				postcondition: { kind: "url-equals", url: "https://example.test/" },
			},
			{ kind: "snapshot", interactive: true },
		],
	};
}

// A runtime replaying a scripted adapter response sequence over the real store.
function scriptedRuntime(
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
			readTextFile: (path: string) =>
				import("node:fs/promises").then((m) => m.readFile(path, "utf-8")),
			runCommand: async (input) => {
				calls.push([input.command, ...input.args]);
				const response = responses[index++] ?? {};
				return {
					exitCode: response.exitCode ?? 0,
					stdout: response.stdout ?? "",
					stderr: "",
					...(response.timedOut === undefined ? {} : { timedOut: response.timedOut }),
				};
			},
		}),
	};
}

// =========================================================================
// chrome-devtools-mcp task-run dispatch (release contract R9, R21; F6)
// =========================================================================

describe("task run — chrome-devtools-mcp dispatch (U4 wiring)", () => {
	test("a debug intent compiles to console + network and confirms read-only", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-chrome-1");
		// The debug intent compiles (compileChromeOperationSet) to console-read +
		// network-read: list_pages (origin proof) then list_console_messages then
		// list_network_requests. Both reads are bounded native evidence, no artifact.
		const { runtime, calls } = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeConsole() },
			{ stdout: chromeNetwork() },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		const data = json.data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.shared-run");
		expect(data.selected_lane).toBe("chrome-devtools-mcp");
		expect(data.external_effect).toBe("none");
		const run = data.run as Record<string, unknown>;
		expect(run.state).toBe("confirmed");
		expect(run.adapter_id).toBe("chrome-devtools-mcp");
		// The executor drove the compiled chrome tool set, never the agent-browser CLI.
		expect(calls[0]?.join(" ")).toContain("list_pages");
		expect(calls[1]?.join(" ")).toContain("list_console_messages");
		expect(calls[2]?.join(" ")).toContain("list_network_requests");
		// debug is a two-op read set: no artifact-producing tool ran.
		expect(calls.some((c) => c.join(" ").includes("performance_start_trace"))).toBe(
			false,
		);
	});

	test("a non-integer --tab is refused before any chrome call", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-chrome-2");
		const { runtime, calls } = scriptedRuntime(store.env, []);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "not-a-number",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "task_run_lane_refused",
		});
		expect(calls).toHaveLength(0);
	});

	test("a performance-profile intent compiles to a trace and persists an artifact reference", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-chrome-3");
		// performance-profile compiles to a performance-trace op: list_pages
		// (origin proof) then performance_start_trace + performance_stop_trace. The
		// driver creates the artifact_dir before dispatch, so the trace op produces
		// a native artifact reference the run persists (R21).
		const { runtime, calls } = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeTraceStarted() },
			{ stdout: chromeTraceStopped() },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "performance-profile",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const run = (parseJson(result.stdout).data as Record<string, unknown>)
			.run as Record<string, unknown>;
		expect(run.state).toBe("confirmed");
		// The compiled trace op drove start/stop and produced one export artifact.
		expect(calls[1]?.join(" ")).toContain("performance_start_trace");
		expect(calls[2]?.join(" ")).toContain("performance_stop_trace");
		const artifacts = run.artifacts as Array<Record<string, unknown>>;
		expect(Array.isArray(artifacts)).toBe(true);
		expect(artifacts).toHaveLength(1);
		expect(artifacts[0]?.artifact_id).toContain("perf-trace");
		expect(artifacts[0]?.retention).toBe("export");
		// The durable run reads back with the persisted artifact reference.
		const loaded = await loadSharedRun(store.deps, "run-chrome-3");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.artifacts).toHaveLength(1);
	});
});

// =========================================================================
// Runbook family — live list/show/run (platform plan U4)
// =========================================================================

describe("runbook family — live (U4 wiring)", () => {
	test("runbook list projects the discovered catalog (no not-implemented)", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const result = await runForTest(
			["runbook", "list", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(JSON.stringify(json)).not.toContain("browser_use_not_implemented");
		const data = json.data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.runbook-catalog");
		const rows = data.runbooks as Array<Record<string, unknown>>;
		// The catalog merges the code-owned shipped seed with the seeded store
		// row; the seeded oncore/snapshot-verify must appear among them.
		const seeded = rows.find(
			(r) => r.service_id === "oncore" && r.flow_id === "snapshot-verify",
		);
		expect(seeded).toBeDefined();
		expect(data.runbook_count).toBe(rows.length);
	});

	test("runbook show returns one validated definition and health", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const result = await runForTest(
			["runbook", "show", "--service", "oncore", "--flow", "snapshot-verify", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.runbook-definition");
		expect(data.health).toBe("healthy");
		const runbook = data.runbook as Record<string, unknown>;
		expect(runbook.service_id).toBe("oncore");
	});

	test("runbook show for a missing runbook fails closed with a typed refusal", async () => {
		const store = await makeStore();
		const result = await runForTest(
			["runbook", "show", "--service", "oncore", "--flow", "absent", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "runbook_not_found",
		});
	});

	test("runbook run dispatches the read-only runbook through agent-browser and confirms", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "agent-browser", "run-runbook-1");
		// agent-browser executor sequence for open + snapshot: tab list, tab select,
		// open, get-url (open postcondition), snapshot.
		const { runtime } = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [{ tabId: "t1", active: true, type: "page", url: "https://example.test/" }],
				}),
			},
			{ stdout: agentSuccess({ selected: true }) },
			{ stdout: agentSuccess({ opened: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ snapshot: "@e1 button", refs: { "@e1": {} } }) },
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--tab", "t1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.shared-run");
		expect(data.selected_lane).toBe("agent-browser");
		const run = data.run as Record<string, unknown>;
		expect(run.task_intent).toBe("runbook-execution");
		expect(run.state).toBe("confirmed");
		// The run is durable and readable back as confirmed truth.
		const loaded = await loadSharedRun(store.deps, "run-runbook-1");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.state).toBe("confirmed");
	});

	test("runbook run on a chrome handoff fails closed, never substitutes the lane (R11)", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-runbook-2");
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--json",
			],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "task_run_handoff_lane_mismatch",
		});
	});

	test("runbook run without --service is a usage error", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "agent-browser", "run-runbook-3");
		const result = await runForTest(
			["runbook", "run", "--flow", "snapshot-verify", "--handoff", handoffPath, "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({ code: "usage_error" });
	});
});
