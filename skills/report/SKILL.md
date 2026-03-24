---
name: report
description: Generate standup and weekly reports from activity log and ticket state. Outputs DM-friendly formats for Jackie.
allowed-tools: Bash, Read, Glob, Skill
context: fork
skills: ticket-state, jira
disable-model-invocation: true
user-invocable: true
argument-hint: "[--standup] [--weekly] [--sprint] [--velocity] [--blockers] [--timeline POS-XXXX] [--day YYYY-MM-DD]"
---

# Task

Generate reports from the activity log and ticket state. Designed for ADHD (wins first = dopamine) and DM scannability (table).

**Arguments:** `$ARGUMENTS`

## Route by Flags

Parse `$ARGUMENTS`:

- Empty or `--standup` → **Standup Mode** (today's activity)
- `--weekly` → **Weekly Mode** (last 7 days)
- `--sprint` → **Sprint Mode** (current Jira sprint)
- `--velocity` → **Velocity Mode** (stage transition metrics)
- `--blockers` → **Blockers Mode** (all blocked tickets)
- `--timeline POS-XXXX` → **Timeline Mode** (all events for one ticket)
- `--day YYYY-MM-DD` → **Day Mode** (all events from specific day)

---

## Data Sources

### Activity Log

**Path:** `~/.claude/state/activity.ndjson`

Each line is JSON:
```json
{"at":"2026-02-04T06:15:00Z","skill":"kickoff","op":"init","ticket":"POS-3243",...}
```

**Read with:**
```bash
cat ~/.claude/state/activity.ndjson
```

### Ticket State Files

**Path:** `~/.claude/state/tickets/*.json`

**List with:**
```bash
ls ~/.claude/state/tickets/*.json 2>/dev/null
```

**Read individual with:**
```
Skill("ticket-state", args: "get <KEY>")
```

---

## Mode: Standup (default)

Generate a standup-ready report. Standups happen in the morning and cover **since the last standup** — typically yesterday's work plus current state.

### Step 0: Sync State (prevents stale reports)

**CRITICAL: Always sync before building a report. A stale report is worse than no report.**

Run a lightweight drift check against GitHub for all non-merged tickets. This catches PRs that were merged/approved since the last state update.

```bash
gh pr list --author @me --json number,state,headRefName,reviewDecision --limit 20
```

For each non-merged ticket from `ticket-state list`:
1. Match ticket branch to PR via `headRefName`
2. If PR `state == "MERGED"` but ticket stage is not `merged` → `Skill("ticket-state", args: "advance <KEY> merged --note 'PR merged (sync before report)'")`
3. If PR `reviewDecision == "APPROVED"` but ticket stage is before `approved` → `Skill("ticket-state", args: "advance <KEY> approved --note 'PR approved (sync before report)'")`
4. If PR `reviewDecision == "CHANGES_REQUESTED"` but ticket stage is not `changes_requested` → `Skill("ticket-state", args: "update <KEY> --stage changes_requested")`
5. If PR exists but ticket stage is before `pr_created` → `Skill("ticket-state", args: "advance <KEY> pr_created --note 'PR detected (sync before report)'")`

This is a fast, targeted check — NOT a full babysitter scan. It only checks GitHub PR state vs ticket state for active tickets.

### Step 1: Gather Data (activity log + ticket state + git)

Read the activity log:
```bash
cat ~/.claude/state/activity.ndjson 2>/dev/null
```

Read active tickets:
```
Skill("ticket-state", args: "list")
```

Get recent git activity (last 2 days):
```bash
git log --all --author="$(git config user.name)" --since="2 days ago" --format="%h %s (%ar)" 2>/dev/null
```

Get recently merged PRs:
```bash
gh pr list --author @me --state merged --json number,title,headRefName,mergedAt --limit 10 2>/dev/null
```

### Step 2: Determine Time Window

Standups cover **the last working day** — NOT just "today":
- If it's Monday morning, cover Friday + weekend
- If it's any other day, cover yesterday + this morning
- **Practical rule:** Look at the **last 24-48 hours** of activity

Filter activity log, git commits, and PR events within this window.

### Step 3: Categorize Activity

Group events by category:

**Wins** (milestones reached in the standup window):
- PRs merged (from `gh pr list --state merged` or activity log `op: "pr-merge"`)
- PRs created/opened for review (from activity log `op: "pr-create"` or ticket state reaching `pr_created`)
- QA verified (activity log `op: "advance"` where `to` is `qa_verified`)
- Plans completed (activity log `op: "complete"` for plan skill)
- **ALSO check ticket state history** — if a ticket was recently advanced to `merged`, `pr_created`, `approved`, etc., that's a win even if the activity log doesn't have it

**In Progress** (work touched but not a milestone):
- Commits pushed (from git log)
- Activity log `op: "init"`, `"start"`, `"commit"`, `"decision"`
- Any ticket activity not already in Wins

**Blockers** (from ticket state):
- Tickets with non-empty `blockers[]` array
- Tickets with `linked_tickets[].relation === "blocked-by"` where the blocking ticket is not Done

### Step 4: Build Ticket Table

For each ticket with activity today:

| Ticket | Stage | PR | Notes |
|--------|-------|-----|-------|

Get current stage from ticket-state. Get PR from state or from activity `pr-create` event.

### Step 5: Output

⚠️ **OUTPUT FORMAT: Delimiter-wrapped deterministic block**

After gathering data, emit the report wrapped in `---STANDUP---` delimiters. The caller will extract only the content between delimiters. You MAY think/analyze before the opening delimiter — that will be stripped.

```
---STANDUP---
## Nathan — DD Mon
...the report...
Generated at HH:mm AEDT
---STANDUP---
```

**The content between delimiters must be this markdown block EXACTLY:**

```
## Nathan — DD Mon

**Wins:**
- TICKET summary (PR #N merged)
- TICKET summary ready for review (PR #N)

**Blockers:** None

| Ticket | Stage | PR | Notes |
|--------|-------|-----|-------|
| POS-XXXX | PR Review | #446 | Awaiting team review |

**Focus today:** Get reviews, respond to feedback

---
Generated at HH:mm AEDT
```

**MANDATORY FORMATTING RULES — violating any of these makes the report unusable:**

1. **Header:** `## Nathan — DD Mon` — use em dash `—` (NOT `--`), zero-pad day (`04` not `4`), no day-of-week name, no year
2. **Wins:** bullet list with `- `. If no wins: `- (no milestones today)`. NEVER omit this section.
3. **Blockers:** `**Blockers:** None` on one line. Or bullet list if blockers exist. NEVER omit.
4. **Table:** MUST be a markdown pipe table with header row and separator row. NEVER use flat key-value pairs. Only include NON-MERGED tickets. Merged tickets belong in Wins, not the table. Stage column uses human-readable names:
   - `kickoff` → `Kickoff`
   - `planned` → `Planning`
   - `implementing` → `Implementing`
   - `testing` → `Testing`
   - `qa_verified` → `QA Verified`
   - `pr_created` → `PR Review`
   - `in_review` → `In Review`
   - `changes_requested` → `Changes Requested`
   - `approved` → `Approved`
   - PR column: `#N` (short number, NOT full URL). Use `—` if no PR.
5. **Focus today:** `**Focus today:** <one sentence>`. NEVER omit.
6. **Footer:** blank line, then `---`, then newline, then `Generated at HH:mm AEDT`. NEVER omit.
7. **NOTHING ELSE** — no preamble, no explanation, no "Here's your standup", no trailing text, no sync status commentary, no thinking-out-loud, no analysis summary. The `## Nathan` line MUST be the absolute first characters of your output. If you catch yourself writing anything before `##`, delete it. This is a machine-format output, not a conversation.

**Focus today logic:**
- If any tickets in `pr_created` or `in_review`: "Get reviews, respond to feedback"
- If any tickets in `implementing`: "Continue coding on <ticket>"
- If any tickets in `planned`: "Start implementation on <ticket>"
- If any tickets in `kickoff`: "Complete planning for <ticket>"
- Default: "Pick up next ticket"

---

## Mode: Weekly (`--weekly`)

Generate a weekly summary for Friday/Monday.

### Step 0: Sync State

Run the same lightweight drift check as Standup Step 0 (see above). A weekly report with stale data is even worse than a stale standup.

### Step 1: Read Activity Log

```bash
cat ~/.claude/state/activity.ndjson 2>/dev/null
```

Filter for last 7 days. Group by date.

### Step 2: Categorize by Outcome

**Shipped** (merged this week):
- `op: "pr-merge"` events
- `op: "advance"` where `to: "merged"`

**In Flight** (not yet merged):
- Tickets with activity this week but not merged

**Velocity Metrics:**
- Count PRs merged
- Count stage transitions
- Calculate average time in stages (if enough data)

### Step 3: Output

```markdown
## Nathan — Week of DD-DD Mon

**Shipped:**
- <ticket>: <summary> (PR #N merged)
- ...

**In Flight:**
- <ticket>: <summary> (at <stage>)

**Velocity:**
- N PRs merged
- N tickets progressed
- Avg time to review: X days (or "N/A" if insufficient data)

**Next Week:**
- <inference from in-flight tickets>

---
Generated at HH:mm AEDT Day
```

---

## Mode: Sprint (`--sprint`)

Generate a sprint-focused report.

### Step 1: Get Current Sprint

```
Skill("jira", args: "sprint")
```

Extract sprint name and tickets.

### Step 2: Cross-Reference with Activity

For each sprint ticket, check activity log for recent events.

### Step 3: Output

```markdown
## Sprint: <Sprint Name>

| Ticket | Jira Status | Pipeline Stage | Last Activity |
|--------|-------------|----------------|---------------|
| POS-3044 | In Progress | pr_created | 2h ago |
| POS-3243 | In Progress | implementing | today |

**Progress:** N/M tickets in pipeline (N% with PRs)

---
Generated at HH:mm AEDT
```

---

## Mode: Velocity (`--velocity`)

Generate stage transition metrics.

### Step 1: Read Activity Log

Filter for `op: "advance"` events with `from` and `to` fields.

### Step 2: Calculate Metrics

- Count transitions per stage
- Calculate time-in-stage (diff between consecutive advances for same ticket)
- Identify bottleneck stages (longest average time)

### Step 3: Output

```markdown
## Velocity Report

### Stage Transition Counts (Last 30 Days)
| From | To | Count | Avg Time |
|------|-----|-------|----------|
| planned | implementing | N | X days |
| implementing | testing | N | X days |
| pr_created | in_review | N | X days |
| in_review | approved | N | X days |

### Bottlenecks
- Longest stage: `in_review` (avg X days)
- Most skipped: `testing` (N tickets went straight to pr_created)

---
Generated at HH:mm AEDT
```

---

## Mode: Blockers (`--blockers`)

Show all currently blocked tickets.

### Step 1: Read All Ticket States

```bash
ls ~/.claude/state/tickets/*.json 2>/dev/null
```

Read each file, check for blockers.

### Step 2: Identify Blockers

- `blockers[]` array non-empty
- `linked_tickets[].relation === "blocked-by"` where blocker is not Done

### Step 3: Output

```markdown
## Current Blockers

| Ticket | Stage | Blocker | Notes |
|--------|-------|---------|-------|
| POS-3044 | implementing | API not ready (POS-3036) | Expected next week |

**Summary:** N tickets blocked

---
Generated at HH:mm AEDT
```

If no blockers:
```markdown
## Current Blockers

No blocked tickets.

---
Generated at HH:mm AEDT
```

---

## Mode: Timeline (`--timeline POS-XXXX`)

Show all activity for a single ticket chronologically.

### Step 1: Extract Ticket Key

Parse `POS-\d+` from `$ARGUMENTS`.

### Step 2: Filter Activity Log

```bash
grep '"ticket":"<KEY>"' ~/.claude/state/activity.ndjson
```

### Step 3: Output

```markdown
## Timeline: <KEY>

| Time | Skill | Operation | Details |
|------|-------|-----------|---------|
| DD Mon HH:mm | kickoff | init | Stage: kickoff |
| DD Mon HH:mm | plan | start | — |
| DD Mon HH:mm | plan | decision | Use MSW for mock data |
| DD Mon HH:mm | plan | complete | 3 phases, medium complexity |
| DD Mon HH:mm | ticket-state | advance | planned → implementing |
| DD Mon HH:mm | git | commit | feat(msw): add seller mock |
| DD Mon HH:mm | git | pr-create | PR #446 |

**Total Duration:** X days (first event to latest)
**Current Stage:** <from ticket-state>

---
Generated at HH:mm AEDT
```

---

## Mode: Day (`--day YYYY-MM-DD`)

Show all activity from a specific day.

### Step 1: Extract Date

Parse `YYYY-MM-DD` from `$ARGUMENTS`.

### Step 2: Filter Activity Log

```bash
grep "^{\"at\":\"$DATE" ~/.claude/state/activity.ndjson
```

### Step 3: Output

Same format as standup, but for the specified date.

---

## Error Handling

| Scenario | Handling |
|----------|---------|
| Activity log empty | "No activity recorded yet. Events will appear as you use /kickoff, /plan, /git, etc." |
| Activity log missing | "Activity log not found. Create with: `touch ~/.claude/state/activity.ndjson`" |
| No tickets found | "No active tickets. Run `/kickoff POS-XXXX` to start a ticket." |
| Invalid date format | "Invalid date. Use format: YYYY-MM-DD" |
| Ticket not found | "No activity found for <KEY>. Check the ticket key." |

---

## Activity Logging

This skill reads the activity log but does not write to it (reports are read-only operations).
