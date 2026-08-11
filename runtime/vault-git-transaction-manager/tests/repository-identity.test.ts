import { spawnSync } from "node:child_process";
import { realpath, rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
	VaultRepositoryIdentityUnavailableError,
	deriveVaultRepositoryIdentity,
	resolveVaultRepositoryIdentity,
} from "../src/index.ts";
import { createNodeProcessPort } from "../src/git-adapter.ts";
import { createTempDirectoryFixture } from "./temp-directory-fixture.ts";

const tempDirectories = createTempDirectoryFixture();

afterEach(tempDirectories.cleanup);

describe("vault repository identity", () => {
	test("derives one stable non-secret identity from canonical repository bindings", () => {
		const identity = deriveVaultRepositoryIdentity({
			repositoryRoot: "/owner/vault",
			gitCommonDirectory: "/owner/vault/.git",
			gitCommonDirectoryDevice: "42",
			gitCommonDirectoryInode: "84",
		});

		expect(identity).toBe(
			"vault-git:v1:f6d264e2825690d2f42c3aac7eb6f310b84e074e33407dcbf54c243f7ff06c80",
		);
		expect(identity).not.toContain("/owner/vault");
	});

	test("resolves canonical bindings from the configured Git checkout", async () => {
		const repositoryPath = await tempDirectories.create("vault-identity-");
		const initialized = spawnSync(
			"git",
			["init", "--initial-branch=main", repositoryPath],
			{ encoding: "utf8" },
		);
		expect(initialized.status).toBe(0);

		const resolved = await resolveVaultRepositoryIdentity({
			repositoryPath,
			process: createNodeProcessPort(),
			timeoutMs: 5_000,
		});
		const repositoryRoot = await realpath(repositoryPath);
		const gitCommonDirectory = await realpath(join(repositoryRoot, ".git"));

		expect(resolved).toMatchObject({
			repositoryRoot,
			gitCommonDirectory,
		});
		expect(resolved.identity).toBe(
			deriveVaultRepositoryIdentity(resolved),
		);
	});

	test("runs repository identity probes with the controlled Git environment", async () => {
		const repositoryPath = await tempDirectories.create(
			"vault-identity-environment-",
		);
		expect(
			spawnSync("git", ["init", "--initial-branch=main", repositoryPath])
				.status,
		).toBe(0);
		const processPort = createNodeProcessPort();
		const environments: Readonly<Record<string, string>>[] = [];

		await resolveVaultRepositoryIdentity({
			repositoryPath,
			process: {
				run(request) {
					environments.push(request.env ?? {});
					return processPort.run(request);
				},
			},
			timeoutMs: 5_000,
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

	test("changes identity when the Git common directory is replaced in place", async () => {
		const repositoryPath = await tempDirectories.create(
			"vault-identity-replaced-",
		);
		expect(
			spawnSync("git", ["init", "--initial-branch=main", repositoryPath])
				.status,
		).toBe(0);
		const options = {
			repositoryPath,
			process: createNodeProcessPort(),
			timeoutMs: 5_000,
		} as const;
		const before = await resolveVaultRepositoryIdentity(options);

		await rm(join(repositoryPath, ".git"), { recursive: true });
		expect(
			spawnSync("git", ["init", "--initial-branch=main", repositoryPath])
				.status,
		).toBe(0);
		const after = await resolveVaultRepositoryIdentity(options);

		expect(after.identity).not.toBe(before.identity);
	});

	test("refuses a configured path that is not a Git repository", async () => {
		const repositoryPath = await tempDirectories.create(
			"vault-identity-invalid-",
		);

		await expect(
			resolveVaultRepositoryIdentity({
				repositoryPath,
				process: createNodeProcessPort(),
				timeoutMs: 5_000,
			}),
		).rejects.toThrow("configured repository identity could not be resolved");
	});

	test("distinguishes an unavailable identity probe from invalid configuration", async () => {
		const repositoryPath = await tempDirectories.create(
			"vault-identity-unavailable-",
		);

		await expect(
			resolveVaultRepositoryIdentity({
				repositoryPath,
				process: {
					async run() {
						return {
							exitCode: null,
							stdout: "",
							stderr: "",
							timedOut: true,
						};
					},
				},
				timeoutMs: 5_000,
			}),
		).rejects.toBeInstanceOf(VaultRepositoryIdentityUnavailableError);
	});
});
