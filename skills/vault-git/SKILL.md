---
name: vault-git
description: "Vault write, vault transaction, Super-vault commit, or vault-git workflow."
role: tool-workflow
---

# Vault Git

Resolve the configured Super-vault through `~/.config/context/vault.md`.

No arguments: resolve the vault, then show the available commands through the package help.

## Mode Gate

Check `${XDG_CONFIG_HOME:-$HOME/.config}/context/vault-git-paused` before invoking the transaction manager.

- Marker present: use Direct Git Mode. Do not invoke `vault-git`, delete private receipts, or alter the Remote Ledger.
- Marker absent: use the Transaction Manager Workflow below.
- Never create or remove the marker without an explicit owner request. Each host has its own marker.

## Direct Git Mode

1. Work only in the configured vault's canonical `main` checkout. Never create a vault worktree.
2. Confirm one canonical writer. Inspect branch, status, local/remote alignment, and existing staged state before editing.
3. Preserve unrelated staged, unstaged, and untracked state. Stop on overlap inside an intended path.
4. Mutate only the requested paths and run `bun run check`.
5. Stage explicit paths with `git add -- <path>...`; never use broad staging.
6. Inspect the exact path-limited staged diff. After commit approval, use `git commit --only -m <summary> -- <path>...` so unrelated staged entries remain outside the commit.
7. Re-read status and verify unrelated state remains. Push only after explicit approval and a fresh fast-forward check through the configured identity.

Pause mode freezes any existing transaction-manager receipt or lease evidence. Re-enable only after an explicit owner request and fresh reconciliation proves no active writer, no unknown publication, aligned local/remote `main`, and a settled Remote Ledger.

## Transaction Manager Workflow

1. From `runtime/vault-git-transaction-manager`, invoke the `vault-git` package entry with `bun run --silent vault-git`; use its discovery or help for command inputs. Invocation proof: repo-root `scripts/command-entrypoint.integration.test.ts`.
2. Call `begin` with the semantic event and complete intended path set.
3. Mutate only paths admitted by the transaction.
4. Use `join` when a nested workflow needs more paths.
5. Call `complete` with a semantic summary. Never infer completion from local state; skipping the runtime's completion checks strands the lease and leaves the transaction open.
6. On any refusal, run `doctor` first, then follow the CLI's repair hint.

Use `tidy now` only for explicit hygiene. Never create a visible hygiene task; `runtime/vault-git-transaction-manager` owns its workers.

Outside Direct Git Mode, never run raw Git against the vault; raw writes bypass single-writer fencing and corrupt transaction receipts. `activation_blocked`, `lease_active`, `remote_unavailable`, and every other refusal are not pause triggers; follow the repair hint unless the owner explicitly selects pause mode.

## Read Requests

Resolve the configured vault, then read it directly. Keep read-only work transaction-free.
