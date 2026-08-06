#!/usr/bin/env bun
/**
 * apply-person-update.ts — Apply shared signal-style updates to a people note.
 *
 * This gives `capture` and `productivity-sync` the same safe bridge that
 * `/people-enrich` already has: resolve identity, build a structured patch,
 * and update `context/people/*.md` without freehand note edits.
 *
 * Usage:
 *   bun run apply-person-update.ts \
 *     --people-dir ~/code/my-second-brain/context/people \
 *     --slug melanie \
 *     --report update.json \
 *     --write
 *
 *   bun run apply-person-update.ts \
 *     --people-dir ~/code/my-second-brain/context/people \
 *     --title "Sarah Chen" \
 *     --source calendar \
 *     --handle sarah.chen@example.com \
 *     --report update.json \
 *     --create-if-missing \
 *     --write
 *
 * Report JSON shape:
 *   {
 *     "summary": "Optional retrieval summary",
 *     "signals": ["2026-03-22: Mentioned Easter lunch; source: iMessage"],
 *     "signal_mode": "append",
 *     "open_questions": ["Confirm exact job title after next catch-up."],
 *     "open_questions_mode": "append",
 *     "conflicts": ["Calendar says Example Co, messages suggest freelance."],
 *     "aliases": ["Bestie"],
 *     "source_handles": { "email": ["mel@example.com"] },
 *     "relationship_type": "partner",
 *     "related_people": ["person_levi"],
 *     "relationship_profile": [
 *       { "heading": "Relationship", "content": "Conservative H3 update." }
 *     ]
 *   }
 *
 * Review output shape:
 *   {
 *     "status": "review",
 *     "reason": "name-only-no-write",
 *     "candidates": []
 *   }
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { slugify } from "./lib";
import {
  applyPersonPatch,
  buildPersonPatch,
  extractIdentityCandidate,
  loadIdentityCandidates,
  parsePeopleNote,
  resolvePerson,
  type FrontmatterMap,
  type IdentityCandidate,
  type PersonPatch,
  type RelationshipBlock,
  type ResolvePersonQuery,
  type ResolvePersonResult,
  type SourceHandles,
} from "./people-note";

/** Shared structured update shape for non-enrichment producers. */
export type PersonUpdateReport = {
  summary?: string;
  relationship_profile?: RelationshipBlock[];
  signals?: string[];
  signal_mode?: "append" | "replace";
  open_questions?: string[];
  open_questions_mode?: "append" | "replace";
  conflicts?: string[];
  aliases?: string[];
  source_handles?: SourceHandles;
  relationship_type?: string;
  related_people?: string[];
};

/** Result of resolving or safely creating the target person note. */
export type ResolvePersonUpdateTargetResult =
  | {
      kind: "resolved";
      person: IdentityCandidate;
      notePath: string;
      existingContent: string | null;
      created: boolean;
      matchedBy: ResolvedMatchKind;
    }
  | {
      kind: "review";
      reason: Extract<ResolvePersonResult, { kind: "review" }>["reason"];
      candidates: IdentityCandidate[];
    };

type ResolvePersonUpdateTargetInput = {
  notePath?: string;
  peopleDir?: string;
  query: ResolvePersonQuery;
  report: PersonUpdateReport;
  createIfMissing?: boolean;
};

type ResolvedMatchKind = Extract<
  ResolvePersonResult,
  { kind: "resolved" }
>["matchedBy"];

/**
 * Convert a structured update report into a shared writer patch.
 */
export function buildPatchFromPersonUpdateReport(
  existingContent: string | null,
  person: IdentityCandidate,
  report: PersonUpdateReport,
  updated: string,
): PersonPatch {
  const parsed = existingContent ? parsePeopleNote(existingContent) : null;

  return buildPersonPatch({
    existing: parsed,
    person,
    updated,
    summary: report.summary,
    relationshipType: report.relationship_type,
    aliases: report.aliases,
    sourceHandles: report.source_handles,
    relatedPeople: report.related_people,
    relationshipBlocks: report.relationship_profile ?? [],
    signals: {
      mode: report.signal_mode ?? "append",
      items: report.signals ?? [],
    },
    openQuestions: {
      mode: report.open_questions_mode ?? "append",
      items: report.open_questions ?? [],
    },
    conflicts: report.conflicts ?? [],
  });
}

/**
 * Apply a structured update report to a resolved or newly created person note.
 */
export function applyPersonUpdateReport(
  existingContent: string | null,
  person: IdentityCandidate,
  report: PersonUpdateReport,
  updated: string,
): string {
  const patch = buildPatchFromPersonUpdateReport(
    existingContent,
    person,
    report,
    updated,
  );
  return applyPersonPatch(existingContent, patch);
}

/**
 * Resolve the destination person note or, when explicitly allowed, build a new stub target.
 */
export async function resolvePersonUpdateTarget(
  input: ResolvePersonUpdateTargetInput,
): Promise<ResolvePersonUpdateTargetResult> {
  if (input.notePath) {
    const existingContent = await readFile(input.notePath, "utf-8");
    const person = extractIdentityCandidate(parsePeopleNote(existingContent).frontmatter);
    if (!person) {
      throw new Error(
        "Existing note is missing canonical identity fields required for shared updates.",
      );
    }

    return {
      kind: "resolved",
      person: mergeIdentityFromQuery(person, input.query, input.report),
      notePath: input.notePath,
      existingContent,
      created: false,
      matchedBy: "slug",
    };
  }

  if (!input.peopleDir) {
    throw new Error("--people-dir is required when --note is not provided.");
  }

  const candidates = await loadIdentityCandidates(input.peopleDir);
  const resolution = resolvePerson(input.query, candidates);
  if (resolution.kind === "resolved") {
    const notePath = resolution.candidate.filePath;
    if (!notePath) {
      throw new Error("Resolved person is missing a source note path.");
    }

    return {
      kind: "resolved",
      person: mergeIdentityFromQuery(resolution.candidate, input.query, input.report),
      notePath,
      existingContent: await readFile(notePath, "utf-8"),
      created: false,
      matchedBy: resolution.matchedBy,
    };
  }

  if (
    !input.createIfMissing ||
    (resolution.reason !== "no-match" &&
      resolution.reason !== "name-only-no-write")
  ) {
    return resolution;
  }

  const stubPerson = createStubCandidate(input.peopleDir, input.query, input.report);
  return {
    kind: "resolved",
    person: stubPerson,
    notePath: stubPerson.filePath!,
    existingContent: null,
    created: true,
    matchedBy: "slug",
  };
}

function parseReport(content: string): PersonUpdateReport {
  const parsed = JSON.parse(content) as unknown;
  if (!isPersonUpdateReport(parsed)) {
    throw new Error("Report JSON does not match the structured person update schema.");
  }
  return parsed;
}

function isPersonUpdateReport(value: unknown): value is PersonUpdateReport {
  if (!isRecord(value)) return false;
  if (!isOptionalString(value.summary)) return false;
  if (!isOptionalRelationshipBlocks(value.relationship_profile)) return false;
  if (!isOptionalStringArray(value.signals)) return false;
  if (!isOptionalListMode(value.signal_mode)) return false;
  if (!isOptionalStringArray(value.open_questions)) return false;
  if (!isOptionalListMode(value.open_questions_mode)) return false;
  if (!isOptionalStringArray(value.conflicts)) return false;
  if (!isOptionalStringArray(value.aliases)) return false;
  if (!isOptionalSourceHandles(value.source_handles)) return false;
  if (!isOptionalString(value.relationship_type)) return false;
  if (!isOptionalStringArray(value.related_people)) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function isOptionalListMode(
  value: unknown,
): value is "append" | "replace" | undefined {
  return value === undefined || value === "append" || value === "replace";
}

function isOptionalRelationshipBlocks(
  value: unknown,
): value is RelationshipBlock[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;

  return value.every((item) => {
    if (!isRecord(item)) return false;
    return typeof item.heading === "string" && typeof item.content === "string";
  });
}

function isOptionalSourceHandles(
  value: unknown,
): value is SourceHandles | undefined {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;

  return Object.values(value).every(
    (handles) =>
      Array.isArray(handles) && handles.every((handle) => typeof handle === "string"),
  );
}

function mergeIdentityFromQuery(
  person: IdentityCandidate,
  query: ResolvePersonQuery,
  report: PersonUpdateReport,
): IdentityCandidate {
  const sourceHandles = mergeSourceHandles(
    person.source_handles,
    buildQuerySourceHandles(query),
    report.source_handles ?? {},
  );

  const aliases = mergeStringArrays(person.aliases, report.aliases ?? []);
  const relationshipType = report.relationship_type ?? person.relationship_type;

  const frontmatter: FrontmatterMap = {
    ...person.frontmatter,
    aliases,
    source_handles: sourceHandles,
  };
  if (relationshipType) {
    frontmatter.relationship_type = relationshipType;
  }

  return {
    ...person,
    aliases,
    relationship_type: relationshipType,
    source_handles: sourceHandles,
    frontmatter,
  };
}

function createStubCandidate(
  peopleDir: string,
  query: ResolvePersonQuery,
  report: PersonUpdateReport,
): IdentityCandidate {
  const title = query.title?.trim() || humanizeSlug(query.slug);
  const slug = normalizeSlug(query.slug ?? (title ? slugify(title) : undefined));

  if (!title || !slug) {
    throw new Error(
      "Cannot create a new person stub without a resolvable --title or --slug.",
    );
  }

  const sourceHandles = mergeSourceHandles(
    {},
    buildQuerySourceHandles(query),
    report.source_handles ?? {},
  );
  const aliases = mergeStringArrays([], report.aliases ?? []);
  const relationshipType = report.relationship_type ?? "unknown";
  const filePath = join(peopleDir, `${slug}.md`);

  return {
    title,
    slug,
    relationship_type: relationshipType,
    aliases,
    source_handles: sourceHandles,
    filePath,
    frontmatter: {
      title,
      type: "person",
      status: "active",
      slug,
      relationship_type: relationshipType,
      aliases,
      source_handles: sourceHandles,
    },
  };
}

function buildQuerySourceHandles(query: ResolvePersonQuery): SourceHandles {
  if (!query.source || !query.handles || query.handles.length === 0) {
    return {};
  }

  return {
    [query.source]: dedupeTrimmed(query.handles),
  };
}

function mergeSourceHandles(...maps: SourceHandles[]): SourceHandles {
  const merged: SourceHandles = {};

  for (const sourceMap of maps) {
    for (const [source, handles] of Object.entries(sourceMap)) {
      const nextHandles = mergeStringArrays(merged[source] ?? [], handles);
      if (nextHandles.length > 0) {
        merged[source] = nextHandles;
      }
    }
  }

  return Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function mergeStringArrays(existing: string[], incoming: string[]): string[] {
  return dedupeTrimmed([...existing, ...incoming]);
}

function dedupeTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }

  return output;
}

function normalizeSlug(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? slugify(trimmed) : undefined;
}

function humanizeSlug(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  return trimmed
    .split("-")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      alias: { type: "string" },
      "create-if-missing": { type: "boolean", default: false },
      handle: { type: "string", multiple: true },
      note: { type: "string" },
      output: { type: "string" },
      "people-dir": { type: "string" },
      "person-id": { type: "string" },
      report: { type: "string" },
      slug: { type: "string" },
      source: { type: "string" },
      title: { type: "string" },
      updated: { type: "string" },
      write: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (!values.report) {
    throw new Error("--report is required");
  }

  const report = parseReport(await readFile(values.report, "utf-8"));
  const query: ResolvePersonQuery = {
    person_id: values["person-id"],
    slug: values.slug,
    title: values.title,
    alias: values.alias,
    handles: values.handle,
    source: values.source,
  };

  const target = await resolvePersonUpdateTarget({
    notePath: values.note,
    peopleDir: values["people-dir"],
    query,
    report,
    createIfMissing: values["create-if-missing"],
  });

  if (target.kind === "review") {
    process.stdout.write(
      JSON.stringify(
        {
          status: "review",
          reason: target.reason,
          candidates: target.candidates.map((candidate) => ({
            title: candidate.title,
            slug: candidate.slug,
            person_id: candidate.person_id,
            relationship_type: candidate.relationship_type,
            file_path: candidate.filePath,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const updated = values.updated ?? new Date().toISOString().slice(0, 10);
  const nextContent = applyPersonUpdateReport(
    target.existingContent,
    target.person,
    report,
    updated,
  );

  if (values.write) {
    await mkdir(dirname(target.notePath), { recursive: true });
    await writeFile(target.notePath, nextContent, "utf-8");
    process.stdout.write(
      JSON.stringify(
        {
          status: "applied",
          wrote: target.notePath,
          updated,
          created: target.created,
          matched_by: target.matchedBy,
          slug: target.person.slug,
          person_id: target.person.person_id ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (values.output) {
    await mkdir(dirname(values.output), { recursive: true });
    await writeFile(values.output, nextContent, "utf-8");
    process.stdout.write(
      JSON.stringify(
        {
          status: "applied",
          wrote: values.output,
          source_note: target.notePath,
          updated,
          created: target.created,
          matched_by: target.matchedBy,
        },
        null,
        2,
      ),
    );
    return;
  }

  process.stdout.write(nextContent);
}

if (import.meta.main) {
  await main();
}
