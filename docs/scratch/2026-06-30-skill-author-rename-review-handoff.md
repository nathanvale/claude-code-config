# Handoff: Fresh Workflow Review Of `skill-author`

Focus: hand off to another agent for a fresh review of whether `skill-author`
actually helps agents create and review small, effective skills after the
`create-skill` rename.

User intent:

- Rename `create-skill` to `skill-author`.
- Keep no-args/no-target behavior as a menu.
- Run a fresh workflow-fitness review like the previous rubric review.
- Decide where workflow probes should live.

Use only the public skill-quality rubric:

- Trigger.
- Structure.
- Steering.
- Pruning.

Do not impersonate anyone.

## Current Objective

Run a fresh review of `skill-author` as the renamed skill-authoring workflow.

The next agent should answer:

- Does `skill-author` actually help an agent create a good new skill?
- Does it actually help an agent review an existing skill?
- Does the rename improve routing clarity compared with `create-skill`?
- Does it reduce skill hell in practice, or just talk about reducing it?
- Where would a normal agent still produce bloated `SKILL.md` files?
- Where would a normal agent still miss branch-only references, owner paths, pruning, or no-args menu behavior?
- Where should workflow probes live: `skill-review-rubric.md`, a new review reference, or the driver `SKILL.md`?
- What precise changes would improve workflow success?

This is a review handoff, not an implementation request.

## Rename Plan

Planned rename path:

1. Rename source bundle from `skills/create-skill/` to `skills/skill-author/`.
2. Change frontmatter `name` to `skill-author`.
3. Change visible title to `Skill Author`.
4. Update startup and active skill owner paths to `skills/skill-author/...`.
5. Keep exact contracts in scripts and references; update command paths only.
6. Keep no-args/no-target route as menu.
7. Do not add a `create-skill` bridge unless active-reference evidence proves it is needed.
8. Run description audit, owner-path check, startup check, and YAML parse.
9. Leave historical decision/ideation docs alone unless the review finds they act as live owner paths.

## Current Repo State

Repo: `/Users/nathanvale/code/claude-code-config`

Branch at handoff time:

- `chore/skill-feedback-tracker-reconcile`

Expected dirty work from this rename:

- `AGENTS.md`
- `CONTEXT-MAP.md`
- `scripts/agent-instructions.sh`
- `scripts/multi-agent-smoke-lib.ts`
- `skills/create-skill/` renamed to `skills/skill-author/`
- `docs/scratch/2026-06-30-skill-author-rename-review-handoff.md`

Unrelated dirty work exists under `skills/skill-feedback/`. Preserve it.

## Recently Completed Work

- `skills/create-skill/` renamed to `skills/skill-author/`.
- `skills/skill-author/SKILL.md` frontmatter name changed to `skill-author`.
- H1 changed to `Skill Author`.
- No-args/no-target route kept as menu.
- Active non-doc references under `AGENTS.md`, `CONTEXT-MAP.md`, `scripts/`, and `skills/` now point at `skills/skill-author/...`.
- Smoke prompt field names changed from `createSkill...` to `skillAuthor...`.
- `.coding-task-tracker/repo.json` owner key changed to `skill-author`.
- Role management was removed from `skill-author`; existing `role:` frontmatter in other skills is legacy metadata, not an enforced workflow.

## Rubric Source

Video:

- `https://youtu.be/UNzCG3lw6O0?si=0zSe7mVVCjD3k2Di`

Use a fresh transcript if needed:

```bash
summarize "https://youtu.be/UNzCG3lw6O0?si=0zSe7mVVCjD3k2Di" --youtube auto --extract --timestamps
```

Useful timestamp anchors from prior extraction:

- `2:22`: trigger, structure, steering, pruning checklist.
- `5:09`: user-invoked vs model-invoked context load.
- `7:29`: skills as steps plus reference.
- `8:56`: keep `SKILL.md` small.
- `9:34`: hide branch-only material behind context pointers.
- `12:17`: leading words steer agent behavior.
- `15:46`: split skills when a step needs more legwork.
- `16:48`: pruning failure modes: massive skills, duplication, sediment, no-ops.

## Relevant Paths

Primary review target:

- `skills/skill-author/SKILL.md`
- `skills/skill-author/references/skill-design-decision-runbook.md`
- `skills/skill-author/references/skill-review-rubric.md`
- `skills/skill-author/references/skill-io-shape-examples.md`

Branch references likely needed:

- `skills/skill-author/references/skill-frontmatter-gate.md`
- `skills/skill-author/references/skill-body-shape-gate.md`
- `skills/skill-author/references/skill-owner-path-gate.md`
- `skills/skill-author/references/skill-safety-gate.md`
- `skills/skill-author/references/skill-verification-gate.md`
- `skills/skill-author/references/run-card-template.md`
- `skills/skill-author/references/agent-native-skill-design.md`
- `skills/skill-author/references/runtime-portability.md`
- `skills/skill-author/references/mcporter-skill-design.md`
- `skills/skill-author/references/skill-dependency-rules.md`

Cautionary example:

- `skills/skill-feedback/SKILL.md`
- `skills/skill-feedback/references/report-shape.md`

## Review Lens

| Lens | Review Question |
|---|---|
| Trigger | Does `skill-author` route creation, review, repair, archive, runtime, dependency, context requests, and no-args menu behavior without excess context load? |
| Structure | Does it create a steps-plus-reference workflow where branch-only detail stays hidden until selected? |
| Steering | Does it use compact leading words agents will repeat and act on: `thin router`, `current step only`, `branch-hidden reference`, `single source of truth`, `deletion test`, `menu for no target`? |
| Pruning | Does it force deletion of no-op headings, copied contracts, sediment, and oversized entry screens before handoff? |

## Specific Workflow Probes

Run at least these mental or practical probes. Return findings; do not patch.

1. No-args menu:
   - Prompt shape: invoke `skill-author` with no args.
   - Expected behavior: show menu; do not create a new skill.

2. New tiny prose skill:
   - Prompt shape: "create a skill that drafts short release notes from PR facts."
   - Expected behavior: one small `SKILL.md`, maybe no references, no Run Card unless earned.

3. New runtime-backed skill:
   - Prompt shape: "create a skill that wraps a CLI with JSON output and durable writes."
   - Expected behavior: route to `create-cli`, owner paths before prose contracts, safety gate before mutation.

4. Review existing bloated skill:
   - Target: `skills/skill-feedback/SKILL.md`.
   - Expected behavior: findings-first review, no patch, flag first-screen owner-map/workflow bloat.

5. Body-shape repair:
   - Prompt shape: "fix headings/run card/first screen for target skill."
   - Expected behavior: open body gate and I/O examples only when needed; do not open every reference.

6. Ambiguous request:
   - Prompt shape: "make this skill better."
   - Expected behavior: classify route or show minimal menu; ask only if owner/write authority is unsafe.

7. Rename clarity:
   - Prompt shape: "review skill-author" and "create a skill".
   - Expected behavior: name does not over-bias toward creation only; description still routes review/repair/archive.

## Review Targets From First Principles

Check these risks after the rename:

- `Skill Author` may still sound like creation more than review/repair.
- `skill-author` may still route generic create before runtime-backed create.
- No-args/no-target menu may be encoded in `SKILL.md` but not in review probes.
- `Run Card` inside `skill-author/SKILL.md` may still normalize Run Cards.
- `skill-design-decision-runbook.md` may still require too much pre-branch scratch work.
- `skill-review-rubric.md` may review static files but not create-flow behavior.
- `skill-io-shape-examples.md` may still reward copied examples when agents are rushed.
- Branch references may describe correct rules but not force them into the driver path.
- Old `create-skill` references may remain in live owner paths, startup checks, or model-visible prompts.
- Historical docs may still mention `create-skill`; decide whether they are harmless history or live owner-path drift.
- Existing `role:` frontmatter may be inert noise; decide whether removing it from all skills is worth the churn.

## Required Output Shape

Return a review, not a patch.

Lead with findings:

- Severity.
- File and line reference.
- Rubric lens: Trigger, Structure, Steering, or Pruning.
- Why it affects actual create/review workflow success.
- Suggested direction, not full implementation unless user asks.

Then include:

- Direct answers to the Current Objective questions.
- Open questions or assumptions.
- Recommendation for workflow probe location.
- Short change plan if findings justify another patch.
- Verification performed.
- `Skill follow-up:` statement if the workflow requires it.

## Suggested Skills

- `summarize`: transcript extraction or timestamp verification.
- `skill-author`: review target and mandatory skill-authoring runbook.
- `skill-feedback`: closeout for material review run.
- `fallow`: only if a future patch changes JS/TS source.

## Next Safe Action

Start a fresh workflow-fitness review:

1. Read `skills/skill-author/SKILL.md`.
2. Read `skills/skill-author/references/skill-design-decision-runbook.md`.
3. Read `skills/skill-author/references/skill-review-rubric.md`.
4. Re-check active old-name references.
5. Re-check the rubric transcript.
6. Run the workflow probes.
7. Return findings only.
