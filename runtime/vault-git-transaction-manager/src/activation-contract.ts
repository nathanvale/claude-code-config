import { createHash, timingSafeEqual } from "node:crypto";

import { EVIDENCE_ID, type VaultGitNextAction } from "./model.ts";
import { projectVaultGitNextAction } from "./next-safe-action.ts";

/** Private prepared-evidence contract identifier. */
export const VAULT_GIT_PREPARED_EVIDENCE_CONTRACT_ID =
	"vault-git.prepared-evidence" as const;

/** Public activation-result contract identifier. */
export const VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID =
	"vault-git.activation-result" as const;

/** Public activation-result schema version. */
export const VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION = "3" as const;

/** Display-only freshness window for prepared evidence. */
export const VAULT_GIT_PREPARED_DISPLAY_FRESHNESS_MS = 10 * 60 * 1_000;

/** Exact V2 binding used before the remote ledger has its first generation. */
export const VAULT_GIT_ABSENT_LEDGER_GENERATION = "0".repeat(40);

const PREPARED_EVIDENCE_DIGEST_DOMAIN = "vault-git.prepared-evidence.v2";
const OPAQUE_IDENTITY = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*:v[1-9]\d*:[0-9a-f]{64}$/;
/** Exact git object-id shape: 40-hex sha1 or 64-hex sha256, nothing between. */
export const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256 = /^[0-9a-f]{64}$/;
/**
 * Prepared-evidence identifier shape shared by the store validators. Owned by the
 * model leaf so the Next Safe Action projector can reference it without a cycle;
 * re-exported here to keep this module's public surface stable.
 */
export { EVIDENCE_ID } from "./model.ts";

/** Exact pinned checker closure captured by one preparation. */
export interface VaultGitPreparedCheckerClosure {
	/** SHA-256 of the admitted checker entrypoint. */
	readonly entrypointHash: string;
	/** SHA-256 of the checker dependency bundle. */
	readonly dependencyBundleHash: string;
}

/** Required owner-controlled and authoritative bindings for V2 evidence. */
export interface VaultGitPreparedEvidenceInput {
	/** Derived identity of the exact configured vault checkout. */
	readonly repositoryIdentity: string;
	/** Derived identity of the configured remote endpoint. */
	readonly remoteIdentity: string;
	/** Derived identity of the preparing host. */
	readonly hostIdentity: string;
	/** Derived identity of the pinned runtime. */
	readonly runtimeIdentity: string;
	/** Derived identity of the executing Vault Git program. */
	readonly executableIdentity: string;
	/** Derived identity of the owner-private state root. */
	readonly privateStateIdentity: string;
	/** Exact local main object id inspected during preparation. */
	readonly localMainHead: string;
	/** Exact remote main object id inspected during preparation. */
	readonly remoteMainHead: string;
	/** Exact remote ledger generation inspected during preparation. */
	readonly ledgerGeneration: string;
	/** Derived identity of the admitted Git execution closure. */
	readonly gitIdentity: string;
	/** Derived identity of the admitted SSH execution closure. */
	readonly sshIdentity: string;
	/** Exact checker entrypoint and dependency closure. */
	readonly checkerClosure: VaultGitPreparedCheckerClosure;
	/** Monotonic generation of the preparing job on this vault and host. */
	readonly jobGeneration: number;
	/** Canonical ISO timestamp when all bindings were captured. */
	readonly capturedAt: string;
}

/** Immutable V2 prepared evidence. It carries no write authority. */
export interface VaultGitPreparedEvidenceV2
	extends VaultGitPreparedEvidenceInput {
	/** Stable private evidence contract. */
	readonly contractId: typeof VAULT_GIT_PREPARED_EVIDENCE_CONTRACT_ID;
	/** Prepared evidence schema. V1 is never accepted or upgraded. */
	readonly schemaVersion: 2;
	/** Mechanical authority classification. */
	readonly authority: "evidence_only";
	/** Content-addressed identifier covering every evidence binding. */
	readonly evidenceId: string;
}

/** Sanitized prepared or stale projection for activation consumers. */
export interface VaultGitPreparedActivationResultV3 {
	/** Stable public result contract. */
	readonly contract_id: typeof VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID;
	/** Public result schema. */
	readonly schema_version: typeof VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION;
	/** Display freshness only. Neither value grants authority. */
	readonly status: "prepared" | "stale";
	/** Mechanical authority classification. */
	readonly authority: "evidence_only";
	/** Prepared evidence never admits a write. */
	readonly write_permission: "denied";
	/** Projection is read-only. */
	readonly changed_state: "none";
	/** Opaque evidence correlation safe for public surfaces. */
	readonly evidence_reference: string;
	/** Evidence capture time. */
	readonly captured_at: string;
	/** Exact instant when display freshness expires. */
	readonly display_fresh_until: string;
	/** One safe continuation as the authoritative Next Safe Action union. */
	readonly next_action: VaultGitNextAction;
}

/** Sanitized fail-closed projection for legacy, unknown, or tampered evidence. */
export interface VaultGitInvalidPreparedActivationResultV3 {
	readonly contract_id: typeof VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID;
	readonly schema_version: typeof VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION;
	readonly status: "invalidated";
	readonly authority: "none";
	readonly write_permission: "denied";
	readonly changed_state: "none";
	readonly evidence_reference: null;
	readonly captured_at: null;
	readonly display_fresh_until: null;
	/** One safe continuation as the authoritative Next Safe Action union. */
	readonly next_action: VaultGitNextAction;
}

/** Public prepared-evidence activation-result variants. */
export type VaultGitPreparedEvidenceActivationResultV3 =
	| VaultGitPreparedActivationResultV3
	| VaultGitInvalidPreparedActivationResultV3;

/**
 * Create immutable V2 prepared evidence from exact captured bindings.
 *
 * @param input - Complete prepared-evidence bindings
 * @returns Deep-frozen content-addressed evidence with no admission capability
 */
export function createVaultGitPreparedEvidence(
	input: VaultGitPreparedEvidenceInput,
): VaultGitPreparedEvidenceV2 {
	return parseVaultGitPreparedEvidence({
		contractId: VAULT_GIT_PREPARED_EVIDENCE_CONTRACT_ID,
		schemaVersion: 2,
		authority: "evidence_only",
		evidenceId: derivePreparedEvidenceId(input),
		...input,
		checkerClosure: { ...input.checkerClosure },
	});
}

/**
 * Parse untrusted private JSON as exact, untampered V2 prepared evidence.
 *
 * @param value - Untrusted decoded JSON
 * @returns Deep-frozen validated V2 evidence
 * @throws {Error} For V1, unknown, missing, malformed, extra, or tampered data
 */
export function parseVaultGitPreparedEvidence(
	value: unknown,
): VaultGitPreparedEvidenceV2 {
	if (!isPreparedEvidenceShape(value)) {
		throw new Error("prepared evidence invalid");
	}
	const expectedId = derivePreparedEvidenceId(value);
	if (!sameText(expectedId, value.evidenceId)) {
		throw new Error("prepared evidence invalid");
	}
	const checkerClosure = Object.freeze({ ...value.checkerClosure });
	return Object.freeze({ ...value, checkerClosure });
}

/**
 * Evaluate untrusted evidence without upgrading or exposing invalid input.
 *
 * @param value - Untrusted decoded evidence, including possible V1 records
 * @param now - Canonical ISO observation time
 * @returns Sanitized prepared, stale, or invalidated activation result
 */
export function evaluateVaultGitPreparedEvidence(
	value: unknown,
	now: string,
): VaultGitPreparedEvidenceActivationResultV3 {
	isoTime(now);
	try {
		return projectVaultGitPreparedActivationResult(
			parseVaultGitPreparedEvidence(value),
			now,
		);
	} catch (error) {
		// Sanitize the expected validation failures for untrusted or clock-skewed
		// input into an invalidated result; propagate anything unexpected. A
		// capturedAt ahead of the observer must fail closed, not crash the reader.
		if (
			!(error instanceof Error) ||
			(error.message !== "prepared evidence invalid" &&
				error.message !== "activation result time invalid")
		) {
			throw error;
		}
		return invalidPreparedEvidenceResult();
	}
}

/**
 * Project evidence into the sanitized activation-result contract.
 *
 * @param evidence - Exact prepared evidence
 * @param now - Canonical ISO observation time
 * @returns Public fresh or stale evidence result with denied write permission
 */
export function projectVaultGitPreparedActivationResult(
	evidence: VaultGitPreparedEvidenceV2,
	now: string,
): VaultGitPreparedActivationResultV3 {
	const parsed = parseVaultGitPreparedEvidence(evidence);
	const observedAt = isoTime(now);
	const capturedAt = isoTime(parsed.capturedAt);
	if (observedAt < capturedAt) {
		throw new Error("activation result time invalid");
	}
	const freshUntil = capturedAt + VAULT_GIT_PREPARED_DISPLAY_FRESHNESS_MS;
	const fresh = observedAt < freshUntil;
	return Object.freeze({
		contract_id: VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
		schema_version: VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
		status: fresh ? "prepared" : "stale",
		authority: "evidence_only",
		write_permission: "denied",
		changed_state: "none",
		evidence_reference: parsed.evidenceId,
		captured_at: parsed.capturedAt,
		display_fresh_until: new Date(freshUntil).toISOString(),
		next_action: Object.freeze(
			fresh
				? projectVaultGitNextAction({
						id: "review_prepared",
						summary:
							"Review the prepared evidence without granting write permission.",
						selectors: { evidence_reference: parsed.evidenceId },
					})
				: projectVaultGitNextAction({
						id: "prepare_fresh",
						summary: "Prepare fresh evidence before human review.",
					}),
		),
	});
}

function derivePreparedEvidenceId(input: VaultGitPreparedEvidenceInput): string {
	const payload = [
		["repositoryIdentity", input.repositoryIdentity],
		["remoteIdentity", input.remoteIdentity],
		["hostIdentity", input.hostIdentity],
		["runtimeIdentity", input.runtimeIdentity],
		["executableIdentity", input.executableIdentity],
		["privateStateIdentity", input.privateStateIdentity],
		["localMainHead", input.localMainHead],
		["remoteMainHead", input.remoteMainHead],
		["ledgerGeneration", input.ledgerGeneration],
		["gitIdentity", input.gitIdentity],
		["sshIdentity", input.sshIdentity],
		["checkerEntrypointHash", input.checkerClosure.entrypointHash],
		["checkerDependencyBundleHash", input.checkerClosure.dependencyBundleHash],
		["jobGeneration", input.jobGeneration],
		["capturedAt", input.capturedAt],
	] as const;
	const digest = createHash("sha256")
		.update(PREPARED_EVIDENCE_DIGEST_DOMAIN)
		.update("\0")
		.update(JSON.stringify(payload))
		.digest("hex");
	return `vault-git:prepared:v2:${digest}`;
}

function invalidPreparedEvidenceResult(): VaultGitInvalidPreparedActivationResultV3 {
	return Object.freeze({
		contract_id: VAULT_GIT_ACTIVATION_RESULT_CONTRACT_ID,
		schema_version: VAULT_GIT_ACTIVATION_RESULT_SCHEMA_VERSION,
		status: "invalidated",
		authority: "none",
		write_permission: "denied",
		changed_state: "none",
		evidence_reference: null,
		captured_at: null,
		display_fresh_until: null,
		next_action: Object.freeze(
			projectVaultGitNextAction({
				id: "prepare_fresh",
				summary: "Prepare fresh V2 evidence before human review.",
			}),
		),
	});
}

function isPreparedEvidenceShape(
	value: unknown,
): value is VaultGitPreparedEvidenceV2 {
	const record = toRecord(value);
	if (record === null) return false;
	return [
		hasPreparedEvidenceKeys(record),
		hasPreparedEvidenceHeader(record),
		hasPreparedIdentityBindings(record),
		hasPreparedStateBindings(record),
		isCheckerClosure(record.checkerClosure),
		hasPreparedJobBinding(record),
	].every(Boolean);
}

function hasPreparedEvidenceKeys(value: Record<string, unknown>): boolean {
	return hasExactKeys(value, [
		"contractId",
		"schemaVersion",
		"authority",
		"evidenceId",
		"repositoryIdentity",
		"remoteIdentity",
		"hostIdentity",
		"runtimeIdentity",
		"executableIdentity",
		"privateStateIdentity",
		"localMainHead",
		"remoteMainHead",
		"ledgerGeneration",
		"gitIdentity",
		"sshIdentity",
		"checkerClosure",
		"jobGeneration",
		"capturedAt",
	]);
}

function hasPreparedEvidenceHeader(value: Record<string, unknown>): boolean {
	return (
		value.contractId === VAULT_GIT_PREPARED_EVIDENCE_CONTRACT_ID &&
		value.schemaVersion === 2 &&
		value.authority === "evidence_only" &&
		isMatching(value.evidenceId, EVIDENCE_ID)
	);
}

function hasPreparedIdentityBindings(value: Record<string, unknown>): boolean {
	return [
		value.repositoryIdentity,
		value.remoteIdentity,
		value.hostIdentity,
		value.runtimeIdentity,
		value.executableIdentity,
		value.privateStateIdentity,
		value.gitIdentity,
		value.sshIdentity,
	].every((candidate) => isMatching(candidate, OPAQUE_IDENTITY));
}

function hasPreparedStateBindings(value: Record<string, unknown>): boolean {
	return [
		value.localMainHead,
		value.remoteMainHead,
		value.ledgerGeneration,
	].every((candidate) => isMatching(candidate, GIT_OBJECT_ID));
}

function hasPreparedJobBinding(value: Record<string, unknown>): boolean {
	return (
		Number.isSafeInteger(value.jobGeneration) &&
		(value.jobGeneration as number) > 0 &&
		isIso(value.capturedAt)
	);
}

function isCheckerClosure(
	value: unknown,
): value is VaultGitPreparedCheckerClosure {
	const record = toRecord(value);
	if (record === null) return false;
	return (
		hasExactKeys(record, ["entrypointHash", "dependencyBundleHash"]) &&
		isMatching(record.entrypointHash, SHA256) &&
		isMatching(record.dependencyBundleHash, SHA256)
	);
}

function toRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function hasExactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	const actual = Object.keys(value);
	return (
		actual.length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}

function isMatching(value: unknown, pattern: RegExp): value is string {
	return typeof value === "string" && pattern.test(value);
}

function isIso(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const time = Date.parse(value);
	return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isoTime(value: string): number {
	if (!isIso(value)) throw new Error("activation result time invalid");
	return Date.parse(value);
}

function sameText(left: string, right: string): boolean {
	const leftBytes = Buffer.from(left);
	const rightBytes = Buffer.from(right);
	return (
		leftBytes.length === rightBytes.length &&
		timingSafeEqual(leftBytes, rightBytes)
	);
}
