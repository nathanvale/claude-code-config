---
name: plan
description: Interactive planning session. Reads gathered context from kickoff, pair-programs a technical plan with Nathan in the main context. Creates plan file and Obsidian note.
allowed-tools: Read, Write, Bash(git:*), Skill, AskUserQuestion, mcp__plugin_para-obsidian_para-obsidian__*
skills: ticket-state
user-invocable: true
argument-hint: "POS-XXXX"
context: inline
---

# Plan: Interactive Technical Planning

Runs in the **main context** (no fork) so Nathan can pair-program the plan naturally. Reads gathered context from a prior `/kickoff` run and collaborates on a technical plan.

## Step 1: Load Context

1. Detect ticket key from `$ARGUMENTS` or git branch:
   ```bash
   git branch --show-current
   ```
   Extract `POS-\d+` from args or branch name. If neither yields a key, ask Nathan.

2. Load current state:
   ```
   Skill("ticket-state", args: "get <KEY>")
   ```

3. Load gathered context:
   ```
   Skill("ticket-state", args: "get-gathered <KEY>")
   ```

4. If gathered context not found:
   ```
   No gathered context found for <KEY>. Run `/kickoff <KEY>` first to explore the ticket and codebases.
   ```
   Stop here.

5. If stage is already `planned` or beyond:
   ```
   AskUserQuestion: "This ticket is already at stage `<stage>`. Re-plan? This will overwrite the existing plan."
   Options: "Yes, re-plan" | "No, keep existing plan"
   ```
   If "No" → stop.

## Step 1b: Branch Check

Before planning, check if we're on a feature branch for this ticket:

```bash
git branch --show-current
```

If on `master` or `main` (not a `feat/<KEY>-*` or `fix/<KEY>-*` branch):

1. Proactively suggest creating a worktree or branch:
   ```
   You're still on master. Let's create a branch before we go further:

   /git:worktree feat/<KEY>-<slug>
   ```
2. Use the ticket's suggested branch from gathered context if available, otherwise generate `feat/<KEY>-<short-description>`
3. If Nathan defers ("I'll do it later"), continue planning but remind again at handoff (Step 7)

This prevents the common mistake of starting implementation work on master.

## Step 1c: Figma Fallback

Check if gathered context has usable Figma data (`figma.frames` or `figma.exported_images` non-empty). If Figma is missing or rate-limited:

1. Get the Figma URL from gathered context (`ticket.figma_url`)
2. Ask Nathan to screenshot the relevant frames:
   ```
   AskUserQuestion: "Figma data is unavailable (rate-limited). Can you screenshot the relevant frames?"
   Options:
     - "Here's the Figma link — I'll screenshot it" (provide the Figma URL)
     - "Skip Figma — use JIRA attachments instead"
     - "I'll paste a screenshot now"
   ```
3. If Nathan provides a screenshot, read it and extract design details (layout, spacing, component structure, colors, states)
4. If skipped, note in plan that Figma verification is deferred

This prevents planning blind when Figma exports fail.

## Step 2: Present Context Summary

Show Nathan what was gathered — this orients the conversation:

```
## Planning: <KEY> — <ticket.summary>

### Acceptance Criteria
1. <AC text>
2. ...

### Key Files (from kickoff exploration)
- `<path>` — <purpose>
- ...

### Dependencies
- <repo> <route> — <status> (<linked ticket>)

### Gaps
- <gap descriptions from gathered context>

Ready to plan. What's your thinking on approach?
```

## Step 3: Pair-Program (natural conversation)

From here, it's a natural back-and-forth. No rigid phases — the skill sets up context and then Claude and Nathan collaborate.

Typical flow:
- Discuss approach to each AC
- Debate implementation order
- Identify risks and blockers
- Make decisions (record via `ticket-state decide`):
  ```
  Skill("ticket-state", args: "decide <KEY> '<decision>' --rationale '<why>'")
  ```
- Iterate until Nathan says "looks good" or "let's write it up"

### Question Categorization

When presenting questions during planning, **always categorize them** so Nathan knows who needs to answer:

- **Coding (us)** — Architecture, component structure, patterns, testing approach. Nathan answers these.
- **BA (Sonny/Tanya)** — Business rules, default values, status labels, copy/wording, edge case behavior.
- **PO (Suzy)** — Scope questions, priority trade-offs, feature inclusion/exclusion.
- **Backend (MJ/Prasanth)** — API contracts, endpoint availability, filter support, data shape.
- **QA (Cheryl/Angela/Aarti)** — Test scenarios, expected behavior, regression concerns.
- **Design** — Spacing, colors, states, responsive behavior. Check Figma or ask designer.
- **Platform (Marc)** — Infrastructure, deployment, environment config.

Format questions grouped by stakeholder:

```
### Coding (for us)
1. Should we pull the search bar out of the DataGrid toolbar?

### BA (Sonny/Tanya)
1. Which status values should appear in the filter?
2. Should the date filter default to "Last 30 days" or show all?

### Backend (MJ)
1. When will $filter support land on /orders? (POS-3025)
```

If Nathan can make a pragmatic call based on the spec/Figma, go with it and note it as a decision that can be adjusted later.

Stay in conversation mode. Do NOT generate the plan file until Nathan signals readiness.

## Step 4: Generate Plan File

When Nathan is ready, create the plan file using [PLAN_TEMPLATE.md](PLAN_TEMPLATE.md).

Path: `~/.claude/plans/<KEY>-plan.md`

Write the technical plan produced from the conversation — current state, AC gap analysis, implementation phases, key files, complexity assessment, etc.

Record in state:
```
Skill("ticket-state", args: "update <KEY> --plan-file '~/.claude/plans/<KEY>-plan.md'")
```

## Step 5: Create/Update Obsidian Note

1. Run `para_commit` to ensure vault is clean
2. Search for existing note:
   ```
   para_search({ query: "<KEY>", dir: "01 Projects", response_format: "json" })
   ```
3. If found, ask Nathan: update existing or create new?
4. Use `para_create` with template "project" OR `para_replace_section` to update existing note
5. Include:
   - Links (Jira, Figma, related tickets, Confluence)
   - Scope — IN / OUT
   - Key Decisions (from state `decisions[]`)
   - Acceptance Criteria
   - Technical Notes (the generated plan summary)
   - Tasks
   - Stakeholders
   - Risks & Blockers
6. **IMPORTANT**: Use plain bullets (`-`) for ACs, NOT checkboxes (`- [x]`) which render as strikethrough

Record in state:
```
Skill("ticket-state", args: "update <KEY> --plan-obsidian '<note path>'")
```

## Step 6: Advance State

```
Skill("ticket-state", args: "advance <KEY> planned --note 'Plan created: <N> phases, <complexity> complexity, <N> decisions'")
```

One call — `advance --note` already writes to history, so a separate `log` is redundant.

## Step 7: Handoff

```
Plan complete for <KEY>.

- Plan file: `~/.claude/plans/<KEY>-plan.md`
- Obsidian note: <note path>

Ready to start implementing? Begin coding or run `/where-am-i` to check status.
```

## Error Handling

| Scenario | Handling |
|----------|---------|
| Gathered not found | Direct to `/kickoff` |
| State not found | Init state, then check for gathered |
| Obsidian write fails | Warn, plan file still exists |
| Vault uncommitted changes | Run `para_commit` first |

### Activity Logging

Log planning milestones to the central activity stream:

```bash
~/.claude/bin/activity-log.sh plan <op> <KEY> [extra]
```

**When to log:**

| Step | Operation | Extra Fields |
|------|-----------|--------------|
| Step 2 (context loaded) | `start` | — |
| Step 3 (decision made) | `decision` | `,"decision":"<brief>"` |
| Step 6 (state advanced) | `complete` | `,"phases":<count>,"complexity":"<level>"` |

**Example:**
```bash
~/.claude/bin/activity-log.sh plan start POS-3243
~/.claude/bin/activity-log.sh plan decision POS-3243 ',"decision":"Use MSW for mock data"'
~/.claude/bin/activity-log.sh plan complete POS-3243 ',"phases":3,"complexity":"medium"'
```

### Babysitter Inbox Reporting

On transient failures, report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md):
- `gathered_not_found` — get-gathered returns not_found
- `obsidian_write_failed` — para_create or para_replace_section fails

## Output Contract

Since this skill runs inline (interactive pair-programming), it does not return structured output to a caller. The deliverables are:
1. A plan file written to `~/.claude/plans/<slug>.md`
2. An Obsidian note (if vault available)
3. ticket-state advanced to `planned`

If invoked programmatically, return:
```
### Result
Plan created for <KEY>: <plan file path>

### Context for Caller
- status: success|failed
- operation: plan
- key: <KEY>
- plan_file: <path>
- obsidian_note: <created|skipped|failed>
- stage: planned
```
