#!/usr/bin/env bun
/**
 * apply-enrichment.ts — Apply a structured enrichment report to a people note.
 *
 * This bridges the `/people-enrich` research output to the locked note contract.
 * It consumes structured JSON, resolves the note's identity from its frontmatter,
 * builds a patch through the shared writer helpers, and either prints the proposed
 * markdown or writes it back in place.
 *
 * Usage:
 *   bun run apply-enrichment.ts --note ~/code/my-second-brain/context/people/richard-johnson.md --report report.json
 *   bun run apply-enrichment.ts --note ./person.md --report report.json --write
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  applyPersonPatch,
  buildPersonPatch,
  extractIdentityCandidate,
  parsePeopleNote,
  type FrontmatterMap,
  type FrontmatterValue,
  type PersonPatch,
  type RelationshipBlock,
  type SourceHandles,
} from "./people-note";

/** Structured enrichment output expected from `/people-enrich` synthesis. */
export type EnrichmentReport = {
  summary?: string;
  relationship_profile: RelationshipBlock[];
  signals?: string[];
  signal_mode?: "append" | "replace";
  open_questions?: string[];
  open_questions_mode?: "append" | "replace";
  conflicts?: string[];
  aliases?: string[];
  source_handles?: SourceHandles;
  relationship_type?: string;
  related_people?: string[];
  enrichment?: {
    source: string;
    tier?: number;
    last_run_at?: string;
  } & Record<string, FrontmatterValue>;
};

/**
 * Convert a structured enrichment report into a shared writer patch.
 *
 * This keeps the skill's merge behavior deterministic and testable: the agent
 * can reason about relationship content, but the note mutation always happens
 * through the same contract-aware path.
 */
export function buildPatchFromEnrichmentReport(
  existingContent: string,
  report: EnrichmentReport,
  updated: string,
): PersonPatch {
  const parsed = parsePeopleNote(existingContent);
  const person = extractIdentityCandidate(parsed.frontmatter);
  if (!person) {
    throw new Error(
      "Existing note is missing canonical identity fields required for enrichment.",
    );
  }

  return buildPersonPatch({
    existing: parsed,
    person,
    updated,
    summary: report.summary,
    relationshipType: report.relationship_type,
    aliases: report.aliases,
    sourceHandles: report.source_handles,
    relatedPeople: report.related_people,
    enrichment: normalizeEnrichment(report.enrichment),
    relationshipBlocks: report.relationship_profile,
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
 * Apply a structured enrichment report to existing markdown and return the next note.
 */
export function applyEnrichmentReport(
  existingContent: string,
  report: EnrichmentReport,
  updated: string,
): string {
  const patch = buildPatchFromEnrichmentReport(existingContent, report, updated);
  return applyPersonPatch(existingContent, patch);
}

function normalizeEnrichment(
  enrichment: EnrichmentReport["enrichment"] | undefined,
): FrontmatterMap | undefined {
  if (!enrichment) return undefined;

  const normalized: FrontmatterMap = {};
  for (const [key, value] of Object.entries(enrichment)) {
    if (value === undefined) continue;
    normalized[key] = value;
  }
  return normalized;
}

function parseReport(content: string): EnrichmentReport {
  const parsed = JSON.parse(content) as unknown;
  if (!isEnrichmentReport(parsed)) {
    throw new Error("Report JSON does not match the structured enrichment schema.");
  }
  return parsed;
}

function isEnrichmentReport(value: unknown): value is EnrichmentReport {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.relationship_profile)) return false;

  return value.relationship_profile.every((item) => {
    if (!isRecord(item)) return false;
    return typeof item.heading === "string" && typeof item.content === "string";
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      note: { type: "string" },
      report: { type: "string" },
      output: { type: "string" },
      updated: { type: "string" },
      write: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (!values.note || !values.report) {
    throw new Error("--note and --report are required");
  }

  const existingContent = await readFile(values.note, "utf-8");
  const report = parseReport(await readFile(values.report, "utf-8"));
  const updated = values.updated ?? new Date().toISOString().slice(0, 10);
  const nextContent = applyEnrichmentReport(existingContent, report, updated);

  if (values.write) {
    await writeFile(values.note, nextContent, "utf-8");
    console.log(
      JSON.stringify(
        {
          wrote: values.note,
          updated,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (values.output) {
    await writeFile(values.output, nextContent, "utf-8");
    console.log(
      JSON.stringify(
        {
          wrote: values.output,
          source_note: values.note,
          updated,
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
