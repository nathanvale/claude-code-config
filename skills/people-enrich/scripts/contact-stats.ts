#!/usr/bin/env bun
/**
 * contact-stats.ts — Mechanical frontmatter stats extraction from iMessage corpus.
 *
 * Walks the 60k message corpus, parses YAML frontmatter, and produces per-contact
 * JSON stats files. No AI, no tokens. Covers volume, timing, initiative, recurring
 * events, seasonal patterns, and communication gaps.
 *
 * Usage:
 *   bun run contact-stats.ts --contact "Melanie"
 *   bun run contact-stats.ts --all --min-messages 10
 *   bun run contact-stats.ts --all --dry-run
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { walkMd, readFrontmatter, slugify } from "./lib";
import type { MessageFrontmatter } from "./lib";

/** Per-contact stats output schema. */
export type ContactStats = {
  schema_version: 1;
  person_slug: string;
  display_name: string;
  handles: string[];
  total_messages: number;
  inbound: number;
  outbound: number;
  initiative_ratio: number;
  first_message: string;
  last_message: string;
  monthly_volume: Record<string, number>;
  day_of_week: Record<string, number>;
  time_of_day: Record<string, number>;
  gaps: Array<{ start: string; end: string; days: number }>;
  group_message_count: number;
  generated_at: string;
};

/** Accumulator for building stats from individual messages. */
type ContactAccumulator = {
  display_name: string;
  handles: Set<string>;
  messages: Array<{ sent_at: string; direction: string }>;
  inbound: number;
  outbound: number;
  monthly_volume: Record<string, number>;
  day_of_week: Record<string, number>;
  time_of_day: Record<string, number>;
  group_message_count: number;
};

const DEFAULT_CORPUS_DIR =
  "/Users/nathanvale/code/personal-messages/docs/messages/imessage/";
const DEFAULT_OUTPUT_DIR =
  "/Users/nathanvale/code/my-second-brain-v2/runtime/people-enrichment/";

const GAP_THRESHOLD_DAYS = 14;

/**
 * Accumulate a single message's frontmatter into the contact accumulator.
 */
function accumulateMessage(
  acc: ContactAccumulator,
  fm: MessageFrontmatter,
): void {
  if (fm.handle) acc.handles.add(fm.handle);

  // Track group messages separately — don't count toward per-person stats
  if (fm.is_group) {
    acc.group_message_count++;
    return;
  }

  acc.messages.push({ sent_at: fm.sent_at, direction: fm.direction });

  if (fm.direction === "inbound") {
    acc.inbound++;
  } else {
    acc.outbound++;
  }

  // Monthly volume: YYYY-MM
  if (fm.sent_at) {
    const month = fm.sent_at.slice(0, 7);
    acc.monthly_volume[month] = (acc.monthly_volume[month] ?? 0) + 1;
  }

  if (fm.day_of_week) {
    acc.day_of_week[fm.day_of_week] =
      (acc.day_of_week[fm.day_of_week] ?? 0) + 1;
  }

  if (fm.time_of_day) {
    acc.time_of_day[fm.time_of_day] =
      (acc.time_of_day[fm.time_of_day] ?? 0) + 1;
  }
}

/**
 * Detect communication gaps >= GAP_THRESHOLD_DAYS in a sorted list of dates.
 */
function detectGaps(
  sortedDates: string[],
): Array<{ start: string; end: string; days: number }> {
  const gaps: Array<{ start: string; end: string; days: number }> = [];
  if (sortedDates.length < 2) return gaps;

  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(sortedDates[i - 1]);
    const curr = new Date(sortedDates[i]);
    const diffDays = Math.round(
      (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays >= GAP_THRESHOLD_DAYS) {
      gaps.push({
        start: sortedDates[i - 1].slice(0, 10),
        end: sortedDates[i].slice(0, 10),
        days: diffDays,
      });
    }
  }

  return gaps;
}

/**
 * Finalize an accumulator into a ContactStats object.
 */
function finalizeStats(acc: ContactAccumulator): ContactStats {
  // Sort messages by sent_at for gap detection and first/last
  const sortedMessages = acc.messages
    .filter((m) => m.sent_at)
    .sort((a, b) => a.sent_at.localeCompare(b.sent_at));

  const sortedDates = sortedMessages.map((m) => m.sent_at);
  const totalDirect = acc.inbound + acc.outbound;

  return {
    schema_version: 1,
    person_slug: slugify(acc.display_name),
    display_name: acc.display_name,
    handles: [...acc.handles].sort(),
    total_messages: totalDirect,
    inbound: acc.inbound,
    outbound: acc.outbound,
    initiative_ratio:
      totalDirect > 0
        ? Math.round((acc.outbound / totalDirect) * 1000) / 1000
        : 0,
    first_message: sortedDates[0] ?? "",
    last_message: sortedDates[sortedDates.length - 1] ?? "",
    monthly_volume: acc.monthly_volume,
    day_of_week: acc.day_of_week,
    time_of_day: acc.time_of_day,
    gaps: detectGaps(sortedDates),
    group_message_count: acc.group_message_count,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Create a fresh accumulator for a contact.
 */
function createAccumulator(displayName: string): ContactAccumulator {
  return {
    display_name: displayName,
    handles: new Set(),
    messages: [],
    inbound: 0,
    outbound: 0,
    monthly_volume: {},
    day_of_week: {},
    time_of_day: {},
    group_message_count: 0,
  };
}

/**
 * Walk the corpus and collect stats for all or a single contact.
 */
async function collectStats(
  corpusDir: string,
  targetContact: string | null,
): Promise<Map<string, ContactAccumulator>> {
  const accumulators = new Map<string, ContactAccumulator>();
  let scanned = 0;
  let skipped = 0;

  for await (const filePath of walkMd(corpusDir)) {
    scanned++;

    const fm = await readFrontmatter(filePath);
    if (!fm) {
      skipped++;
      continue;
    }

    // Skip unknown contacts
    if (fm.conversation_with === "unknown" || !fm.conversation_with) {
      skipped++;
      continue;
    }

    const name = fm.conversation_with;

    // If filtering to a single contact, skip others
    if (targetContact && name.toLowerCase() !== targetContact.toLowerCase()) {
      continue;
    }

    let acc = accumulators.get(name);
    if (!acc) {
      acc = createAccumulator(name);
      accumulators.set(name, acc);
    }

    accumulateMessage(acc, fm);
  }

  if (scanned % 10000 === 0 || scanned === 0) {
    // progress hint; only in stderr so stdout stays clean for JSON
  }
  console.error(`Scanned ${scanned} files, skipped ${skipped} unparseable`);

  return accumulators;
}

/**
 * Write stats JSON files to the output directory.
 */
async function writeStatsFiles(
  stats: ContactStats[],
  outputDir: string,
): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  for (const s of stats) {
    const filePath = join(outputDir, `${s.person_slug}.json`);
    await writeFile(filePath, JSON.stringify(s, null, 2) + "\n", "utf-8");
    console.error(`  wrote ${filePath}`);
  }
}

/**
 * Print a summary table to stdout.
 */
function printSummary(stats: ContactStats[]): void {
  const sorted = [...stats].sort((a, b) => b.total_messages - a.total_messages);

  console.log(
    JSON.stringify(
      {
        contact_count: sorted.length,
        total_messages: sorted.reduce((s, c) => s + c.total_messages, 0),
        contacts: sorted.map((c) => ({
          name: c.display_name,
          slug: c.person_slug,
          messages: c.total_messages,
          inbound: c.inbound,
          outbound: c.outbound,
          initiative: c.initiative_ratio,
          handles: c.handles.length,
          first: c.first_message.slice(0, 10),
          last: c.last_message.slice(0, 10),
          gaps: c.gaps.length,
          group: c.group_message_count,
        })),
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      contact: { type: "string" },
      all: { type: "boolean", default: false },
      "output-dir": { type: "string", default: DEFAULT_OUTPUT_DIR },
      "corpus-dir": { type: "string", default: DEFAULT_CORPUS_DIR },
      "min-messages": { type: "string", default: "1" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });

  const contact = values.contact ?? null;
  const all = values.all ?? false;
  const outputDir = values["output-dir"] ?? DEFAULT_OUTPUT_DIR;
  const corpusDir = values["corpus-dir"] ?? DEFAULT_CORPUS_DIR;
  const minMessages = parseInt(values["min-messages"] ?? "1", 10);
  const dryRun = values["dry-run"] ?? false;

  if (!contact && !all) {
    console.error(
      "Usage: contact-stats.ts --contact <name> | --all [--min-messages N] [--dry-run]",
    );
    process.exit(1);
  }

  console.error(
    `People Enrichment — contact-stats${dryRun ? " (DRY RUN)" : ""}`,
  );
  console.error(`Corpus: ${corpusDir}`);
  console.error(`Output: ${outputDir}`);
  if (contact) console.error(`Target: ${contact}`);
  if (minMessages > 1) console.error(`Min messages: ${minMessages}`);
  console.error("");

  const accumulators = await collectStats(corpusDir, contact);

  // Finalize and filter
  const allStats: ContactStats[] = [];
  for (const acc of accumulators.values()) {
    const stats = finalizeStats(acc);
    if (stats.total_messages >= minMessages) {
      allStats.push(stats);
    }
  }

  if (allStats.length === 0) {
    console.error("No contacts matched the criteria.");
    process.exit(0);
  }

  // Print summary to stdout
  printSummary(allStats);

  // Write files unless dry run
  if (!dryRun) {
    await writeStatsFiles(allStats, outputDir);
    console.error(`\nWrote ${allStats.length} stats file(s) to ${outputDir}`);
  } else {
    console.error(`\nDry run — ${allStats.length} file(s) would be written.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
