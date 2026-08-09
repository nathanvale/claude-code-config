import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, realpath, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
	VAULT_GIT_LEDGER_REF,
	type VaultGitUnrelatedStateSnapshot,
} from "./model.ts";
import type {
	VaultGitLedgerAppendRequest,
	VaultGitLedgerAppendResult,
	VaultGitLedgerReadResult,
	VaultGitCheckPort,
	VaultGitMainInspection,
	VaultGitOwnedPathInspection,
	VaultGitProcessPort,
	VaultGitProcessRequest,
	VaultGitProcessResult,
	VaultGitRepositoryPort,
	VaultGitRemotePort,
} from "./ports.ts";

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
			env: { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", ...env },
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

	const readLedger = async (
		remote: string,
		ledgerRef: string,
	): Promise<VaultGitLedgerReadResult> => {
		assertSafeRemote(remote);
		assertLedgerRef(ledgerRef);
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
		async inspectMain(remote): Promise<VaultGitMainInspection> {
			assertSafeRemote(remote);
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
			if (
				await isAncestor(
					runGit,
					localHead,
					remoteHead,
					options.timeouts.localMs,
				)
			) {
				return { status: "ok", alignment: "behind", localHead, remoteHead };
			}
			if (
				await isAncestor(
					runGit,
					remoteHead,
					localHead,
					options.timeouts.localMs,
				)
			) {
				return { status: "ok", alignment: "ahead", localHead, remoteHead };
			}
			return { status: "ok", alignment: "diverged", localHead, remoteHead };
		},

		readLedger,

		async appendLedgerCommit(
			request: VaultGitLedgerAppendRequest,
		): Promise<VaultGitLedgerAppendResult> {
			assertSafeRemote(request.remote);
			assertLedgerRef(request.ledgerRef);
			assertObjectId(request.expectedGeneration);
			assertSafeCommitField("author", request.author);
			assertSafeCommitField("message", request.message);
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
			if (pushed.timedOut) {
				// A timed-out push may still land after this re-read observed the
				// old generation; the remote outcome remains unknown.
				return { status: "refused", reason: "timed_out" };
			}
			if (
				current.status === "ok" &&
				(current.head?.generation ?? null) !== request.expectedGeneration
			) {
				return { status: "refused", reason: "remote_moved" };
			}
			if (current.status === "ok") {
				return { status: "refused", reason: "remote_unavailable" };
			}
			return { status: "refused", reason: "remote_state_unknown" };
		},

		async atomicClose(request) {
			assertSafeRemote(request.remote);
			assertLedgerRef(request.ledgerRef);
			assertObjectId(request.expectedMainHead);
			assertObjectId(request.mainCommit);
			assertObjectId(request.expectedLedgerGeneration);
			assertSafeCommitField("author", request.author);
			assertSafeCommitField("message", request.ledgerMessage);
			await assertNoConfiguredPushRefspec(
				runGit,
				request.remote,
				options.timeouts.localMs,
			);
			const mainParent = await runGit(
				["show", "-s", "--format=%P", request.mainCommit],
				options.timeouts.localMs,
			);
			if (
				mainParent.timedOut ||
				mainParent.exitCode !== 0 ||
				mainParent.stdout.trim().split(/\s+/).filter(Boolean)[0] !==
					request.expectedMainHead
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
			const pushed = await runGit(
				[
					"push",
					"--atomic",
					"--porcelain",
					"--no-verify",
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
			if (reconciled === "closed") {
				return { status: "closed", mainCommit: request.mainCommit, ledgerCommit };
			}
			if (reconciled === "host_contract_breach") {
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
	};
}

/** Construction input for the production admission and exact-commit adapter. */
export interface VaultGitRepositoryAdapterOptions extends VaultGitAdapterOptions {
	/** Stable non-secret configured-vault identity. */
	readonly repositoryIdentity: string;
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
			env: { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", ...env },
			timeoutMs: options.timeouts.localMs,
		});

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
		if (
			status.timedOut ||
			index.timedOut ||
			status.exitCode !== 0 ||
			index.exitCode !== 0
		) {
			throw new Error("could not capture unrelated repository state");
		}
		return {
			statusHex: Buffer.from(status.stdout, "utf8").toString("hex"),
			indexHex: Buffer.from(index.stdout, "utf8").toString("hex"),
		};
	};

	return {
		async resolveCanonicalIdentity() {
			const [configuredRoot, discoveredRoot, main] = await Promise.all([
				realpath(options.repositoryPath),
				runGit(["rev-parse", "--show-toplevel"]),
				runGit(["rev-parse", "--verify", "refs/heads/main^{commit}"]),
			]);
			if (
				discoveredRoot.timedOut ||
				main.timedOut ||
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
			if (
				unrelated.statusHex !== request.unrelatedState.statusHex ||
				unrelated.indexHex !== request.unrelatedState.indexHex
			) {
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
				const separator = proof.stdout.indexOf("\n\n");
				const headers = proof.stdout.slice(0, separator).split("\n");
				const provedTree = headers.find((header) => header.startsWith("tree "))?.slice(5);
				const provedParents = headers
					.filter((header) => header.startsWith("parent "))
					.map((header) => header.slice(7));
				const provedMessage = proof.stdout.slice(separator + 2);
				if (
					proof.timedOut ||
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
				for (const ownedPath of request.ownedPaths) {
					const entry = await readTreeEntry(runGit, treeId, ownedPath.path);
					const indexInfo = entry
						? `${entry.mode} ${entry.objectId}\t${entry.path}\0`
						: `0 ${"0".repeat(40)}\t${ownedPath.path}\0`;
					const updated = await runGit(
						["update-index", "-z", "--index-info"],
						indexInfo,
					);
					if (updated.timedOut || updated.exitCode !== 0) {
						throw new Error("local main advanced but owned index update failed");
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
}): Promise<"closed" | "unchanged" | "unknown" | "host_contract_breach"> {
	const [main, ledger] = await Promise.all([
		input.fetchExactRef(input.remote, "refs/heads/main"),
		input.fetchExactRef(input.remote, input.ledgerRef),
	]);
	if (main.status === "failed" || ledger.status === "failed") return "unknown";
	const mainExpected =
		main.commit === input.mainCommit ||
		(await isAncestor(
			input.runGit,
			input.mainCommit,
			main.commit,
			input.timeoutMs,
		));
	const ledgerExpected =
		ledger.commit === input.ledgerCommit ||
		(await isAncestor(
			input.runGit,
			input.ledgerCommit,
			ledger.commit,
			input.timeoutMs,
		));
	if (mainExpected && ledgerExpected) return "closed";
	if (
		main.commit === input.expectedMainHead &&
		ledger.commit === input.expectedLedgerGeneration
	) {
		return "unchanged";
	}
	return "host_contract_breach";
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
				const child = spawn(request.command, [...request.args], {
					cwd: request.cwd,
					env: { ...scrubbedAmbientEnvironment(), ...request.env },
					stdio: ["pipe", "pipe", "pipe"],
					shell: false,
				});
				const stdout: Buffer[] = [];
				const stderr: Buffer[] = [];
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
				child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
				child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
				child.on("error", (error) => {
					stderr.push(Buffer.from(error.message));
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

/**
 * Ambient Git redirection variables (GIT_DIR, GIT_WORK_TREE, GIT_CONFIG_*,
 * GIT_INDEX_FILE, ...) can silently retarget spawned git away from the
 * adapter-owned repository; only transport-auth and prompt variables survive.
 */
const PRESERVED_GIT_ENVIRONMENT = new Set([
	"GIT_TERMINAL_PROMPT",
	"GIT_SSH",
	"GIT_SSH_COMMAND",
	"GIT_ASKPASS",
	"GIT_CONFIG_NOSYSTEM",
]);

function scrubbedAmbientEnvironment(): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = { ...process.env };
	for (const key of Object.keys(environment)) {
		if (key.startsWith("GIT_") && !PRESERVED_GIT_ENVIRONMENT.has(key)) {
			delete environment[key];
		}
	}
	return environment;
}

async function isAncestor(
	runGit: (
		args: readonly string[],
		timeoutMs: number,
	) => Promise<VaultGitProcessResult>,
	ancestor: string,
	descendant: string,
	timeoutMs: number,
): Promise<boolean> {
	const result = await runGit(
		["merge-base", "--is-ancestor", ancestor, descendant],
		timeoutMs,
	);
	return result.exitCode === 0 && !result.timedOut;
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

function assertSafeRemote(remote: string): void {
	if (
		remote.trim().length === 0 ||
		remote.startsWith("-") ||
		/[\r\n\0]/.test(remote)
	) {
		throw new Error("remote must be one safe Git remote name or URL");
	}
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
	if (result.timedOut || result.exitCode !== 0) {
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
	if (
		path.length === 0 ||
		isAbsolute(path) ||
		/[\0\r]/.test(path) ||
		path.endsWith("/")
	) {
		return false;
	}
	const segments = path.split("/");
	if (
		segments[0] === ".git" ||
		segments.some(
			(segment) => segment.length === 0 || segment === "." || segment === "..",
		)
	) {
		return false;
	}
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
