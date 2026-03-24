---
name: worktree-cleanup
description: Audit git worktrees, check PR status, and clean up merged ones
argument-hint: "[optional: --dry-run to only report]"
---

# Worktree Cleanup

Audit all open git worktrees, check whether their branches have PRs raised and merged, and offer to clean up the merged ones.

## Workflow

### Step 1: List all worktrees

Run `git worktree list` to get every worktree and its branch name. Exclude the main working directory (master).

### Step 2: Check PR status for each branch

For each worktree branch, use `gh pr list --head <branch> --state all` to determine:
- Whether a PR exists
- Whether it's open, merged, or closed
- The PR number and merge date

### Step 3: Present the report

Show two tables:

**Merged -- safe to delete:** Worktrees whose PRs have been merged. Include branch name, PR number(s), and merge date.

**No PR / Open PR -- keep:** Worktrees with no PR or an open PR. Note if the branch commit matches master (no local changes).

### Step 4: Confirm and clean up

If `$ARGUMENTS` contains `--dry-run`, stop after the report.

Otherwise, ask Nathan which worktrees to delete:
- Offer to delete all merged worktrees
- Offer to keep specific ones

For each worktree to delete:
1. `git worktree remove <path>` to remove the worktree
2. `git branch -d <branch>` to delete the local branch
3. If `-d` fails (squash-merged), ask before using `git branch -D`

### Step 5: Verify

Run `git worktree list` to confirm the final state. Summarize what was removed and what remains.

## Important

- NEVER force-delete branches without asking first
- NEVER delete worktrees that have open PRs or no PR
- Always confirm with Nathan before destructive operations
- Branches at the same commit as master with no PR may still be intentional -- flag them but don't auto-delete
