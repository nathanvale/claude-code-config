import { describe, expect, test } from "bun:test";
import { applyEnrichmentReport, buildPatchFromEnrichmentReport } from "./apply-enrichment";

const EXISTING_RICHARD_NOTE = `---
title: Richard Johnson
type: person
status: active
updated: 2026-03-21
summary: Close friend and fellow software engineer.
person_id: person_richard_johnson
slug: richard-johnson
relationship_type: close-friend
aliases:
  - Rich
source_handles:
  imessage:
    - +61497848278
    - richard.johnson159@gmail.com
enrichment:
  source: imessage
  tier: 1
  last_run_at: 2026-03-21T00:00:00.000Z
---

## Relationship Profile

**Relationship:** Close friend

### Relationship

Older relationship summary.

### Our Unspoken Deal

Keep this human block intact.

## Signals

- Existing signal that should stay

## Open Questions

- Existing open question`;

describe("buildPatchFromEnrichmentReport", () => {
  test("maps structured enrichment JSON into the shared writer patch shape", () => {
    const patch = buildPatchFromEnrichmentReport(
      EXISTING_RICHARD_NOTE,
      {
        summary: "Updated Richard summary",
        relationship_profile: [
          {
            heading: "Relationship",
            content: "Fresh relationship synthesis.",
          },
          {
            heading: "Support Pattern",
            content: "Nathan often encourages Richard around career decisions.",
          },
        ],
        signals: ["2026-03-22: Richard asked about Levi and Mario."],
        open_questions: ["Has Richard resolved the 2025 workplace dispute?"],
        conflicts: ["Legacy note cited 948 messages before stats refresh."],
        enrichment: {
          source: "imessage",
          tier: 1,
          last_run_at: "2026-03-22T09:00:00+11:00",
        },
      },
      "2026-03-22",
    );

    expect(patch.frontmatter.updated).toBe("2026-03-22");
    expect(patch.frontmatter.summary).toBe("Updated Richard summary");
    expect(patch.frontmatter.enrichment).toEqual({
      source: "imessage",
      tier: 1,
      last_run_at: "2026-03-22T09:00:00+11:00",
    });
    expect(patch.relationshipBlocks).toHaveLength(2);
    expect(patch.openQuestions.items).toContain(
      "Legacy note cited 948 messages before stats refresh.",
    );
  });
});

describe("applyEnrichmentReport", () => {
  test("updates targeted H3 blocks and keeps unknown human-authored blocks", () => {
    const next = applyEnrichmentReport(
      EXISTING_RICHARD_NOTE,
      {
        summary: "Close friend and fellow software engineer.",
        relationship_profile: [
          {
            heading: "Relationship",
            content:
              "Close friendship grounded in shared tech industry experience and recurring catch-ups.",
          },
          {
            heading: "Communication Pattern",
            content:
              "2,013 direct messages across the friendship, with bursts around catch-up planning and birthdays.",
          },
        ],
        signals: [
          "2026-03-22: First iMessage 2015-07-03; most recent 2026-03-08",
          "2026-03-22: 2,013 total messages (915 inbound, 1,098 outbound)",
        ],
        open_questions: [
          "Did Nathan and Richard work at the same company, or in adjacent roles?",
        ],
        conflicts: ["Legacy note cited 948 messages before stats refresh."],
        enrichment: {
          source: "imessage",
          tier: 1,
          last_run_at: "2026-03-22T09:00:00+11:00",
        },
      },
      "2026-03-22",
    );

    expect(next).toContain("### Our Unspoken Deal");
    expect(next).toContain("Keep this human block intact.");
    expect(next).toContain("### Communication Pattern");
    expect(next).toContain(
      "Close friendship grounded in shared tech industry experience and recurring catch-ups.",
    );
    expect(next).toContain("- Existing signal that should stay");
    expect(next).toContain(
      "- 2026-03-22: 2,013 total messages (915 inbound, 1,098 outbound)",
    );
    expect(next).toContain("Legacy note cited 948 messages before stats refresh.");
    expect(next).toContain('last_run_at: "2026-03-22T09:00:00+11:00"');

    const companyQuestionMatches = next.match(
      /Did Nathan and Richard work at the same company, or in adjacent roles\?/g,
    );
    expect(companyQuestionMatches).toHaveLength(1);

    const firstMessageMatches = next.match(/First iMessage/g);
    expect(firstMessageMatches).toHaveLength(1);
  });
});
