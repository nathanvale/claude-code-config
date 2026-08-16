---
name: one-password
description: "1Password/op: scoped service-account reads first, targeted secret read/store/inject, interactive desktop sign-in fallback."
role: tool-workflow
metadata: {"clawdbot":{"emoji":"🔐","requires":{"bins":["op"]},"install":[{"id":"brew","kind":"brew","formula":"1password-cli","bins":["op"],"label":"Install 1Password CLI (brew)"}]}}
---

# 1Password CLI

Generic safe `op` workflow: pick the access path, run targeted reads/writes, verify shape only. Exact account, vault, item, and field mappings belong to the owning capability, never here.

No-args or unclear request: start at Workflow step 1 — name the owning capability and its declared mapping.

## Access Paths

1. **Scoped service-account read (preferred, unattended).** Run non-interactive `op` through `$HOME/code/dotfiles/bin/with-one-password-token`, with an explicit `--vault` from the owning capability. Read the wrapper's `--help` before use. Never route through tmux or a persistent PTY.
2. **Interactive desktop sign-in (fallback, user-present).** Requires app integration and `op signin`; ask before falling back. Run the whole interactive task in one persistent shell session (tmux or a persistent agent PTY) because sign-in state does not survive fresh shells. Interactive sessions preserve sign-in only; they never feed values into unattended flows.

## Token custody

- Let `$HOME/code/dotfiles/bin/with-one-password-token` own token custody and process-scoped injection. Never read, source, create, or export its token source from this workflow; never place the token in shell rc, tmux/PTY environment, or ambient env.
- Browser-login secrets and the Browser Automation token are out of scope: `browser-use` owns that custody and delivery end-to-end (`skills/browser-use/src/browser-use-op.ts`, handle-only env spec; typed repair continuations discoverable through the `browser-use` `auth` command family). Never fetch browser-login secrets with this skill.
- Browser sessions receive no vault or item administration. Keep explicit vault listing and item create/update requests in this workflow; never grant those operations through a Browser Use credential transaction.

## Workflow

1. Get the owning capability's declared mapping: account, vault, item, field, expected shape. Missing mapping: stop and ask; never enumerate to discover.
2. Choose the access path above.
3. Service-account read: run `$HOME/code/dotfiles/bin/with-one-password-token check`, then one `$HOME/code/dotfiles/bin/with-one-password-token op item get "<item>" --vault "<vault>" --format json`. Extract the exact labeled field (`references/cli-examples.md`); never call bare `op` against ambient auth.
4. Process injection: run `$HOME/code/dotfiles/bin/with-one-password-token inject <ENV_KEY> <op://reference> -- <command>` when the declared capability needs one secret environment variable. The target receives the requested field, never the service-account token.
5. Interactive fallback: `op signin` then `op whoami` in the persistent session; keep every follow-up command, retry, and verification in that same session — never start a second one.
6. Verify shape only: length, expected prefix, newline count. Never print values.

## Guardrails

- Never print secret values to logs, chat, or code; shape-only checks.
- Never enumerate accounts, vaults, or items to discover candidates. On an explicit user ask, search metadata only within the token-scoped vault (`references/cli-examples.md`).
- Never use `op run` through the dotfiles wrapper; it is rejected because the target could inherit `OP_SERVICE_ACCOUNT_TOKEN`. Use the wrapper's `inject` command instead of writing secrets to disk.
- Multiple accounts: pass `--account` explicitly; confirm names with `op account list` (metadata-only) when routing is unclear.
- `op --field` / `--fields label=` can return the wrong concealed field on items with duplicate or legacy fields; read the item as JSON and extract the exact label.

## References

- Official docs: https://developer.1password.com/docs/cli/get-started/
- `references/get-started.md` — install, app integration, sign-in.
- `references/cli-examples.md` — safe create/edit, shape-only field reads, vault-scoped metadata search.
- Vocabulary: `CONTEXT.md`.
- Local compatibility owner: `$HOME/code/dotfiles/bin/with-one-password-token`; missing or failed `check` blocks unattended local access, not user-approved interactive fallback.
- Unattended-vs-interactive semantics owner: `docs/plans/2026-07-21-003-feat-browser-use-cross-adapter-authentication-plan.md` (R7, R16); `docs/adr/0028-auth-u3-splits-pure-contract-from-signed-native-capability.md`.
