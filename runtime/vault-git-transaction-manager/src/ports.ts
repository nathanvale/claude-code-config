import type {
	VaultGitCheckerAdmissionRecord,
	VaultGitLifecycleResultPayload,
	VaultGitOwnedPathReceipt,
	VaultGitStateSnapshot,
	VaultGitUnrelatedStateSnapshot,
} from "./model.ts";

/** Exact current checker implementation fingerprint. */
export interface VaultGitCheckerFingerprint {
	/** SHA-256 of the declared checker entrypoint. */
	readonly entrypointHash: string;
	/** SHA-256 of the checker dependency bundle. */
	readonly dependencyBundleHash: string;
}

/** Bounded shell-free checker subprocess result. */
export interface VaultGitCheckerProcessResult {
	/** Process exit status, or null when unavailable. */
	readonly exitCode: number | null;
	/** Structured JSON candidate from stdout. */
	readonly stdout: string;
	/** Diagnostic text ignored by Janitor policy. */
	readonly stderr: string;
	/** Whether the hard checker deadline fired. */
	readonly timedOut: boolean;
}

/** Exact checker-owned repair request derived from structured registry data. */
export interface VaultGitCheckerRepairRequest {
	/** Registered stable repair id. */
	readonly repairId: string;
	/** Repository-relative file selected by the finding. */
	readonly file: string;
	/** Stable field selector supplied by checker detail. */
	readonly field: string;
}

/** External checker boundary; Janitor alone parses its structured stdout. */
export interface VaultGitCheckerPort {
	/** Fingerprint the current checker entrypoint and dependency bundle. */
	fingerprint(): Promise<VaultGitCheckerFingerprint>;
	/** Run the declared vault check in structured mode. */
	runCheck(): Promise<VaultGitCheckerProcessResult>;
	/** Read the checker-owned deterministic repair registry. */
	readRepairRegistry(): Promise<VaultGitCheckerProcessResult>;
	/** Apply one exact registry-owned repair without Git operations. */
	applyRepair(
		request: VaultGitCheckerRepairRequest,
	): Promise<VaultGitCheckerProcessResult>;
}

/** Private checker-admission custody boundary. */
export interface VaultGitCheckerAdmissionPort {
	/** Persist an operator-approved checker fingerprint. */
	admitChecker(record: VaultGitCheckerAdmissionRecord): Promise<void>;
	/** Read the current admitted checker fingerprint. */
	readCheckerAdmission(): Promise<VaultGitCheckerAdmissionRecord | null>;
}

/** Read-side request accepted by a future transaction engine. */
export interface VaultGitReadRequest {
	/** Public read command. */
	readonly command: "status" | "preview" | "doctor";
	/** Optional non-secret transaction correlation id. */
	readonly transactionId?: string;
}

/** Mutation request accepted only after future admission policy succeeds. */
export interface VaultGitMutationRequest {
	/** Public mutating command. */
	readonly command:
		| "begin"
		| "join"
		| "complete"
		| "repair"
		| "tidy"
		| "janitor";
	/** Optional inherited capability descriptor number, never capability bytes. */
	readonly capabilityFd?: number;
}

/** Read-only state boundary implemented by the future engine. */
export interface VaultGitStatePort {
	/** Read current manager-owned state without mutation. */
	read(request: VaultGitReadRequest): Promise<VaultGitStateSnapshot>;
}

/** Admitted mutation boundary implemented by the future engine. */
export interface VaultGitMutationPort {
	/** Execute one admitted mutation or return a deterministic refusal. */
	mutate(
		request: VaultGitMutationRequest,
	): Promise<VaultGitLifecycleResultPayload>;
}

/** Capability-byte reader isolated behind an inherited descriptor boundary. */
export interface VaultGitCapabilityPort {
	/** Read capability bytes from a numeric inherited descriptor. */
	readCapability(descriptor: number): Promise<Uint8Array>;
}

/** One bounded subprocess invocation used by the Git adapter. */
export interface VaultGitProcessRequest {
	/** Executable name or absolute path. */
	readonly command: string;
	/** Arguments passed without a shell. */
	readonly args: readonly string[];
	/** Working directory containing the disposable or configured repository. */
	readonly cwd: string;
	/** Optional standard input bytes. */
	readonly stdin?: string;
	/** Environment additions; ambient values remain process-adapter owned. */
	readonly env?: Readonly<Record<string, string>>;
	/** Hard operation deadline. */
	readonly timeoutMs: number;
}

/** Captured subprocess outcome with timeout state made explicit. */
export interface VaultGitProcessResult {
	/** Process exit status, or null when no status was available. */
	readonly exitCode: number | null;
	/** Captured standard output. */
	readonly stdout: string;
	/** Captured standard error. */
	readonly stderr: string;
	/** Whether the adapter terminated the process at its deadline. */
	readonly timedOut: boolean;
}

/** Injectable process boundary that keeps Git execution out of engine logic. */
export interface VaultGitProcessPort {
	/** Run one bounded process without a shell. */
	run(request: VaultGitProcessRequest): Promise<VaultGitProcessResult>;
}

/** Main-branch relationship after fetching the exact upstream ref. */
export type VaultGitMainAlignment =
	| "aligned"
	| "behind"
	| "ahead"
	| "diverged"
	| "local_missing";

/** Successful exact-main inspection. */
export interface VaultGitMainInspectionSuccess {
	/** Successful transport and comparison marker. */
	readonly status: "ok";
	/** Local-to-fetched-upstream relationship. */
	readonly alignment: VaultGitMainAlignment;
	/** Local full main-ref object id when present. */
	readonly localHead: string | null;
	/** Fetched upstream main object id. */
	readonly remoteHead: string;
}

/** Failed exact-main inspection. */
export interface VaultGitMainInspectionFailure {
	/** Transport or timeout failure marker. */
	readonly status: "failed";
	/** Stable failure category safe for engine mapping. */
	readonly reason: "remote_unavailable" | "timed_out" | "remote_main_missing";
}

/** Complete exact-main inspection result. */
export type VaultGitMainInspection =
	| VaultGitMainInspectionSuccess
	| VaultGitMainInspectionFailure;

/** Raw fetched ledger commit for engine-owned schema validation. */
export interface VaultGitLedgerHead {
	/** Commit object id used as the fencing generation. */
	readonly generation: string;
	/** Direct commit parents in declared order. */
	readonly parents: readonly string[];
	/** Ledger file content, or null when the commit lacks the file. */
	readonly content: string | null;
}

/** Result of fetching the exact ledger branch. */
export type VaultGitLedgerReadResult =
	| { readonly status: "ok"; readonly head: VaultGitLedgerHead | null }
	| {
			readonly status: "failed";
			readonly reason: "remote_unavailable" | "timed_out";
	  };

/** Input for one compare-and-swap ledger append. */
export interface VaultGitLedgerAppendRequest {
	/** Named remote used by the current repository. */
	readonly remote: string;
	/** Exact full destination branch ref. */
	readonly ledgerRef: string;
	/** Freshly observed parent generation, or null for bootstrap. */
	readonly expectedGeneration: string | null;
	/** Complete next ledger JSON document. */
	readonly content: string;
	/** Git commit subject. */
	readonly message: string;
	/** Non-secret actor label used for commit attribution. */
	readonly author: string;
	/** ISO timestamp supplied by the engine clock. */
	readonly timestamp: string;
}

/** Durable object ids prepared before the sole atomic close push. */
export interface VaultGitAtomicCloseEvidence {
	/** Exact local main commit intended for publication. */
	readonly mainCommit: string;
	/** Exact release-ledger commit intended for publication. */
	readonly ledgerCommit: string;
}

/** Input for the only operation allowed to mutate remote main. */
export interface VaultGitAtomicCloseRequest {
	/** Named remote admitted by the transaction. */
	readonly remote: string;
	/** Exact old remote main object id. */
	readonly expectedMainHead: string;
	/** Verified local main commit to publish. */
	readonly mainCommit: string;
	/** Exact full ledger destination ref. */
	readonly ledgerRef: string;
	/** Exact held-ledger generation. */
	readonly expectedLedgerGeneration: string;
	/** Complete release-ledger JSON document. */
	readonly ledgerContent: string;
	/** Non-sensitive release commit subject. */
	readonly ledgerMessage: string;
	/** Non-secret admitted actor identity. */
	readonly author: string;
	/** Injected ISO commit timestamp. */
	readonly timestamp: string;
	/** Persist both expected object ids before any remote push begins. */
	readonly onPrepared: (evidence: VaultGitAtomicCloseEvidence) => void | Promise<void>;
}

/** Result after push and exact-ref reconciliation. */
export type VaultGitAtomicCloseResult =
	| {
			readonly status: "closed";
			readonly mainCommit: string;
			readonly ledgerCommit: string;
	  }
	| {
			readonly status: "push_pending";
			readonly reason: "remote_unavailable" | "remote_state_unknown" | "timed_out";
			readonly mainCommit: string;
			readonly ledgerCommit: string;
	  }
	| {
			readonly status: "host_contract_breach";
			readonly mainCommit: string;
			readonly ledgerCommit: string;
	  };

/** Read-only proof input for one previously prepared atomic close. */
export interface VaultGitAtomicCloseReconcileRequest {
	/** Named remote recorded by the receipt. */
	readonly remote: string;
	/** Exact transaction payload required in both expected commits. */
	readonly transactionId: string;
	/** Exact admitted remote main generation. */
	readonly expectedMainHead: string;
	/** Exact local event commit expected in remote main history. */
	readonly mainCommit: string;
	/** Exact ledger ref used by the transaction manager. */
	readonly ledgerRef: string;
	/** Exact held lease generation. */
	readonly expectedLedgerGeneration: string;
	/** Exact prepared release commit expected in ledger history. */
	readonly ledgerCommit: string;
}

/** Read-only remote outcome proof; uncertainty never collapses to unchanged. */
export type VaultGitAtomicCloseReconciliation =
	| { readonly status: "closed" }
	| { readonly status: "unchanged" }
	| { readonly status: "host_contract_breach" }
	| {
			readonly status: "unknown";
			readonly reason: "remote_unavailable" | "timed_out" | "local_probe_failed";
	  };

/** Compare-and-swap append outcome. */
export type VaultGitLedgerAppendResult =
	| { readonly status: "appended"; readonly generation: string }
	| {
			readonly status: "refused";
			readonly reason:
				| "remote_moved"
				| "remote_unavailable"
				| "remote_state_unknown"
				| "timed_out";
	  };

/**
 * Single Git boundary used by remote-ledger engine logic.
 *
 * Callers must serialize operations per repository clone: fetches avoid
 * shared FETCH_HEAD by using private per-call refs, but local branch refs
 * and the object database remain repository-wide shared state.
 */
export interface VaultGitRemotePort {
	/** Fetch and compare exact local and upstream main refs. */
	inspectMain(remote: string): Promise<VaultGitMainInspection>;
	/** Fetch the exact ledger branch without updating a local branch. */
	readLedger(
		remote: string,
		ledgerRef: string,
	): Promise<VaultGitLedgerReadResult>;
	/** Append one verified commit through an explicit non-force refspec. */
	appendLedgerCommit(
		request: VaultGitLedgerAppendRequest,
	): Promise<VaultGitLedgerAppendResult>;
	/** Atomically advance exact main and release-ledger refs, then reconcile. */
	readonly atomicClose?: (
		request: VaultGitAtomicCloseRequest,
	) => Promise<VaultGitAtomicCloseResult>;
	/** Reconcile prepared object ids without creating or pushing objects. */
	readonly reconcileAtomicClose?: (
		request: VaultGitAtomicCloseReconcileRequest,
	) => Promise<VaultGitAtomicCloseReconciliation>;
}

/** Explicit clock boundary used for lease-age diagnostics and commit dates. */
export interface VaultGitClockPort {
	/** Read current wall-clock time. */
	now(): Date;
}

/** Canonical configured-vault identity resolved at one write-capable phase. */
export interface VaultGitRepositoryIdentity {
	/** Stable non-secret identity; callers compare it with configured identity. */
	readonly identity: string;
	/** Exact local main object id observed during resolution. */
	readonly localMainHead: string;
}

/** Owned-path admission refusal category. */
export type VaultGitOwnedPathRefusalReason =
	| "dirty_worktree"
	| "staged"
	| "ignored"
	| "symlink"
	| "preexisting_untracked"
	| "directory_expansion_failed"
	| "invalid_path";

/** Frozen owned-path inspection result. */
export type VaultGitOwnedPathInspection =
	| {
			readonly status: "admitted";
			readonly paths: readonly VaultGitOwnedPathReceipt[];
			readonly unrelatedState: VaultGitUnrelatedStateSnapshot;
	  }
	| {
			readonly status: "refused";
			readonly reason: VaultGitOwnedPathRefusalReason;
	  };

/** One owned path bound to the exact worktree content hash observed pre-check. */
export interface VaultGitOwnedPathContentHash {
	/** Repository-relative owned leaf path. */
	readonly path: string;
	/** Blob object id of current worktree content, or null when absent. */
	readonly contentHash: string | null;
}

/** Input for one exact local event commit. */
export interface VaultGitExactCommitRequest {
	/** Exact local main object admitted at begin. */
	readonly baselineHead: string;
	/** Frozen admitted leaf set with begin-time hashes. */
	readonly ownedPaths: readonly VaultGitOwnedPathReceipt[];
	/** Exact unrelated state recorded at admission or the latest join. */
	readonly unrelatedState: VaultGitUnrelatedStateSnapshot;
	/**
	 * Content hashes captured immediately before the vault-owned check ran.
	 * When present, the frozen candidate blobs must equal these hashes so the
	 * committed bytes are exactly the checked bytes.
	 */
	readonly expectedContentHashes?: readonly VaultGitOwnedPathContentHash[];
	/** Complete manager-owned commit message. */
	readonly message: string;
	/** Non-secret admitted actor identity. */
	readonly author: string;
	/** Injected ISO commit timestamp. */
	readonly timestamp: string;
}

/** Exact local commit outcome before remote publication. */
export type VaultGitExactCommitResult =
	| {
			readonly status: "committed";
			readonly commitId: string;
			readonly treeId: string;
	  }
	| {
			/**
			 * Local main advanced to the new commit but the canonical owned index
			 * could not be synchronized; commit evidence must be preserved.
			 */
			readonly status: "committed_incomplete";
			readonly reason: "index_update_failed";
			readonly commitId: string;
			readonly treeId: string;
	  }
	| {
			readonly status: "refused";
			readonly reason:
				| "owned_path_baseline_changed"
				| "owned_path_symlink"
				| "unrelated_state_changed"
				| "checked_content_changed"
				| "empty_event"
				| "candidate_mismatch"
				| "local_main_moved"
				| "timed_out";
	  };

/** Read-only local commit evidence used after an interrupted commit phase. */
export type VaultGitLocalCommitInspection =
	| {
			readonly status: "ok";
			readonly commitId: string;
			readonly parents: readonly string[];
			readonly message: string;
	  }
	| { readonly status: "missing" }
	| { readonly status: "failed"; readonly reason: "timed_out" | "probe_failed" };

/** Repository filesystem facts consumed by transaction policy. */
export interface VaultGitRepositoryPort {
	/** Resolve and canonicalize configured repository identity. */
	resolveCanonicalIdentity(): Promise<VaultGitRepositoryIdentity>;
	/** Expand directories and inspect the frozen leaf set without mutation. */
	inspectOwnedPaths(
		requestedPaths: readonly string[],
	): Promise<VaultGitOwnedPathInspection>;
	/** Capture current unrelated state for a joined owned leaf set. */
	readonly captureUnrelatedState?: (
		ownedPaths: readonly string[],
	) => Promise<VaultGitUnrelatedStateSnapshot>;
	/** Hash current owned-path worktree content for check-to-commit binding. */
	readonly hashOwnedPaths?: (
		ownedPaths: readonly string[],
	) => Promise<readonly VaultGitOwnedPathContentHash[]>;
	/** Build, verify, and install one exact local event commit. */
	readonly commitExact?: (
		request: VaultGitExactCommitRequest,
	) => Promise<VaultGitExactCommitResult>;
	/** Inspect exact local commit ancestry and payload without changing refs. */
	readonly inspectLocalCommit?: (
		commitId: string,
	) => Promise<VaultGitLocalCommitInspection>;
}

/** Result from the injected vault-owned validation command. */
export type VaultGitCheckResult =
	| { readonly status: "passed" }
	| { readonly status: "failed"; readonly reason: "check_failed" | "timed_out" };

/** Injected vault-owned check boundary run from the resolved vault root. */
export interface VaultGitCheckPort {
	/** Run the admitted repository's own deterministic check command. */
	run(): Promise<VaultGitCheckResult>;
}

/** Deterministic process, identity, randomness, and interruption boundary. */
export interface VaultGitRuntimePort extends VaultGitClockPort {
	/** Non-secret actor label. */
	actor(): string;
	/** Non-secret host label. */
	host(): string;
	/** New opaque private-receipt correlation id. */
	newReceiptId(): string;
	/** Injected crash/interruption point; production is a no-op. */
	interrupt(point: string): void;
}
