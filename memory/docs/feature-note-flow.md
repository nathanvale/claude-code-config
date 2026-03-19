---
title: "Feature Note Flow"
type: reference
status: active
updated: 2026-03-19
summary: "How product and feature notes move from rough idea to settled spec to executable plan inside the Memory OS."
---

# Feature Note Flow

## Purpose

Keep product and feature documentation lean while still giving agents and humans a clear handoff from fuzzy idea to executable work.

## Default Sequence

Use this flow unless the work is tiny:

1. `project` note for stable product context
2. brainstorm note for option exploration when the idea is still fuzzy
3. `spec` note for the chosen direction
4. `plan` note for implementation sequencing
5. `task` surface for concrete execution work
6. `decision` or `adr` note for durable choices worth preserving

## New Product Sequence

When the work is a possible new product, not a feature inside an existing one, use this:

1. brainstorm note for product exploration
2. product brief in the `spec` family for the initial thesis
3. `project` note once the idea becomes a committed product or repo-level initiative
4. `plan` note for execution sequencing
5. `task` surface for concrete work

The key shift is this:
- before commitment, you are shaping a possible product
- after commitment, the `project` note becomes the stable home for what the product is

## What Each Artifact Is For

### `project`

Use for the stable context of the product, repo, or initiative:
- why it exists
- who it serves
- its broader direction

Do not force a `project` note too early.
For a brand-new product idea, it is usually cleaner to start with a brainstorm and a product brief first, then create the `project` note once the idea is real enough to own ongoing work.

### Brainstorm

Use when the idea is still being explored:
- the problem is real, but the shape is not settled
- multiple approaches are plausible
- tradeoffs or open questions need to be surfaced first

In the shared taxonomy, a brainstorm should usually stay inside the existing `plan` family because it is still an evolving proposed path.

### `spec`

Use for the settled what:
- what we decided to build
- for whom
- why it matters
- how success will be judged

A lightweight PRD belongs here. Do not add a separate `prd` note type unless there is a strong retrieval reason to do so.

### `plan`

Use for the executable how:
- implementation order
- phases
- rollout
- testing
- recovery

### `task`

Use for concrete action items and commitments after the plan exists.

Default to a small repo-local `TASKS.md` as the active execution surface.
If work becomes numerous, dependency-heavy, or parallelized, promote detailed items into a `todos/` directory and let `TASKS.md` become the summary view.

## Shortcut Rules

- Tiny change: skip straight to `plan` or `task`
- Clear feature: skip brainstorm and start with `spec`
- Fuzzy feature: brainstorm first, then write the `spec`

## Templates

Use these starter templates:

- `~/.config/memory/templates/brainstorm.md`
- `~/.config/memory/templates/product-brief.md`
- `~/.config/memory/templates/spec-prd.md`
- `~/.config/memory/templates/implementation-plan.md`
- `~/.config/memory/templates/TASKS.md`

## Skill Handoffs

These templates affect the surrounding skills like this:

### `/capture` and `memory-capture`

Use as the front door for new material.

Routing guidance:
- fuzzy idea or option-heavy concept -> create a brainstorm doc from `templates/brainstorm.md`
- possible new product idea -> create a `spec` doc from `templates/product-brief.md` after the brainstorm starts to converge
- settled feature request -> create a `spec` doc from `templates/spec-prd.md`
- implementation sequencing request -> create a `plan` doc from `templates/implementation-plan.md`

Default homes:
- brainstorms -> `docs/brainstorms/`
- specs -> `docs/specs/`
- plans -> `docs/plans/`

### `workflows-plan`

This should treat brainstorm docs as the upstream origin when they exist, then turn that into an implementation plan.

### `productivity-memory`

This should not absorb authored brainstorm, spec, or plan documents into `memory/`.
It can store compact project summaries or durable shorthand that point at those docs.

### `productivity-tasks`

This should treat specs and plans as upstream context, not as a replacement for `TASKS.md`.
Tasks stay local and concrete.

Escalation rule:
- default to `TASKS.md`
- use `todos/` only when a repo has enough active work that one file stops being easy to scan
- keep `TASKS.md` as the dashboard even when detailed todo files exist

## Recommended Path Layout

For repos that do regular product work, these folders are enough:

- `docs/brainstorms/`
- `docs/specs/`
- `docs/plans/`

Task surfaces:
- `TASKS.md` for the default active work dashboard
- `todos/` only when the repo needs file-based detailed work items with dependencies, work logs, or parallel resolution

Common pattern for new product work:
- `docs/brainstorms/<product-idea>.md`
- `docs/specs/<product-name>-brief.md`
- `memory/projects/<product-name>.md` or another repo-local `project` note once committed

Avoid inventing extra top-level systems when these cover the lifecycle cleanly.
