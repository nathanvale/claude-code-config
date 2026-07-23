import { afterAll, describe, expect, test } from "bun:test";
import { dirname } from "node:path";
import { acquireLease } from "./browser-use-locks";
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
	casUpdateSharedRun,
	createRunIntegrationPort,
	createSharedRun,
	leaseKeyForRun,
	listSharedRunReceipts,
	loadSharedRun,
	resumeSharedRun,
	type RunStoreDeps,
} from "./browser-use-runs";
import {
	type BrowserUseSharedRunPayload,
	encodeDurableRecord,
	findRedactionViolations,
	parseDurableRecord,
} from "./browser-use-schemas";
import { readDurableFile } from "./browser-use-store";

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
		const created = await createOk(deps, blockedRun("run-redaction-update"));
		const rawBefore = await rawRecordOf(deps, "run-redaction-update");
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-redaction-update",
			expectedRevision: created.revision,
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
	test("a leaseless update mutates purely, bumps the revision, and keeps created_at", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		await createOk(deps, blockedRun("run-update-ok"));
		clock.advance(500);
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-update-ok",
			expectedRevision: 1,
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

	test("a stale expected revision is run_revision_stale and writes nothing", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		await createOk(deps, blockedRun("run-update-stale"));
		const before = await rawRecordOf(deps, "run-update-stale");
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-update-stale",
			expectedRevision: 7,
			mutate: (run) => ({ ...run, state: "needs-human" }),
		});
		expect(updated).toMatchObject({ ok: false, code: "run_revision_stale" });
		expect(await rawRecordOf(deps, "run-update-stale")).toBe(before);
	});

	test("a mutate producing an invalid run is the typed U1 issue and writes nothing", async () => {
		const clock = fixedClock();
		const deps = await makeSharedDeps(clock.now);
		await createOk(deps, blockedRun("run-update-invalid"));
		const before = await rawRecordOf(deps, "run-update-invalid");
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-update-invalid",
			expectedRevision: 1,
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
		await createOk(deps, blockedRun("run-update-identity"));
		const updated = await casUpdateSharedRun(deps, {
			runId: "run-update-identity",
			expectedRevision: 1,
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

const ACCEPTING_AUTH_CONTRACT = {
	validateSecretFreeFragment: () => true,
};

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
		// The Port commits under that held lease without re-presenting it.
		const port = createRunIntegrationPort(deps, ACCEPTING_AUTH_CONTRACT);
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
		const deps = await makeSharedDeps(clock.now);
		await createOk(deps, blockedRun("run-auth-roundtrip"));
		clock.advance(250);
		const port = createRunIntegrationPort(deps, ACCEPTING_AUTH_CONTRACT);
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
		const deps = await makeSharedDeps(clock.now);
		await createOk(deps, blockedRun("run-auth-rejected"));
		const before = await rawRecordOf(deps, "run-auth-rejected");
		const port = createRunIntegrationPort(deps, {
			validateSecretFreeFragment: () => false,
		});
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
		const deps = await makeSharedDeps(clock.now);
		await createOk(deps, blockedRun("run-auth-stale"));
		const before = await rawRecordOf(deps, "run-auth-stale");
		const port = createRunIntegrationPort(deps, ACCEPTING_AUTH_CONTRACT);
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
		const deps = await makeSharedDeps(clock.now);
		await createOk(
			deps,
			blockedRun("run-auth-terminal", {
				state: "confirmed",
				continuation: undefined,
			}),
		);
		const port = createRunIntegrationPort(deps, ACCEPTING_AUTH_CONTRACT);
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
		const run = await createOk(
			deps,
			blockedRun("run-resume-ready", {
				state: "ready",
				continuation: undefined,
				auth_attestation: ATTESTATION,
				adapter_id: "agent-browser",
				handoff_evidence_id: "evidence-1",
			}),
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
		const run = await createOk(
			deps,
			blockedRun("run-resume-mismatch", {
				state: "ready",
				continuation: undefined,
				auth_attestation: ATTESTATION,
				adapter_id: "agent-browser",
				handoff_evidence_id: "evidence-1",
			}),
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
});
