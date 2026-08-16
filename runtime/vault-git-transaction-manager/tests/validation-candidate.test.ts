import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	createVaultGitCandidateResidueStore,
	createVaultOwnedCheckPort,
	VAULT_GIT_CANDIDATE_RESIDUE_ELIGIBLE_AFTER_MS,
	VAULT_GIT_VALIDATION_STAGE_BUDGETS_MS,
	type VaultGitCandidateResidueAnomalyObservation,
	type VaultGitCandidateResidueOwnership,
} from "../src/validation-candidate.ts";
import { createNodeProcessPort } from "../src/git-adapter.ts";
import type {
	VaultGitProcessPort,
	VaultGitProcessRequest,
	VaultGitProcessResult,
} from "../src/ports.ts";
import type { VaultGitOwnedPathReceipt } from "../src/model.ts";

const roots: string[] = [];

afterAll(async () => {
	await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function blobId(cwd: string, content: string): string {
	return execFileSync("git", ["hash-object", "--stdin"], {
		cwd,
		input: content,
		encoding: "utf8",
	}).trim();
}

interface CandidateFixture {
	readonly root: string;
	readonly vault: string;
	readonly privateRoot: string;
	readonly head: string;
	readonly candidatesRoot: string;
	ownedReceipt(path: string): VaultGitOwnedPathReceipt;
}

async function candidateFixture(
	options: {
		checkTs?: string;
		manifest?: Record<string, unknown>;
		extraFiles?: Readonly<Record<string, string>>;
	} = {},
): Promise<CandidateFixture> {
	const root = await mkdtemp(join(tmpdir(), "vault-git-validation-candidate-"));
	roots.push(root);
	const vault = join(root, "vault");
	const privateRoot = join(root, "private");
	await mkdir(vault, { recursive: true });
	await mkdir(privateRoot, { recursive: true });
	git(root, "init", vault);
	git(vault, "checkout", "-b", "main");
	git(vault, "config", "user.name", "Fixture");
	git(vault, "config", "user.email", "fixture@example.invalid");
	await writeFile(
		join(vault, "package.json"),
		`${JSON.stringify(
			options.manifest ?? {
				name: "fixture-vault",
				scripts: { check: "bun scripts/check.ts" },
			},
			null,
			"\t",
		)}\n`,
	);
	await mkdir(join(vault, "scripts"), { recursive: true });
	await writeFile(
		join(vault, "scripts", "check.ts"),
		options.checkTs ?? "process.exit(0);\n",
	);
	for (const [path, content] of Object.entries(options.extraFiles ?? {})) {
		await writeFile(join(vault, path), content);
	}
	await writeFile(join(vault, "owned.md"), "owned baseline\n");
	await writeFile(join(vault, "unrelated.md"), "unrelated baseline\n");
	git(vault, "add", "--all");
	git(vault, "commit", "-m", "baseline");
	const head = git(vault, "rev-parse", "refs/heads/main");
	return {
		root,
		vault,
		privateRoot,
		head,
		candidatesRoot: join(privateRoot, "validation-candidates"),
		ownedReceipt(path: string): VaultGitOwnedPathReceipt {
			const baseline = execFileSync(
				"git",
				["rev-parse", "--verify", "--quiet", `${head}:${path}`],
				{ cwd: vault, encoding: "utf8" },
			)
				.toString()
				.trim();
			return { path, baselineHash: baseline, admittedNewFile: false };
		},
	};
}

let compiledRuntimePromise: Promise<{
	readonly runtimeDir: string;
	readonly runtimeBinary: string;
}> | null = null;

/**
 * One real `bun build --compile` executable per test file, laid out the way
 * Setup installs an immutable runtime: `<dir>/vault-git` plus the `bun`
 * alias. The embedded program refuses unknown argv exactly like the real
 * Vault Git CLI would, so a spawn that reaches it instead of the Bun CLI is
 * observable.
 */
function compiledInstalledRuntime(): Promise<{
	readonly runtimeDir: string;
	readonly runtimeBinary: string;
}> {
	compiledRuntimePromise ??= (async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-installed-runtime-"));
		roots.push(root);
		const entrypoint = join(root, "cli.ts");
		await writeFile(
			entrypoint,
			'console.error("vault-git: unknown command");\nprocess.exit(64);\n',
		);
		const runtimeDir = join(root, "runtimes", "fixture-digest");
		await mkdir(runtimeDir, { recursive: true });
		const runtimeBinary = join(runtimeDir, "vault-git");
		execFileSync(
			process.execPath,
			["build", entrypoint, "--compile", "--outfile", runtimeBinary],
			{ cwd: root, stdio: "ignore" },
		);
		await chmod(runtimeBinary, 0o755);
		await symlink("vault-git", join(runtimeDir, "bun"));
		return { runtimeDir, runtimeBinary };
	})();
	return compiledRuntimePromise;
}

type Intercept = (
	request: VaultGitProcessRequest,
) =>
	| VaultGitProcessResult
	| undefined
	| Promise<VaultGitProcessResult | undefined>;

function capturingPort(intercept?: Intercept): VaultGitProcessPort & {
	readonly requests: VaultGitProcessRequest[];
} {
	const base = createNodeProcessPort();
	const requests: VaultGitProcessRequest[] = [];
	return {
		requests,
		async run(request) {
			requests.push(request);
			const intercepted = await intercept?.(request);
			if (intercepted) return intercepted;
			return base.run(request);
		},
	};
}

function isCheckInvocation(request: VaultGitProcessRequest): boolean {
	return request.command === process.execPath;
}

async function residueFiles(candidatesRoot: string): Promise<string[]> {
	const entries = await readdir(candidatesRoot).catch(() => [] as string[]);
	return entries.filter((entry) => entry.endsWith(".json")).sort();
}

async function candidateDirectories(candidatesRoot: string): Promise<string[]> {
	const entries = await readdir(candidatesRoot).catch(() => [] as string[]);
	return entries.filter((entry) => !entry.endsWith(".json")).sort();
}

function plantedRecordText(
	candidatesRoot: string,
	candidateId: string,
	overrides: Record<string, unknown> = {},
): string {
	return `${JSON.stringify({
		schemaVersion: 1,
		candidateId,
		candidatePath: join(candidatesRoot, candidateId),
		transactionId: "txn_planted",
		baselineHead: "a".repeat(40),
		createdAt: "2026-08-17T00:00:00.000Z",
		updatedAt: "2026-08-17T00:00:00.000Z",
		stage: "vault_check",
		failureClass: null,
		...overrides,
	})}\n`;
}

const AGED_RESIDUE_NOW = () => new Date("2026-08-18T00:00:00.000Z");

describe("validation candidate composition", () => {
	test("runs the vault check against baseline plus frozen owned bytes only and removes the candidate", async () => {
		const fixture = await candidateFixture({
			checkTs: [
				'import { readFileSync } from "node:fs";',
				'if (readFileSync("owned.md", "utf8") !== "owned frozen\\n") process.exit(3);',
				'if (readFileSync("unrelated.md", "utf8") !== "unrelated baseline\\n") process.exit(4);',
				"process.exit(0);",
			].join("\n"),
		});
		const owned = fixture.ownedReceipt("owned.md");
		await writeFile(join(fixture.vault, "owned.md"), "owned frozen\n");
		await writeFile(join(fixture.vault, "unrelated.md"), "unrelated dirty\n");
		git(fixture.vault, "add", "--", "unrelated.md");
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(),
			runtimeBinaryPath: process.execPath,
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
			transactionId: "txn_compose",
		});
		expect(result).toEqual({
			status: "passed",
			checkedPaths: [
				{
					path: "owned.md",
					contentHash: blobId(fixture.vault, "owned frozen\n"),
					fileMode: "100644",
				},
			],
		});
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual([]);
		expect(await residueFiles(fixture.candidatesRoot)).toEqual([]);
	});

	test("captures the frozen bytes even when the canonical worktree mutates during the check", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		await writeFile(join(fixture.vault, "owned.md"), "owned frozen\n");
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(async (request) => {
				if (!isCheckInvocation(request)) return undefined;
				await writeFile(join(fixture.vault, "owned.md"), "mutated during check\n");
				return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
			}),
			runtimeBinaryPath: process.execPath,
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
		});
		expect(result).toMatchObject({
			status: "passed",
			checkedPaths: [
				{ path: "owned.md", contentHash: blobId(fixture.vault, "owned frozen\n") },
			],
		});
	});

	test("binds the exact Git file mode of the frozen owned path", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		await writeFile(join(fixture.vault, "owned.md"), "owned frozen\n");
		await chmod(join(fixture.vault, "owned.md"), 0o755);
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(),
			runtimeBinaryPath: process.execPath,
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
		});
		expect(result).toMatchObject({
			status: "passed",
			checkedPaths: [{ path: "owned.md", fileMode: "100755" }],
		});
	});

	test("binds an admitted absent owned path as null content and null mode", async () => {
		const fixture = await candidateFixture();
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(),
			runtimeBinaryPath: process.execPath,
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [{ path: "ghost.md", baselineHash: null, admittedNewFile: true }],
		});
		expect(result).toEqual({
			status: "passed",
			checkedPaths: [{ path: "ghost.md", contentHash: null, fileMode: null }],
		});
	});
});

describe("validation candidate runtime and environment", () => {
	test("executes the check with the activation-bound runtime in a scrubbed isolated environment inside the candidate", async () => {
		process.env.VAULT_GIT_TEST_HOSTILE_SECRET = "hostile-ambient-secret";
		try {
			const fixture = await candidateFixture();
			const owned = fixture.ownedReceipt("owned.md");
			const port = capturingPort();
			const check = createVaultOwnedCheckPort({
				repositoryPath: fixture.vault,
				privateStateRoot: fixture.privateRoot,
				process: port,
				runtimeBinaryPath: process.execPath,
			});
			const result = await check.run({
				baselineHead: fixture.head,
				ownedPaths: [owned],
			});
			expect(result.status).toBe("passed");
			const checkRequests = port.requests.filter(isCheckInvocation);
			expect(checkRequests).toHaveLength(1);
			const request = checkRequests[0];
			if (!request) throw new Error("check invocation missing");
			expect(request.command).toBe(process.execPath);
			expect(request.environmentMode).toBe("isolated");
			expect(request.cwd.startsWith(fixture.privateRoot)).toBe(true);
			expect(request.cwd.startsWith(fixture.vault)).toBe(false);
			expect(request.env?.PATH?.startsWith(dirname(process.execPath))).toBe(true);
			const environment = request.env ?? {};
			expect(Object.keys(environment)).not.toContain(
				"VAULT_GIT_TEST_HOSTILE_SECRET",
			);
			expect(
				Object.values(environment).some((value) =>
					value.includes("hostile-ambient-secret"),
				),
			).toBe(false);
		} finally {
			delete process.env.VAULT_GIT_TEST_HOSTILE_SECRET;
		}
	});

	test("fails closed as candidate_setup without an admitted runtime binding and never spawns or writes", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		const port = capturingPort();
		const check = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: port,
			runtimeBinaryPath: null,
		});
		const result = await check.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
			transactionId: "txn_unbound",
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "candidate_setup",
			stage: "candidate_setup",
		});
		expect(port.requests).toHaveLength(0);
		expect(existsSync(fixture.candidatesRoot)).toBe(false);
	});

	test("refuses a relative runtime binary instead of ambient PATH lookup", async () => {
		const fixture = await candidateFixture();
		expect(() =>
			createVaultOwnedCheckPort({
				repositoryPath: fixture.vault,
				privateStateRoot: fixture.privateRoot,
				process: capturingPort(),
				runtimeBinaryPath: "bun",
			}),
		).toThrow();
	});
});

describe("installed runtime runner", () => {
	test("a real compiled installed runtime runs a passing nested-bun package check in an isolated environment", async () => {
		const { runtimeBinary } = await compiledInstalledRuntime();
		const receiptRoot = await mkdtemp(join(tmpdir(), "vault-git-nested-receipt-"));
		roots.push(receiptRoot);
		const receiptPath = join(receiptRoot, "nested-exec-path");
		const fixture = await candidateFixture({
			checkTs: `await Bun.write(${JSON.stringify(receiptPath)}, \`\${process.execPath}\\n\${process.env.PATH ?? ""}\`);\nprocess.exit(0);\n`,
		});
		const owned = fixture.ownedReceipt("owned.md");
		const port = capturingPort();
		const check = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: port,
			runtimeBinaryPath: runtimeBinary,
		});
		const result = await check.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
		});
		expect(result.status).toBe("passed");
		const runtimeReal = realpathSync(runtimeBinary);
		const checkRequests = port.requests.filter(
			(request) => request.command === runtimeReal,
		);
		expect(checkRequests).toHaveLength(1);
		const request = checkRequests[0];
		if (!request) throw new Error("check invocation missing");
		expect(request.env?.BUN_BE_BUN).toBe("1");
		expect(request.env?.PATH).toBe(
			`${dirname(runtimeReal)}:/usr/bin:/bin:/usr/sbin:/sbin`,
		);
		expect(request.environmentMode).toBe("isolated");
		// The nested bare `bun` invocation must have executed the exact admitted
		// bytes with the unaugmented isolated PATH: no ambient interpreter and
		// no machine-shared bun-node shim may be reachable.
		const [nestedExecPath, nestedPath] = readFileSync(receiptPath, "utf8").split("\n");
		expect(realpathSync(nestedExecPath ?? "")).toBe(runtimeReal);
		expect(nestedPath).toBe(
			`${dirname(runtimeReal)}:/usr/bin:/bin:/usr/sbin:/sbin`,
		);
	});

	test("a missing bun alias beside the admitted runtime fails closed as candidate_setup before any spawn or write", async () => {
		const fixture = await candidateFixture();
		const bare = join(fixture.root, "bare-runtime");
		await mkdir(bare, { recursive: true });
		const runtimeBinary = join(bare, "vault-git");
		await writeFile(runtimeBinary, "#!/bin/sh\nexit 64\n");
		await chmod(runtimeBinary, 0o755);
		const port = capturingPort();
		const check = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: port,
			runtimeBinaryPath: runtimeBinary,
		});
		const result = await check.run({
			baselineHead: fixture.head,
			ownedPaths: [fixture.ownedReceipt("owned.md")],
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "candidate_setup",
			stage: "candidate_setup",
		});
		expect(port.requests).toHaveLength(0);
		expect(existsSync(fixture.candidatesRoot)).toBe(false);
	});

	test("a bun alias resolving to different bytes fails closed as candidate_setup", async () => {
		const fixture = await candidateFixture();
		const redirected = join(fixture.root, "redirected-runtime");
		await mkdir(redirected, { recursive: true });
		const runtimeBinary = join(redirected, "vault-git");
		await writeFile(runtimeBinary, "#!/bin/sh\nexit 64\n");
		await chmod(runtimeBinary, 0o755);
		await writeFile(join(redirected, "bun"), "#!/bin/sh\nexit 0\n");
		await chmod(join(redirected, "bun"), 0o755);
		const port = capturingPort();
		const check = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: port,
			runtimeBinaryPath: runtimeBinary,
		});
		const result = await check.run({
			baselineHead: fixture.head,
			ownedPaths: [fixture.ownedReceipt("owned.md")],
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "candidate_setup",
			stage: "candidate_setup",
		});
		expect(port.requests).toHaveLength(0);
		expect(existsSync(fixture.candidatesRoot)).toBe(false);
	});
});

describe("validation candidate containment", () => {
	test("refuses a symlink owned leaf before any overlay write", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		await unlink(join(fixture.vault, "owned.md"));
		await symlink("unrelated.md", join(fixture.vault, "owned.md"));
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(),
			runtimeBinaryPath: process.execPath,
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
		});
		expect(result).toMatchObject({
			status: "failed",
			failureClass: "candidate_setup",
		});
	});

	test("refuses a symlink ancestor escape before any overlay write", async () => {
		const fixture = await candidateFixture();
		const outside = join(fixture.root, "outside");
		await mkdir(outside, { recursive: true });
		await symlink(outside, join(fixture.vault, "escape"));
		git(fixture.vault, "add", "--", "escape");
		git(fixture.vault, "commit", "-m", "add escape symlink");
		const escapeHead = git(fixture.vault, "rev-parse", "refs/heads/main");
		await unlink(join(fixture.vault, "escape"));
		await mkdir(join(fixture.vault, "escape"), { recursive: true });
		await writeFile(join(fixture.vault, "escape", "owned.md"), "escaped frozen\n");
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(),
			runtimeBinaryPath: process.execPath,
		});
		const result = await port.run({
			baselineHead: escapeHead,
			ownedPaths: [
				{ path: "escape/owned.md", baselineHash: null, admittedNewFile: true },
			],
		});
		expect(result).toMatchObject({
			status: "failed",
			failureClass: "candidate_setup",
		});
		expect(await readdir(outside)).toEqual([]);
	});
});

describe("validation failure classes", () => {
	test("classifies a failing vault check as vault_content and still removes the candidate", async () => {
		const fixture = await candidateFixture({ checkTs: "process.exit(2);\n" });
		const owned = fixture.ownedReceipt("owned.md");
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(),
			runtimeBinaryPath: process.execPath,
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "vault_content",
			stage: "vault_check",
		});
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual([]);
		expect(await residueFiles(fixture.candidatesRoot)).toEqual([]);
	});

	test("a dependency-bearing admitted shape refuses as candidate_setup before the check spawns", async () => {
		const fixture = await candidateFixture({
			manifest: {
				name: "fixture-vault",
				scripts: { check: "bun scripts/check.ts" },
				dependencies: { "left-pad": "^1.3.0" },
			},
			checkTs:
				'import leftPad from "left-pad";\nconsole.log(leftPad("1", 2));\nprocess.exit(0);\n',
			extraFiles: {
				"bun.lock":
					'{\n\t"lockfileVersion": 1,\n\t"configVersion": 1,\n\t"workspaces": { "": { "dependencies": { "left-pad": "^1.3.0" } } },\n\t"packages": { "left-pad": ["left-pad@1.3.0", "", {}, "sha512-fixture"] }\n}\n',
			},
		});
		const owned = fixture.ownedReceipt("owned.md");
		const port = capturingPort();
		const check = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: port,
			runtimeBinaryPath: process.execPath,
		});
		const result = await check.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "candidate_setup",
			stage: "candidate_setup",
		});
		expect(port.requests.filter(isCheckInvocation)).toHaveLength(0);
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual([]);
		expect(await residueFiles(fixture.candidatesRoot)).toEqual([]);
	});

	test("classifies a candidate setup process failure as candidate_setup", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort((request) => {
				if (request.args.includes("clone")) {
					return { exitCode: 1, stdout: "", stderr: "", timedOut: false };
				}
				return undefined;
			}),
			runtimeBinaryPath: process.execPath,
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
		});
		expect(result).toMatchObject({
			status: "failed",
			failureClass: "candidate_setup",
		});
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual([]);
	});

	test("classifies a vault check budget breach with stage metadata and still cleans up", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		let checkTimeout: number | undefined;
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort((request) => {
				if (!isCheckInvocation(request)) return undefined;
				checkTimeout = request.timeoutMs;
				return { exitCode: null, stdout: "", stderr: "", timedOut: true };
			}),
			runtimeBinaryPath: process.execPath,
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "stage_budget_exceeded",
			stage: "vault_check",
		});
		expect(checkTimeout).toBeGreaterThan(0);
		expect(checkTimeout).toBeLessThanOrEqual(
			VAULT_GIT_VALIDATION_STAGE_BUDGETS_MS.vault_check,
		);
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual([]);
	});

	test("classifies a setup budget breach with stage metadata via the monotonic clock", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		const clock = { value: 0 };
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort((request) => {
				if (request.args.includes("clone")) {
					clock.value +=
						VAULT_GIT_VALIDATION_STAGE_BUDGETS_MS.candidate_setup + 1;
				}
				return undefined;
			}),
			runtimeBinaryPath: process.execPath,
			monotonicNow: () => clock.value,
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "stage_budget_exceeded",
			stage: "candidate_setup",
		});
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual([]);
	});
});

describe("candidate residue", () => {
	test("classifies a cleanup failure as candidate_cleanup and retains bounded residue metadata", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(),
			runtimeBinaryPath: process.execPath,
			removeCandidate: async () => {
				throw new Error("cleanup refused by fixture");
			},
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
			transactionId: "txn_residue",
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "candidate_cleanup",
			stage: "candidate_cleanup",
		});
		const residue = await residueFiles(fixture.candidatesRoot);
		expect(residue).toHaveLength(1);
		const metadataPath = join(fixture.candidatesRoot, residue[0] ?? "");
		const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
		expect(metadata).toMatchObject({
			schemaVersion: 1,
			transactionId: "txn_residue",
			baselineHead: fixture.head,
			failureClass: "candidate_cleanup",
			stage: "candidate_cleanup",
		});
		expect(typeof metadata.candidateId).toBe("string");
		expect(metadata.candidatePath.startsWith(fixture.candidatesRoot)).toBe(true);
		expect(Number.isNaN(Date.parse(metadata.createdAt))).toBe(false);
		expect(Number.isNaN(Date.parse(metadata.updatedAt))).toBe(false);
		expect(Object.keys(metadata).sort()).toEqual(
			[
				"baselineHead",
				"candidateId",
				"candidatePath",
				"createdAt",
				"failureClass",
				"schemaVersion",
				"stage",
				"transactionId",
				"updatedAt",
			].sort(),
		);
	});

	test("a cleanup that never settles still returns within the cleanup budget as candidate_cleanup", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		const clock = { value: 0 };
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(),
			runtimeBinaryPath: process.execPath,
			monotonicNow: () => clock.value,
			removeCandidate: () => {
				clock.value +=
					VAULT_GIT_VALIDATION_STAGE_BUDGETS_MS.candidate_cleanup + 1;
				return new Promise<void>(() => {});
			},
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
			transactionId: "txn_hung_cleanup",
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "candidate_cleanup",
			stage: "candidate_cleanup",
		});
		expect(await residueFiles(fixture.candidatesRoot)).toHaveLength(1);
	});

	test("a setup process that never settles still returns within the setup budget", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		const clock = { value: 0 };
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort((request) => {
				if (!request.args.includes("clone")) return undefined;
				clock.value +=
					VAULT_GIT_VALIDATION_STAGE_BUDGETS_MS.candidate_setup + 1;
				return new Promise<VaultGitProcessResult>(() => {});
			}),
			runtimeBinaryPath: process.execPath,
			monotonicNow: () => clock.value,
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "stage_budget_exceeded",
			stage: "candidate_setup",
		});
	});

	test("an unsettled vault check abandoned by the budget watcher retains the owned candidate and record instead of racing cleanup", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		const clock = { value: 0 };
		let settleAbandonedCheck: (() => void) | undefined;
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort((request) => {
				if (!isCheckInvocation(request)) return undefined;
				clock.value += VAULT_GIT_VALIDATION_STAGE_BUDGETS_MS.vault_check + 1;
				return new Promise<VaultGitProcessResult>((resolve) => {
					settleAbandonedCheck = () =>
						resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false });
				});
			}),
			runtimeBinaryPath: process.execPath,
			monotonicNow: () => clock.value,
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
			transactionId: "txn_abandoned_check",
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "stage_budget_exceeded",
			stage: "vault_check",
		});
		const abandonedDirs = await candidateDirectories(fixture.candidatesRoot);
		const abandonedRecords = await residueFiles(fixture.candidatesRoot);
		expect(abandonedDirs).toHaveLength(1);
		expect(abandonedRecords).toHaveLength(1);
		const record = JSON.parse(
			await readFile(
				join(fixture.candidatesRoot, abandonedRecords[0] ?? ""),
				"utf8",
			),
		);
		expect(record).toMatchObject({
			transactionId: "txn_abandoned_check",
			stage: "vault_check",
		});
		settleAbandonedCheck?.();
		await Bun.sleep(50);
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual(
			abandonedDirs,
		);
		expect(await residueFiles(fixture.candidatesRoot)).toEqual(abandonedRecords);
	});

	test("classifies a cleanup budget breach as candidate_cleanup and retains residue metadata", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		const clock = { value: 0 };
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(),
			runtimeBinaryPath: process.execPath,
			monotonicNow: () => clock.value,
			removeCandidate: async (candidateRoot) => {
				clock.value +=
					VAULT_GIT_VALIDATION_STAGE_BUDGETS_MS.candidate_cleanup + 1;
				await rm(candidateRoot, { recursive: true, force: true });
			},
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
			transactionId: "txn_cleanup_budget",
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "candidate_cleanup",
			stage: "candidate_cleanup",
		});
		const residue = await residueFiles(fixture.candidatesRoot);
		expect(residue).toHaveLength(1);
		const record = JSON.parse(
			await readFile(join(fixture.candidatesRoot, residue[0] ?? ""), "utf8"),
		);
		expect(record.failureClass).toBeNull();
	});

	test("residue removal refuses traversal and prefix-sibling paths and never deletes outside the candidates root", async () => {
		const fixture = await candidateFixture();
		await mkdir(fixture.candidatesRoot, { recursive: true, mode: 0o700 });
		const victim = join(fixture.privateRoot, "victim");
		await mkdir(victim, { recursive: true });
		await writeFile(join(victim, "keep.txt"), "keep\n");
		const sibling = `${fixture.candidatesRoot}-evil`;
		await mkdir(sibling, { recursive: true });
		await writeFile(join(sibling, "keep.txt"), "keep\n");
		const traversalId = `candidate-${randomUUID()}`;
		await writeFile(
			join(fixture.candidatesRoot, `${traversalId}.json`),
			plantedRecordText(fixture.candidatesRoot, traversalId, {
				candidatePath: `${fixture.candidatesRoot}/../victim`,
			}),
			{ mode: 0o600 },
		);
		const siblingId = `candidate-${randomUUID()}`;
		await writeFile(
			join(fixture.candidatesRoot, `${siblingId}.json`),
			plantedRecordText(fixture.candidatesRoot, siblingId, {
				candidatePath: sibling,
			}),
			{ mode: 0o600 },
		);
		const store = createVaultGitCandidateResidueStore({
			privateStateRoot: fixture.privateRoot,
			ownership: {
				async isTransactionActivelyOwned() {
					return "inactive" as const;
				},
			},
			now: AGED_RESIDUE_NOW,
		});
		expect(await store.remove(traversalId)).toBe("refused_unknown_evidence");
		expect(await store.remove(siblingId)).toBe("refused_unknown_evidence");
		expect(await readdir(victim)).toEqual(["keep.txt"]);
		expect(await readdir(sibling)).toEqual(["keep.txt"]);
		const observed = await store.observe();
		if (observed.status !== "observed") throw new Error("observe failed");
		expect(observed.observations).toHaveLength(2);
		expect(
			observed.observations.every(
				(entry) => entry.kind === "corrupt_evidence",
			),
		).toBe(true);
	});

	test("observe surfaces malformed, extra-field, and unrecorded evidence and fails closed on an unreadable root", async () => {
		const fixture = await candidateFixture();
		await mkdir(fixture.candidatesRoot, { recursive: true, mode: 0o700 });
		const malformedId = `candidate-${randomUUID()}`;
		await writeFile(
			join(fixture.candidatesRoot, `${malformedId}.json`),
			"{broken\n",
			{ mode: 0o600 },
		);
		const extraId = `candidate-${randomUUID()}`;
		await mkdir(join(fixture.candidatesRoot, extraId), { mode: 0o700 });
		await writeFile(
			join(fixture.candidatesRoot, `${extraId}.json`),
			plantedRecordText(fixture.candidatesRoot, extraId, { extra: 1 }),
			{ mode: 0o600 },
		);
		const unrecordedId = `candidate-${randomUUID()}`;
		await mkdir(join(fixture.candidatesRoot, unrecordedId), { mode: 0o700 });
		const store = createVaultGitCandidateResidueStore({
			privateStateRoot: fixture.privateRoot,
			ownership: {
				async isTransactionActivelyOwned() {
					return "inactive" as const;
				},
			},
			now: AGED_RESIDUE_NOW,
		});
		const observed = await store.observe();
		if (observed.status !== "observed") throw new Error("observe failed");
		const corrupt = observed.observations
			.filter(
				(entry): entry is VaultGitCandidateResidueAnomalyObservation =>
					entry.kind === "corrupt_evidence",
			)
			.map((entry) => entry.entryName)
			.sort();
		expect(corrupt).toEqual(
			[`${malformedId}.json`, `${extraId}.json`].sort(),
		);
		const unrecorded = observed.observations
			.filter(
				(entry): entry is VaultGitCandidateResidueAnomalyObservation =>
					entry.kind === "unrecorded_candidate",
			)
			.map((entry) => entry.entryName)
			.sort();
		expect(unrecorded).toEqual([extraId, unrecordedId].sort());
		expect(await store.remove(malformedId)).toBe("refused_unknown_evidence");
		expect(await store.remove(extraId)).toBe("refused_unknown_evidence");
		expect(await store.remove(unrecordedId)).toBe("unknown_record");
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual(
			[extraId, unrecordedId].sort(),
		);
		await chmod(fixture.candidatesRoot, 0o000);
		try {
			expect(await store.observe()).toEqual({
				status: "failed",
				reason: "residue_root_unreadable",
			});
			expect(await store.remove(extraId)).toBe("refused_unknown_evidence");
		} finally {
			await chmod(fixture.candidatesRoot, 0o700);
		}
	});

	test("removal re-proves ownership after observation so changed evidence refuses", async () => {
		const fixture = await candidateFixture();
		await mkdir(fixture.candidatesRoot, { recursive: true, mode: 0o700 });
		const raceId = `candidate-${randomUUID()}`;
		await mkdir(join(fixture.candidatesRoot, raceId), { mode: 0o700 });
		await writeFile(
			join(fixture.candidatesRoot, `${raceId}.json`),
			plantedRecordText(fixture.candidatesRoot, raceId, {
				transactionId: "txn_race",
			}),
			{ mode: 0o600 },
		);
		let ownership: VaultGitCandidateResidueOwnership = "inactive";
		const store = createVaultGitCandidateResidueStore({
			privateStateRoot: fixture.privateRoot,
			ownership: {
				async isTransactionActivelyOwned() {
					return ownership;
				},
			},
			now: AGED_RESIDUE_NOW,
		});
		expect(await store.observe()).toMatchObject({
			status: "observed",
			observations: [{ kind: "record", candidateId: raceId, eligibility: "eligible" }],
		});
		ownership = "active";
		expect(await store.remove(raceId)).toBe("refused_active_owner");
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual([raceId]);
	});

	test("cleanup failure after a content failure still classifies candidate_cleanup and retains residue", async () => {
		const fixture = await candidateFixture({ checkTs: "process.exit(2);\n" });
		const owned = fixture.ownedReceipt("owned.md");
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(),
			runtimeBinaryPath: process.execPath,
			removeCandidate: async () => {
				throw new Error("cleanup refused by fixture");
			},
		});
		const result = await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
			transactionId: "txn_content_then_cleanup",
		});
		expect(result).toEqual({
			status: "failed",
			failureClass: "candidate_cleanup",
			stage: "candidate_cleanup",
		});
		const residue = await residueFiles(fixture.candidatesRoot);
		expect(residue).toHaveLength(1);
		const record = JSON.parse(
			await readFile(join(fixture.candidatesRoot, residue[0] ?? ""), "utf8"),
		);
		expect(record).toMatchObject({
			transactionId: "txn_content_then_cleanup",
			stage: "candidate_cleanup",
			failureClass: "candidate_cleanup",
		});
	});

	test("a residue record that cannot be removed classifies candidate_cleanup instead of clean completion", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(),
			runtimeBinaryPath: process.execPath,
			removeCandidate: async (candidateRoot) => {
				await rm(candidateRoot, { recursive: true, force: true });
				await chmod(fixture.candidatesRoot, 0o500);
			},
		});
		try {
			const result = await port.run({
				baselineHead: fixture.head,
				ownedPaths: [owned],
				transactionId: "txn_record_stuck",
			});
			expect(result).toEqual({
				status: "failed",
				failureClass: "candidate_cleanup",
				stage: "candidate_cleanup",
			});
		} finally {
			await chmod(fixture.candidatesRoot, 0o700);
		}
		const residue = await residueFiles(fixture.candidatesRoot);
		expect(residue).toHaveLength(1);
		const record = JSON.parse(
			await readFile(join(fixture.candidatesRoot, residue[0] ?? ""), "utf8"),
		);
		expect(record).toMatchObject({
			schemaVersion: 1,
			transactionId: "txn_record_stuck",
		});
	});

	test("writes owner-bound residue metadata before the candidate is built so a crash leaves an owned record", async () => {
		const fixture = await candidateFixture();
		const owned = fixture.ownedReceipt("owned.md");
		let observedDuringSetup: unknown;
		const port = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort((request) => {
				if (!request.args.includes("clone")) return undefined;
				const entries = readdirSync(fixture.candidatesRoot).filter((entry) =>
					entry.endsWith(".json"),
				);
				const first = entries[0];
				if (first) {
					observedDuringSetup = JSON.parse(
						readFileSync(join(fixture.candidatesRoot, first), "utf8"),
					);
				}
				return { exitCode: 1, stdout: "", stderr: "", timedOut: false };
			}),
			runtimeBinaryPath: process.execPath,
		});
		await port.run({
			baselineHead: fixture.head,
			ownedPaths: [owned],
			transactionId: "txn_crash",
		});
		expect(observedDuringSetup).toMatchObject({
			schemaVersion: 1,
			transactionId: "txn_crash",
			baselineHead: fixture.head,
			stage: "candidate_setup",
		});
	});

	test("a crashed check leaves owned residue that converges: young and owned residue refuse removal, old proven-unowned removal deletes the clone and retains bounded metadata", async () => {
		const marker = join(await mkdtemp(join(tmpdir(), "vault-git-crash-marker-")), "check-started");
		roots.push(dirname(marker));
		const fixture = await candidateFixture({
			checkTs: [
				'import { writeFileSync } from "node:fs";',
				`writeFileSync(${JSON.stringify(marker)}, "started\\n");`,
				"for (let i = 0; i < 240; i += 1) await Bun.sleep(500);",
				"process.exit(0);",
			].join("\n"),
		});
		const owned = fixture.ownedReceipt("owned.md");
		const harnessPath = join(fixture.root, "crash-harness.ts");
		const modulePath = fileURLToPath(
			new URL("../src/validation-candidate.ts", import.meta.url),
		);
		const adapterPath = fileURLToPath(
			new URL("../src/git-adapter.ts", import.meta.url),
		);
		await writeFile(
			harnessPath,
			[
				`import { createVaultOwnedCheckPort } from ${JSON.stringify(modulePath)};`,
				`import { createNodeProcessPort } from ${JSON.stringify(adapterPath)};`,
				"const port = createVaultOwnedCheckPort({",
				`\trepositoryPath: ${JSON.stringify(fixture.vault)},`,
				`\tprivateStateRoot: ${JSON.stringify(fixture.privateRoot)},`,
				"\tprocess: createNodeProcessPort(),",
				"\truntimeBinaryPath: process.execPath,",
				"});",
				"await port.run({",
				`\tbaselineHead: ${JSON.stringify(fixture.head)},`,
				`\townedPaths: [${JSON.stringify(owned)}],`,
				'\ttransactionId: "txn_killed",',
				"});",
			].join("\n"),
		);
		const child = spawn(process.execPath, [harnessPath], {
			detached: true,
			stdio: "ignore",
		});
		const exited = new Promise<void>((resolve) => {
			child.on("exit", () => resolve());
		});
		const deadline = Date.now() + 20_000;
		while (!existsSync(marker)) {
			if (Date.now() > deadline) throw new Error("check child never started");
			await Bun.sleep(25);
		}
		if (child.pid === undefined) throw new Error("crash harness has no pid");
		process.kill(-child.pid, "SIGKILL");
		await exited;

		const abandoned = await candidateDirectories(fixture.candidatesRoot);
		const residue = await residueFiles(fixture.candidatesRoot);
		expect(abandoned).toHaveLength(1);
		expect(residue).toHaveLength(1);
		const recordText = await readFile(
			join(fixture.candidatesRoot, residue[0] ?? ""),
			"utf8",
		);
		const record = JSON.parse(recordText);
		expect(record).toMatchObject({
			schemaVersion: 1,
			transactionId: "txn_killed",
			baselineHead: fixture.head,
			stage: "vault_check",
			candidatePath: join(fixture.candidatesRoot, abandoned[0] ?? ""),
		});
		expect(recordText).not.toContain(fixture.vault);
		const rootMode = (await lstat(fixture.candidatesRoot)).mode & 0o777;
		expect(rootMode).toBe(0o700);
		const recordMode =
			(await lstat(join(fixture.candidatesRoot, residue[0] ?? ""))).mode & 0o777;
		expect(recordMode).toBe(0o600);

		const laterPort = createVaultOwnedCheckPort({
			repositoryPath: fixture.vault,
			privateStateRoot: fixture.privateRoot,
			process: capturingPort(),
			runtimeBinaryPath: process.execPath,
		});
		await writeFile(join(fixture.vault, "scripts", "check.ts"), "process.exit(0);\n");
		git(fixture.vault, "add", "--", "scripts/check.ts");
		git(fixture.vault, "commit", "-m", "settle check script");
		const settledHead = git(fixture.vault, "rev-parse", "refs/heads/main");
		const later = await laterPort.run({
			baselineHead: settledHead,
			ownedPaths: [owned],
			transactionId: "txn_after_crash",
		});
		expect(later.status).toBe("passed");
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual(abandoned);
		expect(await residueFiles(fixture.candidatesRoot)).toEqual(residue);

		const candidateId = (residue[0] ?? "").slice(0, -".json".length);
		let ownership: VaultGitCandidateResidueOwnership = "inactive";
		const ownershipPort = {
			async isTransactionActivelyOwned() {
				return ownership;
			},
		};
		const youngStore = createVaultGitCandidateResidueStore({
			privateStateRoot: fixture.privateRoot,
			ownership: ownershipPort,
		});
		expect(await youngStore.remove(candidateId)).toBe("refused_young");
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual(abandoned);

		const agedStore = createVaultGitCandidateResidueStore({
			privateStateRoot: fixture.privateRoot,
			ownership: ownershipPort,
			now: () =>
				new Date(
					Date.parse(record.updatedAt) +
						VAULT_GIT_CANDIDATE_RESIDUE_ELIGIBLE_AFTER_MS +
						1,
				),
		});
		ownership = "active";
		expect(await agedStore.remove(candidateId)).toBe("refused_active_owner");
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual(abandoned);
		ownership = "unknown";
		expect(await agedStore.remove(candidateId)).toBe("refused_unknown_owner");
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual(abandoned);
		ownership = "inactive";
		expect(await agedStore.observe()).toMatchObject({
			status: "observed",
			observations: [
				{
					kind: "record",
					candidateId,
					transactionId: "txn_killed",
					candidatePresence: "present",
					eligibility: "eligible",
				},
			],
		});
		expect(await agedStore.remove(candidateId)).toBe("removed");
		expect(await candidateDirectories(fixture.candidatesRoot)).toEqual([]);
		expect(await residueFiles(fixture.candidatesRoot)).toEqual(residue);
		const retained = JSON.parse(
			await readFile(join(fixture.candidatesRoot, residue[0] ?? ""), "utf8"),
		);
		expect(retained).toMatchObject({
			schemaVersion: 1,
			transactionId: "txn_killed",
			stage: "vault_check",
		});
		expect(await agedStore.observe()).toMatchObject({
			status: "observed",
			observations: [{ kind: "record", candidateId, eligibility: "already_removed" }],
		});
	});
});
