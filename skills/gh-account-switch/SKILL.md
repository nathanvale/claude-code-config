---
name: gh-account-switch
description: "Run GitHub CLI workflows with an exact process-scoped account without changing shared gh state."
argument-hint: "<account> [gh arguments...]"
disable-model-invocation: true
---

# GitHub Account Routing

Use `ghh`. Never call `gh auth switch`; it changes shared state and races with concurrent agents.

## Route

1. Require the exact GitHub account.
2. Verify it with `ghh check --account <account> --json`.
3. Run GitHub CLI work with `ghh exec --account <account> -- <gh arguments...>`.
4. Pin the repository with `-R <owner>/<repo>` when the current directory does not prove the target.
5. Verify the returned owner, actor, or repository when the operation is identity-sensitive.

Example:

```sh
ghh exec --account nathanvale -- pr view 309 -R nathanvale/claude-code-config
```

## Git Transport

`ghh` controls GitHub CLI API identity only. Git fetch, clone, and push identity still comes from the operation URL and SSH configuration.

Before a Git network write:

1. Inspect the exact fetch or push URL the operation will use.
2. For SSH, run `ssh -T -o BatchMode=yes git@<host>` and require `Hi <account>!`.
3. Accept exit `1` only when the GitHub greeting names the exact account; GitHub provides no shell.
4. For HTTPS, stop unless another owner proves the credential identity.

Never rewrite a remote as part of account selection.

## Dependency

- `ghh` is a hard dependency. `ghh --help` owns its flags, behavior, and repair guidance.
- If `ghh` is missing, stop. Install or sync the dotfiles `bin/ghh` command into `PATH`, then rerun `ghh check`.

## Safety

- Never call `gh auth switch` from an agent workflow.
- Never print tokens, private keys, or credential lookup output.
- `ghh check` is read-only. `ghh exec` inherits the side effects and retry safety of the forwarded `gh` command.
- A verified GitHub CLI identity does not authorize Git remote, SSH config, or repository changes.

## Next Safe Action

Run `ghh check --account <account> --json`.
