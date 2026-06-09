# Archive Cleanup

Use before moving skills into `skills/archive/`.

## Preview Index

- Read `Goal` and `Order` for the portable archive workflow.
- Read `Local Cleanup Receipt` only when working in this repo.
- Read `Local Findings` only when comparing current archive state.
- Read `Linked External Skills` before moving symlinked skills.
- Read `Accepted Keep-Active List` before proposing archive moves.
- Read `Move Rules` and `Validation` before editing files.

## Goal

- Reduce active skill noise.
- Keep only skills the owner actively wants available.
- Avoid polishing skills that will be deprecated.
- Preserve old skills in an archive instead of deleting them.

## Order

1. Inventory all skills.
2. Identify broken symlinks.
3. Identify skills referenced by startup docs, rules, scripts, or active plans.
4. Ask for must-keep-active skills.
5. Build three buckets:
   - active
   - archive
   - investigate
6. Move archive skills only after the active list is accepted.
7. Run description and startup checks after any move.

## Local Cleanup Receipt

This section records cleanup state for this repo. Do not export it as portable
skill-authoring policy unless exporting local project state on purpose.

## Local Findings

- `skills/find-skills` is a symlink to a user-scope skill owner outside this repo.
- `skills/grill-me` is a symlink to a user-scope skill owner outside this repo.
- Active skill audits include those two external symlink skills, so audit counts can exceed repo-owned `SKILL.md` file counts.
- `skills/create-skill/scripts/skill-description-audit.ts` reports no current crossover candidates.
- Active-reference scan found no live calls to archived skill paths after `productivity-sync` stopped calling archived `people-enrich`.

## Linked External Skills

- `find-skills`
  - User-scope symlink.
  - Not repo-owned.
  - Excluded from repo archive moves.
- `grill-me`
  - User-scope symlink.
  - Not repo-owned.
  - Excluded from repo archive moves.

## Accepted Keep-Active List

- `create-skill`
- `context-advisor`
- `create-cli`
- `decision-mode`
- `record-decision`
- `grill-with-docs`
- `handoff`
- `improve-codebase-architecture`
- `browser-use`
- `classic-cinema`
- `draft-message`
- `fallow`
- `heal-skill`
- `one-password`
- `peekaboo`
- `productivity-sync`
- `prototype`
- `test-runner`
- `to-issues`
- `to-prd`
- `triage`
- `summarize`
- `work-style-convert`

## Normalized User Input

- `browse-use` -> `browser-use`.
- `draft-mesagge` -> `draft-message`.
- `summaris` -> `summarize`.
- `dicisions` -> `record-decision`.
- `decisions` -> `record-decision`.
- `decison-mode` -> `decision-mode`.
- `create-skill-memory store` -> `choose-skill-memory-store`, superseded by `context-advisor`.
- Duplicate entries collapse to one keep-active entry.
- Later additions: `peekaboo`, `one-password`, `classic-cinema`.
- Hard-routed additions: `test-runner`, `work-style-convert`.
- `productivity-sync` is the only protected live productivity workflow.
- `productivity-connectors` is a support reference for `productivity-sync`, not a user workflow.

## Protected Boundary

- Protected means not ordinary active routing, not archive-safe.
- Use for user-invocable control planes, startup routes, active owner paths, or dependency-heavy workflows.
- Keep protected skills out of broad polish.
- Do not archive protected skills until the dependent workflow is explicitly retired or replaced.

## Protected Skills

These were not in the accepted keep-active list, but are not archive-safe.

- `issue-to-pr`
  - User-invocable slash workflow.
  - Owns the Issue-to-PR v2 ledger control plane.
  - Depends on `runbooks/issue-to-pr-v2/` CLI, templates, and references.
- `runbook-orchestrator`
  - User-invocable slash workflow.
  - Owns iterative `/goal` runbook area orchestration.
  - Depends on its `references/` protocol set.
- `agent-reliability-guardrails`
  - Referenced by `agents/cli-agent-reliability-auditor.md`.
- `imessage-reader`
  - Referenced by `productivity-sync` as the iMessage CLI fallback.
- `prompt-system-router`
  - Referenced by `prompt-system-workflow` and prompt-system agents.
- `prompt-system-workflow`
  - Referenced by `rules/prompt-system-workflow.md` and prompt-system agents.

## Archived

- `capture`
  - Archived because the local cleanup decision pivoted away from the legacy storage framework and removed the manual capture front door.
  - Active memory placement routes now use `context-advisor`.
  - Repo-local `context/` contracts were audited for legacy storage-framework residue.
  - Reusable storage-contract rules live in `skills/context-advisor/references/storage-routing.md`.
  - `context-advisor` owns the new storage-routing front door.
- `choose-skill-memory-store`
  - Archived after useful workflow and output guidance moved into the storage routing map.
  - Do not create a bridge for the old name.
- `create-agent-native-skill`
  - Archived after runtime-backed skill guidance moved into `skills/create-skill/references/agent-native-skill-design.md`.
  - Do not create a bridge because the old skill was not used as a real route.
- `create-agent-skills`
  - Archived after extraction review.
  - Kept no additional owner material.
  - Existing `create-skill` references already cover frontmatter, progressive disclosure, scripts, templates, examples, validation, community source notes, and runtime-backed escalation.
  - Rejected pure XML skill-body rules, router-heavy multi-workflow patterns, copied contracts, `~/.claude`-specific paths, and stale Claude-only assumptions.
- `confluence-pages`
  - Archived from archive-review bucket.
  - No active route found outside historical brainstorms.
- `context7-mcp`
  - Archived from archive-review bucket.
  - No active route found outside historical brainstorms.
- `gift-genie`
  - Archived from user-workflow review bucket.
  - No active route found.
- `macos-say`
  - Archived from archive-review bucket.
  - No active route found.
- `memory-promote`
  - Archived from archive-review bucket.
  - No active route found.
- `federated-recall`
  - Archived from user-workflow review bucket.
  - Remaining references are memory docs or historical plans.
- `harden-implementation`
  - Archived from unclassified live inventory.
  - Remaining references are historical plans or provenance.
- `new-sprint`
  - Archived from user-workflow review bucket.
  - Remaining references are historical plans or precedent notes.
- `newsroom-investigate`
  - Archived from user-workflow review bucket.
  - Remaining references are research provenance or historical brainstorms.
- `notebooklm-pack`
  - Archived from user-workflow review bucket.
  - Remaining references are memory docs and scripts.
- `people-enrich`
  - Archived from user-workflow review bucket.
  - Paired workflow `voice-enrich` archived too.
- `productivity-memory`
  - Archived from user-workflow review bucket.
  - Remaining references are memory docs or historical plans.
- `productivity-setup`
  - Archived after `productivity-sync` stopped handing off to setup.
  - Do not preserve `/productivity-setup` as a compatibility route.
- `productivity-tasks`
  - Archived after `productivity-sync` became the only protected live productivity workflow.
  - Do not preserve `/productivity-tasks` as a compatibility route.
- `qmd-federation`
  - Archived from user-workflow review bucket.
  - Memory docs and scripts remain the source.
- `qmd-refresh`
  - Archived from user-workflow review bucket.
  - Memory docs and scripts remain the source.
- `router-cli-smoke`
  - Archived from user-workflow review bucket.
  - Remaining references are historical browser-router plans.
- `ship-by-unit`
  - Archived from archive-review bucket.
  - Paired workflow `unit-review` archived too.
- `unit-review`
  - Archived from user-workflow review bucket.
  - Paired workflow `ship-by-unit` archived too.
- `voice-enrich`
  - Archived from user-workflow review bucket.
  - Paired workflow `people-enrich` archived too.
- `browser-domain-memory`
  - Archived after the local cleanup decision moved future browser memory work to the browser view skill.
  - Do not preserve it as a planned compatibility route.
  - Future browser memory routing starts from `browser-use`.

## Consolidation Candidates

- None currently.

## Archive Review Candidates

Use this bucket for skills that have no repo references and require human review
before any move.

- None currently.

## User Workflow Review Candidates

These have low reference counts but may be personally useful.

- None currently.

## Investigate Before Archive

- Skills referenced by `AGENTS.md`.
- Skills referenced by startup rules.
- Skills with active scripts used by other skills.
- Skills that write memory or external data.
- Skills with user-specific daily workflows.

## Move Rules

- Do not archive a skill named in `AGENTS.md` without replacing the route.
- Do not archive a skill referenced by another active skill without updating the owner path.
- Do not archive memory-writing skills before checking memory storage routing.
- Do not archive broken symlinks by following their targets.
- Do not classify user-scope symlink skills as repo-owned active or archived payloads.
- Do not move legacy XML material into `create-skill` unless it is scoped to prompt/content boundaries.
- Do not archive a storage-routing skill before active references point to `context-advisor`.
- Preserve directory contents under `skills/archive/<name>/`.

## Validation

- Run `bun run skills/create-skill/scripts/skill-description-audit.ts`.
- Run `scripts/agent-instructions.sh check --json`.
- Run `git diff --check`.
- YAML-parse edited `SKILL.md` frontmatter.
