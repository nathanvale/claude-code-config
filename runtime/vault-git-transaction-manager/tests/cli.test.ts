import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
	createVaultGitCliComposition,
	runVaultGitForTest,
	type VaultGitCliComposition,
} from "../src/cli.ts";
import type {
	VaultGitEngineResult,
	VaultGitTransactionEngine,
} from "../src/engine.ts";
import type { VaultGitRepairInput } from "../src/repair.ts";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("vault-git CLI composition", () => {
	test("refuses check and repository ports rooted at different vaults", async () => {
		const repositoryPath = await temp("vault-git-composition-repository-");
		const checkRepositoryPath = await temp("vault-git-composition-check-");
		await expect(
			createVaultGitCliComposition({
				repositoryPath,
				checkRepositoryPath,
				stateRoot: await temp("vault-git-composition-state-"),
				repositoryIdentity: "fixture-vault",
				actor: "agent-a",
				host: "host-a",
			}),
		).rejects.toThrow("must resolve to the same root");
	});

	test("dispatches begin to the transaction engine and exposes safe correlation", async () => {
		let observedPaths: readonly string[] = [];
		const engine = fakeEngine({
			async begin(input) {
				observedPaths = input.requestedPaths;
				return engineResult({
					status: "admitted",
					phase: "writing",
					writePermission: "owner",
					changedState: "remote",
					transactionId: "txn_00000000000000000000000000000001",
					nextAction: {
						id: "complete_transaction",
						summary: "Complete the meaningful event explicitly.",
					},
				});
			},
		});
		const run = await runVaultGitForTest(
			[
				"begin",
				"--event",
				"note_created",
				"--path",
				"notes/new.md",
				"--json",
			],
			{ composition: fakeComposition(engine), launchPrivate: false },
		);
		expect(run.exitCode).toBe(0);
		expect(run.stderr).toBe("");
		expect(observedPaths).toEqual(["notes/new.md"]);
		expect(JSON.parse(run.stdout)).toMatchObject({
			status: "ok",
			data: {
				outcome: "admitted",
				phase: "writing",
				write_permission: "owner",
				changed_state: "remote",
				transaction_id: "txn_00000000000000000000000000000001",
				next_action: { id: "complete_transaction" },
			},
			continuation: { next_action_id: "complete_transaction" },
		});
		expect(run.stdout).not.toMatch(/capability|\/private\/|\/Users\//);
	});

	test("keeps the configured dashboard read-only with one continuation", async () => {
		const run = await runVaultGitForTest(["--json"], {
			composition: fakeComposition(fakeEngine()),
			launchPrivate: false,
		});
		const envelope = JSON.parse(run.stdout);
		expect(run.exitCode).toBe(0);
		expect(envelope.data).toMatchObject({
			command: "status",
			outcome: "read_only",
			write_permission: "denied",
			changed_state: "none",
			next_action: { id: "begin_transaction" },
		});
		expect(envelope.runtime_actions).toHaveLength(1);
	});

	test("keeps the public doctor command read-only", async () => {
		let issueTakeoverToken: boolean | undefined;
		const engine = fakeEngine({
			async doctor(input) {
				issueTakeoverToken = input?.issueTakeoverToken;
				return {
					status: "diagnosed",
					state: "absent",
					phase: "blocked",
					finding: "no_receipt",
					changedState: "none",
					retrySafety: "same_input_safe",
					nextAction: {
						id: "begin_transaction",
						summary: "Begin one transaction before canonical writes.",
					},
					diagnosticsReference: "doctor:fixture",
				};
			},
		});
		const run = await runVaultGitForTest(["doctor", "--json"], {
			composition: fakeComposition(engine),
			launchPrivate: false,
		});
		expect(run.exitCode).toBe(0);
		expect(issueTakeoverToken).toBe(false);
		expect(JSON.parse(run.stdout).data).toMatchObject({
			command: "doctor",
			outcome: "read_only",
			changed_state: "none",
		});
	});

	test("keeps an unexpected runtime failure diagnostic on stderr", async () => {
		const engine = fakeEngine({
			async begin() {
				throw new Error("private implementation detail");
			},
		});
		const run = await runVaultGitForTest(
			[
				"begin",
				"--event",
				"note_created",
				"--path",
				"notes/a.md",
				"--json",
			],
			{ composition: fakeComposition(engine), launchPrivate: false },
		);
		expect(run.exitCode).toBe(1);
		expect(JSON.parse(run.stdout).error.code).toBe("unexpected_runtime_failure");
		expect(run.stderr).toContain("unexpected runtime failure");
		expect(`${run.stdout}${run.stderr}`).not.toContain(
			"private implementation detail",
		);
	});

	test("dispatches the exact stale takeover path with FD token proof", async () => {
		let observedRepair: VaultGitRepairInput | undefined;
		const engine = fakeEngine({
			async doctor() {
				return {
					status: "diagnosed",
					state: "expired",
					phase: "writing",
					finding: "lease_expired",
					changedState: "none",
					retrySafety: "operator_required",
					nextAction: { id: "run_repair", summary: "Run the admitted repair." },
					diagnosticsReference: "doctor:fixture",
					repairAction: "stale-lease-takeover",
					transactionId: "txn_00000000000000000000000000000001",
					ledgerGeneration: "generation-a",
				};
			},
			async repair(input) {
				observedRepair = input;
				return {
					status: "repaired",
					action: "stale-lease-takeover",
					state: "closed",
					phase: "closed",
					changedState: "remote",
					retrySafety: "same_input_safe",
					nextAction: { id: "none", summary: "No further action." },
					diagnosticsReference: "repair:fixture",
				};
			},
		});
		const composition = fakeComposition(engine, {
			async readDoctorProof() {
				return { ledgerGeneration: "generation-a" };
			},
		});
		const run = await runVaultGitForTest(
			[
				"repair",
				"stale-lease-takeover",
				"--transaction-id",
				"txn_00000000000000000000000000000001",
				"--prior-writer-stopped",
				"--capability-fd",
				"7",
				"--json",
			],
			{
				composition,
				launchPrivate: false,
				readCapability: async () => new Uint8Array([1, 2, 3]),
			},
		);
		expect(run.exitCode).toBe(0);
		expect(observedRepair).toMatchObject({
			action: "stale-lease-takeover",
			transactionId: "txn_00000000000000000000000000000001",
			expectedLedgerGeneration: "generation-a",
			priorWriterStopped: true,
		});
		expect(observedRepair?.doctorToken).toEqual(new Uint8Array([1, 2, 3]));
	});
});

async function temp(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

function fakeComposition(
	engine: VaultGitTransactionEngine,
	storeOverrides: Record<string, unknown> = {},
): VaultGitCliComposition {
	return {
		engine,
		store: {
			async load() {
				return { status: "absent" as const };
			},
			...storeOverrides,
		} as never,
		runtime: {} as never,
		repositoryPath: "/fixture-vault",
		remote: "origin",
		leaseDurationMs: 60_000,
	};
}

function fakeEngine(
	overrides: Partial<VaultGitTransactionEngine> = {},
): VaultGitTransactionEngine {
	return {
		async begin() {
			return engineResult();
		},
		async join() {
			return engineResult();
		},
		async complete() {
			return engineResult();
		},
		async inspect() {
			return engineResult();
		},
		async recordPhase() {
			return engineResult();
		},
		async doctor() {
			throw new Error("doctor not expected");
		},
		async repair() {
			throw new Error("repair not expected");
		},
		...overrides,
	};
}

function engineResult(
	overrides: Partial<VaultGitEngineResult> = {},
): VaultGitEngineResult {
	return {
		status: "inspected",
		state: "absent",
		phase: "blocked",
		writePermission: "denied",
		changedState: "none",
		retrySafety: "same_input_safe",
		nextAction: {
			id: "begin_transaction",
			summary: "Begin one transaction before canonical writes.",
		},
		...overrides,
	};
}
