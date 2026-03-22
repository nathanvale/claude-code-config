---
title: "Productivity Integration"
type: workflow
status: active
updated: 2026-03-17
summary: "How the productivity workflows fit into the user-scope Memory OS without breaking external connectors such as Gmail, calendar, and project trackers."
---

# Productivity Integration

## Purpose

Productivity workflows are fully user-scope, living at `~/.claude/skills/productivity-*`. They work consistently for:
- Claude Code
- Codex
- repo-local work repos
- `my-second-brain`

This integration keeps the existing productivity UX for tasks and sync flows while making ownership and promotion behave correctly inside the Memory OS.

## User-Scope Skills

| Skill | Invocable | Purpose |
|-------|-----------|---------|
| `productivity-tasks` | auto | TASKS.md management -- add, complete, triage |
| `productivity-memory` | auto | Repo-local hot memory plus durable local memory routing |
| `productivity-connectors` | no | Tool routing reference for external sources + `.productivity.yml` config |
| `productivity-setup` | `/productivity-setup` | First-run: create `.productivity.yml`, TASKS.md, bootstrap memory |
| `productivity-sync` | `/productivity-sync` | Sync from connected sources, triage, decode, fill gaps |

## Per-Project Config

Each project declares active connectors in `.productivity.yml` (created by `/productivity-setup`):

```yaml
connectors:
  calendar: google-calendar    # google-calendar | microsoft-365 | none
  email: gmail                 # gmail | microsoft-365 | none
  project-tracker: jira        # jira | asana | linear | github-issues | monday | clickup | none
  knowledge-base: confluence   # notion | confluence | none
  chat: none                   # slack | none
```

## Core Rule

Productivity is an operating layer, not a second memory model.

It should:
- respect repo ownership
- keep routine task churn local
- promote only durable knowledge upward
- preserve external connectors

It should not:
- assume the current working directory is always the right home
- duplicate large work corpora into `my-second-brain`
- replace QMD for federated recall

## Repo Resolution

Before writing tasks or memory, resolve the owning repo:

1. If the current repo declares a Memory OS profile, use that repo as the default owner.
2. If the request is clearly life-hub or cross-project, use `my-second-brain`.
3. If the request comes from a work repo, keep work tasks and work memory local unless promotion rules apply.
4. If ownership is unclear, ask the user before writing.

## Task Routing

Use the productivity task workflow like this:

- `life-hub`: personal commitments, life planning, cross-project control-plane tasks
- `work-repo`: delivery tasks, meeting follow-ups, stakeholder commitments, tracker sync results
- `infra-repo`: specs, maintenance, verification, operational follow-ups

Default task surface:
- local `TASKS.md` in the owning repo

Escalate to a `todos/` directory only when the repo has enough concurrent or dependency-heavy work that a single file becomes noisy.
In that mode:
- `TASKS.md` stays as the compact dashboard
- `todos/` holds one file per larger work item
- completed todo files should be cleaned up or compounded into durable docs rather than left to accumulate forever

## Memory Routing

Use the productivity memory workflow like this:

- keep `CLAUDE.md` as a lean repo-local hot-memory surface
- keep repo-specific people, projects, and shorthand in the repo that owns the work
- store cross-project personal synthesis and promoted durable knowledge in `my-second-brain`
- preserve provenance when memory comes from email, calendar, project trackers, or meeting transcriptions

Hot-memory rules:
- use exactly one repo-level `CLAUDE.md` surface
- keep it compact and broadly relevant
- prefer `memory/` for durable decoder-style detail
- prefer pointers over copied inventories

## External Connectors

Connector behavior is driven by `.productivity.yml` per project.

The productivity layer supports category-based external sources:
- email
- calendar
- project tracker
- knowledge base
- chat

These connectors remain tool-agnostic. Gmail, Microsoft 365, Jira, Linear, Asana, Notion, Confluence, Slack, and similar tools work through the connector mapping defined in the `productivity-connectors` skill.

## Claude And Codex

Claude Code and Codex should both use the same shared productivity rules:

- read `~/.config/memory/AGENTS.md`
- read this integration doc
- use the same repo-resolution logic
- use the same keep-local vs promote rules
- use QMD for broad recall when needed

Thin adapters are fine. Divergent behavior is not.

All productivity skills are user-scope at `~/.claude/skills/productivity-*` and work identically across both agents.

## Safe Update Flow

When `/productivity-sync` runs:

1. read `.productivity.yml` for connector config
2. resolve owning repo
3. read local tasks and memory in that repo
4. sync configured sources
5. offer task additions and memory updates
6. write only to the owning repo by default
7. recommend promotion only when the result is durable and cross-context

## Practical Default

For Nathan's setup today:
- `my-second-brain` is the life-hub
- work repos own their own task and memory surfaces
- QMD handles federated recall across all of them
- productivity workflows help maintain the local working surfaces
