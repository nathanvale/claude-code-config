// ---------------------------------------------------------------------------
// Shared-run persistence (platform plan 2026-07-21-002 U2, R24/R27/R35-R37;
// AE7-AE9, AE15 substrate).
//
// Makes the U1 pure run model durable without re-deriving any of its
// semantics: create/load over the typed parse matrix, CAS updates gated by
// the fenced lease write gate, the environment/profile serialization key,
// the auth-plan integration Port (`commitAuthOutcome` wraps the U1
// `applyAuthCommit` reducer — a reducer rejection is returned verbatim and
// NOTHING is written), the redacted receipt listing, and the restart/resume
// projection over durable state. Every run byte flows through the store's
// durable-write pipeline inside one exclusive per-run advisory lock; every
// transition flows through the U1 guards (`validateSharedRun`,
// `applyAuthCommit`, `checkSameLaneResume`). Nothing imports this module
// except the public command files and tests.
//
// Import direction: schemas + store + locks + paths + run-model + core.
// No Date.now, no Math.random, no process.cwd(); time enters only through
// the injected clock. The `auth_fragment` is stored opaque and verbatim; no
// code here parses its content (R6).
// ---------------------------------------------------------------------------

import { dirname, join } from "node:path";
import { redactUnsafeText } from "./browser-use-core";
import {
	type LeaseWriteClaim,
	validateStoredLeaseForWrite,
	withActivationEpochBarrier,
} from "./browser-use-locks";
import type {
	BrowserUseAdmittedPaths,
	BrowserUsePlatformFs,
} from "./browser-use-paths";
import {
	type BrowserUseAuthCommitResult,
	type BrowserUseAuthContractPort,
	type BrowserUseResumeCheck,
	type BrowserUseRunContinuation,
	type BrowserUseRunIntegrationPort,
	type BrowserUseRunState,
	type BrowserUseSharedRun,
	BROWSER_USE_BLOCKED_RUN_STATES,
	BROWSER_USE_TERMINAL_RUN_STATES,
	applyAuthCommit,
	checkSameLaneResume,
	validateSharedRun,
} from "./browser-use-run-model";
import {
	type BrowserUseAuthAttestationPayload,
	type BrowserUseRunReceiptPayload,
	type BrowserUseSharedRunPayload,
	encodeDurableRecord,
	findRedactionViolations,
	parseDurableRecord,
	receiptForRun,
	validateSharedRunPayload,
} from "./browser-use-schemas";
import {
	type StoreFailure,
	casReplaceRecord,
	readDurableFile,
	withExclusiveFileLock,
	writeDurableFile,
} from "./browser-use-store";

// --- Deps and shared types ---------------------------------------------------

/** Injected seams: fs port, admitted paths, and the clock (NEVER Date.now). */
export type RunStoreDeps = {
	fs: BrowserUsePlatformFs;
	paths: BrowserUseAdmittedPaths;
	clock: () => number;
};

/** Typed load outcome: the run plus its persisted payload, or one refusal. */
export type RunLoad =
	| { ok: true; run: BrowserUseSharedRun; payload: BrowserUseSharedRunPayload }
	| {
			ok: false;
			code: "run_not_found" | "run_record_invalid" | "run_record_corrupt";
			message: string;
	  };

/** One typed run-store refusal (create/update surfaces). */
type RunFailure = { ok: false; code: string; message: string };

// --- Internal helpers --------------------------------------------------------

/** Private modes mirror the paths admission constants (R12). */
const PRIVATE_DIR_MODE = 0o700;

// Advisory lockfiles guard sub-second read-modify-write sections; a crashed
// holder's leftover lockfile ages out after this window (store semantics:
// strictly greater than).
const LOCKFILE_STALE_AFTER_MS = 10_000;

function runFailure(code: string, message: string): RunFailure {
	return { ok: false, code, message: redactUnsafeText(message) };
}

// Mechanical redaction admission (R13, backstop): the LAST gate before a run
// record reaches 0600 durable state. `findRedactionViolations` walks the
// payload for sensitive key names and secret-shaped values (op:// refs, raw
// ws(s):// endpoints) an adapter error might echo; the opaque
// `auth_fragment.fragment` subtree is skipped by the walker's design (it is
// gated at auth-commit time by `validateSecretFreeFragment`). A denylist
// safety net, not the privacy mechanism — a violation refuses the write with
// `run_record_invalid` and NOTHING is persisted.
function admitRedactionClean(
	payload: BrowserUseSharedRunPayload,
): { ok: true } | RunFailure {
	const violations = findRedactionViolations(payload);
	const first = violations[0];
	if (first === undefined) return { ok: true };
	return runFailure(
		"run_record_invalid",
		`run record carries a redaction violation (${first.reason}) at ${first.path}; refusing to persist.`,
	);
}

// Mirrors the store's rule: messages carry only the errno code, never the
// node error string (those embed quoted paths).
function errorCode(error: unknown): string {
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" && code !== "" ? code : "unknown";
}

// Run ids are already safe single path segments (runFile asserts), so the
// lockfile name embeds the id directly (the retention lock-name precedent).
function runLockPath(paths: BrowserUseAdmittedPaths, runId: string): string {
	return join(paths.runtime.locksDir, `run-${runId}.lock`);
}

// The run's record directory and the runtime locks dir are created lazily
// (admission owns the roots; module-owned subdirectories are created by
// their owner).
async function ensureRunDirs(
	deps: RunStoreDeps,
	runId: string,
): Promise<{ ok: true } | RunFailure> {
	try {
		await deps.fs.mkdir(dirname(deps.paths.state.runFile(runId)), {
			recursive: true,
			mode: PRIVATE_DIR_MODE,
		});
		await deps.fs.mkdir(deps.paths.runtime.locksDir, {
			recursive: true,
			mode: PRIVATE_DIR_MODE,
		});
	} catch (error) {
		return runFailure(
			"store_flush_failed",
			`run directories could not be created (${errorCode(error)}).`,
		);
	}
	return { ok: true };
}

function isBlockedState(state: BrowserUseRunState): boolean {
	return (BROWSER_USE_BLOCKED_RUN_STATES as readonly BrowserUseRunState[]).includes(
		state,
	);
}

function isTerminalState(state: BrowserUseRunState): boolean {
	return (BROWSER_USE_TERMINAL_RUN_STATES as readonly BrowserUseRunState[]).includes(
		state,
	);
}

// The pure U1 run is the persisted payload minus the two persistence
// timestamps; unknown extra payload keys survive verbatim (the parse matrix
// tolerates them within one schema version).
function runOfPayload(payload: BrowserUseSharedRunPayload): BrowserUseSharedRun {
	const {
		created_at_epoch_ms: _created,
		updated_at_epoch_ms: _updated,
		...run
	} = payload;
	return run;
}

// The store CAS revision extractor: parse failure classifies as corrupt.
function revisionOfRaw(raw: string): number | undefined {
	const parsed = parseDurableRecord(raw, "shared-run");
	return parsed.ok ? parsed.payload.revision : undefined;
}

// Narrow the withExclusiveFileLock union: an advisory-lock failure carries a
// StoreFailure; body outcomes never do.
function isLockFailure<T extends { ok: boolean }>(
	outcome: T | { ok: false; failure: StoreFailure },
): outcome is { ok: false; failure: StoreFailure } {
	return !outcome.ok && "failure" in outcome;
}

// --- Serialization key (R27) --------------------------------------------------

/**
 * The U2 lease key (R27 "initially" reading + AE9): environment/profile is
 * the serialization unit — same profile serializes, distinct proven profiles
 * proceed independently. The NUL separator keeps the composite unambiguous
 * (`("a","bc")` never collides with `("ab","c")`); the key never touches
 * path derivation — `locks.leaseRecordPath` owns the filename hashing. Finer
 * facets (auth context, target, runbook) are recorded on the lease `scope`
 * for inspection; splitting the key on them is a U4+ decision.
 *
 * @param run - Run (or any carrier of its environment/profile identity)
 * @returns Opaque serialization key for `acquireLease`/the write gate
 */
export function leaseKeyForRun(
	run: Pick<BrowserUseSharedRun, "environment_profile">,
): string {
	return `${run.environment_profile.environment}\0${run.environment_profile.profile}`;
}

// --- Load (R24, R35 substrate) ------------------------------------------------

/**
 * Load one shared run from durable state (R24). Classification: a missing
 * record is `run_not_found`; unreadable bytes or torn JSON are
 * `run_record_corrupt`; a well-formed record violating the envelope, the
 * schema version, the payload shape, or the U1 run invariants is
 * `run_record_invalid`. A load never writes.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param runId - Run id (a safe single path segment)
 * @returns The run plus its persisted payload, or one typed refusal
 */
export async function loadSharedRun(
	deps: RunStoreDeps,
	runId: string,
): Promise<RunLoad> {
	const read = await readDurableFile(deps.fs, deps.paths.state.runFile(runId));
	if (read.status === "missing") {
		return {
			ok: false,
			code: "run_not_found",
			message: redactUnsafeText(`run ${runId} has no durable record.`),
		};
	}
	if (read.status === "unreadable") {
		return { ok: false, code: "run_record_corrupt", message: read.message };
	}
	const parsed = parseDurableRecord(read.raw, "shared-run");
	if (!parsed.ok) {
		return {
			ok: false,
			code:
				parsed.code === "record_json_invalid"
					? "run_record_corrupt"
					: "run_record_invalid",
			message: parsed.message,
		};
	}
	const issues = validateSharedRunPayload(parsed.payload);
	if (issues.length > 0) {
		return {
			ok: false,
			code: "run_record_invalid",
			message: redactUnsafeText(
				`run record violates ${issues.map((issue) => issue.code).join(", ")}.`,
			),
		};
	}
	return { ok: true, run: runOfPayload(parsed.payload), payload: parsed.payload };
}

// --- Create -------------------------------------------------------------------

/**
 * Create one shared run at revision 1 (R24). The initial run must pass the
 * U1 `validateSharedRun` guard. Generic creation cannot forge auth-owned
 * fragment, attestation, or ready state; auth readiness must enter through
 * the leased auth integration Port. Written via the store CAS with
 * `expectedRevision: null` (must-not-exist), so a duplicate create is a
 * typed `store_record_conflict` and a rejected create writes nothing. U2's
 * CLI does not create runs; this is the library seam U4/U6 and tests call.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param run - The full run minus its revision (persistence owns the token)
 * @returns The created run at revision 1, or one typed refusal
 */
export async function createSharedRun(
	deps: RunStoreDeps,
	run: Omit<BrowserUseSharedRun, "revision">,
): Promise<{ ok: true; run: BrowserUseSharedRun } | RunFailure> {
	if (run.auth_fragment !== undefined) {
		return runFailure(
			"run_auth_fragment_forbidden",
			"generic run creation cannot persist auth_fragment; use the auth integration port.",
		);
	}
	if (run.auth_attestation !== undefined || run.state === "ready") {
		return runFailure(
			"run_auth_state_forbidden",
			"generic run creation cannot persist auth attestation or ready state; use the auth integration port.",
		);
	}
	const path = deps.paths.state.runFile(run.run_id);
	const initial: BrowserUseSharedRun = { ...run, revision: 1 };
	const issues = validateSharedRun(initial);
	const firstIssue = issues[0];
	if (firstIssue !== undefined) {
		return runFailure(
			firstIssue.code,
			issues.map((issue) => issue.message).join(" "),
		);
	}
	const dirs = await ensureRunDirs(deps, run.run_id);
	if (!dirs.ok) return dirs;
	const now = deps.clock();
	const payload: BrowserUseSharedRunPayload = {
		...initial,
		created_at_epoch_ms: now,
		updated_at_epoch_ms: now,
	};
	const admitted = admitRedactionClean(payload);
	if (!admitted.ok) return admitted;
	const written = await casReplaceRecord(deps.fs, {
		path,
		lockPath: runLockPath(deps.paths, run.run_id),
		holderId: `create-${run.run_id}`,
		staleAfterMs: LOCKFILE_STALE_AFTER_MS,
		clock: deps.clock,
		expectedRevision: null,
		revisionOf: revisionOfRaw,
		nextContents: encodeDurableRecord("shared-run", payload),
	});
	if (!written.ok) {
		return runFailure(written.failure.code, written.failure.message);
	}
	return { ok: true, run: initial };
}

// --- CAS update (R13, R27) ----------------------------------------------------

/**
 * Every durable run mutation (R13 pipeline, R27 write gate): exclusive
 * activation barrier -> per-run lock -> load -> revision CAS ->
 * lease validation -> pure `mutate` -> auth-fragment boundary ->
 * `validateSharedRun` -> durable write at `revision + 1`. The generic seam
 * cannot create, replace, or remove `auth_fragment`/`auth_attestation`, or
 * transition into `ready`; the auth integration Port owns those changes.
 * A rejected update writes nothing.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param input - Run id, expected revision, required lease claim, pure mutate
 * @returns The written run, or one typed refusal
 */
export async function casUpdateSharedRun(
	deps: RunStoreDeps,
	input: {
		runId: string;
		expectedRevision: number;
		lease: LeaseWriteClaim;
		mutate: (run: BrowserUseSharedRun) => BrowserUseSharedRun;
	},
): Promise<{ ok: true; run: BrowserUseSharedRun } | RunFailure> {
	const path = deps.paths.state.runFile(input.runId);
	const dirs = await ensureRunDirs(deps, input.runId);
	if (!dirs.ok) return dirs;
	const updateUnderRunLock = async () =>
		await withExclusiveFileLock<{ ok: true; run: BrowserUseSharedRun } | RunFailure>(
			deps.fs,
			{
				lockPath: runLockPath(deps.paths, input.runId),
				holderId: `update-${input.runId}`,
				staleAfterMs: LOCKFILE_STALE_AFTER_MS,
				clock: deps.clock,
			},
			async () => {
				const loaded = await loadSharedRun(deps, input.runId);
				if (!loaded.ok) {
					return { ok: false, code: loaded.code, message: loaded.message };
				}
				if (loaded.run.revision !== input.expectedRevision) {
					return runFailure(
						"run_revision_stale",
						`expected revision ${input.expectedRevision} but the run is at ${loaded.run.revision}.`,
					);
				}
				const gate = await validateStoredLeaseForWrite(deps, {
					key: leaseKeyForRun(loaded.run),
					presented: input.lease,
				});
				if (!gate.ok) {
					return { ok: false, code: gate.code, message: gate.message };
				}
				const mutated = input.mutate(loaded.run);
				if (
					JSON.stringify(mutated.auth_fragment) !==
					JSON.stringify(loaded.run.auth_fragment)
				) {
					return runFailure(
						"run_auth_fragment_forbidden",
						"generic run mutation cannot create, replace, or remove auth_fragment; use the auth integration port.",
					);
				}
				if (
					JSON.stringify(mutated.auth_attestation) !==
						JSON.stringify(loaded.run.auth_attestation) ||
					(loaded.run.state !== "ready" && mutated.state === "ready")
				) {
					return runFailure(
						"run_auth_state_forbidden",
						"generic run mutation cannot change auth attestation or transition into ready state; use the auth integration port.",
					);
				}
				if (mutated.run_id !== loaded.run.run_id) {
					return runFailure(
						"run_id_immutable",
						"mutate changed run_id; run identity is immutable.",
					);
				}
				const next: BrowserUseSharedRun = {
					...mutated,
					revision: loaded.run.revision + 1,
				};
				const issues = validateSharedRun(next);
				const firstIssue = issues[0];
				if (firstIssue !== undefined) {
					return runFailure(
						firstIssue.code,
						issues.map((issue) => issue.message).join(" "),
					);
				}
				const payload: BrowserUseSharedRunPayload = {
					...next,
					created_at_epoch_ms: loaded.payload.created_at_epoch_ms,
					updated_at_epoch_ms: deps.clock(),
				};
				const admitted = admitRedactionClean(payload);
				if (!admitted.ok) return admitted;
				const written = await writeDurableFile(deps.fs, {
					path,
					contents: encodeDurableRecord("shared-run", payload),
				});
				if (!written.ok) {
					return runFailure(written.failure.code, written.failure.message);
				}
				return { ok: true, run: next };
			},
		);
	const outcome = await withActivationEpochBarrier(
		deps,
		{ holderId: `run-update-${input.runId}` },
		updateUnderRunLock,
	);
	if (isLockFailure(outcome)) {
		return runFailure(outcome.failure.code, outcome.failure.message);
	}
	if (!outcome.ok && outcome.code === "epoch_store_failed") {
		return runFailure(outcome.code, outcome.message);
	}
	return outcome;
}

// --- Auth attestation custody (R30, auth plan U3a) ------------------------------
//
// The platform is CUSTODIAN of durable attestation records, never their
// verifier: the caller supplies the content digest (auth-owned
// `authAttestationDigestOf`), the store files the record under it, and
// `createBrowserUseAuthContract` re-proves digest, binding, and freshness on
// every consult. A record filed under a lying digest is found by that digest
// and refused by the auth-owned verifier, so custody needs no digest math.

/** Typed attestation-record read outcome. */
export type AuthAttestationRecordRead =
	| { status: "present"; record: BrowserUseAuthAttestationPayload }
	| { status: "missing" }
	| { status: "corrupt"; message: string };

async function ensureAttestationDirs(
	deps: RunStoreDeps,
): Promise<{ ok: true } | RunFailure> {
	try {
		await deps.fs.mkdir(deps.paths.state.attestationsDir, {
			recursive: true,
			mode: PRIVATE_DIR_MODE,
		});
	} catch (error) {
		return runFailure(
			"attestation_store_failed",
			`attestation directory could not be created (${errorCode(error)}).`,
		);
	}
	return { ok: true };
}

/**
 * Durably persist one bounded auth attestation record under its own content
 * digest (R30; auth plan U3a "the write lands before commit returns ready").
 * Content-addressed custody: rewriting the same digest is idempotent by
 * construction. The same redaction backstop that gates run records gates
 * attestation records; a violation refuses the write and NOTHING is
 * persisted.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param input - Auth-computed full 64-hex content digest plus the record
 * @returns Ok, or one typed store refusal
 */
export async function writeAuthAttestationRecord(
	deps: RunStoreDeps,
	input: { digest: string; record: BrowserUseAuthAttestationPayload },
): Promise<{ ok: true } | RunFailure> {
	const dirs = await ensureAttestationDirs(deps);
	if (!dirs.ok) return dirs;
	const violations = findRedactionViolations(input.record);
	const first = violations[0];
	if (first !== undefined) {
		return runFailure(
			"attestation_record_invalid",
			`attestation record carries a redaction violation (${first.reason}) at ${first.path}; refusing to persist.`,
		);
	}
	const written = await writeDurableFile(deps.fs, {
		path: deps.paths.state.attestationFile(input.digest),
		contents: encodeDurableRecord("auth-attestation", input.record),
	});
	if (!written.ok) {
		return runFailure(written.failure.code, written.failure.message);
	}
	return { ok: true };
}

/**
 * Read one durable attestation record by its content digest.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param digest - Full 64-hex content digest (the file name)
 * @returns Present with the parsed record, missing, or corrupt
 */
export async function readAuthAttestationRecord(
	deps: RunStoreDeps,
	digest: string,
): Promise<AuthAttestationRecordRead> {
	const read = await readDurableFile(
		deps.fs,
		deps.paths.state.attestationFile(digest),
	);
	if (read.status === "missing") return { status: "missing" };
	if (read.status === "unreadable") {
		return { status: "corrupt", message: read.message };
	}
	const parsed = parseDurableRecord(read.raw, "auth-attestation");
	if (!parsed.ok) {
		return {
			status: "corrupt",
			message: redactUnsafeText(`attestation record is corrupt (${parsed.code}).`),
		};
	}
	return { status: "present", record: parsed.payload };
}

/**
 * The production `attestationByDigest` source for
 * `createBrowserUseAuthContract` (auth plan U3a): a store-backed async lookup
 * over the durable attestation records. Missing, corrupt, and digest-shape-
 * invalid lookups all resolve `undefined` — the auth-owned verifier turns
 * absence into refusal; custody never throws on a bad digest.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @returns Async digest lookup for `BrowserUseAuthContractDeps`
 */
export function attestationByDigestFrom(
	deps: RunStoreDeps,
): (digest: string) => Promise<BrowserUseAuthAttestationPayload | undefined> {
	return async (digest) => {
		let read: AuthAttestationRecordRead;
		try {
			read = await readAuthAttestationRecord(deps, digest);
		} catch {
			// attestationFile refuses non-64-hex names with a TypeError; an
			// unknown digest shape is an absent record, not a crash.
			return undefined;
		}
		return read.status === "present" ? read.record : undefined;
	};
}

// --- Auth integration Port (R6, AE7 substrate) ---------------------------------

/**
 * Typed infrastructure failure raised by `commitAuthOutcome` (auth plan U3a,
 * the #259 coded-error debt): the provider classifies on `kind`, never on
 * message wording. `lease-rejected` names the fenced write gate refusing the
 * presented claim; every other infrastructure fault is `store-faulted`.
 * `detail_code` carries the machine cause (gate code, store failure code, or
 * errno-class code) already embedded in the redacted message.
 */
export class BrowserUseAuthCommitInfrastructureError extends Error {
	readonly kind: "lease-rejected" | "store-faulted";
	readonly detail_code: string;

	constructor(input: {
		kind: "lease-rejected" | "store-faulted";
		detail_code: string;
		message: string;
	}) {
		super(redactUnsafeText(input.message));
		this.name = "BrowserUseAuthCommitInfrastructureError";
		this.kind = input.kind;
		this.detail_code = input.detail_code;
	}
}

function storeFaulted(
	detailCode: string,
	message: string,
): BrowserUseAuthCommitInfrastructureError {
	return new BrowserUseAuthCommitInfrastructureError({
		kind: "store-faulted",
		detail_code: detailCode,
		message,
	});
}

/**
 * The U1 integration Port made durable (spec §E). Under the activation barrier
 * and per-run lock it validates the presented lease, then applies the auth
 * reducer, re-proves a ready summary's bounded attestation through the
 * auth-owned verifier (U3a: no durable attestation record, no ready run), and
 * durably writes the next run. Every reducer rejection is returned verbatim
 * and writes nothing. The Port's result vocabulary is auth-domain-only, so
 * infrastructure faults throw {@link BrowserUseAuthCommitInfrastructureError}
 * with a redacted message and a machine `kind`/`detail_code`.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param authContract - Auth-owned fragment admission plus attestation verification
 * @param lease - Presented fenced write claim
 * @returns The Port the auth plan calls
 */
export function createRunIntegrationPort(
	deps: RunStoreDeps,
	authContract: Pick<
		BrowserUseAuthContractPort,
		"validateSecretFreeFragment" | "verifyAttestation"
	>,
	lease: LeaseWriteClaim,
): BrowserUseRunIntegrationPort {
	return {
		async commitAuthOutcome(input): Promise<BrowserUseAuthCommitResult> {
			const path = deps.paths.state.runFile(input.run_id);
			const dirs = await ensureRunDirs(deps, input.run_id);
			if (!dirs.ok) throw storeFaulted(dirs.code, dirs.message);
			const commitUnderRunLock = async () =>
				await withExclusiveFileLock<BrowserUseAuthCommitResult>(
					deps.fs,
					{
						lockPath: runLockPath(deps.paths, input.run_id),
						holderId: `auth-commit-${input.run_id}`,
						staleAfterMs: LOCKFILE_STALE_AFTER_MS,
						clock: deps.clock,
					},
					async () => {
						const loaded = await loadSharedRun(deps, input.run_id);
						if (!loaded.ok) {
							throw storeFaulted(
								loaded.code,
								`auth commit could not load the run (${loaded.code}).`,
							);
						}
						const gate = await validateStoredLeaseForWrite(deps, {
							key: leaseKeyForRun(loaded.run),
							presented: lease,
						});
						if (!gate.ok) {
							throw new BrowserUseAuthCommitInfrastructureError({
								kind:
									gate.code === "lease_store_failed"
										? "store-faulted"
										: "lease-rejected",
								detail_code: gate.code,
								message: `auth commit lease rejected (${gate.code}).`,
							});
						}
						const result = applyAuthCommit(
							loaded.run,
							{
								expected_revision: input.expected_revision,
								fragment: input.fragment,
								summary: input.summary,
							},
							authContract,
						);
						if (!result.ok) return result;
						// U3a ready gate: the durable attestation record must exist
						// and re-prove digest, binding, and freshness BEFORE the run
						// record can turn ready. Absence, drift, or a run without a
						// bound lane/handoff identity refuses the commit; nothing is
						// written.
						if (result.run.state === "ready") {
							const reference = result.run.auth_attestation;
							const verified =
								reference !== undefined &&
								result.run.adapter_id !== undefined &&
								result.run.handoff_evidence_id !== undefined &&
								(await authContract.verifyAttestation({
									reference,
									run_id: result.run.run_id,
									environment_profile: result.run.environment_profile,
									adapter_id: result.run.adapter_id,
									handoff_evidence_id: result.run.handoff_evidence_id,
									at_epoch_ms: deps.clock(),
								}));
							if (!verified) {
								return {
									ok: false,
									rejection: {
										code: "run_ready_attestation_unverified",
										message:
											"the auth-owned verifier could not re-prove the bounded attestation against a durable record; the run was not persisted.",
									},
								};
							}
						}
						const payload: BrowserUseSharedRunPayload = {
							...result.run,
							created_at_epoch_ms: loaded.payload.created_at_epoch_ms,
							updated_at_epoch_ms: deps.clock(),
						};
						const admitted = admitRedactionClean(payload);
						if (!admitted.ok) throw storeFaulted(admitted.code, admitted.message);
						const written = await writeDurableFile(deps.fs, {
							path,
							contents: encodeDurableRecord("shared-run", payload),
						});
						if (!written.ok) {
							throw storeFaulted(
								written.failure.code,
								`auth commit could not persist the run (${written.failure.code}).`,
							);
						}
						return result;
					},
				);
			const outcome = await withActivationEpochBarrier(
				deps,
				{ holderId: `auth-epoch-${input.run_id}` },
				commitUnderRunLock,
			);
			if (isLockFailure(outcome)) {
				throw storeFaulted(
					outcome.failure.code,
					`auth commit lock unavailable (${outcome.failure.code}).`,
				);
			}
			if (!outcome.ok && "code" in outcome) {
				throw storeFaulted(
					outcome.code,
					`auth commit epoch barrier unavailable (${outcome.code}).`,
				);
			}
			return outcome;
		},
	};
}

// --- Restart/resume projection (AE7/AE15 substrate) ----------------------------

/** Observed lane/profile identity for the U1 same-lane resume gate. */
export type RunResumeObservedIdentity = Parameters<typeof checkSameLaneResume>[1];

/**
 * Typed resume projection over durable state. The CLI entry maps kinds onto
 * diagnostics and exit codes; the library states the truth:
 *
 * - `blocked` — the run plus its exactly-one continuation (state unchanged;
 *   the continuation IS the resume answer in U2).
 * - `execution-unavailable` — ready/running passed the resume gates;
 *   persistence/resume is proven and live lane execution lands in U4.
 * - `lane-mismatch` — the U1 `checkSameLaneResume` refusal, surfaced verbatim.
 * - `terminal` — terminal truth never re-enters execution.
 * - `load-failed` — the typed load refusal, surfaced verbatim.
 */
export type SharedRunResumeProjection =
	| {
			kind: "blocked";
			run: BrowserUseSharedRun;
			continuation: BrowserUseRunContinuation;
	  }
	| { kind: "execution-unavailable"; run: BrowserUseSharedRun }
	| {
			kind: "lane-mismatch";
			run: BrowserUseSharedRun;
			refusal: Extract<BrowserUseResumeCheck, { ok: false }>;
	  }
	| { kind: "terminal"; run: BrowserUseSharedRun }
	| { kind: "load-failed"; failure: Extract<RunLoad, { ok: false }> };

/**
 * Resume one shared run over durable state (AE7/AE15 substrate; S15). A pure
 * projection — it NEVER writes: a blocked run re-emits its state plus its
 * exactly-one continuation; a ready/running run applies the U1
 * `checkSameLaneResume` gate against the observed identity when one is
 * supplied, then reports execution unavailable (live lanes land in U4); a
 * terminal run projects terminal truth.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param input - Run id plus the optionally observed lane/profile identity
 * @returns One typed resume projection
 */
export async function resumeSharedRun(
	deps: RunStoreDeps,
	input: { runId: string; observed?: RunResumeObservedIdentity },
): Promise<SharedRunResumeProjection> {
	const loaded = await loadSharedRun(deps, input.runId);
	if (!loaded.ok) return { kind: "load-failed", failure: loaded };
	const { run } = loaded;
	if (isTerminalState(run.state)) {
		return { kind: "terminal", run };
	}
	if (isBlockedState(run.state)) {
		if (run.continuation === undefined) {
			// Unreachable after load validation (blocked-without-continuation is
			// run_record_invalid); fail closed rather than invent a continuation.
			return {
				kind: "load-failed",
				failure: {
					ok: false,
					code: "run_record_invalid",
					message: `state ${run.state} requires exactly one next safe action.`,
				},
			};
		}
		return { kind: "blocked", run, continuation: run.continuation };
	}
	if (input.observed !== undefined) {
		const check = checkSameLaneResume(run, input.observed);
		if (!check.ok) return { kind: "lane-mismatch", run, refusal: check };
	}
	return { kind: "execution-unavailable", run };
}

// --- Receipt listing (R35, AE15 substrate) -------------------------------------

/**
 * Redacted receipt for every durable run, sorted by run id (`run status`
 * without `--run` projects these — the AE15 "fresh agent discovers all safe
 * next actions" surface; a blocked run's receipt names its one continuation).
 * A missing runs dir is an empty projection; unparseable record files are
 * skipped — corruption repair has its own surfaces, and a receipt row cannot
 * carry it.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @returns Sorted redacted receipt payloads
 */
export async function listSharedRunReceipts(
	deps: RunStoreDeps,
): Promise<readonly BrowserUseRunReceiptPayload[]> {
	const dirStat = await deps.fs.lstat(deps.paths.state.runsDir);
	if (dirStat === undefined || dirStat.kind !== "directory") return [];
	const receipts: BrowserUseRunReceiptPayload[] = [];
	for (const entry of await deps.fs.readDirectory(deps.paths.state.runsDir)) {
		let runPath: string;
		try {
			runPath = deps.paths.state.runFile(entry);
		} catch {
			continue;
		}
		const read = await readDurableFile(deps.fs, runPath);
		if (read.status !== "present") continue;
		const parsed = parseDurableRecord(read.raw, "shared-run");
		if (!parsed.ok) continue;
		receipts.push(receiptForRun(runOfPayload(parsed.payload)));
	}
	return receipts.sort((a, b) =>
		a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0,
	);
}
