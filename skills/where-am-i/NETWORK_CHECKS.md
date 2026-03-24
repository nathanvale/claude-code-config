# Network Checks Reference

Tier 3 network operations for the `where-am-i` skill: staleness decisions, API calls, error handling, and live snapshot updates.

---

## Staleness Decision Matrix (Step 4a)

| Condition | Action |
|-----------|--------|
| `--fix`, `--dry-run`, or `--full` flag | Always run Tier 3, skip prompt |
| `last_checked.jira` AND `last_checked.github` both < 5 min old | Auto-skip Tier 3 entirely, output: `**Network:** Fresh (checked <N> min ago) --- skipping` |
| `last_checked` > 30 min old OR null | Prompt, default to "Full refresh" |
| Otherwise (5-30 min) | Prompt, default to "Skip" |

### Prompt Format

```
AskUserQuestion:
  question: "Refresh from Jira/GitHub? (last checked <staleness>)"
  options:
    - "Full refresh" / "Refresh Jira and GitHub for latest status"
    - "Just Jira" / "Only check Jira ticket status"
    - "Just GitHub" / "Only check PR status"
    - "Skip" / "Use cached data, skip network checks"
```

If "Skip" selected or auto-skipped:
```
**Network:** Skipped --- run `/where-am-i --full` to refresh
```
Then jump to Step 5 (final summary). No network drift detection.

---

## GitHub Checks (Step 4b)

```bash
gh pr list --head <branch> --json number,title,state,url,reviews,reviewDecision --limit 1
```
```bash
gh pr list --head <branch> --state merged --json number,url --limit 1
```

If PR found, capture: number, state, url, reviewDecision, merged status.

---

## Jira Checks (Step 4b)

```
Skill("jira", args: "view <KEY>")
```

Extract: current status, assignee, type.

---

## Error Handling

If a check fails (network error, timeout):
```
**<Source>:** Error --- <message>. Check VPN/proxy.
```

Report to babysitter inbox per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md):
- `jira_fetch_failed` --- Jira skill call failed during Tier 3
- `github_fetch_failed` --- GitHub CLI call failed during Tier 3

---

## Live Snapshot Update (Step 4e)

Read state file, merge network results into `last_checked` and `live_snapshot`, write back.

Only update fields for the sources that were actually checked. Preserve all other fields exactly.

```json
{
  "last_checked": {
    "git": "<preserve>",
    "jira": "<current ISO timestamp if Jira was checked>",
    "github": "<current ISO timestamp if GitHub was checked>"
  },
  "live_snapshot": {
    "git_status": "<preserve>",
    "commits_ahead": "<preserve>",
    "jira_status": "<from Jira if checked>",
    "jira_assignee": "<from Jira if checked>",
    "pr_state": "<from GitHub if checked, e.g. OPEN, CLOSED, MERGED>",
    "pr_review_decision": "<from GitHub if checked>"
  }
}
```

Use `Read` to get current file content, merge the fields in-memory, then `Write` to save. Only touch `last_checked` and `live_snapshot`.

---

## Babysitter Inbox Reporting

On transient failures, report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md):

| Error Code | Trigger |
|------------|---------|
| `state_read_failed` | State file exists but can't be parsed |
| `drift_fix_failed` | An attempted drift fix via Skill() call failed |
| `jira_fetch_failed` | Jira skill call failed during Tier 3 |
| `github_fetch_failed` | GitHub CLI call failed during Tier 3 |
