import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { acquireLease, releaseLease } from "./browser-use-locks";
import { BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION } from "./browser-use-auth-model";
import {
	applyAuthTransition,
	beginAuthTransaction,
} from "./browser-use-auth-transaction";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import {
	deleteArtifact,
	artifactBytesPath,
	artifactTombstonePath,
	writeArtifactManifest,
} from "./browser-use-retention";
import { loadPrivateRunbookCatalogFromGit } from "./browser-use-private-runbook-catalog";
import { resolveSelectedRunbookGeneration } from "./browser-use-runbook-generation";
import type { BrowserUseSharedRun } from "./browser-use-run-model";
import {
	type RunStoreDeps,
	createRunIntegrationPort,
	createSharedRun,
	leaseKeyForRun,
	loadSharedRun,
} from "./browser-use-runs";
import {
	type BrowserUseArtifactManifestPayload,
	encodeDurableRecord,
	findRedactionViolations,
	receiptForRun,
} from "./browser-use-schemas";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

// =========================================================================
// Store-backed command wiring (platform plan 2026-07-21-002 U2, spec B2).
//
// Ledger rows S20 plus every command-level case: JSON/plain parity, the
// AE15 receipt listing, resume gates (blocked / execution-unavailable /
// lane mismatch / terminal truth), the R37 cancel terminal-truth mapping
// with idempotent reapply, artifact listing with tombstone classification
// (AE14 substrate), the repair-status projection with its exactly-one next
// action (R27/R35), the identical XDG refusal from every store-backed
// command (AE4), and store-backed caller-metadata parity (R35). Every case
// drives the REAL CLI driver over a real temp XDG store via runForTest.
// =========================================================================

const disposables: { dispose(): void }[] = [];

afterAll(() => {
	for (const disposable of disposables) {
		disposable.dispose();
	}
});

// Fresh temp XDG store plus library deps over the same roots the CLI runtime
// will re-admit (admission is idempotent).
async function makeStore(): Promise<{
	env: Record<string, string | undefined>;
	base: string;
	deps: RunStoreDeps;
}> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return {
		env: xdg.env,
		base: xdg.base,
		deps: { fs, paths: opened.paths, clock: fixedClock().now },
	};
}

const CONTINUATION = {
	next_action_id: "prepare_auth_binding",
	summary: "Prepare the credential binding, then resume this run.",
};

function blockedRun(
	runId: string,
	overrides: Partial<BrowserUseSharedRun> = {},
): Omit<BrowserUseSharedRun, "revision"> {
	return {
		run_id: runId,
		state: "awaiting-auth",
		task_intent: "runbook-execution",
		environment_profile: { environment: "agent-chrome", profile: "default" },
		mutation_dispatched: false,
		artifacts: [],
		continuation: CONTINUATION,
		...overrides,
	};
}

function runningRun(
	runId: string,
	overrides: Partial<BrowserUseSharedRun> = {},
): Omit<BrowserUseSharedRun, "revision"> {
	return {
		run_id: runId,
		state: "running",
		task_intent: "runbook-execution",
		environment_profile: { environment: "agent-chrome", profile: "default" },
		adapter_id: "chrome-devtools-mcp",
		mutation_dispatched: false,
		artifacts: [],
		...overrides,
	};
}

async function createOk(
	deps: RunStoreDeps,
	run: Omit<BrowserUseSharedRun, "revision">,
): Promise<void> {
	const created = await createSharedRun(deps, run);
	expect(created.ok).toBe(true);
}

function sha256(contents: string): string {
	return createHash("sha256").update(contents).digest("hex");
}

function git(root: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function mutationCatalogFixture(): string {
	const root = mkdtempSync(`${tmpdir()}/browser-use-cancel-activation-`);
	disposables.push({
		dispose: () => rmSync(root, { recursive: true, force: true }),
	});
	const runbookRoot = `${root}/skills/browser-use/runbooks/demo/mutate`;
	const actionsRoot = `${root}/skills/browser-use/actions`;
	mkdirSync(runbookRoot, { recursive: true });
	mkdirSync(actionsRoot, { recursive: true });
	writeFileSync(`${actionsRoot}/registry.json`, '{"actions":[]}\n');
	writeFileSync(
		`${runbookRoot}/runbook.json`,
		`${JSON.stringify({
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "demo",
			flow_id: "mutate",
			flow_name: "demo-mutate",
			version: "1",
			summary: "Mutate demo state.",
			allowed_origins: ["https://example.test"],
			inputs: [],
			steps: [
				{
					kind: "click",
					target: { role: "button", name: "Save" },
					postcondition: {
						kind: "element-visible",
						selector: ".saved",
					},
				},
			],
		})}\n`,
	);
	git(root, "init", "-q");
	git(root, "add", "skills/browser-use/runbooks", "skills/browser-use/actions");
	git(
		root,
		"-c",
		"user.email=test@example.invalid",
		"-c",
		"user.name=Cancel Test",
		"commit",
		"-qm",
		"mutation catalog fixture",
	);
	return root;
}

// Seed one present artifact: durable bytes plus a manifest whose content
// hash matches, so readArtifactStatus classifies it "present".
async function seedPresentArtifact(
	deps: RunStoreDeps,
	runId: string,
	artifactId: string,
	contents: string,
): Promise<void> {
	const bytesPath = artifactBytesPath(deps.paths, runId, artifactId);
	await deps.fs.mkdir(dirname(bytesPath), { recursive: true, mode: 0o700 });
	await deps.fs.writeFileDurable(bytesPath, contents, 0o600);
	const manifest: BrowserUseArtifactManifestPayload = {
		artifact_id: artifactId,
		run_id: runId,
		task_intent: "scrape",
		adapter_id: "chrome-devtools-mcp",
		adapter_version: "1.0.0",
		sanitized_target: { origin: "https://example.test" },
		producer_capability: "snapshot_refs",
		content_hash: sha256(contents),
		sensitivity: "high",
		retention: "ephemeral",
		outcome_ref: null,
		created_at_epoch_ms: 1_000,
		export_receipt: null,
	};
	const written = await writeArtifactManifest(deps, manifest);
	expect(written.ok).toBe(true);
}

const RUN_ARGV: readonly (readonly string[])[] = [
	["run", "status", "--json"],
	["run", "resume", "--run", "run-1", "--json"],
	["run", "cancel", "--run", "run-1", "--json"],
	["artifact", "list", "--json"],
	["repair", "status", "--json"],
];

describe("XDG refusal is identical from every store-backed command (AE4)", () => {
	test("a relative XDG root yields one code, one continuation, exit 20 everywhere", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const env = {
			...xdg.env,
			XDG_STATE_HOME: "./relative-state",
			BROWSER_USE_RUN_ID: "xdg-parity",
		};
		const refusals: Array<Record<string, unknown>> = [];
		for (const argv of RUN_ARGV) {
			const result = await runForTest([...argv], makeRuntime({ env }));
			expect(result.exitCode).toBe(20);
			const json = parseJson(result.stdout);
			expect(json.error).toMatchObject({ code: "xdg_root_relative" });
			expect(JSON.stringify(json.error)).toContain("XDG_STATE_HOME");
			expect(
				(json.continuation as Record<string, unknown>).next_action_id,
			).toBe("repair_xdg_root");
			refusals.push({
				error: json.error,
				continuation: json.continuation,
				runtime_actions: json.runtime_actions,
			});
		}
		// Identical refusal shape across all five commands (AE4).
		for (const refusal of refusals.slice(1)) {
			expect(refusal).toEqual(refusals[0]);
		}
	});

	test("plain mode writes the typed refusal to stderr only", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const env = { ...xdg.env, XDG_STATE_HOME: "./relative-state" };
		const result = await runForTest(
			["repair", "status", "--plain"],
			makeRuntime({ env }),
		);
		expect(result.exitCode).toBe(20);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("xdg_root_relative");
		expect(result.stderr).toContain("action=repair_xdg_root");
	});
});

describe("run status over the durable store (R24/R35, AE15)", () => {
	test("without --run lists receipts including each blocked run's one continuation", async () => {
		const store = await makeStore();
		await createOk(store.deps, blockedRun("run-blocked"));
		await createOk(store.deps, runningRun("run-running"));
		const result = await runForTest(
			["run", "status", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.shared-run");
		expect(data.schema_version).toBe("2");
		expect(data.run_count).toBe(2);
		const receipts = data.receipts as Array<Record<string, unknown>>;
		expect(receipts.map((receipt) => receipt.run_id)).toEqual([
			"run-blocked",
			"run-running",
		]);
		// The blocked run's receipt names its exactly-one next safe action.
		expect(receipts[0]?.summary).toContain("next: prepare_auth_binding");
		expect(receipts[0]?.receipt_digest).toMatch(/^[0-9a-f]{64}$/);
		const continuation = parseJson(result.stdout).continuation as Record<
			string,
			unknown
		>;
		expect(continuation.next_action_id).toBe("inspect_shared_run");
	});

	test("receipt projection I/O failure becomes a typed CLI refusal", async () => {
		const store = await makeStore();
		await createOk(store.deps, blockedRun("run-read-failure"));
		const originalFs = store.deps.fs;
		const result = await runForTest(
			["run", "status", "--json"],
			makeRuntime({
				env: store.env,
				platformFs: {
					...originalFs,
					async readDirectory(path) {
						if (path === store.deps.paths.state.runsDir) {
							throw Object.assign(new Error("permission denied"), {
								code: "EACCES",
							});
						}
						return await originalFs.readDirectory(path);
					},
				},
			}),
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "store_read_failed" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"repair_xdg_root",
		);
	});

	test("--run projects the full shared run with JSON/plain field parity", async () => {
		const store = await makeStore();
		await createOk(store.deps, blockedRun("run-parity"));
		const runtimeEnv = { ...store.env };
		const json = await runForTest(
			["run", "status", "--run", "run-parity", "--json"],
			makeRuntime({ env: runtimeEnv }),
		);
		expect(json.exitCode).toBe(0);
		const data = parseJson(json.stdout).data as Record<string, unknown>;
		const run = data.run as Record<string, unknown>;
		expect(run).toMatchObject({
			run_id: "run-parity",
			revision: 1,
			state: "awaiting-auth",
			task_intent: "runbook-execution",
			mutation_dispatched: false,
			continuation: CONTINUATION,
		});
		// A blocked run's next safe action is resuming it.
		expect(
			(parseJson(json.stdout).continuation as Record<string, unknown>)
				.next_action_id,
		).toBe("resume_shared_run");
		const plain = await runForTest(
			["run", "status", "--run", "run-parity", "--plain"],
			makeRuntime({ env: runtimeEnv }),
		);
		expect(plain.exitCode).toBe(0);
		// Plain projects the SAME fields as stable key=value lines.
		expect(plain.stdout).toContain("contract=browser-use.shared-run schema=2");
		expect(plain.stdout).toContain("run_id=run-parity");
		expect(plain.stdout).toContain("revision=1");
		expect(plain.stdout).toContain("state=awaiting-auth");
		expect(plain.stdout).toContain("action=resume_shared_run");
		expect(plain.stdout).toContain("continuation=prepare_auth_binding");
	});

	test("an unknown --run id is run_not_found with the supply_run_id continuation", async () => {
		const store = await makeStore();
		const result = await runForTest(
			["run", "status", "--run", "run-nope", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "run_not_found" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"supply_run_id",
		);
	});

	test("a corrupt run record fails closed toward explicit manual record repair", async () => {
		const store = await makeStore();
		const path = store.deps.paths.state.runFile("run-corrupt");
		await store.deps.fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
		await store.deps.fs.writeFileDurable(path, "{ torn-record", 0o600);
		const result = await runForTest(
			["run", "status", "--run", "run-corrupt", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "run_record_corrupt" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"inspect_corrupt_store_record",
		);
	});

	test("S20: receipts and run projections are redacted — the auth fragment never surfaces", async () => {
		const store = await makeStore();
		const runInput = blockedRun("run-opaque");
		await createOk(store.deps, runInput);
		const loadedBeforeAuth = await loadSharedRun(store.deps, runInput.run_id);
		if (!loadedBeforeAuth.ok) throw new Error("unreachable");
		const held = await acquireLease(store.deps, {
			key: leaseKeyForRun(loadedBeforeAuth.run),
			holderId: "auth-transaction",
			ttlMs: 5_000,
		});
		if (!held.ok) throw new Error("unreachable");
		const port = createRunIntegrationPort(
			store.deps,
			{ validateSecretFreeFragment: () => true, verifyAttestation: async () => true },
			{
				fencing_token: held.lease.fencing_token,
				activation_epoch: held.lease.activation_epoch,
				holderId: held.lease.holder_id,
			},
		);
		const auth = beginAuthTransaction({
			binding: {
				run_id: runInput.run_id,
				handoff_evidence_id: "evidence-opaque",
				lane_id: "agent-browser",
				environment: runInput.environment_profile.environment,
				profile: runInput.environment_profile.profile,
				service_id: "demo",
				auth_context: "redaction",
				origin: "https://example.test",
				target_id: "opaque-binding-ref-1",
				page_id: "page-opaque",
				frame_id: "frame-opaque",
			},
			method: "password",
			attempt_limit: 1,
			attempts_already_consumed: 0,
		});
		if (!auth.ok) throw new Error("unreachable");
		const committed = await port.commitAuthOutcome({
			run_id: runInput.run_id,
			expected_revision: loadedBeforeAuth.run.revision,
			fragment: {
				schema_version: BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
				fragment: auth.fragment,
			},
			summary: { state: "awaiting-auth", continuation: CONTINUATION },
		});
		expect(committed.ok).toBe(true);
		await releaseLease(store.deps, held.lease);
		for (const argv of [
			["run", "status", "--run", "run-opaque", "--json"],
			["run", "status", "--json"],
			["run", "cancel", "--run", "run-opaque", "--json"],
		]) {
			const result = await runForTest([...argv], makeRuntime({ env: store.env }));
			expect(result.exitCode).toBe(0);
			expect(result.stdout).not.toContain("auth_fragment");
			expect(result.stdout).not.toContain("opaque-binding-ref-1");
			expect(result.stdout).not.toContain("ws://");
			expect(result.stdout).not.toContain("op://");
			// No raw store path leaks into any run surface.
			expect(result.stdout).not.toContain(store.base);
		}
		// The receipt projection itself passes the redaction walker.
		const loaded = await loadSharedRun(store.deps, "run-opaque");
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) throw new Error("unreachable");
		expect(findRedactionViolations(receiptForRun(loaded.run))).toEqual([]);
	});

	test("caller metadata parity holds on the live store-backed surface (R35)", async () => {
		const store = await makeStore();
		await createOk(store.deps, blockedRun("run-caller"));
		const envelopes: Array<Record<string, unknown>> = [];
		for (const caller of ["claude-code", "codex", undefined] as const) {
			const argv = ["run", "status", "--run", "run-caller", "--json"];
			if (caller !== undefined) argv.push("--caller", caller);
			const result = await runForTest(
				argv,
				makeRuntime({
					env: { ...store.env, BROWSER_USE_RUN_ID: "caller-parity" },
				}),
			);
			expect(result.exitCode).toBe(0);
			const json = parseJson(result.stdout);
			const data = json.data as Record<string, unknown>;
			expect(data.caller).toEqual({ label: caller ?? null });
			const { caller: _audit, ...semantics } = data;
			const { duration_ms: _duration, ...stableEnvelope } = json;
			envelopes.push({ ...stableEnvelope, data: semantics });
		}
		for (const envelope of envelopes.slice(1)) {
			expect(envelope).toEqual(envelopes[0]);
		}
	});
});

describe("run resume over durable state (R28/R36, AE7/AE15)", () => {
	test("a blocked run re-emits its state and exactly-one continuation without writing", async () => {
		const store = await makeStore();
		await createOk(store.deps, blockedRun("run-resume-blocked"));
		const result = await runForTest(
			["run", "resume", "--run", "run-resume-blocked", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		const data = json.data as Record<string, unknown>;
		expect(data.resume).toBe("blocked");
		expect((data.run as Record<string, unknown>).state).toBe("awaiting-auth");
		// Resume never writes: the durable revision is unchanged.
		expect((data.run as Record<string, unknown>).revision).toBe(1);
		expect(data.continuation).toEqual(CONTINUATION);
		// The run's own persisted continuation IS the resume answer in U2.
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"prepare_auth_binding",
		);
	});

	test("a running run on the provable lane reports typed execution unavailability (exit 1)", async () => {
		const store = await makeStore();
		await createOk(store.deps, runningRun("run-resume-running"));
		const result = await runForTest(
			["run", "resume", "--run", "run-resume-running", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(1);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "run_resume_execution_unavailable" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"inspect_shared_run",
		);
	});

	test("an observed-lane mismatch surfaces the U1 run_lane_mismatch refusal (exit 20)", async () => {
		const store = await makeStore();
		// Bound to a registered adapter WITHOUT an implemented transport: the
		// platform's observable lane is chrome-devtools-mcp, so the U1 gate
		// refuses the resume truthfully.
		await createOk(
			store.deps,
			runningRun("run-resume-lane", { adapter_id: "agent-browser" }),
		);
		const result = await runForTest(
			["run", "resume", "--run", "run-resume-lane", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "run_lane_mismatch" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"inspect_shared_run",
		);
	});

	test("terminal truth never re-enters execution: resume is run_terminal_truth (exit 20)", async () => {
		const store = await makeStore();
		await createOk(
			store.deps,
			runningRun("run-resume-terminal", { state: "confirmed" }),
		);
		const result = await runForTest(
			["run", "resume", "--run", "run-resume-terminal", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "run_terminal_truth",
		});
	});
});

describe("run cancel terminal-truth mapping (R37, AE15)", () => {
	test("a cancelled mutation-class run drops out of activation blockers", async () => {
		const store = await makeStore();
		const sourceRoot = mutationCatalogFixture();
		const catalog = await loadPrivateRunbookCatalogFromGit({
			repoRoot: sourceRoot,
		});
		expect(catalog.ok).toBe(true);
		if (!catalog.ok) return;
		const runtime = makeRuntime({ env: store.env, sourceCheckoutRoot: sourceRoot });
		const activationArgs = [
			"runbook",
			"activate",
			"--catalog-digest",
			catalog.catalog.catalog_digest,
			"--expected-epoch",
			"0",
			"--json",
		];
		const firstActivation = await runForTest(activationArgs, runtime);
		expect(firstActivation.exitCode).toBe(0);
		const selected = await resolveSelectedRunbookGeneration(store.deps);
		expect(selected.ok).toBe(true);
		if (!selected.ok) return;
		const record = selected.manifest.runbooks.find(
			(runbook) =>
				runbook.service_id === "demo" && runbook.flow_id === "mutate",
		);
		if (record === undefined) throw new Error("mutation runbook missing");
		await createOk(
			store.deps,
			blockedRun("run-cancel-activation", {
				state: "awaiting-user-presence",
				adapter_id: "agent-browser",
				handoff_evidence_id: "cancel-activation-evidence",
				runbook_target_binding: {
					schema_version: "1",
					mode: "automatic",
					binding_id: "cancel-activation-target",
				},
				runbook_progress: {
					schema_version: "1",
					service_id: "demo",
					flow_id: "mutate",
					runbook_version: "1",
					next_step: 0,
					total_steps: 1,
				},
				run_execution_binding: {
					schema_version: "1",
					generation_id: selected.generation_id,
					activation_epoch: selected.epoch,
					service_id: "demo",
					flow_id: "mutate",
					runbook_version: "1",
					runbook_digest: record.record_digest,
					action_registry_digest: selected.action_registry_digest,
					normalized_input_digest: sha256("{}"),
					item_key_digest: sha256("[]"),
					target_scope: "https://example.test",
					postcondition: { id: "saved", summary: "Save is visible." },
				},
			}),
		);
		const runbookPath = `${sourceRoot}/skills/browser-use/runbooks/demo/mutate/runbook.json`;
		const changedRunbook = JSON.parse(
			await Bun.file(runbookPath).text(),
		) as Record<string, unknown>;
		changedRunbook.summary = "Mutate changed demo state.";
		writeFileSync(runbookPath, `${JSON.stringify(changedRunbook)}\n`);
		git(sourceRoot, "add", "skills/browser-use/runbooks/demo/mutate/runbook.json");
		git(
			sourceRoot,
			"-c",
			"user.email=test@example.invalid",
			"-c",
			"user.name=Cancel Test",
			"commit",
			"-qm",
			"changed mutation catalog fixture",
		);
		const changedCatalog = await loadPrivateRunbookCatalogFromGit({
			repoRoot: sourceRoot,
		});
		expect(changedCatalog.ok).toBe(true);
		if (!changedCatalog.ok) return;
		const nextActivationArgs = [
			"runbook",
			"activate",
			"--catalog-digest",
			changedCatalog.catalog.catalog_digest,
			"--expected-epoch",
			"1",
			"--json",
		];
		const blockedActivation = await runForTest(
			nextActivationArgs,
			runtime,
		);
		expect(blockedActivation.exitCode).toBe(20);
		expect(parseJson(blockedActivation.stdout)).toMatchObject({
			error: { code: "activation_blocked_by_run" },
		});

		const cancelled = await runForTest(
			["run", "cancel", "--run", "run-cancel-activation", "--json"],
			runtime,
		);
		expect(cancelled.exitCode).toBe(0);
		const activated = await runForTest(
			nextActivationArgs,
			runtime,
		);
		expect(activated.exitCode).toBe(0);
		expect(parseJson(activated.stdout)).toMatchObject({
			status: "ok",
			data: { changed: true, epoch: 2 },
		});
	});

	test("cancel before dispatch records terminal not-achieved with external_effect none", async () => {
		const store = await makeStore();
		await createOk(store.deps, blockedRun("run-cancel-none"));
		const result = await runForTest(
			["run", "cancel", "--run", "run-cancel-none", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		const run = data.run as Record<string, unknown>;
		expect(run.state).toBe("not-achieved");
		expect(run.revision).toBe(2);
		// Terminal truth carries no blocked-state continuation.
		expect(run.continuation).toBeUndefined();
		expect(data.cancellation).toEqual({
			outcome: "cancelled",
			external_effect: "none",
			rolled_back: false,
		});
	});

	test("cancel closes a blocked auth fragment in the same terminal write", async () => {
		const store = await makeStore();
		const run = blockedRun("run-cancel-auth");
		await createOk(store.deps, run);
		const begun = beginAuthTransaction({
			binding: {
				run_id: run.run_id,
				handoff_evidence_id: "evidence-1",
				lane_id: "agent-browser",
				environment: run.environment_profile.environment,
				profile: run.environment_profile.profile,
				service_id: "fasttrack",
				auth_context: "timesheet",
				origin: "https://portal.example.test",
				target_id: "target-1",
				page_id: "page-1",
				frame_id: "frame-1",
			},
			method: "password",
			attempt_limit: 3,
			attempts_already_consumed: 0,
		});
		expect(begun.ok).toBe(true);
		if (!begun.ok) return;
		const blocked = applyAuthTransition(begun.fragment, {
			type: "blocked",
			cause: "user-presence-required",
		});
		expect(blocked.ok).toBe(true);
		if (!blocked.ok) return;
		const loaded = await loadSharedRun(store.deps, run.run_id);
		if (!loaded.ok) throw new Error("unreachable");
		const held = await acquireLease(store.deps, {
			key: leaseKeyForRun(loaded.run),
			holderId: "auth-transaction",
			ttlMs: 5_000,
		});
		if (!held.ok) throw new Error("unreachable");
		const port = createRunIntegrationPort(
			store.deps,
			{
				validateSecretFreeFragment: () => true,
				verifyAttestation: async () => true,
			},
			{
				fencing_token: held.lease.fencing_token,
				activation_epoch: held.lease.activation_epoch,
				holderId: held.lease.holder_id,
			},
		);
		const committed = await port.commitAuthOutcome({
			run_id: run.run_id,
			expected_revision: loaded.run.revision,
			fragment: {
				schema_version: BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
				fragment: blocked.fragment,
			},
			summary: {
				state: "awaiting-user-presence",
				continuation: blocked.fragment.continuation ?? CONTINUATION,
			},
		});
		expect(committed.ok).toBe(true);
		await releaseLease(store.deps, held.lease);

		const result = await runForTest(
			["run", "cancel", "--run", run.run_id, "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const cancelled = await loadSharedRun(store.deps, run.run_id);
		if (!cancelled.ok) throw new Error("unreachable");
		expect(cancelled.run.state).toBe("not-achieved");
		expect(cancelled.run.revision).toBe(3);
		expect(cancelled.run.auth_fragment?.fragment).toMatchObject({
			status: "terminal",
			phase: "terminal",
			terminal_outcome: "cancelled",
			continuation: null,
		});
	});

	test("cancel after dispatch refuses and preserves the nonterminal run", async () => {
		const store = await makeStore();
		await createOk(
			store.deps,
			runningRun("run-cancel-unknown", { mutation_dispatched: true }),
		);
		const result = await runForTest(
			["run", "cancel", "--run", "run-cancel-unknown", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			status: "error",
			error: { code: "run_cancel_mutation_dispatched" },
			continuation: { next_action_id: "inspect_shared_run" },
		});
		const loaded = await loadSharedRun(store.deps, "run-cancel-unknown");
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.run.state).toBe("running");
		expect(loaded.run.revision).toBe(1);
	});

	test("cancel is idempotent on a terminal run: no write, no revision bump", async () => {
		const store = await makeStore();
		await createOk(store.deps, blockedRun("run-cancel-twice"));
		const first = await runForTest(
			["run", "cancel", "--run", "run-cancel-twice", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(first.exitCode).toBe(0);
		const second = await runForTest(
			["run", "cancel", "--run", "run-cancel-twice", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(second.exitCode).toBe(0);
		const firstRun = (parseJson(first.stdout).data as Record<string, unknown>)
			.run as Record<string, unknown>;
		const secondRun = (parseJson(second.stdout).data as Record<string, unknown>)
			.run as Record<string, unknown>;
		expect(secondRun).toEqual(firstRun);
		expect(secondRun.revision).toBe(2);
		expect(
			(parseJson(second.stdout).data as Record<string, unknown>).cancellation,
		).toEqual({
			outcome: "already-terminal",
			external_effect: "none",
			rolled_back: false,
		});
	});

	test("an already-terminal dispatched run remains an idempotent no-op", async () => {
		const store = await makeStore();
		await createOk(
			store.deps,
			runningRun("run-cancel-terminal-dispatched", {
				state: "confirmed",
				mutation_dispatched: true,
			}),
		);
		const result = await runForTest(
			[
				"run",
				"cancel",
				"--run",
				"run-cancel-terminal-dispatched",
				"--json",
			],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout)).toMatchObject({
			data: {
				run: { state: "confirmed", revision: 1 },
				cancellation: { outcome: "already-terminal" },
			},
		});
	});

	test("plain cancel projects the same cancellation facts (R35 parity)", async () => {
		const store = await makeStore();
		await createOk(store.deps, blockedRun("run-cancel-plain"));
		const result = await runForTest(
			["run", "cancel", "--run", "run-cancel-plain", "--plain"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("external_effect=none");
		expect(result.stdout).toContain("cancellation=cancelled");
		expect(result.stdout).toContain("rolled_back=false");
		expect(result.stdout).toContain("state=not-achieved");
	});

	test("cancel cannot mutate through another holder's live lease", async () => {
		const store = await makeStore();
		const run = blockedRun("run-cancel-contended", {
				environment_profile: {
					environment: "agent-chrome",
					profile: "cancel-contended",
				},
			});
		await createOk(store.deps, run);
		const held = await acquireLease(store.deps, {
			key: leaseKeyForRun(run),
			holderId: "active-worker",
			ttlMs: 5_000,
		});
		expect(held.ok).toBe(true);
		const result = await runForTest(
			["run", "cancel", "--run", run.run_id, "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({ code: "lease_held" });
		const loaded = await loadSharedRun(store.deps, run.run_id);
		if (!loaded.ok) throw new Error("unreachable");
		expect(loaded.run.revision).toBe(1);
		expect(loaded.run.state).toBe("awaiting-auth");
	});
});

describe("artifact list (R29/R35, AE14 substrate)", () => {
	async function seedArtifacts(store: Awaited<ReturnType<typeof makeStore>>) {
		await seedPresentArtifact(store.deps, "run-a", "art-present", "bytes-a");
		await seedPresentArtifact(store.deps, "run-a", "art-deleted", "bytes-b");
		const deleted = await deleteArtifact(store.deps, {
			runId: "run-a",
			artifactId: "art-deleted",
			reason: "explicit-delete",
		});
		expect(deleted.ok).toBe(true);
		await seedPresentArtifact(store.deps, "run-b", "art-b", "bytes-c");
	}

	test("lists manifests and tombstones; deleted rows carry the tombstone classification", async () => {
		const store = await makeStore();
		await seedArtifacts(store);
		const result = await runForTest(
			["artifact", "list", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.artifact-manifest");
		expect(data.artifact_count).toBe(3);
		const rows = data.artifacts as Array<Record<string, unknown>>;
		expect(rows.map((row) => `${row.run_id}/${row.artifact_id}`)).toEqual([
			"run-a/art-deleted",
			"run-a/art-present",
			"run-b/art-b",
		]);
		expect(rows[0]).toMatchObject({
			status: "deleted",
			reason: "explicit-delete",
			phase: "complete",
			retention: "ephemeral",
		});
		expect(rows[1]).toMatchObject({
			status: "present",
			sensitivity: "high",
			retention: "ephemeral",
			exported: false,
		});
	});

	test("--run filters the projection to one shared run", async () => {
		const store = await makeStore();
		await seedArtifacts(store);
		const result = await runForTest(
			["artifact", "list", "--run", "run-b", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.run).toBe("run-b");
		expect(data.artifact_count).toBe(1);
		const rows = data.artifacts as Array<Record<string, unknown>>;
		expect(rows[0]).toMatchObject({ run_id: "run-b", artifact_id: "art-b" });
	});

	test("an unsafe --run segment fails closed as run_not_found", async () => {
		const store = await makeStore();
		const result = await runForTest(
			["artifact", "list", "--run", "../escape", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "run_not_found",
		});
	});

	test("plain output projects the same rows (R35 parity)", async () => {
		const store = await makeStore();
		await seedArtifacts(store);
		const result = await runForTest(
			["artifact", "list", "--plain"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("artifact_count=3");
		expect(result.stdout).toContain("artifact_id=art-deleted");
		expect(result.stdout).toContain("status=deleted");
		expect(result.stdout).toContain("status=present");
	});
});

describe("repair status projection (R27/R35)", () => {
	test("a healthy store projects roots, fallback, empties, and inspect_shared_run", async () => {
		const store = await makeStore();
		const result = await runForTest(
			["repair", "status", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		const data = json.data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.repair-status");
		const roots = data.roots as Record<string, string>;
		expect(Object.keys(roots).sort()).toEqual([
			"cache",
			"config",
			"data",
			"runtime",
			"state",
		]);
		// Temp env leaves XDG_RUNTIME_DIR unset: the warned fallback is active.
		expect(data.runtime_fallback).toEqual({
			active: true,
			reason: "runtime_dir_unset",
		});
		expect(roots.runtime).toContain("runtime-fallback");
		expect(data.leases).toEqual([]);
		expect(data.orphan_temp_files).toEqual([]);
		expect(data.pending_tombstones).toEqual([]);
		expect(data.next_action).toBe("inspect_shared_run");
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"inspect_shared_run",
		);
	});

	test("a live lease projects its R27 facts and flips the next action to wait_for_lease", async () => {
		const store = await makeStore();
		const acquired = await acquireLease(store.deps, {
			key: "agent-chrome\0default",
			holderId: "agent-a",
			ttlMs: 5_000,
		});
		expect(acquired.ok).toBe(true);
		const orphanPath = `${store.deps.paths.state.runsDir}/stale.tmp-42-7`;
		await store.deps.fs.mkdir(store.deps.paths.state.runsDir, {
			recursive: true,
			mode: 0o700,
		});
		await store.deps.fs.writeFile(orphanPath, "", 0o600);
		const result = await runForTest(
			["repair", "status", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		const leases = data.leases as Array<Record<string, unknown>>;
		expect(leases).toHaveLength(1);
		expect(leases[0]).toMatchObject({
			key: "agent-chrome\0default",
			holder_id: "agent-a",
			fencing_token: 1,
			activation_epoch: 1,
			live: true,
			recovered_from: null,
		});
		expect(typeof leases[0]?.heartbeat_at_epoch_ms).toBe("number");
		expect(typeof leases[0]?.expires_at_epoch_ms).toBe("number");
		expect(data.orphan_temp_files).toEqual([orphanPath]);
		expect(data.next_action).toBe("wait_for_lease");
	});

	test("repair apply refuses while a live lease exists and leaves orphans untouched", async () => {
		const store = await makeStore();
		const acquired = await acquireLease(store.deps, {
			key: "agent-chrome\0default",
			holderId: "active-run",
			ttlMs: 5_000,
		});
		expect(acquired.ok).toBe(true);
		const orphanPath = `${store.deps.paths.state.runsDir}/active.tmp-42-8`;
		await store.deps.fs.mkdir(store.deps.paths.state.runsDir, {
			recursive: true,
			mode: 0o700,
		});
		await store.deps.fs.writeFile(orphanPath, "", 0o600);
		const result = await runForTest(
			["repair", "apply", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({ code: "lease_held" });
		expect(await store.deps.fs.lstat(orphanPath)).toMatchObject({ kind: "file" });
	});

	test("pending tombstones route the next action to apply_repair", async () => {
		const store = await makeStore();
		const tombstonePath = artifactTombstonePath(
			store.deps.paths,
			"run-t",
			"art-t",
		);
		await store.deps.fs.mkdir(dirname(tombstonePath), {
			recursive: true,
			mode: 0o700,
		});
		await store.deps.fs.writeFileDurable(
			tombstonePath,
			encodeDurableRecord("tombstone", {
				artifact_id: "art-t",
				run_id: "run-t",
				retention: "ephemeral",
				reason: "retention-expiry",
				phase: "pending",
				deleted_at_epoch_ms: 1_000,
			}),
			0o600,
		);
		const result = await runForTest(
			["repair", "status", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		const tombstones = data.pending_tombstones as Array<Record<string, unknown>>;
		expect(tombstones).toHaveLength(1);
		expect(tombstones[0]).toMatchObject({
			artifact_id: "art-t",
			phase: "pending",
		});
		expect(data.next_action).toBe("apply_repair");
	});

	test("repair apply converges pending tombstones and recognized orphan temp files", async () => {
		const store = await makeStore();
		const tombstonePath = artifactTombstonePath(
			store.deps.paths,
			"run-repair",
			"art-repair",
		);
		await store.deps.fs.mkdir(dirname(tombstonePath), {
			recursive: true,
			mode: 0o700,
		});
		await store.deps.fs.writeFileDurable(
			tombstonePath,
			encodeDurableRecord("tombstone", {
				artifact_id: "art-repair",
				run_id: "run-repair",
				retention: "ephemeral",
				reason: "retention-expiry",
				phase: "pending",
				deleted_at_epoch_ms: 1_000,
			}),
			0o600,
		);
		const orphanPath = `${store.deps.paths.state.runsDir}/abandoned.tmp-7-11`;
		await store.deps.fs.mkdir(dirname(orphanPath), {
			recursive: true,
			mode: 0o700,
		});
		await store.deps.fs.writeFile(orphanPath, "", 0o600);

		const applied = await runForTest(
			["repair", "apply", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(applied.exitCode).toBe(0);
		const appliedData = parseJson(applied.stdout).data as Record<string, unknown>;
		expect(appliedData).toMatchObject({
			contract: "browser-use.repair-status",
			repaired_tombstone_count: 1,
			removed_orphan_count: 1,
			repaired_artifact_ids: ["art-repair"],
			next_action: "inspect_repair_status",
		});
		expect(JSON.stringify(appliedData)).not.toContain(orphanPath);

		const standing = await store.deps.fs.readTextFile(tombstonePath);
		expect(
			(JSON.parse(standing) as { payload: { phase: string } }).payload.phase,
		).toBe("complete");
		expect(await store.deps.fs.lstat(orphanPath)).toBeUndefined();
		const status = await runForTest(
			["repair", "status", "--json"],
			makeRuntime({ env: store.env }),
		);
		const statusData = parseJson(status.stdout).data as Record<string, unknown>;
		expect(statusData.pending_tombstones).toEqual([]);
		expect(statusData.orphan_temp_files).toEqual([]);
	});

	test("read-only status does not create or probe absent XDG roots", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const real = createDefaultPlatformFs();
		const mutations: string[] = [];
		const platformFs = {
			...real,
			mkdir: async () => {
				mutations.push("mkdir");
			},
			chmod: async () => {
				mutations.push("chmod");
			},
			writeFile: async () => {
				mutations.push("writeFile");
			},
			unlink: async () => {
				mutations.push("unlink");
			},
		};
		const result = await runForTest(
			["run", "status", "--json"],
			makeRuntime({ env: xdg.env, platformFs }),
		);
		expect(result.exitCode).toBe(0);
		expect(mutations).toEqual([]);
	});

	test("plain output projects the same repair fields (R35 parity)", async () => {
		const store = await makeStore();
		const result = await runForTest(
			["repair", "status", "--plain"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("contract=browser-use.repair-status schema=1");
		expect(result.stdout).toContain(`root_state=${store.env.XDG_STATE_HOME}`);
		expect(result.stdout).toContain("runtime_fallback=true reason=runtime_dir_unset");
		expect(result.stdout).toContain("next_action=inspect_shared_run");
	});
});
