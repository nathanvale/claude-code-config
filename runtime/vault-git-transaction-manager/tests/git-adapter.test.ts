import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createGitAdapter, createNodeProcessPort } from "../src/git-adapter.ts";
import type {
	VaultGitProcessPort,
	VaultGitProcessRequest,
	VaultGitProcessResult,
} from "../src/ports.ts";
import { VAULT_GIT_LEDGER_REF } from "../src/remote-ledger.ts";

const fixtureRoots: string[] = [];

afterEach(async () => {
	for (const root of fixtureRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

const GENERATION = "a".repeat(40);
const EXPECTED = "e".repeat(40);
const COMMIT = "b".repeat(40);
const LOCAL_MAIN = "f".repeat(40);

type Responder = (
	request: VaultGitProcessRequest,
) => Partial<VaultGitProcessResult> | undefined;

function fakePort(respond: Responder): VaultGitProcessPort {
	return {
		run(request: VaultGitProcessRequest): Promise<VaultGitProcessResult> {
			return Promise.resolve({
				exitCode: 0,
				stdout: "",
				stderr: "",
				timedOut: false,
				...respond(request),
			});
		},
	};
}

function createFakeAdapter(
	respond: Responder,
	options: {
		readonly allowedRemoteHosts?: readonly string[];
		readonly configuredRemoteUrl?: string;
	} = {},
) {
	return createGitAdapter({
		repositoryPath: "/repository",
		process: fakePort((request) => {
			if (
				request.args[0] === "config" &&
				request.args.includes("remote.origin.url")
			) {
				return {
					stdout: `${options.configuredRemoteUrl ?? "/tmp/remote.git"}\n`,
				};
			}
			if (request.args[0] === "config") return { exitCode: 1 };
			if (request.args[0] === "ls-remote" && request.args[1] === "--get-url") {
				return {
					stdout: `${options.configuredRemoteUrl ?? (request.args[2] === "origin" ? "/tmp/remote.git" : request.args[2]) ?? ""}\n`,
				};
			}
			return respond(request);
		}),
		timeouts: { fetchMs: 1_000, pushMs: 1_000, localMs: 1_000 },
		allowedRemoteHosts: options.allowedRemoteHosts,
	});
}

function ledgerReadResponder(
	contentResponse: Partial<VaultGitProcessResult>,
): Responder {
	return ({ args }) => {
		if (args[0] === "ls-remote") {
			return { stdout: `${GENERATION}\t${VAULT_GIT_LEDGER_REF}\n` };
		}
		if (args[0] === "rev-parse") return { stdout: `${GENERATION}\n` };
		if (args[0] === "show" && args[1] === "-s") return { stdout: "\n" };
		if (args[0] === "show") return contentResponse;
		return {};
	};
}

describe("git adapter construction", () => {
	test("rejects malformed host admissions", () => {
		expect(() =>
			createGitAdapter({
				repositoryPath: "/repository",
				process: fakePort(() => ({})),
				timeouts: { fetchMs: 1_000, pushMs: 1_000, localMs: 1_000 },
				allowedRemoteHosts: ["-example.invalid"],
			}),
		).toThrow("exact DNS names");
	});

	test.each([
		{ environment: { PATH: "/tmp/exploit" } as Readonly<Record<string, string>> },
		{
			environment: {
				GIT_SSH_COMMAND: "ssh\nexploit",
			} as Readonly<Record<string, string>>,
		},
	])(
		"rejects unsafe admitted transport environment %#",
		({ environment }) => {
		expect(() =>
			createGitAdapter({
				repositoryPath: "/repository",
				process: fakePort(() => ({})),
				timeouts: { fetchMs: 1_000, pushMs: 1_000, localMs: 1_000 },
				admittedGitEnvironment: environment,
			}),
		).toThrow("unsafe entry");
		},
	);
});

describe("git adapter ledger reads", () => {
	test("rejects Git transport-helper remotes before process execution", async () => {
		const adapter = createFakeAdapter(() => {
			throw new Error("process must not run");
		});
		await expect(
			adapter.readLedger("ext::sh -c exploit", VAULT_GIT_LEDGER_REF),
		).rejects.toThrow("remote must be one safe Git remote name or URL");
	});

	test.each([
		"origin",
		"https://example.invalid/vault.git",
		"ssh://git@example.invalid/vault.git",
		"file:///tmp/vault.git",
		"/tmp/vault.git",
		"git@example.invalid:vault.git",
	])("accepts supported remote target %s", async (remote) => {
		const adapter = createFakeAdapter(
			({ args }) => (args[0] === "ls-remote" ? { exitCode: 2 } : {}),
			{ allowedRemoteHosts: ["example.invalid"] },
		);
		await expect(adapter.readLedger(remote, VAULT_GIT_LEDGER_REF)).resolves.toEqual(
			{ status: "ok", head: null },
		);
	});

	test.each([
		"ext::sh -c exploit",
		"http://example.invalid/vault.git",
		"git://example.invalid/vault.git",
	])("rejects a named remote whose configured endpoint is unsafe: %s", async (configuredRemoteUrl) => {
		const adapter = createFakeAdapter(() => {
			throw new Error("transport must not run");
		}, { configuredRemoteUrl, allowedRemoteHosts: ["example.invalid"] });
		await expect(
			adapter.readLedger("origin", VAULT_GIT_LEDGER_REF),
		).rejects.toThrow("unsafe transport");
	});

	test("rejects a network host outside the construction allowlist", async () => {
		const adapter = createFakeAdapter(() => {
			throw new Error("transport must not run");
		}, { configuredRemoteUrl: "ssh://git@example.invalid/vault.git" });
		await expect(
			adapter.readLedger("origin", VAULT_GIT_LEDGER_REF),
		).rejects.toThrow("remote host is not admitted");
	});

	test("a timed-out ledger content read fails instead of reporting absence", async () => {
		const adapter = createFakeAdapter(
			ledgerReadResponder({ exitCode: null, timedOut: true }),
		);
		expect(await adapter.readLedger("origin", VAULT_GIT_LEDGER_REF)).toEqual({
			status: "failed",
			reason: "timed_out",
		});
	});

	test("a failed non-missing-path content read fails instead of reporting absence", async () => {
		const adapter = createFakeAdapter(
			ledgerReadResponder({
				exitCode: 128,
				stderr: "fatal: unable to read tree object",
			}),
		);
		expect(await adapter.readLedger("origin", VAULT_GIT_LEDGER_REF)).toEqual({
			status: "failed",
			reason: "remote_unavailable",
		});
	});

	test("only a completed missing-path read reports absent content", async () => {
		const adapter = createFakeAdapter(
			ledgerReadResponder({
				exitCode: 128,
				stderr: `fatal: path 'ledger.json' does not exist in '${GENERATION}'`,
			}),
		);
		expect(await adapter.readLedger("origin", VAULT_GIT_LEDGER_REF)).toEqual({
			status: "ok",
			head: { generation: GENERATION, parents: [], content: null },
		});
	});
});

describe("git adapter main inspection", () => {
	test.each([
		{
			name: "command failure",
			results: [{ exitCode: 128 }, { exitCode: 1 }],
			reason: "remote_unavailable",
		},
		{
			name: "timeout",
			results: [{ exitCode: 1 }, { exitCode: null, timedOut: true }],
			reason: "timed_out",
		},
	] as const)("propagates merge-base $name", async ({ results, reason }) => {
		let ancestryCall = 0;
		const adapter = createFakeAdapter(({ args }) => {
			if (args[0] === "ls-remote") {
				return { stdout: `${GENERATION}\trefs/heads/main\n` };
			}
			if (args[0] === "rev-parse") {
				return {
					stdout: `${args.includes("refs/heads/main^{commit}") ? LOCAL_MAIN : GENERATION}\n`,
				};
			}
			if (args[0] === "merge-base") return results[ancestryCall++];
			return {};
		});
		expect(await adapter.inspectMain("origin")).toEqual({
			status: "failed",
			reason,
		});
		expect(ancestryCall).toBe(2);
	});
});

function appendResponder(options: {
	readonly push: Partial<VaultGitProcessResult>;
	readonly expectedGeneration: string | null;
	readonly reread:
		| { readonly branch: "absent" }
		| { readonly branch: "present"; readonly generation: string };
	readonly appendedCommitIsAncestor?: boolean;
}): Responder {
	return ({ args }) => {
		if (args[0] === "config") return { exitCode: 1 };
		if (args[0] === "hash-object") return { stdout: `${"c".repeat(40)}\n` };
		if (args[0] === "mktree") return { stdout: `${"d".repeat(40)}\n` };
		if (args[0] === "commit-tree") return { stdout: `${COMMIT}\n` };
		if (args[0] === "show" && args[1] === "-s") {
			return args.includes(COMMIT)
				? { stdout: `${options.expectedGeneration ?? ""}\n` }
				: { stdout: "\n" };
		}
		if (args[0] === "push") return options.push;
		if (args[0] === "ls-remote") {
			return options.reread.branch === "absent"
				? { exitCode: 2 }
				: { stdout: `${options.reread.generation}\t${VAULT_GIT_LEDGER_REF}\n` };
		}
		if (args[0] === "rev-parse" && options.reread.branch === "present") {
			return { stdout: `${options.reread.generation}\n` };
		}
		if (args[0] === "show") return { stdout: "{}" };
		if (args[0] === "merge-base") {
			return { exitCode: options.appendedCommitIsAncestor ? 0 : 1 };
		}
		return {};
	};
}

describe("git adapter append classification", () => {
	test("a timed-out bootstrap push with the branch still absent is timed_out", async () => {
		const adapter = createFakeAdapter(
			appendResponder({
				push: { exitCode: null, timedOut: true },
				expectedGeneration: null,
				reread: { branch: "absent" },
			}),
		);
		expect(
			await adapter.appendLedgerCommit({
				remote: "origin",
				ledgerRef: VAULT_GIT_LEDGER_REF,
				expectedGeneration: null,
				content: "{}",
				message: "vault-ledger: acquire txn",
				author: "agent-a",
				timestamp: "2026-08-09T00:00:00.000Z",
			}),
		).toEqual({ status: "refused", reason: "timed_out" });
	});

	test("a failed bootstrap push with the branch still absent is not remote_moved", async () => {
		const adapter = createFakeAdapter(
			appendResponder({
				push: { exitCode: 1 },
				expectedGeneration: null,
				reread: { branch: "absent" },
			}),
		);
		expect(
			await adapter.appendLedgerCommit({
				remote: "origin",
				ledgerRef: VAULT_GIT_LEDGER_REF,
				expectedGeneration: null,
				content: "{}",
				message: "vault-ledger: acquire txn",
				author: "agent-a",
				timestamp: "2026-08-09T00:00:00.000Z",
			}),
		).toEqual({ status: "refused", reason: "remote_unavailable" });
	});

	test("a timed-out push is timed_out even when the re-read shows the old generation", async () => {
		const adapter = createFakeAdapter(
			appendResponder({
				push: { exitCode: null, timedOut: true },
				expectedGeneration: EXPECTED,
				reread: { branch: "present", generation: EXPECTED },
			}),
		);
		expect(
			await adapter.appendLedgerCommit({
				remote: "origin",
				ledgerRef: VAULT_GIT_LEDGER_REF,
				expectedGeneration: EXPECTED,
				content: "{}",
				message: "vault-ledger: acquire txn",
				author: "agent-a",
				timestamp: "2026-08-09T00:00:00.000Z",
			}),
		).toEqual({ status: "refused", reason: "timed_out" });
	});

	test("a timed-out push with a proven competing generation is remote_moved", async () => {
		const adapter = createFakeAdapter(
			appendResponder({
				push: { exitCode: null, timedOut: true },
				expectedGeneration: EXPECTED,
				reread: { branch: "present", generation: GENERATION },
			}),
		);
		expect(
			await adapter.appendLedgerCommit({
				remote: "origin",
				ledgerRef: VAULT_GIT_LEDGER_REF,
				expectedGeneration: EXPECTED,
				content: "{}",
				message: "vault-ledger: acquire txn",
				author: "agent-a",
				timestamp: "2026-08-09T00:00:00.000Z",
			}),
		).toEqual({ status: "refused", reason: "remote_moved" });
	});

	test("a failed push whose commit is in the remote history reports partial state", async () => {
		const adapter = createFakeAdapter(
			appendResponder({
				push: { exitCode: 1 },
				expectedGeneration: EXPECTED,
				reread: { branch: "present", generation: GENERATION },
				appendedCommitIsAncestor: true,
			}),
		);
		expect(
			await adapter.appendLedgerCommit({
				remote: "origin",
				ledgerRef: VAULT_GIT_LEDGER_REF,
				expectedGeneration: EXPECTED,
				content: "{}",
				message: "vault-ledger: acquire txn",
				author: "agent-a",
				timestamp: "2026-08-09T00:00:00.000Z",
			}),
		).toEqual({ status: "refused", reason: "remote_state_unknown" });
	});
});

describe("git adapter process environment", () => {
	test("an ambient GIT_DIR cannot retarget the adapter-owned repository", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-env-"));
		fixtureRoots.push(root);
		const remote = join(root, "remote.git");
		const clone = join(root, "clone");
		const decoy = join(root, "decoy");
		git(root, ["init", "--bare", "--initial-branch=main", remote]);
		git(root, ["clone", remote, clone]);
		git(root, ["init", decoy]);
		const adapter = createGitAdapter({
			repositoryPath: clone,
			process: createNodeProcessPort(),
			timeouts: { fetchMs: 5_000, pushMs: 5_000, localMs: 5_000 },
		});
		const previousGitDir = process.env.GIT_DIR;
		process.env.GIT_DIR = join(decoy, ".git");
		try {
			expect(await adapter.readLedger("origin", VAULT_GIT_LEDGER_REF)).toEqual({
				status: "ok",
				head: null,
			});
		} finally {
			if (previousGitDir === undefined) delete process.env.GIT_DIR;
			else process.env.GIT_DIR = previousGitDir;
		}
	});

	test("ambient executable Git and SSH transport settings are removed", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-env-scrub-"));
		fixtureRoots.push(root);
		const previous = {
			gitSshCommand: process.env.GIT_SSH_COMMAND,
			gitAskpass: process.env.GIT_ASKPASS,
			sshAuthSock: process.env.SSH_AUTH_SOCK,
		};
		process.env.GIT_SSH_COMMAND = "sh -c exploit";
		process.env.GIT_ASKPASS = "/tmp/exploit";
		process.env.SSH_AUTH_SOCK = "/tmp/agent.sock";
		try {
			const result = await createNodeProcessPort().run({
				command: process.execPath,
				args: [
					"-e",
					"process.stdout.write(JSON.stringify({gitSshCommand:process.env.GIT_SSH_COMMAND,gitAskpass:process.env.GIT_ASKPASS,sshAuthSock:process.env.SSH_AUTH_SOCK}))",
				],
				cwd: root,
				timeoutMs: 5_000,
			});
			expect(JSON.parse(result.stdout)).toEqual({});
		} finally {
			restoreEnvironment("GIT_SSH_COMMAND", previous.gitSshCommand);
			restoreEnvironment("GIT_ASKPASS", previous.gitAskpass);
			restoreEnvironment("SSH_AUTH_SOCK", previous.sshAuthSock);
		}
	});

	test("adapter pushes bypass repository pre-push hooks", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-hooks-"));
		fixtureRoots.push(root);
		const remote = join(root, "remote.git");
		const clone = join(root, "clone");
		const hooks = join(root, "hooks");
		const marker = join(root, "hook-ran");
		git(root, ["init", "--bare", "--initial-branch=main", remote]);
		git(root, ["clone", remote, clone]);
		await mkdir(hooks);
		await writeFile(join(hooks, "pre-push"), `#!/bin/sh\ntouch '${marker}'\n`);
		await chmod(join(hooks, "pre-push"), 0o700);
		git(clone, ["config", "core.hooksPath", hooks]);
		const adapter = createGitAdapter({
			repositoryPath: clone,
			process: createNodeProcessPort(),
			timeouts: { fetchMs: 5_000, pushMs: 5_000, localMs: 5_000 },
		});
		expect(
			await adapter.appendLedgerCommit({
				remote: "origin",
				ledgerRef: VAULT_GIT_LEDGER_REF,
				expectedGeneration: null,
				content: "{}",
				message: "vault-ledger: acquire txn",
				author: "agent-a",
				timestamp: "2026-08-09T00:00:00.000Z",
			}),
		).toMatchObject({ status: "appended" });
		await expect(Bun.file(marker).exists()).resolves.toBe(false);
	});

	test("repository executable transport configuration fails closed", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-config-guard-"));
		fixtureRoots.push(root);
		const remote = join(root, "remote.git");
		const clone = join(root, "clone");
		git(root, ["init", "--bare", "--initial-branch=main", remote]);
		git(root, ["clone", remote, clone]);
		git(clone, ["config", "core.sshCommand", "sh -c exploit"]);
		const adapter = createGitAdapter({
			repositoryPath: clone,
			process: createNodeProcessPort(),
			timeouts: { fetchMs: 5_000, pushMs: 5_000, localMs: 5_000 },
		});
		await expect(
			adapter.readLedger("origin", VAULT_GIT_LEDGER_REF),
		).rejects.toThrow("executable transport helper");
	});
});

describe("node process port", () => {
	test("caps stdout and stderr capture independently", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-capture-cap-"));
		fixtureRoots.push(root);
		const result = await createNodeProcessPort().run({
			command: process.execPath,
			args: [
				"-e",
				'process.stdout.write("o".repeat(9 * 1024 * 1024)); process.stderr.write("e".repeat(9 * 1024 * 1024));',
			],
			cwd: root,
			timeoutMs: 10_000,
		});
		expect(result.exitCode).toBe(0);
		expect(Buffer.byteLength(result.stdout)).toBe(8 * 1024 * 1024);
		expect(Buffer.byteLength(result.stderr)).toBe(8 * 1024 * 1024);
	});

	test("survives a child that exits before consuming stdin", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-epipe-"));
		fixtureRoots.push(root);
		const result = await createNodeProcessPort().run({
			command: "true",
			args: [],
			cwd: root,
			stdin: "x".repeat(1 << 20),
			timeoutMs: 5_000,
		});
		expect(result.exitCode).toBe(0);
		expect(result.timedOut).toBe(false);
	});

	test("settles after SIGKILL even when a grandchild holds inherited stdio", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-sigkill-"));
		fixtureRoots.push(root);
		const started = Date.now();
		const result = await createNodeProcessPort().run({
			command: "sh",
			args: ["-c", "sleep 30 & exec sleep 30"],
			cwd: root,
			timeoutMs: 100,
		});
		expect(result.timedOut).toBe(true);
		expect(Date.now() - started).toBeLessThan(4_000);
	});
});

function git(repositoryPath: string, args: readonly string[]): string {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: repositoryPath,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.toString() || `git ${args[0]} failed`);
	}
	return result.stdout.toString().trim();
}

function restoreEnvironment(key: string, value: string | undefined): void {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}
