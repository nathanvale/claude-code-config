import { describe, expect, test } from "bun:test";
import { type BrowserUseRuntime, runForTest } from "./browser-use";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";
import {
	adapterProofEnvelope,
	commandVector,
	listPagesStdout,
	makeRuntime,
	okCommand,
	parseJson,
	routeSuccessEnvelope,
	ROUTER_CONTRACT,
} from "./browser-use-test-helpers";

// =========================================================================
// U5 Browser Target Discovery
// =========================================================================

const LIST_PAGES_ARGS = [
	"call",
	"chrome-devtools.list_pages",
	"--args",
	"{}",
	"--output",
	"json",
];

// Runtime that serves --route/--adapter-proof file reads from a map and returns
// a fixed list_pages response for the mcporter call.
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

describe("U5 target discovery — recovery mode", () => {
	test("requires --mode, --adapter, and --adapter-proof", async () => {
		// Missing mode.
		const noMode = await runForTest(["targets", "list", "--json"], makeRuntime());
		expect(noMode.exitCode).not.toBe(0);
		expect(parseJson(noMode.stdout).error).toMatchObject({
			code: "target_discovery_route_invalid",
		});

		// Missing adapter-proof.
		const noProof = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--json"],
			makeRuntime(),
		);
		expect(noProof.exitCode).toBe(20);
		expect(parseJson(noProof.stdout).error).toMatchObject({
			code: "target_discovery_adapter_proof_invalid",
		});

		// Missing adapter.
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope() },
		});
		const noAdapter = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(noAdapter.exitCode).toBe(2);
		expect(parseJson(noAdapter.stdout).error).toMatchObject({
			code: "target_discovery_route_invalid",
		});
	});

	test("emits route_bound=false, operation_ready=false, adapter proof binding, and recovery-safe candidates", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope() },
			pages: okCommand(
				listPagesStdout([
					{ id: "P1", url: "https://example.com/app", title: "App" },
					{ id: "P2", url: "https://example.com/docs", title: "Docs" },
				]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("ok");
		expect(json.data).toMatchObject({
			mode: "recovery",
			route_bound: false,
			operation_ready: false,
			requested_adapter: "chrome-devtools",
			candidate_count: 2,
			binding: {
				adapter_proof_id: "proof-abc",
				warm_chrome_run_id: "warm-1",
				selected_adapter_id: "chrome-devtools",
				verified_endpoint_identity: "127.0.0.1:9222",
			},
		});
		// Recovery binding carries no route slice.
		expect((json.data as Record<string, any>).binding.route_evidence_hash).toBeUndefined();
		// Candidate ordinals are scoped 1..n and carry a derived candidate id.
		const candidates = (json.data as Record<string, any>).candidates;
		expect(candidates[0].candidate_ordinal).toBe(1);
		expect(candidates[1].candidate_ordinal).toBe(2);
		expect(typeof candidates[0].candidate_id).toBe("string");
	});

	test("recovery output is shaped for prepare --target-discovery and select continuation", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope() },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		const json = parseJson(result.stdout);
		// Recovery candidates are evidence-gathering only: the continuation points
		// at prepare, never at select/operate (R20, R25).
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"prepare_with_target_discovery",
		);
		expect(json.data).toMatchObject({ route_bound: false, operation_ready: false });
	});

	test("adapter-mismatched proof fails with refresh_adapter_proof", async () => {
		const { runtime } = discoveryRuntime({
			files: {
				"/p.json": adapterProofEnvelope({ adapter: "chrome-devtools" }),
			},
		});
		// Requested adapter differs from the proof's adapter.
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "playwright-cdp", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({
			code: "target_discovery_adapter_proof_mismatch",
		});
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"refresh_adapter_proof",
		);
	});

	test("an invalid adapter proof fails with supply_adapter_proof", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/p.json": JSON.stringify({ status: "error" }) },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_adapter_proof_invalid",
		});
		expect(
			(parseJson(result.stdout).continuation as Record<string, unknown>)
				.next_action_id,
		).toBe("supply_adapter_proof");
	});
});

describe("U5 target discovery — route-bound mode", () => {
	test("requires --mode route-bound, --route, and --adapter-proof", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope() },
		});
		const noRoute = await runForTest(
			["targets", "list", "--mode", "route-bound", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(noRoute.exitCode).toBe(20);
		expect(parseJson(noRoute.stdout).error).toMatchObject({
			code: "target_discovery_route_invalid",
		});
	});

	test("emits route_bound=true, operation_ready=true, route/proof binding, target envelope id, and candidates", async () => {
		const { runtime } = discoveryRuntime({
			files: {
				"/p.json": adapterProofEnvelope(),
				"/route.json": routeSuccessEnvelope(),
			},
			pages: okCommand(
				listPagesStdout([{ id: "P1", url: "https://example.com/", title: "Home" }]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "route-bound", "--route", "/route.json", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.data).toMatchObject({
			mode: "route-bound",
			route_bound: true,
			operation_ready: true,
			requested_adapter: "chrome-devtools",
			candidate_count: 1,
			binding: {
				adapter_proof_id: "proof-abc",
				route_evidence_hash: "hash-xyz",
				run_id: "route-run",
			},
		});
		const binding = (json.data as Record<string, any>).binding;
		expect(typeof binding.target_envelope_id).toBe("string");
		expect(binding.target_envelope_id.length).toBeGreaterThan(0);
		// Route-bound success points at select.
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"select_browser_target",
		);
	});

	test("proof not matching the route binding fails with refresh_adapter_proof", async () => {
		const { runtime } = discoveryRuntime({
			files: {
				"/p.json": adapterProofEnvelope({ adapter_proof_id: "proof-other" }),
				"/route.json": routeSuccessEnvelope(),
			},
		});
		const result = await runForTest(
			["targets", "list", "--mode", "route-bound", "--route", "/route.json", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_adapter_proof_mismatch",
		});
	});

	test("a --adapter contradicting the route's selected adapter fails closed", async () => {
		const { runtime } = discoveryRuntime({
			files: {
				"/p.json": adapterProofEnvelope(),
				"/route.json": routeSuccessEnvelope(),
			},
		});
		const result = await runForTest(
			["targets", "list", "--mode", "route-bound", "--adapter", "playwright-cdp", "--route", "/route.json", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_route_invalid",
		});
		expect(`${result.stdout}`).toContain("contradicts");
	});

	test("a route success without an operation binding is rejected", async () => {
		const noBinding = JSON.stringify({
			status: "ok",
			run_id: "route-run",
			data: {
				outcome: "selected",
				contract: ROUTER_CONTRACT,
				selected_adapter: "chrome-devtools",
			},
		});
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope(), "/route.json": noBinding },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "route-bound", "--route", "/route.json", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_route_invalid",
		});
	});

	test("a route success missing the router contract id is rejected", async () => {
		// A hand-written/partial file that omits the contract must not authorize
		// discovery (PR #168 review): contract id is required, not optional.
		const noContract = JSON.stringify({
			status: "ok",
			run_id: "route-run",
			data: {
				outcome: "selected",
				selected_adapter: "chrome-devtools",
				binding: {
					run_id: "route-run",
					selected_adapter_id: "chrome-devtools",
					warm_chrome_run_id: "warm-1",
					adapter_proof_id: "proof-abc",
					verified_endpoint_identity: "127.0.0.1:9222",
					route_evidence_hash: "hash-xyz",
				},
			},
		});
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope(), "/route.json": noContract },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "route-bound", "--route", "/route.json", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_route_invalid",
		});
	});

	test("a route whose binding selected_adapter_id disagrees with selected_adapter is rejected", async () => {
		// Internally inconsistent route file (PR #168 review): the binding names a
		// different adapter than the route's selected_adapter. Fail closed.
		const inconsistent = JSON.stringify({
			status: "ok",
			run_id: "route-run",
			data: {
				outcome: "selected",
				contract: ROUTER_CONTRACT,
				selected_adapter: "chrome-devtools",
				binding: {
					run_id: "route-run",
					selected_adapter_id: "playwright-cdp",
					warm_chrome_run_id: "warm-1",
					adapter_proof_id: "proof-abc",
					verified_endpoint_identity: "127.0.0.1:9222",
					route_evidence_hash: "hash-xyz",
				},
			},
		});
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope(), "/route.json": inconsistent },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "route-bound", "--route", "/route.json", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_route_invalid",
		});
	});
});

describe("U5 target discovery — empty set, transport, and envelope mapping", () => {
	test("an empty candidate set emits structured recovery, not success", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope() },
			pages: okCommand(listPagesStdout([])),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--json"],
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
			files: { "/p.json": adapterProofEnvelope() },
			pages: { exitCode: 1, stdout: "", stderr: "", timedOut: true },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_transport_timeout",
		});
	});

	test("a missing mcporter dependency maps to dependency recovery", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope() },
			runCommand: async () => {
				throw new Error("spawn ENOENT");
			},
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(1);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_dependency_missing",
		});
	});

	test("a non-zero list_pages exit is a transport failure, not empty success", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope() },
			pages: { exitCode: 3, stdout: "", stderr: "boom" },
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_transport_failed",
		});
	});

	test("discovery calls list_pages through the shared transport", async () => {
		const { runtime, calls } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope() },
		});
		await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(calls).toHaveLength(1);
		expect(commandVector(calls[0])).toEqual(["mcporter", ...LIST_PAGES_ARGS]);
	});

	test("an adapter without a discovery transport fails closed, never lists chrome-devtools", async () => {
		// PR #168 review: discovery must not silently list chrome-devtools pages for
		// a non-chrome-devtools adapter. Recovery for playwright-cdp (proof matches)
		// fails closed before any transport call.
		const { runtime, calls } = discoveryRuntime({
			files: {
				"/p.json": adapterProofEnvelope({ adapter: "playwright-cdp" }),
			},
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "playwright-cdp", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_discovery_transport_failed",
		});
		// No list_pages call was made against the wrong adapter.
		expect(calls).toHaveLength(0);
	});
});

describe("U5 target discovery — privacy release gate", () => {
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
			files: { "/p.json": adapterProofEnvelope() },
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
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--show-url", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		for (const token of FORBIDDEN) {
			expect(result.stdout).not.toContain(token);
			expect(result.stderr).not.toContain(token);
		}
	});

	test("--show-url displays origin and redacted path shape only", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope() },
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
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--show-url", "--json"],
			runtime,
		);
		const candidate = (parseJson(result.stdout).data as Record<string, any>)
			.candidates[0];
		expect(candidate.origin).toBe("https://example.com");
		// Path shape keeps short readable segments, strips the query/fragment, and
		// marks that a query/fragment existed without disclosing it.
		expect(candidate.path_shape).toContain("/account");
		expect(candidate.path_shape).not.toContain("secret-token");
		expect(candidate.path_shape).not.toContain("frag");
	});

	test("path_shape tokenizes identifier-bearing segments so path tokens never leak", async () => {
		// PR #168 review: --show-url must not forward raw path segments like reset
		// links, invite codes, UUIDs, or opaque ids. Each is projected to a type
		// token; readable nouns survive as semantic hints.
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope() },
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
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--show-url", "--json"],
			runtime,
		);
		const candidate = (parseJson(result.stdout).data as Record<string, any>)
			.candidates[0];
		// Readable nouns survive; identifiers/secrets become type tokens.
		expect(candidate.path_shape).toContain("/reset/");
		expect(candidate.path_shape).toContain(":id");
		expect(candidate.path_shape).toContain(":num");
		// The raw secret-bearing segments never appear.
		expect(result.stdout).not.toContain("a8f3e9c2d1b04f6e8a7c3d2e1f0b9a8c");
		expect(result.stdout).not.toContain("Xh92Kd71Qz");
		expect(result.stdout).not.toContain("40198");
	});

	test("path_shape tokenizes a UUID segment", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope() },
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
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--show-url", "--json"],
			runtime,
		);
		const candidate = (parseJson(result.stdout).data as Record<string, any>)
			.candidates[0];
		expect(candidate.path_shape).toBe("/orders/:uuid");
		expect(result.stdout).not.toContain("550e8400");
	});

	test("a title carrying a query string or fragment is redacted", async () => {
		const { runtime } = discoveryRuntime({
			files: { "/p.json": adapterProofEnvelope() },
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
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--json"],
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
			files: { "/p.json": adapterProofEnvelope() },
			pages: okCommand(
				listPagesStdout([
					{ id: "P1", url: "https://example.com/secret/path", title: "X" },
				]),
			),
		});
		const result = await runForTest(
			["targets", "list", "--mode", "recovery", "--adapter", "chrome-devtools", "--adapter-proof", "/p.json", "--json"],
			runtime,
		);
		const candidate = (parseJson(result.stdout).data as Record<string, any>)
			.candidates[0];
		expect(candidate.origin).toBe("https://example.com");
		expect(candidate.path_shape).toBeUndefined();
		expect(result.stdout).not.toContain("/secret/path");
	});
});
