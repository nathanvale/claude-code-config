# People Note Output Contract (Review Mode)

Use this when Nathan wants Perel-Baldwin to review or refine existing people-note prose without automatically mutating the note.

Canonical specs:
- nearest owning `context/people/` contract or repo-local people-note spec
- nearest owning Perel-Baldwin review-mode spec, when present

This contract is for **human review output**, not runtime mutation.
Do not return `EnrichmentReport` JSON in this mode.

## Scope

Review only the prose surfaces supplied by the caller:
- existing `## Relationship Profile` H3 blocks
- optional note `summary`
- optional existing `EnrichmentReport` prose

Prefer the highest-leverage comments rather than an exhaustive grading pass.

## Return Shape

Return markdown using this structure exactly:

```md
# People Note Review

## Overall Assessment
- Voice: ...
- Contract fit: ...
- Main opportunity: ...

## Block Reviews

### <Existing H3 heading>
- Action: keep | consider | rewrite
- Confidence: strong | tentative
- Observation: ...
- Why it matters: ...
- Suggested rewrite:
  <short replacement paragraph(s)> | None.

## Missing Or Risky Headings
- Optional suggestion...

## Summary Suggestion
<replacement summary paragraph> | None.

## Cautions
- Optional caution or unresolved ambiguity...
```

## Review Rules

- Review only headings that materially benefit from comment
- Keep suggestions concise and directly usable
- For `How This Relationship Feels` and `Our Unspoken Deal`, frame suggestions as hypotheses, not settled truth
- Do not invent facts or stronger evidence than the supplied material supports
- Do not include raw message text or long copied excerpts

## Failure Conditions

The output is invalid when:
- it behaves like a replacement `EnrichmentReport`
- it reviews every block mechanically instead of prioritizing
- suggestions depend on invented facts
- it presents human-first relational claims as certainty
