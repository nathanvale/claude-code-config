---
title: "CLAUDE.md Contract"
type: contract
status: active
updated: 2026-03-19
summary: "Shared contract for repo-local CLAUDE.md hot-memory files across Memory OS repos."
---

# CLAUDE.md Contract

## Purpose

Define the shared rules for `CLAUDE.md` across repos that subscribe to the Memory OS.

`CLAUDE.md` is a repo-local hot-memory file. It is not the durable memory system, not the task system, and not the full documentation set.

## Core Rule

Use exactly one repo-level hot-memory file:

- `CLAUDE.md`
- or `.claude/CLAUDE.md`

Do not keep both at the same repo root unless there is a deliberate migration in progress.

Subdirectory `CLAUDE.md` files are allowed only when they are intentionally path-scoped and lazy-loaded by the toolchain.

## What `CLAUDE.md` Is For

Keep only information that is:

- needed often at session start
- broadly relevant to most work in the repo
- hard for the agent to infer quickly from files or tools alone

Typical good content:

- current repo focus
- a small set of must-follow repo rules
- key paths and source documents
- task surface location
- compact Memory OS ownership notes
- short-lived scaffold items that are clearly marked

## What Does Not Belong Here

Move these elsewhere:

- stable repo policy -> `AGENTS.md`
- durable facts, people, glossary, tools, and project context -> `memory/`
- active task details -> `TASKS.md` or `todos/`
- plans, specs, research, runbooks, and decisions -> `docs/`
- path-specific or workflow-specific instructions -> `.claude/rules/` or repo docs

Prefer pointers over copied detail.

## Size Guidance

- target: under 120-150 lines
- soft cap: 200 lines
- if it grows beyond that, refactor it into an index with links to authoritative notes

Shorter is usually better when the file is loaded into every session.

## Recommended Shape

Use a compact structure like:

```md
# Memory

## Project
- what this repo is

## Current Focus
- what matters right now

## Always / Never
- only the few rules that truly matter every session

## Key Paths
- where plans, specs, runbooks, and durable memory live

## Task Surface
- `TASKS.md` or `todos/`

## Memory OS
- shared contract path
- repo profile
```

Repo-specific sections are allowed, but keep them lean.

## Scaffold Rule

Temporary hot-memory items are allowed when they are clearly marked.

Use markers such as:

```md
<!-- scaffold: waiting for access -->
```

Scaffold items should be removed, rewritten, or promoted once they stabilize.

## Promotion Rule

If a fact survives more than a couple of sessions, ask whether it should move:

- to `AGENTS.md` if it is a stable repo rule
- to `memory/` if it is durable context
- to `docs/` if it deserves a full authored note

Do not let `CLAUDE.md` become the place where unclassified information goes to hide.

## Audit Checklist

When auditing a repo:

- exactly one repo-level `CLAUDE.md` exists
- the file is still easy to scan quickly
- `AGENTS.md`, `TASKS.md`, `memory/`, and `docs/` boundaries are explicit
- durable people, glossary, and tool inventories are not duplicated unnecessarily
- scaffold items are marked and still relevant

## Relationship To Other Files

- `AGENTS.md` = durable repo rules and source-of-truth boundaries
- `CLAUDE.md` = hot memory and launch pad
- `TASKS.md` = active work dashboard
- `memory/` = durable compact recall
- `docs/` = full authored documents
