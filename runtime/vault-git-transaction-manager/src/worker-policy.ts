import {
	VAULT_GIT_HYGIENE_WORKER_TRIGGERS,
	type VaultGitHygieneVaultPosture,
	type VaultGitHygieneWorkerTrigger,
	type VaultGitNextAction,
} from "./model.ts";

export { VAULT_GIT_HYGIENE_WORKER_TRIGGERS } from "./model.ts";

/** Runtime input for the closed hygiene-worker trigger gate. */
export interface VaultGitWorkerPolicyInput {
	/** Untrusted trigger label supplied by a caller or scheduler. */
	readonly trigger: string;
	/** True only after the new hygiene transaction acquired its own lease. */
	readonly leaseHeld?: boolean;
}

/** Bounded worker eligibility and cooperative vault posture signal. */
export interface VaultGitWorkerPolicyDecision {
	/** Whether the trigger may start one bounded hygiene worker. */
	readonly eligible: boolean;
	/** Admitted trigger when eligible. */
	readonly trigger?: VaultGitHygieneWorkerTrigger;
	/** Every admitted worker must acquire authority through a fresh transaction. */
	readonly requiresNewTransaction: boolean;
	/** Cooperative write posture for other vault agents. */
	readonly vaultPosture: VaultGitHygieneVaultPosture;
	/** Foreground work outside the vault stays available. */
	readonly foregroundNonVaultWorkAllowed: true;
	/** One bounded continuation; this module never spawns runtime work. */
	readonly nextAction: VaultGitNextAction;
}

/**
 * Admit only the three settled worker triggers and project lease posture.
 *
 * @param input - Untrusted trigger plus current hygiene-lease state
 * @returns Eligibility, fresh-transaction requirement, and one continuation
 * @throws Never
 *
 * @example
 * ```typescript
 * const decision = evaluateVaultGitWorkerPolicy({ trigger: "tidy_now" })
 * if (decision.eligible) scheduleBoundedWorker(decision.nextAction)
 * ```
 */
export function evaluateVaultGitWorkerPolicy(
	input: VaultGitWorkerPolicyInput,
): VaultGitWorkerPolicyDecision {
	const trigger = VAULT_GIT_HYGIENE_WORKER_TRIGGERS.includes(
		input.trigger as VaultGitHygieneWorkerTrigger,
	)
		? (input.trigger as VaultGitHygieneWorkerTrigger)
		: undefined;
	return {
		eligible: trigger !== undefined,
		...(trigger === undefined ? {} : { trigger }),
		requiresNewTransaction: trigger !== undefined,
		vaultPosture: input.leaseHeld ? "read_only" : "normal",
		foregroundNonVaultWorkAllowed: true,
		nextAction:
			trigger === undefined
				? { id: "none", summary: "No hygiene worker may start for this trigger." }
				: {
						id: "run_janitor",
						summary: "Run one bounded Janitor pass in a new transaction.",
					},
	};
}
