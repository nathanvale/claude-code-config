import {
	createVaultGitPreparedEvidence,
	projectVaultGitPreparedActivationResult,
	type VaultGitPreparedActivationResultV3,
} from "./activation-contract.ts";
import {
	createVaultGitActivationRestriction,
	projectVaultGitActivationRestrictionJson,
	type VaultGitActivationRestrictionJsonV3,
} from "./activation-restriction.ts";

/** Published sanitized fixture consumed by First-Use Experience. */
export interface VaultGitFirstUseExperienceContractFixture {
	readonly prepared: VaultGitPreparedActivationResultV3;
	readonly restricted: VaultGitActivationRestrictionJsonV3;
}

/** Published sanitized fixture consumed by Background Preflight. */
export interface VaultGitBackgroundPreflightContractFixture {
	readonly prepared: VaultGitPreparedActivationResultV3;
}

/** Published sanitized fixture reserved for planned Safe Manual Handoff work. */
export interface VaultGitSafeManualHandoffContractFixture {
	readonly restricted: VaultGitActivationRestrictionJsonV3;
}

/** Published sanitized fixture reserved for planned model-advice work. */
export interface VaultGitAttentionAndModelAdviceContractFixture {
	readonly prepared: VaultGitPreparedActivationResultV3;
	readonly restricted: VaultGitActivationRestrictionJsonV3;
}

const prepared = preparedFixture();
const activationMissing = projectVaultGitActivationRestrictionJson(
	createVaultGitActivationRestriction({
		stoppedAction: "vault_write",
		cause: "admission_missing",
	}),
);
const configurationMissing = projectVaultGitActivationRestrictionJson(
	createVaultGitActivationRestriction({
		stoppedAction: "vault_write",
		cause: "configuration_missing",
		missingConfiguration: [
			"ssh_identity_file",
			"ssh_public_key",
			"ssh_known_hosts",
		],
	}),
);

/** Stable public fixtures for every planned activation consumer. */
export const vaultGitActivationConsumerContractFixtures = Object.freeze({
	firstUseExperience: Object.freeze({
		prepared,
		restricted: configurationMissing,
	}),
	backgroundPreflight: Object.freeze({ prepared }),
	safeManualHandoff: Object.freeze({ restricted: activationMissing }),
	attentionAndModelAdvice: Object.freeze({
		prepared,
		restricted: activationMissing,
	}),
}) satisfies Readonly<{
	firstUseExperience: VaultGitFirstUseExperienceContractFixture;
	backgroundPreflight: VaultGitBackgroundPreflightContractFixture;
	safeManualHandoff: VaultGitSafeManualHandoffContractFixture;
	attentionAndModelAdvice: VaultGitAttentionAndModelAdviceContractFixture;
}>;

function preparedFixture(): VaultGitPreparedActivationResultV3 {
	const opaqueIdentity = (owner: string, digit: string): string =>
		`${owner}:v1:${digit.repeat(64)}`;
	return projectVaultGitPreparedActivationResult(
		createVaultGitPreparedEvidence({
			repositoryIdentity: opaqueIdentity("vault-git", "1"),
			remoteIdentity: opaqueIdentity("remote", "2"),
			hostIdentity: opaqueIdentity("host", "3"),
			runtimeIdentity: opaqueIdentity("runtime", "4"),
			executableIdentity: opaqueIdentity("executable", "5"),
			privateStateIdentity: opaqueIdentity("private-state", "6"),
			localMainHead: "7".repeat(40),
			remoteMainHead: "7".repeat(40),
			ledgerGeneration: "8".repeat(40),
			gitIdentity: opaqueIdentity("git", "9"),
			sshIdentity: opaqueIdentity("ssh", "a"),
			checkerClosure: {
				entrypointHash: "b".repeat(64),
				dependencyBundleHash: "c".repeat(64),
			},
			jobGeneration: 1,
			capturedAt: "2026-08-11T00:00:00.000Z",
		}),
		"2026-08-11T00:05:00.000Z",
	);
}
