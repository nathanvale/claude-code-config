import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shippedCatalogDigest } from "./browser-use-catalog-digest";
import {
	type BrowserUsePlatformFs,
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import type { RunStoreDeps } from "./browser-use-runs";
import { createSharedRun, loadSharedRun } from "./browser-use-runs";
import type { BrowserUseSharedRun } from "./browser-use-run-model";
import {
	itemKeySequenceDigest,
	normalizedInputDigest,
} from "./browser-use-runbook-actions";
import {
	runbooksRoot,
	shippedRunbooksRoot,
} from "./browser-use-runbook";
import {
	LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
	verifiedHandoffEnvelope,
} from "./browser-connect-handoff-fixtures";
import type { BrowserUseRunbook } from "./browser-use-runbook-model";
import { stageGeneration } from "./browser-use-retention";
import {
	encodeDurableRecord,
	type BrowserUseCorpusGenerationCandidatePayload,
	type BrowserUseCorpusGenerationManifestPayload,
} from "./browser-use-schemas";
import type { BrowserUseGenerationSessionPolicy } from "./browser-use-generation-schemas";
import { writeDurableFile } from "./browser-use-store";
import { runForTest } from "./browser-use";
import type { BrowserUseRuntime } from "./browser-use-runtime";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";
import { candidateIdOf, targetEnvelopeIdOf } from "./browser-use-core";
import { parseHandoffFacts } from "./browser-use-discovery";
import { browserUseContracts } from "./command-contract";

// =========================================================================
// Wave-3 shared-CLI integration: chrome-devtools-mcp task-run dispatch and the
// live runbook family (list/show/run). CLI-level proof over the REAL driver via
// runForTest against a real temp XDG store. Adapter envelopes match the
// VERBATIM shapes proven in wave 1/2:
//   - agent-browser: {success, data, error}
//   - chrome-devtools-mcp: {content:[{type:"text",text}], isError?}
// =========================================================================

const disposables: { dispose(): void }[] = [];
afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

function writeTrackingPlatformFs(): {
	fs: BrowserUsePlatformFs;
	writeProbeCount: () => number;
} {
	const base = createDefaultPlatformFs();
	let writeProbes = 0;
	return {
		fs: {
			...base,
			async writeFile(path, contents, mode) {
				writeProbes += 1;
				await base.writeFile(path, contents, mode);
			},
		},
		writeProbeCount: () => writeProbes,
	};
}

// --- Handoff fixtures --------------------------------------------------------

function handoffEnvelope(adapterId: string, runId: string) {
	return {
		status: "ok",
		run_id: runId,
		data: {
			outcome: "verified",
			environment: { name: "agent-chrome", profile: "default" },
			browser_entry_mode: "explicit-cdp",
			attachment: {
				adapter_id: adapterId,
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

// --- MCP / agent-browser envelope shapes -------------------------------------

function mcpText(text: string): string {
	return JSON.stringify({ content: [{ type: "text", text }] });
}
function chromePagesListing(): string {
	return mcpText(
		["## Pages", "0: example (https://example.test/) [selected]"].join("\n"),
	);
}
function chromeConsole(): string {
	return mcpText("## Console messages\n(no messages)");
}
function chromeNetwork(): string {
	return mcpText("## Network requests\n(no requests)");
}
function chromeTraceStarted(): string {
	return mcpText("## Trace\nRecording started.");
}
function chromeTraceStopped(): string {
	return mcpText("## Trace\nRecording stopped; 1 trace captured.");
}
function agentSuccess(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

// --- Store setup -------------------------------------------------------------

async function makeStore(): Promise<{
	env: Record<string, string | undefined>;
	deps: RunStoreDeps;
	dataRoot: string;
	base: string;
}> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return {
		env: xdg.env,
		deps: { fs, paths: opened.paths, clock: fixedClock().now },
		dataRoot: opened.paths.data.root,
		base: xdg.base,
	};
}

function writeHandoff(base: string, adapterId: string, runId: string): string {
	const path = join(base, `handoff-${adapterId}.json`);
	writeFileSync(path, JSON.stringify(handoffEnvelope(adapterId, runId)), "utf-8");
	return path;
}

function seedRunbook(dataRoot: string, runbook: BrowserUseRunbook): void {
	const dir = join(runbooksRoot(dataRoot), runbook.service_id, runbook.flow_id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "runbook.json"), JSON.stringify(runbook), "utf-8");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function seedActiveGeneration(
	store: Awaited<ReturnType<typeof makeStore>>,
	runbook: BrowserUseRunbook,
	activation: "active" | "inactive" = "active",
	activationEpoch = 2,
	sessionPolicy?: BrowserUseGenerationSessionPolicy,
): Promise<BrowserUseCorpusGenerationManifestPayload> {
	const generationId = `generation-${runbook.flow_id}`;
	const runbookRaw = `${JSON.stringify(runbook)}\n`;
	const registryRaw = `${JSON.stringify({ actions: [] })}\n`;
	const proofRaw = `${JSON.stringify({ proof: "wave3" })}\n`;
	const runbookPath = `runbooks/${runbook.service_id}/${runbook.flow_id}/runbook.json`;
	const authContextRef = runbook.auth_context_ref;
	const authCandidate =
		authContextRef === undefined
			? undefined
			: {
					candidate_id: `candidate-${runbook.service_id}`,
					service_id: runbook.service_id,
					auth_context: "interactive-login",
					legacy_context_prose: null,
					hint_item_id: null,
					proposed_origins: runbook.allowed_origins,
					legacy_vault_name: null,
					provenance: "legacy-auth-pointer" as const,
				};
	const authRoute =
		authContextRef === undefined || authCandidate === undefined
			? undefined
			: {
					auth_context_ref: authContextRef,
					candidate_id: authCandidate.candidate_id,
					status: "active" as const,
					...(sessionPolicy === undefined
						? {}
						: { session_policy: sessionPolicy }),
				};
	const authCandidateRaw =
		authCandidate === undefined ? undefined : `${JSON.stringify(authCandidate)}\n`;
	const authRouteRaw =
		authRoute === undefined ? undefined : `${JSON.stringify(authRoute)}\n`;
	const shippedDigest = await shippedCatalogDigest(
		shippedRunbooksRoot(),
		store.deps.fs,
	);
	const target = {
		canonical_target_id: `${runbook.service_id}/${runbook.flow_id}`,
		activation,
		runbook_path: runbookPath,
		runbook_digest: sha256(runbookRaw),
		source_relative_paths: ["fixture/runbook.json"],
		proof_refs: ["proof-wave3"],
		inactive_reason:
			activation === "inactive"
				? "financial mutation remains staged"
				: null,
	} as const;
	const candidate = {
		contract: "browser-use.corpus-generation-candidate",
		schema_version: "1",
		generation_id: generationId,
		source_snapshot: {
			snapshot_id: "snapshot-wave3",
			snapshot_digest: "b".repeat(64),
		},
		canonical_targets: [target],
		action_registry: {
			registry_path: "actions/registry.json",
			registry_digest: sha256(registryRaw),
			actions: [],
		},
		auth:
			authCandidate === undefined ||
			authRoute === undefined ||
			authCandidateRaw === undefined ||
			authRouteRaw === undefined
				? { candidates: [], routes: [] }
				: {
						candidates: [
							{
								candidate_id: authCandidate.candidate_id,
								path: `auth/candidates/${authCandidate.candidate_id}.json`,
								digest: sha256(authCandidateRaw),
							},
						],
						routes: [
							{
								auth_context_ref: authRoute.auth_context_ref,
								candidate_id: authRoute.candidate_id,
								path: `auth/routes/${authRoute.auth_context_ref}.json`,
								digest: sha256(authRouteRaw),
							},
						],
					},
		proofs: [
			{
				proof_ref: "proof-wave3",
				path: "proofs/wave3.json",
				digest: sha256(proofRaw),
			},
		],
		shipped_catalog_digest: shippedDigest,
	} satisfies BrowserUseCorpusGenerationCandidatePayload;
	const candidateRaw = encodeDurableRecord(
		"corpus-generation-candidate",
		candidate,
	);
	const staged = await stageGeneration(store.deps, {
		generationId,
		files: [
			{ relPath: runbookPath, contents: runbookRaw },
			{ relPath: "actions/registry.json", contents: registryRaw },
			{ relPath: "proofs/wave3.json", contents: proofRaw },
			...(authCandidate === undefined || authCandidateRaw === undefined
				? []
				: [
						{
							relPath: `auth/candidates/${authCandidate.candidate_id}.json`,
							contents: authCandidateRaw,
						},
					]),
			...(authRoute === undefined || authRouteRaw === undefined
				? []
				: [
						{
							relPath: `auth/routes/${authRoute.auth_context_ref}.json`,
							contents: authRouteRaw,
						},
					]),
			{
				relPath: "corpus-generation-candidate.json",
				contents: candidateRaw,
			},
		],
	});
	if (!staged.ok) throw new Error(staged.message);
	const manifest: BrowserUseCorpusGenerationManifestPayload = {
		contract: "browser-use.corpus-generation-manifest",
		schema_version: "1",
		generation_id: generationId,
		generation_content_hash: staged.record.content_hash,
		candidate_manifest_digest: sha256(candidateRaw),
		activation_epoch: activationEpoch,
		activated_at_epoch_ms: 100,
		source_snapshot: candidate.source_snapshot,
		canonical_targets: candidate.canonical_targets,
		action_registry: candidate.action_registry,
		auth: candidate.auth,
		proofs: candidate.proofs,
		shipped_catalog_digest: candidate.shipped_catalog_digest,
		prior_generation: null,
		retained_generations: [],
	};
	await store.deps.fs.mkdir(store.deps.paths.state.migrationsDir, {
		recursive: true,
		mode: 0o700,
	});
	const manifestWrite = await writeDurableFile(store.deps.fs, {
		path: join(
			store.deps.paths.state.migrationsDir,
			"active-corpus-manifest.json",
		),
		contents: encodeDurableRecord("corpus-generation-manifest", manifest),
	});
	if (!manifestWrite.ok) throw new Error(manifestWrite.failure.message);
	await store.deps.fs.mkdir(
		join(store.deps.paths.state.migrationsDir, "effect-fences"),
		{ recursive: true, mode: 0o700 },
	);
	const fenceWrite = await writeDurableFile(store.deps.fs, {
		path: join(
			store.deps.paths.state.migrationsDir,
			"effect-fences",
			`${activationEpoch}.json`,
		),
		contents: encodeDurableRecord("generation-effect-fence", {
			generation_id: generationId,
			activation_epoch: activationEpoch,
			state: "untripped",
			tripped_at_epoch_ms: null,
			first_effect: null,
		}),
	});
	if (!fenceWrite.ok) throw new Error(fenceWrite.failure.message);
	const pendingWrite = await writeDurableFile(store.deps.fs, {
		path: join(
			store.deps.paths.state.migrationsDir,
			"activation-pending.json",
		),
		contents: encodeDurableRecord("activation-pending", {
			expected_epoch: activationEpoch - 1,
			target_generation_id: generationId,
			generation_content_hash: manifest.generation_content_hash,
			candidate_manifest_digest: manifest.candidate_manifest_digest,
		}),
	});
	if (!pendingWrite.ok) throw new Error(pendingWrite.failure.message);
	const epochWrite = await writeDurableFile(store.deps.fs, {
		path: store.deps.paths.state.epochFile,
		contents: encodeDurableRecord("activation-epoch", {
			epoch: activationEpoch,
		}),
	});
	if (!epochWrite.ok) throw new Error(epochWrite.failure.message);
	const stateWrite = await writeDurableFile(store.deps.fs, {
		path: join(store.deps.paths.state.migrationsDir, "migration-state.json"),
		contents: `${JSON.stringify(
			{
				contract: "browser-use.migration-status",
				schema_version: "2",
				phase: "verified",
				snapshot_id: candidate.source_snapshot.snapshot_id,
				snapshot_digest: candidate.source_snapshot.snapshot_digest,
				source_root_identity: "a".repeat(64),
				source_entry_count: 0,
				disposition_count: 0,
				dispositions: [],
				corpus_census: null,
				canonical_targets: [],
				staged_generation: generationId,
				last_apply_verified_noop: false,
				activation_state: "active",
			},
			null,
			"\t",
		)}\n`,
	});
	if (!stateWrite.ok) throw new Error(stateWrite.failure.message);
	return manifest;
}

// A read-only seed runbook: one open + one snapshot, no confidential input, no
// declared inputs (so a fresh run reaches total_steps and confirms).
function readOnlyRunbook(): BrowserUseRunbook {
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "oncore",
		flow_id: "snapshot-verify",
		flow_name: "verify-loaded",
		version: "2",
		summary: "Read-only snapshot verification.",
		allowed_origins: ["https://example.test"],
		inputs: [],
		steps: [
			{
				kind: "open",
				url: "https://example.test/",
				postcondition: { kind: "url-equals", url: "https://example.test/" },
			},
			{ kind: "snapshot", interactive: true },
		],
	};
}

function authBoundReadOnlyRunbook(): BrowserUseRunbook {
	return {
		...readOnlyRunbook(),
		auth_context_ref: "oncore-session",
	};
}

const AUTH_SESSION_POLICY: BrowserUseGenerationSessionPolicy = {
	schema_version: "1",
	approved_service_origins: ["https://example.test"],
	approved_identity_provider_origins: ["https://login.example.test"],
	auth_flow: {
		schema_version: "1",
		fields: {
			username: { role: "textbox", name: "Username" },
			password: { role: "textbox", name: "Password" },
			otp: { role: "textbox", name: "Verification code" },
		},
		identify_state: {
			action_id: "identify-login-state",
			expected_digest: "1".repeat(64),
		},
		username_submit: {
			action_id: "submit-username",
			expected_digest: "2".repeat(64),
		},
		password_submit: {
			action_id: "submit-password",
			expected_digest: "3".repeat(64),
		},
		otp_submit: {
			action_id: "submit-otp",
			expected_digest: "4".repeat(64),
		},
	},
	identity_verifier: {
		schema_version: "1",
		action: {
			action_id: "verify-session",
			expected_digest: "5".repeat(64),
		},
		expected: {
			subject_reference: "subject-primary",
			account_reference: "account-primary",
			tenant_reference: "tenant-primary",
		},
		freshness_ms: 30_000,
	},
};

// A runtime replaying a scripted adapter response sequence over the real store.
function scriptedRuntime(
	env: Record<string, string | undefined>,
	responses: readonly { stdout?: string; exitCode?: number; timedOut?: boolean }[],
	platformFs: BrowserUsePlatformFs = createDefaultPlatformFs(),
	runtimeOverrides: Partial<BrowserUseRuntime> = {},
) {
	let index = 0;
	const calls: Array<readonly string[]> = [];
	return {
		calls,
		runtime: makeRuntime({
			env,
			now: () => 1_000,
			platformFs,
			readTextFile: (path: string) =>
				import("node:fs/promises").then((m) => m.readFile(path, "utf-8")),
			// Real disk write seams so the chrome executor's native-artifact write
			// actually lands under the temp store (this is a CLI integration proof
			// over the real driver, not a stubbed unit). ensureDirectory mirrors the
			// default runtime's recursive 0700 mkdir; writeTextFile writes the bytes.
			ensureDirectory: (path: string) =>
				import("node:fs/promises").then((m) =>
					m.mkdir(path, { recursive: true, mode: 0o700 }).then(() => undefined),
				),
			writeTextFile: (path: string, contents: string) =>
				import("node:fs/promises").then((m) =>
					m.writeFile(path, contents, { mode: 0o600 }),
				),
			...runtimeOverrides,
			runCommand: async (input) => {
				calls.push([input.command, ...input.args]);
				const response = responses[index++] ?? {};
				return {
					exitCode: response.exitCode ?? 0,
					stdout: response.stdout ?? "",
					stderr: "",
					...(response.timedOut === undefined ? {} : { timedOut: response.timedOut }),
				};
			},
		}),
	};
}

// =========================================================================
// chrome-devtools-mcp task-run dispatch (release contract R9, R21; F6)
// =========================================================================

describe("task run — chrome-devtools-mcp dispatch (U4 wiring)", () => {
	test("a debug intent compiles to console + network and confirms read-only", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-chrome-1");
		// The debug intent compiles (compileChromeOperationSet) to console-read +
		// network-read: list_pages (origin proof) then list_console_messages then
		// list_network_requests. Both reads are bounded native evidence, no artifact.
		const { runtime, calls } = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeConsole() },
			{ stdout: chromeNetwork() },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		const data = json.data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.shared-run");
		expect(data.selected_lane).toBe("chrome-devtools-mcp");
		expect(data.external_effect).toBe("none");
		const run = data.run as Record<string, unknown>;
		expect(run.state).toBe("confirmed");
		expect(run.adapter_id).toBe("chrome-devtools-mcp");
		// The executor drove the compiled chrome tool set, never the agent-browser CLI.
		expect(calls[0]?.join(" ")).toContain("list_pages");
		expect(calls[1]?.join(" ")).toContain("list_console_messages");
		expect(calls[2]?.join(" ")).toContain("list_network_requests");
		// debug is a two-op read set: no artifact-producing tool ran.
		expect(calls.some((c) => c.join(" ").includes("performance_start_trace"))).toBe(
			false,
		);
	});

	test("a non-integer --tab is refused before any chrome call AND before any run is created", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-chrome-2");
		const { runtime, calls } = scriptedRuntime(store.env, []);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "not-a-number",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "task_run_lane_refused",
		});
		expect(calls).toHaveLength(0);
		// The usage error must NOT have persisted a run keyed on the handoff's run
		// id: a stray `running` run here would poison the handoff, turning every
		// corrected retry into a store_record_conflict.
		const orphan = await loadSharedRun(store.deps, "run-chrome-2");
		expect(orphan.ok).toBe(false);
		// A corrected retry with the SAME handoff proceeds cleanly (no conflict).
		const retryRuntime = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeConsole() },
			{ stdout: chromeNetwork() },
		]);
		const retried = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			retryRuntime.runtime,
		);
		expect(retried.exitCode).toBe(0);
		const retriedRun = (parseJson(retried.stdout).data as Record<string, unknown>)
			.run as Record<string, unknown>;
		expect(retriedRun.run_id).toBe("run-chrome-2");
		expect(retriedRun.state).toBe("confirmed");
	});

	test("a performance-profile intent compiles to a trace and persists an artifact reference", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-chrome-3");
		// performance-profile compiles to a performance-trace op: list_pages
		// (origin proof) then performance_start_trace + performance_stop_trace. The
		// driver creates the artifact_dir before dispatch, so the trace op produces
		// a native artifact reference the run persists (R21).
		const { runtime, calls } = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeTraceStarted() },
			{ stdout: chromeTraceStopped() },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "performance-profile",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const run = (parseJson(result.stdout).data as Record<string, unknown>)
			.run as Record<string, unknown>;
		expect(run.state).toBe("confirmed");
		// The compiled trace op drove start/stop and produced one export artifact.
		expect(calls[1]?.join(" ")).toContain("performance_start_trace");
		expect(calls[2]?.join(" ")).toContain("performance_stop_trace");
		const artifacts = run.artifacts as Array<Record<string, unknown>>;
		expect(Array.isArray(artifacts)).toBe(true);
		expect(artifacts).toHaveLength(1);
		const artifactId = artifacts[0]?.artifact_id as string;
		expect(artifactId).toContain("perf-trace");
		expect(artifacts[0]?.retention).toBe("export");
		// The artifact reference is not just a name: the executor WROTE the native
		// trace evidence to the derived path, so a file exists on disk carrying the
		// captured trace summary (closes finding #2 — no advertised-but-absent
		// evidence).
		const artifactPath = join(
			store.deps.paths.state.artifactDir("run-chrome-3"),
			artifactId,
		);
		const bytes = readFileSync(artifactPath, "utf-8");
		expect(bytes).toContain("trace captured");
		// The durable run reads back with the persisted artifact reference.
		const loaded = await loadSharedRun(store.deps, "run-chrome-3");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.artifacts).toHaveLength(1);
	});
});

// =========================================================================
// Runbook family — live list/show/run (platform plan U4)
// =========================================================================

describe("runbook family — live (U4 wiring)", () => {
	test("runbook run discovery advertises every target repair continuation", () => {
		const actionIds =
			browserUseContracts["runbook-run"].actionAffordances?.failure.map(
				(action) => action.id,
			) ?? [];
		expect(actionIds).toEqual(
			expect.arrayContaining([
				"prepare_unique_runbook_target",
				"refresh_runbook_handoff",
				"restore_bound_runbook_target",
			]),
		);
	});

	test("runbook list projects the discovered catalog (no not-implemented)", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const result = await runForTest(
			["runbook", "list", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(JSON.stringify(json)).not.toContain("browser_use_not_implemented");
		const data = json.data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.runbook-catalog");
		const rows = data.runbooks as Array<Record<string, unknown>>;
		// The catalog merges the code-owned shipped seed with the seeded store
		// row; the seeded oncore/snapshot-verify must appear among them.
		const seeded = rows.find(
			(r) => r.service_id === "oncore" && r.flow_id === "snapshot-verify",
		);
		expect(seeded).toBeDefined();
		expect(data.runbook_count).toBe(rows.length);
	});

	test("runbook show returns one validated definition and health", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const result = await runForTest(
			["runbook", "show", "--service", "oncore", "--flow", "snapshot-verify", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.runbook-definition");
		expect(data.health).toBe("healthy");
		const runbook = data.runbook as Record<string, unknown>;
		expect(runbook.service_id).toBe("oncore");
	});

	test("active generation wins the same list/show shadow matrix", async () => {
		const store = await makeStore();
		const activeRunbook: BrowserUseRunbook = {
			...readOnlyRunbook(),
			summary: "Active generation summary.",
		};
		await seedActiveGeneration(store, activeRunbook);
		seedRunbook(store.dataRoot, {
			...activeRunbook,
			summary: "Compatibility override summary.",
		});
		const listed = await runForTest(
			["runbook", "list", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(listed.exitCode).toBe(0);
		const rows = (
			parseJson(listed.stdout).data as {
				runbooks: Array<Record<string, unknown>>;
			}
		).runbooks;
		expect(
			rows.find(
				(row) =>
					row.service_id === activeRunbook.service_id &&
					row.flow_id === activeRunbook.flow_id,
			),
		).toMatchObject({ summary: activeRunbook.summary });
		const shown = await runForTest(
			[
				"runbook",
				"show",
				"--service",
				activeRunbook.service_id,
				"--flow",
				activeRunbook.flow_id,
				"--json",
			],
			makeRuntime({ env: store.env }),
		);
		expect(shown.exitCode).toBe(0);
		expect(
			(parseJson(shown.stdout).data as {
				runbook: { summary: string };
			}).runbook.summary,
		).toBe(activeRunbook.summary);
	});

	test("completed activation with a missing manifest never falls back to compatibility", async () => {
		const store = await makeStore();
		const activeRunbook: BrowserUseRunbook = {
			...readOnlyRunbook(),
			summary: "Active generation summary.",
		};
		await seedActiveGeneration(store, activeRunbook);
		seedRunbook(store.dataRoot, {
			...activeRunbook,
			summary: "Compatibility override summary.",
		});
		await store.deps.fs.unlink(
			join(
				store.deps.paths.state.migrationsDir,
				"active-corpus-manifest.json",
			),
		);

		const listed = await runForTest(
			["runbook", "list", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(listed.exitCode).toBe(20);
		expect(parseJson(listed.stdout).error).toMatchObject({
			code: "runbook_catalog_drift",
		});
		expect(listed.stdout).not.toContain("Compatibility override summary.");
	});

	test("runbook show for a missing runbook fails closed with a typed refusal", async () => {
		const store = await makeStore();
		const result = await runForTest(
			["runbook", "show", "--service", "oncore", "--flow", "absent", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "runbook_not_found",
		});
	});

	test("duplicate ordinary runbook input ids are refused without exposing values", async () => {
		const firstValue = "first-input-secret";
		const secondValue = "second-input-secret";
		const result = await runForTest(
			[
				"runbook",
				"run",
				"--service",
				"oncore",
				"--flow",
				"snapshot-verify",
				"--input",
				`account=${firstValue}`,
				"--input",
				`account=${secondValue}`,
				"--json",
			],
			makeRuntime(),
		);

		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "task_run_lane_refused",
			message:
				"each --input id may be supplied only once; received account=[redacted].",
		});
		expect(`${result.stdout}\n${result.stderr}`).not.toContain(firstValue);
		expect(`${result.stdout}\n${result.stderr}`).not.toContain(secondValue);
	});

	test("runbook run dispatches the read-only runbook through agent-browser and confirms", async () => {
		const store = await makeStore();
		await seedActiveGeneration(store, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "agent-browser", "run-runbook-1");
		// agent-browser executor sequence for open + snapshot: tab list, tab select,
		// open, get-url (open postcondition), snapshot.
		const { runtime } = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [{ tabId: "t1", active: true, type: "page", url: "https://example.test/" }],
				}),
			},
			{
				stdout: agentSuccess({
					tabs: [{ tabId: "t1", active: true, type: "page", url: "https://example.test/" }],
				}),
			},
			{ stdout: agentSuccess({ selected: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ opened: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ snapshot: "@e1 button", refs: { "@e1": {} } }) },
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--tab", "t1",
				"--run-id", "invocation-runbook-1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.shared-run");
		expect(data.selected_lane).toBe("agent-browser");
		const run = data.run as Record<string, unknown>;
		expect(run.task_intent).toBe("runbook-execution");
		expect(run.state).toBe("confirmed");
		// The run is durable and readable back as confirmed truth.
		const loaded = await loadSharedRun(store.deps, "run-runbook-1");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run.state).toBe("confirmed");
			expect(loaded.run.run_execution_binding).toMatchObject({
				generation_id: "generation-snapshot-verify",
				activation_epoch: 2,
				service_id: "oncore",
				flow_id: "snapshot-verify",
			});
		}
		const fence = JSON.parse(
			readFileSync(
				join(
					store.deps.paths.state.migrationsDir,
					"effect-fences",
					"2.json",
				),
				"utf8",
			),
		) as {
			payload: {
				state: string;
				first_effect: { effect_kind: string; effect_ref: string };
			};
		};
		expect(fence.payload).toMatchObject({
			state: "tripped",
			first_effect: {
				effect_kind: "external-dispatch",
				effect_ref: "run-runbook-1",
			},
		});
	});

	test("a legacy auth route blocks before handoff or browser effects", async () => {
		const store = await makeStore();
		await seedActiveGeneration(store, authBoundReadOnlyRunbook());
		const handoffPath = writeHandoff(
			store.base,
			"agent-browser",
			"run-auth-bound-1",
		);
		const { runtime, calls } = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
		]);
		const result = await runForTest(
			[
				"runbook",
				"run",
				"--service",
				"oncore",
				"--flow",
				"snapshot-verify",
				"--handoff",
				handoffPath,
				"--tab",
				"t1",
				"--run-id",
				"invocation-auth-bound-1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const envelope = parseJson(result.stdout);
		expect(envelope.error).toMatchObject({
			code: "runbook_auth_session_policy_unproven",
		});
		expect(envelope.runtime_actions).toMatchObject([
			{ id: "inspect-auth-readiness" },
		]);
		expect(calls).toEqual([]);
		const loaded = await loadSharedRun(store.deps, "run-auth-bound-1");
		expect(loaded.ok).toBe(false);
	});

	test("every sensitive auth resume recovers its claim before handoff or adapter work", async () => {
		const cases = [
			[
				"before-username-delivery",
				"delivery-outcome-unknown",
				"runbook_auth_delivery_outcome_unknown",
			],
			[
				"before-password-delivery",
				"delivery-outcome-unknown",
				"runbook_auth_delivery_outcome_unknown",
			],
			[
				"before-otp-delivery",
				"delivery-outcome-unknown",
				"runbook_auth_delivery_outcome_unknown",
			],
			[
				"delivery-outcome-unknown",
				"delivery-outcome-unknown",
				"runbook_auth_delivery_outcome_unknown",
			],
			[
				"before-username-submit",
				"submission-outcome-unknown",
				"runbook_auth_submission_outcome_unknown",
			],
			[
				"before-password-submit",
				"submission-outcome-unknown",
				"runbook_auth_submission_outcome_unknown",
			],
			[
				"before-otp-submit",
				"submission-outcome-unknown",
				"runbook_auth_submission_outcome_unknown",
			],
			[
				"submission-outcome-unknown",
				"submission-outcome-unknown",
				"runbook_auth_submission_outcome_unknown",
			],
			[
				"human-presence-required",
				"user-presence-required",
				"runbook_auth_human_presence_required",
			],
			[
				"session-identity-unproven",
				"session-identity-unproven",
				"runbook_auth_identity_unproven",
			],
		] as const;

		for (const [
			caseIndex,
			[checkpoint, reason, expectedCode],
		] of cases.entries()) {
			const store = await makeStore();
			const runbook = authBoundReadOnlyRunbook();
			const manifest = await seedActiveGeneration(
				store,
				runbook,
				"active",
				2,
				AUTH_SESSION_POLICY,
			);
			const runId = `run-sensitive-${caseIndex}`;
			const envelope = handoffEnvelope("agent-browser", runId);
			const handoffPath = join(
				store.base,
				`handoff-sensitive-${caseIndex}.json`,
			);
			writeFileSync(
				handoffPath,
				JSON.stringify(envelope),
				"utf-8",
			);
			const parsed = parseHandoffFacts(JSON.stringify(envelope));
			if (!parsed.ok || parsed.kind !== "verified") {
				throw new Error("fixture handoff invalid");
			}
			const targetEnvelopeId = targetEnvelopeIdOf({
				runId,
				mode: "handoff-bound",
				adapter: "agent-browser",
				handoffEvidenceId: parsed.facts.handoffEvidenceId,
			});
			const targetBindingId = candidateIdOf(targetEnvelopeId, [
				"adapter_page_id",
				"t1",
			]);
			const runbookRaw = `${JSON.stringify(runbook)}\n`;
			const postcondition = runbook.steps[0];
			if (postcondition?.kind !== "open") {
				throw new Error("fixture postcondition missing");
			}
			const authRouteRaw = `${JSON.stringify({
				auth_context_ref: runbook.auth_context_ref,
				candidate_id: `candidate-${runbook.service_id}`,
				status: "active",
				session_policy: AUTH_SESSION_POLICY,
			})}\n`;
			const created = await createSharedRun(store.deps, {
				run_id: runId,
				state: "awaiting-auth",
				task_intent: "runbook-execution",
				environment_profile: {
					environment: "agent-chrome",
					profile: "default",
				},
				adapter_id: "agent-browser",
				handoff_evidence_id:
					parsed.facts.handoffEvidenceId,
				runbook_target_binding: {
					schema_version: "1",
					mode: "automatic",
					binding_id: targetBindingId,
				},
				runbook_progress: {
					schema_version: "1",
					service_id: runbook.service_id,
					flow_id: runbook.flow_id,
					runbook_version: runbook.version,
					next_step: 0,
					total_steps: runbook.steps.length,
				},
				run_execution_binding: {
					schema_version: "1",
					generation_id: manifest.generation_id,
					activation_epoch:
						manifest.activation_epoch,
					service_id: runbook.service_id,
					flow_id: runbook.flow_id,
					runbook_version: runbook.version,
					runbook_digest: sha256(runbookRaw),
					action_registry_digest:
						manifest.action_registry.registry_digest,
					normalized_input_digest:
						normalizedInputDigest({}),
					item_key_digest: itemKeySequenceDigest([]),
					target_scope: JSON.stringify(
						[...runbook.allowed_origins].sort(),
					),
					postcondition: {
						id: sha256(
							JSON.stringify(
								postcondition.postcondition,
							),
						),
						summary:
							"Complete the bound url-equals postcondition.",
					},
				},
				mutation_dispatched: false,
				artifacts: [],
				continuation: {
					schema_version: "1",
					kind: "auth",
					continuation_id: `continuation-sensitive-${caseIndex}`,
					run_id: runId,
					state: "pending",
					reason,
					required_actor: "agent",
					safe_to_retry: false,
					checkpoint,
					expires_at_epoch_ms: 10_000,
					resume_action: {
						command: "run",
						args: [
							"resume",
							"--run",
							runId,
							"--json",
						],
					},
					bindings: {
						generation_id: manifest.generation_id,
						activation_epoch:
							manifest.activation_epoch,
						route_digest: sha256(authRouteRaw),
						lane_id: "agent-browser",
						adapter_id: "agent-browser",
						handoff_evidence_id:
							parsed.facts.handoffEvidenceId,
						environment: "agent-chrome",
						profile: "default",
						target_binding_id: targetBindingId,
						expected_identity: {
							subject_ref:
								AUTH_SESSION_POLICY
									.identity_verifier.expected
									.subject_reference,
							account_ref:
								AUTH_SESSION_POLICY
									.identity_verifier.expected
									.account_reference,
							tenant_ref:
								AUTH_SESSION_POLICY
									.identity_verifier.expected
									.tenant_reference,
						},
					},
					next_action_id:
						"resume-auth-continuation",
					summary:
						"Inspect this sensitive checkpoint before any browser work.",
				},
			});
			expect(created.ok).toBe(true);

			let mintCalls = 0;
			const scripted = scriptedRuntime(store.env, []);
			scripted.runtime.mintHandoff = async () => {
				mintCalls += 1;
				throw new Error("handoff acquisition must not run");
			};
			const result = await runForTest(
				[
					"runbook",
					"run",
					"--service",
					runbook.service_id,
					"--flow",
					runbook.flow_id,
					"--run",
					runId,
					"--handoff",
					handoffPath,
					"--json",
				],
				scripted.runtime,
			);

			expect(result.exitCode).toBe(20);
			expect(parseJson(result.stdout)).toMatchObject({
				error: {
					code: expectedCode,
				},
				data: {
					checkpoint,
					external_effect: "none",
				},
			});
			expect(mintCalls).toBe(0);
			expect(scripted.calls).toEqual([]);
			const loaded = await loadSharedRun(store.deps, runId);
			expect(loaded.ok).toBe(true);
			if (loaded.ok) {
				expect(loaded.run.revision).toBe(3);
				expect(loaded.run.continuation).toMatchObject({
					state: "pending",
					checkpoint,
				});
			}
		}
	});

	test("inactive generation target refuses before handoff acquisition", async () => {
		const store = await makeStore();
		await seedActiveGeneration(store, readOnlyRunbook(), "inactive");
		const tracked = writeTrackingPlatformFs();
		const result = await runForTest(
			[
				"runbook",
				"run",
				"--service",
				"oncore",
				"--flow",
				"snapshot-verify",
				"--input-file",
				`payload=${join(
					store.deps.paths.resolution.roots.runtime,
					"private-inputs",
					"missing.json",
				)}`,
				"--handoff",
				join(store.base, "missing-handoff.json"),
				"--json",
			],
			makeRuntime({ env: store.env, platformFs: tracked.fs }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "runbook_inactive",
		});
		expect(tracked.writeProbeCount()).toBe(0);
	});

	test("active generation wrong-lane handoff refuses before tripping the effect fence", async () => {
		const store = await makeStore();
		await seedActiveGeneration(store, readOnlyRunbook());
		const handoffPath = writeHandoff(
			store.base,
			"chrome-devtools-mcp",
			"run-wrong-lane",
		);
		const result = await runForTest(
			[
				"runbook",
				"run",
				"--service",
				"oncore",
				"--flow",
				"snapshot-verify",
				"--handoff",
				handoffPath,
				"--json",
			],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "task_run_handoff_lane_mismatch",
		});
		const fence = JSON.parse(
			readFileSync(
				join(
					store.deps.paths.state.migrationsDir,
					"effect-fences",
					"2.json",
				),
				"utf8",
			),
		) as { payload: { state: string } };
		expect(fence.payload.state).toBe("untripped");
	});

	test("private structured input stays out of output and persists only its binding digest", async () => {
		const store = await makeStore();
		const runbook: BrowserUseRunbook = {
			...readOnlyRunbook(),
			flow_id: "private-input",
			inputs: [
				{
					id: "payload",
					summary: "Private structured payload.",
					required: true,
					custody: "sensitive",
					schema: {
						kind: "object",
						fields: {
							name: {
								schema: { kind: "string" },
								required: true,
							},
						},
					},
				},
			],
		};
		await seedActiveGeneration(store, runbook);
		const privateRoot = join(
			store.deps.paths.resolution.roots.runtime,
			"private-inputs",
		);
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		const privatePath = join(privateRoot, "payload.json");
		const sentinel = "private-sentinel-wave3";
		writeFileSync(
			privatePath,
			JSON.stringify({ name: sentinel }),
			{ encoding: "utf8", mode: 0o600 },
		);
		const handoffPath = writeHandoff(
			store.base,
			"agent-browser",
			"run-private-input",
		);
		const { runtime, calls } = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{ stdout: agentSuccess({ selected: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ opened: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{
				stdout: agentSuccess({
					snapshot: "@e1 button",
					refs: { "@e1": {} },
				}),
			},
		]);
		const result = await runForTest(
			[
				"runbook",
				"run",
				"--service",
				"oncore",
				"--flow",
				"private-input",
				"--input-file",
				`payload=${privatePath}`,
				"--handoff",
				handoffPath,
				"--tab",
				"t1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).not.toContain(sentinel);
		expect(result.stderr).not.toContain(sentinel);
		expect(JSON.stringify(calls)).not.toContain(sentinel);
		const loaded = await loadSharedRun(store.deps, "run-private-input");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run.run_execution_binding).toMatchObject({
				generation_id: "generation-private-input",
				normalized_input_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
			});
			expect(JSON.stringify(loaded.run)).not.toContain(sentinel);
		}
	});

	test("runbook run on a chrome handoff fails closed, never substitutes the lane (R11)", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-runbook-2");
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--json",
			],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "task_run_handoff_lane_mismatch",
		});
	});

	test("a fresh runbook target failure creates no orphan run", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "agent-browser", "run-runbook-blocked");
		const { runtime } = scriptedRuntime(store.env, [
			{ stdout: agentSuccess({ tabs: [] }) },
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "agent_browser_target_unavailable",
		});
		expect(
			(parseJson(result.stdout).continuation as Record<string, unknown>)
				.next_action_id,
		).toBe("prepare_unique_runbook_target");
		const loaded = await loadSharedRun(store.deps, "run-runbook-blocked");
		expect(loaded.ok).toBe(false);
	});

	test("a target-list transport failure requests a fresh handoff, not tab repair", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(
			store.base,
			"agent-browser",
			"run-runbook-transport",
		);
		const { runtime, calls } = scriptedRuntime(store.env, [
			{
				exitCode: 1,
				stdout: JSON.stringify({
					success: false,
					data: null,
					error: "CDP WebSocket connect failed",
				}),
			},
			{ stdout: agentSuccess({ cdpUrl: "ws://fixture" }) },
			{
				exitCode: 1,
				stdout: JSON.stringify({
					success: false,
					data: null,
					error: "CDP WebSocket connect failed",
				}),
			},
			{ stdout: agentSuccess({ cdpUrl: "ws://fixture" }) },
			{
				exitCode: 1,
				stdout: JSON.stringify({
					success: false,
					data: null,
					error: "CDP WebSocket connect failed",
				}),
			},
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "agent_browser_connection_unstable" },
			continuation: { next_action_id: "refresh_runbook_handoff" },
			data: { external_effect: "none" },
		});
		expect(calls).toHaveLength(5);
		expect(
			(await loadSharedRun(store.deps, "run-runbook-transport")).ok,
		).toBe(false);
	});

	test("multiple automatic runbook targets fail closed before run creation", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(
			store.base,
			"agent-browser",
			"run-runbook-ambiguous",
		);
		const { runtime } = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [
						{ tabId: "t1", type: "page", url: "about:blank" },
						{ tabId: "t2", type: "page", url: "about:blank" },
					],
				}),
			},
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "agent_browser_target_ambiguous",
		});
		const loaded = await loadSharedRun(store.deps, "run-runbook-ambiguous");
		expect(loaded.ok).toBe(false);
	});

	test("a legacy unbound nonterminal run refuses before target resolution", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "agent-browser", "run-runbook-cursor");
		const seed: Omit<BrowserUseSharedRun, "revision"> = {
			run_id: "run-runbook-cursor",
			state: "needs-human",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: "seed-evidence",
			mutation_dispatched: false,
			artifacts: [],
			continuation: {
				next_action_id: "runbook-resume:1",
				summary: "connection dropped after the confirmed open step; resume from step 1.",
			},
		};
		const created = await createSharedRun(store.deps, seed);
		expect(created.ok).toBe(true);
		const { runtime, calls } = scriptedRuntime(store.env, []);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--run", "run-runbook-cursor",
				"--handoff", handoffPath,
				"--tab", "t1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "agent_browser_target_moved" },
			continuation: { next_action_id: "restore_bound_runbook_target" },
			data: { external_effect: "none" },
		});
		expect(calls).toHaveLength(0);
		const loaded = await loadSharedRun(store.deps, seed.run_id);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run.runbook_target_binding).toBeUndefined();
			expect(loaded.run.revision).toBe(1);
		}
	});

	test("a bound resumed runbook starts at the persisted cursor", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const runId = "run-runbook-bound-cursor";
		const envelope = handoffEnvelope("agent-browser", runId);
		const handoffPath = join(store.base, "handoff-agent-browser.json");
		writeFileSync(handoffPath, JSON.stringify(envelope), "utf-8");
		const parsed = parseHandoffFacts(JSON.stringify(envelope));
		expect(parsed).toMatchObject({ ok: true, kind: "verified" });
		if (!parsed.ok || parsed.kind !== "verified") {
			throw new Error("fixture handoff invalid");
		}
		const targetEnvelopeId = targetEnvelopeIdOf({
			runId,
			mode: "handoff-bound",
			adapter: "agent-browser",
			handoffEvidenceId: parsed.facts.handoffEvidenceId,
		});
		const seed: Omit<BrowserUseSharedRun, "revision"> = {
			run_id: runId,
			state: "needs-human",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: parsed.facts.handoffEvidenceId,
			runbook_target_binding: {
				schema_version: "1",
				mode: "automatic",
				binding_id: candidateIdOf(targetEnvelopeId, [
					"adapter_page_id",
					"t1",
				]),
			},
			runbook_progress: {
				schema_version: "1",
				service_id: "oncore",
				flow_id: "snapshot-verify",
				runbook_version: "2",
				next_step: 1,
				total_steps: 2,
			},
			continuation: {
				next_action_id: "runbook-resume:1",
				summary: "Resume from the first unproven step.",
			},
			mutation_dispatched: false,
			artifacts: [],
		};
		expect((await createSharedRun(store.deps, seed)).ok).toBe(true);
		const { runtime, calls } = scriptedRuntime(
			store.env,
			[
				{
					stdout: agentSuccess({
						tabs: [
							{
								tabId: "t1",
								active: true,
								type: "page",
								url: "https://example.test/",
							},
						],
					}),
				},
				{
					stdout: agentSuccess({
						tabs: [
							{
								tabId: "t1",
								active: true,
								type: "page",
								url: "https://example.test/",
							},
						],
					}),
				},
				{ stdout: agentSuccess({ selected: true }) },
				{ stdout: agentSuccess({ url: "https://example.test/" }) },
				{
					stdout: agentSuccess({
						snapshot: "@e1 button",
						refs: { "@e1": {} },
					}),
				},
			],
			createDefaultPlatformFs(),
			{
				mintHandoff: async () => ({
					exitCode: 0,
					stdout: JSON.stringify(envelope),
					stderr: "",
				}),
			},
		);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
					"--flow", "snapshot-verify",
					"--run", runId,
					"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(calls).toHaveLength(5);
		expect(calls.some((call) => call.includes("open"))).toBe(false);
	});

	test("a retained read-only run resumes only from its pinned generation", async () => {
		const store = await makeStore();
		const runbookA = readOnlyRunbook();
		const manifestA = await seedActiveGeneration(
			store,
			runbookA,
			"active",
			2,
		);
		const runId = "run-retained-generation-a";
		const envelope = handoffEnvelope("agent-browser", runId);
		const handoffPath = join(store.base, "handoff-retained-a.json");
		writeFileSync(handoffPath, JSON.stringify(envelope), "utf-8");
		const parsed = parseHandoffFacts(JSON.stringify(envelope));
		if (!parsed.ok || parsed.kind !== "verified") {
			throw new Error("fixture handoff invalid");
		}
		const targetEnvelopeId = targetEnvelopeIdOf({
			runId,
			mode: "handoff-bound",
			adapter: "agent-browser",
			handoffEvidenceId: parsed.facts.handoffEvidenceId,
		});
		const runbookRaw = `${JSON.stringify(runbookA)}\n`;
		const postcondition = runbookA.steps[0];
		if (postcondition?.kind !== "open") {
			throw new Error("fixture postcondition missing");
		}
		const seeded = await createSharedRun(store.deps, {
			run_id: runId,
			state: "needs-human",
			task_intent: "runbook-execution",
			environment_profile: {
				environment: "agent-chrome",
				profile: "default",
			},
			adapter_id: "agent-browser",
			handoff_evidence_id: parsed.facts.handoffEvidenceId,
			runbook_target_binding: {
				schema_version: "1",
				mode: "automatic",
				binding_id: candidateIdOf(targetEnvelopeId, [
					"adapter_page_id",
					"t1",
				]),
			},
			runbook_progress: {
				schema_version: "1",
				service_id: runbookA.service_id,
				flow_id: runbookA.flow_id,
				runbook_version: runbookA.version,
				next_step: 1,
				total_steps: runbookA.steps.length,
			},
			run_execution_binding: {
				schema_version: "1",
				generation_id: manifestA.generation_id,
				activation_epoch: manifestA.activation_epoch,
				service_id: runbookA.service_id,
				flow_id: runbookA.flow_id,
				runbook_version: runbookA.version,
				runbook_digest: sha256(runbookRaw),
				action_registry_digest:
					manifestA.action_registry.registry_digest,
				normalized_input_digest: normalizedInputDigest({}),
				item_key_digest: itemKeySequenceDigest([]),
				target_scope: JSON.stringify(
					[...runbookA.allowed_origins].sort(),
				),
				postcondition: {
					id: sha256(
						JSON.stringify(postcondition.postcondition),
					),
					summary:
						"Complete the bound url-equals postcondition.",
				},
			},
			mutation_dispatched: false,
			artifacts: [],
			continuation: {
				next_action_id: "runbook-resume:1",
				summary: "Resume from the first unproven step.",
			},
		});
		expect(seeded.ok).toBe(true);

		const runbookB: BrowserUseRunbook = {
			...readOnlyRunbook(),
			flow_id: "snapshot-next",
		};
		const manifestB = await seedActiveGeneration(
			store,
			runbookB,
			"active",
			3,
		);
		const identityA = {
			generation_id: manifestA.generation_id,
			generation_content_hash:
				manifestA.generation_content_hash,
			candidate_manifest_digest:
				manifestA.candidate_manifest_digest,
			activation_epoch: manifestA.activation_epoch,
		};
		const retainedManifest: BrowserUseCorpusGenerationManifestPayload = {
			...manifestB,
			prior_generation: identityA,
			retained_generations: [identityA],
		};
		const activeWrite = await writeDurableFile(store.deps.fs, {
			path: join(
				store.deps.paths.state.migrationsDir,
				"active-corpus-manifest.json",
			),
			contents: encodeDurableRecord(
				"corpus-generation-manifest",
				retainedManifest,
			),
		});
		expect(activeWrite.ok).toBe(true);

		const { runtime, calls } = scriptedRuntime(
			store.env,
			[
				{
					stdout: agentSuccess({
						tabs: [
							{
								tabId: "t1",
								active: true,
								type: "page",
								url: "https://example.test/",
							},
						],
					}),
				},
				{
					stdout: agentSuccess({
						tabs: [
							{
								tabId: "t1",
								active: true,
								type: "page",
								url: "https://example.test/",
							},
						],
					}),
				},
				{ stdout: agentSuccess({ selected: true }) },
				{ stdout: agentSuccess({ url: "https://example.test/" }) },
				{
					stdout: agentSuccess({
						snapshot: "@e1 button",
						refs: { "@e1": {} },
					}),
				},
			],
			createDefaultPlatformFs(),
			{
				mintHandoff: async () => ({
					exitCode: 0,
					stdout: JSON.stringify(envelope),
					stderr: "",
				}),
			},
		);
		const result = await runForTest(
			[
				"runbook",
				"run",
				"--service",
				runbookA.service_id,
				"--flow",
				runbookA.flow_id,
				"--run",
				runId,
				"--handoff",
				handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(calls.some((call) => call.includes("open"))).toBe(false);
		const loaded = await loadSharedRun(store.deps, runId);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run.state).toBe("confirmed");
			expect(loaded.run.run_execution_binding?.generation_id).toBe(
				manifestA.generation_id,
			);
		}
		const fenceB = JSON.parse(
			readFileSync(
				join(
					store.deps.paths.state.migrationsDir,
					"effect-fences",
					"3.json",
				),
				"utf8",
			),
		) as { payload: { state: string } };
		expect(fenceB.payload.state).toBe("untripped");
	});

	test("concurrent bound resumes produce one executor dispatch", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const runId = "run-runbook-concurrent";
		const envelope = handoffEnvelope("agent-browser", runId);
		const handoffPath = join(store.base, "handoff-agent-browser-concurrent.json");
		writeFileSync(handoffPath, JSON.stringify(envelope), "utf-8");
		const parsed = parseHandoffFacts(JSON.stringify(envelope));
		if (!parsed.ok || parsed.kind !== "verified") {
			throw new Error("fixture handoff invalid");
		}
		const targetEnvelopeId = targetEnvelopeIdOf({
			runId,
			mode: "handoff-bound",
			adapter: "agent-browser",
			handoffEvidenceId: parsed.facts.handoffEvidenceId,
		});
		expect(
			(
				await createSharedRun(store.deps, {
					run_id: runId,
					state: "needs-human",
					task_intent: "runbook-execution",
					environment_profile: {
						environment: "agent-chrome",
						profile: "default",
					},
					adapter_id: "agent-browser",
					handoff_evidence_id: parsed.facts.handoffEvidenceId,
					runbook_target_binding: {
						schema_version: "1",
						mode: "automatic",
						binding_id: candidateIdOf(targetEnvelopeId, [
							"adapter_page_id",
							"t1",
						]),
					},
					runbook_progress: {
						schema_version: "1",
						service_id: "oncore",
						flow_id: "snapshot-verify",
						runbook_version: "2",
						next_step: 1,
						total_steps: 2,
					},
					continuation: {
						next_action_id: "runbook-resume:1",
						summary: "Resume from the first unproven step.",
					},
					mutation_dispatched: false,
					artifacts: [],
				})
			).ok,
		).toBe(true);
		const calls: Array<readonly string[]> = [];
		let signalFirstSnapshotStarted: (() => void) | undefined;
		const firstSnapshotStarted = new Promise<void>((resolve) => {
			signalFirstSnapshotStarted = resolve;
		});
		let releaseFirstSnapshot: (() => void) | undefined;
		const firstSnapshotMayFinish = new Promise<void>((resolve) => {
			releaseFirstSnapshot = resolve;
		});
		let snapshotInvocationCount = 0;
		const runtime = makeRuntime({
			env: store.env,
			now: () => 1_000,
			platformFs: createDefaultPlatformFs(),
			mintHandoff: async () => ({
				exitCode: 0,
				stdout: JSON.stringify(envelope),
				stderr: "",
			}),
			readTextFile: (path: string) =>
				import("node:fs/promises").then((module) =>
					module.readFile(path, "utf-8"),
				),
			runCommand: async (input) => {
				const semantic = input.args.slice(4);
				calls.push(semantic);
				if (semantic[0] === "snapshot") {
					snapshotInvocationCount += 1;
					if (snapshotInvocationCount === 1) {
						signalFirstSnapshotStarted?.();
						await firstSnapshotMayFinish;
					}
					return {
						exitCode: 0,
						stdout: agentSuccess({ refs: {} }),
						stderr: "",
					};
				}
				const data =
					semantic[0] === "tab" && semantic[1] === "list"
						? {
								tabs: [
									{
										tabId: "t1",
										type: "page",
										url: "https://example.test/",
									},
								],
							}
						: semantic[0] === "get" && semantic[1] === "url"
							? { url: "https://example.test/" }
							: { selected: true };
				return { exitCode: 0, stdout: agentSuccess(data), stderr: "" };
			},
		});
		const argv = [
			"runbook", "run",
			"--service", "oncore",
			"--flow", "snapshot-verify",
			"--run", runId,
			"--handoff", handoffPath,
			"--json",
		] as const;
		const firstResultPromise = runForTest(argv, runtime);
		await firstSnapshotStarted;
		const secondResult = await runForTest(argv, runtime);
		releaseFirstSnapshot?.();
		const firstResult = await firstResultPromise;
		const results = [firstResult, secondResult];
		expect(
			results
				.map((result) => result.exitCode)
				.sort((left, right) => left - right),
		).toEqual([0, 20]);
		expect(calls.filter((call) => call[0] === "snapshot")).toHaveLength(1);
		const loaded = await loadSharedRun(store.deps, runId);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.state).toBe("confirmed");
	});

	test("a confirmed runbook resume is a no-op with no target or auth work", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const runId = "run-runbook-confirmed-noop";
		const handoffPath = writeHandoff(store.base, "agent-browser", runId);
		expect(
			(
				await createSharedRun(store.deps, {
					run_id: runId,
					state: "confirmed",
					task_intent: "runbook-execution",
					environment_profile: {
						environment: "agent-chrome",
						profile: "default",
					},
					adapter_id: "agent-browser",
					handoff_evidence_id: "legacy-confirmed-evidence",
					mutation_dispatched: false,
					artifacts: [],
				})
			).ok,
		).toBe(true);
		const tracked = writeTrackingPlatformFs();
		const { runtime, calls } = scriptedRuntime(store.env, [], tracked.fs);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--run", runId,
				"--input-file",
				`payload=${join(
					store.deps.paths.resolution.roots.runtime,
					"private-inputs",
					"missing.json",
				)}`,
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout)).toMatchObject({
			data: {
				run: { state: "confirmed" },
				external_effect: "none",
				executed_steps: 0,
				resume: "confirmed-no-op",
			},
		});
		expect(calls).toHaveLength(0);
		expect(tracked.writeProbeCount()).toBe(0);
		const loaded = await loadSharedRun(store.deps, runId);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.revision).toBe(1);
	});

	test("runbook run without --service is a usage error", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "agent-browser", "run-runbook-3");
		const result = await runForTest(
			["runbook", "run", "--flow", "snapshot-verify", "--handoff", handoffPath, "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({ code: "usage_error" });
	});
});

// =========================================================================
// Internal envelope mint (design brief D4,
// docs/plans/2026-07-27-agent-first-front-door-brief.md): a fresh
// `task run --intent` / `runbook run` without --handoff mints the Verified
// Handoff Envelope in-process through the runtime's mintHandoff seam and flows
// through the SAME parseHandoffFacts validation as a caller-supplied file.
// A mint failure is browser-connect's failure envelope surfaced VERBATIM.
// =========================================================================

describe("task run — internal envelope mint (D4)", () => {
	test("a fresh --intent run without --handoff mints for the intent's preferred adapter and confirms", async () => {
		const store = await makeStore();
		const scripted = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeConsole() },
			{ stdout: chromeNetwork() },
		]);
		const mintCalls: Array<{ adapterId: string; runId?: string }> = [];
		scripted.runtime.mintHandoff = async (input) => {
			mintCalls.push(input);
			return {
				exitCode: 0,
				stdout: JSON.stringify(
					handoffEnvelope(input.adapterId, input.runId ?? "run-minted"),
				),
				stderr: "",
			};
		};
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			scripted.runtime,
		);
		expect(result.exitCode).toBe(0);
		// debug's preferred lane is chrome-devtools-mcp; the mint attached it.
		expect(mintCalls).toHaveLength(1);
		expect(mintCalls[0]?.adapterId).toBe("chrome-devtools-mcp");
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.selected_lane).toBe("chrome-devtools-mcp");
		const run = data.run as Record<string, unknown>;
		expect(run.state).toBe("confirmed");
		// The minted envelope's run id became the durable shared run id.
		expect(run.run_id).toBe(mintCalls[0]?.runId);
	});

	test("a mint failure surfaces browser-connect's failure envelope verbatim with its exit code", async () => {
		const store = await makeStore();
		const scripted = scriptedRuntime(store.env, []);
		const failureEnvelope = JSON.stringify({
			status: "error",
			data: { outcome: "failed", failure_class: "environment-unavailable" },
			continuation: { next_action_id: "inspect_agent_chrome" },
		});
		const failureStderr =
			"Repair Path: runtime/browser-connect/REPAIR.md#v1-inspect_agent_chrome\n";
		scripted.runtime.mintHandoff = async () => ({
			exitCode: 20,
			stdout: failureEnvelope,
			stderr: failureStderr,
		});
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			scripted.runtime,
		);
		expect(result.exitCode).toBe(20);
		// Verbatim passthrough: browser-use never re-wraps the connect failure.
		expect(result.stdout).toBe(failureEnvelope);
		expect(result.stderr).toBe(failureStderr);
		// Fail closed: no adapter call, no run created.
		expect(scripted.calls).toHaveLength(0);
	});

	test("--handoff is a binding hint that is freshly re-proved before dispatch", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-managed-1");
		const scripted = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeConsole() },
			{ stdout: chromeNetwork() },
		]);
		const mintCalls: Array<{
			adapterId: string;
			runId?: string;
			port?: string;
		}> = [];
		scripted.runtime.mintHandoff = async (input) => {
			mintCalls.push(input);
			const current = handoffEnvelope(input.adapterId, input.runId ?? "missing");
			current.data.attachment.probe_executable =
				"/opt/browser-connect/current-probe";
			return {
				exitCode: 0,
				stdout: JSON.stringify(current),
				stderr: "",
			};
		};
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			scripted.runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(mintCalls).toEqual([
			{
				adapterId: "chrome-devtools-mcp",
				runId: "run-managed-1",
				port: "9222",
			},
		]);
		expect(scripted.calls.flat()).toContain(
			"/opt/browser-connect/current-probe",
		);
		expect(scripted.calls.flat()).not.toContain("/opt/browser-connect/probe");
	});

	test("a caller-managed handoff cannot authorize a different re-proved browser", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(
			store.base,
			"chrome-devtools-mcp",
			"run-managed-mismatch",
		);
		const scripted = scriptedRuntime(store.env, []);
		scripted.runtime.mintHandoff = async () => ({
			exitCode: 0,
			stdout: verifiedHandoffEnvelope((envelope) => {
				envelope.run_id = "run-managed-mismatch";
				envelope.data.endpoint.http = "http://127.0.0.1:9243";
				envelope.data.endpoint.ws =
					"ws://127.0.0.1:9243/devtools/browser/other";
				envelope.data.proof.profile_posture.effective.observer.port = "9243";
			}),
			stderr: "",
		});

		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			scripted.runtime,
		);

		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "task_run_handoff_lane_mismatch",
		});
		expect(scripted.calls).toEqual([]);
	});

	test("a failed caller-managed re-proof surfaces Browser Connect verbatim", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(
			store.base,
			"chrome-devtools-mcp",
			"run-managed-failure",
		);
		const scripted = scriptedRuntime(store.env, []);
		const stdout = '{"status":"error","error":{"code":"listener_gone"}}';
		const stderr = "Repair Path: inspect_listener\n";
		scripted.runtime.mintHandoff = async () => ({
			exitCode: 20,
			stdout,
			stderr,
		});

		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			scripted.runtime,
		);

		expect(result).toMatchObject({ exitCode: 20, stdout, stderr });
		expect(scripted.calls).toEqual([]);
	});

	test("runbook run without --handoff mints for the agent-browser lane", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const scripted = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "about:blank",
						},
					],
				}),
			},
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "about:blank",
						},
					],
				}),
			},
			{ stdout: agentSuccess({ selected: true }) },
			{ stdout: agentSuccess({ url: "about:blank" }) },
			{ stdout: agentSuccess({ opened: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ snapshot: "- page snapshot" }) },
		]);
		const mintCalls: Array<{ adapterId: string; runId?: string }> = [];
		scripted.runtime.mintHandoff = async (input) => {
			mintCalls.push(input);
			return {
				exitCode: 0,
				stdout: JSON.stringify(
					handoffEnvelope(input.adapterId, input.runId ?? "run-minted-rb"),
				),
				stderr: "",
			};
		};
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--json",
			],
			scripted.runtime,
		);
		expect(mintCalls).toHaveLength(1);
		expect(mintCalls[0]?.adapterId).toBe("agent-browser");
		expect(result.exitCode).toBe(0);
		const payload = parseJson(result.stdout) as {
			data?: {
				run?: {
					state?: string;
					runbook_target_binding?: unknown;
					runbook_target?: {
						bound?: boolean;
						mode?: string;
						schema_version?: string;
					};
					runbook_progress?: { next_step?: number };
				};
			};
		};
		expect(payload.data?.run?.state).toBe("confirmed");
		expect(payload.data?.run?.runbook_target_binding).toBeUndefined();
		expect(payload.data?.run?.runbook_target).toEqual({
			bound: true,
			mode: "automatic",
			schema_version: "1",
		});
		expect(payload.data?.run?.runbook_progress?.next_step).toBe(2);
		expect(result.stdout).not.toContain("target_candidate_id");
		expect(result.stdout).not.toContain("binding_id");
		const plain = await runForTest(
			[
				"run", "status",
				"--run", mintCalls[0]?.runId ?? "",
				"--plain",
			],
			makeRuntime({
				env: store.env,
				platformFs: createDefaultPlatformFs(),
			}),
		);
		expect(plain.exitCode).toBe(0);
		expect(plain.stdout).toContain(
			"target_bound=true target_mode=automatic target_schema=1",
		);
		expect(plain.stdout).not.toContain("binding_id");
		expect(plain.stdout).not.toContain("target_candidate_id");
		expect(scripted.calls.map((call) => call.slice(5))).toEqual([
			["tab", "list", "--json"],
			["tab", "list", "--json"],
			["tab", "t1", "--json"],
			["get", "url", "--json"],
			["open", "https://example.test/", "--json"],
			["get", "url", "--json"],
			["snapshot", "-i", "--json"],
		]);
	});
});
