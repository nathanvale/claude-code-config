import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Dirent } from "node:fs";
import {
	chmod,
	mkdir,
	readFile,
	readdir,
	readlink,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
import {
	parseCliProcessJson,
	runCliProcess,
} from "@side-quest/cli-command-facade/testing";

import {
	createVaultGitActivationAuthority,
	createVaultGitActivationPreparer,
	resolveVaultGitActivationIdentities,
	resolveVaultRepositoryIdentity,
	type VaultGitReceipt,
	VAULT_GIT_ABSENT_LEDGER_GENERATION,
} from "../src/index.ts";
import {
	createGitAdapter,
	createNodeProcessPort,
} from "../src/git-adapter.ts";
import { acquireRemoteLease } from "../src/remote-ledger.ts";
import {
	createVaultCheckerPort,
	VAULT_GIT_PRODUCTION_EXECUTABLE_SOURCE_PATHS,
} from "../src/cli.ts";
import type { VaultGitCheckerPort } from "../src/ports.ts";
import type { VaultGitProcessRequest } from "../src/ports.ts";
import type { VaultGitNextAction } from "../src/model.ts";
import type {
	RuntimeActionGuidance,
	RuntimeContinuationGuidance,
} from "@side-quest/cli-command-facade";
import { createReceiptStore } from "../src/store.ts";
import { createTempDirectoryFixture } from "./temp-directory-fixture.ts";

const tempDirectories = createTempDirectoryFixture();
afterEach(tempDirectories.cleanup);

describe("isolated activation preparation", () => {
	test(
		"production Doctor requires a stable host identity instead of trusting the OS hostname",
		async () => {
			const fixture = await preparationFixture({ seedLedger: false });
			const env = configuredProductionActivationEnvironment(fixture);
			delete env.VAULT_GIT_HOST;
			const result = await runCliProcess({
				label: "production stable host identity configuration",
				argv: [
					"bun",
					"run",
					join(import.meta.dir, "../src/cli.ts"),
					"doctor",
					"--json",
					"--run-id",
					"stable-host-identity-missing",
				],
				cwd: fixture.repositoryPath,
				env,
				timeoutMs: 30_000,
			});

			expect(result.exitCode).toBe(0);
			expect(parseCliProcessJson(result)).toMatchObject({
				status: "ok",
				data: {
					command: "doctor",
					finding: "activation_configuration_missing",
					write_permission: "denied",
					activation_restriction: {
						cause: { id: "configuration_missing" },
						missing_configuration: ["host_identity"],
						next_action: { id: "configure_activation_identity" },
					},
				},
				continuation: { next_action_id: "configure_activation_identity" },
			});
		},
		120_000,
	);

	test(
		"production Doctor explains missing activation identity configuration without a self-loop",
		async () => {
			const fixture = await preparationFixture({ seedLedger: false });
			const result = await runCliProcess({
				label: "production activation configuration Doctor",
				argv: [
					"bun",
					"run",
					join(import.meta.dir, "../src/cli.ts"),
					"doctor",
					"--json",
					"--run-id",
					"activation-configuration-missing",
				],
				cwd: fixture.repositoryPath,
				env: productionActivationEnvironment(fixture),
				timeoutMs: 30_000,
			});

			expect(result.exitCode).toBe(0);
			const envelope = parseCliProcessJson(result);
			expect(envelope).toMatchObject({
				status: "ok",
				data: {
					command: "doctor",
					outcome: "read_only",
					finding: "activation_configuration_missing",
					changed_state: "none",
					next_action: { id: "configure_activation_identity" },
					activation_restriction: {
						cause: { id: "configuration_missing" },
						missing_configuration: [
							"ssh_identity_file",
							"ssh_public_key",
							"ssh_known_hosts",
						],
						next_action: { id: "configure_activation_identity" },
					},
				},
				continuation: { next_action_id: "configure_activation_identity" },
			});
			expect(JSON.stringify(envelope)).not.toContain("run_doctor");
		},
		120_000,
	);

	test(
		"production activation prepares a dependency-free vault without bun.lock",
		async () => {
			const fixture = await preparationFixture({
				includeLockfile: false,
				seedLedger: false,
			});
			const before = await canonicalSnapshot(fixture.repositoryPath);
			const result = await runCliProcess({
				label: "production dependency-free activation preparation",
				argv: [
					"bun",
					"run",
					join(import.meta.dir, "../src/cli.ts"),
					"activation",
					"prepare",
					"--no-input",
					"--json",
					"--run-id",
					"dependency-free-lockfile-absence",
				],
				cwd: fixture.repositoryPath,
				env: configuredProductionActivationEnvironment(fixture),
				timeoutMs: 30_000,
			});

			expect({
				exitCode: result.exitCode,
				envelope: parseCliProcessJson(result),
			}).toMatchObject({
				exitCode: 0,
				envelope: {
					status: "ok",
					data: {
						status: "prepared",
						authority: "evidence_only",
						write_permission: "denied",
						changed_state: "none",
						next_action: { id: "review_prepared" },
					},
					continuation: { next_action_id: "review_prepared" },
				},
			});
			expect(await canonicalSnapshot(fixture.repositoryPath)).toEqual(before);
		},
		120_000,
	);

	test(
		"production activation, status, and Doctor agree after prepared evidence is invalidated",
		async () => {
			const fixture = await preparationFixture({ seedLedger: false });
			const prepared = await fixture.preparer.prepare();
			if (prepared.status !== "prepared") throw new Error("expected prepared");
			await fixture.store.recordActivationInvalidation({
				schemaVersion: 1,
				evidenceId: prepared.evidence.evidenceId,
				binding: "checkerClosure",
				invalidatedAt: "2026-08-11T00:00:01.000Z",
			});
			const before = await canonicalSnapshot(fixture.repositoryPath);
			await expectProductionContinuationParity(fixture, "prepare_fresh");
			expect(await canonicalSnapshot(fixture.repositoryPath)).toEqual(before);
		},
		120_000,
	);

	for (const scenario of [
		{
			name: "unprepared",
			nextAction: "prepare_fresh",
			setup: async () => preparationFixture({ seedLedger: false }),
		},
		{
			name: "prepared",
			nextAction: "review_prepared",
			setup: async () => {
				const fixture = await preparationFixture({
					clock: () => new Date().toISOString(),
					seedLedger: false,
				});
				if ((await fixture.preparer.prepare()).status !== "prepared") {
					throw new Error("expected prepared");
				}
				return fixture;
			},
		},
		{
			name: "stale",
			nextAction: "prepare_fresh",
			setup: async () => {
				const fixture = await preparationFixture({ seedLedger: false });
				if ((await fixture.preparer.prepare()).status !== "prepared") {
					throw new Error("expected prepared");
				}
				return fixture;
			},
		},
		{
			name: "revoked",
			nextAction: "prepare_fresh",
			setup: async () => {
				const fixture = await preparationFixture({ seedLedger: false });
				const prepared = await fixture.preparer.prepare();
				if (prepared.status !== "prepared") throw new Error("expected prepared");
				await fixture.store.admitActivation({
					schemaVersion: 2,
					evidenceId: prepared.evidence.evidenceId,
					admittedAt: "2026-08-11T00:00:01.000Z",
					note: "fixture human review",
				});
				await fixture.store.recordActivationRevocation({
					schemaVersion: 1,
					evidenceId: prepared.evidence.evidenceId,
					revokedAt: "2026-08-11T00:00:02.000Z",
					note: "fixture human revocation",
				});
				return fixture;
			},
		},
		{
			name: "admitted",
			nextAction: "begin_transaction",
			setup: async () => {
				const fixture = await preparationFixture({
					clock: () => new Date().toISOString(),
					seedLedger: false,
				});
				const prepared = await fixture.preparer.prepare();
				if (prepared.status !== "prepared") throw new Error("expected prepared");
				await fixture.store.admitActivation({
					schemaVersion: 2,
					evidenceId: prepared.evidence.evidenceId,
					admittedAt: new Date().toISOString(),
					note: "fixture human review",
				});
				return fixture;
			},
		},
		{
			name: "admitted with live binding drift",
			nextAction: "prepare_fresh",
			setup: async () => {
				const fixture = await preparationFixture({
					clock: () => new Date().toISOString(),
					seedLedger: false,
				});
				const prepared = await fixture.preparer.prepare();
				if (prepared.status !== "prepared") throw new Error("expected prepared");
				await fixture.store.admitActivation({
					schemaVersion: 2,
					evidenceId: prepared.evidence.evidenceId,
					admittedAt: new Date().toISOString(),
					note: "fixture human review",
				});
				await writeFile(fixture.publicKeyPath, "ssh-ed25519 changed-key\n");
				return fixture;
			},
		},
		{
			name: "fresh V2 evidence after a legacy admission",
			nextAction: "review_prepared",
			setup: async () => {
				const fixture = await preparationFixture({
					clock: () => new Date().toISOString(),
					seedLedger: false,
				});
				if ((await fixture.preparer.prepare()).status !== "prepared") {
					throw new Error("expected prepared");
				}
				await writeFile(
					fixture.store.paths.activation,
					JSON.stringify({
						schemaVersion: 1,
						admittedAt: new Date().toISOString(),
						note: "legacy fixture admission",
					}),
					{ mode: 0o600 },
				);
				return fixture;
			},
		},
		{
			name: "unavailable",
			nextAction: "inspect_configured_vault",
			setup: async () => {
				const fixture = await preparationFixture({ seedLedger: false });
				if ((await fixture.preparer.prepare()).status !== "prepared") {
					throw new Error("expected prepared");
				}
				await writeFile(fixture.store.paths.preparedEvidence, "{}\n");
				return fixture;
			},
		},
	] as const) {
		test(
			`production activation, status, and Doctor share the ${scenario.name} continuation`,
			async () => {
				const fixture = await scenario.setup();
				const before = await canonicalSnapshot(fixture.repositoryPath);

				await expectProductionContinuationParity(
					fixture,
					scenario.nextAction,
				);
				expect(await canonicalSnapshot(fixture.repositoryPath)).toEqual(before);
			},
			120_000,
		);
	}

	test(
		"production CLI refuses, revalidates admitted V2 evidence, and opens the write gate",
		async () => {
			const fixture = await preparationFixture({ seedLedger: false });
			const env: NodeJS.ProcessEnv = {
				...productionActivationEnvironment(fixture),
				VAULT_GIT_GIT_BINARY_PATH: "/usr/bin/git",
				VAULT_GIT_SSH_BINARY_PATH: "/usr/bin/ssh",
				VAULT_GIT_SSH_IDENTITY_FILE_PATH: fixture.privateKeyPath,
				VAULT_GIT_SSH_PUBLIC_KEY_PATH: fixture.publicKeyPath,
				VAULT_GIT_SSH_KNOWN_HOSTS_PATH: fixture.knownHostsPath,
			};
			const runProductionBegin = (runId: string) =>
				runCliProcess({
					label: `production activation canary ${runId}`,
					argv: [
						"bun", "run", join(import.meta.dir, "../src/cli.ts"),
						"begin", "--event", "note_created", "--path", "notes/a.md",
						"--json", "--run-id", runId,
					],
					cwd: fixture.repositoryPath,
					env,
					timeoutMs: 30_000,
				});

			const missing = await runProductionBegin("activation-missing");
			expect(missing.exitCode).toBe(1);
			expect(parseCliProcessJson(missing)).toMatchObject({
				status: "error",
				error: { code: "activation_blocked" },
				data: { activation_restriction: { cause: { id: "evidence_changed" } } },
			});

			const prepared = await fixture.preparer.prepare();
			if (prepared.status !== "prepared") throw new Error("expected prepared");
			const capability = new Uint8Array([4, 2]);
			const authority = createVaultGitActivationAuthority({
				store: fixture.store,
				clock: () => "2026-08-11T00:00:01.000Z",
				validateHumanCapability: async (candidate) =>
					candidate.length === capability.length &&
					candidate.every((byte, index) => byte === capability[index]),
				revalidate: fixture.preparer.revalidate,
			});
			expect(await authority.admit({
				evidenceId: prepared.evidence.evidenceId,
				humanCapability: capability,
				note: "fixture human review",
			})).toMatchObject({ status: "admitted" });

			const admitted = await runProductionBegin("activation-admitted");
			if (admitted.exitCode !== 0) {
				const invalidation = await fixture.store.readActivationInvalidation(
					prepared.evidence.evidenceId,
				);
				throw new Error(
					`production admission failed after ${invalidation?.binding ?? "unknown"} changed`,
				);
			}
			expect({
				exitCode: admitted.exitCode,
				envelope: parseCliProcessJson(admitted),
			}).toMatchObject({
				exitCode: 0,
				envelope: {
					status: "ok",
					data: { outcome: "admitted", write_permission: "owner" },
				},
			});

			await writeFile(fixture.publicKeyPath, "ssh-ed25519 changed-key\n");
			const changed = await runProductionBegin("activation-changed");
			expect(changed.exitCode).toBe(1);
			expect(parseCliProcessJson(changed)).toMatchObject({
				status: "error",
				error: { code: "activation_blocked" },
				data: { activation_restriction: { cause: { id: "binding_changed" } } },
			});
		},
		120_000,
	);

	test("publishes V2 evidence without changing canonical Git or granting authority", async () => {
		const fixture = await preparationFixture();
		const before = await canonicalSnapshot(fixture.repositoryPath);

		const result = await fixture.preparer.prepare();

		expect(result).toMatchObject({
			status: "prepared",
			result: {
				status: "prepared",
				authority: "evidence_only",
				write_permission: "denied",
				changed_state: "none",
			},
		});
		if (result.status !== "prepared") throw new Error("expected prepared");
		expect(result.evidence.localMainHead).toBe(fixture.mainHead);
		expect(result.evidence.remoteMainHead).toBe(fixture.mainHead);
		expect(result.evidence.ledgerGeneration).toBe(fixture.ledgerGeneration);
		expect(await fixture.store.readPreparedEvidence()).toEqual(result.evidence);
		expect(await fixture.store.readActivation()).toBeNull();
		expect(await canonicalSnapshot(fixture.repositoryPath)).toEqual(before);
	});

	test("remote preparation uses the exact admitted Git transport closure", async () => {
		const observed: VaultGitProcessRequest[] = [];
		const admittedGitEnvironment = {
			GIT_SSH_COMMAND: "'/usr/bin/ssh' -F /dev/null -o BatchMode=yes",
			GIT_SSH_VARIANT: "ssh",
		} as const;
		const fixture = await preparationFixture({
			admittedGitEnvironment,
			observeProcess(request) {
				observed.push(request);
			},
		});

		expect((await fixture.preparer.prepare()).status).toBe("prepared");
		const remoteRequests = observed.filter(({ args }) =>
			["clone", "ls-remote", "fetch"].includes(args[0] ?? ""),
		);
		expect(remoteRequests.length).toBeGreaterThan(0);
		for (const request of remoteRequests) {
			expect(request.env).toMatchObject(admittedGitEnvironment);
		}
	});

	test("refuses an unsafe configured remote before any network-capable Git command", async () => {
		const observed: VaultGitProcessRequest[] = [];
		const fixture = await preparationFixture({
			observeProcess(request) {
				observed.push(request);
			},
		});
		git(fixture.repositoryPath, [
			"remote",
			"set-url",
			"origin",
			"ext::sh -c exploit",
		]);

		expect(await fixture.preparer.prepare()).toEqual({
			status: "refused",
			reason: "remote_unavailable",
			changedState: "none",
		});
		expect(
			observed.some(({ args }) =>
				args[0] === "fetch" ||
				(args[0] === "ls-remote" && args[1] !== "--get-url"),
			),
		).toBe(false);
	});

	test("workspace cleanup failure refuses before evidence publication", async () => {
		const fixture = await preparationFixture({
			async removeWorkspace() {
				throw new Error("fixture cleanup failure");
			},
		});

		expect(await fixture.preparer.prepare()).toEqual({
			status: "unknown",
			reason: "preparation_interrupted",
			changedState: "none",
		});
		expect(await fixture.store.readPreparedEvidence()).toBeNull();
	});

	test("workspace cleanup failure makes live revalidation unavailable", async () => {
		const fixture = await preparationFixture({
			async removeWorkspace() {
				throw new Error("fixture cleanup failure");
			},
		});

		await expect(fixture.preparer.revalidate()).rejects.toThrow(
			"activation preparation cleanup failed",
		);
	});

	test("refuses a symlinked private root without changing its target mode", async () => {
		const fixture = await preparationFixture();
		const target = join(await tempDirectories.create("vault-git-state-target-"), "state");
		await mkdir(target, { mode: 0o755 });
		await chmod(target, 0o755);
		await rm(fixture.stateRoot, { recursive: true, force: true });
		await symlink(target, fixture.stateRoot);
		const modeBefore = (await stat(target)).mode & 0o7777;

		expect(await fixture.preparer.prepare()).toEqual({
			status: "unknown",
			reason: "preparation_interrupted",
			changedState: "none",
		});
		expect((await stat(target)).mode & 0o7777).toBe(modeBefore);
	});

	test("checker refusal leaves worktree, index, every ref, and object database byte-identical", async () => {
		const fixture = await preparationFixture({
			createChecker() {
				return checkerFailure();
			},
		});
		const before = await canonicalSnapshot(fixture.repositoryPath);

		const result = await fixture.preparer.prepare();

		expect(result).toEqual({
			status: "refused",
			reason: "checker_failed",
			changedState: "none",
		});
		expect(await fixture.store.readPreparedEvidence()).toBeNull();
		expect(await fixture.store.readActivation()).toBeNull();
		expect(await canonicalSnapshot(fixture.repositoryPath)).toEqual(before);
	});

	for (const [name, stdout] of [
		["malformed structured success", JSON.stringify({ schema_version: 1 })],
		[
			"non-empty findings with exit zero",
			JSON.stringify({ schema_version: 1, findings: [{ id: "unsafe" }] }),
		],
	] as const) {
		test(`${name} refuses preparation`, async () => {
			const fixture = await preparationFixture({
				createChecker: () => checkerResult({ exitCode: 0, stdout }),
			});
			const before = await canonicalSnapshot(fixture.repositoryPath);

			expect(await fixture.preparer.prepare()).toEqual({
				status: "refused",
				reason: "checker_failed",
				changedState: "none",
			});
			expect(await canonicalSnapshot(fixture.repositoryPath)).toEqual(before);
		});
	}

	test("remote refusal leaves every canonical surface byte-identical", async () => {
		const fixture = await preparationFixture();
		git(fixture.remotePath, ["update-ref", "-d", "refs/heads/main"]);
		const before = await canonicalSnapshot(fixture.repositoryPath);

		const result = await fixture.preparer.prepare();

		expect(result).toEqual({
			status: "refused",
			reason: "remote_unavailable",
			changedState: "none",
		});
		expect(await canonicalSnapshot(fixture.repositoryPath)).toEqual(before);
	});

	test("prepares the exact absent-ledger generation before the first transaction", async () => {
		const fixture = await preparationFixture();
		git(fixture.remotePath, [
			"update-ref",
			"-d",
			"refs/heads/vault-system/transaction-ledger",
		]);
		const before = await canonicalSnapshot(fixture.repositoryPath);

		const result = await fixture.preparer.prepare();

		if (result.status !== "prepared") throw new Error("expected prepared");
		expect(result.evidence.ledgerGeneration).toBe(
			VAULT_GIT_ABSENT_LEDGER_GENERATION,
		);
		expect(await canonicalSnapshot(fixture.repositoryPath)).toEqual(before);
	});

	test("prepares fresh evidence for the exact receipt-bound push-pending recovery", async () => {
		const fixture = await preparationFixture({ seedLedger: false });
		const processPort = createNodeProcessPort();
		const acquired = await acquireRemoteLease(
			{
				git: createGitAdapter({
					repositoryPath: fixture.repositoryPath,
					process: processPort,
					timeouts: { localMs: 5_000, fetchMs: 5_000, pushMs: 5_000 },
				}),
				clock: { now: () => new Date("2026-08-11T00:00:00.000Z") },
			},
			{
				remote: "origin",
				expectedGeneration: null,
				actor: "fixture-operator",
				host: "fixture-host",
				event: "note_created",
				ownedPaths: ["recovery.md"],
				leaseDurationMs: 60_000,
			},
		);
		if (acquired.status !== "acquired") {
			throw new Error(JSON.stringify(acquired));
		}

		await writeFile(join(fixture.repositoryPath, "recovery.md"), "preserved\n");
		git(fixture.repositoryPath, ["add", "recovery.md"]);
		git(fixture.repositoryPath, [
			"-c", "user.name=Fixture",
			"-c", "user.email=fixture@example.invalid",
			"commit", "-m", "preserve recovery candidate",
		]);
		const candidate = gitOutput(fixture.repositoryPath, [
			"rev-parse", "refs/heads/main",
		]);
		const receipt: VaultGitReceipt = {
			schemaVersion: 2,
			receiptId: `receipt_${"3".repeat(32)}`,
			transactionId: acquired.transactionId,
			revision: 1,
			phase: "push_pending",
			transition: "push_outcome_unknown",
			recordedAt: "2026-08-11T00:00:01.000Z",
			event: "note_created",
			actor: "fixture-operator",
			host: "fixture-host",
			remote: "origin",
			ownedPaths: [
				{ path: "recovery.md", baselineHash: null, admittedNewFile: true },
			],
			unrelatedState: { statusHex: "", indexHex: "" },
			localMainHead: fixture.mainHead,
			remoteMainHead: fixture.mainHead,
			expectedLeaseGeneration: null,
			leaseGeneration: acquired.generation,
			leaseAcquiredAt: acquired.lease.acquiredAt,
			leaseDurationMs: acquired.lease.leaseDurationMs,
			commitId: candidate,
			expectedMainCommit: candidate,
			ledgerReleaseId: null,
			pushOutcome: "unknown",
			nextSafeAction: "run_doctor",
			diagnosticsReference: `receipt:receipt_${"3".repeat(32)}`,
		};
		await fixture.store.initialize(receipt);

		const result = await fixture.preparer.prepare();

		if (result.status !== "prepared") throw new Error(result.reason);
		expect(result.evidence.localMainHead).toBe(candidate);
		expect(result.evidence.remoteMainHead).toBe(fixture.mainHead);
		expect(result.evidence.ledgerGeneration).toBe(acquired.generation);
		const capability = new Uint8Array([7, 4]);
		const authority = createVaultGitActivationAuthority({
			store: fixture.store,
			clock: () => "2026-08-11T00:00:02.000Z",
			validateHumanCapability: async (presented) =>
				presented.length === capability.length &&
				presented.every((byte, index) => byte === capability[index]),
			revalidate: fixture.preparer.revalidate,
		});
		expect(
			await authority.admit({
				evidenceId: result.evidence.evidenceId,
				humanCapability: capability,
				note: "review preserved push-pending candidate",
			}),
		).toMatchObject({ status: "admitted" });
		expect(await authority.validate("continuation")).toMatchObject({
			status: "admitted",
		});
	});

	test("keeps an unbound local-ahead main outside activation preparation", async () => {
		const fixture = await preparationFixture({ seedLedger: false });
		await writeFile(join(fixture.repositoryPath, "unbound.md"), "local only\n");
		git(fixture.repositoryPath, ["add", "unbound.md"]);
		git(fixture.repositoryPath, [
			"-c", "user.name=Fixture",
			"-c", "user.email=fixture@example.invalid",
			"commit", "-m", "unbound local candidate",
		]);

		expect(await fixture.preparer.prepare()).toEqual({
			status: "refused",
			reason: "main_not_aligned",
			changedState: "none",
		});
	});

	test("live admission revalidation invalidates remote drift without canonical mutation", async () => {
		const fixture = await preparationFixture();
		const prepared = await fixture.preparer.prepare();
		if (prepared.status !== "prepared") throw new Error("expected prepared");
		const capability = new Uint8Array([4, 2]);
		const authority = createVaultGitActivationAuthority({
			store: fixture.store,
			clock: () => "2026-08-11T00:00:01.000Z",
			validateHumanCapability: async (candidate) =>
				candidate.length === capability.length &&
				candidate.every((byte, index) => byte === capability[index]),
			revalidate: fixture.preparer.revalidate,
		});
		expect(
			await authority.admit({
				evidenceId: prepared.evidence.evidenceId,
				humanCapability: capability,
				note: "fixture human review",
			}),
		).toMatchObject({ status: "admitted" });
		git(fixture.remotePath, [
			"update-ref",
			"refs/heads/main",
			fixture.ledgerGeneration,
		]);
		const before = await canonicalSnapshot(fixture.repositoryPath);

		expect(await authority.validate()).toEqual({
			status: "denied",
			reason: "binding_changed",
			binding: "remoteMainHead",
		});
		expect(await canonicalSnapshot(fixture.repositoryPath)).toEqual(before);
	});

	for (const scenario of [
		{
			name: "timeout",
			checker: () => checkerResult({ timedOut: true, exitCode: null }),
			reason: "preparation_timed_out",
		},
		{
			name: "crash",
			checker: () => checkerCrash(),
			reason: "preparation_interrupted",
		},
	] as const) {
		test(`${scenario.name} leaves every canonical surface byte-identical`, async () => {
			const fixture = await preparationFixture({
				createChecker: scenario.checker,
			});
			const before = await canonicalSnapshot(fixture.repositoryPath);

			const result = await fixture.preparer.prepare();

			expect(result).toEqual({
				status: "unknown",
				reason: scenario.reason,
				changedState: "none",
			});
			expect(await fixture.store.readPreparedEvidence()).toBeNull();
			expect(await canonicalSnapshot(fixture.repositoryPath)).toEqual(before);
		});
	}

	test("cancellation after isolated setup leaves every canonical surface byte-identical", async () => {
		let observations = 0;
		const fixture = await preparationFixture({
			cancelled() {
				observations += 1;
				return observations === 3;
			},
		});
		const before = await canonicalSnapshot(fixture.repositoryPath);

		const result = await fixture.preparer.prepare();

		expect(result).toEqual({
			status: "unknown",
			reason: "preparation_cancelled",
			changedState: "none",
		});
		expect(await fixture.store.readPreparedEvidence()).toBeNull();
		expect(await canonicalSnapshot(fixture.repositoryPath)).toEqual(before);
	});

	test("cancellation during cleanup refuses before evidence publication", async () => {
		let cancelled = false;
		const fixture = await preparationFixture({
			cancelled: () => cancelled,
			async removeWorkspace(workspace) {
				await rm(workspace, { recursive: true, force: true });
				cancelled = true;
			},
		});

		expect(await fixture.preparer.prepare()).toEqual({
			status: "unknown",
			reason: "preparation_cancelled",
			changedState: "none",
		});
		expect(await fixture.store.readPreparedEvidence()).toBeNull();
	});
});

function productionActivationEnvironment(input: {
	readonly repositoryPath: string;
	readonly stateRoot: string;
}): NodeJS.ProcessEnv {
	return {
		...Object.fromEntries(
			Object.entries(process.env).filter(
				([name]) => !name.startsWith("VAULT_GIT_"),
			),
		),
		VAULT_GIT_REPOSITORY_PATH: input.repositoryPath,
		VAULT_GIT_CHECK_REPOSITORY_PATH: input.repositoryPath,
		VAULT_GIT_STATE_ROOT: input.stateRoot,
		VAULT_GIT_ACTOR: "fixture-operator",
		VAULT_GIT_HOST: "fixture-host",
		VAULT_GIT_REMOTE: "origin",
	};
}

function configuredProductionActivationEnvironment(input: {
	readonly repositoryPath: string;
	readonly stateRoot: string;
	readonly privateKeyPath: string;
	readonly publicKeyPath: string;
	readonly knownHostsPath: string;
}): NodeJS.ProcessEnv {
	return {
		...productionActivationEnvironment(input),
		VAULT_GIT_GIT_BINARY_PATH: "/usr/bin/git",
		VAULT_GIT_SSH_BINARY_PATH: "/usr/bin/ssh",
		VAULT_GIT_SSH_IDENTITY_FILE_PATH: input.privateKeyPath,
		VAULT_GIT_SSH_PUBLIC_KEY_PATH: input.publicKeyPath,
		VAULT_GIT_SSH_KNOWN_HOSTS_PATH: input.knownHostsPath,
	};
}

async function preparationFixture(overrides: {
	readonly createChecker?: (repositoryPath: string) => VaultGitCheckerPort;
	readonly cancelled?: () => boolean;
	readonly clock?: () => string;
	readonly includeLockfile?: boolean;
	readonly admittedGitEnvironment?: Readonly<Record<string, string>>;
	readonly observeProcess?: (request: VaultGitProcessRequest) => void;
	readonly removeWorkspace?: (workspace: string) => Promise<void>;
	readonly seedLedger?: boolean;
} = {}): Promise<{
	readonly repositoryPath: string;
	readonly remotePath: string;
	readonly stateRoot: string;
	readonly publicKeyPath: string;
	readonly privateKeyPath: string;
	readonly knownHostsPath: string;
	readonly mainHead: string;
	readonly ledgerGeneration: string;
	readonly store: ReturnType<typeof createReceiptStore>;
	readonly preparer: ReturnType<typeof createVaultGitActivationPreparer>;
}> {
	const root = await tempDirectories.create("vault-git-activation-prepare-");
	const remotePath = join(root, "remote.git");
	const repositoryPath = join(root, "vault");
	const stateRoot = join(root, "state");
	const publicKeyPath = join(root, "writer.pub");
	const privateKeyPath = join(root, "writer");
	const knownHostsPath = join(root, "known_hosts");
	await mkdir(stateRoot);
	await writeFile(publicKeyPath, "ssh-ed25519 fixture-public-key\n");
	await writeFile(privateKeyPath, "fixture-private-key\n", { mode: 0o600 });
	await writeFile(knownHostsPath, "example.test ssh-ed25519 fixture-host-key\n", {
		mode: 0o600,
	});
	git(root, ["init", "--bare", remotePath]);
	git(root, ["clone", remotePath, repositoryPath]);
	git(repositoryPath, ["switch", "-c", "main"]);
	await mkdir(join(repositoryPath, "scripts"));
	await mkdir(join(repositoryPath, "schemas"));
	await writeFile(
		join(repositoryPath, "package.json"),
		JSON.stringify({
			name: "activation-fixture",
			private: true,
			scripts: { check: "bun run scripts/check.ts" },
		}),
	);
	const includeLockfile = overrides.includeLockfile !== false;
	if (includeLockfile) {
		await writeFile(
			join(repositoryPath, "bun.lock"),
			JSON.stringify({
				lockfileVersion: 1,
				configVersion: 1,
				workspaces: { "": { name: "activation-fixture" } },
			}),
		);
	}
	await writeFile(
		join(repositoryPath, "scripts", "check.ts"),
		'await Bun.write(".activation-checker-ran", "ran\\n");\nprocess.stdout.write(JSON.stringify({ schema_version: 1, findings: [] }) + "\\n");\n',
	);
	await writeFile(
		join(repositoryPath, "schemas", "frontmatter-contract.json"),
		'{"type":"object"}\n',
	);
	git(repositoryPath, [
		"add",
		"package.json",
		...(includeLockfile ? ["bun.lock"] : []),
		"scripts/check.ts",
		"schemas/frontmatter-contract.json",
	]);
	git(repositoryPath, [
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"-m",
		"fixture main",
	]);
	git(repositoryPath, ["push", "-u", "origin", "main"]);
	const mainHead = gitOutput(repositoryPath, ["rev-parse", "refs/heads/main"]);

	let ledgerGeneration = VAULT_GIT_ABSENT_LEDGER_GENERATION;
	if (overrides.seedLedger !== false) {
		git(repositoryPath, ["switch", "--orphan", "ledger-seed"]);
		git(repositoryPath, ["rm", "-rf", "--ignore-unmatch", "."]);
		await writeFile(
			join(repositoryPath, "ledger.json"),
			JSON.stringify({ schema_version: 1, operation: "release", lease: null }),
		);
		git(repositoryPath, ["add", "ledger.json"]);
		git(repositoryPath, [
			"-c", "user.name=Fixture",
			"-c", "user.email=fixture@example.invalid",
			"commit", "-m", "fixture ledger",
		]);
		ledgerGeneration = gitOutput(repositoryPath, ["rev-parse", "HEAD"]);
		git(repositoryPath, [
			"push", "origin", "HEAD:refs/heads/vault-system/transaction-ledger",
		]);
		git(repositoryPath, ["switch", "main"]);
		git(repositoryPath, ["branch", "-D", "ledger-seed"]);
	}

	const nodeProcessPort = createNodeProcessPort();
	const processPort = {
		run(request: VaultGitProcessRequest) {
			overrides.observeProcess?.(request);
			return nodeProcessPort.run(request);
		},
	};
	const repositoryIdentity = (
		await resolveVaultRepositoryIdentity({
			repositoryPath,
			process: processPort,
			timeoutMs: 5_000,
		})
	).identity;
	const store = createReceiptStore({ stateRoot, repositoryIdentity });
	const identityOptions = {
		repositoryPath,
		stateRoot,
		remoteName: "origin",
		hostId: "fixture-host",
		runtimeBinaryPath: process.execPath,
		runtimeVersion: Bun.version,
		executablePath: join(import.meta.dir, "../src/cli.ts"),
		executableSourcePaths: VAULT_GIT_PRODUCTION_EXECUTABLE_SOURCE_PATHS,
		gitBinaryPath: "/usr/bin/git",
		sshBinaryPath: "/usr/bin/ssh",
		sshIdentityPublicKeyPath: publicKeyPath,
		sshIdentityFilePath: privateKeyPath,
		sshKnownHostsPath: knownHostsPath,
		process: processPort,
		timeoutMs: 5_000,
	} as const;
	return {
		repositoryPath,
		remotePath,
		stateRoot,
		publicKeyPath,
		privateKeyPath,
		knownHostsPath,
		mainHead,
		ledgerGeneration,
		store,
		preparer: createVaultGitActivationPreparer({
			repositoryPath,
			privateStateRoot: stateRoot,
			remoteName: "origin",
			repositoryIdentity,
			jobGeneration: 1,
			process: processPort,
			admittedGitEnvironment: overrides.admittedGitEnvironment,
			store,
			resolveRepositoryIdentity: async () =>
				(
					await resolveVaultRepositoryIdentity({
						repositoryPath,
						process: processPort,
						timeoutMs: 5_000,
					})
				).identity,
			resolveActivationIdentities: () =>
				resolveVaultGitActivationIdentities(identityOptions),
			createChecker:
				overrides.createChecker ??
				((isolatedPath) => createVaultCheckerPort(isolatedPath, processPort)),
			clock: overrides.clock ?? (() => "2026-08-11T00:00:00.000Z"),
			cancelled: overrides.cancelled,
			removeWorkspace: overrides.removeWorkspace,
			timeouts: { localMs: 5_000, fetchMs: 5_000 },
		}),
	};
}

async function expectProductionContinuationParity(
	fixture: Awaited<ReturnType<typeof preparationFixture>>,
	nextAction: "begin_transaction" | "inspect_configured_vault" | "prepare_fresh" | "review_prepared",
): Promise<void> {
	const env = configuredProductionActivationEnvironment(fixture);
	for (const [index, args] of [
		["activation", "--json"],
		["status", "--json"],
		["doctor", "--json"],
	].entries()) {
		const result = await runCliProcess({
			label: `production ${nextAction} continuation ${args[0]}`,
			argv: [
				"bun",
				"run",
				join(import.meta.dir, "../src/cli.ts"),
				...args,
				"--run-id",
				`${nextAction}-continuation-${index}`,
			],
			cwd: fixture.repositoryPath,
			env,
			timeoutMs: 30_000,
		});
		const envelope = parseCliProcessJson<{
			readonly data: { readonly next_action: VaultGitNextAction };
			readonly continuation?: RuntimeContinuationGuidance;
			readonly runtime_actions?: readonly RuntimeActionGuidance[];
		}>(result);
		// The compatibility next-action id is stable across every surface.
		expect(envelope.data.next_action.id, args[0]).toBe(nextAction);
		const union = envelope.data.next_action;
		// The fail-closed union is REQUIRED (not merely permitted) for review_prepared
		// on the selector-less restriction surfaces (status, doctor): a restriction
		// cannot carry the evidence reference the review_prepared command handoff needs,
		// so the honest result must be a terminal none. Every other scenario/command —
		// and activation's review_prepared, which does carry the evidence — must be
		// runnable. This structure fails if a selector-less surface silently becomes
		// runnable, or a runnable surface silently fails closed.
		const failClosedRequired =
			nextAction === "review_prepared" &&
			(args[0] === "status" || args[0] === "doctor");
		if (failClosedRequired) {
			expect(union.kind, args[0]).toBe("none");
			expect(union.action_id, args[0]).toBe("none");
			expect(envelope.runtime_actions).toBeUndefined();
			expect(envelope.continuation).toEqual({
				requires_operator: true,
				constraints: [
					{
						id: "continuation_unavailable",
						summary:
							"No safe continuation is available; operator review is required.",
					},
				],
			});
		} else {
			// Runnable surface: exact kind is a real continuation (never none), the
			// facade continuation references the derived action, and a runtime action
			// is present.
			expect(union.kind, args[0]).not.toBe("none");
			expect(union.action_id, args[0]).toBe(nextAction);
			expect(envelope.continuation, args[0]).toEqual({
				next_action_id: nextAction,
			});
			expect(
				(envelope.runtime_actions ?? []).map((a) => a.id),
				args[0],
			).toContain(nextAction);
		}
	}
}

function checkerFailure(): VaultGitCheckerPort {
	return checkerResult({ exitCode: 1 });
}

function checkerResult(overrides: {
	readonly exitCode?: number | null;
	readonly timedOut?: boolean;
	readonly stdout?: string;
}): VaultGitCheckerPort {
	return {
		async fingerprint() {
			return {
				entrypointHash: "a".repeat(64),
				dependencyBundleHash: "b".repeat(64),
			};
		},
		async runCheck() {
			return {
				exitCode: overrides.exitCode ?? 1,
				stdout:
					overrides.stdout ??
					JSON.stringify({ schema_version: 1, findings: [{}] }),
				stderr: "",
				timedOut: overrides.timedOut ?? false,
			};
		},
		async readRepairRegistry() {
			throw new Error("not used");
		},
		async applyRepair() {
			throw new Error("not used");
		},
	};
}

function checkerCrash(): VaultGitCheckerPort {
	return {
		...checkerResult({ exitCode: 0 }),
		async runCheck() {
			throw new Error("fixture checker crash");
		},
	};
}

async function canonicalSnapshot(repositoryPath: string): Promise<{
	readonly worktree: string;
	readonly index: string;
	readonly refs: string;
	readonly objects: string;
}> {
	const gitDirectory = join(repositoryPath, ".git");
	return {
		worktree: await treeHash(repositoryPath, new Set([".git"])),
		index: await fileHash(join(gitDirectory, "index")),
		refs: createHash("sha256")
			.update(await treeHash(join(gitDirectory, "refs")))
			.update(await optionalFileHash(join(gitDirectory, "packed-refs")))
			.digest("hex"),
		objects: await treeHash(join(gitDirectory, "objects")),
	};
}

async function treeHash(
	root: string,
	excluded: ReadonlySet<string> = new Set(),
): Promise<string> {
	const hash = createHash("sha256");
	const entries = (await readdir(root, { withFileTypes: true }))
		.filter((entry) => !excluded.has(entry.name))
		.sort((left, right) => left.name.localeCompare(right.name));
	const contents = await Promise.all(
		entries.map(async (entry) => ({
			name: entry.name,
			bytes: await treeEntryBytes(root, entry),
		})),
	);
	for (const entry of contents) {
		hash.update(entry.name).update("\0").update(entry.bytes).update("\0");
	}
	return hash.digest("hex");
}

async function treeEntryBytes(
	root: string,
	entry: Dirent,
): Promise<string | Buffer> {
	const path = join(root, entry.name);
	if (entry.isDirectory()) return treeHash(path);
	if (entry.isSymbolicLink()) return readlink(path);
	return readFile(path);
}

async function fileHash(path: string): Promise<string> {
	return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function optionalFileHash(path: string): Promise<string> {
	return (await stat(path).catch(() => null)) === null ? "absent" : fileHash(path);
}

function git(cwd: string, args: readonly string[]): void {
	gitOutput(cwd, args);
}

function gitOutput(cwd: string, args: readonly string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr);
	return result.stdout.trim();
}
