import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import {
	type AgentBrowserExecutionRuntime,
	executeAgentBrowserTask,
} from "./browser-use-agent-browser";

const HANDOFF = {
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
} as const satisfies BrowserConnectHandoffPayload & {
	contract_id: string;
	schema_version: string;
};

function json(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

// Real agent-browser CDP failure envelope shape captured from a live probe
// against a dead endpoint: exit code 0, `success:false`, connection signal in
// `error`. Fakes MUST match this so a reconnect classifier that keyed on a
// non-zero exit would be caught here.
function cdpConnectFailure(): string {
	return JSON.stringify({
		error: "CDP WebSocket connect failed: IO error: Connection refused (os error 61)",
		success: false,
	});
}

// A semantic adapter failure: connected, but the request could not be
// satisfied. Carries no connection signal, so it must never be reconnected.
function semanticFailure(): string {
	return JSON.stringify({ error: "no such element", success: false });
}

function runtimeFor(
	responses: readonly {
		exitCode?: number;
		stdout?: string;
		stderr?: string;
		timedOut?: boolean;
	}[],
): AgentBrowserExecutionRuntime & { calls: Array<readonly string[]> } {
	const calls: Array<readonly string[]> = [];
	let responseIndex = 0;
	return {
		calls,
		runCommand: async (input) => {
			calls.push([input.command, ...input.args]);
			const response = responses[responseIndex++] ?? {};
			return {
				exitCode: response.exitCode ?? 0,
				stdout: response.stdout ?? json({}),
				stderr: response.stderr ?? "",
				...(response.timedOut === undefined
					? {}
					: { timedOut: response.timedOut }),
			};
		},
	};
}

describe("Agent Browser native task lane", () => {
	test("selects one proven tab, observes, mutates, and freshly verifies structure", async () => {
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t7",
							active: true,
							type: "page",
							url: "https://example.test/form",
						},
					],
				}),
			},
			{ stdout: json({}) },
			{ stdout: json({ snapshot: "@e4 button Save", refs: { e4: {} } }) },
			{ stdout: json({}) },
			{ stdout: json({ url: "https://example.test/saved" }) },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-agent-browser-1",
			target_tab_id: "t7",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: true },
				{
					kind: "click",
					ref: "@e4",
					postcondition: {
						kind: "url-equals",
						url: "https://example.test/saved",
					},
				},
			],
		});

		expect(result).toEqual({
			ok: true,
			outcome: "confirmed",
			executed_steps: 2,
			target_tab_id: "t7",
		});
		expect(runtime.calls).toEqual([
			[
				"/opt/browser-connect/agent-browser",
				"--cdp",
				HANDOFF.endpoint.ws,
				"--session",
				"browser-use-run-agent-browser-1",
				"tab",
				"list",
				"--json",
			],
			[
				"/opt/browser-connect/agent-browser",
				"--cdp",
				HANDOFF.endpoint.ws,
				"--session",
				"browser-use-run-agent-browser-1",
				"tab",
				"t7",
				"--json",
			],
			[
				"/opt/browser-connect/agent-browser",
				"--cdp",
				HANDOFF.endpoint.ws,
				"--session",
				"browser-use-run-agent-browser-1",
				"snapshot",
				"-i",
				"--json",
			],
			[
				"/opt/browser-connect/agent-browser",
				"--cdp",
				HANDOFF.endpoint.ws,
				"--session",
				"browser-use-run-agent-browser-1",
				"click",
				"@e4",
				"--json",
			],
			[
				"/opt/browser-connect/agent-browser",
				"--cdp",
				HANDOFF.endpoint.ws,
				"--session",
				"browser-use-run-agent-browser-1",
				"get",
				"url",
				"--json",
			],
		]);
	});

	test("refuses stale-ref mutation without a current snapshot", async () => {
		const runtime = runtimeFor([
			{
				stdout: json({
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
			{ stdout: json({}) },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-stale-ref",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [
				{
					kind: "click",
					ref: "@e1",
					postcondition: {
						kind: "url-equals",
						url: "https://example.test/done",
					},
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_current_snapshot_required",
			outcome: "not-achieved",
		});
		expect(runtime.calls).toHaveLength(2);
	});

	test("classifies a post-dispatch timeout as unknown and never repeats", async () => {
		const runtime = runtimeFor([
			{
				stdout: json({
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
			{ stdout: json({}) },
			{ stdout: json({ snapshot: "@e1 button Save", refs: { e1: {} } }) },
			{ exitCode: 1, timedOut: true, stderr: "timed out" },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-unknown",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: true },
				{
					kind: "click",
					ref: "@e1",
					postcondition: {
						kind: "url-equals",
						url: "https://example.test/done",
					},
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_mutation_effect_unknown",
			outcome: "unknown",
		});
		expect(runtime.calls).toHaveLength(4);
	});

	test("refuses confidential fill before adapter argv construction", async () => {
		const runtime = runtimeFor([
			{
				stdout: json({
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
			{ stdout: json({}) },
			{ stdout: json({ snapshot: "@e2 textbox", refs: { e2: {} } }) },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-confidential",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: true },
				{
					kind: "fill",
					ref: "@e2",
					value: "sentinel-secret",
					sensitivity: "confidential",
					postcondition: {
						kind: "value-equals",
						selector: "input[name=account]",
						value: "sentinel-secret",
					},
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_confidential_input_requires_auth_transaction",
			outcome: "not-achieved",
		});
		expect(JSON.stringify(runtime.calls)).not.toContain("sentinel-secret");
		expect(runtime.calls).toHaveLength(3);
	});

	test("fails closed when the handoff names another adapter or schema", async () => {
		const runtime = runtimeFor([]);
		const result = await executeAgentBrowserTask(runtime, {
			handoff: {
				...HANDOFF,
				attachment: {
					...HANDOFF.attachment,
					adapter_id: "chrome-devtools-mcp",
				},
			},
			run_id: "run-wrong-lane",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_handoff_invalid",
			outcome: "not-achieved",
		});
		expect(runtime.calls).toEqual([]);
	});

	test("runs only hash-bound reviewed evaluate actions and verifies mutations", async () => {
		const script = "async ({ inputs }) => ({ saved: inputs.expected === 8 })";
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t8",
							active: true,
							type: "page",
							url: "https://example.test/week",
						},
					],
				}),
			},
			{ stdout: json({}) },
			{ stdout: json({ snapshot: "week grid", refs: {} }) },
			{ stdout: json({ url: "https://example.test/week" }) },
			{ stdout: json({ result: { saved: true } }) },
			{ stdout: json({ visible: true }) },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-reviewed-action",
			target_tab_id: "t8",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: false },
				{
					kind: "evaluate",
					action_id: "timesheet.save-draft",
					script,
					script_sha256: createHash("sha256").update(script).digest("hex"),
					review_status: "approved",
					allowed_origin: "https://example.test",
					effect: "mutation",
					inputs: { expected: 8 },
					postcondition: {
						kind: "element-visible",
						selector: "[data-state=saved]",
					},
				},
			],
		});

		expect(result).toMatchObject({
			ok: true,
			outcome: "confirmed",
			executed_steps: 2,
		});
		const evaluate = runtime.calls[4] ?? [];
		expect(evaluate).toContain("eval");
		expect(evaluate).toContain("-b");
		expect(evaluate.join(" ")).not.toContain(script);
	});

	test("refuses edited or unapproved evaluate actions before dispatch", async () => {
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t9",
							active: true,
							type: "page",
							url: "https://example.test/week",
						},
					],
				}),
			},
			{ stdout: json({}) },
			{ stdout: json({ snapshot: "week grid", refs: {} }) },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-edited-action",
			target_tab_id: "t9",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: false },
				{
					kind: "evaluate",
					action_id: "timesheet.save-draft",
					script: "async () => true",
					script_sha256: "0".repeat(64),
					review_status: "approved",
					allowed_origin: "https://example.test",
					effect: "mutation",
					inputs: {},
					postcondition: {
						kind: "element-visible",
						selector: "[data-state=saved]",
					},
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_action_integrity_refused",
			outcome: "not-achieved",
		});
		expect(runtime.calls).toHaveLength(3);
	});
});

describe("Agent Browser connection robustness (no flaky CDP connections)", () => {
	test("recovers from one transient CDP failure with a bounded reconnect", async () => {
		const runtime = runtimeFor([
			// attempt 1: tab list fails with a connection-class envelope
			{ stdout: cdpConnectFailure() },
			// liveness probe between attempts (any result; not a success authority)
			{ stdout: json({ cdpUrl: "ws://127.0.0.1:9222/devtools/browser/x" }) },
			// attempt 2: tab list succeeds
			{
				stdout: json({
					tabs: [
						{ tabId: "t2", active: true, type: "page", url: "https://example.test/" },
					],
				}),
			},
			// tab select succeeds
			{ stdout: json({}) },
			// snapshot
			{ stdout: json({ snapshot: "@e1 button", refs: { e1: {} } }) },
			// click
			{ stdout: json({}) },
			// postcondition url check
			{ stdout: json({ url: "https://example.test/done" }) },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-reconnect-recover",
			target_tab_id: "t2",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: true },
				{
					kind: "click",
					ref: "@e1",
					postcondition: { kind: "url-equals", url: "https://example.test/done" },
				},
			],
		});

		expect(result).toMatchObject({ ok: true, outcome: "confirmed", executed_steps: 2 });
		// One failed attempt + liveness probe + successful attempt + select + task steps.
		expect(runtime.calls[0]?.join(" ")).toContain("tab list");
		expect(runtime.calls[1]?.join(" ")).toContain("get cdp-url");
		expect(runtime.calls[2]?.join(" ")).toContain("tab list");
	});

	test("reports a typed connection failure with diagnostic evidence after a bounded reconnect exhausts", async () => {
		const runtime = runtimeFor([
			{ stdout: cdpConnectFailure() }, // attempt 1
			{ stdout: cdpConnectFailure() }, // liveness probe (also down)
			{ stdout: cdpConnectFailure() }, // attempt 2
			{ stdout: cdpConnectFailure() }, // liveness probe
			{ stdout: cdpConnectFailure() }, // attempt 3
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-reconnect-exhaust",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [{ kind: "snapshot", interactive: true }],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_connection_unstable",
			outcome: "not-achieved",
		});
		if (result.ok === false) {
			expect(result.connection?.attempts).toBe(3);
			expect(result.connection?.max_attempts).toBe(3);
			expect(result.connection?.last_signal).toContain("Connection refused");
			expect(result.connection?.next_repair_action).toContain("browser-connect");
		}
		// 3 tab-list attempts + 2 interleaved liveness probes; bounded, never open-ended.
		expect(runtime.calls).toHaveLength(5);
	});

	test("never reconnects a semantic refusal — a genuinely absent tab is not flaky", async () => {
		const runtime = runtimeFor([{ stdout: semanticFailure() }]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-semantic",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [{ kind: "snapshot", interactive: true }],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_target_unavailable",
			outcome: "not-achieved",
		});
		// Exactly one call: no retry, no liveness probe, no masking of real absence.
		expect(runtime.calls).toHaveLength(1);
	});

	test("a post-dispatch CDP failure stays unknown and is never reconnected", async () => {
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{ tabId: "t1", active: true, type: "page", url: "https://example.test/" },
					],
				}),
			},
			{ stdout: json({}) }, // tab select
			{ stdout: json({ snapshot: "@e1 button", refs: { e1: {} } }) }, // snapshot
			{ stdout: cdpConnectFailure() }, // click dispatched, then CDP drops
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-postdispatch-drop",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: true },
				{
					kind: "click",
					ref: "@e1",
					postcondition: { kind: "url-equals", url: "https://example.test/done" },
				},
			],
		});

		// Effect may have landed: stays unknown, never reconnected, never a
		// connection diagnostic that would invite an unsafe retry.
		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_mutation_effect_unknown",
			outcome: "unknown",
		});
		if (result.ok === false) {
			expect(result.connection).toBeUndefined();
		}
		expect(runtime.calls).toHaveLength(4);
	});

	// Process-boundary proof against the real dependency shape (repo rule).
	// REAL_HANDOFF is the verbatim `data` payload captured from a live
	// `browser-connect connect agent-browser --json` run on 2026-07-27 (ws token
	// truncated; a localhost dev endpoint, not a secret). REAL_CDP_FAILURE is the
	// verbatim stdout captured from a live agent-browser CDP failure. If the
	// upstream contract or adapter envelope shape drifts, this test breaks —
	// unlike a hand-built fake that could silently diverge.
	const REAL_HANDOFF = {
		outcome: "verified",
		environment: { name: "agent-chrome", profile: "default" },
		browser_entry_mode: "explicit-cdp",
		attachment: {
			adapter_id: "agent-browser",
			route: "explicit-cdp",
			probe_executable: "/Users/nathanvale/.bun/bin/agent-browser",
		},
		endpoint: {
			http: "http://127.0.0.1:9222",
			ws: "ws://127.0.0.1:9222/devtools/browser/98a94921-dd67-4fd5-85bc-f227f014b276",
		},
		launch: { launched: false },
		proof: {
			environment_contract_id: "warm-chrome.browser-entry",
			environment_schema_version: "1",
			route_evidence: "verified-live",
		},
		contract_id: "browser-connect.verified-handoff",
		schema_version: "2",
	} as const satisfies BrowserConnectHandoffPayload & {
		contract_id: string;
		schema_version: string;
	};
	const REAL_CDP_FAILURE =
		'{"error":"CDP WebSocket connect failed: IO error: Connection refused (os error 61)","success":false}';

	test("real captured handoff shape is accepted and its real CDP failure envelope is connection-class", async () => {
		const runtime = runtimeFor(
			Array.from({ length: 5 }, () => ({ stdout: REAL_CDP_FAILURE })),
		);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: REAL_HANDOFF,
			run_id: "run-real-shape",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [{ kind: "snapshot", interactive: true }],
		});

		// The real handoff passes validateTask (no agent_browser_handoff_invalid),
		// and the real failure envelope is classified connection-class, not
		// misread as a semantic target-unavailable.
		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_connection_unstable",
		});
		if (result.ok === false) {
			expect(result.connection?.last_signal).toBe(
				"CDP WebSocket connect failed: IO error: Connection refused (os error 61)",
			);
		}
	});

	test("a timed-out connection attempt is connection-class and drives the bounded reconnect", async () => {
		const runtime = runtimeFor([
			{ exitCode: 1, timedOut: true, stderr: "timed out" }, // attempt 1
			{ stdout: json({ cdpUrl: "ws://x" }) }, // probe
			{
				stdout: json({
					tabs: [
						{ tabId: "t1", active: true, type: "page", url: "https://example.test/" },
					],
				}),
			}, // attempt 2 recovers
			{ stdout: json({}) }, // select
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-timeout-reconnect",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [],
		});

		expect(result).toMatchObject({ ok: true, outcome: "confirmed", executed_steps: 0 });
		expect(runtime.calls[0]?.join(" ")).toContain("tab list");
		expect(runtime.calls[1]?.join(" ")).toContain("get cdp-url");
	});
});
