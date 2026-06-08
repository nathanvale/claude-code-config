# Research Portability

Use when importing handovers, research notes, public examples, or vendor docs
into the portable skill-authoring bundle.

## Goal

- Keep skill research portable.
- Keep source freshness visible.
- Avoid scattering rules across `context/`, project docs, and old skills.
- Preserve open questions in the project tracker until accepted.
- Separate portable skill payload from local project state.

## Export Surface

Portable by default:

- `SKILL.md`
- `CONTEXT.md`
- `references/`
- `scripts/`
- templates and assets owned by the skill

Local project state by default:

- `TASKS.md`
- `docs/decisions/`
- historical archive receipts
- local handover paths
- repo cleanup queues

Rules:

- Do not treat `TASKS.md` as portable rule surface.
- Do not treat decision logs as portable rule surface.
- Promote accepted reusable rules into `SKILL.md`, `CONTEXT.md`, or `references/`.
- Keep unresolved work, local file paths, and cleanup status in `TASKS.md`.
- Source notes may cite local evidence paths; missing local evidence does not block skill operation.
- Use `runtime-portability.md` for Bun, Node, Python, shell, package, lockfile, and helper-script portability.

## Handover Intake

1. Record the handover path in `TASKS.md`.
2. Extract:
   - accepted rules
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
- Record source URL or path, checked date, and affected rule surface.
- Refresh current vendor docs before changing rules that depend on vendor behavior.

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
2. Move unresolved or local-only details into `TASKS.md`.
3. Rewrite absolute paths as owner paths when possible.
4. Leave historical receipts only when they explain an irreversible cleanup.
5. Record blockers in `TASKS.md`.

## Portability Rules

- Prefer files inside `skills/create-skill/` for reusable skill-authoring knowledge.
- Use old `context/` files as temporary owner-path redirect stubs only during migration.
- Remove redirect stubs after active-reference audit passes.
- Do not copy deterministic contracts into skill prose.
- Keep examples illustrative.
- Keep project-specific cleanup state in the project tracker.
