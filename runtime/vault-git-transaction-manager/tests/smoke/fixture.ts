import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "bun:test";
import {
	parseCliProcessJson,
	runCliProcess,
	type CliProcessResult,
} from "@side-quest/cli-command-facade/testing";

import { VAULT_GIT_LEDGER_REF } from "../../src/model.ts";
import { createReceiptStore } from "../../src/store.ts";
import { admitActivationForTest } from "../activation-fixture.ts";

/**
 * Smoke-matrix fixture primitives.
 *
 * These are the shell primitives the smoke matrix plan specified — `mk_remote`,
 * `mk_clone`, `snapshot_refs`/`assert_refs_unchanged`, `assert_ledger_state`,
 * `assert_ledger_owner` — expressed as Bun helpers instead of bash.
 *
 * The plan justified a bash/TAP driver as matching an "existing 102-test janitor
 * harness". No such harness exists; the janitor's tests are `tests/janitor.test.ts`,
 * ordinary Bun tests. With that anchor gone, bash would mean hand-rolling
 * primitives that `live-acceptance.integration.test.ts` already implements in
 * TypeScript. This module lifts that private fixture into a shared one so the
 * matrix reuses proven setup rather than forking it.
 *
 * Every row builds its own repository under `mktemp -d` and tears it down, so a
 * row that wedges a store cannot poison the next one.
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = join(packageRoot, "src", "cli.ts");

/** Shim behaviours the recorded `git` wrapper can impose on a row. */
export type SmokeShimMode =
	| "failed_close"
	| "partial_close"
	| "lost_ack"
	| "remote_offline"
	| "atomic_unsupported";

/** The triple snapshot every row compares before and after its action. */
export interface RefSnapshot {
	/** `refs/heads/main` in the local clone. */
	readonly localMain: string;
	/** `refs/heads/main` on the bare remote, or `absent`. */
	readonly remoteMain: string;
	/** Ledger tip on the bare remote, or `absent`. */
	readonly ledgerTip: string;
	/** Every remote ref, so a stray ref fails the comparison. */
	readonly remoteRefs: string;
	/** Unrelated worktree state under `status --porcelain=v2 -z`. */
	readonly worktree: string;
}

/** One disposable repository pair plus the handles a row drives it through. */
export interface SmokeFixture {
	readonly root: string;
	readonly bare: string;
	readonly clone: string;
	readonly stateRoot: string;
	readonly env: NodeJS.ProcessEnv;
	readonly shimLog: string;
	/** Run the CLI as a subprocess and return its raw result. */
	run(args: readonly string[]): Promise<CliProcessResult>;
	/** Begin a transaction over one owned path, returning its id. */
	begin(path: string): Promise<string>;
	/** Run git in the clone. */
	git(...args: string[]): string;
	/** Run git in the bare remote. */
	gitBare(...args: string[]): string;
	/** Capture the triple snapshot. */
	snapshot(): RefSnapshot;
	/** Every `git push` argv the shim observed, in order. */
	recordedPushes(): Promise<string[][]>;
}

const roots: string[] = [];

/**
 * Create a disposable bare remote plus a seeded clone.
 *
 * @param options - Optional shim mode and activation override
 * @returns A fixture bound to throwaway repositories under the OS temp dir
 *
 * @example
 * ```typescript
 * const fixture = await mkSmokeFixture({ shimMode: "failed_close" })
 * ```
 */
export async function mkSmokeFixture(
	options: {
		readonly shimMode?: SmokeShimMode;
		readonly activate?: boolean;
	} = {},
): Promise<SmokeFixture> {
	const root = await mkdtemp(join(tmpdir(), "vault-git-smoke-"));
	roots.push(root);
	const bare = join(root, "remote.git");
	git(root, "init", "--bare", "--initial-branch=main", bare);
	return mkSmokeClone(root, bare, "vault", options);
}

/**
 * Add a second clone of the same remote, for rows that need two writers.
 *
 * @param fixture - The fixture whose remote is shared
 * @param name - Distinct clone name
 * @returns A second fixture over the same bare remote
 */
export async function mkSmokeSibling(
	fixture: SmokeFixture,
	name: string,
): Promise<SmokeFixture> {
	return mkSmokeClone(fixture.root, fixture.bare, name, {});
}

async function mkSmokeClone(
	root: string,
	bare: string,
	name: string,
	options: {
		readonly shimMode?: SmokeShimMode;
		readonly activate?: boolean;
	},
): Promise<SmokeFixture> {
	const clone = join(root, name);
	const stateRoot = join(root, `${name}-state`);
	const profileRoot = join(root, `${name}-profile`);
	const shimMarker = join(root, `${name}-shim-marker`);
	const shimLog = join(root, `${name}-shim-log`);
	git(root, "clone", bare, clone);
	git(clone, "config", "user.name", "Vault Smoke Test");
	git(clone, "config", "user.email", "vault-smoke@example.invalid");

	if (!hasRef(bare, "refs/heads/main")) {
		await mkdir(join(clone, "notes"), { recursive: true });
		await writeFile(join(clone, "notes/event.md"), "baseline event\n");
		await writeFile(join(clone, "staged.md"), "staged baseline\n");
		await writeFile(join(clone, "unstaged.md"), "unstaged baseline\n");
		git(clone, "add", "--", "notes/event.md", "staged.md", "unstaged.md");
		git(clone, "commit", "-m", "test: seed smoke vault");
		git(clone, "push", "-u", "origin", "HEAD:refs/heads/main");
		git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
	}

	// Unrelated state each row must preserve byte-identically.
	await writeFile(join(clone, "staged.md"), `${name} staged bytes\n`);
	git(clone, "add", "--", "staged.md");
	await writeFile(join(clone, "unstaged.md"), `${name} unstaged bytes\n`);
	await writeFile(join(clone, "untracked.md"), `${name} untracked bytes\n`);

	await mkdir(profileRoot, { recursive: true });
	const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
	const shimDirectory = join(root, `${name}-bin`);
	await mkdir(shimDirectory, { recursive: true });
	await writeFile(join(shimDirectory, "git"), gitShimSource());
	await chmod(join(shimDirectory, "git"), 0o755);

	const env: NodeJS.ProcessEnv = {
		...process.env,
		HOME: profileRoot,
		XDG_CONFIG_HOME: join(profileRoot, ".config"),
		XDG_STATE_HOME: join(profileRoot, ".state"),
		PATH: `${shimDirectory}:${process.env.PATH ?? ""}`,
		VAULT_GIT_REPOSITORY_PATH: clone,
		VAULT_GIT_CHECK_REPOSITORY_PATH: clone,
		VAULT_GIT_STATE_ROOT: stateRoot,
		VAULT_GIT_REPOSITORY_IDENTITY: "smoke-vault",
		VAULT_GIT_ACTOR: `agent-${name}`,
		VAULT_GIT_HOST: `host-${name}`,
		VAULT_GIT_REMOTE: "origin",
		VAULT_GIT_REAL_GIT: realGit,
		VAULT_GIT_SHIM_MARKER: shimMarker,
		VAULT_GIT_SHIM_LOG: shimLog,
		...(options.shimMode ? { VAULT_GIT_SHIM_MODE: options.shimMode } : {}),
	};

	const store = createReceiptStore({
		stateRoot,
		repositoryIdentity: "smoke-vault",
	});
	if (options.activate !== false) await admitActivationForTest(store);

	const run = (args: readonly string[]) =>
		runCliProcess({
			label: `vault-git ${args.join(" ")}`,
			argv: ["bun", "run", cliPath, ...args],
			cwd: packageRoot,
			env,
			timeoutMs: 45_000,
		});

	return {
		root,
		bare,
		clone,
		stateRoot,
		env,
		shimLog,
		run,
		begin: async (path: string) => {
			const result = await run([
				"begin",
				"--event",
				"note_created",
				"--path",
				path,
				"--json",
			]);
			expect(result.exitCode).toBe(0);
			const transactionId = (
				parseCliProcessJson(result) as { data?: { transaction_id?: string } }
			).data?.transaction_id;
			if (!transactionId) throw new Error("begin omitted transaction id");
			return transactionId;
		},
		git: (...args) => git(clone, ...args),
		gitBare: (...args) => git(bare, ...args),
		snapshot: () => ({
			localMain: git(clone, "rev-parse", "refs/heads/main"),
			remoteMain: readRef(bare, "refs/heads/main"),
			ledgerTip: readRef(bare, VAULT_GIT_LEDGER_REF),
			remoteRefs: git(bare, "for-each-ref", "--format=%(refname)%00%(objectname)"),
			worktree: git(
				clone,
				"status",
				"--porcelain=v2",
				"-z",
				"--",
				":(top)",
				":(top,exclude,literal)notes/event.md",
			),
		}),
		recordedPushes: async () => {
			const raw = await readFile(shimLog, "utf8").catch(() => "");
			return raw
				.split("\n")
				.filter((line) => line.length > 0)
				.map((line) => JSON.parse(line) as string[]);
		},
	};
}

/**
 * Remove every fixture root created so far.
 *
 * Rows call this from `afterEach` so no row inherits another row's state.
 */
export async function cleanupSmokeFixtures(): Promise<void> {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
}

/**
 * Assert the whole ref triple is unchanged.
 *
 * @param before - Snapshot captured before the action
 * @param after - Snapshot captured after the action
 */
export function assertRefsUnchanged(before: RefSnapshot, after: RefSnapshot): void {
	expect(after.localMain).toBe(before.localMain);
	expect(after.remoteMain).toBe(before.remoteMain);
	expect(after.ledgerTip).toBe(before.ledgerTip);
	expect(after.remoteRefs).toBe(before.remoteRefs);
	expect(after.worktree).toBe(before.worktree);
}

/**
 * Assert unrelated worktree bytes survived, allowing refs to have moved.
 *
 * Rows that legitimately commit still owe this: a commit on an owned path must
 * not disturb staged, unstaged, or untracked neighbours.
 *
 * @param before - Snapshot captured before the action
 * @param after - Snapshot captured after the action
 */
export function assertWorktreeUnchanged(
	before: RefSnapshot,
	after: RefSnapshot,
): void {
	expect(after.worktree).toBe(before.worktree);
}

/**
 * Assert the exact structured code the CLI reported.
 *
 * A row may not pass merely because the command failed, so this asserts the
 * precise `error.code` or `status`, never "any failure".
 *
 * @param result - The CLI process result
 * @param expected - Exact structured code
 */
export function assertStructuredCode(
	result: CliProcessResult,
	expected: string,
): void {
	const envelope = parseCliProcessJson<{
		readonly status?: string;
		readonly error?: { readonly code?: string };
	}>(result);
	const actual = envelope.error?.code ?? envelope.status;
	expect(actual).toBe(expected);
}

/**
 * Assert whether the remote ledger currently holds a lease.
 *
 * @param fixture - The fixture whose remote is inspected
 * @param state - Expected lease state
 */
export function assertLedgerState(
	fixture: SmokeFixture,
	state: "held" | "released",
): void {
	const tip = readRef(fixture.bare, VAULT_GIT_LEDGER_REF);
	if (state === "released" && tip === "absent") return;
	expect(tip).not.toBe("absent");
	expect(readLedgerDocument(fixture).lease?.state).toBe(state);
}

/**
 * Assert the ledger names one transaction as owner.
 *
 * @param fixture - The fixture whose remote is inspected
 * @param transactionId - Expected owning transaction
 */
export function assertLedgerOwner(
	fixture: SmokeFixture,
	transactionId: string,
): void {
	expect(readLedgerDocument(fixture).lease?.transaction_id).toBe(transactionId);
}

/** The ledger document at the current tip, parsed. */
export interface LedgerDocument {
	readonly operation?: string;
	readonly lease?: {
		readonly transaction_id?: string;
		readonly state?: "held" | "released";
		readonly owned_paths?: readonly string[];
	};
}

/**
 * Read and parse the ledger document at the remote tip.
 *
 * The adapter writes it as a single `ledger.json` blob in the ledger commit's
 * tree, pretty-printed with snake_case keys.
 *
 * @param fixture - The fixture whose remote is inspected
 * @returns The parsed ledger document
 */
export function readLedgerDocument(fixture: SmokeFixture): LedgerDocument {
	return JSON.parse(
		fixture.gitBare("show", `${VAULT_GIT_LEDGER_REF}:ledger.json`),
	) as LedgerDocument;
}

function readRef(bare: string, ref: string): string {
	const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], {
		cwd: bare,
		encoding: "utf8",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	return result.status === 0 ? result.stdout.trim() : "absent";
}

function hasRef(bare: string, ref: string): boolean {
	return (
		spawnSync("git", ["show-ref", "--verify", "--quiet", ref], { cwd: bare })
			.status === 0
	);
}

function git(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
	return result.stdout.trim();
}

function gitShimSource(): string {
	return `#!/usr/bin/env bun
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = Bun.argv.slice(2);
const realGit = process.env.VAULT_GIT_REAL_GIT ?? "/usr/bin/git";
const mode = process.env.VAULT_GIT_SHIM_MODE;
const marker = process.env.VAULT_GIT_SHIM_MARKER ?? "";
const log = process.env.VAULT_GIT_SHIM_LOG ?? "";
if (log && args[0] === "push") appendFileSync(log, JSON.stringify(args) + "\\n");
const atomic = args[0] === "push" && args.includes("--atomic");
const dryRun = args.includes("--dry-run");
if (mode === "atomic_unsupported" && atomic && dryRun) {
  process.stderr.write("fatal: the receiving end does not support atomic push\\n");
  process.exit(1);
}
if (mode === "remote_offline" && ["push", "fetch", "ls-remote"].includes(args[0] ?? "")) {
  process.stderr.write("fatal: unable to access remote: Could not resolve host\\n");
  process.exit(128);
}
if (mode === "lost_ack" && marker && existsSync(marker) && ["fetch", "ls-remote"].includes(args[0] ?? "")) {
  process.stderr.write("fatal: simulated reconciliation outage\\n");
  process.exit(1);
}
if (atomic && !dryRun && mode === "failed_close") {
  process.stderr.write("fatal: simulated push failure\\n");
  process.exit(1);
}
if (atomic && !dryRun && mode === "partial_close") {
  const remote = args.find((arg, index) => index > 0 && !arg.startsWith("-"));
  const main = args.find((arg) => arg.endsWith(":refs/heads/main"));
  if (!remote || !main) process.exit(2);
  const result = Bun.spawnSync([realGit, "push", "--porcelain", "--no-verify", remote, main], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exit(result.exitCode === 0 ? 1 : result.exitCode);
}
const result = Bun.spawnSync([realGit, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
if (atomic && !dryRun && mode === "lost_ack" && result.exitCode === 0) {
  writeFileSync(marker, "remote accepted; acknowledgement lost\\n");
  process.exit(1);
}
process.exit(result.exitCode);
`;
}
