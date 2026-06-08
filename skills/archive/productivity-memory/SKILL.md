---
name: productivity-memory
description: Two-tier memory system that makes Claude a workplace collaborator. Decodes shorthand, acronyms, nicknames, and internal language. Use when the user asks to remember something, look up a person/term, or manage workplace context. Do not use for task operations.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
---

# Memory Management

Memory makes Claude your workplace collaborator -- someone who speaks your internal language.

Use the shared Memory OS contract at `~/.config/context/AGENTS.md` when available.

Prefer `/capture` as the default front door when the user is bringing in new material.
Use this skill for decoder-style memory work: shorthand, people, projects, terms, and compact context updates.

## Read Order

1. `~/.config/context/docs/memory-os-contract.md`
2. `~/.config/context/docs/productivity-integration.md`

## The Goal

Transform shorthand into understanding:

```
User: "ask todd to do the PSR for oracle"
              -> Claude decodes
"Ask Todd Martinez (Finance lead) to prepare the Pipeline Status Report
 for the Oracle Systems deal ($2.3M, closing Q2)"
```

Without memory, that request is meaningless. With memory, Claude knows:
- **todd** -> Todd Martinez, Finance lead
- **PSR** -> Pipeline Status Report (weekly sales doc)
- **oracle** -> Oracle Systems deal, not the company

## Architecture

```
CLAUDE.md          <- Hot memory (current focus, must-know rules, key paths)
context/
  glossary.md      <- Full decoder ring
  people/          <- Canonical person notes under one shared contract
  projects/        <- Project details
  context/         <- Durable repo or workplace context
```

**CLAUDE.md (Hot Memory):**
- current focus
- small set of must-follow repo rules
- key paths
- task surface
- compact pointers to durable memory when needed
- **Goal: help session startup, not store the whole decoder ring**

**context/glossary.md (Full Glossary):**
- Complete decoder ring -- terms, acronyms, aliases, nicknames
- Searched when decoder detail is needed
- Can grow indefinitely

**context/people/, projects/, context/:**
- Rich detail when needed for execution
- Full profiles, history, context

## People Note Contract

Person memory is a shared note contract, not a freeform side system.

Use one canonical note per person in `context/people/*.md` with:
- `## Relationship Profile`
- `## Signals`
- `## Open Questions`

When a decoder-style workflow needs to update a person:
- do not freehand rewrite the note shape
- point producer-style writes at `~/.claude/skills/people-enrich/scripts/apply-person-update.ts`
- keep durable observations in `## Signals`
- put ambiguity and conflicts in `## Open Questions`
- keep relationship-profile edits conservative and H3-scoped
- preserve the Memory OS ownership boundary: source repos own raw operational truth, `my-second-brain` owns durable synthesis

## Lookup Flow

```
User: "ask todd about the PSR for phoenix"

1. Check CLAUDE.md (hot memory)
   -> Todd? Todd Martinez, Finance
   -> PSR? Pipeline Status Report
   -> Phoenix? DB migration project

2. If not found -> search context/glossary.md
   -> Full glossary has everyone/everything

3. If still not found -> ask user
   -> "What does X mean? I'll remember it."
```

This tiered approach keeps CLAUDE.md lean while supporting unlimited scale in `context/`.

## File Locations

- **Working memory:** `CLAUDE.md` in the owning repo
- **Deep memory:** `context/` subdirectory in the owning repo
- **Full authored documents:** `docs/` in the owning repo when the user needs research notes, plans, specs, decisions, logs, or artifacts

Do not assume the current working directory is automatically the right owner. If the repo declares a Memory OS profile, follow that repo's ownership rules. Keep repo-specific memory local unless promotion rules clearly apply.

## Working Memory Format (CLAUDE.md)

Keep it compact and broadly relevant. Target ~60-120 lines total.

```markdown
# Memory

## Project
- [What this repo is for]

## Current Focus
- [What matters right now]

## Always / Never
- [Few rules that matter in most sessions]

## Key Paths
- `AGENTS.md`
- `TASKS.md`
- `context/`
- `docs/`

## Memory OS
- Shared contract path
- Repo profile
```

## Extending CLAUDE.md

As your workflow matures, CLAUDE.md can grow beyond the base template. Common extensions:

- **Current blocker** -- a short-lived scaffold item
- **Key command** -- only when hard to infer and used constantly
- **Important pointer** -- to a durable note in `context/` or `docs/`

Keep CLAUDE.md under ~150 lines. When a section grows large, extract the detail to `context/` or `docs/` and leave a pointer.

## Deep Memory Format (context/)

**context/glossary.md** -- The decoder ring:
```markdown
# Glossary

Workplace shorthand, acronyms, and internal language.

## Acronyms
| Term | Meaning | Context |
|------|---------|---------|
| PSR | Pipeline Status Report | Weekly sales doc |
| OKR | Objectives & Key Results | Quarterly planning |
| P0/P1/P2 | Priority levels | P0 = drop everything |

## Internal Terms
| Term | Meaning |
|------|---------|
| standup | Daily 9am sync in #engineering |
| the migration | Project Phoenix database work |
| ship it | Deploy to production |
| escalate | Loop in leadership |

## Nicknames -> Full Names
| Nickname | Person |
|----------|--------|
| Todd | Todd Martinez (Finance) |
| T | Also Todd Martinez |

## Project Codenames
| Codename | Project |
|----------|---------|
| Phoenix | Database migration |
| Horizon | New mobile app |
```

**context/people/{name}.md:**
```markdown
---
title: "Todd Martinez"
type: person
status: active
updated: 2026-03-22
summary: "Finance lead and key contact for approvals."
person_id: "person_todd_martinez"
slug: "todd-martinez"
relationship_type: "professional"
aliases:
  - Todd
  - T
source_handles: {}
---

## Relationship Profile

### Relationship

Key finance counterpart for approvals and forecasting.

## Signals

- Prefers Slack DM
- Usually responds quickly and directly

## Open Questions

- Confirm current approval threshold after the next finance sync
```

**context/projects/{name}.md:**
```markdown
# Project Phoenix

**Codename:** Phoenix
**Also called:** "the migration"
**Status:** Active, launching Q2

## What It Is
Database migration from legacy Oracle to PostgreSQL.

## Key People
- Sarah -- tech lead
- Todd -- budget owner
- Greg -- stakeholder (sales impact)

## Context
$1.2M budget, 6-month timeline. Critical path for Horizon project.
```

**context/context/company.md:**
```markdown
# Company Context

## Tools & Systems
| Tool | Used for | Internal name |
|------|----------|---------------|
| Slack | Communication | - |
| Asana | Engineering tasks | - |
| Salesforce | CRM | "SF" or "the CRM" |
| Notion | Docs/wiki | - |

## Teams
| Team | What they do | Key people |
|------|--------------|------------|
| Platform | Infrastructure | Sarah (lead) |
| Finance | Money stuff | Todd (lead) |
| Sales | Revenue | Greg |

## Processes
| Process | What it means |
|---------|---------------|
| Weekly sync | Monday 10am all-hands |
| Ship review | Thursday deploy approval |
```

## How to Interact

### Decoding User Input (Tiered Lookup)

**Always** decode shorthand before acting on requests:

```
1. CLAUDE.md (hot memory)    -> Check first for startup context and key pointers
2. context/glossary.md        -> Full glossary if not in hot memory
3. context/people/, projects/ -> Rich detail when needed
4. Ask user                  -> Unknown term? Learn it.
```

### Adding Memory

When user says "remember this" or "X means Y":

1. **Glossary items** (acronyms, terms, shorthand):
   - Add to context/glossary.md
   - Promote only a short pointer into CLAUDE.md if the term becomes session-critical and broadly relevant

2. **People:**
   - Use the canonical people note contract in `context/people/{name}.md`
   - Route structured producer-style writes through `~/.claude/skills/people-enrich/scripts/apply-person-update.ts`
   - **Capture nicknames** -- critical for decoding

3. **Projects:**
   - Create/update context/projects/{name}.md
   - **Capture codenames** -- "Phoenix", "the migration", etc.

4. **Preferences:** Add to repo memory or CLAUDE.md only if they affect most sessions in this repo

### Recalling Memory

When user asks "who is X" or "what does X mean":

1. Check CLAUDE.md first
2. Check context/ for full detail
3. If not found: "I don't know what X means yet. Can you tell me?"

### Progressive Disclosure

1. Load CLAUDE.md for quick parsing of any request
2. Dive into context/ when you need full context for execution
3. Example: drafting an email to todd about the PSR
   - CLAUDE.md points you to the owning memory surfaces and key paths
   - context/people/todd-martinez.md tells you he prefers Slack, is direct

## Bootstrapping

Use `/productivity-setup` to initialize by scanning your tasks, calendar, email, and documents. Extracts people, projects, and starts building the glossary.

When the shared Memory OS is present, keep external connector behavior unchanged but route the resulting memory according to repo ownership and promotion rules.

## Conventions

- **Bold** terms in CLAUDE.md for scannability
- Keep CLAUDE.md under ~150 lines
- Filenames: lowercase, hyphens (`todd-martinez.md`, `project-phoenix.md`)
- Always capture nicknames and alternate names
- Glossary tables for easy lookup
- When something becomes durable, move it out of CLAUDE.md
- Keep exactly one repo-level CLAUDE.md surface

## What Goes Where

| Type | CLAUDE.md (Hot Memory) | context/ (Full Storage) |
|------|----------------------|------------------------|
| Person | Rarely; only as a short pointer when session-critical | glossary.md + people/{name}.md |
| Acronym/term | Rarely; only as a short pointer when session-critical | glossary.md (complete list) |
| Project | Current focus only | glossary.md + projects/{name}.md |
| Nickname | Usually no | glossary.md (all nicknames) |
| Company context | Quick pointer only | context/company.md |
| Preferences | Only if they affect most sessions in this repo | context/context/ or related note |
| Historical/stale | Remove | Keep in context/ |

## Promotion / Demotion

**Promote to CLAUDE.md when:**
- it changes how most sessions in the repo should start
- it is broadly relevant, not just occasionally useful
- a short pointer or reminder is enough

**Demote to context/ only when:**
- the detail becomes durable reference material
- the section starts growing into an inventory
- the content is no longer useful on most sessions

This keeps CLAUDE.md fresh and relevant.
