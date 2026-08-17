import { describe, expect, test } from "bun:test";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import {
	type ChromeTask,
	DEFAULT_LIGHTHOUSE_INSIGHT,
	compileChromeOperationSet,
	executeChromeTask,
	pageUrlFromListing,
	scrubEvidence,
} from "./browser-use-chrome-task";
import type { BrowserUseRuntime } from "./browser-use-runtime";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";

const HANDOFF = {
	outcome: "verified",
	environment: { name: "agent-chrome", profile: "default" },
	browser_entry_mode: "explicit-cdp",
	attachment: {
		adapter_id: "chrome-devtools-mcp",
		route: "explicit-cdp",
		probe_executable: "/opt/browser-connect/chrome-devtools-mcp",
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

// chrome-devtools-mcp answers over mcporter as an MCP content envelope. Shapes
// below are the VERBATIM structure captured from a live probe against the
// running adapter on 2026-07-27 (bun runtime/browser-connect connect
// chrome-devtools-mcp --json, then envelope-derived mcporter calls). A hand-built
// fake keyed on the wrong envelope shape (e.g. agent-browser's {success,data})
// would be caught by the process-boundary test at the bottom.
function mcpText(text: string): string {
	return JSON.stringify({ content: [{ type: "text", text }] });
}
function mcpError(text: string): string {
	return JSON.stringify({ content: [{ type: "text", text }], isError: true });
}

// Real list_pages text envelope shape: `<id>: <title> (<url>) [selected]?`.
function pagesListing(): string {
	return mcpText(
		[
			"## Pages",
			"1: Storybook (http://localhost:6007/iframe.html?id=x) [selected]",
			"2: example form (https://example.test/form)",
		].join("\n"),
	);
}

// Real connection-class failure fragment (chrome-devtools-mcp -32000 family).
function cdpConnectFailure(): string {
	return mcpError("MCP error -32000: Browser is not connected");
}

function runtimeFor(
	responses: readonly {
		exitCode?: number;
		stdout?: string;
		stderr?: string;
		timedOut?: boolean;
	}[],
	options: { writeFails?: boolean } = {},
): BrowserUseRuntime & {
	calls: Array<readonly string[]>;
	writes: Map<string, string>;
	ensuredDirs: string[];
} {
	const calls: Array<readonly string[]> = [];
	const writes = new Map<string, string>();
	const ensuredDirs: string[] = [];
	let index = 0;
	const runCommand = async (
		input: McporterCommandInput,
	): Promise<McporterCommandResult> => {
		calls.push([input.command, ...input.args]);
		const response = responses[index++] ?? {};
		return {
			exitCode: response.exitCode ?? 0,
			stdout: response.stdout ?? mcpText(""),
			stderr: response.stderr ?? "",
			...(response.timedOut === undefined ? {} : { timedOut: response.timedOut }),
		};
	};
	return {
		calls,
		writes,
		ensuredDirs,
		env: {},
		now: () => 0,
		runCommand,
		readTextFile: async () => "",
		// Capture artifact writes so tests can assert the bytes landed at the
		// derived path (never a bare reference). Optionally simulate a write
		// failure so the fail-closed path is exercisable.
		writeTextFile: async (path: string, contents: string) => {
			if (options.writeFails) throw new Error("simulated write failure");
			writes.set(path, contents);
		},
		ensureDirectory: async (path: string) => {
			ensuredDirs.push(path);
		},
		readStdin: async () => "",
		platformFs: {} as BrowserUseRuntime["platformFs"],
		// Chrome-task unit runtime never mints (D4): the executor receives its
		// handoff via the task input; fail loud if a test reaches the mint seam.
		mintHandoff: async () => {
			throw new Error("mintHandoff must not run in chrome-task unit tests");
		},
	};
}

function baseTask(overrides: Partial<ChromeTask> = {}): ChromeTask {
	return {
		handoff: HANDOFF,
		run_id: "run-chrome-1",
		target_page_id: 2,
		allowed_origins: ["https://example.test"],
		operations: [],
		...overrides,
	};
}

describe("Chrome DevTools MCP task lane", () => {
	test("refuses when a numeric page id reorders away from the leased exact URL", async () => {
		const runtime = runtimeFor([{ stdout: pagesListing() }]);
		const result = await executeChromeTask(
			runtime,
			baseTask({ expected_target_url: "https://example.test/other" }),
		);
		expect(result).toMatchObject({
			ok: false,
			code: "chrome_task_target_unavailable",
		});
	});

	test("proves the target page origin, reads console + network, returns bounded evidence", async () => {
		const runtime = runtimeFor([
			{ stdout: pagesListing() },
			{ stdout: mcpText("## Console messages\n[error] boom at app.js:10") },
			{ stdout: mcpText("GET https://example.test/api 200\nGET https://example.test/x 404") },
		]);

		const result = await executeChromeTask(
			runtime,
			baseTask({
				operations: [{ kind: "console-read" }, { kind: "network-read" }],
			}),
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.outcome).toBe("confirmed");
			expect(result.executed_operations).toBe(2);
			expect(result.target_page_id).toBe(2);
			expect(result.evidence[0]).toMatchObject({ kind: "console" });
			expect(result.evidence[1]).toMatchObject({ kind: "network", request_count: 2 });
			expect(result.artifacts).toEqual([]);
		}
		// list_pages, then the two read tools — each envelope-derived through the
		// pinned probe executable and verified http endpoint.
		expect(runtime.calls).toHaveLength(3);
		const listCall = runtime.calls[0]?.join(" ") ?? "";
		expect(listCall).toContain("/opt/browser-connect/chrome-devtools-mcp");
		expect(listCall).toContain("http://127.0.0.1:9222");
		expect(listCall).toContain("list_pages");
		expect(runtime.calls[1]?.join(" ")).toContain("list_console_messages");
		expect(runtime.calls[2]?.join(" ")).toContain("list_network_requests");
	});

	test("refuses a page whose current origin is outside the allowed origins", async () => {
		const runtime = runtimeFor([{ stdout: pagesListing() }]);
		const result = await executeChromeTask(
			runtime,
			// page id 1 is the localhost Storybook page, not example.test.
			baseTask({ target_page_id: 1, operations: [{ kind: "console-read" }] }),
		);
		expect(result).toMatchObject({
			ok: false,
			code: "chrome_task_target_origin_refused",
			outcome: "not-achieved",
		});
		// Refused before any evidence read: only the list_pages call ran.
		expect(runtime.calls).toHaveLength(1);
	});

	test("refuses an absent target page id", async () => {
		const runtime = runtimeFor([{ stdout: pagesListing() }]);
		const result = await executeChromeTask(
			runtime,
			baseTask({ target_page_id: 99, operations: [{ kind: "console-read" }] }),
		);
		expect(result).toMatchObject({
			ok: false,
			code: "chrome_task_target_unavailable",
		});
	});

	test("fails closed when the handoff names another adapter or schema", async () => {
		const runtime = runtimeFor([]);
		const result = await executeChromeTask(runtime, {
			...baseTask(),
			handoff: {
				...HANDOFF,
				attachment: { ...HANDOFF.attachment, adapter_id: "agent-browser" },
			},
		});
		expect(result).toMatchObject({
			ok: false,
			code: "chrome_task_handoff_invalid",
		});
		expect(runtime.calls).toEqual([]);
	});

	test("performance trace writes native evidence bytes to the derived artifact path, never inlined into the envelope", async () => {
		const runtime = runtimeFor([
			{ stdout: pagesListing() },
			{ stdout: mcpText("Trace started") },
			{ stdout: mcpText("## Trace summary\nLCP 2.1s") },
		]);
		const artifactPath = "/runs/run-chrome-1/artifacts/run-chrome-1-perf-trace.json";
		const result = await executeChromeTask(
			runtime,
			baseTask({
				artifact_dir: "/runs/run-chrome-1/artifacts",
				operations: [{ kind: "performance-trace", reload: true }],
			}),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.artifacts).toEqual([
				{
					kind: "performance-trace",
					path: artifactPath,
					sensitivity: "high",
				},
			]);
			expect(result.evidence[0]).toMatchObject({ kind: "analysis" });
		}
		expect(runtime.calls[1]?.join(" ")).toContain("performance_start_trace");
		expect(runtime.calls[2]?.join(" ")).toContain("performance_stop_trace");
		// The artifact reference points at a file that now exists: the native
		// trace evidence was written to the derived path.
		expect(runtime.ensuredDirs).toContain("/runs/run-chrome-1/artifacts");
		expect(runtime.writes.has(artifactPath)).toBe(true);
		expect(runtime.writes.get(artifactPath)).toContain("LCP 2.1s");
	});

	test("a failed artifact write fails closed as a command failure, never a dangling reference", async () => {
		const runtime = runtimeFor(
			[
				{ stdout: pagesListing() },
				{ stdout: mcpText("Trace started") },
				{ stdout: mcpText("## Trace summary\nLCP 2.1s") },
			],
			{ writeFails: true },
		);
		const result = await executeChromeTask(
			runtime,
			baseTask({
				artifact_dir: "/runs/run-chrome-1/artifacts",
				operations: [{ kind: "performance-trace", reload: true }],
			}),
		);
		expect(result).toMatchObject({
			ok: false,
			code: "chrome_task_command_failed",
			outcome: "not-achieved",
		});
	});

	test("refuses an artifact-producing operation with no artifact directory", async () => {
		const runtime = runtimeFor([{ stdout: pagesListing() }]);
		const result = await executeChromeTask(
			runtime,
			baseTask({ operations: [{ kind: "performance-trace", reload: false }] }),
		);
		expect(result).toMatchObject({
			ok: false,
			code: "chrome_task_artifact_dir_required",
		});
		// No trace tools ran: refused after page proof, before any dispatch.
		expect(runtime.calls).toHaveLength(1);
	});

	test("lighthouse-insight analysis writes native evidence bytes to the derived artifact path", async () => {
		const runtime = runtimeFor([
			{ stdout: pagesListing() },
			{ stdout: mcpText("## Insight: LCP breakdown\nphase details") },
		]);
		const artifactPath = "/runs/a/run-chrome-1-lighthouse-LCPBreakdown.json";
		const result = await executeChromeTask(
			runtime,
			baseTask({
				artifact_dir: "/runs/a",
				operations: [
					{ kind: "lighthouse-insight", insight_name: "LCPBreakdown" },
				],
			}),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.artifacts[0]).toMatchObject({
				kind: "lighthouse",
				path: artifactPath,
			});
		}
		expect(runtime.calls[1]?.join(" ")).toContain("performance_analyze_insight");
		// The reference points at a file that now exists on disk.
		expect(runtime.ensuredDirs).toContain("/runs/a");
		expect(runtime.writes.has(artifactPath)).toBe(true);
		expect(runtime.writes.get(artifactPath)).toContain("phase details");
	});

	test("refuses a lighthouse insight name that is not a bounded safe identifier (path traversal)", async () => {
		for (const insightName of ["../../etc/evil", "nested/insight"]) {
			const runtime = runtimeFor([
				{ stdout: pagesListing() },
				{ stdout: mcpText("## Insight\nshould never analyze") },
			]);
			const result = await executeChromeTask(
				runtime,
				baseTask({
					artifact_dir: "/runs/a",
					operations: [{ kind: "lighthouse-insight", insight_name: insightName }],
				}),
			);
			expect(result).toMatchObject({
				ok: false,
				code: "chrome_task_invalid",
				outcome: "not-achieved",
			});
			// Refused BEFORE the insight tool ran and before any write: only the
			// list_pages call happened and nothing landed on disk.
			expect(runtime.calls).toHaveLength(1);
			expect([...runtime.writes.keys()]).toEqual([]);
		}
	});

	test("a normal lighthouse insight name still writes native evidence to the derived path", async () => {
		const runtime = runtimeFor([
			{ stdout: pagesListing() },
			{ stdout: mcpText("## Insight: LCP\nphase details") },
		]);
		const artifactPath = "/runs/a/run-chrome-1-lighthouse-LCPBreakdown.json";
		const result = await executeChromeTask(
			runtime,
			baseTask({
				artifact_dir: "/runs/a",
				operations: [{ kind: "lighthouse-insight", insight_name: "LCPBreakdown" }],
			}),
		);
		expect(result.ok).toBe(true);
		expect(runtime.writes.has(artifactPath)).toBe(true);
	});

	test("a semantic tool error mid-task is not-achieved, never unknown (reads are side-effect free)", async () => {
		const runtime = runtimeFor([
			{ stdout: pagesListing() },
			{ stdout: mcpError("MCP error -32602: Input validation error") },
		]);
		const result = await executeChromeTask(
			runtime,
			baseTask({ operations: [{ kind: "console-read" }] }),
		);
		expect(result).toMatchObject({
			ok: false,
			code: "chrome_task_command_failed",
			outcome: "not-achieved",
		});
	});
});

describe("compileChromeOperationSet (intent-aware operation sets, R21/R23/AE9)", () => {
	test("debug compiles to bounded console + network reads, no artifact op", () => {
		expect(compileChromeOperationSet("debug")).toEqual([
			{ kind: "console-read" },
			{ kind: "network-read" },
		]);
	});

	test("performance-profile compiles to a start/stop trace, reloading by default", () => {
		expect(compileChromeOperationSet("performance-profile")).toEqual([
			{ kind: "performance-trace", reload: true },
		]);
		// Caller can opt out of the cold-trace reload.
		expect(
			compileChromeOperationSet("performance-profile", { reload: false }),
		).toEqual([{ kind: "performance-trace", reload: false }]);
	});

	test("lighthouse-audit compiles to a performance-insight analysis with a default insight", () => {
		expect(compileChromeOperationSet("lighthouse-audit")).toEqual([
			{ kind: "lighthouse-insight", insight_name: DEFAULT_LIGHTHOUSE_INSIGHT },
		]);
		expect(
			compileChromeOperationSet("lighthouse-audit", {
				insightName: "CLSCulprits",
			}),
		).toEqual([{ kind: "lighthouse-insight", insight_name: "CLSCulprits" }]);
	});

	test("R23: performance-profile and lighthouse-audit compile to DIFFERENT operation kinds", () => {
		const trace = compileChromeOperationSet("performance-profile");
		const audit = compileChromeOperationSet("lighthouse-audit");
		expect(trace[0]?.kind).toBe("performance-trace");
		expect(audit[0]?.kind).toBe("lighthouse-insight");
	});

	test("a compiled debug intent drives the real executor to a two-op console+network read", async () => {
		const runtime = runtimeFor([
			{ stdout: pagesListing() },
			{ stdout: mcpText("## Console messages\n[error] boom at app.js:10") },
			{
				stdout: mcpText(
					"GET https://example.test/api 200\nGET https://example.test/x 404",
				),
			},
		]);
		const result = await executeChromeTask(
			runtime,
			baseTask({ operations: compileChromeOperationSet("debug") }),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.executed_operations).toBe(2);
			expect(result.evidence[0]).toMatchObject({ kind: "console" });
			expect(result.evidence[1]).toMatchObject({ kind: "network" });
			expect(result.artifacts).toEqual([]);
		}
		expect(runtime.calls[1]?.join(" ")).toContain("list_console_messages");
		expect(runtime.calls[2]?.join(" ")).toContain("list_network_requests");
	});

	test("a compiled lighthouse-audit intent drives the executor to one insight artifact", async () => {
		const runtime = runtimeFor([
			{ stdout: pagesListing() },
			{ stdout: mcpText("## Insight: LCP breakdown\nphase details") },
		]);
		const result = await executeChromeTask(
			runtime,
			baseTask({
				artifact_dir: "/runs/a",
				operations: compileChromeOperationSet("lighthouse-audit"),
			}),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.artifacts[0]).toMatchObject({
				kind: "lighthouse",
				path: `/runs/a/run-chrome-1-lighthouse-${DEFAULT_LIGHTHOUSE_INSIGHT}.json`,
			});
		}
		expect(runtime.calls[1]?.join(" ")).toContain("performance_analyze_insight");
		expect(runtime.calls[1]?.join(" ")).toContain(DEFAULT_LIGHTHOUSE_INSIGHT);
	});
});

describe("Chrome DevTools MCP connection robustness (no flaky CDP connections)", () => {
	test("recovers from one transient CDP failure with a bounded reconnect", async () => {
		const runtime = runtimeFor([
			{ stdout: cdpConnectFailure() }, // attempt 1 list_pages fails
			{ stdout: cdpConnectFailure() }, // liveness probe (re-list)
			{ stdout: pagesListing() }, // attempt 2 recovers
			{ stdout: mcpText("## Console messages\n<no console messages found>") },
		]);
		const result = await executeChromeTask(
			runtime,
			baseTask({ operations: [{ kind: "console-read" }] }),
		);
		expect(result).toMatchObject({ ok: true, outcome: "confirmed" });
		expect(runtime.calls[0]?.join(" ")).toContain("list_pages");
		expect(runtime.calls[1]?.join(" ")).toContain("list_pages");
	});

	test("reports a typed connection failure with diagnostic evidence after reconnect exhausts", async () => {
		const runtime = runtimeFor([
			{ stdout: cdpConnectFailure() }, // attempt 1
			{ stdout: cdpConnectFailure() }, // probe
			{ stdout: cdpConnectFailure() }, // attempt 2
			{ stdout: cdpConnectFailure() }, // probe
			{ stdout: cdpConnectFailure() }, // attempt 3
		]);
		const result = await executeChromeTask(
			runtime,
			baseTask({ operations: [{ kind: "console-read" }] }),
		);
		expect(result).toMatchObject({
			ok: false,
			code: "chrome_task_connection_unstable",
			outcome: "not-achieved",
		});
		if (!result.ok) {
			expect(result.connection?.attempts).toBe(3);
			expect(result.connection?.max_attempts).toBe(3);
			expect(result.connection?.last_signal).toContain("Browser is not connected");
			expect(result.connection?.next_repair_action).toContain("browser-connect");
		}
		expect(runtime.calls).toHaveLength(5);
	});

	test("never reconnects a semantic refusal — a genuinely absent page is not flaky", async () => {
		const runtime = runtimeFor([
			{ stdout: mcpText("## Pages\n1: other (https://other.test/)") },
		]);
		const result = await executeChromeTask(
			runtime,
			baseTask({ target_page_id: 2, operations: [{ kind: "console-read" }] }),
		);
		expect(result).toMatchObject({
			ok: false,
			code: "chrome_task_target_unavailable",
		});
		// Exactly one call: no retry, no liveness probe.
		expect(runtime.calls).toHaveLength(1);
	});

	test("a timed-out connection attempt is connection-class and drives the reconnect", async () => {
		const runtime = runtimeFor([
			{ exitCode: 1, timedOut: true, stderr: "timed out" }, // attempt 1
			{ stdout: mcpText("probe") }, // probe
			{ stdout: pagesListing() }, // attempt 2 recovers
		]);
		const result = await executeChromeTask(runtime, baseTask({ operations: [] }));
		expect(result).toMatchObject({ ok: true, outcome: "confirmed", executed_operations: 0 });
	});
});

describe("Chrome DevTools MCP evidence secret containment (R14, AE9)", () => {
	test("scrubs credential header lines from captured evidence", () => {
		const raw = [
			"GET https://example.test/api",
			"Authorization: Bearer eyJhbGciOiJIUzI1NiSECRETTOKEN",
			"Cookie: session=abc123deadbeef",
			"Set-Cookie: id=zzz; HttpOnly",
			"content-type: application/json",
		].join("\n");
		const scrubbed = scrubEvidence(raw);
		expect(scrubbed).not.toContain("SECRETTOKEN");
		expect(scrubbed).not.toContain("abc123deadbeef");
		expect(scrubbed).not.toContain("id=zzz");
		expect(scrubbed).toContain("Authorization: [redacted]");
		expect(scrubbed).toContain("Cookie: [redacted]");
		// Non-sensitive structural evidence survives.
		expect(scrubbed).toContain("content-type: application/json");
		expect(scrubbed).toContain("GET https://example.test/api");
	});

	test("redacts secret query params but keeps the structural URL", () => {
		const raw =
			"GET https://loginanyoneqa3.monash.edu/sso/saml?SAMLRequest=jZLRT8SECRET&RelayState=keepme";
		const scrubbed = scrubEvidence(raw);
		expect(scrubbed).not.toContain("jZLRT8SECRET");
		expect(scrubbed).toContain("SAMLRequest=%5Bredacted%5D");
		expect(scrubbed).toContain("RelayState=keepme");
		expect(scrubbed).toContain("loginanyoneqa3.monash.edu");
	});

	test("bounds oversized evidence to the budget", () => {
		const raw = "x".repeat(10_000);
		const scrubbed = scrubEvidence(raw);
		expect(scrubbed.length).toBeLessThan(10_000);
		expect(scrubbed).toContain("[truncated]");
	});

	test("captured network evidence from a live-shaped auth URL carries no sentinel secret", async () => {
		const authNetwork = mcpText(
			[
				"GET https://monashuni.okta.com/oauth2/v1/authorize?code=SENTINELSECRETCODE&scope=openid 302",
				"Authorization: Bearer SENTINELBEARERVALUE",
			].join("\n"),
		);
		const runtime = runtimeFor([
			{
				stdout: mcpText(
					"## Pages\n2: okta (https://example.test/) [selected]",
				),
			},
			{ stdout: authNetwork },
		]);
		const result = await executeChromeTask(
			runtime,
			baseTask({ operations: [{ kind: "network-read" }] }),
		);
		expect(result.ok).toBe(true);
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("SENTINELSECRETCODE");
		expect(serialized).not.toContain("SENTINELBEARERVALUE");
	});
});

describe("pageUrlFromListing", () => {
	test("extracts the URL for a page id from the real listing shape", () => {
		const text = [
			"## Pages",
			"1: Storybook (http://localhost:6007/x) [selected]",
			"2: example form (https://example.test/form)",
		].join("\n");
		expect(pageUrlFromListing(text, 1)).toBe("http://localhost:6007/x");
		expect(pageUrlFromListing(text, 2)).toBe("https://example.test/form");
		expect(pageUrlFromListing(text, 3)).toBeUndefined();
	});
});

// --- Process-boundary proof against the real dependency shape (repo rule) -----
// REAL_HANDOFF is the verbatim `data` payload captured from a live
// `bun runtime/browser-connect connect chrome-devtools-mcp --json` on 2026-07-27
// (ws token is a localhost dev endpoint, not a secret). REAL_LIST_PAGES and
// REAL_CONSOLE_EMPTY are verbatim stdout from live envelope-derived mcporter
// calls against the running adapter. If the upstream contract or the adapter's
// MCP envelope shape drifts, this test breaks — unlike a hand-built fake that
// could silently diverge (e.g. keying on the agent-browser {success,data}
// envelope this adapter does NOT use).
const REAL_HANDOFF = {
	outcome: "verified",
	environment: { name: "agent-chrome", profile: "default" },
	browser_entry_mode: "explicit-cdp",
	attachment: {
		adapter_id: "chrome-devtools-mcp",
		route: "explicit-cdp",
		probe_executable:
			"/Users/nathanvale/.side-quest/browser-connect/adapters/chrome-devtools-mcp/1.5.0/node_modules/.bin/chrome-devtools-mcp",
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

// Verbatim stdout captured from a live list_pages call (page list trimmed to two
// rows; the real envelope carried 30+). Note: MCP content-array envelope, NOT
// the agent-browser {success,data,error} envelope.
const REAL_LIST_PAGES =
	'{"content":[{"type":"text","text":"## Pages\\n1: path-prototype-forms--text-field-states (http://localhost:6007/iframe.html?id=path-prototype-forms--text-field-states&viewMode=story) [selected]\\n2: example (https://example.test/form)"}]}';

// Verbatim stdout from a live list_console_messages call (empty console).
const REAL_CONSOLE_EMPTY =
	'{"content":[{"type":"text","text":"## Console messages\\n<no console messages found>"}]}';

// Verbatim stdout from a live list_console_messages call with a MISSING pageId:
// the adapter answers with a -32602 validation error inside an isError envelope.
const REAL_PAGEID_VALIDATION_ERROR =
	'{"content":[{"type":"text","text":"MCP error -32602: Input validation error: Invalid arguments for tool list_console_messages: [\\n  {\\n    \\"code\\": \\"invalid_type\\",\\n    \\"path\\": [\\n      \\"pageId\\"\\n    ]\\n  }\\n]"}],"isError":true}';

// Verbatim stdout captured 2026-07-27 from a live envelope-derived mcporter call
// (list_pages AND performance_start_trace both) against the Warm Chrome on
// 127.0.0.1:9222 whose HTTP CDP discovery endpoint returns 404 — the adapter
// cannot fetch a browser webSocket URL and answers with this not-connected
// error envelope. Captured while attempting the wave-3 live-trace proof; the
// live trace itself is operator-gated behind Chrome's missing --remote-debugging
// discovery endpoint (see the unit summary). Folded in so the classification of
// this REAL shape is pinned by a process-boundary test rather than assumed.
const REAL_NOT_CONNECTED_ERROR =
	'{"content":[{"type":"text","text":"Could not connect to Chrome. Check if Chrome is running.\\nCause: Failed to fetch browser webSocket URL from http://127.0.0.1:9222/json/version: HTTP Not Found"}],"isError":true}';

describe("Chrome DevTools MCP process-boundary shape proof", () => {
	test("real captured handoff + list_pages + console envelopes drive a confirmed read", async () => {
		const runtime = runtimeFor([
			{ stdout: REAL_LIST_PAGES },
			{ stdout: REAL_CONSOLE_EMPTY },
		]);
		const result = await executeChromeTask(runtime, {
			handoff: REAL_HANDOFF,
			run_id: "run-real-shape",
			target_page_id: 2,
			allowed_origins: ["https://example.test"],
			operations: [{ kind: "console-read" }],
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.evidence[0]).toMatchObject({ kind: "console" });
		}
	});

	test("real not-connected error envelope (404 CDP discovery) is target-unavailable, tried once — no reconnect", async () => {
		// The Warm Chrome on 127.0.0.1:9222 during the wave-3 live-trace attempt
		// exposed no HTTP CDP discovery endpoint (/json/version -> 404), so every
		// adapter tool answered with REAL_NOT_CONNECTED_ERROR. Its text carries
		// none of the CONNECTION_FAILURE_SIGNALS, so it is NOT connection-class: a
		// list_pages returning it fails closed as target-unavailable on the first
		// attempt, with no bounded reconnect. Pinning the REAL shape keeps this
		// classification honest if the adapter's not-connected text ever drifts.
		const runtime = runtimeFor([{ stdout: REAL_NOT_CONNECTED_ERROR }]);
		const result = await executeChromeTask(runtime, {
			handoff: REAL_HANDOFF,
			run_id: "run-real-notconn",
			target_page_id: 0,
			allowed_origins: ["https://example.test"],
			operations: [{ kind: "console-read" }],
		});
		expect(result).toMatchObject({
			ok: false,
			code: "chrome_task_target_unavailable",
			outcome: "not-achieved",
		});
		// Exactly one call: a not-connected envelope with no connection signal is
		// not treated as flaky, so no liveness probe / reconnect fires.
		expect(runtime.calls).toHaveLength(1);
	});

	test("real -32602 validation error envelope is a semantic command failure, not connection-class", async () => {
		const runtime = runtimeFor([
			{ stdout: REAL_LIST_PAGES },
			{ stdout: REAL_PAGEID_VALIDATION_ERROR },
		]);
		const result = await executeChromeTask(runtime, {
			handoff: REAL_HANDOFF,
			run_id: "run-real-err",
			target_page_id: 2,
			allowed_origins: ["https://example.test"],
			operations: [{ kind: "console-read" }],
		});
		// Not misclassified as connection_unstable: a validation error means the
		// adapter is connected and answering, so it is a plain command failure.
		expect(result).toMatchObject({
			ok: false,
			code: "chrome_task_command_failed",
			outcome: "not-achieved",
		});
	});
});
