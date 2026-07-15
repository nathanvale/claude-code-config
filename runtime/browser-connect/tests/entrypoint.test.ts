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
	createProductionAdapterRuntime,
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
	suggestedExplicitPort?: number;
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
				...(input.suggestedExplicitPort === undefined
					? {}
					: { suggested_explicit_port: input.suggestedExplicitPort }),
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

		test("launch ok but re-prove fails: orphan is attributable (launched true)", async () => {
			// AE7: warm-chrome's `launch` returned an OK/verified envelope — a Chrome
			// WAS spawned and warm-chrome owns that spawn. The subsequent re-prove
			// `check` then fails (Chrome died, or a race). The failure result MUST
			// carry launched:true so the orphaned Chrome is attributable to
			// browser-connect; a false reading would strand it unattributable.
			const { main } = scriptedWarmChromeMain([
				{
					// first check: absent
					envelope: warmChromeErrorEnvelope({
						runId: RUN_ID,
						code: "endpoint_unreachable",
						reason: "no_listener",
						exitCode: 20,
					}),
					exitCode: 20,
				},
				{
					// launch: OK — a Chrome was verified-spawned; warm-chrome owns it
					envelope: warmChromeOkEnvelope({
						runId: RUN_ID,
						endpoint: "http://127.0.0.1:9222",
						ws: "ws://127.0.0.1:9222/devtools/browser/launched-id",
					}),
					exitCode: 0,
				},
				{
					// re-prove check: exit-20 (the spawned Chrome died / raced away)
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
			// The launch invocation itself returned ok → we own whatever it spawned.
			expect(result.launch.launched).toBe(true);
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

	describe("envelope-parse robustness (R11/KTD4 exit-20 invariant)", () => {
		test("empty capture from warm-chrome degrades to an exit-20-family failure, never a throw", async () => {
			// R11/KTD4: any warm-chrome browser-entry outcome must stay in the
			// exit-20 family. A parse failure (here: an empty capture) must NOT
			// propagate as a thrown exception (which main maps to exit-1
			// runtime-error-unexpected). It must resolve to a typed exit-20-family
			// `outcome: "failed"`. Currently unreachable (browser-connect always
			// calls warm-chrome with fixed --json argv), but robust to upstream drift.
			const main = async (
				_argv: readonly string[],
				deps: WarmChromeMainDeps = {},
			): Promise<number> => {
				deps.stdout?.write(""); // no envelope on the capture writer
				return 0;
			};

			const result = await proveAgentChromeEnvironment(baseDeps(main));

			expect(result.outcome).toBe("failed");
			if (result.outcome !== "failed") throw new Error("unreachable");
			// The declared exit-20 default catch class — the honest "something
			// unexpected on the entry path" default (foreign-listener).
			expect(result.failure_class).toBe("foreign-listener");
		});

		test("non-JSON capture from warm-chrome degrades to an exit-20-family failure, never a throw", async () => {
			const main = async (
				_argv: readonly string[],
				deps: WarmChromeMainDeps = {},
			): Promise<number> => {
				deps.stdout?.write("not json");
				return 0;
			};

			const result = await proveAgentChromeEnvironment(baseDeps(main));

			expect(result.outcome).toBe("failed");
			if (result.outcome !== "failed") throw new Error("unreachable");
			expect(result.failure_class).toBe("foreign-listener");
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
	runtime_actions?: Array<{ id: string; docs_url?: string }>;
	continuation?: {
		next_action_id?: string;
		requires_operator?: boolean;
		constraints?: Array<{ id: string }>;
		choices?: Array<{ id: string; docs_url?: string }>;
	};
};

/** Choice ids on an error envelope's operator continuation, in order. */
function continuationChoiceIds(envelope: DispatcherEnvelope): string[] {
	return (envelope.continuation?.choices ?? []).map((choice) => choice.id);
}

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

	test("foreign listener: exit 20, foreign_listener station, terminal operator inspection", async () => {
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
		// U4 projection: an unrepairable listener is a terminal operator handoff
		// (R32); the legacy schema-1 data value stays inspect_listener (R30).
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(envelope.continuation?.next_action_id).toBeUndefined();
		expect(continuationChoiceIds(envelope)).toEqual(["inspect_listener"]);
		expect(envelope.data?.next_action_id).toBe("inspect_listener");
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
		// U4 projection: no deterministic correction → operator handoff among the
		// trusted registered adapters (R24); legacy data keeps the non-mutating
		// discovery stop (R30/AE19).
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(continuationChoiceIds(envelope)).toEqual([
			"choose_registered_adapter:chrome-devtools-mcp",
			"choose_registered_adapter:agent-browser",
		]);
		expect(envelope.data?.next_action_id).toBe("list_registered_adapters");
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
		// U4 projection: agent-browser requires lifecycle scripts, so automatic
		// install is unavailable (R29/AE18) — the operator owns the continuation
		// through the trusted manual-install choice, and legacy data degrades to
		// the non-mutating discovery stop (R30/AE19).
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(continuationChoiceIds(envelope)).toEqual([
			"install_registered_adapter_manually:agent-browser",
		]);
		expect(envelope.data?.next_action_id).toBe("list_registered_adapters");
		// A not-installed adapter never gets a probe (R7).
		expect(calls.probe).toEqual([]);
	});

	test("adapter-not-installed with a complete isolated recipe → automatic install_adapter (R19)", async () => {
		const { main: warmChromeMain } = okScript();
		// chrome-devtools-mcp version absent → provenance not-installed; its
		// committed adapter-install recipe is complete, so the automatic package
		// action leads and legacy data mirrors it (R16/R30).
		const run = await runDispatcher(
			["connect", "chrome-devtools-mcp", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain,
				adapterRuntime: fakeAdapterRuntime({ version: {} }),
				...realRegistryAccessors(),
			},
		);

		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("adapter_not_installed");
		expect(envelope.continuation?.next_action_id).toBe("install_adapter");
		expect(envelope.runtime_actions?.map((action) => action.id)).toEqual([
			"install_adapter",
		]);
		expect(envelope.data?.next_action_id).toBe("install_adapter");
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
		// U4 projection: route incompatibility is an operator handoff (KTD21);
		// with no trusted implemented candidate in this injected registry there
		// are no choices, only the no-fallback constraint. Legacy data narrows to
		// the non-mutating discovery stop, and select_compatible_route stays
		// compatibility-only (R20).
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(envelope.continuation?.choices).toBeUndefined();
		expect(
			(envelope.continuation?.constraints ?? []).map((c) => c.id),
		).toContain("no_adapter_fallback");
		expect(envelope.data?.next_action_id).toBe("list_registered_adapters");
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
		// U4 projection: attachment diagnosis is operator-owned; the richer outer
		// choice is inspect_attachment_probe while legacy data degrades to the
		// non-mutating inspect_diagnostics stop (R30).
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(continuationChoiceIds(envelope)).toEqual([
			"inspect_attachment_probe",
		]);
		expect(envelope.data?.next_action_id).toBe("inspect_diagnostics");
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
		// No suggestion from warm-chrome → no suggested-port evidence field.
		expect(envelope.data?.suggested_explicit_port).toBeUndefined();
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
		// U4 projection: a failed launch is operator diagnosis, never a relaunch
		// loop; legacy data keeps the non-mutating diagnostics stop (R30).
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(continuationChoiceIds(envelope)).toEqual(["inspect_diagnostics"]);
		expect(envelope.data?.next_action_id).toBe("inspect_diagnostics");
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
					cause: "probe_failed",
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
		// U4 projection: with NO wrapped words in parser memory the caller must
		// supply the wrapped command (operator stage); legacy data narrows to the
		// non-mutating change_input stop (R30). The automatic add_run_separator
		// arm requires a non-empty wrapped command in parser memory (AE6).
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(continuationChoiceIds(envelope)).toEqual(["provide_wrapped_command"]);
		expect(envelope.data?.next_action_id).toBe("change_input");
		// A missing separator is a pure parse failure — no environment work.
		expect(warmChromeCalls).toBe(0);
	});

	test("missing -- with wrapped words in parser memory → automatic add_run_separator, words never echoed (AE6/R26)", async () => {
		let warmChromeCalls = 0;
		const warmChromeMain = async () => {
			warmChromeCalls += 1;
			return 0;
		};
		const run = await runDispatcher(
			["run", "agent-browser", "wrapped-tool", "wrapped-secret-arg", "--run-id", RUN_ID],
			{
				warmChromeMain,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);

		expect(run.exitCode).toBe(2);
		expect(run.stdout).toBe("");
		const envelope = parseStderrEnvelope(run);
		expect(envelope.error?.code).toBe("missing_separator");
		expect(envelope.continuation?.next_action_id).toBe("add_run_separator");
		expect(envelope.runtime_actions?.map((action) => action.id)).toEqual([
			"add_run_separator",
		]);
		expect(envelope.data?.next_action_id).toBe("add_run_separator");
		// R26: the wrapped words live only in parser memory — never serialized.
		expect(run.stderr).not.toContain("wrapped-tool");
		expect(run.stderr).not.toContain("wrapped-secret-arg");
		expect(warmChromeCalls).toBe(0);
	});

	test("empty tail (-- present, nothing after) → exit 2, missing_separator on STDERR, gate NEVER invoked (no environment proof)", async () => {
		// `run <adapter> --` is a purely SYNTACTIC input error: a `--` is present but
		// there is no wrapped command. It must be rejected PRE-GATE with the same
		// missing_separator station (exit 2, STDERR) as a missing `--` — never running
		// the connect gate (no environment proof, no possible auto-launch) and never
		// surfacing as a runtime error via applyInjection downstream.
		let warmChromeCalls = 0;
		const warmChromeMain = async () => {
			warmChromeCalls += 1;
			return 0;
		};
		let spawnerCalls = 0;
		const trackingSpawner: RunSpawner = async () => {
			spawnerCalls += 1;
			return { outcome: "exited", exitCode: 0 };
		};
		const run = await runDispatcher(
			["run", "agent-browser", "--run-id", RUN_ID, "--"],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: trackingSpawner,
			},
		);

		expect(run.exitCode).toBe(2);
		// The failure is on STDERR; stdout stays empty (run never execs).
		expect(run.stdout).toBe("");
		const envelope = parseStderrEnvelope(run);
		expect(envelope.status).toBe("error");
		expect(envelope.error?.code).toBe("missing_separator");
		expect(envelope.error?.exit_code).toBe(2);
		// U4 projection: the empty tail is the DISTINCT wrapped_command_missing
		// cause on the same station (AE6) — always an operator stage.
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(continuationChoiceIds(envelope)).toEqual(["provide_wrapped_command"]);
		expect(envelope.data?.next_action_id).toBe("change_input");
		// PRE-GATE: no environment proof / auto-launch, and the wrapped command never
		// started.
		expect(warmChromeCalls).toBe(0);
		expect(spawnerCalls).toBe(0);
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

describe("browser-connect run: usage rejections stay off stdout (U7 KTD5)", () => {
	test("missing adapter id before -- (hostile wrapped tail) → stderr envelope, exit 2, stdout byte-empty", async () => {
		let warmChromeCalls = 0;
		const warmChromeMain = async () => {
			warmChromeCalls += 1;
			return 0;
		};
		let spawnerCalls = 0;
		const trackingSpawner: RunSpawner = async () => {
			spawnerCalls += 1;
			return { outcome: "exited", exitCode: 0 };
		};
		// No adapter id in the head; the tail carries a hostile --plain that
		// must never flip the failure's output mode (the tail is the wrapped
		// command verbatim, never browser-connect argv).
		const run = await runDispatcher(
			["run", "--run-id", RUN_ID, "--", "tool", "--plain"],
			{
				warmChromeMain,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
				runSpawner: trackingSpawner,
			},
		);

		expect(run.exitCode).toBe(2);
		// stdout belongs to the wrapped command end-to-end — byte-empty here.
		expect(run.stdout).toBe("");
		const envelope = parseStderrEnvelope(run);
		expect(envelope.status).toBe("error");
		expect(envelope.error?.code).toBe("usage_invalid");
		expect(envelope.error?.exit_code).toBe(2);
		// A parse-phase rejection: no environment work, no exec.
		expect(warmChromeCalls).toBe(0);
		expect(spawnerCalls).toBe(0);
	});

	test("invalid diagnostic flag on a run head (hostile tail) → stderr envelope, exit 2, stdout byte-empty", async () => {
		// `--run-id` missing its value dies in the diagnostic pre-parse; the
		// output mode must come from the pre-split HEAD, never the tail's
		// hostile --plain (the envelope stays a JSON line on stderr).
		const run = await runDispatcher(
			["run", "agent-browser", "--run-id", "--", "tool", "--plain"],
			{
				warmChromeMain: async () => {
					throw new Error("no environment work for a diagnostic parse failure");
				},
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);

		expect(run.exitCode).toBe(2);
		expect(run.stdout).toBe("");
		const envelope = parseStderrEnvelope(run);
		expect(envelope.status).toBe("error");
		expect(envelope.error?.code).toBe("usage_invalid");
	});

	test("a non-run usage error keeps today's stdout channel", async () => {
		const run = await runDispatcher(
			["connect", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: async () => 0,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);

		expect(run.exitCode).toBe(2);
		const envelope = parseStdout(run);
		expect(envelope.status).toBe("error");
		expect(envelope.error?.code).toBe("usage_invalid");
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
		// U4 projection (AE10): the pre-exec failure inherits the exact underlying
		// posture — here the terminal listener inspection — and
		// resolve_connect_failure is never the primary continuation (R20).
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(envelope.continuation?.next_action_id).toBeUndefined();
		expect(continuationChoiceIds(envelope)).toEqual(["inspect_listener"]);
		expect(envelope.data?.next_action_id).toBe("inspect_listener");
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
		// U4 projection: no deterministic correction exists for a missing wrapped
		// binary, so the fix stays a caller-owned operator choice; legacy data
		// narrows to the non-mutating change_input stop (R30).
		expect(envelopes[1]?.continuation?.requires_operator).toBe(true);
		const wrappedEnvelope = envelopes[1];
		if (!wrappedEnvelope) throw new Error("unreachable");
		expect(continuationChoiceIds(wrappedEnvelope)).toEqual([
			"fix_wrapped_command",
		]);
		expect(wrappedEnvelope.data?.next_action_id).toBe("change_input");
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

describe("browser-connect run: a post-handoff throw routes to STDERR, never STDOUT (U7 KTD5/AE6)", () => {
	test("the spawner rejecting AFTER the handoff → runtime_error on STDERR, exit 1, stdout byte-empty, single handoff on stderr", async () => {
		const { main: warmChromeMain } = okScript();
		// A spawner that REJECTS (throws) rather than returning a typed
		// spawn-failed result — e.g. an unexpected internal failure after the gate.
		// Without dispatchRun's own catch this would fall to main's outer catch,
		// which in json mode writes a runtime-error-unexpected envelope onto STDOUT
		// (contaminating the wrapped command's byte-exact stdout, the KTD5 hazard)
		// and exits 1 (which AE6 forbids post-gate). It MUST land on stderr instead.
		const throwingSpawner: RunSpawner = async () => {
			throw new Error("unexpected spawner rejection with /Users/secret/leak");
		};
		const run = await runDispatcher(
			["run", "agent-browser", "--run-id", RUN_ID, "--", "suite"],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: throwingSpawner,
			},
		);

		// browser-connect's own unexpected-runtime code (exit 1), NOT a passthrough.
		expect(run.exitCode).toBe(1);
		// STDOUT stays byte-exact for the wrapped command — nothing was written.
		expect(run.stdout).toBe("");
		// TWO JSON lines on stderr: the verified handoff (ok), THEN the
		// runtime_error envelope — both on stderr, never stdout.
		const envelopes = stderrJsonLines(run);
		expect(envelopes).toHaveLength(2);
		expect(envelopes[0]?.status).toBe("ok");
		expect(envelopes[1]?.status).toBe("error");
		expect(envelopes[1]?.error?.code).toBe("runtime_error");
		expect(envelopes[1]?.error?.exit_code).toBe(1);
		// The raw error text (and its embedded path) never reaches the envelope.
		expect(run.stderr).not.toContain("/Users/secret/leak");
		expect(run.stderr).not.toContain("unexpected spawner rejection");
	});

	test("a throw during the handoff WRITE itself routes to STDERR runtime_error, never STDOUT (exit 1)", async () => {
		// The handoff-envelope write lives INSIDE dispatchRun's post-gate try. A
		// synchronous failure there (e.g. the stderr writer throwing mid-handoff) must
		// route to emitRunUnexpectedStderrFailure on STDERR — NOT fall through to
		// main's outer catch, which would write a runtime-error envelope onto STDOUT
		// (contaminating the wrapped command's byte-exact channel, the KTD5 hazard).
		const { main: warmChromeMain } = okScript();
		const stdout = memoryWriter();
		// A stderr writer that throws when the verified handoff envelope is written
		// (identified by its ok status), then records every later write (the
		// runtime_error envelope + any diagnostics).
		let threw = false;
		const stderr: MemoryWriter = {
			output: "",
			write(chunk: string) {
				if (!threw && chunk.includes('"status":"ok"')) {
					threw = true;
					throw new Error("stderr handoff write failed with /Users/secret/leak");
				}
				this.output += chunk;
				return true;
			},
		};
		let spawnerCalls = 0;
		const spawner: RunSpawner = async () => {
			spawnerCalls += 1;
			return { outcome: "exited", exitCode: 0 };
		};

		const exitCode = await main(
			["run", "agent-browser", "--run-id", RUN_ID, "--", "suite"],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: spawner,
				stdout,
				stderr,
			},
		);

		// browser-connect's own unexpected-runtime code (exit 1), routed to stderr.
		expect(exitCode).toBe(1);
		// STDOUT stays byte-exact — nothing was written there.
		expect(stdout.output).toBe("");
		// The handoff write threw before exec, so the wrapped command never started.
		expect(spawnerCalls).toBe(0);
		// The runtime_error envelope landed on STDERR (the recorded second write).
		const errorLine = stderr.output
			.trim()
			.split("\n")
			.filter((l) => l.startsWith("{"))
			.at(-1);
		if (!errorLine) throw new Error("no JSON envelope on stderr");
		const envelope = JSON.parse(errorLine) as DispatcherEnvelope;
		expect(envelope.status).toBe("error");
		expect(envelope.error?.code).toBe("runtime_error");
		expect(envelope.error?.exit_code).toBe(1);
		// The raw error text (and its embedded path) never reaches any envelope.
		expect(stderr.output).not.toContain("/Users/secret/leak");
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

// ---------------------------------------------------------------------------
// U3: explicit-port command surface and gateway preservation (R15/R23, KTD7/
// KTD12/KTD20). The parser owns validation once; the runtime receives the
// parsed port and hop unchanged; the failed invocation never consumes its own
// suggestion; hop 1 never surfaces another suggested-port continuation.
// ---------------------------------------------------------------------------

const okStepAt = (port: string) => ({
	envelope: warmChromeOkEnvelope({
		runId: RUN_ID,
		endpoint: `http://127.0.0.1:${port}`,
		ws: `ws://127.0.0.1:${port}/devtools/browser/explicit`,
	}),
	exitCode: 0,
});

const absentStep = {
	envelope: warmChromeErrorEnvelope({
		runId: RUN_ID,
		code: "endpoint_unreachable",
		reason: "no_listener",
		exitCode: 20,
	}),
	exitCode: 20,
};

const occupiedStep = (suggestedExplicitPort?: number) => ({
	envelope: warmChromeErrorEnvelope({
		runId: RUN_ID,
		code: "port_occupied_foreign",
		reason: "foreign_listener",
		exitCode: 20,
		...(suggestedExplicitPort === undefined ? {} : { suggestedExplicitPort }),
	}),
	exitCode: 20,
});

/** The `--port <value>` pair a captured warm-chrome argv carried, if any. */
function warmChromePortArg(argv: readonly string[]): string | undefined {
	const index = argv.indexOf("--port");
	return index === -1 ? undefined : argv[index + 1];
}

describe("browser-connect explicit-port forwarding end-to-end (U3 R15/KTD7)", () => {
	test("check --port forwards the parsed port to warm-chrome and reports the verbatim endpoint", async () => {
		const { main: warmChromeMain, calls } = scriptedWarmChromeMain([
			okStepAt("9333"),
		]);
		const run = await runDispatcher(
			["check", "--port", "9333", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);

		expect(run.exitCode).toBe(0);
		expect(calls.map(warmChromePortArg)).toEqual(["9333"]);
		const data = parseStdout(run).data as { endpoint: { ws: string } };
		expect(data.endpoint.ws).toBe("ws://127.0.0.1:9333/devtools/browser/explicit");
	});

	test("connect --port carries the SAME port through check, launch, and recheck (R15)", async () => {
		const { main: warmChromeMain, calls } = scriptedWarmChromeMain([
			absentStep,
			okStepAt("9333"),
			okStepAt("9333"),
		]);
		const run = await runDispatcher(
			["connect", "agent-browser", "--port", "9333", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain,
				adapterRuntime: fakeAdapterRuntime({
					version: {
						"agent-browser": PINNED["agent-browser"],
						"chrome-devtools-mcp": PINNED["chrome-devtools-mcp"],
					},
				}),
				...realRegistryAccessors(),
			},
		);

		expect(run.exitCode).toBe(0);
		expect(calls.map(commandWord)).toEqual(["check", "launch", "check"]);
		expect(calls.map(warmChromePortArg)).toEqual(["9333", "9333", "9333"]);
		const data = parseStdout(run).data as {
			launch: { launched: boolean };
			endpoint: { ws: string };
		};
		expect(data.launch.launched).toBe(true);
		expect(data.endpoint.ws).toBe("ws://127.0.0.1:9333/devtools/browser/explicit");
	});

	test("run --port: the adapter handoff and injection use the endpoint verified on that port", async () => {
		const spawns = { calls: [] as InjectedInvocation[] };
		const { main: warmChromeMain, calls } = scriptedWarmChromeMain([
			okStepAt("9333"),
		]);
		const run = await runDispatcher(
			[
				"run",
				"agent-browser",
				"--port",
				"9333",
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
				runSpawner: fakeSpawner({ outcome: "exited", exitCode: 0 }, spawns),
			},
		);

		expect(run.exitCode).toBe(0);
		expect(calls.map(warmChromePortArg)).toEqual(["9333"]);
		// The wrapped command received the endpoint verified on the explicit port.
		expect(spawns.calls[0]?.args).toEqual([
			"--cdp",
			"ws://127.0.0.1:9333/devtools/browser/explicit",
			"snapshot",
		]);
	});

	test("default-port compatibility: without --port no warm-chrome invocation carries one", async () => {
		const { main: warmChromeMain, calls } = scriptedWarmChromeMain([
			okStepAt("9222"),
		]);
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime: fakeAdapterRuntime({
				version: {
					"agent-browser": PINNED["agent-browser"],
					"chrome-devtools-mcp": PINNED["chrome-devtools-mcp"],
				},
			}),
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(0);
		expect(calls.flat()).not.toContain("--port");
	});
});

describe("browser-connect gateway option rejection (U3 R15: consistent across commands)", () => {
	async function rejectionRun(argv: readonly string[]): Promise<{
		run: DispatcherRun;
		warmChromeCalls: number;
	}> {
		let warmChromeCalls = 0;
		const warmChromeMain = async () => {
			warmChromeCalls += 1;
			return 0;
		};
		const run = await runDispatcher([...argv, "--run-id", RUN_ID], {
			warmChromeMain,
			adapterRuntime: fakeAdapterRuntime({}),
			...realRegistryAccessors(),
		});
		return { run, warmChromeCalls };
	}

	/**
	 * The usage envelope's channel is command-honest (KTD5): run keeps stdout
	 * byte-empty for the wrapped command and rejects on STDERR; every other
	 * command rejects on stdout.
	 */
	function parseUsageEnvelope(
		argv: readonly string[],
		run: DispatcherRun,
	): DispatcherEnvelope {
		if (argv[0] === "run") {
			expect(run.stdout).toBe("");
			return parseStderrEnvelope(run);
		}
		return parseStdout(run);
	}

	test("an out-of-range port is exit 2 usage_invalid on every command, before any gateway work", async () => {
		for (const argv of [
			["check", "--port", "70000", "--json"],
			["connect", "agent-browser", "--port", "70000", "--json"],
			["run", "agent-browser", "--port", "70000", "--", "tool"],
		]) {
			const { run, warmChromeCalls } = await rejectionRun(argv);
			expect(run.exitCode).toBe(2);
			const envelope = parseUsageEnvelope(argv, run);
			expect(envelope.error?.code).toBe("usage_invalid");
			// U4 projection: corrected input stays caller-owned (operator stage);
			// legacy data keeps the change_input stop (R30).
			expect(envelope.continuation?.requires_operator).toBe(true);
			expect(continuationChoiceIds(envelope)).toEqual([
				"provide_corrected_input",
			]);
			expect(envelope.data?.next_action_id).toBe("change_input");
			expect(warmChromeCalls).toBe(0);
		}
	});

	test("duplicate --port and invalid or duplicate hops reject identically (validate once)", async () => {
		for (const argv of [
			["check", "--port", "1", "--port", "2", "--json"],
			["connect", "agent-browser", "--repair-chain-hop", "2", "--json"],
			["check", "--repair-chain-hop", "0", "--repair-chain-hop", "1", "--json"],
			["run", "agent-browser", "--repair-chain-hop=2", "--", "tool"],
		]) {
			const { run, warmChromeCalls } = await rejectionRun(argv);
			expect(run.exitCode).toBe(2);
			expect(parseUsageEnvelope(argv, run).error?.code).toBe("usage_invalid");
			expect(warmChromeCalls).toBe(0);
		}
	});

	test("the dashboard owns neither option: --port stays an unknown option (R15)", async () => {
		const { run, warmChromeCalls } = await rejectionRun([
			"dashboard",
			"--port",
			"9333",
			"--json",
		]);
		expect(run.exitCode).toBe(2);
		expect(parseStdout(run).error?.code).toBe("usage_invalid");
		expect(warmChromeCalls).toBe(0);
	});
});

describe("browser-connect repair-chain hop semantics (U3 R23/KTD12/KTD20)", () => {
	const installedRuntime = () =>
		fakeAdapterRuntime({
			version: {
				"agent-browser": PINNED["agent-browser"],
				"chrome-devtools-mcp": PINNED["chrome-devtools-mcp"],
			},
		});

	function expectNoSuggestedPortAffordance(envelope: DispatcherEnvelope): void {
		expect(envelope.continuation?.next_action_id).not.toBe("use_suggested_port");
		expect(
			envelope.runtime_actions?.map((action) => action.id) ?? [],
		).not.toContain("use_suggested_port");
	}

	test("check preserves a suggestion as diagnostics only: never a suggested-port continuation (KTD20)", async () => {
		const { main: warmChromeMain, calls } = scriptedWarmChromeMain([
			occupiedStep(9333),
		]);
		const run = await runDispatcher(["check", "--json", "--run-id", RUN_ID], {
			warmChromeMain,
			adapterRuntime: fakeAdapterRuntime({}),
			...realRegistryAccessors(),
		});

		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("foreign_listener");
		expectNoSuggestedPortAffordance(envelope);
		// Legacy stop stays the non-mutating listener inspection (R30-compatible).
		expect(envelope.data?.next_action_id).toBe("inspect_listener");
		// The suggestion IS preserved as typed envelope evidence (R6): a later
		// hop-0 connect/run driver may consume it, even though check itself
		// never projects a suggested-port continuation (KTD20).
		expect(envelope.data?.suggested_explicit_port).toEqual({
			port: 9333,
			verified_free: true,
		});
		// The failed invocation never consumed the suggestion itself: one check,
		// no rerun against 9333 (no_internal_port_switch).
		expect(calls).toHaveLength(1);
		expect(calls.flat()).not.toContain("9333");
	});

	test("hop 1: a failed connect cannot surface another suggested-port continuation (R23)", async () => {
		const { main: warmChromeMain, calls } = scriptedWarmChromeMain([
			occupiedStep(9444),
		]);
		const run = await runDispatcher(
			[
				"connect",
				"agent-browser",
				"--port",
				"9333",
				"--repair-chain-hop",
				"1",
				"--json",
				"--run-id",
				RUN_ID,
			],
			{
				warmChromeMain,
				adapterRuntime: installedRuntime(),
				...realRegistryAccessors(),
			},
		);

		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expectNoSuggestedPortAffordance(envelope);
		// Hop 1 never re-advertises a port in the envelope either: the one-hop
		// budget is spent (R23), so the fresh suggestion stays diagnostics-only.
		expect(envelope.data?.suggested_explicit_port).toBeUndefined();
		// Exactly one gateway check on the explicit port; the fresh suggestion
		// (9444) is never consumed by this invocation.
		expect(calls.map(warmChromePortArg)).toEqual(["9333"]);
		expect(calls.flat()).not.toContain("9444");
		// The runtime received the parsed hop and port unchanged: the branch
		// diagnostic record names them as typed failure evidence.
		expect(run.stderr).toContain('"repair_chain_hop":1');
		expect(run.stderr).toContain('"requested_port":9333');
		expect(run.stderr).toContain('"cause":"occupied_listener"');
		expect(run.stderr).toContain('"suggested_port":9444');
	});

	test("hop 1: a failed run pre-exec gate cannot surface another suggested-port continuation (R23)", async () => {
		let spawnerCalls = 0;
		const trackingSpawner: RunSpawner = async () => {
			spawnerCalls += 1;
			return { outcome: "exited", exitCode: 0 };
		};
		const { main: warmChromeMain, calls } = scriptedWarmChromeMain([
			occupiedStep(9444),
		]);
		const run = await runDispatcher(
			[
				"run",
				"agent-browser",
				"--port",
				"9333",
				"--repair-chain-hop",
				"1",
				"--run-id",
				RUN_ID,
				"--",
				"agent-browser",
				"snapshot",
			],
			{
				warmChromeMain,
				adapterRuntime: installedRuntime(),
				...realRegistryAccessors(),
				runSpawner: trackingSpawner,
			},
		);

		expect(run.exitCode).toBe(20);
		expect(run.stdout).toBe("");
		const envelope = parseStderrEnvelope(run);
		expect(envelope.error?.code).toBe("preexec_connect_failed");
		expectNoSuggestedPortAffordance(envelope);
		// Spent hop budget: no suggested-port evidence re-advertised (R23).
		expect(envelope.data?.suggested_explicit_port).toBeUndefined();
		expect(calls.map(warmChromePortArg)).toEqual(["9333"]);
		expect(calls.flat()).not.toContain("9444");
		expect(spawnerCalls).toBe(0);
	});

	test("hop 0: a run pre-exec occupied failure carries the suggested-port evidence on its stderr envelope (R6)", async () => {
		let spawnerCalls = 0;
		const trackingSpawner: RunSpawner = async () => {
			spawnerCalls += 1;
			return { outcome: "exited", exitCode: 0 };
		};
		const { main: warmChromeMain } = scriptedWarmChromeMain([
			occupiedStep(9333),
		]);
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
				adapterRuntime: installedRuntime(),
				...realRegistryAccessors(),
				runSpawner: trackingSpawner,
			},
		);

		expect(run.exitCode).toBe(20);
		expect(run.stdout).toBe("");
		const envelope = parseStderrEnvelope(run);
		expect(envelope.error?.code).toBe("preexec_connect_failed");
		// The automatic use_suggested_port continuation AND the typed evidence
		// it needs travel together at the process boundary: a headless driver
		// builds the hop-1 rerun from data alone.
		expect(envelope.continuation?.next_action_id).toBe("use_suggested_port");
		expect(envelope.data?.suggested_explicit_port).toEqual({
			port: 9333,
			verified_free: true,
		});
		expect(spawnerCalls).toBe(0);
	});

	test("an explicit --repair-chain-hop 0 behaves exactly like the omitted default", async () => {
		const explicit = await runDispatcher(
			["check", "--repair-chain-hop", "0", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([occupiedStep(9333)]).main,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		const omitted = await runDispatcher(["check", "--json", "--run-id", RUN_ID], {
			warmChromeMain: scriptedWarmChromeMain([occupiedStep(9333)]).main,
			adapterRuntime: fakeAdapterRuntime({}),
			...realRegistryAccessors(),
		});

		expect(explicit.exitCode).toBe(omitted.exitCode);
		const explicitEnvelope = parseStdout(explicit);
		const omittedEnvelope = parseStdout(omitted);
		expect(explicitEnvelope.error?.code).toBe(omittedEnvelope.error?.code);
		expect(explicitEnvelope.data).toEqual(omittedEnvelope.data ?? {});
		expect(explicitEnvelope.continuation).toEqual(
			omittedEnvelope.continuation ?? {},
		);
	});

	test("a verified hop-1 rerun completes normally on all mutating surfaces", async () => {
		const spawns = { calls: [] as InjectedInvocation[] };
		const { main: warmChromeMain } = scriptedWarmChromeMain([okStepAt("9333")]);
		const run = await runDispatcher(
			[
				"run",
				"agent-browser",
				"--port",
				"9333",
				"--repair-chain-hop",
				"1",
				"--run-id",
				RUN_ID,
				"--",
				"agent-browser",
				"snapshot",
			],
			{
				warmChromeMain,
				adapterRuntime: installedRuntime(),
				...realRegistryAccessors(),
				runSpawner: fakeSpawner({ outcome: "exited", exitCode: 0 }, spawns),
			},
		);

		expect(run.exitCode).toBe(0);
		expect(parseStderrEnvelope(run).status).toBe("ok");
		expect(spawns.calls).toHaveLength(1);
	});
});

// ===========================================================================
// U5 repair-adapter command: preview, isolated execute, and fail-closed stops
// (R19/R28/R29/R33/R34; KTD9/KTD16/KTD17/KTD22). Every scenario runs the real
// main(argv, deps) in-process. The isolated installer boundary is proven at a
// REAL process boundary with a fake package-manager executable (a script that
// records argv/cwd/env and fabricates the staged install tree) — no real
// network, no real global package mutation, no real npm.
// ===========================================================================

import { chmod, mkdir as fsMkdir, mkdtemp as fsMkdtemp, readdir as fsReaddir, readFile as fsReadFile, rename as fsRename, rm as fsRm, writeFile as fsWriteFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "bun:test";
import type {
	AdapterInstallEngine,
	AdapterPackagePolicy,
} from "../src/adapters/registry.ts";
import { spawnAdapterCommand } from "../src/adapters/registry.ts";

const REPAIR_RUN_ID = "u5-repair";
const CANONICAL_NPM_REGISTRY = "https://registry.npmjs.org";

const repairTempRoots: string[] = [];

afterEach(async () => {
	while (repairTempRoots.length > 0) {
		const root = repairTempRoots.pop();
		if (!root) continue;
		await fsRm(root, { recursive: true, force: true });
	}
});

async function makeRepairRoot(): Promise<string> {
	const root = await fsMkdtemp(join(tmpdir(), "browser-connect-u5-"));
	repairTempRoots.push(root);
	return root;
}

/** warm-chrome must never run for repair-adapter (no environment work). */
const neverWarmChrome = async (): Promise<number> => {
	throw new Error("warm-chrome must not run for repair-adapter");
};

type EngineRecorder = {
	probeCalls: string[];
	spawnInputs: Array<AdapterCommandInput & { cwd?: string }>;
};

/**
 * Real-filesystem install engine with recording seams: real temp dirs, real
 * file reads (with per-path overrides for hostile lock fixtures), a recorded
 * redirect-refusing origin probe fake, and REAL no-shell spawns (the fake
 * package manager is an actual executable script — the process boundary).
 */
function recordingInstallEngine(options: {
	env?: Record<string, string | undefined>;
	files?: Record<string, string | null>;
	probeStatus?: number;
}): { engine: AdapterInstallEngine; recorder: EngineRecorder } {
	const recorder: EngineRecorder = { probeCalls: [], spawnInputs: [] };
	const overrides = options.files ?? {};
	const engine: AdapterInstallEngine = {
		env: options.env ?? {},
		fileExists: async (path) => {
			if (path in overrides) return overrides[path] !== null;
			return existsSync(path);
		},
		readTextFile: async (path) => {
			if (path in overrides) {
				const contents = overrides[path];
				if (contents === null) throw new Error(`ENOENT: ${path}`);
				return contents;
			}
			return fsReadFile(path, "utf8");
		},
		writeTextFile: (path, contents) => fsWriteFile(path, contents, "utf8"),
		makeDir: async (path) => {
			await fsMkdir(path, { recursive: true });
		},
		makeTempDir: (prefix) => fsMkdtemp(prefix),
		removeDir: (path) => fsRm(path, { recursive: true, force: true }),
		publishDir: (fromPath, toPath) => fsRename(fromPath, toPath),
		probeOrigin: async (url) => {
			recorder.probeCalls.push(url);
			return { status: options.probeStatus ?? 200 };
		},
		runCommand: async (input) => {
			recorder.spawnInputs.push(input);
			return spawnAdapterCommand(input);
		},
	};
	return { engine, recorder };
}

/**
 * Write a fake package-manager executable: records argv/cwd/env as JSON and
 * fabricates the staged install tree exactly like a lifecycle-script-free
 * `npm ci` would (node_modules/.bin/<bin> reporting the given version).
 */
async function writeFakePackageManager(
	root: string,
	options: {
		recordPath: string;
		bin?: string;
		reportVersion?: string;
		exitCode?: number;
		createBin?: boolean;
	},
): Promise<string> {
	const pmPath = join(root, "fake-pm");
	const lines = [
		"#!/usr/bin/env bun",
		'import { chmod, mkdir } from "node:fs/promises";',
		`await Bun.write(${JSON.stringify(options.recordPath)}, JSON.stringify({`,
		"\targv: process.argv.slice(2),",
		"\tcwd: process.cwd(),",
		"\tenv: process.env,",
		"}));",
	];
	if (options.createBin !== false && options.bin) {
		const banner = `${options.bin} ${options.reportVersion ?? "0.0.0"}`;
		lines.push(
			'await mkdir("node_modules/.bin", { recursive: true });',
			`const binPath = ${JSON.stringify(`node_modules/.bin/${options.bin}`)};`,
			`const banner = ${JSON.stringify(banner)};`,
			// The generated script escapes the banner itself at ITS runtime, so no
			// quoting bug can enter the generated bin source.
			// biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is generated-script source, evaluated by the wrapper at its own runtime
			'await Bun.write(binPath, ["#!/usr/bin/env bun", `console.log(${JSON.stringify(banner)});`, ""].join("\\n"));',
			"await chmod(binPath, 0o755);",
		);
	}
	lines.push(`process.exit(${options.exitCode ?? 0});`);
	await fsWriteFile(pmPath, `${lines.join("\n")}\n`, "utf8");
	await chmod(pmPath, 0o755);
	return pmPath;
}

/** Clone a real definition with an installPolicy override (registry stays trusted). */
function withInstallPolicy(
	base: AdapterDefinition,
	policy: Partial<AdapterPackagePolicy>,
): AdapterDefinition {
	return {
		...base,
		installPolicy: { ...base.installPolicy, ...policy },
	};
}

function repairRegistryAccessors(definitions: readonly AdapterDefinition[]): {
	listAdapterDefinitions: () => readonly AdapterDefinition[];
	findAdapterDefinition: (id: string) => AdapterDefinition | undefined;
} {
	return {
		listAdapterDefinitions: () => definitions,
		findAdapterDefinition: (id) => definitions.find((d) => d.id === id),
	};
}

type RepairScenario = {
	run: DispatcherRun;
	recorder: EngineRecorder;
	root: string;
	installRoot: string;
	recordPath: string;
	pmPath: string;
};

/**
 * Drive `repair-adapter chrome-devtools-mcp` end to end with the recording
 * engine and the fake package manager. `observedVersion` shapes the PATH-side
 * provenance read; hostile env vars are seeded by default so isolation is
 * proven on every execute.
 */
async function runRepairScenario(options: {
	mode: "--check" | "--execute";
	adapterId?: string;
	observedVersion?: string;
	files?: Record<string, string | null>;
	probeStatus?: number;
	pm?: { reportVersion?: string; exitCode?: number; createBin?: boolean };
	pmCandidates?: readonly string[];
	definitions?: readonly AdapterDefinition[];
	/** Override the install root (retry fixtures share one across executes). */
	installRoot?: string;
}): Promise<RepairScenario> {
	const root = await makeRepairRoot();
	const installRoot = options.installRoot ?? join(root, "install-root");
	const recordPath = join(root, "pm-record.json");
	const pmPath = await writeFakePackageManager(root, {
		recordPath,
		bin: "chrome-devtools-mcp",
		reportVersion: options.pm?.reportVersion ?? PINNED["chrome-devtools-mcp"],
		...(options.pm?.exitCode === undefined ? {} : { exitCode: options.pm.exitCode }),
		...(options.pm?.createBin === undefined ? {} : { createBin: options.pm.createBin }),
	});
	const { engine, recorder } = recordingInstallEngine({
		env: {
			PATH: process.env.PATH,
			HOME: root,
			TMPDIR: tmpdir(),
			// Hostile inherited configuration (AE17): none of these may reach the
			// isolated installer child.
			NPM_CONFIG_REGISTRY: "https://evil.example.com",
			npm_config_registry: "https://evil.example.com",
			npm_config_userconfig: "/attacker/.npmrc",
			NPM_TOKEN: "hostile-npm-token",
			NODE_AUTH_TOKEN: "hostile-auth-token",
			HTTPS_PROXY: "http://attacker.example:8080",
		},
		...(options.files === undefined ? {} : { files: options.files }),
		...(options.probeStatus === undefined ? {} : { probeStatus: options.probeStatus }),
	});
	const definitions =
		options.definitions ??
		[
			withInstallPolicy(chromeDevtoolsMcpDefinition, {
				packageManager: {
					approvedAbsoluteCandidates: options.pmCandidates
						? [...options.pmCandidates]
						: [join(root, "missing-first-candidate"), pmPath],
				},
			}),
			agentBrowserDefinition,
		];
	const adapterRuntime = fakeAdapterRuntime({
		version: {
			...(options.observedVersion === undefined
				? {}
				: { "chrome-devtools-mcp": options.observedVersion }),
		},
	});
	const run = await runDispatcher(
		[
			"repair-adapter",
			options.adapterId ?? "chrome-devtools-mcp",
			options.mode,
			"--json",
			"--run-id",
			REPAIR_RUN_ID,
		],
		{
			warmChromeMain: neverWarmChrome,
			adapterRuntime,
			...repairRegistryAccessors(definitions),
			adapterInstallEngine: engine,
			adapterInstallRoot: installRoot,
		},
	);
	return { run, recorder, root, installRoot, recordPath, pmPath };
}

function publishedBinPath(installRoot: string): string {
	return join(
		installRoot,
		"chrome-devtools-mcp",
		PINNED["chrome-devtools-mcp"],
		"node_modules",
		".bin",
		"chrome-devtools-mcp",
	);
}

type PmRecord = {
	argv: string[];
	cwd: string;
	env: Record<string, string | undefined>;
};

async function readPmRecord(recordPath: string): Promise<PmRecord> {
	return JSON.parse(await fsReadFile(recordPath, "utf8")) as PmRecord;
}

describe("browser-connect repair-adapter: parser boundaries (U5 R33/KTD22)", () => {
	async function usageRun(argv: readonly string[]): Promise<{
		run: DispatcherRun;
		recorder: EngineRecorder;
	}> {
		const root = await makeRepairRoot();
		const { engine, recorder } = recordingInstallEngine({});
		const run = await runDispatcher([...argv, "--json", "--run-id", REPAIR_RUN_ID], {
			warmChromeMain: neverWarmChrome,
			adapterRuntime: fakeAdapterRuntime({}),
			...realRegistryAccessors(),
			adapterInstallEngine: engine,
			adapterInstallRoot: join(root, "install-root"),
		});
		return { run, recorder };
	}

	test("missing mode → exit 2 usage_invalid; zero engine activity", async () => {
		const { run, recorder } = await usageRun(["repair-adapter", "chrome-devtools-mcp"]);
		expect(run.exitCode).toBe(2);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("usage_invalid");
		expect(run.stdout).toContain("--check");
		expect(run.stdout).toContain("--execute");
		expect(recorder.probeCalls).toEqual([]);
		expect(recorder.spawnInputs).toEqual([]);
	});

	test("both modes → exit 2 usage_invalid", async () => {
		const { run } = await usageRun([
			"repair-adapter",
			"chrome-devtools-mcp",
			"--check",
			"--execute",
		]);
		expect(run.exitCode).toBe(2);
		expect(parseStdout(run).error?.code).toBe("usage_invalid");
	});

	test("duplicate modes → exit 2 (both spellings)", async () => {
		const checkTwice = await usageRun([
			"repair-adapter",
			"chrome-devtools-mcp",
			"--check",
			"--check",
		]);
		expect(checkTwice.run.exitCode).toBe(2);
		expect(checkTwice.run.stdout).toContain("duplicate option");
		const executeTwice = await usageRun([
			"repair-adapter",
			"chrome-devtools-mcp",
			"--execute",
			"--execute",
		]);
		expect(executeTwice.run.exitCode).toBe(2);
		expect(executeTwice.run.stdout).toContain("duplicate option");
	});

	test("missing adapter id → exit 2", async () => {
		const { run } = await usageRun(["repair-adapter", "--check"]);
		expect(run.exitCode).toBe(2);
		expect(parseStdout(run).error?.code).toBe("usage_invalid");
	});

	test("a second positional (override-shaped operand) → exit 2 with fixed non-echoing text", async () => {
		const { run } = await usageRun([
			"repair-adapter",
			"chrome-devtools-mcp",
			"9.9.9",
			"--check",
		]);
		expect(run.exitCode).toBe(2);
		expect(run.stdout).toContain("exactly one adapter operand");
		// The override-shaped value itself is never echoed (R24).
		expect(run.stdout).not.toContain("9.9.9");
	});

	test("unknown adapter → exit 2 adapter_unknown; registry re-read is authoritative", async () => {
		const { run, recorder } = await usageRun([
			"repair-adapter",
			"playwright-mcp",
			"--check",
		]);
		expect(run.exitCode).toBe(2);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("adapter_unknown");
		// U4 projection: operator handoff among trusted registered adapters; the
		// legacy data value stays the non-mutating discovery stop (R30/AE19).
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(continuationChoiceIds(envelope)).toEqual([
			"choose_registered_adapter:chrome-devtools-mcp",
			"choose_registered_adapter:agent-browser",
		]);
		expect(envelope.data?.next_action_id).toBe("list_registered_adapters");
		expect(recorder.probeCalls).toEqual([]);
		expect(recorder.spawnInputs).toEqual([]);
	});

	const OVERRIDE_FLAGS = [
		"--registry=https://evil.example.com",
		"--package=some-other-package",
		"--pin=9.9.9",
		"--lockfile=/tmp/hostile-lock.json",
		"--recipe=custom",
		"--path=/tmp/hostile",
		"--scope=global",
		"--package-manager=/tmp/fake-npm",
		"--argv=--unsafe-perm",
		"--version",
	] as const;

	for (const override of OVERRIDE_FLAGS) {
		test(`package-policy override ${override.split("=")[0]} → exit 2 before any engine work (R33)`, async () => {
			const { run, recorder } = await usageRun([
				"repair-adapter",
				"chrome-devtools-mcp",
				"--execute",
				override,
			]);
			expect(run.exitCode).toBe(2);
			expect(parseStdout(run).error?.code).toBe("usage_invalid");
			// The rejected override is never echoed into the envelope (R24).
			expect(run.stdout).not.toContain(override.split("=")[0] ?? override);
			expect(recorder.probeCalls).toEqual([]);
			expect(recorder.spawnInputs).toEqual([]);
		});
	}
});

describe("browser-connect repair-adapter --check: read-only preview (U5 R33/AE22)", () => {
	test("absent adapter with complete isolated evidence → automatic install_adapter, zero network, zero mutation", async () => {
		const scenario = await runRepairScenario({ mode: "--check" });
		expect(scenario.run.exitCode).toBe(0);
		const envelope = parseStdout(scenario.run);
		expect(envelope.status).toBe("ok");
		const data = envelope.data as Record<string, unknown>;
		expect(data.outcome).toBe("repair_preview");
		expect(data.adapter_id).toBe("chrome-devtools-mcp");
		expect(data.install_state).toBe("absent");
		expect(data.posture).toBe("automatic");
		expect(data.eligible_action_id).toBe("install_adapter");
		expect(data.automatic_install).toEqual({
			recipe_complete: true,
			lock_origins_canonical: true,
			dependency_integrity_complete: true,
			lifecycle_scripts_disabled: true,
		});
		expect(envelope.continuation?.next_action_id).toBe("install_adapter");
		// Zero network, zero mutation: preview never probes the registry, never
		// spawns the installer, never records, never publishes (AE22).
		expect(scenario.recorder.probeCalls).toEqual([]);
		expect(scenario.recorder.spawnInputs).toEqual([]);
		expect(existsSync(scenario.recordPath)).toBe(false);
		expect(existsSync(scenario.installRoot)).toBe(false);
	});

	test("agent-browser absent → operator manual-install choice (lifecycle scripts, R29/AE18)", async () => {
		const scenario = await runRepairScenario({
			mode: "--check",
			adapterId: "agent-browser",
		});
		expect(scenario.run.exitCode).toBe(0);
		const envelope = parseStdout(scenario.run);
		const data = envelope.data as Record<string, unknown>;
		expect(data.posture).toBe("operator");
		expect(data.operator_choice_ids).toEqual([
			"install_registered_adapter_manually:agent-browser",
		]);
		expect(data.stop_causes).toContain("lifecycle_scripts_required");
		expect(envelope.continuation?.requires_operator).toBe(true);
		// choices are error-envelope-only; the ok preview carries ids in data.
		expect(envelope.continuation?.choices).toBeUndefined();
		expect(scenario.recorder.probeCalls).toEqual([]);
		expect(scenario.recorder.spawnInputs).toEqual([]);
	});

	test("installed at exact pin → posture none, nothing eligible", async () => {
		const scenario = await runRepairScenario({
			mode: "--check",
			observedVersion: PINNED["chrome-devtools-mcp"],
		});
		expect(scenario.run.exitCode).toBe(0);
		const data = parseStdout(scenario.run).data as Record<string, unknown>;
		expect(data.install_state).toBe("installed_at_pin");
		expect(data.posture).toBe("none");
		expect(data.eligible_action_id).toBeUndefined();
		expect(parseStdout(scenario.run).continuation).toBeUndefined();
	});

	test("exact allowlisted transition → automatic upgrade_adapter_to_pin (R21/AE11)", async () => {
		const scenario = await runRepairScenario({
			mode: "--check",
			observedVersion: "1.4.0",
		});
		expect(scenario.run.exitCode).toBe(0);
		const data = parseStdout(scenario.run).data as Record<string, unknown>;
		expect(data.install_state).toBe("version_mismatch");
		expect(data.observed_version).toBe("1.4.0");
		expect(data.posture).toBe("automatic");
		expect(data.eligible_action_id).toBe("upgrade_adapter_to_pin");
	});

	test("downgrade-shaped observed version → operator adjust_adapter_pin (R22)", async () => {
		const scenario = await runRepairScenario({
			mode: "--check",
			observedVersion: "1.6.0",
		});
		expect(scenario.run.exitCode).toBe(0);
		const data = parseStdout(scenario.run).data as Record<string, unknown>;
		expect(data.posture).toBe("operator");
		expect(data.operator_choice_ids).toEqual(["adjust_adapter_pin"]);
	});

	test("disallowed transition → operator adjust_adapter_pin, never semver inference (R21)", async () => {
		const scenario = await runRepairScenario({
			mode: "--check",
			observedVersion: "1.3.0",
		});
		const data = parseStdout(scenario.run).data as Record<string, unknown>;
		expect(data.posture).toBe("operator");
		expect(data.operator_choice_ids).toEqual(["adjust_adapter_pin"]);
	});

	test("unreadable observed version → operator; no unsafe version projected (R11)", async () => {
		const root = await makeRepairRoot();
		const { engine } = recordingInstallEngine({});
		const adapterRuntime: AdapterRuntime = {
			env: {},
			resolveExecutable: () => ({ resolved: true, path: "/fake/bin/chrome-devtools-mcp" }),
			runCommand: async () => ({ exitCode: 0, stdout: "no version token", stderr: "" }),
		};
		const run = await runDispatcher(
			["repair-adapter", "chrome-devtools-mcp", "--check", "--json", "--run-id", REPAIR_RUN_ID],
			{
				warmChromeMain: neverWarmChrome,
				adapterRuntime,
				...realRegistryAccessors(),
				adapterInstallEngine: engine,
				adapterInstallRoot: join(root, "install-root"),
			},
		);
		expect(run.exitCode).toBe(0);
		const data = parseStdout(run).data as Record<string, unknown>;
		expect(data.posture).toBe("operator");
		expect(data.observed_version).toBeUndefined();
	});

	test("safe provenance projection: no filesystem path reaches the preview envelope (R11)", async () => {
		const scenario = await runRepairScenario({ mode: "--check" });
		expect(scenario.run.stdout).not.toContain(scenario.root);
		expect(scenario.run.stdout).not.toContain("/fake/bin");
		expect(scenario.run.stdout).not.toContain("node_modules/");
	});
});

describe("browser-connect repair-adapter --execute: isolated installer (U5 R28/AE17/AE22)", () => {
	test("install success: isolated spawn, verified bin, atomic publish, fresh exact-pin provenance", async () => {
		const scenario = await runRepairScenario({ mode: "--execute" });
		expect(scenario.run.exitCode).toBe(0);
		const envelope = parseStdout(scenario.run);
		expect(envelope.status).toBe("ok");
		const data = envelope.data as Record<string, unknown>;
		expect(data.outcome).toBe("repair_executed");
		expect(data.performed).toBe("install_adapter");
		expect(data.install_state).toBe("installed_at_pin");
		expect(data.observed_version).toBe(PINNED["chrome-devtools-mcp"]);
		expect(data.pinned_version).toBe(PINNED["chrome-devtools-mcp"]);

		// One egress-gate probe against the canonical origin only (R34).
		expect(scenario.recorder.probeCalls).toEqual([
			`${CANONICAL_NPM_REGISTRY}/chrome-devtools-mcp`,
		]);

		// The installer ran the approved absolute fake package manager (never a
		// PATH lookup even though env.PATH is populated).
		const record = await readPmRecord(scenario.recordPath);
		const installerSpawn = scenario.recorder.spawnInputs[0];
		expect(installerSpawn?.command).toBe(scenario.pmPath);

		// No-shell argv: registry-owned recipe plus the pinned canonical registry.
		expect(record.argv.slice(0, 2)).toEqual(["ci", "--ignore-scripts"]);
		expect(record.argv).toContain(`--registry=${CANONICAL_NPM_REGISTRY}`);

		// Neutral working directory: the staging dir under the install root, not
		// the caller's cwd (AE17 hostile-cwd defense). The child reports a
		// symlink-resolved cwd on macOS (/var -> /private/var), so normalize.
		const normalize = (path: string) => path.replace(/^\/private\//, "/");
		expect(
			normalize(record.cwd).startsWith(normalize(scenario.installRoot)),
		).toBe(true);
		expect(record.cwd).toContain(".staging-chrome-devtools-mcp-");
		expect(record.cwd).not.toBe(process.cwd());

		// Environment allowlist: no inherited registry, auth, or proxy values;
		// isolated config and cache pinned into staging (R28).
		expect(record.env.NPM_TOKEN).toBeUndefined();
		expect(record.env.NODE_AUTH_TOKEN).toBeUndefined();
		expect(record.env.HTTPS_PROXY).toBeUndefined();
		expect(record.env.NPM_CONFIG_REGISTRY).toBeUndefined();
		expect(record.env.npm_config_registry).toBe(CANONICAL_NPM_REGISTRY);
		expect(record.env.npm_config_userconfig?.startsWith(scenario.installRoot)).toBe(true);
		expect(record.env.npm_config_ignore_scripts).toBe("true");

		// Atomic publish of the versioned install tree, then fresh provenance from
		// the published bin itself (R33).
		expect(existsSync(publishedBinPath(scenario.installRoot))).toBe(true);
		const provenanceRead = scenario.recorder.spawnInputs.at(-1);
		expect(provenanceRead?.command).toBe(publishedBinPath(scenario.installRoot));
		expect(provenanceRead?.args).toEqual(["--version"]);
	});

	test("upgrade success: allowlisted transition executes and reaches fresh pin provenance (AE22)", async () => {
		const scenario = await runRepairScenario({
			mode: "--execute",
			observedVersion: "1.4.0",
		});
		expect(scenario.run.exitCode).toBe(0);
		const data = parseStdout(scenario.run).data as Record<string, unknown>;
		expect(data.performed).toBe("upgrade_adapter_to_pin");
		expect(data.observed_version).toBe(PINNED["chrome-devtools-mcp"]);
		expect(existsSync(publishedBinPath(scenario.installRoot))).toBe(true);
	});

	test("already at exact pin: execute performs nothing and mutates nothing", async () => {
		const scenario = await runRepairScenario({
			mode: "--execute",
			observedVersion: PINNED["chrome-devtools-mcp"],
		});
		expect(scenario.run.exitCode).toBe(0);
		const data = parseStdout(scenario.run).data as Record<string, unknown>;
		expect(data.outcome).toBe("repair_executed");
		expect(data.performed).toBe("none");
		expect(scenario.recorder.probeCalls).toEqual([]);
		expect(scenario.recorder.spawnInputs).toEqual([]);
		expect(existsSync(scenario.installRoot)).toBe(false);
	});
});

describe("browser-connect repair-adapter --execute: fail-closed stops (U5 R29/R34/AE23)", () => {
	function expectOperatorStop(run: DispatcherRun): Record<string, unknown> {
		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.status).toBe("error");
		expect(envelope.error?.code).toBe("operator_stop");
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect((envelope.continuation?.constraints ?? []).length).toBeGreaterThan(0);
		expect((envelope.continuation?.choices ?? []).length).toBeGreaterThan(0);
		const data = envelope.data as Record<string, unknown>;
		expect(data.outcome).toBe("repair_stopped");
		// Legacy compatibility stays non-mutating (R30/AE19): never a package
		// mutation action in the legacy data field.
		expect(data.next_action_id).not.toBe("install_adapter");
		expect(data.next_action_id).not.toBe("upgrade_adapter_to_pin");
		return data;
	}

	test("agent-browser execute → operator stop before any network (lifecycle scripts, R29)", async () => {
		const scenario = await runRepairScenario({
			mode: "--execute",
			adapterId: "agent-browser",
		});
		const data = expectOperatorStop(scenario.run);
		expect(data.stop_causes).toContain("lifecycle_scripts_required");
		expect(data.next_action_id).toBe("list_registered_adapters");
		expect(scenario.recorder.probeCalls).toEqual([]);
		expect(scenario.recorder.spawnInputs).toEqual([]);
		expect(existsSync(scenario.installRoot)).toBe(false);
	});

	const chromePolicy = chromeDevtoolsMcpDefinition.installPolicy;
	const lockPath = () => chromePolicy.integritySource.lockfilePath;
	const hostileLock = (entry: Record<string, unknown>): string =>
		JSON.stringify({
			lockfileVersion: 3,
			packages: {
				"": {
					name: "fixture",
					dependencies: { [chromePolicy.packageName]: PINNED["chrome-devtools-mcp"] },
				},
				[`node_modules/${chromePolicy.packageName}`]: entry,
			},
		});

	const hostileLockRows: ReadonlyArray<{ label: string; entry: Record<string, unknown> }> = [
		{
			label: "off-registry https origin",
			entry: {
				version: PINNED["chrome-devtools-mcp"],
				resolved: "https://mirror.evil.example/pkg.tgz",
				integrity: "sha512-fixture",
			},
		},
		{
			label: "git source",
			entry: {
				version: PINNED["chrome-devtools-mcp"],
				resolved: "git+https://github.com/x/pkg.git#abc",
				integrity: "sha512-fixture",
			},
		},
		{
			label: "file source",
			entry: { version: PINNED["chrome-devtools-mcp"], resolved: "file:../pkg", integrity: "sha512-fixture" },
		},
		{
			label: "workspace source",
			entry: { version: PINNED["chrome-devtools-mcp"], resolved: "workspace:*", integrity: "sha512-fixture" },
		},
		{
			label: "insecure http origin",
			entry: {
				version: PINNED["chrome-devtools-mcp"],
				resolved: "http://registry.npmjs.org/pkg.tgz",
				integrity: "sha512-fixture",
			},
		},
		{
			label: "unparseable resolved url",
			entry: { version: PINNED["chrome-devtools-mcp"], resolved: "::::", integrity: "sha512-fixture" },
		},
	];

	for (const row of hostileLockRows) {
		test(`${row.label} → stop with zero network and zero mutation (R34/AE23)`, async () => {
			const scenario = await runRepairScenario({
				mode: "--execute",
				files: { [lockPath()]: hostileLock(row.entry) },
			});
			const data = expectOperatorStop(scenario.run);
			expect(data.stop_causes).toContain("lock_origin_violation");
			expect(scenario.recorder.probeCalls).toEqual([]);
			expect(scenario.recorder.spawnInputs).toEqual([]);
			expect(existsSync(scenario.installRoot)).toBe(false);
		});
	}

	test("missing transitive integrity → stop before network (R29/AE18)", async () => {
		const scenario = await runRepairScenario({
			mode: "--execute",
			files: {
				[lockPath()]: hostileLock({
					version: PINNED["chrome-devtools-mcp"],
					resolved: `https://registry.npmjs.org/${chromePolicy.packageName}/-/x.tgz`,
				}),
			},
		});
		const data = expectOperatorStop(scenario.run);
		expect(data.stop_causes).toContain("integrity_incomplete");
		expect(scenario.recorder.probeCalls).toEqual([]);
	});

	test("lock drift against the manifest pin → stop before network (R29)", async () => {
		const scenario = await runRepairScenario({
			mode: "--execute",
			files: {
				[lockPath()]: hostileLock({
					version: "1.4.9",
					resolved: `https://registry.npmjs.org/${chromePolicy.packageName}/-/x-1.4.9.tgz`,
					integrity: "sha512-fixture",
				}),
			},
		});
		const data = expectOperatorStop(scenario.run);
		expect(data.stop_causes).toContain("lock_drift");
		expect(scenario.recorder.probeCalls).toEqual([]);
	});

	test("canonical-origin redirect → no redirected request, no spawn, no mutation (AE23)", async () => {
		const scenario = await runRepairScenario({ mode: "--execute", probeStatus: 301 });
		const data = expectOperatorStop(scenario.run);
		expect(data.stop_cause).toBe("registry_redirect");
		// Exactly one gate probe; the redirect target is never followed.
		expect(scenario.recorder.probeCalls).toEqual([
			`${CANONICAL_NPM_REGISTRY}/chrome-devtools-mcp`,
		]);
		expect(scenario.recorder.spawnInputs).toEqual([]);
		expect(existsSync(publishedBinPath(scenario.installRoot))).toBe(false);
	});

	test("no approved package-manager candidate exists → stop before network (R28)", async () => {
		const root = await makeRepairRoot();
		const scenario = await runRepairScenario({
			mode: "--execute",
			pmCandidates: [join(root, "missing-a"), join(root, "missing-b")],
		});
		const data = expectOperatorStop(scenario.run);
		expect(data.stop_cause).toBe("package_manager_unavailable");
		expect(scenario.recorder.probeCalls).toEqual([]);
		expect(scenario.recorder.spawnInputs).toEqual([]);
	});

	test("installer failure (prompt/privilege boundary simulation) → stop, nothing published (R22)", async () => {
		const scenario = await runRepairScenario({
			mode: "--execute",
			pm: { exitCode: 1 },
		});
		const data = expectOperatorStop(scenario.run);
		expect(data.stop_cause).toBe("installer_failed");
		expect(existsSync(publishedBinPath(scenario.installRoot))).toBe(false);
	});

	test("expected bin missing after install → stop, nothing published", async () => {
		const scenario = await runRepairScenario({
			mode: "--execute",
			pm: { createBin: false },
		});
		const data = expectOperatorStop(scenario.run);
		expect(data.stop_cause).toBe("expected_bin_missing");
		expect(existsSync(publishedBinPath(scenario.installRoot))).toBe(false);
	});

	test("fresh provenance mismatch after publish → honest operator stop (R33)", async () => {
		const scenario = await runRepairScenario({
			mode: "--execute",
			pm: { reportVersion: "9.9.9" },
		});
		const data = expectOperatorStop(scenario.run);
		expect(data.stop_cause).toBe("provenance_mismatch");
	});

	test("provenance mismatch removes the unproven published tree; a retry is never wedged on publish_conflict", async () => {
		const first = await runRepairScenario({
			mode: "--execute",
			pm: { reportVersion: "9.9.9" },
		});
		const firstData = expectOperatorStop(first.run);
		expect(firstData.stop_cause).toBe("provenance_mismatch");
		// The tree published, failed its own proof, and was removed (best
		// effort): an artifact this run refused to trust must not persist.
		expect(
			existsSync(
				join(first.installRoot, "chrome-devtools-mcp", PINNED["chrome-devtools-mcp"]),
			),
		).toBe(false);

		// A second --execute against the SAME install root proceeds past its
		// publish to its OWN provenance step — provenance_mismatch again, never
		// a publish_conflict wedge on the first run's leftover.
		const second = await runRepairScenario({
			mode: "--execute",
			pm: { reportVersion: "9.9.9" },
			installRoot: first.installRoot,
		});
		const secondData = expectOperatorStop(second.run);
		expect(secondData.stop_cause).toBe("provenance_mismatch");
	});

	test("execute on an operator-posture version state → stop, no mutation (R22)", async () => {
		const scenario = await runRepairScenario({
			mode: "--execute",
			observedVersion: "1.6.0",
		});
		expectOperatorStop(scenario.run);
		expect(scenario.recorder.probeCalls).toEqual([]);
		expect(scenario.recorder.spawnInputs).toEqual([]);
		expect(existsSync(scenario.installRoot)).toBe(false);
	});

	test("installer timeout → the whole installer process group is reaped, staging cleanup succeeds, sole stop installer_timeout", async () => {
		const root = await makeRepairRoot();
		const installRoot = join(root, "install-root");
		const childPidPath = join(root, "installer-child-pid");
		// A hanging fake package manager that mirrors npm's shape: it spawns its
		// OWN worker child, records that child's pid, then blocks far past the
		// clamped timeout (stdin is closed, so no prompt can ever answer).
		const pmPath = join(root, "hanging-pm");
		await fsWriteFile(
			pmPath,
			[
				"#!/usr/bin/env bun",
				'const child = Bun.spawn(["sleep", "600"]);',
				`await Bun.write(${JSON.stringify(childPidPath)}, String(child.pid));`,
				"await Bun.sleep(600_000);",
				"",
			].join("\n"),
			"utf8",
		);
		await chmod(pmPath, 0o755);
		const { engine } = recordingInstallEngine({
			env: { PATH: process.env.PATH, HOME: root, TMPDIR: tmpdir() },
		});
		// Clamp the executor's install timeout down to test scale while keeping
		// the REAL spawnAdapterCommand timeout-kill path at a real process
		// boundary.
		const clampedEngine: AdapterInstallEngine = {
			...engine,
			runCommand: (input) =>
				engine.runCommand({
					...input,
					timeoutMs: Math.min(input.timeoutMs, 2_000),
				}),
		};
		const definitions = [
			withInstallPolicy(chromeDevtoolsMcpDefinition, {
				packageManager: { approvedAbsoluteCandidates: [pmPath] },
			}),
			agentBrowserDefinition,
		];
		const run = await runDispatcher(
			[
				"repair-adapter",
				"chrome-devtools-mcp",
				"--execute",
				"--json",
				"--run-id",
				REPAIR_RUN_ID,
			],
			{
				warmChromeMain: neverWarmChrome,
				adapterRuntime: fakeAdapterRuntime({ version: {} }),
				...repairRegistryAccessors(definitions),
				adapterInstallEngine: clampedEngine,
				adapterInstallRoot: installRoot,
			},
		);

		// The sole surfaced stop is the timeout — no publish_conflict, no
		// cleanup-derived secondary stop.
		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("operator_stop");
		const data = envelope.data as Record<string, unknown>;
		expect(data.stop_cause).toBe("installer_timeout");
		// Staging cleanup succeeded despite the killed installer: no leftover
		// staging tree, nothing published.
		const leftovers = (await fsReaddir(installRoot)).filter((entry) =>
			entry.startsWith(".staging-"),
		);
		expect(leftovers).toEqual([]);
		expect(existsSync(publishedBinPath(installRoot))).toBe(false);
		// The installer's OWN child was reaped with it (process-GROUP kill): a
		// direct-child-only SIGKILL would leave this straggler alive, free to
		// write into staging during cleanup.
		const childPid = Number(await fsReadFile(childPidPath, "utf8"));
		expect(Number.isInteger(childPid) && childPid > 1).toBe(true);
		await expectProcessGone(childPid);
	}, 20_000);
});

/** Poll until a pid no longer exists (ESRCH), bounded — group-kill proof. */
async function expectProcessGone(pid: number): Promise<void> {
	const deadline = Date.now() + 5_000;
	for (;;) {
		try {
			process.kill(pid, 0);
		} catch {
			return; // The process no longer exists.
		}
		if (Date.now() > deadline) {
			throw new Error(`process ${pid} is still alive after the group kill`);
		}
		await Bun.sleep(50);
	}
}

// ===========================================================================
// U5 connect gate: typed adapter evidence (R11/R23/AE12/AE16). The gate feeds
// structured causes to repair-path selection and performs at most ONE bounded
// read-only re-probe for an explicitly transient attachment cause.
// ===========================================================================

describe("browser-connect connect gate: typed adapter evidence (U5 R11/R23)", () => {
	function sequencedProbeRuntime(sequence: readonly AdapterCommandResult[]): {
		runtime: AdapterRuntime;
		probeCount: () => number;
	} {
		let probes = 0;
		const runtime: AdapterRuntime = {
			env: {},
			resolveExecutable: (command) => ({ resolved: true, path: `/fake/bin/${command}` }),
			runCommand: async (input) => {
				if (input.args.includes("--version")) {
					return {
						exitCode: 0,
						stdout: `agent-browser ${PINNED["agent-browser"]}\n`,
						stderr: "",
					};
				}
				const result = sequence[Math.min(probes, sequence.length - 1)];
				probes += 1;
				return result ?? { exitCode: 0, stdout: "attached", stderr: "" };
			},
		};
		return { runtime, probeCount: () => probes };
	}

	test("transient probe failure then success → verified after exactly one re-probe (AE12)", async () => {
		const { runtime, probeCount } = sequencedProbeRuntime([
			{ exitCode: 1, stdout: "", stderr: "", timedOut: true },
			{ exitCode: 0, stdout: "attached", stderr: "" },
		]);
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime: runtime,
			...realRegistryAccessors(),
		});
		expect(run.exitCode).toBe(0);
		expect(parseStdout(run).status).toBe("ok");
		expect(probeCount()).toBe(2);
	});

	test("transient failure twice → attachment_failed with the spent re-probe budget typed (R23)", async () => {
		const { runtime, probeCount } = sequencedProbeRuntime([
			{ exitCode: 1, stdout: "", stderr: "", timedOut: true },
			{ exitCode: 1, stdout: "", stderr: "", timedOut: true },
		]);
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime: runtime,
			...realRegistryAccessors(),
		});
		expect(run.exitCode).toBe(20);
		expect(parseStdout(run).error?.code).toBe("attachment_failed");
		expect(probeCount()).toBe(2);
		expect(run.stderr).toContain('"cause":"transient_probe_failure"');
	});

	test("non-transient probe failure → no re-probe, probe_failed cause (R23)", async () => {
		const { runtime, probeCount } = sequencedProbeRuntime([
			{ exitCode: 3, stdout: "", stderr: "connection refused" },
		]);
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime: runtime,
			...realRegistryAccessors(),
		});
		expect(run.exitCode).toBe(20);
		expect(parseStdout(run).error?.code).toBe("attachment_failed");
		expect(probeCount()).toBe(1);
		expect(run.stderr).toContain('"cause":"probe_failed"');
	});

	test("adapter absent → executable_absent typed cause reaches the failure evidence", async () => {
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime: fakeAdapterRuntime({ unresolvable: ["agent-browser"] }),
			...realRegistryAccessors(),
		});
		expect(run.exitCode).toBe(20);
		expect(parseStdout(run).error?.code).toBe("adapter_not_installed");
		expect(run.stderr).toContain('"cause":"executable_absent"');
	});

	test("adapter version mismatch → version_mismatch typed cause reaches the failure evidence", async () => {
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(CONNECT_ARGV, {
			warmChromeMain,
			adapterRuntime: fakeAdapterRuntime({ version: { "agent-browser": "0.26.0" } }),
			...realRegistryAccessors(),
		});
		expect(run.exitCode).toBe(20);
		expect(parseStdout(run).error?.code).toBe("adapter_not_installed");
		expect(run.stderr).toContain('"cause":"version_mismatch"');
	});

	test("unknown adapter → unregistered_adapter typed cause reaches the failure evidence", async () => {
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
		expect(warmChromeCalls).toBe(0);
		expect(run.stderr).toContain('"cause":"unregistered_adapter"');
	});

	test("route incompatibility → route_unsupported cause with trusted candidates only (AE16/AE20)", async () => {
		// A registered-id definition whose only implemented route the environment
		// does not offer; the two real definitions stay listed as candidates.
		const uiOnly: AdapterDefinition = {
			...chromeDevtoolsMcpDefinition,
			id: "chrome-devtools-mcp",
			routes: [{ route: "ui-consent", evidence: "documented", implemented: true }],
		};
		const { main: warmChromeMain } = okScript();
		const run = await runDispatcher(
			["connect", "chrome-devtools-mcp", "--json", "--run-id", RUN_ID],
			{
				warmChromeMain,
				adapterRuntime: fakeAdapterRuntime({
					version: {
						"agent-browser": PINNED["agent-browser"],
						"chrome-devtools-mcp": PINNED["chrome-devtools-mcp"],
					},
				}),
				listAdapterDefinitions: () => [uiOnly, agentBrowserDefinition],
				findAdapterDefinition: (id) =>
					id === "chrome-devtools-mcp"
						? uiOnly
						: id === "agent-browser"
							? agentBrowserDefinition
							: undefined,
			},
		);
		expect(run.exitCode).toBe(20);
		expect(parseStdout(run).error?.code).toBe("route_incompatible");
		expect(run.stderr).toContain('"cause":"route_unsupported"');
	});
});

// ===========================================================================
// U4 hermetic repair-chain closures (R27/AE15). One success-path fixture per
// automatic action: induce its supported selecting failure, execute its
// declared owner or caller-rerun recipe, and reach its named successful
// follow-up proof — plus separate fixtures for declared stops asserting the
// named operator posture. install/upgrade safety stops are already covered
// exhaustively by the U5 fail-closed suite above (lock origins, redirect,
// package-manager, installer, bin, provenance, lifecycle, pin decisions).
// ===========================================================================

import { spawnRunWrappedCommand } from "../src/run-exec.ts";
import { spawnAdapterCommand as realSpawnAdapterCommand } from "../src/adapters/registry.ts";

const CLOSURE_RUN_ID = "u4-closure";

async function writeClosureExecutable(
	root: string,
	name: string,
	script: string,
): Promise<string> {
	const path = join(root, name);
	await fsWriteFile(path, script, "utf8");
	await chmod(path, 0o755);
	return path;
}

describe("repair-chain closure: change_input (U4 R27/AE15)", () => {
	test("selecting failure with a deterministic registered correction → corrected rerun reaches its gate", async () => {
		// Selecting failure: exactly one case-insensitive registered correction
		// makes change_input automatic (matrix arm).
		const failing = await runDispatcher(
			["connect", "AGENT-BROWSER", "--json", "--run-id", CLOSURE_RUN_ID],
			{
				warmChromeMain: async () => {
					throw new Error("no environment work before the usage gate");
				},
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(failing.exitCode).toBe(2);
		const failingEnvelope = parseStdout(failing);
		expect(failingEnvelope.continuation?.next_action_id).toBe("change_input");
		expect(failingEnvelope.data?.next_action_id).toBe("change_input");

		// Caller-rerun recipe: a fresh invocation with the corrected trusted id.
		// Named follow-up proof: it parses and reaches (and passes) its gate.
		const rerun = await runDispatcher(
			["connect", "agent-browser", "--json", "--run-id", CLOSURE_RUN_ID],
			{
				warmChromeMain: okScript().main,
				adapterRuntime: fakeAdapterRuntime({
					version: {
						"agent-browser": PINNED["agent-browser"],
						"chrome-devtools-mcp": PINNED["chrome-devtools-mcp"],
					},
				}),
				...realRegistryAccessors(),
			},
		);
		expect(rerun.exitCode).toBe(0);
		expect((parseStdout(rerun).data as { outcome: string }).outcome).toBe(
			"verified",
		);
	});

	test("declared stop: no deterministic replacement → operator handoff, never a synthesized correction", async () => {
		const run = await runDispatcher(
			["connect", "no-such-adapter", "--json", "--run-id", CLOSURE_RUN_ID],
			{
				warmChromeMain: async () => 0,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(run.exitCode).toBe(2);
		const envelope = parseStdout(run);
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(envelope.continuation?.next_action_id).toBeUndefined();
		expect(
			(envelope.continuation?.constraints ?? []).map((c) => c.id),
		).toContain("no_synthesized_caller_input");
	});
});

describe("repair-chain closure: add_run_separator (U4 R27/AE15)", () => {
	test("selecting failure with parser-memory command → rerun with -- reaches exec passthrough", async () => {
		const root = await makeRepairRoot();
		const tool = await writeClosureExecutable(
			root,
			"wrapped-ok",
			"#!/bin/sh\nexit 0\n",
		);

		// Selecting failure: `--` missing, wrapped command held only in parser
		// memory → automatic add_run_separator; the words never serialize (R26).
		const failing = await runDispatcher(
			["run", "agent-browser", tool, "--run-id", CLOSURE_RUN_ID],
			{
				warmChromeMain: async () => {
					throw new Error("no environment work for a parse failure");
				},
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(failing.exitCode).toBe(2);
		const failingEnvelope = parseStderrEnvelope(failing);
		expect(failingEnvelope.continuation?.next_action_id).toBe(
			"add_run_separator",
		);
		expect(failing.stderr).not.toContain(root);

		// Caller-rerun recipe: the same invocation with the `--` boundary. The
		// wrapped command is a REAL executable driven by the REAL spawner —
		// named follow-up proof: the rerun passes the pre-exec gate and the
		// wrapped tool's exit passes through.
		const rerun = await runDispatcher(
			["run", "agent-browser", "--run-id", CLOSURE_RUN_ID, "--", tool],
			{
				warmChromeMain: okScript().main,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: spawnRunWrappedCommand,
			},
		);
		expect(rerun.exitCode).toBe(0);
		expect(parseStderrEnvelope(rerun).status).toBe("ok");
	});

	test("declared stop: empty or unknown wrapped command → operator input stage", async () => {
		const run = await runDispatcher(
			["run", "agent-browser", "--run-id", CLOSURE_RUN_ID, "--"],
			{
				warmChromeMain: async () => 0,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(run.exitCode).toBe(2);
		const envelope = parseStderrEnvelope(run);
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(continuationChoiceIds(envelope)).toEqual(["provide_wrapped_command"]);
	});
});

describe("repair-chain closure: launch_agent_chrome (U4 R27/AE15)", () => {
	test("selecting failure (check absent) → gateway owner launches and the recheck verifies the same explicit port", async () => {
		// Selecting failure: check reports the environment absent with the
		// explicit port proven free → automatic launch_agent_chrome.
		const failing = await runDispatcher(
			["check", "--port", "9250", "--json", "--run-id", CLOSURE_RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([absentStep]).main,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(failing.exitCode).toBe(20);
		const failingEnvelope = parseStdout(failing);
		expect(failingEnvelope.continuation?.next_action_id).toBe(
			"launch_agent_chrome",
		);

		// Owner execution: the gateway drives launch inside connect. Named
		// follow-up proof: the recheck verifies Agent Chrome on the SAME
		// explicit port and the handoff records launched provenance.
		const { main: warmChromeMain, calls } = scriptedWarmChromeMain([
			absentStep,
			okStepAt("9250"),
			okStepAt("9250"),
		]);
		const rerun = await runDispatcher(
			[
				"connect",
				"agent-browser",
				"--port",
				"9250",
				"--json",
				"--run-id",
				CLOSURE_RUN_ID,
			],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
			},
		);
		expect(rerun.exitCode).toBe(0);
		const data = parseStdout(rerun).data as { launch: { launched: boolean } };
		expect(data.launch.launched).toBe(true);
		expect(calls.map(commandWord)).toEqual(["check", "launch", "check"]);
		expect(calls.map(warmChromePortArg)).toEqual(["9250", "9250", "9250"]);
	});

	test("declared stop: exhausted launch attempt → launch_failed operator posture", async () => {
		const run = await runDispatcher(
			["connect", "agent-browser", "--json", "--run-id", CLOSURE_RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([absentStep, absentStep]).main,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
			},
		);
		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.error?.code).toBe("launch_failed");
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(continuationChoiceIds(envelope)).toEqual(["inspect_diagnostics"]);
	});
});

describe("repair-chain closure: use_suggested_port (U4 R27/AE3/AE15)", () => {
	test("selecting failure (occupied with verified suggestion) → one fresh hop-1 invocation verifies and attaches", async () => {
		// Selecting failure at hop 0: the suggestion is preserved and selected.
		const failing = await runDispatcher(
			[
				"connect",
				"agent-browser",
				"--port",
				"9222",
				"--json",
				"--run-id",
				CLOSURE_RUN_ID,
			],
			{
				warmChromeMain: scriptedWarmChromeMain([occupiedStep(9333)]).main,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
			},
		);
		expect(failing.exitCode).toBe(20);
		const failingEnvelope = parseStdout(failing);
		expect(failingEnvelope.continuation?.next_action_id).toBe(
			"use_suggested_port",
		);
		expect(failingEnvelope.data?.next_action_id).toBe("use_suggested_port");
		// The rerun's port is machine-readable envelope evidence (R6) — the
		// recipe below consumes THIS value, not a scraped stderr diagnostic.
		expect(failingEnvelope.data?.suggested_explicit_port).toEqual({
			port: 9333,
			verified_free: true,
		});

		// Caller-rerun recipe: ONE fresh invocation with the suggested explicit
		// port at repair-chain hop 1. Named follow-up proof: the fresh
		// invocation verifies Agent Chrome and proves adapter attachment.
		const { main: warmChromeMain, calls } = scriptedWarmChromeMain([
			okStepAt("9333"),
		]);
		const rerun = await runDispatcher(
			[
				"connect",
				"agent-browser",
				"--port",
				"9333",
				"--repair-chain-hop",
				"1",
				"--json",
				"--run-id",
				CLOSURE_RUN_ID,
			],
			{
				warmChromeMain,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
			},
		);
		expect(rerun.exitCode).toBe(0);
		const data = parseStdout(rerun).data as {
			outcome: string;
			attachment: { adapter_id: string };
			endpoint: { ws: string };
		};
		expect(data.outcome).toBe("verified");
		expect(data.attachment.adapter_id).toBe("agent-browser");
		expect(data.endpoint.ws).toContain("9333");
		expect(calls.map(warmChromePortArg)).toEqual(["9333"]);
	});

	test("declared stop: a hop-1 failure emits an operator stage and never another suggested-port action", async () => {
		const run = await runDispatcher(
			[
				"connect",
				"agent-browser",
				"--port",
				"9333",
				"--repair-chain-hop",
				"1",
				"--json",
				"--run-id",
				CLOSURE_RUN_ID,
			],
			{
				warmChromeMain: scriptedWarmChromeMain([occupiedStep(9444)]).main,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
			},
		);
		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(envelope.continuation?.next_action_id).toBeUndefined();
		expect(continuationChoiceIds(envelope)).toEqual(["inspect_listener"]);
		expect(
			(envelope.runtime_actions ?? []).map((action) => action.id),
		).not.toContain("use_suggested_port");
	});

	test("declared stop: the check surface preserves the suggestion but emits an operator diagnostic posture", async () => {
		const run = await runDispatcher(
			["check", "--json", "--run-id", CLOSURE_RUN_ID],
			{
				warmChromeMain: scriptedWarmChromeMain([occupiedStep(9333)]).main,
				adapterRuntime: fakeAdapterRuntime({}),
				...realRegistryAccessors(),
			},
		);
		expect(run.exitCode).toBe(20);
		const envelope = parseStdout(run);
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(envelope.continuation?.next_action_id).toBeUndefined();
	});
});

describe("repair-chain closure: install_adapter (U4 R27/AE15/AE22)", () => {
	test("selecting failure (absent adapter) → repair-adapter --execute installs → the original connect proves attachment through the published bin", async () => {
		// 1. Selecting failure: connect finds the adapter absent with a complete
		// isolated recipe → automatic install_adapter.
		const failing = await runDispatcher(
			["connect", "chrome-devtools-mcp", "--json", "--run-id", CLOSURE_RUN_ID],
			{
				warmChromeMain: okScript().main,
				adapterRuntime: fakeAdapterRuntime({ version: {} }),
				...realRegistryAccessors(),
			},
		);
		expect(failing.exitCode).toBe(20);
		expect(parseStdout(failing).continuation?.next_action_id).toBe(
			"install_adapter",
		);

		// 2. Owner execution: the SOLE package-mutation path, with the fake
		// package manager spawned at a real process boundary (U5 engine).
		const scenario = await runRepairScenario({ mode: "--execute" });
		expect(scenario.run.exitCode).toBe(0);
		const executed = parseStdout(scenario.run).data as Record<string, unknown>;
		expect(executed.performed).toBe("install_adapter");
		const publishedBin = publishedBinPath(scenario.installRoot);
		expect(existsSync(publishedBin)).toBe(true);

		// 3. Named follow-up proof: the original connect proves attachment — the
		// provenance read AND the attachment probe run the PUBLISHED artifact
		// through real process spawns.
		const publishedRuntime: AdapterRuntime = {
			env: {},
			resolveExecutable: (command) =>
				command === "chrome-devtools-mcp"
					? { resolved: true, path: publishedBin }
					: { resolved: false },
			runCommand: realSpawnAdapterCommand,
		};
		const rerun = await runDispatcher(
			["connect", "chrome-devtools-mcp", "--json", "--run-id", CLOSURE_RUN_ID],
			{
				warmChromeMain: okScript().main,
				adapterRuntime: publishedRuntime,
				...realRegistryAccessors(),
			},
		);
		expect(rerun.exitCode).toBe(0);
		const data = parseStdout(rerun).data as {
			outcome: string;
			attachment: { adapter_id: string; probe_executable: string };
		};
		expect(data.outcome).toBe("verified");
		expect(data.attachment.adapter_id).toBe("chrome-devtools-mcp");
		expect(data.attachment.probe_executable).toBe(publishedBin);
	}, 30_000);

	test("production resolver closure: the follow-up connect resolves the published tree through the REAL production resolver (no hand-wired resolver)", async () => {
		// 1. Publish via the hermetic engine into an install root shaped EXACTLY
		// like production's derivation: $HOME/.side-quest/browser-connect/adapters.
		const home = await makeRepairRoot();
		const scenario = await runRepairScenario({
			mode: "--execute",
			installRoot: join(home, ".side-quest", "browser-connect", "adapters"),
		});
		expect(scenario.run.exitCode).toBe(0);
		const publishedBin = publishedBinPath(scenario.installRoot);
		expect(existsSync(publishedBin)).toBe(true);

		// 2. Follow-up connect with the PRODUCTION adapter runtime. The resolver's
		// install-root derivation reads env HOME fresh per call — the same seam
		// production reads — so point HOME at the published tree's home. PATH is
		// controlled (bun's own dir for shebangs plus system dirs, no global npm
		// bins) so Bun.which provably MISSES and PATH precedence is not in play.
		const savedHome = process.env.HOME;
		const savedPath = process.env.PATH;
		process.env.HOME = home;
		process.env.PATH = `${dirname(process.execPath)}:/usr/bin:/bin`;
		let rerun: DispatcherRun;
		try {
			rerun = await runDispatcher(
				["connect", "chrome-devtools-mcp", "--json", "--run-id", CLOSURE_RUN_ID],
				{
					warmChromeMain: okScript().main,
					adapterRuntime: createProductionAdapterRuntime(),
					...realRegistryAccessors(),
				},
			);
		} finally {
			if (savedHome === undefined) delete process.env.HOME;
			else process.env.HOME = savedHome;
			if (savedPath === undefined) delete process.env.PATH;
			else process.env.PATH = savedPath;
		}

		// 3. Named follow-up proof: provenance AND the attachment probe ran the
		// PUBLISHED bin the production resolver found — the repair chain closes
		// with zero hand-wired resolution.
		expect(rerun.exitCode).toBe(0);
		const data = parseStdout(rerun).data as {
			outcome: string;
			attachment: { adapter_id: string; probe_executable: string };
		};
		expect(data.outcome).toBe("verified");
		expect(data.attachment.adapter_id).toBe("chrome-devtools-mcp");
		expect(data.attachment.probe_executable).toBe(publishedBin);
	}, 30_000);
});

describe("repair-chain closure: upgrade_adapter_to_pin (U4 R27/AE5/AE15)", () => {
	test("selecting failure (allowlisted mismatch) → repair-adapter --execute upgrades → the original connect proves attachment", async () => {
		// 1. Selecting failure: an exact allowlisted observed-to-pin transition
		// selects the automatic upgrade (AE5).
		const failing = await runDispatcher(
			["connect", "chrome-devtools-mcp", "--json", "--run-id", CLOSURE_RUN_ID],
			{
				warmChromeMain: okScript().main,
				adapterRuntime: fakeAdapterRuntime({
					version: { "chrome-devtools-mcp": "1.4.0" },
				}),
				...realRegistryAccessors(),
			},
		);
		expect(failing.exitCode).toBe(20);
		expect(parseStdout(failing).continuation?.next_action_id).toBe(
			"upgrade_adapter_to_pin",
		);

		// 2. Owner execution through repair-adapter --execute.
		const scenario = await runRepairScenario({
			mode: "--execute",
			observedVersion: "1.4.0",
		});
		expect(scenario.run.exitCode).toBe(0);
		const executed = parseStdout(scenario.run).data as Record<string, unknown>;
		expect(executed.performed).toBe("upgrade_adapter_to_pin");
		const publishedBin = publishedBinPath(scenario.installRoot);
		expect(existsSync(publishedBin)).toBe(true);

		// 3. Named follow-up proof: attachment through the published bin.
		const publishedRuntime: AdapterRuntime = {
			env: {},
			resolveExecutable: (command) =>
				command === "chrome-devtools-mcp"
					? { resolved: true, path: publishedBin }
					: { resolved: false },
			runCommand: realSpawnAdapterCommand,
		};
		const rerun = await runDispatcher(
			["connect", "chrome-devtools-mcp", "--json", "--run-id", CLOSURE_RUN_ID],
			{
				warmChromeMain: okScript().main,
				adapterRuntime: publishedRuntime,
				...realRegistryAccessors(),
			},
		);
		expect(rerun.exitCode).toBe(0);
		expect(
			(parseStdout(rerun).data as { outcome: string }).outcome,
		).toBe("verified");
	}, 30_000);
});

describe("repair-chain closure: fix_wrapped_command (U4 R27/AE15)", () => {
	test("selecting failure (real missing wrapped binary) → corrected rerun starts and its exit passes through", async () => {
		const root = await makeRepairRoot();
		const missing = join(root, "missing-tool");
		const good = await writeClosureExecutable(
			root,
			"good-tool",
			"#!/bin/sh\nexit 0\n",
		);

		// Selecting failure: the REAL spawner reports spawn-failed for a
		// genuinely missing binary → wrapped_not_found with the fix choice.
		const failing = await runDispatcher(
			["run", "agent-browser", "--run-id", CLOSURE_RUN_ID, "--", missing],
			{
				warmChromeMain: okScript().main,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: spawnRunWrappedCommand,
			},
		);
		expect(failing.exitCode).toBe(127);
		const envelopes = stderrJsonLines(failing);
		expect(envelopes[1]?.error?.code).toBe("wrapped_not_found");
		const wrappedEnvelope = envelopes[1];
		if (!wrappedEnvelope) throw new Error("unreachable");
		expect(continuationChoiceIds(wrappedEnvelope)).toEqual([
			"fix_wrapped_command",
		]);
		// The missing binary's path never serializes (R26).
		expect(failing.stderr).not.toContain(root);

		// Caller-rerun recipe: a fresh run with the corrected wrapped command.
		// Named follow-up proof: the wrapped command starts and its exit passes
		// through unchanged.
		const rerun = await runDispatcher(
			["run", "agent-browser", "--run-id", CLOSURE_RUN_ID, "--", good],
			{
				warmChromeMain: okScript().main,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: spawnRunWrappedCommand,
			},
		);
		expect(rerun.exitCode).toBe(0);
		expect(parseStderrEnvelope(rerun).status).toBe("ok");
	});

	test("declared stop: an unsafe wrapped-executable identity degrades to diagnostics (R26)", async () => {
		const run = await runDispatcher(
			["run", "agent-browser", "--run-id", CLOSURE_RUN_ID, "--", "bad~~name!!"],
			{
				warmChromeMain: okScript().main,
				adapterRuntime: installedRunRuntime(),
				...realRegistryAccessors(),
				runSpawner: async () => ({
					outcome: "spawn-failed",
					detail: "spawn failed",
				}),
			},
		);
		expect(run.exitCode).toBe(127);
		const envelope = parseStderrEnvelope(run);
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(continuationChoiceIds(envelope)).toEqual(["inspect_diagnostics"]);
		expect(run.stderr).not.toContain("bad~~name!!");
	});
});
