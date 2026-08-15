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

const privateForegroundDelayMs = Number(
	process.env.VAULT_GIT_TEST_PRIVATE_FOREGROUND_DELAY_MS,
);
if (
	Number.isFinite(privateForegroundDelayMs) &&
	privateForegroundDelayMs > 0 &&
	!process.env.VAULT_GIT_TASK_ID &&
	!process.env.VAULT_GIT_DOCTOR_TASK_ID &&
	!process.argv.includes("--capability-fd")
) {
	await Bun.sleep(privateForegroundDelayMs);
}

// Production owns one fixed 30-second private-launch deadline today. Scale
// exact 30-second timers in this fixture; the checker barrier stops before any
// remote stage, so only the private launcher reaches that deadline in this row.
const privateLaunchTimeoutMs = Number(
	process.env.VAULT_GIT_TEST_PRIVATE_LAUNCH_TIMEOUT_MS,
);
const privateRepairLaunchTimeoutMs = Number(
	process.env.VAULT_GIT_TEST_PRIVATE_REPAIR_LAUNCH_TIMEOUT_MS,
);
const privateLegacyRepairLaunchTimeoutMs = Number(
	process.env.VAULT_GIT_TEST_PRIVATE_LEGACY_REPAIR_LAUNCH_TIMEOUT_MS,
);
const isStaleTakeoverParent =
	process.argv.includes("stale-lease-takeover") &&
	!process.argv.includes("--capability-fd");
if (
	(Number.isFinite(privateLaunchTimeoutMs) && privateLaunchTimeoutMs > 0) ||
	(Number.isFinite(privateRepairLaunchTimeoutMs) &&
		privateRepairLaunchTimeoutMs > 0)
) {
	const originalSetTimeout = globalThis.setTimeout;
	globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
		const [callback, delay, ...callbackArgs] = args;
		return originalSetTimeout(
			callback,
			scaledPrivateLaunchTimeout(delay),
			...callbackArgs,
		);
	}) as typeof globalThis.setTimeout;
}

function scaledPrivateLaunchTimeout(delay: number | undefined): number | undefined {
	if (delay === 30_000 && isStaleTakeoverParent) {
		if (
			Number.isFinite(privateLegacyRepairLaunchTimeoutMs) &&
			privateLegacyRepairLaunchTimeoutMs > 0
		) {
			return privateLegacyRepairLaunchTimeoutMs;
		}
	}
	if (
		delay === 30_000 &&
		Number.isFinite(privateLaunchTimeoutMs) &&
		privateLaunchTimeoutMs > 0
	) {
		return privateLaunchTimeoutMs;
	}
	if (
		delay === 120_000 &&
		isStaleTakeoverParent &&
		Number.isFinite(privateRepairLaunchTimeoutMs) &&
		privateRepairLaunchTimeoutMs > 0
	) {
		return privateRepairLaunchTimeoutMs;
	}
	return delay;
}

if (
	process.env.VAULT_GIT_TEST_PRIVATE_CHILD_MODE === "malformed_ack" &&
	process.env.VAULT_GIT_TASK_ID &&
	process.env.VAULT_GIT_TASK_LAUNCH_GENERATION
) {
	process.stdout.write("{malformed-worker-ack");
	process.exit(0);
}

if (
	process.env.VAULT_GIT_TEST_PRIVATE_CHILD_MODE === "delayed_repair_result" &&
	process.argv.includes("--capability-fd") &&
	process.argv.includes("stale-lease-takeover")
) {
	await Bun.sleep(
		Number(process.env.VAULT_GIT_TEST_PRIVATE_CHILD_DELAY_MS ?? "100"),
	);
	process.stdout.write(
		JSON.stringify({
			status: "ok",
			data: {
				command: "repair",
				outcome: "repaired",
				transaction_state: "superseded",
			},
		}),
	);
	process.exit(0);
}

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
	...(process.env.VAULT_GIT_TEST_LEASE_DURATION_MS
		? {
				leaseDurationMs: Number(
					process.env.VAULT_GIT_TEST_LEASE_DURATION_MS,
				),
			}
		: {}),
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
