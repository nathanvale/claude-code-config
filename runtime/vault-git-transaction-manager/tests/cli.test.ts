import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
	createVaultGitCliComposition,
	runVaultGitForTest,
	type VaultGitCliComposition,
} from "../src/cli.ts";
import { createNodeProcessPort } from "../src/git-adapter.ts";
import { createVaultGitActivationRestriction } from "../src/activation-restriction.ts";
import { resolveVaultRepositoryIdentity } from "../src/repository-identity.ts";
import type {
	VaultGitEngineResult,
	VaultGitTransactionEngine,
} from "../src/engine.ts";
import type { VaultGitRuntimePort } from "../src/ports.ts";
import type { VaultGitRepairInput } from "../src/repair.ts";
import { createReceiptStore, type VaultGitReceiptStore } from "../src/store.ts";
import {
	admitActivationForTest,
	admittedActivationAuthorityForTest,
} from "./activation-fixture.ts";
import { createTempDirectoryFixture } from "./temp-directory-fixture.ts";

const tempDirectories = createTempDirectoryFixture();

afterEach(tempDirectories.cleanup);

describe("vault-git CLI composition", () => {
	test("derives the private-store identity from the configured checkout", async () => {
		const repositoryPath = await temp("vault-git-composition-identity-");
		const initialized = spawnSync(
			"git",
			["init", "--initial-branch=main", repositoryPath],
			{ encoding: "utf8" },
		);
		expect(initialized.status).toBe(0);
		const stateRoot = await temp("vault-git-composition-state-");
		const process = createNodeProcessPort();
		const resolved = await resolveVaultRepositoryIdentity({
			repositoryPath,
			process,
			timeoutMs: 5_000,
		});

		const composition = await createVaultGitCliComposition({
			repositoryPath,
			checkRepositoryPath: repositoryPath,
			stateRoot,
			actor: "agent-a",
			host: "host-a",
			process,
		});

		expect(composition.store.repositoryId).toBe(
			createReceiptStore({
				stateRoot,
				repositoryIdentity: resolved.identity,
			}).repositoryId,
		);
	});

	test("refuses admission when the configured Git repository is replaced after composition", async () => {
		const repositoryPath = await temp("vault-git-composition-replaced-");
		const git = (...args: readonly string[]) =>
			spawnSync("git", args, { cwd: repositoryPath, encoding: "utf8" });
		expect(git("init", "--initial-branch=main").status).toBe(0);
		expect(
			git(
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@example.invalid",
				"commit",
				"--allow-empty",
				"-m",
				"initial",
			).status,
		).toBe(0);
		const composition = await createVaultGitCliComposition({
			repositoryPath,
			checkRepositoryPath: repositoryPath,
			stateRoot: await temp("vault-git-composition-replaced-state-"),
			actor: "agent-a",
			host: "host-a",
			activationAuthority: admittedActivationAuthorityForTest,
		});
		await admitActivationForTest(composition.store);

		await rm(join(repositoryPath, ".git"), { recursive: true });
		expect(git("init", "--initial-branch=main").status).toBe(0);
		expect(
			git(
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@example.invalid",
				"commit",
				"--allow-empty",
				"-m",
				"replacement",
			).status,
		).toBe(0);

		const result = await composition.engine.begin({
			event: "note_created",
			requestedPaths: ["notes/new.md"],
			remote: "origin",
			leaseDurationMs: 15 * 60_000,
		});
		expect(result).toMatchObject({
			status: "refused",
			blocker: "vault_identity_changed",
			changedState: "none",
		});
	});

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

	test("renders the same cause-specific activation restriction in JSON and text", async () => {
		const activationRestriction = createVaultGitActivationRestriction({
			stoppedAction: "vault_write",
			cause: "revoked",
		});
		const engine = fakeEngine({
			async begin() {
				return engineResult({
					status: "refused",
					blocker: "activation_blocked",
					retrySafety: "same_input_unsafe",
					nextAction: {
						id: "request_operator_admission",
						summary: "Ask an operator to admit runtime activation before canonical vault writes.",
					},
					activationRestriction,
				});
			},
		});
		const argv = [
			"begin",
			"--event",
			"note_created",
			"--path",
			"notes/new.md",
		] as const;

		const json = await runVaultGitForTest([...argv, "--json"], {
			composition: fakeComposition(engine),
			launchPrivate: false,
		});
		expect(json.exitCode).toBe(1);
		expect(JSON.parse(json.stdout).data).toMatchObject({
			blockers: ["activation_blocked"],
			next_action: { id: "request_operator_admission" },
			activation_restriction: {
				status: "restricted",
				stopped_action: "vault_write",
				cause: { id: "revoked" },
				next_action: { id: "prepare_fresh" },
			},
		});

		const text = await runVaultGitForTest(argv, {
			composition: fakeComposition(engine),
			launchPrivate: false,
		});
		expect(text.exitCode).toBe(1);
		expect(text.stderr).toContain("cause: revoked | A human revoked this activation evidence.");
		expect(text.stderr).toContain("next: prepare_fresh | Prepare fresh V2 evidence");
		expect(text.stderr).toContain("next: request_operator_admission");
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

	test("dispatches janitor and tidy now through the bounded worker triggers", async () => {
		const triggers: string[] = [];
		const base = fakeComposition(fakeEngine());
		const composition: VaultGitCliComposition = {
			...base,
			janitor: {
				async run(input) {
					triggers.push(input.trigger);
					return {
						status: "preview",
						trigger: input.trigger === "tidy_now" ? "tidy_now" : "nightly",
						staleReceipts: [],
						leaseAnomalies: [],
						pushPending: false,
						proposedTransactionGroups: [],
						skippedRepairs: [],
						privateHygiene: { capabilityFiles: 0, doctorTokenRecords: 0, janitorReports: 0 },
						vaultPosture: "normal",
						foregroundNonVaultWorkAllowed: true,
						nextAction: { id: "none", summary: "No repair pending." },
					};
				},
			},
		};
		for (const argv of [["janitor", "--json"], ["tidy", "now", "--json"]]) {
			const run = await runVaultGitForTest(argv, {
				composition,
				launchPrivate: false,
			});
			expect(run.exitCode).toBe(0);
			expect(JSON.parse(run.stdout).data).toMatchObject({
				outcome: "read_only",
				janitor_report: { status: "preview", push_pending: false },
				worker_eligibility: { eligible: true, requires_new_transaction: true },
			});
		}
		expect(triggers).toEqual(["nightly", "tidy_now"]);
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
				return {
					transactionId: "txn_00000000000000000000000000000001",
					ledgerGeneration: "generation-a",
					receiptId: "receipt-fixture",
					receiptRevision: 1,
					proofFingerprint: "fingerprint-fixture",
					issuedAt: "2026-01-01T00:00:00.000Z",
				};
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
	return tempDirectories.create(prefix);
}

function fakeComposition(
	engine: VaultGitTransactionEngine,
	storeOverrides: Partial<VaultGitReceiptStore> = {},
): VaultGitCliComposition {
	// Partial-typed fake: any drift in the VaultGitReceiptStore interface
	// fails typecheck here; the single cast happens at the final assignment.
	const store: Partial<VaultGitReceiptStore> &
		Pick<VaultGitReceiptStore, "load"> = {
		async load() {
			return { status: "absent" as const };
		},
		...storeOverrides,
	};
	const runtime: VaultGitRuntimePort = {
		now: () => new Date(0),
		actor: () => "agent-a",
		host: () => "host-a",
		newReceiptId: () => "receipt-fixture",
		interrupt: () => {},
	};
	return {
		engine,
		janitor: {
			async run(input) {
				return {
					status: "preview",
					trigger: input.trigger === "tidy_now" ? "tidy_now" : "nightly",
					staleReceipts: [],
					leaseAnomalies: [],
					pushPending: false,
					proposedTransactionGroups: [],
					skippedRepairs: [],
					privateHygiene: { capabilityFiles: 0, doctorTokenRecords: 0, janitorReports: 0 },
					vaultPosture: "normal",
					foregroundNonVaultWorkAllowed: true,
					nextAction: { id: "none", summary: "No repair pending." },
				};
			},
		},
		store: store as VaultGitReceiptStore,
		runtime,
		repositoryPath: "/fixture-vault",
		remote: "origin",
		leaseDurationMs: 60_000,
		privateEntrypointPath: import.meta.path,
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
		async inspectJanitorPreflight() {
			throw new Error("Janitor preflight not expected");
		},
		async readCheckerAdmission() {
			return null;
		},
		async prunePrivateHygiene() {
			return { capabilityFiles: 0, doctorTokenRecords: 0, janitorReports: 0 };
		},
		async recordJanitorReport() {},
		async runHygieneTransaction() {
			throw new Error("hygiene transaction not expected");
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
