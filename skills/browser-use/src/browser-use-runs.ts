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
 * U1 `validateSharedRun` guard — a fresh run is a blocked state with exactly
 * one continuation, or ready-with-attestation; which lane/state to start in
 * is U4/U6 routing policy, NOT decided here. Written via the store CAS with
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
 * per-run lock -> load -> revision CAS -> `validateStoredLeaseForWrite` when
 * a lease claim is presented (mutating transitions REQUIRE one; the caller
 * owns that policy — `commitAuthOutcome` writes under the run's already-held
 * lease without re-presenting it) -> pure `mutate` -> U1 `validateSharedRun`
 * -> durable write at `revision + 1`. `mutate` never manages identity or the
 * CAS token: a changed `run_id` is a typed refusal and `revision` is forced
 * to `expectedRevision + 1` by this module. A rejected update writes NOTHING.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param input - Run id, expected revision, optional lease claim, pure mutate
 * @returns The written run, or one typed refusal
 */
export async function casUpdateSharedRun(
	deps: RunStoreDeps,
	input: {
		runId: string;
		expectedRevision: number;
		lease?: LeaseWriteClaim;
		mutate: (run: BrowserUseSharedRun) => BrowserUseSharedRun;
	},
): Promise<{ ok: true; run: BrowserUseSharedRun } | RunFailure> {
	const path = deps.paths.state.runFile(input.runId);
	const dirs = await ensureRunDirs(deps, input.runId);
	if (!dirs.ok) return dirs;
	const outcome = await withExclusiveFileLock<
		{ ok: true; run: BrowserUseSharedRun } | RunFailure
	>(
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
			if (input.lease !== undefined) {
				const gate = await validateStoredLeaseForWrite(deps, {
					key: leaseKeyForRun(loaded.run),
					presented: input.lease,
				});
				if (!gate.ok) {
					return { ok: false, code: gate.code, message: gate.message };
				}
			}
			const mutated = input.mutate(loaded.run);
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
	if (isLockFailure(outcome)) {
		return runFailure(outcome.failure.code, outcome.failure.message);
	}
	return outcome;
}

// --- Auth integration Port (R6, AE7 substrate) ---------------------------------

/**
 * The U1 integration Port made durable (spec §E). `commitAuthOutcome` =
 * exclusive per-run lock -> load -> `applyAuthCommit` (the U1 pure reducer —
 * it alone enforces revision CAS, terminal-state rejection, the
 * ready/blocked invariants, and the `validateSecretFreeFragment` gate) ->
 * durable write of the reducer's next run. Every reducer rejection is
 * returned VERBATIM and nothing touches disk — a rejected fragment is never
 * persisted. The write does NOT present a platform lease claim: the auth
 * transaction operates under the run's already-held lease (S12), and the
 * per-run lock plus the reducer's revision CAS serialize the write itself.
 * The Port's result vocabulary is auth-domain-only, so infrastructure faults
 * (unloadable run, failed flush, contended lock) THROW with a redacted
 * message instead of miscoding as an auth rejection.
 *
 * @param deps - Injected fs, admitted paths, clock
 * @param authContract - Auth-owned runtime fragment admission
 * @returns The Port the auth plan calls
 */
export function createRunIntegrationPort(
	deps: RunStoreDeps,
	authContract: Pick<BrowserUseAuthContractPort, "validateSecretFreeFragment">,
): BrowserUseRunIntegrationPort {
	return {
		async commitAuthOutcome(input): Promise<BrowserUseAuthCommitResult> {
			const path = deps.paths.state.runFile(input.run_id);
			const dirs = await ensureRunDirs(deps, input.run_id);
			if (!dirs.ok) throw new Error(dirs.message);
			const outcome = await withExclusiveFileLock<BrowserUseAuthCommitResult>(
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
						throw new Error(
							redactUnsafeText(
								`auth commit could not load the run (${loaded.code}).`,
							),
						);
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
					const payload: BrowserUseSharedRunPayload = {
						...result.run,
						created_at_epoch_ms: loaded.payload.created_at_epoch_ms,
						updated_at_epoch_ms: deps.clock(),
					};
					// Redaction backstop is an infrastructure safety refusal, not an
					// auth-domain rejection, so it THROWS (nothing persists) rather
					// than miscoding as an auth outcome. The walker skips the opaque
					// auth_fragment.fragment subtree (auth-commit gates it at admit).
					const admitted = admitRedactionClean(payload);
					if (!admitted.ok) throw new Error(admitted.message);
					const written = await writeDurableFile(deps.fs, {
						path,
						contents: encodeDurableRecord("shared-run", payload),
					});
					if (!written.ok) {
						throw new Error(
							redactUnsafeText(
								`auth commit could not persist the run (${written.failure.code}).`,
							),
						);
					}
					return result;
				},
			);
			if (isLockFailure(outcome)) {
				throw new Error(
					redactUnsafeText(
						`auth commit lock unavailable (${outcome.failure.code}).`,
					),
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
		const read = await readDurableFile(deps.fs, deps.paths.state.runFile(entry));
		if (read.status !== "present") continue;
		const parsed = parseDurableRecord(read.raw, "shared-run");
		if (!parsed.ok) continue;
		receipts.push(receiptForRun(runOfPayload(parsed.payload)));
	}
	return receipts.sort((a, b) =>
		a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0,
	);
}
