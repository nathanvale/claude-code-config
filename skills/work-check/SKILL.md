˜---
name: ˜
description: Check for existing implementation work on a Jira ticket. Scans branches, commits, PRs, and worktrees across repos. Use when you need to know if work has already been done before starting.
allowed-tools: Bash
context: fork
model: haiku
user-invocable: false
argument-hint: <TICKET_ID>
---

# Work Check

Checks for existing implementation artifacts related to a Jira ticket across all local repos.

**Ticket ID:** `$ARGUMENTS`

## Step 1: Validate

Extract TICKET_ID from `$ARGUMENTS`. It must match `POS-\d+` (case-insensitive, normalize to uppercase).

If invalid, output and stop:
```
### Result
Invalid ticket ID: "$ARGUMENTS". Expected format: POS-XXXX

### Context for Caller
- status: failed
- error: invalid_ticket_id
```

## Step 2: Detect Repos

Check which repos exist on disk:

```bash
ls -d /Users/s1010081/code/gms.app 2>/dev/null && echo "gms.app:OK"
ls -d /Users/s1010081/code/gms.api 2>/dev/null && echo "gms.api:OK"
ls -d /Users/s1010081/code/voucher 2>/dev/null && echo "voucher:OK"
```

Build a list of available repos. Skip any that don't exist - note them in the output but don't error.

## Step 3: Collect Data (parallel)

Run these checks in parallel across all available repos. Use `&` and `wait` to parallelize.

### 3a. Git Branches

For each repo:
```bash
git -C <REPO_PATH> branch -a --format='%(refname:short) %(committerdate:relative)' | grep -i <TICKET_ID>
```

Extract: branch name, last commit age, whether it's remote-only.

**Stale detection:** If the last commit on a branch is older than 30 days, flag as stale.

### 3b. Git Commits

For each repo:
```bash
git -C <REPO_PATH> log --all --oneline --grep=<TICKET_ID> -10 --format='%h %ar %s'
```

Cap at 10 most recent commits per repo.

### 3c. Git Worktrees

For each repo:
```bash
git -C <REPO_PATH> worktree list --porcelain | grep -A2 <TICKET_ID>
```

Extract: worktree path, branch name.

### 3d. Pull Requests

For each repo (GitHub org: `Bunnings-Technology-Delivery`):
```bash
gh pr list --repo Bunnings-Technology-Delivery/<REPO_NAME> --search "<TICKET_ID>" --state all --json number,title,state,headRefName,updatedAt,url --limit 10
```

**Stale detection:** If a PR is open and hasn't been updated in 14+ days, flag as stale.

## Step 4: Format Output

### Human-readable section

If ANY work found:

```
## Prior Work: <TICKET_ID>

### Summary
- **Status:** Active | Stale | No prior work
- **Last activity:** <most recent date across all findings>
- **Found:** <N> branches, <N> commits, <N> PRs, <N> worktrees

### Branches
| Branch | Repo | Last Activity | Notes |
|--------|------|---------------|-------|
| fix/POS-XXXX-desc | gms.app | 3 days ago | |
| feat/POS-XXXX-old | gms.api | 45 days ago | stale |

### Recent Commits (showing up to 5)
| Hash | Repo | Age | Message |
|------|------|-----|---------|
| a1b2c3d | gms.app | 3 days ago | fix: POS-XXXX cleanup tasks |

### Pull Requests
| PR | Repo | State | Branch | Updated |
|----|------|-------|--------|---------|
| #452 | gms.app | merged | fix/POS-XXXX-desc | 1 day ago |

### Worktrees
| Path | Branch |
|------|--------|
| .worktrees/fix-POS-XXXX-desc | fix/POS-XXXX-desc |
```

Omit any section (Branches, Commits, PRs, Worktrees) where count is zero.

If NO work found:
```
## Prior Work: <TICKET_ID>

No prior implementation work found. Starting fresh.
```

### Context for Caller

Always include:
```
### Context for Caller
- status: success
- ticket_id: <TICKET_ID>
- work_found: true|false
- work_status: active|stale|none
- last_activity: <ISO date or "none">
- repos_checked: <comma-separated>
- repos_skipped: <comma-separated or "none">
- branch_count: <N>
- commit_count: <N>
- pr_count: <N>
- worktree_count: <N>
- stale_branches: <comma-separated names or "none">
- stale_prs: <comma-separated numbers or "none">
```

**Work status logic:**
- `none` - no branches, commits, PRs, or worktrees found
- `active` - work found, most recent activity within 14 days
- `stale` - work found, but ALL activity is older than 14 days

## Error Handling

| Scenario | Handling |
|----------|---------|
| Repo not on disk | Skip, note in `repos_skipped` |
| Git command fails | Skip that check for that repo, continue with others |
| `gh` not authenticated | Return empty PR list, note "gh auth required for PR check" |
| `gh` rate limited | Return empty PR list, note "GitHub rate limited" |
| Network error | Return empty PR list, continue with local checks |
| No results anywhere | Return `work_found: false`, not an error |
| Malformed ticket ID | Fail fast with error in Step 1 |
