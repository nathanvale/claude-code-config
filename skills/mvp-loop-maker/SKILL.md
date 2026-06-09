---
name: mvp-loop-maker
description: "Create an MVP loop, maintainability loop, repo-improvement loop, or VISION.md when the user has a product idea, rough feature, prototype, seam, or asks for Build-Measure-Learn, TDD, shipping, reviewer, or ICA-style loops."
role: tool-workflow
---

# MVP Loop Maker

Use when the user wants to turn a product idea, rough feature, prototype, repo direction, or maintainability concern into a loop and a `VISION.md`.

Do not use for full PRDs, ticket breakdown, code review, implementation plans, or running reviewer swarms.

## Request Shape

- Input: user idea, existing prototype, repo docs, current conversation, or target `VISION.md`.
- Output: `VISION.md` draft or patch.
- Missing product idea: ask one question.
- Missing target path: default to repo-root `VISION.md` and state the assumption.
- Existing `VISION.md`: read it before drafting or patching.
- Maintainability input: seam, repo area, repeated failure, review finding, or unclear owner path.

## Pick One

Offer these three loops:

- **Build-Measure-Learn**: choose when market, user, value, or adoption risk is highest.
- **Red-Green-Refactor**: choose when correctness, API behavior, or implementation uncertainty is highest.
- **Ship-Observe-Improve**: choose when integration, production feedback, reliability, or usage telemetry is highest.

For repo maintainability, use the Maintainability Loop below instead of forcing the work into one of the three MVP loops.

Default:

- Recommend Build-Measure-Learn for greenfield MVPs.
- Recommend Red-Green-Refactor for narrow engineering features.
- Recommend Ship-Observe-Improve for deployed products or operational workflows.
- Recommend the Maintainability Loop for repo health, skill quality, seam design, or code clarity work.

## Maintainability Loop

Use this loop when the product is the repo's future changeability:

```text
Pick seam -> review maintainability -> find ICA candidates -> choose one bet -> patch small -> validate -> repeat
```

Steps:

1. Name the seam or repo area.
2. Name the maintainability pain.
3. Choose reviewer lenses: maintainer, new-agent, testability, contract, or ICA candidate.
4. Gather read-only findings.
5. Drop weak claims.
6. Pick one maintainability bet.
7. Patch the smallest owner path.
8. Validate with checks and a before/after claim.
9. Capture the next loop action.

Validation:

- Mechanical checks pass.
- Owner paths resolve.
- First-screen route clarity improves.
- Duplicated prose or copied contracts decrease.
- A fresh-agent task has a clearer next safe action.
- Adversary review finds no new owner ambiguity.

## Workflow

1. Read available idea, repo docs, prototype notes, or current conversation.
2. Name the stressed risk in one sentence.
3. Recommend one loop.
4. Offer relevant alternatives in one line each.
5. Draft or patch `VISION.md`.
6. End with the next loop action.

## VISION.md Shape

Use this shape unless the existing file has a stronger local format:

```markdown
# Vision

## Product Bet

- [One-sentence bet.]

## User

- [Primary user.]
- [Pain or job.]

## Loop

- Chosen loop: [Build-Measure-Learn | Red-Green-Refactor | Ship-Observe-Improve | Maintainability Loop]
- Why this loop: [Stressed risk.]

## MVP Slice Or Repo Slice

- [Smallest useful slice.]

## Measure

- [Signal that proves the slice helped.]

## Validate

- [Check, review, trial, or before/after evidence.]

## Stop Or Pivot

- Stop: [Condition that means the loop succeeded.]
- Pivot: [Condition that means change direction.]

## Next Action

- [One concrete action.]
```

## Safety

- Do not invent user research, metrics, customers, revenue, or production facts.
- Mark unsupported assumptions as assumptions.
- Keep the MVP slice smaller than the product vision.
- Do not overwrite an existing `VISION.md`; patch the smallest useful section.
- Do not dispatch reviewer or ICA swarms unless the user explicitly asks to run them.

## Next Safe Action

- If the user asks only for options, return relevant loops and a recommendation.
- If the user asks to capture the vision, write or patch `VISION.md`.
- If the user asks for maintainability, draft the Maintainability Loop and validation evidence.
- If the repo already has a planning owner, follow that format and name the owner path.
