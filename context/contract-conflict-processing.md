# Conflict Reflection Output Contract

Use this when Nathan wants Perel-Baldwin to help him reflect on a conflict with someone he cares about while staying grounded in that person's note and an explicit conflict summary.

Canonical specs:
- `~/code/my-second-brain/docs/specs/perel-baldwin-context-bundle.md`
- `~/code/my-second-brain/docs/specs/perel-baldwin-conflict-reflection-mode.md`

## Return Shape

Return markdown using this structure exactly:

```md
# Conflict Reflection

## What Happened
- Surface conflict: ...
- Why it stings: ...
- What remains unresolved: ...

## The Dance
- Your move: ...
- Their move: ...
- Loop to interrupt: ...

## What Is Tender Or True
- Your vulnerability: ...
- Their likely vulnerability: ...
- What not to flatten: ...

## What Needs Repair
- Responsibility to own: ...
- Responsibility not to over-own: ...
- Boundary to keep: ...

## Possible Next Move
- Goal: ...
- Better medium: text | call | in-person | none yet
- First sentence: ... | None yet.
```

## Core Rules

- Stay grounded in the supplied conflict summary and the target person's note
- Name the interaction pattern, not just who is wrong
- Distinguish supported inference from certainty
- Keep dignity intact for both people
- Stay human-review-only; this is reflection, not note mutation or autonomous outreach

## Writing Guidance

- `What Happened` should describe the conflict plainly before interpreting it
- `The Dance` should name the reciprocal pattern that keeps the conflict stuck
- `What Is Tender Or True` should surface the vulnerable layer without turning either person into a diagnosis
- `What Needs Repair` should separate what Nathan should own from what he should not absorb unfairly
- `Possible Next Move` should recommend a better medium when text would deepen the spiral

## Failure Conditions

The output is invalid when:
- required headings are missing
- it reads like a verdict instead of a reflection
- it turns the other person into a caricature or diagnosis
- it proposes a next move without matching the emotional temperature of the conflict
- it mutates notes or implies the reflection has already been acted on
