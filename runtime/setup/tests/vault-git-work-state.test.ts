import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectVaultGitWorkState } from "../src/vault-git-work-state.ts";

const REPOSITORY_ID = "a".repeat(64);
const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function makeStateRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "setup-vault-git-work-state-"));
	temporaryRoots.push(root);
	return root;
}

async function writeRepositoryFile(
	stateRoot: string,
	relativePath: readonly string[],
	bytes: string,
): Promise<string> {
	const path = join(stateRoot, "vault-git-transaction-manager", REPOSITORY_ID, ...relativePath);
	await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
	await writeFile(path, bytes, { mode: 0o600 });
	return path;
}

describe("Vault Git work-state evidence", () => {
	test("a missing manager root is clear", async () => {
		const stateRoot = await makeStateRoot();
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("clear");
	});

	test("an open transaction receipt is active", async () => {
		const stateRoot = await makeStateRoot();
		await writeRepositoryFile(stateRoot, ["current.json"], `${JSON.stringify({ phase: "writing" })}\n`);
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("active");
	});

	test("a closed receipt with no tasks is clear", async () => {
		const stateRoot = await makeStateRoot();
		await writeRepositoryFile(stateRoot, ["current.json"], `${JSON.stringify({ phase: "closed" })}\n`);
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("clear");
	});

	test("a nonterminal Completion Task is active", async () => {
		const stateRoot = await makeStateRoot();
		await writeRepositoryFile(stateRoot, ["current.json"], `${JSON.stringify({ phase: "closed" })}\n`);
		await writeRepositoryFile(
			stateRoot,
			["tasks", "task-1", "history", "000000000002.json"],
			`${JSON.stringify({ phase: "running" })}\n`,
		);
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("active");
	});

	test("a nonterminal Doctor Task is active", async () => {
		const stateRoot = await makeStateRoot();
		await writeRepositoryFile(stateRoot, ["current.json"], `${JSON.stringify({ phase: "closed" })}\n`);
		await writeRepositoryFile(
			stateRoot,
			["doctor-tasks", "doctor-1", "history", "000000000001.json"],
			`${JSON.stringify({ phase: "admitted" })}\n`,
		);
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("active");
	});

	test("terminal tasks under a closed receipt stay clear", async () => {
		const stateRoot = await makeStateRoot();
		await writeRepositoryFile(stateRoot, ["current.json"], `${JSON.stringify({ phase: "closed" })}\n`);
		await writeRepositoryFile(
			stateRoot,
			["tasks", "task-1", "history", "000000000003.json"],
			`${JSON.stringify({ phase: "terminal" })}\n`,
		);
		await writeRepositoryFile(
			stateRoot,
			["doctor-tasks", "doctor-1", "history", "000000000002.json"],
			`${JSON.stringify({ phase: "terminal" })}\n`,
		);
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("clear");
	});

	test("a terminal task projects the newest revision, not an older active one", async () => {
		const stateRoot = await makeStateRoot();
		await writeRepositoryFile(
			stateRoot,
			["tasks", "task-1", "history", "000000000001.json"],
			`${JSON.stringify({ phase: "running" })}\n`,
		);
		await writeRepositoryFile(
			stateRoot,
			["tasks", "task-1", "history", "000000000002.json"],
			`${JSON.stringify({ phase: "terminal" })}\n`,
		);
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("clear");
	});

	test("a malformed receipt is uncertain", async () => {
		const stateRoot = await makeStateRoot();
		await writeRepositoryFile(stateRoot, ["current.json"], "not json\n");
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("uncertain");
	});

	test("an unknown receipt phase is uncertain", async () => {
		const stateRoot = await makeStateRoot();
		await writeRepositoryFile(stateRoot, ["current.json"], `${JSON.stringify({ phase: "surprise" })}\n`);
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("uncertain");
	});

	test("a task with no readable history revision is uncertain", async () => {
		const stateRoot = await makeStateRoot();
		await writeRepositoryFile(stateRoot, ["current.json"], `${JSON.stringify({ phase: "closed" })}\n`);
		await mkdir(
			join(stateRoot, "vault-git-transaction-manager", REPOSITORY_ID, "tasks", "task-1", "history"),
			{ recursive: true, mode: 0o700 },
		);
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("uncertain");
	});

	test("a symlinked manager root is uncertain", async () => {
		const stateRoot = await makeStateRoot();
		const elsewhere = join(stateRoot, "elsewhere");
		await mkdir(elsewhere, { recursive: true });
		await symlink(elsewhere, join(stateRoot, "vault-git-transaction-manager"));
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("uncertain");
	});

	test("a symlinked receipt is uncertain", async () => {
		const stateRoot = await makeStateRoot();
		const target = await writeRepositoryFile(
			stateRoot,
			["real-receipt.json"],
			`${JSON.stringify({ phase: "closed" })}\n`,
		);
		await symlink(
			target,
			join(stateRoot, "vault-git-transaction-manager", REPOSITORY_ID, "current.json"),
		);
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("uncertain");
	});

	test("an unreadable manager root is uncertain", async () => {
		if (process.getuid?.() === 0) return;
		const stateRoot = await makeStateRoot();
		await writeRepositoryFile(stateRoot, ["current.json"], `${JSON.stringify({ phase: "closed" })}\n`);
		const managerRoot = join(stateRoot, "vault-git-transaction-manager");
		await chmod(managerRoot, 0o000);
		try {
			expect(await inspectVaultGitWorkState(stateRoot)).toBe("uncertain");
		} finally {
			await chmod(managerRoot, 0o700);
		}
	});

	test("active receipt evidence with malformed task evidence stays uncertain", async () => {
		const stateRoot = await makeStateRoot();
		await writeRepositoryFile(stateRoot, ["current.json"], `${JSON.stringify({ phase: "writing" })}\n`);
		await writeRepositoryFile(
			stateRoot,
			["doctor-tasks", "doctor-1", "history", "000000000001.json"],
			"not json\n",
		);
		expect(await inspectVaultGitWorkState(stateRoot)).toBe("uncertain");
	});
});
