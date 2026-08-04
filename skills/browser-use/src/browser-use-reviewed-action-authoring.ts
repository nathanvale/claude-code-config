import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { BrowserUseRunbookPostcondition } from "./browser-use-runbook-model";
import {
	ACTION_ASSET_MAX_BYTES,
	type BrowserUseActionContainmentPolicy,
	type BrowserUseActionEffectClass,
	type BrowserUseActionValueSchema,
	actionAssetDigest,
	actionValueSchemaIsValid,
	auditActionEffectClass,
	exactOriginValid as exactOrigin,
} from "./browser-use-runbook-actions";
import { canonicalJsonStable as canonical, isJsonObject as isPlainObject } from "./browser-use-core";
import {
	type BrowserUseReviewedActionApprovalFacts,
	type BrowserUseReviewedActionApprovalVerifier,
	type BrowserUseReviewedActionPromotionRouter,
	type BrowserUseReviewedActionPromotionReceipt,
	reviewedActionPromotionReceiptIsValid,
	verifyReviewedActionApproval,
} from "./browser-use-reviewed-action-approval";
import { findRedactionViolations } from "./browser-use-schemas";
import {
	withSourceLock,
	writeSourceFileAtomically,
} from "./browser-use-source-lock";

const CONTRACT = "browser-use.reviewed-action-candidate";
const SCHEMA_VERSION = "1";
const SAFE_ACTION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_DIGEST = /^[0-9a-f]{64}$/;
const SAFE_COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const ACTIONS_RELATIVE_ROOT = "skills/browser-use/actions";
const REGISTRY_FILE = "registry.json";
const LOCK_FILE = ".reviewed-action-authoring.lock";

/** Closed capabilities emitted by the mechanical action audit. */
export type BrowserUseReviewedActionCapability =
	| "dom-query"
	| "dom-read"
	| "dom-write"
	| "dom-events"
	| "framework-runtime"
	| "same-origin-navigation";

/** Complete agent-authored Reviewed Action document. */
export type BrowserUseReviewedActionCandidate = {
	contract: typeof CONTRACT;
	schema_version: typeof SCHEMA_VERSION;
	action_id: string;
	origin: string;
	source: string;
	containment: BrowserUseActionContainmentPolicy;
	input_schema: BrowserUseActionValueSchema;
	result_schema: BrowserUseActionValueSchema;
	result_sensitivity: "low" | "high";
	required_postcondition?: BrowserUseRunbookPostcondition;
};

/** One precise candidate validation issue; source bytes are never echoed. */
export type BrowserUseReviewedActionValidationIssue = { code: string; path: string; message: string };

/** Validated candidate facts derived from model owners and the capability audit. */
export type BrowserUseReviewedActionValidationSuccess = {
	ok: true;
	digest: string;
	effect_class: BrowserUseActionEffectClass;
	audited_capabilities: readonly BrowserUseReviewedActionCapability[];
};

/** Candidate validation result with a bounded repair direction. */
export type BrowserUseReviewedActionValidationResult =
	| BrowserUseReviewedActionValidationSuccess
	| { ok: false; issues: readonly BrowserUseReviewedActionValidationIssue[]; repair: string };

/** Candidate record persisted in the private action registry. */
export type BrowserUseAuthoredReviewedActionRecord = {
	action_id: string;
	asset_id: string;
	expected_digest: string;
	allowed_origin: string;
	effect_class: BrowserUseActionEffectClass;
	audited_capabilities: readonly BrowserUseReviewedActionCapability[];
	containment: BrowserUseActionContainmentPolicy;
	input_schema: BrowserUseActionValueSchema;
	result_schema: BrowserUseActionValueSchema;
	result_sensitivity: "low" | "high";
	required_postcondition?: BrowserUseRunbookPostcondition;
	source_provenance: string;
	promotion_receipt: BrowserUseReviewedActionPromotionReceipt | null;
};

type RegistryEntry = {
	asset_path: string;
	record: BrowserUseAuthoredReviewedActionRecord | Record<string, unknown>;
	promotion_history?: readonly unknown[];
};
type Registry = { actions: RegistryEntry[] };

const CANDIDATE_KEYS = [
	"contract", "schema_version", "action_id", "origin", "source", "containment",
	"input_schema", "result_schema", "result_sensitivity", "required_postcondition",
] as const;

const MINIMAL_EXAMPLE: BrowserUseReviewedActionCandidate = {
	contract: CONTRACT,
	schema_version: SCHEMA_VERSION,
	action_id: "count-rows",
	origin: "https://portal.example.test",
	source: "async ({ inputs }) => ({ rows: document.querySelectorAll('.row').length })",
	containment: "read-only-observation",
	input_schema: { kind: "object", fields: {} },
	result_schema: { kind: "object", fields: { rows: { required: true, schema: { kind: "number", integer: true } } } },
	result_sensitivity: "low",
};

/** Project the model-derived action authoring schema and validating example. */
export function reviewedActionAuthoringSchema() {
	return {
		contract_id: "browser-use.reviewed-action-authoring",
		schema_version: "1",
		wrapper_shape: "async ({ inputs }) => <result>",
		fields: {
			action_id: { required: true, pattern: SAFE_ACTION_ID.source },
			origin: { required: true, exact_http_origin: true },
			source: { required: true, max_utf8_bytes: ACTION_ASSET_MAX_BYTES },
			effect_class: { derived: true, owner: "auditActionEffectClass" },
			audited_capabilities: { derived: true, closed: true },
			input_schema: { required: true, owner: "actionValueSchemaIsValid" },
			result_schema: { required: true, owner: "actionValueSchemaIsValid" },
			postcondition: { required_for_effect: "mutation" },
		},
		credentials: "forbidden; generic login owns authentication",
		minimal_example: structuredClone(MINIMAL_EXAMPLE),
	} as const;
}


function postconditionValid(value: unknown): value is BrowserUseRunbookPostcondition {
	if (!isPlainObject(value)) return false;
	if (value.kind === "url-equals" || value.kind === "url-starts-with") return typeof value.url === "string" && value.url.length > 0;
	return value.kind === "element-visible" && typeof value.selector === "string" && value.selector.trim().length > 0 && !value.selector.startsWith("@");
}

/** Parse one complete candidate document with an exact owner shape. */
export function parseReviewedActionCandidate(raw: string):
	| { ok: true; candidate: BrowserUseReviewedActionCandidate }
	| { ok: false; code: string; message: string } {
	let value: unknown;
	try { value = JSON.parse(raw); } catch {
		return { ok: false, code: "action_document_json_invalid", message: "the Reviewed Action candidate is not valid JSON." };
	}
	if (!isPlainObject(value)) return { ok: false, code: "action_document_shape_invalid", message: "the Reviewed Action candidate must be one object." };
	const allowed = new Set<string>(CANDIDATE_KEYS);
	const required = CANDIDATE_KEYS.filter((key) => key !== "required_postcondition");
	if (Object.keys(value).some((key) => !allowed.has(key)) || required.some((key) => !Object.hasOwn(value, key))) {
		return { ok: false, code: "action_document_shape_invalid", message: "the Reviewed Action candidate has an unknown or missing field." };
	}
	return { ok: true, candidate: value as BrowserUseReviewedActionCandidate };
}

function issue(code: string, path: string, message: string): BrowserUseReviewedActionValidationIssue {
	return { code, path, message };
}

function sourceWithoutStringsAndComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n\r]*/g, " ").replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""');
}

function staticNavigationTarget(
	source: string,
	rightHandSide: string,
): string | undefined {
	const literal = rightHandSide.match(/^(['"])(https?:\/\/[^'"]+)\1$/);
	if (literal) return literal[2];
	const identifier = rightHandSide.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
	if (identifier === undefined) return undefined;
	const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return source.match(
		new RegExp(`\\bconst\\s+${escaped}\\s*=\\s*(['"])(https?:\\/\\/[^'"]+)\\1\\s*;`),
	)?.[2];
}

function capabilityIssue(candidate: BrowserUseReviewedActionCandidate): BrowserUseReviewedActionValidationIssue | undefined {
	const { source } = candidate;
	const code = sourceWithoutStringsAndComments(source);
	const rules: readonly [string, RegExp, string][] = [
		["action_capability_credential_field", /\b(?:password|passcode|credential|username|user_name|otp|one[-_ ]?time|1password|op\.read|login|sign[-_ ]?in)\b/i, "credential and login behavior belongs to generic login"],
		["action_capability_dynamic_code", /\b(?:eval|Function|constructor|import|require|WebAssembly|Worker|SharedWorker)\b/, "dynamic code construction is outside the Reviewed Action vocabulary"],
		["action_capability_computed_property", /\b(?:document|window|globalThis|self|navigator|location)\s*\[[^\]]+\]|\bReflect\s*\./, "computed browser-authority access is not mechanically containable"],
		["action_capability_cookie_storage", /\b(?:cookie|localStorage|sessionStorage|indexedDB|caches)\b/i, "cookie and browser storage access is prohibited"],
		["action_capability_network", /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection)\b/, "network access is prohibited"],
		["action_capability_navigation", /\b(?:history|window\.open)\b|\bopen\s*\(/, "unbounded navigation is prohibited"],
		["action_capability_form_submission", /\.(?:submit|requestSubmit)\s*\(/i, "form submission is prohibited"],
		["action_capability_alias", /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:document|window(?!\s*\.)|globalThis|self|navigator)\b/, "aliases of browser authority are prohibited"],
		["action_capability_global_escape", /(?<![.$])\b(?:globalThis|self|navigator|parent|top|frames)\s*\./, "global browser authority is outside the Reviewed Action vocabulary"],
	];
	for (const [ruleCode, pattern, message] of rules) {
		if (pattern.test(code)) return issue(ruleCode, "source", message);
	}
	if (/\.dispatchEvent\s*\(\s*new\s+(?:Custom)?Event\s*\(\s*(['"])submit\1/i.test(source)) return issue("action_capability_form_submission", "source", "form submission is prohibited");
	if (/querySelector(?:All)?\s*\(\s*(['"])[^'"]*(?:password|passcode|username|otp)[^'"]*\1\s*\)\s*(?:\?\.|\.)\s*(?:value|textContent|innerText|getAttribute)\b/i.test(source)) return issue("action_capability_credential_field", "source", "credential field values belong to generic login");
	const unsupportedWindow = code
		.replace(/\bwindow\s*\.\s*(?:angular|location)\b/g, "")
		.replace(/\bview\s*:\s*window\b/g, "");
	if (/\bwindow\b/.test(unsupportedWindow)) return issue("action_capability_global_escape", "source", "window access is outside the reviewed framework, location, and event vocabulary");
	for (const match of source.matchAll(/(?:window\s*\.\s*)?location\s*\.\s*href\s*=\s*([^;]+);/g)) {
		const target = staticNavigationTarget(source, match[1]?.trim() ?? "");
		try {
			if (target === undefined || new URL(target).origin !== candidate.origin) return issue("action_capability_navigation", "source", "navigation must resolve statically to the candidate origin");
		} catch {
			return issue("action_capability_navigation", "source", "navigation must resolve statically to the candidate origin");
		}
	}
	for (const match of source.matchAll(/(['"])(https?:\/\/[^'"]+)\1/g)) {
		try {
			if (new URL(match[2] ?? "").origin !== candidate.origin) return issue("action_capability_navigation", "source", "absolute URLs must remain inside the candidate origin");
		} catch {
			return issue("action_capability_navigation", "source", "absolute URLs must be valid and same-origin");
		}
	}
	if (!/\bdocument\s*\.\s*querySelector(?:All)?\s*\(/.test(code)) return issue("action_capability_vocabulary_escape", "source", "source does not use the closed direct DOM query vocabulary");
	const documentMembers = [...code.matchAll(/\bdocument\s*\.\s*([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
	if (documentMembers.some((member) => !["querySelector", "querySelectorAll", "body", "title"].includes(member))) return issue("action_capability_vocabulary_escape", "source", "document access is outside the closed reviewed DOM vocabulary");
	return undefined;
}

function auditedCapabilities(source: string, effect: BrowserUseActionEffectClass): readonly BrowserUseReviewedActionCapability[] {
	const capabilities: BrowserUseReviewedActionCapability[] = ["dom-query", "dom-read"];
	if (effect === "mutation") capabilities.push("dom-write");
	if (/\.(?:dispatchEvent|click)\s*\(/.test(source)) capabilities.push("dom-events");
	if (/\bwindow\s*\.\s*angular\b|\bsaveTimesheet\b|\bObject\s*\.\s*getOwnPropertyDescriptor\b/.test(source)) capabilities.push("framework-runtime");
	if (/(?:window\s*\.\s*)?location\s*\.\s*href\s*=/.test(source)) capabilities.push("same-origin-navigation");
	return capabilities;
}

/** Validate source mechanics before any persistence or approval check. */
export function validateReviewedActionCandidate(candidate: BrowserUseReviewedActionCandidate): BrowserUseReviewedActionValidationResult {
	const issues: BrowserUseReviewedActionValidationIssue[] = [];
	if (!isPlainObject(candidate)) issues.push(issue("action_document_shape_invalid", "$", "candidate must be one object"));
	else {
		if (candidate.contract !== CONTRACT || candidate.schema_version !== SCHEMA_VERSION) issues.push(issue("action_contract_invalid", "contract", "candidate contract identity is invalid"));
		if (typeof candidate.action_id !== "string" || !SAFE_ACTION_ID.test(candidate.action_id)) issues.push(issue("action_id_invalid", "action_id", "action id must be a safe slug"));
		if (typeof candidate.origin !== "string" || !exactOrigin(candidate.origin)) issues.push(issue("action_origin_invalid", "origin", "origin must be one exact HTTP(S) origin"));
		if (typeof candidate.source !== "string" || candidate.source.trim().length === 0 || Buffer.byteLength(candidate.source, "utf8") > ACTION_ASSET_MAX_BYTES) issues.push(issue("action_source_invalid", "source", "source must be non-empty and within the action byte ceiling"));
		else if (!/^\s*async\s*\(\s*\{\s*inputs\s*\}\s*\)\s*=>/.test(candidate.source)) issues.push(issue("action_wrapper_invalid", "source", "source must use the async ({ inputs }) wrapper"));
		else { const prohibited = capabilityIssue(candidate); if (prohibited !== undefined) issues.push(prohibited); }
		if (candidate.containment !== "none" && candidate.containment !== "read-only-observation") issues.push(issue("action_containment_invalid", "containment", "containment is not enforceable"));
		if (!actionValueSchemaIsValid(candidate.input_schema)) issues.push(issue("action_input_schema_invalid", "input_schema", "input schema is not in the model-owned vocabulary"));
		if (!actionValueSchemaIsValid(candidate.result_schema)) issues.push(issue("action_result_schema_invalid", "result_schema", "result schema is not in the model-owned vocabulary"));
		if (candidate.result_sensitivity !== "low" && candidate.result_sensitivity !== "high") issues.push(issue("action_result_sensitivity_invalid", "result_sensitivity", "result sensitivity is invalid"));
		if (candidate.required_postcondition !== undefined && !postconditionValid(candidate.required_postcondition)) issues.push(issue("action_postcondition_invalid", "required_postcondition", "postcondition is not mechanically checkable"));
		const { source: _reviewedSourceBytes, ...persistedMetadata } = candidate;
		if (findRedactionViolations(persistedMetadata).length > 0) issues.push(issue("action_secret_shaped_material", "$", "candidate metadata carries secret-shaped material and cannot be persisted"));
	}
	if (issues.length > 0) return { ok: false, issues, repair: "Fix the named mechanical issue. Keep authentication in generic login and use only direct reviewed business-action DOM operations." };
	const effect = auditActionEffectClass(candidate.source);
	if (effect === "mutation" && !postconditionValid(candidate.required_postcondition)) return { ok: false, issues: [issue("action_postcondition_required", "required_postcondition", "a mutation requires one mechanically checkable postcondition")], repair: "Add an element-visible, url-equals, or url-starts-with postcondition for the mutation." };
	if (effect === "mutation" && candidate.containment === "read-only-observation") return { ok: false, issues: [issue("action_containment_effect_mismatch", "containment", "read-only containment cannot authorize a mutation")], repair: "Declare containment none and provide a mutation postcondition, or remove the mutation." };
	return { ok: true, digest: actionAssetDigest(candidate.source), effect_class: effect, audited_capabilities: auditedCapabilities(candidate.source, effect) };
}


function recordDigest(record: unknown): string { return createHash("sha256").update(JSON.stringify(record)).digest("hex"); }

function parseRegistry(raw: string): Registry | undefined {
	let value: unknown;
	try { value = JSON.parse(raw); } catch { return undefined; }
	if (!isPlainObject(value) || !Array.isArray(value.actions)) return undefined;
	for (const entry of value.actions) if (!isPlainObject(entry) || typeof entry.asset_path !== "string" || !isPlainObject(entry.record) || (entry.promotion_history !== undefined && !Array.isArray(entry.promotion_history))) return undefined;
	return value as Registry;
}

function candidateRecord(candidate: BrowserUseReviewedActionCandidate, validated: BrowserUseReviewedActionValidationSuccess): BrowserUseAuthoredReviewedActionRecord {
	return {
		action_id: candidate.action_id, asset_id: validated.digest, expected_digest: validated.digest,
		allowed_origin: candidate.origin, effect_class: validated.effect_class, audited_capabilities: validated.audited_capabilities,
		containment: candidate.containment, input_schema: candidate.input_schema, result_schema: candidate.result_schema,
		result_sensitivity: candidate.result_sensitivity,
		...(candidate.required_postcondition !== undefined ? { required_postcondition: candidate.required_postcondition } : {}),
		source_provenance: `authored:${candidate.action_id}`, promotion_receipt: null,
	};
}

/** Hash one schema or postcondition through the authoring model owner. */
export function reviewedActionStructuredDigest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }

/** Re-derive exact approval facts from current source bytes and registry data. */
export function reviewedActionApprovalFactsFromRecord(input: { commit: string; record: BrowserUseAuthoredReviewedActionRecord; assetBytes: string }):
	| { ok: true; facts: BrowserUseReviewedActionApprovalFacts }
	| { ok: false; code: string } {
	const candidate: BrowserUseReviewedActionCandidate = {
		contract: CONTRACT, schema_version: SCHEMA_VERSION, action_id: input.record.action_id,
		origin: input.record.allowed_origin, source: input.assetBytes, containment: input.record.containment,
		input_schema: input.record.input_schema, result_schema: input.record.result_schema,
		result_sensitivity: input.record.result_sensitivity,
		...(input.record.required_postcondition !== undefined ? { required_postcondition: input.record.required_postcondition } : {}),
	};
	const validation = validateReviewedActionCandidate(candidate);
	if (!validation.ok) return { ok: false, code: validation.issues[0]?.code ?? "action_candidate_invalid" };
	if (validation.digest !== input.record.expected_digest || validation.digest !== input.record.asset_id) return { ok: false, code: "action_digest_mismatch" };
	if (validation.effect_class !== input.record.effect_class || canonical(validation.audited_capabilities) !== canonical(input.record.audited_capabilities)) return { ok: false, code: "action_audit_mismatch" };
	return { ok: true, facts: {
		source_commit: input.commit, action_id: input.record.action_id, approved_digest: validation.digest,
		approved_origin: input.record.allowed_origin, approved_effect: validation.effect_class,
		audited_capabilities: validation.audited_capabilities, containment: input.record.containment,
		input_schema_digest: reviewedActionStructuredDigest(input.record.input_schema),
		result_schema_digest: reviewedActionStructuredDigest(input.record.result_schema),
		postcondition_digest: input.record.required_postcondition === undefined ? null : reviewedActionStructuredDigest(input.record.required_postcondition),
	} };
}

/** Verify current source authority without exposing broker signing capability. */
export function verifyAuthoredReviewedActionPromotion(input: { commit: string; record: BrowserUseAuthoredReviewedActionRecord; assetBytes: string; promotionHistory?: readonly unknown[]; verifier: BrowserUseReviewedActionApprovalVerifier }):
	| { ok: true; receipt_id: string; approval_reference: string }
	| { ok: false; code: string } {
	const receiptCommit = reviewedActionPromotionReceiptIsValid(
		input.record.promotion_receipt,
	)
		? input.record.promotion_receipt.source_commit
		: input.commit;
	const derived = reviewedActionApprovalFactsFromRecord({
		...input,
		commit: receiptCommit,
	});
	if (!derived.ok) return derived;
	// History is audit evidence, never current activation authority.
	return verifyReviewedActionApproval({
		facts: derived.facts,
		receipts:
			input.record.promotion_receipt === null
				? []
				: [input.record.promotion_receipt],
		verifier: input.verifier,
	});
}

async function admittedActionsRoot(sourceRoot: string): Promise<string | undefined> {
	if (!isAbsolute(sourceRoot)) return undefined;
	try {
		const canonicalSource = await realpath(sourceRoot);
		const actionsRoot = join(canonicalSource, ...ACTIONS_RELATIVE_ROOT.split("/"));
		const stat = await lstat(actionsRoot);
		if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
		const canonicalActions = await realpath(actionsRoot);
		return relative(canonicalSource, canonicalActions) === ACTIONS_RELATIVE_ROOT ? canonicalActions : undefined;
	} catch { return undefined; }
}

async function persistAsset(actionsRoot: string, digest: string, source: string): Promise<boolean> {
	if (!SAFE_DIGEST.test(digest)) return false;
	const assetRoot = join(actionsRoot, "assets");
	await mkdir(assetRoot, { recursive: true, mode: 0o700 });
	const assetRootStat = await lstat(assetRoot);
	if (!assetRootStat.isDirectory() || assetRootStat.isSymbolicLink()) return false;
	if (relative(actionsRoot, await realpath(assetRoot)) !== "assets") return false;
	const path = join(assetRoot, `${digest}.js`);
	try {
		const handle = await open(path, "wx", 0o600);
		try { await handle.writeFile(source, "utf8"); await handle.sync(); } finally { await handle.close(); }
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		return (await readFile(path, "utf8")) === source;
	}
}

/** Candidate apply success or typed source/concurrency refusal. */
export type BrowserUseReviewedActionApplyResult =
	| { ok: true; changed: boolean; digest: string; record_digest: string; effect_class: BrowserUseActionEffectClass; promotion_state: "unpromoted" | "promotion-claim-present" }
	| { ok: false; code: string; message: string };

/** Read current candidate and receipt-claim state. */
export async function readReviewedActionSourceState(input: { sourceRoot: string; actionId: string }): Promise<
	| { ok: true; state: "absent" | "unpromoted" | "promotion-claim-present"; digest: string | null; record_digest: string | null; receipt_id: string | null }
	| { ok: false; code: string; message: string }
> {
	const actionsRoot = await admittedActionsRoot(input.sourceRoot);
	if (actionsRoot === undefined) return { ok: false, code: "action_source_checkout_required", message: "promotion-state reads require the setup-owned source checkout." };
	if (!SAFE_ACTION_ID.test(input.actionId)) return { ok: false, code: "action_id_invalid", message: "action id must be a safe slug." };
	const registry = parseRegistry(await readFile(join(actionsRoot, REGISTRY_FILE), "utf8"));
	if (registry === undefined) return { ok: false, code: "action_registry_invalid", message: "the private Reviewed Action registry is invalid." };
	const matching = registry.actions.filter((entry) => entry.record.action_id === input.actionId);
	if (matching.length === 0) return { ok: true, state: "absent", digest: null, record_digest: null, receipt_id: null };
	if (matching.length !== 1) return { ok: false, code: "action_registry_duplicate", message: "the private Reviewed Action registry has a duplicate action id." };
	const record = matching[0].record;
	const receipt = record.promotion_receipt;
	return { ok: true, state: receipt === null ? "unpromoted" : "promotion-claim-present", digest: typeof record.expected_digest === "string" ? record.expected_digest : null, record_digest: recordDigest(record), receipt_id: isPlainObject(receipt) && typeof receipt.receipt_id === "string" ? receipt.receipt_id : null };
}

/** Apply one validated candidate under the setup-owned source checkout. */
export async function applyReviewedActionCandidate(input: { sourceRoot: string; candidate: BrowserUseReviewedActionCandidate; expectedRecordDigest?: string }): Promise<BrowserUseReviewedActionApplyResult> {
	const actionsRoot = await admittedActionsRoot(input.sourceRoot);
	if (actionsRoot === undefined) return { ok: false, code: "action_source_checkout_required", message: "candidate apply requires the setup-owned source checkout." };
	const validated = validateReviewedActionCandidate(input.candidate);
	if (!validated.ok) return { ok: false, code: validated.issues[0]?.code ?? "action_candidate_invalid", message: validated.repair };
	try {
		const locked = await withSourceLock({ lockPath: join(actionsRoot, LOCK_FILE), subject: "Reviewed Action" }, async (): Promise<BrowserUseReviewedActionApplyResult> => {
			const registryPath = join(actionsRoot, REGISTRY_FILE);
			const registryStat = await lstat(registryPath).catch(() => undefined);
			if (registryStat === undefined || !registryStat.isFile() || registryStat.isSymbolicLink()) return { ok: false, code: "action_registry_unsafe", message: "the private Reviewed Action registry is missing or unsafe." };
			const registry = parseRegistry(await readFile(registryPath, "utf8"));
			if (registry === undefined) return { ok: false, code: "action_registry_invalid", message: "the private Reviewed Action registry is invalid." };
			const matches = registry.actions.filter((entry) => entry.record.action_id === input.candidate.action_id);
			if (matches.length > 1) return { ok: false, code: "action_registry_duplicate", message: "the private Reviewed Action registry has a duplicate action id." };
			const existing = matches[0];
			const nextRecord = candidateRecord(input.candidate, validated);
			// Compare the complete authored document while leaving signed history outside agent authority.
			const existingCandidateRecord = existing === undefined ? undefined : { ...existing.record, promotion_receipt: null };
			if (existing !== undefined && canonical(existingCandidateRecord) === canonical(nextRecord)) return { ok: true, changed: false, digest: validated.digest, record_digest: recordDigest(existing.record), effect_class: validated.effect_class, promotion_state: existing.record.promotion_receipt === null ? "unpromoted" : "promotion-claim-present" };
			if (existing !== undefined) {
				const observed = recordDigest(existing.record);
				if (input.expectedRecordDigest === undefined) return { ok: false, code: "action_replacement_digest_required", message: "replacement requires the currently observed action record digest." };
				if (input.expectedRecordDigest !== observed) return { ok: false, code: "action_replacement_digest_stale", message: "the action record changed after observation; refresh before replacing it." };
			}
			if (!(await persistAsset(actionsRoot, validated.digest, input.candidate.source))) return { ok: false, code: "action_asset_collision", message: "the content-addressed action asset path contains different bytes." };
			const entry: RegistryEntry = { asset_path: `assets/${validated.digest}.js`, record: nextRecord, ...(existing?.promotion_history !== undefined ? { promotion_history: [...existing.promotion_history] } : {}) };
			const currentReceipt = existing?.record.promotion_receipt;
			if (currentReceipt !== undefined && currentReceipt !== null) entry.promotion_history = [...(entry.promotion_history ?? []), currentReceipt];
			if (existing === undefined) registry.actions.push(entry); else registry.actions[registry.actions.indexOf(existing)] = entry;
			registry.actions.sort((left, right) => String(left.record.action_id).localeCompare(String(right.record.action_id)));
			await writeSourceFileAtomically({ path: registryPath, bytes: `${JSON.stringify(registry, null, 2)}\n` });
			return { ok: true, changed: true, digest: validated.digest, record_digest: recordDigest(nextRecord), effect_class: validated.effect_class, promotion_state: "unpromoted" };
		});
		if (!locked.acquired) return { ok: false, code: "action_source_lock_contended", message: locked.message };
		if (!locked.released) return { ok: false, code: "action_source_lock_release_failed", message: locked.release_failure.message };
		return locked.value;
	} catch {
		return { ok: false, code: "action_source_write_failed", message: "the private Reviewed Action source mutation failed." };
	}
}

type PromotionGitResult = { exitCode: number; stdout: string; stderr: string };

async function runPromotionGit(
	repoRoot: string,
	args: readonly string[],
): Promise<PromotionGitResult> {
	const child = Bun.spawn(["git", ...args], {
		cwd: repoRoot,
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

async function admitPromotionOnlyRegistryDrift(input: {
	sourceRoot: string;
	actionsRoot: string;
	commit: string;
	targetActionId: string;
	committed: Registry;
	verifier: BrowserUseReviewedActionApprovalVerifier;
}): Promise<
	| { ok: true; registry: Registry; bytes: string }
	| { ok: false; code: string; message: string }
> {
	const path = join(input.actionsRoot, REGISTRY_FILE);
	const bytes = await readFile(path, "utf8").catch(() => undefined);
	const current = bytes === undefined ? undefined : parseRegistry(bytes);
	if (
		current === undefined ||
		bytes !== `${JSON.stringify(current, null, 2)}\n` ||
		current.actions.length !== input.committed.actions.length
	) {
		return { ok: false, code: "action_promotion_source_drift", message: "the candidate registry differs from the reviewed commit." };
	}
	for (const committedEntry of input.committed.actions) {
		const actionId = committedEntry.record.action_id;
		const matches = current.actions.filter((entry) => entry.record.action_id === actionId);
		if (typeof actionId !== "string" || matches.length !== 1) {
			return { ok: false, code: "action_promotion_source_drift", message: "the candidate registry changed action identity after review." };
		}
		const currentEntry = matches[0] as RegistryEntry;
		if (
			currentEntry.asset_path !== committedEntry.asset_path ||
			canonical(currentEntry.promotion_history ?? []) !== canonical(committedEntry.promotion_history ?? [])
		) {
			return { ok: false, code: "action_promotion_source_drift", message: "the candidate registry changed outside signed promotion authority." };
		}
		if (actionId === input.targetActionId || committedEntry.record.promotion_receipt !== null) {
			if (canonical(currentEntry.record) !== canonical(committedEntry.record)) {
				return { ok: false, code: "action_promotion_source_drift", message: "the target candidate differs from the reviewed commit." };
			}
			continue;
		}
		const currentRecord = currentEntry.record as BrowserUseAuthoredReviewedActionRecord;
		const currentReceipt = currentRecord.promotion_receipt;
		if (canonical({ ...currentRecord, promotion_receipt: null }) !== canonical(committedEntry.record)) {
			return { ok: false, code: "action_promotion_source_drift", message: "the candidate metadata changed outside signed promotion authority." };
		}
		if (currentReceipt === null) continue;
		if (
			!reviewedActionPromotionReceiptIsValid(currentReceipt) ||
			currentReceipt.source_commit !== input.commit ||
			!/^assets\/[0-9a-f]{64}\.js$/.test(currentEntry.asset_path)
		) {
			return { ok: false, code: "action_promotion_source_drift", message: "the intervening promotion receipt is not bound to the reviewed commit." };
		}
		const relativeAsset = `${ACTIONS_RELATIVE_ROOT}/${currentEntry.asset_path}`;
		const committedAsset = await runPromotionGit(input.sourceRoot, ["show", `${input.commit}:${relativeAsset}`]);
		const currentAsset = await readFile(join(input.actionsRoot, currentEntry.asset_path), "utf8").catch(() => undefined);
		if (committedAsset.exitCode !== 0 || currentAsset !== committedAsset.stdout) {
			return { ok: false, code: "action_promotion_source_drift", message: "an intervening promoted asset differs from the reviewed commit." };
		}
		const derived = reviewedActionApprovalFactsFromRecord({
			commit: input.commit,
			record: currentRecord,
			assetBytes: currentAsset,
		});
		if (
			!derived.ok ||
			!verifyReviewedActionApproval({ facts: derived.facts, receipts: [currentReceipt], verifier: input.verifier }).ok
		) {
			return { ok: false, code: "action_promotion_source_drift", message: "an intervening promotion receipt failed offline verification." };
		}
	}
	return { ok: true, registry: current, bytes };
}

/** Operator promotion result after exact committed-source verification. */
type BrowserUseReviewedActionPromotionResult =
	| {
			ok: true;
			source_commit: string;
			receipt_id: string;
			approved_digest: string;
	  }
	| { ok: false; code: string; message: string };
/**
 * Review and promote one committed candidate through the external-human broker.
 *
 * The operator CLI delegates here. This owner reads exact bytes from one Git
 * commit, refuses working-tree drift, and persists only a receipt that passes
 * the offline verifier.
 */
export async function promoteReviewedActionCandidate(input: {
	sourceRoot: string;
	actionId: string;
	approvalReference: string;
	router: BrowserUseReviewedActionPromotionRouter;
	verifier: BrowserUseReviewedActionApprovalVerifier;
}): Promise<BrowserUseReviewedActionPromotionResult> {
	const actionsRoot = await admittedActionsRoot(input.sourceRoot);
	if (actionsRoot === undefined) {
		return {
			ok: false,
			code: "action_source_checkout_required",
			message: "promotion requires the setup-owned source checkout.",
		};
	}
	if (!SAFE_ACTION_ID.test(input.actionId)) {
		return {
			ok: false,
			code: "action_id_invalid",
			message: "action id must be a safe slug.",
		};
	}
	try {
		const locked = await withSourceLock({ lockPath: join(actionsRoot, LOCK_FILE), subject: "Reviewed Action" }, async (): Promise<BrowserUseReviewedActionPromotionResult> => {
		const top = await runPromotionGit(input.sourceRoot, [
			"rev-parse",
			"--show-toplevel",
		]);
		const commitResult = await runPromotionGit(input.sourceRoot, [
			"rev-parse",
			"--verify",
			"HEAD^{commit}",
		]);
		const sourceRoot = await realpath(input.sourceRoot);
		const commit = commitResult.stdout.trim();
		if (
			top.exitCode !== 0 ||
			commitResult.exitCode !== 0 ||
			(await realpath(top.stdout.trim()).catch(() => "")) !== sourceRoot ||
			!SAFE_COMMIT.test(commit)
		) {
			const gitDiagnostic = [top.stderr, commitResult.stderr].map((text) => text.trim()).filter(Boolean).join("; ");
			return {
				ok: false,
				code: "action_promotion_commit_unavailable",
				message: gitDiagnostic
					? `promotion could not resolve one owning source commit: ${gitDiagnostic}`
					: "promotion could not resolve one owning source commit.",
			};
		}
		const registryRelative = `${ACTIONS_RELATIVE_ROOT}/${REGISTRY_FILE}`;
		const committedRegistry = await runPromotionGit(input.sourceRoot, [
			"show",
			`${commit}:${registryRelative}`,
		]);
		if (committedRegistry.exitCode !== 0) {
			return {
				ok: false,
				code: "action_registry_invalid",
				message: "the committed Reviewed Action registry is unavailable.",
			};
		}
		const registry = parseRegistry(committedRegistry.stdout);
		const matches = registry?.actions.filter(
			(entry) => entry.record.action_id === input.actionId,
		);
		if (registry === undefined || matches?.length !== 1) {
			return {
				ok: false,
				code: "action_promotion_candidate_unavailable",
				message: "the committed registry does not contain one candidate with that id.",
			};
		}
		const entry = matches[0] as RegistryEntry;
		if (entry.record.promotion_receipt !== null) {
			return {
				ok: false,
				code: "action_already_promoted",
				message: "the committed candidate already carries promotion authority.",
			};
		}
		if (
			typeof entry.record.expected_digest !== "string" ||
			entry.asset_path !== `assets/${entry.record.expected_digest}.js`
		) {
			return {
				ok: false,
				code: "action_registry_invalid",
				message: "the committed action asset path does not match its content address.",
			};
		}
		const assetRelative = `${ACTIONS_RELATIVE_ROOT}/${entry.asset_path}`;
		const committedAsset = await runPromotionGit(input.sourceRoot, [
			"show",
			`${commit}:${assetRelative}`,
		]);
		if (committedAsset.exitCode !== 0) {
			return {
				ok: false,
				code: "action_asset_unavailable",
				message: "the committed Reviewed Action bytes are unavailable.",
			};
		}
		const derived = reviewedActionApprovalFactsFromRecord({
			commit,
			record: entry.record as BrowserUseAuthoredReviewedActionRecord,
			assetBytes: committedAsset.stdout,
		});
		if (!derived.ok) {
			return {
				ok: false,
				code: derived.code,
				message: "the committed candidate failed its mechanical audit.",
			};
		}
		const currentRegistry = await admitPromotionOnlyRegistryDrift({
			sourceRoot: input.sourceRoot,
			actionsRoot,
			commit,
			targetActionId: input.actionId,
			committed: registry,
			verifier: input.verifier,
		});
		if (!currentRegistry.ok) return currentRegistry;
		const status = await runPromotionGit(input.sourceRoot, [
			"status",
			"--porcelain=v1",
			"--",
			assetRelative,
		]);
		if (status.exitCode !== 0 || status.stdout.trim() !== "") {
			return {
				ok: false,
				code: "action_promotion_source_drift",
				message: "the candidate registry or exact asset bytes differ from the reviewed commit.",
			};
		}
		const issued = await input.router.requestPromotion({
			facts: derived.facts,
			candidate_bytes: committedAsset.stdout,
			approval_reference: input.approvalReference,
		});
		if (!issued.ok) return issued;
		const verified = verifyReviewedActionApproval({
			facts: derived.facts,
			receipts: [issued.receipt],
			verifier: input.verifier,
		});
		if (!verified.ok) {
			return {
				ok: false,
				code: verified.code,
				message: "the issued promotion receipt failed offline verification.",
			};
		}
		const registryPath = join(actionsRoot, REGISTRY_FILE);
		const assetPath = join(actionsRoot, entry.asset_path);
		if (
			(await readFile(registryPath, "utf8")) !== currentRegistry.bytes ||
			(await readFile(assetPath, "utf8")) !== committedAsset.stdout
		) {
			return {
				ok: false,
				code: "action_promotion_source_drift",
				message: "the candidate changed during human review; no receipt was persisted.",
			};
		}
		const currentEntry = currentRegistry.registry.actions.find(
			(candidate) => candidate.record.action_id === input.actionId,
		) as RegistryEntry;
		currentEntry.record = {
			...(currentEntry.record as BrowserUseAuthoredReviewedActionRecord),
			promotion_receipt: issued.receipt,
		};
		await writeSourceFileAtomically({
			path: registryPath,
			bytes: `${JSON.stringify(currentRegistry.registry, null, 2)}\n`,
		});
		return {
			ok: true,
			source_commit: commit,
			receipt_id: verified.receipt_id,
			approved_digest: derived.facts.approved_digest,
		};
		});
		if (!locked.acquired) return { ok: false, code: "action_source_lock_contended", message: locked.message };
		if (!locked.released) return { ok: false, code: "action_source_lock_release_failed", message: locked.release_failure.message };
		return locked.value;
	} catch {
		return {
			ok: false,
			code: "action_promotion_failed",
			message: "the Reviewed Action promotion transaction failed closed.",
		};
	}
}
