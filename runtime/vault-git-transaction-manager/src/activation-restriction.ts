import {
	VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
	VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
} from "./activation-contract.ts";
import type {
	VaultGitActivationRestriction,
	VaultGitActivationRestrictionJsonV2,
} from "./model.ts";

export {
	createVaultGitActivationRestriction,
	VAULT_GIT_ACTIVATION_RESTRICTION_CAUSES,
	VAULT_GIT_ACTIVATION_STOPPED_ACTIONS,
} from "./model.ts";
export type {
	VaultGitActivationRestriction,
	VaultGitActivationRestrictionCause,
	VaultGitActivationRestrictionInput,
	VaultGitActivationRestrictionJsonV2,
	VaultGitActivationStoppedAction,
} from "./model.ts";

/** Project shared restriction semantics into the versioned public JSON contract. */
export function projectVaultGitActivationRestrictionJson(
	restriction: VaultGitActivationRestriction,
): VaultGitActivationRestrictionJsonV2 {
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
		next_action: restriction.nextAction,
	});
}

/** Render the exact shared restriction semantics for a human terminal. */
export function renderVaultGitActivationRestriction(
	restriction:
		| VaultGitActivationRestriction
		| VaultGitActivationRestrictionJsonV2,
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
