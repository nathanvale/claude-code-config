// ---------------------------------------------------------------------------
// Complete-generation activation owner.
//
// Owns immutable candidate reads and closure validation, authoritative active
// and retained manifests, activation status projection, fenced CAS/rollback,
// prior-run refusal, and monotonic effect fences. Migration phase persistence
// remains in browser-use-migration.ts.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import {
	type BrowserUseImportCandidate,
	screenImportCandidate,
} from "./browser-use-auth-bindings";
import { shippedCatalogDigest } from "./browser-use-catalog-digest";
import { redactUnsafeText } from "./browser-use-core";
import {
	readActivationEpochRecord,
	withActivationEpochBarrier,
} from "./browser-use-locks";
import type {
	BrowserUseMigrationFailure,
	BrowserUseMigrationGenerationIdentity,
	BrowserUseMigrationState,
	BrowserUseMigrationStatus,
} from "./browser-use-migration-model";
import {
	generationFilePath,
	readGenerationStatus,
	sourceSnapshotPath,
	type RetentionDeps,
} from "./browser-use-retention";
import {
	actionAssetDigest,
	auditActionEffectClass,
	type BrowserUseReviewedActionRecord,
	parseReviewedActionRecord,
} from "./browser-use-runbook-actions";
import {
	parseRunbookRecord,
	type BrowserUseRunbook,
	validateRunbook,
} from "./browser-use-runbook-model";
import {
	type BrowserUseGenerationReviewedActionRef,
	type BrowserUseGenerationSessionPolicy,
	parseGenerationAuthRouteRecord,
} from "./browser-use-generation-schemas";
import {
	type BrowserUseActivationPendingPayload,
	type BrowserUseCorpusGenerationCandidatePayload,
	type BrowserUseCorpusGenerationIdentity,
	type BrowserUseCorpusGenerationManifestPayload,
	type BrowserUseGenerationEffectFencePayload,
	type BrowserUseGenerationEffectKind,
	BROWSER_USE_GENERATION_EFFECT_KINDS,
	encodeDurableRecord,
	findRedactionViolations,
	parseDurableRecord,
} from "./browser-use-schemas";
import { readDurableFile, writeDurableFile } from "./browser-use-store";

const ACTIVE_CORPUS_MANIFEST_FILE = "active-corpus-manifest.json";
const ACTIVATION_PENDING_FILE = "activation-pending.json";
const GENERATION_EFFECT_FENCES_DIR = "effect-fences";
const SAFE_EFFECT_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

/** Fixed candidate-manifest path inside every activation-ready generation. */
export const CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH =
	"corpus-generation-candidate.json";

/** Active-manifest read classification for runtime catalog resolution. */
export type BrowserUseActiveCorpusManifestRead =
	| { status: "missing" }
	| {
			status: "present";
			manifest: BrowserUseCorpusGenerationManifestPayload;
	  }
	| {
			status: "corrupt";
			code: "migration_active_manifest_corrupt";
			message: string;
	  };

/** Retained candidate read classification bound to one historical epoch. */
export type BrowserUseRetainedCorpusGenerationRead =
	| { status: "missing" }
	| {
			status: "present";
			identity: BrowserUseCorpusGenerationIdentity;
			manifest: BrowserUseCorpusGenerationCandidatePayload;
	  }
	| {
			status: "corrupt";
			code: "migration_candidate_corrupt";
			message: string;
	  };

/** Exact candidate closure admitted for activation or producer reuse. */
export type BrowserUseGenerationCandidateClosureRead =
	| {
			ok: true;
			candidate: BrowserUseCorpusGenerationCandidatePayload;
			candidateDigest: string;
			generationContentHash: string;
			generationFiles: readonly (readonly [string, string])[];
	  }
	| BrowserUseMigrationFailure;

type CandidateManifestRead =
	| {
			status: "present";
			candidate: BrowserUseCorpusGenerationCandidatePayload;
			candidateDigest: string;
			generationContentHash: string;
			generationFiles: readonly (readonly [string, string])[];
	  }
	| { status: "missing"; kind: "generation" | "candidate" }
	| {
			status: "corrupt";
			kind: "generation" | "candidate";
			message: string;
	  };

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function migrationFailure(
	code: BrowserUseMigrationFailure["code"],
	message: string,
): BrowserUseMigrationFailure {
	return { ok: false, code, message: redactUnsafeText(message) };
}

function activeCorpusManifestPath(deps: RetentionDeps): string {
	return join(deps.paths.state.migrationsDir, ACTIVE_CORPUS_MANIFEST_FILE);
}

function activationPendingPath(deps: RetentionDeps): string {
	return join(deps.paths.state.migrationsDir, ACTIVATION_PENDING_FILE);
}

function generationEffectFencePath(
	deps: RetentionDeps,
	activationEpoch: number,
): string {
	return join(
		deps.paths.state.migrationsDir,
		GENERATION_EFFECT_FENCES_DIR,
		`${activationEpoch}.json`,
	);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeGenerationRelativePath(value: string): boolean {
	return (
		!isAbsolute(value) &&
		!value.includes("\\") &&
		!value.includes("\0") &&
		value
			.split("/")
			.every(
				(segment) => segment !== "" && segment !== "." && segment !== "..",
			)
	);
}

function safeSinglePathSegment(value: string): boolean {
	return (
		value !== "" &&
		value !== "." &&
		value !== ".." &&
		!value.includes("/") &&
		!value.includes("\\") &&
		!value.includes("\0")
	);
}

function sameStrings(
	left: readonly string[],
	right: readonly string[],
): boolean {
	if (left.length !== right.length) return false;
	const sortedLeft = [...left].sort();
	const sortedRight = [...right].sort();
	return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function currentIdentity(
	manifest: BrowserUseCorpusGenerationManifestPayload,
): BrowserUseCorpusGenerationIdentity {
	return {
		generation_id: manifest.generation_id,
		generation_content_hash: manifest.generation_content_hash,
		candidate_manifest_digest: manifest.candidate_manifest_digest,
		activation_epoch: manifest.activation_epoch,
	};
}

function identityMatches(
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

function jsonValuesEqual(left: unknown, right: unknown): boolean {
	if (
		left === null ||
		right === null ||
		typeof left !== "object" ||
		typeof right !== "object"
	) {
		return Object.is(left, right);
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => jsonValuesEqual(value, right[index]))
		);
	}
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftRecord).sort();
	const rightKeys = Object.keys(rightRecord).sort();
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key, index) =>
				key === rightKeys[index] &&
				jsonValuesEqual(leftRecord[key], rightRecord[key]),
		)
	);
}

function candidateAuthorityPayload(
	candidate:
		| BrowserUseCorpusGenerationCandidatePayload
		| BrowserUseCorpusGenerationManifestPayload,
): Omit<BrowserUseCorpusGenerationCandidatePayload, "contract"> {
	return {
		schema_version: candidate.schema_version,
		generation_id: candidate.generation_id,
		source_snapshot: candidate.source_snapshot,
		canonical_targets: candidate.canonical_targets,
		action_registry: candidate.action_registry,
		auth: candidate.auth,
		proofs: candidate.proofs,
		...(candidate.knowledge === undefined
			? {}
			: { knowledge: candidate.knowledge }),
		shipped_catalog_digest: candidate.shipped_catalog_digest,
	};
}

function activeManifestMatchesCandidate(
	manifest: BrowserUseCorpusGenerationManifestPayload,
	candidate: Extract<CandidateManifestRead, { status: "present" }>,
): boolean {
	return (
		manifest.generation_content_hash === candidate.generationContentHash &&
		manifest.candidate_manifest_digest === candidate.candidateDigest &&
		jsonValuesEqual(
			candidateAuthorityPayload(manifest),
			candidateAuthorityPayload(candidate.candidate),
		)
	);
}

function statusIdentityOf(
	identity: BrowserUseCorpusGenerationIdentity,
): BrowserUseMigrationGenerationIdentity {
	return {
		generation_id: identity.generation_id,
		activation_epoch: identity.activation_epoch,
	};
}

async function readCandidateManifest(
	deps: RetentionDeps,
	generationId: string,
): Promise<CandidateManifestRead> {
	const generation = await readGenerationStatus(deps, generationId);
	if (generation.status === "missing") {
		return { status: "missing", kind: "generation" };
	}
	if (generation.status === "corrupt") {
		return {
			status: "corrupt",
			kind: "generation",
			message: generation.message,
		};
	}
	const path = generationFilePath(
		deps.paths,
		generationId,
		CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
	);
	const read = await readDurableFile(deps.fs, path);
	if (read.status === "missing") return { status: "missing", kind: "candidate" };
	if (read.status === "unreadable") {
		return {
			status: "corrupt",
			kind: "candidate",
			message: "candidate manifest is unreadable.",
		};
	}
	const parsed = parseDurableRecord(read.raw, "corpus-generation-candidate");
	if (!parsed.ok || parsed.payload.generation_id !== generationId) {
		return {
			status: "corrupt",
			kind: "candidate",
			message: "candidate manifest does not match its generation identity.",
		};
	}
	const candidateDigest = sha256(read.raw);
	const verifiedCandidateDigest = generation.files.find(
		([relativePath]) =>
			relativePath === CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
	)?.[1];
	if (verifiedCandidateDigest !== candidateDigest) {
		return {
			status: "corrupt",
			kind: "candidate",
			message:
				"candidate manifest bytes do not match the verified generation tree.",
		};
	}
	return {
		status: "present",
		candidate: parsed.payload,
		candidateDigest,
		generationContentHash: generation.record.content_hash,
		generationFiles: generation.files,
	};
}

/**
 * Read the authoritative active Corpus Generation Manifest.
 *
 * Missing and corrupt are distinct so runtime discovery can fail closed rather
 * than falling through to a lower-priority catalog after manifest damage.
 *
 * @param deps - Admitted migration-store dependencies
 * @returns Missing, present, or typed corrupt classification
 *
 * @example
 * ```typescript
 * const active = await readActiveCorpusManifest(deps)
 * ```
 */
export async function readActiveCorpusManifest(
	deps: RetentionDeps,
): Promise<BrowserUseActiveCorpusManifestRead> {
	const read = await readDurableFile(deps.fs, activeCorpusManifestPath(deps));
	if (read.status === "missing") return { status: "missing" };
	if (read.status === "unreadable") {
		return {
			status: "corrupt",
			code: "migration_active_manifest_corrupt",
			message: "active corpus manifest is unreadable.",
		};
	}
	const parsed = parseDurableRecord(read.raw, "corpus-generation-manifest");
	if (!parsed.ok) {
		return {
			status: "corrupt",
			code: "migration_active_manifest_corrupt",
			message: redactUnsafeText(
				`active corpus manifest is corrupt (${parsed.code}).`,
			),
		};
	}
	const manifest = parsed.payload;
	const current = currentIdentity(manifest);
	if (
		!safeSinglePathSegment(manifest.generation_id) ||
		!safeSinglePathSegment(manifest.source_snapshot.snapshot_id) ||
		manifest.retained_generations.some(
			(identity) => !safeSinglePathSegment(identity.generation_id),
		) ||
		manifest.retained_generations.some((identity) =>
			identityMatches(identity, current),
		) ||
		new Set(
			manifest.retained_generations.map(
				(identity) =>
					`${identity.generation_id}\0${identity.activation_epoch}`,
			),
		).size !== manifest.retained_generations.length ||
		(manifest.prior_generation !== null &&
			!manifest.retained_generations.some((identity) =>
				identityMatches(
					identity,
					manifest.prior_generation as BrowserUseCorpusGenerationIdentity,
				),
			))
	) {
		return {
			status: "corrupt",
			code: "migration_active_manifest_corrupt",
			message: "active corpus manifest carries inconsistent retained identities.",
		};
	}
	return { status: "present", manifest };
}

/**
 * Resolve an immutable retained candidate through its historical activation.
 *
 * @param deps - Admitted migration-store dependencies
 * @param input - Exact generation and activation epoch pinned by a run
 * @returns Missing, verified present, or typed corrupt classification
 *
 * @example
 * ```typescript
 * const retained = await readRetainedCorpusGenerationManifest(deps, {
 *   generationId: "generation-a",
 *   activationEpoch: 2,
 * })
 * ```
 */
export async function readRetainedCorpusGenerationManifest(
	deps: RetentionDeps,
	input: { generationId: string; activationEpoch: number },
): Promise<BrowserUseRetainedCorpusGenerationRead> {
	const active = await readActiveCorpusManifest(deps);
	if (active.status === "missing") return { status: "missing" };
	if (active.status === "corrupt") {
		return {
			status: "corrupt",
			code: "migration_candidate_corrupt",
			message: active.message,
		};
	}
	const current = currentIdentity(active.manifest);
	const identity =
		current.generation_id === input.generationId &&
		current.activation_epoch === input.activationEpoch
			? current
			: active.manifest.retained_generations.find(
					(candidate) =>
						candidate.generation_id === input.generationId &&
						candidate.activation_epoch === input.activationEpoch,
				);
	if (identity === undefined) return { status: "missing" };
	const candidate = await readCandidateManifest(deps, identity.generation_id);
	if (
		candidate.status !== "present" ||
		candidate.generationContentHash !== identity.generation_content_hash ||
		candidate.candidateDigest !== identity.candidate_manifest_digest
	) {
		return {
			status: "corrupt",
			code: "migration_candidate_corrupt",
			message: "retained generation no longer matches its activation identity.",
		};
	}
	return { status: "present", identity, manifest: candidate.candidate };
}

async function readEffectFence(
	deps: RetentionDeps,
	activationEpoch: number,
): Promise<
	| { status: "missing" }
	| { status: "present"; fence: BrowserUseGenerationEffectFencePayload }
	| { status: "corrupt"; message: string }
> {
	const read = await readDurableFile(
		deps.fs,
		generationEffectFencePath(deps, activationEpoch),
	);
	if (read.status === "missing") return { status: "missing" };
	if (read.status === "unreadable") {
		return { status: "corrupt", message: "effect fence is unreadable." };
	}
	const parsed = parseDurableRecord(read.raw, "generation-effect-fence");
	return parsed.ok && parsed.payload.activation_epoch === activationEpoch
		? { status: "present", fence: parsed.payload }
		: {
				status: "corrupt",
				message:
					"effect fence record is corrupt or addresses another activation epoch.",
			};
}

async function readActivationPending(
	deps: RetentionDeps,
): Promise<
	| { status: "missing" }
	| { status: "present"; pending: BrowserUseActivationPendingPayload }
	| { status: "corrupt"; message: string }
> {
	const read = await readDurableFile(deps.fs, activationPendingPath(deps));
	if (read.status === "missing") return { status: "missing" };
	if (read.status === "unreadable") {
		return {
			status: "corrupt",
			message: "activation pending record is unreadable.",
		};
	}
	const parsed = parseDurableRecord(read.raw, "activation-pending");
	return parsed.ok
		? { status: "present", pending: parsed.payload }
		: {
				status: "corrupt",
				message: "activation pending record is corrupt.",
			};
}

/**
 * Project authoritative generation activation state onto migration status.
 *
 * @param deps - Admitted migration-store dependencies
 * @param durableActivationState - Activation marker from durable migration state
 * @returns Redacted authority projection or one typed corruption refusal
 * @internal
 */
export async function projectActiveGenerationStatus(
	deps: RetentionDeps,
	durableActivationState: BrowserUseMigrationState["activation_state"],
): Promise<
	| {
			ok: true;
			activeGeneration: BrowserUseMigrationStatus["active_generation"];
	  }
	| BrowserUseMigrationFailure
> {
	const [active, pending, epoch] = await Promise.all([
		readActiveCorpusManifest(deps),
		readActivationPending(deps),
		readActivationEpochRecord(deps),
	]);
	if (active.status === "corrupt") {
		return migrationFailure(active.code, active.message);
	}
	if (pending.status === "corrupt" || epoch.status === "corrupt") {
		return migrationFailure(
			"migration_active_manifest_corrupt",
			"activation authority metadata is corrupt; inspect migration status before repair.",
		);
	}
	if (active.status === "missing") {
		if (durableActivationState === "active") {
			return migrationFailure(
				"migration_active_manifest_corrupt",
				"persisted active migration state has no authoritative active manifest; inspect repair status and apply the named repair.",
			);
		}
		if (pending.status === "missing") {
			if (epoch.epoch !== 1) {
				return migrationFailure(
					"migration_active_manifest_corrupt",
					"activation epoch advanced without an authoritative active manifest.",
				);
			}
			return {
				ok: true,
				activeGeneration: {
					state: "never-activated",
					current: null,
					prior: null,
					retained: [],
					activation_epoch: null,
					pending: "none",
					effect_fence: "not-applicable",
				},
			};
		}
		if (pending.pending.expected_epoch === epoch.epoch) {
			return {
				ok: true,
				activeGeneration: {
					state: "activation-prepared",
					current: null,
					prior: null,
					retained: [],
					activation_epoch: epoch.epoch,
					pending: "prepared",
					effect_fence: "not-applicable",
				},
			};
		}
		if (pending.pending.expected_epoch + 1 !== epoch.epoch) {
			return migrationFailure(
				"migration_active_manifest_corrupt",
				"pending activation does not own the current activation epoch.",
			);
		}
		const pendingFence = await readEffectFence(deps, epoch.epoch);
		if (
			pendingFence.status !== "present" ||
			pendingFence.fence.generation_id !==
				pending.pending.target_generation_id ||
			pendingFence.fence.activation_epoch !== epoch.epoch ||
			pendingFence.fence.state !== "untripped"
		) {
			return migrationFailure(
				"migration_effect_fence_corrupt",
				"interrupted activation effect fence is missing or corrupt.",
			);
		}
		return {
			ok: true,
			activeGeneration: {
				state: "activation-interrupted",
				current: null,
				prior: null,
				retained: [],
				activation_epoch: epoch.epoch,
				pending: "interrupted",
				effect_fence: "not-applicable",
			},
		};
	}

	const manifest = active.manifest;
	const candidate = await readCandidateManifest(deps, manifest.generation_id);
	if (
		candidate.status !== "present" ||
		!activeManifestMatchesCandidate(manifest, candidate)
	) {
		return migrationFailure(
			"migration_active_manifest_corrupt",
			"active corpus manifest does not match its immutable generation identity.",
		);
	}
	const fence = await readEffectFence(deps, manifest.activation_epoch);
	if (
		fence.status !== "present" ||
		fence.fence.generation_id !== manifest.generation_id ||
		fence.fence.activation_epoch !== manifest.activation_epoch
	) {
		return migrationFailure(
			"migration_effect_fence_corrupt",
			"active generation effect fence is missing or corrupt.",
		);
	}
	if (pending.status === "missing") {
		return migrationFailure(
			"migration_active_manifest_corrupt",
			"active generation has no durable activation claim.",
		);
	}
	if (
		pending.pending.expected_epoch === epoch.epoch &&
		manifest.activation_epoch === epoch.epoch
	) {
		return {
			ok: true,
			activeGeneration: {
				state: "activation-prepared",
				current: statusIdentityOf(currentIdentity(manifest)),
				prior:
					manifest.prior_generation === null
						? null
						: statusIdentityOf(manifest.prior_generation),
				retained: manifest.retained_generations.map(statusIdentityOf),
				activation_epoch: epoch.epoch,
				pending: "prepared",
				effect_fence: fence.fence.state,
			},
		};
	}
	const committed =
		pending.pending.target_generation_id === manifest.generation_id &&
		pending.pending.generation_content_hash ===
			manifest.generation_content_hash &&
		pending.pending.candidate_manifest_digest ===
			manifest.candidate_manifest_digest &&
		pending.pending.expected_epoch + 1 === manifest.activation_epoch &&
		epoch.epoch === manifest.activation_epoch;
	const interrupted =
		manifest.activation_epoch === pending.pending.expected_epoch &&
		epoch.epoch === pending.pending.expected_epoch + 1;
	if (!committed && !interrupted) {
		return migrationFailure(
			"migration_active_manifest_corrupt",
			"active manifest, pending activation, and activation epoch disagree.",
		);
	}
	return {
		ok: true,
		activeGeneration: {
			state: interrupted ? "activation-interrupted" : "active",
			current: statusIdentityOf(currentIdentity(manifest)),
			prior:
				manifest.prior_generation === null
					? null
					: statusIdentityOf(manifest.prior_generation),
			retained: manifest.retained_generations.map(statusIdentityOf),
			activation_epoch: epoch.epoch,
			pending: interrupted ? "interrupted" : "committed",
			effect_fence: fence.fence.state,
		},
	};
}

async function readGenerationText(
	deps: RetentionDeps,
	generationId: string,
	path: string,
	expectedDigest: string,
): Promise<{ ok: true; raw: string } | { ok: false; message: string }> {
	if (!safeGenerationRelativePath(path)) {
		return { ok: false, message: "generation manifest carries an unsafe path." };
	}
	const absolute = generationFilePath(deps.paths, generationId, path);
	try {
		const raw = await deps.fs.readTextFile(absolute);
		if (sha256(raw) !== expectedDigest) {
			return {
				ok: false,
				message: "generation file does not match its manifest digest.",
			};
		}
		return { ok: true, raw };
	} catch {
		return { ok: false, message: "generation file is missing or unreadable." };
	}
}

function runbookActionReferences(
	runbook: BrowserUseRunbook,
): readonly { actionId: string; expectedDigest: string }[] {
	const references: Array<{ actionId: string; expectedDigest: string }> = [];
	for (const step of runbook.steps) {
		if (step.kind === "action") {
			references.push({
				actionId: step.action_id,
				expectedDigest: step.expected_digest,
			});
		}
		if (step.kind === "iterate") {
			references.push({
				actionId: step.step.action_id,
				expectedDigest: step.step.expected_digest,
			});
		}
	}
	return references;
}

function reviewedActionRecordProblem(
	record: BrowserUseReviewedActionRecord,
	assetBytes: string,
	activeRequired: boolean,
): string | undefined {
	if (
		record.action_id === "" ||
		record.asset_id !== record.expected_digest ||
		record.expected_digest !== actionAssetDigest(assetBytes)
	) {
		return "reviewed action identity or exact-byte digest is invalid.";
	}
	if (
		record.effect_class !== auditActionEffectClass(assetBytes) ||
		(record.containment === "read-only-observation" &&
			record.effect_class !== "read")
	) {
		return "reviewed action effect audit or mutation postcondition is invalid.";
	}
	if (
		activeRequired &&
		(record.promotion_receipt.disposition !== "approved" ||
			record.promotion_receipt.approved_digest !== record.expected_digest ||
			record.promotion_receipt.approved_origin !== record.allowed_origin ||
			record.promotion_receipt.approved_effect !== record.effect_class)
	) {
		return "active reviewed action lacks an exact approved promotion receipt.";
	}
	return undefined;
}

function reviewedAuthRouteActionProblem(
	records: ReadonlyMap<string, BrowserUseReviewedActionRecord>,
	ref: BrowserUseGenerationReviewedActionRef,
	expectedEffect: "read" | "mutation",
	allowedOrigins: readonly string[],
): string | undefined {
	const record = records.get(ref.action_id);
	if (
		record === undefined ||
		record.expected_digest !== ref.expected_digest ||
		record.effect_class !== expectedEffect ||
		!allowedOrigins.includes(record.allowed_origin) ||
		record.promotion_receipt.disposition !== "approved" ||
		record.promotion_receipt.approved_digest !== ref.expected_digest ||
		record.promotion_receipt.approved_origin !== record.allowed_origin ||
		record.promotion_receipt.approved_effect !== expectedEffect ||
		(expectedEffect === "mutation" &&
			record.required_postcondition === undefined)
	) {
		return "auth route action authority is missing, mismatched, or unapproved.";
	}
	return undefined;
}

function sessionPolicyActionProblem(
	records: ReadonlyMap<string, BrowserUseReviewedActionRecord>,
	policy: BrowserUseGenerationSessionPolicy,
): string | undefined {
	const flow = policy.auth_flow;
	const requirements: Array<{
		ref: BrowserUseGenerationReviewedActionRef;
		effect: "read" | "mutation";
		origins: readonly string[];
	}> = [
		{
			ref: flow.identify_state,
			effect: "read",
			origins: policy.approved_identity_provider_origins,
		},
		...(flow.username_submit === undefined
			? []
			: [
					{
						ref: flow.username_submit,
						effect: "mutation" as const,
						origins: policy.approved_identity_provider_origins,
					},
				]),
		...(flow.password_submit === undefined
			? []
			: [
					{
						ref: flow.password_submit,
						effect: "mutation" as const,
						origins: policy.approved_identity_provider_origins,
					},
				]),
		...(flow.otp_submit === undefined
			? []
			: [
					{
						ref: flow.otp_submit,
						effect: "mutation" as const,
						origins: policy.approved_identity_provider_origins,
					},
				]),
		{
			ref: policy.identity_verifier.action,
			effect: "read",
			origins: policy.approved_service_origins,
		},
	];
	for (const requirement of requirements) {
		const problem = reviewedAuthRouteActionProblem(
			records,
			requirement.ref,
			requirement.effect,
			requirement.origins,
		);
		if (problem !== undefined) return problem;
	}
	return undefined;
}

function generationFileBindingProblem(
	read: Extract<CandidateManifestRead, { status: "present" }>,
): string | undefined {
	const { candidate } = read;
	const declared = [
		{
			path: candidate.action_registry.registry_path,
			digest: candidate.action_registry.registry_digest,
		},
		...candidate.canonical_targets.map((target) => ({
			path: target.runbook_path,
			digest: target.runbook_digest,
		})),
		...candidate.action_registry.actions.flatMap((action) => [
			{ path: action.record_path, digest: action.record_digest },
			{ path: action.asset_path, digest: action.asset_digest },
		]),
		...candidate.auth.candidates.map((authCandidate) => ({
			path: authCandidate.path,
			digest: authCandidate.digest,
		})),
		...candidate.auth.routes.map((route) => ({
			path: route.path,
			digest: route.digest,
		})),
		...candidate.proofs.map((proof) => ({
			path: proof.path,
			digest: proof.digest,
		})),
		...(candidate.knowledge?.files.map((file) => ({
			path: file.path,
			digest: file.digest,
		})) ?? []),
	];
	const verified = new Map(read.generationFiles);
	for (const reference of declared) {
		if (
			!safeGenerationRelativePath(reference.path) ||
			verified.get(reference.path) !== reference.digest
		) {
			return "candidate file reference does not match the verified generation tree.";
		}
	}
	return undefined;
}

async function validateCandidateSourceSnapshot(
	deps: RetentionDeps,
	candidate: BrowserUseCorpusGenerationCandidatePayload,
): Promise<{ ok: true } | BrowserUseMigrationFailure> {
	if (!safeSinglePathSegment(candidate.source_snapshot.snapshot_id)) {
		return migrationFailure(
			"migration_manifest_incomplete",
			"candidate source snapshot identity is unsafe.",
		);
	}
	const snapshot = await readDurableFile(
		deps.fs,
		sourceSnapshotPath(deps.paths, candidate.source_snapshot.snapshot_id),
	);
	if (snapshot.status !== "present") {
		return migrationFailure(
			"migration_manifest_incomplete",
			"candidate source snapshot record is missing or unreadable.",
		);
	}
	const parsedSnapshot = parseDurableRecord(snapshot.raw, "source-snapshot");
	if (
		!parsedSnapshot.ok ||
		parsedSnapshot.payload.snapshot_id !==
			candidate.source_snapshot.snapshot_id ||
		parsedSnapshot.payload.snapshot_digest !==
			candidate.source_snapshot.snapshot_digest
	) {
		return migrationFailure(
			"migration_manifest_incomplete",
			"candidate source snapshot identity is corrupt.",
		);
	}
	return { ok: true };
}

/**
 * Prove a source candidate belongs to one exact verified migration state.
 *
 * Producers call this before immutable staging so a self-consistent candidate
 * from another snapshot or target set is refused before consuming its
 * generation id.
 *
 * @param deps - Admitted migration-store dependencies
 * @param candidate - Parsed source candidate proposed for staging
 * @param state - Exact migration state the candidate must cover
 * @returns Success only for matching verified state and snapshot authority
 *
 * @example
 * ```typescript
 * const validated =
 *   await validateBrowserUseGenerationCandidateForMigrationState(
 *     deps,
 *     candidate,
 *     migrationState,
 *   )
 * ```
 */
export async function validateBrowserUseGenerationCandidateForMigrationState(
	deps: RetentionDeps,
	candidate: BrowserUseCorpusGenerationCandidatePayload,
	state: BrowserUseMigrationState,
): Promise<{ ok: true } | BrowserUseMigrationFailure> {
	if (
		state.phase !== "verified" ||
		state.snapshot_id !== candidate.source_snapshot.snapshot_id ||
		state.snapshot_digest !== candidate.source_snapshot.snapshot_digest
	) {
		return migrationFailure(
			"migration_not_verified",
			"candidate does not match the verified migration snapshot.",
		);
	}
	const byTarget = new Map(
		candidate.canonical_targets.map((target) => [
			target.canonical_target_id,
			target,
		]),
	);
	if (
		byTarget.size !== candidate.canonical_targets.length ||
		byTarget.size !== state.canonical_targets.length ||
		state.canonical_targets.some((expected) => {
			const target = byTarget.get(expected.canonical_target_id);
			return (
				target === undefined ||
				!sameStrings(
					target.source_relative_paths,
					expected.source_relative_paths,
				)
			);
		})
	) {
		return migrationFailure(
			"migration_manifest_incomplete",
			"candidate does not cover every verified canonical target exactly once.",
		);
	}
	return await validateCandidateSourceSnapshot(deps, candidate);
}

async function validateCandidateClosure(
	deps: RetentionDeps,
	read: Extract<CandidateManifestRead, { status: "present" }>,
	state: BrowserUseMigrationState | undefined,
): Promise<{ ok: true } | BrowserUseMigrationFailure> {
	const { candidate } = read;
	const bindingProblem = generationFileBindingProblem(read);
	if (bindingProblem !== undefined) {
		return migrationFailure("migration_manifest_incomplete", bindingProblem);
	}
	const sourceValidation =
		state === undefined
			? await validateCandidateSourceSnapshot(deps, candidate)
			: await validateBrowserUseGenerationCandidateForMigrationState(
					deps,
					candidate,
					state,
				);
	if (!sourceValidation.ok) return sourceValidation;

	const registry = await readGenerationText(
		deps,
		candidate.generation_id,
		candidate.action_registry.registry_path,
		candidate.action_registry.registry_digest,
	);
	if (!registry.ok) {
		return migrationFailure("migration_manifest_incomplete", registry.message);
	}
	let registryJson: unknown;
	try {
		registryJson = JSON.parse(registry.raw);
	} catch {
		return migrationFailure(
			"migration_manifest_incomplete",
			"candidate action registry is not valid JSON.",
		);
	}
	if (!isJsonRecord(registryJson) || !Array.isArray(registryJson.actions)) {
		return migrationFailure(
			"migration_manifest_incomplete",
			"candidate action registry does not carry an actions array.",
		);
	}

	const proofIds = new Set<string>();
	for (const proof of candidate.proofs) {
		if (proofIds.has(proof.proof_ref)) {
			return migrationFailure(
				"migration_manifest_incomplete",
				"candidate proof references are not unique.",
			);
		}
		proofIds.add(proof.proof_ref);
		const file = await readGenerationText(
			deps,
			candidate.generation_id,
			proof.path,
			proof.digest,
		);
		if (!file.ok) {
			return migrationFailure("migration_manifest_incomplete", file.message);
		}
		try {
			JSON.parse(file.raw);
		} catch {
			return migrationFailure(
				"migration_manifest_incomplete",
				"candidate proof is not valid JSON.",
			);
		}
	}

	const actionById = new Map(
		candidate.action_registry.actions.map((action) => [action.action_id, action]),
	);
	if (actionById.size !== candidate.action_registry.actions.length) {
		return migrationFailure(
			"migration_manifest_incomplete",
			"candidate action ids are not unique.",
		);
	}
	const registryActionIds = registryJson.actions.map((value) =>
		isJsonRecord(value) && typeof value.action_id === "string"
			? value.action_id
			: undefined,
	);
	if (
		registryActionIds.some((value) => value === undefined) ||
		!sameStrings(registryActionIds as string[], [...actionById.keys()])
	) {
		return migrationFailure(
			"migration_manifest_incomplete",
			"candidate action registry and manifest action index disagree.",
		);
	}
	const activeActionRefs = new Map<string, string>();
	const activeAuthRequirements: {
		authContextRef: string;
		serviceId: string;
	}[] = [];
	for (const target of candidate.canonical_targets) {
		if (
			target.proof_refs.length === 0 ||
			target.proof_refs.some((proof) => !proofIds.has(proof))
		) {
			return migrationFailure(
				"migration_manifest_incomplete",
				"candidate target proof closure is incomplete.",
			);
		}
		const file = await readGenerationText(
			deps,
			candidate.generation_id,
			target.runbook_path,
			target.runbook_digest,
		);
		if (!file.ok) {
			return migrationFailure("migration_manifest_incomplete", file.message);
		}
		let raw: unknown;
		try {
			raw = JSON.parse(file.raw);
		} catch {
			return migrationFailure(
				"migration_manifest_incomplete",
				"candidate runbook is not valid JSON.",
			);
		}
		const parsed = parseRunbookRecord(raw);
		if (!parsed.ok || validateRunbook(parsed.runbook).length > 0) {
			return migrationFailure(
				"migration_manifest_incomplete",
				"candidate runbook does not satisfy the runbook schema.",
			);
		}
		if (
			`${parsed.runbook.service_id}/${parsed.runbook.flow_id}` !==
			target.canonical_target_id
		) {
			return migrationFailure(
				"migration_manifest_incomplete",
				"candidate runbook identity does not match its canonical target.",
			);
		}
		for (const reference of runbookActionReferences(parsed.runbook)) {
			const action = actionById.get(reference.actionId);
			if (
				action === undefined ||
				action.asset_digest !== reference.expectedDigest
			) {
				return migrationFailure(
					"migration_manifest_incomplete",
					"candidate runbook action closure is incomplete.",
				);
			}
			if (target.activation === "active") {
				activeActionRefs.set(reference.actionId, reference.expectedDigest);
			}
		}
		if (
			target.activation === "active" &&
			parsed.runbook.auth_context_ref !== undefined
		) {
			activeAuthRequirements.push({
				authContextRef: parsed.runbook.auth_context_ref,
				serviceId: parsed.runbook.service_id,
			});
		}
	}

	const reviewedActionRecords = new Map<
		string,
		BrowserUseReviewedActionRecord
	>();
	for (const action of candidate.action_registry.actions) {
		const recordFile = await readGenerationText(
			deps,
			candidate.generation_id,
			action.record_path,
			action.record_digest,
		);
		const assetFile = await readGenerationText(
			deps,
			candidate.generation_id,
			action.asset_path,
			action.asset_digest,
		);
		if (!recordFile.ok) {
			return migrationFailure(
				"migration_manifest_incomplete",
				recordFile.message,
			);
		}
		if (!assetFile.ok) {
			return migrationFailure(
				"migration_manifest_incomplete",
				assetFile.message,
			);
		}
		let rawRecord: unknown;
		try {
			rawRecord = JSON.parse(recordFile.raw);
		} catch {
			return migrationFailure(
				"migration_manifest_incomplete",
				"reviewed action record is not valid JSON.",
			);
		}
		const parsedRecord = parseReviewedActionRecord(rawRecord);
		if (
			!parsedRecord.ok ||
			parsedRecord.record.action_id !== action.action_id ||
			parsedRecord.record.expected_digest !== action.asset_digest
		) {
			return migrationFailure(
				"migration_manifest_incomplete",
				"reviewed action record does not match its manifest reference.",
			);
		}
		const problem = reviewedActionRecordProblem(
			parsedRecord.record,
			assetFile.raw,
			activeActionRefs.has(action.action_id),
		);
		if (problem !== undefined) {
			return migrationFailure("migration_manifest_incomplete", problem);
		}
		reviewedActionRecords.set(action.action_id, parsedRecord.record);
	}

	const screenedCandidates = new Map<string, BrowserUseImportCandidate>();
	for (const authCandidate of candidate.auth.candidates) {
		if (screenedCandidates.has(authCandidate.candidate_id)) {
			return migrationFailure(
				"migration_manifest_incomplete",
				"auth candidate ids are not unique.",
			);
		}
		const file = await readGenerationText(
			deps,
			candidate.generation_id,
			authCandidate.path,
			authCandidate.digest,
		);
		if (!file.ok) {
			return migrationFailure("migration_manifest_incomplete", file.message);
		}
		let raw: unknown;
		try {
			raw = JSON.parse(file.raw);
		} catch {
			return migrationFailure(
				"migration_manifest_incomplete",
				"auth candidate is not valid JSON.",
			);
		}
		const screened = screenImportCandidate(raw);
		if (
			!screened.ok ||
			screened.candidate.candidate_id !== authCandidate.candidate_id
		) {
			return migrationFailure(
				"migration_manifest_incomplete",
				"auth candidate fails redacted candidate admission.",
			);
		}
		screenedCandidates.set(authCandidate.candidate_id, screened.candidate);
	}

	const routedAuthCandidates = new Map<string, BrowserUseImportCandidate>();
	for (const route of candidate.auth.routes) {
		const selectedCandidate = screenedCandidates.get(route.candidate_id);
		if (selectedCandidate === undefined) {
			return migrationFailure(
				"migration_manifest_incomplete",
				"auth route points to an unknown candidate.",
			);
		}
		const file = await readGenerationText(
			deps,
			candidate.generation_id,
			route.path,
			route.digest,
		);
		if (!file.ok) {
			return migrationFailure("migration_manifest_incomplete", file.message);
		}
		let raw: unknown;
		try {
			raw = JSON.parse(file.raw);
		} catch {
			return migrationFailure(
				"migration_manifest_incomplete",
				"auth route is not valid JSON.",
			);
		}
		const parsedRoute = parseGenerationAuthRouteRecord(raw);
		if (
			parsedRoute === undefined ||
			parsedRoute.auth_context_ref !== route.auth_context_ref ||
			parsedRoute.candidate_id !== route.candidate_id ||
			routedAuthCandidates.has(route.auth_context_ref)
		) {
			return migrationFailure(
				"migration_manifest_incomplete",
				"auth route does not prove one active candidate route.",
			);
		}
		if ("session_policy" in parsedRoute) {
			const problem = sessionPolicyActionProblem(
				reviewedActionRecords,
				parsedRoute.session_policy,
			);
			if (problem !== undefined) {
				return migrationFailure("migration_manifest_incomplete", problem);
			}
		}
		routedAuthCandidates.set(route.auth_context_ref, selectedCandidate);
	}
	if (
		activeAuthRequirements.some((requirement) => {
			const selected = routedAuthCandidates.get(requirement.authContextRef);
			return (
				selected === undefined ||
				selected.service_id !== requirement.serviceId
			);
		})
	) {
		return migrationFailure(
			"migration_manifest_incomplete",
			"active runbook auth closure does not match its screened service.",
		);
	}

	try {
		const { shippedRunbooksRoot } = await import("./browser-use-runbook");
		const observed = await shippedCatalogDigest(shippedRunbooksRoot(), deps.fs);
		if (observed !== candidate.shipped_catalog_digest) {
			return migrationFailure(
				"migration_shipped_catalog_drift",
				"shipped catalog digest changed after candidate verification.",
			);
		}
	} catch {
		return migrationFailure(
			"migration_shipped_catalog_drift",
			"shipped catalog could not be verified.",
		);
	}
	return { ok: true };
}

/**
 * Read and validate one staged candidate's exact immutable closure.
 *
 * Producers can call this after staging; activation additionally supplies the
 * verified migration state to the private transaction validator.
 *
 * @param deps - Admitted migration-store dependencies
 * @param generationId - Immutable generation identity to validate
 * @returns Exact candidate identity and closure, or one typed refusal
 *
 * @example
 * ```typescript
 * const closure = await validateBrowserUseGenerationCandidateClosure(
 *   deps,
 *   generationId,
 * )
 * ```
 */
export async function validateBrowserUseGenerationCandidateClosure(
	deps: RetentionDeps,
	generationId: string,
): Promise<BrowserUseGenerationCandidateClosureRead> {
	const read = await readCandidateManifest(deps, generationId);
	if (read.status === "missing") {
		return migrationFailure(
			read.kind === "generation"
				? "migration_generation_missing"
				: "migration_candidate_missing",
			read.kind === "generation"
				? "activation target generation is missing."
				: "activation target has no candidate manifest.",
		);
	}
	if (read.status === "corrupt") {
		return migrationFailure(
			read.kind === "generation"
				? "migration_generation_corrupt"
				: "migration_candidate_corrupt",
			read.message,
		);
	}
	const validated = await validateCandidateClosure(deps, read, undefined);
	if (!validated.ok) return validated;
	return {
		ok: true,
		candidate: read.candidate,
		candidateDigest: read.candidateDigest,
		generationContentHash: read.generationContentHash,
		generationFiles: read.generationFiles,
	};
}

async function priorGenerationMutationRefusal(
	deps: RetentionDeps,
	activeGenerationId: string,
): Promise<BrowserUseMigrationFailure | undefined> {
	const corruptRunState = (detail: string): BrowserUseMigrationFailure =>
		migrationFailure(
			"migration_state_corrupt",
			`${detail} Inspect repair status, then run repair apply for the named action.`,
		);
	const stat = await deps.fs.lstat(deps.paths.state.runsDir);
	if (stat === undefined) return undefined;
	if (stat.kind !== "directory") {
		return corruptRunState(
			"shared-run state is corrupt; activation cannot prove prior runs terminal.",
		);
	}
	for (const runId of await deps.fs.readDirectory(deps.paths.state.runsDir)) {
		let path: string;
		try {
			path = deps.paths.state.runFile(runId);
		} catch {
			return corruptRunState("shared-run state contains an unsafe identity.");
		}
		const read = await readDurableFile(deps.fs, path);
		if (read.status !== "present") {
			return corruptRunState(
				"shared-run state is unreadable during activation.",
			);
		}
		const parsed = parseDurableRecord(read.raw, "shared-run");
		if (!parsed.ok) {
			return corruptRunState("shared-run state is corrupt during activation.");
		}
		const run = parsed.payload;
		const terminal =
			run.state === "confirmed" ||
			run.state === "not-achieved" ||
			run.state === "unknown";
		if (
			!terminal &&
			run.run_execution_binding?.generation_id === activeGenerationId &&
			(run.mutation_dispatched || run.postcondition !== undefined)
		) {
			return migrationFailure(
				"migration_prior_run_active",
				"a nonterminal mutation-capable prior-generation run blocks activation.",
			);
		}
	}
	return undefined;
}

function retainedAfterActivation(
	active: BrowserUseCorpusGenerationManifestPayload | undefined,
): readonly BrowserUseCorpusGenerationIdentity[] {
	if (active === undefined) return [];
	const leaving = currentIdentity(active);
	const byActivation = new Map<string, BrowserUseCorpusGenerationIdentity>();
	for (const identity of active.retained_generations) {
		byActivation.set(
			`${identity.generation_id}\0${identity.activation_epoch}`,
			identity,
		);
	}
	byActivation.set(
		`${leaving.generation_id}\0${leaving.activation_epoch}`,
		leaving,
	);
	return [...byActivation.values()].sort(
		(left, right) => left.activation_epoch - right.activation_epoch,
	);
}

/**
 * Activate a complete verified corpus generation through a fenced CAS.
 *
 * The migration facade owns state loading; this owner receives that immutable
 * phase snapshot so the activation dependency graph stays acyclic.
 *
 * @param deps - Admitted migration-store dependencies
 * @param input - Optional explicit immediate-prior generation for pre-effect rollback
 * @param standing - Migration phase state observed before activation
 * @returns Success after authoritative manifest commit, or one typed refusal
 * @internal
 */
export async function activateBrowserUseGeneration(
	deps: RetentionDeps,
	input: { generationId?: string },
	standing: BrowserUseMigrationState | BrowserUseMigrationStatus,
): Promise<{ ok: true } | BrowserUseMigrationFailure> {
	const activeRead = await readActiveCorpusManifest(deps);
	if (activeRead.status === "corrupt") {
		return migrationFailure(activeRead.code, activeRead.message);
	}
	const active =
		activeRead.status === "present" ? activeRead.manifest : undefined;
	const targetGenerationId = input.generationId ?? standing.staged_generation;
	if (targetGenerationId === null || targetGenerationId === undefined) {
		return migrationFailure(
			"migration_not_verified",
			"activation requires one verified staged generation.",
		);
	}
	if (!safeSinglePathSegment(targetGenerationId)) {
		return migrationFailure(
			"migration_generation_missing",
			"activation target generation identity is unsafe.",
		);
	}
	const sameGeneration = active?.generation_id === targetGenerationId;
	const rollback =
		input.generationId !== undefined &&
		active?.prior_generation?.generation_id === targetGenerationId;
	if (!sameGeneration && !rollback && standing.phase !== "verified") {
		return migrationFailure(
			"migration_not_verified",
			"default activation target is not verified.",
		);
	}
	if (
		input.generationId !== undefined &&
		active !== undefined &&
		!sameGeneration &&
		!rollback &&
		input.generationId !== standing.staged_generation
	) {
		return migrationFailure(
			"migration_rollback_refused",
			"explicit activation may select only the verified staged generation or immediate prior generation.",
		);
	}
	if (
		rollback &&
		(active?.prior_generation === null ||
			active?.prior_generation === undefined ||
			active.prior_generation.generation_id !== targetGenerationId)
	) {
		return migrationFailure(
			"migration_rollback_refused",
			"explicit activation may select only the immediate verified prior generation.",
		);
	}
	if (rollback && active !== undefined) {
		const fence = await readEffectFence(deps, active.activation_epoch);
		if (
			fence.status !== "present" ||
			fence.fence.generation_id !== active.generation_id
		) {
			return migrationFailure(
				"migration_effect_fence_corrupt",
				"active generation effect fence is missing or corrupt.",
			);
		}
		if (fence.fence.state === "tripped") {
			return migrationFailure(
				"migration_effect_fence_tripped",
				"active generation has durable effects; repair forward.",
			);
		}
	}
	const candidateRead = await readCandidateManifest(deps, targetGenerationId);
	if (candidateRead.status === "missing") {
		return migrationFailure(
			candidateRead.kind === "generation"
				? "migration_generation_missing"
				: "migration_candidate_missing",
			candidateRead.kind === "generation"
				? "activation target generation is missing."
				: "activation target has no candidate manifest.",
		);
	}
	if (candidateRead.status === "corrupt") {
		return migrationFailure(
			candidateRead.kind === "generation"
				? "migration_generation_corrupt"
				: "migration_candidate_corrupt",
			candidateRead.message,
		);
	}
	if (
		sameGeneration &&
		active !== undefined &&
		!activeManifestMatchesCandidate(active, candidateRead)
	) {
		return migrationFailure(
			"migration_active_manifest_corrupt",
			"active corpus manifest does not match its immutable generation identity.",
		);
	}
	if (
		rollback &&
		active?.prior_generation !== null &&
		active?.prior_generation !== undefined &&
		(candidateRead.generationContentHash !==
			active.prior_generation.generation_content_hash ||
			candidateRead.candidateDigest !==
				active.prior_generation.candidate_manifest_digest)
	) {
		return migrationFailure(
			"migration_candidate_corrupt",
			"rollback target no longer matches its retained activation identity.",
		);
	}
	const validated = await validateCandidateClosure(
		deps,
		candidateRead,
		sameGeneration || rollback ? undefined : standing,
	);
	if (!validated.ok) return validated;
	if (sameGeneration) return { ok: true };

	const outcome = await withActivationEpochBarrier(
		deps,
		{ holderId: `migration-activate-${targetGenerationId}` },
		async (): Promise<
			| { ok: true; manifest: BrowserUseCorpusGenerationManifestPayload }
			| BrowserUseMigrationFailure
		> => {
			const observedActiveRead = await readActiveCorpusManifest(deps);
			if (observedActiveRead.status === "corrupt") {
				return migrationFailure(
					observedActiveRead.code,
					observedActiveRead.message,
				);
			}
			const observedActive =
				observedActiveRead.status === "present"
					? observedActiveRead.manifest
					: undefined;
			if (observedActive?.generation_id === targetGenerationId) {
				return activeManifestMatchesCandidate(observedActive, candidateRead)
					? { ok: true, manifest: observedActive }
					: migrationFailure(
							"migration_active_manifest_corrupt",
							"active corpus manifest does not match its immutable generation identity.",
						);
			}
			if (
				observedActive?.generation_id !== active?.generation_id ||
				observedActive?.activation_epoch !== active?.activation_epoch
			) {
				return migrationFailure(
					"migration_activation_conflict",
					"active generation changed while candidate validation was running.",
				);
			}
			if (rollback && observedActive !== undefined) {
				const fence = await readEffectFence(
					deps,
					observedActive.activation_epoch,
				);
				if (
					fence.status !== "present" ||
					fence.fence.state !== "untripped" ||
					fence.fence.generation_id !== observedActive.generation_id
				) {
					return migrationFailure(
						fence.status === "present" && fence.fence.state === "tripped"
							? "migration_effect_fence_tripped"
							: "migration_effect_fence_corrupt",
						fence.status === "present" && fence.fence.state === "tripped"
							? "active generation has durable effects; repair forward."
							: "active generation effect fence is missing or corrupt.",
					);
				}
			}
			if (observedActive !== undefined) {
				const refusal = await priorGenerationMutationRefusal(
					deps,
					observedActive.generation_id,
				);
				if (refusal !== undefined) return refusal;
			}
			const epoch = await readActivationEpochRecord(deps);
			if (epoch.status === "corrupt") {
				return migrationFailure(
					"migration_activation_conflict",
					"activation epoch is corrupt.",
				);
			}
			const targetPending: BrowserUseActivationPendingPayload = {
				expected_epoch: epoch.epoch,
				target_generation_id: targetGenerationId,
				generation_content_hash: candidateRead.generationContentHash,
				candidate_manifest_digest: candidateRead.candidateDigest,
			};
			const pendingRead = await readActivationPending(deps);
			let activationEpoch: number;
			if (
				pendingRead.status === "present" &&
				pendingRead.pending.expected_epoch + 1 === epoch.epoch &&
				observedActive?.activation_epoch !== epoch.epoch
			) {
				if (
					pendingRead.pending.target_generation_id !== targetGenerationId ||
					pendingRead.pending.generation_content_hash !==
						candidateRead.generationContentHash ||
					pendingRead.pending.candidate_manifest_digest !==
						candidateRead.candidateDigest
				) {
					return migrationFailure(
						"migration_activation_conflict",
						"a different candidate owns the already-advanced activation epoch.",
					);
				}
				activationEpoch = epoch.epoch;
			} else {
				if (
					pendingRead.status === "corrupt" ||
					(observedActive !== undefined &&
						observedActive.activation_epoch !== epoch.epoch)
				) {
					return migrationFailure(
						"migration_activation_conflict",
						"activation pending or epoch state is inconsistent.",
					);
				}
				const pendingWrite = await writeDurableFile(deps.fs, {
					path: activationPendingPath(deps),
					contents: encodeDurableRecord("activation-pending", targetPending),
				});
				if (!pendingWrite.ok) {
					return migrationFailure(
						"store_flush_failed",
						pendingWrite.failure.message,
					);
				}
				activationEpoch = epoch.epoch + 1;
				const epochWrite = await writeDurableFile(deps.fs, {
					path: deps.paths.state.epochFile,
					contents: encodeDurableRecord("activation-epoch", {
						epoch: activationEpoch,
					}),
				});
				if (!epochWrite.ok) {
					return migrationFailure(
						"store_flush_failed",
						epochWrite.failure.message,
					);
				}
			}

			await deps.fs.mkdir(
				join(
					deps.paths.state.migrationsDir,
					GENERATION_EFFECT_FENCES_DIR,
				),
				{ recursive: true, mode: 0o700 },
			);
			const fenceRead = await readEffectFence(deps, activationEpoch);
			const untrippedFence: BrowserUseGenerationEffectFencePayload = {
				generation_id: targetGenerationId,
				activation_epoch: activationEpoch,
				state: "untripped",
				tripped_at_epoch_ms: null,
				first_effect: null,
			};
			if (fenceRead.status === "missing") {
				const fenceWrite = await writeDurableFile(deps.fs, {
					path: generationEffectFencePath(deps, activationEpoch),
					contents: encodeDurableRecord(
						"generation-effect-fence",
						untrippedFence,
					),
				});
				if (!fenceWrite.ok) {
					return migrationFailure(
						"store_flush_failed",
						fenceWrite.failure.message,
					);
				}
			} else if (
				fenceRead.status === "corrupt" ||
				fenceRead.fence.generation_id !== targetGenerationId ||
				fenceRead.fence.activation_epoch !== activationEpoch ||
				fenceRead.fence.state !== "untripped"
			) {
				return migrationFailure(
					"migration_effect_fence_corrupt",
					"target activation effect fence is corrupt or already tripped.",
				);
			}

			const manifest: BrowserUseCorpusGenerationManifestPayload = {
				...candidateRead.candidate,
				contract: "browser-use.corpus-generation-manifest",
				generation_content_hash: candidateRead.generationContentHash,
				candidate_manifest_digest: candidateRead.candidateDigest,
				activation_epoch: activationEpoch,
				activated_at_epoch_ms: deps.clock(),
				prior_generation:
					observedActive === undefined
						? null
						: currentIdentity(observedActive),
				retained_generations: retainedAfterActivation(observedActive),
			};
			const committed = await writeDurableFile(deps.fs, {
				path: activeCorpusManifestPath(deps),
				contents: encodeDurableRecord(
					"corpus-generation-manifest",
					manifest,
				),
			});
			if (!committed.ok) {
				return migrationFailure(
					"store_flush_failed",
					committed.failure.message,
				);
			}
			return { ok: true, manifest };
		},
	);
	if (!outcome.ok) {
		if (outcome.code === "epoch_store_failed") {
			return migrationFailure("store_flush_failed", outcome.message);
		}
		return outcome;
	}
	return { ok: true };
}

/**
 * Permanently close one active generation's pre-effect rollback window.
 *
 * @param deps - Admitted migration-store dependencies
 * @param input - Exact active identity plus the first durable effect
 * @returns The monotonic fence, or one typed refusal
 *
 * @example
 * ```typescript
 * await tripActiveGenerationEffectFence(deps, {
 *   generationId,
 *   activationEpoch,
 *   effectKind: "generation-run",
 *   effectRef: runId,
 * })
 * ```
 */
export async function tripActiveGenerationEffectFence(
	deps: RetentionDeps,
	input: {
		generationId: string;
		activationEpoch: number;
		effectKind: BrowserUseGenerationEffectKind;
		effectRef: string;
	},
): Promise<
	| { ok: true; fence: BrowserUseGenerationEffectFencePayload }
	| BrowserUseMigrationFailure
> {
	if (
		!(BROWSER_USE_GENERATION_EFFECT_KINDS as readonly string[]).includes(
			input.effectKind,
		) ||
		!SAFE_EFFECT_REF.test(input.effectRef)
	) {
		return migrationFailure(
			"migration_effect_fence_corrupt",
			"effect fence trip input is invalid.",
		);
	}
	const outcome = await withActivationEpochBarrier(
		deps,
		{ holderId: `effect-fence-${input.activationEpoch}` },
		async (): Promise<
			| { ok: true; fence: BrowserUseGenerationEffectFencePayload }
			| BrowserUseMigrationFailure
		> => {
			const active = await readActiveCorpusManifest(deps);
			if (
				active.status !== "present" ||
				active.manifest.generation_id !== input.generationId ||
				active.manifest.activation_epoch !== input.activationEpoch
			) {
				return migrationFailure(
					active.status === "corrupt"
						? "migration_active_manifest_corrupt"
						: "migration_activation_conflict",
					active.status === "corrupt"
						? active.message
						: "effect fence identity is not the active generation.",
				);
			}
			const current = await readEffectFence(deps, input.activationEpoch);
			if (
				current.status !== "present" ||
				current.fence.generation_id !== input.generationId
			) {
				return migrationFailure(
					"migration_effect_fence_corrupt",
					"active generation effect fence is missing or corrupt.",
				);
			}
			if (current.fence.state === "tripped") {
				return { ok: true, fence: current.fence };
			}
			const tripped: BrowserUseGenerationEffectFencePayload = {
				...current.fence,
				state: "tripped",
				tripped_at_epoch_ms: deps.clock(),
				first_effect: {
					effect_kind: input.effectKind,
					effect_ref: input.effectRef,
				},
			};
			const written = await writeDurableFile(deps.fs, {
				path: generationEffectFencePath(deps, input.activationEpoch),
				contents: encodeDurableRecord("generation-effect-fence", tripped),
			});
			if (!written.ok) {
				return migrationFailure(
					"store_flush_failed",
					written.failure.message,
				);
			}
			return { ok: true, fence: tripped };
		},
	);
	if (!outcome.ok && outcome.code === "epoch_store_failed") {
		return migrationFailure("store_flush_failed", outcome.message);
	}
	return outcome;
}
