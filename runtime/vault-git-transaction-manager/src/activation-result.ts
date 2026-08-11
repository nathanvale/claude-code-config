import {
	parseVaultGitPreparedEvidence,
	VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
	VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
	type VaultGitPreparedEvidenceActivationResultV2,
	type VaultGitPreparedEvidenceV2,
} from "./activation-contract.ts";
import {
	renderVaultGitActivationRestriction,
	type VaultGitActivationRestrictionJsonV2,
} from "./activation-restriction.ts";

/** Sanitized result after human review admits one exact prepared snapshot. */
export interface VaultGitActivatedActivationResultV2 {
	readonly contract_id: typeof VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID;
	readonly schema_version: typeof VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION;
	readonly status: "activated";
	readonly authority: "human_admission";
	/** Activation alone never grants a transaction capability. */
	readonly write_permission: "denied";
	readonly changed_state: "none" | "local";
	readonly evidence_reference: string;
	readonly next_action: {
		readonly id: "begin_transaction";
		readonly summary: string;
	};
}

/** Sanitized result when human review deliberately leaves activation deferred. */
export interface VaultGitDeferredActivationResultV2 {
	readonly contract_id: typeof VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID;
	readonly schema_version: typeof VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION;
	readonly status: "deferred";
	readonly authority: "evidence_only";
	readonly write_permission: "denied";
	readonly changed_state: "none";
	readonly evidence_reference: string;
	readonly next_action: {
		readonly id: "review_prepared";
		readonly summary: string;
	};
}

/** Sanitized result after human review revokes one exact activation. */
export interface VaultGitRevokedActivationResultV2 {
	readonly contract_id: typeof VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID;
	readonly schema_version: typeof VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION;
	readonly status: "revoked";
	readonly authority: "none";
	readonly write_permission: "denied";
	readonly changed_state: "local";
	readonly evidence_reference: string;
	readonly next_action: {
		readonly id: "prepare_fresh";
		readonly summary: string;
	};
}

/** Complete versioned public activation-result contract. */
export type VaultGitActivationResultV2 =
	| VaultGitPreparedEvidenceActivationResultV2
	| VaultGitActivatedActivationResultV2
	| VaultGitDeferredActivationResultV2
	| VaultGitRevokedActivationResultV2
	| VaultGitActivationRestrictionJsonV2;

/**
 * Project one admitted snapshot without exposing its private bindings.
 *
 * @param evidence - Exact validated evidence admitted by human review
 * @param changedState - Whether this invocation created the private admission
 * @returns Sanitized activated-state result with no transaction authority
 *
 * @example
 * ```typescript
 * const result = projectVaultGitActivatedResult(evidence, "local")
 * ```
 */
export function projectVaultGitActivatedResult(
	evidence: VaultGitPreparedEvidenceV2,
	changedState: "none" | "local",
): VaultGitActivatedActivationResultV2 {
	const parsed = parseVaultGitPreparedEvidence(evidence);
	return Object.freeze({
		contract_id: VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
		schema_version: VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
		status: "activated",
		authority: "human_admission",
		write_permission: "denied",
		changed_state: changedState,
		evidence_reference: parsed.evidenceId,
		next_action: Object.freeze({
			id: "begin_transaction",
			summary: "Begin one fenced transaction when a meaningful vault write is ready.",
		}),
	});
}

/**
 * Project a deliberate non-mutating defer choice.
 *
 * @param evidence - Exact prepared evidence left available for later review
 * @returns Sanitized deferred result with no authority
 *
 * @example
 * ```typescript
 * const result = projectVaultGitDeferredResult(evidence)
 * ```
 */
export function projectVaultGitDeferredResult(
	evidence: VaultGitPreparedEvidenceV2,
): VaultGitDeferredActivationResultV2 {
	const parsed = parseVaultGitPreparedEvidence(evidence);
	return Object.freeze({
		contract_id: VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
		schema_version: VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
		status: "deferred",
		authority: "evidence_only",
		write_permission: "denied",
		changed_state: "none",
		evidence_reference: parsed.evidenceId,
		next_action: Object.freeze({
			id: "review_prepared",
			summary: "Return to human review while this prepared evidence remains fresh.",
		}),
	});
}

/**
 * Project one durable human revocation without exposing private evidence.
 *
 * @param evidence - Exact activation evidence revoked by human review
 * @returns Sanitized revoked result
 *
 * @example
 * ```typescript
 * const result = projectVaultGitRevokedResult(evidence)
 * ```
 */
export function projectVaultGitRevokedResult(
	evidence: VaultGitPreparedEvidenceV2,
): VaultGitRevokedActivationResultV2 {
	const parsed = parseVaultGitPreparedEvidence(evidence);
	return Object.freeze({
		contract_id: VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
		schema_version: VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
		status: "revoked",
		authority: "none",
		write_permission: "denied",
		changed_state: "local",
		evidence_reference: parsed.evidenceId,
		next_action: Object.freeze({
			id: "prepare_fresh",
			summary: "Prepare fresh evidence before any later activation review.",
		}),
	});
}

/**
 * Render one sanitized activation result for a human terminal.
 *
 * @param result - Versioned public activation result
 * @returns Compact plain-text result with one next action
 *
 * @example
 * ```typescript
 * const output = renderVaultGitActivationResult(result)
 * ```
 */
export function renderVaultGitActivationResult(
	result: VaultGitActivationResultV2,
): string {
	if (result.status === "restricted") {
		return `${renderVaultGitActivationRestriction(result)}\n`;
	}
	return [
		`status: ${result.status}`,
		`authority: ${result.authority}`,
		`write_permission: ${result.write_permission}`,
		`changed_state: ${result.changed_state}`,
		`evidence_reference: ${result.evidence_reference ?? "none"}`,
		`next: ${result.next_action.id} | ${result.next_action.summary}`,
		"",
	].join("\n");
}
