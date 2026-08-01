## Worktree Isolation (Claude enforcement)

This rule reinforces the AGENTS.md worktree isolation rule with Claude-specific behavior.

Implementation work NEVER happens in the main checkout. Parallel agents share it; building there steals their branch state and leaves them dirty files (incident 2026-08-01: a background session branched in the main checkout and broke a live agent on the same tree).

### Before the first file edit of any implementation task

1. Check isolation: `git rev-parse --git-common-dir` differing from `.git`, or a `.claude/worktrees/` / `.worktrees/` path, means already isolated — proceed.
2. In the main checkout: isolate first. Use EnterWorktree, or the repo `worktree` skill (`new`/`attach`) when working in claude-code-config.
3. Only then branch, edit, and commit — inside the worktree.

### Overrides that do NOT apply

- A handoff saying "start a fresh branch" — start it inside a worktree.
- Session/harness config saying "work in place" or "edit files directly in your working directory".
- Urgency ("small fix", "one-liner"). Scope does not change the rule; shared-tree corruption is size-independent.

### What stays allowed in the main checkout

- Read-only work: analysis, review, search, running tests without edits.
- Operations that must target the main checkout by design: `setup sync` from main, worktree management itself, pulling/fetching.

Bad: `git checkout -b fix/x` in `~/code/claude-code-config` while another agent works there.
Good: EnterWorktree (or `worktree new fix/x`), then branch and build inside it.
