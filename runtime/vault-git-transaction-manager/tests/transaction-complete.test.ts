import { execFileSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
	buildVaultCommitMessage,
	validateVaultCommitSubject,
} from "../src/commit-policy.ts";
import {
	createGitAdapter,
	createGitRepositoryAdapter,
	createNodeProcessPort,
} from "../src/git-adapter.ts";
import { createVaultGitTransactionEngine } from "../src/engine.ts";
import type { VaultGitProcessPort, VaultGitRuntimePort } from "../src/ports.ts";
import { createReceiptStore } from "../src/store.ts";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("transaction completion policy", () => {
	test("builds one validated semantic subject with stable trailers", () => {
		expect(
			buildVaultCommitMessage({
				subject: "docs(vault): record accepted decision",
				event: "decision_accepted",
				transactionId: `txn_${"1".repeat(32)}`,
				actor: "agent-a",
			}),
		).toBe(
			`docs(vault): record accepted decision\n\nVault-Event: decision_accepted\nVault-Transaction: txn_${"1".repeat(32)}\nVault-Actor: agent-a\n`,
		);
	});

	test("rejects invalid, secret-like, trailer-bearing, and private-path subjects", () => {
		for (const subject of [
			"record decision",
			"docs(vault): token=super-secret",
			"docs(vault): update /Users/example/private-vault",
			"docs(vault): update\nVault-Actor: forged",
		]) {
			expect(validateVaultCommitSubject(subject, "decision_accepted")).toEqual({
				status: "refused",
				reason: expect.any(String),
			});
		}
	});

	test("scrubs ambient pathspec mode toggles from Git subprocesses", async () => {
		const keys = [
			"GIT_LITERAL_PATHSPECS",
			"GIT_GLOB_PATHSPECS",
			"GIT_NOGLOB_PATHSPECS",
			"GIT_ICASE_PATHSPECS",
		] as const;
		const root = await mkdtemp(join(tmpdir(), "vault-git-pathspec-env-"));
		roots.push(root);
		const script = join(root, "scrub-pathspec-env.ts");
		await writeFile(
			script,
			`import { createNodeProcessPort } from ${JSON.stringify(new URL("../src/git-adapter.ts", import.meta.url).href)}
const result = await createNodeProcessPort().run({
  command: process.execPath,
  args: ["-e", ${JSON.stringify(`process.stdout.write(JSON.stringify(${JSON.stringify(keys)}.filter((key) => process.env[key])))`)}],
  cwd: process.cwd(),
  timeoutMs: 5_000,
})
process.stdout.write(result.stdout)
`,
		);
		const environment = { ...process.env };
		for (const key of keys) environment[key] = "1";
		expect(
			execFileSync(process.execPath, [script], {
				cwd: root,
				env: environment,
				encoding: "utf8",
			}),
		).toBe("[]");
	});
});

describe("exact owned-path commit", () => {
	test("commits only admitted content and preserves unrelated staged, unstaged, and untracked state", async () => {
		const repository = await repositoryFixture();
		await writeFile(join(repository.root, "staged.md"), "staged after\n");
		git(repository.root, "add", "--", "staged.md");
		await writeFile(join(repository.root, "unstaged.md"), "unstaged after\n");
		await writeFile(join(repository.root, "untracked.md"), "untracked\n");

		const cleanAdmission = await repository.adapter.inspectOwnedPaths(["owned.md"]);
		if (cleanAdmission.status !== "admitted") throw new Error(`admission failed: ${cleanAdmission.reason}`);
		await writeFile(join(repository.root, "owned.md"), "owned after\n");

		const beforeUnrelatedIndex = gitBuffer(repository.root, "ls-files", "--stage", "-z", "--", "staged.md");
		const beforeUnstaged = await readFile(join(repository.root, "unstaged.md"));
		const beforeUntracked = await readFile(join(repository.root, "untracked.md"));
		if (!repository.adapter.commitExact) throw new Error("exact commit unavailable");
		const committed = await repository.adapter.commitExact({
			baselineHead: repository.head,
			ownedPaths: cleanAdmission.paths,
			unrelatedState: cleanAdmission.unrelatedState,
			message: `docs(vault): update owned note\n\nVault-Event: note_created\nVault-Transaction: txn_${"2".repeat(32)}\nVault-Actor: agent-a\n`,
			author: "agent-a",
			timestamp: "2026-08-09T00:00:00.000Z",
		});
		expect(committed).toMatchObject({ status: "committed" });
		expect(git(repository.root, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")).toBe("owned.md");
		expect(git(repository.root, "show", "HEAD:owned.md")).toBe("owned after");
		expect(gitBuffer(repository.root, "ls-files", "--stage", "-z", "--", "staged.md")).toEqual(beforeUnrelatedIndex);
		expect(await readFile(join(repository.root, "unstaged.md"))).toEqual(beforeUnstaged);
		expect(await readFile(join(repository.root, "untracked.md"))).toEqual(beforeUntracked);
	});

	test("treats leading dashes and pathspec magic characters as literal paths", async () => {
		const repository = await repositoryFixture(["-owned.md", ":magic*[x]\n.md"]);
		const admission = await repository.adapter.inspectOwnedPaths([
			"-owned.md",
			":magic*[x]\n.md",
		]);
		if (admission.status !== "admitted") throw new Error(`admission failed: ${admission.reason}`);
		await writeFile(join(repository.root, "-owned.md"), "dash after\n");
		await writeFile(join(repository.root, ":magic*[x]\n.md"), "magic after\n");
		if (!repository.adapter.commitExact) throw new Error("exact commit unavailable");
		const committed = await repository.adapter.commitExact({
			baselineHead: repository.head,
			ownedPaths: admission.paths,
			unrelatedState: admission.unrelatedState,
			message: `docs(vault): update literal notes\n\nVault-Event: note_created\nVault-Transaction: txn_${"3".repeat(32)}\nVault-Actor: agent-a\n`,
			author: "agent-a",
			timestamp: "2026-08-09T00:00:00.000Z",
		});
		expect(committed).toMatchObject({ status: "committed" });
		expect(gitBuffer(repository.root, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD").toString("utf8").split("\0").filter(Boolean).sort()).toEqual(["-owned.md", ":magic*[x]\n.md"].sort());
	});

	test("freezes an admitted move, new file, and deletion as one exact tree delta", async () => {
		const repository = await repositoryFixture(["source.md", "deleted.md"]);
		const admission = await repository.adapter.inspectOwnedPaths([
			"source.md",
			"destination.md",
			"new.md",
			"deleted.md",
		]);
		if (admission.status !== "admitted") {
			throw new Error(`admission failed: ${admission.reason}`);
		}
		await rename(
			join(repository.root, "source.md"),
			join(repository.root, "destination.md"),
		);
		await writeFile(join(repository.root, "new.md"), "new\n");
		await unlink(join(repository.root, "deleted.md"));
		if (!repository.adapter.commitExact) throw new Error("exact commit unavailable");
		const committed = await repository.adapter.commitExact({
			baselineHead: repository.head,
			ownedPaths: admission.paths,
			unrelatedState: admission.unrelatedState,
			message: `docs(vault): move and update admitted notes\n\nVault-Event: document_moved\nVault-Transaction: txn_${"4".repeat(32)}\nVault-Actor: agent-a\n`,
			author: "agent-a",
			timestamp: "2026-08-09T00:00:00.000Z",
		});
		expect(committed).toMatchObject({ status: "committed" });
		expect(
			gitBuffer(repository.root, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD")
				.toString("utf8")
				.split("\0")
				.filter(Boolean)
				.sort(),
		).toEqual(["deleted.md", "destination.md", "new.md", "source.md"]);
	});

	test("refuses ignored paths and symlink escapes before admission", async () => {
		const repository = await repositoryFixture();
		await writeFile(join(repository.root, ".gitignore"), "ignored.md\n");
		expect(await repository.adapter.inspectOwnedPaths(["ignored.md"])).toEqual({
			status: "refused",
			reason: "ignored",
		});
		await mkdir(join(repository.root, "outside"));
		await symlink(join(repository.root, "outside"), join(repository.root, "escape"));
		expect(await repository.adapter.inspectOwnedPaths(["escape/note.md"])).toMatchObject({
			status: "refused",
		});
	});

	test("refuses an owned path that becomes a symlink after admission", async () => {
		const repository = await repositoryFixture();
		const admission = await repository.adapter.inspectOwnedPaths(["new.md"]);
		if (admission.status !== "admitted") throw new Error("admission failed");
		await symlink("owned.md", join(repository.root, "new.md"));
		if (!repository.adapter.commitExact) throw new Error("exact commit unavailable");
		expect(
			await repository.adapter.commitExact({
				baselineHead: repository.head,
				ownedPaths: admission.paths,
				unrelatedState: admission.unrelatedState,
				message: `docs(vault): add admitted note\n\nVault-Event: note_created\nVault-Transaction: txn_${"6".repeat(32)}\nVault-Actor: agent-a\n`,
				author: "agent-a",
				timestamp: "2026-08-09T00:00:00.000Z",
			}),
		).toEqual({ status: "refused", reason: "owned_path_symlink" });
	});

	test("keeps the frozen validated blob when an editor writes after freeze", async () => {
		let changedAfterFreeze = false;
		const repository = await repositoryFixture([], async (root) => {
			changedAfterFreeze = true;
			await writeFile(join(root, "owned.md"), "late editor change\n");
		});
		const admission = await repository.adapter.inspectOwnedPaths(["owned.md"]);
		if (admission.status !== "admitted") throw new Error("admission failed");
		await writeFile(join(repository.root, "owned.md"), "validated change\n");
		if (!repository.adapter.commitExact) throw new Error("exact commit unavailable");
		expect(
			await repository.adapter.commitExact({
				baselineHead: repository.head,
				ownedPaths: admission.paths,
				unrelatedState: admission.unrelatedState,
				message: `docs(vault): freeze admitted note\n\nVault-Event: note_created\nVault-Transaction: txn_${"5".repeat(32)}\nVault-Actor: agent-a\n`,
				author: "agent-a",
				timestamp: "2026-08-09T00:00:00.000Z",
			}),
		).toMatchObject({ status: "committed" });
		expect(changedAfterFreeze).toBe(true);
		expect(git(repository.root, "show", "HEAD:owned.md")).toBe("validated change");
		expect(await readFile(join(repository.root, "owned.md"), "utf8")).toBe(
			"late editor change\n",
		);
		expect(git(repository.root, "diff", "--", "owned.md")).toContain(
			"+late editor change",
		);
	});

	test("expands a directory request to its tracked leaf set before admission", async () => {
		const repository = await repositoryFixture(["notes/a.md", "notes/b.md"]);
		const admission = await repository.adapter.inspectOwnedPaths(["notes"]);
		expect(admission).toMatchObject({ status: "admitted" });
		if (admission.status !== "admitted") throw new Error("admission failed");
		expect(admission.paths.map((entry) => entry.path)).toEqual([
			"notes/a.md",
			"notes/b.md",
		]);
	});
});

describe("complete transaction", () => {
	test("creates one semantic commit and closes main with the release ledger", async () => {
		const fixture = await engineRepositoryFixture();
		const begun = await fixture.engine.begin({
			event: "note_created",
			requestedPaths: ["owned.md"],
			remote: "origin",
			leaseDurationMs: 60_000,
		});
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) {
			throw new Error("begin failed");
		}
		await writeFile(join(fixture.clone, "owned.md"), "owned after\n");
		const capability = await fixture.store.readCapability(begun.receiptId, "owner");
		const completed = await fixture.engine.complete({
			transactionId: begun.transactionId,
			remote: "origin",
			capability,
			summary: "docs(vault): record admitted note",
		});
		expect(completed).toMatchObject({
			status: "completed",
			state: "closed",
			phase: "closed",
		});
		const remoteMain = git(fixture.bare, "rev-parse", "refs/heads/main");
		expect(git(fixture.clone, "rev-parse", "refs/heads/main")).toBe(remoteMain);
		expect(git(fixture.clone, "show", "-s", "--format=%B", remoteMain)).toContain(
			`Vault-Transaction: ${begun.transactionId}`,
		);
		const loaded = await fixture.store.load();
		expect(loaded).toMatchObject({
			status: "loaded",
			receipt: {
				phase: "closed",
				commitId: remoteMain,
				expectedMainCommit: remoteMain,
				ledgerReleaseId: expect.stringMatching(/^[0-9a-f]{40}$/),
				pushOutcome: "closed",
			},
		});
	});

	test("check failure records a repair action without creating a commit", async () => {
		const fixture = await engineRepositoryFixture(false);
		const begun = await fixture.engine.begin({
			event: "note_created",
			requestedPaths: ["owned.md"],
			remote: "origin",
			leaseDurationMs: 60_000,
		});
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) {
			throw new Error("begin failed");
		}
		await writeFile(join(fixture.clone, "owned.md"), "owned after\n");
		const capability = await fixture.store.readCapability(begun.receiptId, "owner");
		expect(
			await fixture.engine.complete({
				transactionId: begun.transactionId,
				remote: "origin",
				capability,
				summary: "docs(vault): record admitted note",
			}),
		).toMatchObject({
			status: "refused",
			phase: "repairable",
			blocker: "vault_check_failed",
			nextAction: { id: "run_repair" },
		});
		expect(git(fixture.clone, "rev-parse", "refs/heads/main")).toBe(fixture.mainHead);
	});

	test("refuses a completion recipient switch", async () => {
		const fixture = await engineRepositoryFixture();
		const begun = await fixture.engine.begin({
			event: "note_created",
			requestedPaths: ["owned.md"],
			remote: "origin",
			leaseDurationMs: 60_000,
		});
		if (begun.status !== "admitted" || !begun.receiptId || !begun.transactionId) {
			throw new Error("begin failed");
		}
		const capability = await fixture.store.readCapability(begun.receiptId, "owner");
		expect(
			await fixture.engine.complete({
				transactionId: begun.transactionId,
				remote: "replacement",
				capability,
				summary: "docs(vault): record admitted note",
			}),
		).toMatchObject({ status: "refused", blocker: "transaction_mismatch" });
		expect(git(fixture.clone, "rev-parse", "refs/heads/main")).toBe(fixture.mainHead);
	});
});

async function repositoryFixture(
	extraPaths: readonly string[] = [],
	afterFreeze?: (root: string) => Promise<void>,
) {
	const root = await mkdtemp(join(tmpdir(), "vault-git-complete-"));
	roots.push(root);
	git(root, "init", "-b", "main");
	git(root, "config", "user.name", "Fixture");
	git(root, "config", "user.email", "fixture@example.invalid");
	for (const path of ["owned.md", "staged.md", "unstaged.md", ...extraPaths]) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), `${path} before\n`);
	}
	git(root, "add", "--all");
	git(root, "commit", "-m", "initial");
	const nodeProcess = createNodeProcessPort();
	const processPort: VaultGitProcessPort = afterFreeze
		? {
				async run(request) {
					const result = await nodeProcess.run(request);
					if (
						result.exitCode === 0 &&
						request.args[0] === "write-tree" &&
						request.env?.GIT_INDEX_FILE
					) {
						await afterFreeze(root);
					}
					return result;
				},
			}
		: nodeProcess;
	const adapter = createGitRepositoryAdapter({
		repositoryPath: root,
		repositoryIdentity: "fixture-vault",
		process: processPort,
		timeouts: { fetchMs: 5_000, pushMs: 5_000, localMs: 5_000 },
	});
	return { root, adapter, head: git(root, "rev-parse", "refs/heads/main") };
}

async function engineRepositoryFixture(checkPasses = true) {
	const root = await mkdtemp(join(tmpdir(), "vault-git-engine-complete-"));
	roots.push(root);
	const bare = join(root, "remote.git");
	const clone = join(root, "clone");
	git(root, "init", "--bare", bare);
	git(root, "clone", bare, clone);
	git(clone, "checkout", "-b", "main");
	git(clone, "config", "user.name", "Fixture");
	git(clone, "config", "user.email", "fixture@example.invalid");
	await writeFile(join(clone, "owned.md"), "owned before\n");
	git(clone, "add", "--all");
	git(clone, "commit", "-m", "initial");
	git(clone, "push", "origin", "refs/heads/main:refs/heads/main");
	const mainHead = git(clone, "rev-parse", "refs/heads/main");
	const processPort = createNodeProcessPort();
	const timeouts = { fetchMs: 5_000, pushMs: 5_000, localMs: 5_000 };
	const repository = createGitRepositoryAdapter({
		repositoryPath: clone,
		repositoryIdentity: "fixture-vault",
		process: processPort,
		timeouts,
	});
	const remote = createGitAdapter({
		repositoryPath: clone,
		process: processPort,
		timeouts,
	});
	const store = createReceiptStore({
		stateRoot: join(root, "state"),
		repositoryIdentity: "fixture-vault",
	});
	const runtime = new CompletionRuntime();
	const engine = createVaultGitTransactionEngine({
		store,
		repository,
		ledger: { git: remote, clock: runtime },
		runtime,
		repositoryIdentity: "fixture-vault",
		check: {
			async run() {
				return checkPasses
					? { status: "passed" as const }
					: { status: "failed" as const, reason: "check_failed" as const };
			},
		},
	});
	return { root, bare, clone, store, engine, mainHead };
}

class CompletionRuntime implements VaultGitRuntimePort {
	private receiptCounter = 0;
	private tick = 0;
	now(): Date {
		this.tick += 1;
		return new Date(Date.parse("2026-08-09T00:00:00.000Z") + this.tick * 1_000);
	}
	actor(): string {
		return "agent-a";
	}
	host(): string {
		return "host-a";
	}
	newReceiptId(): string {
		this.receiptCounter += 1;
		return `receipt_${String(this.receiptCounter).padStart(32, "0")}`;
	}
	interrupt(): void {}
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function gitBuffer(cwd: string, ...args: string[]): Buffer {
	return execFileSync("git", args, { cwd });
}
