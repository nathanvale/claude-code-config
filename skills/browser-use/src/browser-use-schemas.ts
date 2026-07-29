// ---------------------------------------------------------------------------
// Versioned durable-record schemas (platform plan 2026-07-21-002 U2).
//
// The one vocabulary for every durable file Browser Use persists (R10, R24,
// R29): a single record envelope (record/schema_version/payload), the
// shared-run payload, lease and activation-epoch records, generation and
// source-snapshot records, artifact manifests, retention tombstones, and
// redacted run receipts — plus the parse/validate matrix and the mechanical
// redaction walker. Pure schema module: no I/O of any kind. Imports point
// only at the U1 run model and the core leaf; store/locks/retention/runs
// (U2) consume this vocabulary, never the reverse. Auth appears ONLY as the
// opaque U1 slot and reference types — no payload field may carry a
// credential, cookie, session token, endpoint URL, or 1Password reference,
// and `findRedactionViolations` is the mechanical check.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import {
	hasSensitiveOptionName,
	isBrowserAdapterId,
	isJsonObject,
	redactUnsafeText,
	stringField,
} from "./browser-use-core";
import {
	activationPendingProblem,
	corpusGenerationCandidateProblem,
	corpusGenerationManifestProblem,
	generationEffectFenceProblem,
	generationProblem,
} from "./browser-use-generation-schemas";
import type {
	BrowserUseActivationPendingPayload,
	BrowserUseCorpusGenerationCandidatePayload,
	BrowserUseCorpusGenerationManifestPayload,
	BrowserUseGenerationEffectFencePayload,
	BrowserUseGenerationPayload,
} from "./browser-use-generation-schemas";
import {
	type BrowserUseArtifactRetentionClass,
	type BrowserUseRunIssueCode,
	type BrowserUseRunReceipt,
	type BrowserUseRunState,
	type BrowserUseSharedRun,
	type BrowserUseTaskIntent,
	BROWSER_USE_RUN_STATES,
	BROWSER_USE_TASK_INTENTS,
	runExecutionBindingValidationProblem,
	runItemBatchValidationProblem,
	validateSharedRun,
} from "./browser-use-run-model";
import {
	type BrowserUseAuthAttestation,
	BROWSER_USE_AUTH_IDENTITY_BASES,
} from "./browser-use-auth-model";
import type { BrowserAdapterId } from "./discovery-model";

export {
	BROWSER_USE_CORPUS_TARGET_ACTIVATIONS,
	BROWSER_USE_GENERATION_EFFECT_KINDS,
} from "./browser-use-generation-schemas";
export type {
	BrowserUseActivationPendingPayload,
	BrowserUseCorpusGenerationActionRef,
	BrowserUseCorpusGenerationAuthCandidateRef,
	BrowserUseCorpusGenerationAuthRouteRef,
	BrowserUseCorpusGenerationCandidatePayload,
	BrowserUseCorpusGenerationIdentity,
	BrowserUseCorpusGenerationManifestPayload,
	BrowserUseCorpusGenerationProofRef,
	BrowserUseCorpusGenerationTarget,
	BrowserUseCorpusTargetActivation,
	BrowserUseGenerationEffectFencePayload,
	BrowserUseGenerationEffectKind,
	BrowserUseGenerationPayload,
} from "./browser-use-generation-schemas";

// --- Record envelope (R10) ---------------------------------------------------

/**
 * Durable record kinds. Store-internal identity; command output keeps the U1
 * result-contract ids (`BROWSER_USE_SHARED_RUN_CONTRACT_ID` etc.).
 */
export const BROWSER_USE_DURABLE_RECORD_KINDS = [
	"shared-run",
	"run-lease",
	"activation-epoch",
	"generation",
	"corpus-generation-candidate",
	"corpus-generation-manifest",
	"generation-effect-fence",
	"activation-pending",
	"source-snapshot",
	"artifact-manifest",
	"tombstone",
	"run-receipt",
	"auth-attestation",
] as const;

/** Durable record kind union. */
export type BrowserUseDurableRecordKind =
	(typeof BROWSER_USE_DURABLE_RECORD_KINDS)[number];

/** Base envelope version for legacy shared runs and every other record kind. */
export const BROWSER_USE_DURABLE_SCHEMA_VERSION = "1";

/**
 * Shared runs carrying private runbook state or structured results use a new
 * envelope version so older binaries reject rather than project unknown keys.
 */
export const BROWSER_USE_SHARED_RUN_SCHEMA_VERSION = "2";

/** Every durable file is exactly one JSON record in this envelope. */
export type BrowserUseDurableRecord<K extends BrowserUseDurableRecordKind, P> = {
	record: K;
	schema_version: K extends "shared-run"
		?
				| typeof BROWSER_USE_DURABLE_SCHEMA_VERSION
				| typeof BROWSER_USE_SHARED_RUN_SCHEMA_VERSION
		: typeof BROWSER_USE_DURABLE_SCHEMA_VERSION;
	payload: P;
};

// --- Payloads ---------------------------------------------------------------

/**
 * Persisted shared run (R24): the U1 shared run plus persistence timestamps.
 * Both instants come from the injected clock — never `Date.now`.
 */
export type BrowserUseSharedRunPayload = BrowserUseSharedRun & {
	created_at_epoch_ms: number;
	updated_at_epoch_ms: number;
};

/**
 * Fenced lease record (R27): holder, heartbeat, expiry, monotonic fencing
 * token, activation epoch, and the stale-recovery proof when this lease was
 * a fenced takeover.
 */
export type BrowserUseLeasePayload = {
	/** Serialization key (see runs.leaseKeyForRun). */
	key: string;
	holder_id: string;
	/** Monotonic per key; NEVER resets. */
	fencing_token: number;
	activation_epoch: number;
	acquired_at_epoch_ms: number;
	heartbeat_at_epoch_ms: number;
	expires_at_epoch_ms: number;
	/** R27 stale-recovery proof: present when this lease was a fenced takeover. */
	recovered_from: {
		fencing_token: number;
		holder_id: string;
		observed_expired_at_epoch_ms: number;
	} | null;
	/** Inspection-only facets (R27 vocabulary); NOT part of the key in U2. */
	scope: { auth_context_ref?: string; target_id?: string; runbook_id?: string };
};

/** Activation-epoch record (R27). The epoch starts at 1 and only advances. */
export type BrowserUseActivationEpochPayload = { epoch: number };

/** Source snapshot record (R14 fields, consumed by U3). */
export type BrowserUseSourceSnapshotPayload = {
	snapshot_id: string;
	root_identity: string;
	entries: readonly {
		relative_path: string;
		type: "file" | "directory" | "symlink";
		size: number;
		mode: number;
		content_hash: string;
	}[];
	snapshot_digest: string;
};

/** Artifact manifest (R29): one field per clause. */
export type BrowserUseArtifactManifestPayload = {
	artifact_id: string;
	run_id: string;
	task_intent: BrowserUseTaskIntent;
	adapter_id: BrowserAdapterId;
	adapter_version: string;
	/** Core-redacted upstream; never a raw URL. */
	sanitized_target: { origin: string; path_shape?: string };
	producer_capability: string;
	content_hash: string;
	sensitivity: "low" | "high";
	retention: BrowserUseArtifactRetentionClass;
	/** Run receipt / outcome pointer. */
	outcome_ref: string | null;
	created_at_epoch_ms: number;
	/** Set by exportArtifact; presence == ownership transferred (R29). */
	export_receipt: {
		destination_digest: string;
		exported_at_epoch_ms: number;
	} | null;
};

/**
 * Redacted retention tombstone (R29): distinguishes deleted from missing or
 * corrupt. Two-phase so deletion stays crash-resumable and idempotent.
 */
export type BrowserUseTombstonePayload = {
	artifact_id: string;
	run_id: string;
	retention: BrowserUseArtifactRetentionClass;
	reason: "retention-expiry" | "explicit-delete";
	phase: "pending" | "complete";
	deleted_at_epoch_ms: number;
};

/** Persisted redacted run receipt (R24/R29) plus its content digest. */
export type BrowserUseRunReceiptPayload = BrowserUseRunReceipt & {
	/** sha256 of the redacted receipt body. */
	receipt_digest: string;
};

/**
 * Persisted bounded auth attestation (R30, auth plan U3a). The payload IS the
 * auth-owned attestation value — one type, so the durable form can never
 * drift from `authAttestationDigestOf`'s canonical key set. The file name is
 * the record's own full 64-hex content digest; verification stays auth-owned
 * (`createBrowserUseAuthContract`), the platform only stores and retrieves.
 */
export type BrowserUseAuthAttestationPayload = BrowserUseAuthAttestation;

/** Payload type carried by each durable record kind. */
type BrowserUseDurablePayloadMap = {
	"shared-run": BrowserUseSharedRunPayload;
	"run-lease": BrowserUseLeasePayload;
	"activation-epoch": BrowserUseActivationEpochPayload;
	generation: BrowserUseGenerationPayload;
	"corpus-generation-candidate": BrowserUseCorpusGenerationCandidatePayload;
	"corpus-generation-manifest": BrowserUseCorpusGenerationManifestPayload;
	"generation-effect-fence": BrowserUseGenerationEffectFencePayload;
	"activation-pending": BrowserUseActivationPendingPayload;
	"source-snapshot": BrowserUseSourceSnapshotPayload;
	"artifact-manifest": BrowserUseArtifactManifestPayload;
	tombstone: BrowserUseTombstonePayload;
	"run-receipt": BrowserUseRunReceiptPayload;
	"auth-attestation": BrowserUseAuthAttestationPayload;
};

/** Payload type for one durable record kind. */
export type PayloadOf<K extends BrowserUseDurableRecordKind> =
	BrowserUseDurablePayloadMap[K];

// --- Parse / validate matrix -------------------------------------------------

/**
 * Typed parse outcome for one durable record. Callers distinguish
 * missing/corrupt/wrong-kind/wrong-version without exceptions.
 */
export type DurableRecordParse<P> =
	| { ok: true; payload: P }
	| {
			ok: false;
			code:
				| "record_json_invalid"
				| "record_kind_mismatch"
				| "record_version_unsupported"
				| "record_payload_invalid";
			message: string;
	  };

type BrowserUseSharedRunSchemaVersion =
	| typeof BROWSER_USE_DURABLE_SCHEMA_VERSION
	| typeof BROWSER_USE_SHARED_RUN_SCHEMA_VERSION;

function isSharedRunSchemaVersion(
	value: unknown,
): value is BrowserUseSharedRunSchemaVersion {
	return (
		value === BROWSER_USE_DURABLE_SCHEMA_VERSION ||
		value === BROWSER_USE_SHARED_RUN_SCHEMA_VERSION
	);
}

/**
 * Parse raw file text into one expected record kind (R10, R13 validation
 * step). Checks run in envelope order: JSON shape, record kind, schema
 * version, then the kind's payload invariants. Every message passes the core
 * redaction gate before it can reach a receipt or error envelope.
 *
 * @param raw - Raw durable file text
 * @param expected - Record kind the caller requires
 * @returns The typed payload, or one typed parse failure
 */
export function parseDurableRecord<K extends BrowserUseDurableRecordKind>(
	raw: string,
	expected: K,
): DurableRecordParse<PayloadOf<K>> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			ok: false,
			code: "record_json_invalid",
			message: "durable record is not valid JSON.",
		};
	}
	if (!isJsonObject(parsed)) {
		return {
			ok: false,
			code: "record_json_invalid",
			message: "durable record is not a JSON object envelope.",
		};
	}
	if (parsed.record !== expected) {
		const found = stringField(parsed.record) ?? "no record kind";
		return {
			ok: false,
			code: "record_kind_mismatch",
			message: redactUnsafeText(
				`expected record kind ${expected} but found ${found}.`,
			),
		};
	}
	const unsupportedVersion = (supportedVersions: string) => {
		const found = stringField(parsed.schema_version) ?? "no schema version";
		return {
			ok: false as const,
			code: "record_version_unsupported" as const,
			message: redactUnsafeText(
				`record kind ${expected} supports schema version ${supportedVersions} but found ${found}.`,
			),
		};
	};
	if (expected === "shared-run") {
		if (!isSharedRunSchemaVersion(parsed.schema_version)) {
			return unsupportedVersion(
				`${BROWSER_USE_DURABLE_SCHEMA_VERSION} or ${BROWSER_USE_SHARED_RUN_SCHEMA_VERSION}`,
			);
		}
		const versionProblem = sharedRunEnvelopeVersionProblem(
			parsed.schema_version,
			parsed.payload,
		);
		if (versionProblem !== undefined) {
			return {
				ok: false,
				code: "record_payload_invalid",
				message: redactUnsafeText(versionProblem),
			};
		}
	} else if (parsed.schema_version !== BROWSER_USE_DURABLE_SCHEMA_VERSION) {
		return unsupportedVersion(BROWSER_USE_DURABLE_SCHEMA_VERSION);
	}
	const problem = PAYLOAD_PROBLEMS[expected](parsed.payload);
	if (problem !== undefined) {
		return {
			ok: false,
			code: "record_payload_invalid",
			message: redactUnsafeText(problem),
		};
	}
	return { ok: true, payload: parsed.payload as PayloadOf<K> };
}

/**
 * Encode one durable record in its canonical persisted form: envelope,
 * tab-indented JSON, one trailing newline — stable diffs, one shape.
 *
 * @param kind - Durable record kind
 * @param payload - Payload for that kind
 * @returns Canonical file text for the store to write
 */
export function encodeDurableRecord<K extends BrowserUseDurableRecordKind>(
	kind: K,
	payload: PayloadOf<K>,
): string {
	let sharedRunUsesPrivateState = false;
	if (kind === "shared-run") {
		const sharedRun = payload as BrowserUseSharedRunPayload;
		const hasBinding = hasOwn(sharedRun, "runbook_target_binding");
		const hasProgress = hasOwn(sharedRun, "runbook_progress");
		const hasExecBinding = hasOwn(sharedRun, "run_execution_binding");
		const hasItemBatch = hasOwn(sharedRun, "item_batch");
		const hasStructuredResults = hasOwn(sharedRun, "structured_results");
		sharedRunUsesPrivateState =
			hasBinding ||
			hasProgress ||
			hasExecBinding ||
			hasItemBatch ||
			hasStructuredResults;
		if (sharedRunUsesPrivateState) {
			const privateStateProblem = sharedRunEnvelopeVersionProblem(
				BROWSER_USE_SHARED_RUN_SCHEMA_VERSION,
				sharedRun,
			);
			if (privateStateProblem !== undefined) {
				throw new TypeError(privateStateProblem);
			}
		}
	}
	const record: BrowserUseDurableRecord<K, PayloadOf<K>> = {
		record: kind,
		schema_version: (sharedRunUsesPrivateState
			? BROWSER_USE_SHARED_RUN_SCHEMA_VERSION
			: BROWSER_USE_DURABLE_SCHEMA_VERSION) as BrowserUseDurableRecord<
			K,
			PayloadOf<K>
		>["schema_version"],
		payload,
	};
	return `${JSON.stringify(record, null, "\t")}\n`;
}

// --- Shared-run payload validation (R24) --------------------------------------

/**
 * Shared-run payload issue codes: the U1 run invariants plus the
 * persistence-field checks the durable payload adds.
 */
export type BrowserUseSharedRunPayloadIssueCode =
	| BrowserUseRunIssueCode
	| "run_revision_invalid"
	| "run_timestamp_invalid";

/** One typed shared-run payload issue. */
export type BrowserUseSharedRunPayloadIssue = {
	code: BrowserUseSharedRunPayloadIssueCode;
	message: string;
};

/**
 * Validate the persisted shared-run payload (R24). Delegates the run
 * invariants to the U1 `validateSharedRun` guard — never re-derives them —
 * and adds the persistence-field checks: `revision` is a valid CAS token and
 * both clock-injected timestamps are present.
 *
 * @param payload - Persisted shared-run payload to validate
 * @returns Empty array when the payload satisfies every invariant
 */
export function validateSharedRunPayload(
	payload: BrowserUseSharedRunPayload,
): BrowserUseSharedRunPayloadIssue[] {
	const issues: BrowserUseSharedRunPayloadIssue[] = [...validateSharedRun(payload)];
	if (!isPositiveInteger(payload.revision)) {
		issues.push({
			code: "run_revision_invalid",
			message: "revision must be an integer >= 1 (the CAS token).",
		});
	}
	if (!isNonNegativeNumber(payload.created_at_epoch_ms)) {
		issues.push({
			code: "run_timestamp_invalid",
			message: "created_at_epoch_ms must be a non-negative finite number.",
		});
	}
	if (!isNonNegativeNumber(payload.updated_at_epoch_ms)) {
		issues.push({
			code: "run_timestamp_invalid",
			message: "updated_at_epoch_ms must be a non-negative finite number.",
		});
	}
	return issues;
}

// --- Redaction walker (R13, R29) ----------------------------------------------

/** One typed redaction violation found in a durable payload. */
export type BrowserUseRedactionViolation = {
	path: string;
	reason: "sensitive_key" | "secret_shaped_value";
};

/**
 * Keys that legally carry opaque U1 auth references (R6): their names match
 * the sensitive-key pattern, but their values are opaque references — never
 * credentials — so the key name alone is not a violation. Their value
 * subtrees are still walked.
 */
export const BROWSER_USE_OPAQUE_AUTH_REFERENCE_KEYS = [
	"auth_fragment",
	"auth_attestation",
	"auth_context_ref",
	"auth_context",
] as const;

// A string value carrying an op:// reference or a raw ws(s):// endpoint is
// secret-shaped regardless of its key (R13 redacted receipt).
const SECRET_SHAPED_VALUE = /\b(?:op|wss?):\/\//i;
const LOCAL_PATH_SHAPED_VALUE = /(?:^|[\s(])(?:~\/|\/)(?!\/)\S+/;

/**
 * Redaction guarantee (R13 "redacted receipt"; plan verification "no
 * secret-bearing fixture enters durable state"). Walks every key and string
 * value: a key matching the core sensitive-name pattern, or a value carrying
 * an `op://` reference or raw `ws://` endpoint, is a typed violation. The
 * `auth_fragment.fragment` subtree is SKIPPED, not certified: it is
 * auth-owned opaque content already admitted by `validateSecretFreeFragment`
 * at commit time; walking it would be platform introspection of auth content
 * (R6).
 *
 * @param payload - Durable payload (or full record) to walk
 * @param options - Extra dot-joined subtree paths to skip
 * @returns Every violation found; empty when the payload is redaction-clean
 */
export function findRedactionViolations(
	payload: unknown,
	options?: { skipPaths?: readonly string[] },
): readonly BrowserUseRedactionViolation[] {
	const violations: BrowserUseRedactionViolation[] = [];
	walkForViolations(
		payload,
		"",
		"",
		options?.skipPaths ?? [],
		violations,
		new WeakSet(),
	);
	return violations;
}

function walkForViolations(
	value: unknown,
	path: string,
	parentKey: string,
	skipPaths: readonly string[],
	out: BrowserUseRedactionViolation[],
	seen: WeakSet<object>,
): void {
	if (typeof value === "string") {
		const isSanitizedPathShape =
			path === "sanitized_target.path_shape" ||
			path.endsWith(".sanitized_target.path_shape");
		if (
			SECRET_SHAPED_VALUE.test(value) ||
			(!isSanitizedPathShape && LOCAL_PATH_SHAPED_VALUE.test(value))
		) {
			out.push({ path: path === "" ? "(root)" : path, reason: "secret_shaped_value" });
		}
		return;
	}
	if (typeof value !== "object" || value === null) return;
	// Durable records are acyclic JSON; guard in-memory callers anyway.
	if (seen.has(value)) return;
	seen.add(value);
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			walkForViolations(
				item,
				joinViolationPath(path, String(index)),
				parentKey,
				skipPaths,
				out,
				seen,
			);
		}
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		// R6 opacity: the auth-owned fragment subtree is skipped, not certified.
		if (key === "fragment" && parentKey === "auth_fragment") continue;
		const childPath = joinViolationPath(path, key);
		if (
			skipPaths.some(
				(skip) => childPath === skip || childPath.startsWith(`${skip}.`),
			)
		) {
			continue;
		}
		if (hasSensitiveOptionName(key) && !isOpaqueAuthReferenceKey(key)) {
			out.push({ path: childPath, reason: "sensitive_key" });
		}
		walkForViolations(child, childPath, key, skipPaths, out, seen);
	}
}

function joinViolationPath(path: string, segment: string): string {
	return path === "" ? segment : `${path}.${segment}`;
}

function isOpaqueAuthReferenceKey(key: string): boolean {
	return (BROWSER_USE_OPAQUE_AUTH_REFERENCE_KEYS as readonly string[]).includes(key);
}

// --- Run receipt (R24/R29) ----------------------------------------------------

/**
 * Build the redacted per-run receipt payload (R24/R29). Summary facts only:
 * intent, state, and — for a blocked run — its one next safe action by id,
 * so receipt listings stay actionable without echoing run detail.
 * `receipt_digest` is the sha256 of the redacted receipt body; no clock or
 * randomness enters, so the same run always yields the same receipt.
 *
 * @param run - Shared run to project
 * @returns Redacted receipt payload with its content digest
 */
export function receiptForRun(run: BrowserUseSharedRun): BrowserUseRunReceiptPayload {
	const detail =
		run.continuation === undefined
			? `${run.task_intent} run is ${run.state}.`
			: `${run.task_intent} run is ${run.state}; next: ${run.continuation.next_action_id}.`;
	const summary = redactUnsafeText(detail);
	const receipt_digest = createHash("sha256")
		.update(JSON.stringify([run.run_id, run.revision, run.state, summary]))
		.digest("hex");
	return {
		run_id: run.run_id,
		revision: run.revision,
		state: run.state,
		summary,
		receipt_digest,
	};
}

// --- Payload invariants per kind ---------------------------------------------

// Each validator reports the FIRST problem as a redaction-safe message that
// names the field path, never the offending value. Unknown extra keys are
// tolerated (forward-compatible within one schema version); missing or
// mistyped known fields are not.

const PAYLOAD_PROBLEMS: Record<
	BrowserUseDurableRecordKind,
	(payload: unknown) => string | undefined
> = {
	"shared-run": sharedRunProblem,
	"run-lease": leaseProblem,
	"activation-epoch": activationEpochProblem,
	generation: generationProblem,
	"corpus-generation-candidate": corpusGenerationCandidateProblem,
	"corpus-generation-manifest": corpusGenerationManifestProblem,
	"generation-effect-fence": generationEffectFenceProblem,
	"activation-pending": activationPendingProblem,
	"source-snapshot": snapshotProblem,
	"artifact-manifest": manifestProblem,
	tombstone: tombstoneProblem,
	"run-receipt": receiptProblem,
	"auth-attestation": authAttestationRecordProblem,
};

function sharedRunProblem(value: unknown): string | undefined {
	if (!isJsonObject(value)) return "shared-run payload must be a JSON object.";
	if (stringField(value.run_id) === undefined) {
		return "payload.run_id must be a non-empty string.";
	}
	if (!isFiniteNumber(value.revision)) return "payload.revision must be a number.";
	if (!isRunState(value.state)) {
		return "payload.state must be one of the nine run states.";
	}
	if (!isTaskIntent(value.task_intent)) {
		return "payload.task_intent must be a registered task intent.";
	}
	const profile = value.environment_profile;
	if (
		!isJsonObject(profile) ||
		stringField(profile.environment) === undefined ||
		stringField(profile.profile) === undefined
	) {
		return "payload.environment_profile must carry environment and profile strings.";
	}
	if (typeof value.mutation_dispatched !== "boolean") {
		return "payload.mutation_dispatched must be a boolean.";
	}
	if (!Array.isArray(value.artifacts)) return "payload.artifacts must be an array.";
	for (const [index, artifact] of value.artifacts.entries()) {
		if (
			!isJsonObject(artifact) ||
			stringField(artifact.artifact_id) === undefined ||
			!isSensitivity(artifact.sensitivity) ||
			!isRetentionClass(artifact.retention)
		) {
			return `payload.artifacts.${index} must carry artifact_id, sensitivity, and retention.`;
		}
	}
	if (value.adapter_id !== undefined && !isBrowserAdapterId(value.adapter_id)) {
		return "payload.adapter_id must be a registered adapter id.";
	}
	if (
		value.handoff_evidence_id !== undefined &&
		stringField(value.handoff_evidence_id) === undefined
	) {
		return "payload.handoff_evidence_id must be a non-empty string.";
	}
	if (value.runbook_target_binding !== undefined) {
		const problem = runbookTargetBindingProblem(value.runbook_target_binding);
		if (problem !== undefined) return problem;
	}
	if (value.runbook_progress !== undefined) {
		const problem = runbookProgressProblem(value.runbook_progress);
		if (problem !== undefined) return problem;
	}
	if (value.run_execution_binding !== undefined) {
		const problem = runExecutionBindingValidationProblem(
			value.run_execution_binding,
		);
		if (problem !== undefined) return problem;
	}
	if (value.item_batch !== undefined) {
		const problem = runItemBatchValidationProblem(value.item_batch);
		if (problem !== undefined) return problem;
	}
	if (value.auth_fragment !== undefined) {
		const slot = value.auth_fragment;
		// Opacity boundary (R6): the platform reads schema_version ONLY.
		if (
			!isJsonObject(slot) ||
			stringField(slot.schema_version) === undefined ||
			!("fragment" in slot)
		) {
			return "payload.auth_fragment must carry schema_version and an opaque fragment.";
		}
	}
	if (value.auth_attestation !== undefined) {
		const reference = value.auth_attestation;
		if (
			!isJsonObject(reference) ||
			stringField(reference.attestation_digest) === undefined ||
			!isNonNegativeNumber(reference.fresh_until_epoch_ms)
		) {
			return "payload.auth_attestation must carry attestation_digest and fresh_until_epoch_ms.";
		}
	}
	if (value.postcondition !== undefined && !isIdSummary(value.postcondition, "id")) {
		return "payload.postcondition must carry id and summary strings.";
	}
	if (
		value.continuation !== undefined &&
		!isIdSummary(value.continuation, "next_action_id")
	) {
		return "payload.continuation must carry next_action_id and summary strings.";
	}
	if (value.caller !== undefined) {
		const caller = value.caller;
		if (
			!isJsonObject(caller) ||
			(caller.label !== null && typeof caller.label !== "string")
		) {
			return "payload.caller.label must be a string or null.";
		}
	}
	if (!isNonNegativeNumber(value.created_at_epoch_ms)) {
		return "payload.created_at_epoch_ms must be a non-negative number.";
	}
	if (!isNonNegativeNumber(value.updated_at_epoch_ms)) {
		return "payload.updated_at_epoch_ms must be a non-negative number.";
	}
	const issues = validateSharedRunPayload(value as BrowserUseSharedRunPayload);
	return issues.length === 0 ? undefined : issues[0]?.message;
}

function sharedRunEnvelopeVersionProblem(
	version: "1" | "2",
	value: unknown,
): string | undefined {
	if (!isJsonObject(value)) return undefined;
	const hasBinding = hasOwn(value, "runbook_target_binding");
	const hasProgress = hasOwn(value, "runbook_progress");
	const hasExecBinding = hasOwn(value, "run_execution_binding");
	const hasItemBatch = hasOwn(value, "item_batch");
	const hasStructuredResults = hasOwn(value, "structured_results");
	if (version === BROWSER_USE_DURABLE_SCHEMA_VERSION) {
		return hasBinding ||
			hasProgress ||
			hasExecBinding ||
			hasItemBatch ||
			hasStructuredResults
			? "shared-run schema version 1 must not carry private runbook target, progress, execution-binding, item-batch, or structured-result state."
			: undefined;
	}
	// Version 2 carries the runbook target binding + progress pair; the U3
	// execution binding and item-batch are OPTIONAL additional private state.
	if (!hasBinding || !hasProgress) {
		return "shared-run schema version 2 must carry both runbook_target_binding and runbook_progress.";
	}
	if (hasExecBinding) {
		const problem = runExecutionBindingValidationProblem(
			value.run_execution_binding,
		);
		if (problem !== undefined) return problem;
	}
	if (hasItemBatch) {
		const problem = runItemBatchValidationProblem(value.item_batch);
		if (problem !== undefined) return problem;
	}
	return (
		runbookTargetBindingProblem(value.runbook_target_binding) ??
		runbookProgressProblem(value.runbook_progress)
	);
}

function runbookTargetBindingProblem(value: unknown): string | undefined {
	if (
		!isJsonObject(value) ||
		value.schema_version !== "1" ||
		(value.mode !== "exact" && value.mode !== "automatic") ||
		stringField(value.binding_id) === undefined
	) {
		return "payload.runbook_target_binding must carry schema version 1, mode, and an opaque binding_id.";
	}
	return undefined;
}

function runbookProgressProblem(value: unknown): string | undefined {
	if (
		!isJsonObject(value) ||
		value.schema_version !== "1" ||
		stringField(value.service_id) === undefined ||
		stringField(value.flow_id) === undefined ||
		stringField(value.runbook_version) === undefined ||
		!isNonNegativeInteger(value.next_step) ||
		!isNonNegativeInteger(value.total_steps)
	) {
		return "payload.runbook_progress must carry schema version 1, runbook identity, and non-negative integer step counts.";
	}
	return undefined;
}

function hasOwn(value: object, key: PropertyKey): boolean {
	return Object.hasOwn(value, key);
}

function leaseProblem(value: unknown): string | undefined {
	if (!isJsonObject(value)) return "run-lease payload must be a JSON object.";
	if (stringField(value.key) === undefined) {
		return "payload.key must be a non-empty string.";
	}
	if (stringField(value.holder_id) === undefined) {
		return "payload.holder_id must be a non-empty string.";
	}
	if (!isPositiveInteger(value.fencing_token)) {
		return "payload.fencing_token must be an integer >= 1.";
	}
	if (!isPositiveInteger(value.activation_epoch)) {
		return "payload.activation_epoch must be an integer >= 1.";
	}
	if (!isNonNegativeNumber(value.acquired_at_epoch_ms)) {
		return "payload.acquired_at_epoch_ms must be a non-negative number.";
	}
	if (!isNonNegativeNumber(value.heartbeat_at_epoch_ms)) {
		return "payload.heartbeat_at_epoch_ms must be a non-negative number.";
	}
	if (!isNonNegativeNumber(value.expires_at_epoch_ms)) {
		return "payload.expires_at_epoch_ms must be a non-negative number.";
	}
	const recovered = value.recovered_from;
	if (recovered !== null) {
		if (
			!isJsonObject(recovered) ||
			!isPositiveInteger(recovered.fencing_token) ||
			stringField(recovered.holder_id) === undefined ||
			!isNonNegativeNumber(recovered.observed_expired_at_epoch_ms)
		) {
			return "payload.recovered_from must be null or a fenced-takeover proof.";
		}
	}
	const scope = value.scope;
	if (!isJsonObject(scope)) return "payload.scope must be a JSON object.";
	for (const facet of ["auth_context_ref", "target_id", "runbook_id"] as const) {
		if (scope[facet] !== undefined && stringField(scope[facet]) === undefined) {
			return `payload.scope.${facet} must be a non-empty string when present.`;
		}
	}
	return undefined;
}

function activationEpochProblem(value: unknown): string | undefined {
	if (!isJsonObject(value)) {
		return "activation-epoch payload must be a JSON object.";
	}
	if (!isPositiveInteger(value.epoch)) {
		return "payload.epoch must be an integer >= 1.";
	}
	return undefined;
}

const SNAPSHOT_ENTRY_TYPES = ["file", "directory", "symlink"] as const;

function snapshotProblem(value: unknown): string | undefined {
	if (!isJsonObject(value)) return "source-snapshot payload must be a JSON object.";
	if (stringField(value.snapshot_id) === undefined) {
		return "payload.snapshot_id must be a non-empty string.";
	}
	if (stringField(value.root_identity) === undefined) {
		return "payload.root_identity must be a non-empty string.";
	}
	if (!Array.isArray(value.entries)) return "payload.entries must be an array.";
	for (const [index, entry] of value.entries.entries()) {
		if (
			!isJsonObject(entry) ||
			stringField(entry.relative_path) === undefined ||
			!(SNAPSHOT_ENTRY_TYPES as readonly unknown[]).includes(entry.type) ||
			!isNonNegativeNumber(entry.size) ||
			!isFiniteNumber(entry.mode) ||
			stringField(entry.content_hash) === undefined
		) {
			return `payload.entries.${index} must carry relative_path, type, size, mode, and content_hash.`;
		}
	}
	if (stringField(value.snapshot_digest) === undefined) {
		return "payload.snapshot_digest must be a non-empty string.";
	}
	return undefined;
}

function manifestProblem(value: unknown): string | undefined {
	if (!isJsonObject(value)) return "artifact-manifest payload must be a JSON object.";
	if (stringField(value.artifact_id) === undefined) {
		return "payload.artifact_id must be a non-empty string.";
	}
	if (stringField(value.run_id) === undefined) {
		return "payload.run_id must be a non-empty string.";
	}
	if (!isTaskIntent(value.task_intent)) {
		return "payload.task_intent must be a registered task intent.";
	}
	if (!isBrowserAdapterId(value.adapter_id)) {
		return "payload.adapter_id must be a registered adapter id.";
	}
	if (stringField(value.adapter_version) === undefined) {
		return "payload.adapter_version must be a non-empty string.";
	}
	const target = value.sanitized_target;
	if (
		!isJsonObject(target) ||
		stringField(target.origin) === undefined ||
		(target.path_shape !== undefined && stringField(target.path_shape) === undefined)
	) {
		return "payload.sanitized_target must carry origin and optionally path_shape.";
	}
	if (stringField(value.producer_capability) === undefined) {
		return "payload.producer_capability must be a non-empty string.";
	}
	if (stringField(value.content_hash) === undefined) {
		return "payload.content_hash must be a non-empty string.";
	}
	if (!isSensitivity(value.sensitivity)) {
		return "payload.sensitivity must be low or high.";
	}
	if (!isRetentionClass(value.retention)) {
		return "payload.retention must be a registered retention class.";
	}
	if (value.outcome_ref !== null && stringField(value.outcome_ref) === undefined) {
		return "payload.outcome_ref must be null or a non-empty string.";
	}
	if (!isNonNegativeNumber(value.created_at_epoch_ms)) {
		return "payload.created_at_epoch_ms must be a non-negative number.";
	}
	const exportReceipt = value.export_receipt;
	if (exportReceipt !== null) {
		if (
			!isJsonObject(exportReceipt) ||
			stringField(exportReceipt.destination_digest) === undefined ||
			!isNonNegativeNumber(exportReceipt.exported_at_epoch_ms)
		) {
			return "payload.export_receipt must be null or carry destination_digest and exported_at_epoch_ms.";
		}
	}
	return undefined;
}

const TOMBSTONE_REASONS = ["retention-expiry", "explicit-delete"] as const;
const TOMBSTONE_PHASES = ["pending", "complete"] as const;

function tombstoneProblem(value: unknown): string | undefined {
	if (!isJsonObject(value)) return "tombstone payload must be a JSON object.";
	if (stringField(value.artifact_id) === undefined) {
		return "payload.artifact_id must be a non-empty string.";
	}
	if (stringField(value.run_id) === undefined) {
		return "payload.run_id must be a non-empty string.";
	}
	if (!isRetentionClass(value.retention)) {
		return "payload.retention must be a registered retention class.";
	}
	if (!(TOMBSTONE_REASONS as readonly unknown[]).includes(value.reason)) {
		return "payload.reason must be retention-expiry or explicit-delete.";
	}
	if (!(TOMBSTONE_PHASES as readonly unknown[]).includes(value.phase)) {
		return "payload.phase must be pending or complete.";
	}
	if (!isNonNegativeNumber(value.deleted_at_epoch_ms)) {
		return "payload.deleted_at_epoch_ms must be a non-negative number.";
	}
	return undefined;
}

function receiptProblem(value: unknown): string | undefined {
	if (!isJsonObject(value)) return "run-receipt payload must be a JSON object.";
	if (stringField(value.run_id) === undefined) {
		return "payload.run_id must be a non-empty string.";
	}
	if (!isPositiveInteger(value.revision)) {
		return "payload.revision must be an integer >= 1.";
	}
	if (!isRunState(value.state)) {
		return "payload.state must be one of the nine run states.";
	}
	if (typeof value.summary !== "string") {
		return "payload.summary must be a string.";
	}
	if (stringField(value.receipt_digest) === undefined) {
		return "payload.receipt_digest must be a non-empty string.";
	}
	return undefined;
}

// Every attestation field the canonical digest covers is required; a record
// missing one could never re-prove its own file name. Ordering of the two
// instants is a shape invariant: a bound that expires before it was observed
// is nonsense no verifier should ever consult.
const AUTH_ATTESTATION_STRING_FIELDS = [
	"run_id",
	"handoff_evidence_id",
	"lane_id",
	"implementation_integrity_key",
	"environment",
	"profile",
	"target_id",
	"page_id",
	"frame_id",
	"service_id",
	"auth_context",
	"subject_reference",
	"account_reference",
	"tenant_reference",
	"identity_basis_digest",
] as const;

function authAttestationRecordProblem(value: unknown): string | undefined {
	if (!isJsonObject(value)) {
		return "auth-attestation payload must be a JSON object.";
	}
	for (const field of AUTH_ATTESTATION_STRING_FIELDS) {
		if (stringField(value[field]) === undefined) {
			return `payload.${field} must be a non-empty string.`;
		}
	}
	if (
		!(BROWSER_USE_AUTH_IDENTITY_BASES as readonly unknown[]).includes(
			value.identity_basis,
		)
	) {
		return "payload.identity_basis must be exactly one identity basis.";
	}
	if (!isNonNegativeNumber(value.observed_at_epoch_ms)) {
		return "payload.observed_at_epoch_ms must be a non-negative number.";
	}
	if (!isNonNegativeNumber(value.fresh_until_epoch_ms)) {
		return "payload.fresh_until_epoch_ms must be a non-negative number.";
	}
	if (value.fresh_until_epoch_ms < value.observed_at_epoch_ms) {
		return "payload.fresh_until_epoch_ms must not precede payload.observed_at_epoch_ms.";
	}
	return undefined;
}

// --- Shared field guards -----------------------------------------------------

// Runtime projection of the U1 retention-class union (the U1 const is not
// exported). Record keys are compiler-checked exhaustive in both directions,
// so this cannot drift from the U1 type.
const ARTIFACT_RETENTION_CLASS_SET: Record<BrowserUseArtifactRetentionClass, true> = {
	ephemeral: true,
	"failure-evidence": true,
	export: true,
};

function isRetentionClass(value: unknown): value is BrowserUseArtifactRetentionClass {
	return typeof value === "string" && Object.hasOwn(ARTIFACT_RETENTION_CLASS_SET, value);
}

function isRunState(value: unknown): value is BrowserUseRunState {
	return (
		typeof value === "string" &&
		(BROWSER_USE_RUN_STATES as readonly string[]).includes(value)
	);
}

function isTaskIntent(value: unknown): value is BrowserUseTaskIntent {
	return (
		typeof value === "string" &&
		(BROWSER_USE_TASK_INTENTS as readonly string[]).includes(value)
	);
}

function isSensitivity(value: unknown): value is "low" | "high" {
	return value === "low" || value === "high";
}

function isIdSummary(value: unknown, idKey: "id" | "next_action_id"): boolean {
	return (
		isJsonObject(value) &&
		stringField(value[idKey]) !== undefined &&
		stringField(value.summary) !== undefined
	);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
	return isFiniteNumber(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
