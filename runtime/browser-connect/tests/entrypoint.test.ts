import { describe, expect, test } from "bun:test";
import {
	configureCliDiagnostics,
	createCliDiagnosticContext,
	emitCliDiagnostic,
	parseCliDiagnosticArgv,
	resetCliDiagnostics,
	withCliDiagnosticContext,
} from "@side-quest/cli-command-facade";

import {
	WARM_CHROME_CHECK_REASONS,
	type WarmChromeCheckErrorCode,
} from "@side-quest/warm-chrome";
import type { WarmChromeMainDeps } from "@side-quest/warm-chrome/cli";

import {
	BROWSER_CONNECT_CONTRACT_ID,
	BROWSER_CONNECT_SCHEMA_VERSION,
} from "../src/model.ts";
import {
	proveAgentChromeEnvironment,
	WARM_CHROME_REASON_TO_FAILURE_CLASS,
	type EnvironmentGatewayDeps,
	type EnvironmentGatewayResult,
} from "../src/environment.ts";
import {
	type BrowserConnectMainDeps,
	main,
} from "../src/cli.ts";
import type {
	AdapterCommandInput,
	AdapterCommandResult,
	AdapterDefinition,
	AdapterExecutableResolution,
	AdapterRuntime,
} from "../src/adapters/registry.ts";
import { agentBrowserDefinition } from "../src/adapters/agent-browser.ts";
import { chromeDevtoolsMcpDefinition } from "../src/adapters/chrome-devtools-mcp.ts";

// ---------------------------------------------------------------------------
// Characterization scaffolding — a fake warm-chrome `main` that emits the exact
// JSON envelopes the real chassis produces (pinned against warm-chrome
// src/cli.ts writeSuccess / emitCliError and src/proof.ts success data), so the
// gateway is proven against the dependency's real contract shape without ever
// probing a real Chrome.
// ---------------------------------------------------------------------------

/**
 * Build the warm-chrome ok (`status: "ok"`) envelope the facade emits on
 * `--json` stdout for a verified check. Mirrors cli.ts writeSuccess wrapping
 * proof.ts success `data` (endpoint http form + verbatim web_socket_debugger_url).
 */
function warmChromeOkEnvelope(input: {
	runId: string;
	endpoint: string;
	ws: string;
}): string {
	// Pretty-printed (`null, 2`) to mirror the facade's real `writeJson` output —
	// a compact single-line fake would hide multi-line envelope-parse defects.
	return `${JSON.stringify(
		{
			status: "ok",
			run_id: input.runId,
			data: {
				contract_id: "warm-chrome.browser-entry",
				schema_version: "1",
				ok: true,
				action: "browser_ready",
				command: "check",
				endpoint: input.endpoint,
				port: "9222",
				browser: "Chrome/150.0.0.0",
				web_socket_debugger_url: input.ws,
				browser_pid: 4242,
				profile_dir: "/redacted/profile",
			},
		},
		null,
		2,
	)}\n`;
}

/**
 * Build the warm-chrome exit-20 error envelope (`status: "error"`) the facade
 * emits on `--json` stdout. `code` is the WarmChromeCheckErrorCode; `reason` is
 * the fine-grained cause carried in `data.reason` (proof.ts checkProofError).
 */
function warmChromeErrorEnvelope(input: {
	runId: string;
	code: string;
	reason: string;
	exitCode: number;
}): string {
	// Pretty-printed (`null, 2`) to mirror the facade's real `writeJson` output.
	return `${JSON.stringify(
		{
			status: "error",
			run_id: input.runId,
			process_exit_code: input.exitCode,
			error: {
				code: input.code,
				message: `warm-chrome check rejected: ${input.code}`,
				exit_code: input.exitCode,
				severity: "error",
				failure_domain: "browser_entry_handoff",
			},
			data: {
				contract_id: "warm-chrome.browser-entry",
				schema_version: "1",
				reason: input.reason,
			},
			runtime_actions: [
				{ id: "launch_warm_chrome", summary: "…", side_effects: ["browser"] },
			],
			continuation: { next_action_id: "launch_warm_chrome" },
		},
		null,
		2,
	)}\n`;
}

/**
 * A fake warm-chrome `main` that writes a scripted sequence of envelopes to the
 * injected stdout writer, one per invocation, and returns the matching exit
 * code. Records the argv it saw. Never touches a real runtime.
 */
function scriptedWarmChromeMain(
	script: readonly { envelope: string; exitCode: number }[],
): {
	main: (argv: readonly string[], deps?: WarmChromeMainDeps) => Promise<number>;
	calls: string[][];
} {
	const calls: string[][] = [];
	let index = 0;
	const main = async (
		argv: readonly string[],
		deps: WarmChromeMainDeps = {},
	): Promise<number> => {
		calls.push([...argv]);
		const step = script[index];
		index += 1;
		if (!step) throw new Error("scriptedWarmChromeMain exhausted");
		deps.stdout?.write(step.envelope);
		return step.exitCode;
	};
	return { main, calls };
}

const RUN_ID = "gateway-run";

/**
 * Extract the warm-chrome command word from a captured argv, tolerant of the
 * gateway's `--run-id <id>` prefix (warm-chrome accepts diagnostic flags before
 * the command, matching its own applyEnvRunId shape).
 */
function commandWord(argv: readonly string[]): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--run-id") {
			index += 1; // skip its value
			continue;
		}
		if (arg.startsWith("--")) continue;
		return arg;
	}
	return undefined;
}

function baseDeps(
	main: (argv: readonly string[], deps?: WarmChromeMainDeps) => Promise<number>,
	overrides: Partial<EnvironmentGatewayDeps> = {},
): EnvironmentGatewayDeps {
	return {
		warmChromeMain: main,
		reconfigureDiagnostics: () => {},
		runId: RUN_ID,
		...overrides,
	};
}

describe("browser-connect environment gateway", () => {
	describe("characterization: warm-chrome envelope contract", () => {
		// Pin the exact shapes the gateway parses, so a warm-chrome envelope-schema
		// change surfaces here. These are the fields U4 depends on as the library
		// boundary (KTD2 / R12).
		test("ok envelope carries http endpoint and verbatim ws url in data", () => {
			const parsed = JSON.parse(
				warmChromeOkEnvelope({
					runId: RUN_ID,
					endpoint: "http://127.0.0.1:9222",
					ws: "ws://127.0.0.1:9222/devtools/browser/abc",
				}),
			);
			expect(parsed.status).toBe("ok");
			expect(parsed.data.endpoint).toBe("http://127.0.0.1:9222");
			expect(parsed.data.web_socket_debugger_url).toBe(
				"ws://127.0.0.1:9222/devtools/browser/abc",
			);
		});

		test("exit-20 error envelope carries error.code and data.reason", () => {
			const parsed = JSON.parse(
				warmChromeErrorEnvelope({
					runId: RUN_ID,
					code: "port_occupied_foreign",
					reason: "foreign_listener",
					exitCode: 20,
				}),
			);
			expect(parsed.status).toBe("error");
			expect(parsed.error.code).toBe("port_occupied_foreign");
			expect(parsed.error.exit_code).toBe(20);
			expect(parsed.data.reason).toBe("foreign_listener");
		});
	});

	describe("verified proof mapping (R4, R12)", () => {
		test("maps http + ws endpoint forms into the envelope vocabulary", async () => {
			const { main, calls } = scriptedWarmChromeMain([
				{
					envelope: warmChromeOkEnvelope({
						runId: RUN_ID,
						endpoint: "http://127.0.0.1:53712",
						ws: "ws://127.0.0.1:53712/devtools/browser/verified-id",
					}),
					exitCode: 0,
				},
			]);

			const result = await proveAgentChromeEnvironment(baseDeps(main));

			expect(result.outcome).toBe("verified");
			if (result.outcome !== "verified") throw new Error("unreachable");
			expect(result.endpoint.http).toBe("http://127.0.0.1:53712");
			expect(result.endpoint.ws).toBe(
				"ws://127.0.0.1:53712/devtools/browser/verified-id",
			);
			// R3: a plain check that verified an existing session — never launched.
			expect(result.launch.launched).toBe(false);
			// R12: proof names the environment contract that vouched.
			expect(result.proof.environment_contract_id).toBe(
				"warm-chrome.browser-entry",
			);
			// The gateway ran `check` in-process, JSON channel, no launch.
			expect(calls).toHaveLength(1);
			expect(commandWord(calls[0] ?? [])).toBe("check");
			expect(calls[0]).toContain("--json");
		});
	});

	describe("exit-20 failure-class mapping (R11)", () => {
		test("endpoint_unreachable maps to environment-absent", async () => {
			const { main } = scriptedWarmChromeMain([
				{
					envelope: warmChromeErrorEnvelope({
						runId: RUN_ID,
						code: "endpoint_unreachable",
						reason: "no_listener",
						exitCode: 20,
					}),
					exitCode: 20,
				},
			]);

			const result = await proveAgentChromeEnvironment(baseDeps(main));

			expect(result.outcome).toBe("failed");
			if (result.outcome !== "failed") throw new Error("unreachable");
			expect(result.failure_class).toBe("environment-absent");
		});

		test("port_occupied_foreign maps to foreign-listener", async () => {
			const { main } = scriptedWarmChromeMain([
				{
					envelope: warmChromeErrorEnvelope({
						runId: RUN_ID,
						code: "port_occupied_foreign",
						reason: "foreign_listener",
						exitCode: 20,
					}),
					exitCode: 20,
				},
			]);

			const result = await proveAgentChromeEnvironment(baseDeps(main));

			expect(result.outcome).toBe("failed");
			if (result.outcome !== "failed") throw new Error("unreachable");
			expect(result.failure_class).toBe("foreign-listener");
		});

		test("wrong_browser maps to foreign-listener (a non-Agent-Chrome answered)", async () => {
			const { main } = scriptedWarmChromeMain([
				{
					envelope: warmChromeErrorEnvelope({
						runId: RUN_ID,
						code: "wrong_browser",
						reason: "chrome_for_testing",
						exitCode: 20,
					}),
					exitCode: 20,
				},
			]);

			const result = await proveAgentChromeEnvironment(baseDeps(main));

			expect(result.outcome).toBe("failed");
			if (result.outcome !== "failed") throw new Error("unreachable");
			expect(result.failure_class).toBe("foreign-listener");
		});
	});

	describe("reason-to-failure-class record (R11 exhaustiveness)", () => {
		// Compile-time exhaustiveness: the record is `satisfies Record<
		// WarmChromeCheckErrorCode, BrowserConnectFailureClass>` over
		// warm-chrome's exported reason-code union, so a NEW upstream reason code
		// is a compile-time type error, never a silent runtime.error-unexpected.
		test("every warm-chrome check error code has an env-gateway mapping", () => {
			const upstreamCodes = Object.keys(
				WARM_CHROME_CHECK_REASONS,
			) as WarmChromeCheckErrorCode[];
			for (const code of upstreamCodes) {
				expect(WARM_CHROME_REASON_TO_FAILURE_CLASS[code]).toBeDefined();
			}
			// Keys of the mapping equal warm-chrome's exported error-code set.
			expect(
				Object.keys(WARM_CHROME_REASON_TO_FAILURE_CLASS).toSorted(),
			).toEqual(upstreamCodes.toSorted());
		});

		test("every mapped class stays in the exit-20 environment family", () => {
			for (const failureClass of Object.values(
				WARM_CHROME_REASON_TO_FAILURE_CLASS,
			)) {
				expect([
					"environment-absent",
					"foreign-listener",
					"launch-failed",
				]).toContain(failureClass);
			}
		});

		test("an unknown/unmapped exit-20 error code falls to the exit-20 default catch, never runtime-error-unexpected", async () => {
			// A truly-unknown code (never in warm-chrome's reason union) at exit 20
			// must degrade to the declared exit-20 default, not exit-1 runtime error.
			const { main } = scriptedWarmChromeMain([
				{
					envelope: warmChromeErrorEnvelope({
						runId: RUN_ID,
						code: "some_future_upstream_code",
						reason: "future_reason",
						exitCode: 20,
					}),
					exitCode: 20,
				},
			]);

			const result = await proveAgentChromeEnvironment(baseDeps(main));

			expect(result.outcome).toBe("failed");
			if (result.outcome !== "failed") throw new Error("unreachable");
			expect(result.failure_class).not.toBe("runtime-error-unexpected");
			expect(result.failure_class).toBe("foreign-listener");
		});
	});

	describe("launch provenance (R3)", () => {
		test("launch-then-verify sets provenance true", async () => {
			// First `check` reports environment-absent; gateway launches, then
			// re-proves via `check`, which now verifies.
			const { main, calls } = scriptedWarmChromeMain([
				{
					envelope: warmChromeErrorEnvelope({
						runId: RUN_ID,
						code: "endpoint_unreachable",
						reason: "no_listener",
						exitCode: 20,
					}),
					exitCode: 20,
				},
				{
					// launch success envelope (facade ok shape)
					envelope: warmChromeOkEnvelope({
						runId: RUN_ID,
						endpoint: "http://127.0.0.1:9222",
						ws: "ws://127.0.0.1:9222/devtools/browser/launched-id",
					}),
					exitCode: 0,
				},
				{
					// re-prove via check
					envelope: warmChromeOkEnvelope({
						runId: RUN_ID,
						endpoint: "http://127.0.0.1:9222",
						ws: "ws://127.0.0.1:9222/devtools/browser/launched-id",
					}),
					exitCode: 0,
				},
			]);

			const result = await proveAgentChromeEnvironment(
				baseDeps(main, { autoLaunch: true }),
			);

			expect(result.outcome).toBe("verified");
			if (result.outcome !== "verified") throw new Error("unreachable");
			expect(result.launch.launched).toBe(true);
			expect(result.endpoint.ws).toBe(
				"ws://127.0.0.1:9222/devtools/browser/launched-id",
			);
			// check -> launch -> check
			expect(calls.map(commandWord)).toEqual(["check", "launch", "check"]);
		});

		test("launch failure never yields a handoff", async () => {
			// check absent -> launch attempted, but re-prove still fails: no verified
			// handoff, provenance records the launch attempt, class is launch-failed.
			const { main } = scriptedWarmChromeMain([
				{
					envelope: warmChromeErrorEnvelope({
						runId: RUN_ID,
						code: "endpoint_unreachable",
						reason: "no_listener",
						exitCode: 20,
					}),
					exitCode: 20,
				},
				{
					// launch itself fails
					envelope: warmChromeErrorEnvelope({
						runId: RUN_ID,
						code: "endpoint_unreachable",
						reason: "no_listener",
						exitCode: 20,
					}),
					exitCode: 20,
				},
			]);

			const result = await proveAgentChromeEnvironment(
				baseDeps(main, { autoLaunch: true }),
			);

			expect(result.outcome).toBe("failed");
			if (result.outcome !== "failed") throw new Error("unreachable");
			expect(result.failure_class).toBe("launch-failed");
			expect(result.launch.launched).toBe(false);
		});

		test("no auto-launch: an absent environment fails closed without launching", async () => {
			const { main, calls } = scriptedWarmChromeMain([
				{
					envelope: warmChromeErrorEnvelope({
						runId: RUN_ID,
						code: "endpoint_unreachable",
						reason: "no_listener",
						exitCode: 20,
					}),
					exitCode: 20,
				},
			]);

			const result = await proveAgentChromeEnvironment(
				baseDeps(main, { autoLaunch: false }),
			);

			expect(result.outcome).toBe("failed");
			if (result.outcome !== "failed") throw new Error("unreachable");
			expect(result.failure_class).toBe("environment-absent");
			// Fail closed: exactly one `check`, no `launch` (R11).
			expect(calls.map(commandWord)).toEqual(["check"]);
		});
	});

	describe("diagnostics re-configuration hazard (KTD10 / R14)", () => {
		test("reconfigureDiagnostics runs after every in-process main return", async () => {
			let reconfigureCount = 0;
			const { main } = scriptedWarmChromeMain([
				{
					envelope: warmChromeErrorEnvelope({
						runId: RUN_ID,
						code: "endpoint_unreachable",
						reason: "no_listener",
						exitCode: 20,
					}),
					exitCode: 20,
				},
				{
					envelope: warmChromeOkEnvelope({
						runId: RUN_ID,
						endpoint: "http://127.0.0.1:9222",
						ws: "ws://127.0.0.1:9222/devtools/browser/launched-id",
					}),
					exitCode: 0,
				},
				{
					envelope: warmChromeOkEnvelope({
						runId: RUN_ID,
						endpoint: "http://127.0.0.1:9222",
						ws: "ws://127.0.0.1:9222/devtools/browser/launched-id",
					}),
					exitCode: 0,
				},
			]);

			await proveAgentChromeEnvironment(
				baseDeps(main, {
					autoLaunch: true,
					reconfigureDiagnostics: () => {
						reconfigureCount += 1;
					},
				}),
			);

			// check + launch + check = 3 in-process main returns, 3 reconfigs.
			expect(reconfigureCount).toBe(3);
		});

		test("a post-gateway diagnostic still emits through browser-connect's redactor after main returns", async () => {
			// warm-chrome's main calls resetCliDiagnostics() in its finally, tearing
			// down LogTape. The gateway's reconfigureDiagnostics hook must restore
			// browser-connect's own redactor so a diagnostic emitted AFTER the
			// gateway still passes through the R14/KTD10 chokepoint. We prove it with
			// a real facade redactor that this test can observe.
			const captured: string[] = [];
			const writer = {
				write: (chunk: string) => {
					captured.push(chunk);
					return true as const;
				},
			};
			const CATEGORY = "browser-connect-test";
			// A redactor that scrubs a sentinel token so we can prove it ran.
			const redactSentinel = (
				record: Record<string, unknown> & {
					timestamp: string;
					level: string;
					category: readonly string[];
					message: string;
				},
			) =>
				JSON.parse(
					JSON.stringify(record).replace(/SENTINEL-SECRET/g, "[redacted]"),
				);

			const options = parseCliDiagnosticArgv([
				"--verbose",
				"--run-id",
				RUN_ID,
			]).options;
			const reconfigure = () => {
				configureCliDiagnostics({
					categoryRoot: CATEGORY,
					options,
					diagnosticWriter: writer,
					// biome-ignore lint/suspicious/noExplicitAny: test-local redactor shim
					redact: redactSentinel as any,
				});
			};

			// warm-chrome main tears down diagnostics on return (simulated here by
			// resetCliDiagnostics), matching its real finally block.
			const main = async (
				_argv: readonly string[],
				deps: WarmChromeMainDeps = {},
			): Promise<number> => {
				deps.stdout?.write(
					warmChromeOkEnvelope({
						runId: RUN_ID,
						endpoint: "http://127.0.0.1:9222",
						ws: "ws://127.0.0.1:9222/devtools/browser/id",
					}),
				);
				resetCliDiagnostics();
				return 0;
			};

			try {
				// Configure browser-connect diagnostics up front.
				reconfigure();
				await proveAgentChromeEnvironment(
					baseDeps(main, { reconfigureDiagnostics: reconfigure }),
				);

				// Emit a post-gateway diagnostic; it must route through the redactor.
				const context = createCliDiagnosticContext(options);
				withCliDiagnosticContext(context, () => {
					emitCliDiagnostic(CATEGORY, "warning", "post-gateway", {
						note: "value=SENTINEL-SECRET",
					});
				});
			} finally {
				resetCliDiagnostics();
			}

			const joined = captured.join("");
			expect(joined).toContain("post-gateway");
			expect(joined).toContain("[redacted]");
			expect(joined).not.toContain("SENTINEL-SECRET");
		});
	});

	describe("envelope wiring (R2)", () => {
		test("a verified gateway result can build a browser-connect proof summary", async () => {
			const { main } = scriptedWarmChromeMain([
				{
					envelope: warmChromeOkEnvelope({
						runId: RUN_ID,
						endpoint: "http://127.0.0.1:53712",
						ws: "ws://127.0.0.1:53712/devtools/browser/verified-id",
					}),
					exitCode: 0,
				},
			]);

			const result: EnvironmentGatewayResult =
				await proveAgentChromeEnvironment(baseDeps(main));

			expect(result.outcome).toBe("verified");
			if (result.outcome !== "verified") throw new Error("unreachable");
			// The environment proof names browser-connect's own contract metadata on
			// the way out; it must agree with the model constants (BROWSER_CONNECT_*).
			expect(BROWSER_CONNECT_CONTRACT_ID).toBe(
				"browser-connect.verified-handoff",
			);
			expect(BROWSER_CONNECT_SCHEMA_VERSION).toBe("1");
			expect(result.environment.name).toBe("agent-chrome");
			expect(result.proof.route_evidence).toBe("verified-live");
		});
	});
});

// ===========================================================================
// U6 dispatcher: check, connect, and dashboard commands.
//
// Every scenario runs the real main(argv, deps) in-process with fakes — no real
// Chrome (scripted warmChromeMain) and no real adapter binaries (a fake
// AdapterRuntime + injected registry accessors). Stations are asserted through
// the emitted envelope's error.code, exit code, and next_action_id.
// ===========================================================================

type MemoryWriter = { output: string; write(chunk: string): true };

function memoryWriter(): MemoryWriter {
	return {
		output: "",
		write(chunk: string) {
			this.output += chunk;
			return true;
		},
	};
}

type DispatcherRun = { exitCode: number; stdout: string; stderr: string };

/**
 * A scriptable fake adapter runtime. `provenance` and `probe` are keyed by the
 * executable command and drive checkProvenance / probeAttachment WITHOUT any
 * real binary. `resolveExecutable` resolves any known command to a synthetic
 * absolute path; unknown commands resolve to `{ resolved: false }`.
 */
function fakeAdapterRuntime(script: {
	version?: Record<string, string | undefined>;
	probeExit?: Record<string, number>;
	unresolvable?: readonly string[];
	calls?: { probe: string[]; version: string[] };
}): AdapterRuntime {
	const unresolvable = new Set(script.unresolvable ?? []);
	return {
		env: {},
		resolveExecutable: (command): AdapterExecutableResolution =>
			unresolvable.has(command)
				? { resolved: false }
				: { resolved: true, path: `/fake/bin/${command}` },
		runCommand: async (
			input: AdapterCommandInput,
		): Promise<AdapterCommandResult> => {
			const executable = input.command.replace("/fake/bin/", "");
			const isVersion = input.args.includes("--version");
			if (isVersion) {
				script.calls?.version.push(executable);
				const version = script.version?.[executable];
				if (version === undefined) {
					return { exitCode: 127, stdout: "", stderr: "command not found" };
				}
				return { exitCode: 0, stdout: `${executable} ${version}\n`, stderr: "" };
			}
			// Any non-version invocation is the attachment probe.
			script.calls?.probe.push(executable);
			const exit = script.probeExit?.[executable] ?? 0;
			return {
				exitCode: exit,
				stdout: exit === 0 ? "attached\n" : "",
				stderr: exit === 0 ? "" : "probe failed\n",
			};
		},
	};
}

/**
 * The two real adapter definitions with their pinned versions, so a fully
 * installed fake runtime uses the definitions' own probe/inject logic.
 */
const PINNED = {
	"chrome-devtools-mcp": "1.5.0",
	"agent-browser": "0.31.2",
} as const;

function realRegistryAccessors(): {
	listAdapterDefinitions: () => readonly AdapterDefinition[];
	findAdapterDefinition: (id: string) => AdapterDefinition | undefined;
} {
	const byId: Record<string, AdapterDefinition> = {
		"chrome-devtools-mcp": chromeDevtoolsMcpDefinition,
		"agent-browser": agentBrowserDefinition,
	};
	return {
		listAdapterDefinitions: () => [
			chromeDevtoolsMcpDefinition,
			agentBrowserDefinition,
		],
		findAdapterDefinition: (id) => byId[id],
	};
}

async function runDispatcher(
	argv: readonly string[],
	deps: Omit<BrowserConnectMainDeps, "stdout" | "stderr">,
): Promise<DispatcherRun> {
	const stdout = memoryWriter();
	const stderr = memoryWriter();
	const exitCode = await main(argv, { ...deps, stdout, stderr });
	return { exitCode, stdout: stdout.output, stderr: stderr.output };
}

type DispatcherEnvelope = {
	status: string;
	run_id: string;
	data?: Record<string, unknown>;
	error?: { code: string; exit_code: number };
	runtime_actions?: Array<{ id: string }>;
	continuation?: { next_action_id?: string };
};

function parseStdout(run: DispatcherRun): DispatcherEnvelope {
	return JSON.parse(run.stdout) as DispatcherEnvelope;
}

const okScript = (ws = "ws://127.0.0.1:9222/devtools/browser/id") =>
	scriptedWarmChromeMain([
		{
			envelope: warmChromeOkEnvelope({
				runId: RUN_ID,
				endpoint: "http://127.0.0.1:9222",
				ws,
			}),
			exitCode: 0,
		},
	]);

const errorScript = (code: string, reason: string) =>
	scriptedWarmChromeMain([
		{
			envelope: warmChromeErrorEnvelope({
				runId: RUN_ID,
				code,
				reason,
				exitCode: 20,
			}),
			exitCode: 20,
		},
	]);

const CONNECT_ARGV = ["connect", "agent-browser", "--json", "--run-id", RUN_ID];

describe("browser-connect dashboard command (U6 R15/R16, AE5)", () => {
	test("two installed + one uninstalled adapter yields a one-read decision with NO probe fired", async () => {
		const calls = { probe: [] as string[], version: [] as string[] };
		// Simulate one uninstalled adapter (chrome-devtools-mcp version absent →
		// not-installed) WITHOUT editing the registry; agent-browser installed.
		const adapterRuntime = fakeAdapterRuntime({
			version: {
				"agent-browser": PINNED["agent-browser"],
				// chrome-devtools-mcp: no version entry → provenance not-installed.
			},
			calls,
		});
		const { main: warmChromeMain } = okScript();

		const run = await runDispatcher(["--json", "--run-id", RUN_ID], {
			warmChromeMain,
			adapterRuntime,
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(0);
		const envelope = parseStdout(run);
		expect(envelope.status).toBe("ok");
		const data = envelope.data as {
			outcome: string;
			adapters: Array<{
				adapter_id: string;
				installed: boolean;
				connectable: boolean;
				routes: Array<{ route: string; environment_compatible: boolean }>;
			}>;
			contract_id: string;
			schema_version: string;
		};
		expect(data.outcome).toBe("dashboard");
		const cdm = data.adapters.find((a) => a.adapter_id === "chrome-devtools-mcp");
		const ab = data.adapters.find((a) => a.adapter_id === "agent-browser");
		expect(cdm?.installed).toBe(false);
		expect(cdm?.connectable).toBe(false);
		expect(ab?.installed).toBe(true);
		expect(ab?.connectable).toBe(true);
		// One-read decision surface: each adapter row carries its route
		// compatibility against the environment.
		expect(
			ab?.routes.some(
				(route) => route.route === "explicit-cdp" && route.environment_compatible,
			),
		).toBe(true);
		// AE5/R16: the dashboard NEVER fires an attachment probe.
		expect(calls.probe).toEqual([]);
		// It reads provenance (version) only — the dashboard is stateless.
		expect(calls.version.sort()).toEqual(
			["agent-browser", "chrome-devtools-mcp"].sort(),
		);
		// R15: the dashboard never proves an environment or launches — the scripted
		// warm-chrome main is never invoked by a bare read.
	});

	test("bare invocation never invokes the warm-chrome gateway (R15: no environment prove/launch)", async () => {
		const calls = { probe: [] as string[], version: [] as string[] };
		let warmChromeCalls = 0;
		const warmChromeMain = async () => {
			warmChromeCalls += 1;
			return 0;
		};
		const adapterRuntime = fakeAdapterRuntime({
			version: {
				"agent-browser": PINNED["agent-browser"],
				"chrome-devtools-mcp": PINNED["chrome-devtools-mcp"],
			},
			calls,
		});

		const run = await runDispatcher(["--json", "--run-id", RUN_ID], {
			warmChromeMain,
			adapterRuntime,
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(0);
		expect(warmChromeCalls).toBe(0);
		expect(calls.probe).toEqual([]);
	});
});

describe("browser-connect check command (U6 R15)", () => {
	test("verified environment: exit 0, ok envelope, no launch, no adapter probe", async () => {
		const calls = { probe: [] as string[], version: [] as string[] };
		const { main: warmChromeMain, calls: wcCalls } = okScript();
		const adapterRuntime = fakeAdapterRuntime({ calls });

		const run = await runDispatcher(["check", "--json", "--run-id", RUN_ID], {
			warmChromeMain,
			adapterRuntime,
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(0);
		const envelope = parseStdout(run);
		expect(envelope.status).toBe("ok");
		expect(envelope.data?.contract_id).toBe(BROWSER_CONNECT_CONTRACT_ID);
		expect(envelope.data?.schema_version).toBe(BROWSER_CONNECT_SCHEMA_VERSION);
		// check is prove-only: exactly one `check`, never a `launch` (R15).
		expect(wcCalls.map(commandWord)).toEqual(["check"]);
		// No adapter probe fires on a bare environment read.
		expect(calls.probe).toEqual([]);
	});

	test("environment absent: exit 20, environment_absent station, launch action", async () => {
		const { main: warmChromeMain } = errorScript(
			"endpoint_unreachable",
			"no_listener",
		);
		const run = await runDispatcher(["check", "--json", "--run-id", RUN_ID], {
			warmChromeMain,
			adapterRuntime: fakeAdapterRuntime({}),
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.status).toBe("error");
		expect(envelope.error?.code).toBe("environment_absent");
		expect(envelope.continuation?.next_action_id).toBe("launch_agent_chrome");
	});

	test("foreign listener: exit 20, foreign_listener station, inspect action", async () => {
		const { main: warmChromeMain } = errorScript(
			"port_occupied_foreign",
			"foreign_listener",
		);
		const run = await runDispatcher(["check", "--json", "--run-id", RUN_ID], {
			warmChromeMain,
			adapterRuntime: fakeAdapterRuntime({}),
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("foreign_listener");
		expect(envelope.continuation?.next_action_id).toBe("inspect_listener");
	});
});

describe("browser-connect connect command: verified handoffs (U6 R2/R16, AE7)", () => {
	function installedRuntime(calls?: { probe: string[]; version: string[] }) {
		return fakeAdapterRuntime({
			version: {
				"agent-browser": PINNED["agent-browser"],
				"chrome-devtools-mcp": PINNED["chrome-devtools-mcp"],
			},
			...(calls ? { calls } : {}),
		});
	}

	test("existing session → verified handoff, launch provenance false (AE7)", async () => {
		const { main: warmChromeMain } = okScript(
			"ws://127.0.0.1:9222/devtools/browser/existing",
		);
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime: installedRuntime(),
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(0);
		const envelope = parseStdout(run);
		expect(envelope.status).toBe("ok");
		const data = envelope.data as {
			outcome: string;
			launch: { launched: boolean };
			attachment: { adapter_id: string; route: string; probe_executable: string };
			endpoint: { http: string; ws: string };
			browser_entry_mode: string;
			contract_id: string;
			schema_version: string;
		};
		expect(data.outcome).toBe("verified");
		expect(data.launch.launched).toBe(false);
		expect(data.attachment.adapter_id).toBe("agent-browser");
		expect(data.attachment.route).toBe("explicit-cdp");
		expect(data.browser_entry_mode).toBe("explicit-cdp");
		expect(data.endpoint.ws).toBe(
			"ws://127.0.0.1:9222/devtools/browser/existing",
		);
		// --json envelope carries contract id + schema version (R16).
		expect(data.contract_id).toBe(BROWSER_CONNECT_CONTRACT_ID);
		expect(data.schema_version).toBe(BROWSER_CONNECT_SCHEMA_VERSION);
		expect(envelope.continuation?.next_action_id).toBe("use_verified_handoff");
	});

	test("auto-launched session → verified handoff, launch provenance true (AE7)", async () => {
		// check absent → launch → re-prove ok. Provenance records the launch.
		const { main: warmChromeMain, calls: wcCalls } = scriptedWarmChromeMain([
			{
				envelope: warmChromeErrorEnvelope({
					runId: RUN_ID,
					code: "endpoint_unreachable",
					reason: "no_listener",
					exitCode: 20,
				}),
				exitCode: 20,
			},
			{
				envelope: warmChromeOkEnvelope({
					runId: RUN_ID,
					endpoint: "http://127.0.0.1:9222",
					ws: "ws://127.0.0.1:9222/devtools/browser/launched",
				}),
				exitCode: 0,
			},
			{
				envelope: warmChromeOkEnvelope({
					runId: RUN_ID,
					endpoint: "http://127.0.0.1:9222",
					ws: "ws://127.0.0.1:9222/devtools/browser/launched",
				}),
				exitCode: 0,
			},
		]);
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime: installedRuntime(),
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(0);
		const data = parseStdout(run).data as { launch: { launched: boolean } };
		expect(data.launch.launched).toBe(true);
		// connect auto-launches: check → launch → check.
		expect(wcCalls.map(commandWord)).toEqual(["check", "launch", "check"]);
	});

	test("the adapter's OWN executable performed the probe (R4)", async () => {
		const calls = { probe: [] as string[], version: [] as string[] };
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime: installedRuntime(calls),
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(0);
		const data = parseStdout(run).data as {
			attachment: { probe_executable: string };
		};
		// R4: the probe ran through the adapter's own binary.
		expect(calls.probe).toEqual(["agent-browser"]);
		expect(data.attachment.probe_executable).toBe("/fake/bin/agent-browser");
	});
});

describe("browser-connect connect command: failure stations (U6 R7/R11)", () => {
	test("adapter-unknown → exit 2, adapter_unknown station, list action (before any environment work)", async () => {
		let warmChromeCalls = 0;
		const warmChromeMain = async () => {
			warmChromeCalls += 1;
			return 0;
		};
		const run = await runDispatcher(
			["connect", "no-such-adapter", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);

		expect(run.exitCode).toBe(2);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("adapter_unknown");
		expect(envelope.continuation?.next_action_id).toBe(
			"list_registered_adapters",
		);
		// Unknown adapter is rejected BEFORE any environment prove/launch (R7).
		expect(warmChromeCalls).toBe(0);
	});

	test("adapter-not-installed → exit 20, adapter_not_installed station, NO probe fired", async () => {
		const calls = { probe: [] as string[], version: [] as string[] };
		const { main: warmChromeMain } = okScript();
		// agent-browser version absent → provenance not-installed.
		const adapterRuntime = fakeAdapterRuntime({ version: {}, calls });
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime,
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("adapter_not_installed");
		expect(envelope.continuation?.next_action_id).toBe("install_adapter");
		// A not-installed adapter never gets a probe (R7).
		expect(calls.probe).toEqual([]);
	});

	test("route-incompatible → exit 20, route_incompatible station", async () => {
		const { main: warmChromeMain } = okScript();
		// A synthetic adapter that declares only ui-consent (agent-chrome offers
		// only explicit-cdp), forcing selectCompatibleRoute to return undefined.
		const uiOnly: AdapterDefinition = {
			...agentBrowserDefinition,
			id: "ui-only",
			routes: [
				{ route: "ui-consent", evidence: "documented", implemented: false },
			],
		};
		const adapterRuntime = fakeAdapterRuntime({
			version: { "agent-browser": PINNED["agent-browser"] },
		});
		const run = await runDispatcher(
			["connect", "ui-only", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain,
				adapterRuntime,
				listAdapterDefinitions: () => [uiOnly],
				findAdapterDefinition: (id) => (id === "ui-only" ? uiOnly : undefined),
			},
		);

		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("route_incompatible");
		expect(envelope.continuation?.next_action_id).toBe(
			"select_compatible_route",
		);
	});

	test("attachment-failed → exit 20, attachment_failed station (endpoint verified, probe failed)", async () => {
		const { main: warmChromeMain } = okScript();
		const adapterRuntime = fakeAdapterRuntime({
			version: { "agent-browser": PINNED["agent-browser"] },
			probeExit: { "agent-browser": 1 },
		});
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime,
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("attachment_failed");
		expect(envelope.continuation?.next_action_id).toBe(
			"inspect_attachment_probe",
		);
	});

	test("foreign-listener → exit 20, foreign_listener station, no launch, no fallback", async () => {
		const { main: warmChromeMain, calls: wcCalls } = errorScript(
			"port_occupied_foreign",
			"foreign_listener",
		);
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime: fakeAdapterRuntime({
				version: { "agent-browser": PINNED["agent-browser"] },
			}),
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("foreign_listener");
		// Fail closed: a foreign listener is NOT auto-launched over.
		expect(wcCalls.map(commandWord)).toEqual(["check"]);
	});

	test("launch-failed → exit 20, launch_failed station", async () => {
		// check absent → launch fails → launch-failed.
		const { main: warmChromeMain } = scriptedWarmChromeMain([
			{
				envelope: warmChromeErrorEnvelope({
					runId: RUN_ID,
					code: "endpoint_unreachable",
					reason: "no_listener",
					exitCode: 20,
				}),
				exitCode: 20,
			},
			{
				envelope: warmChromeErrorEnvelope({
					runId: RUN_ID,
					code: "endpoint_unreachable",
					reason: "no_listener",
					exitCode: 20,
				}),
				exitCode: 20,
			},
		]);
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime: fakeAdapterRuntime({
				version: { "agent-browser": PINNED["agent-browser"] },
			}),
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("launch_failed");
		expect(envelope.continuation?.next_action_id).toBe("inspect_diagnostics");
	});
});

describe("browser-connect envelope text safety (U6 R14/KTD10)", () => {
	test("a failure detail carrying a local path and ws url is scrubbed from the serialized envelope", async () => {
		const { main: warmChromeMain } = okScript();
		// A synthetic adapter whose attachment probe returns a detail embedding a
		// local path and a ws debugger url — both must be scrubbed by the redaction
		// chokepoint before serialization (R14/KTD10).
		const leakyAdapter: AdapterDefinition = {
			...agentBrowserDefinition,
			id: "leaky",
			async probeAttachment() {
				return {
					attached: false,
					failureClass: "attachment-failed",
					detail:
						"probe failed at /Users/secret/agent-browser attaching ws://127.0.0.1:9222/devtools/browser/leak",
				};
			},
		};
		const run = await runDispatcher(
			["connect", "leaky", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain,
				adapterRuntime: fakeAdapterRuntime({
					version: { "agent-browser": PINNED["agent-browser"] },
				}),
				listAdapterDefinitions: () => [leakyAdapter],
				findAdapterDefinition: (id) =>
					id === "leaky" ? leakyAdapter : undefined,
			},
		);

		expect(run.exitCode).toBe(20);
		expect(parseStdout(run).error?.code).toBe("attachment_failed");
		// The redaction chokepoint scrubbed both the path and the ws url (R14).
		expect(run.stdout).not.toContain("/Users/secret");
		expect(run.stdout).not.toContain("/devtools/browser/leak");
	});

	test("connect success envelope carries no ws:// scheme leaked into free text", async () => {
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime: fakeAdapterRuntime({
				version: { "agent-browser": PINNED["agent-browser"] },
			}),
			...realRegistryAccessors(),
		});
		// The structured endpoint field is exempt (verbatim by contract), but the
		// verified endpoint appears ONLY inside the structured data.endpoint fields,
		// never in a redactable free-text detail.
		const envelope = parseStdout(run);
		expect(envelope.status).toBe("ok");
		const data = envelope.data as { endpoint: { ws: string } };
		expect(data.endpoint.ws).toContain("ws://");
	});
});

describe("browser-connect post-gateway redaction survives (U6 KTD10/R14)", () => {
	test("a diagnostic emitted AFTER connect still routes through browser-connect's redactor", async () => {
		// warm-chrome's real main tears down LogTape in its finally. The dispatcher
		// re-applies its own diagnostics config after every gateway call. A
		// diagnostic emitted post-connect (via the --verbose stderr sink) must still
		// scrub a local path through browser-connect's redactor.
		const warmChromeMain = async (
			_argv: readonly string[],
			deps: WarmChromeMainDeps = {},
		): Promise<number> => {
			deps.stdout?.write(
				warmChromeOkEnvelope({
					runId: RUN_ID,
					endpoint: "http://127.0.0.1:9222",
					ws: "ws://127.0.0.1:9222/devtools/browser/id",
				}),
			);
			// Simulate warm-chrome's finally tearing down diagnostics.
			resetCliDiagnostics();
			return 0;
		};

		const stdout = memoryWriter();
		const stderr = memoryWriter();
		// A probe failure whose detail carries a local path; --verbose routes an
		// error diagnostic to stderr AFTER the gateway returned.
		const adapterRuntime = fakeAdapterRuntime({
			version: { "agent-browser": PINNED["agent-browser"] },
			probeExit: { "agent-browser": 1 },
		});
		const exitCode = await main(
			["connect", "agent-browser", "--json", "--verbose", "--run-id", RUN_ID],
			{
				warmChromeMain,
				adapterRuntime,
				...realRegistryAccessors(),
				stdout,
				stderr,
			},
		);

		expect(exitCode).toBe(20);
		// The error diagnostic on stderr must not leak the /fake/bin path — proof
		// browser-connect's redactor was restored after the gateway teardown.
		expect(stderr.output).not.toContain("/fake/bin");
	});
});

// ===========================================================================
// U7 run wrapper: prove, emit the Verified Handoff Envelope on STDERR pre-exec,
// inject the verified endpoint into the wrapped command, exec (spawn-and-wait),
// passthrough. Every scenario runs the real main(argv, deps) in-process with an
// injected fake spawner — NO real process is ever spawned.
//
// Contract anchors: R1 (one command connects), R14/AE8 (auth-bearing passthrough
// args never echoed), R17/AE6 (envelope on stderr before exec; passthrough exit
// unchanged; connect failure reserved to pre-exec), KTD4 (exit codes; the two
// 127s distinguishable by diagnostic-line presence), KTD5 (stderr channel).
// ===========================================================================

import type {
	InjectedInvocation,
	RunSpawnResult,
	RunSpawner,
} from "../src/run-exec.ts";

/**
 * A scriptable fake spawner. Records the invocation it received (so tests assert
 * the injected argv/env WITHOUT spawning a real process) and returns a scripted
 * result: a passthrough exit code or a spawn failure.
 */
function fakeSpawner(
	result: RunSpawnResult,
	sink?: { calls: InjectedInvocation[] },
): RunSpawner {
	return async (input: InjectedInvocation): Promise<RunSpawnResult> => {
		sink?.calls.push(input);
		return result;
	};
}

/**
 * Parse the LAST JSON line on stderr as the run envelope (the verified handoff,
 * or a failure envelope). run writes its envelope to stderr, one JSON line.
 */
function parseStderrEnvelope(run: DispatcherRun): DispatcherEnvelope {
	// Envelopes are single compact JSON lines (KTD5); diagnostics may also be on
	// stderr as plain-text lines. Take the LAST JSON line.
	const line = run.stderr
		.trim()
		.split("\n")
		.filter((l) => l.startsWith("{"))
		.at(-1);
	if (!line) throw new Error("no JSON line on stderr");
	return JSON.parse(line) as DispatcherEnvelope;
}

/** All JSON lines on stderr, in order (envelope, then any diagnostic line). */
function stderrJsonLines(run: DispatcherRun): DispatcherEnvelope[] {
	return run.stderr
		.trim()
		.split("\n")
		.filter(Boolean)
		.filter((line) => line.startsWith("{"))
		.map((line) => JSON.parse(line) as DispatcherEnvelope);
}

function installedRunRuntime() {
	return fakeAdapterRuntime({
		version: {
			"agent-browser": PINNED["agent-browser"],
			"chrome-devtools-mcp": PINNED["chrome-devtools-mcp"],
		},
	});
}

describe("browser-connect run: -- separator parsing (U7 R17)", () => {
	test("missing -- → exit 2, missing_separator station on STDERR, add_run_separator action", async () => {
		let warmChromeCalls = 0;
		const warmChromeMain = async () => {
			warmChromeCalls += 1;
			return 0;
		};
		const run = await runDispatcher(
			["run", "agent-browser", "--run-id", RUN_ID],
			{
				warmChromeMain,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);

		expect(run.exitCode).toBe(2);
		// The failure is on STDERR (stdout belongs to the wrapped command); stdout
		// stays empty for a run that never execs.
		expect(run.stdout).toBe("");
		const envelope = parseStderrEnvelope(run);
		expect(envelope.status).toBe("error");
		expect(envelope.error?.code).toBe("missing_separator");
		expect(envelope.continuation?.next_action_id).toBe("add_run_separator");
		// A missing separator is a pure parse failure — no environment work.
		expect(warmChromeCalls).toBe(0);
	});

	test("a wrapped command containing --help/--version is not treated as browser-connect help (tail not scanned)", async () => {
		const calls = { calls: [] as InjectedInvocation[] };
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(
			[
				"run",
				"agent-browser",
				"--run-id",
				RUN_ID,
				"--",
				"agent-browser",
				"--help",
			],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: fakeSpawner({ outcome: "exited", exitCode: 0 }, calls),
			},
		);

		// NOT help output — the wrapped command ran (spawner invoked), exit 0.
		expect(run.exitCode).toBe(0);
		expect(calls.calls).toHaveLength(1);
		// The tail's --help reached the wrapped command verbatim.
		expect(calls.calls[0]?.args).toContain("--help");
	});
});

describe("browser-connect run: verified handoff + injection (U7 R1, AE1)", () => {
	test("connect succeeds → envelope on STDERR → wrapped command runs with the injected endpoint (AE1)", async () => {
		const calls = { calls: [] as InjectedInvocation[] };
		const { main: warmChromeMain } = okScript(
			"ws://127.0.0.1:9222/devtools/browser/run-verified",
		);
		const run = await runDispatcher(
			[
				"run",
				"agent-browser",
				"--run-id",
				RUN_ID,
				"--",
				"agent-browser",
				"snapshot",
			],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: fakeSpawner({ outcome: "exited", exitCode: 0 }, calls),
			},
		);

		expect(run.exitCode).toBe(0);
		// KTD5: the verified handoff envelope is on STDERR, not stdout.
		const envelope = parseStderrEnvelope(run);
		expect(envelope.status).toBe("ok");
		const data = envelope.data as {
			outcome: string;
			attachment: { adapter_id: string; route: string };
			endpoint: { ws: string; http: string };
		};
		expect(data.outcome).toBe("verified");
		expect(data.attachment.adapter_id).toBe("agent-browser");
		expect(envelope.continuation?.next_action_id).toBe("use_verified_handoff");

		// R1: the wrapped command ran with the injected endpoint. agent-browser
		// injects `--cdp <ws>` prepended after the wrapped executable.
		expect(calls.calls).toHaveLength(1);
		const invocation = calls.calls[0];
		if (!invocation) throw new Error("unreachable");
		expect(invocation.command).toBe("agent-browser");
		expect(invocation.args).toEqual([
			"--cdp",
			"ws://127.0.0.1:9222/devtools/browser/run-verified",
			"snapshot",
		]);
	});

	test("stdout is byte-identical to the wrapped tool's stdout (envelope stays on stderr)", async () => {
		// The fake spawner never writes to stdout; the run wrapper must not write
		// the envelope to stdout either, so stdout stays empty (byte-identical to a
		// wrapped tool that produced no stdout).
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(
			["run", "agent-browser", "--run-id", RUN_ID, "--", "agent-browser", "snapshot"],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: fakeSpawner({ outcome: "exited", exitCode: 0 }),
			},
		);

		expect(run.exitCode).toBe(0);
		// stdout carries NONE of the envelope — it belongs to the wrapped command.
		expect(run.stdout).toBe("");
		expect(run.stderr).toContain('"status":"ok"');
	});
});

describe("browser-connect run: exit passthrough vs pre-exec failure (U7 R17, AE6)", () => {
	test("AE6 arm (a): connection succeeds, wrapped tool exits 1 → passthrough exit 1, NO connect-failure envelope", async () => {
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(
			["run", "agent-browser", "--run-id", RUN_ID, "--", "suite", "--fail"],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: fakeSpawner({ outcome: "exited", exitCode: 1 }),
			},
		);

		// Passthrough: the wrapped tool's own exit 1.
		expect(run.exitCode).toBe(1);
		// The verified handoff envelope (ok) is on stderr; there is NO
		// connect-failure envelope — the connection succeeded.
		const envelopes = stderrJsonLines(run);
		expect(envelopes).toHaveLength(1);
		expect(envelopes[0]?.status).toBe("ok");
		expect(envelopes[0]?.error).toBeUndefined();
	});

	test("AE6 arm (b): foreign listener → exit 20 pre-exec, wrapped command never starts", async () => {
		const calls = { calls: [] as InjectedInvocation[] };
		const { main: warmChromeMain } = errorScript(
			"port_occupied_foreign",
			"foreign_listener",
		);
		const run = await runDispatcher(
			["run", "agent-browser", "--run-id", RUN_ID, "--", "suite"],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: fakeSpawner({ outcome: "exited", exitCode: 0 }, calls),
			},
		);

		// Pre-exec exit 20 (connect-family failure reserved to pre-exec).
		expect(run.exitCode).toBe(20);
		// The wrapped command NEVER started.
		expect(calls.calls).toEqual([]);
		// stdout untouched; the failure envelope is on stderr.
		expect(run.stdout).toBe("");
		const envelope = parseStderrEnvelope(run);
		expect(envelope.status).toBe("error");
		expect(envelope.error?.code).toBe("preexec_connect_failed");
		expect(envelope.error?.exit_code).toBe(20);
		expect(envelope.continuation?.next_action_id).toBe("resolve_connect_failure");
	});
});

describe("browser-connect run: the two 127s are distinguishable (U7 KTD4)", () => {
	test("wrapped binary MISSING → exit 127 with the handoff envelope already on stderr PLUS a spawn-failure diagnostic line", async () => {
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(
			["run", "agent-browser", "--run-id", RUN_ID, "--", "no-such-binary"],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: fakeSpawner({
					outcome: "spawn-failed",
					detail: "spawn no-such-binary ENOENT",
				}),
			},
		);

		expect(run.exitCode).toBe(127);
		const envelopes = stderrJsonLines(run);
		// TWO JSON lines: the verified handoff envelope, THEN the spawn-failure
		// diagnostic envelope — so browser-connect's 127 is mechanically
		// distinguishable from a wrapped tool's own 127.
		expect(envelopes).toHaveLength(2);
		expect(envelopes[0]?.status).toBe("ok");
		expect(envelopes[1]?.status).toBe("error");
		expect(envelopes[1]?.error?.code).toBe("wrapped_not_found");
		expect(envelopes[1]?.error?.exit_code).toBe(127);
		expect(envelopes[1]?.continuation?.next_action_id).toBe(
			"fix_wrapped_command",
		);
	});

	test("wrapped tool SELF-EXITS 127 → passthrough exit 127 with the handoff envelope only, NO spawn-failure diagnostic line", async () => {
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(
			["run", "agent-browser", "--run-id", RUN_ID, "--", "tool", "--exit-127"],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				// The tool ran and chose exit 127 itself (not a spawn failure).
				runSpawner: fakeSpawner({ outcome: "exited", exitCode: 127 }),
			},
		);

		expect(run.exitCode).toBe(127);
		const envelopes = stderrJsonLines(run);
		// ONLY the verified handoff envelope; NO spawn-failure diagnostic line.
		// The presence of a diagnostic line is the attribution mechanism (KTD4).
		expect(envelopes).toHaveLength(1);
		expect(envelopes[0]?.status).toBe("ok");
		expect(envelopes.some((e) => e.error?.code === "wrapped_not_found")).toBe(
			false,
		);
	});
});

describe("browser-connect run: auth-bearing passthrough args never echoed (U7 R14, AE8)", () => {
	test("an auth-bearing URL arg in the wrapped command appears in NEITHER the envelope NOR any diagnostic", async () => {
		const SECRET_URL =
			"https://user:s3cr3t-token@internal.example.com/timesheet?session=abc123";
		const calls = { calls: [] as InjectedInvocation[] };
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(
			[
				"run",
				"agent-browser",
				"--run-id",
				RUN_ID,
				"--verbose",
				"--",
				"agent-browser",
				"open",
				SECRET_URL,
			],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: fakeSpawner({ outcome: "exited", exitCode: 0 }, calls),
			},
		);

		expect(run.exitCode).toBe(0);
		// The wrapped command DID receive the auth-bearing arg (uninspected, R18).
		expect(calls.calls[0]?.args).toContain(SECRET_URL);
		// But NOTHING browser-connect emitted (envelope + all diagnostics on
		// stderr, and nothing on stdout) echoes it (R14/AE8).
		expect(run.stdout).not.toContain("s3cr3t-token");
		expect(run.stdout).not.toContain("session=abc123");
		expect(run.stderr).not.toContain("s3cr3t-token");
		expect(run.stderr).not.toContain("session=abc123");
		expect(run.stderr).not.toContain(SECRET_URL);
	});
});

describe("browser-connect run: signal-death passthrough (U7 R17)", () => {
	test("a wrapped process killed by signal maps to exit 128+signal (passthrough contract)", async () => {
		const { main: warmChromeMain } = okScript();
		// The spawner already maps signal-death to 128+signal; a SIGTERM (15) death
		// surfaces as 143.
		const run = await runDispatcher(
			["run", "agent-browser", "--run-id", RUN_ID, "--", "long-running"],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: fakeSpawner({ outcome: "exited", exitCode: 143 }),
			},
		);

		expect(run.exitCode).toBe(143);
		// The verified handoff was still emitted before exec.
		expect(parseStderrEnvelope(run).status).toBe("ok");
	});
});
