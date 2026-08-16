import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createVaultGitDoctor } from "../src/doctor.ts";
import {
	createGitAdapter,
	createGitRepositoryAdapter,
	createNodeProcessPort,
} from "../src/git-adapter.ts";
import { VAULT_GIT_LEDGER_REF, type VaultGitReceipt } from "../src/model.ts";
import type { VaultGitRuntimePort } from "../src/ports.ts";
import { createVaultGitRepair } from "../src/repair.ts";
import { createReceiptStore } from "../src/store.ts";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("deterministic push_pending repair", () => {
	test("retries the prepared atomic close through its sole adapter and closes idempotently", async () => {
		const fixture = await repairFixture();
		const diagnosis = await fixture.doctor.diagnose({
			transactionId: fixture.transactionId,
		});
		expect(diagnosis).toMatchObject({
			finding: "publication_pending",
			repairAction: "retry-push",
			retrySafety: "same_input_safe",
			nextAction: { id: "run_repair" },
		});

		const first = await fixture.repair.run({
			action: "retry-push",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(first).toMatchObject({
			status: "repaired",
			state: "closed",
			changedState: "remote",
		});
		expect(git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(
			fixture.candidate,
		);
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			fixture.releaseCommit,
		);

		const tipBefore = git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF);
		const second = await fixture.repair.run({
			action: "retry-push",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(second).toMatchObject({
			status: "repaired",
			state: "closed",
			changedState: "none",
		});
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			tipBefore,
		);
	});

	test("classifies a one-ref-only remote result as a contract breach without retry", async () => {
		const fixture = await repairFixture();
		git(fixture.bare, "fetch", fixture.clone, fixture.candidate);
		git(fixture.bare, "update-ref", "refs/heads/main", fixture.candidate);
		const diagnosis = await fixture.doctor.diagnose({
			transactionId: fixture.transactionId,
		});
		expect(diagnosis).toMatchObject({
			finding: "remote_contract_breach",
			blocker: "host_contract_breach",
			retrySafety: "operator_required",
			nextAction: { id: "request_operator_review" },
		});
		expect(diagnosis.repairAction).toBeUndefined();
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			fixture.ledgerHead,
		);

		// A partial-ref breach also blocks the retry-push executor itself: the
		// fresh internal doctor pass refuses before any remote mutation.
		const retried = await fixture.repair.run({
			action: "retry-push",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(retried).toMatchObject({
			status: "refused",
			blocker: "deterministic_repair_mismatch",
			changedState: "none",
		});
		expect(git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(
			fixture.candidate,
		);
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			fixture.ledgerHead,
		);
	});

	test("a server-rejected atomic close leaves both remote refs and the local commit unchanged", async () => {
		const fixture = await repairFixture();
		const mainBefore = git(fixture.bare, "rev-parse", "refs/heads/main");
		writeFileSync(
			join(fixture.bare, "hooks", "pre-receive"),
			"#!/bin/sh\nexit 1\n",
			{ mode: 0o755 },
		);
		const result = await fixture.repair.run({
			action: "retry-push",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(result).toMatchObject({
			status: "refused",
			state: "push_pending",
			phase: "push_pending",
			blocker: "push_pending",
			changedState: "partial",
			retrySafety: "same_input_unsafe",
			nextAction: { id: "request_operator_review" },
		});
		expect(git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(mainBefore);
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			fixture.ledgerHead,
		);
		expect(git(fixture.clone, "rev-parse", "refs/heads/main")).toBe(
			fixture.candidate,
		);
		expect(await fixture.store.load()).toMatchObject({
			status: "loaded",
			receipt: { phase: "push_pending" },
		});
	});

	test("a concurrently advanced remote main blocks retry-push without moving any ref", async () => {
		const fixture = await repairFixture();
		const baseline = git(fixture.clone, "rev-parse", `${fixture.candidate}^`);
		const baselineTree = git(fixture.clone, "rev-parse", `${baseline}^{tree}`);
		const concurrent = git(
			fixture.clone,
			"commit-tree",
			baselineTree,
			"-p",
			baseline,
			"-m",
			"concurrent writer",
		);
		git(fixture.bare, "fetch", fixture.clone, concurrent);
		git(fixture.bare, "update-ref", "refs/heads/main", concurrent);
		const result = await fixture.repair.run({
			action: "retry-push",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(result).toMatchObject({
			status: "refused",
			state: "human_required",
			phase: "push_pending",
			blocker: "deterministic_repair_mismatch",
			changedState: "none",
		});
		expect(git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(concurrent);
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			fixture.ledgerHead,
		);
		expect(git(fixture.clone, "rev-parse", "refs/heads/main")).toBe(
			fixture.candidate,
		);
	});

	test("recognizes a lost acknowledgement after later main and ledger descendants land", async () => {
		const fixture = await repairFixture();
		const candidateTree = git(
			fixture.clone,
			"rev-parse",
			`${fixture.candidate}^{tree}`,
		);
		const laterMain = git(
			fixture.clone,
			"commit-tree",
			candidateTree,
			"-p",
			fixture.candidate,
			"-m",
			"later main",
		);
		const laterTransactionId = `txn_${"4".repeat(32)}`;
		const laterLedger = commitLedger(
			fixture.clone,
			ledgerContent({
				operation: "acquire",
				previousGeneration: fixture.releaseCommit,
				transactionId: laterTransactionId,
				baseline: fixture.candidate,
				acquiredAt: "2026-08-09T00:00:03.000Z",
				transitionedAt: "2026-08-09T00:00:03.000Z",
				state: "held",
				leaseDurationMs: 60_000,
			}),
			[fixture.releaseCommit],
			`vault-ledger: acquire ${laterTransactionId}`,
			"2026-08-09T00:00:03.000Z",
		);
		git(fixture.bare, "fetch", fixture.clone, laterMain, laterLedger);
		git(fixture.bare, "update-ref", "refs/heads/main", laterMain);
		git(fixture.bare, "update-ref", VAULT_GIT_LEDGER_REF, laterLedger);

		expect(
			await fixture.doctor.diagnose({
				transactionId: fixture.transactionId,
			}),
		).toMatchObject({
			finding: "publication_already_closed",
			repairAction: "close-verified",
			retrySafety: "same_input_safe",
		});

		const first = await fixture.repair.run({
			action: "close-verified",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(first).toMatchObject({
			status: "repaired",
			state: "closed",
			phase: "closed",
			changedState: "local",
			nextAction: { id: "none" },
		});
		expect(git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(laterMain);
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			laterLedger,
		);

		const second = await fixture.repair.run({
			action: "close-verified",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(second).toMatchObject({
			status: "repaired",
			state: "closed",
			phase: "closed",
			changedState: "none",
		});
		expect(git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(laterMain);
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			laterLedger,
		);
	});

	test("prevents a non-originating host from retrying an unpublished local commit", async () => {
		const fixture = await repairFixture("host-b");
		const diagnosis = await fixture.doctor.diagnose({
			transactionId: fixture.transactionId,
		});
		expect(diagnosis).toMatchObject({
			finding: "publication_pending",
			retrySafety: "operator_required",
			nextAction: { id: "request_operator_review" },
		});
		expect(diagnosis.repairAction).toBeUndefined();
	});

	test("uses one fresh single-use proof for an audited stale-lease abandonment", async () => {
		const fixture = await repairFixture("host-a", "stale");
		const diagnosis = await fixture.doctor.diagnose({
			transactionId: fixture.transactionId,
		});
		expect(diagnosis).toMatchObject({
			finding: "lease_expired",
			repairAction: "stale-lease-takeover",
			takeoverTokenIssued: true,
			changedState: "local",
		});
		const token = await fixture.store.readDoctorToken(
			fixture.transactionId,
			fixture.ledgerHead,
		);
		const first = await fixture.repair.run({
			action: "stale-lease-takeover",
			transactionId: fixture.transactionId,
			remote: "origin",
			expectedLedgerGeneration: fixture.ledgerHead,
			doctorToken: token,
			priorWriterStopped: true,
		});
		expect(first).toMatchObject({
			status: "repaired",
			state: "superseded",
			changedState: "remote",
			nextAction: { id: "reconcile_quarantine" },
		});
		const ledger = JSON.parse(
			git(fixture.bare, "show", `${VAULT_GIT_LEDGER_REF}:ledger.json`),
		);
		expect(ledger).toMatchObject({
			operation: "superseding_abandon",
			previous_generation: fixture.ledgerHead,
			lease: {
				transaction_id: fixture.transactionId,
				state: "released",
			},
		});
		expect(await fixture.store.readQuarantine()).toMatchObject({
			status: "quarantined",
			transactionId: fixture.transactionId,
		});

		const second = await fixture.repair.run({
			action: "stale-lease-takeover",
			transactionId: fixture.transactionId,
			remote: "origin",
			expectedLedgerGeneration: fixture.ledgerHead,
			doctorToken: token,
			priorWriterStopped: true,
		});
		expect(second).toMatchObject({
			status: "refused",
			blocker: "doctor_token_invalid",
		});
		expect(await fixture.doctor.diagnose()).toMatchObject({
			finding: "host_quarantined",
			repairAction: "reconcile-quarantine",
		});
	});

	test("refuses a takeover when the prior writer is not stopped", async () => {
		const fixture = await repairFixture("host-a", "stale");
		await fixture.doctor.diagnose({ transactionId: fixture.transactionId });
		const token = await fixture.store.readDoctorToken(
			fixture.transactionId,
			fixture.ledgerHead,
		);
		// A present token plus the matching generation pins the other guard
		// clauses satisfied, so priorWriterStopped is the sole flipped variable.
		expect(token.byteLength).toBeGreaterThan(0);
		const result = await fixture.repair.run({
			action: "stale-lease-takeover",
			transactionId: fixture.transactionId,
			remote: "origin",
			expectedLedgerGeneration: fixture.ledgerHead,
			doctorToken: token,
			priorWriterStopped: false,
		});
		expect(result).toMatchObject({
			status: "refused",
			blocker: "doctor_token_invalid",
			changedState: "none",
		});
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			fixture.ledgerHead,
		);
		expect(await fixture.store.readQuarantine()).toBeNull();
	});

	test("refuses a takeover when priorWriterStopped is omitted", async () => {
		const fixture = await repairFixture("host-a", "stale");
		await fixture.doctor.diagnose({ transactionId: fixture.transactionId });
		const token = await fixture.store.readDoctorToken(
			fixture.transactionId,
			fixture.ledgerHead,
		);
		expect(token.byteLength).toBeGreaterThan(0);
		const result = await fixture.repair.run({
			action: "stale-lease-takeover",
			transactionId: fixture.transactionId,
			remote: "origin",
			expectedLedgerGeneration: fixture.ledgerHead,
			doctorToken: token,
		});
		expect(result).toMatchObject({
			status: "refused",
			blocker: "doctor_token_invalid",
			changedState: "none",
		});
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			fixture.ledgerHead,
		);
		expect(await fixture.store.readQuarantine()).toBeNull();
	});

	test("reconcile-quarantine refuses a tampered owned path and preserves unrelated worktree drift", async () => {
		const fixture = await repairFixture("host-a", "stale");
		await fixture.doctor.diagnose({ transactionId: fixture.transactionId });
		const token = await fixture.store.readDoctorToken(
			fixture.transactionId,
			fixture.ledgerHead,
		);
		const takeover = await fixture.repair.run({
			action: "stale-lease-takeover",
			transactionId: fixture.transactionId,
			remote: "origin",
			expectedLedgerGeneration: fixture.ledgerHead,
			doctorToken: token,
			priorWriterStopped: true,
		});
		expect(takeover).toMatchObject({ status: "repaired", state: "superseded" });

		// R26a: reconcile-quarantine mutates quarantine state, so it refuses
		// without the owner capability before reading any evidence.
		const missingCapability = await fixture.repair.run({
			action: "reconcile-quarantine",
			transactionId: fixture.transactionId,
			remote: "origin",
		});
		expect(missingCapability).toMatchObject({
			status: "refused",
			blocker: "capability_invalid",
			changedState: "none",
		});

		writeFileSync(
			join(fixture.clone, "candidate.md"),
			"tampered after takeover\n",
		);
		const refusedReconcile = await fixture.repair.run({
			action: "reconcile-quarantine",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(refusedReconcile).toMatchObject({
			status: "refused",
			blocker: "deterministic_repair_mismatch",
			changedState: "none",
		});
		expect(await fixture.store.readQuarantine()).toMatchObject({
			status: "quarantined",
		});

		// Restoring the admitted-new owned path to its absent baseline makes the
		// determinism gate provable again. Unrelated unstaged state is not an
		// authority input and reconciliation never mutates it.
		rmSync(join(fixture.clone, "candidate.md"));
		git(fixture.clone, "rm", "--cached", "--ignore-unmatch", "candidate.md");
		const unrelatedDraft = join(fixture.clone, "unrelated-draft.md");
		writeFileSync(unrelatedDraft, "preserve me\n");
		const reconciled = await fixture.repair.run({
			action: "reconcile-quarantine",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(reconciled).toMatchObject({
			status: "repaired",
			state: "closed",
			phase: "closed",
			changedState: "local",
			nextAction: { id: "none" },
		});
		expect(await fixture.store.readQuarantine()).toMatchObject({
			status: "reconciled",
			transactionId: fixture.transactionId,
		});
		expect(await fixture.store.load()).toMatchObject({
			status: "loaded",
			receipt: {
				phase: "closed",
				transition: "quarantine_reconciled",
			},
		});
		expect(readFileSync(unrelatedDraft, "utf8")).toBe("preserve me\n");
	});

	test("reconcile-quarantine refuses unrelated staged index drift", async () => {
		const fixture = await repairFixture("host-a", "stale");
		await fixture.doctor.diagnose({ transactionId: fixture.transactionId });
		const token = await fixture.store.readDoctorToken(
			fixture.transactionId,
			fixture.ledgerHead,
		);
		const takeover = await fixture.repair.run({
			action: "stale-lease-takeover",
			transactionId: fixture.transactionId,
			remote: "origin",
			expectedLedgerGeneration: fixture.ledgerHead,
			doctorToken: token,
			priorWriterStopped: true,
		});
		expect(takeover).toMatchObject({ status: "repaired", state: "superseded" });

		rmSync(join(fixture.clone, "candidate.md"));
		git(fixture.clone, "rm", "--cached", "--ignore-unmatch", "candidate.md");
		const unrelatedStaged = join(fixture.clone, "unrelated-staged.md");
		writeFileSync(unrelatedStaged, "preserve staged bytes\n");
		git(fixture.clone, "add", "unrelated-staged.md");

		const result = await fixture.repair.run({
			action: "reconcile-quarantine",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(result).toMatchObject({
			status: "refused",
			blocker: "deterministic_repair_mismatch",
			changedState: "none",
		});
		expect(await fixture.store.readQuarantine()).toMatchObject({
			status: "quarantined",
			transactionId: fixture.transactionId,
		});
		expect(readFileSync(unrelatedStaged, "utf8")).toBe(
			"preserve staged bytes\n",
		);
	});

	test("resumes marker publication without duplicating the reconciled receipt revision", async () => {
		const fixture = await repairFixture("host-a", "stale");
		await fixture.doctor.diagnose({ transactionId: fixture.transactionId });
		const token = await fixture.store.readDoctorToken(
			fixture.transactionId,
			fixture.ledgerHead,
		);
		await fixture.repair.run({
			action: "stale-lease-takeover",
			transactionId: fixture.transactionId,
			remote: "origin",
			expectedLedgerGeneration: fixture.ledgerHead,
			doctorToken: token,
			priorWriterStopped: true,
		});
		rmSync(join(fixture.clone, "candidate.md"));

		let interruptTerminalMarker = true;
		const interruptedStore = {
			...fixture.store,
			recordQuarantine: async (
				record: Parameters<typeof fixture.store.recordQuarantine>[0],
			) => {
				if (record.status === "reconciled" && interruptTerminalMarker) {
					interruptTerminalMarker = false;
					throw new Error("injected terminal marker interruption");
				}
				return fixture.store.recordQuarantine(record);
			},
		};
		const interruptedRepair = createVaultGitRepair({
			...fixture.options,
			store: interruptedStore,
		});
		const interrupted = await interruptedRepair.run({
			action: "reconcile-quarantine",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(interrupted).toMatchObject({
			status: "refused",
			blocker: "receipt_corrupt",
			changedState: "partial",
		});
		const receiptAfterInterruption = await fixture.store.load();
		expect(receiptAfterInterruption).toMatchObject({
			status: "loaded",
			receipt: { transition: "quarantine_reconciled" },
		});
		expect(await fixture.store.readQuarantine()).toMatchObject({
			status: "recovery_pending",
		});

		const resumed = await fixture.repair.run({
			action: "reconcile-quarantine",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(resumed).toMatchObject({
			status: "repaired",
			state: "closed",
			phase: "closed",
			changedState: "local",
		});
		expect(await fixture.store.readQuarantine()).toMatchObject({
			status: "reconciled",
		});
		const receiptAfterResume = await fixture.store.load();
		expect(receiptAfterResume).toEqual(receiptAfterInterruption);
		expect(await fixture.doctor.diagnose({
			transactionId: fixture.transactionId,
		})).toMatchObject({
			finding: "transaction_closed",
			nextAction: { id: "none" },
		});
	});

	test("resumes staged-only recovery after terminal quarantine publication is lost", async () => {
		const fixture = await repairFixture("host-a", "stale");
		await fixture.doctor.diagnose({ transactionId: fixture.transactionId });
		const token = await fixture.store.readDoctorToken(
			fixture.transactionId,
			fixture.ledgerHead,
		);
		const takeover = await fixture.repair.run({
			action: "stale-lease-takeover",
			transactionId: fixture.transactionId,
			remote: "origin",
			expectedLedgerGeneration: fixture.ledgerHead,
			doctorToken: token,
			priorWriterStopped: true,
		});
		expect(takeover).toMatchObject({ status: "repaired", state: "superseded" });

		rmSync(join(fixture.clone, "candidate.md"));
		writeFileSync(join(fixture.clone, "later.md"), "later aligned work\n");
		git(fixture.clone, "add", "--", "later.md");
		git(
			fixture.clone,
			"commit",
			"--only",
			"-m",
			"docs: advance without staged candidate",
			"--",
			"later.md",
		);
		git(fixture.clone, "push", "origin", "HEAD:refs/heads/main");

		const interruptedRepository = {
			...fixture.repository,
			applyStagedRecovery: async (
				plan: Parameters<
					NonNullable<typeof fixture.repository.applyStagedRecovery>
				>[0],
			) => {
				const result = await fixture.repository.applyStagedRecovery?.(plan);
				return result?.status === "recovered"
					? ({ status: "refused", reason: "mismatch" } as const)
					: (result ?? ({ status: "refused", reason: "mismatch" } as const));
			},
		};
		const interruptedRepair = createVaultGitRepair({
			...fixture.options,
			repository: interruptedRepository,
		});
		const interrupted = await interruptedRepair.run({
			action: "reconcile-quarantine",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(interrupted).toMatchObject({
			status: "refused",
			blocker: "deterministic_repair_mismatch",
			changedState: "partial",
		});
		expect(await fixture.store.readQuarantine()).toMatchObject({
			status: "recovery_pending",
			transactionId: fixture.transactionId,
		});
		expect(readFileSync(join(fixture.clone, "candidate.md"), "utf8")).toBe(
			"candidate\n",
		);
		expect(git(fixture.clone, "diff", "--cached", "--name-only", "--", "candidate.md")).toBe("");

		const resumed = await fixture.repair.run({
			action: "reconcile-quarantine",
			transactionId: fixture.transactionId,
			remote: "origin",
			capability: fixture.ownerCapability,
		});
		expect(resumed).toMatchObject({
			status: "repaired",
			state: "closed",
			changedState: "local",
		});
		expect(await fixture.store.readQuarantine()).toMatchObject({
			status: "reconciled",
			transactionId: fixture.transactionId,
		});
		expect(readFileSync(join(fixture.clone, "candidate.md"), "utf8")).toBe(
			"candidate\n",
		);
	});

	test.each([
		["prepare", "none"],
		["apply", "partial"],
	] as const)(
		"keeps a timed-out staged recovery %s retry-safe and quarantined",
		async (stage, changedState) => {
			const fixture = await repairFixture("host-a", "stale");
			await fixture.doctor.diagnose({ transactionId: fixture.transactionId });
			const token = await fixture.store.readDoctorToken(
				fixture.transactionId,
				fixture.ledgerHead,
			);
			await fixture.repair.run({
				action: "stale-lease-takeover",
				transactionId: fixture.transactionId,
				remote: "origin",
				expectedLedgerGeneration: fixture.ledgerHead,
				doctorToken: token,
				priorWriterStopped: true,
			});
			const repository = {
				...fixture.repository,
				...(stage === "prepare"
					? {
							prepareStagedRecovery: async () =>
								({ status: "refused", reason: "timed_out" }) as const,
						}
					: {
							applyStagedRecovery: async () =>
								({ status: "refused", reason: "timed_out" }) as const,
						}),
			};
			const repair = createVaultGitRepair({
				...fixture.options,
				repository,
			});

			const result = await repair.run({
				action: "reconcile-quarantine",
				transactionId: fixture.transactionId,
				remote: "origin",
				capability: fixture.ownerCapability,
			});

			expect(result).toMatchObject({
				status: "refused",
				state: "superseded",
				blocker: "host_quarantined",
				changedState,
				retrySafety: "same_input_safe",
				nextAction: { id: "reconcile_quarantine" },
			});
			expect(await fixture.store.readQuarantine()).toMatchObject({
				status: stage === "prepare" ? "quarantined" : "recovery_pending",
			});
		},
	);

	test("refuses a stale doctor proof after owned content changes", async () => {
		const fixture = await repairFixture("host-a", "stale");
		await fixture.doctor.diagnose({ transactionId: fixture.transactionId });
		const token = await fixture.store.readDoctorToken(
			fixture.transactionId,
			fixture.ledgerHead,
		);
		writeFileSync(join(fixture.clone, "candidate.md"), "changed after doctor\n");
		const result = await fixture.repair.run({
			action: "stale-lease-takeover",
			transactionId: fixture.transactionId,
			remote: "origin",
			expectedLedgerGeneration: fixture.ledgerHead,
			doctorToken: token,
			priorWriterStopped: true,
		});
		expect(result).toMatchObject({
			status: "refused",
			blocker: "doctor_proof_stale",
			changedState: "none",
		});
		expect(git(fixture.bare, "rev-parse", VAULT_GIT_LEDGER_REF)).toBe(
			fixture.ledgerHead,
		);
	});
});

async function repairFixture(
	runtimeHost = "host-a",
	mode: "push_pending" | "stale" = "push_pending",
) {
	const root = await mkdtemp(join(tmpdir(), "vault-git-repair-"));
	roots.push(root);
	const bare = join(root, "remote.git");
	const clone = join(root, "clone");
	git(root, "init", "--bare", bare);
	git(root, "clone", bare, clone);
	git(clone, "checkout", "-b", "main");
	git(clone, "config", "user.name", "Fixture");
	git(clone, "config", "user.email", "fixture@example.invalid");
	const baseline = commitFile(clone, "initial.md", "initial\n", "initial");
	git(clone, "push", "origin", "refs/heads/main:refs/heads/main");

	const transactionId = `txn_${"1".repeat(32)}`;
	const acquiredAt = "2026-08-09T00:00:00.000Z";
	const leaseDurationMs = mode === "stale" ? 1_000 : 60_000;
	const heldContent = ledgerContent({
		operation: "acquire",
		previousGeneration: null,
		transactionId,
		baseline,
		acquiredAt,
		transitionedAt: acquiredAt,
		state: "held",
		leaseDurationMs,
	});
	const ledgerHead = commitLedger(clone, heldContent, [], "vault-ledger: acquire");
	git(clone, "push", "origin", `${ledgerHead}:${VAULT_GIT_LEDGER_REF}`);

	const candidate = commitFile(
		clone,
		"candidate.md",
		"candidate\n",
		`docs(vault): record candidate\n\nVault-Transaction: ${transactionId}`,
	);
	const preparedAt = "2026-08-09T00:00:01.000Z";
	const releaseContent = ledgerContent({
		operation: "release",
		previousGeneration: ledgerHead,
		transactionId,
		baseline,
		acquiredAt,
		transitionedAt: preparedAt,
		state: "released",
		leaseDurationMs,
	});
	const releaseCommit = commitLedger(
		clone,
		releaseContent,
		[ledgerHead],
		`vault-ledger: release ${transactionId}`,
		preparedAt,
	);

	const processPort = createNodeProcessPort();
	const timeouts = { fetchMs: 5_000, pushMs: 5_000, localMs: 5_000 };
	const remote = createGitAdapter({
		repositoryPath: clone,
		process: processPort,
		timeouts,
	});
	const repository = createGitRepositoryAdapter({
		repositoryPath: clone,
		repositoryIdentity: "canonical-vault",
		process: processPort,
		timeouts,
	});
	if (!repository.captureUnrelatedState) {
		throw new Error("fixture requires the unrelated-state probe");
	}
	// The real capture (owned paths excluded) keeps reconcile-quarantine's
	// determinism gate honest: the index legitimately holds initial.md.
	const unrelatedState = await repository.captureUnrelatedState(["candidate.md"]);

	const stateRoot = join(root, "state");
	const store = createReceiptStore({
		stateRoot,
		repositoryIdentity: "canonical-vault",
	});
	const ownerCapability = new Uint8Array([7, 8, 9]);
	const receipt: VaultGitReceipt = {
		schemaVersion: 2,
		receiptId: `receipt_${"2".repeat(32)}`,
		transactionId,
		revision: 1,
		phase: mode === "stale" ? "writing" : "push_pending",
		transition:
			mode === "stale" ? "write_authority_granted" : "push_outcome_unknown",
		recordedAt: preparedAt,
		event: "note_created",
		actor: "agent-a",
		host: "host-a",
		remote: "origin",
		ownedPaths: [
			{ path: "candidate.md", baselineHash: null, admittedNewFile: true },
		],
		unrelatedState,
		localMainHead: baseline,
		remoteMainHead: baseline,
		expectedLeaseGeneration: null,
		leaseGeneration: ledgerHead,
		leaseAcquiredAt: acquiredAt,
		leaseDurationMs,
		commitId: mode === "stale" ? null : candidate,
		expectedMainCommit: mode === "stale" ? null : candidate,
		ledgerReleaseId: mode === "stale" ? null : releaseCommit,
		pushOutcome: mode === "stale" ? "not_attempted" : "unknown",
		nextSafeAction: mode === "stale" ? "complete_transaction" : "run_doctor",
		diagnosticsReference: `receipt:receipt_${"2".repeat(32)}`,
	};
	await store.initialize(receipt, {
		ownerCapability,
		joinCapability: new Uint8Array([1, 2, 3]),
	});
	if (mode === "stale") {
		git(clone, "update-ref", "refs/heads/main", baseline, candidate);
	}
	const runtime = new FixedRuntime(runtimeHost);
	const options = {
		store,
		repository,
		ledger: { git: remote, clock: runtime },
		runtime,
		repositoryIdentity: "canonical-vault",
		activationAuthority: {
			validate: async () => ({
				status: "admitted" as const,
				evidenceId: "fixture",
			}),
		},
	};
	return {
		root,
		bare,
		clone,
		candidate,
		ledgerHead,
		releaseCommit,
		transactionId,
		ownerCapability,
		repository,
		options,
		store,
		doctor: createVaultGitDoctor(options),
		repair: createVaultGitRepair(options),
	};
}

class FixedRuntime implements VaultGitRuntimePort {
	constructor(private readonly hostId: string) {}
	now(): Date {
		return new Date("2026-08-09T00:00:02.000Z");
	}
	actor(): string {
		return "agent-a";
	}
	host(): string {
		return this.hostId;
	}
	newReceiptId(): string {
		return `receipt_${"3".repeat(32)}`;
	}
	interrupt(): void {}
}

function ledgerContent(input: {
	operation: "acquire" | "release";
	previousGeneration: string | null;
	transactionId: string;
	baseline: string;
	acquiredAt: string;
	transitionedAt: string;
	state: "held" | "released";
	leaseDurationMs: number;
}): string {
	return `${JSON.stringify({
		schema_version: 1,
		operation: input.operation,
		previous_generation: input.previousGeneration,
		transitioned_at: input.transitionedAt,
		lease: {
			transaction_id: input.transactionId,
			actor: "agent-a",
			host: "host-a",
			event: "note_created",
			owned_paths: ["candidate.md"],
			local_main_head: input.baseline,
			remote_main_head: input.baseline,
			acquired_at: input.acquiredAt,
			lease_duration_ms: input.leaseDurationMs,
			state: input.state,
		},
	})}\n`;
}

function commitLedger(
	cwd: string,
	content: string,
	parents: readonly string[],
	message: string,
	timestamp = "2026-08-09T00:00:00.000Z",
): string {
	const blob = gitInput(cwd, content, "hash-object", "-w", "--stdin");
	const tree = gitInput(cwd, `100644 blob ${blob}\tledger.json\n`, "mktree");
	return execFileSync(
		"git",
		["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", message],
		{
			cwd,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "agent-a",
				GIT_AUTHOR_EMAIL: "vault-git@localhost.invalid",
				GIT_AUTHOR_DATE: timestamp,
				GIT_COMMITTER_NAME: "vault-git transaction manager",
				GIT_COMMITTER_EMAIL: "vault-git@localhost.invalid",
				GIT_COMMITTER_DATE: timestamp,
			},
		},
	).trim();
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
