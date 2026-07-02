---
date: 2026-06-04
topic: fallow-progressive-disclosure-index
title: "Fallow progressive disclosure index"
type: brainstorm
---

# Fallow Progressive Disclosure Index Requirements

## Summary

Redesign `fallow` with a skill-driver autonomous, human-readable progressive
disclosure index.

The first route is PR self-review: "I just built this; check the diff before
PR." The skill classifies the request, runs the next safe Fallow path, reads a
compact summary first, and reports before/after evidence when it reruns.

Include a human-readable runner output mode in this scope. Defer reusable
skill-entry guidance until Fallow proves the pattern.

## Problem Frame

The current `skills/fallow/SKILL.md` is accurate but flat. It names owners and
workflow steps, but a fresh skill driver has to read the whole file before
knowing what to do.

The failure is decision latency:

- The common PR-review path is not above the fold.
- Routes are command-shaped instead of request-shaped.
- Mutation safety is correct but visually quiet.
- Target fit is implicit even though `doctor` owns supported-root readiness.
- Runner output pushes skill drivers toward JSON inspection before summary
  judgment.

The target shape keeps `SKILL.md` thin. It routes the model. Runner code, help,
tests, and references keep deterministic contracts.

## Key Decisions

- **Skill-driver autonomous, human-readable.** Let the skill driver choose the
  route from the user's ask. Keep wording readable when a human scans the file.
- **PR self-review is the hero path.** Optimize the first screen for implemented
  work heading toward a PR.
- **Number secondary routes.** Put the hero path first, then use a short
  numbered index for other routes.
- **Route by intent.** Use request shapes like "check my diff" and "find cleanup
  opportunities" before command names.
- **Keep cleanup bounded.** Report code-quality evidence and suggest broader
  workflows only when the user opts into design or review work.
- **Summary first.** Add a runner-owned `--plain` mode for compact
  human-readable output so skill drivers do not drown in JSON for routine
  judgment.
- **Escalate to structure.** Use `--plain` for first-pass triage. Use JSON when
  the skill driver needs issue references, repair planning, or structured
  evidence.
- **Stop mutation loudly.** Put the `fix-apply` authorization gate in the
  progressive disclosure index, not only in a safety reference.
- **Keep apply scope honest.** Keep authorization skill-owned for this pass.
  Require planning to evaluate runtime confirmation before adding more apply
  affordances.
- **Guard target fit.** Tell skill drivers to challenge the premise or retarget
  when the current repo is not the runner-supported project root under review.
- **Prove before generalizing.** Keep reusable skill-entry guidance out of scope
  until this pattern survives Fallow usage.

## Actors

- A1. **Skill driver:** Human, plan, or agent invoking `fallow` with current
  work context.
- A2. **Runner owner:** Maintains Fallow command mapping, output modes, repair
  hints, and tests.
- A3. **Skill owner:** Maintains the progressive disclosure index and owner
  pointers.
- A4. **Target project:** The runner-supported project root Fallow analyzes.

## Requirements

**Progressive disclosure routing**

- R1. `skills/fallow/SKILL.md` starts with a progressive disclosure index
  before owner paths.
- R2. The index starts with a hero PR self-review path after implementation.
- R3. The skill driver chooses a route without asking the user to pick a number
  when the ask is clear.
- R4. Secondary routes use a short numbered index for non-hero paths.
- R5. The index includes changed-code review, cleanup/refactor scan,
  readiness check, fix preview, apply gate, and target mismatch.
- R6. The index names the user's question before the command family.
- R7. `doctor` runs first only when setup, target fit, git readiness, JSON
  capability, or config scope is unknown.
- R8. The index tells skill drivers to challenge the premise when `doctor`
  reports an unsupported target.
- R9. The index points to `--root` targeting through owner help or command
  references without copying parser details.

**PR self-review path**

- R10. Given implemented work or PR prep, the skill routes to changed-code audit.
- R11. The path reads summary output before raw findings.
- R12. The path escalates from `--plain` to JSON only when findings need
  structured inspection, repair planning, or before/after evidence.
- R13. The path inspects only findings relevant to the current task unless the
  user asks for broader cleanup.
- R14. The path reruns the same evidence command after changes.
- R15. The final report includes before/after evidence when a rerun exists.
- R16. Inherited baseline findings stay separate from current-task work unless
  the user explicitly asks for cleanup.

**Cleanup and refactor path**

- R17. Given "look at this module" or "find refactoring opportunities", the
  skill routes to cleanup evidence instead of PR audit by default.
- R18. Cleanup routing chooses dead-code, duplication, or health evidence from
  the request shape.
- R19. Cleanup routing keeps per-finding refactor plans outside the runner.
- R20. Cleanup reporting may suggest broader architecture or review workflows
  when Fallow evidence points beyond code-quality findings.
- R21. Broader architecture or review skills remain opt-in and are not
  auto-invoked by Fallow routing.

**Mutation safety**

- R22. `fix-preview` is the first route for fix requests.
- R23. `fix-apply` stops unless the user gave explicit current-task
  authorization for source mutation.
- R24. The apply route points to `skills/fallow/references/safety.md` as the
  mutation owner.
- R25. The skill does not infer apply permission from auto-fixable findings,
  preview output, or a general desire to improve code.
- R26. The apply route requires target root and config-scope review before
  mutation.
- R27. Planning evaluates whether `fix-apply` should require runtime
  confirmation before adding more apply affordances.

**Human-readable output**

- R28. The runner provides `--plain` as a compact human-readable output mode for
  routine summary judgment.
- R29. The output mode shows readiness, command outcome, finding counts,
  top-level risk, and next safe action when available.
- R30. The output mode avoids raw issue dumps unless requested.
- R31. JSON output remains available for structured inspection and existing
  automation.
- R32. Diagnostics stay separate from primary output.
- R33. Output budget controls still work for large findings.
- R34. Existing normalized summary semantics and exact `--plain` rendering stay
  owned by the runner contract and tests, not copied into skill prose.

**Skill philosophy fit**

- R35. `SKILL.md` routes and points to owners.
- R36. `SKILL.md` does not copy flags, schemas, output envelopes, parser rules,
  repair action ids, or Fallow raw output shapes.
- R37. Command syntax stays owned by runner help and
  `skills/fallow/references/commands.md`.
- R38. Workflow depth stays owned by `skills/fallow/references/workflows.md`.
- R39. Safety policy stays owned by `skills/fallow/references/safety.md`.
- R40. The index stays small enough to scan in one screen.

**Pattern follow-up**

- R41. This work does not create shared skill-entry guidance.
- R42. The Fallow implementation records enough before/after rationale to decide
  later whether the index pattern should generalize.
- R43. A later reusable pattern, if created, belongs in a source that skill
  authors already read, likely `context/skill-design-philosophy.md` or a
  companion reference.

## Index Sketch

```text
User ask
  -> built work / PR next
     -> changed-code audit
  -> module or repo cleanup
     -> dead-code, dupes, or health evidence
  -> unknown readiness or target fit
     -> doctor
  -> fix request
     -> fix-preview
  -> apply request
     -> stop unless explicit current-task mutation authorization exists
  -> not the runner-supported project root
     -> challenge premise or retarget
```

## Acceptance Examples

- AE1. **Covers R1-R16.** Given a prompt like "I just built this feature; check
  the diff before PR", when the skill loads, then the skill driver routes to
  changed code review without asking the user to choose a menu item.
- AE2. **Covers R17-R21.** Given a prompt like "look at this module for
  refactoring opportunities", when the skill loads, then the skill driver chooses
  cleanup evidence and does not treat the task as PR-only audit. When the
  evidence points beyond Fallow's scope, then the skill driver suggests a broader
  workflow without invoking it.
- AE3. **Covers R7-R9.** Given the current repo is not the runner-supported
  project root under review, when the skill loads, then the skill driver runs
  readiness checks or retargets the root instead of treating empty or irrelevant
  evidence as useful.
- AE4. **Covers R22-R27.** Given a prompt like "preview fixes", when the runner
  reports auto-fixable findings, then the skill driver does not run apply
  unless the user explicitly authorized current-task source mutation. When
  planning starts, then runtime confirmation is evaluated before expanding apply
  affordances.
- AE5. **Covers R28-R34.** Given a normal audit result, when the skill driver passes
  `--plain`, then it receives a compact summary suitable for triage. When the
  skill driver needs issue references or repair planning, then JSON remains
  available.
- AE6. **Covers R35-R40.** Given a reviewer reads `skills/fallow/SKILL.md`, then
  the progressive disclosure index is visible before owner paths and exact
  command contracts still live in runner help, references, code, and tests.
- AE7. **Covers R41-R43.** Given this redesign ships, then no shared
  skill-entry rule changes until Fallow usage proves the index pattern.

## Scope Boundaries

- In scope: redesign `skills/fallow/SKILL.md` progressive disclosure index.
- In scope: update Fallow references only where route pointers or safety
  wording need support.
- In scope: add runner support for compact `--plain` summary output.
- In scope: add or update runner tests for output mode behavior.
- In scope: evaluate runtime confirmation for `fix-apply` during planning.
- In scope: add a small behavior-regression prompt checklist if needed.
- Out of scope: rerunning the completed Fallow implementation review.
- Out of scope: changing Fallow analyzer semantics.
- Out of scope: installing Fallow automatically.
- Out of scope: generating CI workflows.
- Out of scope: state-aware dynamic skill rendering.
- Out of scope: shared skill-entry guidance in this pass.
- Out of scope: broad rewrites across unrelated skills.

## Success Criteria

- A fresh skill driver can choose the PR self-review route from the first
  screen.
- The mutation gate is visible before any apply path.
- Target-fit ambiguity has an explicit route.
- `--plain` runner output supports routine summary judgment.
- Existing JSON automation remains available.
- Skill prose stays index-shaped and avoids copied deterministic contracts.
- The redesign can move to planning without inventing scope, owners, or success
  criteria.

## Sources

- `skills/fallow/SKILL.md`
- `skills/fallow/references/commands.md`
- `skills/fallow/references/workflows.md`
- `skills/fallow/references/safety.md`
- `skills/fallow/scripts/fallow-runner.ts`
- `skills/fallow/scripts/command-contract.ts`
- `skills/fallow/scripts/fallow-runner.test.ts`
- `context/skill-design-philosophy.md`
- `skills/cli-author/SKILL.md`
- `skills/cli-author/references/agent-native-cli-design.md`
- `docs/brainstorms/2026-06-04-cli-author-product-shape-requirements.md`
- External handoff: `fallow-skill-frontdoor-handoff.md`
