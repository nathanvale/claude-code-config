import type { VaultGitPreparedEvidenceActivationResultV1 } from "./activation-contract.ts";
import type { VaultGitActivationRestrictionJsonV1 } from "./activation-restriction.ts";

/** Complete versioned public activation-result contract. */
export type VaultGitActivationResultV1 =
	| VaultGitPreparedEvidenceActivationResultV1
	| VaultGitActivationRestrictionJsonV1;
