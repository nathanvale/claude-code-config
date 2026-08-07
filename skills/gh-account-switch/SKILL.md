---
name: gh-account-switch
description: "Switch authenticated GitHub CLI accounts and select the matching SSH identity."
argument-hint: "<account>"
disable-model-invocation: true
---

# GitHub Account Switch

Switch the active `gh` account only when this skill is explicitly invoked.

## Route

1. Run `gh auth status`; never infer the active account.
2. Require an exact authenticated target. If missing, list the accounts and ask which one.
3. Run `gh auth switch --hostname github.com --user <account>`.
4. Verify `gh api user --jq .login` exactly matches the target.

For Git over SSH, keep token identity and SSH identity separate:

| Account | SSH host |
|---|---|
| `nathanvale` | `github.com` |
| `myagentdojo` | `github-myagentdojo` |

Before clone, fetch, push, or remote changes, run
`ssh -T -o BatchMode=yes git@<host>` and require `Hi <account>!`. GitHub returns
exit `1` after successful authentication because it provides no shell.

Use the explicit host when cloning:

```sh
gh repo clone git@<host>:<owner>/<repo>.git
```

## Safety

- Stop when the `gh` identity or SSH greeting does not match the target.
- Never print tokens or private keys.
- Switching accounts does not authorize SSH key, SSH config, Git remote, or repository changes.

`gh auth switch --help` owns switch flags and behavior.

## Next Safe Action

Run `gh auth status`, then switch only when an exact target account was supplied.
