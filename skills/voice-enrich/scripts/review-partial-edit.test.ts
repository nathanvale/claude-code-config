import { describe, expect, test } from "bun:test";
import {
  applyReviewPartialEditPlan,
  buildReviewPartialEditPlan,
  parseReviewMarkdown,
} from "./review-partial-edit.ts";

const REVIEW_MARKDOWN = `# People Note Review

## Overall Assessment
- Voice: Warm but slightly overconfident in places.
- Contract fit: Mostly aligned.
- Main opportunity: Tighten the relational claims to what the evidence clearly supports.

## Block Reviews

### Relationship
- Action: rewrite
- Confidence: strong
- Observation: The current block is accurate but flat.
- Why it matters: This heading sets the tone for the rest of the note.
- Suggested rewrite:
  Richard is a close friend whose bond with Nathan is grounded in humor, reliability, and the kind of easy familiarity that does not need constant upkeep to stay real.

### Our Unspoken Deal
- Action: consider
- Confidence: tentative
- Observation: The claim reaches a bit further than the evidence.
- Why it matters: This is a human-first heading.
- Suggested rewrite:
  None.

## Missing Or Risky Headings
- Optional suggestion...

## Summary Suggestion
Richard is a close friend whose connection with Nathan feels steady, supportive, and durable without needing constant contact.

## Cautions
- Optional caution or unresolved ambiguity...`;

const EXISTING_NOTE = `---
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
source_handles: {}
---

## Relationship Profile

### Relationship

Old relationship block.

### Our Unspoken Deal

Keep this human-authored block.

## Signals

- Existing signal that should stay

## Open Questions

- Existing open question`;

describe("parseReviewMarkdown", () => {
  test("extracts block actions and the optional summary suggestion", () => {
    const parsed = parseReviewMarkdown(REVIEW_MARKDOWN);

    expect(parsed.summarySuggestion).toBe(
      "Richard is a close friend whose connection with Nathan feels steady, supportive, and durable without needing constant contact.",
    );
    expect(parsed.blockReviews).toEqual([
      {
        heading: "Relationship",
        action: "rewrite",
        confidence: "strong",
        suggestedRewrite:
          "Richard is a close friend whose bond with Nathan is grounded in humor, reliability, and the kind of easy familiarity that does not need constant upkeep to stay real.",
      },
      {
        heading: "Our Unspoken Deal",
        action: "consider",
        confidence: "tentative",
        suggestedRewrite: undefined,
      },
    ]);
  });

  test("extracts the actual replacement summary when the review wraps it in commentary", () => {
    const parsed = parseReviewMarkdown(`# People Note Review

## Overall Assessment
- Voice: ...
- Contract fit: ...
- Main opportunity: ...

## Block Reviews

### Relationship
- Action: keep
- Confidence: strong
- Observation: ...
- Why it matters: ...
- Suggested rewrite: None.

## Missing Or Risky Headings
- None.

## Summary Suggestion
The current summary is strong but long for a frontmatter field. Consider tightening to:

"Melanie Strang — Nathan's partner since October 2023."

## Cautions
- None.`);

    expect(parsed.summarySuggestion).toBe(
      "Melanie Strang — Nathan's partner since October 2023.",
    );
  });
});

describe("buildReviewPartialEditPlan", () => {
  test("keeps the plan explicit and narrow", () => {
    const plan = buildReviewPartialEditPlan(REVIEW_MARKDOWN);

    expect(plan).toEqual({
      source: "review-markdown",
      policy: "preview-only",
      operations: [
        {
          op: "replace-summary",
          content:
            "Richard is a close friend whose connection with Nathan feels steady, supportive, and durable without needing constant contact.",
        },
        {
          op: "replace-relationship-block",
          heading: "Relationship",
          content:
            "Richard is a close friend whose bond with Nathan is grounded in humor, reliability, and the kind of easy familiarity that does not need constant upkeep to stay real.",
          confidence: "strong",
        },
      ],
    });
  });
});

describe("applyReviewPartialEditPlan", () => {
  test("previews only the explicitly suggested summary and H3 rewrites", () => {
    const plan = buildReviewPartialEditPlan(REVIEW_MARKDOWN);
    const next = applyReviewPartialEditPlan(EXISTING_NOTE, plan, "2026-03-23");

    expect(next).toContain(
      'summary: "Richard is a close friend whose connection with Nathan feels steady, supportive, and durable without needing constant contact."',
    );
    expect(next).toContain(
      "Richard is a close friend whose bond with Nathan is grounded in humor, reliability, and the kind of easy familiarity that does not need constant upkeep to stay real.",
    );
    expect(next).toContain("### Our Unspoken Deal");
    expect(next).toContain("Keep this human-authored block.");
    expect(next).toContain("- Existing signal that should stay");
  });
});
