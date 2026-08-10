import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

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
					env: { ...scrubbedAmbientEnvironment(), ...request.env },
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
	const isRemoteName = /^[A-Za-z0-9._-]+$/.test(remote);
	const isApprovedUrl = /^(?:https?|ssh|git|file):\/\/[^\s]+$/.test(remote);
	const isAbsolutePath = /^\/[^\r\n\0]*$/.test(remote);
	const isScpLike = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:[^:\s][^\s]*$/.test(
		remote,
	);
	if (
		remote.trim().length === 0 ||
		remote.startsWith("-") ||
		/[\r\n\0]/.test(remote) ||
		!(isRemoteName || isApprovedUrl || isAbsolutePath || isScpLike)
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
