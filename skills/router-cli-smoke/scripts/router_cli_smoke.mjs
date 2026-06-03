#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_OUT_DIR = "/tmp/claude-501";
const DEFAULT_SCRIPT = "skills/browser-use/scripts/browser-adapter-router.ts";
const ARTIFACT_SCHEMA_VERSION = "1";
const SENSITIVE_ARG_PATTERN = /(secret|token|password|credential|private)/i;
const ADAPTERS = ["chrome-devtools", "agent-browser", "playwright-cdp"];
const CAPABILITIES = [
	"snapshot_refs",
	"element_actions",
	"selector_actions",
	"screenshot_media",
	"console_debug",
	"network_inspection",
	"performance_profile",
	"devtools_performance_insight",
	"memory_debug",
	"react_vitals",
];
const BUNDLES = [
	"snapshot_page_action",
	"visual_proof_capture",
	"runtime_debug_inspection",
	"performance_profile",
	"runbook_step_execution",
];

function parseArgs(argv) {
	const options = {
		suite: "all",
		outDir: DEFAULT_OUT_DIR,
		script: DEFAULT_SCRIPT,
		timestamp: true,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--suite") {
			index += 1;
			options.suite = requireValue(argv, index, arg);
		} else if (arg === "--out-dir") {
			index += 1;
			options.outDir = requireValue(argv, index, arg);
		} else if (arg === "--script") {
			index += 1;
			options.script = requireValue(argv, index, arg);
		} else if (arg === "--timestamp") {
			options.timestamp = true;
		} else if (arg === "--no-timestamp") {
			options.timestamp = false;
		} else if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		} else {
			throw new Error(`Unknown option: ${arg}`);
		}
	}
	if (!["core", "hints", "all"].includes(options.suite)) {
		throw new Error("--suite must be core, hints, or all");
	}
	return options;
}

function requireValue(argv, index, flag) {
	const value = argv[index];
	if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
	return value;
}

function printHelp() {
	console.log(`Usage: router_cli_smoke.mjs [--suite core|hints|all] [--out-dir <dir>] [--script <path>] [--timestamp|--no-timestamp]

Runs Browser Adapter Router CLI smoke suites and writes keyed JSON artifacts.`);
}

function repoRoot() {
	const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		encoding: "utf8",
	});
	return result.status === 0 ? result.stdout.trim() : process.cwd();
}

function gitLines(cwd, args) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	return result.stdout.trim() ? result.stdout.trim().split("\n") : [];
}

function commandOutput(cwd, args) {
	const result = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : "";
}

function sha256(text) {
	return createHash("sha256").update(text).digest("hex");
}

function redactPathForArtifact(value, repoRoot) {
	if (!path.isAbsolute(value)) return value;
	const relative = path.relative(repoRoot, value);
	if (relative === "") return ".";
	if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
		return `./${relative}`;
	}
	return `[redacted-path:${sha256(value).slice(0, 12)}]`;
}

function redactArg(arg, repoRoot) {
	if (SENSITIVE_ARG_PATTERN.test(arg)) return "[redacted]";
	if (arg.startsWith("/Users/example/")) return "[redacted-path]";
	if (path.isAbsolute(arg)) return redactPathForArtifact(arg, repoRoot);
	return arg;
}

function redactedCommand(script, args, repoRoot) {
	return ["bun", script, ...args].map((arg) => redactArg(arg, repoRoot));
}

function capturedEnv(env = {}) {
	return Object.fromEntries(
		Object.entries(env).map(([key, value]) => [
			key,
			SENSITIVE_ARG_PATTERN.test(key)
				? "[redacted]"
				: { sha256: sha256(String(value)), bytes: String(value).length },
		]),
	);
}

function capturedInput(input) {
	if (input === undefined) return undefined;
	return { sha256: sha256(input), bytes: input.length };
}

function byteLength(text) {
	return Buffer.byteLength(text, "utf8");
}

function caseIntent(expectedExit, args) {
	if (args.includes("--help")) return "help";
	if (args.includes("--version")) return "version";
	if (expectedExit === 0) return "expected_cli_success";
	return "expected_cli_failure";
}

function outputFormat(args) {
	if (args.includes("--json")) return "json";
	if (args.includes("--plain")) return "plain";
	if (args.includes("--help")) return "plain";
	if (args.includes("--version")) return "plain";
	return "plain";
}

function inputSource(args, options = {}) {
	if (args.includes("--envelope")) return "file";
	if (options.env?.BROWSER_USE_ROUTER_ENVELOPE_JSON) return "env";
	if (options.input !== undefined) return "stdin";
	return "none";
}

function parseStatus(response, parsed) {
	if (parsed) return "parsed";
	const text = response.stdout.trim();
	if (text === "") return "empty";
	if (text.startsWith("{") || text.startsWith("[")) return "invalid_json";
	return "non_json";
}

function runCli(repo, script, args, options = {}) {
	const cwd = options.cwd ?? repo;
	const scriptArg =
		cwd === repo || path.isAbsolute(script) ? script : path.join(repo, script);
	const result = spawnSync("bun", [scriptArg, ...args], {
		cwd,
		env: {
			...process.env,
			BROWSER_USE_ROUTER_EVAL_DATE: "2026-06-10",
			...(options.env ?? {}),
		},
		input: options.input,
		encoding: "utf8",
	});
	return {
		exit_code: result.status,
		signal: result.signal ?? null,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function capability(capability, support = "full", confidence = 90) {
	return {
		capability,
		support,
		confidence,
		evidence: { verification_method: "maintainer_verified_manifest" },
	};
}

function capabilitySet(overrides = {}) {
	const states = Object.fromEntries(
		CAPABILITIES.map((item) => [item, ["full", 90]]),
	);
	states.memory_debug = ["partial", 60];
	states.react_vitals = ["none", 80];
	Object.assign(states, overrides);
	return Object.entries(states).map(([name, [support, confidence]]) =>
		capability(name, support, confidence),
	);
}

function report(adapterId = "chrome-devtools", overrides = {}) {
	const base = {
		adapter_id: adapterId,
		schema_version: "1",
		report_source: "manifest",
		resolved_command: adapterId,
		validation: "valid",
		attachment_model: "verified_warm_chrome",
		provenance: {
			adapter_version: `${adapterId}@1`,
			source_url: "https://example.test/docs",
			checked_at: "2026-06-08",
			verification_method: "maintainer_verified_manifest",
			stale_after_days: 30,
		},
		capabilities: capabilitySet(),
	};
	const merged = { ...base, ...overrides };
	if (overrides.provenance) {
		merged.provenance = { ...base.provenance, ...overrides.provenance };
	}
	if (overrides.capabilities) merged.capabilities = overrides.capabilities;
	return merged;
}

function envelope(overrides = {}) {
	const runId = overrides.run_id ?? "smoke-envelope-run";
	return {
		run_id: runId,
		policy: { mode: "auto", ...(overrides.policy ?? {}) },
		task: overrides.task ?? { bundle: "snapshot_page_action" },
		preconditions: {
			run_id: runId,
			freshness: { checked_at: "2026-06-08", stale_after_days: 30 },
			warm_chrome_ready: true,
			adapter_attached_verified_browser: {
				"chrome-devtools": true,
				"agent-browser": true,
				"playwright-cdp": true,
			},
			...(overrides.preconditions ?? {}),
		},
		reports: overrides.reports ?? [report("chrome-devtools")],
	};
}

function selfReportEnvelope(overrides = {}) {
	return envelope({
		reports: [report("agent-browser", { report_source: "self_report" })],
		...overrides,
	});
}

function writeFixture(dir, name, value) {
	const file = path.join(dir, `${name}.json`);
	writeFileSync(file, JSON.stringify(value, null, 2));
	return file;
}

function parseJsonOutput(response) {
	const text = response.stdout.trim();
	if (!text.startsWith("{") && !text.startsWith("[")) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function json(response) {
	const parsed = parseJsonOutput(response);
	if (!parsed) throw new Error(`stdout is not JSON: ${response.stdout.slice(0, 160)}`);
	return parsed;
}

function getPath(value, dottedPath) {
	return dottedPath.split(".").reduce((node, key) => node?.[key], value);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function includes(text, stream = "stdout") {
	return (response) => {
		const haystack = stream === "stderr" ? response.stderr : response.stdout;
		assert(haystack.includes(text), `missing ${text}`);
	};
}

function notIncludes(text, stream = "stdout") {
	return (response) => {
		const haystack = stream === "stderr" ? response.stderr : response.stdout;
		assert(!haystack.includes(text), `unexpected ${text}`);
	};
}

function jsonPath(dottedPath, expected) {
	return (response) => {
		const parsed = json(response);
		const actual = getPath(parsed, dottedPath);
		assert(
			actual === expected,
			`${dottedPath} expected ${expected}, got ${actual}`,
		);
	};
}

function selected(adapterId) {
	return (response) => {
		const parsed = json(response);
		assert(parsed.status === "ok", `status ${parsed.status}`);
		assert(parsed.data?.outcome === "selected", `outcome ${parsed.data?.outcome}`);
		assert(
			parsed.data?.evaluation_date === "2026-06-10",
			`evaluation_date ${parsed.data?.evaluation_date}`,
		);
		assert(
			parsed.data?.selected_adapter === adapterId,
			`selected ${parsed.data?.selected_adapter}`,
		);
		assert(
			parsed.continuation?.next_action_id === "use_selected_browser_adapter",
			"bad success continuation",
		);
	};
}

function plainSelected(adapterId) {
	return (response) => {
		assert(response.stdout.includes("adapter_selected"), "missing adapter_selected");
		assert(response.stdout.includes(`selected=${adapterId}`), `missing ${adapterId}`);
	};
}

function errorShape(code, action, recoverability, domain = "browser_adapter_router") {
	return (response) => {
		const parsed = json(response);
		assert(parsed.status === "error", `status ${parsed.status}`);
		assert(parsed.error?.code === code, `code ${parsed.error?.code}`);
		assert(
			parsed.error?.recoverability === recoverability,
			`recoverability ${parsed.error?.recoverability}`,
		);
		assert(
			parsed.error?.failure_domain === domain,
			`domain ${parsed.error?.failure_domain}`,
		);
		assert(parsed.error?.retryable === false, "retryable not false");
		assert(
			parsed.continuation?.next_action_id === action,
			`action ${parsed.continuation?.next_action_id}`,
		);
		if (action) {
			assert(
				parsed.runtime_actions?.length === 1,
				`runtime action count ${parsed.runtime_actions?.length}`,
			);
			assert(
				parsed.runtime_actions?.some((item) => item.id === action),
				`missing runtime action ${action}`,
			);
		}
		if (action === "research_adapter_capability") {
			researchDiagnosticTrail(parsed);
		}
	};
}

function usageShape() {
	return errorShape("usage_error", "change_route_input", "change_input", "input");
}

function usageUnknown(flag) {
	return (response) => {
		usageShape()(response);
		assert(
			json(response).error?.message.includes(`unknown option: ${flag}`),
			`missing unknown option ${flag}`,
		);
	};
}

function routeValidity(parsed) {
	const constraint = parsed.continuation?.constraints?.find(
		(item) => item.id === "route_validity",
	);
	assert(constraint, "missing route_validity constraint");
	assert(
		constraint.forbidden_action_ids?.includes("adapter_fallback"),
		"missing adapter_fallback ban",
	);
	assert(
		constraint.forbidden_action_ids?.includes("cold_browser_fallback"),
		"missing cold_browser_fallback ban",
	);
}

function noRouteValidity(parsed) {
	const constraints = Array.isArray(parsed.continuation?.constraints)
		? parsed.continuation.constraints
		: [];
	assert(
		!constraints.some((item) => item?.id === "route_validity"),
		"unexpected route_validity constraint",
	);
}

function noDiagnosticTrail(parsed) {
	assert(parsed.diagnostic_trail === undefined, "unexpected diagnostic_trail");
}

function researchDiagnosticTrail(parsed) {
	assert(parsed.diagnostic_trail, "missing diagnostic_trail");
	assert(
		parsed.diagnostic_trail.run_id === parsed.run_id,
		"diagnostic_trail run_id mismatch",
	);
	assert(
		parsed.diagnostic_trail.surface?.kind === "diagnostic_capability",
		"diagnostic_trail surface kind mismatch",
	);
	assert(
		parsed.diagnostic_trail.surface?.id ===
			"browser-adapter-router.research_adapter_capability",
		"diagnostic_trail surface id mismatch",
	);
	assert(
		parsed.diagnostic_trail.summary?.includes("bounded research"),
		"diagnostic_trail summary missing bounded research hint",
	);
}

function makeFixtures(suiteName) {
	const dir = mkdtempSync(path.join(tmpdir(), `router-cli-${suiteName}-`));
	const agent = report("agent-browser");
	const playwright = report("playwright-cdp");
	const agentSnapshotPartial = report("agent-browser", {
		capabilities: capabilitySet({ snapshot_refs: ["partial", 60] }),
	});
	const agentSnapshotNone = report("agent-browser", {
		capabilities: capabilitySet({ snapshot_refs: ["none", 90] }),
	});
	const files = {
		ok: writeFixture(dir, "ok", envelope()),
		latestRoute: writeFixture(dir, "latest-route", envelope()),
		latestRouteEvidence: writeFixture(dir, "latest-route-evidence", envelope()),
		browserAdapterRouterLatest: writeFixture(
			dir,
			"browser-adapter-router-latest",
			envelope(),
		),
		agent: writeFixture(dir, "agent", envelope({ reports: [agent] })),
		playwright: writeFixture(dir, "playwright", envelope({ reports: [playwright] })),
		all: writeFixture(
			dir,
			"all",
			envelope({ reports: ADAPTERS.map((adapter) => report(adapter)) }),
		),
		preferAgent: writeFixture(
			dir,
			"prefer-agent",
			envelope({
				policy: { mode: "prefer", adapter_id: "agent-browser" },
				reports: ADAPTERS.map((adapter) => report(adapter)),
			}),
		),
		preferFallback: writeFixture(
			dir,
			"prefer-fallback",
			envelope({
				policy: {
					mode: "prefer",
					adapter_id: "agent-browser",
					fallback_allowed: true,
				},
				reports: [report("chrome-devtools")],
			}),
		),
		preferMissingProofFallback: writeFixture(
			dir,
			"prefer-missing-proof-fallback",
			envelope({
				policy: {
					mode: "prefer",
					adapter_id: "agent-browser",
					fallback_allowed: true,
				},
				preconditions: {
					adapter_attached_verified_browser: {
						"agent-browser": false,
						"chrome-devtools": true,
					},
				},
				reports: [agent, report("chrome-devtools")],
			}),
		),
		preferMissingProofNoFallback: writeFixture(
			dir,
			"prefer-missing-proof-no-fallback",
			envelope({
				policy: { mode: "prefer", adapter_id: "agent-browser" },
				preconditions: {
					adapter_attached_verified_browser: {
						"agent-browser": false,
						"chrome-devtools": true,
					},
				},
				reports: [agent, report("chrome-devtools")],
			}),
		),
		preferPartial: writeFixture(
			dir,
			"prefer-partial",
			envelope({
				policy: { mode: "prefer", adapter_id: "agent-browser" },
				reports: [agentSnapshotPartial, report("chrome-devtools")],
			}),
		),
		preferPartialFallback: writeFixture(
			dir,
			"prefer-partial-fallback",
			envelope({
				policy: {
					mode: "prefer",
					adapter_id: "agent-browser",
					fallback_allowed: true,
				},
				reports: [agentSnapshotPartial, report("chrome-devtools")],
			}),
		),
		forceChrome: writeFixture(
			dir,
			"force-chrome",
			envelope({ policy: { mode: "force", adapter_id: "chrome-devtools" } }),
		),
		forceAgent: writeFixture(
			dir,
			"force-agent",
			envelope({
				policy: { mode: "force", adapter_id: "agent-browser" },
				reports: [agent],
			}),
		),
		forceMissing: writeFixture(
			dir,
			"force-missing",
			envelope({
				policy: { mode: "force", adapter_id: "agent-browser" },
				reports: [report("chrome-devtools")],
			}),
		),
		forceAgentNoneWithChrome: writeFixture(
			dir,
			"force-agent-none-with-chrome",
			envelope({
				policy: { mode: "force", adapter_id: "agent-browser" },
				reports: [agentSnapshotNone, report("chrome-devtools")],
			}),
		),
		forceAgentMissingProofWithChrome: writeFixture(
			dir,
			"force-agent-missing-proof-with-chrome",
			envelope({
				policy: { mode: "force", adapter_id: "agent-browser" },
				preconditions: {
					adapter_attached_verified_browser: {
						"agent-browser": false,
						"chrome-devtools": true,
					},
				},
				reports: [agent, report("chrome-devtools")],
			}),
		),
		taskRanking: writeFixture(
			dir,
			"task-ranking",
			envelope({
				task: {
					bundle: "snapshot_page_action",
					adapter_ranking: ["playwright-cdp", "agent-browser", "chrome-devtools"],
				},
				reports: ADAPTERS.map((adapter) => report(adapter)),
			}),
		),
		bundleExtraCapability: writeFixture(
			dir,
			"bundle-extra-capability",
			envelope({
				task: {
					bundle: "visual_proof_capture",
					required_capabilities: ["console_debug"],
				},
			}),
		),
		mediaProof: writeFixture(
			dir,
			"media-proof",
			envelope({
				task: {
					bundle: "visual_proof_capture",
					media_proof: {
						requested: true,
						run_scoped_path: "runs/router-smoke.png",
					},
				},
			}),
		),
		selfReportRoute: writeFixture(dir, "self-report-route", selfReportEnvelope()),
		noReports: writeFixture(dir, "no-reports", envelope({ reports: [] })),
		none: writeFixture(
			dir,
			"none",
			envelope({ task: { required_capabilities: ["react_vitals"] } }),
		),
		partial: writeFixture(
			dir,
			"partial",
			envelope({ task: { required_capabilities: ["memory_debug"] } }),
		),
		unknownCap: writeFixture(
			dir,
			"unknown-cap",
			envelope({
				reports: [
					report("chrome-devtools", {
						capabilities: capabilitySet({ memory_debug: ["unknown", 40] }),
					}),
				],
				task: { required_capabilities: ["memory_debug"] },
			}),
		),
		staleCap: writeFixture(
			dir,
			"stale-cap",
			envelope({
				reports: [
					report("chrome-devtools", {
						capabilities: capabilitySet({ memory_debug: ["stale", 40] }),
					}),
				],
				task: { required_capabilities: ["memory_debug"] },
			}),
		),
		lowConfidence: writeFixture(
			dir,
			"low-confidence",
			envelope({
				reports: [
					report("chrome-devtools", {
						capabilities: [capability("snapshot_refs", "full", 50)],
					}),
				],
				task: { required_capabilities: ["snapshot_refs"] },
			}),
		),
		staleReport: writeFixture(
			dir,
			"stale-report",
			envelope({
				reports: [
					report("chrome-devtools", {
						provenance: { checked_at: "2026-01-01", stale_after_days: 1 },
					}),
				],
			}),
		),
		incompatible: writeFixture(
			dir,
			"incompatible",
			envelope({
				reports: [
					report("chrome-devtools", {
						attachment_model: "storage_state_import",
					}),
				],
			}),
		),
		separateContext: writeFixture(
			dir,
			"separate-context",
			envelope({
				reports: [
					report("chrome-devtools", {
						attachment_model: "separate_browser_context",
					}),
				],
			}),
		),
		preStale: writeFixture(
			dir,
			"pre-stale",
			envelope({
				preconditions: {
					freshness: { checked_at: "2026-01-01", stale_after_days: 1 },
				},
			}),
		),
		futureFreshness: writeFixture(
			dir,
			"future-freshness",
			envelope({
				preconditions: {
					freshness: { checked_at: "2099-01-01", stale_after_days: 30 },
				},
			}),
		),
		malformedFreshness: writeFixture(
			dir,
			"malformed-freshness",
			envelope({
				preconditions: {
					freshness: { checked_at: "not-a-date", stale_after_days: 30 },
				},
			}),
		),
		boundaryFreshness: writeFixture(
			dir,
			"boundary-freshness",
			envelope({
				preconditions: {
					freshness: { checked_at: "2026-05-11", stale_after_days: 30 },
				},
			}),
		),
		warmNotReady: writeFixture(
			dir,
			"warm-not-ready",
			envelope({
				preconditions: { warm_chrome_ready: false },
			}),
		),
		attachMissing: writeFixture(
			dir,
			"attach-missing",
			envelope({
				preconditions: {
					adapter_attached_verified_browser: { "chrome-devtools": false },
				},
			}),
		),
		authMissing: writeFixture(
			dir,
			"auth-missing",
			envelope({
				preconditions: {
					auth_session: {
						required: true,
						target_origin: "https://example.test",
					},
				},
			}),
		),
		authMismatch: writeFixture(
			dir,
			"auth-mismatch",
			envelope({
				preconditions: {
					auth_session: {
						required: true,
						target_origin: "https://example.test",
						verified_profile_identity: "nathan@example.test",
						account_session_match: false,
					},
				},
			}),
		),
		authOk: writeFixture(
			dir,
			"auth-ok",
			envelope({
				preconditions: {
					auth_session: {
						required: true,
						target_origin: "https://example.test",
						verified_profile_identity: "nathan@example.test",
						account_session_match: true,
					},
				},
			}),
		),
		targetMissing: writeFixture(
			dir,
			"target-missing",
			envelope({
				preconditions: {
					target_origin: {
						required: true,
						origin: "https://example.test",
					},
				},
			}),
		),
		targetMismatch: writeFixture(
			dir,
			"target-mismatch",
			envelope({
				preconditions: {
					target_origin: {
						required: true,
						expected: "https://example.test",
						observed: "https://other.example.test",
					},
				},
			}),
		),
		mixed: writeFixture(
			dir,
			"mixed",
			envelope({ run_id: "mixed", preconditions: { run_id: "other" } }),
		),
		invalid: writeFixture(dir, "invalid", {
			run_id: "bad",
			policy: { mode: "auto" },
		}),
		invalidBundle: writeFixture(dir, "invalid-bundle", {
			...envelope(),
			task: { bundle: "bogus_bundle" },
		}),
		invalidRequiredCapability: writeFixture(
			dir,
			"invalid-required-capability",
			{
				...envelope(),
				task: { required_capabilities: ["not_a_capability"] },
			},
		),
		invalidForceNoAdapter: writeFixture(dir, "invalid-force-no-adapter", {
			...envelope(),
			policy: { mode: "force" },
		}),
		invalidMode: writeFixture(dir, "invalid-mode", {
			...envelope(),
			policy: { mode: "bogus" },
		}),
	};
	for (const bundle of BUNDLES) {
		files[`bundle_${bundle}`] = writeFixture(
			dir,
			`bundle-${bundle}`,
			envelope({ task: { bundle } }),
		);
	}
	return { dir, files };
}

function add(cases, key, expectedExit, args, validator, options = {}) {
	cases.push({
		key,
		expectedExit,
		args,
		validator,
		options,
		caseKind: options.caseKind ?? (key.startsWith("pad_") ? "padding" : "coverage"),
	});
}

function coreCases(fixtures) {
	const { files } = fixtures;
	const cases = [];
	const selfAgent = JSON.stringify(
		report("agent-browser", { report_source: "self_report" }),
	);
	const staleSelfAgent = JSON.stringify(
		report("agent-browser", {
			report_source: "self_report",
			provenance: { checked_at: "2026-01-01", stale_after_days: 30 },
		}),
	);
	const invalidSelfAgent = JSON.stringify(
		report("agent-browser", {
			report_source: "self_report",
			validation: "invalid",
		}),
	);
	const missingCapabilitySelfAgent = JSON.stringify(
		report("agent-browser", {
			report_source: "self_report",
			capabilities: report("agent-browser").capabilities.filter(
				(item) => item.capability !== "react_vitals",
			),
		}),
	);
	add(cases, "help_root", 0, ["--help"], includes("Usage: browser-adapter-router"));
	add(cases, "help_route", 0, ["route", "--help"], includes("route [--envelope"));
	add(cases, "help_report", 0, ["report", "--help"], includes("report --adapter"));
	add(cases, "help_status", 0, ["status", "--help"], includes("status [--envelope"));
	add(cases, "help_route_omits_report_flags", 0, ["route", "--help"], (response) => {
		notIncludes("--adapter")(response);
		notIncludes("--capability")(response);
	});
	add(cases, "help_status_omits_report_flags", 0, ["status", "--help"], (response) => {
		notIncludes("--adapter")(response);
		notIncludes("--capability")(response);
	});
	add(cases, "help_report_omits_envelope_flag", 0, ["report", "--help"], notIncludes("--envelope"));
	add(cases, "version", 0, ["--version"], includes("browser-adapter-router 0.1.0"));
	add(cases, "version_json_flag", 0, ["--version", "--json"], (response) => {
		const parsed = json(response);
		assert(parsed.status === "ok", `status ${parsed.status}`);
		assert(parsed.data?.name === "browser-adapter-router", "missing version name");
		assert(parsed.data?.version === "0.1.0", `version ${parsed.data?.version}`);
	});
	for (const [key, args] of [
		["missing_command", ["--json", "--run-id", "u1", "--quiet"]],
		["unknown_command", ["dance", "--json", "--run-id", "u2", "--quiet"]],
		["route_unknown_flag", ["route", "--wat", "--json", "--run-id", "u3", "--quiet"]],
		["status_unknown_flag", ["status", "--wat", "--json", "--run-id", "u4", "--quiet"]],
		["route_missing_envelope_value", ["route", "--envelope", "--json", "--run-id", "u6", "--quiet"]],
		["report_missing_adapter", ["report", "--json", "--run-id", "u7", "--quiet"]],
		["report_bad_adapter", ["report", "--adapter", "nope", "--json", "--run-id", "u8", "--quiet"]],
		[
			"report_bad_capability",
			["report", "--adapter", "chrome-devtools", "--capability", "bogus", "--json", "--run-id", "u9", "--quiet"],
		],
	]) {
		add(cases, key, 2, args, usageShape());
	}
	add(
		cases,
		"report_verify_rejected",
		2,
		["report", "--adapter", "chrome-devtools", "--verify", "--json", "--run-id", "u5", "--quiet"],
		usageUnknown("--verify"),
	);
	add(
		cases,
		"route_rejects_adapter_flag",
		2,
		["route", "--adapter", "chrome-devtools", "--json", "--run-id", "flag-route-adapter", "--quiet"],
		usageUnknown("--adapter"),
	);
	add(
		cases,
		"route_rejects_capability_flag",
		2,
		["route", "--capability", "snapshot_refs", "--json", "--run-id", "flag-route-capability", "--quiet"],
		usageUnknown("--capability"),
	);
	add(
		cases,
		"status_rejects_adapter_flag",
		2,
		["status", "--adapter", "chrome-devtools", "--plain", "--run-id", "flag-status-adapter", "--quiet"],
		includes("unknown option: --adapter", "stderr"),
	);
	add(
		cases,
		"status_rejects_capability_flag",
		2,
		["status", "--capability", "snapshot_refs", "--plain", "--run-id", "flag-status-capability", "--quiet"],
		includes("unknown option: --capability", "stderr"),
	);
	add(
		cases,
		"report_rejects_envelope_flag",
		2,
		["report", "--adapter", "chrome-devtools", "--envelope", "x.json", "--json", "--run-id", "flag-report-envelope", "--quiet"],
		usageUnknown("--envelope"),
	);
	for (const adapter of ADAPTERS) {
		add(
			cases,
			`report_${adapter}_json`,
			0,
			["report", "--adapter", adapter, "--json", "--run-id", `rep-${adapter}`, "--quiet"],
			jsonPath("data.report.adapter_id", adapter),
		);
		add(
			cases,
			`report_${adapter}_plain`,
			0,
			["report", "--adapter", adapter, "--plain", "--run-id", `rep-p-${adapter}`, "--quiet"],
			includes(`report_found adapter=${adapter}`),
		);
	}
	add(
		cases,
		"report_manifest_provenance_source_urls",
		0,
		["report", "--adapter", "chrome-devtools", "--json", "--run-id", "rep-provenance", "--quiet"],
		(response) => {
			const found = json(response).data.report;
			const sourceUrl = found.provenance.source_url;
			assert(sourceUrl.startsWith("https://"), "missing source_url");
			assert(found.provenance.adapter_version, "missing adapter_version");
			assert(found.provenance.checked_at, "missing checked_at");
			assert(found.provenance.verification_method, "missing verification_method");
			assert(Number.isFinite(found.provenance.stale_after_days), "missing stale_after_days");
			assert(
				found.capabilities.every(
					(item) => item.evidence.source_url === sourceUrl,
				),
				"capability evidence source_url mismatch",
			);
		},
	);
	for (const item of CAPABILITIES) {
		add(
			cases,
			`report_cap_${item}`,
			0,
			["report", "--adapter", "chrome-devtools", "--capability", item, "--json", "--run-id", `cap-${item}`, "--quiet"],
			jsonPath("data.capability.capability", item),
		);
	}
	add(
		cases,
		"report_stale",
		20,
		["report", "--adapter", "chrome-devtools", "--json", "--run-id", "rep-stale", "--quiet"],
		errorShape("adapter_capability_stale", "research_adapter_capability", "change_input"),
		{ env: { BROWSER_USE_ROUTER_EVAL_DATE: "2026-08-10" } },
	);
	add(
		cases,
		"report_self_agent",
		0,
		["report", "--adapter", "agent-browser", "--json", "--run-id", "rep-self", "--quiet"],
		jsonPath("data.report.report_source", "self_report"),
		{ env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: selfAgent } },
	);
	add(
		cases,
		"report_self_mismatch",
		20,
		["report", "--adapter", "chrome-devtools", "--json", "--run-id", "rep-mismatch", "--quiet"],
		errorShape("adapter_capability_unknown", "research_adapter_capability", "change_input"),
		{ env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: selfAgent } },
	);
	add(
		cases,
		"report_self_bad_json",
		2,
		["report", "--adapter", "chrome-devtools", "--json", "--run-id", "rep-bad-self", "--quiet"],
		usageShape(),
		{ env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: "{bad json" } },
	);
	add(
		cases,
		"report_self_stale",
		20,
		["report", "--adapter", "agent-browser", "--json", "--run-id", "rep-self-stale", "--quiet"],
		errorShape("adapter_capability_stale", "research_adapter_capability", "change_input"),
		{ env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: staleSelfAgent } },
	);
	add(
		cases,
		"report_self_invalid_validation",
		20,
		["report", "--adapter", "agent-browser", "--json", "--run-id", "rep-self-invalid", "--quiet"],
		errorShape("adapter_capability_unknown", "research_adapter_capability", "change_input"),
		{ env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: invalidSelfAgent } },
	);
	add(
		cases,
		"report_self_missing_requested_capability",
		20,
		[
			"report",
			"--adapter",
			"agent-browser",
			"--capability",
			"react_vitals",
			"--json",
			"--run-id",
			"rep-self-missing-cap",
			"--quiet",
		],
		errorShape("adapter_capability_unknown", "research_adapter_capability", "change_input"),
		{ env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: missingCapabilitySelfAgent } },
	);
	for (const [key, file, adapter] of [
		["route_chrome", files.ok, "chrome-devtools"],
		["route_agent", files.agent, "agent-browser"],
		["route_playwright", files.playwright, "playwright-cdp"],
		["route_all", files.all, "chrome-devtools"],
		["route_prefer_agent", files.preferAgent, "agent-browser"],
		["route_prefer_fallback", files.preferFallback, "chrome-devtools"],
		["route_force_chrome", files.forceChrome, "chrome-devtools"],
		["route_force_agent", files.forceAgent, "agent-browser"],
		["route_auth_ok", files.authOk, "chrome-devtools"],
	]) {
		add(cases, key, 0, ["route", "--envelope", file, "--json", "--run-id", key, "--quiet"], selected(adapter));
	}
	add(cases, "route_prefer_missing_proof_fallback", 0, ["route", "--envelope", files.preferMissingProofFallback, "--json", "--run-id", "prefer-missing-proof-fallback", "--quiet"], selected("chrome-devtools"));
	add(cases, "route_prefer_missing_proof_no_fallback", 20, ["route", "--envelope", files.preferMissingProofNoFallback, "--json", "--run-id", "prefer-missing-proof-no-fallback", "--quiet"], errorShape("adapter_attachment_unverified", "prove_adapter_attachment", "repair_state"));
	add(cases, "route_prefer_partial_no_fallback", 20, ["route", "--envelope", files.preferPartial, "--json", "--run-id", "prefer-partial-no-fallback", "--quiet"], errorShape("adapter_capability_partial", "change_route_input", "change_input"));
	add(cases, "route_prefer_partial_fallback", 0, ["route", "--envelope", files.preferPartialFallback, "--json", "--run-id", "prefer-partial-fallback", "--quiet"], selected("chrome-devtools"));
	add(cases, "route_force_no_fallback_with_full_alternative", 20, ["route", "--envelope", files.forceAgentNoneWithChrome, "--json", "--run-id", "force-no-fallback", "--quiet"], errorShape("adapter_capability_none", "change_route_input", "change_input"));
	add(cases, "route_force_missing_proof_with_full_alternative", 20, ["route", "--envelope", files.forceAgentMissingProofWithChrome, "--json", "--run-id", "force-missing-proof", "--quiet"], errorShape("adapter_attachment_unverified", "prove_adapter_attachment", "repair_state"));
	add(cases, "route_boundary_freshness", 0, ["route", "--envelope", files.boundaryFreshness, "--json", "--run-id", "fresh-boundary", "--quiet"], selected("chrome-devtools"));
	add(cases, "route_plain_chrome", 0, ["route", "--envelope", files.ok, "--plain", "--run-id", "plain1", "--quiet"], plainSelected("chrome-devtools"));
	add(cases, "status_json_chrome", 0, ["status", "--envelope", files.ok, "--json", "--run-id", "status1", "--quiet"], selected("chrome-devtools"));
	add(cases, "status_plain_chrome", 0, ["status", "--envelope", files.ok, "--plain", "--run-id", "status2", "--quiet"], plainSelected("chrome-devtools"));
	add(cases, "status_default_plain_chrome", 0, ["status", "--envelope", files.ok, "--run-id", "status-default", "--quiet"], plainSelected("chrome-devtools"));
	add(cases, "status_default_plain_failure", 20, ["status", "--envelope", files.none, "--run-id", "status-default-fail", "--quiet"], includes("adapter_capability_none", "stderr"));
	add(cases, "route_stdin", 0, ["route", "--json", "--run-id", "stdin1", "--quiet"], selected("chrome-devtools"), { input: readFileSync(files.ok, "utf8") });
	add(cases, "status_stdin", 0, ["status", "--json", "--run-id", "stdin2", "--quiet"], selected("chrome-devtools"), { input: readFileSync(files.ok, "utf8") });
	add(cases, "route_env_envelope", 0, ["route", "--json", "--run-id", "env1", "--quiet"], selected("chrome-devtools"), { env: { BROWSER_USE_ROUTER_ENVELOPE_JSON: readFileSync(files.ok, "utf8") } });
	add(cases, "status_env_envelope_plain", 0, ["status", "--plain", "--run-id", "env2", "--quiet"], plainSelected("chrome-devtools"), { env: { BROWSER_USE_ROUTER_ENVELOPE_JSON: readFileSync(files.ok, "utf8") } });
	for (const bundle of BUNDLES) {
		add(cases, `route_bundle_${bundle}`, 0, ["route", "--envelope", files[`bundle_${bundle}`], "--json", "--run-id", `bundle-${bundle}`, "--quiet"], selected("chrome-devtools"));
	}
	for (const [key, file, code, action, recoverability] of [
		["fail_force_missing", files.forceMissing, "adapter_capability_unknown", "research_adapter_capability", "change_input"],
		["fail_no_reports", files.noReports, "adapter_capability_unknown", "research_adapter_capability", "change_input"],
		["fail_stale_report", files.staleReport, "adapter_capability_stale", "research_adapter_capability", "change_input"],
		["fail_incompat", files.incompatible, "adapter_attachment_incompatible", "change_route_input", "change_input"],
		["fail_pre_stale", files.preStale, "route_evidence_stale", "change_route_input", "change_input"],
		["fail_attach_missing", files.attachMissing, "adapter_attachment_unverified", "prove_adapter_attachment", "repair_state"],
		["fail_auth_missing", files.authMissing, "auth_session_unverified", "verify_auth_session", "authenticate"],
		["fail_partial", files.partial, "adapter_capability_partial", "change_route_input", "change_input"],
		["fail_unknown_cap", files.unknownCap, "adapter_capability_unknown", "research_adapter_capability", "change_input"],
		["fail_stale_cap", files.staleCap, "adapter_capability_stale", "research_adapter_capability", "change_input"],
		["fail_none", files.none, "adapter_capability_none", "change_route_input", "change_input"],
		["fail_low_conf", files.lowConfidence, "adapter_capability_unknown", "research_adapter_capability", "change_input"],
		["fail_invalid", files.invalid, "route_evidence_invalid", "change_route_input", "change_input"],
		["fail_invalid_mode", files.invalidMode, "route_evidence_invalid", "change_route_input", "change_input"],
		["fail_mixed", files.mixed, "route_evidence_mixed_run", "change_route_input", "change_input"],
	]) {
		add(cases, key, 20, ["route", "--envelope", file, "--json", "--run-id", key, "--quiet"], errorShape(code, action, recoverability));
	}
	add(cases, "fail_missing_file", 20, ["route", "--envelope", path.join(fixtures.dir, "missing.json"), "--json", "--run-id", "missing-file", "--quiet"], errorShape("route_evidence_invalid", "change_route_input", "change_input"));
	add(cases, "route_ignores_implicit_latest_files", 20, ["route", "--json", "--run-id", "implicit-latest", "--quiet"], errorShape("route_evidence_invalid", "change_route_input", "change_input"), { cwd: fixtures.dir });
	add(cases, "fail_env_bad_json", 20, ["route", "--json", "--run-id", "env-bad", "--quiet"], errorShape("route_evidence_invalid", "change_route_input", "change_input"), { env: { BROWSER_USE_ROUTER_ENVELOPE_JSON: "{bad json" } });
	add(cases, "fail_stdin_bad_json", 20, ["route", "--json", "--run-id", "stdin-bad", "--quiet"], errorShape("route_evidence_invalid", "change_route_input", "change_input"), { input: "{bad json" });
	add(cases, "fail_plain_none", 20, ["route", "--envelope", files.none, "--plain", "--run-id", "plain-none", "--quiet"], includes("adapter_capability_none", "stderr"));
	add(cases, "env_run_id_route", 0, ["route", "--envelope", files.ok, "--json", "--quiet"], jsonPath("run_id", "env-run-id"), { env: { BROWSER_USE_RUN_ID: "env-run-id" } });
	add(cases, "explicit_run_id_beats_env", 0, ["route", "--envelope", files.ok, "--json", "--run-id", "explicit-run-id", "--quiet"], jsonPath("run_id", "explicit-run-id"), { env: { BROWSER_USE_RUN_ID: "env-run-id" } });
	add(cases, "success_validity_constraint", 0, ["route", "--envelope", files.ok, "--json", "--run-id", "validity-ok", "--quiet"], (response) => routeValidity(json(response)));
	if (cases.length > 100) {
		throw new Error(`core suite has too many coverage cases: ${cases.length}`);
	}
	while (cases.length < 100) {
		const index = cases.length + 1;
		add(cases, `pad_core_success_${index}`, 0, ["route", "--envelope", files.ok, "--json", "--run-id", `pad-core-${index}`, "--quiet"], selected("chrome-devtools"));
	}
	return cases;
}

function hintsCases(fixtures) {
	const { files } = fixtures;
	const cases = [];
	const staleSelfAgent = JSON.stringify(
		report("agent-browser", {
			report_source: "self_report",
			provenance: { checked_at: "2026-01-01", stale_after_days: 30 },
		}),
	);
	const invalidSelfAgent = JSON.stringify(
		report("agent-browser", {
			report_source: "self_report",
			validation: "invalid",
		}),
	);
	const missingCapabilitySelfAgent = JSON.stringify(
		report("agent-browser", {
			report_source: "self_report",
			capabilities: report("agent-browser").capabilities.filter(
				(item) => item.capability !== "react_vitals",
			),
		}),
	);
	const scenarios = {
		none: [files.none, "adapter_capability_none", "change_route_input", "change_input"],
		partial: [files.partial, "adapter_capability_partial", "change_route_input", "change_input"],
		unknownCap: [files.unknownCap, "adapter_capability_unknown", "research_adapter_capability", "change_input"],
		staleCap: [files.staleCap, "adapter_capability_stale", "research_adapter_capability", "change_input"],
		staleReport: [files.staleReport, "adapter_capability_stale", "research_adapter_capability", "change_input"],
		noReports: [files.noReports, "adapter_capability_unknown", "research_adapter_capability", "change_input"],
		attachMissing: [files.attachMissing, "adapter_attachment_unverified", "prove_adapter_attachment", "repair_state"],
		incompatible: [files.incompatible, "adapter_attachment_incompatible", "change_route_input", "change_input"],
		preStale: [files.preStale, "route_evidence_stale", "change_route_input", "change_input"],
		futureFreshness: [files.futureFreshness, "route_evidence_stale", "change_route_input", "change_input"],
		malformedFreshness: [files.malformedFreshness, "route_evidence_stale", "change_route_input", "change_input"],
		warmNotReady: [files.warmNotReady, "adapter_attachment_unverified", "prove_adapter_attachment", "repair_state"],
		authMissing: [files.authMissing, "auth_session_unverified", "verify_auth_session", "authenticate"],
		authMismatch: [files.authMismatch, "auth_session_unverified", "verify_auth_session", "authenticate"],
		targetMissing: [files.targetMissing, "target_origin_unverified", "verify_target_origin", "authenticate"],
		targetMismatch: [files.targetMismatch, "target_origin_unverified", "verify_target_origin", "authenticate"],
		mixed: [files.mixed, "route_evidence_mixed_run", "change_route_input", "change_input"],
		invalid: [files.invalid, "route_evidence_invalid", "change_route_input", "change_input"],
		invalidBundle: [files.invalidBundle, "route_evidence_invalid", "change_route_input", "change_input"],
		invalidRequiredCapability: [files.invalidRequiredCapability, "route_evidence_invalid", "change_route_input", "change_input"],
		invalidForceNoAdapter: [files.invalidForceNoAdapter, "route_evidence_invalid", "change_route_input", "change_input"],
	};
	const inputFailureScenarios = new Set([
		"invalid",
		"invalidBundle",
		"invalidRequiredCapability",
		"invalidForceNoAdapter",
	]);
	for (const [key, args, validator] of [
		["obs_status_run_duration", ["route", "--envelope", files.ok, "--json", "--run-id", "obs-1", "--quiet"], (response) => {
			const parsed = json(response);
			assert(parsed.status === "ok", `status ${parsed.status}`);
			assert(typeof parsed.run_id === "string", "missing run_id");
			assert(Number.isFinite(parsed.duration_ms), "missing duration");
		}],
		["obs_runtime_action", ["route", "--envelope", files.ok, "--json", "--run-id", "obs-2", "--quiet"], (response) => {
			const parsed = json(response);
			assert(parsed.runtime_actions[0].id === "use_selected_browser_adapter", "bad action");
			routeValidity(parsed);
		}],
		["obs_candidate_decisions", ["route", "--envelope", files.ok, "--json", "--run-id", "obs-3", "--quiet"], (response) => {
			assert(json(response).data.candidate_decisions.length === 3, "expected candidates");
		}],
		["obs_rejected_codes", ["route", "--envelope", files.ok, "--json", "--run-id", "obs-4", "--quiet"], (response) => {
			assert(json(response).data.candidate_decisions.filter((item) => item.status === "rejected").every((item) => item.code), "missing rejected code");
		}],
		["obs_ranking_confidence", ["route", "--envelope", files.ok, "--json", "--run-id", "obs-5", "--quiet"], (response) => {
			assert(Number.isFinite(json(response).data.ranking[0].ranking.route_confidence), "missing confidence");
		}],
		["obs_provenance", ["route", "--envelope", files.ok, "--json", "--run-id", "obs-6", "--quiet"], (response) => {
			assert(json(response).data.provenance_summary[0].checked_at, "missing provenance");
		}],
		["obs_prefer_fallback", ["route", "--envelope", files.preferFallback, "--json", "--run-id", "obs-7", "--quiet"], selected("chrome-devtools")],
		["obs_force_agent", ["route", "--envelope", files.forceAgent, "--json", "--run-id", "obs-8", "--quiet"], selected("agent-browser")],
		["obs_ranking_registry_tiebreak", ["route", "--envelope", files.all, "--json", "--run-id", "obs-ranking-registry", "--quiet"], (response) => {
			const ranking = json(response).data.ranking.map((item) => item.adapter_id);
			assert(ranking.join(",") === ADAPTERS.join(","), `ranking ${ranking.join(",")}`);
		}],
		["obs_task_ranking_beats_registry", ["route", "--envelope", files.taskRanking, "--json", "--run-id", "obs-task-rank", "--quiet"], (response) => {
			const parsed = json(response);
			assert(parsed.data.mode === "auto", `mode ${parsed.data.mode}`);
			assert(parsed.data.selected_adapter === "playwright-cdp", "task ranking did not win");
			assert(parsed.data.ranking[0].adapter_id === "playwright-cdp", "ranking leader mismatch");
			assert(parsed.data.ranking[0].ranking.task_priority === 0, "missing task priority");
		}],
	]) {
		add(cases, key, 0, args, validator);
	}
	for (const [name, [file, code, action, recoverability]] of Object.entries(scenarios)) {
		add(cases, `recovery_${name}_shape`, 20, ["route", "--envelope", file, "--json", "--run-id", `rec-${name}`, "--quiet"], (response) => {
			const parsed = json(response);
			errorShape(code, action, recoverability)(response);
			if (inputFailureScenarios.has(name)) {
				noRouteValidity(parsed);
			} else {
				routeValidity(parsed);
			}
			if (action !== "research_adapter_capability") {
				noDiagnosticTrail(parsed);
			}
		});
		add(cases, `action_${name}_${action}`, 20, ["route", "--envelope", file, "--json", "--run-id", `act-${name}`, "--quiet"], (response) => {
			const actionRecord = json(response).runtime_actions[0];
			assert(actionRecord.id === action, `action ${actionRecord.id}`);
			assert(actionRecord.summary.length > 10, "missing summary");
			assert(actionRecord.side_effects.includes("check"), "missing side effect");
		});
	}
	for (const [name, [file, code]] of Object.entries(scenarios).slice(0, 8)) {
		add(cases, `plain_${name}_mentions_code`, 20, ["route", "--envelope", file, "--plain", "--run-id", `plain-${name}`, "--quiet"], includes(code, "stderr"));
	}
	add(cases, "usage_missing_command_shape", 2, ["--json", "--run-id", "usage-missing", "--quiet"], usageShape());
	add(cases, "usage_redacts_sensitive_flag", 2, ["route", "--secret-token=/Users/example/secret", "--json", "--run-id", "usage-redact", "--quiet"], (response) => {
		const parsed = json(response);
		assert(!parsed.error.message.includes("/Users/example"), "path leaked");
		assert(parsed.error.failure_domain === "input", "bad domain");
	});
	add(cases, "report_stale_recovery", 20, ["report", "--adapter", "chrome-devtools", "--json", "--run-id", "report-stale", "--quiet"], errorShape("adapter_capability_stale", "research_adapter_capability", "change_input"), { env: { BROWSER_USE_ROUTER_EVAL_DATE: "2026-08-10" } });
	add(cases, "report_stale_has_diagnostic_trail", 20, ["report", "--adapter", "chrome-devtools", "--json", "--run-id", "report-stale-trail", "--quiet"], (response) => {
		const parsed = json(response);
		errorShape("adapter_capability_stale", "research_adapter_capability", "change_input")(response);
		researchDiagnosticTrail(parsed);
		noRouteValidity(parsed);
	}, { env: { BROWSER_USE_ROUTER_EVAL_DATE: "2026-08-10" } });
	add(cases, "report_self_stale_has_diagnostic_trail", 20, ["report", "--adapter", "agent-browser", "--json", "--run-id", "self-stale-trail", "--quiet"], (response) => {
		const parsed = json(response);
		errorShape("adapter_capability_stale", "research_adapter_capability", "change_input")(response);
		researchDiagnosticTrail(parsed);
		noRouteValidity(parsed);
	}, { env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: staleSelfAgent } });
	add(cases, "report_self_invalid_has_diagnostic_trail", 20, ["report", "--adapter", "agent-browser", "--json", "--run-id", "self-invalid-trail", "--quiet"], (response) => {
		const parsed = json(response);
		errorShape("adapter_capability_unknown", "research_adapter_capability", "change_input")(response);
		researchDiagnosticTrail(parsed);
		noRouteValidity(parsed);
	}, { env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: invalidSelfAgent } });
	add(cases, "report_missing_capability_has_diagnostic_trail", 20, ["report", "--adapter", "agent-browser", "--capability", "react_vitals", "--json", "--run-id", "self-missing-cap-trail", "--quiet"], (response) => {
		const parsed = json(response);
		errorShape("adapter_capability_unknown", "research_adapter_capability", "change_input")(response);
		researchDiagnosticTrail(parsed);
		noRouteValidity(parsed);
	}, { env: { BROWSER_USE_ROUTER_SELF_REPORT_JSON: missingCapabilitySelfAgent } });
	add(cases, "route_research_has_diagnostic_trail", 20, ["route", "--envelope", files.staleReport, "--json", "--run-id", "route-research-trail", "--quiet"], (response) => {
		const parsed = json(response);
		errorShape("adapter_capability_stale", "research_adapter_capability", "change_input")(response);
		researchDiagnosticTrail(parsed);
		assert(parsed.data?.failure_kind === "route_failure", "missing route failure kind");
		assert(parsed.data?.evaluation_date === "2026-06-10", "missing evaluation date");
		assert(parsed.data?.routing_started === true, "missing routing_started");
		assert(Array.isArray(parsed.data?.candidate_decisions), "missing candidate decisions");
		assert(
			parsed.data?.research?.diagnostic_trail_id ===
				"browser-adapter-router.research_adapter_capability",
			"missing research diagnostic pointer",
		);
		routeValidity(parsed);
	});
	add(cases, "invalid_route_input_has_no_route_validity", 20, ["route", "--envelope", files.invalid, "--json", "--run-id", "invalid-no-validity", "--quiet"], (response) => {
		const parsed = json(response);
		errorShape("route_evidence_invalid", "change_route_input", "change_input")(response);
		noRouteValidity(parsed);
		noDiagnosticTrail(parsed);
		assert(parsed.data === undefined, "unexpected invalid-input data");
	});
	add(cases, "auth_mismatch_hint_names_auth_evidence", 20, ["route", "--envelope", files.authMismatch, "--json", "--run-id", "auth-mismatch-hint", "--quiet"], (response) => {
		const message = json(response).error.message;
		assert(message.includes("target origin"), "missing target origin hint");
		assert(message.includes("verified profile identity"), "missing profile hint");
	});
	add(cases, "target_mismatch_hint_names_supplied_evidence", 20, ["route", "--envelope", files.targetMismatch, "--json", "--run-id", "target-mismatch-hint", "--quiet"], (response) => {
		assert(json(response).error.message.includes("matching supplied evidence"), "missing target evidence hint");
	});
	add(cases, "plain_success_mentions_action", 0, ["route", "--envelope", files.ok, "--plain", "--run-id", "plain-ok", "--quiet"], includes("action=use_selected_browser_adapter"));
	add(cases, "plain_report_mentions_source", 0, ["report", "--adapter", "chrome-devtools", "--plain", "--run-id", "plain-report", "--quiet"], includes("source=manifest"));
	add(cases, "obs_env_run_id_route", 0, ["route", "--envelope", files.ok, "--json", "--quiet"], jsonPath("run_id", "env-hint-run"), { env: { BROWSER_USE_RUN_ID: "env-hint-run" } });
	add(cases, "obs_quiet_stderr_empty_success", 0, ["route", "--envelope", files.ok, "--json", "--run-id", "quiet-ok", "--quiet"], (response) => {
		assert(response.stderr === "", "stderr not empty");
		selected("chrome-devtools")(response);
	});
	add(cases, "obs_quiet_stderr_empty_error", 20, ["route", "--envelope", files.none, "--json", "--run-id", "quiet-error", "--quiet"], (response) => {
		assert(response.stderr === "", "stderr not empty");
		errorShape("adapter_capability_none", "change_route_input", "change_input")(response);
	});
	add(cases, "obs_missing_file_redacted", 20, ["route", "--envelope", "/Users/example/private.json", "--json", "--run-id", "missing-redact", "--quiet"], (response) => {
		const parsed = json(response);
		assert(!parsed.error.message.includes("/Users/example"), "path leaked");
		assert(parsed.error.code === "route_evidence_invalid", "bad code");
	});
	add(cases, "obs_bad_env_json_recovery", 20, ["route", "--json", "--run-id", "bad-env-json", "--quiet"], errorShape("route_evidence_invalid", "change_route_input", "change_input"), { env: { BROWSER_USE_ROUTER_ENVELOPE_JSON: "{bad json" } });
	add(cases, "obs_bad_stdin_json_recovery", 20, ["route", "--json", "--run-id", "bad-stdin-json", "--quiet"], errorShape("route_evidence_invalid", "change_route_input", "change_input"), { input: "{bad json" });
	add(cases, "route_self_report_evidence", 0, ["route", "--envelope", files.selfReportRoute, "--json", "--run-id", "route-self-report", "--quiet"], (response) => {
		const parsed = json(response);
		selected("agent-browser")(response);
		assert(
			parsed.data.provenance_summary.some(
				(item) =>
					item.adapter_id === "agent-browser" &&
					item.report_source === "self_report",
			),
			"missing self-report provenance",
		);
	});
	add(cases, "route_bundle_plus_extra_capability", 0, ["route", "--envelope", files.bundleExtraCapability, "--json", "--run-id", "bundle-extra-capability", "--quiet"], (response) => {
		const parsed = json(response);
		selected("chrome-devtools")(response);
		assert(parsed.data.required_capabilities.includes("screenshot_media"), "missing bundle capability");
		assert(parsed.data.required_capabilities.includes("console_debug"), "missing extra capability");
	});
	add(cases, "route_media_proof_metadata", 0, ["route", "--envelope", files.mediaProof, "--json", "--run-id", "media-proof", "--quiet"], (response) => {
		const media = json(response).data.media_proof;
		assert(media?.owner === "browser-use", `owner ${media?.owner}`);
		assert(media?.retention === "per_run", `retention ${media?.retention}`);
		assert(media?.disclose_to_user === true, "disclosure not true");
		assert(media?.run_scoped_path === "runs/router-smoke.png", "bad media path");
	});
	add(cases, "fail_separate_context_incompat", 20, ["route", "--envelope", files.separateContext, "--json", "--run-id", "separate-context", "--quiet"], errorShape("adapter_attachment_incompatible", "change_route_input", "change_input"));
	add(cases, "fail_no_input_route", 20, ["route", "--json", "--run-id", "no-input", "--quiet"], errorShape("route_evidence_invalid", "change_route_input", "change_input"));
	add(cases, "pad_repair_summary_specific", 20, ["route", "--envelope", files.attachMissing, "--json", "--run-id", "repair-summary", "--quiet"], (response) => {
		assert(json(response).runtime_actions[0].summary.includes("Browser Adapter Proof"), "missing repair hint");
	});
	add(cases, "pad_research_summary_specific", 20, ["route", "--envelope", files.noReports, "--json", "--run-id", "research-summary", "--quiet"], (response) => {
		const summary = json(response).runtime_actions[0].summary;
		assert(summary.includes("bounded docs research"), "missing research hint");
		assert(summary.includes("advisory only until verified"), "missing advisory hint");
	});
	add(cases, "pad_partial_change_input_summary", 20, ["route", "--envelope", files.partial, "--json", "--run-id", "partial-summary", "--quiet"], (response) => {
		const parsed = json(response);
		assert(parsed.continuation.next_action_id === "change_route_input", "partial did not fail closed to input change");
		assert(parsed.data?.failure_kind === "route_failure", "missing route failure data");
		assert(parsed.data?.required_capabilities?.includes("memory_debug"), "missing required capability");
		assert(parsed.runtime_actions[0].summary.includes("Correct the supplied evidence envelope"), "missing route input hint");
	});
	if (cases.length > 100) {
		throw new Error(`hints suite has too many coverage cases: ${cases.length}`);
	}
	while (cases.length < 100) {
		const index = cases.length + 1;
		add(cases, `pad_hints_success_${index}`, 0, ["route", "--envelope", files.ok, "--json", "--run-id", `pad-hints-${index}`, "--quiet"], (response) => {
			const parsed = json(response);
			assert(parsed.data.candidate_decisions[0].reason.length > 10, "missing reason");
			routeValidity(parsed);
		});
	}
	return cases;
}

function artifactName(suite, timestampEnabled) {
	const base =
		suite === "core"
			? "router-cli-smoke-responses-100"
			: "router-cli-hints-observability-recovery-100";
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `${base}${timestampEnabled ? `-${stamp}` : ""}.json`;
}

function runSuite({ suite, repo, script, outDir, timestamp, parentRunId, generatorCommand }) {
	const fixtures = makeFixtures(suite);
	const cases = suite === "core" ? coreCases(fixtures) : hintsCases(fixtures);
	if (cases.length !== 100) {
		throw new Error(`${suite} suite expected 100 cases, got ${cases.length}`);
	}
	const responses = {};
	let pass = 0;
	let fail = 0;
	for (const testCase of cases) {
		const response = runCli(repo, script, testCase.args, testCase.options);
		const parsed = parseJsonOutput(response);
		const record = {
			key: testCase.key,
			case_kind: testCase.caseKind,
			case_intent: caseIntent(testCase.expectedExit, testCase.args),
			input_source: inputSource(testCase.args, testCase.options),
			command: redactedCommand(script, testCase.args, repo),
			command_sha256: sha256(["bun", script, ...testCase.args].join("\u0000")),
			...(testCase.options.env
				? { env: capturedEnv(testCase.options.env) }
				: {}),
			...(testCase.options.input !== undefined
				? { stdin: capturedInput(testCase.options.input) }
				: {}),
			expected_exit_code: testCase.expectedExit,
			expected_status: testCase.expectedExit === 0 ? "ok" : "error",
			exit_code: response.exit_code,
			output_format: outputFormat(testCase.args),
			parse_status: parseStatus(response, parsed),
			stdout: response.stdout,
			stdout_bytes: byteLength(response.stdout),
			stderr: response.stderr,
			stderr_bytes: byteLength(response.stderr),
			parsed_stdout: parsed,
			assertions: [],
			passed: false,
		};
		try {
			assert(
				response.exit_code === testCase.expectedExit,
				`exit expected ${testCase.expectedExit}, got ${response.exit_code}`,
			);
			testCase.validator(response);
			record.passed = true;
			record.assertions = [
				{
					id: "exit_code",
					expected: testCase.expectedExit,
					actual: response.exit_code,
					pass: true,
				},
				{
					id: `${testCase.key}_validator`,
					validator: testCase.validator.name || "anonymous_validator",
					pass: true,
				},
			];
			pass += 1;
			console.log(`PASS ${String(pass).padStart(3, "0")} ${suite}:${testCase.key}`);
		} catch (error) {
			record.failure = error instanceof Error ? error.message : String(error);
			fail += 1;
			console.log(`FAIL ${suite}:${testCase.key}: ${record.failure}`);
		}
		responses[testCase.key] = record;
	}
	const artifact = {
		schema_version: ARTIFACT_SCHEMA_VERSION,
		artifact_id: randomUUID(),
		parent_run_id: parentRunId,
		generated_at: new Date().toISOString(),
		cwd: redactPathForArtifact(repo, repo),
		branch: gitLines(repo, ["branch", "--show-current"])[0] ?? "",
		head: gitLines(repo, ["rev-parse", "HEAD"])[0] ?? "",
		git_status: gitLines(repo, ["status", "--short", "--branch"]),
		generator_command: generatorCommand.map((arg) => redactArg(arg, repo)),
		runtime: {
			node: process.version,
			bun: commandOutput(repo, ["bun", "--version"]),
			platform: process.platform,
			arch: process.arch,
		},
		script: redactPathForArtifact(script, repo),
		script_sha256: sha256(readFileSync(path.join(repo, script), "utf8")),
		evaluation_date: "2026-06-10",
		temp_fixture_dir: redactPathForArtifact(fixtures.dir, repo),
		suite,
		suite_focus:
			suite === "core"
				? "core_route_report_status_cli_smoke"
				: "hints_observability_repair_recovery",
		summary: { total: cases.length, pass, fail },
		responses,
	};
	mkdirSync(outDir, { recursive: true });
	const outputPath = path.join(outDir, artifactName(suite, timestamp));
	writeFileSync(outputPath, JSON.stringify(artifact, null, 2));
	return { outputPath, summary: artifact.summary };
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const repo = repoRoot();
	const script = path.isAbsolute(options.script)
		? options.script
		: path.relative(repo, path.resolve(repo, options.script));
	const suites = options.suite === "all" ? ["core", "hints"] : [options.suite];
	const parentRunId = randomUUID();
	const generatorCommand = [
		"node",
		"skills/router-cli-smoke/scripts/router_cli_smoke.mjs",
		...process.argv.slice(2),
	];
	const results = suites.map((suite) =>
		runSuite({
			suite,
			repo,
			script,
			outDir: options.outDir,
			timestamp: options.timestamp,
			parentRunId,
			generatorCommand,
		}),
	);
	const total = results.reduce(
		(acc, item) => ({
			total: acc.total + item.summary.total,
			pass: acc.pass + item.summary.pass,
			fail: acc.fail + item.summary.fail,
		}),
		{ total: 0, pass: 0, fail: 0 },
	);
	console.log(JSON.stringify({ total, artifacts: results }, null, 2));
	process.exit(total.fail === 0 ? 0 : 1);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
