import {
	VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
	VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
} from "./activation-contract.ts";
import type {
	VaultGitActivationRestriction,
	VaultGitActivationRestrictionJsonV3,
} from "./model.ts";
import { projectVaultGitNextAction } from "./next-safe-action.ts";

export {
	createVaultGitActivationRestriction,
	VAULT_GIT_ACTIVATION_RESTRICTION_CAUSES,
	VAULT_GIT_ACTIVATION_STOPPED_ACTIONS,
} from "./model.ts";
export type {
	VaultGitActivationRestriction,
	VaultGitActivationRestrictionCause,
	VaultGitActivationRestrictionInput,
	VaultGitActivationRestrictionJsonV3,
	VaultGitActivationStoppedAction,
} from "./model.ts";

/** Project shared restriction semantics into the versioned public JSON contract. */
export function projectVaultGitActivationRestrictionJson(
	restriction: VaultGitActivationRestriction,
): VaultGitActivationRestrictionJsonV3 {
	return Object.freeze({
		contract_id: VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
		schema_version: VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
		status: "restricted",
		privacy: restriction.privacy,
		stopped_action: restriction.stoppedAction,
		cause: restriction.cause,
		protection: restriction.protection,
		observed_safe_state: restriction.observedSafeState,
		write_permission: restriction.writePermission,
		changed_state: restriction.changedState,
		...(restriction.missingConfiguration
			? { missing_configuration: restriction.missingConfiguration }
			: {}),
		manual_handoff: restriction.manualHandoff,
		// The restriction's guidance id becomes the authoritative Next Safe Action
		// union. A guidance id that needs an evidence selector (review_prepared,
		// return_to_human_review) or a not-yet-shipped feature has no executable
		// continuation from a restriction, so the union is an honest terminal none
		// with the compat id/summary preserved; the cause and manual_handoff already
		// explain the stop, and no runtime action is emitted for it.
		next_action: Object.freeze(
			projectVaultGitNextAction({
				id: restriction.nextAction.id,
				summary: restriction.nextAction.summary,
			}),
		),
	});
}

/** Render the exact shared restriction semantics for a human terminal. */
export function renderVaultGitActivationRestriction(
	restriction:
		| VaultGitActivationRestriction
		| VaultGitActivationRestrictionJsonV3,
): string {
	const projected = "stopped_action" in restriction;
	const stoppedAction = projected
		? restriction.stopped_action
		: restriction.stoppedAction;
	const observedSafeState = projected
		? restriction.observed_safe_state
		: restriction.observedSafeState;
	const writePermission = projected
		? restriction.write_permission
		: restriction.writePermission;
	const changedState = projected
		? restriction.changed_state
		: restriction.changedState;
	const manualHandoff = projected
		? restriction.manual_handoff
		: restriction.manualHandoff;
	const nextAction = projected
		? restriction.next_action
		: restriction.nextAction;
	const missingConfiguration = projected
		? restriction.missing_configuration
		: restriction.missingConfiguration;
	return [
		"status: restricted",
		`stopped_action: ${stoppedAction}`,
		`cause: ${restriction.cause.id} | ${restriction.cause.summary}`,
		`protection: ${restriction.protection}`,
		`observed_safe_state: ${observedSafeState}`,
		`write_permission: ${writePermission}`,
		`changed_state: ${changedState}`,
		...(missingConfiguration
			? [`missing_configuration: ${missingConfiguration.join(", ")}`]
			: []),
		`manual_handoff: ${manualHandoff.availability} | ${manualHandoff.summary}`,
		`next: ${nextAction.id} | ${nextAction.summary}`,
	].join("\n");
}
