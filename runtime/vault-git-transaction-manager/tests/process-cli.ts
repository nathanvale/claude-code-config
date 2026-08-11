#!/usr/bin/env bun

import {
	createVaultGitCliComposition,
	main,
} from "../src/cli.ts";
import {
	evaluateVaultGitPreparedEvidence,
	projectVaultGitPreparedActivationResult,
} from "../src/activation-contract.ts";
import type { VaultGitActivationFrontDoor } from "../src/activation-front-door.ts";
import {
	projectVaultGitActivatedResult,
	projectVaultGitDeferredResult,
	projectVaultGitRevokedResult,
} from "../src/activation-result.ts";
import { createNodeProcessPort } from "../src/git-adapter.ts";
import { resolveVaultRepositoryIdentity } from "../src/repository-identity.ts";
import { persistedActivationAuthorityForTest } from "./activation-fixture.ts";

const required = (name: string): string => {
	const value = process.env[name];
	if (!value) throw new Error(`missing ${name}`);
	return value;
};

const repositoryPath = required("VAULT_GIT_REPOSITORY_PATH");
// Resolve the git identity once and inject it into both compositions; each
// composition otherwise re-probes git for the same root, doubling subprocess
// work per test invocation.
const { identity: repositoryIdentity } = await resolveVaultRepositoryIdentity({
	repositoryPath,
	process: createNodeProcessPort(),
	timeoutMs: 5_000,
});
const baseInput = {
	repositoryPath,
	checkRepositoryPath: required("VAULT_GIT_CHECK_REPOSITORY_PATH"),
	stateRoot: required("VAULT_GIT_STATE_ROOT"),
	repositoryIdentity,
	actor: required("VAULT_GIT_ACTOR"),
	host: required("VAULT_GIT_HOST"),
	remote: process.env.VAULT_GIT_REMOTE ?? "origin",
	privateEntrypointPath: import.meta.path,
} as const;
const storeComposition = await createVaultGitCliComposition(baseInput);
const validation = persistedActivationAuthorityForTest(storeComposition.store);
const lifecycleComposition = await createVaultGitCliComposition({
	...baseInput,
	activationAuthority: validation,
});
const activationFrontDoor: VaultGitActivationFrontDoor = {
	validate: validation.validate,
	async inspect() {
		const evidence = await lifecycleComposition.store.readPreparedEvidence();
		if (!evidence) {
			return evaluateVaultGitPreparedEvidence(
				null,
				"2026-08-12T00:00:00.000Z",
			);
		}
		const activation = await lifecycleComposition.store.readActivation();
		return activation?.evidenceId === evidence.evidenceId
			? projectVaultGitActivatedResult(evidence, "none")
			: projectVaultGitPreparedActivationResult(evidence, evidence.capturedAt);
	},
	async prepare() {
		const evidence = await lifecycleComposition.store.readPreparedEvidence();
		if (!evidence) {
			return evaluateVaultGitPreparedEvidence(
				null,
				"2026-08-12T00:00:00.000Z",
			);
		}
		return projectVaultGitPreparedActivationResult(evidence, evidence.capturedAt);
	},
	async review(request) {
		const evidence = await lifecycleComposition.store.readPreparedEvidence();
		if (!evidence) throw new Error("process fixture prepared evidence unavailable");
		return request.decision === "activate"
			? projectVaultGitActivatedResult(evidence, "local")
			: projectVaultGitDeferredResult(evidence);
	},
	async revoke() {
		const evidence = await lifecycleComposition.store.readPreparedEvidence();
		if (!evidence) throw new Error("process fixture prepared evidence unavailable");
		return projectVaultGitRevokedResult(evidence);
	},
};
const composition = { ...lifecycleComposition, activationFrontDoor };
const humanDecision = process.env.VAULT_GIT_TEST_HUMAN_DECISION;
const humanActivationReview = ["activate", "defer", "revoke"].includes(
	humanDecision ?? "",
)
	? {
			isInteractive: () => true,
			async decide() {
				return humanDecision as "activate" | "defer" | "revoke";
			},
		}
	: undefined;

process.exitCode = await main(Bun.argv.slice(2), {
	composition,
	...(humanActivationReview ? { humanActivationReview } : {}),
});
