import { afterAll, describe, expect, test } from "bun:test";
import { dirname } from "node:path";
import {
	type LeaseWriteClaim,
	acquireLease,
	advanceActivationEpoch,
} from "./browser-use-locks";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import type {
	BrowserUseAuthFragmentSlot,
	BrowserUseSharedRun,
} from "./browser-use-run-model";
import {
	attestationByDigestFrom,
	BrowserUseAuthCommitInfrastructureError,
	casUpdateSharedRun,
	createRunIntegrationPort,
	createSharedRun,
	leaseKeyForRun,
	listSharedRunReceipts,
	loadSharedRun,
	readAuthAttestationRecord,
	resumeSharedRun,
	writeAuthAttestationRecord,
	type RunStoreDeps,
} from "./browser-use-runs";
import { createBrowserUseAuthContract } from "./browser-use-auth";
import {
	type BrowserUseAuthAttestation,
	authAttestationDigestOf,
} from "./browser-use-auth-model";
import {
	type BrowserUseSharedRunPayload,
	encodeDurableRecord,
	findRedactionViolations,
	parseDurableRecord,
} from "./browser-use-schemas";
import { readDurableFile, writeDurableFile } from "./browser-use-store";

// =========================================================================
// Shared-run persistence proof (platform plan 2026-07-21-002 U2).
//
// Ledger rows S10, S11, S12, S15, and the commitAuthOutcome round-trip:
// same-profile lease contention, distinct-profile concurrency, the
// auth-held lease, restart/resume re-emitting the blocked run plus its
// exactly-one continuation, and the opaque fragment persisted verbatim
// while a rejected fragment never touches disk — plus the create/load parse
// matrix, the CAS update pipeline with the fenced write gate, and the
// redacted receipt listing (AE15 substrate).
// =========================================================================

const sharedXdg = makeTempXdgEnv();
const disposables: { dispose(): void }[] = [sharedXdg];

const TTL_MS = 5_000;

afterAll(() => {
	for (const disposable of disposables) {
		disposable.dispose();
	}
});

async function depsOver(
	env: Record<string, string | undefined>,
	clock: () => number,
): Promise<RunStoreDeps> {
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return { fs, paths: opened.paths, clock };
}

// Shared env for run-store tests (unique run ids and profiles per test).
async function makeSharedDeps(clock: () => number): Promise<RunStoreDeps> {
	return await depsOver(sharedXdg.env, clock);
}

// Isolated env for tests that assert over the whole runs dir or reuse keys.
async function makeIsolatedDeps(clock: () => number): Promise<{
	deps: RunStoreDeps;
	env: Record<string, string | undefined>;
}> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	return { deps: await depsOver(xdg.env, clock), env: xdg.env };
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
		// U3a: a run can only turn ready with a verifiable lane/handoff-bound
		// attestation, so the base fixture is lane-bound.
		adapter_id: "agent-browser",
		handoff_evidence_id: "evidence-1",
		mutation_dispatched: false,
		artifacts: [],
		continuation: CONTINUATION,
		...overrides,
	};
}

async function createOk(
	deps: RunStoreDeps,
	run: Omit<BrowserUseSharedRun, "revision">,
): Promise<BrowserUseSharedRun> {
	const created = await createSharedRun(deps, run);
	expect(created.ok).toBe(true);
	if (!created.ok) throw new Error("unreachable");
	return created.run;
}

async function loadOk(
	deps: RunStoreDeps,
	runId: string,
): Promise<{ run: BrowserUseSharedRun; payload: BrowserUseSharedRunPayload }> {
	const loaded = await loadSharedRun(deps, runId);
	expect(loaded.ok).toBe(true);
	if (!loaded.ok) throw new Error("unreachable");
	return loaded;
}

async function rawRecordOf(deps: RunStoreDeps, runId: string): Promise<string> {
	const read = await readDurableFile(deps.fs, deps.paths.state.runFile(runId));
	expect(read.status).toBe("present");
	if (read.status !== "present") throw new Error("unreachable");
	return read.raw;
}

async function acquireClaim(
	deps: RunStoreDeps,
	run: BrowserUseSharedRun,
	holderId = "auth-transaction",
): Promise<LeaseWriteClaim> {
	const acquired = await acquireLease(deps, {
		key: leaseKeyForRun(run),
		holderId,
		ttlMs: TTL_MS,
	});
	expect(acquired.ok).toBe(true);
	if (!acquired.ok) throw new Error("unreachable");
	return {
		fencing_token: acquired.lease.fencing_token,
		activation_epoch: acquired.lease.activation_epoch,
		holderId: acquired.lease.holder_id,
	};
}

// Seed an arbitrary record at the run's durable path (corrupt/wrong-kind
// fixtures for the load matrix).
async function seedRunRecord(
	deps: RunStoreDeps,
	runId: string,
	contents: string,
): Promise<void> {
	const path = deps.paths.state.runFile(runId);
	await deps.fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await deps.fs.writeFileDurable(path, contents, 0o600);
}

describe("leaseKeyForRun (R27)", () => {
	test("environment/profile compose the key with a NUL separator", () => {
		const key = leaseKeyForRun({
			environment_profile: { environment: "agent-chrome", profile: "default" },
		});
		expect(key).toBe("agent-chrome\0default");
	});

	test("the separator keeps adjacent identities unambiguous", () => {
		const left = leaseKeyForRun({
			environment_profile: { environment: "a", profile: "bc" },
		});
		const right = leaseKeyForRun({
			environment_profile: { environment: "ab", profile: "c" },
		});
		expect(left).not.toBe(right);
	});
});

describe("createSharedRun + loadSharedRun (R24)", () => {
	test("a blocked run round-trips at revision 1 with canonical durable bytes", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const input = blockedRun("run-roundtrip");
		const created = await createOk(deps, input);
		expect(created).toEqual({ ...input, revision: 1 });
		const loaded = await loadOk(deps, "run-roundtrip");
		expect(loaded.run).toEqual(created);
		expect(loaded.payload.created_at_epoch_ms).toBe(1_000);
		expect(loaded.payload.updated_at_epoch_ms).toBe(1_000);
		// The durable record is the canonical encoded form and round-trips.
		const raw = await rawRecordOf(deps, "run-roundtrip");
		expect(raw).toBe(
			encodeDurableRecord("shared-run", {
				...input,
				revision: 1,
				created_at_epoch_ms: 1_000,
				updated_at_epoch_ms: 1_000,
			}),
		);
		expect(parseDurableRecord(raw, "shared-run")).toEqual({
			ok: true,
			payload: loaded.payload,
		});
	});

	test("a bound run round-trips private target and progress state in shared-run v2", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const input = blockedRun("run-bound-roundtrip", {
			runbook_target_binding: {
				schema_version: "1",
				mode: "automatic",
				binding_id: "candidate-opaque-1",
			},
			runbook_progress: {
				schema_version: "1",
				service_id: "oncore",
				flow_id: "snapshot-verify",
				runbook_version: "1",
				next_step: 0,
				total_steps: 2,
			},
		});
		const created = await createOk(deps, input);
		const loaded = await loadOk(deps, created.run_id);
		expect(loaded.run).toEqual(created);
		const raw = await rawRecordOf(deps, created.run_id);
		const durable = JSON.parse(raw);
		expect(durable.schema_version).toBe("2");
		expect(durable.payload.runbook_target_binding).toEqual(
			input.runbook_target_binding,
		);
		expect(durable.payload).not.toHaveProperty("target_tab_id");
	});

	test("generic create refuses an auth fragment that bypassed the integration port", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const result = await createSharedRun(deps, {
			...blockedRun("run-create-auth-bypass"),
			auth_fragment: FRAGMENT,
		});
		expect(result).toMatchObject({
			ok: false,
			code: "run_auth_fragment_forbidden",
		});
		expect(
			await readDurableFile(deps.fs, deps.paths.state.runFile("run-create-auth-bypass")),
		).toEqual({ status: "missing" });
	});

	test("generic create refuses auth attestation and ready state", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const result = await createSharedRun(deps, {
			...blockedRun("run-create-auth-state-bypass"),
			state: "ready",
			continuation: undefined,
			auth_attestation: ATTESTATION,
		});
		expect(result).toMatchObject({
			ok: false,
			code: "run_auth_state_forbidden",
		});
		expect(
			await readDurableFile(
				deps.fs,
				deps.paths.state.runFile("run-create-auth-state-bypass"),
			),
		).toEqual({ status: "missing" });
	});

	test("an invalid initial run is a typed U1 issue and writes nothing", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const created = await createSharedRun(
			deps,
			blockedRun("run-create-invalid", { continuation: undefined }),
		);
		expect(created).toEqual({
			ok: false,
			code: "run_blocked_without_continuation",
			message: expect.stringContaining("next safe action"),
		});
		const loaded = await loadSharedRun(deps, "run-create-invalid");
		expect(loaded).toMatchObject({ ok: false, code: "run_not_found" });
	});

	test("a duplicate create is a typed store_record_conflict", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		await createOk(deps, blockedRun("run-create-duplicate"));
		const again = await createSharedRun(deps, blockedRun("run-create-duplicate"));
		expect(again).toMatchObject({ ok: false, code: "store_record_conflict" });
	});

	test("a missing record is run_not_found", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const loaded = await loadSharedRun(deps, "run-load-missing");
		expect(loaded).toMatchObject({ ok: false, code: "run_not_found" });
	});

	test("torn JSON bytes are run_record_corrupt", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		await seedRunRecord(deps, "run-load-torn", '{"record":"shared-run","schema');
		const loaded = await loadSharedRun(deps, "run-load-torn");
		expect(loaded).toMatchObject({ ok: false, code: "run_record_corrupt" });
	});

	test("a wrong-kind record is run_record_invalid", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		await seedRunRecord(
			deps,
			"run-load-wrong-kind",
			encodeDurableRecord("activation-epoch", { epoch: 1 }),
		);
		const loaded = await loadSharedRun(deps, "run-load-wrong-kind");
		expect(loaded).toMatchObject({ ok: false, code: "run_record_invalid" });
	});

	test("a parseable record violating a U1 run invariant is run_record_invalid", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		await seedRunRecord(
			deps,
			"run-load-invariant",
			encodeDurableRecord("shared-run", {
				...blockedRun("run-load-invariant", { continuation: undefined }),
				revision: 1,
				created_at_epoch_ms: 1_000,
				updated_at_epoch_ms: 1_000,
			}),
		);
		const loaded = await loadSharedRun(deps, "run-load-invariant");
		expect(loaded).toEqual({
			ok: false,
			code: "run_record_invalid",
			message: expect.stringContaining("next safe action"),
		});
	});
});

describe("redaction admission on durable write (R13 backstop)", () => {
	test("createSharedRun refuses a run whose non-opaque field carries a secret-shaped value; nothing is written", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		// An adapter echoed a 1Password ref into the audit-only caller label — a
		// valid run that would otherwise write a secret into 0600 state.
		const leaking = blockedRun("run-redaction-create", {
			caller: { label: "op://vault/chrome/session-token" },
		});
		const created = await createSharedRun(deps, leaking);
		expect(created).toMatchObject({ ok: false, code: "run_record_invalid" });
		if (created.ok) throw new Error("unreachable");
		expect(created.message).toContain("redaction");
		expect(created.message).not.toContain("op://");
		// Nothing reached durable state.
		const loaded = await loadSharedRun(deps, "run-redaction-create");
		expect(loaded).toMatchObject({ ok: false, code: "run_not_found" });
	});

	test("a redaction-clean run still writes at revision 1", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const clean = blockedRun("run-redaction-clean", {
			caller: { label: "cli-agent" },
		});
		const created = await createOk(deps, clean);
		expect(created).toEqual({ ...clean, revision: 1 });
		const loaded = await loadOk(deps, "run-redaction-clean");
		expect(findRedactionViolations(loaded.payload)).toEqual([]);
	});

	test("casUpdateSharedRun refuses a mutation that introduces a violation; the prior record is preserved", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const created = await createOk(
			deps,
			blockedRun("run-redaction-update", {
				environment_profile: {
					environment: "agent-chrome",
					profile: "redaction-update",
				},
			}),
		);
		const lease = await acquireClaim(deps, created, "redaction-writer");
		const rawBefore = await rawRecordOf(deps, "run-redaction-update");
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-redaction-update",
			expectedRevision: created.revision,
			lease,
			mutate: (run) => ({
				...run,
				continuation: {
					next_action_id: "prepare_auth_binding",
					summary: "connect to ws://leaked-endpoint:9222/devtools/browser",
				},
			}),
		});
		expect(updated).toMatchObject({ ok: false, code: "run_record_invalid" });
		if (updated.ok) throw new Error("unreachable");
		expect(updated.message).toContain("redaction");
		// The record on disk is byte-identical to before the rejected update.
		expect(await rawRecordOf(deps, "run-redaction-update")).toBe(rawBefore);
	});
});

describe("casUpdateSharedRun (R13, R27)", () => {
	test("a leased update mutates purely, bumps the revision, and keeps created_at", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-update-ok", {
				environment_profile: {
					environment: "agent-chrome",
					profile: "update-ok",
				},
			}),
		);
		const lease = await acquireClaim(deps, run, "update-writer");
		clock.advance(500);
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-update-ok",
			expectedRevision: 1,
			lease,
			mutate: (run) => ({
				...run,
				state: "awaiting-approval",
				continuation: {
					next_action_id: "approve_run",
					summary: "Approve this run, then resume it.",
				},
			}),
		});
		expect(updated).toMatchObject({
			ok: true,
			run: { revision: 2, state: "awaiting-approval" },
		});
		const loaded = await loadOk(deps, "run-update-ok");
		expect(loaded.run.revision).toBe(2);
		expect(loaded.run.continuation?.next_action_id).toBe("approve_run");
		expect(loaded.payload.created_at_epoch_ms).toBe(1_000);
		expect(loaded.payload.updated_at_epoch_ms).toBe(1_500);
	});

	test("a legacy unmutated run may bind once; committed binding is immutable", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-binding-set-once", {
				environment_profile: {
					environment: "agent-chrome",
					profile: "binding-set-once",
				},
			}),
		);
		const lease = await acquireClaim(deps, run, "binding-writer");
		const bound = await casUpdateSharedRun(deps, {
			runId: run.run_id,
			expectedRevision: run.revision,
			lease,
			mutate: (current) => ({
				...current,
				runbook_target_binding: {
					schema_version: "1",
					mode: "automatic",
					binding_id: "candidate-opaque-1",
				},
				runbook_progress: {
					schema_version: "1",
					service_id: "oncore",
					flow_id: "snapshot-verify",
					runbook_version: "1",
					next_step: 0,
					total_steps: 3,
				},
			}),
		});
		expect(bound).toMatchObject({ ok: true, run: { revision: 2 } });
		if (!bound.ok) throw new Error("unreachable");
		const before = await rawRecordOf(deps, run.run_id);
		const rebound = await casUpdateSharedRun(deps, {
			runId: run.run_id,
			expectedRevision: bound.run.revision,
			lease,
			mutate: (current) => ({
				...current,
				runbook_target_binding: {
					schema_version: "1",
					mode: "automatic",
					binding_id: "candidate-opaque-2",
				},
			}),
		});
		expect(rebound).toMatchObject({
			ok: false,
			code: "runbook_target_binding_immutable",
		});
		expect(await rawRecordOf(deps, run.run_id)).toBe(before);
	});

	test("a mutated legacy run cannot acquire a late target binding", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-binding-late", {
				environment_profile: {
					environment: "agent-chrome",
					profile: "binding-late",
				},
				mutation_dispatched: true,
			}),
		);
		const lease = await acquireClaim(deps, run, "late-binding-writer");
		const before = await rawRecordOf(deps, run.run_id);
		const updated = await casUpdateSharedRun(deps, {
			runId: run.run_id,
			expectedRevision: run.revision,
			lease,
			mutate: (current) => ({
				...current,
				runbook_target_binding: {
					schema_version: "1",
					mode: "automatic",
					binding_id: "candidate-opaque-1",
				},
			}),
		});
		expect(updated).toMatchObject({
			ok: false,
			code: "runbook_target_binding_late",
		});
		expect(await rawRecordOf(deps, run.run_id)).toBe(before);
	});

	test("runbook progress identity is immutable and its cursor is monotonic", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-progress-guards", {
				environment_profile: {
					environment: "agent-chrome",
					profile: "progress-guards",
				},
				runbook_progress: {
					schema_version: "1",
					service_id: "oncore",
					flow_id: "snapshot-verify",
					runbook_version: "1",
					next_step: 1,
					total_steps: 3,
				},
				runbook_target_binding: {
					schema_version: "1",
					mode: "automatic",
					binding_id: "candidate-opaque-1",
				},
			}),
		);
		const lease = await acquireClaim(deps, run, "progress-writer");
		const attempt = async (
			progress: NonNullable<BrowserUseSharedRun["runbook_progress"]>,
		) =>
			await casUpdateSharedRun(deps, {
				runId: run.run_id,
				expectedRevision: run.revision,
				lease,
				mutate: (current) => ({ ...current, runbook_progress: progress }),
			});
		const original = run.runbook_progress;
		if (original === undefined) throw new Error("unreachable");

		expect(await attempt({ ...original, next_step: 0 })).toMatchObject({
			ok: false,
			code: "runbook_progress_regressed",
		});
		expect(
			await attempt({ ...original, flow_id: "different-flow" }),
		).toMatchObject({
			ok: false,
			code: "runbook_progress_identity_immutable",
		});
		expect(await attempt({ ...original, next_step: 4 })).toMatchObject({
			ok: false,
			code: "runbook_progress_out_of_range",
		});
		const advanced = await attempt({ ...original, next_step: 2 });
		expect(advanced).toMatchObject({
			ok: true,
			run: { revision: 2, runbook_progress: { next_step: 2 } },
		});
	});

	test("a stale expected revision is run_revision_stale and writes nothing", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-update-stale", {
				environment_profile: {
					environment: "agent-chrome",
					profile: "update-stale",
				},
			}),
		);
		const lease = await acquireClaim(deps, run, "stale-revision-writer");
		const before = await rawRecordOf(deps, "run-update-stale");
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-update-stale",
			expectedRevision: 7,
			lease,
			mutate: (run) => ({ ...run, state: "needs-human" }),
		});
		expect(updated).toMatchObject({ ok: false, code: "run_revision_stale" });
		expect(await rawRecordOf(deps, "run-update-stale")).toBe(before);
	});

	test("a mutate producing an invalid run is the typed U1 issue and writes nothing", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-update-invalid", {
				environment_profile: {
					environment: "agent-chrome",
					profile: "update-invalid",
				},
			}),
		);
		const lease = await acquireClaim(deps, run, "invalid-writer");
		const before = await rawRecordOf(deps, "run-update-invalid");
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-update-invalid",
			expectedRevision: 1,
			lease,
			mutate: (run) => ({ ...run, continuation: undefined }),
		});
		expect(updated).toMatchObject({
			ok: false,
			code: "run_blocked_without_continuation",
		});
		expect(await rawRecordOf(deps, "run-update-invalid")).toBe(before);
	});

	test("a mutate changing run_id is a typed run_id_immutable refusal", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-update-identity", {
				environment_profile: {
					environment: "agent-chrome",
					profile: "update-identity",
				},
			}),
		);
		const lease = await acquireClaim(deps, run, "identity-writer");
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-update-identity",
			expectedRevision: 1,
			lease,
			mutate: (run) => ({ ...run, run_id: "run-other" }),
		});
		expect(updated).toMatchObject({ ok: false, code: "run_id_immutable" });
	});

	test("an unknown run id is run_not_found", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-update-missing",
			expectedRevision: 1,
			lease: {
				fencing_token: 1,
				activation_epoch: 1,
				holderId: "missing-writer",
			},
			mutate: (run) => run,
		});
		expect(updated).toMatchObject({ ok: false, code: "run_not_found" });
	});

	test("a presented lease claim passes the stored write gate when fresh", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-update-leased", {
				environment_profile: { environment: "agent-chrome", profile: "leased" },
			}),
		);
		const acquired = await acquireLease(deps, {
			key: leaseKeyForRun(run),
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		expect(acquired.ok).toBe(true);
		if (!acquired.ok) throw new Error("unreachable");
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-update-leased",
			expectedRevision: 1,
			lease: {
				fencing_token: acquired.lease.fencing_token,
				activation_epoch: acquired.lease.activation_epoch,
				holderId: "holder-a",
			},
			mutate: (run_) => ({ ...run_, state: "needs-human" }),
		});
		expect(updated).toMatchObject({ ok: true, run: { revision: 2 } });
	});

	test("a stale lease claim is rejected by the write gate and writes nothing (R27)", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-update-fenced", {
				environment_profile: { environment: "agent-chrome", profile: "fenced" },
			}),
		);
		const acquired = await acquireLease(deps, {
			key: leaseKeyForRun(run),
			holderId: "holder-a",
			ttlMs: TTL_MS,
		});
		expect(acquired.ok).toBe(true);
		if (!acquired.ok) throw new Error("unreachable");
		const before = await rawRecordOf(deps, "run-update-fenced");
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-update-fenced",
			expectedRevision: 1,
			lease: {
				fencing_token: acquired.lease.fencing_token + 1,
				activation_epoch: acquired.lease.activation_epoch,
				holderId: "holder-a",
			},
			mutate: (run_) => ({ ...run_, state: "needs-human" }),
		});
		expect(updated).toMatchObject({ ok: false, code: "lease_fencing_stale" });
		expect(await rawRecordOf(deps, "run-update-fenced")).toBe(before);
	});

	test("generic mutation cannot create or replace the auth-owned fragment", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-update-auth-bypass", {
				environment_profile: { environment: "agent-chrome", profile: "auth-bypass" },
			}),
		);
		const lease = await acquireClaim(deps, run, "generic-writer");
		const before = await rawRecordOf(deps, run.run_id);
		const updated = await casUpdateSharedRun(deps, {
			runId: run.run_id,
			expectedRevision: run.revision,
			lease,
			mutate: (current) => ({ ...current, auth_fragment: FRAGMENT }),
		});
		expect(updated).toMatchObject({
			ok: false,
			code: "run_auth_fragment_forbidden",
		});
		expect(await rawRecordOf(deps, run.run_id)).toBe(before);
	});

	test("generic mutation cannot forge auth attestation or ready state", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-update-auth-state-bypass", {
				environment_profile: {
					environment: "agent-chrome",
					profile: "auth-state-bypass",
				},
			}),
		);
		const lease = await acquireClaim(deps, run, "generic-auth-state-writer");
		const before = await rawRecordOf(deps, run.run_id);
		const updated = await casUpdateSharedRun(deps, {
			runId: run.run_id,
			expectedRevision: run.revision,
			lease,
			mutate: (current) => ({
				...current,
				state: "ready",
				continuation: undefined,
				auth_attestation: ATTESTATION,
			}),
		});
		expect(updated).toMatchObject({
			ok: false,
			code: "run_auth_state_forbidden",
		});
		expect(await rawRecordOf(deps, run.run_id)).toBe(before);
	});

	test("epoch advance waits for the lease-validated run commit barrier", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-epoch-barrier", {
				environment_profile: { environment: "agent-chrome", profile: "epoch-barrier" },
			}),
		);
		const lease = await acquireClaim(deps, run, "barrier-writer");
		const runPath = deps.paths.state.runFile(run.run_id);
		let releaseWrite!: () => void;
		const writeGate = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		let reachedWrite!: () => void;
		const reachedWritePromise = new Promise<void>((resolve) => {
			reachedWrite = resolve;
		});
		let pauseOnce = true;
		const originalFs = deps.fs;
		const gatedDeps: RunStoreDeps = {
			...deps,
			fs: {
				...originalFs,
				async writeFileDurable(path, contents, mode) {
					if (pauseOnce && path.startsWith(`${runPath}.tmp-`)) {
						pauseOnce = false;
						reachedWrite();
						await writeGate;
					}
					await originalFs.writeFileDurable(path, contents, mode);
				},
			},
		};
		const update = casUpdateSharedRun(gatedDeps, {
			runId: run.run_id,
			expectedRevision: run.revision,
			lease,
			mutate: (current) => ({ ...current, state: "needs-human" }),
		});
		await reachedWritePromise;
		let advanceSettled = false;
		const advance = advanceActivationEpoch(gatedDeps, { expectedEpoch: 1 }).then(
			(result) => {
				advanceSettled = true;
				return result;
			},
		);
		await Bun.sleep(10);
		expect(advanceSettled).toBe(false);
		releaseWrite();
		expect(await update).toMatchObject({ ok: true });
		expect(await advance).toEqual({ ok: true, epoch: 2 });
	});
});

describe("S10: same-profile contention (R27, AE9)", () => {
	test("two writers targeting one environment/profile serialize on one lease", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const runA = await createOk(
			deps,
			blockedRun("run-contend-a", {
				environment_profile: { environment: "agent-chrome", profile: "contend" },
			}),
		);
		const runB = await createOk(
			deps,
			blockedRun("run-contend-b", {
				environment_profile: { environment: "agent-chrome", profile: "contend" },
			}),
		);
		// Distinct runs, one profile: ONE serialization key.
		expect(leaseKeyForRun(runA)).toBe(leaseKeyForRun(runB));
		const first = await acquireLease(deps, {
			key: leaseKeyForRun(runA),
			holderId: "agent-one",
			ttlMs: TTL_MS,
		});
		expect(first.ok).toBe(true);
		const second = await acquireLease(deps, {
			key: leaseKeyForRun(runB),
			holderId: "agent-two",
			ttlMs: TTL_MS,
		});
		expect(second).toMatchObject({
			ok: false,
			code: "lease_held",
			holder: { holder_id: "agent-one" },
			continuation: { next_action_id: "wait_for_lease" },
		});
	});
});

describe("S11: distinct-profile concurrency (R27, AE9)", () => {
	test("distinct proven profiles hold independent leases and both write", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const runDefault = await createOk(
			deps,
			blockedRun("run-profile-default", {
				environment_profile: { environment: "agent-chrome", profile: "first" },
			}),
		);
		const runSecond = await createOk(
			deps,
			blockedRun("run-profile-second", {
				environment_profile: { environment: "agent-chrome", profile: "second" },
			}),
		);
		expect(leaseKeyForRun(runDefault)).not.toBe(leaseKeyForRun(runSecond));
		const leaseDefault = await acquireLease(deps, {
			key: leaseKeyForRun(runDefault),
			holderId: "agent-one",
			ttlMs: TTL_MS,
		});
		const leaseSecond = await acquireLease(deps, {
			key: leaseKeyForRun(runSecond),
			holderId: "agent-two",
			ttlMs: TTL_MS,
		});
		expect(leaseDefault.ok).toBe(true);
		expect(leaseSecond.ok).toBe(true);
		if (!leaseDefault.ok || !leaseSecond.ok) throw new Error("unreachable");
		const updates = await Promise.all([
			casUpdateSharedRun(deps, {
				runId: "run-profile-default",
				expectedRevision: 1,
				lease: {
					fencing_token: leaseDefault.lease.fencing_token,
					activation_epoch: leaseDefault.lease.activation_epoch,
					holderId: "agent-one",
				},
				mutate: (run) => ({ ...run, state: "needs-human" }),
			}),
			casUpdateSharedRun(deps, {
				runId: "run-profile-second",
				expectedRevision: 1,
				lease: {
					fencing_token: leaseSecond.lease.fencing_token,
					activation_epoch: leaseSecond.lease.activation_epoch,
					holderId: "agent-two",
				},
				mutate: (run) => ({ ...run, state: "needs-human" }),
			}),
		]);
		expect(updates[0]).toMatchObject({ ok: true, run: { revision: 2 } });
		expect(updates[1]).toMatchObject({ ok: true, run: { revision: 2 } });
	});
});

const FRAGMENT: BrowserUseAuthFragmentSlot = {
	schema_version: "auth-1",
	fragment: { opaque_blob: "fragment-opaque-ref", nested: { keep: "verbatim" } },
};

const ATTESTATION = {
	attestation_digest: "attestation-digest-1",
	fresh_until_epoch_ms: 999_999,
};

// Accepting fakes: fragment admission and attestation verification both pass.
// The U3a durable-attestation enforcement path has its own tests with the
// real verifier below.
const ACCEPTING_AUTH_CONTRACT = {
	validateSecretFreeFragment: () => true,
	verifyAttestation: async () => true,
};

async function createReadyRun(
	deps: RunStoreDeps,
	runId: string,
	overrides: Partial<BrowserUseSharedRun> = {},
): Promise<BrowserUseSharedRun> {
	const blocked = await createOk(
		deps,
		blockedRun(runId, {
			environment_profile: {
				environment: "agent-chrome",
				profile: `ready-${runId}`,
			},
			...overrides,
		}),
	);
	const port = createRunIntegrationPort(
		deps,
		ACCEPTING_AUTH_CONTRACT,
		await acquireClaim(deps, blocked, `ready-${runId}`),
	);
	const committed = await port.commitAuthOutcome({
		run_id: runId,
		expected_revision: blocked.revision,
		fragment: FRAGMENT,
		summary: { state: "ready", attestation: ATTESTATION },
	});
	expect(committed.ok).toBe(true);
	if (!committed.ok) throw new Error("unreachable");
	return committed.run;
}

describe("S12: auth-held lease (R27, AE7)", () => {
	test("an awaiting-auth run's lease admits commitAuthOutcome and excludes a second writer", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-auth-held", {
				environment_profile: { environment: "agent-chrome", profile: "auth-held" },
			}),
		);
		// The auth transaction holds the run's environment/profile lease.
		const held = await acquireLease(deps, {
			key: leaseKeyForRun(run),
			holderId: "auth-transaction",
			ttlMs: TTL_MS,
			scope: { auth_context_ref: "auth-ref-1" },
		});
		expect(held.ok).toBe(true);
		if (!held.ok) throw new Error("unreachable");
		// The Port is bound to the exact held lease claim.
		const port = createRunIntegrationPort(deps, ACCEPTING_AUTH_CONTRACT, {
			fencing_token: held.lease.fencing_token,
			activation_epoch: held.lease.activation_epoch,
			holderId: held.lease.holder_id,
		});
		const committed = await port.commitAuthOutcome({
			run_id: "run-auth-held",
			expected_revision: 1,
			fragment: FRAGMENT,
			summary: { state: "ready", attestation: ATTESTATION },
		});
		expect(committed).toMatchObject({
			ok: true,
			run: { revision: 2, state: "ready" },
		});
		// A second writer's acquire stays refused while the lease lives.
		const second = await acquireLease(deps, {
			key: leaseKeyForRun(run),
			holderId: "agent-two",
			ttlMs: TTL_MS,
		});
		expect(second).toMatchObject({
			ok: false,
			code: "lease_held",
			holder: { holder_id: "auth-transaction" },
		});
	});
});

describe("commitAuthOutcome round-trip (R6, AE7 substrate)", () => {
	test("a validated opaque fragment persists verbatim and stays redaction-clean", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const run = await createOk(deps, blockedRun("run-auth-roundtrip"));
		clock.advance(250);
		const port = createRunIntegrationPort(
			deps,
			ACCEPTING_AUTH_CONTRACT,
			await acquireClaim(deps, run),
		);
		const committed = await port.commitAuthOutcome({
			run_id: "run-auth-roundtrip",
			expected_revision: 1,
			fragment: FRAGMENT,
			summary: { state: "ready", attestation: ATTESTATION },
		});
		expect(committed.ok).toBe(true);
		const loaded = await loadOk(deps, "run-auth-roundtrip");
		// Verbatim: the opaque fragment and attestation reference round-trip
		// exactly; the blocked continuation is cleared by the U1 reducer.
		expect(loaded.run.auth_fragment).toEqual(FRAGMENT);
		expect(loaded.run.auth_attestation).toEqual(ATTESTATION);
		expect(loaded.run.state).toBe("ready");
		expect(loaded.run.revision).toBe(2);
		expect(loaded.run.continuation).toBeUndefined();
		expect(loaded.payload.created_at_epoch_ms).toBe(1_000);
		expect(loaded.payload.updated_at_epoch_ms).toBe(1_250);
		// Opaque, not certified: the durable payload passes the redaction walk
		// with the fragment subtree skipped by the structural rule.
		expect(findRedactionViolations(loaded.payload)).toEqual([]);
		const raw = await rawRecordOf(deps, "run-auth-roundtrip");
		expect(raw).toContain("fragment-opaque-ref");
		expect(parseDurableRecord(raw, "shared-run")).toEqual({
			ok: true,
			payload: loaded.payload,
		});
	});

	test("a rejected fragment returns the reducer rejection verbatim and never touches disk", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const run = await createOk(deps, blockedRun("run-auth-rejected"));
		const before = await rawRecordOf(deps, "run-auth-rejected");
		const port = createRunIntegrationPort(
			deps,
			{ validateSecretFreeFragment: () => false, verifyAttestation: async () => true },
			await acquireClaim(deps, run),
		);
		const committed = await port.commitAuthOutcome({
			run_id: "run-auth-rejected",
			expected_revision: 1,
			fragment: {
				schema_version: "auth-1",
				fragment: { sentinel: "rejected-fragment-sentinel" },
			},
			summary: { state: "ready", attestation: ATTESTATION },
		});
		expect(committed).toEqual({
			ok: false,
			rejection: {
				code: "auth_fragment_unsafe",
				message: expect.stringContaining("not persisted"),
			},
		});
		const after = await rawRecordOf(deps, "run-auth-rejected");
		expect(after).toBe(before);
		expect(after).not.toContain("rejected-fragment-sentinel");
	});

	test("a stale expected revision is the reducer's run_revision_stale, nothing written", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const run = await createOk(deps, blockedRun("run-auth-stale"));
		const before = await rawRecordOf(deps, "run-auth-stale");
		const port = createRunIntegrationPort(
			deps,
			ACCEPTING_AUTH_CONTRACT,
			await acquireClaim(deps, run),
		);
		const committed = await port.commitAuthOutcome({
			run_id: "run-auth-stale",
			expected_revision: 9,
			fragment: FRAGMENT,
			summary: { state: "ready", attestation: ATTESTATION },
		});
		expect(committed).toMatchObject({
			ok: false,
			rejection: { code: "run_revision_stale" },
		});
		expect(await rawRecordOf(deps, "run-auth-stale")).toBe(before);
	});

	test("a terminal run rejects the commit with run_terminal", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-auth-terminal", {
				state: "confirmed",
				continuation: undefined,
			}),
		);
		const port = createRunIntegrationPort(
			deps,
			ACCEPTING_AUTH_CONTRACT,
			await acquireClaim(deps, run),
		);
		const committed = await port.commitAuthOutcome({
			run_id: "run-auth-terminal",
			expected_revision: 1,
			fragment: FRAGMENT,
			summary: { state: "ready", attestation: ATTESTATION },
		});
		expect(committed).toMatchObject({
			ok: false,
			rejection: { code: "run_terminal" },
		});
	});

	test("a superseded auth lease cannot commit through its bound port", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-auth-superseded", {
				environment_profile: {
					environment: "agent-chrome",
					profile: "auth-superseded",
				},
			}),
		);
		const staleClaim = await acquireClaim(deps, run, "auth-a");
		const port = createRunIntegrationPort(
			deps,
			ACCEPTING_AUTH_CONTRACT,
			staleClaim,
		);
		clock.set(6_000);
		await acquireClaim(deps, run, "auth-b");
		await expect(
			port.commitAuthOutcome({
				run_id: run.run_id,
				expected_revision: run.revision,
				fragment: FRAGMENT,
				summary: { state: "ready", attestation: ATTESTATION },
			}),
		).rejects.toThrow("lease_fencing_stale");
		expect((await loadOk(deps, run.run_id)).run.revision).toBe(1);
	});
});

describe("S15: restart/resume (R24, AE7/AE15 substrate)", () => {
	test("a fresh deps object over the same temp state re-emits the blocked run plus its one continuation", async () => {
		const clockA = fixedClock();
		const { deps: depsA, env } = await makeIsolatedDeps(clockA.now);
		await createOk(
			depsA,
			blockedRun("run-restart", {
				state: "awaiting-approval",
				continuation: {
					next_action_id: "approve_run",
					summary: "Approve this run, then resume it.",
				},
			}),
		);
		const bytesBeforeRestart = await rawRecordOf(depsA, "run-restart");
		// "Restart": a brand-new deps object (fresh fs port, re-opened paths,
		// fresh clock) over the SAME durable temp state.
		const clockB = fixedClock(50_000);
		const depsB = await depsOver(env, clockB.now);
		const loaded = await loadOk(depsB, "run-restart");
		expect(loaded.run.state).toBe("awaiting-approval");
		expect(loaded.run.revision).toBe(1);
		const resumed = await resumeSharedRun(depsB, { runId: "run-restart" });
		expect(resumed).toEqual({
			kind: "blocked",
			run: loaded.run,
			continuation: {
				next_action_id: "approve_run",
				summary: "Approve this run, then resume it.",
			},
		});
		// Resume is a projection: the durable record is byte-identical after it.
		expect(await rawRecordOf(depsB, "run-restart")).toBe(bytesBeforeRestart);
	});

	test("a ready run passes the same-lane gate and reports execution unavailable", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createReadyRun(
			deps,
			"run-resume-ready",
			{
				adapter_id: "agent-browser",
				handoff_evidence_id: "evidence-1",
			},
		);
		const withObserved = await resumeSharedRun(deps, {
			runId: "run-resume-ready",
			observed: {
				adapter_id: "agent-browser",
				environment_profile: run.environment_profile,
			},
		});
		expect(withObserved).toEqual({ kind: "execution-unavailable", run });
		// The gate applies only when an observed identity is supplied.
		const withoutObserved = await resumeSharedRun(deps, {
			runId: "run-resume-ready",
		});
		expect(withoutObserved).toEqual({ kind: "execution-unavailable", run });
	});

	test("an observed lane mismatch surfaces the U1 refusal verbatim", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createReadyRun(
			deps,
			"run-resume-mismatch",
			{
				adapter_id: "agent-browser",
				handoff_evidence_id: "evidence-1",
			},
		);
		const resumed = await resumeSharedRun(deps, {
			runId: "run-resume-mismatch",
			observed: {
				adapter_id: "playwright-cdp",
				environment_profile: run.environment_profile,
			},
		});
		expect(resumed).toMatchObject({
			kind: "lane-mismatch",
			refusal: { ok: false, code: "run_lane_mismatch" },
		});
	});

	test("terminal truth never re-enters execution", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-resume-terminal", {
				state: "unknown",
				continuation: undefined,
			}),
		);
		const resumed = await resumeSharedRun(deps, { runId: "run-resume-terminal" });
		expect(resumed).toEqual({ kind: "terminal", run });
	});

	test("a missing run resumes as the typed load failure", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		const resumed = await resumeSharedRun(deps, { runId: "run-resume-missing" });
		expect(resumed).toMatchObject({
			kind: "load-failed",
			failure: { ok: false, code: "run_not_found" },
		});
	});
});

describe("listSharedRunReceipts (R35, AE15 substrate)", () => {
	test("receipts list sorted, name each blocked run's continuation, and stay redaction-clean", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		await createOk(
			deps,
			blockedRun("run-z-terminal", { state: "confirmed", continuation: undefined }),
		);
		await createOk(
			deps,
			blockedRun("run-a-blocked", {
				state: "awaiting-approval",
				continuation: {
					next_action_id: "approve_run",
					summary: "Approve this run, then resume it.",
				},
			}),
		);
		// A corrupt sibling record is skipped, never a listing crash.
		await seedRunRecord(deps, "run-m-corrupt", "{ torn");
		const receipts = await listSharedRunReceipts(deps);
		expect(receipts.map((receipt) => receipt.run_id)).toEqual([
			"run-a-blocked",
			"run-z-terminal",
		]);
		expect(receipts[0]?.summary).toContain("next: approve_run");
		expect(receipts[0]?.state).toBe("awaiting-approval");
		expect(receipts[1]?.state).toBe("confirmed");
		for (const receipt of receipts) {
			expect(findRedactionViolations(receipt)).toEqual([]);
			expect(receipt.receipt_digest).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	test("an untouched store lists no receipts", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		expect(await listSharedRunReceipts(deps)).toEqual([]);
	});

	test("foreign non-segment entries do not hide valid run receipts", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		await createOk(deps, blockedRun("run-valid-entry"));
		const originalFs = deps.fs;
		const faultingDeps: RunStoreDeps = {
			...deps,
			fs: {
				...originalFs,
				async readDirectory(path) {
					if (path === deps.paths.state.runsDir) {
						return ["../escape", "run-valid-entry"];
					}
					return await originalFs.readDirectory(path);
				},
			},
		};
		expect(
			(await listSharedRunReceipts(faultingDeps)).map((receipt) => receipt.run_id),
		).toEqual(["run-valid-entry"]);
	});
});

// =========================================================================
// U3a: durable attestation custody and the commit ready gate (R30; auth
// plan 2026-07-21-003 "attestation persistence"). The write lands before
// commit returns ready — enforced mechanically: the Port refuses a ready
// summary whose bounded attestation the auth-owned verifier cannot re-prove
// against a durable record.
// =========================================================================

function attestationFor(
	runId: string,
	overrides: Partial<BrowserUseAuthAttestation> = {},
): BrowserUseAuthAttestation {
	return {
		run_id: runId,
		handoff_evidence_id: "evidence-1",
		lane_id: "agent-browser",
		implementation_integrity_key: "agent-browser@1.0.0",
		environment: "agent-chrome",
		profile: "default",
		target_id: "target-1",
		page_id: "page-1",
		frame_id: "frame-root",
		service_id: "service-1",
		auth_context: "auth-context-1",
		subject_reference: "subject-ref-1",
		account_reference: "account-ref-1",
		tenant_reference: "tenant-ref-1",
		identity_basis: "session-identity-proof",
		identity_basis_digest: "0".repeat(64),
		observed_at_epoch_ms: 1_000,
		fresh_until_epoch_ms: 999_999,
		...overrides,
	};
}

// The ready gate under test is attestation verification; fragment admission
// has its own proof in browser-use-auth.test.ts, so the U2 test fragment is
// waved through while verifyAttestation is the REAL store-backed verifier.
function storeBackedContract(deps: RunStoreDeps) {
	const real = createBrowserUseAuthContract({
		attestationByDigest: attestationByDigestFrom(deps),
	});
	return {
		validateSecretFreeFragment: () => true,
		verifyAttestation: real.verifyAttestation,
	};
}

describe("U3a: attestation custody (content-addressed durable records)", () => {
	test("an attestation record round-trips through content-addressed custody", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const record = attestationFor("run-att-roundtrip");
		const digest = authAttestationDigestOf(record);
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
		const written = await writeAuthAttestationRecord(deps, { digest, record });
		expect(written).toEqual({ ok: true });
		// Idempotent by construction: same digest, same content.
		expect(await writeAuthAttestationRecord(deps, { digest, record })).toEqual({
			ok: true,
		});
		expect(await readAuthAttestationRecord(deps, digest)).toEqual({
			status: "present",
			record,
		});
		const byDigest = attestationByDigestFrom(deps);
		expect(await byDigest(digest)).toEqual(record);
		expect(await byDigest("0".repeat(64))).toBeUndefined();
		// A digest-shape-invalid lookup is an absent record, never a crash.
		expect(await byDigest("not-a-digest")).toBeUndefined();
	});

	test("a redaction-violating record refuses custody and writes nothing", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const record = attestationFor("run-att-redaction", {
			subject_reference: "op://vault/item/field",
		});
		const digest = authAttestationDigestOf(record);
		const written = await writeAuthAttestationRecord(deps, { digest, record });
		expect(written).toMatchObject({ ok: false, code: "attestation_record_invalid" });
		expect(await readAuthAttestationRecord(deps, digest)).toEqual({
			status: "missing",
		});
	});

	test("a corrupt record reads corrupt and resolves undefined by digest", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const digest = "ab".repeat(32);
		// Land a valid record first so the attestations dir exists, then
		// corrupt the durable bytes in place.
		const record = attestationFor("run-att-corrupt");
		await writeAuthAttestationRecord(deps, {
			digest,
			record,
		});
		await writeDurableFile(deps.fs, {
			path: deps.paths.state.attestationFile(digest),
			contents: "not-a-durable-record\n",
		});
		expect(await readAuthAttestationRecord(deps, digest)).toMatchObject({
			status: "corrupt",
		});
		expect(await attestationByDigestFrom(deps)(digest)).toBeUndefined();
	});

	test("a digest-shape-invalid name is a typed refusal at the custody seam, never a throw", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const record = attestationFor("run-att-bad-digest");
		const written = await writeAuthAttestationRecord(deps, {
			digest: "not-a-digest",
			record,
		});
		expect(written).toMatchObject({ ok: false, code: "attestation_record_invalid" });
		expect(await readAuthAttestationRecord(deps, "not-a-digest")).toEqual({
			status: "missing",
		});
	});

	test("a valid record filed under a lying digest is refused by the auth-owned verifier", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const record = attestationFor("run-att-lying-digest");
		const lyingDigest = "cd".repeat(32);
		expect(lyingDigest).not.toBe(authAttestationDigestOf(record));
		expect(
			await writeAuthAttestationRecord(deps, { digest: lyingDigest, record }),
		).toEqual({ ok: true });
		// Custody serves the record by its lying name...
		expect(await attestationByDigestFrom(deps)(lyingDigest)).toEqual(record);
		// ...and the verifier refuses it: every run fact matches the record,
		// so the ONLY failing proof is the digest recomputation.
		const contract = createBrowserUseAuthContract({
			attestationByDigest: attestationByDigestFrom(deps),
		});
		expect(
			await contract.verifyAttestation({
				reference: {
					attestation_digest: lyingDigest,
					fresh_until_epoch_ms: record.fresh_until_epoch_ms,
				},
				run_id: record.run_id,
				environment_profile: {
					environment: record.environment,
					profile: record.profile,
				},
				adapter_id: "agent-browser",
				handoff_evidence_id: record.handoff_evidence_id,
				at_epoch_ms: 1_000,
			}),
		).toBe(false);
	});
});

describe("U3a: the commit ready gate (no durable attestation, no ready run)", () => {
	test("commit turns ready only over a durable, binding-true attestation record", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const run = await createOk(deps, blockedRun("run-att-ready"));
		const record = attestationFor("run-att-ready");
		const digest = authAttestationDigestOf(record);
		expect(await writeAuthAttestationRecord(deps, { digest, record })).toEqual({
			ok: true,
		});
		const port = createRunIntegrationPort(
			deps,
			storeBackedContract(deps),
			await acquireClaim(deps, run),
		);
		const committed = await port.commitAuthOutcome({
			run_id: "run-att-ready",
			expected_revision: 1,
			fragment: FRAGMENT,
			summary: {
				state: "ready",
				attestation: {
					attestation_digest: digest,
					fresh_until_epoch_ms: record.fresh_until_epoch_ms,
				},
			},
		});
		expect(committed).toMatchObject({ ok: true, run: { state: "ready", revision: 2 } });
		const loaded = await loadOk(deps, "run-att-ready");
		expect(loaded.run.auth_attestation).toEqual({
			attestation_digest: digest,
			fresh_until_epoch_ms: record.fresh_until_epoch_ms,
		});
	});

	test("a ready commit without a durable record is a typed rejection and writes nothing", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const run = await createOk(deps, blockedRun("run-att-absent"));
		const before = await rawRecordOf(deps, "run-att-absent");
		const record = attestationFor("run-att-absent");
		const digest = authAttestationDigestOf(record);
		const port = createRunIntegrationPort(
			deps,
			storeBackedContract(deps),
			await acquireClaim(deps, run),
		);
		const committed = await port.commitAuthOutcome({
			run_id: "run-att-absent",
			expected_revision: 1,
			fragment: FRAGMENT,
			summary: {
				state: "ready",
				attestation: {
					attestation_digest: digest,
					fresh_until_epoch_ms: record.fresh_until_epoch_ms,
				},
			},
		});
		expect(committed).toEqual({
			ok: false,
			rejection: {
				code: "run_ready_attestation_unverified",
				message: expect.any(String),
			},
		});
		expect(await rawRecordOf(deps, "run-att-absent")).toBe(before);
	});

	test("a ready commit on a lane-unbound run refuses verification", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const run = await createOk(
			deps,
			blockedRun("run-att-unbound", {
				adapter_id: undefined,
				handoff_evidence_id: undefined,
			}),
		);
		const record = attestationFor("run-att-unbound");
		const digest = authAttestationDigestOf(record);
		await writeAuthAttestationRecord(deps, { digest, record });
		const port = createRunIntegrationPort(
			deps,
			storeBackedContract(deps),
			await acquireClaim(deps, run),
		);
		const committed = await port.commitAuthOutcome({
			run_id: "run-att-unbound",
			expected_revision: 1,
			fragment: FRAGMENT,
			summary: {
				state: "ready",
				attestation: {
					attestation_digest: digest,
					fresh_until_epoch_ms: record.fresh_until_epoch_ms,
				},
			},
		});
		expect(committed).toMatchObject({
			ok: false,
			rejection: { code: "run_ready_attestation_unverified" },
		});
	});

	test("a record bound to a different run refuses ready (binding drift)", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const run = await createOk(deps, blockedRun("run-att-drift"));
		const record = attestationFor("run-att-other");
		const digest = authAttestationDigestOf(record);
		await writeAuthAttestationRecord(deps, { digest, record });
		const port = createRunIntegrationPort(
			deps,
			storeBackedContract(deps),
			await acquireClaim(deps, run),
		);
		const committed = await port.commitAuthOutcome({
			run_id: "run-att-drift",
			expected_revision: 1,
			fragment: FRAGMENT,
			summary: {
				state: "ready",
				attestation: {
					attestation_digest: digest,
					fresh_until_epoch_ms: record.fresh_until_epoch_ms,
				},
			},
		});
		expect(committed).toMatchObject({
			ok: false,
			rejection: { code: "run_ready_attestation_unverified" },
		});
	});
});

describe("U3a: typed commit infrastructure errors (the #259 coded-error debt)", () => {
	test("a stale lease claim throws the typed lease-rejected kind", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const run = await createOk(deps, blockedRun("run-att-lease"));
		const claim = await acquireClaim(deps, run);
		const port = createRunIntegrationPort(deps, storeBackedContract(deps), claim);
		// Advance the activation epoch out from under the held claim: the
		// fenced write gate must refuse it inside the critical section.
		const advanced = await advanceActivationEpoch(deps, { expectedEpoch: 1 });
		expect(advanced.ok).toBe(true);
		let thrown: unknown;
		try {
			await port.commitAuthOutcome({
				run_id: "run-att-lease",
				expected_revision: 1,
				fragment: FRAGMENT,
				summary: {
					state: "needs-human",
					continuation: {
						next_action_id: "inspect-adapter-crash",
						summary: "Inspect the crashed lane before resuming.",
					},
				},
			});
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(BrowserUseAuthCommitInfrastructureError);
		const typed = thrown as BrowserUseAuthCommitInfrastructureError;
		expect(typed.kind).toBe("lease-rejected");
		expect(typed.detail_code).toBe("lease_epoch_stale");
		expect(typed.message.startsWith("auth commit lease rejected")).toBe(true);
	});

	test("a missing run throws the typed store-faulted kind", async () => {
		const clock = fixedClock();
		const { deps } = await makeIsolatedDeps(clock.now);
		const run = await createOk(deps, blockedRun("run-att-fault-anchor"));
		const port = createRunIntegrationPort(
			deps,
			storeBackedContract(deps),
			await acquireClaim(deps, run),
		);
		let thrown: unknown;
		try {
			await port.commitAuthOutcome({
				run_id: "run-att-missing",
				expected_revision: 1,
				fragment: FRAGMENT,
				summary: {
					state: "needs-human",
					continuation: {
						next_action_id: "inspect-adapter-crash",
						summary: "Inspect the crashed lane before resuming.",
					},
				},
			});
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(BrowserUseAuthCommitInfrastructureError);
		const typed = thrown as BrowserUseAuthCommitInfrastructureError;
		expect(typed.kind).toBe("store-faulted");
		expect(typed.detail_code).toBe("run_not_found");
	});
});
