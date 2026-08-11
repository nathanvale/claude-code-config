import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
	createVaultGitCliComposition,
	createVaultGitCliRecoveryComposition,
	runVaultGitForTest,
} from "../src/cli.ts";
import { createNodeProcessPort } from "../src/git-adapter.ts";
import type { VaultGitReceipt } from "../src/model.ts";
import { VaultRepositoryIdentityUnavailableError } from "../src/ports.ts";
import { resolveVaultRepositoryIdentity } from "../src/repository-identity.ts";
import { createReceiptStore } from "../src/store.ts";
import {
	admitActivationForTest,
	admittedActivationAuthorityForTest,
	preparedEvidenceForTest,
} from "./activation-fixture.ts";
import { createTempDirectoryFixture } from "./temp-directory-fixture.ts";

const LEGACY_STATE_IDENTITY = "configured-super-vault";
const tempDirectories = createTempDirectoryFixture();

afterEach(tempDirectories.cleanup);

describe("private-state composition upgrade", () => {
	test("keeps the active receipt visible to public Doctor after a repository restart", async () => {
		const repositoryPath = await gitRepository();
		const stateRoot = await tempDirectories.create("vault-git-upgrade-state-");
		const originalIdentity = (
			await resolveVaultRepositoryIdentity({
				repositoryPath,
				process: createNodeProcessPort(),
				timeoutMs: 5_000,
			})
		).identity;
		const originalStore = createReceiptStore({
			stateRoot,
			repositoryIdentity: originalIdentity,
		});
		await originalStore.initialize(activeReceipt());
		await originalStore.publishPreparedEvidence(
			preparedEvidenceForTest({ repositoryIdentity: originalIdentity }),
		);

		await rm(join(repositoryPath, ".git"), { recursive: true });
		initializeGit(repositoryPath, "replacement");

		const composition = await createVaultGitCliRecoveryComposition({
			repositoryPath,
			checkRepositoryPath: repositoryPath,
			stateRoot,
			actor: "agent-a",
			host: "host-a",
			activationAuthority: admittedActivationAuthorityForTest,
		});
		const run = await runVaultGitForTest(["doctor", "--json"], {
			composition,
			launchPrivate: false,
		});

		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout).data).toMatchObject({
			command: "doctor",
			phase: "writing",
			transaction_id: "txn_22222222222222222222222222222222",
			transaction_state: "human_required",
			blockers: ["vault_identity_changed"],
			next_action: { id: "inspect_configured_vault" },
		});
		expect(run.stdout).not.toContain("no_receipt");
	});

	test("keeps legacy receipt context visible when the identity probe is unavailable", async () => {
		const repositoryPath = await gitRepository();
		const stateRoot = await tempDirectories.create("vault-git-upgrade-state-");
		const legacyStore = createReceiptStore({
			stateRoot,
			repositoryIdentity: LEGACY_STATE_IDENTITY,
		});
		await legacyStore.initialize(activeReceipt());
		const unavailableProcess = {
			async run() {
				return {
					exitCode: null,
					stdout: "",
					stderr: "",
					timedOut: true,
				};
			},
		};

		const run = await runVaultGitForTest(["doctor", "--json"], {
			resolveComposition: () =>
				createVaultGitCliRecoveryComposition({
					repositoryPath,
					checkRepositoryPath: repositoryPath,
					stateRoot,
					actor: "agent-a",
					host: "host-a",
					process: unavailableProcess,
					activationAuthority: admittedActivationAuthorityForTest,
				}),
			launchPrivate: false,
		});

		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout).data).toMatchObject({
			command: "doctor",
			phase: "writing",
			transaction_id: "txn_22222222222222222222222222222222",
			transaction_state: "active",
			finding: "activation_missing",
			blockers: ["activation_blocked"],
			next_action: { id: "inspect_configured_vault" },
			activation_restriction: {
				cause: { id: "revalidation_unavailable" },
			},
		});
	});

	test("keeps ordinary write composition bound to live repository identity", async () => {
		const repositoryPath = await gitRepository();
		const stateRoot = await tempDirectories.create("vault-git-upgrade-state-");
		await createReceiptStore({
			stateRoot,
			repositoryIdentity: LEGACY_STATE_IDENTITY,
		}).initialize(activeReceipt());

		await expect(
			createVaultGitCliComposition({
				repositoryPath,
				checkRepositoryPath: repositoryPath,
				stateRoot,
				actor: "agent-a",
				host: "host-a",
				process: {
					async run() {
						return {
							exitCode: null,
							stdout: "",
							stderr: "",
							timedOut: true,
						};
					},
				},
			}),
		).rejects.toBeInstanceOf(VaultRepositoryIdentityUnavailableError);
	});

	test("keeps an unresolved receipt from the populated legacy namespace visible", async () => {
		const repositoryPath = await gitRepository();
		const stateRoot = await tempDirectories.create("vault-git-upgrade-state-");
		const legacyStore = createReceiptStore({
			stateRoot,
			repositoryIdentity: LEGACY_STATE_IDENTITY,
		});
		await legacyStore.initialize(receipt(), {
			ownerCapability: new Uint8Array([1]),
			joinCapability: new Uint8Array([2]),
		});

		const composition = await createVaultGitCliComposition({
			repositoryPath,
			checkRepositoryPath: repositoryPath,
			stateRoot,
			actor: "agent-a",
			host: "host-a",
		});

		expect(composition.store.repositoryId).toBe(legacyStore.repositoryId);
		expect(await composition.store.load()).toMatchObject({
			status: "loaded",
			receipt: { phase: "intent_durable" },
		});
	});

	test("refuses dual populated canonical and legacy namespaces", async () => {
		const repositoryPath = await gitRepository();
		const stateRoot = await tempDirectories.create("vault-git-upgrade-state-");
		const canonicalIdentity = (
			await resolveVaultRepositoryIdentity({
				repositoryPath,
				process: createNodeProcessPort(),
				timeoutMs: 5_000,
			})
		).identity;
		const canonicalStore = createReceiptStore({
			stateRoot,
			repositoryIdentity: canonicalIdentity,
		});
		const legacyStore = createReceiptStore({
			stateRoot,
			repositoryIdentity: LEGACY_STATE_IDENTITY,
		});
		await canonicalStore.initialize(receipt());
		await legacyStore.initialize(receipt());

		await expect(
			createVaultGitCliComposition({
				repositoryPath,
				checkRepositoryPath: repositoryPath,
				stateRoot,
				actor: "agent-a",
				host: "host-a",
			}),
		).rejects.toThrow(
			"canonical and legacy private-state namespaces are both populated",
		);
	});

	test("reports dual populated namespaces visibly through public Doctor", async () => {
		const repositoryPath = await gitRepository();
		const stateRoot = await tempDirectories.create("vault-git-upgrade-state-");
		const canonicalIdentity = (
			await resolveVaultRepositoryIdentity({
				repositoryPath,
				process: createNodeProcessPort(),
				timeoutMs: 5_000,
			})
		).identity;
		await createReceiptStore({
			stateRoot,
			repositoryIdentity: canonicalIdentity,
		}).initialize(activeReceipt());
		await createReceiptStore({
			stateRoot,
			repositoryIdentity: LEGACY_STATE_IDENTITY,
		}).initialize(activeReceipt());

		const run = await runVaultGitForTest(["doctor", "--json"], {
			resolveComposition: () =>
				createVaultGitCliRecoveryComposition({
					repositoryPath,
					checkRepositoryPath: repositoryPath,
					stateRoot,
					actor: "agent-a",
					host: "host-a",
				}),
			launchPrivate: false,
		});

		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout).data).toMatchObject({
			command: "doctor",
			outcome: "read_only",
			phase: "human_required",
			blockers: ["receipt_conflict"],
			next_action: { id: "inspect_private_receipt" },
		});
		expect(run.stdout).not.toContain("vault_unconfigured");
	});

	test("uses the derived namespace for a fresh empty installation", async () => {
		const repositoryPath = await gitRepository();
		const stateRoot = await tempDirectories.create("vault-git-upgrade-state-");
		const canonicalIdentity = (
			await resolveVaultRepositoryIdentity({
				repositoryPath,
				process: createNodeProcessPort(),
				timeoutMs: 5_000,
			})
		).identity;

		const composition = await createVaultGitCliComposition({
			repositoryPath,
			checkRepositoryPath: repositoryPath,
			stateRoot,
			actor: "agent-a",
			host: "host-a",
		});

		expect(composition.store.repositoryId).toBe(
			createReceiptStore({
				stateRoot,
				repositoryIdentity: canonicalIdentity,
			}).repositoryId,
		);
	});

	test("keeps live canonical identity proof with an explicitly configured legacy namespace", async () => {
		const repositoryPath = await gitRepository();
		const stateRoot = await tempDirectories.create("vault-git-upgrade-state-");
		const configuredLegacyIdentity = "operator-configured-vault";
		const legacyStore = createReceiptStore({
			stateRoot,
			repositoryIdentity: configuredLegacyIdentity,
		});
		await admitActivationForTest(legacyStore);
		const composition = await createVaultGitCliComposition({
			repositoryPath,
			checkRepositoryPath: repositoryPath,
			stateRoot,
			privateStateNamespaceIdentity: configuredLegacyIdentity,
			actor: "agent-a",
			host: "host-a",
			activationAuthority: admittedActivationAuthorityForTest,
		});

		expect(composition.store.repositoryId).toBe(legacyStore.repositoryId);
		await rm(join(repositoryPath, ".git"), { recursive: true });
		initializeGit(repositoryPath, "replacement");

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
});

async function gitRepository(): Promise<string> {
	const repositoryPath = await tempDirectories.create("vault-git-upgrade-repository-");
	initializeGit(repositoryPath, "initial");
	return repositoryPath;
}

function initializeGit(repositoryPath: string, message: string): void {
	const initialized = spawnSync(
		"git",
		["init", "--initial-branch=main", repositoryPath],
		{ encoding: "utf8" },
	);
	if (initialized.status !== 0) throw new Error("Git fixture initialization failed");
	const committed = spawnSync(
		"git",
		[
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"--allow-empty",
			"-m",
			message,
		],
		{ cwd: repositoryPath, encoding: "utf8" },
	);
	if (committed.status !== 0) throw new Error("Git fixture commit failed");
}

function receipt(): VaultGitReceipt {
	return {
		schemaVersion: 2,
		receiptId: "receipt_11111111111111111111111111111111",
		transactionId: null,
		revision: 1,
		phase: "intent_durable",
		transition: "acquisition_intent",
		recordedAt: "2026-08-11T00:00:00.000Z",
		event: "note_created",
		actor: "agent-a",
		host: "host-a",
		remote: "origin",
		ownedPaths: [
			{
				path: "notes/example.md",
				baselineHash: null,
				admittedNewFile: true,
			},
		],
		unrelatedState: { statusHex: "", indexHex: "" },
		localMainHead: "a".repeat(40),
		remoteMainHead: "a".repeat(40),
		expectedLeaseGeneration: null,
		leaseGeneration: null,
		leaseAcquiredAt: null,
		leaseDurationMs: 60_000,
		commitId: null,
		expectedMainCommit: null,
		ledgerReleaseId: null,
		pushOutcome: "not_attempted",
		nextSafeAction: "retry_remote",
		diagnosticsReference:
			"receipt:receipt_11111111111111111111111111111111",
	};
}

function activeReceipt(): VaultGitReceipt {
	return {
		...receipt(),
		transactionId: "txn_22222222222222222222222222222222",
		phase: "writing",
		transition: "write_authority_granted",
		expectedLeaseGeneration: "b".repeat(40),
		leaseGeneration: "c".repeat(40),
		leaseAcquiredAt: "2026-08-11T00:00:00.000Z",
		nextSafeAction: "resume_writing",
	};
}
