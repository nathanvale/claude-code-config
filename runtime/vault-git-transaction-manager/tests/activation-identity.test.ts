import { spawnSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
	deriveVaultGitActivationIdentity,
	resolveVaultGitActivationIdentities,
	resolveVaultGitSshTransportEnvironment,
	type VaultGitActivationIdentityBindings,
} from "../src/index.ts";
import { createNodeProcessPort } from "../src/git-adapter.ts";
import { createTempDirectoryFixture } from "./temp-directory-fixture.ts";

const tempDirectories = createTempDirectoryFixture();
afterEach(tempDirectories.cleanup);

const bindings = (
	overrides: Partial<VaultGitActivationIdentityBindings> = {},
): VaultGitActivationIdentityBindings => ({
	owner: "runtime",
	components: ["/owner/bin/bun", "hash-a", "1.3.14"],
	...overrides,
});

describe("owner-controlled activation identities", () => {
	test("derives one stable opaque identity and changes for every binding", () => {
		const baseline = deriveVaultGitActivationIdentity(bindings());
		expect(baseline).toMatch(/^runtime:v1:[0-9a-f]{64}$/);
		expect(baseline).not.toContain("/owner/bin/bun");
		expect(deriveVaultGitActivationIdentity(bindings())).toBe(baseline);

		for (const changed of [
			bindings({ owner: "git" }),
			bindings({ components: ["/owner/bin/other", "hash-a", "1.3.14"] }),
			bindings({ components: ["/owner/bin/bun", "hash-b", "1.3.14"] }),
			bindings({ components: ["/owner/bin/bun", "hash-a", "1.3.15"] }),
		]) {
			expect(deriveVaultGitActivationIdentity(changed)).not.toBe(baseline);
		}
	});

	test("resolves remote, host, runtime, executable, private-state, Git, and SSH identities", async () => {
		const fixture = await identityFixture();
		const first = await resolveVaultGitActivationIdentities(fixture.options);
		const second = await resolveVaultGitActivationIdentities(fixture.options);

		expect(second).toEqual(first);
		for (const [name, value] of Object.entries(first)) {
			expect(value, name).toMatch(/^[a-z][a-z0-9-]*:v1:[0-9a-f]{64}$/);
		}
		expect(JSON.stringify(first)).not.toContain(fixture.remote);
		expect(JSON.stringify(first)).not.toContain(fixture.root);

		await writeFile(fixture.executablePath, "changed executable\n");
		const executableChanged = await resolveVaultGitActivationIdentities(
			fixture.options,
		);
		expect(executableChanged.executableIdentity).not.toBe(
			first.executableIdentity,
		);
		expect(executableChanged.remoteIdentity).toBe(first.remoteIdentity);
	});

	test("refuses missing or ambiguous owner-controlled bindings", async () => {
		const fixture = await identityFixture();
		await expect(
			resolveVaultGitActivationIdentities({
				...fixture.options,
				hostId: "",
			}),
		).rejects.toThrow("activation identity configuration invalid");

		git(fixture.repositoryPath, [
			"remote",
			"set-url",
			"--add",
			"origin",
			join(fixture.root, "second.git"),
		]);
		await expect(
			resolveVaultGitActivationIdentities(fixture.options),
		).rejects.toThrow("activation remote identity is ambiguous");
	});

	test("resolves one exact fail-closed SSH execution environment", async () => {
		const fixture = await identityFixture();
		const [ssh, publicKey, knownHosts] = await Promise.all([
			realpath(fixture.options.sshBinaryPath),
			realpath(fixture.options.sshIdentityPublicKeyPath),
			realpath(fixture.options.sshKnownHostsPath),
		]);

		const environment = await resolveVaultGitSshTransportEnvironment({
			sshBinaryPath: fixture.options.sshBinaryPath,
			sshIdentityPublicKeyPath:
				fixture.options.sshIdentityPublicKeyPath,
			sshKnownHostsPath: fixture.options.sshKnownHostsPath,
		});

		expect(environment).toEqual({
			GIT_SSH_COMMAND: [
				`'${ssh}'`,
				"-F /dev/null",
				"-o BatchMode=yes",
				"-o IdentitiesOnly=yes",
				`-o 'IdentityFile=${publicKey}'`,
				`-o 'UserKnownHostsFile=${knownHosts}'`,
				"-o GlobalKnownHostsFile=/dev/null",
				"-o StrictHostKeyChecking=yes",
			].join(" "),
			GIT_SSH_VARIANT: "ssh",
		});
		expect(Object.isFrozen(environment)).toBe(true);
		expect(environment).not.toHaveProperty("SSH_AUTH_SOCK");
		expect(environment).not.toHaveProperty("GIT_ASKPASS");
	});
});

async function identityFixture(): Promise<{
	readonly root: string;
	readonly repositoryPath: string;
	readonly executablePath: string;
	readonly remote: string;
	readonly options: Parameters<typeof resolveVaultGitActivationIdentities>[0];
}> {
	const root = await tempDirectories.create("vault-git-activation-identities-");
	const repositoryPath = join(root, "vault");
	const stateRoot = join(root, "state");
	const remote = join(root, "remote.git");
	const executablePath = join(root, "vault-git.ts");
	const publicKeyPath = join(root, "writer.pub");
	const knownHostsPath = join(root, "known_hosts");
	await mkdir(repositoryPath);
	await mkdir(stateRoot);
	await writeFile(executablePath, "export {};\n");
	await writeFile(publicKeyPath, "ssh-ed25519 fixture-public-key\n");
	await writeFile(knownHostsPath, "example.test ssh-ed25519 fixture-host-key\n");
	git(repositoryPath, ["init", "--initial-branch=main"]);
	git(repositoryPath, ["remote", "add", "origin", remote]);
	return {
		root,
		repositoryPath,
		executablePath,
		remote,
		options: {
			repositoryPath,
			stateRoot,
			remoteName: "origin",
			hostId: "macbook-owner-config",
			runtimeBinaryPath: process.execPath,
			runtimeVersion: Bun.version,
			executablePath,
			gitBinaryPath: "/usr/bin/git",
			sshBinaryPath: "/usr/bin/ssh",
			sshIdentityPublicKeyPath: publicKeyPath,
			sshKnownHostsPath: knownHostsPath,
			process: createNodeProcessPort(),
			timeoutMs: 5_000,
		},
	};
}

function git(cwd: string, args: readonly string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr);
}
