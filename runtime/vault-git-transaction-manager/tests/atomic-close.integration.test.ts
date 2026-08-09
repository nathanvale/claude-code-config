import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createGitAdapter, createNodeProcessPort } from "../src/git-adapter.ts";
import { VAULT_GIT_LEDGER_REF } from "../src/model.ts";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("atomic remote close", () => {
	test("advances main and the release ledger in one atomic full-ref push", async () => {
		const fixture = await remoteFixture();
		const prepared: Array<{ mainCommit: string; ledgerCommit: string }> = [];
		const result = await fixture.adapter.atomicClose?.({
			remote: "origin",
			expectedMainHead: fixture.mainHead,
			mainCommit: fixture.candidate,
			ledgerRef: VAULT_GIT_LEDGER_REF,
			expectedLedgerGeneration: fixture.ledgerHead,
			ledgerContent: fixture.releaseContent,
			ledgerMessage: `vault-ledger: release txn_${"1".repeat(32)}`,
			author: "agent-a",
			timestamp: "2026-08-09T00:00:00.000Z",
			onPrepared(evidence) {
				prepared.push(evidence);
			},
		});
		expect(result).toMatchObject({ status: "closed" });
		expect(prepared).toHaveLength(1);
		expect(git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(fixture.candidate);
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(prepared[0]?.ledgerCommit);
	});

	test("remote main movement rejects both ref updates", async () => {
		const fixture = await remoteFixture();
		const competing = commitFile(fixture.clone, "competing.md", "competing\n", "competing");
		git(fixture.clone, "push", "origin", `${competing}:refs/heads/main`);
		const result = await fixture.adapter.atomicClose?.({
			remote: "origin",
			expectedMainHead: fixture.mainHead,
			mainCommit: fixture.candidate,
			ledgerRef: VAULT_GIT_LEDGER_REF,
			expectedLedgerGeneration: fixture.ledgerHead,
			ledgerContent: fixture.releaseContent,
			ledgerMessage: `vault-ledger: release txn_${"1".repeat(32)}`,
			author: "agent-a",
			timestamp: "2026-08-09T00:00:00.000Z",
			onPrepared() {},
		});
		expect(result).toMatchObject({ status: "host_contract_breach" });
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(fixture.ledgerHead);
	});
});

async function remoteFixture() {
	const root = await mkdtemp(join(tmpdir(), "vault-git-atomic-"));
	roots.push(root);
	const bare = join(root, "remote.git");
	const clone = join(root, "clone");
	git(root, "init", "--bare", bare);
	git(root, "clone", bare, clone);
	git(clone, "checkout", "-b", "main");
	git(clone, "config", "user.name", "Fixture");
	git(clone, "config", "user.email", "fixture@example.invalid");
	const mainHead = commitFile(clone, "initial.md", "initial\n", "initial");
	git(clone, "push", "origin", "refs/heads/main:refs/heads/main");
	const ledgerBlob = gitInput(clone, "held\n", "hash-object", "-w", "--stdin");
	const ledgerTree = gitInput(clone, `100644 blob ${ledgerBlob}\tledger.json\n`, "mktree");
	const ledgerHead = git(clone, "commit-tree", ledgerTree, "-m", "held");
	git(clone, "push", "origin", `${ledgerHead}:${VAULT_GIT_LEDGER_REF}`);
	writeFileSync(join(clone, "candidate.md"), "candidate\n");
	git(clone, "add", "--", "candidate.md");
	const candidateTree = git(clone, "write-tree");
	const candidate = git(clone, "commit-tree", candidateTree, "-p", mainHead, "-m", "candidate");
	const releaseContent = `${JSON.stringify({
		schema_version: 1,
		operation: "release",
		previous_generation: ledgerHead,
		transitioned_at: "2026-08-09T00:00:00.000Z",
		lease: {
			transaction_id: `txn_${"1".repeat(32)}`,
			actor: "agent-a",
			host: "host-a",
			event: "note_created",
			owned_paths: ["candidate.md"],
			local_main_head: mainHead,
			remote_main_head: mainHead,
			acquired_at: "2026-08-09T00:00:00.000Z",
			lease_duration_ms: 60_000,
			state: "released",
		},
	})}\n`;
	const adapter = createGitAdapter({
		repositoryPath: clone,
		process: createNodeProcessPort(),
		timeouts: { fetchMs: 5_000, pushMs: 5_000, localMs: 5_000 },
	});
	return { root, bare, clone, adapter, mainHead, ledgerHead, candidate, releaseContent };
}

function commitFile(cwd: string, path: string, content: string, message: string): string {
	mkdirSync(join(cwd, path, ".."), { recursive: true });
	writeFileSync(join(cwd, path), content);
	git(cwd, "add", "--", path);
	git(cwd, "commit", "-m", message);
	return git(cwd, "rev-parse", "HEAD");
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function gitInput(cwd: string, input: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, input, encoding: "utf8" }).trim();
}
