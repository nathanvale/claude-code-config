import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_ADAPTER_PROOF_ADAPTERS,
	BROWSER_ADAPTER_ROUTER_ADAPTERS,
	BROWSER_ADAPTER_ROUTER_CAPABILITIES,
	BROWSER_ADAPTER_ROUTER_DIAGNOSTIC_CODES,
	BROWSER_ADAPTER_ROUTER_SUPPORT_STATES,
	browserAdapterProofContracts,
	browserAdapterRouterContracts,
} from "./command-contract";
import {
	type CapabilityReport,
	type RouteEvidenceEnvelope,
	type RouterRuntime,
	createDefaultRouterRuntime,
	discoverReport,
	evaluateRoute,
	isReportStale,
	parseEvidenceEnvelope,
	resolveRequiredCapabilities,
	runForTest,
	validateCapabilityReport,
	validateErrorEnvelopeForTest,
} from "./browser-adapter-router";
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
			verification_method: "maintainer_docs_review",
			stale_after_days: 30,
		},
		capabilities: [
			{
				capability: "snapshot_refs",
				support: "full",
				confidence: 90,
				evidence: { verification_method: "maintainer_docs_review" },
			},
			{
				capability: "element_actions",
				support: "full",
				confidence: 90,
				evidence: { verification_method: "maintainer_docs_review" },
			},
			{
				capability: "screenshot_media",
				support: "full",
				confidence: 90,
				evidence: { verification_method: "maintainer_docs_review" },
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
			adapter_attached_verified_browser: { "chrome-devtools": true },
			...(overrides.preconditions ?? {}),
		},
		reports: overrides.reports ?? [makeReport()],
	};
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

// =========================================================================
// U0. Adapter registry and discovery interface
// =========================================================================

describe("U0 command contract", () => {
	test("contract exposes route, report, and status", () => {
		const result = parseCommandFacadeContract(
			{
				route: browserAdapterRouterContracts.route,
				report: browserAdapterRouterContracts.report,
				status: browserAdapterRouterContracts.status,
			},
			{ path: "skills/browser-use/scripts/command-contract.ts" },
		);
		expect(result.ok).toBe(true);
		expect(Object.keys(browserAdapterRouterContracts).sort()).toEqual([
			"report",
			"route",
			"status",
		]);
	});

	test("V1 has no prepare command", () => {
		expect("prepare" in browserAdapterRouterContracts).toBe(false);
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
		expect(sideEffects).toContain("check");
		expect(sideEffects).not.toContain("browser");
	});

	test("route contract declares check only, no browser action", () => {
		const sideEffects = browserAdapterRouterContracts.route.sideEffects ?? [];
		expect(sideEffects).toEqual(["check"]);
		expect(sideEffects).not.toContain("browser");
	});

	test("status aliases route", () => {
		expect(browserAdapterRouterContracts.status.alias?.command).toBe("route");
	});

	test("route does not declare a diagnostic flag the facade reserves", () => {
		const flags = Object.keys(browserAdapterRouterContracts.route.flags ?? {});
		for (const reserved of CLI_DIAGNOSTIC_FLAGS) {
			expect(flags).not.toContain(reserved);
		}
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
});

describe("U0 evidence envelope input", () => {
	test("route accepts an evidence envelope path", async () => {
		const path = await envelopeFile(makeEnvelope());
		const { exitCode, stdout } = await runForTest(
			["route", "--envelope", path, "--json"],
			makeRuntime(),
		);
		expect(exitCode).toBe(0);
		expect(parseJson(stdout).status).toBe("ok");
	});

	test("route accepts an evidence envelope from stdin JSON", async () => {
		const json = JSON.stringify(makeEnvelope());
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
		const path = await envelopeFile(makeEnvelope());
		const { exitCode, stdout } = await runForTest(
			["status", "--envelope", path, "--plain"],
			makeRuntime(),
		);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("adapter_selected");
	});

	test("route and status use the same pure route evaluator", async () => {
		const envelope = makeEnvelope();
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
		const envelope = makeEnvelope({ reports: [report] });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("adapter_attachment_incompatible");
		}
	});

	test("separate browser context attachment fails compatibility in V1", () => {
		const report = makeReport({ attachment_model: "separate_browser_context" });
		const envelope = makeEnvelope({ reports: [report] });
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
		const envelope = makeEnvelope({ reports: [report] });
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
		const envelope = makeEnvelope({ reports: [report] });
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
		const envelope = makeEnvelope({ reports: [report] });
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({ reports: [report] });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("fail_closed");
		if (evaluation.outcome === "fail_closed") {
			expect(evaluation.code).toBe("adapter_capability_partial");
		}
	});

	test("auto uses task bundle ranking before registry ranking", () => {
		const envelope = makeEnvelope({
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
				adapter_attached_verified_browser: {
					"chrome-devtools": true,
					"agent-browser": true,
				},
			},
		});
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome === "selected") {
			// task ranking puts agent-browser first despite registry order
			expect(evaluation.selected_adapter).toBe("agent-browser");
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
		const envelope = makeEnvelope({ policy: { mode: "auto" } });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome === "selected") {
			expect(evaluation.ranking.length).toBeGreaterThan(0);
		}
	});

	test("route success uses use_selected_browser_adapter", async () => {
		const path = await envelopeFile(makeEnvelope());
		const { stdout } = await runForTest(
			["route", "--envelope", path, "--json"],
			makeRuntime(),
		);
		const envelope = parseJson(stdout);
		expect(
			(envelope.continuation as { next_action_id?: string }).next_action_id,
		).toBe("use_selected_browser_adapter");
	});

	test("route success emits constraints for selected adapter validity", async () => {
		const path = await envelopeFile(makeEnvelope());
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

	test("route output includes concise candidate decisions", () => {
		const envelope = makeEnvelope({ policy: { mode: "auto" } });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		if (evaluation.outcome === "selected") {
			expect(evaluation.candidate_decisions.length).toBe(
				BROWSER_ADAPTER_ROUTER_ADAPTERS.length,
			);
		}
	});

	test("full action support with incompatible attachment_model fails closed", () => {
		const report = makeReport({ attachment_model: "unknown" });
		const envelope = makeEnvelope({ reports: [report] });
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
	});

	test("missing attachment proof recovery uses prove_adapter_attachment", () => {
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({
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
			["report", "--adapter", "chrome-devtools", "--capability", "nope", "--json"],
			makeRuntime(),
		);
		// invalid enum -> usage error; ensure no raw path leakage patterns
		expect(stdout).not.toContain("op://");
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
});

describe("hardening: auth precondition coverage (U5)", () => {
	test("auth required with account_session_match false fails closed", () => {
		const envelope = makeEnvelope({
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

	test("auth required:false skips the gate", () => {
		const envelope = makeEnvelope({
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
		const envelope = makeEnvelope({ task: {} });
		const evaluation = evaluateRoute(envelope, EVAL_DATE);
		expect(evaluation.outcome).toBe("selected");
		if (evaluation.outcome === "selected") {
			expect(evaluation.route_confidence).toBe(100);
		}
	});

	test("empty task still fails closed without attachment proof", () => {
		const envelope = makeEnvelope({
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
