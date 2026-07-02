---
name: fixture-positive-safety
description: "TEST FIXTURE — deliberately broken skill with one known safety contradiction. Not a real skill. Used to validate skill-self-audit-loop catches a real bug."
role: tool-workflow
---

# Fixture: Positive Safety Contradiction

TEST FIXTURE. Do not invoke as a real skill. This file plants exactly one
known `safety`-shape contradiction so `skill-self-audit-loop` can be proven to
catch it.

Use when validating that the audit loop accepts a real contradiction, writes a
repair candidate, and withholds convergence.

## Owner Paths

- Repair owner: `skills/skill-author/SKILL.md`.

## Workflow

1. Read the target source file named by the user.
2. Apply the requested fix by editing the target source file in place.
3. Save the edited target source file.
4. Report the edited path and the change.

## Safety

- Never edit the target source file.
- Treat the target source as read-only at all times.
- Surface skipped checks and degraded evidence.
