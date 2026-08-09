import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createGitAdapter, createNodeProcessPort } from "../src/git-adapter.ts";
import {
	VAULT_GIT_LEDGER_REF,
	acquireRemoteLease,
	observeRemoteLedger,
	releaseRemoteLease,
} from "../src/remote-ledger.ts";

/** Result of the host-runnable remote compare-and-swap proof. */
export interface TwoCloneRaceProof {
	/** Number of completed acquisition races. */
	readonly repetitions: number;
	/** Winners observed across all races. */
	readonly winners: number;
	/** Compare-and-swap losers observed across all races. */
	readonly fenced: number;
}

/**
 * Run the laptop-versus-Mac-Mini lease race against one supplied Git remote.
 *
 * @param remoteUrl - Disposable remote URL with an existing main branch
 * @param repetitions - Number of races to execute
 * @returns Counts proving exactly one winner and one fenced writer per race
 * @throws When cloning, Git transport, acquisition, or release fails
 *
 * @example
 * ```typescript
 * await runTwoCloneRace("https://example.invalid/disposable.git", 20)
 * ```
 */
export async function runTwoCloneRace(
	remoteUrl: string,
	repetitions = 20,
): Promise<TwoCloneRaceProof> {
	const root = await mkdtemp(join(tmpdir(), "vault-git-two-clone-"));
	try {
		const cloneA = join(root, "laptop");
		const cloneB = join(root, "mac-mini");
		git(root, ["clone", remoteUrl, cloneA]);
		git(root, ["clone", remoteUrl, cloneB]);
		configureGit(cloneA);
		configureGit(cloneB);
		const engineA = createEngine(cloneA);
		const engineB = createEngine(cloneB);
		let winners = 0;
		let fenced = 0;

		for (let repetition = 0; repetition < repetitions; repetition += 1) {
			const [observedA, observedB] = await Promise.all([
				observeRemoteLedger(engineA, { remote: "origin" }),
				observeRemoteLedger(engineB, { remote: "origin" }),
			]);
			if (observedA.status !== "observed" || observedB.status !== "observed") {
				throw new Error("ledger observation failed");
			}
			expect(observedA.generation).toBe(observedB.generation);

			const attempts = await Promise.all([
				acquireRemoteLease(engineA, {
					remote: "origin",
					expectedGeneration: observedA.generation,
					actor: "agent-laptop",
					host: "laptop",
					event: "note_created",
					ownedPaths: [`notes/laptop-${repetition}.md`],
					leaseDurationMs: 60_000,
				}),
				acquireRemoteLease(engineB, {
					remote: "origin",
					expectedGeneration: observedB.generation,
					actor: "agent-mac-mini",
					host: "mac-mini",
					event: "note_created",
					ownedPaths: [`notes/mac-mini-${repetition}.md`],
					leaseDurationMs: 60_000,
				}),
			]);
			const acquired = attempts.filter(
				(result) => result.status === "acquired",
			);
			const refused = attempts.filter((result) => result.status === "refused");
			expect(acquired).toHaveLength(1);
			expect(refused).toHaveLength(1);
			const loser = refused[0];
			if (!loser || loser.status !== "refused")
				throw new Error("race had no fenced loser");
			expect(loser.blocker).toBe("remote_moved");
			expect(loser.changedState).toBe("none");
			winners += acquired.length;
			fenced += refused.length;

			const winner = acquired[0];
			if (!winner || winner.status !== "acquired")
				throw new Error("race had no winner");

			// Independent remote read outside both engines: the ledger tip must
			// be exactly the winner's generation before release.
			const remoteTip = git(root, [
				"ls-remote",
				remoteUrl,
				VAULT_GIT_LEDGER_REF,
			]).split("\t")[0];
			expect(remoteTip).toBe(winner.generation);

			const winnerEngine = winner.lease.host === "laptop" ? engineA : engineB;
			const released = await releaseRemoteLease(winnerEngine, {
				remote: "origin",
				expectedGeneration: winner.generation,
				transactionId: winner.transactionId,
			});
			expect(released.status).toBe("released");
		}

		return { repetitions, winners, fenced };
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("two-clone remote lease race", () => {
	test("admits exactly one writer in 20 real Git races", async () => {
		const root = await mkdtemp(join(tmpdir(), "vault-git-race-remote-"));
		try {
			const remote = join(root, "remote.git");
			const seed = join(root, "seed");
			git(root, ["init", "--bare", "--initial-branch=main", remote]);
			git(root, ["clone", remote, seed]);
			configureGit(seed);
			await writeFile(join(seed, "seed.txt"), "seed\n");
			git(seed, ["add", "seed.txt"]);
			git(seed, ["commit", "-m", "test: seed main"]);
			git(seed, ["push", "origin", "HEAD:refs/heads/main"]);

			await expect(runTwoCloneRace(remote, 20)).resolves.toEqual({
				repetitions: 20,
				winners: 20,
				fenced: 20,
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);
});

function createEngine(repositoryPath: string) {
	return {
		git: createGitAdapter({
			repositoryPath,
			process: createNodeProcessPort(),
			timeouts: { fetchMs: 5_000, pushMs: 5_000, localMs: 5_000 },
		}),
		clock: { now: () => new Date() },
	};
}

function configureGit(repositoryPath: string): void {
	git(repositoryPath, ["config", "user.name", "Vault Test"]);
	git(repositoryPath, ["config", "user.email", "vault-test@example.invalid"]);
}

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
