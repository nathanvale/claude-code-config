import { describe, expect, test } from "bun:test";
import {
  applyPersonPatch,
  buildPersonPatch,
  parsePeopleNote,
  resolvePerson,
  type IdentityCandidate,
} from "./people-note";

const MELANIE_CANDIDATE: IdentityCandidate = {
  title: "Melanie",
  slug: "melanie",
  person_id: "person_melanie",
  relationship_type: "partner",
  aliases: ["Bestie", "Sweetheart"],
  source_handles: { imessage: ["+61412667520"] },
  frontmatter: {
    title: "Melanie",
    type: "person",
    status: "active",
    updated: "2026-03-22",
    summary: "Nathan's partner",
    person_id: "person_melanie",
    slug: "melanie",
    relationship_type: "partner",
    aliases: ["Bestie", "Sweetheart"],
    source_handles: { imessage: ["+61412667520"] },
  },
};

const LEVI_CANDIDATE: IdentityCandidate = {
  title: "Levi",
  slug: "levi",
  person_id: "person_levi",
  relationship_type: "child",
  aliases: [],
  source_handles: { email: ["levielijahvale@gmail.com"] },
  frontmatter: {
    title: "Levi",
    type: "person",
    status: "active",
    updated: "2026-03-22",
    summary: "Nathan's son",
    person_id: "person_levi",
    slug: "levi",
    relationship_type: "child",
    aliases: [],
    source_handles: { email: ["levielijahvale@gmail.com"] },
  },
};

describe("resolvePerson", () => {
  test("resolves exact handle match before anything else", () => {
    const result = resolvePerson(
      { handles: ["+61412667520"], title: "Melanie" },
      [MELANIE_CANDIDATE, LEVI_CANDIDATE],
    );

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.candidate.slug).toBe("melanie");
    expect(result.matchedBy).toBe("handle");
  });

  test("resolves explicit slug lookup safely", () => {
    const result = resolvePerson(
      { slug: "levi" },
      [MELANIE_CANDIDATE, LEVI_CANDIDATE],
    );

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.candidate.person_id).toBe("person_levi");
    expect(result.matchedBy).toBe("slug");
  });

  test("requires handle overlap for alias-based resolution", () => {
    const resolved = resolvePerson(
      { alias: "Bestie", handles: ["+61412667520"] },
      [MELANIE_CANDIDATE],
    );
    expect(resolved.kind).toBe("resolved");

    const review = resolvePerson({ title: "Melanie" }, [MELANIE_CANDIDATE]);
    expect(review).toEqual({
      kind: "review",
      reason: "name-only-no-write",
      candidates: [],
    });
  });
});

describe("buildPersonPatch", () => {
  test("parses canonical arrays that use same-indent YAML list items", () => {
    const parsed = parsePeopleNote(`---
title: Richard Johnson
type: person
status: active
updated: 2026-03-21
summary: Close friend
person_id: person_richard_johnson
slug: richard-johnson
relationship_type: close-friend
aliases:
- Rich
source_handles:
  imessage:
  - +61497848278
---

## Relationship Profile

### Relationship

Friend`);

    expect(parsed.frontmatter.aliases).toEqual(["Rich"]);
    expect(parsed.frontmatter.source_handles).toEqual({
      imessage: ["+61497848278"],
    });
  });

  test("merges frontmatter, dedupes handles, and carries conflicts into open questions", () => {
    const existing = parsePeopleNote(`---
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
related_people:
  - person_levi
---

## Relationship Profile

### Relationship

Partner.

## Signals

- 2026-03-21: Existing signal

## Open Questions

- Existing open question`);

    const patch = buildPersonPatch({
      existing,
      person: MELANIE_CANDIDATE,
      updated: "2026-03-22",
      summary: "Nathan's partner, also known as Bestie",
      aliases: ["Sweetheart"],
      sourceHandles: { imessage: ["+61412667520"], email: ["mel@example.com"] },
      relationshipBlocks: [
        {
          heading: "Communication Pattern",
          content: "- Daily check-ins matter",
        },
      ],
      signals: {
        mode: "append",
        items: ["2026-03-22: Planned Easter trip together"],
      },
      conflicts: ["Message-count mismatch needs human review"],
      relatedPeople: ["person_levi", "person_marilyn_saxone"],
    });

    expect(patch.frontmatter.updated).toBe("2026-03-22");
    expect(patch.frontmatter.aliases).toEqual(["Bestie", "Sweetheart"]);
    expect(patch.frontmatter.source_handles).toEqual({
      email: ["mel@example.com"],
      imessage: ["+61412667520"],
    });
    expect(patch.frontmatter.related_people).toEqual([
      "person_levi",
      "person_marilyn_saxone",
    ]);
    expect(patch.openQuestions.items).toContain(
      "Message-count mismatch needs human review",
    );
  });
});

describe("applyPersonPatch", () => {
  test("preserves unknown H3 blocks while updating targeted relationship blocks", () => {
    const existing = `---
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
source_handles: {}
---

## Relationship Profile

**Relationship:** Partner

### Relationship

Existing relationship block.

### Our Unspoken Deal

Preserve this human-authored block.

## Signals

- 2026-03-21: Existing signal

## Open Questions

- Existing question`;

    const patch = buildPersonPatch({
      existing: parsePeopleNote(existing),
      person: MELANIE_CANDIDATE,
      updated: "2026-03-22",
      relationshipBlocks: [
        {
          heading: "Relationship",
          content: "Updated relationship block.",
        },
        {
          heading: "Communication Pattern",
          content: "- Daily check-ins matter",
        },
      ],
      signals: {
        mode: "append",
        items: ["2026-03-22: Planned Easter trip together"],
      },
    });

    const rendered = applyPersonPatch(existing, patch);

    expect(rendered).toContain("### Our Unspoken Deal");
    expect(rendered).toContain("Preserve this human-authored block.");
    expect(rendered).toContain("### Communication Pattern");
    expect(rendered).toContain("Updated relationship block.");
    expect(rendered).toContain("- 2026-03-21: Existing signal");
    expect(rendered).toContain("- 2026-03-22: Planned Easter trip together");
  });

  test("dedupes appended signals and open questions", () => {
    const existing = `---
title: Levi
type: person
status: active
updated: 2026-03-21
summary: Nathan's son
person_id: person_levi
slug: levi
relationship_type: child
aliases: []
source_handles: {}
---

## Relationship Profile

### Interests

- Music

## Signals

- 2026-03-21: Levi likes The Amazing Digital Circus

## Open Questions

- Existing question`;

    const patch = buildPersonPatch({
      existing: parsePeopleNote(existing),
      person: LEVI_CANDIDATE,
      updated: "2026-03-22",
      signals: {
        mode: "append",
        items: [
          "2026-03-21: Levi likes The Amazing Digital Circus",
          "2026-03-22: Considering King David for year 5",
        ],
      },
      openQuestions: {
        mode: "append",
        items: ["Existing question", "Which year should Levi move schools?"],
      },
    });

    const rendered = applyPersonPatch(existing, patch);

    const digitalCircusMatches = rendered.match(
      /Levi likes The Amazing Digital Circus/g,
    );
    expect(digitalCircusMatches).toHaveLength(1);
    expect(rendered).toContain("Which year should Levi move schools?");
  });

  test("can create a minimal stub when starting from no existing note", () => {
    const patch = buildPersonPatch({
      person: {
        title: "Sarah Chen",
        slug: "sarah-chen",
        relationship_type: "professional",
        aliases: [],
        source_handles: { email: ["sarah@example.com"] },
        frontmatter: {
          title: "Sarah Chen",
          type: "person",
          status: "active",
          updated: "2026-03-22",
          summary: "Professional contact",
          slug: "sarah-chen",
          relationship_type: "professional",
          aliases: [],
          source_handles: { email: ["sarah@example.com"] },
        },
      },
      updated: "2026-03-22",
      summary: "Person surfaced via calendar and email; identity appears unambiguous.",
      relationshipBlocks: [
        {
          heading: "Relationship",
          content: "Professional contact surfaced via calendar and email.",
        },
      ],
      signals: {
        mode: "append",
        items: ["2026-03-22: Surfaced via calendar invite and email thread"],
      },
    });

    const rendered = applyPersonPatch(null, patch);

    expect(rendered).toContain('person_id: person_sarah_chen');
    expect(rendered).toContain("## Relationship Profile");
    expect(rendered).toContain("### Relationship");
    expect(rendered).toContain("## Signals");
    expect(rendered).toContain("## Open Questions");
  });
});
