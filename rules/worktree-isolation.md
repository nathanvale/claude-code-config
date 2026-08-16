## Worktree Isolation

Editing files in the main checkout is NEVER allowed — parallel agents share it and inherit dirty files.

- The trigger is the edit, not the task. Before **any** Edit/Write call, in **any** repo, verify isolation; in the main checkout, isolate first via EnterWorktree or the `worktree` skill (`new`/`attach`).
- Check: `git rev-parse --git-common-dir` differing from `.git`, or a `.worktrees/` / `.claude/worktrees/` path, means isolated.
- Exception: claude-code-config and dotfiles run main-direct mode (AGENTS.md "Context And Git" override) — edit their main checkouts on `main`; complex commits must pass `compound-engineering:ce-code-review` on the exact final diff, findings resolved, first.
- Never classify your way out (the main-direct repos above are the sole carve-out). These do NOT exempt an edit: one-line or "trivial" changes; config, dotfile, gitignore, or docs edits; a repo incidental to the session; "I was only diagnosing"; handoffs ("start a fresh branch"); session "work in place" config; urgency.
- Read-only work (analysis, review, search, tests without edits) stays in the main checkout.
- Full procedure, checks, and exceptions: `docs/git/worktree.md` section "Isolation Rule".
