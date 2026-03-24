---
title: "Prompt System Operator Skills And Agents"
type: plan
status: active
updated: 2026-03-23
summary: "A small operator control plane of skills and thin subagents for routing, changing, verifying, and extending the multi-agent user-scope prompt system."
related:
  - docs/specs/prompt-system.md
---

# Goal

Move the multi-agent user-scope prompt system beyond "read the runbook and remember the rules" into a small operator model that can classify changes, route them correctly, verify behavior, and scale to future harnesses like Gemini without architectural drift.

# Why This Exists

The current system now has a solid contract:

- `prompt-fragments/shared/` is the shared startup surface
- `prompt-fragments/claude/` and `prompt-fragments/codex/` hold harness-specific startup behavior
- `rules/` is Claude-only auto-applied behavior
- `context/` is Claude-only on-demand reference material
- `scripts/render-user-prompts.sh --check` and `bun scripts/multi-agent-smoke.ts` verify system health

That is a good foundation, but it still asks humans and LLMs to remember routing rules by hand. This plan adds a small control plane so the framework can help manage itself.

# Authority Model

This plan does not create a second source of truth.

Authority stays in this order:

1. `docs/specs/prompt-system.md` remains the contract
2. runbooks remain the human reference surfaces
3. skills orchestrate the contract and the runbooks during execution
4. agents perform narrow checks inside that workflow

In practice:

- the spec defines what is true
- runbooks explain how a human should apply that truth
- skills become the operator interface that executes the existing model without asking the user to remember every step

# Design Principles

The operator model should follow these constraints:

- Skills hold reusable policy, routing logic, gotchas, and workflows.
- Subagents stay thin, specialized, and easy to reason about.
- The filesystem remains the primary state surface.
- Verification is part of the workflow, not a final optional step.
- Shared behavior should be enforced through the contract, not tribal knowledge.
- The system should stay small. Avoid a sprawling agent tree or a custom service.

# Proposed Skills

## `prompt-system-router`

Purpose:
- Answer "where does this go?" for shared, Claude-only, Codex-only, `rules/`, `context/`, and future harnesses.

Shape:
- Background knowledge skill
- Not user-invocable

Core responsibilities:
- read and apply the routing matrix from the spec at invocation time
- explain shared vs harness-specific placement
- flag invalid assumptions such as "put it only in `rules/` and Codex will see it"

Source-of-truth rule:
- the router must not maintain its own independent routing matrix
- if the spec changes, the router follows the spec instead of becoming a fourth routing table to keep in sync

## `prompt-system-workflow`

Purpose:
- Be the main operator workflow for changing the prompt system safely.

Shape:
- Manual workflow skill
- User-invocable

Authority boundary:
- this skill is the primary operator interface
- it does not replace the spec or runbooks
- it orchestrates the existing contract and runbook steps with classification, routing, and verification layered on top

Workflow:
1. classify the requested change
2. route it to the correct surface
3. decide whether mirroring is required
4. update spec or runbooks if the contract changes
5. run render and contract checks
6. run the smoke harness
7. report changed files, verification, and residual risks

## `prompt-system-verify`

Purpose:
- Standardize verification after prompt-system changes.

Shape:
- Manual verification skill
- User-invocable

Core responsibilities:
- run `./scripts/render-user-prompts.sh --check`
- run `bun scripts/multi-agent-smoke.ts`
- explain failures as either render drift, routing drift, or behavioral drift

## `prompt-system-scaffold`

Purpose:
- Add a new first-class harness without drifting the architecture.

Shape:
- Manual workflow skill
- User-invocable

Workflow:
1. define shared vs harness-specific behavior
2. create `prompt-fragments/<harness>/`
3. extend render and install behavior
4. extend the smoke harness
5. update the contract spec and relevant runbooks

# Proposed Subagents

## `prompt-contract-auditor`

Purpose:
- Check that the spec, implementation, and runbooks still describe the same system.

Inputs:
- `docs/specs/prompt-system.md`
- `scripts/render-user-prompts.sh`
- `install.sh`
- relevant runbooks

Output:
- findings only, ordered by severity

What it catches that scripts do not:
- contract drift between the spec and the runbooks
- contract drift between the spec and the implementation shape
- stale human guidance that still describes an old routing or delivery model

Non-goal:
- it is not just a wrapper around `--check` or the smoke harness

## `prompt-routing-auditor`

Purpose:
- Review changed prompt content for placement mistakes.

Examples of what it should catch:
- shared behavior accidentally placed only in `rules/`
- Claude-only tool assumptions leaked into shared fragments
- Codex-needed behavior omitted from the rendered path

## `prompt-smoke-runner`

Purpose:
- Delegate regression verification.

Primary checks:
- `./scripts/render-user-prompts.sh --check`
- `bun scripts/multi-agent-smoke.ts`

Output:
- pass/fail with the smallest useful mismatch summary

## `harness-expansion-planner`

Purpose:
- Plan support for Gemini or another future harness before implementation starts.

Output:
- proposed write set
- verification changes
- risks and rollout notes

# Recommended MVP

Start with the smallest set that materially improves safety and clarity:

- `prompt-system-router`
- `prompt-system-workflow`
- `prompt-contract-auditor`
- `prompt-smoke-runner`

This gives the framework:

- one routing brain
- one canonical change workflow
- one architectural reviewer
- one verification runner

It avoids building too much structure before the usage pattern is proven.

Acceptance criteria for the MVP:

- a shared-behavior change routed through `prompt-system-workflow` chooses the correct shared authoring surface on the first attempt
- a Claude-only change routed through `prompt-system-workflow` does not leak into shared or Codex surfaces
- a Codex-only change routed through `prompt-system-workflow` does not rely on `rules/`
- `prompt-contract-auditor` can report at least one contract-drift class that `--check` and the smoke harness do not detect
- `prompt-smoke-runner` can execute the existing verification flow without adding a second verification model

# Skill And Agent Wiring

The expected wiring is intentionally simple:

- `prompt-system-workflow` reads `prompt-system-router` for classification and placement rules
- `prompt-system-workflow` invokes `prompt-contract-auditor` when a change appears architectural or contract-relevant
- `prompt-system-workflow` invokes `prompt-smoke-runner` after edits and render/check work complete
- `prompt-system-scaffold` reuses the routing guidance from `prompt-system-router` instead of defining a new placement model

The goal is one operator workflow with small helpers, not many overlapping entry points.

# Phase 1

- Create `prompt-system-router`
- Create `prompt-system-workflow`
- Create `prompt-contract-auditor`
- Create `prompt-smoke-runner`
- Validate that the workflow can handle:
  - a shared behavior change
  - a Claude-only rule change
  - a Codex-only change

# Phase 2

- Add `prompt-system-verify`
- Add `prompt-system-scaffold`
- Add `prompt-routing-auditor`
- Optionally add a small runtime state surface if repeated operator runs prove that durable artifacts are useful:
  - last smoke result
  - last render-check result
  - audit log

This runtime state is speculative and should not be added until repeated real usage shows that the files reduce operator friction.

# File Or System Changes

Initial implementation target:

- implement the first version in this repo under `skills/` and `agents/`
- do not prototype a second copy in a separate user-scope location first
- if any part later needs to move to a shared user-scope surface, that should be a follow-up decision rather than Phase 1 ambiguity

Expected implementation surfaces in this repo:

- `skills/prompt-system-router/`
- `skills/prompt-system-workflow/`
- `skills/prompt-system-verify/`
- `skills/prompt-system-scaffold/`
- `agents/prompt-contract-auditor.md`
- `agents/prompt-routing-auditor.md`
- `agents/prompt-smoke-runner.md`
- `agents/harness-expansion-planner.md`

Supporting references may live alongside the skills as small local docs such as:

- routing examples
- contract invariants
- common failure modes
- smoke-test matrix

# Sizing Constraints

Keep the operator model small enough to preserve the repo's current prompt discipline:

- agents should stay thin and task-shaped
- skills should hold the heavier procedural knowledge
- avoid duplicating long policy text that already exists in the spec or runbooks
- prefer reference-by-reading over embedding large copies of source material

Practical target:

- agents should usually stay in the rough range of 30 to 60 lines
- skills should stay concise enough to be progressively read, with heavier detail moved into local reference docs where needed

# Testing

Operator changes should be considered complete only when:

- skill and agent docs are internally coherent
- `./scripts/render-user-prompts.sh --check` passes
- `bun scripts/multi-agent-smoke.ts` passes
- at least one routing example for shared, Claude-only, and Codex-only behavior is exercised

# Non-Goals

This plan does not propose:

- replacing the contract spec
- replacing runbooks as human reference material
- adding a new external service or database
- building a large autonomous swarm for a small framework

# Rollout

Roll this out incrementally:

1. ship the MVP skills and agents
2. use them on real prompt-system changes
3. capture friction and misrouting
4. add Phase 2 pieces only where repeated pain justifies them

# Backout Or Recovery

If the operator model becomes noisy or confusing:

- keep the contract spec as the source of truth
- fall back to the existing runbooks
- remove or simplify the thin skills and agents
- preserve only the parts that clearly reduce routing mistakes and verification gaps

# Notes From Research

This plan is informed by a prior research pass and intentionally carries forward these distilled principles directly in this document:

- skills should encode reusable "how" knowledge
- subagents should stay narrow
- the filesystem is a strong state surface
- verification deserves first-class tooling
- spec-driven work benefits from a clean execution session

# Next Tasks

- Draft the MVP skill and agent files
- Define one routing example set for each major surface
- Decide whether the first implementation should live under `skills/` and `agents/` in this repo or be prototyped in user-scope first
