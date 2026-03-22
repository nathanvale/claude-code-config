/**
 * Shared people-note contract helpers for the people-enrich skill.
 *
 * These primitives give every producer one safe path for resolving identity,
 * building structured note patches, and applying them without clobbering
 * unknown human-authored blocks.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { slugify } from "./lib";

/** Scalar values supported by the constrained frontmatter parser. */
export type FrontmatterScalar = boolean | number | string | null;

/** Constrained YAML value tree used by the people-note frontmatter. */
export type FrontmatterValue =
  | FrontmatterScalar
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

/** Parsed frontmatter map for a people note. */
export type FrontmatterMap = Record<string, FrontmatterValue>;

/** Source-specific handle map such as `imessage -> [+614...]`. */
export type SourceHandles = Record<string, string[]>;

/** Parsed H3 block within `## Relationship Profile`. */
export type RelationshipBlock = {
  heading: string;
  content: string;
};

/** Parsed generic `## Heading` section. */
export type TopLevelSection = {
  heading: string;
  content: string;
};

/** Parsed list-like section with optional prose preamble. */
export type ListSection = {
  preamble: string;
  items: string[];
};

/** Parsed people note in the locked contract shape. */
export type PeopleNote = {
  frontmatter: FrontmatterMap;
  relationshipIntro: string;
  relationshipBlocks: RelationshipBlock[];
  signals: ListSection;
  openQuestions: ListSection;
  extraSections: TopLevelSection[];
};

/** Identity candidate loaded from an existing people note. */
export type IdentityCandidate = {
  title: string;
  slug: string;
  person_id?: string;
  relationship_type?: string;
  aliases: string[];
  source_handles: SourceHandles;
  filePath?: string;
  frontmatter: FrontmatterMap;
};

/** Query shape for identity resolution across producers. */
export type ResolvePersonQuery = {
  person_id?: string;
  slug?: string;
  title?: string;
  alias?: string;
  handles?: string[];
  source?: string;
  source_id?: string;
};

/** Successful identity resolution. */
export type ResolvedPerson = {
  kind: "resolved";
  candidate: IdentityCandidate;
  matchedBy: "alias+handle" | "handle" | "person_id" | "slug";
};

/** No-write identity review result. */
export type ReviewPerson = {
  kind: "review";
  reason:
    | "ambiguous-handle"
    | "ambiguous-person-id"
    | "ambiguous-slug"
    | "ambiguous-alias-handle"
    | "name-only-no-write"
    | "no-match";
  candidates: IdentityCandidate[];
};

/** Union of supported identity resolution outcomes. */
export type ResolvePersonResult = ResolvedPerson | ReviewPerson;

/** Append-or-replace update contract for list sections. */
export type ListUpdate = {
  mode: "append" | "replace";
  items: string[];
};

/** Structured patch that can be applied to a people note safely. */
export type PersonPatch = {
  frontmatter: FrontmatterMap;
  relationshipBlocks: RelationshipBlock[];
  signals: ListUpdate;
  openQuestions: ListUpdate;
};

/** Input for building a structured patch before applying it to a note. */
export type BuildPersonPatchInput = {
  existing?: PeopleNote | null;
  person: IdentityCandidate;
  updated: string;
  summary?: string;
  relationshipType?: string;
  aliases?: string[];
  sourceHandles?: SourceHandles;
  enrichment?: FrontmatterMap;
  relatedPeople?: string[];
  relationshipBlocks?: RelationshipBlock[];
  signals?: ListUpdate;
  openQuestions?: ListUpdate;
  conflicts?: string[];
};

const KNOWN_FRONTMATTER_ORDER = [
  "title",
  "type",
  "status",
  "updated",
  "summary",
  "person_id",
  "slug",
  "relationship_type",
  "aliases",
  "source_handles",
  "enrichment",
  "related_people",
] as const;

/**
 * Parse a people note into frontmatter plus the locked top-level sections.
 */
export function parsePeopleNote(content: string): PeopleNote {
  const { frontmatter, body } = splitFrontmatter(content);
  const parsedFrontmatter = parseSimpleYaml(frontmatter);
  const sections = splitTopLevelSections(body);

  const relationshipSection = sections.find(
    (section) => section.heading === "Relationship Profile",
  );
  const signalsSection = sections.find((section) => section.heading === "Signals");
  const openQuestionsSection = sections.find(
    (section) => section.heading === "Open Questions",
  );

  const relationship = parseRelationshipSection(relationshipSection?.content ?? "");
  const signals = parseListSection(signalsSection?.content ?? "");
  const openQuestions = parseListSection(openQuestionsSection?.content ?? "");

  const extraSections = sections.filter(
    (section) =>
      section.heading !== "Relationship Profile" &&
      section.heading !== "Signals" &&
      section.heading !== "Open Questions",
  );

  return {
    frontmatter: parsedFrontmatter,
    relationshipIntro: relationship.intro,
    relationshipBlocks: relationship.blocks,
    signals,
    openQuestions,
    extraSections,
  };
}

/**
 * Render a parsed people note back to markdown using a stable contract shape.
 */
export function renderPeopleNote(note: PeopleNote): string {
  const sections = [
    renderTopLevelSection(
      "Relationship Profile",
      renderRelationshipSection(note.relationshipIntro, note.relationshipBlocks),
    ),
    renderTopLevelSection("Signals", renderListSection(note.signals)),
    renderTopLevelSection("Open Questions", renderListSection(note.openQuestions)),
    ...note.extraSections.map((section) =>
      renderTopLevelSection(section.heading, section.content),
    ),
  ].join("\n\n");

  return `${renderFrontmatter(note.frontmatter)}\n\n${sections}\n`;
}

/**
 * Load identity candidates from the existing `memory/people` directory.
 */
export async function loadIdentityCandidates(
  peopleDir: string,
): Promise<IdentityCandidate[]> {
  const entries = await readdir(peopleDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(peopleDir, entry.name));

  const candidates = await Promise.all(
    files.map(async (filePath) => {
      const content = await readFile(filePath, "utf-8");
      return extractIdentityCandidate(parsePeopleNote(content).frontmatter, filePath);
    }),
  );

  return candidates.filter((candidate): candidate is IdentityCandidate =>
    candidate !== null,
  );
}

/**
 * Resolve a person using the shared identity precedence rules.
 *
 * This intentionally refuses to resolve on title/name alone so capture-like
 * producers cannot silently merge the wrong person.
 */
export function resolvePerson(
  query: ResolvePersonQuery,
  candidates: IdentityCandidate[],
): ResolvePersonResult {
  if (query.person_id) {
    const personIdMatches = candidates.filter(
      (candidate) => candidate.person_id === query.person_id,
    );
    if (personIdMatches.length === 1) {
      return {
        kind: "resolved",
        candidate: personIdMatches[0],
        matchedBy: "person_id",
      };
    }
    if (personIdMatches.length > 1) {
      return {
        kind: "review",
        reason: "ambiguous-person-id",
        candidates: personIdMatches,
      };
    }
  }

  const normalizedHandles = [...new Set((query.handles ?? []).map(normalizeHandle))]
    .filter(Boolean);
  if (normalizedHandles.length > 0) {
    const handleMatches = candidates.filter((candidate) =>
      flattenSourceHandles(candidate.source_handles).some((handle) =>
        normalizedHandles.includes(handle),
      ),
    );
    if (handleMatches.length === 1) {
      return { kind: "resolved", candidate: handleMatches[0], matchedBy: "handle" };
    }
    if (handleMatches.length > 1) {
      return {
        kind: "review",
        reason: "ambiguous-handle",
        candidates: handleMatches,
      };
    }
  }

  if (query.slug) {
    const normalizedSlug = normalizeSlug(query.slug);
    const slugMatches = candidates.filter(
      (candidate) => candidate.slug === normalizedSlug,
    );
    if (slugMatches.length === 1) {
      return { kind: "resolved", candidate: slugMatches[0], matchedBy: "slug" };
    }
    if (slugMatches.length > 1) {
      return {
        kind: "review",
        reason: "ambiguous-slug",
        candidates: slugMatches,
      };
    }
  }

  if (normalizedHandles.length > 0 && (query.title || query.alias)) {
    const nameTokens = [query.title, query.alias]
      .filter((value): value is string => Boolean(value))
      .map(normalizeName);

    const aliasHandleMatches = candidates.filter((candidate) => {
      const candidateNames = [candidate.title, ...candidate.aliases].map(normalizeName);
      const nameMatched = nameTokens.some((token) => candidateNames.includes(token));
      const handleMatched = flattenSourceHandles(candidate.source_handles).some(
        (handle) => normalizedHandles.includes(handle),
      );
      return nameMatched && handleMatched;
    });

    if (aliasHandleMatches.length === 1) {
      return {
        kind: "resolved",
        candidate: aliasHandleMatches[0],
        matchedBy: "alias+handle",
      };
    }
    if (aliasHandleMatches.length > 1) {
      return {
        kind: "review",
        reason: "ambiguous-alias-handle",
        candidates: aliasHandleMatches,
      };
    }
  }

  if (query.title || query.alias) {
    return { kind: "review", reason: "name-only-no-write", candidates: [] };
  }

  return { kind: "review", reason: "no-match", candidates: [] };
}

/**
 * Build a structured note patch with merged frontmatter and deduped list writes.
 */
export function buildPersonPatch(input: BuildPersonPatchInput): PersonPatch {
  const existingFrontmatter = input.existing?.frontmatter ?? {};
  const existingAliases = asStringArray(existingFrontmatter.aliases);
  const existingHandles = asSourceHandles(existingFrontmatter.source_handles);
  const existingOpenQuestions = input.existing?.openQuestions.items ?? [];

  const mergedFrontmatter: FrontmatterMap = {
    ...existingFrontmatter,
    title: asString(existingFrontmatter.title) || input.person.title,
    type: asString(existingFrontmatter.type) || "person",
    status: asString(existingFrontmatter.status) || "active",
    updated: input.updated,
    summary: input.summary ?? asString(existingFrontmatter.summary) ?? "",
    person_id:
      asString(existingFrontmatter.person_id) ??
      input.person.person_id ??
      createPersonId(input.person.slug),
    slug: input.person.slug,
    relationship_type:
      input.relationshipType ??
      input.person.relationship_type ??
      asString(existingFrontmatter.relationship_type) ??
      "unknown",
    aliases: mergeStringArrays(existingAliases, [
      ...input.person.aliases,
      ...(input.aliases ?? []),
    ]),
    source_handles: mergeSourceHandles(existingHandles, {
      ...input.person.source_handles,
      ...(input.sourceHandles ?? {}),
    }),
  };

  if (input.enrichment) {
    mergedFrontmatter.enrichment = input.enrichment;
  }

  if (input.relatedPeople) {
    mergedFrontmatter.related_people = mergeStringArrays(
      asStringArray(existingFrontmatter.related_people),
      input.relatedPeople,
    );
  }

  const explicitOpenQuestions =
    input.openQuestions?.mode === "replace"
      ? dedupeTrimmed(input.openQuestions.items)
      : dedupeTrimmed([
          ...existingOpenQuestions,
          ...(input.openQuestions?.items ?? []),
          ...(input.conflicts ?? []),
        ]);

  return {
    frontmatter: mergedFrontmatter,
    relationshipBlocks: input.relationshipBlocks ?? [],
    signals: {
      mode: input.signals?.mode ?? "append",
      items: dedupeTrimmed(input.signals?.items ?? []),
    },
    openQuestions: {
      mode: input.openQuestions?.mode ?? "append",
      items: explicitOpenQuestions,
    },
  };
}

/**
 * Apply a structured patch to an existing note while preserving unknown H3 blocks.
 */
export function applyPersonPatch(
  existingContent: string | null,
  patch: PersonPatch,
): string {
  const existing = existingContent
    ? parsePeopleNote(existingContent)
    : createEmptyPeopleNote();

  const relationshipBlocks = mergeRelationshipBlocks(
    existing.relationshipBlocks,
    patch.relationshipBlocks,
  );

  const signals = mergeListSection(existing.signals, patch.signals);
  const openQuestions = mergeListSection(existing.openQuestions, patch.openQuestions);

  return renderPeopleNote({
    frontmatter: patch.frontmatter,
    relationshipIntro: existing.relationshipIntro,
    relationshipBlocks,
    signals,
    openQuestions,
    extraSections: existing.extraSections,
  });
}

/**
 * Extract the identity fields needed for resolution from parsed frontmatter.
 */
export function extractIdentityCandidate(
  frontmatter: FrontmatterMap,
  filePath?: string,
): IdentityCandidate | null {
  const title = asString(frontmatter.title);
  const slug =
    asString(frontmatter.slug) ?? (title ? slugify(title) : undefined);

  if (!title || !slug) return null;

  return {
    title,
    slug,
    person_id: asString(frontmatter.person_id),
    relationship_type: asString(frontmatter.relationship_type),
    aliases: asStringArray(frontmatter.aliases),
    source_handles: asSourceHandles(frontmatter.source_handles),
    filePath,
    frontmatter,
  };
}

function createEmptyPeopleNote(): PeopleNote {
  return {
    frontmatter: {},
    relationshipIntro: "",
    relationshipBlocks: [],
    signals: { preamble: "", items: [] },
    openQuestions: { preamble: "", items: [] },
    extraSections: [],
  };
}

function mergeRelationshipBlocks(
  existingBlocks: RelationshipBlock[],
  incomingBlocks: RelationshipBlock[],
): RelationshipBlock[] {
  if (incomingBlocks.length === 0) return existingBlocks;

  const nextBlocks = [...existingBlocks];
  for (const block of incomingBlocks) {
    const heading = block.heading.trim();
    const content = block.content.trim();
    if (!heading) continue;

    const existingIndex = nextBlocks.findIndex(
      (candidate) => normalizeName(candidate.heading) === normalizeName(heading),
    );

    if (existingIndex >= 0) {
      nextBlocks[existingIndex] = { heading, content };
    } else {
      nextBlocks.push({ heading, content });
    }
  }
  return nextBlocks;
}

function mergeListSection(existing: ListSection, update: ListUpdate): ListSection {
  if (update.mode === "replace") {
    return { ...existing, items: mergeUniqueListItems([], update.items) };
  }

  return {
    ...existing,
    items: mergeUniqueListItems(existing.items, update.items),
  };
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith("---\n")) {
    return { frontmatter: "", body: content.trim() };
  }

  const endIndex = content.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return { frontmatter: "", body: content.trim() };
  }

  return {
    frontmatter: content.slice(4, endIndex),
    body: content.slice(endIndex + 5).trim(),
  };
}

function splitTopLevelSections(body: string): TopLevelSection[] {
  if (!body) return [];

  const matches = [...body.matchAll(/^## (.+)$/gm)];
  if (matches.length === 0) {
    return [{ heading: "Relationship Profile", content: body.trim() }];
  }

  return matches.map((match, index) => {
    const heading = match[1].trim();
    const start = match.index! + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index! : body.length;
    const content = body.slice(start, end).trim();
    return { heading, content };
  });
}

function parseRelationshipSection(
  content: string,
): { intro: string; blocks: RelationshipBlock[] } {
  if (!content) return { intro: "", blocks: [] };

  const matches = [...content.matchAll(/^### (.+)$/gm)];
  if (matches.length === 0) {
    return { intro: content.trim(), blocks: [] };
  }

  const intro = content.slice(0, matches[0].index).trim();
  const blocks = matches.map((match, index) => {
    const heading = match[1].trim();
    const start = match.index! + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index! : content.length;
    return { heading, content: content.slice(start, end).trim() };
  });

  return { intro, blocks };
}

function parseListSection(content: string): ListSection {
  if (!content) return { preamble: "", items: [] };

  const lines = content.split("\n");
  const preamble: string[] = [];
  const items: string[] = [];

  for (const line of lines) {
    if (line.startsWith("- ")) {
      items.push(line.slice(2).trim());
    } else {
      preamble.push(line);
    }
  }

  return {
    preamble: preamble.join("\n").trim(),
    items: dedupeTrimmed(items),
  };
}

function renderRelationshipSection(
  intro: string,
  blocks: RelationshipBlock[],
): string {
  const parts: string[] = [];
  if (intro.trim()) {
    parts.push(intro.trim());
  }

  for (const block of blocks) {
    parts.push(`### ${block.heading}\n\n${block.content.trim()}`);
  }

  return parts.join("\n\n").trim();
}

function renderListSection(section: ListSection): string {
  const parts: string[] = [];
  if (section.preamble.trim()) {
    parts.push(section.preamble.trim());
  }
  if (section.items.length > 0) {
    parts.push(section.items.map((item) => `- ${item}`).join("\n"));
  }
  return parts.join("\n\n").trim();
}

function renderTopLevelSection(heading: string, content: string): string {
  return content.trim()
    ? `## ${heading}\n\n${content.trim()}`
    : `## ${heading}`;
}

function parseSimpleYaml(frontmatter: string): FrontmatterMap {
  if (!frontmatter.trim()) return {};
  const lines = frontmatter.split("\n");
  const [value] = parseYamlMapping(lines, 0, 0);
  return value;
}

function parseYamlMapping(
  lines: string[],
  startIndex: number,
  indent: number,
): [FrontmatterMap, number] {
  const result: FrontmatterMap = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    const currentIndent = countIndent(line);
    if (currentIndent < indent) break;
    if (currentIndent > indent) {
      index++;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) break;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
      index++;
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();
    if (rawValue) {
      result[key] = parseScalar(rawValue);
      index++;
      continue;
    }

    const nextIndex = nextMeaningfulLineIndex(lines, index + 1);
    if (nextIndex === -1) {
      result[key] = "";
      index++;
      continue;
    }

    const nextLine = lines[nextIndex];
    const nextIndent = countIndent(nextLine);
    const nextTrimmed = nextLine.trim();
    if (nextTrimmed.startsWith("- ") && nextIndent >= currentIndent) {
      const [arrayValue, consumedIndex] = parseYamlArray(lines, nextIndex, nextIndent);
      result[key] = arrayValue;
      index = consumedIndex;
      continue;
    }

    if (nextIndent <= currentIndent) {
      result[key] = "";
      index++;
      continue;
    }

    const [nestedValue, consumedIndex] = parseYamlMapping(
      lines,
      nextIndex,
      nextIndent,
    );
    result[key] = nestedValue;
    index = consumedIndex;
  }

  return [result, index];
}

function parseYamlArray(
  lines: string[],
  startIndex: number,
  indent: number,
): [FrontmatterValue[], number] {
  const result: FrontmatterValue[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    const currentIndent = countIndent(line);
    if (currentIndent < indent) break;

    const trimmed = line.trim();
    if (!trimmed.startsWith("- ") || currentIndent !== indent) break;

    result.push(parseScalar(trimmed.slice(2).trim()));
    index++;
  }

  return [result, index];
}

function parseScalar(rawValue: string): FrontmatterScalar {
  const value = stripQuotes(rawValue);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function renderFrontmatter(frontmatter: FrontmatterMap): string {
  const ordered = orderFrontmatter(frontmatter);
  const lines = ["---", ...renderYamlMapping(ordered, 0), "---"];
  return lines.join("\n");
}

function renderYamlMapping(map: FrontmatterMap, indent: number): string[] {
  const lines: string[] = [];
  const pad = " ".repeat(indent);

  for (const [key, value] of Object.entries(map)) {
    if (isObjectValue(value)) {
      lines.push(`${pad}${key}:`);
      lines.push(...renderYamlMapping(value, indent + 2));
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else {
        lines.push(`${pad}${key}:`);
        for (const item of value) {
          lines.push(`${" ".repeat(indent + 2)}- ${formatScalar(item)}`);
        }
      }
    } else {
      lines.push(`${pad}${key}: ${formatScalar(value)}`);
    }
  }

  return lines;
}

function orderFrontmatter(frontmatter: FrontmatterMap): FrontmatterMap {
  const ordered: FrontmatterMap = {};

  for (const key of KNOWN_FRONTMATTER_ORDER) {
    if (key in frontmatter) {
      ordered[key] = frontmatter[key];
    }
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    if (!(key in ordered)) {
      ordered[key] = value;
    }
  }

  return ordered;
}

function formatScalar(value: FrontmatterValue): string {
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (value === null) return "null";
  if (typeof value !== "string") {
    return JSON.stringify(value);
  }
  if (value.length === 0) return '""';

  const safePlain = /^[A-Za-z0-9_./@+-]+(?: [A-Za-z0-9_./@+-]+)*$/;
  if (
    safePlain.test(value) &&
    value !== "true" &&
    value !== "false" &&
    value !== "null" &&
    !/^-?\d+$/.test(value)
  ) {
    return value;
  }

  return JSON.stringify(value);
}

function isObjectValue(
  value: FrontmatterValue,
): value is { [key: string]: FrontmatterValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countIndent(line: string): number {
  return line.length - line.trimStart().length;
}

function nextMeaningfulLineIndex(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index++) {
    if (lines[index].trim()) return index;
  }
  return -1;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function flattenSourceHandles(sourceHandles: SourceHandles): string[] {
  return Object.values(sourceHandles)
    .flat()
    .map(normalizeHandle);
}

function asString(value: FrontmatterValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: FrontmatterValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asSourceHandles(value: FrontmatterValue | undefined): SourceHandles {
  if (value === undefined || !isObjectValue(value)) return {};

  const result: SourceHandles = {};
  for (const [source, handles] of Object.entries(value)) {
    result[source] = asStringArray(handles);
  }
  return result;
}

function mergeStringArrays(existing: string[], incoming: string[]): string[] {
  return dedupeTrimmed([...existing, ...incoming]).sort((left, right) =>
    left.localeCompare(right),
  );
}

function mergeSourceHandles(
  existing: SourceHandles,
  incoming: SourceHandles,
): SourceHandles {
  const merged: SourceHandles = { ...existing };
  for (const [source, handles] of Object.entries(incoming)) {
    merged[source] = mergeStringArrays(merged[source] ?? [], handles);
  }
  return merged;
}

function dedupeTrimmed(items: string[]): string[] {
  return mergeUniqueListItems([], items);
}

function mergeUniqueListItems(existingItems: string[], incomingItems: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const rawItem of [...existingItems, ...incomingItems]) {
    const trimmed = rawItem.trim();
    if (!trimmed) continue;

    const canonical = canonicalListItem(trimmed);
    const existingIndex = deduped.findIndex((candidate) => {
      const canonicalCandidate = canonicalListItem(candidate);
      return (
        canonicalCandidate === canonical ||
        canonicalCandidate.includes(canonical) ||
        canonical.includes(canonicalCandidate)
      );
    });

    if (existingIndex === -1) {
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        deduped.push(trimmed);
      }
      continue;
    }

    if (trimmed.length > deduped[existingIndex].length) {
      deduped[existingIndex] = trimmed;
    }
  }

  return deduped;
}

function createPersonId(slug: string): string {
  return `person_${slug.replace(/-/g, "_")}`;
}

function canonicalListItem(item: string): string {
  return item
    .toLowerCase()
    .replace(/^\d{4}-\d{2}-\d{2}:\s*/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
