---
name: productivity-tasks
description: Manages tasks in a shared TASKS.md file. Use when the user asks about tasks, wants to add/complete tasks, or needs help tracking commitments. Do not use for memory or calendar operations.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
---

# Task Management

Tasks are tracked in a simple repo-local `TASKS.md` file that both you and the user can edit.
Treat it as the active dashboard, not a permanent ledger.

Use the shared Memory OS contract at `~/.config/memory/AGENTS.md` when available.

## Read Order

1. `~/.config/memory/docs/memory-os-contract.md`
2. `~/.config/memory/docs/productivity-integration.md`

## File Location

**Use `TASKS.md` in the owning repo.**

- If the owning repo already has one, read/write to it
- If it doesn't exist, create it with the template below
- Do not assume the current working directory is always the right owner when the shared Memory OS is present
- If the repo also has a `todos/` directory, keep `TASKS.md` as the compact summary view rather than replacing it

## Format & Template

When creating a new `TASKS.md`:

- If `~/.config/memory/templates/TASKS.md` exists, use that shared template.
- Otherwise, use this fallback template:

```markdown
# Tasks

## Now

## Next

## Blocked

## Later

## Done
```

Task format:
- `- [ ] **Task title** - context, for whom, due date`
- Sub-bullets for additional details
- Completed: `- [x] ~~Task~~ (date)`

## How to Interact

**When user asks "what's on my plate" / "my tasks":**
- Read TASKS.md
- Summarize `Now` and `Blocked` first, then `Next` if helpful
- Highlight anything overdue or urgent

**When user says "add a task" / "remind me to":**
- Add to `Next` by default with `- [ ] **Task**` format
- Include context if provided (who it's for, due date)
- If the task is already in motion, add it to `Now`
- If the task is blocked on someone or something else, add it to `Blocked`

**When user says "done with X" / "finished X":**
- Find the task
- Change `[ ]` to `[x]`
- Add strikethrough: `~~task~~`
- Add completion date
- Move to Done section

**When user asks "what am I waiting on":**
- Read the `Blocked` section
- Note how long each item has been waiting

## Conventions

- **Bold** the task title for scannability
- Include "for [person]" when it's a commitment to someone
- Include "due [date]" for deadlines
- Include "since [date]" for waiting items
- Sub-bullets for additional context
- Keep `Done` short-lived, then clear old items

## Extracting Tasks

When summarizing meetings or conversations, offer to add extracted tasks:
- Commitments the user made ("I'll send that over")
- Action items assigned to them
- Follow-ups mentioned

Ask before adding -- don't auto-add without confirmation.

When external connectors are available, keep using them. Gmail, calendar, knowledge base, and project-tracker sync remain valid sources for task discovery; the Memory OS only changes where those tasks should live.
