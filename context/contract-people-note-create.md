# People Note Output Contract (Create Mode)

Use this when Perel-Baldwin is authoring a fresh `EnrichmentReport` from an explicitly supplied `ContextBundle` plus evidence.

Canonical specs:
- nearest owning `context/people/` contract or repo-local people-note spec
- nearest owning Perel-Baldwin create-mode spec, when present
Runtime type:
- none in this repo; emit structured people-note proposals and route write authority through `skills/context-advisor/SKILL.md`

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

## Authoring Instructions

You are authoring a new `EnrichmentReport`, not rewriting an existing one.

- Choose 3-7 `relationship_profile` headings
- Use `relationship_type` plus the canonical routing table to select headings
- Include only headings supported by evidence or strong human context
- Treat deep relational headings as hypotheses when evidence is interpretive rather than direct
- If a field is unsupported, omit it instead of inventing it

## Evidence Discipline

Create mode needs explicit upstream evidence beyond the target note alone whenever possible.

Preferred evidence kinds:
- `analyst-report`
- `search-findings`
- `psychometrics`
- `thread-summary`
- `argument-summary`

If the evidence is thin:
- choose conservative headings
- keep prose compact
- use `open_questions` for uncertainty
- avoid pseudo-depth

## Field Guidance

- `summary` should be compact and retrieval-friendly
- `relationship_profile[].content` should optimize for attunement and follow-through, not dossier-writing
- `signals` should be concise durable bullets only
- `open_questions` should be concrete and decision-oriented
- `conflicts` should surface meaning-level disagreement instead of flattening it

## Failure Conditions

The output is invalid when:
- JSON does not parse
- `relationship_profile` is missing or empty
- headings ignore the routing table without evidence-based reason
- the model invents unsupported facts or overconfident relational claims
