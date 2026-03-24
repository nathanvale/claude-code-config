---
name: babysitter
description: Self-healing ecosystem orchestrator. Detects issues across all skills by scanning artifacts, processes transient error inbox, diagnoses failures via sub-agents, auto-fixes known issues, and silently learns new patterns.
allowed-tools: Bash, Read, Write, Glob, Grep, Task, Skill, AskUserQuestion, ToolSearch
context: fork
argument-hint: "[heal <target>] [learn-from <description>] [report <skill> <error> --message '<text>']"
---

# Task

Ecosystem health monitor and self-healing orchestrator. Invisible when healthy, automatic when broken.

**Arguments:** `$ARGUMENTS`

## Route by Operation

Parse `$ARGUMENTS`:

- Empty or no args → **Smart Default** (status → diagnose → heal)
- Starts with `scan` → **Scan** (health check across all tickets using MANIFEST rules)
- Starts with `heal` → **Heal** (explicit fix for a specific issue)
- Starts with `heal --all` → **Heal All** (auto-fix all known drift patterns)
- Starts with `learn-from` → **Learn From** (manual knowledge entry)
- Starts with `report` → **Report** (building block — issue intake from skills)

---

## Operation: Smart Default (no args)

The only command Nathan needs to remember. Does the right thing.

### Step 1: Ensure State Directory

```bash
mkdir -p ~/.claude/state/babysitter/issues
```

### Step 2: Process Inbox

Check for transient errors pushed by skills via bash echo.

```bash
cat ~/.claude/state/babysitter/inbox.ndjson 2>/dev/null
```

If file exists and has content:
1. Read each line, parse as JSON (skip malformed lines silently)
2. For each valid entry, create an issue file:
   ```
   ID format: YYYYMMDD-HHmmss-<skill>-<error_code>
   Path: ~/.claude/state/babysitter/issues/<ID>.json
   ```
   Issue file contents:
   ```json
   {
     "id": "<ID>",
     "at": "<from inbox entry or now>",
     "skill": "<from entry>",
     "error_code": "<from entry>",
     "message": "<from entry>",
     "ticket": "<from entry or null>",
     "source": "inbox",
     "resolved": false,
     "resolved_at": null,
     "resolution": null,
     "known_issue_match": null
   }
   ```
3. Truncate the inbox:
   ```bash
   : > ~/.claude/state/babysitter/inbox.ndjson
   ```

### Step 3: Pull-Based Artifact Scan

Run these checks to detect structural issues:

**3a. Skill file existence** — verify all expected skill directories have SKILL.md:
```bash
for d in $(ls -d "$HOME/.claude/skills"/*/); do
  name=$(basename "$d")
  [ -f "$d/SKILL.md" ] || echo "MISSING_SKILL_MD: $name"
done
```

For skills without SKILL.md (like `pr-create`, `pr-review` which may only have command wrappers), also check:
```bash
[ -f "$HOME/.claude/commands/$d.md" ] || echo "NO_COMMAND_EITHER: $d"
```

Only flag as an issue if BOTH skill dir and command wrapper are missing.

**3b. State file parsability** — verify all ticket state files are valid JSON:
```bash
for f in ~/.claude/state/tickets/*.json; do
  [ -f "$f" ] && python3 -c "import json; json.load(open('$f'))" 2>&1 | grep -q "Error" && echo "CORRUPTED: $f"
done
```

**3c. Orphaned state detection** — check for state files whose branches no longer exist:
```bash
for f in ~/.claude/state/tickets/*.json; do
  if [ -f "$f" ]; then
    branch=$(python3 -c "import json; d=json.load(open('$f')); print(d.get('branch',''))" 2>/dev/null)
    stage=$(python3 -c "import json; d=json.load(open('$f')); print(d.get('stage',''))" 2>/dev/null)
    if [ -n "$branch" ] && [ "$stage" != "merged" ]; then
      git branch --list "$branch" | grep -q . || echo "ORPHANED: $f (branch: $branch)"
    fi
  fi
done
```

**3d. State directory existence:**
```bash
[ -d "$HOME/.claude/state/tickets" ] || echo "MISSING_DIR: tickets"
[ -d "$HOME/.claude/state/babysitter/issues" ] || echo "MISSING_DIR: babysitter/issues"
```

For each detected issue from 3a-3d, create an issue file (same format as inbox promotion) with `"source": "scan"`.

### Step 4: Resolve Issues

1. Read all unresolved issue files:
   ```bash
   ls ~/.claude/state/babysitter/issues/*.json 2>/dev/null
   ```

2. Read `~/.claude/skills/babysitter/KNOWN_ISSUES.json`

3. For each unresolved issue file:
   a. Read the issue JSON
   b. Skip if `resolved: true`
   c. Match against KNOWN_ISSUES.json patterns:
      - Match by `error_code` against pattern's `error_codes[]`
      - Match by substring in `message` against pattern's `detection`
   d. If match found and `auto_fixable: true`:
      - Execute the fix (bash command or Skill invocation)
      - Mark issue resolved: update the issue file with `resolved: true`, `resolved_at`, `resolution: "<what was done>"`, `known_issue_match: "<pattern id>"`
   e. If match found and `auto_fixable: false`:
      - Report to Nathan with the known fix instructions
      - Do NOT prompt — just show the fix
   f. If no match found (novel issue):
      - **Diagnose** — spawn up to 3 parallel Task agents (see Diagnosis Agents below)
      - Propose fix to Nathan
      - Ask once: "Apply this fix?" (Yes / Skip)
      - If applied successfully, **silently learn**: append a new pattern to KNOWN_ISSUES.json

### Step 5: Output

If everything healthy and no issues:
```
Ecosystem: 17/17 skills present. No open issues.
```

If problems were found:
```
## Ecosystem Health

### Issues Found
- [FIXED] ticket-state/state_corrupted — Backed up and re-initialized POS-3044 state
- [KNOWN] figma/figma_rate_limited — Wait 60s and retry (Figma rate limits reset per-minute)
- [DIAGNOSED] codebase-search/mcp_tool_unavailable — Proposed: re-run ToolSearch

### Summary
17/17 skills present. 3 issues processed (1 auto-fixed, 1 known, 1 diagnosed).
```

Status labels:
- `FIXED` — auto-applied known fix
- `KNOWN` — matched a known pattern, manual fix shown
- `DIAGNOSED` — novel issue, fix proposed or applied after Nathan confirmed
- `SKIPPED` — Nathan chose not to apply proposed fix

---

## Operation: Scan

Periodic health check across all tickets using MANIFEST.json health rules.

### Step 1: Load MANIFEST

```
Read: ~/.claude/skills/MANIFEST.json
```

Extract `health_rules[]` array.

### Step 2: List All Tickets

```bash
ls ~/.claude/state/tickets/*.json 2>/dev/null | grep -v gathered
```

### Step 3: For Each Ticket

Read the ticket state file and check each health rule:

```json
{
  "id": "pr_merged_stage_drift",
  "condition": "pr.state == MERGED AND stage != merged",
  "severity": "error",
  "auto_heal": true,
  "fix": "advance to merged"
}
```

**Condition evaluation:**
- `pr.state == MERGED` → Check GitHub: `gh pr list --head <branch> --state merged --json number --limit 1`
- `stage != merged` → Check ticket state file `stage` field
- `commits_on_branch > 0` → Check: `git log origin/master..<branch> --oneline | wc -l`
- `days_since_update > 7` → Parse `updated` field, compare to now

### Step 4: Collect Drift Items

For each rule violation:
```json
{
  "ticket": "<KEY>",
  "rule_id": "<health_rule.id>",
  "severity": "<error|warning>",
  "message": "<generated from condition>",
  "auto_heal": true|false,
  "fix": "<action>"
}
```

### Step 5: Output

```
## Ecosystem Scan

### Health Check Results
| Ticket | Rule | Severity | Status |
|--------|------|----------|--------|
| POS-3044 | pr_merged_stage_drift | error | DRIFT |
| POS-3243 | commits_but_planned | warning | DRIFT |
| POS-XXXX | stale_ticket | warning | STALE |

### Summary
- <N> tickets scanned
- <N> healthy
- <N> with drift (N auto-healable)
- <N> stale (> 7 days)

Run `/babysitter heal --all` to auto-fix all healable drift.
```

### Step 6: Activity Logging

```bash
~/.claude/bin/activity-log.sh babysitter scan "" ',"tickets":<N>,"healthy":<N>,"drift":<N>'
```

---

## Operation: Heal All (`heal --all`)

Auto-fix ALL known drift patterns across all tickets.

### Step 1: Run Scan

Execute the Scan operation (above) to collect all drift items.

### Step 2: Filter Auto-Healable

From the drift items, select those where `auto_heal: true`.

### Step 3: Apply Fixes

For each auto-healable item, apply the fix:

| Rule ID | Fix Action |
|---------|------------|
| `pr_merged_stage_drift` | `Skill("ticket-state", args: "advance <KEY> merged --note 'PR merged (auto-healed)'")` |
| `pr_exists_stage_drift` | `Skill("ticket-state", args: "advance <KEY> pr_created --note 'PR detected (auto-healed)'")` + update PR metadata |
| `pr_approved_stage_drift` | `Skill("ticket-state", args: "advance <KEY> approved --note 'PR approved (auto-healed)'")` |
| `changes_requested_drift` | `Skill("ticket-state", args: "update <KEY> --stage changes_requested")` |
| `jira_done_stage_drift` | `Skill("ticket-state", args: "advance <KEY> merged --note 'Jira Done (auto-healed)'")` |
| `commits_but_planned` | `Skill("ticket-state", args: "advance <KEY> implementing --note 'Commits detected (auto-healed)'")` |

### Step 4: Output

```
## Heal All Results

### Fixes Applied
| Ticket | Rule | Action | Status |
|--------|------|--------|--------|
| POS-3044 | pr_merged_stage_drift | advanced to merged | FIXED |
| POS-3243 | commits_but_planned | advanced to implementing | FIXED |

### Summary
- <N> drift items found
- <N> auto-healed
- <N> require manual fix (see `/babysitter heal <target>`)

### Non-Auto-Healable
- POS-XXXX: orphaned_state — Branch deleted, state file orphaned. Consider archiving.
- POS-YYYY: stale_ticket — No activity in 10 days. Check if still relevant.
```

### Step 5: Activity Logging

```bash
~/.claude/bin/activity-log.sh babysitter heal "" ',"fixed":<N>,"manual":<N>'
```

---

## Operation: Heal

Parse target from `$ARGUMENTS` after `heal`:
- `latest` — most recent unresolved issue (by file mtime)
- `<skill-name>` — most recent unresolved issue for that skill
- `<issue-id>` — specific issue file by ID

### Steps

1. Ensure state dir exists
2. Find the target issue file:
   ```bash
   # For "latest":
   ls -t ~/.claude/state/babysitter/issues/*.json 2>/dev/null | head -1

   # For skill name:
   ls -t ~/.claude/state/babysitter/issues/*-<skill>-*.json 2>/dev/null | head -1

   # For specific ID:
   cat ~/.claude/state/babysitter/issues/<id>.json
   ```
3. If not found: "No unresolved issues found for `<target>`."
4. Read the issue file
5. Check KNOWN_ISSUES.json for match
6. **Known + auto_fixable:** Apply silently, report result
7. **Known + manual:** Show fix instructions
8. **Unknown:** Run diagnosis agents, propose fix, single confirm prompt
9. On success: silently learn (append to KNOWN_ISSUES.json if novel)

### Output

```
## Healed: <issue_id>

**Skill:** <skill>
**Error:** <error_code>
**Fix applied:** <description of what was done>
**Status:** Resolved
```

---

## Operation: Learn From

Parse description from `$ARGUMENTS` after `learn-from`. Everything after `learn-from` is the description text.

### Steps

1. Read current KNOWN_ISSUES.json
2. Ask Nathan via AskUserQuestion:
   - "Which skills does this affect?" (text input)
   - "What error codes should match?" (text input)
   - "Is this auto-fixable?" (Yes / No)
3. Construct a new pattern entry:
   ```json
   {
     "id": "<generated from description>",
     "skills_affected": ["<from answer>"],
     "error_codes": ["<from answer>"],
     "detection": "<from description>",
     "severity": "warn",
     "fix": "<from description>",
     "auto_fixable": <from answer>,
     "added": "<today YYYY-MM-DD>"
   }
   ```
4. Append to `patterns[]` in KNOWN_ISSUES.json
5. Write file back

### Output

```
Learned: "<id>" — affects <skills>, matches <error_codes>.
```

---

## Operation: Report (Building Block)

Parse from `$ARGUMENTS` after `report`:
- `$1` — skill name
- `$2` — error code
- `--message "text"` — human-readable description
- `--ticket KEY` — optional Jira key

### Steps

1. Ensure state dir:
   ```bash
   mkdir -p ~/.claude/state/babysitter/issues
   ```
2. Generate ID: `YYYYMMDD-HHmmss-<skill>-<error_code>`
3. Write issue file to `~/.claude/state/babysitter/issues/<id>.json`:
   ```json
   {
     "id": "<id>",
     "at": "<ISO 8601 now>",
     "skill": "<skill>",
     "error_code": "<error_code>",
     "message": "<from --message>",
     "ticket": "<from --ticket or null>",
     "source": "report",
     "resolved": false,
     "resolved_at": null,
     "resolution": null,
     "known_issue_match": null
   }
   ```
4. Check KNOWN_ISSUES.json for match — if found, include in response
5. Always return immediately (non-blocking)

### Output

```
### Context for Caller
- status: success
- action: continue
- issue_id: <id>
- known_fix: <fix text or null>
```

---

## Diagnosis Agents

When a novel (unmatched) issue is detected, spawn up to 3 parallel agents via Task to investigate:

**Agent 1: File Integrity** (subagent_type: Explore, max_turns: 8)
```
Check file integrity for skill "<skill>":
1. Verify ~/.claude/skills/<skill>/SKILL.md exists and is readable
2. Check for skills: frontmatter references — do referenced skills exist?
3. Check any markdown links in the file — do targets exist?
4. Report: files present/missing, references valid/broken
```

**Agent 2: Dependency Chain** (subagent_type: Explore, max_turns: 8)
```
Check dependency chain for skill "<skill>":
1. Read ~/.claude/skills/<skill>/SKILL.md
2. Find all Skill("...") calls — extract target skill names
3. For each target: verify ~/.claude/skills/<target>/SKILL.md exists
4. Check state paths referenced (e.g., ~/.claude/state/tickets/)
5. Report: dependencies satisfied/missing, state paths exist/missing
```

**Agent 3: Environment** (subagent_type: Explore, max_turns: 5)
```
Check environment for skill "<skill>":
1. Read allowed-tools from ~/.claude/skills/<skill>/SKILL.md frontmatter
2. For any MCP tools listed: verify via ToolSearch
3. For CLI tools (git, gh, jira): verify via `which`
4. Report: tools available/missing
```

**Timeout handling:** If any agent doesn't return, proceed with available results. Note "timed out — re-run to retry" for missing sections.

**Synthesis:** Combine all agent results into a diagnosis:
- Root cause hypothesis
- Proposed fix
- Confidence level (high/medium/low)

---

## Silent Learning

When a novel issue is successfully resolved (Nathan confirmed + fix worked):

1. Read KNOWN_ISSUES.json
2. Construct new pattern from the issue + fix:
   - `id`: derive from error_code
   - `skills_affected`: from the issue's skill
   - `error_codes`: from the issue's error_code
   - `detection`: from the issue's message (generalize if possible)
   - `fix`: the fix that was applied
   - `auto_fixable`: true if the fix was a simple bash command or Skill() call
   - `added`: today's date
3. Append to `patterns[]`
4. Write back — NO prompt to Nathan. Knowledge accumulates silently.

---

## Pruning

Old resolved issues can be cleaned up:
```bash
find ~/.claude/state/babysitter/issues/ -name "*.json" -mtime +30 -delete
```

This runs automatically during Step 1 of Smart Default (after ensuring dir exists).
