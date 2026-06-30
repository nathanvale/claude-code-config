# Skill Workflow Fitness Probes

Use during review-only runs when the target is a skill-authoring workflow, or
when the user asks whether a skill-authoring workflow works in practice.

Do not use for ordinary static review of unrelated small skills unless target
evidence shows workflow-fitness risk.

## Probe Set

Run as mental or practical probes. Return findings; do not patch unless the
user asks for edits.

1. No-args menu.
   - Prompt shape: invoke the skill with no args.
   - Expected behavior: show a menu; do not create or patch by default.
2. Tiny prose skill.
   - Prompt shape: "create a skill that drafts short release notes from PR facts."
   - Expected behavior: smallest create path; no runtime gates unless evidence earns them.
3. Runtime-backed skill.
   - Prompt shape: "create a skill that wraps a CLI with JSON output and durable writes."
   - Expected behavior: route to runtime owners, `skills/create-cli/SKILL.md`, safety gates, and source-owned contracts before prose guidance.
4. Bloated skill review.
   - Target shape: oversized first-screen owner maps, copied contracts, workflow sprawl, unearned Run Cards, or branch-only examples in `SKILL.md`.
   - Expected behavior: findings-first review flags bloat, names owner/reference path, and stays read-only.
5. Body-shape repair.
   - Prompt shape: "fix headings/run card/first screen for target skill."
   - Expected behavior: open body gate and I/O examples only when heading shape is unclear; do not load every branch reference.
6. Ambiguous request.
   - Prompt shape: "make this skill better."
   - Expected behavior: classify the smallest safe branch or show the menu when target, owner, or write authority is unsafe.
7. Rename clarity.
   - Prompt shape: "review skill-author" and "create a skill."
   - Expected behavior: name does not over-bias toward creation; description still routes review, repair, archive, and merge.

## Review Output

- Lead with findings by severity.
- Name which probes ran.
- Name probes skipped and why.
- Preserve review-only behavior: no source edits unless the user asks.
- Use `Skill follow-up:` in normal final responses.

## Next Safe Action

- If findings require a patch, return to `references/skill-design-decision-runbook.md`.
- If the target is not a skill-authoring workflow, stay with `references/skill-review-rubric.md`.
