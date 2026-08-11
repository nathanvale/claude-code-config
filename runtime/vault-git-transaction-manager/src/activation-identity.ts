import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { VaultGitProcessPort } from "./ports.ts";

const ACTIVATION_IDENTITY_DOMAIN = "vault-git.activation-identity.v1";
const IDENTITY_OWNER = /^[a-z][a-z0-9-]*$/;
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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
	readonly gitBinaryPath: string;
	readonly sshBinaryPath: string;
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
	readonly sshIdentityPublicKeyPath: string;
	readonly sshKnownHostsPath: string;
}

/** Resolve the exact fail-closed SSH command used by admitted Git operations. */
export async function resolveVaultGitSshTransportEnvironment(
	options: VaultGitSshTransportOptions,
): Promise<Readonly<Record<string, string>>> {
	const [ssh, publicKey, knownHosts] = await Promise.all([
		realpath(options.sshBinaryPath),
		realpath(options.sshIdentityPublicKeyPath),
		realpath(options.sshKnownHostsPath),
	]);
	if (![ssh, publicKey, knownHosts].every(isSingleLine)) {
		throw new Error("activation SSH transport configuration invalid");
	}
	const command = [
		shellWord(ssh),
		"-F /dev/null",
		"-o BatchMode=yes",
		"-o IdentitiesOnly=yes",
		`-o ${shellWord(`IdentityFile=${publicKey}`)}`,
		`-o ${shellWord(`UserKnownHostsFile=${knownHosts}`)}`,
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
		env: { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
		timeoutMs: options.timeoutMs,
	});
	const gitVersionProbe = options.process.run({
		command: options.gitBinaryPath,
		args: ["--version"],
		cwd: options.repositoryPath,
		env: { LC_ALL: "C" },
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
			components: [files.executable.path, files.executable.hash],
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
				files.publicKey.hash,
				files.knownHosts.hash,
			],
		}),
	});
}

interface IdentityFileBinding {
	readonly path: string;
	readonly hash: string;
}

async function resolveIdentityFiles(
	options: ResolveVaultGitActivationIdentitiesOptions,
): Promise<{
	readonly runtime: IdentityFileBinding;
	readonly executable: IdentityFileBinding;
	readonly git: IdentityFileBinding;
	readonly ssh: IdentityFileBinding;
	readonly publicKey: IdentityFileBinding;
	readonly knownHosts: IdentityFileBinding;
}> {
	const [runtime, executable, git, ssh, publicKey, knownHosts] =
		await Promise.all([
			fileBinding(options.runtimeBinaryPath),
			fileBinding(options.executablePath),
			fileBinding(options.gitBinaryPath),
			fileBinding(options.sshBinaryPath),
			fileBinding(options.sshIdentityPublicKeyPath),
			fileBinding(options.sshKnownHostsPath),
		]);
	return { runtime, executable, git, ssh, publicKey, knownHosts };
}

async function fileBinding(path: string): Promise<IdentityFileBinding> {
	const canonical = await realpath(path);
	const bytes = await readFile(canonical);
	return {
		path: canonical,
		hash: createHash("sha256").update(bytes).digest("hex"),
	};
}

async function resolvePrivateStateBinding(
	stateRoot: string,
): Promise<readonly string[]> {
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
			accessible
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
		options.gitBinaryPath,
		options.sshBinaryPath,
		options.sshIdentityPublicKeyPath,
		options.sshKnownHostsPath,
	];
	const valid = [
		paths.every(isAbsolute),
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
