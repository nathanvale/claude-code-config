# Mode Specifications

Detailed steps and output formats for tech-lead modes. Referenced from SKILL.md.

---

## Mode: Audit (`--audit`)

Full pipeline integrity check.

### Steps

1. Run heartbeat (full scan, **ignore cache**)
2. `Skill("ticket-state", args: "list")` — all active tickets
3. For each active ticket:
   a. `Skill("ticket-state", args: "get <KEY>")`
   b. Check stage vs git/GitHub reality (drift detection):
      - `implementing` but no commits on branch? → Warn
      - `pr_created` but no PR exists? → Warn
      - `in_review` but PR has no reviews? → Warn
      - `approved` but PR not actually approved? → Warn
      - PR exists but stage is pre-`pr_created`? → Warn (drift)
   c. Check for stale state (no update in >7 days):
      ```bash
      # Compare updated timestamp to now
      ```
4. Babysitter artifact scan — verify skill files:
   ```bash
   for d in $(ls -d "$HOME/.claude/skills"/*/); do
     name=$(basename "$d")
     [ -f "$d/SKILL.md" ] || echo "MISSING_SKILL_MD: $name"
   done
   ```
5. Check for orphaned branches (branches with no corresponding ticket state)
6. Read and prune WISDOM.jsonl (keep last 100 entries)

### Output

```
## Pipeline Audit

### Active Tickets
| Key | Stage | Branch | Drift? |
|-----|-------|--------|--------|
| <KEY> | <stage> | <branch> | <drift warnings or "None"> |

### Ecosystem
- Skills: <count> present, <missing count> missing SKILL.md
- State: <dir status>
- Inbox: <status>
- Open issues: <count>

### Drift Detected
- <KEY>: Stage is `implementing` but PR already exists on GitHub → Consider advancing to `pr_created`
- ...

### Stale Tickets
- <KEY>: Last updated <N> days ago at stage `<stage>`

### Summary
<ticket_count> tickets scanned. <drift_count> drift warnings. <stale_count> stale tickets. <issue_count> open issues.
```

If drift detected, log to WISDOM.jsonl:
```jsonl
{"at":"<ISO>","type":"drift","ticket":"<KEY>","detail":"<description>","fix":"<suggestion>"}
```

---

## Mode: Health (`--health`)

Quick ecosystem health scan. Heartbeat only (full scan, no ticket context).

### Steps

1. Run heartbeat (full scan, **ignore cache**)
2. Render health panel

### Output

```
## Ecosystem Health

- **Skills:** <count> directories found
- **State dir:** <OK or MISSING (auto-created)>
- **Babysitter inbox:** <EMPTY or HAS_ITEMS>
- **Open issues:** <count>

All systems operational.
```

Or if problems found:
```
## Ecosystem Health

- **Skills:** <count> directories found
- **State dir:** MISSING → auto-created
- **Babysitter inbox:** HAS_ITEMS — run `/babysitter` to process
- **Open issues:** <count> — run `/babysitter` to diagnose

Action needed: <specific advice>
```

---

## Mode: Report (`--report`)

Answer "what happened?" questions using the activity log.

### Step 1: Read Activity Log

```bash
cat ~/.claude/state/activity.ndjson 2>/dev/null | tail -50
```

Parse each JSON line. Group by ticket and skill.

### Step 2: Parse Optional Filters

From `$ARGUMENTS` after `--report`:
- `today` → Filter for today's date
- `week` → Filter for last 7 days
- `POS-XXXX` → Filter for specific ticket

### Step 3: Answer Queries

Common queries this mode handles:

| Query | How to Answer |
|-------|---------------|
| "What happened?" | Summarize recent activity from log |
| "What did I ship this week?" | Filter `op: "pr-merge"` events in last 7 days |
| "When did X happen?" | Search log for matching ticket/skill/op |
| "How long did Y take?" | Calculate duration between `init` and `complete` events |

### Step 4: Output

```
## Activity Report

### Recent Events (last 24h)
| Time | Ticket | Skill | Operation | Details |
|------|--------|-------|-----------|---------|
| 09:15 | POS-3243 | kickoff | init | Started |
| 10:30 | POS-3243 | plan | complete | 3 phases |
| 14:00 | POS-3243 | git | commit | feat(msw): add seller mock |

### Summary
- 1 ticket active (POS-3243)
- 3 commits today
- 0 PRs merged
```

---

## Mode: Dashboard (`--dashboard`)

Show all tickets grouped by pipeline stage — single pane of glass.

### Step 1: List All Tickets

```
Skill("ticket-state", args: "list --all")
```

### Step 2: Group by Stage

Organize tickets into stage buckets:

| Stage | Tickets |
|-------|---------|
| kickoff | — |
| planned | — |
| implementing | POS-XXXX |
| testing | — |
| qa_verified | — |
| pr_created | POS-3044, POS-3243 |
| in_review | — |
| approved | — |
| merged | (last 5 only) |

### Step 3: Enrich with PR Status

For tickets in `pr_created` or later, check PR status:
```bash
gh pr list --author @me --json number,title,state,headRefName,reviewDecision --limit 20
```

### Step 4: Read MANIFEST for Context

```
Read: ~/.claude/skills/MANIFEST.json
```

Extract `pipeline_stages` for stage descriptions.

### Step 5: Output

```
## Pipeline Dashboard

### Active Work
| Stage | Ticket | Summary | PR | Status |
|-------|--------|---------|----|---------|
| implementing | POS-XXXX | New feature | — | 3 commits |
| pr_created | POS-3044 | Distributor handling | #441 | Awaiting review |
| pr_created | POS-3243 | Cypress tests | #446 | Awaiting review |

### By Stage
- **kickoff:** 0 tickets
- **planned:** 0 tickets
- **implementing:** 1 ticket
- **testing:** 0 tickets
- **qa_verified:** 0 tickets
- **pr_created:** 2 tickets (2 PRs open)
- **in_review:** 0 tickets
- **approved:** 0 tickets
- **merged:** 12 tickets (last 30 days)

### Health
- Ecosystem: healthy
- Drift: 0 items
- Stale: 0 tickets

Run `/babysitter scan` for detailed health check.
```

---

## Mode: Heal (`--heal <target>`)

Direct delegation to babysitter.

Parse target from `$ARGUMENTS` after `--heal`. Pass through directly:

```
Skill("babysitter", args: "heal <target>")
```

Report babysitter's output back to Nathan conversationally.

---

## Learning (WISDOM.jsonl)

Append-only NDJSON log at `~/.claude/skills/tech-lead/WISDOM.jsonl`.

**When to write:**
- During audit: drift detected → log entry
- After stage corrections
- After repeated questions about the same topic

**Entry format:**
```jsonl
{"at":"<ISO 8601>","type":"drift|pattern|insight","ticket":"<KEY or null>","detail":"<description>","fix":"<action taken or suggested>"}
```

**When to read:** During `--audit` mode and T3 fan-out only. Never on T1 fast path.

**Pruning:** Keep last 100 entries. Prune during `--audit`:
```bash
tail -100 ~/.claude/skills/tech-lead/WISDOM.jsonl > /tmp/wisdom-pruned.jsonl && mv /tmp/wisdom-pruned.jsonl ~/.claude/skills/tech-lead/WISDOM.jsonl
```
