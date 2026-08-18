import { afterAll, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
import { writeArtifactManifest } from "./browser-use-retention";
import type { BrowserUseSharedRun } from "./browser-use-run-model";
import {
	type RunStoreDeps,
	createSharedRun,
	loadSharedRun,
} from "./browser-use-runs";

// =========================================================================
// U2 process-boundary proof (ledger V4, AE15): a fresh agent process in a
// NEUTRAL empty working directory discovers and drives shared runs through
// JSON alone. The store is seeded through the U2 library seams in-process,
// then the REAL browser-use CLI entry is spawned with an env carrying ONLY
// temp XDG roots + HOME — no repo cwd, no inherited environment — and every
// store-backed command must parse, carry its exactly-one continuation, and
// project the same durable truth the library wrote. Mirrors
// browser-connect-process-boundary.test.ts: fakes must match real output
// shape, so the spawn is the proof, not a captured fixture.
// =========================================================================

const BROWSER_USE_CLI = join(
	dirname(fileURLToPath(import.meta.url)),
	"browser-use.ts",
);
const SPAWN_TIMEOUT_MS = 15_000;
// Bun test deadline sits above the child kill timer so a slow shutdown still
// has room for child.exited to settle and stdout to drain.
const TEST_TIMEOUT_MS = SPAWN_TIMEOUT_MS + 10_000;

const xdg = makeTempXdgEnv();
const playwrightXdg = makeTempXdgEnv();
// The neutral CWD: an empty directory unrelated to the repo or the store.
const neutralCwd = mkdtempSync(join(tmpdir(), "browser-use-neutral-"));
mkdirSync(neutralCwd, { recursive: true });

const targetProofServer = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request, server) {
		return server.upgrade(request)
			? undefined
			: new Response("upgrade required", { status: 426 });
	},
	websocket: {
		message(socket, rawMessage) {
			const text =
				typeof rawMessage === "string"
					? rawMessage
					: new TextDecoder().decode(rawMessage);
			const request = JSON.parse(text) as { id: number; method: string };
			const result =
				request.method === "Target.getTargets"
					? {
						targetInfos: [
							{
								targetId: "cdp-target-playwright-process",
								type: "page",
								url: "https://example.test/account",
							},
						],
					}
					: {};
			socket.send(JSON.stringify({ id: request.id, result }));
		},
	},
});

afterAll(() => {
	targetProofServer.stop(true);
	xdg.dispose();
	playwrightXdg.dispose();
	rmSync(neutralCwd, { recursive: true, force: true });
});

async function seededDeps(): Promise<RunStoreDeps> {
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return { fs, paths: opened.paths, clock: fixedClock().now };
}

const CONTINUATION = {
	next_action_id: "prepare_auth_binding",
	summary: "Prepare the credential binding, then resume this run.",
};

async function seedStore(): Promise<void> {
	const deps = await seededDeps();
	const blocked: Omit<BrowserUseSharedRun, "revision"> = {
		run_id: "run-blocked",
		state: "awaiting-auth",
		task_intent: "runbook-execution",
		environment_profile: { environment: "agent-chrome", profile: "default" },
		mutation_dispatched: false,
		artifacts: [],
		continuation: CONTINUATION,
	};
	const dispatched: Omit<BrowserUseSharedRun, "revision"> = {
		run_id: "run-live",
		state: "running",
		task_intent: "runbook-execution",
		environment_profile: { environment: "agent-chrome", profile: "default" },
		adapter_id: "chrome-devtools-mcp",
		mutation_dispatched: true,
		artifacts: [],
	};
	for (const run of [blocked, dispatched]) {
		const created = await createSharedRun(deps, run);
		if (!created.ok) throw new Error(`seed create failed: ${created.code}`);
	}
	// One present artifact so the listing carries a real row. The content hash
	// matches the durable bytes (readArtifactStatus verifies it).
	const bytesPath = join(
		deps.paths.state.artifactDir("run-blocked"),
		"art-evidence",
	);
	await deps.fs.mkdir(dirname(bytesPath), { recursive: true, mode: 0o700 });
	await deps.fs.writeFileDurable(bytesPath, "evidence-bytes", 0o600);
	const manifest = await writeArtifactManifest(deps, {
		artifact_id: "art-evidence",
		run_id: "run-blocked",
		task_intent: "runbook-execution",
		adapter_id: "chrome-devtools-mcp",
		adapter_version: "1.0.0",
		sanitized_target: { origin: "https://example.test" },
		producer_capability: "snapshot_refs",
		content_hash: new Bun.CryptoHasher("sha256")
			.update("evidence-bytes")
			.digest("hex"),
		sensitivity: "high",
		retention: "failure-evidence",
		outcome_ref: null,
		created_at_epoch_ms: 1_000,
		export_receipt: null,
	});
	if (!manifest.ok) throw new Error(`seed manifest failed: ${manifest.code}`);
}

const seeded = seedStore();

async function spawnBrowserUse(
	args: readonly string[],
	env = xdg.env,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	await seeded;
	const child = Bun.spawn([process.execPath, BROWSER_USE_CLI, ...args], {
		cwd: neutralCwd,
		// ONLY the temp XDG roots + HOME: the neutral process inherits nothing.
		env: {
			HOME: env.HOME,
			XDG_CONFIG_HOME: env.XDG_CONFIG_HOME,
			XDG_DATA_HOME: env.XDG_DATA_HOME,
			XDG_STATE_HOME: env.XDG_STATE_HOME,
			XDG_CACHE_HOME: env.XDG_CACHE_HOME,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const timeout = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	clearTimeout(timeout);
	return { exitCode, stdout, stderr };
}

function parse(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout) as Record<string, unknown>;
}

function agentSemanticArgs(args: string[]): string[] {
	const pinIndex = args.indexOf("--pin-tab");
	return pinIndex >= 0 ? args.slice(pinIndex + 1) : args.slice(4);
}

describe("U2 process-boundary proof — neutral CWD, JSON-only discovery (V4/AE15)", () => {
	test("Runbook authoring schema is discoverable from a neutral process", async () => {
		const result = await spawnBrowserUse(["runbook", "schema", "--json"]);
		expect(result).toMatchObject({ exitCode: 0, stderr: "" });
		expect(parse(result.stdout)).toMatchObject({
			status: "ok",
			data: {
				contract_id: "browser-use.runbook-authoring",
				schema_version: "1",
				command: "runbook-schema",
				result: {
					model_owner: "parseRunbookRecord + validateRunbook",
					document_contract: "browser-use.runbook",
				},
			},
		});
	}, TEST_TIMEOUT_MS);

	test("Reviewed Action schema is discoverable from a neutral process", async () => {
		const result = await spawnBrowserUse(["action", "schema", "--json"]);
		expect(result).toMatchObject({ exitCode: 0, stderr: "" });
		const envelope = parse(result.stdout);
		expect(envelope.status).toBe("ok");
		expect(envelope.data).toMatchObject({ contract_id: "browser-use.reviewed-action-authoring", schema_version: "1", command: "action-schema", result: { wrapper_shape: "async ({ inputs }) => <result>", fields: { origin: { required: true }, effect_class: { derived: true }, input_schema: { required: true }, result_schema: { required: true }, postcondition: { required_for_effect: "mutation" } } } });
	}, TEST_TIMEOUT_MS);

	test(
		"run status lists receipts with each blocked run's continuation",
		async () => {
			const result = await spawnBrowserUse(["run", "status", "--json"]);
			expect(result.exitCode).toBe(0);
			const envelope = parse(result.stdout);
			const data = envelope.data as Record<string, unknown>;
			expect(data.contract).toBe("browser-use.shared-run");
			const receipts = data.receipts as Array<Record<string, unknown>>;
			expect(receipts.map((receipt) => receipt.run_id)).toEqual([
				"run-blocked",
				"run-live",
			]);
			expect(receipts[0]?.summary).toContain("next: prepare_auth_binding");
			expect(
				(envelope.continuation as Record<string, unknown>).next_action_id,
			).toBe("inspect_shared_run");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"run status --run projects the seeded run without the auth fragment",
		async () => {
			const result = await spawnBrowserUse([
				"run",
				"status",
				"--run",
				"run-blocked",
				"--json",
			]);
			expect(result.exitCode).toBe(0);
			const envelope = parse(result.stdout);
			const data = envelope.data as Record<string, unknown>;
			expect(data.schema_version).toBe("2");
			const run = data.run as Record<string, unknown>;
			expect(run).toMatchObject({
				run_id: "run-blocked",
				revision: 1,
				state: "awaiting-auth",
				continuation: CONTINUATION,
			});
			expect(result.stdout).not.toContain("auth_fragment");
			expect(
				(envelope.continuation as Record<string, unknown>).next_action_id,
			).toBe("resume_shared_run");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"run status defaults to the plain operator projection at the boundary",
		async () => {
			const result = await spawnBrowserUse(["run", "status"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain(
				"contract=browser-use.shared-run schema=2",
			);
			expect(result.stdout).toContain("run_id=run-blocked");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"run resume re-emits the blocked run plus its exactly-one continuation",
		async () => {
			const result = await spawnBrowserUse([
				"run",
				"resume",
				"--run",
				"run-blocked",
				"--json",
			]);
			expect(result.exitCode).toBe(0);
			const envelope = parse(result.stdout);
			const data = envelope.data as Record<string, unknown>;
			expect(data.resume).toBe("blocked");
			expect(data.continuation).toEqual(CONTINUATION);
			expect(
				(envelope.continuation as Record<string, unknown>).next_action_id,
			).toBe("prepare_auth_binding");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"cancel after possible mutation reports unknown, never rolled back (AE15)",
		async () => {
			const result = await spawnBrowserUse([
				"run",
				"cancel",
				"--run",
				"run-live",
				"--json",
			]);
			expect(result.exitCode).toBe(20);
			const envelope = parse(result.stdout);
			expect(envelope.error).toMatchObject({
				code: "run_cancel_mutation_dispatched",
			});
			expect(
				(envelope.continuation as Record<string, unknown>).next_action_id,
			).toBe("inspect_shared_run");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"artifact list projects the seeded manifest row",
		async () => {
			const result = await spawnBrowserUse(["artifact", "list", "--json"]);
			expect(result.exitCode).toBe(0);
			const envelope = parse(result.stdout);
			const data = envelope.data as Record<string, unknown>;
			expect(data.artifact_count).toBe(1);
			const rows = data.artifacts as Array<Record<string, unknown>>;
			expect(rows[0]).toMatchObject({
				artifact_id: "art-evidence",
				run_id: "run-blocked",
				status: "present",
				retention: "failure-evidence",
			});
			expect(
				(envelope.continuation as Record<string, unknown>).next_action_id,
			).toBe("inspect_shared_run");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"lanes list projects the Adapter Lane Registry through the real process boundary",
		async () => {
			const result = await spawnBrowserUse(["lanes", "list", "--json"]);
			expect(result.exitCode).toBe(0);
			const envelope = parse(result.stdout);
			const data = envelope.data as Record<string, unknown>;
			expect(data.contract).toBe("browser-use.adapter-lanes");
			const lanes = data.lanes as Array<Record<string, unknown>>;
			expect(lanes.map((lane) => lane.lane_id)).toEqual([
				"chrome-devtools-mcp",
				"agent-browser",
				"playwright-cdp",
			]);
			// The neutral process advertises nothing it cannot prove: no auth
			// method and no task claim without registered evidence (auth plan U1).
			for (const lane of lanes) {
				expect(lane.advertised_auth_methods).toEqual([]);
				expect(lane.proven_task_claims).toEqual([]);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"lanes show fails closed on a rejected identity alias at the process boundary",
		async () => {
			const result = await spawnBrowserUse([
				"lanes",
				"show",
				"--adapter",
				"playwright-cli",
				"--json",
			]);
			expect(result.exitCode).toBe(20);
			const envelope = parse(result.stdout);
			expect((envelope.error as Record<string, unknown>).code).toBe(
				"browser_lane_alias_rejected",
			);
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"runbook omission resolves one neutral tab across the real process boundary",
		async () => {
			const dataHome = xdg.env.XDG_DATA_HOME;
			if (dataHome === undefined) throw new Error("test data root missing");
			const runbookDir = join(
				dataHome,
				"browser-use",
				"runbooks",
				"oncore",
				"snapshot-verify",
			);
			mkdirSync(runbookDir, { recursive: true, mode: 0o700 });
			writeFileSync(
				join(runbookDir, "runbook.json"),
				JSON.stringify({
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
							postcondition: {
								kind: "url-equals",
								url: "https://example.test/",
							},
						},
						{ kind: "snapshot", interactive: true },
					],
				}),
				"utf8",
			);
			const fakeAgent = join(neutralCwd, "agent-browser-fixture");
			const callLog = join(neutralCwd, "agent-browser-calls.jsonl");
			const pageState = join(neutralCwd, "agent-browser-page-state");
			const handoffPath = join(neutralCwd, "agent-browser-handoff.json");
			writeFileSync(
				fakeAgent,
				[
					`#!${process.execPath}`,
					'import { appendFileSync, existsSync, writeFileSync } from "node:fs";',
					`const log = ${JSON.stringify(callLog)};`,
					`const state = ${JSON.stringify(pageState)};`,
					"const args = process.argv.slice(2);",
					'appendFileSync(log, `${JSON.stringify(args)}\\n`);',
					'let data = {};',
					'if (args.includes("close")) data = { closed: true };',
					'else if (args[0] === "session" && args[1] === "list") data = { sessions: [] };',
					'else if (args.includes("tab") && args.includes("list")) data = { tabs: [{ tabId: "t1", targetId: "cdp-target-t1", type: "page", active: true, url: existsSync(state) ? "https://example.test/" : "about:blank" }] };',
					'else if (args.includes("tab")) data = { selected: true };',
					'else if (args.includes("open")) { writeFileSync(state, "opened"); data = { opened: true }; }',
					'else if (args.includes("get") && args.includes("url")) data = { url: existsSync(state) ? "https://example.test/" : "about:blank" };',
					'else if (args.includes("snapshot")) data = { refs: {} };',
					'process.stdout.write(JSON.stringify({ success: true, data, error: null }));',
				].join("\n"),
				"utf8",
			);
			chmodSync(fakeAgent, 0o755);
			writeFileSync(
				handoffPath,
				JSON.stringify({
					status: "ok",
						run_id: "run-runbook-process",
					data: {
						outcome: "verified",
						environment: { name: "agent-chrome", profile: "default" },
						browser_entry_mode: "explicit-cdp",
						attachment: {
							adapter_id: "agent-browser",
							route: "explicit-cdp",
							probe_executable: fakeAgent,
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
				}),
				"utf8",
			);

			const result = await spawnBrowserUse([
				"runbook",
				"run",
				"--service",
				"oncore",
				"--flow",
				"snapshot-verify",
				"--handoff",
				handoffPath,
				"--json",
			]);

			expect(result).toMatchObject({ exitCode: 0, stderr: "" });
			const envelope = parse(result.stdout);
			expect(envelope.data).toMatchObject({
				selected_lane: "agent-browser",
				external_effect: "none",
				run: {
					run_id: "run-runbook-process",
					state: "confirmed",
					runbook_progress: { next_step: 2, total_steps: 2 },
				},
			});
			expect(JSON.stringify(envelope)).not.toContain(
				"runbook_target_binding",
			);
			const calls = readFileSync(callLog, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as string[]);
			expect(calls.map(agentSemanticArgs)).toEqual([
				["tab", "list", "--json"],
				[],
				[],
				["tab", "list", "--json"],
				["tab", "cdp-target-t1", "--json"],
				["get", "url", "--json"],
				["open", "https://example.test/", "--json"],
				["get", "url", "--json"],
				["snapshot", "-i", "--json"],
				[],
				[],
			]);
			expect(calls.filter((call) => call.includes("close"))).toHaveLength(2);
			expect(calls.slice(-2)).toEqual([
				[
					"--session",
					"browser-use-run-runbook-process",
					"close",
					"--json",
				],
				["session", "list", "--json"],
			]);
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"runbook omission reports zero and multiple targets before run creation",
		async () => {
			const dataHome = xdg.env.XDG_DATA_HOME;
			if (dataHome === undefined) throw new Error("test data root missing");
			const deps = await seededDeps();
			for (const scenario of [
				{
					name: "zero",
					runId: "run-runbook-process-zero",
					tabs: [],
					code: "agent_browser_target_unavailable",
				},
				{
					name: "multiple",
					runId: "run-runbook-process-multiple",
					tabs: [
						{ tabId: "t1", type: "page", url: "about:blank" },
						{ tabId: "t2", type: "page", url: "about:blank" },
					],
					code: "agent_browser_target_ambiguous",
				},
			] as const) {
				const flowId = `snapshot-${scenario.name}`;
				const runbookDir = join(
					dataHome,
					"browser-use",
					"runbooks",
					"oncore",
					flowId,
				);
				mkdirSync(runbookDir, { recursive: true, mode: 0o700 });
				writeFileSync(
					join(runbookDir, "runbook.json"),
					JSON.stringify({
						contract: "browser-use.runbook",
						schema_version: "2",
						service_id: "oncore",
						flow_id: flowId,
						flow_name: `verify-${scenario.name}`,
						version: "2",
						summary: "Target cardinality process proof.",
						allowed_origins: ["https://example.test"],
						inputs: [],
						steps: [
							{
								kind: "open",
								url: "https://example.test/",
								postcondition: {
									kind: "url-equals",
									url: "https://example.test/",
								},
							},
						],
					}),
					"utf8",
				);
				const fakeAgent = join(
					neutralCwd,
					`agent-browser-${scenario.name}-fixture`,
				);
				const callLog = join(
					neutralCwd,
					`agent-browser-${scenario.name}-calls.jsonl`,
				);
				const handoffPath = join(
					neutralCwd,
					`agent-browser-${scenario.name}-handoff.json`,
				);
				writeFileSync(
					fakeAgent,
					[
						`#!${process.execPath}`,
						'import { appendFileSync } from "node:fs";',
						`const log = ${JSON.stringify(callLog)};`,
						"const args = process.argv.slice(2);",
						'appendFileSync(log, `${JSON.stringify(args)}\\n`);',
						`let data = { tabs: ${JSON.stringify(scenario.tabs)} };`,
						'if (args.includes("close")) data = { closed: true };',
						'else if (args[0] === "session" && args[1] === "list") data = { sessions: [] };',
						'process.stdout.write(JSON.stringify({ success: true, data, error: null }));',
					].join("\n"),
					"utf8",
				);
				chmodSync(fakeAgent, 0o755);
				writeFileSync(
					handoffPath,
					JSON.stringify({
						status: "ok",
						run_id: scenario.runId,
						data: {
							outcome: "verified",
							environment: { name: "agent-chrome", profile: "default" },
							browser_entry_mode: "explicit-cdp",
							attachment: {
								adapter_id: "agent-browser",
								route: "explicit-cdp",
								probe_executable: fakeAgent,
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
					}),
					"utf8",
				);
				const result = await spawnBrowserUse([
					"runbook",
					"run",
					"--service",
					"oncore",
					"--flow",
					flowId,
					"--handoff",
					handoffPath,
					"--json",
				]);
				expect(result.exitCode).toBe(20);
				expect(parse(result.stdout)).toMatchObject({
					data: { external_effect: "none" },
					error: { code: scenario.code },
					continuation: {
						next_action_id: "prepare_unique_runbook_target",
					},
				});
				expect(
					readFileSync(callLog, "utf8")
						.trim()
						.split("\n")
						.map((line) => JSON.parse(line) as string[])
						.map(agentSemanticArgs)
						.filter((args) => args.length > 0),
				).toEqual([["tab", "list", "--json"]]);
				expect((await loadSharedRun(deps, scenario.runId)).ok).toBe(false);
			}
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"Playwright semantic mutation crosses the real process boundary with fresh postcondition truth",
		async () => {
			const fakePlaywright = join(neutralCwd, "playwright-cli-fixture");
			const callLog = join(neutralCwd, "playwright-calls.jsonl");
			const handoffPath = join(neutralCwd, "playwright-handoff.json");
			writeFileSync(
				fakePlaywright,
				[
					`#!${process.execPath}`,
					'import { appendFileSync } from "node:fs";',
					`const log = ${JSON.stringify(callLog)};`,
					"const args = process.argv.slice(2);",
					'appendFileSync(log, `${JSON.stringify(args)}\\n`);',
					'if (args.at(-1) === "snapshot") process.stdout.write(\'### Page\\n- Page URL: https://example.test/account\\n### Snapshot\\n- button "Save" [ref=e7]\\n\');',
					'else if (args.includes("eval")) process.stdout.write("true\\n");',
				].join("\n"),
				"utf8",
			);
			chmodSync(fakePlaywright, 0o755);
			writeFileSync(
				handoffPath,
				JSON.stringify({
					status: "ok",
						run_id: "run-playwright-process",
					data: {
						outcome: "verified",
						environment: { name: "agent-chrome", profile: "default" },
						browser_entry_mode: "explicit-cdp",
						attachment: {
							adapter_id: "playwright-cdp",
							route: "explicit-cdp",
							probe_executable: fakePlaywright,
						},
						endpoint: {
							http: "http://127.0.0.1:9222",
							ws: `ws://127.0.0.1:${targetProofServer.port}/devtools/browser/fixture`,
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
				}),
				"utf8",
			);

			const result = await spawnBrowserUse([
				"task",
				"run",
				"--intent",
				"frontend-test",
				"--handoff",
				handoffPath,
				"--tab",
				"1",
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
			], playwrightXdg.env);

			expect(result).toMatchObject({ exitCode: 0, stderr: "" });
			const envelope = parse(result.stdout);
			expect(envelope.status).toBe("ok");
			expect(envelope.data).toMatchObject({
				selected_lane: "playwright-cdp",
				executed_steps: 6,
				external_effect: "none",
				run: {
					run_id: "run-playwright-process",
					state: "confirmed",
					mutation_dispatched: true,
				},
			});
			const calls = readFileSync(callLog, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as string[]);
			expect(calls.map((args) => args.at(-2))).toContain("click");
			expect(calls.some((args) => args.includes("eval"))).toBe(true);
			expect(calls.at(-1)?.at(-1)).toBe("detach");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"repair status projects roots, the warned runtime fallback, and one next action",
		async () => {
			const result = await spawnBrowserUse(["repair", "status", "--json"]);
			expect(result.exitCode).toBe(0);
			const envelope = parse(result.stdout);
			const data = envelope.data as Record<string, unknown>;
			expect(data.contract).toBe("browser-use.repair-status");
			expect(Object.keys(data.roots as Record<string, unknown>).sort()).toEqual(
				["cache", "config", "data", "runtime", "state"],
			);
			// The spawned env carries no XDG_RUNTIME_DIR: the warned fallback is on.
			expect(data.runtime_fallback).toEqual({
				active: true,
				reason: "runtime_dir_unset",
			});
			expect(typeof data.next_action).toBe("string");
			expect(
				(envelope.continuation as Record<string, unknown>).next_action_id,
			).toBe(data.next_action);
		},
		TEST_TIMEOUT_MS,
	);
});
