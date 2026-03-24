---
name: tech-lead
description: Interactive pipeline advisor. Answers questions about workflow, health, blockers, and next steps. Runs heartbeat on every invocation. Composes babysitter for self-healing.
allowed-tools: Bash(git:*), Bash(gh:*), Read, Glob, Grep, Skill, AskUserQuestion, Task
skills: babysitter, ticket-state
context: inline
user-invocable: true
argument-hint: "[question] [--next] [--audit] [--health] [--heal <target>]"
---

# Task

Interactive pipeline advisor. Conversational, knows the full 19-skill ecosystem, answers questions, runs health checks, advises on workflow.

**Arguments:** `$ARGUMENTS`

## Route by Operation

Parse `$ARGUMENTS`:

- Empty or no args → **Status Mode**
- Starts with `--next` → **Next Mode** (just tell me what to run)
- Starts with `--audit` → **Audit Mode** (see [MODES.md](MODES.md))
- Starts with `--health` → **Health Mode** (see [MODES.md](MODES.md))
- Starts with `--heal` → **Heal Mode** (see [MODES.md](MODES.md))
- Starts with `--report` → **Report Mode** (see [MODES.md](MODES.md))
- Starts with `--dashboard` → **Dashboard Mode** (see [MODES.md](MODES.md))
- Anything else → **Ask Mode** (natural language question)

---

## Heartbeat (runs EVERY invocation)

Before any mode, run the heartbeat. Cache result to `~/.claude/state/tech-lead/last-health.json` with 5min TTL.

**Skip if cached:** Read `~/.claude/state/tech-lead/last-health.json`. If `checked_at` is less than 5 minutes ago, use cached values. Otherwise, run fresh.

**Fresh heartbeat — 4 bash commands (parallel):**

```bash
ls -d "$HOME/.claude/skills"/*/ 2>/dev/null | wc -l
```

```bash
[ -d "$HOME/.claude/state/tickets" ] && echo "OK" || echo "MISSING"
```

```bash
[ -s "$HOME/.claude/state/babysitter/inbox.ndjson" ] && echo "HAS_ITEMS" || echo "EMPTY"
```

```bash
ls "$HOME/.claude/state/babysitter/issues"/*.json 2>/dev/null | wc -l
```

**Auto-fix:** If state dirs are missing, create them:
```bash
mkdir -p ~/.claude/state/tickets ~/.claude/state/babysitter/issues ~/.claude/state/tech-lead
```

**Cache result:** Write to `~/.claude/state/tech-lead/last-health.json`:
```json
{
  "checked_at": "<ISO 8601 now>",
  "skill_count": <number>,
  "state_dir": "OK|MISSING",
  "inbox": "EMPTY|HAS_ITEMS",
  "open_issues": <number>
}
```

---

## Mode: Status (no args)

Default mode. Show current pipeline status with next-step advice.

### Steps

1. Run heartbeat (use cache if fresh)
2. Detect current ticket from git branch:
   ```bash
   git branch --show-current
   ```
   Extract ticket key from branch name (pattern: `feat/<KEY>-*` or `fix/<KEY>-*` or `<KEY>-*`).
3. If ticket key found: `Skill("ticket-state", args: "get <KEY>")`
4. Read `~/.claude/skills/tech-lead/PLAYBOOK.md` for stage-specific advice
5. Run advisory stage validations (see PLAYBOOK.md "Advisory Stage Validations")
6. Get last commit info:
   ```bash
   git log -1 --format="%cr — %s" 2>/dev/null
   ```

### Output

Use the progress bar and pipeline map from PLAYBOOK.md. Generate the bar based on stage index:

```
## Pipeline: <KEY>

<progress_bar> <stage_index>/9 <human_stage_name>

kickoff → plan → implement → test → qa → PR → review → approve → merge
                                              ▲

**Branch:** <branch>
**Health:** <skill_count> skills | <open_issues> issues
**Last commit:** <relative time> — "<message>"

### Next → `<command from Next Action Table>`
<one-line advice from PLAYBOOK.md>
```

**Progress bar by stage (use filled/empty blocks):**
- 0 kickoff: `[█░░░░░░░░]`
- 1 planned: `[██░░░░░░░]`
- 2 implementing: `[███░░░░░░]`
- 3 testing: `[████░░░░░]`
- 4 qa_verified: `[█████░░░░]`
- 5 pr_created: `[██████░░░]`
- 6 in_review: `[███████░░]`
- 7 changes_requested: `[███████░░]`
- 8 approved: `[████████░]`
- 9 merged: `[█████████]`

**Pipeline map arrow:** Place `▲` under the current stage name in the pipeline map.

**Human stage names:** kickoff→Kickoff, planned→Planning, implementing→Implementing, testing→Testing, qa_verified→QA Verified, pr_created→PR Review, in_review→In Review, changes_requested→Changes Requested, approved→Approved, merged→Merged

**Quick Command Reference (include below pipeline map):**
```
Command:  /plan    /git     /qa-test   (fix)   /git       /review    (wait)    /git
                   commit               ↻      pr-create  workflow             pr-merge
```

**Example output (stage = pr_created):**
```
## Pipeline: POS-3243

[██████░░░] 5/9 PR Review

kickoff → plan → implement → test → qa → PR → review → approve → merge
Command:  /plan    /git     /qa-test   (fix)   /git       /review    (wait)    /git
                   commit               ↻      pr-create  workflow             pr-merge
                                                ▲

**Branch:** test/POS-3243-cypress-tests
**Health:** 21 skills | 0 issues
**Last commit:** 2h ago — "refactor(tests): extract denominationIndexMap"

### Next → `/review-workflow`
Self-review first, then request team review.
```

**Branch warning:** If a ticket IS detected (from state) but the current branch is `master` or `main`, add a warning:
```
**Branch:** master -- you're on the main branch! Create a feature branch before coding:
`/git:worktree feat/<KEY>-<slug>`
```

If no ticket detected:
```
## Pipeline Status

**Branch:** <branch> (no ticket detected)
**Health:** <skill_count> skills | <open_issues> issues

No active ticket. Run `/kickoff <KEY>` or switch to a ticket branch.
```

---

## Mode: Next (`--next`)

Minimal-overhead "just tell me what to run." Detects current stage and outputs the next command. No health panel, no pipeline map — just the action.

### Steps

1. Detect current ticket from git branch:
   ```bash
   git branch --show-current
   ```
2. If ticket key found: `Skill("ticket-state", args: "get <KEY>")`
3. Look up stage in the Next Action Table (from PLAYBOOK.md)

### Output

```
Next → `<command>`
<one-line description>
```

If no ticket detected:
```
Next → `/kickoff <KEY>`
No active ticket. Pick one up to start.
```

---

## Mode: Ask (natural language question)

Route by keywords in the question. Always try Tier 1 (inline) first. Only escalate if the answer genuinely requires external data. See PLAYBOOK.md "Complexity Tiers" for tier definitions.

### Routing Table

All git operations use the unified `/git` skill: `Skill("git", args: "<operation> [args]")`.

#### Pipeline & Ticket (T1 — inline)

| Keywords | Route |
|----------|-------|
| "stage", "status", "where" | Read ticket-state inline |
| "next", "should I", "what now", "what do" | PLAYBOOK.md lookup |
| "healthy", "broken", "issues", "health" | Health check (heartbeat) |

#### Git — Local Repo (T2 — single delegation)

| Keywords | Route |
|----------|-------|
| "commit", "save", "done coding", "finished" | `Skill("git", args: "commit")` |
| "checkpoint", "wip", "save progress" | `Skill("git:checkpoint")` |
| "what changed", "diff", "changes" | `Skill("git", args: "diff")` |
| "git status", "uncommitted", "dirty", "working tree" | `Skill("git", args: "status")` |
| "log", "commit history", "recent commits" | `Skill("git", args: "log")` |
| "branch", "new branch", "create branch" | `Skill("git", args: "branch")` or `Skill("git", args: "branch-create")` |
| "stash", "save for later", "park this" | `Skill("git", args: "stash")` |
| "blame", "who wrote", "who changed" | `Skill("git", args: "blame <file>")` |
| "file history", "history of" | `Skill("git", args: "file-history <file>")` |
| "search commits", "find commit" | `Skill("git", args: "search <query>")` |
| "what did I do", "session activity" | `Skill("git:session-log")` |
| "worktree", "workspace", "parallel", "branch off" | `Skill("git:worktree")` |

#### Git — Pull Requests (T2 — single delegation)

| Keywords | Route |
|----------|-------|
| "create pr", "open pr", "push pr", "ready for review" | `Skill("git", args: "pr-create")` |
| "view pr", "pr status", "pr details" | `Skill("git", args: "pr-view")` |
| "list prs", "open prs", "my prs" | `Skill("git", args: "pr-list")` |
| "pr diff", "pr changes" | `Skill("git", args: "pr-diff")` |
| "checks", "ci", "pipeline", "build status" | `Skill("git", args: "pr-checks")` |
| "merge", "merge pr", "ship it" | `Skill("git", args: "pr-merge")` |
| "mark ready", "ready for review", "undraft" | `Skill("git", args: "pr-ready")` |
| "review pr", "pr review", "code review" | `Skill("git", args: "pr-review")` |
| "comment on pr", "pr comment" | `Skill("git", args: "pr-comment")` |
| "approve", "request changes", "submit review" | `Skill("git", args: "pr-submit-review")` |

#### Reports & Activity (T2 — single delegation)

| Keywords | Route |
|----------|-------|
| "standup", "standup report", "daily report" | `Skill("report", args: "--standup")` |
| "weekly", "weekly report", "this week" | `Skill("report", args: "--weekly")` |
| "velocity", "metrics", "how fast" | `Skill("report", args: "--velocity")` |
| "what happened", "activity", "timeline" | Use `--report` mode (inline) |
| "dashboard", "all tickets", "overview" | Use `--dashboard` mode (inline) |

#### Other Skills (T2 — single delegation)

| Keywords | Route |
|----------|-------|
| "blocking", "blocked", "blocker" | `Skill("report", args: "--blockers")` or ticket-state check |
| "how does", "explain", "what is" | `Skill("learn", args: "<topic>")` |
| "against plan", "vs plan", "review impl" | `Skill("review-impl")` |

#### Fan-out (T3)

| Keywords | Route |
|----------|-------|
| "why did", "root cause", "diagnose" | Fan-out diagnosis via Task agents |
| Unclassified | AskUserQuestion to clarify intent |

---

## Additional Resources

- For detailed mode specifications (Audit, Health, Report, Dashboard, Heal) and WISDOM.jsonl, see [MODES.md](MODES.md)
- For pipeline stage advice, advisory validations, complexity tiers, and cheatsheet, see [PLAYBOOK.md](PLAYBOOK.md)
- For pipeline stage reference and auto-advance triggers, see [PIPELINE.md](PIPELINE.md)
