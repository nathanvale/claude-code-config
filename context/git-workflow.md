# Git Workflow & Safety

## BLOCKED Commands (never use)

`git reset --hard` | `git reset HEAD~` | `git clean -f/-fd/-fx` | `git checkout -- .` | `git restore .` | `git push --force/-f` | `rm -rf`

## ASK FIRST

- `git rebase` → rewrites history
- `git stash drop` → permanently deletes stash
- `git branch -D` → force deletes branch

## Safe Alternatives

- `git stash -u` → preserve untracked (instead of `git clean`)
- `git branch backup-$(date +%s)` → backup before risky ops
- `git diff` / `git status` → verify before modifying

## Conventional Commits

Format → `<type>(<scope>): <subject>`
Example → `feat(auth): add OAuth2 login`
Types → `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`
Rules → max 100 chars, lowercase, no period

## MCP Tools (reads)

| Task | Tool |
|------|------|
| Recent commits | `git_get_recent_commits` |
| Search history | `git_search_commits` |
| Diff summary | `git_get_diff_summary` |
| Status | `git_get_status` |

Writes → Use bash or `/git:*` slash commands

## Homebrew

1. `brew install <package>`
2. Add to `~/.config/brew/Brewfile`
3. `brew bundle --file=~/.config/brew/Brewfile`
