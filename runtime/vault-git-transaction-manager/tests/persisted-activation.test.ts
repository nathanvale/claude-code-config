import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	resolveDefaultActivationIdentity,
	resolvePersistedActivationIdentity,
} from "../src/cli.ts";

const HOST_HANDLE = `host_${"a".repeat(32)}`;
const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function makeRoot(): Promise<string> {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "vault-git-persisted-activation-")),
	);
	temporaryRoots.push(root);
	return root;
}

interface EnrollmentFixture {
	readonly configRoot: string;
	readonly dataRoot: string;
	readonly digest: string;
	readonly executablePath: string;
	readonly activationPath: string;
	readonly selectionPath: string;
}

async function installRuntime(dataRoot: string, source: string): Promise<{
	readonly digest: string;
	readonly executablePath: string;
}> {
	const bytes = `#!/usr/bin/env bun\n// ${source}\n`;
	const digest = createHash("sha256").update(bytes).digest("hex");
	const runtimeDir = join(dataRoot, "runtimes", digest);
	await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
	const executablePath = join(runtimeDir, "vault-git");
	await writeFile(executablePath, bytes, { mode: 0o755 });
	return { digest, executablePath };
}

async function writeEnrollmentFixture(root: string): Promise<EnrollmentFixture> {
	const configRoot = join(root, "config", "context", "vault-git");
	const dataRoot = join(root, "data", "context", "vault-git");
	await mkdir(configRoot, { recursive: true, mode: 0o700 });
	const runtime = await installRuntime(dataRoot, "persisted runtime one");
	const activationPath = join(configRoot, "activation.json");
	const selectionPath = join(configRoot, "runtime-selection.json");
	await writeFile(
		activationPath,
		`${JSON.stringify({
			schema_version: 1,
			host_handle: HOST_HANDLE,
			ssh_identity_file_path: join(root, "repository-writer"),
			ssh_public_key_path: join(root, "repository-writer.pub"),
			ssh_known_hosts_path: join(root, "known_hosts"),
		})}\n`,
		{ mode: 0o600 },
	);
	await writeFile(
		selectionPath,
		`${JSON.stringify({
			schema_version: 1,
			selected_digest: runtime.digest,
			prior_digest: null,
		})}\n`,
		{ mode: 0o600 },
	);
	return {
		configRoot,
		dataRoot,
		digest: runtime.digest,
		executablePath: runtime.executablePath,
		activationPath,
		selectionPath,
	};
}

describe("persisted Vault Git activation configuration", () => {
	test("configured enrollment binds the host handle and content-addressed runtime", async () => {
		const root = await makeRoot();
		const fixture = await writeEnrollmentFixture(root);

		const resolved = await resolvePersistedActivationIdentity({
			configRoot: fixture.configRoot,
			dataRoot: fixture.dataRoot,
			executingPath: fixture.executablePath,
		});

		expect(resolved.status).toBe("configured");
		if (resolved.status !== "configured") throw new Error("expected configured activation");
		expect(resolved.value.hostId).toBe(HOST_HANDLE);
		expect(resolved.value.executablePath).toBe(fixture.executablePath);
		expect(resolved.value.executableSourcePaths).toEqual([fixture.executablePath]);
		expect(resolved.value.runtimeBinaryPath).toBe(fixture.executablePath);
		expect(resolved.value.sshIdentityFilePath).toBe(join(root, "repository-writer"));
		expect(resolved.value.sshIdentityPublicKeyPath).toBe(join(root, "repository-writer.pub"));
		expect(resolved.value.sshKnownHostsPath).toBe(join(root, "known_hosts"));
	});

	test("a source-run executing image fails closed against persisted enrollment", async () => {
		const root = await makeRoot();
		const fixture = await writeEnrollmentFixture(root);

		const resolved = await resolvePersistedActivationIdentity({
			configRoot: fixture.configRoot,
			dataRoot: fixture.dataRoot,
		});

		expect(resolved).toEqual({
			status: "missing",
			missingConfiguration: [
				"host_identity",
				"ssh_identity_file",
				"ssh_public_key",
				"ssh_known_hosts",
			],
		});
	});

	test("a symlink alias of the selected installed runtime is admitted", async () => {
		const root = await makeRoot();
		const fixture = await writeEnrollmentFixture(root);
		const alias = join(root, "vault-git-selector");
		await symlink(fixture.executablePath, alias);

		const resolved = await resolvePersistedActivationIdentity({
			configRoot: fixture.configRoot,
			dataRoot: fixture.dataRoot,
			executingPath: alias,
		});

		expect(resolved.status).toBe("configured");
		if (resolved.status !== "configured") throw new Error("expected configured activation");
		expect(resolved.value.executablePath).toBe(fixture.executablePath);
	});

	test("a different executable image fails closed", async () => {
		const root = await makeRoot();
		const fixture = await writeEnrollmentFixture(root);
		const shadow = await installRuntime(fixture.dataRoot, "shadow runtime");

		const resolved = await resolvePersistedActivationIdentity({
			configRoot: fixture.configRoot,
			dataRoot: fixture.dataRoot,
			executingPath: shadow.executablePath,
		});

		expect(resolved.status).toBe("missing");
	});

	test("a Runtime Selection change rebinds activation to the new exact executable", async () => {
		const root = await makeRoot();
		const fixture = await writeEnrollmentFixture(root);
		const first = await resolvePersistedActivationIdentity({
			configRoot: fixture.configRoot,
			dataRoot: fixture.dataRoot,
			executingPath: fixture.executablePath,
		});
		if (first.status !== "configured") throw new Error("expected configured activation");

		const upgraded = await installRuntime(fixture.dataRoot, "persisted runtime two");
		await writeFile(
			fixture.selectionPath,
			`${JSON.stringify({
				schema_version: 1,
				selected_digest: upgraded.digest,
				prior_digest: fixture.digest,
			})}\n`,
			{ mode: 0o600 },
		);
		const second = await resolvePersistedActivationIdentity({
			configRoot: fixture.configRoot,
			dataRoot: fixture.dataRoot,
			executingPath: upgraded.executablePath,
		});

		if (second.status !== "configured") throw new Error("expected configured activation");
		expect(second.value.executablePath).toBe(upgraded.executablePath);
		expect(second.value.executablePath).not.toBe(first.value.executablePath);
		expect(second.value.executableSourcePaths).toEqual([upgraded.executablePath]);
	});

	test("a corrupt selected runtime fails closed to missing configuration", async () => {
		const root = await makeRoot();
		const fixture = await writeEnrollmentFixture(root);
		await writeFile(fixture.executablePath, "corrupt runtime\n", { mode: 0o755 });

		const resolved = await resolvePersistedActivationIdentity({
			configRoot: fixture.configRoot,
			dataRoot: fixture.dataRoot,
		});

		expect(resolved).toEqual({
			status: "missing",
			missingConfiguration: [
				"host_identity",
				"ssh_identity_file",
				"ssh_public_key",
				"ssh_known_hosts",
			],
		});
	});

	test("malformed, unsafe, or absent enrollment records fail closed", async () => {
		const root = await makeRoot();
		const fixture = await writeEnrollmentFixture(root);
		const resolve = () =>
			resolvePersistedActivationIdentity({
				configRoot: fixture.configRoot,
				dataRoot: fixture.dataRoot,
				executingPath: fixture.executablePath,
			});

		await chmod(fixture.activationPath, 0o644);
		expect((await resolve()).status).toBe("missing");
		await chmod(fixture.activationPath, 0o600);
		expect((await resolve()).status).toBe("configured");

		await writeFile(
			fixture.activationPath,
			`${JSON.stringify({
				schema_version: 1,
				host_handle: HOST_HANDLE,
				ssh_identity_file_path: join(root, "repository-writer"),
				ssh_public_key_path: join(root, "repository-writer.pub"),
				ssh_known_hosts_path: join(root, "known_hosts"),
				extra_field: "forged",
			})}\n`,
			{ mode: 0o600 },
		);
		expect((await resolve()).status).toBe("missing");

		const empty = await makeRoot();
		expect(
			await resolvePersistedActivationIdentity({
				configRoot: join(empty, "config", "context", "vault-git"),
				dataRoot: join(empty, "data", "context", "vault-git"),
			}),
		).toMatchObject({ status: "missing" });
	});

	test("a symlinked selection record fails closed", async () => {
		const root = await makeRoot();
		const fixture = await writeEnrollmentFixture(root);
		const aside = join(root, "aside-selection.json");
		await writeFile(
			aside,
			`${JSON.stringify({
				schema_version: 1,
				selected_digest: fixture.digest,
				prior_digest: null,
			})}\n`,
			{ mode: 0o600 },
		);
		await rm(fixture.selectionPath);
		await symlink(aside, fixture.selectionPath);

		expect(
			(await resolvePersistedActivationIdentity({
				configRoot: fixture.configRoot,
				dataRoot: fixture.dataRoot,
			})).status,
		).toBe("missing");
	});
});

describe("default activation identity lanes", () => {
	test("fixture environment variables keep the source-linked lane", async () => {
		const root = await makeRoot();
		const env = {
			VAULT_GIT_HOST: "fixture-host",
			VAULT_GIT_SSH_IDENTITY_FILE_PATH: join(root, "id"),
			VAULT_GIT_SSH_PUBLIC_KEY_PATH: join(root, "id.pub"),
			VAULT_GIT_SSH_KNOWN_HOSTS_PATH: join(root, "known_hosts"),
		};

		const resolved = await resolveDefaultActivationIdentity(env, root);

		expect(resolved.status).toBe("configured");
		if (resolved.status !== "configured") throw new Error("expected configured activation");
		expect(resolved.value.hostId).toBe("fixture-host");
		expect(resolved.value.sshIdentityFilePath).toBe(join(root, "id"));
		expect(resolved.value.executableSourcePaths.length).toBeGreaterThan(1);
	});

	test("an unset environment resolves the persisted XDG enrollment for the installed image", async () => {
		const root = await makeRoot();
		const fixture = await writeEnrollmentFixture(join(root, "xdg"));
		const env = {
			XDG_CONFIG_HOME: join(root, "xdg", "config"),
			XDG_DATA_HOME: join(root, "xdg", "data"),
		};

		const resolved = await resolveDefaultActivationIdentity(
			env,
			root,
			fixture.executablePath,
		);

		expect(resolved.status).toBe("configured");
		if (resolved.status !== "configured") throw new Error("expected configured activation");
		expect(resolved.value.hostId).toBe(HOST_HANDLE);
		expect(resolved.value.executablePath).toContain("/runtimes/");
		expect(resolved.value.executableSourcePaths).toEqual([resolved.value.executablePath]);
	});

	test("an unset environment refuses persisted enrollment under a source-run image", async () => {
		const root = await makeRoot();
		await writeEnrollmentFixture(join(root, "xdg"));
		const env = {
			XDG_CONFIG_HOME: join(root, "xdg", "config"),
			XDG_DATA_HOME: join(root, "xdg", "data"),
		};

		const resolved = await resolveDefaultActivationIdentity(env, root);

		expect(resolved).toEqual({
			status: "missing",
			missingConfiguration: [
				"host_identity",
				"ssh_identity_file",
				"ssh_public_key",
				"ssh_known_hosts",
			],
		});
	});

	test("an unset environment without enrollment reports every missing field", async () => {
		const root = await makeRoot();

		expect(await resolveDefaultActivationIdentity({ XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data") }, root)).toEqual({
			status: "missing",
			missingConfiguration: [
				"host_identity",
				"ssh_identity_file",
				"ssh_public_key",
				"ssh_known_hosts",
			],
		});
	});

	test("a partial fixture environment names only its absent fields", async () => {
		const root = await makeRoot();

		const resolved = await resolveDefaultActivationIdentity(
			{ VAULT_GIT_HOST: "fixture-host" },
			root,
		);

		expect(resolved).toEqual({
			status: "missing",
			missingConfiguration: [
				"ssh_identity_file",
				"ssh_public_key",
				"ssh_known_hosts",
			],
		});
	});
});
