---
title: "Review Note Contract"
type: contract
status: active
updated: 2026-03-23
summary: "When to use type: review, where review notes live, and the minimum contract they should follow."
---

# Review Note Contract

## Purpose

Use `type: review` for documents whose main job is evaluation.

A review note assesses a target against explicit criteria and produces:

- findings
- open questions where needed
- a verdict
- follow-up actions when the review leads to work

## When To Use `review`

Use `review` when the primary question is one of these:

- Is this good?
- What is wrong with this?
- Does this meet the bar?
- What should change next?

Common examples:

- prompt-system audits
- architecture reviews
- implementation reviews
- rollout readiness reviews
- post-implementation quality reviews
- design fidelity reviews

## Nearby Types

- `research` gathers evidence and understanding
- `review` evaluates a target against a bar
- `decision` records a choice and rationale
- `log` records what happened

One artifact can produce multiple note types:

- research to gather evidence
- review to judge the current state
- decision to record the chosen next move

## Default Home

Store review notes in:

- `docs/reviews/`

Use a standalone review note when the evaluation has durable retrieval value, multiple findings, or a verdict worth revisiting later.

Keep the review inline or in a PR/review tool when the content is highly transient and has no durable value beyond the immediate thread.

## Memory Layer

Most reviews are mixed:

- semantic because the findings and verdict can matter later
- episodic because the review reflects the state of a target at a specific time

Default to repo-local ownership. Promote upward only when the review reveals a cross-project pattern or durable lesson.

## Minimum Frontmatter

Use the smallest shape that helps retrieval:

```yaml
---
title: "Human-readable review title"
type: review
status: complete
updated: YYYY-MM-DD
summary: "What was reviewed and the main conclusion"
related:
  - path/to/spec-or-artifact.md
review_target: path/or-system
review_scope: repo|feature|system|artifact|workflow
verdict: pass|mixed|fail
---
```

Notes:

- `review_target` should identify what was evaluated
- `review_scope` helps retrieval; keep it small and stable
- `verdict` should stay coarse

## Suggested Body Shape

Use this structure by default:

```md
# Review Title

## Context
## Review Target
## Criteria
## Findings
## Open Questions
## Verdict
## Follow-ups
```

You can omit `Open Questions` or `Follow-ups` when empty.

## Writing Rules

- Findings should be specific and evidence-backed
- Separate findings from fixes
- Keep the verdict concise and coarse
- Cross-link to the reviewed artifact rather than copying large chunks
- Preserve provenance when the review draws on external artifacts or prior research

## Status Guidance

- `active` for a draft review still being developed
- `complete` for a finished review with a stable verdict
- `superseded` when a newer review replaces it
