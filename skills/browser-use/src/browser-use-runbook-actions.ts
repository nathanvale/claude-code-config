// ---------------------------------------------------------------------------
// Reviewed action registry, structured results, item checkpoints, and
// immutable run bindings (runbook catalog migration plan 2026-07-28-001 U3,
// R12/R16-R23/R38/R41-R42; AE4-AE6/AE13-AE14).
//
// The ONE owner of evaluated-code authority OUTSIDE runbooks (KTD5). A runbook
// references an action id plus an expected asset digest; it never embeds script
// bytes and never asserts its own approval. This module:
//
//   - Stores evaluated code as separate CONTENT-ADDRESSED action ASSETS (R16):
//     the asset id IS its sha256; a registry record binds id + expected digest
//     + exact allowed origin + audited effect class + typed input/result schemas
//     + required postcondition + source provenance + a promotion RECEIPT.
//   - Resolves an action ONLY through an explicit staged/active GENERATION seam
//     (the U2 active-generation seam), never loose files (R16/R38).
//   - VERIFIES every invariant BEFORE constructing an executor `evaluate` step
//     (R17/R18): registry record present, asset bytes match expected digest,
//     exact allowed origin, audited effect class, typed schemas, required
//     postcondition, source provenance, AND an operator-approved promotion
//     receipt. Any candidate / rejected / withdrawn / invalidated / missing /
//     changed-hash / wrong-origin / undeclared-effect / schema-mismatch /
//     unsupported-containment / missing-postcondition FAILS CLOSED with a typed
//     refusal, never a browser dispatch.
//   - Derives EFFECT CLASS from audited behavior (R19): navigation, clicks,
//     storage writes, network, and final-boundary effects are MUTATION unless
//     mechanically proven pure observation. A legacy risk label is evidence
//     only, never authority (KTD7).
//   - Captures BOUNDED structured results for read actions (R21): validate +
//     redact, then a bounded summary + digest + governed-artifact ref; large
//     payloads spill to retention-owned artifacts, never inline shared-run
//     state.
//   - Owns per-item CHECKPOINTS over stable keys (R12): a batch skips confirmed
//     items and resumes only from the FIRST unproven item; an item that may
//     have dispatched but has no fresh proof is `unknown` and BLOCKS the batch.
//   - Owns the IMMUTABLE run execution BINDING (R38): generation id + activation
//     epoch + service/flow/version/digest + action-registry digest + normalized
//     input digest + ordered item-key digest + target scope + postcondition;
//     resume rejects replacement authority from flags and resolves only the
//     pinned retained generation (KTD13).
//
// Pure model + guards only. No Date.now, no Math.random, no fs, no browser.
// The asset store I/O and generation resolution flow through injected seams.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import type { AgentBrowserPostcondition, AgentBrowserTaskStep } from "./browser-use-agent-browser";
import { redactUnsafeText } from "./browser-use-core";
import { SAFE_BATCH_ITEM_KEY } from "./browser-use-identifiers";
import {
	BROWSER_USE_RUN_STRUCTURED_RESULT_SUMMARY_MAX_LENGTH,
	type BrowserUseRunStructuredResult,
} from "./browser-use-run-model";
import type { BrowserUseRunbookPostcondition } from "./browser-use-runbook-model";
import {
	type BrowserUseReviewedActionPromotionReceipt,
	reviewedActionPromotionReceiptIsValid,
} from "./browser-use-reviewed-action-approval";

// --- Content addressing ------------------------------------------------------

/** Full lowercase 64-hex sha256 (an action asset id and every digest). */
const SAFE_DIGEST = /^[0-9a-f]{64}$/;
/** Safe registry action id (a stable slug, distinct from the byte digest). */
const SAFE_ACTION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Bounded action asset byte ceiling (mirrors the executor's script bound). */
export const ACTION_ASSET_MAX_BYTES = 100_000;
/** Bounded inline structured-result byte ceiling (R21 spillover threshold). */
export const STRUCTURED_RESULT_MAX_INLINE_BYTES = 4_096;
/** Bounded structured-result summary length carried on the shared-run outcome. */
export const STRUCTURED_RESULT_SUMMARY_MAX_LENGTH =
	BROWSER_USE_RUN_STRUCTURED_RESULT_SUMMARY_MAX_LENGTH;

/**
 * The sha256 of one action asset's exact bytes (R16 content addressing). The
 * digest IS the asset's identity; a registry record's `expected_digest` must
 * equal this for the exact current bytes, or resolution fails closed (R18).
 *
 * @param bytes - Exact action asset source bytes
 * @returns Lowercase 64-hex sha256
 */
export function actionAssetDigest(bytes: string): string {
	return createHash("sha256").update(bytes, "utf-8").digest("hex");
}

/** Whether a value can identify one exact content-addressed action asset. */
export function actionDigestIsValid(value: string): boolean {
	return SAFE_DIGEST.test(value);
}

// --- Audited effect class (R19, KTD7) ----------------------------------------

/**
 * The audited effect class an action asset is classified as (R19). Derived from
 * MECHANICALLY-observed behavior, never a legacy risk label: an action is a
 * mutation unless its bytes are proven pure observation.
 */
export const BROWSER_USE_ACTION_EFFECT_CLASSES = [
	"read",
	"mutation",
] as const;

/** Effect-class union. */
export type BrowserUseActionEffectClass =
	(typeof BROWSER_USE_ACTION_EFFECT_CLASSES)[number];

// Behavior fingerprints that make an action a MUTATION regardless of its
// declared/legacy label (R19). Navigation, clicks, storage writes, network
// effects, and final-boundary form submission are all mutations unless the
// bytes are proven pure observation. These are conservative: a false positive
// makes a truly-observational action carry write-ahead truth (safe); a false
// negative would let a mutation bypass it (unsafe), so the set errs toward
// mutation.
const MUTATION_BEHAVIOR_FINGERPRINTS: readonly RegExp[] = [
	/\b(?:location\s*\.\s*(?:href|assign|replace|reload))\b/i,
	/\bwindow\s*\.\s*open\b/i,
	/\bhistory\s*\.\s*(?:pushState|replaceState|back|forward|go)\b/i,
	/\.\s*click\s*\(/i,
	/\.\s*submit\s*\(/i,
	/\.\s*(?:setItem|removeItem|clear)\s*\(/i,
	/\b(?:localStorage|sessionStorage|indexedDB)\b/i,
	/\bdocument\s*\.\s*cookie\b/i,
	/\bfetch\s*\(/i,
	/\bXMLHttpRequest\b/i,
	/\bnavigator\s*\.\s*sendBeacon\b/i,
	/\bWebSocket\b/i,
	/\bEventSource\b/i,
	/\.\s*(?:value|checked|selected)\s*=/i, // a form-field write
	/\.\s*(?:dispatchEvent|requestSubmit)\s*\(/i,
];

// Positive proofs for the deliberately narrow observational action vocabulary.
// Absence from the mutation fingerprint list is not proof of observation:
// arbitrary JavaScript may mutate through an unrecognized API. Extend this list
// only for a reviewed, mechanically bounded source shape.
const OBSERVATIONAL_ACTION_PROOFS: readonly RegExp[] = [
	/^\s*async\s*\(\s*\{\s*inputs\s*\}\s*\)\s*=>\s*\(\s*\{\s*[A-Za-z_$][\w$]*\s*:\s*document\s*\.\s*querySelectorAll\s*\(\s*(?:'[^'\\]*'|"[^"\\]*")\s*\)\s*\.\s*length\s*\}\s*\)\s*;?\s*$/,
	/^\s*async\s*\(\s*\{\s*inputs\s*\}\s*\)\s*=>\s*JSON\s*\.\s*parse\s*\(\s*document\s*\.\s*querySelector\s*\(\s*(?:'[^'\\]*'|"[^"\\]*")\s*\)\s*\.\s*textContent\s*\)\s*;?\s*$/,
];

const OBSERVATIONAL_ESCAPE_FINGERPRINTS: readonly RegExp[] = [
	/\b(?:eval|Function|WebAssembly|Worker|SharedWorker|BroadcastChannel)\b/,
	/\b(?:globalThis|window)\b/,
	/\b(?:import|require)\s*\(/,
	/\bObject\s*\.\s*(?:assign|defineProperty|defineProperties|setPrototypeOf)\s*\(/,
	/\bReflect\s*\.\s*(?:set|defineProperty|deleteProperty|setPrototypeOf)\s*\(/,
	/(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*(?:\+\+|--|=(?!=)|[+\-*/%]=)/,
];

function observationalActionMechanicsProven(bytes: string): boolean {
	return (
		/^\s*async\s*\(\s*\{\s*inputs\s*\}\s*\)\s*=>/.test(bytes) &&
		/\bdocument\s*\.\s*querySelector(?:All)?\s*\(/.test(bytes) &&
		!OBSERVATIONAL_ESCAPE_FINGERPRINTS.some((pattern) => pattern.test(bytes))
	);
}

/**
 * Audit one action asset's bytes for mutation behavior (R19/KTD7). Returns the
 * effect class the bytes MECHANICALLY prove: `read` only when the complete
 * source matches a bounded observational proof; every mutation fingerprint and
 * every unrecognized source shape is `mutation`. A legacy `risk_class` never
 * overrides this — the audit is the authority.
 *
 * @param bytes - Exact action asset source bytes
 * @returns The mechanically-audited effect class
 */
export function auditActionEffectClass(bytes: string): BrowserUseActionEffectClass {
	if (MUTATION_BEHAVIOR_FINGERPRINTS.some((pattern) => pattern.test(bytes))) {
		return "mutation";
	}
	return OBSERVATIONAL_ACTION_PROOFS.some((pattern) => pattern.test(bytes)) ||
		observationalActionMechanicsProven(bytes)
		? "read"
		: "mutation";
}

// --- Typed value schemas (R17) ----------------------------------------------

/**
 * A bounded typed schema an action declares for its inputs and its result
 * (R17). Deliberately a small, code-owned vocabulary; the runbook's richer
 * recursive input schema is a separate concern (an action asset receives already
 * substituted scalar inputs). Every field is validated at resolution time.
 */
export type BrowserUseActionValueSchema =
	| { kind: "string"; max_length?: number; pattern?: string }
	| {
			kind: "number";
			integer?: boolean;
			minimum?: number;
			exclusive_minimum?: number;
			maximum?: number;
	  }
	| { kind: "boolean"; constant?: boolean }
	| { kind: "enum"; values: readonly string[] }
	| {
			kind: "array";
			items: BrowserUseActionValueSchema;
			min_items?: number;
			max_items?: number;
	  }
	| {
			kind: "object";
			fields: Readonly<
				Record<string, { schema: BrowserUseActionValueSchema; required: boolean }>
			>;
	  };

const ACTION_VALUE_MAX_ARRAY_LENGTH = 512;
const ACTION_VALUE_SCHEMA_MAX_DEPTH = 32;
const ACTION_VALUE_SCHEMA_MAX_NODES = 4_096;
const ACTION_VALUE_SCHEMA_MAX_STRING_BOUND = 100_000;
const ACTION_VALUE_SCHEMA_MAX_PATTERN_LENGTH = 512;
const ACTION_VALUE_SCHEMA_MAX_OBJECT_FIELDS = 512;
const ACTION_VALUE_SCHEMA_MAX_ENUM_VALUES = 512;

function objectHasOnlyKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
): boolean {
	const keys = Object.keys(value);
	return keys.length <= allowed.length && keys.every((key) => allowed.includes(key));
}

function optionalBoundedInteger(
	value: unknown,
	maximum: number,
): value is number | undefined {
	return (
		value === undefined ||
		(typeof value === "number" &&
			Number.isSafeInteger(value) &&
			value >= 0 &&
			value <= maximum)
	);
}

type ActionValueSchemaValidationState = {
	nodes: number;
	active: WeakSet<object>;
};

function stringSchemaIsValid(record: Record<string, unknown>): boolean {
	if (!objectHasOnlyKeys(record, ["kind", "max_length", "pattern"])) {
		return false;
	}
	if (
		!optionalBoundedInteger(
			record.max_length,
			ACTION_VALUE_SCHEMA_MAX_STRING_BOUND,
		)
	) {
		return false;
	}
	if (record.pattern === undefined) return true;
	if (
		typeof record.pattern !== "string" ||
		record.pattern.length > ACTION_VALUE_SCHEMA_MAX_PATTERN_LENGTH
	) {
		return false;
	}
	try {
		new RegExp(`^(?:${record.pattern})$`);
		return true;
	} catch {
		return false;
	}
}

function numberSchemaIsValid(record: Record<string, unknown>): boolean {
	if (
		!objectHasOnlyKeys(record, [
			"kind",
			"integer",
			"minimum",
			"exclusive_minimum",
			"maximum",
		])
	) {
		return false;
	}
	if (record.integer !== undefined && typeof record.integer !== "boolean") {
		return false;
	}
	if (
		(record.minimum !== undefined &&
			(typeof record.minimum !== "number" ||
				!Number.isFinite(record.minimum))) ||
		(record.exclusive_minimum !== undefined &&
			(typeof record.exclusive_minimum !== "number" ||
				!Number.isFinite(record.exclusive_minimum))) ||
		(record.maximum !== undefined &&
			(typeof record.maximum !== "number" || !Number.isFinite(record.maximum)))
	) {
		return false;
	}
	if (
		typeof record.minimum === "number" &&
		typeof record.maximum === "number" &&
		record.minimum > record.maximum
	) {
		return false;
	}
	return !(
		typeof record.exclusive_minimum === "number" &&
		typeof record.maximum === "number" &&
		record.exclusive_minimum >= record.maximum
	);
}

function enumSchemaIsValid(record: Record<string, unknown>): boolean {
	if (
		!objectHasOnlyKeys(record, ["kind", "values"]) ||
		!Array.isArray(record.values) ||
		record.values.length === 0 ||
		record.values.length > ACTION_VALUE_SCHEMA_MAX_ENUM_VALUES
	) {
		return false;
	}
	return (
		record.values.every(
			(item) =>
				typeof item === "string" &&
				item.length <= ACTION_VALUE_SCHEMA_MAX_STRING_BOUND,
		) && new Set(record.values).size === record.values.length
	);
}

function arraySchemaIsValid(
	record: Record<string, unknown>,
	depth: number,
	state: ActionValueSchemaValidationState,
): boolean {
	return (
		objectHasOnlyKeys(record, ["kind", "items", "min_items", "max_items"]) &&
		optionalBoundedInteger(record.min_items, ACTION_VALUE_MAX_ARRAY_LENGTH) &&
		optionalBoundedInteger(record.max_items, ACTION_VALUE_MAX_ARRAY_LENGTH) &&
		!((record.min_items as number | undefined) !== undefined &&
			(record.max_items as number | undefined) !== undefined &&
			(record.min_items as number) > (record.max_items as number)) &&
		isValueSchemaNode(record.items, depth + 1, state)
	);
}

function objectSchemaIsValid(
	record: Record<string, unknown>,
	depth: number,
	state: ActionValueSchemaValidationState,
): boolean {
	if (
		!objectHasOnlyKeys(record, ["kind", "fields"]) ||
		typeof record.fields !== "object" ||
		record.fields === null ||
		Array.isArray(record.fields)
	) {
		return false;
	}
	const entries = Object.entries(record.fields as Record<string, unknown>);
	if (entries.length > ACTION_VALUE_SCHEMA_MAX_OBJECT_FIELDS) return false;
	for (const [key, field] of entries) {
		if (
			key.length === 0 ||
			key.length > 128 ||
			typeof field !== "object" ||
			field === null ||
			Array.isArray(field)
		) {
			return false;
		}
		const descriptor = field as Record<string, unknown>;
		if (
			!objectHasOnlyKeys(descriptor, ["schema", "required"]) ||
			typeof descriptor.required !== "boolean" ||
			!isValueSchemaNode(descriptor.schema, depth + 1, state)
		) {
			return false;
		}
	}
	return true;
}

function isValueSchemaNode(
	value: unknown,
	depth: number,
	state: ActionValueSchemaValidationState,
): value is BrowserUseActionValueSchema {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		depth > ACTION_VALUE_SCHEMA_MAX_DEPTH
	) {
		return false;
	}
	state.nodes += 1;
	if (state.nodes > ACTION_VALUE_SCHEMA_MAX_NODES || state.active.has(value)) {
		return false;
	}
	state.active.add(value);
	try {
		const record = value as Record<string, unknown>;
		switch (record.kind) {
			case "string":
				return stringSchemaIsValid(record);
			case "number":
				return numberSchemaIsValid(record);
			case "boolean":
				return (
					objectHasOnlyKeys(record, ["kind", "constant"]) &&
					(record.constant === undefined || typeof record.constant === "boolean")
				);
			case "enum":
				return enumSchemaIsValid(record);
			case "array":
				return arraySchemaIsValid(record, depth, state);
			case "object":
				return objectSchemaIsValid(record, depth, state);
			default:
				return false;
		}
	} finally {
		state.active.delete(value);
	}
}

function isValueSchema(value: unknown): value is BrowserUseActionValueSchema {
	try {
		return isValueSchemaNode(value, 0, {
			nodes: 0,
			active: new WeakSet<object>(),
		});
	} catch {
		return false;
	}
}

/** Prove one authored action schema uses the model-owned bounded vocabulary. */
export function actionValueSchemaIsValid(value: unknown): value is BrowserUseActionValueSchema {
	return isValueSchema(value);
}

function stringValueMatches(
	value: unknown,
	schema: Extract<BrowserUseActionValueSchema, { kind: "string" }>,
): boolean {
	if (typeof value !== "string") return false;
	if (schema.max_length !== undefined && value.length > schema.max_length) {
		return false;
	}
	return (
		schema.pattern === undefined ||
		new RegExp(`^(?:${schema.pattern})$`).test(value)
	);
}

function numberValueMatches(
	value: unknown,
	schema: Extract<BrowserUseActionValueSchema, { kind: "number" }>,
): boolean {
	if (typeof value !== "number" || !Number.isFinite(value)) return false;
	if (schema.integer === true && !Number.isInteger(value)) return false;
	if (schema.minimum !== undefined && value < schema.minimum) return false;
	if (schema.exclusive_minimum !== undefined && value <= schema.exclusive_minimum) {
		return false;
	}
	return schema.maximum === undefined || value <= schema.maximum;
}

function arrayValueMatches(
	value: unknown,
	schema: Extract<BrowserUseActionValueSchema, { kind: "array" }>,
): boolean {
	if (!Array.isArray(value) || value.length > ACTION_VALUE_MAX_ARRAY_LENGTH) {
		return false;
	}
	if (schema.min_items !== undefined && value.length < schema.min_items) {
		return false;
	}
	if (schema.max_items !== undefined && value.length > schema.max_items) {
		return false;
	}
	return value.every((item) =>
		valueMatchesValidatedSchema(item, schema.items),
	);
}

function objectValueMatches(
	value: unknown,
	schema: Extract<BrowserUseActionValueSchema, { kind: "object" }>,
): boolean {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const allowed = new Set(Object.keys(schema.fields));
	if (Object.keys(record).some((key) => !allowed.has(key))) return false;
	for (const [key, field] of Object.entries(schema.fields)) {
		const present = Object.hasOwn(record, key);
		if (!present) {
			if (field.required) return false;
			continue;
		}
		if (!valueMatchesValidatedSchema(record[key], field.schema)) return false;
	}
	return true;
}

function valueMatchesValidatedSchema(
	value: unknown,
	schema: BrowserUseActionValueSchema,
): boolean {
	switch (schema.kind) {
		case "string":
			return stringValueMatches(value, schema);
		case "number":
			return numberValueMatches(value, schema);
		case "boolean":
			return (
				typeof value === "boolean" &&
				(schema.constant === undefined || value === schema.constant)
			);
		case "enum":
			return typeof value === "string" && schema.values.includes(value);
		case "array":
			return arrayValueMatches(value, schema);
		case "object":
			return objectValueMatches(value, schema);
	}
}

/**
 * Runtime-validate a value against one action value schema (R17). Pure and
 * total; never throws. Unknown object fields are rejected. Bounded arrays.
 *
 * @param value - The value to validate
 * @param schema - The declared schema
 * @returns True when the value satisfies the schema exactly
 */
export function actionValueMatchesSchema(
	value: unknown,
	schema: BrowserUseActionValueSchema,
): boolean {
	if (!isValueSchema(schema)) return false;
	try {
		return valueMatchesValidatedSchema(value, schema);
	} catch {
		return false;
	}
}

// --- Containment policy (R23) ------------------------------------------------

/**
 * The bounded set of containment policies an action may CLAIM and this module
 * can ENFORCE (R23). A migrated action carrying any other containment claim
 * (a legacy `detect_only` or final-boundary claim) is refused — an unenforced
 * claim can never be carried forward as if it were a runtime guarantee.
 *
 * - `none`: no special containment; the effect class governs write-ahead truth.
 * - `read-only-observation`: the action asserts pure observation; enforced by
 *   requiring the audited effect class to be `read`.
 */
export const BROWSER_USE_ACTION_CONTAINMENT_POLICIES = [
	"none",
	"read-only-observation",
] as const;

/** Containment-policy union (R23). */
export type BrowserUseActionContainmentPolicy =
	(typeof BROWSER_USE_ACTION_CONTAINMENT_POLICIES)[number];

// --- Promotion receipt (R17, R42) --------------------------------------------

/**
 * Promotion dispositions (R42). Only an `approved` signed receipt authorizes
 * execution; legacy evidence never does. `rejected`, `withdrawn`, and
 * `invalidated` are DURABLE dispositions a record keeps so a previously-approved
 * action cannot silently re-enable. A required active action lacking current
 * signed authority blocks activation.
 */
export const BROWSER_USE_PROMOTION_DISPOSITIONS = [
	"approved",
	"rejected",
	"withdrawn",
	"invalidated",
] as const;

/** Promotion disposition union (R42). */
export type BrowserUsePromotionDisposition =
	(typeof BROWSER_USE_PROMOTION_DISPOSITIONS)[number];

/**
 * Retained unsigned approval evidence from the legacy registry shape.
 *
 * It remains readable for inspection and migration, but never authorizes
 * execution. Fresh operator promotion must produce signed authority first.
 */
export type BrowserUseLegacyPromotionEvidence = {
	/** The exact asset digest named by the historical approval claim. */
	approved_digest: string;
	disposition: BrowserUsePromotionDisposition;
	/** The exact origin the operator approved this action for. */
	approved_origin: string;
	/** The audited effect class the operator approved. */
	approved_effect: BrowserUseActionEffectClass;
	/** Opaque operator identity; audit only, never an authority branch. */
	approver_ref: string;
};

/** Signed production receipt or retained unsigned legacy evidence. */
export type BrowserUsePromotionReceipt =
	| BrowserUseLegacyPromotionEvidence
	| BrowserUseReviewedActionPromotionReceipt;

// --- Reviewed action registry record (R16-R18) -------------------------------

/**
 * One reviewed-action registry record (R16-R18). Content-addressed: `asset_id`
 * IS the sha256 of the exact bytes, and `expected_digest` must equal it. The
 * record binds every promotion invariant; the ASSET bytes live separately in a
 * content-addressed store and are resolved only through a generation seam.
 */
export type BrowserUseReviewedActionRecord = {
	/** Stable registry id a runbook references. */
	action_id: string;
	/** Content-addressed asset id: the sha256 of the exact bytes (R16). */
	asset_id: string;
	/** Expected asset digest; must equal the resolved bytes' sha256 (R18). */
	expected_digest: string;
	/** Exact HTTP(S) origin this action may run on (R17). */
	allowed_origin: string;
	/** Audited effect class (R19); MUST match the asset audit at resolution. */
	effect_class: BrowserUseActionEffectClass;
	/** Closed capabilities re-derived before signed promotion is accepted. */
	audited_capabilities?: readonly string[];
	/** Enforced containment policy (R23); an unenforceable claim is refused. */
	containment: BrowserUseActionContainmentPolicy;
	/** Typed input schema (R17); the runbook's substituted inputs must satisfy it. */
	input_schema: BrowserUseActionValueSchema;
	/** Typed result schema (R21); a read action's result must satisfy it. */
	result_schema: BrowserUseActionValueSchema;
	/** Sensitivity of a read action's captured result (R21). */
	result_sensitivity: "low" | "high";
	/** Required postcondition (R17); a mutation MUST declare one. */
	required_postcondition?: BrowserUseRunbookPostcondition;
	/** Source provenance (R17); the migrated source lineage, never bytes. */
	source_provenance: string;
	/** Signed execution authority or retained legacy evidence; a runbook can't author either. */
	promotion_receipt: BrowserUsePromotionReceipt | null;
};

// --- Resolution seam (R16, R38) ----------------------------------------------

/**
 * The generation-scoped action asset + record source (R16/R38). A staged or
 * active generation resolves an action id to its registry record AND the exact
 * asset bytes from its immutable content-addressed store. Loose files are never
 * consulted. `absent` is a clean miss (no such action in this generation);
 * `bytes_unavailable` means the record exists but its content-addressed asset
 * could not be read (fail closed, never dispatch).
 */
export type BrowserUseActionGenerationSeam = {
	loadActionRecord(
		actionId: string,
	): Promise<
		| { ok: true; record: BrowserUseReviewedActionRecord }
		| { ok: false; absent: true }
	>;
	loadActionAssetBytes(
		assetId: string,
	): Promise<
		| { ok: true; bytes: string }
		| { ok: false; reason: "bytes_unavailable" }
	>;
	verifyPromotion?(input: {
		actionId: string;
		record: BrowserUseReviewedActionRecord;
		assetBytes: string;
	}): Promise<{ ok: true } | { ok: false; code: string }>;
};

// --- Typed refusal (every pre-dispatch fail-closed path) ---------------------

/**
 * Every reviewed-action resolution refusal (R17/R18/R19/R21/R23). Each is a
 * fail-closed pre-dispatch refusal: the executor step is NEVER constructed.
 */
export type BrowserUseReviewedActionRefusalCode =
	| "action_id_invalid"
	| "action_registry_record_missing"
	| "action_asset_bytes_unavailable"
	| "action_digest_mismatch"
	| "action_origin_invalid"
	| "action_origin_mismatch"
	| "action_effect_undeclared"
	| "action_containment_unsupported"
	| "action_input_schema_invalid"
	| "action_result_schema_invalid"
	| "action_input_rejected"
	| "action_item_batch_blocked"
	| "action_postcondition_missing"
	| "action_receipt_not_approved"
	| "action_receipt_digest_mismatch"
	| "action_receipt_origin_mismatch"
	| "action_receipt_effect_mismatch"
	| "action_promotion_authority_missing"
	| "action_promotion_verifier_unavailable"
	| "action_promotion_invalid";

/** One typed reviewed-action refusal. Never carries asset bytes or a value. */
export type BrowserUseReviewedActionRefusal = {
	code: BrowserUseReviewedActionRefusalCode;
	message: string;
};

function refuse(
	code: BrowserUseReviewedActionRefusalCode,
	message: string,
): { ok: false; refusal: BrowserUseReviewedActionRefusal } {
	return { ok: false, refusal: { code, message: redactUnsafeText(message) } };
}

export function exactOriginValid(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			(url.protocol === "https:" || url.protocol === "http:") &&
			url.origin === value
		);
	} catch {
		return false;
	}
}

function postconditionValid(postcondition: AgentBrowserPostcondition): boolean {
	if (
		postcondition.kind === "url-equals" ||
		postcondition.kind === "url-starts-with"
	) {
		return typeof postcondition.url === "string" && postcondition.url.length > 0;
	}
	if (postcondition.kind !== "element-visible") return false;
	return typeof postcondition.selector === "string" &&
		!postcondition.selector.startsWith("@") &&
		postcondition.selector.trim().length > 0;
}

export function reviewedActionRecordIsValid(value: unknown): value is BrowserUseReviewedActionRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	const receipt = record.promotion_receipt;
	if (
		typeof record.action_id !== "string" ||
		!SAFE_ACTION_ID.test(record.action_id) ||
		typeof record.asset_id !== "string" ||
		typeof record.expected_digest !== "string" ||
		!actionDigestIsValid(record.asset_id) ||
		record.asset_id !== record.expected_digest ||
		typeof record.allowed_origin !== "string" ||
		!exactOriginValid(record.allowed_origin) ||
		!(BROWSER_USE_ACTION_EFFECT_CLASSES as readonly unknown[]).includes(record.effect_class) ||
		!(BROWSER_USE_ACTION_CONTAINMENT_POLICIES as readonly unknown[]).includes(record.containment) ||
		!isValueSchema(record.input_schema) ||
		!isValueSchema(record.result_schema) ||
		(record.result_sensitivity !== "low" && record.result_sensitivity !== "high") ||
		typeof record.source_provenance !== "string" || record.source_provenance === "" ||
		(record.effect_class === "mutation" &&
			(typeof record.required_postcondition !== "object" ||
				record.required_postcondition === null ||
				!postconditionValid(record.required_postcondition as BrowserUseRunbookPostcondition))) ||
		(receipt !== null && (typeof receipt !== "object" || Array.isArray(receipt)))
	) return false;
	if (record.audited_capabilities !== undefined &&
		(!Array.isArray(record.audited_capabilities) ||
			record.audited_capabilities.length === 0 ||
			!record.audited_capabilities.every((entry) => typeof entry === "string"))) return false;
	if (receipt === null) return true;
	if (reviewedActionPromotionReceiptIsValid(receipt)) {
		return receipt.action_id === record.action_id &&
			receipt.approved_digest === record.expected_digest &&
			receipt.approved_origin === record.allowed_origin &&
			receipt.approved_effect === record.effect_class &&
			Array.isArray(record.audited_capabilities);
	}
	const promotion = receipt as Record<string, unknown>;
	if (
		promotion.approved_digest !== record.expected_digest ||
		!(BROWSER_USE_PROMOTION_DISPOSITIONS as readonly unknown[]).includes(promotion.disposition) ||
		promotion.approved_origin !== record.allowed_origin ||
		promotion.approved_effect !== record.effect_class ||
		typeof promotion.approver_ref !== "string" || promotion.approver_ref === ""
	) return false;
	return true;
}

/**
 * The verified resolution: an executor `evaluate` step (never built until every
 * invariant proved), plus the record's effect class and result schema the
 * caller uses to capture a read result. `review_status` is always `approved`
 * here BY CONSTRUCTION — a non-approved receipt refuses before this shape.
 */
export type BrowserUseResolvedReviewedAction = {
	step: Extract<AgentBrowserTaskStep, { kind: "evaluate" }>;
	effect_class: BrowserUseActionEffectClass;
	result_schema: BrowserUseActionValueSchema;
	result_sensitivity: "low" | "high";
};

export type BrowserUseReviewedActionResolution =
	| { ok: true; resolved: BrowserUseResolvedReviewedAction }
	| { ok: false; refusal: BrowserUseReviewedActionRefusal };

/**
 * Resolve one reviewed action id into a verified executor `evaluate` step
 * (R16-R23). EVERY invariant is proven BEFORE the step is built; any failure is
 * a fail-closed typed refusal and NO step (and therefore no dispatch) results:
 *
 *   1. safe action id;
 *   2. registry record present in THIS generation (R16 — never a loose file);
 *   3. asset bytes resolvable AND their sha256 equals the expected digest (R18);
 *   4. exact allowed origin, and the requested origin matches it (R17);
 *   5. audited effect class matches the record's declared class (R19/KTD7);
 *   6. containment policy enforceable, and a read-only-observation claim's
 *      audited effect is actually `read` (R23);
 *   7. typed input/result schemas well-formed, and the substituted inputs
 *      satisfy the input schema (R17);
 *   8. a mutation declares a required postcondition (R17);
 *   9. an operator-approved promotion receipt whose approved digest, origin,
 *      and effect all match the record EXACTLY (R17/R18/R42).
 *
 * @param input - Action id, requested origin, substituted inputs, and the seam
 * @returns The verified `evaluate` step plus result metadata, or a typed refusal
 */
export async function resolveReviewedAction(input: {
	actionId: string;
	expectedDigest: string;
	requestedOrigin: string;
	inputs: Readonly<Record<string, unknown>>;
	seam: BrowserUseActionGenerationSeam;
}): Promise<BrowserUseReviewedActionResolution> {
	if (!SAFE_ACTION_ID.test(input.actionId)) {
		return refuse("action_id_invalid", "action id is not a safe registry slug.");
	}
	const found = await input.seam.loadActionRecord(input.actionId);
	if (!found.ok) {
		return refuse(
			"action_registry_record_missing",
			"no reviewed-action registry record exists for this id in the resolving generation.",
		);
	}
	const record = found.record;

	// Receipt disposition FIRST: a runbook can never grant its own approval, and
	// a candidate/rejected/withdrawn/invalidated receipt is non-executable (R18,
	// R42) regardless of anything else.
	if (record.promotion_receipt === null) {
		return refuse(
			"action_receipt_not_approved",
			"the Reviewed Action candidate has no external-human promotion receipt.",
		);
	}
	if (record.promotion_receipt.disposition !== "approved") {
		return refuse(
			"action_receipt_not_approved",
			`the promotion receipt disposition is ${record.promotion_receipt.disposition}; only an operator-approved action is executable.`,
		);
	}
	if (!reviewedActionPromotionReceiptIsValid(record.promotion_receipt)) {
		return refuse(
			"action_promotion_authority_missing",
			"the Reviewed Action has legacy promotion evidence but no signed execution authority; fresh operator promotion is required.",
		);
	}

	// The caller pins the reviewed digest from the compiled runbook. Resolve no
	// asset bytes until that digest matches this generation's registry record.
	if (
		!actionDigestIsValid(input.expectedDigest) ||
		input.expectedDigest !== record.expected_digest
	) {
		return refuse(
			"action_digest_mismatch",
			"the runbook's expected action digest does not match the registry record.",
		);
	}

	// Content addressing (R18): resolve the exact bytes and prove the digest.
	if (
		!actionDigestIsValid(record.expected_digest) ||
		!actionDigestIsValid(record.asset_id)
	) {
		return refuse(
			"action_digest_mismatch",
			"the record's asset id or expected digest is not a 64-hex content digest.",
		);
	}
	const assetBytes = await input.seam.loadActionAssetBytes(record.asset_id);
	if (!assetBytes.ok) {
		return refuse(
			"action_asset_bytes_unavailable",
			"the content-addressed action asset could not be read from the resolving generation.",
		);
	}
	if (Buffer.byteLength(assetBytes.bytes, "utf-8") > ACTION_ASSET_MAX_BYTES) {
		return refuse(
			"action_digest_mismatch",
			"the resolved action asset exceeds the bounded byte ceiling.",
		);
	}
	const actualDigest = actionAssetDigest(assetBytes.bytes);
	if (actualDigest !== record.expected_digest || record.asset_id !== record.expected_digest) {
		return refuse(
			"action_digest_mismatch",
			"the resolved action asset bytes do not match the record's expected digest (changed bytes are non-executable).",
		);
	}

	// Origin (R17): exact allowed origin, and the requested origin must match it.
	if (!exactOriginValid(record.allowed_origin)) {
		return refuse(
			"action_origin_invalid",
			"the record's allowed_origin is not an exact HTTP(S) origin.",
		);
	}
	if (!exactOriginValid(input.requestedOrigin) || input.requestedOrigin !== record.allowed_origin) {
		return refuse(
			"action_origin_mismatch",
			"the requested run origin is not the record's exact allowed origin.",
		);
	}

	// Effect class (R19/KTD7): the audited behavior of the exact bytes is the
	// authority. A record whose declared effect disagrees with the audit is
	// refused — a mislabelled read that navigates/clicks never bypasses
	// write-ahead truth.
	if (
		(record.effect_class !== "read" && record.effect_class !== "mutation")
	) {
		return refuse(
			"action_effect_undeclared",
			"the record declares no valid audited effect class.",
		);
	}
	const auditedEffect = auditActionEffectClass(assetBytes.bytes);
	if (auditedEffect !== record.effect_class) {
		return refuse(
			"action_effect_undeclared",
			`the audited effect class (${auditedEffect}) does not match the record's declared class (${record.effect_class}); the audit is the authority.`,
		);
	}

	// Containment (R23): an unenforceable claim is refused; a read-only-
	// observation claim requires the audited effect to actually be `read`.
	if (
		!(BROWSER_USE_ACTION_CONTAINMENT_POLICIES as readonly string[]).includes(
			record.containment,
		)
	) {
		return refuse(
			"action_containment_unsupported",
			"the record's containment policy is not one this runtime can enforce.",
		);
	}
	if (record.containment === "read-only-observation" && auditedEffect !== "read") {
		return refuse(
			"action_containment_unsupported",
			"a read-only-observation containment claim cannot be enforced for an action the audit classes as a mutation.",
		);
	}

	// Typed schemas (R17/R21).
	if (!isValueSchema(record.input_schema)) {
		return refuse(
			"action_input_schema_invalid",
			"the record's input schema is not a valid action value schema.",
		);
	}
	if (!isValueSchema(record.result_schema)) {
		return refuse(
			"action_result_schema_invalid",
			"the record's result schema is not a valid action value schema.",
		);
	}
	if (!actionValueMatchesSchema(input.inputs, record.input_schema)) {
		return refuse(
			"action_input_rejected",
			"the substituted action inputs do not satisfy the record's typed input schema.",
		);
	}

	// Mutation postcondition (R17): a mutation MUST declare one; a read may omit.
	if (
		record.effect_class === "mutation" &&
		(record.required_postcondition === undefined ||
			!postconditionValid(record.required_postcondition))
	) {
		return refuse(
			"action_postcondition_missing",
			"a mutation action requires a valid required postcondition.",
		);
	}

	// Promotion receipt binding (R17/R18/R42): the approval must bind THIS exact
	// digest, origin, and effect.
	const receipt = record.promotion_receipt;
	if (receipt.approved_digest !== record.expected_digest) {
		return refuse(
			"action_receipt_digest_mismatch",
			"the promotion receipt approved a different asset digest than this record's expected digest.",
		);
	}
	if (receipt.approved_origin !== record.allowed_origin) {
		return refuse(
			"action_receipt_origin_mismatch",
			"the promotion receipt approved a different origin than the record's allowed origin.",
		);
	}
	if (receipt.approved_effect !== record.effect_class) {
		return refuse(
			"action_receipt_effect_mismatch",
			"the promotion receipt approved a different effect class than the record's.",
		);
	}
	if (input.seam.verifyPromotion === undefined) {
		return refuse(
			"action_promotion_verifier_unavailable",
			"the active generation has no offline Reviewed Action promotion verifier.",
		);
	}
	const verified = await input.seam.verifyPromotion({
		actionId: input.actionId,
		record,
		assetBytes: assetBytes.bytes,
	});
	if (!verified.ok) {
		return refuse(
			"action_promotion_invalid",
			"the sealed Reviewed Action promotion authority did not verify.",
		);
	}

	// Every invariant proven: build the executor's approved evaluate step. The
	// executor RE-PROVES origin, digest, approval, and postcondition itself, so
	// this is a defence-in-depth handoff, not the only gate.
	const step: Extract<AgentBrowserTaskStep, { kind: "evaluate" }> = {
		kind: "evaluate",
		action_id: input.actionId,
		script: assetBytes.bytes,
		script_sha256: record.expected_digest,
		review_status: "approved",
		allowed_origin: record.allowed_origin,
		effect: record.effect_class,
		inputs: input.inputs,
		...(record.required_postcondition !== undefined
			? { postcondition: record.required_postcondition }
			: {}),
	};
	return {
		ok: true,
		resolved: {
			step,
			effect_class: record.effect_class,
			result_schema: record.result_schema,
			result_sensitivity: record.result_sensitivity,
		},
	};
}

// --- Structured read results (R21) -------------------------------------------

/**
 * A bounded structured-result projection for the shared-run outcome (R21). It
 * NEVER carries raw payload bytes inline beyond the bounded summary; a large or
 * high-sensitivity payload is spilled to a retention-owned governed artifact and
 * only its reference rides the run. `schema_id` is the digest of the result
 * schema (stable identity), `result_digest` the digest of the validated value.
 */
export type BrowserUseStructuredResultOutcome = Extract<
	BrowserUseRunStructuredResult,
	{ ok: true }
>["outcome"];

/** Typed structured-result capture refusal. */
export type BrowserUseStructuredResultRefusal = {
	code: "structured_result_schema_mismatch" | "structured_result_unredactable";
	message: string;
};

export type BrowserUseStructuredResultCapture =
	| { ok: true; outcome: BrowserUseStructuredResultOutcome }
	| { ok: false; refusal: BrowserUseStructuredResultRefusal };

// A value carrying an op:// reference or a raw ws(s):// endpoint is
// secret-shaped and must never enter a shared-run summary (mirrors the schemas
// redaction walker's value rule).
const SECRET_SHAPED_VALUE = /\b(?:op|wss?):\/\//i;

function containsSecretShapedValue(value: unknown, seen: WeakSet<object>): boolean {
	if (typeof value === "string") return SECRET_SHAPED_VALUE.test(value);
	if (typeof value !== "object" || value === null) return false;
	if (seen.has(value)) return false;
	seen.add(value);
	if (Array.isArray(value)) {
		return value.some((item) => containsSecretShapedValue(item, seen));
	}
	return Object.values(value as Record<string, unknown>).some((child) =>
		containsSecretShapedValue(child, seen),
	);
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, val) => {
		if (typeof val === "object" && val !== null && !Array.isArray(val)) {
			const record = val as Record<string, unknown>;
			const sorted: Record<string, unknown> = Object.create(null);
			for (const key of Object.keys(record).sort()) sorted[key] = record[key];
			return sorted;
		}
		return val;
	});
}

/**
 * Capture one read action's structured result for the shared-run outcome (R21).
 * The result is VALIDATED against the record's result schema, then REDACTED
 * (a secret-shaped value fails closed — a read must never smuggle a credential
 * into durable state), then projected to a bounded summary + schema id + digest.
 * A payload that is bounded AND low-sensitivity stays inline; anything larger or
 * high-sensitivity is spilled to a governed artifact whose reference the caller
 * mints and passes in — only the reference rides the run.
 *
 * @param input - Validated raw value, its schema + sensitivity, and an artifact
 *   reference minter for the spillover case
 * @returns The bounded structured-result outcome, or a typed refusal
 */
export function captureStructuredResult(input: {
	value: unknown;
	schema: BrowserUseActionValueSchema;
	sensitivity: "low" | "high";
	/** Mint a governed artifact ref for the full payload; called only on spill. */
	spillToGovernedArtifact: (canonicalPayload: string) => string;
}): BrowserUseStructuredResultCapture {
	if (!actionValueMatchesSchema(input.value, input.schema)) {
		return {
			ok: false,
			refusal: {
				code: "structured_result_schema_mismatch",
				message: "the captured read result does not satisfy the action's result schema.",
			},
		};
	}
	if (containsSecretShapedValue(input.value, new WeakSet())) {
		return {
			ok: false,
			refusal: {
				code: "structured_result_unredactable",
				message:
					"the captured read result carries a secret-shaped value; it must never enter durable shared-run state.",
			},
		};
	}
	const canonical = canonicalJson(input.value);
	const schema_id = createHash("sha256")
		.update(canonicalJson(input.schema))
		.digest("hex");
	const result_digest = createHash("sha256").update(canonical).digest("hex");
	const summary =
		input.sensitivity === "high"
			? "High-sensitivity structured result stored in a governed artifact."
			: "Low-sensitivity structured result captured.";
	const canBeInline =
		input.sensitivity === "low" &&
		Buffer.byteLength(canonical, "utf-8") <= STRUCTURED_RESULT_MAX_INLINE_BYTES;
	if (canBeInline) {
		return {
			ok: true,
			outcome: {
				schema_id,
				sensitivity: input.sensitivity,
				summary,
				result_digest,
				inline: true,
			},
		};
	}
	const governed_artifact_ref = input.spillToGovernedArtifact(canonical);
	return {
		ok: true,
		outcome: {
			schema_id,
			sensitivity: input.sensitivity,
			summary,
			result_digest,
			governed_artifact_ref,
			inline: false,
		},
	};
}

// --- Per-item checkpoints and bounded iteration (R12) ------------------------

/**
 * The proven outcome of one batch item's checkpoint (R12). `confirmed` — the
 * item's postcondition was freshly proven; `not-achieved` — a clean refusal
 * before dispatch; `unknown` — a mutation may have dispatched but no fresh proof
 * exists, which BLOCKS the batch (never redispatched, no later item runs).
 */
export const BROWSER_USE_ITEM_CHECKPOINT_OUTCOMES = [
	"pending",
	"confirmed",
	"not-achieved",
	"unknown",
] as const;

/** Item checkpoint outcome union (R12). */
export type BrowserUseItemCheckpointOutcome =
	(typeof BROWSER_USE_ITEM_CHECKPOINT_OUTCOMES)[number];

/** One stable-key item checkpoint (R12). */
export type BrowserUseItemCheckpoint = {
	item_key: string;
	outcome: BrowserUseItemCheckpointOutcome;
};

/**
 * The durable bounded-iteration batch state (R12). `item_keys` is the ordered
 * stable-key sequence (immutable identity for the batch); `checkpoints` records
 * each key's proven outcome. A batch advances only on a confirmed checkpoint.
 */
export type BrowserUseItemBatchState = {
	schema_version: "1";
	item_keys: readonly string[];
	checkpoints: readonly BrowserUseItemCheckpoint[];
};

/** Typed batch-resolution outcome. */
export type BrowserUseItemBatchResolution =
	| { kind: "next"; item_key: string; item_index: number }
	| { kind: "blocked"; item_key: string; item_index: number; reason: "unknown" }
	| { kind: "complete" }
	| { kind: "invalid"; message: string };

export function itemKeysAreValid(keys: unknown): keys is readonly string[] {
	if (!Array.isArray(keys)) return false;
	if (keys.length === 0 || keys.length > ACTION_VALUE_MAX_ARRAY_LENGTH) return false;
	const seen = new Set<string>();
	for (const key of keys) {
		if (
			typeof key !== "string" ||
			!SAFE_BATCH_ITEM_KEY.test(key) ||
			seen.has(key)
		) {
			return false;
		}
		seen.add(key);
	}
	return true;
}

/**
 * Resolve the next safe batch item to dispatch (R12). The rules:
 *
 *   - A confirmed item is SKIPPED; the batch resumes from the FIRST item whose
 *     checkpoint is not `confirmed`.
 *   - An `unknown` item BLOCKS the batch: it is never redispatched, and no later
 *     item runs past it until repair or fresh reconciliation proves its outcome.
 *   - A `not-achieved` item is a clean stop at that key (the caller decides
 *     whether to re-attempt it; it is NOT auto-skipped and blocks later items).
 *   - Only when every item is confirmed is the batch `complete`.
 *
 * @param state - The durable batch state
 * @returns The next dispatchable key, a blocking unknown, completion, or invalid
 */
export function resolveNextBatchItem(
	state: BrowserUseItemBatchState,
): BrowserUseItemBatchResolution {
	if (state.schema_version !== "1" || !itemKeysAreValid(state.item_keys)) {
		return { kind: "invalid", message: "batch item keys are not a valid stable-key sequence." };
	}
	const byKey = new Map<string, BrowserUseItemCheckpointOutcome>();
	for (const checkpoint of state.checkpoints) {
		if (!state.item_keys.includes(checkpoint.item_key)) {
			return { kind: "invalid", message: "a checkpoint references a key outside the batch item sequence." };
		}
		byKey.set(checkpoint.item_key, checkpoint.outcome);
	}
	for (const [index, key] of state.item_keys.entries()) {
		const outcome = byKey.get(key) ?? "pending";
		if (outcome === "confirmed") continue;
		if (outcome === "unknown") {
			return { kind: "blocked", item_key: key, item_index: index, reason: "unknown" };
		}
		// pending or not-achieved: this is the first unproven item; dispatch here.
		return { kind: "next", item_key: key, item_index: index };
	}
	return { kind: "complete" };
}

/**
 * Record one item's checkpoint outcome, enforcing the R12 advance rule (a
 * confirmed key is immutable; an unknown key blocks). Returns the next batch
 * state, or a typed refusal when the transition is illegal.
 *
 * @param state - The current batch state
 * @param input - The item key and its freshly proven outcome
 * @returns The next batch state, or a typed refusal
 */
export function recordItemCheckpoint(
	state: BrowserUseItemBatchState,
	input: { itemKey: string; outcome: Exclude<BrowserUseItemCheckpointOutcome, "pending"> },
):
	| { ok: true; state: BrowserUseItemBatchState }
	| { ok: false; code: "item_key_unknown" | "item_checkpoint_immutable" | "item_batch_blocked"; message: string } {
	if (!state.item_keys.includes(input.itemKey)) {
		return { ok: false, code: "item_key_unknown", message: "the item key is not in the batch sequence." };
	}
	const existing = state.checkpoints.find((c) => c.item_key === input.itemKey);
	if (existing?.outcome === "confirmed") {
		return {
			ok: false,
			code: "item_checkpoint_immutable",
			message: "a confirmed item checkpoint is immutable and cannot be overwritten.",
		};
	}
	// A key later than a currently-unknown key cannot be advanced: the unknown
	// blocks the batch. The FIRST unproven key must be the one being recorded.
	const targetIndex = state.item_keys.indexOf(input.itemKey);
	for (let i = 0; i < targetIndex; i += 1) {
		const key = state.item_keys[i] as string;
		const outcome = state.checkpoints.find((c) => c.item_key === key)?.outcome ?? "pending";
		if (outcome !== "confirmed") {
			return {
				ok: false,
				code: "item_batch_blocked",
				message: `item ${key} before ${input.itemKey} is not confirmed (${outcome}); the batch cannot advance past it.`,
			};
		}
	}
	const nextCheckpoints = [
		...state.checkpoints.filter((c) => c.item_key !== input.itemKey),
		{ item_key: input.itemKey, outcome: input.outcome },
	];
	return { ok: true, state: { ...state, checkpoints: nextCheckpoints } };
}

// --- Immutable run execution binding (R38, KTD13) ----------------------------

/**
 * The IMMUTABLE run execution binding persisted at run creation (R38). It pins
 * a run to one exact catalog identity: the generation and activation epoch, the
 * service/flow/version/digest, the action-registry digest, the normalized input
 * digest (or a governed input artifact ref when the input is retention-owned),
 * the ordered item-key digest, the target scope, and the postcondition. Resume
 * RESOLVES ONLY this pinned generation (KTD13) and REJECTS any replacement
 * authority from flags.
 */
export type BrowserUseRunExecutionBinding = {
	schema_version: "1";
	generation_id: string;
	activation_epoch: number;
	service_id: string;
	flow_id: string;
	runbook_version: string;
	/** Digest of the compiled runbook definition (R38). */
	runbook_digest: string;
	/** Digest over the generation's reviewed-action registry (R38). */
	action_registry_digest: string;
	/**
	 * Digest of the NORMALIZED input, OR a governed input artifact ref when the
	 * input is a retention-owned high-sensitivity value (R41). Exactly one is
	 * present; the other is absent.
	 */
	normalized_input_digest?: string;
	governed_input_artifact_ref?: string;
	/** Digest of the ordered stable item-key sequence (R38). */
	item_key_digest: string;
	/** The exact target scope (allowed origin) this run is bound to (R38). */
	target_scope: string;
	postcondition: BrowserUseRunPostconditionRef;
};

/** A bounded postcondition reference on the run binding. */
export type BrowserUseRunPostconditionRef = { id: string; summary: string };

/**
 * The digest of an ordered stable item-key sequence (R38). Order matters —
 * `[a,b]` and `[b,a]` are different bindings.
 */
export function itemKeySequenceDigest(itemKeys: readonly string[]): string {
	return createHash("sha256").update(JSON.stringify(itemKeys)).digest("hex");
}

/**
 * The normalized-input digest (R38/R41). A stable, order-independent digest of
 * the input record so a resume proves the SAME inputs without persisting their
 * values in ordinary run state (only the digest is stored; a sensitive value is
 * a retention-owned artifact or an exact digest-matched resupply).
 */
export function normalizedInputDigest(inputs: Readonly<Record<string, unknown>>): string {
	return createHash("sha256").update(canonicalJson(inputs)).digest("hex");
}

/** Typed resume-binding refusal (R38, KTD13). */
export type BrowserUseResumeBindingRefusal = {
	code:
		| "resume_generation_drift"
		| "resume_epoch_stale"
		| "resume_generation_unavailable"
		| "resume_flags_altered"
		| "resume_input_mismatch"
		| "resume_item_keys_altered"
		| "resume_binding_invalid";
	message: string;
};

/**
 * The retained generation a resume resolves (R38/KTD13). The pinned generation
 * id + epoch the run was bound to at creation. A resume presents no new
 * generation; it may only resolve THIS one. `unavailable` means the pinned
 * generation could not be found (typed repair, NEVER a current-catalog
 * fallback).
 */
export type BrowserUseRetainedGenerationSeam = {
	resolvePinnedGeneration(input: {
		generationId: string;
		activationEpoch: number;
	}): Promise<
		| { ok: true; action_registry_digest: string; current_epoch: number }
		| { ok: false; reason: "unavailable" | "epoch_stale" | "drift" }
	>;
};

/**
 * Resolve a resume STRICTLY against the run's immutable execution binding (R38,
 * KTD13). The resume presents its own re-supplied inputs, item keys, and any
 * flags; this gate REJECTS every replacement authority:
 *
 *   - altered resume flags (a flag that would change generation/flow/version)
 *     refuse (`resume_flags_altered`);
 *   - a re-supplied input whose normalized digest differs from the pinned digest
 *     refuses (`resume_input_mismatch`) — unless the binding is governed-input
 *     (retention-owned), where an exact digest-matched resupply is required;
 *   - an altered item-key sequence refuses (`resume_item_keys_altered`);
 *   - a pinned generation that is unavailable, drifted, or whose epoch is stale
 *     refuses WITHOUT current-catalog fallback.
 *
 * @param input - The pinned binding, the re-supplied resume request, and the seam
 * @returns Ok with the resolved registry digest, or a typed refusal
 */
export async function resolveResumeAgainstBinding(input: {
	binding: BrowserUseRunExecutionBinding;
	resupply: {
		/** A resume must NOT change these; a mismatch is an altered-flag refusal. */
		generation_id: string;
		activation_epoch: number;
		service_id: string;
		flow_id: string;
		runbook_version: string;
		/** Re-supplied item keys; must match the pinned ordered sequence. */
		item_keys: readonly string[];
		/** Re-supplied inputs (digest-matched) OR the governed input artifact ref. */
		inputs?: Readonly<Record<string, unknown>>;
		governed_input_artifact_ref?: string;
	};
	seam: BrowserUseRetainedGenerationSeam;
}): Promise<
	| { ok: true; action_registry_digest: string }
	| { ok: false; refusal: BrowserUseResumeBindingRefusal }
> {
	const { binding, resupply } = input;
	if (binding.schema_version !== "1") {
		return {
			ok: false,
			refusal: { code: "resume_binding_invalid", message: "the run execution binding is not schema version 1." },
		};
	}
	// Altered resume flags: any of the pinned identity fields differing is an
	// attempt to swap the pinned run's authority (KTD13). Refuse.
	if (
		resupply.generation_id !== binding.generation_id ||
		resupply.service_id !== binding.service_id ||
		resupply.flow_id !== binding.flow_id ||
		resupply.runbook_version !== binding.runbook_version
	) {
		return {
			ok: false,
			refusal: {
				code: "resume_flags_altered",
				message: "resume flags would replace the run's pinned generation/flow/version; replacement authority is refused.",
			},
		};
	}
	if (resupply.activation_epoch !== binding.activation_epoch) {
		return {
			ok: false,
			refusal: {
				code: "resume_epoch_stale",
				message: "the resume activation epoch does not match the run's pinned epoch.",
			},
		};
	}
	// Item-key sequence: exact ordered match against the pinned digest.
	if (itemKeySequenceDigest(resupply.item_keys) !== binding.item_key_digest) {
		return {
			ok: false,
			refusal: {
				code: "resume_item_keys_altered",
				message: "the re-supplied item-key sequence does not match the run's pinned ordered item keys.",
			},
		};
	}
	// Input custody (R41): a governed-input binding requires the exact governed
	// ref; an ordinary binding requires digest-matched resupplied inputs.
	if (binding.governed_input_artifact_ref !== undefined) {
		if (resupply.governed_input_artifact_ref !== binding.governed_input_artifact_ref) {
			return {
				ok: false,
				refusal: {
					code: "resume_input_mismatch",
					message: "the resume does not present the pinned governed input artifact reference.",
				},
			};
		}
	} else {
		if (
			resupply.inputs === undefined ||
			binding.normalized_input_digest === undefined ||
			normalizedInputDigest(resupply.inputs) !== binding.normalized_input_digest
		) {
			return {
				ok: false,
				refusal: {
					code: "resume_input_mismatch",
					message: "the re-supplied inputs do not match the run's pinned normalized input digest.",
				},
			};
		}
	}
	// Pinned generation resolution (KTD13): resolve ONLY the pinned generation.
	const resolved = await input.seam.resolvePinnedGeneration({
		generationId: binding.generation_id,
		activationEpoch: binding.activation_epoch,
	});
	if (!resolved.ok) {
		const code: BrowserUseResumeBindingRefusal["code"] =
			resolved.reason === "epoch_stale"
				? "resume_epoch_stale"
				: resolved.reason === "drift"
					? "resume_generation_drift"
					: "resume_generation_unavailable";
		return {
			ok: false,
			refusal: {
				code,
				message: "the pinned retained generation could not be resolved; resume refuses without a current-catalog fallback.",
			},
		};
	}
	// Generation drift: the resolved registry digest must match the pinned one.
	if (resolved.action_registry_digest !== binding.action_registry_digest) {
		return {
			ok: false,
			refusal: {
				code: "resume_generation_drift",
				message: "the pinned generation's action-registry digest drifted from the run binding.",
			},
		};
	}
	return { ok: true, action_registry_digest: resolved.action_registry_digest };
}
