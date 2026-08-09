import { describe, expect, test } from "bun:test";

import {
	VAULT_GIT_HYGIENE_WORKER_TRIGGERS,
	evaluateVaultGitWorkerPolicy,
} from "../src/worker-policy.ts";

describe("bounded hygiene worker policy", () => {
	test("admits only transaction close, tidy now, and nightly triggers", () => {
		expect(VAULT_GIT_HYGIENE_WORKER_TRIGGERS).toEqual([
			"transaction_close",
			"tidy_now",
			"nightly",
		]);
		for (const trigger of VAULT_GIT_HYGIENE_WORKER_TRIGGERS) {
			expect(evaluateVaultGitWorkerPolicy({ trigger })).toMatchObject({
				eligible: true,
				requiresNewTransaction: true,
				nextAction: { id: "run_janitor" },
			});
		}
		expect(
			evaluateVaultGitWorkerPolicy({ trigger: "manual_background" }),
		).toMatchObject({
			eligible: false,
			requiresNewTransaction: false,
			nextAction: { id: "none" },
		});
	});

	test("makes the vault read-only only while the hygiene lease is held", () => {
		expect(
			evaluateVaultGitWorkerPolicy({
				trigger: "nightly",
				leaseHeld: true,
			}),
		).toMatchObject({
			vaultPosture: "read_only",
			foregroundNonVaultWorkAllowed: true,
		});
		expect(
			evaluateVaultGitWorkerPolicy({ trigger: "nightly" }).vaultPosture,
		).toBe("normal");
	});
});
