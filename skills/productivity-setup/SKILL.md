---
name: productivity-setup
description: Initialize productivity system for a project -- creates .productivity.yml connector config, TASKS.md, and bootstraps workplace memory. Run once per project to configure which external sources (calendar, email, Jira, etc.) are active.
argument-hint: [project path]
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
---

# Productivity Setup

First-run entry point. Creates the per-project connector config, initializes task tracking, and bootstraps workplace memory.

Use the shared Memory OS contract at `~/.config/memory/AGENTS.md` when available.

## Read Order

1. `~/.config/memory/docs/memory-os-contract.md`
2. `~/.config/memory/docs/productivity-integration.md`

## Instructions

If `~/.config/memory/AGENTS.md` exists, use it as the shared contract for repo ownership and promotion before creating or updating local task and memory files.

### 1. Check What Exists

Check the working directory for:
- `.productivity.yml` -- connector config
- `TASKS.md` -- task list
- `CLAUDE.md` or `.claude/CLAUDE.md` -- one canonical hot-memory file
- `memory/` -- deep memory directory

### 2. Configure Connectors

**If `.productivity.yml` exists:** Show current config and ask if the user wants to update it.

**If `.productivity.yml` doesn't exist:** Present each connector category as a numbered choice:

```
Let's configure which external sources to connect for this project:

1. Calendar:
   (1) Google Calendar  (2) Microsoft 365  (3) None

2. Email:
   (1) Gmail  (2) Microsoft 365  (3) None

3. Project Tracker:
   (1) Jira  (2) Asana  (3) Linear  (4) GitHub Issues  (5) Monday  (6) ClickUp  (7) None

4. Knowledge Base:
   (1) Notion  (2) Confluence  (3) None

5. Chat:
   (1) Slack  (2) None

6. Messages:
   (1) iMessage  (2) None
```

Write `.productivity.yml` with the selected values. Reference the **productivity-connectors** skill for the connector value names.

### 3. Create What's Missing

**If `TASKS.md` doesn't exist:** Create it with the shared Memory OS template at `~/.config/memory/templates/TASKS.md` when available. Otherwise use the fallback template from the `productivity-tasks` skill. Place it in the current working directory.

**If `memory/` doesn't exist:** Create the scaffold directory structure with `.keep` files so the LLM and sync skill know where things go:

```
memory/
  glossary.md          # empty — acronyms, terms, nicknames, codenames
  people/.keep         # individual profiles (one file per person)
  projects/.keep       # project details (one file per project)
  context/.keep        # company, teams, tools, processes
```

Create `glossary.md` as an empty file (it's a single file, not a directory). Create `.keep` in each subdirectory.

**If no canonical repo-level `CLAUDE.md` and no `memory/` exist:** This is a fresh setup -- begin the memory bootstrap workflow (see Step 5).

If the shared Memory OS is present, interpret "current working directory" as the owning repo resolved by the Memory OS rules, not merely the shell cwd.

### 4. Orient the User

If everything was already initialized:
```
Productivity system configured. Your tasks and memory are ready.
- /productivity-sync to sync tasks and check memory
- /productivity-sync --deep for a comprehensive scan of all activity
```

If memory hasn't been bootstrapped yet, continue to Step 5.

### 5. Bootstrap Memory (First Run Only)

Only do this if no canonical repo-level `CLAUDE.md` and no `memory/` exist yet.

The best source of workplace language is the user's actual task list. Real tasks = real shorthand.

**Ask the user:**
```
Where do you keep your todos or task list? This could be:
- A local file (e.g., TASKS.md, todo.txt)
- An app (e.g. Asana, Linear, Jira, Notion, Todoist)
- A notes file

I'll use your tasks to learn your workplace shorthand.
```

**Once you have access to the task list:**

Reference the **productivity-connectors** skill for MCP tool names if the user points to an external app. If the tool is unavailable, ask the user to paste or describe their tasks instead.

For each task item, analyze it for potential shorthand:
- Names that might be nicknames
- Acronyms or abbreviations
- Project references or codenames
- Internal terms or jargon

**For each item, decode it interactively:**

```
Task: "Send PSR to Todd re: Phoenix blockers"

I see some terms I want to make sure I understand:

1. **PSR** - What does this stand for?
2. **Todd** - Who is Todd? (full name, role)
3. **Phoenix** - Is this a project codename? What's it about?
```

Continue through each task, asking only about terms you haven't already decoded.

### 6. Optional Deep Scan

After task list decoding, offer:
```
Do you want me to do a deep scan of your messages, emails, and documents?
This takes longer but builds much richer context about the people, projects,
and terms in your work.

(1) Yes, deep scan
(2) No, stick with what we have
```

**If they choose deep scan:**

Gather data from available MCP sources (reference the **productivity-connectors** skill for tool names, skip unavailable sources):
- **Chat:** Recent messages, channels, DMs
- **Email:** Sent messages, recipients
- **Documents:** Recent docs, collaborators
- **Calendar:** Meetings, attendees

Build a braindump of people, projects, and terms found. Present findings grouped by confidence:
- **Ready to add** (high confidence) -- offer to add directly
- **Needs clarification** -- ask the user
- **Low frequency / unclear** -- note for later

### 7. Write Memory Files

From everything gathered, create:

**CLAUDE.md** (hot memory, ~60-120 lines):
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
- `memory/`
- `docs/`

## Memory OS
- shared contract path
- repo profile
```

**memory/** directory:
- `memory/glossary.md` -- full decoder ring (acronyms, terms, nicknames, codenames)
- `memory/people/{name}.md` -- individual profiles
- `memory/projects/{name}.md` -- project details
- `memory/context/company.md` -- teams, tools, processes

Do not create both `CLAUDE.md` and `.claude/CLAUDE.md` at the same repo root.

When the shared Memory OS is present, keep this memory local to the owning repo by default. Promote only durable cross-context knowledge into `my-second-brain`.

### 8. Report Results

```
Productivity system ready:
- Connectors: .productivity.yml (calendar: X, email: X, tracker: X, kb: X, chat: X)
- Tasks: TASKS.md (X items)
- Memory: X people, X terms, X projects

Use /productivity-sync to keep things current (add --deep for a comprehensive scan).
```

## Notes

- If memory is already initialized, this just shows current config
- Nicknames are critical -- always capture how people are actually referred to
- If a source isn't available, skip it and note the gap
- Memory grows organically through natural conversation after bootstrap
