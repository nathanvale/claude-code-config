/** Package-owned lifecycle and result vocabulary. */
export * from "./model.ts";
/** Stable configured-vault identity derivation. */
export * from "./repository-identity.ts";
export * from "./activation-contract.ts";
export * from "./activation-identity.ts";
export * from "./activation-preparation.ts";
export * from "./activation-authority.ts";
export * from "./activation-restriction.ts";
export * from "./activation-result.ts";
export * from "./activation-consumer-fixtures.ts";
/** Future engine port contracts. */
export * from "./ports.ts";
/** Evidence-backed recovery classification. */
export * from "./doctor.ts";
/** Named deterministic recovery execution. */
export * from "./repair.ts";
/** Facade-backed command contract and discovery. */
export * from "./command-contract.ts";
/** Package-owned Branch Station Catalog. */
export * from "./branch-station-catalog.ts";
/** CLI entry point and production composition. */
export {
	createVaultGitCliComposition,
	main,
	renderVaultGitHelp,
	type VaultGitCliComposition,
	type VaultGitCliCompositionInput,
} from "./cli.ts";
