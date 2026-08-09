import { spawn } from "node:child_process";

import { VAULT_GIT_LEDGER_REF } from "./model.ts";
import type {
	VaultGitLedgerAppendRequest,
	VaultGitLedgerAppendResult,
	VaultGitLedgerReadResult,
	VaultGitMainInspection,
	VaultGitProcessPort,
	VaultGitProcessRequest,
	VaultGitProcessResult,
	VaultGitRemotePort,
} from "./ports.ts";

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
			env: { GIT_TERMINAL_PROMPT: "0", ...env },
			timeoutMs,
		});

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

		const fetched = await runGit(
			["fetch", "--no-tags", remote, ledgerRef],
			options.timeouts.fetchMs,
		);
		if (fetched.timedOut) return { status: "failed", reason: "timed_out" };
		if (fetched.exitCode !== 0) {
			return { status: "failed", reason: "remote_unavailable" };
		}
		const generationResult = await runGit(
			["rev-parse", "--verify", "FETCH_HEAD^{commit}"],
			options.timeouts.localMs,
		);
		if (generationResult.exitCode !== 0 || generationResult.timedOut) {
			return {
				status: "failed",
				reason: generationResult.timedOut ? "timed_out" : "remote_unavailable",
			};
		}
		const generation = generationResult.stdout.trim();
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
		return {
			status: "ok",
			head: {
				generation,
				parents: parentsResult.stdout.trim().split(/\s+/).filter(Boolean),
				content:
					contentResult.exitCode === 0 && !contentResult.timedOut
						? contentResult.stdout
						: null,
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
			const fetched = await runGit(
				["fetch", "--no-tags", remote, "refs/heads/main"],
				options.timeouts.fetchMs,
			);
			if (fetched.timedOut) return { status: "failed", reason: "timed_out" };
			if (fetched.exitCode !== 0) {
				return { status: "failed", reason: "remote_unavailable" };
			}
			const remoteHeadResult = await runGit(
				["rev-parse", "--verify", "FETCH_HEAD^{commit}"],
				options.timeouts.localMs,
			);
			if (remoteHeadResult.exitCode !== 0 || remoteHeadResult.timedOut) {
				return {
					status: "failed",
					reason: remoteHeadResult.timedOut
						? "timed_out"
						: "remote_unavailable",
				};
			}
			const remoteHead = remoteHeadResult.stdout.trim();
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
			if (pushed.exitCode === 0)
				return { status: "appended", generation: commit };

			const current = await readLedger(request.remote, request.ledgerRef);
			if (current.status === "ok" && current.head?.generation === commit) {
				return { status: "appended", generation: commit };
			}
			if (
				current.status === "ok" &&
				current.head?.generation !== request.expectedGeneration
			) {
				return { status: "refused", reason: "remote_moved" };
			}
			if (current.status === "ok") {
				return {
					status: "refused",
					reason: pushed.timedOut ? "timed_out" : "remote_unavailable",
				};
			}
			return { status: "refused", reason: "remote_state_unknown" };
		},
	};
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
					env: { ...process.env, ...request.env },
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
					forceKill = setTimeout(() => child.kill("SIGKILL"), 250);
				}, request.timeoutMs);
				if (request.stdin === undefined) child.stdin.end();
				else child.stdin.end(request.stdin);
			});
		},
	};
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
	if (!/^[A-Za-z0-9._-]+$/.test(remote)) return;
	const configured = await runGit(
		["config", "--get-all", `remote.${remote}.push`],
		timeoutMs,
	);
	if (configured.timedOut)
		throw new Error("timed out while checking configured push refspecs");
	if (configured.exitCode === 0 && configured.stdout.trim().length > 0) {
		throw new Error(
			"configured push refspecs are not accepted for ledger writes",
		);
	}
	if (configured.exitCode !== 0 && configured.exitCode !== 1) {
		throw new Error("could not validate configured push refspecs");
	}
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
