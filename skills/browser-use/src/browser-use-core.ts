// ---------------------------------------------------------------------------
// Browser Use shared core (the keystone leaf).
//
// Substrate used by 3+ region modules (discovery, selection, operations,
// parser, driver). Every cross-region type edge points down into this leaf, so
// the region modules never import each other sideways. Houses: the generic
// Failure<A> shape, OutputMode/ResultKind, the exit-code constants, JSON
// guards, the privacy redaction gate (R32), deterministic id-hashing, the
// RawPage projection into a display-safe candidate, TargetHints +
// candidateMatchesHints, and the action-id registry lookup.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import type {
	CommandFacadeSideEffect,
	RuntimeActionGuidance,
} from "@side-quest/cli-command-facade";
import {
	type BrowserAdapterId,
	type BrowserTargetCandidate,
	type TargetDiscoveryMode,
	BROWSER_USE_LIVE_ADAPTERS,
} from "./discovery-model";

// --- Exit codes ------------------------------------------------------------

export const BINDING_FAIL_CLOSED_EXIT_CODE = 20;
export const RUNTIME_FAILURE_EXIT_CODE = 1;
export const USAGE_EXIT_CODE = 2;
export const NOT_IMPLEMENTED_EXIT_CODE = 1;
export const TARGET_DISCOVERY_EXIT_CODE = 20;
export const TARGET_SELECTION_EXIT_CODE = 20;

// --- Output + result shapes ------------------------------------------------

export type OutputMode = "json" | "plain";

export type ResultKind =
	| "guide"
	| "browser_targets"
	| "browser_operation"
	| "task_intents"
	| "adapter_lanes"
	| "shared_run"
	| "runbook_catalog"
	| "reviewed_action"
	| "migration_status"
	| "artifact_manifest"
	| "repair_status"
	| "auth_readiness";

// Generic structured failure carried by every region surface. Each surface
// narrows the action-id type parameter to its own union.
export type Failure<A extends string> = {
	code: string;
	message: string;
	actionId: A;
	exitCode: number;
	recoverability: "change_input" | "retry" | "repair_state" | "none";
};

// --- JSON guards -----------------------------------------------------------

export function isBrowserAdapterId(value: unknown): value is BrowserAdapterId {
	return (
		typeof value === "string" &&
		(BROWSER_USE_LIVE_ADAPTERS as readonly string[]).includes(value)
	);
}

export function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

export function safeJsonObject(raw: string): Record<string, unknown> | undefined {
	try {
		const value = JSON.parse(raw);
		return isJsonObject(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Key-sorted canonical JSON that drops undefined-valued entries so optional
// fields never shift a digest. Receipt signing over fully-typed facts must NOT
// use this: absent-vs-undefined distinctions there are part of the signed bytes.
//
// Total and host-independent: key order uses codepoint comparison (localeCompare
// depends on ICU/host locale, so it can produce a different digest per machine),
// and every non-serializable leaf (a top-level or in-array `undefined`, function,
// or symbol) collapses to `null` so the result is always a string and `[undefined]`
// never collides with `[]`.
export function canonicalJsonStable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJsonStable).join(",")}]`;
	if (typeof value === "object" && value !== null)
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJsonStable(entry)}`)
			.join(",")}}`;
	const serialized = JSON.stringify(value);
	return serialized === undefined ? "null" : serialized;
}

// --- Privacy redaction gate (R32) ------------------------------------------

export function sanitizeUsageValue(value: string): string {
	if (
		value.startsWith("/") ||
		value.startsWith("~/") ||
		value.startsWith("op://") ||
		hasSensitiveOptionName(value)
	) {
		return "[redacted]";
	}
	return redactUnsafeText(value);
}

export function redactUnsafeText(value: string): string {
	return value
		.replace(/\bop:\/\/\S+/gi, "[redacted]")
		.replace(/--[A-Za-z0-9][\w-]*(?:=\S*)?/g, (match) =>
			hasSensitiveOptionName(match) ? "[redacted]" : match,
		)
		.replace(/(^|[\s:(])(?:~\/|\/)\S+/g, "$1[redacted]");
}

export function hasSensitiveOptionName(value: string): boolean {
	return /(?:password|passwd|passphrase|secret|token|api[-_]?key|credential|auth|cookie|session)/i.test(
		value,
	);
}

// Titles are author-controlled semantic hints (R22), but document.title can
// mirror a URL with a query string or fragment (OAuth callbacks, SPA routers,
// error pages). Defensively drop any query/fragment tail before length-bounding,
// so a title carrying ?token=… or #frag cannot leak through the privacy gate
// (R32) the way url path_shape is already protected.
export function redactTitle(title: string | undefined): string | undefined {
	if (!title) return undefined;
	// A page title is fully page-controlled, so it can carry terminal-injection
	// bytes: C0 controls incl. ESC (0x1b) that begin ANSI sequences, BEL (0x07),
	// DEL (0x7f), and the C1 range 0x80-0x9f incl. the single-byte CSI (0x9b).
	// JSON.stringify escapes C0 but passes DEL and C1 through raw, so a naive
	// length-bound leaks them onto stdout (DDA-D29). Strip every control byte
	// before any other processing; keep only display-safe text.
	const controlStripped = stripControlChars(title);
	const stripped = controlStripped.replace(/[?#]\S*/g, "").trim();
	return stripped === "" ? undefined : truncateText(stripped, 80);
}

// Remove C0 (0x00-0x1f), DEL (0x7f), and C1 (0x80-0x9f) control bytes so no raw
// control char or ANSI escape reaches stdout through a page-controlled string.
export function stripControlChars(value: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-byte strip
	return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

/**
 * Validate a structural postcondition selector BEFORE any target selection or
 * mutation (review 2026-07-27 #6). One validator shared by the public flag
 * boundary (`--expect-visible`) and the executor's pre-dispatch task guard, so
 * malformed proof input can never convert into a real mutation that only fails
 * during post-click verification.
 *
 * @param selector - Candidate CSS selector for a structural postcondition
 * @returns A refusal reason, or undefined when the selector is admissible
 */
export function postconditionSelectorIssue(
	selector: string,
): string | undefined {
	const trimmed = selector.trim();
	if (trimmed.length === 0) return "selector is empty after trimming";
	if (selector.length > 2_048) return "selector exceeds 2048 characters";
	if (stripControlChars(selector) !== selector) {
		return "selector contains control characters";
	}
	if (trimmed.startsWith("@")) {
		return "selector must be a CSS selector, never a snapshot ref";
	}
	return undefined;
}

// Only http(s) Browser Targets are navigable pages. Other schemes — ws:// (the
// WebSocket debugger), devtools://, chrome://, file:// — are adapter transport
// plumbing or non-navigable surfaces, never a public Browser Target. Treating
// them as unparsable keeps WebSocket debugger URLs and devtools handles out of
// the candidate origin/path entirely (R32 privacy gate).
export function parseUrlSafe(value: string | undefined): URL | undefined {
	if (!value) return undefined;
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

// Redacted path shape (R32, AE11): a structural projection of the pathname, not
// the literal segments. Query strings and fragments are dropped entirely (an
// opaque marker records that one existed); each path segment is replaced with a
// type token when it looks like an identifier or secret (numeric id, UUID,
// opaque hex/long token), so reset links, invite codes, and opaque ids never
// leak. Short readable words are kept as semantic hints. Depth is capped.
const PATH_SHAPE_MAX_SEGMENTS = 6;

export function redactPathShape(parsed: URL): string {
	const segments = parsed.pathname.split("/").filter((s) => s !== "");
	const shaped = segments
		.slice(0, PATH_SHAPE_MAX_SEGMENTS)
		.map(shapePathSegment);
	if (segments.length > PATH_SHAPE_MAX_SEGMENTS) shaped.push("…");
	const path = shaped.length === 0 ? "/" : `/${shaped.join("/")}`;
	const marker = parsed.search !== "" || parsed.hash !== "" ? " […]" : "";
	return `${truncateText(path, 120)}${marker}`;
}

// Map one path segment to a type token when it carries identifier/secret shape,
// otherwise keep a short readable literal. Errs toward redaction: a segment that
// mixes letters and digits, or is long, reads as an opaque handle and is shaped
// rather than echoed. Only pure readable words survive as semantic hints.
function shapePathSegment(segment: string): string {
	const decoded = safeDecode(segment);
	if (/^\d+$/.test(decoded)) return ":num";
	if (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded)
	) {
		return ":uuid";
	}
	// Anything with a non-word character (encoded bytes, separators beyond . _ -)
	// is opaque.
	if (/[^a-zA-Z0-9._-]/.test(decoded)) return ":str";
	// A segment mixing letters and digits is an identifier/handle (invite codes,
	// short ids, hex blobs), not a readable noun; shape it.
	if (/\d/.test(decoded) && /[a-zA-Z]/.test(decoded)) return ":id";
	// Long pure-letter segment is more likely an opaque token than a word.
	if (decoded.length > 24) return ":id";
	return decoded;
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function truncateText(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

// --- Raw page projection ----------------------------------------------------

// `type` is the CDP target kind from a `/json/list`-shaped listing (page /
// service_worker / background_page / iframe / other). A service worker or
// extension background page can carry an http(s) `url`, so scheme-filtering
// alone would wrongly admit it; the discovery filter drops any non-`page` type
// (R32, DDA-D28). Absent on the chrome-devtools-mcp text envelope and the older
// `{pages:[…]}` fakes, so an absent type is treated as a navigable page.
export type RawPage = { id?: string; title?: string; url?: string; type?: string };

// Project one raw adapter page into a display-safe Browser Target Candidate. The
// raw id is used only to derive a per-envelope candidate id (hashed, never
// surfaced); origin/path_shape/title are redaction-gated. No query string,
// fragment, raw page id, or CDP target id survives into the candidate.
export function toCandidate(
	page: RawPage,
	index: number,
	targetEnvelopeId: string,
	showUrl: boolean,
): BrowserTargetCandidate {
	const ordinal = index + 1;
	const parsed = parseUrlSafe(page.url);
	const title = redactTitle(page.title);
	return {
		candidate_ordinal: ordinal,
		candidate_id: candidateIdOf(targetEnvelopeId, candidateIdentityOf(page, ordinal)),
		origin: parsed?.origin ?? "",
		...(showUrl && parsed ? { path_shape: redactPathShape(parsed) } : {}),
		...(title ? { title } : {}),
	};
}

function candidateIdentityOf(page: RawPage, ordinal: number): unknown[] {
	const pageId = stringField(page.id);
	if (pageId) return ["adapter_page_id", pageId];
	const parsed = parseUrlSafe(page.url);
	return [
		"display_fallback",
		parsed?.origin ?? "",
		parsed?.pathname ?? "",
		redactTitle(page.title) ?? "",
		ordinal,
	];
}

// --- Deterministic ids -----------------------------------------------------

// Handoff evidence id (KTD1): browser-use's content hash over the Verified
// Handoff Envelope's binding-relevant fields. The envelope is minted by the
// one process that performed both the environment proof and the adapter
// attachment probe, so hashing its fields binds discovery, selection, and
// operations to that single verified attachment — the envelope-era analogue
// of the Router-era proof-id/route-hash tuple. The websocket endpoint form
// participates in the hash but is never re-emitted (R32).
export function handoffEvidenceIdOf(input: {
	runId: string;
	// Named logical environment/profile identity (schema 2, KTD13): part of the
	// binding-relevant field set, so a profile change yields new evidence — a
	// run bound to one profile can never silently consume another's handoff.
	environmentName: string;
	environmentProfile: string;
	attachmentAdapterId: string;
	route: string;
	endpointHttp: string;
	endpointWs: string;
	proofContractId: string;
	proofSchemaVersion: string;
}): string {
	const canonical = JSON.stringify([
		input.runId,
		input.environmentName,
		input.environmentProfile,
		input.attachmentAdapterId,
		input.route,
		input.endpointHttp,
		input.endpointWs,
		input.proofContractId,
		input.proofSchemaVersion,
	]);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

// Target envelope id scopes candidate ordinals (R21). Content hash over the
// run-scoped binding facts; no clock or randomness. handoff_evidence_id
// already folds in the endpoint identity and attachment fields (it is itself a
// hash of them), so they are covered transitively. In handoff-bound mode runId
// is the envelope's run id, so the same handoff reproduces the same envelope
// id; in recovery mode runId is per-invocation, scoping ordinals within one
// listing.
export function targetEnvelopeIdOf(input: {
	runId: string;
	mode: TargetDiscoveryMode;
	adapter: BrowserAdapterId;
	handoffEvidenceId: string | undefined;
}): string {
	const canonical = JSON.stringify([
		input.runId,
		input.mode,
		input.adapter,
		input.handoffEvidenceId ?? null,
	]);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export function candidateIdOf(targetEnvelopeId: string, identity: unknown[]): string {
	const canonical = JSON.stringify([targetEnvelopeId, identity]);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

// --- Target hints (selector + operation-time resolution) -------------------

export type TargetHints = {
	origin?: string;
	urlContains?: string;
	titleContains?: string;
};

export function candidateMatchesHints(
	candidate: BrowserTargetCandidate,
	hints: TargetHints,
): boolean {
	if (
		hints.origin !== undefined &&
		candidate.origin.toLowerCase() !== hints.origin.toLowerCase()
	) {
		return false;
	}
	if (hints.urlContains !== undefined) {
		const haystack = `${candidate.origin}${candidate.path_shape ?? ""}`.toLowerCase();
		if (!haystack.includes(hints.urlContains.toLowerCase())) return false;
	}
	if (hints.titleContains !== undefined) {
		const title = (candidate.title ?? "").toLowerCase();
		if (!title.includes(hints.titleContains.toLowerCase())) return false;
	}
	return true;
}

// --- Action-id registry lookup ---------------------------------------------

export function actionFor(
	map: Map<
		string,
		{
			id: string;
			summary: string;
			sideEffects: readonly CommandFacadeSideEffect[];
		}
	>,
	id: string,
	label: string,
): RuntimeActionGuidance {
	const action = map.get(id);
	if (!action) {
		throw new Error(`Unknown ${label} action id: ${id}`);
	}
	return {
		id: action.id,
		summary: action.summary,
		side_effects: [...action.sideEffects],
	};
}
