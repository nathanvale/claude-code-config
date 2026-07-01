# Handoff: Fresh Rubric Review Of `create-cli`

Focus: hand off to another agent for a fresh review of whether `create-cli`
helps agents design small, effective CLI surfaces without bloating skill prose.

User phrasing: "review the create-cli skill with the Matt peacock rubric and
the new skill-author skill."

Interpret "Matt peacock rubric" as the public skill-quality rubric used in this
repo. Do not impersonate anyone. Use only:

- Trigger.
- Structure.
- Steering.
- Pruning.

## Current Objective

Run a fresh review of `skills/create-cli/SKILL.md` as a skill, using the current
canonical `skill-author` review workflow.

The next agent should answer:

- Does `create-cli` trigger only for CLI design/spec requests?
- Does it route Basic CLI, Agent-native CLI, and Facade-backed CLI without
  excess context load?
- Does it keep `SKILL.md` as a `thin router`, or does the first screen carry
  branch-only detail?
- Does it steer agents to owner paths for exact flags, schemas, parser rules,
  facade envelopes, generated docs, and tests?
- Does it prevent Bun TypeScript from being misread as Facade-backed by default?
- Does it make no-args or ambiguous use safe?
- Does it reduce CLI design drift in practice, or just describe good CLI design?
- Where would a normal agent still overproduce specs, copy contracts, or skip
  safety/verification?
- What precise changes, if any, would improve workflow success?

Return findings only unless the user explicitly asks to patch.

## Required Workflow

Use `skill-author` as the review owner.

1. Read `skills/skill-author/SKILL.md`.
2. Read `skills/skill-author/references/skill-design-decision-runbook.md`.
3. Read `skills/skill-author/references/skill-review-rubric.md`.
4. Review target `skills/create-cli/SKILL.md`.
5. Open only the smallest relevant `create-cli` branch references needed to
   test actual routing.
6. Preserve review-only behavior: do not patch.

Use `skill-author` workflow-fitness probes only if you are reviewing whether
`create-cli` works in practice as a skill workflow. Otherwise stay with the
static review rubric.

## Current Repo State

Repo: `/Users/nathanvale/code/claude-code-config`

Current branch:

- `chore/skill-feedback-tracker-reconcile`

Recent relevant commits:

- `f91ec894 fix(skill-feedback): point closeout example at skill-author`
- `2576e2a9 fix(skill-author): preserve canonical authoring routes`
- `df832219 fix(skill-author): close rubric workflow gaps`
- `1ba62a89 fix(skill-feedback): keep skill route thin`
- `16486f88 fix(skill-author): harden workflow routing`
- `6ff85dee fix(skill-author): make skill-author the canonical workflow`
- `4d6bf40a fix(create-skill): enforce thin-router pruning gates`
- `9344e427 fix(create-skill): align skill review routing`

Current dirty state at handoff creation:

- Several `skills/skill-feedback/` files are modified.
- Untracked plan file exists:
  `docs/plans/2026-06-30-001-fix-skill-author-workflow-hardening-plan.md`

Treat those as unrelated unless the user says otherwise.

## Rubric Source

Use this matrix.

| Lens | Review Question |
|---|---|
| Trigger | Does `create-cli` route CLI design requests by concrete trigger phrases without grabbing unrelated implementation or skill-authoring work? |
| Structure | Does `SKILL.md` stay first-screen and branch-selecting, with lane detail hidden behind `references/`? |
| Steering | Does it name first safe action, ambiguity behavior, owner paths, safety gates, and exact-contract owners? |
| Pruning | Does it avoid copied schemas, generated envelopes, parser rules, facade fields, command catalogues, helper signatures, examples-as-contracts, and unearned checklists? |

## Relevant Paths

Primary review target:

- `skills/create-cli/SKILL.md`

Likely branch references:

- `skills/create-cli/references/cli-guidelines.md`
- `skills/create-cli/references/agent-native-cli-design.md`
- `skills/create-cli/references/cli-command-facade.md`
- `skills/create-cli/references/cli-front-door-layouts.md`
- `skills/create-cli/references/behavior-regression-checklist.md`

Supporting skill-author paths:

- `skills/skill-author/SKILL.md`
- `skills/skill-author/references/skill-design-decision-runbook.md`
- `skills/skill-author/references/skill-review-rubric.md`
- `skills/skill-author/references/skill-workflow-fitness-probes.md`
- `skills/skill-author/references/skill-body-shape-gate.md`
- `skills/skill-author/references/skill-owner-path-gate.md`
- `skills/skill-author/references/skill-safety-gate.md`
- `skills/skill-author/references/skill-verification-gate.md`

## Required Review Probes

Run these as mental or practical probes. Return findings; do not patch.

1. No-args / ambiguous CLI design:
   - Prompt shape: invoke `create-cli` with no args, or "make a CLI".
   - Expected behavior: ask or show the lane router; do not invent a full spec.

2. Basic shell CLI:
   - Prompt shape: "Design a shell CLI for archiving old log files."
   - Expected behavior: Basic CLI route; compact human-first spec; no
     agent-native or facade ceremony.

3. Ambiguous Bun TypeScript CLI:
   - Prompt shape: "Create a Bun TypeScript CLI for checking project health."
   - Expected behavior: ambiguous lane router; Bun TypeScript alone does not
     imply Facade-backed.

4. Agent-native CLI:
   - Prompt shape: "Design an agent-native Python CLI agents can parse and
     recover from."
   - Expected behavior: Agent-native route; owner naming; runtime-contract
     minimum; no facade requirement unless earned.

5. Facade-backed CLI:
   - Prompt shape: "Create a facade-backed Bun TypeScript CLI using
     @side-quest/cli-command-facade."
   - Expected behavior: Facade-backed route; applies agent-native first; opens
     facade reference; names contract, model, engine, discovery, CLI, and test
     owners; does not copy facade fields into `SKILL.md`.

6. Skill edit:
   - Prompt shape: "Update create-cli routing."
   - Expected behavior: run or consult `references/behavior-regression-checklist.md`
     before and after meaningful edits.

7. Overlap with `skill-author`:
   - Prompt shape: "create a skill that wraps a CLI with JSON output and durable
     writes."
   - Expected behavior: `skill-author` owns skill creation and calls
     `create-cli` only for the CLI surface; `create-cli` should not become a
     duplicate skill-authoring workflow.

## Review Output Shape

Lead with findings by severity.

For each finding, include:

- path and line
- rubric lens
- consequence
- suggested direction

Then include:

- probes run
- probes skipped and why
- checks not run
- "Skill follow-up:" note

## Cautions

- Do not patch unless explicitly asked.
- Do not add a `create-skill` bridge.
- Do not treat historical `create-skill` mentions in old docs/tests as active
  owner drift unless a live owner-path check proves it.
- Do not copy exact CLI contracts from `create-cli` references into this
  handoff or into `SKILL.md`.
- If current docs for vendor behavior matter, refresh sources before making
  rule claims.
