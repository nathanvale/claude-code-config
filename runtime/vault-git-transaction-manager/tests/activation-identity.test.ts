import { spawnSync } from "node:child_process";
import {
	chmod,
	mkdir,
	readFile,
	realpath,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
	deriveVaultGitActivationIdentity,
	resolveVaultGitActivationIdentities,
	resolveVaultGitSshTransportEnvironment,
	type VaultGitActivationIdentityBindings,
} from "../src/index.ts";
import { VAULT_GIT_PRODUCTION_EXECUTABLE_SOURCE_PATHS } from "../src/cli.ts";
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

	test("keeps the explicit production closure equal to its local runtime graph", async () => {
		const packageRoot = resolve(import.meta.dir, "..");
		const facadeRoot = resolve(packageRoot, "../cli-command-facade");
		const sources = await reachableLocalSources([
			join(packageRoot, "src", "cli.ts"),
			join(packageRoot, "src", "activation-result.ts"),
			join(packageRoot, "src", "branch-station-catalog.ts"),
			join(facadeRoot, "src", "index.ts"),
		]);
		const expected = [
			...sources,
			join(packageRoot, "package.json"),
			join(facadeRoot, "package.json"),
			resolve(packageRoot, "../../bun.lock"),
		].sort();

		expect(VAULT_GIT_PRODUCTION_EXECUTABLE_SOURCE_PATHS).toEqual(expected);
		expect(expected).not.toContain(
			join(packageRoot, "src", "activation-consumer-fixtures.ts"),
		);
		expect(expected).not.toContain(join(packageRoot, "src", "index.ts"));
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

		await writeFile(fixture.executableDependencyPath, "changed dependency\n");
		const dependencyChanged = await resolveVaultGitActivationIdentities(
			fixture.options,
		);
		expect(dependencyChanged.executableIdentity).not.toBe(
			executableChanged.executableIdentity,
		);
		expect(dependencyChanged.remoteIdentity).toBe(first.remoteIdentity);

		await writeFile(fixture.workspaceDependencyPath, "changed workspace runtime\n");
		const workspaceDependencyChanged =
			await resolveVaultGitActivationIdentities(fixture.options);
		expect(workspaceDependencyChanged.executableIdentity).not.toBe(
			dependencyChanged.executableIdentity,
		);

		await writeFile(
			fixture.options.sshIdentityPublicKeyPath,
			"ssh-ed25519 changed-public-key\n",
		);
		const publicKeyChanged = await resolveVaultGitActivationIdentities(
			fixture.options,
		);
		expect(publicKeyChanged.sshIdentity).not.toBe(first.sshIdentity);

		await writeFile(
			fixture.options.sshIdentityFilePath,
			"changed private identity\n",
		);
		const privateKeyChanged = await resolveVaultGitActivationIdentities(
			fixture.options,
		);
		expect(privateKeyChanged.sshIdentity).not.toBe(
			publicKeyChanged.sshIdentity,
		);
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

	test("reports a successful empty remote probe as missing", async () => {
		const fixture = await identityFixture();
		const processPort = createNodeProcessPort();

		await expect(
			resolveVaultGitActivationIdentities({
				...fixture.options,
				process: {
					run(request) {
						if (
							request.args.join("\0") ===
							["remote", "get-url", "--all", "origin"].join("\0")
						) {
							return Promise.resolve({
								exitCode: 0,
								stdout: "",
								stderr: "",
								timedOut: false,
							});
						}
						return processPort.run(request);
					},
				},
			}),
		).rejects.toThrow("activation remote identity is missing");
	});

	test("runs both Git identity probes with the controlled Git environment", async () => {
		const fixture = await identityFixture();
		const processPort = createNodeProcessPort();
		const environments: Readonly<Record<string, string>>[] = [];

		await resolveVaultGitActivationIdentities({
			...fixture.options,
			process: {
				run(request) {
					environments.push(request.env ?? {});
					return processPort.run(request);
				},
			},
		});

		expect(environments).toHaveLength(2);
		for (const environment of environments) {
			expect(environment).toEqual({
				GIT_CONFIG_COUNT: "2",
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_KEY_0: "core.hooksPath",
				GIT_CONFIG_KEY_1: "protocol.ext.allow",
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_VALUE_0: "/dev/null",
				GIT_CONFIG_VALUE_1: "never",
				GIT_TERMINAL_PROMPT: "0",
				LC_ALL: "C",
			});
		}
	});

	test("refuses a private state root that is itself a symlink", async () => {
		const fixture = await identityFixture();
		const target = join(fixture.root, "real-state");
		const linkedStateRoot = join(fixture.root, "linked-state");
		await mkdir(target);
		await symlink(target, linkedStateRoot);

		await expect(
			resolveVaultGitActivationIdentities({
				...fixture.options,
				stateRoot: linkedStateRoot,
			}),
		).rejects.toThrow("activation identity configuration invalid");
	});

	test("refuses an SSH private identity readable outside its owner", async () => {
		const fixture = await identityFixture();
		await chmod(fixture.options.sshIdentityFilePath, 0o644);

		await expect(
			resolveVaultGitActivationIdentities(fixture.options),
		).rejects.toThrow("activation SSH private identity configuration invalid");
		await expect(
			resolveVaultGitSshTransportEnvironment({
				sshBinaryPath: fixture.options.sshBinaryPath,
				sshIdentityFilePath: fixture.options.sshIdentityFilePath,
				sshIdentityPublicKeyPath:
					fixture.options.sshIdentityPublicKeyPath,
				sshKnownHostsPath: fixture.options.sshKnownHostsPath,
			}),
			).rejects.toThrow("activation SSH private identity configuration invalid");
	});

	test("refuses SSH known-hosts trust writable or readable outside its owner", async () => {
		const fixture = await identityFixture();
		for (const mode of [0o644, 0o620, 0o606]) {
			await chmod(fixture.options.sshKnownHostsPath, mode);

			await expect(
				resolveVaultGitActivationIdentities(fixture.options),
			).rejects.toThrow("activation SSH known-hosts configuration invalid");
			await expect(
				resolveVaultGitSshTransportEnvironment({
					sshBinaryPath: fixture.options.sshBinaryPath,
					sshIdentityFilePath: fixture.options.sshIdentityFilePath,
					sshIdentityPublicKeyPath:
						fixture.options.sshIdentityPublicKeyPath,
					sshKnownHostsPath: fixture.options.sshKnownHostsPath,
				}),
			).rejects.toThrow("activation SSH known-hosts configuration invalid");
		}
	});

	test("refuses a symlinked SSH private identity", async () => {
		const fixture = await identityFixture();
		const linkedIdentity = join(fixture.root, "linked-writer");
		await symlink(fixture.options.sshIdentityFilePath, linkedIdentity);

		await expect(
			resolveVaultGitActivationIdentities({
				...fixture.options,
				sshIdentityFilePath: linkedIdentity,
			}),
		).rejects.toThrow("activation SSH private identity configuration invalid");
	});

	test("refuses a symlinked SSH known-hosts trust anchor", async () => {
		const fixture = await identityFixture();
		const linkedKnownHosts = join(fixture.root, "linked-known-hosts");
		await symlink(fixture.options.sshKnownHostsPath, linkedKnownHosts);

		await expect(
			resolveVaultGitActivationIdentities({
				...fixture.options,
				sshKnownHostsPath: linkedKnownHosts,
			}),
		).rejects.toThrow("activation SSH known-hosts configuration invalid");
		await expect(
			resolveVaultGitSshTransportEnvironment({
				sshBinaryPath: fixture.options.sshBinaryPath,
				sshIdentityFilePath: fixture.options.sshIdentityFilePath,
				sshIdentityPublicKeyPath:
					fixture.options.sshIdentityPublicKeyPath,
				sshKnownHostsPath: linkedKnownHosts,
			}),
		).rejects.toThrow("activation SSH known-hosts configuration invalid");
	});

	test("binds SSH known-hosts metadata changes into the activation identity", async () => {
		const fixture = await identityFixture();
		const before = await resolveVaultGitActivationIdentities(fixture.options);
		await utimes(
			fixture.options.sshKnownHostsPath,
			new Date("2026-08-11T00:00:00.000Z"),
			new Date("2026-08-11T00:00:00.000Z"),
		);

		const after = await resolveVaultGitActivationIdentities(fixture.options);

		expect(after.sshIdentity).not.toBe(before.sshIdentity);
	});

	test("resolves one exact fail-closed SSH execution environment", async () => {
		const fixture = await identityFixture();
		const [ssh, privateKey, knownHosts] = await Promise.all([
			realpath(fixture.options.sshBinaryPath),
			realpath(fixture.options.sshIdentityFilePath),
			realpath(fixture.options.sshKnownHostsPath),
		]);

		const environment = await resolveVaultGitSshTransportEnvironment({
			sshBinaryPath: fixture.options.sshBinaryPath,
			sshIdentityFilePath: fixture.options.sshIdentityFilePath,
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
				`-o 'IdentityFile=${privateKey}'`,
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
	readonly executableDependencyPath: string;
	readonly workspaceDependencyPath: string;
	readonly remote: string;
	readonly options: Parameters<typeof resolveVaultGitActivationIdentities>[0];
}> {
	const root = await tempDirectories.create("vault-git-activation-identities-");
	const repositoryPath = join(root, "vault");
	const stateRoot = join(root, "state");
	const remote = join(root, "remote.git");
	const executablePath = join(root, "vault-git.ts");
	const executableDependencyPath = join(root, "runtime-module.ts");
	const workspaceDependencyPath = join(root, "workspace-runtime.ts");
	const publicKeyPath = join(root, "writer.pub");
	const privateKeyPath = join(root, "writer");
	const knownHostsPath = join(root, "known_hosts");
	await mkdir(repositoryPath);
	await mkdir(stateRoot);
	await writeFile(
		executablePath,
		'import "./runtime-module.ts";\nimport "./workspace-runtime.ts";\n',
	);
	await writeFile(executableDependencyPath, "export {};\n");
	await writeFile(workspaceDependencyPath, "export {};\n");
	await writeFile(publicKeyPath, "ssh-ed25519 fixture-public-key\n");
	await writeFile(privateKeyPath, "fixture-private-key\n");
	await chmod(privateKeyPath, 0o600);
	await writeFile(knownHostsPath, "example.test ssh-ed25519 fixture-host-key\n");
	await chmod(knownHostsPath, 0o600);
	git(repositoryPath, ["init", "--initial-branch=main"]);
	git(repositoryPath, ["remote", "add", "origin", remote]);
	return {
		root,
		repositoryPath,
		executablePath,
		executableDependencyPath,
		workspaceDependencyPath,
		remote,
		options: {
			repositoryPath,
			stateRoot,
			remoteName: "origin",
			hostId: "macbook-owner-config",
			runtimeBinaryPath: process.execPath,
			runtimeVersion: Bun.version,
			executablePath,
			executableSourcePaths: [
				executablePath,
				executableDependencyPath,
				workspaceDependencyPath,
			],
			gitBinaryPath: "/usr/bin/git",
			sshBinaryPath: "/usr/bin/ssh",
			sshIdentityFilePath: privateKeyPath,
			sshIdentityPublicKeyPath: publicKeyPath,
			sshKnownHostsPath: knownHostsPath,
			process: createNodeProcessPort(),
			timeoutMs: 5_000,
		},
	};
}

async function reachableLocalSources(entrypoints: readonly string[]): Promise<string[]> {
	const pending = [...entrypoints];
	const sources = new Set<string>();
	while (pending.length > 0) {
		const sourcePath = pending.pop();
		if (!sourcePath || sources.has(sourcePath)) continue;
		sources.add(sourcePath);
		const source = await readFile(sourcePath, "utf8");
		for (const match of source.matchAll(
			/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g,
		)) {
			const specifier = match[1];
			if (specifier) {
				pending.push(
					resolve(
						dirname(sourcePath),
						specifier.endsWith(".ts") ? specifier : `${specifier}.ts`,
					),
				);
			}
		}
	}
	return [...sources].sort();
}

function git(cwd: string, args: readonly string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr);
}
