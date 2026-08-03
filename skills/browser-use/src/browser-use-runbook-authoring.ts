import type { Dirent } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	rmdir,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { isJsonObject as isObject, redactUnsafeText } from "./browser-use-core";
import {
	type BrowserUseRunbook,
	type BrowserUseRunbookIssue,
	inspectRunbookDocumentKeys,
	parseRunbookRecord,
	runbookDocumentAuthoringSchema,
	validateRunbook,
} from "./browser-use-runbook-model";
import {
	actionAssetDigest,
	reviewedActionRecordIsValid,
} from "./browser-use-runbook-actions";
import type { BrowserUseReviewedActionApprovalVerifier } from "./browser-use-reviewed-action-approval";
import {
	type BrowserUseAuthoredReviewedActionRecord,
	reviewedActionApprovalFactsFromRecord,
	verifyAuthoredReviewedActionPromotion,
} from "./browser-use-reviewed-action-authoring";
import { findRedactionViolations } from "./browser-use-schemas";
import { privateRunbookCatalogDigest } from "./browser-use-private-runbook-catalog";

const RUNBOOKS_RELATIVE_ROOT = "skills/browser-use/runbooks";
const ACTIONS_RELATIVE_ROOT = "skills/browser-use/actions";
const REGISTRY_FILE = "registry.json";
const LOCK_FILE = ".runbook-authoring.lock";
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_DIGEST = /^[0-9a-f]{64}$/;
// `[\s\S]` in the traversal/NUL lookaheads (not `.`) so an embedded newline
// cannot hide a `..` segment or NUL from the guard; the body forbids newlines.
const SAFE_RELATIVE = /^(?!\/)(?![\s\S]*(?:^|\/)\.\.(?:\/|$))(?![\s\S]*\0)[^\\\n\r]+$/;
const CREDENTIAL_TARGET = /(?:password|passcode|credential|username|user[-_ ]?name|otp|one[-_ ]?time|login|log[-_ ]?in|sign[-_ ]?in)/i;

/** One precise complete-document refusal with no offending bytes. */
export type BrowserUseRunbookDocumentIssue = {
	code: string;
	path: string;
	message: string;
};

/** Parsed exact runbook bytes plus the model-owned proven record. */
export type BrowserUseParsedRunbookDraft =
	| { ok: true; bytes: string; runbook: BrowserUseRunbook; record_digest: string }
	| {
			ok: false;
			code: string;
			message: string;
			issues: readonly BrowserUseRunbookDocumentIssue[];
			repair: string;
	  };

/** Guarded source mutation result. */
export type BrowserUseRunbookMutationResult =
	| {
			ok: true;
			changed: boolean;
			service_id: string;
			flow_id: string;
			record_digest: string | null;
			synchronization_status:
				| "new-pending-activation"
				| "deletion-pending-activation";
	  }
	| {
			ok: false;
			code: string;
			message: string;
			current_record_digest?: string;
	  };

/** One current private-source record or a typed activation blocker at its path. */
export type BrowserUseRunbookSourceRecord = {
	id: string;
	service_id: string;
	flow_id: string;
	record_digest: string | null;
	runbook?: BrowserUseRunbook;
	activation_blocker?: { code: string; message: string };
};

/** Complete current source view; invalid records stay represented as blockers. */
export type BrowserUseRunbookSourceCatalog = {
	catalog_digest: string;
	records: readonly BrowserUseRunbookSourceRecord[];
	activation_blockers: readonly {
		id: string;
		code: string;
		message: string;
	}[];
};

type JsonParseSuccess = { ok: true; value: unknown };
type JsonParseFailure = { ok: false; duplicatePath?: string };

class ExactJsonParser {
	private index = 0;
	private duplicatePath: string | undefined;

	public constructor(private readonly source: string) {}

	public parse(): JsonParseSuccess | JsonParseFailure {
		try {
			const value = this.value("$");
			this.space();
			if (this.index !== this.source.length) return { ok: false };
			return this.duplicatePath === undefined
				? { ok: true, value }
				: { ok: false, duplicatePath: this.duplicatePath };
		} catch {
			return { ok: false, ...(this.duplicatePath === undefined ? {} : { duplicatePath: this.duplicatePath }) };
		}
	}

	private value(path: string): unknown {
		this.space();
		const character = this.source[this.index];
		if (character === "{") return this.object(path);
		if (character === "[") return this.array(path);
		if (character === '"') return this.string();
		for (const [literal, value] of [["true", true], ["false", false], ["null", null]] as const) {
			if (this.source.startsWith(literal, this.index)) {
				this.index += literal.length;
				return value;
			}
		}
		const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
			this.source.slice(this.index),
		);
		if (match === null) throw new Error("json value invalid");
		this.index += match[0].length;
		return Number(match[0]);
	}

	private object(path: string): Record<string, unknown> {
		this.index += 1;
		this.space();
		const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		const keys = new Set<string>();
		if (this.source[this.index] === "}") {
			this.index += 1;
			return value;
		}
		while (true) {
			this.space();
			if (this.source[this.index] !== '"') throw new Error("json object key invalid");
			const key = this.string();
			if (keys.has(key) && this.duplicatePath === undefined) {
				this.duplicatePath = `${path}.${key}`;
			}
			keys.add(key);
			this.space();
			if (this.source[this.index] !== ":") throw new Error("json object separator invalid");
			this.index += 1;
			value[key] = this.value(`${path}.${key}`);
			this.space();
			const separator = this.source[this.index];
			this.index += 1;
			if (separator === "}") return value;
			if (separator !== ",") throw new Error("json object terminator invalid");
		}
	}

	private array(path: string): unknown[] {
		this.index += 1;
		this.space();
		const value: unknown[] = [];
		if (this.source[this.index] === "]") {
			this.index += 1;
			return value;
		}
		while (true) {
			value.push(this.value(`${path}[${value.length}]`));
			this.space();
			const separator = this.source[this.index];
			this.index += 1;
			if (separator === "]") return value;
			if (separator !== ",") throw new Error("json array terminator invalid");
		}
	}

	private string(): string {
		const start = this.index;
		this.index += 1;
		while (this.index < this.source.length) {
			const character = this.source[this.index];
			this.index += 1;
			if (character === "\\") {
				this.index += 1;
				continue;
			}
			if (character === '"') {
				return JSON.parse(this.source.slice(start, this.index)) as string;
			}
		}
		throw new Error("json string unterminated");
	}

	private space(): void {
		while (/\s/.test(this.source[this.index] ?? "")) this.index += 1;
	}
}


function documentIssue(code: string, path: string, message: string): BrowserUseRunbookDocumentIssue {
	return { code, path: redactUnsafeText(path), message: redactUnsafeText(message) };
}

function inspectDocument(value: unknown): readonly BrowserUseRunbookDocumentIssue[] {
	if (!isObject(value)) return [documentIssue("runbook_document_shape_invalid", "$", "the Runbook Draft must be one object.")];
	const issues: BrowserUseRunbookDocumentIssue[] = inspectRunbookDocumentKeys(value).map(
		(issue) => documentIssue(issue.code, issue.path, issue.message),
	);
	if (Array.isArray(value.steps)) for (const [index, step] of value.steps.entries()) {
		if (!isObject(step)) continue;
		if (typeof step.kind === "string" && CREDENTIAL_TARGET.test(step.kind)) issues.push(documentIssue("runbook_login_step_forbidden", `$.steps[${index}].kind`, "login steps belong to generic login."));
		const target = step.target;
		if (isObject(target) && ((typeof target.role === "string" && CREDENTIAL_TARGET.test(target.role)) || (typeof target.name === "string" && CREDENTIAL_TARGET.test(target.name)))) issues.push(documentIssue("runbook_credential_target_forbidden", `$.steps[${index}].target`, "credential and login targets belong to generic login."));
	}
	if (findRedactionViolations(value).length > 0) issues.push(documentIssue("runbook_secret_shaped_material", "$", "the Runbook Draft carries secret-shaped material and cannot be persisted."));
	return issues;
}

function modelIssue(issue: BrowserUseRunbookIssue): BrowserUseRunbookDocumentIssue {
	return documentIssue(issue.code, "$", redactUnsafeText(issue.message));
}


/** Project the complete model-derived authoring shape and one validating example. */
export function runbookAuthoringSchema() {
	return {
		contract_id: "browser-use.runbook-authoring",
		schema_version: "1",
		model_owner: "parseRunbookRecord + validateRunbook",
		...runbookDocumentAuthoringSchema(),
		replacement_guard: "expected-record-digest",
		unknown_keys: "forbidden-recursively",
		duplicate_keys: "forbidden-before-parse",
		secrets: "forbidden",
		login_steps: "forbidden; generic login owns authentication",
		inline_javascript: "forbidden; reference an exactly digested promoted Reviewed Action",
	};
}

/** Parse exact bytes, reject hidden fields, then run both model-owned passes. */
export function parseRunbookDraftDocument(bytes: string): BrowserUseParsedRunbookDraft {
	const json = new ExactJsonParser(bytes).parse();
	if (!json.ok) {
		const issue = json.duplicatePath === undefined
			? documentIssue("runbook_document_json_invalid", "$", "the Runbook Draft is not valid JSON.")
			: documentIssue("runbook_document_duplicate_key", json.duplicatePath, "a duplicate JSON key is forbidden.");
		return { ok: false, code: issue.code, message: issue.message, issues: [issue], repair: "Remove duplicate or malformed JSON, then validate the complete document again." };
	}
	const exactIssues = inspectDocument(json.value);
	if (exactIssues.length > 0) return { ok: false, code: exactIssues[0]?.code ?? "runbook_document_invalid", message: exactIssues[0]?.message ?? "the Runbook Draft is invalid.", issues: exactIssues, repair: "Fix every named document path, then validate the complete document again." };
	const parsed = parseRunbookRecord(json.value);
	if (!parsed.ok) {
		const issue = modelIssue(parsed.issue);
		return { ok: false, code: issue.code, message: issue.message, issues: [issue], repair: "Fix the model-owned Runbook shape, then validate the complete document again." };
	}
	const validationIssues = validateRunbook(parsed.runbook).map(modelIssue);
	if (validationIssues.length > 0) return { ok: false, code: validationIssues[0]?.code ?? "runbook_invalid", message: validationIssues[0]?.message ?? "the Runbook Draft is invalid.", issues: validationIssues, repair: "Fix every model-owned validation issue, then validate the complete document again." };
	return { ok: true, bytes, runbook: parsed.runbook, record_digest: actionAssetDigest(bytes) };
}

async function admittedRoots(sourceRoot: string): Promise<{ runbooks: string; actions: string } | undefined> {
	if (!isAbsolute(sourceRoot)) return undefined;
	try {
		const canonicalSource = await realpath(sourceRoot);
		const runbooks = await realpath(join(canonicalSource, ...RUNBOOKS_RELATIVE_ROOT.split("/")));
		const actions = await realpath(join(canonicalSource, ...ACTIONS_RELATIVE_ROOT.split("/")));
		const [runbooksStat, actionsStat] = await Promise.all([lstat(runbooks), lstat(actions)]);
		if (!runbooksStat.isDirectory() || runbooksStat.isSymbolicLink() || !actionsStat.isDirectory() || actionsStat.isSymbolicLink()) return undefined;
		if (relative(canonicalSource, runbooks) !== RUNBOOKS_RELATIVE_ROOT || relative(canonicalSource, actions) !== ACTIONS_RELATIVE_ROOT) return undefined;
		return { runbooks, actions };
	} catch {
		return undefined;
	}
}

type SourceRegistryEntry = {
	asset_path: string;
	record: BrowserUseAuthoredReviewedActionRecord;
	promotion_history?: readonly unknown[];
};

async function sourceCommit(sourceRoot: string): Promise<string | undefined> {
	const child = Bun.spawn(["git", "rev-parse", "--verify", "HEAD^{commit}"], { cwd: sourceRoot, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
	const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
	return exitCode === 0 && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(stdout.trim()) ? stdout.trim() : undefined;
}

/** Registry + source-commit resolved once per catalog read and shared across records. */
type ActionClosureContext = {
	entries: SourceRegistryEntry[] | { ok: false; code: string; message: string };
	commit: () => Promise<string | undefined>;
};

async function loadActionClosureContext(sourceRoot: string, actionsRoot: string): Promise<ActionClosureContext> {
	let entries: ActionClosureContext["entries"];
	try {
		const registryValue: unknown = JSON.parse(await readFile(join(actionsRoot, REGISTRY_FILE), "utf8"));
		entries = !isObject(registryValue) || !Array.isArray(registryValue.actions)
			? { ok: false as const, code: "runbook_action_registry_invalid", message: "the private Reviewed Action registry is invalid." }
			: registryValue.actions.filter((entry): entry is SourceRegistryEntry => isObject(entry) && typeof entry.asset_path === "string" && SAFE_RELATIVE.test(entry.asset_path) && reviewedActionRecordIsValid(entry.record));
	} catch {
		entries = { ok: false as const, code: "runbook_action_registry_invalid", message: "the private Reviewed Action registry is unreadable or invalid." };
	}
	// Resolve HEAD at most once across every record on the read path (was one
	// git rev-parse subprocess per record before this cache).
	let resolved: string | undefined | null = null;
	const commit = async () => {
		if (resolved === null) resolved = await sourceCommit(sourceRoot);
		return resolved;
	};
	return { entries, commit };
}

async function validateActionClosure(input: {
	sourceRoot: string;
	actionsRoot: string;
	runbook: BrowserUseRunbook;
	approvalVerifier?: BrowserUseReviewedActionApprovalVerifier;
	context?: ActionClosureContext;
}): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
	const refs = input.runbook.steps.flatMap((step) => step.kind === "action" ? [step] : step.kind === "iterate" ? [step.step] : []);
	if (refs.length === 0) return { ok: true };
	const context = input.context ?? await loadActionClosureContext(input.sourceRoot, input.actionsRoot);
	const resolvedEntries = context.entries;
	if (!Array.isArray(resolvedEntries)) return resolvedEntries;
	const entries: readonly SourceRegistryEntry[] = resolvedEntries;
	for (const ref of refs) {
		const matches = entries.filter((entry) => entry.record.action_id === ref.action_id);
		if (matches.length === 0) return { ok: false, code: "runbook_action_absent", message: "a referenced Reviewed Action is absent from the private registry." };
		if (matches.length !== 1) return { ok: false, code: "runbook_action_registry_invalid", message: "a referenced Reviewed Action id is duplicated." };
		const entry = matches[0] as SourceRegistryEntry;
		if (entry.record.expected_digest !== ref.expected_digest || entry.record.asset_id !== ref.expected_digest) return { ok: false, code: "runbook_action_digest_stale", message: "a referenced Reviewed Action digest is stale." };
		if (!input.runbook.allowed_origins.includes(entry.record.allowed_origin)) return { ok: false, code: "runbook_action_origin_mismatch", message: "a referenced Reviewed Action origin is outside the Runbook origins." };
		let assetBytes: string;
		try {
			// Resolve both sides so a symlink component in actionsRoot does not make
			// this containment check disagree with sourceActionFiles.
			const actionsRootReal = await realpath(input.actionsRoot);
			const assetPath = await realpath(join(input.actionsRoot, ...entry.asset_path.split("/")));
			if (assetPath !== actionsRootReal && !assetPath.startsWith(`${actionsRootReal}${sep}`)) throw new Error("outside action root");
			assetBytes = await readFile(assetPath, "utf8");
		} catch { return { ok: false, code: "runbook_action_asset_unreadable", message: "a referenced Reviewed Action asset is absent or unreadable." }; }
		if (actionAssetDigest(assetBytes) !== ref.expected_digest) return { ok: false, code: "runbook_action_digest_stale", message: "a referenced Reviewed Action digest does not match its source bytes." };
		const mechanical = reviewedActionApprovalFactsFromRecord({
			commit: "0".repeat(40),
			record: entry.record,
			assetBytes,
		});
		if (!mechanical.ok) {
			return {
				ok: false,
				code:
					mechanical.code === "action_capability_credential_field"
						? "runbook_action_auth_capable"
						: "runbook_action_mechanical_invalid",
				message:
					"a referenced Reviewed Action fails the current mechanical capability and integrity audit.",
			};
		}
		if (entry.record.promotion_receipt === null) return { ok: false, code: "runbook_action_unpromoted", message: "a referenced Reviewed Action has not been externally promoted." };
		if (input.approvalVerifier === undefined) return { ok: false, code: "runbook_action_promotion_verifier_unavailable", message: "a referenced Reviewed Action requires offline promotion verification." };
		const commit = await context.commit();
		if (commit === undefined) return { ok: false, code: "runbook_action_source_commit_unavailable", message: "the source commit for Reviewed Action promotion cannot be resolved." };
		const verified = verifyAuthoredReviewedActionPromotion({ commit, record: entry.record, assetBytes, promotionHistory: entry.promotion_history, verifier: input.approvalVerifier });
		if (!verified.ok) return { ok: false, code: verified.code === "action_capability_credential_field" ? "runbook_action_auth_capable" : "runbook_action_promotion_invalid", message: "a referenced Reviewed Action lacks exact current promotion authority." };
	}
	return { ok: true };
}

/** Validate one complete document plus its current source Reviewed Action closure. */
export async function validateRunbookDraftForSource(input: {
	sourceRoot: string;
	bytes: string;
	approvalVerifier?: BrowserUseReviewedActionApprovalVerifier;
}): Promise<
	| { ok: true; runbook: BrowserUseRunbook; record_digest: string; bytes: string }
	| { ok: false; code: string; message: string }
> {
	const roots = await admittedRoots(input.sourceRoot);
	if (roots === undefined) return { ok: false, code: "runbook_source_checkout_required", message: "Runbook validation requires the setup-owned source checkout." };
	const parsed = parseRunbookDraftDocument(input.bytes);
	if (!parsed.ok) return { ok: false, code: parsed.code, message: parsed.repair };
	const closure = await validateActionClosure({ sourceRoot: input.sourceRoot, actionsRoot: roots.actions, runbook: parsed.runbook, ...(input.approvalVerifier === undefined ? {} : { approvalVerifier: input.approvalVerifier }) });
	return closure.ok ? parsed : closure;
}

type SourceActionFilesResult =
	| { ok: true; files: readonly { relative_path: string; digest: string }[] }
	| { ok: false; code: string; message: string };

async function sourceActionFiles(
	actionsRoot: string,
	runbooks: readonly BrowserUseRunbook[],
): Promise<SourceActionFilesResult> {
	let registryBytes: string;
	let registry: unknown;
	try {
		registryBytes = await readFile(join(actionsRoot, REGISTRY_FILE), "utf8");
		registry = JSON.parse(registryBytes);
	} catch {
		// A missing/unreadable registry must not digest as an empty registry:
		// that would make a corrupt source claim an empty action set and stay
		// invisible through activation.
		return { ok: false, code: "runbook_action_registry_unreadable", message: "the private Reviewed Action registry is absent, unreadable, or not valid JSON." };
	}
	const files = [{ relative_path: "actions/registry.json", digest: actionAssetDigest(registryBytes) }];
	if (!isObject(registry) || !Array.isArray(registry.actions)) return { ok: false, code: "runbook_action_registry_invalid", message: "the private Reviewed Action registry shape is invalid." };
	const refs = new Set(
		runbooks.flatMap((runbook) =>
			runbook.steps.flatMap((step) =>
				step.kind === "action"
					? [step.action_id]
					: step.kind === "iterate"
						? [step.step.action_id]
						: [],
			),
		),
	);
	const actionsRootReal = await realpath(actionsRoot).catch(() => undefined);
	for (const entry of registry.actions) {
		if (
			!isObject(entry) ||
			typeof entry.asset_path !== "string" ||
			!SAFE_RELATIVE.test(entry.asset_path) ||
			!isObject(entry.record) ||
			typeof entry.record.action_id !== "string" ||
			!refs.has(entry.record.action_id)
		) continue;
		const assetPath = join(actionsRoot, ...entry.asset_path.split("/"));
		// Containment: prove the resolved asset stays under the actions root, matching
		// the sibling check in validateActionClosure. SAFE_RELATIVE plus this realpath
		// guard close the traversal gap on a symlinked or crafted asset_path.
		const assetReal = await realpath(assetPath).catch(() => undefined);
		if (actionsRootReal === undefined || assetReal === undefined || (assetReal !== actionsRootReal && !assetReal.startsWith(`${actionsRootReal}${sep}`))) {
			return { ok: false, code: "runbook_action_asset_unreadable", message: "a referenced Reviewed Action asset is absent, unreadable, or escapes the actions root." };
		}
		let bytes: string;
		try {
			bytes = await readFile(assetReal, "utf8");
		} catch {
			return { ok: false, code: "runbook_action_asset_unreadable", message: "a referenced Reviewed Action asset is absent or unreadable." };
		}
		files.push({ relative_path: `actions/${entry.asset_path}`, digest: actionAssetDigest(bytes) });
	}
	return { ok: true, files: files.sort((left, right) => left.relative_path.localeCompare(right.relative_path)) };
}

/** Read working source without dropping invalid entries or consulting CWD. */
export async function readRunbookSourceCatalog(input: {
	sourceRoot: string;
	approvalVerifier?: BrowserUseReviewedActionApprovalVerifier;
}): Promise<
	| { ok: true; catalog: BrowserUseRunbookSourceCatalog }
	| { ok: false; code: string; message: string }
> {
	const roots = await admittedRoots(input.sourceRoot);
	if (roots === undefined) return { ok: false, code: "runbook_source_checkout_required", message: "Runbook source reads require the setup-owned source checkout." };
	const records: BrowserUseRunbookSourceRecord[] = [];
	const fileDigests: Array<{ relative_path: string; digest: string }> = [];
	// Resolve the registry and source commit once, shared across every record's
	// closure check, instead of one registry read + git rev-parse per record.
	const closureContext = await loadActionClosureContext(input.sourceRoot, roots.actions);
	let services: Dirent<string>[];
	try {
		services = await readdir(roots.runbooks, { withFileTypes: true });
	} catch {
		return { ok: false, code: "runbook_source_read_failed", message: "the private Runbook source catalog could not be enumerated." };
	}
	for (const service of services.sort((left, right) => left.name.localeCompare(right.name))) {
		if (service.name === LOCK_FILE) continue;
		if (!SAFE_ID.test(service.name)) {
			records.push({ id: `${service.name}/*`, service_id: service.name, flow_id: "*", record_digest: null, activation_blocker: { code: "catalog_record_identity_invalid", message: "a Runbook service path is not a safe lowercase slug." } });
			continue;
		}
		const serviceRoot = join(roots.runbooks, service.name);
		if (!service.isDirectory() || service.isSymbolicLink()) {
			records.push({ id: `${service.name}/*`, service_id: service.name, flow_id: "*", record_digest: null, activation_blocker: { code: "catalog_record_unreadable", message: "a Runbook service entry is not an admitted directory." } });
			continue;
		}
		let flows: Dirent<string>[];
		try {
			flows = await readdir(serviceRoot, { withFileTypes: true });
		} catch {
			records.push({ id: `${service.name}/*`, service_id: service.name, flow_id: "*", record_digest: null, activation_blocker: { code: "catalog_record_unreadable", message: "a Runbook service directory could not be enumerated." } });
			continue;
		}
		for (const flow of flows.sort((left, right) => left.name.localeCompare(right.name))) {
			const id = `${service.name}/${flow.name}`;
			if (!SAFE_ID.test(flow.name)) {
				records.push({ id, service_id: service.name, flow_id: flow.name, record_digest: null, activation_blocker: { code: "catalog_record_identity_invalid", message: "a Runbook flow path is not a safe lowercase slug." } });
				continue;
			}
			const path = join(serviceRoot, flow.name, "runbook.json");
			if (!flow.isDirectory() || flow.isSymbolicLink()) {
				records.push({ id, service_id: service.name, flow_id: flow.name, record_digest: null, activation_blocker: { code: "catalog_record_unreadable", message: "a Runbook flow entry is not an admitted directory." } });
				continue;
			}
			let bytes: string;
			try {
				const stat = await lstat(path);
				if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsafe record");
				bytes = await readFile(path, "utf8");
			} catch {
				records.push({ id, service_id: service.name, flow_id: flow.name, record_digest: null, activation_blocker: { code: "catalog_record_unreadable", message: "the source Runbook record is absent, unreadable, or unsafe." } });
				continue;
			}
			const recordDigest = actionAssetDigest(bytes);
			fileDigests.push({ relative_path: `runbooks/${service.name}/${flow.name}/runbook.json`, digest: recordDigest });
			const parsed = parseRunbookDraftDocument(bytes);
			if (!parsed.ok || parsed.runbook.service_id !== service.name || parsed.runbook.flow_id !== flow.name) {
				records.push({ id, service_id: service.name, flow_id: flow.name, record_digest: recordDigest, activation_blocker: { code: parsed.ok ? "catalog_record_identity_mismatch" : parsed.code, message: parsed.ok ? "the source Runbook identity does not match its path." : parsed.message } });
				continue;
			}
			const closure = await validateActionClosure({ sourceRoot: input.sourceRoot, actionsRoot: roots.actions, runbook: parsed.runbook, context: closureContext, ...(input.approvalVerifier === undefined ? {} : { approvalVerifier: input.approvalVerifier }) });
			records.push({ id, service_id: service.name, flow_id: flow.name, record_digest: recordDigest, runbook: parsed.runbook, ...(!closure.ok ? { activation_blocker: { code: closure.code, message: closure.message } } : {}) });
		}
	}
	const actionFiles = await sourceActionFiles(roots.actions, records.flatMap((record) => record.runbook === undefined ? [] : [record.runbook]));
	const registryBlocker = actionFiles.ok ? undefined : { id: "actions/registry.json", code: actionFiles.code, message: actionFiles.message };
	if (actionFiles.ok) fileDigests.push(...actionFiles.files);
	fileDigests.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
	const activationBlockers = [
		...records.flatMap((record) => record.activation_blocker === undefined ? [] : [{ id: record.id, ...record.activation_blocker }]),
		...(registryBlocker === undefined ? [] : [registryBlocker]),
	];
	return { ok: true, catalog: { catalog_digest: privateRunbookCatalogDigest(fileDigests), records, activation_blockers: activationBlockers } };
}

const LOCK_STALE_MS = 5 * 60_000;

/** True when the pid is not a live process this user can signal. */
function pidIsDead(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return true;
	try { process.kill(pid, 0); return false; } catch (error) {
		// EPERM means the process exists but is owned by another user (alive).
		return (error as NodeJS.ErrnoException).code !== "EPERM";
	}
}

/** A lock is reclaimable when its owner pid is dead or it has outlived the bound. */
async function catalogLockIsStale(lockPath: string): Promise<boolean> {
	try {
		const parsed = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown; acquired_at?: unknown };
		const pid = typeof parsed.pid === "number" ? parsed.pid : Number.NaN;
		const acquiredAt = typeof parsed.acquired_at === "string" ? Date.parse(parsed.acquired_at) : Number.NaN;
		if (pidIsDead(pid)) return true;
		return Number.isFinite(acquiredAt) && Date.now() - acquiredAt > LOCK_STALE_MS;
	} catch {
		// Unreadable or malformed lock content cannot prove a live holder.
		return true;
	}
}

/** Create the lock with owner identity already inside it (no empty-file window). */
async function createOwnedLock(lockPath: string): Promise<Awaited<ReturnType<typeof open>> | undefined> {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(lockPath, "wx", 0o600);
	} catch {
		return undefined;
	}
	try {
		await handle.write(JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }));
		return handle;
	} catch {
		await handle.close();
		await rm(lockPath, { force: true }).catch(() => undefined);
		return undefined;
	}
}

async function withCatalogLock<T>(runbooksRoot: string, body: () => Promise<T>): Promise<T | undefined> {
	const lockPath = join(runbooksRoot, LOCK_FILE);
	let lock = await createOwnedLock(lockPath);
	if (lock === undefined) {
		// A crashed holder leaves the lock behind and would deadlock every future
		// mutation. Steal a stale lock atomically: rename it aside to a per-pid temp
		// (only one racer's rename of a given inode wins), then recreate. If the
		// rename fails, another process already reclaimed it — do not delete a live
		// lock out from under it.
		if (!(await catalogLockIsStale(lockPath))) return undefined;
		const stolen = `${lockPath}.stale-${process.pid}`;
		try { await rename(lockPath, stolen); } catch { return undefined; }
		await rm(stolen, { force: true }).catch(() => undefined);
		lock = await createOwnedLock(lockPath);
		if (lock === undefined) return undefined;
	}
	try { return await body(); } finally { await lock.close(); await rm(lockPath, { force: true }); }
}

/** Apply one exact validated Runbook document to admitted private source. */
export async function applyRunbookDraft(input: {
	sourceRoot: string;
	bytes: string;
	expectedRecordDigest?: string;
	approvalVerifier?: BrowserUseReviewedActionApprovalVerifier;
}): Promise<BrowserUseRunbookMutationResult> {
	const roots = await admittedRoots(input.sourceRoot);
	if (roots === undefined) return { ok: false, code: "runbook_source_checkout_required", message: "Runbook apply requires the setup-owned source checkout." };
	const parsed = await validateRunbookDraftForSource(input);
	if (!parsed.ok) return parsed;
	let outcome: BrowserUseRunbookMutationResult | undefined;
	try {
		outcome = await withCatalogLock(roots.runbooks, async (): Promise<BrowserUseRunbookMutationResult> => {
		const serviceDirectory = join(roots.runbooks, parsed.runbook.service_id);
		await mkdir(serviceDirectory, { mode: 0o700 }).catch(async (error: unknown) => {
			if (!isObject(error) || error.code !== "EEXIST") throw error;
		});
		const serviceStat = await lstat(serviceDirectory);
		if (!serviceStat.isDirectory() || serviceStat.isSymbolicLink()) return { ok: false, code: "runbook_source_path_unsafe", message: "the Runbook source service target is not an admitted directory." };
		const canonicalServiceDirectory = await realpath(serviceDirectory);
		if (relative(roots.runbooks, canonicalServiceDirectory) !== parsed.runbook.service_id) return { ok: false, code: "runbook_source_path_unsafe", message: "the Runbook source service target is outside the admitted catalog." };
		const directory = join(canonicalServiceDirectory, parsed.runbook.flow_id);
		await mkdir(directory, { mode: 0o700 }).catch(async (error: unknown) => {
			if (!isObject(error) || error.code !== "EEXIST") throw error;
		});
		const directoryStat = await lstat(directory);
		if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return { ok: false, code: "runbook_source_path_unsafe", message: "the Runbook source flow target is not an admitted directory." };
		const canonicalDirectory = await realpath(directory);
		if (relative(roots.runbooks, canonicalDirectory) !== `${parsed.runbook.service_id}/${parsed.runbook.flow_id}`) return { ok: false, code: "runbook_source_path_unsafe", message: "the Runbook source target is outside the admitted catalog." };
		const path = join(canonicalDirectory, "runbook.json");
		const stat = await lstat(path).catch(() => undefined);
		if (stat !== undefined && (!stat.isFile() || stat.isSymbolicLink())) return { ok: false, code: "runbook_source_path_unsafe", message: "the Runbook source target is not a regular file." };
		const existingBytes = stat === undefined ? undefined : await readFile(path, "utf8");
		const currentDigest = existingBytes === undefined ? undefined : actionAssetDigest(existingBytes);
		if (existingBytes === input.bytes) return { ok: true, changed: false, service_id: parsed.runbook.service_id, flow_id: parsed.runbook.flow_id, record_digest: parsed.record_digest, synchronization_status: "new-pending-activation" };
		if (currentDigest !== undefined && input.expectedRecordDigest === undefined) return { ok: false, code: "runbook_replacement_digest_required", message: "replacement requires the currently observed Runbook record digest.", current_record_digest: currentDigest };
		if (currentDigest !== undefined && input.expectedRecordDigest !== currentDigest) return { ok: false, code: "runbook_replacement_digest_stale", message: "the Runbook record changed after observation; refresh before replacing it.", current_record_digest: currentDigest };
		const temporary = join(canonicalDirectory, `.runbook.${process.pid}.tmp`);
		try {
			const handle = await open(temporary, "wx", 0o600);
			try { await handle.writeFile(input.bytes, "utf8"); await handle.sync(); } finally { await handle.close(); }
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true });
		}
		return { ok: true, changed: true, service_id: parsed.runbook.service_id, flow_id: parsed.runbook.flow_id, record_digest: parsed.record_digest, synchronization_status: "new-pending-activation" };
		});
	} catch {
		return { ok: false, code: "runbook_source_write_failed", message: "the private Runbook source mutation failed." };
	}
	return outcome ?? { ok: false, code: "runbook_source_lock_contended", message: "another Runbook source mutation holds the catalog lock; a stale lock (dead owner pid or older than 5 minutes) is reclaimed automatically on the next attempt." };
}

/** Delete one source Runbook only when its exact observed digest still matches. */
export async function deleteRunbookDraft(input: {
	sourceRoot: string;
	serviceId: string;
	flowId: string;
	expectedRecordDigest?: string;
}): Promise<BrowserUseRunbookMutationResult> {
	const roots = await admittedRoots(input.sourceRoot);
	if (roots === undefined) return { ok: false, code: "runbook_source_checkout_required", message: "Runbook delete requires the setup-owned source checkout." };
	if (!SAFE_ID.test(input.serviceId) || !SAFE_ID.test(input.flowId)) return { ok: false, code: "runbook_id_invalid", message: "Runbook service and flow ids must be safe lowercase slugs." };
	if (input.expectedRecordDigest !== undefined && !SAFE_DIGEST.test(input.expectedRecordDigest)) return { ok: false, code: "runbook_delete_digest_invalid", message: "the expected Runbook record digest must be lowercase sha256." };
	let outcome: BrowserUseRunbookMutationResult | undefined;
	try {
		outcome = await withCatalogLock(roots.runbooks, async (): Promise<BrowserUseRunbookMutationResult> => {
		const absent = (): BrowserUseRunbookMutationResult => ({ ok: true, changed: false, service_id: input.serviceId, flow_id: input.flowId, record_digest: null, synchronization_status: "deletion-pending-activation" });
		const serviceDirectory = join(roots.runbooks, input.serviceId);
		const serviceStat = await lstat(serviceDirectory).catch(() => undefined);
		if (serviceStat === undefined) return absent();
		if (!serviceStat.isDirectory() || serviceStat.isSymbolicLink()) return { ok: false, code: "runbook_source_path_unsafe", message: "the Runbook source service target is not an admitted directory." };
		const canonicalServiceDirectory = await realpath(serviceDirectory);
		if (relative(roots.runbooks, canonicalServiceDirectory) !== input.serviceId) return { ok: false, code: "runbook_source_path_unsafe", message: "the Runbook source service target is outside the admitted catalog." };
		const flowDirectory = join(canonicalServiceDirectory, input.flowId);
		const flowStat = await lstat(flowDirectory).catch(() => undefined);
		if (flowStat === undefined) return absent();
		if (!flowStat.isDirectory() || flowStat.isSymbolicLink()) return { ok: false, code: "runbook_source_path_unsafe", message: "the Runbook source flow target is not an admitted directory." };
		const canonicalFlowDirectory = await realpath(flowDirectory);
		if (relative(roots.runbooks, canonicalFlowDirectory) !== `${input.serviceId}/${input.flowId}`) return { ok: false, code: "runbook_source_path_unsafe", message: "the Runbook source target is outside the admitted catalog." };
		const path = join(canonicalFlowDirectory, "runbook.json");
		const stat = await lstat(path).catch(() => undefined);
		if (stat === undefined) return absent();
		if (!stat.isFile() || stat.isSymbolicLink()) return { ok: false, code: "runbook_source_path_unsafe", message: "the Runbook source target is not a regular file." };
		const currentDigest = actionAssetDigest(await readFile(path, "utf8"));
		if (input.expectedRecordDigest !== currentDigest) return { ok: false, code: "runbook_delete_digest_stale", message: "delete requires the currently observed Runbook record digest.", current_record_digest: currentDigest };
		await rm(path);
		await rmdir(canonicalFlowDirectory).catch(() => undefined);
		await rmdir(canonicalServiceDirectory).catch(() => undefined);
		return { ok: true, changed: true, service_id: input.serviceId, flow_id: input.flowId, record_digest: null, synchronization_status: "deletion-pending-activation" };
		});
	} catch {
		return { ok: false, code: "runbook_source_write_failed", message: "the private Runbook source mutation failed." };
	}
	return outcome ?? { ok: false, code: "runbook_source_lock_contended", message: "another Runbook source mutation holds the catalog lock; a stale lock (dead owner pid or older than 5 minutes) is reclaimed automatically on the next attempt." };
}
