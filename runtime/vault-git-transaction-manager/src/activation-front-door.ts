import { randomBytes, timingSafeEqual } from "node:crypto";

import {
	evaluateVaultGitPreparedEvidence,
} from "./activation-contract.ts";
import {
	projectVaultGitActivatedResult,
	projectVaultGitDeferredResult,
	projectVaultGitRevokedResult,
	type VaultGitActivationResultV3,
} from "./activation-result.ts";
import type {
	VaultGitActivationAuthority,
	VaultGitActivationAuthorityResult,
} from "./activation-authority.ts";
import { inspectVaultGitActivationState } from "./activation-authority.ts";
import type {
	VaultGitActivationPreparationResult,
	VaultGitActivationPreparer,
} from "./activation-preparation.ts";
import {
	createVaultGitActivationRestriction,
	projectVaultGitActivationRestrictionJson,
} from "./activation-restriction.ts";
import type {
	VaultGitActivationRestrictionJsonV3,
	VaultGitActivationStoppedAction,
} from "./model.ts";
import type { VaultGitReceiptStore } from "./store.ts";

/** Build activation authority around one front-door-owned human capability validator. */
export type VaultGitActivationAuthorityFactory = (
	validateHumanCapability: (candidate: Uint8Array) => Promise<boolean>,
) => VaultGitActivationAuthority;

/** Public activation result emitted by the guarded production front door. */
export type VaultGitActivationFrontDoorResult =
	VaultGitActivationResultV3;

/** Exact human decision bound to one prepared evidence reference. */
export interface VaultGitActivationReviewRequest {
	readonly evidenceReference: string;
	readonly decision: "activate" | "defer";
}

/** Exact human revocation bound to the currently admitted evidence. */
export interface VaultGitActivationFrontDoorRevocationRequest {
	readonly evidenceReference: string;
}

/** Dependencies for one guarded activation front door. */
export interface VaultGitActivationFrontDoorOptions {
	/** Private evidence and admission store. */
	readonly store: VaultGitReceiptStore;
	/** Isolated evidence-only preparation owner. */
	readonly preparer: VaultGitActivationPreparer;
	/** Canonical clock used for display freshness and durable decisions. */
	readonly clock: () => string;
	/** Authority constructor receiving the unexported human capability validator. */
	readonly createAuthority: VaultGitActivationAuthorityFactory;
}

/** Guarded activation operations plus the engine's validation port. */
export interface VaultGitActivationFrontDoor {
	/** Inspect private activation state through the sanitized public result contract. */
	inspect(): Promise<VaultGitActivationFrontDoorResult>;
	/** Prepare evidence in isolated private state without granting write authority. */
	prepare(): Promise<VaultGitActivationFrontDoorResult>;
	/** Complete one human review without exposing admission capability bytes. */
	review(
		request: VaultGitActivationReviewRequest,
	): Promise<VaultGitActivationFrontDoorResult>;
	/** Revoke one exact admitted snapshot through the internal human capability. */
	revoke(
		request: VaultGitActivationFrontDoorRevocationRequest,
	): Promise<VaultGitActivationFrontDoorResult>;
	/** Revalidate activation for one engine operation. */
	validate: VaultGitActivationAuthority["validate"];
}

/**
 * Create the production activation boundary while keeping human capability bytes private.
 *
 * @param options - Store, preparer, clock, and authority construction owner
 * @returns Sanitized activation operations and the engine validation port
 *
 * @example
 * ```typescript
 * const frontDoor = createVaultGitActivationFrontDoor(options)
 * const result = await frontDoor.prepare()
 * ```
 */
export function createVaultGitActivationFrontDoor(
	options: VaultGitActivationFrontDoorOptions,
): VaultGitActivationFrontDoor {
	const humanCapability = new Uint8Array(randomBytes(32));
	const authority = options.createAuthority(async (candidate) =>
		sameCapability(humanCapability, candidate),
	);
	return {
		inspect: () => inspectActivation(options, authority),
		prepare: async () =>
			projectPreparationResult(await options.preparer.prepare()),
		review: (request) =>
			reviewActivation(options, authority, humanCapability, request),
		revoke: (request) =>
			revokeActivation(options, authority, humanCapability, request),
		validate: authority.validate,
	};
}

async function reviewActivation(
	options: VaultGitActivationFrontDoorOptions,
	authority: VaultGitActivationAuthority,
	humanCapability: Uint8Array,
	request: VaultGitActivationReviewRequest,
): Promise<VaultGitActivationFrontDoorResult> {
	const evidence = await options.store.readPreparedEvidence().catch(() => null);
	if (evidence === null || evidence.evidenceId !== request.evidenceReference) {
		return restriction("evidence_changed", "activation_admission");
	}
	const projected = evaluateVaultGitPreparedEvidence(evidence, options.clock());
	if (projected.status !== "prepared") {
		return restriction("evidence_changed", "activation_admission");
	}
	if (request.decision === "defer") {
		return projectVaultGitDeferredResult(evidence);
	}
	const admitted = await authority.admit({
		evidenceId: evidence.evidenceId,
		humanCapability,
		note: "human activation review",
	});
	if (admitted.status === "denied") {
		return restriction(admitted.reason, "activation_admission");
	}
	if (admitted.status !== "admitted") {
		return restriction("evidence_changed", "activation_admission");
	}
	return projectVaultGitActivatedResult(evidence, "local");
}

async function revokeActivation(
	options: VaultGitActivationFrontDoorOptions,
	authority: VaultGitActivationAuthority,
	humanCapability: Uint8Array,
	request: VaultGitActivationFrontDoorRevocationRequest,
): Promise<VaultGitActivationFrontDoorResult> {
	const evidence = await options.store.readPreparedEvidence().catch(() => null);
	if (evidence === null || evidence.evidenceId !== request.evidenceReference) {
		return restriction("evidence_changed", "activation_revocation");
	}
	const revoked = await authority.revoke({
		evidenceId: evidence.evidenceId,
		humanCapability,
		note: "human activation revocation",
	});
	if (revoked.status === "denied") {
		return restriction(revoked.reason, "activation_revocation");
	}
	if (revoked.status !== "revoked") {
		return restriction("evidence_changed", "activation_revocation");
	}
	return projectVaultGitRevokedResult(evidence);
}

async function inspectActivation(
	options: VaultGitActivationFrontDoorOptions,
	authority: VaultGitActivationAuthority,
): Promise<VaultGitActivationFrontDoorResult> {
	const observedAt = options.clock();
	const current = await inspectVaultGitActivationState(options.store, observedAt);
	if (current.status === "unavailable") {
		return restriction("revalidation_unavailable", "activation_admission");
	}
	if (current.status === "unprepared") {
		return evaluateVaultGitPreparedEvidence(null, observedAt);
	}
	if (current.status === "revoked" || current.status === "invalidated") {
		return restriction(current.status, "activation_admission");
	}
	if (current.status === "activated") {
		const validation = await authority.validate("continuation");
		if (validation.status === "denied") {
			return restriction(validation.reason, "activation_admission");
		}
		if (validation.status !== "admitted") {
			return restriction("revoked", "activation_admission");
		}
		return projectVaultGitActivatedResult(current.evidence, "none");
	}
	return evaluateVaultGitPreparedEvidence(current.evidence, observedAt);
}

function projectPreparationResult(
	result: VaultGitActivationPreparationResult,
): VaultGitActivationFrontDoorResult {
	if (result.status === "prepared") return result.result;
	return restriction(preparationDenial(result), "activation_preparation");
}

function preparationDenial(
	result: Exclude<VaultGitActivationPreparationResult, { readonly status: "prepared" }>,
): Extract<VaultGitActivationAuthorityResult, { readonly status: "denied" }>["reason"] {
	return result.reason === "main_not_aligned" || result.reason === "identity_changed"
		? "binding_changed"
		: "revalidation_unavailable";
}

function restriction(
	cause: Extract<VaultGitActivationAuthorityResult, { readonly status: "denied" }>[
		"reason"
	],
	stoppedAction: VaultGitActivationStoppedAction,
): VaultGitActivationRestrictionJsonV3 {
	return projectVaultGitActivationRestrictionJson(
		createVaultGitActivationRestriction({
			stoppedAction,
			cause,
		}),
	);
}

function sameCapability(expected: Uint8Array, candidate: Uint8Array): boolean {
	return (
		expected.byteLength === candidate.byteLength &&
		timingSafeEqual(expected, candidate)
	);
}
