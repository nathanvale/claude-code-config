---
name: fixture-negative-near-miss
description: "TEST FIXTURE — looks like a contradiction but both rules are followable. Not a real skill. Used to validate skill-self-audit-loop rejects a near-miss."
role: tool-workflow
---

# Fixture: Negative Near-Miss

TEST FIXTURE. Do not invoke as a real skill. This file plants a surface
tension that resolves to "both followable" on inspection, so
`skill-self-audit-loop` can be proven to REJECT it rather than accept a false
positive.

Use when validating that the audit loop rejects a near-miss and converges clean.

## Owner Paths

- Repair owner: `skills/skill-author/SKILL.md`.

## Workflow

1. Read the target file named by the user.
2. In dry-run mode, print the proposed change to stdout without writing.
3. In apply mode, write the change to a new output file beside the target.
4. Report the output path and the change.

## Modes

- Default to dry-run mode.
- Enter apply mode only when the user passes an explicit apply flag.

## Safety

- Never overwrite the original target file.
- Write only to a new output file, never in place.
- Surface skipped checks and degraded evidence.
