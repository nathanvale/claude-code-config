---
name: gh-account-switch
description: "Select the right GitHub account. Use on push or fetch denied, wrong-account commits, \"Repository not found\" on a private repository, or cloning a second account's repository."
argument-hint: "<account>"
---

# GitHub Account Switch

## Route

1. `ghh check --account <login>` → exit `0`. Never infer the active account.
2. `ghh exec --account <login> -- <gh arguments...>` for GitHub API work.
3. Before clone, fetch, push, or remote change: `ssh -T -o BatchMode=yes git@<host>`
   → require `Hi <login>!`. Exit `1` is success; GitHub provides no shell.

Target account not supplied: list the accounts and ask which one.

| Account | Owns | API layer (`ghh --account`) | Transport layer (SSH host) |
|---|---|---|---|
| `nathanvale` | personal repositories | `nathanvale` | `github.com` |
| `myagentdojo` | `my-second-brain-*`, `agent-plugin-*`, `agent-attention*` | `myagentdojo` | `github-myagentdojo` |

Two layers, set independently. A push or fetch failure is a transport fault.

"Repository not found" under one account: re-probe under the other before concluding
the repository is missing.

Clone with the explicit host:

```sh
git clone git@<host>:<owner>/<repo>.git
```

`ghh --help` owns flags, exit codes, and behavior.

## Safety

- Stop when `ghh check` fails or the SSH greeting does not match the target.
- Selecting an account does not authorize SSH key, SSH config, Git remote, or
  repository changes.
