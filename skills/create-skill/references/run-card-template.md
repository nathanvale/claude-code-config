# Run Card Template

Use when a skill workflow is long, branching, slow, side-effectful, or needs several verification passes.

Do not use for small advisor, reference, or one-shot skills.

Do not retrofit existing skills only to add this pattern.

Do not link this template directly from `SKILL.md` unless first-screen route evidence shows agents need it there.

Do not add Run Card lint or audit scripts until observed drift, repeated missed reviews, or a machine-checkable contract exists.

## Owner Paths

- Vocabulary: `skills/create-skill/CONTEXT.md#run-card`.
- Routing owner: `references/skill-body-shape-gate.md#run-card`.
- Skill shape examples: `references/skill-io-shape-examples.md`.

## Author Template

Copy this shape into the skill body or a one-level reference when it reduces first-minute load.

```markdown
## Run Card

- Scope: name the task family, boundary, and non-goals.
- Defaults: name mode, working directory, inputs, outputs, and confirmation gates.
- First safe action: name the first read, command, tool call, or user question.
- Visible state: name temp files, generated artifacts, external state, side effects, and skipped checks.
- Verify: name the focused checks, claim checks, or manual inspection steps.
- Publish: name the expected final answer, artifact, handoff, or status shape.
- Fallback: name missing tools, missing evidence, blocked state, degraded state, and next safe action.
```

## Review Prompts

- Does the Run Card reduce the next agent's first-minute load?
- Does it expose slow work before the agent starts?
- Does it put defaults beside the inputs they affect?
- Does it expose changed state, generated artifacts, and skipped checks?
- Does it name the verification path without copying exact contracts?
- Does it name a fallback without inventing a second workflow?
- Does it stay optional for skills that do not need it?

## Next Safe Action

- If the workflow is short and linear, omit the Run Card.
- If an existing skill has no first-minute friction evidence, leave it alone.
- If the workflow is complex but the boundary is unclear, grill the skill boundary before writing the Run Card.
- If the Run Card copies flags, schemas, state machines, or output semantics, replace those copies with owner paths.
- If Run Card reviews drift repeatedly, propose the smallest machine-checkable audit before adding a script.
