import {
	createVaultGitPreparedEvidence,
	type VaultGitPreparedEvidenceInput,
	type VaultGitPreparedEvidenceV2,
} from "../src/activation-contract.ts";
import type { VaultGitReceiptStore } from "../src/store.ts";
import type {
	VaultGitActivationAuthority,
	VaultGitLiveActivationBindings,
} from "../src/activation-authority.ts";

const identity = (owner: string, byte: string): string =>
	`${owner}:v1:${byte.repeat(64)}`;

/** Explicit fixture-only authority for lifecycle tests outside activation scope. */
export const admittedActivationAuthorityForTest: Pick<
	VaultGitActivationAuthority,
	"validate"
> = {
	async validate() {
		return {
			status: "admitted",
			evidenceId: `vault-git:prepared:v2:${"f".repeat(64)}`,
		};
	},
};

/** Fixture-only persisted admission seam for process and lifecycle tests. */
export function persistedActivationAuthorityForTest(
	store: VaultGitReceiptStore,
): Pick<VaultGitActivationAuthority, "validate"> {
	return {
		async validate() {
			const [activation, evidence] = await Promise.all([
				store.readActivation(),
				store.readPreparedEvidence(),
			]);
			if (!activation || !evidence || activation.evidenceId !== evidence.evidenceId) {
				return { status: "denied" as const, reason: "admission_missing" as const };
			}
			return { status: "admitted" as const, evidenceId: activation.evidenceId };
		},
	};
}

/** Complete V2 prepared evidence for tests that exercise activation. */
export function preparedEvidenceInputForTest(
	overrides: Partial<VaultGitPreparedEvidenceInput> = {},
): VaultGitPreparedEvidenceInput {
	return {
		repositoryIdentity: identity("vault-git", "1"),
		remoteIdentity: identity("remote", "2"),
		hostIdentity: identity("host", "3"),
		runtimeIdentity: identity("runtime", "4"),
		executableIdentity: identity("executable", "5"),
		privateStateIdentity: identity("private-state", "6"),
		localMainHead: "7".repeat(40),
		remoteMainHead: "7".repeat(40),
		ledgerGeneration: "8".repeat(40),
		gitIdentity: identity("git", "9"),
		sshIdentity: identity("ssh", "a"),
		checkerClosure: {
			entrypointHash: "b".repeat(64),
			dependencyBundleHash: "c".repeat(64),
		},
		jobGeneration: 1,
		capturedAt: "2026-08-09T00:00:00.000Z",
		...overrides,
	};
}

/** Complete V2 prepared evidence for tests that exercise activation. */
export function preparedEvidenceForTest(
	overrides: Partial<VaultGitPreparedEvidenceInput> = {},
): VaultGitPreparedEvidenceV2 {
	return createVaultGitPreparedEvidence(preparedEvidenceInputForTest(overrides));
}

/** Exact live binding projection for activation tests. */
export function liveActivationBindingsForTest(
	evidence: VaultGitPreparedEvidenceV2,
): VaultGitLiveActivationBindings {
	return {
		repositoryIdentity: evidence.repositoryIdentity,
		remoteIdentity: evidence.remoteIdentity,
		hostIdentity: evidence.hostIdentity,
		runtimeIdentity: evidence.runtimeIdentity,
		executableIdentity: evidence.executableIdentity,
		privateStateIdentity: evidence.privateStateIdentity,
		localMainHead: evidence.localMainHead,
		remoteMainHead: evidence.remoteMainHead,
		ledgerGeneration: evidence.ledgerGeneration,
		gitIdentity: evidence.gitIdentity,
		sshIdentity: evidence.sshIdentity,
		checkerClosure: evidence.checkerClosure,
	};
}

/**
 * Admit R34 runtime activation for one test fixture.
 *
 * Write-capable engine commands refuse with blocker `activation_blocked`
 * until an operator admission exists; fixtures that exercise writes call this
 * once during setup. Un-admitted refusal behavior keeps its own dedicated
 * tests that deliberately skip this helper.
 */
export async function admitActivationForTest(
	store: VaultGitReceiptStore,
): Promise<void> {
	const evidence = preparedEvidenceForTest();
	await store.publishPreparedEvidence(evidence);
	await store.admitActivation({
		schemaVersion: 2,
		evidenceId: evidence.evidenceId,
		admittedAt: "2026-08-09T00:00:00.000Z",
		note: "test fixture admission",
	});
}
