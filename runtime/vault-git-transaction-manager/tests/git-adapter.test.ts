import { mkdtemp, rm } from "node:fs/promises";
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

function createFakeAdapter(respond: Responder) {
	return createGitAdapter({
		repositoryPath: "/repository",
		process: fakePort(respond),
		timeouts: { fetchMs: 1_000, pushMs: 1_000, localMs: 1_000 },
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

describe("git adapter ledger reads", () => {
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

function appendResponder(options: {
	readonly push: Partial<VaultGitProcessResult>;
	readonly expectedGeneration: string | null;
	readonly reread:
		| { readonly branch: "absent" }
		| { readonly branch: "present"; readonly generation: string };
}): Responder {
	return ({ args }) => {
		if (args[0] === "config") return { exitCode: 1 };
		if (args[0] === "hash-object") return { stdout: `${"c".repeat(40)}\n` };
		if (args[0] === "mktree") return { stdout: `${"d".repeat(40)}\n` };
		if (args[0] === "commit-tree") return { stdout: `${COMMIT}\n` };
		if (args[0] === "show" && args[1] === "-s") {
			return args[3] === COMMIT
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
});

describe("git adapter atomic close reconciliation", () => {
	test("unknown ancestry stays push_pending instead of host_contract_breach", async () => {
		const remoteMainNow = "f".repeat(40);
		const ledgerCommit = "9".repeat(40);
		const temporaryRefCommits = new Map<string, string>();
		const adapter = createFakeAdapter(({ args }) => {
			if (args[0] === "config") return { exitCode: 1 };
			if (args[0] === "show" && args[1] === "-s") return { stdout: `${EXPECTED}\n` };
			if (args[0] === "hash-object") return { stdout: `${"c".repeat(40)}\n` };
			if (args[0] === "mktree") return { stdout: `${"d".repeat(40)}\n` };
			if (args[0] === "commit-tree") return { stdout: `${ledgerCommit}\n` };
			if (args[0] === "push") return { exitCode: 1 };
			if (args[0] === "fetch") {
				const [source, temporaryRef] = String(args[3] ?? "").split(":");
				temporaryRefCommits.set(
					String(temporaryRef),
					source === "refs/heads/main" ? remoteMainNow : ledgerCommit,
				);
				return {};
			}
			if (args[0] === "rev-parse") {
				const target = String(args[2] ?? "").replace("^{commit}", "");
				return { stdout: `${temporaryRefCommits.get(target) ?? ""}\n` };
			}
			// merge-base --is-ancestor times out: ancestry is unknown, not "no".
			if (args[0] === "merge-base") return { exitCode: null, timedOut: true };
			return {};
		});
		expect(
			await adapter.atomicClose?.({
				remote: "origin",
				expectedMainHead: EXPECTED,
				mainCommit: COMMIT,
				ledgerRef: VAULT_GIT_LEDGER_REF,
				expectedLedgerGeneration: GENERATION,
				ledgerContent: "{}",
				ledgerMessage: "vault-ledger: release txn",
				author: "agent-a",
				timestamp: "2026-08-09T00:00:00.000Z",
				onPrepared() {},
			}),
		).toMatchObject({ status: "push_pending" });
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
});

describe("node process port", () => {
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
