import {
	evaluateVaultGitPreparedEvidence,
	type VaultGitPreparedCheckerClosure,
	type VaultGitPreparedEvidenceV2,
} from "./activation-contract.ts";
import {
	VAULT_GIT_ACTIVATION_BINDINGS,
	type VaultGitActivationBinding,
	type VaultGitReceipt,
} from "./model.ts";
import {
	VaultGitLegacyActivationRecordError,
	type VaultGitReceiptStore,
} from "./store.ts";
import type {
	VaultGitActivationDenialReason,
	VaultGitActivationValidationPort,
	VaultGitActivationValidationScope,
} from "./ports.ts";

export type { VaultGitActivationValidationScope } from "./ports.ts";

const SCALAR_BINDINGS = VAULT_GIT_ACTIVATION_BINDINGS.filter(
	(binding) => binding !== "checkerClosure",
);
/** Authoritative live bindings compared with one prepared snapshot. */
export interface VaultGitLiveActivationBindings {
	readonly repositoryIdentity: string;
	readonly remoteIdentity: string;
	readonly hostIdentity: string;
	readonly runtimeIdentity: string;
	readonly executableIdentity: string;
	readonly privateStateIdentity: string;
	readonly localMainHead: string;
	readonly remoteMainHead: string;
	readonly ledgerGeneration: string;
	readonly gitIdentity: string;
	readonly sshIdentity: string;
	readonly checkerClosure: VaultGitPreparedCheckerClosure;
}

/** Human admission request bound to one exact prepared snapshot. */
export interface VaultGitActivationAdmissionRequest {
	readonly evidenceId: string;
	readonly humanCapability: Uint8Array;
	readonly note: string;
}

/** Human revocation request bound to one exact prepared snapshot. */
export interface VaultGitActivationRevocationRequest
	extends VaultGitActivationAdmissionRequest {}

/** Deterministic activation authority outcome. */
export type VaultGitActivationAuthorityResult =
	| { readonly status: "admitted"; readonly evidenceId: string }
	| { readonly status: "revoked"; readonly evidenceId: string }
	| {
			readonly status: "denied";
			readonly reason: VaultGitActivationDenialReason;
			readonly binding?: VaultGitActivationBinding;
	  };

/** Construction inputs for deterministic admission, validation, and revocation. */
export interface VaultGitActivationAuthorityOptions {
	readonly store: VaultGitReceiptStore;
	readonly clock: () => string;
	readonly validateHumanCapability: (candidate: Uint8Array) => Promise<boolean>;
	readonly revalidate: () => Promise<VaultGitLiveActivationBindings>;
}

/** Human admission and revocation authority plus the engine write gate. */
export interface VaultGitActivationAuthority
	extends VaultGitActivationValidationPort {
	admit(
		request: VaultGitActivationAdmissionRequest,
	): Promise<VaultGitActivationAuthorityResult>;
	validate(
		scope?: VaultGitActivationValidationScope,
	): Promise<VaultGitActivationAuthorityResult>;
	revoke(
		request: VaultGitActivationRevocationRequest,
	): Promise<VaultGitActivationAuthorityResult>;
}

/** Current private activation state shared by inspection and write validation. */
export type VaultGitActivationState =
	| { readonly status: "unprepared" }
	| { readonly status: "unavailable" }
	| {
			readonly status:
				| "prepared"
				| "stale"
				| "activated"
				| "invalidated"
				| "revoked";
			readonly evidence: VaultGitPreparedEvidenceV2;
	  };

/**
 * Classify current evidence, markers, and admission in one deterministic order.
 *
 * @param store - Private activation record owner
 * @param now - Canonical observation time used for prepared evidence freshness
 * @returns One current state consumed by public inspection and write validation
 */
export async function inspectVaultGitActivationState(
	store: VaultGitReceiptStore,
	now: string,
): Promise<VaultGitActivationState> {
	let evidence: VaultGitPreparedEvidenceV2 | null;
	try {
		evidence = await store.readPreparedEvidence();
	} catch {
		return { status: "unavailable" };
	}
	if (evidence === null) return { status: "unprepared" };
	let activation: Awaited<ReturnType<VaultGitReceiptStore["readActivation"]>>;
	let invalidation: Awaited<
		ReturnType<VaultGitReceiptStore["readActivationInvalidation"]>
	>;
	let revocation: Awaited<
		ReturnType<VaultGitReceiptStore["readActivationRevocation"]>
	>;
	try {
		[activation, invalidation, revocation] = await Promise.all([
			readCurrentActivation(store),
			store.readActivationInvalidation(evidence.evidenceId),
			store.readActivationRevocation(evidence.evidenceId),
		]);
	} catch {
		return { status: "unavailable" };
	}
	if (revocation?.evidenceId === evidence.evidenceId) {
		return { status: "revoked", evidence };
	}
	if (invalidation?.evidenceId === evidence.evidenceId) {
		return { status: "invalidated", evidence };
	}
	if (activation?.evidenceId === evidence.evidenceId) {
		return { status: "activated", evidence };
	}
	const projected = evaluateVaultGitPreparedEvidence(evidence, now);
	return { status: projected.status, evidence };
}

async function readCurrentActivation(store: VaultGitReceiptStore) {
	try {
		return await store.readActivation();
	} catch (error) {
		if (error instanceof VaultGitLegacyActivationRecordError) return null;
		throw error;
	}
}

/**
 * Create the sole deterministic authority for activation state changes.
 *
 * @param options - Private store, human capability validator, live inspector, clock
 * @returns Human-only admission and revocation plus fail-closed validation
 */
export function createVaultGitActivationAuthority(
	options: VaultGitActivationAuthorityOptions,
): VaultGitActivationAuthority {
	return {
		admit: (request) =>
			runAuthorityOperation(() => admitAuthorized(options, request)),
		validate: (scope = "admission") =>
			runAuthorityOperation(() => validateAuthorized(options, scope)),
		revoke: (request) =>
			runAuthorityOperation(() => revokeAuthorized(options, request)),
	};
}

async function revokeAuthorized(
	options: VaultGitActivationAuthorityOptions,
	request: VaultGitActivationRevocationRequest,
): Promise<VaultGitActivationAuthorityResult> {
	await assertHumanCapability(options, request.humanCapability);
	const activation = await requireActivation(options.store);
	if (activation.evidenceId !== request.evidenceId) {
		throw new AuthorityDenial("evidence_changed");
	}
	await options.store.recordActivationRevocation({
		schemaVersion: 1,
		evidenceId: activation.evidenceId,
		revokedAt: options.clock(),
		note: request.note,
	});
	return { status: "revoked", evidenceId: activation.evidenceId };
}

async function admitAuthorized(
	options: VaultGitActivationAuthorityOptions,
	request: VaultGitActivationAdmissionRequest,
): Promise<VaultGitActivationAuthorityResult> {
	await assertHumanCapability(options, request.humanCapability);
	const evidence = await requirePreparedEvidence(
		options.store,
		request.evidenceId,
	);
	await assertNoActiveMarker(options.store, evidence.evidenceId);
	await revalidateEvidence(options, evidence);
	await options.store.admitActivation({
		schemaVersion: 2,
		evidenceId: evidence.evidenceId,
		admittedAt: options.clock(),
		note: request.note,
	});
	await assertNoActiveMarker(options.store, evidence.evidenceId);
	await assertCurrentActivation(options.store, evidence.evidenceId);
	return admitted(evidence.evidenceId);
}

async function validateAuthorized(
	options: VaultGitActivationAuthorityOptions,
	scope: VaultGitActivationValidationScope,
): Promise<VaultGitActivationAuthorityResult> {
	const current = await inspectVaultGitActivationState(
		options.store,
		options.clock(),
	);
	if (current.status === "unavailable") {
		throw new AuthorityDenial("revalidation_unavailable");
	}
	if (current.status === "unprepared" || current.status === "stale") {
		throw new AuthorityDenial("evidence_changed");
	}
	if (current.status === "prepared") {
		throw new AuthorityDenial("admission_missing");
	}
	if (current.status === "invalidated" || current.status === "revoked") {
		throw new AuthorityDenial(current.status);
	}
	const evidence = current.evidence;
	await revalidateEvidence(options, evidence, scope);
	await assertNoActiveMarker(options.store, evidence.evidenceId);
	await assertCurrentActivation(options.store, evidence.evidenceId);
	return admitted(evidence.evidenceId);
}

async function runAuthorityOperation(
	operation: () => Promise<VaultGitActivationAuthorityResult>,
): Promise<VaultGitActivationAuthorityResult> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof AuthorityDenial) {
			return denied(error.reason, error.binding);
		}
		throw error;
	}
}

class AuthorityDenial extends Error {
	constructor(
		readonly reason: Extract<
			VaultGitActivationAuthorityResult,
			{ status: "denied" }
		>["reason"],
		readonly binding?: VaultGitActivationBinding,
	) {
		super(reason);
	}
}

async function assertHumanCapability(
	options: VaultGitActivationAuthorityOptions,
	candidate: Uint8Array,
): Promise<void> {
	if (!(await options.validateHumanCapability(candidate))) {
		throw new AuthorityDenial("human_capability_required");
	}
}

async function requireActivation(store: VaultGitReceiptStore) {
	let activation: Awaited<ReturnType<VaultGitReceiptStore["readActivation"]>>;
	try {
		activation = await store.readActivation();
	} catch (error) {
		if (error instanceof VaultGitLegacyActivationRecordError) {
			throw new AuthorityDenial("evidence_changed");
		}
		throw new AuthorityDenial("revalidation_unavailable");
	}
	if (activation === null) throw new AuthorityDenial("admission_missing");
	return activation;
}

async function requirePreparedEvidence(
	store: VaultGitReceiptStore,
	evidenceId: string,
): Promise<VaultGitPreparedEvidenceV2> {
	const evidence = await matchingPreparedEvidence(store, evidenceId);
	if (evidence === null) throw new AuthorityDenial("evidence_changed");
	return evidence;
}

async function assertNoActiveMarker(
	store: VaultGitReceiptStore,
	evidenceId: string,
): Promise<void> {
	const marker = await activeMarker(store, evidenceId);
	if (marker !== null) throw new AuthorityDenial(marker);
}

async function assertCurrentActivation(
	store: VaultGitReceiptStore,
	evidenceId: string,
): Promise<void> {
	const activation = await requireActivation(store);
	if (activation.evidenceId !== evidenceId) {
		throw new AuthorityDenial("evidence_changed");
	}
	await requirePreparedEvidence(store, evidenceId);
}

async function matchingPreparedEvidence(
	store: VaultGitReceiptStore,
	evidenceId: string,
): Promise<VaultGitPreparedEvidenceV2 | null> {
	let evidence: VaultGitPreparedEvidenceV2 | null;
	try {
		evidence = await store.readPreparedEvidence();
	} catch {
		throw new AuthorityDenial("revalidation_unavailable");
	}
	return evidence?.evidenceId === evidenceId ? evidence : null;
}

async function revalidateEvidence(
	options: VaultGitActivationAuthorityOptions,
	evidence: VaultGitPreparedEvidenceV2,
	scope: VaultGitActivationValidationScope = "admission",
): Promise<void> {
	let live: VaultGitLiveActivationBindings;
	try {
		live = await options.revalidate();
	} catch {
		throw new AuthorityDenial("revalidation_unavailable");
	}
	const expected =
		scope === "continuation"
			? await expectedContinuationBindings(options.store, evidence)
			: evidence;
	const binding = changedBinding(expected, live);
	if (binding === null) return;
	await options.store.recordActivationInvalidation({
		schemaVersion: 1,
		evidenceId: evidence.evidenceId,
		binding,
		invalidatedAt: options.clock(),
	});
	throw new AuthorityDenial("binding_changed", binding);
}

function changedBinding(
	evidence: VaultGitPreparedEvidenceV2,
	live: VaultGitLiveActivationBindings,
): VaultGitActivationBinding | null {
	const scalar = SCALAR_BINDINGS.find(
		(binding) => evidence[binding] !== live[binding],
	);
	if (scalar !== undefined) return scalar;
	return sameCheckerClosure(evidence.checkerClosure, live.checkerClosure)
		? null
		: "checkerClosure";
}

async function expectedContinuationBindings(
	store: VaultGitReceiptStore,
	evidence: VaultGitPreparedEvidenceV2,
): Promise<VaultGitPreparedEvidenceV2> {
	let loaded: Awaited<ReturnType<VaultGitReceiptStore["load"]>>;
	try {
		loaded = await store.load();
	} catch {
		throw new AuthorityDenial("revalidation_unavailable");
	}
	if (loaded.status === "absent") return evidence;
	if (loaded.status !== "loaded") {
		throw new AuthorityDenial("revalidation_unavailable");
	}
	// A fresh human-reviewed activation deliberately establishes a new safe
	// baseline after the documented activation-blocked fallback. Any older
	// receipt remains transaction and repair evidence, but is not authority to
	// override that newer approval. Receipts created at or after the evidence
	// remain authoritative so an in-flight transaction still fences continuation.
	if (recordedBefore(loaded.receipt.recordedAt, evidence.capturedAt)) {
		return evidence;
	}
	const mutable = expectedReceiptBindings(loaded.receipt);
	return { ...evidence, ...mutable };
}

function recordedBefore(left: string, right: string): boolean {
	const leftMs = Date.parse(left);
	const rightMs = Date.parse(right);
	if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
		throw new AuthorityDenial("revalidation_unavailable");
	}
	return leftMs < rightMs;
}

function expectedReceiptBindings(receipt: VaultGitReceipt): Pick<
	VaultGitPreparedEvidenceV2,
	"localMainHead" | "remoteMainHead" | "ledgerGeneration"
> {
	if (receipt.phase === "closed") {
		if (
			!receipt.expectedMainCommit ||
			!receipt.ledgerReleaseId ||
			receipt.pushOutcome !== "closed"
		) {
			throw new AuthorityDenial("revalidation_unavailable");
		}
		return {
			localMainHead: receipt.expectedMainCommit,
			remoteMainHead: receipt.expectedMainCommit,
			ledgerGeneration: receipt.ledgerReleaseId,
		};
	}
	if (receipt.phase === "human_required") {
		throw new AuthorityDenial("revalidation_unavailable");
	}
	const ledgerGeneration =
		receipt.transactionId === null
			? receipt.expectedLeaseGeneration
			: receipt.leaseGeneration;
	if (!ledgerGeneration) {
		throw new AuthorityDenial("revalidation_unavailable");
	}
	const localMainHead =
		receipt.phase === "push_pending" && receipt.expectedMainCommit
			? receipt.expectedMainCommit
			: receipt.localMainHead;
	return {
		localMainHead,
		remoteMainHead: receipt.remoteMainHead,
		ledgerGeneration,
	};
}

function sameCheckerClosure(
	left: VaultGitPreparedCheckerClosure,
	right: VaultGitPreparedCheckerClosure,
): boolean {
	return [
		left.entrypointHash === right.entrypointHash,
		left.dependencyBundleHash === right.dependencyBundleHash,
	].every(Boolean);
}

async function activeMarker(
	store: VaultGitReceiptStore,
	evidenceId: string,
): Promise<"invalidated" | "revoked" | null> {
	let invalidation: Awaited<
		ReturnType<VaultGitReceiptStore["readActivationInvalidation"]>
	>;
	let revocation: Awaited<
		ReturnType<VaultGitReceiptStore["readActivationRevocation"]>
	>;
	try {
		[invalidation, revocation] = await Promise.all([
			store.readActivationInvalidation(evidenceId),
			store.readActivationRevocation(evidenceId),
		]);
	} catch {
		throw new AuthorityDenial("revalidation_unavailable");
	}
	return (
		matchingMarker(revocation, evidenceId, "revoked") ??
		matchingMarker(invalidation, evidenceId, "invalidated")
	);
}

function matchingMarker(
	record: { readonly evidenceId: string } | null,
	evidenceId: string,
	marker: "invalidated" | "revoked",
): "invalidated" | "revoked" | null {
	return record?.evidenceId === evidenceId ? marker : null;
}

function admitted(evidenceId: string): VaultGitActivationAuthorityResult {
	return { status: "admitted", evidenceId };
}

function denied(
	reason: Extract<VaultGitActivationAuthorityResult, { status: "denied" }>[
		"reason"
	],
	binding?: VaultGitActivationBinding,
): VaultGitActivationAuthorityResult {
	return binding === undefined
		? { status: "denied", reason }
		: { status: "denied", reason, binding };
}
