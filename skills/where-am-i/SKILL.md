---
name: where-am-i
description: Show current ticket pipeline status with progressive rendering. Instant cached view, automatic git checks, optional network refresh. Supports --fix, --dry-run, and --full flags. Multi-phase aware — auto-detects phase from branch prefix.
allowed-tools: Bash, Read, Write, Skill, AskUserQuestion
context: inline
argument-hint: "[POS-XXXX] [--fix] [--dry-run] [--full]"
skills: ticket-state
---

# Task

Show pipeline status for the current ticket using **progressive rendering**:
- **Tier 1 (instant):** Render full panel from cached state file
- **Tier 2 (auto, local):** Git status + commits + ecosystem health
- **Tier 3 (optional, network):** Jira + GitHub refresh with smart staleness

**Arguments:** `$ARGUMENTS` (optional ticket key, optional flags)

**Flags:**
- `--fix` — Auto-apply ALL drift corrections (forces Tier 3)
- `--dry-run` — Report-only mode, no fixes applied (forces Tier 3)
- `--full` — Force network refresh without prompting

**Supporting files** (read when needed, not upfront):
- [RENDERING.md](./RENDERING.md) — All output format specifications
- [DRIFT_CONDITIONS.md](./DRIFT_CONDITIONS.md) — Drift detection rules and fix actions
- [NETWORK_CHECKS.md](./NETWORK_CHECKS.md) — Tier 3 API calls and error handling

---

## Step 0: Parse Arguments

1. Extract ticket key if `$ARGUMENTS` contains `POS-\d+`.
2. Extract flags: `--fix`, `--dry-run`, `--full` from `$ARGUMENTS`.
3. Determine mode:
   - `--fix` → auto-fix mode (forces Tier 3)
   - `--dry-run` → report mode (forces Tier 3)
   - `--full` → full refresh (forces Tier 3, interactive drift)
   - no flags → default interactive (Tier 3 uses smart staleness)

## Step 1: Detect Ticket Key and Phase

If a key was extracted from arguments, use it and skip the bash call.

Otherwise, detect from git branch:
```bash
git branch --show-current
```

**1a. Extract ticket key:** Find `POS-\d+` in the branch name.

**1b. Detect phase from branch prefix:**

| Branch Prefix | Phase ID |
|---------------|----------|
| `feat/` | `impl` |
| `test/` | `test` |
| `fix/` | `fix` |
| `docs/` | `docs` |
| `chore/` | `chore` |

Store `detected_phase` for use in Step 2 (multi-phase handling).

If no `POS-\d+` found:
```
## No Ticket Detected

Current branch `<branch>` doesn't contain a ticket key (expected `POS-XXXX`).

**Options:**
- Run `/where-am-i POS-XXXX` with an explicit key
- Rename branch: `git branch -m feat/POS-XXXX-description`
```
Then invoke `Skill("ticket-state", args: "list")` to show all active tickets, and **stop**.

---

## Step 2: Tier 1 — Instant Render from Cache

### 2a. Read State File Directly

Use `Read` tool (NOT `Skill("ticket-state", "get")` — the Skill fork adds overhead):
```
Read: ~/.claude/state/tickets/<KEY>.json
```

If file does not exist:
```
## <KEY> — No State Found

No pipeline state exists for this ticket yet. To initialize:
- Run `/kickoff <KEY>` for full ticket exploration and plan
- Or a quick init will be done automatically

**Quick init:** Would you like me to initialize state from Jira?
```
Then invoke `Skill("ticket-state", args: "init <KEY>")` to create state, re-read the file, and continue. If init fails, **stop** with error.

Parse the JSON. Tolerate V1/V2/V3 by defaulting missing fields in-memory (no writes):
- `work_log` → `[]`
- `decisions` → `[]`
- `plan` → `{ "confluence": null, "obsidian": null, "file": null }`
- `gathered_file` → `null`
- `last_checked` → `null`
- `live_snapshot` → `null`
- `multi_phase` → `false`
- `phases` → `{}`
- `active_phase` → `null`

If branch was not detected in Step 1 (user passed explicit key), read it from `state.branch`.

### 2a-extra. Multi-Phase Detection and Auto-Creation

If state file exists AND `multi_phase: false` AND `detected_phase` (from Step 1b) is NOT `impl`:
- **Auto-create phase:** Invoke `Skill("ticket-state", args: "phase-add <KEY> <detected_phase> --branch <branch>")`
- Re-read the state file to get updated multi-phase data

If state file exists AND `multi_phase: true`:
- Check if `detected_phase` matches `active_phase`
- If not, this is **phase drift** — see [DRIFT_CONDITIONS.md](./DRIFT_CONDITIONS.md) Phase Drift section

### 2b. Calculate Staleness

From `state.last_checked` (if present), compute relative times for `git`, `jira`, `github`.
Format as: "2 min ago", "1 hour ago", "yesterday", or "never" if null.

### 2c. Render Full Panel Immediately

**IMPORTANT:** Output the entire panel BEFORE proceeding to Tier 2. The user must see it immediately.

Render all sections per [RENDERING.md](./RENDERING.md) Tier 1 specifications:
1. Header + Pipeline Visualization
2. Context Table
3. Dependencies (if `linked_tickets[]` non-empty)
4. Phases (if `multi_phase: true` with >1 entry)
5. Recent Work (last 2 `work_log[]` entries)
6. Key Decisions (if `decisions[]` non-empty)
7. Blockers (if `blockers[]` non-empty)
8. Recent Notes (last 3 `notes[]`)
9. Suggested Next Action (based on `state.stage`)
10. Remaining Pipeline (if stage is not `merged`)

---

## Step 3: Tier 2 — Local Git Checks (automatic)

These are instant (local filesystem only). Always run them.

### 3a. Gather Git Data

Run in parallel:
```bash
git status --porcelain | head -20
```
```bash
git log master..HEAD --oneline 2>/dev/null | head -10
```

Parse: count modified, untracked, staged files from porcelain; count commits from log.

### 3b. Ecosystem Health

Combine into a single bash call:
```bash
ls ~/.claude/state/babysitter/issues/*.json 2>/dev/null | head -5; echo "---HEALTH-SEP---"; for d in ticket-state git kickoff where-am-i review-workflow codebase-search babysitter; do [ -f "$HOME/.claude/skills/$d/SKILL.md" ] || echo "MISSING: $d"; done; echo "---HEALTH-SEP---"; for f in ~/.claude/state/tickets/*.json; do [ -f "$f" ] && python3 -c "import json; json.load(open('$f'))" 2>/dev/null || echo "CORRUPTED: $f"; done
```

Parse the three sections separated by `---HEALTH-SEP---`.

### 3c. Git-Only Drift Detection

Check drift conditions #7 and #8 from [DRIFT_CONDITIONS.md](./DRIFT_CONDITIONS.md).
Apply fixes per the mode logic in that file.

### 3d. Render Tier 2 Update

Output the compact Tier 2 update per [RENDERING.md](./RENDERING.md) Tier 2 section.

### 3e. Update Live Snapshot (git fields)

Read state file, merge git fields into `last_checked` and `live_snapshot`, write back:

```json
{
  "last_checked": { "git": "<now ISO>", "jira": "<preserve>", "github": "<preserve>" },
  "live_snapshot": {
    "git_status": { "modified": N, "untracked": N, "staged": N },
    "commits_ahead": N,
    "jira_status": "<preserve>", "jira_assignee": "<preserve>",
    "pr_state": "<preserve>", "pr_review_decision": "<preserve>"
  }
}
```

Only touch `last_checked` and `live_snapshot` — preserve all other fields exactly.

---

## Step 4: Tier 3 — Network Refresh (conditional)

### 4a. Determine If Tier 3 Should Run

Use the staleness decision matrix from [NETWORK_CHECKS.md](./NETWORK_CHECKS.md).
If "Skip" selected or auto-skipped, jump to Step 5.

### 4b. Execute Selected Checks

Run GitHub and/or Jira checks per [NETWORK_CHECKS.md](./NETWORK_CHECKS.md).

### 4c. Network Drift Detection

Check drift conditions #1-#6 from [DRIFT_CONDITIONS.md](./DRIFT_CONDITIONS.md), filtered by which sources were checked. Also run blocker resolution check from that file.
Apply fixes per the mode logic.

### 4d. Render Network Update

Output the Tier 3 network update per [RENDERING.md](./RENDERING.md) Tier 3 section.

### 4e. Update Live Snapshot (network fields)

Merge network results into the state file per [NETWORK_CHECKS.md](./NETWORK_CHECKS.md) live snapshot schema.

---

## Step 5: Final Summary

If any drift was fixed across Tier 2 and Tier 3, render per [RENDERING.md](./RENDERING.md) Final Summary section.

If drift was detected, update the suggested next action to prepend the drift warning.

---

## Output Contract

For programmatic callers (when invoked via Skill fork):

```
### Result
<KEY> at stage `<stage>`. <N> drift items detected.

### Context for Caller
- status: success|failed
- operation: where-am-i
- key: <KEY>
- stage: <stage>
- drift_count: <N>
- tier_reached: <1|2|3>
```

## Activity Logging

Log all events per [DRIFT_CONDITIONS.md](./DRIFT_CONDITIONS.md) Activity Logging section:

```bash
~/.claude/bin/activity-log.sh where-am-i <op> <KEY> [extra]
```

Log on: run completion (`check`), drift detection (`drift_detected`), drift fix (`drift_fixed`).

## Babysitter Inbox Reporting

On transient failures, report per [NETWORK_CHECKS.md](./NETWORK_CHECKS.md) Babysitter Inbox Reporting section.

Error codes: `state_read_failed`, `drift_fix_failed`, `jira_fetch_failed`, `github_fetch_failed`.
