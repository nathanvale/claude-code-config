## Worktree Isolation

Editing files in the main checkout is NEVER allowed — parallel agents share it and inherit dirty files.

- The trigger is the edit, not the task. Before **any** Edit/Write call, in **any** repo, verify isolation; in the main checkout, isolate first via EnterWorktree or the `worktree` skill (`new`/`attach`).
- Check: `git rev-parse --git-common-dir` differing from `.git`, or a `.worktrees/` / `.claude/worktrees/` path, means isolated.
- Never classify your way out. These do NOT exempt an edit: one-line or "trivial" changes; config, dotfile, gitignore, or docs edits; a repo incidental to the session; "I was only diagnosing"; handoffs ("start a fresh branch"); session "work in place" config; urgency.
- Read-only work (analysis, review, search, tests without edits) stays in the main checkout.
- Full procedure, checks, and exceptions: `docs/git/worktree.md` section "Isolation Rule".
