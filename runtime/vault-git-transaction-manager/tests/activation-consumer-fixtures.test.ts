import { describe, expect, test } from "bun:test";

import {
	VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
	vaultGitActivationConsumerContractFixtures,
} from "../src/index.ts";

describe("activation consumer contract fixtures", () => {
	test("First-Use consumes published results without activation authority", () => {
		const view = consumeFirstUseBoundary(
			vaultGitActivationConsumerContractFixtures.firstUseExperience,
		);
		expect(view).toEqual({ status: "prepared", nextAction: "review_prepared" });
		expect(
			vaultGitActivationConsumerContractFixtures.firstUseExperience.restricted,
		).toMatchObject({
			schema_version: "3",
			cause: { id: "configuration_missing" },
			missing_configuration: [
				"ssh_identity_file",
				"ssh_public_key",
				"ssh_known_hosts",
			],
			next_action: { id: "configure_activation_identity" },
		});
		assertNoAuthoritySurface(
			vaultGitActivationConsumerContractFixtures.firstUseExperience,
		);
	});

	test("Background Preflight consumes published evidence-only results", () => {
		const snapshot = consumeBackgroundPreflightBoundary(
			vaultGitActivationConsumerContractFixtures.backgroundPreflight,
		);
		expect(snapshot).toEqual({
			contractId: VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
			authority: "evidence_only",
			writePermission: "denied",
		});
		assertNoAuthoritySurface(
			vaultGitActivationConsumerContractFixtures.backgroundPreflight,
		);
	});

	test("publishes sanitized fixtures for all four planned consumers", () => {
		expect(Object.keys(vaultGitActivationConsumerContractFixtures)).toEqual([
			"firstUseExperience",
			"backgroundPreflight",
			"safeManualHandoff",
			"attentionAndModelAdvice",
		]);
		assertNoAuthoritySurface(vaultGitActivationConsumerContractFixtures);
	});
});

function consumeFirstUseBoundary(
	fixture: typeof vaultGitActivationConsumerContractFixtures.firstUseExperience,
): { readonly status: string; readonly nextAction: string } {
	return {
		status: fixture.prepared.status,
		nextAction: fixture.prepared.next_action.id,
	};
}

function consumeBackgroundPreflightBoundary(
	fixture: typeof vaultGitActivationConsumerContractFixtures.backgroundPreflight,
): {
	readonly contractId: string;
	readonly authority: string;
	readonly writePermission: string;
} {
	return {
		contractId: fixture.prepared.contract_id,
		authority: fixture.prepared.authority,
		writePermission: fixture.prepared.write_permission,
	};
}

function assertNoAuthoritySurface(value: unknown): void {
	const serialized = JSON.stringify(value);
	for (const forbidden of [
		"admit",
		"approve",
		"capability",
		"revoke",
		"write_allowed",
	]) {
		expect(serialized.toLowerCase()).not.toContain(forbidden);
	}
	expect(serialized).not.toContain("/Users/");
	expect(serialized).not.toContain("ssh://");
}
