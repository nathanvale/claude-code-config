import type { VaultGitPreparedEvidenceActivationResultV2 } from "./activation-contract.ts";
import type { VaultGitActivationRestrictionJsonV2 } from "./activation-restriction.ts";

/** Complete versioned public activation-result contract. */
export type VaultGitActivationResultV2 =
	| VaultGitPreparedEvidenceActivationResultV2
	| VaultGitActivationRestrictionJsonV2;
