import { afterAll, describe, expect, test } from "bun:test";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildBrowserUseCorpusGeneration,
	type BrowserUseCorpusGenerationActionInput,
} from "./browser-use-corpus-generation-builder";
import { importBrowserUseCorpus } from "./browser-use-corpus-import";
import { composeBrowserUseCorpusMigration } from "./browser-use-corpus-migration-composition";
import {
	adoptBrowserUseGenerationCandidate,
} from "./browser-use-migration";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	actionAssetDigest,
	ONCORE_TIMESHEET_DIAGNOSIS_ACTION_BYTES,
} from "./browser-use-runbook-actions";
import { shippedCatalogDigest } from "./browser-use-catalog-digest";
import { shippedRunbooksRoot } from "./browser-use-runbook";
import { runForTest } from "./browser-use";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import { LIVE_CLEAN_PROFILE_POSTURE_FIXTURE } from "./browser-connect-handoff-fixtures";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

const disposables: Array<{ dispose(): void }> = [];
const tempRoots: string[] = [];
const fixtureRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-use-migration",
	"full-root-corpus",
);
const oncoreOrigin = "https://iteraterecruitment.oncoreservices.com";

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
	for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function reviewedDiagnosisAction(): BrowserUseCorpusGenerationActionInput {
	const digest = actionAssetDigest(ONCORE_TIMESHEET_DIAGNOSIS_ACTION_BYTES);
	return {
		assetBytes: ONCORE_TIMESHEET_DIAGNOSIS_ACTION_BYTES,
		record: {
			action_id: "oncore-diagnose-timesheet",
			asset_id: digest,
			expected_digest: digest,
			allowed_origin: oncoreOrigin,
			effect_class: "read",
			containment: "read-only-observation",
			input_schema: {
				kind: "object",
				fields: {
					timesheet_id: {
						required: true,
						schema: {
							kind: "string",
							max_length: 128,
							pattern: "^[A-Za-z0-9._:-]+$",
						},
					},
				},
			},
			result_schema: {
				kind: "object",
				fields: {
					timesheet_match: {
						required: true,
						schema: { kind: "boolean" },
					},
					row_count: {
						required: true,
						schema: { kind: "number" },
					},
					state: {
						required: true,
						schema: {
							kind: "enum",
							values: [
								"approved",
								"submitted",
								"editable",
								"read-only",
							],
						},
					},
					submit_available: {
						required: true,
						schema: { kind: "boolean" },
					},
				},
			},
			result_sensitivity: "low",
			source_provenance:
				"domains/iteraterecruitment-oncoreservices/domain-script-actions/diagnose-grid-state.js",
			promotion_receipt: {
				approved_digest: digest,
				disposition: "approved",
				approved_origin: oncoreOrigin,
				approved_effect: "read",
				approver_ref: "operator-review",
			},
		},
	};
}

function agentSuccess(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

function handoffEnvelope(runId: string) {
	return {
		status: "ok",
		run_id: runId,
		data: {
			outcome: "verified",
			environment: { name: "agent-chrome", profile: "default" },
			browser_entry_mode: "explicit-cdp",
			attachment: {
				adapter_id: "agent-browser",
				route: "explicit-cdp",
				probe_executable: "/opt/browser-connect/probe",
			},
			endpoint: {
				http: "http://127.0.0.1:9222",
				ws: "ws://127.0.0.1:9222/devtools/browser/fixture",
			},
			launch: { launched: false },
			proof: {
				environment_contract_id: "warm-chrome.browser-entry",
				environment_schema_version: "2",
				route_evidence: "verified-live",
				profile_posture: LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
			},
			contract_id: "browser-connect.verified-handoff",
			schema_version: "3",
		},
		error: null,
	};
}

describe("migrated runbook execution", () => {
	test("imports and activates Oncore diagnosis, then stops at the auth capability gate", async () => {
		const sourceRoot = mkdtempSync(join(tmpdir(), "bu-migrated-e2e-"));
		tempRoots.push(sourceRoot);
		cpSync(fixtureRoot, sourceRoot, { recursive: true });
		const diagnosisPath = join(
			sourceRoot,
			"domains",
			"iteraterecruitment-oncoreservices",
			"domain-script-actions",
			"diagnose-grid-state.js",
		);
		mkdirSync(dirname(diagnosisPath), { recursive: true });
		writeFileSync(diagnosisPath, "async () => ({ row_count: 0 })\n", {
			mode: 0o600,
		});

		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);
		const deps = {
			fs,
			paths: opened.paths,
			clock: fixedClock().now,
		};

		const imported = await importBrowserUseCorpus(deps, sourceRoot);
		expect(imported.ok).toBe(true);
		if (!imported.ok) throw new Error(imported.message);
		expect(
			imported.state.canonical_targets.map(
				(target) => target.canonical_target_id,
			),
		).toContain("oncore/timesheet-diagnose");
		expect(imported.generation.active_target_count).toBe(0);

		const action = reviewedDiagnosisAction();
		const generationId = `${imported.generation.generation_id}-approved`;
		const composition = await composeBrowserUseCorpusMigration(
			{ fs },
			{
				state: imported.state,
				sourceRoot,
				generationId,
				shippedCatalogDigest: await shippedCatalogDigest(
					shippedRunbooksRoot(),
					fs,
				),
				actions: [action],
				authCandidates: [
					{
						candidate_id: "auth-candidate-oncore",
						auth_context: "interactive-login",
						service_id: "oncore",
						legacy_context_prose: "delegated login shape",
						hint_item_id: null,
						proposed_origins: [oncoreOrigin],
						legacy_vault_name: null,
						provenance: "legacy-auth-pointer",
					},
				],
				authRoutes: [
					{
						authContextRef: "oncore-session",
						candidateId: "auth-candidate-oncore",
					},
				],
			},
		);
		expect(
			composition.targets.find(
				(target) =>
					target.canonicalTargetId === "oncore/timesheet-diagnose",
			)?.activation,
		).toBe("active");
		const generation = await buildBrowserUseCorpusGeneration(
			{ fs },
			composition,
		);
		const adopted = await adoptBrowserUseGenerationCandidate(deps, generation);
		expect(adopted.ok).toBe(true);
		if (!adopted.ok) throw new Error(adopted.message);

		const baseRuntime = makeRuntime({ env: xdg.env });
		const activated = await runForTest(
			[
				"migration",
				"activate",
				"--generation",
				generationId,
				"--json",
			],
			baseRuntime,
		);
		expect(activated.exitCode).toBe(0);

		const privateRoot = join(
			opened.paths.resolution.roots.runtime,
			"private-inputs",
		);
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		const privatePath = join(privateRoot, "timesheet-id.json");
		const privateTimesheetId = "TS-PRIVATE-427";
		writeFileSync(privatePath, JSON.stringify(privateTimesheetId), {
			mode: 0o600,
		});
		const runId = "run-migrated-oncore-diagnosis";
		const handoffPath = join(sourceRoot, "handoff.json");
		writeFileSync(handoffPath, JSON.stringify(handoffEnvelope(runId)), {
			mode: 0o600,
		});

		const calls: Array<readonly string[]> = [];
		const responses = [
			agentSuccess({
				tabs: [
					{
						tabId: "t-oncore",
						active: true,
						type: "page",
						url: `${oncoreOrigin}/timesheets/current`,
					},
				],
			}),
			agentSuccess({
				tabs: [
					{
						tabId: "t-oncore",
						active: true,
						type: "page",
						url: `${oncoreOrigin}/timesheets/current`,
					},
				],
			}),
			agentSuccess({ selected: true }),
			agentSuccess({ url: `${oncoreOrigin}/timesheets/current` }),
			agentSuccess({ snapshot: "timesheet grid", refs: {} }),
			agentSuccess({ url: `${oncoreOrigin}/timesheets/current` }),
			agentSuccess({
				result: {
					timesheet_match: true,
					row_count: 5,
					state: "editable",
					submit_available: true,
				},
			}),
		];
		let responseIndex = 0;
		const runtime = makeRuntime({
			env: xdg.env,
			platformFs: fs,
			readTextFile: (path) =>
				import("node:fs/promises").then((module) =>
					module.readFile(path, "utf8"),
				),
			ensureDirectory: (path) =>
				import("node:fs/promises").then((module) =>
					module
						.mkdir(path, { recursive: true, mode: 0o700 })
						.then(() => undefined),
				),
			writeTextFile: (path, contents) =>
				import("node:fs/promises").then((module) =>
					module.writeFile(path, contents, { mode: 0o600 }),
				),
			runCommand: async (input) => {
				calls.push([input.command, ...input.args]);
				return {
					exitCode: 0,
					stdout: responses[responseIndex++] ?? "",
					stderr: "",
				};
			},
		});
		const result = await runForTest(
			[
				"runbook",
				"run",
				"--service",
				"oncore",
				"--flow",
				"timesheet-diagnose",
				"--input-file",
				`timesheet_id=${privatePath}`,
				"--handoff",
				handoffPath,
				"--tab",
				"t-oncore",
				"--run-id",
				runId,
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: {
				code: "runbook_auth_capability_missing",
			},
			continuation: {
				next_action_id: "inspect-capability-loss",
			},
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.slice(-3)).toEqual(["tab", "list", "--json"]);
		expect(calls.every((call) => !call.includes("open"))).toBe(true);
		expect(calls.every((call) => !call.includes("snapshot"))).toBe(true);
		expect(calls.every((call) => !call.includes("eval"))).toBe(true);
		expect(`${result.stdout}\n${result.stderr}\n${JSON.stringify(calls)}`).not.toContain(
			privateTimesheetId,
		);
	});

	test("imports and safely refuses Oncore fill through the public CLI until split cadence is supported", async () => {
		const sourceRoot = mkdtempSync(join(tmpdir(), "bu-oncore-fill-e2e-"));
		tempRoots.push(sourceRoot);
		cpSync(fixtureRoot, sourceRoot, { recursive: true });
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);
		const deps = {
			fs,
			paths: opened.paths,
			clock: fixedClock().now,
		};
		const imported = await importBrowserUseCorpus(deps, sourceRoot);
		expect(imported.ok).toBe(true);
		if (!imported.ok) throw new Error(imported.message);
		const generationId = `${imported.generation.generation_id}-fill-proof`;
		const composition = await composeBrowserUseCorpusMigration(
			{ fs },
			{
				state: imported.state,
				sourceRoot,
				generationId,
				shippedCatalogDigest: await shippedCatalogDigest(
					shippedRunbooksRoot(),
					fs,
				),
				actions: [],
				authCandidates: [
					{
						candidate_id: "auth-candidate-oncore",
						auth_context: "interactive-login",
						service_id: "oncore",
						legacy_context_prose: "delegated login shape",
						hint_item_id: null,
						proposed_origins: [oncoreOrigin],
						legacy_vault_name: null,
						provenance: "legacy-auth-pointer",
					},
				],
				authRoutes: [
					{
						authContextRef: "oncore-session",
						candidateId: "auth-candidate-oncore",
					},
				],
			},
		);
		const fill = composition.targets.find(
			(target) => target.canonicalTargetId === "oncore/fill-timesheet",
		);
		expect(fill?.activation).toBe("inactive");
		expect(fill?.inactiveReason).toContain(
			"open-entry, wait, fill-entry, wait",
		);
		const generation = await buildBrowserUseCorpusGeneration(
			{ fs },
			composition,
		);
		const adopted = await adoptBrowserUseGenerationCandidate(deps, generation);
		expect(adopted.ok).toBe(true);
		if (!adopted.ok) throw new Error(adopted.message);
		const runtime = makeRuntime({ env: xdg.env });
		const activated = await runForTest(
			[
				"migration",
				"activate",
				"--generation",
				generationId,
				"--json",
			],
			runtime,
		);
		expect(activated.exitCode).toBe(0);

		const result = await runForTest(
			[
				"runbook",
				"run",
				"--service",
				"oncore",
				"--flow",
				"fill-timesheet",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "runbook_inactive",
		});
	});
});
