/**
 * Shared utilities for people-enrichment scripts.
 *
 * Keeps a minimal frontmatter parser and filesystem walker local to this skill
 * so we don't couple to the larger personal-messages codebase.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Relevant frontmatter fields from iMessage markdown files. */
export type MessageFrontmatter = {
  conversation_with: string;
  direction: string;
  sent_at: string;
  day_of_week: string;
  time_of_day: string;
  is_group: boolean;
  handle: string;
};

/**
 * Parse YAML frontmatter from a markdown string.
 *
 * Intentionally minimal: handles only the scalar/boolean fields we need.
 * Does NOT use a full YAML parser to avoid dependency weight.
 */
export function parseFrontmatter(content: string): MessageFrontmatter | null {
  if (!content.startsWith("---")) return null;

  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return null;

  const block = content.slice(4, endIndex);
  const fields: Record<string, string> = {};

  for (const line of block.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  const conversationWith = fields.conversation_with;
  if (!conversationWith) return null;

  return {
    conversation_with: conversationWith,
    direction: fields.direction ?? "",
    sent_at: fields.sent_at ?? "",
    day_of_week: fields.day_of_week ?? "",
    time_of_day: fields.time_of_day ?? "",
    is_group: fields.is_group === "true",
    handle: fields.handle ?? "",
  };
}

/**
 * Recursively walk a directory tree yielding paths to .md files.
 */
export async function* walkMd(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMd(full);
    } else if (entry.name.endsWith(".md")) {
      yield full;
    }
  }
}

/**
 * Read a markdown file and return its parsed frontmatter.
 */
export async function readFrontmatter(
  filePath: string,
): Promise<MessageFrontmatter | null> {
  const content = await readFile(filePath, "utf-8");
  return parseFrontmatter(content);
}

/**
 * Convert a display name to a slug (lowercase, hyphenated).
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
