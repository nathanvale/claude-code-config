import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	chmod,
	lstat,
	mkdtemp,
	open,
	readdir,
	realpath,
	rm,
	stat,
	unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
	VAULT_GIT_LEDGER_REF,
	isVaultGitOwnedPathLeaf,
	type VaultGitOwnedPathReceipt,
	type VaultGitStagedRecoveryEntry,
	type VaultGitStagedRecoveryPlan,
	type VaultGitUnrelatedStateSnapshot,
} from "./model.ts";
import {
	VaultRepositoryIdentityUnavailableError,
	type VaultGitLedgerAppendRequest,
	type VaultGitLedgerAppendResult,
	type VaultGitLedgerReadResult,
	type VaultGitAtomicCloseReconciliation,
	type VaultGitCheckPort,
	type VaultGitMainInspection,
	type VaultGitOwnedPathInspection,
	type VaultGitProcessPort,
	type VaultGitProcessRequest,
	type VaultGitProcessResult,
	type VaultGitRepositoryPort,
	type VaultGitRemotePort,
} from "./ports.ts";
import {
	assertVaultGitSafeRemoteTarget,
	normalizeVaultGitAllowedRemoteHosts,
	VaultGitRemoteSafetyError,
} from "./remote-safety.ts";

/** Distinguishes transient Git process timeouts from deterministic mismatches. */
class GitProcessTimedOutError extends Error {}

/** Compare persisted unrelated state by value, independent of JSON key order. */
function matchesUnrelatedState(
	left: VaultGitUnrelatedStateSnapshot,
	right: VaultGitUnrelatedStateSnapshot,
): boolean {
	return left.statusHex === right.statusHex && left.indexHex === right.indexHex;
}

/** Options for the injected real-process vault-owned check. */
export interface VaultGitCheckAdapterOptions {
	/** Canonical vault root used as the checker working directory. */
	readonly repositoryPath: string;
	/** Injectable bounded subprocess runner. */
	readonly process: VaultGitProcessPort;
	/** Hard checker deadline. */
	readonly timeoutMs: number;
	/** Bun executable override. @defaultValue "bun" */
	readonly bunBinary?: string;
}

/**
 * Create the real-process default for the injected vault-owned check port.
 *
 * @param options - Canonical root, process boundary, and hard deadline
 * @returns A shell-free `bun run check` invocation rooted at the vault
 * @throws Never; command and timeout failures are represented in the result
 *
 * @example
 * ```typescript
 * const check = createVaultOwnedCheckPort({
 *   repositoryPath: "/srv/vault",
 *   process: createNodeProcessPort(),
 *   timeoutMs: 60_000,
 * })
 * ```
 */
export function createVaultOwnedCheckPort(
	options: VaultGitCheckAdapterOptions,
): VaultGitCheckPort {
	return {
		async run() {
			const checked = await options.process.run({
				command: options.bunBinary ?? "bun",
				args: ["run", "check"],
				cwd: options.repositoryPath,
				env: { LC_ALL: "C" },
				timeoutMs: options.timeoutMs,
			});
			if (checked.timedOut) return { status: "failed", reason: "timed_out" };
			return checked.exitCode === 0
				? { status: "passed" }
				: { status: "failed", reason: "check_failed" };
		},
	};
}

/**
 * Fixed flags for the sole atomic close push.
 *
 * `--no-verify` is plan-mandated (KTD4): hooks are deliberately bypassed
 * because the vault owns validation through the injected check port and hook
 * execution is banned in the Super-vault. `--atomic` makes both ref updates
 * one all-or-nothing transaction; `--porcelain` keeps output machine-stable.
 */
export const VAULT_GIT_ATOMIC_PUSH_FLAGS = [
	"--atomic",
	"--porcelain",
	"--no-verify",
] as const;

/** Deadlines for local Git plumbing and remote fetch/push operations. */
export interface VaultGitGitTimeouts {
	/** Exact-ref fetch deadline. */
	readonly fetchMs: number;
	/** Compare-and-swap push deadline. */
	readonly pushMs: number;
	/** Local object inspection and construction deadline. */
	readonly localMs: number;
}

/** Construction input for the process-backed Git adapter. */
export interface VaultGitAdapterOptions {
	/** Repository whose object database receives fetched ledger commits. */
	readonly repositoryPath: string;
	/** Injectable bounded subprocess runner. */
	readonly process: VaultGitProcessPort;
	/** Operation-specific hard deadlines. */
	readonly timeouts: VaultGitGitTimeouts;
	/** Git executable override. @defaultValue "git" */
	readonly gitBinary?: string;
	/** Exact network hosts admitted by the caller; local remotes need no entry. */
	readonly allowedRemoteHosts?: readonly string[];
	/** Explicit admitted transport environment; ambient transport state is scrubbed. */
	readonly admittedGitEnvironment?: Readonly<Record<string, string>>;
}

/**
 * Create the sole process-backed Git adapter used by ledger engine logic.
 *
 * @param options - Repository, process boundary, and operation deadlines
 * @returns Exact-ref remote operations with Git plumbing hidden behind one port
 * @throws When a caller supplies an unsafe remote or destination ref
 *
 * @example
 * ```typescript
 * const git = createGitAdapter({
 *   repositoryPath: "/tmp/disposable-clone",
 *   process: createNodeProcessPort(),
 *   timeouts: { fetchMs: 5000, pushMs: 5000, localMs: 5000 },
 * })
 * ```
 */
export function createGitAdapter(
	options: VaultGitAdapterOptions,
): VaultGitRemotePort {
	const gitBinary = options.gitBinary ?? "git";
	const admittedGitEnvironment = normalizeAdmittedGitEnvironment(
		options.admittedGitEnvironment ?? {},
	);
	const allowedRemoteHosts = normalizeVaultGitAllowedRemoteHosts(
		options.allowedRemoteHosts ?? [],
	);
	const runGit = async (
		args: readonly string[],
		timeoutMs: number,
		input?: string,
		env?: Readonly<Record<string, string>>,
	): Promise<VaultGitProcessResult> =>
		options.process.run({
			command: gitBinary,
			args,
			cwd: options.repositoryPath,
			stdin: input,
			// LC_ALL=C keeps diagnostic messages stable for error classification.
			env: {
				...CONTROLLED_GIT_ENVIRONMENT,
				...admittedGitEnvironment,
				...env,
			},
			timeoutMs,
		});
	const fetchExactRef = async (
		remote: string,
		sourceRef: string,
	): Promise<
		| { readonly status: "ok"; readonly commit: string }
		| {
				readonly status: "failed";
				readonly reason: "remote_unavailable" | "timed_out";
		  }
	> => {
		// FETCH_HEAD is repository-wide mutable state, so concurrent operations
		// in one clone could read each other's fetched commit. A fresh private
		// ref per call isolates the read: the refspec is non-force, and a
		// never-before-seen ref always fast-forwards from nothing.
		const tempRef = `refs/vault-git/fetch-${randomUUID().replaceAll("-", "")}`;
		const fetched = await runGit(
			["fetch", "--no-tags", remote, `${sourceRef}:${tempRef}`],
			options.timeouts.fetchMs,
		);
		if (fetched.timedOut || fetched.exitCode !== 0) {
			await runGit(["update-ref", "-d", tempRef], options.timeouts.localMs);
			return {
				status: "failed",
				reason: fetched.timedOut ? "timed_out" : "remote_unavailable",
			};
		}
		const resolved = await runGit(
			["rev-parse", "--verify", `${tempRef}^{commit}`],
			options.timeouts.localMs,
		);
		await runGit(["update-ref", "-d", tempRef], options.timeouts.localMs);
		if (resolved.exitCode !== 0 || resolved.timedOut) {
			return {
				status: "failed",
				reason: resolved.timedOut ? "timed_out" : "remote_unavailable",
			};
		}
		return { status: "ok", commit: resolved.stdout.trim() };
	};
	const inspectRemoteSafety = async (remote: string) => {
		try {
			await assertVaultGitSafeRemoteTarget({
				runGit,
				remote,
				timeoutMs: options.timeouts.localMs,
				allowedRemoteHosts,
			});
			return null;
		} catch (error) {
			const classified = classifyRemoteSafetyError(error);
			if (classified) return classified;
			throw error;
		}
	};

	const readLedger = async (
		remote: string,
		ledgerRef: string,
	): Promise<VaultGitLedgerReadResult> => {
		assertLedgerRef(ledgerRef);
		const safety = await inspectRemoteSafety(remote);
		if (safety) return safety;
		const advertised = await runGit(
			["ls-remote", "--refs", "--exit-code", remote, ledgerRef],
			options.timeouts.fetchMs,
		);
		if (advertised.timedOut) return { status: "failed", reason: "timed_out" };
		if (advertised.exitCode === 2 && advertised.stdout.trim().length === 0) {
			return { status: "ok", head: null };
		}
		if (advertised.exitCode !== 0) {
			return { status: "failed", reason: "remote_unavailable" };
		}
		const advertisedLines = advertised.stdout
			.trim()
			.split("\n")
			.filter(Boolean);
		if (
			advertisedLines.length !== 1 ||
			advertisedLines[0]?.split("\t")[1] !== ledgerRef
		) {
			return { status: "failed", reason: "remote_unavailable" };
		}

		const fetched = await fetchExactRef(remote, ledgerRef);
		if (fetched.status === "failed") return fetched;
		const generation = fetched.commit;
		const parentsResult = await runGit(
			["show", "-s", "--format=%P", generation],
			options.timeouts.localMs,
		);
		if (parentsResult.exitCode !== 0 || parentsResult.timedOut) {
			return {
				status: "failed",
				reason: parentsResult.timedOut ? "timed_out" : "remote_unavailable",
			};
		}
		const contentResult = await runGit(
			["show", `${generation}:ledger.json`],
			options.timeouts.localMs,
		);
		if (contentResult.timedOut) return { status: "failed", reason: "timed_out" };
		// content:null is reserved for a completed command proving the file is
		// absent; any other nonzero exit is a failed read, not missing content.
		if (
			contentResult.exitCode !== 0 &&
			!isMissingLedgerPath(contentResult.stderr)
		) {
			return { status: "failed", reason: "remote_unavailable" };
		}
		return {
			status: "ok",
			head: {
				generation,
				parents: parentsResult.stdout.trim().split(/\s+/).filter(Boolean),
				content: contentResult.exitCode === 0 ? contentResult.stdout : null,
			},
		};
	};

	return {
		async probeAtomicPush(remote) {
			try {
				await assertVaultGitSafeRemoteTarget({
					runGit,
					remote,
					timeoutMs: options.timeouts.localMs,
					allowedRemoteHosts,
				});
				await assertNoConfiguredPushRefspec(
					runGit,
					remote,
					options.timeouts.localMs,
				);
			} catch {
				return { status: "refused", reason: "unsafe_remote_configuration" };
			}
			const localMain = await runGit(
				["rev-parse", "--verify", "refs/heads/main^{commit}"],
				options.timeouts.localMs,
			);
			if (localMain.timedOut) return { status: "failed", reason: "timed_out" };
			if (localMain.exitCode !== 0) {
				return { status: "failed", reason: "remote_unavailable" };
			}
			const head = requireObjectId(localMain.stdout, "local main");
			// Dry-run only: two collision-resistant synthetic refs shaped like the
			// real contract (a main-like ref plus a ledger-like ref) exercise the
			// two-ref atomic capability and vault-system namespace permissions.
			// refs/heads/main itself is deliberately absent so a behind or
			// diverged main is classified by inspectMain, never mislabeled as
			// remote_unavailable by a non-fast-forward dry-run rejection; a fresh
			// per-call suffix keeps a pre-existing remote ref from colliding.
			const probeNamespace = `refs/heads/vault-system/probe-${randomUUID().replaceAll("-", "")}`;
			const probed = await runGit(
				[
					"push",
					...VAULT_GIT_ATOMIC_PUSH_FLAGS,
					"--dry-run",
					remote,
					`${head}:${probeNamespace}/main`,
					`${head}:${probeNamespace}/transaction-ledger`,
				],
				options.timeouts.pushMs,
			);
			if (probed.timedOut) return { status: "failed", reason: "timed_out" };
			if (probed.exitCode === 0) return { status: "supported" };
			if (/does not support.*atomic|atomic push is not supported/i.test(probed.stderr)) {
				return { status: "refused", reason: "atomic_push_unsupported" };
			}
			return { status: "failed", reason: "remote_unavailable" };
		},

		async inspectMain(remote): Promise<VaultGitMainInspection> {
			const safety = await inspectRemoteSafety(remote);
			if (safety) return safety;
			const advertised = await runGit(
				["ls-remote", "--refs", "--exit-code", remote, "refs/heads/main"],
				options.timeouts.fetchMs,
			);
			if (advertised.timedOut) return { status: "failed", reason: "timed_out" };
			if (advertised.exitCode === 2) {
				return { status: "failed", reason: "remote_main_missing" };
			}
			if (advertised.exitCode !== 0) {
				return { status: "failed", reason: "remote_unavailable" };
			}
			const fetched = await fetchExactRef(remote, "refs/heads/main");
			if (fetched.status === "failed") return fetched;
			const remoteHead = fetched.commit;
			const localHeadResult = await runGit(
				["rev-parse", "--verify", "refs/heads/main^{commit}"],
				options.timeouts.localMs,
			);
			if (localHeadResult.timedOut)
				return { status: "failed", reason: "timed_out" };
			if (localHeadResult.exitCode !== 0) {
				return {
					status: "ok",
					alignment: "local_missing",
					localHead: null,
					remoteHead,
				};
			}
			const localHead = localHeadResult.stdout.trim();
			if (localHead === remoteHead) {
				return { status: "ok", alignment: "aligned", localHead, remoteHead };
			}
			const localToRemote = await inspectAncestry(
				runGit,
				localHead,
				remoteHead,
				options.timeouts.localMs,
			);
			const remoteToLocal = await inspectAncestry(
				runGit,
				remoteHead,
				localHead,
				options.timeouts.localMs,
			);
			if (localToRemote === "timed_out" || remoteToLocal === "timed_out") {
				return { status: "failed", reason: "timed_out" };
			}
			if (localToRemote === "failed" || remoteToLocal === "failed") {
				return { status: "failed", reason: "remote_unavailable" };
			}
			if (localToRemote === "ancestor") {
				return { status: "ok", alignment: "behind", localHead, remoteHead };
			}
			if (remoteToLocal === "ancestor") {
				return { status: "ok", alignment: "ahead", localHead, remoteHead };
			}
			return { status: "ok", alignment: "diverged", localHead, remoteHead };
		},

		readLedger,

		async appendLedgerCommit(
			request: VaultGitLedgerAppendRequest,
		): Promise<VaultGitLedgerAppendResult> {
			assertLedgerRef(request.ledgerRef);
			assertObjectId(request.expectedGeneration);
			assertSafeCommitField("author", request.author);
			assertSafeCommitField("message", request.message);
			await assertVaultGitSafeRemoteTarget({
				runGit,
				remote: request.remote,
				timeoutMs: options.timeouts.localMs,
				allowedRemoteHosts,
			});
			await assertNoConfiguredPushRefspec(
				runGit,
				request.remote,
				options.timeouts.localMs,
			);

			const blobResult = await runGit(
				["hash-object", "-w", "--stdin"],
				options.timeouts.localMs,
				request.content,
			);
			const blob = requireLocalObject(blobResult, "ledger blob");
			const treeResult = await runGit(
				["mktree"],
				options.timeouts.localMs,
				`100644 blob ${blob}\tledger.json\n`,
			);
			const tree = requireLocalObject(treeResult, "ledger tree");
			const commitArgs = ["commit-tree", tree];
			if (request.expectedGeneration) {
				commitArgs.push("-p", request.expectedGeneration);
			}
			commitArgs.push("-m", request.message);
			const commitResult = await runGit(
				commitArgs,
				options.timeouts.localMs,
				undefined,
				{
					GIT_AUTHOR_NAME: request.author,
					GIT_AUTHOR_EMAIL: "vault-git@localhost.invalid",
					GIT_AUTHOR_DATE: request.timestamp,
					GIT_COMMITTER_NAME: "vault-git transaction manager",
					GIT_COMMITTER_EMAIL: "vault-git@localhost.invalid",
					GIT_COMMITTER_DATE: request.timestamp,
				},
			);
			const commit = requireLocalObject(commitResult, "ledger commit");
			const parentResult = await runGit(
				["show", "-s", "--format=%P", commit],
				options.timeouts.localMs,
			);
			const actualParents = parentResult.stdout
				.trim()
				.split(/\s+/)
				.filter(Boolean);
			const expectedParents = request.expectedGeneration
				? [request.expectedGeneration]
				: [];
			if (
				parentResult.exitCode !== 0 ||
				parentResult.timedOut ||
				JSON.stringify(actualParents) !== JSON.stringify(expectedParents)
			) {
				throw new Error(
					"ledger commit parent does not match the observed generation",
				);
			}

			const pushed = await runGit(
				[
					"push",
					"--porcelain",
					"--no-verify",
					request.remote,
					`${commit}:${request.ledgerRef}`,
				],
				options.timeouts.pushMs,
			);
			if (pushed.exitCode === 0 && !pushed.timedOut)
				return { status: "appended", generation: commit };

			const current = await readLedger(request.remote, request.ledgerRef);
			if (current.status === "ok" && current.head?.generation === commit) {
				return { status: "appended", generation: commit };
			}
			if (
				current.status === "ok" &&
				current.head !== null &&
				current.head.generation !== request.expectedGeneration
			) {
				const landedInHistory = await inspectAncestry(
					runGit,
					commit,
					current.head.generation,
					options.timeouts.localMs,
				);
				if (landedInHistory === "ancestor") {
					// This append changed the remote but no longer owns its tip. Never
					// collapse that lost acknowledgement to changedState "none".
					return { status: "refused", reason: "remote_state_unknown" };
				}
				if (landedInHistory === "failed" || landedInHistory === "timed_out") {
					return { status: "refused", reason: "remote_state_unknown" };
				}
			}
			if (
				current.status === "ok" &&
				(current.head?.generation ?? null) !== request.expectedGeneration
			) {
				return { status: "refused", reason: "remote_moved" };
			}
			if (pushed.timedOut) {
				// A timed-out push may still land after this re-read observed the
				// old generation; the remote outcome remains unknown.
				return { status: "refused", reason: "timed_out" };
			}
			if (current.status === "ok") {
				return { status: "refused", reason: "remote_unavailable" };
			}
			return { status: "refused", reason: "remote_state_unknown" };
		},

		async atomicClose(request) {
			assertLedgerRef(request.ledgerRef);
			assertObjectId(request.expectedMainHead);
			assertObjectId(request.mainCommit);
			assertObjectId(request.expectedLedgerGeneration);
			assertSafeCommitField("author", request.author);
			assertSafeCommitField("message", request.ledgerMessage);
			// The remote URL is repository configuration and can change between
			// begin and complete; re-prove the host before the only operation
			// that force-updates remote main.
			await assertVaultGitSafeRemoteTarget({
				runGit,
				remote: request.remote,
				timeoutMs: options.timeouts.localMs,
				allowedRemoteHosts,
			});
			await assertNoConfiguredPushRefspec(
				runGit,
				request.remote,
				options.timeouts.localMs,
			);
			const mainParent = await runGit(
				["show", "-s", "--format=%P", request.mainCommit],
				options.timeouts.localMs,
			);
			const mainParents = mainParent.stdout.trim().split(/\s+/).filter(Boolean);
			if (
				mainParent.timedOut ||
				mainParent.exitCode !== 0 ||
				mainParents.length !== 1 ||
				mainParents[0] !== request.expectedMainHead
			) {
				throw new Error("main commit does not descend from the admitted head");
			}

			const blob = requireLocalObject(
				await runGit(
					["hash-object", "-w", "--stdin"],
					options.timeouts.localMs,
					request.ledgerContent,
				),
				"ledger release blob",
			);
			const tree = requireLocalObject(
				await runGit(
					["mktree"],
					options.timeouts.localMs,
					`100644 blob ${blob}\tledger.json\n`,
				),
				"ledger release tree",
			);
			const ledgerCommit = requireLocalObject(
				await runGit(
					[
						"commit-tree",
						tree,
						"-p",
						request.expectedLedgerGeneration,
						"-m",
						request.ledgerMessage,
					],
					options.timeouts.localMs,
					undefined,
					{
						GIT_AUTHOR_NAME: request.author,
						GIT_AUTHOR_EMAIL: "vault-git@localhost.invalid",
						GIT_AUTHOR_DATE: request.timestamp,
						GIT_COMMITTER_NAME: "vault-git transaction manager",
						GIT_COMMITTER_EMAIL: "vault-git@localhost.invalid",
						GIT_COMMITTER_DATE: request.timestamp,
					},
				),
				"ledger release commit",
			);
			await request.onPrepared({
				mainCommit: request.mainCommit,
				ledgerCommit,
			});
			// Exact-old-OID leases: a rewound remote whose ref would still
			// fast-forward must be rejected, not silently absorbed.
			const pushed = await runGit(
				[
					"push",
					...VAULT_GIT_ATOMIC_PUSH_FLAGS,
					`--force-with-lease=refs/heads/main:${request.expectedMainHead}`,
					`--force-with-lease=${request.ledgerRef}:${request.expectedLedgerGeneration}`,
					request.remote,
					`${request.mainCommit}:refs/heads/main`,
					`${ledgerCommit}:${request.ledgerRef}`,
				],
				options.timeouts.pushMs,
			);
			const reconciled = await reconcileAtomicClose({
				runGit,
				fetchExactRef,
				remote: request.remote,
				expectedMainHead: request.expectedMainHead,
				mainCommit: request.mainCommit,
				expectedLedgerGeneration: request.expectedLedgerGeneration,
				ledgerCommit,
				ledgerRef: request.ledgerRef,
				timeoutMs: options.timeouts.localMs,
			});
			if (reconciled.outcome === "closed") {
				return { status: "closed", mainCommit: request.mainCommit, ledgerCommit };
			}
			if (reconciled.outcome === "host_contract_breach") {
				return {
					status: "host_contract_breach",
					mainCommit: request.mainCommit,
					ledgerCommit,
				};
			}
			if (/does not support.*atomic|atomic push is not supported/i.test(pushed.stderr)) {
				return {
					status: "host_contract_breach",
					mainCommit: request.mainCommit,
					ledgerCommit,
				};
			}
			return {
				status: "push_pending",
				reason: pushed.timedOut
					? "timed_out"
					: pushed.exitCode === 0
						? "remote_state_unknown"
						: "remote_unavailable",
				mainCommit: request.mainCommit,
				ledgerCommit,
			};
		},

		async reconcileAtomicClose(request) {
			await assertVaultGitSafeRemoteTarget({
				runGit,
				remote: request.remote,
				timeoutMs: options.timeouts.localMs,
				allowedRemoteHosts,
			});
			if (!/^txn_[0-9a-f]{32}$/.test(request.transactionId)) {
				throw new Error("transaction id must be one opaque public id");
			}
			assertLedgerRef(request.ledgerRef);
			assertObjectId(request.expectedMainHead);
			assertObjectId(request.mainCommit);
			assertObjectId(request.expectedLedgerGeneration);
			assertObjectId(request.ledgerCommit);
			const reconciled = await reconcileAtomicClose({
				runGit,
				fetchExactRef,
				remote: request.remote,
				expectedMainHead: request.expectedMainHead,
				mainCommit: request.mainCommit,
				expectedLedgerGeneration: request.expectedLedgerGeneration,
				ledgerCommit: request.ledgerCommit,
				ledgerRef: request.ledgerRef,
				timeoutMs: options.timeouts.localMs,
			});
			if (reconciled.outcome === "closed") {
				const [mainPayload, ledgerPayload] = await Promise.all([
					runGit(
						["show", "-s", "--format=%B", request.mainCommit],
						options.timeouts.localMs,
					),
					runGit(
						["show", `${request.ledgerCommit}:ledger.json`],
						options.timeouts.localMs,
					),
				]);
				if (mainPayload.timedOut || ledgerPayload.timedOut) {
					return { status: "unknown", reason: "timed_out" };
				}
				if (mainPayload.exitCode !== 0 || ledgerPayload.exitCode !== 0) {
					return { status: "unknown", reason: "local_probe_failed" };
				}
				let ledgerDocument: unknown;
				try {
					ledgerDocument = JSON.parse(ledgerPayload.stdout);
				} catch {
					return { status: "host_contract_breach" };
				}
				if (
					!mainPayload.stdout
						.split(/\r?\n/)
						.some(
							(line) =>
								line === `Vault-Transaction: ${request.transactionId}`,
						) ||
					!isMatchingReleasePayload(
						ledgerDocument,
						request.transactionId,
						request.expectedLedgerGeneration,
					)
				) {
					return { status: "host_contract_breach" };
				}
			}
			return reconciled.outcome === "unknown"
				? {
						status: "unknown",
						reason: reconciled.reason,
					} satisfies VaultGitAtomicCloseReconciliation
				: { status: reconciled.outcome };
		},
	};
}

/** Construction input for the production admission and exact-commit adapter. */
export interface VaultGitRepositoryAdapterOptions extends VaultGitAdapterOptions {
	/** Stable non-secret configured-vault identity. */
	readonly repositoryIdentity: string;
	/** Optional production revalidation proof for the configured vault root. */
	readonly resolveRepositoryIdentity?: () => Promise<
		{
			readonly identity: string;
			readonly repositoryRoot: string;
		}
	>;
}

/**
 * Create the production repository admission and exact local commit boundary.
 *
 * @param options - Canonical repository, identity, process port, and deadlines
 * @returns Admission snapshots and private-index commit plumbing
 * @throws {Error} When the configured root or local Git plumbing is unavailable
 *
 * @example
 * ```typescript
 * const repository = createGitRepositoryAdapter({
 *   repositoryPath: "/srv/vault",
 *   repositoryIdentity: "vault@example",
 *   process: createNodeProcessPort(),
 *   timeouts: { fetchMs: 5000, pushMs: 5000, localMs: 5000 },
 * })
 * ```
 */
export function createGitRepositoryAdapter(
	options: VaultGitRepositoryAdapterOptions,
): VaultGitRepositoryPort {
	if (options.repositoryIdentity.trim().length === 0) {
		throw new Error("repository identity must not be empty");
	}
	const gitBinary = options.gitBinary ?? "git";
	const admittedGitEnvironment = normalizeAdmittedGitEnvironment(
		options.admittedGitEnvironment ?? {},
	);
	const runGit = async (
		args: readonly string[],
		input?: string,
		env?: Readonly<Record<string, string>>,
	): Promise<VaultGitProcessResult> =>
		options.process.run({
			command: gitBinary,
			args,
			cwd: options.repositoryPath,
			stdin: input,
			env: {
				...CONTROLLED_GIT_ENVIRONMENT,
				...admittedGitEnvironment,
				...env,
			},
			timeoutMs: options.timeouts.localMs,
		});
	// Inspect the repository's own configuration without the execution-time
	// hooksPath override masking what the operator actually configured.
	const inspectLocalConfig = (args: readonly string[]) =>
		runGit(args, undefined, { GIT_CONFIG_COUNT: "0" });

	const captureUnrelatedState = async (
		ownedPaths: readonly string[],
	): Promise<VaultGitUnrelatedStateSnapshot> => {
		const pathspecs = unrelatedPathspecs(ownedPaths);
		const [status, index] = await Promise.all([
			runGit([
				"status",
				"--porcelain=v2",
				"-z",
				"--untracked-files=all",
				"--ignored=no",
				"--",
				...pathspecs,
			]),
			runGit(["ls-files", "--stage", "-z", "--", ...pathspecs]),
		]);
		if (status.timedOut || index.timedOut) {
			throw new GitProcessTimedOutError(
				"timed out capturing unrelated repository state",
			);
		}
		if (status.exitCode !== 0 || index.exitCode !== 0) {
			throw new Error("could not capture unrelated repository state");
		}
		return {
			statusHex: Buffer.from(status.stdout, "utf8").toString("hex"),
			indexHex: Buffer.from(index.stdout, "utf8").toString("hex"),
		};
	};

	const hashOwnedPaths = async (
		ownedPaths: readonly string[],
	): Promise<readonly { path: string; contentHash: string | null }[]> => {
		const hashes: { path: string; contentHash: string | null }[] = [];
		for (const path of ownedPaths) {
			const metadata = await lstat(resolve(options.repositoryPath, path)).catch(
				(error: unknown) =>
					isMissingFilesystemEntry(error) ? null : Promise.reject(error),
			);
			if (metadata === null) {
				hashes.push({ path, contentHash: null });
				continue;
			}
			// hash-object applies the same attribute filters as `git add`, so the
			// resulting object id equals the blob a later freeze would produce.
			const hashed = await runGit(["hash-object", "--", path]);
			if (hashed.timedOut || hashed.exitCode !== 0) {
				throw new Error("could not hash owned path content");
			}
			hashes.push({
				path,
				contentHash: requireObjectId(hashed.stdout, "owned path content"),
			});
		}
		return hashes;
	};

	const hashRecoveryPath = async (path: string): Promise<string | null> => {
		const metadata = await lstat(resolve(options.repositoryPath, path)).catch(
			(error: unknown) =>
				isMissingFilesystemEntry(error) ? null : Promise.reject(error),
		);
		if (metadata === null) return null;
		if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
		const hashed = await runGit(["hash-object", "--", path]);
		if (hashed.timedOut) {
			throw new GitProcessTimedOutError(
				"timed out hashing staged recovery path",
			);
		}
		if (hashed.exitCode !== 0) {
			throw new Error("could not hash staged recovery path");
		}
		return requireObjectId(hashed.stdout, "staged recovery content");
	};

	const prepareStagedRecovery = async (
		ownedPaths: readonly VaultGitOwnedPathReceipt[],
	) => {
		try {
			if (
				ownedPaths.length === 0 ||
				ownedPaths.some(
					(entry) => !entry.admittedNewFile || entry.baselineHash !== null,
				)
			) {
				return { status: "refused", reason: "mismatch" } as const;
			}
			const head = await runGit([
				"rev-parse",
				"--verify",
				"refs/heads/main^{commit}",
			]);
			if (head.timedOut) {
				return { status: "refused", reason: "timed_out" } as const;
			}
			if (head.exitCode !== 0) {
				return { status: "refused", reason: "mismatch" } as const;
			}
			const baselineHead = requireObjectId(head.stdout, "staged recovery main");
			const entries: VaultGitStagedRecoveryEntry[] = [];
			for (const ownedPath of [...ownedPaths].sort((left, right) =>
				left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
			)) {
				if (!(await isSafeOwnedPath(options.repositoryPath, ownedPath.path))) {
					return { status: "refused", reason: "mismatch" } as const;
				}
				if ((await readTreeEntry(runGit, baselineHead, ownedPath.path)) !== null) {
					return { status: "refused", reason: "mismatch" } as const;
				}
				const indexEntry = await readIndexEntry(runGit, ownedPath.path);
				if (
					indexEntry === null ||
					(indexEntry.mode !== "100644" && indexEntry.mode !== "100755")
				) {
					return { status: "refused", reason: "mismatch" } as const;
				}
				const worktreeHash = await hashRecoveryPath(ownedPath.path);
				if (worktreeHash !== null && worktreeHash !== indexEntry.objectId) {
					return { status: "refused", reason: "mismatch" } as const;
				}
				entries.push({
					path: ownedPath.path,
					objectId: indexEntry.objectId,
					mode: indexEntry.mode,
				});
			}
			return {
				status: "ready",
				plan: {
					baselineHead,
					unrelatedState: await captureUnrelatedState(
						entries.map((entry) => entry.path),
					),
					entries,
				},
			} as const;
		} catch (error) {
			return {
				status: "refused",
				reason:
					error instanceof GitProcessTimedOutError ? "timed_out" : "mismatch",
			} as const;
		}
	};

	// Preserve timeout classification while collapsing repeated subprocess checks.
	const requireStagedRecoveryCommand = (
		result: VaultGitProcessResult,
		timeoutMessage: string,
		failureMessage: string,
	): string => {
		if (result.timedOut) throw new GitProcessTimedOutError(timeoutMessage);
		if (result.exitCode !== 0) throw new Error(failureMessage);
		return result.stdout;
	};

	const removeStagedRecoveryRoots = async (
		roots: readonly string[],
	): Promise<void> => {
		await Promise.allSettled(
			roots.map((root) => rm(root, { recursive: true, force: true })),
		);
	};

	// Derive an exact-object patch in an isolated index so recovery can use Git's compare-and-apply semantics.
	const createStagedRecoveryPatch = async (
		baselineHead: string,
		entries: readonly VaultGitStagedRecoveryEntry[],
	): Promise<{ readonly path: string; readonly root: string }> => {
		const canonicalIndexPath = requireStagedRecoveryCommand(
			await runGit([
				"rev-parse",
				"--path-format=absolute",
				"--git-path",
				"index",
			]),
			"timed out resolving the staged recovery index",
			"could not resolve the staged recovery index",
		).trim();
		if (
			!isAbsolute(canonicalIndexPath) ||
			canonicalIndexPath.includes("\0")
		) {
			throw new Error("could not resolve the staged recovery index");
		}
		const temporaryRoot = await mkdtemp(
			join(dirname(canonicalIndexPath), ".vault-git-staged-recovery-"),
		);
		await chmod(temporaryRoot, 0o700);
		const temporaryIndexPath = join(temporaryRoot, "index");
		const temporaryPatchPath = join(temporaryRoot, "patch");
		const temporaryIndexEnvironment = { GIT_INDEX_FILE: temporaryIndexPath };
		let preserveRoot = false;
		try {
			requireStagedRecoveryCommand(
				await runGit(
					["read-tree", baselineHead],
					undefined,
					temporaryIndexEnvironment,
				),
				"timed out creating the staged recovery index",
				"could not create the staged recovery index",
			);
			await chmod(temporaryIndexPath, 0o600);
			requireStagedRecoveryCommand(
				await runGit(
					["update-index", "-z", "--index-info"],
					entries
						.map(
							(entry) =>
								`${entry.mode} ${entry.objectId}\t${entry.path}\0`,
						)
						.join(""),
					temporaryIndexEnvironment,
				),
				"timed out populating the staged recovery index",
				"could not populate the staged recovery index",
			);
			await chmod(temporaryIndexPath, 0o600);
			const patchFile = await open(temporaryPatchPath, "wx", 0o600);
			await patchFile.close();
			requireStagedRecoveryCommand(
				await runGit(
					[
						"diff",
						`--output=${temporaryPatchPath}`,
						"--cached",
						"--binary",
						"--full-index",
						"--no-renames",
						"--no-ext-diff",
						"--no-textconv",
						baselineHead,
						"--",
						...entries.map((entry) => literalPathspec(entry.path)),
					],
					undefined,
					temporaryIndexEnvironment,
				),
				"timed out deriving the staged recovery patch",
				"could not derive the staged recovery patch",
			);
			await chmod(temporaryPatchPath, 0o600);
			if ((await stat(temporaryPatchPath)).size === 0) {
				throw new Error("could not derive the staged recovery patch");
			}
			preserveRoot = true;
			return { path: temporaryPatchPath, root: temporaryRoot };
		} finally {
			// Best-effort cleanup must never replace the operation's timeout or
			// mismatch classification with an unrelated filesystem failure.
			if (!preserveRoot) {
				await removeStagedRecoveryRoots([temporaryRoot]);
			}
		}
	};

	const applyStagedRecovery = async (plan: VaultGitStagedRecoveryPlan) => {
		try {
			if (plan.entries.length === 0) {
				return { status: "refused", reason: "mismatch" } as const;
			}
			const head = await runGit([
				"rev-parse",
				"--verify",
				"refs/heads/main^{commit}",
			]);
			if (head.timedOut) {
				return { status: "refused", reason: "timed_out" } as const;
			}
			if (
				head.exitCode !== 0 ||
				requireObjectId(head.stdout, "staged recovery main") !== plan.baselineHead
			) {
				return { status: "refused", reason: "mismatch" } as const;
			}
			const paths = plan.entries.map((entry) => entry.path);
			if (
				!matchesUnrelatedState(
					await captureUnrelatedState(paths),
					plan.unrelatedState,
				)
			) {
				return { status: "refused", reason: "mismatch" } as const;
			}
			const stagedEntries: VaultGitStagedRecoveryEntry[] = [];
			const missingWorktreeEntries: VaultGitStagedRecoveryEntry[] = [];
			for (const entry of plan.entries) {
				if (
					!(await isSafeOwnedPath(options.repositoryPath, entry.path)) ||
					(await readTreeEntry(runGit, plan.baselineHead, entry.path)) !== null
				) {
					return { status: "refused", reason: "mismatch" } as const;
				}
				const indexEntry = await readIndexEntry(runGit, entry.path);
				if (
					indexEntry !== null &&
					(indexEntry.objectId !== entry.objectId || indexEntry.mode !== entry.mode)
				) {
					return { status: "refused", reason: "mismatch" } as const;
				}
				const worktreeHash = await hashRecoveryPath(entry.path);
				if (worktreeHash !== null && worktreeHash !== entry.objectId) {
					return { status: "refused", reason: "mismatch" } as const;
				}
				if (indexEntry !== null) {
					stagedEntries.push(entry);
					if (worktreeHash === null) missingWorktreeEntries.push(entry);
				} else if (worktreeHash !== entry.objectId) {
					return { status: "refused", reason: "mismatch" } as const;
				}
			}
			const temporaryPatchRoots: string[] = [];
			try {
				const worktreePatch =
					missingWorktreeEntries.length === 0
						? null
						: await createStagedRecoveryPatch(
								plan.baselineHead,
								missingWorktreeEntries,
							);
				if (worktreePatch !== null) temporaryPatchRoots.push(worktreePatch.root);
				const indexPatch =
					stagedEntries.length === 0
						? null
						: await createStagedRecoveryPatch(plan.baselineHead, stagedEntries);
				if (indexPatch !== null) temporaryPatchRoots.push(indexPatch.root);
				if (worktreePatch !== null) {
					requireStagedRecoveryCommand(
						await runGit([
							"apply",
							"--whitespace=nowarn",
							"--",
							worktreePatch.path,
						]),
						"timed out materializing staged recovery content",
						"could not materialize staged recovery content",
					);
				}
				for (const entry of plan.entries) {
					if ((await hashRecoveryPath(entry.path)) !== entry.objectId) {
						return { status: "refused", reason: "mismatch" } as const;
					}
				}
				if (indexPatch !== null) {
					requireStagedRecoveryCommand(
						await runGit([
							"apply",
							"--cached",
							"--reverse",
							"--whitespace=nowarn",
							"--",
							indexPatch.path,
						]),
						"timed out resetting the staged recovery index",
						"could not reset the staged recovery index",
					);
				}
				for (const entry of plan.entries) {
					if (
						(await readIndexEntry(runGit, entry.path)) !== null ||
						(await hashRecoveryPath(entry.path)) !== entry.objectId
					) {
						return { status: "refused", reason: "mismatch" } as const;
					}
				}
				if (
					!matchesUnrelatedState(
						await captureUnrelatedState(paths),
						plan.unrelatedState,
					)
				) {
					return { status: "refused", reason: "mismatch" } as const;
				}
				return { status: "recovered" } as const;
			} finally {
				await removeStagedRecoveryRoots(temporaryPatchRoots);
			}
		} catch (error) {
			return {
				status: "refused",
				reason:
					error instanceof GitProcessTimedOutError ? "timed_out" : "mismatch",
			} as const;
		}
	};

	return {
		async inspectSafety() {
			const hooksPath = await inspectLocalConfig([
				"config",
				"--local",
				"--includes",
				"--get",
				"core.hooksPath",
			]);
			if (hooksPath.timedOut || (hooksPath.exitCode !== 0 && hooksPath.exitCode !== 1)) {
				return { status: "refused", reason: "configured_hooks_path" } as const;
			}
			if (hooksPath.exitCode === 0 && hooksPath.stdout.trim().length > 0) {
				return { status: "refused", reason: "configured_hooks_path" } as const;
			}
			const credentialHelpers = await inspectLocalConfig([
				"config",
				"--local",
				"--includes",
				"--get-all",
				"credential.helper",
			]);
			if (
				credentialHelpers.timedOut ||
				(credentialHelpers.exitCode !== 0 && credentialHelpers.exitCode !== 1) ||
				(credentialHelpers.exitCode === 0 && credentialHelpers.stdout.trim().length > 0)
			) {
				return { status: "refused", reason: "credential_helper" } as const;
			}
			const authHeaders = await inspectLocalConfig([
				"config",
				"--local",
				"--includes",
				"--get-regexp",
				"^http(\\..+)?\\.extraheader$",
			]);
			if (
				authHeaders.timedOut ||
				(authHeaders.exitCode !== 0 && authHeaders.exitCode !== 1) ||
				(authHeaders.exitCode === 0 && authHeaders.stdout.trim().length > 0)
			) {
				return { status: "refused", reason: "credential_helper" } as const;
			}
			// Repository-local transport-command configuration executes attacker
			// text: core.sshCommand and remote-level sshCommand variants replace
			// the transport binary, core.fsmonitor runs on nearly every status,
			// and protocol.ext.allow re-enables the ext:: command transport.
			for (const pattern of [
				"sshcommand$",
				"^core\\.fsmonitor$",
				"^protocol\\.ext\\.allow$",
			]) {
				const configured = await inspectLocalConfig([
					"config",
					"--local",
					"--includes",
					"--get-regexp",
					pattern,
				]);
				if (
					configured.timedOut ||
					(configured.exitCode !== 0 && configured.exitCode !== 1) ||
					(configured.exitCode === 0 && configured.stdout.trim().length > 0)
				) {
					return { status: "refused", reason: "transport_command" } as const;
				}
			}
			const hooksDirectory = await inspectLocalConfig([
				"rev-parse",
				"--git-path",
				"hooks",
			]);
			if (hooksDirectory.timedOut || hooksDirectory.exitCode !== 0) {
				return { status: "refused", reason: "repository_hook" } as const;
			}
			// A missing hooks directory proves no hook can run; any other read
			// failure proves nothing, so it refuses instead of failing open.
			let hookNames: string[];
			try {
				hookNames = await readdir(
					resolve(options.repositoryPath, hooksDirectory.stdout.trim()),
				);
			} catch (error) {
				if (!isMissingFilesystemEntry(error)) {
					return { status: "refused", reason: "repository_hook" } as const;
				}
				hookNames = [];
			}
			if (hookNames.some((name) => !name.endsWith(".sample"))) {
				return { status: "refused", reason: "repository_hook" } as const;
			}
			return { status: "safe" } as const;
		},

		async resolveCanonicalIdentity() {
			if (options.resolveRepositoryIdentity) {
				const [identityProof, configuredRoot, main] = await Promise.all([
					options.resolveRepositoryIdentity(),
					realpath(options.repositoryPath),
					runGit(["rev-parse", "--verify", "refs/heads/main^{commit}"]),
				]);
				if (main.timedOut || main.exitCode === null) {
					throw new VaultRepositoryIdentityUnavailableError();
				}
				if ((await realpath(identityProof.repositoryRoot)) !== configuredRoot || main.exitCode !== 0) {
					throw new Error("configured repository root is not canonical");
				}
				return {
					identity: identityProof.identity,
					localMainHead: requireObjectId(main.stdout, "local main"),
				};
			}
			const [configuredRoot, discoveredRoot, main] = await Promise.all([
				realpath(options.repositoryPath),
				runGit(["rev-parse", "--show-toplevel"]),
				runGit(["rev-parse", "--verify", "refs/heads/main^{commit}"]),
			]);
			if (discoveredRoot.timedOut || main.timedOut) {
				throw new VaultRepositoryIdentityUnavailableError();
			}
			if (
				discoveredRoot.exitCode !== 0 ||
				main.exitCode !== 0 ||
				(await realpath(discoveredRoot.stdout.trim())) !== configuredRoot
			) {
				throw new Error("configured repository root is not canonical");
			}
			return {
				identity: options.repositoryIdentity,
				localMainHead: requireObjectId(main.stdout, "local main"),
			};
		},

		async inspectOwnedPaths(
			requestedPaths: readonly string[],
		): Promise<VaultGitOwnedPathInspection> {
			if (requestedPaths.length === 0) {
				return { status: "refused", reason: "invalid_path" };
			}
			const baseline = await runGit([
				"rev-parse",
				"--verify",
				"refs/heads/main^{commit}",
			]);
			if (baseline.timedOut || baseline.exitCode !== 0) {
				return { status: "refused", reason: "directory_expansion_failed" };
			}
			const baselineHead = requireObjectId(baseline.stdout, "local main");
			const expanded: string[] = [];
			for (const requestedPath of requestedPaths) {
				if (!(await isSafeOwnedPath(options.repositoryPath, requestedPath))) {
					return { status: "refused", reason: "invalid_path" };
				}
				const metadata = await lstat(resolve(options.repositoryPath, requestedPath)).catch(
					(error: unknown) => (isMissingFilesystemEntry(error) ? null : Promise.reject(error)),
				);
				if (metadata?.isSymbolicLink()) {
					return { status: "refused", reason: "symlink" };
				}
				if (metadata?.isDirectory()) {
					const leaves = await runGit([
						"ls-files",
						"-co",
						"--exclude-standard",
						"-z",
						"--",
						literalPathspec(requestedPath),
					]);
					if (leaves.timedOut || leaves.exitCode !== 0) {
						return { status: "refused", reason: "directory_expansion_failed" };
					}
					const paths = splitNul(leaves.stdout);
					if (paths.length === 0) {
						return { status: "refused", reason: "directory_expansion_failed" };
					}
					expanded.push(...paths);
				} else {
					expanded.push(requestedPath);
				}
			}
			const leafPaths = [...new Set(expanded)].sort();
			const ownedPaths = [];
			for (const path of leafPaths) {
				if (!(await isSafeOwnedPath(options.repositoryPath, path))) {
					return { status: "refused", reason: "symlink" };
				}
				// check-ignore does not support :(literal) pathspec magic. Its NUL
				// stdin mode consumes pathnames, not pathspecs, so magic bytes remain
				// literal without weakening the top-root validation above.
				const ignored = await runGit(
					["check-ignore", "--quiet", "-z", "--stdin"],
					`${path}\0`,
				);
				if (ignored.timedOut) {
					return { status: "refused", reason: "directory_expansion_failed" };
				}
				if (ignored.exitCode === 0) return { status: "refused", reason: "ignored" };
				if (ignored.exitCode !== 1) {
					return { status: "refused", reason: "directory_expansion_failed" };
				}
				const entry = await readTreeEntry(runGit, baselineHead, path);
				const metadata = await lstat(resolve(options.repositoryPath, path)).catch(
					(error: unknown) => (isMissingFilesystemEntry(error) ? null : Promise.reject(error)),
				);
				if (entry?.mode === "120000" || metadata?.isSymbolicLink()) {
					return { status: "refused", reason: "symlink" };
				}
				const status = await runGit([
					"status",
					"--porcelain=v1",
					"-z",
					"--untracked-files=all",
					"--",
					literalPathspec(path),
				]);
				if (status.timedOut || status.exitCode !== 0) {
					return { status: "refused", reason: "directory_expansion_failed" };
				}
				if (!entry && metadata) {
					return { status: "refused", reason: "preexisting_untracked" };
				}
				if (status.stdout.length > 0) {
					const indexStatus = status.stdout[0];
					const worktreeStatus = status.stdout[1];
					return {
						status: "refused",
						reason:
							indexStatus && indexStatus !== " " && indexStatus !== "?"
								? "staged"
								: worktreeStatus && worktreeStatus !== " " && worktreeStatus !== "?"
									? "dirty_worktree"
									: "preexisting_untracked",
					};
				}
				ownedPaths.push({
					path,
					baselineHash: entry?.objectId ?? null,
					admittedNewFile: !entry,
				});
			}
			return {
				status: "admitted",
				paths: ownedPaths,
				unrelatedState: await captureUnrelatedState(
					ownedPaths.map((entry) => entry.path),
				),
			};
		},

		captureUnrelatedState,

		hashOwnedPaths,

		prepareStagedRecovery,

		applyStagedRecovery,

		async inspectCommitAncestry(ancestor, descendant) {
			if (
				!/^[0-9a-f]{40,64}$/.test(ancestor) ||
				!/^[0-9a-f]{40,64}$/.test(descendant)
			) {
				return "failed";
			}
			return inspectAncestry(
				(args) => runGit(args),
				ancestor,
				descendant,
				options.timeouts.localMs,
			);
		},

		async inspectLocalCommit(commitId) {
			if (!/^[0-9a-f]{40,64}$/.test(commitId)) return { status: "missing" };
			const inspected = await runGit([
				"show",
				"-s",
				"--format=%H%x00%P%x00%B",
				commitId,
			]);
			if (inspected.timedOut) {
				return { status: "failed", reason: "timed_out" };
			}
			if (inspected.exitCode !== 0) return { status: "missing" };
			const first = inspected.stdout.indexOf("\0");
			const second = inspected.stdout.indexOf("\0", first + 1);
			if (first < 0 || second < 0) {
				return { status: "failed", reason: "probe_failed" };
			}
			const resolved = inspected.stdout.slice(0, first).trim();
			if (resolved !== commitId) {
				return { status: "failed", reason: "probe_failed" };
			}
			return {
				status: "ok",
				commitId: resolved,
				parents: inspected.stdout
					.slice(first + 1, second)
					.trim()
					.split(/\s+/)
					.filter(Boolean),
				message: inspected.stdout.slice(second + 1),
			};
		},

		async commitExact(request) {
			const localHead = await runGit([
				"rev-parse",
				"--verify",
				"refs/heads/main^{commit}",
			]);
			if (localHead.timedOut) return { status: "refused", reason: "timed_out" };
			if (
				localHead.exitCode !== 0 ||
				localHead.stdout.trim() !== request.baselineHead
			) {
				return { status: "refused", reason: "local_main_moved" };
			}
			for (const ownedPath of request.ownedPaths) {
				if (!(await isSafeOwnedPath(options.repositoryPath, ownedPath.path))) {
					return { status: "refused", reason: "owned_path_symlink" };
				}
				const currentMetadata = await lstat(
					resolve(options.repositoryPath, ownedPath.path),
				).catch((error: unknown) =>
					isMissingFilesystemEntry(error) ? null : Promise.reject(error),
				);
				if (currentMetadata?.isSymbolicLink()) {
					return { status: "refused", reason: "owned_path_symlink" };
				}
				const entry = await readTreeEntry(runGit, request.baselineHead, ownedPath.path);
				if ((entry?.objectId ?? null) !== ownedPath.baselineHash) {
					return { status: "refused", reason: "owned_path_baseline_changed" };
				}
			}
			const unrelated = await captureUnrelatedState(
				request.ownedPaths.map((entry) => entry.path),
			);
			if (!matchesUnrelatedState(unrelated, request.unrelatedState)) {
				return { status: "refused", reason: "unrelated_state_changed" };
			}

			const indexPathResult = await runGit(["rev-parse", "--git-path", "index"]);
			if (indexPathResult.timedOut) return { status: "refused", reason: "timed_out" };
			if (indexPathResult.exitCode !== 0) {
				return { status: "refused", reason: "candidate_mismatch" };
			}
			const canonicalIndex = resolve(
				options.repositoryPath,
				indexPathResult.stdout.trim(),
			);
			const temporaryIndex = `${canonicalIndex}.vault-git-${randomUUID()}`;
			const privateIndexEnvironment = { GIT_INDEX_FILE: temporaryIndex };
			try {
				const seeded = await runGit(
					["read-tree", request.baselineHead],
					undefined,
					privateIndexEnvironment,
				);
				if (seeded.timedOut) return { status: "refused", reason: "timed_out" };
				if (seeded.exitCode !== 0) {
					return { status: "refused", reason: "candidate_mismatch" };
				}
				await chmod(temporaryIndex, 0o600);
				const frozen = await runGit(
					[
						"add",
						"-A",
						"--",
						...request.ownedPaths.map((entry) => literalPathspec(entry.path)),
					],
					undefined,
					privateIndexEnvironment,
				);
				if (frozen.timedOut) return { status: "refused", reason: "timed_out" };
				if (frozen.exitCode !== 0) {
					return { status: "refused", reason: "candidate_mismatch" };
				}
				const treeResult = await runGit(
					["write-tree"],
					undefined,
					privateIndexEnvironment,
				);
				if (treeResult.timedOut) return { status: "refused", reason: "timed_out" };
				if (treeResult.exitCode !== 0) {
					return { status: "refused", reason: "candidate_mismatch" };
				}
				const treeId = requireObjectId(treeResult.stdout, "candidate tree");
				if (request.expectedContentHashes) {
					// Bind the checked bytes to the committed blobs: the frozen tree
					// must carry exactly the content hashed before the vault check ran.
					const expectedByPath = new Map(
						request.expectedContentHashes.map((entry) => [
							entry.path,
							entry.contentHash,
						]),
					);
					for (const ownedPath of request.ownedPaths) {
						const frozen = await readTreeEntry(runGit, treeId, ownedPath.path);
						const expected = expectedByPath.get(ownedPath.path);
						if (
							!expectedByPath.has(ownedPath.path) ||
							(frozen?.objectId ?? null) !== (expected ?? null)
						) {
							return { status: "refused", reason: "checked_content_changed" };
						}
					}
				}
				const changed = await runGit([
					"diff-tree",
					"--no-commit-id",
					"--name-only",
					"-r",
					"-z",
					request.baselineHead,
					treeId,
				]);
				if (changed.timedOut) return { status: "refused", reason: "timed_out" };
				if (changed.exitCode !== 0) {
					return { status: "refused", reason: "candidate_mismatch" };
				}
				const changedPaths = splitNul(changed.stdout);
				const owned = new Set(request.ownedPaths.map((entry) => entry.path));
				if (changedPaths.length === 0) {
					return { status: "refused", reason: "empty_event" };
				}
				if (changedPaths.some((path) => !owned.has(path))) {
					return { status: "refused", reason: "candidate_mismatch" };
				}
				const committed = await runGit(
					[
						"commit-tree",
						treeId,
						"-p",
						request.baselineHead,
						"-F",
						"-",
					],
					request.message,
					{
						GIT_AUTHOR_NAME: request.author,
						GIT_AUTHOR_EMAIL: "vault-git@localhost.invalid",
						GIT_AUTHOR_DATE: request.timestamp,
						GIT_COMMITTER_NAME: "vault-git transaction manager",
						GIT_COMMITTER_EMAIL: "vault-git@localhost.invalid",
						GIT_COMMITTER_DATE: request.timestamp,
					},
				);
				if (committed.timedOut) return { status: "refused", reason: "timed_out" };
				if (committed.exitCode !== 0) {
					return { status: "refused", reason: "candidate_mismatch" };
				}
				const commitId = requireObjectId(committed.stdout, "candidate commit");
				const proof = await runGit(["cat-file", "commit", commitId]);
				// Timeout classification must precede stdout consumption: a truncated
				// timed-out read is transient, not a candidate mismatch.
				if (proof.timedOut) return { status: "refused", reason: "timed_out" };
				const separator = proof.stdout.indexOf("\n\n");
				const headers = proof.stdout.slice(0, separator).split("\n");
				const provedTree = headers.find((header) => header.startsWith("tree "))?.slice(5);
				const provedParents = headers
					.filter((header) => header.startsWith("parent "))
					.map((header) => header.slice(7));
				const provedMessage = proof.stdout.slice(separator + 2);
				if (
					proof.exitCode !== 0 ||
					separator < 0 ||
					provedTree !== treeId ||
					provedParents.length !== 1 ||
					provedParents[0] !== request.baselineHead ||
					provedMessage !== request.message
				) {
					return { status: "refused", reason: "candidate_mismatch" };
				}
				const advanced = await runGit([
					"update-ref",
					"refs/heads/main",
					commitId,
					request.baselineHead,
				]);
				if (advanced.timedOut) return { status: "refused", reason: "timed_out" };
				if (advanced.exitCode !== 0) {
					return { status: "refused", reason: "local_main_moved" };
				}
				// Deletion records need the repo's null object id: 40 zeros under
				// sha1, 64 under sha256; a wrong width makes update-index refuse.
				let nullObjectId: string | undefined;
				for (const ownedPath of request.ownedPaths) {
					// After update-ref, every failure in this loop must preserve commit
					// evidence as a structured outcome instead of a raw throw.
					const entry = await readTreeEntry(
						runGit,
						treeId,
						ownedPath.path,
					).catch(() => undefined);
					if (entry === undefined) {
						return {
							status: "committed_incomplete",
							reason: "index_update_failed",
							commitId,
							treeId,
						};
					}
					if (!entry && nullObjectId === undefined) {
						const objectFormat = await runGit([
							"rev-parse",
							"--show-object-format",
						]);
						nullObjectId =
							!objectFormat.timedOut &&
							objectFormat.exitCode === 0 &&
							objectFormat.stdout.trim() === "sha256"
								? "0".repeat(64)
								: "0".repeat(40);
					}
					const indexInfo = entry
						? `${entry.mode} ${entry.objectId}\t${entry.path}\0`
						: `0 ${nullObjectId ?? "0".repeat(40)}\t${ownedPath.path}\0`;
					const updated = await runGit(
						["update-index", "-z", "--index-info"],
						indexInfo,
					);
					if (updated.timedOut || updated.exitCode !== 0) {
						// Local main already advanced; a raw throw here would strand the
						// commit evidence. Surface a structured outcome instead.
						return {
							status: "committed_incomplete",
							reason: "index_update_failed",
							commitId,
							treeId,
						};
					}
				}
				return { status: "committed", commitId, treeId };
			} finally {
				await unlink(temporaryIndex).catch(() => undefined);
				await unlink(`${temporaryIndex}.lock`).catch(() => undefined);
			}
		},
	};
}

async function reconcileAtomicClose(input: {
	readonly runGit: (
		args: readonly string[],
		timeoutMs: number,
	) => Promise<VaultGitProcessResult>;
	readonly fetchExactRef: (
		remote: string,
		sourceRef: string,
	) => Promise<
		| { readonly status: "ok"; readonly commit: string }
		| {
				readonly status: "failed";
				readonly reason: "remote_unavailable" | "timed_out";
		  }
	>;
	readonly remote: string;
	readonly expectedMainHead: string;
	readonly mainCommit: string;
	readonly expectedLedgerGeneration: string;
	readonly ledgerCommit: string;
	readonly ledgerRef: string;
	readonly timeoutMs: number;
}): Promise<InnerAtomicCloseReconciliation> {
	const [main, ledger] = await Promise.all([
		input.fetchExactRef(input.remote, "refs/heads/main"),
		input.fetchExactRef(input.remote, input.ledgerRef),
	]);
	// The fetch failure reason distinguishes an unreachable remote from a
	// deadline; both stay "unknown" but callers surface the exact cause.
	if (main.status === "failed") {
		return { outcome: "unknown", reason: main.reason };
	}
	if (ledger.status === "failed") {
		return { outcome: "unknown", reason: ledger.reason };
	}
	// Prove a clean rejection before inspecting objects that may exist only in
	// the originating clone. Exact unchanged tips are the one retryable result.
	if (
		main.commit === input.expectedMainHead &&
		ledger.commit === input.expectedLedgerGeneration
	) {
		return { outcome: "unchanged" };
	}
	const mainAncestry =
		main.commit === input.mainCommit
			? ("ancestor" as const)
			: await inspectAncestry(
					input.runGit,
					input.mainCommit,
					main.commit,
					input.timeoutMs,
				);
	const ledgerAncestry =
		ledger.commit === input.ledgerCommit
			? ("ancestor" as const)
			: await inspectAncestry(
					input.runGit,
					input.ledgerCommit,
					ledger.commit,
					input.timeoutMs,
				);
	if (mainAncestry === "ancestor" && ledgerAncestry === "ancestor") {
		return { outcome: "closed" };
	}
	// Unknown ancestry proves nothing; the outcome stays push_pending rather
	// than escalating a transient local failure to host_contract_breach.
	if (mainAncestry === "timed_out" || ledgerAncestry === "timed_out") {
		return { outcome: "unknown", reason: "timed_out" };
	}
	if (mainAncestry === "failed" || ledgerAncestry === "failed") {
		return { outcome: "unknown", reason: "local_probe_failed" };
	}
	return { outcome: "host_contract_breach" };
}

/** Inner reconciliation outcome keeping the exact unknown cause attached. */
type InnerAtomicCloseReconciliation =
	| { readonly outcome: "closed" | "unchanged" | "host_contract_breach" }
	| {
			readonly outcome: "unknown";
			readonly reason: "remote_unavailable" | "timed_out" | "local_probe_failed";
	  };

function isMatchingReleasePayload(
	value: unknown,
	transactionId: string,
	expectedGeneration: string,
): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		"operation" in value &&
		value.operation === "release" &&
		"previous_generation" in value &&
		value.previous_generation === expectedGeneration &&
		"lease" in value &&
		typeof value.lease === "object" &&
		value.lease !== null &&
		!Array.isArray(value.lease) &&
		"transaction_id" in value.lease &&
		value.lease.transaction_id === transactionId &&
		"state" in value.lease &&
		value.lease.state === "released"
	);
}

/**
 * Create the default shell-free Node subprocess boundary.
 *
 * @returns Process runner that terminates work at the supplied deadline
 * @throws Never; spawn errors are captured as failed process results
 *
 * @example
 * ```typescript
 * const processPort = createNodeProcessPort()
 * await processPort.run({ command: "git", args: ["--version"], cwd: "/tmp", timeoutMs: 1000 })
 * ```
 */
export function createNodeProcessPort(): VaultGitProcessPort {
		return {
			run(request: VaultGitProcessRequest): Promise<VaultGitProcessResult> {
				return new Promise((resolve) => {
					const environment =
						request.environmentMode === "isolated"
							? { ...request.env }
							: { ...scrubbedAmbientEnvironment(), ...request.env };
					const child = spawn(request.command, [...request.args], {
						cwd: request.cwd,
						env: environment,
						stdio: ["pipe", "pipe", "pipe"],
						shell: false,
				});
				const stdout: Buffer[] = [];
				const stderr: Buffer[] = [];
				let stdoutBytes = 0;
				let stderrBytes = 0;
				const capture = (
					sink: Buffer[],
					chunk: Buffer,
					capturedBytes: number,
				): number => {
					const remaining = MAX_CAPTURE_BYTES - capturedBytes;
					if (remaining <= 0) return capturedBytes;
					const accepted = chunk.subarray(0, remaining);
					sink.push(accepted);
					return capturedBytes + accepted.length;
				};
				let timedOut = false;
				let settled = false;
				let deadline: ReturnType<typeof setTimeout> | undefined;
				let forceKill: ReturnType<typeof setTimeout> | undefined;
				const finish = (exitCode: number | null): void => {
					if (settled) return;
					settled = true;
					if (deadline) clearTimeout(deadline);
					if (forceKill) clearTimeout(forceKill);
					resolve({
						exitCode,
						stdout: Buffer.concat(stdout).toString("utf8"),
						stderr: Buffer.concat(stderr).toString("utf8"),
						timedOut,
					});
				};
				child.stdout.on("data", (chunk: Buffer) => {
					stdoutBytes = capture(stdout, chunk, stdoutBytes);
				});
				child.stderr.on("data", (chunk: Buffer) => {
					stderrBytes = capture(stderr, chunk, stderrBytes);
				});
				child.on("error", (error) => {
					stderrBytes = capture(stderr, Buffer.from(error.message), stderrBytes);
					finish(null);
				});
				child.on("close", finish);
				deadline = setTimeout(() => {
					timedOut = true;
					child.kill("SIGTERM");
					forceKill = setTimeout(() => {
						child.kill("SIGKILL");
						// A grandchild holding inherited stdio can keep "close" from
						// ever emitting; bound the wait through the settled guard.
						const fallback = setTimeout(() => finish(null), 1_000);
						fallback.unref?.();
					}, 250);
				}, request.timeoutMs);
				// EPIPE surfaces when the child exits before consuming stdin; an
				// unhandled stream error would crash the process.
				child.stdin.on("error", () => {});
				if (request.stdin === undefined) child.stdin.end();
				else child.stdin.end(request.stdin);
			});
		},
	};
}

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

const CONTROLLED_GIT_ENVIRONMENT = {
	GIT_CONFIG_COUNT: "2",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_KEY_0: "core.hooksPath",
	GIT_CONFIG_KEY_1: "protocol.ext.allow",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_VALUE_0: "/dev/null",
	GIT_CONFIG_VALUE_1: "never",
	GIT_TERMINAL_PROMPT: "0",
	LC_ALL: "C",
} as const;

function classifyRemoteSafetyError(error: unknown):
	| { readonly status: "refused"; readonly reason: "unsafe_remote_configuration" }
	| { readonly status: "failed"; readonly reason: "remote_unavailable" }
	| null {
	if (!(error instanceof VaultGitRemoteSafetyError)) return null;
	return error.kind === "unsafe"
		? { status: "refused", reason: "unsafe_remote_configuration" }
		: { status: "failed", reason: "remote_unavailable" };
}

/**
 * Ambient Git redirection variables (GIT_DIR, GIT_WORK_TREE, GIT_CONFIG_*,
 * GIT_INDEX_FILE, ...) can silently retarget spawned git away from the
 * adapter-owned repository. All Git and SSH transport values must arrive in
 * one explicit process request after adapter construction validates them.
 */
function scrubbedAmbientEnvironment(): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = { ...process.env };
	for (const key of Object.keys(environment)) {
		if (key.startsWith("GIT_") || AMBIENT_SSH_ENVIRONMENT.has(key))
			delete environment[key];
	}
	return environment;
}

const AMBIENT_SSH_ENVIRONMENT = new Set([
	"SSH_AGENT_PID",
	"SSH_ASKPASS",
	"SSH_ASKPASS_REQUIRE",
	"SSH_AUTH_SOCK",
]);

const ADMITTED_GIT_ENVIRONMENT = new Set([
	"GIT_ASKPASS",
	"GIT_SSH",
	"GIT_SSH_COMMAND",
	"GIT_SSH_VARIANT",
	"SSH_ASKPASS",
	"SSH_ASKPASS_REQUIRE",
	"SSH_AUTH_SOCK",
]);

/**
 * `merge-base --is-ancestor` is tri-state: exit 0 proves ancestry, exit 1
 * proves non-ancestry, and a timeout or any other exit proves nothing. Callers
 * must never treat a failure as "not an ancestor" — that misclassifies
 * transient failures as contract breaches.
 */
async function inspectAncestry(
	runGit: (
		args: readonly string[],
		timeoutMs: number,
	) => Promise<VaultGitProcessResult>,
	ancestor: string,
	descendant: string,
	timeoutMs: number,
): Promise<"ancestor" | "not_ancestor" | "failed" | "timed_out"> {
	const result = await runGit(
		["merge-base", "--is-ancestor", ancestor, descendant],
		timeoutMs,
	);
	if (result.timedOut) return "timed_out";
	if (result.exitCode === 0) return "ancestor";
	if (result.exitCode === 1) return "not_ancestor";
	return "failed";
}

async function assertNoConfiguredPushRefspec(
	runGit: (
		args: readonly string[],
		timeoutMs: number,
	) => Promise<VaultGitProcessResult>,
	remote: string,
	timeoutMs: number,
): Promise<void> {
	// url.<base>.pushInsteadOf rewrites the push endpoint away from the
	// fetch/ls-remote endpoint for named and URL-form remotes alike, defeating
	// compare-and-swap observation.
	await refuseConfiguredValue(
		runGit,
		["config", "--get-regexp", "^url\\..*\\.pushinsteadof$"],
		"configured pushInsteadOf rewrites are not accepted for ledger writes",
		timeoutMs,
	);
	// url.<base>.insteadOf silently retargets every transport at connect time,
	// so the URL this adapter validated is not the URL git would contact.
	await refuseConfiguredValue(
		runGit,
		["config", "--get-regexp", "^url\\..*\\.insteadof$"],
		"configured insteadOf rewrites are not accepted for ledger writes",
		timeoutMs,
	);
	// URL-form remotes cannot carry remote.<name>.* configuration; the explicit
	// non-force refspec still constrains the push destination for them.
	if (!/^[A-Za-z0-9._-]+$/.test(remote)) return;
	await refuseConfiguredValue(
		runGit,
		["config", "--get-all", `remote.${remote}.push`],
		"configured push refspecs are not accepted for ledger writes",
		timeoutMs,
	);
	// remote.<name>.pushUrl diverges the push endpoint from the observed
	// fetch endpoint, so the CAS re-read would inspect the wrong remote.
	await refuseConfiguredValue(
		runGit,
		["config", "--get", `remote.${remote}.pushurl`],
		"configured push URLs are not accepted for ledger writes",
		timeoutMs,
	);
}

async function refuseConfiguredValue(
	runGit: (
		args: readonly string[],
		timeoutMs: number,
	) => Promise<VaultGitProcessResult>,
	args: readonly string[],
	refusalMessage: string,
	timeoutMs: number,
): Promise<void> {
	const configured = await runGit(args, timeoutMs);
	if (configured.timedOut)
		throw new Error("timed out while checking configured push redirection");
	if (configured.exitCode === 0 && configured.stdout.trim().length > 0) {
		throw new Error(refusalMessage);
	}
	if (configured.exitCode !== 0 && configured.exitCode !== 1) {
		throw new Error("could not validate configured push redirection");
	}
}

function isMissingLedgerPath(stderr: string): boolean {
	return /does not exist in|exists on disk, but not in/.test(stderr);
}

function normalizeAdmittedGitEnvironment(
	environment: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(environment)) {
		if (
			!ADMITTED_GIT_ENVIRONMENT.has(key) ||
			value.length === 0 ||
			/[\r\n\0]/.test(value)
		) {
			throw new Error("admitted Git environment contains an unsafe entry");
		}
		normalized[key] = value;
	}
	return normalized;
}

function assertLedgerRef(ledgerRef: string): void {
	if (
		ledgerRef !== VAULT_GIT_LEDGER_REF ||
		!ledgerRef.startsWith("refs/heads/") ||
		ledgerRef.includes("*") ||
		ledgerRef.includes(":") ||
		ledgerRef.startsWith("+")
	) {
		throw new Error("ledger destination must be the exact full branch ref");
	}
}

function assertObjectId(objectId: string | null): void {
	if (objectId !== null && !/^[0-9a-f]{40,64}$/.test(objectId)) {
		throw new Error("expected generation must be one complete object id");
	}
}

function assertSafeCommitField(field: string, value: string): void {
	if (value.trim().length === 0 || /[\r\n\0]/.test(value)) {
		throw new Error(`${field} must be one non-empty line`);
	}
}

function requireLocalObject(
	result: VaultGitProcessResult,
	label: string,
): string {
	const objectId = result.stdout.trim();
	if (
		result.timedOut ||
		result.exitCode !== 0 ||
		!/^[0-9a-f]{40,64}$/.test(objectId)
	) {
		throw new Error(`could not construct ${label}`);
	}
	return objectId;
}

function requireObjectId(output: string, label: string): string {
	const objectId = output.trim();
	if (!/^[0-9a-f]{40,64}$/.test(objectId)) {
		throw new Error(`${label} is not one complete object id`);
	}
	return objectId;
}

function literalPathspec(path: string): string {
	return `:(top,literal)${path}`;
}

function unrelatedPathspecs(ownedPaths: readonly string[]): string[] {
	return [
		":(top)",
		...ownedPaths.map((path) => `:(top,exclude,literal)${path}`),
	];
}

function splitNul(output: string): string[] {
	return output.split("\0").filter((entry) => entry.length > 0);
}

interface TreeEntry {
	readonly mode: string;
	readonly objectId: string;
	readonly path: string;
}

async function readIndexEntry(
	runGit: (
		args: readonly string[],
		input?: string,
		env?: Readonly<Record<string, string>>,
	) => Promise<VaultGitProcessResult>,
	path: string,
): Promise<TreeEntry | null> {
	const result = await runGit([
		"ls-files",
		"--stage",
		"-z",
		"--",
		literalPathspec(path),
	]);
	if (result.timedOut) {
		throw new GitProcessTimedOutError(
			"timed out inspecting staged recovery index entry",
		);
	}
	if (result.exitCode !== 0) {
		throw new Error("could not inspect staged recovery index entry");
	}
	const records = splitNul(result.stdout);
	if (records.length === 0) return null;
	if (records.length !== 1) {
		throw new Error("staged recovery index entry is unmerged");
	}
	const record = records[0];
	const separator = record?.indexOf("\t") ?? -1;
	if (separator < 0 || !record) {
		throw new Error("staged recovery index entry is malformed");
	}
	const [mode, objectId, stage] = record.slice(0, separator).split(" ");
	const entryPath = record.slice(separator + 1);
	if (
		!mode ||
		!objectId ||
		!/^[0-9a-f]{40,64}$/.test(objectId) ||
		stage !== "0" ||
		entryPath !== path
	) {
		throw new Error("staged recovery index entry is malformed");
	}
	return { mode, objectId, path: entryPath };
}

async function readTreeEntry(
	runGit: (
		args: readonly string[],
		input?: string,
		env?: Readonly<Record<string, string>>,
	) => Promise<VaultGitProcessResult>,
	treeish: string,
	path: string,
): Promise<TreeEntry | null> {
	const result = await runGit([
		"ls-tree",
		"-z",
		treeish,
		"--",
		literalPathspec(path),
	]);
	if (result.timedOut) {
		throw new GitProcessTimedOutError(
			"timed out inspecting owned path baseline",
		);
	}
	if (result.exitCode !== 0) {
		throw new Error("could not inspect owned path baseline");
	}
	const record = splitNul(result.stdout)[0];
	if (!record) return null;
	const separator = record.indexOf("\t");
	if (separator < 0) throw new Error("owned path tree entry is malformed");
	const [mode, type, objectId] = record.slice(0, separator).split(" ");
	const entryPath = record.slice(separator + 1);
	if (
		!mode ||
		(type !== "blob" && type !== "commit") ||
		!objectId ||
		!/^[0-9a-f]{40,64}$/.test(objectId) ||
		entryPath !== path
	) {
		throw new Error("owned path tree entry is malformed");
	}
	return { mode, objectId, path: entryPath };
}

async function isSafeOwnedPath(
	repositoryPath: string,
	path: string,
): Promise<boolean> {
	// Share the pure Owned Path leaf rule (model.ts) with receipt custody and the
	// remote ledger, then compose the on-disk realpath containment check that only
	// this adapter can perform. A nested or differently-cased `.git` admitted here
	// would be rejected downstream, escaping begin() as a raw throw instead of an
	// owned_path_not_admitted refusal.
	if (!isVaultGitOwnedPathLeaf(path)) {
		return false;
	}
	const segments = path.split("/");
	const root = await realpath(repositoryPath);
	const candidate = resolve(root, path);
	const fromRoot = relative(root, candidate);
	if (fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
		return false;
	}
	let current = root;
	for (const segment of segments.slice(0, -1)) {
		current = resolve(current, segment);
		const metadata = await lstat(current).catch((error: unknown) =>
			isMissingFilesystemEntry(error) ? null : Promise.reject(error),
		);
		if (metadata?.isSymbolicLink()) return false;
		if (metadata === null) break;
	}
	return true;
}

function isMissingFilesystemEntry(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}
