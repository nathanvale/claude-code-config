import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  applyPersonUpdateReport,
  resolvePersonUpdateTarget,
  type PersonUpdateReport,
} from "./apply-person-update";
import { parsePeopleNote } from "./people-note";

const EXISTING_MELANIE_NOTE = `---
title: Melanie
type: person
status: active
updated: 2026-03-21
summary: Nathan's partner
person_id: person_melanie
slug: melanie
relationship_type: partner
aliases:
  - Bestie
source_handles:
  imessage:
    - +61412667520
---

## Relationship Profile

### Relationship

Partner.

### Our Unspoken Deal

Keep this human-authored block.

## Signals

- 2026-03-21: Existing signal

## Open Questions

- Existing open question
`;

async function createPeopleDir(
  files: Record<string, string>,
): Promise<{ peopleDir: string }> {
  const peopleDir = await mkdtemp(join(tmpdir(), "people-note-"));
  await Promise.all(
    Object.entries(files).map(([name, content]) =>
      writeFile(join(peopleDir, name), content, "utf-8"),
    ),
  );
  return { peopleDir };
}

describe("resolvePersonUpdateTarget", () => {
  test("resolves an existing note by handle and appends a signal update safely", async () => {
    const { peopleDir } = await createPeopleDir({
      "melanie.md": EXISTING_MELANIE_NOTE,
    });

    const report: PersonUpdateReport = {
      signals: ["2026-03-22: Mentioned new Easter lunch plan; source: iMessage"],
      source_handles: { email: ["mel@example.com"] },
    };

    const target = await resolvePersonUpdateTarget({
      peopleDir,
      query: {
        source: "imessage",
        handles: ["+61412667520"],
      },
      report,
    });

    expect(target.kind).toBe("resolved");
    if (target.kind !== "resolved") return;
    expect(target.created).toBe(false);
    expect(target.matchedBy).toBe("handle");

    const next = applyPersonUpdateReport(
      target.existingContent,
      target.person,
      report,
      "2026-03-22",
    );

    expect(next).toContain("- 2026-03-21: Existing signal");
    expect(next).toContain(
      "- 2026-03-22: Mentioned new Easter lunch plan; source: iMessage",
    );

    const parsed = parsePeopleNote(next);
    expect(parsed.frontmatter.source_handles).toEqual({
      email: ["mel@example.com"],
      imessage: ["+61412667520"],
    });
  });

  test("returns review for name-only lookup and does not silently merge", async () => {
    const { peopleDir } = await createPeopleDir({
      "melanie.md": EXISTING_MELANIE_NOTE,
    });

    const target = await resolvePersonUpdateTarget({
      peopleDir,
      query: {
        title: "Melanie",
      },
      report: {
        signals: ["2026-03-22: Name-only update should not write"],
      },
    });

    expect(target).toEqual({
      kind: "review",
      reason: "name-only-no-write",
      candidates: [],
    });
  });

  test("creates a minimal stub when create-if-missing is explicitly enabled", async () => {
    const { peopleDir } = await createPeopleDir({});

    const target = await resolvePersonUpdateTarget({
      peopleDir,
      query: {
        title: "Sarah Chen",
        source: "calendar",
        handles: ["sarah.chen@example.com"],
      },
      report: {
        signals: ["2026-03-22: Calendar invite suggests works at Example Co."],
      },
      createIfMissing: true,
    });

    expect(target.kind).toBe("resolved");
    if (target.kind !== "resolved") return;
    expect(target.created).toBe(true);
    expect(target.notePath).toBe(join(peopleDir, "sarah-chen.md"));

    const next = applyPersonUpdateReport(
      target.existingContent,
      target.person,
      {
        signals: ["2026-03-22: Calendar invite suggests works at Example Co."],
      },
      "2026-03-22",
    );

    expect(next).toContain("## Signals");
    expect(next).toContain(
      "- 2026-03-22: Calendar invite suggests works at Example Co.",
    );

    const parsed = parsePeopleNote(next);
    expect(parsed.frontmatter.title).toBe("Sarah Chen");
    expect(parsed.frontmatter.slug).toBe("sarah-chen");
    expect(parsed.frontmatter.person_id).toBe("person_sarah_chen");
  });
});

describe("applyPersonUpdateReport", () => {
  test("preserves unknown H3 blocks while updating relationship profile content", () => {
    const next = applyPersonUpdateReport(
      EXISTING_MELANIE_NOTE,
      {
        title: "Melanie",
        slug: "melanie",
        person_id: "person_melanie",
        relationship_type: "partner",
        aliases: ["Bestie"],
        source_handles: { imessage: ["+61412667520"] },
        frontmatter: {
          title: "Melanie",
          type: "person",
          status: "active",
          updated: "2026-03-21",
          summary: "Nathan's partner",
          person_id: "person_melanie",
          slug: "melanie",
          relationship_type: "partner",
          aliases: ["Bestie"],
          source_handles: { imessage: ["+61412667520"] },
        },
      },
      {
        relationship_profile: [
          {
            heading: "Relationship",
            content: "Updated relationship summary.",
          },
          {
            heading: "Communication Pattern",
            content: "Short, warm daily check-ins matter here.",
          },
        ],
      },
      "2026-03-22",
    );

    expect(next).toContain("### Our Unspoken Deal");
    expect(next).toContain("Keep this human-authored block.");
    expect(next).toContain("### Communication Pattern");
    expect(next).toContain("Updated relationship summary.");
  });

  test("adds explicit conflicts to open questions without duplicating items", () => {
    const next = applyPersonUpdateReport(
      EXISTING_MELANIE_NOTE,
      {
        title: "Melanie",
        slug: "melanie",
        person_id: "person_melanie",
        relationship_type: "partner",
        aliases: ["Bestie"],
        source_handles: { imessage: ["+61412667520"] },
        frontmatter: {
          title: "Melanie",
          type: "person",
          status: "active",
          updated: "2026-03-21",
          summary: "Nathan's partner",
          person_id: "person_melanie",
          slug: "melanie",
          relationship_type: "partner",
          aliases: ["Bestie"],
          source_handles: { imessage: ["+61412667520"] },
        },
      },
      {
        open_questions: ["Existing open question"],
        conflicts: [
          "Calendar says Example Co, but messages suggest Freelance; confirm current employer.",
        ],
      },
      "2026-03-22",
    );

    const existingQuestionMatches = next.match(/Existing open question/g);
    expect(existingQuestionMatches).toHaveLength(1);
    expect(next).toContain(
      "Calendar says Example Co, but messages suggest Freelance; confirm current employer.",
    );
  });
});
