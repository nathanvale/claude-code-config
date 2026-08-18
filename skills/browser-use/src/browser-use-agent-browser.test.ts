import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import {
	type AgentBrowserExecutionFailureCode,
	type AgentBrowserExecutionRuntime,
	type AgentBrowserPostcondition,
	type AgentBrowserTaskStep,
	executeAgentBrowserTask,
	resolveAgentBrowserTaskTarget,
} from "./browser-use-agent-browser";
import { verifyAgentBrowserPostcondition } from "./browser-use-agent-browser-target";
import { candidateIdOf } from "./browser-use-core";
import type { McporterCommandInput } from "./mcporter-transport";
import {
	type BrowserUseItemBatchState,
	recordItemCheckpoint,
	resolveNextBatchItem,
} from "./browser-use-runbook-actions";

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

function semanticCallArgs(call: readonly string[]): string[] {
	const pinIndex = call.indexOf("--pin-tab");
	return call.slice(pinIndex === -1 ? 5 : pinIndex + 1);
}

async function verifyUrlPostcondition(
	postcondition: AgentBrowserPostcondition,
	observedUrl: string,
) {
	return verifyAgentBrowserPostcondition(
		async () => ({
			exitCode: 0,
			stdout: json({ url: observedUrl }),
			stderr: "",
		}),
		postcondition,
		new Set(["https://example.test"]),
	);
}

describe("Agent Browser URL postconditions", () => {
	test("url-starts-with accepts SPA and subpath redirects, then rejects a different prefix", async () => {
		const prefix = "https://example.test/CandidatePortal";
		const postcondition = { kind: "url-starts-with", url: prefix } as const;

		expect(await verifyUrlPostcondition(postcondition, `${prefix}#/route`)).toBe("confirmed");
		expect(await verifyUrlPostcondition(postcondition, `${prefix}/sub`)).toBe("confirmed");
		expect(await verifyUrlPostcondition(postcondition, "https://example.test/OtherPortal")).toBe("not-achieved");
	});

	test("url-equals remains exact", async () => {
		const url = "https://example.test/CandidatePortal";
		const postcondition = { kind: "url-equals", url } as const;

		expect(await verifyUrlPostcondition(postcondition, url)).toBe("confirmed");
		expect(await verifyUrlPostcondition(postcondition, `${url}#/route`)).toBe("not-achieved");
	});

	test("an unhandled runtime discriminator fails closed", async () => {
		const postcondition = { kind: "unknown" } as unknown as AgentBrowserPostcondition;

		expect(await verifyUrlPostcondition(postcondition, "https://example.test/")).toBe("not-achieved");
	});
});

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
	options: Readonly<{
		selectedUrlProof?: string;
		releaseResponse?: {
			exitCode?: number;
			stdout?: string;
			stderr?: string;
			timedOut?: boolean;
		};
	}> = {},
): AgentBrowserExecutionRuntime & {
	calls: Array<readonly string[]>;
	commandInputs: McporterCommandInput[];
	releaseCalls: McporterCommandInput[];
} {
	const calls: Array<readonly string[]> = [];
	const commandInputs: McporterCommandInput[] = [];
	const releaseCalls: McporterCommandInput[] = [];
	let responseIndex = 0;
	let listedUrls = new Map<string, string>();
	let selectedUrlProof: string | undefined;
	return {
		calls,
		commandInputs,
		releaseCalls,
		beforeMutationDispatch: async () => ({ ok: true }),
		runCommand: async (input) => {
			if (input.args.includes("close")) {
				releaseCalls.push(input);
				return {
					exitCode: options.releaseResponse?.exitCode ?? 0,
					stdout: options.releaseResponse?.stdout ?? json({}),
					stderr: options.releaseResponse?.stderr ?? "",
					...(options.releaseResponse?.timedOut === undefined
						? {}
						: { timedOut: options.releaseResponse.timedOut }),
				};
			}
			if (input.args[0] === "session" && input.args[1] === "list") {
				releaseCalls.push(input);
				return {
					exitCode: 0,
					stdout: json({ sessions: [] }),
					stderr: "",
				};
			}
			commandInputs.push(input);
			calls.push([input.command, ...input.args]);
			const pinIndex = input.args.indexOf("--pin-tab");
			const semanticArgs = input.args.slice(pinIndex === -1 ? 4 : pinIndex + 1);
			if (
				semanticArgs[0] === "get" &&
				semanticArgs[1] === "url" &&
				selectedUrlProof !== undefined
			) {
				const url = selectedUrlProof;
				selectedUrlProof = undefined;
				return {
					exitCode: 0,
					stdout: json({ url }),
					stderr: "",
				};
			}
			const response = responses[responseIndex++] ?? {};
			const result = {
				exitCode: response.exitCode ?? 0,
				stdout: response.stdout ?? json({}),
				stderr: response.stderr ?? "",
				...(response.timedOut === undefined
					? {}
					: { timedOut: response.timedOut }),
			};
			if (
				semanticArgs[0] === "tab" &&
				semanticArgs[1] === "list" &&
				result.exitCode === 0
			) {
				try {
					const parsed = JSON.parse(result.stdout) as {
						success?: boolean;
						data?: {
							tabs?: Array<{
								tabId?: string;
								targetId?: string;
								url?: string;
							}>;
						};
					};
					listedUrls = new Map(
						(parsed.data?.tabs ?? []).flatMap((tab) => {
							if (typeof tab.url !== "string") return [];
							return [
								...(typeof tab.tabId === "string"
									? [[tab.tabId, tab.url] as const]
									: []),
								...(typeof tab.targetId === "string"
									? [[tab.targetId, tab.url] as const]
									: []),
							];
						}),
					);
				} catch {
					listedUrls = new Map();
				}
			}
			if (
				semanticArgs[0] === "tab" &&
				semanticArgs[1] !== "list" &&
				result.exitCode === 0
			) {
				selectedUrlProof =
					options.selectedUrlProof ??
					listedUrls.get(semanticArgs[1] ?? "");
			}
			return result;
		},
	};
}

function argvAndDecodedArguments(calls: readonly (readonly string[])[]): string {
	return calls
		.flatMap((call) =>
			call.flatMap((argument) => [
				argument,
				Buffer.from(argument, "base64").toString("utf-8"),
			]),
		)
		.join("\n");
}

describe("Agent Browser native task lane", () => {
	test("releases the adapter session after a terminal task", async () => {
		const activeSessions = new Set<string>();
		const releaseInputs: McporterCommandInput[] = [];
		const runtime: AgentBrowserExecutionRuntime = {
			runCommand: async (input) => {
				if (input.args[0] === "session" && input.args[1] === "list") {
					releaseInputs.push(input);
					return {
						exitCode: 0,
						stdout: json({ sessions: [...activeSessions] }),
						stderr: "",
					};
				}
				const sessionFlagIndex = input.args.indexOf("--session");
				const sessionName = input.args[sessionFlagIndex + 1];
				if (sessionName === undefined) throw new Error("missing session");
				if (input.args.includes("close")) {
					releaseInputs.push(input);
					activeSessions.delete(sessionName);
					return {
						exitCode: 0,
						stdout: json({}),
						stderr: "",
					};
				}
				activeSessions.add(sessionName);
				if (input.args.includes("list")) {
					return {
						exitCode: 0,
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
						stderr: "",
					};
				}
				if (input.args.includes("url")) {
					return {
						exitCode: 0,
						stdout: json({ url: "https://example.test/" }),
						stderr: "",
					};
				}
				return {
					exitCode: 0,
					stdout: json({ snapshot: "page", refs: {} }),
					stderr: "",
				};
			},
		};

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-terminal-release",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [{ kind: "snapshot", interactive: true }],
		});

		expect(result.ok).toBe(true);
		expect(activeSessions).toEqual(new Set());
		expect(releaseInputs).toHaveLength(2);
		expect(releaseInputs[0]?.args).toEqual([
			"--session",
			"browser-use-run-terminal-release",
			"close",
			"--json",
		]);
		expect(releaseInputs[1]?.args).toEqual(["session", "list", "--json"]);
		expect(releaseInputs.every((input) => !input.args.includes("--cdp"))).toBe(true);
	});

	test("blocks confirmed task truth when session release fails", async () => {
		const runtime = runtimeFor(
			[
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
				{ stdout: json({ snapshot: "page", refs: {} }) },
			],
			{
				releaseResponse: {
					exitCode: 1,
					stdout: "",
					stderr: "close failed",
				},
			},
		);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-release-debt",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [{ kind: "snapshot", interactive: true }],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_command_failed",
			outcome: "unknown",
			executed_steps: 1,
		});
		expect(runtime.releaseCalls).toHaveLength(1);
		expect(runtime.releaseCalls[0]?.args).toEqual([
			"--session",
			"browser-use-run-release-debt",
			"close",
			"--json",
		]);
		expect(runtime.releaseCalls[0]?.args).not.toContain("--cdp");
	});

	test("releases once without replacing typed terminal failures", async () => {
		const selectedResponses = () => [
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
		];
		const markerRuntime = runtimeFor(selectedResponses());
		markerRuntime.beforeMutationDispatch = async () => ({ ok: false });
		const cases: Array<{
			name: string;
			runtime: ReturnType<typeof runtimeFor>;
			steps: readonly AgentBrowserTaskStep[];
			code: AgentBrowserExecutionFailureCode;
			expectedFinalization?: {
				mutation_dispatched: true;
				executed_steps: 1;
			};
		}> = [
			{
				name: "target selection",
				runtime: runtimeFor([{ stdout: semanticFailure() }]),
				steps: [{ kind: "snapshot", interactive: true }],
				code: "agent_browser_target_unavailable",
			},
			{
				name: "snapshot command",
				runtime: runtimeFor([
					...selectedResponses(),
					{ stdout: semanticFailure() },
				]),
				steps: [{ kind: "snapshot", interactive: true }],
				code: "agent_browser_command_failed",
			},
			{
				name: "missing current snapshot",
				runtime: runtimeFor(selectedResponses()),
				steps: [
					{
						kind: "click",
						ref: "@e1",
						postcondition: { kind: "element-visible", selector: "main" },
					},
				],
				code: "agent_browser_current_snapshot_required",
			},
			{
				name: "navigation origin",
				runtime: runtimeFor(selectedResponses()),
				steps: [
					{
						kind: "open",
						url: "https://outside.test/",
						postcondition: {
							kind: "url-equals",
							url: "https://outside.test/",
						},
					},
				],
				code: "agent_browser_target_origin_refused",
			},
			{
				name: "mutation marker",
				runtime: markerRuntime,
				steps: [
					{
						kind: "open",
						url: "https://example.test/next",
						postcondition: {
							kind: "url-equals",
							url: "https://example.test/next",
						},
					},
				],
				code: "agent_browser_mutation_marker_unavailable",
			},
			{
				name: "invalid ref",
				runtime: runtimeFor([
					...selectedResponses(),
					{ stdout: json({ snapshot: "page", refs: {} }) },
				]),
				steps: [
					{ kind: "snapshot", interactive: true },
					{
						kind: "click",
						ref: "@e1",
						postcondition: { kind: "element-visible", selector: "main" },
					},
				],
				code: "agent_browser_ref_invalid",
			},
			{
				name: "action integrity",
				runtime: runtimeFor([
					...selectedResponses(),
					{ stdout: json({ snapshot: "page", refs: {} }) },
				]),
				steps: [
					{ kind: "snapshot", interactive: true },
					{
						kind: "evaluate",
						action_id: "invalid-action",
						script: "() => true",
						script_sha256: "invalid",
						review_status: "approved",
						allowed_origin: "https://example.test",
						effect: "read",
						inputs: {},
					},
				],
				code: "agent_browser_action_integrity_refused",
			},
			{
				name: "confidential input",
				runtime: runtimeFor([
					...selectedResponses(),
					{ stdout: json({ snapshot: "@e1 textbox", refs: { e1: {} } }) },
				]),
				steps: [
					{ kind: "snapshot", interactive: true },
					{
						kind: "fill",
						ref: "@e1",
						value: "",
						sensitivity: "confidential",
						postcondition: { kind: "element-visible", selector: "main" },
					},
				],
				code: "agent_browser_confidential_input_requires_auth_transaction",
			},
			{
				name: "mutation effect unknown",
				runtime: runtimeFor([
					...selectedResponses(),
					{ stdout: json({ opened: true }) },
					{ exitCode: 1, stdout: semanticFailure() },
				]),
				steps: [
					{
						kind: "open",
						url: "https://example.test/next",
						postcondition: {
							kind: "url-equals",
							url: "https://example.test/next",
						},
					},
				],
				code: "agent_browser_mutation_effect_unknown",
				expectedFinalization: {
					mutation_dispatched: true,
					executed_steps: 1,
				},
			},
			{
				name: "postcondition not achieved",
				runtime: runtimeFor([
					...selectedResponses(),
					{ stdout: json({ opened: true }) },
					{ stdout: json({ url: "https://example.test/unexpected" }) },
				]),
				steps: [
					{
						kind: "open",
						url: "https://example.test/next",
						postcondition: {
							kind: "url-equals",
							url: "https://example.test/next",
						},
					},
				],
				code: "agent_browser_postcondition_not_achieved",
				expectedFinalization: {
					mutation_dispatched: true,
					executed_steps: 1,
				},
			},
		];

		for (const scenario of cases) {
			const runId = `run-release-${scenario.name.replaceAll(" ", "-")}`;
			const result = await executeAgentBrowserTask(scenario.runtime, {
				handoff: HANDOFF,
				run_id: runId,
				target_tab_id: "t1",
				allowed_origins: ["https://example.test"],
				steps: scenario.steps,
			});

			expect(result).toMatchObject({
				ok: false,
				code: scenario.code,
				...scenario.expectedFinalization,
			});
			const closeCalls = scenario.runtime.releaseCalls.filter((input) =>
				input.args.includes("close"),
			);
			expect(closeCalls).toHaveLength(1);
			expect(closeCalls[0]?.args).toEqual([
				"--session",
				`browser-use-${runId}`,
				"close",
				"--json",
			]);
			expect(
				scenario.runtime.releaseCalls.every((input) => !input.args.includes("--cdp")),
			).toBe(true);
		}
	});

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
			{ stdout: json({ url: "https://example.test/form" }) },
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
			mutation_dispatched: true,
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
				"--pin-tab",
				"get",
				"url",
				"--json",
			],
			[
				"/opt/browser-connect/agent-browser",
				"--cdp",
				HANDOFF.endpoint.ws,
				"--session",
				"browser-use-run-agent-browser-1",
				"--pin-tab",
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
				"--pin-tab",
				"get",
				"url",
				"--json",
			],
			[
				"/opt/browser-connect/agent-browser",
				"--cdp",
				HANDOFF.endpoint.ws,
				"--session",
				"browser-use-run-agent-browser-1",
				"--pin-tab",
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
				"--pin-tab",
				"get",
				"url",
				"--json",
			],
		]);
	});

	test("refuses before click when the durable mutation marker cannot be recorded", async () => {
		const runtime = {
			...runtimeFor([
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
				{ stdout: json({ url: "https://example.test/form" }) },
			]),
			beforeMutationDispatch: async () => ({ ok: false as const }),
		};

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-marker-refused",
			target_tab_id: "t7",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: true },
				{
					kind: "click",
					ref: "@e4",
					postcondition: {
						kind: "element-visible",
						selector: "[data-saved='true']",
					},
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_mutation_marker_unavailable",
			outcome: "not-achieved",
			mutation_dispatched: false,
		});
		expect(runtime.calls.some((call) => call.includes("click"))).toBe(false);
	});

	test("refuses a whitespace-only semantic postcondition before target selection", async () => {
		const runtime = runtimeFor([]);
		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-semantic-selector-refused",
			target_tab_id: "t7",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: true },
				{
					kind: "click-semantic",
					role: "button",
					name: "Save",
					postcondition: { kind: "element-visible", selector: "   " },
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_task_invalid",
			outcome: "not-achieved",
			mutation_dispatched: false,
		});
		expect(runtime.calls).toHaveLength(0);
	});

	for (const scenario of [
		{ name: "zero", refs: {} },
		{
			name: "multiple",
			refs: {
				e1: { role: "button", name: "Save" },
				e2: { role: "button", name: "Save" },
			},
		},
	] as const) {
		test(`refuses ${scenario.name} semantic role/name matches before mutation`, async () => {
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
				{ stdout: json({ snapshot: "", refs: scenario.refs }) },
			]);

			const result = await executeAgentBrowserTask(runtime, {
				handoff: HANDOFF,
				run_id: `run-semantic-${scenario.name}`,
				target_tab_id: "t7",
				allowed_origins: ["https://example.test"],
				steps: [
					{ kind: "snapshot", interactive: true },
					{
						kind: "click-semantic",
						role: "button",
						name: "Save",
						postcondition: {
							kind: "element-visible",
							selector: "[data-saved='true']",
						},
					},
				],
			});

			expect(result).toMatchObject({
				ok: false,
				code: "agent_browser_ref_invalid",
				outcome: "not-achieved",
				mutation_dispatched: false,
			});
			expect(runtime.calls.some((call) => call.includes("click"))).toBe(false);
		});
	}

	test("refuses before click when the selected tab drifts to another origin", async () => {
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
			{
				stdout: json({
					snapshot: "@e1 button Save",
					refs: { e1: { role: "button", name: "Save" } },
				}),
			},
			{ stdout: json({ url: "https://other.test/form" }) },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-origin-drift-before-click",
			target_tab_id: "t7",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: true },
				{
					kind: "click-semantic",
					role: "button",
					name: "Save",
					postcondition: {
						kind: "element-visible",
						selector: "[data-saved='true']",
					},
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_target_origin_refused",
			outcome: "not-achieved",
			mutation_dispatched: false,
		});
		expect(runtime.calls.some((call) => call.includes("click"))).toBe(false);
	});

	test("post-click origin drift blocks selector verification with unknown effect", async () => {
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
			{
				stdout: json({
					snapshot: "@e1 button Save",
					refs: { e1: { role: "button", name: "Save" } },
				}),
			},
			{ stdout: json({ url: "https://example.test/form" }) },
			{ stdout: json({}) },
			{ stdout: json({ url: "https://other.test/saved" }) },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-origin-drift-after-click",
			target_tab_id: "t7",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: true },
				{
					kind: "click-semantic",
					role: "button",
					name: "Save",
					postcondition: {
						kind: "element-visible",
						selector: "[data-saved='true']",
					},
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_mutation_effect_unknown",
			outcome: "unknown",
			mutation_dispatched: true,
		});
		expect(runtime.calls.some((call) => call.includes("is"))).toBe(false);
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
		expect(runtime.calls).toHaveLength(3);
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
			{ stdout: json({ url: "https://example.test/" }) },
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
		expect(runtime.calls).toHaveLength(6);
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
		expect(runtime.calls).toHaveLength(4);
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
		const script =
			"async ({ inputs }) => ({ saved: inputs.entries[0].units === 7.375 })";
		const reviewedInputs = {
			entries: [
				{
					item_key: "entry-private-monday",
					date: "2026-07-27",
					units: 7.375,
					source_path: "oncore/private/reviewed-entry.json",
				},
			],
		};
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
			{ stdout: json({ url: "https://example.test/week" }) },
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
					inputs: reviewedInputs,
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
		const evaluate = runtime.calls[5] ?? [];
		expect(evaluate).toContain("eval");
		expect(evaluate).toContain("--stdin");
		expect(evaluate).not.toContain("-b");
		const argvSurfaces = argvAndDecodedArguments(runtime.calls);
		for (const reviewedValue of [
			script,
			"entry-private-monday",
			"2026-07-27",
			"7.375",
			"oncore/private/reviewed-entry.json",
		]) {
			expect(argvSurfaces).not.toContain(reviewedValue);
			expect(JSON.stringify(result)).not.toContain(reviewedValue);
		}
		const evaluatedInput = runtime.commandInputs[5];
		expect(evaluatedInput?.stdinText).toContain(script);
		expect(evaluatedInput?.stdinText).toContain(JSON.stringify(reviewedInputs));
	});

	test("retries a transiently unavailable reviewed mutation postcondition", async () => {
		const script =
			"async () => { document.querySelector('[data-week]').click() }";
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t8",
							active: true,
							type: "page",
							url: "https://example.test/weeks",
						},
					],
				}),
			},
			{ stdout: json({}) },
			{ stdout: json({ snapshot: "week list", refs: {} }) },
			{ stdout: json({ url: "https://example.test/weeks" }) },
			{ stdout: json({ result: {} }) },
			{ stdout: json({ url: "https://example.test/week" }) },
			{ stdout: semanticFailure() },
			{ stdout: json({ url: "https://example.test/week" }) },
			{ stdout: json({ visible: true }) },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-reviewed-navigation-settle",
			target_tab_id: "t8",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: false },
				{
					kind: "evaluate",
					action_id: "timesheet.open-week",
					script,
					script_sha256: createHash("sha256").update(script).digest("hex"),
					review_status: "approved",
					allowed_origin: "https://example.test",
					effect: "mutation",
					inputs: {},
					postcondition: {
						kind: "element-visible",
						selector: "[data-timesheet-grid]",
					},
				},
			],
		});

		expect(result).toMatchObject({
			ok: true,
			outcome: "confirmed",
			executed_steps: 2,
			mutation_dispatched: true,
		});
		expect(
			runtime.calls.filter(
				(call) => call.includes("is") && call.includes("visible"),
			),
		).toHaveLength(2);
	});

	test("refuses an iterated mutation before dispatch without durable item checkpoints", async () => {
		const script = "async ({ inputs }) => { document.querySelector('#save').click() }";
		const runtime = runtimeFor([]);
		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-item-checkpoint-required",
			target_tab_id: "t8",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: false },
				{
					kind: "evaluate",
					action_id: "timesheet-fill-entry",
					item_key: "monday",
					script,
					script_sha256: createHash("sha256").update(script).digest("hex"),
					review_status: "approved",
					allowed_origin: "https://example.test",
					effect: "mutation",
					inputs: {},
					postcondition: {
						kind: "element-visible",
						selector: "[data-entry=monday]",
					},
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_item_checkpoint_unavailable",
			outcome: "not-achieved",
			mutation_dispatched: false,
		});
		expect(runtime.calls).toEqual([]);
	});

	test("a failed durable item checkpoint becomes unknown and runs no later item", async () => {
		const script = "async ({ inputs }) => { document.querySelector('#save').click() }";
		const runtime = Object.assign(
			runtimeFor([
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
				{ stdout: json({ refs: {} }) },
				{ stdout: json({ url: "https://example.test/week" }) },
				{ stdout: json({ result: {} }) },
				{ stdout: json({ url: "https://example.test/week" }) },
				{ stdout: json({ visible: true }) },
			]),
			{
				afterItemCheckpoint: async () => ({ ok: false as const }),
			},
		);
		const evaluate = (item_key: string) =>
			({
				kind: "evaluate",
				action_id: "timesheet-fill-entry",
				item_key,
				script,
				script_sha256: createHash("sha256").update(script).digest("hex"),
				review_status: "approved",
				allowed_origin: "https://example.test",
				effect: "mutation",
				inputs: {},
				postcondition: {
					kind: "element-visible",
					selector: `[data-entry=${item_key}]`,
				},
			}) as const;
		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-item-checkpoint-failed",
			target_tab_id: "t8",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: false },
				evaluate("monday"),
				{ kind: "snapshot", interactive: false },
				evaluate("tuesday"),
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_mutation_effect_unknown",
			outcome: "unknown",
			mutation_dispatched: true,
		});
		expect(runtime.calls.filter((call) => call.includes("eval"))).toHaveLength(1);
		expect(
			runtime.calls.filter(
				(call) => call.includes("is") && call.includes("visible"),
			),
		).toHaveLength(1);
	});

	test("a timed-out iterated mutation checkpoints unknown", async () => {
		const script = "async ({ inputs }) => { document.querySelector('#save').click() }";
		const checkpoints: string[] = [];
		const runtime = Object.assign(
			runtimeFor([
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
				{ stdout: json({ refs: {} }) },
				{ stdout: json({ url: "https://example.test/week" }) },
				{ exitCode: 1, timedOut: true },
			]),
			{
				afterItemCheckpoint: async (checkpoint: { outcome: string }) => {
					checkpoints.push(checkpoint.outcome);
					return { ok: true as const };
				},
			},
		);
		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-item-timeout",
			target_tab_id: "t8",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: false },
				{
					kind: "evaluate",
					action_id: "timesheet-fill-entry",
					item_key: "monday",
					script,
					script_sha256: createHash("sha256").update(script).digest("hex"),
					review_status: "approved",
					allowed_origin: "https://example.test",
					effect: "mutation",
					inputs: {},
					postcondition: {
						kind: "element-visible",
						selector: "[data-entry=monday]",
					},
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_mutation_effect_unknown",
			outcome: "unknown",
		});
		expect(checkpoints).toEqual(["unknown"]);
	});

	test("a false iterated mutation postcondition records unknown and blocks resume", async () => {
		const script = "async ({ inputs }) => { document.querySelector('#save').click() }";
		let durableBatch: BrowserUseItemBatchState = {
			schema_version: "1",
			item_keys: ["monday"],
			checkpoints: [],
		};
		const runtime = Object.assign(
			runtimeFor([
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
				{ stdout: json({ refs: {} }) },
				{ stdout: json({ url: "https://example.test/week" }) },
				{ stdout: json({ result: {} }) },
				{ stdout: json({ url: "https://example.test/week" }) },
				{ stdout: json({ visible: false }) },
			]),
			{
				afterItemCheckpoint: async (checkpoint: {
					item_key: string;
					outcome: "confirmed" | "unknown";
				}) => {
					const recorded = recordItemCheckpoint(durableBatch, {
						itemKey: checkpoint.item_key,
						outcome: checkpoint.outcome,
					});
					if (!recorded.ok) return { ok: false as const };
					durableBatch = recorded.state;
					return { ok: true as const };
				},
			},
		);
		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-item-postcondition-false",
			target_tab_id: "t8",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: false },
				{
					kind: "evaluate",
					action_id: "timesheet-fill-entry",
					item_key: "monday",
					script,
					script_sha256: createHash("sha256").update(script).digest("hex"),
					review_status: "approved",
					allowed_origin: "https://example.test",
					effect: "mutation",
					inputs: {},
					postcondition: {
						kind: "element-visible",
						selector: "[data-entry=monday]",
					},
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_postcondition_not_achieved",
			outcome: "not-achieved",
			mutation_dispatched: true,
		});
		expect(durableBatch.checkpoints).toEqual([
			{ item_key: "monday", outcome: "unknown" },
		]);
		expect(resolveNextBatchItem(durableBatch)).toEqual({
			kind: "blocked",
			item_key: "monday",
			item_index: 0,
			reason: "unknown",
		});
		expect(runtime.calls.filter((call) => call.includes("eval"))).toHaveLength(1);
		expect(
			runtime.calls.filter(
				(call) => call.includes("is") && call.includes("visible"),
			),
		).toHaveLength(1);
	});

	test.each([
		["object", { rows: 7 }],
		["scalar", 7],
	] as const)(
		"captures the native eval result field for a %s read observation",
		async (_shape, observation) => {
			const script = "async () => ({ rows: 7 })";
			const runtime = runtimeFor([
				{
					stdout: json({
						tabs: [
							{
								tabId: "t-read",
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
				{ stdout: json({ result: observation }) },
			]);

			const result = await executeAgentBrowserTask(runtime, {
				handoff: HANDOFF,
				run_id: `run-reviewed-read-${_shape}`,
				target_tab_id: "t-read",
				allowed_origins: ["https://example.test"],
				steps: [
					{ kind: "snapshot", interactive: false },
					{
						kind: "evaluate",
						action_id: "timesheet.diagnose",
						item_key: "monday",
						script,
						script_sha256: createHash("sha256").update(script).digest("hex"),
						review_status: "approved",
						allowed_origin: "https://example.test",
						effect: "read",
						inputs: {},
					},
				],
			});

			expect(result).toMatchObject({
				ok: true,
				read_results: [
					{
						action_id: "timesheet.diagnose",
						item_key: "monday",
						data: observation,
					},
				],
			});
		},
	);

	test("a later read failure preserves an earlier mutation dispatch", async () => {
		const script = "async () => ({ rows: 7 })";
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t-mutate-read",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{ stdout: json({}) },
			{ stdout: json({ opened: true }) },
			{ stdout: json({ url: "https://example.test/week" }) },
			{ stdout: json({ snapshot: "week grid", refs: {} }) },
			{ stdout: json({ url: "https://example.test/week" }) },
			{ exitCode: 1, stdout: semanticFailure() },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-mutation-then-read-failure",
			target_tab_id: "t-mutate-read",
			allowed_origins: ["https://example.test"],
			steps: [
				{
					kind: "open",
					url: "https://example.test/week",
					postcondition: {
						kind: "url-equals",
						url: "https://example.test/week",
					},
				},
				{ kind: "snapshot", interactive: false },
				{
					kind: "evaluate",
					action_id: "timesheet.diagnose",
					script,
					script_sha256: createHash("sha256").update(script).digest("hex"),
					review_status: "approved",
					allowed_origin: "https://example.test",
					effect: "read",
					inputs: {},
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_action_read_not_achieved",
			outcome: "not-achieved",
			mutation_dispatched: true,
		});
	});

	test("refuses a non-durable item key before evaluated action dispatch", async () => {
		const script = "async () => ({ rows: 7 })";
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t-item-key",
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
			run_id: "run-invalid-item-key",
			target_tab_id: "t-item-key",
			allowed_origins: ["https://example.test"],
			steps: [
				{ kind: "snapshot", interactive: false },
				{
					kind: "evaluate",
					action_id: "timesheet.diagnose",
					item_key: "Monday",
					script,
					script_sha256: createHash("sha256").update(script).digest("hex"),
					review_status: "approved",
					allowed_origin: "https://example.test",
					effect: "read",
					inputs: {},
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_action_integrity_refused",
			mutation_dispatched: false,
		});
		expect(runtime.calls.some((call) => call.includes("eval"))).toBe(false);
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
		expect(runtime.calls).toHaveLength(4);
	});
});

describe("Agent Browser target resolution", () => {
	const targetEnvelopeId = "a".repeat(32);
	const openStep = {
		kind: "open",
		url: "https://example.test/",
		postcondition: { kind: "url-equals", url: "https://example.test/" },
	} as const;

	test("auto-resolves one admissible tab to a deterministic opaque binding", async () => {
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t1",
							targetId: "target-1",
							type: "page",
							url: "https://example.test/",
						},
						{
							tabId: "worker1",
							type: "service_worker",
							url: "https://example.test/sw.js",
						},
					],
				}),
			},
		]);

		const result = await resolveAgentBrowserTaskTarget(runtime, {
			handoff: HANDOFF,
			run_id: "run-auto-target",
			allowed_origins: ["https://example.test"],
			steps: [openStep],
			target: { kind: "auto", target_envelope_id: targetEnvelopeId },
		});

		expect(result).toEqual({
			ok: true,
			target_tab_id: "target-1",
			target_id: "target-1",
			target_url: "https://example.test/",
			binding: {
				schema_version: "1",
				target_candidate_id: candidateIdOf(targetEnvelopeId, [
					"adapter_page_id",
					"target-1",
				]),
			},
		});
		expect(JSON.stringify(result)).not.toContain('"tab_id"');
		expect(runtime.calls).toHaveLength(1);
	});

	test("returns transport failure separately from zero-candidate truth", async () => {
		const runtime = runtimeFor([
			{ stdout: cdpConnectFailure() },
			{ stdout: json({ cdpUrl: HANDOFF.endpoint.ws }) },
			{ stdout: cdpConnectFailure() },
			{ stdout: json({ cdpUrl: HANDOFF.endpoint.ws }) },
			{ stdout: cdpConnectFailure() },
		]);

		const result = await resolveAgentBrowserTaskTarget(runtime, {
			handoff: HANDOFF,
			run_id: "run-target-transport",
			allowed_origins: ["https://example.test"],
			steps: [openStep],
			target: { kind: "auto", target_envelope_id: targetEnvelopeId },
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_connection_unstable",
			connection: {
				attempts: 3,
				max_attempts: 3,
			},
		});
		expect(runtime.calls.map(semanticCallArgs)).toEqual([
			["tab", "list", "--json"],
			["get", "cdp-url", "--json"],
			["tab", "list", "--json"],
			["get", "cdp-url", "--json"],
			["tab", "list", "--json"],
		]);
	});

	test("does not reconnect a target-list failure without a connection signal", async () => {
		const runtime = runtimeFor([{ stdout: semanticFailure() }]);

		const result = await resolveAgentBrowserTaskTarget(runtime, {
			handoff: HANDOFF,
			run_id: "run-target-list-semantic-failure",
			allowed_origins: ["https://example.test"],
			steps: [openStep],
			target: { kind: "auto", target_envelope_id: targetEnvelopeId },
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_target_unavailable",
		});
		expect(runtime.calls.map(semanticCallArgs)).toEqual([
			["tab", "list", "--json"],
		]);
	});

	test("preserves an explicit exact override when multiple tabs are admissible", async () => {
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t1",
							targetId: "target-1",
							type: "page",
							url: "https://example.test/one",
						},
						{
							tabId: "t2",
							targetId: "target-2",
							type: "page",
							url: "https://example.test/two",
						},
					],
				}),
			},
		]);

		const result = await resolveAgentBrowserTaskTarget(runtime, {
			handoff: HANDOFF,
			run_id: "run-exact-target",
			allowed_origins: ["https://example.test"],
			steps: [openStep],
			target: {
				kind: "exact",
				tab_id: "t2",
				target_envelope_id: targetEnvelopeId,
			},
		});

		expect(result).toMatchObject({
			ok: true,
			target_tab_id: "target-2",
			target_id: "target-2",
		});
	});

	test("accepts a canonical CDP target id across session-local tab ids", async () => {
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "session-local-7",
							targetId: "cdp-target-42",
							type: "page",
							url: "https://example.test/fixture",
						},
					],
				}),
			},
		]);

		const result = await resolveAgentBrowserTaskTarget(runtime, {
			handoff: HANDOFF,
			run_id: "run-canonical-target",
			allowed_origins: ["https://example.test"],
			steps: [openStep],
			target: {
				kind: "exact",
				tab_id: "cdp-target-42",
				target_envelope_id: targetEnvelopeId,
			},
		});

		expect(result).toEqual({
			ok: true,
			target_tab_id: "cdp-target-42",
			target_id: "cdp-target-42",
			target_url: "https://example.test/fixture",
			binding: {
				schema_version: "1",
				target_candidate_id: candidateIdOf(targetEnvelopeId, [
					"adapter_page_id",
					"cdp-target-42",
				]),
			},
		});
		expect(runtime.releaseCalls.map((call) => call.args)).toEqual([
			[
				"--session",
				"browser-use-run-canonical-target",
				"close",
				"--json",
			],
			["session", "list", "--json"],
		]);
	});

	test("releases the derived session when target resolution refuses", async () => {
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "session-local-7",
							targetId: "cdp-target-42",
							type: "page",
							url: "https://other.test/",
						},
					],
				}),
			},
		]);

		const result = await resolveAgentBrowserTaskTarget(runtime, {
			handoff: HANDOFF,
			run_id: "run-target-refusal-release",
			allowed_origins: ["https://example.test"],
			steps: [openStep],
			target: {
				kind: "exact",
				tab_id: "cdp-target-42",
				target_envelope_id: targetEnvelopeId,
			},
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_target_origin_refused",
		});
		expect(runtime.releaseCalls.map((call) => call.args)).toEqual([
			[
				"--session",
				"browser-use-run-target-refusal-release",
				"close",
				"--json",
			],
			["session", "list", "--json"],
		]);
	});

	test("returns typed zero-candidate and ambiguous repair truth", async () => {
		const zeroRuntime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t1",
							targetId: "target-1",
							type: "page",
							url: "https://other.test/",
						},
					],
				}),
			},
		]);
		const ambiguousRuntime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t1",
							targetId: "target-1",
							type: "page",
							url: "https://example.test/one",
						},
						{
							tabId: "t2",
							targetId: "target-2",
							type: "page",
							url: "https://example.test/two",
						},
					],
				}),
			},
		]);
		const baseInput = {
			handoff: HANDOFF,
			run_id: "run-repair-target",
			allowed_origins: ["https://example.test"],
			steps: [openStep],
			target: { kind: "auto", target_envelope_id: targetEnvelopeId },
		} as const;

		const zero = await resolveAgentBrowserTaskTarget(zeroRuntime, baseInput);
		const ambiguous = await resolveAgentBrowserTaskTarget(
			ambiguousRuntime,
			baseInput,
		);

		expect(zero).toMatchObject({
			ok: false,
			code: "agent_browser_target_unavailable",
		});
		expect(ambiguous).toMatchObject({
			ok: false,
			code: "agent_browser_target_ambiguous",
		});
	});

	test("never falls back when an opaque bound target moved", async () => {
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t2",
							targetId: "target-2",
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
		]);

		const result = await resolveAgentBrowserTaskTarget(runtime, {
			handoff: HANDOFF,
			run_id: "run-bound-target",
			allowed_origins: ["https://example.test"],
			steps: [openStep],
			target: {
				kind: "auto",
				target_envelope_id: targetEnvelopeId,
				bound_target_candidate_id: candidateIdOf(targetEnvelopeId, [
					"adapter_page_id",
					"t1",
				]),
			},
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_target_moved",
		});
	});

	test("admits exact about:blank only for a first remaining open", async () => {
		const firstOpenRuntime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t1",
							targetId: "target-1",
							type: "page",
							url: "about:blank",
						},
					],
				}),
			},
		]);
		const firstSnapshotRuntime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t1",
							targetId: "target-1",
							type: "page",
							url: "about:blank",
						},
					],
				}),
			},
		]);
		const base = {
			handoff: HANDOFF,
			run_id: "run-neutral-target",
			allowed_origins: ["https://example.test"],
			target: { kind: "auto", target_envelope_id: targetEnvelopeId },
		} as const;

		const accepted = await resolveAgentBrowserTaskTarget(firstOpenRuntime, {
			...base,
			steps: [openStep],
		});
		const refused = await resolveAgentBrowserTaskTarget(firstSnapshotRuntime, {
			...base,
			steps: [{ kind: "snapshot", interactive: true }],
		});

		expect(accepted).toMatchObject({
			ok: true,
			target_tab_id: "target-1",
			target_id: "target-1",
			target_url: "about:blank",
		});
		expect(refused).toMatchObject({
			ok: false,
			code: "agent_browser_target_unavailable",
		});
	});

	test("executes the allowed first open from an exact about:blank target", async () => {
		const runtime = runtimeFor([
			{
				stdout: json({
					tabs: [{ tabId: "t1", type: "page", url: "about:blank" }],
				}),
			},
			{ stdout: json({ selected: true }) },
			{ stdout: json({ opened: true }) },
			{ stdout: json({ url: "https://example.test/" }) },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-neutral-open",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [openStep],
			allow_neutral_target: true,
		});

		expect(result).toMatchObject({
			ok: true,
			outcome: "confirmed",
			executed_steps: 1,
			mutation_dispatched: true,
		});
		expect(runtime.calls.map(semanticCallArgs)).toEqual([
			["tab", "list", "--json"],
			["tab", "t1", "--json"],
			["get", "url", "--json"],
			["open", "https://example.test/", "--json"],
			["get", "url", "--json"],
		]);
	});

	test("refuses when the selected target moves before execution", async () => {
		const runtime = runtimeFor(
			[
				{
					stdout: json({
						tabs: [
							{
								tabId: "t1",
								targetId: "target-1",
								type: "page",
								url: "https://example.test/",
							},
						],
					}),
				},
				{ stdout: json({ selected: true }) },
			],
			{ selectedUrlProof: "https://other.test/" },
		);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-selected-moved",
			target_tab_id: "t1",
			allowed_origins: ["https://example.test"],
			steps: [{ kind: "snapshot", interactive: true }],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_target_moved",
		});
		expect(runtime.calls).toHaveLength(3);
	});

	test("refuses same-origin path drift since target resolution", async () => {
		const resolutionRuntime = runtimeFor([
			{
				stdout: json({
					tabs: [
							{
								tabId: "t1",
								targetId: "target-1",
								type: "page",
							url: "https://example.test/original",
						},
					],
				}),
			},
		]);
		const resolution = await resolveAgentBrowserTaskTarget(resolutionRuntime, {
			handoff: HANDOFF,
			run_id: "run-path-drift",
			allowed_origins: ["https://example.test"],
			steps: [{ kind: "snapshot", interactive: true }],
			target: { kind: "auto", target_envelope_id: targetEnvelopeId },
		});
		if (!resolution.ok) throw new Error("target resolution failed");

		const executionRuntime = runtimeFor([
			{
				stdout: json({
					tabs: [
						{
							tabId: "t1",
							targetId: "target-1",
							type: "page",
							url: "https://example.test/drifted",
						},
					],
				}),
			},
			{ stdout: json({ selected: true }) },
		]);
		const result = await executeAgentBrowserTask(executionRuntime, {
			handoff: HANDOFF,
			run_id: "run-path-drift",
			target_tab_id: resolution.target_tab_id,
			expected_target_url: resolution.target_url,
			allowed_origins: ["https://example.test"],
			steps: [{ kind: "snapshot", interactive: true }],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_target_moved",
			outcome: "not-achieved",
		});
		expect(executionRuntime.calls).toHaveLength(3);
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
			// pre-dispatch origin proof
			{ stdout: json({ url: "https://example.test/" }) },
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
			{ stdout: json({ url: "https://example.test/" }) }, // pre-dispatch origin
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
		expect(runtime.calls).toHaveLength(6);
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
