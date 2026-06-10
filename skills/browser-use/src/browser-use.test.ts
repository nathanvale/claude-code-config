import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_OPERATION_CONTRACT_ID,
	BROWSER_USE_OPERATION_SCHEMA_VERSION,
	BROWSER_USE_TARGETS_CONTRACT_ID,
	BROWSER_USE_TARGETS_SCHEMA_VERSION,
	type BrowserUseCommand,
	browserUseContracts,
	browserUseOperationFailureActions,
	browserUseOperationSuccessActions,
	browserUseTargetDiscoveryFailureActions,
	browserUseTargetSelectionFailureActions,
} from "./command-contract";
import { type BrowserUseRuntime, runForTest } from "./browser-use";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";
import {
	adapterProofEnvelope,
	commandJsonArgs,
	commandVector,
	contractFlags,
	enoent,
	listPagesStdout,
	makeRuntime,
	okCommand,
	parseJson,
	routeSuccessEnvelope,
	TARGETS_CONTRACT,
} from "./browser-use-test-helpers";

const ALL_COMMANDS: BrowserUseCommand[] = [
	"targets-list",
	"targets-select",
	"targets-status",
	"operate-snapshot",
	"operate-screenshot",
	"operate-emulate",
];

function discoveryTree() {
	return projectCommandDiscoveryTree(
		Object.entries(browserUseContracts) as Array<
			[BrowserUseCommand, (typeof browserUseContracts)[BrowserUseCommand]]
		>,
	);
}

// =========================================================================
// Command contract / discovery
// =========================================================================

describe("U3 command contract", () => {
	test("contract parses and exposes the targets and operate families", () => {
		const result = parseCommandFacadeContract(browserUseContracts, {
			path: "skills/browser-use/src/command-contract.ts",
		});
		expect(result.ok).toBe(true);
		expect(Object.keys(browserUseContracts).sort()).toEqual([...ALL_COMMANDS].sort());
	});

	test("a runtime action id shared across discovery and selection has one summary", () => {
		// rerun_route_bound_target_discovery is declared in both action arrays. The
		// two surfaces build separate Maps, so nothing fails at runtime if they
		// drift — guard here that one continuation id never documents two different
		// recovery strings.
		const discovery = new Map<string, string>(
			browserUseTargetDiscoveryFailureActions.map((a) => [a.id, a.summary]),
		);
		for (const action of browserUseTargetSelectionFailureActions) {
			const shared = discovery.get(action.id);
			if (shared !== undefined) {
				expect(action.summary as string).toBe(shared);
			}
		}
	});

	test("no command declares a facade-reserved diagnostic flag", () => {
		for (const command of ALL_COMMANDS) {
			const flags = Object.keys(browserUseContracts[command].flags ?? {});
			for (const reserved of CLI_DIAGNOSTIC_FLAGS) {
				expect(flags).not.toContain(reserved);
			}
		}
	});

	test("subcommands expose only their declared flags", () => {
		expect(contractFlags("targets-status")).toEqual([
			"--json",
			"--plain",
			"--state",
		]);
		expect(contractFlags("operate-screenshot")).toContain("--out");
		expect(contractFlags("operate-emulate")).toContain("--width");
	});

	// Scenario 5: command discovery exposes both result contracts with versions.
	test("command discovery exposes browser-targets and browser-operation result contracts with versions", () => {
		const tree = discoveryTree();
		for (const command of ["targets-list", "targets-select", "targets-status"] as const) {
			expect(tree.commands[command]?.result_contract).toMatchObject({
				id: BROWSER_USE_TARGETS_CONTRACT_ID,
				schema_version: BROWSER_USE_TARGETS_SCHEMA_VERSION,
			});
		}
		for (const command of ["operate-snapshot", "operate-screenshot", "operate-emulate"] as const) {
			expect(tree.commands[command]?.result_contract).toMatchObject({
				id: BROWSER_USE_OPERATION_CONTRACT_ID,
				schema_version: BROWSER_USE_OPERATION_SCHEMA_VERSION,
			});
		}
		expect(BROWSER_USE_TARGETS_CONTRACT_ID).toBe("browser-use.browser-targets");
		expect(BROWSER_USE_OPERATION_CONTRACT_ID).toBe("browser-use.browser-operation");
	});

	test("operate command discovery exposes runtime action affordances", () => {
		const tree = discoveryTree();
		for (const command of ["operate-snapshot", "operate-screenshot", "operate-emulate"] as const) {
			const affordances = tree.commands[command]?.action_affordances;
			expect(affordances?.success?.map((a) => a.id)).toEqual(
				browserUseOperationSuccessActions.map((a) => a.id),
			);
			expect(affordances?.failure?.map((a) => a.id)).toEqual(
				browserUseOperationFailureActions.map((a) => a.id),
			);
		}
	});
});

// =========================================================================
// U7 Browser Operation Front Door
// =========================================================================

function operationTargetEnvelopeId(input: {
	runId?: string;
	adapter?: string;
	adapterProofId?: string;
	routeEvidenceHash?: string;
} = {}): string {
	const canonical = JSON.stringify([
		input.runId ?? "route-run",
		"route-bound",
		input.adapter ?? "chrome-devtools",
		input.adapterProofId ?? "proof-abc",
		input.routeEvidenceHash ?? "hash-xyz",
	]);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

function operationCandidateId(pageId = "1"): string {
	const canonical = JSON.stringify([
		operationTargetEnvelopeId(),
		["adapter_page_id", pageId],
	]);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

function selectedStateFile(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		contract: TARGETS_CONTRACT,
		schema_version: "1",
		run_id: "route-run",
		selected_adapter_id: "chrome-devtools",
		warm_chrome_run_id: "warm-1",
		adapter_proof_id: "proof-abc",
		verified_endpoint_identity: "127.0.0.1:9222",
		route_evidence_hash: "hash-xyz",
		target_envelope_id: operationTargetEnvelopeId(),
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
		"/route.json": routeSuccessEnvelope(),
		"/proof.json": adapterProofEnvelope(),
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
	test("route success plus mismatched Adapter Proof fails before transport (AE4)", async () => {
		const { runtime, calls } = operationRuntime({
			files: {
				"/proof.json": adapterProofEnvelope({ adapter_proof_id: "proof-other" }),
			},
		});
		const result = await runForTest(
			["operate", "snapshot", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_adapter_proof_mismatch",
		});
		expect(calls).toHaveLength(0);
	});

	test("screenshot requires --out before transport", async () => {
		const { runtime, calls } = operationRuntime({
			files: {
				"/route.json": routeSuccessEnvelope({
					authorized_capabilities: ["screenshot_media"],
				}),
			},
		});
		const result = await runForTest(
			["operate", "screenshot", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_artifact_path_required",
		});
		expect(calls).toHaveLength(0);
	});

	test("screenshot rejects unsafe artifact paths before transport", async () => {
		const { runtime, calls } = operationRuntime({
			files: {
				"/route.json": routeSuccessEnvelope({
					authorized_capabilities: ["screenshot_media"],
				}),
			},
		});
		const result = await runForTest(
			[
				"operate",
				"screenshot",
				"--out",
				"../shot.png",
				"--route",
				"/route.json",
				"--adapter-proof",
				"/proof.json",
				"--json",
			],
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
			const { runtime, calls } = operationRuntime({
				files: {
					"/route.json": routeSuccessEnvelope({
						authorized_capabilities: ["screenshot_media"],
					}),
				},
			});
			const result = await runForTest(
				[
					"operate",
					"screenshot",
					"--out",
					out,
					"--route",
					"/route.json",
					"--adapter-proof",
					"/proof.json",
					"--json",
				],
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
			files: {
				"/route.json": routeSuccessEnvelope({
					authorized_capabilities: ["screenshot_media"],
				}),
			},
		});
		const result = await runForTest(
			[
				"operate",
				"screenshot",
				"--out",
				"shot.png",
				"--route",
				"/route.json",
				"--adapter-proof",
				"/proof.json",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_artifact_path_unsafe",
		});
		expect(calls).toHaveLength(0);
	});

	test("emulate rejects malformed viewport input before transport", async () => {
		const { runtime, calls } = operationRuntime({
			files: {
				"/route.json": routeSuccessEnvelope({
					authorized_capabilities: ["viewport_emulation"],
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
				"0",
				"--route",
				"/route.json",
				"--adapter-proof",
				"/proof.json",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_viewport_invalid",
		});
		expect(calls).toHaveLength(0);
	});

	test("emulate requires viewport emulation capability before transport", async () => {
		const { runtime, calls } = operationRuntime();
		const result = await runForTest(
			["operate", "emulate", "--width", "390", "--height", "844", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_capability_unauthorized",
		});
		expect(calls).toHaveLength(0);
	});

	test("expired route evidence fails before adapter transport", async () => {
		const { runtime, calls } = operationRuntime({
			files: {
				"/route.json": routeSuccessEnvelope({
					expires_at: "1970-01-01T00:00:01.000Z",
				}),
			},
			now: () => 2_000,
		});
		const result = await runForTest(
			[
				"operate",
				"snapshot",
				"--route",
				"/route.json",
				"--adapter-proof",
				"/proof.json",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_route_invalid",
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
			["operate", "snapshot", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
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
			[
				"operate",
				"snapshot",
				"--title-contains",
				"Missing",
				"--route",
				"/route.json",
				"--adapter-proof",
				"/proof.json",
				"--json",
			],
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
			["operate", "snapshot", "--state", "/state.json", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
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
			["operate", "snapshot", "--state", "/state.json", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "browser_operation_target_moved",
		});
		expect(calls).toHaveLength(1);
		expect(commandVector(calls[0])).toContain("chrome-devtools.list_pages");
	});
});

describe("U7 operation success and transport", () => {
	test("snapshot emits normalized JSON for the selected Browser Target (AE7)", async () => {
		const { runtime, calls } = operationRuntime({
			files: { "/state.json": selectedStateFile() },
		});
		const result = await runForTest(
			["operate", "snapshot", "--state", "/state.json", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
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
			["operate", "snapshot", "--state", "/state.json", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
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
			["operate", "snapshot", "--verbose", "--state", "/state.json", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(commandJsonArgs(calls[2])).toEqual({ verbose: true });
	});

	test("screenshot writes an artifact path and keeps screenshot bytes out of JSON (AE9)", async () => {
		const { runtime, calls, ensuredDirectories } = operationRuntime({
			env: { BROWSER_USE_ARTIFACT_ROOT: "/tmp/browser-use-artifacts-test" },
			files: {
				"/route.json": routeSuccessEnvelope({
					authorized_capabilities: ["screenshot_media"],
				}),
			},
			operationResult: okCommand(
				JSON.stringify({ content: [{ type: "image", data: "BASE64SECRET" }] }),
			),
		});
		const result = await runForTest(
			["operate", "screenshot", "--out", "shot.png", "--full-page", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
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
		const { runtime } = operationRuntime({
			files: {
				"/route.json": routeSuccessEnvelope({
					authorized_capabilities: ["viewport_emulation"],
				}),
			},
		});
		const result = await runForTest(
			["operate", "emulate", "--width", "390", "--height", "844", "--dpr", "3", "--mobile", "--touch", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
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
			["operate", "snapshot", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
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
			["operate", "snapshot", "--route", "/route.json", "--adapter-proof", "/proof.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(commandVector(calls[0]).slice(0, 2)).toEqual(["bunx", "mcporter"]);
		expect(commandVector(calls[2]).slice(0, 2)).toEqual(["bunx", "mcporter"]);
	});
});
