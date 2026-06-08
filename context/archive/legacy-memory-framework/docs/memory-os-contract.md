---
title: "Memory OS Contract"
type: contract
status: active
updated: 2026-04-20
summary: "Shared user-scope contract for Nathan's Markdown-first memory system across work repos, personal repos, Claude Code, and Codex."
---

# Memory OS Contract

## Purpose

Define the minimum shared rules that let multiple repos participate in one coherent Markdown-first memory system without collapsing into duplication, metadata bloat, or tool-specific drift.

This contract is intentionally agent-neutral. Claude Code, Codex, and future tools should adapt to it rather than each inventing their own memory model.

## Core Principles

1. Source-of-truth lives close to the work.
2. `my-second-brain` is the holistic synthesis and recall hub, not the owner of every document.
3. Frontmatter is a routing layer, not a second body.
4. Promotion is selective, not automatic bulk copying.
5. Retrieval and synthesis are separate concerns.
6. External artifacts keep provenance.
7. Humans stay in charge of meaning; automation stays in charge of repeatable structure.

## Memory Layers

### Semantic

Durable knowledge that should still matter later:
- project context
- stable people context
- decisions and ADRs
- durable research
- glossary terms
- operational rules

### Episodic

Dated evidence of what happened:
- meeting notes
- implementation logs
- session notes
- daily logs
- weekly rollups
- verification records

### Runtime

Machine state used for recall or automation but not part of shared human memory:
- indexes
- cursors
- caches
- sync state
- export state
- intermediate manifests

Runtime state should stay local whenever possible.

## Hot Memory

`CLAUDE.md` is the shared hot-memory surface for a repo when the repo chooses to use one.

Treat it as:

- a launch pad
- a compact current-state aid
- a place for a few broadly relevant repo instructions

Do not treat it as:

- the durable memory store
- the task system
- the full repo manual

Use the dedicated `docs/claude-md-contract.md` for size, placement, and audit rules.

## Source Of Truth Boundaries

### Repos

Repos own operational truth for the work they contain.

Examples:
- `monash-smst` owns work meetings, people, Confluence imports, project context, and work tasks.
- `mac-mini-home-server` owns specs, runbooks, ADRs, gotchas, verification, and implementation history.
- a future product repo should own roadmap, plans, specs, research, decisions, and implementation history for that product.

### Multi-Repo Projects

When a project spans multiple repos, one repo may act as a **Work Hub** that owns cross-cutting context (people, tasks, glossary, reusable patterns) for the cluster. Other repos in the cluster are **Spokes** that delegate those concerns to the hub and keep only local implementation detail.

Rules:
- The hub-spoke relationship is opt-in. Declare it in `roster.yml` with `parent:` on spoke entries.
- A spoke's CLAUDE.md should include a "Critical Context (hub: <name>)" section with explicit backlinks for people, tasks, and glossary.
- Promotion flows upward: spoke insights promote to the parent hub, then selectively to `my-second-brain`. Spokes do not promote directly to `my-second-brain`.
- QMD queries can scope to a hub and its spokes by listing their collections together.
- Most repos are independent participants and do not need hub-spoke declarations.

See `repo-profiles.md` for the Work Hub and Spoke profiles.

### `my-second-brain`

`my-second-brain` owns:
- personal control-plane context
- cross-project synthesis
- durable promoted learnings
- life-level planning
- federated recall entrypoints

### External Systems

Tools like Google Drive, NotebookLM, Slack, Confluence, or calendar systems are sources, transport layers, or synthesis layers. They are not the canonical memory model.

When a large external documentation set needs daily recall, prefer a dedicated reference-corpus repo that stores converted retrieval docs, local sync state, and provenance rather than bloating a work repo or `my-second-brain`.

## Shared Note Types

Use this universal note taxonomy wherever possible:

- `project`
- `area`
- `person`
- `pet`
- `meeting`
- `research`
- `review`
- `task`
- `decision`
- `adr`
- `brainstorm`
- `plan`
- `runbook`
- `log`
- `solution`
- `artifact-sidecar`

Repo-specific note types are allowed when they clearly improve retrieval, but they should map back to one of these conceptual families.

Distinguish these nearby families like this:
- `person` for humans with durable relationship or identity context
- `pet` for animals with durable relationship, care, health, or household context
- `research` for evidence gathering, source synthesis, and exploratory understanding
- `review` for evaluative documents that assess a change, artifact, system, or workflow against explicit criteria and produce findings or a verdict
- `brainstorm` for divergent ideation — options, alternatives, and exploration before a path is chosen
- `plan` for the chosen path: settled shape (what we're building, for whom, why it matters, acceptance) plus sequencing, rollout, and implementation detail. A plan absorbs what older workflows split into a separate `spec` — keep settled contract and execution path in one document unless the plan grows unreadable
- `decision` for durable choices about policy, workflow, structure, naming, ownership, or operating rules where the why should be recoverable later
- `adr` for heavier architectural or system-design choices with notable tradeoffs, alternatives, or long-lived technical consequences
- `project` for the container or initiative itself
- `solution` for reusable post-mortems and pattern writeups — a documented fix, workaround, or pattern for a class of problems that future work should discover before starting in the same area

Use the nearby operational note families like this:
- `research` asks "what do we know?"
- `review` asks "how good is this against the chosen bar?"
- `brainstorm` asks "what are the options?"
- `plan` asks "what's the chosen path?"
- `decision` asks "what did we choose and why?"
- `log` asks "what happened?"
- `solution` asks "how do we handle this class of problem next time?"

Brainstorms and plans are distinct phases of feature work. A brainstorm captures divergent thinking and option exploration; a plan captures the chosen sequenced path to execute. Keep them as sibling documents when both matter — cross-link them. Collapse to a single `plan` note only when the brainstorm phase was trivial or absorbed into the plan during drafting.

A `plan` absorbs what older workflows split into a separate `spec`. Keep settled contract (what we're building, for whom, acceptance shape) and implementation path in one document. Only split when the plan grows unreadable or when execution churn would destabilize the settled contract — in that case, keep the settled portion at the top of the plan and cross-link to a sibling execution note. Do not create a new family for it.

### Deprecated: `spec`

`spec` is no longer part of the active taxonomy. New feature work should use `brainstorm` → `plan`. Existing `docs/specs/*.md` content can stay in place and be migrated into `docs/plans/` opportunistically; no forced migration. Do not create new spec files.

### Canonical Homes

Some families have canonical folder homes because tools (Compound Engineering skills, QMD collection masks, retrieval scripts) rely on them:

- `brainstorm` → `docs/brainstorms/`
- `plan` → `docs/plans/`
- `review` → `docs/reviews/`
- `research` → `docs/research/`
- `decision` → `docs/decisions/`
- `adr` → `docs/decisions/` with `ADR-NNN-*` filename
- `runbook` → `docs/runbooks/`
- `log` → `context/logs/` (session logs) or `docs/logs/` (other episodic logs)
- `solution` → `docs/solutions/` organized into category subfolders (e.g. `best-practices/`, `integration-issues/`, `logic-errors/`, `runtime-errors/`, `workflow-issues/`)
- `artifact-sidecar` → lives next to the parent note, or under `docs/artifacts/` when no parent note exists

Create a standalone note when the subtopic has lasting retrieval value, multiple findings, a clear verdict, or follow-up actions that should be recoverable later. Reviews, brainstorms, and solutions all follow this rule.

## Base Frontmatter

Use the smallest shape that helps retrieval:

```yaml
---
title: "Human-readable title"
type: note-type
status: active
updated: 2026-03-16
summary: "Only when it helps retrieval"
related:
  - path/to/related-note.md
source: path/to/source-note.md
---
```

Rules:
- Use `YYYY-MM-DD` (ISO 8601 date-only) for all date fields (`updated`, `created`, `meeting_date`, `decision_date`, etc.). This ensures lexicographic sort order matches chronological order.
- Keep `summary` optional.
- Add fields only when they improve retrieval, ranking, filtering, navigation, or automation.
- Prefer explicit relationships over large tag taxonomies.
- Prefer headings and body links over inventing metadata fields.
- Do not create a separate note for every sub-item by default.

## Naming Conventions

Prefer filenames and folder names that are scannable out of context.

- Use lowercase hyphenated slugs.
- In `my-second-brain`, prefer domain-prefixed project names when the plain slug would be ambiguous.
- Good examples:
  - `context/projects/holiday-fnq-july-2026.md`
  - `context/projects/holiday-easter-2026.md`
  - `docs/plans/holiday-fnq-july-2026/`
- Avoid context-thin names when the note will be hard to spot later in a long list.

For detailed file-based todos, prefer sortable names that encode stable ID and status, such as `001-ready-p1-auth-edge-cases.md`.

## Note Granularity Rules

Default to the smallest shape that preserves clarity and retrieval.

### Keep It Inline

Keep information inside an existing note when it is:
- small and readable in context
- unlikely to be searched for on its own
- best understood as part of the parent note
- limited to a short section or a few bullets

Example:
- a holiday booking listed inside a trip note

### Use An Artifact Sidecar

Use an `artifact-sidecar` when the main need is to preserve provenance for an external artifact without bloating the parent note.

Good sidecar candidates:
- booking confirmations
- receipts or invoices
- PDFs
- email threads
- transcripts
- exported reports

Prefer a sidecar when the artifact includes reference IDs, dates, links, attachments, terms, or status details that may matter later.

### Create A Standalone Note

Create a new standalone note when the subtopic has independent meaning, retrieval value, or follow-up.

Good triggers:
- it will be updated more than once
- it has multiple related artifacts
- it has its own tasks, decisions, or status changes
- it is likely to be linked from multiple places
- it is likely to be searched for directly later

The same logic applies to task surfaces:
- keep active work in `TASKS.md` by default
- create standalone files in `todos/` only when a work item has its own lifecycle, dependencies, or work log

### Decision Ladder

Use this order:
1. keep it inline by default
2. move to an `artifact-sidecar` when provenance-heavy external detail would clutter the parent note
3. create a standalone note only when the subtopic has an independent lifecycle

## Promotion Rules

Promote material into `my-second-brain` only when at least one of these is true:

- it is useful across multiple repos or life areas
- it is hard to rediscover
- it reflects a durable preference, pattern, or decision
- it carries personal strategic value
- it explains why future work should happen differently

Do not promote:
- raw meeting dumps when the source repo already owns them
- transient task churn
- large imported corpora purely for duplication
- generated artifacts with no durable value

## Provenance Rules

When a note is derived from an external artifact, preserve provenance with the smallest useful fields:

- `source`
- `source_system`
- `source_id`
- `source_url`

Artifact sidecars are preferred over pasting raw external URLs into many notes.

## Retrieval And Synthesis Roles

### QMD

QMD is the broad federated recall layer.

Use it for:
- searching across repos
- hybrid keyword and semantic recall
- finding relevant notes before reading them directly
- powering agent queries across a federated Markdown corpus

QMD should index note content and metadata. It should not become the source of truth.

When using repo collections, prefer roster-driven masks and path-level context so recall is grounded in the repo's intended docs surface rather than the whole working tree.

### NotebookLM

NotebookLM is the selective synthesis layer.

Use it for:
- briefings
- podcasts or audio overviews
- onboarding packs
- infographics
- thematic summaries

Do not load the entire corpus into NotebookLM by default. Prefer curated source packs for a specific purpose.

## Repo Participation Contract

A repo participates in the Memory OS by declaring:
- its role
- its source-of-truth scope
- whether it primarily holds authored knowledge or retrieval-oriented reference material
- its common note families
- what gets promoted upward
- what stays local

See `repo-profiles.md`.

## Agent Contract

Agents operating this system should:
- respect source-of-truth boundaries
- choose the smallest useful metadata shape
- prefer federation over duplication
- preserve provenance for imported artifacts
- use QMD for broad recall when available
- use NotebookLM only for curated synthesis workflows
- write durable conclusions back into Markdown when they matter

## Anti-Patterns

- Treating `my-second-brain` as a dump of every repo.
- Treating NotebookLM as the canonical knowledge base.
- Indexing only metadata and ignoring note bodies.
- Creating different metadata dialects in every repo.
- Promoting ephemeral chatter into durable memory.
- Building skills that duplicate the source-of-truth docs instead of pointing to them.
