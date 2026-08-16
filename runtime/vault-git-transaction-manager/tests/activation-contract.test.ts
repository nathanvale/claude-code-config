import { describe, expect, test } from "bun:test";

import {
	createVaultGitPreparedEvidence,
	createVaultGitActivationRestriction,
	evaluateVaultGitPreparedEvidence,
	parseVaultGitPreparedEvidence,
	projectVaultGitActivationRestrictionJson,
	projectVaultGitPreparedActivationResult,
	type VaultGitActivationResultV3,
	VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
	VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
	VAULT_GIT_PREPARED_EVIDENCE_CONTRACT_ID,
} from "../src/index.ts";
import { preparedEvidenceInputForTest } from "./activation-fixture.ts";

const preparedInput = (
	overrides: Parameters<typeof preparedEvidenceInputForTest>[0] = {},
) => preparedEvidenceInputForTest({
	jobGeneration: 12,
	capturedAt: "2026-08-11T00:00:00.000Z",
	...overrides,
});

const identity = (owner: string, digest: string): string =>
	`${owner}:v1:${digest.repeat(64)}`;

describe("V2 prepared activation evidence", () => {
	test("binds every required identity and state field into one immutable evidence id", () => {
		const evidence = createVaultGitPreparedEvidence(preparedInput());

		expect(Object.isFrozen(evidence)).toBe(true);
		expect(Object.isFrozen(evidence.checkerClosure)).toBe(true);
		expect(evidence).toMatchObject({
			contractId: VAULT_GIT_PREPARED_EVIDENCE_CONTRACT_ID,
			schemaVersion: 2,
			authority: "evidence_only",
			evidenceId: expect.stringMatching(/^vault-git:prepared:v2:[0-9a-f]{64}$/),
		});
		for (const [field, changed] of [
			["repositoryIdentity", identity("vault-git", "e")],
			["remoteIdentity", identity("remote", "e")],
			["hostIdentity", identity("host", "e")],
			["runtimeIdentity", identity("runtime", "e")],
			["executableIdentity", identity("executable", "e")],
			["privateStateIdentity", identity("private-state", "e")],
			["localMainHead", "e".repeat(40)],
			["remoteMainHead", "e".repeat(40)],
			["ledgerGeneration", "e".repeat(40)],
			["gitIdentity", identity("git", "e")],
			["sshIdentity", identity("ssh", "e")],
			["jobGeneration", 13],
			["capturedAt", "2026-08-11T00:00:01.000Z"],
		] as const) {
			const changedEvidence = createVaultGitPreparedEvidence(
				preparedInput({ [field]: changed }),
			);
			expect(changedEvidence.evidenceId, field).not.toBe(evidence.evidenceId);
		}

		const changedChecker = createVaultGitPreparedEvidence(
			preparedInput({
				checkerClosure: {
					...preparedInput().checkerClosure,
					entrypointHash: "e".repeat(64),
				},
			}),
		);
		expect(changedChecker.evidenceId).not.toBe(evidence.evidenceId);
	});

	test("rejects legacy, unknown, incomplete, malformed, extra, and tampered evidence", () => {
		const evidence = createVaultGitPreparedEvidence(preparedInput());
		const candidates: unknown[] = [
			{ schemaVersion: 1, admittedAt: "2026-08-11T00:00:00.000Z", note: "legacy" },
			{ ...evidence, schemaVersion: 3 },
			{ ...evidence, hostIdentity: undefined },
			{ ...evidence, remoteMainHead: "not-a-head" },
			{ ...evidence, unexpected: "field" },
			{ ...evidence, hostIdentity: identity("host", "f") },
		];

		for (const candidate of candidates) {
			expect(() => parseVaultGitPreparedEvidence(candidate)).toThrow(
				"prepared evidence invalid",
			);
		}
	});

	test("keeps per-host evidence independent", () => {
		const laptop = createVaultGitPreparedEvidence(preparedInput());
		const macMini = createVaultGitPreparedEvidence(
			preparedInput({ hostIdentity: identity("host", "f") }),
		);

		expect(macMini.evidenceId).not.toBe(laptop.evidenceId);
		expect(macMini.repositoryIdentity).toBe(laptop.repositoryIdentity);
	});
});

describe("activation result contract", () => {
	test("publishes the closed activation result vocabulary as schema v3", () => {
		expect(VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION).toBe("3");
	});

	test("returns one fresh-preparation action for legacy or tampered evidence", () => {
		const legacy = {
			schemaVersion: 1,
			admittedAt: "2026-08-11T00:00:00.000Z",
			note: "legacy",
		};
		const tampered = {
			...createVaultGitPreparedEvidence(preparedInput()),
			remoteIdentity: identity("remote", "f"),
		};

		for (const evidence of [legacy, tampered]) {
			expect(
				evaluateVaultGitPreparedEvidence(
					evidence,
					"2026-08-11T00:00:01.000Z",
				),
			).toEqual({
				contract_id: VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
				schema_version: VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
				status: "invalidated",
				authority: "none",
				write_permission: "denied",
				changed_state: "none",
				evidence_reference: null,
				captured_at: null,
				display_fresh_until: null,
				// The public next_action is the authoritative Next Safe Action union:
				// prepare_fresh is an invoke to `activation prepare --json`.
				next_action: {
					kind: "invoke",
					id: "prepare_fresh",
					action_id: "prepare_fresh",
					summary: "Prepare fresh V2 evidence before human review.",
					executable: "vault-git",
					argv: ["activation", "prepare", "--json"],
				},
			});
		}
	});

	test("sanitizes clock-skewed evidence to invalidated instead of throwing", () => {
		const evidence = createVaultGitPreparedEvidence(
			preparedInput({ capturedAt: "2026-08-11T00:05:00.000Z" }),
		);

		// Observer clock one second behind the preparer: capturedAt is ahead of
		// now. This must fail closed for the read surface, not crash it.
		expect(
			evaluateVaultGitPreparedEvidence(evidence, "2026-08-11T00:04:59.000Z"),
		).toMatchObject({
			status: "invalidated",
			authority: "none",
			write_permission: "denied",
			next_action: { id: "prepare_fresh" },
		});
	});

	test("projects fresh evidence as reviewable and explicitly non-authoritative", () => {
		const evidence = createVaultGitPreparedEvidence(preparedInput());
		const result = projectVaultGitPreparedActivationResult(
			evidence,
			"2026-08-11T00:09:59.999Z",
		);

		expect(result).toEqual({
			contract_id: VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
			schema_version: VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
			status: "prepared",
			authority: "evidence_only",
			write_permission: "denied",
			changed_state: "none",
			evidence_reference: evidence.evidenceId,
			captured_at: evidence.capturedAt,
			display_fresh_until: "2026-08-11T00:10:00.000Z",
			// review_prepared is a needs_human command handoff to the interactive
			// review surface, binding this evidence reference.
			next_action: {
				kind: "needs_human",
				id: "review_prepared",
				action_id: "review_prepared",
				summary: "Review the prepared evidence without granting write permission.",
				handoff_kind: "command",
				executable: "vault-git",
				argv: ["activation", "review", evidence.evidenceId, "--json"],
			},
		});
		expect(JSON.stringify(result)).not.toMatch(
			/hostIdentity|remoteIdentity|\/Users\/|credential|capability/i,
		);
	});

	test("expires display freshness at ten minutes without granting authority", () => {
		const evidence = createVaultGitPreparedEvidence(preparedInput());
		const result = projectVaultGitPreparedActivationResult(
			evidence,
			"2026-08-11T00:10:00.000Z",
		);

		expect(result).toMatchObject({
			status: "stale",
			authority: "evidence_only",
			write_permission: "denied",
			next_action: { id: "prepare_fresh" },
		});
	});

	test("one public result union accepts prepared, invalidated, and restricted variants", () => {
		const evidence = createVaultGitPreparedEvidence(preparedInput());
		const results: readonly VaultGitActivationResultV3[] = [
			projectVaultGitPreparedActivationResult(
				evidence,
				"2026-08-11T00:00:01.000Z",
			),
			evaluateVaultGitPreparedEvidence(
				{ schemaVersion: 1 },
				"2026-08-11T00:00:01.000Z",
			),
			projectVaultGitActivationRestrictionJson(
				createVaultGitActivationRestriction({
					stoppedAction: "vault_write",
					cause: "revoked",
				}),
			),
		];

		expect(results.map((result) => result.status)).toEqual([
			"prepared",
			"invalidated",
			"restricted",
		]);
	});
});
