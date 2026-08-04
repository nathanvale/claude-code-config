import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import type { RunStoreDeps } from "./browser-use-runs";
import { createSharedRun, loadSharedRun } from "./browser-use-runs";
import type { BrowserUseSharedRun } from "./browser-use-run-model";
import { runbooksRoot } from "./browser-use-runbook";
import type { BrowserUseRunbook } from "./browser-use-runbook-model";
import type { BrowserUseEnvironmentTokenRetrievalPort } from "./browser-use-environment-op";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";
import { candidateIdOf, targetEnvelopeIdOf } from "./browser-use-core";
import { parseHandoffFacts } from "./browser-use-discovery";
import { browserUseContracts } from "./command-contract";

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

function handoffEnvelope(
	adapterId: string,
	runId: string,
	endpoint = {
		http: "http://127.0.0.1:9222",
		ws: "ws://127.0.0.1:9222/devtools/browser/fixture",
	},
) {
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
			endpoint,
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

async function gitFixtureCommand(
	input: {
		cwd: string;
		gitDir?: string;
		workTree?: string;
	},
	...args: string[]
): Promise<void> {
	const child = Bun.spawn(["git", ...args], {
		cwd: input.cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			...(input.gitDir === undefined ? {} : { GIT_DIR: input.gitDir }),
			...(input.workTree === undefined
				? {}
				: { GIT_WORK_TREE: input.workTree }),
		},
	});
	if ((await child.exited) !== 0) {
		throw new Error(await new Response(child.stderr).text());
	}
}

/**
 * Build a disposable committed catalog source and pass its GIT_DIR/GIT_WORK_TREE
 * to `run` explicitly. The env stays local to each spawned git/runtime call, so
 * no process-wide `process.env` mutation leaks across parallel tests.
 */
async function withCommittedCatalogSource<T>(
	base: string,
	run: (gitEnv: { GIT_DIR: string; GIT_WORK_TREE: string }) => Promise<T>,
): Promise<T> {
	const repoRoot = resolve(import.meta.dir, "../../..");
	const gitDir = join(base, "catalog-source.git");
	await gitFixtureCommand({ cwd: base }, "init", "--bare", "-q", gitDir);
	await gitFixtureCommand({ cwd: repoRoot, gitDir, workTree: repoRoot }, "config", "user.email", "test@example.invalid");
	await gitFixtureCommand({ cwd: repoRoot, gitDir, workTree: repoRoot }, "config", "user.name", "Catalog Test");
	await gitFixtureCommand(
		{ cwd: repoRoot, gitDir, workTree: repoRoot },
		"add",
		"skills/browser-use/runbooks",
		"skills/browser-use/actions",
	);
	await gitFixtureCommand({ cwd: repoRoot, gitDir, workTree: repoRoot }, "commit", "-qm", "test catalog fixture");
	return await run({ GIT_DIR: gitDir, GIT_WORK_TREE: repoRoot });
}

function writeHandoff(
	base: string,
	adapterId: string,
	runId: string,
	endpoint?: { http: string; ws: string },
): string {
	const path = join(base, `handoff-${adapterId}.json`);
	writeFileSync(
		path,
		JSON.stringify(handoffEnvelope(adapterId, runId, endpoint)),
		"utf-8",
	);
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
		schema_version: "2",
		service_id: "oncore",
		flow_id: "snapshot-verify",
		flow_name: "verify-loaded",
		version: "2",
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

function confidentialRunbook(): BrowserUseRunbook {
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "oncore",
		flow_id: "confidential-login",
		flow_name: "confidential-login",
		version: "1",
		summary: "Confidential login refusal fixture.",
		allowed_origins: ["https://example.test"],
		inputs: [],
		steps: [
			{
				kind: "fill",
				target: { role: "textbox", name: "Password" },
				sensitivity: "confidential",
				item_binding: "oncore_password",
				postcondition: {
					kind: "element-visible",
					selector: ".signed-in",
				},
			},
		],
	};
}

function authContextRunbook(origin: string): BrowserUseRunbook {
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "fixture-auth",
		flow_id: "business-after-login",
		flow_name: "business-after-login",
		version: "1",
		summary: "Authenticate generically, then capture one business snapshot.",
		allowed_origins: [origin],
		auth_context_ref: "interactive-login",
		inputs: [],
		steps: [{ kind: "snapshot", interactive: true }],
	};
}

function authContextOpenRunbook(origin: string): BrowserUseRunbook {
	return {
		...authContextRunbook(origin),
		steps: [
			{
				kind: "open",
				url: `${origin}/login`,
				postcondition: { kind: "url-equals", url: `${origin}/login` },
			},
			{ kind: "snapshot", interactive: true },
		],
	};
}

function startAuthCdpFixture(input: { initial: "neutral" | "login" | "ambiguous" }) {
	let screen = input.initial;
	let targetUrl = input.initial === "neutral" ? "about:blank" : "http://127.0.0.1:45123/login";
	const cdpTargetId = "cdp-target-auth";
	const methods: string[] = [];
	const navigations: string[] = [];
	const attachedTargetIds: string[] = [];
	const origin = "http://127.0.0.1:45123";
	const transport = {
		transport: {
			async request(message: {
				method: string;
				params?: Record<string, unknown>;
			}): Promise<unknown> {
				methods.push(message.method);
				switch (message.method) {
					case "Target.getTargets":
						return {
							targetInfos: [
								{ targetId: cdpTargetId, type: "page", url: targetUrl },
							],
						};
					case "Target.attachToTarget":
						attachedTargetIds.push(String(message.params?.targetId));
						if (message.params?.targetId !== cdpTargetId) {
							throw new Error("adapter tab id is not a CDP target id");
						}
						return { sessionId: "auth-session" };
					case "Page.getFrameTree":
						return {
							frameTree: { frame: { id: "frame-auth", url: targetUrl } },
						};
					case "Page.navigate": {
						const url = message.params?.url;
						if (typeof url !== "string") throw new Error("missing navigation URL");
						navigations.push(url);
						targetUrl = url;
						screen = "login";
						return { frameId: "frame-auth" };
					}
					case "Accessibility.getFullAXTree":
						return {
							nodes:
								screen === "login"
									? [
											{ nodeId: "form", role: { value: "form" }, name: { value: "Sign in" }, ignored: false, childIds: ["username", "password", "submit"] },
											{ nodeId: "username", parentId: "form", frameId: "frame-auth", role: { value: "textbox" }, name: { value: "Username" }, ignored: false, backendDOMNodeId: 11 },
											{ nodeId: "password", parentId: "form", frameId: "frame-auth", role: { value: "textbox" }, name: { value: "Password" }, ignored: false, backendDOMNodeId: 12 },
											{ nodeId: "submit", parentId: "form", frameId: "frame-auth", role: { value: "button" }, name: { value: "Sign in" }, ignored: false, backendDOMNodeId: 13 },
										]
									: [
											{ nodeId: "welcome", frameId: "frame-auth", role: { value: "heading" }, name: { value: "Welcome to Dashboard" }, ignored: false },
										],
						};
					case "DOM.resolveNode":
						return { object: { objectId: "field-object" } };
					case "DOM.getContentQuads":
						return { quads: [[0, 0, 20, 0, 20, 10, 0, 10]] };
					case "Input.dispatchMouseEvent":
						if (message.params?.type === "mouseReleased") screen = "ambiguous";
				}
				return {};
			},
		},
		close() {},
	};
	return {
		origin,
		transport,
		methods,
		navigations,
		attachedTargetIds,
		cdpTargetId,
	};
}

function authTokenPort(
	origin: string,
	counts?: { fetches: number; redeems: number },
): BrowserUseEnvironmentTokenRetrievalPort {
	const item = {
		item_id: "item-fixture",
		vault_id: "vault-fixture",
		origins: [origin],
		login_paths: ["/login"],
		supported_methods: ["password" as const],
		state: "active" as const,
	};
	return {
		listVaults: async () => ({ ok: true, vaults: [{ vault_id: "vault-fixture" }] }),
		listLoginItems: async () => ({ ok: true, items: [item] }),
		getLoginItem: async () => ({ ok: true, item }),
		fetchCredentialField: async ({ field }) => {
			if (counts !== undefined) counts.fetches += 1;
			return {
				ok: true,
				handle: { handle_id: `fixture-${field}`, field, expires_at_epoch_ms: 60_000 },
			};
		},
		redeemCredentialField: async () => {
			if (counts !== undefined) counts.redeems += 1;
			return {
				ok: true,
				shape: { field: "password", byte_length: 12 },
			};
		},
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
			// Real disk write seams so the chrome executor's native-artifact write
			// actually lands under the temp store (this is a CLI integration proof
			// over the real driver, not a stubbed unit). ensureDirectory mirrors the
			// default runtime's recursive 0700 mkdir; writeTextFile writes the bytes.
			ensureDirectory: (path: string) =>
				import("node:fs/promises").then((m) =>
					m.mkdir(path, { recursive: true, mode: 0o700 }).then(() => undefined),
				),
			writeTextFile: (path: string, contents: string) =>
				import("node:fs/promises").then((m) =>
					m.writeFile(path, contents, { mode: 0o600 }),
				),
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

	test("a non-integer --tab is refused before any chrome call AND before any run is created", async () => {
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
		// The usage error must NOT have persisted a run keyed on the handoff's run
		// id: a stray `running` run here would poison the handoff, turning every
		// corrected retry into a store_record_conflict.
		const orphan = await loadSharedRun(store.deps, "run-chrome-2");
		expect(orphan.ok).toBe(false);
		// A corrected retry with the SAME handoff proceeds cleanly (no conflict).
		const retryRuntime = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeConsole() },
			{ stdout: chromeNetwork() },
		]);
		const retried = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			retryRuntime.runtime,
		);
		expect(retried.exitCode).toBe(0);
		const retriedRun = (parseJson(retried.stdout).data as Record<string, unknown>)
			.run as Record<string, unknown>;
		expect(retriedRun.run_id).toBe("run-chrome-2");
		expect(retriedRun.state).toBe("confirmed");
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
		const artifactId = artifacts[0]?.artifact_id as string;
		expect(artifactId).toContain("perf-trace");
		expect(artifacts[0]?.retention).toBe("export");
		// The artifact reference is not just a name: the executor WROTE the native
		// trace evidence to the derived path, so a file exists on disk carrying the
		// captured trace summary (closes finding #2 — no advertised-but-absent
		// evidence).
		const artifactPath = join(
			store.deps.paths.state.artifactDir("run-chrome-3"),
			artifactId,
		);
		const bytes = readFileSync(artifactPath, "utf-8");
		expect(bytes).toContain("trace captured");
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
	test("runbook run discovery advertises every target repair continuation", () => {
		const actionIds =
			browserUseContracts["runbook-run"].actionAffordances?.failure.map(
				(action) => action.id,
			) ?? [];
		expect(actionIds).toEqual(
			expect.arrayContaining([
				"prepare_unique_runbook_target",
				"refresh_runbook_handoff",
				"restore_bound_runbook_target",
			]),
		);
	});

	test("runbook list surfaces verifier-separated records outside activation blockers", async () => {
		const store = await makeStore();
		const result = await withCommittedCatalogSource(store.base, async (gitEnv) =>
			await runForTest(
				["runbook", "list", "--json"],
				makeRuntime({ env: { ...store.env, ...gitEnv } }),
			),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.separated).toContainEqual(
			expect.objectContaining({
				record_id: "fasttrack/fill-week",
				code: "promotion_verifier_unavailable",
			}),
		);
		expect(data.activation_blockers).not.toContainEqual(
			expect.objectContaining({ id: "fasttrack/fill-week" }),
		);
		const rows = data.runbooks as Array<Record<string, unknown>>;
		expect(rows.find((row) => row.service_id === "fasttrack" && row.flow_id === "fill-week")?.synchronization_status).toBe("separated");
	});

	test("runbook list projects the discovered catalog (no not-implemented)", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const result = await withCommittedCatalogSource(store.base, async (gitEnv) =>
			await runForTest(
				["runbook", "list", "--json"],
				makeRuntime({ env: { ...store.env, ...gitEnv } }),
			),
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
		expect(data.separated).toContainEqual(
			expect.objectContaining({ record_id: "fasttrack/fill-week" }),
		);
	});

	test("runbook show returns one validated definition and health", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const result = await withCommittedCatalogSource(store.base, async (gitEnv) =>
			await runForTest(
				["runbook", "show", "--service", "oncore", "--flow", "snapshot-verify", "--json"],
				makeRuntime({ env: { ...store.env, ...gitEnv } }),
			),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.runbook-definition");
		expect(data.health).toBe("healthy");
		const runbook = data.runbook as Record<string, unknown>;
		expect(runbook.service_id).toBe("oncore");
		expect(data.separated).toBeNull();
	});

	test("runbook show surfaces a verifier-separated definition without making it executable", async () => {
		const store = await makeStore();
		const result = await withCommittedCatalogSource(store.base, async (gitEnv) =>
			await runForTest(
				["runbook", "show", "--service", "fasttrack", "--flow", "fill-week", "--json"],
				makeRuntime({ env: { ...store.env, ...gitEnv } }),
			),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.synchronization_status).toBe("separated");
		expect(data.separated).toMatchObject({
			record_id: "fasttrack/fill-week",
			code: "promotion_verifier_unavailable",
		});
	});

	test("runbook show for a missing runbook fails closed with a typed refusal", async () => {
		const store = await makeStore();
		const result = await withCommittedCatalogSource(store.base, async (gitEnv) =>
			await runForTest(
				["runbook", "show", "--service", "oncore", "--flow", "absent", "--json"],
				makeRuntime({ env: { ...store.env, ...gitEnv } }),
			),
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
			{
				stdout: agentSuccess({
					tabs: [{ tabId: "t1", active: true, type: "page", url: "https://example.test/" }],
				}),
			},
			{ stdout: agentSuccess({ selected: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
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

	test("auth_context_ref keeps one shared run and dispatches the first business step once after proof", async () => {
		const cdp = startAuthCdpFixture({ initial: "login" });
		try {
			const store = await makeStore();
			seedRunbook(store.dataRoot, authContextRunbook(cdp.origin));
			const runId = "run-runbook-auth-success";
			const handoffPath = writeHandoff(store.base, "agent-browser", runId);
			const { runtime, calls } = scriptedRuntime(store.env, [
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
				{ stdout: agentSuccess({ selected: true }) },
				{ stdout: agentSuccess({ url: `${cdp.origin}/login` }) },
				{ stdout: agentSuccess({ snapshot: "@business heading", refs: { "@business": {} } }) },
			]);
			const credentialDispatches = { fetches: 0, redeems: 0 };
			runtime.authTokenRetrieval = authTokenPort(
				cdp.origin,
				credentialDispatches,
			);
			runtime.runbookAuthTransport = () => cdp.transport;
			let proofDispatches = 0;
			runtime.runbookAuthenticatedStateProof = async ({ target_id }) => {
				proofDispatches += 1;
				return {
					proven: true,
					proof: {
						target_id,
						page_id: "page-authenticated",
						frame_id: "frame-auth",
						origin: cdp.origin,
						subject_reference: "subject-fixture",
						account_reference: "account-fixture",
						tenant_reference: "tenant-fixture",
						identity_basis_digest: "identity-basis-fixture",
					},
				};
			};

			const result = await runForTest(
				[
					"runbook", "run",
					"--service", "fixture-auth",
					"--flow", "business-after-login",
					"--handoff", handoffPath,
					"--tab", "t1",
					"--json",
				],
				runtime,
			);
			expect(result.exitCode).toBe(0);
			const data = parseJson(result.stdout).data as Record<string, unknown>;
			const run = data.run as Record<string, unknown>;
			expect(run.run_id).toBe(runId);
			expect(run.handoff_evidence_id).toBeDefined();
			expect(run.state).toBe("confirmed");
			expect(calls.filter((call) => call.includes("snapshot"))).toHaveLength(1);
			expect(credentialDispatches).toEqual({ fetches: 2, redeems: 2 });
			expect(proofDispatches).toBe(1);
			const durable = await loadSharedRun(store.deps, runId);
			expect(durable.ok).toBe(true);
			if (durable.ok) {
				expect(durable.run.run_id).toBe(runId);
				expect(durable.run.state).toBe("confirmed");
			}
		} finally {
			cdp.transport.close();
		}
	});

	test("neutral auth target bootstraps once before proof, then retains the business open", async () => {
		const cdp = startAuthCdpFixture({ initial: "neutral" });
		try {
			const store = await makeStore();
			seedRunbook(store.dataRoot, authContextOpenRunbook(cdp.origin));
			const runId = "run-runbook-auth-neutral";
			const handoffPath = writeHandoff(store.base, "agent-browser", runId);
			const loginUrl = `${cdp.origin}/login`;
			const { runtime, calls } = scriptedRuntime(store.env, [
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: "about:blank" }] }) },
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: loginUrl }] }) },
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: loginUrl }] }) },
				{ stdout: agentSuccess({ selected: true }) },
				{ stdout: agentSuccess({ url: loginUrl }) },
				{ stdout: agentSuccess({ opened: true }) },
				{ stdout: agentSuccess({ url: loginUrl }) },
				{ stdout: agentSuccess({ snapshot: "@business heading", refs: { "@business": {} } }) },
			]);
			runtime.authTokenRetrieval = authTokenPort(cdp.origin);
			runtime.runbookAuthTransport = () => cdp.transport;
			let authenticatedStateProven = false;
			const runCommand = runtime.runCommand;
			runtime.runCommand = async (input) => {
				if (input.args.includes("open") || input.args.includes("snapshot")) {
					expect(authenticatedStateProven).toBe(true);
				}
				return await runCommand(input);
			};
			runtime.runbookAuthenticatedStateProof = async ({ target_id }) => {
				authenticatedStateProven = true;
				return {
					proven: true,
					proof: {
						target_id,
						page_id: "page-authenticated",
						frame_id: "frame-auth",
						origin: cdp.origin,
						subject_reference: "subject-fixture",
						account_reference: "account-fixture",
						tenant_reference: "tenant-fixture",
						identity_basis_digest: "identity-basis-fixture",
					},
				};
			};

			const result = await runForTest(
				[
					"runbook", "run",
					"--service", "fixture-auth",
					"--flow", "business-after-login",
					"--handoff", handoffPath,
					"--tab", "t1",
					"--json",
				],
				runtime,
			);

			expect(result.exitCode).toBe(0);
			expect(cdp.navigations).toEqual([loginUrl]);
			expect(cdp.attachedTargetIds).not.toContain("t1");
			expect(cdp.attachedTargetIds).toContain(cdp.cdpTargetId);
			expect(calls.filter((call) => call.includes("open"))).toHaveLength(1);
			expect(calls.filter((call) => call.includes("snapshot"))).toHaveLength(1);
			const run = (parseJson(result.stdout).data as { run: { state: string } }).run;
			expect(run.state).toBe("confirmed");
		} finally {
			cdp.transport.close();
		}
	});

	test("ambiguous signed-in words yield one attestation continuation and zero business dispatch", async () => {
		const cdp = startAuthCdpFixture({ initial: "ambiguous" });
		try {
			const store = await makeStore();
			seedRunbook(store.dataRoot, authContextRunbook(cdp.origin));
			const runId = "run-runbook-auth-ambiguous";
			const handoffPath = writeHandoff(store.base, "agent-browser", runId);
			const { runtime, calls } = scriptedRuntime(store.env, [
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
				{ stdout: agentSuccess({ selected: true }) },
			]);
			runtime.authTokenRetrieval = authTokenPort(cdp.origin);
			runtime.runbookAuthTransport = () => cdp.transport;
			runtime.runbookAuthenticatedStateProof = async () => ({
				proven: false,
				cause: "human-identity-attestation-required",
			});

			const result = await runForTest(
				[
					"runbook", "run",
					"--service", "fixture-auth",
					"--flow", "business-after-login",
					"--handoff", handoffPath,
					"--tab", "t1",
					"--json",
				],
				runtime,
			);

			expect(result.exitCode).toBe(0);
			const parsed = parseJson(result.stdout);
			expect(parsed.continuation).toMatchObject({
				next_action_id: "complete-human-identity-attestation",
			});
			const run = (parsed.data as Record<string, unknown>).run as Record<string, unknown>;
			expect(run.run_id).toBe(runId);
			expect(run.state).toBe("awaiting-user-presence");
			expect(calls.some((call) => call.includes("snapshot"))).toBe(false);
		} finally {
			cdp.transport.close();
		}
	});

	test("unenrolled confidential runbook refusal chains through install-token and status", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, confidentialRunbook());
		const handoffPath = writeHandoff(
			store.base,
			"agent-browser",
			"run-runbook-unenrolled",
		);
		const { runtime } = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
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
			{
				stdout: agentSuccess({
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
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "confidential-login",
				"--handoff", handoffPath,
				"--tab", "t1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "runbook_confidential_native_capability_absent",
		});
		expect(result.stdout).toContain("browser-use auth install-token");
		expect(result.stdout).toContain("browser-use auth status --json");
	});

	test("production-shaped CLI without a proof owner refuses before browser dispatch", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, authContextRunbook("https://fixture.test"));
		const runId = "run-runbook-auth-proof-absent";
		const handoffPath = writeHandoff(store.base, "agent-browser", runId);
		const { runtime, calls } = scriptedRuntime(store.env, []);
		runtime.authTokenRetrieval = authTokenPort("https://fixture.test");

		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "fixture-auth",
				"--flow", "business-after-login",
				"--handoff", handoffPath,
				"--tab", "t1",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "human-identity-attestation-required" },
			continuation: {
				next_action_id: "inspect_task_run_result",
			},
			data: { external_effect: "none" },
		});
		expect(calls).toEqual([]);
		expect((await loadSharedRun(store.deps, runId)).ok).toBe(false);
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

	test("a fresh runbook target failure creates no orphan run", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "agent-browser", "run-runbook-blocked");
		const { runtime } = scriptedRuntime(store.env, [
			{ stdout: agentSuccess({ tabs: [] }) },
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "agent_browser_target_unavailable",
		});
		expect(
			(parseJson(result.stdout).continuation as Record<string, unknown>)
				.next_action_id,
		).toBe("prepare_unique_runbook_target");
		const loaded = await loadSharedRun(store.deps, "run-runbook-blocked");
		expect(loaded.ok).toBe(false);
	});

	test("a target-list transport failure requests a fresh handoff, not tab repair", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(
			store.base,
			"agent-browser",
			"run-runbook-transport",
		);
		const { runtime, calls } = scriptedRuntime(store.env, [
			{
				exitCode: 1,
				stdout: JSON.stringify({
					success: false,
					data: null,
					error: "CDP WebSocket connect failed",
				}),
			},
			{ stdout: agentSuccess({ cdpUrl: "ws://fixture" }) },
			{
				exitCode: 1,
				stdout: JSON.stringify({
					success: false,
					data: null,
					error: "CDP WebSocket connect failed",
				}),
			},
			{ stdout: agentSuccess({ cdpUrl: "ws://fixture" }) },
			{
				exitCode: 1,
				stdout: JSON.stringify({
					success: false,
					data: null,
					error: "CDP WebSocket connect failed",
				}),
			},
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "agent_browser_connection_unstable" },
			continuation: { next_action_id: "refresh_runbook_handoff" },
			data: { external_effect: "none" },
		});
		expect(calls).toHaveLength(5);
		expect(
			(await loadSharedRun(store.deps, "run-runbook-transport")).ok,
		).toBe(false);
	});

	test("multiple automatic runbook targets fail closed before run creation", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(
			store.base,
			"agent-browser",
			"run-runbook-ambiguous",
		);
		const { runtime } = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [
						{ tabId: "t1", type: "page", url: "about:blank" },
						{ tabId: "t2", type: "page", url: "about:blank" },
					],
				}),
			},
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "agent_browser_target_ambiguous",
		});
		const loaded = await loadSharedRun(store.deps, "run-runbook-ambiguous");
		expect(loaded.ok).toBe(false);
	});

	test("a legacy unbound nonterminal run refuses before target resolution", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "agent-browser", "run-runbook-cursor");
		const seed: Omit<BrowserUseSharedRun, "revision"> = {
			run_id: "run-runbook-cursor",
			state: "needs-human",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: "seed-evidence",
			mutation_dispatched: false,
			artifacts: [],
			continuation: {
				next_action_id: "runbook-resume:1",
				summary: "connection dropped after the confirmed open step; resume from step 1.",
			},
		};
		const created = await createSharedRun(store.deps, seed);
		expect(created.ok).toBe(true);
		const { runtime, calls } = scriptedRuntime(store.env, []);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--run", "run-runbook-cursor",
				"--handoff", handoffPath,
				"--tab", "t1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "agent_browser_target_moved" },
			continuation: { next_action_id: "restore_bound_runbook_target" },
			data: { external_effect: "none" },
		});
		expect(calls).toHaveLength(0);
		const loaded = await loadSharedRun(store.deps, seed.run_id);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run.runbook_target_binding).toBeUndefined();
			expect(loaded.run.revision).toBe(1);
		}
	});

	test("mutation-dispatched runbook restart returns unknown effect without browser calls", async () => {
		const store = await makeStore();
		const runId = "run-runbook-mutation-unknown";
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "agent-browser", runId);
		const seed: Omit<BrowserUseSharedRun, "revision"> = {
			run_id: runId,
			state: "running",
			task_intent: "runbook-execution",
			environment_profile: {
				environment: "agent-chrome",
				profile: "default",
			},
			adapter_id: "agent-browser",
			handoff_evidence_id: "seed-evidence",
			mutation_dispatched: true,
			artifacts: [],
		};
		expect((await createSharedRun(store.deps, seed)).ok).toBe(true);
		const { runtime, calls } = scriptedRuntime(store.env, []);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--run", runId,
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "task_run_effect_unknown" },
			data: { external_effect: "unknown" },
			continuation: { next_action_id: "inspect_task_run_result" },
		});
		expect(calls).toEqual([]);
		const durable = await loadSharedRun(store.deps, runId);
		expect(durable.ok).toBe(true);
		if (durable.ok) {
			expect(durable.run).toMatchObject({
				run_id: runId,
				mutation_dispatched: true,
			});
		}
	});

	test("a bound resumed runbook starts at the persisted cursor", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const runId = "run-runbook-bound-cursor";
		const envelope = handoffEnvelope("agent-browser", runId);
		const handoffPath = join(store.base, "handoff-agent-browser.json");
		writeFileSync(handoffPath, JSON.stringify(envelope), "utf-8");
		const parsed = parseHandoffFacts(JSON.stringify(envelope));
		expect(parsed).toMatchObject({ ok: true, kind: "verified" });
		if (!parsed.ok || parsed.kind !== "verified") {
			throw new Error("fixture handoff invalid");
		}
		const targetEnvelopeId = targetEnvelopeIdOf({
			runId,
			mode: "handoff-bound",
			adapter: "agent-browser",
			handoffEvidenceId: parsed.facts.handoffEvidenceId,
		});
		const seed: Omit<BrowserUseSharedRun, "revision"> = {
			run_id: runId,
			state: "needs-human",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: parsed.facts.handoffEvidenceId,
			runbook_target_binding: {
				schema_version: "1",
				mode: "automatic",
				binding_id: candidateIdOf(targetEnvelopeId, [
					"adapter_page_id",
					"t1",
				]),
			},
			runbook_progress: {
				schema_version: "1",
				service_id: "oncore",
				flow_id: "snapshot-verify",
				runbook_version: "2",
				next_step: 1,
				total_steps: 2,
			},
			continuation: {
				next_action_id: "runbook-resume:1",
				summary: "Resume from the first unproven step.",
			},
			mutation_dispatched: false,
			artifacts: [],
		};
		expect((await createSharedRun(store.deps, seed)).ok).toBe(true);
		const { runtime, calls } = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
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
			{
				stdout: agentSuccess({
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
			{ stdout: agentSuccess({ selected: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ snapshot: "@e1 button", refs: { "@e1": {} } }) },
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--run", runId,
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(calls).toHaveLength(5);
		expect(calls.some((call) => call.includes("open"))).toBe(false);
	});

	test("concurrent bound resumes produce one executor dispatch", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const runId = "run-runbook-concurrent";
		const envelope = handoffEnvelope("agent-browser", runId);
		const handoffPath = join(store.base, "handoff-agent-browser-concurrent.json");
		writeFileSync(handoffPath, JSON.stringify(envelope), "utf-8");
		const parsed = parseHandoffFacts(JSON.stringify(envelope));
		if (!parsed.ok || parsed.kind !== "verified") {
			throw new Error("fixture handoff invalid");
		}
		const targetEnvelopeId = targetEnvelopeIdOf({
			runId,
			mode: "handoff-bound",
			adapter: "agent-browser",
			handoffEvidenceId: parsed.facts.handoffEvidenceId,
		});
		expect(
			(
				await createSharedRun(store.deps, {
					run_id: runId,
					state: "needs-human",
					task_intent: "runbook-execution",
					environment_profile: {
						environment: "agent-chrome",
						profile: "default",
					},
					adapter_id: "agent-browser",
					handoff_evidence_id: parsed.facts.handoffEvidenceId,
					runbook_target_binding: {
						schema_version: "1",
						mode: "automatic",
						binding_id: candidateIdOf(targetEnvelopeId, [
							"adapter_page_id",
							"t1",
						]),
					},
					runbook_progress: {
						schema_version: "1",
						service_id: "oncore",
						flow_id: "snapshot-verify",
						runbook_version: "2",
						next_step: 1,
						total_steps: 2,
					},
					continuation: {
						next_action_id: "runbook-resume:1",
						summary: "Resume from the first unproven step.",
					},
					mutation_dispatched: false,
					artifacts: [],
				})
			).ok,
		).toBe(true);
		const calls: Array<readonly string[]> = [];
		let signalFirstSnapshotStarted: (() => void) | undefined;
		const firstSnapshotStarted = new Promise<void>((resolve) => {
			signalFirstSnapshotStarted = resolve;
		});
		let releaseFirstSnapshot: (() => void) | undefined;
		const firstSnapshotMayFinish = new Promise<void>((resolve) => {
			releaseFirstSnapshot = resolve;
		});
		let snapshotInvocationCount = 0;
		const runtime = makeRuntime({
			env: store.env,
			now: () => 1_000,
			platformFs: createDefaultPlatformFs(),
			readTextFile: (path: string) =>
				import("node:fs/promises").then((module) =>
					module.readFile(path, "utf-8"),
				),
			runCommand: async (input) => {
				const semantic = input.args.slice(4);
				calls.push(semantic);
				if (semantic[0] === "snapshot") {
					snapshotInvocationCount += 1;
					if (snapshotInvocationCount === 1) {
						signalFirstSnapshotStarted?.();
						await firstSnapshotMayFinish;
					}
					return {
						exitCode: 0,
						stdout: agentSuccess({ refs: {} }),
						stderr: "",
					};
				}
				const data =
					semantic[0] === "tab" && semantic[1] === "list"
						? {
								tabs: [
									{
										tabId: "t1",
										type: "page",
										url: "https://example.test/",
									},
								],
							}
						: semantic[0] === "get" && semantic[1] === "url"
							? { url: "https://example.test/" }
							: { selected: true };
				return { exitCode: 0, stdout: agentSuccess(data), stderr: "" };
			},
		});
		const argv = [
			"runbook", "run",
			"--service", "oncore",
			"--flow", "snapshot-verify",
			"--run", runId,
			"--handoff", handoffPath,
			"--json",
		] as const;
		const firstResultPromise = runForTest(argv, runtime);
		await firstSnapshotStarted;
		const secondResult = await runForTest(argv, runtime);
		releaseFirstSnapshot?.();
		const firstResult = await firstResultPromise;
		const results = [firstResult, secondResult];
		expect(
			results
				.map((result) => result.exitCode)
				.sort((left, right) => left - right),
		).toEqual([0, 20]);
		expect(calls.filter((call) => call[0] === "snapshot")).toHaveLength(1);
		const loaded = await loadSharedRun(store.deps, runId);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.state).toBe("confirmed");
	});

	test("a confirmed runbook resume is a no-op with no target or auth work", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const runId = "run-runbook-confirmed-noop";
		const handoffPath = writeHandoff(store.base, "agent-browser", runId);
		expect(
			(
				await createSharedRun(store.deps, {
					run_id: runId,
					state: "confirmed",
					task_intent: "runbook-execution",
					environment_profile: {
						environment: "agent-chrome",
						profile: "default",
					},
					adapter_id: "agent-browser",
					handoff_evidence_id: "legacy-confirmed-evidence",
					mutation_dispatched: false,
					artifacts: [],
				})
			).ok,
		).toBe(true);
		const { runtime, calls } = scriptedRuntime(store.env, []);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--run", runId,
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout)).toMatchObject({
			data: {
				run: { state: "confirmed" },
				external_effect: "none",
				executed_steps: 0,
				resume: "confirmed-no-op",
			},
		});
		expect(calls).toHaveLength(0);
		const loaded = await loadSharedRun(store.deps, runId);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.revision).toBe(1);
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

// =========================================================================
// Internal envelope mint (design brief D4,
// docs/plans/2026-07-27-agent-first-front-door-brief.md): a fresh
// `task run --intent` / `runbook run` without --handoff mints the Verified
// Handoff Envelope in-process through the runtime's mintHandoff seam and flows
// through the SAME parseHandoffFacts validation as a caller-supplied file.
// A mint failure is browser-connect's failure envelope surfaced VERBATIM.
// =========================================================================

describe("task run — internal envelope mint (D4)", () => {
	test("a fresh --intent run without --handoff mints for the intent's preferred adapter and confirms", async () => {
		const store = await makeStore();
		const scripted = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeConsole() },
			{ stdout: chromeNetwork() },
		]);
		const mintCalls: Array<{ adapterId: string; runId?: string }> = [];
		scripted.runtime.mintHandoff = async (input) => {
			mintCalls.push(input);
			return {
				exitCode: 0,
				stdout: JSON.stringify(
					handoffEnvelope(input.adapterId, input.runId ?? "run-minted"),
				),
				stderr: "",
			};
		};
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			scripted.runtime,
		);
		expect(result.exitCode).toBe(0);
		// debug's preferred lane is chrome-devtools-mcp; the mint attached it.
		expect(mintCalls).toHaveLength(1);
		expect(mintCalls[0]?.adapterId).toBe("chrome-devtools-mcp");
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.selected_lane).toBe("chrome-devtools-mcp");
		const run = data.run as Record<string, unknown>;
		expect(run.state).toBe("confirmed");
		// The minted envelope's run id became the durable shared run id.
		expect(run.run_id).toBe(mintCalls[0]?.runId);
	});

	test("a mint failure surfaces browser-connect's failure envelope verbatim with its exit code", async () => {
		const store = await makeStore();
		const scripted = scriptedRuntime(store.env, []);
		const failureEnvelope = JSON.stringify({
			status: "error",
			data: { outcome: "failed", failure_class: "environment-unavailable" },
			continuation: { next_action_id: "inspect_agent_chrome" },
		});
		const failureStderr =
			"Repair Path: runtime/browser-connect/REPAIR.md#v1-inspect_agent_chrome\n";
		scripted.runtime.mintHandoff = async () => ({
			exitCode: 20,
			stdout: failureEnvelope,
			stderr: failureStderr,
		});
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			scripted.runtime,
		);
		expect(result.exitCode).toBe(20);
		// Verbatim passthrough: browser-use never re-wraps the connect failure.
		expect(result.stdout).toBe(failureEnvelope);
		expect(result.stderr).toBe(failureStderr);
		// Fail closed: no adapter call, no run created.
		expect(scripted.calls).toHaveLength(0);
	});

	test("--handoff still wins over the mint (advanced caller-managed path)", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-managed-1");
		const scripted = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeConsole() },
			{ stdout: chromeNetwork() },
		]);
		let minted = false;
		scripted.runtime.mintHandoff = async () => {
			minted = true;
			throw new Error("mint must not run when --handoff is supplied");
		};
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			scripted.runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(minted).toBe(false);
	});

	test("runbook run without --handoff mints for the agent-browser lane", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const scripted = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "about:blank",
						},
					],
				}),
			},
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "about:blank",
						},
					],
				}),
			},
			{ stdout: agentSuccess({ selected: true }) },
			{ stdout: agentSuccess({ url: "about:blank" }) },
			{ stdout: agentSuccess({ opened: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ snapshot: "- page snapshot" }) },
		]);
		const mintCalls: Array<{ adapterId: string; runId?: string }> = [];
		scripted.runtime.mintHandoff = async (input) => {
			mintCalls.push(input);
			return {
				exitCode: 0,
				stdout: JSON.stringify(
					handoffEnvelope(input.adapterId, input.runId ?? "run-minted-rb"),
				),
				stderr: "",
			};
		};
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--json",
			],
			scripted.runtime,
		);
		expect(mintCalls).toHaveLength(1);
		expect(mintCalls[0]?.adapterId).toBe("agent-browser");
		expect(result.exitCode).toBe(0);
		const payload = parseJson(result.stdout) as {
			data?: {
				run?: {
					state?: string;
					runbook_target_binding?: unknown;
					runbook_target?: {
						bound?: boolean;
						mode?: string;
						schema_version?: string;
					};
					runbook_progress?: { next_step?: number };
				};
			};
		};
		expect(payload.data?.run?.state).toBe("confirmed");
		expect(payload.data?.run?.runbook_target_binding).toBeUndefined();
		expect(payload.data?.run?.runbook_target).toEqual({
			bound: true,
			mode: "automatic",
			schema_version: "1",
		});
		expect(payload.data?.run?.runbook_progress?.next_step).toBe(2);
		expect(result.stdout).not.toContain("target_candidate_id");
		expect(result.stdout).not.toContain("binding_id");
		const plain = await runForTest(
			[
				"run", "status",
				"--run", mintCalls[0]?.runId ?? "",
				"--plain",
			],
			makeRuntime({
				env: store.env,
				platformFs: createDefaultPlatformFs(),
			}),
		);
		expect(plain.exitCode).toBe(0);
		expect(plain.stdout).toContain(
			"target_bound=true target_mode=automatic target_schema=1",
		);
		expect(plain.stdout).not.toContain("binding_id");
		expect(plain.stdout).not.toContain("target_candidate_id");
		expect(scripted.calls.map((call) => call.slice(5))).toEqual([
			["tab", "list", "--json"],
			["tab", "list", "--json"],
			["tab", "t1", "--json"],
			["get", "url", "--json"],
			["open", "https://example.test/", "--json"],
			["get", "url", "--json"],
			["snapshot", "-i", "--json"],
		]);
	});
});
