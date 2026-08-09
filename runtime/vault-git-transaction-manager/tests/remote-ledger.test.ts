import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createGitAdapter, createNodeProcessPort } from "../src/git-adapter.ts";
import type {
	VaultGitProcessPort,
	VaultGitProcessResult,
	VaultGitRemotePort,
} from "../src/ports.ts";
import {
	VAULT_GIT_LEDGER_REF,
	acquireRemoteLease,
	observeRemoteLedger,
	releaseRemoteLease,
	supersedeRemoteLease,
	validateRemoteLease,
} from "../src/remote-ledger.ts";

const fixtureRoots: string[] = [];

afterEach(async () => {
	for (const root of fixtureRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("remote lease ledger", () => {
	test("bootstraps once and records an opaque transaction binding", async () => {
		const fixture = await createFixture();
		const engine = createEngine(fixture.cloneA, "2026-08-09T00:00:00.000Z");
		const observation = await observeRemoteLedger(engine, { remote: "origin" });
		expect(observation).toMatchObject({ status: "observed", generation: null });

		const acquired = await acquireRemoteLease(engine, {
			remote: "origin",
			expectedGeneration: null,
			actor: "agent-a",
			host: "laptop",
			event: "note_created",
			ownedPaths: ["notes/example.md"],
			leaseDurationMs: 60_000,
		});

		expect(acquired).toMatchObject({
			status: "acquired",
			changedState: "remote",
			hostDisposition: "authoritative",
			lease: {
				actor: "agent-a",
				host: "laptop",
				event: "note_created",
				ownedPaths: ["notes/example.md"],
				localMainHead: fixture.mainHead,
				remoteMainHead: fixture.mainHead,
			},
		});
		if (acquired.status !== "acquired")
			throw new Error("fixture acquisition failed");
		expect(acquired.transactionId).toMatch(/^txn_[0-9a-f]{32}$/);
		expect(acquired.generation).toMatch(/^[0-9a-f]{40,64}$/);

		const reread = await observeRemoteLedger(engine, { remote: "origin" });
		expect(reread).toMatchObject({
			status: "observed",
			generation: acquired.generation,
			lease: { transactionId: acquired.transactionId, state: "held" },
		});
		const bootstrapCommit = await engine.git.readLedger(
			"origin",
			VAULT_GIT_LEDGER_REF,
		);
		expect(bootstrapCommit).toMatchObject({
			status: "ok",
			head: { parents: [] },
		});
		const released = await releaseRemoteLease(engine, {
			remote: "origin",
			expectedGeneration: acquired.generation,
			transactionId: acquired.transactionId,
		});
		if (released.status !== "released")
			throw new Error("fixture release failed");
		const releaseCommit = await engine.git.readLedger(
			"origin",
			VAULT_GIT_LEDGER_REF,
		);
		expect(releaseCommit).toMatchObject({
			status: "ok",
			head: { generation: released.generation, parents: [acquired.generation] },
		});
	});

	test("admits exactly one winner when two clones bootstrap concurrently", async () => {
		const fixture = await createFixture();
		const engineA = createEngine(fixture.cloneA, "2026-08-09T00:00:00.000Z");
		const engineB = createEngine(fixture.cloneB, "2026-08-09T00:00:00.000Z");
		const [observedA, observedB] = await Promise.all([
			observeRemoteLedger(engineA, { remote: "origin" }),
			observeRemoteLedger(engineB, { remote: "origin" }),
		]);
		expect(observedA).toMatchObject({ status: "observed", generation: null });
		expect(observedB).toMatchObject({ status: "observed", generation: null });

		const attempts = await Promise.all([
			acquireRemoteLease(engineA, {
				remote: "origin",
				expectedGeneration: null,
				actor: "agent-a",
				host: "laptop",
				event: "note_created",
				ownedPaths: ["notes/a.md"],
				leaseDurationMs: 60_000,
			}),
			acquireRemoteLease(engineB, {
				remote: "origin",
				expectedGeneration: null,
				actor: "agent-b",
				host: "mac-mini",
				event: "note_created",
				ownedPaths: ["notes/b.md"],
				leaseDurationMs: 60_000,
			}),
		]);
		const acquired = attempts.filter((result) => result.status === "acquired");
		const refused = attempts.filter((result) => result.status === "refused");
		expect(acquired).toHaveLength(1);
		expect(refused).toHaveLength(1);
		const winner = acquired[0];
		if (!winner || winner.status !== "acquired")
			throw new Error("bootstrap race had no winner");
		const loser = refused[0];
		if (!loser || loser.status !== "refused")
			throw new Error("bootstrap race had no fenced loser");
		expect(loser.blocker).toBe("remote_moved");

		// Independent ledger read straight from the bare remote, bypassing
		// both engines: the remote tip must be the winner's generation.
		const remoteTip = git(fixture.root, [
			"ls-remote",
			fixture.remote,
			VAULT_GIT_LEDGER_REF,
		]).split("\t")[0];
		expect(remoteTip).toBe(winner.generation);
	});

	test("requires a human for active, stale, and unknown lease ownership", async () => {
		const fixture = await createFixture();
		const owner = createEngine(fixture.cloneA, "2026-08-09T00:00:00.000Z");
		const acquired = await acquireRemoteLease(owner, {
			remote: "origin",
			expectedGeneration: null,
			actor: "agent-a",
			host: "laptop",
			event: "note_created",
			ownedPaths: ["notes/a.md"],
			leaseDurationMs: 1_000,
		});
		expect(acquired.status).toBe("acquired");
		if (acquired.status !== "acquired")
			throw new Error("fixture acquisition failed");

		const active = await acquireRemoteLease(
			createEngine(fixture.cloneB, "2026-08-09T00:00:00.500Z"),
			{
				remote: "origin",
				expectedGeneration: acquired.generation,
				actor: "agent-b",
				host: "mac-mini",
				event: "note_created",
				ownedPaths: ["notes/b.md"],
				leaseDurationMs: 1_000,
			},
		);
		expect(active).toMatchObject({
			status: "refused",
			blocker: "lease_active",
			retrySafety: "same_input_safe",
			nextAction: { id: "retry_remote" },
		});

		const stale = await acquireRemoteLease(
			createEngine(fixture.cloneB, "2026-08-09T00:00:02.000Z"),
			{
				remote: "origin",
				expectedGeneration: acquired.generation,
				actor: "agent-b",
				host: "mac-mini",
				event: "note_created",
				ownedPaths: ["notes/b.md"],
				leaseDurationMs: 1_000,
			},
		);
		expect(stale).toMatchObject({
			status: "refused",
			blocker: "lease_stale",
			retrySafety: "operator_required",
			nextAction: { id: "request_operator_takeover" },
			diagnostics: { leaseAgeMs: 2_000 },
		});

		const unknown = await releaseRemoteLease(owner, {
			remote: "origin",
			expectedGeneration: acquired.generation,
			transactionId: "txn_00000000000000000000000000000000",
		});
		expect(unknown).toMatchObject({
			status: "refused",
			blocker: "lease_owner_unknown",
			hostDisposition: "quarantined",
			nextAction: { id: "request_operator_takeover" },
		});
	});

	test("superseding abandonment fences the old writer before a new acquisition", async () => {
		const fixture = await createFixture();
		const oldWriter = createEngine(fixture.cloneA, "2026-08-09T00:00:00.000Z");
		const operator = createEngine(fixture.cloneB, "2026-08-09T00:01:00.000Z");
		const acquired = await acquireRemoteLease(oldWriter, {
			remote: "origin",
			expectedGeneration: null,
			actor: "agent-a",
			host: "laptop",
			event: "document_completed",
			ownedPaths: ["notes/local-edit.md"],
			leaseDurationMs: 1_000,
		});
		if (acquired.status !== "acquired")
			throw new Error("fixture acquisition failed");
		await mkdir(join(fixture.cloneA, "notes"), { recursive: true });
		await writeFile(
			join(fixture.cloneA, "notes", "local-edit.md"),
			"preserve me\n",
		);

		const abandoned = await supersedeRemoteLease(operator, {
			remote: "origin",
			expectedGeneration: acquired.generation,
			transactionId: acquired.transactionId,
			supersedingActor: "operator",
		});
		expect(abandoned).toMatchObject({
			status: "released",
			changedState: "remote",
		});
		const abandonRecord = await operator.git.readLedger(
			"origin",
			VAULT_GIT_LEDGER_REF,
		);
		if (abandonRecord.status !== "ok" || !abandonRecord.head?.content) {
			throw new Error("abandon record missing");
		}
		// The superseding actor owns the transition; the stale actor stays in
		// the lease body for audit.
		expect(JSON.parse(abandonRecord.head.content)).toMatchObject({
			operation: "superseding_abandon",
			superseding_actor: "operator",
			lease: { actor: "agent-a", state: "released" },
		});
		if (abandoned.status !== "released") {
			throw new Error("fixture abandonment failed");
		}
		const replacement = await acquireRemoteLease(operator, {
			remote: "origin",
			expectedGeneration: abandoned.generation,
			actor: "operator",
			host: "mac-mini",
			event: "document_completed",
			ownedPaths: ["notes/recovery.md"],
			leaseDurationMs: 60_000,
		});
		expect(replacement.status).toBe("acquired");

		const completionFence = await validateRemoteLease(oldWriter, {
			remote: "origin",
			expectedGeneration: acquired.generation,
			transactionId: acquired.transactionId,
		});
		expect(completionFence).toMatchObject({
			status: "refused",
			blocker: "lease_generation_stale",
			hostDisposition: "quarantined",
			nextAction: { id: "preserve_local_edits" },
		});

		const releaseFence = await releaseRemoteLease(oldWriter, {
			remote: "origin",
			expectedGeneration: acquired.generation,
			transactionId: acquired.transactionId,
		});
		expect(releaseFence).toMatchObject({
			status: "refused",
			blocker: "lease_generation_stale",
			changedState: "none",
			hostDisposition: "quarantined",
		});
		expect(
			await Bun.file(join(fixture.cloneA, "notes", "local-edit.md")).text(),
		).toBe("preserve me\n");
	});

	test("refuses superseding abandonment without exact transaction ownership", async () => {
		const unusedGit: VaultGitRemotePort = {
			inspectMain: () => Promise.reject(new Error("not used")),
			readLedger: () => Promise.reject(new Error("not used")),
			appendLedgerCommit: () => Promise.reject(new Error("not used")),
		};
		const refusal = await supersedeRemoteLease(
			{
				git: {
					...unusedGit,
					readLedger: async () => ({ status: "ok", head: null }),
				},
				clock: { now: () => new Date("2026-08-09T00:00:00.000Z") },
			},
			{
				remote: "origin",
				expectedGeneration: "a".repeat(40),
				transactionId: `txn_${"0".repeat(32)}`,
				supersedingActor: "operator",
			},
		);
		expect(refusal).toMatchObject({
			status: "refused",
			blocker: "lease_generation_stale",
		});
	});

	test("refuses unavailable remotes, malformed ledgers, and unsafe destinations", async () => {
		const fixture = await createFixture();
		const engine = createEngine(fixture.cloneA, "2026-08-09T00:00:00.000Z");
		const unavailable = await acquireRemoteLease(engine, {
			remote: join(fixture.root, "missing.git"),
			expectedGeneration: null,
			actor: "agent-a",
			host: "laptop",
			event: "note_created",
			ownedPaths: ["notes/a.md"],
			leaseDurationMs: 60_000,
		});
		expect(unavailable).toMatchObject({
			status: "refused",
			blocker: "remote_unavailable",
			nextAction: { id: "retry_remote" },
		});

		await pushMalformedLedger(fixture.cloneA);
		const malformed = await observeRemoteLedger(engine, { remote: "origin" });
		expect(malformed).toMatchObject({
			status: "refused",
			blocker: "ledger_malformed",
			nextAction: { id: "request_operator_takeover" },
		});

		for (const ledgerRef of [
			"HEAD",
			"refs/heads/*",
			"+refs/heads/vault-system/transaction-ledger",
			"refs/heads/a:refs/heads/b",
		]) {
			await expect(
				engine.git.appendLedgerCommit({
					remote: "origin",
					ledgerRef,
					expectedGeneration: null,
					content: "{}",
					message: "invalid",
					author: "agent-a",
					timestamp: "2026-08-09T00:00:00.000Z",
				}),
			).rejects.toThrow("full branch ref");
		}
	});

	test("rejects merge-parent ledger commits and configured push refspecs", async () => {
		const fixture = await createFixture();
		const engine = createEngine(fixture.cloneA, "2026-08-09T00:00:00.000Z");
		const acquired = await acquireRemoteLease(engine, {
			remote: "origin",
			expectedGeneration: null,
			actor: "agent-a",
			host: "laptop",
			event: "note_created",
			ownedPaths: ["notes/a.md"],
			leaseDurationMs: 60_000,
		});
		if (acquired.status !== "acquired")
			throw new Error("fixture acquisition failed");
		await pushMergeLedger(
			fixture.cloneA,
			acquired.generation,
			fixture.mainHead,
		);
		expect(
			await observeRemoteLedger(engine, { remote: "origin" }),
		).toMatchObject({
			status: "refused",
			blocker: "ledger_malformed",
		});

		const configuredFixture = await createFixture();
		const configuredEngine = createEngine(
			configuredFixture.cloneA,
			"2026-08-09T00:00:00.000Z",
		);
		git(configuredFixture.cloneA, [
			"config",
			"remote.origin.push",
			"refs/heads/main:refs/heads/main",
		]);
		await expect(
			acquireRemoteLease(configuredEngine, {
				remote: "origin",
				expectedGeneration: null,
				actor: "agent-a",
				host: "laptop",
				event: "note_created",
				ownedPaths: ["notes/a.md"],
				leaseDurationMs: 60_000,
			}),
		).rejects.toThrow("configured push refspecs");
		expect(
			await observeRemoteLedger(configuredEngine, { remote: "origin" }),
		).toMatchObject({ status: "observed", generation: null });

		git(configuredFixture.cloneA, [
			"config",
			"--unset-all",
			"remote.origin.push",
		]);
		git(configuredFixture.cloneA, [
			"config",
			"remote.origin.pushurl",
			"https://example.invalid/elsewhere.git",
		]);
		await expect(
			acquireRemoteLease(configuredEngine, {
				remote: "origin",
				expectedGeneration: null,
				actor: "agent-a",
				host: "laptop",
				event: "note_created",
				ownedPaths: ["notes/a.md"],
				leaseDurationMs: 60_000,
			}),
		).rejects.toThrow("configured push URLs");

		git(configuredFixture.cloneA, [
			"config",
			"--unset",
			"remote.origin.pushurl",
		]);
		git(configuredFixture.cloneA, [
			"config",
			"url.ssh://example.invalid/.pushInsteadOf",
			"https://example.invalid/",
		]);
		await expect(
			acquireRemoteLease(configuredEngine, {
				remote: "origin",
				expectedGeneration: null,
				actor: "agent-a",
				host: "laptop",
				event: "note_created",
				ownedPaths: ["notes/a.md"],
				leaseDurationMs: 60_000,
			}),
		).rejects.toThrow("configured pushInsteadOf");
	});

	test("classifies a timed-out append as unknown remote completion", async () => {
		const generation = "a".repeat(40);
		const mainHead = "b".repeat(40);
		const transactionId = `txn_${"0".repeat(32)}`;
		const timestamp = "2026-08-09T00:00:00.000Z";
		const content = JSON.stringify({
			schema_version: 1,
			operation: "acquire",
			previous_generation: null,
			transitioned_at: timestamp,
			lease: {
				transaction_id: transactionId,
				actor: "agent-a",
				host: "laptop",
				event: "note_created",
				owned_paths: ["notes/a.md"],
				local_main_head: mainHead,
				remote_main_head: mainHead,
				acquired_at: timestamp,
				lease_duration_ms: 60_000,
				state: "held",
			},
		});
		const git: VaultGitRemotePort = {
			inspectMain: () => Promise.reject(new Error("not used")),
			readLedger: () =>
				Promise.resolve({
					status: "ok",
					head: { generation, parents: [], content },
				}),
			appendLedgerCommit: () =>
				Promise.resolve({ status: "refused", reason: "timed_out" }),
		};
		const released = await releaseRemoteLease(
			{ git, clock: { now: () => new Date(timestamp) } },
			{ remote: "origin", expectedGeneration: generation, transactionId },
		);
		expect(released).toMatchObject({
			status: "refused",
			blocker: "remote_unavailable",
			changedState: "partial",
			retrySafety: "operator_required",
			nextAction: { id: "preserve_local_edits" },
			hostDisposition: "quarantined",
		});
	});

	test("quarantines with partial change when push fails and the verification re-read fails", async () => {
		const generation = "a".repeat(40);
		const mainHead = "b".repeat(40);
		const commit = "e".repeat(40);
		const transactionId = `txn_${"0".repeat(32)}`;
		const timestamp = "2026-08-09T00:00:00.000Z";
		const content = JSON.stringify({
			schema_version: 1,
			operation: "acquire",
			previous_generation: null,
			transitioned_at: timestamp,
			lease: {
				transaction_id: transactionId,
				actor: "agent-a",
				host: "laptop",
				event: "note_created",
				owned_paths: ["notes/a.md"],
				local_main_head: mainHead,
				remote_main_head: mainHead,
				acquired_at: timestamp,
				lease_duration_ms: 60_000,
				state: "held",
			},
		});
		let pushAttempted = false;
		const port: VaultGitProcessPort = {
			run(request): Promise<VaultGitProcessResult> {
				const args = request.args;
				const respond = (
					overrides: Partial<VaultGitProcessResult> = {},
				): Promise<VaultGitProcessResult> =>
					Promise.resolve({
						exitCode: 0,
						stdout: "",
						stderr: "",
						timedOut: false,
						...overrides,
					});
				if (args[0] === "push") {
					pushAttempted = true;
					return respond({ exitCode: 1, stderr: "error: failed to push" });
				}
				if (args[0] === "ls-remote") {
					// The verification re-read after the failed push also fails,
					// leaving the remote outcome unknown.
					return pushAttempted
						? respond({
								exitCode: 128,
								stderr: "fatal: unable to access remote",
							})
						: respond({ stdout: `${generation}\t${VAULT_GIT_LEDGER_REF}\n` });
				}
				if (args[0] === "config") return respond({ exitCode: 1 });
				if (args[0] === "rev-parse") return respond({ stdout: `${generation}\n` });
				if (args[0] === "hash-object")
					return respond({ stdout: `${"c".repeat(40)}\n` });
				if (args[0] === "mktree") return respond({ stdout: `${"d".repeat(40)}\n` });
				if (args[0] === "commit-tree") return respond({ stdout: `${commit}\n` });
				if (args[0] === "show" && args[1] === "-s") {
					return respond({
						stdout: args[3] === commit ? `${generation}\n` : "\n",
					});
				}
				if (args[0] === "show") return respond({ stdout: content });
				return respond();
			},
		};
		const engine = {
			git: createGitAdapter({
				repositoryPath: "/repository",
				process: port,
				timeouts: { fetchMs: 1_000, pushMs: 1_000, localMs: 1_000 },
			}),
			clock: { now: () => new Date(timestamp) },
		};
		const released = await releaseRemoteLease(engine, {
			remote: "origin",
			expectedGeneration: generation,
			transactionId,
		});
		expect(released).toMatchObject({
			status: "refused",
			blocker: "remote_unavailable",
			changedState: "partial",
			retrySafety: "operator_required",
			nextAction: { id: "preserve_local_edits" },
			hostDisposition: "quarantined",
		});
	});

	test("refuses main states that are not exactly aligned", async () => {
		const fixture = await createFixture();
		await writeFile(join(fixture.cloneA, "ahead.txt"), "ahead\n");
		git(fixture.cloneA, ["add", "ahead.txt"]);
		git(fixture.cloneA, ["commit", "-m", "test: local ahead"]);
		const engine = createEngine(fixture.cloneA, "2026-08-09T00:00:00.000Z");
		const result = await acquireRemoteLease(engine, {
			remote: "origin",
			expectedGeneration: null,
			actor: "agent-a",
			host: "laptop",
			event: "note_created",
			ownedPaths: ["notes/a.md"],
			leaseDurationMs: 60_000,
		});
		expect(result).toMatchObject({
			status: "refused",
			blocker: "main_ahead",
			retrySafety: "operator_required",
		});
		const pending = await acquireRemoteLease(engine, {
			remote: "origin",
			expectedGeneration: null,
			actor: "agent-a",
			host: "laptop",
			event: "note_created",
			ownedPaths: ["notes/a.md"],
			leaseDurationMs: 60_000,
			pushPending: true,
		});
		expect(pending).toMatchObject({
			status: "refused",
			blocker: "push_pending",
			retrySafety: "same_input_unsafe",
		});
		expect(
			await observeRemoteLedger(engine, { remote: "origin" }),
		).toMatchObject({
			status: "observed",
			generation: null,
		});
	});

	test("classifies behind and diverged main without creating a ledger", async () => {
		const fixture = await createFixture();
		await writeFile(join(fixture.root, "seed", "remote.txt"), "remote\n");
		git(join(fixture.root, "seed"), ["add", "remote.txt"]);
		git(join(fixture.root, "seed"), ["commit", "-m", "test: advance remote"]);
		git(join(fixture.root, "seed"), ["push", "origin", "HEAD:refs/heads/main"]);

		const behindEngine = createEngine(
			fixture.cloneA,
			"2026-08-09T00:00:00.000Z",
		);
		expect(
			await acquireRemoteLease(behindEngine, {
				remote: "origin",
				expectedGeneration: null,
				actor: "agent-a",
				host: "laptop",
				event: "note_created",
				ownedPaths: ["notes/a.md"],
				leaseDurationMs: 60_000,
			}),
		).toMatchObject({ status: "refused", blocker: "main_behind" });

		await writeFile(join(fixture.cloneB, "local.txt"), "local\n");
		git(fixture.cloneB, ["add", "local.txt"]);
		git(fixture.cloneB, ["commit", "-m", "test: diverge local"]);
		const divergedEngine = createEngine(
			fixture.cloneB,
			"2026-08-09T00:00:00.000Z",
		);
		expect(
			await acquireRemoteLease(divergedEngine, {
				remote: "origin",
				expectedGeneration: null,
				actor: "agent-b",
				host: "mac-mini",
				event: "note_created",
				ownedPaths: ["notes/b.md"],
				leaseDurationMs: 60_000,
			}),
		).toMatchObject({ status: "refused", blocker: "main_diverged" });

		expect(
			await observeRemoteLedger(behindEngine, { remote: "origin" }),
		).toMatchObject({
			status: "observed",
			generation: null,
		});
	});
});

function createEngine(repositoryPath: string, now: string) {
	return {
		git: createGitAdapter({
			repositoryPath,
			process: createNodeProcessPort(),
			timeouts: { fetchMs: 5_000, pushMs: 5_000, localMs: 5_000 },
		}),
		clock: { now: () => new Date(now) },
	};
}

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), "vault-git-ledger-"));
	fixtureRoots.push(root);
	const remote = join(root, "remote.git");
	const seed = join(root, "seed");
	const cloneA = join(root, "clone-a");
	const cloneB = join(root, "clone-b");
	git(root, ["init", "--bare", "--initial-branch=main", remote]);
	git(root, ["clone", remote, seed]);
	configureGit(seed);
	await writeFile(join(seed, "seed.txt"), "seed\n");
	git(seed, ["add", "seed.txt"]);
	git(seed, ["commit", "-m", "test: seed main"]);
	git(seed, ["push", "origin", "HEAD:refs/heads/main"]);
	const mainHead = git(seed, ["rev-parse", "refs/heads/main"]);
	git(root, ["clone", remote, cloneA]);
	git(root, ["clone", remote, cloneB]);
	configureGit(cloneA);
	configureGit(cloneB);
	return { root, remote, cloneA, cloneB, mainHead };
}

async function pushMalformedLedger(repositoryPath: string): Promise<void> {
	const blob = git(
		repositoryPath,
		["hash-object", "-w", "--stdin"],
		'{"bad":true}\n',
	);
	const tree = git(
		repositoryPath,
		["mktree"],
		`100644 blob ${blob}\tledger.json\n`,
	);
	const commit = git(repositoryPath, [
		"commit-tree",
		tree,
		"-m",
		"vault-ledger: malformed",
	]);
	git(repositoryPath, ["push", "origin", `${commit}:${VAULT_GIT_LEDGER_REF}`]);
}

async function pushMergeLedger(
	repositoryPath: string,
	ledgerParent: string,
	secondParent: string,
): Promise<void> {
	const content = git(repositoryPath, ["show", `${ledgerParent}:ledger.json`]);
	const blob = git(
		repositoryPath,
		["hash-object", "-w", "--stdin"],
		`${content}\n`,
	);
	const tree = git(
		repositoryPath,
		["mktree"],
		`100644 blob ${blob}\tledger.json\n`,
	);
	const commit = git(repositoryPath, [
		"commit-tree",
		tree,
		"-p",
		ledgerParent,
		"-p",
		secondParent,
		"-m",
		"vault-ledger: invalid merge",
	]);
	git(repositoryPath, ["push", "origin", `${commit}:${VAULT_GIT_LEDGER_REF}`]);
}

function configureGit(repositoryPath: string): void {
	git(repositoryPath, ["config", "user.name", "Vault Test"]);
	git(repositoryPath, ["config", "user.email", "vault-test@example.invalid"]);
}

function git(
	repositoryPath: string,
	args: readonly string[],
	input?: string,
): string {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: repositoryPath,
		stdin: input === undefined ? undefined : Buffer.from(input),
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.toString() || `git ${args[0]} failed`);
	}
	return result.stdout.toString().trim();
}
