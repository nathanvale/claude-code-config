// ---------------------------------------------------------------------------
// Browser Runbook model — schema v2 (runbook catalog migration plan
// 2026-07-28-001 U2, R7-R15/R40-R41; platform plan 2026-07-21-002 U4,
// R30/R31/R35).
//
// The ONE declarative Browser Runbook schema: a resumable multi-step
// definition for the agent-browser (routine automation) lane, discovered and
// validated from the code-owned XDG data location. v2 is the ONLY supported
// version — v1 parsing, compilation, and dual-read are gone (drop-v1 override
// supersedes plan KTD4). A record whose `schema_version` is not exactly "2" is
// refused with a typed issue; there is exactly one supported version now.
//
// v2 richness over the retired v1 shape:
//   - TOTAL parsing: parseRunbookRecord proves the object shape before use;
//     the engine never casts untrusted JSON to BrowserUseRunbook.
//   - Recursive typed-input value schemas (R9): string, number, boolean, enum,
//     array, object, date, uuid, with default, bound, and discriminated-union
//     shapes, runtime-validated with bounded depth/size.
//   - Semantic targets (R11): a durable @eN ref is replaced by a runtime-
//     resolved semantic target (role + name) requiring a fresh snapshot and
//     EXACTLY ONE match before dispatch, or a reviewed-action reference (U3).
//   - Iteration/reviewed-action step kinds are DECLARED but UNAVAILABLE until
//     U3 supplies the action registry and item checkpoints: a runbook using
//     them validates its shape yet compilation returns a typed refusal.
//
// Confidential fields name an Item Binding and NEVER carry secret values (R30);
// continuation semantics bind to the shared run store so a resumed run replays
// only from its first unproven step (F7 restart-safe resume).
//
// Pure model + guards only. Discovery I/O, the fs port, per-step execution
// binding, and the private-file input route live in browser-use-runbook.ts;
// the shared run reducer/store lives in browser-use-run-model.ts /
// browser-use-runs.ts. No Date.now, no Math.random, no fs. This module never
// parses a secret and never reaches a browser.
// ---------------------------------------------------------------------------

import type {
	AgentBrowserPostcondition,
	AgentBrowserTaskStep,
} from "./browser-use-agent-browser";
import type { BrowserUseActionValueSchema } from "./browser-use-runbook-actions";
import { isBrowserUseAuthContext } from "./browser-use-auth-bindings";

/** The ONE supported runbook schema version. v1 is retired. */
export const BROWSER_USE_RUNBOOK_SCHEMA_VERSION = "2" as const;

// --- Runbook health (R31) ----------------------------------------------------

/**
 * Runbook health projection (R31): the discovery-facing status a
 * `runbook list` row carries. `healthy` — validated and executable;
 * `degrading` — validated but its last outcome recorded drift or heal;
 * `stale` — validation flagged staleness (schema drift or a target the runtime
 * could not reconcile) and it needs recapture before execution.
 */
export const BROWSER_USE_RUNBOOK_HEALTH = [
	"healthy",
	"degrading",
	"stale",
] as const;

/** Runbook health union. */
export type BrowserUseRunbookHealth =
	(typeof BROWSER_USE_RUNBOOK_HEALTH)[number];

// --- Effect class (R13) ------------------------------------------------------

/**
 * The audited effect class a runbook projects (R13/R19). Derived from the step
 * kinds a runbook declares, NOT from any legacy risk label: a read-only
 * runbook only observes; a mutation runbook fills, clicks, or dispatches a
 * reviewed mutation action.
 */
export const BROWSER_USE_RUNBOOK_EFFECT_CLASSES = [
	"read-only",
	"mutation",
] as const;

/** Effect-class union. */
export type BrowserUseRunbookEffectClass =
	(typeof BROWSER_USE_RUNBOOK_EFFECT_CLASSES)[number];

// --- Recursive typed-input value schemas (R9) --------------------------------

/**
 * Bounded recursion limits for typed input value schemas (R9). A schema deeper
 * than {@link INPUT_SCHEMA_MAX_DEPTH} or an object/enum/union wider than
 * {@link INPUT_SCHEMA_MAX_WIDTH} is refused before any value is validated, so a
 * hand-authored file cannot force unbounded work.
 */
export const INPUT_SCHEMA_MAX_DEPTH = 8;
export const INPUT_SCHEMA_MAX_WIDTH = 64;
const INPUT_SCHEMA_MAX_PATTERN_LENGTH = 512;
/** Bounded array length a value may carry when validated against a schema. */
export const INPUT_VALUE_MAX_ARRAY_LENGTH = 256;

// fallow-ignore-next-line complexity
function patternHasUnsafeBacktrackingShape(pattern: string): boolean {
	const groups: Array<{ alternation: boolean; quantified: boolean }> = [];
	let escaped = false;
	let inCharacterClass = false;
	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index];
		if (escaped) {
			if (!inCharacterClass && (/[1-9]/.test(character ?? "") || character === "k")) {
				return true;
			}
			escaped = false;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			continue;
		}
		if (character === "[") {
			inCharacterClass = true;
			continue;
		}
		if (character === "]" && inCharacterClass) {
			inCharacterClass = false;
			continue;
		}
		if (inCharacterClass) continue;
		if (character === "(") {
			if (pattern[index + 1] === "?") {
				if (pattern[index + 2] !== ":") return true;
				index += 2;
			}
			groups.push({ alternation: false, quantified: false });
			continue;
		}
		if (character === "|") {
			const group = groups.at(-1);
			if (group !== undefined) group.alternation = true;
			continue;
		}
		if (character === ")") {
			const group = groups.pop();
			if (group === undefined) continue;
			const suffix = pattern.slice(index + 1);
			const groupIsQuantified = /^(?:[+*?]|\{\d+(?:,\d*)?\})/.test(suffix);
			if (groupIsQuantified && (group.alternation || group.quantified)) return true;
			const parent = groups.at(-1);
			if (parent !== undefined) {
				parent.alternation ||= group.alternation;
				parent.quantified ||= group.quantified || groupIsQuantified;
			}
			continue;
		}
		if (character === "*" || character === "+" || character === "?" || character === "{") {
			const group = groups.at(-1);
			if (group !== undefined) group.quantified = true;
		}
	}
	return false;
}

/**
 * The recursive typed-input value schema vocabulary (R9). Each variant is a
 * runtime-validated shape a v2 input declares. `default` and `bounds` are per
 * scalar where meaningful; `discriminated-union` selects a member by a literal
 * discriminant field. This is a code-owned schema, never derived from a raw
 * legacy field.
 */
export type BrowserUseRunbookValueSchema =
	| { kind: "string"; min_length?: number; max_length?: number; pattern?: string; default?: string }
	| { kind: "number"; minimum?: number; maximum?: number; integer?: boolean; default?: number }
	| { kind: "boolean"; default?: boolean }
	| { kind: "enum"; values: readonly string[]; default?: string }
	| { kind: "date"; default?: string }
	| { kind: "uuid"; default?: string }
	| { kind: "array"; items: BrowserUseRunbookValueSchema; min_items?: number; max_items?: number }
	| {
			kind: "object";
			fields: Readonly<Record<string, { schema: BrowserUseRunbookValueSchema; required: boolean }>>;
	  }
	| {
			kind: "discriminated-union";
			discriminant: string;
			variants: Readonly<
				Record<string, Readonly<Record<string, { schema: BrowserUseRunbookValueSchema; required: boolean }>>>
			>;
	  };

// A safe date (calendar-valid ISO yyyy-mm-dd) and a canonical lowercase UUID.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_V = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}

function isCalendarValidIsoDate(value: string): boolean {
	if (!ISO_DATE.test(value)) return false;
	const [y, m, d] = value.split("-").map((part) => Number.parseInt(part, 10));
	if (y === undefined || m === undefined || d === undefined) return false;
	if (m < 1 || m > 12 || d < 1 || d > 31) return false;
	const date = new Date(Date.UTC(y, m - 1, d));
	return (
		date.getUTCFullYear() === y &&
		date.getUTCMonth() === m - 1 &&
		date.getUTCDate() === d
	);
}

// --- Typed step definitions (R11) --------------------------------------------

/**
 * One declarative structural postcondition. Mirrors the agent-browser
 * executor's postcondition vocabulary verbatim: the runbook declares
 * postconditions in the executor's own shape so the compiler proves alignment
 * and no translation layer can drift.
 */
export type BrowserUseRunbookPostcondition = AgentBrowserPostcondition;

/**
 * One runtime-resolved semantic target (R11): a stable role + accessible-name
 * pair the executor resolves against a FRESH snapshot and dispatches only when
 * EXACTLY ONE element matches. Replaces the durable `@eN` ref that could drift
 * between captures.
 */
export type BrowserUseRunbookSemanticTarget = {
	role: string;
	name: string;
};

/**
 * One bounded declarative runbook step (R11 semantic targets; U3 reviewed
 * actions and iteration are declared-but-unavailable). Read-only and ordinary
 * mutation kinds compile in U2; `action` and `iterate` validate their shape but
 * refuse compilation until U3 supplies the action registry.
 *
 * A `fill` step's `sensitivity` decides custody: an `ordinary` value is
 * inlined; a `confidential` value NEVER appears here — it names an
 * `item_binding` the auth transaction resolves, so a runbook file carries no
 * secret (R30).
 */
export type BrowserUseRunbookStep =
	| { kind: "snapshot"; interactive: boolean }
	| {
			kind: "open";
			url: string;
			postcondition: Extract<
				BrowserUseRunbookPostcondition,
				{ kind: "url-equals" }
			>;
	  }
	| {
			kind: "click";
			target: BrowserUseRunbookSemanticTarget;
			postcondition: Extract<
				BrowserUseRunbookPostcondition,
				{ kind: "element-visible" }
			>;
	  }
	| {
			kind: "fill";
			target: BrowserUseRunbookSemanticTarget;
			sensitivity: "ordinary";
			/** Literal value token; may reference a typed input as `{{input_id}}`. */
			value: string;
			postcondition: BrowserUseRunbookPostcondition;
	  }
	| {
			kind: "fill";
			target: BrowserUseRunbookSemanticTarget;
			sensitivity: "confidential";
			/** Item Binding id the auth transaction resolves; NEVER a secret value. */
			item_binding: string;
			postcondition: BrowserUseRunbookPostcondition;
	  }
	// --- U3-owned, declared-but-UNAVAILABLE (compilation refuses) -------------
	| {
			kind: "action";
			/** Content-addressed reviewed action id (U3 registry resolves it). */
			action_id: string;
			/** Expected action-asset digest the registry must match (U3). */
			expected_digest: string;
			inputs: Readonly<Record<string, string>>;
			postcondition?: BrowserUseRunbookPostcondition;
	  }
	| {
			kind: "iterate";
			/** Input id naming the bounded item-key array (U3 checkpoints). */
			over_input: string;
			/** The per-item step (an `action`) U3 checkpoints per stable key. */
			step: {
				kind: "action";
				action_id: string;
				expected_digest: string;
				inputs: Readonly<Record<string, string>>;
				postcondition?: BrowserUseRunbookPostcondition;
			};
	  };

/**
 * One typed input the runbook declares (R9). `required` inputs must be supplied
 * at execution; `schema` is the recursive value schema the supplied value is
 * runtime-validated against. Inputs are substituted into `{{id}}` tokens in
 * ordinary fill values only — never into a confidential field.
 */
export type BrowserUseRunbookInput = {
	id: string;
	summary: string;
	required: boolean;
	schema: BrowserUseRunbookValueSchema;
};

// --- The declarative runbook (v2) --------------------------------------------

/**
 * A declarative Browser Runbook (v2). One active path for a known flow, bound
 * to the agent-browser lane, discovered from
 * `$XDG_DATA_HOME/browser-use/runbooks/<service_id>/<flow_id>/`. It declares
 * allowed origins, typed inputs, ordered bounded steps, and an optional auth
 * context reference; it NEVER carries secret values (R30). `version` supports
 * R31 rollback (prior versions may be retained; exactly one is active).
 */
export type BrowserUseRunbook = {
	contract: "browser-use.runbook";
	schema_version: "2";
	service_id: string;
	flow_id: string;
	/** Human-readable stable slug for the repeated intent (CONTEXT: Flow Name). */
	flow_name: string;
	version: string;
	summary: string;
	/** Exact HTTP(S) origins the runbook is allowed to touch (R30). */
	allowed_origins: readonly string[];
	/** Non-secret auth context reference (R30); resolved by the auth plan. */
	auth_context_ref?: string;
	inputs: readonly BrowserUseRunbookInput[];
	steps: readonly BrowserUseRunbookStep[];
};

// --- Validation --------------------------------------------------------------

/** Typed runbook validation issue codes. */
export type BrowserUseRunbookIssueCode =
	| "runbook_contract_invalid"
	| "runbook_schema_unsupported"
	| "runbook_id_invalid"
	| "runbook_origin_invalid"
	| "runbook_auth_context_invalid"
	| "runbook_no_steps"
	| "runbook_input_invalid"
	| "runbook_input_schema_invalid"
	| "runbook_input_default_invalid"
	| "runbook_step_invalid"
	| "runbook_target_invalid"
	| "runbook_confidential_secret_present"
	| "runbook_input_reference_unknown"
	| "runbook_shape_invalid";

/** One typed validation issue. */
export type BrowserUseRunbookIssue = {
	code: BrowserUseRunbookIssueCode;
	message: string;
};

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_INPUT_ID = /^[a-z0-9][a-z0-9_]{0,63}$/;
const INPUT_TOKEN = /\{\{([a-z0-9_]+)\}\}/g;
const SAFE_DIGEST = /^[0-9a-f]{64}$/;
// A secret-shaped value an author might paste into a confidential field. The
// confidential variant has no `value` field at the type level, so this is a
// runtime backstop against a hand-authored file that smuggles one in.
const OP_SECRET_REF = /op:\/\//i;

/** Whether a value is one exact HTTP(S) origin with no extra URL parts. */
export function runbookExactOriginIsValid(value: string): boolean {
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

function originAllowed(value: string, allowed: ReadonlySet<string>): boolean {
	try {
		return allowed.has(new URL(value).origin);
	} catch {
		return false;
	}
}

/** Every `{{id}}` token referenced by an ordinary fill value. */
function referencedInputs(value: string): string[] {
	const ids: string[] = [];
	for (const match of value.matchAll(INPUT_TOKEN)) {
		const id = match[1];
		if (id !== undefined) ids.push(id);
	}
	return ids;
}

function validatePostcondition(
	postcondition: BrowserUseRunbookPostcondition,
): boolean {
	if (postcondition.kind === "url-equals") {
		return postcondition.url.length > 0;
	}
	// value-equals / element-visible: a `@`-ref is not a valid CSS selector for
	// a postcondition (the executor refuses those), and an empty selector is a
	// bug, not a probe.
	return (
		!postcondition.selector.startsWith("@") &&
		postcondition.selector.trim().length > 0
	);
}

function semanticTargetValid(target: BrowserUseRunbookSemanticTarget): boolean {
	return (
		typeof target.role === "string" &&
		target.role.trim().length > 0 &&
		typeof target.name === "string" &&
		target.name.trim().length > 0
	);
}

// --- Input value schema validation (R9) --------------------------------------

/**
 * Validate one recursive value schema shape (R9): bounded depth/width, valid
 * scalar bounds, and a default that (when present) satisfies the schema. Pure
 * and total — a malformed schema yields typed issues, never a throw.
 */
function validateValueSchema(
	schema: BrowserUseRunbookValueSchema,
	at: string,
	depth: number,
	issues: BrowserUseRunbookIssue[],
): void {
	if (depth > INPUT_SCHEMA_MAX_DEPTH) {
		issues.push({
			code: "runbook_input_schema_invalid",
			message: `${at}: value schema exceeds the maximum nesting depth ${INPUT_SCHEMA_MAX_DEPTH}.`,
		});
		return;
	}
	switch (schema.kind) {
		case "string": {
			if (schema.pattern !== undefined) {
				if (schema.pattern.length > INPUT_SCHEMA_MAX_PATTERN_LENGTH) {
					issues.push({
						code: "runbook_input_schema_invalid",
						message: `${at}: string pattern exceeds the maximum length ${INPUT_SCHEMA_MAX_PATTERN_LENGTH}.`,
					});
				} else {
					try {
						new RegExp(schema.pattern);
						if (patternHasUnsafeBacktrackingShape(schema.pattern)) {
							issues.push({
								code: "runbook_input_schema_invalid",
								message: `${at}: string schema pattern has an unsafe backtracking shape.`,
							});
						}
					} catch {
						issues.push({
							code: "runbook_input_schema_invalid",
							message: `${at}: string schema carries an invalid pattern.`,
						});
					}
				}
			}
			if (
				schema.min_length !== undefined &&
				schema.max_length !== undefined &&
				schema.min_length > schema.max_length
			) {
				issues.push({
					code: "runbook_input_schema_invalid",
					message: `${at}: string schema min_length exceeds max_length.`,
				});
			}
			if (schema.default !== undefined && !valueMatchesSchema(schema.default, schema)) {
				issues.push({
					code: "runbook_input_default_invalid",
					message: `${at}: string default does not satisfy its own schema.`,
				});
			}
			return;
		}
		case "number": {
			if (
				schema.minimum !== undefined &&
				schema.maximum !== undefined &&
				schema.minimum > schema.maximum
			) {
				issues.push({
					code: "runbook_input_schema_invalid",
					message: `${at}: number schema minimum exceeds its maximum.`,
				});
			}
			if (schema.default !== undefined && !valueMatchesSchema(schema.default, schema)) {
				issues.push({
					code: "runbook_input_default_invalid",
					message: `${at}: number default does not satisfy its own schema.`,
				});
			}
			return;
		}
		case "boolean": {
			if (schema.default !== undefined && typeof schema.default !== "boolean") {
				issues.push({
					code: "runbook_input_default_invalid",
					message: `${at}: boolean default is not a boolean.`,
				});
			}
			return;
		}
		case "enum": {
			if (schema.values.length === 0 || schema.values.length > INPUT_SCHEMA_MAX_WIDTH) {
				issues.push({
					code: "runbook_input_schema_invalid",
					message: `${at}: enum must declare 1..${INPUT_SCHEMA_MAX_WIDTH} values.`,
				});
			}
			if (schema.default !== undefined && !schema.values.includes(schema.default)) {
				issues.push({
					code: "runbook_input_default_invalid",
					message: `${at}: enum default is not one of its values.`,
				});
			}
			return;
		}
		case "date": {
			if (schema.default !== undefined && !isCalendarValidIsoDate(schema.default)) {
				issues.push({
					code: "runbook_input_default_invalid",
					message: `${at}: date default is not a calendar-valid ISO date.`,
				});
			}
			return;
		}
		case "uuid": {
			if (schema.default !== undefined && !UUID_V.test(schema.default)) {
				issues.push({
					code: "runbook_input_default_invalid",
					message: `${at}: uuid default is not a canonical lowercase UUID.`,
				});
			}
			return;
		}
		case "array": {
			if (
				schema.min_items !== undefined &&
				schema.max_items !== undefined &&
				schema.min_items > schema.max_items
			) {
				issues.push({
					code: "runbook_input_schema_invalid",
					message: `${at}: array schema min_items exceeds max_items.`,
				});
			}
			validateValueSchema(schema.items, `${at}.items`, depth + 1, issues);
			return;
		}
		case "object": {
			const keys = Object.keys(schema.fields);
			if (keys.length > INPUT_SCHEMA_MAX_WIDTH) {
				issues.push({
					code: "runbook_input_schema_invalid",
					message: `${at}: object declares more than ${INPUT_SCHEMA_MAX_WIDTH} fields.`,
				});
			}
			for (const key of keys) {
				const field = schema.fields[key];
				if (field === undefined) continue;
				validateValueSchema(field.schema, `${at}.${key}`, depth + 1, issues);
			}
			return;
		}
		case "discriminated-union": {
			const variantKeys = Object.keys(schema.variants);
			if (variantKeys.length === 0 || variantKeys.length > INPUT_SCHEMA_MAX_WIDTH) {
				issues.push({
					code: "runbook_input_schema_invalid",
					message: `${at}: discriminated-union must declare 1..${INPUT_SCHEMA_MAX_WIDTH} variants.`,
				});
			}
			for (const variantKey of variantKeys) {
				const fields = schema.variants[variantKey];
				if (fields === undefined) continue;
				for (const key of Object.keys(fields)) {
					const field = fields[key];
					if (field === undefined) continue;
					validateValueSchema(
						field.schema,
						`${at}.${variantKey}.${key}`,
						depth + 1,
						issues,
					);
				}
			}
			return;
		}
	}
}

/**
 * Runtime-validate a value against one recursive schema (R9). Bounded array
 * length, bounded object width, and calendar/UUID/enum/number-bound checks.
 * Pure and total; never throws. Unknown object fields are rejected.
 */
export function valueMatchesSchema(
	value: unknown,
	schema: BrowserUseRunbookValueSchema,
): boolean {
	switch (schema.kind) {
		case "string": {
			if (typeof value !== "string") return false;
			if (schema.min_length !== undefined && value.length < schema.min_length) return false;
			if (schema.max_length !== undefined && value.length > schema.max_length) return false;
			if (schema.pattern !== undefined) {
				if (
					schema.pattern.length > INPUT_SCHEMA_MAX_PATTERN_LENGTH ||
					patternHasUnsafeBacktrackingShape(schema.pattern)
				) {
					return false;
				}
				let anchored: RegExp;
				try {
					anchored = new RegExp(`^(?:${schema.pattern})$`);
				} catch {
					return false;
				}
				if (!anchored.test(value)) return false;
			}
			return true;
		}
		case "number": {
			if (typeof value !== "number" || !Number.isFinite(value)) return false;
			if (schema.integer === true && !Number.isInteger(value)) return false;
			if (schema.minimum !== undefined && value < schema.minimum) return false;
			if (schema.maximum !== undefined && value > schema.maximum) return false;
			return true;
		}
		case "boolean":
			return typeof value === "boolean";
		case "enum":
			return typeof value === "string" && schema.values.includes(value);
		case "date":
			return typeof value === "string" && isCalendarValidIsoDate(value);
		case "uuid":
			return typeof value === "string" && UUID_V.test(value);
		case "array": {
			if (!Array.isArray(value)) return false;
			if (value.length > INPUT_VALUE_MAX_ARRAY_LENGTH) return false;
			if (schema.min_items !== undefined && value.length < schema.min_items) return false;
			if (schema.max_items !== undefined && value.length > schema.max_items) return false;
			return value.every((item) => valueMatchesSchema(item, schema.items));
		}
		case "object": {
			if (!isPlainObject(value)) return false;
			const allowed = new Set(Object.keys(schema.fields));
			for (const key of Object.keys(value)) {
				if (!allowed.has(key)) return false; // reject unknown field
			}
			for (const [key, field] of Object.entries(schema.fields)) {
				const present = Object.hasOwn(value, key);
				if (!present) {
					if (field.required) return false;
					continue;
				}
				if (!valueMatchesSchema(value[key], field.schema)) return false;
			}
			return true;
		}
		case "discriminated-union": {
			if (!isPlainObject(value)) return false;
			const tag = value[schema.discriminant];
			if (typeof tag !== "string") return false;
			const variant = schema.variants[tag];
			if (variant === undefined) return false;
			const allowed = new Set<string>([schema.discriminant, ...Object.keys(variant)]);
			for (const key of Object.keys(value)) {
				if (!allowed.has(key)) return false;
			}
			for (const [key, field] of Object.entries(variant)) {
				const present = Object.hasOwn(value, key);
				if (!present) {
					if (field.required) return false;
					continue;
				}
				if (!valueMatchesSchema(value[key], field.schema)) return false;
			}
			return true;
		}
	}
}

function materializeValueDefaults(
	value: unknown,
	schema: BrowserUseRunbookValueSchema,
): unknown {
	if (value === undefined) {
		switch (schema.kind) {
			case "string":
			case "number":
			case "boolean":
			case "enum":
			case "date":
			case "uuid":
				return schema.default;
			default:
				return undefined;
		}
	}
	if (schema.kind === "array" && Array.isArray(value)) {
		return value.map((item) => materializeValueDefaults(item, schema.items));
	}
	if (schema.kind === "object" && isPlainObject(value)) {
		const normalized: Record<string, unknown> = { ...value };
		for (const [key, field] of Object.entries(schema.fields)) {
			const next = materializeValueDefaults(normalized[key], field.schema);
			if (next !== undefined) normalized[key] = next;
		}
		return normalized;
	}
	if (schema.kind === "discriminated-union" && isPlainObject(value)) {
		const tag = value[schema.discriminant];
		if (typeof tag !== "string") return value;
		const variant = schema.variants[tag];
		if (variant === undefined) return value;
		const normalized: Record<string, unknown> = { ...value };
		for (const [key, field] of Object.entries(variant)) {
			const next = materializeValueDefaults(normalized[key], field.schema);
			if (next !== undefined) normalized[key] = next;
		}
		return normalized;
	}
	return value;
}

/**
 * Materialize declared defaults before validation, action resolution, and
 * string substitution. The returned record is detached from caller-owned
 * objects; missing optional values without defaults stay absent.
 */
export function materializeRunbookInputs(
	runbook: BrowserUseRunbook,
	inputs: BrowserUseRunbookInputs,
): BrowserUseRunbookInputs {
	const normalized: Record<string, unknown> = { ...inputs };
	for (const declared of runbook.inputs) {
		const next = materializeValueDefaults(
			normalized[declared.id],
			declared.schema,
		);
		if (next !== undefined) normalized[declared.id] = next;
	}
	return normalized;
}

/**
 * Validate one Browser Runbook against v2 (well-formed contract, safe ids,
 * exact origins, bounded typed-input value schemas, ordered bounded steps,
 * semantic targets, no secret in a confidential field, and every `{{input}}`
 * reference declared). Pure and total: a malformed runbook yields typed issues,
 * never a throw. An empty array means the runbook satisfies every invariant.
 *
 * @param runbook - Parsed runbook definition (proven shape from parseRunbookRecord)
 * @returns Typed issues (empty when valid)
 */
export function validateRunbook(
	runbook: BrowserUseRunbook,
): BrowserUseRunbookIssue[] {
	const issues: BrowserUseRunbookIssue[] = [];
	if (runbook.contract !== "browser-use.runbook") {
		issues.push({
			code: "runbook_contract_invalid",
			message: "runbook contract id is not browser-use.runbook.",
		});
	}
	if (runbook.schema_version !== BROWSER_USE_RUNBOOK_SCHEMA_VERSION) {
		issues.push({
			code: "runbook_schema_unsupported",
			message: `runbook schema version ${String(runbook.schema_version)} is not supported (only ${BROWSER_USE_RUNBOOK_SCHEMA_VERSION}).`,
		});
	}
	if (!SAFE_ID.test(runbook.service_id) || !SAFE_ID.test(runbook.flow_id)) {
		issues.push({
			code: "runbook_id_invalid",
			message: "service_id and flow_id must be safe lowercase slugs.",
		});
	}
	const allowed = new Set<string>();
	if (runbook.allowed_origins.length === 0) {
		issues.push({
			code: "runbook_origin_invalid",
			message: "a runbook must declare at least one exact HTTP(S) origin.",
		});
	}
	for (const origin of runbook.allowed_origins) {
		if (!runbookExactOriginIsValid(origin)) {
			issues.push({
				code: "runbook_origin_invalid",
				message: "allowed_origins must be exact HTTP(S) origins.",
			});
		} else {
			allowed.add(origin);
		}
	}
	if (
		runbook.auth_context_ref !== undefined &&
		!isBrowserUseAuthContext(runbook.auth_context_ref)
	) {
		issues.push({
			code: "runbook_auth_context_invalid",
			message:
				"auth_context_ref must name an auth-owned context vocabulary member.",
		});
	}
	const inputIds = new Set<string>();
	for (const input of runbook.inputs) {
		if (!SAFE_INPUT_ID.test(input.id) || inputIds.has(input.id)) {
			issues.push({
				code: "runbook_input_invalid",
				message: `input id ${input.id} is invalid or duplicated.`,
			});
			continue;
		}
		validateValueSchema(input.schema, `input ${input.id}`, 1, issues);
		inputIds.add(input.id);
	}
	if (runbook.steps.length === 0) {
		issues.push({
			code: "runbook_no_steps",
			message: "a runbook must declare at least one bounded step.",
		});
	}
	for (const [index, step] of runbook.steps.entries()) {
		validateStep(step, index, allowed, inputIds, issues);
	}
	return issues;
}

function validateStep(
	step: BrowserUseRunbookStep,
	index: number,
	allowed: ReadonlySet<string>,
	inputIds: ReadonlySet<string>,
	issues: BrowserUseRunbookIssue[],
): void {
	const at = `step ${index}`;
	if (step.kind === "snapshot") return;
	if (step.kind === "open") {
		if (!originAllowed(step.url, allowed)) {
			issues.push({
				code: "runbook_step_invalid",
				message: `${at}: open url is outside the runbook's allowed origins.`,
			});
		}
		if (
			step.postcondition.kind !== "url-equals" ||
			!validatePostcondition(step.postcondition)
		) {
			issues.push({
				code: "runbook_step_invalid",
				message: `${at}: open requires a valid url-equals postcondition.`,
			});
		}
		return;
	}
	if (step.kind === "action" || step.kind === "iterate") {
		// Declared-but-UNAVAILABLE (U3). The SHAPE is validated so a migrated
		// runbook records structurally, but compilation refuses (see planRunbook).
		const inner = step.kind === "action" ? step : step.step;
		if (!SAFE_ID.test(inner.action_id) || !SAFE_DIGEST.test(inner.expected_digest)) {
			issues.push({
				code: "runbook_step_invalid",
				message: `${at}: reviewed action requires a safe action id and a 64-hex expected digest.`,
			});
		}
		if (step.kind === "iterate" && !inputIds.has(step.over_input)) {
			issues.push({
				code: "runbook_input_reference_unknown",
				message: `${at}: iterate references undeclared input ${step.over_input}.`,
			});
		}
		if (inner.postcondition !== undefined && !validatePostcondition(inner.postcondition)) {
			issues.push({
				code: "runbook_step_invalid",
				message: `${at}: reviewed action postcondition is not a valid probe.`,
			});
		}
		return;
	}
	// click / fill are semantic-target mutations.
	if (!semanticTargetValid(step.target)) {
		issues.push({
			code: "runbook_target_invalid",
			message: `${at}: a semantic target requires a non-empty role and name.`,
		});
	}
	if (step.kind === "click") {
		if (
			step.postcondition.kind !== "element-visible" ||
			!validatePostcondition(step.postcondition)
		) {
			issues.push({
				code: "runbook_step_invalid",
				message: `${at}: click requires a valid element-visible postcondition.`,
			});
		}
		return;
	}
	// fill: custody split.
	if (!validatePostcondition(step.postcondition)) {
		issues.push({
			code: "runbook_step_invalid",
			message: `${at}: mutation requires a valid postcondition.`,
		});
	}
	if (step.sensitivity === "confidential") {
		if (!SAFE_INPUT_ID.test(step.item_binding)) {
			issues.push({
				code: "runbook_step_invalid",
				message: `${at}: confidential fill requires a safe item_binding id.`,
			});
		}
		return;
	}
	// ordinary fill: no secret shape, and every {{input}} must be declared.
	if (OP_SECRET_REF.test(step.value)) {
		issues.push({
			code: "runbook_confidential_secret_present",
			message: `${at}: an ordinary fill value carries a secret-shaped reference; use a confidential item_binding.`,
		});
	}
	for (const id of referencedInputs(step.value)) {
		if (!inputIds.has(id)) {
			issues.push({
				code: "runbook_input_reference_unknown",
				message: `${at}: references undeclared input {{${id}}}.`,
			});
		}
	}
}

// --- Total parsing (R8, drop-v1) ---------------------------------------------

/** A total-parse outcome: a proven runbook, or a typed shape issue. */
export type BrowserUseRunbookParseResult =
	| { ok: true; runbook: BrowserUseRunbook }
	| { ok: false; issue: BrowserUseRunbookIssue };

function shapeIssue(message: string): {
	ok: false;
	issue: BrowserUseRunbookIssue;
} {
	return { ok: false, issue: { code: "runbook_shape_invalid", message } };
}

/** One exact-key violation found before model normalization. */
export type BrowserUseRunbookDocumentKeyIssue = {
	code: "runbook_document_field_missing" | "runbook_document_key_unknown";
	path: string;
	message: string;
};

const RUNBOOK_DOCUMENT_ROOT_KEYS = [
	"contract",
	"schema_version",
	"service_id",
	"flow_id",
	"flow_name",
	"version",
	"summary",
	"allowed_origins",
	"auth_context_ref",
	"inputs",
	"steps",
] as const;
const RUNBOOK_DOCUMENT_REQUIRED_KEYS = RUNBOOK_DOCUMENT_ROOT_KEYS.filter(
	(key) => key !== "auth_context_ref",
);

/** Project the complete authoring shape from the parser and validator owner. */
export function runbookDocumentAuthoringSchema() {
	const minimalValidExample = {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "example-service",
		flow_id: "read-status",
		flow_name: "example-read-status",
		version: "1",
		summary: "Read the current service status.",
		allowed_origins: ["https://portal.example.test"],
		inputs: [],
		steps: [{ kind: "snapshot", interactive: false }],
	} as const satisfies BrowserUseRunbook;
	return {
		document_contract: "browser-use.runbook",
		document_schema_version: "2",
		required: [...RUNBOOK_DOCUMENT_REQUIRED_KEYS],
		optional: ["auth_context_ref"],
		fields: {
			contract: { const: "browser-use.runbook" },
			schema_version: { const: "2" },
			service_id: { type: "safe-slug", owner: "validateRunbook" },
			flow_id: { type: "safe-slug", owner: "validateRunbook" },
			flow_name: { type: "string", owner: "validateRunbook" },
			version: { type: "string", owner: "validateRunbook" },
			summary: { type: "string", owner: "validateRunbook" },
			allowed_origins: { type: "exact-http-origin-array", owner: "validateRunbook" },
			auth_context_ref: { type: "auth-owned-reference", owner: "validateRunbook" },
			inputs: { type: "array", item_owner: "BrowserUseRunbookInput + parseRunbookRecord" },
			steps: {
				type: "non-empty-array",
				variants: ["snapshot", "open", "click", "fill", "action", "iterate"],
				item_owner: "BrowserUseRunbookStep + parseRunbookRecord",
			},
		},
		minimal_valid_example: structuredClone(minimalValidExample),
	} as const;
}

function inspectExactKeys(
	value: Record<string, unknown>,
	path: string,
	allowed: readonly string[],
	required: readonly string[],
	issues: BrowserUseRunbookDocumentKeyIssue[],
): void {
	for (const key of required) {
		if (!(key in value)) issues.push({ code: "runbook_document_field_missing", path: `${path}.${key}`, message: "a required field is missing." });
	}
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) issues.push({ code: "runbook_document_key_unknown", path: `${path}.${key}`, message: "an unknown field is forbidden." });
	}
}

function inspectPostconditionKeys(value: unknown, path: string, issues: BrowserUseRunbookDocumentKeyIssue[]): void {
	if (!isPlainObject(value)) return;
	const allowed = value.kind === "url-equals" ? ["kind", "url"] : value.kind === "value-equals" ? ["kind", "selector", "value"] : ["kind", "selector"];
	inspectExactKeys(value, path, allowed, allowed, issues);
}

function inspectSchemaFieldKeys(value: unknown, path: string, issues: BrowserUseRunbookDocumentKeyIssue[]): void {
	if (!isPlainObject(value)) return;
	for (const [key, field] of Object.entries(value)) {
		if (!isPlainObject(field)) continue;
		inspectExactKeys(field, `${path}.${key}`, ["schema", "required"], ["schema", "required"], issues);
		inspectSchemaKeys(field.schema, `${path}.${key}.schema`, issues);
	}
}

function inspectSchemaKeys(value: unknown, path: string, issues: BrowserUseRunbookDocumentKeyIssue[]): void {
	if (!isPlainObject(value) || typeof value.kind !== "string") return;
	const byKind: Readonly<Record<string, readonly string[]>> = {
		string: ["kind", "min_length", "max_length", "pattern", "default"],
		number: ["kind", "minimum", "maximum", "integer", "default"],
		boolean: ["kind", "default"],
		enum: ["kind", "values", "default"],
		date: ["kind", "default"],
		uuid: ["kind", "default"],
		array: ["kind", "items", "min_items", "max_items"],
		object: ["kind", "fields"],
		"discriminated-union": ["kind", "discriminant", "variants"],
	};
	const allowed = byKind[value.kind];
	if (allowed === undefined) return;
	const required = ["kind", ...(value.kind === "array" ? ["items"] : value.kind === "object" ? ["fields"] : value.kind === "discriminated-union" ? ["discriminant", "variants"] : value.kind === "enum" ? ["values"] : [])];
	inspectExactKeys(value, path, allowed, required, issues);
	if (value.kind === "array") inspectSchemaKeys(value.items, `${path}.items`, issues);
	if (value.kind === "object") inspectSchemaFieldKeys(value.fields, `${path}.fields`, issues);
	if (value.kind === "discriminated-union" && isPlainObject(value.variants)) for (const [tag, fields] of Object.entries(value.variants)) inspectSchemaFieldKeys(fields, `${path}.variants.${tag}`, issues);
}

function inspectActionKeys(value: Record<string, unknown>, path: string, issues: BrowserUseRunbookDocumentKeyIssue[]): void {
	inspectExactKeys(value, path, ["kind", "action_id", "expected_digest", "inputs", "postcondition"], ["kind", "action_id", "expected_digest", "inputs"], issues);
	if (value.postcondition !== undefined) inspectPostconditionKeys(value.postcondition, `${path}.postcondition`, issues);
}

function inspectStepKeys(value: unknown, path: string, issues: BrowserUseRunbookDocumentKeyIssue[]): void {
	if (!isPlainObject(value)) return;
	switch (value.kind) {
		case "snapshot":
			inspectExactKeys(value, path, ["kind", "interactive"], ["kind", "interactive"], issues);
			break;
		case "open":
			inspectExactKeys(value, path, ["kind", "url", "postcondition"], ["kind", "url", "postcondition"], issues);
			inspectPostconditionKeys(value.postcondition, `${path}.postcondition`, issues);
			break;
		case "click":
			inspectExactKeys(value, path, ["kind", "target", "postcondition"], ["kind", "target", "postcondition"], issues);
			if (isPlainObject(value.target)) inspectExactKeys(value.target, `${path}.target`, ["role", "name"], ["role", "name"], issues);
			inspectPostconditionKeys(value.postcondition, `${path}.postcondition`, issues);
			break;
		case "fill": {
			const confidential = value.sensitivity === "confidential";
			const allowed = ["kind", "target", "sensitivity", confidential ? "item_binding" : "value", "postcondition"];
			inspectExactKeys(value, path, allowed, allowed, issues);
			if (isPlainObject(value.target)) inspectExactKeys(value.target, `${path}.target`, ["role", "name"], ["role", "name"], issues);
			inspectPostconditionKeys(value.postcondition, `${path}.postcondition`, issues);
			break;
		}
		case "action":
			inspectActionKeys(value, path, issues);
			break;
		case "iterate":
			inspectExactKeys(value, path, ["kind", "over_input", "step"], ["kind", "over_input", "step"], issues);
			if (isPlainObject(value.step)) inspectActionKeys(value.step, `${path}.step`, issues);
			break;
	}
}

/** Inspect recursive allowed keys without normalizing or discarding input. */
export function inspectRunbookDocumentKeys(raw: unknown): BrowserUseRunbookDocumentKeyIssue[] {
	if (!isPlainObject(raw)) return [];
	const issues: BrowserUseRunbookDocumentKeyIssue[] = [];
	inspectExactKeys(raw, "$", RUNBOOK_DOCUMENT_ROOT_KEYS, RUNBOOK_DOCUMENT_REQUIRED_KEYS, issues);
	if (Array.isArray(raw.inputs)) for (const [index, input] of raw.inputs.entries()) {
		if (!isPlainObject(input)) continue;
		inspectExactKeys(input, `$.inputs[${index}]`, ["id", "summary", "required", "schema"], ["id", "summary", "required", "schema"], issues);
		inspectSchemaKeys(input.schema, `$.inputs[${index}].schema`, issues);
	}
	if (Array.isArray(raw.steps)) for (const [index, step] of raw.steps.entries()) inspectStepKeys(step, `$.steps[${index}]`, issues);
	return issues;
}

// Recursively prove a value-schema shape from untrusted JSON. Returns undefined
// on any structural violation; the caller maps that to a typed shape issue.
function parseValueSchema(
	raw: unknown,
	depth: number,
): BrowserUseRunbookValueSchema | undefined {
	if (depth > INPUT_SCHEMA_MAX_DEPTH || !isPlainObject(raw)) return undefined;
	const kind = raw.kind;
	if (typeof kind !== "string") return undefined;
	const optNumber = (v: unknown): number | undefined =>
		v === undefined ? undefined : typeof v === "number" ? v : Number.NaN;
	const badNum = (v: number | undefined): boolean =>
		v !== undefined && Number.isNaN(v);
	switch (kind) {
		case "string": {
			if (!hasOnlyKeys(raw, ["kind", "min_length", "max_length", "pattern", "default"])) return undefined;
			const min = optNumber(raw.min_length);
			const max = optNumber(raw.max_length);
			if (badNum(min) || badNum(max)) return undefined;
			if (raw.pattern !== undefined && typeof raw.pattern !== "string") return undefined;
			if (raw.default !== undefined && typeof raw.default !== "string") return undefined;
			return {
				kind: "string",
				...(min !== undefined ? { min_length: min } : {}),
				...(max !== undefined ? { max_length: max } : {}),
				...(typeof raw.pattern === "string" ? { pattern: raw.pattern } : {}),
				...(typeof raw.default === "string" ? { default: raw.default } : {}),
			};
		}
		case "number": {
			if (!hasOnlyKeys(raw, ["kind", "minimum", "maximum", "integer", "default"])) return undefined;
			const min = optNumber(raw.minimum);
			const max = optNumber(raw.maximum);
			if (badNum(min) || badNum(max)) return undefined;
			if (raw.integer !== undefined && typeof raw.integer !== "boolean") return undefined;
			if (raw.default !== undefined && typeof raw.default !== "number") return undefined;
			return {
				kind: "number",
				...(min !== undefined ? { minimum: min } : {}),
				...(max !== undefined ? { maximum: max } : {}),
				...(typeof raw.integer === "boolean" ? { integer: raw.integer } : {}),
				...(typeof raw.default === "number" ? { default: raw.default } : {}),
			};
		}
		case "boolean": {
			if (!hasOnlyKeys(raw, ["kind", "default"])) return undefined;
			if (raw.default !== undefined && typeof raw.default !== "boolean") return undefined;
			return {
				kind: "boolean",
				...(typeof raw.default === "boolean" ? { default: raw.default } : {}),
			};
		}
		case "enum": {
			if (!hasOnlyKeys(raw, ["kind", "values", "default"])) return undefined;
			if (!Array.isArray(raw.values) || raw.values.some((v) => typeof v !== "string")) {
				return undefined;
			}
			if (raw.default !== undefined && typeof raw.default !== "string") return undefined;
			return {
				kind: "enum",
				values: raw.values as readonly string[],
				...(typeof raw.default === "string" ? { default: raw.default } : {}),
			};
		}
		case "date":
		case "uuid": {
			if (!hasOnlyKeys(raw, ["kind", "default"])) return undefined;
			if (raw.default !== undefined && typeof raw.default !== "string") return undefined;
			return {
				kind,
				...(typeof raw.default === "string" ? { default: raw.default } : {}),
			} as BrowserUseRunbookValueSchema;
		}
		case "array": {
			if (!hasOnlyKeys(raw, ["kind", "items", "min_items", "max_items"])) return undefined;
			const items = parseValueSchema(raw.items, depth + 1);
			if (items === undefined) return undefined;
			const min = optNumber(raw.min_items);
			const max = optNumber(raw.max_items);
			if (badNum(min) || badNum(max)) return undefined;
			return {
				kind: "array",
				items,
				...(min !== undefined ? { min_items: min } : {}),
				...(max !== undefined ? { max_items: max } : {}),
			};
		}
		case "object": {
			if (!hasOnlyKeys(raw, ["kind", "fields"])) return undefined;
			const fields = parseSchemaFields(raw.fields, depth);
			if (fields === undefined) return undefined;
			return { kind: "object", fields };
		}
		case "discriminated-union": {
			if (!hasOnlyKeys(raw, ["kind", "discriminant", "variants"])) return undefined;
			if (typeof raw.discriminant !== "string" || !isPlainObject(raw.variants)) {
				return undefined;
			}
			const variants: Record<
				string,
				Record<string, { schema: BrowserUseRunbookValueSchema; required: boolean }>
			> = {};
			for (const [tag, rawFields] of Object.entries(raw.variants)) {
				const fields = parseSchemaFields(rawFields, depth);
				if (fields === undefined) return undefined;
				variants[tag] = fields;
			}
			return { kind: "discriminated-union", discriminant: raw.discriminant, variants };
		}
		default:
			return undefined;
	}
}

function parseSchemaFields(
	raw: unknown,
	depth: number,
):
	| Record<string, { schema: BrowserUseRunbookValueSchema; required: boolean }>
	| undefined {
	if (!isPlainObject(raw)) return undefined;
	const fields: Record<
		string,
		{ schema: BrowserUseRunbookValueSchema; required: boolean }
	> = {};
	for (const [key, rawField] of Object.entries(raw)) {
		if (!isPlainObject(rawField)) return undefined;
		if (!hasOnlyKeys(rawField, ["schema", "required"])) return undefined;
		if (typeof rawField.required !== "boolean") return undefined;
		const schema = parseValueSchema(rawField.schema, depth + 1);
		if (schema === undefined) return undefined;
		fields[key] = { schema, required: rawField.required };
	}
	return fields;
}

function parsePostcondition(
	raw: unknown,
): BrowserUseRunbookPostcondition | undefined {
	if (!isPlainObject(raw)) return undefined;
	if (raw.kind === "url-equals" && typeof raw.url === "string") {
		if (!hasOnlyKeys(raw, ["kind", "url"])) return undefined;
		return { kind: "url-equals", url: raw.url };
	}
	if (raw.kind === "value-equals" && typeof raw.selector === "string" && typeof raw.value === "string") {
		if (!hasOnlyKeys(raw, ["kind", "selector", "value"])) return undefined;
		return { kind: "value-equals", selector: raw.selector, value: raw.value };
	}
	if (raw.kind === "element-visible" && typeof raw.selector === "string") {
		if (!hasOnlyKeys(raw, ["kind", "selector"])) return undefined;
		return { kind: "element-visible", selector: raw.selector };
	}
	return undefined;
}

function parseSemanticTarget(
	raw: unknown,
): BrowserUseRunbookSemanticTarget | undefined {
	if (!isPlainObject(raw)) return undefined;
	if (!hasOnlyKeys(raw, ["role", "name"])) return undefined;
	if (typeof raw.role !== "string" || typeof raw.name !== "string") return undefined;
	return { role: raw.role, name: raw.name };
}

function parseStringRecord(
	raw: unknown,
): Readonly<Record<string, string>> | undefined {
	if (!isPlainObject(raw)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value !== "string") return undefined;
		out[key] = value;
	}
	return out;
}

function parseActionShape(
	raw: Record<string, unknown>,
):
	| {
			kind: "action";
			action_id: string;
			expected_digest: string;
			inputs: Readonly<Record<string, string>>;
			postcondition?: BrowserUseRunbookPostcondition;
	  }
	| undefined {
	if (!hasOnlyKeys(raw, ["kind", "action_id", "expected_digest", "inputs", "postcondition"])) return undefined;
	if (typeof raw.action_id !== "string" || typeof raw.expected_digest !== "string") {
		return undefined;
	}
	const inputs = parseStringRecord(raw.inputs);
	if (inputs === undefined) return undefined;
	let postcondition: BrowserUseRunbookPostcondition | undefined;
	if (raw.postcondition !== undefined) {
		postcondition = parsePostcondition(raw.postcondition);
		if (postcondition === undefined) return undefined;
	}
	return {
		kind: "action",
		action_id: raw.action_id,
		expected_digest: raw.expected_digest,
		inputs,
		...(postcondition !== undefined ? { postcondition } : {}),
	};
}

function parseStep(raw: unknown): BrowserUseRunbookStep | undefined {
	if (!isPlainObject(raw)) return undefined;
	switch (raw.kind) {
		case "snapshot": {
			if (!hasOnlyKeys(raw, ["kind", "interactive"])) return undefined;
			if (typeof raw.interactive !== "boolean") return undefined;
			return { kind: "snapshot", interactive: raw.interactive };
		}
		case "open": {
			if (!hasOnlyKeys(raw, ["kind", "url", "postcondition"])) return undefined;
			const post = parsePostcondition(raw.postcondition);
			if (typeof raw.url !== "string" || post === undefined || post.kind !== "url-equals") {
				return undefined;
			}
			return { kind: "open", url: raw.url, postcondition: post };
		}
		case "click": {
			if (!hasOnlyKeys(raw, ["kind", "target", "postcondition"])) return undefined;
			const target = parseSemanticTarget(raw.target);
			const post = parsePostcondition(raw.postcondition);
			if (target === undefined || post === undefined || post.kind !== "element-visible") {
				return undefined;
			}
			return { kind: "click", target, postcondition: post };
		}
		case "fill": {
			const target = parseSemanticTarget(raw.target);
			const post = parsePostcondition(raw.postcondition);
			if (target === undefined || post === undefined) return undefined;
			if (raw.sensitivity === "confidential") {
				if (!hasOnlyKeys(raw, ["kind", "target", "sensitivity", "item_binding", "postcondition"])) return undefined;
				if (typeof raw.item_binding !== "string") return undefined;
				return {
					kind: "fill",
					target,
					sensitivity: "confidential",
					item_binding: raw.item_binding,
					postcondition: post,
				};
			}
			if (raw.sensitivity === "ordinary") {
				if (!hasOnlyKeys(raw, ["kind", "target", "sensitivity", "value", "postcondition"])) return undefined;
				if (typeof raw.value !== "string") return undefined;
				return {
					kind: "fill",
					target,
					sensitivity: "ordinary",
					value: raw.value,
					postcondition: post,
				};
			}
			return undefined;
		}
		case "action": {
			return parseActionShape(raw);
		}
		case "iterate": {
			if (!hasOnlyKeys(raw, ["kind", "over_input", "step"])) return undefined;
			if (typeof raw.over_input !== "string" || !isPlainObject(raw.step)) return undefined;
			if (raw.step.kind !== "action") return undefined;
			const inner = parseActionShape(raw.step);
			if (inner === undefined) return undefined;
			return { kind: "iterate", over_input: raw.over_input, step: inner };
		}
		default:
			return undefined;
	}
}

function parseInput(raw: unknown): BrowserUseRunbookInput | undefined {
	if (!isPlainObject(raw)) return undefined;
	if (!hasOnlyKeys(raw, ["id", "summary", "required", "schema"])) return undefined;
	if (
		typeof raw.id !== "string" ||
		typeof raw.summary !== "string" ||
		typeof raw.required !== "boolean"
	) {
		return undefined;
	}
	const schema = parseValueSchema(raw.schema, 1);
	if (schema === undefined) return undefined;
	return { id: raw.id, summary: raw.summary, required: raw.required, schema };
}

/**
 * TOTAL parse of one untrusted runbook record (R8, drop-v1). Proves every field
 * shape before returning a typed {@link BrowserUseRunbook} — the engine never
 * casts raw JSON to the runbook type. A record that is not an object, is not
 * v2, or carries a malformed step/input/schema returns a typed shape issue.
 * Schema-invariant validation (safe ids, origins, targets, references) is a
 * SEPARATE pass ({@link validateRunbook}) the caller runs on the proven shape.
 *
 * @param raw - Untrusted parsed JSON
 * @returns The proven runbook shape, or one typed shape issue
 */
export function parseRunbookRecord(raw: unknown): BrowserUseRunbookParseResult {
	if (!isPlainObject(raw)) {
		return shapeIssue("runbook record is not a JSON object.");
	}
	if (inspectRunbookDocumentKeys(raw).length > 0) {
		return shapeIssue("runbook record contains an unknown or missing field.");
	}
	if (!hasOnlyKeys(raw, [
		"contract",
		"schema_version",
		"service_id",
		"flow_id",
		"flow_name",
		"version",
		"summary",
		"allowed_origins",
		"auth_context_ref",
		"inputs",
		"steps",
	])) {
		return shapeIssue("runbook record contains an unknown field.");
	}
	if (raw.contract !== "browser-use.runbook") {
		return shapeIssue("runbook record contract id is not browser-use.runbook.");
	}
	if (raw.schema_version !== BROWSER_USE_RUNBOOK_SCHEMA_VERSION) {
		return {
			ok: false,
			issue: {
				code: "runbook_schema_unsupported",
				message: `runbook schema version ${String(raw.schema_version)} is not supported (only ${BROWSER_USE_RUNBOOK_SCHEMA_VERSION}).`,
			},
		};
	}
	for (const field of ["service_id", "flow_id", "flow_name", "version", "summary"] as const) {
		if (typeof raw[field] !== "string") {
			return shapeIssue(`runbook ${field} must be a string.`);
		}
	}
	if (
		!Array.isArray(raw.allowed_origins) ||
		raw.allowed_origins.some((o) => typeof o !== "string")
	) {
		return shapeIssue("runbook allowed_origins must be a string array.");
	}
	if (raw.auth_context_ref !== undefined && typeof raw.auth_context_ref !== "string") {
		return shapeIssue("runbook auth_context_ref must be a string when present.");
	}
	if (!Array.isArray(raw.inputs)) {
		return shapeIssue("runbook inputs must be an array.");
	}
	const inputs: BrowserUseRunbookInput[] = [];
	for (const rawInput of raw.inputs) {
		const input = parseInput(rawInput);
		if (input === undefined) return shapeIssue("a runbook input has an invalid shape.");
		inputs.push(input);
	}
	if (!Array.isArray(raw.steps)) {
		return shapeIssue("runbook steps must be an array.");
	}
	const steps: BrowserUseRunbookStep[] = [];
	for (const rawStep of raw.steps) {
		const step = parseStep(rawStep);
		if (step === undefined) return shapeIssue("a runbook step has an invalid shape.");
		steps.push(step);
	}
	return {
		ok: true,
		runbook: {
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: raw.service_id as string,
			flow_id: raw.flow_id as string,
			flow_name: raw.flow_name as string,
			version: raw.version as string,
			summary: raw.summary as string,
			allowed_origins: raw.allowed_origins as readonly string[],
			...(typeof raw.auth_context_ref === "string"
				? { auth_context_ref: raw.auth_context_ref }
				: {}),
			inputs,
			steps,
		},
	};
}

// --- Execution planning (F7 continuation) ------------------------------------

/**
 * Typed input binding supplied at execution: one value per declared input id.
 * v2 values may be structured (from the private-file route); ordinary fill
 * token substitution uses only scalar (string/number/boolean) values.
 */
export type BrowserUseRunbookInputs = Readonly<Record<string, unknown>>;

/** Typed execution-planning refusal. */
export type BrowserUseRunbookPlanRefusal = {
	code:
		| "runbook_invalid"
		| "runbook_input_missing"
		| "runbook_input_rejected"
		| "runbook_resume_out_of_range"
		| "runbook_action_registry_unavailable";
	message: string;
};

/**
 * A planned execution: the compiled bounded Agent Browser steps (from
 * `resume_from_step` onward) plus the resolved allowed origins, ready to hand
 * to the agent-browser executor. `resume_from_step` realises F7: a resumed run
 * replays only from its first unproven step, so an already-confirmed mutation
 * is never re-dispatched.
 */
/**
 * The result schema + sensitivity for one resolved read `evaluate` action,
 * keyed by action id (R21, R24). The engine uses this after execution to
 * validate and redact the executor's raw read observation through
 * `captureStructuredResult` before any bounded summary reaches shared-run state.
 * Only read actions appear here; mutations have no capturable result.
 */
export type BrowserUseRunbookReadActionMeta = {
	result_schema: BrowserUseActionValueSchema;
	result_sensitivity: "low" | "high";
};

/** One engine-attested reviewed-action resolution for an absolute runbook step. */
export type BrowserUseRunbookActionResolution =
	| {
			kind: "steps";
			steps: readonly AgentBrowserTaskStep[];
	  }
	| { kind: "completed-iterate" };

export type BrowserUseRunbookPlan = {
	service_id: string;
	flow_id: string;
	version: string;
	allowed_origins: readonly string[];
	auth_context_ref?: string;
	resume_from_step: number;
	total_steps: number;
	steps: readonly AgentBrowserTaskStep[];
	/**
	 * Absolute runbook step index for each compiled executor step. Expanded
	 * iterations repeat their source index so partial execution resumes the
	 * iterate and lets durable item checkpoints skip only confirmed items.
	 */
	compiled_step_runbook_indices: readonly number[];
	/** Item Binding ids the auth transaction must resolve before dispatch. */
	pending_item_bindings: readonly string[];
	/**
	 * Result schema + sensitivity for each read `evaluate` execution in this
	 * plan, keyed by `${action_id}:${item_key ?? ""}` — action id plus its
	 * optional stable item key, so each iterated read has its own entry (R21,
	 * R24). Empty unless the runbook declares a read action. The engine consumes
	 * it after execution to capture bounded, redacted structured results into
	 * the shared-run outcome; a bare-action-id lookup would miss iterated reads.
	 */
	read_action_meta: Readonly<Record<string, BrowserUseRunbookReadActionMeta>>;
};

/** Resolve the first runbook step not proven by compiled executor progress. */
export function nextRunbookStepAfterExecution(
	plan: Pick<
		BrowserUseRunbookPlan,
		| "resume_from_step"
		| "total_steps"
		| "compiled_step_runbook_indices"
	>,
	executedSteps: number,
): number {
	if (executedSteps >= plan.compiled_step_runbook_indices.length) {
		return plan.total_steps;
	}
	return (
		plan.compiled_step_runbook_indices[executedSteps] ??
		plan.resume_from_step
	);
}

export type BrowserUseRunbookPlanResult =
	| { ok: true; plan: BrowserUseRunbookPlan }
	| { ok: false; refusal: BrowserUseRunbookPlanRefusal };

// A scalar value renders into a fill token; a structured value never does.
function scalarToken(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	return undefined;
}

function substituteInputs(
	value: string,
	inputs: BrowserUseRunbookInputs,
): string {
	return value.replace(INPUT_TOKEN, (_whole, id: string) => {
		const token = scalarToken(inputs[id]);
		return token ?? "";
	});
}

/**
 * Compile one runbook step into the executor's bounded step. A confidential
 * fill keeps `sensitivity: "confidential"` with an empty value: the executor
 * refuses every confidential fill to the auth transaction (R30), so the engine
 * surfaces the item binding as `pending_item_bindings` rather than resolving a
 * secret here. Semantic targets compile to `click-semantic` (click) and to a
 * semantic `target` on the executor `fill` step (R11): the executor resolves
 * each against a fresh snapshot and dispatches only on EXACTLY ONE match.
 */
function compileStep(
	step: BrowserUseRunbookStep,
	inputs: BrowserUseRunbookInputs,
): AgentBrowserTaskStep {
	if (step.kind === "snapshot") {
		return { kind: "snapshot", interactive: step.interactive };
	}
	if (step.kind === "open") {
		return { kind: "open", url: step.url, postcondition: step.postcondition };
	}
	if (step.kind === "click") {
		return {
			kind: "click-semantic",
			role: step.target.role,
			name: step.target.name,
			postcondition: step.postcondition,
		};
	}
	// fill (action/iterate are refused earlier in planRunbookExecution). The
	// executor resolves the semantic `target` against a fresh snapshot (R11 —
	// exactly one match); `ref` is an unused durable placeholder the executor
	// overrides once the target resolves.
	if (step.kind === "fill" && step.sensitivity === "confidential") {
		return {
			kind: "fill",
			ref: "@e0",
			target: { role: step.target.role, name: step.target.name },
			value: "",
			sensitivity: "confidential",
			// The step's own binding slug rides the compiled step so the executor
			// resolves its credential field at fill time via the delivery context's
			// `field_by_binding_slug` (KTD5) — never a positional lookup.
			item_binding: step.item_binding,
			postcondition: step.postcondition,
		};
	}
	// ordinary fill.
	if (step.kind === "fill") {
		return {
			kind: "fill",
			ref: "@e0",
			target: { role: step.target.role, name: step.target.name },
			value: substituteInputs(step.value, inputs),
			sensitivity: "ordinary",
			postcondition: step.postcondition,
		};
	}
	// Unreachable: action/iterate refuse before compilation. Keep total.
	return { kind: "snapshot", interactive: false };
}

/**
 * Plan a runbook execution (F7 continuation): validate the runbook, enforce
 * typed inputs against their recursive value schemas (R9), refuse any
 * declared-but-unavailable reviewed-action/iteration step (U3 not yet
 * available), then compile the steps from `resumeFromStep` onward into bounded
 * Agent Browser steps for the executor. Pure and total.
 *
 * @param runbook - The runbook definition
 * @param input - Typed inputs plus the resume-from step index
 * @returns The planned bounded steps, or one typed refusal
 */
export function planRunbookExecution(
	runbook: BrowserUseRunbook,
	input: {
		inputs: BrowserUseRunbookInputs;
		resumeFromStep: number;
		/**
		 * ENGINE-attested resolution for each `action`/`iterate` step by absolute
		 * index (U3). A resolution carries verified executor steps or exact
		 * completed-iterate truth. The pure model never resolves an asset itself.
		 * A runbook action with no valid entry is refused
		 * `runbook_action_registry_unavailable`.
		 */
		resolvedActionSteps?: ReadonlyMap<
			number,
			BrowserUseRunbookActionResolution
		>;
		/**
		 * Result schema + sensitivity for each resolved read `evaluate` execution,
		 * keyed by action id plus optional stable item key (R21, R24). The engine
		 * resolves these alongside the executor steps and passes them through so
		 * the compiled plan can drive post-execution structured-result capture.
		 * Empty for action-free or mutation-only runbooks.
		 */
		readActionMeta?: Readonly<
			Record<string, BrowserUseRunbookReadActionMeta>
		>;
	},
): BrowserUseRunbookPlanResult {
	const issues = validateRunbook(runbook);
	if (issues.length > 0) {
		return {
			ok: false,
			refusal: {
				code: "runbook_invalid",
				message: `runbook is invalid: ${issues.map((i) => i.code).join(", ")}.`,
			},
		};
	}
	const normalizedInputs = materializeRunbookInputs(runbook, input.inputs);
	// Reviewed-action and iteration steps require an engine-resolved executor
	// step (U3): the pure model NEVER resolves an asset. When the engine supplies
	// no resolution for an action/iterate step, refuse with a typed pointer
	// rather than silently dropping a step.
	const resolvedActionSteps = input.resolvedActionSteps ?? new Map();
	const unresolvedActionStep = runbook.steps.findIndex(
		(step, index) => {
			if (step.kind !== "action" && step.kind !== "iterate") return false;
			const resolved = resolvedActionSteps.get(index);
			return (
				resolved === undefined ||
				(resolved.kind === "steps" && resolved.steps.length === 0) ||
				(resolved.kind === "completed-iterate" && step.kind !== "iterate")
			);
		},
	);
	if (unresolvedActionStep !== -1) {
		return {
			ok: false,
			refusal: {
				code: "runbook_action_registry_unavailable",
				message:
					"this runbook declares a reviewed-action or iteration step with no resolved action asset; resolve it through a staged or active generation before execution.",
			},
		};
	}
	for (const declared of runbook.inputs) {
		const value = normalizedInputs[declared.id];
		if (value === undefined) {
			if (declared.required) {
				return {
					ok: false,
					refusal: {
						code: "runbook_input_missing",
						message: `required input ${declared.id} was not supplied.`,
					},
				};
			}
			continue;
		}
		if (!valueMatchesSchema(value, declared.schema)) {
			return {
				ok: false,
				refusal: {
					code: "runbook_input_rejected",
					message: `input ${declared.id} does not satisfy its declared value schema.`,
				},
			};
		}
	}
	if (
		!Number.isInteger(input.resumeFromStep) ||
		input.resumeFromStep < 0 ||
		input.resumeFromStep > runbook.steps.length
	) {
		return {
			ok: false,
			refusal: {
				code: "runbook_resume_out_of_range",
				message: `resume-from step ${input.resumeFromStep} is outside the runbook's ${runbook.steps.length} steps.`,
			},
		};
	}
	const remaining = runbook.steps.slice(input.resumeFromStep);
	// Compile each remaining step. An `action`/`iterate` step expands into its
	// engine-resolved executor steps (U3, keyed by ABSOLUTE step index); every
	// other kind compiles through the pure `compileStep`.
	const compiled: AgentBrowserTaskStep[] = [];
	const compiledStepRunbookIndices: number[] = [];
	for (const [offset, step] of remaining.entries()) {
		const absoluteIndex = input.resumeFromStep + offset;
		if (step.kind === "action" || step.kind === "iterate") {
			const resolution = resolvedActionSteps.get(absoluteIndex);
			if (resolution?.kind !== "steps") continue;
			for (const resolved of resolution.steps) {
				compiled.push(resolved);
				compiledStepRunbookIndices.push(absoluteIndex);
			}
			continue;
		}
		compiled.push(compileStep(step, normalizedInputs));
		compiledStepRunbookIndices.push(absoluteIndex);
	}
	const pendingBindings = remaining
		.filter(
			(
				step,
			): step is Extract<
				BrowserUseRunbookStep,
				{ kind: "fill"; sensitivity: "confidential" }
			> => step.kind === "fill" && step.sensitivity === "confidential",
		)
		.map((step) => step.item_binding);
	return {
		ok: true,
		plan: {
			service_id: runbook.service_id,
			flow_id: runbook.flow_id,
			version: runbook.version,
			allowed_origins: runbook.allowed_origins,
			...(runbook.auth_context_ref !== undefined
				? { auth_context_ref: runbook.auth_context_ref }
				: {}),
			resume_from_step: input.resumeFromStep,
			total_steps: runbook.steps.length,
			steps: compiled,
			compiled_step_runbook_indices: compiledStepRunbookIndices,
			pending_item_bindings: [...new Set(pendingBindings)],
			read_action_meta: input.readActionMeta ?? {},
		},
	};
}

// --- Effect class + projection (R13) -----------------------------------------

/**
 * Derive a runbook's audited effect class (R13/R19). Any fill, click, or
 * reviewed-action step makes it a mutation; a runbook that only opens and
 * snapshots is read-only.
 */
export function runbookEffectClass(
	runbook: BrowserUseRunbook,
): BrowserUseRunbookEffectClass {
	const mutates = runbook.steps.some(
		(step) =>
			step.kind === "click" ||
			step.kind === "fill" ||
			step.kind === "action" ||
			step.kind === "iterate",
	);
	return mutates ? "mutation" : "read-only";
}

/**
 * One redacted `runbook list` row (R13/R35): service/flow identity, health,
 * step count, effect class, and auth/approval requirements. No selector,
 * origin, target, or input value leaks into a catalog row.
 */
export type BrowserUseRunbookCatalogRow = {
	service_id: string;
	flow_id: string;
	flow_name: string;
	version: string;
	summary: string;
	step_count: number;
	input_count: number;
	requires_auth: boolean;
	/** True when the runbook declares any reviewed action needing promotion (R13). */
	requires_approval: boolean;
	effect_class: BrowserUseRunbookEffectClass;
	health: BrowserUseRunbookHealth;
};

/**
 * Project one validated runbook into a redacted catalog row. Health is derived
 * by the discovery layer (outcome-informed).
 *
 * @param runbook - The runbook definition
 * @param health - Health derived by the discovery layer (outcome-informed)
 * @returns One redacted catalog row
 */
export function projectRunbookCatalogRow(
	runbook: BrowserUseRunbook,
	health: BrowserUseRunbookHealth,
): BrowserUseRunbookCatalogRow {
	return {
		service_id: runbook.service_id,
		flow_id: runbook.flow_id,
		flow_name: runbook.flow_name,
		version: runbook.version,
		summary: runbook.summary,
		step_count: runbook.steps.length,
		input_count: runbook.inputs.length,
		requires_auth:
			runbook.auth_context_ref !== undefined ||
			runbook.steps.some(
				(step) => step.kind === "fill" && step.sensitivity === "confidential",
			),
		requires_approval: runbook.steps.some(
			(step) => step.kind === "action" || step.kind === "iterate",
		),
		effect_class: runbookEffectClass(runbook),
		health,
	};
}
