import { createHash } from "node:crypto";

/** Canonical Atlassian contract used for Bitbucket Cloud REST discovery. */
export const BITBUCKET_OPENAPI_URL = "https://api.bitbucket.org/swagger.json";

/** Semantic contract persisted as the generated drift baseline. */
export interface OpenApiBaseline {
	/** Stable baseline contract identifier. */
	contract_id: "bitbucket.openapi-baseline";
	/** Baseline schema version owned by this package. */
	schema_version: "1";
	/** Upstream contract URL. */
	source_url: string;
	/** Swagger version declared upstream. */
	swagger: string;
	/** API base path declared upstream. */
	base_path: string;
	/** Method and path keyed semantic operations. */
	operations: Record<string, unknown>;
	/** Shared schemas and security definitions that affect operations. */
	components: Record<string, unknown>;
}

/** Drift categories returned by the deterministic comparison. */
export interface OpenApiDrift {
	/** Operations only present in the live contract. */
	added_operations: string[];
	/** Baseline operations absent from the live contract. */
	removed_operations: string[];
	/** Operations whose semantic request, response, or security shape changed. */
	changed_operations: string[];
	/** Existing operations whose change is backward-compatible. */
	expanded_operations: string[];
	/** Existing operations whose compatibility needs maintainer review. */
	review_operations: string[];
	/** Shared components only present in the live contract. */
	added_components: string[];
	/** Shared components absent from the live contract. */
	removed_components: string[];
	/** Shared components whose semantic shape changed. */
	changed_components: string[];
	/** Reachable component changes whose compatibility needs maintainer review. */
	review_components: string[];
	/** Full counts for bounded evidence arrays. */
	totals: Record<string, number>;
	/** True when any evidence array was sampled. */
	truncated: boolean;
}

/** Approval-gated issue content generated for breaking drift. */
export interface DriftIssueDraft {
	/** Stable key used to find an existing issue before creation. */
	dedupe_key: string;
	/** Suggested issue title. */
	title: string;
	/** Suggested issue body containing bounded, public contract evidence. */
	body: string;
}

/** Result of comparing one live contract with the stored baseline. */
export interface OpenApiDriftAnalysis {
	/** Overall compatibility state. */
	health: "healthy" | "additive_drift" | "review_drift" | "breaking_drift";
	/** Digest of the stored semantic baseline. */
	baseline_digest: string;
	/** Digest of the live semantic contract. */
	live_digest: string;
	/** Bounded-category drift evidence. */
	drift: OpenApiDrift;
	/** Issue content only when breaking drift is confirmed. */
	issue_draft: DriftIssueDraft | null;
}

const HTTP_METHODS = new Set(["get", "head", "options", "post", "put", "patch", "delete"]);
const NON_SEMANTIC_KEYS = new Set(["description", "summary", "title", "example", "examples", "externalDocs", "tags", "operationId"]);
const SEMANTIC_VENDOR_KEYS = new Set(["x-atlassian-auth-types", "x-atlassian-oauth2-scopes"]);
const DRIFT_SAMPLE_LIMIT = 50;

/**
 * Build the semantic subset used for deterministic drift checks.
 *
 * @param document - Parsed Bitbucket Swagger document
 * @returns Stable baseline content with documentation-only fields removed
 * @throws When the document lacks a usable paths object
 *
 * @example
 * ```ts
 * const baseline = buildOpenApiBaseline({ swagger: "2.0", basePath: "/2.0", paths: {} })
 * ```
 */
export function buildOpenApiBaseline(document: unknown): OpenApiBaseline {
	if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("OpenAPI document must be an object.");
	const root = document as Record<string, unknown>;
	if (!root.paths || typeof root.paths !== "object" || Array.isArray(root.paths)) throw new Error("OpenAPI document has no paths object.");

	const operations: Record<string, unknown> = {};
	for (const [path, rawPathItem] of Object.entries(root.paths as Record<string, unknown>)) {
		if (!rawPathItem || typeof rawPathItem !== "object" || Array.isArray(rawPathItem)) continue;
		const pathItem = rawPathItem as Record<string, unknown>;
		const pathParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
		for (const [method, rawOperation] of Object.entries(pathItem)) {
			if (!HTTP_METHODS.has(method.toLowerCase()) || !rawOperation || typeof rawOperation !== "object" || Array.isArray(rawOperation)) continue;
			const operation = rawOperation as Record<string, unknown>;
			const parameters = mergeEffectiveParameters(pathParameters, Array.isArray(operation.parameters) ? operation.parameters : [], root);
			const semanticOperation: Record<string, unknown> = {
				parameters: cleanSemantic(parameters),
				responses: cleanSemantic(operation.responses ?? {}),
			};
			for (const inheritedKey of ["consumes", "produces", "schemes", "security"]) {
				const value = operation[inheritedKey] ?? root[inheritedKey];
				if (value !== undefined) semanticOperation[inheritedKey] = cleanSemantic(value);
			}
			if (operation.deprecated !== undefined) semanticOperation.deprecated = operation.deprecated;
			for (const key of SEMANTIC_VENDOR_KEYS) {
				if (operation[key] !== undefined) semanticOperation[key] = cleanSemantic(operation[key]);
			}
			operations[`${method.toUpperCase()} ${path}`] = cleanSemantic(compactSchemas(resolveLocalReferences(semanticOperation, root)));
		}
	}

	const allComponents: Record<string, unknown> = {};
	for (const key of ["definitions", "parameters", "responses", "securityDefinitions"]) {
		if (root[key] !== undefined) allComponents[key] = cleanSemantic(root[key]);
	}
	const components = reachableComponents(operations, allComponents);

	return {
		contract_id: "bitbucket.openapi-baseline",
		schema_version: "1",
		source_url: BITBUCKET_OPENAPI_URL,
		swagger: typeof root.swagger === "string" ? root.swagger : "unknown",
		base_path: typeof root.basePath === "string" ? root.basePath : "unknown",
		operations: sortRecord(operations),
		components: sortRecord(components),
	};
}

function resolveLocalReferences(value: unknown, root: Record<string, unknown>, stack = new Set<string>()): unknown {
	if (Array.isArray(value)) return value.map((item) => resolveLocalReferences(item, root, stack));
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	if (typeof record.$ref === "string") {
		const match = record.$ref.match(/^#\/(definitions|parameters|responses)\/([^/]+)$/);
		if (match) {
			const reference = record.$ref;
			if (stack.has(reference)) return { $recursive_ref: reference };
			const group = root[match[1]] as Record<string, unknown> | undefined;
			const resolved = group?.[decodePointer(match[2])];
			if (resolved === undefined) throw new Error(`OpenAPI reference is unresolved: ${reference}`);
			const nextStack = new Set(stack);
			nextStack.add(reference);
			return resolveLocalReferences(resolved, root, nextStack);
		}
	}
	return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, resolveLocalReferences(item, root, stack)]));
}

function compactSchemas(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(compactSchemas);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
		if (key === "schema") {
			return [key, { semantic_sha256: createHash("sha256").update(stableStringify(cleanSemantic(item))).digest("hex") }];
		}
		return [key, compactSchemas(item)];
	}));
}

/**
 * Compare a live Swagger document with a generated semantic baseline.
 *
 * @param liveDocument - Parsed live Swagger response
 * @param baseline - Stored semantic baseline
 * @returns Compatibility state, deterministic evidence, and an approval-gated issue draft
 * @throws When either contract shape is invalid
 *
 * @example
 * ```ts
 * const analysis = analyzeOpenApiDrift(liveSwagger, storedBaseline)
 * ```
 */
export function analyzeOpenApiDrift(liveDocument: unknown, baseline: OpenApiBaseline): OpenApiDriftAnalysis {
	validateBaseline(baseline);
	const live = buildOpenApiBaseline(liveDocument);
	const operationDiff = compareOperations(baseline.operations, live.operations);
	const componentDiff = compareRecords(flattenComponents(baseline), flattenComponents(live));
	if (baseline.swagger !== live.swagger || baseline.base_path !== live.base_path) componentDiff.changed.push("contract_metadata");

	const fullDrift = {
		added_operations: operationDiff.added,
		removed_operations: operationDiff.removed,
		changed_operations: operationDiff.breaking,
		expanded_operations: operationDiff.additive,
		review_operations: operationDiff.review,
		added_components: componentDiff.added,
		removed_components: componentDiff.removed,
		changed_components: componentDiff.changed.filter((key) => key === "contract_metadata"),
		review_components: componentDiff.changed.filter((key) => key !== "contract_metadata"),
	};
	const breaking = fullDrift.removed_operations.length > 0 || fullDrift.changed_operations.length > 0 || fullDrift.removed_components.length > 0 || fullDrift.changed_components.length > 0;
	const review = fullDrift.review_operations.length > 0 || fullDrift.review_components.length > 0;
	const additive = fullDrift.added_operations.length > 0 || fullDrift.expanded_operations.length > 0 || fullDrift.added_components.length > 0;
	const health = breaking ? "breaking_drift" : review ? "review_drift" : additive ? "additive_drift" : "healthy";
	const baselineDigest = digestBaseline(baseline);
	const liveDigest = digestBaseline(live);
	const drift = boundDrift(fullDrift);

	return {
		health,
		baseline_digest: baselineDigest,
		live_digest: liveDigest,
		drift,
		issue_draft: health === "breaking_drift" ? buildIssueDraft(drift, baselineDigest, liveDigest, breakingFingerprint(fullDrift, baseline, live)) : null,
	};
}

function mergeEffectiveParameters(pathParameters: unknown[], operationParameters: unknown[], root: Record<string, unknown>): unknown[] {
	const merged = new Map<string, unknown>();
	const unnamed: unknown[] = [];
	for (const parameter of [...pathParameters, ...operationParameters]) {
		const resolved = resolveSharedParameter(parameter, root);
		const identity = parameterIdentity(resolved);
		if (identity) merged.set(identity, resolved);
		else unnamed.push(resolved);
	}
	return [...merged.values(), ...unnamed];
}

function resolveSharedParameter(parameter: unknown, root: Record<string, unknown>): unknown {
	if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) return null;
	const item = parameter as Record<string, unknown>;
	const reference = typeof item.$ref === "string" ? item.$ref.match(/^#\/parameters\/([^/]+)$/) : null;
	if (reference) {
		const shared = root.parameters as Record<string, unknown> | undefined;
		const resolved = shared?.[decodePointer(reference[1])];
		if (!resolved) throw new Error(`OpenAPI parameter reference is unresolved: ${item.$ref}`);
		return resolved;
	}
	return parameter;
}

function parameterIdentity(parameter: unknown): string | null {
	if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) return null;
	const item = parameter as Record<string, unknown>;
	return typeof item.name === "string" && typeof item.in === "string" ? `${item.in}\u0000${item.name}` : null;
}

function reachableComponents(operations: Record<string, unknown>, allComponents: Record<string, unknown>): Record<string, unknown> {
	const flattened: Record<string, unknown> = {};
	for (const [group, entries] of Object.entries(allComponents)) {
		if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
		for (const [name, value] of Object.entries(entries as Record<string, unknown>)) flattened[`${group}/${name}`] = value;
	}
	const reachable = new Set<string>();
	const queue: string[] = [];
	collectReferences(operations, queue);
	collectSecurityNames(operations, queue);
	while (queue.length > 0) {
		const key = queue.shift();
		if (!key || reachable.has(key) || !(key in flattened)) continue;
		reachable.add(key);
		collectReferences(flattened[key], queue);
	}
	const grouped: Record<string, Record<string, unknown>> = {};
	for (const key of [...reachable].sort()) {
		const slash = key.indexOf("/");
		const group = key.slice(0, slash);
		const name = key.slice(slash + 1);
		if (!grouped[group]) grouped[group] = {};
		grouped[group][name] = flattened[key];
	}
	return sortRecord(grouped);
}

function collectReferences(value: unknown, queue: string[]): void {
	if (Array.isArray(value)) {
		for (const item of value) collectReferences(item, queue);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (key === "$ref" && typeof item === "string") {
			const match = item.match(/^#\/(definitions|parameters|responses)\/([^/]+)$/);
			if (match) queue.push(`${match[1]}/${decodePointer(match[2])}`);
		}
		collectReferences(item, queue);
	}
}

function collectSecurityNames(value: unknown, queue: string[]): void {
	if (Array.isArray(value)) {
		for (const item of value) collectSecurityNames(item, queue);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (key === "security" && Array.isArray(item)) {
			for (const requirement of item) {
				if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) continue;
				for (const name of Object.keys(requirement as Record<string, unknown>)) queue.push(`securityDefinitions/${name}`);
			}
		}
		collectSecurityNames(item, queue);
	}
}

function decodePointer(value: string): string {
	return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function cleanSemantic(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(cleanSemantic).sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
	if (!value || typeof value !== "object") return value;
	const cleaned: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		if (NON_SEMANTIC_KEYS.has(key) || (key.startsWith("x-") && !SEMANTIC_VENDOR_KEYS.has(key))) continue;
		cleaned[key] = cleanSemantic((value as Record<string, unknown>)[key]);
	}
	return cleaned;
}

function sortRecord(record: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
}

function flattenComponents(baseline: OpenApiBaseline): Record<string, unknown> {
	const flattened: Record<string, unknown> = {};
	for (const [group, rawEntries] of Object.entries(baseline.components)) {
		if (!rawEntries || typeof rawEntries !== "object" || Array.isArray(rawEntries)) {
			flattened[group] = rawEntries;
			continue;
		}
		for (const [name, value] of Object.entries(rawEntries as Record<string, unknown>)) flattened[`${group}/${name}`] = value;
	}
	return flattened;
}

function compareRecords(baseline: Record<string, unknown>, live: Record<string, unknown>): { added: string[]; removed: string[]; changed: string[] } {
	const baselineKeys = new Set(Object.keys(baseline));
	const liveKeys = new Set(Object.keys(live));
	return {
		added: [...liveKeys].filter((key) => !baselineKeys.has(key)).sort(),
		removed: [...baselineKeys].filter((key) => !liveKeys.has(key)).sort(),
		changed: [...baselineKeys].filter((key) => liveKeys.has(key) && stableStringify(baseline[key]) !== stableStringify(live[key])).sort(),
	};
}

function compareOperations(baseline: Record<string, unknown>, live: Record<string, unknown>): { added: string[]; removed: string[]; additive: string[]; breaking: string[]; review: string[] } {
	const records = compareRecords(baseline, live);
	const additive: string[] = [];
	const breaking: string[] = [];
	const review: string[] = [];
	for (const key of records.changed) {
		const compatibility = classifyOperationChange(baseline[key], live[key]);
		if (compatibility === "additive") additive.push(key);
		else if (compatibility === "breaking") breaking.push(key);
		else review.push(key);
	}
	return { added: records.added, removed: records.removed, additive, breaking, review };
}

function classifyOperationChange(before: unknown, after: unknown): "additive" | "breaking" | "review" {
	if (!isRecord(before) || !isRecord(after)) return "review";
	const beforeParameters = parameterMap(before.parameters);
	const afterParameters = parameterMap(after.parameters);
	let additive = false;
	for (const [key, parameter] of beforeParameters) {
		if (!afterParameters.has(key)) return "breaking";
		if (stableStringify(parameter) !== stableStringify(afterParameters.get(key))) return "breaking";
	}
	for (const [key, parameter] of afterParameters) {
		if (beforeParameters.has(key)) continue;
		if (isRecord(parameter) && parameter.required === true) return "breaking";
		additive = true;
	}
	const beforeRest = { ...before };
	const afterRest = { ...after };
	delete beforeRest.parameters;
	delete afterRest.parameters;
	if (stableStringify(beforeRest) === stableStringify(afterRest)) return additive ? "additive" : "review";
	for (const key of ["security", "x-atlassian-auth-types", "x-atlassian-oauth2-scopes"]) {
		if (stableStringify(beforeRest[key]) !== stableStringify(afterRest[key])) return "breaking";
	}
	const responseCompatibility = classifyKeySet(beforeRest.responses, afterRest.responses);
	if (responseCompatibility === "breaking") return "breaking";
	if (responseCompatibility === "additive" && onlyChangedKey(beforeRest, afterRest, "responses")) return "additive";
	for (const key of ["consumes", "produces", "schemes"]) {
		const classification = classifyArrayExpansion(beforeRest[key], afterRest[key]);
		if (classification === "breaking") return "breaking";
		if (classification === "additive" && onlyChangedKey(beforeRest, afterRest, key)) return "additive";
	}
	return "review";
}

function parameterMap(value: unknown): Map<string, unknown> {
	const result = new Map<string, unknown>();
	if (!Array.isArray(value)) return result;
	for (const parameter of value) {
		if (!isRecord(parameter)) continue;
		const identity = typeof parameter.name === "string" && typeof parameter.in === "string"
			? `${parameter.in}\u0000${parameter.name}`
			: typeof parameter.$ref === "string" ? `$ref\u0000${parameter.$ref}` : stableStringify(parameter);
		result.set(identity, parameter);
	}
	return result;
}

function classifyKeySet(before: unknown, after: unknown): "same" | "additive" | "breaking" | "review" {
	if (!isRecord(before) || !isRecord(after)) return stableStringify(before) === stableStringify(after) ? "same" : "review";
	for (const key of Object.keys(before)) {
		if (!(key in after)) return "breaking";
		if (stableStringify(before[key]) !== stableStringify(after[key])) return "review";
	}
	return Object.keys(after).some((key) => !(key in before)) ? "additive" : "same";
}

function classifyArrayExpansion(before: unknown, after: unknown): "same" | "additive" | "breaking" | "review" {
	if (!Array.isArray(before) || !Array.isArray(after)) return stableStringify(before) === stableStringify(after) ? "same" : "review";
	const beforeSet = new Set(before.map(stableStringify));
	const afterSet = new Set(after.map(stableStringify));
	if ([...beforeSet].some((value) => !afterSet.has(value))) return "breaking";
	return [...afterSet].some((value) => !beforeSet.has(value)) ? "additive" : "same";
}

function onlyChangedKey(before: Record<string, unknown>, after: Record<string, unknown>, allowed: string): boolean {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	return [...keys].every((key) => key === allowed || stableStringify(before[key]) === stableStringify(after[key]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundDrift(full: Omit<OpenApiDrift, "totals" | "truncated">): OpenApiDrift {
	const totals: Record<string, number> = {};
	let truncated = false;
	const bounded = Object.fromEntries(Object.entries(full).map(([key, entries]) => {
		totals[key] = entries.length;
		if (entries.length > DRIFT_SAMPLE_LIMIT) truncated = true;
		return [key, entries.slice(0, DRIFT_SAMPLE_LIMIT)];
	})) as unknown as Omit<OpenApiDrift, "totals" | "truncated">;
	return { ...bounded, totals, truncated };
}

function validateBaseline(value: OpenApiBaseline): void {
	if (value.contract_id !== "bitbucket.openapi-baseline" || value.schema_version !== "1") throw new Error("OpenAPI baseline contract is unsupported.");
	if (!value.operations || typeof value.operations !== "object" || !value.components || typeof value.components !== "object") throw new Error("OpenAPI baseline is incomplete.");
}

function digestBaseline(value: OpenApiBaseline): string {
	return createHash("sha256").update(stableStringify({ swagger: value.swagger, base_path: value.base_path, operations: value.operations, components: value.components })).digest("hex");
}

function stableStringify(value: unknown): string {
	if (value === undefined) return "undefined";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (!value || typeof value !== "object") return JSON.stringify(value);
	return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function breakingFingerprint(drift: Omit<OpenApiDrift, "totals" | "truncated">, baseline: OpenApiBaseline, live: OpenApiBaseline): string {
	const changedOperations = Object.fromEntries(drift.changed_operations.map((key) => [key, { before: baseline.operations[key], after: live.operations[key] }]));
	const baselineComponents = flattenComponents(baseline);
	const liveComponents = flattenComponents(live);
	const changedComponents = Object.fromEntries(drift.changed_components.map((key) => [key, key === "contract_metadata"
		? {
			before: { swagger: baseline.swagger, base_path: baseline.base_path },
			after: { swagger: live.swagger, base_path: live.base_path },
		}
		: { before: baselineComponents[key], after: liveComponents[key] }]));
	return createHash("sha256").update(stableStringify({
		removed_operations: Object.fromEntries(drift.removed_operations.map((key) => [key, baseline.operations[key]])),
		changed_operations: changedOperations,
		removed_components: Object.fromEntries(drift.removed_components.map((key) => [key, baselineComponents[key]])),
		changed_components: changedComponents,
	})).digest("hex");
}

function buildIssueDraft(drift: OpenApiDrift, baselineDigest: string, liveDigest: string, fingerprint: string): DriftIssueDraft {
	const dedupeKey = `bitbucket-openapi-drift:${fingerprint.slice(0, 24)}`;
	const lines = [
		"Atlassian's canonical Bitbucket Cloud Swagger contract has breaking semantic drift.",
		"",
		`Dedupe key: ${dedupeKey}`,
		`Source: ${BITBUCKET_OPENAPI_URL}`,
		`Baseline digest: ${baselineDigest}`,
		`Live digest: ${liveDigest}`,
		"",
		...renderIssueSection("Removed operations", drift.removed_operations, drift.totals.removed_operations),
		...renderIssueSection("Changed operations", drift.changed_operations, drift.totals.changed_operations),
		...renderIssueSection("Removed components", drift.removed_components, drift.totals.removed_components),
		...renderIssueSection("Changed components", drift.changed_components, drift.totals.changed_components),
		"",
		"Generated by `bb doctor openapi`. Review the bounded doctor evidence before accepting a new baseline.",
	];
	return { dedupe_key: dedupeKey, title: "Bitbucket OpenAPI breaking drift detected", body: lines.join("\n") };
}

function renderIssueSection(title: string, entries: string[], total: number): string[] {
	if (total === 0) return [];
	const bounded = entries.slice(0, 20);
	return [
		`## ${title}`,
		...bounded.map((entry) => `- \`${entry.replaceAll("`", "'")}\``),
		...(total > bounded.length ? [`- ${total - bounded.length} more omitted from this draft`] : []),
		"",
	];
}
