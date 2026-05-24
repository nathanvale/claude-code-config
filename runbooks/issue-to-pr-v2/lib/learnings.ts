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

  const blocks = [...src.matchAll(/```yaml[^\n]*\n([\s\S]*?)```/gi)].map(
    (match) => match[1],
  );
  if (blocks.length === 0) {
    throw new Error(`no fenced yaml block found in registry ${path}`);
  }
  if (blocks.length > 1) {
    throw new Error(
      `registry ${path} must contain a single fenced yaml block, found ${blocks.length}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(blocks[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`registry ${path} yaml block did not parse: ${message}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { learnings?: unknown }).learnings)
  ) {
    throw new Error(
      `registry ${path} yaml block has no "learnings" array at the top level`,
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

    for (const { field, allowed } of ENUM_FIELDS) {
      const value = entry[field];
      // A non-string/missing value is already reported by the required-field
      // pass above; only flag the enum violation when a string is present.
      if (typeof value === "string" && !allowed.includes(value)) {
        errors.push(
          `${label}: field "${field}" has invalid value "${value}"; allowed values are ${allowed.join(", ")}`,
        );
      }
    }
  });

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
