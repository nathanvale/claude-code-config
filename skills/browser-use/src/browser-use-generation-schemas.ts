// ---------------------------------------------------------------------------
// Corpus Generation schema family.
//
// Owns generation payload types and their pure validators. The generic durable
// record envelope and validator registry remain in browser-use-schemas.ts.
// ---------------------------------------------------------------------------

import { isJsonObject, stringField } from "./browser-use-core";

/** Immutable corpus generation record (R29 substrate; activation lands in U3). */
export type BrowserUseGenerationPayload = {
	generation_id: string;
	/** sha256 over sorted (relPath, fileHash) pairs. */
	content_hash: string;
	status: "staged" | "active" | "retired";
	staged_at_epoch_ms: number;
};

/** Candidate target state carried by one complete corpus generation. */
export const BROWSER_USE_CORPUS_TARGET_ACTIVATIONS = [
	"active",
	"inactive",
] as const;

/** Candidate target state: executable closure or definition-only closure. */
export type BrowserUseCorpusTargetActivation =
	(typeof BROWSER_USE_CORPUS_TARGET_ACTIVATIONS)[number];

/** One canonical runbook and its complete source/proof lineage. */
export type BrowserUseCorpusGenerationTarget = {
	canonical_target_id: string;
	activation: BrowserUseCorpusTargetActivation;
	runbook_path: string;
	runbook_digest: string;
	source_relative_paths: readonly string[];
	proof_refs: readonly string[];
	inactive_reason: string | null;
};

/** One reviewed action record and its content-addressed asset inside a generation. */
export type BrowserUseCorpusGenerationActionRef = {
	action_id: string;
	record_path: string;
	record_digest: string;
	asset_path: string;
	asset_digest: string;
};

/** One redacted auth import candidate inside a generation. */
export type BrowserUseCorpusGenerationAuthCandidateRef = {
	candidate_id: string;
	path: string;
	digest: string;
};

/** One live auth route proving an active runbook context can enter auth. */
export type BrowserUseCorpusGenerationAuthRouteRef = {
	auth_context_ref: string;
	candidate_id: string;
	path: string;
	digest: string;
};

/** Exact active route record stored inside one immutable generation. */
export type BrowserUseGenerationAuthRouteRecord = {
	auth_context_ref: string;
	candidate_id: string;
	status: "active";
};

/** Parse one route record without accepting extension keys or inactive aliases. */
export function parseGenerationAuthRouteRecord(
	value: unknown,
): BrowserUseGenerationAuthRouteRecord | undefined {
	if (!isJsonObject(value)) return undefined;
	if (
		Object.keys(value).length !== 3 ||
		typeof value.auth_context_ref !== "string" ||
		value.auth_context_ref.length === 0 ||
		typeof value.candidate_id !== "string" ||
		value.candidate_id.length === 0 ||
		value.status !== "active"
	) {
		return undefined;
	}
	return {
		auth_context_ref: value.auth_context_ref,
		candidate_id: value.candidate_id,
		status: "active",
	};
}

/** One proof artifact bound by name and exact bytes. */
export type BrowserUseCorpusGenerationProofRef = {
	proof_ref: string;
	path: string;
	digest: string;
};

/** One safe legacy text artifact retained inside the active generation. */
export type BrowserUseCorpusGenerationKnowledgeRef = {
	source_relative_path: string;
	path: string;
	digest: string;
};

/**
 * Complete candidate manifest stored inside an immutable generation.
 *
 * The candidate binds every authority-bearing file while activation metadata
 * stays outside the tree, avoiding a self-referential generation digest.
 */
export type BrowserUseCorpusGenerationCandidatePayload = {
	contract: "browser-use.corpus-generation-candidate";
	schema_version: "1";
	generation_id: string;
	source_snapshot: {
		snapshot_id: string;
		snapshot_digest: string;
	};
	canonical_targets: readonly BrowserUseCorpusGenerationTarget[];
	action_registry: {
		registry_path: string;
		registry_digest: string;
		actions: readonly BrowserUseCorpusGenerationActionRef[];
	};
	auth: {
		candidates: readonly BrowserUseCorpusGenerationAuthCandidateRef[];
		routes: readonly BrowserUseCorpusGenerationAuthRouteRef[];
	};
	proofs: readonly BrowserUseCorpusGenerationProofRef[];
	/** Safe staged knowledge retained alongside executable catalog authority. */
	knowledge?: {
		files: readonly BrowserUseCorpusGenerationKnowledgeRef[];
	};
	shipped_catalog_digest: string;
};

/**
 * One activation identity retained for pinned-run resume and rollback proof.
 *
 * Both immutable digests plus the historical epoch are required. A generation
 * id alone cannot distinguish which activation a run was fenced under.
 */
export type BrowserUseCorpusGenerationIdentity = {
	generation_id: string;
	generation_content_hash: string;
	candidate_manifest_digest: string;
	activation_epoch: number;
};

/**
 * Authoritative active Corpus Generation Manifest.
 *
 * This record is the activation commit point. Readers ignore pending records
 * and resolve current authority only through this payload.
 */
export type BrowserUseCorpusGenerationManifestPayload = Omit<
	BrowserUseCorpusGenerationCandidatePayload,
	"contract"
> & {
	contract: "browser-use.corpus-generation-manifest";
	generation_content_hash: string;
	candidate_manifest_digest: string;
	activation_epoch: number;
	activated_at_epoch_ms: number;
	prior_generation: BrowserUseCorpusGenerationIdentity | null;
	retained_generations: readonly BrowserUseCorpusGenerationIdentity[];
};

/** Durable events that permanently close the pre-effect rollback window. */
export const BROWSER_USE_GENERATION_EFFECT_KINDS = [
	"generation-run",
	"checkpoint",
	"artifact",
	"auth-record",
	"external-dispatch",
] as const;

/** Event kind recorded by the monotonic generation-effect fence. */
export type BrowserUseGenerationEffectKind =
	(typeof BROWSER_USE_GENERATION_EFFECT_KINDS)[number];

/**
 * Monotonic effect fence for one activation epoch.
 *
 * Activation writes `untripped` before the active manifest commit. The first
 * generation-derived durable effect changes it to `tripped`; later calls keep
 * the first effect and can never restore `untripped`.
 */
export type BrowserUseGenerationEffectFencePayload = {
	generation_id: string;
	activation_epoch: number;
	state: "untripped" | "tripped";
	tripped_at_epoch_ms: number | null;
	first_effect: {
		effect_kind: BrowserUseGenerationEffectKind;
		effect_ref: string;
	} | null;
};

/**
 * Durable target claim written before activation-epoch advance.
 *
 * If a crash leaves epoch `expected_epoch + 1` without a new active manifest,
 * only this exact target may resume the interrupted activation.
 */
export type BrowserUseActivationPendingPayload = {
	expected_epoch: number;
	target_generation_id: string;
	generation_content_hash: string;
	candidate_manifest_digest: string;
};

const GENERATION_STATUSES = ["staged", "active", "retired"] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Validate an immutable generation payload.
 *
 * @param value - Unknown durable payload
 * @returns The first redaction-safe problem, or undefined
 * @internal
 */
export function generationProblem(value: unknown): string | undefined {
	if (!isJsonObject(value)) return "generation payload must be a JSON object.";
	if (stringField(value.generation_id) === undefined) {
		return "payload.generation_id must be a non-empty string.";
	}
	if (stringField(value.content_hash) === undefined) {
		return "payload.content_hash must be a non-empty string.";
	}
	if (!(GENERATION_STATUSES as readonly unknown[]).includes(value.status)) {
		return "payload.status must be staged, active, or retired.";
	}
	if (!isNonNegativeNumber(value.staged_at_epoch_ms)) {
		return "payload.staged_at_epoch_ms must be a non-negative number.";
	}
	return undefined;
}

function digestProblem(value: unknown, field: string): string | undefined {
	return typeof value === "string" && SHA256_HEX.test(value)
		? undefined
		: `${field} must be a lowercase 64-hex sha256 digest.`;
}

function corpusTargetProblem(value: unknown, index: number): string | undefined {
	const at = `payload.canonical_targets.${index}`;
	if (!isJsonObject(value)) return `${at} must be a JSON object.`;
	if (stringField(value.canonical_target_id) === undefined) {
		return `${at}.canonical_target_id must be a non-empty string.`;
	}
	if (
		!(BROWSER_USE_CORPUS_TARGET_ACTIVATIONS as readonly unknown[]).includes(
			value.activation,
		)
	) {
		return `${at}.activation must be active or inactive.`;
	}
	if (stringField(value.runbook_path) === undefined) {
		return `${at}.runbook_path must be a non-empty string.`;
	}
	const digest = digestProblem(value.runbook_digest, `${at}.runbook_digest`);
	if (digest !== undefined) return digest;
	if (
		!Array.isArray(value.source_relative_paths) ||
		value.source_relative_paths.length === 0 ||
		!value.source_relative_paths.every(
			(path) => stringField(path) !== undefined,
		)
	) {
		return `${at}.source_relative_paths must be a non-empty string array.`;
	}
	if (
		!Array.isArray(value.proof_refs) ||
		!value.proof_refs.every((proof) => stringField(proof) !== undefined)
	) {
		return `${at}.proof_refs must be a string array.`;
	}
	if (
		value.inactive_reason !== null &&
		stringField(value.inactive_reason) === undefined
	) {
		return `${at}.inactive_reason must be null or a non-empty string.`;
	}
	if (value.activation === "active" && value.inactive_reason !== null) {
		return `${at}.inactive_reason must be null for an active target.`;
	}
	if (
		value.activation === "inactive" &&
		stringField(value.inactive_reason) === undefined
	) {
		return `${at}.inactive_reason is required for an inactive target.`;
	}
	return undefined;
}

function generationActionRefProblem(
	value: unknown,
	index: number,
): string | undefined {
	const at = `payload.action_registry.actions.${index}`;
	if (!isJsonObject(value)) return `${at} must be a JSON object.`;
	for (const field of ["action_id", "record_path", "asset_path"] as const) {
		if (stringField(value[field]) === undefined) {
			return `${at}.${field} must be a non-empty string.`;
		}
	}
	return (
		digestProblem(value.record_digest, `${at}.record_digest`) ??
		digestProblem(value.asset_digest, `${at}.asset_digest`)
	);
}

function generationAuthCandidateRefProblem(
	value: unknown,
	index: number,
): string | undefined {
	const at = `payload.auth.candidates.${index}`;
	if (!isJsonObject(value)) return `${at} must be a JSON object.`;
	for (const field of ["candidate_id", "path"] as const) {
		if (stringField(value[field]) === undefined) {
			return `${at}.${field} must be a non-empty string.`;
		}
	}
	return digestProblem(value.digest, `${at}.digest`);
}

function generationAuthRouteRefProblem(
	value: unknown,
	index: number,
): string | undefined {
	const at = `payload.auth.routes.${index}`;
	if (!isJsonObject(value)) return `${at} must be a JSON object.`;
	for (const field of ["auth_context_ref", "candidate_id", "path"] as const) {
		if (stringField(value[field]) === undefined) {
			return `${at}.${field} must be a non-empty string.`;
		}
	}
	return digestProblem(value.digest, `${at}.digest`);
}

function generationProofRefProblem(
	value: unknown,
	index: number,
): string | undefined {
	const at = `payload.proofs.${index}`;
	if (!isJsonObject(value)) return `${at} must be a JSON object.`;
	for (const field of ["proof_ref", "path"] as const) {
		if (stringField(value[field]) === undefined) {
			return `${at}.${field} must be a non-empty string.`;
		}
	}
	return digestProblem(value.digest, `${at}.digest`);
}

function generationKnowledgeRefProblem(
	value: unknown,
	index: number,
): string | undefined {
	const at = `payload.knowledge.files.${index}`;
	if (!isJsonObject(value)) return `${at} must be a JSON object.`;
	for (const field of ["source_relative_path", "path"] as const) {
		if (stringField(value[field]) === undefined) {
			return `${at}.${field} must be a non-empty string.`;
		}
	}
	return digestProblem(value.digest, `${at}.digest`);
}

/**
 * Validate a complete Corpus Generation candidate payload.
 *
 * @param value - Unknown durable payload
 * @returns The first redaction-safe problem, or undefined
 * @internal
 */
export function corpusGenerationCandidateProblem(
	value: unknown,
): string | undefined {
	if (!isJsonObject(value)) {
		return "corpus-generation-candidate payload must be a JSON object.";
	}
	if (
		value.contract !== "browser-use.corpus-generation-candidate" ||
		value.schema_version !== "1"
	) {
		return "payload must carry the corpus-generation-candidate contract and schema version 1.";
	}
	if (stringField(value.generation_id) === undefined) {
		return "payload.generation_id must be a non-empty string.";
	}
	const snapshot = value.source_snapshot;
	if (
		!isJsonObject(snapshot) ||
		stringField(snapshot.snapshot_id) === undefined
	) {
		return "payload.source_snapshot must carry snapshot_id and snapshot_digest.";
	}
	const snapshotDigest = digestProblem(
		snapshot.snapshot_digest,
		"payload.source_snapshot.snapshot_digest",
	);
	if (snapshotDigest !== undefined) return snapshotDigest;
	if (!Array.isArray(value.canonical_targets)) {
		return "payload.canonical_targets must be an array.";
	}
	for (const [index, target] of value.canonical_targets.entries()) {
		const problem = corpusTargetProblem(target, index);
		if (problem !== undefined) return problem;
	}
	const targetIds = value.canonical_targets.map(
		(target) => (target as Record<string, unknown>).canonical_target_id,
	);
	if (new Set(targetIds).size !== targetIds.length) {
		return "payload.canonical_targets must carry unique canonical_target_id values.";
	}
	const registry = value.action_registry;
	if (
		!isJsonObject(registry) ||
		stringField(registry.registry_path) === undefined ||
		!Array.isArray(registry.actions)
	) {
		return "payload.action_registry must carry registry_path, registry_digest, and actions.";
	}
	const registryDigest = digestProblem(
		registry.registry_digest,
		"payload.action_registry.registry_digest",
	);
	if (registryDigest !== undefined) return registryDigest;
	for (const [index, action] of registry.actions.entries()) {
		const problem = generationActionRefProblem(action, index);
		if (problem !== undefined) return problem;
	}
	const actionIds = registry.actions.map(
		(action) => (action as Record<string, unknown>).action_id,
	);
	if (new Set(actionIds).size !== actionIds.length) {
		return "payload.action_registry.actions must carry unique action_id values.";
	}
	const auth = value.auth;
	if (
		!isJsonObject(auth) ||
		!Array.isArray(auth.candidates) ||
		!Array.isArray(auth.routes)
	) {
		return "payload.auth must carry candidates and routes arrays.";
	}
	for (const [index, candidate] of auth.candidates.entries()) {
		const problem = generationAuthCandidateRefProblem(candidate, index);
		if (problem !== undefined) return problem;
	}
	const candidateIds = auth.candidates.map(
		(candidate) => (candidate as Record<string, unknown>).candidate_id,
	);
	if (new Set(candidateIds).size !== candidateIds.length) {
		return "payload.auth.candidates must carry unique candidate_id values.";
	}
	for (const [index, route] of auth.routes.entries()) {
		const problem = generationAuthRouteRefProblem(route, index);
		if (problem !== undefined) return problem;
	}
	const authContextRefs = auth.routes.map(
		(route) => (route as Record<string, unknown>).auth_context_ref,
	);
	if (new Set(authContextRefs).size !== authContextRefs.length) {
		return "payload.auth.routes must carry unique auth_context_ref values.";
	}
	if (
		auth.routes.some(
			(route) =>
				!candidateIds.includes(
					(route as Record<string, unknown>).candidate_id,
				),
		)
	) {
		return "payload.auth.routes must reference declared auth candidates.";
	}
	if (!Array.isArray(value.proofs)) return "payload.proofs must be an array.";
	for (const [index, proof] of value.proofs.entries()) {
		const problem = generationProofRefProblem(proof, index);
		if (problem !== undefined) return problem;
	}
	const proofIds = value.proofs.map(
		(proof) => (proof as Record<string, unknown>).proof_ref,
	);
	if (new Set(proofIds).size !== proofIds.length) {
		return "payload.proofs must carry unique proof_ref values.";
	}
	if (value.knowledge !== undefined) {
		if (
			!isJsonObject(value.knowledge) ||
			!Array.isArray(value.knowledge.files)
		) {
			return "payload.knowledge must carry a files array.";
		}
		for (const [index, file] of value.knowledge.files.entries()) {
			const problem = generationKnowledgeRefProblem(file, index);
			if (problem !== undefined) return problem;
		}
		const knowledgePaths = value.knowledge.files.map(
			(file) => (file as Record<string, unknown>).path,
		);
		const sourcePaths = value.knowledge.files.map(
			(file) => (file as Record<string, unknown>).source_relative_path,
		);
		if (
			new Set(knowledgePaths).size !== knowledgePaths.length ||
			new Set(sourcePaths).size !== sourcePaths.length
		) {
			return "payload.knowledge.files must carry unique source and generation paths.";
		}
	}
	for (const target of value.canonical_targets) {
		const proofRefs = (target as Record<string, unknown>)
			.proof_refs as readonly unknown[];
		if (
			proofRefs.length === 0 ||
			new Set(proofRefs).size !== proofRefs.length ||
			proofRefs.some((proofRef) => !proofIds.includes(proofRef))
		) {
			return "payload.canonical_targets must carry non-empty unique proof_refs from payload.proofs.";
		}
	}
	return digestProblem(
		value.shipped_catalog_digest,
		"payload.shipped_catalog_digest",
	);
}

function corpusGenerationIdentityProblem(
	value: unknown,
	at: string,
): string | undefined {
	if (!isJsonObject(value)) return `${at} must be a JSON object.`;
	if (stringField(value.generation_id) === undefined) {
		return `${at}.generation_id must be a non-empty string.`;
	}
	return (
		digestProblem(
			value.generation_content_hash,
			`${at}.generation_content_hash`,
		) ??
		digestProblem(
			value.candidate_manifest_digest,
			`${at}.candidate_manifest_digest`,
		) ??
		(!isPositiveInteger(value.activation_epoch)
			? `${at}.activation_epoch must be an integer >= 1.`
			: undefined)
	);
}

function corpusGenerationIdentitiesMatch(
	left: BrowserUseCorpusGenerationIdentity,
	right: BrowserUseCorpusGenerationIdentity,
): boolean {
	return (
		left.generation_id === right.generation_id &&
		left.generation_content_hash === right.generation_content_hash &&
		left.candidate_manifest_digest === right.candidate_manifest_digest &&
		left.activation_epoch === right.activation_epoch
	);
}

/**
 * Validate the authoritative active Corpus Generation Manifest payload.
 *
 * @param value - Unknown durable payload
 * @returns The first redaction-safe problem, or undefined
 * @internal
 */
export function corpusGenerationManifestProblem(
	value: unknown,
): string | undefined {
	if (!isJsonObject(value)) {
		return "corpus-generation-manifest payload must be a JSON object.";
	}
	const candidateShape = {
		...value,
		contract: "browser-use.corpus-generation-candidate",
	};
	const candidateProblem = corpusGenerationCandidateProblem(candidateShape);
	if (candidateProblem !== undefined) return candidateProblem;
	if (value.contract !== "browser-use.corpus-generation-manifest") {
		return "payload.contract must be browser-use.corpus-generation-manifest.";
	}
	const identityProblem = corpusGenerationIdentityProblem(value, "payload");
	if (identityProblem !== undefined) return identityProblem;
	if (!isNonNegativeNumber(value.activated_at_epoch_ms)) {
		return "payload.activated_at_epoch_ms must be a non-negative number.";
	}
	if (value.prior_generation !== null) {
		const priorProblem = corpusGenerationIdentityProblem(
			value.prior_generation,
			"payload.prior_generation",
		);
		if (priorProblem !== undefined) return priorProblem;
	}
	if (!Array.isArray(value.retained_generations)) {
		return "payload.retained_generations must be an array.";
	}
	for (const [index, identity] of value.retained_generations.entries()) {
		const retainedProblem = corpusGenerationIdentityProblem(
			identity,
			`payload.retained_generations.${index}`,
		);
		if (retainedProblem !== undefined) return retainedProblem;
	}
	const current = value as BrowserUseCorpusGenerationIdentity;
	const retained =
		value.retained_generations as readonly BrowserUseCorpusGenerationIdentity[];
	if (
		retained.some((identity) =>
			corpusGenerationIdentitiesMatch(identity, current),
		)
	) {
		return "payload.retained_generations must not repeat the current activation identity.";
	}
	const retainedKeys = retained.map(
		(identity) => `${identity.generation_id}\0${identity.activation_epoch}`,
	);
	if (new Set(retainedKeys).size !== retainedKeys.length) {
		return "payload.retained_generations must carry unique generation and epoch identities.";
	}
	if (
		value.prior_generation !== null &&
		!retained.some((identity) =>
			corpusGenerationIdentitiesMatch(
				identity,
				value.prior_generation as BrowserUseCorpusGenerationIdentity,
			),
		)
	) {
		return "payload.prior_generation must match one retained activation identity.";
	}
	return undefined;
}

/**
 * Validate a generation-effect fence payload.
 *
 * @param value - Unknown durable payload
 * @returns The first redaction-safe problem, or undefined
 * @internal
 */
export function generationEffectFenceProblem(
	value: unknown,
): string | undefined {
	if (!isJsonObject(value)) {
		return "generation-effect-fence payload must be a JSON object.";
	}
	if (stringField(value.generation_id) === undefined) {
		return "payload.generation_id must be a non-empty string.";
	}
	if (!isPositiveInteger(value.activation_epoch)) {
		return "payload.activation_epoch must be an integer >= 1.";
	}
	if (value.state !== "untripped" && value.state !== "tripped") {
		return "payload.state must be untripped or tripped.";
	}
	if (value.state === "untripped") {
		return value.tripped_at_epoch_ms === null && value.first_effect === null
			? undefined
			: "an untripped fence must not carry trip metadata.";
	}
	if (
		!isNonNegativeNumber(value.tripped_at_epoch_ms) ||
		!isJsonObject(value.first_effect) ||
		!(
			BROWSER_USE_GENERATION_EFFECT_KINDS as readonly unknown[]
		).includes(value.first_effect.effect_kind) ||
		stringField(value.first_effect.effect_ref) === undefined
	) {
		return "a tripped fence must carry one admitted first effect and timestamp.";
	}
	return undefined;
}

/**
 * Validate an activation-pending payload.
 *
 * @param value - Unknown durable payload
 * @returns The first redaction-safe problem, or undefined
 * @internal
 */
export function activationPendingProblem(value: unknown): string | undefined {
	if (!isJsonObject(value)) {
		return "activation-pending payload must be a JSON object.";
	}
	if (!isPositiveInteger(value.expected_epoch)) {
		return "payload.expected_epoch must be an integer >= 1.";
	}
	if (stringField(value.target_generation_id) === undefined) {
		return "payload.target_generation_id must be a non-empty string.";
	}
	return (
		digestProblem(
			value.generation_content_hash,
			"payload.generation_content_hash",
		) ??
		digestProblem(
			value.candidate_manifest_digest,
			"payload.candidate_manifest_digest",
		)
	);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
	return isFiniteNumber(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
