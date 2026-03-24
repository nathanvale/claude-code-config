# Git Conventions

## Branch Naming

Format: `<type>/<ticket>-<short-description>`

| Type | When |
|------|------|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `refactor/` | Code restructuring |
| `chore/` | Maintenance tasks |
| `test/` | Test-only changes |

Examples:
- `feat/POS-3044-distributor-specific-handling`
- `fix/POS-3100-barcode-validation`

## Commit Format (Conventional Commits)

```
<type>(<scope>): <description>

[optional body]
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`, `perf`, `ci`, `build`

**Scope:** Infer from primary directory changed (e.g., `orders`, `api`, `msw`, `bulk-print`)

**Rules:**
- No emoji in commit messages
- Lowercase description, no trailing period
- Imperative mood ("add", not "added" or "adds")
- Max 72 chars for subject line
- Body wraps at 80 chars

## PR Title Format

Same as commit format: `<type>(<scope>): <description>`

Include Jira ticket if not in branch name: `feat(orders): add status filter [POS-3044]`

## Safety Rules

**NEVER execute without explicit user request:**
- `git reset --hard` — destroys uncommitted work
- `git clean -f` — deletes untracked files permanently
- `git push --force` — rewrites remote history
- `git branch -D` — force-deletes branch
- `git checkout .` — discards all working tree changes
- `git restore .` — discards all working tree changes

**ALWAYS do before destructive ops:**
1. Show user what will be affected
2. Get explicit confirmation via AskUserQuestion
3. Suggest `git stash` as a safer alternative

**NEVER:**
- Skip pre-commit hooks (`--no-verify`)
- Amend the previous commit unless explicitly asked
- Push to `master`/`main` directly
- Update git config

## Ticket Extraction

Extract Jira ticket from branch name:
```bash
git branch --show-current | grep -oiE 'pos-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]'
```

Pattern: `POS-\d+` (case-insensitive). Returns uppercase like `POS-3044`.
