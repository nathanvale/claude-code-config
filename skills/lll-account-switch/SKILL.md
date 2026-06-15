---
name: lll-account-switch
description: "Switch Claude/Codex LLM accounts with lll-account-switch; check active provider, auth health, secret loading, shell snapshots, repo tool overrides, or Foundry/personal routing."
role: tool-workflow
---

# LLL Account Switch

Switch which account serves `claude` / `codex` through `lll-account-switch`.

Accounts: `personal` (Anthropic / Codex) and `foundry` (SMST Azure Foundry).

Local-development skill: works on this machine because the dotfiles owners
below exist. Treat other machines as unsupported unless they have the same
owner paths and account registry.

## Run Card

- Scope: read routing state, explain provider resolution, switch global or repo-level accounts.
- First safe action: `$HOME/code/dotfiles/bin/lll-account-switch status --json`; read `health[]` before any switch.
- Visible state: `ok`, `global_account`, `global_accounts`, `profile_dirs`, `repos[]`, `health[]`, `next_action`.
- Slow path: warn before global switches that affect multiple repos.
- Verify: `$HOME/code/dotfiles/bin/lll-account-switch status --json | jq '.ok'` after any switch.
- Publish: render compact routing table, then **always** end with the status-driven next-action menu from `Landing Page`. Never stop at the dashboard alone.
- Fallback: when `lll-account-switch` is unavailable, run `bash skills/lll-account-switch/scripts/lll-account-switch-status.sh` from this repo. Treat fallback output as read-only diagnostics; it does not own switching, repo init, JSON envelopes, health codes, or next-action state.

## Landing Page

After rendering the routing table, always present a status-driven menu.
Pick the branch that matches the current status JSON:

**When `health[]` is non-empty:**

> **Health issue:** `<code>` - `<message>`
>
> 1. **Fix: `<repair_hint>`** (human action required)
> 2. Explain why routing chose this provider
> 3. Switch account anyway (risky while unhealthy)

**When `ok: true` and user gave no specific ask:**

> 1. **All healthy** - nothing to do
> 2. Explain why routing chose a provider for this repo
> 3. Switch global account (personal <-> foundry)
> 4. Switch repo override for this repo

## Next Safe Actions

DX lens: present choices as a short numbered list so the user can reply by
number. Bold the recommended default. Never present more than 4 options. When
status makes the next step obvious, state what you are doing and proceed unless
the user redirects.

1. Health issue present -> **repair first health issue**; show `repair_hint`.
   For `REPO_NO_ENVRC`: run `$HOME/code/dotfiles/bin/lll-account-switch repo init --repo <path>`.
   For auth codes (`AZURE_SESSION_INVALID`, `OP_NOT_*`): surface hint; do not run.
2. Asks why routing chose a provider -> `$HOME/code/dotfiles/bin/lll-account-switch explain --repo <path> --tool <claude|codex|both>`.
3. Wants global routing changed -> `$HOME/code/dotfiles/bin/lll-account-switch use <personal|foundry> [--tool <claude|codex|both>]`.
   Dry-run first when target state is unclear: add `--dry-run`.
4. Wants repo override changed -> `$HOME/code/dotfiles/bin/lll-account-switch repo use <personal|foundry> --repo <path> --tool <claude|codex|both>`.
   Dry-run first when target state is unclear: add `--dry-run`.

## Health Codes

| Code | Human action | Agent action |
|---|---|---|
| `AZURE_SESSION_INVALID` | Run `az login` | Surface hint; do not run |
| `OP_NOT_AVAILABLE` / `OP_NOT_AUTHENTICATED` | Install / sign in to 1Password CLI | Surface hint; do not run |
| `STALE_SNAPSHOTS` | Run purge command from `repair_hint` | Surface hint; do not run |
| `REPO_NO_ENVRC` | Create/restore the repo `.envrc` | Run `$HOME/code/dotfiles/bin/lll-account-switch repo init --repo <path>` |

After any switch: tell the human to restart affected `claude` / `codex` sessions (routing resolves at process launch).

## Owners

CLI and state:
- Switcher CLI: `$HOME/code/dotfiles/bin/lll-account-switch`
- Fallback status script: `skills/lll-account-switch/scripts/lll-account-switch-status.sh`

Generated routing state (read-only for agents):
- `~/.config/lll-account-switch/account`, `claude-account`, `codex-account`
- `~/.config/lll-account-switch/env`, `secrets.env`

Account and repo config:
- Foundry direnv source: `$HOME/code/dotfiles/.envrc.monash-foundry` (do not edit)
- Repo override: the repo's `.envrc`
- Codex Foundry profile: `~/.codex-monash/config.toml`

## Safety

- Never print or echo `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_API_KEY_MONASH` values.
- Do not run `az login`, `op signin`, or snapshot purge commands.
- Do not manually edit `$HOME/code/dotfiles/.envrc.monash-foundry`.
- If `health[]` is non-empty, report codes and repair hints before continuing.

## Verification

- `$HOME/code/dotfiles/bin/lll-account-switch status --json | jq '.ok'` - agent-readable surface works.
- `$HOME/code/dotfiles/bin/lll-account-switch status` - human-readable summary.
- `$HOME/code/dotfiles/bin/lll-account-switch explain --json` - effective-provider reasons are machine-readable.
- `$HOME/code/dotfiles/bin/lll-account-switch repo list --json` - repo override discovery is machine-readable.
- `bash skills/lll-account-switch/scripts/lll-account-switch-status.sh` - fallback script path works.
- `$HOME/code/dotfiles/bin/test/lll-account-switch-test.sh` - repo tool targeting, help, parser acceptance, and status semantics.
