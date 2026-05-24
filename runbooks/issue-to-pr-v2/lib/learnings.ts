/**
 * Workflow Learnings registry: parse + schema validation (issue #90, AC2).
 *
 * The registry is a human-readable Markdown doc with a SINGLE fenced yaml
 * block (`references/workflow-learnings-registry.md`, scaffolded by the
 * `registry-file` batch). This module reads that block, parses it, and
 * validates each learning entry against the closed schema fixed by PRD #88
 * and documented in the registry reference.
 *
 * Scope of THIS batch: `parseRegistry` (single-block extraction + parse) and
 * `validateRegistry` (required fields + the four closed enums). Candidate-file
 * ingestion, upsert/dedupe, canonical-overwrite protection, and write-scope
 * enforcement land in later batches and are intentionally absent here.
 *
 * Enum constants follow the `lib/contract.ts` style: an `as const` array as
 * the single source of truth, with a derived union type. They are exported so
 * later batches (and tests) validate against the same closed sets.
 */

import { readFileSync } from "node:fs";

import { sha256Digest } from "./digest";

/** Workflow surface that owns the fix for a learning. */
export const OWNERS = [
  "skill-link",
  "runbook-reference",
  "cli-observability",
  "workflow-contract",
  "gotchas-guide",
] as const;
export type Owner = (typeof OWNERS)[number];

/** What we decided to do about a learning. */
export const DISPOSITIONS = [
  "small-fix",
  "file-follow-up",
  "ignore",
  "already-covered",
  "needs-evidence",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/** Where the learning sits in its lifecycle. */
export const STATUSES = ["open", "filed", "resolved", "retired"] as const;
export type Status = (typeof STATUSES)[number];

/** How sure we are the learning is real and actionable. */
export const CONFIDENCES = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** A parsed registry: the documented shape is `{ learnings: Entry[] }`. */
export interface Registry {
  learnings: unknown[];
}

/** The required scalar/string fields every entry must carry. */
const REQUIRED_STRING_FIELDS = [
  "summary",
  "owner",
  "retirement_condition",
  "signature",
  "disposition",
  "status",
  "confidence",
] as const;

/**
 * Closed set of allowed evidence-record keys, fixed by PRD #88 and documented
 * in `references/workflow-learnings-registry.md` ("Append-only evidence"). The
 * hand-rolled emitter writes mapping keys verbatim, so an unknown or
 * YAML-special key would corrupt the on-disk yaml block; pinning the schema at
 * candidate-ingestion time means a bad key is rejected with an actionable
 * error BEFORE it reaches upsert or the serializer. Not every key has to be
 * present on a given run (the PRD lets a run capture only what is known).
 */
const ALLOWED_EVIDENCE_KEYS = [
  "run",
  "affected_surface",
  "what_was_wrong",
  "discovery_method",
  "root_cause",
  "scope",
  "proposed_fix",
  "verification_idea",
] as const;

/** The four closed-enum fields and their allowed-value sets, in schema order. */
const ENUM_FIELDS: ReadonlyArray<{
  field: "owner" | "disposition" | "status" | "confidence";
  allowed: readonly string[];
}> = [
  { field: "owner", allowed: OWNERS },
  { field: "disposition", allowed: DISPOSITIONS },
  { field: "status", allowed: STATUSES },
  { field: "confidence", allowed: CONFIDENCES },
];

/**
 * Read the registry Markdown at `path`, extract its SINGLE fenced yaml block,
 * parse it, and return the parsed `{ learnings }` object.
 *
 * The fenced-block scan mirrors `lib/ledger.ts` (the same
 * `/```yaml[^\n]*\n([\s\S]*?)```/gi` regex) so the registry and the ledger
 * agree on what a "fenced yaml block" is. The registry contract requires
 * EXACTLY one such block, so this throws an actionable `Error` (naming the
 * file) when:
 *
 * - the file cannot be read,
 * - no fenced yaml block is present,
 * - more than one fenced yaml block is present, or
 * - the parsed shape has no `learnings` array.
 *
 * Throwing (rather than `fail()`/`process.exit`) keeps this importable and
 * testable; the thin dispatcher (`learnings-registry.ts`) catches and maps
 * to an exit code, matching how `cli.ts` wraps `lib/ledger.ts` validators.
 */
export function parseRegistry(path: string): Registry {
  let src: string;
  try {
    src = readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read registry ${path}: ${message}`);
  }
  return parseRegistryFromString(src, path);
}

/**
 * Parse a registry from an in-memory Markdown string, applying the same
 * single-fenced-yaml-block contract as `parseRegistry`. `originLabel` is used
 * only to name the source in actionable error messages (a file path for
 * on-disk parses, a synthetic label like `"<serialized-registry>"` for the
 * dispatcher's pre-write re-validate gate).
 *
 * Factored out so the `--upsert` dispatcher can re-parse the bytes it is
 * about to write WITHOUT going through disk, closing the defect where a
 * faulty emitter could silently corrupt the registry (F24).
 */
export function parseRegistryFromString(
  src: string,
  originLabel: string,
): Registry {
  // The closing fence must be a line that STARTS with the triple-backtick at
  // column 0 (multiline `^...$`), so a triple-backtick that appears INSIDE a
  // yaml scalar value (e.g. a learning whose summary references a fenced code
  // block, which is necessarily indented under the scalar) does not
  // prematurely truncate the captured block. The registry's single yaml block
  // is always emitted with its fences at column 0.
  const blocks = [
    ...src.matchAll(/^```yaml[^\n]*\n([\s\S]*?)\n^```[ \t]*$/gim),
  ].map((match) => match[1]);
  if (blocks.length === 0) {
    throw new Error(`no fenced yaml block found in registry ${originLabel}`);
  }
  if (blocks.length > 1) {
    throw new Error(
      `registry ${originLabel} must contain a single fenced yaml block, found ${blocks.length}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(blocks[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `registry ${originLabel} yaml block did not parse: ${message}`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { learnings?: unknown }).learnings)
  ) {
    throw new Error(
      `registry ${originLabel} yaml block has no "learnings" array at the top level`,
    );
  }

  return { learnings: (parsed as { learnings: unknown[] }).learnings };
}

/**
 * Validate every entry in `registry.learnings` against the closed schema and
 * return a list of actionable error strings (empty = valid).
 *
 * Each entry must carry every required string field
 * (`summary`, `owner`, `retirement_condition`, `signature`, `disposition`,
 * `status`, `confidence`) plus an `evidence` array, and each of the four enum
 * fields (`owner`, `disposition`, `status`, `confidence`) must be a member of
 * its allowed set. Every error names the offending entry (by `signature` when
 * present, otherwise by index) and the field; enum errors also list the
 * allowed values so the message is self-correcting.
 *
 * Out of scope for this batch (handled later): per-evidence-record field
 * validation, candidate ingestion, and upsert/dedupe semantics.
 */
export function validateRegistry(registry: Registry): string[] {
  const errors: string[] = [];

  registry.learnings.forEach((rawEntry, index) => {
    const label = entryLabel(rawEntry, index);

    if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) {
      errors.push(`${label}: entry must be a mapping of fields`);
      return;
    }
    const entry = rawEntry as Record<string, unknown>;

    for (const field of REQUIRED_STRING_FIELDS) {
      const value = entry[field];
      if (typeof value !== "string" || value.length === 0) {
        errors.push(
          `${label}: missing required field "${field}" (expected a non-empty string)`,
        );
      }
    }

    if (!Array.isArray(entry.evidence)) {
      errors.push(
        `${label}: missing required field "evidence" (expected a list of evidence records)`,
      );
    }

    // A non-string/missing enum value is already reported by the required-field
    // pass above; the shared helper only flags violations when a string present.
    checkEnumFields(entry, errors, label);
  });

  return errors;
}

/**
 * Push an enum-violation error for `field` onto `errors` when `value` is a
 * present string outside `allowed`. A missing/non-string value is the caller's
 * required-field concern, so this stays silent in that case. `label` prefixes
 * the message ("" for a top-level candidate; `learning #N`/`learning "sig"` for
 * a registry entry) so both validators read identically.
 *
 * Shared by `validateRegistry` and `validateCandidate` because the four closed
 * enums (owner/disposition/status/confidence) are identical across the registry
 * entry and the candidate shape.
 */
function checkEnumFields(
  entry: Record<string, unknown>,
  errors: string[],
  label: string,
): void {
  const prefix = label ? `${label}: ` : "";
  for (const { field, allowed } of ENUM_FIELDS) {
    const value = entry[field];
    if (typeof value === "string" && !allowed.includes(value)) {
      errors.push(
        `${prefix}field "${field}" has invalid value "${value}"; allowed values are ${allowed.join(", ")}`,
      );
    }
  }
}

/**
 * Read a candidate learning file at `path` and return its parsed (unvalidated)
 * shape. A candidate is one incoming learning observation destined for upsert
 * (the upsert-op batch); this batch only ingests and shape-checks it.
 *
 * The parser is selected by file extension:
 *
 * - `.json` → `JSON.parse`
 * - `.yaml` / `.yml` → `Bun.YAML.parse`
 * - any other extension → throw an actionable `Error` naming the file and the
 *   unsupported extension.
 *
 * Read + parse failures are caught and re-thrown as an actionable `Error` that
 * NAMES THE FILE and carries the underlying message, mirroring how
 * `parseRegistry` wraps its read/parse errors so a raw `SyntaxError` never
 * escapes. Throwing (rather than `fail()`/`process.exit`) keeps this importable
 * and testable; a later dispatcher maps the throw to an exit code.
 */
export function loadCandidate(path: string): unknown {
  const lowerPath = path.toLowerCase();
  const isJson = lowerPath.endsWith(".json");
  const isYaml = lowerPath.endsWith(".yaml") || lowerPath.endsWith(".yml");
  if (!isJson && !isYaml) {
    const dot = path.lastIndexOf(".");
    const ext = dot >= 0 ? path.slice(dot) : "(none)";
    throw new Error(
      `candidate ${path} has unsupported extension "${ext}"; expected .json, .yaml, or .yml`,
    );
  }

  let src: string;
  try {
    src = readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read candidate ${path}: ${message}`);
  }

  try {
    return isJson ? JSON.parse(src) : Bun.YAML.parse(src);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`candidate ${path} did not parse: ${message}`);
  }
}

/**
 * Validate the SHAPE of one ingested candidate and return a list of actionable
 * error strings (empty = valid). A candidate mirrors a registry entry but
 * carries the SINGLE run's evidence as one `evidence` record object (the
 * upsert-op batch appends that record to the entry's append-only `evidence`
 * list), and adds an optional per-candidate `canonical_update` directive.
 *
 * Rules:
 *
 * - The candidate must be a non-null, non-array object.
 * - The required string fields `summary`, `owner`, `retirement_condition`,
 *   `disposition`, `status`, and `confidence` must be present non-empty strings.
 *   (`signature` is intentionally NOT required here.)
 * - `evidence` must be present as a single record object (not an array).
 * - Each closed-enum field must be a member of its allowed set.
 * - `signature` is OPTIONAL (derivation is the upsert-op batch); if present it
 *   must be a non-empty string.
 * - `canonical_update` is OPTIONAL; if present it must be a boolean.
 *
 * Enum and required-field messages match `validateRegistry`'s style so callers
 * present one consistent error vocabulary. Out of scope for this batch:
 * signature derivation, per-evidence-field validation, and upsert/dedupe.
 */
export function validateCandidate(candidate: unknown): string[] {
  const errors: string[] = [];

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return ["candidate must be a mapping of fields"];
  }
  const entry = candidate as Record<string, unknown>;

  // `signature` is required on a stored registry entry but OPTIONAL on a
  // candidate (it may be derived later), so it is excluded from this list.
  const requiredCandidateStrings = REQUIRED_STRING_FIELDS.filter(
    (field) => field !== "signature",
  );
  for (const field of requiredCandidateStrings) {
    const value = entry[field];
    if (typeof value !== "string" || value.length === 0) {
      errors.push(
        `candidate: missing required field "${field}" (expected a non-empty string)`,
      );
    }
  }

  // The candidate carries one run's evidence as a single record object; upsert
  // appends it to the entry's `evidence` list.
  const evidence = entry.evidence;
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    Array.isArray(evidence)
  ) {
    errors.push(
      `candidate: missing required field "evidence" (expected a single evidence record object)`,
    );
  } else {
    // Whitelist evidence-record keys. The emitter writes mapping keys
    // verbatim, so an unknown or YAML-special key would corrupt the yaml
    // body; rejecting here keeps validation upstream of upsert + serialize.
    for (const key of Object.keys(evidence as Record<string, unknown>)) {
      if (!(ALLOWED_EVIDENCE_KEYS as readonly string[]).includes(key)) {
        errors.push(
          `candidate: evidence record has unknown field "${key}"; allowed fields are ${ALLOWED_EVIDENCE_KEYS.join(", ")}`,
        );
      }
    }
  }

  checkEnumFields(entry, errors, "candidate");

  if (entry.signature !== undefined) {
    if (typeof entry.signature !== "string" || entry.signature.length === 0) {
      errors.push(
        `candidate: optional field "signature" must be a non-empty string when present`,
      );
    }
  }

  if (entry.canonical_update !== undefined) {
    if (typeof entry.canonical_update !== "boolean") {
      errors.push(
        `candidate: optional field "canonical_update" must be a boolean when present`,
      );
    }
  }

  return errors;
}

/** Name an entry by its `signature` when present, otherwise by 1-based index. */
function entryLabel(rawEntry: unknown, index: number): string {
  if (
    typeof rawEntry === "object" &&
    rawEntry !== null &&
    !Array.isArray(rawEntry)
  ) {
    const signature = (rawEntry as Record<string, unknown>).signature;
    if (typeof signature === "string" && signature.length > 0) {
      return `learning "${signature}"`;
    }
  }
  return `learning #${index + 1}`;
}

/** Canonical fields protected on upsert unless the candidate sets canonical_update. */
const CANONICAL_FIELDS = ["summary", "owner", "retirement_condition"] as const;

/** Lifecycle fields that always overwrite from the candidate on a match. */
const LIFECYCLE_FIELDS = [
  "disposition",
  "status",
  "confidence",
  "follow_up",
] as const;

/**
 * Return the candidate's dedupe signature.
 *
 * If the candidate carries an explicit non-empty `signature` string, that wins
 * (operators may pin a learning to a stable slug or pre-derived hash). Otherwise
 * a `sha256:<hex>` is derived deterministically from the three identifying
 * fields fixed by the plan's KTD4: `affected_surface` and `what_was_wrong`
 * from the candidate's `evidence` record, plus the candidate's `owner`. The
 * payload is canonical JSON (`JSON.stringify` of an object with keys in a fixed
 * order) so the same observation across runs always collides on one entry.
 *
 * Lifecycle fields (`status`, `disposition`, `confidence`, `follow_up`) are
 * intentionally excluded from the derivation: a learning is the same learning
 * whether it is `open` or `filed`. Likewise `summary` and `retirement_condition`
 * are excluded because two runs may phrase them differently while describing
 * the same observation.
 */
export function signatureFor(candidate: unknown): string {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    throw new Error("signatureFor: candidate must be a mapping of fields");
  }
  const entry = candidate as Record<string, unknown>;
  const explicit = entry.signature;
  if (typeof explicit === "string" && explicit.length > 0) {
    return explicit;
  }
  const evidence = entry.evidence;
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    Array.isArray(evidence)
  ) {
    throw new Error(
      `signatureFor: candidate is missing an evidence record needed to derive a signature`,
    );
  }
  const ev = evidence as Record<string, unknown>;
  const payload = JSON.stringify({
    affected_surface: typeof ev.affected_surface === "string" ? ev.affected_surface : "",
    what_was_wrong: typeof ev.what_was_wrong === "string" ? ev.what_was_wrong : "",
    owner: typeof entry.owner === "string" ? entry.owner : "",
  });
  return sha256Digest(payload);
}

/**
 * Pure-function upsert: merge one candidate observation into a registry and
 * return a NEW `Registry` (the input is not mutated).
 *
 * The candidate is validated FIRST (`validateCandidate`); an invalid candidate
 * throws an actionable `Error` with the joined error messages, so a bad input
 * can never corrupt the registry.
 *
 * Then `signatureFor(candidate)` resolves the dedupe key. If no existing entry
 * has that signature, a NEW entry is appended built from the candidate's fields
 * (lifecycle + canonical + signature) with its single `evidence` record wrapped
 * to an `evidence: [record]` list, because the registry stores evidence as an
 * append-only array but candidates carry one run's evidence as a single object.
 * The per-candidate `canonical_update` directive is NEVER stored on the entry.
 *
 * If an entry matches, three things happen:
 *
 * 1. The candidate's evidence record is APPENDED to the entry's `evidence`
 *    list (prior records retained in order).
 * 2. Lifecycle fields (`disposition`, `status`, `confidence`, `follow_up`)
 *    OVERWRITE from the candidate.
 * 3. Canonical fields (`summary`, `owner`, `retirement_condition`) are
 *    PRESERVED by default. Only when the candidate sets `canonical_update: true`
 *    are they replaced from the candidate. Divergence without the marker is
 *    silent (no error, no append outside the evidence list).
 */
export function upsert(registry: Registry, candidate: unknown): Registry {
  const validationErrors = validateCandidate(candidate);
  if (validationErrors.length > 0) {
    throw new Error(`upsert: candidate is invalid: ${validationErrors.join("; ")}`);
  }
  const cand = candidate as Record<string, unknown>;
  const sig = signatureFor(cand);
  const evidenceRecord = cand.evidence as Record<string, unknown>;
  const canonicalUpdate = cand.canonical_update === true;

  const next: unknown[] = [];
  let matched = false;
  for (const rawEntry of registry.learnings) {
    if (
      typeof rawEntry === "object" &&
      rawEntry !== null &&
      !Array.isArray(rawEntry) &&
      (rawEntry as Record<string, unknown>).signature === sig
    ) {
      matched = true;
      const existing = rawEntry as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...existing };

      // Append-only evidence: preserve prior order, append the new record.
      const priorEvidence = Array.isArray(existing.evidence)
        ? (existing.evidence as unknown[])
        : [];
      merged.evidence = [...priorEvidence, evidenceRecord];

      // Lifecycle fields always overwrite from the candidate.
      for (const field of LIFECYCLE_FIELDS) {
        if (field in cand) merged[field] = cand[field];
      }

      // Canonical fields: replace only when the candidate explicitly opts in.
      if (canonicalUpdate) {
        for (const field of CANONICAL_FIELDS) {
          if (field in cand) merged[field] = cand[field];
        }
      }

      // The per-candidate directive must never become a stored field.
      delete merged.canonical_update;
      next.push(merged);
    } else {
      next.push(rawEntry);
    }
  }

  if (!matched) {
    const created: Record<string, unknown> = {
      summary: cand.summary,
      owner: cand.owner,
      retirement_condition: cand.retirement_condition,
      signature: sig,
      disposition: cand.disposition,
      status: cand.status,
      confidence: cand.confidence,
    };
    // Preserve an explicit follow_up (including null) when present.
    if ("follow_up" in cand) created.follow_up = cand.follow_up;
    created.evidence = [evidenceRecord];
    next.push(created);
  }

  return { learnings: next };
}

/**
 * Read the registry Markdown at `registryPath` and return a NEW Markdown string
 * with ONLY the fenced yaml block's body replaced by the serialized `registry`.
 *
 * All surrounding prose (the document header, the schema description, the
 * canonical-overwrite rule, illustrative non-yaml fences) is preserved
 * verbatim, byte-for-byte, including the existing opening yaml fence info
 * string and the existing trailing characters. The yaml body is emitted in
 * block style by a constrained hand-emitter (`emitYaml`) whose output is
 * guaranteed to round-trip through `parseRegistry` + `validateRegistry`.
 *
 * The closing fence is required to be a triple-backtick at column 0 of its own
 * line (the validate-op fix anchors the parser to that), so any string value
 * containing a `` ``` `` sequence is emitted under a YAML scalar with a
 * column-1+ indent: the column-0 close anchor stays unambiguous and the parser
 * cannot truncate mid-block.
 *
 * This function does NOT write to disk; the caller is responsible for the write
 * so dispatch-level concerns (write-scope guard, atomic write) can be added in
 * a later batch without touching this serializer.
 */
export function serializeRegistry(
  registryPath: string,
  registry: Registry,
): string {
  let src: string;
  try {
    src = readFileSync(registryPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read registry ${registryPath}: ${message}`);
  }

  // Match the same fenced-yaml shape parseRegistry accepts: opening fence at
  // column 0, closing triple-backtick at column 0 on its own line. We capture
  // the opening fence line in full so its info string (e.g. "```yaml") is
  // preserved verbatim, replacing ONLY the body.
  const re = /(^```yaml[^\n]*\n)([\s\S]*?)(\n^```[ \t]*$)/gim;
  const matches = [...src.matchAll(re)];
  if (matches.length === 0) {
    throw new Error(`no fenced yaml block found in registry ${registryPath}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `registry ${registryPath} must contain a single fenced yaml block, found ${matches.length}`,
    );
  }
  const match = matches[0];
  const opening = match[1];
  const closing = match[3];
  const body = emitYaml(registry);
  const before = src.slice(0, match.index ?? 0);
  const after = src.slice((match.index ?? 0) + match[0].length);
  return `${before}${opening}${body}${closing}${after}`;
}

/**
 * Emit a Registry as block-style YAML whose output `parseRegistry` re-parses
 * losslessly. Constrained to the shapes the schema permits: a top-level
 * `learnings` list of mapping entries whose values are strings, numbers,
 * booleans, null, or (for `evidence`) a list of string-keyed mappings.
 *
 * Strings are emitted as double-quoted scalars with `\`, `"`, newline, tab,
 * and carriage-return escapes so a value containing a `` ``` `` sequence
 * appears at column 1+ of its parent line, never at column 0.
 */
function emitYaml(registry: Registry): string {
  const lines: string[] = [];
  if (registry.learnings.length === 0) {
    lines.push("learnings: []");
  } else {
    lines.push("learnings:");
    for (const rawEntry of registry.learnings) {
      if (
        typeof rawEntry !== "object" ||
        rawEntry === null ||
        Array.isArray(rawEntry)
      ) {
        throw new Error("emitYaml: every learning must be a mapping of fields");
      }
      const entry = rawEntry as Record<string, unknown>;
      const keys = Object.keys(entry);
      let first = true;
      for (const key of keys) {
        const value = entry[key];
        const indent = first ? "  - " : "    ";
        first = false;
        if (key === "evidence") {
          if (!Array.isArray(value)) {
            throw new Error(
              `emitYaml: "evidence" must be a list; got ${typeof value}`,
            );
          }
          lines.push(`${indent}evidence:`);
          for (const record of value as unknown[]) {
            if (
              typeof record !== "object" ||
              record === null ||
              Array.isArray(record)
            ) {
              throw new Error(
                `emitYaml: every evidence entry must be a mapping of fields`,
              );
            }
            const recEntries = Object.entries(record as Record<string, unknown>);
            let recFirst = true;
            for (const [rk, rv] of recEntries) {
              const recIndent = recFirst ? "      - " : "        ";
              recFirst = false;
              lines.push(`${recIndent}${rk}: ${emitScalar(rv)}`);
            }
          }
        } else {
          lines.push(`${indent}${key}: ${emitScalar(value)}`);
        }
      }
    }
  }
  return lines.join("\n");
}

/**
 * Render one YAML scalar. `null` becomes `null`; booleans render as `true`
 * or `false`; numbers render via `String`. Strings always render as a
 * double-quoted scalar so they cannot collide with YAML's special tokens
 * (yes/no/on/off, bare colons, leading dashes) and their backticks stay
 * indented under the parent line.
 *
 * Control characters (C0 range 0x00-0x1F, plus DEL 0x7F) are escaped so the
 * emitted scalar always round-trips through `Bun.YAML.parse`: a literal NUL
 * byte (U+0000) in particular crashes the parser on re-read and would
 * otherwise silently corrupt the registry. `\n`, `\r`, and `\t` keep their
 * familiar YAML escape sequences; every other control byte goes out as a
 * two-hex-digit `\xNN` escape (YAML's documented 8-bit unicode form).
 */
function emitScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") {
    let escaped = "";
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      const code = value.charCodeAt(i);
      if (ch === "\\") {
        escaped += "\\\\";
      } else if (ch === '"') {
        escaped += '\\"';
      } else if (code === 0x0a) {
        escaped += "\\n";
      } else if (code === 0x0d) {
        escaped += "\\r";
      } else if (code === 0x09) {
        escaped += "\\t";
      } else if (code <= 0x1f || code === 0x7f) {
        // YAML's double-quoted scalar accepts `\xNN` for 8-bit characters.
        escaped += `\\x${code.toString(16).padStart(2, "0")}`;
      } else {
        escaped += ch;
      }
    }
    return `"${escaped}"`;
  }
  // Fallback: stringify any unexpected shape so the failure is visible rather
  // than silently emitting an invalid YAML token. Upstream validation should
  // already have rejected anything that lands here.
  return JSON.stringify(value);
}
