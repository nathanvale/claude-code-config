import { mkdir, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, test } from "bun:test";

import {
	createVaultGitActivationAuthority,
	inspectVaultGitActivationState,
	type VaultGitLiveActivationBindings,
} from "../src/index.ts";
import type { VaultGitReceipt } from "../src/model.ts";
import {
	createReceiptStore,
	type VaultGitReceiptStore,
} from "../src/store.ts";
import {
	preparedEvidenceForTest,
	preparedEvidenceInputForTest,
} from "./activation-fixture.ts";
import { createTempDirectoryFixture } from "./temp-directory-fixture.ts";

const humanCapability = new Uint8Array([7, 4, 1]);
const tempDirectories = createTempDirectoryFixture();
afterEach(tempDirectories.cleanup);

describe("activation authority", () => {
	test("prepared evidence alone never grants write authority", async () => {
		const fixture = await authorityFixture({
			clock: "2026-08-09T00:00:01.000Z",
		});
		await fixture.store.publishPreparedEvidence(fixture.evidence);

		expect(await fixture.authority.validate()).toEqual({
			status: "denied",
			reason: "admission_missing",
		});
		expect(await fixture.store.readActivation()).toBeNull();
	});

	test("legacy V1 admission requires fresh V2 preparation", async () => {
		const fixture = await authorityFixture();
		await mkdir(fixture.store.paths.repositoryRoot, {
			recursive: true,
			mode: 0o700,
		});
		await writeFile(
			fixture.store.paths.activation,
			JSON.stringify({
				schemaVersion: 1,
				admittedAt: "2026-08-09T00:00:00.000Z",
				note: "legacy admission",
			}),
			{ mode: 0o600 },
		);

		expect(await fixture.authority.validate()).toEqual({
			status: "denied",
			reason: "evidence_changed",
		});
	});

	test("fresh V2 evidence supersedes a legacy V1 admission", async () => {
		const fixture = await authorityFixture({
			clock: "2026-08-09T00:00:01.000Z",
		});
		await fixture.store.publishPreparedEvidence(fixture.evidence);
		await writeFile(
			fixture.store.paths.activation,
			JSON.stringify({
				schemaVersion: 1,
				admittedAt: "2026-08-09T00:00:00.000Z",
				note: "legacy admission",
			}),
			{ mode: 0o600 },
		);

		expect(
			await inspectVaultGitActivationState(
				fixture.store,
				"2026-08-09T00:00:01.000Z",
			),
		).toMatchObject({ status: "prepared" });
		expect(await fixture.authority.validate()).toEqual({
			status: "denied",
			reason: "admission_missing",
		});
	});

	test("admits only a matching human capability after live revalidation", async () => {
		const fixture = await authorityFixture();
		await fixture.store.publishPreparedEvidence(fixture.evidence);

		expect(
			await fixture.authority.admit({
				evidenceId: fixture.evidence.evidenceId,
				humanCapability: new Uint8Array([0]),
				note: "human review",
			}),
		).toEqual({ status: "denied", reason: "human_capability_required" });
		expect(await fixture.store.readActivation()).toBeNull();

		expect(
			await fixture.authority.admit({
				evidenceId: fixture.evidence.evidenceId,
				humanCapability,
				note: "human review",
			}),
		).toEqual({
			status: "admitted",
			evidenceId: fixture.evidence.evidenceId,
		});
		expect(await fixture.authority.validate()).toEqual({
			status: "admitted",
			evidenceId: fixture.evidence.evidenceId,
		});
	});

	test("revalidates every binding regardless of prepared-evidence age", async () => {
		const baseline = preparedEvidenceInputForTest();
		for (const [field, changed] of [
			["repositoryIdentity", identity("vault-git", "d")],
			["remoteIdentity", identity("remote", "d")],
			["hostIdentity", identity("host", "d")],
			["runtimeIdentity", identity("runtime", "d")],
			["executableIdentity", identity("executable", "d")],
			["privateStateIdentity", identity("private-state", "d")],
			["localMainHead", "d".repeat(40)],
			["remoteMainHead", "d".repeat(40)],
			["ledgerGeneration", "d".repeat(40)],
			["gitIdentity", identity("git", "d")],
			["sshIdentity", identity("ssh", "d")],
		] as const) {
			const fixture = await authorityFixture({
				liveBindings: { ...liveBindings(baseline), [field]: changed },
				clock: "2026-08-20T00:00:00.000Z",
			});
			await fixture.store.publishPreparedEvidence(fixture.evidence);

			const result = await fixture.authority.admit({
				evidenceId: fixture.evidence.evidenceId,
				humanCapability,
				note: "stale display still revalidates",
			});

			expect(result, field).toEqual({
				status: "denied",
				reason: "binding_changed",
				binding: field,
			});
			expect(await fixture.store.readActivation()).toBeNull();
			expect(await fixture.store.readActivationInvalidation()).toMatchObject({
				evidenceId: fixture.evidence.evidenceId,
				binding: field,
			});
		}
	});

	test("checker-closure drift invalidates admission", async () => {
		const baseline = preparedEvidenceInputForTest();
		const fixture = await authorityFixture({
			liveBindings: {
				...liveBindings(baseline),
				checkerClosure: {
					...baseline.checkerClosure,
					dependencyBundleHash: "d".repeat(64),
				},
			},
		});
		await fixture.store.publishPreparedEvidence(fixture.evidence);

		expect(
			await fixture.authority.admit({
				evidenceId: fixture.evidence.evidenceId,
				humanCapability,
				note: "drift",
			}),
		).toEqual({
			status: "denied",
			reason: "binding_changed",
			binding: "checkerClosure",
		});
	});

	test("cross-host evidence cannot admit on another host", async () => {
		const baseline = preparedEvidenceInputForTest();
		const fixture = await authorityFixture({
			liveBindings: {
				...liveBindings(baseline),
				hostIdentity: identity("host", "e"),
			},
		});
		await fixture.store.publishPreparedEvidence(fixture.evidence);

		expect(
			await fixture.authority.admit({
				evidenceId: fixture.evidence.evidenceId,
				humanCapability,
				note: "cross-host attempt",
			}),
		).toEqual({
			status: "denied",
			reason: "binding_changed",
			binding: "hostIdentity",
		});
		expect(await fixture.store.readActivation()).toBeNull();
	});

	test("revalidation outages fail closed for admission and continuation", async () => {
		let unavailable = true;
		const fixture = await authorityFixture({
			async revalidate(bindings) {
				if (unavailable) throw new Error("fixture outage");
				return bindings;
			},
		});
		await fixture.store.publishPreparedEvidence(fixture.evidence);

		expect(
			await fixture.authority.admit({
				evidenceId: fixture.evidence.evidenceId,
				humanCapability,
				note: "outage",
			}),
		).toEqual({ status: "denied", reason: "revalidation_unavailable" });
		unavailable = false;
		await fixture.authority.admit({
			evidenceId: fixture.evidence.evidenceId,
			humanCapability,
			note: "admit after recovery",
		});
		unavailable = true;

		expect(await fixture.authority.validate("continuation")).toEqual({
			status: "denied",
			reason: "revalidation_unavailable",
		});
	});

	for (const read of ["activation", "prepared evidence"] as const) {
		test(`${read} read failures remain revalidation_unavailable`, async () => {
			let failRead = false;
			const fixture = await authorityFixture({
				wrapStore(store) {
					return {
						...store,
						...(read === "activation"
							? {
									async readActivation() {
										if (failRead) throw new Error("fixture private-state failure");
										return store.readActivation();
									},
								}
							: {
									async readPreparedEvidence() {
										if (failRead) throw new Error("fixture private-state failure");
										return store.readPreparedEvidence();
									},
								}),
					};
				},
			});
			await fixture.store.publishPreparedEvidence(fixture.evidence);
			await fixture.authority.admit({
				evidenceId: fixture.evidence.evidenceId,
				humanCapability,
				note: "admit before read failure",
			});
			failRead = true;

			expect(await fixture.authority.validate()).toEqual({
				status: "denied",
				reason: "revalidation_unavailable",
			});
		});
	}

	for (const marker of ["invalidation", "revocation"] as const) {
		for (const operation of ["admission", "continuation"] as const) {
			test(`${marker} marker read failures deny ${operation}`, async () => {
				let failRead = false;
				const fixture = await authorityFixture({
					wrapStore(store) {
						return {
							...store,
							...(marker === "invalidation"
								? {
										async readActivationInvalidation(evidenceId?: string) {
											if (failRead) throw new Error("fixture marker failure");
											return store.readActivationInvalidation(evidenceId);
										},
									}
								: {
										async readActivationRevocation(evidenceId?: string) {
											if (failRead) throw new Error("fixture marker failure");
											return store.readActivationRevocation(evidenceId);
										},
									}),
						};
					},
				});
				await fixture.store.publishPreparedEvidence(fixture.evidence);
				if (operation === "continuation") {
					await fixture.authority.admit({
						evidenceId: fixture.evidence.evidenceId,
						humanCapability,
						note: "admit before marker failure",
					});
				}
				failRead = true;

				const result =
					operation === "admission"
						? await fixture.authority.admit({
								evidenceId: fixture.evidence.evidenceId,
								humanCapability,
								note: "marker failure",
							})
						: await fixture.authority.validate("continuation");
				expect(result).toEqual({
					status: "denied",
					reason: "revalidation_unavailable",
				});
				if (operation === "admission") {
					expect(await fixture.store.readActivation()).toBeNull();
				}
			});
		}
	}

	test("continuation rejects unreceipted head and ledger movement", async () => {
		let continued = false;
		const fixture = await authorityFixture({
			async revalidate(bindings) {
				return continued
					? {
							...bindings,
							localMainHead: "d".repeat(40),
							remoteMainHead: "e".repeat(40),
							ledgerGeneration: "f".repeat(40),
						}
					: bindings;
			},
		});
		await fixture.store.publishPreparedEvidence(fixture.evidence);
		await fixture.authority.admit({
			evidenceId: fixture.evidence.evidenceId,
			humanCapability,
			note: "admit",
		});
		continued = true;

		expect(await fixture.authority.validate("continuation")).toEqual({
			status: "denied",
			reason: "binding_changed",
			binding: "localMainHead",
		});
	});

	for (const scenario of [
		{
			phase: "closed",
			overrides: {
				recordedAt: "2026-08-08T00:00:00.000Z",
				expectedMainCommit: "d".repeat(40),
				ledgerReleaseId: "e".repeat(40),
			},
		},
		{
			phase: "repairable",
			overrides: {
				phase: "repairable",
				transition: "deterministic_repair_available",
				recordedAt: "2026-08-08T00:00:00.000Z",
				commitId: undefined,
				expectedMainCommit: undefined,
				ledgerReleaseId: undefined,
				pushOutcome: undefined,
				nextSafeAction: "run_doctor",
			},
		},
	] satisfies ReadonlyArray<{
		readonly phase: string;
		readonly overrides: Partial<VaultGitReceipt>;
	}>) {
		test(`fresh human activation supersedes an older ${scenario.phase} receipt baseline`, async () => {
			const fixture = await authorityFixture({
				wrapStore(store) {
					const receipt = closedReceipt(scenario.overrides);
					return {
						...store,
						async load() {
							return {
								status: "loaded" as const,
								receipt,
								history: [receipt],
								historyPaths: ["fixture-receipt.json"],
							};
						},
					};
				},
			});
			await fixture.store.publishPreparedEvidence(fixture.evidence);
			await fixture.authority.admit({
				evidenceId: fixture.evidence.evidenceId,
				humanCapability,
				note: `approve fresh baseline after ${scenario.phase}`,
			});

			expect(await fixture.authority.validate("continuation")).toEqual({
				status: "admitted",
				evidenceId: fixture.evidence.evidenceId,
			});
		});
	}

	for (const invalidField of ["recordedAt", "capturedAt"] as const) {
		test(`continuation fails closed for invalid ${invalidField}`, async () => {
			const fixture = await authorityFixture({
				wrapStore(store) {
					const receipt = closedReceipt({
						recordedAt: invalidField === "recordedAt"
							? "not-a-timestamp"
							: "2026-08-08T00:00:00.000Z",
					});
					return {
						...store,
						async load() {
							return {
								status: "loaded" as const,
								receipt,
								history: [receipt],
								historyPaths: ["fixture-receipt.json"],
							};
						},
						async readPreparedEvidence() {
							const evidence = await store.readPreparedEvidence();
							return invalidField === "capturedAt" && evidence
								? { ...evidence, capturedAt: "not-a-timestamp" }
								: evidence;
						},
					};
				},
			});
			await fixture.store.publishPreparedEvidence(fixture.evidence);
			await fixture.store.admitActivation({
				schemaVersion: 2,
				evidenceId: fixture.evidence.evidenceId,
				admittedAt: "2026-08-11T00:00:00.000Z",
				note: "fixture admission",
			});

			expect(await fixture.authority.validate("continuation")).toEqual({
				status: "denied",
				reason: "revalidation_unavailable",
			});
		});
	}

	test("continuation fails closed when current receipt state conflicts", async () => {
		let conflict = false;
		const fixture = await authorityFixture({
			wrapStore(store) {
				return {
					...store,
					async load() {
						return conflict
							? {
									status: "conflict" as const,
									reason: "fixture receipt conflict",
								}
							: store.load();
					},
				};
			},
		});
		await fixture.store.publishPreparedEvidence(fixture.evidence);
		await fixture.authority.admit({
			evidenceId: fixture.evidence.evidenceId,
			humanCapability,
			note: "admit",
		});
		conflict = true;

		expect(await fixture.authority.validate("continuation")).toEqual({
			status: "denied",
			reason: "revalidation_unavailable",
		});
	});

	test("continuation still invalidates stable identity drift", async () => {
		let continued = false;
		const fixture = await authorityFixture({
			async revalidate(bindings) {
				return continued
					? { ...bindings, hostIdentity: identity("host", "d") }
					: bindings;
			},
		});
		await fixture.store.publishPreparedEvidence(fixture.evidence);
		await fixture.authority.admit({
			evidenceId: fixture.evidence.evidenceId,
			humanCapability,
			note: "admit",
		});
		continued = true;

		expect(await fixture.authority.validate("continuation")).toEqual({
			status: "denied",
			reason: "binding_changed",
			binding: "hostIdentity",
		});
	});

	test("stale revocation requests cannot poison current evidence", async () => {
		const fixture = await authorityFixture();
		const stale = preparedEvidenceForTest({
			hostIdentity: identity("host", "e"),
		});
		await fixture.store.publishPreparedEvidence(fixture.evidence);
		await fixture.authority.admit({
			evidenceId: fixture.evidence.evidenceId,
			humanCapability,
			note: "admit current",
		});

		expect(
			await fixture.authority.revoke({
				evidenceId: stale.evidenceId,
				humanCapability,
				note: "stale request",
			}),
		).toEqual({ status: "denied", reason: "evidence_changed" });
		expect(await fixture.store.readActivationRevocation(stale.evidenceId)).toBeNull();
		expect(await fixture.authority.validate()).toEqual({
			status: "admitted",
			evidenceId: fixture.evidence.evidenceId,
		});
	});

	test("revocation markers remain independent per evidence", async () => {
		const fixture = await authorityFixture();
		const other = preparedEvidenceForTest({
			hostIdentity: identity("host", "e"),
		});
		await fixture.store.recordActivationRevocation({
			schemaVersion: 1,
			evidenceId: fixture.evidence.evidenceId,
			revokedAt: "2026-08-11T00:00:01.000Z",
			note: "first",
		});
		await fixture.store.recordActivationRevocation({
			schemaVersion: 1,
			evidenceId: other.evidenceId,
			revokedAt: "2026-08-11T00:00:02.000Z",
			note: "second",
		});

		expect(
			await fixture.store.readActivationRevocation(fixture.evidence.evidenceId),
		).toMatchObject({ note: "first" });
		expect(
			await fixture.store.readActivationRevocation(other.evidenceId),
		).toMatchObject({ note: "second" });
	});

	test("fresh evidence remains independent from a prior evidence revocation", async () => {
		const fixture = await authorityFixture({
			clock: "2026-08-09T00:00:01.000Z",
		});
		const next = preparedEvidenceForTest({
			hostIdentity: identity("host", "e"),
		});
		await fixture.store.publishPreparedEvidence(fixture.evidence);
		await fixture.authority.admit({
			evidenceId: fixture.evidence.evidenceId,
			humanCapability,
			note: "admit first evidence",
		});
		await fixture.authority.revoke({
			evidenceId: fixture.evidence.evidenceId,
			humanCapability,
			note: "revoke first evidence",
		});
		await fixture.store.publishPreparedEvidence(next);

		expect(await fixture.authority.validate()).toEqual({
			status: "denied",
			reason: "admission_missing",
		});
		expect(
			await fixture.store.readActivationRevocation(next.evidenceId),
		).toBeNull();
	});

	test("human-only revocation immediately denies an in-flight validation", async () => {
		let revalidationCalls = 0;
		let releaseRevalidation: (() => void) | undefined;
		let startedRevalidation: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			startedRevalidation = resolve;
		});
		const release = new Promise<void>((resolve) => {
			releaseRevalidation = resolve;
		});
		const fixture = await authorityFixture({
			async revalidate(bindings) {
				revalidationCalls += 1;
				if (revalidationCalls === 1) return bindings;
				startedRevalidation?.();
				await release;
				return bindings;
			},
		});
		await fixture.store.publishPreparedEvidence(fixture.evidence);
		await fixture.authority.admit({
			evidenceId: fixture.evidence.evidenceId,
			humanCapability,
			note: "admit",
		});

		const validation = fixture.authority.validate();
		await started;
		expect(
			await fixture.authority.revoke({
				evidenceId: fixture.evidence.evidenceId,
				humanCapability: new Uint8Array([0]),
				note: "wrong capability",
			}),
		).toEqual({ status: "denied", reason: "human_capability_required" });
		expect(
			await fixture.authority.revoke({
				evidenceId: fixture.evidence.evidenceId,
				humanCapability,
				note: "operator revoked",
			}),
		).toEqual({
			status: "revoked",
			evidenceId: fixture.evidence.evidenceId,
		});
		releaseRevalidation?.();

		expect(await validation).toEqual({ status: "denied", reason: "revoked" });
		expect(await fixture.authority.validate()).toEqual({
			status: "denied",
			reason: "revoked",
		});
	});

	test("superseding admission denies an in-flight validation of older evidence", async () => {
		let revalidationCalls = 0;
		let releaseOlder: (() => void) | undefined;
		let olderStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			olderStarted = resolve;
		});
		const release = new Promise<void>((resolve) => {
			releaseOlder = resolve;
		});
		const fixture = await authorityFixture({
			async revalidate(bindings) {
				revalidationCalls += 1;
				if (revalidationCalls === 2) {
					olderStarted?.();
					await release;
				}
				return bindings;
			},
		});
		await fixture.store.publishPreparedEvidence(fixture.evidence);
		await fixture.authority.admit({
			evidenceId: fixture.evidence.evidenceId,
			humanCapability,
			note: "admit older evidence",
		});

		const olderValidation = fixture.authority.validate("continuation");
		await started;
		const newer = preparedEvidenceForTest({ jobGeneration: 2 });
		await fixture.store.publishPreparedEvidence(newer);
		expect(
			await fixture.authority.admit({
				evidenceId: newer.evidenceId,
				humanCapability,
				note: "admit newer evidence",
			}),
		).toEqual({ status: "admitted", evidenceId: newer.evidenceId });
		releaseOlder?.();

		expect(await olderValidation).toEqual({
			status: "denied",
			reason: "evidence_changed",
		});
	});
});

async function authorityFixture(overrides: {
	readonly liveBindings?: VaultGitLiveActivationBindings;
	readonly clock?: string;
	readonly revalidate?: (
		bindings: VaultGitLiveActivationBindings,
	) => Promise<VaultGitLiveActivationBindings>;
	readonly wrapStore?: (store: VaultGitReceiptStore) => VaultGitReceiptStore;
} = {}) {
	const root = await tempDirectories.create("vault-git-activation-authority-");
	const evidence = preparedEvidenceForTest();
	const store = createReceiptStore({
		stateRoot: root,
		repositoryIdentity: evidence.repositoryIdentity,
	});
	const current = overrides.liveBindings ?? liveBindings(evidence);
	const authorityStore = overrides.wrapStore?.(store) ?? store;
	return {
		evidence,
		store,
		authority: createVaultGitActivationAuthority({
			store: authorityStore,
			clock: () => overrides.clock ?? "2026-08-11T00:00:01.000Z",
			validateHumanCapability: async (candidate) =>
				candidate.length === humanCapability.length &&
				candidate.every((byte, index) => byte === humanCapability[index]),
			revalidate: () =>
				overrides.revalidate?.(current) ?? Promise.resolve(current),
		}),
	};
}

function liveBindings(
	input: ReturnType<typeof preparedEvidenceInputForTest>,
): VaultGitLiveActivationBindings {
	return {
		repositoryIdentity: input.repositoryIdentity,
		remoteIdentity: input.remoteIdentity,
		hostIdentity: input.hostIdentity,
		runtimeIdentity: input.runtimeIdentity,
		executableIdentity: input.executableIdentity,
		privateStateIdentity: input.privateStateIdentity,
		localMainHead: input.localMainHead,
		remoteMainHead: input.remoteMainHead,
		ledgerGeneration: input.ledgerGeneration,
		gitIdentity: input.gitIdentity,
		sshIdentity: input.sshIdentity,
		checkerClosure: input.checkerClosure,
	};
}

function identity(owner: string, byte: string): string {
	return `${owner}:v1:${byte.repeat(64)}`;
}

function closedReceipt(overrides: Partial<VaultGitReceipt> = {}): VaultGitReceipt {
	return {
		schemaVersion: 2,
		receiptId: "receipt_11111111111111111111111111111111",
		transactionId: "txn_22222222222222222222222222222222",
		revision: 2,
		phase: "closed",
		transition: "closed",
		recordedAt: "2026-08-10T00:00:00.000Z",
		event: "note_created",
		actor: "agent-a",
		host: "laptop",
		remote: "origin",
		ownedPaths: [],
		unrelatedState: { statusHex: "", indexHex: "" },
		localMainHead: "c".repeat(40),
		remoteMainHead: "c".repeat(40),
		expectedLeaseGeneration: "a".repeat(40),
		leaseGeneration: "b".repeat(40),
		leaseAcquiredAt: "2026-08-10T00:00:00.000Z",
		leaseDurationMs: 60_000,
		commitId: "d".repeat(40),
		expectedMainCommit: "d".repeat(40),
		ledgerReleaseId: "e".repeat(40),
		pushOutcome: "closed",
		nextSafeAction: "none",
		diagnosticsReference: "receipt:receipt_11111111111111111111111111111111",
		...overrides,
	};
}
