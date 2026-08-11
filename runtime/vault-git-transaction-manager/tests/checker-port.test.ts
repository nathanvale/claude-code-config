import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

	test("uses the admitted absolute runtime with an isolated environment", async () => {
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
		const checker = createVaultCheckerPort(
			"/private/isolated-vault",
			processPort,
			"/admitted/runtime/bin/bun",
		);

		await checker.runCheck();

		expect(requests).toEqual([
			{
				command: "/admitted/runtime/bin/bun",
				args: ["run", "check", "--json"],
				cwd: "/private/isolated-vault",
				env: {
					LC_ALL: "C",
					PATH: "/admitted/runtime/bin:/usr/bin:/bin:/usr/sbin:/sbin",
				},
				environmentMode: "isolated",
				timeoutMs: 15_000,
			},
		]);
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
		await writeFile(join(root, "bun.lock"), "fixture-lock\n");
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
});
