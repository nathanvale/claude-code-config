import { describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import {
	BROWSER_USE_OPERATION_CONTRACT_ID,
	BROWSER_USE_OPERATION_SCHEMA_VERSION,
	BROWSER_USE_TARGETS_CONTRACT_ID,
	BROWSER_USE_TARGETS_SCHEMA_VERSION,
	type BrowserUseCommand,
	browserUseContracts,
	browserUseTargetDiscoveryFailureActions,
	browserUseTargetSelectionFailureActions,
} from "./command-contract";
import {
	type BrowserUseRuntime,
	type OperationResolutionInput,
	createDefaultBrowserUseRuntime,
	decodeStdinChunks,
	resolveOperationTarget,
	runBrowserUseMcporter,
	runForTest,
} from "./browser-use";
import {
	type McporterCommandInput,
	type McporterCommandResult,
	resolveMcporterCommandVector,
} from "./mcporter-transport";

function makeRuntime(overrides: Partial<BrowserUseRuntime> = {}): BrowserUseRuntime {
	return createDefaultBrowserUseRuntime({
		env: {},
		now: () => 1_000,
		// Stub the live I/O seams so tests never touch real stdin/disk. Individual
		// tests override readStdin/writeTextFile/readTextFile as needed.
		readStdin: async () => "",
		writeTextFile: async () => {},
		...overrides,
	});
}

// Capture the exact command vector the transport hands the runtime, so tests can
// assert how the override prefixes mcporter subcommands. okCommand stands in for
// a clean mcporter response.
function capturingRuntime(
	env: Record<string, string | undefined>,
	response: McporterCommandResult = okCommand("{}"),
): { runtime: BrowserUseRuntime; calls: McporterCommandInput[] } {
	const calls: McporterCommandInput[] = [];
	const runtime = makeRuntime({
		env,
		runCommand: async (input) => {
			calls.push(input);
			return response;
		},
	});
	return { runtime, calls };
}

function okCommand(stdout: string): McporterCommandResult {
	return { exitCode: 0, stdout, stderr: "" };
}

function commandVector(input: McporterCommandInput): string[] {
	return [input.command, ...input.args];
}

function parseJson(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout) as Record<string, unknown>;
}

const ALL_COMMANDS: BrowserUseCommand[] = [
	"targets-list",
	"targets-select",
	"targets-status",
	"operate-snapshot",
	"operate-screenshot",
	"operate-emulate",
];

function contractFlags(command: BrowserUseCommand): string[] {
	return Object.keys(browserUseContracts[command].flags ?? {}).sort();
}

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
			path: "skills/browser-use/scripts/command-contract.ts",
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
});

// =========================================================================
// Help + version
// =========================================================================

describe("U3 help and version", () => {
	// Scenario 1: root help renders both families.
	test("--help renders targets and operate families", async () => {
		const result = await runForTest(["--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("targets");
		expect(result.stdout).toContain("operate");
	});

	// Scenario 8: root help points back to the route-bound prerequisites.
	test("--help points back to browser-adapter-router prepare and route", async () => {
		const result = await runForTest(["--help"], makeRuntime());
		expect(result.stdout).toContain("browser-adapter-router prepare");
		expect(result.stdout).toContain("browser-adapter-router route");
		// Does not copy the route evidence schema, only a pointer.
		expect(result.stdout).not.toContain("preconditions");
		expect(result.stdout).not.toContain("adapter_proof_id");
	});

	// Scenario 2: version JSON parses with name and version.
	test("--version --json emits parseable JSON with name and version", async () => {
		const result = await runForTest(["--version", "--json"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(parseJson(result.stdout)).toMatchObject({
			status: "ok",
			data: { name: "browser-use", version: "0.1.0" },
		});
	});

	test("--version plain emits stable text", async () => {
		const result = await runForTest(["--version"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("browser-use 0.1.0\n");
	});

	// Scenario 3: targets family help renders list, select, status.
	test("targets --help renders list, select, and status", async () => {
		const result = await runForTest(["targets", "--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("list");
		expect(result.stdout).toContain("select");
		expect(result.stdout).toContain("status");
		expect(result.stdout).toContain("browser-adapter-router");
	});

	// Scenario 4: operate family help renders snapshot, screenshot, emulate.
	test("operate --help renders snapshot, screenshot, and emulate", async () => {
		const result = await runForTest(["operate", "--help"], makeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("snapshot");
		expect(result.stdout).toContain("screenshot");
		expect(result.stdout).toContain("emulate");
		expect(result.stdout).toContain("browser-adapter-router");
	});

	test("subcommand help advertises every declared flag and the route pointer", async () => {
		const cases: Array<[string[], BrowserUseCommand]> = [
			[["targets", "list", "--help"], "targets-list"],
			[["targets", "select", "--help"], "targets-select"],
			[["targets", "status", "--help"], "targets-status"],
			[["operate", "snapshot", "--help"], "operate-snapshot"],
			[["operate", "screenshot", "--help"], "operate-screenshot"],
			[["operate", "emulate", "--help"], "operate-emulate"],
		];
		for (const [argv, command] of cases) {
			const result = await runForTest(argv, makeRuntime());
			expect(result.exitCode).toBe(0);
			assertCommandHelpFlagSurface({
				command,
				contract: browserUseContracts[command],
				help: result.stdout,
			});
			expect(result.stdout).toContain("browser-adapter-router");
		}
	});
});

// =========================================================================
// Parser acceptance / rejection
// =========================================================================

describe("U3 parser", () => {
	test("missing family is a usage error", async () => {
		const result = await runForTest([], makeRuntime());
		expect(result.exitCode).toBe(2);
		expect(`${result.stdout}\n${result.stderr}`).toContain("missing command family");
	});

	test("family without subcommand is a usage error", async () => {
		const targets = await runForTest(["targets", "--json"], makeRuntime());
		expect(targets.exitCode).toBe(2);
		expect(`${targets.stdout}\n${targets.stderr}`).toContain("missing subcommand");

		const operate = await runForTest(["operate", "--json"], makeRuntime());
		expect(operate.exitCode).toBe(2);
		expect(`${operate.stdout}\n${operate.stderr}`).toContain("missing subcommand");
	});

	// Scenario 6: undeclared flags are rejected (exit 2) for every subcommand.
	test("each subcommand rejects an undeclared flag with a usage error", async () => {
		const cases: string[][] = [
			["targets", "list", "--bogus", "--dry-run", "--json"],
			["targets", "select", "--bogus", "--dry-run", "--json"],
			["targets", "status", "--bogus", "--json"],
			["operate", "snapshot", "--bogus", "--dry-run", "--json"],
			["operate", "screenshot", "--out", "x.png", "--bogus", "--dry-run", "--json"],
			["operate", "emulate", "--bogus", "--dry-run", "--json"],
		];
		for (const argv of cases) {
			const result = await runForTest(argv, makeRuntime());
			expect(result.exitCode).toBe(2);
			expect(`${result.stdout}\n${result.stderr}`).toContain(
				"unknown option: --bogus",
			);
		}
	});

	test("declared flags are accepted without a usage error", async () => {
		const result = await runForTest(
			["targets", "list", "--mode", "route-bound", "--show-url", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(`${result.stdout}\n${result.stderr}`).not.toContain("unknown option");
		expect(result.exitCode).toBe(0);
	});

	// Regression: family/subcommand resolve POSITIONALLY, so a flag value equal
	// to a reserved word must not be misread as the command.
	test("a flag value equal to a subcommand name does not change the resolved command", async () => {
		const result = await runForTest(
			["targets", "select", "--state", "status", "--candidate", "select", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout).data).toMatchObject({
			command: "targets-select",
			result_kind: "browser_targets",
		});
	});

	// Regression: a flag value equal to the family/subcommand word survives into
	// value pairing rather than being stripped from rest.
	test("a flag value equal to the family word is not stripped", async () => {
		const result = await runForTest(
			["targets", "select", "--origin", "targets", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(`${result.stdout}\n${result.stderr}`).not.toContain("unknown option");
		expect(result.exitCode).toBe(0);
	});

	// Regression: a value-bearing flag consumes its value even when the value
	// itself starts with "--" (declared type drives the skip, not token shape).
	test("a value beginning with -- is consumed as the flag value", async () => {
		const result = await runForTest(
			["operate", "snapshot", "--title-contains", "--beta", "--dry-run", "--json"],
			makeRuntime(),
		);
		expect(`${result.stdout}\n${result.stderr}`).not.toContain("unknown option");
		expect(result.exitCode).toBe(0);
	});

	// Regression: output mode keys on the resolved command, not an argv token
	// scan, so a "status" flag value does not flip a non-status command to plain.
	test("a flag value of 'status' does not flip output mode to plain", async () => {
		const result = await runForTest(
			["operate", "snapshot", "--url-contains", "status", "--dry-run"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(0);
		// JSON envelope is parseable (default machine-first mode preserved).
		expect(parseJson(result.stdout).status).toBe("ok");
	});

	// targets status defaults to a plain human projection (no --dry-run flag on
	// status). With no state path or state, U6 emits a plain-text failure to
	// stderr; stdout stays empty (not a JSON envelope), preserving the default.
	test("targets status defaults to plain output", async () => {
		const result = await runForTest(["targets", "status"], makeRuntime());
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("browser_use target_selection_state_path_missing");
		// Plain default: stdout is not a JSON envelope.
		expect(result.stdout).toBe("");
	});
});

// =========================================================================
// Dry-run / mock envelopes
// =========================================================================

describe("U3 dry-run envelopes", () => {
	// Scenario 7: dry-run success without live browser calls.
	test("dry-run emits a success envelope for targets and operate", async () => {
		const targets = await runForTest(
			["targets", "list", "--dry-run", "--json"],
			makeRuntime(),
		);
		const targetsJson = parseJson(targets.stdout);
		expect(targets.exitCode).toBe(0);
		expect(targetsJson.status).toBe("ok");
		expect(targetsJson.data).toMatchObject({
			result_kind: "browser_targets",
			mode: "dry_run",
		});

		const operate = await runForTest(
			["operate", "snapshot", "--dry-run", "--json"],
			makeRuntime(),
		);
		const operateJson = parseJson(operate.stdout);
		expect(operate.exitCode).toBe(0);
		expect(operateJson.status).toBe("ok");
		expect(operateJson.data).toMatchObject({
			result_kind: "browser_operation",
			mode: "dry_run",
		});
	});

	// Scenario 7: dry-run failure without live browser calls.
	test("dry-run with mock failure outcome emits an error envelope", async () => {
		const runtime = makeRuntime({ env: { BROWSER_USE_MOCK_OUTCOME: "failure" } });
		const result = await runForTest(
			["operate", "screenshot", "--out", "shot.png", "--dry-run", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("error");
		expect(json.error).toMatchObject({ code: "browser_use_mock_failure" });
	});

	test("without dry-run the shell emits a structured not-implemented error", async () => {
		const result = await runForTest(
			["operate", "snapshot", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(1);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("error");
		expect(json.error).toMatchObject({ code: "browser_use_not_implemented" });
	});
});

// =========================================================================
// U4 shared mcporter transport
// =========================================================================

const TRANSPORT_ARGS = [
	"call",
	"chrome-devtools.take_snapshot",
	"--args",
	"{}",
	"--output",
	"json",
] as const;

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

const ADAPTER_PROOF_CONTRACT = "browser-use.browser-adapter-proof";
const ROUTER_CONTRACT = "browser-use.browser-adapter-router";

// A valid Browser Adapter Proof success envelope (schema v2), as written to a
// --adapter-proof file. Mirrors preflight-browser-adapter's emitted shape.
function adapterProofEnvelope(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		status: "ok",
		run_id: "proof-run",
		data: {
			ok: true,
			action: "adapter_ready",
			contract: ADAPTER_PROOF_CONTRACT,
			schema_version: "2",
			command: "check",
			adapter: "chrome-devtools",
			endpoint: "http://127.0.0.1:9222",
			port: "9222",
			warm_chrome_run_id: "warm-1",
			adapter_proof_id: "proof-abc",
			verified_endpoint_identity: "127.0.0.1:9222",
			page_count: 0,
			pages: [],
			...overrides,
		},
	});
}

// A valid Router route success envelope with the operation binding tuple (U2),
// as written to a --route file.
function routeSuccessEnvelope(
	bindingOverrides: Record<string, unknown> = {},
): string {
	return JSON.stringify({
		status: "ok",
		run_id: "route-run",
		data: {
			outcome: "selected",
			contract: ROUTER_CONTRACT,
			evaluation_date: "2026-06-04",
			mode: "auto",
			requested_adapter: null,
			selected_adapter: "chrome-devtools",
			required_capabilities: ["snapshot_refs"],
			route_confidence: 90,
			ranking: [],
			candidate_decisions: [],
			provenance_summary: [],
			binding: {
				run_id: "route-run",
				selected_adapter_id: "chrome-devtools",
				warm_chrome_run_id: "warm-1",
				adapter_proof_id: "proof-abc",
				verified_endpoint_identity: "127.0.0.1:9222",
				route_evidence_hash: "hash-xyz",
				authorized_capabilities: ["snapshot_refs"],
				emitted_at: "2026-06-04T00:00:00.000Z",
				expires_at: "2026-06-05T00:00:00.000Z",
				...bindingOverrides,
			},
		},
	});
}

// list_pages stdout for an array of {id,url,title} pages.
function listPagesStdout(
	pages: Array<{ id?: string; url?: string; title?: string }>,
): string {
	return JSON.stringify({ pages });
}

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

// =========================================================================
// U6 Browser Target Selection
// =========================================================================

const TARGETS_CONTRACT = "browser-use.browser-targets";

type EnvelopeCandidate = {
	candidate_ordinal: number;
	candidate_id: string;
	origin: string;
	path_shape?: string;
	title?: string;
};

// A route-bound `targets list` success envelope (the CLI success envelope U5
// emits), as `targets select` receives it on stdin. route_bound/operation_ready
// default true; override to forge a recovery envelope for AE5.
function targetsListEnvelope(input: {
	candidates?: EnvelopeCandidate[];
	route_bound?: boolean;
	operation_ready?: boolean;
	binding?: Record<string, unknown>;
	requested_adapter?: string;
} = {}): string {
	const candidates = input.candidates ?? [
		{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://example.com", path_shape: "/app", title: "App" },
	];
	return JSON.stringify({
		status: "ok",
		run_id: "route-run",
		data: {
			mode: "route-bound",
			route_bound: input.route_bound ?? true,
			operation_ready: input.operation_ready ?? true,
			requested_adapter: input.requested_adapter ?? "chrome-devtools",
			contract: TARGETS_CONTRACT,
			candidate_count: candidates.length,
			candidates,
			binding: {
				run_id: "route-run",
				warm_chrome_run_id: "warm-1",
				adapter_proof_id: "proof-abc",
				selected_adapter_id: "chrome-devtools",
				verified_endpoint_identity: "127.0.0.1:9222",
				target_envelope_id: "env-xyz",
				route_evidence_hash: "hash-xyz",
				...input.binding,
			},
		},
	});
}

// Runtime that feeds a selection envelope on stdin and captures the single state
// write (path + parsed contents). readTextFile serves the captured state back so
// status can read what select wrote in the same test.
function selectionRuntime(input: {
	stdin?: string;
	env?: Record<string, string | undefined>;
	now?: () => number;
	files?: Record<string, string>;
	writeThrows?: boolean;
}): {
	runtime: BrowserUseRuntime;
	writes: Array<{ path: string; contents: string }>;
} {
	const writes: Array<{ path: string; contents: string }> = [];
	const files = { ...(input.files ?? {}) };
	const runtime = makeRuntime({
		env: input.env ?? {},
		now: input.now ?? (() => 1_000),
		readStdin: async () => input.stdin ?? "",
		readTextFile: async (path) => {
			if (path in files) return files[path];
			// Mirror node:fs: a missing file rejects with an Error carrying
			// code "ENOENT", so loadSelectedState can map it to target_state_missing
			// rather than the unreadable branch.
			throw enoent(path);
		},
		writeTextFile: async (path, contents) => {
			if (input.writeThrows) throw new Error("EACCES");
			writes.push({ path, contents });
			files[path] = contents;
		},
	});
	return { runtime, writes };
}

// An ENOENT error shaped like node:fs rejections (carries a `code` field).
function enoent(path: string): Error & { code: string } {
	const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
	(error as Error & { code: string }).code = "ENOENT";
	return error as Error & { code: string };
}

function parsedWrite(write: { contents: string }): Record<string, any> {
	return JSON.parse(write.contents);
}

describe("U6 target selection — envelope acceptance", () => {
	test("rejects a recovery-mode envelope (AE5)", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ route_bound: false, operation_ready: false }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_recovery_rejected",
		});
		expect(writes).toHaveLength(0);
	});

	test("rejects an operation_ready=false route-bound envelope", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ route_bound: true, operation_ready: false }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_recovery_rejected",
		});
	});

	test("rejects an envelope missing the Browser Targets contract id", async () => {
		const forged = JSON.parse(targetsListEnvelope());
		delete forged.data.contract;
		const { runtime } = selectionRuntime({ stdin: JSON.stringify(forged) });
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
	});

	test("rejects an internally inconsistent binding (requested_adapter vs binding)", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ requested_adapter: "playwright-cdp" }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
	});

	test("rejects an envelope with duplicate candidate ordinals", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({
				candidates: [
					{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://a.example" },
					{ candidate_ordinal: 1, candidate_id: "cid-2", origin: "https://b.example" },
				],
			}),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
		expect(writes).toHaveLength(0);
	});

	test("rejects an envelope with duplicate candidate ids", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({
				candidates: [
					{ candidate_ordinal: 1, candidate_id: "dup", origin: "https://a.example" },
					{ candidate_ordinal: 2, candidate_id: "dup", origin: "https://b.example" },
				],
			}),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
	});

	test("rejects a route-bound envelope missing the route slice", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ binding: { route_evidence_hash: "" } }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
	});

	test("missing envelope on stdin and env fails clearly", async () => {
		const { runtime } = selectionRuntime({ stdin: "" });
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
	});

	test("accepts the envelope inline via BROWSER_USE_TARGETS_ENVELOPE_JSON", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: "",
			env: { BROWSER_USE_TARGETS_ENVELOPE_JSON: targetsListEnvelope() },
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(writes).toHaveLength(1);
	});
});

describe("U6 target selection — candidate ordinal", () => {
	const TWO = [
		{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://a.example", path_shape: "/one", title: "One" },
		{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://b.example", path_shape: "/two", title: "Two" },
	];

	test("selects the candidate by ordinal scoped to the supplied envelope", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: TWO }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "2", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const state = parsedWrite(writes[0]);
		expect(state.selected_candidate_ordinal).toBe(2);
		expect(state.target_candidate_id).toBe("cid-2");
		expect(state.display.origin).toBe("https://b.example");
	});

	test("an ordinal not in the envelope fails with choose_target_candidate", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: TWO }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "5", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_candidate_invalid" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"choose_target_candidate",
		);
		expect(writes).toHaveLength(0);
	});

	test("a non-integer candidate ordinal fails", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: TWO }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "abc", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_candidate_invalid",
		});
	});
});

describe("U6 target selection — Browser Target Hints", () => {
	const THREE = [
		{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://app.example", path_shape: "/dashboard", title: "Dashboard" },
		{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://app.example", path_shape: "/settings", title: "Settings" },
		{ candidate_ordinal: 3, candidate_id: "cid-3", origin: "https://docs.example", path_shape: "/guide", title: "Guide" },
	];

	test("selects by unique origin hint", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		const result = await runForTest(
			["targets", "select", "--origin", "https://docs.example", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parsedWrite(writes[0]).selected_candidate_ordinal).toBe(3);
	});

	test("selects by unique URL substring hint", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		const result = await runForTest(
			["targets", "select", "--url-contains", "/settings", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parsedWrite(writes[0]).selected_candidate_ordinal).toBe(2);
	});

	test("selects by unique title substring hint", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		const result = await runForTest(
			["targets", "select", "--title-contains", "Guide", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parsedWrite(writes[0]).selected_candidate_ordinal).toBe(3);
	});

	test("ambiguous hints fail with refine_target_hint and write nothing", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		// origin matches two candidates.
		const result = await runForTest(
			["targets", "select", "--origin", "https://app.example", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_hint_ambiguous" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"refine_target_hint",
		);
		expect(writes).toHaveLength(0);
	});

	test("hints matching nothing fail with target_selection_hint_no_match", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		const result = await runForTest(
			["targets", "select", "--title-contains", "Nonexistent", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_hint_no_match" });
		// Generic miss routes to refine_target_hint, NOT the --show-url recovery.
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"refine_target_hint",
		);
	});

	test("a candidate ordinal does not count as a hint (mutually exclusive)", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--origin", "https://app.example", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_candidate_invalid",
		});
	});

	test("no selector at all fails clearly", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: THREE }),
		});
		const result = await runForTest(
			["targets", "select", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_candidate_invalid",
		});
	});

	test("a --url-contains path hint against an envelope with no path detail fails clearly (finding #4)", async () => {
		// Candidates without path_shape (envelope produced without --show-url). A
		// path-targeting hint can't match and must say so, pointing at --show-url —
		// not return a misleading generic hint-no-match.
		const noPathShape = [
			{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://app.example", title: "Dashboard" },
			{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://docs.example", title: "Guide" },
		];
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: noPathShape }),
		});
		const result = await runForTest(
			["targets", "select", "--url-contains", "/settings", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_hint_no_match" });
		expect((json.error as Record<string, string>).message).toContain("--show-url");
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"rerun_route_bound_target_discovery",
		);
		expect(writes).toHaveLength(0);
	});

	test("a --url-contains hint that matches an origin still works without path detail", async () => {
		const noPathShape = [
			{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://app.example", title: "Dashboard" },
			{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://docs.example", title: "Guide" },
		];
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: noPathShape }),
		});
		const result = await runForTest(
			["targets", "select", "--url-contains", "docs.example", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parsedWrite(writes[0]).selected_candidate_ordinal).toBe(2);
	});

	test("a MIXED envelope where the target lacks path detail still surfaces the --show-url recovery (R3)", async () => {
		// One candidate has path_shape, the target candidate does not. The path hint
		// can't match the target; the per-candidate guard must still point at
		// --show-url, not a generic refine_target_hint (the old global guard missed
		// this because anyPathShape was true).
		const mixed = [
			{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://app.example", path_shape: "/dashboard", title: "Dashboard" },
			{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://b.example", title: "B" },
		];
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: mixed }),
		});
		const result = await runForTest(
			["targets", "select", "--url-contains", "/settings", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_hint_no_match" });
		expect((json.error as Record<string, string>).message).toContain("--show-url");
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"rerun_route_bound_target_discovery",
		);
		expect(writes).toHaveLength(0);
	});

	test("an origin-substring --url-contains selects the matching candidate, not a wrong origin coincidence (R3)", async () => {
		// "account" appears in candidate 1's origin. The hint resolves candidate 1
		// by a legitimate origin match; it must not be suppressed by, nor mis-route
		// to, another candidate. (Guards against the matchesOrigin wrong-select.)
		const noPathShape = [
			{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://account.example", title: "Account" },
			{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://b.example", title: "B" },
		];
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({ candidates: noPathShape }),
		});
		const result = await runForTest(
			["targets", "select", "--url-contains", "account", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parsedWrite(writes[0]).selected_candidate_ordinal).toBe(1);
	});
});

describe("U6 target selection — state write", () => {
	test("missing --state and missing env state path fails clearly", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_state_path_missing",
		});
		expect(writes).toHaveLength(0);
	});

	test("derives a deterministic state path from BROWSER_USE_TARGET_STATE_DIR and the canonical run id", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			// The asserted run id matches the envelope's route run (correct end-to-end
			// use); the env-derived path keys on the canonical run id so status/operate
			// resolve the same file.
			env: { BROWSER_USE_TARGET_STATE_DIR: "/tmp/states", BROWSER_USE_RUN_ID: "route-run" },
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(writes[0].path).toBe("/tmp/states/browser-use-target-state-route-run.json");
	});

	test("selecting an envelope from a different run than the asserted run id fails cross-run", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			env: { BROWSER_USE_TARGET_STATE_DIR: "/tmp/states", BROWSER_USE_RUN_ID: "run-77" },
		});
		// Envelope's binding.run_id is "route-run", asserted run is "run-77".
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_cross_run",
		});
		expect(writes).toHaveLength(0);
	});

	test("env state dir WITHOUT an explicit run id fails closed, never keys on a random id (R1)", async () => {
		// No --state, BROWSER_USE_TARGET_STATE_DIR set, but no --run-id / env run id.
		// The diagnostic run id is a random per-invocation UUID; keying the path on
		// it would make a separate status process look in a different file. Fail
		// clearly instead of writing to an unreplayable path.
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			env: { BROWSER_USE_TARGET_STATE_DIR: "/tmp/states" },
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_state_path_missing" });
		expect((json.error as Record<string, string>).message).toContain("explicit run id");
		expect(writes).toHaveLength(0);
	});

	test("the --run-id flag (not only env) drives the select-time cross-run guard (R2)", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
		});
		// Envelope route run is "route-run"; assert a different run via the FLAG.
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--run-id", "other-run", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_cross_run",
		});
		expect(writes).toHaveLength(0);
	});

	test("with no run id set, select writes without a spurious cross-run failure (R2)", async () => {
		// runIdExplicit must be false here (no --run-id flag, no env). Previously a
		// raw argv substring scan could flip it true and reject a valid selection as
		// cross-run; with an explicit --state path and no asserted run, select
		// succeeds.
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(writes).toHaveLength(1);
	});

	test("a --run-id token smuggled past `--` does NOT produce a spurious cross-run (R2)", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
		});
		// The diagnostic layer leaves a post-`--` --run-id unresolved (run id stays
		// random), and parsedRunIdFlag stops at `--`, so runIdExplicit is false. The
		// trailing token is then an unknown positional → a loud usage error (exit 2),
		// NOT a silent/spurious target_state_cross_run (exit 20).
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json", "--", "--run-id"],
			runtime,
		);
		// The trailing post-`--` token is an unknown positional, so the parser
		// rejects with a usage error (exit 2) — scoped to parser behavior, not
		// merely "some non-cross-run failure".
		expect(result.exitCode).toBe(2);
		const json = parseJson(result.stdout);
		expect((json.error as Record<string, string> | undefined)?.code).not.toBe(
			"target_state_cross_run",
		);
		expect(writes).toHaveLength(0);
	});

	test("written state carries run id, route/proof binding, target envelope id, expiry, candidate id, and redacted display facts", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			now: () => 1_000,
		});
		await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		const state = parsedWrite(writes[0]);
		expect(state).toMatchObject({
			contract: TARGETS_CONTRACT,
			run_id: "route-run",
			selected_adapter_id: "chrome-devtools",
			warm_chrome_run_id: "warm-1",
			adapter_proof_id: "proof-abc",
			verified_endpoint_identity: "127.0.0.1:9222",
			route_evidence_hash: "hash-xyz",
			target_envelope_id: "env-xyz",
			target_candidate_id: "cid-1",
			selected_candidate_ordinal: 1,
			emitted_at_ms: 1_000,
		});
		// Short TTL applied.
		expect(state.expires_at_ms).toBeGreaterThan(state.emitted_at_ms);
		expect(state.display).toMatchObject({ origin: "https://example.com", path_shape: "/app", title: "App" });
	});

	test("state contents end with a trailing newline (single atomic write)", async () => {
		const { runtime, writes } = selectionRuntime({ stdin: targetsListEnvelope() });
		await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(writes).toHaveLength(1);
		expect(writes[0].contents.endsWith("\n")).toBe(true);
	});

	test("the real stdin decoder keeps a multi-byte codepoint split across chunk boundaries intact (finding #5)", () => {
		// Exercise the concrete decoder, not a pre-decoded string. Encode a
		// multi-byte payload, then split it MID-CODEPOINT across two chunks; a
		// per-chunk decode would corrupt the boundary character, the byte-join
		// decode must not.
		const text = "ダッシュボード — café";
		const bytes = new TextEncoder().encode(text);
		// Find a split index that lands inside a multi-byte sequence (continuation
		// byte 0x80-0xBF), guaranteeing the boundary straddles a codepoint.
		const splitAt = Array.from(bytes).findIndex(
			(b, i) => i > 0 && b >= 0x80 && b <= 0xbf,
		);
		expect(splitAt).toBeGreaterThan(0);
		const chunks = [bytes.slice(0, splitAt), bytes.slice(splitAt)];
		expect(decodeStdinChunks(chunks)).toBe(text);
		// And a single chunk decodes identically.
		expect(decodeStdinChunks([bytes])).toBe(text);
	});

	test("a multi-byte UTF-8 title round-trips end-to-end into state (finding #5)", async () => {
		const title = "ダッシュボード — café";
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope({
				candidates: [
					{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://example.com", path_shape: "/app", title },
				],
			}),
		});
		await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(parsedWrite(writes[0]).display.title).toBe(title);
	});

	test("a write failure (conflict/permission) fails closed with repair_target_state", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope(),
			writeThrows: true,
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_state_write_failed" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"repair_target_state",
		);
	});

	test("a supplied --adapter-proof that disagrees with the envelope binding fails closed", async () => {
		const { runtime } = selectionRuntime({
			stdin: targetsListEnvelope(),
			files: { "/p.json": adapterProofEnvelope({ adapter_proof_id: "proof-other" }) },
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--adapter-proof", "/p.json", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
	});

	test("a supplied --adapter-proof that agrees with the envelope binding is accepted", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			files: { "/p.json": adapterProofEnvelope() },
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--adapter-proof", "/p.json", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(writes).toHaveLength(1);
	});

	test("a supplied --route agreeing on adapter/proof/hash/run but NOT warm-chrome run is rejected", async () => {
		// The default targetsListEnvelope binding uses warm_chrome_run_id "warm-1".
		// This route agrees on every field the old cross-check compared, but differs
		// on warm_chrome_run_id — which must now fail closed (full-binding compare).
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			files: { "/route.json": routeSuccessEnvelope({ warm_chrome_run_id: "warm-OTHER" }) },
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--route", "/route.json", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_selection_envelope_invalid",
		});
		expect(writes).toHaveLength(0);
	});

	test("a supplied --route matching the full envelope binding is accepted", async () => {
		const { runtime, writes } = selectionRuntime({
			stdin: targetsListEnvelope(),
			files: { "/route.json": routeSuccessEnvelope() },
		});
		const result = await runForTest(
			["targets", "select", "--candidate", "1", "--route", "/route.json", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(writes).toHaveLength(1);
	});

	test("never writes adapter page ids, query strings, or fragments into state", async () => {
		// The envelope candidate carries only redacted display facts already, but
		// assert the state file contains none of the raw-handle shapes regardless.
		const { runtime, writes } = selectionRuntime({ stdin: targetsListEnvelope() });
		await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json", "--json"],
			runtime,
		);
		for (const token of ["?token", "#frag", "ws://", "devtools/page", "sessionid"]) {
			expect(writes[0].contents).not.toContain(token);
		}
	});
});

describe("U6 target status — projection and distinct failures", () => {
	// A valid persisted state, as select wrote it.
	function stateFile(overrides: Record<string, unknown> = {}): string {
		return JSON.stringify({
			contract: TARGETS_CONTRACT,
			schema_version: "1",
			run_id: "route-run",
			selected_adapter_id: "chrome-devtools",
			warm_chrome_run_id: "warm-1",
			adapter_proof_id: "proof-abc",
			verified_endpoint_identity: "127.0.0.1:9222",
			route_evidence_hash: "hash-xyz",
			target_envelope_id: "env-xyz",
			target_candidate_id: "cid-1",
			selected_candidate_ordinal: 1,
			emitted_at_ms: 1_000,
			expires_at_ms: 1_000 + 15 * 60_000,
			display: { origin: "https://example.com", path_shape: "/app", title: "App" },
			...overrides,
		});
	}

	test("projects fresh selected state as JSON", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": stateFile() },
			now: () => 2_000,
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, any>;
		expect(data.selected_target).toMatchObject({
			run_id: "route-run",
			candidate_ordinal: 1,
			target_envelope_id: "env-xyz",
		});
		expect(data.selected_target.expires_in_ms).toBeGreaterThan(0);
	});

	test("round-trips state written by select (plain default projection)", async () => {
		const { runtime } = selectionRuntime({ stdin: targetsListEnvelope() });
		await runForTest(
			["targets", "select", "--candidate", "1", "--state", "/state.json"],
			runtime,
		);
		const status = await runForTest(
			["targets", "status", "--state", "/state.json"],
			runtime,
		);
		expect(status.exitCode).toBe(0);
		expect(status.stdout).toContain("browser_target_state");
		expect(status.stdout).toContain("run_id=route-run");
	});

	test("missing state fails with target_state_missing", async () => {
		const { runtime } = selectionRuntime({ files: {} });
		const result = await runForTest(
			["targets", "status", "--state", "/absent.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_state_missing" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"refresh_target_selection",
		);
	});

	test("unreadable/malformed state fails with target_state_unreadable", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": "{ not json" },
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_unreadable",
		});
	});

	test("a non-ENOENT read error (e.g. EACCES) fails with target_state_unreadable, not missing", async () => {
		// A read that fails for a reason other than file-not-found must NOT be
		// reported as "missing"; the state may exist but be unreadable. Distinct
		// code + repair continuation (thread #3).
		const readError = Object.assign(new Error("EACCES: permission denied"), {
			code: "EACCES",
		});
		const runtime = makeRuntime({
			readStdin: async () => "",
			readTextFile: async () => {
				throw readError;
			},
			writeTextFile: async () => {},
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_state_unreadable" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"repair_target_state",
		);
	});

	test("a state file with the wrong contract fails with target_state_mismatch", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": stateFile({ contract: "some.other.contract" }) },
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_mismatch",
		});
	});

	test("expired state fails with target_state_stale", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": stateFile() },
			now: () => 1_000 + 15 * 60_000 + 1,
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_stale",
		});
	});

	test("cross-run state fails with target_state_cross_run when a run id is set", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": stateFile({ run_id: "other-run" }) },
			env: { BROWSER_USE_RUN_ID: "this-run" },
			now: () => 2_000,
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_cross_run",
		});
	});

	test("cross-run is detected when the run id is asserted via the --run-id flag (not only env) (finding #2)", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": stateFile({ run_id: "other-run" }) },
			now: () => 2_000,
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--run-id", "this-run", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_cross_run",
		});
	});

	test("a state file written by an incompatible schema_version fails with target_state_mismatch (finding #7)", async () => {
		const { runtime } = selectionRuntime({
			files: { "/state.json": stateFile({ schema_version: "999" }) },
			now: () => 2_000,
		});
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target_state_mismatch",
		});
	});

	test("a status path-missing failure is labeled command=targets-status, not targets-select (finding #6)", async () => {
		const { runtime } = selectionRuntime({ files: {} });
		// No --state, no state dir: resolveStatePath fails with a target_selection_*
		// code, but the command label must still reflect the invoked command.
		const result = await runForTest(["targets", "status", "--json"], runtime);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_selection_state_path_missing" });
		expect((json.data as Record<string, unknown>).command).toBe("targets-status");
	});

	test("status round-trips select's env-derived path under a coherent run id (finding #1)", async () => {
		const env = {
			BROWSER_USE_TARGET_STATE_DIR: "/tmp/states",
			BROWSER_USE_RUN_ID: "route-run",
		};
		const { runtime } = selectionRuntime({ stdin: targetsListEnvelope(), env });
		const select = await runForTest(
			["targets", "select", "--candidate", "1", "--json"],
			runtime,
		);
		expect(select.exitCode).toBe(0);
		// Same runtime (shares the files map + env): status with no --state derives
		// the same env-keyed path select wrote, and reads it back.
		const status = await runForTest(["targets", "status", "--json"], runtime);
		expect(status.exitCode).toBe(0);
		expect(
			(parseJson(status.stdout).data as Record<string, any>).selected_target.run_id,
		).toBe("route-run");
	});
});

describe("U6 operation-time target resolution (resolveOperationTarget)", () => {
	const CANDIDATES = [
		{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://a.example", path_shape: "/one", title: "One" },
		{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://b.example", path_shape: "/two", title: "Two" },
	];

	function input(overrides: Partial<OperationResolutionInput>): OperationResolutionInput {
		return {
			hints: {},
			candidates: CANDIDATES,
			routeBoundFreshBinding: true,
			...overrides,
		};
	}

	test("per-operation hints win over selected state", async () => {
		const resolution = resolveOperationTarget(
			input({
				hints: { origin: "https://b.example" },
				selectedState: { target_candidate_id: "cid-1", selected_candidate_ordinal: 1 },
			}),
		);
		expect(resolution).toMatchObject({ kind: "resolved", source: "hints" });
		if (resolution.kind === "resolved") {
			expect(resolution.candidate.candidate_ordinal).toBe(2);
		}
	});

	test("a failed hint does NOT fall back to selected state (AE8)", async () => {
		// Hint matches >1 (ambiguous): even though selected state exists, resolution
		// fails on the hints rather than using the selection.
		const ambiguous = resolveOperationTarget(
			input({
				candidates: [
					{ candidate_ordinal: 1, candidate_id: "cid-1", origin: "https://app.example", path_shape: "/x", title: "X" },
					{ candidate_ordinal: 2, candidate_id: "cid-2", origin: "https://app.example", path_shape: "/y", title: "Y" },
				],
				hints: { origin: "https://app.example" },
				selectedState: { target_candidate_id: "cid-1", selected_candidate_ordinal: 1 },
			}),
		);
		expect(ambiguous.kind).toBe("ambiguous");

		// Hint matches nothing: also no fallback.
		const noMatch = resolveOperationTarget(
			input({
				hints: { titleContains: "Nope" },
				selectedState: { target_candidate_id: "cid-1", selected_candidate_ordinal: 1 },
			}),
		);
		expect(noMatch.kind).toBe("no_match");
	});

	test("with no hints, resolves the selected state", async () => {
		const resolution = resolveOperationTarget(
			input({
				selectedState: { target_candidate_id: "cid-2", selected_candidate_ordinal: 2 },
			}),
		);
		expect(resolution).toMatchObject({ kind: "resolved", source: "selected_state" });
		if (resolution.kind === "resolved") {
			expect(resolution.candidate.candidate_id).toBe("cid-2");
		}
	});

	test("exactly-one-candidate fallback runs only with route-bound fresh binding", async () => {
		const single = [CANDIDATES[0]];
		const fresh = resolveOperationTarget(
			input({ candidates: single, routeBoundFreshBinding: true }),
		);
		expect(fresh).toMatchObject({ kind: "resolved", source: "single_candidate" });

		// Not fresh / not route-bound: no fallback, even with a single candidate.
		const stale = resolveOperationTarget(
			input({ candidates: single, routeBoundFreshBinding: false }),
		);
		expect(stale.kind).toBe("no_target");
	});

	test("no hints, no selected state, many candidates is ambiguous", async () => {
		const resolution = resolveOperationTarget(
			input({ routeBoundFreshBinding: true }),
		);
		expect(resolution.kind).toBe("ambiguous");
	});

	test("selected state whose candidate left the set surfaces selection_moved, not a silent rebind", async () => {
		const resolution = resolveOperationTarget(
			input({
				selectedState: { target_candidate_id: "gone", selected_candidate_ordinal: 9 },
			}),
		);
		// Distinct from a hint miss (no_match): U7 maps this to refresh_target_selection.
		expect(resolution.kind).toBe("selection_moved");
	});

	test("selected state does NOT rebind to a reused ordinal on a different candidate (finding #3)", async () => {
		// Original selection was cid-1 at ordinal 1. The new candidate set dropped
		// cid-1 but a DIFFERENT candidate now holds ordinal 1. Matching on ordinal
		// would silently rebind to the wrong page; only candidate_id may match.
		const resolution = resolveOperationTarget(
			input({
				candidates: [
					{ candidate_ordinal: 1, candidate_id: "cid-NEW", origin: "https://evil.example", path_shape: "/x", title: "X" },
				],
				selectedState: { target_candidate_id: "cid-1", selected_candidate_ordinal: 1 },
			}),
		);
		expect(resolution.kind).toBe("selection_moved");
	});
});
