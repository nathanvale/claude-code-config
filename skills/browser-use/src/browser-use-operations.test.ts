import { describe, expect, test } from "bun:test";
import {
	BROWSER_USE_OPERATION_CONTRACT_ID,
	BROWSER_USE_OPERATION_SCHEMA_VERSION,
} from "./command-contract";
import { type BrowserUseRuntime, runForTest } from "./browser-use";
import {
	candidateIdOf,
	handoffEvidenceIdOf,
	targetEnvelopeIdOf,
} from "./browser-use-core";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";
import {
	commandJsonArgs,
	commandVector,
	enoent,
	listPagesStdout,
	makeRuntime,
	okCommand,
	parseJson,
	TARGETS_CONTRACT,
} from "./browser-use-test-helpers";
import {
	REAL_VERIFIED_HANDOFF_ENVELOPE,
	connectFailureEnvelope,
	verifiedHandoffEnvelope,
} from "./browser-connect-handoff-fixtures";

// =========================================================================
// U7 Browser Operation Front Door (envelope-era contract from migration U1)
// =========================================================================

const FIXTURE_ENVELOPE = JSON.parse(REAL_VERIFIED_HANDOFF_ENVELOPE);
const FIXTURE_RUN_ID = FIXTURE_ENVELOPE.run_id as string;
const FIXTURE_EVIDENCE_ID = handoffEvidenceIdOf({
	runId: FIXTURE_ENVELOPE.run_id,
	attachmentAdapterId: FIXTURE_ENVELOPE.data.attachment.adapter_id,
	route: FIXTURE_ENVELOPE.data.attachment.route,
	endpointHttp: FIXTURE_ENVELOPE.data.endpoint.http,
	endpointWs: FIXTURE_ENVELOPE.data.endpoint.ws,
	proofContractId: FIXTURE_ENVELOPE.data.proof.environment_contract_id,
	proofSchemaVersion: FIXTURE_ENVELOPE.data.proof.environment_schema_version,
});

// The target envelope id operate derives for the fixture handoff, computed
// through the production hash helpers so state fixtures bind to the same
// identity the pipeline resolves.
const FIXTURE_TARGET_ENVELOPE_ID = targetEnvelopeIdOf({
	runId: FIXTURE_RUN_ID,
	mode: "handoff-bound",
	adapter: "chrome-devtools",
	handoffEvidenceId: FIXTURE_EVIDENCE_ID,
});

function operationCandidateId(pageId = "1"): string {
	return candidateIdOf(FIXTURE_TARGET_ENVELOPE_ID, ["adapter_page_id", pageId]);
}

function selectedStateFile(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		contract: TARGETS_CONTRACT,
		schema_version: "2",
		run_id: FIXTURE_RUN_ID,
		selected_adapter_id: "chrome-devtools",
		verified_endpoint_identity: "127.0.0.1:53412",
		handoff_evidence_id: FIXTURE_EVIDENCE_ID,
		target_envelope_id: FIXTURE_TARGET_ENVELOPE_ID,
		target_candidate_id: operationCandidateId(),
		selected_candidate_ordinal: 1,
		emitted_at_ms: 1_000,
		expires_at_ms: 1_000 + 15 * 60_000,
		display: { origin: "https://example.com", path_shape: "/app", title: "App" },
		...overrides,
	});
}

function operationRuntime(input: {
	files?: Record<string, string>;
	pages?: Array<{ id?: string; url?: string; title?: string }>;
	env?: Record<string, string | undefined>;
	operationResult?: McporterCommandResult;
	now?: () => number;
} = {}): {
	runtime: BrowserUseRuntime;
	calls: McporterCommandInput[];
	ensuredDirectories: string[];
} {
	const calls: McporterCommandInput[] = [];
	const ensuredDirectories: string[] = [];
	const files: Record<string, string> = {
		"/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE,
		...(input.files ?? {}),
	};
	const pages = input.pages ?? [
		{ id: "1", url: "https://example.com/app", title: "App" },
	];
	const runtime = makeRuntime({
		env: input.env ?? {},
		now: input.now ?? (() => 2_000),
		readTextFile: async (path) => {
			if (path in files) return files[path];
			throw enoent(path);
		},
		ensureDirectory: async (path) => {
			ensuredDirectories.push(path);
		},
		runCommand: async (call) => {
			calls.push(call);
			const callIndex = call.args.indexOf("call");
			const selector = callIndex >= 0 ? call.args[callIndex + 1] : undefined;
			if (selector === "chrome-devtools.list_pages") {
				return okCommand(listPagesStdout(pages));
			}
			if (selector === "chrome-devtools.select_page") return okCommand("{}");
			return (
				input.operationResult ??
				okCommand(JSON.stringify({ content: [{ type: "text", text: "Root\nButton" }] }))
			);
		},
	});
	return { runtime, calls, ensuredDirectories };
}

describe("U7 operation gates", () => {
	test("operate requires --handoff before any transport", async () => {
		const { runtime, calls } = operationRuntime();
		const result = await runForTest(["operate", "snapshot", "--json"], runtime);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "browser_operation_handoff_invalid" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"supply_verified_handoff",
		);
		expect(calls).toHaveLength(0);
	});

	test("a real connect failure envelope never authorizes an operation (AE4)", async () => {
		const { runtime, calls } = operationRuntime({
			files: { "/h.json": connectFailureEnvelope() },
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_handoff_invalid",
		});
		expect(calls).toHaveLength(0);
	});

	test("a drift-rejected envelope schema version fails before transport (KTD1)", async () => {
		const { runtime, calls } = operationRuntime({
			files: {
				"/h.json": verifiedHandoffEnvelope((envelope) => {
					envelope.data.schema_version = "99";
				}),
			},
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_handoff_invalid",
		});
		expect(calls).toHaveLength(0);
	});

	test("a caller --run-id disagreeing with the envelope run id fails before transport (R3)", async () => {
		const { runtime, calls } = operationRuntime();
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--run-id", "other-run", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_run_mismatch",
		});
		expect(calls).toHaveLength(0);
	});

	test("an adapter without operation capability is refused before transport (R5)", async () => {
		// agent-browser maps to a browser-use adapter with an EMPTY authorized
		// capability set (no operation transport yet): every operation class is
		// refused through the surviving router engine.
		const { runtime, calls } = operationRuntime({
			files: {
				"/h.json": verifiedHandoffEnvelope((envelope) => {
					envelope.data.attachment.adapter_id = "agent-browser";
				}),
			},
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_capability_unauthorized",
		});
		expect(calls).toHaveLength(0);
	});

	// Ported from the deleted browser-adapter-router suite ("emulate authorizes
	// only when viewport_emulation is routed" / "operation capability mapping
	// fails closed when capability not routed"): the operation-class ->
	// capability mapping is still enforced through the surviving engine's
	// authorizesOperationClass, now fed by the handoff adapter's pinned
	// operation capability set (BROWSER_USE_ADAPTER_OPERATION_CAPABILITIES).
	test("emulate is refused before transport when the adapter does not authorize viewport_emulation", async () => {
		const { runtime, calls } = operationRuntime({
			files: {
				"/h.json": verifiedHandoffEnvelope((envelope) => {
					envelope.data.attachment.adapter_id = "agent-browser";
				}),
			},
		});
		const result = await runForTest(
			[
				"operate",
				"emulate",
				"--width",
				"390",
				"--height",
				"844",
				"--handoff",
				"/h.json",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_capability_unauthorized",
		});
		expect(calls).toHaveLength(0);
	});

	test("screenshot is refused before transport when the adapter does not authorize screenshot_media", async () => {
		const { runtime, calls } = operationRuntime({
			files: {
				"/h.json": verifiedHandoffEnvelope((envelope) => {
					envelope.data.attachment.adapter_id = "agent-browser";
				}),
			},
		});
		const result = await runForTest(
			[
				"operate",
				"screenshot",
				"--out",
				"shot.png",
				"--handoff",
				"/h.json",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_capability_unauthorized",
		});
		expect(calls).toHaveLength(0);
	});

	test("screenshot requires --out before transport", async () => {
		const { runtime, calls } = operationRuntime();
		const result = await runForTest(
			["operate", "screenshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_artifact_path_required",
		});
		expect(calls).toHaveLength(0);
	});

	test("screenshot rejects unsafe artifact paths before transport", async () => {
		const { runtime, calls } = operationRuntime();
		const result = await runForTest(
			["operate", "screenshot", "--out", "../shot.png", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_artifact_path_unsafe",
		});
		expect(calls).toHaveLength(0);
	});

	test("screenshot rejects absolute and normalized traversal artifact paths", async () => {
		for (const out of ["/tmp/shot.png", "safe/../../shot.png"]) {
			const { runtime, calls } = operationRuntime();
			const result = await runForTest(
				["operate", "screenshot", "--out", out, "--handoff", "/h.json", "--json"],
				runtime,
			);
			expect(result.exitCode).toBe(2);
			expect(parseJson(result.stdout).error).toMatchObject({
				code: "browser_operation_artifact_path_unsafe",
			});
			expect(calls).toHaveLength(0);
		}
	});

	test("screenshot rejects relative artifact root env before transport", async () => {
		const { runtime, calls } = operationRuntime({
			env: { BROWSER_USE_ARTIFACT_ROOT: "relative-root" },
		});
		const result = await runForTest(
			["operate", "screenshot", "--out", "shot.png", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_artifact_path_unsafe",
		});
		expect(calls).toHaveLength(0);
	});

	test("emulate rejects malformed viewport input before transport", async () => {
		const { runtime, calls } = operationRuntime();
		const result = await runForTest(
			["operate", "emulate", "--width", "390", "--height", "0", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_viewport_invalid",
		});
		expect(calls).toHaveLength(0);
	});

	test("ambiguous targets emit choose-target recovery without selecting a page", async () => {
		const { runtime, calls } = operationRuntime({
			pages: [
				{ id: "1", url: "https://example.com/a", title: "A" },
				{ id: "2", url: "https://example.com/b", title: "B" },
			],
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "browser_operation_target_ambiguous" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"choose_target_candidate",
		);
		expect(calls).toHaveLength(1);
		expect(commandVector(calls[0])).toContain("chrome-devtools.list_pages");
	});

	test("target hint no-match emits refine-target recovery without selecting a page", async () => {
		const { runtime, calls } = operationRuntime();
		const result = await runForTest(
			["operate", "snapshot", "--title-contains", "Missing", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "browser_operation_target_no_match" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"refine_target_hint",
		);
		expect(calls).toHaveLength(1);
		expect(commandVector(calls[0])).toContain("chrome-devtools.list_pages");
	});

	test("selected target moved emits refresh target selection", async () => {
		const { runtime } = operationRuntime({
			files: {
				"/state.json": selectedStateFile({ target_candidate_id: "gone" }),
			},
		});
		const result = await runForTest(
			["operate", "snapshot", "--state", "/state.json", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "browser_operation_target_moved" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"refresh_target_selection",
		);
	});

	test("selected target does not rebind when the same ordinal now has a different page id", async () => {
		const { runtime, calls } = operationRuntime({
			files: { "/state.json": selectedStateFile() },
			pages: [{ id: "2", url: "https://example.com/app", title: "App" }],
		});
		const result = await runForTest(
			["operate", "snapshot", "--state", "/state.json", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_target_moved",
		});
		expect(calls).toHaveLength(1);
		expect(commandVector(calls[0])).toContain("chrome-devtools.list_pages");
	});

	test("a v1 (Router-era) selected state fails with target_state_mismatch, never operates", async () => {
		const { runtime, calls } = operationRuntime({
			files: {
				"/state.json": selectedStateFile({
					schema_version: "1",
					warm_chrome_run_id: "warm-1",
					adapter_proof_id: "proof-abc",
					route_evidence_hash: "hash-xyz",
				}),
			},
		});
		const result = await runForTest(
			["operate", "snapshot", "--state", "/state.json", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_mismatch",
		});
		expect(calls.filter((call) => commandVector(call).join(" ").includes("select_page"))).toHaveLength(0);
	});

	test("selected state bound to a different handoff fails with target_state_mismatch", async () => {
		const { runtime } = operationRuntime({
			files: {
				"/state.json": selectedStateFile({ handoff_evidence_id: "other-evidence" }),
			},
		});
		const result = await runForTest(
			["operate", "snapshot", "--state", "/state.json", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_mismatch",
		});
	});
});

describe("U7 operation success and transport", () => {
	test("snapshot emits normalized JSON for the selected Browser Target (AE7)", async () => {
		const { runtime, calls } = operationRuntime({
			files: { "/state.json": selectedStateFile() },
		});
		const result = await runForTest(
			["operate", "snapshot", "--state", "/state.json", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("ok");
		expect(json.data).toMatchObject({
			contract: BROWSER_USE_OPERATION_CONTRACT_ID,
			schema_version: BROWSER_USE_OPERATION_SCHEMA_VERSION,
			command: "operate-snapshot",
			result_kind: "browser_operation",
			operation: "snapshot",
			adapter: "chrome-devtools",
			target_source: "selected_state",
			binding: {
				run_id: FIXTURE_RUN_ID,
				handoff_evidence_id: FIXTURE_EVIDENCE_ID,
			},
		});
		expect((json.data as Record<string, any>).snapshot.text).toContain("Root");
		expect(commandVector(calls[1])).toContain("chrome-devtools.select_page");
		expect(commandVector(calls[2])).toContain("chrome-devtools.take_snapshot");
	});

	test("snapshot can operate against adapter page id 0", async () => {
		const { runtime, calls } = operationRuntime({
			files: {
				"/state.json": selectedStateFile({
					target_candidate_id: operationCandidateId("0"),
				}),
			},
			pages: [{ id: "0", url: "https://example.com/app", title: "App" }],
		});
		const result = await runForTest(
			["operate", "snapshot", "--state", "/state.json", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(commandJsonArgs(calls[1])).toMatchObject({ pageId: 0 });
	});

	test("snapshot --verbose passes verbose transport args", async () => {
		const { runtime, calls } = operationRuntime({
			files: { "/state.json": selectedStateFile() },
		});
		const result = await runForTest(
			["operate", "snapshot", "--verbose", "--state", "/state.json", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(commandJsonArgs(calls[2])).toEqual({ verbose: true });
	});

	test("screenshot writes an artifact path and keeps screenshot bytes out of JSON (AE9)", async () => {
		const { runtime, calls, ensuredDirectories } = operationRuntime({
			env: { BROWSER_USE_ARTIFACT_ROOT: "/tmp/browser-use-artifacts-test" },
			operationResult: okCommand(
				JSON.stringify({ content: [{ type: "image", data: "BASE64SECRET" }] }),
			),
		});
		const result = await runForTest(
			["operate", "screenshot", "--out", "shot.png", "--full-page", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.data).toMatchObject({
			operation: "screenshot",
			screenshot: {
				artifact: {
					path: "/tmp/browser-use-artifacts-test/shot.png",
					relative_path: "shot.png",
					root: "/tmp/browser-use-artifacts-test",
					format: "png",
					full_page: true,
				},
			},
		});
		expect(result.stdout).not.toContain("BASE64SECRET");
		expect(ensuredDirectories).toEqual(["/tmp/browser-use-artifacts-test"]);
		expect(commandVector(calls[2])).toContain("chrome-devtools.take_screenshot");
		expect(commandJsonArgs(calls[2])).toMatchObject({
			filePath: "/tmp/browser-use-artifacts-test/shot.png",
		});
	});

	test("emulate emits normalized viewport facts without exposing adapter method names (AE12)", async () => {
		const { runtime } = operationRuntime();
		const result = await runForTest(
			["operate", "emulate", "--width", "390", "--height", "844", "--dpr", "3", "--mobile", "--touch", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.data).toMatchObject({
			operation: "emulate",
			emulation: {
				viewport: {
					width: 390,
					height: 844,
					device_scale_factor: 3,
					mobile: true,
					touch: true,
					landscape: false,
				},
			},
		});
		expect(result.stdout).not.toContain("chrome-devtools.emulate");
	});

	test("operation transport timeout maps to browser_operation_transport_timeout", async () => {
		const { runtime } = operationRuntime({
			operationResult: { exitCode: 1, stdout: "", stderr: "", timedOut: true },
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({
			code: "browser_operation_transport_timeout",
		});
		expect(json.data).toMatchObject({
			side_effects: { focus: true },
		});
	});

	test("command-vector override prefixes the live operate calls (AE10)", async () => {
		const { runtime, calls } = operationRuntime({
			env: { BROWSER_USE_MCPORTER_COMMAND_JSON: '["bunx","mcporter"]' },
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(commandVector(calls[0]).slice(0, 2)).toEqual(["bunx", "mcporter"]);
		expect(commandVector(calls[2]).slice(0, 2)).toEqual(["bunx", "mcporter"]);
	});

	test("the envelope's websocket debugger URL never appears in operation output", async () => {
		const { runtime } = operationRuntime();
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).not.toContain("ws://");
		expect(result.stdout).not.toContain("devtools/browser");
	});
});
