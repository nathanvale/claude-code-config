# Research Portability

Use when importing handovers, research notes, public examples, or vendor docs
into the portable skill-authoring bundle.

## Goal

- Keep skill research portable.
- Keep source freshness visible.
- Avoid scattering rules across `context/`, project docs, and old skills.
- Preserve open questions in the project tracker until accepted.
- Separate portable skill payload from local project state.

## Project Tracker Owner

- Owner path: `skills/coding-task-tracker/SKILL.md`.
- Use for progress, open questions, queues, cleanup state, blockers, and next actions.
- Missing state: degraded.
- Next repair: install or export `skills/coding-task-tracker/SKILL.md`, or record unresolved work in the final response or handoff until the receiving repo names its tracker owner.
- Treat `TASKS.md` as historical or local residue unless a repo explicitly names it as tracker owner.
- Do not store accepted reusable rules in the tracker.
- Promote accepted reusable rules into `SKILL.md`, `CONTEXT.md`, or `references/`.

## Acceptance Contract

- Accepted means the user approved the rule and it landed in the owner path.
- Treat chat-only agreement as pending until the owner path changes.
- Treat tracker notes as work state, not accepted rule state.
- Put follow-up work in the project tracker.

## Export Surface

Portable by default:

- `SKILL.md`
- `CONTEXT.md`
- `references/`
- `scripts/`
- templates and assets owned by the skill

Local project state by default:

- project tracker state
- `TASKS.md` when present as historical or local tracker residue
- `docs/decisions/`
- historical archive receipts
- local handover paths
- repo cleanup queues

Rules:

- Do not treat project tracker state or `TASKS.md` as portable rule surface.
- Do not treat decision logs as portable rule surface.
- Promote accepted reusable rules into `SKILL.md`, `CONTEXT.md`, or `references/`.
- Keep unresolved work, local file paths, and cleanup status in the project tracker.
- Source notes may cite local evidence paths; missing local evidence does not block skill operation.
- Use `runtime-portability.md` for Bun, Node, Python, shell, package, lockfile, and helper-script portability.
- Export `skills/create-cli/SKILL.md` or name it as a hard dependency when runtime-backed skill guidance changes CLI/runtime surfaces.

## Handover Intake

1. Record the handover path in the project tracker.
2. Extract:
   - accepted reusable rules
   - open questions
   - source links
   - candidate cleanup items
   - owner paths
3. Add accepted rules to the portable owner path.
4. Add unresolved items to the project tracker, not the rulebook.
5. Add source links to the research source note.

## Source Rules

- Treat official docs and papers as rule inputs.
- Treat marketplaces, awesome lists, repos, Reddit, blog posts, and videos as examples.
- Treat QMD results, search snippets, and handover summaries as discovery only; use them to find full sources, not to justify rules.
- Read the full source before promoting a rule.
- Record source URL or path, checked date, and affected rule surface.
- Refresh current vendor docs before changing rules that depend on vendor behavior.

## Research Intake

- Search before broad edits.
- Read the highest-signal source files, not only snippets.
- Extract accepted reusable rules, open questions, source links, and owner paths.
- When changing skill rules, treat research as refinement evidence until the owner-path change is accepted and validated.
- Add gotchas only when refinement evidence demonstrates a repeatable, non-obvious agent failure.
- Prefer description, owner-path, safety-gate, command, or example patches before new workflow prose.
- Keep local recall facts as source evidence unless the user accepts them as reusable rules.
- Name the affected owner path before editing.

## Portability Audit

Scan portable surfaces for hidden local coupling:

- absolute user paths: `/Users/`, `/private/tmp/`, `~/`
- personal names used as rules
- repo slugs used as rules
- retired folders: `memory/`, old `context/` owner paths, archived skills
- local-only package links
- symlinks that point outside the skill bundle
- commands that require unbundled scripts without naming the owner path
- runtime helpers that depend on hidden Bun, Node, Python, shell, package, lockfile, or local tool state

Classify each hit:

- portable rule
- local project state
- historical receipt
- source note
- blocker

Patch order:

1. Move reusable rules into the portable owner path.
2. Move unresolved or local-only details into the project tracker.
3. Rewrite absolute paths as owner paths when possible.
4. Leave historical receipts only when they explain an irreversible cleanup.
5. Record blockers in the project tracker.

## Portability Rules

- Prefer files inside `skills/create-skill/` for reusable skill-authoring knowledge.
- Use old `context/` files as temporary owner-path redirect stubs only during migration.
- Remove redirect stubs after active-reference audit passes.
- Do not copy deterministic contracts into skill prose.
- Keep examples illustrative.
- Keep project-specific cleanup state in the project tracker.
