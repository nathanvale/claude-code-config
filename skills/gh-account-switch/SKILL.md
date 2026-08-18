---
name: gh-account-switch
description: "Select the right GitHub account. Use on push or fetch denied, wrong-account commits, \"Repository not found\" on a private repository, or cloning a second account's repository."
argument-hint: "<account>"
---

# GitHub Account Switch

## Route

1. `ghh check` the target login first; never infer it from ambient state.
2. `ghh exec` that login for GitHub API work.
3. Before clone, fetch, push, or remote change: `ssh -T -o BatchMode=yes git@<host>`
   → require `Hi <login>!`. Exit `1` is success; GitHub provides no shell.

Target account not supplied: list the accounts and ask which one.

| Account | Owns | API layer (`ghh --account`) | Transport layer (SSH host) |
|---|---|---|---|
| `nathanvale` | personal repositories | `nathanvale` | `github.com` |
| `myagentdojo` | `my-second-brain-*`, `agent-plugin-*`, `agent-attention*` | `myagentdojo` | `github-myagentdojo` |

Two layers, set independently. Suspect transport first on a push or fetch denial; branch protection and non-fast-forward come from GitHub itself.

Missing-repository wording: `Repository not found` (transport), `Could not resolve to a Repository` (GraphQL), `Not Found (HTTP 404)` (REST). Re-probe under the other account before concluding it is missing.

Clone with the explicit host:

```sh
git clone git@<host>:<owner>/<repo>.git
```

`ghh --help` owns flags, exit codes, and behavior.

## Safety

- Stop when `ghh check` fails or the SSH greeting does not match the target.
- Account selection is read-only: probe, report, stop. SSH keys, SSH config, Git remotes, repository state: separate request, ask first.
