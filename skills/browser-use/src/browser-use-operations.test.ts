import { afterAll, describe, expect, test } from "bun:test";
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
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import { openBrowserUsePaths } from "./browser-use-paths";
import {
	acquireBrowserLaneLease,
	acquireTargetOperationLease,
	browserAuthorityIdOf,
	releaseBrowserLaneLease,
	releaseRunTargetOwnership,
	releaseTargetOperationLease,
} from "./browser-use-browser-custody";

// =========================================================================
// U7 Browser Operation Front Door (envelope-era contract from migration U1)
// =========================================================================

const FIXTURE_ENVELOPE = JSON.parse(REAL_VERIFIED_HANDOFF_ENVELOPE);
const FIXTURE_RUN_ID = FIXTURE_ENVELOPE.run_id as string;
const FIXTURE_EVIDENCE_ID = handoffEvidenceIdOf({
	runId: FIXTURE_ENVELOPE.run_id,
	environmentName: FIXTURE_ENVELOPE.data.environment.name,
	environmentProfile: FIXTURE_ENVELOPE.data.environment.profile,
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
	adapter: "chrome-devtools-mcp",
	handoffEvidenceId: FIXTURE_EVIDENCE_ID,
});

const operationXdgCleanups: Array<() => void> = [];
afterAll(() => {
	for (const cleanup of operationXdgCleanups) cleanup();
});

function operationCandidateId(pageId = "1"): string {
	return candidateIdOf(FIXTURE_TARGET_ENVELOPE_ID, ["adapter_page_id", pageId]);
}

const FIXTURE_BROWSER_AUTHORITY = browserAuthorityIdOf({
	environmentName: FIXTURE_ENVELOPE.data.environment.name,
	environmentProfile: FIXTURE_ENVELOPE.data.environment.profile,
	endpointHttp: FIXTURE_ENVELOPE.data.endpoint.http,
	endpointWs: FIXTURE_ENVELOPE.data.endpoint.ws,
});

async function custodyDeps(runtime: BrowserUseRuntime) {
	const opened = await openBrowserUsePaths(runtime.platformFs, runtime.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return {
		fs: runtime.platformFs,
		paths: opened.paths,
		clock: runtime.now,
	};
}

function selectedStateFile(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		contract: TARGETS_CONTRACT,
		schema_version: "2",
		run_id: FIXTURE_RUN_ID,
		selected_adapter_id: "chrome-devtools-mcp",
		verified_endpoint_identity: "127.0.0.1:9222",
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
	pages?: Array<{
		id?: string;
		targetId?: string;
		url?: string;
		title?: string;
	}>;
	adapter?: "agent-browser" | "chrome-devtools-mcp";
	env?: Record<string, string | undefined>;
	operationResult?: McporterCommandResult;
	nativeResults?: McporterCommandResult[];
	releaseResults?: McporterCommandResult[];
	now?: () => number;
} = {}): {
	runtime: BrowserUseRuntime;
	calls: McporterCommandInput[];
	ensuredDirectories: string[];
} {
	const calls: McporterCommandInput[] = [];
	const ensuredDirectories: string[] = [];
	const nativeResults = [...(input.nativeResults ?? [])];
	const releaseResults = [...(input.releaseResults ?? [])];
	const files: Record<string, string> = {
		"/h.json":
			input.adapter === "agent-browser"
				? verifiedHandoffEnvelope((envelope) => {
						envelope.data.attachment.adapter_id = "agent-browser";
					})
				: REAL_VERIFIED_HANDOFF_ENVELOPE,
		...(input.files ?? {}),
	};
	const pages = input.pages ?? [
		{ id: "1", url: "https://example.com/app", title: "App" },
	];
	const xdg = makeTempXdgEnv();
	operationXdgCleanups.push(xdg.dispose);
	const runtime = makeRuntime({
		env: { ...xdg.env, ...(input.env ?? {}) },
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
			const vector = commandVector(call);
			if (call.args.includes("close")) {
				return (
					releaseResults.shift() ??
					okCommand(JSON.stringify({ success: true }))
				);
			}
			if (call.args[0] === "session") {
				return okCommand(
					JSON.stringify({ success: true, data: { sessions: [] } }),
				);
			}
			if (vector.includes("tab") && vector.includes("list")) {
				return okCommand(
					JSON.stringify({
						success: true,
						data: {
							tabs: pages.map((page) => ({
								tabId: page.id,
								targetId:
									page.targetId ?? `cdp-target-${page.id ?? "unknown"}`,
								url: page.url,
								title: page.title,
							})),
						},
					}),
				);
			}
			if (vector.includes("get") && vector.includes("url")) {
				return okCommand(
					JSON.stringify({
						success: true,
						data: { url: pages[0]?.url ?? "https://example.com/app" },
					}),
				);
			}
			if (input.adapter === "agent-browser" && nativeResults.length > 0) {
				const nativeResult = nativeResults.shift();
				if (nativeResult) return nativeResult;
			}
			// The envelope-derived argv names the tool via --tool (U3); route the
			// fake on that token, mirroring the real ad-hoc invocation shape.
			const toolIndex = call.args.indexOf("--tool");
			const tool = toolIndex >= 0 ? call.args[toolIndex + 1] : undefined;
			if (tool === "list_pages") {
				return okCommand(listPagesStdout(pages));
			}
			if (tool === "select_page") return okCommand("{}");
			return (
				input.operationResult ??
				okCommand(JSON.stringify({ content: [{ type: "text", text: "Root\nButton" }] }))
			);
		},
	});
	return { runtime, calls, ensuredDirectories };
}

describe("U7 operation gates", () => {
	test("a foreign Target Lease refuses a chrome snapshot before operation dispatch", async () => {
		const { runtime, calls } = operationRuntime();
		const deps = await custodyDeps(runtime);
		const held = await acquireTargetOperationLease(deps, {
			authorityId: FIXTURE_BROWSER_AUTHORITY,
			runId: "other-run",
			adapterId: "agent-browser",
			rawTargetId: "cdp-target-test",
			operation: "read",
			ttlMs: 30_000,
			ownershipEvidence: {
				kind: "adapter-creation-receipt",
				adapter_id: "agent-browser",
				run_id: "other-run",
				raw_target_id: "cdp-target-test",
			},
		});
		if (!held.ok) throw new Error("fixture target lease failed");
		await releaseTargetOperationLease(deps, held.lease);
		try {
			const result = await runForTest(
				["operate", "snapshot", "--handoff", "/h.json", "--json"],
				runtime,
			);
			expect(result.exitCode).toBe(20);
			expect(parseJson(result.stdout).error).toMatchObject({
				code: "target_owned_by_other_run",
			});
			expect(
				calls.some((call) => call.args.includes("take_snapshot")),
			).toBe(false);
		} finally {
			await releaseRunTargetOwnership(deps, "other-run");
		}
	});

	test("a held Browser Lane refuses screenshot capture before dispatch", async () => {
		const { runtime, calls } = operationRuntime({ adapter: "agent-browser" });
		const deps = await custodyDeps(runtime);
		const held = await acquireBrowserLaneLease(deps, {
			authorityId: FIXTURE_BROWSER_AUTHORITY,
			runId: "other-run",
			mutation: "domain-policy",
			ttlMs: 30_000,
		});
		if (!held.ok) throw new Error("fixture Browser Lane failed");
		try {
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
				code: "browser_lane_held",
			});
			expect(calls.some((call) => call.args.includes("screenshot"))).toBe(false);
		} finally {
			await releaseBrowserLaneLease(deps, held.lease);
		}
	});

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
		// playwright-cdp maps to a browser-use adapter with an EMPTY authorized
		// capability set (no operation transport yet): every operation class is
		// refused through the surviving router engine. (agent-browser now
		// authorizes snapshot_refs/element_actions post-U3, so it no longer models
		// the empty-capability case.)
		const { runtime, calls } = operationRuntime({
			files: {
				"/h.json": verifiedHandoffEnvelope((envelope) => {
					envelope.data.attachment.adapter_id = "playwright-cdp";
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

	test("agent-browser screenshot dispatches through screenshot_media", async () => {
		const { runtime, calls } = operationRuntime({
			adapter: "agent-browser",
			nativeResults: [
				okCommand(JSON.stringify({ success: true, data: { selected: true } })),
				okCommand(JSON.stringify({ success: true, data: { path: "shot.png" } })),
			],
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
		expect(result.exitCode, result.stdout).toBe(0);
		expect(calls.some((call) => call.args.includes("screenshot"))).toBe(true);
		expect(
			calls.some((call) =>
				call.args.some((argument) => argument.endsWith("shot.png")),
			),
		).toBe(true);
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
		expect(commandVector(calls[0])).toContain("list_pages");
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
		expect(commandVector(calls[0])).toContain("list_pages");
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
		expect(commandVector(calls[0])).toContain("list_pages");
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
	test("agent-browser releases its owned session after a successful operation", async () => {
		const { runtime, calls } = operationRuntime({
			adapter: "agent-browser",
			pages: [{ id: "t1", url: "https://example.com/app", title: "App" }],
			nativeResults: [
				okCommand(JSON.stringify({ success: true, data: {} })),
				okCommand(JSON.stringify({ success: true, data: "Root\nButton" })),
			],
		});

		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		const closeCalls = calls.filter((call) => call.args.includes("close"));

		expect(result.exitCode).toBe(0);
		// Discovery owns the first release; the operation lane owns the second.
		expect(closeCalls).toHaveLength(2);
		const operationCloseCall = closeCalls[1];
		if (!operationCloseCall) throw new Error("missing operation release call");
		expect(commandVector(operationCloseCall)).toEqual([
			FIXTURE_ENVELOPE.data.attachment.probe_executable,
			"--session",
			`browser-use-${FIXTURE_RUN_ID}`,
			"close",
			"--json",
		]);
		expect(commandVector(operationCloseCall)).not.toContain("--cdp");
	});

	test("agent-browser releases its owned session after a typed operation failure", async () => {
		const { runtime, calls } = operationRuntime({
			adapter: "agent-browser",
			pages: [{ id: "t1", url: "https://example.com/app", title: "App" }],
			nativeResults: [
				okCommand(
					JSON.stringify({ success: false, error: "tab t1 unavailable" }),
				),
			],
		});

		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		const closeCalls = calls.filter((call) => call.args.includes("close"));

		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_transport_failed",
		});
		// Discovery owns the first release; the failed operation owns the second.
		expect(closeCalls).toHaveLength(2);
		const operationCloseCall = closeCalls[1];
		if (!operationCloseCall) throw new Error("missing operation release call");
		expect(commandVector(operationCloseCall)).not.toContain("--cdp");
	});

	test("blocks successful operation truth when terminal release fails", async () => {
		const { runtime } = operationRuntime({
			adapter: "agent-browser",
			pages: [{ id: "t1", url: "https://example.com/app", title: "App" }],
			nativeResults: [
				okCommand(JSON.stringify({ success: true, data: {} })),
				okCommand(JSON.stringify({ success: true, data: "Root\nButton" })),
			],
			releaseResults: [
				okCommand(JSON.stringify({ success: true })),
				{ exitCode: 7, stdout: "", stderr: "close failed", timedOut: false },
			],
		});

		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "browser_operation_transport_failed" },
			data: { release: { released: false, cause: "command-failed" } },
		});
	});

	test("a discovered agent-browser t1 tab survives target resolution and executes", async () => {
		const { runtime, calls } = operationRuntime({
			adapter: "agent-browser",
			pages: [{ id: "t1", url: "https://example.com/app", title: "App" }],
			nativeResults: [
				okCommand(JSON.stringify({ success: true, data: {} })),
				// Real adapter snapshot payload shape: {snapshot, refs}. The lane
				// unwraps data.snapshot and discards refs (opaque-ref contract).
				okCommand(
					JSON.stringify({
						success: true,
						data: { snapshot: "Root\nButton", refs: {} },
					}),
				),
			],
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		const json = parseJson(result.stdout);
		expect(
			calls.some((call) => {
				const vector = commandVector(call);
				return vector.includes("tab") && vector.includes("list");
			}),
		).toBe(true);
		expect((json.error as { code?: string } | undefined)?.code).not.toBe(
			"browser_operation_target_missing",
		);
		expect(result.exitCode).toBe(0);
		expect(json.data).toMatchObject({
			adapter: "agent-browser",
			snapshot: { text: "Root\nButton" },
			// Native tab activation always carries the window-focus side effect,
			// so successful agent-browser operates report focus even without
			// --bring-to-front.
			side_effects: { focus: true },
		});
		const operationCalls = calls.filter(
			(call) =>
				call.args.includes("--cdp") &&
				!call.args.includes("list") &&
				!call.args.includes("close"),
		);
		expect(operationCalls.map(commandVector)).toEqual([
			[
				FIXTURE_ENVELOPE.data.attachment.probe_executable,
				"--cdp",
				FIXTURE_ENVELOPE.data.endpoint.ws,
				"--session",
				`browser-use-${FIXTURE_RUN_ID}`,
				"tab",
				"cdp-target-t1",
				"--json",
			],
			[
				FIXTURE_ENVELOPE.data.attachment.probe_executable,
				"--cdp",
				FIXTURE_ENVELOPE.data.endpoint.ws,
				"--session",
				`browser-use-${FIXTURE_RUN_ID}`,
				"--pin-tab",
				"get",
				"url",
				"--json",
			],
			[
				FIXTURE_ENVELOPE.data.attachment.probe_executable,
				"--cdp",
				FIXTURE_ENVELOPE.data.endpoint.ws,
				"--session",
				`browser-use-${FIXTURE_RUN_ID}`,
				"--pin-tab",
				"snapshot",
				"--json",
			],
		]);
		expect(operationCalls[0]?.timeoutMs).toBe(30_000);
		expect(operationCalls[1]?.timeoutMs).toBe(30_000);
		expect([result.stdout, result.stderr].join("\n")).not.toContain("t1");
		expect(calls.some((call) => call.command === "mcporter")).toBe(false);
	});

	test("agent-browser snapshot accepts plain string data", async () => {
		const { runtime } = operationRuntime({
			adapter: "agent-browser",
			nativeResults: [
				okCommand(JSON.stringify({ success: true, data: {} })),
				okCommand(
					JSON.stringify({ success: true, data: "Root\nButton" }),
				),
			],
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout).data).toMatchObject({
			snapshot: { text: "Root\nButton" },
		});
	});

	test("agent-browser rejects an unsafe native tab ref before operation spawn", async () => {
		const { runtime, calls } = operationRuntime({
			adapter: "agent-browser",
			pages: [{ id: "bad tab", url: "https://example.com/app", title: "App" }],
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_transport_failed",
		});
		// Discovery lists, closes, and verifies; the unsafe ref prevents any
		// operation spawn after that terminal discovery seam.
		expect(calls).toHaveLength(3);
		expect(result.stdout).not.toContain("bad tab");
		expect(result.stderr).not.toContain("bad tab");
	});

	test("agent-browser maps failure envelopes and timeouts without retry or ref disclosure (AE2)", async () => {
		for (const operationResult of [
			okCommand(JSON.stringify({ success: false, error: "tab t1 unavailable" })),
			{ exitCode: 1, stdout: "", stderr: "", timedOut: true },
		]) {
			const { runtime, calls } = operationRuntime({
				adapter: "agent-browser",
				pages: [{ id: "t1", url: "https://example.com/app", title: "App" }],
				nativeResults: [operationResult],
			});
			const result = await runForTest(
				["operate", "snapshot", "--handoff", "/h.json", "--json"],
				runtime,
			);
			expect(result.exitCode).toBe(20);
			expect(parseJson(result.stdout).error).toMatchObject({
				code: operationResult.timedOut
					? "browser_operation_transport_timeout"
					: "browser_operation_transport_failed",
			});
			// Discovery list + release verification, failed activation, then the
			// operation lane's terminal release verification.
			expect(calls).toHaveLength(6);
			expect([result.stdout, result.stderr].join("\n")).not.toContain("t1");
			expect(calls.some((call) => call.command === "mcporter")).toBe(false);
		}
	});

	test("agent-browser snapshot-step failures after activation map fail-closed with the focus side effect", async () => {
		// Activation succeeded (window focus already happened), then the snapshot
		// step fails three ways: adapter failure envelope, unparsable stdout, and
		// a success envelope whose data is not a string and has no string
		// `snapshot` field (opaque-ref unwrap contract).
		for (const { snapshotResult, message } of [
			{
				snapshotResult: okCommand(
					JSON.stringify({ success: false, error: "tab t1 unavailable" }),
				),
			},
			{
				snapshotResult: {
					exitCode: 0,
					stdout: "not-json",
					stderr: "",
					timedOut: false,
				},
			},
			{
				snapshotResult: okCommand(
					JSON.stringify({ success: true, data: { refs: {} } }),
				),
				message:
					"The agent-browser snapshot call returned an unexpected payload shape.",
			},
		]) {
			const { runtime, calls } = operationRuntime({
				adapter: "agent-browser",
				pages: [{ id: "t1", url: "https://example.com/app", title: "App" }],
				nativeResults: [
					okCommand(JSON.stringify({ success: true, data: {} })),
					snapshotResult,
				],
			});
			const result = await runForTest(
				["operate", "snapshot", "--handoff", "/h.json", "--json"],
				runtime,
			);
			expect(result.exitCode).toBe(20);
			const json = parseJson(result.stdout);
			expect(json.error).toMatchObject({
				code: "browser_operation_transport_failed",
				...(message ? { message } : {}),
			});
			// Discovery list + release, activation + strict proof + snapshot, then operation release.
			expect(calls).toHaveLength(8);
			// Activation succeeded, so the failure envelope truthfully reports the
			// window-focus side effect.
			expect(json.data).toMatchObject({ side_effects: { focus: true } });
			expect([result.stdout, result.stderr].join("\n")).not.toContain("t1");
		}
	});

	test("agent-browser discovery release failure stops before custody or operation spawn", async () => {
		// Discovery (tab list) works; every subsequent native spawn throws, as a
		// missing agent-browser binary would. The lane maps the thrown spawn to
		// browser_operation_dependency_missing instead of leaking the throw.
		const calls: McporterCommandInput[] = [];
		const xdg = makeTempXdgEnv();
		operationXdgCleanups.push(xdg.dispose);
		const runtime = makeRuntime({
			env: xdg.env,
			now: () => 2_000,
			readTextFile: async (path) => {
				if (path === "/h.json") {
					return verifiedHandoffEnvelope((envelope) => {
						envelope.data.attachment.adapter_id = "agent-browser";
					});
				}
				throw enoent(path);
			},
			runCommand: async (call) => {
				calls.push(call);
				const vector = commandVector(call);
			if (vector.includes("tab") && vector.includes("list")) {
					return okCommand(
						JSON.stringify({
							success: true,
							data: {
								tabs: [
									{
										tabId: "t1",
										targetId: "cdp-target-t1",
										url: "https://example.com/app",
										title: "App",
									},
								],
							},
						}),
					);
			}
				throw new Error("spawn agent-browser ENOENT");
			},
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_transport_failed",
		});
		// Discovery list + its failed exact release. No custody or operation call.
		expect(calls).toHaveLength(2);
		expect(calls.some((call) => call.args.includes("cdp-target-t1"))).toBe(false);
		expect([result.stdout, result.stderr].join("\n")).not.toContain("t1");
	});

	test("a malformed chrome page ref fails as a lane-honest transport failure", async () => {
		const { runtime, calls } = operationRuntime({
			pages: [{ id: "t1", url: "https://example.com/app", title: "App" }],
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_transport_failed",
			message:
				"The chrome-devtools-mcp page ref must be a non-negative integer.",
		});
		expect(calls).toHaveLength(1);
	});

	test("a discovered page without a handle retains target-missing recovery", async () => {
		const { runtime, calls } = operationRuntime({
			pages: [{ url: "https://example.com/app", title: "App" }],
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "browser_operation_target_missing" },
			continuation: {
				next_action_id: "rerun_handoff_bound_target_discovery",
			},
		});
		expect(calls).toHaveLength(1);
	});

	test("a discovered page with an empty-string id retains target-missing recovery", async () => {
		// An empty id is not a usable adapter page handle: same fail-closed
		// target-missing mapping as a page with no id at all, before any
		// operation transport.
		const { runtime, calls } = operationRuntime({
			pages: [{ id: "", url: "https://example.com/app", title: "App" }],
		});
		const result = await runForTest(
			["operate", "snapshot", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "browser_operation_target_missing" },
			continuation: {
				next_action_id: "rerun_handoff_bound_target_discovery",
			},
		});
		expect(calls).toHaveLength(1);
		expect(commandVector(calls[0])).toContain("list_pages");
	});

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
			adapter: "chrome-devtools-mcp",
			target_source: "selected_state",
			binding: {
				run_id: FIXTURE_RUN_ID,
				handoff_evidence_id: FIXTURE_EVIDENCE_ID,
			},
			side_effects: { focus: false },
		});
		expect((json.data as Record<string, any>).snapshot.text).toContain("Root");
		// Default operate path (U3): list_pages then the operation — no
		// select_page call. Page routing rides the args pageId through
		// --experimentalPageIdRouting; process-local selection state in a fresh
		// adapter spawn is meaningless.
		expect(calls).toHaveLength(2);
		expect(
			calls.filter((call) => commandVector(call).includes("select_page")),
		).toHaveLength(0);
		const snapshotVector = commandVector(calls[1]);
		expect(snapshotVector).toContain("take_snapshot");
		// R1/R2: the server portion is envelope-derived — pinned binary and
		// endpoint.http verbatim — with the keep-alive env guard on the spawn.
		expect(snapshotVector).toContain(
			FIXTURE_ENVELOPE.data.attachment.probe_executable,
		);
		expect(snapshotVector).toContain(FIXTURE_ENVELOPE.data.endpoint.http);
		expect(calls[1].env).toEqual({ MCPORTER_NO_KEEPALIVE: "*" });
		expect(commandJsonArgs(calls[1])).toEqual({ pageId: 1 });
	});

	test("--bring-to-front issues an explicit select_page focus call before the operation", async () => {
		// --bring-to-front keeps its contract meaning (explicit focus side
		// effect): an explicit select_page {pageId, bringToFront:true} rides the
		// same envelope-derived transport BEFORE the operation. Without the flag
		// no select_page call happens at all.
		const { runtime, calls } = operationRuntime({
			env: { BROWSER_USE_ARTIFACT_ROOT: "/tmp/browser-use-artifacts-test" },
		});
		const result = await runForTest(
			["operate", "screenshot", "--out", "shot.png", "--bring-to-front", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(calls).toHaveLength(3);
		expect(commandVector(calls[1])).toContain("select_page");
		expect(commandJsonArgs(calls[1])).toEqual({ pageId: 1, bringToFront: true });
		expect(calls[1].env).toEqual({ MCPORTER_NO_KEEPALIVE: "*" });
		expect(commandVector(calls[2])).toContain("take_screenshot");
		expect(parseJson(result.stdout).data).toMatchObject({
			side_effects: { focus: true },
		});
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
		// The operation itself carries pageId 0 (no select_page step).
		expect(commandVector(calls[1])).toContain("take_snapshot");
		expect(commandJsonArgs(calls[1])).toEqual({ pageId: 0 });
	});

	test("snapshot --verbose passes verbose transport args alongside the page routing", async () => {
		const { runtime, calls } = operationRuntime({
			files: { "/state.json": selectedStateFile() },
		});
		const result = await runForTest(
			["operate", "snapshot", "--verbose", "--state", "/state.json", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(commandJsonArgs(calls[1])).toEqual({ pageId: 1, verbose: true });
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
		expect(commandVector(calls[1])).toContain("take_screenshot");
		// filePath/fullPage survive alongside the pageId routing.
		expect(commandJsonArgs(calls[1])).toEqual({
			pageId: 1,
			filePath: "/tmp/browser-use-artifacts-test/shot.png",
			fullPage: true,
			format: "png",
		});
	});

	test("emulate emits normalized viewport facts without exposing adapter method names (AE12)", async () => {
		const { runtime, calls } = operationRuntime();
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
		// The emulate args carry the combined viewport string plus pageId routing.
		expect(commandJsonArgs(calls[1])).toEqual({
			pageId: 1,
			viewport: "390x844x3,mobile,touch",
		});
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
		// With the default select_page step deleted (U3), no focus side effect
		// occurs unless --bring-to-front was passed.
		expect(json.data).toMatchObject({
			side_effects: { focus: false },
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
		expect(commandVector(calls[1]).slice(0, 2)).toEqual(["bunx", "mcporter"]);
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
