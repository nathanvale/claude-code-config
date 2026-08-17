import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
import { createVaultCheckerPort } from "../src/cli.ts";
import type {
	VaultGitProcessPort,
	VaultGitProcessRequest,
} from "../src/ports.ts";

describe("vault checker process boundary", () => {
	const roots: string[] = [];
	afterEach(async () => {
		await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	});

	test("uses the canonical admitted runtime through its verified bun alias with an isolated environment", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-checker-runtime-"));
		roots.push(root);
		const runtimeDir = join(root, "runtime");
		await mkdir(runtimeDir, { recursive: true });
		const runtimeBinary = join(runtimeDir, "vault-git");
		await writeFile(runtimeBinary, "#!/bin/sh\nexit 64\n");
		await chmod(runtimeBinary, 0o755);
		await symlink("vault-git", join(runtimeDir, "bun"));
		const vaultRoot = join(root, "vault");
		await mkdir(vaultRoot, { recursive: true });
		await writeFile(
			join(vaultRoot, "package.json"),
			'{"name":"fixture-vault","scripts":{"check":"bun scripts/check.ts"}}\n',
		);
		const requests: VaultGitProcessRequest[] = [];
		const processPort: VaultGitProcessPort = {
			async run(request) {
				requests.push(request);
				return {
					exitCode: 0,
					stdout: '{"status":"ok","findings":[]}',
					stderr: "",
					timedOut: false,
				};
			},
		};
		const checker = createVaultCheckerPort(vaultRoot, processPort, runtimeBinary);

		await checker.runCheck();

		const canonical = await realpath(runtimeBinary);
		expect(requests).toEqual([
			{
				command: canonical,
				args: ["exec", "bun scripts/check.ts --json"],
				cwd: vaultRoot,
				env: {
					LC_ALL: "C",
					BUN_BE_BUN: "1",
					PATH: `${dirname(canonical)}:/usr/bin:/bin:/usr/sbin:/sbin`,
				},
				environmentMode: "isolated",
				timeoutMs: 15_000,
			},
		]);
	});

	test("a missing bun alias refuses checker execution instead of spawning", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-checker-runtime-"));
		roots.push(root);
		const runtimeDir = join(root, "runtime");
		await mkdir(runtimeDir, { recursive: true });
		const runtimeBinary = join(runtimeDir, "vault-git");
		await writeFile(runtimeBinary, "#!/bin/sh\nexit 64\n");
		await chmod(runtimeBinary, 0o755);
		const vaultRoot = join(root, "vault");
		await mkdir(vaultRoot, { recursive: true });
		await writeFile(
			join(vaultRoot, "package.json"),
			'{"name":"fixture-vault","scripts":{"check":"bun scripts/check.ts"}}\n',
		);
		const requests: VaultGitProcessRequest[] = [];
		const processPort: VaultGitProcessPort = {
			async run(request) {
				requests.push(request);
				return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
			},
		};
		const checker = createVaultCheckerPort(vaultRoot, processPort, runtimeBinary);

		await expect(checker.runCheck()).rejects.toThrow(
			"vault checker runtime unusable",
		);
		expect(requests).toHaveLength(0);
	});

	test("refuses a check script broader than one admitted command in both fingerprint and execution before any spawn", async () => {
		const hostileScripts = [
			"bun scripts/check.ts && touch pwned",
			"bun scripts/check.ts ; touch pwned",
			"bun scripts/check.ts | tee capture",
			"bun scripts/check.ts > capture",
			"bun scripts/check.ts $(touch pwned)",
			"bun scripts/check.ts `touch pwned`",
		];
		for (const script of hostileScripts) {
			const root = await checkerFixture({
				name: "hostile-check-script",
				private: true,
				scripts: { check: script },
			});
			const requests: VaultGitProcessRequest[] = [];
			const processPort: VaultGitProcessPort = {
				async run(request) {
					requests.push(request);
					return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
				},
			};
			const checker = createVaultCheckerPort(root, processPort);
			await expect(checker.fingerprint()).rejects.toThrow(
				"vault check script is broader than one admitted command",
			);
			await expect(checker.runCheck()).rejects.toThrow(
				"vault check script is broader than one admitted command",
			);
			expect(requests).toHaveLength(0);
		}
	});

	test("executes exactly the admitted command line rebuilt from admission tokens", async () => {
		const root = await checkerFixture({
			name: "admitted-check-script",
			private: true,
			scripts: { check: "bun  scripts/check.ts" },
		});
		const requests: VaultGitProcessRequest[] = [];
		const processPort: VaultGitProcessPort = {
			async run(request) {
				requests.push(request);
				return {
					exitCode: 0,
					stdout: '{"status":"ok","findings":[]}',
					stderr: "",
					timedOut: false,
				};
			},
		};
		const checker = createVaultCheckerPort(root, processPort);

		await checker.runCheck();

		expect(requests).toHaveLength(1);
		expect(requests[0]?.args).toEqual(["exec", "bun scripts/check.ts --json"]);
	});

	test("binds the deterministic frontmatter schema read by the checker", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-checker-closure-"));
		roots.push(root);
		await mkdir(join(root, "scripts"));
		await mkdir(join(root, "schemas"));
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ scripts: { check: "bun run scripts/check.ts" } }),
		);
		await writeFile(
			join(root, "bun.lock"),
			JSON.stringify({
				lockfileVersion: 1,
				configVersion: 1,
				workspaces: { "": { name: "checker-fixture" } },
			}),
		);
		await writeFile(join(root, "scripts", "check.ts"), "export {};\n");
		const schemaPath = join(root, "schemas", "frontmatter-contract.json");
		await writeFile(schemaPath, '{"type":"object"}\n');
		const processPort: VaultGitProcessPort = {
			async run() {
				throw new Error("not used");
			},
		};
		const checker = createVaultCheckerPort(root, processPort);

		const before = await checker.fingerprint();
		await writeFile(schemaPath, '{"type":"object","required":["title"]}\n');
		const after = await checker.fingerprint();

		expect(after.entrypointHash).toBe(before.entrypointHash);
		expect(after.dependencyBundleHash).not.toBe(before.dependencyBundleHash);
	});

	test("binds dependency-free lockfile absence, appearance, content, and disappearance", async () => {
		const root = await checkerFixture({
			name: "dependency-free-checker",
			private: true,
			scripts: { check: "bun run scripts/check.ts" },
		});
		const checker = createVaultCheckerPort(root, unusedProcessPort());

		const absent = await checker.fingerprint();
		await writeFile(join(root, "bun.lock"), validLockfile("first"));
		const appeared = await checker.fingerprint();
		await writeFile(join(root, "bun.lock"), validLockfile("changed"));
		const changed = await checker.fingerprint();
		await rm(join(root, "bun.lock"));
		const disappeared = await checker.fingerprint();

		expect(appeared.dependencyBundleHash).not.toBe(
			absent.dependencyBundleHash,
		);
		expect(changed.dependencyBundleHash).not.toBe(
			appeared.dependencyBundleHash,
		);
		expect(disappeared.dependencyBundleHash).toBe(
			absent.dependencyBundleHash,
		);
	});

	for (const [field, value] of [
		["dependencies", {}],
		["devDependencies", {}],
		["workspaces", []],
		["catalogs", {}],
	] as const) {
		test(`refuses ${field} without bun.lock before checker execution`, async () => {
			const root = await checkerFixture({
				name: "lockfile-required-checker",
				private: true,
				scripts: { check: "bun run scripts/check.ts" },
				[field]: value,
			});
			const checker = createVaultCheckerPort(root, unusedProcessPort());

			await expect(checker.fingerprint()).rejects.toThrow(
				`bun.lock is required when package.json declares ${field}`,
			);
		});
	}

	test("refuses malformed bun.lock before checker execution", async () => {
		const root = await checkerFixture({
			name: "invalid-lockfile-checker",
			private: true,
			scripts: { check: "bun run scripts/check.ts" },
			dependencies: { example: "1.0.0" },
		});
		await writeFile(join(root, "bun.lock"), "not a lockfile\n");
		const checker = createVaultCheckerPort(root, unusedProcessPort());

		await expect(checker.fingerprint()).rejects.toThrow(
			"bun.lock is not valid JSONC",
		);
	});

	test("refuses a resolution-free lock for a dependency-bearing manifest", async () => {
		const root = await checkerFixture({
			name: "unresolved-lockfile-checker",
			private: true,
			scripts: { check: "bun run scripts/check.ts" },
			dependencies: { example: "1.0.0" },
		});
		await writeFile(join(root, "bun.lock"), validLockfile("unresolved"));
		const checker = createVaultCheckerPort(root, unusedProcessPort());

		await expect(checker.fingerprint()).rejects.toThrow(
			"bun.lock dependency contract is invalid",
		);
	});

	for (const [name, lockfile] of [
		[
			"empty packages",
			{
				lockfileVersion: 1,
				configVersion: 1,
				workspaces: { "": { dependencies: { example: "1.0.0" } } },
				packages: {},
			},
		],
		[
			"missing declared resolution",
			{
				lockfileVersion: 1,
				configVersion: 1,
				workspaces: { "": { dependencies: { example: "1.0.0" } } },
				packages: { another: ["another@1.0.0", ""] },
			},
		],
		[
			"stale declared specifier",
			{
				lockfileVersion: 1,
				configVersion: 1,
				workspaces: { "": { dependencies: { example: "2.0.0" } } },
				packages: { example: ["example@2.0.0", ""] },
			},
		],
	] as const) {
		test(`refuses ${name} for a dependency-bearing manifest`, async () => {
			const root = await checkerFixture({
				name: "unresolved-lockfile-checker",
				private: true,
				scripts: { check: "bun run scripts/check.ts" },
				dependencies: { example: "1.0.0" },
			});
			await writeFile(join(root, "bun.lock"), JSON.stringify(lockfile));
			const checker = createVaultCheckerPort(root, unusedProcessPort());

			await expect(checker.fingerprint()).rejects.toThrow(
				"bun.lock dependency resolution is invalid",
			);
		});
	}

	test("refuses an unresolved peer dependency", async () => {
		const root = await checkerFixture({
			name: "unresolved-peer-checker",
			private: true,
			scripts: { check: "bun run scripts/check.ts" },
			peerDependencies: { example: "1.0.0" },
		});
		await writeFile(
			join(root, "bun.lock"),
			JSON.stringify({
				lockfileVersion: 1,
				configVersion: 1,
				workspaces: { "": { peerDependencies: { example: "1.0.0" } } },
				packages: {},
			}),
		);
		const checker = createVaultCheckerPort(root, unusedProcessPort());

		await expect(checker.fingerprint()).rejects.toThrow(
			"bun.lock dependency resolution is invalid",
		);
	});

	test("accepts a lockfile with every declared dependency resolved", async () => {
		const root = await checkerFixture({
			name: "resolved-lockfile-checker",
			private: true,
			scripts: { check: "bun run scripts/check.ts" },
			dependencies: { example: "1.0.0" },
		});
		await writeFile(
			join(root, "bun.lock"),
			JSON.stringify({
				lockfileVersion: 1,
				configVersion: 1,
				workspaces: { "": { dependencies: { example: "1.0.0" } } },
				packages: { example: ["example@1.0.0", ""] },
			}),
		);
		const checker = createVaultCheckerPort(root, unusedProcessPort());

		await expect(checker.fingerprint()).resolves.toMatchObject({
			entrypointHash: expect.stringMatching(/^[0-9a-f]{64}$/),
			dependencyBundleHash: expect.stringMatching(/^[0-9a-f]{64}$/),
		});
	});

	async function checkerFixture(
		manifest: Readonly<Record<string, unknown>>,
	): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), "vault-checker-lockfile-"));
		roots.push(root);
		await mkdir(join(root, "scripts"));
		await mkdir(join(root, "schemas"));
		await writeFile(join(root, "package.json"), JSON.stringify(manifest));
		await writeFile(join(root, "scripts", "check.ts"), "export {};\n");
		await writeFile(
			join(root, "schemas", "frontmatter-contract.json"),
			'{"type":"object"}\n',
		);
		return root;
	}

	function unusedProcessPort(): VaultGitProcessPort {
		return {
			async run() {
				throw new Error("checker execution was not expected");
			},
		};
	}

	function validLockfile(name: string): string {
		return JSON.stringify({
			lockfileVersion: 1,
			configVersion: 1,
			workspaces: { "": { name } },
		});
	}
});
