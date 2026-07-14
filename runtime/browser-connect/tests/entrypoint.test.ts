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
	return `${JSON.stringify({
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
	})}\n`;
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
	return `${JSON.stringify({
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
		runtime_actions: [{ id: "launch_warm_chrome", summary: "…", side_effects: ["browser"] }],
		continuation: { next_action_id: "launch_warm_chrome" },
	})}\n`;
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
