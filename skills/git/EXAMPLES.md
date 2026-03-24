# Git Skill — Quick Reference

## Local Git Operations

| Operation | Example | Description |
|-----------|---------|-------------|
| `status` | `/git status` | Working tree status (MCP → porcelain fallback) |
| `log` | `/git log --limit 5` | Recent commits |
| `log` | `/git log --author "Nathan" --since "2 days ago"` | Filtered log |
| `diff` | `/git diff` | Working tree changes |
| `diff` | `/git diff --staged` | Staged changes only |
| `diff` | `/git diff --ref master` | Diff against branch |
| `branch` | `/git branch` | List branches |
| `branch` | `/git branch --all` | Include remotes |
| `branch-create` | `/git branch-create feat/POS-3044-feature` | Create + switch |
| `stash` | `/git stash` | List stashes |
| `stash` | `/git stash push "WIP: feature"` | Save work |
| `stash` | `/git stash pop` | Restore latest |
| `search` | `/git search "seller config"` | Search commit messages |
| `file-history` | `/git file-history src/types/seller.ts` | File commit history |
| `blame` | `/git blame src/api/fulfilmentsApi.ts --line 50,80` | Line-level attribution |
| `commit` | `/git commit` | Interactive conventional commit |

## GitHub PR Operations

| Operation | Example | Description |
|-----------|---------|-------------|
| `pr-create` | `/git pr-create` | Create PR with template |
| `pr-view` | `/git pr-view 434` | PR metadata + review status |
| `pr-list` | `/git pr-list` | Open PRs |
| `pr-list` | `/git pr-list --state merged --author @me` | My merged PRs |
| `pr-diff` | `/git pr-diff 434` | Full PR diff |
| `pr-checks` | `/git pr-checks 434` | CI check status |
| `pr-comment` | `/git pr-comment 434 "LGTM"` | Add comment |
| `pr-merge` | `/git pr-merge 434` | Squash merge + delete branch |
| `pr-merge` | `/git pr-merge 434 --merge` | Merge commit strategy |
| `pr-ready` | `/git pr-ready 434` | Mark draft as ready |
| `pr-submit-review` | `/git pr-submit-review 434 --approve` | Submit approval |
| `pr-submit-review` | `/git pr-submit-review 434 --request-changes --body "Fix X"` | Request changes |
| `pr-review` | `/git pr-review 434` | Full code review with findings |

## Shortcut Commands

These command wrappers route through the git skill:

| Command | Routes to |
|---------|-----------|
| `/git-status` | `/git status` |
| `/git-log` | `/git log` |
| `/git-diff` | `/git diff` |
| `/git-branch` | `/git branch` |
| `/git-commit` | `/git commit` |
| `/git-stash` | `/git stash` |
| `/git-search` | `/git search` |
| `/git-pr-create` | `/git pr-create` |
| `/git-pr-view` | `/git pr-view` |
| `/git-pr-list` | `/git pr-list` |
| `/git-pr-review` | `/git pr-review` |
| `/git-pr-merge` | `/git pr-merge` |
| `/git-pr-checks` | `/git pr-checks` |
| `/pr-create` | `/git pr-create` (legacy alias) |

## Programmatic Usage (from other skills)

```
Skill("git", args: "status")
Skill("git", args: "log --limit 5")
Skill("git", args: "pr-view 434")
Skill("git", args: "commit")
Skill("git", args: "pr-create")
```
