import { describe, expect, test } from "bun:test";
import { type BrowserUseRuntime, runForTest } from "./browser-use";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";
import {
	commandVector,
	listPagesStdout,
	makeRuntime,
	okCommand,
	parseJson,
} from "./browser-use-test-helpers";
import {
	REAL_VERIFIED_HANDOFF_ENVELOPE,
	connectFailureEnvelope,
	verifiedHandoffEnvelope,
} from "./browser-connect-handoff-fixtures";

// =========================================================================
// U1 Browser Target Discovery — envelope-acceptance seam.
//
// `targets list` runs from a browser-connect Verified Handoff Envelope:
//   - handoff-bound (R1, R3): a verified envelope authorizes operation-ready
//     candidates; binding identity derives from envelope fields (KTD1).
//   - recovery (R2): requested adapter plus optional envelope evidence
//     (verified, a connect failure state, or explicit no-evidence entry);
//     candidates stay evidence-gathering only.
// =========================================================================

const LIST_PAGES_ARGS = [
	"call",
	"chrome-devtools.list_pages",
	"--args",
	"{}",
	"--output",
	"json",
];

// Runtime that serves --handoff file reads from a map and returns a fixed
// list_pages response for the mcporter call.
function discoveryRuntime(input: {
	files?: Record<string, string>;
	pages?: McporterCommandResult;
	runCommand?: BrowserUseRuntime["runCommand"];
	env?: Record<string, string | undefined>;
}): { runtime: BrowserUseRuntime; calls: McporterCommandInput[] } {
	const calls: McporterCommandInput[] = [];
	const files = input.files ?? {};
	const runtime = makeRuntime({
		env: input.env ?? {},
		readTextFile: async (path) => {
			if (path in files) return files[path];
			throw new Error(`ENOENT: ${path}`);
		},
		runCommand:
			input.runCommand ??
			(async (call) => {
				calls.push(call);
				return input.pages ?? okCommand(listPagesStdout([{ id: "P1", url: "https://example.com/" }]));
			}),
	});
	return { runtime, calls };
}

describe("U1 target discovery — handoff-bound mode", () => {
	test("requires --mode and --handoff", async () => {
		const noMode = await runForTest(["targets", "list", "--json"], makeRuntime());
		expect(noMode.exitCode).not.toBe(0);
		expect(parseJson(noMode.stdout).error).toMatchObject({
			code: "target_discovery_input_invalid",
		});

		const noHandoff = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--json"],
			makeRuntime(),
		);
		expect(noHandoff.exitCode).toBe(20);
		const json = parseJson(noHandoff.stdout);
		expect(json.error).toMatchObject({ code: "target_discovery_handoff_invalid" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"supply_verified_handoff",
		);
	});

	test("a verified envelope authorizes handoff-bound listing and inherits its run id", async () => {
		const { runtime } = discoveryRuntime({
			// The raw capture is pretty-printed real emission-path output; this also
			// proves the parser accepts the CLI's actual serialization.
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
			pages: okCommand(
				listPagesStdout([
					{ id: "P1", url: "https://example.com/app", title: "App" },
					{ id: "P2", url: "https://example.com/docs", title: "Docs" },
				]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("ok");
		expect(json.data).toMatchObject({
			contract: "browser-use.browser-targets",
			schema_version: "2",
			mode: "handoff-bound",
			handoff_bound: true,
			operation_ready: true,
			requested_adapter: "chrome-devtools",
			candidate_count: 2,
			binding: {
				// Run id inherited from the envelope (R3).
				run_id: "fixture-run",
				selected_adapter_id: "chrome-devtools",
				verified_endpoint_identity: "127.0.0.1:53412",
			},
		});
		const binding = (json.data as Record<string, any>).binding;
		expect(typeof binding.handoff_evidence_id).toBe("string");
		expect(binding.handoff_evidence_id.length).toBeGreaterThan(0);
		expect(typeof binding.target_envelope_id).toBe("string");
		// Handoff-bound success points at select.
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"select_browser_target",
		);
		// Candidate ordinals are scoped 1..n and carry a derived candidate id.
		const candidates = (json.data as Record<string, any>).candidates;
		expect(candidates[0].candidate_ordinal).toBe(1);
		expect(candidates[1].candidate_ordinal).toBe(2);
		expect(typeof candidates[0].candidate_id).toBe("string");
	});

	test("a wrong contract id is a typed rejection with exactly one continuation", async () => {
		const { runtime } = discoveryRuntime({
			files: {
				"/h.json": verifiedHandoffEnvelope((envelope) => {
					envelope.data.contract_id = "some.other.contract";
				}),
			},
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_discovery_handoff_invalid" });
		expect((json.runtime_actions as unknown[]).length).toBe(1);
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"supply_verified_handoff",
		);
	});

	test("a wrong schema version is a typed rejection (KTD1 drift tripwire)", async () => {
		const { runtime } = discoveryRuntime({
			files: {
				"/h.json": verifiedHandoffEnvelope((envelope) => {
					envelope.data.schema_version = "99";
				}),
			},
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_handoff_invalid",
		});
	});

	test("a real connect failure envelope never authorizes handoff-bound listing", async () => {
		const { runtime, calls } = discoveryRuntime({
			files: { "/h.json": connectFailureEnvelope() },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_discovery_handoff_invalid" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"supply_verified_handoff",
		);
		// No page listing happened against an unverified connection.
		expect(calls).toHaveLength(0);
	});

	test("missing attachment fields are a typed rejection", async () => {
		const { runtime } = discoveryRuntime({
			files: {
				"/h.json": verifiedHandoffEnvelope((envelope) => {
					delete envelope.data.attachment;
				}),
			},
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_handoff_invalid",
		});
	});

	test("an unrecognized attachment adapter id fails closed", async () => {
		const { runtime, calls } = discoveryRuntime({
			files: {
				"/h.json": verifiedHandoffEnvelope((envelope) => {
					envelope.data.attachment.adapter_id = "mystery-adapter";
				}),
			},
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_handoff_invalid",
		});
		expect(calls).toHaveLength(0);
	});

	test("a caller --run-id disagreeing with the envelope run id is a typed mismatch (R3)", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--run-id", "some-other-run", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_discovery_run_mismatch" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"supply_verified_handoff",
		);
	});

	test("a matching caller --run-id is accepted and threads through (AE1)", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--run-id", "fixture-run", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.run_id).toBe("fixture-run");
		expect((json.data as Record<string, any>).binding.run_id).toBe("fixture-run");
	});

	test("a --adapter contradicting the envelope's adapter fails closed", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--adapter", "playwright-cdp", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_input_invalid",
		});
		expect(`${result.stdout}`).toContain("contradicts");
	});
});

describe("U1 target discovery — recovery mode", () => {
	test("recovery requires --adapter", async () => {
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_input_invalid",
		});
	});

	test("recovery with envelope-only evidence lists evidence-gathering candidates (AE2)", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
			pages: okCommand(
				listPagesStdout([
					{ id: "P1", url: "https://example.com/app", title: "App" },
				]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.data).toMatchObject({
			mode: "recovery",
			handoff_bound: false,
			operation_ready: false,
			requested_adapter: "chrome-devtools",
			candidate_count: 1,
			binding: {
				selected_adapter_id: "chrome-devtools",
				verified_endpoint_identity: "127.0.0.1:53412",
			},
		});
		// AE2: the continuation names a command that exists post-migration.
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"connect_verified_browser",
		);
		const action = (json.runtime_actions as Record<string, unknown>[])[0];
		expect(action.summary).toContain("browser-connect connect");
	});

	test("recovery accepts a connect failure envelope as evidence (R2)", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": connectFailureEnvelope() },
			pages: okCommand(
				listPagesStdout([{ id: "P1", url: "https://example.com/", title: "Home" }]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.data).toMatchObject({
			mode: "recovery",
			handoff_bound: false,
			operation_ready: false,
		});
		// A failure envelope carries no verified identity; the recovery binding
		// omits the handoff identity fields rather than inventing them.
		const binding = (json.data as Record<string, any>).binding;
		expect(binding.verified_endpoint_identity).toBeUndefined();
		expect(binding.handoff_evidence_id).toBeUndefined();
	});

	test("recovery without --handoff is an explicit no-evidence entry (R2)", async () => {
		const { runtime } = discoveryRuntime({
			pages: okCommand(
				listPagesStdout([{ id: "P1", url: "https://example.com/", title: "Home" }]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.data).toMatchObject({
			mode: "recovery",
			handoff_bound: false,
			operation_ready: false,
		});
	});

	test("a verified envelope for a different adapter is a typed mismatch", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "playwright-cdp", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_discovery_handoff_mismatch" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"refresh_verified_handoff",
		);
	});
});

describe("U1 target discovery — empty set, transport, and envelope mapping", () => {
	test("an empty candidate set emits structured recovery, not success", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
			pages: okCommand(listPagesStdout([])),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("error");
		expect(json.error).toMatchObject({ code: "target_discovery_no_candidates" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"open_browser_target",
		);
	});

	test("a timed-out list_pages maps to a timeout envelope, never success", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
			pages: { exitCode: 1, stdout: "", stderr: "", timedOut: true },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_transport_timeout",
		});
	});

	test("a missing mcporter dependency maps to dependency recovery", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
			runCommand: async () => {
				throw new Error("spawn ENOENT");
			},
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(1);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_dependency_missing",
		});
	});

	test("a non-zero list_pages exit is a transport failure, not empty success", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
			pages: { exitCode: 3, stdout: "", stderr: "boom" },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_transport_failed",
		});
	});

	test("discovery calls list_pages through the shared transport", async () => {
		const { runtime, calls } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
		});
		await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(calls).toHaveLength(1);
		expect(commandVector(calls[0])).toEqual(["mcporter", ...LIST_PAGES_ARGS]);
	});

	test("an adapter without a discovery transport fails closed, never lists chrome-devtools", async () => {
		// Discovery must not silently list chrome-devtools pages for a
		// non-chrome-devtools adapter. Recovery for playwright-cdp fails closed
		// before any transport call.
		const { runtime, calls } = discoveryRuntime({});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "playwright-cdp", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_transport_failed",
		});
		expect(calls).toHaveLength(0);
	});
});

describe("U1 target discovery — privacy release gate", () => {
	const FORBIDDEN = [
		"secret-token",
		"sessionid",
		"#frag",
		"P1",
		"P2",
		"ws://",
		"devtools/page",
	];

	test("query strings, fragments, page ids, and CDP/WS handles never appear in JSON", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
			pages: okCommand(
				listPagesStdout([
					{
						id: "P1",
						url: "https://example.com/account/profile?token=secret-token&sessionid=abc#frag",
						title: "Account",
					},
					{
						id: "P2",
						url: "ws://127.0.0.1:9222/devtools/page/DEADBEEF",
						title: "ws",
					},
				]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--show-url", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		for (const token of FORBIDDEN) {
			expect(result.stdout).not.toContain(token);
			expect(result.stderr).not.toContain(token);
		}
	});

	test("the envelope's websocket debugger URL never appears in discovery output", async () => {
		// The verified handoff envelope carries the ws debugger URL; browser-use
		// derives identity from it but must never re-emit it (R32).
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).not.toContain("devtools/browser");
		expect(result.stdout).not.toContain("ws://");
	});

	test("--show-url displays origin and redacted path shape only", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
			pages: okCommand(
				listPagesStdout([
					{
						id: "P1",
						url: "https://example.com/account?token=secret-token#frag",
						title: "Account",
					},
				]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--show-url", "--json"],
			runtime,
		);
		const candidate = (parseJson(result.stdout).data as Record<string, any>)
			.candidates[0];
		expect(candidate.origin).toBe("https://example.com");
		expect(candidate.path_shape).toContain("/account");
		expect(candidate.path_shape).not.toContain("secret-token");
		expect(candidate.path_shape).not.toContain("frag");
	});

	test("path_shape tokenizes identifier-bearing segments so path tokens never leak", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
			pages: okCommand(
				listPagesStdout([
					{
						id: "P1",
						url: "https://example.com/reset/a8f3e9c2d1b04f6e8a7c3d2e1f0b9a8c/invite/Xh92Kd71Qz/user/40198",
						title: "Reset",
					},
				]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--show-url", "--json"],
			runtime,
		);
		const candidate = (parseJson(result.stdout).data as Record<string, any>)
			.candidates[0];
		expect(candidate.path_shape).toContain("/reset/");
		expect(candidate.path_shape).toContain(":id");
		expect(candidate.path_shape).toContain(":num");
		expect(result.stdout).not.toContain("a8f3e9c2d1b04f6e8a7c3d2e1f0b9a8c");
		expect(result.stdout).not.toContain("Xh92Kd71Qz");
		expect(result.stdout).not.toContain("40198");
	});

	test("path_shape tokenizes a UUID segment", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
			pages: okCommand(
				listPagesStdout([
					{
						id: "P1",
						url: "https://example.com/orders/550e8400-e29b-41d4-a716-446655440000",
						title: "Order",
					},
				]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--show-url", "--json"],
			runtime,
		);
		const candidate = (parseJson(result.stdout).data as Record<string, any>)
			.candidates[0];
		expect(candidate.path_shape).toBe("/orders/:uuid");
		expect(result.stdout).not.toContain("550e8400");
	});

	test("a title carrying a query string or fragment is redacted", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
			pages: okCommand(
				listPagesStdout([
					{
						id: "P1",
						url: "https://example.com/",
						title: "Dashboard ?token=secret-token#frag",
					},
				]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const candidate = (parseJson(result.stdout).data as Record<string, any>)
			.candidates[0];
		expect(candidate.title).toBe("Dashboard");
		expect(result.stdout).not.toContain("secret-token");
		expect(result.stdout).not.toContain("frag");
	});

	test("without --show-url the path shape is omitted entirely", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE },
			pages: okCommand(
				listPagesStdout([
					{ id: "P1", url: "https://example.com/secret/path", title: "X" },
				]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/h.json", "--json"],
			runtime,
		);
		const candidate = (parseJson(result.stdout).data as Record<string, any>)
			.candidates[0];
		expect(candidate.origin).toBe("https://example.com");
		expect(candidate.path_shape).toBeUndefined();
		expect(result.stdout).not.toContain("/secret/path");
	});
});
