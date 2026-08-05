---
name: gh-account-switch
description: "Switch authenticated GitHub CLI accounts and select the matching SSH identity."
argument-hint: "<account>"
disable-model-invocation: true
---

# GitHub Account Switch

Switch the active `gh` account only when this skill is explicitly invoked.

## Route

1. Run `gh auth status --hostname github.com`; never infer the active account.
2. Require an exact authenticated target. If missing, list the accounts and ask which one.
3. Run `gh auth switch --hostname github.com --user <account>`.
4. Verify `gh api --hostname github.com user --jq .login` exactly matches the target.

For Git over SSH, keep token identity and SSH identity separate:

| Account | SSH host |
|---|---|
| `nathanvale` | `github.com` |
| `myagentdojo` | `github-myagentdojo` |

Before clone, fetch, push, or remote changes:

1. Inspect the exact URL the operation will use: the clone URL, proposed remote
   URL, or fetch/push URLs for every participating remote. Ignore unrelated
   configured remotes.
2. For an SSH URL, take `<host>` from that URL. Run
   `ssh -T -o BatchMode=yes git@<host>` and require `Hi <account>!` for the exact
   selected account. GitHub returns exit `1` after successful authentication
   because it provides no shell; accept it only when the greeting matches.
3. For an HTTPS URL, stop. This skill cannot prove Git credential identity. Do
   not authorize the operation or rewrite the remote implicitly.

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

Run `gh auth status --hostname github.com`, then switch only when an exact target account was supplied.
