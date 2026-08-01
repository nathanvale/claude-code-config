## Worktree Isolation

Implementation work NEVER happens in the main checkout — parallel agents share it and inherit dirty files.

- Before the first file edit of any implementation task, verify isolation; in the main checkout, isolate first via EnterWorktree or the `worktree` skill (`new`/`attach`).
- Handoffs ("start a fresh branch"), session "work in place" config, and urgency do not override.
- Full procedure, checks, and exceptions: `docs/git/worktree.md` section "Isolation Rule".
