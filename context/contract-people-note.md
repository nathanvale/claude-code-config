# People Note Output Contract (Rewrite Mode)

Phase 1 scope: **rewrite mode only** -- transform the narrative quality of an existing EnrichmentReport.

For other modes:
- review mode -> `context/contract-people-note-review.md`
- create mode -> `context/contract-people-note-create.md`

Canonical spec: nearest owning `context/people/` contract or repo-local people-note spec.
Runtime owner: none in this repo. `productivity-sync` emits structured people-note proposals and routes write authority through `skills/context-advisor/SKILL.md`.

## EnrichmentReport JSON Schema

Return valid JSON matching this schema exactly:

```typescript
{
  summary?: string;
  relationship_profile: Array<{ heading: string; content: string }>;
  signals?: string[];
  signal_mode?: "append" | "replace";
  open_questions?: string[];
  open_questions_mode?: "append" | "replace";
  conflicts?: string[];
  aliases?: string[];
  source_handles?: Record<string, string[]>;
  relationship_type?: string;
  related_people?: string[];
  enrichment?: { source: string; tier?: number; last_run_at?: string };
}
```

## Transform Instructions

You are transforming the narrative quality of `relationship_profile[].content` and optionally `summary`. All other fields pass through unchanged from the input data.

### What you rewrite

- `relationship_profile[].content` -- apply Perel-Baldwin voice to each block's prose
- `summary` -- optionally rewrite for warmth and precision

### What passes through unchanged

Unless the caller explicitly intends otherwise, preserve these fields exactly from input:

- `relationship_profile[].heading` -- do not rename headings
- `signals`, `signal_mode`
- `open_questions`, `open_questions_mode`
- `conflicts`
- `aliases`, `source_handles`
- `relationship_type`, `related_people`
- `enrichment`

If a field is absent from input, do not invent it.

## Relational Writing Guidance

When rewriting prose, keep these principles active:

- The core question is: **What helps Nathan show up well for this person over time?**
- Write for attunement, care, follow-through, and relational continuity -- not a dossier
- Headings marked "Human-first" in the note contract (e.g., "How This Relationship Feels", "Our Unspoken Deal") should be treated as hypotheses, not settled truth
- Headings marked "Machine-friendly" (e.g., "Before I See Them Next") can be more direct
- Prefer 3-7 relationship_profile blocks -- enough depth without taxonomy explosion
- Every block should be supported by evidence or strong human context

## Privacy Rules

- No raw message bodies or long copied excerpts
- No verbatim quotes from private communications unless exceptionally justified
- Prefer compact, durable synthesis

## Failure Conditions

The output is invalid when:
- JSON does not parse
- `relationship_profile` is missing or empty
- pass-through fields are dropped or rewritten without explicit instruction
- headings are renamed without cause
- the model invents facts without evidence in the supplied context
