import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";

import type { VaultGitProcessPort, VaultGitProcessResult } from "./ports.ts";

const REPOSITORY_IDENTITY_DOMAIN = "vault-git.repository-identity.v1";

/** Canonical local bindings that distinguish one configured vault checkout. */
export interface VaultRepositoryIdentityBindings {
	/** Canonical real path of the configured repository root. */
	readonly repositoryRoot: string;
	/** Canonical real path of the repository's Git common directory. */
	readonly gitCommonDirectory: string;
	/** Decimal filesystem device identity of the Git common directory. */
	readonly gitCommonDirectoryDevice: string;
	/** Decimal filesystem inode identity of the Git common directory. */
	readonly gitCommonDirectoryInode: string;
}

/** Production inputs for resolving one configured vault checkout identity. */
export interface ResolveVaultRepositoryIdentityOptions {
	/** Configured repository root before canonicalization. */
	readonly repositoryPath: string;
	/** Shell-free process adapter used for bounded Git discovery. */
	readonly process: VaultGitProcessPort;
	/** Hard deadline for each Git identity probe. */
	readonly timeoutMs: number;
	/** Optional Git executable override for qualification fixtures. */
	readonly gitBinary?: string;
}

/** Canonical configured-vault identity and the bindings that produced it. */
export interface ResolvedVaultRepositoryIdentity
	extends VaultRepositoryIdentityBindings {
	/** Versioned non-secret identity bound to owner-private runtime state. */
	readonly identity: string;
}

/**
 * Derive the opaque non-secret identity used to bind private vault state.
 *
 * @param bindings - Canonical repository root and Git common directory
 * @returns Versioned SHA-256 identity without exposing either local path
 *
 * @example
 * ```typescript
 * const identity = deriveVaultRepositoryIdentity({
 *   repositoryRoot: "/srv/vault",
 *   gitCommonDirectory: "/srv/vault/.git",
 *   gitCommonDirectoryDevice: "42",
 *   gitCommonDirectoryInode: "84",
 * })
 * ```
 */
export function deriveVaultRepositoryIdentity(
	bindings: VaultRepositoryIdentityBindings,
): string {
	const digest = createHash("sha256")
		.update(REPOSITORY_IDENTITY_DOMAIN)
		.update("\0")
		.update(bindings.repositoryRoot)
		.update("\0")
		.update(bindings.gitCommonDirectory)
		.update("\0")
		.update(bindings.gitCommonDirectoryDevice)
		.update("\0")
		.update(bindings.gitCommonDirectoryInode)
		.update("\0")
		.digest("hex");
	return `vault-git:v1:${digest}`;
}

/**
 * Resolve and derive one configured vault checkout identity through real Git.
 *
 * @param options - Configured root, bounded process adapter, and deadline
 * @returns Canonical root, Git common directory, and their opaque identity
 * @throws {Error} When Git cannot prove the configured canonical repository
 *
 * @example
 * ```typescript
 * const resolved = await resolveVaultRepositoryIdentity({
 *   repositoryPath: vaultRoot,
 *   process: createNodeProcessPort(),
 *   timeoutMs: 5_000,
 * })
 * ```
 */
export async function resolveVaultRepositoryIdentity(
	options: ResolveVaultRepositoryIdentityOptions,
): Promise<ResolvedVaultRepositoryIdentity> {
	const gitBinary = options.gitBinary ?? "git";
	const runGit = (args: readonly string[]) =>
		options.process.run({
			command: gitBinary,
			args,
			cwd: options.repositoryPath,
			env: { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
			timeoutMs: options.timeoutMs,
		});
	const [repositoryRoot, discoveredRootResult, commonDirectoryResult] =
		await Promise.all([
			realpath(options.repositoryPath),
			runGit(["rev-parse", "--show-toplevel"]),
			runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
		]);
	const [discoveredRoot, gitCommonDirectory] = await Promise.all([
		realpath(successfulProbeOutput(discoveredRootResult)),
		realpath(successfulProbeOutput(commonDirectoryResult)),
	]);
	if (discoveredRoot !== repositoryRoot) {
		throw new Error("configured repository root is not canonical");
	}
	const gitCommonDirectoryMetadata = await lstat(gitCommonDirectory, {
		bigint: true,
	});
	const gitCommonDirectoryDevice =
		gitCommonDirectoryMetadata.dev.toString(10);
	const gitCommonDirectoryInode =
		gitCommonDirectoryMetadata.ino.toString(10);
	return {
		identity: deriveVaultRepositoryIdentity({
			repositoryRoot,
			gitCommonDirectory,
			gitCommonDirectoryDevice,
			gitCommonDirectoryInode,
		}),
		repositoryRoot,
		gitCommonDirectory,
		gitCommonDirectoryDevice,
		gitCommonDirectoryInode,
	};
}

function successfulProbeOutput(result: VaultGitProcessResult): string {
	if (result.timedOut || result.exitCode !== 0) {
		throw new Error("configured repository identity could not be resolved");
	}
	return result.stdout.trim();
}
