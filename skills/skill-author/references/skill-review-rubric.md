# Skill Review Rubric

Use for review-only runs of existing `SKILL.md` files.

Do not impersonate rubric authors. Use the rubric as a review lens.

## Purpose

- Return findings.
- Do not patch unless the user asks for edits.
- Deepen only where target evidence appears.
- Stop once findings and next safe action are clear.

## Trigger

- Check the description for concrete trigger phrases.
- Check that routing starts from the user's request shape.
- Check that the invocation lane is explicit or safely inherited: `model lane` or `self invocation lane`.
- Flag vague summaries, personal-name leakage, and near-duplicate skill overlap.

## Structure

- Check first-screen `thin router` shape.
- Check `current step only` loading.
- Flag missing no-args front door.
- Flag oversized entry screens.
- Flag branch-only detail in `SKILL.md`.
- Flag duplicated owner paths or copied deterministic contracts.
- Check that branch-hidden detail lives in `references/`.

## Steering

- Check that the first safe action is obvious.
- Check that missing input, blocked state, and handoff paths are named.
- Check that safety gates block before action on private data, durable writes, external sends, destructive operations, wrong authority, or stale auth.
- Check that exact flags, schemas, states, and output envelopes point at their `single source of truth`.

## Pruning

- Apply the `deletion test` to the selected branch.
- Flag no-op headings.
- Flag sediment: install boilerplate, changelogs, TODOs, licenses, duplicated examples, or broad background.
- Flag strong defaults treated as cumulative checklists.

## Workflow Fitness

- Use `references/skill-workflow-fitness-probes.md` only when reviewing a skill-authoring workflow or when the user asks whether the workflow works in practice.
- Keep ordinary static reviews on this rubric.
- Do not load edit gates for workflow probes unless the user asks to patch findings.

## Review Output Shape

- Lead with findings by severity.
- For each finding, name path, line, rubric failure, consequence, and suggested direction.
- Note open questions only when they block the review.
- Note checks not run.
- Use `Skill follow-up:` in normal final responses.

## Next Safe Action

- If the user asks to patch findings, switch to `references/skill-design-decision-runbook.md`.
- If evidence is missing, inspect the owner path before asking.
- If review scope is ambiguous, choose the narrowest named target.
