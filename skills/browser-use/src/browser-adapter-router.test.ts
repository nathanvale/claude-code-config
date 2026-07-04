import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import {
	assertCommandHelpFlagSurface,
	runCommandSurfaceCases,
} from "@side-quest/cli-command-facade/testing";
import {
	BROWSER_ADAPTER_PROOF_ADAPTERS,
	BROWSER_ADAPTER_PROOF_CONTRACT_ID,
	BROWSER_ADAPTER_PROOF_SCHEMA_VERSION,
	BROWSER_ADAPTER_ROUTER_ADAPTERS,
	BROWSER_ADAPTER_ROUTER_CAPABILITIES,
	BROWSER_ADAPTER_ROUTER_DIAGNOSTIC_CODES,
	BROWSER_ADAPTER_ROUTER_SUPPORT_STATES,
	type BrowserAdapterRouterCommand,
	browserAdapterProofContracts,
	browserAdapterRouterContracts,
} from "./command-contract";
import {
	WARM_CHROME_CONTRACT_ID,
	WARM_CHROME_SCHEMA_VERSION,
} from "@side-quest/warm-chrome";
import {
	type RouteEvidenceEnvelope,
	type ValidatedRouteEvidenceEnvelope,
	type RouterRuntime,
	createDefaultRouterRuntime,
	parseEvidenceEnvelope,
	runForTest,
	validateErrorEnvelopeForTest,
	validateRouteEvidenceEnvelope,
} from "./browser-adapter-router";
import {
	authorizesOperationClass,
	evaluateRoute,
	isReportStale,
	rankSelectableForTest,
	resolveRequiredCapabilities,
} from "./browser-adapter-router-engine";
import {
	discoverReport,
	validateCapabilityReport,
} from "./browser-adapter-router-discovery";
import type { CapabilityReport } from "./browser-adapter-router-model";
import {
	continuationForCode,
	recoverabilityForCode,
	runtimeActionForId,
	validateRouterContinuationEnvelope,
	validateRouterErrorEnvelope,
} from "./browser-adapter-router-recovery";
import { BROWSER_ADAPTER_ROUTER_MANIFESTS } from "./browser-adapter-router-manifests";

const cleanupPaths: string[] = [];
const EVAL_DATE = "2026-06-10";

afterEach(async () => {
	await Promise.all(
		cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

// --- Builders ------------------------------------------------------------

function makeReport(
	overrides: Partial<CapabilityReport> = {},
): CapabilityReport {
	return {
		adapter_id: "chrome-devtools",
		schema_version: "1",
		report_source: "manifest",
		resolved_command: "mcporter",
		validation: "valid",
		attachment_model: "verified_warm_chrome",
		provenance: {
			adapter_version: "x@1",
			source_url: "https://example.test/docs",
			checked_at: "2026-06-08",
			verification_method: "maintainer_verified_manifest",
			stale_after_days: 30,
		},
		capabilities: [
			{
				capability: "snapshot_refs",
				support: "full",
				confidence: 90,
				evidence: { verification_method: "maintainer_verified_manifest" },
			},
			{
				capability: "element_actions",
				support: "full",
				confidence: 90,
				evidence: { verification_method: "maintainer_verified_manifest" },
			},
			{
				capability: "screenshot_media",
				support: "full",
				confidence: 90,
				evidence: { verification_method: "maintainer_verified_manifest" },
			},
		],
		...overrides,
	};
}

function makeEnvelope(
	overrides: Partial<RouteEvidenceEnvelope> = {},
): RouteEvidenceEnvelope {
	const run_id = overrides.run_id ?? "run-1";
	return {
		run_id,
		policy: { mode: "auto", ...(overrides.policy ?? {}) },
		task: overrides.task ?? { bundle: "snapshot_page_action" },
		preconditions: {
			run_id,
			freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
			warm_chrome_ready: true,
			warm_chrome_run_id: "warm-1",
			adapter_attached_verified_browser: { "chrome-devtools": true },
			// Default proof binding so operation-capable routes (the common
			// fixture bundle) satisfy the U2 binding gate. Tests that exercise
			// non-operation or fail-closed paths override preconditions.
			adapter_proof: {
				"chrome-devtools": {
					adapter_proof_id: "proof-abc",
					warm_chrome_run_id: "warm-1",
					verified_endpoint_identity: "127.0.0.1:9222",
				},
			},
			...(overrides.preconditions ?? {}),
		},
		reports: overrides.reports ?? [makeReport()],
	};
}

function makeValidatedEnvelope(
	overrides: Partial<RouteEvidenceEnvelope> = {},
): ValidatedRouteEvidenceEnvelope {
	return parseEvidenceEnvelope(JSON.stringify(makeEnvelope(overrides)));
}

function makeRuntime(overrides: Partial<RouterRuntime> = {}): RouterRuntime {
	return createDefaultRouterRuntime({
		env: {},
		evaluationDate: EVAL_DATE,
		readStdin: async () => "",
		...overrides,
	});
}

async function envelopeFile(envelope: RouteEvidenceEnvelope): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "bar-test-"));
	cleanupPaths.push(dir);
	const path = join(dir, "envelope.json");
	await writeFile(path, JSON.stringify(envelope), "utf-8");
	return path;
}

function parseJson(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout) as Record<string, unknown>;
}

function routerContractFlags(command: BrowserAdapterRouterCommand): string[] {
	return Object.keys(browserAdapterRouterContracts[command].flags ?? {}).sort();
}

function routerDiscoveryTree() {
	return projectCommandDiscoveryTree(
		Object.entries(browserAdapterRouterContracts) as Array<
			[
				BrowserAdapterRouterCommand,
				(typeof browserAdapterRouterContracts)[BrowserAdapterRouterCommand],
			]
		>,
	);
}

function routerDiscoveryEnvNames(command: BrowserAdapterRouterCommand): string[] {
	return (
		routerDiscoveryTree().commands[command]?.env_vars?.map((envVar) => envVar.name) ??
		[]
	).sort();
}

function expectNoUnknownOption(result: {
	stdout: string;
	stderr: string;
}): void {
	expect(`${result.stdout}\n${result.stderr}`).not.toContain("unknown option");
}

function expectUnknownOption(
	result: { exitCode: number; stdout: string; stderr: string },
	flag: string,
): void {
	expect(result.exitCode).not.toBe(0);
	expect(`${result.stdout}\n${result.stderr}`).toContain(
		`unknown option: ${flag}`,
	);
}

function expectJsonOk(result: {
	exitCode: number;
	stdout: string;
	stderr: string;
}): Record<string, unknown> {
	expect(result.exitCode).toBe(0);
	expectNoUnknownOption(result);
	const parsed = parseJson(result.stdout);
	expect(parsed.status).toBe("ok");
	return parsed;
}

function expectPlainSuccess(
	result: { exitCode: number; stdout: string; stderr: string },
	marker: string,
): void {
	expect(result.exitCode).toBe(0);
	expectNoUnknownOption(result);
	expect(result.stdout).toContain(marker);
	expect(result.stderr).toBe("");
}

// =========================================================================
// U0. Adapter registry and discovery interface
// =========================================================================

describe("U0 command contract", () => {
	test("contract exposes prepare, route, report, and status", () => {
		const result = parseCommandFacadeContract(
			{
				prepare: browserAdapterRouterContracts.prepare,
				route: browserAdapterRouterContracts.route,
				report: browserAdapterRouterContracts.report,
				status: browserAdapterRouterContracts.status,
			},
			{ path: "skills/browser-use/src/command-contract.ts" },
		);
		expect(result.ok).toBe(true);
		expect(Object.keys(browserAdapterRouterContracts).sort()).toEqual([
			"prepare",
			"report",
			"route",
			"status",
		]);
	});

	test("prepare contract declares check-only side effects (R7)", () => {
		// prepare reads supplied proof/report envelopes and assembles route
		// evidence; it never runs preflight, proof, report, or discovery.
		const sideEffects = browserAdapterRouterContracts.prepare.sideEffects ?? [];
		expect(sideEffects).toEqual(["check"]);
		expect(sideEffects).not.toContain("browser");
	});

	test("V1 command contract does not expose verify or report --verify", () => {
		expect("verify" in browserAdapterRouterContracts).toBe(false);
		expect(
			Object.keys(browserAdapterRouterContracts.report.flags ?? {}),
		).not.toContain("--verify");
	});

	test("report contract declares check-only side effects and no browser action", () => {
		// V1 report is a pure in-process lookup (env self-report JSON or static
		// manifest); declared check-only to match reality. No browser action.
		const sideEffects = browserAdapterRouterContracts.report.sideEffects ?? [];
		expect(sideEffects).toEqual(["check"]);
	});

	test("route contract declares check only, no browser action", () => {
		const sideEffects = browserAdapterRouterContracts.route.sideEffects ?? [];
		expect(sideEffects).toEqual(["check"]);
		expect(sideEffects).not.toContain("browser");
	});

	test("status aliases route", () => {
		expect(browserAdapterRouterContracts.status.alias?.command).toBe("route");
	});

	test("version supports plain and JSON output", async () => {
		const plain = await runForTest(["--version"], makeRuntime());
		expect(plain.exitCode).toBe(0);
		expect(plain.stdout).toBe("browser-adapter-router 0.1.0\n");
		expect(plain.stderr).toBe("");

		const jsonResult = await runForTest(["--version", "--json"], makeRuntime());
		expect(jsonResult.exitCode).toBe(0);
		expect(jsonResult.stderr).toBe("");
		expect(parseJson(jsonResult.stdout)).toMatchObject({
			status: "ok",
			data: {
				name: "browser-adapter-router",
				version: "0.1.0",
			},
		});
	});

	test("route does not declare a diagnostic flag the facade reserves", () => {
		const flags = Object.keys(browserAdapterRouterContracts.route.flags ?? {});
		for (const reserved of CLI_DIAGNOSTIC_FLAGS) {
			expect(flags).not.toContain(reserved);
		}
	});

	test("Router command contracts expose only command-specific flags", () => {
		expect(routerContractFlags("prepare")).toEqual([
			"--adapter",
			"--adapter-proof",
			"--bundle",
			"--capability",
			"--fallback-allowed",
			"--json",
			"--mode",
			"--plain",
			"--report",
			"--target-discovery",
			"--target-origin",
			"--warm-chrome-proof",
		]);
		expect(routerContractFlags("route")).toEqual([
			"--envelope",
			"--json",
			"--plain",
		]);
		expect(routerContractFlags("status")).toEqual([
			"--envelope",
			"--json",
			"--plain",
		]);
		expect(routerContractFlags("report")).toEqual([
			"--adapter",
			"--capability",
			"--json",
			"--plain",
		]);
	});

	test("Router command discovery metadata stays command-specific", async () => {
		const discovery = routerDiscoveryTree();

		expect(routerDiscoveryEnvNames("prepare")).toEqual([
			"BROWSER_USE_ROUTER_EVAL_DATE",
			"BROWSER_USE_ROUTER_PREPARE_RUN_ID",
			"BROWSER_USE_RUN_ID",
		]);
		expect(routerDiscoveryEnvNames("route")).toEqual([
			"BROWSER_USE_ROUTER_ENVELOPE_JSON",
			"BROWSER_USE_ROUTER_EVAL_DATE",
			"BROWSER_USE_RUN_ID",
		]);
		expect(routerDiscoveryEnvNames("status")).toEqual([
			"BROWSER_USE_ROUTER_ENVELOPE_JSON",
			"BROWSER_USE_ROUTER_EVAL_DATE",
			"BROWSER_USE_RUN_ID",
		]);
		expect(routerDiscoveryEnvNames("report")).toEqual([
			"BROWSER_USE_ROUTER_EVAL_DATE",
			"BROWSER_USE_ROUTER_SELF_REPORT_JSON",
			"BROWSER_USE_RUN_ID",
		]);

		expect(discovery.commands.report?.flags["--adapter"]).toMatchObject({
			type: "enum",
			required: true,
		});

		const missingAdapter = await runForTest(
			["report", "--json"],
			makeRuntime(),
		);
		expect(missingAdapter.exitCode).toBe(2);
		expect(`${missingAdapter.stdout}\n${missingAdapter.stderr}`).toContain(
			"report requires --adapter <id>.",
		);
		const parsed = parseJson(missingAdapter.stdout);
		expect(parsed.status).toBe("error");
		expect((parsed.error as { code?: string }).code).toBe("usage_error");
	});

	test("Router command help renders only command-specific flags", async () => {
		const route = await runForTest(["route", "--help"], makeRuntime());
		const status = await runForTest(["status", "--help"], makeRuntime());
		const report = await runForTest(["report", "--help"], makeRuntime());

		assertCommandHelpFlagSurface({
			command: "route",
			contract: browserAdapterRouterContracts.route,
			help: route.stdout,
			absentFlags: ["--adapter", "--capability"],
		});
		assertCommandHelpFlagSurface({
			command: "status",
			contract: browserAdapterRouterContracts.status,
			help: status.stdout,
			absentFlags: ["--adapter", "--capability"],
		});
		assertCommandHelpFlagSurface({
			command: "report",
			contract: browserAdapterRouterContracts.report,
			help: report.stdout,
			absentFlags: ["--envelope"],
		});
	});

	test("Router command discovery flags align with parser acceptance", async () => {
		const path = await envelopeFile(makeValidatedEnvelope());
		const stdinRuntime = makeRuntime({
			readStdin: async () => JSON.stringify(makeValidatedEnvelope()),
		});

		await runCommandSurfaceCases({
			runner: (argv) => runForTest(argv, makeRuntime()),
			cases: [
				{
					label: "route accepts envelope JSON",
					argv: ["route", "--envelope", path, "--json"],
					assert: (result) => {
						const parsed = expectJsonOk(result);
						const data = parsed.data as {
							selected_adapter?: string;
							evaluation_date?: string;
						};
						expect(data.selected_adapter).toBe("chrome-devtools");
						expect(data.evaluation_date).toBe(EVAL_DATE);
					},
				},
				{
					label: "status accepts envelope JSON",
					argv: ["status", "--envelope", path, "--json"],
					assert: (result) => {
						const parsed = expectJsonOk(result);
						const data = parsed.data as {
							selected_adapter?: string;
							evaluation_date?: string;
						};
						expect(data.selected_adapter).toBe("chrome-devtools");
						expect(data.evaluation_date).toBe(EVAL_DATE);
					},
				},
			],
		});

		await runCommandSurfaceCases({
			runner: (argv) => runForTest(argv, stdinRuntime),
			cases: [
				{
					label: "route accepts plain stdin",
					argv: ["route", "--plain"],
					assert: (result) => expectPlainSuccess(result, "adapter_selected"),
				},
				{
					label: "status accepts plain stdin",
					argv: ["status", "--plain"],
					assert: (result) => expectPlainSuccess(result, "adapter_selected"),
				},
			],
		});

		await runCommandSurfaceCases({
			runner: (argv) =>
				runForTest(argv, makeRuntime({ evaluationDate: "2026-06-02" })),
			cases: [
				{
					label: "report accepts adapter JSON",
					argv: ["report", "--adapter", "chrome-devtools", "--json"],
					assert: (result) => {
						const parsed = expectJsonOk(result);
						const data = parsed.data as {
							adapter_id?: string;
							report_source?: string;
							report?: unknown;
						};
						expect(data.adapter_id).toBe("chrome-devtools");
						expect(data.report_source).toBe("manifest");
						expect(data.report).toBeDefined();
					},
				},
				{
					label: "report capability projection stays report-shaped",
					argv: [
						"report",
						"--adapter",
						"chrome-devtools",
						"--capability",
						"snapshot_refs",
						"--json",
					],
					assert: (result) => {
						const parsed = expectJsonOk(result);
						const data = parsed.data as {
							capability?: { capability?: string };
							report?: unknown;
						};
						expect(data.capability?.capability).toBe("snapshot_refs");
						expect(data.report).toBeUndefined();
					},
				},
			],
		});

		await runCommandSurfaceCases({
			runner: (argv) => runForTest(argv, makeRuntime()),
			cases: [
				{
					label: "route rejects adapter flag",
					argv: ["route", "--adapter", "chrome-devtools", "--json"],
					assert: (result) => expectUnknownOption(result, "--adapter"),
				},
				{
					label: "route rejects capability flag",
					argv: ["route", "--capability", "snapshot_refs", "--json"],
					assert: (result) => expectUnknownOption(result, "--capability"),
				},
				{
					label: "status rejects adapter flag",
					argv: ["status", "--adapter", "chrome-devtools", "--plain"],
					assert: (result) => expectUnknownOption(result, "--adapter"),
				},
				{
					label: "status rejects capability flag",
					argv: ["status", "--capability", "snapshot_refs", "--plain"],
					assert: (result) => expectUnknownOption(result, "--capability"),
				},
				{
					label: "report rejects envelope flag",
					argv: [
						"report",
						"--adapter",
						"chrome-devtools",
						"--envelope",
						"x.json",
						"--json",
					],
					assert: (result) => expectUnknownOption(result, "--envelope"),
				},
			],
		});
	});

	test("registry includes chrome-devtools, agent-browser, playwright-cdp", () => {
		expect([...BROWSER_ADAPTER_ROUTER_ADAPTERS].sort()).toEqual([
			"agent-browser",
			"chrome-devtools",
			"playwright-cdp",
		]);
	});

	test("existing one-adapter proof stays scoped to chrome-devtools", () => {
		expect([...BROWSER_ADAPTER_PROOF_ADAPTERS]).toEqual(["chrome-devtools"]);
	});

	test("Browser Adapter Proof command surface remains read-only attachment proof", () => {
		expect(Object.keys(browserAdapterProofContracts).sort()).toEqual([
			"check",
			"status",
		]);
		expect(browserAdapterProofContracts.check.sideEffects).not.toContain(
			"browser",
		);
	});
});

// =========================================================================
// U1. Prepare route evidence on-ramp
// =========================================================================

function warmChromeProofEnvelope(
	overrides: { runId?: string; ok?: boolean; status?: string } = {},
): string {
	const runId = overrides.runId ?? "run-1";
	return JSON.stringify({
		status: overrides.status ?? "ok",
		run_id: runId,
		data: {
			ok: overrides.ok ?? true,
			action: "browser_ready",
			contract_id: WARM_CHROME_CONTRACT_ID,
			schema_version: WARM_CHROME_SCHEMA_VERSION,
			command: "check",
			endpoint: "http://127.0.0.1:9333",
			port: "9333",
		},
	});
}

function adapterProofEnvelope(
	overrides: {
		runId?: string;
		warmChromeRunId?: string;
		adapter?: string;
		ok?: boolean;
	} = {},
): string {
	const runId = overrides.runId ?? "adapter-run-1";
	return JSON.stringify({
		status: "ok",
		run_id: runId,
		data: {
			ok: overrides.ok ?? true,
			action: "adapter_ready",
			contract: BROWSER_ADAPTER_PROOF_CONTRACT_ID,
			schema_version: BROWSER_ADAPTER_PROOF_SCHEMA_VERSION,
			command: "check",
			adapter: overrides.adapter ?? "chrome-devtools",
			warm_chrome_run_id: overrides.warmChromeRunId ?? "run-1",
			adapter_proof_id: "proof-fixture-id",
			verified_endpoint_identity: "127.0.0.1:9333",
			endpoint: "http://127.0.0.1:9333",
			port: "9333",
			page_count: 1,
		},
	});
}

async function tmpFile(name: string, content: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "prepare-test-"));
	cleanupPaths.push(dir);
	const path = join(dir, name);
	await writeFile(path, content, "utf-8");
	return path;
}

async function completePrepareArgv(
	overrides: {
		warmChrome?: string;
		adapterProof?: string;
		report?: string;
		extra?: string[];
	} = {},
): Promise<string[]> {
	const warm = await tmpFile(
		"warm.json",
		overrides.warmChrome ?? warmChromeProofEnvelope(),
	);
	const proof = await tmpFile(
		"proof.json",
		overrides.adapterProof ?? adapterProofEnvelope(),
	);
	const report = await tmpFile(
		"report.json",
		overrides.report ?? JSON.stringify(makeReport()),
	);
	return [
		"prepare",
		"--warm-chrome-proof",
		warm,
		"--adapter-proof",
		proof,
		"--report",
		report,
		"--bundle",
		"snapshot_page_action",
		...(overrides.extra ?? []),
		"--json",
	];
}

describe("U1 prepare on-ramp", () => {
	test("prepare --help renders evidence flags", async () => {
		const help = await runForTest(["prepare", "--help"], makeRuntime());
		expect(help.exitCode).toBe(0);
		for (const flag of [
			"--warm-chrome-proof",
			"--adapter-proof",
			"--report",
			"--target-discovery",
			"--mode",
			"--adapter",
			"--fallback-allowed",
			"--bundle",
			"--capability",
			"--target-origin",
		]) {
			expect(help.stdout).toContain(flag);
		}
	});

	test("route --help points to prepare", async () => {
		const help = await runForTest(["route", "--help"], makeRuntime());
		expect(help.stdout).toContain("prepare");
	});

	test("complete inputs emit a route-ready envelope and route_prepared_evidence", async () => {
		const argv = await completePrepareArgv();
		const result = await runForTest(argv, makeRuntime());
		const parsed = expectJsonOk(result);
		const data = parsed.data as {
			envelope?: unknown;
			route_input_mode?: string;
			next_command_intent?: string;
		};
		expect(data.envelope).toBeDefined();
		expect(data.route_input_mode).toBe("auto");
		expect(data.next_command_intent).toBe("route");
		expect((parsed.continuation as { next_action_id?: string }).next_action_id).toBe(
			"route_prepared_evidence",
		);
	});

	test("emitted envelope is accepted by route (AE3)", async () => {
		const prepareArgv = await completePrepareArgv();
		const prepared = await runForTest(prepareArgv, makeRuntime());
		const data = parseJson(prepared.stdout).data as { envelope: unknown };
		const envelopePath = await tmpFile(
			"prepared-envelope.json",
			JSON.stringify(data.envelope),
		);
		const routed = await runForTest(
			["route", "--envelope", envelopePath, "--json"],
			makeRuntime(),
		);
		const routedParsed = expectJsonOk(routed);
		expect((routedParsed.data as { selected_adapter?: string }).selected_adapter).toBe(
			"chrome-devtools",
		);
	});

	test("repeated --report inputs produce a reports array", async () => {
		const warm = await tmpFile("warm.json", warmChromeProofEnvelope());
		const proof = await tmpFile("proof.json", adapterProofEnvelope());
		const reportA = await tmpFile("a.json", JSON.stringify(makeReport()));
		const reportB = await tmpFile("b.json", JSON.stringify(makeReport()));
		const result = await runForTest(
			[
				"prepare",
				"--warm-chrome-proof",
				warm,
				"--adapter-proof",
				proof,
				"--report",
				reportA,
				"--report",
				reportB,
				"--bundle",
				"snapshot_page_action",
				"--json",
			],
			makeRuntime(),
		);
		const data = expectJsonOk(result).data as {
			envelope: { reports: unknown[] };
		};
		expect(data.envelope.reports).toHaveLength(2);
	});

	test("missing warm Chrome proof emits prove_warm_chrome", async () => {
		const proof = await tmpFile("proof.json", adapterProofEnvelope());
		const report = await tmpFile("report.json", JSON.stringify(makeReport()));
		const result = await runForTest(
			[
				"prepare",
				"--adapter-proof",
				proof,
				"--report",
				report,
				"--bundle",
				"snapshot_page_action",
				"--json",
			],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(20);
		const parsed = parseJson(result.stdout);
		expect(parsed.status).toBe("error");
		expect((parsed.continuation as { next_action_id?: string }).next_action_id).toBe(
			"prove_warm_chrome",
		);
	});

	// Field-switch regression guard (plan U3): the router now reads the package's
	// data.contract_id. A legacy envelope carrying only the retired data.contract
	// field (old browser-use id) must NOT pass — it routes to prove_warm_chrome,
	// proving the switch is a field change, not just a value change.
	test("legacy data.contract-only warm Chrome proof no longer passes", async () => {
		const legacyProof = JSON.stringify({
			status: "ok",
			run_id: "run-1",
			data: {
				ok: true,
				action: "browser_ready",
				contract: "browser-use.warm-chrome-preflight",
				command: "check",
				endpoint: "http://127.0.0.1:9333",
				port: "9333",
			},
		});
		const warm = await tmpFile("legacy-warm.json", legacyProof);
		const proof = await tmpFile("proof.json", adapterProofEnvelope());
		const report = await tmpFile("report.json", JSON.stringify(makeReport()));
		const result = await runForTest(
			[
				"prepare",
				"--warm-chrome-proof",
				warm,
				"--adapter-proof",
				proof,
				"--report",
				report,
				"--bundle",
				"snapshot_page_action",
				"--json",
			],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(20);
		const parsed = parseJson(result.stdout);
		expect(parsed.status).toBe("error");
		expect(
			(parsed.continuation as { next_action_id?: string }).next_action_id,
		).toBe("prove_warm_chrome");
	});

	test("missing report emits discover_capability_report", async () => {
		const warm = await tmpFile("warm.json", warmChromeProofEnvelope());
		const proof = await tmpFile("proof.json", adapterProofEnvelope());
		const result = await runForTest(
			[
				"prepare",
				"--warm-chrome-proof",
				warm,
				"--adapter-proof",
				proof,
				"--bundle",
				"snapshot_page_action",
				"--json",
			],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(20);
		const parsed = parseJson(result.stdout);
		expect((parsed.continuation as { next_action_id?: string }).next_action_id).toBe(
			"discover_capability_report",
		);
	});

	test("missing adapter proof emits prove_adapter_attachment", async () => {
		const warm = await tmpFile("warm.json", warmChromeProofEnvelope());
		const report = await tmpFile("report.json", JSON.stringify(makeReport()));
		const result = await runForTest(
			[
				"prepare",
				"--warm-chrome-proof",
				warm,
				"--report",
				report,
				"--bundle",
				"snapshot_page_action",
				"--json",
			],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(20);
		const parsed = parseJson(result.stdout);
		expect((parsed.continuation as { next_action_id?: string }).next_action_id).toBe(
			"prove_adapter_attachment",
		);
	});

	test("force mode without adapter emits change_prepare_input", async () => {
		const argv = await completePrepareArgv({ extra: ["--mode", "force"] });
		const result = await runForTest(argv, makeRuntime());
		expect(result.exitCode).toBe(20);
		const parsed = parseJson(result.stdout);
		expect((parsed.continuation as { next_action_id?: string }).next_action_id).toBe(
			"change_prepare_input",
		);
	});

	test("malformed report envelope emits change_prepare_input", async () => {
		const argv = await completePrepareArgv({ report: "{not json" });
		const result = await runForTest(argv, makeRuntime());
		expect(result.exitCode).toBe(20);
		const parsed = parseJson(result.stdout);
		expect((parsed.error as { code?: string }).code).toBe("prepare_input_invalid");
		expect((parsed.continuation as { next_action_id?: string }).next_action_id).toBe(
			"change_prepare_input",
		);
	});

	test("multiple missing facts list every fact and choose canonical order", async () => {
		// No inputs at all: warm chrome, report, and adapter proof all missing.
		const result = await runForTest(
			["prepare", "--bundle", "snapshot_page_action", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(20);
		const parsed = parseJson(result.stdout);
		const data = parsed.data as {
			missing_facts: Array<{ kind: string }>;
		};
		const kinds = data.missing_facts.map((fact) => fact.kind);
		expect(kinds).toContain("warm_chrome_proof");
		expect(kinds).toContain("capability_report");
		expect(kinds).toContain("adapter_proof");
		// Canonical continuation follows dependency order: warm Chrome first.
		expect((parsed.continuation as { next_action_id?: string }).next_action_id).toBe(
			"prove_warm_chrome",
		);
		// runtime_actions includes every relevant recovery action.
		const actionIds = (parsed.runtime_actions as Array<{ id: string }>).map(
			(action) => action.id,
		);
		expect(actionIds).toContain("prove_warm_chrome");
		expect(actionIds).toContain("discover_capability_report");
		expect(actionIds).toContain("prove_adapter_attachment");
	});

	test("adapter proof bound to a different warm Chrome run fails closed", async () => {
		const argv = await completePrepareArgv({
			adapterProof: adapterProofEnvelope({ warmChromeRunId: "other-run" }),
		});
		const result = await runForTest(argv, makeRuntime());
		expect(result.exitCode).toBe(20);
		const parsed = parseJson(result.stdout);
		expect((parsed.error as { code?: string }).code).toBe("prepare_input_invalid");
	});

	test("prepare plain output emits route_evidence_prepared", async () => {
		const warm = await tmpFile("warm.json", warmChromeProofEnvelope());
		const proof = await tmpFile("proof.json", adapterProofEnvelope());
		const report = await tmpFile("report.json", JSON.stringify(makeReport()));
		const result = await runForTest(
			[
				"prepare",
				"--warm-chrome-proof",
				warm,
				"--adapter-proof",
				proof,
				"--report",
				report,
				"--bundle",
				"snapshot_page_action",
				"--plain",
			],
			makeRuntime(),
		);
		expectPlainSuccess(result, "route_evidence_prepared");
	});

	test("prepare rejects undeclared flags", async () => {
		const argv = await completePrepareArgv({ extra: ["--bogus", "x"] });
		const result = await runForTest(argv, makeRuntime());
		expectUnknownOption(result, "--bogus");
	});
});

describe("U0 report discovery", () => {
	test("missing manifest and missing self-report emit adapter_capability_unknown", () => {
		// Force a lookup miss by validating an adapter with no manifest entry path:
		// use discoverReport against a fabricated adapter via self-report mismatch.
		const result = discoverReport("agent-browser", EVAL_DATE, {
			...makeReport(),
			adapter_id: "chrome-devtools",
		});
		expect(result.found).toBe(false);
		if (!result.found) expect(result.code).toBe("adapter_capability_unknown");
	});

	test("malformed self-report emits schema diagnostic and fails closed", () => {
		const result = discoverReport("chrome-devtools", EVAL_DATE, {
			adapter_id: "chrome-devtools",
			// missing provenance + capabilities
		});
		expect(result.found).toBe(false);
		if (!result.found) {
			expect(result.code).toBe("adapter_capability_unknown");
			expect(result.diagnostics.length).toBeGreaterThan(0);
		}
	});

	test("malformed report is unknown, not stale", () => {
		const result = discoverReport("chrome-devtools", EVAL_DATE, {
			adapter_id: "chrome-devtools",
		});
		if (!result.found) expect(result.code).toBe("adapter_capability_unknown");
	});

	test("valid report past stale-after is stale, not unknown", () => {
		// Evaluate the chrome-devtools manifest far past its stale window.
		const result = discoverReport("chrome-devtools", "2027-01-01");
		expect(result.found).toBe(false);
		if (!result.found) expect(result.code).toBe("adapter_capability_stale");
	});

	test("report source priority prefers validated self-report over manifest", () => {
		const selfReport = makeReport({
			adapter_id: "chrome-devtools",
			resolved_command: "self-report-cmd",
		});
		const result = discoverReport("chrome-devtools", EVAL_DATE, selfReport);
		expect(result.found).toBe(true);
		if (result.found) expect(result.source).toBe("self_report");
	});

	test("report falls back to validated TypeScript manifest", () => {
		const result = discoverReport("chrome-devtools", EVAL_DATE);
		expect(result.found).toBe(true);
		if (result.found) expect(result.source).toBe("manifest");
	});

	test("manifest constants pass through the same validator as self-reports", () => {
		for (const adapter of BROWSER_ADAPTER_ROUTER_ADAPTERS) {
			const manifest = BROWSER_ADAPTER_ROUTER_MANIFESTS[adapter];
			expect(manifest).toBeDefined();
			if (manifest) {
				const result = validateCapabilityReport(manifest);
				expect(result.ok).toBe(true);
			}
		}
	});

	test("manifest capability evidence uses the manifest source URL", () => {
		for (const adapter of BROWSER_ADAPTER_ROUTER_ADAPTERS) {
			const manifest = BROWSER_ADAPTER_ROUTER_MANIFESTS[adapter];
			expect(manifest).toBeDefined();
			if (!manifest) continue;
			for (const capability of manifest.capabilities) {
				expect(capability.evidence.source_url).toBe(
					manifest.provenance.source_url,
				);
			}
		}
	});
});

describe("U0 evidence envelope input", () => {
	test("route validation returns a branded validated envelope", () => {
		const result = validateRouteEvidenceEnvelope(makeEnvelope());
		expect(result.ok).toBe(true);
		if (result.ok) {
			const evaluation = evaluateRoute(result.envelope, EVAL_DATE);
			expect(evaluation.outcome).toBe("selected");
		}
	});

	test("route validation exposes diagnostics without throwing", () => {
		const result = validateRouteEvidenceEnvelope({
			...makeEnvelope(),
			policy: { mode: "force" },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.diagnostics).toContain(
				"envelope.policy.adapter_id is required in force/prefer mode",
			);
		}
	});

	test("route accepts an evidence envelope path", async () => {
		const path = await envelopeFile(makeValidatedEnvelope());
		const { exitCode, stdout } = await runForTest(
			["route", "--envelope", path, "--json"],
			makeRuntime(),
		);
		expect(exitCode).toBe(0);
		expect(parseJson(stdout).status).toBe("ok");
	});

	test("route accepts an evidence envelope from stdin JSON", async () => {
		const json = JSON.stringify(makeValidatedEnvelope());
		const { exitCode, stdout } = await runForTest(
			["route", "--json"],
			makeRuntime({ readStdin: async () => json }),
		);
		expect(exitCode).toBe(0);
		expect(parseJson(stdout).status).toBe("ok");
	});

	test("route does not read prior command output from implicit filesystem locations", async () => {
		// No --envelope, no stdin, no env: route must fail on missing envelope,
		// never silently read a "latest" file.
		const { exitCode } = await runForTest(
			["route", "--json"],
			makeRuntime({ readStdin: async () => "" }),
		);
		expect(exitCode).not.toBe(0);
	});

	test("status projects a supplied envelope without hidden latest-route state", async () => {
		const path = await envelopeFile(makeValidatedEnvelope());
		const { exitCode, stdout } = await runForTest(
			["status", "--envelope", path, "--plain"],
			makeRuntime(),
		);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("adapter_selected");
	});

	test("status defaults to plain output", async () => {
		const path = await envelopeFile(makeValidatedEnvelope());
		const { exitCode, stdout } = await runForTest(
			["status", "--envelope", path],
			makeRuntime(),
		);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("adapter_selected");
		expect(() => JSON.parse(stdout)).toThrow();
	});

	test("route and status use the same pure route evaluator", async () => {
		const envelope = makeValidatedEnvelope();
		const path = await envelopeFile(envelope);
		const route = await runForTest(
			["route", "--envelope", path, "--json"],
			makeRuntime(),
		);
		const status = await runForTest(
			["status", "--envelope", path, "--json"],
			makeRuntime(),
		);
		const routeData = parseJson(route.stdout).data as Record<string, unknown>;
		const statusData = parseJson(status.stdout).data as Record<string, unknown>;
		expect(statusData.selected_adapter).toBe(
			routeData.selected_adapter as string,
		);
	});
});

// =========================================================================
// U1. Capability report contract
// =========================================================================

describe("U1 capability report contract", () => {
	test("report accepts all five support states", () => {
		expect([...BROWSER_ADAPTER_ROUTER_SUPPORT_STATES].sort()).toEqual([
			"full",
			"none",
			"partial",
			"stale",
			"unknown",
		]);
		for (const support of BROWSER_ADAPTER_ROUTER_SUPPORT_STATES) {
			const report = makeReport({
				capabilities: [
					{
						capability: "snapshot_refs",
						support,
						confidence: 80,
						evidence: { verification_method: "m" },
					},
				],
			});
			expect(validateCapabilityReport(report).ok).toBe(true);
		}
	});

	test("missing provenance fails validation", () => {
		const report = makeReport();
		const broken = { ...report, provenance: undefined };
		const result = validateCapabilityReport(broken);
		expect(result.ok).toBe(false);
	});

	test("self-reported validation must be valid", () => {
		const report: unknown = { ...makeReport(), validation: "invalid" };
		const result = validateCapabilityReport(report);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.diagnostics).toContain("report.validation must be valid");
		}
	});

	test("report requires confidence per declared capability", () => {
		// Build a malformed report as `unknown` to exercise the runtime validator.
		const report: unknown = {
			...makeReport(),
			capabilities: [
				{
					capability: "snapshot_refs",
					support: "full",
					evidence: { verification_method: "m" },
				},
			],
		};
		expect(validateCapabilityReport(report).ok).toBe(false);
	});

	test("report requires per-capability evidence references", () => {
		const report: unknown = {
			...makeReport(),
			capabilities: [
				{
					capability: "snapshot_refs",
					support: "full",
					confidence: 90,
					evidence: {},
				},
			],
		};
		expect(validateCapabilityReport(report).ok).toBe(false);
	});

	test("report requires attachment_model", () => {
		const report = makeReport();
		const broken = { ...report, attachment_model: undefined };
		expect(validateCapabilityReport(broken).ok).toBe(false);
	});

	test("storage-state import attachment fails compatibility in V1", () => {
		const report = makeReport({ attachment_model: "storage_state_import" });
		const envelope = makeValidatedEnvelope({ reports: [report] });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("adapter_attachment_incompatible");
		}
	});

	test("separate browser context attachment fails compatibility in V1", () => {
		const report = makeReport({ attachment_model: "separate_browser_context" });
		const envelope = makeValidatedEnvelope({ reports: [report] });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("adapter_attachment_incompatible");
		}
	});

	test("stale report emits adapter_capability_stale", () => {
		const report = makeReport({
			provenance: {
				adapter_version: "x@1",
				source_url: "https://example.test/docs",
				checked_at: "2026-01-01",
				verification_method: "m",
				stale_after_days: 30,
			},
		});
		const envelope = makeValidatedEnvelope({ reports: [report] });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("adapter_capability_stale");
		}
	});

	test("fresh report with a required capability below confidence 75 fails closed", () => {
		const report = makeReport({
			capabilities: [
				{
					capability: "snapshot_refs",
					support: "full",
					confidence: 60,
					evidence: { verification_method: "m" },
				},
				{
					capability: "element_actions",
					support: "full",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
				{
					capability: "screenshot_media",
					support: "full",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
			],
		});
		const envelope = makeValidatedEnvelope({ reports: [report] });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
	});

	test("route confidence is the minimum across required capabilities", () => {
		const report = makeReport({
			capabilities: [
				{
					capability: "snapshot_refs",
					support: "full",
					confidence: 80,
					evidence: { verification_method: "m" },
				},
				{
					capability: "element_actions",
					support: "full",
					confidence: 95,
					evidence: { verification_method: "m" },
				},
				{
					capability: "screenshot_media",
					support: "full",
					confidence: 88,
					evidence: { verification_method: "m" },
				},
			],
		});
		const envelope = makeValidatedEnvelope({ reports: [report] });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome === "selected") {
			expect(evaluation.route_confidence).toBe(80);
		}
	});

	test("isReportStale is pure date math", () => {
		const fresh = {
			adapter_version: "",
			source_url: "",
			verification_method: "",
			checked_at: "2026-06-08",
			stale_after_days: 30,
		};
		expect(isReportStale(fresh, "2026-06-10")).toBe(false);
		expect(isReportStale(fresh, "2026-08-01")).toBe(true);
	});

	test("isReportStale treats incomplete freshness metadata as stale", () => {
		const incomplete = {
			adapter_version: "",
			source_url: "",
			verification_method: "",
			checked_at: "2026-06-08",
		} as Parameters<typeof isReportStale>[0];
		expect(isReportStale(incomplete, EVAL_DATE)).toBe(true);
	});
});

// =========================================================================
// U2. Adapter policy resolver
// =========================================================================

describe("U2 policy resolver", () => {
	test("route rejects missing/unreadable evidence envelope", async () => {
		const { exitCode, stdout } = await runForTest(
			["route", "--envelope", "/nonexistent/path.json", "--json"],
			makeRuntime(),
		);
		expect(exitCode).not.toBe(0);
		expect(parseJson(stdout).status).toBe("error");
	});

	test("route rejects malformed evidence envelope", () => {
		expect(() => parseEvidenceEnvelope("{not json")).toThrow();
	});

	test("route rejects stale evidence without freshness metadata", () => {
		const envelope = makeValidatedEnvelope({
			preconditions: {
				run_id: "run-1",
				// @ts-expect-error intentionally missing freshness
				freshness: undefined,
				warm_chrome_ready: true,
				adapter_attached_verified_browser: { "chrome-devtools": true },
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("route_evidence_stale");
		}
	});

	test("route rejects stale evidence", () => {
		const envelope = makeValidatedEnvelope({
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-01-01", stale_after_days: 5 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: { "chrome-devtools": true },
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("route_evidence_stale");
		}
	});

	test("route rejects mixed-run evidence", () => {
		const envelope = makeValidatedEnvelope({
			run_id: "run-A",
			preconditions: {
				run_id: "run-B",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: { "chrome-devtools": true },
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("route_evidence_mixed_run");
		}
	});

	test("missing candidate proof emits prove_adapter_attachment", () => {
		const envelope = makeValidatedEnvelope({
			policy: { mode: "force", adapter_id: "agent-browser" },
			task: { bundle: "snapshot_page_action" },
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: {},
			},
			reports: [makeReport({ adapter_id: "agent-browser" })],
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.next_action_id).toBe("prove_adapter_attachment");
		}
	});

	test("auto routes a fully evidenced candidate while disclosing skipped candidates", () => {
		const envelope = makeValidatedEnvelope({
			policy: { mode: "auto" },
			reports: [
				makeReport({ adapter_id: "chrome-devtools" }),
				makeReport({ adapter_id: "agent-browser" }),
			],
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				// only chrome-devtools is proven
				adapter_attached_verified_browser: { "chrome-devtools": true },
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome === "selected") {
			expect(evaluation.selected_adapter).toBe("chrome-devtools");
			const skipped = evaluation.candidate_decisions.filter(
				(d) => d.status === "skipped",
			);
			expect(skipped.length).toBeGreaterThan(0);
		}
	});

	test("auto does not route silently when no candidate is fully evidenced", () => {
		const envelope = makeValidatedEnvelope({
			policy: { mode: "auto" },
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: {},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
	});

	test("prefer falls back only when allowed", () => {
		const envelope = makeValidatedEnvelope({
			policy: {
				mode: "prefer",
				adapter_id: "agent-browser",
				fallback_allowed: true,
			},
			reports: [
				// preferred agent-browser has partial -> not selectable
				makeReport({
					adapter_id: "agent-browser",
					capabilities: [
						{
							capability: "snapshot_refs",
							support: "partial",
							confidence: 60,
							evidence: { verification_method: "m" },
						},
						{
							capability: "element_actions",
							support: "full",
							confidence: 90,
							evidence: { verification_method: "m" },
						},
						{
							capability: "screenshot_media",
							support: "full",
							confidence: 90,
							evidence: { verification_method: "m" },
						},
					],
				}),
				makeReport({ adapter_id: "chrome-devtools" }),
			],
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: {
					"agent-browser": true,
					"chrome-devtools": true,
				},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome === "selected") {
			expect(evaluation.selected_adapter).toBe("chrome-devtools");
		}
	});

	test("prefer with missing preferred proof fails closed when fallback not allowed", () => {
		const envelope = makeValidatedEnvelope({
			policy: {
				mode: "prefer",
				adapter_id: "agent-browser",
				fallback_allowed: false,
			},
			reports: [makeReport({ adapter_id: "chrome-devtools" })],
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: { "chrome-devtools": true },
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.next_action_id).toBe("prove_adapter_attachment");
		}
	});

	test("force never falls back", () => {
		const envelope = makeValidatedEnvelope({
			policy: { mode: "force", adapter_id: "agent-browser" },
			reports: [
				makeReport({
					adapter_id: "agent-browser",
					capabilities: [
						{
							capability: "snapshot_refs",
							support: "none",
							confidence: 90,
							evidence: { verification_method: "m" },
						},
						{
							capability: "element_actions",
							support: "full",
							confidence: 90,
							evidence: { verification_method: "m" },
						},
						{
							capability: "screenshot_media",
							support: "full",
							confidence: 90,
							evidence: { verification_method: "m" },
						},
					],
				}),
				makeReport({ adapter_id: "chrome-devtools" }),
			],
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: {
					"agent-browser": true,
					"chrome-devtools": true,
				},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("adapter_capability_none");
			// chrome-devtools listed only as informational alternative
			expect(evaluation.informational_alternatives).toContain("chrome-devtools");
		}
	});

	test("partial does not route as success by default", () => {
		const report = makeReport({
			capabilities: [
				{
					capability: "snapshot_refs",
					support: "partial",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
				{
					capability: "element_actions",
					support: "full",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
				{
					capability: "screenshot_media",
					support: "full",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
			],
		});
		const envelope = makeValidatedEnvelope({ reports: [report] });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("adapter_capability_partial");
		}
	});

	test("auto uses task bundle ranking before registry ranking", () => {
		const envelope = makeValidatedEnvelope({
			policy: { mode: "auto" },
			task: {
				bundle: "snapshot_page_action",
				adapter_ranking: ["agent-browser", "chrome-devtools"],
			},
			reports: [
				makeReport({ adapter_id: "chrome-devtools" }),
				makeReport({ adapter_id: "agent-browser" }),
			],
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				warm_chrome_run_id: "warm-1",
				adapter_attached_verified_browser: {
					"chrome-devtools": true,
					"agent-browser": true,
				},
				adapter_proof: {
					"chrome-devtools": {
						adapter_proof_id: "proof-cdp",
						warm_chrome_run_id: "warm-1",
						verified_endpoint_identity: "127.0.0.1:9222",
					},
					"agent-browser": {
						adapter_proof_id: "proof-ab",
						warm_chrome_run_id: "warm-1",
						verified_endpoint_identity: "127.0.0.1:9222",
					},
				},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome === "selected") {
			// task ranking puts agent-browser first despite registry order
			expect(evaluation.selected_adapter).toBe("agent-browser");
			expect(evaluation.ranking[0]?.adapter_id).toBe("agent-browser");
		}
	});

	test("route confidence breaks ties after task and registry priority", () => {
		const lowConfidence = {
			adapter_id: "agent-browser",
			status: "selectable",
			reason: "lower confidence",
			registry_rank: 1,
			route_confidence: 82,
		} as const;
		const highConfidence = {
			adapter_id: "chrome-devtools",
			status: "selectable",
			reason: "higher confidence",
			registry_rank: 1,
			route_confidence: 94,
		} as const;

		const winner = rankSelectableForTest(
			[lowConfidence, highConfidence],
			makeValidatedEnvelope({
				task: { required_capabilities: ["snapshot_refs"] },
			}),
		);

		expect(winner.adapter_id).toBe("chrome-devtools");
	});

	test("auto narrows candidates by required capability before selection", () => {
		const envelope = makeValidatedEnvelope({
			policy: { mode: "auto" },
			task: { required_capabilities: ["console_debug"] },
			reports: [
				makeReport({
					adapter_id: "chrome-devtools",
					capabilities: [
						{
							capability: "snapshot_refs",
							support: "full",
							confidence: 90,
							evidence: { verification_method: "m" },
						},
					],
				}),
				makeReport({
					adapter_id: "agent-browser",
					capabilities: [
						{
							capability: "console_debug",
							support: "full",
							confidence: 90,
							evidence: { verification_method: "m" },
						},
					],
				}),
			],
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: {
					"chrome-devtools": true,
					"agent-browser": true,
				},
			},
		});

		const evaluation = evaluateRoute(envelope, EVAL_DATE);

		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome === "selected") {
			expect(evaluation.selected_adapter).toBe("agent-browser");
			expect(evaluation.candidate_decisions).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						adapter_id: "chrome-devtools",
						status: "rejected",
						code: "adapter_capability_unknown",
					}),
					expect.objectContaining({
						adapter_id: "agent-browser",
						status: "selectable",
					}),
				]),
			);
			expect(evaluation.candidate_decisions[0]).toMatchObject({
				adapter_id: "chrome-devtools",
				status: "rejected",
				code: "adapter_capability_unknown",
			});
		}
	});

	test("explicit required capabilities can narrow a task-facing bundle", () => {
		const required = resolveRequiredCapabilities({
			bundle: "visual_proof_capture",
			required_capabilities: ["console_debug"],
		});
		expect(required).toContain("screenshot_media");
		expect(required).toContain("console_debug");
	});

	test("auto emits ranking evidence", () => {
		const envelope = makeValidatedEnvelope({ policy: { mode: "auto" } });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome === "selected") {
			expect(evaluation.ranking.length).toBeGreaterThan(0);
		}
	});

	test("route success uses use_selected_browser_adapter", async () => {
		const path = await envelopeFile(makeValidatedEnvelope());
		const { stdout } = await runForTest(
			["route", "--envelope", path, "--json"],
			makeRuntime(),
		);
		const envelope = parseJson(stdout);
		expect(
			(envelope.continuation as { next_action_id?: string }).next_action_id,
		).toBe("use_selected_browser_adapter");
		expect(validateRouterContinuationEnvelope(envelope)).toEqual([]);
	});

	test("route success emits constraints for selected adapter validity", async () => {
		const path = await envelopeFile(makeValidatedEnvelope());
		const { stdout } = await runForTest(
			["route", "--envelope", path, "--json"],
			makeRuntime(),
		);
		const envelope = parseJson(stdout);
		const constraints = (
			envelope.continuation as {
				constraints?: { forbidden_action_ids?: string[] }[];
			}
		).constraints;
		expect(constraints?.[0]?.forbidden_action_ids).toContain("adapter_fallback");
		expect(constraints?.[0]?.forbidden_action_ids).toContain(
			"cold_browser_fallback",
		);
	});

	test("route success JSON serializes data.candidate_decisions", async () => {
		const path = await envelopeFile(makeValidatedEnvelope());
		const { stdout } = await runForTest(
			["route", "--envelope", path, "--json"],
			makeRuntime(),
		);
		const envelope = parseJson(stdout);
		const data = envelope.data as { candidate_decisions?: unknown[] };
		expect(data.candidate_decisions?.length).toBe(
			BROWSER_ADAPTER_ROUTER_ADAPTERS.length,
		);
		expect(data.candidate_decisions?.[0]).toMatchObject({
			adapter_id: "chrome-devtools",
			status: "selectable",
		});
	});

	test("route output includes concise candidate decisions", () => {
		const envelope = makeValidatedEnvelope({ policy: { mode: "auto" } });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		if (evaluation.outcome === "selected") {
			expect(evaluation.candidate_decisions.length).toBe(
				BROWSER_ADAPTER_ROUTER_ADAPTERS.length,
			);
		}
	});

	test("full action support with incompatible attachment_model fails closed", () => {
		const report = makeReport({ attachment_model: "unknown" });
		const envelope = makeValidatedEnvelope({ reports: [report] });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("adapter_attachment_incompatible");
		}
	});

	test("allow_degraded does not route in V1", () => {
		const report = makeReport({
			capabilities: [
				{
					capability: "snapshot_refs",
					support: "partial",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
				{
					capability: "element_actions",
					support: "full",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
				{
					capability: "screenshot_media",
					support: "full",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
			],
		});
		const envelope = makeValidatedEnvelope({
			policy: { mode: "auto", allow_degraded: true },
			reports: [report],
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		// allow_degraded is ignored in V1 -> partial still fails closed.
		expect(evaluation.outcome).toBe("fail_closed");
	});
});

// =========================================================================
// U3. Research recovery envelope
// =========================================================================

describe("U3 research recovery", () => {
	test("stale capability emits research_adapter_capability", () => {
		const envelope = makeValidatedEnvelope({
			reports: [
				makeReport({
					provenance: {
						adapter_version: "x@1",
						source_url: "https://example.test/docs",
						checked_at: "2026-01-01",
						verification_method: "m",
						stale_after_days: 30,
					},
				}),
			],
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.next_action_id).toBe("research_adapter_capability");
			expect(evaluation.research).toBeDefined();
			expect(evaluation.research?.retry_posture).toBe("bounded");
			expect(evaluation.research?.terminal_condition.length).toBeGreaterThan(0);
		}
	});

	test("research signal is capped below route threshold", () => {
		const envelope = makeValidatedEnvelope({
			reports: [
				makeReport({
					provenance: {
						adapter_version: "x@1",
						source_url: "https://example.test/docs",
						checked_at: "2026-01-01",
						verification_method: "m",
						stale_after_days: 30,
					},
				}),
			],
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		if (evaluation.outcome === "fail_closed" && evaluation.research) {
			expect(evaluation.research.research_signal).toBeLessThan(75);
		}
	});

	test("route failure emits one canonical continuation.next_action_id", async () => {
		const envelope = makeValidatedEnvelope({
			policy: { mode: "force", adapter_id: "agent-browser" },
			reports: [makeReport({ adapter_id: "agent-browser" })],
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: {},
			},
		});
		const path = await envelopeFile(envelope);
		const { stdout } = await runForTest(
			["route", "--envelope", path, "--json"],
			makeRuntime(),
		);
		const parsed = parseJson(stdout);
		const continuation = parsed.continuation as { next_action_id?: string };
		const actions = parsed.runtime_actions as { id: string }[];
		expect(continuation.next_action_id).toBe("prove_adapter_attachment");
		// exactly one continuation; runtime_actions carries the same id
		expect(actions.map((a) => a.id)).toContain("prove_adapter_attachment");
		expect(parsed.data).toMatchObject({
			failure_kind: "route_failure",
			evaluation_date: EVAL_DATE,
			required_capabilities: ["snapshot_refs", "element_actions", "screenshot_media"],
			routing_started: true,
			candidate_decisions: [
				{
					adapter_id: "agent-browser",
					status: "skipped",
					code: "adapter_attachment_unverified",
				},
			],
			informational_alternatives: [],
		});
		expect(
			validateRouterErrorEnvelope(parsed, { requireRouteValidity: true }),
		).toEqual([]);
	});

	test("research recovery is surfaced through diagnostic_trail", async () => {
		const envelope = makeValidatedEnvelope({
			reports: [
				makeReport({
					provenance: {
						adapter_version: "x@1",
						source_url: "https://example.test/docs",
						checked_at: "2026-01-01",
						verification_method: "m",
						stale_after_days: 30,
					},
				}),
			],
		});
		const path = await envelopeFile(envelope);
		const { stdout } = await runForTest(
			["route", "--envelope", path, "--json"],
			makeRuntime(),
		);
		const parsed = parseJson(stdout);
		expect(
			(parsed.continuation as { next_action_id?: string }).next_action_id,
		).toBe("research_adapter_capability");
		expect(parsed.diagnostic_trail).toMatchObject({
			run_id: parsed.run_id,
			surface: {
				kind: "diagnostic_capability",
				id: "browser-adapter-router.research_adapter_capability",
			},
		});
		expect(parsed.data).toMatchObject({
			failure_kind: "route_failure",
			evaluation_date: EVAL_DATE,
			routing_started: true,
			research: {
				adapter_id: "chrome-devtools",
				capability: "snapshot_refs",
				diagnostic_trail_id:
					"browser-adapter-router.research_adapter_capability",
			},
		});
		expect(validateRouterErrorEnvelope(parsed)).toEqual([]);
	});

	test("invalid route evidence is input failure without route validity", async () => {
		const { stdout } = await runForTest(
			["route", "--json"],
			makeRuntime({ readStdin: async () => "{" }),
		);
		const parsed = parseJson(stdout);
		expect((parsed.error as { code?: string }).code).toBe(
			"route_evidence_invalid",
		);
		expect(
			(parsed.continuation as { constraints?: { id?: string }[] }).constraints,
		).toBeUndefined();
		expect(parsed.data).toBeUndefined();
		expect(validateRouterErrorEnvelope(parsed)).toEqual([]);
	});

	test("missing attachment proof recovery uses prove_adapter_attachment", () => {
		const envelope = makeValidatedEnvelope({
			policy: { mode: "force", adapter_id: "agent-browser" },
			reports: [makeReport({ adapter_id: "agent-browser" })],
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: {},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.next_action_id).toBe("prove_adapter_attachment");
		}
	});

	test("error envelope validates against the facade contract", async () => {
		const envelope = makeValidatedEnvelope({
			reports: [makeReport({ attachment_model: "storage_state_import" })],
		});
		const path = await envelopeFile(envelope);
		const { stdout } = await runForTest(
			["route", "--envelope", path, "--json"],
			makeRuntime(),
		);
		const parsed = parseJson(stdout);
		expect(validateErrorEnvelopeForTest(parsed)).toEqual([]);
	});

	test("recovery metadata owns continuation and recoverability", () => {
		expect(continuationForCode("adapter_attachment_unverified")).toBe(
			"prove_adapter_attachment",
		);
		expect(continuationForCode("adapter_capability_stale")).toBe(
			"research_adapter_capability",
		);
		expect(continuationForCode("adapter_capability_unknown")).toBe(
			"research_adapter_capability",
		);
		expect(continuationForCode("adapter_capability_partial")).toBe(
			"change_route_input",
		);
		expect(continuationForCode("auth_session_unverified")).toBe(
			"verify_auth_session",
		);
		expect(continuationForCode("target_origin_unverified")).toBe(
			"verify_target_origin",
		);
		expect(recoverabilityForCode("auth_session_unverified")).toBe(
			"authenticate",
		);
	});

	test("runtime action lookup projects declared Router actions", () => {
		const action = runtimeActionForId("use_selected_browser_adapter");
		expect(action.id).toBe("use_selected_browser_adapter");
		expect(action.summary.length).toBeGreaterThan(0);
		expect(action.side_effects).toEqual(["check"]);
		expect(runtimeActionForId("verify_auth_session").id).toBe(
			"verify_auth_session",
		);
		expect(runtimeActionForId("verify_target_origin").id).toBe(
			"verify_target_origin",
		);
	});

	test("report failure validates through Router recovery helper", async () => {
		const { stdout } = await runForTest(
			["report", "--adapter", "chrome-devtools", "--json"],
			makeRuntime({ evaluationDate: "2027-01-01" }),
		);
		const parsed = parseJson(stdout);
		expect(validateRouterErrorEnvelope(parsed)).toEqual([]);
		expect(
			(parsed.continuation as { next_action_id?: string }).next_action_id,
		).toBe("research_adapter_capability");
		expect(
			(parsed.continuation as { constraints?: { id?: string }[] }).constraints,
		).toBeUndefined();
		expect(parsed.diagnostic_trail).toMatchObject({
			run_id: parsed.run_id,
			surface: {
				kind: "diagnostic_capability",
				id: "browser-adapter-router.research_adapter_capability",
			},
		});
	});

	test("diagnostic codes are the package-owned vocabulary", () => {
		expect(BROWSER_ADAPTER_ROUTER_DIAGNOSTIC_CODES).toContain(
			"adapter_capability_stale",
		);
		expect(BROWSER_ADAPTER_ROUTER_DIAGNOSTIC_CODES).toContain(
			"adapter_attachment_incompatible",
		);
	});
});

// =========================================================================
// U5. Precondition and media-proof guardrails
// =========================================================================

describe("U5 precondition guardrails", () => {
	test("auth/session precondition requires target origin and verified profile identity", () => {
		const envelope = makeValidatedEnvelope({
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: { "chrome-devtools": true },
				auth_session: { required: true },
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("auth_session_unverified");
		}
	});

	test("auth/session precondition passes with full evidence", () => {
		const envelope = makeValidatedEnvelope({
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: { "chrome-devtools": true },
				auth_session: {
					required: true,
					target_origin: "https://app.test",
					verified_profile_identity: "profile-A",
					account_session_match: true,
				},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("selected");
	});

	test("declared target page/origin precondition requires matching evidence", () => {
		const envelope = makeValidatedEnvelope({
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: { "chrome-devtools": true },
				target_origin: {
					required: true,
					expected: "https://app.test",
					observed: "https://evil.test",
				},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("target_origin_unverified");
		}
	});

	test("missing auth/session precondition fails before adapter routing", () => {
		const envelope = makeValidatedEnvelope({
			policy: { mode: "auto" },
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: { "chrome-devtools": true },
				auth_session: {
					required: true,
					target_origin: "https://app.test",
					// missing verified_profile_identity
				},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			// failed before producing candidate decisions
			expect(evaluation.candidate_decisions.length).toBe(0);
		}
	});

	test("warm chrome not ready fails closed before routing", () => {
		const envelope = makeValidatedEnvelope({
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: false,
				adapter_attached_verified_browser: { "chrome-devtools": true },
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.next_action_id).toBe("prove_adapter_attachment");
		}
	});
});

describe("U5 media proof guardrails", () => {
	test("screenshot/media proof emits run-scoped artifact handling metadata", () => {
		const envelope = makeValidatedEnvelope({
			task: {
				bundle: "visual_proof_capture",
				media_proof: {
					requested: true,
					run_scoped_path: "runs/run-1/proof.png",
				},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome === "selected") {
			expect(evaluation.media_proof?.retention).toBe("per_run");
			expect(evaluation.media_proof?.owner).toBe("browser-use");
			expect(evaluation.media_proof?.run_scoped_path).toBe(
				"runs/run-1/proof.png",
			);
		}
	});

	test("proof artifacts are not written into diagnostic logs (stderr)", async () => {
		const envelope = makeValidatedEnvelope({
			task: {
				bundle: "visual_proof_capture",
				media_proof: {
					requested: true,
					run_scoped_path: "runs/run-1/proof.png",
				},
			},
		});
		const path = await envelopeFile(envelope);
		const { stderr } = await runForTest(
			["route", "--envelope", path, "--json"],
			makeRuntime(),
		);
		expect(stderr).not.toContain("proof.png");
	});

	test("media proof owner is browser-use, adapter cannot override", () => {
		const envelope = makeValidatedEnvelope({
			task: {
				bundle: "visual_proof_capture",
				media_proof: { requested: true, run_scoped_path: "runs/x.png" },
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		if (evaluation.outcome === "selected") {
			expect(evaluation.media_proof?.owner).toBe("browser-use");
		}
	});
});

// =========================================================================
// Cross-cutting safety
// =========================================================================

describe("safety", () => {
	test("usage errors redact filesystem-looking values", async () => {
		const { stdout } = await runForTest(
			[
				"report",
				"--adapter",
				"chrome-devtools",
				"--capability",
				"/tmp/router-secret.json",
				"--json",
			],
			makeRuntime(),
		);
		expect(stdout).not.toContain("/tmp/router-secret.json");
		expect(stdout).toContain("[redacted]");
	});

	test("all capability names are known vocabulary", () => {
		for (const cap of BROWSER_ADAPTER_ROUTER_CAPABILITIES) {
			expect(typeof cap).toBe("string");
		}
		expect(BROWSER_ADAPTER_ROUTER_CAPABILITIES).toContain("memory_debug");
		expect(BROWSER_ADAPTER_ROUTER_CAPABILITIES).toContain(
			"devtools_performance_insight",
		);
	});
});

// =========================================================================
// Review-driven hardening (code-review findings)
// =========================================================================

describe("hardening: duplicate-capability forgery (adversarial P0)", () => {
	test("validator rejects a report with duplicate capability keys", () => {
		const forged: unknown = {
			...makeReport(),
			capabilities: [
				{
					capability: "snapshot_refs",
					support: "partial",
					confidence: 60,
					evidence: { verification_method: "m" },
				},
				{
					capability: "snapshot_refs",
					support: "full",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
			],
		};
		const result = validateCapabilityReport(forged);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.diagnostics.some((d) => d.includes("duplicate"))).toBe(true);
		}
	});

	test("a forged duplicate cannot route as selected", () => {
		const forgedReport = {
			...makeReport(),
			capabilities: [
				{
					capability: "snapshot_refs",
					support: "none",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
				{
					capability: "snapshot_refs",
					support: "full",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
				{
					capability: "element_actions",
					support: "full",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
				{
					capability: "screenshot_media",
					support: "full",
					confidence: 90,
					evidence: { verification_method: "m" },
				},
			],
		};
		const envelope = {
			...makeEnvelope(),
			reports: [forgedReport as unknown as CapabilityReport],
		};
		// Routed through the CLI so the envelope passes through the report validator.
		expect(() => parseEvidenceEnvelope(JSON.stringify(envelope))).toThrow();
	});
});

describe("hardening: invalid envelope fields fail closed (correctness P1/P2)", () => {
	test("unknown task.bundle fails closed instead of crashing", () => {
		const envelope = { ...makeEnvelope(), task: { bundle: "bogus_bundle" } };
		expect(() => parseEvidenceEnvelope(JSON.stringify(envelope))).toThrow(
			/bundle/,
		);
	});

	test("unknown required_capability fails closed", () => {
		const envelope = {
			...makeEnvelope(),
			task: { required_capabilities: ["not_a_capability"] },
		};
		expect(() => parseEvidenceEnvelope(JSON.stringify(envelope))).toThrow(
			/required_capabilities/,
		);
	});

	test("invalid policy.adapter_id fails closed", () => {
		const envelope = {
			...makeEnvelope(),
			policy: { mode: "force", adapter_id: "selenium" },
		};
		expect(() => parseEvidenceEnvelope(JSON.stringify(envelope))).toThrow(
			/adapter_id/,
		);
	});

	test("force mode without adapter_id fails closed", () => {
		const envelope = { ...makeEnvelope(), policy: { mode: "force" } };
		expect(() => parseEvidenceEnvelope(JSON.stringify(envelope))).toThrow(
			/force/,
		);
	});

	test("prefer mode without adapter_id fails closed", () => {
		const envelope = { ...makeEnvelope(), policy: { mode: "prefer" } };
		expect(() => parseEvidenceEnvelope(JSON.stringify(envelope))).toThrow(
			/force\/prefer/,
		);
	});

	test("unknown task adapter ranking fails closed", () => {
		const envelope = {
			...makeEnvelope(),
			task: { adapter_ranking: ["selenium"] },
		};
		expect(() => parseEvidenceEnvelope(JSON.stringify(envelope))).toThrow(
			/adapter_ranking/,
		);
	});

	test("invalid media proof shape fails closed", () => {
		const envelope = {
			...makeEnvelope(),
			task: { media_proof: { requested: true, run_scoped_path: "" } },
		};
		expect(() => parseEvidenceEnvelope(JSON.stringify(envelope))).toThrow(
			/media_proof/,
		);
	});
});

describe("hardening: freshness fail-closed (adversarial)", () => {
	test("future-dated checked_at is treated as stale", () => {
		const future = {
			adapter_version: "",
			source_url: "",
			verification_method: "",
			checked_at: "2099-01-01",
			stale_after_days: 30,
		};
		expect(isReportStale(future, EVAL_DATE)).toBe(true);
	});

	test("malformed checked_at date is treated as stale", () => {
		const malformed = {
			adapter_version: "",
			source_url: "",
			verification_method: "",
			checked_at: "not-a-date",
			stale_after_days: 30,
		};
		expect(isReportStale(malformed, EVAL_DATE)).toBe(true);
	});

	test("exact-boundary age (age === stale_after_days) is still fresh", () => {
		const boundary = {
			adapter_version: "",
			source_url: "",
			verification_method: "",
			checked_at: "2026-05-11",
			stale_after_days: 30,
		};
		// 2026-05-11 -> 2026-06-10 is exactly 30 days.
		expect(isReportStale(boundary, "2026-06-10")).toBe(false);
	});
});

describe("hardening: report CLI success path + reliability", () => {
	test("report --json success path emits ok envelope end-to-end", async () => {
		const { exitCode, stdout } = await runForTest(
			["report", "--adapter", "chrome-devtools", "--json"],
			makeRuntime({ evaluationDate: "2026-06-02" }),
		);
		expect(exitCode).toBe(0);
		expect(parseJson(stdout).status).toBe("ok");
	});

	test("report --plain success path emits report_found", async () => {
		const { exitCode, stdout } = await runForTest(
			["report", "--adapter", "chrome-devtools", "--plain"],
			makeRuntime({ evaluationDate: "2026-06-02" }),
		);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("report_found");
	});

	test("report rejects an unknown flag", async () => {
		const { exitCode } = await runForTest(
			["report", "--adapter", "chrome-devtools", "--envelope", "x.json"],
			makeRuntime(),
		);
		expect(exitCode).not.toBe(0);
	});

	test("missing --envelope file fails closed with route_evidence_invalid", async () => {
		const { exitCode, stdout } = await runForTest(
			["route", "--envelope", "/tmp/definitely-not-here-bar.json", "--json"],
			makeRuntime(),
		);
		expect(exitCode).toBe(20);
		const parsed = parseJson(stdout);
		expect(
			(parsed.error as { code?: string }).code,
		).toBe("route_evidence_invalid");
	});

	test("unreadable route evidence is input failure without route validity", async () => {
		const { stdout } = await runForTest(
			["route", "--envelope", "/tmp/definitely-not-here-bar.json", "--json"],
			makeRuntime(),
		);
		const parsed = parseJson(stdout);
		const constraints = (
			parsed.continuation as {
				constraints?: { forbidden_action_ids?: string[] }[];
			}
		).constraints;
		expect((parsed.error as { code?: string }).code).toBe(
			"route_evidence_invalid",
		);
		expect(constraints).toBeUndefined();
		expect(validateRouterErrorEnvelope(parsed)).toEqual([]);
	});

	test("every CLI error envelope carries a continuation", async () => {
		const { stdout } = await runForTest(
			["bogus-command", "--json"],
			makeRuntime(),
		);
		const parsed = parseJson(stdout);
		expect(parsed.continuation).toBeDefined();
	});

	test("self-report env override JSON success routes through the validator", async () => {
		const selfReport = JSON.stringify(makeReport({ adapter_id: "agent-browser" }));
		const { exitCode, stdout } = await runForTest(
			["report", "--adapter", "agent-browser", "--json"],
			makeRuntime({
				evaluationDate: "2026-06-08",
				env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: selfReport },
			}),
		);
		expect(exitCode).toBe(0);
		const data = parseJson(stdout).data as { report_source?: string };
		expect(data.report_source).toBe("self_report");
	});

	test("stale self-report fails closed instead of falling back to manifest", async () => {
		const selfReport = JSON.stringify(
			makeReport({
				adapter_id: "agent-browser",
				provenance: {
					adapter_version: "x@1",
					source_url: "https://example.test/docs",
					checked_at: "2026-01-01",
					verification_method: "maintainer_verified_manifest",
					stale_after_days: 30,
				},
			}),
		);
		const { exitCode, stdout } = await runForTest(
			["report", "--adapter", "agent-browser", "--json"],
			makeRuntime({
				env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: selfReport },
			}),
		);
		expect(exitCode).toBe(20);
		expect((parseJson(stdout).error as { code?: string }).code).toBe(
			"adapter_capability_stale",
		);
	});

	test("invalid self-report validation fails closed", async () => {
		const selfReport = JSON.stringify({
			...makeReport({ adapter_id: "agent-browser" }),
			validation: "invalid",
		});
		const { exitCode, stdout } = await runForTest(
			["report", "--adapter", "agent-browser", "--json"],
			makeRuntime({
				env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: selfReport },
			}),
		);
		expect(exitCode).toBe(20);
		expect((parseJson(stdout).error as { code?: string }).code).toBe(
			"adapter_capability_unknown",
		);
	});

	test("report --capability fails when the current report lacks that capability", async () => {
		const selfReport = makeReport({
			adapter_id: "agent-browser",
			capabilities: makeReport().capabilities.filter(
				(entry) => entry.capability !== "react_vitals",
			),
		});
		const { exitCode, stdout } = await runForTest(
			[
				"report",
				"--adapter",
				"agent-browser",
				"--capability",
				"react_vitals",
				"--json",
			],
			makeRuntime({
				env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: JSON.stringify(selfReport) },
			}),
		);
		expect(exitCode).toBe(20);
		expect((parseJson(stdout).error as { code?: string }).code).toBe(
			"adapter_capability_unknown",
		);
	});
});

describe("hardening: auth precondition coverage (U5)", () => {
	test("auth required with account_session_match false fails closed", () => {
		const envelope = makeValidatedEnvelope({
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: { "chrome-devtools": true },
				auth_session: {
					required: true,
					target_origin: "https://app.test",
					verified_profile_identity: "profile-A",
					account_session_match: false,
				},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("auth_session_unverified");
		}
	});

	test("auth required without explicit account_session_match fails closed", () => {
		const envelope = makeValidatedEnvelope({
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: { "chrome-devtools": true },
				auth_session: {
					required: true,
					target_origin: "https://app.test",
					verified_profile_identity: "profile-A",
				},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("auth_session_unverified");
		}
	});

	test("auth required:false skips the gate", () => {
		const envelope = makeValidatedEnvelope({
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: { "chrome-devtools": true },
				auth_session: { required: false },
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("selected");
	});
});

describe("hardening: empty required capabilities", () => {
	test("no bundle and no required_capabilities still requires attachment + report", () => {
		const envelope = makeValidatedEnvelope({ task: {} });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome === "selected") {
			expect(evaluation.route_confidence).toBe(100);
		}
	});

	test("empty task still fails closed without attachment proof", () => {
		const envelope = makeValidatedEnvelope({
			task: {},
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				adapter_attached_verified_browser: {},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
	});
});

// Plan U2 (Route And Proof Binding Metadata). These tests pin the binding
// tuple slice owned by route success + the viewport-emulation capability before
// any target/operation work ships. Target/operation binding fields
// (target_envelope_id, target_candidate_id, operation_intent) belong to U5-U7.
describe("U2 route/proof binding metadata", () => {
	function makeBoundEnvelope(
		overrides: Partial<RouteEvidenceEnvelope> = {},
	): RouteEvidenceEnvelope {
		return makeEnvelope({
			preconditions: {
				run_id: "run-1",
				freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
				warm_chrome_ready: true,
				warm_chrome_run_id: "warm-1",
				adapter_attached_verified_browser: { "chrome-devtools": true },
				adapter_proof: {
					"chrome-devtools": {
						adapter_proof_id: "proof-abc",
						warm_chrome_run_id: "warm-1",
						verified_endpoint_identity: "127.0.0.1:9222",
					},
				},
			},
			...overrides,
		});
	}

	// Narrow a route evaluation to a defined binding; fails the test loudly if
	// the route did not select or carries no binding.
	function expectBinding(
		evaluation: ReturnType<typeof evaluateRoute>,
	): NonNullable<
		Extract<typeof evaluation, { outcome: "selected" }>["binding"]
	> {
		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome !== "selected") {
			throw new Error("expected selected route");
		}
		expect(evaluation.binding).toBeDefined();
		if (!evaluation.binding) {
			throw new Error("expected route binding");
		}
		return evaluation.binding;
	}

	test("route success exposes the route/proof binding tuple slice", () => {
		const evaluation = evaluateRoute(
			parseEvidenceEnvelope(JSON.stringify(makeBoundEnvelope())),
			EVAL_DATE,
		);
		const binding = expectBinding(evaluation);
		expect(binding.run_id).toBe("run-1");
		expect(binding.selected_adapter_id).toBe("chrome-devtools");
		expect(binding.warm_chrome_run_id).toBe("warm-1");
		expect(binding.adapter_proof_id).toBe("proof-abc");
		expect(typeof binding.route_evidence_hash).toBe("string");
		expect(binding.route_evidence_hash.length).toBeGreaterThan(0);
		expect(binding.emitted_at).toBe(EVAL_DATE);
		// expires_at derives from precondition freshness, not a wall clock.
		expect(binding.expires_at).toBe("2026-07-08");
	});

	test("route_evidence_hash is stable for identical evidence", () => {
		const a = evaluateRoute(
			parseEvidenceEnvelope(JSON.stringify(makeBoundEnvelope())),
			EVAL_DATE,
		);
		const b = evaluateRoute(
			parseEvidenceEnvelope(JSON.stringify(makeBoundEnvelope())),
			EVAL_DATE,
		);
		const bindingA = expectBinding(a);
		const bindingB = expectBinding(b);
		expect(bindingA.route_evidence_hash).toBe(bindingB.route_evidence_hash);
	});

	test("command contract exposes the viewport_emulation capability", () => {
		expect(BROWSER_ADAPTER_ROUTER_CAPABILITIES).toContain("viewport_emulation");
	});

	test("route authorizes only capabilities present in route evidence", () => {
		const evaluation = evaluateRoute(
			parseEvidenceEnvelope(
				JSON.stringify(
					makeBoundEnvelope({
						task: { required_capabilities: ["snapshot_refs"] },
					}),
				),
			),
			EVAL_DATE,
		);
		const binding = expectBinding(evaluation);
		expect(binding.authorized_capabilities).toEqual(["snapshot_refs"]);
		expect(binding.authorized_capabilities).not.toContain("screenshot_media");
	});

	test("operation capability mapping fails closed when capability not routed", () => {
		const evaluation = evaluateRoute(
			parseEvidenceEnvelope(
				JSON.stringify(
					makeBoundEnvelope({
						task: { required_capabilities: ["snapshot_refs"] },
					}),
				),
			),
			EVAL_DATE,
		);
		const binding = expectBinding(evaluation);
		// snapshot routed -> authorized; screenshot + emulate not routed -> closed.
		expect(authorizesOperationClass(binding, "snapshot")).toBe(true);
		expect(authorizesOperationClass(binding, "screenshot")).toBe(false);
		expect(authorizesOperationClass(binding, "emulate")).toBe(false);
	});

	test("emulate authorizes only when viewport_emulation is routed", () => {
		const evaluation = evaluateRoute(
			parseEvidenceEnvelope(
				JSON.stringify(
					makeBoundEnvelope({
						task: { required_capabilities: ["viewport_emulation"] },
						reports: [
							makeReport({
								capabilities: [
									{
										capability: "viewport_emulation",
										support: "full",
										confidence: 90,
										evidence: {
											verification_method: "maintainer_verified_manifest",
										},
									},
								],
							}),
						],
					}),
				),
			),
			EVAL_DATE,
		);
		const binding = expectBinding(evaluation);
		expect(authorizesOperationClass(binding, "emulate")).toBe(true);
		expect(authorizesOperationClass(binding, "snapshot")).toBe(false);
	});

	test("route validation rejects mismatched binding proof evidence", () => {
		// Precondition proof claims a different selected adapter than was attached:
		// run-scoped proof id present for an adapter with no attachment verification.
		const evaluation = evaluateRoute(
			parseEvidenceEnvelope(
				JSON.stringify(
					makeBoundEnvelope({
						preconditions: {
							run_id: "run-1",
							freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
							warm_chrome_ready: true,
							warm_chrome_run_id: "warm-1",
							adapter_attached_verified_browser: { "chrome-devtools": true },
							adapter_proof: {
								"chrome-devtools": {
									adapter_proof_id: "proof-abc",
									// Mismatched warm chrome run id vs the run-scoped session.
									warm_chrome_run_id: "warm-OTHER-RUN",
									verified_endpoint_identity: "127.0.0.1:9222",
								},
							},
						},
					}),
				),
			),
			EVAL_DATE,
		);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome !== "fail_closed") return;
		expect(evaluation.code).toBe("route_evidence_binding_mismatch");
		// Binding mismatch always recovers by re-proving the adapter, the same
		// canonical continuation the buildSuccess absent-proof path resolves to.
		expect(evaluation.next_action_id).toBe("prove_adapter_attachment");
	});

	test("cross-run proof fails closed even when run-scoped warm_chrome_run_id is omitted", () => {
		// Bypass guard (U2 R9): omitting pre.warm_chrome_run_id must not skip the
		// cross-run check. Two proofs binding to different warm-Chrome runs fail
		// closed via the first-proof anchor.
		const evaluation = evaluateRoute(
			parseEvidenceEnvelope(
				JSON.stringify(
					makeBoundEnvelope({
						task: {
							required_capabilities: ["snapshot_refs"],
							adapter_ranking: ["chrome-devtools", "agent-browser"],
						},
						reports: [
							makeReport({ adapter_id: "chrome-devtools" }),
							makeReport({ adapter_id: "agent-browser" }),
						],
						preconditions: {
							run_id: "run-1",
							freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
							warm_chrome_ready: true,
							// No run-scoped warm_chrome_run_id supplied.
							adapter_attached_verified_browser: {
								"chrome-devtools": true,
								"agent-browser": true,
							},
							adapter_proof: {
								"chrome-devtools": {
									adapter_proof_id: "proof-cdp",
									warm_chrome_run_id: "warm-1",
									verified_endpoint_identity: "127.0.0.1:9222",
								},
								"agent-browser": {
									adapter_proof_id: "proof-ab",
									// Foreign warm-Chrome run — must be rejected against the anchor.
									warm_chrome_run_id: "warm-FOREIGN",
									verified_endpoint_identity: "127.0.0.1:9222",
								},
							},
						},
					}),
				),
			),
			EVAL_DATE,
		);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome !== "fail_closed") return;
		expect(evaluation.code).toBe("route_evidence_binding_mismatch");
		expect(evaluation.next_action_id).toBe("prove_adapter_attachment");
	});

	test("operation-capable route selected without any proof fails closed", () => {
		// buildSuccess gate (U2 R9, R12): an operation-capable route whose selected
		// adapter has no proof entry fails closed before returning success.
		const evaluation = evaluateRoute(
			parseEvidenceEnvelope(
				JSON.stringify(
					makeBoundEnvelope({
						task: { required_capabilities: ["snapshot_refs"] },
						preconditions: {
							run_id: "run-1",
							freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
							warm_chrome_ready: true,
							adapter_attached_verified_browser: { "chrome-devtools": true },
							// No proof entry for the selected adapter.
							adapter_proof: {},
						},
					}),
				),
			),
			EVAL_DATE,
		);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome !== "fail_closed") return;
		expect(evaluation.code).toBe("route_evidence_binding_mismatch");
		expect(evaluation.next_action_id).toBe("prove_adapter_attachment");
	});

	test("proof with missing binding identity fields fails closed", () => {
		const evaluation = evaluateRoute(
			parseEvidenceEnvelope(
				JSON.stringify(
					makeBoundEnvelope({
						task: { required_capabilities: ["snapshot_refs"] },
						preconditions: {
							run_id: "run-1",
							freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
							warm_chrome_ready: true,
							warm_chrome_run_id: "warm-1",
							adapter_attached_verified_browser: { "chrome-devtools": true },
							adapter_proof: {
								"chrome-devtools": {
									adapter_proof_id: "proof-abc",
									warm_chrome_run_id: "warm-1",
									// Empty verified endpoint identity.
									verified_endpoint_identity: "",
								},
							},
						},
					}),
				),
			),
			EVAL_DATE,
		);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome !== "fail_closed") return;
		expect(evaluation.code).toBe("route_evidence_binding_mismatch");
	});

	test("non-operation route selects without a binding tuple", () => {
		// A pure capability-discovery route (no operation capability) carries no
		// proof binding; binding must be absent, not fabricated.
		const evaluation = evaluateRoute(
			parseEvidenceEnvelope(
				JSON.stringify(
					makeBoundEnvelope({
						task: { required_capabilities: ["console_debug"] },
						reports: [
							makeReport({
								capabilities: [
									{
										capability: "console_debug",
										support: "full",
										confidence: 90,
										evidence: {
											verification_method: "maintainer_verified_manifest",
										},
									},
								],
							}),
						],
						preconditions: {
							run_id: "run-1",
							freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
							warm_chrome_ready: true,
							adapter_attached_verified_browser: { "chrome-devtools": true },
							// No proof binding needed for a non-operation route.
							adapter_proof: {},
						},
					}),
				),
			),
			EVAL_DATE,
		);
		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome !== "selected") return;
		expect(evaluation.binding).toBeUndefined();
	});
});
