// ---------------------------------------------------------------------------
// Browser Runbook model (platform plan 2026-07-21-002 U4, R30/R31; release
// contract R7/R23-adjacent).
//
// The ONE declarative Browser Runbook schema: a resumable multi-step
// definition for the agent-browser (routine automation) lane, discovered and
// validated from the code-owned XDG data location. Each step is bounded and
// maps to exactly one bounded native Agent Browser action; confidential fields
// name an Item Binding and NEVER carry secret values (R30 "must not contain
// secret values"). Continuation semantics bind to the shared run store, so a
// resumed run replays only from its first unproven step — F7 restart-safe
// resume, no duplicate mutation.
//
// Pure model + guards only. Discovery I/O, the fs port, and per-step execution
// binding live in browser-use-runbook.ts; the shared run reducer/store lives in
// browser-use-run-model.ts / browser-use-runs.ts. No Date.now, no
// Math.random, no fs. This module never parses a secret and never reaches a
// browser.
// ---------------------------------------------------------------------------

import type {
	AgentBrowserPostcondition,
	AgentBrowserTaskStep,
} from "./browser-use-agent-browser";

// --- Runbook health (R31) ----------------------------------------------------

/**
 * Runbook health projection (R31): the discovery-facing status a
 * `runbook list` row carries. `healthy` — validated and executable;
 * `degrading` — validated but its last outcome recorded drift or heal;
 * `stale` — validation flagged staleness (schema drift or a selector the
 * runtime could not reconcile) and it needs recapture before execution.
 */
export const BROWSER_USE_RUNBOOK_HEALTH = [
	"healthy",
	"degrading",
	"stale",
] as const;

/** Runbook health union. */
export type BrowserUseRunbookHealth =
	(typeof BROWSER_USE_RUNBOOK_HEALTH)[number];

// --- Typed step definitions (R30) --------------------------------------------

/**
 * One declarative structural postcondition. Mirrors the agent-browser
 * executor's postcondition vocabulary verbatim (KTD: the runbook declares
 * postconditions in the executor's own shape so the compiler proves alignment
 * and no translation layer can drift).
 */
export type BrowserUseRunbookPostcondition = AgentBrowserPostcondition;

/**
 * One bounded declarative runbook step (R30 "typed inputs, action policy,
 * selectors, postconditions"). Each variant compiles to exactly one bounded
 * {@link AgentBrowserTaskStep}. A `fill` step's `sensitivity` decides custody:
 * an `ordinary` value is inlined; a `confidential` value NEVER appears here —
 * it names an `item_binding` the auth transaction resolves, so a runbook file
 * carries no secret (R30).
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
	| { kind: "click"; ref: string; postcondition: BrowserUseRunbookPostcondition }
	| {
			kind: "fill";
			ref: string;
			sensitivity: "ordinary";
			/** Literal value token; may reference a typed input as `{{input_id}}`. */
			value: string;
			postcondition: BrowserUseRunbookPostcondition;
	  }
	| {
			kind: "fill";
			ref: string;
			sensitivity: "confidential";
			/** Item Binding id the auth transaction resolves; NEVER a secret value. */
			item_binding: string;
			postcondition: BrowserUseRunbookPostcondition;
	  };

/**
 * One typed input the runbook declares (R30 "typed inputs"). `required` inputs
 * must be supplied at execution; `pattern` (a bounded regex source) constrains
 * the value. Inputs are substituted into `{{id}}` tokens in ordinary fill
 * values only — never into a confidential field.
 */
export type BrowserUseRunbookInput = {
	id: string;
	summary: string;
	required: boolean;
	/** Optional value constraint, compiled with an anchored match (R30). */
	pattern?: string;
};

// --- The declarative runbook (R30) -------------------------------------------

/**
 * A declarative Browser Runbook (R30). One active path for a known flow, bound
 * to the agent-browser lane, discovered from
 * `$XDG_DATA_HOME/browser-use/runbooks/<service_id>/<flow_id>/`. It declares
 * allowed origins, typed inputs, ordered bounded steps, and an optional auth
 * context reference; it NEVER carries secret values (R30). `version` supports
 * R31 rollback (prior versions may be retained; exactly one is active).
 */
export type BrowserUseRunbook = {
	contract: "browser-use.runbook";
	schema_version: "1";
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

// --- Validation (R30) --------------------------------------------------------

/** Typed runbook validation issue codes. */
export type BrowserUseRunbookIssueCode =
	| "runbook_contract_invalid"
	| "runbook_schema_unsupported"
	| "runbook_id_invalid"
	| "runbook_origin_invalid"
	| "runbook_no_steps"
	| "runbook_input_invalid"
	| "runbook_step_invalid"
	| "runbook_confidential_secret_present"
	| "runbook_input_reference_unknown"
	| "runbook_ref_invalid";

/** One typed validation issue. */
export type BrowserUseRunbookIssue = {
	code: BrowserUseRunbookIssueCode;
	message: string;
};

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_INPUT_ID = /^[a-z0-9][a-z0-9_]{0,63}$/;
const SAFE_REF = /^@e[1-9][0-9]*$/;
const INPUT_TOKEN = /\{\{([a-z0-9_]+)\}\}/g;
// A secret-shaped value an author might paste into a confidential field. The
// confidential variant has no `value` field at the type level, so this is a
// runtime backstop against a hand-authored file that smuggles one in.
const OP_SECRET_REF = /op:\/\//i;

function exactOriginValid(value: string): boolean {
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

function originAllowed(
	value: string,
	allowed: ReadonlySet<string>,
): boolean {
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

/**
 * Validate one Browser Runbook against R30 (well-formed contract, safe ids,
 * exact origins, bounded typed inputs, ordered bounded steps, no secret in a
 * confidential field, every `{{input}}` reference declared, and every ref an
 * `@e<n>` shape). Pure and total: a malformed runbook yields typed issues,
 * never a throw. An empty array means the runbook satisfies every invariant.
 *
 * @param runbook - Parsed runbook definition (untrusted shape allowed)
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
	if (runbook.schema_version !== "1") {
		issues.push({
			code: "runbook_schema_unsupported",
			message: `runbook schema version ${String(runbook.schema_version)} is not supported (expected 1).`,
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
		if (!exactOriginValid(origin)) {
			issues.push({
				code: "runbook_origin_invalid",
				message: "allowed_origins must be exact HTTP(S) origins.",
			});
		} else {
			allowed.add(origin);
		}
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
		if (input.pattern !== undefined) {
			try {
				new RegExp(input.pattern);
			} catch {
				issues.push({
					code: "runbook_input_invalid",
					message: `input ${input.id} carries an invalid pattern.`,
				});
			}
		}
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
	// click / fill are ref mutations.
	if (!SAFE_REF.test(step.ref)) {
		issues.push({
			code: "runbook_ref_invalid",
			message: `${at}: ref must be an @e<n> snapshot reference.`,
		});
	}
	if (!validatePostcondition(step.postcondition)) {
		issues.push({
			code: "runbook_step_invalid",
			message: `${at}: mutation requires a valid postcondition.`,
		});
	}
	if (step.kind === "click") return;
	// fill: custody split.
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

// --- Execution planning (R30/R31, F7 continuation) ---------------------------

/**
 * Typed input binding supplied at execution: one value per declared input id.
 */
export type BrowserUseRunbookInputs = Readonly<Record<string, string>>;

/** Typed execution-planning refusal. */
export type BrowserUseRunbookPlanRefusal = {
	code:
		| "runbook_invalid"
		| "runbook_input_missing"
		| "runbook_input_rejected"
		| "runbook_resume_out_of_range";
	message: string;
};

/**
 * A planned execution: the compiled bounded Agent Browser steps (from
 * `resume_from_step` onward) plus the resolved allowed origins, ready to hand
 * to the agent-browser executor. `resume_from_step` realises F7: a resumed run
 * replays only from its first unproven step, so an already-confirmed mutation
 * is never re-dispatched.
 */
export type BrowserUseRunbookPlan = {
	service_id: string;
	flow_id: string;
	version: string;
	allowed_origins: readonly string[];
	auth_context_ref?: string;
	resume_from_step: number;
	total_steps: number;
	steps: readonly AgentBrowserTaskStep[];
	/** Item Binding ids the auth transaction must resolve before dispatch. */
	pending_item_bindings: readonly string[];
};

export type BrowserUseRunbookPlanResult =
	| { ok: true; plan: BrowserUseRunbookPlan }
	| { ok: false; refusal: BrowserUseRunbookPlanRefusal };

function substituteInputs(
	value: string,
	inputs: BrowserUseRunbookInputs,
): string {
	return value.replace(INPUT_TOKEN, (_whole, id: string) => inputs[id] ?? "");
}

/**
 * Compile one confidential runbook step into the executor's confidential fill.
 * The compiled step keeps `sensitivity: "confidential"` with an empty value:
 * the executor refuses every confidential fill to the auth transaction (R30),
 * so the engine surfaces the item binding as `pending_item_bindings` rather
 * than resolving a secret here.
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
		return { kind: "click", ref: step.ref, postcondition: step.postcondition };
	}
	if (step.sensitivity === "confidential") {
		return {
			kind: "fill",
			ref: step.ref,
			value: "",
			sensitivity: "confidential",
			postcondition: step.postcondition,
		};
	}
	return {
		kind: "fill",
		ref: step.ref,
		value: substituteInputs(step.value, inputs),
		sensitivity: "ordinary",
		postcondition: step.postcondition,
	};
}

/**
 * Plan a runbook execution (R30/R31, F7 continuation): validate the runbook,
 * enforce typed inputs, then compile the steps from `resumeFromStep` onward
 * into bounded Agent Browser steps for the executor. Pure and total.
 *
 * F7 restart-safe resume: `resumeFromStep` is the first unproven step index a
 * resumed run carries (0 for a fresh run). Only steps at or beyond it are
 * compiled, so an already-confirmed mutation is never re-dispatched.
 *
 * @param runbook - The runbook definition
 * @param input - Typed inputs plus the resume-from step index
 * @returns The planned bounded steps, or one typed refusal
 */
export function planRunbookExecution(
	runbook: BrowserUseRunbook,
	input: { inputs: BrowserUseRunbookInputs; resumeFromStep: number },
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
	for (const declared of runbook.inputs) {
		const value = input.inputs[declared.id];
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
		if (declared.pattern !== undefined) {
			const anchored = new RegExp(`^(?:${declared.pattern})$`);
			if (!anchored.test(value)) {
				return {
					ok: false,
					refusal: {
						code: "runbook_input_rejected",
						message: `input ${declared.id} does not satisfy its declared pattern.`,
					},
				};
			}
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
	const compiled = remaining.map((step) => compileStep(step, input.inputs));
	const pendingBindings = remaining
		.filter(
			(step): step is Extract<
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
			pending_item_bindings: [...new Set(pendingBindings)],
		},
	};
}

// --- Catalog projection (R35) ------------------------------------------------

/**
 * One redacted `runbook list` row (R35): service/flow identity, health, and
 * step count. No selector, origin, or input value leaks into a catalog row.
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
	health: BrowserUseRunbookHealth;
};

/**
 * Project one validated runbook into a redacted catalog row. A runbook with
 * validation issues is reported `stale` (it needs recapture before execution);
 * a confidential-field runbook is reported `degrading` only when the caller
 * flags an observed drift, otherwise `healthy`.
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
		health,
	};
}
