---
alwaysApply: true
---

## Git Workflow (Claude-specific enforcement)

This rule reinforces the shared git policy in AGENTS.md with Claude-specific behavior.

### Safety reinforcement
- NEVER force push, hard reset, clean -f, or checkout/restore .
- NEVER commit to main/master -- create a feature branch first
- NEVER use git add . or git add -A -- stage specific files
- ALWAYS use conventional commits: type(scope): subject

### Attribution
Always add `Co-Authored-By: Claude <noreply@anthropic.com>` in commit footers when Claude generates or substantially modifies code.

### Commit message format
Use HEREDOC syntax for multi-line commit messages:
```bash
git commit -m "$(cat <<'EOF'
type(scope): subject

[body]

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Workflow dispatch
- When the user says "commit" -> read `docs/git/workflows.md` section "Commit" and follow the procedure
- When the user says "squash" -> read `docs/git/workflows.md` section "Squash" and follow the procedure
- When the user says "create PR" or "make a PR" -> read `docs/git/workflows.md` section "PR" and follow the procedure
- When the user says "commit and PR" or "ship it" -> read `docs/git/workflows.md` section "Commit-Push-PR" and follow the procedure
- When the user says "clean branches" -> read `docs/git/workflows.md` section "Clean-Gone" and follow the procedure
- When the user says "review PR" -> read `docs/git/workflows.md` section "Review PR" and follow the procedure
- When the user says "changelog" -> read `docs/git/workflows.md` section "Changelog" and follow the procedure
- For worktree operations -> read `docs/git/worktree.md` and follow the relevant procedure
