import { describe, expect, test } from "bun:test";

import {
	WARM_CHROME_CHECK_REASONS,
	type WarmChromeCheckErrorCode,
} from "@side-quest/warm-chrome";
import type { WarmChromeMainDeps } from "@side-quest/warm-chrome/cli";

import {
	proveAgentChromeEnvironment,
	WARM_CHROME_REASON_TO_ENVIRONMENT_CAUSE,
	WARM_CHROME_REASON_TO_FAILURE_CLASS,
	type EnvironmentGatewayDeps,
	type EnvironmentGatewayResult,
} from "../src/environment.ts";

// ---------------------------------------------------------------------------
// U3 environment gateway: explicit-port forwarding (R15/KTD4/KTD7) and typed
// repair-context preservation (R6/R10). Scaffolding mirrors entrypoint.test.ts:
// a scripted warm-chrome `main` pinned to the real envelope shapes, no real
// Chrome.
// ---------------------------------------------------------------------------

function liveCleanProfilePosture(port: string, browserPid = 4242) {
	return {
		state: "live-clean",
		disk: {
			save_setting: "disabled",
			auto_signin_setting: "disabled",
			sync_setting: "disabled",
			stored_login: "live-observed-absent",
		},
		process: {
			disable_sync_switch: "present",
			disable_extensions_switch: "present",
		},
		effective: {
			observation: "running-chrome",
			save_capability: "disabled",
			fill_exposure: "no-source",
			sync_state: "disabled",
			save_prompt: "suppressed",
			observer: {
				source: "chrome-webui",
				browser_pid: browserPid,
				port,
				profile_match: "exact",
				observed_at_ms: 1,
			},
		},
	} as const;
}

function okEnvelope(input: {
	endpoint: string;
	ws: string;
	profilePosture?: unknown;
	reportedPort?: string;
	contractId?: string;
	schemaVersion?: string;
}): string {
	const port = input.reportedPort ?? new URL(input.endpoint).port;
	const browserPid = 4242;
	return `${JSON.stringify(
		{
			status: "ok",
			run_id: RUN_ID,
			data: {
				contract_id: input.contractId ?? "warm-chrome.browser-entry",
				schema_version: input.schemaVersion ?? "2",
				ok: true,
				action: "browser_ready",
				command: "check",
				endpoint: input.endpoint,
				port,
				browser_pid: browserPid,
				web_socket_debugger_url: input.ws,
				credential_posture:
					input.profilePosture ?? liveCleanProfilePosture(port, browserPid),
			},
		},
		null,
		2,
	)}\n`;
}

function errorEnvelope(input: {
	code: string;
	reason: string;
	suggestedExplicitPort?: number;
}): string {
	return `${JSON.stringify(
		{
			status: "error",
			run_id: RUN_ID,
			process_exit_code: 20,
			error: {
				code: input.code,
				message: `warm-chrome check rejected: ${input.code}`,
				exit_code: 20,
				severity: "error",
				failure_domain: "browser_entry_handoff",
			},
			data: {
				contract_id: "warm-chrome.browser-entry",
				schema_version: "2",
				reason: input.reason,
				...(input.suggestedExplicitPort === undefined
					? {}
					: { suggested_explicit_port: input.suggestedExplicitPort }),
			},
		},
		null,
		2,
	)}\n`;
}

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

const RUN_ID = "environment-run";

function commandWord(argv: readonly string[]): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--run-id" || arg === "--port") {
			index += 1; // skip its value
			continue;
		}
		if (arg?.startsWith("--")) continue;
		return arg;
	}
	return undefined;
}

/** The `--port <value>` pair each warm-chrome invocation carried, if any. */
function portArg(argv: readonly string[]): string | undefined {
	const index = argv.indexOf("--port");
	return index === -1 ? undefined : argv[index + 1];
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

function expectFailed(
	result: EnvironmentGatewayResult,
): Extract<EnvironmentGatewayResult, { outcome: "failed" }> {
	expect(result.outcome).toBe("failed");
	if (result.outcome !== "failed") throw new Error("unreachable");
	return result;
}

const absentStep = {
	envelope: errorEnvelope({ code: "endpoint_unreachable", reason: "no_listener" }),
	exitCode: 20,
} as const;

const okStep = (port: string) =>
	({
		envelope: okEnvelope({
			endpoint: `http://127.0.0.1:${port}`,
			ws: `ws://127.0.0.1:${port}/devtools/browser/id`,
		}),
		exitCode: 0,
	}) as const;

describe("environment gateway explicit-port forwarding (U3 R15/KTD4/KTD7)", () => {
	test("configuration-only posture cannot mint a verified handoff", async () => {
		const { main } = scriptedWarmChromeMain([
			{
				envelope: okEnvelope({
					endpoint: "http://127.0.0.1:9333",
					ws: "ws://127.0.0.1:9333/devtools/browser/id",
					profilePosture: {
						...liveCleanProfilePosture("9333"),
						state: "configuration-only",
						effective: { observation: "not-observed" },
					},
				}),
				exitCode: 0,
			},
		]);

		const failed = expectFailed(
			await proveAgentChromeEnvironment(
				baseDeps(main, { explicitPort: 9333 }),
			),
		);

		expect(failed.failure_class).toBe("foreign-listener");
		expect(failed.repair_context.cause).toBe("unverified_listener");
	});

	test("posture with an unknown key cannot mint a verified handoff", async () => {
		const { main } = scriptedWarmChromeMain([
			{
				envelope: okEnvelope({
					endpoint: "http://127.0.0.1:9333",
					ws: "ws://127.0.0.1:9333/devtools/browser/id",
					profilePosture: {
						...liveCleanProfilePosture("9333"),
						untrusted_extension: true,
					},
				}),
				exitCode: 0,
			},
		]);

		const failed = expectFailed(
			await proveAgentChromeEnvironment(
				baseDeps(main, { explicitPort: 9333 }),
			),
		);

		expect(failed.failure_class).toBe("foreign-listener");
		expect(failed.repair_context.cause).toBe("unverified_listener");
	});

	test("foreign Warm Chrome contract provenance cannot mint a handoff", async () => {
		for (const override of [
			{ contractId: "foreign.contract" },
			{ schemaVersion: "999" },
		]) {
			const { main } = scriptedWarmChromeMain([
				{
					envelope: okEnvelope({
						endpoint: "http://127.0.0.1:9333",
						ws: "ws://127.0.0.1:9333/devtools/browser/id",
						...override,
					}),
					exitCode: 0,
				},
			]);

			const failed = expectFailed(
				await proveAgentChromeEnvironment(
					baseDeps(main, { explicitPort: 9333 }),
				),
			);
			expect(failed.repair_context.cause).toBe("unverified_listener");
		}
	});

	test("posture observer must match the enclosing browser pid and port", async () => {
		for (const profilePosture of [
			liveCleanProfilePosture("9444"),
			liveCleanProfilePosture("9333", 5252),
		]) {
			const { main } = scriptedWarmChromeMain([
				{
					envelope: okEnvelope({
						endpoint: "http://127.0.0.1:9333",
						ws: "ws://127.0.0.1:9333/devtools/browser/id",
						profilePosture,
					}),
					exitCode: 0,
				},
			]);

			const failed = expectFailed(
				await proveAgentChromeEnvironment(
					baseDeps(main, { explicitPort: 9333 }),
				),
			);

			expect(failed.failure_class).toBe("foreign-listener");
			expect(failed.repair_context.cause).toBe("unverified_listener");
		}

		const { main } = scriptedWarmChromeMain([
			{
				envelope: okEnvelope({
					endpoint: "http://127.0.0.1:9333",
					ws: "ws://127.0.0.1:9333/devtools/browser/id",
					reportedPort: "9444",
					profilePosture: liveCleanProfilePosture("9444"),
				}),
				exitCode: 0,
			},
		]);
		expectFailed(
			await proveAgentChromeEnvironment(
				baseDeps(main, { explicitPort: 9333 }),
			),
		);
	});

	test("forwards the validated explicit port to check and takes the endpoint verbatim", async () => {
		const { main, calls } = scriptedWarmChromeMain([okStep("9333")]);

		const result = await proveAgentChromeEnvironment(
			baseDeps(main, { explicitPort: 9333 }),
		);

		expect(result.outcome).toBe("verified");
		if (result.outcome !== "verified") throw new Error("unreachable");
		expect(portArg(calls[0] ?? [])).toBe("9333");
		// Endpoint forms stay verbatim from the ok envelope — never derived from
		// the port convention (R8 lineage).
		expect(result.endpoint.ws).toBe("ws://127.0.0.1:9333/devtools/browser/id");
	});

	test("verified reuse short-circuits launch: one check, launched false (R5/F1)", async () => {
		const { main, calls } = scriptedWarmChromeMain([okStep("9333")]);

		const result = await proveAgentChromeEnvironment(
			baseDeps(main, { explicitPort: 9333, autoLaunch: true }),
		);

		expect(result.outcome).toBe("verified");
		if (result.outcome !== "verified") throw new Error("unreachable");
		expect(result.launch.launched).toBe(false);
		// Fast path: exactly one warm-chrome invocation — check, never launch.
		expect(calls).toHaveLength(1);
		expect(commandWord(calls[0] ?? [])).toBe("check");
	});

	test("carries the SAME explicit port through check, launch, and recheck (R15)", async () => {
		const { main, calls } = scriptedWarmChromeMain([
			absentStep,
			okStep("9333"),
			okStep("9333"),
		]);

		const result = await proveAgentChromeEnvironment(
			baseDeps(main, { explicitPort: 9333, autoLaunch: true }),
		);

		expect(result.outcome).toBe("verified");
		if (result.outcome !== "verified") throw new Error("unreachable");
		expect(result.launch.launched).toBe(true);
		expect(calls.map(commandWord)).toEqual(["check", "launch", "check"]);
		// KTD7: the gateway passes the one validated value unchanged to every hop.
		expect(calls.map(portArg)).toEqual(["9333", "9333", "9333"]);
	});

	test("default-port behavior unchanged: no --port argument when explicitPort is absent", async () => {
		const { main, calls } = scriptedWarmChromeMain([okStep("9222")]);

		const result = await proveAgentChromeEnvironment(baseDeps(main));

		expect(result.outcome).toBe("verified");
		expect(calls[0]).not.toContain("--port");
	});

	test("launch fires only after typed absence: an occupied port never launches (KTD4)", async () => {
		const { main, calls } = scriptedWarmChromeMain([
			{
				envelope: errorEnvelope({
					code: "port_occupied_foreign",
					reason: "foreign_listener",
				}),
				exitCode: 20,
			},
		]);

		const failed = expectFailed(
			await proveAgentChromeEnvironment(
				baseDeps(main, { explicitPort: 9333, autoLaunch: true }),
			),
		);

		expect(failed.failure_class).toBe("foreign-listener");
		expect(failed.launch.launched).toBe(false);
		// Fail closed: one check, no launch against an occupied port.
		expect(calls.map(commandWord)).toEqual(["check"]);
	});
});

describe("environment gateway typed repair context (U3 R6/R10)", () => {
	test("preserves the warm-chrome suggestion as typed evidence and never consumes it in-invocation", async () => {
		const { main, calls } = scriptedWarmChromeMain([
			{
				envelope: errorEnvelope({
					code: "port_occupied_foreign",
					reason: "foreign_listener",
					suggestedExplicitPort: 9333,
				}),
				exitCode: 20,
			},
		]);

		const failed = expectFailed(
			await proveAgentChromeEnvironment(baseDeps(main, { autoLaunch: true })),
		);

		expect(failed.repair_context).toEqual({
			failure_class: "foreign-listener",
			cause: "occupied_listener",
			suggested_explicit_port: { port: 9333, verified_free: true },
		});
		// no_internal_port_switch: the failed invocation makes NO further
		// warm-chrome call and never retries the suggested port itself.
		expect(calls).toHaveLength(1);
		expect(calls.flat()).not.toContain("9333");
	});

	test("environment absence carries the typed no_listener context with explicit_port_free", async () => {
		const { main } = scriptedWarmChromeMain([absentStep]);

		const failed = expectFailed(
			await proveAgentChromeEnvironment(baseDeps(main, { explicitPort: 9333 })),
		);

		expect(failed.failure_class).toBe("environment-absent");
		expect(failed.repair_context).toEqual({
			failure_class: "environment-absent",
			cause: "no_listener",
			explicit_port_free: true,
		});
	});

	test("a failed launch yields the typed launch_failed context with launched false", async () => {
		const { main } = scriptedWarmChromeMain([absentStep, absentStep]);

		const failed = expectFailed(
			await proveAgentChromeEnvironment(baseDeps(main, { autoLaunch: true })),
		);

		expect(failed.failure_class).toBe("launch-failed");
		expect(failed.launch.launched).toBe(false);
		expect(failed.repair_context).toEqual({
			failure_class: "launch-failed",
			cause: "launch_failed",
		});
	});

	test("bounded recheck: a failed re-prove ends the invocation with no further warm-chrome call (R23/KTD12)", async () => {
		const { main, calls } = scriptedWarmChromeMain([
			absentStep,
			okStep("9333"),
			absentStep,
		]);

		const failed = expectFailed(
			await proveAgentChromeEnvironment(
				baseDeps(main, { explicitPort: 9333, autoLaunch: true }),
			),
		);

		expect(failed.failure_class).toBe("launch-failed");
		expect(failed.launch.launched).toBe(true);
		expect(failed.repair_context).toEqual({
			failure_class: "launch-failed",
			cause: "launch_failed",
		});
		// The one in-invocation recheck is spent; the gateway never loops (R23).
		expect(calls.map(commandWord)).toEqual(["check", "launch", "check"]);
		expect(calls.map(portArg)).toEqual(["9333", "9333", "9333"]);
	});

	test("every warm-chrome check code maps to a typed cause consistent with its failure class (R10)", async () => {
		for (const code of Object.keys(
			WARM_CHROME_CHECK_REASONS,
		) as WarmChromeCheckErrorCode[]) {
			const reasons = WARM_CHROME_CHECK_REASONS[code];
			const { main } = scriptedWarmChromeMain([
				{
					envelope: errorEnvelope({ code, reason: reasons[0] ?? code }),
					exitCode: 20,
				},
			]);

			const failed = expectFailed(
				await proveAgentChromeEnvironment(baseDeps(main)),
			);

			const expectedCause = WARM_CHROME_REASON_TO_ENVIRONMENT_CAUSE[code];
			expect(failed.repair_context.cause).toBe(expectedCause);
			expect(failed.failure_class).toBe(
				WARM_CHROME_REASON_TO_FAILURE_CLASS[code],
			);
			// Cross-record consistency: the absent class pairs with no_listener and
			// nothing else; every foreign class pairs with a listener cause.
			expect(failed.failure_class === "environment-absent").toBe(
				expectedCause === "no_listener",
			);
		}
	});

	test("an unparseable warm-chrome capture fails closed to an unverified-listener context (R9)", async () => {
		const { main } = scriptedWarmChromeMain([{ envelope: "", exitCode: 0 }]);

		const failed = expectFailed(await proveAgentChromeEnvironment(baseDeps(main)));

		expect(failed.failure_class).toBe("foreign-listener");
		expect(failed.repair_context).toEqual({
			failure_class: "foreign-listener",
			cause: "unverified_listener",
		});
	});
});
