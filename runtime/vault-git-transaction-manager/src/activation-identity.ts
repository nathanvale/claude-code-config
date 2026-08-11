import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { VaultGitProcessPort } from "./ports.ts";

const ACTIVATION_IDENTITY_DOMAIN = "vault-git.activation-identity.v1";
const IDENTITY_OWNER = /^[a-z][a-z0-9-]*$/;
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
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

/** Exact non-secret bindings for one owner-controlled activation identity. */
export interface VaultGitActivationIdentityBindings {
	/** Closed identity namespace rendered in the opaque result prefix. */
	readonly owner: string;
	/** Ordered canonical values whose exact bytes define the identity. */
	readonly components: readonly string[];
}

/** Owner-controlled inputs required to resolve every activation identity. */
export interface ResolveVaultGitActivationIdentitiesOptions {
	readonly repositoryPath: string;
	readonly stateRoot: string;
	readonly remoteName: string;
	readonly hostId: string;
	readonly runtimeBinaryPath: string;
	readonly runtimeVersion: string;
	readonly executablePath: string;
	/** Exact source closure executed by the production entrypoint. */
	readonly executableSourcePaths?: readonly string[];
	readonly gitBinaryPath: string;
	readonly sshBinaryPath: string;
	readonly sshIdentityFilePath: string;
	readonly sshIdentityPublicKeyPath: string;
	readonly sshKnownHostsPath: string;
	readonly process: VaultGitProcessPort;
	readonly timeoutMs: number;
}

/** Opaque identity set required by V2 prepared evidence. */
export interface ResolvedVaultGitActivationIdentities {
	readonly remoteIdentity: string;
	readonly hostIdentity: string;
	readonly runtimeIdentity: string;
	readonly executableIdentity: string;
	readonly privateStateIdentity: string;
	readonly gitIdentity: string;
	readonly sshIdentity: string;
}

/** Exact SSH assets used to build the admitted Git transport closure. */
export interface VaultGitSshTransportOptions {
	readonly sshBinaryPath: string;
	readonly sshIdentityFilePath: string;
	readonly sshIdentityPublicKeyPath: string;
	readonly sshKnownHostsPath: string;
}

/** Resolve the exact fail-closed SSH command used by admitted Git operations. */
export async function resolveVaultGitSshTransportEnvironment(
	options: VaultGitSshTransportOptions,
): Promise<Readonly<Record<string, string>>> {
	const [ssh, privateKey, publicKey, knownHosts] = await Promise.all([
		realpath(options.sshBinaryPath),
		resolvePrivateKeyPath(options.sshIdentityFilePath),
		realpath(options.sshIdentityPublicKeyPath),
		resolveKnownHostsBinding(options.sshKnownHostsPath),
	]);
	if (![ssh, privateKey, publicKey, knownHosts.path].every(isSingleLine)) {
		throw new Error("activation SSH transport configuration invalid");
	}
	const command = [
		shellWord(ssh),
		"-F /dev/null",
		"-o BatchMode=yes",
		"-o IdentitiesOnly=yes",
		`-o ${shellWord(`IdentityFile=${privateKey}`)}`,
		`-o ${shellWord(`UserKnownHostsFile=${knownHosts.path}`)}`,
		"-o GlobalKnownHostsFile=/dev/null",
		"-o StrictHostKeyChecking=yes",
	].join(" ");
	return Object.freeze({
		GIT_SSH_COMMAND: command,
		GIT_SSH_VARIANT: "ssh",
	});
}

/**
 * Derive one versioned identity without exposing its owner-controlled values.
 *
 * @param bindings - Closed namespace and ordered canonical values
 * @returns Opaque SHA-256 identity
 */
export function deriveVaultGitActivationIdentity(
	bindings: VaultGitActivationIdentityBindings,
): string {
	const valid = [
		IDENTITY_OWNER.test(bindings.owner),
		bindings.components.length > 0,
		bindings.components.every(isSingleLine),
	].every(Boolean);
	if (!valid) {
		throw new Error("activation identity configuration invalid");
	}
	const digest = createHash("sha256")
		.update(ACTIVATION_IDENTITY_DOMAIN)
		.update("\0")
		.update(bindings.owner)
		.update("\0")
		.update(bindings.components.join("\0"))
		.update("\0");
	return `${bindings.owner}:v1:${digest.digest("hex")}`;
}

/**
 * Resolve every non-vault V2 identity from exact owner-controlled inputs.
 *
 * @param options - Configured remote, host, executable, state, Git, and SSH inputs
 * @returns Opaque identities with no paths, remotes, or key material
 */
export async function resolveVaultGitActivationIdentities(
	options: ResolveVaultGitActivationIdentitiesOptions,
): Promise<ResolvedVaultGitActivationIdentities> {
	validateConfiguration(options);
	const remoteProbe = options.process.run({
		command: options.gitBinaryPath,
		args: ["remote", "get-url", "--all", options.remoteName],
		cwd: options.repositoryPath,
		env: CONTROLLED_GIT_ENVIRONMENT,
		timeoutMs: options.timeoutMs,
	});
	const gitVersionProbe = options.process.run({
		command: options.gitBinaryPath,
		args: ["--version"],
		cwd: options.repositoryPath,
		env: CONTROLLED_GIT_ENVIRONMENT,
		timeoutMs: options.timeoutMs,
	});
	const [remoteResult, gitVersionResult, files, privateState] =
		await Promise.all([
			remoteProbe,
			gitVersionProbe,
			resolveIdentityFiles(options),
			resolvePrivateStateBinding(options.stateRoot),
		]);
	const remote = exactRemote(remoteResult);
	if (gitVersionResult.timedOut || gitVersionResult.exitCode !== 0) {
		throw new Error("activation identity configuration invalid");
	}
	return Object.freeze({
		remoteIdentity: deriveVaultGitActivationIdentity({
			owner: "remote",
			components: [options.remoteName, remote],
		}),
		hostIdentity: deriveVaultGitActivationIdentity({
			owner: "host",
			components: [options.hostId],
		}),
		runtimeIdentity: deriveVaultGitActivationIdentity({
			owner: "runtime",
			components: [
				files.runtime.path,
				files.runtime.hash,
				options.runtimeVersion,
			],
		}),
		executableIdentity: deriveVaultGitActivationIdentity({
			owner: "executable",
			components: files.executable.flatMap((binding) => [
				binding.path,
				binding.hash,
			]),
		}),
		privateStateIdentity: deriveVaultGitActivationIdentity({
			owner: "private-state",
			components: privateState,
		}),
		gitIdentity: deriveVaultGitActivationIdentity({
			owner: "git",
			components: [
				files.git.path,
				files.git.hash,
				gitVersionResult.stdout.trim(),
			],
		}),
		sshIdentity: deriveVaultGitActivationIdentity({
			owner: "ssh",
			components: [
				files.ssh.path,
				files.ssh.hash,
				files.privateKey.path,
				...files.privateKey.metadata,
				files.publicKey.hash,
				files.knownHosts.path,
				...files.knownHosts.metadata,
			],
		}),
	});
}

interface IdentityFileBinding {
	readonly path: string;
	readonly hash: string;
}

interface OwnerOnlyFileBinding {
	readonly path: string;
	readonly metadata: readonly string[];
}

async function resolveIdentityFiles(
	options: ResolveVaultGitActivationIdentitiesOptions,
): Promise<{
	readonly runtime: IdentityFileBinding;
	readonly executable: readonly IdentityFileBinding[];
	readonly git: IdentityFileBinding;
	readonly ssh: IdentityFileBinding;
	readonly privateKey: OwnerOnlyFileBinding;
	readonly publicKey: IdentityFileBinding;
	readonly knownHosts: OwnerOnlyFileBinding;
}> {
	const [runtime, executable, git, ssh, privateKey, publicKey, knownHosts] =
		await Promise.all([
			fileBinding(options.runtimeBinaryPath),
			executableBindings(options),
			fileBinding(options.gitBinaryPath),
			fileBinding(options.sshBinaryPath),
			resolvePrivateKeyBinding(options.sshIdentityFilePath),
			fileBinding(options.sshIdentityPublicKeyPath),
			resolveKnownHostsBinding(options.sshKnownHostsPath),
		]);
	return { runtime, executable, git, ssh, privateKey, publicKey, knownHosts };
}

async function resolvePrivateKeyPath(path: string): Promise<string> {
	return (await resolvePrivateKeyBinding(path)).path;
}

async function resolveKnownHostsBinding(
	path: string,
): Promise<OwnerOnlyFileBinding> {
	return resolveOwnerOnlyFileBinding(
		path,
		"activation SSH known-hosts configuration invalid",
		(metadata) => (metadata.mode & 0o777n) === 0o600n,
	);
}

async function resolvePrivateKeyBinding(
	path: string,
): Promise<OwnerOnlyFileBinding> {
	return resolveOwnerOnlyFileBinding(
		path,
		"activation SSH private identity configuration invalid",
		isOwnerOnlyRegularFile,
	);
}

async function resolveOwnerOnlyFileBinding(
	path: string,
	message: string,
	validMode: (metadata: BigIntStats) => boolean,
): Promise<OwnerOnlyFileBinding> {
	const configured = await lstat(path, { bigint: true });
	if (!isRegularNonSymlink(configured) || !validMode(configured)) {
		throw new Error(message);
	}
	const uid = process.getuid?.();
	if (uid !== undefined && configured.uid !== BigInt(uid)) {
		throw new Error(message);
	}
	const canonical = await realpath(path);
	const metadata = await lstat(canonical, { bigint: true });
	if (
		!isRegularNonSymlink(metadata) ||
		!validMode(metadata) ||
		metadata.dev !== configured.dev ||
		metadata.ino !== configured.ino ||
		(uid !== undefined && metadata.uid !== BigInt(uid))
	) {
		throw new Error(message);
	}
	return {
		path: canonical,
		metadata: [
			metadata.dev.toString(10),
			metadata.ino.toString(10),
			metadata.mode.toString(8),
			metadata.uid.toString(10),
			metadata.gid.toString(10),
			metadata.size.toString(10),
			metadata.mtimeNs.toString(10),
			metadata.ctimeNs.toString(10),
		],
	};
}

function isOwnerOnlyRegularFile(metadata: BigIntStats): boolean {
	return (
		(metadata.mode & 0o077n) === 0n &&
		(metadata.mode & 0o400n) !== 0n
	);
}

function isRegularNonSymlink(metadata: BigIntStats): boolean {
	return !metadata.isSymbolicLink() && metadata.isFile();
}

async function fileBinding(path: string): Promise<IdentityFileBinding> {
	const canonical = await realpath(path);
	const bytes = await readFile(canonical);
	return {
		path: canonical,
		hash: createHash("sha256").update(bytes).digest("hex"),
	};
}

async function executableBindings(
	options: ResolveVaultGitActivationIdentitiesOptions,
): Promise<readonly IdentityFileBinding[]> {
	const sourcePaths = options.executableSourcePaths ?? [options.executablePath];
	if (sourcePaths.length === 0) {
		throw new Error("activation executable source closure invalid");
	}
	const [entrypoint, ...bindings] = await Promise.all([
		realpath(options.executablePath),
		...sourcePaths.map(fileBinding),
	]);
	bindings.sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
	);
	if (
		!bindings.some((binding) => binding.path === entrypoint) ||
		new Set(bindings.map((binding) => binding.path)).size !== bindings.length
	) {
		throw new Error("activation executable source closure invalid");
	}
	return bindings;
}

async function resolvePrivateStateBinding(
	stateRoot: string,
): Promise<readonly string[]> {
	// lstat the configured path BEFORE realpath: realpath resolves every symlink,
	// so lstat on the resolved path can never observe one. A symlinked state root
	// must be refused, not silently bound to the link target's inode.
	const link = await lstat(stateRoot, { bigint: true });
	if (link.isSymbolicLink()) {
		throw new Error("activation identity configuration invalid");
	}
	const canonical = await realpath(stateRoot);
	const metadata = await lstat(canonical, { bigint: true });
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error("activation identity configuration invalid");
	}
	return [
		canonical,
		metadata.dev.toString(10),
		metadata.ino.toString(10),
	];
}

function exactRemote(result: {
	readonly timedOut: boolean;
	readonly exitCode: number | null;
	readonly stdout: string;
}): string {
	const remotes = result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
	const accessible = [!result.timedOut, result.exitCode === 0].every(Boolean);
	const exact = [
		accessible,
		remotes.length === 1,
		isSingleLine(remotes[0] ?? ""),
	].every(Boolean);
	if (!exact) {
		throw new Error(
			accessible && remotes.length > 0
				? "activation remote identity is ambiguous"
				: "activation remote identity is missing",
		);
	}
	return remotes[0] as string;
}

function validateConfiguration(
	options: ResolveVaultGitActivationIdentitiesOptions,
): void {
	const paths = [
		options.repositoryPath,
		options.stateRoot,
		options.runtimeBinaryPath,
		options.executablePath,
		...(options.executableSourcePaths ?? []),
		options.gitBinaryPath,
		options.sshBinaryPath,
		options.sshIdentityFilePath,
		options.sshIdentityPublicKeyPath,
		options.sshKnownHostsPath,
	];
	const valid = [
		paths.every(isAbsolute),
		options.executableSourcePaths === undefined ||
			options.executableSourcePaths.length > 0,
		REMOTE_NAME.test(options.remoteName),
		isSingleLine(options.hostId),
		isSingleLine(options.runtimeVersion),
		Number.isSafeInteger(options.timeoutMs),
		options.timeoutMs > 0,
	].every(Boolean);
	if (!valid) {
		throw new Error("activation identity configuration invalid");
	}
}

function isSingleLine(value: string): boolean {
	return value.trim().length > 0 && !/[\r\n\0]/.test(value);
}

function shellWord(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}
