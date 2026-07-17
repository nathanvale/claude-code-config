import { describe, expect, test } from "bun:test";
import { resolveMcporterCommandVector } from "./mcporter-transport";
import {
	ENVELOPE_ADAPTER_CALL_ENV,
	envelopeAdapterCallArgs,
	runBrowserUseMcporter,
	runEnvelopeAdapterCall,
} from "./browser-use-transport";
import {
	capturingRuntime,
	commandVector,
	makeRuntime,
} from "./browser-use-test-helpers";

// Per-module tests for browser-use-transport.ts (carved from U4 block, plan U10).
// runBrowserUseMcporter is imported directly from ./browser-use-transport so the
// mcporter neutral-outcome -> operation-failure mapping coverage attributes to
// the module under test.

// Representative envelope-derived args (the only live call form since U3);
// the mapping tests below treat them as opaque pass-through argv.
const TRANSPORT_ARGS = envelopeAdapterCallArgs({
	probeExecutable: "/pinned/adapter",
	endpointHttp: "http://127.0.0.1:9222",
	tool: "take_snapshot",
	argsJson: "{}",
});

describe("U4 mcporter transport", () => {
	// Scenario: default operation transport invokes `mcporter`.
	test("default transport invokes the bare mcporter command", async () => {
		const { runtime, calls } = capturingRuntime({});
		const outcome = await runBrowserUseMcporter(runtime, TRANSPORT_ARGS);

		expect(outcome.ok).toBe(true);
		expect(calls).toHaveLength(1);
		expect(commandVector(calls[0])).toEqual(["mcporter", ...TRANSPORT_ARGS]);
	});

	// Scenario: JSON override ["bunx","mcporter"] prefixes operation calls the
	// same way Adapter Proof does.
	test("['bunx','mcporter'] override prefixes the operation call", async () => {
		const { runtime, calls } = capturingRuntime({
			BROWSER_USE_MCPORTER_COMMAND_JSON: '["bunx","mcporter"]',
		});
		const outcome = await runBrowserUseMcporter(runtime, TRANSPORT_ARGS);

		expect(outcome.ok).toBe(true);
		expect(commandVector(calls[0])).toEqual([
			"bunx",
			"mcporter",
			...TRANSPORT_ARGS,
		]);
	});

	// Scenario: JSON override ["npx","-y","mcporter"] prefixes operation calls
	// the same way Adapter Proof does (runner flags preserved in order).
	test("['npx','-y','mcporter'] override preserves runner flags", async () => {
		const { runtime, calls } = capturingRuntime({
			BROWSER_USE_MCPORTER_COMMAND_JSON: '["npx","-y","mcporter"]',
		});
		const outcome = await runBrowserUseMcporter(runtime, TRANSPORT_ARGS);

		expect(outcome.ok).toBe(true);
		expect(commandVector(calls[0])).toEqual([
			"npx",
			"-y",
			"mcporter",
			...TRANSPORT_ARGS,
		]);
	});

	// Scenario: invalid JSON, shell string, empty array, non-string member, and
	// blank member all fail with the same override diagnostic family and never
	// run a command.
	for (const [label, override] of [
		["invalid JSON", "{"],
		["shell string", "npx -y mcporter"],
		["empty array", "[]"],
		["non-string entry", '["npx",7,"mcporter"]'],
		["blank string entry", '["npx"," ","mcporter"]'],
	] as const) {
		test(`override rejects ${label} without running a command`, async () => {
			const { runtime, calls } = capturingRuntime({
				BROWSER_USE_MCPORTER_COMMAND_JSON: override,
			});
			const outcome = await runBrowserUseMcporter(runtime, TRANSPORT_ARGS);

			expect(calls).toHaveLength(0);
			expect(outcome.ok).toBe(false);
			if (outcome.ok) throw new Error("expected failure");
			expect(outcome.failure.code).toBe(
				"browser_operation_command_override_invalid",
			);
			expect(outcome.failure.hintSummary).toContain(
				"BROWSER_USE_MCPORTER_COMMAND_JSON",
			);
			expect(outcome.failure.hintSummary).toContain(
				"does not auto-try package runners",
			);
		});
	}

	// Scenario: missing command emits dependency recovery, not Warm Chrome repair
	// or adapter fallback.
	test("a runtime that cannot start the command emits dependency recovery", async () => {
		const runtime = makeRuntime({
			runCommand: async () => {
				throw new Error("spawn ENOENT");
			},
		});
		const outcome = await runBrowserUseMcporter(runtime, TRANSPORT_ARGS);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error("expected failure");
		expect(outcome.failure.code).toBe("browser_operation_dependency_missing");
		expect(outcome.failure.hintSummary).toContain("Expose mcporter on PATH");
		expect(outcome.failure.hintSummary).toContain(
			"does not auto-try package runners",
		);
	});

	// Scenario: a missing-command result (exit 127 / not-found text) routes to
	// dependency recovery, not a non-zero operation failure or fallback.
	test("a missing-command result routes to dependency recovery", async () => {
		const { runtime } = capturingRuntime(
			{},
			{ exitCode: 127, stdout: "", stderr: "mcporter: command not found" },
		);
		const outcome = await runBrowserUseMcporter(runtime, TRANSPORT_ARGS);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error("expected failure");
		expect(outcome.failure.code).toBe("browser_operation_dependency_missing");
	});

	// Scenario: a runtime override that throws for a reason other than a spawn or
	// start failure is a transport failure, not a missing-binary diagnosis. It
	// must not tell the operator mcporter is absent.
	test("a non-start-failure throw is a transport failure, not dependency recovery", async () => {
		const runtime = makeRuntime({
			runCommand: async () => {
				throw new Error("connection reset mid-call");
			},
		});
		const outcome = await runBrowserUseMcporter(runtime, TRANSPORT_ARGS);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error("expected failure");
		expect(outcome.failure.code).toBe("browser_operation_transport_failed");
		expect(outcome.failure.hintSummary).not.toContain("Expose mcporter on PATH");
	});

	// Scenario: a timed-out transport result is a distinct timeout failure, never
	// a clean success. Adapter Proof guards timedOut before the missing-command
	// check; the operation surface must too, or U7 would parse empty output as a
	// successful operation.
	test("a timed-out result is reported as a transport timeout, not success", async () => {
		const { runtime } = capturingRuntime(
			{},
			{ exitCode: 1, stdout: "", stderr: "", timedOut: true },
		);
		const outcome = await runBrowserUseMcporter(runtime, TRANSPORT_ARGS);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error("expected failure");
		expect(outcome.failure.code).toBe("browser_operation_transport_timeout");
		// A timeout is not a missing-binary condition; it must not claim mcporter
		// is absent.
		expect(outcome.failure.hintSummary).not.toContain("Expose mcporter on PATH");
	});

	// Scenario: operation execution never shell-evaluates command input. A shell
	// metacharacter in the args is passed as one literal argv member, never split
	// or interpreted.
	test("argument input is passed literally, never shell-evaluated", async () => {
		const { runtime, calls } = capturingRuntime({});
		const hostile = "; rm -rf / # $(touch pwned)";
		await runBrowserUseMcporter(runtime, ["call", hostile]);

		expect(calls).toHaveLength(1);
		expect(calls[0].args).toEqual(["call", hostile]);
		// The hostile string survives intact as a single argv member.
		expect(calls[0].args).toContain(hostile);
	});

	// Scenario: tests prove Adapter Proof and Browser Operation command-vector
	// behavior stay aligned. Both surfaces consume the same shared transport, so
	// the same override yields the same prefix shape for an arbitrary subcommand.
	test("operation transport prefixes match the Adapter Proof contract for each override", async () => {
		const cases: Array<[Record<string, string | undefined>, string[]]> = [
			[{}, ["mcporter"]],
			[{ BROWSER_USE_MCPORTER_COMMAND_JSON: '["bunx","mcporter"]' }, ["bunx", "mcporter"]],
			[
				{ BROWSER_USE_MCPORTER_COMMAND_JSON: '["npx","-y","mcporter"]' },
				["npx", "-y", "mcporter"],
			],
		];
		for (const [env, prefix] of cases) {
			const { runtime, calls } = capturingRuntime(env);
			await runBrowserUseMcporter(runtime, ["config", "get", "chrome-devtools"]);
			expect(commandVector(calls[0])).toEqual([
				...prefix,
				"config",
				"get",
				"chrome-devtools",
			]);
		}
	});

	// Parity guard: the envelope-derived transport (U3) builds the exact ad-hoc
	// argv the U1 process-boundary proof pinned against real mcporter
	// (ENVELOPE_ADAPTER_ARGV_CONTRACT in mcporter-adapter-process-boundary
	// .test.ts): pinned binary via --stdio, endpoint verbatim via --stdio-arg
	// --browser-url, --experimentalPageIdRouting for direct pageId routing, and
	// a fresh --name so no configured server is ever consulted.
	test("the envelope call builder substitutes the envelope slots into the pinned argv and nothing else", () => {
		expect(
			envelopeAdapterCallArgs({
				probeExecutable: "/pinned/adapters/chrome-devtools-mcp/bin/chrome-devtools-mcp",
				endpointHttp: "http://127.0.0.1:9222",
				tool: "take_snapshot",
				argsJson: '{"pageId":3}',
			}),
		).toEqual([
			"call",
			"--stdio",
			"/pinned/adapters/chrome-devtools-mcp/bin/chrome-devtools-mcp",
			"--stdio-arg",
			"--browser-url",
			"--stdio-arg",
			"http://127.0.0.1:9222",
			"--stdio-arg",
			"--experimentalPageIdRouting",
			"--name",
			"browser-use-envelope-adapter",
			"--tool",
			"take_snapshot",
			"--args",
			'{"pageId":3}',
			"--output",
			"json",
		]);
	});

	// Scenario: every envelope-derived call rides the keep-alive env guard.
	// Without MCPORTER_NO_KEEPALIVE=* a running mcporter daemon with a configured
	// chrome-devtools server silently answers the call itself (wrong binary,
	// wrong endpoint, exit 0) — the U1-proven config-seam shadowing defect.
	test("runEnvelopeAdapterCall rides the keep-alive env guard on the spawn", async () => {
		const { runtime, calls } = capturingRuntime({});
		const call = {
			probeExecutable: "/pinned/adapter",
			endpointHttp: "http://127.0.0.1:9222",
			tool: "list_pages",
			argsJson: "{}",
		};
		const outcome = await runEnvelopeAdapterCall(runtime, call);

		expect(outcome.ok).toBe(true);
		expect(calls).toHaveLength(1);
		expect(commandVector(calls[0])).toEqual([
			"mcporter",
			...envelopeAdapterCallArgs(call),
		]);
		expect(calls[0].env).toEqual({ MCPORTER_NO_KEEPALIVE: "*" });
		expect(ENVELOPE_ADAPTER_CALL_ENV).toEqual({ MCPORTER_NO_KEEPALIVE: "*" });
	});

	// Scenario: caller env threads through the shared transport untouched, and
	// stays absent when not supplied (backward-compatible seam).
	test("caller env threads through runBrowserUseMcporter and defaults to none", async () => {
		const withEnv = capturingRuntime({});
		await runBrowserUseMcporter(withEnv.runtime, ["call", "x"], {
			MCPORTER_NO_KEEPALIVE: "*",
		});
		expect(withEnv.calls[0].env).toEqual({ MCPORTER_NO_KEEPALIVE: "*" });

		const withoutEnv = capturingRuntime({});
		await runBrowserUseMcporter(withoutEnv.runtime, ["call", "x"]);
		expect(withoutEnv.calls[0].env).toBeUndefined();
	});

	// Parity guard: the operation transport derives its command vector from the
	// shared resolver — the single function Adapter Proof also resolves through.
	// Pinning the operation prefix to the shared resolver's output proves the two
	// surfaces cannot drift apart in command-vector resolution.
	test("operation prefix is exactly the shared resolver's vector", async () => {
		const envs: Record<string, string | undefined>[] = [
			{},
			{ BROWSER_USE_MCPORTER_COMMAND_JSON: '["bunx","mcporter"]' },
			{ BROWSER_USE_MCPORTER_COMMAND_JSON: '["npx","-y","mcporter"]' },
		];
		for (const env of envs) {
			const resolved = resolveMcporterCommandVector(env);
			expect(resolved.ok).toBe(true);
			if (!resolved.ok) throw new Error("expected ok");
			const { runtime, calls } = capturingRuntime(env);
			await runBrowserUseMcporter(runtime, ["call", "x"]);
			expect(commandVector(calls[0])).toEqual([
				...resolved.vector,
				"call",
				"x",
			]);
		}
	});
});
